import { expect, mock, test } from 'claude-code/testing'
import { AGY_TAG, STR } from '../hooks/i18n'
import { etimeS, sameJob } from '../hooks/proc'

// 진행판이 네 화면(터미널·데스크톱·VS Code·모바일)에서 그려지는지, 작업 이름 → 로그 펼침 → 중지(두 번 누름) 흐름이 도는지 본다.
// 실행: claude plugin test .

const PANE = {
  plugin: 'status-panel',
  component: 'Pane',
  requestId: 'status-panel',
  props: { title: '작업 진행판', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = Math.floor(Date.now() / 1000)
const SNAP = {
  at: NOW,
  jobs: [
    { pid: 111, tool: 'codex', label: '데이터 정리 1차', project: 'x', model: 'gpt-6.1-sol', effort: 'high', elapsed: 720, rssMB: 100, idle: 5, last: '표 정리하는 중', tail: ['표1 읽는 중', '합계 다시 계산', '표 정리하는 중'], out: '/tmp/none.md' },
    { pid: 222, tool: 'argon', label: '표 검산', project: '', model: 'gemini-4-argon-high', effort: '', elapsed: 180, rssMB: 50, idle: null, last: '', tail: [], out: '' },
  ],
  waiting: [],
  mem: { freePct: 58, swapUsedGB: 0.4, swapTotalGB: 2, load: 4.3, cpus: 10 },
}
const USAGE = { at: NOW, windows: [{ usedPct: 31, mins: 10080, resetsAt: NOW + 2 * 86400 }], reached: null, plan: 'pro', resetCredits: 1, credits: [{ title: 'Full reset', expiresAt: NOW + 27 * 86400 + 3600 }] }
const iso = (s: number) => new Date(s * 1000).toISOString()
const RATE = [{ kind: 'five_hour', percentUsed: 18.2, resetsAt: iso(NOW + 7800) }, { kind: 'seven_day', percentUsed: 39, resetsAt: iso(NOW + 3 * 86400) }]

const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t69%; discharging; 4:28 remaining present: true\n"
// ps -p <pid> -o etime=,command= 의 답: 기본은 스냅숏의 그 작업 그대로(시작 시각 = at - elapsed)
const etimeOf = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const psOf = (snap: typeof SNAP, pid: number) => {
  const j = snap.jobs.find(x => x.pid === pid)
  if (!j) return ''
  const et = Math.floor(Date.now() / 1000) - (snap.at - j.elapsed)
  return `${etimeOf(et)} ${j.tool === 'argon' ? 'agy -p hi --log-file /tmp/x.log' : 'codex exec -m m -o /tmp/none.md hi'}\n`
}
type PaneCalls = { kills: string[][]; toasts: string[]; snap: typeof SNAP; rate?: unknown; ps?: (pid: number) => string; usageRuns?: number; status?: (string | undefined)[]; usage?: unknown }
const engine = (on: any, calls: PaneCalls, o: { clock?: boolean } = {}) => {
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(calls.snap))
    if (a.includes('codex_usage.py')) { calls.usageRuns = (calls.usageRuns ?? 0) + 1; return run(JSON.stringify(calls.usage ?? USAGE)) }
    if (e.argv[0] === 'kill') { calls.kills.push([...e.argv]); return run('') }
    if (e.argv[0] === 'ps') {
      const out = (calls.ps ?? (pid => psOf(calls.snap, pid)))(Number(e.argv[2]))
      return run(out, out ? 0 : 1)
    }
    if (e.argv[0] === 'pmset') return run(BATT)
    return run('', 1) // cat 등: 미세 조정 파일(~/.claude/status-panel-tune.json) 없음
  })
  // 언어는 LC_ALL → LC_MESSAGES → LANG 으로 고른다: 이 시험은 한국어 화면을 본다
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'ko_KR.UTF-8' : e.name.startsWith('LC_') ? undefined : '/Users/someone' }))
  if (!o.clock) on('clock.every', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: calls.rate ?? RATE } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', (_: unknown, e: { text: string }) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_: unknown, e: { text?: string }) => { calls.status?.push(e.text); return { value: undefined } })
}

// session.start 가 기다리지 않고 띄운 첫 읽기가 끝날 때까지 다시 그려 본다
const mounted = async ($: any, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') => {
  for (let i = 0; i < 40; i++) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if ((await ui.find({ key: 'job-111' })) && (await ui.find({ type: 'Text', text: /Claude/ })) && (await ui.find({ type: 'Text', text: /Codex 주간/ }))) return ui
    await ui.unmount()
    await new Promise(r => (globalThis as any).setTimeout(r, 25))
  }
  throw new Error('진행판에 작업·사용량이 나타나지 않았어요')
}

// 네 화면을 차례로 띄워 시험 파일이 여럿 동시에 돌 때는 5초를 넘길 수 있다(혼자서는 1.6초)
test('네 화면 모두에서 그려지고 사용량·리셋권·모델 이름이 맞다', { timeoutMs: 15000 }, async ($, on) => {
  const calls = { kills: [] as string[][], toasts: [] as string[], snap: SNAP }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await mounted($, surface)
    await ui.drawn() // 화면이 그 구조를 거절하면 여기서 실패한다

    // 남은 양 뒤에 사용 속도 꼬리표(예상: 5시간 창 57% 지남, 주간 57%, Codex 주간 71%)
    expect((await ui.find({ type: 'Text', text: /Claude 5시간/ }))?.text).toMatch(/82% 남음 · 38% 여유$/)
    expect((await ui.find({ type: 'Text', text: /Claude 주간/ }))?.text).toMatch(/61% 남음 · 18% 여유$/)
    expect((await ui.find({ type: 'Text', text: /Codex 주간/ }))?.text).toMatch(/69% 남음 · 40% 여유$/)
    // 겹친 Text 는 바깥·안쪽이 둘 다 잡히므로 안쪽 조각만 센다
    expect(await ui.findAll({ type: 'Text', text: /^\s+리셋까지 $/ })).toHaveLength(3)
    expect((await ui.find({ type: 'Text', text: /리셋권 1장/ }))?.text).toMatch(/Full reset · \d+\/\d+ 만료 \(27일\)/)
    // 맨 위 시계: 날짜(진하게)와 배터리. 터미널은 굵은 선 세 줄, 그 밖은 한 줄
    expect(await ui.find({ type: 'Text', text: /\d+\/\d+ \([일월화수목금토]\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 69%$/ })).toBeDefined()
    if (surface === 'terminal') { expect(await ui.find({ type: 'Image', key: 'clock' })).toBeDefined(); expect(await ui.find({ type: 'Image', key: 'batt' })).toBeDefined() }
    else expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d  \d+\/\d+ \(.\)$/ })).toBeDefined()
    // 묶음 자리(시안 '마'안): 사용량·리셋권 → 여유·메모리(Clawd 묶음) → 작업 목록
    const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: { text?: string }) => t.text ?? '')
    const at = (re: RegExp) => texts.findIndex((t: string) => re.test(t))
    expect(at(/리셋권 1장/)).toBeGreaterThan(-1)
    expect(at(/리셋권 1장/)).toBeLessThan(at(/메모리 58%/))
    expect(at(/메모리 58%/)).toBeLessThan(at(/데이터 정리/))
    // gpt-6.1-sol 이 '.1-sol' 로 잘리지 않는다
    expect(await ui.find({ type: 'Text', text: /6\.1-sol·high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /argon-high/ })).toBeDefined()
    // 평소에는 바닥 줄도 중지 버튼도 없다
    expect(await ui.find({ type: 'Text', text: /갱신이 멈췄어요/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /갱신$/ })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.unmount()
  }
})

// 사용 속도(시안21 나안): 정상은 흐린 꼬리표, 부족이면 둘째 줄 맨 앞에 바닥나는 때 · 리셋까지(분 빼고). 줄 수는 그대로
test('사용 속도: 정상 속도·부족 꼬리표, 부족이면 둘째 줄에 바닥나는 때', async ($, on) => {
  const calls = {
    kills: [] as string[][], toasts: [] as string[], snap: SNAP,
    // 5시간 창 절반 지남에 50% 씀 → 정상. 주간 창 3일 30분 남음(57% 지남)에 70% 씀 → 13% 부족, 1일 16시간 뒤 바닥
    rate: [{ kind: 'five_hour', percentUsed: 50, resetsAt: iso(NOW + 9000) }, { kind: 'seven_day', percentUsed: 70, resetsAt: iso(NOW + 3 * 86400 + 1800) }],
  }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, 'terminal')
  expect((await ui.find({ type: 'Text', text: /Claude 5시간/ }))?.text).toMatch(/50% 남음 · 정상 속도$/)
  expect((await ui.find({ type: 'Text', text: /^정상 속도$/ }))?.props).toMatchObject({ dimColor: true })
  expect((await ui.find({ type: 'Text', text: /Claude 주간/ }))?.text).toMatch(/30% 남음 · 13% 부족$/)
  expect((await ui.find({ type: 'Text', text: /^13% 부족$/ }))?.props).toMatchObject({ color: 'warning' })
  const out = await ui.find({ type: 'Text', text: /^1일 16시간 뒤 바닥$/ })
  expect(out?.props).toMatchObject({ color: 'warning' })
  expect(await ui.find({ type: 'Text', text: /^\s+1일 16시간 뒤 바닥 · 리셋까지 3일$/ })).toBeDefined()
  // 바닥 줄이 날짜 줄을 대신하므로 날짜 줄은 5시간 창·Codex 두 개만
  expect(await ui.findAll({ type: 'Text', text: /^\s+리셋까지 $/ })).toHaveLength(2)
  await ui.unmount()
})

test('작업 이름을 누르면 로그가 펼쳐지고, 중지는 두 번 눌러야 나간다', async ($, on) => {
  const calls = { kills: [] as string[][], toasts: [] as string[], snap: SNAP }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, 'terminal')

  await ui.press({ key: 'job-111' })
  expect(await ui.findAll({ type: 'Text', text: /│/ })).toHaveLength(3)
  expect((await ui.find({ key: 'stop-111' }))?.text).toMatch(/이 작업 중지/)
  expect(calls.kills).toHaveLength(0)

  await ui.press({ key: 'stop-111' })
  expect(await ui.find({ key: 'stop-111' })).toBeUndefined()
  expect((await ui.find({ key: 'kill-111' }))?.text).toMatch(/한 번 더/)
  expect(calls.kills).toHaveLength(0)

  // 취소하면 처음 버튼으로 돌아온다
  await ui.press({ key: 'keep-111' })
  expect(await ui.find({ key: 'kill-111' })).toBeUndefined()
  expect(await ui.find({ key: 'stop-111' })).toBeDefined()

  await ui.press({ key: 'stop-111' })
  await ui.press({ key: 'kill-111' })
  expect(calls.kills).toEqual([['kill', '-TERM', '111']])
  expect(calls.toasts.some(t => /중지 요청/.test(t))).toBe(true)

  // 로그 파일이 없는 작업은 그렇다고 알려 준다
  await ui.press({ key: 'job-222' })
  expect(await ui.find({ type: 'Text', text: /로그 파일이 없어요/ })).toBeDefined()

  // 다시 누르면 접힌다
  await ui.press({ key: 'job-222' })
  expect(await ui.find({ type: 'Text', text: /로그 파일이 없어요/ })).toBeUndefined()
  await ui.unmount()
})

test('갱신이 30초 넘게 멈추면 바닥에 경고가 뜬다', async ($, on) => {
  const calls = { kills: [] as string[][], toasts: [] as string[], snap: { ...SNAP, at: NOW - 150 } }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, 'terminal')

  expect((await ui.find({ type: 'Text', text: /갱신이 멈췄어요/ }))?.text).toMatch(/2분째 갱신이 멈췄어요 \(마지막 \d\d:\d\d\)/)
  await ui.unmount()
})

test('최근 끝남은 기본으로 모두 펼쳐 있고, 접으면 2개만 남는다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const third = { ...SNAP.jobs[0]!, pid: 333, label: '세 번째 작업' }
  const calls = { kills: [] as string[][], toasts: [] as string[], snap: { ...SNAP, jobs: [...SNAP.jobs, third] } as typeof SNAP }
  engine(on, calls, { clock: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  // 다음 갱신에 세 작업이 모두 끝났다
  calls.snap = { ...SNAP, at: SNAP.at + 5, jobs: [] }
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.drawn()
  const rows = async () => (await ui.findAll({ type: 'Text', text: /^ [✓■]$/ })).length
  // 기본은 모두 펼침, 누르면 2개만 남고 다시 누르면 펼쳐진다
  expect(await rows()).toBe(3)
  expect((await ui.find({ key: 'done-more' }))?.text).toMatch(/접기 ▴/)
  await ui.press({ key: 'done-more' })
  expect(await rows()).toBe(2)
  expect((await ui.find({ key: 'done-more' }))?.text).toMatch(/외 1개 ▸/)
  await ui.press({ key: 'done-more' })
  expect(await rows()).toBe(3)
  await ui.unmount()
})

test('ps 확인: 살아 있고, 같은 종류이고, 시작 시각이 몇 초 안에서 같을 때만 같은 작업', () => {
  expect(etimeS('05:03')).toBe(303)
  expect(etimeS('1:02:03')).toBe(3723)
  expect(etimeS('2-01:02:03')).toBe(2 * 86400 + 3723)
  expect(etimeS('x')).toBeNull()
  const job = { tool: 'codex', elapsed: 100 }
  expect(sameJob('01:42 /opt/bin/codex --search exec -o r.md hi\n', job, 1000, 1002)).toBe(true) // 시작 900 = 900
  expect(sameJob('', job, 1000, 1002)).toBe(false) // 끝남
  expect(sameJob('01:42 vim notes.md', job, 1000, 1002)).toBe(false) // pid 를 다른 프로그램이 다시 씀
  expect(sameJob('00:10 codex exec hi', job, 1000, 1002)).toBe(false) // 같은 종류지만 나중에 시작한 다른 작업
  expect(sameJob('01:42 agy -p hi', job, 1000, 1002)).toBe(false)
  expect(sameJob('01:42 agy -p hi', { tool: 'argon', elapsed: 100 }, 1000, 1002)).toBe(true)
})

test('중지: 스냅숏 뒤에 끝났거나 pid 가 다른 프로세스면 죽이지 않고 이미 끝났다고 알린다', async ($, on) => {
  const calls: PaneCalls = { kills: [], toasts: [], snap: SNAP, ps: () => '' }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mounted($, 'terminal')
  const stop = async () => { await ui.press({ key: 'stop-111' }); await ui.press({ key: 'kill-111' }) }
  await ui.press({ key: 'job-111' })
  await stop() // 이미 끝남(ps 에 없음)
  expect(calls.kills).toHaveLength(0)
  expect(calls.toasts.at(-1)).toBe(STR.ko.alreadyDone)
  calls.ps = () => '00:03 /usr/bin/vim x\n' // pid 가 다른 프로그램에 다시 쓰였다
  await stop()
  expect(calls.kills).toHaveLength(0)
  calls.ps = () => '00:03 codex exec -o other.md hi\n' // 같은 종류지만 방금 시작한 다른 작업
  await stop()
  expect(calls.kills).toHaveLength(0)
  expect(calls.toasts.filter(t => t === STR.ko.alreadyDone)).toHaveLength(3)
  calls.ps = undefined // 그 작업 그대로
  await stop()
  expect(calls.kills).toEqual([['kill', '-TERM', '111']])
  await ui.unmount()
})

test('상태 줄은 0 인 종류를 빼고, Codex 사용량은 겹치지 않고 30초 안에 다시 묻지 않는다', async ($, on) => {
  const calls: PaneCalls = { kills: [], toasts: [], snap: { ...SNAP, jobs: [SNAP.jobs[1]!] }, status: [] }
  engine(on, calls)
  on('ui.panes', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 40 && !calls.status!.length; i++) await new Promise(r => (globalThis as any).setTimeout(r, 25))
  expect(calls.status!.at(-1)).toBe(`${AGY_TAG} 1개 실행 중`)
  // 영어는 수를 앞에: '2 Codex · 1 agy running · 1 queued'
  expect(STR.en.status(0, 1, 0)).toBe(`1 ${AGY_TAG} running`)
  expect(STR.en.status(2, 0, 1)).toBe('2 Codex running · 1 queued')
  expect(STR.en.status(2, 1, 1)).toBe(`2 Codex · 1 ${AGY_TAG} running · 1 queued`)
  expect(STR.ko.status(1, 1, 0)).toBe(`Codex 1 · ${AGY_TAG} 1개 실행 중`)
  // 세션 시작에 한 번 읽었고, /status-panel 을 두 번 불러도 30초 안이라 다시 묻지 않는다
  await ($ as any).command.run({ command: 'status-panel', args: '' })
  await ($ as any).command.run({ command: 'status-panel', args: '' })
  expect(calls.usageRuns).toBe(1)
  await ui.unmount()
})

test('codex 가 없는 컴퓨터는 Codex 사용량 줄을 숨기고, 다른 오류는 그대로 알린다', async ($, on) => {
  const calls: PaneCalls = { kills: [], toasts: [], snap: SNAP, usage: { at: NOW, error: 'codex-not-found' } }
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui
  for (let i = 0; i < 40; i++) {
    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    if (calls.usageRuns && (await ui.find({ key: 'job-111' })) && !(await ui.find({ type: 'Text', text: /불러오는 중/ }))) break
    await ui.unmount(); ui = undefined
    await new Promise(r => (globalThis as any).setTimeout(r, 25))
  }
  expect(ui).toBeDefined()
  expect(await ui!.find({ type: 'Text', text: /Codex/ })).toBeDefined() // 작업 꼬리표의 Codex 는 있다
  expect(await ui!.find({ type: 'Text', text: /Codex 사용량|codex 명령/ })).toBeUndefined()
  await ui!.unmount()
})
