export type Snapshot = {
  summary: string
  detail: string
  warnings: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'where-are-we': { snapshot: Snapshot | null; isHidden: boolean }
  }
}
