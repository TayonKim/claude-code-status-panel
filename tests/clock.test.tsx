import { expect, test } from 'claude-code/testing'

import {
  BATT_CELLS, BATT_H, BATT_W, CLOCK_H, CLOCK_W, RGB, battColor, battFill, battKey, batterySource, clockSource, dateOf, drawBattery, drawClock,
  hmOf, paint, parseBatt,
} from '../hooks/clock'

// 맨 위 시계(막대 숫자 그림)·배터리 아이콘·배터리 읽기.
// 실행: claude plugin test .

const sum = (a: Float32Array) => a.reduce((n, v) => n + v, 0)
const colSum = (a: Float32Array, W: number, x0: number, x1: number) => { let n = 0; for (let i = 0; i < a.length; i++) { const x = i % W; if (x >= x0 && x < x1) n += a[i]! } return n }

test('막대 시계: 그림 크기, 획 수가 많은 숫자가 더 진하다, 콜론 점 두 개', async () => {
  const c8 = drawClock('88:88'), c1 = drawClock('11:11')
  expect(c8.length).toBe(CLOCK_W * CLOCK_H)
  expect(sum(c8)).toBeGreaterThan(sum(c1) * 2)
  expect(c8.every(v => v >= 0 && v <= 1)).toBe(true)
  // 콜론 자리(두 숫자 뒤)의 세로 줄에는 위아래로 떨어진 점 두 덩어리가 있다
  const col = Math.round(CLOCK_H * 0.08 + CLOCK_H * 0.035 + 2 * (CLOCK_H * 0.84 * 0.64) + CLOCK_H * 0.84 * 0.01)
  const ys: number[] = []
  for (let y = 0; y < CLOCK_H; y++) if (c8[y * CLOCK_W + col]! > 0.5) ys.push(y)
  expect(ys.length).toBeGreaterThan(0)
  const gaps = ys.filter((y, i) => i > 0 && y - ys[i - 1]! > 5).length
  expect(gaps).toBe(1)
  // 굵기를 올리면 더 진하다
  expect(sum(drawClock('10:49', CLOCK_W, CLOCK_H, 1.3))).toBeGreaterThan(sum(drawClock('10:49')))
  // 숫자는 그림 폭 안에 들어간다(오른쪽 끝 몇 줄은 비어 있다)
  expect(colSum(c8, CLOCK_W, CLOCK_W - 4, CLOCK_W)).toBe(0)
})

test('배터리 아이콘: 잔량만큼 채우고, 0% 는 테두리만', async () => {
  const full = drawBattery(100), half = drawBattery(50), none = drawBattery(0)
  expect(sum(full.fill)).toBeGreaterThan(sum(half.fill) * 1.6)
  expect(sum(half.fill)).toBeGreaterThan(0)
  expect(sum(none.fill)).toBe(0)
  expect(sum(none.outline)).toBeGreaterThan(0)
})

test('충전 중이면 배터리 가운데에 번개(어두운 테두리 + 흰 번개), 아니면 없음', async () => {
  const on = drawBattery(50, BATT_W, BATT_H, true), off = drawBattery(50, BATT_W, BATT_H, false)
  expect(sum(on.bolt)).toBeGreaterThan(20)
  expect(sum(on.boltEdge)).toBeGreaterThan(sum(on.bolt))
  expect(sum(off.bolt) + sum(off.boltEdge)).toBe(0)
  expect(batterySource(50, true).rgba).not.toBe(batterySource(50, false).rgba)
  expect(battKey(50, true)).toBe('50+')
  expect(battKey(50, false)).toBe('50')
})

test('그림 소스: RGBA 크기, 같은 시각·잔량이면 다시 칠하지 않는다', async () => {
  const px = paint(drawClock('10:49'), RGB.claude)
  expect(px.length).toBe(CLOCK_W * CLOCK_H * 4)
  const a = clockSource('10:49'), b = clockSource('10:49'), d = clockSource('10:50')
  expect(a).toBe(b)
  expect(d.rgba).not.toBe(a.rgba)
  expect(a).toMatchObject({ width: CLOCK_W, height: CLOCK_H })
  expect(batterySource(63)).toBe(batterySource(63))
  expect(batterySource(63)).toMatchObject({ width: BATT_W, height: BATT_H })
})

test('24시간제 시각과 날짜', async () => {
  expect(hmOf(new Date(2026, 10, 16, 9, 5))).toBe('09:05')
  expect(hmOf(new Date(2026, 10, 16, 22, 30))).toBe('22:30')
  expect(dateOf(new Date(2026, 10, 16, 9, 5))).toBe('11/16 (월)')
  expect(dateOf(new Date(2026, 0, 4, 9, 5))).toBe('1/4 (일)')
})

test('pmset 출력: 잔량·충전 중, 배터리 없는 맥은 null', async () => {
  const mac = (s: string) => `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${s} present: true\n`
  expect(parseBatt(mac('69%; discharging; 4:28 remaining'))).toEqual({ pct: 69, charging: false })
  expect(parseBatt(mac('82%; charging; 0:41 remaining'))).toEqual({ pct: 82, charging: true })
  expect(parseBatt(mac('100%; charged; 0:00 remaining'))).toEqual({ pct: 100, charging: false })
  expect(parseBatt(mac('80%; AC attached; not charging'))).toEqual({ pct: 80, charging: false })
  expect(parseBatt("Now drawing from 'AC Power'\n")).toEqual({ pct: null, charging: false })
  expect(parseBatt('')).toEqual({ pct: null, charging: false })
})

test('배터리 막대 칸과 색', async () => {
  expect(battFill(100)).toBe(BATT_CELLS)
  expect(battFill(0)).toBe(0)
  expect(battFill(69)).toBe(4)
  expect(battColor(69)).toBe('success')
  expect(battColor(20)).toBe('warning')
  expect(battColor(9)).toBe('error')
})
