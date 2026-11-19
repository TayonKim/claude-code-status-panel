import { expect, test } from 'claude-code/testing'

import { actExtent, actShift, centerShift, rasterCells, shiftRows } from '../hooks/clawd'
import type { Sprites } from '../hooks/clawd'
import { bigPng, normalizeBig, spritePng } from '../hooks/theme'
import { decodePng, unbase64 } from './helpers'

// 큰 캐릭터 가운데 정렬(시안31 '가'안): dx 규칙(순수 함수)과 그림(PNG·Raster)을 옮기는 길.
// 실제 그림 파일(clawd/sprites.json·themes/*)의 dx 기대값은 tests/theme_files_test.py 가 본다(이 시험은 .json 을 못 읽는다).
// 실행: claude plugin test .

const W = 38
const row = (x0: number, x1: number, c = 'a') => Array.from({ length: W }, (_, x) => (x >= x0 && x <= x1 ? c : '.')).join('')
const frame = (x0: number, x1: number) => Array.from({ length: 32 }, (_, y) => (y > 20 ? row(x0, x1) : '.'.repeat(W)))
// 몸 x 2~25(쉬기), 생각은 소품이 오른쪽 끝 35 까지, 손님은 31 까지, 빈 장면만 있는 동작
const SP = {
  canvas: [38, 32], box: [19, 8], palette: { a: '#D97757' },
  frames: [frame(2, 25), frame(3, 26), frame(2, 35), frame(2, 31), Array.from({ length: 32 }, () => '.'.repeat(W))],
  states: {
    idle: { label: 'idle', ms: 100, seq: [0, 1] }, think: { label: 'think', ms: 100, seq: [0, 2] },
    'think@guest': { label: 'g', ms: 100, seq: [3] }, oops: { label: 'oops', ms: 100, seq: [4] },
  },
  png: { plain: [], sticker: [] },
} as unknown as Sprites

test('가운데 정렬 dx: home = center(idle), 오른쪽이 모자란 동작만 들어가는 만큼', () => {
  expect(actExtent(SP, 'idle')).toEqual([2, 26]) // 두 장면을 합친 범위
  expect(centerShift([2, 26], W)).toBe(4) // 왼쪽 2·오른쪽 11 → (11 - 2) / 2 내림
  expect(centerShift([0, 37], W)).toBe(0)
  expect(centerShift([10, 37], W)).toBe(0) // 이미 오른쪽에 붙은 것은 0(음수 없음)
  expect(actShift(SP, 'idle')).toBe(4)
  expect(actShift(SP, 'think')).toBe(2) // 35 + 2 = 37: 끝까지만
  expect(actShift(SP, 'think@guest')).toBe(4) // 손님 틀은 그 키의 범위로(31 + 4 ≤ 37)
  expect(actShift(SP, 'oops')).toBe(0) // 도트가 없는 동작은 옮기지 않는다([0, 37])
  expect(actShift(SP, 'nothing')).toBe(4) // 없는 키는 idle 범위
  // 한 동작 안에서는 장면이 바뀌어도 같은 dx(장면이 아니라 동작마다 잰다)
  for (const k of Object.keys(SP.states)) expect(actShift(SP, k) + actExtent(SP, k)[1]).toBeLessThanOrEqual(W - 1)
})

test('shiftRows: 오른쪽으로 밀고 폭은 그대로, 0 이면 그대로', () => {
  const r = ['a'.repeat(3) + '.'.repeat(35)]
  expect(shiftRows(r, 0)).toBe(r)
  expect(shiftRows(r, 5)).toEqual(['.'.repeat(5) + 'aaa' + '.'.repeat(30)])
  expect(shiftRows(['b'.repeat(38)], 2)[0]).toBe('..' + 'b'.repeat(36))
})

test('도트로 만드는 그림(png 가 없는 테마): dx 만큼 오른쪽, dx 0 은 예전과 같다', () => {
  const p0 = decodePng(unbase64(spritePng(SP, 0, 0))), p4 = decodePng(unbase64(spritePng(SP, 0, 4)))
  expect([p0.w, p0.h]).toEqual([456, 384])
  let bad = 0
  for (let y = 0; y < 384; y++) for (let x = 0; x < 456; x++) if (p4.px[y * 456 + x] !== (x < 48 ? 0 : p0.px[y * 456 + x - 48]!)) bad++
  expect(bad).toBe(0)
  expect(bigPng(SP, 0)).toBe(spritePng(SP, 0, 0))
  expect(bigPng(SP, 0, 4)).toBe(spritePng(SP, 0, 4))
  expect(bigPng(SP, 0, 4)).not.toBe(bigPng(SP, 0))
  // Raster(글자 방식)도 같은 dx 로
  expect(rasterCells(shiftRows(SP.frames[0]!, 4), SP.palette)).not.toBe(rasterCells(SP.frames[0]!, SP.palette))
})

// 미리 구운 그림이 있는 테마(기본 Clawd): 옮긴 그림은 제작 단계에서 구운 png.shift["장면:dx"](clawd-src/bake_shift.py).
// 실제 파일의 구운 그림이 png.plain 을 픽셀 그대로 옮긴 것인지는 tests/theme_files_test.py 가 본다
test('미리 구운 그림: dx 0 은 plain 그대로, dx 는 shift 표에서 찾고, 없으면 옮기지 않은 그림(실행 중에 PNG 를 풀지 않는다)', () => {
  const sp = { ...SP, png: { plain: ['P0', 'P1'], shift: { '0:5': 'P0>5', '1:2': 'P1>2' } } } as unknown as Sprites
  expect(bigPng(sp, 0)).toBe('P0')
  expect(bigPng(sp, 0, 0)).toBe('P0')
  expect(bigPng(sp, 0, 5)).toBe('P0>5')
  expect(bigPng(sp, 1, 2)).toBe('P1>2')
  expect(bigPng(sp, 1, 5)).toBe('P1') // 구운 것이 없는 조합: 옮기지 않은 그림
  expect(bigPng(sp, 7, 5)).toBe('P0') // 없는 장면은 첫 장(옮기지 않음)
  const bare = { ...SP, png: { plain: ['P0'] } } as unknown as Sprites
  expect(bigPng(bare, 0, 5)).toBe('P0') // shift 표가 없는 옛 묶음
  // 읽을 때 shift 는 문자열 값만 받는다
  const n = normalizeBig({ ...SP, png: { plain: ['P0'], shift: { '0:5': 'A', '0:4': 3, '0:3': '' } } })
  expect(n.png.shift).toEqual({ '0:5': 'A' })
  expect(normalizeBig({ ...SP, png: { plain: ['P0'], shift: ['x'] } }).png.shift).toEqual({})
})
