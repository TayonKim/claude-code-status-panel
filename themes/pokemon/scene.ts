// 포켓몬 테마 놀이터 배경(팬 도트): 위는 포켓몬 스냅(N64) 해변, 아래 땅은 포켓몬 슬립 그린그래스섬 풀밭.
// 시안/pokemon/yard/yard_pokemon.ts 의 배경을 YardScene 계약으로 옮긴 것(make_theme_bundle.py 가 만든다, 손으로 고치지 말 것).
// 저녁·밤은 같은 층에 색만 물들인 '연출'.
import { GROUND, SCENE_H, disc, lerp, dimc } from '../../hooks/scene'
import type { Tod, YardScene } from '../../hooks/scene'
const THEME: Record<Tod, Record<string, any>> = {
  day:   { sky: [0x6c93ce, 0xacc2e6], cloud: 0xeef4fc, cloud2: 0xc8d8ee, sea1: 0x4b97a5, sea2: 0x56a6a9, sea3: 0x62b8ae, foam: 0xeaf6f2,
           cape: 0x598b8e, cape2: 0x537068, rock: 0x8c8a84, sand1: 0x939089, sand2: 0xa79d92, sand3: 0x998c7c,
           grass: 0x5ed852, tuft: 0x45b83c, tuft2: 0x8ce85c, bush: 0x9be060, bush2: 0x72c843, bush3: 0x5aae38, trunk: 0x4a4038, orb: 0xffec96, dim: 1 },
  dusk:  { sky: [0xe8906a, 0xf8c8a0], cloud: 0xf6d6c4, cloud2: 0xe0a890, sea1: 0x4a6e86, sea2: 0x5a7e8e, sea3: 0x6e8e90, foam: 0xf8d8c0,
           cape: 0x5a6a5a, cape2: 0x4a5448, rock: 0x7a6a62, sand1: 0x9a8478, sand2: 0xa8907e, sand3: 0x96806c,
           grass: 0x6ea048, tuft: 0x55863a, tuft2: 0x8cb858, bush: 0x8ab050, bush2: 0x6c9440, bush3: 0x587a34, trunk: 0x4a3428, orb: 0xffc86e, dim: 0.92 },
  night: { sky: [0x0f1630, 0x26335c], cloud: 0x3a4672, cloud2: 0x2f3a63, sea1: 0x16304a, sea2: 0x1c3a52, sea3: 0x22465a, foam: 0x8aa0c0,
           cape: 0x1e3438, cape2: 0x18282c, rock: 0x2e3440, sand1: 0x3e4458, sand2: 0x4a4e60, sand3: 0x424658,
           grass: 0x24502e, tuft: 0x1a3e24, tuft2: 0x2e6a3a, bush: 0x2e5a30, bush2: 0x24482a, bush3: 0x1c3a22, trunk: 0x3a2a1c, orb: 0xfff0be, dim: 0.85 },
}
const SKY = 6
const I = { sea1: 7, sea2: 8, grass: 9, tuft: 10, trunk: 11, sea3: 12, foam: 13, cloud: 14, cloud2: 15, orb: 16, star: 17, starDim: 18, fy: 19, fp: 20, fw: 21,
  cape: 22, cape2: 23, rock: 24, sand1: 25, sand2: 26, sand3: 27, tuft2: 28, bush: 29, bush2: 30, bush3: 31, fy2: 32, clover: 33 }
const BIRD = { up: ['X...X', '.X.X.', '..X..'], down: ['.....', 'XX.XX', '..X..'] }
const FLY = { open: ['WW.WW', 'WWbWW', '.W.W.'], shut: ['.W.W.', '.WbW.', '..b..'] } // 나비: 날개를 폈다(5칸) 접었다(위로 모아 3칸)

const scene: YardScene = {
  sky: SKY,
  dim: tod => THEME[tod].dim,
  ground: tod => THEME[tod].grass,
  colors: tod => { const T = THEME[tod]; return [
    ...Array.from({ length: SKY }, (_, i) => lerp(T.sky[0], T.sky[1], i / (SKY - 1))),
    T.sea1, T.sea2, T.grass, T.tuft, T.trunk, T.sea3, T.foam, T.cloud, T.cloud2, T.orb, 0xfff6c8, lerp(T.sky[0], 0xfff6c8, 0.35),
    dimc(0xedee6f, T.dim), dimc(0xf4a0c0, T.dim), dimc(0xffffff, T.dim),
    T.cape, T.cape2, T.rock, T.sand1, T.sand2, T.sand3, T.tuft2, T.bush, T.bush2, T.bush3, dimc(0xd8b840, T.dim), dimc(0x3e9a3a, T.dim),
  ] },
  base: (g, W, tod) => {
  for (let y = 0; y < SCENE_H; y++) g.fill(1 + Math.min(SKY - 1, Math.floor((y / (GROUND - 10)) * SKY)), y * W, (y + 1) * W)
  if (tod === 'day') disc(g, W, W - 23, 14, 6, () => I.orb)
  if (tod === 'dusk') disc(g, W, Math.round(W * 0.72), 60, 10, () => I.orb)
  if (tod === 'night') disc(g, W, W - 37, 18, 7, (dx, dy) => ((dx - 3) * (dx - 3) + (dy + 2) * (dy + 2) > 36 ? I.orb : 0))
  // 바다 띠(지평선, 스냅 실측 세 단): 먼 쪽이 진하다
  for (let y = 58; y < 68; y++) g.fill(y < 61 ? I.sea1 : y < 64 ? I.sea2 : I.sea3, y * W, (y + 1) * W)
  // 오른쪽 초록 곶: 바다에서 솟아 오른쪽 끝까지, 왼쪽 비탈은 바위 절벽
  for (let x = Math.max(0, W - 74); x < W; x++) {
    const t = (x - (W - 74)) / 44, top = Math.round(t < 1 ? 67 - 21 * Math.sin(t * Math.PI / 2) : 46 + 2 * Math.sin((x - W) * 0.15))
    const cliff = x >= W - 30
    for (let y = top; y < 68; y++) g[y * W + x] = y - top < (cliff ? 3 : 2) ? I.cape : (cliff && y - top > 3 ? I.rock : I.cape2)
  }
  // 모래: 멀수록 회색, 가까울수록 따뜻한 색, 점 무늬
  for (let y = 68; y < GROUND - 6; y++) g.fill(y < 71 ? I.sand1 : y < 76 ? I.sand2 : I.sand3, y * W, (y + 1) * W)
  for (let x = 3; x < W; x += 9) { g[(70 + (x % 4)) * W + x] = I.sand3; g[(74 + (x % 3)) * W + x + 4] = I.sand1 }
  for (let x = 0; x < W; x++) { // 파도 포말: 바다 칸에만(곶 앞은 덮지 않는다)
    if (g[67 * W + x] === I.sea3 && (x + 2) % 7 < 5) g[67 * W + x] = I.foam
    if ((x + 5) % 7 < 2 && g[67 * W + x] === I.foam) g[68 * W + x] = I.foam
  }
  // 풀밭(슬립 실측을 한 단계 낮춤): 위 가장자리는 들쭉날쭉, 풀 포기 V
  for (let y = GROUND - 6; y < SCENE_H; y++) g.fill(I.grass, y * W, (y + 1) * W)
  for (let x = 0; x < W; x++) { // 모래와 풀밭 경계: 자로 그은 직선 대신 완만한 물결
    const top = GROUND - 7 + Math.round(1.6 * Math.sin(x * 0.05 + 1) - 0.6)
    for (let y = top; y < GROUND - 6; y++) g[y * W + x] = I.grass
  }
  for (let x = 4; x + 2 < W; x += 11) {
    const y = 84 + (x % 9)
    g[y * W + x] = I.tuft; g[(y - 1) * W + x - 1] = I.tuft; g[(y - 1) * W + x + 1] = I.tuft; g[(y - 2) * W + x - 2] = I.tuft2; g[(y - 2) * W + x + 2] = I.tuft2
  }
  // 둥근 덤불(슬립): 둘째·셋째 친구 사이 빈자리, 위 왼쪽이 밝고 아래가 진하다
  disc(g, W, Math.round(W * 0.41), 79, 7, (dx, dy) => (dx * dx + dy * dy > 49 ? I.bush3 : dx + dy < -5 ? I.bush : dy > 3 ? I.bush3 : I.bush2))
  // 꽃: 노란 코스모스 무더기·흰 꽃·분홍 꽃·세잎클로버
  const flower = (x: number, y: number, c: number, mid: number) => { g[y * W + x] = mid; g[(y - 1) * W + x] = c; g[(y + 1) * W + x] = c; g[y * W + x - 1] = c; g[y * W + x + 1] = c }
  for (const [fx, fy] of [[0.1, 91], [0.13, 94], [0.58, 92]] as const) flower(Math.round(W * fx), fy, I.fy, I.fy2)
  for (const [fx, fy] of [[0.31, 93], [0.84, 92]] as const) flower(Math.round(W * fx), fy, I.fw, I.fy)
  for (const [fx, fy] of [[0.45, 94], [0.95, 91]] as const) { const x = Math.round(W * fx); g[fy * W + x] = I.fp; g[fy * W + x + 1] = I.fp }
  for (const fx of [0.22, 0.7]) { const x = Math.round(W * fx); g[90 * W + x] = I.clover; g[91 * W + x - 1] = I.clover; g[91 * W + x + 1] = I.clover }
  },
  back: (g, { W, tod, step, r, drift, life, put, glyph }) => {
  if (tod === 'night') {
    const st = [[14, 8], [40, 20], [70, 6], [102, 16], [130, 9], [158, 24], [186, 12], [24, 34], [116, 30], [196, 30]] as const
    st.forEach(([sx, sy], i) => {
      const x = Math.round(sx * r), on = (Math.floor(step / 700) + i) % 4 !== 0
      if (x < 1 || x >= W - 1 || g[sy * W + x]! > SKY) return // 달 위에는 찍지 않는다
      g[sy * W + x] = on ? I.star : I.starDim
      if (on && i % 3 === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (g[(sy + dy) * W + x + dx]! <= SKY) g[(sy + dy) * W + x + dx] = I.starDim
    })
  }
  if (life.meteor) { // 별똥별: 왼쪽 아래로 가는 밝은 머리와 오른쪽 위로 끌리는 꼬리, 하늘에만(언덕·달 뒤로 지나간다). 마지막 칸은 꼬리만 흐리게
    const { x, y, k } = life.meteor, tail = k === 0 ? 3 : 8
    for (let i = 1; i <= tail; i++) put(x + i, y - Math.round(i / 3), i <= 2 && k < 3 ? I.star : I.starDim, true)
    if (k < 3) put(x, y, I.star, true)
  }
  for (const [bx, by] of [[30, 14], [120, 24], [200, 9]] as const) {
    const cx0 = ((Math.round(bx * r) + drift) % (W + 40)) - 20
    for (const [dx, dy, rr] of [[0, 0, 4], [6, -2, 5], [13, -1, 5], [19, 0, 4], [9, 1, 4]] as const)
      disc(g, W, cx0 + dx, by + dy, rr, (_x, y) => (by + dy + y > by + 2 ? 0 : by + dy + y > by ? I.cloud2 : I.cloud))
  }
  // 바다 반짝임: 1.5초 칸마다 자리가 바뀐다
  for (let i = 0; i < 7; i++) {
    const x = (i * 53 + drift * 7) % W, y = 59 + (i % 3) * 3
    if (g[y * W + x] === I.sea1 || g[y * W + x] === I.sea2 || g[y * W + x] === I.sea3) { g[y * W + x] = I.foam; if (x + 1 < W) g[y * W + x + 1] = I.foam }
  }
  for (const b of life.birds) glyph(b.up ? BIRD.up : BIRD.down, b.x - 2, b.y - 1, () => I.trunk) // 새떼: 구름 앞으로, 날갯짓은 칸마다
  },
  front: (g, { W, tod, life, put, glyph }) => {
  // 앞쪽 풀밭(앞줄 발보다 아래)의 반딧불이·나비는 Clawd 앞에
  for (const f of life.fireflies) {
    if (!f.lit) continue
    put(f.x, f.y, f.lit === 2 ? I.star : I.fy)
    if (f.lit === 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(f.x + dx, f.y + dy, I.fy)
  }
  const wing = [I.fp, I.fy, I.fw]
  for (const b of life.butterflies) glyph(b.open ? FLY.open : FLY.shut, b.x - 2, b.y - 1, ch => (ch === 'b' ? I.trunk : wing[b.c]!))
  },
}
export default scene
