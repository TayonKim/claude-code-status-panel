// 마리오 테마 놀이터 배경(슈퍼 마리오브라더스 3 의 1-1 을 보고 새로 그림): 시안/mario/yard/yard_mario.ts 의 배경을 YardScene 계약으로 옮긴 것.
// 원작은 낮뿐이라 저녁·밤은 색만 물들인다(연출). 지나가는 생물은 없다(원작에 없는 것을 지어내지 않음).
import { GROUND, SCENE_H, lerp, dimc } from '../../hooks/scene'
import type { Tod, YardScene } from '../../hooks/scene'

const DAY: Record<string, number> = {
  sky: 0xb5ebf2, k: 0x000000, w: 0xfffeff, shade: 0xc0dfff, hillD: 0x0c9300, hillL: 0x5ce430,
  pink: 0xfeccc5, orange: 0xea9e22, blue: 0xc0dfff, bolt: 0xb5ebf2, wood: 0xea9e22, star: 0xfff6c8, starDim: 0x8a96b0,
  bevB: 0x64b0ff,
}
const NAMES = Object.keys(DAY)
const TINT: Record<Tod, { to: number; t: number; k: number; dim: number }> = {
  day: { to: 0, t: 0, k: 1, dim: 1 },
  dusk: { to: 0xf59a6e, t: 0.3, k: 0.95, dim: 0.92 },
  night: { to: 0x1a2350, t: 0.62, k: 0.8, dim: 0.72 },
}
const tint = (c: number, tod: Tod) => (c === 0 ? 0 : dimc(lerp(c, TINT[tod].to, TINT[tod].t), TINT[tod].k))
// 하늘은 저녁·밤에 더 진하게 물들이고(노을·남색), 별은 물들이지 않는다(연출)
const SKY_TOD: Record<Tod, number> = { day: 0xb5ebf2, dusk: 0xf4a77c, night: 0x1c2a52 }
const bgColor = (n: string, tod: Tod) => (n === 'sky' ? SKY_TOD[tod] : n === 'star' || n === 'starDim' ? DAY[n]! : tint(DAY[n]!, tod))
const I: Record<string, number> = {}
NAMES.forEach((n, i) => { I[n] = i + 1 })
const PINK_TOP = 80 // 분홍 윗면이 시작하는 줄(뒷줄 발 79 바로 아래)
// ? 블록(3차판, 16×16 = 꼬마 마리오 키): 윗줄·왼줄 살구 하이라이트, 번쩍이는 ? 에 검은 그림자, 네 귀퉁이 검은 리벳
const QB = ['kkkkkkkkkkkkkkkk', 'kppppppppppppppk', 'kpoooooooooooook', 'kpokooooooookook', 'kpooooqqqqoooook', 'kpoooqqkkqqooook',
  'kpooookkoqqkoook', 'kpooooooqqkkoook', 'kpoooooqqkkooook', 'kpooooookkoooook', 'kpoooooqqooooook', 'kpooooookkoooook',
  'kpokooooooookook', 'kpoooooooooooook', 'kpoooooooooooook', 'kkkkkkkkkkkkkkkk']
// 옆 나무 블록(3편): 안쪽에 한 겹 더 작은 네모 테(나뭇결), 리벳은 테두리에서 한 칸 띄움
const WOOD = ['kkkkkkkkkkkkkkkk', 'kppppppppppppppk', 'kpkooooooooookok', 'kpoooooooooooook', 'kpookkkkkkkkoook', 'kpookooooookoook',
  'kpookooooookoook', 'kpookooooookoook', 'kpookooooookoook', 'kpookooooookoook', 'kpookooooookoook', 'kpookkkkkkkkoook',
  'kpoooooooooooook', 'kpkooooooooookok', 'kpoooooooooooook', 'kkkkkkkkkkkkkkkk']
// 구름(3편 1-1): 테두리·눈 없는 흰 구름, 아래만 하늘색 그늘(검은 테·눈은 리메이크판 것)
const CLOUD = ['.....wwww...wwww.....', '...wwwwwwwwwwwwwww...', '..wwwwwwwwwwwwwwwwww.', '.wwwwwwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwwwwwwww', '.wwswwwwswwwwswwwwsw.', '..sss..sss..sss..ss..']

const scene: YardScene = {
  sky: I.sky!,
  dim: tod => TINT[tod].dim,
  ground: tod => tint(DAY.orange!, tod),
  colors: tod => NAMES.map(n => bgColor(n, tod)),
  base: (g, W, _tod) => {
  g.fill(I.sky!)
  const set = (x: number, y: number, c: number) => { if (x >= 0 && y >= 0 && x < W && y < SCENE_H) g[y * W + x] = c }
  // 큰 블록(오른쪽, 3편 1-1): 하늘색 뒤 블록 → 분홍 앞 블록. 검은 테두리에 네 모서리 1도트 깎기,
  // 오른쪽·아랫변 안쪽 입체 테(분홍은 주황, 하늘은 파랑), 둥근 나사(가운데 일자 홈), 오른쪽 6도트 검은 그림자
  const block = (x0: number, y0: number, w: number, c: number, bev: number) => {
    // 3차판: 오른쪽 검은 그림자의 윗단이 45도 사선으로 떨어진다(Argon)
    for (let x = x0 + w; x < x0 + w + 6; x++) for (let y = y0 + 1 + (x - (x0 + w)); y < PINK_TOP; y++) set(x, y, I.k!)
    for (let y = y0; y < PINK_TOP; y++) for (let x = x0; x < x0 + w; x++) {
      const corner = (x === x0 || x === x0 + w - 1) && y === y0
      if (corner) continue
      const edge = x === x0 || x === x0 + w - 1 || y === y0
      const hi = x === x0 + 1 || y === y0 + 1 // 윗변·왼변 안쪽 흰 하이라이트(Carbon)
      set(x, y, edge ? I.k! : x >= x0 + w - 2 || y >= PINK_TOP - 1 ? bev : hi ? I.w! : c)
    }
    const screw = (bx: number, by: number) => {
      for (const [dx, dy] of [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]] as const) set(bx + dx, by + dy, I.k!)
      set(bx + 1, by + 1, I.w!); set(bx + 2, by + 1, I.k!); set(bx + 1, by + 2, I.k!); set(bx + 2, by + 2, c)
    }
    screw(x0 + 2, y0 + 2); screw(x0 + w - 7, y0 + 2); screw(x0 + 2, PINK_TOP - 6); screw(x0 + w - 7, PINK_TOP - 6)
  }
  block(W - 50, 26, 34, I.blue!, I.bevB!)
  block(W - 82, 44, 32, I.pink!, I.orange!)
  // 언덕(왼쪽 끝, 첫 자리 부끄부끄 뒤로만): 둥근 머리의 기둥 모양, 연두 바탕에 '\' 방향 작은 진초록 점 무늬, 오른쪽 안쪽 음영, 검은 테두리
  const hill = (x0: number, w: number, top: number) => {
    const r = Math.floor(w / 2), cx = x0 + r
    const inside = (x: number, y: number) => x >= x0 && x < x0 + w && y >= top && y < PINK_TOP &&
      (y >= top + r || (x - cx) * (x - cx) + (y - (top + r)) * (y - (top + r)) <= r * r)
    for (let y = top; y < PINK_TOP; y++) for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1)
      const stitch = (((x - y) % 6) + 6) % 6 === 0 && (((x + y) % 4) + 4) % 4 < 2
      const shade = !inside(x + 2, y)
      set(x, y, edge ? I.k! : shade || stitch ? I.hillD! : I.hillL!)
    }
  }
  hill(0, 24, 34); hill(18, 26, 40); hill(6, 22, 54)
  // 작은 덤불(3편): 위로 봉긋한 오뚝이 모양, 왼쪽 밝고 오른쪽 진초록, 하늘색 반짝이 +. 친구들 사이 빈자리에(놀이터 엔진의 다섯 자리 간격 기준)
  const bush = (x0: number) => {
    const w = 12, r = 6, top = PINK_TOP - 13, cx = x0 + r
    const inside = (x: number, y: number) => x >= x0 && x < x0 + w && y >= top && y < PINK_TOP &&
      (y >= top + r || (x - cx + 0.5) * (x - cx + 0.5) + (y - (top + r)) * (y - (top + r)) <= r * r)
    for (let y = top; y < PINK_TOP; y++) for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1)
      set(x, y, edge ? I.k! : x >= cx + 2 ? I.hillD! : I.hillL!)
    }
    for (const [sx, sy] of [[x0 + 3, PINK_TOP - 8], [x0 + 7, PINK_TOP - 4]] as const) {
      set(sx, sy, I.shade!); set(sx - 1, sy, I.shade!); set(sx + 1, sy, I.shade!); set(sx, sy - 1, I.shade!); set(sx, sy + 1, I.shade!)
    }
  }
  const slot = (W - 38) / 4
  bush(Math.round(slot + 26)); bush(Math.round(slot * 3 + 28))
  // 땅(3편 1-1): 맨 위 검은 선 → 분홍 윗면 → 검은 선 → 주황·검정 사선 줄무늬('\' 방향, 8도트 주기)
  for (let y = PINK_TOP; y < SCENE_H; y++) for (let x = 0; x < W; x++)
    set(x, y, y === PINK_TOP ? I.k! : y <= GROUND ? I.pink! : y === GROUND + 1 ? I.k! : (((x - y) % 8) + 8) % 8 < 3 ? I.k! : I.orange!)
  },
  back: (g, { W, tod, step, put, glyph }) => {
  const tick = Math.floor(step / 1500)
  // 밤: 별(연출, 원작은 낮뿐)
  if (tod === 'night') {
    const r = W / 207
    ;[[14, 8], [40, 20], [70, 6], [102, 16], [130, 9], [158, 4], [186, 12], [116, 24]].forEach(([sx, sy], i) => {
      const x = Math.round(sx! * r), on = (Math.floor(step / 700) + i) % 4 !== 0
      put(x, sy!, on ? I.star! : I.starDim!, true)
    })
  }
  // 구름: 1.5초 칸마다 1도트씩 흐른다
  const cmap = { k: I.k!, w: I.w!, s: I.shade! }
  for (const [bx, by] of [[0.18, 4], [0.62, 12]] as const) {
    const x = ((Math.round(W * bx) + tick) % (W + 24)) - 22
    glyph(CLOUD, x, by, ch => cmap[ch as keyof typeof cmap])
  }
  // 공중 블록: ? 블록(1.5초 칸마다 ? 가 번쩍) + 나무 블록
  const qx = Math.round(W * 0.47), qy = 22
  const qmap: Record<string, number> = { k: I.k!, o: I.orange!, p: I.pink!, q: tick % 2 ? I.w! : I.pink! }
  glyph(QB, qx, qy, ch => qmap[ch]!)
  const wmap: Record<string, number> = { k: I.k!, o: I.wood!, p: I.pink! }
  glyph(WOOD, qx + 16, qy, ch => wmap[ch]!)
  },
}
export default scene
