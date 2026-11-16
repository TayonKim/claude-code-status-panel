// 시험용: hooks/png.ts 가 만든 PNG(고정 허프만 deflate, 색 번호 그림)를 되푼다.
import { adler32, crc32 } from '../hooks/png'

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/** 고정 허프만 한 덩어리짜리 deflate 를 푼다 */
export const inflateFixed = (z: Uint8Array) => {
  let pos = 0, bit = 0
  const rb = (n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) { v |= ((z[pos]! >> bit) & 1) << i; if (++bit === 8) { bit = 0; pos++ } }
    return v
  }
  const out: number[] = []
  rb(1)
  if (rb(2) !== 1) throw new Error('고정 허프만 덩어리가 아니에요')
  const sym = () => {
    let code = 0
    for (let i = 0; i < 7; i++) code = (code << 1) | rb(1)
    if (code <= 0b0010111) return 256 + code
    code = (code << 1) | rb(1)
    if (code >= 0x30 && code <= 0xbf) return code - 0x30
    if (code >= 0xc0 && code <= 0xc7) return 280 + (code - 0xc0)
    code = (code << 1) | rb(1)
    return 144 + (code - 0x190)
  }
  for (;;) {
    const s = sym()
    if (s === 256) break
    if (s < 256) { out.push(s); continue }
    const li = s - 257, len = LBASE[li]! + rb(LEXT[li]!)
    let dc = 0
    for (let i = 0; i < 5; i++) dc = (dc << 1) | rb(1)
    const dist = DBASE[dc]! + rb(DEXT[dc]!)
    for (let i = 0; i < len; i++) out.push(out[out.length - dist]!)
  }
  return Uint8Array.from(out)
}

export const unbase64 = (s: string) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out: number[] = []
  let acc = 0, n = 0
  for (const ch of s) {
    if (ch === '=') break
    acc = (acc << 6) | A.indexOf(ch); n += 6
    if (n >= 8) { n -= 8; out.push((acc >> n) & 255) }
  }
  return Uint8Array.from(out)
}

/** PNG(색 번호 그림)를 풀어 크기·팔레트·색 번호를 돌려준다. 조각마다 CRC, 압축 뒤 adler 를 확인한다 */
export const decodePng = (png: Uint8Array) => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((v, i) => png[i] === v)) throw new Error('PNG 머리가 아니에요')
  const u32 = (i: number) => ((png[i]! << 24) | (png[i + 1]! << 16) | (png[i + 2]! << 8) | png[i + 3]!) >>> 0
  let p = 8, w = 0, h = 0, colorType = -1
  let palette: number[] = [], idat = new Uint8Array(0), trns: number[] = []
  const types: string[] = []
  while (p < png.length) {
    const len = u32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8)), data = png.subarray(p + 8, p + 8 + len)
    if (crc32(png.subarray(p + 4, p + 8 + len)) !== u32(p + 8 + len)) throw new Error(`${type} 조각의 CRC 가 달라요`)
    types.push(type)
    if (type === 'IHDR') { w = u32(p + 8); h = u32(p + 12); colorType = data[9]! }
    if (type === 'PLTE') for (let i = 0; i < len; i += 3) palette.push((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    if (type === 'tRNS') trns = [...data]
    if (type === 'IDAT') idat = Uint8Array.from(data)
    p += 12 + len
  }
  const raw = inflateFixed(idat.subarray(2, idat.length - 4))
  const ad = ((idat[idat.length - 4]! << 24) | (idat[idat.length - 3]! << 16) | (idat[idat.length - 2]! << 8) | idat[idat.length - 1]!) >>> 0
  if (adler32(raw) !== ad) throw new Error('adler32 가 달라요')
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    if (raw[y * (w + 1)] !== 0) throw new Error('걸러내기 방식이 0 이 아니에요')
    px.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w)
  }
  return { w, h, colorType, palette, trns, px, types, zlibHeader: [idat[0]!, idat[1]!] }
}

// ── 그린 트리(ui.drawn())를 글자 줄로 펴기(시험·폭 점검용 근사) ──
// 시험 도구는 화면을 칠하지 않아서, 줄마다 무엇이 놓이는지를 여기서 어림한다: Box 는 flexDirection 대로 옆·아래로 잇고
// (marginLeft·marginTop·marginBottom·paddingTop·minHeight + space-between), Text 는 안의 글자를 한 줄로, Button 은
// plain + hotkey 면 '1: ' 를 앞에, Image·Raster 는 columns × rows 의 ▒·░ 로 둔다. cut 은 그 줄에 wrap="truncate-…" 인
// 글자가 있어 좁으면 … 로 잘린다는 뜻이다(없는 줄은 패널보다 넓으면 넘친다)
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
export type Line = { text: string; cut: boolean }
const W = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)
const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : typeof n === 'number' ? String(n) : n && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : ''
const hasCut = (n: unknown): boolean =>
  !!n && typeof n === 'object' && (/^truncate/.test(String((n as Node).props?.wrap ?? '')) || ((n as Node).children ?? []).some(hasCut))
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - W(s)))
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
export const textLines = (n: unknown): Line[] => {
  if (typeof n === 'string' || typeof n === 'number') return [{ text: String(n), cut: false }]
  if (!n || typeof n !== 'object') return []
  const e = n as Node, p = e.props ?? {}
  if (e.type === 'Text') { const cut = hasCut(e); return textOf(e).split('\n').map(text => ({ text, cut })) }
  if (e.type === 'Button') {
    const t = e.children?.length ? textOf(e) : String(p.label ?? '')
    const head = p.plain ? (p.hotkey ? `${p.hotkey}: ` : '') : '[ '
    return [{ text: `${head}${t}${p.plain ? '' : ' ]'}`, cut: hasCut(e) }]
  }
  if (e.type === 'Image' || e.type === 'Raster')
    return Array.from({ length: num(p.rows) || 1 }, () => ({ text: (e.type === 'Image' ? '▒' : '░').repeat(num(p.columns)), cut: false }))
  if (e.type !== 'Box') return []
  const kids = (e.children ?? []).map(textLines).filter(b => b.length)
  let out: Line[]
  if (p.flexDirection === 'row') {
    const h = Math.max(0, ...kids.map(b => b.length)), ws = kids.map(b => Math.max(0, ...b.map(l => W(l.text))))
    const gap = p.justifyContent === 'space-between' ? '  ' : ''
    out = Array.from({ length: h }, (_, i) => ({
      text: kids.map((b, k) => (k < kids.length - 1 ? pad(b[i]?.text ?? '', ws[k]!) : b[i]?.text ?? '')).join(gap),
      cut: kids.some(b => b[i]?.cut),
    }))
  } else {
    const min = num(p.minHeight), total = kids.reduce((s, b) => s + b.length, 0)
    if (min > total && p.justifyContent === 'space-between' && kids.length > 1)
      kids.splice(kids.length - 1, 0, Array.from({ length: min - total }, () => ({ text: '', cut: false })))
    out = kids.flat()
  }
  const left = ' '.repeat(num(p.marginLeft) + num(p.paddingLeft))
  if (left) out = out.map(l => ({ ...l, text: left + l.text }))
  const blank = (k: number) => Array.from({ length: k }, () => ({ text: '', cut: false }))
  return [...blank(num(p.marginTop) + num(p.paddingTop)), ...out, ...blank(num(p.marginBottom))]
}
/** 펴 놓은 줄을 폭 w 로: 잘리는 줄은 w 를 넘으면 … 로 끊고, 넘치는 줄은 표시를 붙인다 */
export const showLines = (lines: Line[], w: number) => lines.map(l => {
  const t = l.text.replace(/\s+$/, '')
  if (W(t) <= w) return t
  if (!l.cut) return `${t}   <- ${W(t)} > ${w}`
  let s = ''
  for (const ch of t) { if (W(s + ch) > w - 1) break; s += ch }
  return s + '…'
})
export const lineWidth = (l: Line) => W(l.text.replace(/\s+$/, ''))
