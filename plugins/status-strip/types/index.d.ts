export type Repo = { isRepo: boolean; branch: string; dirty: number; ahead: number; behind: number }

export type Docs = { files: number; stat: string; missing: string[] }

export type Deploy = {
  ci: 'waiting' | 'running' | 'passed' | 'failed' | 'unknown'
  note: string
  ciName: string
  healthUrl: string | null
  live: string | null
  expected: string | null
  /** 'merge', 'push' or 'deploy': what started the watch, shown as the cell's label. */
  kind: string
  startedAt: number
  /** When the run finished (for "took 3m"); null while it is still going. */
  endedAt: number | null
  isDone: boolean
}

/** The ship stepper: a "deploy it" request followed through its steps. Step times are -1 until the step starts. */
export type Ship = {
  isActive: boolean
  failed: boolean
  startedAt: number
  endedAt: number | null
  current: number
  stepStarts: number[]
}

/** From the repo's .claude/mods.json: which cells to show and how. Null means "no preference". */
export type ProfileState = { cells: string[] | null; show: 'dock' | 'always' | 'needed' | null }

export type CacheState = {
  lastApiAt: number | null
  readTokens: number
  createdTokens: number
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  /** Why Auto keep-alive is paused for THIS session (the saved preference is untouched). */
  halted: 'idle' | 'sibling' | null
  allowSibling: boolean
  lastActiveAt: number | null
  resumedAt: number | null
  now: number
}

/** Saved once for the machine (in $.store) and read by every session. */
export type Prefs = {
  ttlMin: number
  isAuto: boolean
  /** Hours of inactivity before Auto stops; 0 = never. */
  idleHours: number
  /** The cache cell turns amber when this many minutes or fewer are left. */
  warnMin: number
  /** 'dock': a thin line that opens when something needs you. 'always': the full strip. 'needed': hidden until needed. */
  showMode: 'dock' | 'always' | 'needed'
  /** Short heads-up messages (cache about to expire, deploy finished) instead of lines that stay on screen. */
  toasts: boolean
}

export type StripUi = { menu: boolean; confirm: boolean; armedAt: number | null; msg: string; isOpen: boolean }

declare module 'claude-code' {
  interface PluginState {
    'status-strip': {
      repo: Repo
      docs: Docs | null
      deploy: Deploy | null
      ship: Ship | null
      profile: ProfileState
      cache: CacheState
      prefs: Prefs
      ui: StripUi
    }
  }
}
