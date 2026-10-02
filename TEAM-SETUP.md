# Team setup and updates

## For team members (no technical knowledge needed)

The simplest route for someone brand new is [GETTING-STARTED.md](GETTING-STARTED.md) (download a ZIP, double-click Install-Mods, type /mods). If your Claude offers the `/plugin` commands, this also works. Paste these into Claude Code, one line at a time, pressing Enter after each:

```
/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods
```
```
/plugin install mod-installer@workflow-mods
```

Then close Claude Code and open a **new** session. You will see a short message: *"Workflow mods: type /mods to choose which ones to turn on."*

1. Type `/mods` and press Enter.
2. A list appears. Everything is ticked to start with. Click a mod's name to untick it, or **Preview** to see what it looks like.
3. Click **Install selected**, read the short summary, then click **Confirm install**.
4. Open one more new session. You're done.

To change your mind later, type `/mods` again.

### Message you can send to the team

> Hi all, we have a few add-ons for Claude Code that save time (a status strip, clickable next steps, deploy checklists, usage warnings). Takes about two minutes:
> 1. In Claude Code, paste `/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods` and press Enter.
> 2. Paste `/plugin install mod-installer@workflow-mods` and press Enter.
> 3. Close Claude Code and open a new session. Type `/mods`, leave everything ticked, click **Install selected**, then **Confirm install**.
> 4. Open one more new session. That's it. Reply here if anything looks off.

## For whoever manages the team: zero steps for everyone

Commit this file as `.claude/settings.json` in each project the team uses (or add it to your organization's managed settings, if you use them). Teammates then only accept the folder-trust prompt and type `/mods`; they never paste a command:

```json
{
  "extraKnownMarketplaces": {
    "workflow-mods": {
      "source": { "source": "github", "repo": "Liberty-Technical-Solutions/claude-workflow-mods" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "mod-installer@workflow-mods": true }
}
```

## Updating

**Shipping an update (you):** edit a mod, run `.\build-bundle.ps1`, then commit and push. There are no version numbers to bump: the mods carry no pinned `version`, so every push counts as a new version. (If you ever add a `version` to a plugin, people stay on the old copy until that number changes.)

**Receiving an update (everyone):**

| How they installed | What happens |
|---|---|
| Through the installer or the settings file above | Automatic. The installer turns on auto-update for the marketplace, so new versions install by themselves when Claude Code starts. Open a new session to use them. |
| Marketplace, but auto-update is off | In Claude Code: `/plugin`, then **Marketplaces**, choose **workflow-mods**, then **Enable auto-update** (or **Update marketplace** to update once). Pressing **Install selected** in `/mods` also turns it on. |
| Cloned folder (setup script) | Type `/mods` and click **Update mods now**. |

`/mods` always shows which of these applies to you on its "Updates:" line.

## Good to know

- Third-party marketplaces do not auto-update unless it is switched on; that is why the installer and the settings file above switch it on.
- Mods load when a session starts, so an install or update takes effect in the next new session.
- The installer edits `~/.claude/settings.json` and saves a backup next to it first. If Claude blocks that edit, it shows a **Copy new settings.json** button.
- Not yet confirmed in a live session: that a marketplace install loads these mods at runtime. Have one teammate try the steps above before you announce it to everyone.
