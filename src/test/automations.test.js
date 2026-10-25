import { describe, it, expect } from 'vitest';
import { cleanRules, eventsFromDiff, plan, dailyDue, describeRule } from '../lib/automations.js';

const S = ['todo', 'doing', 'done'];
const rule = (o) => ({ id: 'r', on: true, ...o });

describe('automations', () => {
  it('drops malformed rules', () => {
    const rules = cleanRules([
      rule({ trigger: { type: 'card_moved', to: 'done' }, action: { type: 'notify', text: 'Nice' } }),
      rule({ trigger: { type: 'card_moved', to: 'nope' }, action: { type: 'notify', text: 'x' } }),
      rule({ trigger: { type: 'daily', at: '25:00' }, action: { type: 'notify', text: 'x' } }),
      rule({ trigger: { type: 'daily', at: '08:00' }, action: { type: 'complete_task' } }),
      rule({ trigger: { type: 'card_created' }, action: { type: 'move_task', status: 'zzz' } }),
      { nope: 1 },
    ], S);
    expect(rules).toHaveLength(1);
  });
  it('diffs snapshots into events', () => {
    const prev = new Map([['a', 'todo'], ['b', 'doing']]);
    const ev = eventsFromDiff(prev, [{ id: 'a', status: 'doing' }, { id: 'b', status: 'doing' }, { id: 'c', status: 'todo' }]);
    expect(ev.map((e) => [e.type, e.task.id])).toEqual([['card_moved', 'a'], ['card_created', 'c']]);
  });
  it('plans actions bound to the triggering card and skips no-ops', () => {
    const rules = cleanRules([
      rule({ id: '1', trigger: { type: 'card_moved', to: 'done' }, action: { type: 'notify', text: 'Shipped {{title}}' } }),
      rule({ id: '2', trigger: { type: 'card_created' }, action: { type: 'set_priority', priority: 'high' } }),
    ], S);
    const moved = { type: 'card_moved', task: { id: 'a', title: 'Fix', status: 'done', priority: 'low' }, to: 'done' };
    expect(plan(rules, moved)).toEqual([{ rule: '1', a: { type: 'notify', text: 'Shipped Fix' } }]);
    const made = { type: 'card_created', task: { id: 'b', title: 'N', status: 'todo', priority: 'medium' } };
    expect(plan(rules, made)[0].a).toEqual({ type: 'set_priority', priority: 'high', id: 'b' });
    expect(plan(rules, { ...made, task: { ...made.task, priority: 'high' } })).toEqual([]);
    expect(plan([{ ...rules[0], on: false }], moved)).toEqual([]);
  });
  it('fires a daily rule once after its time', () => {
    const r = rule({ trigger: { type: 'daily', at: '08:00' }, action: { type: 'notify', text: 'x' } });
    const at = (h) => new Date(2026, 9, 25, h, 5).getTime();
    expect(dailyDue(r, at(7), 0)).toBe(false);
    expect(dailyDue(r, at(9), 0)).toBe(true);
    expect(dailyDue(r, at(9), at(8))).toBe(false);
    expect(dailyDue(r, at(9), at(8) - 86_400_000)).toBe(true);
  });
  it('describes a rule in words', () => {
    expect(describeRule(rule({ trigger: { type: 'card_moved', to: 'done' }, action: { type: 'notify', text: 'Nice' } }))).toBe('When a card moves to done, notify “Nice”');
  });
});

describe('automation actions', () => {
  it('validates run_agent and brief against their triggers', () => {
    const ok = cleanRules([
      { id: 'a', on: true, trigger: { type: 'card_moved', to: 'doing' }, action: { type: 'run_agent' } },
      { id: 'b', on: true, trigger: { type: 'daily', at: '08:00' }, action: { type: 'brief' } },
      { id: 'c', on: true, trigger: { type: 'daily', at: '08:00' }, action: { type: 'run_agent' } },
      { id: 'd', on: true, trigger: { type: 'card_created' }, action: { type: 'brief' } },
    ], ['todo', 'doing', 'done']);
    expect(ok.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan(ok, { type: 'daily' })).toEqual([{ rule: 'b', a: { type: 'brief' } }]);
    expect(plan(ok, { type: 'card_moved', to: 'doing', task: { id: 'x', status: 'doing' } })[0].a).toEqual({ type: 'run_agent', id: 'x' });
  });
});
