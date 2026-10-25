import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';
import { createAI } from '../ai.js';
import { createConnectors } from '../mcp.js';

const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
const secretsOf = (o) => ({ has: (n) => n in o, get: (n) => o[n] });
const guardOf = (fn) => ({ fetch: fn });

const memStore = () => { const m = new Map(); return { get: (p) => m.get(p), set: (p, b) => m.set(p, b) }; };
const mkAI = (keys, fn, extra = {}) => createAI({ secrets: secretsOf(keys), guard: { fetch: fn, getMode: () => 'local' }, store: memStore(), ...extra });

describe('ai', () => {
  it('anthropic text, tier model', async () => {
    let sent;
    const ai = mkAI({ anthropic: 'k' }, async (u, i) => { sent = { u, ...JSON.parse(i.body), key: i.headers['x-api-key'] }; return reply(200, { content: [{ type: 'text', text: 'hi' }] }); });
    expect(await ai.sample('yo', { modelTier: 'fast' })).toEqual({ text: 'hi', provider: 'anthropic' });
    expect(sent).toMatchObject({ model: 'claude-haiku-5-5', key: 'k' });
  });
  it('falls back to local, offline when nothing answers, rate limit propagates', async () => {
    const ok = mkAI({}, async () => reply(200, { message: { content: 'local' } }));
    expect((await ok.sample('x')).text).toBe('local');
    await expect(mkAI({}, async () => { throw new Error('ECONNREFUSED'); }).sample('x')).rejects.toMatchObject({ code: 'provider_offline' });
    await expect(mkAI({ openai: 'k' }, async () => reply(429, {})).sample('x')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(ok.sample('')).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('routes, lists models, tests connection', async () => {
    const ai = mkAI({ openai: 'k' }, async (u) => reply(200, u.endsWith('/models') ? { data: [{ id: 'm1' }] } : { choices: [{ message: { content: u } }] }));
    ai.set({ routes: { chat: 'openai' } });
    expect((await ai.chat([{ role: 'user', content: 'x' }])).provider).toBe('openai');
    expect(await ai.models('openai')).toEqual(['m1']);
    expect(await ai.test('openai')).toEqual({ ok: true, models: ['m1'] });
    expect(ai.get().providers.find((p) => p.id === 'openai').hasKey).toBe(true);
    await expect(ai.test('anthropic')).rejects.toMatchObject({ code: 'provider_offline' });
  });
  it('claude-code drives the CLI and is skipped in airgap', async () => {
    const { EventEmitter } = await import('node:events');
    const spawn = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = { end() { setTimeout(() => { p.stdout.emit('data', 'cli says hi'); p.emit('close', 0); }); } }; return p; };
    const ai = mkAI({}, async () => { throw new Error('down'); }, { spawn });
    ai.set({ routes: { chat: 'claude-code' } });
    expect((await ai.chat([{ role: 'user', content: 'x' }])).text).toBe('cli says hi');
    const air = createAI({ secrets: secretsOf({}), guard: { fetch: async () => { throw new Error('x'); }, getMode: () => 'airgap' }, store: memStore(), spawn });
    air.set({ routes: { chat: 'claude-code' } });
    await expect(air.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ code: 'provider_offline' });
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
