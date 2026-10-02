export type NextSteps = {
  items: string[]
  /** True when the model gave nothing usable and the built-in list is showing. */
  isFallback: boolean
  isLoading: boolean
  /** Bumped on every new turn or prompt so a slow answer for an old turn is thrown away. */
  gen: number
}

export type NextPrefs = { isOn: boolean; count: number }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { steps: NextSteps; prefs: NextPrefs }
  }
}
