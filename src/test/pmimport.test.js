import { describe, it, expect } from 'vitest';
import { clickupToBoard, notionToBoard } from '../lib/pmimport.js';

const uid = (p) => p + 'x';

describe('pm import', () => {
  it('maps ClickUp tasks to lists and cards', () => {
    const { lists, cards } = clickupToBoard({ tasks: [
      { name: 'A', status: { status: 'open' }, priority: { id: '2' }, due_date: '1700000000000', tags: [{ name: 'api' }], url: 'u' },
      { name: 'B', status: { status: 'Complete' }, date_closed: '1700000001000' },
      { name: 'C', status: { status: 'in review' } },
    ] }, { uid });
    expect(lists).toEqual([['open', 'open'], ['in-review', 'in review'], ['done', 'Complete']]);
    expect(cards.map((c) => [c.title, c.status])).toEqual([['A', 'open'], ['B', 'done'], ['C', 'in-review']]);
    expect(cards[0]).toMatchObject({ priority: 'high', due: 1700000000000, labels: [{ name: 'api', color: 'blue' }], source: { kind: 'clickup', url: 'u' } });
    expect(cards[1].doneAt).toBe(1700000001000);
    expect(() => clickupToBoard({})).toThrow();
  });
  it('maps Notion pages, using the status property and skipping archived pages', () => {
    const page = (t, s, extra = {}) => ({ url: 'n', created_time: '2026-01-01T00:00:00Z', properties: { Name: { type: 'title', title: [{ plain_text: t }] }, Status: { type: 'status', status: { name: s } }, Due: { type: 'date', date: { start: '2026-02-01' } }, Tags: { type: 'multi_select', multi_select: [{ name: 'x' }] } }, ...extra });
    const { lists, cards } = notionToBoard({ results: [page('One', 'Not started'), page('Two', 'Done'), page('Gone', 'Done', { archived: true })] }, { uid });
    expect(lists).toEqual([['not-started', 'Not started'], ['done', 'Done']]);
    expect(cards.map((c) => [c.title, c.status])).toEqual([['One', 'not-started'], ['Two', 'done']]);
    expect(cards[0]).toMatchObject({ due: Date.parse('2026-02-01'), labels: [{ name: 'x' }] });
  });
});
