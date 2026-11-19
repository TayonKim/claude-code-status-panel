// Claude 사용량을 세션끼리 나눈다(사용자 2026-11-18: 패널이 있는 세션을 안 써도 사용량 줄이 바뀌게).
// $.session.usage().rateLimits 는 '그 세션이 마지막으로 받은 응답에 실려 온 값'이라, 다른 세션이 쓴 양은 이 세션이 응답을 받기 전까지 안 보인다.
// $ 를 쓰지 않는 순수 함수(tests/share.test.tsx). 파일 읽기·쓰기·atom 은 register.tsx 의 readClaudeNow 가 한다.
//
// ── 0.8.9 구조: 세션마다 자기 칸(slot), 화면 값은 한 함수가 모든 관측을 한 번에 본다 ──
// (0.8.7~0.8.8 은 한 파일에 값을 합쳐 적고 둘씩 시각으로 겨뤘다. 고칠수록 규칙이 늘어 구멍이 생겨(검수 두 바퀴) 구조를 바꿨다)
//
// 파일: ~/.cache/status-panel/claude-usage-v2.json (CLAUDE_CONFIG_DIR 이 있으면 claude-usage-v2-<그 경로의 해시 8자리>.json)
//   { v: 2, slots: [{ id, seq, windows: [{ kind, usedPct, resetsAt, at }] }] }   창 종류 이름(KIND_RE)·칸 이름(SLOT_ID_RE)·숫자만 적는다.
//   - id: 프로세스 하나(Claude Code 한 개)의 칸 이름. atom(claudeOwn2)에 두어 /reload-plugins·세션 재시작에도 같다.
//     (0.8.8 의 atom 키 claudeOwn 과 키를 나눴다: 옛 판 모듈이 늦게 적은 옛 모양 값이 이 판의 세대·칸 이름을 처음으로 되돌리지 못하게)
//   - seq: 그 칸을 적을 때마다 하나씩 오르는 번호(atom 에서 받는다). 같은 칸의 판들 중 어느 것이 나중인지 가린다.
//   - at: 그 관측을 받은 시각(초). 정확히는 '값이 바뀐 것을 처음 본 폴링이 usage() 를 부르기 직전의 엔진 시각'이라
//     실제로 응답을 받은 때보다 최대 한 폴링(5초)쯤 늦다. 나이를 모르는 값은 at 이 0 이고 파일에 적지 않는다.
//   0.8.7~0.8.8 의 v1 파일(claude-usage.json, { v: 1, windows })은 이름이 달라 읽지도 쓰지도 않는다(옛 판 세션과 서로 덮어쓰며 다투지 않게).
//   v2 자리에서 v 가 2 가 아닌 글자를 읽으면: v 가 2 보다 큰 수면 앞으로 나올 판의 파일이라 읽기만(쓰지 않는다), 그 밖(v1 등)은 빈 파일처럼 본다.
//
// 쓰기(planWrite·composeSlots): 세션은 자기 칸만 고친다. 남의 칸은 본 그대로(칸마다 가장 높은 seq 판) 옮겨 적고, 죽은 칸만 버린다.
//   - 살아 있는 관측(liveWin): 리셋 시각이 지나지 않았고(resetsAt 0 은 모름이라 안 지난 것으로 친다) at 이 지금 ±8일 안.
//     죽은 칸 = 살아 있는 관측이 하나도 없는 칸. 칸이 MAX_SLOTS 를 넘으면 모든 세션이 같은 차례(가장 최근의 살아 있는 관측이 새 칸 → 칸 이름)로
//     앞의 MAX_SLOTS 칸만 남긴다. 적는 세션의 자기 칸도 특별히 남기지 않고, 자기 칸이 그 밖이면 적지 않는다(자기 칸을 지키려고 남의 칸을 빼면
//     그 세션이 다음 쓰기에서 이 칸을 빼는 핑퐁이 된다). 자기 값이 바뀌면 그 관측이 가장 새것이라 다시 든다.
//     칸 하나의 창은 읽을 때나 적을 때나 orderWins 차례로 앞의 MAX_WINS(16)개만.
//   - 자기 칸에 적을 것 = 나이를 아는 자기 관측 중 살아 있는 것. 파일의 자기 칸(살아 있는 관측만 비교)이 그것과 다를 때만 적는다.
//     적을 것이 없으면(나이 모름·리셋 지남·아직 응답 없음) 자기 칸을 건드리지 않는다. 버리는 규칙(죽은 칸)과 적는 규칙이 같은 시계로 같은 것을
//     보므로 '한쪽이 버리고 다른 쪽이 되살리는' 되풀이가 없다. 남의 값을 합쳐 적지 않으니 두 세션이 번갈아 쓰는 핑퐁도 없다.
//   - 리셋 시각만 같은 창 안에서(SAME_WINDOW_S) 흔들린 것은 다른 것으로 치지 않는다(흔들릴 때마다 다시 적지 않게).
//
// 화면 값(shownUsage): 종류마다 모든 칸의 관측을 한 번에 보고 고른다. 둘씩 비교하지 않으니 순서에 따라 결과가 달라지지 않는다.
//   1. 후보: 남의 칸 관측 + 자기 관측(나이를 알 때). 자기 칸의 파일 판은 자기 기억에 그 종류가 없을 때만 쓴다(옛 판이 늦게 적은 자기 칸을 믿지 않게).
//      리셋 시각이 지난 것, 8일 넘은 것, SHARE_FUTURE_S 넘게 미래인 것은 이번에는 빼고(파일에서는 지우지 않는다), 그 안쪽 미래는 지금으로 본다.
//   2. 가장 새 at 에서 NEAR_S(8초) 안의 후보만 남긴다. 그보다 오래된 값은 값이 커도 진다: 쉬는 세션의 묵은 값은 더 새 관측에 진다.
//   3. 그 안에서 나중 창(가장 늦은 resetsAt 에서 SAME_WINDOW_S 안) → 큰 usedPct → 새 at → 늦은 resetsAt.
//      8초 안의 관측은 폴링 간격 때문에 어느 쪽이 먼저 받은 것인지 알 수 없어 큰 값을 믿는다(사용량은 창 안에서 보통 늘기만 한다).
//   4. 후보가 없으면 자기 값을 그대로(나이를 모르는 값·리셋이 지난 값도: 나눔이 없던 때와 같은 화면). 자기 값도 없으면 그 종류는 안 보인다.
//
// 같은 창에서 정말로 내려간 값(지출 한도를 올린 경우 등):
//   - 한 세션 안에서 내려가면 자기 칸이 새 값으로 바뀌므로 곧바로 내려간 값이 보인다(0.8.8 은 자기가 적은 높은 값과 겨뤄 고착).
//   - 다른 세션의 높은 관측보다 8초 넘게 뒤에 본 하락이면 새 관측이라 이긴다.
//   - 8초 안에서 두 세션이 높은 값·낮은 값을 따로 봤고 그 뒤 둘 다 쉬면(드묾, 받아들임): 순서를 알 수 없어 높은 값이 보인다.
//     어느 세션이든 값이 바뀐 응답을 하나 더 받으면(높은 쪽 세션도 다음 응답에서 낮은 값을 본다) 그 관측이 8초 넘게 새것이라 풀린다.
//     같은 값이 이어지는 응답은 폴링으로 구별할 수 없어 at 을 새로 하지 않는다.
//
// 만료: 리셋 시각이 지난 관측은 화면 후보에서 빠진다(파일을 못 읽는 동안에도: 기억해 둔 칸을 틱마다 지금 시각으로 다시 본다).
//   모든 관측이 지났으면 자기 값을 지금처럼 '리셋 지남'으로 보인다. 칸은 살아 있는 관측이 없어질 때 다음 쓰기에서 빠진다.
// 미래 시각: 지우지 않는다. SHARE_FUTURE_S 를 넘는 동안 화면 후보에서만 빠지고, 시계가 따라잡으면 다시 쓰인다(8일 넘게 미래면 쓰레기로 보고 버린다).
// 깨진 파일: 쓰는 중에 읽었을 수 있어 그 틱은 쓰지 않는다. 같은 크기·시각으로 잇달아 SHARE_DEAD_TICKS 번 깨져 읽히면(사이에 다른 결과가 끼면
//   처음부터 다시 센다) 죽은 파일로 보고, 자기 칸이 비어 있어도 기억해 둔 칸들로 덮어 고친다(repair).
// 쓰기 실패: 실패를 받은 시각부터 SHARE_RETRY_S(60초) 동안 다시 쓰지 않는다(쓰기가 오래 걸린 뒤 실패해도 곧바로 되풀이하지 않게).
// 파일 쓰기는 틱과 따로 돈다(한 번에 하나): 느리거나 멈춘 쓰기가 다음 틱의 화면 갱신을 막지 않는다.
// 다시 읽기: 크기·시각이 그대로면 본문을 다시 읽지 않되, SHARE_REREAD_S(60초)마다 한 번은 읽는다(같은 크기·시각으로 바뀐 파일을 오래 놓치지 않게).
// 엔진 시계를 못 읽은 틱(대신 Date.now 로 잰 때): 화면만 고치고, 시각을 남기는 쓰기(자기 값의 받은 시각, 파일, 재시도 기한)는 하지 않는다.
// CLAUDE_CONFIG_DIR 을 못 읽은 세션: 기본 이름으로 다른 계정의 파일과 섞이지 않게 그 세션은 파일로 나누지 않는다(자기 값으로만).
// 세대(/reload-plugins·세션 재시작): 세션이 시작할 때 atom(claudeOwn2)의 gen 을 올리고 그 세대·칸 이름·파일 자리를 끝까지 넘긴다.
//   gen 은 모듈이 바뀌어도(/reload-plugins) 비교할 수 있는 한 줄 번호다. 누가 gen 을 올려 주인이 되는지는 시작 순서로 정한다:
//   atom 에 지금 주인의 시작 시각(ownAt: 그 세션이 시작하자마자 잰 엔진 시각 ms)과 모듈 이름(ownMod)을 둔다. 시작은 (a) 같은 모듈이면
//   이 모듈에서 가장 새 세션일 때, (b) 다른 모듈이 적은 주인이면 자기 시작 시각이 그보다 이르지 않을 때만 올리고 주인이 된다(같은 ms 면 나중에 적는 쪽).
//   update 가 버전이 어긋나 콜백을 다시 불러도 같은 규칙이라, 두 모듈이 같은 gen 을 읽고 어느 쪽이 먼저 닿든 나중에 시작한 쪽이 주인으로 끝나고,
//   늦게 풀린 옛 시작은 새 주인을 빼앗지 못한다. 주인이 못 된 시작은 그 뒤의 초기화(Clawd 읽기·설명 글자·타이머)를 하지 않고 끝낸다.
//   (받아들임: 시작 때 엔진 시계를 못 읽으면 Date.now 바탕 시각으로 어림한다. 시계가 크게 뒤로 가면 다른 모듈 사이의 순서가 틀릴 수 있다)
//   옛 세대는 새 세대가 생긴 뒤로는 쓰지 않는다: 자기 값 atom 은 update 콜백 안에서 세대를 보고(버전이 어긋나 콜백이 다시 불려도 덮지 못한다),
//   파일은 쓰기 직전 seq 를 받는 update 콜백이 세대를 보며 그 뒤로 기다림 없이 바로 쓴다.
//   화면 atom(claudeView)은 보일 값과 그 값을 올린 세대를 함께 담아, 콜백이 더 새 세대가 올린 값을 덮지 않는다. 경고(Clawd 의 '사용량이 바닥나요')는
//   화면 atom 에 실제로 올라간 값으로 정하고, 설명 글자(clawd atom 의 act)도 적은 세대를 함께 담아 옛 세대의 늦은 쓰기·재시도를 버린다.
//   이미 보낸 파일 쓰기가 늦게 도착하면(원자적인 파일 연산이 없어 막을 수 없다) 새 세대가 다음 틱(5초 안)에 자기 칸이 다르다는 것을 보고 다시 적는다.
//   그사이에도 새 세대의 화면 값은 자기 기억을 쓰고(파일의 자기 칸 판은 그 종류에 쓰지 않는다), 다른 세션은 칸마다 이미 본 가장 높은 seq 판을
//   놓지 않는다(foldSlots). 그래서 옛 칸이 새 칸보다 앞서 화면에 오르는 일은 없다.
// 원자적인 파일 연산이 없어 남는 것(받아들임): 두 세션이 같은 판을 읽고 차례로 쓰면 앞 세션의 자기 칸 갱신이 빠진다. 그 세션이 다음 틱에
//   자기 칸이 다르다는 것을 보고 다시 적어 5초 안에 낫고, 그사이 그 판을 이미 본 세션은 기억으로 계속 보인다.
import { CLAUDE_WIN_S } from './pace'

export type OwnWin = { kind: string; usedPct: number; resetsAt: number }
/** 관측 하나: 창 값 + 받은 시각(초) */
export type Obs = OwnWin & { at: number }
/** 세션 하나의 칸 */
export type Slot = { id: string; seq: number; windows: Obs[] }
/** 파일을 읽은 결과. readOnly: 앞으로 나올 판의 파일(쓰지 않는다), repair: 오래 깨져 있던 파일(덮어 고친다) */
export type ShareRead = { slots: Slot[]; readOnly?: boolean; repair?: boolean }

export const SHARE_V = 2
/** 관측이 이보다 오래됐으면(또는 이만큼 넘게 미래면) 죽은 것으로 본다(주간 창보다 하루 길게) */
export const SHARE_MAX_AGE_S = 8 * 86400
/** 관측의 at 이 지금보다 이만큼 넘게 미래면 이번에는 화면 후보에서 뺀다(지우지는 않는다) */
export const SHARE_FUTURE_S = 60
/** 두 관측의 창이 '같은 창'이라고 볼 resetsAt 차이 */
export const SAME_WINDOW_S = 600
/** 가장 새 관측에서 이만큼 안의 관측은 먼저·나중을 가리지 않는다(5초 폴링 + 읽기 지연) */
export const NEAR_S = 8
/** 파일에 두는 칸 수 상한(프로세스마다 하나라 평소에는 닿지 않는다) */
export const MAX_SLOTS = 64
/** 칸 하나에 두는 창 수 상한. 읽을 때와 적을 때 같은 상한·같은 차례(orderWins)로 고른다(달라서 매번 다시 적지 않게) */
export const MAX_WINS = 16
/** 크기·시각이 그대로여도 이만큼(초) 지나면 본문을 다시 읽는다(같은 크기로 같은 시각에 바뀐 파일을 오래 놓치지 않게) */
export const SHARE_REREAD_S = 60
/** 같은 크기·시각으로 잇달아 이만큼 깨져 읽히면 죽은 파일로 보고 덮어 고친다 */
export const SHARE_DEAD_TICKS = 3
/** 쓰기가 실패하면 실패한 때부터 이만큼(초) 다시 쓰지 않는다 */
export const SHARE_RETRY_S = 60

const fnv8 = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return (h >>> 0).toString(16).padStart(8, '0')
}
/** 파일 이름: CLAUDE_CONFIG_DIR 이 있으면 계정이 다를 수 있어 그 경로의 해시로 나눈다. v1(0.8.7~0.8.8)과 이름을 달리한다 */
export const shareFileName = (configDir?: string | null) =>
  configDir && configDir.trim() ? `claude-usage-v${SHARE_V}-${fnv8(configDir.trim())}.json` : `claude-usage-v${SHARE_V}.json`

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** 공유할 창 종류 이름(five_hour·seven_day 같은 것). 그 밖의 글자는 파일에서 읽지도 적지도 않는다 */
export const KIND_RE = /^[a-z0-9_]{1,40}$/
/** 칸 이름(무작위 UUID). 그 밖의 글자는 읽지도 적지도 않는다 */
export const SLOT_ID_RE = /^[a-z0-9-]{1,40}$/
/** 새 칸 이름 */
export const newSlotId = (): string => {
  try { const u = (globalThis as any).crypto?.randomUUID?.(); if (typeof u === 'string' && SLOT_ID_RE.test(u)) return u } catch { /* 아래 */ }
  let s = ''
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return s
}

/** 차례: 창 길이(CLAUDE_WIN_S) 오름차순, 모르는 종류는 뒤에 이름순 */
export const orderWins = <T extends { kind: string }>(ws: readonly T[]): T[] => [...ws].sort((a, b) => {
  const la = CLAUDE_WIN_S[a.kind], lb = CLAUDE_WIN_S[b.kind]
  if (la !== undefined && lb !== undefined) return la - lb
  if (la !== undefined) return -1
  if (lb !== undefined) return 1
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0
})

/** 칸 하나의 창들: orderWins 차례로 앞의 MAX_WINS 개(읽기·쓰기가 같은 것을 고른다) */
export const capWins = <T extends { kind: string }>(ws: readonly T[]): T[] => orderWins(ws).slice(0, MAX_WINS)
/** 리셋 시각이 지난 창(0 은 모름이라 지나지 않은 것으로 친다) */
export const expired = (w: { resetsAt: number }, nowS: number) => w.resetsAt > 0 && w.resetsAt <= nowS
/** 칸을 살려 둘 관측: 리셋 전이고 at 이 지금 ±8일 안 */
export const liveWin = (w: Obs, nowS: number) => !expired(w, nowS) && w.at >= nowS - SHARE_MAX_AGE_S && w.at <= nowS + SHARE_MAX_AGE_S
/** 화면 후보가 될 관측: 살아 있고 SHARE_FUTURE_S 넘게 미래가 아닌 것 */
const usable = (w: Obs, nowS: number) => w.at > 0 && liveWin(w, nowS) && w.at <= nowS + SHARE_FUTURE_S

const obsOf = (x: unknown): Obs | null => {
  const w = x as Partial<Obs> | null
  if (!w || typeof w.kind !== 'string' || !KIND_RE.test(w.kind)) return null
  if (!num(w.usedPct) || !num(w.resetsAt) || w.resetsAt < 0 || !num(w.at) || w.at <= 0) return null
  return { kind: w.kind, usedPct: w.usedPct, resetsAt: w.resetsAt, at: w.at }
}
/**
 * 파일 글자 → 칸들. JSON 이 깨졌으면 null(쓰는 중에 읽었을 수 있다). 모양이 틀린 칸·관측은 뺀다(칸 안의 같은 종류는 앞의 것, 같은 칸 이름은 높은 seq).
 * 미래 시각·만료는 여기서 거르지 않는다(칸은 본 그대로 옮겨 적는다). v 가 2 보다 크면 readOnly, 2 가 아니면 빈 것
 */
export const parseShare = (text: string): ShareRead | null => {
  let o: unknown
  try { o = JSON.parse(text) } catch { return null }
  const v = (o as { v?: unknown } | null)?.v
  if (num(v) && v > SHARE_V) return { slots: [], readOnly: true }
  const raw = (o as { slots?: unknown } | null)?.slots
  if (v !== SHARE_V || !Array.isArray(raw)) return { slots: [] }
  const by = new Map<string, Slot>()
  for (const s of raw.slice(0, MAX_SLOTS * 4)) {
    const x = s as Partial<Slot> | null
    if (!x || typeof x.id !== 'string' || !SLOT_ID_RE.test(x.id) || !num(x.seq) || x.seq < 0 || !Array.isArray(x.windows)) continue
    const seen = new Set<string>()
    const windows: Obs[] = []
    for (const w of x.windows.slice(0, MAX_WINS * 4)) {
      const ob = obsOf(w)
      if (!ob || seen.has(ob.kind)) continue
      seen.add(ob.kind); windows.push(ob)
    }
    const p = by.get(x.id)
    if (!p || x.seq > p.seq) by.set(x.id, { id: x.id, seq: x.seq, windows: capWins(windows) })
  }
  return { slots: byId([...by.values()]) }
}

const byId = (ss: Slot[]) => ss.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const newestLive = (s: Slot, nowS: number) => s.windows.reduce((m, w) => (liveWin(w, nowS) ? Math.max(m, w.at) : m), 0)
/**
 * 칸 수 상한: 모든 세션이 같은 차례(가장 최근의 살아 있는 관측이 새 칸 → 칸 이름)로 앞의 MAX_SLOTS 칸만 남긴다. 적는 세션의 자기 칸도
 * 특별히 남기지 않는다(자기 칸을 남기려고 남의 칸을 빼면, 그 세션이 다음에 이 칸을 빼는 핑퐁이 된다). 돌려줄 때는 이름순
 */
const capSlots = (ss: Slot[], nowS: number) => {
  if (ss.length <= MAX_SLOTS) return byId(ss)
  const rank = [...ss].sort((a, b) => newestLive(b, nowS) - newestLive(a, nowS) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return byId(rank.slice(0, MAX_SLOTS))
}
/**
 * 기억해 둔 칸들(mem)과 지금 읽은 칸들(file)을 합친다: 칸마다 seq 가 가장 높은 판(같으면 기억 쪽), 죽은 칸은 버린다.
 * 늦게 도착한 옛 쓰기가 칸을 옛 판으로 되돌려도 이미 본 새 판을 놓지 않고, 남이 버린 칸은 같은 규칙으로 여기서도 죽어 있다
 */
export const foldSlots = (mem: readonly Slot[], file: readonly Slot[], nowS: number): Slot[] => {
  const by = new Map<string, Slot>()
  for (const s of [...mem, ...file]) { const p = by.get(s.id); if (!p || s.seq > p.seq) by.set(s.id, s) }
  return capSlots([...by.values()].filter(s => s.windows.some(w => liveWin(w, nowS))), nowS)
}

/** 자기 칸에 적을 관측: 나이를 아는(ownAt > 0) 자기 값 중 살아 있는 것 */
export const ownSlotWins = (own: readonly OwnWin[], ownAt: Readonly<Record<string, number>>, nowS: number): Obs[] =>
  capWins(own.filter(w => KIND_RE.test(w.kind) && (ownAt[w.kind] ?? 0) > 0)
    .map(w => ({ kind: w.kind, usedPct: w.usedPct, resetsAt: w.resetsAt, at: ownAt[w.kind]! }))
    .filter(w => liveWin(w, nowS)))
/** 같은 관측들인지(리셋 시각은 같은 창 안의 흔들림을 같은 것으로) */
export const sameObs = (a: readonly Obs[], b: readonly Obs[]) => {
  if (a.length !== b.length) return false
  const x = orderWins(a), y = orderWins(b)
  return x.every((w, i) => {
    const v = y[i]!
    return w.kind === v.kind && w.usedPct === v.usedPct && w.at === v.at && Math.abs(w.resetsAt - v.resetsAt) <= SAME_WINDOW_S
  })
}
/**
 * 파일을 다시 적어야 하는지: 앞으로 나올 판의 파일이면 아니오, 오래 깨진 파일이면 예(자기 칸이 비어도 고친다),
 * 그 밖에는 자기 칸에 적을 것(mine)이 있고, 파일의 자기 칸(살아 있는 관측만)이 그것과 다르고, 적을 칸들(mem 의 남의 칸 + 자기 칸)을
 * 모든 세션과 같은 차례로 줄 세웠을 때 자기 칸이 앞의 MAX_SLOTS 안에 들 때만. 밖이면 적어도 다음 세션이 뺄 칸이라 적지 않는다
 * (자기 값이 바뀌면 그 관측이 가장 새것이 되어 다시 든다)
 */
export const planWrite = (file: ShareRead, mem: readonly Slot[], selfId: string, mine: readonly Obs[], nowS: number): boolean => {
  if (file.readOnly) return false
  if (file.repair) return true
  if (!mine.length) return false
  const f = file.slots.find(s => s.id === selfId)
  if (f && sameObs(f.windows.filter(w => liveWin(w, nowS)), mine)) return false
  return capSlots([...mem.filter(s => s.id !== selfId), { id: selfId, seq: 0, windows: [...mine] }], nowS).some(s => s.id === selfId)
}
/** 적을 칸들: 기억한 남의 칸 그대로 + 자기 칸(mine 이 있으면 새 seq 로, 없으면 기억한 판 그대로). 칸 수 상한은 모든 세션이 같은 차례로 */
export const composeSlots = (mem: readonly Slot[], selfId: string, seq: number, mine: readonly Obs[], nowS: number): Slot[] => {
  const others = mem.filter(s => s.id !== selfId)
  const self = mine.length ? { id: selfId, seq, windows: capWins(mine) } : mem.find(s => s.id === selfId)
  return capSlots(self ? [...others, self] : [...others], nowS)
}
/** 파일에 적을 글자(같은 내용이면 같은 글자: 칸은 이름순, 창은 orderWins 차례). 이상한 이름은 적지 않는다 */
export const shareText = (slots: readonly Slot[]) => JSON.stringify({
  v: SHARE_V,
  slots: byId(slots.filter(s => SLOT_ID_RE.test(s.id))).map(s => ({
    id: s.id, seq: s.seq,
    windows: capWins(s.windows.filter(w => KIND_RE.test(w.kind))).map(w => ({ kind: w.kind, usedPct: w.usedPct, resetsAt: w.resetsAt, at: w.at })),
  })),
})

/** 8초 안의 후보들에서 하나: 나중 창 → 큰 값 → 새 at → 늦은 resetsAt(모든 칸을 한 번에 보므로 순서와 상관없다) */
const best = (cands: readonly Obs[]): Obs => {
  const top = Math.max(...cands.map(o => o.at))
  const near = cands.filter(o => o.at >= top - NEAR_S)
  const lastR = Math.max(...near.map(o => o.resetsAt))
  const win = near.filter(o => o.resetsAt >= lastR - SAME_WINDOW_S)
  return win.reduce((a, b) => (
    b.usedPct !== a.usedPct ? (b.usedPct > a.usedPct ? b : a)
      : b.at !== a.at ? (b.at > a.at ? b : a)
        : b.resetsAt > a.resetsAt ? b : a))
}
/**
 * 화면에 보일 창들(머리 주석의 '화면 값'). slots: 기억해 둔 칸들(자기 칸 포함), own·ownAt: 자기 값과 종류마다 받은 시각(0 = 나이 모름)
 */
export const shownUsage = (slots: readonly Slot[], selfId: string, own: readonly OwnWin[], ownAt: Readonly<Record<string, number>>, nowS: number): OwnWin[] => {
  const ownKinds = new Map(own.map(w => [w.kind, w]))
  const pool = new Map<string, Obs[]>()
  const add = (o: Obs) => { if (usable(o, nowS)) pool.set(o.kind, [...(pool.get(o.kind) ?? []), { ...o, at: Math.min(o.at, nowS) }]) }
  for (const s of slots) for (const w of s.windows) if (s.id !== selfId || !ownKinds.has(w.kind)) add(w)
  for (const w of own) { const at = ownAt[w.kind] ?? 0; if (at > 0) add({ kind: w.kind, usedPct: w.usedPct, resetsAt: w.resetsAt, at }) }
  const out: OwnWin[] = []
  for (const kind of new Set([...pool.keys(), ...ownKinds.keys()])) {
    const c = pool.get(kind)
    const w = c?.length ? best(c) : ownKinds.get(kind)
    if (w) out.push({ kind: w.kind, usedPct: w.usedPct, resetsAt: w.resetsAt })
  }
  return orderWins(out)
}

/**
 * 자기 값이 지난번과 달라진 종류의 시각을 지금으로(없어진 종류는 지운다). known 이 false 면(기록 없음) 처음 본 값은 나이 모름(0).
 * 리셋 시각은 같은 창 안에서 조금 흔들려도(SAME_WINDOW_S 이내) 바뀐 것으로 치지 않는다: 흔들릴 때마다 '방금 본 값'이 되면
 * 안 쓰는 세션의 묵은 값이 다른 세션의 더 새 값을 계속 이긴다
 */
export const nextOwnAt = (prev: readonly OwnWin[], prevAt: Readonly<Record<string, number>>, cur: readonly OwnWin[], known: boolean, nowS: number) => {
  const old = new Map(prev.map(w => [w.kind, w]))
  const at: Record<string, number> = {}
  for (const w of cur) {
    const p = old.get(w.kind)
    if (!known) at[w.kind] = 0
    else if (!p || p.usedPct !== w.usedPct || Math.abs(p.resetsAt - w.resetsAt) > SAME_WINDOW_S) at[w.kind] = nowS
    else at[w.kind] = prevAt[w.kind] ?? 0
  }
  return at
}
