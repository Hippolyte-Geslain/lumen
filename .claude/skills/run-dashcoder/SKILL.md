---
name: run-dashcoder
description: Run, start, test and screenshot Lumen (dashCoder) — the vite page plus the local Node core (SQLite, AI, agents, automations). Use when asked to run the app, smoke test it, take a screenshot, or confirm a change works in the real app on Windows.
---

# Run Lumen (dashCoder)

Lumen is a vanilla-JS vite page plus a Node sidecar (`core/`) it talks to over WebSocket JSON-RPC. The agent path is one driver that starts both, drives the page in headless Chrome with Playwright, prints PASS/FAIL lines, writes screenshots and stops both processes. Paths are relative to the repo root.

## Prerequisites (Windows, verified)
- Node 22 (`node:sqlite`), Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (override with `CHROME=`).
- `npm install` then `npm i --no-save playwright-core` (not in package.json on purpose).
- `--agent` needs the `claude` CLI logged in.

## Run (agent path)
```bash
node .claude/skills/run-dashcoder/driver.mjs            # ~25 s, free
node .claude/skills/run-dashcoder/driver.mjs --agent    # also runs a real Claude Code session (~$0.10, ~1 min)
```
Exit code 1 if any line is FAIL. Screenshots (`settings.png`, `board.png`) land in `%TEMP%/lumen-run` (or `OUT=`). Open them: a blank frame is a failure.

It checks: core connection, every Settings section, AI providers, backup, update, `host:lumen` folders, adding/rejecting automation rules in the UI, a rule firing when a card moves to Done, optionally an agent run.

## Run (human path)
`node core/index.js` prints `LUMEN_CORE_READY {"port":…,"token":…}`; `npx vite`; open `http://localhost:5173/?core_port=<port>&core_token=<token>`. Without those params the page runs on demo data with no core.

## Test
`npm test` (vitest, page + core) and `npx vite build`.

## Gotchas
- Core env: `LUMEN_DATA_DIR`, `LUMEN_CORE_PORT`, `LUMEN_CORE_TOKEN`, `LUMEN_CODING_ROOT`. Set the last to a temp dir or agent runs create folders under `~/coding/perso`.
- Fixed ports 47811/5173; a leftover core or vite makes the driver fail on `--strictPort`.
- Stop processes with `taskkill /F /T` — `npx` spawns vite as a grandchild.
- The Bash tool collapses backslashes in heredocs; write files with an editor tool, not `cat <<EOF`, when they contain regexes.
- Not covered: Google OAuth, ClickUp/Notion imports, drag-and-drop, the Tauri window (no Rust here).

## Troubleshooting
- `Cannot find package 'playwright-core'` → `npm i --no-save playwright-core`.
- `timeout waiting for …:5173` → port busy; kill the old vite.
- `FAIL agent run done` → `claude` not logged in, or air-gapped sovereignty mode in the data dir.
