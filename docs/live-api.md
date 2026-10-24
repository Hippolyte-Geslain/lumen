# Lumen live data contract

Lumen runs in two modes, and every page must work in both:

- **Demo**: `npm run dev` in a plain browser. There is no `window.claude`, so the store uses the seeded demo data from
  `src/store.js`.
- **Live**: Lumen published as a claude.ai Artifact. `LIVE === true` (from `src/live/runtime.js`). The store starts
  empty and fills from the viewer's own connectors: Google Calendar, Gmail, Google Drive, and Claude Docs (create
  only). Lumen's own data lives in the Artifact database, under a private per-user subtree.

Import `LIVE` from `../live/runtime.js` (or `../live/index.js`) when a page needs to branch.

## Store (`src/store.js`): shape in live mode

Pages read the store synchronously and re-render on `subscribe(topic, fn)`. Nothing below is guaranteed to have
arrived on the first render, so empty arrays are normal. Show loading and empty states.

| field | source | shape |
|---|---|---|
| `state.me` | always `'me'` | member id of the viewer |
| `state.members` | Calendar attendees and Gmail senders | `{id (lower-case email, or 'me'), name, email, team (org guessed from the domain, or 'Personal'), role (domain), presence ('meeting' if in a meeting with me now, 'online' if they mailed in the last hour, else 'away'), tz, bot (no-reply/notification senders), meetings (count of shared meetings, 90 days), mails (count of inbox threads), lastSeen (ms)}`. `members[0]` is me: `{id:'me', name, email, emails[], tz}`. Use `collaborators()` from `src/live/people.js` for real people, sorted. |
| `state.events` | Google Calendar (all enabled calendars, about −95 to +100 days) | `{id ('<calendarId>\|<eventId>'), gid, calendarId, calendar (calendar name), title, start, end (ms), allDay, kind ('meeting'\|'personal'\|'focus'\|'ooo'\|'allday'\|'review'\|'deadline'), attendees (member ids, always includes 'me'), place ('video' \| location \| null), meetUrl, link (Google Calendar URL), description, rsvp ('accepted'\|'tentative'\|'declined'\|'needsAction'\|null), organizer (member id), attachments [{title,url}], recurring, projectId (null)}`. Declined events are hidden unless `settings.hideDeclined` is false. |
| `state.calendars` | Calendar | `{id, summary, description, tz, primary, resource, holidays}` |
| `state.threads` | Gmail, latest 40 inbox threads, refreshed every 2 min | `{id, subject, snippet, from (member id), fromEmail, at, count, unread, important, starred, inbox, category ('personal'\|'updates'\|'promotions'\|'social'\|'forums'), url (open in Gmail), lastMessageId}` |
| `state.unread` | Gmail | estimated count of unread inbox threads |
| `state.files` | Drive, 30 most recent files | `{id, title, mime, kind ('doc'\|'sheet'\|'slides'\|'pdf'\|'folder'\|'image'\|'video'\|'file'), url, owner (member id), modified, viewed, size}` |
| `state.notices` | derived | bell items: invitations awaiting an answer, meetings starting within 15 min, unread important mail |
| `state.tasks / projects / focus / activity / settings` | Artifact db (private) | same shapes as in demo mode. In live mode they start **empty**: the user creates their own. Projects can have `members` limited to `['me']` and `lead: 'me'`. |
| `state.live[source]` | sources `calendar`, `gmail`, `drive`, `workspace` | `{status: 'loading'\|'ok'\|'error'\|'off'\|'readonly', code, text (ready-made user copy), tone, fix, storedAt}` |
| `state.demo` | | `true` in demo mode |

Topics you can subscribe to: `members, projects, tasks, events, focus, activity, notices, settings, threads, files, calendars, live, *`.

New settings keys: `calendars` (null, or an array of enabled calendar ids), `blockFocusTime` (bool), `hideDeclined`
(bool). In live mode `name` and `role` override what the connectors know.

## Actions (`src/live/sources.js`)

All of these are async and reject with an McpError `{code, message}`. Wrap user actions in `liveAction(run, {busy, done,
server, ico, undo})` from `src/ui/overlays.js`, which shows the toasts and converts errors to copy.

- Calendar:
  - `createEvent({title, start, end, place, kind, attendees: [emails], description})`. `kind: 'focus'` creates a
    Google "Focus time" event.
  - `deleteEvent(event)`
  - `moveEvent(event, start, end)`
  - `rsvp(event, 'accepted'|'tentative'|'declined')`
  - `suggestTimes([emails], minutes)` returns Google's raw payload. Log it once before relying on its shape.
  - `searchEvents(q)`
  - `refreshEvents({fresh:true})`
- Gmail:
  - `searchMail(query, n)` uses Gmail query syntax and returns mapped threads.
  - `readThread(id)` returns `[{id, from, fromRaw, to, at, subject, body (plain text), attachments[]}]`.
  - `markRead(thread, read=true)`, `archive(thread)`, `unarchive(thread)`, `star(thread, on)`
  - `draft({to:[emails], subject, body, replyToMessageId})` creates a Gmail **draft**. Lumen never sends mail
    itself: tell the user the draft is waiting in Gmail.
- Drive:
  - `searchFiles(text, n)`
  - `starredFiles()`
  - `kindOfFile(mime)`
- Claude Docs: only creating a new doc is allowed:
  `call('Claude Docs', 'batch', {container:{kind:'project', create:{name, doc:{markdown}}}, batch:[]})`.
  Call it only from an explicit "Save as Doc" click. The payload may include `url`. Limits: `name` must be 1–200
  characters with no line breaks, and `markdown` under 32 KB.

AI (`src/live/ai.js`):

- `ask(prompt, {onText, signal, tier, cache})` streams Claude's answer.
- Prompt builders: `briefPrompt()`, `summarizePrompt(messages)`, `replyPrompt(messages, intent)`.
- `aiAvailable()` resolves false outside live mode, so hide AI controls then.
- `aiErrorText(err)` gives user copy.

## UI helpers

- `sourceNote(key)` (`src/ui/components.js`) returns a status strip to put at the top of a card that depends on a
  source; it is `''` when the source is OK. Its fix buttons are already wired globally.
- `sourceReady(key)` is true once data has arrived, or always in demo mode.
- `KIND` (`overlays.js`) holds labels for every event kind. CSS has `.kind--personal`, `.kind--ooo` and
  `.kind--allday`.
- `.skel` is a shimmering placeholder block. `.src-note` is the status strip style.
- Never embed real user data in source code. Never log message bodies.
