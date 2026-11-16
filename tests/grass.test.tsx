import { expect, mock, test } from 'claude-code/testing'
import {
  CELL_H, GRASS_PALETTE, STEPS, grassKey, grassLevel, grassPer, grassPng, grassSize, grassTextTone, localDate, parseWeek, todayIdx, tokensText,
  weekdayOf, ymdOf,
} from '../hooks/grass'
import { CAP, cellWidth } from '../hooks/clawd'
import { decodePng, unbase64 } from './helpers'

// '최근 7일' 덩어리(시안24 나안, 폴더 줄 뺌): 순수 함수(토큰 글자·지역 날짜·잔디 그림)와 패널(줄 글자·숨김·언어 전환·줄 세기).
// hooks/week.py 는 다른 작업자가 만든다: 여기서는 그 출력(한 줄 JSON)을 흉내 낸다. 실행: claude plugin test .

test('토큰 글자: 1000 미만 그대로, k·M 은 10 미만만 소수 한 자리', () => {
  expect(tokensText(0)).toBe('0')
  expect(tokensText(999)).toBe('999')
  expect(tokensText(1000)).toBe('1k')
  expect(tokensText(1234)).toBe('1.2k')
  expect(tokensText(9_949)).toBe('9.9k')
  expect(tokensText(9_999)).toBe('10k')
  expect(tokensText(12_345)).toBe('12k')
  expect(tokensText(999_400)).toBe('999k')
  expect(tokensText(999_600)).toBe('1M')
  expect(tokensText(3_400_000)).toBe('3.4M')
  expect(tokensText(9_999_999)).toBe('10M')
  expect(tokensText(12_600_000)).toBe('13M')
})

test('날짜는 지역 날짜로: 요일과 오늘 칸(자정 근처 포함)', () => {
  // 2026-01-01 은 목요일, 2026-11-16 은 월요일
  expect(weekdayOf('2026-01-01')).toBe(4)
  expect(weekdayOf('2026-11-16')).toBe(1)
  expect(localDate('2026-11-16').getHours()).toBe(0)
  expect(localDate('2026-11-16').getDate()).toBe(16)
  expect(ymdOf(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05')
  const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map(date => ({ date, secs: 1, tokens: 1 }))
  expect(todayIdx(days, new Date(2026, 10, 16, 0, 0, 5))).toBe(6)      // 자정 바로 뒤
  expect(todayIdx(days, new Date(2026, 10, 15, 23, 59, 59))).toBe(5)   // 자정 바로 앞
  expect(todayIdx(days, new Date(2026, 10, 17, 0, 0, 1))).toBe(-1)     // 자료가 어제 것
})

test('week.py 출력 읽기: 오류·모양이 틀리면 null, folders·turns 는 버린다', () => {
  const ok = parseWeek(JSON.stringify({ at: 5, partial: true, days: [{ date: '2026-11-16', secs: 60.4, tokens: 10, turns: 3 }], folders: [{ x: 1 }], total: { secs: 60, tokens: 10, turns: 3 } }))
  expect(ok).toEqual({ at: 5, partial: true, days: [{ date: '2026-11-16', secs: 60, tokens: 10 }], total: { secs: 60, tokens: 10 } })
  expect(parseWeek(JSON.stringify({ at: 5, error: 'no-projects' }))).toBeNull()
  expect(parseWeek('not json')).toBeNull()
  expect(parseWeek('')).toBeNull()
  expect(parseWeek(JSON.stringify({ at: 5, days: [{ date: '11/16', secs: 1, tokens: 1 }] }))).toBeNull()
  expect(parseWeek(JSON.stringify({ at: 5, days: [] }))).toBeNull()
})

test('잔디 칸 수·단계·그림: 0 인 날은 바탕, 많이 한 날일수록 진하고, 오늘은 주황 테두리', () => {
  expect(grassPer(46)).toBe(6)
  expect(grassPer(44)).toBe(6)
  expect(grassPer(30)).toBe(4)
  expect(grassPer(10)).toBe(3)
  expect(grassPer(120)).toBe(6)
  expect(grassLevel(0, 100)).toBe(1)
  expect(grassLevel(100, 100)).toBe(1 + STEPS)
  expect(grassLevel(1, 100)).toBe(2)
  const days = [0, 3600, 7200, 0, 11520, 5040, 6120].map((secs, i) => ({ date: `2026-11-${10 + i}`, secs, tokens: 0 }))
  const per = 6, { w, h } = grassSize(per)
  expect([w, h]).toEqual([Math.round(42 * 14.4), CELL_H])
  const d = decodePng(unbase64(grassPng(days, 6, per)))
  expect([d.w, d.h, d.colorType]).toEqual([w, h, 3])
  expect(d.palette).toEqual(GRASS_PALETTE)
  const cw = w / (7 * per), mid = Math.floor(h / 2)
  const at = (i: number) => d.px[mid * w + Math.floor((i * per + per / 2) * cw)]!
  expect(at(0)).toBe(1)                 // 0 인 날: 바탕
  expect(at(4)).toBe(1 + STEPS)         // 가장 많이 한 날: 가장 진함
  expect(at(1)).toBeLessThan(at(2))     // 더 많이 한 날이 더 진하다
  // 칸 사이와 위아래 가장자리는 투명
  expect(d.px[mid * w + Math.floor(per * cw)]).toBe(0)
  expect(d.px[0]).toBe(0)
  // 오늘(6번) 칸의 왼쪽 가장자리는 테두리 색, 어제(5번)는 아니다
  const edgeX = (i: number) => Math.ceil((i * per + per / 2) * cw - (cw * (per - 1.4)) / 2) + 1
  expect(d.px[mid * w + edgeX(6)]).toBe(GRASS_PALETTE.length - 1)
  expect(d.px[mid * w + edgeX(5)]).not.toBe(GRASS_PALETTE.length - 1)
  // 바탕(0 인 날)은 어두운 회색: 흰 바탕에서도, 검은 바탕에서도 보인다
  const base = GRASS_PALETTE[1]!, lum = ((base >> 16) & 255) + ((base >> 8) & 255) + (base & 255)
  expect(lum).toBeGreaterThan(3 * 40)
  expect(lum).toBeLessThan(3 * 120)
  // 열쇠: 같은 자료면 같고, 오늘·폭이 바뀌면 다르다
  expect(grassKey(days, 6, 6)).toBe(grassKey(days.map(x => ({ ...x })), 6, 6))
  expect(grassKey(days, 5, 6)).not.toBe(grassKey(days, 6, 6))
  expect(grassKey(days, 6, 5)).not.toBe(grassKey(days, 6, 6))
  expect(grassTextTone(0, 100)).toBe('dim')
  expect(grassTextTone(50, 100)).toBe('suggestion')
  expect(grassTextTone(100, 100)).toBe('claude')
})

// ── 패널 ──
const NOW = Math.floor(Date.now() / 1000)
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4WR7+HwAGewKnNtauMAAAAABJRU5ErkJggg=='
const SPRITES = {
  canvas: [38, 32], ground: 30, box: [19, 8], pngSize: [456, 384], palette: { a: '#D97757' },
  frames: Array.from({ length: 40 }, () => Array.from({ length: 32 }, () => '.'.repeat(38))),
  states: Object.fromEntries(Object.keys(CAP).map((k, i) => [k, { label: k, ms: 200, seq: [i, i + 1] }])),
  png: { plain: Array.from({ length: 40 }, () => PNG_A), sticker: Array.from({ length: 40 }, () => PNG_A) },
}
// 오래된 날 → 오늘(지역 날짜). 합계 10시간 24분, 오늘 1시간 42분, 토큰 3.4M
const lastWeek = () => {
  const n = new Date(), secs = [3960, 8640, 2160, 11520, 0, 5040, 6120]
  return secs.map((s, i) => ({ date: ymdOf(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6 + i)), secs: s, tokens: 0, turns: 4 }))
}
const WEEK = (o: Record<string, unknown> = {}) => JSON.stringify({ at: NOW, partial: false, days: lastWeek(), folders: [], total: { secs: 37440, tokens: 3_400_000, turns: 28 }, ...o })
const SNAP = { at: NOW, jobs: [], waiting: [], mem: { freePct: 58, load: 4.3, cpus: 10 } }
const USAGE = { at: NOW, windows: [{ usedPct: 31, mins: 10080, resetsAt: NOW + 2 * 86400 }], reached: null }
type Calls = { week: string | (() => string); weekRuns: number; images: string[]; store: Record<string, unknown> }
const engine = (on: any, lang: 'ko' | 'en', week: Calls['week']) => {
  const calls: Calls = { week, weekRuns: 0, images: [], store: {} }
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[]; timeoutMs?: number }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(SNAP))
    if (a.includes('codex_usage.py')) return run(JSON.stringify(USAGE))
    if (a.includes('hooks/week.py')) { calls.weekRuns++; return run(typeof calls.week === 'function' ? calls.week() : calls.week) }
    return run('', 1)
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? (lang === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8') : e.name.startsWith('LC_') ? undefined : '/Users/someone' }))
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: JSON.stringify(SPRITES) }))
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', (_: unknown, e: { key: string; cells?: string }) => { if (!e.cells) calls.images.push(e.key); return { value: {} } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: calls.store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { calls.store[e.key] = e.value; return { value: undefined } })
  return calls
}
const PANE = (bodyColumns = 46, bodyRows = 60) => ({
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel',
  props: { title: '', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
} as const)
const VIEW = { columns: 120, rows: 60, isFullscreen: true }
const wait = () => new Promise<void>(r => (globalThis as any).setTimeout(r, 25))
const mounted = async ($: any, ready: RegExp, o: { surface?: 'terminal' | 'desktop'; cols?: number; rows?: number } = {}) => {
  const surface = o.surface ?? 'terminal'
  for (let i = 0; i < 60; i++) {
    const ui = await $.ui.mount({ ...PANE(o.cols, o.rows), surface, ...(surface === 'terminal' ? { viewport: VIEW } : {}) })
    if ((await ui.find({ type: 'Text', text: ready })) && (surface !== 'terminal' || (await ui.find({ type: 'Image', key: 'clawd' })))) return ui
    await ui.unmount()
    await wait()
  }
  throw new Error('패널이 다 그려지지 않았어요')
}
const start = async ($: any, on: any, lang: 'ko' | 'en', week: Calls['week']) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls = engine(on, lang, week)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { clock, calls }
}
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: { text?: string }) => t.text ?? '')

test('한국어: 세션 시작 10초 뒤에 읽고, 다섯 줄(머리·잔디·요일·합계·구분선)', { timeoutMs: 15000 }, async ($, on) => {
  const { clock, calls } = await start($, on, 'ko', WEEK())
  await clock.advance(9000)
  expect(calls.weekRuns).toBe(0) // 10초 전에는 안 읽는다
  let ui = await mounted($, /Codex 주간/)
  expect(await ui.find({ type: 'Text', text: /최근 7일/ })).toBeUndefined() // 처음 값이 오기 전에는 숨김
  expect(await ui.find({ type: 'Image', key: 'week' })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1500)
  expect(calls.weekRuns).toBe(1)
  ui = await mounted($, /최근 7일/)
  expect(await ui.find({ type: 'Text', text: /^⏱ 최근 7일 · 토큰 3\.4M$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^최근 7일$/ }))?.props).toMatchObject({ bold: true })
  expect((await ui.find({ type: 'Text', text: /^ · 토큰 3\.4M$/ }))?.props).toMatchObject({ dimColor: true })
  expect(await ui.find({ type: 'Text', text: /계산 중/ })).toBeUndefined()
  const img = await ui.find({ type: 'Image', key: 'week' })
  expect(img?.props).toMatchObject({ columns: 42, rows: 1 })
  // 요일: 칸(6칸)마다 가운데, 오늘은 굵은 claude 색
  const wd = ['일', '월', '화', '수', '목', '금', '토'], n = new Date()
  const names = Array.from({ length: 7 }, (_, i) => wd[new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6 + i).getDay()]!)
  const label = `  ${names.map(d => `  ${d}  `).join('')}`
  expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
  expect(cellWidth(label)).toBe(44)
  expect((await ui.findAll({ type: 'Text', text: names[6] })).some((t: { props: Record<string, unknown> }) => t.props.bold && t.props.color === 'claude')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^  10시간 24분 · 오늘 1시간 42분$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^1시간 42분$/ }))?.props).toMatchObject({ bold: true, color: 'claude' })
  // 차례: 구분선 → 최근 7일 → 구분선 → 작업 목록
  const t = await texts(ui), head = t.findIndex((x: string) => /^⏱ 최근 7일/.test(x))
  expect(t[head - 1]).toMatch(/^─+$/)
  expect(t.slice(head).findIndex((x: string) => /^─+$/.test(x))).toBeGreaterThan(0)
  expect(t.indexOf('지금 도는 작업이 없어요')).toBeGreaterThan(head)
  // 46칸 안
  for (const x of t.filter((x: string) => /최근 7일|오늘 /.test(x))) expect([x, cellWidth(x) <= 46]).toEqual([x, true])
  await ui.unmount()
})

test('영어: 머리·요일·합계 글자, partial 이면 (counting…)', { timeoutMs: 15000 }, async ($, on) => {
  const { clock } = await start($, on, 'en', WEEK({ partial: true }))
  await clock.advance(10_500)
  const ui = await mounted($, /Last 7 days/)
  expect(await ui.find({ type: 'Text', text: /^⏱ Last 7 days · 3\.4M tokens \(counting…\)$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ \(counting…\)$/ }))?.props).toMatchObject({ dimColor: true })
  expect(await ui.find({ type: 'Text', text: /^  10h 24m · today 1h 42m$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}(Su|Mo|Tu|We|Th|Fr|Sa)( {4}(Su|Mo|Tu|We|Th|Fr|Sa)){6} {2}$/ })).toBeDefined()
  for (const x of await texts(ui)) if (/Last 7 days|today /.test(x)) expect([x, cellWidth(x) <= 46]).toEqual([x, true])
  await ui.unmount()
})

test('한국어 partial · 오류만 오면 숨김 · 값이 있은 뒤 오류면 지난 값', { timeoutMs: 20000 }, async ($, on) => {
  let out = JSON.stringify({ at: NOW, error: 'no-projects' })
  const { clock, calls } = await start($, on, 'ko', () => out)
  await clock.advance(10_500)
  expect(calls.weekRuns).toBe(1)
  let ui = await mounted($, /Codex 주간/)
  expect(await ui.find({ type: 'Text', text: /최근 7일/ })).toBeUndefined()
  await ui.unmount()
  out = WEEK({ partial: true })
  await clock.advance(300_000) // 5분 뒤 다시 읽는다
  expect(calls.weekRuns).toBe(2)
  ui = await mounted($, /최근 7일/)
  expect(await ui.find({ type: 'Text', text: /^⏱ 최근 7일 · 토큰 3\.4M \(계산 중\)$/ })).toBeDefined()
  await ui.unmount()
  out = 'Traceback (most recent call last):'
  await clock.advance(300_000)
  expect(calls.weekRuns).toBe(3)
  ui = await mounted($, /최근 7일/)
  expect(await ui.find({ type: 'Text', text: /^⏱ 최근 7일 · 토큰 3\.4M \(계산 중\)$/ })).toBeDefined()
  await ui.unmount()
})

test('partial 이면 5분을 기다리지 않고 다음 10초 틱에 이어 세고, 다 세면 다시 5분 간격', { timeoutMs: 15000 }, async ($, on) => {
  let n = 0
  const { clock, calls } = await start($, on, 'ko', () => WEEK({ partial: ++n < 3 }))
  await clock.advance(10_500)
  expect(calls.weekRuns).toBe(1) // partial
  await clock.advance(10_000)
  expect(calls.weekRuns).toBe(2) // partial
  await clock.advance(10_000)
  expect(calls.weekRuns).toBe(3) // 다 셌다
  await clock.advance(250_000)
  expect(calls.weekRuns).toBe(3)
  await clock.advance(60_000)
  expect(calls.weekRuns).toBe(4)
  const ui = await mounted($, /최근 7일/)
  expect(await ui.find({ type: 'Text', text: /계산 중/ })).toBeUndefined()
  await ui.unmount()
})

test('언어를 바꿔도 잔디 그림 props 가 같고 blit 이 없다', { timeoutMs: 15000 }, async ($, on) => {
  const { clock, calls } = await start($, on, 'ko', WEEK())
  await clock.advance(10_500)
  const ui = await mounted($, /최근 7일/)
  await ui.drawn()
  await clock.advance(1000) // 그린 직후의 그림 차례를 지나 보낸다(같은 자료라 잔디는 보내지 않는다)
  await ui.drawn()
  const weekImg = async () => (await ui.find({ type: 'Image', key: 'week' }))?.props
  const before = await weekImg()
  expect(before).toBeDefined()
  const blits = calls.images.length
  expect(calls.images.filter(k => k === 'week')).toHaveLength(0)
  await ($ as any).command.run({ command: 'status-panel', args: 'lang en' })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^⏱ Last 7 days/ })).toBeDefined()
  expect(await weekImg()).toEqual(before)
  await ($ as any).command.run({ command: 'status-panel', args: '언어 한국어' })
  await ui.drawn()
  expect(await weekImg()).toEqual(before)
  expect(calls.images.length).toBe(blits)
  await ui.unmount()
})

test('자료가 바뀌면 다시 그리기가 아니라 blit 으로 잔디를 바꾼다', { timeoutMs: 15000 }, async ($, on) => {
  let out = WEEK()
  const { clock, calls } = await start($, on, 'ko', () => out)
  await clock.advance(10_500)
  const ui = await mounted($, /최근 7일/)
  await ui.drawn()
  const before = (await ui.find({ type: 'Image', key: 'week' }))?.props
  const days = lastWeek(); days[0]!.secs = 20000
  out = JSON.stringify({ at: NOW + 300, partial: false, days, total: { secs: 57440, tokens: 3_400_000 } })
  await clock.advance(300_000)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^  15시간 57분 · 오늘 1시간 42분$/ })).toBeDefined()
  expect((await ui.find({ type: 'Image', key: 'week' }))?.props).toEqual(before) // 다시 그리기는 지난번 그림 그대로
  expect(calls.images.filter(k => k === 'week')).toHaveLength(1) // 새 그림은 blit 한 번
  await ui.unmount()
})

test('줄 세기: 44줄 패널에 놀이터가 들어가고, 덩어리가 있으면 놀이터가 들어가는 최소 높이가 정확히 5줄 오른다', { timeoutMs: 30000 }, async ($, on) => {
  let out = JSON.stringify({ at: NOW, error: 'x' })
  const { clock } = await start($, on, 'ko', () => out)
  await clock.advance(10_500)
  // 높이를 한 줄씩 줄여 가며 놀이터가 빠지는 곳을 찾는다(줄면 바닥이 바로 따라간다)
  const minRows = async (ready: RegExp) => {
    let last = 0
    for (let rows = 44; rows >= 20; rows--) {
      const ui = await mounted($, ready, { rows })
      const yard = !!(await ui.find({ type: 'Image', key: 'yard' }))
      await ui.unmount()
      if (!yard) return last
      last = rows
    }
    return last
  }
  const without = await minRows(/Codex 주간/)
  out = WEEK()
  await clock.advance(300_000)
  const ui = await mounted($, /최근 7일/, { rows: 44 })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  await ui.unmount()
  const withWeek = await minRows(/최근 7일/)
  expect(without).toBeGreaterThan(20)
  expect(withWeek - without).toBe(5)
  expect(withWeek).toBeLessThanOrEqual(44)
})

test('그림을 못 그리는 화면: 글자 잔디(진하기 세 단계, 오늘은 굵게)', { timeoutMs: 15000 }, async ($, on) => {
  const { clock } = await start($, on, 'ko', WEEK())
  await clock.advance(10_500)
  const ui = await mounted($, /최근 7일/, { surface: 'desktop' })
  expect(await ui.find({ type: 'Image', key: 'week' })).toBeUndefined()
  const row = `  ${'▆▆▆▆▆ '.repeat(7)}`
  expect(await ui.find({ type: 'Text', text: row })).toBeDefined()
  const bars = (await ui.findAll({ type: 'Text', text: /^▆+$/ })).filter((t: { text?: string }) => t.text === '▆▆▆▆▆')
  expect(bars).toHaveLength(7)
  // secs: 3960 8640 2160 11520 0 5040 6120(최대 11520)
  const tone = (b: { props: Record<string, unknown> }) => (b.props.dimColor ? 'dim' : b.props.color)
  expect(bars.map(tone)).toEqual(['suggestion', 'claude', 'dim', 'claude', 'dim', 'suggestion', 'suggestion'])
  expect(bars.map((b: { props: Record<string, unknown> }) => !!b.props.bold)).toEqual([false, false, false, false, false, false, true])
  await ui.unmount()
})
