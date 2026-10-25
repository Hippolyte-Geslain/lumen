// Notes index: walks a user-chosen folder (Markdown/text, e.g. an Obsidian vault), chunks files and
// serves keyword search through SQLite FTS5 (BM25). Reindexing is incremental by mtime+size.
// Embedding-based search can sit on top later; this works fully offline with no model.
import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

const EXT = new Set(['.md', '.markdown', '.txt']);
const SKIP = new Set(['.git', '.obsidian', 'node_modules', '.trash']);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 20000;
const CHUNK = 1200;
const err = (code, message) => Object.assign(new Error(message), { code });

export function chunk(text) {
  const out = [];
  let cur = '';
  for (const para of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    if (cur && cur.length + para.length > CHUNK) { out.push(cur.trim()); cur = ''; }
    cur += (cur ? '\n\n' : '') + para;
    while (cur.length > CHUNK * 2) { out.push(cur.slice(0, CHUNK).trim()); cur = cur.slice(CHUNK); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Turn free text into a safe FTS5 query: quoted prefix terms joined with AND. */
export function ftsQuery(q) {
  const terms = String(q).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  return terms.slice(0, 12).map((t) => `"${t}"*`).join(' ');
}

export function createNotes({ db, store }) {
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS note_chunks USING fts5(path UNINDEXED, n UNINDEXED, body)');
  db.exec('CREATE TABLE IF NOT EXISTS note_files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL)');
  const files = db.prepare('SELECT path, mtime, size FROM note_files');
  const upFile = db.prepare('INSERT INTO note_files(path, mtime, size) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size');
  const delFile = db.prepare('DELETE FROM note_files WHERE path = ?');
  const delChunks = db.prepare('DELETE FROM note_chunks WHERE path = ?');
  const insChunk = db.prepare('INSERT INTO note_chunks(path, n, body) VALUES(?,?,?)');
  const q = db.prepare("SELECT path, n, snippet(note_chunks, 2, '[', ']', '…', 24) AS snippet FROM note_chunks WHERE note_chunks MATCH ? ORDER BY bm25(note_chunks) LIMIT ?");
  const getChunk = db.prepare('SELECT body FROM note_chunks WHERE path = ? AND n = ?');

  const root = () => store.get('settings/notes')?.root || null;

  function walk(base) {
    const out = [];
    const stack = [base];
    while (stack.length && out.length < MAX_FILES) {
      const d = stack.pop();
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isSymbolicLink() || SKIP.has(e.name)) continue; // never follow links out of the folder
        const p = join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (EXT.has(extname(e.name).toLowerCase())) out.push(p);
      }
    }
    return out;
  }

  return {
    root,
    setRoot(dir) {
      if (dir == null || dir === '') { store.set('settings/notes', {}); this.clear(); return null; }
      let real;
      try { real = realpathSync(String(dir)); if (!statSync(real).isDirectory()) throw 0; } catch { throw err('bad_request', 'That folder does not exist'); }
      store.set('settings/notes', { root: real });
      this.clear();
      return real;
    },
    clear() { db.exec('DELETE FROM note_chunks; DELETE FROM note_files'); },
    /** Incremental scan: adds/updates changed files, drops removed ones. */
    reindex() {
      const base = root();
      if (!base) throw err('not_configured', 'Choose a notes folder first');
      const known = new Map(files.all().map((f) => [f.path, f]));
      let added = 0; let removed = 0; let skipped = 0;
      const seen = new Set();
      for (const abs of walk(base)) {
        const rel = relative(base, abs).split(sep).join('/');
        seen.add(rel);
        const st = statSync(abs);
        if (st.size > MAX_FILE) { skipped++; continue; }
        const prev = known.get(rel);
        if (prev && prev.mtime === Math.floor(st.mtimeMs) && prev.size === st.size) continue;
        delChunks.run(rel);
        chunk(readFileSync(abs, 'utf8')).forEach((c, i) => insChunk.run(rel, i, c));
        upFile.run(rel, Math.floor(st.mtimeMs), st.size);
        added++;
      }
      for (const p of known.keys()) if (!seen.has(p)) { delChunks.run(p); delFile.run(p); removed++; }
      return { added, removed, skipped, files: seen.size };
    },
    search(query, limit = 8) {
      const m = ftsQuery(query);
      if (!m) return [];
      return q.all(m, Math.min(Math.max(+limit || 8, 1), 25)).map(({ path, n, snippet }) => ({ path, n, snippet }));
    },
    /** Full chunk text for context building. */
    chunkText(path, n) { return getChunk.get(path, n)?.body ?? null; },
  };
}
