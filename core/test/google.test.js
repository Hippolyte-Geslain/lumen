import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createGoogle } from '../google.js';

const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
const vault = () => { const m = new Map(); return { has: (n) => m.has(n), get: (n) => m.get(n), set: (n, v) => m.set(n, v), delete: (n) => m.delete(n) }; };

function setup(handler) {
  const calls = [];
  let t = 1_000_000;
  const g = createGoogle({ secrets: vault(), now: () => t, guard: { fetch: async (u, i) => (calls.push({ u, i }), handler(u, i)) } });
  g.setClient({ clientId: 'cid', clientSecret: 'sec' });
  return { g, calls, tick: (ms) => (t += ms) };
}

describe('google', () => {
  it('PKCE: challenge matches verifier, state is single use', async () => {
    const { g, calls } = setup(() => reply(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
    const url = new URL(g.begin('http://127.0.0.1:9/oauth/google').url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    const state = url.searchParams.get('state');
    await g.complete(state, 'code1');
    const body = new URLSearchParams(calls[0].i.body);
    const verifier = body.get('code_verifier');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(g.status()).toEqual({ hasClient: true, connected: true });
    await expect(g.complete(state, 'code1')).rejects.toMatchObject({ code: 'bad_request' });
    await expect(g.complete('forged', 'x')).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('refreshes an expired token and calls the API with it', async () => {
    const { g, calls, tick } = setup((u) => (u.includes('oauth2.googleapis') ? reply(200, { access_token: 'a2', refresh_token: 'r', expires_in: 3600 }) : reply(200, { items: [] })));
    // seed via full flow
    const s = new URL(g.begin('http://127.0.0.1:9/oauth/google').url).searchParams.get('state');
    await g.complete(s, 'c');
    tick(4_000_000);
    await g.connector.tools.calendar_events({});
    const refresh = calls.find((c) => c.i.body?.includes('refresh_token'));
    expect(new URLSearchParams(refresh.i.body).get('grant_type')).toBe('refresh_token');
    expect(calls.at(-1).i.headers.authorization).toBe('Bearer a2');
  });
  it('requires a connection, validates input, maps errors', async () => {
    const { g } = setup(() => reply(401, {}));
    await expect(g.connector.tools.gmail_threads({})).rejects.toMatchObject({ code: 'not_connected' });
    const s = new URL(g.begin('http://127.0.0.1:9/oauth/google').url).searchParams.get('state');
    await expect(g.complete(s, 'c')).rejects.toMatchObject({ code: 'provider_error' });
    await expect(g.connector.tools.gmail_thread({ id: '../x' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(g.connector.tools.create_event({ summary: 'x' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(g.connector.tools.calendar_events({ timeMin: 'nope' })).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('disconnect drops the token', async () => {
    const { g } = setup(() => reply(200, { access_token: 'a', expires_in: 3600 }));
    await g.complete(new URL(g.begin('http://127.0.0.1:9/oauth/google').url).searchParams.get('state'), 'c');
    g.disconnect();
    expect(g.status().connected).toBe(false);
  });
});
