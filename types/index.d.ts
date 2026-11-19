export type Job = {
  pid: number
  tool?: 'codex' | 'argon'
  label: string
  project: string
  model: string
  effort: string
  elapsed: number
  rssMB: number
  idle: number | null
  last: string
  out: string
  /** 로그 마지막 몇 줄(로그 파일이 없으면 빈 목록) */
  tail?: string[]
}
export type Waiting = { pid: number; labels: string[]; elapsed: number }
export type Mem = { freePct: number | null; swapUsedGB?: number; swapTotalGB?: number; load: number | null; cpus: number }
export type Snapshot = {
  at: number
  jobs: Job[]
  waiting: Waiting[]
  mem: Mem
  error?: string
}
export type UsageWindow = { usedPct: number; mins: number; resetsAt: number }
export type ResetCredit = { title: string; expiresAt: number }
export type CodexUsage = { at: number; windows?: UsageWindow[]; reached?: string | null; plan?: string; resetCredits?: number; credits?: ResetCredit[]; error?: string }
/** Claude 사용량 창(5시간·주간): 상태 줄과 같은 수치. resetsAt 은 초 단위(없으면 0) */
export type ClaudeWindow = { kind: string; usedPct: number; resetsAt: number }
/**
 * 이 프로세스의 자기 사용량 값(session.usage 의 rateLimits)과 종류마다 그 값을 받은 시각(초, 0 = 나이 모름), 세션끼리 나누는 파일(hooks/share.ts)의
 * 자기 칸 이름(id)·그 칸을 적은 횟수(seq)·세션 세대(gen: 세션이 시작할 때마다 하나 올린다, 옛 세대는 쓰지 않는다). /reload-plugins 뒤에도 남게 atom 에 둔다.
 * init 이 false 면 아직 기록 없음(이 프로세스에서 갓 올림): 그때 처음 본 값은 나이 모름(파일에 적지 않는다)
 */
export type ClaudeOwn = {
  init: boolean; wins: ClaudeWindow[]; at: Record<string, number>; id: string; seq: number; gen: number
  /** 지금 주인(gen 을 마지막으로 올린 세션)의 시작 엔진 시각(ms)과 그 모듈의 이름. 다른 모듈의 시작과 어느 쪽이 나중인지 가른다 */
  ownAt?: number; ownMod?: string
}
/** 화면에 보일 Claude 사용량(세션끼리 나눈 값)과 그 값을 올린 세대(ClaudeOwn 의 gen). 옛 세대의 늦은 쓰기는 이 gen 으로 버린다 */
export type ClaudeView = { gen: number; wins: ClaudeWindow[] }
/** 펼친 작업(pid)과 중지 확인 중인 작업 */
export type PanelUi = { open: number[]; confirm: number | null }
export type Finished = { pid: number; label: string; model: string; effort: string; at: number; elapsed: number; hasReport: boolean; stopped?: boolean; noOut?: boolean }
/** Clawd 동작 이름(clawd/sprites.json 의 states) */
export type ClawdAct = 'idle' | 'think' | 'search' | 'read' | 'edit' | 'work' | 'cape' | 'happy' | 'heart' | 'coffee' | 'bubble' | 'kite' | 'dizzy' | 'ask' | 'oops' | 'sleepy'
/**
 * Clawd 표시 상태. 움직임의 프레임은 여기 두지 않는다(모듈 변수 + $.ui.blit).
 * on·bg·yard 는 $.store 'clawd' 에도 남아 세션이 바뀌어도 유지된다(옛 look 값은 0.8.7 부터 읽지 않는다: 민무늬 고정).
 * act: 지금 설명 글자의 동작(설명 글자가 달라질 때만 바뀜), raster: 그림 방식이 거부돼 글자 방식으로 바꿈,
 * ready: 그림 자료를 읽은 시각(ms, 0 이면 아직)
 */
export type ClawdView = {
  on: boolean; act: ClawdAct; raster: boolean; ready: number
  /** 아래 풍경의 배경(하늘·언덕·구름·나무). 없으면 켜짐으로 본다. /scene 크게(켬)·작게(끔) */
  bg?: boolean
  /** 패널 맨 아래 풍경(작은 캐릭터 다섯). 없으면 켜짐으로 본다. /scene 끄기 면 false. 큰 캐릭터(on)와 따로 */
  yard?: boolean
  /** 놀이터 아래 흙 줄 색(0xRRGGBB). 테마를 바꿔 놀이터 띠가 blit 된 뒤 흙 줄만 다시 칠하려고 올린다(그리기에서는 읽지 않는다) */
  soil?: number
  /** 설명 글자(act)를 마지막으로 적은 세션의 세대(ClaudeOwn 의 gen). 옛 세대의 늦은 쓰기('사용량이 바닥나요' 등)를 버린다(그리기에서는 읽지 않는다) */
  gen?: number
}

/** 배터리(맥북). pct 가 null 이면 배터리가 없거나(맥미니) 아직 못 읽음 */
export type PowerState = { pct: number | null; charging: boolean; at: number }
/** 맨 위 시계에 그린 시각('HH:MM')과 날짜. 분이 바뀔 때만 고쳐 다시 그린다 */
export type ClockView = { hm: string; date: string }
/** 최근 7일(hooks/week.py): 날마다 작업 시간(초)·토큰, 오래된 날 → 오늘. at 이 0 이면 아직 못 읽음(덩어리를 숨긴다) */
export type WeekDay = { date: string; secs: number; tokens: number }
export type WeekStats = { at: number; partial: boolean; days: WeekDay[]; total: { secs: number; tokens: number } }

declare module 'claude-code' {
  interface PluginState {
    'status-panel': {
      snapshot: Shaped<Snapshot>
      finished: Shaped<Finished[]>
      usage: Shaped<CodexUsage>
      claudeView: Shaped<ClaudeView>
      claudeOwn2: Shaped<ClaudeOwn>
      ui: Shaped<PanelUi>
      clawd: Shaped<ClawdView>
      power: Shaped<PowerState>
      clock: Shaped<ClockView>
      doneOpen: Shaped<boolean>
      lang: Shaped<'ko' | 'en'>
      week: Shaped<WeekStats>
    }
  }
}
