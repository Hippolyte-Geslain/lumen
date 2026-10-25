import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite'); // require() avoids vite stripping the node: prefix
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Local source of truth. kv(path, body, updated) mirrors the db.collection().doc() shape the UI expects.
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'lumen.db'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE IF NOT EXISTS kv (path TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL)');
  const sel = db.prepare('SELECT body FROM kv WHERE path = ?');
  const ups = db.prepare('INSERT INTO kv(path, body, updated) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body, updated=excluded.updated');
  const watchers = new Map();
  return {
    get(path) {
      const row = sel.get(path);
      return row ? JSON.parse(row.body) : null;
    },
    set(path, body) {
      ups.run(path, JSON.stringify(body), Date.now());
      for (const fn of watchers.get(path) || []) fn(body);
    },
    watch(path, fn) {
      if (!watchers.has(path)) watchers.set(path, new Set());
      watchers.get(path).add(fn);
      return () => watchers.get(path).delete(fn);
    },
    db, dir,
    close() { db.close(); },
  };
}
