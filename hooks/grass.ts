// '최근 7일' 덩어리(시안24 나안, 폴더 줄 뺌): hooks/week.py 가 낸 날짜별 작업 시간·토큰을 잔디 한 줄로 그린다.
// $ 를 쓰지 않는 순수 함수만 둔다(tests/grass.test.tsx 가 그대로 부른다).
import { base64 } from './clawd'
import { encodeIndexedPng } from './png'
import type { WeekDay, WeekStats } from '../types'

/** week.py 의 한 줄 JSON → 쓸 값. 오류·모양이 틀리면 null(지난 값을 그대로 둔다). folders·turns 는 쓰지 않는다 */
export const parseWeek = (stdout: string): WeekStats | null => {
  try {
    const j = JSON.parse(stdout.trim()) as Record<string, unknown>
    if (!j || typeof j !== 'object' || j.error || !Array.isArray(j.days)) return null
    const days: WeekDay[] = []
    for (const d of j.days as Record<string, unknown>[]) {
      if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return null
      days.push({ date: d.date, secs: Math.max(0, Math.round(Number(d.secs) || 0)), tokens: Math.max(0, Math.round(Number(d.tokens) || 0)) })
    }
    if (!days.length) return null
    const t = (j.total ?? {}) as Record<string, unknown>
    return {
      at: Number(j.at) || 0, partial: !!j.partial, days,
      total: { secs: Math.max(0, Math.round(Number(t.secs) || 0)), tokens: Math.max(0, Math.round(Number(t.tokens) || 0)) },
    }
  } catch { return null }
}

/** 'YYYY-MM-DD' → 그 지역 날짜의 자정. Date.parse 는 UTC 로 읽어 하루가 밀릴 수 있어 숫자로 나눈다 */
export const localDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}
export const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** 오늘(지역 날짜) 칸의 번호. 자료가 어제 것이면 -1 */
export const todayIdx = (days: readonly WeekDay[], now: Date) => days.findIndex(d => d.date === ymdOf(now))
/** 요일 번호(0=일) */
export const weekdayOf = (ymd: string) => localDate(ymd).getDay()

/** 토큰: 1000 미만 그대로, 백만 미만 k(10k 미만만 소수 한 자리), 그 이상 M(10M 미만만 소수 한 자리) */
export const tokensText = (n: number) => {
  const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')
  if (n < 1000) return String(n)
  // 999,600 처럼 반올림하면 1000k 가 되는 값은 M 으로 넘긴다
  if (n < 999_500) return n < 9_950 ? `${one(n / 1000)}k` : `${Math.round(n / 1000)}k`
  return n < 9_950_000 ? `${one(n / 1_000_000)}M` : `${Math.round(n / 1_000_000)}M`
}

/** 날마다 칸 수: (폭-2)/7 을 3~6 으로 자른다(46칸이면 6) */
export const grassPer = (bodyColumns: number) => Math.max(3, Math.min(6, Math.floor((bodyColumns - 2) / 7)))
/** 칸 하나의 픽셀 크기: 시계·배터리 그림과 같다(Monaco 12 칸 7.2×17pt 의 2배, clock.ts CLOCK_W/CLOCK_COLS) */
export const CELL_W = 14.4
export const CELL_H = 34

// 팔레트: 0 투명 · 1 바탕(일 안 한 날, 어두운 회색이라 밝은 바탕에서도 보인다) · 2..(1+STEPS) 바탕→주황 · 마지막 오늘 테두리
const BASE: [number, number, number] = [64, 64, 70]
const HOT: [number, number, number] = [217, 119, 87] // Clawd 주황 #D97757
export const STEPS = 8
const hex = (c: number[]) => (c[0]! << 16) | (c[1]! << 8) | c[2]!
export const GRASS_PALETTE = [
  0, hex(BASE),
  ...Array.from({ length: STEPS }, (_, i) => {
    const t = 0.25 + (0.75 * (i + 1)) / STEPS
    return hex(BASE.map((b, k) => Math.round(b + (HOT[k]! - b) * t)))
  }),
  hex(HOT),
]
const EDGE = GRASS_PALETTE.length - 1
/** 그날 색 번호: 0 인 날은 바탕(1), 나머지는 secs/최댓값 비율의 단계(2..) */
export const grassLevel = (secs: number, max: number) =>
  secs <= 0 || max <= 0 ? 1 : 1 + Math.max(1, Math.min(STEPS, Math.ceil((secs / max) * STEPS)))

/** 그림 열쇠: 이게 같으면 그림도 같다 */
export const grassKey = (days: readonly WeekDay[], today: number, per: number) => {
  const max = Math.max(0, ...days.map(d => d.secs))
  return `${per}|${today}|${days.map(d => grassLevel(d.secs, max)).join('')}`
}

const roundIn = (px: number, py: number, x: number, y: number, w: number, h: number, r: number) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r), qy = Math.abs(py - (y + h / 2)) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r <= 0
}
/** 잔디 그림 크기(픽셀) */
export const grassSize = (per: number) => ({ w: Math.round(7 * per * CELL_W), h: CELL_H })

let memo = { key: '', png: '' }
/**
 * 잔디 한 줄 PNG(base64, 색 번호 그림). 날마다 per 칸 안에 둥근 네모(너비 ≈ per-1.4 칸, 높이 ≈ 줄의 72%, 모서리 4px),
 * 오늘 칸은 주황 테두리 2px. 바탕은 투명.
 */
export const grassPng = (days: readonly WeekDay[], today: number, per: number) => {
  const key = grassKey(days, today, per)
  if (memo.key === key) return memo.png
  const { w: W, h: H } = grassSize(per)
  const cw = W / (7 * per), sw = cw * (per - 1.4), sh = H * 0.72, y0 = (H - sh) / 2, R = 4, T = 2
  const max = Math.max(0, ...days.map(d => d.secs))
  const px = new Uint8Array(W * H)
  days.slice(0, 7).forEach((d, i) => {
    const x0 = (i * per + per / 2) * cw - sw / 2, lv = grassLevel(d.secs, max), edge = i === today
    for (let y = Math.floor(y0); y < Math.ceil(y0 + sh); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + sw); x++) {
        const cx = x + 0.5, cy = y + 0.5
        if (!roundIn(cx, cy, x0, y0, sw, sh, R)) continue
        const inner = roundIn(cx, cy, x0 + T, y0 + T, sw - 2 * T, sh - 2 * T, Math.max(0, R - T))
        px[y * W + x] = edge && !inner ? EDGE : lv
      }
    }
  })
  memo = { key, png: base64(encodeIndexedPng(W, H, px, GRASS_PALETTE)) }
  return memo.png
}

/** 그림을 못 그리는 터미널의 글자 잔디: 진하기 세 단계(흐림·suggestion·claude) */
export const grassTextTone = (secs: number, max: number): 'dim' | 'suggestion' | 'claude' => {
  const t = max > 0 ? secs / max : 0
  return t <= 0 || t < 1 / 3 ? 'dim' : t < 2 / 3 ? 'suggestion' : 'claude'
}
