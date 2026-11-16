import { expect, mock, test } from 'claude-code/testing'
import { AGY_TAG, ARGON_TTY, STR } from '../hooks/i18n'
import { cellWidth } from '../hooks/clawd'
import { lineWidth, showLines, textLines } from './helpers'

// 폭 훑기: 터미널 패널을 영어·한국어로 30~80칸에 그려, 작업 첫 줄이 이름 → 꼬리표 차례로 붙어 있는지,
// 잘리지 않는 줄이 패널보다 넓지 않은지, 사용량 줄이 46칸 안인지 본다. 실행: claude plugin test .

const NOW = Math.floor(Date.now() / 1000)
const WIDTHS = [30, 32, 38, 40, 46, 60, 80]
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4WR7+HwAGewKnNtauMAAAAABJRU5ErkJggg=='
const ACTS = ['idle', 'think', 'search', 'read', 'edit', 'work', 'cape', 'happy', 'heart', 'coffee', 'bubble', 'kite', 'dizzy']
const SPRITES = {
  canvas: [38, 32], ground: 30, box: [19, 8], pngSize: [456, 384], palette: { a: '#D97757' },
  frames: Array.from({ length: 20 }, () => Array.from({ length: 32 }, () => '.'.repeat(38))),
  states: Object.fromEntries(ACTS.map((k, i) => [k, { label: k, ms: 200, seq: [i, i + 1] }])),
  png: { plain: Array.from({ length: 20 }, () => PNG), sticker: Array.from({ length: 20 }, () => PNG) },
}
// 종류마다 하나: Codex(오래 조용함), agy -p, 손으로 띄운 대화형 agy. 끝날 작업 둘, 기다리는 작업 하나
const CODEX = { pid: 111, tool: 'codex', label: 'Data round 2', project: 'my-project', model: 'gpt-6.1-sol', effort: 'high', elapsed: 4380, rssMB: 100, idle: 900, last: 'tidying table', tail: ['a', 'b'], out: '/tmp/none.md' }
const AGY = { pid: 222, tool: 'argon', label: 'Translate docs', project: 'site', model: 'gemini-4-argon-high', effort: '', elapsed: 185, rssMB: 50, idle: 30, last: 'writing section 3', tail: ['x'], out: '/tmp/agy.log' }
const TTY = { pid: 333, tool: 'argon', label: ARGON_TTY, project: 'notes', model: '', effort: '', elapsed: 60, rssMB: 50, idle: null, last: '', tail: [], out: '' }
const GONE1 = { ...CODEX, pid: 444, label: 'Old codex run', idle: 3 }
const GONE2 = { ...AGY, pid: 555, label: 'Old agy run', out: '' }
const WAIT = { pid: 9, labels: ['next job', 'after that'], elapsed: 45 }
const MEM = { freePct: 58, swapUsedGB: 0.4, swapTotalGB: 2, load: 4.3, cpus: 10 }
const USAGE = {
  at: NOW, windows: [{ usedPct: 31, mins: 10080, resetsAt: NOW + 2 * 86400 + 9 * 3600 }, { usedPct: 30, mins: 300, resetsAt: NOW + 4 * 3600 - 60 }],
  reached: null, plan: 'pro', resetCredits: 2,
  credits: [{ title: 'Full reset', expiresAt: NOW + 27 * 86400 + 3600 }, { title: 'Weekly reset', expiresAt: NOW + 3600 }],
}
const iso = (s: number) => new Date(s * 1000).toISOString()
const RATE = [{ kind: 'five_hour', percentUsed: 18.2, resetsAt: iso(NOW + 7800) }, { kind: 'seven_day', percentUsed: 70, resetsAt: iso(NOW + 3 * 86400 + 1800) }]
const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t69%; discharging; 4:28 remaining present: true\n"
const VIEW = { columns: 160, rows: 70, isFullscreen: true }
const PANE = (bodyColumns: number) => ({
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel', surface: 'terminal' as const, viewport: VIEW,
  props: { title: 'Status panel', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 70 }, view: {} },
})

const engine = (on: any) => {
  const calls = { snap: { at: NOW, jobs: [CODEX, AGY, TTY, GONE1, GONE2] as unknown[], waiting: [WAIT] as unknown[], mem: MEM } }
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'status-panel', title: '', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(calls.snap))
    if (a.includes('codex_usage.py')) return run(JSON.stringify(USAGE))
    if (e.argv[0] === 'pmset') return run(BATT)
    return run('', 1)
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'en_US.UTF-8' : e.name === 'HOME' ? '/Users/someone' : undefined }))
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: RATE } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: JSON.stringify(SPRITES) }))
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  mock.store(on)
  return calls
}

test('폭 훑기(30~80칸, 영어·한국어): 작업 첫 줄은 이름 → 꼬리표, 잘리지 않는 줄은 패널 안, 사용량 줄은 46칸 안', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  calls.snap = { ...calls.snap, at: NOW + 5, jobs: [CODEX, AGY, TTY] } // 둘이 끝나 최근 끝남으로
  await clock.advance(5000)
  const dump: string[] = []
  for (const lang of ['en', 'ko'] as const) {
    if (lang === 'ko') await ($ as any).command.run({ command: 'status-panel', args: 'lang ko' })
    const S = STR[lang]
    for (const w of WIDTHS) {
      const ui = await ($ as any).ui.mount(PANE(w))
      const lines = textLines(await ui.drawn())
      if (lang === 'en') dump.push(`── ${w} columns ${'─'.repeat(Math.max(0, w - 14))}`, ...showLines(lines, w), '')
      // 작업 첫 줄: 단추 안의 글자 하나(잘리면 …), 이름 바로 뒤에 두 칸 띄고 꼬리표
      for (const [j, label, tag] of [[CODEX, CODEX.label, 'Codex'], [AGY, AGY.label, AGY_TAG], [TTY, S.argonTty, AGY_TAG]] as const) {
        const b = await ui.find({ key: `job-${j.pid}` })
        expect([lang, w, b?.text.startsWith(`${label}  ${tag} `)]).toEqual([lang, w, true])
        const kids = (b?.children ?? []) as { type?: string; props?: { wrap?: string } }[]
        expect([lang, w, kids.length, kids[0]?.type, kids[0]?.props?.wrap]).toEqual([lang, w, 1, 'Text', 'truncate-end'])
      }
      // 잘리지 않는 줄은 패널 폭 안
      const over = lines.filter(l => !l.cut && lineWidth(l) > w).map(l => l.text)
      expect([lang, w, over]).toEqual([lang, w, []])
      // 사용량 줄(첫 줄·바닥 줄·리셋 줄)은 잘리기 전 글자가 46칸 안
      const rows = (await ui.findAll({ type: 'Text', text: /^\s+(Claude|Codex) |^\s+(Runs out in |Resets in |리셋까지 |.+ 뒤 바닥)/ })).map((t: { text?: string }) => t.text ?? '')
      expect(rows.length).toBeGreaterThanOrEqual(4)
      for (const r of rows) expect([lang, r, cellWidth(r) <= 46]).toEqual([lang, r, true])
      // 리셋권 둘, 기다리는 작업, 최근 끝남이 다 있다
      expect(await ui.findAll({ type: 'Text', text: /Full reset · |Weekly reset · / })).toHaveLength(2)
      expect(await ui.find({ type: 'Text', text: /next job → after that/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: / Old codex run$/ })).toBeDefined()
      await ui.unmount()
    }
  }
  // (dump)
  expect(dump.length).toBeGreaterThan(WIDTHS.length * 10)
})
