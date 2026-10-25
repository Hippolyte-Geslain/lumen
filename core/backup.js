// Backups: a consistent copy of the SQLite file plus a readable JSON export of every document.
// Secrets are never exported: they are ciphertext bound to this machine's account and useless elsewhere.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 10;
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

export function createBackup({ store, now = () => Date.now() }) {
  const dir = join(store.dir, 'backups');
  return {
    dir,
    run() {
      mkdirSync(dir, { recursive: true });
      const base = join(dir, `lumen-${stamp(now())}`);
      store.db.exec(`VACUUM INTO '${`${base}.db`.replace(/'/g, "''")}'`);
      const docs = {};
      for (const r of store.db.prepare("SELECT path, body FROM kv WHERE path NOT LIKE 'secrets/%'").all()) docs[r.path] = JSON.parse(r.body);
      writeFileSync(`${base}.json`, JSON.stringify({ app: 'lumen', exported: now(), docs }, null, 1));
      const files = readdirSync(dir).filter((f) => /^lumen-.*\.(db|json)$/.test(f)).sort();
      const stems = [...new Set(files.map((f) => f.replace(/\.(db|json)$/, '')))];
      for (const stem of stems.slice(0, -KEEP)) for (const ext of ['db', 'json']) rmSync(join(dir, `${stem}.${ext}`), { force: true });
      return { path: `${base}.db`, json: `${base}.json` };
    },
    list() {
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().map((f) => ({ name: f, size: statSync(join(dir, f)).size }));
      } catch { return []; }
    },
  };
}
