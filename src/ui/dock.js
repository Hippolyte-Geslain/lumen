// Sessions dock: every background Claude session at a glance. Collapsed it
// is a pill in the corner ("2 working · 1 needs you"); open it is a glass
// panel on the right edge with live lines, questions and controls.

import { gsap, reduced } from '../lib/motion.js';
import { esc, icon, relTime } from '../lib/dom.js';
import { state, subscribe, task as getTask } from '../store.js';
import { STATUS_LABEL, answer, stop, openTerminal, launch, bridgeError } from '../live/sessions.js';
import { notify } from './island.js';

let dock, pill, list;
let open = false;
const drafts = new Map(); // run_id → unsent answer text

const KEY = 'lumen:dock-open';
const ACTIVE = new Set(['queued', 'running']);

function counts() {
  const s = state.sessions;
  return { working: s.filter((r) => ACTIVE.has(r.status)).length, waiting: s.filter((r) => r.status === 'waiting').length };
}

function renderPill() {
  const { working, waiting } = counts();
  const any = working || waiting;
  pill.hidden = state.bridge.status !== 'ok' || (!any && !state.sessions.length);
  pill.classList.toggle('is-waiting', waiting > 0);
  pill.classList.toggle('is-working', working > 0);
  pill.innerHTML = `<i></i><span>${[working && `${working} working`, waiting && `${waiting} need${waiting > 1 ? '' : 's'} you`].filter(Boolean).join(' · ') || 'Sessions'}</span>`;
  pill.setAttribute('aria-expanded', open);
}

function row(r) {
  const t = getTask(r.task_id);
  const active = ACTIVE.has(r.status);
  const draft = drafts.get(r.run_id) || '';
  return `<li class="ses ses--${r.status}" data-run="${r.run_id}">
    <div class="ses__top">
      <span class="ses__dot" aria-hidden="true"></span>
      <div class="ses__titles">
        <a class="ses__task" href="#/tasks/${esc(r.task_id)}">${esc(t?.title || r.task_title || 'Task')}</a>
        <span class="ses__meta">${esc(r.project || r.folder)} · ${STATUS_LABEL[r.status] || r.status} · ${relTime(r.updated)}</span>
      </div>
    </div>
    ${active && r.live ? `<p class="ses__live" aria-live="polite">${esc(r.live)}</p>` : ''}
    ${!active && r.summary && r.status !== 'waiting' ? `<p class="ses__summary">${esc(r.summary)}</p>` : ''}
    ${r.error ? `<p class="ses__error">${esc(r.error)}</p>` : ''}
    ${
      r.status === 'waiting'
        ? `<div class="ses__ask"><p class="ses__q">${esc(r.question || r.summary)}</p>
          ${r.options?.length ? `<div class="ses__opts">${r.options.map((o) => `<button type="button" class="btn btn--sm btn--glass" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
          <form class="ses__reply" data-reply><input class="input" name="v" value="${esc(draft)}" placeholder="Answer Claude…" autocomplete="off" aria-label="Answer"><button class="btn btn--sm btn--accent" type="submit">Send</button></form></div>`
        : ''
    }
    <div class="ses__acts">
      ${active ? `<button type="button" class="btn btn--sm btn--ghost" data-act="stop">${icon('stop')}Stop</button>` : ''}
      ${['done', 'blocked', 'stopped', 'interrupted', 'error'].includes(r.status) && r.session_id && t ? `<button type="button" class="btn btn--sm btn--ghost" data-act="resume">${icon('play')}Resume</button>` : ''}
      ${r.session_id ? `<button type="button" class="btn btn--sm btn--ghost" data-act="terminal">${icon('keyboard')}Take over</button>` : ''}
      ${r.files?.length ? `<span class="ses__files">${r.files.length} file${r.files.length > 1 ? 's' : ''} changed</span>` : ''}
    </div>
  </li>`;
}

function renderList() {
  if (!open) return;
  // Keep a half-typed answer across re-renders.
  list.querySelectorAll('[data-reply]').forEach((f) => drafts.set(f.closest('[data-run]').dataset.run, f.v.value));
  const focused = document.activeElement?.closest?.('[data-reply]')?.closest('[data-run]')?.dataset.run;
  const order = { waiting: 0, running: 1, queued: 2, error: 3, blocked: 4 };
  const runs = [...state.sessions].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.updated - a.updated).slice(0, 20);
  list.innerHTML = runs.length
    ? runs.map(row).join('')
    : `<li class="ses-empty">${icon('sparkle')}<b>No sessions yet</b><span>Use “Launch a session” on a task.</span></li>`;
  if (focused) list.querySelector(`[data-run="${focused}"] input`)?.focus();
}

function setOpen(v) {
  open = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '');
  } catch {}
  dock.hidden = !v;
  renderPill();
  if (v) {
    renderList();
    if (!reduced()) gsap.fromTo(dock, { x: 40, opacity: 0, clipPath: 'inset(10% 0 10% 30% round 28px)' }, { x: 0, opacity: 1, clipPath: 'inset(-30px round 28px)', duration: 0.55, ease: 'expo.out', clearProps: 'clipPath,transform,opacity' });
  }
}

async function act(fn, done) {
  try {
    await fn();
    if (done) notify(done, { ico: 'check' });
  } catch (err) {
    notify(bridgeError(err), { ico: 'x', tone: 'warn', hold: 5 });
  }
}

export function initDock() {
  dock = document.getElementById('dock');
  pill = document.getElementById('dock-pill');
  list = dock.querySelector('.dock__list');
  pill.addEventListener('click', () => setOpen(!open));
  dock.querySelector('[data-close]').addEventListener('click', () => setOpen(false));
  dock.addEventListener('click', (e) => {
    const li = e.target.closest('[data-run]');
    if (!li) return;
    const run = state.sessions.find((r) => r.run_id === li.dataset.run);
    if (!run) return;
    const opt = e.target.closest('[data-opt]');
    if (opt) return act(() => answer(run, opt.dataset.opt), 'Answer sent — Claude is back on it');
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'stop') act(() => stop(run), 'Session stopped');
    if (a === 'terminal') act(() => openTerminal(run), 'Opened a Claude Code terminal');
    if (a === 'resume') {
      const t = getTask(run.task_id);
      if (t) act(() => launch(t, { resume: true, kind: t.session?.kind }), 'Resumed');
    }
  });
  dock.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.closest('[data-reply]');
    const run = state.sessions.find((r) => r.run_id === f.closest('[data-run]').dataset.run);
    const text = f.v.value.trim();
    if (!run || !text) return;
    drafts.delete(run.run_id);
    act(() => answer(run, text), 'Answer sent — Claude is back on it');
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && open && !document.querySelector('dialog[open]') && setOpen(false));

  subscribe('sessions', () => (renderPill(), renderList()));
  subscribe('bridge', renderPill);
  subscribe('tasks', renderList);
  let remembered = false;
  try {
    remembered = localStorage.getItem(KEY) === '1';
  } catch {}
  renderPill();
  if (remembered) setOpen(true);
}

export const openDock = () => setOpen(true);
