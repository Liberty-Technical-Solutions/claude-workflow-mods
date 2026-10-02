# Claude Code workflow mods

Six small mods for Claude Code (early-access "function hook" plugins). They add bands above the prompt, a status-line entry, a `/where` command and one prompt rewrite. None of them contain secrets or account data.

| Mod | What it does | Uses tokens? |
|---|---|---|
| `ship-it` | A bare "deploy it" / "ship it" / "merge it" gets the full commit-PR-merge-deploy-verify checklist attached (hidden context) | A few hundred extra tokens on those prompts only |
| `deploy-verifier` | After a push/merge/deploy command, shows CI status and whether the new version is live | No |
| `where-are-we` | Session-start band (branch, dirty files, PR, gh auth, dev servers). `/where` hands it to Claude | No (`/where` adds a few hundred) |
| `close-out-check` | After a code-changing turn, flags a stale CHANGELOG / version / HANDOFF; **Fix** button | No (Fix = one prompt) |
| `usage-guard` | Rate-limit usage in the status line; toast at 85%, blocks new agents at 97% | No |
| `cache-keeper` | Prompt-cache clock, **Refresh**, **Compress**, optional **Auto** keep-alive (8h idle cap, pauses when a newer session opens in the same folder) | Refresh/Auto read the cached context (~10% price); Compress is one summarizing call |

## Requirements

- A Claude Code build with function-hook mods enabled (`claude plugin validate` must know the `hooks.json` `modules` form). An organization policy can disable this.
- `git` on PATH for `where-are-we`, `deploy-verifier`, `close-out-check`; the GitHub CLI (`gh`) for CI and PR status.

## Install (one of)

**A. Setup script** (edits `~/.claude/settings.json`, keeps a `.bak-before-mods` backup, keeps your other plugin folders):

```powershell
.\setup.ps1            # Windows; add -Remove to uninstall
```
```bash
./setup.sh             # macOS/Linux; add --remove to uninstall
```

**B. By hand.** Add to `~/.claude/settings.json`, using absolute paths on that machine, `;` separated on Windows and `:` on macOS/Linux:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-mods-pack/plugins/ship-it;/path/to/claude-mods-pack/plugins/cache-keeper" } }
```

**C. One session only:** `claude --plugin-dir ./plugins/ship-it --plugin-dir ./plugins/cache-keeper`

Then start a **new** session. Move the folder and re-run the script; the paths are absolute.

**D. Marketplace (for teams; install path not yet verified).** This repo is a Claude Code plugin marketplace named `workflow-mods`. In a Claude Code session:

```
/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods
/plugin install cache-keeper@workflow-mods
```
Repeat the second line for each mod you want (`ship-it`, `deploy-verifier`, `where-are-we`, `close-out-check`, `usage-guard`, `cache-keeper`), then start a new session. To have every teammate prompted automatically, add this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "workflow-mods": { "source": { "source": "github", "repo": "Liberty-Technical-Solutions/claude-workflow-mods" } }
  },
  "enabledPlugins": { "cache-keeper@workflow-mods": true, "where-are-we@workflow-mods": true }
}
```
Whether a marketplace install loads these function-hook mods (rather than only command-hook plugins) has not been verified. If a mod does not appear after install, use option A (the setup script) instead and open an issue.

## Optional per-repo files (commit them with the repo)

- `.claude/deploy-verify.json`: `{ "healthUrl": "https://your-app/api/health", "versionField": "version", "versionFile": "package.json" }`. Without it `deploy-verifier` shows CI only.
- `.claude/where.json`: `{ "ports": [3000, 8347], "docs": ["HANDOFF.md"] }`.

## Things to know

- `ship-it` relies on the repo documenting its deploy steps; if none exist it tells Claude to stop and ask.
- `where-are-we` runs `git fetch` and probes a few localhost ports at session start.
- `cache-keeper` assumes a 60-minute cache TTL; flip the **TTL** button to 5m if your plan differs. Auto is off by default.
- `usage-guard` can warn and block but cannot show a confirm dialog.
- If a mod fails to load, the session transcript shows a dim line naming the hook and the reason (`claude --debug` has more).
