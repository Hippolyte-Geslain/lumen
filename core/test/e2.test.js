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
  it('gitlab encodes the project path and rejects odd repos', async () => {
    const urls = [];
    const c = createConnectors({ secrets: secretsOf({ gitlab: 't' }), guard: guardOf(async (u) => (urls.push(u), reply(200, []))) });
    await c.callTool('gitlab', 'merge_requests', { repo: 'grp/app' });
    expect(urls[0]).toBe('https://gitlab.com/api/v4/projects/grp%2Fapp/merge_requests?state=opened');
    await expect(c.callTool('gitlab', 'issues', { repo: '../x?y' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(c.callTool('github', 'pulls', { repo: 'a/..' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(createConnectors({ secrets: secretsOf({}), guard: guardOf(async () => reply(200, [])) }).callTool('gitlab', 'projects')).rejects.toMatchObject({ code: 'not_connected' });
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

describe('attachments', () => {
  it('stores, lists, reads back, removes; enforces input rules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-'));
    const core = await startCore({ dir, token: 't' });
    const a = core.attachments;
    const meta = a.add({ cardId: 'c1', name: '../evil.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') });
    expect(meta).toMatchObject({ cardId: 'c1', size: 5 });
    expect(a.list('c1')).toHaveLength(1);
    expect(Buffer.from(a.read(meta.id).data, 'base64').toString()).toBe('hello');
    expect(() => a.add({ cardId: 'c1', name: 'x', data: '' })).toThrow(/Empty/);
    expect(() => a.add({ name: 'x', data: 'aa' })).toThrow(/required/);
    expect(a.remove(meta.id)).toBe(true);
    expect(a.list('c1')).toEqual([]);
    expect(() => a.read(meta.id)).toThrow(/No such/);
    await core.close();
  });
});

describe('pm connectors', () => {
  it('clickup: raw token header, ids validated, create posts a task', async () => {
    const calls = [];
    const c = createConnectors({ secrets: secretsOf({ clickup: 'pk_1' }), guard: guardOf(async (u, i) => (calls.push({ u, i }), reply(200, { ok: 1 }))) });
    await c.callTool('clickup', 'tasks', { listId: '42' });
    expect(calls[0].u).toBe('https://api.clickup.com/api/v2/list/42/task?include_closed=false');
    expect(calls[0].i.headers.authorization).toBe('pk_1');
    await expect(c.callTool('clickup', 'tasks', { listId: '../x' })).rejects.toMatchObject({ code: 'bad_request' });
    await c.callTool('clickup', 'create_task', { listId: '7', name: 'Do it' });
    expect(JSON.parse(calls[1].i.body)).toMatchObject({ name: 'Do it' });
    await expect(c.callTool('clickup', 'create_task', { listId: '7', name: ' ' })).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('notion: finds the title property, maps auth errors', async () => {
    const calls = [];
    const guard = guardOf(async (u, i) => { calls.push({ u, i }); return reply(200, u.endsWith('/databases/db1') ? { properties: { Done: { type: 'checkbox' }, Name: { type: 'title' } } } : {}); });
    const c = createConnectors({ secrets: secretsOf({ notion: 'secret_x' }), guard });
    await c.callTool('notion', 'create_page', { databaseId: 'db1', title: 'Hello' });
    expect(JSON.parse(calls[1].i.body).properties.Name.title[0].text.content).toBe('Hello');
    expect(calls[0].i.headers['notion-version']).toBe('2022-06-28');
    const bad = createConnectors({ secrets: secretsOf({ notion: 'k' }), guard: guardOf(async () => reply(401, {})) });
    await expect(bad.callTool('notion', 'search', { query: 'x' })).rejects.toMatchObject({ code: 'not_connected' });
    await expect(createConnectors({ secrets: secretsOf({}), guard }).callTool('notion', 'search', {})).rejects.toMatchObject({ code: 'not_connected' });
  });
});

describe('ai usage meter', () => {
  it('counts calls and estimated tokens per day and provider', async () => {
    const ai = mkAI({ anthropic: 'k' }, async () => reply(200, { content: [{ type: 'text', text: 'abcdefgh' }] }), { now: () => Date.UTC(2026, 9, 25, 12) });
    await ai.sample('12345678');
    await ai.sample('1234');
    expect(ai.usage()).toEqual({ '2026-10-25': { anthropic: { calls: 2, in: 3, out: 4 } } });
  });
  it('lists llama.cpp as a local provider', () => {
    expect(mkAI({}, async () => reply(200, {})).get().providers.find((p) => p.id === 'llamacpp')).toMatchObject({ local: true, baseUrl: 'http://127.0.0.1:8080/v1' });
  });
});
