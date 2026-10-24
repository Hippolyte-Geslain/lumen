import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';
import { createGuard } from '../net/guard.js';

let core; const token = 't0k';
beforeAll(async () => { core = await startCore({ dir: mkdtempSync(join(tmpdir(), 'lumen-')), token }); });
afterAll(() => core.close());

const open = (q, headers) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${core.port}/?token=${q}`, { headers });
  ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(new Error('status ' + r.statusCode)));
});
const rpc = (ws, method, params) => new Promise((res) => {
  const id = Math.random();
  const h = (raw) => { const m = JSON.parse(raw); if (m.id === id) { ws.off('message', h); res(m); } };
  ws.on('message', h); ws.send(JSON.stringify({ id, method, params }));
});

describe('core server', () => {
  it('rejects bad token and bad origin', async () => {
    await expect(open('nope')).rejects.toThrow(/401|status/);
    await expect(open(token, { Origin: 'https://evil.example' })).rejects.toThrow();
  });
  it('round-trips db', async () => {
    const ws = await open(token);
    await rpc(ws, 'db.set', { path: 'p', body: { items: [1] } });
    expect((await rpc(ws, 'db.get', { path: 'p' })).result).toEqual({ items: [1] });
    ws.close();
  });
  it('returns explain-style errors', async () => {
    const ws = await open(token);
    expect((await rpc(ws, 'mcp.callTool', {})).error.code).toBe('server_not_connected');
    expect((await rpc(ws, 'sample', {})).error.code).toBe('provider_offline');
    ws.close();
  });
});

describe('egress guard', () => {
  it('enforces modes', async () => {
    const g = createGuard({ mode: 'airgap' });
    await expect(g.fetch('https://example.com')).rejects.toMatchObject({ code: 'blocked_by_sovereignty_mode' });
    g.setMode('local');
    await expect(g.fetch('https://example.com')).rejects.toMatchObject({ code: 'blocked_by_sovereignty_mode' });
  });
});
