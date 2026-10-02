import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'

// Optional per-repo file `.claude/where.json`: { "ports": [3000, 4000, 8347], "docs": ["HANDOFF.md", "PROJECT_STATE.md"] }

const snapshot = atom({ plugin: 'where-are-we', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'where-are-we', key: 'isHidden' } as const, false)

const DEFAULT_PORTS = [3000, 4000, 5173, 8347]
const DEFAULT_DOCS = ['HANDOFF.md', 'PROJECT_STATE.md', 'STATUS.md']

const run = async ($: EngineInterface, argv: string[], timeoutMs = 10_000) => {
  const r = await $.process.run(argv, { timeoutMs }).catch(() => null)
  return r === null ? { ok: false, out: '' } : { ok: r.exitCode === 0, out: r.stdout.trim() }
}

const take = async ($: EngineInterface): Promise<Snapshot> => {
  const warnings: string[] = []
  const cfg = await (async () => {
    try {
      return (await $.fs.exists('.claude/where.json')) ? JSON.parse(String(await $.fs.read('.claude/where.json'))) : {}
    } catch {
      return {}
    }
  })()

  const inRepo = (await run($, ['git', 'rev-parse', '--is-inside-work-tree'])).ok
  if (!inRepo) return { summary: 'not a git repo', detail: 'Not inside a git repository.', warnings }

  const branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).out
  const top = (await run($, ['git', 'rev-parse', '--show-toplevel'])).out
  const dirty = (await run($, ['git', 'status', '--porcelain'])).out.split('\n').filter(Boolean)
  const hasUpstream = (await run($, ['git', 'rev-parse', '--abbrev-ref', '@{u}'])).ok

  let ahead = 0
  let upstreamNew = 0
  if (hasUpstream) {
    await run($, ['git', 'fetch', '--quiet'], 20_000) // so "pushed from another session" is visible
    const lr = (await run($, ['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD'])).out.split(/\s+/)
    upstreamNew = Number(lr[0]) || 0
    ahead = Number(lr[1]) || 0
  }

  const worktrees = (await run($, ['git', 'worktree', 'list', '--porcelain'])).out.split('\n').filter(l => l.startsWith('worktree ')).length
  const baseRef = (await run($, ['git', 'rev-parse', '--verify', '--quiet', 'origin/master'])).ok ? 'origin/master' : 'origin/main'
  const unmerged = (await run($, ['git', 'branch', '-r', '--no-merged', baseRef])).out.split('\n').filter(l => l.trim() && !l.includes('HEAD')).length

  const gh = await run($, ['gh', 'auth', 'status'])
  const pr = gh.ok ? await run($, ['gh', 'pr', 'view', '--json', 'number,state,mergeStateStatus', '--jq', '"#\\(.number) \\(.state) \\(.mergeStateStatus)"']) : { ok: false, out: '' }

  const ports: number[] = cfg.ports ?? DEFAULT_PORTS
  const up: string[] = []
  const down: string[] = []
  await Promise.all(
    ports.map(async p => {
      const ok = await $.http.fetch(`http://localhost:${p}/`).then(() => true, () => false)
      ;(ok ? up : down).push(String(p))
    }),
  )

  const docs: string[] = []
  for (const d of cfg.docs ?? DEFAULT_DOCS) {
    if (await $.fs.exists(d)) {
      const when = (await run($, ['git', 'log', '-1', '--format=%cr', '--', d])).out
      docs.push(`${d} (${when || 'uncommitted'})`)
    }
  }

  if (/onedrive/i.test(top)) warnings.push('this checkout is inside OneDrive (sync locks / stale copy risk)')
  if (upstreamNew > 0) warnings.push(`${upstreamNew} commit(s) landed upstream, possibly from another session`)
  if (!gh.ok) warnings.push('gh is not signed in')
  if (unmerged > 0) warnings.push(`${unmerged} remote branch(es) not merged into ${baseRef}`)

  const parts = [
    branch,
    dirty.length ? `${dirty.length} dirty` : 'clean',
    ahead ? `${ahead} unpushed` : null,
    upstreamNew ? `${upstreamNew} behind` : null,
    pr.ok && pr.out ? `PR ${pr.out}` : null,
    `gh ${gh.ok ? '✔' : '✘'}`,
    up.length ? `up :${up.join(' :')}` : null,
    worktrees > 1 ? `${worktrees} worktrees` : null,
  ].filter(Boolean)

  const detail = [
    `Repo: ${top}`,
    `Branch: ${branch}${hasUpstream ? '' : ' (no upstream)'} · ${dirty.length} uncommitted file(s) · ${ahead} unpushed · ${upstreamNew} behind upstream`,
    `PR: ${pr.out || (gh.ok ? 'none for this branch' : 'unknown (gh not signed in)')}`,
    `Worktrees: ${worktrees} · remote branches not merged into ${baseRef}: ${unmerged}`,
    `Dev servers up: ${up.join(', ') || 'none'} · not responding: ${down.join(', ') || 'none'}`,
    `Handoff/state docs: ${docs.join(', ') || 'none found'}`,
    warnings.length ? `Warnings: ${warnings.join('; ')}` : 'Warnings: none',
  ].join('\n')

  return { summary: parts.join(' · '), detail, warnings }
}

async function refresh($: EngineInterface) {
  const s = await take($).catch((): Snapshot => ({ summary: 'snapshot failed', detail: 'Snapshot failed.', warnings: [] }))
  await update($, snapshot, () => s)
  return s
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'where', description: 'Refresh the repo/PR/server snapshot and hand it to Claude' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'where' }, async $ => {
    const s = await refresh($)
    await update($, isHidden, () => false)
    return { text: `Where we are:\n${s.detail}`, context: ['Use this snapshot as the starting point for "where are we" / "what remains"; verify anything stale before relying on it.'] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null || (await read($, isHidden))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{s.summary} </Text>
          <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
          <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
        </Box>
        {s.warnings.map(w => (
          <Text bold>! {w}</Text>
        ))}
      </Box>
    )
  })
}
