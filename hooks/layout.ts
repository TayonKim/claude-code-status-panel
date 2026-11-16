// 패널 줄 수 맞추기(순수 함수, tests/layout.test.tsx): 최근 끝남을 몇 개 보일지, 맨 아래 놀이터를 둘 자리가 있는지.
// 펼친 최근 끝남이 길어 놀이터가 패널 밖으로 밀려나 사라졌다(사용자 2026-11-16). 남는 줄만큼만 보이고, 넘치는 것은 '외 N개' 로 줄인다.

export type DoneFit = {
  /** 놀이터를 그릴지(최근 끝남을 접힌 만큼으로 줄여도 들어가야 그린다) */
  yard: boolean
  /** 보일 최근 끝남 개수 */
  shown: number
  /** 보이지 않는 개수 */
  hidden: number
  /** 단추: more = '외 N개 ▸'(펼치기), fold = '접기 ▴'(숨긴 것이 있으면 '외 N개 · 접기 ▴'), null = 없음 */
  button: null | 'more' | 'fold'
  /** 최근 끝남 칸이 쓰는 줄(제목 + 목록 + 단추) */
  rows: number
}

/**
 * bodyRows: 패널이 그릴 수 있는 줄(0 이하면 모른다: 맞추지 않는다), used: 최근 끝남과 놀이터를 뺀 나머지가 쓰는 줄,
 * yardRows: 놀이터 높이(그리지 않으면 0), total: 최근 끝남 개수, open: 펼침, closedShow: 접었을 때 보일 개수
 */
export const fitDone = (o: { bodyRows: number; used: number; yardRows: number; total: number; open: boolean; closedShow: number }): DoneFit => {
  const { total, open, closedShow } = o
  const want = open ? total : Math.min(total, closedShow)
  const buttonFor = (shown: number): DoneFit['button'] =>
    open ? (total > closedShow || shown < total ? 'fold' : null) : shown < total ? 'more' : null
  const rowsFor = (shown: number) => (total ? 1 + shown + (buttonFor(shown) ? 1 : 0) : 0)
  const done = (yard: boolean, shown: number): DoneFit => ({ yard, shown, hidden: total - shown, button: buttonFor(shown), rows: rowsFor(shown) })
  if (o.bodyRows <= 0) return done(o.yardRows > 0, want)
  // 놀이터는 최근 끝남을 접힌 만큼(closedShow 개 + 단추)으로 줄였을 때 들어가야 그린다. 정보가 장식보다 먼저다
  const least = Math.min(want, closedShow)
  const yard = o.yardRows > 0 && o.used + rowsFor(least) + o.yardRows <= o.bodyRows
  if (!yard) return done(false, want) // 놀이터가 없으면 원래대로(넘치면 패널이 스크롤된다)
  const room = o.bodyRows - o.used - o.yardRows
  let shown = want
  while (shown > least && rowsFor(shown) > room) shown--
  return done(true, shown)
}

// 놀이터 바닥 높이(사용자 2026-11-16): 패널 높이(bodyRows)는 왼쪽 세션 아래 입력창·작업자 줄이 늘고 줄 때마다 바뀐다.
// 맨 아래에 붙은 놀이터가 그때마다 옮겨지면 iTerm 이 그림 칸을 갈색으로 칠해 번쩍였다.
// 그래서 패널이 줄면 바로 따라가고(그림이 잘리지 않게), 커진 것은 raiseMs 동안 이어질 때만 한 번에 따라간다.
export type Floor = { rows: number; tallerSince: number }
export const FLOOR_NONE: Floor = { rows: 0, tallerSince: 0 }
export const nextFloor = (f: Floor, bodyRows: number, now: number, raiseMs: number): Floor => {
  if (bodyRows <= 0) return f
  if (!f.rows || bodyRows < f.rows) return { rows: bodyRows, tallerSince: 0 }
  if (bodyRows === f.rows) return f.tallerSince ? { rows: f.rows, tallerSince: 0 } : f
  if (!f.tallerSince) return { rows: f.rows, tallerSince: now }
  return now - f.tallerSince >= raiseMs ? { rows: bodyRows, tallerSince: 0 } : f
}
