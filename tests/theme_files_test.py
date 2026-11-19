"""테마 묶음 파일 점검: themes/<id>/sprites.json·friends.json 이 hooks/theme.ts 가 받는 꼴인지.
claude plugin test 는 .json 을 불러올 수 없어서 파일 자체는 여기서 본다(실제 테마를 넣을 때도 같이 돌린다).
실행: python3 -I -B tests/theme_files_test.py
"""
import base64
import json
import pathlib
import re
import struct
import sys
import unittest
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
BIG = ['idle', 'think', 'search', 'read', 'edit', 'work', 'cape', 'happy', 'heart', 'coffee', 'bubble', 'kite', 'dizzy', 'ask', 'oops', 'sleepy']
FRIENDS = ['bubble', 'kite', 'coffee', 'happy', 'idle']


def check(path, known):
    d = json.loads(path.read_text(encoding='utf-8'))
    errs = []
    if d.get('canvas') != [38, 32]:
        errs.append('canvas must be [38, 32]')
    pal = d.get('palette') or {}
    for k, v in pal.items():
        if len(k) != 1 or k == '.' or not re.fullmatch(r'#[0-9a-fA-F]{6}', str(v)):
            errs.append(f'bad palette entry {k!r}: {v!r}')
    frames = d.get('frames') or []
    if not frames:
        errs.append('no frames')
    for i, f in enumerate(frames):
        if not isinstance(f, list) or any(not isinstance(r, str) for r in f):
            errs.append(f'frame {i} must be a list of strings')
            continue
        if len(f) != 32 or any(len(r) != 38 for r in f):
            errs.append(f'frame {i} is not 38x32')
        bad = {c for r in f for c in r if c != '.' and c not in pal}
        if bad:
            errs.append(f'frame {i} uses unknown colors {sorted(bad)}')
    states = d.get('states') or {}
    for k, s in states.items():
        # 손님 틀 "<상태>@<손님>": 바탕 상태가 아는 것이고 손님 id 가 소문자 ascii 면 받는다(hooks/clawd.ts splitVariant)
        base, at, guest = k.partition('@')
        if at:
            if base not in known or not re.fullmatch(r'[a-z0-9_-]+', guest):
                errs.append(f'unknown state {k}')
        elif k not in known:
            errs.append(f'unknown state {k}')
        seq = s.get('seq') or []
        if not seq or any(not isinstance(i, int) or i < 0 or i >= len(frames) for i in seq):
            errs.append(f'state {k} seq points outside frames')
        ms = s.get('ms')
        if not isinstance(ms, (int, float)) or isinstance(ms, bool) or ms <= 0:
            errs.append(f'state {k} ms must be a number > 0')
    if 'idle' not in states:
        errs.append('no idle state')
    return errs, len(pal)


# 큰 마스코트: PNG 팔레트 256 칸에서 투명과 한 칸 여유(예전 sticker 흰 테두리 자리)를 뺀 것(hooks/theme.ts BIG_MAX_COLORS)
BIG_MAX = 254
# 놀이터: 1 + 배경 색 + 친구 색 × 2 ≤ 256. 배경 색 수는 scene.ts 라 여기서는 못 세서, 배경에 55색을 남겨 둔 어림(1 + 2n ≤ 200)
FRIENDS_ROUGH = 200


def listed_ids(text):
    """themes/index.ts 의 THEMES 객체에 올린 id(주석 줄은 뺀다)"""
    body = text.split('THEMES', 1)[-1]
    ids = []
    for line in body.splitlines():
        line = line.split('//', 1)[0]
        m = re.match(r'\s*([A-Za-z0-9_-]+|\'[^\']+\')\s*:\s*\{\s*names', line)
        if m:
            ids.append(m.group(1).strip("'"))
    return ids


W = 38


def extent(d, key):
    """hooks/clawd.ts actExtent 와 같은 셈: 그 동작의 모든 장면을 합친 가로 범위(없는 상태는 idle)"""
    st = d['states'].get(key) or d['states']['idle']
    lo, hi = W, -1
    for n in set(st['seq']):
        for row in d['frames'][n]:
            for x, c in enumerate(row[:W]):
                if c != '.':
                    lo, hi = min(lo, x), max(hi, x)
    return (0, W - 1) if hi < 0 else (lo, hi)


def shifts(d):
    """hooks/clawd.ts actShift(시안31 '가'안): home = center(idle), dx = max(0, min(home, W-1-hi))"""
    center = lambda e: max(0, ((W - 1 - e[1]) - e[0]) // 2)
    home = center(extent(d, 'idle'))
    return home, {k: max(0, min(home, W - 1 - extent(d, k)[1])) for k in d['states']}



def png_rgba(b):
    """PNG(8비트 RGBA·팔레트, 비월 없음) → (w, h, 줄마다 RGBA 바이트). 필터 0~4"""
    assert b[:8] == b'\x89PNG\r\n\x1a\n'
    p, idat, pal, trns = 8, b'', [], b''
    while p < len(b):
        n, t = struct.unpack('>I4s', b[p:p + 8]); body = b[p + 8:p + 8 + n]
        if t == b'IHDR': w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', body)
        elif t == b'PLTE': pal = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif t == b'tRNS': trns = body
        elif t == b'IDAT': idat += body
        p += 12 + n
    assert depth == 8 and ctype in (3, 6) and inter == 0
    bpp = 4 if ctype == 6 else 1
    raw, stride, prev, out = zlib.decompress(idat), w * bpp, bytearray(w * bpp), []
    for y in range(h):
        ft, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            up, c = prev[i], (prev[i - bpp] if i >= bpp else 0)
            if ft == 1: line[i] = (line[i] + a) & 255
            elif ft == 2: line[i] = (line[i] + up) & 255
            elif ft == 3: line[i] = (line[i] + (a + up) // 2) & 255
            elif ft == 4:
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        prev = line
        out.append(bytes(line) if ctype == 6 else b''.join(bytes(pal[k] + ((trns[k] if k < len(trns) else 255),)) for k in line))
    return w, h, out


class ThemeFiles(unittest.TestCase):
    def test_center_shift(self):
        # 기본 Clawd: 시안31 '가'안의 기대값(쉬기·생각 +5, 고치기·연 +1, 비눗방울 +2)
        d = json.loads((ROOT / 'clawd' / 'sprites.json').read_text(encoding='utf-8'))
        home, dx = shifts(d)
        self.assertEqual(home, 5)
        self.assertEqual({k: dx[k] for k in ['idle', 'think', 'edit', 'kite', 'bubble']}, {'idle': 5, 'think': 5, 'edit': 1, 'kite': 1, 'bubble': 2})
        # 모든 테마(폴더에서 센다): 옮긴 뒤에도 그림 칸 안, home 보다 더 옮기지 않고, 모자라지 않으면 home 그대로
        for p in [ROOT / 'clawd' / 'sprites.json'] + sorted((ROOT / 'themes').glob('*/sprites.json')):
            d = json.loads(p.read_text(encoding='utf-8'))
            home, dx = shifts(d)
            for k, v in dx.items():
                with self.subTest(theme=p.parent.name, state=k):
                    hi = extent(d, k)[1]
                    self.assertLessEqual(hi + v, W - 1)
                    self.assertTrue(0 <= v <= home)
                    if hi + home <= W - 1:
                        self.assertEqual(v, home)


    def test_baked_shift(self):
        # 기본 Clawd: dx 가 0 이 아닌 (장면, dx) 마다 구운 그림(png.shift, clawd-src/bake_shift.py)이 있고,
        # 그것이 png.plain 을 dx×12px 오른쪽으로 옮긴 것과 픽셀(알파 포함)이 같다. 쓸모없는 키는 없다
        d = json.loads((ROOT / 'clawd' / 'sprites.json').read_text(encoding='utf-8'))
        _, dx = shifts(d)
        want = {f'{f}:{v}' for k, v in dx.items() if v for f in d['states'][k]['seq']}
        shift = d['png'].get('shift', {})
        self.assertEqual(sorted(set(shift) - want), [], '쓰지 않는 구운 그림')
        self.assertEqual(sorted(want - set(shift)), [], '구운 그림이 없는 조합')
        self.assertNotIn('sticker', d['png'])
        for key in sorted(want):
            f, v = map(int, key.split(':'))
            with self.subTest(key=key):
                w, h, src = png_rgba(base64.b64decode(d['png']['plain'][f]))
                w2, h2, got = png_rgba(base64.b64decode(shift[key]))
                self.assertEqual((w2, h2), (w, h))
                px = v * 12
                pix = lambda row, x: (0, 0, 0, 0) if row[x * 4 + 3] == 0 else tuple(row[x * 4:x * 4 + 4])  # 투명이면 색은 따지지 않는다
                bad = 0
                for y in range(h):
                    exp = bytes(px * 4) + src[y][:(w - px) * 4]
                    if got[y] != exp:
                        bad += sum(1 for x in range(w) if pix(got[y], x) != pix(exp, x))
                self.assertEqual(bad, 0)
                # 옮겨서 잘린 픽셀이 없다(오른쪽 끝 px 폭이 원래 투명)
                self.assertEqual(sum(1 for y in range(h) for x in range(w - px, w) if src[y][x * 4 + 3]), 0)

    def test_every_theme_folder(self):
        dirs = [p for p in sorted((ROOT / 'themes').iterdir()) if p.is_dir() and not p.name.startswith(('.', '_'))]
        self.assertTrue(dirs, 'no theme folders')
        for d in dirs:
            with self.subTest(theme=d.name):
                big = d / 'sprites.json'
                self.assertTrue(big.exists(), f'{d.name}: no sprites.json')
                errs, nb = check(big, BIG)
                self.assertEqual(errs, [], f'{d.name}/sprites.json')
                self.assertLessEqual(nb, BIG_MAX, f'{d.name}: sprites.json has more than {BIG_MAX} colors')
                fr = d / 'friends.json'
                if fr.exists():
                    errs, n = check(fr, FRIENDS)
                    self.assertEqual(errs, [], f'{d.name}/friends.json')
                else:
                    n = nb  # friends.json 이 없으면 큰 마스코트가 놀이터 친구도 된다
                self.assertLessEqual(1 + 2 * n, FRIENDS_ROUGH, f'{d.name}: too many friend colors')

    def test_index_matches_folders(self):
        # 양쪽 다: 폴더는 있는데 목록에 없거나, 목록에는 있는데 폴더가 없으면(기본 clawd 는 clawd/sprites.json) 실패
        idx = (ROOT / 'themes' / 'index.ts').read_text(encoding='utf-8')
        ids = listed_ids(idx)
        self.assertIn('clawd', ids)
        self.assertEqual(len(ids), len(set(ids)), f'duplicate ids in themes/index.ts: {ids}')
        dirs = {p.name for p in (ROOT / 'themes').iterdir() if p.is_dir() and not p.name.startswith(('.', '_'))}
        self.assertEqual(sorted(dirs - set(ids)), [], 'theme folders not listed in themes/index.ts')
        self.assertEqual(sorted(set(ids) - dirs - {'clawd'}), [], 'themes/index.ts lists ids without a folder')
        self.assertTrue((ROOT / 'clawd' / 'sprites.json').exists())

    def test_listed_ids_reader(self):
        # 읽개가 헛돌지 않는지: 주석 줄·다른 키는 빼고, 따옴표 id 는 읽는다
        text = "export const THEMES = {\n  clawd: { names: ['c'] },\n  // gone: { names: ['g'] },\n  'my-theme': { names: ['m'], scene: x },\n}\n"
        self.assertEqual(listed_ids(text), ['clawd', 'my-theme'])

    def test_guest_variant_keys(self):
        # 손님 틀 "<상태>@<손님>": 바탕이 아는 상태면 받고, 모르는 바탕·대문자 손님은 거절
        import tempfile
        row = '.' * 38
        d = {'canvas': [38, 32], 'palette': {'a': '#000000'}, 'frames': [[row] * 32, [row] * 32],
             'states': {'idle': {'ms': 100, 'seq': [0]}, 'edit@ditto': {'ms': 100, 'seq': [1]},
                        'nope@ditto': {'ms': 100, 'seq': [0]}, 'edit@Ditto': {'ms': 100, 'seq': [0]}}}
        with tempfile.TemporaryDirectory() as t:
            p = pathlib.Path(t) / 'sprites.json'
            p.write_text(json.dumps(d), encoding='utf-8')
            errs, _ = check(p, BIG)
        self.assertEqual(sorted(errs), ['unknown state edit@Ditto', 'unknown state nope@ditto'])


if __name__ == '__main__':
    sys.exit(unittest.main(verbosity=2))
