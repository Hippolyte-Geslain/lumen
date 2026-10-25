import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';

let core, ws; const token = 'rpc-tok';
const dir = mkdtempSync(join(tmpdir(), 'lumen-rpc-'));
const coding = mkdtempSync(join(tmpdir(), 'lumen-code-'));
beforeAll(async () => {
  core = await startCore({ dir, token, host: { root: coding } });
  ws = await new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${core.port}/?token=${token}`); w.on('open', () => res(w)); w.on('error', rej); });
});
afterAll(() => { ws.close(); return core.close(); });
const rpc = (method, params) => new Promise((res) => {
  const id = Math.random();
  const h = (raw) => { const m = JSON.parse(raw); if (m.id === id) { ws.off('message', h); res(m); } };
  ws.on('message', h); ws.send(JSON.stringify({ id, method, params }));
});
const ok = async (method, params) => { const m = await rpc(method, params); expect(m.error, method).toBeUndefined(); return m.result; };

describe('rpc surface', () => {
  it('backup.run writes files and backup.list sees them', async () => {
    const r = await ok('backup.run');
    expect(existsSync(r.path)).toBe(true);
    expect((await ok('backup.list')).items.length).toBeGreaterThan(0);
  });
  it('update feed must be https', async () => {
    expect((await rpc('update.setFeed', { feed: 'http://x' })).error.code).toBe('bad_request');
    expect((await ok('update.setFeed', { feed: 'https://example.com/l.json' })).feed).toBe('https://example.com/l.json');
    expect((await rpc('update.check')).error).toBeTruthy(); // egress is not allow-listed
  });
  it('ai.get, ai.set and ai.usage', async () => {
    expect((await ok('ai.get')).providers.some((p) => p.id === 'llamacpp')).toBe(true);
    await ok('ai.set', { routes: { chat: 'ollama' } });
    expect((await ok('ai.get')).routes.chat).toBe('ollama');
    expect(await ok('ai.usage')).toEqual({});
  });
  it('attachments: add, list, read, removeCard', async () => {
    const m = await ok('attachments.add', { cardId: 'c1', name: 'a.txt', mime: 'text/plain', data: Buffer.from('hi').toString('base64') });
    expect((await ok('attachments.list', { cardId: 'c1' })).map((a) => a.id)).toEqual([m.id]);
    await ok('attachments.removeCard', { cardId: 'c1' });
    expect(await ok('attachments.list', { cardId: 'c1' })).toEqual([]);
    expect((await rpc('attachments.add', { cardId: 'c1' })).error.code).toBe('bad_request');
  });
  it('notes: root, reindex and search', async () => {
    const notes = mkdtempSync(join(tmpdir(), 'lumen-notes-'));
    writeFileSync(join(notes, 'a.md'), '# Plan\nThe zeppelin schedule is Tuesday.');
    expect((await ok('notes.get')).root).toBeNull();
    await ok('notes.setRoot', { dir: notes });
    await ok('notes.reindex');
    expect((await ok('notes.search', { query: 'zeppelin' }))[0].path).toContain('a.md');
  });
  it('agents.list, google.status', async () => {
    expect(await ok('agents.list')).toEqual([]);
    expect(await ok('google.status')).toMatchObject({ connected: false });
    expect((await rpc('agents.get', { id: 'nope' })).error).toBeTruthy();
  });
  it('host:lumen folders go through mcp.callTool and stay inside their space', async () => {
    const r = await ok('mcp.callTool', { server: 'host:lumen', tool: 'ensure_folder', input: { space: 'perso', folder: '../../x y' } });
    expect(r.payload.folder).toBe('x-y');
    expect((await ok('mcp.callTool', { server: 'host:lumen', tool: 'list_folders', input: { space: 'perso' } })).payload.folders).toEqual(['x-y']);
  });
  it('saving the tasks document fills the cards table', async () => {
    await ok('db.set', { path: 'data/users/u/tasks', body: { items: [{ id: 'k', title: 'T', status: 'todo', order: 0 }] } });
    expect(core.store.cards('u').map((c) => c.id)).toEqual(['k']);
  });
});
