// 놀이터(패널 맨 아래, 시안 16 '다섯 마리'): 원래 Clawd 도트 그림 그대로의 작은 Clawd 들이 각자 논다. 정보는 담지 않는다.
// 다섯 마리를 그림 한 장(띠)으로 합쳐 그린다: 그림을 여러 장으로 두면 패널 높이가 바뀌어 한꺼번에 자리를 옮길 때
// iTerm 이 모두 다시 받으며 갈색 네모가 번쩍였다(2026-11-16 화면 녹화). 한 장이면 옮겨도 한 장만 다시 간다.
// $ 를 쓰지 않는 순수 함수(tests/yard.test.tsx).
import type { ClawdAct } from '../types'
import { base64 } from './clawd'
import type { Sprites } from './clawd'
import { encodeIndexedPng } from './png'
import { DAY_MS, GROUND, NIGHT_MS, SCENE_H, clawdScene, dimc, todOf, yardLife } from './scene'
import type { SceneCtx, Tod, YardLife, YardScene } from './scene'

export { DAY_MS, NIGHT_MS, clawdScene, todOf, yardLife }
export type { Tod, YardLife, YardScene }

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

let memo: { key: string; png: string; sp: Sprites | null } = { key: '', png: '', sp: null }
/**
 * 놀이터 띠 PNG(base64). frames 는 마리별 장면 번호, cols 는 띠의 칸 폭.
 * 원래 도트(sprites.frames)와 색(sprites.palette)을 그대로 쓰고, flip 인 마리는 좌우를 뒤집어 찍는다.
 */
export const yardStripPng = (sprites: Sprites, frames: number[], cols: number) => {
  const key = `${cols}:${frames.join(',')}`
  if (memo.key === key && memo.sp === sprites) return memo.png
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
  memo = { key, png: base64(encodeIndexedPng(W, H, px, palette)), sp: sprites }
  return memo.png
}
/** 띠 PNG 의 픽셀 크기(시험·설명용) */
export const yardStripSize = (sprites: Sprites, cols: number, n: number) => {
  const { wd } = yardPlan(cols, n, sprites.canvas[0])
  return { w: wd * SCALE, h: sprites.canvas[1] * SCALE }
}

// ── 배경 있는 놀이터(시안 15): 배경(hooks/scene.ts 의 YardScene, 기본은 clawdScene) 위에 친구들 ──
// 9줄 높이의 그림 한 장. 색 번호 그림이라 납작한 색이 많아 한 장이 수 KB 로 줄어든다.
// 배경은 테마가 갈아 끼우고(themes/<id>/scene.ts), 크기·친구 자리·친구 색·기억해 두기는 여기서 맡는다
export const YARD_BG_ROWS = 9
/** 배경 있는 장면의 맨 아랫줄(풀밭) 색. 바닥 아래 빈 줄을 이 색 글자 칸으로 채운다(register.tsx 의 땅) */
export const groundRgb = (tod: Tod, scene: YardScene = clawdScene) => scene.ground(tod)
/** 놀이터 아래를 채우는 흙 색: 풀밭 색을 어둡게(초록이 너무 많아 보였다, 사용자 2026-11-16) */
export const soilRgb = (tod: Tod, scene: YardScene = clawdScene) => {
  const g = groundRgb(tod, scene), dk = (c: number) => Math.round(c * 0.45)
  return (dk((g >> 16) & 255) << 16) | (dk((g >> 8) & 255) << 8) | dk(g & 255)
}
/** 팔레트 칸 수(투명 0번 + 배경 색 + 친구 색 앞줄·뒷줄). 256 을 넘으면 뒷줄도 앞줄 색을 쓴다(테마를 고를 때 막는다: hooks/theme.ts) */
export const scenePaletteSize = (scene: YardScene, sprites: Sprites, tod: Tod) => 1 + scene.colors(tod).length + 2 * Object.keys(sprites.palette).length

let baseMemo: { key: string; g: Uint8Array; sc: YardScene | null } = { key: '', g: new Uint8Array(0), sc: null }
// 움직이지 않는 바탕. 배경·폭·시간대가 같으면 다시 쓴다
const sceneBase = (scene: YardScene, W: number, tod: Tod) => {
  const key = `${W}:${tod}`
  if (baseMemo.key === key && baseMemo.sc === scene) return baseMemo.g
  const g = new Uint8Array(W * SCENE_H)
  scene.base(g, W, tod)
  baseMemo = { key, g, sc: scene }
  return g
}

/** 장면의 열쇠: 이것이 같으면 그림도 같다(친구 장면들·구름 자리·별 반짝임·시간대. 생물(yardLife)도 이 시간 칸만 쓴다) */
export const sceneKey = (frames: number[], now: number, frozen: boolean, tod: Tod) =>
  `${tod}:${frames.join(',')}:${frozen ? 0 : Math.floor(now / 1500)}${tod === 'night' && !frozen ? `:${Math.floor(now / 700)}` : ''}`
let sceneMemo: { key: string; png: string; sp: Sprites | null; sc: YardScene | null } = { key: '', png: '', sp: null, sc: null }
/** 배경 있는 놀이터 PNG(base64). 뒷줄(둘째·넷째 마리)은 조금 위에, 조금 어둡게 선다 */
export const yardScenePng = (sprites: Sprites, frames: number[], cols: number, now: number, frozen: boolean, tod: Tod, scene: YardScene = clawdScene) => {
  const key = `${cols}:${sceneKey(frames, now, frozen, tod)}`
  if (sceneMemo.key === key && sceneMemo.sp === sprites && sceneMemo.sc === scene) return sceneMemo.png
  const [dw, dh] = sprites.canvas
  const { wd: W, xs } = yardPlan(cols, frames.length, dw)
  const letters = Object.keys(sprites.palette).sort()
  const index: Record<string, number> = {}
  letters.forEach((k, i) => { index[k] = i })
  const cols24 = letters.map(k => parseInt(sprites.palette[k]!.replace('#', ''), 16) & 0xffffff)
  const bgColors = scene.colors(tod), dim = scene.dim(tod)
  const twoRows = 1 + bgColors.length + 2 * letters.length <= 256
  const palette = [0, ...bgColors, ...cols24.map(c => dimc(c, dim)), ...(twoRows ? cols24.map(c => dimc(c, dim * 0.86)) : [])].slice(0, 256)
  const spriteAt = 1 + bgColors.length
  const g = Uint8Array.from(sceneBase(scene, W, tod))
  const step = frozen ? 0 : now
  const put = (x: number, y: number, c: number, skyOnly = false) => {
    if (x < 0 || y < 0 || x >= W || y >= SCENE_H || (skyOnly && g[y * W + x]! > scene.sky)) return
    g[y * W + x] = c
  }
  const glyph = (rows: readonly string[], x: number, y: number, color: (ch: string) => number) => {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') put(x + i, y + j, color(row[i]!)) })
  }
  const ctx: SceneCtx = { W, tod, now, frozen, step, drift: Math.floor(step / 1500), r: W / 207, life: yardLife(W, now, frozen, tod), put, glyph }
  scene.back?.(g, ctx)
  // 뒷줄 먼저, 앞줄 나중
  const order = frames.map((_, i) => i).sort((a, b) => (b % 2) - (a % 2))
  for (const i of order) {
    const back = i % 2 === 1, rows = sprites.frames[frames[i]!] ?? sprites.frames[0] ?? [], flip = YARD[i]?.flip ?? false
    const top = (back ? GROUND - 7 : GROUND) - (dh - 2), off = spriteAt + (back && twoRows ? letters.length : 0)
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
  scene.front?.(g, ctx)
  // 장면이 실수로 팔레트 밖 색 번호를 찍었으면 하늘 첫 색으로(깨진 PNG 를 보내지 않게). 계약을 지키는 장면에서는 아무것도 바뀌지 않는다
  for (let i = 0; i < g.length; i++) if (g[i]! >= palette.length) g[i] = 1
  // 도트를 SCALE 배로
  const PW = W * SCALE, px = new Uint8Array(PW * SCENE_H * SCALE), line = new Uint8Array(PW)
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < W; x++) line.fill(g[y * W + x]!, x * SCALE, (x + 1) * SCALE)
    for (let sy = 0; sy < SCALE; sy++) px.set(line, (y * SCALE + sy) * PW)
  }
  sceneMemo = { key, png: base64(encodeIndexedPng(PW, SCENE_H * SCALE, px, palette)), sp: sprites, sc: scene }
  return sceneMemo.png
}
