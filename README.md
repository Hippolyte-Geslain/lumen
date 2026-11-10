# Lumen

**A local-first desktop cockpit where your tasks can be handed to an AI agent, and your data stays on your machine.**

Lumen is a board, notes, inbox and calendar in one desktop app. What makes it different is what happens when a task is ready: one click hands it to a Claude Code agent that works in the background, in that project's folder, on its own git branch, while you keep working. The card shows a live status line. If the agent needs a decision, it asks on the card. When it's done, the task moves to *In review* with a summary, and the project remembers what was learned for next time.

Everything else runs locally: a Node core holds your data, secrets and connectors, and a bundled llama.cpp gives you a local model without installing anything.

> **Status:** advanced prototype. Windows installers build (unsigned). macOS and Linux are untested.

## Why

AI tools usually want your data in their cloud, and project tools usually want you to do the work yourself. Lumen tries the opposite on both counts: the agent does the work, and the data doesn't move.

## Highlights

- **Agents per task.** Each card can start a resumable Claude Code session in an isolated git worktree (`lumen/<task>` branch). Up to 3 run in parallel, the rest queue. Sessions end with a structured `SUMMARY / STATUS / QUESTION / MEMORY` block that Lumen turns into a comment, a question with buttons and project memory.
- **Sovereignty guard.** Every outgoing request goes through one function. Air-gapped mode blocks them all, local mode only allows an allow-list, and every call shows in a network log.
- **Secrets never leave the vault.** Encrypted with DPAPI on Windows (AES-256-GCM elsewhere) and never returned over RPC. Claude Code uses your own CLI login: Lumen never sees those credentials.
- **Bundled llama.cpp.** Downloads `llama-server` and a GGUF model on request only, checks both against their published SHA-256, then runs on `127.0.0.1`. Tested with Llama 3.2 1B: first reply in about 150 ms.
- **Connectors.** Google (Gmail drafts, Calendar), GitHub, GitLab, ClickUp and Notion boards, and MCP.
- **Notes with full-text search** (SQLite FTS5), attachments, backups that exclude secrets.

## Architecture

```text
┌─────────────────────────┐   WebSocket JSON-RPC    ┌────────────────────────────────┐
│  Page (Vite, vanilla JS │ ◄────── 127.0.0.1 ─────►│  Core (Node sidecar)           │
│  + GSAP)                │      port + token        │  SQLite · secrets vault        │
└────────────▲────────────┘                          │  AI routing · llama.cpp        │
             │ starts                                │  connectors · sovereignty guard│
┌────────────┴────────────┐                          └───────────────┬────────────────┘
│  Tauri shell (Rust)     │                                          │ MCP
│  NSIS / MSI installers  │                          ┌───────────────▼────────────────┐
└─────────────────────────┘                          │  Lumen bridge → Claude Code    │
                                                     │  one worktree per task         │
                                                     └────────────────────────────────┘
```

## Run it

```bash
npm install
npm run dev            # page only, with demo data
npm test               # page and core tests (Vitest)
```

```bash
npm run sidecar        # build the core sidecar
npm run tauri:dev      # the desktop app (needs Rust and the Tauri prerequisites)
npm run tauri:build    # NSIS and MSI installers
```

More detail: [docs/desktop.md](docs/desktop.md) (core modules, privacy rules, backups, llama.cpp) and [docs/sessions.md](docs/sessions.md) (how agent sessions work).

## Stack

Tauri (Rust) · Node · SQLite · Vite · vanilla JS · GSAP · llama.cpp · Claude Code · MCP · Vitest

---

Built by [Hippolyte Geslain](https://github.com/Hippolyte-Geslain).
