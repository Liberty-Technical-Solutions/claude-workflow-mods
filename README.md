# Claude Code workflow mods

Six small mods for Claude Code (early-access "function hook" plugins). They add bands above the prompt, a status-line entry, a `/where` command and one prompt rewrite. None of them contain secrets or account data.

## Quick install (everything, one step)

In Claude Code:

```
/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods
/plugin install all-mods@workflow-mods
```

Then start a **new** session. That is the whole install: `all-mods` loads all six mods.

**For a whole team, commit this to the repo's `.claude/settings.json`** (or put it in `~/.claude/settings.json` to apply everywhere). Teammates are then prompted to add the marketplace and enable the bundle the first time they open the repo:

```json
{
  "extraKnownMarketplaces": {
    "workflow-mods": { "source": { "source": "github", "repo": "Liberty-Technical-Solutions/claude-workflow-mods" } }
  },
  "enabledPlugins": { "all-mods@workflow-mods": true }
}
```

> Marketplace loading of function-hook mods is still unverified on our side. If `/where` is missing after a new session starts, use the setup script below instead.

**Without the marketplace** (clone this repo, then):

```powershell
.\setup.ps1              # Windows: installs the all-mods bundle
```
```bash
./setup.sh               # macOS/Linux: installs the all-mods bundle
```
The scripts edit `~/.claude/settings.json` (backup: `settings.json.bak-before-mods`), keep your other plugin folders, and accept `-Remove` / `--remove` to undo. Add `-Individual` / `--individual` to install the six mods as separate plugins instead. Paths are absolute, so re-run the script if you move the folder.

**Install the bundle OR the individual mods, never both**, or every mod loads twice.

## The mods

| Mod | What it does | Uses tokens? |
|---|---|---|
| `ship-it` | A bare "deploy it" / "ship it" / "merge it" gets the full commit-PR-merge-deploy-verify checklist attached (hidden context) | A few hundred extra tokens on those prompts only |
| `deploy-verifier` | After a push/merge/deploy command, shows CI status and whether the new version is live | No |
| `where-are-we` | Session-start band (branch, dirty files, PR, gh auth, dev servers). `/where` hands it to Claude | No (`/where` adds a few hundred) |
| `close-out-check` | After a code-changing turn, flags a stale CHANGELOG / version / HANDOFF; **Fix** button | No (Fix = one prompt) |
| `usage-guard` | Rate-limit usage in the status line; toast at 85%, blocks new agents at 97% | No |
| `cache-keeper` | Prompt-cache clock, **Refresh**, **Compress**, optional **Auto** keep-alive (8h idle cap, pauses when a newer session opens in the same folder) | Refresh/Auto read the cached context (~10% price); Compress is one summarizing call |

## Requirements

- A Claude Code build with function-hook mods enabled (`claude plugin validate` must understand the `hooks.json` `modules` form). An organization policy can disable this.
- `git` on PATH for `where-are-we`, `deploy-verifier`, `close-out-check`; the GitHub CLI (`gh`) for CI and PR status.

## Optional per-repo files (commit them with the repo)

- `.claude/deploy-verify.json`: `{ "healthUrl": "https://your-app/api/health", "versionField": "version", "versionFile": "package.json" }`. Without it `deploy-verifier` shows CI only.
- `.claude/where.json`: `{ "ports": [3000, 8347], "docs": ["HANDOFF.md"] }`.

## Things to know

- `ship-it` relies on the repo documenting its deploy steps; if none exist it tells Claude to stop and ask.
- `where-are-we` runs `git fetch` and probes a few localhost ports at session start.
- `cache-keeper` assumes a 60-minute cache lifetime; use its **Cache lifetime** button to switch to 5m if your plan differs. Auto is off by default.
- `usage-guard` can warn and block but cannot show a confirm dialog.
- If a mod fails to load, the session transcript shows a dim line naming the hook and the reason (`claude --debug` has more).

## Developing

Each mod in `plugins/<name>` is a standalone plugin. Its hooks are top-level handler functions with names unique to the mod, and its `register` only wires them up. **`plugins/all-mods` is generated**: after editing a mod, run `.\build-bundle.ps1` (it fails if two mods declare the same top-level name) and commit the result. Validate with `claude plugin validate plugins/<name>`.
