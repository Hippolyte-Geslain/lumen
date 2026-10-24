// Calendar, Gmail and Drive → store. Each source keeps its own status in
// state.live[source] so one failing connector only greys out its own UI.

import { state, commit } from '../store.js';
import { SERVERS, call, watch, invalidate, explain, localIso, decodeEntities } from './runtime.js';
import { person, claimEmail, scorePeople, parseAddress } from './people.js';
import { startOfDay, addDays } from '../lib/dom.js';

const DAY = 86_400_000;

function setStatus(source, patch) {
  state.live[source] = { ...(state.live[source] || {}), ...patch };
  commit('live');
}
const fail = (source, server) => (err) => {
  const e = explain(err, server);
  setStatus(source, { status: 'error', code: err?.code, text: e.text, tone: e.tone, fix: e.fix });
  // Authorization problems retract data; transient ones keep the last good copy.
  if (['needs_reauth', 'server_not_connected', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'consent_required'].includes(err?.code)) {
    if (source === 'calendar') state.events = [];
    if (source === 'gmail') (state.threads = []), (state.unread = 0);
    if (source === 'drive') state.files = [];
    commit(source === 'calendar' ? 'events' : source === 'gmail' ? 'threads' : 'files');
  }
};

// ============================== Google Calendar ==============================
const RANGE = { from: () => addDays(startOfDay(), -95).getTime(), to: () => addDays(startOfDay(), 100).getTime() };
const perCalendar = new Map(); // calendarId → events[]
const watches = new Map(); // calendarId → unsubscribe

function kindOf(ev, attendees) {
  if (ev.eventType === 'FOCUS_TIME') return 'focus';
  if (ev.eventType === 'OUT_OF_OFFICE') return 'ooo';
  if (ev.start?.date) return 'allday';
  if (/deadline|due|échéance|rendu/i.test(ev.summary || '')) return 'deadline';
  if (/review|revue|démo|demo|retro/i.test(ev.summary || '')) return 'review';
  return attendees.length > 1 ? 'meeting' : 'personal';
}

function mapEvent(ev, cal) {
  const allDay = !!ev.start?.date;
  const start = allDay ? new Date(ev.start.date + 'T00:00:00').getTime() : Date.parse(ev.start?.dateTime);
  const end = allDay ? new Date(ev.end.date + 'T00:00:00').getTime() : Date.parse(ev.end?.dateTime);
  if (!start) return null;
  const self = (ev.attendees || []).find((a) => a.self);
  if (self?.email) claimEmail(self.email);
  const attendees = (ev.attendees || []).filter((a) => !a.resource).map((a) => (a.self ? 'me' : person(a.email, a.displayName))).filter(Boolean);
  if (!attendees.includes('me')) attendees.unshift('me');
  const meet = ev.conferenceUrl || ev.conferenceData?.videoEntryPoint?.uri || ev.hangoutLink || null;
  return {
    id: `${cal.id}|${ev.id}`, gid: ev.id, calendarId: cal.id, calendar: cal.summary, title: ev.summary || '(No title)',
    start, end: end || start + 30 * 60000, allDay, kind: kindOf(ev, attendees), attendees, projectId: null,
    place: meet ? 'video' : ev.location || null, meetUrl: meet, link: ev.htmlLink, description: ev.description || '',
    rsvp: self?.responseStatus || (ev.organizer?.self ? 'accepted' : null), organizer: ev.organizer?.email ? person(ev.organizer.email) : null,
    attachments: (ev.attachments || []).map((a) => ({ title: a.title, url: a.fileUrl })), recurring: !!ev.recurringEventId,
  };
}

function rebuildEvents() {
  const hide = state.settings.hideDeclined;
  state.events = [...perCalendar.values()].flat().filter((e) => !(hide && e.rsvp === 'declined')).sort((a, b) => a.start - b.start);
  scorePeople();
  buildNotices();
  commit('events', 'members', 'notices');
}

// list_events pages at 250; walk a few pages so a 6-month window fits.
async function fetchCalendar(cal) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 6; i++) {
    const p = await call(SERVERS.calendar, 'list_events', {
      calendarId: cal.id, startTime: localIso(RANGE.from()), endTime: localIso(RANGE.to()), orderBy: 'startTime', pageSize: 250, ...(pageToken ? { pageToken } : {}),
    }, { cache: { staleTime: 60_000 } });
    if (p?.summary && cal.primary) claimEmail(p.summary);
    out.push(...(p?.events || []).map((e) => mapEvent(e, cal)).filter(Boolean));
    pageToken = p?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function enabledCalendars() {
  const chosen = state.settings.calendars;
  return state.calendars.filter((c) => (chosen ? chosen.includes(c.id) : c.primary || !c.resource));
}

export async function syncCalendars() {
  setStatus('calendar', { status: 'loading' });
  try {
    const p = await call(SERVERS.calendar, 'list_calendars', { pageSize: 100 }, { cache: { staleTime: 300_000 } });
    const cals = p?.calendars || [];
    // The connector may not flag the primary calendar, and doesn't list it first: fall back to the
    // first one whose id is a plain address (not a group, holiday or resource calendar).
    let main = cals.findIndex((c) => c.primary === true);
    if (main < 0) main = cals.findIndex((c) => /^[^#@\s]+@(?!group\.|resource\.)[^#\s]+$/.test(c.id));
    if (main < 0) main = 0;
    const list = cals.map((c, i) => ({
      id: c.id, summary: c.summary || c.id, description: c.description || '', tz: c.timeZone,
      primary: i === main, resource: /@resource\.calendar\.google\.com$/.test(c.id),
      holidays: /#holiday@/.test(c.id),
    }));
    state.calendars = list;
    const primary = list.find((c) => c.primary);
    if (primary) {
      claimEmail(primary.id.includes('@') && !primary.id.includes('#') ? primary.id : '');
      const me = state.members[0];
      if (primary.tz) me.tz = primary.tz;
    }
    commit('calendars', 'members');
    await refreshEvents();
  } catch (err) {
    fail('calendar', SERVERS.calendar)(err);
  }
}

export async function refreshEvents({ fresh = false } = {}) {
  const cals = enabledCalendars();
  for (const id of [...perCalendar.keys()]) if (!cals.some((c) => c.id === id)) perCalendar.delete(id);
  try {
    if (fresh) await invalidate(SERVERS.calendar, 'list_events');
    const results = await Promise.allSettled(cals.map((c) => fetchCalendar(c).then((evs) => perCalendar.set(c.id, evs))));
    const bad = results.find((r) => r.status === 'rejected');
    if (bad && results.every((r) => r.status === 'rejected')) throw bad.reason;
    rebuildEvents();
    setStatus('calendar', { status: 'ok', storedAt: Date.now(), partial: !!bad, code: null, text: bad ? explain(bad.reason, SERVERS.calendar).text : '' });
  } catch (err) {
    fail('calendar', SERVERS.calendar)(err);
  }
}

// Calendar writes ------------------------------------------------------------
export async function createEvent({ title, start, end, place, kind, attendees = [], description = '' }) {
  const input = {
    summary: title, startTime: localIso(start), endTime: localIso(end),
    ...(kind === 'focus' ? { eventType: 'FOCUS_TIME' } : {}),
    ...(place && place !== 'video' ? { location: place } : {}),
    ...(place === 'video' && kind !== 'focus' ? { addGoogleMeetUrl: true } : {}),
    ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    ...(description ? { description } : {}),
  };
  const ev = await call(SERVERS.calendar, 'create_event', input);
  await refreshEvents({ fresh: true });
  return ev;
}

export async function deleteEvent(e) {
  await call(SERVERS.calendar, 'delete_event', { calendarId: e.calendarId, eventId: e.gid, notificationLevel: 'NONE' });
  await refreshEvents({ fresh: true });
}

export async function moveEvent(e, start, end) {
  await call(SERVERS.calendar, 'update_event', { calendarId: e.calendarId, eventId: e.gid, startTime: localIso(start), endTime: localIso(end) });
  await refreshEvents({ fresh: true });
}

export async function rsvp(e, responseStatus) {
  await call(SERVERS.calendar, 'respond_to_event', { calendarId: e.calendarId, eventId: e.gid, responseStatus });
  await refreshEvents({ fresh: true });
}

/** Free slots shared with people (emails), next 7 days, working hours. */
export async function suggestTimes(emails, minutes = 30) {
  const from = Date.now() + 3600_000;
  const p = await call(SERVERS.calendar, 'suggest_time', {
    attendeeEmails: emails, durationMinutes: minutes, startTime: localIso(from), endTime: localIso(from + 7 * DAY),
    preferences: { startHour: '09:00', endHour: '18:00', excludeWeekends: true, pageSize: 5 },
  });
  return p;
}

export async function searchEvents(query) {
  const p = await call(SERVERS.calendar, 'search_events', { query, pageSize: 5 }, { cache: { staleTime: 60_000 } });
  return (p?.events || []).map((e) => mapEvent(e, { id: 'primary', summary: '' })).filter(Boolean);
}

// =================================== Gmail ===================================
const INBOX_QUERY = 'in:inbox';
let gmailOff = null;

function mapThread(t) {
  const msgs = t.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const first = msgs[0] || last;
  const labels = new Set(msgs.flatMap((m) => m.labelIds || []));
  const { email } = parseAddress(last.sender || first.sender || '');
  const from = person(last.sender || first.sender || '');
  const category = [...labels].find((l) => l.startsWith('CATEGORY_'))?.replace('CATEGORY_', '').toLowerCase() || 'personal';
  return {
    id: t.id, subject: decodeEntities(first.subject || last.subject || '(no subject)'), snippet: decodeEntities(last.snippet || ''),
    from, fromEmail: email, at: Date.parse(last.date) || +last.internalDate || 0, count: t.messageCount || msgs.length,
    unread: labels.has('UNREAD'), important: labels.has('IMPORTANT'), starred: labels.has('STARRED'), inbox: labels.has('INBOX'),
    category, url: t.viewUrl || last.viewUrl, lastMessageId: last.id,
  };
}

export function syncGmail() {
  gmailOff?.();
  setStatus('gmail', { status: 'loading' });
  const offs = [
    watch(
      SERVERS.gmail, 'search_threads', { query: INBOX_QUERY, pageSize: 40 },
      ({ payload, storedAt }) => {
        state.threads = (payload?.threads || []).map(mapThread).sort((a, b) => b.at - a.at);
        scorePeople();
        buildNotices();
        commit('threads', 'members', 'notices');
        setStatus('gmail', { status: 'ok', storedAt, code: null, text: '' });
      },
      fail('gmail', SERVERS.gmail),
      { every: 120_000 },
    ),
    watch(
      SERVERS.gmail, 'search_threads', { query: 'in:inbox is:unread', pageSize: 1, view: 'THREAD_VIEW_METADATA_ONLY' },
      ({ payload }) => {
        state.unread = +payload?.resultCountEstimate || (payload?.threads || []).length;
        commit('threads');
      },
      () => {},
      { every: 120_000 },
    ),
  ];
  gmailOff = () => offs.forEach((f) => f());
}

export async function searchMail(query, pageSize = 10) {
  const p = await call(SERVERS.gmail, 'search_threads', { query, pageSize }, { cache: { staleTime: 60_000 } });
  return (p?.threads || []).map(mapThread);
}

export async function readThread(id) {
  const p = await call(SERVERS.gmail, 'get_thread', { threadId: id, messageFormat: 'PLAIN_TEXT' }, { cache: { staleTime: 120_000 } });
  return (p?.messages || []).map((m) => ({
    id: m.id, from: person(m.sender || ''), fromRaw: m.sender, to: m.toRecipients || [], at: Date.parse(m.date) || +m.internalDate,
    subject: decodeEntities(m.subject || ''), body: m.plaintextBody || decodeEntities(m.snippet || ''), attachments: (m.attachments || []).map((a) => a.filename).filter(Boolean),
  }));
}

async function relabel(thread, add = [], remove = []) {
  if (add.length) await call(SERVERS.gmail, 'label_thread', { threadId: thread.id, labelIds: add });
  if (remove.length) await call(SERVERS.gmail, 'unlabel_thread', { threadId: thread.id, labelIds: remove });
  await invalidate(SERVERS.gmail, 'search_threads');
}

// Optimistic: the list updates at once and rolls back if Gmail refuses.
async function optimistic(apply, revert, run) {
  apply();
  commit('threads');
  try {
    await run();
  } catch (err) {
    revert();
    commit('threads');
    throw err;
  }
}
export function markRead(t, read = true) {
  const was = t.unread;
  const unread = state.unread;
  return optimistic(
    () => ((t.unread = !read), was === read && (state.unread = Math.max(0, state.unread + (read ? -1 : 1)))),
    () => ((t.unread = was), (state.unread = unread)),
    () => relabel(t, read ? [] : ['UNREAD'], read ? ['UNREAD'] : []),
  );
}
export function archive(t) {
  const before = state.threads;
  return optimistic(() => (state.threads = state.threads.filter((x) => x.id !== t.id)), () => (state.threads = before), () => relabel(t, [], ['INBOX']));
}
export function unarchive(t) {
  return optimistic(
    () => !state.threads.some((x) => x.id === t.id) && (state.threads = [...state.threads, t].sort((a, b) => b.at - a.at)),
    () => (state.threads = state.threads.filter((x) => x.id !== t.id)),
    () => relabel(t, ['INBOX'], []),
  );
}
export function star(t, on = true) {
  const was = t.starred;
  return optimistic(() => (t.starred = on), () => (t.starred = was), () => relabel(t, on ? ['STARRED'] : [], on ? [] : ['STARRED']));
}

/** Refetch the inbox without flashing a loading state (watches redeliver). */
export const refreshGmail = () => invalidate(SERVERS.gmail, 'search_threads');

/** Drafts only — Lumen never sends mail on its own. */
export async function draft({ to = [], subject = '', body = '', replyToMessageId }) {
  return call(SERVERS.gmail, 'create_draft', { to, subject, body, ...(replyToMessageId ? { replyToMessageId } : {}) });
}

// ================================ Google Drive ===============================
const mapFile = (f) => ({
  id: f.id, title: f.title || 'Untitled', mime: f.mimeType || '', url: f.viewUrl, owner: f.owner ? person(f.owner) : null,
  modified: Date.parse(f.modifiedTime) || 0, viewed: Date.parse(f.viewedByMeTime) || 0, size: +f.fileSize || 0,
  kind: kindOfFile(f.mimeType || ''),
});

export function kindOfFile(mime) {
  if (mime.includes('folder')) return 'folder';
  if (mime.includes('document') || mime.includes('word')) return 'doc';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return 'sheet';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export function syncDrive() {
  setStatus('drive', { status: 'loading' });
  return watch(
    SERVERS.drive, 'list_recent_files', { pageSize: 30, excludeContentSnippets: true },
    ({ payload, storedAt }) => {
      state.files = (payload?.files || []).map(mapFile);
      commit('files', 'members');
      setStatus('drive', { status: 'ok', storedAt, code: null, text: '' });
    },
    fail('drive', SERVERS.drive),
    { every: 300_000 },
  );
}

/** Drive query syntax: free text becomes a title/fullText search. */
export async function searchFiles(text, pageSize = 10) {
  const q = String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const p = await call(SERVERS.drive, 'search_files', { query: `title contains '${q}' or fullText contains '${q}'`, pageSize, excludeContentSnippets: true }, { cache: { staleTime: 60_000 } });
  return (p?.files || []).map(mapFile);
}

export async function starredFiles() {
  const p = await call(SERVERS.drive, 'search_files', { query: 'starred = true', pageSize: 20, excludeContentSnippets: true }, { cache: { staleTime: 120_000 } });
  return (p?.files || []).map(mapFile);
}

// ================================ notifications ==============================
// The bell: unread important mail + invitations awaiting an answer + meetings
// starting within 15 minutes. Read state is local to this tab session.
const seen = new Set();
export function buildNotices() {
  const now = Date.now();
  const list = [];
  for (const e of state.events) {
    if (e.end < now) continue;
    if (e.rsvp === 'needsAction' && e.start - now < 14 * DAY)
      list.push({ id: `inv-${e.id}`, at: e.start, who: e.organizer || 'me', text: `invited you to “${e.title}”`, href: '#/calendar', eventId: e.id, kind: 'invite' });
    else if (e.start > now && e.start - now < 15 * 60000)
      list.push({ id: `soon-${e.id}`, at: e.start, who: 'me', text: `“${e.title}” starts ${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, href: '#/calendar', eventId: e.id, kind: 'soon' });
  }
  for (const t of state.threads.filter((t) => t.unread && t.important).slice(0, 8))
    list.push({ id: `mail-${t.id}`, at: t.at, who: t.from || 'me', text: `emailed you “${t.subject}”`, href: `#/inbox/${t.id}`, threadId: t.id, kind: 'mail' });
  state.notices = list.sort((a, b) => b.at - a.at).map((n) => ({ ...n, read: seen.has(n.id) }));
}
export const markNoticeRead = (id) => seen.add(id);
