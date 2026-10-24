// Small shared pieces for GitHub (home card, project workspace, tasks,
// task drawer, settings). Data comes from state.github (src/live/github.js);
// everything here returns HTML strings or does one small store action.

import '../styles/github.css';
import { esc, icon, relTime } from '../lib/dom.js';
import { state, commit, project } from '../store.js';
import { issueToTask } from '../live/github.js';
import { notify } from './island.js';

export const GH_DEMO = 'GitHub appears when Lumen runs in the Claude desktop app with the Lumen bridge connected.';

/** Why the bridge can't reach GitHub right now; '' when it can. */
export function ghGate() {
  if (state.demo) return GH_DEMO;
  const b = state.bridge || {};
  if (b.status === 'ok') return '';
  if (b.status === 'checking') return 'Connecting to the Lumen bridge…';
  return b.text || state.github?.text || 'GitHub needs the Lumen bridge.';
}

/** ok | loading | off | error — for the overview (home card, settings). */
export function ghOverviewState() {
  if (ghGate()) return { kind: 'off', text: ghGate() };
  const g = state.github || {};
  if (g.status === 'error') return { kind: 'error', text: g.text || 'GitHub could not be reached.' };
  if (g.overview) return { kind: 'ok' };
  if (g.status === 'off') return { kind: 'off', text: g.text || 'GitHub needs the Lumen bridge.' };
  return { kind: 'loading' };
}

export const shortRepo = (r) => String(r || '').split('/')[1] || String(r || '');
export const safeGh = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

/** A real link to github.com that opens in a new tab. */
export function ghA(url, inner, { cls = '', label = '', title = '' } = {}) {
  const u = safeGh(url);
  if (!u) return `<span class="${cls}">${inner}</span>`;
  return `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${inner}<span class="sr">${label ? ` ${esc(label)}` : ''} (opens GitHub in a new tab)</span></a>`;
}

export function checksDot(checks) {
  if (!checks) return '';
  const label = { passing: 'Checks passing', pending: 'Checks running', failing: 'Checks failing' }[checks] || checks;
  return `<span class="gh-checks gh-checks--${esc(checks)}" title="${esc(label)}"><i aria-hidden="true"></i><span class="sr">${esc(label)}</span></span>`;
}

const REVIEW = { APPROVED: ['ok', 'Approved'], CHANGES_REQUESTED: ['bad', 'Changes requested'], REVIEW_REQUIRED: ['wait', 'Review required'] };
export function reviewChip(review) {
  const r = REVIEW[review];
  return r ? `<span class="gh-review gh-review--${r[0]}">${r[1]}</span>` : '';
}

export const draftBadge = () => '<span class="gh-draft">Draft</span>';

// ---------- issues → tasks ----------
/** The Lumen task made from this issue, if any. */
export const taskForIssue = (url) => (url ? state.tasks.find((t) => t.source?.kind === 'github' && t.source.url === url) : null);

/** Every issue Lumen knows, by url (overview + project repos), with its repo filled in. */
export function findIssue(url) {
  const g = state.github || {};
  const hit = (g.overview?.assigned_issues || []).find((i) => i.url === url);
  if (hit) return hit;
  for (const r of Object.values(g.repos || {})) {
    const i = (r?.issues || []).find((x) => x.url === url);
    if (i) return { ...i, repo: i.repo || r.repo };
  }
  return null;
}

/** "+ Task" for an issue, or a link to the task it already became. */
export function issueTaskBtn(issue, { label = 'Task' } = {}) {
  const t = taskForIssue(issue.url);
  if (t) return `<a class="gh-intask" href="#/tasks/${encodeURIComponent(t.id)}" data-gh-done="${esc(issue.url)}" title="Open the task">${icon('check')}<span>In tasks</span></a>`;
  return `<button type="button" class="gh-addtask" data-gh-issue="${esc(issue.url)}" aria-label="Add “${esc(issue.title)}” (#${issue.number}) as a task">${icon('plus')}<span>${esc(label)}</span></button>`;
}

/** Turn an issue into a task, with an undo toast. */
export function addIssueTask(issue, projectId = null) {
  if (!issue) return null;
  const existing = taskForIssue(issue.url);
  if (existing) return existing;
  const t = issueToTask(issue, projectId);
  const p = projectId && project(projectId);
  notify(`Added “${t.title}”${p ? ` to ${p.name}` : ''}`, {
    ico: 'tasks',
    undo: () => {
      const i = state.tasks.indexOf(t);
      if (i >= 0) state.tasks.splice(i, 1);
      commit('tasks');
    },
  });
  return t;
}

// ---------- task chips ----------
export function prChip(t, cls = 'gh-chip') {
  const pr = t?.pr;
  if (!safeGh(pr?.url)) return '';
  return ghA(pr.url, `${icon('pr')}<span>${pr.number ? `PR #${pr.number}` : 'Pull request'}</span>`, { cls, label: `for “${t.title}”`, title: 'Open the pull request' });
}

export function sourceChip(t, cls = 'gh-chip') {
  const s = t?.source;
  if (s?.kind !== 'github' || !safeGh(s.url)) return '';
  return ghA(s.url, `${icon('issue')}<span>${s.number ? `#${s.number}` : 'GitHub'}</span>`, { cls, label: `issue ${s.repo || ''}`, title: `GitHub issue ${s.repo || ''}${s.number ? `#${s.number}` : ''}` });
}

/** Rows for a list of PRs/issues (home card). */
export function ghRow({ url, repo, title, number, updated, draft }, extra = '') {
  const meta = `<span class="ghrow__meta">${repo ? `<span class="ghrow__repo" title="${esc(repo)}">${esc(shortRepo(repo))}</span>` : ''}<span>#${number}</span>${updated ? `<span>${esc(relTime(updated))}</span>` : ''}</span>`;
  return `<li class="ghrow">${ghA(url, `<span class="ghrow__title">${draft ? draftBadge() : ''}${esc(title)}</span>${meta}`, { cls: 'ghrow__link' })}${extra}</li>`;
}
