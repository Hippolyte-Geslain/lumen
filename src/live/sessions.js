// Background Claude Code sessions, run by the local Lumen bridge
// (bridge/lumen-bridge.mjs, reached as the host MCP server "host:lumen").
// Only works when Lumen is opened inside the Claude desktop app, by its owner.
//
// Model: each project has a folder (space + folder) and a running memory;
// each task gets its own resumable session primed with that memory.

import { state, commit, project as getProject, logActivity, member, statusLabel, firstStatus, activeStatus, reviewStatus, isLaunchable } from '../store.js';
import { LIVE, use, explain } from './runtime.js';
import { dueLabel, uid } from '../lib/dom.js';

export const HOST = 'host:lumen';
export const SPACES = [['perso', 'Perso'], ['labia', 'LabIA'], ['laplateforme', 'La Plateforme']];
export const KINDS = [['code', 'Code'], ['design', 'System design'], ['docs', 'Docs & research'], ['email', 'Email follow-up']];
const ACTIVE = new Set(['queued', 'running']);
const MEMORY_CAP = 40;

state.sessions ??= [];
state.bridge ??= { status: LIVE ? 'checking' : 'off', text: LIVE ? '' : 'Sessions run from the Claude desktop app.' };

// Claude, as the author of session comments, resolves through member('claude') in store.js.

const setBridge = (patch) => {
  state.bridge = { ...state.bridge, ...patch };
  commit('bridge');
};

async function host(tool, input = {}) {
  const mcp = await use('mcp');
  if (!mcp) throw { code: 'not_granted', message: 'Connectors are not available in this view.' };
  const res = await mcp.callTool(HOST, tool, input, { cache: false });
  return res.payload ?? res.structuredContent ?? res;
}

function bridgeError(err) {
  if (err?.code === 'server_not_connected' || err?.code === 'not_granted' || err?.code === 'capability_disabled')
    return 'Open Lumen in the Claude desktop app with the Lumen bridge connected to run sessions.';
  if (err?.code === 'cancelled') return 'You declined the action in the Claude app.';
  return explain(err, 'Lumen bridge').text;
}

// ---------------------------------------------------------------- polling
let timer = 0;

async function probe() {
  try {
    const info = await host('bridge_info');
    setBridge({ status: 'ok', text: '', info });
    await poll();
  } catch (err) {
    setBridge({ status: 'off', text: bridgeError(err), code: err?.code });
  }
}

export async function startSessions() {
  if (!LIVE) return;
  await probe();
  // With the local core, runs are pushed over the database channel: refresh the moment one changes.
  if (state.bridge.status === 'ok') {
    window.claude?.db?.collection?.('agents').doc('runs').onSnapshot(() => schedule(50), () => {});
  }
  // Coming back to the tab re-checks a bridge that was off (the app may have started it since).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    state.bridge.status === 'ok' ? schedule(200) : probe();
  });
}
export const retryBridge = probe;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(poll, ms);
}

async function poll() {
  if (state.bridge.status !== 'ok') return;
  try {
    const { runs = [] } = await host('session_status');
    state.sessions = runs;
    reconcile(runs);
    commit('sessions');
  } catch (err) {
    if (['server_not_connected', 'not_granted', 'capability_disabled'].includes(err?.code)) return setBridge({ status: 'off', text: bridgeError(err), code: err.code });
  }
  const busy = state.sessions.some((r) => ACTIVE.has(r.status));
  if (!document.hidden) schedule(busy ? 3000 : 20000);
}

// React once to each finished turn: move the task, post the summary,
// grow the project memory, tell the user.
function reconcile(runs) {
  let touched = false;
  for (const r of runs) {
    const task = state.tasks.find((t) => t.id === r.task_id);
    if (!task) continue;
    const s = (task.session ??= {});
    if (s.runId && s.runId !== r.run_id) continue; // an older run of this task
    if (s.sessionId !== (r.session_id || s.sessionId) || s.status !== r.status) {
      Object.assign(s, { runId: r.run_id, sessionId: r.session_id || s.sessionId, status: r.status });
      touched = true;
    }
    // `handled` is saved with the task, so a reload never reacts twice to one turn.
    if (ACTIVE.has(r.status) || s.handled === r.updated) continue;
    s.handled = r.updated;
    touched = true;
    const p = getProject(task.projectId);

    if (r.status === 'done' || r.status === 'blocked') {
      task.comments.push({ id: uid('c'), who: 'claude', at: Date.now(), text: `${r.status === 'blocked' ? 'Blocked: ' : ''}${r.summary}${r.files?.length ? `\nFiles: ${r.files.slice(0, 8).join(', ')}` : ''}` });
      if (r.status === 'done' && task.status !== 'done') task.status = reviewStatus();
      if (p && r.memory?.length) {
        p.memory = [...new Set([...(p.memory || []), ...r.memory])].slice(-MEMORY_CAP);
        commit('projects');
      }
      logActivity('task', r.status === 'done' ? `Claude finished “${task.title}”` : `Claude is blocked on “${task.title}”`, task.projectId);
      notify?.(r.status === 'done' ? `Claude finished “${task.title}” — ready for review` : `Claude is blocked on “${task.title}”`, { ico: r.status === 'done' ? 'check' : 'flag', tone: r.status === 'done' ? 'ok' : 'warn', hold: 4 });
    } else if (r.status === 'waiting') {
      notify?.(`Claude has a question about “${task.title}”`, { ico: 'message', tone: 'info', hold: 4 });
    } else if (r.status === 'error') {
      notify?.(r.error || `The session on “${task.title}” failed`, { ico: 'x', tone: 'warn', hold: 5 });
    }
  }
  if (touched) commit('tasks', 'activity');
}

// The island's toast, injected by main.js to avoid an import cycle.
let notify = null;
export const setNotifier = (fn) => (notify = fn);

// ---------------------------------------------------------------- prompts
export function guessKind(task) {
  if (task.source?.kind === 'mail' || /mail\.google\.com/.test(task.notes || '')) return 'email';
  const t = `${task.title} ${task.notes || ''}`.toLowerCase();
  if (/(architect|system design|design doc|diagram|schema|infra|data model|conception)/.test(t)) return 'design';
  if (/(research|write|doc|report|summar|analy|rédig|rapport|veille)/.test(t)) return 'docs';
  return 'code';
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';

const KIND_BRIEF = {
  code: (t) => `This is a coding task. Read the existing code first and follow its conventions. Implement the change, run the project's tests or build if there are any, and fix what you break. If this folder is a git repository, work on a branch named lumen/${slug(t.title)} (create it if needed) and commit with a clear message. If the folder is empty, scaffold a sensible minimal project for the task.`,
  design: (t) => `This is a system design task. Produce a design document at docs/design/${slug(t.title)}.md: context and goals, constraints, the proposed architecture, data flows, key decisions with alternatives considered, risks and open questions. Include Mermaid diagrams (architecture and the main sequence). Then use the anatomy skill to build an interactive isometric figure that explains the system as a physical object, save it under docs/design/figures/, and link it from the document. If the anatomy skill is not available, say so in your summary and keep the Mermaid diagrams. Commit the result if this is a git repository.`,
  docs: (t) => `This is a writing / research task. Deliver the result as Markdown under docs/ (for example docs/${slug(t.title)}.md), with sources linked where you used them. Keep it concise and decision-oriented.`,
  email: () => `This is an email follow-up. Use the email context below. You cannot send email. Write the reply in the thread's language and tone, then put the complete reply text after the DRAFT: line so the user can save it as a Gmail draft. Use files in this folder only if they help.`,
};

export function buildPrompt(task, { kind = guessKind(task), note = '' } = {}) {
  const p = getProject(task.projectId);
  const lines = [];
  lines.push(`# Task: ${task.title}`);
  lines.push(`Priority ${task.priority}, ${statusLabel(task.status)}, due ${dueLabel(task.due)}.`);
  if (p) {
    lines.push(`\n## Project: ${p.name}`);
    if (p.summary) lines.push(p.summary);
    if (p.memory?.length) lines.push(`\nWhat earlier sessions learned about this project:\n${p.memory.map((m) => `- ${m}`).join('\n')}`);
    const others = state.tasks.filter((x) => x.projectId === p.id && x.id !== task.id && x.order < 1000 && x.status !== 'done').slice(0, 8);
    if (others.length) lines.push(`\nOther open tasks in this project (do not do them, just be aware):\n${others.map((x) => `- ${x.title} (${statusLabel(x.status)})`).join('\n')}`);
  }
  if (task.notes?.trim()) lines.push(`\n## Notes\n${task.notes.trim()}`);
  if (task.subtasks?.length) lines.push(`\n## Subtasks\n${task.subtasks.map((s) => `- [${s.done ? 'x' : ' '}] ${s.title}`).join('\n')}`);
  const comments = (task.comments || []).slice(-6);
  if (comments.length) lines.push(`\n## Recent comments\n${comments.map((c) => `- ${member(c.who)?.name || c.who}: ${c.text.slice(0, 600)}`).join('\n')}`);
  if (kind === 'email') {
    const th = task.source?.threadId && state.threads.find((x) => x.id === task.source.threadId);
    if (th) lines.push(`\n## Email\nFrom ${th.fromEmail}\nSubject: ${th.subject}\n${th.snippet}`);
  }
  lines.push(`\n## How to work\n${KIND_BRIEF[kind](task)}`);
  if (note.trim()) lines.push(`\n## Note from the user for this session\n${note.trim()}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- actions
export const runFor = (task) => task?.session?.runId && state.sessions.find((r) => r.run_id === task.session.runId);
export const isActive = (task) => ACTIVE.has(runFor(task)?.status || task?.session?.status);
export const canLaunch = (task) => isLaunchable(task);
export const hasSession = (task) => !!task?.session?.sessionId;

/** The folder a project works in; null when it was never chosen. */
export const projectFolder = (p) => (p?.space && p?.folder ? { space: p.space, folder: p.folder } : null);

export async function setProjectFolder(p, space, folder) {
  const res = await host('ensure_folder', { space, folder });
  p.space = space;
  p.folder = res.folder;
  commit('projects');
  return res;
}

export async function listFolders(space) {
  const res = await host('list_folders', { space });
  return res.folders || [];
}

/**
 * Start a fresh session for a task, or resume its last one.
 * where: {space, folder} for tasks without a project folder.
 */
export async function launch(task, { kind, note = '', where, resume = false } = {}) {
  const p = getProject(task.projectId);
  // Claude Code keeps conversations per folder: resume where the session ran.
  const ran = task.session?.space && task.session?.folder ? { space: task.session.space, folder: task.session.folder } : null;
  const loc = (resume && ran) || projectFolder(p) || where;
  if (!loc) throw { code: 'tool_error', message: 'Choose a folder for this work first.' };
  if (p && !projectFolder(p)) await setProjectFolder(p, loc.space, loc.folder);
  const prompt = resume
    ? `Continue working on this task where you left off.${note.trim() ? `\n\nNote from the user: ${note.trim()}` : ''}\n\nCurrent task details, in case they changed:\n\n${buildPrompt(task, { kind, note: '' })}`
    : buildPrompt(task, { kind, note });
  const run = await host('start_session', {
    task_id: task.id, task_title: task.title, project: p?.name || '', space: loc.space, folder: loc.folder, prompt,
    ...(resume && task.session?.sessionId ? { resume_session_id: task.session.sessionId } : {}),
  });
  task.session = { ...(task.session || {}), runId: run.run_id, status: run.status, kind: kind || guessKind(task), space: loc.space, folder: loc.folder, startedAt: Date.now(), handled: null };
  if (task.status === firstStatus()) task.status = activeStatus();
  logActivity('task', `${resume ? 'resumed' : 'launched'} a Claude session on “${task.title}”`, task.projectId);
  state.sessions = [...state.sessions.filter((r) => r.run_id !== run.run_id), run];
  commit('tasks', 'activity', 'sessions');
  schedule(1500);
  return run;
}

export async function answer(run, text) {
  const r = await host('answer', { run_id: run.run_id, text });
  state.sessions = state.sessions.map((x) => (x.run_id === r.run_id ? r : x));
  commit('sessions');
  schedule(1500);
  return r;
}

export async function stop(run) {
  const r = await host('stop_session', { run_id: run.run_id });
  state.sessions = state.sessions.map((x) => (x.run_id === r.run_id ? r : x));
  commit('sessions');
  return r;
}

export const openTerminal = (run) => host('open_terminal', { run_id: run.run_id });

export const STATUS_LABEL = { queued: 'Queued', running: 'Working', waiting: 'Needs you', done: 'Done', blocked: 'Blocked', error: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted' };
export { bridgeError };
