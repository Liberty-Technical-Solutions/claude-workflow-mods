// Pure logic for the installer: no $ in here, so it is unit-testable with `node --test`.

export type Mode = 'folder' | 'marketplace'

export type Ctx = {
  /** 'folder': the installer was loaded from a cloned pack, so mods are enabled by folder path.
   *  'marketplace': it came from the plugin marketplace, so mods are enabled by enabledPlugins. */
  mode: Mode
  packRoot: string // folder holding the mod folders (folder mode)
  marketplace: string
  repo: string
  ids: string[] // every installable mod in the catalog
  installerId: string
  bundleId: string
  sep: string // separator inside CLAUDE_CODE_PLUGIN_DIRS
}

export type Plan = { add: string[]; remove: string[]; replacesBundle: boolean }

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
export const pathSep = (home: string) => (/^[A-Za-z]:|\\/.test(home) ? ';' : ':')
export const parentDir = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
export const joinPath = (root: string, id: string) => root + (root.includes('\\') ? '\\' : '/') + id

const known = (c: Ctx, id: string) => c.ids.includes(id) || id === c.bundleId

/** Which catalog mods (and the bundle) the user's settings enable right now. */
export function detectInstalled(settings: any, c: Ctx): string[] {
  if (c.mode === 'folder') {
    const root = norm(c.packRoot) + '/'
    return String(settings?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '')
      .split(c.sep)
      .filter(Boolean)
      .map(norm)
      .filter(d => d.startsWith(root))
      .map(d => d.slice(root.length))
      .filter(id => known(c, id))
  }
  const enabled = settings?.enabledPlugins ?? {}
  const suffix = '@' + c.marketplace
  return Object.keys(enabled)
    .filter(k => enabled[k] === true && k.endsWith(suffix))
    .map(k => k.slice(0, -suffix.length))
    .filter(id => known(c, id))
}

export function buildPlan(installed: string[], selected: string[], c: Ctx): Plan {
  return {
    add: selected.filter(id => !installed.includes(id)),
    remove: installed.filter(id => id !== c.bundleId && !selected.includes(id)),
    replacesBundle: installed.includes(c.bundleId),
  }
}

/** Returns a new settings object with exactly `selected` (plus the installer itself) enabled. */
export function applySelection(settings: any, selected: string[], c: Ctx): any {
  const out = JSON.parse(JSON.stringify(settings ?? {}))

  if (c.mode === 'folder') {
    const root = norm(c.packRoot) + '/'
    const keep = String(out.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '')
      .split(c.sep)
      .filter(Boolean)
      .filter(d => !norm(d).startsWith(root)) // drop our own folders; keep anyone else's
    const ours = [c.installerId, ...selected].map(id => joinPath(c.packRoot, id))
    out.env = { ...(out.env ?? {}), CLAUDE_CODE_PLUGIN_DIRS: [...keep, ...ours].join(c.sep) }
    return out
  }

  const key = (id: string) => `${id}@${c.marketplace}`
  const enabled = { ...(out.enabledPlugins ?? {}) }
  for (const id of c.ids) {
    if (selected.includes(id)) enabled[key(id)] = true
    else delete enabled[key(id)]
  }
  delete enabled[key(c.bundleId)]
  enabled[key(c.installerId)] = true
  out.enabledPlugins = enabled
  out.extraKnownMarketplaces = { ...(out.extraKnownMarketplaces ?? {}) }
  if (!out.extraKnownMarketplaces[c.marketplace]) {
    out.extraKnownMarketplaces[c.marketplace] = { source: { source: 'github', repo: c.repo } }
  }
  return out
}
