// Run:  claude plugin test plugins/status-strip
// Drives the real strip against in-memory stand-ins for git, usage and the file system.
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, bodyColumns: 100 } as any

function world(on: any, opts: { ctx?: number; runList?: () => string; files?: Record<string, string> } = {}) {
  const compacted: number[] = []
  const submitted: string[] = []
  on('process.run', ($: any, e: any) => {
    const cmd = e.argv.join(' ')
    const out = cmd.includes('run list')
      ? (opts.runList?.() ?? '')
      : cmd.includes('status --porcelain=v1 -b') ? '## main...origin/main [ahead 2]\n M a.ts\n M b.ts' : cmd.includes('rev-parse HEAD') ? 'abc123' : ''
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
  // The engine may resolve a relative path to an absolute one, so match the file by the end of its path.
  const fileFor = (path: string) => {
    const p = path.split('\\').join('/')
    const hit = Object.keys(opts.files ?? {}).find(k => p === k || p.endsWith('/' + k))
    return hit === undefined ? undefined : opts.files![hit]
  }
  on('fs.exists', ($: any, e: any) => ({ value: fileFor(e.path) !== undefined }))
  on('fs.read', ($: any, e: any) => {
    const f = fileFor(e.path)
    if (f === undefined) throw new Error('no such file')
    return { value: f }
  })
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', ($: any, e: any) => {
    submitted.push(e.text)
    return { text: e.text }
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

test('a push shows how long the deploy has been going, then how long it took', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  let status = 'in_progress'
  world(on, { runList: () => JSON.stringify([{ databaseId: 1, status, conclusion: status === 'completed' ? 'success' : '', name: 'Deploy' }]) })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }))
  const ui = await start($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'git push origin main' } as any)
  await clock.advance(5 * 60_000)
  await ui.redraw()

  const running = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(running).toContain('push') // the cell is labelled by what started it
  expect(running).toMatch(/CI running · [45]m/)
  expect(running).toContain('started') // wall-clock start time on the detail line

  status = 'completed'
  await clock.advance(60_000)
  await ui.redraw()
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toMatch(/CI passed · [5-7]m/)
})

// ---- quiet dock, meters, profile, ship stepper, heads-ups ------------------------------------------------------

function extras(on: any, opts: { files?: Record<string, string>; runList?: () => string } = {}) {
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }))
  return { toasts }
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join(' | ')

test('quiet dock: one thin line while all is fine, opens on click, opens by itself when something needs you', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  world(on, { ctx: 38 })
  extras(on)
  const ui = await start($)

  expect(await ui.find({ key: 'ss-dock-open' })).toBeDefined()
  expect(await ui.find({ key: 'ss-compress' })).toBeUndefined()
  expect(await texts(ui)).toContain('◑ 38%') // a small circle beside the number
  await ui.press({ key: 'ss-dock-open' })
  expect(await ui.find({ key: 'ss-compress' })).toBeDefined()
  await ui.press({ key: 'ss-dock-close' })
  expect(await ui.find({ key: 'ss-compress' })).toBeUndefined()
})

test('quiet dock: opens by itself when context is high', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  world(on, { ctx: 78 })
  extras(on)
  const ui = await start($)
  expect(await ui.find({ key: 'ss-dock-open' })).toBeUndefined()
  expect(await ui.find({ key: 'ss-compress' })).toBeDefined()
  expect(await texts(ui)).toContain('◕ 78%')
})

test('per-project profile: .claude/mods.json picks the cells and the mode', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  world(on, { ctx: 62, files: { '.claude/mods.json': '{"show":"always","cells":["repo","context"]}' } })
  extras(on)
  const ui = await start($)
  expect(await ui.find({ key: 'ss-dock-open' })).toBeUndefined() // "always" overrides the default dock
  expect(await ui.find({ key: 'ss-compress' })).toBeDefined()
  expect(await ui.find({ key: 'ss-docs' })).toBeUndefined() // docs cell hidden for this repo
  expect(await ui.find({ key: 'ss-refresh' })).toBeUndefined() // cache cell hidden too
  expect(await texts(ui)).toContain('◑ 62%')
})

test('ship stepper: follows "deploy it" through tests, version, PR, merge, deploy and says when it is done', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  let status = 'in_progress'
  world(on, { ctx: 38, runList: () => JSON.stringify([{ databaseId: 1, status, conclusion: status === 'completed' ? 'success' : '', name: 'Deploy' }]) })
  const x = extras(on)
  const ui = await start($)

  expect(await texts(ui)).not.toContain('shipping')
  await $.prompt.submit({ text: 'deploy it' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'pnpm test' } as any)
  await clock.advance(2 * 60_000)
  await ui.redraw()
  let t = await texts(ui)
  expect(t).toContain('shipping')
  expect(t).toContain('▶ tests')
  expect(await ui.find({ key: 'ss-dock-open' })).toBeUndefined() // shipping holds the dock open

  await $.tool.call({ tool: 'Edit', tool_use_id: 't2', file_path: '/repo/CHANGELOG.md' } as any)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't3', command: 'git commit -m release' } as any)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't4', command: 'gh pr merge 5 --squash' } as any)
  await clock.advance(60_000)
  await ui.redraw()
  t = await texts(ui)
  expect(t).toContain('✔ tests')
  expect(t).toContain('✔ version')
  expect(t).toContain('▶ merge')
  expect(t).toMatch(/merge \| CI (queued|running) · /) // the deploy cell is labelled "merge" and timed

  status = 'completed'
  await clock.advance(2 * 60_000)
  await ui.redraw()
  t = await texts(ui)
  expect(t).toMatch(/shipped in \d+m/)
  expect(x.toasts.some(m => m.includes('Shipped in'))).toBe(true)
})

test('heads-ups: cache expiry is announced once, not left as a permanent line', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  world(on, { ctx: 38 })
  const x = extras(on)
  await start($)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as any)

  await clock.advance(30 * 60_000) // 30 of 60 minutes used: nothing to say yet
  expect(x.toasts.filter(m => m.includes('Cache expires'))).toEqual([])
  await clock.advance(22 * 60_000) // 8 minutes left: inside the warning window
  expect(x.toasts.filter(m => m.includes('Cache expires'))).toHaveLength(1)
  await clock.advance(5 * 60_000) // still inside the window: no repeat
  expect(x.toasts.filter(m => m.includes('Cache expires'))).toHaveLength(1)
})

test('heads-ups can be switched off in the settings dropdown', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  world(on, { ctx: 38 })
  const x = extras(on)
  const ui = await start($)
  await ui.press({ key: 'ss-dock-open' })
  await ui.press({ key: 'ss-gear' })
  await ui.select({ key: 'ss-s-toasts', value: 'off' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  await clock.advance(55 * 60_000)
  expect(x.toasts).toEqual([])
})
