import { expect, test } from 'claude-code/testing'

import {
  MAX_SLOTS, MAX_WINS, NEAR_S, SAME_WINDOW_S, SHARE_FUTURE_S, SHARE_MAX_AGE_S, composeSlots, foldSlots, nextOwnAt, orderWins, ownSlotWins, parseShare, planWrite,
  sameObs, shareFileName, shareText, shownUsage,
} from '../hooks/share'
import type { Obs, OwnWin, Slot } from '../hooks/share'

// 세션끼리 나누는 Claude 사용량(hooks/share.ts, 0.8.9 칸 구조)의 순수 함수. 배선은 tests/clawd.test.tsx 의 '사용량 나누기' 시험이 본다.
// 시각은 모두 고정 값(NOW)이다: 실제 시계(Date.now)를 쓰지 않는다. 실행: claude plugin test .

const NOW = 2_000_000_000
const R = NOW + 3600 // 기본 리셋 시각(지금 창)
const own = (kind: string, usedPct: number, resetsAt = R): OwnWin => ({ kind, usedPct, resetsAt })
const ob = (kind: string, usedPct: number, at: number, resetsAt = R): Obs => ({ kind, usedPct, resetsAt, at })
const slot = (id: string, seq: number, ...windows: Obs[]): Slot => ({ id, seq, windows })
const SELF = 'self-0000'
/** 남의 칸들만으로 본 화면(자기 값 없음) */
const shown = (slots: Slot[], nowS = NOW) => shownUsage(slots, SELF, [], {}, nowS)
const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])))

test('파일 이름: 기본은 claude-usage-v2.json(0.8.8 의 v1 과 다른 이름), CLAUDE_CONFIG_DIR 이 있으면 그 경로의 해시 8자리로 나눈다', () => {
  expect(shareFileName()).toBe('claude-usage-v2.json')
  expect(shareFileName('')).toBe('claude-usage-v2.json')
  expect(shareFileName('/a/b')).toMatch(/^claude-usage-v2-[0-9a-f]{8}\.json$/)
  expect(shareFileName('/a/b')).toBe(shareFileName(' /a/b '))
  expect(shareFileName('/a/b')).not.toBe(shareFileName('/a/c'))
})

test('파일 읽기: 깨진 JSON 은 null, v1·모르는 모양은 빈 칸들(덮어써도 된다), v3 이상은 읽기만, 모양이 틀린 칸·관측은 뺀다', () => {
  expect(parseShare('{"v":2,"slots":[{"id":"a","seq":1,"windows":[{"kind":"five_')).toBeNull()
  expect(parseShare('')).toBeNull()
  expect(parseShare('{}')).toEqual({ slots: [] })
  expect(parseShare('[1,2]')).toEqual({ slots: [] })
  expect(parseShare('null')).toEqual({ slots: [] })
  // 0.8.7~0.8.8 의 v1(합쳐 적은 값): 칸이 없으니 빈 것으로 보고, 자기 칸을 적을 때 v2 로 덮는다
  expect(parseShare(JSON.stringify({ v: 1, windows: [ob('five_hour', 40, NOW)] }))).toEqual({ slots: [] })
  // 앞으로 나올 판: 읽기만(쓰지 않는다)
  expect(parseShare(JSON.stringify({ v: 3, slots: [slot('a', 1, ob('five_hour', 1, NOW))] }))).toEqual({ slots: [], readOnly: true })
  const t = JSON.stringify({ v: 2, slots: [
    slot('b', 2, ob('seven_day', 9, NOW), ob('five_hour', 40, NOW - 10), ob('five_hour', 99, NOW), { kind: 'x', usedPct: '5', resetsAt: 0, at: NOW } as never,
      ob('Five Hour', 1, NOW), ob('../a', 1, NOW), ob('k'.repeat(41), 1, NOW), ob('z', 1, NOW, -1), ob('y', 1, 0), ob('fut', 3, NOW + 99_999)),
    slot('a', 5, ob('five_hour', 10, NOW - SHARE_MAX_AGE_S * 2, NOW - 1)), // 오래되고 만료된 것도 읽기는 그대로(버리는 것은 foldSlots)
    slot('a', 3, ob('five_hour', 70, NOW)), // 같은 칸 이름: seq 가 높은 쪽
    { id: 'A B', seq: 1, windows: [] }, { id: 'c', seq: -1, windows: [] }, { id: 'd', seq: 1 }, null, 7,
  ] })
  expect(parseShare(t)).toEqual({ slots: [
    slot('a', 5, ob('five_hour', 10, NOW - SHARE_MAX_AGE_S * 2, NOW - 1)),
    slot('b', 2, ob('five_hour', 40, NOW - 10), ob('seven_day', 9, NOW), ob('fut', 3, NOW + 99_999)),
  ] })
})

test('파일 글자: 차례가 달라도 같은 내용이면 같은 글자, 읽으면 그대로 돌아온다. 이상한 이름·남는 필드는 적지 않는다', () => {
  const ss = [slot('b', 2, ob('seven_day', 3, NOW), ob('five_hour', 4, NOW)), slot('a', 1, ob('five_hour', 5, NOW))]
  const t = shareText(ss)
  expect(shareText([...ss].reverse())).toBe(t)
  expect(JSON.parse(t)).toEqual({ v: 2, slots: [slot('a', 1, ob('five_hour', 5, NOW)), slot('b', 2, ob('five_hour', 4, NOW), ob('seven_day', 3, NOW))] })
  expect(shareText(parseShare(t)!.slots)).toBe(t)
  expect(shareText([slot('a', 1, { ...ob('five_hour', 4, NOW), extra: '/tmp/somewhere' } as never)])).not.toContain('somewhere')
  expect(shareText([slot('a', 1, ob('/tmp/somewhere', 4, NOW))])).not.toContain('somewhere')
  expect(shareText([slot('/tmp/somewhere', 1, ob('five_hour', 4, NOW))])).not.toContain('somewhere')
  expect(orderWins([{ kind: 'zz' }, { kind: 'seven_day' }, { kind: 'aa' }, { kind: 'five_hour' }]).map(w => w.kind)).toEqual(['five_hour', 'seven_day', 'aa', 'zz'])
})

test('화면 값: 가장 새 관측에서 8초 넘게 오래된 값은 커도 진다(쉬는 세션의 묵은 값), 8초 안이면 큰 값', () => {
  expect(NEAR_S).toBe(8)
  // 쉬는 세션 B 의 묵은 90% 는 9초 뒤에 본 A 의 40% 에 진다
  expect(shown([slot('a', 1, ob('five_hour', 40, NOW)), slot('b', 1, ob('five_hour', 90, NOW - NEAR_S - 1))])).toEqual([own('five_hour', 40)])
  // 8초 안: 어느 쪽을 먼저 받았는지 폴링으로는 알 수 없어 큰 값
  expect(shown([slot('a', 1, ob('five_hour', 40, NOW)), slot('b', 1, ob('five_hour', 90, NOW - NEAR_S))])).toEqual([own('five_hour', 90)])
  // 같은 값이면 새 at 의 것(리셋 시각을 그쪽 것으로)
  expect(shown([slot('a', 1, ob('five_hour', 40, NOW, R + 5)), slot('b', 1, ob('five_hour', 40, NOW - 3, R))])).toEqual([own('five_hour', 40, R + 5)])
  // 값도 at 도 같으면 늦은 리셋 시각(넘긴 순서와 상관없이: 마지막 가르기가 없으면 앞에 넘긴 것이 나온다)
  const tie = [slot('a', 1, ob('five_hour', 40, NOW, R)), slot('b', 1, ob('five_hour', 40, NOW, R + 7))]
  expect(shown(tie)).toEqual([own('five_hour', 40, R + 7)])
  expect(shown([...tie].reverse())).toEqual([own('five_hour', 40, R + 7)])
  // 종류마다 따로 고르고, 차례는 창 길이
  expect(shown([slot('a', 1, ob('seven_day', 20, NOW), ob('five_hour', 40, NOW - 100)), slot('b', 1, ob('five_hour', 50, NOW))]))
    .toEqual([own('five_hour', 50), own('seven_day', 20)])
})

test('화면 값: 8초 안에서는 나중 창이 값과 상관없이 이기고, 리셋 시각을 모르는(0) 새 관측은 8초 넘게 새것이면 이긴다(검수: 0 이라 60초 새것도 졌다)', () => {
  const newWin = NOW + 5 * 3600, oldWin = NOW + 30
  expect(shown([slot('a', 1, ob('five_hour', 1, NOW - 2, newWin)), slot('b', 1, ob('five_hour', 99, NOW, oldWin))])).toEqual([own('five_hour', 1, newWin)])
  // 같은 창 안의 흔들림(SAME_WINDOW_S)은 같은 창: 큰 값
  expect(shown([slot('a', 1, ob('five_hour', 10, NOW, R + SAME_WINDOW_S)), slot('b', 1, ob('five_hour', 60, NOW, R))])).toEqual([own('five_hour', 60, R)])
  // 리셋 시각 모름(0): 60초 새것이면 이긴다. 8초 안이면 리셋 시각을 아는 쪽
  expect(shown([slot('a', 1, ob('five_hour', 12, NOW, 0)), slot('b', 1, ob('five_hour', 70, NOW - 60))])).toEqual([own('five_hour', 12, 0)])
  expect(shown([slot('a', 1, ob('five_hour', 12, NOW, 0)), slot('b', 1, ob('five_hour', 7, NOW - 5))])).toEqual([own('five_hour', 7)])
})

test('화면 값: 세 관측 90@t·50@t+10·10@t+20 은 어느 순서로 넘겨도 10(검수: 둘씩 겨루면 90 → 10 → 50 → 90 으로 돌았다)', () => {
  const t = NOW - 20
  const ss = [slot('a', 1, ob('five_hour', 90, t)), slot('b', 1, ob('five_hour', 50, t + 10)), slot('c', 1, ob('five_hour', 10, t + 20))]
  for (const p of perms(ss)) expect(shown(p)).toEqual([own('five_hour', 10)])
  // 자기 값으로 들어와도 같다
  for (const p of perms(ss.slice(0, 2))) expect(shownUsage(p, SELF, [own('five_hour', 10)], { five_hour: t + 20 }, NOW)).toEqual([own('five_hour', 10)])
  // 섞인 묶음(창·값·시각이 다 다른 다섯 관측)도 순서와 상관없이 한 가지
  const mix = [ob('five_hour', 30, NOW - 6, R), ob('five_hour', 80, NOW - 2, R - 100), ob('five_hour', 5, NOW - 1, R + 4 * 3600), ob('five_hour', 99, NOW - 30, R), ob('five_hour', 6, NOW, R + 4 * 3600 + 60)]
  const want = shown(mix.map((w, i) => slot(`s${i}`, 1, w)))
  expect(want).toEqual([own('five_hour', 6, R + 4 * 3600 + 60)])
  for (const p of perms(mix)) expect(shown(p.map((w, i) => slot(`s${i}`, 1, w)))).toEqual(want)
})

test('화면 값: 나이 모르는 자기 값은 다른 관측이 없을 때만, 리셋이 지난 자기 값도 다른 관측이 없을 때만(나눔이 없던 때와 같은 화면)', () => {
  // 나이 모름: 파일의 관측이 있으면 그것(값이 작아도)
  expect(shownUsage([slot('b', 1, ob('five_hour', 40, NOW - 7200))], SELF, [own('five_hour', 60)], { five_hour: 0 }, NOW)).toEqual([own('five_hour', 40)])
  expect(shownUsage([], SELF, [own('five_hour', 60)], {}, NOW)).toEqual([own('five_hour', 60)])
  // 다른 종류만 있으면 자기 값은 그 종류에서만 빠진다
  expect(shownUsage([slot('b', 1, ob('seven_day', 9, NOW))], SELF, [own('five_hour', 60), own('seven_day', 3)], {}, NOW)).toEqual([own('five_hour', 60), own('seven_day', 9)])
  // 리셋이 지난 남의 값은 안 보이고, 자기 값은(지났어도) 다른 관측이 없으면 지금처럼
  const gone = NOW - 10
  expect(shown([slot('b', 1, ob('five_hour', 96, NOW - 5, gone))])).toEqual([])
  expect(shownUsage([slot('b', 1, ob('five_hour', 96, NOW - 5, gone))], SELF, [own('five_hour', 10, gone)], { five_hour: NOW - 100 }, NOW)).toEqual([own('five_hour', 10, gone)])
  // 검수 재현: 파일의 96% 가 더 새것이어도 그 창이 지나면 자기 값(10%, 새 창)
  expect(shownUsage([slot('b', 1, ob('five_hour', 96, NOW - 5, gone))], SELF, [own('five_hour', 10, NOW + 5 * 3600)], { five_hour: NOW - 100 }, NOW)).toEqual([own('five_hour', 10, NOW + 5 * 3600)])
  // 8일 넘은 관측은 후보가 아니다
  expect(shown([slot('b', 1, ob('five_hour', 50, NOW - SHARE_MAX_AGE_S - 1, 0))])).toEqual([])
})

test('화면 값: 60초 넘게 미래인 관측은 이번에만 빼고(시계가 따라잡으면 보인다), 그 안쪽 미래는 지금으로 본다', () => {
  const fut = [slot('b', 1, ob('five_hour', 75, NOW + SHARE_FUTURE_S + 10))]
  expect(shown(fut)).toEqual([])
  expect(shown(fut, NOW + 20)).toEqual([own('five_hour', 75)])
  // 50초 미래인 값이 지금 본 자기 값을 8초 넘게 '새것'으로 이기지 않는다(지금으로 보아 8초 안: 큰 값)
  expect(shownUsage([slot('b', 1, ob('five_hour', 50, NOW + 50))], SELF, [own('five_hour', 60)], { five_hour: NOW }, NOW)).toEqual([own('five_hour', 60)])
})

test('화면 값: 파일에 있는 자기 칸(옛 세대가 늦게 적은 것일 수 있다)은 자기 기억에 그 종류가 있으면 쓰지 않는다. 없는 종류는 쓴다', () => {
  const stale = slot(SELF, 3, ob('five_hour', 96, NOW), ob('seven_day', 44, NOW - 100))
  expect(shownUsage([stale], SELF, [own('five_hour', 20)], { five_hour: NOW - 3 }, NOW)).toEqual([own('five_hour', 20), own('seven_day', 44)])
  // 같은 칸 이름이 아니면 남의 관측이라 겨룬다(8초 안: 큰 값)
  expect(shownUsage([{ ...stale, id: 'other' }], SELF, [own('five_hour', 20)], { five_hour: NOW - 3 }, NOW)).toEqual([own('five_hour', 96), own('seven_day', 44)])
})

test('칸 합치기: 칸마다 seq 가 높은 판(늦게 도착한 옛 쓰기가 되돌려도 놓지 않는다), 죽은 칸은 버리고 미래 칸은 남긴다', () => {
  const a2 = slot('a', 2, ob('five_hour', 20, NOW)), a1 = slot('a', 1, ob('five_hour', 96, NOW - 3))
  expect(foldSlots([a2], [a1], NOW)).toEqual([a2])
  expect(foldSlots([a1], [a2], NOW)).toEqual([a2])
  // 기억에만 있는 칸도 남는다(다른 세션이 늦은 쓰기로 그 칸을 잃어도)
  expect(foldSlots([a2], [slot('b', 1, ob('five_hour', 5, NOW))], NOW).map(s => s.id)).toEqual(['a', 'b'])
  // 죽은 칸: 관측이 모두 리셋 지남·8일 넘음·8일 넘게 미래. 하나라도 살아 있으면 칸째 그대로(지난 창도 함께 옮긴다)
  const dead = [slot('x', 1, ob('five_hour', 1, NOW, NOW - 1)), slot('y', 1, ob('five_hour', 1, NOW - SHARE_MAX_AGE_S - 1, 0)), slot('z', 1, ob('five_hour', 1, NOW + SHARE_MAX_AGE_S + 1, 0)), slot('w', 1)]
  const keep = [slot('f', 1, ob('five_hour', 75, NOW + 70)), slot('m', 1, ob('five_hour', 1, NOW, NOW - 1), ob('seven_day', 3, NOW))]
  expect(foldSlots([], [...dead, ...keep], NOW)).toEqual(keep)
  // 칸이 너무 많으면 가장 최근 관측이 오래된 칸부터
  const many = Array.from({ length: MAX_SLOTS + 5 }, (_, i) => slot(`s${String(i).padStart(3, '0')}`, 1, ob('five_hour', 1, NOW - i)))
  const kept = foldSlots([], many, NOW)
  expect(kept).toHaveLength(MAX_SLOTS)
  expect(kept.some(s => s.id === `s${String(MAX_SLOTS + 4).padStart(3, '0')}`)).toBe(false)
  expect(kept.some(s => s.id === 's000')).toBe(true)
})

test('자기 칸에 적을 것: 나이를 아는 살아 있는 자기 값만(나이 모름·리셋 지남·8일 넘음은 적지 않는다)', () => {
  const ws = [own('five_hour', 10), own('seven_day', 20, NOW - 1), own('spend_limit', 3, 0), own('x_y', 4)]
  expect(ownSlotWins(ws, { five_hour: NOW - 5, seven_day: NOW - 5, spend_limit: NOW - SHARE_MAX_AGE_S - 1, x_y: 0 }, NOW)).toEqual([ob('five_hour', 10, NOW - 5)])
  expect(ownSlotWins([own('Bad Kind', 1)], { 'Bad Kind': NOW }, NOW)).toEqual([])
})

test('쓰기 판단: 자기 칸이 없거나 다를 때만. 리셋 시각의 같은 창 안 흔들림·지난 창은 다른 것이 아니다. 오래 깨진 파일은 자기 칸이 비어도 고친다, v3 은 쓰지 않는다', () => {
  const mine = [ob('five_hour', 20, NOW - 5)]
  expect(planWrite({ slots: [] }, [], SELF, mine, NOW)).toBe(true)
  expect(planWrite({ slots: [] }, [], SELF, [], NOW)).toBe(false) // 적을 것이 없으면 건드리지 않는다
  expect(planWrite({ slots: [slot(SELF, 4, ...mine)] }, [], SELF, mine, NOW)).toBe(false)
  expect(planWrite({ slots: [slot(SELF, 4, ob('five_hour', 20, NOW - 5, R + 30))] }, [], SELF, mine, NOW)).toBe(false)
  expect(planWrite({ slots: [slot(SELF, 4, ob('five_hour', 20, NOW - 5), ob('seven_day', 9, NOW - 9, NOW - 1))] }, [], SELF, mine, NOW)).toBe(false)
  expect(planWrite({ slots: [slot(SELF, 4, ob('five_hour', 96, NOW - 9))] }, [], SELF, mine, NOW)).toBe(true) // 옛 세대가 늦게 적은 자기 칸
  expect(planWrite({ slots: [slot('other', 4, ...mine)] }, [slot('other', 4, ...mine)], SELF, mine, NOW)).toBe(true)
  expect(planWrite({ slots: [], repair: true }, [], SELF, [], NOW)).toBe(true)
  expect(planWrite({ slots: [], readOnly: true }, [], SELF, mine, NOW)).toBe(false)
  expect(sameObs([ob('five_hour', 1, NOW), ob('seven_day', 2, NOW)], [ob('seven_day', 2, NOW), ob('five_hour', 1, NOW)])).toBe(true)
  expect(sameObs([ob('five_hour', 1, NOW)], [ob('five_hour', 1, NOW, R + SAME_WINDOW_S + 1)])).toBe(false)
})

test('적을 칸들: 남의 칸은 본 그대로, 자기 칸만 새 seq. 적을 것이 없으면(고치기) 기억한 자기 칸 그대로', () => {
  const b = slot('b', 7, ob('five_hour', 75, NOW + 70)) // 미래 칸도 그대로 옮긴다
  const mem = [b, slot(SELF, 2, ob('five_hour', 10, NOW - 50))]
  expect(composeSlots(mem, SELF, 3, [ob('five_hour', 20, NOW)], NOW)).toEqual([b, slot(SELF, 3, ob('five_hour', 20, NOW))])
  expect(composeSlots(mem, SELF, 3, [], NOW)).toEqual(mem)
  // 칸이 넘치면 자기 칸도 같은 차례로 줄 선다(특별히 남기지 않는다): 가장 오래된 자기 칸이 빠진다
  const many = Array.from({ length: MAX_SLOTS }, (_, i) => slot(`s${String(i).padStart(3, '0')}`, 1, ob('five_hour', 1, NOW)))
  const out = composeSlots(many, SELF, 1, [ob('five_hour', 2, NOW - 999)], NOW)
  expect(out).toHaveLength(MAX_SLOTS)
  expect(out.some(s => s.id === SELF)).toBe(false)
  // 자기 칸이 새것이면 가장 오래된 남의 칸이(같은 시각이면 이름 차례로 뒤의 것이) 빠진다
  const out2 = composeSlots(many, SELF, 1, [ob('five_hour', 2, NOW + 1)], NOW)
  expect(out2.some(s => s.id === SELF)).toBe(true)
  expect(out2.some(s => s.id === `s${String(MAX_SLOTS - 1).padStart(3, '0')}`)).toBe(false)
})

test('칸 하나의 창: 읽을 때와 적을 때 같은 상한(16)·같은 차례로 고른다(17개를 적어도 다음 틱에 다시 적지 않는다)', () => {
  expect(MAX_WINS).toBe(16)
  const many = Array.from({ length: MAX_WINS + 1 }, (_, i) => own(`k${String(i).padStart(2, '0')}`, i))
  const at = Object.fromEntries(many.map(w => [w.kind, NOW - 5]))
  const mine = ownSlotWins(many, at, NOW)
  expect(mine).toHaveLength(MAX_WINS)
  expect(mine.map(w => w.kind)).toEqual(orderWins(many).slice(0, MAX_WINS).map(w => w.kind))
  const text = shareText(composeSlots([], SELF, 1, mine, NOW))
  const back = parseShare(text)!
  expect(back.slots[0]!.windows).toEqual(mine)
  expect(planWrite(back, back.slots, SELF, mine, NOW)).toBe(false)
  // 파일에 17개(다른 차례로)가 있어도 읽기는 같은 16개를 고른다
  const raw = JSON.stringify({ v: 2, slots: [{ id: SELF, seq: 1, windows: [...many].reverse().map(w => ({ ...w, at: NOW - 5 })) }] })
  expect(parseShare(raw)!.slots[0]!.windows).toEqual(mine)
})

test('칸 수 상한: 자기 칸이 같은 차례로 줄 세운 앞의 64칸 밖이면 적지 않는다(자기 값이 바뀌어 새것이 되면 다시 든다)', () => {
  const newer = Array.from({ length: MAX_SLOTS }, (_, i) => slot(`n${String(i).padStart(2, '0')}`, 1, ob('five_hour', 1, NOW - i)))
  const old = [ob('five_hour', 50, NOW - 999)]
  expect(planWrite({ slots: newer }, newer, SELF, old, NOW)).toBe(false)
  expect(planWrite({ slots: newer }, newer, SELF, [ob('five_hour', 51, NOW)], NOW)).toBe(true)
})

// ── 여러 세션을 순수 함수로 흉내 낸다(register.tsx 의 readClaudeNow 와 같은 차례: 읽기 → 합치기 → 쓰기 판단 → 적기) ──
type Sess = { id: string; seq: number; own: OwnWin[]; at: Record<string, number>; mem: Slot[] }
const sess = (id: string, own: OwnWin[], at: Record<string, number>): Sess => ({ id, seq: 0, own, at, mem: [] })
/** 한 세션의 한 틱: 읽은 글자(read)로 판단해 적을 글자를 돌려준다(적지 않으면 null) */
const tick = (s: Sess, read: string | null, nowS: number): string | null => {
  const r = read === null ? { slots: [] } : parseShare(read)
  if (!r) return null
  s.mem = foldSlots(s.mem, r.slots, nowS)
  const mine = ownSlotWins(s.own, s.at, nowS)
  if (!planWrite(r, s.mem, s.id, mine, nowS)) return null
  s.seq++
  const slots = composeSlots(s.mem, s.id, s.seq, mine, nowS)
  s.mem = foldSlots(s.mem, slots, nowS)
  return shareText(slots)
}
const view = (s: Sess, nowS: number) => shownUsage(s.mem, s.id, s.own, s.at, nowS)

test('두 세션: 만료 경계에서도 번갈아 쓰지 않는다(검수: 지난 96% 창과 399초 남은 30% 창이 5초마다 20번 번갈아 썼다)', () => {
  const a = sess('a', [own('five_hour', 96, NOW - 1)], { five_hour: NOW - 100 }) // 높은 값, 창은 이미 지났다
  const b = sess('b', [own('five_hour', 30, NOW + 399)], { five_hour: NOW - 50 })
  let file: string | null = null, writes = 0
  for (let i = 0; i < 20; i++) {
    for (const s of i % 2 ? [b, a] : [a, b]) { const t = tick(s, file, NOW + i * 5); if (t !== null) { file = t; writes++ } }
  }
  expect(writes).toBe(1) // b 가 자기 칸을 한 번. a 는 적을 것이 없다(지난 창)
  expect(view(a, NOW + 100)).toEqual([own('five_hour', 30, NOW + 399)])
  expect(view(b, NOW + 100)).toEqual([own('five_hour', 30, NOW + 399)])
})

test('세 세션: 모두 같은 판을 읽고 차례로 덮어써도(쓰기 유실) 몇 틱 안에 모든 칸이 모이고 더 쓰지 않는다. 화면은 셋이 같다', () => {
  const ss = [sess('a', [own('five_hour', 40)], { five_hour: NOW - 30 }), sess('b', [own('five_hour', 42), own('seven_day', 9)], { five_hour: NOW - 3, seven_day: NOW - 3 }), sess('c', [own('five_hour', 41)], { five_hour: NOW - 1 })]
  let file: string | null = null
  const perRound: number[] = []
  for (let r = 0; r < 6; r++) {
    const snap = file // 모두 이 판을 읽은 뒤에 쓴다(가장 나쁜 겹침)
    let n = 0
    for (const s of ss) { const t = tick(s, snap, NOW + r * 5); if (t !== null) { file = t; n++ } }
    perRound.push(n)
  }
  expect(perRound.slice(3)).toEqual([0, 0, 0])
  expect(parseShare(file!)!.slots.map(s => s.id)).toEqual(['a', 'b', 'c'])
  for (const s of ss) expect(view(s, NOW + 30)).toEqual([own('five_hour', 42), own('seven_day', 9)])
})

test('칸 수 상한: 더 새 63칸 아래에서 오래된 두 세션이 번갈아 돌아도 핑퐁하지 않는다(검수: 20틱에 40번 썼다)', () => {
  const t = NOW - 100
  const newer = Array.from({ length: MAX_SLOTS - 1 }, (_, i) => slot(`n${String(i).padStart(2, '0')}`, 1, ob('five_hour', 1, t - i)))
  const a = sess('a', [own('five_hour', 40)], { five_hour: t - 5000 })
  const b = sess('b', [own('five_hour', 41)], { five_hour: t - 6000 })
  let file: string | null = shareText(newer), writes = 0
  const seen: string[] = []
  for (let i = 0; i < 20; i++) {
    for (const s of i % 2 ? [b, a] : [a, b]) { const out = tick(s, file, NOW + i * 5); if (out !== null) { file = out; writes++ } }
    seen.push(file!)
  }
  expect(writes).toBeLessThanOrEqual(2)
  expect(new Set(seen.slice(2)).size).toBe(1) // 그 뒤로 파일이 그대로
  const ids = parseShare(file!)!.slots.map(s => s.id)
  expect(ids).toHaveLength(MAX_SLOTS)
  expect(ids).toContain('a') // 둘 중 새 쪽(a)만 든다
  expect(ids).not.toContain('b')
})

test('자기 값의 나이: 바뀐 종류만 지금, 그대로면 앞 시각, 없어진 종류는 지운다, 기록이 없으면 처음 본 값은 0', () => {
  const a = [own('five_hour', 10), own('seven_day', 20)]
  expect(nextOwnAt([], {}, a, false, NOW)).toEqual({ five_hour: 0, seven_day: 0 })
  expect(nextOwnAt([], {}, a, true, NOW)).toEqual({ five_hour: NOW, seven_day: NOW }) // 첫 응답 전엔 비어 있다가 생겼다
  expect(nextOwnAt(a, { five_hour: 5, seven_day: 6 }, a, true, NOW)).toEqual({ five_hour: 5, seven_day: 6 })
  expect(nextOwnAt(a, { five_hour: 5, seven_day: 6 }, [own('five_hour', 11)], true, NOW)).toEqual({ five_hour: NOW })
  expect(nextOwnAt(a, { five_hour: 0, seven_day: 6 }, a, true, NOW)).toEqual({ five_hour: 0, seven_day: 6 }) // 나이 모름은 바뀔 때까지 모름
  // 리셋 시각이 같은 창 안에서 흔들리는 것은 바뀐 것이 아니다. 창이 바뀌면 바뀐 것
  const j = a.map(w => ({ ...w, resetsAt: w.resetsAt + 1 }))
  expect(nextOwnAt(a, { five_hour: 5, seven_day: 6 }, j, true, NOW)).toEqual({ five_hour: 5, seven_day: 6 })
  const far = a.map(w => ({ ...w, resetsAt: w.resetsAt + SAME_WINDOW_S + 1 }))
  expect(nextOwnAt(a, { five_hour: 5, seven_day: 6 }, far, true, NOW)).toEqual({ five_hour: NOW, seven_day: NOW })
})
