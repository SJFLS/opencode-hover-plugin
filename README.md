# opencode-hover-plugin

> Bring back the session **hover message preview** that was removed from the official [OpenCode](https://opencode.ai) desktop app — **without modifying or recompiling the app**.

[简体中文说明](./README.zh-CN.md)

Hover over a session in the left sidebar → a popover lists **all the messages you sent** in that session → click one → it navigates to that session and scrolls to that exact message.

The official app used to ship this (the `SessionHoverPreview` + `MessageNav` components). It was removed in PR #20708 ("better subagent experience", 2026-04-07) when the sidebar was refactored. This plugin re-implements it via **runtime injection** (Chrome DevTools Protocol), touching none of the app's files and keeping its signature intact.

> macOS only. Verified on the official desktop app **1.15.x**.

---

## Features

- **Hover preview** — hover a session for 0.5s, get a popover with every user message in that session.
- **Click to jump** — click any message to navigate + scroll to it (reuses the app's own hash-scroll, which reveals items inside the virtual list).
- **Theme-aware** — popover colors follow OpenCode's own theme (`<html data-color-scheme>`), i.e. **Settings → Appearance → Color scheme**, *not* the macOS system appearance (they can differ). Updates live via `MutationObserver`.
- **Zero install footprint** — no app patching, no npm packages. The helper uses only bun built-ins (`WebSocket`, `fetch`, `bun:sqlite`).
- **Self-cleaning** — when OpenCode quits, the helper detects the port is gone and exits on its own.

---

## Requirements

| Requirement | Why | Get it |
|---|---|---|
| **macOS** | Uses `osascript`, `open -a`, etc. | — |
| **Official OpenCode.app** | The injection target | Default path `/Applications/OpenCode.app` |
| **bun** | Runs `hover-helper.js` (CDP client + `bun:sqlite`) | `curl -fsSL https://bun.sh/install \| bash` |
| bash / curl / osascript / pgrep / pkill | Used by the launcher script | Built into macOS |
| Keysmith / Raycast / Alfred *(optional)* | Bind a global hotkey to the launcher | Any of them, or just run the script in a terminal |

No `npm install` needed.

---

## Install

```bash
# 1) install bun (the only thing you need to install)
curl -fsSL https://bun.sh/install | bash

# 2) put this folder here (clone or copy)
mkdir -p ~/.local/share/opencode
git clone https://github.com/SJFLS/opencode-hover-plugin.git ~/.local/share/opencode/hover-plugin

# 3) make the launcher executable
chmod +x ~/.local/share/opencode/hover-plugin/start-opencode-hover.command
```

> You can put the folder elsewhere (the scripts self-locate), but the docs assume `~/.local/share/opencode/hover-plugin/`.

If OpenCode is not in `/Applications`, edit the `APP=` line in `start-opencode-hover.command`.

---

## Usage

> **Key constraint:** CDP injection requires OpenCode to be started **with a remote debugging port**. An instance launched normally (double-clicking the Dock icon) has no port and **cannot be injected** — this is an Electron limitation; the port can only be added via a command-line flag at launch. So always start OpenCode through the launcher below.

**Option A — run it in a terminal** (good for first verification)

```bash
bash ~/.local/share/opencode/hover-plugin/start-opencode-hover.command
```

**Option B — global hotkey** (recommended; silent, no terminal window)

In Keysmith / Raycast / Alfred, create a **Run AppleScript** action with a single line:

```applescript
do shell script "nohup bash $HOME/.local/share/opencode/hover-plugin/start-opencode-hover.command >/tmp/opencode-hover.log 2>&1 &"
```

Bind a global shortcut (e.g. `⌃⌥⌘O`). The first run may prompt for Automation permission → allow it.

Either way, the launcher will:
1. Stop any existing helper (only one instance globally).
2. If OpenCode is running **without** a debug port → quit it.
3. (Re)launch OpenCode with debug port `9222` (skipped if it already has one).
4. Wait for the port, then inject the script and attach the helper.

Then hover a session in the left sidebar for ~0.5s — the popover appears.

**Stopping:** nothing to do. When you quit OpenCode the helper auto-exits within ~5s, leaving no stray processes. (Manual: `pkill -f hover-helper.js`.)

---

## Files

| File | Role | Required |
|---|---|---|
| `start-opencode-hover.command` | Launcher: stop old helper → start OpenCode with debug port → attach helper | ✅ |
| `hover-helper.js` | CDP helper (bun): injects the script, reads `opencode.db`, feeds data back to the renderer, auto-stops on quit | ✅ |
| `inject.js` | Front-end script injected into the renderer: hover detection, popover UI, theme adaptation, click-to-jump | ✅ |
| `launch-hover.applescript` | Reference one-liner for hotkey tools | optional |
| `README.md` / `README.zh-CN.md` | Docs | — |

Runtime log: `/tmp/opencode-hover.log`.

---

## How it works

```
┌─────────────────────────────┐      CDP (ws://127.0.0.1:9222)      ┌────────────────────┐
│  OpenCode (Electron)        │  ◀───────────────────────────────▶  │  hover-helper.js   │
│  renderer (oc://renderer)   │                                     │  (bun process)     │
│                             │   ① inject inject.js                │                    │
│  inject.js:                 │   ② hover → call binding            │  read opencode.db  │
│   - watch [data-session-id] │ ────────────────────────────────▶   │  user messages     │
│   - show popover            │   ③ write result to shared DOM attr │                    │
│   - click → #message-<id>   │ ◀────────────────────────────────   │  self-stop on quit │
└─────────────────────────────┘                                     └────────────────────┘
```

1. **Launch** — OpenCode starts with `--remote-debugging-port=9222`, exposing the Chrome DevTools Protocol (CDP).
2. **Inject** — `hover-helper.js` injects `inject.js` into the renderer's main world over CDP and registers a binding `__opencodeHoverBinding`; it re-injects on full page reloads.
3. **Request** — on hover, `inject.js` calls the binding with the session ID.
4. **Read DB** — the helper read-only-queries `~/.local/share/opencode/opencode.db` for all `role=user` message texts in that session (excluding synthetic/ignored).
5. **Feed back** — the helper writes the result (base64) onto a `document.documentElement` attribute; `inject.js` polls it and renders the popover.
6. **Jump** — clicking a message builds a `/<slug>/session/<id>#message-<msgId>` link and clicks it, letting the app's own `useSessionHashScroll` reveal + scroll to it.
7. **Self-stop** — after the port has been seen, if it goes missing 3 times in a row (~4.5s), the helper assumes OpenCode quit and exits.

### Why data travels via "shared DOM" instead of `window`
With Electron `contextIsolation`, the renderer has multiple JS worlds (main, isolated) that **share one DOM but have separate `window`s**. Writing results onto `window` failed because injection happened in world A but the write landed in world B. Storing data on a **shared DOM attribute** fixed it. The install lock (`data-ophv-installed`) is also a DOM attribute, so it installs exactly once across worlds.

### Why read the DB instead of an HTTP API
Reading `opencode.db` (read-only) avoids API auth / CORS / instance-routing uncertainties. Sessions/messages/parts live in the `session` / `message` / `part` tables; user text comes from `type=text` parts in `part.data`.

### How theme (dark/light) adaptation works
**It reads OpenCode's own theme, not the system appearance.** OpenCode's color scheme is an in-app setting that can differ from macOS appearance (e.g. system light, OpenCode dark), so `prefers-color-scheme` is unreliable. The app marks its theme on `<html>`:

```html
<html data-theme="oc-2" data-color-scheme="dark"> ... </html>
```

`inject.js`:
1. **Reads** `data-color-scheme` (`dark`/`light`) and mirrors it onto its own attribute `data-ophv-scheme` (falling back to `prefers-color-scheme` only if absent).
2. **Styles** the popover with CSS variables (`--ophv-bg`, `--ophv-fg`, …) provided by two selector blocks `:root[data-ophv-scheme="dark"|"light"] .ophv-card{…}`, plus a dark default fallback.
3. **Follows live** via a `MutationObserver` on `<html>`'s `data-color-scheme` / `data-theme`, so toggling the theme recolors the popover instantly.

---

## Customize (`inject.js`)

Edit, then restart the helper + reload the renderer to take effect (easiest: quit OpenCode so the helper self-stops, then relaunch).

| Want to change | Where (`inject.js`) |
|---|---|
| Hover delay | `var SHOW_DELAY = 500;` (ms) |
| Popover size / font / radius | `.ophv-card{...}` |
| Dark colors | `:root[data-ophv-scheme="dark"] .ophv-card{ --ophv-bg / --ophv-fg / … }` |
| Light colors | `:root[data-ophv-scheme="light"] .ophv-card{ --ophv-bg / --ophv-fg / … }` |
| Max lines per item | `.ophv-item{ -webkit-line-clamp:3; }` |
| Per-message truncation | `hover-helper.js`: `r.text.length > 200 ? ...slice(0,200)...` |
| Port | launcher `PORT=9222`; helper defaults to 9222 (or env `OPENCODE_HOVER_PORT`) |
| Quit tolerance | `hover-helper.js`: `++misses >= 3` |

---

## Caveats

- Must be started via the launcher to get a debug port; a normally-launched instance can't be injected.
- It's an **add-on**: it patches nothing in `OpenCode.app` and keeps the official signature. It usually survives app updates — unless the app changes `data-session-id` / `data-message-id` / `data-color-scheme` / session routing / hash-scroll, in which case adjust the matching spot in "How it works".
- If the DB schema changes in a new release (e.g. `part`/`message` tables), update the SQL in `hover-helper.js`.
- Theme adaptation depends on `<html data-color-scheme>`; if that attribute is renamed, the popover falls back to system appearance — update `applyTheme()` accordingly.
- Verified only on macOS + official desktop **1.15.x**.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing happens / no popover | Is there `[helper] attached` in `/tmp/opencode-hover.log`? Does `curl -s http://127.0.0.1:9222/json/version` respond? |
| Port never comes up | That build may disable remote debugging (the log says so); make sure you started via the launcher, not the Dock icon. |
| Popover shows but click doesn't jump | The app likely changed session routing or hash-scroll; check sidebar `<a href>` format and the `#message-<id>` anchor. |
| Popover is empty | That session may have no user text; or the DB schema changed — check the SQL in `hover-helper.js`. |
| Colors don't match the theme | The app may have renamed `data-color-scheme`; inspect `<html>` in DevTools and update `applyTheme()`. |
| Stop the helper manually | `pkill -f hover-helper.js` (rarely needed — quitting OpenCode auto-stops it). |

---

## License

[MIT](./LICENSE)

> Re-implemented from the pre-removal version (`SessionHoverPreview`, commit `5ea95451d`). Not affiliated with or endorsed by the OpenCode team.
