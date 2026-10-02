export type Watch = {
  ci: 'waiting' | 'running' | 'passed' | 'failed' | 'unknown'
  note: string
  ciName: string
  healthUrl: string | null
  live: string | null
  expected: string | null
  startedAt: number
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'deploy-verifier': { watch: Watch | null; isHidden: boolean }
  }
}
