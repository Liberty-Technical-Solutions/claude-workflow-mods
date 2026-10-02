export type Report = {
  files: number
  stat: string
  missing: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'close-out-check': { report: Report | null; isHidden: boolean }
  }
}
