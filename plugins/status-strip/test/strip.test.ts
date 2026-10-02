// Run:  claude plugin test plugins/status-strip
// Drives the real strip against in-memory stand-ins for git, usage and the file system.
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, bodyColumns: 100 } as any

function world(on: any, opts: { ctx?: number } = {}) {
  const compacted: number[] = []
  const submitted: string[] = []
  on('process.run', ($: any, e: any) => {
    const cmd = e.argv.join(' ')
    const out = cmd.includes('status --porcelain=v1 -b') ? '## main...origin/main [ahead 2]\n M a.ts\n M b.ts' : cmd.includes('rev-parse HEAD') ? 'abc123' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { percent: opts.ctx ?? 78, tokens: 156000, window: 200000 } } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  // The engine's own (empty) band beneath the strip.
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return (globalThis as any).h(Box, {})
  })
  on('session.compact', () => {
    compacted.push(1)
    return { skip: 'test world' }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', ($: any, e: any) => {
    submitted.push(e.text)
    return { value: { text: e.text } }
  })
  return { compacted, submitted }
}

async function start($: any) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ plugin: 'status-strip', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
}

test('Compress asks first; nothing is compressed until Yes', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  const w = world(on)
  const ui = await start($)

  expect((await ui.find({ key: 'ss-compress' }))?.props.label).toBe('Compress')
  await ui.press({ key: 'ss-compress' })
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('Compress this conversation?')
  expect(w.compacted.length).toBe(0)

  await ui.press({ key: 'ss-no' })
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).not.toContain('Compress this conversation?')
  expect(w.compacted.length).toBe(0)

  await ui.press({ key: 'ss-compress' })
  await ui.press({ key: 'ss-yes' })
  expect(w.compacted.length).toBe(1)
})

test('settings: gear opens the dropdown panel and a pick is saved once', async ($, on) => {
  const store = new Map<string, unknown>()
  mock.store(on, {})
  mock.clock(on, { now: 1_000 })
  world(on)
  const ui = await start($)

  expect(await ui.find({ key: 'ss-s-ttl' })).toBeUndefined()
  await ui.press({ key: 'ss-gear' })
  expect(await ui.find({ key: 'ss-s-ttl' })).toBeDefined()

  await ui.select({ key: 'ss-s-ttl', value: '5' })
  await ui.select({ key: 'ss-s-auto', value: 'on' })
  expect(JSON.stringify(await ui.drawn())).toContain('5 min')
  void store
})

test('cells show repo and context values', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  world(on, { ctx: 38 })
  const ui = await start($)
  const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(text).toContain('main ±2 ↑2')
  expect(text).toContain('38%')
})
