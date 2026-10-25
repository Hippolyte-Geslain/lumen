import { describe, it, expect, beforeAll } from 'vitest';

let S;
beforeAll(async () => {
  globalThis.window = globalThis.window || {};
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  S = await import('../store.js');
});

describe('boards', () => {
  it('migrates legacy boardLists into the first board', () => {
    S.state.settings.boards = null;
    S.state.settings.boardLists = [['a', 'A'], ['done', 'Finished']];
    expect(S.boards()).toHaveLength(1);
    expect(S.boards()[0].lists).toEqual([['a', 'A'], ['done', 'Finished']]);
    expect(S.state.settings.boardLists).toBeUndefined();
  });
  it('add, switch, scope cards, delete rehomes cards', () => {
    const first = S.boards()[0].id;
    S.state.tasks = [
      { id: 't1', status: 'a', order: 0 },
      { id: 't2', status: 'a', order: 1, boardId: first },
    ];
    const id = S.addBoard('Side project');
    expect(S.activeBoard().id).toBe(id);
    expect(S.STATUSES.map(([k]) => k)).toEqual(['todo', 'doing', 'review', 'done']);
    expect(S.boardTasks()).toHaveLength(0);
    expect(S.cardTasks()).toHaveLength(2);
    S.state.tasks.push({ id: 't3', status: 'todo', order: 2, boardId: id });
    expect(S.boardTasks().map((t) => t.id)).toEqual(['t3']);
    expect(S.deleteBoard(id)).toBe(true);
    expect(S.activeBoard().id).toBe(first);
    expect(S.boardTasks().map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(S.state.tasks.find((t) => t.id === 't3').status).toBe('a'); // orphan status rehomed to the first list
    expect(S.deleteBoard(first)).toBe(false);
  });
  it('setBoardLists keeps done last', () => {
    S.setBoardLists([['x', 'X'], ['done', 'D'], ['y', 'Y']]);
    expect(S.STATUSES.map(([k]) => k)).toEqual(['x', 'y', 'done']);
  });
});
