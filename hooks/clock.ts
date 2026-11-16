// 맨 위 시계(둥근 끝 막대 7획 숫자 그림)·배터리 아이콘·배터리 읽기의 순수 함수들(시안 12 'A · 막대 시계, 보통', 2026-11-16).
// 글자(상자 선)로는 iTerm 이 획을 너무 가늘게 그려서, 픽셀을 직접 칠해 Image(rgba)로 넘긴다.
// $ 를 쓰지 않아 단위 시험(tests/clock.test.tsx)이 그대로 부른다.
import { STR } from './i18n'
import type { Lang } from './i18n'
import { base64 } from './clawd'

// ── 도형 → 덮인 정도(0~1). 칸 하나를 3×3 으로 나눠 부드럽게 ──
type Shape = { bbox: [number, number, number, number]; inside: (x: number, y: number) => boolean }
const SS = 3
export const rasterize = (W: number, H: number, shapes: Shape[]) => {
  const cov = new Float32Array(W * H)
  for (const s of shapes) {
    const x0 = Math.max(0, Math.floor(s.bbox[0])), y0 = Math.max(0, Math.floor(s.bbox[1]))
    const x1 = Math.min(W - 1, Math.ceil(s.bbox[2])), y1 = Math.min(H - 1, Math.ceil(s.bbox[3]))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let n = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (s.inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) n++
      if (n) { const i = y * W + x, v = n / (SS * SS); if (v > cov[i]!) cov[i] = v }
    }
  }
  return cov
}
const capsule = (ax: number, ay: number, bx: number, by: number, r: number): Shape => ({
  bbox: [Math.min(ax, bx) - r - 1, Math.min(ay, by) - r - 1, Math.max(ax, bx) + r + 1, Math.max(ay, by) + r + 1],
  inside: (x, y) => {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    const t = Math.max(0, Math.min(1, L ? ((x - ax) * dx + (y - ay) * dy) / L : 0))
    const px = ax + t * dx - x, py = ay + t * dy - y
    return px * px + py * py <= r * r
  },
})
const circle = (cx: number, cy: number, r: number) => capsule(cx, cy, cx, cy, r)
const rrect = (x: number, y: number, w: number, h: number, r: number): Shape => ({
  bbox: [x - 1, y - 1, x + w + 1, y + h + 1],
  inside: (px, py) => {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r), qy = Math.abs(py - (y + h / 2)) - (h / 2 - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r <= 0
  },
})
// 다각형(짝-홀 규칙). 번개 모양에 쓴다
const polygon = (pts: [number, number][]): Shape => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return {
    bbox: [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1],
    inside: (x, y) => {
      let c = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    },
  }
}
const ring = (x: number, y: number, w: number, h: number, r: number, t: number): Shape => {
  const o = rrect(x, y, w, h, r), i = rrect(x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t))
  return { bbox: o.bbox, inside: (px, py) => o.inside(px, py) && !i.inside(px, py) }
}

// ── 시계: 7획 막대(a 위 · b 오른쪽 위 · c 오른쪽 아래 · d 아래 · e 왼쪽 아래 · f 왼쪽 위 · g 가운데) ──
const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
}
const segShapes = (d: string, x0: number, y0: number, w: number, h: number, r: number) => {
  const x1 = x0 + w, y1 = y0 + h, ym = (y0 + y1) / 2, m = r * 1.15, S = SEG[d] ?? '', out: Shape[] = []
  const add = (k: string, ax: number, ay: number, bx: number, by: number) => { if (S.includes(k)) out.push(capsule(ax, ay, bx, by, r)) }
  add('a', x0 + m, y0, x1 - m, y0); add('g', x0 + m, ym, x1 - m, ym); add('d', x0 + m, y1, x1 - m, y1)
  add('f', x0, y0 + m, x0, ym - m); add('b', x1, y0 + m, x1, ym - m)
  add('e', x0, ym + m, x0, y1 - m); add('c', x1, ym + m, x1, y1 - m)
  return out
}
/** 시계 그림의 칸 크기와 픽셀 크기(Monaco 12 칸 7.2×17pt 의 2배). 다른 글꼴이면 iTerm 이 비율을 지켜 줄인다 */
export const CLOCK_COLS = 17
export const CLOCK_ROWS = 3
export const CLOCK_W = 245
export const CLOCK_H = 102
/** 'HH:MM' 을 막대 숫자로 칠한 덮개. weight 1 이 시안의 '보통' */
export const drawClock = (hm: string, W = CLOCK_W, H = CLOCK_H, weight = 1) => {
  const pad = H * 0.08, dh = H - 2 * pad, r = H * 0.035 * weight, dw = dh * 0.5, gap = dh * 0.14, colW = dh * 0.16
  const shapes: Shape[] = []
  let x = pad + r
  for (const ch of hm) {
    if (ch === ':') {
      const cx = x + colW / 2 - gap / 2
      shapes.push(circle(cx, pad + dh * 0.3, r * 1.45), circle(cx, pad + dh * 0.7, r * 1.45))
      x += colW
      continue
    }
    shapes.push(...segShapes(ch, x, pad + r, dw - 2 * r, dh - 2 * r, r))
    x += dw + gap
  }
  return rasterize(W, H, shapes)
}

// ── 배터리 아이콘: 둥근 테두리 + 꼭지 + 잔량만큼 채움 ──
export const BATT_COLS = 4
export const BATT_W = 58
export const BATT_H = 34
// 번개(맥북 배터리 아이콘처럼 충전 중일 때 배터리 가운데에): 단위 상자 안의 꼭짓점
const BOLT: [number, number][] = [[0.62, 0], [0.12, 0.58], [0.46, 0.58], [0.34, 1], [0.88, 0.4], [0.54, 0.4], [0.7, 0]]
export const drawBattery = (pct: number, W = BATT_W, H = BATT_H, charging = false) => {
  const t = H * 0.07, bh = H * 0.56, by = (H - bh) / 2, bw = W * 0.82, bx = W * 0.03
  const outline = rasterize(W, H, [ring(bx, by, bw, bh, bh * 0.28, t), rrect(bx + bw + t * 0.6, by + bh * 0.3, W * 0.07, bh * 0.4, t * 0.6)])
  const ip = t * 1.9, fw = Math.max(0, ((bw - 2 * ip) * Math.max(0, Math.min(100, pct))) / 100)
  const fill = rasterize(W, H, fw > 0 ? [rrect(bx + ip, by + ip, fw, bh - 2 * ip, (bh - 2 * ip) * 0.22)] : [])
  // 번개는 배터리 높이보다 살짝 크게, 가운데에. 바탕이 밝든 어둡든 보이게 어두운 테두리(조금 큰 번개)를 먼저 깐다
  const boltH = bh * 0.98, boltW = boltH * 0.66, ox = bx + bw / 2 - boltW / 2, oy = H / 2 - boltH / 2
  const at = (k: number) => BOLT.map(([u, v]) => [ox + boltW / 2 + (u - 0.5) * boltW * k, oy + boltH / 2 + (v - 0.5) * boltH * k] as [number, number])
  const boltEdge = charging ? rasterize(W, H, [polygon(at(1.28))]) : new Float32Array(W * H)
  const bolt = charging ? rasterize(W, H, [polygon(at(1))]) : new Float32Array(W * H)
  return { outline, fill, boltEdge, bolt }
}

/** 덮개를 한 색으로 RGBA 위에 덧칠한다(투명 바탕) */
export const paint = (cov: Float32Array, rgb: [number, number, number], out = new Uint8Array(cov.length * 4)) => {
  for (let i = 0; i < cov.length; i++) {
    const a = cov[i]!
    if (a <= 0) continue
    const j = i * 4, pa = out[j + 3]! / 255, na = a + pa * (1 - a)
    for (let k = 0; k < 3; k++) out[j + k] = Math.round((rgb[k]! * a + out[j + k]! * pa * (1 - a)) / (na || 1))
    out[j + 3] = Math.round(na * 255)
  }
  return out
}
// 테마 색 이름을 Image 에 쓸 수 없어 밝은·어두운 테마 어디서나 보이는 RGB 로
export const RGB = {
  claude: [217, 119, 87] as [number, number, number],
  gray: [140, 140, 140] as [number, number, number],
  success: [78, 186, 101] as [number, number, number],
  warning: [230, 170, 30] as [number, number, number],
  error: [240, 90, 110] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  dark: [30, 30, 30] as [number, number, number],
}
/** 시계 그림 소스(분이 바뀔 때만 다시 칠한다) */
let clockMemo = { key: '', src: { rgba: '', width: CLOCK_W, height: CLOCK_H } }
export const clockSource = (hm: string) => {
  if (clockMemo.key !== hm) clockMemo = { key: hm, src: { rgba: base64(paint(drawClock(hm), RGB.claude)), width: CLOCK_W, height: CLOCK_H } }
  return clockMemo.src
}
/** 배터리 그림의 열쇠(잔량·충전 중). 이게 같으면 그림도 같다 */
export const battKey = (pct: number, charging: boolean) => `${pct}${charging ? '+' : ''}`
/** 배터리 그림 소스(잔량·충전 중이 바뀔 때만). 충전 중이면 번개를 얹고 잔량 색은 초록 */
let battMemo = { key: '', src: { rgba: '', width: BATT_W, height: BATT_H } }
export const batterySource = (pct: number, charging = false) => {
  const key = battKey(pct, charging)
  if (battMemo.key !== key) {
    const b = drawBattery(pct, BATT_W, BATT_H, charging)
    let px = paint(b.fill, RGB[charging ? 'success' : battColor(pct)], paint(b.outline, RGB.gray))
    if (charging) px = paint(b.bolt, RGB.white, paint(b.boltEdge, RGB.dark, px))
    battMemo = { key, src: { rgba: base64(px), width: BATT_W, height: BATT_H } }
  }
  return battMemo.src
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** 24시간제 'HH:MM' */
export const hmOf = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
/** '11/16 (월)' · 영어는 '11/16 Mon' */
export const dateOf = (d: Date, lang: Lang = 'ko') => STR[lang].date(d.getMonth() + 1, d.getDate(), STR[lang].weekdays[d.getDay()] ?? '')

/**
 * `pmset -g batt` 의 출력에서 잔량과 충전 중인지. 배터리가 없는 맥(맥미니)은 잔량 줄이 없어 pct 가 null.
 * 예: " -InternalBattery-0 (id=…)	69%; discharging; 4:28 remaining present: true"
 */
export const parseBatt = (out: string): { pct: number | null; charging: boolean } => {
  const m = out.match(/(\d{1,3})%;\s*([^;]+);/)
  if (!m) return { pct: null, charging: false }
  return { pct: Math.min(100, Number(m[1])), charging: m[2]!.trim().toLowerCase() === 'charging' }
}
/** 그림을 못 그릴 때 쓰는 글자 막대의 칸 수, 잔량 색(20% 이하 노랑, 10% 이하 빨강) */
export const BATT_CELLS = 6
export const battFill = (pct: number) => Math.max(0, Math.min(BATT_CELLS, Math.round((pct / 100) * BATT_CELLS)))
export const battColor = (pct: number): 'success' | 'warning' | 'error' => (pct <= 10 ? 'error' : pct <= 20 ? 'warning' : 'success')
