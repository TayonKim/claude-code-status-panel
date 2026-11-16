import { expect, test } from 'claude-code/testing'

import { FLOOR_NONE, fitDone, nextFloor } from '../hooks/layout'

// 최근 끝남을 몇 개 보일지, 놀이터를 둘 자리가 있는지(줄 수 맞추기).
// 실행: claude plugin test .

const f = (bodyRows: number, used: number, yardRows: number, total: number, open: boolean) =>
  fitDone({ bodyRows, used, yardRows, total, open, closedShow: 2 })

test('펼침: 자리가 넉넉하면 모두, 모자라면 놀이터를 침범하지 않을 만큼만', async () => {
  expect(f(44, 20, 9, 8, true)).toEqual({ yard: true, shown: 8, hidden: 0, button: 'fold', rows: 10 })
  // 44 - 26 - 9 = 9줄: 제목 1 + 목록 7 + 단추 1
  expect(f(44, 26, 9, 8, true)).toEqual({ yard: true, shown: 7, hidden: 1, button: 'fold', rows: 9 })
  // 놀이터와 합쳐 패널을 넘지 않는다
  for (let used = 10; used <= 31; used++) {
    const r = f(44, used, 9, 8, true)
    if (r.yard) expect(used + r.rows + 9).toBeLessThanOrEqual(44)
  }
})

test('접힘: 2개 + 외 N개, 2개도 안 들어가면 놀이터를 빼고 정보부터', async () => {
  expect(f(44, 20, 9, 8, false)).toEqual({ yard: true, shown: 2, hidden: 6, button: 'more', rows: 4 })
  // 44 - 32 - 9 = 3줄 < 제목+2개+단추 4줄 → 놀이터 없이 펼친 만큼
  expect(f(44, 32, 9, 8, true)).toEqual({ yard: false, shown: 8, hidden: 0, button: 'fold', rows: 10 })
  expect(f(44, 31, 9, 8, true)).toEqual({ yard: true, shown: 2, hidden: 6, button: 'fold', rows: 4 })
})

test('목록이 짧거나 없을 때, 패널 줄 수를 모를 때', async () => {
  expect(f(44, 20, 9, 2, true)).toEqual({ yard: true, shown: 2, hidden: 0, button: null, rows: 3 })
  expect(f(44, 20, 9, 0, true)).toEqual({ yard: true, shown: 0, hidden: 0, button: null, rows: 0 })
  expect(f(44, 40, 9, 0, true).yard).toBe(false)
  expect(f(0, 99, 9, 8, true)).toEqual({ yard: true, shown: 8, hidden: 0, button: 'fold', rows: 10 })
  expect(f(44, 20, 0, 8, true)).toEqual({ yard: false, shown: 8, hidden: 0, button: 'fold', rows: 10 })
})

test('놀이터 바닥: 줄면 바로, 커지면 raiseMs 동안 이어질 때만 따라간다', async () => {
  const R = 600_000
  let f = nextFloor(FLOOR_NONE, 44, 0, R)
  expect(f).toEqual({ rows: 44, tallerSince: 0 })
  f = nextFloor(f, 41, 1000, R) // 아래 줄이 생겨 줄면 바로
  expect(f).toEqual({ rows: 41, tallerSince: 0 })
  f = nextFloor(f, 44, 2000, R) // 다시 커지면 기다린다
  expect(f).toEqual({ rows: 41, tallerSince: 2000 })
  f = nextFloor(f, 43, 2000 + R - 1, R) // 커진 채로 아직 덜 됐으면 그대로
  expect(f.rows).toBe(41)
  f = nextFloor(f, 44, 2000 + R, R) // 이어서 R 이 지나면 한 번에
  expect(f).toEqual({ rows: 44, tallerSince: 0 })
  // 커졌다가 도로 같아지면 기다림을 지운다
  expect(nextFloor(nextFloor({ rows: 41, tallerSince: 0 }, 44, 0, R), 41, 10, R)).toEqual({ rows: 41, tallerSince: 0 })
  // 줄 수를 모르면(0) 그대로
  expect(nextFloor({ rows: 41, tallerSince: 5 }, 0, 99, R)).toEqual({ rows: 41, tallerSince: 5 })
})
