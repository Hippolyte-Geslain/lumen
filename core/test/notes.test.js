import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCore } from '../server.js';
import { chunk, ftsQuery } from '../notes.js';

describe('notes', () => {
  it('chunks long text and builds safe FTS queries', () => {
    expect(chunk('a\n\nb')).toEqual(['a\n\nb']);
    expect(chunk('x'.repeat(3000)).length).toBeGreaterThan(1);
    expect(ftsQuery('hello "world" OR (x)')).toBe('"hello"* "world"* "or"* "x"*');
    expect(ftsQuery('***')).toBe('');
  });
  it('indexes a folder incrementally and searches it', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'));
    mkdirSync(join(vault, '.obsidian')); mkdirSync(join(vault, 'sub'));
    writeFileSync(join(vault, 'a.md'), '# Plan\n\nShip the kanban board on Friday.');
    writeFileSync(join(vault, 'sub', 'b.txt'), 'Groceries: oat milk and coffee.');
    writeFileSync(join(vault, '.obsidian', 'x.md'), 'kanban secret config');
    writeFileSync(join(vault, 'img.png'), 'kanban');
    const core = await startCore({ dir: mkdtempSync(join(tmpdir(), 'lumen-')), token: 't' });
    const n = core.notes;
    expect(() => n.reindex()).toThrow(/Choose/);
    expect(() => n.setRoot(join(vault, 'nope'))).toThrow(/does not exist/);
    n.setRoot(vault);
    expect(n.reindex()).toMatchObject({ added: 2, removed: 0, files: 2 });
    expect(n.search('kanban').map((r) => r.path)).toEqual(['a.md']);
    expect(n.search('coff')[0].path).toBe('sub/b.txt');
    expect(n.reindex()).toMatchObject({ added: 0 });
    writeFileSync(join(vault, 'a.md'), 'Rewritten about sprint');
    utimesSync(join(vault, 'a.md'), new Date(), new Date(Date.now() + 5000));
    rmSync(join(vault, 'sub', 'b.txt'));
    expect(n.reindex()).toMatchObject({ added: 1, removed: 1 });
    expect(n.search('kanban')).toEqual([]);
    expect(n.search('sprint')).toHaveLength(1);
    await core.close();
  });
});
