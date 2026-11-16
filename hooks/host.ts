// 운영체제마다 다른 것(파이썬을 부르는 명령, 배터리, 작업 중지·중지 전 확인)을 고르는 작은 함수들.
// 엔진은 운영체제를 알려 주지 않아서, 세션마다 한 번 파이썬 후보를 차례로 불러 보고(PY_PROBE) 그 답의 sys.platform 으로 정한다.
// 맥에서는 첫 후보 python3 가 답하므로 예전과 같은 명령(python3 · pmset · ps -p · kill -TERM)을 그대로 쓴다

export type HostOs = 'darwin' | 'linux' | 'win32'
export type Host = { py: string[]; os: HostOs }

/** 파이썬 후보: python3 를 먼저(맥은 그대로), 윈도에서는 python · py -3 */
export const PY_CANDIDATES: string[][] = [['python3'], ['python'], ['py', '-3']]
/** 후보가 진짜 파이썬 3 인지 묻는 한 줄: '3 darwin' 처럼 답한다. 윈도 스토어의 가짜 python3 는 아무것도 찍지 않고 실패한다 */
export const PY_PROBE = 'import sys;print(sys.version_info[0], sys.platform)'
/** 아무 후보도 답하지 않을 때: 예전처럼 python3 로 부른다(운영체제는 OS 변수로 윈도만 가린다) */
export const fallbackHost = (osEnv: string | undefined): Host => ({ py: ['python3'], os: osEnv === 'Windows_NT' ? 'win32' : 'darwin' })

const osOf = (p: string): HostOs => (p === 'darwin' ? 'darwin' : /^(win32|cygwin|msys)/.test(p) ? 'win32' : 'linux')

/** 후보 하나의 답(종료 코드·출력) → 쓸 수 있으면 Host, 아니면 null(파이썬 2·가짜 실행 파일·이상한 출력) */
export const hostFromProbe = (py: string[], r: { exitCode: number; stdout?: string } | null | undefined): Host | null => {
  if (!r || r.exitCode !== 0) return null
  const m = (r.stdout ?? '').trim().match(/^(\d+)\s+(\S+)$/)
  if (!m || m[1] !== '3') return null
  return { py, os: osOf(m[2]!) }
}

/** 파이썬 스크립트를 부르는 argv */
export const pyArgv = (h: Host, script: string, ...args: string[]) => [...h.py, script, ...args]

/** 작업을 멈추는 명령들: 앞에서부터 하나가 성공(종료 코드 0)할 때까지 차례로.
 *  맥·리눅스는 kill -TERM. 윈도는 taskkill /T(하위 프로세스까지)로 먼저 부드럽게, 안 되면(창 없는 콘솔 프로세스는 보통 거절) /F 로 */
export const stopPlan = (os: HostOs, pid: number): string[][] => os === 'win32'
  ? [['taskkill', '/PID', String(pid), '/T'], ['taskkill', '/PID', String(pid), '/T', '/F']]
  : [['kill', '-TERM', String(pid)]]

/** 중지 전 확인: 그 pid 의 'etime 명령' 한 줄(hooks/proc.ts sameJob 이 읽는다). 맥은 ps, 그 밖은 hooks/hostos.py proc */
export const checkArgv = (h: Host, root: string, pid: number): string[] => h.os === 'darwin'
  ? ['ps', '-p', String(pid), '-o', 'etime=,command=']
  : pyArgv(h, `${root}/hooks/hostos.py`, 'proc', String(pid))

/** 배터리를 읽는 명령: 맥은 pmset(hooks/clock.ts parseBatt), 그 밖은 hooks/hostos.py power(JSON, parsePower) */
export const powerArgv = (h: Host, root: string): string[] => h.os === 'darwin'
  ? ['pmset', '-g', 'batt']
  : pyArgv(h, `${root}/hooks/hostos.py`, 'power')

/** hostos.py power 의 JSON 한 줄 → { pct, charging }. 못 읽으면 배터리 없음 */
export const parsePower = (out: string): { pct: number | null; charging: boolean } => {
  try {
    const o = JSON.parse(out.trim()) as { pct?: unknown; charging?: unknown }
    const pct = typeof o.pct === 'number' && Number.isFinite(o.pct) ? Math.max(0, Math.min(100, Math.round(o.pct))) : null
    return { pct, charging: pct !== null && o.charging === true }
  } catch { return { pct: null, charging: false } }
}
