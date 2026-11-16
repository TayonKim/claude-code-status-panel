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
/** 펼친 작업(pid)과 중지 확인 중인 작업 */
export type PanelUi = { open: number[]; confirm: number | null }
export type Finished = { pid: number; label: string; model: string; effort: string; at: number; elapsed: number; hasReport: boolean; stopped?: boolean; noOut?: boolean }
/** Clawd 동작 이름(clawd/sprites.json 의 states) */
export type ClawdAct = 'idle' | 'think' | 'search' | 'read' | 'edit' | 'work' | 'cape' | 'happy' | 'heart' | 'coffee' | 'bubble' | 'kite' | 'dizzy' | 'ask' | 'oops' | 'sleepy'
/**
 * Clawd 표시 상태. 움직임의 프레임은 여기 두지 않는다(모듈 변수 + $.ui.blit).
 * on·look 은 $.store 'clawd' 에도 남아 세션이 바뀌어도 유지된다.
 * act: 지금 설명 글자의 동작(설명 글자가 달라질 때만 바뀜), raster: 그림 방식이 거부돼 글자 방식으로 바꿈,
 * ready: 그림 자료를 읽은 시각(ms, 0 이면 아직)
 */
export type ClawdView = {
  on: boolean; look: 'sticker' | 'plain'; act: ClawdAct; raster: boolean; ready: number
  /** 놀이터 배경(하늘·언덕·구름·나무). 없으면 켜짐으로 본다. /clawd 배경 으로 켜고 끄며 $.store 'clawd' 에도 남는다 */
  bg?: boolean
  /** 패널 맨 아래 놀이터(작은 Clawd 다섯 마리). 없으면 켜짐으로 본다. /clawd 놀이터 로 켜고 끄며 $.store 'clawd' 에도 남는다 */
  yard?: boolean
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
      claude: Shaped<ClaudeWindow[]>
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
