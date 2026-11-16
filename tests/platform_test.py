"""Tests for the macOS / Linux / Windows parts of the Python helpers (run: python3 -I -B tests/platform_test.py).
Every parser is fed recorded or made-up text, so the Linux and Windows cases run on any OS; a few tests at the end also
ask this machine for real (hostos.py proc of this process, power, memory) and only check the shape of the answer.
No network and no real `codex`: codex_usage.py is pointed at a small Python script that plays `codex app-server`."""
import base64, importlib.util, json, os, shutil, stat, subprocess, sys, tempfile, textwrap, time, unittest
import warnings
warnings.simplefilter('ignore', ResourceWarning)  # 가짜 서버의 파이프: 스크립트는 바로 끝나서 실제로는 상관없다

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(HERE, '..', 'hooks')
sys.path.insert(0, HOOKS)  # collect.py 가 hostos 를 이름으로 읽는다


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HOOKS, name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


hostos = load('hostos')
sys.modules['hostos'] = hostos
collect = load('collect')
usage = load('codex_usage')

NOW = 1_800_000_000  # 2027-01-15 08:00:00 UTC


class Etime(unittest.TestCase):
    def test_round_trip(self):
        for s in (0, 5, 59, 60, 3599, 3600, 86399, 86400, 90061, 10 * 86400 + 5):
            self.assertEqual(hostos.etime_s(hostos.etime_of(s)), s)
        self.assertEqual(hostos.etime_of(65), '01:05')
        self.assertEqual(hostos.etime_of(3725), '01:02:05')
        self.assertEqual(hostos.etime_of(90061), '1-01:01:01')
        self.assertEqual(hostos.etime_of(-3), '00:00')

    def test_parse_ps_mac(self):
        out = ('  501   1    1-02:03:04  20480 /opt/homebrew/bin/codex exec -m gpt -o /tmp/r.md hi\n'
               ' 7777 501      00:09   1024 agy -p hello --log-file /tmp/a.log\n'
               'garbage\n 12 1 xx:yy 5 bad etime\n')
        self.assertEqual(hostos.parse_ps(out), [
            (501, 1, 93784, 20480, '/opt/homebrew/bin/codex exec -m gpt -o /tmp/r.md hi'),
            (7777, 501, 9, 1024, 'agy -p hello --log-file /tmp/a.log')])


class Linux(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_parse_proc_stat_odd_name(self):
        # 이름에 빈칸·괄호가 있어도 마지막 ')' 뒤부터 센다. 필드 4 = ppid, 22 = 시작(틱), 24 = rss(쪽)
        rest = ['S', '42'] + [str(i) for i in range(5, 22)] + ['12345', '999', '256'] + ['0'] * 20
        text = '1234 (we ird) (name) ' + ' '.join(rest)
        self.assertEqual(hostos.parse_proc_stat(text), (42, 12345, 256))

    def test_parse_cmdline(self):
        self.assertEqual(hostos.parse_cmdline(b'codex\0exec\0-o\0/tmp/a b.md\0hi there\0'), 'codex exec -o /tmp/a b.md hi there')
        self.assertEqual(hostos.parse_cmdline(b''), '')
        self.assertEqual(hostos.parse_cmdline(b'\0'), '')

    def fake_proc(self, pid, cmd, ppid=1, start=50_000, rss=2560):
        d = os.path.join(self.tmp, str(pid))
        os.makedirs(d)
        rest = ['S', str(ppid)] + ['0'] * 17 + [str(start), '0', str(rss)] + ['0'] * 10
        with open(os.path.join(d, 'stat'), 'w') as f: f.write('%d (x) %s\n' % (pid, ' '.join(rest)))
        with open(os.path.join(d, 'cmdline'), 'wb') as f: f.write(cmd)
        return d

    def test_read_proc(self):
        self.fake_proc(100, b'/usr/lib/node_modules/@openai/codex/vendor/codex/codex\0exec\0-m\0gpt-5\0hi\0')
        self.fake_proc(200, b'', ppid=2)  # 커널 스레드: 명령 줄이 없다
        with open(os.path.join(self.tmp, 'uptime'), 'w') as f: f.write('1000.50 900.00\n')
        os.makedirs(os.path.join(self.tmp, 'self'))
        rows = hostos.read_proc(self.tmp, uid=os.stat(self.tmp).st_uid, hz=100, page_kb=4)
        self.assertEqual(rows, [(100, 1, 500, 10240, '/usr/lib/node_modules/@openai/codex/vendor/codex/codex exec -m gpt-5 hi')])
        # 다른 사용자의 프로세스는 보지 않는다
        self.assertEqual(hostos.read_proc(self.tmp, uid=os.stat(self.tmp).st_uid + 1, hz=100, page_kb=4), [])

    @unittest.skipIf(os.name == 'nt', 'symlinks need privileges on Windows')
    def test_proc_links(self):
        d = self.fake_proc(300, b'codex\0exec\0')
        os.makedirs(os.path.join(d, 'fd'))
        log = os.path.join(self.tmp, 'job.log')
        open(log, 'w').close()
        os.symlink(log, os.path.join(d, 'fd', '1'))
        os.symlink(self.tmp, os.path.join(d, 'cwd'))
        self.assertEqual(hostos.proc_log(300, self.tmp), log)
        self.assertEqual(hostos.proc_link(300, 'cwd', self.tmp), self.tmp)
        # 파이프·터미널·지워진 파일·없는 pid 는 로그가 아니다
        os.unlink(os.path.join(d, 'fd', '1')); os.symlink('pipe:[12345]', os.path.join(d, 'fd', '1'))
        self.assertEqual(hostos.proc_log(300, self.tmp), '')
        os.unlink(os.path.join(d, 'fd', '1')); os.symlink(self.tmp, os.path.join(d, 'fd', '1'))
        self.assertEqual(hostos.proc_log(300, self.tmp), '')  # 폴더(또는 /dev/pts/N)는 일반 파일이 아니다
        os.unlink(os.path.join(d, 'cwd')); os.symlink('/gone (deleted)', os.path.join(d, 'cwd'))
        self.assertEqual(hostos.proc_link(300, 'cwd', self.tmp), '')
        self.assertEqual(hostos.proc_link(999, 'cwd', self.tmp), '')

    def test_meminfo(self):
        text = textwrap.dedent('''\
            MemTotal:       16303428 kB
            MemFree:          512000 kB
            MemAvailable:    8151714 kB
            Buffers:          100000 kB
            Cached:          2000000 kB
            SwapCached:            0 kB
            SwapTotal:       4194300 kB
            SwapFree:        3145728 kB
            ''')
        self.assertEqual(hostos.parse_meminfo(text), {'freePct': 50, 'swapUsedGB': 1.0, 'swapTotalGB': 4.0})
        # 아주 옛 커널(MemAvailable 없음): Free + Buffers + Cached
        old = 'MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'
        self.assertEqual(hostos.parse_meminfo(old), {'freePct': 30, 'swapUsedGB': 0.0, 'swapTotalGB': 0.0})
        self.assertEqual(hostos.parse_meminfo(''), {'freePct': None})

    def test_battery(self):
        base = os.path.join(self.tmp, 'ps')

        def put(name, **files):
            os.makedirs(os.path.join(base, name), exist_ok=True)
            for k, v in files.items():
                with open(os.path.join(base, name, k), 'w') as f: f.write(v + '\n')
        self.assertEqual(hostos.linux_battery(os.path.join(self.tmp, 'none')), {'pct': None, 'charging': False})
        put('AC', type='Mains', online='1')
        put('hidpp_battery_0', type='Battery', scope='Device', capacity='40', status='Discharging')  # 무선 마우스
        self.assertEqual(hostos.linux_battery(base), {'pct': None, 'charging': False})  # 데스크톱: 숨김
        put('BAT0', type='Battery', capacity='87', status='Charging')
        self.assertEqual(hostos.linux_battery(base), {'pct': 87, 'charging': True})
        put('BAT0', type='Battery', capacity='100', status='Full')
        self.assertEqual(hostos.linux_battery(base), {'pct': 100, 'charging': False})
        put('BAT0', type='Battery', capacity='12', status='Discharging')
        self.assertEqual(hostos.linux_battery(base), {'pct': 12, 'charging': False})


CODEX_JS = r'"C:\Program Files\nodejs\node.exe" "C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js" exec -m gpt-5.1 -c model_reasoning_effort=high -o "C:\Users\me\work\reports\2026-11-17_표_정리\보고.md" -C "C:\Users\me\work\My Proj" "say \"hi\" now"'
CODEX_EXE = r'C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex\vendor\x86_64-pc-windows-msvc\codex\codex.exe exec -m gpt-5.1 -c model_reasoning_effort=high -o "C:\Users\me\work\reports\2026-11-17_표_정리\보고.md" -C "C:\Users\me\work\My Proj" "say \"hi\" now"'


class Windows(unittest.TestCase):
    def test_split(self):
        S = hostos.win_split
        self.assertEqual(S(r'"C:\Program Files\x.exe" a "b c" d'), [r'C:\Program Files\x.exe', 'a', 'b c', 'd'])
        self.assertEqual(S(r'x a\\\"b "c\\" d'), ['x', 'a\\"b', 'c\\', 'd'])  # 2n+1 → 따옴표 글자, 2n → 따옴표 열고 닫기
        self.assertEqual(S(r'x C:\dir\ "e f\\"'), ['x', 'C:\\dir\\', 'e f\\'])  # 따옴표 앞이 아닌 역슬래시는 그대로
        self.assertEqual(S(r'x "a""b" "" end'), ['x', 'a"b', '', 'end'])
        self.assertEqual(S(r'C:\a\prog.exe'), [r'C:\a\prog.exe'])
        self.assertEqual(S('  '), [])
        self.assertEqual(S(r'"C:\no end'), [r'C:\no end'])

    def test_command_wrappers(self):
        C = hostos.win_command
        self.assertEqual(C(r'C:\Users\me\AppData\Roaming\npm\codex.cmd exec -m x hi'), 'codex exec -m x hi')
        self.assertEqual(C(r'"C:\Program Files\nodejs\node.exe" --no-warnings C:\npm\node_modules\@openai\codex\bin\codex.js exec hi'), 'codex exec hi')
        self.assertEqual(C(r'C:\tools\agy.exe -p "do it" --log-file C:\logs\run.log'), r"agy -p 'do it' --log-file 'C:\logs\run.log'")
        self.assertEqual(C(r'CODEX.EXE --search exec q'), 'codex --search exec q')
        # 감싼 것이 아닌 node·다른 프로그램은 그대로 둔다(파일 이름만 바꾸지 않는다)
        self.assertEqual(C(r'node C:\app\server.js --port 3'), r"node 'C:\app\server.js' --port 3")
        self.assertEqual(C(r'C:\Windows\system32\cmd.exe /c codex.cmd exec hi'), r"'C:\Windows\system32\cmd.exe' /c codex.cmd exec hi")
        self.assertEqual(C(''), '')

    def test_both_forms_parse_like_mac(self):
        # 감싼 node 와 그것이 띄운 codex.exe 가 같은 모양이 되고, collect.py 의 규칙이 맥과 같게 읽는다
        a, b = hostos.win_command(CODEX_JS), hostos.win_command(CODEX_EXE)
        self.assertEqual(a, b)
        import re, shlex
        self.assertTrue(re.match(r'^(\S*/)?codex(\s+--?[\w-]+(=\S+)?)*\s+exec(\s|$)', a))
        p = collect.parse(shlex.split(a))
        self.assertEqual(p['model'], 'gpt-5.1')
        self.assertEqual(p['effort'], 'high')
        self.assertEqual(p['out'], r'C:\Users\me\work\reports\2026-11-17_표_정리\보고.md')
        self.assertEqual(p['cwd'], r'C:\Users\me\work\My Proj')
        self.assertEqual(shlex.split(a)[-1], 'say "hi" now')

    def test_dates(self):
        D = hostos.parse_win_date
        self.assertEqual(D('2027-01-15T07:59:00.1234567Z'), NOW - 60 + 0.1234567)
        self.assertEqual(D('2027-01-15T16:59:00+09:00'), NOW - 60)
        self.assertEqual(D('2027-01-15T07:59:00'), NOW - 60)  # 시간대 없음 = UTC 로 본다
        self.assertEqual(D('/Date(%d)/' % ((NOW - 60) * 1000)), NOW - 60)  # PowerShell 5.1
        self.assertEqual(D('\\/Date(%d+0900)\\/' % ((NOW - 60) * 1000)), NOW - 60)
        self.assertEqual(D('20270115165900.000000+540'), NOW - 60)  # WMI DMTF(지역 시각 + 분)
        self.assertEqual(D(NOW), NOW)
        for bad in (None, '', 'yesterday', True, {}, '2027-13'):
            self.assertIsNone(D(bad))

    def test_procs_json(self):
        one = {'ProcessId': 4242, 'ParentProcessId': 10, 'CommandLine': CODEX_JS, 'WorkingSetSize': 104857600,
               'CreationDate': '2027-01-15T07:58:00Z'}
        child = dict(one, ProcessId=4243, ParentProcessId=4242, CommandLine=CODEX_EXE, WorkingSetSize=52428800)
        want = (4242, 10, 120, 102400, hostos.win_command(CODEX_JS))
        # 하나면 객체, 여럿이면 배열. 앞의 BOM 과 빈 출력(작업 없음)도 견딘다
        self.assertEqual(hostos.parse_win_procs(json.dumps(one), NOW), [want])
        self.assertEqual(hostos.parse_win_procs('\ufeff' + json.dumps([one, child]) + '\r\n', NOW)[0], want)
        self.assertEqual(len(hostos.parse_win_procs(json.dumps([one, child]), NOW)), 2)
        for out in ('', '   ', 'null', 'not json', '5', '[1, "x"]'):
            self.assertEqual(hostos.parse_win_procs(out, NOW), [])
        # 명령 줄이 없거나(다른 사용자·보호된 프로세스) 시작 시각을 못 읽으면 뺀다
        self.assertEqual(hostos.parse_win_procs(json.dumps([dict(one, CommandLine=None), dict(one, CreationDate=None)]), NOW), [])
        # 시계가 어긋나 미래 시각이어도 음수가 되지 않는다
        self.assertEqual(hostos.parse_win_procs(json.dumps(dict(one, CreationDate='2027-01-15T09:00:00Z')), NOW)[0][2], 0)

    def test_ps_script(self):
        argv = hostos.win_ps_argv(hostos.WIN_FILTER_JOBS)
        self.assertEqual(argv[:3], ['powershell', '-NoProfile', '-NonInteractive'])
        self.assertEqual(argv[-2], '-EncodedCommand')
        script = base64.b64decode(argv[-1]).decode('utf-16-le')
        self.assertIn("-Filter \"CommandLine LIKE '%codex%' OR CommandLine LIKE '%agy%'\"", script)
        self.assertIn('ConvertTo-Json -InputObject $ps -Compress', script)
        self.assertIn("ToString('o')", script)
        self.assertNotIn('{{', script)
        self.assertIn('-Filter "ProcessId=77"', base64.b64decode(hostos.win_ps_argv('ProcessId=77')[-1]).decode('utf-16-le'))

    def test_outermost(self):
        rows = [(1, 0, 0, 0, 'x'), (10, 1, 0, 0, 'node codex'), (11, 10, 0, 0, 'codex.exe'), (12, 11, 0, 0, 'codex child'), (20, 1, 0, 0, 'agy')]
        self.assertEqual(hostos.outermost(rows, {10, 11, 20}), {10, 20})
        self.assertEqual(hostos.outermost(rows, {11}), {11})
        self.assertEqual(hostos.outermost(rows, set()), set())

    def test_mem_status(self):
        G = 1 << 30
        # 16GB 중 6GB 남음, 커밋 한도 20GB(페이지 파일 4GB) 중 9GB 남음 → 커밋 11GB, 램 사용 10GB → 스왑 1GB
        self.assertEqual(hostos.decode_mem_status(16 * G, 6 * G, 20 * G, 9 * G), {'freePct': 38, 'swapUsedGB': 1.0, 'swapTotalGB': 4.0})
        self.assertEqual(hostos.decode_mem_status(16 * G, 8 * G, 16 * G, 8 * G), {'freePct': 50, 'swapUsedGB': 0.0, 'swapTotalGB': 0.0})
        self.assertEqual(hostos.decode_mem_status(16 * G, 1 * G, 20 * G, 0)['swapUsedGB'], 4.0)  # 한도를 넘지 않는다
        self.assertIsNone(hostos.decode_mem_status(0, 0, 0, 0)['freePct'])

    def test_power_status(self):
        P = hostos.decode_power_status
        self.assertEqual(P(0, 0, 69), {'pct': 69, 'charging': False})      # 배터리로
        self.assertEqual(P(1, 8, 55), {'pct': 55, 'charging': True})       # 충전 중
        self.assertEqual(P(1, 1, 100), {'pct': 100, 'charging': False})    # 다 참(전원 연결)
        self.assertEqual(P(1, 128, 255), {'pct': None, 'charging': False})  # 배터리 없는 데스크톱
        self.assertEqual(P(255, 255, 255), {'pct': None, 'charging': False})
        self.assertEqual(P(1, 2 | 8, 7), {'pct': 7, 'charging': True})

    def test_collect_on_windows(self):
        # collect.py 를 윈도인 것처럼: 로그·폴더는 모르고, 감싼 node 와 codex.exe 중 바깥 것만 남는다
        rows = hostos.parse_win_procs(json.dumps([
            {'ProcessId': 4242, 'ParentProcessId': 10, 'CommandLine': CODEX_JS, 'WorkingSetSize': 104857600, 'CreationDate': '2027-01-15T07:58:00Z'},
            {'ProcessId': 4243, 'ParentProcessId': 4242, 'CommandLine': CODEX_EXE, 'WorkingSetSize': 1, 'CreationDate': '2027-01-15T07:58:01Z'},
            {'ProcessId': 5000, 'ParentProcessId': 10, 'CommandLine': r'C:\bin\agy.exe -p "fix it" --model gemini-x --log-file C:\logs\2026-11-17_큰_일.log', 'WorkingSetSize': 2048000, 'CreationDate': '2027-01-15T07:59:00Z'},
            {'ProcessId': 6000, 'ParentProcessId': 10, 'CommandLine': r'"C:\Program Files\nodejs\node.exe" C:\npm\codex.js app-server', 'WorkingSetSize': 1, 'CreationDate': '2027-01-15T07:59:00Z'},
        ]), NOW)
        saved = (collect.IS_MAC, collect.IS_WIN, collect.now)
        collect.IS_MAC, collect.IS_WIN, collect.now = False, True, NOW
        collect.jobs.clear(); collect.waiting.clear()
        try:
            collect.collect(rows)
            jobs = [dict(j) for j in collect.jobs]
        finally:
            collect.IS_MAC, collect.IS_WIN, collect.now = saved
            collect.jobs.clear(); collect.waiting.clear()
        self.assertEqual([j['pid'] for j in jobs], [4242, 5000])
        c, a = jobs
        self.assertEqual((c['tool'], c['model'], c['effort'], c['elapsed'], c['rssMB'], c['idle'], c['tail']),
                         ('codex', 'gpt-5.1', 'high', 120, 100, None, []))
        if os.name == 'nt':  # 경로 이름 풀기는 그 운영체제의 os.path 가 한다
            self.assertEqual((c['label'], c['project']), ('표 정리', 'My Proj'))
        self.assertEqual((a['tool'], a['model'], a['out']), ('argon', 'gemini-x', r'C:\logs\2026-11-17_큰_일.log'))


FAKE_SERVER = r'''
import json, os, subprocess, sys, time
mode = sys.argv[1]
if mode == 'child':  # 하위 프로세스를 하나 띄우고 그 pid 를 알린 뒤 멈춰 있다
    c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    with open(sys.argv[2], 'w') as f: f.write(str(c.pid))
    time.sleep(60)
got = [sys.stdin.readline() for _ in range(3)]
ids = [json.loads(x).get('id') for x in got]
if mode == 'exit': sys.exit(0)
if mode == 'hang': time.sleep(60)
reply = json.dumps({'id': 2, 'result': {'rateLimits': {'primary': {'usedPercent': 31, 'windowDurationMins': 300, 'resetsAt': 1800000000},
                                                      'secondary': {'usedPercent': 7.5, 'windowDurationMins': 10080}, 'planType': 'pro'},
                                       'rateLimitResetCredits': {'availableCount': 1, 'credits': [{'title': 'Full reset', 'status': 'available', 'expiresAt': 1800100000}]}}})
out = sys.stdout.buffer
out.write(b'not json\n' + json.dumps({'id': 1, 'result': {}, 'seen': ids}).encode() + b'\n{"method":"note"}\n'); out.flush()
half = len(reply) // 2  # 줄바꿈 없는 조각 두 번
out.write(reply[:half].encode()); out.flush(); time.sleep(0.3)
out.write(reply[half:].encode() + b'\n'); out.flush()
time.sleep(60)
'''


class CodexUsage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.fake = os.path.join(self.tmp, 'fake_server.py')
        with open(self.fake, 'w', encoding='utf-8') as f: f.write(FAKE_SERVER)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ask(self, mode, deadline=10, *more):
        t = time.time()
        r = usage.ask([sys.executable, '-I', self.fake, mode, *more], deadline)
        return r, time.time() - t

    def test_reply_in_pieces(self):
        r, took = self.ask('ok')
        self.assertEqual(r['id'], 2)
        self.assertEqual(r['result']['rateLimits']['primary']['usedPercent'], 31)
        self.assertLess(took, 8)  # 서버는 60초 기다리지만 답을 받으면 바로 끝낸다

    def test_server_exits(self):
        r, took = self.ask('exit')
        self.assertEqual(r, {'error': 'server-exited'})
        self.assertLess(took, 8)

    def test_timeout(self):
        r, took = self.ask('hang', 1.5)
        self.assertEqual(r, {'error': 'timeout'})
        self.assertLess(took, 8)

    @unittest.skipIf(os.name == 'nt', 'checks the POSIX process group; Windows uses taskkill /T')
    def test_child_is_stopped(self):
        pidf = os.path.join(self.tmp, 'child.pid')
        r, _ = self.ask('child', 1.5, pidf)
        self.assertEqual(r, {'error': 'timeout'})
        pid = int(open(pidf).read())
        for _ in range(40):
            try: os.kill(pid, 0)
            except ProcessLookupError: break
            time.sleep(0.05)
        else:
            os.kill(pid, 9); self.fail('the server\'s child was left running')

    def test_read_reply_direct(self):
        r, w = os.pipe()
        os.write(w, b'{"id":2,')
        os.write(w, b'"result":{}}\n')
        with os.fdopen(r, 'rb') as rf:
            self.assertEqual(usage.read_reply(rf, 2, 3), {'id': 2, 'result': {}})
        os.close(w)

    def test_main_with_fake_codex(self):
        # main() 이 찾는 codex 를 가짜로 바꾼다(진짜 codex·네트워크는 쓰지 않는다)
        if os.name == 'nt':
            fake = os.path.join(self.tmp, 'codex.cmd')
            with open(fake, 'w') as f: f.write('@"%s" -I "%s" ok\r\n' % (sys.executable, self.fake))
        else:
            fake = os.path.join(self.tmp, 'codex')
            with open(fake, 'w') as f: f.write('#!/bin/sh\nexec "%s" -I "%s" ok\n' % (sys.executable, self.fake))
            os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        saved = usage.shutil.which
        usage.shutil.which = lambda name, path=None: fake if name == 'codex' else None
        try:
            res = usage.main()
        finally:
            usage.shutil.which = saved
        self.assertEqual(res['windows'], [{'usedPct': 31, 'mins': 300, 'resetsAt': 1800000000}, {'usedPct': 7.5, 'mins': 10080, 'resetsAt': 0}])
        self.assertEqual((res['plan'], res['resetCredits'], res['credits']), ('pro', 1, [{'title': 'Full reset', 'expiresAt': 1800100000}]))

    def test_platform_bits(self):
        self.assertEqual(usage.kill_tree_argv(321), ['taskkill', '/PID', '321', '/T', '/F'])
        if os.name != 'nt':  # 맥·리눅스의 예비 경로는 예전 그대로
            self.assertEqual(usage.fallback_path(), '/opt/homebrew/bin:/usr/local/bin:' + os.path.expanduser('~/.local/bin'))


class ThisMachine(unittest.TestCase):
    """The helper the pane calls, for real on this OS (only the shape of the answer is checked)."""
    def run_(self, *args):
        return subprocess.run([sys.executable, '-I', os.path.join(HOOKS, 'hostos.py'), *args], capture_output=True, timeout=60)

    def test_proc_of_this_process(self):
        r = self.run_('proc', str(os.getpid()))
        self.assertEqual(r.returncode, 0, r.stderr)
        line = r.stdout.decode('utf-8').strip()
        et, _, cmd = line.partition(' ')
        self.assertLess(hostos.etime_s(et), 3600)
        self.assertIn('platform_test', cmd)
        # 그 줄을 진행판(hooks/proc.ts etimeS)과 같은 규칙으로 읽을 수 있다
        import re
        self.assertTrue(re.match(r'^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$', et))

    def test_proc_missing(self):
        r = self.run_('proc', '999999999')
        self.assertEqual((r.returncode, r.stdout), (1, b''))

    def test_usage_line(self):
        self.assertEqual(self.run_().returncode, 2)

    @unittest.skipIf(sys.platform == 'darwin', 'macOS reads pmset and its own memory tools')
    def test_power_and_mem(self):
        r = self.run_('power')
        p = json.loads(r.stdout)
        self.assertEqual(set(p), {'pct', 'charging'})
        self.assertTrue(p['pct'] is None or 0 <= p['pct'] <= 100)
        m = hostos.read_mem()
        self.assertTrue(m['freePct'] is None or 0 <= m['freePct'] <= 100)
        self.assertIn('load', m)
        if os.name == 'nt': self.assertIsNone(m['load'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
