import { expect, mock, test } from 'claude-code/testing'

import { CAP, actShift } from '../hooks/clawd'
import type { Sprites } from '../hooks/clawd'
import { crc32 } from '../hooks/png'
import { GROUND, SCENE_H, clawdScene, yardLife } from '../hooks/scene'
import { ASK_MAX, ASK_MIN, THEME_DEFAULT, bigPng, buildTheme, normalizeBig, normalizeFriends, shownThemeNames, skinAnswerId, skinChoices, themeFits, themeIdOf, themeLabelOf, themeNames, themePrefOf } from '../hooks/theme'
import type { ThemeEntry } from '../hooks/theme'
import { YARD, sceneKey, scenePaletteSize, soilRgb, yardCount, yardFrames, yardPlan, yardScenePng, yardStripPng } from '../hooks/yard'
import { THEMES } from '../themes/index'
import sampleScene from '../themes/sample/scene'
import { decodePng, unbase64 } from './helpers'

/** 화면에 나가는 큰 캐릭터 그림: 그 동작의 가운데 정렬 dx 를 준 민무늬(0.8.7) */
const bp = (sp: Sprites, f: number, act = 'idle') => bigPng(sp, f, actShift(sp, act))

// 테마: 묶음 읽기(상태 빠짐 → idle), 이름 고르기, 기본 배경이 0.8.1 과 도트 하나까지 같은지, 테마 배경의 계약(폭 40·46·55),
// /skin 전환·저장·복원·없는 이름·고르기 창, 전환 때 다시 보내는 그림 수.
// 실행: claude plugin test .

// themes/sample 의 sprites.json·friends.json 과 같은 꼴(시험은 .json 을 불러올 수 없다. 파일 자체는 tests/theme_files_test.py 가 본다)
const grid = () => Array.from({ length: 32 }, () => Array.from({ length: 38 }, () => '.'))
const rect = (g: string[][], x0: number, y0: number, x1: number, y1: number, c: string) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y]![x] = c }
const body = (dx: number, eyes: boolean, think: boolean) => {
  const g = grid(); rect(g, 6 + dx, 15, 25 + dx, 30, 'a')
  if (eyes) { rect(g, 10 + dx, 19, 11 + dx, 21, 'c'); rect(g, 19 + dx, 19, 20 + dx, 21, 'c') } else { rect(g, 10 + dx, 20, 11 + dx, 20, 'c'); rect(g, 19 + dx, 20, 20 + dx, 20, 'c') }
  if (think) rect(g, 28, 6, 31, 9, 'b')
  return g.map(r => r.join(''))
}
const buddy = (dy: number) => { const g = grid(); rect(g, 12, 21 + dy, 25, 30 + dy, 'd'); rect(g, 15, 24 + dy, 16, 25 + dy, 'e'); rect(g, 21, 24 + dy, 22, 25 + dy, 'e'); return g.map(r => r.join('')) }
const sampleBig = {
  canvas: [38, 32], ground: 30, palette: { a: '#5B8DEF', b: '#FFFFFF', c: '#1B2A4A' },
  frames: [body(0, true, false), body(0, false, false), body(0, true, true), body(1, true, false)],
  states: { idle: { label: 'idle', ms: 200, seq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }, think: { label: 'think', ms: 400, seq: [0, 2] }, work: { label: 'work', ms: 300, seq: [3, 0] } },
}
const sampleFriends = {
  canvas: [38, 32], ground: 30, palette: { d: '#F2A65A', e: '#3A2412' }, frames: [buddy(0), buddy(-3)],
  states: { idle: { label: 'idle', ms: 600, seq: [0] }, happy: { label: 'happy', ms: 250, seq: [0, 1] } },
}

const row = (s: string) => s + '.'.repeat(38 - s.length)
const blank = () => Array.from({ length: 32 }, () => row(''))
const frame = (i: number) => blank().map((r, y) => (y === 0 ? row('a') : y === 1 ? row('.'.repeat(i + 1) + 'b') : y > 20 ? row('.'.repeat(i % 7) + 'aaaa') : r))
const YS = {
  canvas: [38, 32], box: [19, 8], palette: { a: '#D97757', b: '#000000' },
  frames: Array.from({ length: 40 }, (_, i) => frame(i % 30)),
  states: Object.fromEntries(['bubble', 'kite', 'coffee', 'happy', 'idle'].map((k, i) => [k, { label: k, ms: 100, seq: [i, i + 10] }])),
  png: { plain: [], sticker: [] },
} as unknown as Sprites

// 0.8.1 의 yard.ts(배경을 나누기 전)로 만든 그림의 CRC: 폭·시간대·시각(-1 = 멈춤, 시각 777)
const GOLD = '40:day:0:e499144e 40:day:3000:24cb36c3 40:day:123456789:9af9b522 40:day:-1:5858d025 40:dusk:0:a5e7b78b 40:dusk:3000:84c01589 40:dusk:123456789:29f6eba7 40:dusk:-1:d51e93da 40:night:0:928d64c0 40:night:3000:df6084bb 40:night:123456789:4b1f491e 40:night:-1:a0554f25 46:day:0:35a5bf4b 46:day:3000:37e56e5c 46:day:123456789:d7478642 46:day:-1:15141be8 46:dusk:0:f78ff5df 46:dusk:3000:36828ee2 46:dusk:123456789:7cbe8901 46:dusk:-1:d709cdc6 46:night:0:3445e975 46:night:3000:40fe65f4 46:night:123456789:ba476635 46:night:-1:bf0a983e 55:day:0:fa67614c 55:day:3000:78ca084c 55:day:123456789:67b8b180 55:day:-1:c970ad3c 55:dusk:0:18794b74 55:dusk:3000:a4860b9e 55:dusk:123456789:9d24c929 55:dusk:-1:2740428a 55:night:0:a720b9ca 55:night:3000:e1b6afb2 55:night:123456789:9444b5fc 55:night:-1:1c18293d'

test('기본 Clawd 배경은 0.8.1 과 도트 하나까지 같다(배경을 테마로 나눈 뒤에도)', async () => {
  for (const g of GOLD.split(' ')) {
    const [c, tod, nowS] = g.split(':') as [string, 'day' | 'dusk' | 'night', string]
    const cols = Number(c), now = Number(nowS), fz = now < 0, t = fz ? 777 : now
    const fr = yardFrames(YS, yardCount(cols), t, fz)
    const png = yardScenePng(YS, fr, cols, t, fz, tod)
    expect(`${g.slice(0, g.lastIndexOf(':'))}:${crc32(unbase64(png)).toString(16)}`).toBe(g)
    expect(yardScenePng(YS, fr, cols, t, fz, tod, clawdScene)).toBe(png) // 기본값을 밝혀 줘도 같다
  }
  expect(soilRgb('day')).toBe(soilRgb('day', clawdScene))
})

test('묶음 읽기: 없는 상태는 idle 로, 친구도 YARD 다섯 자리 모두, 꼴이 틀리면 거절', async () => {
  const big = normalizeBig(sampleBig)
  for (const act of Object.keys(CAP)) expect(big.states[act]).toBeDefined()
  expect(big.states.dizzy!.seq).toEqual(big.states.idle!.seq) // 그림이 없는 상태 → idle
  expect(big.states.think!.seq).toEqual([0, 2]) // 있는 상태는 그대로
  const fr = normalizeFriends(sampleFriends)
  for (const m of YARD) expect(fr.states[m.state]).toBeDefined()
  expect(fr.states.kite!.seq).toEqual(fr.states.idle!.seq)
  expect(fr.states.happy!.seq).toEqual([0, 1])
  // seq 가 없는 장면을 가리키면 장면 0
  const odd = normalizeBig({ ...sampleBig, states: { idle: { label: 'idle', ms: 100, seq: [0, 99] } } })
  expect(odd.states.idle!.seq).toEqual([0, 0])
  // idle 이 없으면 장면 0 한 장이 idle
  expect(normalizeBig({ ...sampleBig, states: {} }).states.work!.seq).toEqual([0])
  expect(() => normalizeBig({ ...sampleBig, canvas: [40, 32] })).toThrow()
  expect(() => normalizeBig({ ...sampleBig, frames: [] })).toThrow()
  expect(() => normalizeBig({ ...sampleBig, palette: { a: 'red' } })).toThrow()
  expect(() => normalizeBig(null)).toThrow()
})

test('손님 틀: "<상태>@<손님>" 키는 남기고 보통 상태처럼 고친다. 바탕 상태를 모르거나 손님 id 가 틀리면 버린다', async () => {
  const raw = {
    ...sampleBig,
    states: {
      ...sampleBig.states,
      'edit@mimic': { label: 'edit', ms: 120, seq: [2, 99] },
      'oops@brute': { seq: [1] },
      'think@puff': { label: 'x', ms: 100, seq: [] },
      'nope@mimic': { label: 'nope', ms: 100, seq: [0] },
      'edit@Mimic': { label: 'edit', ms: 100, seq: [0] },
      'edit@a@b': { label: 'edit', ms: 100, seq: [0] },
    },
  }
  const big = normalizeBig(raw)
  expect(big.states['edit@mimic']).toEqual({ label: 'edit', ms: 120, seq: [2, 0] })
  expect(big.states['oops@brute']).toEqual({ label: 'oops@brute', ms: 400, seq: [1] })
  for (const k of ['think@puff', 'nope@mimic', 'edit@Mimic', 'edit@a@b']) expect(big.states[k]).toBeUndefined()
  for (const act of Object.keys(CAP)) expect(big.states[act]).toBeDefined()
  // 손님이 없는 묶음은 열쇠가 예전과 같다
  expect(Object.keys(normalizeBig(sampleBig).states).filter(k => k.includes('@'))).toEqual([])
  // 친구 쪽(놀이터 다섯 자리)도 같은 규칙: 바탕이 다섯 자리에 없으면 버린다
  const fr = normalizeFriends({ ...sampleFriends, states: { ...sampleFriends.states, 'happy@mimic': { label: 'h', ms: 100, seq: [1] }, 'edit@mimic': { label: 'e', ms: 100, seq: [1] } } })
  expect(fr.states['happy@mimic']).toBeDefined()
  expect(fr.states['edit@mimic']).toBeUndefined()
  // buildTheme 도 손님 키를 넘긴다
  expect(buildTheme('t', undefined, raw).sprites.states['edit@mimic']).toBeDefined()
})

test('큰 마스코트 PNG: 묶음에 없으면 도트로 만든다(456×384, 민무늬만), 있으면 그것. sticker 벌은 쓰지 않는다', async () => {
  const big = normalizeBig(sampleBig)
  const plain = decodePng(unbase64(bigPng(big, 0)))
  expect([plain.w, plain.h]).toEqual([456, 384])
  expect(bigPng(big, 0)).toBe(bigPng(big, 0)) // 기억해 둔다
  expect(bigPng(big, 1)).not.toBe(bigPng(big, 0))
  expect(bigPng(big, 0, 3)).not.toBe(bigPng(big, 0)) // dx 가 다르면 다른 그림
  const own = { ...big, png: { plain: ['P0', 'P1'], sticker: ['S0'] } } as Sprites
  expect(bigPng(own, 1)).toBe('P1')
  expect(bigPng(own, 5)).toBe('P0') // 0.8.1 과 같이 없으면 첫 장(sticker 의 'S0' 은 쓰지 않는다)
  // png.sticker 가 없는 묶음도 받는다(plain 만 있으면 된다)
  expect(normalizeBig({ ...sampleBig, png: { plain: ['Q0'] } }).png.plain).toEqual(['Q0'])
})

test('이름 고르기: id·별칭(대소문자 무시), 모르는 이름은 null, 저장값이 이상하면 기본', async () => {
  expect(THEME_DEFAULT).toBe('clawd')
  expect(themeIdOf('예시', THEMES)).toBe('sample')
  expect(themeIdOf('SAMPLE', THEMES)).toBe('sample')
  expect(themeIdOf(' 기본 ', THEMES)).toBe('clawd')
  expect(themeIdOf('없는-테마', THEMES)).toBe(null)
  expect(themeIdOf('', THEMES)).toBe(null)
  expect(themePrefOf('sample', THEMES)).toBe('sample')
  expect(themePrefOf('nope', THEMES)).toBe('clawd')
  expect(themePrefOf(undefined, THEMES)).toBe('clawd')
  expect(themePrefOf('toString', THEMES)).toBe('clawd')
  expect(themeNames(THEMES).slice(0, 2)).toEqual(['Clawd', 'sample']) // 개인판은 뒤에 테마가 더 붙는다
})

test('색이 256 을 넘는 묶음은 거절한다', async () => {
  const many: Record<string, string> = {}
  const keys = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,<>/?|~`' + 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ'
  for (const k of keys) many[k] = '#123456'
  const fat = normalizeFriends({ ...sampleFriends, palette: many })
  expect(themeFits(sampleScene, fat)).toBe(false)
  expect(() => buildTheme('sample', THEMES.sample, sampleBig, { ...sampleFriends, palette: many })).toThrow()
  const ok = buildTheme('sample', THEMES.sample, sampleBig, sampleFriends)
  expect(ok.scene).toBe(sampleScene)
  const solo = buildTheme('x', undefined, sampleBig)
  expect(solo.friends).toBe(solo.sprites) // friends.json 이 없으면 큰 마스코트 그대로
  expect(solo.scene).toBe(clawdScene) // scene.ts 가 없으면 기본 배경
})

test('테마 배경의 계약: 폭 40·46·55 에서 96도트 높이, 빈 점 없음, 팔레트 256 이하, 열쇠가 같으면 그림도 같다', async () => {
  const fr = normalizeFriends(sampleFriends)
  for (const cols of [40, 46, 55]) {
    const n = yardCount(cols), W = yardPlan(cols, n, 38).wd
    for (const tod of ['day', 'dusk', 'night'] as const) {
      expect(scenePaletteSize(sampleScene, fr, tod)).toBeLessThanOrEqual(256)
      const png = yardScenePng(fr, yardFrames(fr, n, 0, false), cols, 0, false, tod, sampleScene)
      const d = decodePng(unbase64(png))
      expect([d.w, d.h]).toEqual([W * 3, SCENE_H * 3])
      expect(d.px.includes(0)).toBe(false) // 바탕이 판 전체를 채운다
      expect(d.palette.length).toBeLessThanOrEqual(256)
      const max = d.px.reduce((m, v) => Math.max(m, v), 0)
      expect(max).toBeLessThan(d.palette.length)
      // 맨 아래는 풀밭 색, 앞줄 친구는 GROUND 에 발이 닿는다(첫 마리의 몸 색)
      expect(d.palette[d.px[(d.h - 1) * d.w + 1]!]).toBe(sampleScene.ground(tod))
      const { xs } = yardPlan(cols, n, 38)
      const foot = d.palette[d.px[GROUND * 3 * d.w + (xs[0]! + 14) * 3]!]
      expect(foot).toBe(Math.round(0xf2 * sampleScene.dim(tod)) << 16 | Math.round(0xa6 * sampleScene.dim(tod)) << 8 | Math.round(0x5a * sampleScene.dim(tod)))
      // 새 타이머 없음: 열쇠(sceneKey)가 같으면 그림이 같다
      const byKey = new Map<string, string>()
      for (let now = 9_000_000; now < 9_000_000 + 6_000; now += 311) {
        const f = yardFrames(fr, n, now, false), k = sceneKey(f, now, false, tod)
        const p = yardScenePng(fr, f, cols, now, false, tod, sampleScene)
        if (!byKey.has(k)) byKey.set(k, p)
        expect(byKey.get(k)).toBe(p)
      }
      // 멈추면 시각이 달라도 같은 그림
      expect(yardScenePng(fr, yardFrames(fr, n, 1, true), cols, 1, true, tod, sampleScene))
        .toBe(yardScenePng(fr, yardFrames(fr, n, 9e9, true), cols, 9e9, true, tod, sampleScene))
    }
  }
  // 낮의 구름·밤의 별은 시간에 따라 움직인다
  const f5 = yardFrames(fr, 5, 0, true)
  expect(yardScenePng(fr, f5, 55, 0, false, 'day', sampleScene)).not.toBe(yardScenePng(fr, f5, 55, 3000, false, 'day', sampleScene))
  expect(yardScenePng(fr, f5, 55, 0, false, 'night', sampleScene)).not.toBe(yardScenePng(fr, f5, 55, 700, false, 'night', sampleScene))
  // 같은 폭·장면이라도 배경·친구가 다르면 다른 그림(기억해 둔 것을 잘못 쓰지 않는다)
  expect(yardScenePng(fr, f5, 55, 0, false, 'day', sampleScene)).not.toBe(yardScenePng(fr, f5, 55, 0, false, 'day', clawdScene))
  expect(yardStripPng(fr, f5, 55)).not.toBe(yardStripPng(YS, f5, 55))
})

// ── 엔진: /skin ──
// 큰 마스코트·친구 모두 장면 하나(움직이지 않음)라, 전환 때 보내는 그림만 셀 수 있다
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4WR7+HwAGewKnNtauMAAAAABJRU5ErkJggg=='
const STILL = {
  canvas: [38, 32], ground: 30, box: [19, 8], pngSize: [456, 384], palette: { a: '#D97757' },
  frames: [blank().map((r, y) => (y > 20 ? row('aaaaaaaa') : r))],
  states: Object.fromEntries(Object.keys(CAP).map(k => [k, { label: k, ms: 200, seq: [0] }])),
  png: { plain: [PNG_A], sticker: [PNG_A] },
}
const NOW = Math.floor(Date.now() / 1000)
const SNAP = { at: NOW, jobs: [], waiting: [], mem: { freePct: 58, load: 4.3, cpus: 10 } }
// cfg: 시험 중에 바꾸는 엔진 흉내(거부·예외·막아 두기·미세 조정·깨진 파일). t 는 시험이 한 틱(100ms)씩 올리는 시각(같은 틱에 두 그림이 나갔는지 본다)
type Cfg = {
  deny?: (key: string) => string | undefined
  hold?: (path: string) => Promise<void> | undefined
  blitHold?: (key: string) => Promise<void> | undefined
  tune?: Record<string, unknown>
  friendsText?: string
  failAll?: boolean
  failPath?: (path: string) => boolean
  storeHold?: (key: string) => Promise<void> | undefined
  /** 고르기 창의 답: 라벨·친 글자, null(빈 answers 로 닫음), 또는 도구 결과 그대로({ deny } · { isError }). 없으면 닫음 */
  ask?: (q: { question: string; header: string; options: string[] }) => AskAns | Promise<AskAns>
}
type AskAns = string | null | { deny: string } | { isError: true; result: undefined; text: string }
type Seen = { blits: { key: string; png?: string; t: number }[]; toasts: string[]; mem: Record<string, unknown>; sets: { key: string; value: any }[]; t: number; cfg: Cfg; asks: { question: string; header: string; options: string[] }[] }
// 장면 하나짜리(움직이지 않는) 예시 테마: 전환 때 보내는 그림 수를 세려고
const STILL_BIG = { ...sampleBig, states: { idle: { label: 'idle', ms: 200, seq: [0] } } }
const STILL_FRIENDS = { ...sampleFriends, states: { idle: { label: 'idle', ms: 600, seq: [0] } } }
const engine = (on: any, store: Record<string, unknown> = {}, o: { brokenSample?: boolean; still?: boolean } = {}): Seen => {
  const seen: Seen = { blits: [], toasts: [], mem: { ...store }, sets: [], t: 0, cfg: {}, asks: [] }
  const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.join(' ')
    if (a.includes('collect.py')) return run(JSON.stringify(SNAP))
    if (a.includes('codex_usage.py')) return run(JSON.stringify({ at: NOW, windows: [] }))
    return run('', 1)
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'ko_KR.UTF-8' : e.name.startsWith('LC_') ? undefined : '/Users/someone' }))
  on('session.cwd', () => ({ value: '/Users/someone/project' }))
  on('session.root', () => ({ value: '/Users/someone/project' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: /themes\/sample\/friends\.json$/.test(e.path) || (!!seen.cfg.tune && /status-panel-tune\.json$/.test(e.path)) }))
  on('fs.read', async (_: unknown, e: { path: string }) => {
    if (seen.cfg.failAll && /sprites\.json$|friends\.json$/.test(e.path)) throw new Error('disk')
    const h = seen.cfg.hold?.(e.path)
    if (h) await h
    if (seen.cfg.failPath?.(e.path)) throw new Error('disk')
    if (/status-panel-tune\.json$/.test(e.path)) return { value: JSON.stringify(seen.cfg.tune ?? {}) }
    if (/themes\/sample\/sprites\.json$/.test(e.path)) return { value: o.brokenSample ? '{"canvas":[1,1]}' : JSON.stringify(o.still ? STILL_BIG : sampleBig) }
    if (/themes\/sample\/friends\.json$/.test(e.path)) return { value: seen.cfg.friendsText ?? JSON.stringify(o.still ? STILL_FRIENDS : sampleFriends) }
    if (/clawd\/sprites\.json$/.test(e.path)) return { value: JSON.stringify(STILL) }
    throw new Error(`no file ${e.path}`)
  })
  on('agent.list', () => ({ value: [] }))
  // $.ui.ask 는 AskUserQuestion 도구 호출로 온다: 답이 있으면 그 라벨, 없으면 닫음(빈 answers)
  on('tool.call', async (_: unknown, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: {} }
    const q0 = e.questions[0], q = { question: q0.question, header: q0.header, options: q0.options.map((o: { label: string }) => o.label) }
    seen.asks.push(q)
    const a = seen.cfg.ask ? await seen.cfg.ask(q) : null
    if (a && typeof a === 'object') return a // 거절·실패(엔진은 이것을 'no answer (사유)' 로 던진다)
    return { result: { questions: e.questions, answers: a === null ? {} : { [q.question]: a } } }
  })
  on('ui.blit', async (_: unknown, e: { key: string; source?: { png?: string }; cells?: string }) => {
    if (e.key === 'spin' || e.cells) return { value: {} }
    seen.blits.push({ key: e.key, png: e.source?.png, t: seen.t })
    const h = seen.cfg.blitHold?.(e.key)
    if (h) await h
    const d = seen.cfg.deny?.(e.key)
    return { value: d ? { deny: d } : {} }
  })
  on('ui.toast', (_: unknown, e: { message?: string; text?: string } | string) => { seen.toasts.push(typeof e === 'string' ? e : JSON.stringify(e)); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('store.get', async (_: unknown, e: { key: string }) => {
    const v = seen.mem[e.key] // 읽은 뒤 막아 둔다: 두 명령이 같은 옛 값을 읽고 겹쳐 쓰는 경합을 만든다
    const h = seen.cfg.storeHold?.(e.key)
    if (h) await h
    return { value: v }
  })
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { seen.mem[e.key] = e.value; seen.sets.push(e as Seen['sets'][number]); return { value: undefined } })
  return seen
}
const PANE = (bodyColumns: number) => ({
  plugin: 'status-panel', component: 'Pane', requestId: 'status-panel',
  props: { title: '작업 진행판', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const)
const VIEW = { columns: 120, rows: 40, isFullscreen: true }
const slash = ($: any, args = '') => $.command.run({ command: 'clawd', args })
const skin = ($: any, args = '') => $.command.run({ command: 'skin', args })
const scene = ($: any, args = '') => $.command.run({ command: 'scene', args })
// 지금 테마: 인자 없는 /skin 의 답(창이 뜨면 닫아서 '테마 그대로', 창을 안 띄우면 '지금 테마 …')에서 이름만
const nowLabel = async ($: any) => (((await skin($)) as { text: string }).text.match(/^(?:지금 테마|테마 그대로): ([^ ·]+)/) ?? [])[1]
const srcOf = async (ui: any, key: string) => ((await ui.find({ type: 'Image', key }))?.props.source as { png?: string } | undefined)?.png

test('/skin: 바꾸면 큰 마스코트·놀이터 띠를 한 번씩만 blit 하고(다시 그리기로 source 를 바꾸지 않음), 저장된다', async ($, on) => {
  // 낮 시각(배경 끔: 띠는 장면이 바뀔 때만 나간다)
  const clock = mock.clock(on, { now: new Date(2026, 10, 17, 10, 0, 5).getTime() })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A)
  const yard0 = await srcOf(ui, 'yard')
  expect(yard0).toBeDefined()
  await clock.advance(2000) // 그린 뒤의 확인 blit 이 끝나기를
  const before = seen.blits.length
  expect(await skin($, '예시')).toMatchObject({ text: '테마: sample' })
  await clock.advance(1500) // (5초마다 오는 진행 상태가 다시 그리기를 부르기 전까지: 다시 그린 뒤에는 늘 확인 blit 이 하나 나간다)
  const after = seen.blits.slice(before).filter(b => b.key !== 'clock')
  // 큰 마스코트 한 장 + 놀이터 띠 한 장, 그 뒤로는 움직이지 않는 그림이라 더 보내지 않는다
  expect(after.map(b => b.key).sort()).toEqual(['clawd', 'yard'])
  const big = normalizeBig(sampleBig), fr = normalizeFriends(sampleFriends)
  expect(after.find(b => b.key === 'clawd')!.png).toBe(bp(big, big.states.idle!.seq[0]!))
  expect(after.find(b => b.key === 'yard')!.png).toBe(yardStripPng(fr, yardFrames(fr, yardCount(46), 0, true), 46))
  // 같은 테마를 또 고르면 아무것도 보내지 않는다
  const n2 = seen.blits.length
  expect(await skin($, 'SAMPLE')).toMatchObject({ text: '테마: sample' })
  await clock.advance(1000)
  expect(seen.blits.slice(n2).filter(b => b.key !== 'clock')).toHaveLength(0)
  // 다시 그려져도 넘기는 그림(source)은 처음 그대로(새 그림은 blit 으로 나갔다)
  await scene($, '작게')
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A)
  // 저장: 다른 선택도 그대로, 테마는 sample
  expect(seen.mem.clawd).toMatchObject({ on: true, bg: false, yard: true, theme: 'sample' })
  // 영어 별칭으로 기본으로 돌아간다: 그림이 바뀌는 blit 은 큰 마스코트 하나·띠 하나(다시 그린 뒤의 확인 blit 은 같은 그림)
  const n3 = seen.blits.length, lastYard = seen.blits.filter(b => b.key === 'yard').at(-1)!.png
  expect(await skin($, 'clawd')).toMatchObject({ text: '테마: Clawd' })
  await clock.advance(2000)
  const back = seen.blits.slice(n3).filter(b => b.key !== 'clock')
  expect(new Set(back.filter(b => b.key === 'clawd').map(b => b.png))).toEqual(new Set([PNG_A]))
  expect(new Set(back.filter(b => b.key === 'yard').map(b => b.png)).size).toBe(1)
  expect(back.find(b => b.key === 'yard')!.png).not.toBe(lastYard)
  expect(seen.mem.clawd).toMatchObject({ theme: 'clawd' })
  // /clawd 명령도 테마를 지우지 않는다
  await skin($, '예시'); await slash($, '끄기')
  expect(seen.mem.clawd).toMatchObject({ on: false, theme: 'sample' })
  await ui.unmount()
})

test('저장해 둔 테마를 새 세션이 그대로 읽는다(큰 마스코트·띠 모두 그 테마)', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 17, 10, 0, 5).getTime() })
  engine(on, { clawd: { on: true, look: 'plain', bg: true, yard: true, theme: 'sample' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(55), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  const big = normalizeBig(sampleBig)
  expect(await srcOf(ui, 'clawd')).toBe(bp(big, 0))
  const yd = decodePng(unbase64((await srcOf(ui, 'yard'))!))
  expect(yd.palette.slice(1, 6)).toEqual(sampleScene.colors('day')) // 배경도 테마 것
  await ui.unmount()
})

test('없는 테마 이름은 알림을 띄우고 아무것도 바꾸지 않는다. 못 읽는 묶음·모르는 저장값은 기본으로', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 17, 10, 0, 5).getTime() })
  const seen = engine(on, { clawd: { on: true, look: 'plain', theme: 'gone' } }, { brokenSample: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  const ui = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A) // 모르는 저장값 → 기본
  const r = await skin($, '없는이름') as { text: string }
  const list = shownThemeNames(THEMES).join(' · ')
  expect(list).not.toContain('sample') // 숨긴 테마는 목록에 없다
  expect(r.text).toBe(`없는 테마예요: 없는이름 · 고를 수 있는 것: ${list}`)
  expect(seen.toasts.length).toBe(1)
  expect(seen.toasts[0]).toContain('없는이름')
  expect(seen.sets).toHaveLength(0)
  // 묶음이 깨졌으면 알리고 그대로 둔다
  const b = await skin($, '예시') as { text: string }
  expect(b.text).toBe('테마 그림을 읽지 못했어요: sample')
  expect(seen.sets).toHaveLength(0)
  // 이름 없이: 지금 테마(창이 뜨면 닫아서 그대로, 안 뜨면 목록과 함께)
  expect(await nowLabel($)).toBe('Clawd')
  expect(seen.sets).toHaveLength(0)
  // /clawd 에는 이제 테마가 없다: 사용법에도 안 나온다
  const u = ((await slash($, '뭐지')) as { text: string }).text
  expect(u).toContain('/clawd')
  expect(u).not.toContain('테마')
  await ui.unmount()
})

// ── 검수(2026-11-17 Carbon) 지적의 재현·회귀 시험 ──
// 한 틱(100ms)씩 시계를 밀며 seen.t 를 올린다: blit 마다 어느 틱에 나갔는지 남는다
const step = async (clock: { advance: (ms: number) => Promise<unknown> }, seen: Seen, ms: number) => {
  for (let i = 0; i < ms; i += 100) { seen.t += 100; await clock.advance(100) }
}
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }
const stillBig = () => normalizeBig(STILL_BIG)
const stillFr = () => normalizeFriends(STILL_FRIENDS)
const T0 = new Date(2026, 10, 17, 10, 0, 5).getTime()
const opened = async ($: any, clock: any, seen: Seen, cols = 46) => {
  await step(clock, seen, 200)
  const ui = await $.ui.mount({ ...PANE(cols), surface: 'terminal', viewport: VIEW })
  await ui.drawn()
  await step(clock, seen, 1000) // 그린 뒤의 확인 blit 까지
  return ui
}

test('#1 새 세션(같은 모듈): 지난 세션의 그림 기억을 지워 첫 그리기부터 지금 테마', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  await skin($, '예시')
  await step(clock, seen, 1000)
  await ui.unmount()
  // 같은 모듈에서 세션이 다시 열리고 같은 크기로 붙는다
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 200)
  const ui2 = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await ui2.drawn()
  expect(await srcOf(ui2, 'clawd')).toBe(bp(stillBig(), 0))
  const fr = stillFr()
  expect(await srcOf(ui2, 'yard')).toBe(yardStripPng(fr, yardFrames(fr, yardCount(46), 0, true), 46))
  await ui2.unmount()
})

test('#2 큰 마스코트 팔레트는 254색까지(투명·흰 테두리 두 칸)', async () => {
  const pal = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String.fromCharCode(0x100 + i), '#123456']))
  expect(() => buildTheme('x', undefined, { ...sampleBig, palette: { ...sampleBig.palette, ...pal(251) } }, sampleFriends)).not.toThrow() // 254
  expect(() => buildTheme('x', undefined, { ...sampleBig, palette: { ...sampleBig.palette, ...pal(252) } }, sampleFriends)).toThrow() // 255
  expect(() => normalizeBig({ ...sampleBig, palette: pal(300) })).toThrow()
})

test('#3 놀이터 blit 이 한 번 거부돼도 다시 그리기가 source 를 바꾸지 않고, blit 으로 다시 보낸다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  const yard0 = await srcOf(ui, 'yard')
  let denies = 1
  seen.cfg.deny = k => (k === 'yard' && denies > 0 ? (denies--, 'no-surface') : undefined)
  await skin($, '예시')
  await step(clock, seen, 600)
  expect(denies).toBe(0) // 한 번 거부됐다
  await scene($, '작게') // 다시 그리기(같은 값이라도)
  await ui.drawn()
  await step(clock, seen, 6000) // 5초 진행 상태의 다시 그리기도 지나간다
  expect(await srcOf(ui, 'yard')).toBe(yard0)
  const fr = stillFr(), want = yardStripPng(fr, yardFrames(fr, yardCount(46), 0, true), 46)
  expect(seen.blits.filter(b => b.key === 'yard' && b.png === want).length).toBeGreaterThanOrEqual(2) // 거부된 것 + 다시 보낸 것
  await ui.unmount()
})

test('#3 놀이터 blit 을 기다리는 사이 다시 그려지고 그 blit 이 실패하면, 다음 차례에 다시 보낸다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  const g = gate()
  let first = true
  seen.cfg.blitHold = k => (k === 'yard' && first ? g.p : undefined)
  seen.cfg.deny = k => (k === 'yard' && first ? (first = false, 'failed') : undefined)
  await skin($, '예시')
  await step(clock, seen, 600) // 놀이터 blit 이 떠나 답을 기다린다
  const sent = seen.blits.filter(b => b.key === 'yard').length
  await scene($, '작게') // 그사이 다시 그려진다
  g.open()
  await step(clock, seen, 2000)
  expect(seen.blits.filter(b => b.key === 'yard').length).toBeGreaterThan(sent)
  await ui.unmount()
})

test('#4 tune.rend shown: 테마를 바꾼 직후 다시 그려도 큰 마스코트 source 는 화면의 것 그대로, 새 그림은 blit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  seen.cfg.tune = { rend: 'shown' }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  await step(clock, seen, 5000) // 미세 조정을 읽는다(5초 틱)
  await ui.drawn()
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A)
  const n = seen.blits.length
  await skin($, '예시')
  await scene($, '작게') // blit 이 나가기 전에 다시 그려진다
  await ui.drawn()
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A)
  await step(clock, seen, 1500)
  expect(seen.blits.slice(n).some(b => b.key === 'clawd' && b.png === bp(stillBig(), 0))).toBe(true)
  seen.cfg.tune = { rend: 'frozen' }
  await step(clock, seen, 5000)
  await ui.unmount()
})

test('#4 tune.yard false: 움직이지 않아도 테마를 바꾸면 놀이터 띠는 한 장 보낸다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  seen.cfg.tune = { yard: false }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  await step(clock, seen, 5000)
  const n = seen.blits.length
  await skin($, '예시')
  await step(clock, seen, 1500)
  const fr = stillFr()
  expect(seen.blits.slice(n).filter(b => b.key === 'yard').map(b => b.png)).toEqual([yardStripPng(fr, yardFrames(fr, yardCount(46), 0, true), 46)])
  seen.cfg.tune = { yard: true }
  await step(clock, seen, 5000)
  await ui.unmount()
})

test('#5 friends.json 이 깨져 있으면 큰 마스코트로 대신하지 않고 알린다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  seen.cfg.friendsText = '{"canvas":[38,32],'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 200)
  expect(await skin($, '예시')).toMatchObject({ text: '테마 그림을 읽지 못했어요: sample' })
  expect(seen.sets).toHaveLength(0)
})

test('#7 시작 때 테마를 읽는 사이 친 /clawd 명령이 덮이지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', theme: 'sample' } }, { still: true })
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = skin($, '기본')
  await step(clock, seen, 100)
  seen.cfg.hold = undefined
  g.open()
  await r
  await step(clock, seen, 300)
  expect(await nowLabel($)).toBe('Clawd')
  expect(seen.mem.clawd).toMatchObject({ theme: 'clawd' })
})

test('#7 테마 파일을 읽는 사이 바뀐 다른 설정을 옛 값으로 덮지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: true, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  const r = skin($, '예시')
  await step(clock, seen, 100)
  await scene($, '끄기')
  g.open()
  await r
  expect(seen.mem.clawd).toMatchObject({ yard: false, theme: 'sample' })
})

test('#8 오래 쉬어 멈춘 동안에도 테마를 바꾸면 두 그림이 1초 안에 바뀐다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  for (let i = 0; i < 31; i++) await clock.advance(60_000) // 30분 넘게 쉼(한 번에 밀면 시계 흉내가 기다림을 다 못 푼다)
  await step(clock, seen, 1000)
  const n = seen.blits.length
  await skin($, '예시')
  await step(clock, seen, 800)
  const keys = seen.blits.slice(n).map(b => b.key)
  expect(keys).toContain('clawd')
  expect(keys).toContain('yard')
  await ui.unmount()
})

test('#9 저장된 테마도 기본도 못 읽으면 테마 이름도 기본으로', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', theme: 'sample' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  expect(await nowLabel($)).toBe('sample')
  seen.cfg.failAll = true
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  expect(await nowLabel($)).toBe('Clawd')
})

test('#11 프레임이 줄 배열이 아니면 거절한다', async () => {
  expect(() => normalizeBig({ ...sampleBig, frames: [123] })).toThrow()
  expect(() => normalizeBig({ ...sampleBig, frames: [[1, 2]] })).toThrow()
})

test('#6 놀이터 아래 흙 줄: 띠가 바뀌기 전엔 옛 테마 색, blit 된 뒤엔 새 테마 색', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: true, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 200)
  type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const at = (rows: number) => { const p = PANE(46); return { ...p, props: { ...p.props, scroll: { offset: 0, bodyRows: rows } }, surface: 'terminal' as const, viewport: VIEW } }
  const fillOf = async (ui: any) => {
    const root = (await ui.drawn()) as El
    const ground = ((root.children ?? []) as (El | undefined)[])[1]
    return ((ground?.children ?? []) as El[]).filter(c => c?.type === 'Text' && c.props?.backgroundColor).map(c => String(c.props!.backgroundColor))
  }
  for (const r of [44, 41]) { const u = await $.ui.mount(at(r)); await u.drawn(); await step(clock, seen, 300); await u.unmount() }
  const ui = await $.ui.mount(at(44))
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
  expect(new Set(await fillOf(ui))).toEqual(new Set([hex(soilRgb('day', clawdScene))]))
  await step(clock, seen, 1000)
  await skin($, '예시')
  await scene($, '크게') // 띠가 blit 되기 전의 다시 그리기: 흙은 화면의 띠(옛 테마)에 맞춘다
  expect(new Set(await fillOf(ui))).toEqual(new Set([hex(soilRgb('day', clawdScene))]))
  await step(clock, seen, 1500) // 띠가 blit 되면 흙 줄만 다시 칠한다
  expect(new Set(await fillOf(ui))).toEqual(new Set([hex(soilRgb('day', sampleScene))]))
  await ui.unmount()
})

// ── 시험이 헛돌던 곳(검수 2026-11-17) ──
const switchCount = async ($: any, on: any, bg: boolean) => {
  {
    const clock = mock.clock(on, { now: T0 })
    const seen = engine(on, { clawd: { on: true, look: 'plain', bg, yard: true } }, { still: true })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await opened($, clock, seen, 55)
    const big0 = await srcOf(ui, 'clawd'), yard0 = await srcOf(ui, 'yard')
    const pics = (from: number) => seen.blits.slice(from).filter(b => b.key !== 'clock')
    // 배경 있는 띠는 구름이 1.5초마다 흐르므로, 그 띠를 빼고 보면 테마 전환이 보낸 것만 남는다
    const fr = stillFr(), sb = stillBig()
    for (const [arg, wantBig, sc, f] of [['예시', bp(sb, 0), sampleScene, fr], ['clawd', PNG_A, clawdScene, null]] as const) {
      const n = seen.blits.length
      await skin($, arg)
      await step(clock, seen, 1200)
      const got = pics(n)
      expect(got.filter(b => b.key === 'clawd').map(b => b.png)).toEqual([wantBig]) // 중복 없이 한 장
      const yards = got.filter(b => b.key === 'yard')
      expect(yards.length).toBeGreaterThanOrEqual(1)
      if (bg) {
        // 배경 켬: 첫 띠부터 새 테마의 하늘(맨 위 왼쪽 점의 색)
        const d = decodePng(unbase64(yards[0]!.png!))
        expect(d.palette[d.px[0]!]).toBe(sc.colors('day')[0])
      } else {
        expect(yards.length).toBe(1) // 움직이지 않는 띠: 딱 한 장
        if (f) expect(yards[0]!.png).toBe(yardStripPng(f, yardFrames(f, yardCount(55), 0, true), 55))
      }
      // 그림 둘(과 시계)은 같은 틱에 나가지 않고 gap(2틱) 이상 떨어진다
      const ts = seen.blits.slice(n).map(b => b.t).sort((a, b) => a - b)
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(200)
      // 다시 그려도 넘기는 그림(source)은 둘 다 처음 그대로
      await scene($, bg ? '크게' : '작게')
      await ui.drawn()
      expect(await srcOf(ui, 'clawd')).toBe(big0)
      expect(await srcOf(ui, 'yard')).toBe(yard0)
      await step(clock, seen, 600)
    }
    await ui.unmount()
  }
}
for (const bg of [false, true])
  test(`전환 때 보내는 그림 수를 정확히 센다(배경 ${bg ? '켬' : '끔'}): 큰 마스코트 한 장·띠 한 장, 같은 틱에 둘이 나가지 않고, 다시 그려도 두 source 그대로`, { timeoutMs: 30000 }, async ($, on) => switchCount($, on, bg))

// 열쇠(sceneKey)가 같으면 그림이 같은지: 한 칸 기억(sceneMemo)에 가리지 않게 매번 다른 폭을 한 번 그려 기억을 비운다.
// 친구는 움직이지 않는 것(STILL_FRIENDS)이라 열쇠는 시간 칸으로만 바뀐다
const keyBreaks = (scene: typeof clawdScene, cols: number, tod: 'day' | 'dusk' | 'night') => {
  const fr = stillFr(), n = yardCount(cols), byKey = new Map<string, string>()
  for (let now = 9_000_000; now < 9_000_000 + 4_500; now += 233) {
    const f = yardFrames(fr, n, now, false), k = sceneKey(f, now, false, tod)
    yardScenePng(fr, f, cols + 1, now, false, tod, scene) // 기억 비우기
    const p = yardScenePng(fr, f, cols, now, false, tod, scene)
    if (!byKey.has(k)) byKey.set(k, p)
    else if (byKey.get(k) !== p) return true
  }
  return false
}
// 장면이 쓴 색 번호를 엔진의 걸러내기(팔레트 밖 번호 → 1) 전에 본다: 엔진과 같은 판·put·glyph 로 base → back → front 를 직접 돌린다.
// 친구는 세우지 않으므로 판의 모든 점이 배경 색 번호(1 ~ colors().length)여야 한다
const sceneDots = (sc: typeof clawdScene, W: number, tod: 'day' | 'dusk' | 'night', now: number, frozen: boolean) => {
  const g = new Uint8Array(W * SCENE_H)
  sc.base(g, W, tod)
  const step = frozen ? 0 : now
  const put = (x: number, y: number, c: number, skyOnly = false) => {
    if (x < 0 || y < 0 || x >= W || y >= SCENE_H || (skyOnly && g[y * W + x]! > sc.sky)) return
    g[y * W + x] = c
  }
  const glyph = (rows: readonly string[], x: number, y: number, color: (ch: string) => number) => {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') put(x + i, y + j, color(row[i]!)) })
  }
  const ctx = { W, tod, now, frozen, step, drift: Math.floor(step / 1500), r: W / 207, life: yardLife(W, now, frozen, tod), put, glyph }
  sc.back?.(g, ctx)
  sc.front?.(g, ctx)
  return g
}
const dotsOk = (sc: typeof clawdScene, W: number, tod: 'day' | 'dusk' | 'night') => {
  const max = sc.colors(tod).length
  // 낮의 새떼·밤의 별똥별이 지나가는 때까지 닿게 시각을 넓게 훑는다
  for (const now of [0, 3000, 700 * 64 * 3 + 700 * 20, 1500 * 150 * 2 + 1500 * 60, 9_000_000, 123_456_789]) for (const fz of [false, true]) {
    const g = sceneDots(sc, W, tod, now, fz)
    for (const v of g) if (v < 1 || v > max) return false
  }
  return true
}
// 놀이터 팔레트 예산(256): tests/theme_files_test.py 가 친구 쪽을 1 + 2n ≤ 200 으로 보므로, 배경은 56색까지
const SCENE_MAX_COLORS = 256 - 200
test('등록된 테마 배경 모두: 계약(폭 9·40·46·55, 빈 점 없음, 색 번호 범위, 배경 56색 이하, 열쇠가 같으면 그림도 같다)', { timeoutMs: 30000 }, async () => {
  const fr = normalizeFriends(sampleFriends)
  const scenes = Object.entries(THEMES).map(([id, t]) => [id, t.scene ?? clawdScene] as const)
  expect(scenes.length).toBe(Object.keys(THEMES).length)
  for (const [id, sc] of scenes) for (const cols of [9, 40, 46, 55]) for (const tod of ['day', 'dusk', 'night'] as const) {
    const n = yardCount(cols)
    const W = yardPlan(cols, n, 38).wd, g = new Uint8Array(W * SCENE_H)
    sc.base(g, W, tod)
    expect([id, cols, tod, g.includes(0)]).toEqual([id, cols, tod, false])
    expect([id, cols, tod, dotsOk(sc, W, tod)]).toEqual([id, cols, tod, true]) // base·back·front 모두
    expect([id, tod, sc.colors(tod).length]).toEqual([id, tod, Math.min(sc.colors(tod).length, SCENE_MAX_COLORS)])
    expect(1 + sc.colors(tod).length + 2 * Object.keys(fr.palette).length).toBeLessThanOrEqual(256)
    const d = decodePng(unbase64(yardScenePng(fr, yardFrames(fr, n, 0, false), cols, 0, false, tod, sc)))
    expect(d.px.includes(0)).toBe(false)
    expect(d.px.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(d.palette.length)
    expect([id, cols, tod, keyBreaks(sc, cols, tod)]).toEqual([id, cols, tod, false])
  }
  // 이 검사가 헛돌지 않는지: 매 밀리초 움직이는 배경은 잡힌다
  const bad = { ...sampleScene, back: (gg: Uint8Array, c: { W: number; now: number; put: (x: number, y: number, c: number) => void }) => c.put(c.now % c.W, 3, 5) }
  expect(keyBreaks(bad as typeof clawdScene, 46, 'day')).toBe(true)
  // 색 번호 검사가 헛돌지 않는지: back·front 가 배경 밖 번호(친구 색 자리·250)를 찍으면 잡힌다
  expect(dotsOk({ ...sampleScene, front: (_g: Uint8Array, c: { put: (x: number, y: number, c: number) => void }) => c.put(3, 90, 6) } as typeof clawdScene, 200, 'day')).toBe(false)
  expect(dotsOk({ ...sampleScene, back: (gg: Uint8Array) => { gg[5] = 250 } } as typeof clawdScene, 200, 'night')).toBe(false)
  expect(dotsOk(sampleScene, 200, 'day')).toBe(true)
  // 팔레트 밖 번호를 찍는 배경도 깨진 PNG 를 만들지 않는다
  const wild = { ...sampleScene, front: (gg: Uint8Array) => { gg[0] = 250 } }
  const wd = decodePng(unbase64(yardScenePng(fr, yardFrames(fr, 5, 0, false), 55, 0, false, 'day', wild as typeof clawdScene)))
  expect(wd.px.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(wd.palette.length)
})

// ── 재검수(2026-11-17 Carbon, b4b5ae9) 지적의 재현·회귀 시험 ──
const HIDDEN = ' (Clawd 와 풍경이 꺼져 있어 지금은 안 보여요)'

test('재검수 1: 예시를 읽는 사이 기본으로 되돌리면 기본이 남는다(뒤 명령이 이긴다)', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  const a = skin($, '예시')
  await step(clock, seen, 100)
  expect(await skin($, '기본')).toMatchObject({ text: '테마: Clawd' })
  g.open()
  await a
  await step(clock, seen, 300)
  expect(await nowLabel($)).toBe('Clawd')
  expect(seen.mem.clawd).not.toMatchObject({ theme: 'sample' })
})

test('재검수 1: 시작 때 그림을 못 읽었으면 /skin 기본 이 다시 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  seen.cfg.failAll = true
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  seen.cfg.failAll = false
  await skin($, '기본')
  const ui = await opened($, clock, seen)
  expect(await srcOf(ui, 'clawd')).toBe(PNG_A)
  await ui.unmount()
})

test('재검수 1: 뒤에 고른 테마를 못 읽으면 앞에 고른 테마가 적용된다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  seen.cfg.failAll = true // 시작 때 그림 없음(themeId = clawd, sprites 없음)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  seen.cfg.failAll = false
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  seen.cfg.failPath = p => /clawd\/sprites\.json$/.test(p) && !/themes/.test(p)
  const a = skin($, '예시')
  await step(clock, seen, 100)
  expect(await skin($, '기본')).toMatchObject({ text: '테마 그림을 읽지 못했어요: Clawd' })
  g.open()
  expect(await a).toMatchObject({ text: '테마: sample' })
  expect(await nowLabel($)).toBe('sample')
  expect(seen.mem.clawd).toMatchObject({ theme: 'sample' })
})

test('재검수 2: 놀이터가 여러 번 거부된 뒤 다시 그려지면 기다림 없이 바로 보낸다', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  let denied = 0
  seen.cfg.deny = k => (k === 'yard' ? (denied++, 'no-surface') : undefined)
  await skin($, '예시')
  for (let i = 0; i < 60 && denied < 2; i++) await step(clock, seen, 100) // 두 번 거부된 직후(다음 대기 1~2초)
  expect(denied).toBe(2)
  seen.cfg.deny = undefined
  await ui.unmount()
  const ui2 = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await ui2.drawn()
  await step(clock, seen, 300)
  const n = seen.blits.length
  await skin($, '기본')
  await step(clock, seen, 500)
  expect(seen.blits.slice(n).some(b => b.key === 'yard')).toBe(true)
  await ui2.unmount()
})

test('재검수 2: 새 세션은 놀이터 거부 기다림도 지운다', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  let denied = 0
  seen.cfg.deny = k => (k === 'yard' ? (denied++, 'no-surface') : undefined)
  await skin($, '예시')
  for (let i = 0; i < 60 && denied < 2; i++) await step(clock, seen, 100)
  seen.cfg.deny = undefined
  await ui.unmount()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 100)
  const ui2 = await $.ui.mount({ ...PANE(46), surface: 'terminal', viewport: VIEW })
  await ui2.drawn()
  const n = seen.blits.length
  await skin($, '기본')
  await step(clock, seen, 500)
  expect(seen.blits.slice(n).some(b => b.key === 'yard')).toBe(true)
  await ui2.unmount()
})

test('재검수 3: 놀이터 blit 을 기다리는 사이 새로 그려졌으면, 늦게 끝난 옛 blit 이 흙 색을 덮지 않는다', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: true, yard: true } }, { still: true })
  seen.cfg.tune = { yardMs: 3000 } // 구름이 흘러 다음 띠가 곧바로 흙 색을 바로잡지 않게
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 5200) // 미세 조정을 읽는다
  type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const at = (cols: number, rows: number) => { const p = PANE(cols); return { ...p, props: { ...p.props, scroll: { offset: 0, bodyRows: rows } }, surface: 'terminal' as const, viewport: VIEW } }
  const fillOf = async (ui: any) => {
    const root = (await ui.drawn()) as El
    const ground = ((root.children ?? []) as (El | undefined)[])[1]
    return ((ground?.children ?? []) as El[]).filter(c => c?.type === 'Text' && c.props?.backgroundColor).map(c => String(c.props!.backgroundColor))
  }
  for (const r of [44, 41]) { const u = await $.ui.mount(at(46, r)); await u.drawn(); await step(clock, seen, 300); await u.unmount() }
  const ui = await $.ui.mount(at(46, 44))
  await ui.drawn()
  await step(clock, seen, 1000)
  const g = gate()
  let held = false
  seen.cfg.blitHold = k => (k === 'yard' && !held ? (held = true, g.p) : undefined)
  await skin($, '예시')
  for (let i = 0; i < 40 && !held; i++) await step(clock, seen, 100) // 예시 띠가 떠나 답을 기다린다
  expect(held).toBe(true)
  await skin($, '기본')
  await ui.unmount()
  const ui2 = await $.ui.mount(at(47, 44)) // 폭이 바뀌어 지금(기본) 테마로 새로 그린다
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
  const before = await fillOf(ui2)
  expect(before.length).toBeGreaterThan(0)
  g.open()
  await step(clock, seen, 300)
  expect(new Set(await fillOf(ui2))).toEqual(new Set([hex(soilRgb('day', clawdScene))]))
  seen.cfg.tune = { yardMs: 400 }
  await step(clock, seen, 5000)
  await ui2.unmount()
})

test('재검수 3: 앞 세션에서 늦게 끝난 그림 읽기가 새 세션의 테마를 덮지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', theme: 'sample' } }, { still: true })
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 100)
  seen.cfg.hold = undefined
  seen.mem.clawd = { on: true, look: 'plain', theme: 'clawd' }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  g.open()
  await step(clock, seen, 300)
  expect(await nowLabel($)).toBe('Clawd')
})

test('재검수 4: 두 /clawd 명령의 저장이 겹쳐도 둘 다 남는다', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: true, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  const g = gate()
  let first = true
  seen.cfg.storeHold = k => (k === 'clawd' && first ? (first = false, g.p) : undefined)
  const a = slash($, '끄기')
  await step(clock, seen, 100)
  const b = scene($, '작게')
  await step(clock, seen, 100)
  g.open()
  await a; await b
  expect(seen.mem.clawd).toMatchObject({ on: false, yard: true, bg: false })
})

test('재검수 4: 테마를 읽는 사이 Clawd 를 끄면(풍경도 꺼져 있을 때) 테마 답에도 꺼짐 안내', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, yard: false } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  const g = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? g.p : undefined)
  const a = skin($, '예시')
  await step(clock, seen, 100)
  await slash($, '끄기')
  g.open()
  expect(await a).toMatchObject({ text: `테마: sample${HIDDEN}` })
  // 풍경이 켜져 있으면 테마는 풍경에 보이므로 안내가 없다
  await scene($, '크게')
  expect(await skin($, 'clawd')).toMatchObject({ text: '테마: Clawd' })
})

// ── /skin 고르기 창(2026-11-18): 선택지는 숨기지 않은 테마 2~4개, 그 밖이면 글자로 답한다 ──
const fakeReg = (n: number): Record<string, ThemeEntry> => ({
  ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, { names: [`T${i}`, `alias${i}`] }])),
  secret: { names: ['secret'], hidden: true },
})
test('/skin 선택지: 숨긴 테마는 빼고 2~4개일 때만, 답은 라벨·별칭(대소문자 무시)·숨긴 이름으로 고른다', () => {
  expect(ASK_MIN).toBe(2); expect(ASK_MAX).toBe(4)
  expect(skinChoices(fakeReg(1))).toBeNull()
  expect(skinChoices(fakeReg(2))).toEqual(['T0', 'T1'])
  expect(skinChoices(fakeReg(4))).toEqual(['T0', 'T1', 'T2', 'T3'])
  expect(skinChoices(fakeReg(5))).toBeNull()
  expect(shownThemeNames(fakeReg(5))).toEqual(['T0', 'T1', 'T2', 'T3', 'T4'])
  expect(themeNames(fakeReg(2))).toEqual(['T0', 'T1', 'secret']) // 모든 이름은 그대로(숨긴 것 포함)
  const r = fakeReg(3)
  expect(skinAnswerId('T1', r)).toBe('t1')
  expect(skinAnswerId('ALIAS2', r)).toBe('t2')
  expect(skinAnswerId(' t0 ', r)).toBe('t0')
  expect(skinAnswerId('Secret', r)).toBe('secret')
  expect(skinAnswerId('없는이름', r)).toBeNull()
  // 이 빌드의 목록: 예시(sample)는 숨기고, 보이는 것은 THEMES 에서 숨기지 않은 것 그대로
  expect(THEMES.sample?.hidden).toBe(true)
  const shown = Object.keys(THEMES).filter(id => !THEMES[id]!.hidden).map(id => themeLabelOf(id, THEMES, 'ko'))
  expect(shownThemeNames(THEMES)).toEqual(shown)
  expect(shown).toContain('Clawd')
  expect(skinChoices(THEMES)).toEqual(shown.length >= 2 && shown.length <= 4 ? shown : null)
  // 언어별 보이는 이름: label 이 있으면 그 언어 것, 없으면 names[0]. 두 언어 이름 모두 고를 수 있다
  const lr: Record<string, ThemeEntry> = { a: { names: ['에이', 'a'], label: { ko: '에이', en: 'Ay' } }, b: { names: ['bee'] } }
  expect(shownThemeNames(lr, 'en')).toEqual(['Ay', 'bee'])
  expect(shownThemeNames(lr, 'ko')).toEqual(['에이', 'bee'])
  expect(skinChoices(lr, 'en')).toEqual(['Ay', 'bee'])
  expect(skinAnswerId('Ay', lr, 'en')).toBe('a')
  expect(themeIdOf('ay', lr)).toBe('a')
  expect(themeIdOf('에이', lr)).toBe('a')
  expect(themeLabelOf('a', lr, 'en')).toBe('Ay')
  expect(themeLabelOf('b', lr, 'en')).toBe('bee')
  // 이 빌드의 테마는 모두 영어 화면에서 한글 없는 이름을 가진다
  for (const n of shownThemeNames(THEMES, 'en')) expect(/[가-힣]/.test(n)).toBe(false)
})

// 엔진 시험의 선택지는 이 빌드의 THEMES 에서 계산한다(시험의 THEMES 를 바꿔도 플러그인 쪽 모듈에는 닿지 않는다).
// 개인판(보이는 테마 2~4개)은 창을 띄우고, 공개판(clawd 하나)은 글자로 답한다. 5개 이상은 위 순수 함수 시험이 본다
const CHOICES = skinChoices(THEMES)
const LIST = shownThemeNames(THEMES).join(' · ')
const ASKING = /^대답 기다리는 중…$/

test('/skin 고르기 창: 고르면 적용·저장하고 두 그림을 blit 으로 바꾼다(창이 없는 빌드는 글자로)', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  // 숨긴 예시(sample)에서 시작해 창에서 clawd 를 고른다: 예시는 창에 없고, 질문에 지금 테마로 보인다
  const seen = engine(on, { clawd: { on: true, bg: false, yard: true, theme: 'sample' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  seen.cfg.ask = () => 'clawd'
  const n = seen.blits.length
  if (!CHOICES) {
    expect(await skin($)).toMatchObject({ text: `지금 테마: sample · 고를 수 있는 것: ${LIST}` })
    expect(seen.asks).toHaveLength(0)
    expect(seen.sets).toHaveLength(0)
    await ui.unmount()
    return
  }
  expect(CHOICES).not.toContain('sample')
  expect(await skin($)).toMatchObject({ text: '테마: Clawd' })
  expect(seen.asks).toEqual([{ question: '지금 sample. 어떤 테마로 바꿀까요?', header: '테마', options: CHOICES }])
  expect(seen.mem.clawd).toMatchObject({ on: true, bg: false, yard: true, theme: 'clawd' })
  await step(clock, seen, 1200)
  const got = seen.blits.slice(n).filter(b => b.key !== 'clock')
  expect(got.filter(b => b.key === 'clawd').map(b => b.png)).toEqual([PNG_A]) // 큰 그림은 blit 한 장
  expect(got.some(b => b.key === 'yard')).toBe(true)
  expect(await srcOf(ui, 'clawd')).toBe(bp(stillBig(), 0)) // 다시 그리기로 source 를 바꾸지 않는다(처음 넘긴 예시 그림 그대로)
  seen.cfg.ask = () => null
  await skin($)
  expect(seen.asks.at(-1)!.question).toBe('지금 Clawd. 어떤 테마로 바꿀까요?')
  await ui.unmount()
})

test('/skin 고르기 창: Other 로 친 글자는 이름으로, 모르는 이름은 알림, 닫으면 그대로, 창을 못 띄우면 글자로', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  const nowText = `지금 테마: Clawd · 고를 수 있는 것: ${LIST}`
  if (!CHOICES) {
    seen.cfg.ask = () => 'sample'
    expect(await skin($)).toMatchObject({ text: nowText })
    expect(seen.asks).toHaveLength(0)
    expect(seen.sets).toHaveLength(0)
    return
  }
  // 닫음: 아무것도 안 바꾸고 짧게
  seen.cfg.ask = () => null
  expect(await skin($)).toMatchObject({ text: '테마 그대로: Clawd' })
  expect(seen.sets).toHaveLength(0)
  expect(seen.toasts).toHaveLength(0)
  // 모르는 이름: 없는 테마 알림(목록은 보이는 것만)
  seen.cfg.ask = () => '없는이름'
  expect(await skin($)).toMatchObject({ text: `없는 테마예요: 없는이름 · 고를 수 있는 것: ${LIST}` })
  expect(seen.toasts).toHaveLength(1)
  expect(seen.sets).toHaveLength(0)
  // 사람이 닫음의 다른 꼴(엔진이 isError·deny 로 알리는 것): 그대로
  for (const a of [{ isError: true as const, result: undefined, text: 'User declined to answer questions' }, { deny: "The user doesn't want to proceed with this tool use." }]) {
    seen.cfg.ask = () => a
    expect(await skin($)).toMatchObject({ text: '테마 그대로: Clawd' })
  }
  // 창을 못 띄움(닫음이 아닌 거절·실패. 엔진은 모두 'no answer (사유)' 로 던진다): 지금 테마와 목록
  for (const a of [{ deny: 'no one to ask' }, { deny: 'rejected by rule' }, { isError: true as const, result: undefined, text: 'tool failed' }]) {
    seen.cfg.ask = () => a
    expect(await skin($)).toMatchObject({ text: nowText })
  }
  expect(seen.sets).toHaveLength(0)
  // 빈 답(Other 에 빈칸)·지금 테마를 다시 고름: 아무것도 안 바꾼다
  for (const a of ['', '   ']) { seen.cfg.ask = () => a; expect(await skin($)).toMatchObject({ text: '테마 그대로: Clawd' }) }
  const nb = seen.blits.filter(b => b.key === 'clawd' || b.key === 'yard').length
  seen.cfg.ask = () => 'Clawd'
  expect(await skin($)).toMatchObject({ text: '테마: Clawd' })
  await step(clock, seen, 600)
  expect(seen.blits.filter(b => b.key === 'clawd' || b.key === 'yard').length).toBe(nb)
  expect(seen.sets).toHaveLength(0)
  // 친 글자: 숨긴 테마의 별칭·대소문자 무시
  seen.cfg.ask = () => '예시'
  expect(await skin($)).toMatchObject({ text: '테마: sample' })
  expect(seen.mem.clawd).toMatchObject({ theme: 'sample' })
  seen.cfg.ask = () => ' CLAWD '
  expect(await skin($)).toMatchObject({ text: '테마: Clawd' })
  expect(seen.mem.clawd).toMatchObject({ theme: 'clawd' })
})

test('/skin 고르기 창이 닫힌 뒤(고름·닫음) 대답 기다림이 남지 않는다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain', bg: false, yard: true } }, { still: true })
  on('classic.PermissionRequest', () => ({})) // 사람에게 묻는다(창이 뜸)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  if (!CHOICES) { await skin($); expect(seen.asks).toHaveLength(0); await ui.unmount(); return }
  const OOPS = /^앗, 막혔어요$/
  const answers: AskAns[] = ['예시', null, { deny: 'no one to ask' }, { isError: true, result: undefined, text: 'User declined to answer questions' }]
  for (const answer of answers) {
    const g = gate()
    seen.cfg.ask = async () => { await g.p; return answer }
    const r = skin($)
    await step(clock, seen, 100)
    expect(seen.asks.length).toBeGreaterThan(0)
    // 창은 AskUserQuestion 도구 호출이라 관찰 훅이 본다: 그동안 대답 기다림
    await step(clock, seen, 300)
    expect(await ui.find({ type: 'Text', text: ASKING })).toBeDefined()
    // 엔진이 창을 권한 확인으로 띄웠다면: 그동안은 대답 기다림
    await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: {} } as any)
    await step(clock, seen, 300)
    expect(await ui.find({ type: 'Text', text: ASKING })).toBeDefined()
    g.open()
    await r
    // 닫힌 직후(도구 유지 1.2초보다 먼저) 이미 대답 기다림이 아니고, 거절·실패로 끝나도 '앗' 이 아니라 쉬기
    await step(clock, seen, 200)
    expect(await ui.find({ type: 'Text', text: ASKING })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: OOPS })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^(쉬는 중|꾸벅꾸벅…|다 했어요!)$/ })).toBeDefined()
    await step(clock, seen, 2600)
    expect(await ui.find({ type: 'Text', text: OOPS })).toBeUndefined()
  }
  await ui.unmount()
})

test('/skin 고르기 창이 떠 있는 사이 새 세션이 열리면: 옛 답은 버리고 새 세션의 명령·화면을 건드리지 않는다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  if (!CHOICES) { await ui.unmount(); return }
  const g = gate()
  seen.cfg.ask = async () => { await g.p; return '없는이름' }
  const old = skin($)
  await step(clock, seen, 300)
  expect(await ui.find({ type: 'Text', text: ASKING })).toBeDefined()
  await ui.unmount()
  // 새 세션: 앞 세션의 도구·창 기록은 비운다(첫 틱에 대답 기다림이 다시 뜨지 않게)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui2 = await opened($, clock, seen)
  expect(await ui2.find({ type: 'Text', text: ASKING })).toBeUndefined()
  // 새 세션의 /skin 예시 가 파일을 읽는 사이 옛 창의 답이 온다
  const h = gate()
  seen.cfg.hold = p => (/themes\/sample\/sprites\.json$/.test(p) ? h.p : undefined)
  const now = skin($, '예시')
  await step(clock, seen, 100)
  g.open()
  expect(await old).toMatchObject({ text: '테마 그대로: Clawd' }) // 옛 답은 버린다
  expect(seen.toasts).toHaveLength(0) // 없는 이름 알림도 새 세션에 띄우지 않는다
  h.open()
  expect(await now).toMatchObject({ text: '테마: sample' }) // 새 세션의 명령은 취소되지 않는다
  expect(seen.mem.clawd).toMatchObject({ theme: 'sample' })
  await ui2.unmount()
})

test('/skin 고르기 창이 떠 있는 사이 바뀐 설정은 고른 뒤 저장에서도 남는다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, bg: true, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  if (!CHOICES) { await ui.unmount(); return }
  const g = gate()
  seen.cfg.ask = async () => { await g.p; return '예시' }
  const r = skin($)
  await step(clock, seen, 100)
  await scene($, '작게')
  await slash($, '끄기')
  // 저장을 다시 읽는 것이 실패해도(일시 오류) 창이 닫힌 뒤 읽은 설정으로 저장한다
  seen.cfg.storeHold = k => (k === 'clawd' ? Promise.reject(new Error('busy')) : undefined)
  g.open()
  expect(await r).toMatchObject({ text: '테마: sample' })
  expect(seen.mem.clawd).toMatchObject({ on: false, yard: true, bg: false, theme: 'sample' })
  await ui.unmount()
})

test('영어 화면의 /skin 고르기 창: 질문·선택지·답이 영어 이름', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { lang: 'en', clawd: { on: true, bg: false, yard: true, theme: 'sample' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  const en = skinChoices(THEMES, 'en'), list = shownThemeNames(THEMES, 'en').join(' · ')
  seen.cfg.ask = () => null
  if (!en) {
    expect(await skin($)).toMatchObject({ text: `Theme: sample · available: ${list}` })
    await ui.unmount()
    return
  }
  expect(await skin($)).toMatchObject({ text: 'Theme unchanged: sample' })
  expect(seen.asks.at(-1)).toEqual({ question: 'Now sample. Which theme?', header: 'Theme', options: en })
  seen.cfg.ask = () => en[0]!
  expect(await skin($)).toMatchObject({ text: `Theme: ${en[0]}` })
  seen.cfg.ask = () => 'nope'
  expect(await skin($)).toMatchObject({ text: `No theme named nope · available: ${list}` })
  seen.cfg.ask = () => ({ deny: 'no one to ask' })
  expect(((await skin($)) as { text: string }).text).toBe(`Theme: ${en[0]} · available: ${list}`)
  await ui.unmount()
})

test('/clawd 테마 … 는 더는 테마를 바꾸지 않는다(사용법만)', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, look: 'plain' } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step(clock, seen, 300)
  for (const a of ['테마 예시', 'theme sample', '테마']) {
    const t = ((await slash($, a)) as { text: string }).text
    expect(t.startsWith('사용법: /clawd')).toBe(true)
  }
  expect(seen.sets).toHaveLength(0)
  expect(await nowLabel($)).toBe('Clawd')
})

test('/scene 고르기 창: 지금 값이 보이고 선택지는 끄기·작게·크게. 고르면 저장, 닫으면 그대로, 못 띄우면 글자, 어느 쪽도 앗이 아니다', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { clawd: { on: true, bg: true, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  seen.cfg.ask = () => '작게'
  expect(await scene($)).toMatchObject({ text: '풍경: 작게' })
  expect(seen.asks.at(-1)).toEqual({ question: '지금 크게. 풍경을 어떻게 할까요?', header: '풍경', options: ['끄기', '작게', '크게'] })
  expect(seen.mem.clawd).toMatchObject({ yard: true, bg: false })
  expect(((await ui.find({ type: 'Image', key: 'yard' }))?.props as { rows: number }).rows).toBe(3)
  // Other 로 친 영어 값도 받는다
  seen.cfg.ask = () => 'OFF'
  expect(await scene($)).toMatchObject({ text: '풍경: 끄기' })
  expect(seen.asks.at(-1)!.question).toBe('지금 작게. 풍경을 어떻게 할까요?')
  expect(await ui.find({ type: 'Image', key: 'yard' })).toBeUndefined()
  const sets = seen.sets.length
  for (const a of [null, '', { isError: true as const, result: undefined, text: 'User declined to answer questions' }]) {
    seen.cfg.ask = () => a
    expect(await scene($)).toMatchObject({ text: '풍경 그대로: 끄기' })
  }
  seen.cfg.ask = () => '모름'
  expect(await scene($)).toMatchObject({ text: '사용법: /scene [끄기|작게|크게]' })
  for (const a of [{ deny: 'no one to ask' }, { isError: true as const, result: undefined, text: 'boom' }]) {
    seen.cfg.ask = () => a
    expect(await scene($)).toMatchObject({ text: '풍경: 끄기 · /scene [끄기|작게|크게]' })
  }
  expect(seen.sets.length).toBe(sets)
  await step(clock, seen, 300)
  expect(await ui.find({ type: 'Text', text: /^앗, 막혔어요$/ })).toBeUndefined()
  await ui.unmount()
})

test('영어 화면의 /scene: 선택지·답이 영어', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = engine(on, { lang: 'en', clawd: { on: true, bg: false, yard: true } }, { still: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await opened($, clock, seen)
  seen.cfg.ask = () => 'Full'
  expect(await scene($)).toMatchObject({ text: 'Scene: Full' })
  expect(seen.asks.at(-1)).toEqual({ question: 'Now Small. Which scene size?', header: 'Scene', options: ['Off', 'Small', 'Full'] })
  seen.cfg.ask = () => null
  expect(await scene($)).toMatchObject({ text: 'Scene unchanged: Full' })
  expect(await scene($, 'small')).toMatchObject({ text: 'Scene: Small' })
  expect(await scene($, 'big')).toMatchObject({ text: 'Usage: /scene [off|small|full]' })
  await ui.unmount()
})
