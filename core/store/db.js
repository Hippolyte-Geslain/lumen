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
  // Relational projection of the board: the UI still saves whole documents (kv), and every save of a tasks document
  // is mirrored into `cards` in the same transaction, so the core can query, join and enforce integrity on real rows.
  db.exec(`CREATE TABLE IF NOT EXISTS cards (
    owner TEXT NOT NULL, id TEXT NOT NULL, board_id TEXT, status TEXT NOT NULL, title TEXT NOT NULL, priority TEXT,
    due INTEGER, done_at INTEGER, project_id TEXT, labels TEXT, updated INTEGER NOT NULL, PRIMARY KEY (owner, id))`);
  db.exec('CREATE INDEX IF NOT EXISTS cards_board ON cards(owner, board_id, status)');
  const TASKS = /^data\/users\/([^/]+)\/tasks$/;
  const delCards = db.prepare('DELETE FROM cards WHERE owner = ?');
  const insCard = db.prepare('INSERT OR REPLACE INTO cards(owner,id,board_id,status,title,priority,due,done_at,project_id,labels,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const num = (v) => (Number.isFinite(v) ? v : null);
  function mirror(path, body) {
    const m = TASKS.exec(path);
    if (!m || !Array.isArray(body?.items)) return;
    const now = Date.now();
    db.exec('BEGIN');
    try {
      delCards.run(m[1]);
      for (const t of body.items) {
        if (!t || typeof t.id !== 'string' || !(t.order < 1000)) continue;
        insCard.run(m[1], t.id, t.boardId ?? null, String(t.status ?? ''), String(t.title ?? ''), t.priority ?? null, num(t.due), num(t.doneAt), t.projectId ?? null, JSON.stringify((t.labels || []).map((l) => l.name)), now);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const sel = db.prepare('SELECT body FROM kv WHERE path = ?');
  const ups = db.prepare('INSERT INTO kv(path, body, updated) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body, updated=excluded.updated');
  const watchers = new Map();
  for (const r of db.prepare("SELECT path, body FROM kv WHERE path LIKE 'data/users/%/tasks'").all()) { try { mirror(r.path, JSON.parse(r.body)); } catch { /* corrupt row: skip */ } }
  const cardRows = db.prepare('SELECT * FROM cards WHERE owner = ? AND (? IS NULL OR board_id IS ?) AND (? IS NULL OR status = ?) ORDER BY due');
  return {
    get(path) {
      const row = sel.get(path);
      return row ? JSON.parse(row.body) : null;
    },
    set(path, body) {
      ups.run(path, JSON.stringify(body), Date.now());
      mirror(path, body);
      for (const fn of watchers.get(path) || []) fn(body);
    },
    watch(path, fn) {
      if (!watchers.has(path)) watchers.set(path, new Set());
      watchers.get(path).add(fn);
      return () => watchers.get(path).delete(fn);
    },
    /** Query the card projection: cards(owner, { board, status }). */
    cards(owner, { board = null, status = null } = {}) { return cardRows.all(owner, board, board, status, status).map((r) => ({ ...r, labels: JSON.parse(r.labels || '[]') })); },
    db, dir,
    close() { db.close(); },
  };
}
