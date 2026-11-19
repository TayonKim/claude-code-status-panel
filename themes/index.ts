// 고를 수 있는 테마 목록(/skin <이름>, 인자 없으면 고르기 창). hidden 은 창·목록에서 빠진다. 묶음 형식과 계약은 hooks/theme.ts·hooks/scene.ts 머리말.
// 새 테마: themes/<id>/ 에 sprites.json(+ friends.json, scene.ts)을 두고 여기에 한 줄. 그림 파일은 실행 중에 읽고, scene.ts 는 여기서 불러온다.
import type { ThemeEntry } from '../hooks/theme'
import sample from './sample/scene'
import kirby from './kirby/scene'
import mario from './mario/scene'
import pokemon from './pokemon/scene'

export const THEMES: Record<string, ThemeEntry> = {
  clawd: { names: ['clawd', '클로드', '기본', 'default'], label: { ko: 'Clawd', en: 'Clawd' } },
  sample: { names: ['sample', '예시'], scene: sample, hidden: true },
  kirby: { names: ['커비', 'kirby'], label: { ko: '커비', en: 'Kirby' }, scene: kirby },
  mario: { names: ['마리오', 'mario'], label: { ko: '마리오', en: 'Mario' }, scene: mario },
  pokemon: { names: ['포켓몬', 'pokemon', '피카츄', 'pikachu'], label: { ko: '포켓몬', en: 'Pokémon' }, scene: pokemon },
}
