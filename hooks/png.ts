// 팔레트(색 번호) 그림을 PNG 로 만든다. 놀이터 띠처럼 납작한 색이 길게 이어지는 그림은 수 KB 로 줄어든다.
// 실행 환경에 압축 도구가 없어 deflate 를 직접 쓴다: 고정 허프만 + '바로 앞 글자 되풀이'·'윗줄 그대로' 두 가지 되풀이만 찾는다.
// $ 를 쓰지 않는 순수 함수(tests/png.test.tsx).

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export const adler32 = (b: Uint8Array) => {
  let a = 1, s = 0
  for (let i = 0; i < b.length; i++) { a = (a + b[i]!) % 65521; s = (s + a) % 65521 }
  return ((s << 16) | a) >>> 0
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/**
 * deflate(고정 허프만 한 덩어리). stride 가 있으면 'stride 만큼 앞'(= 윗줄)과 '1 앞'(= 같은 글자 되풀이) 두 거리만 본다.
 */
export const deflateFixed = (data: Uint8Array, stride = 0) => {
  const out: number[] = []
  let acc = 0, nb = 0
  const bits = (v: number, len: number) => {
    acc |= v << nb; nb += len
    while (nb >= 8) { out.push(acc & 255); acc >>>= 8; nb -= 8 }
  }
  // 허프만 부호는 높은 자리부터 나간다
  const huff = (code: number, len: number) => { let r = 0; for (let i = 0; i < len; i++) r |= ((code >> i) & 1) << (len - 1 - i); bits(r, len) }
  const sym = (s: number) => {
    if (s <= 143) huff(0x30 + s, 8)
    else if (s <= 255) huff(0x190 + (s - 144), 9)
    else if (s <= 279) huff(s - 256, 7)
    else huff(0xc0 + (s - 280), 8)
  }
  const runAt = (p: number, dist: number) => {
    if (dist <= 0 || p < dist) return 0
    let n = 0
    const max = Math.min(258, data.length - p)
    while (n < max && data[p + n] === data[p + n - dist]) n++
    return n
  }
  bits(1, 1); bits(1, 2) // 마지막 덩어리, 고정 허프만
  let p = 0
  while (p < data.length) {
    const up = stride > 1 ? runAt(p, stride) : 0, rep = runAt(p, 1)
    const len = Math.max(up, rep), dist = up >= rep ? stride : 1
    if (len < 3) { sym(data[p]!); p++; continue }
    let li = LBASE.length - 1
    while (LBASE[li]! > len) li--
    sym(257 + li)
    if (LEXT[li]) bits(len - LBASE[li]!, LEXT[li]!)
    let di = DBASE.length - 1
    while (DBASE[di]! > dist) di--
    huff(di, 5)
    if (DEXT[di]) bits(dist - DBASE[di]!, DEXT[di]!)
    p += len
  }
  sym(256)
  if (nb > 0) out.push(acc & 255)
  return Uint8Array.from(out)
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const chunk = (type: string, data: number[] | Uint8Array) => {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  return [...be32(data.length), ...body, ...be32(crc32(body))]
}

/**
 * 색 번호 그림 → PNG 바이트. px 는 줄마다 w 개씩 h 줄(색 번호 0~255), palette 는 0xRRGGBB, 0번은 투명.
 */
export const encodeIndexedPng = (w: number, h: number, px: Uint8Array, palette: number[]) => {
  const raw = new Uint8Array((w + 1) * h) // 줄마다 걸러내기 방식 0 한 바이트 + 색 번호들
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  const z = deflateFixed(raw, w + 1)
  const idat = new Uint8Array(2 + z.length + 4)
  idat[0] = 0x78; idat[1] = 0x01
  idat.set(z, 2)
  idat.set(be32(adler32(raw)), 2 + z.length)
  const plte: number[] = []
  for (const c of palette) plte.push((c >> 16) & 255, (c >> 8) & 255, c & 255)
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(w), ...be32(h), 8, 3, 0, 0, 0]),
    ...chunk('PLTE', plte),
    ...chunk('tRNS', [0]),
    ...chunk('IDAT', idat),
    ...chunk('IEND', []),
  ])
}
