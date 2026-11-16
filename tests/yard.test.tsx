import { expect, test } from 'claude-code/testing'

import type { Sprites } from '../hooks/clawd'
import { GRASS_RGB, YARD, YARD_BG_ROWS, sceneKey, todOf, yardCount, yardFrame, yardFrames, yardPlan, yardScenePng, yardStripPng, yardStripSize } from '../hooks/yard'
import { decodePng, unbase64 } from './helpers'

// 놀이터 띠: 마리 수, 자리, 원래 도트 그대로(뒤집기 포함) 한 장으로 합쳐지는지.
// 실행: claude plugin test .

const row = (s: string) => s + '.'.repeat(38 - s.length)
const blank = () => Array.from({ length: 32 }, () => row(''))
// 장면 i: 맨 윗줄 왼쪽 끝에 a 한 점, 둘째 줄 (i+1)번째 칸에 b 한 점
const frame = (i: number) => blank().map((r, y) => (y === 0 ? row('a') : y === 1 ? row('.'.repeat(i + 1) + 'b') : r))
const SPRITES = {
  canvas: [38, 32], box: [19, 8], palette: { a: '#D97757', b: '#000000' },
  frames: Array.from({ length: 40 }, (_, i) => frame(i % 30)),
  states: Object.fromEntries(['bubble', 'kite', 'coffee', 'happy', 'idle'].map((k, i) => [k, { label: k, ms: 100, seq: [i, i + 10] }])),
  png: { plain: [], sticker: [] },
} as unknown as Sprites

test('마리 수와 자리: 폭에 고르게, 첫 마리는 왼쪽 끝 · 마지막은 오른쪽 끝', async () => {
  expect(yardCount(55)).toBe(5)
  expect(yardCount(44)).toBe(4)
  expect(yardCount(8)).toBe(0)
  const { wd, xs } = yardPlan(55, 5, 38)
  expect(wd).toBe(239) // 55칸 × 4.35 도트
  expect(xs[0]).toBe(0)
  expect(xs[4]).toBe(wd - 38)
  const gaps = xs.slice(1).map((x, i) => x - xs[i]!)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
})

test('장면 고르기: 마리마다 어긋나게 돌고, 멈추면 첫 장면', async () => {
  const st = { ms: 100, seq: [3, 4, 5] }
  expect(yardFrame(st, 0, 0, false)).toBe(3)
  expect(yardFrame(st, 100, 0, false)).toBe(4)
  expect(yardFrame(st, 0, 250, true)).toBe(3)
  expect(yardFrames(SPRITES, 5, 0, false)).toHaveLength(5)
})

test('띠 PNG: 원래 도트가 3배로, 마리마다 제자리에, 뒤집힌 마리는 좌우가 바뀌어 찍힌다', async () => {
  const frames = [0, 1, 2, 3, 4]
  const d = decodePng(unbase64(yardStripPng(SPRITES, frames, 55)))
  expect([d.w, d.h]).toEqual([239 * 3, 32 * 3])
  expect(yardStripSize(SPRITES, 55, 5)).toEqual({ w: 717, h: 96 })
  expect(d.palette).toEqual([0, 0xd97757, 0x000000, GRASS_RGB])
  const at = (x: number, y: number) => d.px[y * d.w + x]
  const { xs } = yardPlan(55, 5, 38)
  frames.forEach((f, i) => {
    const flip = YARD[i]!.flip
    const ax = (xs[i]! + (flip ? 37 : 0)) * 3, bx = (xs[i]! + (flip ? 37 - (f + 1) : f + 1)) * 3
    expect(at(ax, 0)).toBe(1); expect(at(ax + 2, 2)).toBe(1) // a 점(3×3 픽셀)
    expect(at(bx, 3)).toBe(2); expect(at(bx + 2, 5)).toBe(2) // b 점은 둘째 도트 줄
    expect(at(bx, 6)).toBe(0) // 그 아래는 투명
  })
  // 풀밭: 맨 아랫줄 도트 한 줄(3픽셀)이 폭 전체, 그 윗줄은 비어 있다
  for (const x of [0, 300, d.w - 1]) { expect(at(x, d.h - 1)).toBe(3); expect(at(x, d.h - 3)).toBe(3); expect(at(x, d.h - 4)).toBe(0) }
  expect(YARD.some(m => m.flip)).toBe(true)
  // 빈 곳이 대부분이라 작게 줄어든다(터미널로 보내는 양)
  expect(yardStripPng(SPRITES, frames, 55).length).toBeLessThan(3000)
  // 같은 장면이면 다시 만들지 않는다
  expect(yardStripPng(SPRITES, frames, 55)).toBe(yardStripPng(SPRITES, frames, 55))
  expect(yardStripPng(SPRITES, [0, 1, 2, 3, 5], 55)).not.toBe(yardStripPng(SPRITES, frames, 55))
})

test('배경 있는 놀이터: 9줄 그림 한 장, 시간대마다 하늘이 다르고, 구름·별은 시간에 따라 움직이며, 멈추면 그대로다', async () => {
  expect(YARD_BG_ROWS).toBe(9)
  expect(todOf(new Date(2026, 10, 16, 12, 0))).toBe('day')
  expect(todOf(new Date(2026, 10, 16, 18, 0))).toBe('dusk')
  expect(todOf(new Date(2026, 10, 16, 23, 0))).toBe('night')
  expect(todOf(new Date(2026, 10, 16, 5, 0))).toBe('night')
  const frames = [0, 1, 2, 3, 4]
  const day = decodePng(unbase64(yardScenePng(SPRITES, frames, 55, 0, false, 'day')))
  expect([day.w, day.h]).toEqual([239 * 3, 96 * 3])
  const at = (d: typeof day, x: number, y: number) => d.palette[d.px[y * d.w + x]!]
  expect(at(day, 0, 0)).toBe(0x8cc8f2) // 하늘 맨 위
  expect(at(day, 10, day.h - 1)).toBe(0x6aac52) // 풀밭이 그림 바닥까지
  expect(day.px.includes(0)).toBe(false) // 빈(투명) 점이 없다
  const night = decodePng(unbase64(yardScenePng(SPRITES, frames, 55, 0, false, 'night')))
  expect(at(night, 0, 0)).toBe(0x0f1630)
  // Clawd 의 점: 앞줄(첫 마리)은 원래 색, 뒷줄(둘째 마리)은 조금 어둡게. 밤에는 모두 어둑하게
  const { xs } = yardPlan(55, 5, 38)
  const frontTop = 86 - 30, backTop = 86 - 7 - 30
  expect(at(day, xs[0]! * 3, frontTop * 3)).toBe(0xd97757)
  expect(at(day, xs[1]! * 3, backTop * 3)).toBe(((Math.round(0xd9 * 0.86) << 16) | (Math.round(0x77 * 0.86) << 8) | Math.round(0x57 * 0.86)))
  expect(at(night, xs[0]! * 3, frontTop * 3)).toBe(((Math.round(0xd9 * 0.72) << 16) | (Math.round(0x77 * 0.72) << 8) | Math.round(0x57 * 0.72)))
  // 열쇠: 구름은 1.5초마다, 밤의 별은 0.7초마다 바뀌고, 멈춘 동안은 그대로
  expect(sceneKey(frames, 0, false, 'day')).toBe(sceneKey(frames, 1400, false, 'day'))
  expect(sceneKey(frames, 0, false, 'day')).not.toBe(sceneKey(frames, 1600, false, 'day'))
  expect(sceneKey(frames, 0, false, 'night')).not.toBe(sceneKey(frames, 800, false, 'night'))
  expect(sceneKey(frames, 0, true, 'night')).toBe(sceneKey(frames, 99999, true, 'night'))
  expect(yardScenePng(SPRITES, frames, 55, 0, false, 'day')).not.toBe(yardScenePng(SPRITES, frames, 55, 3000, false, 'day'))
  // 한 장이 작다(터미널로 보내는 양)
  expect(yardScenePng(SPRITES, frames, 55, 0, false, 'day').length).toBeLessThan(20000)
})
