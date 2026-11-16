import { expect, mock, test } from 'claude-code/testing'

import { clockSource } from '../hooks/clock'
import {
  BIG_TURN_MS, CAP, FREEZE_AFTER_MS, OOPS_HOLD_MS, REST_GLYPH, SPIN_SEQ, TERM_DEFAULT, base64, celebrationFor, cellWidth, frameAt, isFailure,
  isFrozen, isNight, msUntilChange, oopsFor, pickAct, pickMode, rasterCells, rasterWords, spinCells, spinGlyph, toolAct,
} from '../hooks/clawd'
import type { ClawdLive } from '../hooks/clawd'
import { soilRgb } from '../hooks/yard'

// Clawd: 동작 고르기(우선순위·1.2초 유지·축하·한가함 단계), Raster 칸(반 블록 색), 화면 방식, 훅이 결과를 그대로 넘기는지.
// 실행: claude plugin test .

const T = 1_000_000
const base = (o: Partial<ClawdLive> = {}): ClawdLive => ({
  now: T, tools: [], hold: null, turn: null, celebrate: null, subagents: false, jobs: false, lowUsage: false, lastActivity: T, ...o,
})

test('도구 이름 → 동작', async () => {
  for (const t of ['Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch']) expect(toolAct(t)).toBe('search')
  for (const t of ['Read', 'NotebookRead']) expect(toolAct(t)).toBe('read')
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(toolAct(t)).toBe('edit')
  for (const t of ['Agent', 'Task', 'Workflow']) expect(toolAct(t)).toBe('cape')
  for (const t of ['Bash', 'mcp__x__y', 'TodoWrite']) expect(toolAct(t)).toBe('work')
})

test('우선순위: 도구 → 턴 → 서브에이전트 → 축하 → Codex → 한가함', async () => {
  const all = base({
    tools: [{ name: 'Read', at: T - 10 }], turn: { usedTool: true }, subagents: true,
    celebrate: { act: 'happy', until: T + 1000 }, jobs: true, lowUsage: true,
  })
  expect(pickAct(all)).toBe('read')
  // 도구가 여럿이면 가장 최근에 시작한 것
  expect(pickAct({ ...all, tools: [{ name: 'Read', at: T - 10 }, { name: 'Grep', at: T - 5 }] })).toBe('search')
  expect(pickAct({ ...all, tools: [] })).toBe('work')
  expect(pickAct({ ...all, tools: [], turn: { usedTool: false } })).toBe('think')
  expect(pickAct({ ...all, tools: [], turn: null })).toBe('cape')
  expect(pickAct({ ...all, tools: [], turn: null, subagents: false })).toBe('happy')
  expect(pickAct({ ...all, tools: [], turn: null, subagents: false, celebrate: null })).toBe('coffee')
  expect(pickAct({ ...all, tools: [], turn: null, subagents: false, celebrate: null, jobs: false })).toBe('dizzy')
  expect(pickAct(base())).toBe('idle')
})

test('끝난 도구도 1.2초는 보이고, 그 뒤엔 다음 순위로', async () => {
  const hold = { act: 'edit' as const, until: T + 1200 }
  expect(pickAct(base({ hold, turn: { usedTool: true } }))).toBe('edit')
  expect(pickAct(base({ hold, turn: { usedTool: true }, now: T + 1199 }))).toBe('edit')
  expect(pickAct(base({ hold, turn: { usedTool: true }, now: T + 1200 }))).toBe('work')
  // 새 도구가 시작되면 유지보다 앞선다
  expect(pickAct(base({ hold, tools: [{ name: 'Bash', at: T }] }))).toBe('work')
})

test('축하: 정상 종료만, 60초 넘으면 하트, 3초 뒤·새 턴이면 끝', async () => {
  expect(celebrationFor('answer', 5000, T)).toEqual({ act: 'happy', until: T + 3000 })
  expect(celebrationFor('answer', BIG_TURN_MS + 1, T)?.act).toBe('heart')
  for (const r of ['aborted', 'error', 'refusal']) expect(celebrationFor(r, 90_000, T)).toBeNull()
  const celebrate = celebrationFor('answer', 5000, T)
  expect(pickAct(base({ celebrate, now: T + 2999 }))).toBe('happy')
  expect(pickAct(base({ celebrate, now: T + 3000 }))).toBe('idle')
  // 새 턴이 시작되면(턴이 있음) 축하보다 턴이 먼저다. 훅은 이때 celebrate 를 null 로 지운다
  expect(pickAct(base({ celebrate, turn: { usedTool: false } }))).toBe('think')
})

test('한가함 단계와 30분 뒤 멈춤', async () => {
  expect(pickAct(base({ now: T + 2 * 60_000 }))).toBe('idle')
  expect(pickAct(base({ now: T + 2 * 60_000 + 1 }))).toBe('bubble')
  expect(pickAct(base({ now: T + 10 * 60_000 + 1 }))).toBe('kite')
  expect(pickAct(base({ now: T + 10 * 60_000 + 1, lowUsage: true }))).toBe('dizzy')
  expect(isFrozen(base({ now: T + FREEZE_AFTER_MS }))).toBe(false)
  expect(isFrozen(base({ now: T + FREEZE_AFTER_MS + 1 }))).toBe(true)
  // 활동 중이면 멈추지 않는다
  expect(isFrozen(base({ now: T + FREEZE_AFTER_MS + 1, subagents: true }))).toBe(false)
  expect(isFrozen(base({ now: T + FREEZE_AFTER_MS + 1, jobs: true }))).toBe(false)
  const st = { ms: 100, seq: [5, 6, 7] }
  expect(frameAt(st, T, T + 250, false)).toBe(7)
  expect(frameAt(st, T, T + 350, false)).toBe(5)
  expect(frameAt(st, T, T + 250, true)).toBe(5)
})

test('설명 글자와 색', async () => {
  expect(CAP.idle).toEqual({ text: '쉬는 중' })
  expect(CAP.cape).toEqual({ text: '작업자 기다리는 중…', color: 'claude' })
  expect(CAP.heart.color).toBe('success')
  expect(CAP.coffee).toEqual({ text: '작업 기다리는 중…', color: 'suggestion' }) // agy 작업을 기다릴 때도
  expect(CAP.dizzy.color).toBe('warning')
  expect(CAP.kite.text).toBe(CAP.bubble.text)
})

test('Raster 칸: 반 블록 ▀ 의 글자색=윗 도트, 바탕색=아랫 도트', async () => {
  const pal = { a: '#D97757', b: '#000000' }
  // 2칸×1줄(=도트 2×2): [위a/아래b, 위빔/아래a], 다음 칸: [위a/아래빔], [둘 다 빔]
  const frame = ['a.a.', 'ba..']
  const w = rasterWords(frame, pal, 4, 1)
  expect(Array.from(w)).toEqual([
    0x2580, 0xd97757, 0x000000,
    0x2584, 0xd97757, TERM_DEFAULT,
    0x2580, 0xd97757, TERM_DEFAULT,
    0x20, TERM_DEFAULT, TERM_DEFAULT,
  ])
  expect(base64(Uint8Array.of(1, 2, 3))).toBe('AQID')
  expect(base64(Uint8Array.of(1, 2))).toBe('AQI=')
  expect(base64(Uint8Array.of(1))).toBe('AQ==')
  // 38×16 칸 × 12바이트 = 7296 바이트 → base64 9728 글자. 첫 칸(빈 칸): 20 00 00 00 | 00 00 00 01 | 00 00 00 01
  const cells = rasterCells(Array.from({ length: 32 }, () => '.'.repeat(38)), pal)
  expect(cells.length).toBe(9728)
  expect(cells.slice(0, 16)).toBe(base64(Uint8Array.of(0x20, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1)))
})

test('설명 앞 표시: 일하는 동작은 · ✢ ✳ ✶ ✻ ✽ 를 오가고, 그 밖은 ✻ 로 멈춘다', async () => {
  expect(SPIN_SEQ.join('')).toBe('·✢✳✶✻✽✽✻✶✳✢·')
  expect(spinGlyph('work', 0)).toBe('·')
  expect(spinGlyph('think', 2)).toBe('✳')
  expect(spinGlyph('coffee', 13)).toBe('✢')
  for (const a of ['idle', 'happy', 'heart', 'bubble', 'kite', 'dizzy'] as const) expect(spinGlyph(a, 2)).toBe(REST_GLYPH)
  // 같은 글자라도 설명 색이 다르면 cells 가 다르다(생각=claude, 커피=suggestion)
  expect(spinCells('think', 2)).not.toBe(spinCells('coffee', 2))
  expect(spinCells('bubble', 0)).toBe(spinCells('kite', 7))
  expect(cellWidth('메모리 58% · 부하 4.3/10')).toBe(24)
  expect(cellWidth('abc')).toBe(3)
})

test('화면 방식: 그림·글자·그림 없음', async () => {
  const o = { on: true, ready: true, surface: 'terminal', hasImage: true, hasRaster: true, isFullscreen: true, imageDenied: false, bodyColumns: 44 }
  expect(pickMode(o)).toBe('image-side')
  expect(pickMode({ ...o, bodyColumns: 31 })).toBe('image-top')
  expect(pickMode({ ...o, bodyColumns: 32 })).toBe('image-side')
  expect(pickMode({ ...o, isFullscreen: false })).toBe('raster')
  expect(pickMode({ ...o, imageDenied: true })).toBe('raster')
  expect(pickMode({ ...o, imageDenied: true, bodyColumns: 30 })).toBe('text')
  // 글자 방식은 38칸이 있어야 한다. fullscreen 여부를 모르면(undefined) 그림부터 해 본다
  expect(pickMode({ ...o, imageDenied: true, bodyColumns: 37 })).toBe('text')
  expect(pickMode({ ...o, imageDenied: true, bodyColumns: 38 })).toBe('raster')
  expect(pickMode({ ...o, isFullscreen: undefined, bodyColumns: 37 })).toBe('image-side')
  expect(pickMode({ ...o, surface: 'desktop', hasImage: false, hasRaster: false })).toBe('text')
  expect(pickMode({ ...o, on: false })).toBe('off')
  expect(pickMode({ ...o, ready: false })).toBe('off')
})

// ── 엔진을 거친 시험: 패널 맨 위에 Clawd, 훅은 결과를 그대로 넘긴다 ──
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const blank = () => Array.from({ length: 32 }, () => '.'.repeat(38))
// 장면마다 그림이 달라야 '장면이 바뀌었는지'를 볼 수 있다: 기본인 plain 벌은 짝수·홀수 장면이 서로 다른 PNG, sticker 벌은 또 다른 PNG
const PNG_EVEN = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4WR7+HwAGewKnNtauMAAAAABJRU5ErkJggg=='
const PNG_ODD = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mMQERH+DwABtgE75dHkOwAAAABJRU5ErkJggg=='
const SPRITES = {
  canvas: [38, 32], ground: 30, box: [19, 8], pngSize: [456, 384], palette: { a: '#D97757' },
  // 장면마다 도트가 달라야 놀이터 띠가 장면에 따라 달라진다
  frames: Array.from({ length: 40 }, (_, i) => blank().map((r, y) => (y === 5 ? '.'.repeat(i % 38) + 'a' + '.'.repeat(37 - (i % 38)) : r))),
  states: Object.fromEntries(Object.keys(CAP).map((k, i) => [k, { label: k, sticker: [k], when: '', note: '', ms: 200, seq: [i, i + 1] }])),
  png: { plain: Array.from({ length: 40 }, (_, i) => (i % 2 ? PNG_ODD : PNG_EVEN)), sticker: Array.from({ length: 40 }, () => PNG1) },
}
const NOW = Math.floor(Date.now() / 1000)
const SNAP = { at: NOW, jobs: [], waiting: [], mem: { freePct: 58, load: 4.3, cpus: 10 } }
const engine = (on: any, o: { clock?: boolean; blitDeny?: string; blits?: { n: number; sent?: string[] }; spins?: string[]; keyed?: { key: string; png?: string; rgba?: string }[]; images?: string[]; snap?: () => unknown; store?: Record<string, unknown>; sets?: unknown[] } = {}) => {
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(o.snap ? o.snap() : SNAP))
    if (a.includes('codex_usage.py')) return run(JSON.stringify({ at: NOW, windows: [] }))
    return run('', 1)
  })
  // 언어는 LC_ALL → LC_MESSAGES → LANG 으로 고른다: 이 시험은 한국어 화면을 본다
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'ko_KR.UTF-8' : e.name.startsWith('LC_') ? undefined : '/Users/someone' }))
  if (!o.clock) { on('clock.every', () => ({ value: undefined })); on('clock.now', () => ({ value: Date.now() })) }
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: JSON.stringify(SPRITES) }))
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', (_: unknown, e: { key: string; source?: { png?: string; rgba?: string }; cells?: string }) => {
    if (e.key !== 'spin' && !e.cells) o.images?.push(e.key)   // 그림(Image) blit 은 모두
    if (e.key === 'spin') o.spins?.push(e.cells ?? '')   // 설명 앞 표시
    else if (e.key === 'clawd') { if (o.blits) { o.blits.n++; o.blits.sent?.push(e.source?.png ?? '') } }
    else o.keyed?.push({ key: e.key, png: e.source?.png, rgba: e.source?.rgba })   // 시계·배터리·놀이터
    return { value: o.blitDeny ? { deny: o.blitDeny } : {} }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  if (o.sets) {   // 무엇을 남기는지 보려고 저장소를 직접 흉내 낸다
    const mem: Record<string, unknown> = { ...o.store }
    on('store.get', (_: unknown, e: { key: string }) => ({ value: mem[e.key] }))
    on('store.set', (_: unknown, e: { key: string; value: unknown }) => { mem[e.key] = e.value; o.sets!.push(e); return { value: undefined } })
  } else mock.store(on, o.store)
}
const PANE_R = (bodyColumns: number, bodyRows: number) => {
  const p = PANE(bodyColumns)
  return { ...p, props: { ...p.props, scroll: { offset: 0, bodyRows } } }
}
const PANE = (bodyColumns: number) => ({
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel',
  props: { title: '작업 진행판', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const)
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 40; i++) { if (await fn()) return; await Promise.resolve(); await $wait() }
  throw new Error('기다리던 화면이 나오지 않았어요')
}
const $wait = () => new Promise<void>(r => (globalThis as any).setTimeout(r, 25))

test('터미널(fullscreen)에서는 맨 위 왼쪽에 그림, 옆에 요약과 설명', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const view = { columns: 120, rows: 40, isFullscreen: true }
  await until(async () => {
    const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: view })
    const ok = !!(await ui.find({ type: 'Image', key: 'clawd' })) && !!(await ui.find({ type: 'Text', text: /메모리 58%/ }))
    await ui.unmount()
    return ok
  })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: view })
  await ui.drawn()
  const img = await ui.find({ type: 'Image', key: 'clawd' })
  expect(img?.props).toMatchObject({ columns: 19, rows: 7, alt: 'Clawd' })
  // 옆 글자(시안 '라'안): ● 여유 / 메모리 · 부하 / 표시 + 설명. 폭 44 면 옆 24칸이라 메모리·부하가 한 줄
  expect(await ui.find({ type: 'Text', text: /^메모리 58% · 부하 4\.3\/10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeUndefined()
  expect((await ui.find({ type: 'Raster', key: 'spin' }))?.props).toMatchObject({ columns: 1, rows: 1, cells: spinCells('idle', 0) })
  await ui.unmount()

  // 옆 폭이 모자라면 메모리와 부하를 두 줄로
  const w = await $.ui.mount({ ...PANE(36), surface: 'terminal', viewport: view })
  await w.drawn()
  expect(await w.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  expect(await w.find({ type: 'Text', text: /^메모리 58%$/ })).toBeDefined()
  expect(await w.find({ type: 'Text', text: /^부하 4\.3\/10$/ })).toBeDefined()
  await w.unmount()

  // fullscreen 이 아니면 글자 방식: 요약 한 줄 위, Raster 38×16 아래
  const r = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: { ...view, isFullscreen: false } })
  await r.drawn()
  expect((await r.find({ type: 'Raster', key: 'clawd' }))?.props).toMatchObject({ columns: 38, rows: 16 })
  expect(await r.find({ type: 'Image' })).toBeUndefined()
  expect((await r.find({ type: 'Text', text: /여유 · 메모리 58% · 부하 4\.3\/10$/ }))).toBeDefined()
  expect(await r.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await r.find({ type: 'Raster', key: 'spin' })).toBeDefined()
  await r.unmount()

  // 좁으면 그림만 위, 요약은 아래 한 줄
  const n = await $.ui.mount({ ...PANE(28), surface: 'terminal', viewport: view })
  await n.drawn()
  expect(await n.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  expect((await n.find({ type: 'Text', text: /여유 · 메모리 58%/ }))).toBeDefined()
  expect(await n.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await n.find({ type: 'Raster', key: 'spin' })).toBeDefined()
  await n.unmount()

  // 터미널이 아닌 표면: 그림 없이 첫 줄 + 설명 한 줄
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const d = await $.ui.mount({ ...PANE(44), surface })
    await d.drawn()
    expect(await d.find({ type: 'Image' })).toBeUndefined()
    expect(await d.find({ type: 'Text', text: IDLE })).toBeDefined()
    expect(await d.find({ type: 'Text', text: /여유 · 메모리 58% · 부하 4\.3\/10$/ })).toBeDefined()
    // 그 밖의 표면은 Raster 가 없어 멈춘 표시 글자
    expect(await d.find({ type: 'Raster' })).toBeUndefined()
    expect(await d.find({ type: 'Text', text: /^✻$/ })).toBeDefined()
    await d.unmount()
  }
})

test('관찰 훅은 도구·턴의 결과를 그대로 돌려준다', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { stdout: 'hi' } }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(r).toMatchObject({ result: { stdout: 'hi' } })
  const r2 = await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'a1' } as any)
  expect(r2).toMatchObject({ result: { stdout: 'hi' } })
  expect(await $.turn.start({ text: 'x', turnId: 't1' })).toMatchObject({ turnId: 't1' })
  expect(await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)).toMatchObject({ text: '답' })
})

test('턴이 시작되면 설명이 바뀌고, 그림을 못 그리면 글자 방식으로 바꾼다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, blitDeny: 'the Image draws its alt there' })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const view = { columns: 120, rows: 40, isFullscreen: true }
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: view })
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  // 메인 턴 시작 → 생각하는 중
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(800) // 다시 그려진 뒤 두 틱 쉬고 그림이 되는지 확인한다
  expect(await ui.find({ type: 'Text', text: /^생각하는 중…$/ })).toBeDefined()
  // blit 이 'alt 를 그리는 중'으로 거부됐으니 글자 방식(Raster)으로 다시 그려졌다
  expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('휴대폰 화면이 같이 붙어 있어도 터미널의 그림 바꾸기는 계속된다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const blits = { n: 0 }
  engine(on, { clock: true, blits })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const term = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: true } })
  await clock.advance(500)
  expect(blits.n).toBeGreaterThan(0) // 그린 뒤 확인 blit
  const phone = await $.ui.mount({ ...PANE(44), surface: 'mobile' })
  await phone.drawn()
  const before = blits.n
  // 동작이 바뀌어 두 화면이 다시 그려진 뒤에도 터미널 쪽 blit 이 나간다
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(800)
  expect(await term.find({ type: 'Text', text: /^생각하는 중…$/ })).toBeDefined()
  expect(await phone.find({ type: 'Text', text: /^생각하는 중…$/ })).toBeDefined()
  expect(blits.n).toBeGreaterThan(before)
  expect(await term.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await phone.unmount(); await term.unmount()
})

test('거부 문구가 달라도, 새로 그린 뒤의 확인이 세 번 거부되면 글자 방식으로 물러난다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, blitDeny: 'refused for a reason this mod does not know' })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: true } })
  await clock.advance(1500) // 첫 확인 거부
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await $.turn.start({ text: 'x', turnId: 't1' }) // 다시 그려짐 → 두 번째 확인 거부
  await clock.advance(1500)
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any) // 다시 그려짐 → 세 번째
  await clock.advance(1500)
  expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

const VIEW = { columns: 120, rows: 40, isFullscreen: true }
const cap = (ui: any, re: RegExp) => ui.find({ type: 'Text', text: re })
// 한가함: 시험이 현지 밤(0~6시)에 돌면 꾸벅꾸벅이 나온다(아래 '밤' 시험이 정확히 본다)
const IDLE = /^(쉬는 중|꾸벅꾸벅…)$/

test('시간 흐름: 생각 → 도구(1.2초 유지) → 일하기 → 축하 3초 → 대기, 그동안 장면이 바뀌어 나간다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const blits = { n: 0, sent: [] as string[] }
  engine(on, { clock: true, blits })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  on('tool.call', () => ({ result: { stdout: 'x' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(300)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  // 금방 끝난 도구도 시작부터 1.2초는 보이고, 그 뒤에는 '도구를 쓴 턴'의 일하기
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^읽는 중…$/)).toBeDefined()
  await clock.advance(1200)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 정상 종료 → 축하 3초 → 대기
  await $.turn.complete({ answer: 'a', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^다 했어요!$/)).toBeDefined()
  await clock.advance(3200)
  expect(await cap(ui, IDLE)).toBeDefined()
  // 그동안 나간 그림이 한 가지가 아니다(같은 그림만 되풀이해 보낸 게 아님)
  expect(new Set(blits.sent).size).toBeGreaterThan(1)
  expect(blits.sent.every(p => p === PNG_EVEN || p === PNG_ODD)).toBe(true)
  await ui.unmount()
})

test('다시 그릴 때 Clawd 그림에는 지난번에 넘긴 장면을 그대로 넘긴다(엔진이 그림을 다시 보내지 않게), 움직임은 blit 으로만', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const blits = { n: 0, sent: [] as string[] }
  engine(on, { clock: true, blits })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const rendered = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png
  const first = await rendered()
  await clock.advance(1100)
  expect(new Set(blits.sent).size).toBe(2) // 그동안 장면은 blit 으로 바뀌어 나갔다(시험 그림은 두 장면)
  // 설명이 바뀌어 다시 그려져도 넘기는 그림은 처음 그대로
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(100)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  expect(await rendered()).toBe(first)
  // 다른 까닭으로 여러 번 다시 그려져도 그대로, blit 은 계속 나간다
  for (let i = 0; i < 4; i++) {
    const before = blits.sent.length
    await clock.advance(500)
    await slash($, '민무늬')
    expect(await rendered()).toBe(first)
    expect(blits.sent.length).toBeGreaterThan(before)
  }
  // 모양을 바꾸면(테두리) 그때는 새 그림을 넘긴다
  await slash($, '테두리')
  expect(await rendered()).toBe(PNG1)
  await ui.unmount()
})

test('분이 바뀌면 시계는 blit 으로만 바뀌고, 다시 그릴 때 넘기는 그림은 처음 그대로다', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 59, 57).getTime() })
  const keyed: { key: string; png?: string; rgba?: string }[] = []
  engine(on, { clock: true, keyed })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  const clockImg = async () => (await ui.find({ type: 'Image', key: 'clock' }))?.props as { alt: string; source: { rgba: string } }
  expect((await clockImg()).alt).toBe('10:59')
  await clock.advance(6000) // 11:00 을 넘긴다
  const sent = keyed.filter(k => k.key === 'clock')
  expect(sent.length).toBe(1)
  expect(sent[0]!.rgba).toBe(clockSource('11:00').rgba)
  expect((await clockImg()).alt).toBe('10:59') // 패널이 넘긴 그림은 그대로(엔진이 다시 보내지 않는다)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(100)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  expect((await clockImg()).alt).toBe('10:59')
  expect((await clockImg()).source.rgba).toBe(clockSource('10:59').rgba)
  expect(keyed.filter(k => k.key === 'clock').length).toBe(1) // 다시 그려도 시계를 또 보내지 않았다
  await ui.unmount()
})

test('놀이터: 그림 한 장으로 패널 폭 전체(기본은 배경 있는 9줄), 장면은 blit 으로만 바뀌고 다시 그릴 때 넘기는 그림은 처음 그대로, Clawd 를 끄면 사라진다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const keyed: { key: string; png?: string; rgba?: string }[] = []
  engine(on, { clock: true, keyed })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const wide = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  const yard = async (ui: any) => await ui.find({ type: 'Image', key: 'yard' })
  expect((await yard(wide))?.props).toMatchObject({ columns: 46, rows: 9 })
  // 놀이터는 그림 한 장뿐이다(여러 장이면 자리를 옮길 때 한꺼번에 다시 가며 번쩍인다). 풀밭도 그림 안에 있다
  expect((await wide.findAll({ type: 'Image' })).map((x: any) => x.key ?? x.props?.key).sort()).toEqual(['clawd', 'clock', 'yard'])
  expect(await wide.find({ type: 'Text', text: /▔/ })).toBeUndefined()
  await wide.unmount()
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect((await yard(ui))?.props).toMatchObject({ columns: 44, rows: 9 })
  const first = (await yard(ui)).props.source.png
  // 시험용 그림은 큰 Clawd 가 0.2초마다 바뀌어 놀이터 차례가 드물다(굶으면 1.5초에 한 번은 얻는다)
  await clock.advance(6000)
  const yb = keyed.filter(k => k.key === 'yard')
  expect(yb.length).toBeGreaterThan(2) // 장면이 blit 으로 바뀌어 나갔다
  expect(new Set(yb.map(k => k.png)).size).toBeGreaterThan(1)
  // 다시 그려져도 넘기는 그림은 처음 그대로
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(100)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  expect((await yard(ui)).props.source.png).toBe(first)
  // 휴대폰 화면에는 없다, Clawd 를 끄면 사라진다
  const phone = await $.ui.mount({ ...PANE(46), surface: 'mobile' })
  expect(await yard(phone)).toBeUndefined()
  await phone.unmount()
  await slash($)
  expect(await yard(ui)).toBeUndefined()
  await ui.unmount()
})

test('/clawd 배경: 놀이터 배경을 켜고 끄고, 선택은 저장돼 새 세션이 그대로 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: { key: string; value: { on?: boolean; look?: string; bg?: boolean } }[] = []
  engine(on, { clock: true, sets: sets as unknown[] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  const rows = async () => ((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number } | undefined)?.rows
  const clawdPng = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png
  expect(await rows()).toBe(9) // 기본은 배경 있음
  const big = await clawdPng()
  expect(await slash($, '배경')).toMatchObject({ text: '놀이터 배경 껐어요' })
  expect(await rows()).toBe(3)
  expect(await clawdPng()).toBe(big) // 배경을 바꿔도 큰 Clawd 그림은 다시 보내지 않는다
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, look: 'plain', bg: false } })
  expect(await slash($, '배경 켜기')).toMatchObject({ text: '놀이터 배경 켰어요' })
  expect(await rows()).toBe(9)
  expect(await slash($, '배경 켜기')).toMatchObject({ text: '놀이터 배경 켰어요' }) // 이미 켜져 있으면 그대로
  expect(await rows()).toBe(9)
  expect(await slash($, '배경 끄기')).toMatchObject({ text: '놀이터 배경 껐어요' })
  expect(await rows()).toBe(3)
  // Clawd 를 껐다 켜도 배경 선택은 그대로 남는다
  await slash($)
  expect(await rows()).toBeUndefined()
  expect(await slash($, '배경')).toMatchObject({ text: '놀이터 배경 켰어요 (Clawd 가 꺼져 있어 지금은 안 보여요)' })
  await slash($)
  expect(await rows()).toBe(9)
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, bg: true } })
  expect((await slash($, '배경 뭐지') as { text: string }).text).toContain('/clawd 배경')
  await ui.unmount()
})

test('/clawd 놀이터: 큰 Clawd 는 두고 놀이터만 켜고 끄고, 선택은 저장된다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: { key: string; value: { on?: boolean; look?: string; bg?: boolean; yard?: boolean } }[] = []
  engine(on, { clock: true, sets: sets as unknown[] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  const has = async (key: string) => !!(await ui.find({ type: 'Image', key }))
  const clawdPng = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png
  expect(await has('yard')).toBe(true) // 기본은 켜짐
  const big = await clawdPng()
  expect(await slash($, '놀이터')).toMatchObject({ text: '놀이터 껐어요' })
  expect(await has('yard')).toBe(false)
  expect(await has('clawd')).toBe(true) // 큰 Clawd 는 그대로
  expect(await clawdPng()).toBe(big) // 다시 보내지도 않는다
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, yard: false, bg: true } })
  // 놀이터가 꺼져 있을 때 배경을 바꾸면 선택은 남고, 지금은 안 보인다고 알려 준다
  expect(await slash($, '배경 끄기')).toMatchObject({ text: '놀이터 배경 껐어요 (놀이터가 꺼져 있어 지금은 안 보여요)' })
  expect(await slash($, '놀이터 켜기')).toMatchObject({ text: '놀이터 켰어요' })
  expect(((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number }).rows).toBe(3) // 배경 끈 것이 그대로
  expect(await slash($, '놀이터 켜기')).toMatchObject({ text: '놀이터 켰어요' }) // 이미 켜져 있으면 그대로
  expect(await slash($, '놀이터 끄기')).toMatchObject({ text: '놀이터 껐어요' })
  expect(await has('yard')).toBe(false)
  // Clawd 를 끈 채로 켜면 선택은 남고 알려 준다. Clawd 를 다시 켜면 놀이터도 보인다
  await slash($)
  expect(await slash($, '놀이터')).toMatchObject({ text: '놀이터 켰어요 (Clawd 가 꺼져 있어 지금은 안 보여요)' })
  await slash($)
  expect(await has('yard')).toBe(true)
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, yard: true, bg: false } })
  expect((await slash($, '놀이터 뭐지') as { text: string }).text).toContain('/clawd 놀이터')
  await ui.unmount()
})

test('저장해 둔 놀이터 끔을 새 세션이 그대로 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, store: { clawd: { on: true, look: 'plain', bg: true, yard: false } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await ui.unmount()
})

test('저장해 둔 배경 끔을 새 세션이 그대로 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, store: { clawd: { on: true, look: 'plain', bg: false } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number }).rows).toBe(3)
  await ui.unmount()
})

test('펼친 최근 끝남은 놀이터를 침범하지 않을 만큼만 보이고, 접으면 2개, 정말 모자라면 놀이터를 뺀다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const eight = Array.from({ length: 8 }, (_, i) => ({ pid: 900 + i, tool: 'codex', label: `작업${i}`, project: 'x', model: 'gpt-6.1-terra', effort: 'high', elapsed: 60, rssMB: 10, idle: 1, last: '', tail: [], out: '/tmp/none' }))
  let calls = 0
  engine(on, { clock: true, snap: () => ({ ...SNAP, jobs: calls++ === 0 ? eight : [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(5200) // 다음 갱신에 여덟 작업이 모두 끝났다
  const look = async (rows: number) => {
    const ui = await $.ui.mount({ ...PANE_R(46, rows), surface: 'terminal', viewport: VIEW })
    const shown = (await ui.findAll({ type: 'Text', text: /^ [✓■]$/ })).length
    const button = (await ui.find({ key: 'done-more' }))?.text ?? ''
    const yard = ((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number } | undefined)?.rows ?? 0
    await ui.unmount()
    return { shown, button, yard }
  }
  // 이 시험의 나머지 내용은 14줄(시계 4 · Clawd 8 · 구분선 1 · '지금 도는 작업이 없어요' 1), 놀이터 9줄
  expect(await look(40)).toEqual({ shown: 8, button: '접기 ▴', yard: 9 }) // 14 + 10 + 9 = 33
  expect(await look(30)).toEqual({ shown: 5, button: '외 3개 · 접기 ▴', yard: 9 }) // 14 + (1 + 5 + 1) + 9 = 30
  expect(await look(27)).toEqual({ shown: 2, button: '외 6개 · 접기 ▴', yard: 9 }) // 14 + 4 + 9 = 27
  expect(await look(26)).toEqual({ shown: 8, button: '접기 ▴', yard: 0 }) // 2개도 안 들어가면 놀이터를 뺀다
  // 바닥(26)을 올려 둔 채 패널이 커졌는데 그 바닥으로는 놀이터가 안 들어가면, 바닥을 지금 높이로 내려 놀이터를 그린다
  expect(await look(27)).toEqual({ shown: 2, button: '외 6개 · 접기 ▴', yard: 9 })
  // 놀이터를 끄면 그 자리까지 최근 끝남이 쓴다(30줄: 14 + 10 = 24)
  await slash($, '놀이터 끄기')
  expect(await look(30)).toEqual({ shown: 8, button: '접기 ▴', yard: 0 })
  await slash($, '놀이터 켜기')
  // 접으면 2개 + '외 6개 ▸'
  const ui = await $.ui.mount({ ...PANE_R(46, 30), surface: 'terminal', viewport: VIEW })
  await ui.press({ key: 'done-more' })
  expect((await ui.findAll({ type: 'Text', text: /^ [✓■]$/ })).length).toBe(2)
  expect((await ui.find({ key: 'done-more' }))?.text).toBe('외 6개 ▸')
  await ui.unmount()
})

test('놀이터 바닥: 아래 줄이 늘었다 줄어도 놀이터가 옮겨지지 않고, 커진 채 10분이 지나면 한 번에 내려간다', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  // 바깥 상자 = [바닥까지의 상자(minHeight = 바닥), 땅]. 땅은 바닥 아래 남는 줄을 장면 맨 아래 풀밭 색 글자 칸으로 채운다
  type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const grounds = new Set((['day', 'dusk', 'night'] as const).map(t => `#${soilRgb(t).toString(16).padStart(6, '0')}`))
  const look = async (rows: number) => {
    const ui = await $.ui.mount({ ...PANE_R(46, rows), surface: 'terminal', viewport: VIEW })
    const root = (await ui.drawn()) as El
    const [floorBox, ground] = (root.children ?? []) as (El | undefined)[]
    const fills = ((ground?.children ?? []) as El[]).filter(c => c?.type === 'Text' && c.props?.backgroundColor)
    // 땅 한 줄은 놀이터 폭(46칸)보다 한 칸 좁은 빈칸(그림 오른쪽 끝이 반 칸쯤 비어서), 모두 한 색(그 시간대의 풀밭 색)
    for (const f of fills) expect([f.children, grounds.has(String(f.props?.backgroundColor)), f.props?.backgroundColor]).toEqual([[' '.repeat(45)], true, fills[0]!.props?.backgroundColor])
    const yard = !!(await ui.find({ type: 'Image', key: 'yard' }))
    await ui.unmount()
    // 줄 수: 바닥 + 땅 = 패널 높이(땅이 있을 때)
    if (fills.length) expect((floorBox?.props?.minHeight as number) + fills.length).toBe(rows)
    return { floor: floorBox?.props?.minHeight, yard, fill: fills.length }
  }
  expect(await look(44)).toEqual({ floor: 44, yard: true, fill: 0 })
  expect(await look(41)).toEqual({ floor: 41, yard: true, fill: 0 }) // 작업자 줄이 생겨 줄면 바로 따라간다(그림이 잘리지 않게)
  expect(await look(44)).toEqual({ floor: 41, yard: true, fill: 3 }) // 줄이 사라져 커져도 그대로: 놀이터가 옮겨지지 않고, 아래 3줄은 땅
  expect(await look(42)).toEqual({ floor: 41, yard: true, fill: 1 })
  // 배경이 꺼진 띠(투명한 바탕에 얇은 풀밭 선)는 땅으로 채우지 않는다
  await slash($, '배경 끄기')
  expect(await look(44)).toEqual({ floor: 41, yard: true, fill: 0 })
  await slash($, '배경 켜기')
  await clock.advance(10 * 60_000 + 1000)
  expect(await look(44)).toEqual({ floor: 44, yard: true, fill: 0 }) // 커진 채 10분이 지나면 한 번에 내려간다
  // 3줄 넘게 커지면(창을 키운 때 등) 흙으로 채우지 않고 바로 한 번 내린다(초록이 너무 많아 보였다)
  expect(await look(41)).toEqual({ floor: 41, yard: true, fill: 0 })
  expect(await look(46)).toEqual({ floor: 46, yard: true, fill: 0 })
  // 놀이터를 끄면 바닥을 잊는다: 다시 켜면 그때 높이부터
  await slash($, '놀이터 끄기')
  expect(await look(40)).toEqual({ floor: undefined, yard: false, fill: 0 })
  await slash($, '놀이터 켜기')
  expect(await look(44)).toEqual({ floor: 44, yard: true, fill: 0 })
})

test('장면이 바뀌기까지 남은 시간', async () => {
  const st = { ms: 100, seq: [5, 5, 5, 6] }
  expect(msUntilChange(st, 0, 0, false)).toBe(300)
  expect(msUntilChange(st, 0, 250, false)).toBe(50)
  expect(msUntilChange(st, 0, 320, false)).toBe(80) // 6 → 5
  expect(msUntilChange({ ms: 100, seq: [5, 5] }, 0, 10, false)).toBe(Infinity)
  expect(msUntilChange(st, 0, 0, true)).toBe(Infinity)
  expect(msUntilChange(undefined, 0, 0, false)).toBe(Infinity)
})

test('그림 교체는 한 틱에 하나만, 사이를 두 틱 이상 띄워 보낸다(깜빡임 방지)', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 59, 50).getTime() })
  const images: string[] = []
  engine(on, { clock: true, images })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' }) // 큰 Clawd 도 바쁘게
  const perTick: number[] = []
  for (let i = 0; i < 150; i++) { const before = images.length; await clock.advance(100); perTick.push(images.length - before) }
  expect(Math.max(...perTick)).toBe(1)
  // 잇단 두 틱에 연달아 보내지 않는다
  expect(perTick.some((n, i) => n > 0 && i > 0 && perTick[i - 1]! > 0)).toBe(false)
  // 큰 Clawd·놀이터·시계가 모두 차례를 얻는다
  expect(images).toContain('clawd')
  expect(images.filter(k => k === 'yard').length).toBeGreaterThan(3)
  expect(images.filter(k => k === 'clock').length).toBe(1) // 11:00
  await ui.unmount()
})

test('일하는 동안 설명 앞 표시가 돌고, 쉬면 ✻ 로 멈춰 더 보내지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const spins: string[] = []
  engine(on, { clock: true, spins })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(1500)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  const turning = new Set(spins)
  const thinkCells = new Set(SPIN_SEQ.map((_, i) => spinCells('think', i)))
  expect(turning.size).toBeGreaterThan(4) // 여러 글자를 오갔다
  expect([...turning].every(c => thinkCells.has(c))).toBe(true)
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(4000) // 축하 3초 → 쉬는 중
  expect(await cap(ui, IDLE)).toBeDefined()
  expect(spins.at(-1)).toBe(spinCells('idle', 0))
  const sent = spins.length
  await clock.advance(2000)
  expect(spins.length).toBe(sent) // 멈춘 표시는 다시 보내지 않는다
  await ui.unmount()
})

test('턴이 중단된 뒤 늦게 끝난 도구는 동작을 되살리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let release = (_: unknown) => {}
  const gate = new Promise(r => { release = r })
  on('tool.call', async () => { await gate; return { result: { stdout: 'late' } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  const pending = $.tool.call({ tool: 'Bash', command: 'sleep 9' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 중단: 축하 없이 바로 대기. 도구는 아직 안 끝났다
  await $.turn.complete({ answer: '', durationMs: 900, isAborted: true, turnId: 't1', reason: 'aborted' } as any)
  await clock.advance(300)
  expect(await cap(ui, IDLE)).toBeDefined()
  release(undefined)
  expect(await pending).toMatchObject({ result: { stdout: 'late' } })
  await clock.advance(300)
  expect(await cap(ui, IDLE)).toBeDefined()
  await ui.unmount()
})

const slash = ($: any, args = '') => $.command.run({ command: 'clawd', args })

test('/clawd: 끄고 켜기, 테두리·민무늬 고르기', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: unknown[] = []
  engine(on, { clock: true, sets })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const png = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string } | undefined)?.png
  const plain = [PNG_EVEN, PNG_ODD] // 어느 장면이든 plain 벌이면 둘 중 하나
  expect(plain).toContain(await png()) // 기본은 민무늬(plain) 벌
  expect(await slash($)).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'clock' })).toBeDefined() // 시계는 Clawd 와 따로
  expect(await cap(ui, /여유 · 메모리 58% · 부하 4\.3\/10$/)).toBeDefined() // 꺼지면 예전 첫 줄
  expect(await slash($, '테두리')).toMatchObject({ text: 'Clawd 켰어요 (테두리)' })
  expect(await png()).toBe(PNG1)
  expect(await slash($, '민무늬')).toMatchObject({ text: 'Clawd 켰어요 (민무늬)' })
  expect(plain).toContain(await png())
  expect(await slash($, '뭐지')).toMatchObject({ text: expect.stringContaining('사용법') })
  // 고를 때마다 $.store 에 남긴다: 끔 → 테두리 → 민무늬
  expect(JSON.stringify(sets)).toContain('"look":"sticker"')
  expect(JSON.stringify(sets[sets.length - 1])).toContain('"look":"plain"')
  expect(sets.length).toBe(3)
  await ui.unmount()
})

test('저장해 둔 선택(테두리)을 새 세션이 그대로 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, store: { clawd: { on: true, look: 'sticker' } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png).toBe(PNG1)
  await ui.unmount()
})

test('다음 턴이 끝난 뒤 늦게 온 옛 턴의 종료·두 번 온 종료는 지금 상태를 건드리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const done = (turnId: string, reason: string) =>
    $.turn.complete({ answer: '', durationMs: 5000, isAborted: reason === 'aborted', turnId, reason } as any)
  await $.turn.start({ text: 'a', turnId: 'A' })
  await $.turn.start({ text: 'b', turnId: 'B' })
  await done('B', 'answer')
  await clock.advance(300)
  expect(await cap(ui, /^다 했어요!$/)).toBeDefined()
  await done('A', 'aborted') // 옛 턴의 늦은 종료: 축하를 지우지 않는다
  await clock.advance(300)
  expect(await cap(ui, /^다 했어요!$/)).toBeDefined()
  await clock.advance(3200)
  expect(await cap(ui, IDLE)).toBeDefined()
  await done('B', 'answer') // 같은 종료가 한 번 더 와도 축하를 되살리지 않는다
  await clock.advance(300)
  expect(await cap(ui, IDLE)).toBeDefined()
  await ui.unmount()
})

test('/clawd on·off·켜기·끄기, 모양 이름은 대소문자를 가리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await slash($, 'off')).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await slash($, 'off')).toMatchObject({ text: 'Clawd 껐어요' }) // 끈 채로 둔다(뒤집지 않는다)
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  expect(await slash($, 'ON')).toMatchObject({ text: 'Clawd 켰어요 (민무늬)' })
  expect(await slash($, '꺼')).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await slash($, '켜기')).toMatchObject({ text: 'Clawd 켰어요 (민무늬)' })
  expect(await slash($, 'Sticker')).toMatchObject({ text: 'Clawd 켰어요 (테두리)' })
  expect(await slash($, 'on')).toMatchObject({ text: 'Clawd 켰어요 (테두리)' }) // 켜기는 모양을 바꾸지 않는다
  expect(await slash($, 'PLAIN')).toMatchObject({ text: 'Clawd 켰어요 (민무늬)' })
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await ui.unmount()
})

test('Clawd 를 꺼 둔 채 그림을 못 그리는 터미널이면, 시계 blit 거부로 글자 시계로 바꾼다', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 59, 57).getTime() })
  engine(on, { clock: true, blitDeny: 'the Image draws its alt there', store: { clawd: { on: false, look: 'plain' } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'clock' })).toBeDefined()
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  await clock.advance(6000) // 11:00 을 넘겨 시계 blit → alt 거부
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^11:00  \d+\/\d+ \(.\)$/ })).toBeDefined()
  await ui.unmount()
})

test('글자 시계는 그림 시계가 붙어 있어도 지금 시각을 보인다(다른 화면)', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 59, 57).getTime() })
  engine(on, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const term = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect((await term.find({ type: 'Image', key: 'clock' }))?.props.alt).toBe('10:59')
  await clock.advance(6000)
  const phone = await $.ui.mount({ ...PANE(46), surface: 'mobile' })
  expect(await phone.find({ type: 'Text', text: /^11:00  \d+\/\d+ \(.\)$/ })).toBeDefined()
  expect((await term.find({ type: 'Image', key: 'clock' }))?.props.alt).toBe('10:59') // 그림 시계는 그대로(blit 으로 바뀜)
  await phone.unmount(); await term.unmount()
})

test('닫았던 패널을 /status-panel 로 다시 열면 시계 그림을 지금 시각으로 새로 그린다', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 59, 57).getTime() })
  const keyed: { key: string; png?: string; rgba?: string }[] = []
  engine(on, { clock: true, keyed })
  on('ui.panes', () => ({ value: [] })) // 닫혀 있다
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  let ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect((await ui.find({ type: 'Image', key: 'clock' }))?.props.alt).toBe('10:59')
  await clock.advance(6000)
  expect(keyed.filter(k => k.key === 'clock')).toHaveLength(1) // 11:00 은 blit 으로 나갔다
  await ui.unmount()
  await ($ as any).command.run({ command: 'status-panel', args: '' })
  ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect((await ui.find({ type: 'Image', key: 'clock' }))?.props.alt).toBe('11:00')
  await ui.unmount()
})

// ── 새 동작: 대답 기다림(ask) · 앗(oops) · 꾸벅꾸벅(sleepy) ──
test('대답 기다림: 권한 확인 창·질문 도구가 무엇보다 먼저, 끝나면 원래대로', async () => {
  expect(toolAct('AskUserQuestion')).toBe('ask')
  expect(toolAct('ExitPlanMode')).toBe('ask')
  const busy = base({ tools: [{ name: 'Bash', at: T }], turn: { usedTool: true }, subagents: true, oops: { until: T + 1000 }, celebrate: { act: 'happy', until: T + 1000 } })
  expect(pickAct({ ...busy, ask: true })).toBe('ask')
  // 질문 도구는 더 늦게 시작한 다른 도구가 있어도 대답 기다림
  expect(pickAct({ ...busy, tools: [{ name: 'AskUserQuestion', at: T - 5 }, { name: 'Read', at: T }] })).toBe('ask')
  expect(pickAct(busy)).toBe('work')
  expect(pickAct(base({ ask: true, night: true, now: T + 20 * 60_000 }))).toBe('ask')
  expect(CAP.ask).toEqual({ text: '대답 기다리는 중…', color: 'warning' })
})

test('앗: 실패·거절 뒤 2.4초는 생각·일하기보다 먼저, 새 도구는 그보다 먼저, 오류로 끝난 턴은 축하 대신', async () => {
  expect(isFailure({ deny: 'no' })).toBe(true)
  expect(isFailure({ result: 'x', isError: true })).toBe(true)
  expect(isFailure({ result: 'x' })).toBe(false)
  expect(isFailure({ result: 'x', isError: false })).toBe(false)
  expect(isFailure(undefined)).toBe(false)
  const oops = { until: T + OOPS_HOLD_MS }
  const hold = { act: 'read' as const, until: T + 1200 }
  expect(pickAct(base({ oops, hold, turn: { usedTool: true } }))).toBe('oops')
  expect(pickAct(base({ oops, turn: { usedTool: false }, now: T + OOPS_HOLD_MS - 1 }))).toBe('oops')
  expect(pickAct(base({ oops, turn: { usedTool: true }, now: T + OOPS_HOLD_MS }))).toBe('work')
  expect(pickAct(base({ oops, tools: [{ name: 'Grep', at: T }] }))).toBe('search')
  // 턴 종료: 오류면 앗, 정상이면 축하(앗 없음)
  expect(oopsFor('error', T)).toEqual({ until: T + OOPS_HOLD_MS })
  for (const r of ['answer', 'aborted', 'refusal']) expect(oopsFor(r, T)).toBeNull()
  expect(celebrationFor('error', 90_000, T)).toBeNull()
  expect(pickAct(base({ oops: oopsFor('error', T), celebrate: celebrationFor('error', 90_000, T) }))).toBe('oops')
  expect(pickAct(base({ oops: oopsFor('error', T), now: T + OOPS_HOLD_MS }))).toBe('idle')
  expect(CAP.oops).toEqual({ text: '앗, 막혔어요', color: 'error' })
})

test('꾸벅꾸벅: 밤(0:00~5:59)의 한가함만 바꾸고, 일·축하·작업·사용량 바닥보다 아래', async () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m).getTime()
  expect(isNight(at(0))).toBe(true)
  expect(isNight(at(3, 30))).toBe(true)
  expect(isNight(at(5, 59))).toBe(true)
  expect(isNight(at(6))).toBe(false)
  expect(isNight(at(12))).toBe(false)
  expect(isNight(at(23, 59))).toBe(false)
  const night = (o: Partial<ClawdLive> = {}) => base({ night: true, ...o })
  // 한가함 단계 모두(쉬는 중·한가해요·연)
  expect(pickAct(night())).toBe('sleepy')
  expect(pickAct(night({ now: T + 2 * 60_000 + 1 }))).toBe('sleepy')
  expect(pickAct(night({ now: T + 10 * 60_000 + 1 }))).toBe('sleepy')
  // 낮에는 그대로
  expect(pickAct(base({ night: false, now: T + 10 * 60_000 + 1 }))).toBe('kite')
  // 일보다 위로 오지 않는다
  expect(pickAct(night({ tools: [{ name: 'Edit', at: T }] }))).toBe('edit')
  expect(pickAct(night({ turn: { usedTool: false } }))).toBe('think')
  expect(pickAct(night({ subagents: true }))).toBe('cape')
  expect(pickAct(night({ celebrate: { act: 'happy', until: T + 1 } }))).toBe('happy')
  expect(pickAct(night({ jobs: true }))).toBe('coffee')
  expect(pickAct(night({ lowUsage: true }))).toBe('dizzy')
  expect(pickAct(night({ oops: { until: T + 1 } }))).toBe('oops')
  expect(CAP.sleepy).toEqual({ text: '꾸벅꾸벅…' })
  // 30분 넘게 쉬면 그대로 멈춘다(밤이라고 더 움직이지 않음)
  expect(isFrozen(night({ now: T + FREEZE_AFTER_MS + 1 }))).toBe(true)
})

test('엔진: 권한 확인 창이 열린 동안 대답 기다림, 그 호출이 끝나면 원래대로. 설정 훅이 대신 답하면 띄우지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  let release = (_: unknown) => {}
  const gate = new Promise(r => { release = r })
  on('tool.call', async () => { await gate; return { result: { stdout: 'ok' } } })
  let hookAnswers = false
  on('classic.PermissionRequest', () => (hookAnswers ? { decision: { behavior: 'allow' } } : {}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  const pending = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 사람에게 묻는다(아래 훅이 답하지 않음 → 창이 뜸): 결과는 그대로
  expect(((await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as any)) as any)?.decision).toBeUndefined()
  await clock.advance(300)
  expect(await cap(ui, /^대답 기다리는 중…$/)).toBeDefined()
  // 허락돼 도구가 끝나면 원래대로
  release(undefined)
  expect(await pending).toMatchObject({ result: { stdout: 'ok' } })
  await clock.advance(1500)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 설정 훅이 대신 답한 확인은 창이 안 뜨므로 대답 기다림이 아니다. 답은 바꾸지 않고 넘긴다
  hookAnswers = true
  expect(await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} } as any)).toMatchObject({ decision: { behavior: 'allow' } })
  await clock.advance(300)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 서브에이전트의 확인 창도 사용자 차례: 그 루프의 같은 도구 호출이 끝나면 닫힌다
  hookAnswers = false
  await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: {}, agent_id: 'a1' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^대답 기다리는 중…$/)).toBeDefined()
  expect(await $.tool.call({ tool: 'Write', file_path: '/x', content: '', agentId: 'a1' } as any)).toMatchObject({ result: { stdout: 'ok' } })
  await clock.advance(300)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  await ui.unmount()
})

test('엔진: 질문 도구(AskUserQuestion)가 도는 동안 대답 기다림, 답이 오면 바로 원래대로', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  let release = (_: unknown) => {}
  const gate = new Promise(r => { release = r })
  on('tool.call', async () => { await gate; return { result: { answers: { q: 'a' } } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await clock.advance(300)
  expect(await cap(ui, /^대답 기다리는 중…$/)).toBeDefined()
  await clock.advance(5000) // 오래 기다려도 그대로
  expect(await cap(ui, /^대답 기다리는 중…$/)).toBeDefined()
  release(undefined)
  expect(await pending).toMatchObject({ result: { answers: { q: 'a' } } })
  await clock.advance(200) // 1.2초 유지 없이 곧바로
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  await ui.unmount()
})

test('엔진: 실패·거절한 도구는 2.4초 앗, 그 뒤 원래대로. 결과는 그대로 넘긴다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('tool.call', (_: unknown, e: { tool: string }) =>
    e.tool === 'Bash' ? { result: { stdout: '', stderr: 'boom' }, isError: true } : e.tool === 'Write' ? { deny: 'no' } : { result: { stdout: 'ok' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  expect(await $.tool.call({ tool: 'Bash', command: 'false' } as any)).toMatchObject({ isError: true })
  await clock.advance(300)
  expect(await cap(ui, /^앗, 막혔어요$/)).toBeDefined()
  await clock.advance(1800) // 2.1초: 아직
  expect(await cap(ui, /^앗, 막혔어요$/)).toBeDefined()
  await clock.advance(500)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 거절도
  expect(await $.tool.call({ tool: 'Write', file_path: '/x', content: '' } as any)).toMatchObject({ deny: 'no' })
  await clock.advance(300)
  expect(await cap(ui, /^앗, 막혔어요$/)).toBeDefined()
  await clock.advance(2500)
  expect(await cap(ui, /^일하는 중…$/)).toBeDefined()
  // 성공한 도구는 앗이 아니다
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^읽는 중…$/)).toBeDefined()
  await ui.unmount()
})

test('엔진: 오류로 끝난 턴은 축하 대신 앗, 그 뒤 쉬기', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(300)
  await $.turn.complete({ answer: '', durationMs: 90_000, isAborted: false, turnId: 't1', reason: 'error' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^앗, 막혔어요$/)).toBeDefined()
  expect(await cap(ui, /^(다 했어요!|큰일을 끝냈어요!)$/)).toBeUndefined()
  await clock.advance(2500)
  expect(await cap(ui, IDLE)).toBeDefined()
  // 다음 턴은 축하(앗이 남지 않음)
  await $.turn.start({ text: 'y', turnId: 't2' })
  await clock.advance(300)
  await $.turn.complete({ answer: 'a', durationMs: 5000, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  await clock.advance(300)
  expect(await cap(ui, /^다 했어요!$/)).toBeDefined()
  await ui.unmount()
})
