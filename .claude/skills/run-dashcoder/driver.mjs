// Starts the Lumen core + vite, drives the page with Playwright, screenshots, then stops both.
// Run from the repo root:  node .claude/skills/run-dashcoder/driver.mjs [--agent]
//   --agent also starts a real Claude Code session (needs `claude` logged in; costs ~$0.10).
// Env: CHROME (browser path), OUT (screenshot dir, default os.tmpdir()/lumen-run).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT || join(tmpdir(), 'lumen-run');
const PORT = 47811, TOKEN = 'testtoken', WEB = 5173;
const withAgent = process.argv.includes('--agent');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'lumen-data-'));
const coding = mkdtempSync(join(tmpdir(), 'lumen-coding-'));
mkdirSync(join(coding, 'perso'));

const procs = [];
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'ignore', shell: process.platform === 'win32' && cmd === 'npx' });
  procs.push(p);
};
// taskkill /T because npx spawns vite as a grandchild on Windows
const stop = () => procs.forEach((p) => (process.platform === 'win32' ? spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)]) : p.kill()));
const until = async (url, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('timeout waiting for ' + url);
};
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) process.exitCode = 1; };

start('node', ['core/index.js'], { LUMEN_DATA_DIR: data, LUMEN_CORE_PORT: String(PORT), LUMEN_CORE_TOKEN: TOKEN, LUMEN_CODING_ROOT: coding });
start('npx', ['vite', '--port', String(WEB), '--strictPort']);
try {
  await until(`http://127.0.0.1:${PORT}/health`);
  await until(`http://localhost:${WEB}/`);
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const url = (hash) => `http://localhost:${WEB}/?core_port=${PORT}&core_token=${TOKEN}#/${hash}`;

  await p.goto(url('settings'));
  await p.waitForTimeout(2500);
  ok('core connected (window.claude.local)', await p.evaluate(() => !!window.claude?.local));
  const heads = await p.$$eval('h2', (n) => n.map((x) => x.textContent.trim()));
  for (const h of ['Board', 'Automations', 'AI models', 'Notes', 'Google', 'ClickUp & Notion', 'Sovereignty', 'Data']) ok('settings section ' + h, heads.includes(h));
  await p.screenshot({ path: join(OUT, 'settings.png'), fullPage: true });

  const caps = await p.evaluate(async () => {
    const u = (n) => window.claude.use(n);
    const m = await u('mcp');
    return {
      providers: (await (await u('ai')).get()).providers.map((x) => x.id),
      backup: !!(await (await u('backup')).run()).path,
      update: (await (await u('update')).get()).version,
      folders: Array.isArray(((await m.callTool('host:lumen', 'list_folders', { space: 'perso' })).payload).folders),
    };
  });
  ok('ai providers incl. llamacpp', caps.providers.includes('llamacpp'));
  ok('backup writes files', caps.backup);
  ok('update version', !!caps.update, caps.update);
  ok('host:lumen list_folders', caps.folders);

  // Automation rule through the UI, then fire it by moving a card to Done
  await p.selectOption('[data-auto="trigger"]', 'card_moved');
  await p.selectOption('[data-auto="to"]', 'done');
  await p.selectOption('[data-auto="action"]', 'notify');
  await p.fill('[data-auto="text"]', 'Shipped {{title}}');
  await p.click('[data-act="auto-add"]');
  await p.waitForTimeout(500);
  ok('rule added', (await p.$$('[data-auto-list] .cell b')).length === 1);
  await p.selectOption('[data-auto="trigger"]', 'daily');
  await p.selectOption('[data-auto="action"]', 'complete_task');
  await p.click('[data-act="auto-add"]');
  await p.waitForTimeout(300);
  ok('invalid rule rejected', (await p.$$('[data-auto-list] .cell b')).length === 1);

  await p.goto(url('tasks'));
  await p.waitForTimeout(2000);
  const fired = await p.evaluate(async () => {
    const s = await import('/src/store.js');
    const t = { id: 'ui1', title: 'Probe card', status: 'todo', priority: 'medium', assignee: s.state.me, due: Date.now() + 1e8, created: Date.now(), doneAt: null, est: 1, order: -1, subtasks: [], comments: [], notes: '', boardId: s.activeBoard().id };
    s.state.tasks.push(t); s.commit('tasks');
    await new Promise((r) => setTimeout(r, 200));
    s.setTaskStatus(t, 'done');
    await new Promise((r) => setTimeout(r, 600));
    return document.body.innerText.includes('Shipped Probe card');
  });
  ok('automation fired toast', fired);
  await p.screenshot({ path: join(OUT, 'board.png') });

  if (withAgent) {
    const run = await p.evaluate(async () => {
      const m = await window.claude.use('mcp');
      const r = await m.callTool('host:lumen', 'start_session', { task_id: 'ui1', task_title: 'Probe', space: 'perso', folder: 'probe', prompt: 'Do not use any tools. Reply with exactly these lines:\nSUMMARY: Said hello.\nSTATUS: done' });
      const id = (r.payload ?? r).run_id; let last;
      for (let i = 0; i < 60; i++) {
        await new Promise((x) => setTimeout(x, 2000));
        last = ((await m.callTool('host:lumen', 'session_status', {})).payload ?? {}).runs?.find((x) => x.run_id === id);
        if (last && !['queued', 'running'].includes(last.status)) break;
      }
      return last;
    });
    ok('agent run done', run?.status === 'done' && run.summary === 'Said hello.', JSON.stringify({ status: run?.status, error: run?.error }));
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log('screenshots in', OUT);
  await b.close();
} finally { stop(); }
