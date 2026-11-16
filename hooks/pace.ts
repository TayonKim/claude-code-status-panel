// 사용 속도(CodexBar 방식): 기간 중 지난 비율만큼 썼다고 보고, 실제가 그보다 많은지 적은지.
// 사용량 줄 첫 줄 끝의 꼬리표(정상 속도 · N% 여유 · N% 부족)와, 부족할 때 둘째 줄 앞의 '바닥나는 때'(시안21 나안).
import type { Strings } from './i18n'

/** Claude 창 이름 → 기간 길이(초). 모르는 창(지출 한도 등)은 속도를 안 보인다 */
export const CLAUDE_WIN_S: Record<string, number> = { five_hour: 5 * 3600, seven_day: 7 * 86400 }

/** 이 폭 안에서 정상 속도로 본다(%p) */
export const PACE_BAND = 3
/** 기간이 이만큼 지나기 전에는 들쭉날쭉해서 안 보인다 */
export const PACE_MIN_F = 0.05

export type Pace = {
  state: 'on' | 'reserve' | 'deficit'
  /** 여유·부족 크기(%p, 반올림). 정상이면 0 */
  n: number
  /** 부족일 때 지금 속도로 바닥나기까지 남은 초. 리셋 전에 바닥나지 않거나 부족이 아니면 null */
  outS: number | null
}

/**
 * usedPct: 쓴 비율(0~100), lenS: 기간 길이(초), resetsAt·nowS: 초.
 * 표시하지 않는 경우(null): 길이나 리셋 시각을 모를 때, 리셋 시각이 지났을 때, 기간 초반(5% 전), 한도에 닿았을 때(100% 이상).
 */
export const paceOf = (usedPct: number, lenS: number, resetsAt: number, nowS: number): Pace | null => {
  if (!(lenS > 0) || !(resetsAt > 0) || !Number.isFinite(usedPct)) return null
  const leftS = resetsAt - nowS
  if (leftS <= 0) return null
  const pastS = Math.max(0, Math.min(lenS, lenS - leftS))
  if (pastS / lenS < PACE_MIN_F || usedPct >= 100) return null
  // 곱하기를 먼저 해서 경계(±3)가 부동소수 오차로 흔들리지 않게 한다
  const d = usedPct - (pastS * 100) / lenS
  if (Math.abs(d) <= PACE_BAND) return { state: 'on', n: 0, outS: null }
  // 여유 100%p 는 거의 안 쓴 채 기간 끝 0.5% 안일 때만 나온다: 99 로 묶어 46칸 안에 둔다
  if (d < 0) return { state: 'reserve', n: Math.min(99, Math.round(-d)), outS: null }
  const outS = (100 - usedPct) / (usedPct / pastS)
  return { state: 'deficit', n: Math.round(d), outS: outS < leftS ? outS : null }
}

/** 꼬리표 색: 정상은 흐리게(null), 여유는 success, 부족은 warning(20%p 이상이면 error) */
export const paceColor = (p: Pace): 'success' | 'warning' | 'error' | null =>
  p.state === 'on' ? null : p.state === 'reserve' ? 'success' : p.n >= 20 ? 'error' : 'warning'

export const paceTag = (p: Pace, S: Strings) =>
  p.state === 'on' ? S.paceOn : p.state === 'reserve' ? S.paceReserve(p.n) : S.paceDeficit(p.n)

/** 분을 뺀 남은 시간: 'n일 n시간' · 'n시간', 한 시간이 안 되면 분 */
export const dhOf = (s: number, S: Strings) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  return d ? S.durDH(d, h) : h ? S.durHr(h) : S.durM(Math.max(1, Math.floor(s / 60)))
}
