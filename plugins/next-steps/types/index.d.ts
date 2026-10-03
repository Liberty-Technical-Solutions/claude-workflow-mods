export type NextSteps = {
  items: string[]
  /** True when the model gave nothing usable and the built-in list is showing. */
  isFallback: boolean
  isLoading: boolean
  /** The assistant's latest reply, kept so the suggestions can be written from it quickly. */
  lastAnswer: string
  /** Indexes of the ticked options (checkboxes). Cleared whenever a new list arrives or anything is sent. */
  picked: number[]
  /** True while the combined request is shown for a final Send or Back. */
  isPreviewing: boolean
  /** Bumped on every new turn or prompt so a slow answer for an old turn is thrown away. */
  gen: number
}

export type NextPrefs = { isOn: boolean; count: number }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { steps: NextSteps; prefs: NextPrefs }
  }
}
