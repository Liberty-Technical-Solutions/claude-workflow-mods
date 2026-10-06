// Pure logic for usage-guard: no $ in here, so it is unit-testable with `node --test`.

export type UgLimit = { kind: string; percentUsed: number; resetsAt?: string }

const ugLabels: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const ugLabel = (kind: string) => ugLabels[kind] ?? kind

/** A one-character circular meter: empty, quarter, half, three-quarters, full. */
export function ugRing(pct: number): string {
  const p = Math.min(100, Math.max(0, pct))
  if (p < 12.5) return '○'
  if (p < 37.5) return '◔'
  if (p < 62.5) return '◑'
  if (p < 87.5) return '◕'
  return '●'
}

/** "1h 12m", "12m" or "<1m": how long until a limit resets. */
export function ugFormatIn(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** The bottom-bar text: each limit as a small circle and a number; the 5-hour limit also says when it resets. */
export function ugSummarize(limits: readonly UgLimit[], nowMs: number): string {
  return limits
    .map(l => {
      const base = `${ugLabel(l.kind)} ${ugRing(l.percentUsed)} ${Math.round(l.percentUsed)}%`
      const resets = l.kind === 'five_hour' && l.resetsAt ? Date.parse(l.resetsAt) - nowMs : NaN
      return Number.isFinite(resets) && resets > 0 ? `${base} (resets ${ugFormatIn(resets)})` : base
    })
    .join(' · ')
}

export const ugWorst = (limits: readonly UgLimit[]) =>
  limits.reduce<UgLimit | null>((a, b) => (a === null || b.percentUsed > a.percentUsed ? b : a), null)
