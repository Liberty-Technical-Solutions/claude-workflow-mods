import type { Register } from 'claude-code'

const WARN_AT = 85 // percent: toast on every agent spawn
const BLOCK_AT = 97 // percent: refuse new agents (they die mid-task at the limit)
const REFRESH_MS = 60_000

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const label = (kind: string) => LABELS[kind] ?? kind

const summarize = (limits: readonly Limit[]) =>
  limits.map(l => `${label(l.kind)} ${Math.round(l.percentUsed)}%`).join(' · ')

const worst = (limits: readonly Limit[]) =>
  limits.reduce<Limit | null>((a, b) => (a === null || b.percentUsed > a.percentUsed ? b : a), null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const refresh = async () => {
      const { rateLimits } = await $.session.usage()
      $.ui.status(rateLimits.length === 0 ? undefined : `usage ${summarize(rateLimits)}`)
    }
    await refresh().catch(() => {})
    $.clock.every(REFRESH_MS, () => {
      void refresh().catch(() => {})
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()
    $.ui.status(rateLimits.length === 0 ? undefined : `usage ${summarize(rateLimits)}`)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()
    const top = worst(rateLimits)

    if (top !== null && top.percentUsed >= BLOCK_AT) {
      const reset = top.resetsAt ? ` (resets ${top.resetsAt})` : ''
      return {
        deny: `${$.plugin.name}: ${label(top.kind)} usage is at ${Math.round(top.percentUsed)}%${reset}. Not starting "${e.description}" because it would likely die mid-task. Tell the user and wait for their go-ahead or the reset.`,
      }
    }

    if (top !== null && top.percentUsed >= WARN_AT) {
      $.ui.toast(`${$.plugin.name}: ${label(top.kind)} usage at ${Math.round(top.percentUsed)}% — starting "${e.description}"`)
    }

    return next(e)
  })
}
