// Clawd(마스코트 도트 그림)의 순수 함수들: 동작 고르기, 프레임 고르기, 화면 방식 고르기, Raster 칸 만들기.
// $ 를 쓰지 않아 단위 시험(tests/clawd.test.ts)이 그대로 부른다.
import type { ClawdAct } from '../types'
import { STR } from './i18n'
import type { Lang } from './i18n'

export type Sprites = {
  canvas: [number, number]
  box: [number, number]
  palette: Record<string, string>
  frames: string[][]
  states: Record<string, { label: string; ms: number; seq: number[] }>
  /** plain: 미리 구운 그림(장면마다), shift: 가운데 정렬로 옮겨 구운 그림("장면:dx"). sticker 는 0.8.8 부터 읽지 않는다(옛 묶음·시험 자료에 남아 있어도 된다) */
  png: { plain: string[]; shift?: Record<string, string>; sticker?: string[] }
}

// 동작 설명 글자와 색(시안 build_mock.py 의 CAP). color 가 없으면 흐림. 글자는 hooks/i18n.ts 의 cap 표(이 CAP 은 한국어, 언어별은 capText)
const T = STR.ko.cap
export const CAP: Record<ClawdAct, { text: string; color?: string }> = {
  idle: { text: T.idle },
  think: { text: T.think, color: 'claude' },
  search: { text: T.search, color: 'claude' },
  read: { text: T.read, color: 'claude' },
  edit: { text: T.edit, color: 'claude' },
  work: { text: T.work, color: 'claude' },
  cape: { text: T.cape, color: 'claude' },
  happy: { text: T.happy, color: 'success' },
  heart: { text: T.heart, color: 'success' },
  coffee: { text: T.coffee, color: 'suggestion' },
  bubble: { text: T.bubble },
  kite: { text: T.kite },
  dizzy: { text: T.dizzy, color: 'warning' },
  ask: { text: T.ask, color: 'warning' },
  oops: { text: T.oops, color: 'error' },
  sleepy: { text: T.sleepy },
}
/** 그 언어의 설명 글자 */
export const capText = (act: ClawdAct, lang: Lang) => STR[lang].cap[act] ?? STR[lang].cap.idle

export const TOOL_HOLD_MS = 1200
export const CELEBRATE_MS = 3000
export const BIG_TURN_MS = 60_000
export const BUBBLE_AFTER_MS = 2 * 60_000
export const KITE_AFTER_MS = 10 * 60_000
export const FREEZE_AFTER_MS = 30 * 60_000
/** 도구가 실패·거절됐거나 턴이 오류로 끝난 뒤 '앗' 을 보이는 시간 */
export const OOPS_HOLD_MS = 2400
/** 밤(현지 0:00~5:59)이면 한가함 동작 대신 꾸벅꾸벅 */
export const NIGHT_FROM_H = 0
export const NIGHT_UNTIL_H = 6
export const isNight = (now: number) => { const h = new Date(now).getHours(); return h >= NIGHT_FROM_H && h < NIGHT_UNTIL_H }

const SEARCH = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch'])
const READ = new Set(['Read', 'NotebookRead'])
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const CAPE = new Set(['Agent', 'Task', 'Workflow'])
// 사람의 대답이 올 때까지 끝나지 않는 도구(질문 창, 계획 승인 창): 도는 동안은 '대답 기다리는 중'
const ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])
export const toolAct = (tool: string): ClawdAct =>
  ASK.has(tool) ? 'ask' : SEARCH.has(tool) ? 'search' : READ.has(tool) ? 'read' : EDIT.has(tool) ? 'edit' : CAPE.has(tool) ? 'cape' : 'work'

/** tool.call 결과가 실패인지: 거절({ deny }) 또는 도구가 알린 오류(isError) */
export const isFailure = (r: unknown) => {
  if (!r || typeof r !== 'object') return false
  const o = r as { deny?: unknown; isError?: unknown }
  return (typeof o.deny === 'string') || o.isError === true
}

/** 동작 고르기의 입력. 시각은 모두 ms. 메인 루프의 것만 담는다(서브에이전트의 도구·턴은 넣지 않음) */
export type ClawdLive = {
  now: number
  /** 메인 루프에서 지금 도는 도구들(시작 시각) */
  tools: { name: string; at: number }[]
  /** 끝난 도구의 동작을 최소 1.2초 보이기 위한 유지(until 까지) */
  hold: { act: ClawdAct; until: number } | null
  /** 메인 턴이 도는 중이면 그 턴에서 도구를 썼는지 */
  turn: { usedTool: boolean } | null
  /** 정상 종료 축하(until 까지). 새 턴이 시작되면 null */
  celebrate: { act: 'happy' | 'heart'; until: number } | null
  /** $.agent.list() 에 running 이 있음 */
  subagents: boolean
  /** Codex·agy 작업이 돎 */
  jobs: boolean
  /** 사용량 경고 반응(until 까지 '사용량이 바닥나요'). 사용량 창이 90·95·100% 를 넘은 뒤 한가할 때 한 번 10초(usageAlarm·dizzyStart) */
  dizzy?: { until: number } | null
  /** 마지막 활동 시각 */
  lastActivity: number
  /** 권한 확인 창이 열려 사람의 대답을 기다리는 중(메인·서브에이전트 어느 쪽이든) */
  ask?: boolean
  /** 도구 실패·거절, 오류로 끝난 턴 뒤의 '앗'(until 까지) */
  oops?: { until: number } | null
  /** 현지 밤(0:00~5:59) */
  night?: boolean
}

/** 지금 '활동 중'인지: 도구·메인 턴·서브에이전트·Codex/agy 작업 중 하나라도(작업이 도는 동안은 커피도 계속 움직인다) */
export const isBusy = (l: ClawdLive) => l.tools.length > 0 || l.turn !== null || l.subagents || l.jobs

/**
 * 우선순위: 대답 기다림 → 도구 → 앗(2.4초) → 도구 유지 → 메인 턴 → 서브에이전트 → 축하 → Codex 작업 → 사용량 바닥 → 한가함(밤엔 꾸벅꾸벅).
 * 대답 기다림은 권한 확인 창이 열렸거나 질문 창 도구(AskUserQuestion 등)가 도는 동안: 사용자 차례라 무엇보다 먼저
 */
export const pickAct = (l: ClawdLive): ClawdAct => {
  if (l.ask || l.tools.some(t => toolAct(t.name) === 'ask')) return 'ask'
  if (l.tools.length) {
    const latest = l.tools.reduce((a, b) => (b.at >= a.at ? b : a))
    return toolAct(latest.name)
  }
  if (l.oops && l.now < l.oops.until) return 'oops'
  if (l.hold && l.now < l.hold.until) return l.hold.act
  if (l.turn) return l.turn.usedTool ? 'work' : 'think'
  if (l.subagents) return 'cape'
  if (l.celebrate && l.now < l.celebrate.until) return l.celebrate.act
  if (l.jobs) return 'coffee'
  if (l.dizzy && l.now < l.dizzy.until) return 'dizzy'
  if (l.night) return 'sleepy'
  const idle = l.now - l.lastActivity
  return idle > KITE_AFTER_MS ? 'kite' : idle > BUBBLE_AFTER_MS ? 'bubble' : 'idle'
}

// ── 손님 틀(guest variant): 테마 states 의 "<상태>@<손님>" 키. 같은 frames·palette 를 쓰는 그 상태의 다른 연출 ──
/** 손님 id: 소문자 ascii(숫자·_·- 허용) */
export const GUEST_RE = /^[a-z0-9_-]+$/
/** "edit@mimic" → ['edit', 'mimic']. 손님 키가 아니면 null */
export const splitVariant = (key: string): [string, string] | null => {
  const i = key.indexOf('@')
  if (i <= 0 || key.indexOf('@', i + 1) !== -1) return null
  const g = key.slice(i + 1)
  return GUEST_RE.test(g) ? [key.slice(0, i), g] : null
}
/** 작은 해시(FNV-1a 32비트): 같은 입력이면 늘 같은 값 */
const fnv1a = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/**
 * 동작 act 가 actT0 에 시작될 때 보일 states 키. 손님 키 act@* 가 없으면 act 그대로(예전과 같다).
 * 있으면 GUEST_CHANCE(반반) 로 손님 중 하나(고르게), 나머지는 본래 act. (act, actT0) 의 해시로 정해서, 같은 동작이 이어지는 동안은 다시 굴리지 않는다
 */
/** 손님이 맡은 동작에서 손님이 나올 확률(사용자 결정 2026-11-18: 손님도 자주 보이게 반반) */
export const GUEST_CHANCE = 0.5
export const pickVariant = (states: Record<string, unknown>, act: string, actT0: number): string => {
  const guests: string[] = []
  for (const k of Object.keys(states)) { const v = splitVariant(k); if (v && v[0] === act) guests.push(k) }
  if (!guests.length) return act
  guests.sort()
  const h = fnv1a(`${act}:${Math.floor(actT0)}`)
  const roll = ((h >>> 8) % 1000) / 1000
  if (roll >= GUEST_CHANCE && Object.prototype.hasOwnProperty.call(states, act)) return act
  return guests[(h >>> 20) % guests.length]!
}

/** 30분 넘게 아무 활동이 없으면 움직임을 멈춘다(첫 장면만) */
export const isFrozen = (l: ClawdLive) => !isBusy(l) && l.now - l.lastActivity > FREEZE_AFTER_MS && !(l.dizzy && l.now < l.dizzy.until)

/** 동작이 시작된 시각(t0)부터 seq 를 ms 간격으로 돌린 지금의 프레임 번호 */
export const frameAt = (st: { ms: number; seq: number[] }, t0: number, now: number, frozen: boolean) => {
  if (!st.seq.length) return 0
  if (frozen) return st.seq[0] ?? 0
  const i = Math.floor(Math.max(0, now - t0) / Math.max(1, st.ms)) % st.seq.length
  return st.seq[i] ?? 0
}

/** 지금 장면이 다른 장면으로 바뀌기까지 남은 ms(멈췄거나 장면이 한 가지면 Infinity). 큰 Clawd 가 곧 바뀔지 미리 본다 */
export const msUntilChange = (st: { ms: number; seq: number[] } | undefined, t0: number, now: number, frozen: boolean) => {
  if (!st || !st.seq.length || frozen) return Infinity
  const ms = Math.max(1, st.ms), n = st.seq.length, el = Math.max(0, now - t0)
  const i = Math.floor(el / ms) % n, into = el % ms
  for (let k = 1; k <= n; k++) if (st.seq[(i + k) % n] !== st.seq[i]) return k * ms - into
  return Infinity
}

/** 메인 턴이 오류로 끝났을 때 축하 대신 보이는 '앗'. 그 밖의 이유면 null */
export const oopsFor = (reason: string, now: number): ClawdLive['oops'] =>
  reason === 'error' ? { until: now + OOPS_HOLD_MS } : null

/** 메인 턴이 끝났을 때의 축하. aborted·error·refusal 은 없음 */
export const celebrationFor = (reason: string, durationMs: number, now: number): ClawdLive['celebrate'] =>
  reason === 'answer' ? { act: durationMs > BIG_TURN_MS ? 'heart' : 'happy', until: now + CELEBRATE_MS } : null

export type ClawdMode = 'off' | 'text' | 'image-side' | 'image-top' | 'raster'
export const IMG_COLS = 19
// 7줄: iTerm 은 그림을 칸 비율대로 위에 붙여 그려서, 8줄이면 Monaco 12 에서 아래 1줄 남짓이 빈다(2026-11-16 실제 화면)
export const IMG_ROWS = 7
export const SIDE_TEXT_COLS = 12
// image-side 에서 옆 글자를 몇 번째 줄부터 둘지: Clawd 몸(그림판 y 15~30 / 32)의 머리 높이(시안 '라'안, 2026-11-16)
export const SIDE_TOP_ROWS = 3

/** 터미널에서 차지하는 칸 수: 한글·한자·전각은 두 칸 */
export const cellWidth = (s: string) =>
  [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)

// ── 설명 앞의 돌아가는 표시: Claude Code 가 일할 때 왼쪽 아래에 돌리는 것과 같은 글자(앞으로 갔다 되돌아옴) ──
export const SPIN_ACTS: ReadonlySet<ClawdAct> = new Set<ClawdAct>(['think', 'search', 'read', 'edit', 'work', 'cape', 'coffee'])
const SPIN_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽']
export const SPIN_SEQ = [...SPIN_GLYPHS, ...[...SPIN_GLYPHS].reverse()]
/** 쉬거나 끝났을 때 멈춰 있는 표시(Claude Code 가 턴을 마칠 때 남기는 '✻ … for 21s' 와 같은 글자) */
export const REST_GLYPH = '✻'
export const spinGlyph = (act: ClawdAct, i: number) =>
  SPIN_ACTS.has(act) ? SPIN_SEQ[((i % SPIN_SEQ.length) + SPIN_SEQ.length) % SPIN_SEQ.length]! : REST_GLYPH
// Raster 는 테마 색 이름을 못 받아 RGB 로 준다. 밝은·어두운 테마 어느 쪽에서도 읽히는 중간 색
const SPIN_RGB: Record<string, number> = { claude: 0xd77757, success: 0x3faa5a, suggestion: 0x8190f5, warning: 0xd99a00, error: 0xd9534f }
const SPIN_DIM = 0x8c8c8c
export const spinColor = (act: ClawdAct) => { const c = CAP[act]?.color; return c ? SPIN_RGB[c] ?? SPIN_DIM : SPIN_DIM }
/** 1×1 Raster 의 cells(표시 글자 하나, 글자색 = 설명 색) */
export const spinCells = (act: ClawdAct, i: number) => {
  const b = new Uint8Array(12)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, spinGlyph(act, i).codePointAt(0) ?? 0x20, true)
  dv.setUint32(4, spinColor(act), true)
  dv.setUint32(8, TERM_DEFAULT, true)
  return base64(b)
}
export const RASTER_COLS = 38
export const RASTER_ROWS = 16

/**
 * 화면 방식 고르기.
 * - 꺼짐·그림 자료 없음 → off(예전 첫 줄만)
 * - 터미널이 아님(Image·Raster 없음) → text(첫 줄 + 설명 한 줄)
 * - 그림을 그릴 수 있음(fullscreen 이 아니라고 확인되지 않았고, blit 이 'alt 를 그리는 중'으로 거부한 적 없음):
 *   폭이 19+1+12 이상이면 image-side, 아니면 image-top(그림 위, 요약 아래 한 줄)
 * - 그림을 못 그림 → 폭이 38 이상이면 raster(요약 위 한 줄 + 반 블록 그림), 아니면 text
 */
export const pickMode = (o: {
  on: boolean; ready: boolean; surface: string; hasImage: boolean; hasRaster: boolean
  isFullscreen?: boolean; imageDenied: boolean; bodyColumns: number
}): ClawdMode => {
  if (!o.on || !o.ready) return 'off'
  if (o.surface !== 'terminal' || (!o.hasImage && !o.hasRaster)) return 'text'
  const canImage = o.hasImage && o.isFullscreen !== false && !o.imageDenied
  if (canImage) return o.bodyColumns >= IMG_COLS + 1 + SIDE_TEXT_COLS ? 'image-side' : 'image-top'
  if (o.hasRaster && o.bodyColumns >= RASTER_COLS) return 'raster'
  return 'text'
}

export const TERM_DEFAULT = 0x01000000
const hex = (c: string | undefined) => (c ? parseInt(c.replace('#', ''), 16) & 0xffffff : TERM_DEFAULT)

/**
 * 32줄 도트 한 장을 16줄 반 블록 칸으로: 칸마다 [codePoint, fg, bg].
 * 위·아래 다 있음 → ▀(fg=위, bg=아래), 위만 빔 → ▄(fg=아래, bg=기본), 아래만 빔 → ▀(fg=위, bg=기본), 둘 다 빔 → 공백.
 */
export const rasterWords = (frame: string[], palette: Record<string, string>, cols = RASTER_COLS, rows = RASTER_ROWS) => {
  const w = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    const top = frame[r * 2] ?? '', bot = frame[r * 2 + 1] ?? ''
    for (let c = 0; c < cols; c++) {
      const t = top[c], b = bot[c]
      const tc = t && t !== '.' ? palette[t] : undefined
      const bc = b && b !== '.' ? palette[b] : undefined
      const i = (r * cols + c) * 3
      if (tc) { w[i] = 0x2580; w[i + 1] = hex(tc); w[i + 2] = bc ? hex(bc) : TERM_DEFAULT }
      else if (bc) { w[i] = 0x2584; w[i + 1] = hex(bc); w[i + 2] = TERM_DEFAULT }
      else { w[i] = 0x20; w[i + 1] = TERM_DEFAULT; w[i + 2] = TERM_DEFAULT }
    }
  }
  return w
}
// 표준 base64(덧붙임 있음). 실행 환경의 Uint8Array.toBase64 에 기대지 않으려고 직접 만든다
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export const base64 = (b: Uint8Array) => {
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const x = b[i] ?? 0, y = b[i + 1] ?? 0, z = b[i + 2] ?? 0
    const n = (x << 16) | (y << 8) | z
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! +
      (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=')
  }
  return out
}
/** Raster 의 cells: 칸마다 little-endian u32 [codePoint, fg, bg] 를 이어 붙인 base64 */
export const rasterCells = (frame: string[], palette: Record<string, string>) => {
  const w = rasterWords(frame, palette)
  const b = new Uint8Array(w.length * 4)
  const dv = new DataView(b.buffer)
  for (let i = 0; i < w.length; i++) dv.setUint32(i * 4, w[i] ?? 0, true)
  return base64(b)
}

// ── 큰 캐릭터 가운데 정렬(시안31 '가'안, 사용자 2026-11-18) ──
// 동작(states 키, 손님 '상태@손님' 포함)마다 그 동작의 모든 장면을 합친 가로 범위 [lo, hi] 를 잰다.
// 테마의 가운데 자리 home = center(idle 의 범위). 동작마다 dx = max(0, min(home, W-1-hi)):
// 대부분은 같은 자리(home)에 서고, 소품이 넓어 오른쪽이 모자란 동작만 들어가는 만큼 옮긴다. 아래 풍경의 작은 캐릭터에는 쓰지 않는다
/** 그 동작의 장면들을 합친 가로 범위. 도트가 하나도 없으면 [0, W-1](옮기지 않음) */
export const actExtent = (sp: Pick<Sprites, 'canvas' | 'frames' | 'states'>, key: string): [number, number] => {
  const W = sp.canvas[0], st = sp.states[key] ?? sp.states.idle
  let lo = W, hi = -1
  for (const n of new Set(st?.seq ?? [])) for (const row of sp.frames[n] ?? []) {
    for (let x = 0; x < W && x < row.length; x++) if (row[x] !== '.') { if (x < lo) lo = x; if (x > hi) hi = x }
  }
  return hi < 0 ? [0, W - 1] : [lo, hi]
}
/** 범위를 칸 가운데로 옮기는 칸 수(왼쪽 여백과 오른쪽 여백을 같게, 홀수면 왼쪽으로 반 칸) */
export const centerShift = ([lo, hi]: [number, number], W: number) => Math.max(0, Math.floor(((W - 1 - hi) - lo) / 2))
const shiftMemo = new WeakMap<object, Map<string, number>>()
/** 동작 key 의 dx. 같은 Sprites 면 기억해 둔다(장면이 바뀌어도 한 동작 안에서는 같다) */
export const actShift = (sp: Pick<Sprites, 'canvas' | 'frames' | 'states'>, key: string) => {
  let m = shiftMemo.get(sp)
  if (!m) { m = new Map(); shiftMemo.set(sp, m) }
  let v = m.get(key)
  if (v === undefined) {
    const W = sp.canvas[0], home = centerShift(actExtent(sp, 'idle'), W), hi = actExtent(sp, key)[1]
    v = Math.max(0, Math.min(home, W - 1 - hi))
    m.set(key, v)
  }
  return v
}
/** 도트 줄들을 오른쪽으로 dx 칸 민다(폭은 그대로, 넘친 것은 버린다) */
export const shiftRows = (rows: readonly string[], dx: number, W = 38) =>
  dx <= 0 ? rows as string[] : rows.map(r => ('.'.repeat(dx) + r.padEnd(W, '.')).slice(0, W))

// ── 사용량 경고 반응(사용자 2026-11-18: '사용량이 바닥나요' 가 기본 상태처럼 계속 나오지 않게) ──
// 창(5시간·주간)마다 단계 1(90%↑)·2(95%↑)·3(100%)를 기억하고, 단계가 오를 때마다 한 번 뜬다(세션 첫 읽기에서 이미 90%↑ 여도 한 번).
// 90% 아래로 내려가면(리셋) 그 창의 기록을 지운다. 뜬 것은 한가한 동작일 때 DIZZY_MS 동안 보이고, 바쁘면 한가해질 때까지 미룬다(여럿이어도 하나로)
export const DIZZY_MS = 10_000
export const usageLevel = (usedPct: number) => (usedPct >= 100 ? 3 : usedPct >= 95 ? 2 : usedPct >= 90 ? 1 : 0)
/** 지난 단계 + 새로 읽은 창들 → 새 단계와, 어느 창이든 단계가 올랐는지 */
export const usageAlarm = (prev: Readonly<Record<string, number>>, windows: readonly { kind: string; usedPct: number }[]) => {
  const levels: Record<string, number> = {}
  let fired = false
  for (const w of windows) {
    const lv = usageLevel(w.usedPct)
    if (lv > (prev[w.kind] ?? 0)) fired = true
    if (lv > 0) levels[w.kind] = lv
  }
  return { levels, fired }
}
const CALM: ReadonlySet<ClawdAct> = new Set<ClawdAct>(['idle', 'bubble', 'kite', 'sleepy'])
/** 미뤄 둔 경고가 있을 때: 경고 없이 고른 동작이 한가함(쉬기·방울·연·졸기)이면 지금부터 DIZZY_MS. 아직 바쁘면 null(계속 미룬다) */
export const dizzyStart = (l: ClawdLive): { until: number } | null =>
  CALM.has(pickAct({ ...l, dizzy: null })) ? { until: l.now + DIZZY_MS } : null
