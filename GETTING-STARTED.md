# Getting started (no experience needed)

This adds a few helpful extras to Claude Code: a status bar for your usage, deploy checks, and more. Setup takes about five minutes. You only need a Windows PC with Claude already installed and signed in.

## Before you start

- Open Claude (the desktop app or Claude Code) once and make sure you are signed in.
- You do **not** need to know any commands. You do not need any other software to install the mods. (Some mods show Git and GitHub information; they simply stay quiet if you do not use those.)

## Step 1: Download

1. Go to **https://github.com/Liberty-Technical-Solutions/claude-workflow-mods**
2. Click the green **Code** button, then **Download ZIP**.

## Step 2: Put it somewhere permanent

1. Open your **Downloads** folder, right-click the ZIP and choose **Extract All...**
2. Change the folder to somewhere you will not move or delete, such as `C:\Users\YourName\Documents\claude-workflow-mods`, and click **Extract**.

> Do not leave it in Downloads and do not move it later. Claude loads the mods from this folder.

## Step 3: Install

1. Open the extracted folder and double-click **Install-Mods**.
2. If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**.
3. A black window opens. When it says *Installed 1 mods: mod-installer*, press any key to close it.

## Step 4: Restart Claude

1. **Close Claude completely** (right-click its icon in the taskbar or system tray and choose Quit if needed).
2. Open Claude again and start a **new** session.
3. You should briefly see: *"Workflow mods: type /mods to choose which ones to turn on."*

## Step 5: Choose your mods

1. In the message box, type **/mods** and press Enter.
2. A list opens. Everything starts ticked. Click a mod's name to tick or untick it. Click **Preview** next to a mod to see what it looks like, what it costs, and what it needs.
3. Click **Install selected**. Read the short summary, then click **Confirm install**.
4. Close Claude and open a new session once more. Your mods are now on.

Want to change your mind later? Type **/mods** again.

## Updating

- Whoever manages the mods will tell you when there is an update.
- Download the ZIP again (Step 1), extract it over the **same folder** (Step 2), choose **Replace**, then open a new session. Your choices are kept.
- If you set this up with Git instead of a ZIP, type **/mods** and click **Update mods now**.

## Removing everything

Double-click **Uninstall-Mods** in the same folder, then restart Claude.

## If something does not work

| What you see | What to do |
|---|---|
| `/mods` says it is not a command | You need to close Claude completely and open a **new** session after Step 3. If it still fails, double-click **Install-Mods** again, restart, and tell the person who sent you this. |
| The black window flashes and closes | Open it from a folder you extracted (not from inside the ZIP). Right-click the ZIP and choose Extract All first. |
| You moved or deleted the folder | Extract it again somewhere permanent and double-click **Install-Mods** again. |
| Nothing seems different | Mods only start in a **new** session. Some only show when relevant (for example, deploy checks appear after you push code). |

## Mac or Linux

Open Terminal in the extracted folder and run `./setup.sh --installer`, then restart Claude and type `/mods`.

## If you already use Claude's plugin commands

You can instead run `/plugin marketplace add Liberty-Technical-Solutions/claude-workflow-mods`, then `/plugin install mod-installer@workflow-mods`, and open a new session. (Not every Claude app offers `/plugin`, which is why the steps above avoid it.)
