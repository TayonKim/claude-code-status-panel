import { expect, test } from 'claude-code/testing'

import type { Sprites } from '../hooks/clawd'
import { DAY_MS, GRASS_RGB, NIGHT_MS, YARD, YARD_BG_ROWS, sceneKey, todOf, yardCount, yardFrame, yardFrames, yardLife, yardPlan, yardScenePng, yardStripPng, yardStripSize } from '../hooks/yard'
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

// 놀이터의 작은 생물(시안 B1·B3): 밤 별똥별·반딧불이, 낮·저녁 새떼, 낮 나비
test('생물: 시간대마다 맞는 것만 나온다', async () => {
  const W = yardPlan(55, 5, 38).wd
  const seen = (tod: 'day' | 'dusk' | 'night', ms: number, n: number) => {
    const s = { meteor: 0, fireflies: 0, birds: 0, butterflies: 0 }
    for (let i = 0; i < n; i++) {
      const l = yardLife(W, 1_000_000_000 + i * ms, false, tod)
      s.meteor += l.meteor ? 1 : 0; s.fireflies += l.fireflies.length; s.birds += l.birds.length; s.butterflies += l.butterflies.length
    }
    return s
  }
  const night = seen('night', NIGHT_MS, 3000), day = seen('day', DAY_MS, 600), dusk = seen('dusk', DAY_MS, 600)
  expect(night.meteor).toBeGreaterThan(0)
  expect(night.meteor / 3000).toBeLessThan(0.1) // 드물게: 시간의 10% 미만
  expect(night.fireflies).toBe(3000 * 4)
  expect(night.birds + night.butterflies).toBe(0)
  expect(day.birds).toBeGreaterThan(0)
  expect(day.butterflies).toBe(600 * 3)
  expect(day.meteor + day.fireflies).toBe(0)
  expect(dusk.birds).toBeGreaterThan(0)
  expect(dusk.butterflies + dusk.meteor + dusk.fireflies).toBe(0)
  // 새떼는 늘 있는 게 아니라 가끔 건넌다
  let withBirds = 0
  for (let i = 0; i < 600; i++) if (yardLife(W, 1_000_000_000 + i * DAY_MS, false, 'day').birds.length) withBirds++
  expect(withBirds).toBeGreaterThan(0)
  expect(withBirds).toBeLessThan(600 * 0.6)
  // 별똥별은 한 번에 4칸(2.8초)을 넘지 않는다
  let run = 0, longest = 0
  for (let i = 0; i < 3000; i++) { run = yardLife(W, i * NIGHT_MS, false, 'night').meteor ? run + 1 : 0; longest = Math.max(longest, run) }
  expect(longest).toBeGreaterThan(0)
  expect(longest).toBeLessThanOrEqual(4)
})

test('생물: now 에 따라 움직이고, 열쇠가 같으면 그대로, 멈추면 제자리', async () => {
  const W = yardPlan(55, 5, 38).wd, frames = [0, 1, 2, 3, 4]
  // 새떼: 지나가는 동안 칸마다 6도트씩 옮겨 가고 날갯짓이 바뀐다
  let t = 0
  while (!yardLife(W, t * DAY_MS, false, 'day').birds.length) t++
  const a = yardLife(W, (t + 1) * DAY_MS, false, 'day').birds, b = yardLife(W, (t + 2) * DAY_MS, false, 'day').birds
  expect(Math.abs(b[0]!.x - a[0]!.x)).toBe(6)
  expect(b[0]!.up).not.toBe(a[0]!.up)
  // 나비·반딧불이도 시간에 따라 바뀐다
  const fly = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(yardLife(W, i * DAY_MS, false, 'day').butterflies)))
  expect(fly.size).toBeGreaterThan(5)
  const ff = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(yardLife(W, i * NIGHT_MS, false, 'night').fireflies)))
  expect(ff.size).toBeGreaterThan(5)
  // 생물은 열쇠(sceneKey)에 있는 시간 칸만 쓴다: 열쇠가 같으면 생물도 같다(띠를 더 자주 보내지 않는다)
  for (const tod of ['day', 'dusk', 'night'] as const) {
    const byKey = new Map<string, string>()
    for (let now = 5_000_000; now < 5_000_000 + 60_000; now += 97) {
      const k = sceneKey(frames, now, false, tod), l = JSON.stringify(yardLife(W, now, false, tod))
      if (!byKey.has(k)) byKey.set(k, l)
      expect(byKey.get(k)).toBe(l)
    }
  }
  // 멈추면: 지나가는 것(별똥별·새떼)은 없고, 나머지는 시각이 달라도 같은 자리, 그림도 같다
  for (const tod of ['day', 'dusk', 'night'] as const) {
    const x = yardLife(W, 1234, true, tod), y = yardLife(W, 98_765_432, true, tod)
    expect(x).toEqual(y)
    expect(x.meteor).toBe(null)
    expect(x.birds).toHaveLength(0)
    expect(yardScenePng(SPRITES, frames, 55, 1234, true, tod)).toBe(yardScenePng(SPRITES, frames, 55, 98_765_432, true, tod))
  }
})

test('생물: 그림에 찍힌다(새떼는 하늘에 나무줄기 색, 반딧불이는 풀밭에 별빛 색)', async () => {
  const W = yardPlan(55, 5, 38).wd, frames = [0, 1, 2, 3, 4]
  const count = (png: string, rgb: number, y0: number, y1: number) => {
    const d = decodePng(unbase64(png)); let n = 0
    for (let y = y0 * 3; y < y1 * 3; y++) for (let x = 0; x < d.w; x++) if (d.palette[d.px[y * d.w + x]!] === rgb) n++
    return n
  }
  let t = 0
  while (!yardLife(W, t * DAY_MS, false, 'day').birds.some(b => b.x > 10 && b.x < W - 10)) t++
  expect(count(yardScenePng(SPRITES, frames, 55, t * DAY_MS, false, 'day'), 0x7a5230, 0, 45)).toBeGreaterThan(0)
  expect(count(yardScenePng(SPRITES, frames, 55, t * DAY_MS, true, 'day'), 0x7a5230, 0, 45)).toBe(0)
  let n = 0
  while (!yardLife(W, n * NIGHT_MS, false, 'night').fireflies.some(f => f.lit === 2)) n++
  expect(count(yardScenePng(SPRITES, frames, 55, n * NIGHT_MS, false, 'night'), 0xfff6c8, 80, 96)).toBeGreaterThan(0)
  expect(count(yardScenePng(SPRITES, frames, 55, n * NIGHT_MS, false, 'day'), 0xfff6c8, 80, 96)).toBe(0)
})
