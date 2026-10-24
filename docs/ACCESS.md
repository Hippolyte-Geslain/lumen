# Lumen: access requests

What Lumen can already reach through your claude.ai account, and what to request to use more of the dashboard.
Checked on 2026-10-19 against this account's connectors and the organization's connector directory.

## Connected today

| Connector | Status | What Lumen uses it for |
|---|---|---|
| **Google Calendar** (hippolyte.geslain.pro@laplateforme.io) | ✅ connected | Calendar page, "Up next", meeting insights, invitations (RSVP), creating and deleting events, focus blocks, free-slot search |
| **Gmail** (same Google account) | ✅ connected | Inbox page, unread badge, notifications, thread reading, AI summaries, **drafts** (Lumen never sends mail itself) |
| **Google Drive** (same account) | ✅ connected | Files page, recent and starred files, Drive search, files linked to projects |
| **Claude Docs** | ✅ connected | "Save as Doc" for the morning brief (a published page can only create new docs) |
| Claude (in the page) | ✅ via the Artifact `sample` capability | Morning brief, thread summaries, reply drafts |
| Lumen database | ✅ via the Artifact `db` capability | Your tasks, projects, focus log and preferences (private to you) |
| Stitch, scheduled tasks | connected, but not reachable from a published page | Stitch is a design tool. Scheduled tasks could send you a morning brief outside the dashboard. |

## Needed for Claude sessions (on your PC)

These are actions only you can take on your machine:

1. ✅ **Claude Code signed in.** Checked on 2026-10-19: a headless test answered.
2. ✅ **Lumen bridge registered and connected.** It appears as `lumen` in the desktop app, and all 3 spaces were
   found.
3. **Open Lumen inside the Claude desktop app** (not a browser tab) and allow the `lumen` server. Host servers only
   answer there, and only for the artifact's owner.
4. **Anatomy skill for Claude Code** *(optional)*: it's available in your claude.ai chats but not installed in
   `~/.claude/skills`, so headless design sessions may not see it.

## Requests, in order of value

### 1. A task manager connector *(unlocks: Tasks synced with your real to-do list)*
Today, Lumen's tasks live only in Lumen. Pick **one** of these:
- ✅ **ClickUp**: connected on 2026-10-19. The workspace is empty for now and Lumen doesn't sync with it yet.
- **Google Tasks**: not in the directory. Ask your claude.ai admin to add it, or add a custom connector if your plan allows it.
- **Todoist**, **Notion**, **Linear** or **Asana**: not in the directory. Admin request or custom connector.

> Request to admin: "Please add the *[Google Tasks / Notion / Linear]* connector to our claude.ai organization directory so I can sync my tasks with my Lumen dashboard."

### 2. Team chat (Slack / Google Chat / Discord) *(unlocks: mentions in notifications, People presence)*
None of these are in the directory. Ask your admin for **Slack** (or the chat your team uses). With it, the People page
could show real presence instead of what Lumen infers from meetings and mail.

### 3. GitHub or GitLab *(unlocks: a code-review card on Home, linking issues to projects)*
Available now as the official **github** plugin in the Anthropic plugin directory, so no admin request is needed. The
GitHub CLI on this PC is already signed in (as `Hippolyte-Geslain`), so Lumen's bridge could also read pull requests
and issues through `gh`.

### 4. Google Contacts / Directory *(unlocks: real names, photos and job titles on People)*
There is no connector for this today. Lumen guesses names from email addresses (`tanjona.ralaimihoatra@…` → "Tanjona
Ralaimihoatra"). Nothing to request yet, so watch the connector directory for it.

## Permissions to grant inside Lumen
The first time Lumen reads each connector, claude.ai asks you to allow it. Allow **Google Calendar**, **Gmail** and
**Google Drive**, and allow **Claude** for the AI features. You can change these later from the artifact's
**Permissions** menu, or with **Account menu → Connections & permissions** in Lumen.

## Deliberately out of scope
- **Sending email**: Lumen creates drafts only. You send them from Gmail.
- **Public sharing**: a page that uses your connectors can't be shared publicly, and stays private to your account.

## Meeting notes
MeetNotes is not allowed in this organization. Use what's already connected instead: notes docs attached to calendar
events, and Google Meet's "Take notes for me" (Gemini), which saves notes to Drive. Lumen can read both through the
Calendar and Drive connectors.
