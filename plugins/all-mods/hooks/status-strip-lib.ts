// GENERATED copy of plugins/status-strip/hooks/lib.ts by build-bundle.ps1. Do not edit.
// Pure logic for the strip: no $ in here, so it is unit-testable with `node --test`.

export type Tone = 'normal' | 'dim' | 'warning' | 'error' | 'success'

export type RepoLike = { isRepo: boolean; branch: string; dirty: number; ahead: number; behind: number }
export type DocsLike = { files: number; stat: string; missing: string[] }
export type DeployLike = { ci: string; note: string; ciName: string; healthUrl: string | null; live: string | null; expected: string | null; isDone: boolean }
export type CacheLike = { lastApiAt: number | null; ctxPercent: number | null; ctxTokens: number | null; ctxWindow: number | null; now: number }
export type PrefsLike = { ttlMin: number; warnMin: number }

export type CellView = { text: string; tone: Tone; needs: boolean }

export const COMPRESS_AT = 70 // percent of the context window
export const CONFIRM_MS = 15_000

export const normCwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export const fmtLeft = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m >= 1 ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
}

export const fmtK = (n: number | null) => (n === null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** Parses `git status --porcelain=v1 -b` output. */
export function parseStatus(out: string | null): RepoLike {
  if (out === null) return { isRepo: false, branch: '', dirty: 0, ahead: 0, behind: 0 }
  const lines = out.split('\n')
  const head = lines[0] ?? ''
  const m = head.match(/^## (?:No commits yet on )?([^.\s]+(?: \(no branch\))?)/)
  const branch = m ? m[1].replace(' (no branch)', '') : '?'
  return {
    isRepo: true,
    branch,
    dirty: lines.slice(1).filter(l => l.trim()).length,
    ahead: Number(head.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(head.match(/behind (\d+)/)?.[1] ?? 0),
  }
}

export function repoView(r: RepoLike): CellView {
  if (!r.isRepo) return { text: 'no repo', tone: 'dim', needs: false }
  const text = `${r.branch} ${r.dirty ? '±' + r.dirty : '✓'}${r.ahead ? ' ↑' + r.ahead : ''}${r.behind ? ' ↓' + r.behind : ''}`
  return { text, tone: r.behind > 0 ? 'warning' : 'normal', needs: r.behind > 0 }
}

export function docsView(d: DocsLike | null): CellView {
  if (d === null) return { text: '—', tone: 'dim', needs: false }
  return d.missing.length
    ? { text: `${d.missing.length} stale`, tone: 'warning', needs: true }
    : { text: 'current', tone: 'normal', needs: false }
}

export function deployView(d: DeployLike | null): CellView | null {
  if (d === null) return null
  if (d.ci === 'failed') return { text: 'CI failed', tone: 'error', needs: true }
  if (d.ci === 'passed') {
    if (d.healthUrl === null) return { text: 'CI passed', tone: 'success', needs: false }
    if (d.live !== null && d.live === d.expected) return { text: `✔ v${d.live} live`, tone: 'success', needs: false }
    return { text: d.live === null ? 'checking…' : `live: ${d.live}`, tone: 'warning', needs: d.isDone }
  }
  if (d.ci === 'unknown') return { text: 'CI unknown', tone: 'dim', needs: false }
  return { text: d.ci === 'waiting' ? 'CI queued' : 'CI running', tone: 'normal', needs: false }
}

export function ctxView(c: CacheLike): CellView {
  if (c.ctxPercent === null) return { text: '—', tone: 'dim', needs: false }
  const needs = c.ctxPercent >= COMPRESS_AT
  return { text: `${Math.round(c.ctxPercent)}%`, tone: needs ? 'warning' : 'normal', needs }
}

export type CacheView = CellView & { isExpired: boolean; isCold: boolean }

export function cacheView(c: CacheLike, p: PrefsLike): CacheView {
  if (c.lastApiAt === null) return { text: 'cold', tone: 'dim', needs: false, isExpired: false, isCold: true }
  const left = p.ttlMin * 60_000 - (c.now - c.lastApiAt)
  if (left <= 0) return { text: 'expired', tone: 'error', needs: true, isExpired: true, isCold: true }
  const needs = left <= p.warnMin * 60_000
  return { text: `${fmtLeft(left)} left`, tone: needs ? 'warning' : 'normal', needs, isExpired: false, isCold: false }
}

/** Which of the repo's files say a code change needs release notes, a version bump or a handoff update. */
export function docsMissing(a: {
  changed: string[]
  docOnly: RegExp
  changelogs: string[]
  hasVersionField: boolean
  handoffs: string[]
}): string[] | null {
  const code = a.changed.filter(f => !a.docOnly.test(f))
  if (code.length === 0) return null
  const touched = (names: string[]) => a.changed.some(f => names.includes(f.split('/').pop() ?? ''))
  const missing: string[] = []
  if (a.changelogs.length > 0 && !touched(a.changelogs)) missing.push('CHANGELOG not updated')
  if (a.hasVersionField && !a.changed.includes('package.json')) missing.push('version not bumped')
  if (a.handoffs.length > 0 && !touched(a.handoffs)) missing.push(`${a.handoffs[0]} not updated`)
  return missing
}
