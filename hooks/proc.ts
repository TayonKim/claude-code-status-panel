// 작업 중지 전 확인(hooks/register.tsx stopJob): 스냅숏(최대 5초, collect.py 가 실패하면 더 오래됨)의 pid 가
// 지금도 같은 작업인지 `ps -p <pid> -o etime=,command=` 한 줄로 다시 본다. pid 가 다른 프로세스에 다시 쓰였으면 죽이지 않는다

/** ps 의 etime('[[dd-]hh:]mm:ss') → 초. 못 읽으면 null */
export const etimeS = (t: string): number | null => {
  const m = t.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!m) return null
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4])
}

/** 명령 줄이 그 종류의 작업인지: codex 는 `codex … exec`, agy 는 `agy` (collect.py 와 같은 규칙) */
export const kindMatches = (tool: string | undefined, cmd: string) => tool === 'argon'
  ? /^(\S*\/)?agy(\s|$)/.test(cmd)
  : /^(\S*\/)?codex(\s+--?[\w-]+(=\S+)?)*\s+exec(\s|$)/.test(cmd)

/** 시작 시각이 이만큼 안에서 같으면 같은 프로세스로 본다(etime·스냅숏 시각 모두 초 단위) */
export const START_SLACK_S = 5

/**
 * ps 출력이 스냅숏의 그 작업인지. snapAt·elapsed 는 스냅숏 값, nowS 는 지금(초).
 * 프로세스가 없거나(빈 출력), 명령이 다른 종류거나, 시작 시각이 START_SLACK_S 넘게 다르면 false
 */
export const sameJob = (psOut: string, job: { tool?: string; elapsed: number }, snapAt: number, nowS: number) => {
  const line = psOut.split('\n').map(l => l.trim()).find(l => l !== '')
  if (!line) return false
  const m = line.match(/^(\S+)\s+(.*)$/)
  if (!m) return false
  const et = etimeS(m[1]!)
  if (et === null || !kindMatches(job.tool, m[2]!)) return false
  return Math.abs((nowS - et) - (snapAt - job.elapsed)) <= START_SLACK_S
}
