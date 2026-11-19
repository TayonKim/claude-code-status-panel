// 화면에 보이는 글자를 한곳에 모은 두 언어 표(한국어·영어). ko 표는 원래 글자 그대로이고, en 표는 typeof ko 로 묶어 빠진 키가 없다.
// 파이썬 스크립트(collect.py·codex_usage.py)는 번역하지 않고 바뀌지 않는 코드 값을 내보내며, 그 값을 여기서 글자로 옮긴다.
// 영어는 한 줄 글자가 한 줄로 남도록 짧게 쓴다. Clawd 옆 글자는 옆 칸(12칸 이상)과 46칸 사용량 줄 안에 들어가게 쓴다(tests/i18n.test.tsx).
import type { ClawdAct } from '../types'

export type Lang = 'ko' | 'en'
export type LangPref = 'auto' | Lang

/** collect.py 가 손으로 띄운 대화형 agy 에 붙이는 이름(코드 값) */
export const ARGON_TTY = 'argon:interactive'

/** agy(Antigravity CLI) 작업의 꼬리표: 작업 줄·토스트·상태 줄·명령 설명. 제품 이름 그대로 'Antigravity'(사용자 2026-11-17) */
let agyTag = 'Antigravity'
export const AGY_TAG = agyTag

/** 상태 줄의 작업 수: 0 이 아닌 종류만(둘 다 0 이면 Codex 0). ko 는 'Codex 1 · agy 1', en 은 수를 앞에 '1 Codex · 1 agy' */
const kinds = (nc: number, na: number) => [nc || !na ? `Codex ${nc}` : '', na ? `${AGY_TAG} ${na}` : ''].filter(Boolean).join(' · ')
const kindsEn = (nc: number, na: number) => [nc || !na ? `${nc} Codex` : '', na ? `${na} ${AGY_TAG}` : ''].filter(Boolean).join(' · ')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ko = {
  // 패널·명령
  title: '작업 진행판',
  opened: '작업 진행판을 열었어요.',
  descPanel: `작업 진행판(Codex·${AGY_TAG} 작업, Claude·Codex 사용량) 열기`,
  descClawd: '진행판의 Clawd 켜기·끄기',
  hintClawd: '[켜기|끄기]',
  descScene: '패널 아래 풍경: 끄기·작게·크게. 인자 없으면 고르기 창',
  hintScene: '[끄기|작게|크게]',
  descSkin: '테마 바꾸기. 인자 없으면 고르기 창',
  hintSkin: '[이름]',
  hintPanel: '[언어]',
  langUsage: '사용법: /status-panel · /status-panel 언어 [자동|영어|한국어]',
  /** 그 언어 화면에서 고른 값의 이름. 자동은 지금 정해진 언어(이 표의 언어)를 붙인다 */
  langName: (pref: LangPref): string => (pref === 'auto' ? '자동 (한국어)' : pref === 'ko' ? '한국어' : 'English'),
  langSet: (pref: LangPref): string => (pref === 'auto' ? '언어: 자동 (한국어)' : '언어: 한국어'),
  // 언어 고르기 창: 선택지 '자동'은 화면 언어로, 한국어·English 는 그 언어 그대로
  langAsk: (now: string) => `지금 ${now}. 화면 언어를 무엇으로 할까요?`,
  langHeader: '언어',
  langAuto: '자동',
  langKept: (now: string) => `언어 그대로: ${now}`,
  langNow: (now: string) => `언어: ${now} · /status-panel 언어 [자동|영어|한국어]`,
  // 시간
  durH: (h: number, m: number) => `${h}시간 ${m}분`,
  durM: (m: number) => `${m}분`,
  durS: (s: number) => `${s}초`,
  durD: (d: number, h: number, m: number) => `${d}일 ${h}시간 ${m}분`,
  soon: '곧',
  elapsed: (d: string) => `${d}째`,
  agoNone: '활동 기록 없음',
  agoNow: '방금 활동',
  ago: (d: string) => `${d} 전 활동`,
  weekdays: ['일', '월', '화', '수', '목', '금', '토'],
  date: (m: number, d: number, wd: string) => `${m}/${d} (${wd})`,
  /** 월·일만(리셋 시각·만료일·오늘이 아닌 시각 앞) */
  md: (m: number, d: number) => `${m}/${d}`,
  // 사용량
  winWeek: '주간',
  winD: (n: number) => `${n}일`,
  winH: (n: number) => `${n}시간`,
  winM: (n: number) => `${n}분`,
  claudeWin: { five_hour: '5시간', seven_day: '주간', spend_limit: '지출 한도' } as Record<string, string>,
  left: (p: number) => `${p}% 남음`,
  resetPre: (_past: boolean) => '    리셋까지 ',
  resetPast: '지금 리셋됐을 수 있어요',
  // 사용 속도(CodexBar 방식, 시안21 나안)
  paceOn: '정상 속도',
  paceReserve: (n: number) => `${n}% 여유`,
  paceDeficit: (n: number) => `${n}% 부족`,
  runsOut: (d: string) => `${d} 뒤 바닥`,
  resetIn: '리셋까지 ',
  durDH: (d: number, h: number) => (h ? `${d}일 ${h}시간` : `${d}일`),
  durHr: (h: number) => `${h}시간`,
  // 최근 7일(시안24 나안)
  weekHead: '최근 7일',
  weekTokens: (t: string) => ` · 토큰 ${t}`,
  weekPartial: ' (계산 중)',
  weekToday: '오늘 ',
  weekShort: ['일', '월', '화', '수', '목', '금', '토'],
  creditHead: (n: number) => `리셋권 ${n}장: `,
  creditCount: (n: number) => `리셋권 ${n}장`,
  creditUntitled: '리셋권',
  expiry: (md: string, left: string) => `${md} 만료 (${left})`,
  today: '하루 안',
  days: (n: number) => `${n}일`,
  reached: 'Codex 한도에 닿았어요',
  usageOld: (when: string) => `⚠ Codex 사용량 갱신 실패 · 마지막 ${when}`,
  usageBad: (err: string) => `Codex 사용량 못 읽음 · ${err}`,
  usageLoading: 'Codex 사용량 불러오는 중…',
  usageErr: {
    'server-exited': '서버가 응답 전에 끝남',
    timeout: '응답 없음(시간 초과)',
    'codex-not-found': 'codex 명령을 못 찾음',
    'no-usage': '사용량 정보가 응답에 없음',
  } as Record<string, string>,
  // Clawd 옆
  busy: '바쁨',
  free: '여유',
  // 숫자는 남은 메모리(사용량으로 읽히지 않게 '남음', 사용량 줄의 'N% 남음'과 같은 말). 옆 칸이 좁으면 짧은 쪽
  mem: (p: string) => `메모리 ${p}% 남음`,
  memShort: (p: string) => `램 ${p}% 남음`,
  load: (l: string, c: number) => `부하 ${l}/${c}`,
  battAlt: (p: number) => `배터리 ${p}%`,
  cap: {
    idle: '쉬는 중',
    think: '생각하는 중…',
    search: '찾는 중…',
    read: '읽는 중…',
    edit: '고치는 중…',
    work: '일하는 중…',
    cape: '작업자 기다리는 중…',
    happy: '다 했어요!',
    heart: '큰일을 끝냈어요!',
    coffee: '작업 기다리는 중…',
    bubble: '한가해요',
    kite: '한가해요',
    dizzy: '사용량이 바닥나요',
    ask: '대답 기다리는 중…',
    oops: '앗, 막혔어요',
    sleepy: '꾸벅꾸벅…',
  } as Record<ClawdAct, string>,
  swap: (u: number, t: number) => `스왑 ${u}/${t} GB · `,
  heavy: '무거운 작업은 잠깐 미뤄요',
  // 작업
  noJobs: '지금 도는 작업이 없어요',
  running: (n: number) => `실행 중 ${n}`,
  queued: (n: number) => `대기 ${n}`,
  quiet: ' · 오래 조용함',
  noLog: '   │ 로그 파일이 없어요 (화면으로만 출력하는 작업)',
  confirmStop: '한 번 더 누르면 중지돼요',
  cancel: '취소',
  stopJob: '■ 이 작업 중지',
  argonTty: `${AGY_TAG} 대화형`,
  done: '최근 끝남',
  doneStopped: ' · 중지함',
  doneNoReport: ' · 보고서 없음',
  more: (n: number) => `외 ${n}개 ▸`,
  moreFold: (n: number) => `외 ${n}개 · 접기 ▴`,
  fold: '접기 ▴',
  loading: '불러오는 중…',
  stale: (d: string, at: string) => `⚠ ${d}째 갱신이 멈췄어요 (마지막 ${at})`,
  // 0 인 종류는 빼고 적는다('Codex 0 · agy 1' 이 아니라 'agy 1')
  status: (nc: number, na: number, w: number) => `${kinds(nc, na)}개 실행 중${w ? ` · 대기 ${w}` : ''}`,
  // 토스트
  finToast: (tool: string, stopped: boolean, label: string, noReport: boolean) => `${tool} ${stopped ? '중지됨' : '끝'}: ${label}${noReport ? ' (보고서 없음)' : ''}`,
  alreadyDone: '이미 끝난 작업이에요',
  stopSent: (l: string) => `중지 요청을 보냈어요: ${l}`,
  stopFail: (e: string) => `중지하지 못했어요: ${e}`,
  // /clawd·/skin
  clawdUsage: '사용법: /clawd [켜기|끄기]',
  themeSet: (name: string) => `테마: ${name}`,
  themeNow: (name: string, list: string) => `지금 테마: ${name} · 고를 수 있는 것: ${list}`,
  themeUnknown: (name: string, list: string) => `없는 테마예요: ${name} · 고를 수 있는 것: ${list}`,
  themeBad: (name: string) => `테마 그림을 읽지 못했어요: ${name}`,
  // /skin 고르기 창: 질문은 물음표로 끝낸다($.ui.ask), 머리표는 12자 이하
  skinAsk: (name: string) => `지금 ${name}. 어떤 테마로 바꿀까요?`,
  skinHeader: '테마',
  skinKept: (name: string) => `테마 그대로: ${name}`,
  skinByName: ' · /skin <이름> 으로 골라요',
  // /scene: 패널 아래 풍경
  scene: { off: '끄기', small: '작게', full: '크게' } as Record<'off' | 'small' | 'full', string>,
  sceneSet: (v: string) => `풍경: ${v}`,
  sceneAsk: (v: string) => `지금 ${v}. 풍경을 어떻게 할까요?`,
  sceneHeader: '풍경',
  sceneKept: (v: string) => `풍경 그대로: ${v}`,
  sceneNow: (v: string) => `풍경: ${v} · /scene [끄기|작게|크게]`,
  sceneUsage: '사용법: /scene [끄기|작게|크게]',
  hiddenOff: ' (Clawd 와 풍경이 꺼져 있어 지금은 안 보여요)',
  paneClosed: ' (패널이 닫혀 있어 지금은 안 보여요)',
  clawdOn: 'Clawd 켰어요',
  clawdOff: 'Clawd 껐어요',
}

export type Strings = typeof ko

const en: Strings = {
  title: 'Status panel',
  opened: 'Opened the status panel.',
  descPanel: `Open the status panel (Codex and ${AGY_TAG} jobs, Claude and Codex usage)`,
  descClawd: 'Show or hide Clawd',
  hintClawd: '[on|off]',
  descScene: 'Scene at the bottom of the panel: off, small, full. No args opens a picker',
  hintScene: '[off|small|full]',
  descSkin: 'Change theme. No args opens a picker',
  hintSkin: '[name]',
  hintPanel: '[language]',
  langUsage: 'Usage: /status-panel · /status-panel language [auto|english|korean]',
  langName: (pref: LangPref) => (pref === 'auto' ? 'auto (English)' : pref === 'ko' ? '한국어' : 'English'),
  langSet: (pref: LangPref) => (pref === 'auto' ? 'Language: auto (English)' : 'Language: English'),
  langAsk: (now: string) => `Now ${now}. Which language?`,
  langHeader: 'Language',
  langAuto: 'Auto',
  langKept: (now: string) => `Language unchanged: ${now}`,
  langNow: (now: string) => `Language: ${now} · /status-panel language [auto|english|korean]`,
  durH: (h: number, m: number) => `${h}h ${m}m`,
  durM: (m: number) => `${m}m`,
  durS: (s: number) => `${s}s`,
  durD: (d: number, h: number, m: number) => `${d}d ${h}h ${m}m`,
  soon: 'under 1m',
  elapsed: (d: string) => `waiting ${d}`,
  agoNone: 'No log activity',
  agoNow: 'Active just now',
  ago: (d: string) => `Active ${d} ago`,
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  date: (m: number, d: number, wd: string) => `${wd} ${MONTHS[m - 1] ?? m} ${d}`,
  md: (m: number, d: number) => `${MONTHS[m - 1] ?? m} ${d}`,
  winWeek: '7d',
  winD: (n: number) => `${n}d`,
  winH: (n: number) => `${n}h`,
  winM: (n: number) => `${n}m`,
  claudeWin: { five_hour: '5h', seven_day: '7d', spend_limit: 'spend limit' },
  left: (p: number) => `${p}% left`,
  resetPre: (past: boolean) => (past ? '    ' : '    Resets in '),
  resetPast: 'May have reset',
  paceOn: 'On pace',
  paceReserve: (n: number) => `${n}% reserve`,
  paceDeficit: (n: number) => `${n}% deficit`,
  runsOut: (d: string) => `Runs out in ${d}`,
  resetIn: 'Resets in ',
  durDH: (d: number, h: number) => (h ? `${d}d ${h}h` : `${d}d`),
  durHr: (h: number) => `${h}h`,
  weekHead: 'Last 7 days',
  weekTokens: (t: string) => ` · ${t} tokens`,
  weekPartial: ' (counting…)',
  weekToday: 'today ',
  weekShort: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  creditHead: (n: number) => (n === 1 ? 'Reset credit: ' : 'Reset credits: '),
  creditCount: (n: number) => `${n} reset credit${n === 1 ? '' : 's'}`,
  creditUntitled: 'Reset credit',
  expiry: (md: string, left: string) => `exp ${md} (${left})`,
  today: '<1d',
  days: (n: number) => `${n}d`,
  reached: 'Codex limit reached',
  usageOld: (when: string) => `⚠ Codex usage not updated since ${when}`,
  usageBad: (err: string) => `Codex usage unavailable · ${err}`,
  usageLoading: 'Loading Codex usage…',
  usageErr: {
    'server-exited': 'server exited',
    timeout: 'timed out',
    'codex-not-found': 'codex not found',
    'no-usage': 'no usage data',
  },
  busy: 'Busy',
  free: 'OK',
  mem: (p: string) => `Mem ${p}% free`,
  memShort: (p: string) => `Mem ${p}% free`,
  load: (l: string, c: number) => `Load ${l}/${c}`,
  battAlt: (p: number) => `Battery ${p}%`,
  cap: {
    idle: 'Resting',
    think: 'Thinking…',
    search: 'Searching…',
    read: 'Reading…',
    edit: 'Editing…',
    work: 'Working…',
    cape: 'Waiting on subagents…',
    happy: 'All done!',
    heart: 'Long task done!',
    coffee: 'Waiting on jobs…',
    bubble: 'Idle',
    kite: 'Idle',
    dizzy: 'Near usage limit',
    ask: 'Waiting for you…',
    oops: 'Oops, that failed',
    sleepy: 'Dozing off…',
  },
  swap: (u: number, t: number) => `Swap ${u}/${t} GB · `,
  heavy: 'Hold off on heavy jobs',
  noJobs: 'No jobs running',
  running: (n: number) => `Running (${n})`,
  queued: (n: number) => `Queued (${n})`,
  quiet: ' · no output for 10+ min',
  noLog: '   │ No log file (terminal output only)',
  confirmStop: 'Press again to stop',
  cancel: 'Cancel',
  stopJob: '■ Stop job',
  argonTty: `${AGY_TAG} (interactive)`,
  done: 'Recently finished',
  doneStopped: ' · stopped',
  doneNoReport: ' · no output file',
  more: (n: number) => `Show ${n} more ▸`,
  moreFold: (n: number) => `${n} hidden · Show less ▴`,
  fold: 'Show less ▴',
  loading: 'Loading…',
  stale: (d: string, at: string) => `⚠ No updates for ${d} (since ${at})`,
  status: (nc: number, na: number, w: number) => `${kindsEn(nc, na)} running${w ? ` · ${w} queued` : ''}`,
  finToast: (tool: string, stopped: boolean, label: string, noReport: boolean) => `${tool} ${stopped ? 'stopped' : 'finished'}: ${label}${noReport ? ' (no output file)' : ''}`,
  alreadyDone: 'That job already finished',
  stopSent: (l: string) => `Stop requested: ${l}`,
  stopFail: (e: string) => `Couldn't stop: ${e}`,
  clawdUsage: 'Usage: /clawd [on|off]',
  themeSet: (name: string) => `Theme: ${name}`,
  themeNow: (name: string, list: string) => `Theme: ${name} · available: ${list}`,
  themeUnknown: (name: string, list: string) => `No theme named ${name} · available: ${list}`,
  themeBad: (name: string) => `Couldn't load the theme's pictures: ${name}`,
  skinAsk: (name: string) => `Now ${name}. Which theme?`,
  skinHeader: 'Theme',
  skinKept: (name: string) => `Theme unchanged: ${name}`,
  skinByName: ' · pick one with /skin <name>',
  scene: { off: 'Off', small: 'Small', full: 'Full' },
  sceneSet: (v: string) => `Scene: ${v}`,
  sceneAsk: (v: string) => `Now ${v}. Which scene size?`,
  sceneHeader: 'Scene',
  sceneKept: (v: string) => `Scene unchanged: ${v}`,
  sceneNow: (v: string) => `Scene: ${v} · /scene [off|small|full]`,
  sceneUsage: 'Usage: /scene [off|small|full]',
  hiddenOff: ' (hidden while Clawd and the scene are off)',
  paneClosed: ' (hidden while the panel is closed)',
  clawdOn: 'Clawd on',
  clawdOff: 'Clawd off',
}


export const STR: Record<Lang, Strings> = { ko, en }

/** 환경 변수 값들(LC_ALL → LC_MESSAGES → LANG 차례) 중 처음으로 비어 있지 않은 것이 ko 로 시작하면 한국어, 아니면 영어 */
export const langFromEnv = (vals: readonly (string | undefined | null)[]): Lang => {
  const v = vals.map(x => (x ?? '').trim()).find(x => x !== '')
  return v !== undefined && /^ko/i.test(v) ? 'ko' : 'en'
}

/** 저장값을 고르기로: 모르는 값은 자동 */
export const prefOf = (v: unknown): LangPref => (v === 'ko' || v === 'en' ? v : 'auto')

/** 명령 인자·고르기 창 답의 언어 값: auto|english|korean|en|ko 와 자동|영어|한국어(대소문자 무시). 모르면 null */
export const parseLangArg = (v: string): LangPref | null => {
  const s = v.trim().toLowerCase()
  return s === 'auto' || s === '자동' ? 'auto'
    : s === 'en' || s === 'english' || s === '영어' ? 'en'
      : s === 'ko' || s === 'korean' || s === '한국어' ? 'ko' : null
}
/** '/status-panel' 뒤 언어 인자: 'lang|language|언어 [값]'. 낱말이 아니면 null, 값이 없으면 value 가 '' */
export const parseLangCmd = (args: string): { value: string } | null => {
  const m = args.trim().match(/^(lang|language|언어)(?:\s+(\S+))?$/i)
  return m ? { value: m[2] ?? '' } : null
}
export type SceneSize = 'off' | 'small' | 'full'
/** '/scene' 인자·창 답: 끄기|꺼|off · 작게|small · 크게|full(대소문자 무시). 모르면 null */
export const parseScene = (v: string): SceneSize | null => {
  const s = v.trim().toLowerCase()
  return /^(끄기|꺼|off)$/.test(s) ? 'off' : /^(작게|small)$/.test(s) ? 'small' : /^(크게|full)$/.test(s) ? 'full' : null
}
/** 저장 두 칸(yard·bg) → 풍경 값. 끄기 = yard false, 작게 = yard true·bg false, 크게 = 둘 다 true */
export const sceneOf = (yard: boolean, bg: boolean): SceneSize => (!yard ? 'off' : bg ? 'full' : 'small')
export const sceneStore = (v: SceneSize) => ({ yard: v !== 'off', bg: v !== 'small' })
