// Pure logic for the strip: no $ in here, so it is unit-testable with `node --test`.

export type Tone = 'normal' | 'dim' | 'warning' | 'error' | 'success'

export type RepoLike = { isRepo: boolean; branch: string; dirty: number; ahead: number; behind: number }
export type DocsLike = { files: number; stat: string; missing: string[] }
export type DeployLike = {
  ci: string
  note: string
  ciName: string
  healthUrl: string | null
  live: string | null
  expected: string | null
  isDone: boolean
  kind: string
  startedAt: number
  endedAt: number | null
}
export type CacheLike = { lastApiAt: number | null; ctxPercent: number | null; ctxTokens: number | null; ctxWindow: number | null; now: number }
export type PrefsLike = { ttlMin: number; warnMin: number }

export type CellView = { text: string; tone: Tone; needs: boolean; ring?: string }

export const COMPRESS_AT = 70 // percent of the context window
export const CONFIRM_MS = 15_000

export const normCwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export const fmtLeft = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m >= 1 ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
}

/** How long something has been going: "<1m", "7m", "1h 05m". */
export function fmtElapsed(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Wall-clock start time, local, 24-hour: "14:32". */
export function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** What kind of thing a shell command started, so the cell can say "merge", "push" or "deploy". */
export function deployKind(command: string): 'merge' | 'push' | 'deploy' {
  if (/\bgh\s+pr\s+merge\b/i.test(command)) return 'merge'
  if (/\bgit\s+push\b/i.test(command)) return 'push'
  return 'deploy'
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

export function deployView(d: DeployLike | null, now: number): CellView | null {
  if (d === null) return null
  const took = fmtElapsed((d.endedAt ?? now) - d.startedAt)
  if (d.ci === 'failed') return { text: `CI failed · after ${took}`, tone: 'error', needs: true }
  if (d.ci === 'passed') {
    if (d.healthUrl === null) return { text: `CI passed · ${took}`, tone: 'success', needs: false }
    if (d.live !== null && d.live === d.expected) return { text: `✔ v${d.live} live · ${took}`, tone: 'success', needs: false }
    return { text: d.live === null ? `checking… · ${took}` : `live: ${d.live} · ${took}`, tone: 'warning', needs: d.isDone }
  }
  if (d.ci === 'unknown') return { text: `CI unknown · ${took}`, tone: 'dim', needs: false }
  return { text: `${d.ci === 'waiting' ? 'CI queued' : 'CI running'} · ${took}`, tone: 'normal', needs: false }
}

export function ctxView(c: CacheLike): CellView {
  if (c.ctxPercent === null) return { text: '—', tone: 'dim', needs: false }
  const needs = c.ctxPercent >= COMPRESS_AT
  return { text: `${Math.round(c.ctxPercent)}%`, tone: needs ? 'warning' : 'normal', needs, ring: ringGlyph(c.ctxPercent) }
}

export type CacheView = CellView & { isExpired: boolean; isCold: boolean }

export function cacheView(c: CacheLike, p: PrefsLike): CacheView {
  if (c.lastApiAt === null) return { text: 'cold', tone: 'dim', needs: false, isExpired: false, isCold: true, ring: '○' }
  const left = p.ttlMin * 60_000 - (c.now - c.lastApiAt)
  if (left <= 0) return { text: 'expired', tone: 'error', needs: true, isExpired: true, isCold: true, ring: '○' }
  const needs = left <= p.warnMin * 60_000
  // The ring shows how much of the lifetime is LEFT: full when fresh, empty when about to expire.
  return { text: `${fmtLeft(left)} left`, tone: needs ? 'warning' : 'normal', needs, isExpired: false, isCold: false, ring: ringGlyph((left / (p.ttlMin * 60_000)) * 100) }
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

// ---------------------------------------------------------------------------------------------------------------
// Meters: one small circle that fills up. Five steps keep it a single character wide.
// ---------------------------------------------------------------------------------------------------------------

/** A one-character circular meter for a percentage: empty, quarter, half, three-quarters, full. */
export function ringGlyph(pct: number | null): string {
  if (pct === null) return '○'
  const p = Math.min(100, Math.max(0, pct))
  if (p < 12.5) return '○'
  if (p < 37.5) return '◔'
  if (p < 62.5) return '◑'
  if (p < 87.5) return '◕'
  return '●'
}

// ---------------------------------------------------------------------------------------------------------------
// Per-project profile: .claude/mods.json decides which cells a repo shows.
// ---------------------------------------------------------------------------------------------------------------

export const CELL_IDS = ['repo', 'docs', 'deploy', 'context', 'cache']
export type ShowMode = 'dock' | 'always' | 'needed'
export type Profile = { cells: string[] | null; show: ShowMode | null }

/** Reads .claude/mods.json: { "cells": ["repo","context","cache"], "show": "dock" }. Anything unusable is ignored. */
export function parseProfile(text: string | null): Profile {
  const none: Profile = { cells: null, show: null }
  if (!text) return none
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return none
  }
  if (!raw || typeof raw !== 'object') return none
  const cells = Array.isArray(raw.cells) ? CELL_IDS.filter(id => raw.cells.includes(id)) : null
  const show = raw.show === 'dock' || raw.show === 'always' || raw.show === 'needed' ? (raw.show as ShowMode) : null
  return { cells: cells && cells.length > 0 ? cells : null, show }
}

export const showCell = (p: Profile, id: string) => p.cells === null || p.cells.includes(id)

// ---------------------------------------------------------------------------------------------------------------
// Ship stepper: follows a "deploy it" request through its steps, with a timer per step.
// ---------------------------------------------------------------------------------------------------------------

export const SHIP_STEPS = ['tests', 'version', 'pull request', 'merge', 'deploy', 'verify']

export type ShipLike = { isActive: boolean; failed: boolean; startedAt: number; endedAt: number | null; current: number; stepStarts: number[] }

export function newShip(now: number): ShipLike {
  return { isActive: true, failed: false, startedAt: now, endedAt: null, current: -1, stepStarts: SHIP_STEPS.map(() => -1) }
}

const SHIP_WHOLE = [
  /^(ok(ay)?,? )?(please )?(go ahead and )?(deploy|ship)( it| them| this| all)?( now| please)?$/,
  /^(build|commit)( it| them)?,? (and|then) (deploy|ship)( it| them)?$/,
  /^push( it)? to (master|main),? (and|then) (deploy|ship)( it)?$/,
  /^(deploy|ship)( it| them)? to (prod|production)$/,
  /^(proceed|continue|finish)(,)? (and|then) (deploy|ship)( it)?$/,
  /^(ok(ay)?,? )?(please )?(go ahead and )?merge( it| them| this)?( now| please)?$/,
]
const SHIP_TAIL = /\b(and|then)\s+(deploy|ship)(\s+(it|them|this))?(\s+to\s+(prod|production))?$/

/** True for a short "deploy it" / "ship it" / "merge it" style request. */
export function isShipRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[.!]+$/g, '').replace(/\s+/g, ' ').trim()
  return SHIP_WHOLE.some(re => re.test(t)) || (t.length < 400 && SHIP_TAIL.test(t))
}

const TEST_CMD = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck)|pytest|vitest|jest|go\s+test|cargo\s+test|dotnet\s+test|node\s+--test|claude\s+plugin\s+test)\b/i
const DEPLOY_CMD = /\bgh\s+workflow\s+run\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?deploy\b|\bvercel\b.*--prod|\bfly\s+deploy\b|\baz(?:d)?\s+(?:webapp|staticwebapp|deploy|up)\b|\bdeploy[\w-]*\.(?:sh|ps1)\b/i

/** Which ship step a shell command belongs to, or null when it is not part of shipping. */
export function stepForCommand(command: string, current: number): number | null {
  if (TEST_CMD.test(command)) return 0
  if (/\bgit\s+commit\b/i.test(command) || /\bgh\s+pr\s+create\b/i.test(command)) return 2
  if (/\bgh\s+pr\s+merge\b/i.test(command)) return 3
  if (/\bgit\s+push\b/i.test(command)) return current >= 3 ? 4 : 2
  if (DEPLOY_CMD.test(command)) return 4
  return null
}

/** The version and release-notes step: an edit to CHANGELOG or package.json. */
export function stepForEdit(filePath: string): number | null {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  return /^CHANGELOG(\.md)?$/i.test(name) || name === 'package.json' ? 1 : null
}

/** Moves the stepper forward only; a step that never happened simply shows as skipped. */
export function advanceShip(s: ShipLike, step: number, now: number): ShipLike {
  if (!s.isActive || s.endedAt !== null || step <= s.current) return s
  const stepStarts = [...s.stepStarts]
  if (stepStarts[step] < 0) stepStarts[step] = now
  return { ...s, current: step, stepStarts }
}

export function finishShip(s: ShipLike, now: number, failed: boolean): ShipLike {
  if (!s.isActive || s.endedAt !== null) return s
  const stepStarts = [...s.stepStarts]
  if (!failed && stepStarts[SHIP_STEPS.length - 1] < 0) stepStarts[SHIP_STEPS.length - 1] = now
  return { ...s, endedAt: now, failed, current: failed ? s.current : SHIP_STEPS.length - 1, stepStarts }
}

export type ShipStepView = { name: string; mark: string; text: string; tone: Tone }

export function shipView(s: ShipLike, now: number): { head: string; tone: Tone; steps: ShipStepView[] } {
  const end = s.endedAt ?? now
  const total = fmtElapsed(end - s.startedAt)
  const finished = s.endedAt !== null && !s.failed
  const head = finished ? `shipped in ${total}` : s.failed ? `ship stopped after ${total}` : `shipping · ${total}`
  const steps = SHIP_STEPS.map((name, i): ShipStepView => {
    const start = s.stepStarts[i]
    const isDone = finished || i < s.current
    const isRunning = !finished && !s.failed && i === s.current
    if (s.failed && i === s.current && start >= 0) return { name, mark: '✘', text: `${name} failed after ${fmtElapsed(end - start)}`, tone: 'error' }
    if (!isDone && !isRunning) return { name, mark: '·', text: name, tone: 'dim' }
    if (start < 0) return { name, mark: '–', text: `${name} skipped`, tone: 'dim' }
    const next = s.stepStarts.slice(i + 1).find(t => t >= 0)
    const stepEnd = isRunning ? end : (next ?? end)
    return { name, mark: isRunning ? '▶' : '✔', text: `${name} ${fmtElapsed(stepEnd - start)}`, tone: isRunning ? 'warning' : 'success' }
  })
  return { head, tone: s.failed ? 'error' : finished ? 'success' : 'warning', steps }
}

// ---------------------------------------------------------------------------------------------------------------
// Heads-ups: one-time messages decided here so they can be tested without a session.
// ---------------------------------------------------------------------------------------------------------------

/** True once per cache fill: the lifetime has dropped to the warning level but not yet run out. */
export function shouldWarnCache(left: number | null, warnMs: number, alreadyFor: number | null, fillAt: number | null): boolean {
  return left !== null && left > 0 && left <= warnMs && fillAt !== null && alreadyFor !== fillAt
}
