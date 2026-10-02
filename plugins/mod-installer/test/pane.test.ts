// Run:  claude plugin test plugins/mod-installer
// Drives the real /mods pane against an in-memory file system, so it never touches anyone's settings.
import { expect, mock, test } from 'claude-code/testing'

const TERMINAL = { title: 'Workflow mods', isFocused: true, bodyColumns: 100 } as const

const CATALOG = JSON.stringify({
  marketplace: 'workflow-mods',
  repo: 'org/repo',
  mods: ['ship-it', 'cache-keeper', 'usage-guard'].map(id => ({ id, name: id, summary: `${id} summary`, where: 'w', preview: [{ text: 'p' }], cost: 'c', needs: 'n' })),
})

// The test engine resolves '/home/x' to 'C:\home\x' on Windows; key both spellings the same.
const key = (p: string) => p.replace(/^[A-Za-z]:/, '').split('\\').join('/')

// Minimal in-memory disk. `siblings`: whether the mod folders sit next to the installer (folder mode).
function memoryDisk(on: any, files: Map<string, string>, siblings: boolean, isWritable = true, hasGit = true) {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', ($: any, e: any) => ({ value: files.has(key(e.path)) || (siblings && /[\\/]ship-it$/.test(e.path)) || (hasGit && /[\\/][.]git$/.test(e.path)) }))
  on('fs.read', ($: any, e: any) => {
    if (e.path.endsWith('catalog.json')) return { value: CATALOG }
    const text = files.get(key(e.path))
    if (text === undefined) throw new Error(`no such file: ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($: any, e: any) => {
    if (!isWritable) throw new Error('permission denied')
    files.set(key(e.path), e.text)
    return { value: undefined }
  })
}

const SETTINGS = '/home/.claude/settings.json'

test('folder mode: toggle, review, confirm writes the selection', async ($, on) => {
  const files = new Map([[SETTINGS, JSON.stringify({ hooks: { keep: 1 }, env: { CLAUDE_CODE_PLUGIN_DIRS: '/other/plugin' } })]])
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  memoryDisk(on, files, true)

  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  const ui = await $.ui.mount({ plugin: 'mod-installer', surface: 'terminal', component: 'Pane', props: TERMINAL, requestId: 'mod-installer' })

  // Nothing installed yet, so every mod starts ticked.
  expect((await ui.find({ key: 'tog-cache-keeper' }))?.props.label).toBe('[x] cache-keeper')
  await ui.press({ key: 'tog-ship-it' })
  await ui.press({ key: 'tog-usage-guard' })
  expect((await ui.find({ key: 'tog-ship-it' }))?.props.label).toBe('[ ] ship-it')

  await ui.press({ key: 'install' }) // review step only: nothing written yet
  expect(JSON.parse(files.get(SETTINGS)!).env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/other/plugin')
  expect(files.has(`${SETTINGS}.bak-before-mod-installer`)).toBe(false)

  await ui.press({ key: 'confirm' })
  const after = JSON.parse(files.get(SETTINGS)!)
  const dirs: string[] = after.env.CLAUDE_CODE_PLUGIN_DIRS.split(':')
  expect(dirs[0]).toBe('/other/plugin')
  // endsWith keeps this independent of the separator the host OS puts in the plugin root
  const has = (name: string) => dirs.some(d => d.endsWith(name))
  expect(has('mod-installer')).toBe(true)
  expect(has('cache-keeper')).toBe(true)
  expect(has('ship-it')).toBe(false)
  expect(has('usage-guard')).toBe(false)
  expect(after.hooks).toEqual({ keep: 1 })
  expect(files.has(`${SETTINGS}.bak-before-mod-installer`)).toBe(true)
})

test('marketplace mode: confirm enables the selection through enabledPlugins', async ($, on) => {
  const files = new Map([[SETTINGS, JSON.stringify({ enabledPlugins: { 'x@other': true } })]])
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  memoryDisk(on, files, false)

  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  const ui = await $.ui.mount({ plugin: 'mod-installer', surface: 'terminal', component: 'Pane', props: TERMINAL, requestId: 'mod-installer' })

  await ui.press({ key: 'none' })
  await ui.press({ key: 'tog-cache-keeper' })
  await ui.press({ key: 'install' })
  await ui.press({ key: 'confirm' })

  const after = JSON.parse(files.get(SETTINGS)!)
  expect(after.enabledPlugins).toEqual({ 'x@other': true, 'cache-keeper@workflow-mods': true, 'mod-installer@workflow-mods': true })
  expect(after.extraKnownMarketplaces['workflow-mods']).toEqual({ source: { source: 'github', repo: 'org/repo' }, autoUpdate: true })
})

test('a blocked write shows a copy button instead of failing silently', async ($, on) => {
  const files = new Map([[SETTINGS, '{}']])
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  memoryDisk(on, files, false, false)

  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  const ui = await $.ui.mount({ plugin: 'mod-installer', surface: 'terminal', component: 'Pane', props: TERMINAL, requestId: 'mod-installer' })
  await ui.press({ key: 'install' })
  await ui.press({ key: 'confirm' })

  expect(await ui.find({ key: 'copy' })).toBeDefined()
  expect(files.get(SETTINGS)).toBe('{}')
})

test('folder mode: Update mods now runs git pull and reports the result', async ($, on) => {
  const files = new Map([[SETTINGS, '{}']])
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  memoryDisk(on, files, true)
  const calls: string[][] = []
  on('process.run', ($: any, e: any) => {
    calls.push(e.argv)
    return { value: { exitCode: 0, stdout: 'Updating a..b, 2 files changed', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  const ui = await $.ui.mount({ plugin: 'mod-installer', surface: 'terminal', component: 'Pane', props: TERMINAL, requestId: 'mod-installer' })
  await ui.press({ key: 'update' })

  expect(calls.some(c => c.includes('pull') && c.includes('--ff-only'))).toBe(true)
  const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(text).toContain('Updated. Start a NEW session')
})

test('folder mode from a downloaded ZIP: Update mods now explains how to update instead of failing', async ($, on) => {
  const files = new Map([[SETTINGS, '{}']])
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  memoryDisk(on, files, true, true, false)
  on('process.run', () => {
    throw new Error('git must not run for a ZIP copy')
  })

  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  const ui = await $.ui.mount({ plugin: 'mod-installer', surface: 'terminal', component: 'Pane', props: TERMINAL, requestId: 'mod-installer' })
  await ui.press({ key: 'update' })

  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('downloaded ZIP')
})
