export type PreviewLine = { text: string; buttons?: string[]; dim?: boolean }

export type CatalogMod = {
  id: string
  name: string
  summary: string
  where: string
  preview: PreviewLine[]
  cost: string
  needs: string
}

export type Catalog = { marketplace: string; repo: string; mods: CatalogMod[] }

export type InstallerCtx = {
  mode: 'folder' | 'marketplace'
  packRoot: string
  marketplace: string
  repo: string
  ids: string[]
  installerId: string
  bundleId: string
  sep: string
}

export type InstallerState = {
  catalog: Catalog | null
  ctx: InstallerCtx | null
  settingsPath: string
  installed: string[]
  selected: string[]
  focus: string | null
  phase: 'edit' | 'confirm'
  plan: string[]
  hasBundle: boolean
  /** Marketplace installs: is auto-update on for the marketplace entry (null = not added yet). */
  autoUpdate: boolean | null
  msg: string
  snippet: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mod-installer': { ui: InstallerState }
  }
}
