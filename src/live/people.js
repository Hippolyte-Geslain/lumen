// People in live mode come from calendar attendees and mail senders, keyed by
// lower-cased email. The viewer is always the member with id 'me'.

import { state } from '../store.js';

const BOT = /(no-?reply|do-?not-?reply|notifications?|mailer|daemon|bounce|newsletter|calendar-notification|support@|info@|hello@|news@)/i;
export const isBot = (email) => BOT.test(email);

/** "Jane Doe <jane@x.io>" | "jane@x.io" → { email, name } */
export function parseAddress(raw = '') {
  const m = String(raw).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() };
  return { email: String(raw).trim().toLowerCase(), name: '' };
}

/** jane.doe.pro@x.io → "Jane Doe" */
export function nameFromEmail(email) {
  const local = email.split('@')[0].replace(/\+.*$/, '');
  const parts = local
    .split(/[._-]+/)
    .filter((p) => p && !/^(pro|perso|work|contact|\d+)$/i.test(p));
  if (!parts.length) return local;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

const orgFromDomain = (email) => {
  const d = email.split('@')[1] || '';
  if (/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton(mail)?)\./i.test(d)) return 'Personal';
  const base = d.split('.').slice(-2, -1)[0] || d;
  return base ? base[0].toUpperCase() + base.slice(1) : 'Other';
};

export const isMine = (email) => {
  const me = state.members.find((m) => m.id === 'me');
  return !!email && (me?.emails || []).includes(email.toLowerCase());
};

export function claimEmail(email) {
  if (!email) return;
  const me = state.members.find((m) => m.id === 'me');
  const e = email.toLowerCase();
  if (!me.emails.includes(e)) me.emails.push(e);
  if (!me.email) me.email = e;
  if (!me.name) me.name = nameFromEmail(e);
  if (!me.team) me.team = orgFromDomain(e);
}

/** Upsert a person; returns their member id ('me' for the viewer). */
export function person(rawEmail, displayName = '') {
  const { email, name } = parseAddress(rawEmail);
  if (!email) return null;
  if (isMine(email)) return 'me';
  let m = state.members.find((x) => x.id === email);
  if (!m) {
    m = {
      id: email, email, name: displayName || name || nameFromEmail(email), role: email.split('@')[1] || '', team: orgFromDomain(email),
      presence: 'away', city: '', tz: state.members[0]?.tz, capacity: 40, bot: isBot(email),
      meetings: 0, mails: 0, lastSeen: 0,
    };
    state.members.push(m);
  } else if ((displayName || name) && m.name === nameFromEmail(email)) {
    m.name = displayName || name;
  }
  return m.id;
}

/** Recompute interaction counts and "presence" (in a meeting with me right now). */
export function scorePeople() {
  const now = Date.now();
  const since = now - 90 * 86_400_000;
  for (const m of state.members) {
    if (m.id === 'me') continue;
    m.meetings = 0;
    m.mails = 0;
    m.lastSeen = 0;
    m.presence = 'away';
  }
  const byId = new Map(state.members.map((m) => [m.id, m]));
  for (const e of state.events) {
    if (e.start < since) continue;
    for (const a of e.attendees) {
      const m = byId.get(a);
      if (!m || a === 'me') continue;
      m.meetings++;
      if (e.start <= now) m.lastSeen = Math.max(m.lastSeen, e.start);
      if (e.start <= now && e.end > now) m.presence = 'meeting';
    }
  }
  for (const t of state.threads) {
    const m = byId.get(t.from);
    if (!m || t.from === 'me') continue;
    m.mails++;
    m.lastSeen = Math.max(m.lastSeen, t.at);
    if (m.presence === 'away' && now - t.at < 3600_000) m.presence = 'online';
  }
}

/** Real collaborators, most interaction first. */
export const collaborators = () =>
  state.members
    .filter((m) => m.id !== 'me' && !m.bot && (m.meetings || m.mails))
    .sort((a, b) => b.meetings * 2 + b.mails - (a.meetings * 2 + a.mails));
