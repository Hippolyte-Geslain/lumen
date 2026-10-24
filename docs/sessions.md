# Claude sessions in Lumen

## User story
> As I work through my board, any task that's ready can be handed to Claude with one click. Claude works in the
> background on my PC, in that project's folder, while I keep using the dashboard. I see a one-line live status
> on the card and in a sessions dock. If Claude needs a decision, it asks on the card and I answer there. When
> it's done, the task moves to *In review* with a summary, and the project remembers what was learned. Later I
> can pick up any project at any time: *Resume work* continues exactly where that task's session stopped.

## Decisions (agreed 2026-10-19)
| Topic | Choice |
|---|---|
| Runtime | Headless Claude Code on the user's PC, started by the local **Lumen bridge** (`bridge/lumen-bridge.mjs`). Lumen reaches it as the host MCP server `host:lumen`, which only works when Lumen is opened in the Claude desktop app. |
| Scope | **Project memory + task sessions.** Each task has its own resumable Claude Code session, primed with the project's memory (`project.memory`, up to 40 lines, grown from each session's `MEMORY:` lines). |
| Questions | Asked **on the task card** and in the dock, with option buttons and a free-text reply. Lumen sends the reply back with `--resume`. |
| Autonomy | **Full autonomy inside the project folder** (`--permission-mode bypassPermissions`). Code tasks work on a `lumen/<task>` branch and commit there. |
| Live view | One live line on the card, plus a **Sessions dock** on the right edge (a corner pill when collapsed). |
| Launch | **One click, plus an optional note.** The kind (code, system design, docs & research, email) is guessed and can be changed. |
| Finish | Task moves to **In review**, the summary is posted as a comment by *Claude*, and project memory is updated. |
| Eligible tasks | *To do* and *In progress*. *In review* shows *Resume work* only when a session exists. |
| Parallel runs | **Up to 3**; the rest queue (set `LUMEN_MAX_SESSIONS` to change this). |
| Folders | Space ∈ {`coding/perso`, `coding/labIa`, `coding/laplateforme`} plus a folder name. The folder is **created if missing**. |
| System design output | `docs/design/<task>.md` with Mermaid diagrams, plus an interactive isometric figure built with the **anatomy** skill, saved in `docs/design/figures/` and committed. |
| Email tasks | Claude writes the reply after `DRAFT:`. Lumen saves it as a **Gmail draft** with one click and never sends it. |

## Session protocol
The bridge appends a system prompt asking every session to end with:
```
SUMMARY: …            STATUS: done | blocked | needs-input
QUESTION: …           OPTIONS: a | b | c
MEMORY: …  (repeatable)
DRAFT: …   (email tasks, last)
```
Lumen shows `SUMMARY`, asks `QUESTION`, stores `MEMORY` in the project, and offers `DRAFT` as a Gmail draft.

## Pieces
- `bridge/lumen-bridge.mjs`: a zero-dependency MCP server. Tools: `bridge_info`, `list_folders`, `ensure_folder`,
  `start_session`, `answer`, `session_status`, `stop_session`, `open_terminal`. Runs are stored in
  `~/.lumen-bridge/runs.json`.
- `src/live/sessions.js`: prompt building, launch and resume, polling (every 3 s while busy, 20 s when idle), and
  reacting when a session finishes.
- `src/ui/dock.js`: the Sessions dock and its pill.
- Task cards, the task drawer, the project *Workspace* card and the Settings bridge row show and control sessions.

## Setup
1. `claude /login` in a terminal, because Claude Code's sign-in has expired on this PC.
2. Register the bridge in `%APPDATA%\Claude\claude_desktop_config.json`:
   ```json
   "mcpServers": { "lumen": { "command": "node", "args": ["C:/Users/Cycrustmine/coding/perso/dashCoder/bridge/lumen-bridge.mjs"] } }
   ```
   Then restart the Claude desktop app.
3. Open Lumen inside the Claude desktop app and allow the **lumen** server when asked.
4. Optional: install the anatomy skill for Claude Code (in `~/.claude/skills`), so headless system-design sessions can
   use it.
