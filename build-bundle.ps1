# Regenerates plugins/all-mods and .claude-plugin/marketplace.json from plugins/mod-installer/catalog.json.
# Run after editing any mod in plugins/<name> or the catalog:   .\build-bundle.ps1
# The catalog is the single list of mods; plugins/all-mods and marketplace.json are generated: do not edit by hand.
#
# Why one merged file: the plugin loader only lets $ flow into functions declared in the SAME file, and
# a plugin may register each event once. So every mod keeps its hooks as top-level handler functions with
# names unique to the mod, and this script concatenates them and registers each event once, running the
# mods' handlers in order, each one's next() being the next handler (then the engine's).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$catalog = Get-Content (Join-Path $root 'plugins\mod-installer\catalog.json') -Raw | ConvertFrom-Json
$mods = @($catalog.mods | ForEach-Object { $_.id })
$out = Join-Path $root 'plugins\all-mods'

foreach ($d in '.claude-plugin', 'hooks', 'types') { New-Item -ItemType Directory -Force (Join-Path $out $d) | Out-Null }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save($path, $text) { [System.IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), $utf8) }

$bodies = @(); $typeBodies = @(); $stateKeys = @(); $typeNames = @(); $libImports = @()
$groups = [ordered]@{}   # "event|matcher" -> list of handler names, in mod order
$seen = @{}              # top-level name -> mod

foreach ($mod in $mods) {
  $file = Get-ChildItem (Join-Path $root "plugins\$mod\hooks") -Filter 'register.ts*' | Select-Object -First 1
  $text = [System.IO.File]::ReadAllText($file.FullName) -replace "`r`n", "`n"
  $cut = $text.IndexOf('export const register')
  if ($cut -lt 0) { throw "$mod has no 'export const register' block" }
  $body = $text.Substring(0, $cut)
  $reg = $text.Substring($cut)

  # Pure helper files (no $) are copied beside the bundle and imported under a per-mod name; every other import is dropped.
  $libFile = Join-Path $root "plugins\$mod\hooks\lib.ts"
  if (Test-Path $libFile) {
    Save (Join-Path $out "hooks\$mod-lib.ts") ("// GENERATED copy of plugins/$mod/hooks/lib.ts by build-bundle.ps1. Do not edit.`n" + [System.IO.File]::ReadAllText($libFile))
  }
  # Imports may span several lines. Keep the ones from ./lib (re-pointed at this mod's copy); drop all the others.
  $importPattern = "(?ms)^import\b.*?\bfrom\s+'([^']+)'[ \t]*;?[ \t]*(?:\n|\z)"
  foreach ($im in [regex]::Matches($body, $importPattern)) {
    if ($im.Groups[1].Value -eq './lib' -and (Test-Path $libFile)) { $libImports += $im.Value.TrimEnd().Replace("'./lib'", "'./$mod-lib'") }
  }
  $body = [regex]::Replace($body, $importPattern, '')
  $body = [regex]::Replace($body, "plugin: '$mod', key: '([^']+)'", "plugin: 'all-mods', key: '$mod.`$1'")

  foreach ($n in [regex]::Matches($body, '(?m)^(?:export )?(?:async )?(?:function|const|let|type) (\w+)')) {
    $name = $n.Groups[1].Value
    if ($seen.ContainsKey($name)) { throw "Top-level name '$name' is declared by both $($seen[$name]) and $mod. Rename one." }
    $seen[$name] = $mod
  }

  foreach ($m in [regex]::Matches($reg, "on\('([a-z.]+)'(?:,\s*(\{[^}]*\}))?,\s*(\w+)\)")) {
    $key = "$($m.Groups[1].Value)|$($m.Groups[2].Value)"
    if (-not $groups.Contains($key)) { $groups[$key] = New-Object System.Collections.ArrayList }
    [void]$groups[$key].Add($m.Groups[3].Value)
  }
  $bodies += "// ---- $mod ----`n" + $body.Trim()

  $typesFile = Join-Path $root "plugins\$mod\types\index.d.ts"
  if (Test-Path $typesFile) {
    $t = [System.IO.File]::ReadAllText($typesFile) -replace "`r`n", "`n"
    $typeBodies += $t.Substring(0, $t.IndexOf('declare module')).TrimEnd()
    foreach ($tn in [regex]::Matches($t, 'export type (\w+)')) { $typeNames += $tn.Groups[1].Value }
    # The mod's state keys: the text inside its  'mod': { ... }  block, one `key: type` per line or per ';'.
    $open = $t.IndexOf("'$mod': {")
    if ($open -ge 0) {
      $i = $t.IndexOf('{', $open); $depth = 0; $j = $i
      do { if ($t[$j] -eq '{') { $depth++ } elseif ($t[$j] -eq '}') { $depth-- }; $j++ } while ($depth -gt 0 -and $j -lt $t.Length)
      $inner = $t.Substring($i + 1, $j - $i - 2)
      foreach ($pair in ($inner -split "[;`n]")) {
        $pair = $pair.Trim()
        if ($pair -and $pair -notmatch '^(//|/\*|\*)') { $k, $v = $pair.Split(':', 2); $stateKeys += "    '$mod.$($k.Trim())': $($v.Trim())" }
      }
    }
  }
}

# expr(i, ev): handler i runs with a next() that continues to handler i+1; the last continues to the engine.
function Chain($handlers, $i, $ev) {
  if ($i -ge $handlers.Count) { return "next($ev)" }
  $nextEv = "e$($i + 1)"
  return "$($handlers[$i])(`$, $ev, ($nextEv) => $(Chain $handlers ($i + 1) $nextEv))"
}
$registrations = foreach ($k in $groups.Keys) {
  $event, $matcher = $k.Split('|', 2)
  $call = Chain @($groups[$k]) 0 'e'
  if ($matcher) { "  on('$event', $matcher, (`$, e, next) => $call)" } else { "  on('$event', (`$, e, next) => $call)" }
}

Save (Join-Path $out 'hooks\register.tsx') (@"
// GENERATED by build-bundle.ps1 from plugins/<mod>. Do not edit.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { $(($typeNames | Select-Object -Unique) -join ', ') } from '../types'
$($libImports -join "`n")

$($bodies -join "`n`n")

export const register: Register = on => {
$($registrations -join "`n")
}
"@)

Save (Join-Path $out 'types\index.d.ts') (@"
// GENERATED by build-bundle.ps1. Do not edit.
$($typeBodies -join "`n`n")

declare module 'claude-code' {
  interface PluginState {
    'all-mods': {
$($stateKeys -join ";`n");
    }
  }
}
"@)

Save (Join-Path $out 'hooks\hooks.json') '{ "modules": ["./register.tsx"] }'
Save (Join-Path $out '.claude-plugin\plugin.json') ('{ "name": "all-mods", "description": "All ' + $mods.Count + ' workflow mods in one install: ' + ($mods -join ', ') + '.", "types": "./types/index.d.ts" }')
Write-Host "Built plugins/all-mods from: $($mods -join ', ')"

# marketplace.json: the bundle, the installer, then every mod in the catalog.
$entries = @(
  [ordered]@{ name = 'mod-installer'; source = './plugins/mod-installer'; description = 'Start here: type /mods to preview the workflow mods, tick the ones you want and install them.' }
  [ordered]@{ name = 'all-mods'; source = './plugins/all-mods'; description = 'Everything in one install, no choices. Install this OR the individual mods, never both.' }
)
foreach ($m in $catalog.mods) { $entries += [ordered]@{ name = $m.id; source = "./plugins/$($m.id)"; description = $m.summary } }
$market = [ordered]@{
  name = $catalog.marketplace
  description = 'Small Claude Code mods for shipping, deploy verification, session status, usage limits and prompt-cache management.'
  owner = [ordered]@{ name = 'Liberty Technical Solutions' }
  plugins = $entries
}
Save (Join-Path $root '.claude-plugin\marketplace.json') (($market | ConvertTo-Json -Depth 6) + "`n")
Write-Host "Wrote marketplace.json with $($entries.Count) plugins."
