import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Watch } from '../types'

// Optional per-repo file `.claude/deploy-verify.json`:
//   { "healthUrl": "https://app.example.com/api/health", "versionField": "version", "versionFile": "package.json" }
// Without it the band shows CI status only.

const dvWatch = atom({ plugin: 'deploy-verifier', key: 'watch' } as const, null)
const dvIsHidden = atom({ plugin: 'deploy-verifier', key: 'isHidden' } as const, false)

const dvTrigger =
  /\bgit\s+push\b|\bgh\s+pr\s+merge\b|\bgh\s+workflow\s+run\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?deploy\b|\bvercel\b.*--prod|\bfly\s+deploy\b|\baz(?:d)?\s+(?:webapp|staticwebapp|deploy|up)\b|\bdeploy[\w-]*\.(?:sh|ps1)\b/i
const dvBilling = /spending limit|billing|payments? (?:have|has) failed|account is locked|recent account payments/i
const dvPollMs = 15_000
const dvGiveUpMs = 20 * 60_000

type DvConfig = { healthUrl?: string; versionField?: string; versionFile?: string }

async function dvReadJson($: EngineInterface, path: string): Promise<any | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return null
  }
}

function dvDig(obj: any, field: string): string | null {
  const v = field.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), obj)
  return v == null ? null : String(v)
}

// Runs on a timer from session.start; does nothing unless a push/merge/deploy started a watch.
async function dvPoll($: EngineInterface) {
  const current = await read($, dvWatch)
  if (current === null || current.isDone) return

  const cfg: DvConfig = (await dvReadJson($, '.claude/deploy-verify.json')) ?? {}
  const next: Partial<Watch> = {}

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
        next.note = log && dvBilling.test(log.stdout + log.stderr) ? 'BILLING BLOCK: Actions refused to start' : String(run.conclusion)
      }
    }
  }

  if (cfg.healthUrl) {
    next.healthUrl = cfg.healthUrl
    const source = await dvReadJson($, cfg.versionFile ?? 'package.json')
    next.expected = source ? dvDig(source, 'version') : null
    try {
      const res = await $.http.fetch(cfg.healthUrl)
      let body: any = {}
      try {
        body = JSON.parse(res.text)
      } catch {
        body = {}
      }
      next.live = res.ok ? (dvDig(body, cfg.versionField ?? 'version') ?? dvDig(body, 'build') ?? 'up (no version field)') : `HTTP ${res.status}`
    } catch {
      next.live = 'unreachable'
    }
  }

  const now = await $.clock.now()
  const ciFinal = next.ci === 'passed' || next.ci === 'failed' || next.ci === 'unknown'
  const versionOk = !cfg.healthUrl || (next.expected != null && next.live === next.expected)
  next.isDone = (ciFinal && versionOk) || now - current.startedAt > dvGiveUpMs

  await update($, dvWatch, w => (w ? { ...w, ...next } : w))
}

function dvSessionStart($: any, e: any, next: any) {
  $.clock.every(dvPollMs, () => {
    void dvPoll($).catch(() => {})
  })
  return next(e)
}

async function dvToolCallBash($: any, e: any, next: any) {
  const ran = await next(e)
  if (ran.deny === undefined && ran.isError !== true && dvTrigger.test(e.command)) {
    const startedAt = await $.clock.now()
    await update($, dvWatch, () => ({
      ci: 'waiting', note: '', ciName: '', healthUrl: null, live: null, expected: null, startedAt, isDone: false,
    }))
    await update($, dvIsHidden, () => false)
    void dvPoll($).catch(() => {})
  }
  return ran
}

async function dvRenderBand($: any, e: any, next: any) {
  const w = await read($, dvWatch)
  if (e.props.hasSurvey || w === null || (await read($, dvIsHidden))) return next(e)

  const { Box, Text, Button } = $.ui.resolve(e)
  const ci = { waiting: '… CI queued', running: '… CI running', passed: '✔ CI passed', failed: '✘ CI failed', unknown: '? CI unknown' }[w.ci as 'waiting']
  const live =
    w.healthUrl === null
      ? ''
      : w.live === null
        ? ' · live: checking…'
        : w.expected && w.live === w.expected
          ? ` · ✔ v${w.live} is live`
          : ` · live: ${w.live}${w.expected ? ` (expected ${w.expected})` : ''}`
  const note = w.note ? ` · ${w.note}` : ''

  // Several bands share this slot: draw ours and stack whatever sits beneath it.
  const rest = await next(e)

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold={w.ci === 'failed'} dimColor={w.isDone && w.ci === 'passed'}>
          deploy · {ci}
          {w.ciName ? ` (${w.ciName})` : ''}
          {live}
          {note}{' '}
        </Text>
        <Button key="dv-hide" label="Hide" onPress={() => update($, dvIsHidden, () => true)} />
      </Box>
      {rest}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', dvSessionStart)
  on('tool.call', { tool: 'Bash' }, dvToolCallBash)
  on('ui.render', { component: 'AbovePrompt' }, dvRenderBand)
}
