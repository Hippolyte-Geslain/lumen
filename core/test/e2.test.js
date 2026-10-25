import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';
import { createSampler } from '../sample.js';
import { createConnectors } from '../mcp.js';

const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
const secretsOf = (o) => ({ has: (n) => n in o, get: (n) => o[n] });
const guardOf = (fn) => ({ fetch: fn });

describe('sample', () => {
  it('anthropic text, tier model', async () => {
    let sent;
    const s = createSampler({ secrets: secretsOf({ anthropic: 'k' }), guard: guardOf(async (u, i) => { sent = { u, ...JSON.parse(i.body), key: i.headers['x-api-key'] }; return reply(200, { content: [{ type: 'text', text: 'hi' }] }); }) });
    expect(await s('yo', { modelTier: 'fast' })).toEqual({ text: 'hi', provider: 'anthropic' });
    expect(sent).toMatchObject({ model: 'claude-haiku-5-5', key: 'k' });
  });
  it('falls back to ollama, offline when nothing answers, rate limit propagates', async () => {
    const ok = createSampler({ secrets: secretsOf({}), guard: guardOf(async () => reply(200, { response: 'local' })) });
    expect((await ok('x')).text).toBe('local');
    const down = createSampler({ secrets: secretsOf({}), guard: guardOf(async () => { throw new Error('ECONNREFUSED'); }) });
    await expect(down('x')).rejects.toMatchObject({ code: 'provider_offline' });
    const rl = createSampler({ secrets: secretsOf({ openai: 'k' }), guard: guardOf(async () => reply(429, {})) });
    await expect(rl('x')).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('connectors', () => {
  it('unknown server, missing token, github tool', async () => {
    const none = createConnectors({ secrets: secretsOf({}), guard: guardOf(async () => reply(200, [])) });
    await expect(none.callTool('slack', 'x')).rejects.toMatchObject({ code: 'server_not_connected' });
    await expect(none.callTool('github', 'repos')).rejects.toMatchObject({ code: 'not_connected' });
    const c = createConnectors({ secrets: secretsOf({ github: 't' }), guard: guardOf(async (u) => reply(200, [{ u }])) });
    expect((await c.callTool('github', 'pulls', { repo: 'a/b' })).payload[0].u).toContain('/repos/a/b/pulls');
  });
  it('RPC maps errors', async () => {
    const core = await startCore({ dir: mkdtempSync(join(tmpdir(), 'lumen-')), token: 't' });
    const ws = await new Promise((r) => { const w = new WebSocket(`ws://127.0.0.1:${core.port}/?token=t`); w.on('open', () => r(w)); });
    const rpc = (method, params) => new Promise((res) => { const id = Math.random(); const h = (raw) => { const m = JSON.parse(raw); if (m.id === id) { ws.off('message', h); res(m); } }; ws.on('message', h); ws.send(JSON.stringify({ id, method, params })); });
    expect((await rpc('mcp.callTool', { server: 'nope', tool: 'x' })).error.code).toBe('server_not_connected');
    expect((await rpc('sample', {})).error.code).toBe('bad_request');
    ws.close(); await core.close();
  });
});
