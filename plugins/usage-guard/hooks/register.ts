import type { Register } from 'claude-code'

const ugWarnAt = 85 // percent: toast on every agent spawn
const ugBlockAt = 97 // percent: refuse new agents (they die mid-task at the limit)
const ugRefreshMs = 60_000

const ugLabels: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type UgLimit = { kind: string; percentUsed: number; resetsAt?: string }

const ugLabel = (kind: string) => ugLabels[kind] ?? kind

const ugSummarize = (limits: readonly UgLimit[]) =>
  limits.map(l => `${ugLabel(l.kind)} ${Math.round(l.percentUsed)}%`).join(' · ')

const ugWorst = (limits: readonly UgLimit[]) =>
  limits.reduce<UgLimit | null>((a, b) => (a === null || b.percentUsed > a.percentUsed ? b : a), null)

async function ugSessionStart($: any, e: any, next: any) {
  const refresh = async () => {
    const { rateLimits } = await $.session.usage()
    $.ui.status(rateLimits.length === 0 ? undefined : `usage ${ugSummarize(rateLimits)}`)
  }
  await refresh().catch(() => {})
  $.clock.every(ugRefreshMs, () => {
    void refresh().catch(() => {})
  })

  return next(e)
}

async function ugTurnComplete($: any, e: any, next: any) {
  const { rateLimits } = await $.session.usage()
  $.ui.status(rateLimits.length === 0 ? undefined : `usage ${ugSummarize(rateLimits)}`)
  return next(e)
}

async function ugAgentSpawn($: any, e: any, next: any) {
  const { rateLimits } = await $.session.usage()
  const top = ugWorst(rateLimits)

  if (top !== null && top.percentUsed >= ugBlockAt) {
    const reset = top.resetsAt ? ` (resets ${top.resetsAt})` : ''
    return {
      deny: `usage-guard: ${ugLabel(top.kind)} usage is at ${Math.round(top.percentUsed)}%${reset}. Not starting "${e.description}" because it would likely die mid-task. Tell the user and wait for their go-ahead or the reset.`,
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
