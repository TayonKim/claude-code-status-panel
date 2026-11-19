// 테마: 큰 마스코트·놀이터 친구 다섯·놀이터 배경을 한 벌로 갈아 끼운다(/skin <이름>, 인자 없으면 고르기 창. 고른 것은 $.store 'clawd' 의 theme).
// 묶음 형식 themes/<id>/
//   sprites.json  큰 마스코트. clawd/sprites.json 과 같은 꼴(canvas 38×32·palette·frames·states). 없는 상태는 idle 로 대신한다.
//                 states 에 "<상태>@<손님>" 키(손님 틀)를 둘 수 있다: 같은 frames·palette, 동작이 바뀔 때 반반(GUEST_CHANCE)으로 손님 중 하나(clawd.ts pickVariant).
//                 png.plain(미리 구운 그림)이 없으면 frames 로 만든다(456×384, 도트 12배). png.shift 는 가운데 정렬로 옮긴 그림("장면:dx",
//                 clawd-src/bake_shift.py 가 굽는다). 옛 png.sticker 는 읽지 않는다.
//   friends.json  놀이터 다섯(같은 꼴). 상태 키는 hooks/yard.ts YARD 자리 이름 bubble·kite·coffee·happy·idle. 없는 상태는 idle,
//                 파일이 없으면 sprites.json 을 그대로 쓴다.
//   scene.ts      놀이터 배경(hooks/scene.ts 의 YardScene). themes/index.ts 에 이름과 함께 올린다. 없으면 기본 Clawd 배경.
// 기본 테마 clawd 는 지금 자리(clawd/sprites.json, 기본 배경) 그대로다.
// $ 를 쓰지 않는 순수 함수(tests/theme.test.tsx). 파일 읽기는 register.tsx 가 한다.
import type { ClawdAct } from '../types'
import { CAP, base64, shiftRows, splitVariant } from './clawd'
import type { Sprites } from './clawd'
import { encodeIndexedPng } from './png'
import { clawdScene } from './scene'
import type { YardScene } from './scene'
import { YARD } from './yard'

export const THEME_DEFAULT = 'clawd'
export type ThemeEntry = {
  /** /skin 뒤에 쓸 수 있는 이름(대소문자 무시). label 이 없으면 첫째가 보이는 이름 */
  names: readonly string[]
  /** 화면 언어별 보이는 이름(고르기 창·목록·답). /skin 뒤에 써도 된다 */
  label?: { ko: string; en: string }
  /** 고르기 창·목록에서 뺀다(/skin <이름> 으로는 여전히 고른다) */
  hidden?: true
  /** 놀이터 배경. 없으면 기본 Clawd 배경 */
  scene?: YardScene
}
export type Theme = { id: string; sprites: Sprites; friends: Sprites; scene: YardScene }

type UiLang = 'ko' | 'en'
/** 그 화면 언어의 보이는 이름 */
export const themeLabelOf = (id: string, reg: Record<string, ThemeEntry>, lang: UiLang) => reg[id]?.label?.[lang] ?? reg[id]?.names[0] ?? id
/** 이름(별칭·두 언어의 보이는 이름) → 테마 id(대소문자 무시). 없으면 null */
export const themeIdOf = (name: string, reg: Record<string, ThemeEntry>): string | null => {
  const n = name.trim().toLowerCase()
  if (!n) return null
  for (const [id, t] of Object.entries(reg)) {
    const all = [id, ...t.names, ...(t.label ? [t.label.ko, t.label.en] : [])]
    if (all.some(x => x.toLowerCase() === n)) return id
  }
  return null
}
/** 저장된 값(아무거나) → 있는 테마 id. 모르는 값이면 기본 */
export const themePrefOf = (v: unknown, reg: Record<string, ThemeEntry>) =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(reg, v) ? v : THEME_DEFAULT
/** 모든 테마의 보이는 이름(숨긴 것 포함) */
export const themeNames = (reg: Record<string, ThemeEntry>, lang: UiLang = 'ko') => Object.keys(reg).map(id => themeLabelOf(id, reg, lang))
/** 숨기지 않은 테마의 보이는 이름(고르기 창·알림의 목록) */
export const shownThemeNames = (reg: Record<string, ThemeEntry>, lang: UiLang = 'ko') =>
  Object.entries(reg).filter(([, t]) => !t.hidden).map(([id]) => themeLabelOf(id, reg, lang))
/** 고르기 창($.ui.ask)의 선택지: 보이는 테마가 2~4개일 때만(창이 받는 수). 그 밖이면 null → 글자로 답한다 */
export const ASK_MIN = 2
export const ASK_MAX = 4
export const skinChoices = (reg: Record<string, ThemeEntry>, lang: UiLang = 'ko'): string[] | null => {
  const n = shownThemeNames(reg, lang)
  return n.length >= ASK_MIN && n.length <= ASK_MAX ? n : null
}
/** 창의 답(고른 라벨 또는 Other 로 친 글자) → 테마 id. 라벨과 똑같으면 그 테마, 아니면 이름·별칭으로. 모르면 null */
export const skinAnswerId = (answer: string, reg: Record<string, ThemeEntry>, lang: UiLang = 'ko'): string | null => {
  for (const [id, t] of Object.entries(reg)) if (!t.hidden && themeLabelOf(id, reg, lang) === answer) return id
  return themeIdOf(answer, reg)
}

const BIG_STATES = Object.keys(CAP) as ClawdAct[]
const FRIEND_STATES = [...new Set(YARD.map(m => m.state))]

/**
 * 읽은 JSON → 쓸 수 있는 Sprites. 꼴이 틀리면 이유를 담은 Error.
 * want 의 상태 중 없는 것은 idle 로 대신한다(seq 가 가리키는 장면이 없으면 장면 0 으로 고친다)
 */
export const normalizeSprites = (raw: unknown, want: readonly string[]): Sprites => {
  const o = raw as Partial<Sprites> | null
  if (!o || typeof o !== 'object') throw new Error('not an object')
  const [cw, chh] = Array.isArray(o.canvas) ? o.canvas : []
  if (cw !== 38 || chh !== 32) throw new Error('canvas must be [38, 32]')
  if (!o.palette || typeof o.palette !== 'object') throw new Error('no palette')
  for (const [k, v] of Object.entries(o.palette)) {
    if (k.length !== 1 || k === '.') throw new Error(`bad palette key ${k}`)
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`bad color ${k}`)
  }
  if (!Array.isArray(o.frames) || !o.frames.length) throw new Error('no frames')
  o.frames.forEach((f, i) => { if (!Array.isArray(f) || f.some(r => typeof r !== 'string')) throw new Error(`frame ${i} must be rows of text`) })
  const nf = o.frames.length
  const st = (o.states ?? {}) as Sprites['states']
  const fix = (s: { label?: string; ms?: number; seq?: number[] } | undefined, name: string) =>
    s && Array.isArray(s.seq) && s.seq.length
      ? { label: s.label ?? name, ms: typeof s.ms === 'number' && s.ms > 0 ? s.ms : 400, seq: s.seq.map(i => (Number.isInteger(i) && i >= 0 && i < nf ? i : 0)) }
      : undefined
  const idle = fix(st.idle, 'idle') ?? { label: 'idle', ms: 1000, seq: [0] }
  const states: Sprites['states'] = {}
  // 손님 키 "<상태>@<손님>" 은 보통 상태처럼 고친다. 바탕 상태가 idle·want 에 없거나 손님 id 가 틀리면 버린다
  const known = new Set(['idle', ...want])
  for (const k of Object.keys(st)) {
    if (k.includes('@')) { const v = splitVariant(k); if (!v || !known.has(v[0])) continue }
    const f = fix(st[k], k); if (f) states[k] = f
  }
  for (const k of ['idle', ...want]) if (!states[k]) states[k] = { ...idle, label: k }
  // png.shift: 문자열 값만 받는다(굽지 않은 조합은 bigPng 가 옮기지 않은 그림으로)
  const shift: Record<string, string> = {}
  const rawShift = o.png && Array.isArray(o.png.plain) ? (o.png as { shift?: unknown }).shift : undefined
  if (rawShift && typeof rawShift === 'object' && !Array.isArray(rawShift)) {
    for (const [k, v] of Object.entries(rawShift as Record<string, unknown>)) if (typeof v === 'string' && v) shift[k] = v
  }
  const png = o.png && Array.isArray(o.png.plain) ? { plain: o.png.plain, shift } : { plain: [], shift }
  return { ...(o as Sprites), canvas: [38, 32], states, png }
}
/** 큰 마스코트 색 수 상한: PNG 팔레트 256 칸에서 투명(0번)과 한 칸 여유(예전 sticker 흰 테두리 자리)를 뺀다(spritePng) */
export const BIG_MAX_COLORS = 254
export const normalizeBig = (raw: unknown) => {
  const sp = normalizeSprites(raw, BIG_STATES)
  if (Object.keys(sp.palette).length > BIG_MAX_COLORS) throw new Error(`more than ${BIG_MAX_COLORS} colors`)
  return sp
}
export const normalizeFriends = (raw: unknown) => normalizeSprites(raw, FRIEND_STATES)

/** 배경 색 + 친구 색 두 벌이 PNG 팔레트(256) 안에 드는지: 시간대 셋 모두 */
export const themeFits = (scene: YardScene, friends: Sprites) =>
  (['day', 'dusk', 'night'] as const).every(t => 1 + scene.colors(t).length + 2 * Object.keys(friends.palette).length <= 256)

/** 읽은 두 JSON(friends 는 없으면 undefined) → 테마. 꼴이 틀리거나 색이 넘치면 Error */
export const buildTheme = (id: string, entry: ThemeEntry | undefined, bigRaw: unknown, friendsRaw?: unknown): Theme => {
  const sprites = normalizeBig(bigRaw)
  const friends = friendsRaw === undefined ? normalizeFriends(bigRaw) : normalizeFriends(friendsRaw)
  // 큰 마스코트와 친구가 같은 파일이면 같은 것을 쓴다(기본 clawd: 띠의 기억 열쇠가 그대로)
  const scene = entry?.scene ?? clawdScene
  if (!themeFits(scene, friends)) throw new Error('too many colors')
  return { id, sprites, friends: friendsRaw === undefined ? sprites : friends, scene }
}

// ── 큰 마스코트 PNG: 도트 12배, 0번 투명. dx 는 가운데 정렬로 오른쪽에 미는 도트 수(clawd.ts actShift) ──
// 테두리(sticker) 모양은 0.8.7 에서 없앴다: png.sticker 는 읽지 않는다(0.8.8 부터 기본 sprites.json 에서도 뺐다)
const BIG_SCALE = 12
const pngMemo = new WeakMap<Sprites, Map<string, string>>()
const memoOf = (sp: Sprites) => {
  let m = pngMemo.get(sp)
  if (!m) { m = new Map(); pngMemo.set(sp, m) }
  return m
}
export const spritePng = (sp: Sprites, f: number, dx = 0) => {
  const [dw, dh] = sp.canvas
  const letters = Object.keys(sp.palette).sort()
  const index: Record<string, number> = {}
  letters.forEach((k, i) => { index[k] = i + 1 })
  // 끝의 흰색은 예전 sticker 테두리 자리: 빈 칸이지만 남겨 두어 dx 0 그림이 0.8.6 과 바이트까지 같다
  const palette = [0, ...letters.map(k => parseInt(sp.palette[k]!.replace('#', ''), 16) & 0xffffff), 0xffffff]
  const rows = shiftRows(sp.frames[f] ?? sp.frames[0] ?? [], dx, dw)
  const g = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) g[y * dw + x] = index[rows[y]?.[x] ?? '.'] ?? 0
  const W = dw * BIG_SCALE, H = dh * BIG_SCALE, px = new Uint8Array(W * H), line = new Uint8Array(W)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) line.fill(g[y * dw + x]!, x * BIG_SCALE, (x + 1) * BIG_SCALE)
    for (let s = 0; s < BIG_SCALE; s++) px.set(line, (y * BIG_SCALE + s) * W)
  }
  return base64(encodeIndexedPng(W, H, px, palette))
}
/**
 * 큰 마스코트의 그 장면 PNG(민무늬). sprites.json 에 미리 구운 것(png.plain)이 있으면 dx 0 은 그것 그대로(0.8.6 과 같다),
 * dx 가 있으면 제작 단계에서 옮겨 구운 것(png.shift["장면:dx"], clawd-src/bake_shift.py). 구운 것이 없으면 옮기지 않은 그림.
 * 실행 중에는 PNG 를 풀거나 다시 싸지 않는다(한 장 40~120ms 라 100ms 틱을 넘었다, 검수 0.8.7 높음 5·중간 8).
 * png.plain 이 없는 테마는 도트로 만든다. 만든 것은 기억해 둔다
 */
export const bigPng = (sp: Sprites, f: number, dx = 0) => {
  const list = sp.png?.plain
  const k = `${f}:${dx}`
  if (list && list.length) {
    const own = list[f] ?? list[0] ?? ''
    if (dx <= 0) return own
    return (list[f] !== undefined ? sp.png.shift?.[k] : undefined) ?? own
  }
  const m = memoOf(sp)
  let p = m.get(k)
  if (!p) { p = spritePng(sp, f, dx); m.set(k, p) }
  return p
}
