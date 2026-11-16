#!/usr/bin/env python3
"""Snapshot of running `codex exec` and Antigravity CLI (`agy -p`) jobs and this machine's memory, as one JSON line
(read by the status-panel pane). macOS reads ps, lsof, memory_pressure and sysctl; Linux and Windows go through hostos.py."""
import json, os, re, shlex, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hostos  # noqa: E402
from hostos import IS_MAC, IS_WIN, etime_s, sh  # noqa: E402,F401

def label_of(out, cwd):
    # reports/2026-10-24_데이터_정리_1차/보고.md -> 데이터 정리 1차 ; .../홍보_영상_시안/보고_오프닝.md -> 홍보 영상 시안 · 오프닝
    if not out: return os.path.basename(cwd or '') or 'codex'
    parent, name = os.path.basename(os.path.dirname(out)), os.path.splitext(os.path.basename(out))[0]
    base = parent if name in ('보고', 'report') and parent not in ('reports', '') else name
    base = re.sub(r'^\d{4}-\d{2}-\d{2}_', '', base).replace('_', ' ')
    if parent and base == name and parent not in ('reports', '') and not re.match(r'^\d{4}', parent):
        base = parent.replace('_', ' ') + ' · ' + re.sub(r'^보고_?', '', name)
    return base.strip(' ·') or 'codex'

def parse(argv):
    a = {'model': '', 'effort': '', 'out': '', 'cwd': ''}
    for i, x in enumerate(argv):
        if x == '--': break  # 그 뒤는 프롬프트: 긴 프롬프트 속 낱말을 옵션으로 읽지 않는다
        nx = argv[i + 1] if i + 1 < len(argv) else ''
        if x == '-m': a['model'] = nx
        elif x == '-o': a['out'] = nx
        elif x == '-C': a['cwd'] = nx
        elif x == '-c' and nx.startswith('model_reasoning_effort='): a['effort'] = nx.split('=', 1)[1].strip('"')
    return a

def tail_lines(path, n=6):
    """로그의 마지막 n줄(잡음 줄·제어 문자 제외, 줄마다 120자까지). 맨 끝 줄이 가장 최근."""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 16000)); txt = f.read(16000).decode('utf-8', 'ignore')
    except Exception: return []
    got = []
    for ln in reversed(txt.splitlines()):
        s = ln.strip()
        if not s or s.startswith(('hook:', 'collab:', '[', '{', '}')) or 'ERROR codex_models_manager' in s: continue
        # OSC 는 BEL 또는 ESC \ 에서 끝나고, 다음 ESC 를 넘어 이어 읽지 않는다
        s = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x1f\x7f-\x9f]', '', s)
        s = re.sub(r'\s+', ' ', s)[:120]
        if s: got.append(s)
        if len(got) >= n: break
    return got[::-1]

def fd_path(pid, fd):
    # -n -P: 이름·포트를 풀어 쓰려고 기다리지 않는다
    out = sh(['lsof', '-n', '-P', '-a', '-p', str(pid), '-d', fd, '-Fn'])
    for ln in out.splitlines():
        if ln.startswith('n/'): return ln[1:]
    return ''

# 맥은 lsof. 리눅스(WSL 포함)는 /proc/<pid>/fd/1·cwd 를 바로 읽는다(lsof 가 없어도 된다).
# 윈도는 다른 프로세스의 표준 출력·작업 폴더를 알 길이 없어 비워 둔다(로그는 -o·--log-file 로 받은 경로만)
def log_of(pid):
    if IS_MAC: return fd_path(pid, '1')
    return '' if IS_WIN else hostos.proc_log(pid)
def cwd_of(pid):
    if IS_MAC: return fd_path(pid, 'cwd')
    return '' if IS_WIN else hostos.proc_link(pid, 'cwd')

def mtime(path):
    try: return os.path.getmtime(path) if path else 0
    except OSError: return 0  # 그 사이에 지워진 로그

now = time.time(); jobs, waiting = [], []

def one(pid, el, rss, cmd):
    # `codex exec …` 뿐 아니라 `codex --search exec …` 처럼 exec 앞에 전역 옵션이 붙은 실행도 잡는다(2026-11-06, 웹 검색 조사가 진행판에서 빠졌던 것)
    if re.match(r'^(\S*/)?codex(\s+--?[\w-]+(=\S+)?)*\s+exec(\s|$)', cmd):
        try: argv = shlex.split(cmd[:4000])
        except ValueError: argv = cmd.split()
        a = parse(argv); log = log_of(pid); mt = mtime(log)
        cwd = a['cwd'] or cwd_of(pid)  # -C 가 없으면 프로세스의 작업 폴더
        out_abs = (a['out'] if os.path.isabs(a['out']) else os.path.join(cwd or '', a['out'])) if a['out'] else ''
        tl = tail_lines(log) if log else []
        jobs.append({'pid': pid, 'tool': 'codex', 'label': label_of(a['out'], cwd), 'project': os.path.basename(cwd.rstrip('/' + os.sep)),
                     'model': a['model'], 'effort': a['effort'], 'elapsed': el, 'rssMB': rss // 1024,
                     'idle': int(now - mt) if mt else None, 'last': tl[-1] if tl else '', 'tail': tl, 'out': out_abs})
    elif re.match(r'^(\S*/)?agy\s', cmd) and re.search(r'\s(-p|--print|--prompt)\s', cmd):
        try: argv = shlex.split(cmd[:4000])
        except ValueError: argv = cmd.split()
        model = log = cwd = ''
        for i, x in enumerate(argv):
            if x == '--': break
            nx = argv[i + 1] if i + 1 < len(argv) else ''
            if x == '--model': model = nx
            elif x == '--log-file': log = nx
            elif x == '--add-dir': cwd = nx
        cwd = cwd or cwd_of(pid)
        mt = mtime(log)
        label = re.sub(r'^\d{4}-\d{2}-\d{2}_', '', os.path.splitext(os.path.basename(log))[0]).replace('_', ' ') if log else 'agy'
        tl = tail_lines(log) if log else []
        jobs.append({'pid': pid, 'tool': 'argon', 'label': label, 'project': os.path.basename(cwd.rstrip('/' + os.sep)),
                     'model': model, 'effort': '', 'elapsed': el, 'rssMB': rss // 1024,
                     'idle': int(now - mt) if mt else None, 'last': tl[-1] if tl else '', 'tail': tl, 'out': log})
    elif re.match(r'^(\S*/)?agy(\s|$)', cmd):
        # interactive agy started by hand in a terminal: no prompt flag, no log file.
        # label 은 코드 값이고 진행판(hooks/i18n.ts ARGON_TTY)이 언어에 맞는 글자로 옮긴다
        cwd = cwd_of(pid)
        jobs.append({'pid': pid, 'tool': 'argon', 'label': 'argon:interactive', 'project': os.path.basename(cwd.rstrip('/' + os.sep)),
                     'model': '', 'effort': '', 'elapsed': el, 'rssMB': rss // 1024,
                     'idle': None, 'last': '', 'tail': [], 'out': ''})
    elif cmd.startswith('bash -c while kill -0') and ('codex exec' in cmd or 'agy ' in cmd):
        outs = re.findall(r'-o (\S+)', cmd)
        waiting.append({'pid': pid, 'labels': [label_of(o, '') for o in outs], 'elapsed': el})

def mac_mem():
    mem = {}
    mp = sh(['memory_pressure'], 3); m = re.search(r'free percentage: (\d+)%', mp); mem['freePct'] = int(m[1]) if m else None
    sw = sh(['sysctl', '-n', 'vm.swapusage']); m = re.search(r'total = ([\d.]+)M\s+used = ([\d.]+)M', sw)
    if m: mem['swapUsedGB'], mem['swapTotalGB'] = round(float(m[2]) / 1024, 1), round(float(m[1]) / 1024, 1)
    la = sh(['sysctl', '-n', 'vm.loadavg']).split(); mem['load'] = float(la[1]) if len(la) > 1 else None
    mem['cpus'] = os.cpu_count()
    return mem

def collect(rows):
    """rows: [(pid, ppid, elapsed_s, rss_kb, command)] from hostos.read_procs -> fills jobs and waiting"""
    for pid, ppid, el, rss, cmd in rows:
        # 프로세스 하나가 이상해도(사이에 끝남·지워진 로그·못 읽는 명령 줄) 나머지는 그대로 적는다
        try: one(pid, el, rss, cmd)
        except Exception: pass
    if IS_WIN:
        # 윈도에서는 `node …\codex.js exec` 와 그것이 띄운 `codex.exe exec` 가 둘 다 같은 작업으로 보여 바깥 것만 남긴다
        keep = hostos.outermost(rows, {j['pid'] for j in jobs})
        jobs[:] = [j for j in jobs if j['pid'] in keep]

def main():
    collect(hostos.read_procs())
    mem = mac_mem() if IS_MAC else hostos.read_mem()
    snap = {'at': int(now), 'jobs': jobs, 'waiting': waiting, 'mem': mem}
    hostos.utf8_stdout()
    print(json.dumps(snap, ensure_ascii=False))

if __name__ == '__main__':
    main()
