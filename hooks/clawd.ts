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
  png: { plain: string[]; sticker: string[] }
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
  /** Claude 사용량 창 중 하나라도 남은 양 10% 이하 */
  lowUsage: boolean
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
  if (l.lowUsage) return 'dizzy'
  if (l.night) return 'sleepy'
  const idle = l.now - l.lastActivity
  return idle > KITE_AFTER_MS ? 'kite' : idle > BUBBLE_AFTER_MS ? 'bubble' : 'idle'
}

/** 30분 넘게 아무 활동이 없으면 움직임을 멈춘다(첫 장면만) */
export const isFrozen = (l: ClawdLive) => !isBusy(l) && l.now - l.lastActivity > FREEZE_AFTER_MS

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
