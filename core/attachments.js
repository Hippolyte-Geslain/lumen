// Card attachments: metadata in the `attachments` table, bytes in <dir>/attachments/<id> (named by id only,
// so user-supplied names never touch the filesystem path).
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_BYTES = 20 * 1024 * 1024;
const err = (code, message) => Object.assign(new Error(message), { code });

export function createAttachments({ db, dir }) {
  const root = join(dir, 'attachments');
  mkdirSync(root, { recursive: true });
  db.exec('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS attachments_card ON attachments(card_id)');
  const ins = db.prepare('INSERT INTO attachments(id, card_id, name, mime, size, created) VALUES(?,?,?,?,?,?)');
  const byCard = db.prepare('SELECT id, card_id AS cardId, name, mime, size, created FROM attachments WHERE card_id = ? ORDER BY created');
  const one = db.prepare('SELECT id, card_id AS cardId, name, mime, size, created FROM attachments WHERE id = ?');
  const del = db.prepare('DELETE FROM attachments WHERE id = ?');
  const delCard = db.prepare('SELECT id FROM attachments WHERE card_id = ?');

  return {
    add({ cardId, name, mime = 'application/octet-stream', data }) {
      if (!cardId || !name || typeof data !== 'string') throw err('bad_request', 'cardId, name and base64 data are required');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length) throw err('bad_request', 'Empty file');
      if (bytes.length > MAX_BYTES) throw err('too_large', `Attachments are limited to ${MAX_BYTES / 1024 / 1024} MB`);
      const id = randomUUID();
      writeFileSync(join(root, id), bytes);
      const meta = { id, cardId, name: String(name).slice(0, 200), mime: String(mime).slice(0, 100), size: bytes.length, created: Date.now() };
      ins.run(meta.id, cardId, meta.name, meta.mime, meta.size, meta.created);
      return meta;
    },
    list: (cardId) => byCard.all(cardId),
    read(id) {
      const meta = one.get(id);
      if (!meta) throw err('not_found', 'No such attachment');
      return { ...meta, data: readFileSync(join(root, meta.id)).toString('base64') };
    },
    remove(id) {
      if (!one.get(id)) return false;
      rmSync(join(root, id), { force: true });
      del.run(id);
      return true;
    },
    removeCard(cardId) { for (const { id } of delCard.all(cardId)) this.remove(id); },
  };
}
