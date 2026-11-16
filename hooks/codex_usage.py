#!/usr/bin/env python3
"""Codex usage limits as one JSON line, asked of `codex app-server` (account/rateLimits/read).
Read by the status-panel pane every few minutes; it makes one network call per run.
Always prints exactly one JSON line, also when the server fails to start, hangs or answers oddly.
Our own errors are fixed codes (server-exited, timeout, codex-not-found, no-usage) that the pane turns into words
(hooks/i18n.ts usageErr); a credit without a title has title ''."""
import json, os, queue, shutil, signal, subprocess, sys, threading, time

IS_WIN = sys.platform.startswith('win')

DEADLINE_S = 15

def plugin_version():
    # 같은 플러그인의 .claude-plugin/plugin.json 의 version. 못 읽으면 '0'
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.claude-plugin', 'plugin.json'), encoding='utf-8') as f:
            v = json.load(f).get('version')
        return v if isinstance(v, str) and v else '0'
    except Exception:
        return '0'

def out(o):
    o['at'] = int(time.time())
    if IS_WIN:  # 윈도 파이프의 기본 인코딩은 한글을 못 쓴다
        try: sys.stdout.reconfigure(encoding='utf-8')
        except Exception: pass
    print(json.dumps(o, ensure_ascii=False))

def win(w):
    if not isinstance(w, dict) or not isinstance(w.get('usedPercent'), (int, float)): return None
    return {'usedPct': w['usedPercent'], 'mins': w.get('windowDurationMins') or 0, 'resetsAt': w.get('resetsAt') or 0}

def kill_tree_argv(pid):
    # 윈도: 서버(codex.cmd → node → codex.exe)를 하위 프로세스까지 끝낸다
    return ['taskkill', '/PID', str(pid), '/T', '/F']

def stop(p):
    # 서버가 띄운 하위 프로세스까지 같이 끝내고, 끝난 것을 확인한다(2026-11-16 Codex 검토 2번)
    if IS_WIN:
        try: subprocess.run(kill_tree_argv(p.pid), capture_output=True, timeout=5, creationflags=0x08000000)
        except Exception: pass
        try: p.kill()
        except OSError: pass
    else:
        try: os.killpg(p.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try: p.kill()
            except ProcessLookupError: pass
    try: p.wait(timeout=3)
    except subprocess.TimeoutExpired: pass

def pump(stream, q):
    # 읽기 전용 스레드: 읽을 수 있는 만큼씩 넘기고, 끝(b'')이나 오류도 넘긴다. select 를 못 쓰는 윈도 파이프에서도 같게 돈다
    try:
        while True:
            chunk = os.read(stream.fileno(), 65536)
            q.put(chunk)
            if not chunk: return
    except Exception:
        q.put(b'')

def read_reply(stream, want_id, deadline_s):
    """Read JSON lines from stream until the one with id == want_id; {'error': 'server-exited'|'timeout'} otherwise.
    readline 은 줄바꿈 없는 조각에서 끝없이 기다릴 수 있어, 읽을 수 있는 만큼만 받고 줄은 직접 나눈다(검토 1번)"""
    q = queue.Queue()
    threading.Thread(target=pump, args=(stream, q), daemon=True).start()
    buf, end = b'', time.time() + deadline_s
    while True:
        left = end - time.time()
        if left <= 0: return {'error': 'timeout'}
        try: chunk = q.get(timeout=min(1.0, left))
        except queue.Empty: continue
        if not chunk: return {'error': 'server-exited'}
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            try: msg = json.loads(line)
            except ValueError: continue
            if isinstance(msg, dict) and msg.get('id') == want_id: return msg

def ask(argv, deadline_s=DEADLINE_S):
    # start_new_session(맥·리눅스): 서버를 자기 프로세스 그룹에 두어 stop() 이 그룹째 끝낼 수 있게 한다. 윈도는 창 없이 띄운다
    extra = {'creationflags': 0x08000000} if IS_WIN else {'start_new_session': True}
    p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **extra)
    try:
        for msg in ({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'status-panel', 'version': plugin_version()}}},
                    {'jsonrpc': '2.0', 'method': 'initialized'},
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'account/rateLimits/read'}):
            p.stdin.write((json.dumps(msg) + '\n').encode()); p.stdin.flush()
        return read_reply(p.stdout, 2, deadline_s)
    finally:
        stop(p)

def fallback_path():
    # PATH 에 없을 때 더 찾아볼 곳: 맥·리눅스는 Homebrew·/usr/local·~/.local/bin, 윈도는 npm 전역 폴더
    if IS_WIN:
        return os.pathsep.join(p for p in (os.path.join(os.environ.get('APPDATA', ''), 'npm') if os.environ.get('APPDATA') else '',
                                          os.path.expanduser(r'~\.local\bin')) if p)
    return '/opt/homebrew/bin:/usr/local/bin:' + os.path.expanduser('~/.local/bin')

def main():
    codex = shutil.which('codex') or shutil.which('codex', path=fallback_path())
    if not codex: return {'error': 'codex-not-found'}
    res = ask([codex, 'app-server'])
    err = res.get('error')
    if err: return {'error': str(err.get('message', err) if isinstance(err, dict) else err)[:100]}
    # 응답 모양이 예상과 달라도 예외 없이 지나가게 자료형을 확인한다(검토 4번)
    result = res.get('result') if isinstance(res.get('result'), dict) else {}
    rl = result.get('rateLimits') if isinstance(result.get('rateLimits'), dict) else {}
    credits = result.get('rateLimitResetCredits') if isinstance(result.get('rateLimitResetCredits'), dict) else {}
    count = credits.get('availableCount')
    # 남은 리셋권의 이름과 만료 시각(앱에서 보이는 것과 같게, 사용자 2026-11-16)
    items = [{'title': str(c.get('title') or '')[:40], 'expiresAt': c['expiresAt']}
             for c in (credits.get('credits') if isinstance(credits.get('credits'), list) else [])
             if isinstance(c, dict) and c.get('status') == 'available' and isinstance(c.get('expiresAt'), (int, float))]
    windows = [w for w in (win(rl.get('primary')), win(rl.get('secondary'))) if w]
    if not windows: return {'error': 'no-usage'}
    reached = rl.get('rateLimitReachedType')
    return {'windows': windows, 'reached': reached if isinstance(reached, str) else None,
            'plan': rl.get('planType') if isinstance(rl.get('planType'), str) else '',
            'resetCredits': count if isinstance(count, int) else len(items), 'credits': items}

if __name__ == '__main__':
    try:
        out(main())
    except Exception as e:  # 시작 실패·끊긴 파이프 등 무엇이든 JSON 한 줄로 알린다(검토 3번)
        out({'error': f'{type(e).__name__}: {e}'[:100]})
