import { expect, mock, test } from 'claude-code/testing'
import { AGY_TAG, ARGON_TTY, STR, langFromEnv, parseLangArg, parseLangCmd, prefOf } from '../hooks/i18n'
import { CAP, IMG_COLS, SIDE_TEXT_COLS, cellWidth } from '../hooks/clawd'
import { dateOf } from '../hooks/clock'

// 영어 화면: 언어 고르기(환경 변수·저장값), /status-panel lang 명령, 영어로 띄운 패널의 글자,
// 언어를 바꿔도 그림을 다시 보내지 않는지, 영어 패널에 한글이 없는지. 실행: claude plugin test .

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/
// 글자 그대로 찾기(괄호 등을 정규식 글자로 바꾼다)
const reEsc = (t: string) => t.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&')
const exact = (t: string) => new RegExp('^' + reEsc(t) + '$')
// 영어 날짜: 'Mon Nov 16', 월·일만은 'Nov 16'
const EN_DATE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+$/
const EN_MD = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d+'
const NOW = Math.floor(Date.now() / 1000)
const iso = (s: number) => new Date(s * 1000).toISOString()
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4WR7+HwAGewKnNtauMAAAAABJRU5ErkJggg=='
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mMQERH+DwABtgE75dHkOwAAAABJRU5ErkJggg=='
const SPRITES = {
  canvas: [38, 32], ground: 30, box: [19, 8], pngSize: [456, 384], palette: { a: '#D97757' },
  frames: Array.from({ length: 40 }, (_, i) => Array.from({ length: 32 }, (_, y) => (y === 5 ? '.'.repeat(i % 38) + 'a' + '.'.repeat(37 - (i % 38)) : '.'.repeat(38)))),
  states: Object.fromEntries(Object.keys(CAP).map((k, i) => [k, { label: k, ms: 200, seq: [i, i + 1] }])),
  png: { plain: Array.from({ length: 40 }, (_, i) => (i % 2 ? PNG_B : PNG_A)), sticker: Array.from({ length: 40 }, () => PNG_A) },
}
const JOB = { pid: 111, tool: 'codex', label: 'Data round 2', project: 'x', model: 'gpt-6.1-sol', effort: 'high', elapsed: 720, rssMB: 100, idle: 200, last: 'tidying table', tail: ['a', 'b'], out: '/tmp/none.md' }
const TTY = { pid: 222, tool: 'argon', label: ARGON_TTY, project: '', model: '', effort: '', elapsed: 180, rssMB: 50, idle: null, last: '', tail: [], out: '' }
const SNAP = { at: NOW, jobs: [] as unknown[], waiting: [] as unknown[], mem: { freePct: 58, swapUsedGB: 0.4, swapTotalGB: 2, load: 4.3, cpus: 10 } }
const USAGE = { at: NOW, windows: [{ usedPct: 31, mins: 10080, resetsAt: NOW + 2 * 86400 + 9 * 3600 + 30 * 60 + 20 }], reached: null, plan: 'pro', resetCredits: 1, credits: [{ title: 'Full reset', expiresAt: NOW + 27 * 86400 + 3600 }] }
// 리셋 시각은 엔진이 사용량을 물을 때의 시각에서 잰다: 파일을 불러온 때(NOW)에서 재면, 시험이 여럿 같이 돌아 몇 초 늦게 그려질 때
// 사용 속도(5시간 창 18.2% 사용, 리셋까지 7800초 → 38.5% 경계 근처)가 38% 에서 39% 로 넘어간다(약 5.4초)
const RATE_AT = (t: number) => [{ kind: 'five_hour', percentUsed: 18.2, resetsAt: iso(t + 7800) }, { kind: 'seven_day', percentUsed: 39, resetsAt: iso(t + 3 * 86400) }]
const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t69%; discharging; 4:28 remaining present: true\n"

type Ask = { question: string; header?: string; options: string[] }
// 고르기 창의 결과: 고른 글자(answer, null 이면 빈 answers = 닫음) · tool.call 의 거절(deny) · 도구 오류(isError)
type AskReply = { answer: string | null } | { deny: string } | { isError: string }
type Calls = { ask?: (q: Ask) => AskReply; asks: Ask[]; rate?: unknown; toasts: string[]; store: Record<string, unknown>; snap: typeof SNAP; usage?: unknown; registered: { name: string; description: string; argumentHint?: string }[]; images: string[]; status: (string | undefined)[]; opens: { title?: string }[] }
const engine = (on: any, env: Record<string, string>, o: { clock?: boolean; store?: Record<string, unknown> } = {}) => {
  const calls: Calls = { asks: [], toasts: [], store: { ...o.store }, snap: SNAP, registered: [], images: [], status: [], opens: [] }
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: Calls['registered'][number]) => { calls.registered.push(e); return { value: { command: e.name } } })
  on('ui.open', (_: unknown, e: { title?: string }) => { calls.opens.push(e); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [{ id: 'status-panel', title: '', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(calls.snap))
    if (a.includes('codex_usage.py')) return run(JSON.stringify(calls.usage ?? USAGE))
    if (e.argv[0] === 'pmset') return run(BATT)
    return run('', 1)
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name in env ? env[e.name] : e.name === 'HOME' ? '/Users/someone' : undefined }))
  if (!o.clock) { on('clock.every', () => ({ value: undefined })); on('clock.now', () => ({ value: Date.now() })) }
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: calls.rate ?? RATE_AT(Math.floor(Date.now() / 1000)) } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: JSON.stringify(SPRITES) }))
  on('agent.list', () => ({ value: [] }))
  // $.ui.ask 는 AskUserQuestion 도구 호출로 온다(theme.test.tsx 와 같은 흉내). 실패는 throw 가 아니라 엔진처럼 { deny }·{ isError } 로 돌려준다
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: {} }
    const q0 = e.questions[0], q: Ask = { question: q0.question, header: q0.header, options: q0.options.map((o: { label: string }) => o.label) }
    calls.asks.push(q)
    const r = calls.ask ? calls.ask(q) : { answer: null }
    if ('deny' in r) return { deny: r.deny }
    if ('isError' in r) return { isError: true, result: undefined, text: r.isError }
    return { result: { questions: e.questions, answers: r.answer === null ? {} : { [q.question]: r.answer } } }
  })
  on('ui.blit', (_: unknown, e: { key: string; cells?: string }) => { if (!e.cells) calls.images.push(e.key); return { value: {} } })
  on('ui.toast', (_: unknown, e: { text: string }) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_: unknown, e: { text?: string }) => { calls.status.push(e.text); return { value: undefined } })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: calls.store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { calls.store[e.key] = e.value; return { value: undefined } })
  return calls
}
const PANE = (bodyColumns = 44) => ({
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel',
  props: { title: 'Status panel', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const)
const VIEW = { columns: 120, rows: 60, isFullscreen: true }
const wait = () => new Promise<void>(r => (globalThis as any).setTimeout(r, 25))
// session.start 가 기다리지 않고 띄운 읽기(작업·사용량·그림 자료)가 끝날 때까지 다시 그려 본다
const mounted = async ($: any, ready: RegExp, surface: 'terminal' | 'desktop' = 'terminal') => {
  for (let i = 0; i < 60; i++) {
    const ui = await $.ui.mount({ ...PANE(), surface, ...(surface === 'terminal' ? { viewport: VIEW } : {}) })
    const ok = (await ui.find({ type: 'Text', text: ready })) && (await ui.find({ type: 'Text', text: /Claude/ })) &&
      (surface !== 'terminal' || (await ui.find({ type: 'Image', key: 'clawd' })))
    if (ok) return ui
    await ui.unmount()
    await wait()
  }
  throw new Error('패널이 다 그려지지 않았어요')
}
const slash = ($: any, args: string) => $.command.run({ command: 'status-panel', args })
const KO_ENV = { LANG: 'ko_KR.UTF-8' }
const EN_ENV = { LANG: 'en_US.UTF-8' }

// 객체의 키를 깊이까지 모은다(함수·글자는 끝)
const keysOf = (o: unknown, pre = ''): string[] =>
  o && typeof o === 'object' && !Array.isArray(o)
    ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => [pre + k, ...keysOf(v, `${pre}${k}.`)])
    : []

test('en 표에 ko 의 키가 다 있고, 함수는 같은 인자 수다', () => {
  const ko = STR.ko as Record<string, unknown>, en = STR.en as Record<string, unknown>
  expect(keysOf(en).sort()).toEqual(keysOf(ko).sort())
  for (const k of Object.keys(ko)) {
    expect(typeof en[k]).toBe(typeof ko[k])
    if (typeof ko[k] === 'function') expect((en[k] as Function).length).toBe((ko[k] as Function).length)
  }
  expect(STR.en.weekdays).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  // 한국어 표는 원래 글자 그대로(일부 표본)
  expect(STR.ko.title).toBe('작업 진행판')
  expect(STR.ko.cap.idle).toBe(CAP.idle.text)
  expect(dateOf(new Date(2026, 10, 16, 9, 5))).toBe('11/16 (월)')
  expect(dateOf(new Date(2026, 10, 16, 9, 5), 'en')).toBe('Mon Nov 16')
  expect(dateOf(new Date(2026, 0, 4, 9, 5), 'en')).toBe('Sun Jan 4')
  expect(STR.en.md(12, 13)).toBe('Dec 13')
  expect(STR.ko.md(12, 13)).toBe('12/13')
})

test('영어 글자는 놓일 자리(Clawd 옆 12칸 이상·가장 좁은 패널 30칸)에 들어가고, 표의 영어에는 한글이 없다', () => {
  // 대부분은 한국어보다 넓지 않다. 'Searching…'·'Waiting on subagents…'·'Oops, that failed'·'Dozing off…' 는 더 넓어서 아래에서 실제 자리로 잰다
  const wider = new Set(['search', 'cape', 'oops', 'sleepy'])
  for (const act of Object.keys(CAP) as (keyof typeof CAP)[])
    if (!wider.has(act)) expect([act, cellWidth(STR.en.cap[act]) <= cellWidth(STR.ko.cap[act])]).toEqual([act, true])
  // 설명 줄(돌아가는 표시 + 한 칸 + 글자)은 기본 폭(44칸)의 옆 칸(44 - 그림 19 - 1 = 24칸) 안. 그보다 좁으면 두 언어 다 … 로 잘린다
  const side44 = 44 - IMG_COLS - 1
  for (const lang of ['ko', 'en'] as const) for (const act of Object.keys(CAP) as (keyof typeof CAP)[])
    expect([lang, act, 2 + cellWidth(STR[lang].cap[act]) <= side44]).toEqual([lang, act, true])
  expect(2 + cellWidth(STR.en.cap.search)).toBeLessThanOrEqual(SIDE_TEXT_COLS) // 가장 좁은 옆 칸(12칸)에도
  // 글자가 같은 동작끼리는 영어도 같다(설명 글자는 한국어 글자가 바뀔 때만 다시 그린다)
  expect(STR.en.cap.kite).toBe(STR.en.cap.bubble)
  expect(cellWidth(STR.en.busy)).toBeLessThanOrEqual(cellWidth(STR.ko.busy))
  expect(cellWidth(STR.en.free)).toBeLessThanOrEqual(cellWidth(STR.ko.free))
  // 메모리·부하 줄: 영어 'Mem 58% free' 는 가장 좁은 옆 칸(12칸)에 한 줄씩 들어간다(빈 메모리 99% 까지.
  // 100% 는 실제로 거의 안 나오고, 나오면 32칸 패널에서만 한 칸 잘린다).
  // 한국어 '메모리 58% 남음'(15칸)은 12칸에 안 들어가 그때는 짧은 쪽 '램 58% 남음'(100% 까지 12칸)
  for (const p of ['5', '58', '99', '?']) expect(cellWidth(STR.en.mem(p))).toBeLessThanOrEqual(SIDE_TEXT_COLS)
  for (const p of ['5', '58', '99', '?']) expect(cellWidth(STR.en.memShort(p))).toBeLessThanOrEqual(SIDE_TEXT_COLS)
  for (const p of ['5', '58', '100', '?']) expect(cellWidth(STR.ko.memShort(p))).toBeLessThanOrEqual(SIDE_TEXT_COLS)
  expect(STR.ko.mem('58')).toBe('메모리 58% 남음')
  expect(cellWidth(STR.ko.mem('58'))).toBeGreaterThan(SIDE_TEXT_COLS)
  expect(cellWidth(STR.en.load('12.3', 10))).toBeLessThanOrEqual(SIDE_TEXT_COLS)
  expect(cellWidth(STR.en.load('12.3', 10))).toBeLessThanOrEqual(cellWidth(STR.ko.load('12.3', 10)))
  for (let wd = 0; wd < 7; wd++) expect(cellWidth(STR.en.date(12, 31, STR.en.weekdays[wd]!))).toBeLessThanOrEqual(cellWidth(STR.ko.date(12, 31, STR.ko.weekdays[wd]!)))
  // 잘라 내지 않는(wrap 없는) 긴 줄도 한국어보다 넓지 않다
  for (const k of ['noLog', 'confirmStop', 'stopJob', 'reached', 'noJobs'] as const)
    expect(cellWidth(STR.en[k] as string)).toBeLessThanOrEqual(cellWidth(STR.ko[k] as string))
  // 최근 끝남의 펼치기·접기 단추('   ' + 글자, 잘리지 않음)는 가장 좁은 패널(30칸)에 들어간다. 최근 끝남은 8개까지
  for (const lang of ['ko', 'en'] as const) {
    const S = STR[lang]
    for (let n = 1; n <= 8; n++) for (const t of [S.more(n), S.moreFold(n)]) expect([t, 3 + cellWidth(t) <= 30]).toEqual([t, true])
    expect(3 + cellWidth(S.fold)).toBeLessThanOrEqual(30)
  }
  // 중지 확인 줄(확인 · 취소)은 한 줄 전체로 잰다
  expect(cellWidth(STR.en.confirmStop + ' · ' + STR.en.cancel)).toBeLessThanOrEqual(cellWidth(STR.ko.confirmStop + ' · ' + STR.ko.cancel))
  // 영어 표의 글자에 한글이 없다
  const words: string[] = []
  const walk = (v: unknown, k: string) => {
    if (typeof v === 'string') words.push(v)
    else if (typeof v === 'function') words.push(String((v as (...a: unknown[]) => unknown)(1, 2, 3, 4)), String((v as (...a: unknown[]) => unknown)(true, true, 'x', true)), String((v as (...a: unknown[]) => unknown)('auto')), String((v as (...a: unknown[]) => unknown)(0, 0, 0)))
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk)
  }
  walk(STR.en, '')
  expect(words.filter(w => HANGUL.test(w))).toEqual([])
})

test('언어 고르기: LC_ALL → LC_MESSAGES → LANG 중 처음 비어 있지 않은 값, 저장값', () => {
  expect(langFromEnv([undefined, undefined, 'ko_KR.UTF-8'])).toBe('ko')
  expect(langFromEnv([undefined, undefined, 'en_US.UTF-8'])).toBe('en')
  expect(langFromEnv(['en_US.UTF-8', undefined, 'ko_KR.UTF-8'])).toBe('en')
  expect(langFromEnv(['', 'ko_KR.UTF-8', 'en_US.UTF-8'])).toBe('ko')
  expect(langFromEnv(['  ', 'C', 'ko_KR.UTF-8'])).toBe('en')
  expect(langFromEnv([undefined, undefined, undefined])).toBe('en')
  expect(prefOf('ko')).toBe('ko'); expect(prefOf('en')).toBe('en'); expect(prefOf(undefined)).toBe('auto'); expect(prefOf('fr')).toBe('auto')
  expect(parseLangArg('EN')).toBe('en'); expect(parseLangArg('한국어')).toBe('ko'); expect(parseLangArg('자동')).toBe('auto'); expect(parseLangArg('영어')).toBe('en')
  expect(parseLangArg('fr')).toBeNull()
  // 풀어 쓴 영어 값도(대소문자 무시)
  expect(parseLangArg('English')).toBe('en'); expect(parseLangArg('KOREAN')).toBe('ko'); expect(parseLangArg('Auto')).toBe('auto')
  // 인자 낱말: language·lang·언어, 값은 없어도 된다
  expect(parseLangCmd('language english')).toEqual({ value: 'english' })
  expect(parseLangCmd('LANG')).toEqual({ value: '' })
  expect(parseLangCmd('언어 한국어')).toEqual({ value: '한국어' })
  expect(parseLangCmd('languages en')).toBeNull()
  expect(parseLangCmd('lang en ko')).toBeNull()
})

test('환경 변수가 영어면 영어로 띄우고 명령 설명도 영어로 등록한다', async ($, on) => {
  const calls = engine(on, EN_ENV)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(calls.registered.find(c => c.name === 'status-panel')?.description).toBe(STR.en.descPanel)
  expect(calls.registered.find(c => c.name === 'clawd')?.argumentHint).toBe('[on|off]')
  expect(calls.registered.find(c => c.name === 'scene')).toMatchObject({ description: STR.en.descScene, argumentHint: '[off|small|full]' })
  expect(calls.registered.find(c => c.name === 'status-panel')?.argumentHint).toBe('[language]')
  expect(calls.registered.find(c => c.name === 'skin')).toMatchObject({ description: STR.en.descSkin, argumentHint: '[name]' })
  expect(calls.opens[0]?.title).toBe('Status panel')
  const ui = await mounted($, /Codex 7d/, 'desktop')
  expect(await ui.find({ type: 'Text', text: /^No jobs running$/ })).toBeDefined()
  await ui.unmount()
})

test('LC_ALL 이 LANG 보다 먼저이고, 저장값이 환경 변수보다 먼저다', async ($, on) => {
  const calls = engine(on, { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(calls.registered.find(c => c.name === 'status-panel')?.description).toBe(STR.ko.descPanel)
  await (await mounted($, /Codex 주간/, 'desktop')).unmount() // 띄워 둔 읽기가 끝날 때까지
})
test('저장값 en 이면 한국어 환경에서도 영어', async ($, on) => {
  const calls = engine(on, KO_ENV, { store: { lang: 'en' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(calls.registered.find(c => c.name === 'clawd')?.description).toBe(STR.en.descClawd)
  const ui = await mounted($, /Codex 7d/, 'desktop')
  expect(await ui.find({ type: 'Text', text: /^No jobs running$/ })).toBeDefined()
  await ui.unmount()
})

test('/status-panel lang·언어: 바꾼 언어로 답하고 저장하며, 잘못된 인자에는 사용법', async ($, on) => {
  const calls = engine(on, KO_ENV)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await slash($, '')).text).toBe('작업 진행판을 열었어요.')
  expect((await slash($, 'lang en')).text).toBe('Language: English')
  expect(calls.store.lang).toBe('en')
  expect((await slash($, '')).text).toBe('Opened the status panel.')
  expect((await slash($, 'lang fr')).text).toBe(STR.en.langUsage)
  expect((await slash($, 'lang ko')).text).toBe('언어: 한국어')
  expect(calls.store.lang).toBe('ko')
  expect((await slash($, '언어 영어')).text).toBe('Language: English')
  expect((await slash($, '언어 한국어')).text).toBe('언어: 한국어')
  expect((await slash($, '언어 몰라')).text).toBe(STR.ko.langUsage)
  // 자동은 환경 변수(LANG=ko_KR)대로
  expect((await slash($, '언어 자동')).text).toBe('언어: 자동 (한국어)')
  expect(calls.store.lang).toBe('auto')
  expect((await slash($, 'lang auto')).text).toBe('언어: 자동 (한국어)')
  // 인자 낱말 language, 풀어 쓴 값, 대소문자 무시
  expect((await slash($, 'language english')).text).toBe('Language: English')
  expect(calls.store.lang).toBe('en')
  expect((await slash($, 'LANGUAGE Korean')).text).toBe('언어: 한국어')
  expect(calls.store.lang).toBe('ko')
  expect((await slash($, 'Language AUTO')).text).toBe('언어: 자동 (한국어)')
  expect(calls.store.lang).toBe('auto')
  expect((await slash($, 'language KO')).text).toBe('언어: 한국어')
  expect((await slash($, '언어 English')).text).toBe('Language: English')
  expect((await slash($, 'language klingon')).text).toBe(STR.en.langUsage)
  expect(STR.en.langUsage).toBe('Usage: /status-panel · /status-panel language [auto|english|korean]')
  expect(STR.ko.langUsage).toContain('/status-panel 언어 [자동|영어|한국어]')
  expect(calls.asks).toHaveLength(0) // 값을 붙이면 창을 띄우지 않는다
  await (await mounted($, /Codex 7d/, 'desktop')).unmount()
})

test('/status-panel language|lang|언어 만 치면 고르기 창: 지금 값·선택지·머리표, 고르면 저장·적용', async ($, on) => {
  const calls = engine(on, KO_ENV)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  calls.ask = () => ({ answer: 'English' })
  expect((await slash($, '언어')).text).toBe('Language: English')
  expect(calls.asks.at(-1)).toEqual({ question: STR.ko.langAsk(STR.ko.langName('auto')), header: '언어', options: ['자동', '한국어', 'English'] })
  expect(calls.asks.at(-1)!.question).toBe('지금 자동 (한국어). 화면 언어를 무엇으로 할까요?')
  expect(calls.store.lang).toBe('en')
  // 영어 화면: 선택지 '자동'은 영어로, 한국어·English 는 그 언어 그대로
  calls.ask = () => ({ answer: '한국어' })
  expect((await slash($, 'language')).text).toBe('언어: 한국어')
  expect(calls.asks.at(-1)).toEqual({ question: STR.en.langAsk('English'), header: 'Language', options: ['Auto', '한국어', 'English'] })
  expect(calls.store.lang).toBe('ko')
  calls.ask = () => ({ answer: '자동' })
  expect((await slash($, 'LANG')).text).toBe('언어: 자동 (한국어)')
  expect(calls.asks.at(-1)!.question).toBe(STR.ko.langAsk('한국어'))
  expect(calls.store.lang).toBe('auto')
  // Other 로 친 글자도 값으로(대소문자 무시), 모르는 글자면 사용법
  calls.ask = () => ({ answer: 'english' })
  expect((await slash($, 'lang')).text).toBe('Language: English')
  calls.ask = () => ({ answer: 'klingon' })
  expect((await slash($, 'lang')).text).toBe(STR.en.langUsage)
  expect(calls.store.lang).toBe('en')
  expect(calls.asks).toHaveLength(5)
  await (await mounted($, /Codex 7d/, 'desktop')).unmount()
})

test('언어 고르기 창: 닫으면·빈 답이면 그대로, 창을 못 띄우면 지금 값과 쓰는 법, 어느 쪽도 앗이 되지 않는다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 18, 14, 0, 0).getTime() })
  const calls = engine(on, KO_ENV, { clock: true, store: { lang: 'ko' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const kept = STR.ko.langKept('한국어'), now = STR.ko.langNow('한국어')
  const cases: [AskReply, string][] = [
    [{ answer: null }, kept], // 빈 answers: 'no answer (the dialog was dismissed)'
    [{ isError: 'User declined to answer questions' }, kept],
    [{ deny: "The user doesn't want to proceed with this tool use." }, kept],
    [{ answer: '   ' }, kept],
    [{ deny: 'no one to ask' }, now], // 비대화형: 창을 못 띄움
    [{ deny: 'rejected by rule' }, now],
    [{ isError: 'tool failed' }, now],
  ]
  for (const [reply, want] of cases) {
    calls.ask = () => reply
    expect([JSON.stringify(reply), (await slash($, '언어')).text]).toEqual([JSON.stringify(reply), want])
    expect(calls.store.lang).toBe('ko') // 아무것도 바뀌지 않는다
  }
  expect(calls.asks).toHaveLength(cases.length) // 헛돌지 않는지: 매번 창을 띄우려 했다
  expect(now).toBe('언어: 한국어 · /status-panel 언어 [자동|영어|한국어]')
  // 거절·실패로 끝난 창(이 플러그인이 띄운 것)은 Clawd 를 '앗, 막혔어요'로 바꾸지 않는다
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: exact(STR.ko.cap.oops) })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: exact(STR.ko.cap.idle) })).toBeDefined()
  await ui.unmount()
})

test('영어 화면: 언어 창을 닫으면 영어로 그대로, 못 띄우면 language 를 앞세운 안내', async ($, on) => {
  const calls = engine(on, EN_ENV)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  calls.ask = () => ({ answer: null })
  expect((await slash($, 'language')).text).toBe('Language unchanged: auto (English)')
  calls.ask = () => ({ deny: 'no one to ask' })
  expect((await slash($, 'language')).text).toBe('Language: auto (English) · /status-panel language [auto|english|korean]')
  expect(calls.store.lang).toBeUndefined()
  await (await mounted($, /Codex 7d/, 'desktop')).unmount()
})
test('영어 환경에서 lang auto 는 영어로 답한다', async ($, on) => {
  engine(on, EN_ENV, { store: { lang: 'ko' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await slash($, '')).text).toBe('작업 진행판을 열었어요.')
  expect((await slash($, 'lang auto')).text).toBe('Language: auto (English)')
  await (await mounted($, /Codex 7d/, 'desktop')).unmount()
})


test('영어 패널: 사용량 줄·리셋 남은 시간·리셋권·Clawd 상태·작업·최근 끝남, 트리에 한글이 없다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls = engine(on, EN_ENV, { clock: true })
  calls.snap = { ...SNAP, jobs: [JOB, TTY], waiting: [{ pid: 9, labels: ['next job'], elapsed: 45 }] }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  let ui = await $.ui.mount({ ...PANE(), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  expect((await ui.find({ type: 'Text', text: /Claude 5h/ }))?.text).toMatch(/82% left · 38% reserve$/)
  expect((await ui.find({ type: 'Text', text: /Claude 7d/ }))?.text).toMatch(/61% left · 18% reserve$/)
  expect((await ui.find({ type: 'Text', text: /Codex 7d/ }))?.text).toMatch(/69% left · 35% reserve$/)
  expect(await ui.findAll({ type: 'Text', text: /^\s+Resets in $/ })).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: new RegExp(`^\\s+Resets in 2d 9h 30m \\(${EN_MD} \\d\\d:\\d\\d\\)$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(`^\\s+Resets in 2h (9|10)m \\((${EN_MD} )?\\d\\d:\\d\\d\\)$`) })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Reset credit: / }))?.text).toMatch(new RegExp(`^  Reset credit: Full reset · exp ${EN_MD} \\(27d\\)$`))
  expect(await ui.find({ type: 'Text', text: /^Busy$/ })).toBeDefined()
  // 'Mem 58% free · Load 4.3/10'(26칸)은 44칸 패널의 옆 칸(24칸)보다 넓어 두 줄로 나뉜다(Clawd 높이 안이라 줄 수는 같다)
  expect(await ui.find({ type: 'Text', text: /^Mem 58% free$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Load 4\.3\/10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Running \(2\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Queued \(1\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+Active 3m ago · tidying table$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact(STR.en.argonTty) })).toBeDefined()
  // 작업 첫 줄은 단추 안의 한 줄: 이름 · 꼬리표 · 모델 · 걸린 시간 · 프로젝트
  expect((await ui.find({ key: 'job-111' }))?.text).toBe('Data round 2  Codex 6.1-sol·high · 12m · x')
  expect((await ui.find({ key: 'job-222' }))?.text).toBe(`${STR.en.argonTty}  ${AGY_TAG} 3m`)
  expect(await ui.find({ type: 'Text', text: /^ · waiting 45s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: EN_DATE })).toBeDefined()
  expect((await ui.find({ type: 'Image', key: 'batt' }))?.props.alt).toBe('Battery 69%')
  expect(HANGUL.test(JSON.stringify(await ui.drawn()))).toBe(false)
  // 펼친 로그 줄, 중지 단추도 영어. 손으로 띄운 대화형 agy 는 로그만 펼치고 중지 단추가 없다
  await ui.press({ key: 'job-222' })
  expect(await ui.find({ type: 'Text', text: /No log file/ })).toBeDefined()
  expect(await ui.find({ key: 'stop-222' })).toBeUndefined()
  await ui.press({ key: 'job-111' })
  await ui.press({ key: 'stop-111' })
  expect((await ui.find({ key: 'kill-111' }))?.text).toBe('Press again to stop')
  expect(HANGUL.test(JSON.stringify(await ui.drawn()))).toBe(false)
  await ui.unmount()

  // 다음 갱신에 둘 다 끝났다: 최근 끝남과 토스트·상태 줄
  calls.snap = { ...SNAP, at: NOW + 5, jobs: [], waiting: [] }
  await clock.advance(5000)
  ui = await $.ui.mount({ ...PANE(), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^Recently finished$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact(` ${STR.en.argonTty}`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · \d\d:\d\d · 12m · no output file$/ })).toBeDefined()
  // 보고 파일을 받기로 하지 않은 작업(out 없음)에는 '보고서 없음'을 붙이지 않는다
  expect(await ui.find({ type: 'Text', text: /^ · \d\d:\d\d · 3m$/ })).toBeDefined()
  expect(calls.toasts).toContain('Codex finished: Data round 2 (no output file)')
  expect(calls.toasts).toContain(`${AGY_TAG} finished: ${STR.en.argonTty}`)
  expect(await ui.find({ type: 'Text', text: /^No jobs running$/ })).toBeDefined()
  expect(calls.status).toContain(`1 Codex · 1 ${AGY_TAG} running · 1 queued`)
  expect(HANGUL.test(JSON.stringify(await ui.drawn()))).toBe(false)
  await ui.unmount()
})

test('영어 사용 속도: On pace · N% deficit, 부족이면 Runs out in … · Resets in …(분 빼고), 46칸 안', { timeoutMs: 15000 }, async ($, on) => {
  const calls = engine(on, EN_ENV)
  calls.rate = [{ kind: 'five_hour', percentUsed: 50, resetsAt: iso(NOW + 9000) }, { kind: 'seven_day', percentUsed: 70, resetsAt: iso(NOW + 3 * 86400 + 1800) }]
  // Codex 5시간 창: 3시간 59분 남음(약 20% 지남)에 30% 씀 → 10% deficit, 바닥은 약 2시간 22분 뒤.
  // 리셋을 정각 4시간에서 1분 당겨 둔다: NOW 는 초 단위이고 화면은 그 뒤의 Date.now() 로 재서, 같은 초 안에 그려지면 'Resets in 4h' 가 되어 가끔 깨졌다
  calls.usage = { ...USAGE, windows: [{ usedPct: 30, mins: 300, resetsAt: NOW + 4 * 3600 - 60 }] }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, /Codex 5h/)
  expect((await ui.find({ type: 'Text', text: /Claude 5h/ }))?.text).toMatch(/50% left · On pace$/)
  expect((await ui.find({ type: 'Text', text: /Claude 7d/ }))?.text).toMatch(/30% left · 13% deficit$/)
  expect((await ui.find({ type: 'Text', text: /Codex 5h/ }))?.text).toMatch(/70% left · 10% deficit$/)
  expect(await ui.find({ type: 'Text', text: /^\s+Runs out in 1d 16h · Resets in 3d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+Runs out in 2h · Resets in 3h$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^\s+Resets in $/ })).toHaveLength(1)
  // 그려진 사용량 줄은 모두 46칸 안
  const rows = (await ui.findAll({ type: 'Text', text: /^\s+(Claude|Codex) |^\s+Runs out in / })).map((t: { text?: string }) => t.text ?? '')
  expect(rows.length).toBeGreaterThanOrEqual(5)
  for (const r of rows) expect([r, cellWidth(r) <= 46]).toEqual([r, true])
  expect(HANGUL.test(JSON.stringify(await ui.drawn()))).toBe(false)
  await ui.unmount()
})

test('Codex 사용량 오류 코드는 그 언어의 글자로', async ($, on) => {
  const calls = engine(on, EN_ENV)
  calls.usage = { at: NOW, error: 'timeout' }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, /Codex usage unavailable/, 'desktop')
  expect((await ui.find({ type: 'Text', text: /Codex usage unavailable/ }))?.text).toBe('  Codex usage unavailable · timed out')
  expect((await slash($, '언어 한국어')).text).toBe('언어: 한국어')
  expect((await ui.find({ type: 'Text', text: /Codex 사용량/ }))?.text).toBe('  Codex 사용량 못 읽음 · 응답 없음(시간 초과)')
  await ui.unmount()
})

test('언어를 바꾸면 명령 설명도 그 언어로 다시 등록하고, /status-panel 에 인자 안내가 있다', async ($, on) => {
  const calls = engine(on, KO_ENV)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const last = (name: string) => calls.registered.filter(c => c.name === name).at(-1)
  expect(last('status-panel')).toMatchObject({ description: STR.ko.descPanel, argumentHint: STR.ko.hintPanel })
  expect((await slash($, 'lang en')).text).toBe('Language: English')
  expect(last('status-panel')).toMatchObject({ description: STR.en.descPanel, argumentHint: '[language]' })
  expect(last('clawd')).toMatchObject({ description: STR.en.descClawd, argumentHint: '[on|off]' })
  expect(last('skin')).toMatchObject({ description: STR.en.descSkin, argumentHint: STR.en.hintSkin })
  expect(last('scene')).toMatchObject({ description: STR.en.descScene, argumentHint: '[off|small|full]' })
  expect((await slash($, '언어 한국어')).text).toBe('언어: 한국어')
  expect(last('status-panel')?.argumentHint).toBe('[언어]')
  expect(last('clawd')).toMatchObject({ description: STR.ko.descClawd, argumentHint: '[켜기|끄기]' })
  expect(last('scene')).toMatchObject({ description: STR.ko.descScene, argumentHint: '[끄기|작게|크게]' })
  expect(last('skin')).toMatchObject({ description: STR.ko.descSkin, argumentHint: STR.ko.hintSkin })
  await (await mounted($, /Codex 주간/, 'desktop')).unmount()
})

test('리셋권이 여럿이면 둘째 장부터 머리 폭만큼 띄워 이름을 맞춘다(두 언어)', async ($, on) => {
  const calls = engine(on, EN_ENV)
  calls.usage = { ...USAGE, resetCredits: 2, credits: [{ title: 'Alpha', expiresAt: NOW + 27 * 86400 }, { title: 'Beta', expiresAt: NOW + 28 * 86400 }] }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, /Reset credits: /, 'desktop')
  const col = async (t: RegExp, w: string) => { const x = (await ui.find({ type: 'Text', text: t }))?.text ?? ''; return cellWidth(x.slice(0, x.indexOf(w))) }
  expect(await col(/^\s+Beta · /, 'Beta')).toBe(await col(/Reset credits: Alpha/, 'Alpha'))
  expect((await slash($, '언어 한국어')).text).toBe('언어: 한국어')
  await ui.drawn()
  expect(await col(/^\s+Beta · /, 'Beta')).toBe(await col(/리셋권 2장: Alpha/, 'Alpha'))
  await ui.unmount()
})

test('언어를 바꾸면 글자만 바뀌고 그림(시계·배터리·Clawd·놀이터)은 다시 보내지 않는다', { timeoutMs: 15000 }, async ($, on) => {
  // 가짜 시계를 세워 두어 틱(움직임 blit)이 돌지 않게 한다: 이 사이의 blit 은 모두 언어 바꾸기 탓이다
  const clock = mock.clock(on, { now: Date.now() })
  const calls = engine(on, KO_ENV, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await mounted($, /Codex 주간/)
  await ui.drawn()
  const images = async () => (await ui.findAll({ type: 'Image' })).map((n: { key?: string; props: Record<string, unknown> }) => ({ key: n.key, props: n.props }))
  const before = await images()
  expect(before.map((b: { key?: string }) => b.key).sort()).toEqual(['batt', 'clawd', 'clock', 'yard'])
  const blits = calls.images.length
  expect(await ui.find({ type: 'Text', text: /^(쉬는 중|꾸벅꾸벅…)$/ })).toBeDefined()

  expect((await slash($, 'lang en')).text).toBe('Language: English')
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^(Resting|Dozing off…)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^OK$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No jobs running$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: EN_DATE })).toBeDefined()
  expect(await images()).toEqual(before) // 같은 png·props(배터리 alt 도 지난번 것)
  expect(calls.images.length).toBe(blits)
  expect(calls.opens.at(-1)?.title).toBe('Status panel') // 열린 패널은 제목만 고친다

  expect((await slash($, '언어 한국어')).text).toBe('언어: 한국어')
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^(쉬는 중|꾸벅꾸벅…)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\d+\/\d+ \([일월화수목금토]\)$/ })).toBeDefined()
  expect(await images()).toEqual(before)
  expect(calls.images.length).toBe(blits)
  await ui.unmount()
})
