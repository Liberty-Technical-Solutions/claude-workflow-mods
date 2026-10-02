#!/usr/bin/env bash
# macOS/Linux setup: points Claude Code at the mods in this folder via ~/.claude/settings.json.
# Usage:  ./setup.sh               # install the all-mods bundle (all six mods)
#         ./setup.sh --installer   # install only the /mods installer, then pick mods inside Claude
#         ./setup.sh --individual  # install the six mods as separate plugins instead
#         ./setup.sh --remove      # uninstall
# Do not mix the bundle with the individual mods: every mod would load twice.
set -euo pipefail
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak-before-mods"

python3 - "$HERE/plugins" "$SETTINGS" "${1:-}" <<'PY'
import json, os, sys
plugins, settings, flag = sys.argv[1], sys.argv[2], sys.argv[3]
if flag == "--installer":
    names = ["mod-installer"]
elif flag == "--individual":
    names = sorted(d for d in os.listdir(plugins) if os.path.isdir(os.path.join(plugins, d)) and d not in ("all-mods", "mod-installer"))
else:
    names = ["all-mods"]
data = json.load(open(settings)) if os.path.exists(settings) else {}
env = data.setdefault("env", {})
keep = [p for p in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(os.pathsep) if p and not p.startswith(plugins)]
ours = [] if flag == "--remove" else [os.path.join(plugins, n) for n in names]
env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(keep + ours)
json.dump(data, open(settings, "w"), indent=2)
print("Removed." if flag == "--remove" else f"Installed {len(names)} mods: {', '.join(names)}.", "Start a new Claude Code session.")
PY
