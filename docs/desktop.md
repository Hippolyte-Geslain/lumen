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
| Bundled llama.cpp (download, run) | `core/llama.js` | Local model |
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

## Bundled llama.cpp

Settings → Local model downloads `llama-server` from the recent ggml-org/llama.cpp releases (the CPU build) and a GGUF model from Hugging Face into `<data>/llama/`, then runs it on `127.0.0.1:8080`. That is the address of the "llama.cpp server" provider in AI models, so pick that provider to use it.

- Nothing is fetched until you press a button, and only after you allow the download hosts (the UI offers a one-click allow; air-gapped mode blocks it entirely).
- Every hop, redirects included, goes through the sovereignty guard and shows in the network log. Redirects to non-https URLs are refused.
- `llama-server` is checked against the SHA-256 GitHub publishes for the asset; models against the hash Hugging Face advertises. A mismatch deletes the file.
- Verified on Windows x64 with Llama 3.2 1B: install 24 MB, model 808 MB, first reply in about 150 ms.
- GPU builds (Vulkan) are supported by `install({ variant: 'vulkan' })` but there is no UI switch yet. macOS and Linux asset names are matched but untested.
