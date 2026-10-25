import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createAgents, parseResult, describeTool } from '../agents.js';

const memStore = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }; };
const guard = (mode = 'local') => ({ getMode: () => mode });
function fakeSpawn(events, log = []) {
  return (cmd, args) => {
    const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
    p.stdin = { end: (t) => log.push({ args, prompt: t }) };
    p.kill = () => p.emit('close', 1);
    setImmediate(() => { for (const e of events) p.stdout.write(`${JSON.stringify(e)}\n`); p.emit('close', 0); });
    return p;
  };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
function repo() { const d = mkdtempSync(join(tmpdir(), 'repo-')); mkdirSync(join(d, '.git')); return d; }

describe('agents', () => {
  it('parses the protocol lines and describes tools', () => {
    expect(parseResult('done.\nSUMMARY: Fixed it.\nSTATUS: needs-input\nQUESTION: Which?\nOPTIONS: a | b')).toMatchObject({ summary: 'Fixed it.', status: 'waiting', question: 'Which?', options: ['a', 'b'] });
    expect(describeTool('Edit', { file_path: 'C:\\x\\y.js' })).toBe('Editing y.js');
  });
  it('runs a card in a worktree and records the result', async () => {
    const calls = []; const log = [];
    const store = memStore();
    const a = createAgents({ store, guard: guard(), dir: mkdtempSync(join(tmpdir(), 'ag-')), gitRun: async (args) => calls.push(args),
      spawn: fakeSpawn([
        { type: 'system', subtype: 'init', session_id: 's1' },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/w/a.js' } }] } },
        { type: 'result', result: 'ok\nSUMMARY: Added a.js.\nSTATUS: done', total_cost_usd: 0.02, session_id: 's1' },
      ], log) });
    const r = await a.start({ cardId: 'c1', title: 'Add A', prompt: 'do it', repo: repo() });
    expect(calls[0].slice(0, 3)).toEqual(['worktree', 'add', '-b']);
    expect(r.branch).toMatch(/^lumen\/add-a-/);
    await tick();
    const got = a.get(r.run_id);
    expect(got).toMatchObject({ status: 'done', summary: 'Added a.js.', files: ['/w/a.js'], session_id: 's1' });
    expect(log[0].args).toContain('acceptEdits');
    expect(log[0].prompt).toBe('do it');
    expect(store.get('agents/runs')).toHaveLength(1);
  });
  it('validates input and blocks in air-gapped mode', async () => {
    const a = createAgents({ store: memStore(), guard: guard('airgap'), dir: tmpdir(), gitRun: async () => '', spawn: fakeSpawn([]) });
    await expect(a.start({ prompt: 'x', repo: tmpdir() })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(a.start({ prompt: 'x', repo: repo(), mode: 'yolo' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(a.start({ repo: repo() })).rejects.toMatchObject({ code: 'bad_request' });
    const r = await a.start({ prompt: 'x', repo: repo() });
    expect(a.get(r.run_id)).toMatchObject({ status: 'error', error: expect.stringContaining('Air-gapped') });
  });
  it('resumes a waiting run with the answer', async () => {
    const log = [];
    const a = createAgents({ store: memStore(), guard: guard(), dir: tmpdir(), gitRun: async () => '',
      spawn: fakeSpawn([{ type: 'result', result: 'SUMMARY: q\nSTATUS: needs-input\nQUESTION: Which?', session_id: 's9' }], log) });
    const r = await a.start({ prompt: 'x', repo: repo() });
    await tick();
    expect(a.get(r.run_id)).toMatchObject({ status: 'waiting', question: 'Which?' });
    a.resume(r.run_id, 'option A');
    await tick();
    expect(log[1].args).toContain('--resume');
    expect(log[1].prompt).toBe('option A');
  });
});
