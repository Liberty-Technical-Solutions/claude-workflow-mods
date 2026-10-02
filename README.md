# Claude Code workflow mods

Small mods for Claude Code (early-access "function hook" plugins): bands above the prompt, a status-line entry, a `/where` command and one prompt rewrite. None of them contain secrets or account data.

## Install: pick what you want (recommended)

In Claude Code:

```
/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods
/plugin install mod-installer@workflow-mods
```

Start a new session, then type **`/mods`**. A pane lists every mod with a toggle (`[x]` / `[ ]`), a preview of what it shows on screen, what it costs in tokens and what it needs. Tick the ones you want and press **Install selected**. It shows exactly what it will change in your `settings.json` (and saves a backup) before you confirm. Run `/mods` again any time to add or remove mods; new mods added to this repo show up in the list.

Mods load when a session starts, so the choice takes effect in your **next new session**.

**Rolling this out to a team, and how updates reach people: see [TEAM-SETUP.md](TEAM-SETUP.md)** (a copy-paste message for teammates, a zero-step settings file, and the update steps).

> Marketplace loading of function-hook mods is still unverified on our side. If `/mods` is missing after a new session starts, use the setup script below.

## Install: everything, no choices

```
/plugin install all-mods@workflow-mods
```

To prompt a whole team automatically, commit this to a repo's `.claude/settings.json` (or `~/.claude/settings.json` for everywhere):

```json
{
  "extraKnownMarketplaces": {
    "workflow-mods": { "source": { "source": "github", "repo": "Liberty-Technical-Solutions/claude-workflow-mods" } }
  },
  "enabledPlugins": { "mod-installer@workflow-mods": true }
}
```
(Use `"all-mods@workflow-mods": true` instead to give everyone every mod.)

## Install without the marketplace

Clone this repo, then:

```powershell
.\setup.ps1 -Installer   # Windows: installs the /mods installer, then pick mods inside Claude
.\setup.ps1              # Windows: installs the all-mods bundle
```
```bash
./setup.sh --installer   # macOS/Linux: the /mods installer
./setup.sh               # macOS/Linux: the all-mods bundle
```
The scripts edit `~/.claude/settings.json` (backup: `settings.json.bak-before-mods`), keep your other plugin folders, and accept `-Remove` / `--remove` to undo. `-Individual` / `--individual` installs the mods as separate plugins. Paths are absolute, so re-run the script if you move the folder.

**Use the installer, the bundle, OR individual mods, never a mix**, or mods load twice. The installer replaces a bundle install when you apply a selection.

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

- The installer writes `~/.claude/settings.json`. If Claude blocks that write, it shows a **Copy new settings.json** button so you can paste it yourself.
- `ship-it` relies on the repo documenting its deploy steps; if none exist it tells Claude to stop and ask.
- `where-are-we` runs `git fetch` and probes a few localhost ports at session start.
- `cache-keeper` assumes a 60-minute cache lifetime; use its **Cache lifetime** button to switch to 5m if your plan differs. Auto is off by default.
- `usage-guard` can warn and block but cannot show a confirm dialog.
- If a mod fails to load, the session transcript shows a dim line naming the hook and the reason (`claude --debug` has more).

## Adding a mod (maintainers)

1. Create `plugins/<name>/` as a plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, optional `types/index.d.ts`). Keep hooks as **top-level handler functions with names unique to the mod** (prefix them, e.g. `abcSessionStart`), and keep `register` to one `on(...)` line per hook. Validate with `claude plugin validate plugins/<name>`.
2. Add an entry to `plugins/mod-installer/catalog.json`: `id`, `name`, `summary`, `where` (what it looks like), `preview` (sample lines, optional `buttons` and `dim`), `cost`, `needs`.
3. Run `.\build-bundle.ps1`. It regenerates `plugins/all-mods` and `.claude-plugin/marketplace.json` from the catalog, and fails if two mods declare the same top-level name.
4. Commit and push. Everyone sees the new mod next time they run `/mods`.

`plugins/mod-installer/hooks/lib.ts` holds the settings-editing logic. Tests: `node --test plugins/mod-installer/test/lib.check.ts` (Node 22+) for the logic, and `claude plugin test plugins/mod-installer` for the `/mods` pane itself (it runs against an in-memory disk, never your settings).
