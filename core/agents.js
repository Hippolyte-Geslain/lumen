// Agent runner: one Claude Code session per card, each in its own git worktree so parallel runs never collide.
// Drives the user's own signed-in CLI (no credentials pass through Lumen). State lives in the store at
// `agents/runs`, so the WS `db.subscribe` channel pushes every change to the dock without polling.
import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const err = (code, message) => Object.assign(new Error(message), { code });
export const MODES = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
const KEEP = 80;

const PROTOCOL = `You are running in the background for the Lumen dashboard. The user reads a short summary on their task board. Work autonomously inside the current folder.
When you finish, or cannot continue without the user, end your final message with these lines:
SUMMARY: <2-3 plain sentences: what you did and the outcome>
STATUS: done | blocked | needs-input
QUESTION: <one precise question>            (only with STATUS: needs-input)
OPTIONS: <short option> | <short option>     (optional, with QUESTION)
MEMORY: <one durable fact about this project worth remembering next time>   (repeat per fact; skip trivia)
DRAFT: <email tasks only: the full reply text; may span several lines; put it last>
Never ask for confirmation mid-work; only use needs-input for decisions that truly block you.`;

const short = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const base = (p) => String(p || '').split(/[\\/]/).pop() || 'a file';

export function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  switch (name) {
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editing ${base(file)}`;
    case 'Write': return `Writing ${base(file)}`;
    case 'Read': return `Reading ${base(file)}`;
    case 'Bash': case 'PowerShell': return `Running ${short(input.command, 60)}`;
    case 'Grep': case 'Glob': return `Searching the code${input.pattern ? ` for ${short(input.pattern, 40)}` : ''}`;
    case 'Task': case 'Agent': return `Delegating: ${short(input.description || input.prompt, 60)}`;
    case 'WebSearch': return `Searching the web: ${short(input.query, 60)}`;
    case 'WebFetch': return 'Reading a web page';
    case 'TodoWrite': return 'Updating its plan';
    default: return name.startsWith('mcp__') ? `Using ${name.split('__').slice(1).join(' ')}` : `Using ${name}`;
  }
}

/** Parse the SUMMARY/STATUS/QUESTION/OPTIONS lines at the end of the final message. */
export function parseResult(text) {
  const out = { summary: '', status: 'done', question: '', options: [], memory: [], draft: '' };
  let draftAt = -1;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\**(SUMMARY|STATUS|QUESTION|OPTIONS|MEMORY|DRAFT)\**\s*:\s*(.*)$/);
    if (!m) return;
    const [, key, v] = m;
    if (key === 'MEMORY' && v.trim()) out.memory.push(v.trim().slice(0, 240));
    if (key === 'DRAFT') draftAt = i;
    if (key === 'SUMMARY') out.summary = v.trim();
    if (key === 'STATUS') out.status = /needs/i.test(v) ? 'waiting' : /block/i.test(v) ? 'blocked' : 'done';
    if (key === 'QUESTION') out.question = v.trim();
    if (key === 'OPTIONS') out.options = v.split('|').map((o) => o.trim()).filter(Boolean).slice(0, 5);
  });
  if (draftAt >= 0) out.draft = [lines[draftAt].replace(/^\s*\**DRAFT\**\s*:\s*/, ''), ...lines.slice(draftAt + 1)].join('\n').trim();
  if (!out.summary) out.summary = short(lines.filter((l) => l.trim()).slice(-3).join(' '), 400);
  if (out.question && out.status === 'done') out.status = 'waiting';
  return out;
}

const git = (args, cwd) => new Promise((res, rej) => execFile('git', args, { cwd, windowsHide: true, timeout: 30_000 }, (e, stdout, stderr) => (e ? rej(err('git_failed', short(stderr || e.message, 300))) : res(stdout.trim()))));

export function createAgents({ store, guard, spawn = nodeSpawn, dir, limit = 3, claude = 'claude', gitRun = git }) {
  const KEY = 'agents/runs';
  let runs = (store.get(KEY) || []).map((r) => (r.status === 'running' || r.status === 'queued' ? { ...r, status: 'interrupted', live: 'Lumen restarted; resume to continue.' } : r));
  const procs = new Map();
  const save = () => store.set(KEY, runs.slice(-KEEP));
  const find = (id) => runs.find((r) => r.run_id === id) || (() => { throw err('not_found', 'No such run'); })();
  const touch = (r, patch) => { Object.assign(r, patch, { updated: Date.now() }); save(); };
  const view = (r) => ({ ...r });

  function pump() {
    const running = runs.filter((r) => r.status === 'running').length;
    for (const r of runs.filter((x) => x.status === 'queued').slice(0, Math.max(0, limit - running))) launch(r);
  }

  function launch(r) {
    if (guard.getMode() === 'airgap') return touch(r, { status: 'error', live: '', error: 'Air-gapped mode blocks Claude Code' });
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', r.mode, '--append-system-prompt', PROTOCOL];
    if (r.session_id) args.push('--resume', r.session_id);
    touch(r, { status: 'running', live: r.session_id ? 'Resuming…' : 'Starting…' });
    let child;
    try { child = spawn(claude, args, { cwd: r.cwd, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(claude) }); } catch (e) { return touch(r, { status: 'error', live: '', error: `Could not start Claude Code: ${e.message}` }); }
    procs.set(r.run_id, child);
    child.stdin.end(r.pending_prompt || '');
    delete r.pending_prompt;
    let buf = ''; let lastText = ''; let errTail = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') touch(r, { session_id: ev.session_id });
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content || []) {
            if (b.type === 'tool_use') {
              const f = b.input?.file_path;
              if (f && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name) && !r.files.includes(f)) r.files.push(f);
              touch(r, { live: describeTool(b.name, b.input), steps: (r.steps || 0) + 1 });
            } else if (b.type === 'text' && b.text.trim()) {
              lastText = b.text;
              const first = b.text.split(/(?<=[.!?])\s|\n/)[0];
              if (!/^\s*\**(SUMMARY|STATUS|QUESTION|OPTIONS|MEMORY|DRAFT)\b/.test(first)) touch(r, { live: short(first) });
            }
          }
        }
        if (ev.type === 'result') {
          const p = parseResult(ev.result || lastText);
          const authFail = ev.is_error && /authenticat|login|oauth/i.test(ev.result || '');
          touch(r, {
            status: ev.is_error ? 'error' : p.status, live: '', summary: p.summary,
            question: p.status === 'waiting' ? p.question : '', options: p.status === 'waiting' ? p.options : [], memory: p.memory, draft: p.draft,
            error: ev.is_error ? (authFail ? 'Claude Code is signed out. Run "claude /login" in a terminal, then resume.' : short(ev.result, 300)) : '',
            cost: (r.cost || 0) + (ev.total_cost_usd || 0), session_id: ev.session_id || r.session_id,
          });
        }
      }
    });
    child.stderr.on('data', (c) => (errTail = (errTail + c).slice(-600)));
    child.on('close', (code) => {
      procs.delete(r.run_id);
      if (r.status === 'running') touch(r, { status: r.stopped ? 'stopped' : 'error', live: '', error: r.stopped ? '' : short(errTail || `Claude Code exited (${code}).`, 300) });
      pump();
    });
    child.on('error', (e) => touch(r, { status: 'error', live: '', error: e.code === 'ENOENT' ? 'Claude Code is not installed' : `Could not start Claude Code: ${e.message}` }));
  }

  return {
    list: () => runs.map(view),
    get: (id) => view(find(id)),
    /** Start a run for a card in a fresh worktree of `repo`. */
    async start({ cardId, title, prompt, repo, mode = 'acceptEdits', project = '', sessionId = '' } = {}) {
      if (!prompt || typeof prompt !== 'string') throw err('bad_request', 'A prompt is required');
      if (!MODES.includes(mode)) throw err('bad_request', `mode must be one of ${MODES.join(', ')}`);
      const root = resolve(String(repo || ''));
      if (!repo || !existsSync(root) || !statSync(root).isDirectory() ) throw err('bad_request', 'repo must be an existing folder');
      const isGit = existsSync(join(root, '.git'));
      const id = randomBytes(5).toString('hex');
      const branch = `lumen/${(String(title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'task')}-${id}`;
      const cwd = join(dir, 'worktrees', id);
      if (isGit && !sessionId) await gitRun(['worktree', 'add', '-b', branch, cwd], root);
      const r = { run_id: id, card: cardId || null, task_id: cardId || null, task_title: short(title || prompt, 80), project, title: short(title || prompt, 80), repo: root, cwd: isGit && !sessionId ? cwd : root, branch: isGit && !sessionId ? branch : '', worktree: isGit && !sessionId, session_id: sessionId || undefined, memory: [], draft: '', mode, status: 'queued', live: 'Queued…', files: [], steps: 0, cost: 0, created: Date.now(), updated: Date.now(), pending_prompt: prompt };
      runs.push(r); save(); pump();
      return view(r);
    },
    /** Answer a waiting run (or nudge a stopped/interrupted one). */
    resume(id, answer) {
      const r = find(id);
      if (!['waiting', 'blocked', 'stopped', 'interrupted', 'error', 'done'].includes(r.status) || !r.session_id) throw err('bad_request', 'This run cannot be resumed');
      touch(r, { status: 'queued', live: 'Queued…', stopped: false, pending_prompt: String(answer || 'Continue.').slice(0, 8000), error: '' });
      pump();
      return view(r);
    },
    stop(id) {
      const r = find(id);
      r.stopped = true;
      const p = procs.get(id);
      if (p) p.kill();
      else if (r.status === 'queued') touch(r, { status: 'stopped', live: '' });
      return view(r);
    },
    /** Drop the run and its worktree (the branch is kept so work is never lost silently). */
    async remove(id) {
      const r = find(id);
      procs.get(id)?.kill();
      if (r.worktree) { try { await gitRun(['worktree', 'remove', '--force', r.cwd], r.repo); } catch { /* already gone */ } }
      runs = runs.filter((x) => x !== r); save();
      return { ok: true, branch: r.branch };
    },
  };
}
