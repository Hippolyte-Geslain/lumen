import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';
import { createBackup } from '../backup.js';
import { createUpdater, isNewer } from '../update.js';

describe('backup', () => {
  it('writes a db copy and a JSON export without secrets, and keeps the last 10', () => {
    const s = openStore(mkdtempSync(join(tmpdir(), 'bk-')));
    s.set('data/users/u/tasks', { items: [{ id: 'a', title: 'x', status: 'todo', order: 0 }] });
    s.set('secrets/anthropic', { c: 'cipher' });
    let t = Date.UTC(2026, 0, 1);
    const b = createBackup({ store: s, now: () => (t += 1000) });
    const r = b.run();
    expect(existsSync(r.path)).toBe(true);
    const json = JSON.parse(readFileSync(r.json, 'utf8'));
    expect(Object.keys(json.docs)).toEqual(['data/users/u/tasks']);
    for (let i = 0; i < 12; i++) b.run();
    expect(b.list()).toHaveLength(10);
    s.close();
  });
});

describe('update check', () => {
  it('compares versions', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('v1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });
  it('requires https, reads the feed through the guard', async () => {
    const m = new Map(); const store = { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
    const u = createUpdater({ store, version: '0.1.0', guard: { fetch: async () => ({ ok: true, json: async () => ({ version: '0.2.0', url: 'https://x/y' }) }) } });
    await expect(u.check()).rejects.toMatchObject({ code: 'bad_request' });
    expect(() => u.setFeed('http://nope')).toThrow();
    u.setFeed('https://example.com/latest.json');
    expect(await u.check()).toMatchObject({ newer: true, latest: '0.2.0', url: 'https://x/y' });
  });
});
