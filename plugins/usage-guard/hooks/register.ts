import type { Register } from 'claude-code'

import { ugLabel, ugSummarize, ugWorst } from './lib'

// Usage in the bottom bar as small circles, with the 5-hour reset time:  usage 5h ◑ 62% (resets 1h 12m) · 7d ◔ 31%
// Also warns when an agent starts near a limit and refuses new agents at the edge.

const ugWarnAt = 85 // percent: toast on every agent spawn
const ugBlockAt = 97 // percent: refuse new agents (they die mid-task at the limit)
const ugRefreshMs = 60_000

async function ugSessionStart($: any, e: any, next: any) {
  const refresh = async () => {
    const { rateLimits } = await $.session.usage()
    $.ui.status(rateLimits.length === 0 ? undefined : `usage ${ugSummarize(rateLimits, await $.clock.now())}`)
  }
  await refresh().catch(() => {})
  $.clock.every(ugRefreshMs, () => {
    void refresh().catch(() => {})
  })

  return next(e)
}

async function ugTurnComplete($: any, e: any, next: any) {
  const { rateLimits } = await $.session.usage()
  $.ui.status(rateLimits.length === 0 ? undefined : `usage ${ugSummarize(rateLimits, await $.clock.now())}`)
  return next(e)
}

async function ugAgentSpawn($: any, e: any, next: any) {
  const { rateLimits } = await $.session.usage()
  const top = ugWorst(rateLimits)

  if (top !== null && top.percentUsed >= ugBlockAt) {
    const reset = top.resetsAt ? ` (resets ${top.resetsAt})` : ''
    return {
      deny: `usage-guard: ${ugLabel(top.kind)} usage is at ${Math.round(top.percentUsed)}%${reset}. Not starting "${e.description}" because it would likely die mid-task. Tell the user; the block lifts after the reset.`,
    }
  }

  if (top !== null && top.percentUsed >= ugWarnAt) {
    $.ui.toast(`usage-guard: ${ugLabel(top.kind)} usage at ${Math.round(top.percentUsed)}% — starting "${e.description}"`)
  }

  return next(e)
}

export const register: Register = on => {
  on('session.start', ugSessionStart)
  on('turn.complete', ugTurnComplete)
  on('agent.spawn', ugAgentSpawn)
}
