// Run:  node --test plugins/mod-installer/test/lib.check.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applySelection, buildPlan, detectInstalled, joinPath, norm, parentDir, pathSep } from '../hooks/lib.ts'

const ids = ['ship-it', 'cache-keeper', 'usage-guard']
const folder = {
  mode: 'folder' as const,
  packRoot: 'C:\\Users\\me\\pack\\plugins',
  marketplace: 'workflow-mods',
  repo: 'org/repo',
  ids,
  installerId: 'mod-installer',
  bundleId: 'all-mods',
  sep: ';',
}
const market = { ...folder, mode: 'marketplace' as const }

test('path helpers', () => {
  assert.equal(pathSep('C:\\Users\\me'), ';')
  assert.equal(pathSep('/home/me'), ':')
  assert.equal(parentDir('C:\\a\\pack\\plugins\\mod-installer'), 'C:\\a\\pack\\plugins')
  assert.equal(joinPath('C:\\a\\plugins', 'x'), 'C:\\a\\plugins\\x')
  assert.equal(joinPath('/a/plugins', 'x'), '/a/plugins/x')
  assert.equal(norm('C:\\A\\B\\'), 'c:/a/b')
})

test('folder mode: detects installed mods and ignores other folders', () => {
  const s = { env: { CLAUDE_CODE_PLUGIN_DIRS: 'C:\\other\\p;C:\\Users\\me\\pack\\plugins\\ship-it;C:\\Users\\me\\pack\\plugins\\mod-installer;C:\\Users\\me\\pack\\plugins\\all-mods' } }
  assert.deepEqual(detectInstalled(s, folder), ['ship-it', 'all-mods'])
})

test('folder mode: apply keeps foreign folders, replaces ours, keeps other settings', () => {
  const s = { hooks: { keep: 1 }, env: { OTHER: 'x', CLAUDE_CODE_PLUGIN_DIRS: 'C:\\other\\p;C:\\Users\\me\\pack\\plugins\\all-mods' } }
  const out = applySelection(s, ['cache-keeper', 'ship-it'], folder)
  assert.equal(
    out.env.CLAUDE_CODE_PLUGIN_DIRS,
    'C:\\other\\p;C:\\Users\\me\\pack\\plugins\\mod-installer;C:\\Users\\me\\pack\\plugins\\cache-keeper;C:\\Users\\me\\pack\\plugins\\ship-it',
  )
  assert.equal(out.env.OTHER, 'x')
  assert.deepEqual(out.hooks, { keep: 1 })
  assert.equal(s.env.CLAUDE_CODE_PLUGIN_DIRS, 'C:\\other\\p;C:\\Users\\me\\pack\\plugins\\all-mods', 'input not mutated')
})

test('folder mode: empty selection leaves only the installer', () => {
  const out = applySelection({}, [], folder)
  assert.equal(out.env.CLAUDE_CODE_PLUGIN_DIRS, 'C:\\Users\\me\\pack\\plugins\\mod-installer')
})

test('marketplace mode: detect and apply', () => {
  const s = {
    enabledPlugins: { 'ship-it@workflow-mods': true, 'x@other': true, 'all-mods@workflow-mods': true, 'usage-guard@workflow-mods': false },
  }
  assert.deepEqual(detectInstalled(s, market), ['ship-it', 'all-mods'])
  const out = applySelection(s, ['cache-keeper'], market)
  // unselected catalog mods are removed (even a stale "false"); other marketplaces are untouched
  assert.deepEqual(out.enabledPlugins, { 'x@other': true, 'cache-keeper@workflow-mods': true, 'mod-installer@workflow-mods': true })
  assert.deepEqual(out.extraKnownMarketplaces['workflow-mods'], { source: { source: 'github', repo: 'org/repo' }, autoUpdate: true })
})

test('marketplace mode: existing entry is kept; autoUpdate is added unless the person set it', () => {
  const s = { extraKnownMarketplaces: { 'workflow-mods': { source: { source: 'git', url: 'u' } } } }
  assert.deepEqual(applySelection(s, [], market).extraKnownMarketplaces['workflow-mods'], { source: { source: 'git', url: 'u' }, autoUpdate: true })
  const off = { extraKnownMarketplaces: { 'workflow-mods': { source: { source: 'git', url: 'u' }, autoUpdate: false } } }
  assert.equal(applySelection(off, [], market).extraKnownMarketplaces['workflow-mods'].autoUpdate, false)
})

test('plan', () => {
  const plan = buildPlan(['ship-it', 'all-mods'], ['ship-it', 'cache-keeper'], folder)
  assert.deepEqual(plan, { add: ['cache-keeper'], remove: [], replacesBundle: true })
  assert.deepEqual(buildPlan(['ship-it', 'usage-guard'], ['ship-it'], folder), { add: [], remove: ['usage-guard'], replacesBundle: false })
})
