// 놀이터(패널 맨 아래, 시안 16 '다섯 마리'): 원래 Clawd 도트 그림 그대로의 작은 Clawd 들이 각자 논다. 정보는 담지 않는다.
// 다섯 마리를 그림 한 장(띠)으로 합쳐 그린다: 그림을 여러 장으로 두면 패널 높이가 바뀌어 한꺼번에 자리를 옮길 때
// iTerm 이 모두 다시 받으며 갈색 네모가 번쩍였다(2026-11-16 화면 녹화). 한 장이면 옮겨도 한 장만 다시 간다.
// $ 를 쓰지 않는 순수 함수(tests/yard.test.tsx).
import type { ClawdAct } from '../types'
import { base64 } from './clawd'
import type { Sprites } from './clawd'
import { encodeIndexedPng } from './png'

export const YARD_ROWS = 3
export const YARD: readonly { state: ClawdAct; flip: boolean; phase: number }[] = [
  { state: 'bubble', flip: false, phase: 0 },
  { state: 'kite', flip: false, phase: 400 },
  { state: 'coffee', flip: true, phase: 900 },
  { state: 'happy', flip: false, phase: 1300 },
  { state: 'idle', flip: false, phase: 200 },
]
/** 한 마리가 차지하는 칸 폭(마리 수를 정할 때) */
export const YARD_COLS = 9
/** 패널 폭에 들어가는 마리 수 */
export const yardCount = (bodyColumns: number) => Math.max(0, Math.min(YARD.length, Math.floor(bodyColumns / YARD_COLS)))

/** 놀이터 한 마리의 지금 장면. 마리마다 phase 만큼 어긋나게 돌고, 멈춘 동안은 첫 장면 */
export const yardFrame = (st: { ms: number; seq: number[] } | undefined, phase: number, now: number, frozen: boolean) => {
  if (!st || !st.seq.length) return 0
  if (frozen) return st.seq[0] ?? 0
  return st.seq[Math.floor((now + phase) / Math.max(1, st.ms)) % st.seq.length] ?? 0
}
/** 지금 시각에 각 마리가 보일 장면 번호들 */
export const yardFrames = (sprites: Sprites, n: number, now: number, frozen: boolean) =>
  YARD.slice(0, n).map(m => yardFrame(sprites.states[m.state], m.phase, now, frozen))

// 띠의 크기. 도트 하나를 SCALE 픽셀로, 한 칸은 가로 DOTS_PER_COL 도트(세 줄 = 도트 32개 높이, Monaco 12 의 칸 비율 기준).
// 칸 비율이 다른 글꼴에서는 iTerm 이 비율을 지켜 줄여서, 띠가 왼쪽에 붙고 오른쪽이 조금 남는다
const SCALE = 3
// 4.35: 이 맥(칸 14×34px)의 딱 맞는 값 4.39 보다 조금 작게. 그림이 칸 상자보다 살짝 좁으면 iTerm 이 높이에 맞춰 그려
// 그림 아래가 비지 않고(풀밭이 바닥에 붙는다) 오른쪽 끝이 반 칸쯤 남는다. 크면 폭에 맞춰져 아래가 몇 픽셀 뜬다(0.5.10 실측)
const DOTS_PER_COL = 4.35
/** 풀밭 선의 색. 발 바로 밑(그림판 맨 아랫줄)에 띠 폭 전체로 그어, 패널 바닥에 붙는다 */
export const GRASS_RGB = 0x4eba65
/** 띠의 도트 폭과 각 마리의 왼쪽 자리(고르게 벌림) */
export const yardPlan = (cols: number, n: number, dotsWide: number) => {
  const wd = Math.max(dotsWide, Math.round(cols * DOTS_PER_COL))
  const xs = Array.from({ length: n }, (_, i) => (n <= 1 ? 0 : Math.round((i * (wd - dotsWide)) / (n - 1))))
  return { wd, xs }
}

let memo = { key: '', png: '' }
/**
 * 놀이터 띠 PNG(base64). frames 는 마리별 장면 번호, cols 는 띠의 칸 폭.
 * 원래 도트(sprites.frames)와 색(sprites.palette)을 그대로 쓰고, flip 인 마리는 좌우를 뒤집어 찍는다.
 */
export const yardStripPng = (sprites: Sprites, frames: number[], cols: number) => {
  const key = `${cols}:${frames.join(',')}`
  if (memo.key === key) return memo.png
  const [dw, dh] = sprites.canvas
  const { wd, xs } = yardPlan(cols, frames.length, dw)
  const W = wd * SCALE, H = dh * SCALE
  const letters = Object.keys(sprites.palette).sort()
  const index: Record<string, number> = {}
  letters.forEach((k, i) => { index[k] = i + 1 })
  const palette = [0, ...letters.map(k => parseInt(sprites.palette[k]!.replace('#', ''), 16) & 0xffffff), GRASS_RGB]
  const px = new Uint8Array(W * H)
  px.fill(palette.length - 1, (dh - 1) * SCALE * W) // 맨 아랫줄 도트 한 줄이 풀밭(Clawd 의 발은 그 윗줄까지 온다)
  frames.forEach((f, i) => {
    const rows = sprites.frames[f] ?? sprites.frames[0] ?? []
    const flip = YARD[i]?.flip ?? false
    for (let y = 0; y < dh; y++) {
      const row = rows[y] ?? ''
      for (let x = 0; x < dw; x++) {
        const c = index[row[x] ?? '.']
        if (!c) continue
        const X = (xs[i]! + (flip ? dw - 1 - x : x)) * SCALE, Y = y * SCALE
        for (let sy = 0; sy < SCALE; sy++) px.fill(c, (Y + sy) * W + X, (Y + sy) * W + X + SCALE)
      }
    }
  })
  memo = { key, png: base64(encodeIndexedPng(W, H, px, palette)) }
  return memo.png
}
/** 띠 PNG 의 픽셀 크기(시험·설명용) */
export const yardStripSize = (sprites: Sprites, cols: number, n: number) => {
  const { wd } = yardPlan(cols, n, sprites.canvas[0])
  return { w: wd * SCALE, h: sprites.canvas[1] * SCALE }
}

// ── 배경 있는 놀이터(시안 15): 하늘(낮·저녁·밤)·해나 달과 별·흘러가는 구름·언덕 두 겹·나무·풀밭 위에 Clawd 들 ──
// 9줄 높이의 그림 한 장. 색 번호 그림이라 납작한 색이 많아 한 장이 수 KB 로 줄어든다.
export const YARD_BG_ROWS = 9
export type Tod = 'day' | 'dusk' | 'night'
export const todOf = (d: Date): Tod => { const h = d.getHours(); return h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night' }
const THEME: Record<Tod, { sky: [number, number]; far: number; near: number; grass: number; tuft: number; trunk: number; leaf: number; leaf2: number; cloud: number; cloud2: number; orb: number; dim: number }> = {
  day:   { sky: [0x8cc8f2, 0xd8eefb], far: 0x9fcf9a, near: 0x7dbb6e, grass: 0x6aac52, tuft: 0x4f8f3c, trunk: 0x7a5230, leaf: 0x4f9a4a, leaf2: 0x6cbf5f, cloud: 0xffffff, cloud2: 0xe3eef6, orb: 0xffec96, dim: 1 },
  dusk:  { sky: [0xf59a6e, 0xffd9a8], far: 0xc48a6c, near: 0xa5765c, grass: 0x8a8d4c, tuft: 0x6d703a, trunk: 0x5e3d24, leaf: 0x6d7a3d, leaf2: 0x8a9650, cloud: 0xffe2c8, cloud2: 0xf4c3a6, orb: 0xffc86e, dim: 0.92 },
  night: { sky: [0x0f1630, 0x26335c], far: 0x1f2b45, near: 0x253552, grass: 0x284236, tuft: 0x1c3329, trunk: 0x3a2a1c, leaf: 0x23402f, leaf2: 0x2d5039, cloud: 0x3a4672, cloud2: 0x2f3a63, orb: 0xfff0be, dim: 0.72 },
}
/** 배경 있는 장면의 맨 아랫줄(풀밭) 색. 바닥 아래 빈 줄을 이 색 글자 칸으로 채운다(register.tsx 의 땅) */
export const groundRgb = (tod: Tod) => THEME[tod].grass
/** 놀이터 아래를 채우는 흙 색: 풀밭 색을 어둡게(초록이 너무 많아 보였다, 사용자 2026-11-16) */
export const soilRgb = (tod: Tod) => {
  const g = groundRgb(tod), dk = (c: number) => Math.round(c * 0.45)
  return (dk((g >> 16) & 255) << 16) | (dk((g >> 8) & 255) << 8) | dk(g & 255)
}
const ch = (c: number, s: number) => (c >> s) & 255
const lerp = (a: number, b: number, t: number) =>
  (Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t) << 16) | (Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t) << 8) | Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t)
const dimc = (c: number, k: number) => (Math.round(ch(c, 16) * k) << 16) | (Math.round(ch(c, 8) * k) << 8) | Math.round(ch(c, 0) * k)
// 색 번호: 1~6 하늘 띠, 그다음 아래 이름들, 그 뒤로 Clawd 색(앞줄), Clawd 색(뒷줄: 조금 어둡게)
const SKY = 6
const I = { far: 7, near: 8, grass: 9, tuft: 10, trunk: 11, leaf: 12, leaf2: 13, cloud: 14, cloud2: 15, orb: 16, star: 17, starDim: 18, fy: 19, fp: 20, fw: 21, sprite: 22 }
const SCENE_H = 96 // 도트(9줄)
const GROUND = 86 // 앞줄 Clawd 의 발이 닿는 높이
const disc = (g: Uint8Array, W: number, cx: number, cy: number, r: number, f: (dx: number, dy: number) => number) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue
    const x = cx + dx, y = cy + dy
    if (x < 0 || y < 0 || x >= W || y >= SCENE_H) continue
    const v = f(dx, dy)
    if (v) g[y * W + x] = v
  }
}
let baseMemo: { key: string; g: Uint8Array } = { key: '', g: new Uint8Array(0) }
// 움직이지 않는 바탕(하늘·해나 달·언덕·나무·풀밭·꽃). 폭과 시간대가 같으면 다시 쓴다
const sceneBase = (W: number, tod: Tod) => {
  const key = `${W}:${tod}`
  if (baseMemo.key === key) return baseMemo.g
  const g = new Uint8Array(W * SCENE_H)
  for (let y = 0; y < SCENE_H; y++) g.fill(1 + Math.min(SKY - 1, Math.floor((y / (GROUND - 10)) * SKY)), y * W, (y + 1) * W)
  if (tod === 'day') disc(g, W, W - 23, 14, 6, () => I.orb)
  if (tod === 'dusk') disc(g, W, Math.round(W * 0.72), 60, 10, () => I.orb)
  if (tod === 'night') disc(g, W, W - 37, 18, 7, (dx, dy) => ((dx - 3) * (dx - 3) + (dy + 2) * (dy + 2) > 36 ? I.orb : 0))
  for (let x = 0; x < W; x++) {
    const h1 = Math.round(58 + 6 * Math.sin(x * 0.045 + 1) + 3 * Math.sin(x * 0.11))
    for (let y = h1; y < SCENE_H; y++) g[y * W + x] = I.far
    const h2 = Math.round(70 + 5 * Math.sin(x * 0.06 + 3) + 2 * Math.sin(x * 0.17))
    for (let y = h2; y < SCENE_H; y++) g[y * W + x] = I.near
  }
  for (let y = 58; y < GROUND - 4; y++) g.fill(I.trunk, y * W + W - 15, y * W + W - 11)
  for (const [cx, cy, r] of [[W - 13, 50, 11], [W - 23, 56, 8], [W - 4, 56, 8], [W - 13, 60, 9]] as const)
    disc(g, W, cx, cy, r, (dx, dy) => (dx + dy < -r * 0.5 ? I.leaf2 : I.leaf))
  for (let y = GROUND - 6; y < SCENE_H; y++) g.fill(I.grass, y * W, (y + 1) * W)
  for (let x = 2; x + 2 < W; x += 7) { g[(GROUND - 7) * W + x] = I.tuft; g[(GROUND - 8) * W + x + 1] = I.tuft; g[(GROUND - 7) * W + x + 2] = I.tuft }
  const fl = [[0.14, 92, I.fy], [0.34, 94, I.fp], [0.54, 93, I.fy], [0.72, 91, I.fw], [0.92, 94, I.fp]] as const
  for (const [fx, fy, c] of fl) { const x = Math.round(W * fx); g[fy * W + x] = c; g[fy * W + x + 1] = c }
  baseMemo = { key, g }
  return g
}
// ── 놀이터의 작은 생물(시안 B1 밤하늘·B3 낮의 생물, 2026-11-17) ──
// 밤: 가끔 별똥별 하나(짧게), 풀밭 위 반딧불이 몇 마리가 깜빡인다. 낮·저녁: 가끔 새떼가 하늘을 건너고, 낮에는 나비 두세 마리가 풀밭 위를 난다.
// 띠를 그리는 시각(now)만으로 자리를 정하고, 열쇠(sceneKey)에 이미 있는 시간 칸만 쓴다: 낮·저녁은 구름과 같은 1.5초 칸, 밤은 별 반짝임과 같은 0.7초 칸.
// 그래서 열쇠가 같으면 그림도 같고 띠를 보내는 횟수는 늘지 않는다(새 타이머 없음). 멈춘 동안은 지나가는 것(별똥별·새떼)은 없고 나머지는 제자리에 멈춘다.
export const NIGHT_MS = 700
export const DAY_MS = 1500
const METEOR_EVERY = 64 // 밤 칸(0.7초) 64개(약 45초)마다 한 번 제비뽑기: 55% 로 별똥별이 4칸(2.8초) 지나간다
const FLOCK_EVERY = 150 // 낮 칸(1.5초) 150개(3분 45초)마다 한 번 제비뽑기: 80% 로 새떼가 한 번 건넌다
const FLOCK_SPEED = 6 // 새떼가 한 칸에 가는 도트
/** 0 이상 1 미만의 고른 수(정수 → 늘 같은 값) */
const hash = (n: number) => {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
export type YardLife = {
  meteor: { x: number; y: number; k: number } | null
  fireflies: { x: number; y: number; lit: 0 | 1 | 2 }[]
  birds: { x: number; y: number; up: boolean }[]
  butterflies: { x: number; y: number; open: boolean; c: number }[]
}
/** 도트 폭 W 인 장면에서 지금 보일 생물들의 자리(순수 함수, 시험용으로도 쓴다) */
export const yardLife = (W: number, now: number, frozen: boolean, tod: Tod): YardLife => {
  const life: YardLife = { meteor: null, fireflies: [], birds: [], butterflies: [] }
  if (tod === 'night') {
    const t = frozen ? 0 : Math.floor(now / NIGHT_MS)
    const c = Math.floor(t / METEOR_EVERY), k = (t % METEOR_EVERY) - (8 + Math.floor(hash(c * 2 + 1) * 48))
    if (!frozen && hash(c * 2) < 0.55 && k >= 0 && k < 4)
      life.meteor = { x: Math.round(W * (0.3 + 0.6 * hash(c * 2 + 7))) - 9 * k, y: 5 + Math.floor(hash(c * 2 + 9) * 10) + 3 * k, k }
    const n = Math.max(2, Math.min(4, Math.round(W / 60)))
    for (let i = 0; i < n; i++) {
      const ax = Math.round((W * (i + 0.5)) / n + (hash(i * 13 + 5) - 0.5) * (W / n) * 0.6), ay = 87 + Math.floor(hash(i * 17 + 3) * 4)
      const ph = (t + i * 3) % 6
      life.fireflies.push({ x: ax + Math.round(3 * Math.sin(t * 0.45 + i * 2.1)), y: ay + Math.round(2 * Math.sin(t * 0.7 + i * 1.3)), lit: ph < 2 ? 2 : ph < 4 ? 1 : 0 })
    }
    return life
  }
  const t = frozen ? 0 : Math.floor(now / DAY_MS)
  const dur = Math.ceil((W + 40) / FLOCK_SPEED), c = Math.floor(t / FLOCK_EVERY)
  const k = (t % FLOCK_EVERY) - Math.floor(hash(c * 3 + 11) * Math.max(1, FLOCK_EVERY - dur))
  if (!frozen && hash(c * 3 + 12) < 0.8 && k >= 0 && k < dur) {
    const dir = hash(c * 3 + 13) < 0.5 ? -1 : 1, y0 = 14 + Math.floor(hash(c * 3 + 14) * 16)
    const lead = dir > 0 ? -20 + FLOCK_SPEED * k : W + 20 - FLOCK_SPEED * k
    const flock = W >= 150 ? [[0, 0], [-7, -3], [-8, 3], [-14, -5]] : [[0, 0], [-7, -3], [-8, 3]]
    flock.forEach(([dx, dy], j) => life.birds.push({ x: lead + dx! * dir, y: y0 + dy!, up: (t + j) % 2 === 0 }))
  }
  if (tod === 'day') {
    const n = Math.max(1, Math.min(3, Math.round(W / 80)))
    for (let i = 0; i < n; i++) {
      const ax = Math.round(W * (n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1)))
      life.butterflies.push({ x: ax + Math.round(8 * Math.sin(t * 0.21 + i * 2.4)), y: 87 + Math.round(2 * Math.sin(t * 0.5 + i * 1.7)), open: (t + i) % 2 === 0, c: i % 3 })
    }
  }
  return life
}
const BIRD = { up: ['X...X', '.X.X.', '..X..'], down: ['.....', 'XX.XX', '..X..'] }
const FLY = { open: ['WW.WW', 'WWbWW', '.W.W.'], shut: ['.W.W.', '.WbW.', '..b..'] } // 나비: 날개를 폈다(5칸) 접었다(위로 모아 3칸)

/** 장면의 열쇠: 이것이 같으면 그림도 같다(Clawd 장면들·구름 자리·별 반짝임·시간대. 생물(yardLife)도 이 시간 칸만 쓴다) */
export const sceneKey = (frames: number[], now: number, frozen: boolean, tod: Tod) =>
  `${tod}:${frames.join(',')}:${frozen ? 0 : Math.floor(now / 1500)}${tod === 'night' && !frozen ? `:${Math.floor(now / 700)}` : ''}`
let sceneMemo = { key: '', png: '' }
/** 배경 있는 놀이터 PNG(base64). 뒷줄(둘째·넷째 마리)은 조금 위에, 조금 어둡게 선다 */
export const yardScenePng = (sprites: Sprites, frames: number[], cols: number, now: number, frozen: boolean, tod: Tod) => {
  const key = `${cols}:${sceneKey(frames, now, frozen, tod)}`
  if (sceneMemo.key === key) return sceneMemo.png
  const [dw, dh] = sprites.canvas
  const { wd: W, xs } = yardPlan(cols, frames.length, dw)
  const T = THEME[tod]
  const letters = Object.keys(sprites.palette).sort()
  const index: Record<string, number> = {}
  letters.forEach((k, i) => { index[k] = i })
  const cols24 = letters.map(k => parseInt(sprites.palette[k]!.replace('#', ''), 16) & 0xffffff)
  const palette = [
    0, ...Array.from({ length: SKY }, (_, i) => lerp(T.sky[0], T.sky[1], i / (SKY - 1))),
    T.far, T.near, T.grass, T.tuft, T.trunk, T.leaf, T.leaf2, T.cloud, T.cloud2, T.orb, 0xfff6c8, lerp(T.sky[0], 0xfff6c8, 0.35),
    dimc(0xffdc78, T.dim), dimc(0xffaabe, T.dim), dimc(0xffffff, T.dim),
    ...cols24.map(c => dimc(c, T.dim)), ...cols24.map(c => dimc(c, T.dim * 0.86)),
  ]
  const g = Uint8Array.from(sceneBase(W, tod))
  const r = W / 207, step = frozen ? 0 : now
  if (tod === 'night') {
    const st = [[14, 8], [40, 20], [70, 6], [102, 16], [130, 9], [158, 24], [186, 12], [24, 34], [116, 30], [196, 30]] as const
    st.forEach(([sx, sy], i) => {
      const x = Math.round(sx * r), on = (Math.floor(step / 700) + i) % 4 !== 0
      if (x < 1 || x >= W - 1 || g[sy * W + x]! > SKY) return // 달 위에는 찍지 않는다
      g[sy * W + x] = on ? I.star : I.starDim
      if (on && i % 3 === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (g[(sy + dy) * W + x + dx]! <= SKY) g[(sy + dy) * W + x + dx] = I.starDim
    })
  }
  const life = yardLife(W, now, frozen, tod)
  const put = (x: number, y: number, c: number, skyOnly = false) => {
    if (x < 0 || y < 0 || x >= W || y >= SCENE_H || (skyOnly && g[y * W + x]! > SKY)) return
    g[y * W + x] = c
  }
  const glyph = (rows: readonly string[], x: number, y: number, color: (ch: string) => number) => {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') put(x + i, y + j, color(row[i]!)) })
  }
  if (life.meteor) { // 별똥별: 왼쪽 아래로 가는 밝은 머리와 오른쪽 위로 끌리는 꼬리, 하늘에만(언덕·달 뒤로 지나간다). 마지막 칸은 꼬리만 흐리게
    const { x, y, k } = life.meteor, tail = k === 0 ? 3 : 8
    for (let i = 1; i <= tail; i++) put(x + i, y - Math.round(i / 3), i <= 2 && k < 3 ? I.star : I.starDim, true)
    if (k < 3) put(x, y, I.star, true)
  }
  const drift = Math.floor(step / 1500)
  for (const [bx, by] of [[30, 16], [120, 26], [200, 10]] as const) {
    const cx0 = ((Math.round(bx * r) + drift) % (W + 30)) - 15
    for (const [dx, dy, rr] of [[0, 0, 5], [6, -2, 6], [12, 0, 5], [5, 2, 5]] as const)
      disc(g, W, cx0 + dx, by + dy, rr, (_x, y) => (y > rr * 0.4 ? I.cloud2 : I.cloud))
  }
  for (const b of life.birds) glyph(b.up ? BIRD.up : BIRD.down, b.x - 2, b.y - 1, () => I.trunk) // 새떼: 구름 앞으로, 날갯짓은 칸마다
  // 뒷줄 먼저, 앞줄 나중
  const order = frames.map((_, i) => i).sort((a, b) => (b % 2) - (a % 2))
  for (const i of order) {
    const back = i % 2 === 1, rows = sprites.frames[frames[i]!] ?? sprites.frames[0] ?? [], flip = YARD[i]?.flip ?? false
    const top = (back ? GROUND - 7 : GROUND) - (dh - 2), off = I.sprite + (back ? letters.length : 0)
    for (let y = 0; y < dh; y++) {
      const row = rows[y] ?? '', Y = top + y
      if (Y < 0 || Y >= SCENE_H) continue
      for (let x = 0; x < dw; x++) {
        const li = index[row[x] ?? '.']
        if (li === undefined) continue
        g[Y * W + xs[i]! + (flip ? dw - 1 - x : x)] = off + li
      }
    }
  }
  // 앞쪽 풀밭(앞줄 발보다 아래)의 반딧불이·나비는 Clawd 앞에
  for (const f of life.fireflies) {
    if (!f.lit) continue
    put(f.x, f.y, f.lit === 2 ? I.star : I.fy)
    if (f.lit === 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(f.x + dx, f.y + dy, I.fy)
  }
  const wing = [I.fp, I.fy, I.fw]
  for (const b of life.butterflies) glyph(b.open ? FLY.open : FLY.shut, b.x - 2, b.y - 1, ch => (ch === 'b' ? I.trunk : wing[b.c]!))
  // 도트를 SCALE 배로
  const PW = W * SCALE, px = new Uint8Array(PW * SCENE_H * SCALE), line = new Uint8Array(PW)
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < W; x++) line.fill(g[y * W + x]!, x * SCALE, (x + 1) * SCALE)
    for (let sy = 0; sy < SCALE; sy++) px.set(line, (y * SCALE + sy) * PW)
  }
  sceneMemo = { key, png: base64(encodeIndexedPng(PW, SCENE_H * SCALE, px, palette)) }
  return sceneMemo.png
}
