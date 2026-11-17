import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ClaudeWindow, ClawdAct, ClawdView, ClockView, CodexUsage, Finished, Job, PanelUi, PowerState, Snapshot, WeekStats } from '../types'
import { BATT_CELLS, BATT_COLS, CLOCK_COLS, CLOCK_ROWS, battColor, battFill, battKey, batterySource, clockSource, dateOf, hmOf, parseBatt } from './clock'
import {
  CAP, IMG_COLS, IMG_ROWS, RASTER_COLS, RASTER_ROWS, SIDE_TOP_ROWS, SPIN_ACTS, SPIN_SEQ, TOOL_HOLD_MS,
  OOPS_HOLD_MS, capText, celebrationFor, cellWidth, frameAt, isBusy, isFailure, isFrozen, isNight, msUntilChange, oopsFor, pickAct, pickMode,
  rasterCells, spinCells, spinGlyph, toolAct,
} from './clawd'
import type { ClawdLive, ClawdMode, Sprites } from './clawd'
import { AGY_TAG, ARGON_TTY, STR, langFromEnv, parseLangArg, prefOf } from './i18n'
import type { Lang, LangPref } from './i18n'
import { FLOOR_NONE, fitDone, nextFloor } from './layout'
import { sameJob } from './proc'
import { PY_CANDIDATES, PY_PROBE, checkArgv, fallbackHost, hostFromProbe, parsePower, powerArgv, pyArgv, stopPlan } from './host'
import type { Host } from './host'
import { CLAUDE_WIN_S, dhOf, paceColor, paceOf, paceTag } from './pace'
import { grassKey, grassPer, grassPng, grassTextTone, parseWeek, todayIdx, tokensText, weekdayOf } from './grass'
import type { Floor } from './layout'
import { YARD_BG_ROWS, YARD_ROWS, soilRgb, sceneKey, todOf, yardCount, yardFrames, yardScenePng, yardStripPng } from './yard'
import type { Tod } from './yard'

// No model calls: local scripts are read on a timer, so the pane costs no tokens.
const PANE = 'status-panel'
const EVERY_MS = 5000
// Codex 사용량은 네트워크로 묻기 때문에 5분에 한 번만(2026-11-16)
const USAGE_EVERY_MS = 5 * 60 * 1000
const snapshot = atom({ plugin: 'status-panel', key: 'snapshot' } as const,
  { at: 0, jobs: [], waiting: [], mem: { freePct: null, load: null, cpus: 0 } }, { shape: 'snapshot-1' })
const finished = atom({ plugin: 'status-panel', key: 'finished' } as const, [], { shape: 'finished-1' })
const usage = atom({ plugin: 'status-panel', key: 'usage' } as const, { at: 0 } as CodexUsage, { shape: 'usage-1' })
// Claude 사용량(5시간·주간): 상태 줄과 같은 수치를 엔진에서 받아 Codex 옆에 둔다(사용자 2026-11-16)
const claude = atom({ plugin: 'status-panel', key: 'claude' } as const, [] as ClaudeWindow[], { shape: 'claude-1' })
// 펼친 작업과 중지 확인 중인 작업. 작업 이름을 누르면 로그가 펼쳐지고 그 아래에 중지가 있다(작업 버튼 시안 '나')
const ui = atom({ plugin: 'status-panel', key: 'ui' } as const, { open: [], confirm: null } as PanelUi, { shape: 'ui-1' })
// 맨 위 시계·배터리(시안 '굵은 선 시계', 2026-11-16). 시각은 분이 바뀔 때만, 배터리는 1분마다 고친다
const power = atom({ plugin: 'status-panel', key: 'power' } as const, { pct: null, charging: false, at: 0 } as PowerState, { shape: 'power-1' })
const clockA = atom({ plugin: 'status-panel', key: 'clock' } as const, { hm: '', date: '' } as ClockView, { shape: 'clock-1' })
const POWER_EVERY_MS = 60_000
// 최근 끝남은 기본으로 모두 펼쳐 두고(패널이 꽉 차 보기 좋다, 사용자 2026-11-16), 접으면 DONE_SHOWN 개만 남긴다.
// shape 를 바꿔 예전(기본 접힘) 때 남은 값은 버리고 펼침에서 시작한다
const doneOpen = atom({ plugin: 'status-panel', key: 'doneOpen' } as const, true, { shape: 'doneOpen-2' })
const DONE_SHOWN = 2
// 화면 언어(hooks/i18n.ts). 고른 값('auto'|'ko'|'en')은 $.store 'lang' 에 남고, 정해진 언어는 이 atom 과 모듈 변수 S 에 둔다.
// 언어가 바뀌면 글자만 다시 그린다: 그림(Image)은 다시 그리기 규칙(tune.rend)대로 지난번 props 를 그대로 받아 다시 보내지 않는다
// 처음 그릴 때(세션 시작이 언어를 정하기 전)의 언어: 공개판은 영어, 개인판은 한국어
let lang0: Lang = 'en'
const langA = atom({ plugin: 'status-panel', key: 'lang' } as const, lang0, { shape: 'lang-1' })
// 최근 7일(hooks/week.py, 시안24 나안): 세션 시작 10초 뒤 한 번, 그 뒤 5분마다 읽는다. at 이 0 이면 아직 못 읽어 덩어리를 숨긴다
const weekA = atom({ plugin: 'status-panel', key: 'week' } as const,
  { at: 0, partial: false, days: [], total: { secs: 0, tokens: 0 } } as WeekStats, { shape: 'week-1' })
const WEEK_FIRST_MS = 10_000
const WEEK_EVERY_TICKS = 30 // 10초 틱 30번 = 5분
let S = STR[lang0]
let curLang: Lang = lang0
const envLang = async ($: any): Promise<Lang> => {
  const get = async (f: () => Promise<string | undefined>) => { try { return await f() } catch { return undefined } }
  return langFromEnv([await get(() => $.env.get('LC_ALL')), await get(() => $.env.get('LC_MESSAGES')), await get(() => $.env.get('LANG'))])
}
const readPref = async ($: any): Promise<LangPref> => { try { return prefOf(await $.store.get('lang')) } catch { return 'auto' } }
const langOf = async ($: any, pref: LangPref): Promise<Lang> => (pref === 'auto' ? envLang($) : pref)
// collect.py 의 코드 값 이름(대화형 agy)을 글자로, 나머지는 제어 문자만 거른다
const TTY_LABELS = new Set<string>([ARGON_TTY])
const isTty = (l: string) => TTY_LABELS.has(l)
const labelOf = (l: string) => (isTty(l) ? S.argonTty : clean(l))
const statusOf = (snap: Snapshot) => {
  const nc = snap.jobs.filter(j => j.tool !== 'argon').length, na = snap.jobs.length - nc
  return snap.jobs.length ? S.status(nc, na, snap.waiting.length) : undefined
}
// 그림(Image)은 다시 그리기(render)로 source 를 바꾸지 않고 blit 으로만 바꾼다. iTerm 은 다시 그리면서 그림 source 가 바뀌면
// 그 순간 Clawd 칸을 한 장면 동안 단색으로 칠했다(분이 바뀔 때 깜빡임, 2026-11-16 화면 녹화). 그래서 다시 그릴 때는 화면의 것을 그대로 준다
let clockShown = '' // 화면에 나가 있는 시계 그림의 시각
let clockMounted = false // 마지막 터미널 그리기에 시계 그림이 있었는지
let battShown = '' // 화면에 나가 있는 배터리 그림의 열쇠(battKey)
let battMounted = false
let clockWant = '' // 바꿔 그릴 시각(checkClock 이 적고, 틱이 차례가 되면 blit)
let battWant = '' // 바꿔 그릴 배터리 열쇠(readPower 가 적는다)
// 최근 7일 잔디 그림(hooks/grass.ts): 화면에 나가 있는 그림의 열쇠·png, 다시 그리기에 넘긴 png·칸 수, 틱이 바꿔 그릴 자료
let weekShown = ''
let weekShownPng = ''
let weekRendPng = ''
let weekPer = 0
let weekMounted = false
let weekData: WeekStats | null = null
// 놀이터(그림 한 장으로 합친 띠, hooks/yard.ts): 마리 수(0 이면 없음)·띠의 칸 폭·화면에 나가 있는 장면들(번호를 쉼표로 이은 것)
let yardN = 0
let yardCols = 0
let yardShown = ''
let yardBg = false // 화면의 놀이터가 배경 있는 그림인지
// 그림(Image) 교체는 한 번에 하나, 틱 간격을 두고 보낸다. iTerm 은 그림을 새로 받을 때마다 그 칸을 잠깐 단색으로 칠하는데,
// 여러 장이 같은 때 바뀌면(놀이터 다섯 + Clawd, 초당 15번) 그 단색 칸이 눈에 보였다(2026-11-16 화면 녹화: 133장면 중 27장면).
// 차례: 시계 → 배터리 → 최근 7일 잔디 → 큰 Clawd → 놀이터 한 마리(돌아가며)
let tickNo = 0
let imgBusy = false // 그림 blit 의 답을 기다리는 중
let imgLastTick = -99 // 마지막으로 그림 blit 을 보낸 틱
// 미세 조정(~/.claude/status-panel-tune.json 이 있으면 5초마다 읽는다): gap = 그림 교체 사이 최소 틱 수(1틱 = 0.1초),
// yardMs = 놀이터 띠가 다시 바뀌기까지 최소 ms, yard·big = false 면 그 그림은 움직이지 않는다
// starveMs = 놀이터가 이만큼 못 바뀌었으면 큰 Clawd 를 한두 틱 늦추더라도 한 번 바꾼다
// rend = 다시 그릴 때 그림에 넘길 장면: 'frozen' 지난번 다시 그리기에 넘긴 것 그대로(엔진이 아무것도 보내지 않는다) ·
//        'shown' 화면에 나가 있는 것(0.5.5~0.5.8) · 'now' 지금 시각의 것(0.5.4 까지)
// debug = 패널 맨 위에 줄 수·폭을 적는다(측정용). 놀이터 배경은 /clawd 배경 으로 켜고 끈다
const tune = { gap: 2, yardMs: 400, starveMs: 1500, yard: true, big: true, rend: 'frozen' as 'frozen' | 'shown' | 'now', debug: false }
// 다시 그리기에 넘긴 장면(엔진이 기억하는 props). 화면에 나가 있는 장면(drawnFrame·yardShown·clockShown·battShown)과 따로 둔다.
// 엔진은 props 가 지난번과 같으면 그림을 건드리지 않는데, 달라지면(화면의 장면을 넘겨도) 그림을 다시 보내고,
// 움직이던 그림 여러 장이 5초마다 한꺼번에 다시 가면서 갈색 네모가 번쩍였다(0.5.8 녹화: 번쩍임이 정확히 5초 간격)
let rendFrame = -1
let yardRend: number[] = []
let yardRendPng = ''
let clockRend = ''
let battRend = ''
let battAltRend = ''
let lastGeo = '' // 패널 폭·스크롤·터미널 크기. 바뀌면 그림을 지금 장면으로 새로 그린다
let yardLastAt = 0
let floor: Floor = FLOOR_NONE // 놀이터 바닥 높이(layout.ts nextFloor)
const FLOOR_RAISE_MS = 10 * 60_000
// 바닥 아래 빈 줄이 이보다 많으면(창을 키운 때 등) 흙으로 채우지 않고 놀이터를 한 번 내린다. 턴마다 생기는 1~3줄(작업자 줄·스피너)은 채운다
const FILL_MAX_ROWS = 3
const imgFree = () => !imgBusy && tickNo - imgLastTick >= tune.gap
const imgBlit = async ($: any, args: Record<string, unknown>) => {
  imgBusy = true; imgLastTick = tickNo
  try { return await $.ui.blit({ requestId: PANE, ...args }) } finally { imgBusy = false }
}
// 진행판에서 중지시킨 작업(pid). '최근 끝남'에 '중지함'으로 적는다
const stopped = new Set<number>()

// ── Clawd(맨 위 왼쪽 마스코트, 시안 '가'안 2026-11-16) ──
// 설명 글자가 바뀔 때만 atom 을 고치고, 움직임의 프레임은 모듈 변수 + $.ui.blit 로 바꾼다(다시 그리기 없음)
const clawd = atom({ plugin: 'status-panel', key: 'clawd' } as const,
  { on: true, look: 'plain', act: 'idle', raster: false, ready: 0 } as ClawdView, { shape: 'clawd-1' })
const CLAWD_KEY = 'clawd'
const CLAWD_TICK_MS = 100
const AGENTS_EVERY_MS = 5000
let sprites: Sprites | null = null
// 메인 루프의 활동(훅이 적기만 하고, 동작은 clawdTick 이 고른다)
const live = {
  tools: new Map<string, { name: string; at: number }>(),
  hold: null as ClawdLive['hold'],
  turn: null as null | { id: string; usedTool: boolean },
  celebrate: null as ClawdLive['celebrate'],
  oops: null as ClawdLive['oops'],
  // 열린 권한 확인 창: 루프(메인은 '')·도구 이름마다 몇 개. 그 루프의 같은 도구 호출이 끝나면(허락돼 돌았거나 거절됨) 하나 줄인다
  asks: new Map<string, number>(),
  subagents: false,
  jobs: false,
  lowUsage: false,
  lastActivity: Date.now(),
}
// Clawd 의 시계(ms). 훅·render 가 기다리지 않고 읽게 모듈 변수로 둔다: 시작할 때 $.clock.now() 에 한 번 맞추고(base),
// 그 뒤로는 실제로 흐른 시간을 더한다(틱이 밀려도 맞다). 틱마다 100ms 는 가게 해서 시험의 가짜 시계도 따라가고, 뒤로는 가지 않는다
let vnow = Date.now()
let base = vnow, baseReal = vnow
const nowMs = () => (vnow = Math.max(vnow, base + (Date.now() - baseReal)))
// 메인 턴이 시작·종료될 때마다 올린다: 끝난 턴의 도구가 늦게 정리돼도 동작을 되살리지 못하게
let turnGen = 0
// 가장 최근에 시작한 메인 턴과 마지막으로 끝낸 턴: 늦게 도착한 옛 턴의 종료가 지금 상태를 건드리지 못하게
let lastTurnId: string | null = null
let doneTurnId: string | null = null
// 지금 보이는 동작과 그 시작 시각, 설명 글자로 적어 둔 동작(atom), 마지막으로 그린 것(render 가 적음)
let curAct: ClawdAct = 'idle'
let actT0 = vnow
let shownAct: ClawdAct = 'idle'
let drawnKind: 'image' | 'raster' | null = null
let drawnFrame = -1
let drawnLook: 'sticker' | 'plain' = 'plain'
let probe = false // 새로 그린 뒤 한 번은 같은 장면이라도 blit 해서 그림을 그릴 수 있는지 본다
let probeWait = 0 // 그린 것이 화면에 붙을 틈을 주려고 확인을 몇 틱 미룬다
let probeDenies = 0 // 새로 그릴 때마다 확인 blit 이 거부된 횟수. 세 번 잇달아 거부되면 그림을 못 그리는 터미널로 본다
const PROBE_WAIT_TICKS = 2
const PROBE_DENY_MAX = 3
let drawGen = 0 // 터미널이 새로 그리거나 켜짐·모양이 바뀔 때마다 올린다: 그 전에 보낸 blit 의 답은 옛 그림의 것이라 버린다
let denyStreak = 0 // 잇달아 거부된 횟수: 다시 해 보는 간격을 1초에서 10초까지 늘리고, 여섯 번째에는 다시 그려질 때까지 쉰다
const DENY_GIVE_UP = 6
let clawdOn = true
let skip = 0, backoff = 0, blitting = false, lastAgents = 0
// 설명 앞의 돌아가는 표시(1×1 Raster). 일하는 동작이면 틱마다 한 칸씩 돌리고, 글자가 바뀔 때만 blit 한다(다시 그리기 없음)
const SPIN_KEY = 'spin'
let spinIdx = 0
let spinMounted = false // 마지막으로 그린 터미널 화면에 표시 Raster 가 있는지
let spinDrawn = '' // 화면에 나가 있는 표시(글자·색)
let spinBlitting = false
const spinTick = async ($: any, act: ClawdAct) => {
  if (!spinMounted || spinBlitting) return
  const want = spinCells(act, spinIdx)
  if (want === spinDrawn) return
  spinBlitting = true
  const gen = drawGen
  try {
    const r = await $.ui.blit({ requestId: PANE, key: SPIN_KEY, cells: want })
    if (gen !== drawGen) return // 기다리는 사이에 새로 그려졌다
    if (r && r.deny) spinMounted = false // 다시 그려질 때까지 쉰다
    else spinDrawn = want
  } catch { if (gen === drawGen) spinMounted = false } finally { spinBlitting = false }
}
const rasterCache = new Map<number, string>()
const cellsOf = (f: number) => {
  let c = rasterCache.get(f)
  if (!c && sprites) { c = rasterCells(sprites.frames[f] ?? [], sprites.palette); rasterCache.set(f, c) }
  return c ?? ''
}
const pngOf = (look: ClawdView['look'], f: number) => sprites?.png[look][f] ?? sprites?.png[look][0] ?? ''
const liveNow = (now: number): ClawdLive => ({
  now, tools: [...live.tools.values()], hold: live.hold, turn: live.turn, celebrate: live.celebrate,
  subagents: live.subagents, jobs: live.jobs, lowUsage: live.lowUsage, lastActivity: live.lastActivity,
  ask: live.asks.size > 0, oops: live.oops, night: isNight(now),
})
const askKey = (loop: string | undefined, tool: string) => `${loop ?? ''}\u0000${tool}`
const askOpen = (k: string) => live.asks.set(k, (live.asks.get(k) ?? 0) + 1)
const askDone = (k: string) => {
  const n = (live.asks.get(k) ?? 0) - 1
  if (n > 0) live.asks.set(k, n); else live.asks.delete(k)
}
/** 그 루프의 열린 권한 확인 창을 모두 닫힌 것으로(메인 턴이 시작·종료될 때) */
const askClear = (loop: string | undefined) => {
  const pre = `${loop ?? ''}\u0000`
  for (const k of [...live.asks.keys()]) if (k.startsWith(pre)) live.asks.delete(k)
}
const curFrame = (now: number, l: ClawdLive) => {
  const st = sprites?.states[curAct]
  return st ? frameAt(st, actT0, now, isFrozen(l)) : 0
}
// 훅 안의 관찰 코드는 어떤 예외도 밖으로 내보내지 않는다(도구·턴에 영향 없게)
const quiet = (fn: () => void) => { try { fn() } catch { /* 관찰만 하므로 무시 */ } }
const checkAgents = async ($: any) => {
  try {
    const list = await $.agent.list()
    live.subagents = (list ?? []).some((a: { status: string }) => a.status === 'running')
  } catch { /* 못 읽으면 앞 값 */ }
}
// 놀이터: 어느 마리든 장면이 바뀌었고 yardMs 가 지났으면 띠 한 장을 blit(보냈으면 true). 거부되면(칸이 없음) 다시 그려질 때까지 쉰다
const yardTick = async ($: any, now: number, frozen: boolean): Promise<boolean> => {
  if (!tune.yard || !yardN || !sprites || now - yardLastAt < tune.yardMs) return false
  const fr = yardFrames(sprites, yardN, now, frozen), tod = todOf(new Date(now))
  const key = yardBg ? sceneKey(fr, now, frozen, tod) : fr.join(',')
  if (key === yardShown) return false
  yardShown = key; yardLastAt = now
  const gen = drawGen
  try {
    const png = yardBg ? yardScenePng(sprites, fr, yardCols, now, frozen, tod) : yardStripPng(sprites, fr, yardCols)
    const r = await imgBlit($, { key: 'yard', source: { png } })
    if (r && r.deny && gen === drawGen) yardN = 0
  } catch { if (gen === drawGen) yardN = 0 }
  return true
}
// 시계·배터리·잔디 blit 이 거부됐을 때: 창이 안 붙어 있어서(mount·no-surface)가 아니고 alt·자리 표시·못 읽음 거부면 바로,
// 그 밖의 거부도 잇달아 세 번이면 그림을 못 그리는 터미널로 보고 글자 방식으로 바꾼다. Clawd 를 꺼 두면 큰 Clawd 의 확인이
// 없어서, 이것이 없으면 시계·배터리·잔디가 빈 그림 자리로 남았다(2026-11-16 검수)
let imgDenies = 0
const imgDenied = async ($: any, deny: string) => {
  if (/mount|no-surface/i.test(deny)) return
  if (/\balt\b|placeholder|cannot read/i.test(deny) || ++imgDenies >= PROBE_DENY_MAX) {
    imgDenies = 0
    await update($, clawd, c => (c.raster ? c : { ...c, raster: true }))
  }
}
// 시계·배터리 그림: 바꿀 것이 있고 차례가 비었으면 하나를 보낸다. 보냈으면 true
const clockBattTick = async ($: any) => {
  if (clockMounted && clockWant && clockWant !== clockShown) {
    if (!imgFree()) return true // 차례를 기다린다(다른 그림보다 먼저)
    const was = clockShown, hm = clockWant
    clockShown = hm
    try {
      const r = await imgBlit($, { key: 'clock', source: clockSource(hm) })
      if (r && r.deny) { clockShown = was; clockMounted = false; await imgDenied($, r.deny) } else imgDenies = 0
    } catch { clockShown = was; clockMounted = false }
    return true
  }
  if (battMounted && battWant && battWant !== battShown) {
    if (!imgFree()) return true
    const was = battShown, key = battWant
    battShown = key
    try {
      const r = await imgBlit($, { key: 'batt', source: batterySource(Number(key.replace('+', '')), key.endsWith('+')) })
      if (r && r.deny) { battShown = was; battMounted = false; await imgDenied($, r.deny) } else imgDenies = 0
    } catch { battShown = was; battMounted = false }
    return true
  }
  // 최근 7일 잔디: 자료가 바뀌었거나(최대 5분에 한 번) 날짜가 넘어갔을 때만
  if (weekMounted && weekData && weekPer) {
    const days = weekData.days, today = todayIdx(days, new Date(nowMs())), key = grassKey(days, today, weekPer)
    if (key !== weekShown) {
      if (!imgFree()) return true
      const was = weekShown, wasPng = weekShownPng, png = grassPng(days, today, weekPer)
      weekShown = key; weekShownPng = png
      try {
        const r = await imgBlit($, { key: 'week', source: { png } })
        if (r && r.deny) { weekShown = was; weekShownPng = wasPng; weekMounted = false; await imgDenied($, r.deny) } else imgDenies = 0
      } catch { weekShown = was; weekShownPng = wasPng; weekMounted = false }
      return true
    }
  }
  return false
}
const clawdTick = async ($: any) => {
  vnow += CLAWD_TICK_MS
  tickNo++
  const now = nowMs()
  const tookSlot = await clockBattTick($) // Clawd 가 꺼져 있어도 시계·배터리는 바뀐다
  if (!clawdOn || !sprites) return
  if (skip > 0) { skip--; return }
  if (now - lastAgents >= AGENTS_EVERY_MS) { lastAgents = now; void checkAgents($) }
  const l = liveNow(now)
  if (isBusy(l)) live.lastActivity = l.lastActivity = now
  if (live.hold && now >= live.hold.until) live.hold = null
  if (live.celebrate && now >= live.celebrate.until) live.celebrate = null
  if (live.oops && now >= live.oops.until) live.oops = null
  const act = pickAct(l)
  if (act !== curAct) { curAct = act; actT0 = now }
  // 설명 글자: 적어 둔 것과 달라졌을 때만 atom 을 고친다(글자가 같은 동작끼리는 다시 그리지 않는다)
  if (CAP[shownAct].text !== CAP[act].text || CAP[shownAct].color !== CAP[act].color) {
    shownAct = act
    await update($, clawd, c => ({ ...c, act }))
    if (!clawdOn) return // 기다리는 사이에 꺼졌다
  }
  if (SPIN_ACTS.has(act)) spinIdx = (spinIdx + 1) % SPIN_SEQ.length
  void spinTick($, act)
  const frozen = isFrozen(l)
  if (frozen) skip = 9 // 멈춘 동안은 1초에 한 번만 본다
  if (tookSlot) return
  const f = curFrame(now, l)
  // 큰 Clawd 가 이번 틱에 바꿀지. 그림 방식은 그림 차례(imgFree)가 비어야 하고, 글자 방식(Raster)은 차례와 상관없다
  let bigGo = false
  if (drawnKind && !blitting && (f !== drawnFrame || probe) && (tune.big || probe)) {
    if (probe && probeWait > 0) probeWait--
    else if (backoff > 0) backoff--
    else bigGo = drawnKind !== 'image' || imgFree()
  }
  // 놀이터가 오래 굶었으면(큰 Clawd 가 쉬지 않고 바뀌는 동작) 이번 차례를 놀이터에 먼저 준다. 바꿀 것이 없으면 큰 Clawd 가 그대로 쓴다
  if (bigGo && drawnKind === 'image' && yardN > 0 && now - yardLastAt >= tune.starveMs && await yardTick($, now, frozen)) return
  if (!bigGo) {
    // 큰 Clawd 가 쓰지 않는 틱은 놀이터 차례. 다만 큰 Clawd 가 곧(gap 안에) 바뀔 참이면 자리를 비워 둔다(오래 굶었으면 예외)
    if (imgFree()) {
      const soon = drawnKind === 'image' && tune.big ? msUntilChange(sprites.states[curAct], actT0, now, frozen) : Infinity
      if (soon >= tune.gap * CLAWD_TICK_MS || now - yardLastAt >= tune.starveMs) await yardTick($, now, frozen)
    }
    return
  }
  blitting = true
  const gen = drawGen
  const kind = drawnKind, wasProbe = probe
  if (kind === 'image') { imgBusy = true; imgLastTick = tickNo }
  try {
    const r = kind === 'image'
      ? await $.ui.blit({ requestId: PANE, key: CLAWD_KEY, source: { png: pngOf(drawnLook, f) } })
      : await $.ui.blit({ requestId: PANE, key: CLAWD_KEY, cells: cellsOf(f) })
    if (gen !== drawGen) return // 기다리는 사이에 새로 그려졌다: 이 답은 옛 그림의 것이라 버린다
    if (r && r.deny) {
      // 터미널이 그림을 못 그려 alt 를 그리는 중이면 글자 방식으로 바꾼다. 거부 문구가 달라도, 새로 그린 직후의 확인이
      // 세 번 잇달아 거부되면 같은 경우로 본다(창이 안 붙어 있어서 거부된 것은 세지 않는다). 그 밖은 조용히 간격을 늘린다
      const away = /mount|no-surface/i.test(r.deny)
      if (kind === 'image' && wasProbe && !away) probeDenies++
      probe = false // 다음 확인은 다시 그려진 뒤에
      if (kind === 'image' && ((!away && /\balt\b|placeholder|cannot read/i.test(r.deny)) || probeDenies >= PROBE_DENY_MAX)) {
        drawnKind = null; probeDenies = 0; denyStreak = 0
        await update($, clawd, c => ({ ...c, raster: true }))
      } else if (++denyStreak >= DENY_GIVE_UP) drawnKind = null // 창이 닫혔거나 가려진 것으로 보고, 다시 그려질 때까지 쉰다
      else backoff = Math.min(100, 10 * 2 ** (denyStreak - 1))
    } else { drawnFrame = f; probe = false; backoff = 0; probeDenies = 0; denyStreak = 0 }
  } catch { if (gen === drawGen) backoff = 50 } finally { blitting = false; if (kind === 'image') imgBusy = false }
}
// 이보다 오래 갱신이 없으면 바닥에 경고를 띄운다. 평소에는 바닥 줄이 없다(사용자 2026-11-16)
const STALE_S = 30
const USAGE_STALE_S = 15 * 60
let home = ''

const dur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? S.durH(h, m) : m ? S.durM(m) : S.durS(s)
}
const ago = (s: number | null) => (s === null ? S.agoNone : s < 60 ? S.agoNow : S.ago(dur(s)))
const clock = (t: number) => {
  const d = new Date(t * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// Log lines and labels can carry terminal escapes; a Pane refuses control characters.
// C1 제어 문자(U+0080~U+009F)도 뺀다: 다른 프로세스의 명령 줄에서 온 글자(모델·프로젝트·작업 이름)에 섞일 수 있다
const clean = (t: string) => t.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
// gpt-6-astra → astra, gpt-6.1-sol → 6.1-sol. 예전 식은 'gpt-6'까지 지워 '.1-sol'로 잘렸다(2026-11-16)
const short = (j: { model: string; effort: string }) =>
  [clean(j.model).replace(/^gpt-(\d+-)?/, '').replace(/^gemini-4-/, ''), clean(j.effort)].filter(Boolean).join('·')
// 시각: 오늘이 아니면 날짜를 붙인다(10-26 기록이 '02:13 확인'으로만 보여 오늘 일처럼 보였다, 11-09)
const seen = (t: number, now: number) => {
  const d = new Date(t * 1000), n = new Date(now * 1000)
  return d.toDateString() === n.toDateString() ? clock(t) : `${S.md(d.getMonth() + 1, d.getDate())} ${clock(t)}`
}
const winName = (mins: number) =>
  mins >= 10000 ? S.winWeek : mins >= 1440 ? S.winD(Math.round(mins / 1440)) : mins >= 60 ? S.winH(Math.round(mins / 60)) : S.winM(mins)
const meter = (p: number) => {
  const n = Math.max(0, Math.min(10, Math.round(p / 10)))
  return ['▰'.repeat(n), '▱'.repeat(10 - n)]
}
const leftColor = (left: number) => (left <= 10 ? 'error' : left <= 30 ? 'warning' : 'success')
const claudeName = (kind: string) => S.claudeWin[kind] ?? kind
const RULE = '─'.repeat(30)

// Claude 사용량 창을 읽어 달라졌을 때만 적는다(비용 없는 호출)
const readClaude = async ($: any) => {
  try {
    const { rateLimits } = await $.session.usage()
    const next: ClaudeWindow[] = (rateLimits ?? []).map((r: { kind: string; percentUsed: number; resetsAt?: string }) => ({
      kind: r.kind, usedPct: r.percentUsed, resetsAt: r.resetsAt ? Math.floor(Date.parse(r.resetsAt) / 1000) || 0 : 0,
    }))
    live.lowUsage = next.some(w => w.usedPct >= 90)
    const prev = await read($, claude)
    if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, claude, () => next)
  } catch { /* 수치를 못 읽으면 앞선 값을 그대로 둔다 */ }
}
// 파이썬을 부르는 명령과 운영체제: 세션마다 한 번 정하고(findHost), 파이썬을 부르는 곳은 모두 이 답을 기다린다
let hostP: Promise<Host> = Promise.resolve(fallbackHost(undefined))
const findHost = async ($: any): Promise<Host> => {
  for (const py of PY_CANDIDATES) {
    try {
      const h = hostFromProbe(py, await $.process.run([...py, '-c', PY_PROBE], { timeoutMs: 8000 }))
      if (h) return h
    } catch { /* 없는 명령: 다음 후보 */ }
  }
  let osEnv: string | undefined
  try { osEnv = await $.env.get('OS') } catch { /* 모르면 맥처럼 */ }
  return fallbackHost(osEnv)
}
const readPower = async ($: any) => {
  try {
    const h = await hostP
    // 맥 이외에서는 파이썬 도우미가 늦게 뜰 수 있어 조금 더 기다린다
    const r = await $.process.run(powerArgv(h, $.plugin.root), { timeoutMs: h.os === 'darwin' ? 3000 : 8000 })
    const b = h.os === 'darwin' ? parseBatt(r.stdout || '') : parsePower(r.stdout || '')
    if (b.pct !== null) battWant = battKey(b.pct, b.charging) // 그림은 틱이 차례에 맞춰 바꾼다
    const prev = await read($, power)
    if (prev.pct !== b.pct || prev.charging !== b.charging) await update($, power, () => ({ ...b, at: Math.floor(Date.now() / 1000) }))
  } catch { /* pmset·도우미가 없으면 배터리 칸을 그리지 않는다 */ }
}
const checkClock = async ($: any) => {
  try {
    const d = new Date(await $.clock.now()), hm = hmOf(d), date = dateOf(d, curLang)
    clockWant = hm // 그림은 틱이 차례에 맞춰 바꾼다
    const prev = await read($, clockA)
    // 글자 시계(휴대폰·좁은 패널 등 다른 화면)를 위해 분이 바뀌면 늘 적는다. 그림 시계는 다시 그려도 지난번 그림 그대로라(tune.rend) 보내지 않는다
    if (prev.date !== date || prev.hm !== hm) await update($, clockA, () => ({ hm, date }))
  } catch { /* 세션이 끝나는 중이면 다음 틱에 */ }
}
// 명령을 지금 언어(S)의 설명으로 등록한다. 같은 이름을 다시 등록하면 바뀐다(CommandSpec: 'Registering a name again replaces it')
const registerCommands = async ($: any) => {
  await $.command.register({ name: 'status-panel', description: S.descPanel, argumentHint: S.hintPanel })
  await $.command.register({ name: 'clawd', description: S.descClawd, argumentHint: S.hintClawd })
}
// 언어를 바꾼다: 글자(atom)·시계 옆 날짜·상태 줄·명령 설명·패널 제목(열려 있고 놓여 있을 때만 다시 열어 제목만 고친다)
const setLang = async ($: any, lg: Lang) => {
  curLang = lg; S = STR[lg]
  await update($, langA, () => lg)
  try { await registerCommands($) } catch { /* 설명은 다음 세션에 */ }
  try {
    const d = new Date(await $.clock.now()), prev = await read($, clockA)
    if (prev.date) await update($, clockA, c => ({ ...c, date: dateOf(d, lg) }))
  } catch { /* 다음 시계 확인에 */ }
  try { $.ui.status(statusOf(await read($, snapshot))) } catch { /* 다음 틱에 */ }
  try {
    if ((await $.ui.panes()).some((p: { id: string; isPlaced?: boolean }) => p.id === PANE && p.isPlaced !== false))
      await $.ui.open({ id: PANE, title: S.title, backgroundColor: 'transparent' })
  } catch { /* 제목은 다음에 열 때 */ }
}
const readTune = async ($: any) => {
  if (!home) return
  try {
    // 보통은 없는 파일이라, 있는지 먼저 보고 있을 때만 읽는다(5초마다 cat 을 띄우지 않게)
    const path = `${home}/.claude/status-panel-tune.json`
    if (!(await $.fs.exists(path))) return
    const text = String(await $.fs.read(path))
    if (!text.trim()) return
    const t = JSON.parse(text) as Partial<typeof tune>
    if (typeof t.gap === 'number') tune.gap = Math.max(1, Math.min(50, Math.round(t.gap)))
    if (typeof t.yardMs === 'number') tune.yardMs = Math.max(100, Math.min(60000, Math.round(t.yardMs)))
    if (typeof t.starveMs === 'number') tune.starveMs = Math.max(200, Math.min(600000, Math.round(t.starveMs)))
    if (typeof t.yard === 'boolean') tune.yard = t.yard
    if (typeof t.big === 'boolean') tune.big = t.big
    if (t.rend === 'frozen' || t.rend === 'shown' || t.rend === 'now') tune.rend = t.rend
    if (typeof t.debug === 'boolean') tune.debug = t.debug
  } catch { /* 파일이 없거나 깨졌으면 지금 값 그대로 */ }
}
// 최근 7일: 실패·오류·해석 실패면 지난 값을 그대로 둔다. 한 번에 하나만 돌고, 다 못 센(partial) 결과면 다음 10초 틱에 이어 센다
// 도는 중 표시는 세션마다 새로(bgGen): 끝나는 세션에서 답을 못 받은 읽기가 표시를 쥔 채 남아도 새 세션이 막히지 않게
let bgGen = 0
let weekBusy = false
let weekAgain = false
let collecting = false // collect.py 가 도는 중
const readWeek = async ($: any) => {
  if (weekBusy) return
  weekBusy = true; weekAgain = false
  const gen = bgGen
  try {
    const r = await $.process.run(pyArgv(await hostP, `${$.plugin.root}/hooks/week.py`), { timeoutMs: 15000 })
    const w = parseWeek(r.stdout || '')
    if (!w) return
    weekAgain = !!w.partial
    weekData = w
    const prev = await read($, weekA)
    if (JSON.stringify(prev) !== JSON.stringify(w)) await update($, weekA, () => w)
  } catch { /* 다음 차례에 */ } finally { if (gen === bgGen) weekBusy = false }
}
// Codex 사용량은 네트워크로 묻는다: 겹쳐 돌지 않고, 앞선 시작에서 30초 안에는 다시 묻지 않는다
// (작업이 끝날 때마다·/status-panel 때도 부른다). 세션이 새로 시작되면 usageGen 을 올려 처음부터
const USAGE_MIN_GAP_MS = 30_000
let usageBusy = false
let usageLast = 0
let usageGen = 0
const readUsage = async ($: any) => {
  const t = Date.now()
  if (usageBusy || (usageLast && t - usageLast < USAGE_MIN_GAP_MS)) return
  usageBusy = true; usageLast = t
  const gen = usageGen
  try {
    const r = await $.process.run(pyArgv(await hostP, `${$.plugin.root}/hooks/codex_usage.py`), { timeoutMs: 25000 })
    const u = JSON.parse(r.stdout) as CodexUsage
    if (gen !== usageGen) return
    // 읽기에 실패하면 앞서 읽은 수치는 남기고 오류만 붙인다
    await update($, usage, prev => (u.error && prev.windows ? { ...prev, error: u.error } : u))
  } catch (err) {
    if (gen !== usageGen) return
    await update($, usage, prev => ({ ...prev, at: prev.at || Math.floor(Date.now() / 1000), error: String(err).slice(0, 80) }))
  } finally { if (gen === usageGen) usageBusy = false }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    floor = FLOOR_NONE
    // 언어를 먼저 정한다: 명령 설명은 이때 고른 언어로 등록한다
    curLang = await langOf($, await readPref($)); S = STR[curLang]
    try { await update($, langA, () => curLang) } catch { /* 다음 그리기에 */ }
    await registerCommands($)
    usageGen++; usageBusy = false; usageLast = 0 // 앞 세션의 사용량 읽기는 버리고 새로 묻는다
    bgGen++; collecting = false; weekBusy = false; weekAgain = false; imgDenies = 0
    hostP = findHost($) // 파이썬 명령·운영체제(기다리지 않는다: 첫 읽기들이 이 답을 기다린다)
    void $.ui.open({ id: PANE, title: S.title, backgroundColor: 'transparent' })

    // Clawd: 켜짐·모양은 세션이 바뀌어도 남는다($.store). 그림 자료는 모드 폴더의 sprites.json
    const loadClawd = async () => {
      let pref: { on?: boolean; look?: string; bg?: boolean; yard?: boolean } = {}
      try { pref = ((await $.store.get('clawd')) ?? {}) as typeof pref } catch { /* 기본값 */ }
      clawdOn = pref.on !== false
      const look: ClawdView['look'] = pref.look === 'sticker' ? 'sticker' : 'plain' // 기본은 민무늬(사용자 2026-11-16)
      try {
        const text = await $.fs.read(`${$.plugin.root}/clawd/sprites.json`)
        sprites = JSON.parse(text as string) as Sprites
        rasterCache.clear()
      } catch { sprites = null }
      // 모드를 다시 읽으면 모듈 변수는 처음부터라, 남아 있던 설명(act)도 대기로 맞춘다. 돌던 턴은 다음 이벤트부터 다시 따라간다
      try { const t = await $.clock.now(); base = vnow = t; baseReal = Date.now() } catch { /* 처음 값(Date.now) */ }
      live.lastActivity = actT0 = vnow; curAct = shownAct = 'idle'
      const bg = pref.bg !== false // 놀이터 배경은 기본 켜짐(사용자 2026-11-16)
      const yard = pref.yard !== false // 놀이터도 기본 켜짐
      await update($, clawd, c => ({ ...c, on: clawdOn, look, bg, yard, act: 'idle' as ClawdAct, ready: sprites ? vnow : 0 }))
    }
    void loadClawd()
    $.clock.every(CLAWD_TICK_MS, () => void clawdTick($))

    // collect.py(최대 20초)가 5초 틱보다 오래 걸려도 겹쳐 돌지 않게 한다
    const tick = async () => {
      if (collecting) return
      collecting = true
      const gen = bgGen
      try {
        let snap: Snapshot
        try {
          const ran = await $.process.run(pyArgv(await hostP, `${$.plugin.root}/hooks/collect.py`), { timeoutMs: 20000 })
          snap = JSON.parse(ran.stdout)
        } catch (err) {
          const prev = await read($, snapshot)
          await update($, snapshot, () => ({ ...prev, error: String(err).slice(0, 120) }))
          return
        }
        const prev = await read($, snapshot)
        const alive = new Set(snap.jobs.map(j => j.pid))
        const gone = prev.at ? prev.jobs.filter(j => !alive.has(j.pid)) : []
        if (gone.length) {
          const done: Finished[] = []
          for (const j of gone) {
            const hasReport = j.out ? await $.fs.exists(j.out) : false
            const wasStopped = stopped.delete(j.pid)
            // 보고 파일을 받기로 한 작업(-o)만 '보고서 없음'을 붙인다. out 이 없던 작업은 noOut 으로 적어 둔다(예전 기록엔 없음)
            done.push({ pid: j.pid, label: j.label, model: j.model, effort: j.effort, at: snap.at, elapsed: j.elapsed, hasReport, ...(j.out ? {} : { noOut: true }), ...(wasStopped ? { stopped: true } : {}) })
            $.ui.toast(S.finToast(j.tool === 'argon' ? AGY_TAG : 'Codex', wasStopped, labelOf(j.label), !!j.out && !hasReport && !wasStopped))
          }
          await update($, finished, list => [...done, ...list].slice(0, 8))
          // 끝난 작업은 펼침·중지 확인 상태에서도 뺀다
          const cur = await read($, ui)
          if (cur.open.some(p => !alive.has(p)) || (cur.confirm !== null && !alive.has(cur.confirm)))
            await update($, ui, u => ({ open: u.open.filter(p => alive.has(p)), confirm: u.confirm !== null && alive.has(u.confirm) ? u.confirm : null }))
          void readUsage($) // 작업이 끝나면 사용량도 바로 다시 본다
        }
        await update($, snapshot, () => snap)
        live.jobs = snap.jobs.length > 0
        $.ui.status(statusOf(snap))
      } finally { if (gen === bgGen) collecting = false }
    }
    void tick()
    $.clock.every(EVERY_MS, () => void tick())
    home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '' // 윈도는 보통 HOME 이 없다
    // 배경 읽기는 세션이 끝나는 중에 늦게 끝나도 오류를 밖으로 내보내지 않는다
    const timeTick = async () => {
      try {
        await checkClock($); await readTune($)
        await readClaude($)
      } catch { /* 다음 틱에 */ }
    }
    void timeTick()
    $.clock.every(EVERY_MS, () => void timeTick())
    void readUsage($)
    $.clock.every(USAGE_EVERY_MS, () => void readUsage($))
    void readPower($)
    $.clock.every(POWER_EVERY_MS, () => void readPower($))
    // 10초 틱: 첫 틱에 읽고 그 뒤 30틱(5분)마다. 지난 결과가 partial 이면 다음 틱에 바로 이어 센다(돌고 있으면 기다린다)
    let weekTicks = 0, weekDue = 0
    $.clock.every(WEEK_FIRST_MS, () => {
      const n = weekTicks++
      if (weekBusy || (n < weekDue && !weekAgain)) return
      weekDue = n + WEEK_EVERY_TICKS
      void readWeek($)
    })

    return started
  })

  on('command.run', { command: 'status-panel' }, async ($, e) => {
    const a = (e.args ?? '').trim()
    if (a) {
      // '/status-panel lang <auto|en|ko>' · '/status-panel 언어 <자동|영어|한국어>'. 답은 바꾼 언어로
      const m = a.match(/^(lang|언어)\s+(\S+)$/i)
      const pref = m ? parseLangArg(m[2]!) : null
      if (!pref) return { text: S.langUsage }
      try { await $.store.set('lang', pref) } catch { /* 이번 세션에만 적용 */ }
      await setLang($, await langOf($, pref))
      return { text: S.langSet(pref) }
    }
    // 닫혀 있던 패널을 다시 열면 화면은 새로 그려지는데, 다시 그리기 규칙(tune.rend 'frozen')대로면 지난번 props(옛 시계·배터리·잔디)를
    // 넘기면서 '화면에 나간 것' 기록은 지금 값이라 blit 도 따르지 않는다. 그래서 이미 보이던 게 아니면 다음 그리기를 지금 장면으로 한다
    let shown = false
    try { shown = (await $.ui.panes()).some((p: { id: string; isShown?: boolean; isPlaced?: boolean }) => p.id === PANE && p.isShown && p.isPlaced !== false) } catch { /* 모르면 새로 그린다 */ }
    if (!shown) lastGeo = ''
    await $.ui.open({ id: PANE, title: S.title, backgroundColor: 'transparent' })
    void readUsage($)

    return { text: S.opened }
  })


  // ── Clawd 관찰 훅: 모듈 변수에 적기만 하고 next(e) 의 결과를 그대로 돌려준다 ──
  // 서브에이전트(e.agentId 있음)의 도구·턴은 동작에 넣지 않는다(그 루프의 권한 확인 창을 닫는 데만 쓴다). 기다림(next)은 훅 예산에 들지 않는다(HookBudget)
  // 결정(권한·결과)은 바꾸지 않는다: 모든 결과를 받은 그대로 돌려준다
  on('tool.call', async ($, e, next) => {
    // 서브에이전트의 도구는 동작에 넣지 않고, 그 루프에 열린 권한 확인 창을 닫는 데만 쓴다
    if (e.agentId !== undefined) {
      const k = askKey(e.agentId, e.tool)
      try { return await next(e) } finally { quiet(() => { if (live.asks.has(k)) askDone(k) }) }
    }
    const id = e.tool_use_id, name = e.tool, at = nowMs(), gen = turnGen, k = askKey(undefined, name)
    quiet(() => {
      live.tools.set(id, { name, at })
      if (live.turn) live.turn.usedTool = true
      live.lastActivity = at
      skip = 0
    })
    let r: unknown
    try {
      const res = await next(e)
      r = res
      return res
    } finally {
      quiet(() => {
        if (live.tools.get(id)?.at === at) live.tools.delete(id)
        if (live.asks.has(k)) askDone(k) // 권한 확인 창이 열렸던 호출이 끝났다(허락돼 돌았거나 거절됨)
        // 기다리는 사이에 턴이 끝났으면(중단 등) 끝난 턴의 도구가 동작을 되살리지 않게 그대로 둔다
        if (gen === turnGen) {
          const until = at + TOOL_HOLD_MS, t = nowMs() // 금방 끝난 도구도 시작부터 1.2초는 보이게
          const act = toolAct(name)
          // 대답을 기다리던 도구는 답이 오면 바로 끝낸다(유지하지 않음)
          if (until > t && act !== 'ask') live.hold = { act, until }
          if (isFailure(r)) live.oops = { until: t + OOPS_HOLD_MS } // 실패·거절: 2.4초 '앗'
          live.lastActivity = t
        }
      })
    }
  })

  // 권한 확인 창(classic.PermissionRequest): 엔진이 사람에게 물을 때 울린다. 결과는 그대로 넘기고 결정은 건드리지 않는다.
  // 아래 훅(설정 훅)이 대신 답했으면 창이 뜨지 않으므로 바로 닫는다. 아니면 그 루프의 같은 도구 호출이 끝날 때 닫는다
  on('classic.PermissionRequest', async ($, e, next) => {
    const k = askKey(e.agent_id, e.tool_name)
    quiet(() => { askOpen(k); live.lastActivity = nowMs(); skip = 0 })
    let answered = true
    try {
      const r = await next(e)
      answered = !!r && typeof r === 'object' && ((r as { decision?: unknown }).decision !== undefined || (r as { block?: unknown }).block !== undefined)
      return r
    } finally {
      if (answered) quiet(() => { if (live.asks.has(k)) askDone(k) })
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) quiet(() => {
      turnGen++
      lastTurnId = e.turnId
      live.turn = { id: e.turnId, usedTool: false }
      live.tools.clear(); live.hold = null
      live.celebrate = null // 새 턴이 시작되면 축하는 바로 취소
      live.oops = null; askClear(undefined)
      live.lastActivity = nowMs()
      skip = 0
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) quiet(() => askClear(e.agentId)) // 서브에이전트의 턴이 끝나면 그 루프의 확인 창도 닫혔다
    if (e.agentId === undefined) quiet(() => {
      // 가장 최근에 시작한 턴의 종료만 받는다(시작을 못 들은 턴은 받는다). 다음 턴이 시작된 뒤에 늦게 온 옛 턴의 종료, 두 번 온 종료는 넘긴다
      if ((lastTurnId !== null && e.turnId !== lastTurnId) || e.turnId === doneTurnId) return
      doneTurnId = e.turnId
      turnGen++
      live.turn = null
      live.tools.clear(); live.hold = null // 끝난 턴의 도구는 더 보지 않고, 마지막 도구의 1.2초 유지보다 축하가 먼저
      const t = nowMs()
      live.celebrate = celebrationFor(e.reason, e.durationMs, t)
      askClear(undefined) // 끝난 턴에 열려 있던 권한 확인 창은 닫혔다
      // 오류로 끝나면 축하 대신 '앗'. 중단(aborted)은 거절 직후일 수 있어 이미 보이는 '앗' 을 그대로 둔다
      const o = oopsFor(e.reason, t)
      if (o) live.oops = o
      live.lastActivity = t
      skip = 0
    })
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const a = (e.args ?? '').trim()
    const cur = await read($, clawd)
    let isOn = cur.on, look = cur.look
    const bg = cur.bg !== false, yard = cur.yard !== false
    const save = async (p: { on: boolean; look: string; bg: boolean; yard: boolean }) => {
      try { await $.store.set('clawd', p) } catch { /* 이번 세션에만 적용 */ }
    }
    // '/clawd 놀이터'·'/clawd 배경' 은 켜기·끄기를 바꾸고, '켜기'·'끄기' 를 붙이면 그대로 맞춘다. 다른 그림은 건드리지 않는다
    const onOff = (w: string | undefined, now: boolean) => (w ? /^(켜기|켜|on)$/i.test(w) : !now)
    const yardArg = a.match(/^(놀이터|yard|playground)(?:\s+(켜기|켜|on|끄기|꺼|off))?$/i)
    if (yardArg) {
      const want = onOff(yardArg[2], yard)
      await save({ on: isOn, look, bg, yard: want })
      await update($, clawd, c => ({ ...c, yard: want }))
      return { text: `${S.yardSet(want)}${isOn || !want ? '' : S.hiddenOff}` }
    }
    const bgArg = a.match(/^(배경|bg|background)(?:\s+(켜기|켜|on|끄기|꺼|off))?$/i)
    if (bgArg) {
      const want = onOff(bgArg[2], bg)
      await save({ on: isOn, look, bg: want, yard })
      await update($, clawd, c => ({ ...c, bg: want }))
      const hidden = !isOn ? S.hiddenOff : !yard ? S.hiddenYard : ''
      return { text: `${S.bgSet(want)}${hidden}` }
    }
    if (!a) isOn = !isOn
    else if (/^(켜기|켜|on)$/i.test(a)) isOn = true
    else if (/^(끄기|꺼|off)$/i.test(a)) isOn = false
    else if (/^(테두리|스티커|sticker)$/i.test(a)) { isOn = true; look = 'sticker' }
    else if (/^(민무늬|plain)$/i.test(a)) { isOn = true; look = 'plain' }
    else return { text: S.clawdUsage }
    clawdOn = isOn
    probeDenies = 0; denyStreak = 0; backoff = 0; skip = 0; drawGen++
    await save({ on: isOn, look, bg, yard })
    // 켜거나 모양을 고르면, 글자 방식으로 물러나 있던 것도 그림 방식부터 다시 해 본다
    await update($, clawd, c => ({ ...c, on: isOn, look, raster: isOn ? false : c.raster }))
    return { text: isOn ? S.clawdOn(look === 'sticker') : S.clawdOff }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e) as Record<string, any>
    const { Box, Text, Button } = $.ui.resolve(e)
    const Image = table.Image, Raster = table.Raster
    const lg = await read($, langA)
    curLang = lg; S = STR[lg]
    const cv = await read($, clawd)
    const snap = await read($, snapshot)
    const us = await read($, usage)
    const cl = await read($, claude)
    const view = await read($, ui)
    const done = await read($, finished)
    const pw = await read($, power)
    const ck = await read($, clockA)
    const dOpen = await read($, doneOpen)
    const nowS = Math.floor(Date.now() / 1000)
    const m = snap.mem
    const swapHigh = m.swapUsedGB !== undefined && m.swapTotalGB ? m.swapUsedGB / m.swapTotalGB > 0.8 : false
    const memLow = m.freePct !== null && m.freePct < 20
    const heavy = snap.jobs.length >= 2 || memLow || swapHigh

    // 작업 이름을 누르면 로그가 펼쳐지고, 한 번 더 누르면 접힌다. 접을 때는 중지 확인도 거둔다
    const toggle = (pid: number) => update($, ui, u => (u.open.includes(pid)
      ? { open: u.open.filter(p => p !== pid), confirm: u.confirm === pid ? null : u.confirm }
      : { open: [...u.open, pid], confirm: u.confirm }))
    // 중지는 두 번 눌러야 실제로 멈춘다. 누르는 순간에도 그 작업이 아직 도는지 다시 확인한다
    // 스냅숏은 5초(collect.py 가 실패하면 더) 묵었을 수 있어, 죽이기 전에 ps(맥) · hostos.py proc(리눅스·윈도)로 그 pid 가 아직 같은 작업인지 다시 본다:
    // 살아 있고, 명령이 그 종류(codex … exec · agy)이고, 시작 시각(지금 - etime)이 스냅숏의 것(at - elapsed)과 몇 초 안에서 같아야 한다
    const stopJob = async (pid: number, label: string) => {
      const sn = await read($, snapshot)
      const j = sn.jobs.find(x => x.pid === pid && x.label === label)
      let same = false
      if (j) {
        try {
          const h = await hostP
          const ps = await $.process.run(checkArgv(h, $.plugin.root, pid), { timeoutMs: h.os === 'darwin' ? 5000 : 10000 })
          same = ps.exitCode === 0 && sameJob(ps.stdout || '', j, sn.at, Math.floor(Date.now() / 1000))
        } catch { same = false }
      }
      if (!same) $.ui.toast(S.alreadyDone)
      else {
        // 맥·리눅스 kill -TERM, 윈도 taskkill /T(안 되면 /F). 앞 명령이 성공하면 거기서 멈춘다
        let r: { exitCode: number; stderr?: string } = { exitCode: 1, stderr: '' }
        for (const argv of stopPlan((await hostP).os, pid)) {
          r = await $.process.run(argv, { timeoutMs: 5000 })
          if (r.exitCode === 0) break
        }
        if (r.exitCode === 0) { stopped.add(pid); $.ui.toast(S.stopSent(labelOf(label))) }
        else $.ui.toast(S.stopFail(clean(r.stderr || '').slice(0, 60)))
      }
      await update($, ui, u => ({ open: u.open, confirm: null }))
    }

    // 색: 핵심은 기본 글자색, 흐림은 설명 줄·로그·구분선에만. 꼬리표는 Codex 파랑·agy 보라(색 시안 B안)
    const job = (j: Job, i: number) => {
      const stale = j.idle !== null && j.idle > 600
      const argonJob = j.tool === 'argon'
      const isOpen = view.open.includes(j.pid)
      const tail = j.tail ?? []
      let proj = clean(j.project ?? '')
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color={stale ? 'warning' : 'success'}> ●</Text>
            {/* 점과 이름 사이는 여백으로 띄운다: 글자 뒤 빈칸만으로는 점이 이름에 붙어 보였다(2026-11-16).
                첫 줄 전체(이름 · 꼬리표 · 모델 · 걸린 시간 · 프로젝트)가 단추 안의 한 글자 줄이다: 이름과 꼬리표를 따로 두면
                넓은 패널에서는 사이가 벌어지고 좁은 패널에서는 둘 다 따로 잘렸다(사용자 2026-11-16). 좁으면 끝(프로젝트)부터 … 로 잘린다 */}
            <Box marginLeft={2} flexShrink={1}>
              <Button key={`job-${j.pid}`} plain {...(i < 9 ? { hotkey: String(i + 1) } : {})} onPress={() => toggle(j.pid)}>
                <Text wrap="truncate-end">
                  <Text bold>{labelOf(j.label)}</Text>
                  <Text>  </Text>
                  <Text color={argonJob ? 'autoAccept' : 'suggestion'}>{argonJob ? AGY_TAG : 'Codex'}</Text>
                  <Text> {short(j)}{short(j) ? ' · ' : ''}{dur(j.elapsed)}{proj ? ` · ${proj}` : ''}</Text>
                </Text>
              </Button>
            </Box>
          </Box>
          <Text color={stale ? 'warning' : undefined} dimColor={!stale} wrap="truncate-end">
            {'   '}{ago(j.idle)}{stale ? S.quiet : ''}{!isOpen && j.last ? ` · ${clean(j.last)}` : ''}
          </Text>
          {isOpen && tail.map(line => <Text dimColor wrap="truncate-end">   │ {clean(line)}</Text>)}
          {isOpen && tail.length === 0 && <Text dimColor wrap="truncate-end">{S.noLog}</Text>}
          {isOpen && !isTty(j.label) && (view.confirm === j.pid ? (
            <Box flexDirection="row">
              <Text>   </Text>
              <Button key={`kill-${j.pid}`} plain onPress={() => stopJob(j.pid, j.label)}><Text color="error">{S.confirmStop}</Text></Button>
              <Text dimColor> · </Text>
              <Button key={`keep-${j.pid}`} plain dimColor onPress={() => update($, ui, u => ({ open: u.open, confirm: null }))}>{S.cancel}</Button>
            </Box>
          ) : (
            <Box flexDirection="row">
              <Text>   </Text>
              <Button key={`stop-${j.pid}`} plain dimColor onPress={() => update($, ui, u => ({ open: u.open, confirm: j.pid }))}>{S.stopJob}</Button>
            </Box>
          ))}
        </Box>
      )
    }

    // 리셋까지 남은 시간: 'n일 n시간 n분', 앞자리가 0이면 뺀다(사용자 2026-11-16)
    const countdown = (s: number) => {
      if (s < 60) return S.soon
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60)
      return d ? S.durD(d, h, mi) : h ? S.durH(h, mi) : S.durM(mi)
    }
    // 사용량 한 칸(두 줄): 남은 양과 리셋까지 남은 시간. Claude 와 Codex 가 같은 모양(사용량 시안 B안)
    // 첫 줄 끝에 사용 속도 꼬리표, 부족하고 리셋 전에 바닥나면 둘째 줄 앞에 바닥나는 때(시안21 나안). 줄 수는 그대로 두 줄
    const usageRow = (tool: 'Claude' | 'Codex', name: string, usedPct: number, resetsAt: number, lenS: number) => {
      const left = Math.max(0, Math.round(100 - usedPct))
      const [fill, empty] = meter(left)
      const pace = paceOf(usedPct, lenS, resetsAt, nowS)
      const pc = pace ? paceColor(pace) : null
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={tool === 'Claude' ? 'claude' : 'suggestion'}>  {tool}</Text>
            <Text> {name} </Text>
            <Text color={leftColor(left)}>{fill}</Text><Text dimColor>{empty}</Text>
            <Text bold> {S.left(left)}</Text>
            {pace && <Text> · </Text>}
            {pace && <Text color={pc ?? undefined} dimColor={!pc}>{paceTag(pace, S)}</Text>}
          </Text>
          {!!resetsAt && (pace?.outS != null ? (
            <Text wrap="truncate-end">
              <Text>{'    '}</Text>
              <Text color={pc ?? undefined}>{S.runsOut(dhOf(pace.outS, S))}</Text>
              <Text>{' · '}{S.resetIn}</Text>
              <Text bold>{dhOf(resetsAt - nowS, S)}</Text>
            </Text>
          ) : (
            <Text wrap="truncate-end">
              <Text>{S.resetPre(resetsAt <= nowS)}</Text>
              <Text bold>{resetsAt > nowS ? countdown(resetsAt - nowS) : S.resetPast}</Text>
              <Text dimColor> ({seen(resetsAt, nowS)})</Text>
            </Text>
          ))}
        </Box>
      )
    }
    // 리셋권: 이름과 만료일(사흘 안이면 노랗게). 상세가 없으면 장수만
    const credits = us.credits ?? []
    const expiry = (t: number) => {
      const d = new Date(t * 1000), days = Math.floor((t - nowS) / 86400)
      return S.expiry(S.md(d.getMonth() + 1, d.getDate()), days < 1 ? S.today : S.days(days))
    }
    // 둘째 장부터는 머리('리셋권 2장: ' · '2 reset credits: ')의 칸 폭만큼 띄워 이름을 맞춘다
    const creditIndent = credits.length ? ' '.repeat(cellWidth(S.creditHead(credits.length))) : ''
    const creditRows = credits.length
      ? credits.map((c, i) => (
        <Text color={c.expiresAt - nowS < 3 * 86400 ? 'warning' : undefined} dimColor={c.expiresAt - nowS >= 3 * 86400} wrap="truncate-end">
          {'  '}{i === 0 ? S.creditHead(credits.length) : creditIndent}{c.title ? clean(c.title) : S.creditUntitled} · {expiry(c.expiresAt)}
        </Text>
      ))
      : us.resetCredits ? [<Text dimColor wrap="truncate-end">  {S.creditCount(us.resetCredits)}</Text>] : []
    const usageOld = !!us.windows && (!!us.error || nowS - us.at > USAGE_STALE_S)
    // codex 가 없는 컴퓨터(읽은 수치도 없음)는 Codex 사용량 줄을 아예 숨긴다(배터리 없는 맥의 배터리처럼)
    const noCodex = !us.windows && us.error === 'codex-not-found'
    const usageMsg = !us.windows && !noCodex


    // 최근 7일(시안24 나안, 폴더 줄 뺌): 머리 · 잔디 · 요일 · 합계와 오늘 · 구분선, 다섯 줄. 처음 값이 오기 전에는 숨긴다
    const wk = await read($, weekA)
    let weekOn = wk.at > 0 && wk.days.length > 0

    const staleFor = snap.at ? nowS - snap.at : 0

    // Clawd 자리: 그림 방식(Image + blit) · 글자 방식(Raster) · 그림 없음. 조건은 hooks/clawd.ts 의 pickMode
    const mode: ClawdMode = pickMode({
      on: cv.on, ready: !!cv.ready && !!sprites, surface: e.surface, hasImage: !!Image, hasRaster: !!Raster,
      isFullscreen: e.viewport?.isFullscreen, imageDenied: cv.raster, bodyColumns: e.props.bodyColumns,
    })
    const cap = { ...(CAP[cv.act] ?? CAP.idle), text: capText(cv.act, lg) }
    const busyMark = (
      <Text><Text color={heavy ? 'warning' : 'success'}>● </Text><Text bold>{heavy ? S.busy : S.free}</Text></Text>
    )
    const memPct = String(m.freePct ?? '?')
    const loadText = m.load !== null ? S.load(m.load.toFixed(1), m.cpus) : ''
    const withLoad = (mt: string) => (loadText ? `${mt} · ${loadText}` : mt)
    // 메모리 글자는 들어갈 자리(칸)보다 길면 짧은 쪽('메모리 58% 남음' → '램 58% 남음')
    const memFor = (room: number) => (cellWidth(S.mem(memPct)) <= room ? S.mem(memPct) : S.memShort(memPct))
    // 한 줄 방식: '● 여유 · ' 뒤에 남는 칸으로 메모리·부하가 다 들어가는지 본다
    const lineRoom = (e.props.bodyColumns ?? 0) - cellWidth(`● ${heavy ? S.busy : S.free} · `)
    const lineMem = cellWidth(withLoad(S.mem(memPct))) <= lineRoom ? S.mem(memPct) : S.memShort(memPct)
    const oneLine = () => (
      <Text wrap="truncate-end">
        {busyMark}
        <Text> · {withLoad(lineMem)}</Text>
      </Text>
    )
    // 설명 줄(시안 '라'안): 앞에 표시 하나 + 한 칸 띄고 설명. 터미널은 돌아가는 1×1 Raster(틱이 blit), 그 밖은 멈춘 글자
    const spinLive = e.surface === 'terminal' && !!Raster && (mode === 'image-side' || mode === 'image-top' || mode === 'raster')
    const capRow = (
      <Box flexDirection="row">
        {spinLive
          ? <Raster key={SPIN_KEY} columns={1} rows={1} cells={spinCells(cv.act, spinIdx)} />
          : <Text color={cap.color} dimColor={!cap.color}>{spinGlyph(cv.act, 2)}</Text>}
        <Box marginLeft={1} flexShrink={1}>
          <Text wrap="truncate-end" color={cap.color} dimColor={!cap.color}>{cap.text}</Text>
        </Box>
      </Box>
    )
    const tNow = nowMs()
    // 다시 그릴 때 그림에 넘길 장면(tune.rend). 폭·스크롤·터미널 크기가 바뀌었으면 지금 장면으로 새로 그린다
    const geo = `${e.props.bodyColumns}/${(e.props as { scroll?: { offset?: number } }).scroll?.offset ?? 0}/${e.viewport?.columns ?? 0}x${e.viewport?.rows ?? 0}`
    const keep: 'frozen' | 'shown' | 'now' = e.surface === 'terminal' && geo === lastGeo ? tune.rend : 'now'
    if (e.surface === 'terminal') lastGeo = geo
    const curF = sprites ? curFrame(tNow, liveNow(tNow)) : 0
    const sameBig = keep !== 'now' && drawnKind === 'image' && (mode === 'image-side' || mode === 'image-top') &&
      drawnLook === cv.look && rendFrame >= 0 && drawnFrame >= 0
    const frame = !sameBig ? curF : keep === 'shown' ? drawnFrame : rendFrame
    // 그린 것 기록은 터미널 표면이 그렸을 때만 고친다: 휴대폰·데스크톱 앱이 같이 붙어 있어도 터미널의 움직임이 멈추지 않게
    if (e.surface === 'terminal') {
      drawnKind = mode === 'image-side' || mode === 'image-top' ? 'image' : mode === 'raster' ? 'raster' : null
      drawnLook = cv.look
      if (!(sameBig && keep === 'frozen')) drawnFrame = frame // props 가 그대로면 화면의 장면도 그대로다
      rendFrame = drawnKind === 'image' ? frame : -1
      probe = drawnKind !== null
      probeWait = PROBE_WAIT_TICKS
      drawGen++; denyStreak = 0; backoff = 0
      spinMounted = spinLive
      spinDrawn = spinLive ? spinCells(cv.act, spinIdx) : ''
    }
    const img = () => (
      <Image key={CLAWD_KEY} source={{ png: pngOf(cv.look, frame) }} columns={IMG_COLS} rows={IMG_ROWS} alt="Clawd" />
    )
    // 옆 글자: Clawd 몸 높이(SIDE_TOP_ROWS 줄 아래)부터 '● 여유' · '메모리 · 부하' · 설명. 폭이 모자라면 메모리와 부하를 두 줄로,
    // 메모리 글자도 옆 칸보다 길면 짧은 쪽으로(가장 좁은 옆 칸 12칸에 '램 100% 남음'까지 들어간다)
    const sideCols = (e.props.bodyColumns ?? 0) - IMG_COLS - 1
    const sideMem = memFor(sideCols)
    const statusLines = cellWidth(withLoad(sideMem)) <= sideCols
      ? [<Text wrap="truncate-end">{withLoad(sideMem)}</Text>]
      : [<Text wrap="truncate-end">{sideMem}</Text>, ...(loadText ? [<Text wrap="truncate-end">{loadText}</Text>] : [])]
    const top = mode === 'image-side' ? (
      <Box flexDirection="row" marginBottom={1}>
        {img()}
        <Box flexDirection="column" marginLeft={1} paddingTop={SIDE_TOP_ROWS} flexShrink={1}>
          {busyMark}
          {statusLines}
          {capRow}
        </Box>
      </Box>
    ) : mode === 'image-top' ? (
      <Box flexDirection="column">{img()}{oneLine()}{capRow}</Box>
    ) : mode === 'raster' ? (
      <Box flexDirection="column">
        {oneLine()}
        {capRow}
        <Raster key={CLAWD_KEY} columns={RASTER_COLS} rows={RASTER_ROWS} cells={cellsOf(frame)} />
      </Box>
    ) : mode === 'text' ? (
      <Box flexDirection="column">{oneLine()}{capRow}</Box>
    ) : oneLine()

    // 맨 위 시계(시안 12 'A · 막대 시계'): 그림을 그릴 수 있는 터미널이면 막대 숫자 그림 + 진한 날짜 + 배터리 그림,
    // 아니면 한 줄 글자. 그림 조건은 Clawd 와 같다(fullscreen 이 아니라고 확인되지 않았고, 그림이 거부된 적 없음)
    const nowD = new Date(nowMs())
    const hmNow = hmOf(nowD)
    // 글자 시계는 늘 지금 시각(ck.hm 은 다시 그리기를 부르는 용도). 그림 시계는 아래 clockHm(tune.rend) 그대로
    const hm = hmNow, dateTxt = ck.date || dateOf(nowD, lg)
    const canImage = e.surface === 'terminal' && !!Image && e.viewport?.isFullscreen !== false && !cv.raster
    const clockFits = (e.props.bodyColumns ?? 0) >= CLOCK_COLS + 2 + cellWidth(dateTxt) + (pw.pct === null ? 0 : 2 + BATT_COLS + 5)
    const clockImage = canImage && clockFits
    // 그림은 다시 그리기로 바꾸지 않는다(시계는 분마다, 배터리는 바뀔 때 틱이 blit 으로 바꾼다). 넘기는 것은 tune.rend 대로
    const sameClock = keep !== 'now' && clockImage && clockMounted && !!clockRend
    const clockHm = !sameClock ? hmNow : keep === 'shown' ? clockShown || hmNow : clockRend
    const battNow = pw.pct === null ? '' : battKey(pw.pct, pw.charging)
    const sameBatt = keep !== 'now' && clockImage && battMounted && !!battRend && battNow !== ''
    const battUse = battNow === '' ? '' : !sameBatt ? battNow : keep === 'shown' ? battShown || battNow : battRend
    const battPct = battUse ? Number(battUse.replace('+', '')) : null, battChg = battUse.endsWith('+')
    // 배터리 그림의 alt 도 props 라, 그림이 지난번과 같으면 alt 도 지난번 것을 준다(언어만 바뀌어도 그림을 다시 보내지 않게)
    const battAlt = battUse !== '' && battUse === battRend && battAltRend ? battAltRend : battPct === null ? '' : S.battAlt(battPct)
    if (e.surface === 'terminal') {
      if (!(sameClock && keep === 'frozen')) clockShown = clockImage ? clockHm : ''
      clockRend = clockImage ? clockHm : ''
      clockMounted = clockImage
      const bm = clockImage && battUse !== ''
      if (!(sameBatt && keep === 'frozen')) battShown = bm ? battUse : ''
      battRend = bm ? battUse : ''
      battAltRend = bm ? battAlt : ''
      battMounted = bm
    }
    // 잔량 글자. 충전 중은 그림 배터리에 번개로 그리고, 글자 시계일 때만 ϟ 를 붙인다
    const battLabel = (pct: number | null, chg: boolean, asText: boolean) => pct === null ? null : (
      <Text>
        <Text bold> {pct}%</Text>
        {asText && chg ? <Text color="success"> ϟ</Text> : null}
      </Text>
    )
    const clockBlock = clockImage ? (
      <Box flexDirection="row" marginBottom={1}>
        <Image key="clock" source={clockSource(clockHm)} columns={CLOCK_COLS} rows={CLOCK_ROWS} alt={clockHm} />
        <Box flexDirection="column" marginLeft={2}>
          <Text> </Text>
          <Box flexDirection="row">
            <Text bold>{dateTxt}</Text>
            {battPct === null ? null : <Text>  </Text>}
            {battPct === null ? null : <Image key="batt" source={batterySource(battPct, battChg)} columns={BATT_COLS} rows={1} alt={battAlt} />}
            {battLabel(pw.pct, pw.charging, false)}
          </Box>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold>{hm}  {dateTxt}</Text>
        {pw.pct === null ? null : (
          <Text wrap="truncate-end">
            <Text color={battColor(pw.pct)}>{'━'.repeat(battFill(pw.pct))}</Text>
            <Text dimColor>{'━'.repeat(BATT_CELLS - battFill(pw.pct))}</Text>
            {battLabel(pw.pct, pw.charging, true)}
          </Text>
        )}
      </Box>
    )
    // ── 줄 세기: 최근 끝남과 놀이터를 뺀 나머지가 쓰는 줄. 아래 내용과 같은 차례로 센다(글자는 모두 한 줄로 자르게 해 두었다) ──
    const bodyRows = (e.props as { scroll?: { bodyRows?: number } }).scroll?.bodyRows ?? 0
    const usageRowsOf = (ws: { resetsAt: number }[]) => ws.reduce((n, w) => n + 1 + (w.resetsAt ? 1 : 0), 0)
    const clawdRows = mode === 'image-side' ? Math.max(IMG_ROWS, SIDE_TOP_ROWS + 1 + statusLines.length + 1) + 1 // 그림 옆 글자, 아래 빈 줄
      : mode === 'image-top' ? IMG_ROWS + 2
      : mode === 'raster' ? 1 + 1 + 1 + RASTER_ROWS // 위 여백·요약·설명·Raster
      : mode === 'text' ? 1 + 1 + 1
      : 1 + 1
    const jobRows = (snap.jobs.length === 0 && snap.waiting.length === 0 ? 1 : 0)
      + (snap.jobs.length ? 1 + snap.jobs.reduce((n, j) => n + 2 + (view.open.includes(j.pid) ? Math.max(1, (j.tail ?? []).length) + (isTty(j.label) ? 0 : 1) : 0), 0) : 0)
      + (snap.waiting.length ? 1 + snap.waiting.length : 0)
    let usedRows = (tune.debug ? 1 : 0)
      + (clockImage ? CLOCK_ROWS + 1 : 2)
      + usageRowsOf(cl) + (us.windows ? usageRowsOf(us.windows) : 0) + (us.reached ? 1 : 0)
      + (us.windows ? creditRows.length : 0) + (usageOld ? 1 : 0) + (usageMsg ? 1 : 0)
      + clawdRows + (memLow || swapHigh ? 1 : 0) + 1 // 구분선
      + jobRows
      + (!snap.at ? 1 : 0) + (staleFor > STALE_S ? 1 : 0)
    usedRows += weekOn ? 5 : 0 // 최근 7일 덩어리
    const yardHereRaw = canImage && cv.on && cv.yard !== false && !!cv.ready && !!sprites ? yardCount(e.props.bodyColumns ?? 0) : 0
    // 놀이터를 그릴 때는 패널 높이 대신 '바닥 높이'에 맞춘다: 아래 입력창·작업자 줄이 늘었다 줄어도 그림이 옮겨지지 않게.
    // 바닥을 올려 둔 탓에 놀이터가 안 들어가면 바닥을 지금 높이로 내린다(그림을 숨겼다 다시 보이는 것보다 한 번 옮기는 게 낫다)
    const fitAt = (rows: number) => fitDone({
      bodyRows: rows, used: usedRows, yardRows: yardHereRaw ? (cv.bg !== false ? YARD_BG_ROWS : YARD_ROWS) : 0,
      total: done.length, open: dOpen, closedShow: DONE_SHOWN,
    })
    const term = e.surface === 'terminal'
    if (term) floor = yardHereRaw ? nextFloor(floor, bodyRows, tNow, FLOOR_RAISE_MS) : FLOOR_NONE
    let layoutRows = term && floor.rows ? floor.rows : bodyRows
    let fit = fitAt(layoutRows)
    if (term && floor.rows && bodyRows - floor.rows > FILL_MAX_ROWS) {
      floor = { rows: bodyRows, tallerSince: 0 }; layoutRows = bodyRows; fit = fitAt(bodyRows)
    }
    if (term && !fit.yard && layoutRows < bodyRows) {
      floor = { rows: bodyRows, tallerSince: 0 }; layoutRows = bodyRows; fit = fitAt(bodyRows)
    }
    const doneShown = done.slice(0, fit.shown)

    // 놀이터(패널 맨 아래): 그림을 그릴 수 있고 Clawd 가 켜져 있을 때만. 다시 그릴 때 넘기는 장면은 tune.rend 대로
    const yCols = e.props.bodyColumns ?? 0
    const yardHere = fit.yard ? yardHereRaw : 0
    const wantBg = cv.bg !== false, yRows = wantBg ? YARD_BG_ROWS : YARD_ROWS, tod = todOf(nowD)
    const yardSame = keep !== 'now' && yardHere > 0 && yardN === yardHere && yardCols === yCols && yardBg === wantBg &&
      yardRend.length === yardHere && !!yardShown && !!yardRendPng
    const yFrames = !yardHere || !sprites ? [] : yardSame ? yardRend : yardFrames(sprites, yardHere, tNow, false)
    const yPng = !yardHere || !sprites ? '' : yardSame ? yardRendPng
      : wantBg ? yardScenePng(sprites, yFrames, yCols, tNow, false, tod) : yardStripPng(sprites, yFrames, yCols)
    if (e.surface === 'terminal') {
      if (!yardSame) yardShown = wantBg ? sceneKey(yFrames, tNow, false, tod) : yFrames.join(',')
      yardRend = yFrames; yardRendPng = yPng; yardN = yardHere; yardCols = yCols; yardBg = wantBg
    }
    // 최근 7일 덩어리. 잔디 그림은 다시 그리기로 바꾸지 않는다(자료가 바뀌면 틱이 blit). 폭이 바뀌면 지금 자료로 새로 그린다
    const wPer = grassPer(e.props.bodyColumns ?? 0)
    const wToday = weekOn ? todayIdx(wk.days, nowD) : -1
    const weekImage = canImage && weekOn
    const sameWeek = keep !== 'now' && weekImage && weekMounted && !!weekRendPng && weekPer === wPer
    const wFresh = weekImage && !sameWeek ? grassPng(wk.days, wToday, wPer) : ''
    const wPng = !weekImage ? '' : !sameWeek ? wFresh : keep === 'shown' ? weekShownPng || weekRendPng : weekRendPng
    if (e.surface === 'terminal') {
      if (!sameWeek) { weekShown = weekImage ? grassKey(wk.days, wToday, wPer) : ''; weekShownPng = wFresh }
      weekRendPng = wPng; weekPer = weekImage ? wPer : 0; weekMounted = weekImage
      if (weekOn) weekData = wk
    }
    const wMax = Math.max(0, ...wk.days.map(d => d.secs))
    const wLead = Math.floor((wPer - 2) / 2)
    const weekBlock = weekOn ? (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="claude">⏱ </Text><Text bold>{S.weekHead}</Text>
          <Text dimColor>{S.weekTokens(tokensText(wk.total.tokens))}</Text>
          {wk.partial && <Text dimColor>{S.weekPartial}</Text>}
        </Text>
        {weekImage ? (
          <Box flexDirection="row">
            <Text>  </Text>
            <Image key="week" source={{ png: wPng }} columns={7 * wPer} rows={1} alt=" " />
          </Box>
        ) : (
          <Text wrap="truncate-end">
            <Text>  </Text>
            {wk.days.slice(0, 7).flatMap((d, i) => {
              const tone = grassTextTone(d.secs, wMax)
              return [
                <Text color={tone === 'dim' ? undefined : tone} dimColor={tone === 'dim'} bold={i === wToday}>{'▆'.repeat(wPer - 1)}</Text>,
                <Text> </Text>,
              ]
            })}
          </Text>
        )}
        <Text wrap="truncate-end">
          <Text>  </Text>
          {wk.days.slice(0, 7).flatMap((d, i) => [
            <Text>{' '.repeat(wLead)}</Text>,
            <Text color={i === wToday ? 'claude' : undefined} bold={i === wToday} dimColor={i !== wToday}>{S.weekShort[weekdayOf(d.date)]}</Text>,
            <Text>{' '.repeat(Math.max(0, wPer - 2 - wLead))}</Text>,
          ])}
        </Text>
        <Text wrap="truncate-end">
          <Text>  </Text><Text bold>{dur(wk.total.secs)}</Text><Text dimColor> · </Text>
          <Text color="claude">{S.weekToday}</Text><Text color="claude" bold>{dur(wToday >= 0 ? wk.days[wToday]!.secs : 0)}</Text>
        </Text>
        <Text dimColor>{RULE}</Text>
      </Box>
    ) : null

    const yard = yardHere ? (
      <Image key="yard" source={{ png: yPng }} columns={yCols} rows={yRows} alt=" " />
    ) : null
    // 바닥 아래 땅(사용자 2026-11-16): 패널이 커져도 바닥(floor)은 10분 뒤에야 따라 내려가서, 그동안 놀이터 아래에 빈 줄이 생겨
    // 떠 보였다. 그림은 옮기지 않고(옮기면 iTerm 이 그림을 다시 받으며 번쩍인다) 그 빈 줄을 장면 맨 아래 풀밭 색 글자 칸으로 채운다.
    // 줄 수: 바닥까지 layoutRows + 땅 fillRows = bodyRows. 배경이 꺼진 띠(투명한 바탕에 얇은 풀밭 선)는 채우지 않는다
    const shownTod = (/^(day|dusk|night):/.exec(yardShown)?.[1] as Tod | undefined) ?? tod
    const fillRows = term && yardHere && wantBg && bodyRows > layoutRows ? bodyRows - layoutRows : 0
    const fillColor = `#${soilRgb(shownTod).toString(16).padStart(6, '0')}`
    const ground = fillRows ? (
      <Box flexDirection="column">
        {/* 그림은 칸 비율을 지키느라 오른쪽이 반 칸쯤 비어(yard.ts DOTS_PER_COL), 땅을 끝까지 채우면 오른쪽 아래에만 땅이 삐져나와 보였다(사용자 2026-11-16). 한 칸 좁게 */}
        {Array.from({ length: fillRows }, () => <Text backgroundColor={fillColor} wrap="truncate-end">{' '.repeat(Math.max(1, yCols - 1))}</Text>)}
      </Box>
    ) : null

    // 바깥 상자는 늘 같은 모양(땅이 있든 없든): 바닥까지의 상자(내용 + 맨 아래 놀이터) 다음에 땅
    return (
      <Box flexDirection="column">
      <Box flexDirection="column" minHeight={yard ? layoutRows : undefined} justifyContent="space-between">
      <Box flexDirection="column">
        {tune.debug && (
          <Text dimColor wrap="truncate-end">
            rows {bodyRows} · floor {layoutRows} · fill {fillRows} · used {usedRows} · done {fit.rows} · yard {fit.yard ? (cv.bg !== false ? YARD_BG_ROWS : YARD_ROWS) : 0} · cols {e.props.bodyColumns} · vp {e.viewport?.columns}x{e.viewport?.rows}
          </Text>
        )}
        {clockBlock}
        {cl.map(w => usageRow('Claude', claudeName(w.kind), w.usedPct, w.resetsAt, CLAUDE_WIN_S[w.kind] ?? 0))}
        {us.windows && us.windows.map(w => usageRow('Codex', winName(w.mins), w.usedPct, w.resetsAt, w.mins * 60))}
        {us.reached && <Text color="error" wrap="truncate-end">  {S.reached}</Text>}
        {us.windows && creditRows}
        {usageOld && <Text color="warning" wrap="truncate-end">  {S.usageOld(seen(us.at, nowS))}</Text>}
        {usageMsg && <Text dimColor wrap="truncate-end">  {us.at ? S.usageBad(clean(S.usageErr[us.error ?? ''] ?? us.error ?? '')) : S.usageLoading}</Text>}
        {/* Clawd 묶음은 사용량 밑, 작업 목록 위(시안 '마'안, 2026-11-16). 그림이 위에 있는 방식은 그림 칸의 하늘이 간격이 된다 */}
        <Box flexDirection="column" marginTop={mode === 'image-side' || mode === 'image-top' ? 0 : 1}>{top}</Box>
        {(memLow || swapHigh) && (
          <Text color="warning" wrap="truncate-end">  {m.swapUsedGB !== undefined ? S.swap(m.swapUsedGB, m.swapTotalGB ?? 0) : ''}{S.heavy}</Text>
        )}
        <Text dimColor>{RULE}</Text>
        {weekBlock}
        {snap.jobs.length === 0 && snap.waiting.length === 0 && <Text wrap="truncate-end">{S.noJobs}</Text>}
        {snap.jobs.length > 0 && <Text bold wrap="truncate-end">{S.running(snap.jobs.length)}</Text>}
        {snap.jobs.map(job)}
        {snap.waiting.length > 0 && <Text bold wrap="truncate-end">{S.queued(snap.waiting.length)}</Text>}
        {snap.waiting.map(w => (
          <Text wrap="truncate-end"><Text> ○ {clean(w.labels.join(' → '))}</Text><Text dimColor> · {S.elapsed(dur(w.elapsed))}</Text></Text>
        ))}
        {done.length > 0 && <Text bold wrap="truncate-end">{S.done}</Text>}
        {doneShown.map(d => (
          <Text wrap="truncate-end">
            <Text color={d.stopped ? 'warning' : 'success'}>{d.stopped ? ' ■' : ' ✓'}</Text>
            <Text> {labelOf(d.label)}</Text>
            <Text dimColor> · {clock(d.at)} · {dur(d.elapsed)}{d.stopped ? S.doneStopped : d.hasReport || d.noOut ? '' : S.doneNoReport}</Text>
          </Text>
        ))}
        {fit.button && (
          <Box flexDirection="row">
            <Text>   </Text>
            <Button key="done-more" plain dimColor onPress={() => update($, doneOpen, o => !o)}>
              {fit.button === 'more' ? S.more(fit.hidden) : fit.hidden ? S.moreFold(fit.hidden) : S.fold}
            </Button>
          </Box>
        )}
        {!snap.at && <Text dimColor wrap="truncate-end">{S.loading}</Text>}
        {staleFor > STALE_S && (
          <Text color="warning" wrap="truncate-end">
            {S.stale(dur(staleFor), clock(snap.at))}{snap.error ? ` · ${clean(snap.error)}` : ''}
          </Text>
        )}
      </Box>
      {yard}
      </Box>
      {ground}
      </Box>
    )
  })
}
