import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ClaudeOwn, ClaudeView, ClaudeWindow, ClawdAct, ClawdView, ClockView, CodexUsage, Finished, Job, PanelUi, PowerState, Snapshot, WeekStats } from '../types'
import { BATT_CELLS, BATT_COLS, CLOCK_COLS, CLOCK_ROWS, battColor, battFill, battKey, batterySource, clockSource, dateOf, hmOf, parseBatt } from './clock'
import {
  CAP, IMG_COLS, IMG_ROWS, RASTER_COLS, RASTER_ROWS, SIDE_TOP_ROWS, SPIN_ACTS, SPIN_SEQ, TOOL_HOLD_MS,
  OOPS_HOLD_MS, actShift, capText, celebrationFor, cellWidth, dizzyStart, frameAt, isBusy, isFailure, isFrozen, isNight, msUntilChange, oopsFor, pickAct, pickMode, pickVariant,
  rasterCells, shiftRows, spinCells, spinGlyph, toolAct, usageAlarm, usageLevel,
} from './clawd'
import type { ClawdLive, ClawdMode, Sprites } from './clawd'
import { AGY_TAG, ARGON_TTY, STR, langFromEnv, parseLangArg, parseLangCmd, parseScene, prefOf, sceneOf, sceneStore } from './i18n'
import type { Lang, LangPref, SceneSize } from './i18n'
import { FLOOR_NONE, fitDone, nextFloor } from './layout'
import { sameJob } from './proc'
import { PY_CANDIDATES, PY_PROBE, checkArgv, fallbackHost, hostFromProbe, parsePower, powerArgv, pyArgv, stopPlan } from './host'
import type { Host } from './host'
import { CLAUDE_WIN_S, dhOf, paceColor, paceOf, paceTag } from './pace'
import { grassKey, grassPer, grassPng, grassTextTone, parseWeek, todayIdx, tokensText, weekdayOf } from './grass'
import type { Floor } from './layout'
import { YARD_BG_ROWS, YARD_ROWS, soilRgb, sceneKey, todOf, yardCount, yardFrames, yardScenePng, yardStripPng } from './yard'
import type { Tod } from './yard'
import { clawdScene } from './scene'
import { SHARE_DEAD_TICKS, SHARE_REREAD_S, SHARE_RETRY_S, SLOT_ID_RE, composeSlots, foldSlots, newSlotId, nextOwnAt, ownSlotWins, parseShare, planWrite, shareFileName, shareText, shownUsage } from './share'
import type { Obs, ShareRead, Slot } from './share'
import type { YardScene } from './scene'
import { ASK_MAX, THEME_DEFAULT, bigPng, buildTheme, shownThemeNames, skinAnswerId, skinChoices, themeIdOf, themeLabelOf, themePrefOf } from './theme'
import type { Theme } from './theme'
import { THEMES } from '../themes/index'

// No model calls: local scripts are read on a timer, so the pane costs no tokens.
const PANE = 'status-panel'
const EVERY_MS = 5000
// Codex 사용량은 네트워크로 묻기 때문에 5분에 한 번만(2026-11-16)
const USAGE_EVERY_MS = 5 * 60 * 1000
const snapshot = atom({ plugin: 'status-panel', key: 'snapshot' } as const,
  { at: 0, jobs: [], waiting: [], mem: { freePct: null, load: null, cpus: 0 } }, { shape: 'snapshot-1' })
const finished = atom({ plugin: 'status-panel', key: 'finished' } as const, [], { shape: 'finished-1' })
const usage = atom({ plugin: 'status-panel', key: 'usage' } as const, { at: 0 } as CodexUsage, { shape: 'usage-1' })
// Claude 사용량(5시간·주간): 상태 줄과 같은 수치를 엔진에서 받아 Codex 옆에 둔다(사용자 2026-11-16). 세션끼리 나눈 값(hooks/share.ts)과
// 그 값을 올린 세대(claudeOwn2 의 gen)를 함께 둔다: 옛 세대(같은 모듈의 앞 세션·/reload-plugins 전 모듈)의 늦은 쓰기는 콜백이 버린다
const claudeView = atom({ plugin: 'status-panel', key: 'claudeView' } as const, { gen: -1, wins: [] } as ClaudeView, { shape: 'claudeView-1' })
// 이 프로세스의 자기 사용량 값·종류마다 받은 시각, 나눔 파일의 칸 이름·쓴 횟수(seq)·세션 세대(hooks/share.ts). 모듈을 다시 읽어도(/reload-plugins) 남게 atom 에 둔다.
// 0.8.9: 0.8.8 의 키(claudeOwn)와 나눴다. 그 값(파일 시각을 물려받은 at 이 섞여 있다)은 쓰지 않고, 옛 판 모듈이 늦게 그 키에 적어도 이 판의 세대가 처음으로 돌아가지 않는다
const claudeOwn = atom({ plugin: 'status-panel', key: 'claudeOwn2' } as const, { init: false, wins: [], at: {}, id: '', seq: 0, gen: 0 } as ClaudeOwn, { shape: 'claudeOwn-2' })
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
// debug = 패널 맨 위에 줄 수·폭을 적는다(측정용). 아래 풍경(놀이터 띠)은 /scene 으로 바꾼다
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
const rasterCache = new Map<string, string>()
let lastGeo = '' // 패널 폭·스크롤·터미널 크기. 바뀌면 그림을 지금 장면으로 새로 그린다
let yardLastAt = 0
let floor: Floor = FLOOR_NONE // 놀이터 바닥 높이(layout.ts nextFloor)
const FLOOR_RAISE_MS = 10 * 60_000
// 바닥 아래 빈 줄이 이보다 많으면(창을 키운 때 등) 흙으로 채우지 않고 놀이터를 한 번 내린다. 턴마다 생기는 1~3줄(작업자 줄·스피너)은 채운다
const FILL_MAX_ROWS = 3
const imgFree = () => !imgBusy && tickNo - imgLastTick >= tune.gap
// 세션이 새로 열릴 때마다 올린다: 앞 세션에서 답을 못 받은 blit 이 새 세션의 차례(imgBusy·blitting)를 풀거나 막지 못하게
let sessGen = 0
const imgBlit = async ($: any, args: Record<string, unknown>) => {
  imgBusy = true; imgLastTick = tickNo
  const sg = sessGen
  try { return await $.ui.blit({ requestId: PANE, ...args }) } finally { if (sg === sessGen) imgBusy = false }
}
// 진행판에서 중지시킨 작업(pid). '최근 끝남'에 '중지함'으로 적는다
const stopped = new Set<number>()

// ── Clawd(맨 위 왼쪽 마스코트, 시안 '가'안 2026-11-16) ──
// 설명 글자가 바뀔 때만 atom 을 고치고, 움직임의 프레임은 모듈 변수 + $.ui.blit 로 바꾼다(다시 그리기 없음)
const clawd = atom({ plugin: 'status-panel', key: 'clawd' } as const,
  { on: true, act: 'idle', raster: false, ready: 0 } as ClawdView, { shape: 'clawd-1' })
const CLAWD_KEY = 'clawd'
const CLAWD_TICK_MS = 100
const AGENTS_EVERY_MS = 5000
let sprites: Sprites | null = null
// 테마(hooks/theme.ts): 큰 마스코트(sprites)·놀이터 친구(friends)·놀이터 배경(scene). 기본 clawd 는 친구도 sprites 그대로
let friends: Sprites | null = null
let scene: YardScene = clawdScene
let themeId = THEME_DEFAULT
// 테마를 바꾼 뒤 큰 마스코트를 한 번 blit 해야 함(그림 차례를 지켜 틱이 보낸다). 다시 그리기로 Image source 를 바꾸지 않으려고
// 다시 그릴 때는 지난번에 넘긴 PNG(rendPng)를 그대로 넘긴다
let bigDirty = false
let rendPng = ''
let shownPng = '' // 화면에 나가 있는 큰 마스코트 PNG(blit 이 성공했거나 다시 그리기가 새로 넘긴 것). tune.rend 'shown' 이 다시 그릴 때 넘긴다
let yardScene: YardScene = clawdScene // 화면에 나가 있는 놀이터 그림의 배경(아래 흙 색을 그 그림에 맞춘다)
let fillShown = -1 // 지난 다시 그리기에 칠한 흙 색(흙 줄이 없으면 -1)
let themeGen = 0 // 테마를 바꿀 때마다 올린다: 바꾸기 전에 떠난 blit 의 답이 bigDirty 를 지우지 못하게
let clawdLoaded: Promise<void> = Promise.resolve() // 세션 시작 때 저장된 설정·테마 읽기
let saveChain: Promise<void> = Promise.resolve() // $.store 'clawd' 쓰기 차례
let themeCmd = 0 // '/skin' 이 테마 파일을 읽는 사이 다른 '/skin' 이 오면 늦게 끝난 앞 것은 적용하지 않는다
const applyTheme = (t: Theme) => {
  sprites = t.sprites; friends = t.friends; scene = t.scene; themeId = t.id; themeGen++
  rasterCache.clear()
}
const readJson = async ($: any, path: string): Promise<unknown> => JSON.parse(String(await $.fs.read(path)))
// 기본 clawd 는 0.8.1 그대로 clawd/sprites.json 하나. 다른 테마는 themes/<id>/sprites.json(+ friends.json)
const loadTheme = async ($: any, id: string): Promise<Theme> => {
  if (id === THEME_DEFAULT) {
    const sp = (await readJson($, `${$.plugin.root}/clawd/sprites.json`)) as Sprites
    return { id, sprites: sp, friends: sp, scene: clawdScene }
  }
  const dir = `${$.plugin.root}/themes/${id}`
  const big = await readJson($, `${dir}/sprites.json`)
  // friends.json 이 없으면 큰 마스코트 그대로. 있는데 못 읽거나 깨졌으면 그대로 던져 '못 읽었어요' 로 알린다
  let has = false
  try { has = !!(await $.fs.exists(`${dir}/friends.json`)) } catch { has = false }
  const fr = has ? await readJson($, `${dir}/friends.json`) : undefined
  return buildTheme(id, THEMES[id], big, fr)
}
const themeLabel = (id: string) => themeLabelOf(id, THEMES, curLang)
// $.store 'clawd' 저장(/clawd·/skin 이 같이 쓴다). 저장 직전에 저장된 값을 다시 읽어 이 명령이 바꾼 것만 얹는다
// (테마 파일을 기다리는 사이 다른 명령이 바꾼 것을 옛 값으로 덮지 않게). atom 은 명령이 시작할 때 읽은 값이 돌아올 수 있어 $.store 를 본다.
// 저장된 값이 없거나 이상하면 명령이 시작할 때 읽은 값(fb). 테마는 저장하는 때의 themeId.
// 저장은 모듈 차례(saveChain)로 하나씩: 두 명령이 같은 옛 값을 읽고 겹쳐 쓰지 않게
// 테두리(sticker) 모양은 0.8.7 에서 없앴다: 저장된 옛 look 값은 읽지도 쓰지도 않는다(새로 저장하면 빠진다)
type ClawdPref = Partial<{ on: boolean; bg: boolean; yard: boolean }>
type ClawdBase = { on: boolean; bg: boolean; yard: boolean }
const saveClawd = ($: any, sg: number, p: ClawdPref, fb: ClawdBase) => {
  const run = saveChain.then(async () => {
    if (sg !== sessGen) return // 앞 세션의 명령: 새 세션이 읽은 설정을 덮지 않는다
    let st: { on?: unknown; bg?: unknown; yard?: unknown } = {}
    try { st = ((await $.store.get('clawd')) ?? {}) as typeof st } catch { /* 이 명령이 읽은 값으로 */ }
    if (sg !== sessGen) return // 읽는 사이 새 세션이 열렸다
    const was = {
      on: typeof st.on === 'boolean' ? st.on : fb.on,
      bg: typeof st.bg === 'boolean' ? st.bg : fb.bg, yard: typeof st.yard === 'boolean' ? st.yard : fb.yard,
    }
    try { await $.store.set('clawd', { ...was, ...p, theme: themeId }) } catch { /* 이번 세션에만 적용 */ }
  })
  saveChain = run.catch(() => { /* 다음 저장은 그대로 */ })
  return run
}
// 테마 바꾸기(/skin): 다시 그리지 않고 큰 마스코트·놀이터 띠를 그림 차례대로 한 번씩 blit
const switchTheme = async ($: any, sg: number, id: string, fb: ClawdBase): Promise<{ text: string }> => {
  // 앞 세션의 명령(창·읽기를 기다리는 사이 새 세션이 열림): 새 세션의 차례(themeCmd)를 건드리지 않는다
  if (sg !== sessGen) return { text: S.themeSet(themeLabel(themeId)) }
  // 답 끝의 안내는 답하는 때의 상태로(테마를 읽는 사이 /clawd 끄기·/scene 끄기·패널 닫기가 올 수 있다)
  const hidden = async () => (!clawdOn && (await read($, clawd)).yard === false ? S.hiddenOff : await closedNote($))
  // 고를 때마다 차례를 올린다: 지금 테마를 다시 골라도 읽던 앞 명령은 적용하지 않는다(뒤에 고른 것이 이긴다)
  const prev = themeCmd, my = ++themeCmd
  if (id === themeId && sprites) return { text: `${S.themeSet(themeLabel(id))}${await hidden()}` }
  let t: Theme
  try { t = await loadTheme($, id) } catch {
    // 못 읽었으면 이 명령은 없던 것으로: 읽던 앞 명령이 있으면 그것이 적용된다
    // 읽는 사이 새 세션이 열렸으면 새 세션의 차례·화면(토스트)을 건드리지 않는다
    if (sg !== sessGen) return { text: S.themeBad(themeLabel(id)) }
    if (my === themeCmd) themeCmd = prev
    const msg = S.themeBad(themeLabel(id)); try { $.ui.toast(msg) } catch { /* 글자로만 */ } return { text: msg }
  }
  if (sg !== sessGen) { if (my === themeCmd) themeCmd = prev; return { text: S.themeSet(themeLabel(themeId)) } } // 읽는 사이 새 세션이 열렸다
  // 읽는 사이 다른 테마를 골랐다: 그쪽이 적용한다. 답은 지금 적용된 테마로
  if (my !== themeCmd) return { text: `${S.themeSet(themeLabel(themeId))}${await hidden()}` }
  applyTheme(t)
  bigDirty = true
  skip = 0 // 멈춘 동안(1초에 한 번)이라도 바로 보낸다
  await update($, clawd, c => (c.ready ? c : { ...c, ready: vnow })) // 앞 테마를 못 읽어 그림이 없던 때
  if (yardShown) yardShown = '~theme' // 화면의 띠는 옛 테마: 다음 놀이터 차례에 새 띠를 한 장 보낸다(다시 그릴 때는 지난번 PNG 그대로)
  await saveClawd($, sg, {}, fb)
  return { text: `${S.themeSet(themeLabel(id))}${await hidden()}` }
}
// 패널이 닫혀 있으면 답 끝에 붙이는 안내. $.ui.panes() 를 못 읽으면 붙이지 않는다
const closedNote = async ($: any) => {
  try {
    const open = (await $.ui.panes()).some((p: { id: string; isShown?: boolean; isPlaced?: boolean }) => p.id === PANE && p.isShown !== false && p.isPlaced !== false)
    return open ? '' : S.paneClosed
  } catch { return '' }
}
// 이 플러그인이 띄운 고르기 창($.ui.ask: /skin·/scene·언어). 창은 AskUserQuestion 도구 호출로 열려 tool.call 훅이 '대답 기다림'으로 보고,
// 그 호출이 거절·실패로 끝나도 '앗'을 세우지 않는다(pickers 가 0 보다 크면). 결과: 고른 글자 · 사람이 닫음 · 그 밖(못 띄움·거절·오류)
let pickers = 0
// 엔진은 모든 실패를 'no answer (<사유>)' 로 감싼다: 공통 머리말이 아니라 사유로 가른다(검수 11-18 #1)
const DISMISS_RE = /\b(dismissed|declined|cancell?ed|aborted)\b|doesn't want to proceed/i
type Picked = { kind: 'answer'; text: string } | { kind: 'dismissed' } | { kind: 'failed' }
const askPick = async ($: any, question: string, options: string[], header: string): Promise<Picked> => {
  pickers++
  try { return { kind: 'answer', text: String(await $.ui.ask(question, { options, header })) } } catch (err) {
    return DISMISS_RE.test(String(err)) ? { kind: 'dismissed' } : { kind: 'failed' }
  } finally { pickers-- }
}
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
  // 사용량 경고 반응(clawd.ts usageAlarm): 창마다 넘은 단계, 아직 못 보인 경고(한가해지면 보인다), 보이는 중인 10초
  usageLevels: {} as Record<string, number>,
  dizzyDue: false,
  dizzy: null as ClawdLive['dizzy'],
  lastActivity: Date.now(),
}
/** 앞 세션의 활동 기록을 비운다(새 세션이 앞 세션의 도구·창·턴을 이어 보이지 않게, 검수 11-18 #3) */
const liveReset = () => {
  live.tools.clear(); live.asks.clear(); live.turn = null; live.hold = null; live.celebrate = null; live.oops = null
  live.usageLevels = {}; live.dizzyDue = false; live.dizzy = null
  turnGen++
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
let drawnDx = 0 // 화면에 나가 있는 큰 캐릭터의 가운데 정렬 칸 수(clawd.ts actShift). 장면이 같아도 dx 가 다르면 새 그림을 보낸다
let rendDx = 0 // 다시 그리기에 넘긴 장면의 dx
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
  const gen = drawGen, sg = sessGen
  try {
    const r = await $.ui.blit({ requestId: PANE, key: SPIN_KEY, cells: want })
    if (gen !== drawGen) return // 기다리는 사이에 새로 그려졌다
    if (r && r.deny) spinMounted = false // 다시 그려질 때까지 쉰다
    else spinDrawn = want
  } catch { if (gen === drawGen) spinMounted = false } finally { if (sg === sessGen) spinBlitting = false }
}
const cellsOf = (f: number, dx: number) => {
  const k = `${f}:${dx}`
  let c = rasterCache.get(k)
  if (!c && sprites) { c = rasterCells(shiftRows(sprites.frames[f] ?? [], dx, sprites.canvas[0]), sprites.palette); rasterCache.set(k, c) }
  return c ?? ''
}
const pngOf = (f: number, dx: number) => (sprites ? bigPng(sprites, f, dx) : '')
const liveNow = (now: number): ClawdLive => ({
  now, tools: [...live.tools.values()], hold: live.hold, turn: live.turn, celebrate: live.celebrate,
  subagents: live.subagents, jobs: live.jobs, dizzy: live.dizzy, lastActivity: live.lastActivity,
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
// 지금 동작의 states 항목: 손님 틀이 있으면 동작 시작(actT0)에 고른 것(pickVariant). 같은 동작이 이어지는 동안은 같은 것
let varMemo: { states: Sprites['states'] | null; act: ClawdAct; t0: number; key: string } = { states: null, act: 'idle', t0: NaN, key: 'idle' }
const curState = () => {
  if (!sprites) return undefined
  const m = varMemo
  if (m.states !== sprites.states || m.act !== curAct || m.t0 !== actT0) {
    varMemo = { states: sprites.states, act: curAct, t0: actT0, key: pickVariant(sprites.states, curAct, actT0) }
  }
  return sprites.states[varMemo.key] ?? sprites.states[curAct]
}
/** 지금 동작의 가운데 정렬 칸 수: 손님 틀이면 그 키, 없는 키면 본래 동작으로(curState 와 같은 것) */
const curDx = () => {
  if (!sprites) return 0
  curState()
  return actShift(sprites, sprites.states[varMemo.key] ? varMemo.key : curAct)
}
const curFrame = (now: number, l: ClawdLive) => {
  const st = curState()
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
// 거부·실패하면 화면의 띠는 그대로라 yardShown 을 되돌려 다음 차례에 다시 보낸다. 창이 안 붙어 있는 거부(mount·no-surface)도
// 한 번에 쉬지 않고 간격을 늘리다가 DENY_GIVE_UP 번째에 쉰다(yardN = 0 이면 다음 다시 그리기가 source 를 새로 넘겨 번쩍인다)
let yardDenies = 0
let yardRetryAt = 0 // 거부된 뒤 다시 해 볼 시각(yardLastAt 과 따로 둔다: 다시 그리기·새 세션이 비운다)
// 놀이터를 새로 그릴 때(새 세션·다시 그리기에서 source 를 새로 넘길 때)마다 올린다: 그 전에 떠난 blit 의 답은 화면의 띠·흙 색을 건드리지 않는다
let yardGen = 0
const yardTick = async ($: any, now: number, frozen: boolean): Promise<boolean> => {
  // tune.yard 가 꺼져 있어도 테마를 바꾼 뒤의 한 장은 보낸다
  if ((!tune.yard && yardShown !== '~theme') || !yardN || !friends || now - yardLastAt < tune.yardMs || now < yardRetryAt) return false
  const fr = yardFrames(friends, yardN, now, frozen), tod = todOf(new Date(now))
  const key = yardBg ? sceneKey(fr, now, frozen, tod) : fr.join(',')
  if (key === yardShown) return false
  const was = yardShown, sc = scene
  yardShown = key; yardLastAt = now
  const gen = drawGen, yg = yardGen, sg = sessGen
  let ok = false, deny = ''
  try {
    const png = yardBg ? yardScenePng(friends, fr, yardCols, now, frozen, tod, sc) : yardStripPng(friends, fr, yardCols)
    const r = await imgBlit($, { key: 'yard', source: { png } })
    ok = !(r && r.deny); deny = r && r.deny ? String(r.deny) : ''
  } catch { ok = false }
  if (sg !== sessGen || yg !== yardGen) return true // 기다리는 사이 새 세션이 열렸거나 놀이터를 새로 그렸다: 이 답은 옛 띠의 것
  // 큰 캐릭터를 꺼 두면 그 확인 blit 이 없다: 그때는 풍경 blit 의 거부도 시계·배터리처럼 '그림을 못 그리는 터미널' 판정에 넣는다
  // (켜져 있을 때는 큰 캐릭터의 확인이 맡는다: 풍경까지 세면 확인 세 번보다 먼저 물러난다)
  // 같은 띠가 그대로인 단순 다시 그리기(drawGen 만 오름)로는 이 거부를 버리지 않는다: 띠를 새로 넘겼으면 위 yardGen 이 거른다
  if (!ok && deny && !clawdOn) await imgDenied($, deny)
  if (ok) {
    yardDenies = 0; yardRetryAt = 0
    imgDenies = 0 // 풍경이 그려졌다: 거부가 잇달아 온 것이 아니다(거부·성공이 번갈아 오면 글자 방식으로 물러나지 않는다)
    if (yardBg) {
      yardScene = sc
      // 흙 줄이 깔려 있고 색이 달라졌으면 글자 칸만 다시 그린다(그림 source 는 그대로라 그림은 다시 가지 않는다)
      const soil = soilRgb(tod, sc)
      if (fillShown >= 0 && soil !== fillShown) await update($, clawd, c => ({ ...c, soil }))
    }
    return true
  }
  if (yardShown === key) yardShown = was // 이 띠는 화면에 안 나갔다
  if (gen === drawGen) {
    if (++yardDenies >= DENY_GIVE_UP) { yardDenies = 0; yardN = 0 } // 다시 그려질 때까지 쉰다
    else yardRetryAt = now + Math.min(10_000, 1000 * 2 ** (yardDenies - 1))
  }
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
  if (!sprites) return
  if (skip > 0) { skip--; return }
  if (now - lastAgents >= AGENTS_EVERY_MS) { lastAgents = now; void checkAgents($) }
  const l = liveNow(now)
  if (isBusy(l)) live.lastActivity = l.lastActivity = now
  if (live.hold && now >= live.hold.until) live.hold = null
  if (live.celebrate && now >= live.celebrate.until) live.celebrate = null
  if (live.oops && now >= live.oops.until) live.oops = null
  if (live.dizzy && now >= live.dizzy.until) live.dizzy = l.dizzy = null
  // 미뤄 둔 사용량 경고: 한가한 동작이 될 때 10초(바쁘면 계속 미룬다)
  // 띄우는 순간에 지금 화면에 올린 사용량(claudeShown)에 90% 넘는 창이 아직 있는지 본다(바쁜 사이 리셋됐거나 내려갔으면 버린다)
  if (live.dizzyDue && !claudeShown.some(w => usageLevel(w.usedPct) > 0)) live.dizzyDue = false
  if (live.dizzyDue) {
    const d = dizzyStart(l)
    if (d) {
      // 띄우는 순간 화면 atom 의 지금 값과 세대도 본다: 이 모듈이 올린 낮은 값의 응답만 늦어 claudeShown 이 아직 옛 높은 값일 수 있다
      const sg = sessGen, v = await read($, claudeView)
      if (sg !== sessGen || !live.dizzyDue) { /* 기다리는 사이 새 세션 */ }
      else if (ownerGen >= 0 && v.gen > ownerGen) live.dizzyDue = false // 더 새 세대가 화면을 가졌다
      else if (ownerGen >= 0 && v.gen < ownerGen) { /* 이 세대의 값이 아직 안 올라갔다: 다음 틱에 다시 본다 */ }
      else if (!v.wins.some(w => usageLevel(w.usedPct) > 0)) live.dizzyDue = false
      else { live.dizzy = l.dizzy = d; live.dizzyDue = false }
    }
  }
  // 큰 캐릭터를 꺼 두어도 아래 풍경은 /scene 값대로 움직인다(사용자 2026-11-18): 그림 차례가 비었으면 풍경만
  if (!clawdOn) {
    const frozenOff = isFrozen(l)
    if (frozenOff) skip = 9
    if (!tookSlot && imgFree()) await yardTick($, now, frozenOff)
    return
  }
  const act = pickAct(l)
  if (act !== curAct) { curAct = act; actT0 = now }
  // 설명 글자: 적어 둔 것과 달라졌을 때만 atom 을 고친다(글자가 같은 동작끼리는 다시 그리지 않는다)
  if (CAP[shownAct].text !== CAP[act].text || CAP[shownAct].color !== CAP[act].color) {
    shownAct = act
    // 적은 세션의 세대를 함께 담고, 콜백 안에서 세대를 본다: 앞 세션·/reload-plugins 전 모듈의 늦은 쓰기('사용량이 바닥나요' 등)가 다시 불려도 새 세션의 글자를 덮지 못한다
    const sg = sessGen, og = ownerGen
    if (!ownerLost) await update($, clawd, c => (sg !== sessGen || staleAct(c, og) ? c : { ...c, act, ...(og >= 0 ? { gen: og } : {}) }))
    if (!clawdOn) return // 기다리는 사이에 꺼졌다
  }
  if (SPIN_ACTS.has(act)) spinIdx = (spinIdx + 1) % SPIN_SEQ.length
  void spinTick($, act)
  const frozen = isFrozen(l)
  if (frozen && !bigDirty && yardShown !== '~theme') skip = 9 // 멈춘 동안은 1초에 한 번만 본다(테마를 바꾼 뒤 두 그림을 보낼 때까지는 빼고)
  if (tookSlot) return
  const f = curFrame(now, l), dx = curDx()
  // 큰 Clawd 가 이번 틱에 바꿀지. 그림 방식은 그림 차례(imgFree)가 비어야 하고, 글자 방식(Raster)은 차례와 상관없다.
  // 가운데 정렬 칸 수(dx)가 바뀌는 것도 장면이 바뀌는 것과 같은 길(blit, 차례대로)로 보낸다
  let bigGo = false
  if (drawnKind && !blitting && (f !== drawnFrame || dx !== drawnDx || probe || bigDirty) && (tune.big || probe || bigDirty)) {
    if (probe && probeWait > 0) probeWait--
    else if (backoff > 0) backoff--
    else bigGo = drawnKind !== 'image' || imgFree()
  }
  // 놀이터가 오래 굶었으면(큰 Clawd 가 쉬지 않고 바뀌는 동작) 이번 차례를 놀이터에 먼저 준다. 바꿀 것이 없으면 큰 Clawd 가 그대로 쓴다
  if (bigGo && drawnKind === 'image' && yardN > 0 && now - yardLastAt >= tune.starveMs && await yardTick($, now, frozen)) return
  if (!bigGo) {
    // 큰 Clawd 가 쓰지 않는 틱은 놀이터 차례. 다만 큰 Clawd 가 곧(gap 안에) 바뀔 참이면 자리를 비워 둔다(오래 굶었으면 예외)
    if (imgFree()) {
      const soon = drawnKind === 'image' && tune.big ? msUntilChange(curState(), actT0, now, frozen) : Infinity
      if (soon >= tune.gap * CLAWD_TICK_MS || now - yardLastAt >= tune.starveMs) await yardTick($, now, frozen)
    }
    return
  }
  blitting = true
  const gen = drawGen, sg = sessGen
  const kind = drawnKind, wasProbe = probe, tg = themeGen
  if (kind === 'image') { imgBusy = true; imgLastTick = tickNo }
  const png = kind === 'image' ? pngOf(f, dx) : ''
  try {
    const r = kind === 'image'
      ? await $.ui.blit({ requestId: PANE, key: CLAWD_KEY, source: { png } })
      : await $.ui.blit({ requestId: PANE, key: CLAWD_KEY, cells: cellsOf(f, dx) })
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
    } else {
      drawnFrame = f; drawnDx = dx; probe = false; if (tg === themeGen) bigDirty = false; backoff = 0; probeDenies = 0; denyStreak = 0
      if (kind === 'image') shownPng = png
    }
  } catch { if (gen === drawGen) backoff = 50 } finally { if (sg === sessGen) { blitting = false; if (kind === 'image') imgBusy = false } }
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

// 세션끼리 나누는 사용량(hooks/share.ts 머리 주석이 규칙): 세션이 시작할 때 한 번 정하는 것(ShareCtx)과, 그 세션 동안의 기억.
// sg: 이 모듈 안의 세션 세대(기다림 없이 비교), gen·id: atom(claudeOwn2)의 세대와 이 프로세스의 칸 이름(/reload-plugins 뒤의 새 모듈과도 가른다),
// path: 파일 자리(HOME·CLAUDE_CONFIG_DIR 로 세션 시작 때 한 번 만든 약속. 기다리는 사이 다른 세션이 바꿀 수 없다. '' 이면 파일로 나누지 않는다)
type ShareCtx = { sg: number; gen: number; id: string; path: Promise<string> }
let shareGen = 0
// 파일은 크기·시각이 바뀌었을 때만 다시 읽는다(5초마다 통째로 읽지 않게. 그래도 SHARE_REREAD_S 마다 한 번은 본문을 다시 읽는다).
// 자기가 쓴 직후에는 기억을 비워 다음 틱에 한 번 다시 읽는다
// (쓴 뒤의 stat 은 그사이 다른 세션이 쓴 파일의 것일 수 있어, 그것으로 자기 내용을 인증하면 남의 값을 계속 못 본다)
let shareCache: { key: string; read: ShareRead; at: number } | null = null
let shareMem: Slot[] = [] // 이 세션이 본 칸들(칸마다 가장 높은 seq 판). 파일을 못 읽는 틱에도 화면은 이것을 지금 시각으로 다시 본다
let shareBad = { key: '', n: 0 } // 같은 크기·시각으로 잇달아 깨져 읽힌 횟수(그 사이 다른 결과가 끼면 0 부터)
let shareRetryAt = 0 // 쓰기가 실패하면 실패한 시각 + SHARE_RETRY_S 까지 다시 쓰지 않는다
let shareWriting = false // 파일 쓰기가 도는 중(틱과 따로 돈다: 한 번에 하나)
let claudeShown: ClaudeWindow[] = [] // 이 세션이 화면 atom 에 실제로 올린 사용량. 미뤄 둔 경고는 띄우는 순간 이것을 본다
let ownerGen = -1 // 이 모듈의 지금 세션이 가진 세대(claudeOwn2 의 gen, 모르면 -1). 설명 글자(clawd atom 의 act)를 적을 때 함께 담는다
let ownerLost = false // 이 모듈의 지금 세션이 시작 순서에서 져 주인이 못 됐다(설명 글자를 적지 않는다)
/** 이 모듈을 가리키는 이름(불러올 때 한 번). 주인 기록(claudeOwn2 의 ownMod)이 같은 모듈의 것인지 가른다 */
const MODULE_ID = newSlotId()
/** 설명 글자를 적으려는 세대(og)보다 더 새 세대가 이미 적었는지 */
const staleAct = (c: { gen?: number }, og: number) => og >= 0 && (c.gen ?? -1) > og
/** 엔진 시계(초). 못 읽으면 nowMs()(Date.now 바탕)로 어림하고 ok=false: 그 틱은 시각을 남기는 쓰기를 하지 않는다 */
const engineNow = async ($: any): Promise<{ s: number; ok: boolean }> => {
  try { return { s: Math.floor((await $.clock.now()) / 1000), ok: true } } catch { return { s: Math.floor(nowMs() / 1000), ok: false } }
}
/**
 * 파일을 읽은 결과(바뀌지 않았으면 지난번 것). 없으면 빈 칸들, 못 읽었거나(권한 등) 막 깨진 것이면 null(이번 틱은 기억으로 화면만, 쓰지 않는다).
 * 같은 크기·시각으로 SHARE_DEAD_TICKS 번 잇달아 깨져 있으면 repair(덮어써서 고친다). 그사이 다른 결과가 끼면 처음부터 센다
 */
const readShare = async ($: any, path: string, ctx: ShareCtx, nowS: number): Promise<ShareRead | null> => {
  const mine = () => ctx.sg === shareGen
  let st: { size: number; mtimeMs: number }
  try { st = await $.fs.stat(path) } catch {
    // 없는 것(아직 아무도 안 씀)과 못 읽는 것(권한 등)을 가른다: 오류 글자 모양에 기대지 않고 exists 로 다시 묻는다
    let missing = false
    try { missing = !(await $.fs.exists(path)) } catch { missing = false }
    if (mine()) { shareCache = null; shareBad = { key: '', n: 0 } }
    return missing ? { slots: [] } : null
  }
  const key = `${st.size}:${st.mtimeMs}`
  if (shareCache && shareCache.key === key && nowS - shareCache.at < SHARE_REREAD_S) { if (mine()) shareBad = { key: '', n: 0 }; return shareCache.read }
  let text: string
  try { text = String(await $.fs.read(path)) } catch { if (mine()) shareBad = { key: '', n: 0 }; return null }
  const r = parseShare(text)
  if (!mine()) return null
  if (!r) {
    shareBad = shareBad.key === key ? { key, n: shareBad.n + 1 } : { key, n: 1 }
    if (shareBad.n < SHARE_DEAD_TICKS) return null // 쓰는 중에 읽었을 수 있다: 다음 틱에 다시
    shareBad = { key: '', n: 0 }
    return { slots: [], repair: true } // 오래 그대로 깨져 있다: 덮어써서 고친다(기억해 두지 않는다: 쓰고 나면 다시 읽는다)
  }
  shareBad = { key: '', n: 0 }
  shareCache = { key, read: r, at: nowS }
  return r
}
/**
 * 화면 atom 에 올린다. 값과 함께 올린 세대를 담아, 콜백 안에서 더 새 세대(같은 모듈의 새 세션·/reload-plugins 뒤의 새 모듈)가 올린 값을 덮지 않는다
 * (update 가 버전이 어긋나 콜백을 다시 불러도). 경고는 실제로 올라간 값으로 정한다(올리기가 늦는 동안 화면과 경고가 어긋나지 않게)
 */
const publishClaude = async ($: any, ctx: ShareCtx, next: ClaudeWindow[]) => {
  const mine = () => ctx.sg === shareGen
  let shown = await read($, claudeView)
  if (shown.gen > ctx.gen) return
  if (shown.gen !== ctx.gen || JSON.stringify(shown.wins) !== JSON.stringify(next))
    shown = await update($, claudeView, cur => (cur.gen > ctx.gen || !mine() ? cur : { gen: ctx.gen, wins: next }))
  if (shown.gen !== ctx.gen || !mine()) return
  claudeShown = shown.wins
  // 90·95·100% 를 넘을 때마다(세션 첫 읽기에서 이미 넘었어도, 다른 세션 값으로 넘었어도) 한 번: 한가할 때 10초 '사용량이 바닥나요'
  const al = usageAlarm(live.usageLevels, shown.wins)
  live.usageLevels = al.levels
  if (al.fired) { live.dizzyDue = true; skip = 0 }
}
/** 자기 칸을 파일에 적는다(틱과 따로, 한 번에 하나). seq 를 받는 update 콜백이 쓰기 직전의 세대 확인이고, 그 뒤로 기다림 없이 바로 쓴다 */
const writeShare = async ($: any, ctx: ShareCtx, path: string, myObs: Obs[], t0: number) => {
  const mine = () => ctx.sg === shareGen
  try {
    const c = await update($, claudeOwn, x => (x.gen !== ctx.gen ? x : { ...x, seq: x.seq + 1 }))
    if (c.gen !== ctx.gen || !mine()) return
    const slots = composeSlots(shareMem, ctx.id, c.seq, myObs, t0)
    try {
      await $.fs.write(path, shareText(slots))
      if (mine()) { shareCache = null; shareMem = foldSlots(shareMem, slots, t0); shareRetryAt = 0 }
    } catch {
      // 못 쓰면 자기 값·기억으로만. 다시 쓰는 기한은 실패를 받은 때부터(그 시계를 못 읽으면 이 틱의 엔진 시각부터)
      const tf = await engineNow($)
      if (mine()) shareRetryAt = (tf.ok ? tf.s : t0) + SHARE_RETRY_S
    }
  } catch { /* 다음 틱에 */ } finally { if (mine()) shareWriting = false }
}
// Claude 사용량: 자기 값(비용 없는 호출) + 다른 세션의 칸들 → 화면 값(shownUsage). 바뀌었을 때만 atom·파일에 적는다
const readClaudeNow = async ($: any, ctx: ShareCtx) => {
  // 새 세션(같은 모듈)은 기다림 없이, /reload-plugins 뒤의 새 모듈은 atom 의 세대로 알아챈다. 옛 세대는 어떤 것도 적지 않는다
  const mine = () => ctx.sg === shareGen
  try {
    // 관측 시각은 usage() 를 부르기 전에 엔진 시계로 잰다(답이 늦게 와도 늦은 시각을 붙이지 않게)
    const clk = await engineNow($), t0 = clk.s
    const { rateLimits } = await $.session.usage()
    const own: ClaudeWindow[] = (rateLimits ?? []).map((r: { kind: string; percentUsed: number; resetsAt?: string }) => ({
      kind: r.kind, usedPct: r.percentUsed, resetsAt: r.resetsAt ? Math.floor(Date.parse(r.resetsAt) / 1000) || 0 : 0,
    }))
    if (!mine()) return
    let me = await read($, claudeOwn)
    if (me.gen !== ctx.gen || !mine()) return
    // 1) 자기 값의 나이: 바뀐 종류는 지금. 기록이 없으면(이 프로세스에서 갓 올림) 처음 본 값은 나이 모름(0: 파일에 적지 않는다).
    //    엔진 시계를 못 읽은 틱은 적지 않는다(어림한 시각을 받은 시각으로 남기지 않게: 다음 틱에 엔진 시각으로 적힌다)
    let at = nextOwnAt(me.wins, me.at, own, me.init, t0)
    if (clk.ok && (!me.init || JSON.stringify(me.wins) !== JSON.stringify(own) || JSON.stringify(me.at) !== JSON.stringify(at))) {
      // 세대는 콜백 안에서 본다: update 는 버전이 어긋나면 콜백을 다시 부르므로, 늦게 도착한 옛 세대의 쓰기도 새 세대 값을 덮지 못한다
      me = await update($, claudeOwn, c => (c.gen !== ctx.gen ? c : { ...c, init: true, wins: own, at: nextOwnAt(c.wins, c.at, own, c.init, t0) }))
      if (me.gen !== ctx.gen || !mine()) return
      at = me.at
    }
    // 2) 파일(못 읽으면 null: 이번 틱은 기억해 둔 칸들로 화면만)
    const path = await ctx.path
    let file: ShareRead | null = null
    if (path) { try { file = await readShare($, path, ctx, t0) } catch { file = null } }
    if (!mine()) return
    shareMem = foldSlots(shareMem, file?.slots ?? [], t0)
    // 3) 자기 칸이 파일과 다르면(또는 오래 깨진 파일이면) 적는다. 틱과 따로 돌려 느린 쓰기가 화면을 막지 않게 한다.
    //    못 읽은 틱·엔진 시계를 못 읽은 틱·쓰는 중·쓰기 실패 뒤 60초는 쓰지 않는다
    const myObs = ownSlotWins(own, at, t0)
    if (path && file && clk.ok && !shareWriting && t0 >= shareRetryAt && planWrite(file, shareMem, ctx.id, myObs, t0)) {
      shareWriting = true
      void writeShare($, ctx, path, myObs, t0)
    }
    // 4) 화면 값과 경고
    await publishClaude($, ctx, shownUsage(shareMem, ctx.id, own, at, t0))
  } catch { /* 수치를 못 읽으면 앞선 값을 그대로 둔다 */ }
}
// 사용량 읽기는 겹쳐 돌지 않게 줄 세운다: 앞 읽기가 끝나기 전에 다음 틱이 오면 둘 다 '파일 없음'을 보고 같은 파일을 두 번 적는다.
// 도는 중에 온 요청은 하나로 합쳐, 앞 읽기가 끝난 뒤 한 번 더 돈다(그사이 바뀐 값을 놓치지 않게). 새 세션은 앞 세션의 읽기를 기다리지 않는다.
// 도는 줄은 번호(claudeTok)로 알아본다: 0 이면 도는 것이 없다
let claudeRun: Promise<void> = Promise.resolve()
let claudeTok = 0
let claudeSeq = 0
let claudeNext: (() => Promise<void>) | null = null
let claudeGen = 0
const readClaude = ($: any, ctx: ShareCtx): Promise<void> => {
  if (ctx.sg !== shareGen) return Promise.resolve() // 앞 세션의 틱
  const go = () => readClaudeNow($, ctx)
  if (claudeTok) { claudeNext = go; return claudeRun }
  const gen = claudeGen, tok = ++claudeSeq
  claudeTok = tok
  const loop = async () => {
    let cur = go
    try {
      for (;;) {
        await cur()
        if (gen !== claudeGen || !claudeNext) break
        cur = claudeNext; claudeNext = null
      }
    } finally { if (claudeTok === tok) claudeTok = 0 }
  }
  claudeRun = loop()
  return claudeRun
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
  await $.command.register({ name: 'skin', description: S.descSkin, argumentHint: S.hintSkin })
  await $.command.register({ name: 'scene', description: S.descScene, argumentHint: S.hintScene })
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
    // 시작 순서(hooks/share.ts 머리 주석 '세대'): 이 시작의 엔진 시각을 무엇보다 먼저 잰다. 모듈이 달라도(/reload-plugins) 비교할 수 있다
    const startAt = (async () => { try { return Number(await $.clock.now()) } catch { return nowMs() } })()
    const started = await next(e)
    floor = FLOOR_NONE
    // 같은 모듈에서 세션이 다시 열리면(재시작·재개) 앞 세션의 화면·전송 기억을 지운다. 남겨 두면 같은 크기로 붙은 새 패널의
    // 첫 그리기가 앞 세션의 그림(rendPng·yardRendPng)을 넘기고, 답을 못 받은 blit 이 차례를 막는다(검수 2026-11-17 #1)
    sessGen++; drawGen++
    const shareSg = ++shareGen // 사용량 나누기는 새 세션의 것으로(아래 shareCtx). 세대는 기다림 없이 여기서 잡는다
    shareCache = null; shareMem = []; shareBad = { key: '', n: 0 }; shareRetryAt = 0; shareWriting = false; claudeShown = []; ownerGen = -1; ownerLost = false
    claudeTok = 0; claudeNext = null; claudeGen++ // 앞 세션의 사용량 읽기가 안 끝났어도 새 세션은 바로 읽는다
    lastGeo = ''; drawnKind = null; drawnFrame = -1; rendFrame = -1; rendPng = ''; shownPng = ''; bigDirty = false
    yardN = 0; yardRend = []; yardRendPng = ''; yardShown = ''; yardDenies = 0; yardRetryAt = 0; yardLastAt = 0; yardGen++
    yardScene = clawdScene; fillShown = -1
    probeDenies = 0; denyStreak = 0; backoff = 0; skip = 0
    blitting = false; imgBusy = false; spinBlitting = false; spinMounted = false; spinDrawn = ''; probe = false; drawnDx = 0; rendDx = 0
    liveReset()
    // 사용량 나누기(hooks/share.ts)의 세대: atom 의 gen 을 올리는 것이 앞 세션·/reload-plugins 전 모듈에게 '이제 쓰지 말라'는 표시다.
    // 누가 주인인지는 시작 순서로 정한다: 같은 모듈이면 이 모듈의 세대(shareSg)가 가장 새 것, 다른 모듈이 적어 둔 주인이면 시작 시각(startAt)이
    // 그보다 이르지 않을 때만 올린다. update 가 버전이 어긋나 콜백을 다시 불러도 같은 규칙이라, 늦게 풀린 옛 시작은 새 주인을 빼앗지 못하고
    // 먼저 적힌 옛 시작은 새 시작이 다시 올려 가져간다(어느 쪽이 먼저 닿아도 새 시작이 주인이 된다)
    const at0 = await startAt
    let own0 = { gen: -1, id: '' }, lost = false
    try {
      let took = false
      const c = await update($, claudeOwn, x => {
        took = shareSg === shareGen && (x.ownMod === MODULE_ID || at0 >= (x.ownAt ?? 0))
        return took ? { ...x, id: SLOT_ID_RE.test(x.id) ? x.id : newSlotId(), gen: x.gen + 1, ownAt: at0, ownMod: MODULE_ID } : x
      })
      if (took && shareSg === shareGen && c.ownMod === MODULE_ID && c.ownAt === at0) own0 = c
      else lost = true
    } catch { /* 나눔을 쉰다(자기 값만): 주인을 모를 뿐 잃은 것은 아니다 */ }
    // 주인이 못 된 시작(같은 모듈의 더 새 세션, 또는 더 늦게 시작한 다른 모듈이 있다)은 뒤의 초기화(Clawd 읽기·설명 글자·타이머)를 하지 않고 끝낸다:
    // 늦게 풀린 옛 시작이 새 주인의 경고 글자를 '쉬는 중'으로 되돌리거나 세대를 지우지 않게
    if (lost) {
      if (shareSg === shareGen) ownerLost = true
      return started
    }
    if (shareSg === shareGen) ownerGen = own0.gen
    // 언어를 먼저 정한다: 명령 설명은 이때 고른 언어로 등록한다
    curLang = await langOf($, await readPref($)); S = STR[curLang]
    try { await update($, langA, () => curLang) } catch { /* 다음 그리기에 */ }
    await registerCommands($)
    usageGen++; usageBusy = false; usageLast = 0 // 앞 세션의 사용량 읽기는 버리고 새로 묻는다
    bgGen++; collecting = false; weekBusy = false; weekAgain = false; imgDenies = 0
    hostP = findHost($) // 파이썬 명령·운영체제(기다리지 않는다: 첫 읽기들이 이 답을 기다린다)
    void $.ui.open({ id: PANE, title: S.title, backgroundColor: 'transparent' })

    // Clawd: 켜짐·모양은 세션이 바뀌어도 남는다($.store). 그림 자료는 모드 폴더의 sprites.json
    const loadClawd = async (sg: number) => {
      // 옛 판이 남긴 look('sticker' 등)은 읽지 않는다: 언제나 민무늬(0.8.7 에서 테두리 모양을 없앰)
      let pref: { on?: boolean; bg?: boolean; yard?: boolean; theme?: string } = {}
      try { pref = ((await $.store.get('clawd')) ?? {}) as typeof pref } catch { /* 기본값 */ }
      clawdOn = pref.on !== false
      // 테마: 저장해 둔 것(없거나 모르는 이름이면 기본 clawd). 못 읽으면 기본으로, 기본도 못 읽으면 그림 없음
      const want = themePrefOf(pref.theme, THEMES)
      let t: Theme | null = null
      try { t = await loadTheme($, want) } catch { /* 아래에서 기본으로 */ }
      if (!t && want !== THEME_DEFAULT) try { t = await loadTheme($, THEME_DEFAULT) } catch { /* 그림 없음 */ }
      if (sg !== sessGen) return // 읽는 사이 새 세션이 열렸다: 그쪽이 읽은 것을 덮지 않는다
      if (t) applyTheme(t)
      else { sprites = friends = null; themeId = THEME_DEFAULT; scene = clawdScene; themeGen++; rasterCache.clear() }
      // 모드를 다시 읽으면 모듈 변수는 처음부터라, 남아 있던 설명(act)도 대기로 맞춘다. 돌던 턴은 다음 이벤트부터 다시 따라간다
      try { const t = await $.clock.now(); base = vnow = t; baseReal = Date.now() } catch { /* 처음 값(Date.now) */ }
      if (sg !== sessGen) return
      live.lastActivity = actT0 = vnow; curAct = shownAct = 'idle'
      const bg = pref.bg !== false // 풍경은 기본 크게(배경까지, 사용자 2026-11-16)
      const yard = pref.yard !== false
      const og = ownerGen
      if (!ownerLost) await update($, clawd, c => (sg !== sessGen || staleAct(c, og) ? c
        : { on: clawdOn, bg, yard, act: 'idle' as ClawdAct, raster: c.raster, ready: sprites ? vnow : 0, ...(og >= 0 ? { gen: og } : {}) }))
    }
    // /clawd 명령은 이것이 끝난 뒤에 돈다(늦게 끝난 읽기가 명령이 바꾼 테마·켜짐을 시작 때 값으로 덮지 않게)
    clawdLoaded = loadClawd(sessGen).catch(() => { /* 그림 없음 */ })
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
    // 사용량 나누기: 위에서 정한 세대·칸 이름과 파일 자리를 지금 한 번 정해 이 세션의 읽기에 끝까지 넘긴다.
    // CLAUDE_CONFIG_DIR 을 못 읽으면 기본 이름으로 다른 계정의 파일과 섞일 수 있어 이 세션은 파일로 나누지 않는다(자기 값만)
    const sg = shareSg, h = home
    const sharePath = (async () => {
      if (!h) return ''
      let cfg: string | undefined
      try { cfg = await $.env.get('CLAUDE_CONFIG_DIR') } catch { return '' }
      return `${h}/.cache/status-panel/${shareFileName(cfg)}`
    })()
    const shareCtx: ShareCtx = { sg, gen: own0.gen, id: own0.id, path: sharePath }
    // 배경 읽기는 세션이 끝나는 중에 늦게 끝나도 오류를 밖으로 내보내지 않는다
    const timeTick = async () => {
      try {
        await checkClock($); await readTune($)
        await readClaude($, shareCtx)
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
      // '/status-panel language|lang|언어 [값]'. 값이 없으면 고르기 창(자동 / 한국어 / English), 있으면 바로. 답은 바꾼 언어로
      const cmd = parseLangCmd(a)
      if (!cmd) return { text: S.langUsage }
      const sg = sessGen
      const nowName = async () => S.langName(await readPref($))
      let pick = cmd.value
      if (!pick) {
        const r = await askPick($, S.langAsk(await nowName()), [S.langAuto, '한국어', 'English'], S.langHeader)
        if (r.kind === 'failed') return { text: S.langNow(await nowName()) }
        if (r.kind === 'dismissed' || !r.text.trim()) return { text: S.langKept(await nowName()) }
        if (sg !== sessGen) return { text: S.langKept(await nowName()) }
        pick = r.text
      }
      const pref = parseLangArg(pick)
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
          // 실패·거절: 2.4초 '앗'. 이 플러그인이 띄운 고르기 창(AskUserQuestion)이 거절·실패로 끝난 것은 뺀다(검수 11-18 #2)
          if (isFailure(r) && !(pickers > 0 && name === 'AskUserQuestion')) live.oops = { until: t + OOPS_HOLD_MS }
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

  // '/clawd': 큰 캐릭터 켜기·끄기만(사용자 2026-11-18). 아래 풍경은 /scene 이 따로 맡는다
  on('command.run', { command: 'clawd' }, async ($, e) => {
    const a = (e.args ?? '').trim()
    const sg = sessGen
    await clawdLoaded
    if (sg !== sessGen) return { text: clawdOn ? S.clawdOn : S.clawdOff }
    const cur = await read($, clawd)
    let isOn = cur.on
    if (!a) isOn = !isOn
    else if (/^(켜기|켜|on)$/i.test(a)) isOn = true
    else if (/^(끄기|꺼|off)$/i.test(a)) isOn = false
    else return { text: S.clawdUsage }
    clawdOn = isOn
    probeDenies = 0; denyStreak = 0; backoff = 0; skip = 0; drawGen++
    await saveClawd($, sg, { on: isOn }, { on: cur.on, bg: cur.bg !== false, yard: cur.yard !== false })
    // 켜면 글자 방식으로 물러나 있던 것도 그림 방식부터 다시 해 본다
    await update($, clawd, c => ({ ...c, on: isOn, raster: isOn ? false : c.raster }))
    return { text: `${isOn ? S.clawdOn : S.clawdOff}${await closedNote($)}` }
  })

  // '/scene [끄기|작게|크게]': 패널 맨 아래 풍경. 인자 없으면 고르기 창. 저장은 $.store 'clawd' 의 yard·bg 그대로(sceneStore)
  on('command.run', { command: 'scene' }, async ($, e) => {
    const a = (e.args ?? '').trim()
    const sg = sessGen
    await clawdLoaded
    const nowSize = async () => { const c = await read($, clawd); return sceneOf(c.yard !== false, c.bg !== false) }
    const name = (v: SceneSize) => S.scene[v]
    let want: SceneSize | null
    if (a) {
      want = parseScene(a)
      if (!want) return { text: S.sceneUsage }
    } else {
      if (sg !== sessGen) return { text: S.sceneNow(name(await nowSize())) }
      const opts = (['off', 'small', 'full'] as const).map(name)
      const r = await askPick($, S.sceneAsk(name(await nowSize())), opts, S.sceneHeader)
      if (r.kind === 'failed') return { text: S.sceneNow(name(await nowSize())) }
      if (r.kind === 'dismissed' || !r.text.trim() || sg !== sessGen) return { text: S.sceneKept(name(await nowSize())) }
      want = parseScene(r.text)
      if (!want) return { text: S.sceneUsage }
    }
    if (sg !== sessGen) return { text: S.sceneNow(name(await nowSize())) }
    // 설정은 창이 닫힌 뒤에 읽는다(창이 떠 있는 사이 다른 명령이 바꾼 것을 덮지 않게, 검수 11-18 #4)
    const cur = await read($, clawd)
    const st = sceneStore(want)
    await saveClawd($, sg, st, { on: cur.on, bg: cur.bg !== false, yard: cur.yard !== false })
    await update($, clawd, c => ({ ...c, ...st }))
    return { text: `${S.sceneSet(name(want))}${await closedNote($)}` }
  })

  // '/skin <이름>': 큰 마스코트·놀이터 친구·배경을 한 벌로(switchTheme). 인자 없으면 고르기 창($.ui.ask), 창을 못 띄우면 글자로
  on('command.run', { command: 'skin' }, async ($, e) => {
    const a = (e.args ?? '').trim()
    const sg = sessGen
    await clawdLoaded
    const list = () => shownThemeNames(THEMES, curLang).join(' · ')
    const nowText = () => ({ text: S.themeNow(themeLabel(themeId), list()) })
    if (sg !== sessGen) return nowText()
    // 설정(fb)은 창이 닫힌 뒤에 읽는다: 창이 떠 있는 사이 바뀐 것을 옛 값으로 덮지 않게(검수 11-18 #4)
    const byName = async (name: string, id: string | null) => {
      if (!id) { const msg = S.themeUnknown(clean(name).slice(0, 40), list()); try { $.ui.toast(msg) } catch { /* 글자로만 */ } return { text: msg } }
      const cur = await read($, clawd)
      return switchTheme($, sg, id, { on: cur.on, bg: cur.bg !== false, yard: cur.yard !== false })
    }
    if (a) return byName(a, themeIdOf(a, THEMES))
    const choices = skinChoices(THEMES, curLang)
    // 보이는 테마가 5개 이상이면 창에 다 못 넣는다: 이름으로 고르라고 붙인다
    if (!choices) return { text: `${nowText().text}${shownThemeNames(THEMES).length > ASK_MAX ? S.skinByName : ''}` }
    // 창은 AskUserQuestion 도구 호출로 열린다: 이 플러그인의 tool.call 훅이 보고 그동안 '대답 기다림', 끝나면(고름·닫음) 그 훅이 지운다
    const r = await askPick($, S.skinAsk(themeLabel(themeId)), choices, S.skinHeader)
    if (sg !== sessGen) return { text: S.skinKept(themeLabel(themeId)) } // 창이 떠 있는 사이 새 세션이 열렸다
    // 사람이 닫음은 짧게, 창을 못 띄운 것(-p·거절·오류)은 지금 테마와 목록
    if (r.kind === 'failed') return nowText()
    if (r.kind === 'dismissed') return { text: S.skinKept(themeLabel(themeId)) }
    const name = r.text.trim()
    if (!name) return { text: S.skinKept(themeLabel(themeId)) }
    return byName(name, skinAnswerId(name, THEMES, curLang))
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
    const cl = (await read($, claudeView)).wins
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
    const curF = sprites ? curFrame(tNow, liveNow(tNow)) : 0, curD = curDx()
    const sameBig = keep !== 'now' && drawnKind === 'image' && (mode === 'image-side' || mode === 'image-top') &&
      rendFrame >= 0 && drawnFrame >= 0
    const frame = !sameBig ? curF : keep === 'shown' ? drawnFrame : rendFrame
    const fdx = !sameBig ? curD : keep === 'shown' ? drawnDx : rendDx // 그 장면의 가운데 정렬 칸 수
    // 그린 것 기록은 터미널 표면이 그렸을 때만 고친다: 휴대폰·데스크톱 앱이 같이 붙어 있어도 터미널의 움직임이 멈추지 않게
    if (e.surface === 'terminal') {
      drawnKind = mode === 'image-side' || mode === 'image-top' ? 'image' : mode === 'raster' ? 'raster' : null
      if (!(sameBig && keep === 'frozen')) { drawnFrame = frame; drawnDx = fdx } // props 가 그대로면 화면의 장면도 그대로다
      rendFrame = drawnKind === 'image' ? frame : -1
      rendDx = drawnKind === 'image' ? fdx : 0
      probe = drawnKind !== null
      probeWait = PROBE_WAIT_TICKS
      drawGen++; denyStreak = 0; backoff = 0
      spinMounted = spinLive
      spinDrawn = spinLive ? spinCells(cv.act, spinIdx) : ''
    }
    // 지난번에 넘긴 장면('frozen')·화면의 장면('shown')을 넘길 때는 그 PNG 를 그대로(테마를 바꾼 뒤에도 source 가 바뀌지 않게:
    // 새 그림은 틱이 blit). 새로 넘길 때만 지금 테마의 그림이고, 그때는 그것이 화면에 나간다
    const keptPng = !sameBig ? '' : keep === 'frozen' ? rendPng : keep === 'shown' ? shownPng : ''
    // 큰 캐릭터 그림을 그리는 렌더에서만 구한다(글자 방식·꺼짐에서는 PNG 를 찾지 않는다)
    const bigSrc = mode === 'image-side' || mode === 'image-top' ? keptPng || pngOf(frame, fdx) : ''
    if (e.surface === 'terminal') {
      rendPng = drawnKind === 'image' ? bigSrc : ''
      if (drawnKind === 'image' && !keptPng) { bigDirty = false; shownPng = bigSrc }
    }
    const img = () => (
      <Image key={CLAWD_KEY} source={{ png: bigSrc }} columns={IMG_COLS} rows={IMG_ROWS} alt="Clawd" />
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
        <Raster key={CLAWD_KEY} columns={RASTER_COLS} rows={RASTER_ROWS} cells={cellsOf(frame, fdx)} />
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
    // 아래 풍경은 큰 캐릭터(cv.on)와 따로: /scene 끄기 일 때만 없다(사용자 2026-11-18)
    const yardHereRaw = canImage && cv.yard !== false && !!cv.ready && !!sprites ? yardCount(e.props.bodyColumns ?? 0) : 0
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

    // 놀이터(패널 맨 아래 풍경): 그림을 그릴 수 있고 /scene 이 끄기가 아닐 때. 다시 그릴 때 넘기는 장면은 tune.rend 대로
    const yCols = e.props.bodyColumns ?? 0
    const yardHere = fit.yard ? yardHereRaw : 0
    const wantBg = cv.bg !== false, yRows = wantBg ? YARD_BG_ROWS : YARD_ROWS, tod = todOf(nowD)
    const yardSame = keep !== 'now' && yardHere > 0 && yardN === yardHere && yardCols === yCols && yardBg === wantBg &&
      yardRend.length === yardHere && !!yardShown && !!yardRendPng
    const yFrames = !yardHere || !friends ? [] : yardSame ? yardRend : yardFrames(friends, yardHere, tNow, false)
    const yPng = !yardHere || !friends ? '' : yardSame ? yardRendPng
      : wantBg ? yardScenePng(friends, yFrames, yCols, tNow, false, tod, scene) : yardStripPng(friends, yFrames, yCols)
    if (e.surface === 'terminal') {
      if (!yardSame) { yardShown = wantBg ? sceneKey(yFrames, tNow, false, tod) : yFrames.join(','); yardScene = scene; yardGen++ }
      yardDenies = 0; yardRetryAt = 0
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
    // 흙 색은 화면에 나가 있는 놀이터 그림의 배경 것(테마를 바꾼 뒤 띠가 blit 되기 전엔 옛 테마, 된 뒤엔 yardTick 이 다시 그리게 한다)
    const fillRgb = soilRgb(shownTod, yardScene)
    if (term) fillShown = fillRows ? fillRgb : -1
    const fillColor = `#${fillRgb.toString(16).padStart(6, '0')}`
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
