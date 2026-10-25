# Lumen Desktop

Lumen Desktop is the board app plus a local core (`core/`, a Node sidecar) that holds data, secrets, AI routing and connectors.
The page talks to the core over a WebSocket JSON-RPC channel on 127.0.0.1; the Tauri shell (`src-tauri/`) starts the core and hands the page its port and token.

## Run it

- `npm run dev` — page only (demo data, no core).
- `node core/index.js` — the core on its own; the page connects when `window.__LUMEN_CORE__` is set (see `src/live/local.js`).
- `npm run sidecar` then `npm run tauri:dev` — the desktop app. Needs Rust and the Tauri prerequisites.
- `npm run tauri:build` — NSIS and MSI installers (unsigned until a certificate is configured).
- `npm test` — page and core tests.

## What lives where

| Area | Core module | Settings section |
| --- | --- | --- |
| Data | `core/store/db.js` (SQLite: `kv` documents, `cards` projection) | Data |
| Sovereignty, vault, network log | `core/net/guard.js`, `core/secrets.js` | Sovereignty |
| AI providers, usage meter | `core/ai.js` | AI models |
| Notes search (FTS5) | `core/notes.js` | Notes |
| Attachments | `core/attachments.js` | (card drawer) |
| Agents (Claude Code in a worktree per card) | `core/agents.js`, `core/hostlumen.js` | Projects, dock |
| Google | `core/google.js` | Google |
| GitHub, GitLab, ClickUp, Notion | `core/mcp.js`, `core/pm.js` | ClickUp & Notion |
| Backups, update check | `core/backup.js`, `core/update.js` | Data |

## Privacy rules the core enforces

- Every outbound request goes through `guard.fetch`; air-gapped mode blocks all of them, local mode only allows the allow-list.
- Secrets are stored encrypted (DPAPI on Windows) and never returned over RPC.
- Claude Code is driven through the user's own CLI login; Lumen never sees those credentials.
- Backups exclude secrets.

## Backups and updates

- Settings → Data → Back up now writes `backups/lumen-<time>.db` (SQLite copy) and `.json` (readable export) in the data folder, keeping the last 10. To restore, stop Lumen and replace `lumen.db`.
- Check for updates asks for an https feed URL once, then fetches `{ "version": "x.y.z", "url": "https://…" }` on demand only.
