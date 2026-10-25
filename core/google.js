// Google connector (Calendar, Gmail read, Drive search) over OAuth 2.0 with PKCE and a loopback redirect.
// The user brings their own OAuth client (Desktop app type); client + tokens live in the vault, never in the page.
// Scopes are read-only except calendar events; every request goes through the sovereignty guard.
import { createHash, randomBytes } from 'node:crypto';

const err = (code, message) => Object.assign(new Error(message), { code });
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = (o) => new URLSearchParams(o).toString();
const ID = /^[\w-]+$/;

export function createGoogle({ guard, secrets, now = () => Date.now() }) {
  const pending = new Map(); // state -> { verifier, redirect, at }
  const read = (n) => { try { return secrets.has(n) ? JSON.parse(secrets.get(n)) : null; } catch { return null; } };
  const write = (n, v) => secrets.set(n, JSON.stringify(v));

  async function tokenCall(body) {
    const res = await guard.fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw err(j.error === 'invalid_grant' ? 'needs_reauth' : 'provider_error', j.error_description || `Google answered ${res.status}`);
    return j;
  }

  async function accessToken() {
    const client = read('google-client');
    const tok = read('google-token');
    if (!client || !tok) throw err('not_connected', 'Connect Google in Settings');
    if (tok.expiry - 60_000 > now()) return tok.access;
    if (!tok.refresh) throw err('needs_reauth', 'Google sign-in expired');
    const j = await tokenCall({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), grant_type: 'refresh_token', refresh_token: tok.refresh });
    write('google-token', { ...tok, access: j.access_token, expiry: now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }

  async function api(url, init = {}) {
    const res = await guard.fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    if (res.status === 401) throw err('needs_reauth', 'Google sign-in expired');
    if (res.status === 403 || res.status === 429) throw err('rate_limited', 'Google refused the request (quota or scope)');
    if (!res.ok) throw err('provider_error', `Google answered ${res.status}`);
    return res.json();
  }
  const day = (v, what) => { if (v != null && Number.isNaN(Date.parse(v))) throw err('bad_request', `${what} is not a date`); return v; };

  return {
    status: () => ({ hasClient: !!read('google-client'), connected: !!read('google-token') }),
    setClient({ clientId, clientSecret } = {}) {
      if (!clientId || typeof clientId !== 'string') throw err('bad_request', 'Client ID is required');
      write('google-client', { clientId: clientId.trim(), clientSecret: clientSecret ? String(clientSecret).trim() : '' });
    },
    disconnect() { secrets.delete('google-token'); },
    /** Returns the URL the user must open in their browser. */
    begin(redirect) {
      const client = read('google-client');
      if (!client) throw err('not_connected', 'Save your Google client ID first');
      for (const [k, v] of pending) if (now() - v.at > 600_000) pending.delete(k);
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      pending.set(state, { verifier, redirect, at: now() });
      const url = `${AUTH}?${form({
        client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
      })}`;
      return { url };
    },
    /** Called from the loopback redirect. Single use; unknown or expired state is rejected. */
    async complete(state, code) {
      const p = pending.get(state);
      pending.delete(state);
      if (!p || now() - p.at > 600_000 || !code) throw err('bad_request', 'Sign-in link expired. Start again from Settings.');
      const client = read('google-client');
      const j = await tokenCall({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: p.redirect });
      write('google-token', { access: j.access_token, refresh: j.refresh_token, expiry: now() + (j.expires_in || 3600) * 1000 });
    },
    connector: {
      tools: {
        async calendar_events(i = {}) {
          const q = form({ singleEvents: 'true', orderBy: 'startTime', maxResults: '50', timeMin: day(i.timeMin, 'timeMin') || new Date(now()).toISOString(), ...(i.timeMax ? { timeMax: day(i.timeMax, 'timeMax') } : {}) });
          return api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
        },
        async create_event(i = {}) {
          if (!i.summary || !i.start || !i.end) throw err('bad_request', 'summary, start and end are required');
          return api('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify({ summary: String(i.summary).slice(0, 300), start: { dateTime: day(i.start, 'start') }, end: { dateTime: day(i.end, 'end') } }) });
        },
        gmail_threads: (i = {}) => api(`https://gmail.googleapis.com/gmail/v1/users/me/threads?${form({ maxResults: '20', q: String(i.q ?? 'is:unread').slice(0, 200) })}`),
        async gmail_thread(i = {}) {
          if (!ID.test(String(i.id ?? ''))) throw err('bad_request', 'id is not valid');
          return api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${i.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
        },
        async drive_search(i = {}) {
          const term = String(i.q ?? '').replace(/['\\]/g, ' ').slice(0, 100);
          return api(`https://www.googleapis.com/drive/v3/files?${form({ pageSize: '20', fields: 'files(id,name,mimeType,modifiedTime,webViewLink)', q: `name contains '${term}' and trashed = false` })}`);
        },
      },
    },
  };
}
