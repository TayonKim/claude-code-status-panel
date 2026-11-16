import { expect, test } from 'claude-code/testing'

import { adler32, crc32, deflateFixed, encodeIndexedPng } from '../hooks/png'
import { decodePng, inflateFixed } from './helpers'

// 직접 만든 PNG(색 번호 그림, 고정 허프만 deflate)가 표준대로인지.
// 실행: claude plugin test .

const bytes = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0)))

test('CRC32 · Adler32 는 알려진 값과 같다', async () => {
  expect(crc32(bytes('IEND'))).toBe(0xae426082)
  expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
  expect(adler32(bytes('Wikipedia'))).toBe(0x11e60398)
})

test('deflate: 되풀면 원래대로, 되풀이가 많으면 크게 줄어든다', async () => {
  const cases: Uint8Array[] = [
    Uint8Array.from([]), Uint8Array.from([7]), bytes('abcabcabcabc'), new Uint8Array(1000).fill(200),
    Uint8Array.from({ length: 600 }, (_, i) => (i * 37) % 256), // 되풀이 거의 없음(9비트 글자도 섞임)
    Uint8Array.from({ length: 3000 }, (_, i) => (Math.floor(i / 300) % 2 ? 5 : 0)),
  ]
  for (const c of cases) expect([...inflateFixed(deflateFixed(c))]).toEqual([...c])
  // 윗줄 그대로(stride)도 맞게 풀린다
  const rows = Uint8Array.from({ length: 50 * 40 }, (_, i) => ((i % 50) * 7 + Math.floor(Math.floor(i / 50) / 3)) % 256)
  expect([...inflateFixed(deflateFixed(rows, 50))]).toEqual([...rows])
  expect(deflateFixed(new Uint8Array(70000).fill(1)).length).toBeLessThan(500)
})

test('색 번호 PNG: 조각 차례·크기·팔레트·투명·픽셀이 맞다', async () => {
  const w = 30, h = 12
  const px = new Uint8Array(w * h)
  for (let y = 3; y < 9; y++) for (let x = 5; x < 20; x++) px[y * w + x] = y < 6 ? 1 : 2
  const d = decodePng(encodeIndexedPng(w, h, px, [0, 0xd97757, 0x1a4d80]))
  expect(d.types).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
  expect([d.w, d.h, d.colorType]).toEqual([w, h, 3])
  expect(d.palette).toEqual([0, 0xd97757, 0x1a4d80])
  expect(d.trns).toEqual([0]) // 0번 색만 투명
  expect(d.zlibHeader).toEqual([0x78, 0x01])
  expect([...d.px]).toEqual([...px])
})
