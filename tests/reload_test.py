"""리로드 경계(/reload-plugins) 시험: hooks/register.tsx 를 모듈 둘로 실어 tests/clawd.test.tsx 의 '리로드:' 시험을 다시 돌린다.

claude plugin test 는 플러그인 하나에 모듈 하나만 싣고, 같은 모듈 안의 새 세션은 모듈 변수(세대)로 옛 세션을 알아본다.
/reload-plugins 뒤에는 옛 모듈과 새 모듈이 모듈 변수를 따로 갖고 atom 만 같이 쓴다. 그 경계를 보려고 임시 폴더에 플러그인을 복사해
  hooks/register-old.tsx = 지금 register.tsx 의 복사본(세션 시작은 cwd '/old' 일 때만, 그 밖의 훅은 없음)
  hooks/register.tsx     = 지금 register.tsx(세션 시작은 cwd '/new' 일 때만)
  hooks/reload.ts        = 둘을 다 등록하는 모듈(hooks.json 이 가리킨다)
으로 만들고, clawd.test.tsx 에서 머리(가져오기·도우미)와 '리로드:' 시험만 뽑아 돌린다. 실제 리로드와 다른 점은 옛 모듈의 타이머가 계속 돈다는 것뿐이다.
'리로드:' 시험은 clawd.test.tsx 안에서도(한 모듈의 앞 세션·새 세션으로) 돈다.
실행: python3 -I -B tests/reload_test.py   (claude CLI 가 필요하다. 임시 폴더는 TMPDIR 아래에 만들고 끝나면 지운다)
"""
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
START = "  on('session.start', async ($, e, next) => {"
CUT = "\n  on('command.run', { command: 'status-panel' }"
RELOAD_TS = """import type { Register } from 'claude-code'

import { register as before } from './register-old'
import { register as after } from './register'

// 리로드 경계 시험용(tests/reload_test.py 가 임시 폴더에만 만든다): 옛 모듈(cwd /old)과 새 모듈(cwd /new)을 함께 싣는다
export const register: Register = on => { before(on); after(on) }
"""


def reload_tests(src):
    """clawd.test.tsx → 시험이 아닌 것(가져오기·엔진 흉내·도우미) 전부 + '리로드:' 시험들"""
    keep, tests, at = [], [], 0
    for m in re.finditer(r'^test\(', src, re.M):
        end = src.index('\n})\n', m.start()) + 4
        keep.append(src[at:m.start()])
        if src.startswith("test('리로드:", m.start()):
            tests.append(src[m.start():end])
        at = end
    keep.append(src[at:])
    return ''.join(keep) + '\n' + '\n'.join(tests), len(tests)


def build(dst):
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns('tests', '__pycache__'))
    reg = (ROOT / 'hooks' / 'register.tsx').read_text(encoding='utf-8')
    assert reg.count(START) == 1 and reg.count(CUT) == 1, 'register.tsx 의 세션 시작·명령 등록 자리를 못 찾았어요'
    old = reg.replace(START, START.replace("'session.start', ", "'session.start', { cwd: '/old' }, "))
    (dst / 'hooks' / 'register-old.tsx').write_text(old[:old.index(CUT)] + '\n}\n', encoding='utf-8')
    (dst / 'hooks' / 'register.tsx').write_text(reg.replace(START, START.replace("'session.start', ", "'session.start', { cwd: '/new' }, ")), encoding='utf-8')
    (dst / 'hooks' / 'reload.ts').write_text(RELOAD_TS, encoding='utf-8')
    (dst / 'hooks' / 'hooks.json').write_text('{ "modules": ["./reload.ts"] }\n', encoding='utf-8')
    (dst / 'tests').mkdir()
    shutil.copy(ROOT / 'tests' / 'helpers.ts', dst / 'tests' / 'helpers.ts')
    text, n = reload_tests((ROOT / 'tests' / 'clawd.test.tsx').read_text(encoding='utf-8'))
    (dst / 'tests' / 'reload.test.tsx').write_text(text, encoding='utf-8')
    return n


class ReloadTest(unittest.TestCase):
    def test_reload_boundary_in_two_modules(self):
        with tempfile.TemporaryDirectory(prefix='status-panel-reload-') as tmp:
            dst = pathlib.Path(tmp) / 'status-panel'
            n = build(dst)
            self.assertGreaterEqual(n, 2)
            r = subprocess.run(['claude', 'plugin', 'test', str(dst)], capture_output=True, text=True, timeout=600)
            out = r.stdout + r.stderr
            passed = len(re.findall(r'^\(pass\) 리로드:', out, re.M))
            self.assertEqual(r.returncode, 0, out[-3000:])
            self.assertEqual(passed, n, out[-3000:])


if __name__ == '__main__':
    unittest.main()
