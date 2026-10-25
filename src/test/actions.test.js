import { describe, it, expect } from 'vitest';
import { parseActions, describeAction } from '../lib/actions.js';

const ctx = { statuses: ['todo', 'doing', 'done'], taskIds: new Set(['t1']) };
const wrap = (j) => `Sure.\n\`\`\`actions\n${typeof j === 'string' ? j : JSON.stringify(j)}\n\`\`\``;

describe('parseActions', () => {
  it('returns plain text when there is no block', () => {
    expect(parseActions('hello', ctx)).toEqual({ text: 'hello', actions: [] });
  });
  it('extracts valid actions and strips the block', () => {
    const r = parseActions(wrap([{ type: 'create_task', title: 'Write docs', status: 'todo', due: '2026-11-02' }, { type: 'complete_task', id: 't1' }]), ctx);
    expect(r.text).toBe('Sure.');
    expect(r.actions.map((a) => a.type)).toEqual(['create_task', 'complete_task']);
  });
  it('drops unknown types, ids, statuses, priorities and bad dates', () => {
    const r = parseActions(wrap([
      { type: 'delete_everything' }, { type: 'move_task', id: 'nope', status: 'todo' }, { type: 'move_task', id: 't1', status: 'limbo' },
      { type: 'set_priority', id: 't1', priority: 'asap' }, { type: 'create_task', title: 'x', due: 'tomorrow' }, { type: 'create_task', title: '' }, null,
    ]), ctx);
    expect(r.actions).toEqual([]);
  });
  it('survives malformed JSON', () => {
    expect(parseActions(wrap('[{oops'), ctx).actions).toEqual([]);
  });
  it('describes actions', () => {
    expect(describeAction({ type: 'move_task', id: 't1', status: 'doing' }, { title: () => 'Ship' })).toBe('Move “Ship” to doing');
  });
});
