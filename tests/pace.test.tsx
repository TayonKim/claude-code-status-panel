import { expect, test } from 'claude-code/testing'
import { CLAUDE_WIN_S, dhOf, paceColor, paceOf, paceTag } from '../hooks/pace'
import { STR } from '../hooks/i18n'
import { cellWidth } from '../hooks/clawd'

// 사용 속도(CodexBar 방식) 계산과, 꼬리표·바닥 줄이 46칸 안에 드는지. 실행: claude plugin test .

const NOW = 1_800_000_000
const L = 100_000 // 기간 길이(초): 지난 초 = 지난 비율 × 1000
// 지난 비율 f(%)·쓴 양 u 로 묻는다
// toBeCloseTo 가 없어 소수 자리(digits) 기준으로 직접 비교한다
const near = (a: number | null | undefined, b: number, digits: number) => a != null && Math.abs(a - b) < 0.5 * 10 ** -digits + 1e-9
const at = (u: number, fPct: number, len = L) => paceOf(u, len, NOW + len - (len * fPct) / 100, NOW)

test('정상·여유·부족 경계는 ±3%p', () => {
  expect(at(60, 57)).toEqual({ state: 'on', n: 0, outS: null })     // +3
  expect(at(54, 57)).toEqual({ state: 'on', n: 0, outS: null })     // -3
  expect(at(57, 57)?.state).toBe('on')
  expect(at(60.5, 57)).toMatchObject({ state: 'deficit', n: 4 })    // +3.5
  expect(at(53.5, 57)).toEqual({ state: 'reserve', n: 4, outS: null }) // -3.5
  expect(at(48, 57)).toEqual({ state: 'reserve', n: 9, outS: null })
})

test('표시 없음: 기간 초반(5% 전)·한도 닿음·값 모름·리셋 지남', () => {
  expect(at(10, 4.9)).toBeNull()
  expect(at(10, 5)?.state).toBe('deficit')
  expect(at(100, 60)).toBeNull()
  expect(at(120, 60)).toBeNull()
  expect(paceOf(50, 0, NOW + 100, NOW)).toBeNull()       // 기간 길이 모름
  expect(paceOf(50, L, 0, NOW)).toBeNull()               // 리셋 시각 모름
  expect(paceOf(Number.NaN, L, NOW + 100, NOW)).toBeNull()
  expect(paceOf(50, L, NOW, NOW)).toBeNull()             // 리셋 시각이 지났다
  expect(paceOf(50, CLAUDE_WIN_S.spend_limit ?? 0, NOW + 100, NOW)).toBeNull()
  // 리셋이 기간 길이보다 멀면(지난 비율 0) 초반으로 본다
  expect(paceOf(50, L, NOW + 2 * L, NOW)).toBeNull()
})

test('부족: 지금 속도로 바닥나는 때', () => {
  // 40% 지남(40000초)에 60% 씀 → 1.5%/1000초, 남은 40% 는 26667초 뒤. 리셋은 60000초 뒤
  const p = at(60, 40)!
  expect(p).toMatchObject({ state: 'deficit', n: 20 })
  expect(near(p.outS, 26666.67, 1)).toBe(true)
  // 80% 지남에 84% 씀(+4) → 바닥 15238초 뒤, 리셋 20000초 뒤
  expect(near(at(84, 80)!.outS, 15238.1, 0)).toBe(true)
  // 5시간 창: 2시간 지남(예상 40%)에 60% 씀 → 1시간 20분 뒤 바닥
  expect(near(paceOf(60, CLAUDE_WIN_S.five_hour!, NOW + 3 * 3600, NOW)!.outS, 4800, 6)).toBe(true)
})

test('바닥이 리셋 뒤면 바닥 표시를 뺀다', () => {
  // 바닥 < 리셋 ⇔ 쓴 양 > 예상 이라, 이 식에서는 부족이면 늘 리셋 전에 바닥난다(바닥 = 리셋 은 쓴 양 = 예상, 곧 정상).
  // 그래서 리셋 뒤 바닥은 부족이 아닌 경우에만 생기고, 그때는 바닥 표시가 없다
  expect(at(57, 57)!.outS).toBeNull()   // 정상: 바닥 = 리셋
  expect(at(30, 57)!.outS).toBeNull()   // 여유: 바닥이 리셋 뒤
  // 부족은 경계(+3 바로 위)부터 끝(지남 99%)까지 모두 리셋 전에 바닥난다
  for (const f of [5, 10, 25, 50, 75, 90, 99]) for (const extra of [3.01, 10, 40]) {
    const u = f + extra
    if (u >= 100) continue
    const p = at(u, f)!
    expect([f, extra, p.state]).toEqual([f, extra, 'deficit'])
    expect(p.outS! < (L * (100 - f)) / 100).toBe(true)
  }
})

test('꼬리표 색과 글자(ko·en)', () => {
  const on = at(57, 57)!, res = at(48, 57)!, def = at(73, 57)!, big = at(77, 57)!
  expect(paceColor(on)).toBeNull()
  expect(paceColor(res)).toBe('success')
  expect(def.n).toBe(16)
  expect(paceColor(def)).toBe('warning')
  expect(paceColor(big)).toBe('error') // 20%p
  expect(paceTag(on, STR.ko)).toBe('정상 속도')
  expect(paceTag(res, STR.ko)).toBe('9% 여유')
  expect(paceTag(def, STR.ko)).toBe('16% 부족')
  expect(paceTag(on, STR.en)).toBe('On pace')
  expect(paceTag(res, STR.en)).toBe('9% reserve')
  expect(paceTag(def, STR.en)).toBe('16% deficit')
})

test('분을 뺀 남은 시간', () => {
  expect(dhOf(86400 + 3 * 3600 + 59 * 60, STR.ko)).toBe('1일 3시간')
  expect(dhOf(2 * 86400 + 59 * 60, STR.ko)).toBe('2일')
  expect(dhOf(14 * 3600 + 30 * 60, STR.ko)).toBe('14시간')
  expect(dhOf(40 * 60 + 5, STR.ko)).toBe('40분')
  expect(dhOf(10, STR.ko)).toBe('1분')
  expect(dhOf(2 * 86400 + 12 * 3600 + 12 * 60, STR.en)).toBe('2d 12h')
  expect(STR.ko.runsOut(dhOf(86400 + 3 * 3600, STR.ko))).toBe('1일 3시간 뒤 바닥')
  expect(STR.en.runsOut(dhOf(86400 + 3 * 3600, STR.en))).toBe('Runs out in 1d 3h')
})

// 패널 사용량 줄과 같은 모양으로 글자를 만든다(register.tsx usageRow)
const line1 = (S: typeof STR.ko, tool: string, name: string, left: number, tag: string) =>
  `  ${tool} ${name} ${'▰'.repeat(10)} ${S.left(left)} · ${tag}`
const line2 = (S: typeof STR.ko, outS: number, leftS: number) => `    ${S.runsOut(dhOf(outS, S))} · ${S.resetIn}${dhOf(leftS, S)}`

test('46칸: 꼬리표가 붙은 첫 줄과 바닥 줄이 넘치지 않는다(한글 2칸)', () => {
  // 실제로 나올 수 있는 가장 넓은 꼬리표: 여유·부족 두 자리(부족은 95%p 미만, 여유 100%p 는 쓴 양 0 이 기간 끝 0.5% 안일 때만)
  const widest = (S: typeof STR.ko) => [S.paceOn, S.paceReserve(99), S.paceDeficit(94)]
  const out: Record<string, number> = {}
  for (const lang of ['ko', 'en'] as const) {
    const S = STR[lang]
    const names: [string, string][] = [['Claude', S.claudeWin.five_hour!], ['Claude', S.claudeWin.seven_day!], ['Codex', S.winWeek], ['Codex', S.winH(5)], ['Codex', S.winH(12)], ['Codex', S.winD(3)]]
    // 남은 양 100%(쓴 양 0.5% 미만)는 지남 5% 이상이면 늘 여유라, 정상·부족 꼬리표와는 함께 나오지 않는다
    for (const [tool, name] of names) for (const left of [99, 100]) for (const tag of widest(S)) {
      if (left === 100 && tag !== S.paceReserve(99)) continue
      const key = `${lang}|${tool} ${name}|${left}|${tag}`
      out[key] = cellWidth(line1(S, tool, name, left, tag))
    }
    // 바닥 줄: 주간 창에서 가장 긴 남은 시간 '6일 23시간'
    out[`${lang}|line2`] = cellWidth(line2(S, 6 * 86400 + 23 * 3600, 6 * 86400 + 23 * 3600 + 1800))
  }
  // 한국어는 모두 46칸 안
  const ko = Object.entries(out).filter(([k]) => k.startsWith('ko|'))
  for (const [k, w] of ko) expect([k, w <= 46]).toEqual([k, true])
  expect(out['ko|Claude 5시간|100|99% 여유']).toBe(46)
  expect(Math.max(...ko.map(([, w]) => w))).toBe(46)
  expect(out['ko|line2']).toBeLessThanOrEqual(46)
  // 영어도 모두 46칸 안(주간 창 이름이 '7d' 라 'Claude 7d' 가 'Claude 5h' 와 같은 폭)
  const en = Object.entries(out).filter(([k]) => k.startsWith('en|'))
  for (const [k, w] of en) expect([k, w <= 46]).toEqual([k, true])
  expect(out['en|line2']).toBeLessThanOrEqual(46)
  // 여유는 99 로 묶인다(쓴 양 0 이 기간 끝 0.5% 안이어도 '100% 여유' 로 47칸이 되지 않게)
  expect(paceOf(0, L, NOW + 100, NOW)).toEqual({ state: 'reserve', n: 99, outS: null })
})
