import { describe, it, expect } from 'vitest';
import { parseTrello } from '../lib/trello.js';

const board = {
  name: 'Roadmap',
  lists: [{ id: 'l2', name: 'Done', pos: 3 }, { id: 'l1', name: 'Backlog', pos: 1 }, { id: 'l3', name: 'Doing!', pos: 2 }, { id: 'lx', name: 'Old', pos: 4, closed: true }],
  cards: [
    { id: 'c1', name: 'Ship it', idList: 'l3', pos: 2, labels: [{ name: '', color: 'red' }, { name: 'api', color: 'blue' }], due: '2026-11-01T10:00:00Z', desc: 'details' },
    { id: 'c2', name: 'Plan', idList: 'l1', pos: 1, labels: [] },
    { id: 'c3', name: 'Finished', idList: 'l2', pos: 1, labels: [] },
    { id: 'c4', name: 'Archived', idList: 'l1', pos: 9, closed: true, labels: [] },
    { id: 'c5', name: 'In closed list', idList: 'lx', pos: 1, labels: [] },
  ],
  checklists: [{ idCard: 'c1', checkItems: [{ name: 'a', state: 'complete', pos: 1 }, { name: 'b', state: 'incomplete', pos: 2 }] }],
  actions: [{ type: 'commentCard', date: '2026-10-01T00:00:00Z', data: { card: { id: 'c1' }, text: 'hello' } }],
};

describe('parseTrello', () => {
  const r = parseTrello(board, { uid: (p) => p + 'x' });
  it('maps lists in position order, Done to the reserved key', () => {
    expect(r.name).toBe('Roadmap');
    expect(r.lists).toEqual([['backlog', 'Backlog'], ['doing', 'Doing!'], ['done', 'Done']]);
  });
  it('keeps open cards only, with labels, checklist and comments', () => {
    expect(r.cards.map((c) => c.title)).toEqual(['Plan', 'Finished', 'Ship it']);
    const c = r.cards.find((x) => x.title === 'Ship it');
    expect(c.status).toBe('doing');
    expect(c.labels).toEqual([{ name: 'red', color: 'red' }, { name: 'api', color: 'blue' }]);
    expect(c.subtasks.map((s) => s.done)).toEqual([true, false]);
    expect(c.comments[0].text).toBe('hello');
    expect(r.cards.find((x) => x.title === 'Finished').doneAt).toBeTruthy();
  });
  it('rejects other JSON', () => { expect(() => parseTrello({})).toThrow(/Trello/); });
});
