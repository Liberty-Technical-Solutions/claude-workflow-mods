import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheState, Deploy, Docs, Prefs, Repo, StripUi } from '../types'
import { CONFIRM_MS, cacheView, ctxView, deployView, docsMissing, docsView, fmtK, normCwd, parseStatus, repoView } from './lib'

// One strip above the prompt: repo, docs, deploy, context ... cache. Each cell is a dim label with its value
// underneath and one button. Buttons are dim when nothing needs doing and bright when something does.
//
// Optional per-repo files:
//   .claude/deploy-verify.json  { "healthUrl": "https://app/api/health", "versionField": "version", "versionFile": "package.json" }
//   .claude/where.json          { "ports": [3000, 8347], "docs": ["HANDOFF.md"] }   (used by /where)

const ssRepoInit: Repo = { isRepo: false, branch: '', dirty: 0, ahead: 0, behind: 0 }
const ssCacheInit: CacheState = {
  lastApiAt: null,
  readTokens: 0,
  createdTokens: 0,
  ctxPercent: null,
  ctxTokens: null,
  ctxWindow: null,
  halted: null,
  allowSibling: false,
  lastActiveAt: null,
  resumedAt: null,
  now: 0,
}
const ssPrefsInit: Prefs = { ttlMin: 60, isAuto: false, idleHours: 8, warnMin: 10, showMode: 'always' }
const ssUiInit: StripUi = { menu: false, confirm: false, armedAt: null, msg: '' }

const ssRepo = atom({ plugin: 'status-strip', key: 'repo' } as const, ssRepoInit)
const ssDocs = atom({ plugin: 'status-strip', key: 'docs' } as const, null)
const ssDeploy = atom({ plugin: 'status-strip', key: 'deploy' } as const, null)
const ssCache = atom({ plugin: 'status-strip', key: 'cache' } as const, ssCacheInit)
const ssPrefs = atom({ plugin: 'status-strip', key: 'prefs' } as const, ssPrefsInit)
const ssUi = atom({ plugin: 'status-strip', key: 'ui' } as const, ssUiInit)

const ssTickMs = 30_000
const ssAutoWithinMs = 5 * 60_000 // Auto keep-alive refreshes when this little cache lifetime is left
const ssHbPrefix = 'status-strip.hb.' // one store key per live session: { cwd, startedAt, seenAt }
const ssHbFreshMs = 2 * 60_000
const ssHbStaleMs = 24 * 3_600_000
const ssPollGiveUpMs = 20 * 60_000

const ssChangelogs = ['CHANGELOG.md', 'CHANGELOG']
const ssHandoffs = ['HANDOFF.md', 'PROJECT_STATE.md', 'STATUS.md']
const ssDocOnly = /\.(md|txt|mdx)$/i
const ssDeployTrigger =
  /\bgit\s+push\b|\bgh\s+pr\s+merge\b|\bgh\s+workflow\s+run\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?deploy\b|\bvercel\b.*--prod|\bfly\s+deploy\b|\baz(?:d)?\s+(?:webapp|staticwebapp|deploy|up)\b|\bdeploy[\w-]*\.(?:sh|ps1)\b/i
const ssBilling = /spending limit|billing|payments? (?:have|has) failed|account is locked|recent account payments/i

const ssCloseOutPrompt =
  "I'm stepping away and this session will be left idle. Close it out: summarize what was done, what is unfinished, and the exact next steps. Save that to this project's handoff or session note (HANDOFF.md or its equivalent) if one exists, otherwise just show it here. Do not commit, push or deploy anything."

let ssStartSha = ''
let ssIsBusy = false
let ssSessionId = ''
let ssSessionCwd = ''
let ssStartedAt = 0

async function ssPatchCache($: EngineInterface, p: Partial<CacheState>) {
  await update($, ssCache, c => ({ ...c, ...p }))
}

async function ssPatchUi($: EngineInterface, p: Partial<StripUi>) {
  await update($, ssUi, u => ({ ...u, ...p }))
}

// Saved once for the machine: every session reads the same choices.
async function ssSetPrefs($: EngineInterface, p: Partial<Prefs>) {
  const next = { ...(await read($, ssPrefs)), ...p }
  await update($, ssPrefs, () => next)
  await $.store.set('status-strip.prefs', next)
}

async function ssLoadPrefs($: EngineInterface) {
  const saved = (await $.store.get('status-strip.prefs')) as Partial<Prefs> | undefined
  if (saved && typeof saved === 'object') await update($, ssPrefs, p => ({ ...p, ...saved }))
}

async function ssRun($: EngineInterface, argv: string[], timeoutMs = 15_000) {
  const r = await $.process.run(argv, { timeoutMs }).catch(() => null)
  return r === null ? { ok: false, out: '' } : { ok: r.exitCode === 0, out: r.stdout.trim() }
}

async function ssReadJson($: EngineInterface, path: string): Promise<any | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return null
  }
}

function ssDig(obj: any, field: string): string | null {
  const v = field.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), obj)
  return v == null ? null : String(v)
}

async function ssRepoRefresh($: EngineInterface) {
  const r = await ssRun($, ['git', 'status', '--porcelain=v1', '-b'])
  await update($, ssRepo, () => parseStatus(r.ok ? r.out : null))
}

async function ssExisting($: EngineInterface, names: string[]) {
  const found: string[] = []
  for (const n of names) if (await $.fs.exists(n)) found.push(n)
  return found
}

async function ssDocsRefresh($: EngineInterface) {
  if (!ssStartSha) return
  const committed = (await ssRun($, ['git', 'diff', '--name-only', `${ssStartSha}..HEAD`])).out.split('\n')
  const working = (await ssRun($, ['git', 'status', '--porcelain'])).out.split('\n').map(l => l.slice(3).replace(/^.* -> /, ''))
  const changed = [...new Set([...committed, ...working].map(s => s.trim()).filter(Boolean))]
  const hasVersionField = (await $.fs.exists('package.json')) && /"version"\s*:/.test(String(await $.fs.read('package.json')))
  const missing = docsMissing({
    changed,
    docOnly: ssDocOnly,
    changelogs: await ssExisting($, ssChangelogs),
    hasVersionField,
    handoffs: await ssExisting($, ssHandoffs),
  })
  if (missing === null) {
    await update($, ssDocs, () => null)
    return
  }
  const stat = (await ssRun($, ['git', 'diff', '--shortstat', ssStartSha])).out
  const docs: Docs = { files: changed.length, stat, missing }
  await update($, ssDocs, () => docs)
}

// Runs on the beat; does nothing unless a push, merge or deploy started a watch.
async function ssDeployPoll($: EngineInterface) {
  const current = await read($, ssDeploy)
  if (current === null || current.isDone) return

  const cfg = (await ssReadJson($, '.claude/deploy-verify.json')) ?? {}
  const next: Partial<Deploy> = {}

  const list = await $.process
    .run(['gh', 'run', 'list', '--limit', '1', '--json', 'databaseId,status,conclusion,name'], { timeoutMs: 20_000 })
    .catch(() => null)
  if (list === null || list.exitCode !== 0) {
    next.ci = 'unknown'
    next.note = 'gh unavailable or not signed in'
  } else {
    const run = JSON.parse(list.stdout || '[]')[0]
    if (!run) {
      next.ci = 'unknown'
      next.note = 'no workflow runs'
    } else {
      next.ciName = run.name
      if (run.status !== 'completed') next.ci = run.status === 'queued' ? 'waiting' : 'running'
      else if (run.conclusion === 'success') next.ci = 'passed'
      else {
        next.ci = 'failed'
        const log = await $.process
          .run(['gh', 'run', 'view', String(run.databaseId), '--log-failed'], { timeoutMs: 30_000 })
          .catch(() => null)
        next.note = log && ssBilling.test(log.stdout + log.stderr) ? 'BILLING BLOCK: Actions refused to start' : String(run.conclusion)
      }
    }
  }

  if (cfg.healthUrl) {
    next.healthUrl = cfg.healthUrl
    const source = await ssReadJson($, cfg.versionFile ?? 'package.json')
    next.expected = source ? ssDig(source, 'version') : null
    try {
      const res = await $.http.fetch(cfg.healthUrl)
      let body: any = {}
      try {
        body = JSON.parse(res.text)
      } catch {
        body = {}
      }
      next.live = res.ok ? (ssDig(body, cfg.versionField ?? 'version') ?? ssDig(body, 'build') ?? 'up') : `HTTP ${res.status}`
    } catch {
      next.live = 'unreachable'
    }
  }

  const now = await $.clock.now()
  const ciFinal = next.ci === 'passed' || next.ci === 'failed' || next.ci === 'unknown'
  const versionOk = !cfg.healthUrl || (next.expected != null && next.live === next.expected)
  next.isDone = (ciFinal && versionOk) || now - current.startedAt > ssPollGiveUpMs
  await update($, ssDeploy, d => (d ? { ...d, ...next } : d))
}

// Reads context fill and stamps the clock; the redraw follows from the state write.
async function ssSample($: EngineInterface) {
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  await ssPatchCache($, { now, ctxPercent: context.percent ?? null, ctxTokens: context.tokens ?? null, ctxWindow: context.window })
}

// One tiny tool-less question over this session's own transcript: the cached prefix is read, which resets
// its time-to-live. It adds nothing to the conversation.
async function ssRefreshCache($: EngineInterface) {
  await ssPatchUi($, { msg: 'refreshing cache…' })
  const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
  const now = await $.clock.now()
  if (r.isAnswered) {
    const rewritten = r.usage.cache_creation_input_tokens
    await ssPatchCache($, { lastApiAt: now, now })
    await ssPatchUi($, {
      msg:
        rewritten > 1000
          ? `cache had lapsed: ${fmtK(rewritten)} tokens rewritten at full price`
          : `cache refreshed: ${fmtK(r.usage.cache_read_input_tokens)} tokens read from cache`,
    })
  } else {
    await ssPatchUi($, { msg: `refresh failed: ${r.reason}` })
  }
  await ssSample($)
}

async function ssCompress($: EngineInterface) {
  await ssPatchUi($, { confirm: false, armedAt: null, msg: 'compressing…' })
  const r = await $.session.compact()
  await ssPatchCache($, { lastApiAt: null }) // the new, shorter prefix is cold until your next message
  await ssPatchUi($, { msg: 'skip' in r ? `compress skipped: ${r.skip}` : 'compressed; cache is cold until your next message' })
  await ssSample($)
}

async function ssAskCompress($: EngineInterface) {
  const ui = await read($, ssUi)
  if (ui.confirm) {
    await ssPatchUi($, { confirm: false, armedAt: null })
    return
  }
  await ssPatchUi($, { confirm: true, armedAt: await $.clock.now(), msg: '' })
}

// Asks Claude for a handoff note and parks Auto so the cache is allowed to lapse.
async function ssCloseOut($: EngineInterface) {
  await ssPatchCache($, { halted: 'idle' })
  await ssPatchUi($, { msg: 'close-out requested; Auto stays paused. Archive this session from the sidebar when it finishes.' })
  void $.prompt.submit({ text: ssCloseOutPrompt })
}

async function ssFixDocs($: EngineInterface) {
  const docs = await read($, ssDocs)
  if (docs === null) return
  void $.prompt.submit({
    text: `Close out this work: ${docs.missing.join('; ')}. Follow the repo's release/documentation rules, keep entries accurate to what changed this session, and do not touch unrelated files.`,
  })
}

async function ssHeartbeat($: EngineInterface, now: number) {
  await $.store.set(ssHbPrefix + ssSessionId, { cwd: normCwd(ssSessionCwd), startedAt: ssStartedAt, seenAt: now })
}

// True when a session that started AFTER this one is alive in the same folder.
async function ssHasNewerSibling($: EngineInterface, now: number) {
  const mine = ssHbPrefix + ssSessionId
  const here = normCwd(ssSessionCwd)
  let found = false
  for (const key of await $.store.keys()) {
    if (!key.startsWith(ssHbPrefix) || key === mine) continue
    const hb = (await $.store.get(key)) as { cwd?: string; startedAt?: number; seenAt?: number } | undefined
    if (!hb || typeof hb.seenAt !== 'number') continue
    if (now - hb.seenAt > ssHbStaleMs) {
      await $.store.delete(key)
      continue
    }
    if (hb.cwd === here && now - hb.seenAt < ssHbFreshMs && (hb.startedAt ?? 0) > ssStartedAt) found = true
  }
  return found
}

// The 30-second beat: gauges, check-in, Auto keep-alive rules, deploy watch.
async function ssTick($: EngineInterface) {
  await ssSample($)
  await ssRepoRefresh($)
  await ssDeployPoll($)
  const now = await $.clock.now()
  await ssHeartbeat($, now)

  const ui = await read($, ssUi)
  if (ui.confirm && ui.armedAt !== null && now - ui.armedAt > CONFIRM_MS) await ssPatchUi($, { confirm: false, armedAt: null })

  const prefs = await read($, ssPrefs)
  const c = await read($, ssCache)
  if (!prefs.isAuto) return

  let halted = c.halted
  if (halted === null) {
    const idleSince = Math.max(c.lastActiveAt ?? ssStartedAt, c.resumedAt ?? 0)
    if (prefs.idleHours > 0 && now - idleSince > prefs.idleHours * 3_600_000) {
      halted = 'idle'
      await ssPatchCache($, { halted })
      await ssPatchUi($, { msg: `Auto paused: no activity for ${prefs.idleHours}h. Send a message, Resume, or Close out.` })
      $.ui.toast(`status-strip: Auto paused after ${prefs.idleHours}h idle`)
    } else if (!c.allowSibling && (await ssHasNewerSibling($, now))) {
      halted = 'sibling'
      await ssPatchCache($, { halted })
      await ssPatchUi($, { msg: 'Auto paused: a newer session is open in this folder.' })
      $.ui.toast('status-strip: Auto paused, newer session in this folder')
    }
  }

  if (halted === null && !ssIsBusy && c.lastApiAt !== null) {
    const left = prefs.ttlMin * 60_000 - (c.now - c.lastApiAt)
    if (left > 0 && left < ssAutoWithinMs) await ssRefreshCache($)
  }
}

// The full snapshot behind /where: repo, PR, gh sign-in, dev servers, handoff docs.
async function ssWhereText($: EngineInterface) {
  const cfg = (await ssReadJson($, '.claude/where.json')) ?? {}
  if (!(await ssRun($, ['git', 'rev-parse', '--is-inside-work-tree'])).ok) return 'Not inside a git repository.'
  const branch = (await ssRun($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).out
  const top = (await ssRun($, ['git', 'rev-parse', '--show-toplevel'])).out
  const hasUpstream = (await ssRun($, ['git', 'rev-parse', '--abbrev-ref', '@{u}'])).ok
  if (hasUpstream) await ssRun($, ['git', 'fetch', '--quiet'], 20_000)
  const repo = parseStatus((await ssRun($, ['git', 'status', '--porcelain=v1', '-b'])).out)
  const worktrees = (await ssRun($, ['git', 'worktree', 'list', '--porcelain'])).out.split('\n').filter(l => l.startsWith('worktree ')).length
  const baseRef = (await ssRun($, ['git', 'rev-parse', '--verify', '--quiet', 'origin/master'])).ok ? 'origin/master' : 'origin/main'
  const unmerged = (await ssRun($, ['git', 'branch', '-r', '--no-merged', baseRef])).out.split('\n').filter(l => l.trim() && !l.includes('HEAD')).length
  const gh = await ssRun($, ['gh', 'auth', 'status'])
  const pr = gh.ok ? await ssRun($, ['gh', 'pr', 'view', '--json', 'number,state,mergeStateStatus', '--jq', '"#\\(.number) \\(.state) \\(.mergeStateStatus)"']) : { ok: false, out: '' }

  const up: string[] = []
  const down: string[] = []
  await Promise.all(
    (cfg.ports ?? [3000, 4000, 5173, 8347]).map(async (p: number) => {
      const ok = await $.http.fetch(`http://localhost:${p}/`).then(() => true, () => false)
      ;(ok ? up : down).push(String(p))
    }),
  )
  const docs: string[] = []
  for (const d of cfg.docs ?? ssHandoffs) {
    if (await $.fs.exists(d)) docs.push(`${d} (${(await ssRun($, ['git', 'log', '-1', '--format=%cr', '--', d])).out || 'uncommitted'})`)
  }
  const warnings: string[] = []
  if (/onedrive/i.test(top)) warnings.push('this checkout is inside OneDrive (sync locks / stale copy risk)')
  if (repo.behind > 0) warnings.push(`${repo.behind} commit(s) landed upstream, possibly from another session`)
  if (!gh.ok) warnings.push('gh is not signed in')
  if (unmerged > 0) warnings.push(`${unmerged} remote branch(es) not merged into ${baseRef}`)

  return [
    `Repo: ${top}`,
    `Branch: ${branch}${hasUpstream ? '' : ' (no upstream)'} · ${repo.dirty} uncommitted file(s) · ${repo.ahead} unpushed · ${repo.behind} behind upstream`,
    `PR: ${pr.out || (gh.ok ? 'none for this branch' : 'unknown (gh not signed in)')}`,
    `Worktrees: ${worktrees} · remote branches not merged into ${baseRef}: ${unmerged}`,
    `Dev servers up: ${up.join(', ') || 'none'} · not responding: ${down.join(', ') || 'none'}`,
    `Handoff/state docs: ${docs.join(', ') || 'none found'}`,
    warnings.length ? `Warnings: ${warnings.join('; ')}` : 'Warnings: none',
  ].join('\n')
}

async function ssSessionStart($: any, e: any, next: any) {
  await ssLoadPrefs($)
  ssSessionId = await $.session.id()
  ssSessionCwd = e.cwd
  ssStartedAt = await $.clock.now()
  ssStartSha = (await ssRun($, ['git', 'rev-parse', 'HEAD'])).out
  await ssPatchCache($, { now: ssStartedAt, lastActiveAt: ssStartedAt })
  await $.command.register({ name: 'where', description: 'Show the repo, PR, gh sign-in and dev-server snapshot and hand it to Claude' })
  await ssHeartbeat($, ssStartedAt).catch(() => {})
  await ssSample($).catch(() => {})
  await ssRepoRefresh($).catch(() => {})

  $.clock.every(ssTickMs, () => {
    void ssTick($).catch(() => {})
  })
  return next(e)
}

async function ssSessionEnd($: any, e: any, next: any) {
  if (ssSessionId) await $.store.delete(ssHbPrefix + ssSessionId).catch(() => {})
  return next(e)
}

function ssTurnStart($: any, e: any, next: any) {
  ssIsBusy = true
  return next(e)
}

async function ssTurnComplete($: any, e: any, next: any) {
  ssIsBusy = false
  if (e.agentId === undefined) {
    const now = await $.clock.now()
    await ssPatchCache($, {
      lastApiAt: now,
      now,
      lastActiveAt: now,
      halted: null, // you're back; the next beat re-checks idle and siblings
      readTokens: e.usage?.cache_read_input_tokens ?? 0,
      createdTokens: e.usage?.cache_creation_input_tokens ?? 0,
    })
    await ssSample($).catch(() => {})
    await ssRepoRefresh($).catch(() => {})
    await ssDocsRefresh($).catch(() => {})
  }
  return next(e)
}

async function ssToolCallBash($: any, e: any, next: any) {
  const ran = await next(e)
  if (ran.deny === undefined && ran.isError !== true && ssDeployTrigger.test(e.command)) {
    const startedAt = await $.clock.now()
    await update($, ssDeploy, () => ({
      ci: 'waiting', note: '', ciName: '', healthUrl: null, live: null, expected: null, startedAt, isDone: false,
    }))
    void ssDeployPoll($).catch(() => {})
  }
  return ran
}

async function ssCommandWhere($: any) {
  const text = await ssWhereText($)
  await ssRepoRefresh($)
  return { text: `Where we are:\n${text}`, context: ['Use this snapshot as the starting point for "where are we" / "what remains"; verify anything stale before relying on it.'] }
}

async function ssRenderStrip($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)

  const repo = repoView(await read($, ssRepo))
  const docs = docsView(await read($, ssDocs))
  const deploy = deployView(await read($, ssDeploy))
  const c = await read($, ssCache)
  const prefs = await read($, ssPrefs)
  const ui = await read($, ssUi)
  const ctx = ctxView(c)
  const cache = cacheView(c, prefs)
  const rawDeploy = await read($, ssDeploy)
  const rawDocs = await read($, ssDocs)
  const isArmed = ui.confirm && ui.armedAt !== null && c.now - ui.armedAt < CONFIRM_MS

  const needsAny = repo.needs || docs.needs || (deploy?.needs ?? false) || ctx.needs || cache.needs
  const isExtraOpen = ui.menu || isArmed || c.halted !== null
  if (prefs.showMode === 'needed' && !needsAny && !isExtraOpen) return next(e)

  const { Box, Text, Button, Select } = $.ui.resolve(e)
  const toneColor = (t: string) => (t === 'warning' || t === 'error' || t === 'success' ? t : undefined)
  const cell = (id: string, label: string, v: { text: string; tone: string }, button: any, isRight: boolean) => (
    <Box key={`ss-cell-${id}`} flexDirection="column" alignItems={isRight ? 'flex-end' : 'flex-start'} minWidth={14}>
      <Box flexDirection="column" paddingLeft={isRight ? 0 : 2} paddingRight={isRight ? 2 : 0} alignItems={isRight ? 'flex-end' : 'flex-start'}>
        <Text dimColor>{label}</Text>
        <Text color={toneColor(v.tone)} dimColor={v.tone === 'dim'}>
          {v.text}
        </Text>
      </Box>
      {button}
    </Box>
  )
  const btn = (key: string, label: string, needs: boolean, onPress: () => void) => (
    <Button key={key} label={label} variant={needs ? 'primary' : undefined} dimColor={!needs} onPress={onPress} />
  )

  // Several bands may share this slot: draw ours and stack whatever sits beneath it.
  const rest = await next(e)

  const row = (label: string, control: any) => (
    <Box key={`ss-row-${label}`} gap={2}>
      <Box width={34}>
        <Text>{label}</Text>
      </Box>
      {control}
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        {cell('repo', 'repo', repo, repo.needs || repo.text === 'no repo' ? null : btn('ss-repo', 'Refresh', false, () => void ssRepoRefresh($)), false)}
        {cell('docs', 'docs', docs, btn('ss-docs', 'Fix', docs.needs, () => void ssFixDocs($)), false)}
        {deploy && cell('deploy', 'deploy', deploy, btn('ss-deploy', 'Dismiss', deploy.needs, () => void update($, ssDeploy, () => null)), false)}
        {cell('ctx', 'context', ctx, btn('ss-compress', isArmed ? 'Compress…' : 'Compress', ctx.needs || isArmed, () => void ssAskCompress($)), false)}
        <Box flexGrow={1} />
        {cell(
          'cache',
          'cache',
          cache,
          <Box gap={1}>
            {btn('ss-refresh', cache.isExpired ? 'Refresh (full price)' : 'Refresh', cache.needs, () => void ssRefreshCache($))}
            <Button key="ss-gear" label="⚙ ▾" variant={ui.menu ? 'primary' : undefined} onPress={() => void ssPatchUi($, { menu: !ui.menu })} />
          </Box>,
          true,
        )}
      </Box>

      {isArmed && (
        <Box key="ss-confirm" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text bold>Compress this conversation?</Text>
          <Text>
            Claude will replace it with a short summary to free up context ({ctx.text} full now). The full text can no longer be read back, and the cache starts cold.
          </Text>
          <Box gap={1}>
            <Button key="ss-yes" label="Yes, compress" variant="primary" onPress={() => void ssCompress($)} />
            <Button key="ss-no" label="Cancel" onPress={() => void ssPatchUi($, { confirm: false, armedAt: null, msg: 'compress cancelled' })} />
          </Box>
        </Box>
      )}

      {prefs.isAuto && c.halted === 'idle' && (
        <Box key="ss-idle" gap={1}>
          <Text bold>Auto paused: idle for {prefs.idleHours}h.</Text>
          <Button key="ss-closeout" label="Close out" variant="primary" onPress={() => void ssCloseOut($)} />
          <Button
            key="ss-resume"
            label={`Resume (${prefs.idleHours}h more)`}
            onPress={() => void (async () => {
              await ssPatchCache($, { halted: null, resumedAt: await $.clock.now() })
              await ssPatchUi($, { msg: 'Auto resumed' })
            })()}
          />
        </Box>
      )}
      {prefs.isAuto && c.halted === 'sibling' && (
        <Box key="ss-sibling" gap={1}>
          <Text bold>Auto paused: a newer session is open in this folder.</Text>
          <Button key="ss-allow" label="Keep Auto here anyway" onPress={() => void ssPatchCache($, { halted: null, allowSibling: true })} />
        </Box>
      )}

      {ui.menu && (
        <Box key="ss-menu" flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Strip settings</Text>
          {row(
            'Cache lifetime',
            <Select key="ss-s-ttl" options={[{ value: '5', label: '5 min' }, { value: '60', label: '60 min' }]} value={String(prefs.ttlMin)} onSelect={(v: string) => void ssSetPrefs($, { ttlMin: Number(v) })} />,
          )}
          {row(
            'Keep alive automatically',
            <Select key="ss-s-auto" options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} value={prefs.isAuto ? 'on' : 'off'} onSelect={(v: string) => void ssSetPrefs($, { isAuto: v === 'on' })} />,
          )}
          {row(
            'Stop keeping alive after idle',
            <Select
              key="ss-s-idle"
              options={[{ value: '4', label: '4 hours' }, { value: '8', label: '8 hours' }, { value: '12', label: '12 hours' }, { value: '0', label: 'Never' }]}
              value={String(prefs.idleHours)}
              onSelect={(v: string) => void ssSetPrefs($, { idleHours: Number(v) })}
            />,
          )}
          {row(
            'Warn when this much is left',
            <Select key="ss-s-warn" options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }]} value={String(prefs.warnMin)} onSelect={(v: string) => void ssSetPrefs($, { warnMin: Number(v) })} />,
          )}
          {row(
            'Show the strip',
            <Select key="ss-s-show" options={[{ value: 'always', label: 'Always' }, { value: 'needed', label: 'Only when something needs you' }]} value={prefs.showMode} onSelect={(v: string) => void ssSetPrefs($, { showMode: v === 'needed' ? 'needed' : 'always' })} />,
          )}
          <Text dimColor>Saved once. Applies to every session on this PC.</Text>
        </Box>
      )}

      {rawDeploy && rawDeploy.note && <Text dimColor>deploy: {rawDeploy.note}</Text>}
      {rawDocs && rawDocs.missing.length > 0 && <Text dimColor>docs: {rawDocs.missing.join(' · ')}</Text>}
      {ui.msg && <Text dimColor>{ui.msg}</Text>}
      {rest}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', ssSessionStart)
  on('session.end', ssSessionEnd)
  on('turn.start', ssTurnStart)
  on('turn.complete', ssTurnComplete)
  on('tool.call', { tool: 'Bash' }, ssToolCallBash)
  on('command.run', { command: 'where' }, ssCommandWhere)
  on('ui.render', { component: 'AbovePrompt' }, ssRenderStrip)
}
