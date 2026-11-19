// 놀이터 배경(장면)의 계약과 기본 Clawd 배경. 테마(themes/<id>/scene.ts)는 같은 계약으로 배경만 갈아 끼운다.
// 엔진(hooks/yard.ts yardScenePng)이 맡는 것: 그림 크기(폭 W × SCENE_H 도트, 3배로 키움), 친구 다섯을 세우는 자리(GROUND),
// 친구 색(배경 색 뒤에 앞줄·뒷줄 두 벌), 기억해 두기(바탕은 폭·시간대마다, 장면은 sceneKey 마다).
// 장면이 맡는 것: 배경 색, 움직이지 않는 바탕(base), 친구 뒤(back)·앞(front)에 그리는 움직이는 것.
//
// 계약(tests/theme.test.tsx 가 themes/index.ts 에 올린 배경 모두로 확인):
// - g 는 W × SCENE_H(96) 색 번호 판. 바닥 GROUND(86) 에 앞줄 친구 발이 닿는다. 판 밖에는 쓰지 않는다(put 이 걸러 준다).
// - 색 번호는 1 부터 colors(tod).length 까지만 쓴다. 0 은 투명이라 쓰지 않는다(base 가 판 전체를 채운다).
//   색 수는 1 + 배경 색 + 친구 색 × 2 ≤ 256(PNG 팔레트). 1 ~ sky 번은 '하늘'(별·별똥별은 하늘 위에만 찍는다).
// - 새 타이머를 만들지 않는다. now 로 움직이되 sceneKey 에 있는 시간 칸만 쓴다: 1.5초 칸(drift)과, 밤에는 0.7초 칸.
//   그래서 열쇠가 같으면 그림이 같고 띠를 보내는 횟수가 늘지 않는다. frozen 이면 step = 0 으로 멈춘다.
// - $ 를 쓰지 않는 순수 함수. 같은 입력이면 같은 그림.

export type Tod = 'day' | 'dusk' | 'night'
export const todOf = (d: Date): Tod => { const h = d.getHours(); return h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night' }

export const SCENE_H = 96 // 도트(9줄)
export const GROUND = 86 // 앞줄 친구의 발이 닿는 높이
export const NIGHT_MS = 700
export const DAY_MS = 1500

const ch = (c: number, s: number) => (c >> s) & 255
export const lerp = (a: number, b: number, t: number) =>
  (Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t) << 16) | (Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t) << 8) | Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t)
export const dimc = (c: number, k: number) => (Math.round(ch(c, 16) * k) << 16) | (Math.round(ch(c, 8) * k) << 8) | Math.round(ch(c, 0) * k)
/** 둥근 덩어리. f 가 0 이면 그 점은 건드리지 않는다 */
export const disc = (g: Uint8Array, W: number, cx: number, cy: number, r: number, f: (dx: number, dy: number) => number) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue
    const x = cx + dx, y = cy + dy
    if (x < 0 || y < 0 || x >= W || y >= SCENE_H) continue
    const v = f(dx, dy)
    if (v) g[y * W + x] = v
  }
}
/** 0 이상 1 미만의 고른 수(정수 → 늘 같은 값) */
export const hash = (n: number) => {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// ── 놀이터의 작은 생물(시안 B1 밤하늘·B3 낮의 생물, 2026-11-17) ──
// 밤: 가끔 별똥별 하나(짧게), 풀밭 위 반딧불이 몇 마리가 깜빡인다. 낮·저녁: 가끔 새떼가 하늘을 건너고, 낮에는 나비 두세 마리가 풀밭 위를 난다.
// 띠를 그리는 시각(now)만으로 자리를 정하고, 열쇠(sceneKey)에 이미 있는 시간 칸만 쓴다: 낮·저녁은 구름과 같은 1.5초 칸, 밤은 별 반짝임과 같은 0.7초 칸.
// 그래서 열쇠가 같으면 그림도 같고 띠를 보내는 횟수는 늘지 않는다(새 타이머 없음). 멈춘 동안은 지나가는 것(별똥별·새떼)은 없고 나머지는 제자리에 멈춘다.
const METEOR_EVERY = 64 // 밤 칸(0.7초) 64개(약 45초)마다 한 번 제비뽑기: 55% 로 별똥별이 4칸(2.8초) 지나간다
const FLOCK_EVERY = 150 // 낮 칸(1.5초) 150개(3분 45초)마다 한 번 제비뽑기: 80% 로 새떼가 한 번 건넌다
const FLOCK_SPEED = 6 // 새떼가 한 칸에 가는 도트
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

/** 움직이는 것을 그릴 때 엔진이 넘기는 것 */
export type SceneCtx = {
  W: number
  tod: Tod
  now: number
  frozen: boolean
  /** frozen 이면 0, 아니면 now */
  step: number
  /** 1.5초 칸 번호(구름이 흘러간 도트 수) */
  drift: number
  /** 폭 비율(W / 207: 55칸 패널의 장면 폭을 1 로) */
  r: number
  /** 이 시각의 생물 자리(yardLife). 쓰든 말든 장면 마음 */
  life: YardLife
  /** 판 안이면 찍는다. skyOnly 면 하늘(1~sky 번) 위에만 */
  put: (x: number, y: number, c: number, skyOnly?: boolean) => void
  /** 글자 그림('.' 은 건너뜀)을 (x, y) 부터 찍는다 */
  glyph: (rows: readonly string[], x: number, y: number, color: (ch: string) => number) => void
}
export type YardScene = {
  /** 배경 색(0xRRGGBB). i 번째가 색 번호 i + 1. 친구 색은 그 뒤에 붙는다 */
  colors: (tod: Tod) => number[]
  /** 1 ~ sky 번 색이 하늘 */
  sky: number
  /** 친구를 물들이는 밝기(1 이면 원래 색, 뒷줄은 이것의 0.86 배) */
  dim: (tod: Tod) => number
  /** 맨 아랫줄(풀밭) 색. 바닥 아래 빈 줄을 이 색을 어둡게 한 흙으로 채운다(register.tsx 의 땅) */
  ground: (tod: Tod) => number
  /** 움직이지 않는 바탕을 판에 그린다(판 전체를 채울 것). 엔진이 폭·시간대마다 기억해 둔다 */
  base: (g: Uint8Array, W: number, tod: Tod) => void
  /** 친구 뒤에 그리는 움직이는 것(별·구름·새떼 등) */
  back?: (g: Uint8Array, c: SceneCtx) => void
  /** 친구 앞에 그리는 움직이는 것(풀밭의 반딧불이·나비 등) */
  front?: (g: Uint8Array, c: SceneCtx) => void
}

// ── 기본 Clawd 배경(시안 15): 하늘(낮·저녁·밤)·해나 달과 별·흘러가는 구름·언덕 두 겹·나무·풀밭 ──
// 0.8.1 의 yard.ts 그대로(도트 하나까지 같다, tests/theme.test.tsx 의 고정값)
const THEME: Record<Tod, { sky: [number, number]; far: number; near: number; grass: number; tuft: number; trunk: number; leaf: number; leaf2: number; cloud: number; cloud2: number; orb: number; dim: number }> = {
  day:   { sky: [0x8cc8f2, 0xd8eefb], far: 0x9fcf9a, near: 0x7dbb6e, grass: 0x6aac52, tuft: 0x4f8f3c, trunk: 0x7a5230, leaf: 0x4f9a4a, leaf2: 0x6cbf5f, cloud: 0xffffff, cloud2: 0xe3eef6, orb: 0xffec96, dim: 1 },
  dusk:  { sky: [0xf59a6e, 0xffd9a8], far: 0xc48a6c, near: 0xa5765c, grass: 0x8a8d4c, tuft: 0x6d703a, trunk: 0x5e3d24, leaf: 0x6d7a3d, leaf2: 0x8a9650, cloud: 0xffe2c8, cloud2: 0xf4c3a6, orb: 0xffc86e, dim: 0.92 },
  night: { sky: [0x0f1630, 0x26335c], far: 0x1f2b45, near: 0x253552, grass: 0x284236, tuft: 0x1c3329, trunk: 0x3a2a1c, leaf: 0x23402f, leaf2: 0x2d5039, cloud: 0x3a4672, cloud2: 0x2f3a63, orb: 0xfff0be, dim: 0.72 },
}
// 색 번호: 1~6 하늘 띠, 그다음 아래 이름들
const SKY = 6
const I = { far: 7, near: 8, grass: 9, tuft: 10, trunk: 11, leaf: 12, leaf2: 13, cloud: 14, cloud2: 15, orb: 16, star: 17, starDim: 18, fy: 19, fp: 20, fw: 21 }
const BIRD = { up: ['X...X', '.X.X.', '..X..'], down: ['.....', 'XX.XX', '..X..'] }
const FLY = { open: ['WW.WW', 'WWbWW', '.W.W.'], shut: ['.W.W.', '.WbW.', '..b..'] } // 나비: 날개를 폈다(5칸) 접었다(위로 모아 3칸)

export const clawdScene: YardScene = {
  sky: SKY,
  dim: tod => THEME[tod].dim,
  ground: tod => THEME[tod].grass,
  colors: tod => {
    const T = THEME[tod]
    return [
      ...Array.from({ length: SKY }, (_, i) => lerp(T.sky[0], T.sky[1], i / (SKY - 1))),
      T.far, T.near, T.grass, T.tuft, T.trunk, T.leaf, T.leaf2, T.cloud, T.cloud2, T.orb, 0xfff6c8, lerp(T.sky[0], 0xfff6c8, 0.35),
      dimc(0xffdc78, T.dim), dimc(0xffaabe, T.dim), dimc(0xffffff, T.dim),
    ]
  },
  // 움직이지 않는 바탕(하늘·해나 달·언덕·나무·풀밭·꽃)
  base: (g, W, tod) => {
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
  },
  // 별(밤) → 별똥별 → 구름 → 새떼
  back: (g, { W, tod, step, r, drift, life, put, glyph }) => {
    if (tod === 'night') {
      const st = [[14, 8], [40, 20], [70, 6], [102, 16], [130, 9], [158, 24], [186, 12], [24, 34], [116, 30], [196, 30]] as const
      st.forEach(([sx, sy], i) => {
        const x = Math.round(sx * r), on = (Math.floor(step / 700) + i) % 4 !== 0
        if (x < 1 || x >= W - 1 || g[sy * W + x]! > SKY) return // 달 위에는 찍지 않는다
        g[sy * W + x] = on ? I.star : I.starDim
        if (on && i % 3 === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (g[(sy + dy) * W + x + dx]! <= SKY) g[(sy + dy) * W + x + dx] = I.starDim
      })
    }
    if (life.meteor) { // 별똥별: 왼쪽 아래로 가는 밝은 머리와 오른쪽 위로 끌리는 꼬리, 하늘에만(언덕·달 뒤로 지나간다). 마지막 칸은 꼬리만 흐리게
      const { x, y, k } = life.meteor, tail = k === 0 ? 3 : 8
      for (let i = 1; i <= tail; i++) put(x + i, y - Math.round(i / 3), i <= 2 && k < 3 ? I.star : I.starDim, true)
      if (k < 3) put(x, y, I.star, true)
    }
    for (const [bx, by] of [[30, 16], [120, 26], [200, 10]] as const) {
      const cx0 = ((Math.round(bx * r) + drift) % (W + 30)) - 15
      for (const [dx, dy, rr] of [[0, 0, 5], [6, -2, 6], [12, 0, 5], [5, 2, 5]] as const)
        disc(g, W, cx0 + dx, by + dy, rr, (_x, y) => (y > rr * 0.4 ? I.cloud2 : I.cloud))
    }
    for (const b of life.birds) glyph(b.up ? BIRD.up : BIRD.down, b.x - 2, b.y - 1, () => I.trunk) // 새떼: 구름 앞으로, 날갯짓은 칸마다
  },
  // 앞쪽 풀밭(앞줄 발보다 아래)의 반딧불이·나비는 친구 앞에
  front: (_g, { life, put, glyph }) => {
    for (const f of life.fireflies) {
      if (!f.lit) continue
      put(f.x, f.y, f.lit === 2 ? I.star : I.fy)
      if (f.lit === 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(f.x + dx, f.y + dy, I.fy)
    }
    const wing = [I.fp, I.fy, I.fw]
    for (const b of life.butterflies) glyph(b.open ? FLY.open : FLY.shut, b.x - 2, b.y - 1, ch => (ch === 'b' ? I.trunk : wing[b.c]!))
  },
}
