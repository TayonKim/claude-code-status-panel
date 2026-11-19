import { expect, mock, test } from 'claude-code/testing'

import { clockSource } from '../hooks/clock'
import {
  BIG_TURN_MS, CAP, DIZZY_MS, FREEZE_AFTER_MS, OOPS_HOLD_MS, REST_GLYPH, SPIN_SEQ, TERM_DEFAULT, base64, celebrationFor, cellWidth, dizzyStart, frameAt, isFailure,
  isFrozen, isNight, msUntilChange, oopsFor, pickAct, pickMode, pickVariant, rasterCells, shiftRows, splitVariant, rasterWords, spinCells, spinGlyph, toolAct,
  usageAlarm, usageLevel,
} from '../hooks/clawd'
import { composeSlots, foldSlots, ownSlotWins, parseShare, planWrite, shareFileName, shareText } from '../hooks/share'
import type { Slot } from '../hooks/share'
import { spritePng } from '../hooks/theme'
import type { ClawdLive } from '../hooks/clawd'
import { soilRgb } from '../hooks/yard'

// Clawd: 동작 고르기(우선순위·1.2초 유지·축하·한가함 단계), Raster 칸(반 블록 색), 화면 방식, 훅이 결과를 그대로 넘기는지.
// 실행: claude plugin test .

const T = 1_000_000
const base = (o: Partial<ClawdLive> = {}): ClawdLive => ({
  now: T, tools: [], hold: null, turn: null, celebrate: null, subagents: false, jobs: false, dizzy: null, lastActivity: T, ...o,
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
    celebrate: { act: 'happy', until: T + 1000 }, jobs: true, dizzy: { until: T + 1000 },
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
  expect(pickAct(base({ now: T + 10 * 60_000 + 1, dizzy: { until: T + 10 * 60_000 + 2 } }))).toBe('dizzy')
  expect(pickAct(base({ now: T + 10 * 60_000 + 1, dizzy: { until: T + 10 * 60_000 + 1 } }))).toBe('kite') // 10초가 지나면 한가함으로
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
// 사용량 나누기 파일(하나를 여러 이름이 같이 쓴다: CLAUDE_CONFIG_DIR 해시와 상관없이). failRead: stat 은 되고 읽기만 실패(권한 등),
// writeGate: 그 쓰기를 문이 열릴 때까지 붙잡는다(이미 보낸 쓰기가 늦게 도착), paths: 쓴 자리
type ShareFile = {
  text: string | null; mtime: number; writes: string[]; reads: number; failWrite?: boolean; failRead?: boolean; tries?: number
  afterWrite?: () => void; writeGate?: (text: string) => Promise<unknown> | undefined; paths?: string[]
}
const SHARE_RE = /\/\.cache\/status-panel\/claude-usage(-v2)?(-[0-9a-f]{8})?\.json$/
const engine = (on: any, o: {
  usageGate?: { p: Promise<void> | null }; blitFn?: (key: string) => string | undefined; share?: ShareFile; sprites?: unknown; denyKey?: string
  usage?: () => { kind: string; percentUsed: number }[]; panes?: { v: unknown }; clock?: boolean; blitDeny?: string; blits?: { n: number; sent?: string[] }
  spins?: string[]; keyed?: { key: string; png?: string; rgba?: string }[]; images?: string[]; snap?: () => unknown; store?: Record<string, unknown>; sets?: unknown[]
  // env: 이름마다 값(함수면 그 답을 기다린다), stateGate: atom 쓰기를 붙잡는다(update 가 늦게 도착), blitHold: 그림 blit 의 답을 미룬다(답은 거부 글자)
  env?: Record<string, string | (() => Promise<string | undefined>)>; stateGate?: (e: { key: string; value: unknown }) => Promise<unknown> | undefined
  stateLog?: Record<string, unknown> // atom 마다 마지막으로 실제로 적힌 값(버전이 어긋나 빗나간 쓰기는 빼고)
  blitHold?: (key: string) => Promise<string | undefined> | undefined
  // stateAfter: 쓰기는 닿게 두고 그 성공 응답만 붙잡는다, onSet: atom 쓰기가 닿을 때마다 키를 알린다(그 쓰기를 기다리는 시험용)
  stateAfter?: (e: { key: string; value: unknown }) => Promise<unknown> | undefined
  onSet?: (key: string, value: unknown) => void
  // stateRead: atom 읽기의 답을 바꾼다(그 키에 다른 판이 적은 값이 있는 것처럼)
  stateRead?: (key: string, stored: { value?: unknown; version: number }) => { value?: unknown; version: number } | undefined
} = {}) => {
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
  on('env.get', async (_: unknown, e: { name: string }) => {
    const v = o.env?.[e.name]
    if (v !== undefined) return { value: typeof v === 'function' ? await v() : v }
    return { value: e.name === 'LANG' ? 'ko_KR.UTF-8' : e.name.startsWith('LC_') ? undefined : '/Users/someone' }
  })
  if (!o.clock) { on('clock.every', () => ({ value: undefined })); on('clock.now', () => ({ value: Date.now() })) }
  if (o.stateRead) on('state.get', async (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => {
    const r = await next(e) as { value: { value?: unknown; version: number } }
    const v = o.stateRead!(e.key, r.value)
    return v ? { value: v } : r
  })
  if (o.stateGate || o.stateLog || o.stateAfter || o.onSet) on('state.set', async (_: unknown, e: { key: string; value: unknown }, next: (e: unknown) => unknown) => {
    const g = o.stateGate?.(e)
    if (g) await g
    const r = await next(e) as { isSet?: boolean; value?: { isSet?: boolean } } | undefined
    const landed = r?.isSet !== false && r?.value?.isSet !== false
    if (o.stateLog && landed) o.stateLog[e.key] = e.value
    if (landed) o.onSet?.(e.key, e.value)
    const h = o.stateAfter?.(e)
    if (h) await h
    return r
  })
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', async () => {
    // usageGate: 그 순간의 값을 들고 문이 열릴 때까지 답을 미룬다(늦게 끝나는 읽기)
    const v = { startedAt: 0, context: {}, rateLimits: o.usage ? o.usage() : [] }
    const g = o.usageGate?.p
    if (g) await g
    return { value: v }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (SHARE_RE.test(e.path)) {
      if (!o.share || o.share.text === null) throw new Error('ENOENT')
      if (o.share.failRead) throw new Error('EACCES')
      o.share.reads++
      return { value: o.share.text }
    }
    return { value: JSON.stringify(o.sprites ?? SPRITES) }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (!o.share || o.share.text === null || !SHARE_RE.test(e.path)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: o.share.text.length, mtimeMs: o.share.mtime, isLink: false } }
  })
  on('fs.write', async (_: unknown, e: { path: string; text: string }) => {
    if (o.share && SHARE_RE.test(e.path)) { o.share.tries = (o.share.tries ?? 0) + 1; o.share.paths?.push(e.path); const g = o.share.writeGate?.(e.text); if (g) await g }
    if (!o.share || !SHARE_RE.test(e.path) || o.share.failWrite) throw new Error('EACCES')
    o.share.writes.push(e.text); o.share.text = e.text; o.share.mtime++
    o.share.afterWrite?.()
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', async (_: unknown, e: { key: string; source?: { png?: string; rgba?: string }; cells?: string }) => {
    const held = o.blitHold?.(e.key)
    if (held) { const d = await held; return { value: d ? { deny: d } : {} } }
    if (e.key !== 'spin' && !e.cells) o.images?.push(e.key)   // 그림(Image) blit 은 모두
    if (e.key === 'spin') o.spins?.push(e.cells ?? '')   // 설명 앞 표시
    else if (e.key === 'clawd') { if (o.blits) { o.blits.n++; o.blits.sent?.push(e.source?.png ?? '') } }
    else o.keyed?.push({ key: e.key, png: e.source?.png, rgba: e.source?.rgba })   // 시계·배터리·놀이터
    if (o.blitFn) { const d = o.blitFn(e.key); return { value: d ? { deny: d } : {} } }
    if (o.denyKey && e.key !== o.denyKey) return { value: {} }
    return { value: o.blitDeny ? { deny: o.blitDeny } : {} }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  if (o.panes) on('ui.panes', () => (o.panes!.v === null ? { value: undefined } : { value: o.panes!.v }))
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

test('터미널(fullscreen)에서는 맨 위 왼쪽에 그림, 옆에 요약과 설명', { timeoutMs: 15000 }, async ($, on) => {
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
  // 옆 글자(시안 '라'안): ● 여유 / 메모리 · 부하 / 표시 + 설명. 폭 44 면 옆 24칸이라
  // '메모리 58% 남음 · 부하 4.3/10'(29칸)이 안 들어가 메모리와 부하가 두 줄(Clawd 높이 안이라 줄 수는 같다)
  expect(await ui.find({ type: 'Text', text: /^메모리 58% 남음$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^부하 4\.3\/10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeUndefined()
  expect((await ui.find({ type: 'Raster', key: 'spin' }))?.props).toMatchObject({ columns: 1, rows: 1, cells: spinCells('idle', 0) })
  await ui.unmount()

  // 옆 폭이 모자라면 메모리와 부하를 두 줄로. 옆 16칸이면 '메모리 58% 남음'(15칸)은 그대로
  const w = await $.ui.mount({ ...PANE(36), surface: 'terminal', viewport: view })
  await w.drawn()
  expect(await w.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  expect(await w.find({ type: 'Text', text: /^메모리 58% 남음$/ })).toBeDefined()
  expect(await w.find({ type: 'Text', text: /^부하 4\.3\/10$/ })).toBeDefined()
  await w.unmount()
  // 가장 좁은 옆 칸(12칸): 메모리 글자를 짧은 쪽으로
  const w2 = await $.ui.mount({ ...PANE(32), surface: 'terminal', viewport: view })
  await w2.drawn()
  expect(await w2.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  expect(await w2.find({ type: 'Text', text: /^램 58% 남음$/ })).toBeDefined()
  expect(await w2.find({ type: 'Text', text: /메모리/ })).toBeUndefined()
  expect(await w2.find({ type: 'Text', text: /^부하 4\.3\/10$/ })).toBeDefined()
  await w2.unmount()

  // fullscreen 이 아니면 글자 방식: 요약 한 줄 위, Raster 38×16 아래
  const r = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: { ...view, isFullscreen: false } })
  await r.drawn()
  expect((await r.find({ type: 'Raster', key: 'clawd' }))?.props).toMatchObject({ columns: 38, rows: 16 })
  expect(await r.find({ type: 'Image' })).toBeUndefined()
  expect((await r.find({ type: 'Text', text: /여유 · 메모리 58% 남음 · 부하 4\.3\/10$/ }))).toBeDefined()
  expect(await r.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await r.find({ type: 'Raster', key: 'spin' })).toBeDefined()
  await r.unmount()

  // 좁으면 그림만 위, 요약은 아래 한 줄
  const n = await $.ui.mount({ ...PANE(28), surface: 'terminal', viewport: view })
  await n.drawn()
  expect(await n.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  // 한 줄에 다 안 들어가면(28칸) 메모리 글자를 짧은 쪽으로, 나머지는 끝이 잘린다
  expect((await n.find({ type: 'Text', text: /여유 · 램 58% 남음 · 부하/ }))).toBeDefined()
  expect(await n.find({ type: 'Text', text: IDLE })).toBeDefined()
  expect(await n.find({ type: 'Raster', key: 'spin' })).toBeDefined()
  await n.unmount()

  // 터미널이 아닌 표면: 그림 없이 첫 줄 + 설명 한 줄
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const d = await $.ui.mount({ ...PANE(44), surface })
    await d.drawn()
    expect(await d.find({ type: 'Image' })).toBeUndefined()
    expect(await d.find({ type: 'Text', text: IDLE })).toBeDefined()
    expect(await d.find({ type: 'Text', text: /여유 · 메모리 58% 남음 · 부하 4\.3\/10$/ })).toBeDefined()
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
    await scene($, '크게') // 같은 값이라도 다시 그려진다
    expect(await rendered()).toBe(first)
    expect(blits.sent.length).toBeGreaterThan(before)
  }
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

test('풍경: 그림 한 장으로 패널 폭 전체(기본은 크게: 배경 있는 9줄), 장면은 blit 으로만 바뀌고 다시 그릴 때 넘기는 그림은 처음 그대로, Clawd 를 꺼도 남고 /scene 끄기 면 사라진다', async ($, on) => {
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
  // 휴대폰 화면에는 없다. Clawd 를 꺼도 풍경은 남고(움직임도 계속), /scene 끄기 면 사라진다
  const phone = await $.ui.mount({ ...PANE(46), surface: 'mobile' })
  expect(await yard(phone)).toBeUndefined()
  await phone.unmount()
  await slash($, '끄기')
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  expect((await yard(ui))?.props).toMatchObject({ columns: 44, rows: 9 })
  const before = keyed.filter(k => k.key === 'yard').length
  await clock.advance(3000)
  expect(keyed.filter(k => k.key === 'yard').length).toBeGreaterThan(before) // 큰 Clawd 가 꺼져도 풍경은 blit 으로 움직인다
  await scene($, '끄기')
  expect(await yard(ui)).toBeUndefined()
  await ui.unmount()
})

test('/scene 끄기·작게·크게: 바로 바꾸고 저장(yard·bg 두 칸), 큰 Clawd 그림은 다시 보내지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: { key: string; value: { on?: boolean; bg?: boolean; yard?: boolean } }[] = []
  engine(on, { clock: true, sets: sets as unknown[] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  const rows = async () => ((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number } | undefined)?.rows
  const clawdPng = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png
  expect(await rows()).toBe(9) // 기본은 크게
  const big = await clawdPng()
  expect(await scene($, '작게')).toMatchObject({ text: '풍경: 작게' })
  expect(await rows()).toBe(3)
  expect(await clawdPng()).toBe(big) // 풍경을 바꿔도 큰 Clawd 그림은 다시 보내지 않는다
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, yard: true, bg: false } })
  expect(await scene($, '끄기')).toMatchObject({ text: '풍경: 끄기' })
  expect(await rows()).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined() // 큰 Clawd 는 그대로
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, yard: false, bg: true } })
  expect(await scene($, '크게')).toMatchObject({ text: '풍경: 크게' })
  expect(await rows()).toBe(9)
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: true, yard: true, bg: true } })
  // 영어 값·대소문자
  expect(await scene($, 'SMALL')).toMatchObject({ text: '풍경: 작게' })
  expect(await scene($, 'off')).toMatchObject({ text: '풍경: 끄기' })
  expect(await scene($, 'Full')).toMatchObject({ text: '풍경: 크게' })
  expect(await scene($, '켜기')).toMatchObject({ text: '사용법: /scene [끄기|작게|크게]' })
  // 큰 Clawd 를 꺼도 풍경 값은 그대로이고 보인다
  await slash($, '끄기')
  expect(await rows()).toBe(9)
  expect(await scene($, '작게')).toMatchObject({ text: '풍경: 작게' })
  expect(await rows()).toBe(3)
  expect(sets.at(-1)).toMatchObject({ key: 'clawd', value: { on: false, yard: true, bg: false } })
  await ui.unmount()
})

test('/clawd 는 켜기·끄기만: 옛 인자(테두리·민무늬·놀이터·배경)는 사용법, 풍경은 건드리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: { key: string; value: Record<string, unknown> }[] = []
  engine(on, { clock: true, sets: sets as unknown[], store: { clawd: { on: true, bg: false, yard: true } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  for (const a of ['테두리', '민무늬', 'sticker', 'plain', '놀이터', '놀이터 끄기', '배경', 'bg off', 'yard']) {
    expect(await slash($, a)).toMatchObject({ text: '사용법: /clawd [켜기|끄기]' })
  }
  expect(sets.length).toBe(0) // 사용법만 답하고 아무것도 저장하지 않는다
  expect(await slash($, '끄기')).toMatchObject({ text: 'Clawd 껐어요' })
  expect(sets.at(-1)!.value).toEqual({ on: false, yard: true, bg: false, theme: 'clawd' }) // 풍경 두 칸은 그대로, look 은 남기지 않는다
  expect(((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number }).rows).toBe(3)
  expect(await slash($)).toMatchObject({ text: 'Clawd 켰어요' })
  await ui.unmount()
})

test('저장해 둔 풍경 끄기를 새 세션이 그대로 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true, store: { clawd: { on: true, look: 'plain', bg: true, yard: false } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeDefined()
  await ui.unmount()
})

test('저장해 둔 풍경 작게(옛 판의 배경 끔)를 새 세션이 그대로 읽는다', async ($, on) => {
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
  await scene($, '끄기')
  expect(await look(30)).toEqual({ shown: 8, button: '접기 ▴', yard: 0 })
  await scene($, '크게')
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
  await scene($, '작게')
  expect(await look(44)).toEqual({ floor: 41, yard: true, fill: 0 })
  await scene($, '크게')
  await clock.advance(10 * 60_000 + 1000)
  expect(await look(44)).toEqual({ floor: 44, yard: true, fill: 0 }) // 커진 채 10분이 지나면 한 번에 내려간다
  // 3줄 넘게 커지면(창을 키운 때 등) 흙으로 채우지 않고 바로 한 번 내린다(초록이 너무 많아 보였다)
  expect(await look(41)).toEqual({ floor: 41, yard: true, fill: 0 })
  expect(await look(46)).toEqual({ floor: 46, yard: true, fill: 0 })
  // 놀이터를 끄면 바닥을 잊는다: 다시 켜면 그때 높이부터
  await scene($, '끄기')
  expect(await look(40)).toEqual({ floor: undefined, yard: false, fill: 0 })
  await scene($, '크게')
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
const scene = ($: any, args = '') => $.command.run({ command: 'scene', args })

test('/clawd: 끄고 켜기(그림은 늘 민무늬 벌), 패널이 닫혀 있으면 안내를 붙인다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: unknown[] = []
  const panes: { v: unknown } = { v: null } // null 이면 목록을 못 읽은 것(안내 없음)
  engine(on, { clock: true, sets, panes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const png = async () => ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string } | undefined)?.png
  const plain = [PNG_EVEN, PNG_ODD] // 어느 장면이든 plain 벌이면 둘 중 하나
  expect(plain).toContain(await png()) // 기본은 민무늬(plain) 벌
  expect(await slash($)).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'clock' })).toBeDefined() // 시계는 Clawd 와 따로
  expect(await cap(ui, /여유 · 메모리 58% 남음 · 부하 4\.3\/10$/)).toBeDefined() // 꺼지면 예전 첫 줄
  expect(await slash($, '켜기')).toMatchObject({ text: 'Clawd 켰어요' })
  expect(plain).toContain(await png())
  expect(await slash($, '뭐지')).toMatchObject({ text: expect.stringContaining('사용법') })
  // 바꿀 때마다 $.store 에 남긴다(끔 → 켬). 모양 값(look)은 남기지 않는다
  expect(sets.length).toBe(2)
  expect(JSON.stringify(sets)).not.toContain('look')
  // 패널이 닫혀 있으면(panes 에 없음·가려짐) 답 끝에 안내. panes 를 못 읽으면 붙이지 않는다
  // 패널 목록은 engine 의 panes 로 흉내 낸다(시험 중에 훅을 더 걸 수 없다)
  panes.v = []
  expect(await slash($, '끄기')).toMatchObject({ text: 'Clawd 껐어요 (패널이 닫혀 있어 지금은 안 보여요)' })
  panes.v = [{ id: 'status-panel', title: '', isShown: false, isFocused: false, isPlaced: true }]
  expect(await slash($, '켜기')).toMatchObject({ text: 'Clawd 켰어요 (패널이 닫혀 있어 지금은 안 보여요)' })
  panes.v = [{ id: 'status-panel', title: '', isShown: true, isFocused: false, isPlaced: true }]
  expect(await slash($, '켜기')).toMatchObject({ text: 'Clawd 켰어요' })
  expect(await scene($, '작게')).toMatchObject({ text: '풍경: 작게' })
  panes.v = []
  expect(await scene($, '크게')).toMatchObject({ text: '풍경: 크게 (패널이 닫혀 있어 지금은 안 보여요)' })
  await ui.unmount()
})

test('옛 판이 저장한 테두리(look sticker)도 민무늬로 그리고 오류가 없다. 다음 저장에서 look 은 빠진다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const sets: { key: string; value: Record<string, unknown> }[] = []
  engine(on, { clock: true, sets: sets as unknown[], store: { clawd: { on: true, look: 'sticker', bg: true, yard: true } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect([PNG_EVEN, PNG_ODD]).toContain(((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png)
  await clock.advance(1000)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: IDLE })).toBeDefined()
  await scene($, '작게')
  expect(sets.at(-1)!.value).toEqual({ on: true, yard: true, bg: false, theme: 'clawd' })
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

test('/clawd on·off·켜기·끄기는 대소문자를 가리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  engine(on, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await slash($, 'off')).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await slash($, 'off')).toMatchObject({ text: 'Clawd 껐어요' }) // 끈 채로 둔다(뒤집지 않는다)
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  expect(await slash($, 'ON')).toMatchObject({ text: 'Clawd 켰어요' })
  expect(await slash($, '꺼')).toMatchObject({ text: 'Clawd 껐어요' })
  expect(await slash($, '켜기')).toMatchObject({ text: 'Clawd 켰어요' })
  expect(await slash($, 'On')).toMatchObject({ text: 'Clawd 켰어요' })
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
  expect(pickAct(night({ dizzy: { until: Number.MAX_SAFE_INTEGER } }))).toBe('dizzy')
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

// ── 손님 틀(pickVariant) ──
const ACTS = Object.keys(CAP)
const plain = Object.fromEntries(ACTS.map((k, i) => [k, { label: k, ms: 100 + i, seq: [i, i + 1] }]))
const withGuests = {
  ...plain,
  'edit@mimic': { label: 'edit', ms: 50, seq: [7, 8, 9] },
  'edit@brute': { label: 'edit', ms: 70, seq: [3] },
  'oops@brute': { label: 'oops', ms: 90, seq: [4, 5] },
}

test('손님 틀: 손님이 없으면(기본 Clawd 등) 언제나 본래 상태 그대로, 프레임·남은 시간도 예전과 같다', async () => {
  for (const act of ACTS) for (let t0 = 0; t0 < 3000; t0 += 7) {
    expect(pickVariant(plain, act, T + t0)).toBe(act)
    const st = plain[pickVariant(plain, act, T + t0)]!
    expect(frameAt(st, T + t0, T + t0 + 555, false)).toBe(frameAt(plain[act]!, T + t0, T + t0 + 555, false))
    expect(msUntilChange(st, T + t0, T + t0 + 555, false)).toBe(msUntilChange(plain[act], T + t0, T + t0 + 555, false))
  }
  // 손님이 있는 테마라도 손님이 없는 상태는 그대로
  for (let t0 = 0; t0 < 500; t0++) expect(pickVariant(withGuests, 'think', t0)).toBe('think')
})

test('손님 틀: 반반으로 본래·손님(손님끼리는 고르게)', async () => {
  const n = 30_000
  const seen: Record<string, number> = {}
  for (let i = 0; i < n; i++) { const k = pickVariant(withGuests, 'edit', 1_700_000_000_000 + i * 137); seen[k] = (seen[k] ?? 0) + 1 }
  expect(Object.keys(seen).sort()).toEqual(['edit', 'edit@brute', 'edit@mimic'])
  const guestRate = 1 - seen.edit! / n
  expect(guestRate).toBeGreaterThan(0.47)
  expect(guestRate).toBeLessThan(0.53)
  const g1 = seen['edit@brute']! / (n - seen.edit!)
  expect(g1).toBeGreaterThan(0.45)
  expect(g1).toBeLessThan(0.55)
  // 손님 하나뿐인 상태도 반반 근처, 다른 상태의 손님은 섞이지 않는다
  let oops = 0
  for (let i = 0; i < n; i++) { const k = pickVariant(withGuests, 'oops', i * 1000 + 3); expect(['oops', 'oops@brute']).toContain(k); if (k !== 'oops') oops++ }
  expect(oops / n).toBeGreaterThan(0.47)
  expect(oops / n).toBeLessThan(0.53)
})

test('손님 틀: 같은 시작 시각이면 언제 다시 물어도 같은 것(다시 그려도 깜빡이지 않음)', async () => {
  for (let i = 0; i < 300; i++) {
    const t0 = 1_700_000_000_000 + i * 911
    const k = pickVariant(withGuests, 'edit', t0)
    for (let j = 0; j < 5; j++) expect(pickVariant({ ...withGuests }, 'edit', t0)).toBe(k)
  }
  // 열쇠 순서가 달라도 같은 답
  const rev = Object.fromEntries(Object.entries(withGuests).reverse())
  for (let i = 0; i < 300; i++) expect(pickVariant(rev, 'edit', i * 31)).toBe(pickVariant(withGuests, 'edit', i * 31))
})

test('손님 틀: 손님이 없으면 본래로, 열쇠 읽기는 "상태@소문자" 만', async () => {
  for (let i = 0; i < 200; i++) expect(pickVariant(plain, 'edit', i)).toBe('edit')
  expect(pickVariant({}, 'edit', 5)).toBe('edit')
  expect(splitVariant('edit@mimic')).toEqual(['edit', 'mimic'])
  expect(splitVariant('edit')).toBeNull()
  expect(splitVariant('@mimic')).toBeNull()
  expect(splitVariant('edit@Mimic')).toBeNull()
  expect(splitVariant('edit@a@b')).toBeNull()
  expect(splitVariant('edit@')).toBeNull()
})

// ── 큰 캐릭터 가운데 정렬(시안31 '가'안) 그리기: 모든 길(그림 Image·blit, 글자 방식 Raster)에 같은 dx ──
const CW = 38
const crow = (x0: number, x1: number) => Array.from({ length: CW }, (_, x) => (x >= x0 && x <= x1 ? 'a' : '.')).join('')
const cframe = (x0: number, x1: number, mark = 0) => Array.from({ length: 32 }, (_, y) => (y > 20 ? crow(x0, x1) : y === 5 ? crow(mark, mark) : '.'.repeat(CW)))
// 쉬기는 몸 x 2~25(가운데 자리 dx 5 = (37-25-2)/2), 생각은 둘째 장면의 소품이 x 35 까지라 dx 2. 그 밖의 동작은 쉬기 장면
const DX_SPRITES = {
  canvas: [38, 32], ground: 30, box: [19, 8], palette: { a: '#D97757' },
  frames: [cframe(2, 25, 2), cframe(2, 25, 3), cframe(2, 35, 2)],
  states: { ...Object.fromEntries(Object.keys(CAP).map(k => [k, { label: k, ms: 200, seq: [0, 1] }])), think: { label: 'think', ms: 200, seq: [0, 2] } },
  png: { plain: [], sticker: [] },
}
test('가운데 정렬: 쉬기는 dx 5, 생각은 dx 2 로 그리고, 장면이 같아도 dx 가 바뀌면 blit 으로 보낸다. Raster 도 같은 dx', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const blits = { n: 0, sent: [] as string[] }
  engine(on, { clock: true, blits, sprites: DX_SPRITES })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const sp = DX_SPRITES as any
  const P = (f: number, dx: number) => spritePng(sp, f, dx)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const first = ((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png
  expect([P(0, 5), P(1, 5)]).toContain(first)
  await clock.advance(1000)
  expect(blits.sent.length).toBeGreaterThan(0)
  for (const p of blits.sent) expect([P(0, 5), P(1, 5)]).toContain(p) // 쉬는 동안은 장면이 바뀌어도 같은 자리
  const n = blits.sent.length
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(1000)
  const think = blits.sent.slice(n)
  expect(think).toContain(P(0, 2)) // 장면 0 은 쉬기와 같지만 dx 가 달라 새 그림이 나간다
  expect(think).toContain(P(2, 2))
  for (const p of think) expect([P(0, 2), P(2, 2)]).toContain(p) // 생각 동작 안에서는 한 자리
  expect(((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png).toBe(first) // 다시 그리기로 source 를 바꾸지 않는다
  await ui.unmount()
  // 글자 방식(fullscreen 아님): 처음 그리기의 cells 가 지금 동작의 dx 로 민 도트
  const r = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: { ...VIEW, isFullscreen: false } })
  const cells = ((await r.find({ type: 'Raster', key: 'clawd' }))?.props as { cells: string }).cells
  expect([0, 2].map(f => rasterCells(shiftRows(sp.frames[f], 2), sp.palette))).toContain(cells)
  expect(cells).not.toBe(rasterCells(sp.frames[0], sp.palette))
  await r.unmount()
})

test('큰 Clawd 를 꺼 두면 풍경 blit 의 alt 거부로 그림을 못 그리는 터미널을 알아채 글자 방식으로 바꾼다', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 30, 5).getTime() })
  engine(on, { clock: true, blitDeny: 'the Image draws its alt there', denyKey: 'yard', store: { clawd: { on: false, bg: true, yard: true } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  expect(await ui.find({ type: 'Image', key: 'clawd' })).toBeUndefined()
  await clock.advance(3000) // 풍경 장면이 바뀌어 blit → alt 거부(시계는 분이 안 바뀌어 보내지 않는다)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^10:30  \d+\/\d+ \(.\)$/ })).toBeDefined()
  await ui.unmount()
})

test('큰 Clawd 를 꺼 둔 채 모르는 거부가 이어져도 세 번째에 글자 방식', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 30, 5).getTime() })
  engine(on, { clock: true, blitDeny: 'refused for a reason this mod does not know', denyKey: 'yard', store: { clawd: { on: false } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  await clock.advance(20_000)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

// ── 사용량 경고 반응(사용자 2026-11-18): 90·95·100% 를 넘을 때 한 번, 한가할 때 10초 ──
test('usageAlarm: 단계가 오를 때만, 세션 첫 읽기에서 이미 넘었어도 한 번, 리셋되면 기록을 지운다', () => {
  expect([89.9, 90, 94.9, 95, 99.9, 100, 120].map(usageLevel)).toEqual([0, 1, 1, 2, 2, 3, 3])
  const w = (five: number, week = 10) => [{ kind: 'five_hour', usedPct: five }, { kind: 'seven_day', usedPct: week }]
  let a = usageAlarm({}, w(50)); expect(a).toEqual({ levels: {}, fired: false })
  a = usageAlarm(a.levels, w(90)); expect(a.fired).toBe(true); expect(a.levels).toEqual({ five_hour: 1 })
  a = usageAlarm(a.levels, w(93)); expect(a.fired).toBe(false) // 같은 단계는 다시 안 뜬다
  a = usageAlarm(a.levels, w(95)); expect(a.fired).toBe(true)
  a = usageAlarm(a.levels, w(97)); expect(a.fired).toBe(false)
  a = usageAlarm(a.levels, w(100)); expect(a.fired).toBe(true)
  a = usageAlarm(a.levels, w(100)); expect(a.fired).toBe(false)
  a = usageAlarm(a.levels, w(3)); expect(a).toEqual({ levels: {}, fired: false }) // 리셋: 기록을 지운다
  a = usageAlarm(a.levels, w(91)); expect(a.fired).toBe(true) // 다시 넘으면 또
  // 창마다 따로: 주간이 넘는 것도 뜬다
  a = usageAlarm(a.levels, w(91, 92)); expect(a.fired).toBe(true); expect(a.levels).toEqual({ five_hour: 1, seven_day: 1 })
  // 세션 첫 읽기(앞 기록 없음)에서 이미 넘었으면 한 번
  expect(usageAlarm({}, w(96)).fired).toBe(true)
  expect(usageAlarm({}, []).fired).toBe(false)
})

test('dizzyStart: 한가한 동작일 때만 10초를 시작하고, 바쁘면 미룬다. 10초가 지나면 평소 동작', () => {
  expect(DIZZY_MS).toBe(10_000)
  expect(dizzyStart(base())).toEqual({ until: T + DIZZY_MS })
  expect(dizzyStart(base({ now: T + 3 * 60_000 }))).toEqual({ until: T + 3 * 60_000 + DIZZY_MS }) // 방울 중에도
  expect(dizzyStart(base({ turn: { usedTool: false } }))).toBeNull()
  expect(dizzyStart(base({ tools: [{ name: 'Read', at: T }] }))).toBeNull()
  expect(dizzyStart(base({ jobs: true }))).toBeNull() // 작업 대기(커피)는 dizzy 보다 먼저
  expect(dizzyStart(base({ subagents: true }))).toBeNull()
  expect(dizzyStart(base({ celebrate: { act: 'happy', until: T + 1 } }))).toBeNull()
  const d = { until: T + DIZZY_MS }
  expect(pickAct(base({ dizzy: d }))).toBe('dizzy')
  expect(pickAct(base({ dizzy: d, now: T + DIZZY_MS }))).toBe('idle')
  expect(pickAct(base({ dizzy: d, jobs: true }))).toBe('coffee')
  // 30분 넘게 쉬어 멈춘 동안에도 경고 10초는 움직인다
  expect(isFrozen(base({ now: T + FREEZE_AFTER_MS + 1, dizzy: { until: T + FREEZE_AFTER_MS + 5000 } }))).toBe(false)
})

test('엔진: 90% 를 넘는 순간 10초 사용량 경고, 그 뒤 평소 동작. 계속 낮아도 다시 안 뜨고, 바쁠 때 넘으면 한가해진 뒤에', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 14, 0, 0).getTime() }) // 낮(꾸벅꾸벅이 아니게)
  let pct = 50
  engine(on, { clock: true, usage: () => [{ kind: 'five_hour', percentUsed: pct }] })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  const DIZZY = /^사용량이 바닥나요$/
  await clock.advance(6000)
  expect(await cap(ui, DIZZY)).toBeUndefined()
  pct = 91
  await clock.advance(5100) // 다음 사용량 읽기
  expect(await cap(ui, DIZZY)).toBeDefined()
  await clock.advance(10_100)
  expect(await cap(ui, DIZZY)).toBeUndefined()
  expect(await cap(ui, /^쉬는 중$/)).toBeDefined()
  await clock.advance(60_000) // 계속 91%: 다시 뜨지 않는다
  expect(await cap(ui, DIZZY)).toBeUndefined()
  // 바쁠 때 95% 를 넘으면 미뤘다가, 턴이 끝나고 축하(3초)가 지나 한가해지면 10초
  await $.turn.start({ text: 'x', turnId: 't1' })
  pct = 96
  await clock.advance(5100)
  expect(await cap(ui, /^생각하는 중…$/)).toBeDefined()
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(1000)
  expect(await cap(ui, /^다 했어요!$/)).toBeDefined()
  await clock.advance(2500)
  expect(await cap(ui, DIZZY)).toBeDefined()
  await clock.advance(10_100)
  expect(await cap(ui, DIZZY)).toBeUndefined()
  // 리셋(아래로) 뒤 다시 넘으면 또
  pct = 5
  await clock.advance(5100)
  pct = 90
  await clock.advance(5100)
  expect(await cap(ui, DIZZY)).toBeDefined()
  await ui.unmount()
})

test('엔진: 세션 시작 때 이미 90% 넘었으면 한 번 10초', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 14, 0, 0).getTime() })
  engine(on, { clock: true, usage: () => [{ kind: 'seven_day', percentUsed: 97 }] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await clock.advance(500)
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeDefined()
  await clock.advance(10_100)
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  await clock.advance(30_000)
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  await ui.unmount()
})

// ── 사용량 나누기(hooks/share.ts, 0.8.9 칸 구조): 세션마다 자기 칸만 ~/.cache/status-panel/claude-usage-v2*.json 에 적고, 화면은 모든 칸을 한 번에 본다 ──
// 시각은 엔진 시계(T0) 하나로만 잡는다(실제 Date.now 와 섞지 않는다: 검수 11-19). 자기 값이 파일에 가려면 나이를 알아야 하므로
// (처음 본 값은 나이 모름) 시험은 '응답 전에는 비어 있다가 값이 생기는' 실제 순서로 시작한다
const T0 = new Date(2026, 10, 16, 14, 0, 0).getTime()
const T0S = Math.floor(T0 / 1000)
const left = (ui: any, n: number) => ui.find({ type: 'Text', text: new RegExp(`^ ${n}% 남음$`) })
const usageNow = (pct: number, resetIn = 3600) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: new Date(T0 + resetIn * 1000).toISOString() }]
const obs = (pct: number, at: number, resetIn = 3600) => ({ kind: 'five_hour', usedPct: pct, resetsAt: T0S + resetIn, at })
const OTHER = 'other-1', OTHER2 = 'other-2'
const fileOf = (...slots: Slot[]) => shareText(slots)
const slotsOf = (text: string | null) => parseShare(text ?? '')?.slots ?? []
const mySlot = (text: string | null) => slotsOf(text).find(s => !s.id.startsWith('other'))
/** 마지막으로 적힌 자기 값 atom(모양 꼬리표가 있으면 벗긴다) */
const ownState = (log: Record<string, unknown>) => { const v = log.claudeOwn2 as { value?: unknown } | undefined; return ((v && 'value' in v ? v.value : v) ?? { wins: [] }) as { wins: { usedPct: number }[] } }
const CORRUPT = '{"v":2,"slots":[{"id":"a","seq":1,"windows":[{"kind":"five_'
const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
/** 엔진 시험의 시작: 응답 전(자기 값 없음)의 첫 읽기까지 */
const shareStart = async ($: any, on: any, o: Parameters<typeof engine>[1]) => {
  const clock = mock.clock(on, { now: T0 })
  engine(on, { clock: true, ...o })
  await $.session.start(SESSION)
  await clock.advance(300)
  return clock
}

test('사용량 나누기: 자기 값이 바뀌면 자기 칸만 적고, 남의 칸이 바뀌면 자기 값이 그대로여도 화면이 바뀐다. 변화가 없으면 다시 적지도 읽지도 않는다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  expect(share.writes.length).toBe(0) // 아직 응답이 없다
  mine = usageNow(20)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  // 파일이 없었으니 자기 칸 하나(창 종류 이름과 숫자만)
  expect(share.writes.length).toBe(1)
  const w0 = JSON.parse(share.writes[0]!)
  expect(Object.keys(w0).sort()).toEqual(['slots', 'v'])
  expect(w0.v).toBe(2)
  expect(w0.slots).toHaveLength(1)
  expect(Object.keys(w0.slots[0]).sort()).toEqual(['id', 'seq', 'windows'])
  expect(Object.keys(w0.slots[0].windows[0]).sort()).toEqual(['at', 'kind', 'resetsAt', 'usedPct'])
  expect(w0.slots[0].windows).toEqual([obs(20, T0S + 5)]) // at = 값이 바뀐 것을 본 폴링의 엔진 시각
  // 30초 동안 변화가 없으면 다시 적지도, 다시 읽지도 않는다
  const reads = share.reads
  await clock.advance(30_000)
  expect(share.writes.length).toBe(1)
  expect(share.reads).toBeLessThanOrEqual(reads + 1) // 자기가 적은 직후 한 번까지만
  // 다른 세션이 자기 칸에 더 새 값을 적었다(이 세션의 칸은 그대로 옮겨서): 자기 값은 그대로여도 화면이 바뀐다
  const me = w0.slots[0] as Slot
  const other = { id: OTHER, seq: 1, windows: [obs(55, T0S + 30)] }
  share.text = fileOf(me, other); share.mtime += 5
  await clock.advance(5000)
  expect(await left(ui, 45)).toBeDefined()
  expect(share.writes.length).toBe(1) // 자기 칸은 그대로라 적을 것이 없다
  // 자기 값이 바뀌면(이 세션이 응답을 받음) 자기 칸만 바꾸고 남의 칸은 본 그대로 옮긴다
  mine = usageNow(60)
  await clock.advance(5000)
  expect(await left(ui, 40)).toBeDefined()
  expect(share.writes.length).toBe(2)
  expect(slotsOf(share.writes[1]!).find(s => s.id === OTHER)).toEqual(other)
  expect(mySlot(share.writes[1]!)).toEqual({ id: me.id, seq: me.seq + 1, windows: [obs(60, T0S + 45)] })
  expect(slotsOf(share.writes[1]!)).toHaveLength(2)
  await ui.unmount()
})

test('사용량 나누기: 파일이 없거나 깨졌거나 쓰기가 실패해도 자기 값으로 지금처럼. 쓰기가 실패하면 그때부터 60초 뒤에 다시', { timeoutMs: 30000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0, failWrite: true }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(30)
  await clock.advance(5000) // T0+5: 쓰기 실패
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 70)).toBeDefined()
  expect(share.tries).toBe(1)
  // 쓰는 중에 읽어 깨진 글자: 이번 틱은 기억으로(자기 값), 쓰지도 않는다
  share.failWrite = false
  share.text = CORRUPT; share.mtime++
  await clock.advance(5000)
  expect(await left(ui, 70)).toBeDefined()
  expect(share.tries).toBe(1)
  // 다음 틱에 다 쓰인 파일을 읽는다. 다시 쓰는 것은 실패한 때(T0+5)부터 60초 뒤
  share.text = fileOf(); share.mtime++
  await clock.advance(5000)
  expect(share.tries).toBe(1)
  await clock.advance(45_000) // T0+60
  expect(share.tries).toBe(1)
  await clock.advance(5000) // T0+65
  expect(share.writes.length).toBe(1)
  await ui.unmount()
})

test('사용량 나누기: 다른 세션 값으로 90% 를 넘으면 10초 사용량 경고', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: fileOf(), mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(50)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 50)).toBeDefined()
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  share.text = fileOf(mySlot(share.text)!, { id: OTHER, seq: 1, windows: [obs(92, T0S + 9)] }); share.mtime++
  await clock.advance(5000)
  expect(await left(ui, 8)).toBeDefined()
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeDefined()
  await clock.advance(10_100)
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  await ui.unmount()
})

test('사용량 나누기: 나이 모르는 자기 값(이 프로세스에서 갓 올림)은 파일에 적지 않고, 다른 관측이 있으면 화면에도 쓰지 않는다. 바뀌면 그때부터 적는다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: fileOf({ id: OTHER, seq: 1, windows: [obs(40, T0S - 7200)] }), mtime: 1, writes: [], reads: 0 }
  let mine = usageNow(60) // 첫 읽기부터 값이 있다: 언제 받은 것인지 모른다
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 60)).toBeDefined() // 두 시간 전의 40%(남의 관측)
  expect(share.writes.length).toBe(0)
  mine = usageNow(61)
  await clock.advance(5000)
  expect(await left(ui, 39)).toBeDefined()
  expect(mySlot(share.text)?.windows).toEqual([obs(61, T0S + 15)])
  await ui.unmount()
})

test('사용량 나누기: 다시 연 뒤(atom 은 남고 모듈 기억은 처음부터) 묵은 자기 값이 다른 세션의 더 새 값을 이기지 않고, 그대로인 자기 칸을 다시 적지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(20)
  await clock.advance(5000)
  expect(share.writes.length).toBe(1)
  await clock.advance(60_000)
  // 그사이 다른 세션이 더 새 값을 적었다(값은 일부러 더 작게: 시각으로 가려야만 남의 값이 이긴다)
  share.text = fileOf(mySlot(share.text)!, { id: OTHER, seq: 1, windows: [obs(10, T0S + 55)] }); share.mtime++
  // 같은 모듈에서 세션이 다시 열린다. 자기 값은 여전히 묵은 20%(atom 의 받은 시각 T0+5 그대로)
  await $.session.start(SESSION)
  await clock.advance(5300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 90)).toBeDefined()
  expect(share.writes.length).toBe(1)
  await ui.unmount()
})

test('사용량 나누기: 앞 세션의 늦게 끝난 읽기(96%)가 새 세션이 적은 값(20%)을 덮지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  let release = () => {}
  const gate: { p: Promise<void> | null } = { p: null }
  const clock = await shareStart($, on, { share, usage: () => mine as any, usageGate: gate })
  mine = usageNow(96); gate.p = new Promise<void>(r => { release = r })
  await clock.advance(5000) // 앞 세션의 읽기가 96% 를 들고 멈춰 있다
  gate.p = null; mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  expect(share.writes.map(w => mySlot(w)!.windows[0]!.usedPct)).toEqual([20])
  release() // 이제 앞 세션의 읽기가 끝난다
  await clock.advance(11_000)
  expect(share.writes.map(w => mySlot(w)!.windows[0]!.usedPct)).toEqual([20])
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined() // 앞 세션의 96% 로 경고를 세우지도 않는다
  await ui.unmount()
})

// ── 0.8.8 재검수(astra 11-19)가 재현한 경우들: 0.8.8 코드나 조건을 지운 코드에서는 실패한다 ──
test('재검수: 앞 세션이 이미 보낸 파일 쓰기(96%)가 새 세션 쓰기 뒤에 도착해도 새 세션 화면은 20% 그대로, 다음 틱에 파일을 고친다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  share.writeGate = () => { share.writeGate = undefined; return held } // 앞 세션의 첫 쓰기만 붙잡는다
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(96)
  await clock.advance(5000) // 앞 세션이 96% 를 쓰기 시작했다(아직 안 닿음)
  mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  release() // 옛 쓰기가 이제 닿는다: 파일의 (같은 프로세스) 칸이 96%
  await clock.advance(100)
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(96)
  expect(await left(ui, 80)).toBeDefined()
  await clock.advance(5000) // 새 세션의 다음 틱: 자기 칸이 다르다 → 다시 적는다
  expect(await left(ui, 80)).toBeDefined()
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(20)
  await ui.unmount()
})

test('재검수: 앞 세션의 늦게 도착한 atom 쓰기(자기 값 96%)가 새 세션의 자기 값(20%)을 덮지 않는다(update 가 콜백을 다시 불러도)', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  const log: Record<string, unknown> = {}
  let mine: unknown[] = []
  const clock = await shareStart($, on, {
    share, usage: () => mine as any, stateLog: log,
    stateGate: e => (e.key === 'claudeOwn2' && !gated && JSON.stringify(e.value).includes('"usedPct":96') ? (gated = true, held) : undefined),
  })
  mine = usageNow(96)
  await clock.advance(5000) // 앞 세션의 자기 값 쓰기가 붙잡혔다
  expect(gated).toBe(true)
  mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  expect(ownState(log).wins.map(w => w.usedPct)).toEqual([20])
  release()
  await clock.advance(100)
  expect(ownState(log).wins.map(w => w.usedPct)).toEqual([20])
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  await ui.unmount()
})

test('재검수: 앞 세션의 늦게 도착한 화면 atom 쓰기(96%)가 새 세션 화면(20%)을 덮지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, {
    share, usage: () => mine as any,
    stateGate: e => (e.key === 'claudeView' && !gated && JSON.stringify(e.value).includes('"usedPct":96') ? (gated = true, held) : undefined),
  })
  mine = usageNow(96)
  await clock.advance(5000)
  expect(gated).toBe(true)
  mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  release()
  await clock.advance(100)
  expect(await left(ui, 80)).toBeDefined()
  expect(await left(ui, 4)).toBeUndefined()
  await ui.unmount()
})

test('재검수: 같은 창에서 값이 내려가면(96% → 5초 뒤 5%) 곧바로 5%, 60초 뒤에도 그대로', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(96)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 4)).toBeDefined()
  mine = usageNow(5)
  await clock.advance(5000)
  expect(await left(ui, 95)).toBeDefined()
  await clock.advance(60_000)
  expect(await left(ui, 95)).toBeDefined()
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(5)
  await ui.unmount()
})

test('재검수: 세 관측(90%@t-15·50%@t-5·자기 10%@t+5)은 돌아가며 이기지 않고 가장 새 관측 하나로 머문다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: fileOf({ id: OTHER, seq: 1, windows: [obs(90, T0S - 15)] }, { id: OTHER2, seq: 1, windows: [obs(50, T0S - 5)] }), mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 50)).toBeDefined() // 90% 는 50% 보다 10초 오래됐다
  mine = usageNow(10)
  await clock.advance(5000)
  for (let i = 0; i < 6; i++) {
    expect(await left(ui, 90)).toBeDefined()
    await clock.advance(5000)
  }
  expect(share.writes.length).toBe(1)
  expect(slotsOf(share.text).map(s => s.windows[0]!.usedPct).sort((a, b) => a - b)).toEqual([10, 50, 90]) // 남의 칸은 그대로
  await ui.unmount()
})

test('재검수: 만료 경계의 두 세션(지난 96% 창·399초 남은 30% 창)이 5초마다 번갈아 쓰지 않는다', { timeoutMs: 30000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(96, 8) // 이 세션: 높은 값, 창은 8초 뒤 끝난다
  // 다른 세션 B(같은 규칙을 순수 함수로): 틱마다 파일을 읽고 자기 칸이 다르면 적는다
  const b = { id: OTHER, seq: 0, mem: [] as Slot[] }
  let bWrites = 0
  const bTick = (nowS: number) => {
    const r = parseShare(share.text ?? '') ?? { slots: [] }
    b.mem = foldSlots(b.mem, r.slots, nowS)
    const myObs = ownSlotWins([{ kind: 'five_hour', usedPct: 30, resetsAt: T0S + 399 }], { five_hour: T0S }, nowS)
    if (!planWrite(r, b.mem, b.id, myObs, nowS)) return
    const slots = composeSlots(b.mem, b.id, ++b.seq, myObs, nowS)
    b.mem = foldSlots(b.mem, slots, nowS)
    share.text = shareText(slots); share.mtime++; bWrites++
  }
  for (let i = 1; i <= 20; i++) {
    await clock.advance(5000)
    bTick(T0S + i * 5 + 2)
  }
  expect(share.writes.length).toBe(1) // 이 세션은 창이 끝나기 전에 한 번만
  expect(bWrites).toBe(1)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 70)).toBeDefined()
  await ui.unmount()
})

test('재검수: 60초 넘게 미래인 남의 칸을 첫 틱이 지우지 않고(자기 칸을 적어도 그대로 옮긴다), 시계가 따라잡으면 보인다', { timeoutMs: 20000 }, async ($, on) => {
  const fut = { id: OTHER, seq: 1, windows: [obs(75, T0S + 70)] }
  const share: ShareFile = { text: fileOf(fut), mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  expect(share.writes.length).toBe(0)
  expect(slotsOf(share.text)).toEqual([fut])
  mine = usageNow(20)
  await clock.advance(5000) // T0+5: 75% 는 아직 65초 미래
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  expect(share.writes.length).toBe(1)
  expect(slotsOf(share.text).find(s => s.id === OTHER)).toEqual(fut)
  await clock.advance(5000) // T0+10: 60초 안으로 들어왔다
  expect(await left(ui, 25)).toBeDefined()
  await ui.unmount()
})

test('재검수: 파일을 못 읽는 동안에도 리셋 시각이 지난 파일 값(96%)은 화면에서 빠진다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  mine = usageNow(10, 30)
  await clock.advance(5000)
  share.text = fileOf(mySlot(share.text)!, { id: OTHER, seq: 1, windows: [obs(96, T0S + 10, 30)] }); share.mtime++
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 4)).toBeDefined()
  share.failRead = true; share.mtime++ // 이제 계속 못 읽는다
  await clock.advance(5000)
  expect(await left(ui, 4)).toBeDefined() // 아직 창이 안 끝났다: 기억해 둔 값
  await clock.advance(20_000) // T0+35: 그 창(T0+30)이 끝났다
  expect(await left(ui, 4)).toBeUndefined()
  expect(await left(ui, 90)).toBeDefined() // 자기 값(그 창도 지나 '리셋 지남')
  await ui.unmount()
})

test('재검수: 자기 값이 없어도(응답 전) 오래 깨진 파일은 세 틱 뒤에 고친다', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: CORRUPT, mtime: 1, writes: [], reads: 0 }
  const clock = await shareStart($, on, { share, usage: () => [] })
  await clock.advance(5000)
  expect(share.tries ?? 0).toBe(0)
  await clock.advance(5000) // 세 번째로 같은 모양 그대로 깨져 있다
  expect(share.writes.length).toBe(1)
  expect(parseShare(share.text!)).toEqual({ slots: [] })
  await clock.advance(20_000)
  expect(share.writes.length).toBe(1)
})

test('재검수: 깨진 파일을 세는 사이에 읽기 오류가 끼면 처음부터 다시 센다', { timeoutMs: 30000 }, async ($, on) => {
  const share: ShareFile = { text: CORRUPT, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any }) // 1번째
  mine = usageNow(30)
  await clock.advance(5000) // 2번째
  share.failRead = true
  await clock.advance(5000) // 읽기 오류: 이어진 것이 아니다
  share.failRead = false
  await clock.advance(5000) // 다시 1번째
  await clock.advance(5000) // 2번째
  expect(share.tries ?? 0).toBe(0)
  await clock.advance(5000) // 3번째: 고친다
  expect(share.writes.length).toBe(1)
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(30)
})

test('재검수: 쓰기가 오래 걸린 뒤 실패하면 재시도 기한은 실패한 때부터 60초(시작한 때부터가 아니다)', { timeoutMs: 30000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0, failWrite: true }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  share.writeGate = () => { share.writeGate = undefined; return clock.sleep(65_000) } // 첫 쓰기는 65초 걸려 실패한다
  mine = usageNow(30)
  await clock.advance(5000) // T0+5: 쓰기 시작
  await clock.advance(65_500) // T0+70: 실패. 그사이 밀린 읽기가 곧바로 한 번 돈다
  expect(share.tries).toBe(1)
  await clock.advance(55_000) // T0+125.5: 실패한 때부터 아직 60초가 안 됐다
  expect(share.tries).toBe(1)
  await clock.advance(10_000) // T0+135.5
  expect(share.tries).toBe(2)
})

test('재검수: 바쁠 때 넘어 미뤄 둔 경고는 띄우는 순간의 화면 값을 본다(파일을 못 읽는 사이 새 창 5% 로 바뀌었으면 버린다)', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  mine = usageNow(96)
  await clock.advance(5000) // 바쁠 때 넘었다: 미룬다
  share.failRead = true; share.mtime++ // 이제 파일을 못 읽는다
  mine = usageNow(5, 5 * 3600) // 리셋 뒤의 새 창
  await clock.advance(5000)
  expect(await left(ui, 95)).toBeDefined()
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  for (let i = 0; i < 15; i++) {
    await clock.advance(1000)
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  }
  expect(await left(ui, 95)).toBeDefined()
  await ui.unmount()
})

test('재검수: 파일 자리는 세션 시작 때 정한 것으로 끝까지(앞 세션의 늦은 CLAUDE_CONFIG_DIR 답이 새 세션의 자리를 바꾸지 않는다)', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let asked = 0
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0, paths: [] }
  let mine: unknown[] = []
  const clock = await shareStart($, on, {
    share, usage: () => mine as any,
    env: { CLAUDE_CONFIG_DIR: async () => (asked++ === 0 ? (await held, '/cfg/old') : '/cfg/new') },
  })
  mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  expect(share.paths!.length).toBe(1)
  release() // 앞 세션의 답이 이제 온다
  await clock.advance(5000)
  mine = usageNow(75)
  await clock.advance(5000)
  expect(share.paths!.length).toBe(2)
  for (const p of share.paths!) expect(p.endsWith(`/.cache/status-panel/${shareFileName('/cfg/new')}`)).toBe(true)
})

test('사용량 나누기: 쓴 직후 다른 세션이 덮어써 파일의 크기·시각이 쓰기 전과 같아져도(쓰기 전 판이 기억에 있다) 다음 틱에 다시 읽는다', { timeoutMs: 20000 }, async ($, on) => {
  // 쓰기 전 판(c1)과 다른 세션이 덮어쓴 판(c3)은 글자 수가 같고, 다른 세션은 시각(mtime)까지 c1 의 것으로 돌려놓는다.
  // 쓴 뒤에 기억(크기·시각 → 내용)을 비우지 않으면 c3 를 c1 으로 알고 다른 세션의 75% 를 못 본다(검수: 그 줄을 지워도 통과하던 시험)
  const c1 = fileOf({ id: OTHER, seq: 1, windows: [obs(25, T0S - 100)] })
  const c3 = fileOf({ id: OTHER, seq: 2, windows: [obs(75, T0S + 6)] })
  expect(c3.length).toBe(c1.length)
  const share: ShareFile = { text: c1, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 75)).toBeDefined() // c1 을 읽어 기억했다
  share.afterWrite = () => { share.afterWrite = undefined; share.text = c3; share.mtime = 1 }
  mine = usageNow(20)
  await clock.advance(5000) // 자기 칸을 적자마자 다른 세션이 (이 세션의 칸 없이) c3 로 덮었다
  expect(share.writes.length).toBe(1)
  await clock.advance(5000)
  expect(await left(ui, 25)).toBeDefined() // 다른 세션의 75%(8초 안: 큰 값)
  expect(share.writes.length).toBe(2) // 잃은 자기 칸을 다시 적는다(남의 새 칸은 그대로)
  expect(slotsOf(share.text).find(s => s.id === OTHER)!.seq).toBe(2)
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(20)
  await ui.unmount()
})

// ── 0.8.9 검수(astra 11-19) 반영 ──
test('검수 0.8.9: 앞 세션의 시작 쓰기(세대 올리기)가 늦게 다시 불려도 새 세션의 세대를 빼앗지 못한다(새 세션의 파일·화면이 계속 바뀐다)', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  engine(on, {
    clock: true, share, usage: () => mine as any,
    stateGate: e => (e.key === 'claudeOwn2' && !gated && /"gen":1\b/.test(JSON.stringify(e.value)) ? (gated = true, held) : undefined),
  })
  const first = $.session.start(SESSION) // 이 세션의 시작은 세대를 올리는 쓰기에서 멈춰 있다
  await clock.advance(300)
  expect(gated).toBe(true)
  await $.session.start(SESSION)
  await clock.advance(300)
  mine = usageNow(20)
  await clock.advance(5000)
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(20)
  release() // 옛 시작의 쓰기가 이제 닿는다: 버전이 어긋나 콜백이 다시 불린다
  await first
  await clock.advance(300)
  mine = usageNow(75)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 25)).toBeDefined()
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(75)
  await ui.unmount()
})

test('검수 0.8.9: 옛 판(0.8.8)이 쓰던 atom 키에 옛 모양 값이 있어도 이 판의 세대·칸 이름은 그대로다(키를 나눴다)', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const legacy = { on: false }
  // 0.8.8 모듈이 늦게 자기 키(claudeOwn)에 옛 모양(claudeOwn-1)으로 적은 것처럼 읽히게 한다
  const v1 = { shape: 'claudeOwn-1', value: { init: true, wins: [{ kind: 'five_hour', usedPct: 88, resetsAt: 0 }], at: { five_hour: 120 } } }
  const clock = await shareStart($, on, { share, usage: () => mine as any, stateRead: (key, r) => (legacy.on && key === 'claudeOwn' ? { value: v1, version: r.version } : undefined) })
  mine = usageNow(25)
  await clock.advance(5000)
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(25)
  legacy.on = true
  mine = usageNow(70)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 30)).toBeDefined()
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(70)
  await ui.unmount()
})

test('검수 0.8.9: 화면 atom 쓰기가 늦는 동안 경고를 먼저 띄우지 않는다(실제로 화면에 올라간 값으로 정한다), 올라가면 그때 띄운다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, {
    share, usage: () => mine as any,
    stateGate: e => (e.key === 'claudeView' && !gated && JSON.stringify(e.value).includes('"usedPct":96') ? (gated = true, held) : undefined),
  })
  mine = usageNow(5)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 95)).toBeDefined()
  mine = usageNow(96)
  await clock.advance(5000) // 96% 를 화면 atom 에 올리는 쓰기가 붙잡혔다
  expect(gated).toBe(true)
  for (let i = 0; i < 12; i++) {
    await clock.advance(1000)
    expect(await left(ui, 95)).toBeDefined()
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  }
  release()
  await clock.advance(500)
  expect(await left(ui, 4)).toBeDefined()
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeDefined()
  await ui.unmount()
})

test('검수 0.8.9: seq 를 받는 콜백도 세대를 본다(앞 세션의 늦은 seq 받기가 다시 불려도 새 세션의 번호를 쓰지 않는다)', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, {
    share, usage: () => mine as any,
    stateGate: e => (e.key === 'claudeOwn2' && !gated && /"seq":1\b/.test(JSON.stringify(e.value)) ? (gated = true, held) : undefined),
  })
  mine = usageNow(96)
  await clock.advance(5000) // 앞 세션이 seq 를 받는 쓰기에서 멈췄다(파일은 아직 안 씀)
  expect(gated).toBe(true)
  expect(share.writes.length).toBe(0)
  mine = usageNow(20)
  await $.session.start(SESSION)
  await clock.advance(300)
  release()
  await clock.advance(300)
  mine = usageNow(75)
  await clock.advance(5000)
  expect(share.writes.map(w => mySlot(w)!.windows[0]!.usedPct)).toEqual([20, 75])
  expect(share.writes.map(w => mySlot(w)!.seq)).toEqual([1, 2]) // 옛 세션이 사이에 번호를 가져가지 않았다
})

test('검수 0.8.9: CLAUDE_CONFIG_DIR 을 못 읽은 세션은 파일로 나누지 않는다(기본 이름으로 다른 계정과 섞이지 않게), 화면은 자기 값으로', { timeoutMs: 20000 }, async ($, on) => {
  const share: ShareFile = { text: fileOf({ id: OTHER, seq: 1, windows: [obs(90, T0S)] }), mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any, env: { CLAUDE_CONFIG_DIR: async () => { throw new Error('denied') } } })
  mine = usageNow(20)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  expect(share.tries ?? 0).toBe(0)
  expect(share.reads).toBe(0)
  await ui.unmount()
})

test('검수 0.8.9: 엔진 시계를 못 읽은 틱은 받은 시각·파일을 적지 않는다(다음 틱에 엔진 시각으로)', { timeoutMs: 20000 }, async ($, on) => {
  // mock.clock 은 시계 읽기를 실패시킬 수 없어(clock.now 훅은 하나만) 여기서만 손으로 만든 시계를 쓴다. 5초 타이머는 돌리지 않고,
  // 세션을 열 때마다 도는 첫 읽기 한 번을 틱으로 쓴다. 기다림은 실제 타이머가 아니라 그 틱의 마지막 쓰기(화면 atom·파일)가 닿는 것으로
  let nowV = T0, fail = false
  on('clock.now', () => { if (fail) throw new Error('clock unavailable'); return { value: nowV } })
  on('clock.every', () => new Promise(() => { /* 타이머는 돌지 않는다 */ }))
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const waits: Record<string, () => void> = {}
  const landed = (key: string) => new Promise<void>(r => { waits[key] = r })
  engine(on, { clock: true, share, usage: () => mine as any, onSet: key => { const f = waits[key]; if (f) { delete waits[key]; f() } } })
  let shown = landed('claudeView')
  await $.session.start(SESSION)
  await shown // T0: 아직 응답 전
  mine = usageNow(20)
  fail = true
  nowV += 5000
  shown = landed('claudeView')
  await $.session.start(SESSION)
  await shown // T0+5: 값이 바뀌었지만 엔진 시계를 못 읽었다(Date.now 로 어림): 화면만 고친다
  fail = false
  expect(share.tries ?? 0).toBe(0)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  nowV += 5000
  const wrote = new Promise<void>(r => { share.afterWrite = r })
  await $.session.start(SESSION)
  await wrote // T0+10: 엔진 시각으로 받은 시각을 적고 파일에도
  expect(share.writes.length).toBe(1)
  expect(mySlot(share.text)!.windows).toEqual([obs(20, T0S + 10)])
  await ui.unmount()
})

test('검수 0.8.9: 크기·시각이 그대로인 채 본문이 바뀌어도 60초 안에 다시 읽는다', { timeoutMs: 20000 }, async ($, on) => {
  const c1 = fileOf({ id: OTHER, seq: 1, windows: [obs(40, T0S - 100)] })
  const c3 = fileOf({ id: OTHER, seq: 2, windows: [obs(75, T0S + 30)] })
  expect(c3.length).toBe(c1.length)
  const share: ShareFile = { text: c1, mtime: 1, writes: [], reads: 0 }
  const clock = await shareStart($, on, { share, usage: () => [] })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 60)).toBeDefined()
  await clock.advance(30_000)
  share.text = c3 // 같은 글자 수, 같은 시각
  await clock.advance(35_000)
  expect(await left(ui, 25)).toBeDefined()
  await ui.unmount()
})

test('검수 0.8.9: 파일 쓰기가 멈춰 있어도 화면은 다음 틱에 바뀐다(쓰기를 기다리지 않는다)', { timeoutMs: 30000 }, async ($, on) => {
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = await shareStart($, on, { share, usage: () => mine as any })
  share.writeGate = () => { share.writeGate = undefined; return clock.sleep(65_000) } // 첫 쓰기가 65초 걸린다
  mine = usageNow(30)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 70)).toBeDefined()
  mine = usageNow(40)
  await clock.advance(5000)
  expect(await left(ui, 60)).toBeDefined()
  expect(share.writes.length).toBe(0) // 첫 쓰기는 아직 도는 중이고, 그사이 둘째 쓰기를 겹쳐 보내지 않는다
  expect(share.tries).toBe(1)
  await clock.advance(66_000) // 첫 쓰기가 닿은 뒤 다음 틱에 바뀐 값을 적는다
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(40)
  await ui.unmount()
})

// ── 리로드 경계(/reload-plugins): tests/reload_test.py 가 이 '리로드:' 시험들을 두 모듈(cwd /old·/new 로 나눠 시작)로 다시 돌린다.
//    여기(한 모듈)에서는 같은 모듈의 앞 세션·새 세션으로 돈다 ──
test('리로드: 옛 모듈의 늦게 도착한 화면 atom 쓰기(96%)가 새 모듈 화면(20%)을 덮지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  const log: Record<string, unknown> = {}
  let mine: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  engine(on, {
    clock: true, share, usage: () => mine as any, stateLog: log,
    stateGate: e => (e.key === 'claudeView' && !gated && JSON.stringify(e.value).includes('"usedPct":96') ? (gated = true, held) : undefined),
  })
  await $.session.start({ ...SESSION, cwd: '/old' })
  await clock.advance(300)
  mine = usageNow(96)
  await clock.advance(5000)
  expect(gated).toBe(true)
  mine = usageNow(20)
  await $.session.start({ ...SESSION, cwd: '/new' })
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 80)).toBeDefined()
  release()
  await clock.advance(100)
  const view = log.claudeView as { value?: { wins: { usedPct: number }[] } } | undefined
  expect(view?.value?.wins.map(w => w.usedPct)).toEqual([20])
  expect(await left(ui, 80)).toBeDefined()
  await ui.unmount()
})

test('리로드: 옛 모듈의 늦게 도착한 경고 글자 쓰기(사용량이 바닥나요)가 새 모듈(5%)의 글자를 덮지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  engine(on, {
    clock: true, share, usage: () => mine as any,
    stateGate: e => (e.key === 'clawd' && !gated && JSON.stringify(e.value).includes('"act":"dizzy"') ? (gated = true, held) : undefined),
  })
  await $.session.start({ ...SESSION, cwd: '/old' })
  await clock.advance(300)
  mine = usageNow(96)
  await clock.advance(5000) // 옛 모듈: 96% → 한가하니 곧바로 경고 글자를 적으려다 붙잡혔다
  expect(gated).toBe(true)
  mine = usageNow(5, 5 * 3600)
  await $.session.start({ ...SESSION, cwd: '/new' })
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  release()
  for (let i = 0; i < 6; i++) {
    await clock.advance(500)
    expect(await left(ui, 95)).toBeDefined()
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  }
  await ui.unmount()
})

test('리로드: 두 시작이 같은 세대를 읽고 옛 시작이 먼저 닿아도 나중에 시작한 쪽이 주인이 된다(새 쪽의 사용량이 계속 바뀐다)', { timeoutMs: 20000 }, async ($, on) => {
  const rel: (() => void)[] = []
  const held = [0, 1].map(() => new Promise<void>(r => { rel.push(r) }))
  let n = 0
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  const log: Record<string, unknown> = {}
  let mine: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  engine(on, {
    clock: true, share, usage: () => mine as any, stateLog: log,
    stateGate: e => (e.key === 'claudeOwn2' && n < 2 && /"gen":1\b/.test(JSON.stringify(e.value)) ? held[n++] : undefined),
  })
  const before = $.session.start({ ...SESSION, cwd: '/old' }) // T0 에 시작, 세대 올리기에서 멈춤
  await clock.advance(300)
  const after = $.session.start({ ...SESSION, cwd: '/new' }) // T0+0.3 에 시작, 같은 세대(0)를 읽고 멈춤
  await clock.advance(300)
  expect(n).toBe(2)
  rel[0]!() // 옛 시작이 먼저 닿는다
  await before
  await clock.advance(300)
  rel[1]!() // 새 시작은 버전이 어긋나 콜백을 다시 부른다
  await after
  await clock.advance(300)
  const v = (k: string) => { const x = log[k] as { value?: Record<string, unknown> } | undefined; return x?.value ?? {} }
  expect(v('claudeOwn2').gen).toBe(2)
  expect(v('claudeOwn2').ownAt).toBe(T0 + 300) // 주인은 나중에 시작한 쪽
  mine = usageNow(20)
  await clock.advance(5000)
  mine = usageNow(75)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await left(ui, 25)).toBeDefined()
  expect(v('claudeView').gen).toBe(2) // 화면도 새 주인의 세대가 올렸다
  expect(mySlot(share.text)!.windows[0]!.usedPct).toBe(75)
  await ui.unmount()
})

test('리로드: 주인이 못 된 옛 시작이 늦게 풀려도 새 주인의 경고 글자를 쉬는 중으로 되돌리지 않는다', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false, watch = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  const acts: string[] = [] // 옛 시작을 푼 뒤에 닿은 설명 글자 쓰기
  let mine: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  engine(on, {
    clock: true, share, usage: () => mine as any,
    stateGate: e => (e.key === 'claudeOwn2' && !gated && /"gen":1\b/.test(JSON.stringify(e.value)) ? (gated = true, held) : undefined),
    onSet: (key, value) => { if (watch && key === 'clawd') acts.push(JSON.stringify(value)) },
  })
  const before = $.session.start({ ...SESSION, cwd: '/old' }) // 세대 올리기에서 멈춘 옛 시작
  await clock.advance(300)
  await $.session.start({ ...SESSION, cwd: '/new' })
  await clock.advance(300)
  mine = usageNow(96)
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(await cap(ui, /^사용량이 바닥나요$/)).toBeDefined()
  watch = true
  release() // 옛 시작이 이제 풀린다: 주인이 못 되니 Clawd 를 다시 읽거나 설명 글자를 적지 않는다
  await before
  for (let i = 0; i < 4; i++) {
    await clock.advance(500)
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeDefined()
  }
  // 한 모듈에서는 지워진 글자를 다음 틱(0.1초)이 다시 적으므로, 화면만 보지 않고 '쉬는 중'으로 되돌리는 쓰기가 닿았는지 본다
  expect(acts.filter(a => a.includes('"act":"idle"'))).toEqual([])
  await ui.unmount()
})

test('검수 0.8.9: 미뤄 둔 경고를 띄우는 순간 화면 atom 의 지금 값을 본다(낮은 값 쓰기의 성공 응답만 늦어도 띄우지 않는다)', { timeoutMs: 20000 }, async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let gated = false
  const share: ShareFile = { text: null, mtime: 1, writes: [], reads: 0 }
  let mine: unknown[] = []
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  const clock = await shareStart($, on, {
    share, usage: () => mine as any,
    stateAfter: e => (e.key === 'claudeView' && !gated && JSON.stringify(e.value).includes('"usedPct":5') ? (gated = true, held) : undefined),
  })
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  mine = usageNow(96)
  await clock.advance(5000) // 바쁠 때 96% 가 화면에 올라갔다: 경고를 미룬다
  mine = usageNow(5, 5 * 3600)
  await clock.advance(5000) // 새 창 5% 쓰기는 닿았지만 그 성공 응답이 붙잡혔다
  expect(gated).toBe(true)
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  for (let i = 0; i < 15; i++) {
    await clock.advance(1000)
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  }
  expect(await left(ui, 95)).toBeDefined()
  release()
  await ui.unmount()
})

test('사용량 경고: 바쁠 때 넘어 미뤄 둔 경고는, 띄울 때 리셋돼 있으면 버린다', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 14, 0, 0).getTime() })
  let pct = 50
  engine(on, { clock: true, usage: () => [{ kind: 'five_hour', percentUsed: pct }] })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  await $.turn.start({ text: 'x', turnId: 't1' })
  pct = 96
  await clock.advance(5100) // 바쁠 때 넘었다: 미룬다
  pct = 5
  await clock.advance(5100) // 아직 바쁜 사이 리셋
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  for (let i = 0; i < 15; i++) { // 축하 3초가 지나 한가해진 뒤로도 경고는 뜨지 않는다
    await clock.advance(1000)
    expect(await cap(ui, /^사용량이 바닥나요$/)).toBeUndefined()
  }
  expect(await left(ui, 95)).toBeDefined()
  await ui.unmount()
})

test('큰 Clawd 를 꺼 둔 채 풍경 blit 이 거부·성공을 번갈아 받으면 글자 방식으로 물러나지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 30, 5).getTime() })
  let n = 0
  engine(on, { clock: true, store: { clawd: { on: false } }, blitFn: k => (k === 'yard' && n++ % 2 === 0 ? 'refused for a reason this mod does not know' : undefined) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await clock.advance(20_000)
  expect(n).toBeGreaterThanOrEqual(6) // 거부가 세 번 넘게 왔다
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  await ui.unmount()
})

// 검수(11-19): 위 시험은 답이 곧바로 와서, 옛 조건(답을 기다리는 사이 다시 그려졌으면(drawGen) 거부를 버림)을 되돌려도 통과했다.
// 여기서는 풍경 blit 의 답을 붙잡아 두고 그사이 단순 다시 그리기(같은 띠: yardGen 그대로)를 끼운 뒤 alt 거부를 돌려준다
test('큰 Clawd 를 꺼 둔 채 풍경 blit 의 alt 거부가 단순 다시 그리기 뒤에 와도(같은 띠) 글자 방식으로 바꾼다', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 10, 30, 5).getTime() })
  let held = 0
  engine(on, { clock: true, store: { clawd: { on: false } }, blitHold: k => (k === 'yard' && held++ === 0 ? clock.sleep(11_000).then(() => 'the Image draws its alt there') : undefined) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  await clock.advance(5000) // 첫 풍경 blit 이 답을 기다리는 사이 5초 틱의 다시 그리기
  expect(held).toBe(1)
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeDefined()
  await clock.advance(12_000) // 또 한 번 다시 그린 뒤 이제 alt 거부가 온다
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

// 같은 장면 0 을 방울(bubble)·연(kite)이 같이 쓰고 dx 만 다르다(방울 5, 연 2). 둘은 설명 글자가 같아('한가해요') 동작이 바뀌어도
// 다시 그리기(그 뒤의 확인 blit)가 없다: dx 가 바뀐 것만으로 blit 이 나가는지 본다. 장면은 10분씩 머문다
const DX_ONLY = {
  canvas: [38, 32], ground: 30, box: [19, 8], palette: { a: '#D97757' },
  frames: [cframe(2, 25, 2), cframe(2, 35, 2)],
  states: { ...Object.fromEntries(Object.keys(CAP).map(k => [k, { label: k, ms: 600_000, seq: [0] }])), kite: { label: 'kite', ms: 600_000, seq: [0, 1] } },
  png: { plain: [] },
}
test('가운데 정렬: 장면은 그대로이고 dx 만 바뀌면(다시 그리기 없이) blit 이 한 번 더 나간다', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 16, 14, 0, 0).getTime() })
  const blits = { n: 0, sent: [] as string[] }
  engine(on, { clock: true, blits, sprites: DX_ONLY })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '답' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const sp = DX_ONLY as any
  const A = spritePng(sp, 0, 5), B = spritePng(sp, 0, 2)
  const ui = await $.ui.mount({ ...PANE(44), surface: 'terminal', viewport: VIEW })
  expect(((await ui.find({ type: 'Image', key: 'clawd' }))?.props.source as { png?: string }).png).toBe(A)
  // 이 시험 엔진은 5초마다 다시 그리고(작업 목록), 다시 그린 뒤에는 확인 blit 이 같은 그림을 한 번 보낸다.
  // 쉬기 시작을 그 5초 박자에서 비켜 두려고 짧은 턴을 한 번 돌린다(연은 마지막으로 바빴던 때에서 10분 뒤)
  await clock.advance(800)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ answer: 'a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(570_000 - 1000)
  expect(await cap(ui, /^한가해요$/)).toBeDefined() // 방울
  const n0 = blits.sent.length
  await clock.advance(30_000)
  const n1 = blits.sent.length
  expect(blits.sent.slice(n0).every(p => p === A)).toBe(true) // 아직 방울: 다시 그린 뒤의 확인 blit 만(같은 그림)
  await clock.advance(30_000) // 이 사이에 연이 된다. 설명 글자는 그대로('한가해요')라 다시 그리기가 늘지 않는다
  expect(await cap(ui, /^한가해요$/)).toBeDefined()
  const after = blits.sent.slice(n1)
  expect(after).toContain(B) // 장면 0 그대로, dx 5 → 2
  expect(after.every(p => p === A || p === B)).toBe(true)
  expect(after.length).toBe(n1 - n0 + 1) // 확인 blit 수(30초에 같은 수) + dx 가 바뀐 한 번
  await ui.unmount()
})
