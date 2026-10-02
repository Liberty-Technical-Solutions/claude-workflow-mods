import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalog, InstallerState } from '../types'
import { applySelection, buildPlan, detectInstalled, joinPath, parentDir, pathSep } from './lib'

// /mods opens a pane: tick the mods you want, read a preview of each, press Install.
// The catalog of mods lives in ../catalog.json: add an entry there to add a mod to the installer.

const PANE = 'mod-installer'

const miInitial: InstallerState = {
  catalog: null,
  ctx: null,
  settingsPath: '',
  installed: [],
  selected: [],
  focus: null,
  phase: 'edit',
  plan: [],
  hasBundle: false,
  autoUpdate: null,
  msg: '',
  snippet: null,
}
const miState = atom({ plugin: 'mod-installer', key: 'ui' } as const, miInitial)

async function miPatch($: EngineInterface, p: Partial<InstallerState>) {
  await update($, miState, s => ({ ...s, ...p }))
}

async function miReadSettings($: EngineInterface, path: string): Promise<{ raw: string; json: any }> {
  if (!(await $.fs.exists(path))) return { raw: '', json: {} }
  const raw = String(await $.fs.read(path))
  try {
    return { raw, json: JSON.parse(raw) }
  } catch {
    throw new Error('settings.json is not plain JSON (comments or trailing commas?). Edit it by hand instead.')
  }
}

// Reads the catalog, works out how this installer was installed, and what is enabled today.
async function miLoad($: EngineInterface) {
  try {
    const catalog = JSON.parse(String(await $.fs.read(`${$.plugin.root}/catalog.json`))) as Catalog
    const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const settingsPath = `${home}/.claude/settings.json`
    const packRoot = parentDir($.plugin.root)
    const ids = catalog.mods.map(m => m.id)

    // Cloned pack: the mod folders sit next to this one. Marketplace install: they do not.
    const isFolder = ids.length > 0 && (await $.fs.exists(joinPath(packRoot, ids[0])))
    const ctx = {
      mode: isFolder ? ('folder' as const) : ('marketplace' as const),
      packRoot,
      marketplace: catalog.marketplace,
      repo: catalog.repo,
      ids,
      installerId: 'mod-installer',
      bundleId: 'all-mods',
      legacyIds: catalog.legacyIds ?? [],
      sep: pathSep(home),
    }

    const { json } = await miReadSettings($, settingsPath)
    const installed = detectInstalled(json, ctx)
    // Replacing the bundle or the old separate mods: start from everything, since they covered it all.
    const isReplacing = installed.includes(ctx.bundleId) || installed.some(id => ctx.legacyIds.includes(id))
    const selected = installed.length > 0 && !isReplacing ? installed : ids
    await miPatch($, {
      catalog,
      ctx,
      settingsPath,
      installed,
      selected,
      focus: ids[0] ?? null,
      phase: 'edit',
      plan: [],
      hasBundle: installed.includes(ctx.bundleId),
      autoUpdate: json.extraKnownMarketplaces?.[catalog.marketplace] ? json.extraKnownMarketplaces[catalog.marketplace].autoUpdate === true : null,
      msg: '',
      snippet: null,
    })
  } catch (err) {
    await miPatch($, { msg: `Could not load the mod catalog: ${err instanceof Error ? err.message : String(err)}` })
  }
}

async function miToggle($: EngineInterface, id: string) {
  await update($, miState, s => ({
    ...s,
    selected: s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id],
    focus: id,
    phase: 'edit',
    msg: '',
  }))
}

async function miReview($: EngineInterface) {
  const s = await read($, miState)
  if (s.ctx === null) return
  const plan = buildPlan(s.installed, s.selected, s.ctx)
  const how = s.ctx.mode === 'folder' ? `CLAUDE_CODE_PLUGIN_DIRS (folders under ${s.ctx.packRoot})` : `enabledPlugins (${s.ctx.marketplace} marketplace)`
  const lines = [
    `Will edit ${s.settingsPath}: ${how}`,
    plan.add.length ? `Add: ${plan.add.join(', ')}` : 'Add: nothing',
    plan.remove.length ? `Remove: ${plan.remove.join(', ')}` : 'Remove: nothing',
    ...(plan.replacesBundle ? ['The all-mods bundle is replaced by your selection (otherwise mods would load twice).'] : []),
    ...(plan.replacesLegacy.length ? [`The old separate mods (${plan.replacesLegacy.join(', ')}) are replaced by the new status-strip and next-steps.`] : []),
    'Your other settings and plugin folders are kept. A backup is saved next to the file.',
  ]
  await miPatch($, { phase: 'confirm', plan: lines, msg: '' })
}

async function miInstall($: EngineInterface) {
  const s = await read($, miState)
  if (s.ctx === null) return
  let next = ''
  try {
    const { raw, json } = await miReadSettings($, s.settingsPath)
    const out = applySelection(json, s.selected, s.ctx)
    next = JSON.stringify(out, null, 2) + '\n'
    if (raw) await $.fs.write(`${s.settingsPath}.bak-before-mod-installer`, raw)
    await $.fs.write(s.settingsPath, next)
    await miPatch($, {
      installed: s.selected,
      hasBundle: false,
      phase: 'edit',
      plan: [],
      snippet: null,
      msg: `Installed ${s.selected.length} mod(s). Start a NEW session to load them. Backup: ${s.settingsPath}.bak-before-mod-installer`,
    })
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    await miPatch($, {
      phase: 'edit',
      snippet: next || null,
      msg: `Could not write settings: ${why}${next ? ' Use Copy to put the new settings.json on your clipboard and paste it over the old one.' : ''}`,
    })
  }
}

// Cloned-folder installs: pull the latest mods from GitHub. (Marketplace installs update through Claude Code itself.)
async function miUpdate($: EngineInterface) {
  const s = await read($, miState)
  if (s.ctx === null || s.ctx.mode !== 'folder') return
  const repoRoot = parentDir(s.ctx.packRoot)
  if (!(await $.fs.exists(joinPath(repoRoot, '.git')))) {
    // A downloaded ZIP is not a git clone, so there is nothing to pull.
    await miPatch($, {
      msg: `This copy came from a downloaded ZIP, so it cannot update itself. To update: download the latest ZIP from github.com/${s.ctx.repo}, extract it over ${repoRoot} and choose Replace. Then open a new session; your choices are kept.`,
    })
    return
  }
  await miPatch($, { msg: 'Checking for updates…' })
  const r = await $.process.run(['git', '-C', repoRoot, 'pull', '--ff-only'], { timeoutMs: 90_000 }).catch(() => null)
  const out = r === null ? '' : [r.stdout, r.stderr].join(' ').trim()
  await miLoad($)
  if (r === null || r.exitCode !== 0) {
    await miPatch($, { msg: `Could not update: ${out || 'git is not available'}. Ask whoever set this up, or run "git pull" in the mods folder.` })
  } else if (/already up.to.date/i.test(out)) {
    await miPatch($, { msg: 'Already up to date.' })
  } else {
    await miPatch($, { msg: 'Updated. Start a NEW session to load the new versions.' })
  }
}

async function miSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'mods', description: 'Choose which workflow mods to install' })
  // One friendly nudge per machine, so nobody has to be told the command exists.
  if ((await $.store.get('mod-installer.welcomed')) !== true) {
    $.ui.toast('Workflow mods: type /mods to choose which ones to turn on.')
    await $.store.set('mod-installer.welcomed', true)
  }
  return next(e)
}

async function miCommandMods($: any) {
  await $.ui.open({ id: PANE, title: 'Workflow mods', focus: true, closeOnEscape: true })
  await miLoad($)
  return { text: 'Opened the workflow mods installer.' }
}

async function miRenderPane($: any, e: any) {
  const s = await read($, miState)
  const { Box, Text, Button } = $.ui.resolve(e)

  if (s.catalog === null || s.ctx === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Workflow mods installer</Text>
        <Text dimColor>{s.msg || 'Loading… run /mods again if this stays empty.'}</Text>
      </Box>
    )
  }

  const mods = s.catalog.mods
  const focus = mods.find(m => m.id === s.focus) ?? mods[0]
  const modeText =
    s.ctx.mode === 'folder'
      ? `Install method: folders in ${s.ctx.packRoot}`
      : `Install method: ${s.ctx.marketplace} marketplace (enabledPlugins)`

  const updateText =
    s.ctx.mode === 'folder'
      ? 'Updates: press "Update mods now" to download the latest versions.'
      : s.autoUpdate === true
        ? 'Updates: automatic. New versions install by themselves when Claude Code starts.'
        : 'Updates: not automatic yet. Press Install selected once to turn on automatic updates.'

  return (
    <Box flexDirection="column">
      <Text bold>Workflow mods installer</Text>
      <Text dimColor>{modeText}. Takes effect in your next new session.</Text>
      <Text dimColor>{updateText}</Text>
      {s.hasBundle && <Text bold>! The all-mods bundle is installed. Installing a selection replaces it.</Text>}
      <Text> </Text>

      {mods.map((m: any) => (
        <Box key={`row-${m.id}`}>
          <Button key={`tog-${m.id}`} label={`${s.selected.includes(m.id) ? '[x]' : '[ ]'} ${m.name}`} onPress={() => miToggle($, m.id)} />
          <Button key={`pre-${m.id}`} label="Preview" plain onPress={() => miPatch($, { focus: m.id })} />
          <Text dimColor> {m.summary}</Text>
        </Box>
      ))}
      <Text> </Text>

      {focus && (
        <Box flexDirection="column">
          <Text bold>Preview: {focus.name}</Text>
          <Text dimColor>{focus.where}</Text>
          {focus.preview.map((l: any, i: number) => (
            <Text key={`pv-${focus.id}-${i}`} dimColor={l.dim === true}>
              {'  '}
              {l.text}
              {l.buttons ? '  ' + l.buttons.map((b: string) => `[${b}]`).join(' ') : ''}
            </Text>
          ))}
          <Text dimColor>Tokens: {focus.cost}</Text>
          <Text dimColor>Needs: {focus.needs}</Text>
        </Box>
      )}
      <Text> </Text>

      {s.phase === 'edit' ? (
        <Box>
          <Button key="all" label="Select all" onPress={() => miPatch($, { selected: s.catalog.mods.map((m: any) => m.id), msg: '' })} />
          <Button key="none" label="Select none" onPress={() => miPatch($, { selected: [], msg: '' })} />
          <Button key="install" label={`Install selected (${s.selected.length})`} variant="primary" onPress={() => miReview($)} />
          {s.ctx.mode === 'folder' && <Button key="update" label="Update mods now" onPress={() => miUpdate($)} />}
        </Box>
      ) : (
        <Box flexDirection="column">
          {s.plan.map((line: string, i: number) => (
            <Text key={`plan-${i}`}>{line}</Text>
          ))}
          <Box>
            <Button key="confirm" label="Confirm install" variant="primary" onPress={() => miInstall($)} />
            <Button key="cancel" label="Cancel" onPress={() => miPatch($, { phase: 'edit', plan: [] })} />
          </Box>
        </Box>
      )}

      {s.msg && <Text bold={s.msg.startsWith('Could not')}>{s.msg}</Text>}
      {s.snippet && <Button key="copy" label="Copy new settings.json" onPress={() => $.ui.copy({ text: s.snippet, surface: e.surface })} />}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', miSessionStart)
  on('command.run', { command: 'mods' }, miCommandMods)
  on('ui.render', { component: 'Pane', requestId: PANE }, miRenderPane)
}
