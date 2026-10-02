# Windows setup: points Claude Code at the mods in this folder via ~/.claude/settings.json.
# Usage (PowerShell):  .\setup.ps1            # install
#                      .\setup.ps1 -Remove    # uninstall
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$plugins = Join-Path $PSScriptRoot 'plugins'
$names = Get-ChildItem $plugins -Directory | Select-Object -ExpandProperty Name
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'

New-Item -ItemType Directory -Force (Split-Path $settings) | Out-Null
if (Test-Path $settings) {
  Copy-Item $settings "$settings.bak-before-mods" -Force
  $json = Get-Content $settings -Raw | ConvertFrom-Json
} else {
  $json = [pscustomobject]@{}
}
if (-not $json.PSObject.Properties['env']) { $json | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }

# Keep any other plugin folders the user already listed; replace only ours.
$ours = $names | ForEach-Object { Join-Path $plugins $_ }
$existing = @()
if ($json.env.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS']) {
  $existing = $json.env.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ -and ($_ -notlike "$plugins*") }
}
$value = if ($Remove) { $existing -join ';' } else { (@($existing) + $ours) -join ';' }

if ($json.env.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS']) { $json.env.CLAUDE_CODE_PLUGIN_DIRS = $value }
else { $json.env | Add-Member -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue $value }

$json | ConvertTo-Json -Depth 20 | Set-Content $settings -Encoding utf8
Write-Host ($(if ($Remove) { 'Removed.' } else { "Installed $($names.Count) mods: $($names -join ', ')." }) + " Start a new Claude Code session. Backup: $settings.bak-before-mods")
