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
  showMode: 'always' | 'needed'
}

export type StripUi = { menu: boolean; confirm: boolean; armedAt: number | null; msg: string }

declare module 'claude-code' {
  interface PluginState {
    'status-strip': {
      repo: Repo
      docs: Docs | null
      deploy: Deploy | null
      cache: CacheState
      prefs: Prefs
      ui: StripUi
    }
  }
}
