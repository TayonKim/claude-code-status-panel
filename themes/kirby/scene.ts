// 로컬 시험용(저장소에 넣지 않음): yard_kirby_a.ts 의 배경을 YardScene 계약으로 옮긴 것
import { GROUND, SCENE_H, disc, lerp, dimc } from '../../hooks/scene'
import type { Tod, YardScene } from '../../hooks/scene'
const THEME: Record<Tod, { sky: [number, number]; far: number; near: number; grass: number; tuft: number; trunk: number; leaf: number; leaf2: number; cloud: number; cloud2: number; orb: number; dim: number }> = {
  day: { far: 0x14a407, near: 0x00023c, grass: 0x44b219, tuft: 0x2f8a12, trunk: 0x2e2e48, leaf: 0x14a407, leaf2: 0x61e053, cloud: 0xf9fff8, cloud2: 0xb2daf1, sky: [0x26a7ff, 0x34adff], orb: 0xfff0a0, dim: 1 },
  dusk: { far: 0x3f9117, near: 0x311d3e, grass: 0x629b24, tuft: 0x527f1f, trunk: 0x523d46, leaf: 0x3f9117, leaf2: 0x76bd4e, cloud: 0xe3d3c4, cloud2: 0xb1b8bf, sky: [0xf59a6e, 0xffd9a8], orb: 0xffc86e, dim: 0.92 },
  night: { far: 0x103e1f, near: 0x090e2f, grass: 0x1e4225, tuft: 0x173722, trunk: 0x171b33, leaf: 0x103e1f, leaf2: 0x265036, cloud: 0x535966, cloud2: 0x3e4e65, sky: [0x0f1630, 0x26335c], orb: 0xfff0be, dim: 0.72 },
}
const SKY = 6
const I = { far: 7, near: 8, grass: 9, tuft: 10, trunk: 11, leaf: 12, leaf2: 13, cloud: 14, cloud2: 15, orb: 16, star: 17, starDim: 18, fy: 19, fp: 20, fw: 21, sy: 22, so: 23 }
// 이 배경만의 색(낮은 원작 스크린샷에서 뽑은 색, 저녁·밤은 같은 색을 저녁빛·밤빛으로 물들임). 순서 = E 의 번호
const XTRA: Record<Tod, number[]> = {
  day: [0x2a4ef0, 0x1a34b8, 0xf4f8ff, 0x14a407, 0x07c407, 0x61e053, 0x0d7c08, 0x005200, 0x5efa66, 0x1440a0, 0x3a72d8, 0x2a58bc, 0xff87bf, 0x60d734, 0x44b219, 0xffe265, 0xffcb51, 0xffb140, 0x4f3107, 0x5a46a8, 0x30246a],
  dusk: [0x4f54be, 0x434196, 0xe0cec9, 0x3f9117, 0x35a817, 0x76bd4e, 0x3a7518, 0x315612, 0x74cf5b, 0x3a3a86, 0x5a6aa8, 0x4a4c94, 0xe87d9b, 0x76b637, 0x629b24, 0xe8be5b, 0xe8ae4c, 0xe89b40, 0x693f17, 0x6a4a9a, 0x3c2a62],
  // 밤 물(water·water2·water3)은 원작에 없는 연출: 남색이면 파란 친구들이 묻혀 청록 쪽으로 밝힘
  night: [0x162564, 0x111d53, 0x525769, 0x103e1f, 0x0c481f, 0x265036, 0x0d321f, 0x09261d, 0x25573b, 0x1f4a58, 0x3c7c8a, 0x2c6070, 0x553656, 0x264d2c, 0x1e4225, 0x55503b, 0x554935, 0x554230, 0x211c1f, 0x2a2450, 0x18143a],
}
const E = { mtn: 24, mtnD: 25, snow: 26, dome1: 27, dome2: 28, dome3: 29, domeMid: 30, domeDk: 31, line: 32, water: 33, water2: 34, water3: 35, pink: 36, grassL: 37, grassD: 38, whY: 39, whY2: 40, whY3: 41, whDk: 42, purp: 43, purpD: 44 }


const STAR5 = ['..X..', 'XXXXX', '.XXX.', '.X.X.', 'X...X']
const BIRD = { up: ['X...X', '.X.X.', '..X..'], down: ['.....', 'XX.XX', '..X..'] }
const FLY = { open: ['WW.WW', 'WWbWW', '.W.W.'], shut: ['.W.W.', '.WbW.', '..b..'] } // 나비: 날개를 폈다(5칸) 접었다(위로 모아 3칸)
const scene: YardScene = {
  sky: SKY,
  dim: tod => THEME[tod].dim,
  ground: tod => THEME[tod].grass,
  colors: tod => { const T = THEME[tod]; return [
    ...Array.from({ length: SKY }, (_, i) => lerp(T.sky[0], T.sky[1], i / (SKY - 1))),
    T.far, T.near, T.grass, T.tuft, T.trunk, T.leaf, T.leaf2, T.cloud, T.cloud2, T.orb, 0xfff6c8, lerp(T.sky[0], 0xfff6c8, 0.35),
    dimc(0xffdc78, T.dim), dimc(0xffaabe, T.dim), dimc(0xffffff, T.dim), 0xffd23c, 0xd9902a, ...XTRA[tod],
  ] },
  base: (g, W, tod) => {
  for (let y = 0; y < SCENE_H; y++) g.fill(1 + Math.min(SKY - 1, Math.floor((y / (GROUND - 10)) * SKY)), y * W, (y + 1) * W)
  // ── 그린 그린즈(슈퍼 디럭스) 층: 단색 하늘 → 눈 덮인 먼 산 → 둥근 숲 줄 → 연두 물가 선 → 남색 물 → 분홍 물결 언덕 → 풀밭. 왼쪽 끝 별 무늬 노란 기둥 ──
  if (tod === 'dusk') disc(g, W, Math.round(W * 0.72), 40, 9, () => I.orb)
  if (tod === 'night') disc(g, W, W - 30, 13, 6, (dx, dy) => ((dx - 3) * (dx - 3) + (dy + 2) * (dy + 2) > 25 ? I.orb : 0))
  // 먼 산(하나): 꼭대기 y 15, 아래는 숲에 가린다. 오른쪽 비탈은 그늘, 위쪽은 들쭉날쭉한 눈
  { const mx = Math.round(W * 0.42)
    for (let y = 15; y < 46; y++) {
      const half = Math.round((y - 15) * 1.2) + 1
      for (let x = mx - half; x <= mx + half; x++) {
        if (x < 0 || x >= W) continue
        g[y * W + x] = y < 22 + ((x * 7) % 3) ? E.snow : x > mx + 1 ? E.mtnD : E.mtn
      }
    } }
  // 둥근 숲 줄: 반지름 10 덤불이 18도트마다(높이 1도트 엇갈림). 가운데 밝은 세로 줄·꼭대기 반짝, 덤불 사이는 어두운 골
  for (let y = 46; y < 62; y++) g.fill(E.dome1, y * W, (y + 1) * W)
  for (let i = -1; i * 16 < W + 16; i++) {
    const cx = i * 16 + 4, cy = 44 + ((i * 5) % 3), R = 10
    disc(g, W, cx, cy, R, (dx, dy) => (dx * dx + dy * dy > (R - 1) * (R - 1) ? E.domeDk
      : (dx + 4) * (dx + 4) + (dy + 5) * (dy + 5) < 7 ? E.dome3
      : (dx * dx) / 4 + ((dy - 3) * (dy - 3)) / 12 < 1 ? E.domeMid
      : dx < -3 ? E.dome2 : E.dome1))
  }
  // 숲 아래 갈대 띠: 어두운 초록에 밝은 세로 풀잎, 끝은 연두
  for (let y = 54; y < 62; y++) for (let x = 0; x < W; x++)
    g[y * W + x] = x % 3 === 0 ? (y < 56 ? E.line : E.dome2) : x % 3 === 1 && y > 57 ? E.domeMid : E.domeDk
  // 연두 물가 선 → 남색 물(반짝임은 장면마다)
  g.fill(E.line, 62 * W, 63 * W)
  for (let y = 63; y < 72; y++) g.fill(E.water, y * W, (y + 1) * W)
  // 앞 언덕: 연두 윗면 → 분홍 물결 띠 → 풀밭(짙은 풀 무늬)
  for (let y = 72; y < SCENE_H; y++) g.fill(E.grassL, y * W, (y + 1) * W)
  // 오른쪽 턱(원작 화면 오른쪽 약 45%): 윗면 연두 선 → 앞면 분홍 물결 → 그늘 선. 왼쪽 끝은 둥글게 깎는다
  const LX = Math.round(W * 0.66)
  for (let x = LX; x < W; x++) {
    const w = Math.round(1.4 * Math.sin((x - LX) * 0.39)), k = x - LX
    g[72 * W + x] = E.line
    for (let y = 74 + w; y < 77 + w; y++) if (!(k === 0 && y === 74 + w)) g[y * W + x] = E.pink
    g[(77 + w) * W + x] = E.grassD
  }
  for (let y = 72; y < 79; y++) g[y * W + LX - 1] = E.grassD
  for (let y = 80; y < SCENE_H; y++) for (let x = 0; x < W; x++) if ((y % 5 === 0 && (x + y) % 7 < 2) || (y > 90 && (x * 3 + y) % 11 === 0)) g[y * W + x] = E.grassD
  // 왼쪽 노란 기둥(그린 그린즈 첫 화면): 노란 줄기(밝은 세로 줄·오른쪽 그늘·갈색 테두리)에 볼록한 별 무늬와 그 아래 물결 그림자, 밑동은 보라 바위.
  // 처음엔 위스피 우즈 얼굴로 그렸는데, 원작 화면(ref/gg_kss_01.png)의 갈색 무늬는 얼굴이 아니라 별의 그림자였다(2차 검수)
  for (let y = 14; y < GROUND - 1; y++) {
    const edge = 25 + (y > GROUND - 8 ? Math.min(4, y - (GROUND - 8)) : 0)
    for (let x = 0; x <= edge; x++) g[y * W + x] = x === edge ? E.whDk : x >= edge - 3 ? E.whY3 : x % 7 === 3 ? E.whY2 : E.whY
  }
  const STAR = ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.']
  const WAVE = ['.XX.XX.', 'X..X..X']
  for (const [sx, sy] of [[3, 25], [14, 31], [5, 41], [16, 47], [8, 54]] as const) {
    STAR.forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === 'X') g[(sy + j) * W + sx + i] = j === 0 || i === 0 ? E.whY2 : E.whY3 })
    g[(sy + 1) * W + sx + 1] = E.whY2
    WAVE.forEach((row, j) => { for (let i = 0; i < 7; i++) if (row[i] === 'X') g[(sy + 5 + j) * W + sx - 1 + i] = E.whDk })
  }
  for (let y = GROUND - 10; y < GROUND - 1; y++) {
    const edge = 25 + (y > GROUND - 8 ? Math.min(4, y - (GROUND - 8)) : 0)
    for (let x = 0; x <= edge; x++) g[y * W + x] = y === GROUND - 10 || x === edge || (x * 5 + y * 3) % 11 === 0 ? E.purpD : E.purp
  }
  // 잎 덩어리: 왼쪽 위에서 둥글게 내려와 아랫단이 물결(진한 테두리), 아랫단 바로 위는 밝은 띠
  // 판이 좁으면(W ≤ 40) 오른쪽 밖으로 넘친 점이 다음 줄 왼쪽을 덮어서 W - 1 까지만
  for (let x = 0; x <= Math.min(40, W - 1); x++) {
    const bot = Math.round(2 + 20 * Math.sqrt(Math.max(0, 1 - (x / 41) ** 2)) + 2 * Math.abs(Math.sin((x * Math.PI) / 9)))
    for (let y = 0; y <= bot; y++) {
      const rim = (x / 41) ** 2 + ((y - 2) / 20) ** 2 > 0.88
      g[y * W + x] = y >= bot - 1 || rim ? E.domeDk : y >= bot - 4 ? E.dome2 : (x * 3 + y * 5) % 13 === 0 ? E.dome3 : E.dome1
    }
  }
  },
  back: (g, { W, tod, step, r, drift, life, put, glyph }) => {
  if (life.meteor) { // 별똥별: 왼쪽 아래로 가는 밝은 머리와 오른쪽 위로 끌리는 꼬리, 하늘에만(언덕·달 뒤로 지나간다). 마지막 칸은 꼬리만 흐리게
    const { x, y, k } = life.meteor, tail = k === 0 ? 3 : 8
    for (let i = 1; i <= tail; i++) put(x + i + 2, y - Math.round(i / 3), i <= 3 && k < 3 ? I.sy : I.so, true)
    if (k < 3) STAR5.forEach((row, j) => { for (let q = 0; q < 5; q++) if (row[q] === 'X') put(x - 2 + q, y - 2 + j, j === 0 || q === 0 || q === 4 ? I.so : I.sy, true) })
  }
  // 납작한 가로 타원 구름(위 흰색, 아래 옅은 하늘색). 하늘에만 그려 산·나무 뒤로 지나간다
  for (const [bx, by, rw] of [[40, 8, 13], [120, 15, 10], [185, 5, 12]] as const) {
    const cx0 = ((Math.round(bx * r) + drift) % (W + 40)) - 20
    for (let dy = -4; dy <= 4; dy++) for (let dx = -rw; dx <= rw; dx++) {
      if ((dx * dx) / (rw * rw) + (dy * dy) / 16 > 1) continue
      const x = cx0 + dx, y = by + dy
      if (x < 0 || x >= W || y < 0 || g[y * W + x]! > SKY) continue
      g[y * W + x] = dy >= 1 ? I.cloud2 : I.cloud
    }
  }
  if (tod === 'night') {
    const st = [[14, 8], [40, 20], [70, 6], [102, 16], [130, 9], [158, 24], [186, 12], [24, 34], [116, 30], [196, 30]] as const
    st.forEach(([sx, sy], i) => {
      const x = Math.round(sx * r), on = (Math.floor(step / 700) + i) % 4 !== 0
      if (x < 1 || x >= W - 1 || g[sy * W + x]! > SKY) return // 달·구름 위에는 찍지 않는다
      if (i % 3 === 0 && on) { STAR5.forEach((row, j) => { for (let k = 0; k < 5; k++) if (row[k] === 'X' && g[(sy - 2 + j) * W + x - 2 + k]! <= SKY) g[(sy - 2 + j) * W + x - 2 + k] = I.sy }); return }
      g[sy * W + x] = on ? I.sy : I.starDim
      if (on) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (g[(sy + dy) * W + x + dx]! <= SKY) g[(sy + dy) * W + x + dx] = I.so
    })
  }
  // 물 반짝임: 1.5초 칸마다 가로 줄이 한 칸씩 흘러간다
  // 물 칸에만 찍는다: 왼쪽 기둥처럼 물 위에 그린 것은 덮지 않는다
  for (let y = 63; y < 72; y++) for (let x = 0; x < W; x++) {
    if (g[y * W + x] !== E.water) continue
    const k = (x + drift * 2 + y * 5) % 13
    if (y % 2 === 1 && k < 3) g[y * W + x] = E.water2
    else if (y % 3 === 0 && k === 7) g[y * W + x] = E.water3
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
