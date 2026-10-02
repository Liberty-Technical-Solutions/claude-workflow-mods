import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report } from '../types'

const report = atom({ plugin: 'close-out-check', key: 'report' } as const, null)
const isHidden = atom({ plugin: 'close-out-check', key: 'isHidden' } as const, false)

const CHANGELOGS = ['CHANGELOG.md', 'CHANGELOG']
const HANDOFFS = ['HANDOFF.md', 'PROJECT_STATE.md', 'STATUS.md']
const DOC_ONLY = /\.(md|txt|mdx)$/i

async function run($: EngineInterface, argv: string[]) {
  const r = await $.process.run(argv, { timeoutMs: 15_000 }).catch(() => null)
  return r === null || r.exitCode !== 0 ? '' : r.stdout.trim()
}

async function existing($: EngineInterface, names: string[]) {
  const found: string[] = []
  for (const n of names) if (await $.fs.exists(n)) found.push(n)
  return found
}

async function check($: EngineInterface, startSha: string): Promise<Report | null> {
  if (!startSha) return null
  const committed = (await run($, ['git', 'diff', '--name-only', `${startSha}..HEAD`])).split('\n')
  const working = (await run($, ['git', 'status', '--porcelain'])).split('\n').map(l => l.slice(3).replace(/^.* -> /, ''))
  const changed = [...new Set([...committed, ...working].map(s => s.trim()).filter(Boolean))]
  if (changed.filter(f => !DOC_ONLY.test(f)).length === 0) return null

  const touched = (names: string[]) => changed.some(f => names.includes(f.split('/').pop() ?? ''))
  const missing: string[] = []

  const changelog = await existing($, CHANGELOGS)
  if (changelog.length > 0 && !touched(changelog)) missing.push('CHANGELOG not updated')

  if (await $.fs.exists('package.json')) {
    const hasVersion = /"version"\s*:/.test(String(await $.fs.read('package.json')))
    if (hasVersion && !changed.includes('package.json')) missing.push('version not bumped')
  }

  const handoffs = await existing($, HANDOFFS)
  if (handoffs.length > 0 && !touched(handoffs)) missing.push(`${handoffs[0]} not updated`)

  const stat = (await run($, ['git', 'diff', '--shortstat', startSha])).replace(/^\s+/, '')
  return { files: changed.length, stat, missing }
}

export const register: Register = on => {
  let startSha = ''

  on('session.start', async ($, e, next) => {
    startSha = await run($, ['git', 'rev-parse', 'HEAD'])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.isAborted && e.agentId === undefined) {
      const r = await check($, startSha).catch(() => null)
      await update($, report, () => r)
      await update($, isHidden, () => false)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (e.props.hasSurvey || r === null || (await read($, isHidden))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const fix = () => {
      void $.prompt.submit({
        text: `Close out this work: ${r.missing.join('; ')}. Follow the repo's release/documentation rules, keep entries accurate to what changed this session, and do not touch unrelated files.`,
      })
      void update($, isHidden, () => true)
    }

    return (
      <Box>
        <Text dimColor={r.missing.length === 0}>
          {r.stat || `${r.files} files changed`} ·{' '}
          {r.missing.length === 0 ? '✔ docs & version look current' : `! ${r.missing.join(' · ')}`}{' '}
        </Text>
        {r.missing.length > 0 && <Button key="fix" label="Fix" variant="primary" onPress={fix} />}
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
