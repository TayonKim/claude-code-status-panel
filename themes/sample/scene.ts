// 시험용 예시 테마의 놀이터 배경: 네모 몇 개(하늘 두 띠·네모 언덕·풀밭, 낮엔 흘러가는 네모 구름, 밤엔 깜빡이는 네모 별).
// 계약은 hooks/scene.ts 머리말: 판 전체를 채우고, 색 번호는 1 ~ colors().length, 시간은 drift(1.5초 칸)·밤의 0.7초 칸만.
import { GROUND, SCENE_H } from '../../hooks/scene'
import type { Tod, YardScene } from '../../hooks/scene'

const C: Record<Tod, number[]> = {
  //       하늘 위   하늘 아래  언덕      풀밭      구름·별
  day:   [0x9fd3ff, 0xcfe9ff, 0x7fbf7f, 0x5a9e4b, 0xffffff],
  dusk:  [0xf0a070, 0xffd0a0, 0xa08060, 0x7a7a40, 0xffe0c0],
  night: [0x101830, 0x203060, 0x203040, 0x204030, 0xfff0b0],
}
const SKY1 = 1, SKY2 = 2, HILL = 3, GRASS = 4, LIGHT = 5
const box = (g: Uint8Array, W: number, x0: number, y0: number, w: number, h: number, c: number) => {
  for (let y = Math.max(0, y0); y < Math.min(SCENE_H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) g[y * W + x] = c
}

const scene: YardScene = {
  sky: SKY2,
  colors: tod => C[tod],
  dim: tod => (tod === 'day' ? 1 : tod === 'dusk' ? 0.9 : 0.75),
  ground: tod => C[tod][GRASS - 1]!,
  base: (g, W) => {
    box(g, W, 0, 0, W, 40, SKY1)
    box(g, W, 0, 40, W, SCENE_H - 40, SKY2)
    for (let x = 0; x < W; x += 40) box(g, W, x, 60 + ((x / 40) % 2) * 6, 28, SCENE_H, HILL)
    box(g, W, 0, GROUND - 6, W, SCENE_H, GRASS)
  },
  back: (g, { W, tod, step, drift }) => {
    if (tod === 'night') {
      for (let i = 0; i < 6; i++) if ((Math.floor(step / 700) + i) % 3 !== 0) box(g, W, Math.round(((i * 37 + 11) % 100) / 100 * (W - 3)), 6 + (i % 3) * 9, 2, 2, LIGHT)
      return
    }
    box(g, W, ((drift + 20) % (W + 24)) - 12, 12, 12, 5, LIGHT)
  },
}
export default scene
