import { expect, test } from 'claude-code/testing'
import { STR } from '../hooks/i18n'
import { checkArgv, fallbackHost, hostFromProbe, parsePower, powerArgv, pyArgv, stopPlan } from '../hooks/host'

// 운영체제별 동작: 파이썬 명령 고르기(세션마다 한 번), 배터리, 중지 전 확인, 중지 명령.
// 엔진은 운영체제를 알려 주지 않아서 파이썬 후보의 답('3 win32' 등)으로 정한다. 실제 명령은 모두 가짜로 답한다

const PANE = {
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel',
  props: { title: '작업 진행판', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const NOW = Math.floor(Date.now() / 1000)
const SNAP = {
  at: NOW,
  jobs: [{ pid: 111, tool: 'codex', label: '데이터 정리 1차', project: 'x', model: 'gpt-6.1-sol', effort: 'high', elapsed: 720, rssMB: 100, idle: 5, last: '', tail: ['표 정리하는 중'], out: '' }],
  waiting: [],
  mem: { freePct: 58, swapUsedGB: 0.4, swapTotalGB: 2, load: null, cpus: 8 },
}
const etimeOf = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
// 스냅숏의 그 작업 그대로인 'etime 명령' 한 줄
const procLine = () => `${etimeOf(Math.floor(Date.now() / 1000) - (SNAP.at - 720))} codex exec -m m hi\n`

type Probe = Record<string, { exitCode: number; stdout: string } | 'missing'>
type Calls = { runs: string[][]; toasts: string[]; power?: string }
const engine = (on: any, probe: Probe, o: { osEnv?: string; taskkillGentle?: number } = {}) => {
  const calls: Calls = { runs: [], toasts: [] }
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'refused' : '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const argv = [...e.argv], a = argv.join(' ')
    calls.runs.push(argv)
    if (argv.includes('-c') && a.includes('sys.version_info')) {
      const p = probe[argv.slice(0, argv.indexOf('-c')).join(' ')]
      if (!p || p === 'missing') throw new Error('ENOENT')
      return run(p.stdout, p.exitCode)
    }
    if (a.includes('hooks/collect.py')) return run(JSON.stringify(SNAP))
    if (a.includes('hooks/codex_usage.py')) return run(JSON.stringify({ at: NOW, windows: [{ usedPct: 31, mins: 10080, resetsAt: NOW + 86400 }] }))
    if (a.includes('hooks/hostos.py') && argv.includes('power')) return run(calls.power ?? '{"pct": 64, "charging": true}\n')
    if (a.includes('hooks/hostos.py') && argv.includes('proc')) return run(procLine())
    if (argv[0] === 'ps') return run(procLine())
    if (argv[0] === 'pmset') return run("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t69%; discharging; 4:28 remaining present: true\n")
    if (argv[0] === 'kill') return run('')
    if (argv[0] === 'taskkill') return argv.includes('/F') ? run('SUCCESS') : run('', o.taskkillGentle ?? 1)
    return run('', 1)
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'ko_KR.UTF-8' : e.name === 'OS' ? o.osEnv : e.name.startsWith('LC_') ? undefined : e.name === 'HOME' ? '/Users/someone' : undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', (_: unknown, e: { text: string }) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  return calls
}
const ran = (calls: Calls, f: (a: string[]) => boolean) => calls.runs.filter(f)
const script = (name: string) => (a: string[]) => a.some(x => x.endsWith(`hooks/${name}`))

const mounted = async ($: any) => {
  for (let i = 0; i < 40; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    if (await ui.find({ key: 'job-111' })) return ui
    await ui.unmount()
    await new Promise(r => (globalThis as any).setTimeout(r, 25))
  }
  throw new Error('진행판에 작업이 나타나지 않았어요')
}
const stopIt = async (ui: any) => {
  await ui.press({ key: 'job-111' }); await ui.press({ key: 'stop-111' }); await ui.press({ key: 'kill-111' })
}

test('파이썬 후보 답 읽기: 3 만, 운영체제 이름으로', () => {
  expect(hostFromProbe(['python3'], { exitCode: 0, stdout: '3 darwin\n' })).toEqual({ py: ['python3'], os: 'darwin' })
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: '3 linux' })).toEqual({ py: ['python'], os: 'linux' })
  expect(hostFromProbe(['py', '-3'], { exitCode: 0, stdout: '3 win32\r\n' })).toEqual({ py: ['py', '-3'], os: 'win32' })
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: '3 cygwin' })?.os).toBe('win32')
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: '3 freebsd14' })?.os).toBe('linux')
  // 윈도 스토어의 가짜 python3(9009, 출력 없음), 파이썬 2, 이상한 출력은 거른다
  expect(hostFromProbe(['python3'], { exitCode: 9009, stdout: '' })).toBeNull()
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: "(2, 'win32')" })).toBeNull()
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: '2 linux2' })).toBeNull()
  expect(hostFromProbe(['python'], { exitCode: 0, stdout: '' })).toBeNull()
  expect(hostFromProbe(['python'], null)).toBeNull()
  expect(fallbackHost(undefined)).toEqual({ py: ['python3'], os: 'darwin' })
  expect(fallbackHost('Windows_NT')).toEqual({ py: ['python3'], os: 'win32' })
})

test('운영체제별 명령: 맥은 예전 그대로', () => {
  const mac = { py: ['python3'], os: 'darwin' as const }, lin = { py: ['python3'], os: 'linux' as const }, win = { py: ['py', '-3'], os: 'win32' as const }
  expect(pyArgv(mac, '/p/hooks/collect.py')).toEqual(['python3', '/p/hooks/collect.py'])
  expect(pyArgv(win, '/p/hooks/collect.py')).toEqual(['py', '-3', '/p/hooks/collect.py'])
  expect(stopPlan('darwin', 7)).toEqual([['kill', '-TERM', '7']])
  expect(stopPlan('linux', 7)).toEqual([['kill', '-TERM', '7']])
  expect(stopPlan('win32', 7)).toEqual([['taskkill', '/PID', '7', '/T'], ['taskkill', '/PID', '7', '/T', '/F']])
  expect(checkArgv(mac, '/p', 7)).toEqual(['ps', '-p', '7', '-o', 'etime=,command='])
  expect(checkArgv(lin, '/p', 7)).toEqual(['python3', '/p/hooks/hostos.py', 'proc', '7'])
  expect(checkArgv(win, '/p', 7)).toEqual(['py', '-3', '/p/hooks/hostos.py', 'proc', '7'])
  expect(powerArgv(mac, '/p')).toEqual(['pmset', '-g', 'batt'])
  expect(powerArgv(win, '/p')).toEqual(['py', '-3', '/p/hooks/hostos.py', 'power'])
})

test('hostos.py power 의 답 읽기', () => {
  expect(parsePower('{"pct": 64, "charging": true}\n')).toEqual({ pct: 64, charging: true })
  expect(parsePower('{"pct": 101.4, "charging": false}')).toEqual({ pct: 100, charging: false })
  expect(parsePower('{"pct": null, "charging": true}')).toEqual({ pct: null, charging: false })
  expect(parsePower('')).toEqual({ pct: null, charging: false })
  expect(parsePower('Traceback (most recent call last)')).toEqual({ pct: null, charging: false })
})

test('맥: python3 가 답하면 예전 명령 그대로(python3 · pmset · ps -p · kill -TERM)', async ($, on) => {
  const calls = engine(on, { python3: { exitCode: 0, stdout: '3 darwin\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  // 첫 후보(python3)에서 멈추고, 파이썬은 모두 python3 + 스크립트 하나로 부른다
  const probes = ran(calls, a => a.some(x => x.includes('sys.version_info')))
  expect(probes.length).toBeGreaterThan(0)
  expect(probes.every(a => a[0] === 'python3')).toBe(true)
  const py = ran(calls, a => a.some(x => /hooks\/\w+\.py$/.test(x)))
  expect(py.length).toBeGreaterThan(0)
  expect(py.every(a => a.length === 2 && a[0] === 'python3' && !a[1]!.endsWith('hostos.py'))).toBe(true)
  expect(ran(calls, a => a[0] === 'pmset').length).toBeGreaterThan(0)
  expect(ran(calls, a => a[0] === 'pmset').every(a => a.join(' ') === 'pmset -g batt')).toBe(true)
  await stopIt(ui)
  const ps = ran(calls, a => a[0] === 'ps')
  expect(ps.length).toBeGreaterThan(0)
  expect(ps.every(a => a.join(' ') === 'ps -p 111 -o etime=,command=')).toBe(true)
  expect(ran(calls, a => a[0] === 'kill')).toEqual([['kill', '-TERM', '111']])
  expect(ran(calls, a => a[0] === 'taskkill')).toHaveLength(0)
  expect(calls.toasts.some(t => /중지 요청/.test(t))).toBe(true)
  await ui.unmount()
})

test('윈도: 스토어 python3 와 파이썬 2 를 건너 py -3, 확인은 hostos.py proc, 중지는 taskkill /T 뒤 /F', async ($, on) => {
  const calls = engine(on, { python3: { exitCode: 9009, stdout: '' }, python: { exitCode: 0, stdout: "(2, 'win32')\r\n" }, 'py -3': { exitCode: 0, stdout: '3 win32\r\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  expect(ran(calls, a => a.some(x => x.includes('sys.version_info'))).map(a => a.slice(0, a.indexOf('-c')).join(' '))).toEqual(['python3', 'python', 'py -3'])
  for (const s of ['collect.py', 'codex_usage.py']) {
    const r = ran(calls, script(s))
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(a => a[0] === 'py' && a[1] === '-3')).toBe(true)
  }
  expect(ran(calls, a => a[0] === 'pmset')).toHaveLength(0)
  expect(ran(calls, a => script('hostos.py')(a) && a.at(-1) === 'power')[0]?.slice(0, 2)).toEqual(['py', '-3'])
  await stopIt(ui)
  expect(ran(calls, a => a[0] === 'ps' || a[0] === 'kill')).toHaveLength(0)
  expect(ran(calls, a => script('hostos.py')(a) && a.includes('proc')).map(a => a.slice(-2))).toEqual([['proc', '111']])
  expect(ran(calls, a => a[0] === 'taskkill')).toEqual([['taskkill', '/PID', '111', '/T'], ['taskkill', '/PID', '111', '/T', '/F']])
  expect(calls.toasts.some(t => /중지 요청/.test(t))).toBe(true)
  await ui.unmount()
})

test('윈도: 부드러운 taskkill 이 되면 /F 는 쓰지 않는다', async ($, on) => {
  const calls = engine(on, { python3: 'missing', python: { exitCode: 0, stdout: '3 win32' } }, { taskkillGentle: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  expect(ran(calls, script('collect.py'))[0]?.[0]).toBe('python')
  await stopIt(ui)
  expect(ran(calls, a => a[0] === 'taskkill')).toEqual([['taskkill', '/PID', '111', '/T']])
  await ui.unmount()
})

test('리눅스: 배터리는 hostos.py power, 확인은 hostos.py proc, 중지는 kill -TERM', async ($, on) => {
  const calls = engine(on, { python3: { exitCode: 0, stdout: '3 linux\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  expect(ran(calls, a => a[0] === 'pmset')).toHaveLength(0)
  expect(ran(calls, a => script('hostos.py')(a) && a.at(-1) === 'power')[0]?.[0]).toBe('python3')
  // 배터리 64%·충전 중이 시계 옆에 나온다(글자 화면)
  let seen = false
  for (let i = 0; i < 40 && !seen; i++) {
    const u = await $.ui.mount({ ...PANE, surface: 'desktop' })
    seen = !!(await u.find({ type: 'Text', text: /64%/ }))
    await u.unmount()
    if (!seen) await new Promise(r => (globalThis as any).setTimeout(r, 25))
  }
  expect(seen).toBe(true)
  await stopIt(ui)
  expect(ran(calls, a => a[0] === 'ps')).toHaveLength(0)
  expect(ran(calls, a => a[0] === 'kill')).toEqual([['kill', '-TERM', '111']])
  await ui.unmount()
})

test('부하가 없는 곳(윈도)은 메모리만 쓴다', async ($, on) => {
  engine(on, { python3: { exitCode: 0, stdout: '3 win32' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  expect(await ui.find({ type: 'Text', text: new RegExp(STR.ko.mem('58')) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /부하/ })).toBeUndefined()
  await ui.unmount()
})

test('후보가 하나도 답하지 않으면 python3, 운영체제는 OS 변수로(윈도만 가린다)', async ($, on) => {
  const calls = engine(on, {}, { osEnv: 'Windows_NT' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($)
  expect(ran(calls, script('collect.py'))[0]?.[0]).toBe('python3')
  await stopIt(ui)
  expect(ran(calls, a => a[0] === 'taskkill').length).toBeGreaterThan(0)
  await ui.unmount()
})
