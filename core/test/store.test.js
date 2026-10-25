import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';

const P = 'data/users/u1/tasks';
const task = (id, o = {}) => ({ id, title: id, status: 'todo', priority: 'medium', order: 0, due: 100, ...o });

describe('cards projection', () => {
  it('mirrors every save of the tasks document into relational rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-'));
    const s = openStore(dir);
    s.set(P, { items: [task('a', { boardId: 'main', labels: [{ name: 'bug' }] }), task('b', { boardId: 'two', status: 'done' }), task('sub', { order: 2000 })] });
    expect(s.cards('u1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(s.cards('u1', { board: 'main' })[0]).toMatchObject({ id: 'a', labels: ['bug'] });
    expect(s.cards('u1', { status: 'done' }).map((c) => c.id)).toEqual(['b']);
    s.set(P, { items: [task('a')] });
    expect(s.cards('u1').map((c) => c.id)).toEqual(['a']);
    expect(s.cards('someone-else')).toEqual([]);
    s.close();
  });
  it('backfills from documents saved before the table existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-'));
    const s = openStore(dir);
    s.set(P, { items: [task('z')] });
    s.db.exec('DELETE FROM cards');
    s.close();
    const again = openStore(dir);
    expect(again.cards('u1').map((c) => c.id)).toEqual(['z']);
    again.close();
  });
});
