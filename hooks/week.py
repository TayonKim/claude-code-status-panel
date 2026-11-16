#!/usr/bin/env python3
"""Claude Code activity over the last 7 local days (work time, tokens, turns, per-day bars) as one JSON line.
Read by the status-panel pane every few minutes. Reads <config>/projects/**.jsonl ($CLAUDE_CONFIG_DIR, else ~/.claude)
incrementally with a small cache, stops after ~6 s with "partial": true and goes on next time.
The cache keeps, per transcript file, its path, how far it was read, its daily totals and the last few response ids.
It keeps no conversation text and no `cwd` values; the paths are the transcript files' own, so their project folder
names (which Claude Code derives from the working folders) are in it. The cache folder is created 0700 and the file
written 0600. Always prints exactly one JSON line ({"at", "error"} on failure)."""
import calendar, json, os, re, sys, time, zlib

BUDGET_S = 6.0      # 한 번 부를 때 쓰는 시간
GAP_CAP_S = 180     # 턴 안 간격 하나는 여기까지만(권한 기다림·긴 도구 실행 같은 빈틈은 안 셈)
BIG = 65536         # 이보다 긴 줄은 json 으로 풀지 않고 필요한 칸만 찾는다
DAYS = 7
KEEP_IDS = 16       # 같은 응답이 여러 줄로 되풀이될 때 거르려고 기억하는 최근 응답 수(실측: 되풀이는 늘 바로 앞 응답)
HEAD = 1024         # 파일이 통째로 바뀌었는지 알아보는 앞부분 길이
CACHE_V = 2         # 2: 작업 폴더 이름을 모으지 않는다(턴은 마지막 시각만 기억)

P_USER = b'"type":"user"'
P_ASST = b'"type":"assistant"'
P_TOOL_RESULT = b'"type":"tool_result"'
P_SIDECHAIN = b'"isSidechain":true'
# 문자열 안의 따옴표는 \" 로 적히므로 이 꼴은 구조(키)로만 맞는다
RE_TS = re.compile(rb'"timestamp":"([0-9][^"\\]{9,40})"')
# 사람이 친 글이 아닌 user 줄(명령 출력·! 셸·작업 알림·시스템 덧붙임)
RE_NOT_PROMPT = re.compile(r'\s*(?:<(?:command-|local-command-|bash-|task-notification|system-reminder|user-prompt-submit-hook)|\[Request interrupted)')


def parse_ts(s):
    """'2026-11-16T00:42:03.254Z' -> epoch 초(float). 못 읽으면 None."""
    try:
        if isinstance(s, (bytes, bytearray)): s = s.decode('ascii')
        if not isinstance(s, str): return None
        if len(s) >= 20 and s[4] == '-' and s[10] == 'T' and s[-1] == 'Z':
            base = calendar.timegm((int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19]), 0, 0, 0))
            frac = s[19:-1]
            return base + (float('0' + frac) if frac.startswith('.') and len(frac) > 1 else 0.0)
        from datetime import datetime
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


_day_memo = {}
def local_day(ts):
    # 지역 시각 날짜. 시간대 차는 분 단위라 분으로 묶어 기억해도 정확하다
    k = int(ts // 60)
    d = _day_memo.get(k)
    if d is None:
        if len(_day_memo) > 50000: _day_memo.clear()
        d = _day_memo[k] = time.strftime('%Y-%m-%d', time.localtime(ts))
    return d


def window(now):
    """오늘 포함 지역 시각 7날(오래된 날 -> 오늘)과 첫날 0시의 epoch."""
    lt = time.localtime(now)
    days = [time.strftime('%Y-%m-%d', time.localtime(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday - k, 12, 0, 0, 0, 0, -1))))
            for k in range(DAYS - 1, -1, -1)]
    start = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday - (DAYS - 1), 0, 0, 0, 0, 0, -1))
    return days, start


def is_prompt(o):
    """본 대화의 user 줄이 사람이 친 프롬프트인지. 도구 결과·isMeta·요약·명령 출력·작업 알림은 아니다."""
    if o.get('isMeta') or o.get('isSidechain') or o.get('isCompactSummary') or o.get('isVisibleInTranscriptOnly'):
        return False
    c = (o.get('message') or {}).get('content') if isinstance(o.get('message'), dict) else None
    text, image = '', False
    if isinstance(c, str):
        text = c
    elif isinstance(c, list):
        for x in c:
            if not isinstance(x, dict): continue
            t = x.get('type')
            if t == 'tool_result': return False
            if t == 'text' and isinstance(x.get('text'), str): text += x['text']
            elif t == 'image': image = True
    else:
        return False
    org = o.get('origin')
    if isinstance(org, dict):  # 2.1.3x 부터: human / peer / task-notification / auto-continuation …
        return org.get('kind') == 'human'
    to = o.get('turnOrigin')
    if isinstance(to, str) and to != 'human':
        return False
    if not text.strip() and not image:
        return False
    return not RE_NOT_PROMPT.match(text)


def fresh(main):
    return {'size': 0, 'mtime': 0, 'ino': 0, 'pos': 0, 'hl': 0, 'h': 0, 'done': False, 'main': main,
            'turn': None, 'ids': [], 'd': {}}


class Scan:
    """파일 하나의 상태(st)에 줄을 하나씩 먹인다. st['d'][날짜] = [초, 토큰, 턴], st['turn'] = 진행 중인 턴의 마지막 시각(없으면 None)"""

    def __init__(self, st, first_day):
        self.st, self.first = st, first_day

    def bucket(self, day):
        if day < self.first: return None  # 7날 밖(오래된 쪽)은 버린다
        b = self.st['d'].get(day)
        if b is None: b = self.st['d'][day] = [0.0, 0, 0]
        return b

    def tokens(self, o, day):
        m = o.get('message')
        if not isinstance(m, dict): return
        mid = m.get('id')
        if not isinstance(mid, str) or not mid: return  # <synthetic> 응답 등
        rid = o.get('requestId')
        key = mid + '|' + (rid if isinstance(rid, str) else '')
        ids = self.st['ids']
        if key in ids: return
        ids.append(key)
        if len(ids) > KEEP_IDS: del ids[:len(ids) - KEEP_IDS]
        u = m.get('usage')
        if not isinstance(u, dict): return
        n = 0
        for k in ('input_tokens', 'cache_creation_input_tokens', 'output_tokens'):  # cache_read 는 뺀다
            v = u.get(k)
            if isinstance(v, int) and v > 0: n += v
        b = self.bucket(day)
        if b is not None: b[1] += n

    def tick(self, ts, day):
        # 진행 중인 턴 안의 간격(뒤쪽 줄 날짜로)
        last = self.st['turn']
        if last is None: return
        g = ts - last
        if g <= 0: return  # 시각이 거꾸로 간 줄은 간격 0, 마지막 시각은 큰 쪽 유지
        self.st['turn'] = ts
        b = self.bucket(day)
        if b is not None: b[0] += min(g, GAP_CAP_S)

    def obj(self, o):
        if not isinstance(o, dict): return
        t = o.get('type')
        if t != 'user' and t != 'assistant': return
        main = self.st['main']
        if main and o.get('isSidechain') is True: return
        ts = parse_ts(o.get('timestamp'))
        if ts is None: return
        day = local_day(ts)
        if t == 'assistant':
            self.tokens(o, day)
        if not main: return  # 작업자 대화는 토큰만
        if t == 'user' and is_prompt(o):
            self.st['turn'] = ts
            b = self.bucket(day)
            if b is not None: b[2] += 1
        else:
            self.tick(ts, day)

    def small(self, line):
        main = self.st['main']
        if P_ASST not in line and (not main or P_USER not in line): return
        try: o = json.loads(line)
        except ValueError: return
        self.obj(o)

    def big(self, line):
        has_asst = P_ASST in line
        if not self.st['main']:
            if has_asst: self._load(line)
            return
        has_user = P_USER in line
        if has_user and not has_asst and P_TOOL_RESULT in line and P_SIDECHAIN not in line:
            # 흔한 경우: 큰 도구 결과 줄. 턴이 아니고 시각만 쓴다. 시각 칸이 하나뿐일 때만 믿는다
            found = None
            for i, m in enumerate(RE_TS.finditer(line)):
                if i: found = None; break
                found = m.group(1)
            ts = parse_ts(found) if found else None
            if ts is not None:
                self.tick(ts, local_day(ts))
                return
        if has_user or has_asst:
            self._load(line)

    def _load(self, line):
        try: o = json.loads(line)
        except ValueError: return
        self.obj(o)


def scan_file(path, st, first_day, deadline, prog):
    """st 를 이어서 채운다. 끝까지(완전한 마지막 줄까지) 읽었으면 True, 시간이 다 돼 멈췄으면 False."""
    # mmap 은 쪽 부재가 잦아 여기선 버퍼 읽기보다 몇 배 느렸다(실측 2.8GB: 7.8초 대 1.2초)
    with open(path, 'rb', buffering=1 << 20) as f:
        fs = os.fstat(f.fileno())
        size = fs.st_size
        # 다른 파일로 바뀌었거나 작아졌으면 처음부터
        if st['pos'] and (st['ino'] != fs.st_ino or size < st['pos'] or size < st['hl']
                          or fs.st_mtime < st['mtime'] or zlib.crc32(f.read(st['hl'])) != st['h']):
            st.clear(); st.update(fresh(st_main(path)))
        if st['pos'] == 0:
            f.seek(0); st['hl'] = min(HEAD, size); st['h'] = zlib.crc32(f.read(st['hl']))
        st.update(size=size, mtime=fs.st_mtime, ino=fs.st_ino, done=False)
        sc = Scan(st, first_day)
        pos = st['pos']
        f.seek(pos)
        for line in f:
            if prog[0] and time.monotonic() >= deadline:
                return False
            if line[-1:] != b'\n': break  # 아직 쓰는 중인 마지막 줄은 다음에
            n = len(line)
            if n > BIG: sc.big(line)
            elif n > 2: sc.small(line)
            pos += n
            st['pos'] = pos
            prog[0] = True
        st['done'] = True
        return True


def st_main(path):
    return os.path.basename(os.path.dirname(path)) != 'subagents'


def list_files(root):
    """(경로, 본 대화인지, stat). <root>/<폴더>/<uuid>.jsonl 과 <root>/<폴더>/<uuid>/subagents/agent-*.jsonl 만."""
    out = []
    try: tops = list(os.scandir(root))
    except OSError: return out
    for top in tops:
        try:
            if not top.is_dir(): continue
            ents = list(os.scandir(top.path))
        except OSError:
            continue
        for e in ents:
            try:
                if e.name.endswith('.jsonl') and e.is_file():
                    out.append((e.path, True, e.stat()))
                elif e.is_dir():
                    sub = os.path.join(e.path, 'subagents')
                    if not os.path.isdir(sub): continue
                    for g in os.scandir(sub):
                        if g.name.startswith('agent-') and g.name.endswith('.jsonl') and g.is_file():
                            out.append((g.path, False, g.stat()))
            except OSError:
                continue
    return out


def load_cache(path):
    try:
        with open(path, encoding='utf-8') as f: c = json.load(f)
        if isinstance(c, dict) and c.get('v') == CACHE_V and isinstance(c.get('files'), dict): return c['files']
    except Exception:
        pass
    return {}


def save_cache(path, files):
    tmp = '%s.%d.tmp' % (path, os.getpid())
    try:
        os.makedirs(os.path.dirname(path) or '.', mode=0o700, exist_ok=True)  # 새로 만드는 폴더만 0700
        # 경로에 작업 폴더 이름이 들어 있어 나만 읽게 0600 으로 만든다(os.replace 가 이 권한을 그대로 옮긴다)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        if hasattr(os, 'fchmod'): os.fchmod(fd, 0o600)  # 남아 있던 같은 이름의 파일이 있어도(윈도의 옛 파이썬에는 fchmod 가 없다)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'v': CACHE_V, 'files': files}, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, path)  # 반쯤 쓴 캐시가 남지 않게. 여러 패널이 동시에 써도 마지막 것이 온전히 남는다
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass


def valid_state(st, main):
    return (isinstance(st, dict) and st.get('main') == main and isinstance(st.get('d'), dict)
            and isinstance(st.get('ids'), list) and isinstance(st.get('pos'), int)
            and all(k in st for k in ('size', 'mtime', 'ino', 'hl', 'h', 'done', 'turn'))
            and (st['turn'] is None or isinstance(st['turn'], (int, float)))
            and all(isinstance(b, list) and len(b) == 3 for b in st['d'].values()))


def run(root, cache_path, now, budget=BUDGET_S):
    deadline = time.monotonic() + budget
    days, start = window(now)
    old = load_cache(cache_path)
    files, partial, dirty = {}, False, False
    prog = [False]  # 한 번에 적어도 한 줄은 읽어 예산 0 에서도 앞으로 간다
    found = list_files(root)
    found.sort(key=lambda x: -x[2].st_mtime)  # 최근 파일부터
    seen = set()
    for path, main, s in found:
        seen.add(path)
        if s.st_mtime < start:
            dirty |= path in old  # 7날보다 오래된 파일은 열지 않는다
            continue
        st = old.get(path)
        if not valid_state(st, main):
            st, dirty = fresh(main), True
        # 윈도의 scandir stat 은 st_ino 가 늘 0 이라 그때는 크기·시각만 본다(맥·리눅스는 그대로)
        if st['done'] and st['size'] == s.st_size and st['mtime'] == s.st_mtime and (st['ino'] == s.st_ino or not s.st_ino):
            files[path] = st
            continue
        if prog[0] and time.monotonic() >= deadline:
            partial = True
            if st['pos'] or st['d']: files[path] = st
            continue
        try:
            done = scan_file(path, st, days[0], deadline, prog)
        except OSError:
            dirty = True
            continue
        dirty = True
        files[path] = st
        if not done: partial = True
    dirty |= any(p not in seen for p in old)  # 지워진 파일은 버린다
    # 7날 밖으로 밀려난 날짜는 버린다
    for st in files.values():
        for d in [d for d in st['d'] if d < days[0]]:
            del st['d'][d]; dirty = True
    if dirty: save_cache(cache_path, files)
    return summarize(files, days, partial)


def summarize(files, days, partial):
    per = {d: [0.0, 0, 0] for d in days}
    for st in files.values():
        for d, b in st['d'].items():
            if d not in per: continue
            p = per[d]; p[0] += b[0]; p[1] += b[1]; p[2] += b[2]
    out_days = [{'date': d, 'secs': int(round(per[d][0])), 'tokens': per[d][1], 'turns': per[d][2]} for d in days]
    return {'partial': partial, 'days': out_days,
            'total': {'secs': sum(x['secs'] for x in out_days), 'tokens': sum(x['tokens'] for x in out_days),
                      'turns': sum(x['turns'] for x in out_days)}}


def config_dir():
    # Claude Code 의 설정 폴더. CLAUDE_CONFIG_DIR 로 옮겼으면 대화 기록(projects/)도 그 아래에 있다
    return os.path.expanduser(os.environ.get('CLAUDE_CONFIG_DIR') or '~/.claude')


def env_now():
    try: return float(os.environ['STATUS_PANEL_NOW'])
    except (KeyError, ValueError): return time.time()


def main():
    now = env_now()
    try:
        root = os.environ.get('STATUS_PANEL_PROJECTS') or os.path.join(config_dir(), 'projects')
        cache = os.environ.get('STATUS_PANEL_CACHE') or os.path.expanduser('~/.cache/status-panel/week.json')
        try: budget = float(os.environ.get('STATUS_PANEL_BUDGET', BUDGET_S))
        except ValueError: budget = BUDGET_S
        res = run(root, cache, now, budget)
    except Exception:
        res = {'error': 'internal'}
    line = json.dumps(dict({'at': int(now)}, **res), ensure_ascii=False, separators=(',', ':'))
    try:
        sys.stdout.write(line + '\n'); sys.stdout.flush()
    except (BrokenPipeError, OSError):
        pass


if __name__ == '__main__':
    main()
