"""Tests for hooks/week.py (run: python3 -I tests/week_test.py)."""
import importlib.util, io, json, os, shutil, stat, subprocess, sys, tempfile, time, unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
WEEK = os.path.join(HERE, '..', 'hooks', 'week.py')

# 날짜 경계를 정해 두려고 서머타임 없는 시간대로(+09:00)
os.environ['TZ'] = 'Asia/Seoul'
if hasattr(time, 'tzset'): time.tzset()  # 윈도에는 없다: 그 시스템의 시간대로(GitHub 러너는 UTC, 서머타임 없음)

spec = importlib.util.spec_from_file_location('week', WEEK)
week = importlib.util.module_from_spec(spec)
spec.loader.exec_module(week)

# 지금 = 2026-11-16 12:00 (+09:00). 7날 = 11-10 … 11-16
NOW = time.mktime((2026, 11, 16, 12, 0, 0, 0, 0, -1))


def at(day, hh, mm=0, ss=0):
    """2026-11-<day> hh:mm:ss 지역 시각 -> epoch"""
    return time.mktime((2026, 11, day, hh, mm, ss, 0, 0, -1))


def iso(ts):
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(ts)) + '.%03dZ' % int(round((ts % 1) * 1000))


def prompt(ts, cwd='/work/alpha', text='hello', **kw):
    o = {'parentUuid': None, 'isSidechain': False, 'type': 'user', 'message': {'role': 'user', 'content': text},
         'timestamp': iso(ts), 'cwd': cwd, 'origin': {'kind': 'human'}}
    o.update(kw)
    return o


def old_prompt(ts, text, cwd='/work/alpha', **kw):
    # origin 칸이 없던 옛 판의 user 줄
    o = {'parentUuid': None, 'isSidechain': False, 'type': 'user', 'message': {'role': 'user', 'content': text},
         'timestamp': iso(ts), 'cwd': cwd}
    o.update(kw)
    return o


def tool_result(ts, body='ok', side=False):
    return {'parentUuid': 'p', 'isSidechain': side, 'type': 'user',
            'message': {'role': 'user', 'content': [{'tool_use_id': 't1', 'type': 'tool_result', 'content': body}]},
            'timestamp': iso(ts), 'toolUseResult': {'stdout': body}, 'cwd': '/work/alpha'}


def asst(ts, mid='msg_1', rid='req_1', inp=1, cc=0, cr=0, out=0, side=False):
    return {'parentUuid': 'p', 'isSidechain': side, 'type': 'assistant', 'requestId': rid,
            'message': {'id': mid, 'type': 'message', 'role': 'assistant', 'content': [{'type': 'text', 'text': 'x'}],
                        'usage': {'input_tokens': inp, 'cache_creation_input_tokens': cc, 'cache_read_input_tokens': cr,
                                  'output_tokens': out}},
            'timestamp': iso(ts), 'cwd': '/work/alpha'}


def lines(objs):
    # Claude Code 처럼 빈칸 없는 JSON 으로 적는다(빠른 거르기가 '"type":"user"' 꼴을 찾는다)
    return ''.join((o if isinstance(o, str) else json.dumps(o, separators=(',', ':'))) + '\n' for o in objs)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, 'projects')
        self.proj = os.path.join(self.root, '-work-alpha')
        os.makedirs(self.proj)
        self.cache = os.path.join(self.tmp, 'cache', 'week.json')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def main_file(self, objs, sid='s1', mode='w'):
        p = os.path.join(self.proj, sid + '.jsonl')
        with open(p, mode, encoding='utf-8') as f: f.write(lines(objs) if not isinstance(objs, str) else objs)
        self.touch(p)
        return p

    def sub_file(self, objs, sid='s1', aid='a1'):
        d = os.path.join(self.proj, sid, 'subagents')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, 'agent-%s.jsonl' % aid)
        with open(p, 'w', encoding='utf-8') as f: f.write(lines(objs))
        self.touch(p)
        return p

    def touch(self, p, ts=None):
        # 파일 시각은 '지금' 무렵으로(7날 안). 같은 크기로 다시 쓴 경우를 가려내려고 조금씩 다르게
        ts = ts if ts is not None else NOW - 60 + (time.time() % 1)
        os.utime(p, (ts, ts))

    def run_(self, cache=None, budget=60):
        return week.run(self.root, cache or self.cache, NOW, budget)

    def day(self, res, d):
        return next(x for x in res['days'] if x['date'] == '2026-11-%02d' % d)


class Tokens(Base):
    def test_dedupe_cache_read_and_subagents(self):
        self.main_file([
            prompt(at(16, 9)),
            asst(at(16, 9, 0, 5), 'm1', 'r1', inp=10, cc=100, cr=5000, out=7),
            asst(at(16, 9, 0, 6), 'm1', 'r1', inp=10, cc=100, cr=5000, out=7),  # 같은 응답 되풀이
            asst(at(16, 9, 0, 7), 'm1', 'r1', inp=10, cc=100, cr=5000, out=7),
            asst(at(16, 9, 0, 9), 'm2', 'r2', inp=1, cc=2, cr=9999, out=3),
        ])
        self.sub_file([
            {'type': 'user', 'isSidechain': True, 'message': {'role': 'user', 'content': 'task'}, 'timestamp': iso(at(16, 9, 1))},
            asst(at(16, 9, 2), 'm3', 'r3', inp=1000, cc=0, cr=1, out=1, side=True),
            asst(at(16, 9, 2), 'm3', 'r3', inp=1000, cc=0, cr=1, out=1, side=True),
        ])
        r = self.run_()
        self.assertEqual(self.day(r, 16)['tokens'], 117 + 6 + 1001)
        self.assertEqual(r['total']['tokens'], 1124)
        self.assertFalse(r['partial'])


class TurnsAndTime(Base):
    def test_turns_gaps_and_cap(self):
        t0 = at(16, 10)
        self.main_file([
            {'type': 'file-history-snapshot', 'snapshot': {}},
            prompt(t0),
            asst(t0 + 10, 'm1', 'r1'),
            tool_result(t0 + 20),                                   # 턴 아님
            dict(old_prompt(t0 + 25, 'skill text'), isMeta=True),   # isMeta 는 턴 아님
            prompt(t0 + 26, origin={'kind': 'task-notification'}),  # 작업 알림
            old_prompt(t0 + 27, '<command-name>/model</command-name>'),
            old_prompt(t0 + 28, '<local-command-stdout>x</local-command-stdout>'),
            old_prompt(t0 + 29, '[Request interrupted by user]'),
            asst(t0 + 529, 'm2', 'r2'),                             # 500초 빈틈 -> 180
        ])
        # 작업자 대화의 시간은 안 센다
        self.sub_file([asst(at(16, 10, 30), 'm9', 'r9', side=True), asst(at(16, 11, 30), 'm10', 'r10', side=True)])
        r = self.run_()
        d = self.day(r, 16)
        self.assertEqual(d['turns'], 1)
        self.assertEqual(d['secs'], 29 + 180)

    def test_old_format_prompt_counts(self):
        t0 = at(15, 8)
        self.main_file([old_prompt(t0, 'plain text from an older version'), asst(t0 + 30, 'm1', 'r1'),
                        old_prompt(t0 + 100, 'second'), asst(t0 + 110, 'm2', 'r2')])
        r = self.run_()
        self.assertEqual(self.day(r, 15)['turns'], 2)
        self.assertEqual(self.day(r, 15)['secs'], 40)

    def test_idle_between_turns_not_counted(self):
        t0 = at(14, 8)
        self.main_file([prompt(t0), asst(t0 + 60, 'm1', 'r1'), prompt(t0 + 3600), asst(t0 + 3610, 'm2', 'r2')])
        self.assertEqual(self.day(self.run_(), 14)['secs'], 70)

    def test_big_lines(self):
        t0 = at(16, 9)
        big = 'y' * (week.BIG + 10)
        self.main_file([
            prompt(t0, text='paste ' + big),                         # 큰 사람 프롬프트 -> json 으로
            tool_result(t0 + 50, body=big),                          # 큰 도구 결과 -> 시각만
            asst(t0 + 60, 'm1', 'r1', inp=5, out=5),
        ] + [dict(asst(t0 + 70, 'm2', 'r2', inp=7), message=dict(asst(0, 'm2', 'r2', inp=7)['message'],
                                                                 content=[{'type': 'text', 'text': big}]))])  # 큰 응답 줄
        r = self.run_()
        d = self.day(r, 16)
        self.assertEqual((d['turns'], d['secs'], d['tokens']), (1, 70, 17))


class Days(Base):
    def test_keeps_no_folder_names_or_text(self):
        # 작업 폴더 이름과 대화 글자는 출력에도 캐시에도 남지 않는다(화면이 쓰지 않는다)
        objs = []
        for i, name in enumerate(['a', 'b', 'c', 'd', 'e', 'f']):
            t = at(16, 1 + i)
            objs += [prompt(t, cwd='/x/secret-' + name + '/', text='private words %d' % i), asst(t + 10 * (i + 1), 'm%d' % i, 'r%d' % i)]
        self.main_file(objs)
        r = self.run_()
        self.assertEqual(r['total']['secs'], 210)
        self.assertEqual(set(r), {'partial', 'days', 'total'})
        with open(self.cache, encoding='utf-8') as f: kept = f.read()
        for s in (kept, json.dumps(r)):
            self.assertNotIn('secret-', s)
            self.assertNotIn('private words', s)

    def test_midnight_split_and_window(self):
        t0 = at(14, 23, 58)
        self.main_file([
            prompt(at(8, 10)), asst(at(8, 10, 1), 'm0', 'r0', inp=99),   # 7날 밖
            prompt(t0), asst(t0 + 90, 'm1', 'r1'), asst(t0 + 180, 'm2', 'r2'),  # 23:59:30 / 00:01:00
        ])
        r = self.run_()
        self.assertEqual([x['date'] for x in r['days']], ['2026-11-%02d' % d for d in range(10, 17)])
        self.assertEqual((self.day(r, 14)['secs'], self.day(r, 14)['turns']), (90, 1))
        self.assertEqual((self.day(r, 15)['secs'], self.day(r, 15)['turns']), (90, 0))
        self.assertEqual(r['total']['tokens'], 2)
        self.assertEqual(r['total']['turns'], 1)

    def test_old_file_not_opened(self):
        p = self.main_file([prompt(at(16, 9)), asst(at(16, 9, 1), 'm1', 'r1')])
        self.touch(p, at(1, 0))  # 파일 시각이 7날보다 오래됨 -> 내용과 상관없이 안 연다
        self.assertEqual(self.run_()['total'], {'secs': 0, 'tokens': 0, 'turns': 0})


def session(t0):
    return [
        prompt(t0, cwd='/w/alpha'), asst(t0 + 5, 'm1', 'r1', inp=3, cc=4, out=5), asst(t0 + 5, 'm1', 'r1', inp=3, cc=4, out=5),
        tool_result(t0 + 40), asst(t0 + 400, 'm2', 'r2', inp=1),
        prompt(t0 + 1000, cwd='/w/beta'), asst(t0 + 1010, 'm3', 'r3', out=8), asst(t0 + 1010, 'm3', 'r3', out=8),
        tool_result(t0 + 1020), dict(old_prompt(t0 + 1021, 'meta'), isMeta=True),
        asst(t0 + 1100, 'm4', 'r4', out=2), prompt(t0 + 5000, cwd='/w/alpha'), asst(t0 + 5020, 'm5', 'r5', cc=11),
    ]


class Resume(Base):
    def full(self):
        c = os.path.join(self.tmp, 'fresh.json')
        if os.path.exists(c): os.unlink(c)
        return self.run_(cache=c)

    def test_append_equals_full(self):
        objs = session(at(15, 23, 30))
        sub = [asst(at(16, 0, 10), 's1', 'q1', inp=50, side=True), asst(at(16, 0, 10), 's1', 'q1', inp=50, side=True),
               asst(at(16, 0, 20), 's2', 'q2', out=9, side=True)]
        text = lines(objs)
        cut = text.index('\n', len(text) // 2) + 1
        # 앞 절반 + 다음 줄의 반쪽(줄바꿈 없음) 상태에서 한 번
        p = self.main_file(text[:cut] + text[cut:cut + 30])
        self.sub_file(sub[:1], aid='z')
        self.run_()
        # 나머지 덧붙이기(되풀이 응답이 경계에 걸치도록)
        with open(p, 'a', encoding='utf-8') as f: f.write(text[cut + 30:])
        self.touch(p)
        self.sub_file(sub, aid='z')
        r1 = self.run_()
        r2 = self.full()
        self.assertEqual(r1, r2)
        self.assertGreater(r2['total']['secs'], 0)

    def test_budget_zero_partial_then_finish(self):
        self.main_file(session(at(16, 1)))
        self.sub_file([asst(at(16, 1, 5), 's1', 'q1', inp=50, side=True)])
        ref = self.full()
        r = self.run_(budget=0)
        self.assertTrue(r['partial'])
        n = 1
        while r['partial']:
            r = self.run_(budget=0); n += 1
            self.assertLess(n, 100)
        self.assertEqual(r, ref)
        self.assertGreater(n, 5)  # 한 줄씩 이어 읽었다
        r = self.run_(budget=0)   # 끝난 뒤엔 바뀐 것이 없어 바로 같은 값
        self.assertEqual(r, ref)

    def test_rewritten_or_deleted_file_restarts(self):
        p = self.main_file(session(at(16, 1)))
        self.run_()
        # 같은 이름으로 짧은 다른 내용
        self.main_file([prompt(at(16, 2), cwd='/w/gamma'), asst(at(16, 2, 0, 9), 'mx', 'rx', inp=1)])
        r = self.run_()
        self.assertEqual(r, self.full())
        self.assertEqual(r['total'], {'secs': 9, 'tokens': 1, 'turns': 1})
        os.unlink(p)
        self.assertEqual(self.run_()['total'], {'secs': 0, 'tokens': 0, 'turns': 0})

    @unittest.skipIf(os.name == 'nt', '윈도에는 유닉스 권한 비트가 없다')
    def test_cache_file_mode(self):
        # 캐시는 나만 읽는다: 파일 0600, 새로 만든 폴더 0700
        self.main_file(session(at(16, 1)))
        self.run_()
        self.assertEqual(stat.S_IMODE(os.stat(self.cache).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(self.cache)).st_mode), 0o700)

    def test_corrupt_cache(self):
        self.main_file(session(at(16, 1)))
        os.makedirs(os.path.dirname(self.cache))
        with open(self.cache, 'w') as f: f.write('{"v":1,"files":{"x":')
        self.assertEqual(self.run_(), self.full())
        with open(self.cache, encoding='utf-8') as f: json.load(f)  # 다시 온전한 캐시
        self.assertEqual([n for n in os.listdir(os.path.dirname(self.cache))], ['week.json'])


class Robust(Base):
    def test_broken_lines(self):
        self.main_file('not json\n{"type":"user",\n\n{"type":"assistant","message":5,"timestamp":"x"}\n'
                       '{"type":"user","timestamp":"2026-11-16T00:00:00Z","message":{"content":[1,null]}}\n[]\n')
        r = self.run_()
        self.assertNotIn('error', r)
        self.assertEqual(r['total'], {'secs': 0, 'tokens': 0, 'turns': 0})

    def test_empty_and_missing(self):
        open(os.path.join(self.proj, 'empty.jsonl'), 'w').close()
        r = self.run_()
        self.assertEqual((r['total'], len(r['days'])), ({'secs': 0, 'tokens': 0, 'turns': 0}, 7))
        r = week.run(os.path.join(self.tmp, 'nope'), self.cache, NOW, 6)
        self.assertEqual(r['total'], {'secs': 0, 'tokens': 0, 'turns': 0})

    def test_cli_one_line(self):
        self.main_file(session(at(16, 1)))
        env = dict(os.environ, STATUS_PANEL_PROJECTS=self.root, STATUS_PANEL_CACHE=self.cache, STATUS_PANEL_NOW=str(NOW))
        out = subprocess.run([sys.executable, '-I', WEEK], env=env, capture_output=True, text=True, timeout=30).stdout
        self.assertEqual(out.count('\n'), 1)
        o = json.loads(out)
        self.assertEqual(o['at'], int(NOW))
        self.assertEqual(set(o), {'at', 'partial', 'days', 'total'})
        self.assertGreater(o['total']['turns'], 0)

    def test_cli_reads_claude_config_dir(self):
        # STATUS_PANEL_PROJECTS 가 없으면 CLAUDE_CONFIG_DIR 아래 projects/ 를 읽는다(설정 폴더를 옮긴 사람)
        self.main_file(session(at(16, 1)))
        env = {k: v for k, v in os.environ.items() if k != 'STATUS_PANEL_PROJECTS'}
        env.update(CLAUDE_CONFIG_DIR=self.tmp, STATUS_PANEL_CACHE=self.cache, STATUS_PANEL_NOW=str(NOW))
        out = subprocess.run([sys.executable, '-I', WEEK], env=env, capture_output=True, text=True, timeout=30).stdout
        self.assertGreater(json.loads(out)['total']['turns'], 0)

    def test_error_is_one_line(self):
        orig = week.run
        week.run = lambda *a, **k: 1 / 0
        try:
            buf = io.StringIO()
            with redirect_stdout(buf): week.main()
        finally:
            week.run = orig
        out = buf.getvalue()
        self.assertEqual(out.count('\n'), 1)
        self.assertEqual(set(json.loads(out)), {'at', 'error'})


if __name__ == '__main__':
    unittest.main(verbosity=1)
