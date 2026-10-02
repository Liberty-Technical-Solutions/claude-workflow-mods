export type CacheState = {
  lastApiAt: number | null
  readTokens: number
  createdTokens: number
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  ttlMin: number
  isAuto: boolean
  /** Why Auto is paused for THIS session (the saved Auto preference is untouched). */
  halted: 'idle' | 'sibling' | null
  /** User chose to keep Auto running although a newer session shares this folder. */
  allowSibling: boolean
  /** Last turn that finished in this session; the idle clock counts from here. */
  lastActiveAt: number | null
  /** Set by "Resume": grants another idle allowance from this moment. */
  resumedAt: number | null
  armedAt: number | null
  msg: string
  now: number
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keeper': { cache: CacheState }
  }
}
