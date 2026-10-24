import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';
import { createGuard } from '../net/guard.js';
import { createSecrets } from '../secrets.js';

const token = 't0k';
const open = (core) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${core.port}/?token=${token}`);
  ws.on('open', () => res(ws)); ws.on('error', rej);
});
const rpc = (ws, method, params) => new Promise((res) => {
  const id = Math.random();
  const h = (raw) => { const m = JSON.parse(raw); if (m.id === id) { ws.off('message', h); res(m); } };
  ws.on('message', h); ws.send(JSON.stringify({ id, method, params }));
});
const memStore = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }; };
const xor = { protect: (s) => Buffer.from(s).reverse().toString('base64'), unprotect: (c) => Buffer.from(c, 'base64').reverse().toString() };

describe('guard', () => {
  it('allowlist, loopback, cloud, log', async () => {
    const g = createGuard({ mode: 'local' });
    await expect(g.fetch('https://api.example.com/x')).rejects.toMatchObject({ code: 'blocked_by_sovereignty_mode' });
    g.allowHost('API.example.com');
    expect(g.allowlist()).toContain('api.example.com');
    g.setMode('cloud'); expect(g.getMode()).toBe('cloud');
    expect(() => g.setMode('nope')).toThrow(/bad|mode/i);
    expect(g.log(10).length).toBeGreaterThan(0);
    g.clearLog(); expect(g.log(10)).toEqual([]);
  });
});

describe('secrets', () => {
  it('stores ciphertext, validates names, deletes', () => {
    const st = memStore(); const s = createSecrets(st, { backend: xor });
    s.set('anthropic.key', 'sk-123');
    expect(JSON.stringify(st.get('secrets/anthropic.key'))).not.toContain('sk-123');
    expect(s.get('anthropic.key')).toBe('sk-123');
    expect(s.has('anthropic.key')).toBe(true);
    expect(() => s.set('../bad', 'x')).toThrow(/Bad secret/);
    s.delete('anthropic.key'); expect(s.has('anthropic.key')).toBe(false);
  });
});

describe('core RPC', () => {
  it('guard/secrets RPC, no secrets.get, persistence across restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-'));
    let core = await startCore({ dir, token });
    let ws = await open(core);
    await rpc(ws, 'guard.setMode', { mode: 'airgap' });
    await rpc(ws, 'guard.allow', { host: 'Example.com' });
    expect((await rpc(ws, 'secrets.get', { name: 'x' })).error.code).toBe('not_found');
    ws.close(); await core.close();

    core = await startCore({ dir, token });
    ws = await open(core);
    const g = (await rpc(ws, 'guard.get')).result;
    expect(g.mode).toBe('airgap'); expect(g.allow).toContain('example.com');
    ws.close(); await core.close();
  });
});
