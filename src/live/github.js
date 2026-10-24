// GitHub, through the Lumen bridge and the user's signed-in GitHub CLI.
// state.github = { status, text, overview, repos: { [projectId]: repoState }, at }

import { state, commit, project as getProject, logActivity } from '../store.js';
import { LIVE, use } from './runtime.js';
import { HOST, bridgeError, projectFolder } from './sessions.js';
import { uid, addDays, startOfDay } from '../lib/dom.js';

state.github ??= { status: LIVE ? 'idle' : 'off', text: '', overview: null, repos: {}, at: 0 };

async function host(tool, input = {}) {
  const mcp = await use('mcp');
  if (!mcp) throw { code: 'not_granted', message: 'Connectors are not available in this view.' };
  const res = await mcp.callTool(HOST, tool, input, { cache: false });
  return res.payload ?? res.structuredContent ?? res;
}

const set = (patch) => {
  state.github = { ...state.github, ...patch };
  commit('github');
};

let timer = 0;
/** Load the overview now and every 5 minutes while the bridge is up. */
export async function startGithub() {
  if (!LIVE) return;
  clearTimeout(timer);
  if (state.bridge?.status !== 'ok') return set({ status: 'off', text: state.bridge?.text || 'GitHub needs the Lumen bridge.' });
  if (!state.github.overview) set({ status: 'loading' });
  try {
    const overview = await host('github_overview');
    set({ status: 'ok', text: '', overview, at: Date.now() });
  } catch (err) {
    set({ status: 'error', text: /signed in|not installed/i.test(err?.message || '') ? 'Sign in to the GitHub CLI on this PC: gh auth login' : bridgeError(err) });
  }
  timer = setTimeout(() => !document.hidden && startGithub(), 5 * 60_000);
}

/** Repository state of a project's folder (cached per project for a minute). */
export async function loadRepo(p, { fresh = false } = {}) {
  p = getProject(p.id) || p; // live sync may have replaced the object
  const loc = projectFolder(p);
  if (!loc) return null;
  const cached = state.github.repos[p.id];
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached;
  const data = await host('github_repo', loc);
  state.github.repos = { ...state.github.repos, [p.id]: { ...data, at: Date.now() } };
  // Remember the repository the folder points at, so overview items can map back to the project.
  if (data.repo && p.repo !== data.repo) {
    p.repo = data.repo;
    commit('projects');
  }
  commit('github');
  return state.github.repos[p.id];
}

/** Push the task's branch and open (or find) its pull request. */
export async function openPullRequest(task, { draft = false } = {}) {
  const p = getProject(task.projectId);
  const loc = task.session?.space ? { space: task.session.space, folder: task.session.folder } : projectFolder(p);
  if (!loc) throw { code: 'tool_error', message: 'This task has no project folder.' };
  const summary = [...(task.comments || [])].reverse().find((c) => c.who === 'claude')?.text || '';
  const res = await host('github_open_pr', {
    ...loc, draft, title: task.title,
    body: `${summary}\n\n---\nOpened from Lumen${task.notes?.trim() ? `\n\nTask notes:\n${task.notes.trim().slice(0, 2000)}` : ''}`,
  });
  task.pr = { url: res.url, number: res.number || null, branch: res.branch };
  if (!res.existed) logActivity('task', `opened a pull request for “${task.title}”`, task.projectId);
  commit('tasks', 'activity');
  if (p) loadRepo(p, { fresh: true }).catch(() => {});
  return res;
}

/** Clone a repo into a space and attach it to a project (or create the project). */
export async function cloneIntoProject(repo, space, p) {
  // An existing project keeps its own folder name; a new one is named after the repo.
  const res = await host('github_clone', { space, repo, ...(p?.folder || p?.name ? { folder: p.folder || p.name } : {}) });
  if (res.repo && res.repo.toLowerCase() !== repo.toLowerCase()) throw { code: 'tool_error', message: `That folder already holds ${res.repo}.` };
  if (!p) {
    const name = repo.split('/')[1];
    p = {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 5), name, hue: 'indigo', icon: 'grid', lead: 'me', members: ['me'],
      status: 'active', summary: `GitHub: ${repo}`, starred: true, start: Date.now(), due: addDays(startOfDay(), 30).getTime(), milestones: [], memory: [],
    };
    state.projects.push(p);
  }
  Object.assign(p, { space, folder: res.folder, repo });
  logActivity('project', `linked ${repo} to ${p.name}`, p.id);
  commit('projects', 'activity');
  return p;
}

/** An assigned issue becomes a Lumen task (keeps the link in notes). */
export function issueToTask(issue, projectId = null) {
  const due = addDays(startOfDay(), 2);
  due.setHours(17, 0, 0, 0);
  const t = {
    id: uid('t'), title: issue.title.slice(0, 200), projectId, status: 'todo', priority: 'medium', assignee: 'me', due: due.getTime(),
    created: Date.now(), doneAt: null, est: 2, order: Math.min(0, ...state.tasks.filter((x) => x.order < 1000).map((x) => x.order)) - 1,
    subtasks: [], comments: [], notes: `GitHub issue ${issue.repo}#${issue.number}\n${issue.url}`, source: { kind: 'github', url: issue.url, repo: issue.repo, number: issue.number },
  };
  state.tasks.push(t);
  logActivity('task', `added “${t.title}” from GitHub`, projectId);
  commit('tasks', 'activity');
  return t;
}

/** The project that owns a repo (by explicit link). */
export const projectForRepo = (repo) => {
  const r = String(repo).toLowerCase();
  const name = r.split('/')[1];
  // Explicit link first, then a project whose folder or name matches the repo name.
  return (
    state.projects.find((p) => p.repo && p.repo.toLowerCase() === r) ||
    state.projects.find((p) => (p.folder || '').toLowerCase() === name || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === name)
  );
};
