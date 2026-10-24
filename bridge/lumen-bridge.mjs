#!/usr/bin/env node
// Lumen bridge — a local MCP server (stdio) that lets the Lumen dashboard,
// opened inside the Claude desktop app, run Claude Code sessions in the
// background on this machine and read back short live summaries.
//
// Register it in Claude desktop (claude_desktop_config.json):
//   "mcpServers": { "lumen": { "command": "node", "args": ["<abs path>/bridge/lumen-bridge.mjs"] } }
// The dashboard reaches it as the host server "host:lumen".
//
// Zero dependencies: a minimal MCP JSON-RPC loop over stdin/stdout.

import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const VERSION = '1.1.0';
const HOME = homedir();
const CODING = process.env.LUMEN_CODING_ROOT || join(HOME, 'coding');
// The three work spaces a project can live in.
const SPACES = {
  perso: join(CODING, 'perso'),
  labia: join(CODING, 'labIa'),
  laplateforme: join(CODING, 'laplateforme'),
};
const LIMIT = Number(process.env.LUMEN_MAX_SESSIONS || 3);
const STATE_DIR = join(HOME, '.lumen-bridge');
const STATE_FILE = join(STATE_DIR, 'runs.json');
// Find Claude Code: explicit override, the native installer's location, then PATH.
function findClaude() {
  if (process.env.LUMEN_CLAUDE) return process.env.LUMEN_CLAUDE;
  const win = process.platform === 'win32';
  const local = join(HOME, '.local', 'bin', win ? 'claude.exe' : 'claude');
  if (existsSync(local)) return local;
  for (const dir of (process.env.PATH || '').split(win ? ';' : ':')) {
    for (const name of win ? ['claude.exe', 'claude.cmd'] : ['claude']) {
      const full = join(dir, name);
      if (dir && existsSync(full)) return full;
    }
  }
  return 'claude';
}
const CLAUDE = findClaude();
// npm installs a .cmd shim on Windows, which must run through the shell.
const NEEDS_SHELL = /\.cmd$/i.test(CLAUDE);

// How every session reports back. The bridge parses these trailing lines.
const PROTOCOL = `You are running in the background for the Lumen dashboard. The user is not watching a terminal; they read a short summary on their task board. Work autonomously inside the current folder.
When you finish, or when you cannot continue without the user, end your final message with these lines:
SUMMARY: <2-3 plain sentences: what you did and the outcome>
STATUS: done | blocked | needs-input
QUESTION: <one precise question>            (only with STATUS: needs-input)
OPTIONS: <short option> | <short option>     (optional, with QUESTION)
MEMORY: <one durable fact about this project worth remembering next time>   (repeat the line for each fact; skip trivia)
DRAFT: <for email tasks only: the full reply text to save as a Gmail draft; may span several lines; put it last>
Never ask for confirmation in the middle of the work; only use needs-input for decisions that truly block you.`;

// ------------------------------------------------------------------ state
let runs = [];
try {
  runs = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  // Anything that was running when the bridge stopped is now interrupted.
  for (const r of runs) if (r.status === 'running' || r.status === 'queued') Object.assign(r, { status: 'interrupted', live: 'The bridge restarted; resume to continue.' });
} catch {}
const procs = new Map(); // run_id → child process
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(runs.slice(-80), null, 1));
    } catch {}
  }, 250);
}
const find = (id) => runs.find((r) => r.run_id === id);
const touch = (r, patch) => (Object.assign(r, patch, { updated: Date.now() }), save());

// ------------------------------------------------------------------ helpers
function safeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function folderPath(space, folder) {
  const root = SPACES[space];
  if (!root) throw new Error(`Unknown space "${space}". Use one of: ${Object.keys(SPACES).join(', ')}.`);
  const name = safeName(folder);
  if (!name) throw new Error('Folder name is empty.');
  const full = resolve(root, name);
  if (!full.startsWith(resolve(root) + sep)) throw new Error('Folder must stay inside its space.');
  return full;
}

const short = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  switch (name) {
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editing ${basename(file || 'a file')}`;
    case 'Write': return `Writing ${basename(file || 'a file')}`;
    case 'Read': return `Reading ${basename(file || 'a file')}`;
    case 'Bash': case 'PowerShell': return `Running ${short(input.command, 60)}`;
    case 'Grep': case 'Glob': return `Searching the code${input.pattern ? ` for ${short(input.pattern, 40)}` : ''}`;
    case 'Task': case 'Agent': return `Delegating: ${short(input.description || input.prompt, 60)}`;
    case 'WebSearch': return `Searching the web: ${short(input.query, 60)}`;
    case 'WebFetch': return 'Reading a web page';
    case 'Skill': return `Using the ${input.skill || input.name || ''} skill`;
    case 'TodoWrite': return 'Updating its plan';
    default: return name.startsWith('mcp__') ? `Using ${name.split('__').slice(1).join(' ')}` : `Using ${name}`;
  }
}

// Parse the protocol lines at the end of the final message.
function parseResult(text) {
  const out = { summary: '', status: 'done', question: '', options: [], memory: [], draft: '' };
  const lines = String(text || '').split(/\r?\n/);
  let draftAt = -1;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\**(SUMMARY|STATUS|QUESTION|OPTIONS|MEMORY|DRAFT)\**\s*:\s*(.*)$/);
    if (!m) return;
    const [, key, value] = m;
    if (key === 'SUMMARY') out.summary = value.trim();
    if (key === 'STATUS') out.status = /needs/i.test(value) ? 'waiting' : /block/i.test(value) ? 'blocked' : 'done';
    if (key === 'QUESTION') out.question = value.trim();
    if (key === 'OPTIONS') out.options = value.split('|').map((o) => o.trim()).filter(Boolean).slice(0, 5);
    if (key === 'MEMORY' && value.trim()) out.memory.push(value.trim().slice(0, 240));
    if (key === 'DRAFT') draftAt = i;
  });
  if (draftAt >= 0) out.draft = [lines[draftAt].replace(/^\s*\**DRAFT\**\s*:\s*/, ''), ...lines.slice(draftAt + 1)].join('\n').trim();
  if (!out.summary) out.summary = short(lines.filter((l) => l.trim()).slice(-3).join(' '), 400);
  if (out.question && out.status === 'done') out.status = 'waiting';
  return out;
}

// ------------------------------------------------------------------ runner
function pump() {
  const running = runs.filter((r) => r.status === 'running').length;
  for (const r of runs.filter((x) => x.status === 'queued').slice(0, Math.max(0, LIMIT - running))) launch(r);
}

function launch(r) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--append-system-prompt', PROTOCOL];
  if (r.session_id) args.push('--resume', r.session_id);
  touch(r, { status: 'running', live: r.session_id ? 'Resuming…' : 'Starting…', started_turn: Date.now() });
  let child;
  try {
    child = NEEDS_SHELL
      ? spawn(`"${CLAUDE}"`, args.map((x) => `"${String(x).replace(/"/g, '\\"')}"`), { cwd: r.cwd, windowsHide: true, shell: true, env: { ...process.env, LUMEN_RUN_ID: r.run_id } })
      : spawn(CLAUDE, args, { cwd: r.cwd, windowsHide: true, env: { ...process.env, LUMEN_RUN_ID: r.run_id } });
  } catch (err) {
    return touch(r, { status: 'error', live: '', error: `Could not start Claude Code: ${err.message}` });
  }
  procs.set(r.run_id, child);
  child.stdin.end(r.pending_prompt || '');
  delete r.pending_prompt;

  let buf = '';
  let lastText = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'system' && ev.subtype === 'init') touch(r, { session_id: ev.session_id });
      if (ev.type === 'system' && ev.subtype === 'api_retry' && ev.error_status === 401) touch(r, { live: 'Claude Code needs you to sign in again (run: claude /login).' });
      if (ev.type === 'assistant') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'tool_use') {
            const desc = describeTool(block.name, block.input);
            const f = block.input?.file_path;
            if (f && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(block.name) && !r.files.includes(f)) r.files.push(f);
            r.steps = (r.steps || 0) + 1;
            touch(r, { live: desc });
          } else if (block.type === 'text' && block.text.trim()) {
            lastText = block.text;
            const first = block.text.split(/(?<=[.!?])\s|\n/)[0];
            if (!/^\s*\**(SUMMARY|STATUS|QUESTION|OPTIONS|MEMORY|DRAFT)\b/.test(first)) touch(r, { live: short(first, 140) });
          }
        }
      }
      if (ev.type === 'result') {
        const parsed = parseResult(ev.result || lastText);
        const authFail = /authenticat|login|oauth/i.test(ev.result || '') && ev.is_error;
        touch(r, {
          status: ev.is_error ? 'error' : parsed.status,
          live: '',
          summary: parsed.summary,
          question: parsed.status === 'waiting' ? parsed.question : '',
          options: parsed.status === 'waiting' ? parsed.options : [],
          memory: parsed.memory,
          draft: parsed.draft,
          error: ev.is_error ? (authFail ? 'Claude Code is signed out. Run "claude /login" in a terminal, then resume.' : short(ev.result, 300)) : '',
          cost: (r.cost || 0) + (ev.total_cost_usd || 0),
          turns: (r.turns || 0) + (ev.num_turns || 0),
          session_id: ev.session_id || r.session_id,
        });
      }
    }
  });
  let errTail = '';
  child.stderr.on('data', (c) => (errTail = (errTail + c).slice(-600)));
  child.on('close', (code) => {
    procs.delete(r.run_id);
    if (r.status === 'running') touch(r, { status: r.stopped ? 'stopped' : 'error', live: '', error: r.stopped ? '' : short(errTail || `Claude Code exited (${code}).`, 300) });
    pump();
  });
  child.on('error', (err) => touch(r, { status: 'error', live: '', error: `Could not start Claude Code: ${err.message}` }));
}

// ------------------------------------------------------------------ GitHub
// Everything goes through the user's signed-in GitHub CLI (`gh`) and git;
// the bridge never sees or stores a token.
function run(cmd, args, { cwd, timeout = 25_000 } = {}) {
  return new Promise((resolveRun, reject) =>
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(short(stderr || err.message, 400)));
      else resolveRun(stdout);
    }),
  );
}
const gh = async (args, opts) => {
  const out = await run('gh', args, opts);
  try {
    return JSON.parse(out || 'null');
  } catch {
    return out.trim();
  }
};

/** owner/name of a folder's origin remote, or null. */
async function repoOf(cwd) {
  if (!existsSync(join(cwd, '.git'))) return null;
  try {
    const url = (await run('git', ['remote', 'get-url', 'origin'], { cwd })).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

const checksState = (rollup = []) => {
  if (!rollup?.length) return null;
  const states = rollup.map((c) => (c.conclusion || c.state || c.status || '').toUpperCase());
  if (states.some((x) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(x))) return 'failing';
  if (states.some((x) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING'].includes(x))) return 'pending';
  return 'passing';
};

// ------------------------------------------------------------------ tools
const TOOLS = {
  bridge_info: {
    description: 'Lumen bridge status: version, work spaces and whether they exist, concurrency, active runs.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    run: () => ({
      version: VERSION, claude: CLAUDE, limit: LIMIT,
      spaces: Object.entries(SPACES).map(([id, path]) => ({ id, path, exists: existsSync(path) })),
      running: runs.filter((r) => r.status === 'running').length,
      queued: runs.filter((r) => r.status === 'queued').length,
    }),
  },
  list_folders: {
    description: 'List project folders inside one work space.',
    readOnly: true,
    schema: { type: 'object', properties: { space: { type: 'string' } }, required: ['space'] },
    run: ({ space }) => {
      const root = SPACES[space];
      if (!root) throw new Error(`Unknown space "${space}".`);
      if (!existsSync(root)) return { space, path: root, folders: [] };
      const folders = readdirSync(root).filter((n) => !n.startsWith('.') && statSync(join(root, n)).isDirectory()).sort((a, b) => a.localeCompare(b));
      return { space, path: root, folders };
    },
  },
  ensure_folder: {
    description: 'Return the absolute path of a project folder inside a work space, creating it if missing.',
    schema: { type: 'object', properties: { space: { type: 'string' }, folder: { type: 'string' } }, required: ['space', 'folder'] },
    run: ({ space, folder }) => {
      const path = folderPath(space, folder);
      const created = !existsSync(path);
      if (created) mkdirSync(path, { recursive: true });
      return { path, created, folder: basename(path) };
    },
  },
  start_session: {
    description: 'Queue a background Claude Code session for a task. Resumes an existing Claude Code session when resume_session_id is given. Creates the folder if missing.',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' }, task_title: { type: 'string' }, project: { type: 'string' },
        space: { type: 'string' }, folder: { type: 'string' }, prompt: { type: 'string' }, resume_session_id: { type: 'string' },
      },
      required: ['task_id', 'space', 'folder', 'prompt'],
    },
    run: (a) => {
      const cwd = folderPath(a.space, a.folder);
      if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
      const r = {
        run_id: randomUUID(), task_id: a.task_id, task_title: short(a.task_title, 120), project: short(a.project, 80), space: a.space, folder: basename(cwd), cwd,
        status: 'queued', live: 'Waiting for a free slot…', session_id: a.resume_session_id || null, summary: '', question: '', options: [], memory: [], draft: '',
        files: [], steps: 0, cost: 0, turns: 0, error: '', created: Date.now(), updated: Date.now(), pending_prompt: String(a.prompt).slice(0, 60_000),
      };
      runs.push(r);
      save();
      pump();
      return view(r);
    },
  },
  answer: {
    description: 'Send the user’s answer (or a follow-up instruction) to a session and continue it in the background.',
    schema: { type: 'object', properties: { run_id: { type: 'string' }, text: { type: 'string' } }, required: ['run_id', 'text'] },
    run: ({ run_id, text }) => {
      const r = find(run_id);
      if (!r) throw new Error('Unknown run.');
      if (r.status === 'running' || r.status === 'queued') throw new Error('That session is still working.');
      if (!r.session_id) throw new Error('That session never started, so there is nothing to continue.');
      Object.assign(r, { pending_prompt: String(text).slice(0, 20_000), question: '', options: [], error: '', stopped: false });
      touch(r, { status: 'queued', live: 'Waiting for a free slot…' });
      pump();
      return view(r);
    },
  },
  session_status: {
    description: 'Current state of Lumen sessions (all recent ones, or the given run ids).',
    readOnly: true,
    schema: { type: 'object', properties: { run_ids: { type: 'array', items: { type: 'string' } } } },
    run: ({ run_ids } = {}) => ({ now: Date.now(), runs: (run_ids?.length ? runs.filter((r) => run_ids.includes(r.run_id)) : runs.slice(-40)).map(view) }),
  },
  stop_session: {
    description: 'Stop a running or queued session.',
    schema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
    run: ({ run_id }) => {
      const r = find(run_id);
      if (!r) throw new Error('Unknown run.');
      r.stopped = true;
      const p = procs.get(run_id);
      if (p) p.kill();
      else touch(r, { status: 'stopped', live: '' });
      return view(r);
    },
  },
  open_terminal: {
    description: 'Open an interactive Claude Code terminal on this session so the user can take over.',
    schema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
    run: ({ run_id }) => {
      const r = find(run_id);
      if (!r?.session_id) throw new Error('That session has no Claude Code conversation yet.');
      const cmd = `"${CLAUDE}" --resume ${r.session_id}`;
      if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', '/D', r.cwd, 'cmd.exe', '/k', cmd], { detached: true, windowsHide: false, shell: false }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'x-terminal-emulator', process.platform === 'darwin' ? ['-a', 'Terminal', r.cwd] : ['-e', cmd], { cwd: r.cwd, detached: true }).unref();
      return { opened: true, session_id: r.session_id };
    },
  },

  github_overview: {
    description: 'GitHub at a glance for the signed-in user: open pull requests they wrote, reviews requested from them, issues assigned to them, recently pushed repositories.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    run: async () => {
      const prFields = 'title,repository,url,updatedAt,isDraft,number';
      const [me, mine, reviews, issues, repos] = await Promise.allSettled([
        gh(['api', 'user', '--jq', '.login']),
        gh(['search', 'prs', '--author=@me', '--state=open', '--limit', '20', '--json', prFields]),
        gh(['search', 'prs', '--review-requested=@me', '--state=open', '--limit', '20', '--json', prFields + ',author']),
        gh(['search', 'issues', '--assignee=@me', '--state=open', '--limit', '20', '--json', 'title,repository,url,updatedAt,number,labels']),
        gh(['repo', 'list', '--limit', '12', '--json', 'nameWithOwner,pushedAt,isPrivate,description,url']),
      ]);
      const val = (x, d) => (x.status === 'fulfilled' && x.value ? x.value : d);
      if (me.status === 'rejected') throw new Error(`GitHub CLI is not signed in or not installed: ${me.reason.message}`);
      const repo = (r) => r?.nameWithOwner || r?.name || '';
      const pr = (p) => ({ title: p.title, repo: repo(p.repository), url: p.url, number: p.number, updated: Date.parse(p.updatedAt) || 0, draft: !!p.isDraft, author: p.author?.login || null });
      return {
        login: val(me, ''),
        my_prs: val(mine, []).map(pr),
        review_requests: val(reviews, []).map(pr),
        assigned_issues: val(issues, []).map((i) => ({ title: i.title, repo: repo(i.repository), url: i.url, number: i.number, updated: Date.parse(i.updatedAt) || 0, labels: (i.labels || []).map((l) => l.name) })),
        repos: val(repos, []).map((r) => ({ repo: r.nameWithOwner, url: r.url, pushed: Date.parse(r.pushedAt) || 0, private: !!r.isPrivate, description: r.description || '' })),
      };
    },
  },

  github_repo: {
    description: "GitHub state of a project's folder: its repository, current branch, local changes, latest commits, open pull requests with CI status, open issues.",
    readOnly: true,
    schema: { type: 'object', properties: { space: { type: 'string' }, folder: { type: 'string' } }, required: ['space', 'folder'] },
    run: async ({ space, folder }) => {
      const cwd = folderPath(space, folder);
      if (!existsSync(cwd)) return { exists: false, repo: null };
      const isGit = existsSync(join(cwd, '.git'));
      const repo = await repoOf(cwd);
      const out = { exists: true, git: isGit, repo, branch: null, dirty: 0, ahead: 0, commits: [], prs: [], issues: [], url: repo ? `https://github.com/${repo}` : null };
      if (isGit) {
        const [branch, status, log] = await Promise.allSettled([
          run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
          run('git', ['status', '--porcelain'], { cwd }),
          run('git', ['log', '-6', '--format=%h%x1f%s%x1f%an%x1f%ct'], { cwd }),
        ]);
        if (branch.status === 'fulfilled') out.branch = branch.value.trim();
        if (status.status === 'fulfilled') out.dirty = status.value.split('\n').filter(Boolean).length;
        if (log.status === 'fulfilled')
          out.commits = log.value.split('\n').filter(Boolean).map((l) => {
            const [sha, subject, author, ts] = l.split('\x1f');
            return { sha, subject, author, at: +ts * 1000 };
          });
        try {
          out.ahead = +(await run('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd })).trim() || 0;
        } catch {}
      }
      if (repo) {
        const [prs, issues] = await Promise.allSettled([
          gh(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '15', '--json', 'number,title,url,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,author']),
          gh(['issue', 'list', '-R', repo, '--state', 'open', '--limit', '15', '--json', 'number,title,url,labels,updatedAt,assignees']),
        ]);
        if (prs.status === 'fulfilled')
          out.prs = (prs.value || []).map((p) => ({
            number: p.number, title: p.title, url: p.url, branch: p.headRefName, draft: !!p.isDraft, review: p.reviewDecision || null,
            checks: checksState(p.statusCheckRollup), updated: Date.parse(p.updatedAt) || 0, author: p.author?.login || null,
          }));
        if (issues.status === 'fulfilled')
          out.issues = (issues.value || []).map((i) => ({ number: i.number, title: i.title, url: i.url, labels: (i.labels || []).map((l) => l.name), updated: Date.parse(i.updatedAt) || 0, assignees: (i.assignees || []).map((a) => a.login) }));
      }
      return out;
    },
  },

  github_open_pr: {
    description: "Push the folder's current branch and open a pull request for it (never from main/master). Returns the PR url; if one already exists for the branch, returns that one.",
    schema: { type: 'object', properties: { space: { type: 'string' }, folder: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' } }, required: ['space', 'folder', 'title'] },
    run: async ({ space, folder, title, body = '', draft = false }) => {
      const cwd = folderPath(space, folder);
      const repo = await repoOf(cwd);
      if (!repo) throw new Error('This folder has no GitHub remote named origin. Link or create the repository first.');
      const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).trim();
      if (/^(main|master|HEAD)$/.test(branch)) throw new Error(`The folder is on ${branch}; switch to a feature branch before opening a pull request.`);
      // Push first, so commits made after an earlier PR still reach it.
      await run('git', ['push', '-u', 'origin', 'HEAD'], { cwd, timeout: 60_000 });
      try {
        const existing = await gh(['pr', 'view', branch, '-R', repo, '--json', 'url,number,state']);
        if (existing?.state === 'OPEN') return { url: existing.url, number: existing.number, existed: true, branch };
      } catch {}
      const url = await gh(['pr', 'create', '-R', repo, '--head', branch, '--title', String(title).slice(0, 240), '--body', String(body).slice(0, 20_000) || 'Opened from Lumen.', ...(draft ? ['--draft'] : [])], { cwd, timeout: 60_000 });
      return { url: String(url).trim().split('\n').pop(), existed: false, branch };
    },
  },

  github_clone: {
    description: 'Clone a GitHub repository (owner/name) into a work space so a project can pick it up. Returns the folder; does nothing if it is already there.',
    schema: { type: 'object', properties: { space: { type: 'string' }, repo: { type: 'string' }, folder: { type: 'string' } }, required: ['space', 'repo'] },
    run: async ({ space, repo, folder }) => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Repository must look like owner/name.');
      const dest = folderPath(space, folder || repo.split('/')[1]);
      if (existsSync(join(dest, '.git'))) return { folder: basename(dest), cloned: false, repo: await repoOf(dest) };
      if (existsSync(dest) && readdirSync(dest).length) throw new Error(`${basename(dest)} already exists and is not empty.`);
      await run('gh', ['repo', 'clone', repo, dest], { timeout: 180_000 });
      return { folder: basename(dest), cloned: true, repo };
    },
  },
};

// What the dashboard sees (no prompt text, no paths beyond the folder name).
const view = (r) => ({
  run_id: r.run_id, task_id: r.task_id, task_title: r.task_title, project: r.project, space: r.space, folder: r.folder,
  status: r.status, live: r.live, session_id: r.session_id, summary: r.summary, question: r.question, options: r.options,
  memory: r.memory, draft: r.draft, files: r.files.map((f) => basename(f)), steps: r.steps, cost: Math.round(r.cost * 100) / 100,
  turns: r.turns, error: r.error, created: r.created, updated: r.updated,
});

// ------------------------------------------------------------------ MCP stdio
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize')
    return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lumen', version: VERSION } });
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list')
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.description, inputSchema: t.schema,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: name === 'stop_session' || name === 'github_open_pr' },
      })),
    });
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
    Promise.resolve()
      .then(() => tool.run(params.arguments || {}))
      .then(
        (result) => reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }),
        (err) => reply(id, { isError: true, content: [{ type: 'text', text: String(err?.message || err) }] }),
      );
    return;
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, nl).trim();
    inBuf = inBuf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {}
  }
});
// Keep sessions alive if the app restarts its MCP connection; children are detached from stdin.
process.on('SIGTERM', () => process.exit(0));
