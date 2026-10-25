// Tasks: kanban board + grouped list, with filters, keyboard moves and a
// hand-rolled pointer drag & drop (mouse, touch and pen).
// Live mode starts with an empty, personal board: a welcome card replaces the
// board until the first task exists, and "Mine only" hides while every task
// is the viewer's own.
import '../styles/pages/tasks.css';
import { LABEL_HUE } from '../lib/labels.js';

import { gsap, reduced, dur, revealCards, collapseOut, fadeUp, countTo } from '../lib/motion.js';
import { esc, icon, startOfDay, addDays, dueLabel, fmtDate } from '../lib/dom.js';
import {
  state, subscribe, commit, boardTasks, project, member, task as getTask, STATUSES, PRIORITIES, statusLabel, setTaskStatus,
  boards, activeBoard, switchBoard, addBoard, renameBoard, deleteBoard,
} from '../store.js';
import { pageHead, headIntro, card, avatar, projectChip, priorityPill, segmented, bindSegmented, iconBtn } from '../ui/components.js';
import {
  openMenu, openPopover, closePopover, closeDrawer, newTask, openTask, toggleDone, notify,
  sessionStripHtml, sessionCtaHtml, sessionBusy, sessionGate, keepSessionFocus, handleSessionClick, handleSessionSubmit, trackSessionDraft,
  prCtaHtml, prSig,
} from '../ui/overlays.js';
import { runFor } from '../live/sessions.js';
import { prChip, sourceChip } from '../ui/github.js';

// ---------- module state ----------
const VIEW_KEY = 'lumen:tasks-view';
const DONE_LIMIT = 8;
const PRANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

let root;
let view = readView();
let sort = 'due';
let showAllDone = false;
let dirty = false;
let pending = false; // a re-render arrived while dragging
let blockClicksUntil = 0;
let searchCall = null;
let drag = null;
let layer = null;
const filter = { project: '', mine: false, prio: '', q: '' };
const collapsed = new Set(['done']);
const els = {};

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

const phone = () => matchMedia('(max-width: 760px)').matches;
const isLive = () => !state.demo;
/** Live mode with every task assigned to the viewer: people filters mean nothing. */
const allMine = () => isLive() && boardTasks().every((t) => t.assignee === state.me);
const GMAIL = /https:\/\/mail\.google\.com\/[^\s<>"'()[\]]+/;
/** The Gmail link a task was created from (kept in its notes), if any. */
const mailUrl = (t) => (typeof t.notes === 'string' && t.notes.match(GMAIL)?.[0]) || '';
const mailLink = (t, cls) => {
  const url = mailUrl(t);
  return url
    ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open the email in Gmail">${icon('mail')}<span>From email</span><span class="sr"> (opens Gmail in a new tab)</span></a>`
    : '';
};
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

// ---------- data ----------
const filterOn = () => !!(filter.project || filter.mine || filter.prio || filter.q);

function matches(t) {
  if (filter.project && t.projectId !== filter.project) return false;
  if (filter.mine && t.assignee !== state.me) return false;
  if (filter.prio && t.priority !== filter.prio) return false;
  if (filter.q) {
    const hay = `${t.title} ${project(t.projectId)?.name ?? ''} ${member(t.assignee)?.name ?? ''}`.toLowerCase();
    if (!hay.includes(filter.q.toLowerCase())) return false;
  }
  return true;
}

const byOrder = (a, b) => a.order - b.order || PRANK[a.priority] - PRANK[b.priority];
const byDoneAt = (a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0);

/** Every matching task in a column, sorted (not truncated). */
function columnTasks(status) {
  return boardTasks()
    .filter((t) => t.status === status && matches(t))
    .sort(status === 'done' ? byDoneAt : byOrder);
}

function listTasks(status) {
  const ts = boardTasks().filter((t) => t.status === status && matches(t));
  if (status === 'done') return ts.sort(byDoneAt);
  const due = (a, b) => a.due - b.due;
  const prio = (a, b) => PRANK[a.priority] - PRANK[b.priority];
  return ts.sort(sort === 'prio' ? (a, b) => prio(a, b) || due(a, b) : (a, b) => due(a, b) || prio(a, b));
}

/** Renumber every active task of a status 0..n-1, keeping the current order. */
function renumber(status) {
  boardTasks()
    .filter((t) => t.status === status)
    .sort(byOrder)
    .forEach((t, i) => (t.order = i));
}

function snapshot() {
  return new Map(boardTasks().map((t) => [t.id, { order: t.order, status: t.status, doneAt: t.doneAt }]));
}

function restore(snap) {
  for (const t of boardTasks()) {
    const s = snap.get(t.id);
    if (s) Object.assign(t, s);
  }
  commit('tasks');
}

function stats() {
  const all = boardTasks();
  const open = all.filter((t) => t.status !== 'done');
  const sod = startOfDay();
  const ws = addDays(sod, -((sod.getDay() - (state.settings.weekStart ?? 1) + 7) % 7)).getTime();
  const we = addDays(ws, 7).getTime();
  return {
    open: open.length,
    week: open.filter((t) => t.due >= sod.getTime() && t.due < we).length,
    late: open.filter((t) => t.due < sod.getTime()).length,
    done: state.tasks.filter((t) => t.doneAt && t.doneAt >= ws && t.doneAt < we).length,
    projects: new Set(open.map((t) => t.projectId).filter((id) => id && project(id))).size,
  };
}

const subText = (s) => {
  if (!s.open) return boardTasks().length ? 'Everything is done' : 'Nothing on your board yet';
  return s.projects ? `${s.open} open across ${s.projects} project${s.projects === 1 ? '' : 's'}` : `${s.open} open`;
};

// ---------- markup ----------
function dueItem(t) {
  if (t.status === 'done') return `<span class="tk-due is-done">${icon('check')}${t.doneAt ? fmtDate(t.doneAt) : 'Done'}</span>`;
  const sod = startOfDay().getTime();
  if (t.due < sod) return `<span class="tk-due is-late">${icon('flag')}${dueLabel(t.due)}</span>`;
  const today = t.due < sod + 86_400_000;
  return `<span class="tk-due ${today ? 'is-today' : ''}">${icon('calendar')}${dueLabel(t.due)}</span>`;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function signature(t) {
  const subsDone = t.subtasks.filter((s) => s.done).length;
  return [t.title, t.status, t.priority, t.assignee, t.due, t.doneAt, t.projectId, project(t.projectId)?.name ?? '', subsDone, t.subtasks.length, t.comments.length, mailUrl(t), t.pr?.url || '', (t.labels || []).map((l) => l.name).join(','), startOfDay().getTime()].join('|');
}

const labelsHtml = (t) =>
  t.labels?.length ? `<div class="tk-labels">${t.labels.map((l) => `<span class="tk-label" style="--lb:${LABEL_HUE[l.color] || '#888'}">${esc(l.name)}</span>`).join('')}</div>` : '';

function cardInner(t) {
  const done = t.status === 'done';
  const subsDone = t.subtasks.filter((s) => s.done).length;
  const prio = !done && (t.priority === 'high' || t.priority === 'urgent') ? priorityPill(t.priority) : '';
  const who = member(t.assignee);
  return `<div class="tk-card__top">${projectChip(t.projectId)}${prio}
      <button type="button" class="tk-card__more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="Actions for “${esc(t.title)}”">${icon('more')}</button></div>
    <h3 class="tk-card__title"><button type="button" class="tk-card__open" data-open aria-describedby="tk-help">${
      done ? `<span class="tk-card__check">${CHECK}</span>` : ''
    }<span class="tk-card__text">${esc(t.title)}</span><span class="sr">, ${esc(statusLabel(t.status))}${who ? `, ${esc(who.name)}` : ''}</span></button></h3>
    ${labelsHtml(t)}
    ${t.subtasks.length ? `<div class="tk-card__subs"><span class="tk-meter"><i style="transform:scaleX(${subsDone / t.subtasks.length})"></i></span><span>${subsDone}/${t.subtasks.length}</span></div>` : ''}
    <div class="tk-card__foot">${dueItem(t)}${mailLink(t, 'tk-mail')}${sourceChip(t, 'tk-mail')}${prChip(t, 'tk-mail')}${t.comments.length ? `<span class="tk-card__cmt" title="${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}">${icon('message')}${t.comments.length}</span>` : ''}<span class="tk-card__who">${avatar(t.assignee, 'xs')}</span></div>
    <div class="tk-ses" data-ses-slot>${sessionSlot(t)}</div>`;
}

// ---------- Claude sessions on cards ----------
const sessionSlot = (t) => `${sessionStripHtml(t)}${sessionCtaHtml(t)}${prCtaHtml(t)}`;

/** Everything a card's session slot depends on, so unchanged cards are left alone. */
function sessionSig(t) {
  const r = runFor(t);
  return [sessionGate(), prSig(t), t.status, t.session?.sessionId || '', r?.run_id, r?.status, r?.live, r?.summary, r?.question, (r?.options || []).join('|'), r?.error, r?.files?.length].join('␟');
}

const busyClass = (t) => ({ working: ' is-claude', waiting: ' is-claude is-asking' })[sessionBusy(t)] || '';

/** Update only the cards and rows whose session changed (no board rebuild). */
function paintSessions() {
  if (!root || root.hidden) return void (dirty = true);
  if (drag) return void (pending = true); // painted after the drop
  if (view === 'board') {
    els.board.querySelectorAll('.tk-card[data-key]').forEach((el) => {
      const t = getTask(el.dataset.key);
      if (!t) return;
      const sig = sessionSig(t);
      if (el._ses === sig) return;
      el._ses = sig;
      el.classList.remove('is-claude', 'is-asking');
      busyClass(t).split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
      const slot = el.querySelector('[data-ses-slot]');
      if (slot) keepSessionFocus(slot, () => void (slot.innerHTML = sessionSlot(t)));
    });
  } else {
    els.groups.querySelectorAll('.tk-row[data-key]').forEach((row) => {
      const t = getTask(row.dataset.key);
      if (!t) return;
      const sig = sessionSig(t);
      if (row._ses === sig) return;
      keepSessionFocus(row, () => {
        const tmp = document.createElement('ul');
        tmp.innerHTML = rowHtml(t);
        const fresh = tmp.firstElementChild;
        fresh._ses = sig;
        row.replaceWith(fresh);
        return fresh;
      });
    });
  }
}

function applyCard(el, t) {
  el.className = `tk-card hue--${project(t.projectId)?.hue ?? 'blue'}${t.status === 'done' ? ' is-done' : ''}${busyClass(t)}`;
  keepSessionFocus(el, () => void (el.innerHTML = cardInner(t)));
  el._sig = signature(t);
  el._ses = sessionSig(t);
}

function makeCard(t) {
  const el = document.createElement('article');
  el.dataset.key = t.id;
  applyCard(el, t);
  el._status = t.status;
  return el;
}

function rowHtml(t) {
  const done = t.status === 'done';
  const strip = sessionStripHtml(t);
  return `<li class="tk-row hue--${project(t.projectId)?.hue ?? 'blue'}${done ? ' is-done' : ''}${busyClass(t)}${strip ? ' has-ses' : ''}" data-key="${t.id}">
    <button type="button" class="tk-row__ck" data-done role="checkbox" aria-checked="${done}" aria-label="${done ? 'Reopen' : 'Complete'} “${esc(t.title)}”"><span class="check">${CHECK}</span></button>
    <button type="button" class="tk-row__title" data-open>${esc(t.title)}</button>
    <span class="tk-row__meta"><span class="tk-row__proj">${projectChip(t.projectId)}</span>${dueItem(t)}${mailLink(t, 'tk-mail')}${sourceChip(t, 'tk-mail')}${prChip(t, 'tk-mail')}<span class="tk-row__prio">${priorityPill(t.priority)}</span></span>
    <span class="tk-row__who">${sessionCtaHtml(t, { compact: true })}${avatar(t.assignee, 'sm')}</span>
    ${strip ? `<div class="tk-row__ses">${strip}</div>` : ''}
  </li>`;
}

const STATUS_EMPTY = (status) => (filterOn() ? 'No matches' : status === 'done' ? 'Drag finished work here' : 'Drop a task here');

function shell() {
  const s = stats();
  const head = pageHead({
    title: 'Tasks',
    sub: `<span data-sub>${subText(s)}</span>`,
    actions:
      segmented('Tasks view', [['board', `${icon('grid')}<span>Board</span>`], ['list', `${icon('list')}<span>List</span>`]], view, 'tk-viewseg') +
      `<button type="button" class="btn btn--accent" data-act="new">${icon('plus')}New task</button>`,
    stats: [
      { label: 'Open', value: s.open },
      { label: 'Due this week', value: s.week },
      { label: 'Overdue', value: s.late },
      { label: 'Done this week', value: s.done },
    ],
  });

  const bar = `<div class="tk-bar glass" role="toolbar" aria-label="Filter tasks">
    <button type="button" class="tk-chip" data-f="board" aria-haspopup="menu" aria-expanded="false"></button>
    <button type="button" class="tk-chip" data-f="project" aria-haspopup="menu" aria-expanded="false"></button>
    <button type="button" class="tk-chip" data-f="mine" aria-pressed="false">${avatar(state.me, 'xs', { extra: 'tk-chip__av' })}<span>Mine only</span></button>
    <button type="button" class="tk-chip" data-f="prio" aria-haspopup="menu" aria-expanded="false"></button>
    <label class="tk-find">${icon('search')}<span class="sr">Filter tasks</span>
      <input type="search" class="tk-find__input" placeholder="Filter by title, project or person" autocomplete="off" spellcheck="false"></label>
    <button type="button" class="tk-clear" data-f="clear" hidden>Clear</button>
  </div>`;

  const cols = STATUSES.map(
    ([id, name]) => `<section class="card glass tk-col" data-status="${id}" aria-labelledby="tkc-${id}">
      <div class="tk-col__head"><span class="tk-dot tk-dot--${id}" aria-hidden="true"></span>
        <h2 class="tk-col__name" id="tkc-${id}">${name}</h2><span class="tk-col__count" data-count-col>0</span>
        ${iconBtn('plus', `Add task to ${name}`, `data-add="${id}"`, 'ibtn--sm tk-col__add')}</div>
      <p class="tk-col__empty" hidden></p>
      <div class="tk-col__list" data-list></div>
      ${id === 'done' ? '<button type="button" class="tk-col__all" data-all hidden></button>' : ''}
    </section>`,
  ).join('');

  const groups = STATUSES.map(
    ([id, name]) => `<section class="tk-group" data-group="${id}">
      <h3><button type="button" class="tk-group__btn" aria-expanded="${!collapsed.has(id)}" aria-controls="tkg-${id}">
        <span class="tk-group__chev">${icon('chevronDown')}</span><span class="tk-dot tk-dot--${id}" aria-hidden="true"></span>
        <span class="tk-group__name">${name}</span><span class="badge" data-gcount>0</span></button></h3>
      <ul class="tk-rows" id="tkg-${id}" ${collapsed.has(id) ? 'hidden' : ''}></ul>
    </section>`,
  ).join('');

  const list = card({
    id: 'tk-listcard',
    cls: 'tk-listcard',
    title: 'All tasks',
    sub: '<span data-list-sub></span>',
    tools: segmented('Sort by', [['due', 'Due'], ['prio', 'Priority']], sort, 'seg--sm tk-sortseg'),
    body: `<div class="tk-groups">${groups}</div>
      <div class="tk-list-empty" hidden><div class="empty">${icon('search')}<b>No tasks match</b><span>Try a different filter, or clear them all.</span>
        <button type="button" class="btn btn--glass btn--sm" data-f="clear">Clear filters</button></div></div>`,
  });

  const start = `<section class="tk-start glass" aria-labelledby="tk-start-title" hidden>
    <span class="tk-start__art" aria-hidden="true">${icon('tasks')}</span>
    <h2 class="tk-start__title" id="tk-start-title">Your board is empty</h2>
    <p class="tk-start__text">Add what’s on your mind. Tasks move from To do to Done as you work through them.</p>
    <button type="button" class="btn btn--accent" data-act="new">${icon('plus')}Add your first task</button>
    <p class="tk-start__hint">${icon('mail')}<span>Tip: open an email in the <a href="#/inbox">Inbox</a> and turn it into a task; it keeps a link back to the message.</span></p>
  </section>`;

  return `${head}
    <p class="sr" id="tk-help">Press Enter to open. Alt plus Left or Right arrow moves the task to another column; the actions button lists every move.</p>
    <div class="tk">${start}${bar}<div class="tk-board" ${view === 'board' ? '' : 'hidden'}>${cols}</div>${list.replace('<section', `<section ${view === 'list' ? '' : 'hidden'}`)}</div>`;
}

// ---------- head + bar ----------
function renderHead(animate) {
  const s = stats();
  els.sub.textContent = subText(s);
  const vals = [s.open, s.week, s.late, s.done];
  els.stats.forEach((st, i) => {
    const b = st.querySelector('b');
    const changed = +b.dataset.count !== vals[i];
    b.dataset.count = vals[i];
    if (changed) {
      countTo(b, vals[i]);
      if (animate) flash(st);
    }
  });
  els.stats[2].classList.toggle('is-alert', s.late > 0);
}

function flash(el) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

function syncStart() {
  const empty = !boardTasks().length;
  els.tk.classList.toggle('is-empty', empty);
  els.tk.classList.toggle('is-solo', allMine());
  els.start.hidden = !empty;
}

function renderBar() {
  const bc = els.bar.querySelector('[data-f="board"]');
  bc.innerHTML = `${icon('grid')}<span class="tk-chip__label">${esc(activeBoard().name)}</span>${icon('chevronDown', 'tk-chip__caret')}`;
  bc.setAttribute('aria-label', `Board: ${activeBoard().name}`);
  if (filter.project && !project(filter.project)) filter.project = '';
  const p = filter.project && project(filter.project);
  const pc = els.bar.querySelector('[data-f="project"]');
  pc.classList.toggle('is-on', !!p);
  pc.innerHTML = `${p ? `<span class="tk-hue hue--${p.hue}" aria-hidden="true"></span>` : icon('folder')}<span class="tk-chip__label">${esc(p ? p.name : 'All projects')}</span>${icon('chevronDown', 'tk-chip__caret')}`;
  pc.setAttribute('aria-label', `Project: ${p ? p.name : 'All projects'}`);

  const mc = els.bar.querySelector('[data-f="mine"]');
  const hideMine = allMine();
  if (hideMine) filter.mine = false;
  mc.hidden = hideMine;
  mc.classList.toggle('is-on', filter.mine);
  mc.setAttribute('aria-pressed', filter.mine);

  const rc = els.bar.querySelector('[data-f="prio"]');
  rc.classList.toggle('is-on', !!filter.prio);
  rc.innerHTML = `${icon('flag')}<span class="tk-chip__label">${filter.prio ? `${cap(filter.prio)} only` : 'Any priority'}</span>${icon('chevronDown', 'tk-chip__caret')}`;
  rc.setAttribute('aria-label', `Priority: ${filter.prio ? cap(filter.prio) : 'Any'}`);

  els.bar.querySelector('.tk-clear').hidden = !filterOn();
}

// ---------- board ----------
function renderBoard(animate = true) {
  if (drag) {
    pending = true;
    return;
  }
  const motion = animate && !reduced();
  const before = new Map();
  const where = new Map();
  const existing = new Map();
  els.board.querySelectorAll('.tk-card[data-key]').forEach((el) => {
    existing.set(el.dataset.key, el);
    where.set(el.dataset.key, el.closest('.tk-col').dataset.status);
    if (motion) before.set(el.dataset.key, el.getBoundingClientRect());
  });

  const wanted = new Map();
  const perCol = STATUSES.map(([status]) => {
    const all = columnTasks(status);
    const shown = status === 'done' && !showAllDone ? all.slice(0, DONE_LIMIT) : all;
    shown.forEach((t) => wanted.set(t.id, t));
    return { status, all, shown };
  });

  // Cards that leave: pin where they are, then fade out.
  for (const [id, el] of existing) {
    if (wanted.has(id)) continue;
    existing.delete(id);
    el.removeAttribute('data-key');
    if (!motion) {
      el.remove();
      continue;
    }
    const list = el.parentElement;
    Object.assign(el.style, { position: 'absolute', left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, pointerEvents: 'none', margin: 0 });
    list.append(el);
    gsap.to(el, { opacity: 0, scale: 0.9, duration: 0.24, ease: 'power2.in', onComplete: () => el.remove() });
  }

  const entered = [];
  const completed = [];
  const received = new Set();
  for (const { status, all, shown } of perCol) {
    const col = els.cols[status];
    const list = col.querySelector('[data-list]');
    shown.forEach((t, i) => {
      let el = existing.get(t.id);
      if (!el) {
        el = makeCard(t);
        entered.push(el);
      } else {
        if (el._sig !== signature(t)) applyCard(el, t);
        if (el._status !== 'done' && t.status === 'done') completed.push(el);
        if (where.get(t.id) !== status) received.add(col);
        el._status = t.status;
      }
      const at = list.children[i];
      if (at !== el) list.insertBefore(el, at || null);
    });

    const count = col.querySelector('[data-count-col]');
    if (count.textContent !== String(all.length)) {
      count.textContent = all.length;
      if (motion) flash(count);
    }
    const empty = col.querySelector('.tk-col__empty');
    empty.hidden = shown.length > 0;
    empty.textContent = STATUS_EMPTY(status);
    const more = col.querySelector('[data-all]');
    if (more) {
      more.hidden = all.length <= DONE_LIMIT;
      more.textContent = showAllDone ? 'Show fewer' : `Show all ${all.length}`;
      more.setAttribute('aria-expanded', showAllDone);
    }
  }

  if (!motion) return;
  received.forEach((col) => {
    col.style.zIndex = 3;
    gsap.delayedCall(0.75, () => (col.style.zIndex = ''));
  });
  els.board.querySelectorAll('.tk-card[data-key]').forEach((el) => {
    const old = before.get(el.dataset.key);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) gsap.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.55, ease: 'power3.inOut', onComplete: () => tidy(el) });
    el._moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
  });
  entered.forEach((el, i) =>
    gsap.fromTo(el, { opacity: 0, y: 14, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.6)', delay: 0.1 + i * 0.03, onComplete: () => tidy(el) }),
  );
  completed.forEach((el) => burst(el, el._moved ? 0.5 : 0));
}

function tidy(el) {
  if (!gsap.isTweening(el) && !el.classList.contains('is-lifted')) gsap.set(el, { clearProps: 'transform,opacity' });
}

function burst(el, delay) {
  if (reduced()) return;
  const check = el.querySelector('.tk-card__check');
  if (check) {
    gsap.fromTo(check, { scale: 0, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.75, ease: 'back.out(3.4)', delay, clearProps: 'transform' });
    const ring = document.createElement('span');
    ring.className = 'tk-burst';
    check.append(ring);
    gsap.fromTo(ring, { scale: 0.5, opacity: 1 }, { scale: 2.8, opacity: 0, duration: 0.8, ease: 'power2.out', delay, onComplete: () => ring.remove() });
  }
  gsap
    .timeline({ delay, onComplete: () => tidy(el) })
    .to(el, { scale: 1.035, duration: 0.15, ease: 'power2.out' })
    .to(el, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.42)' });
}

// ---------- list ----------
function renderList(animate = true) {
  const motion = animate && !reduced();
  const before = new Map();
  if (motion) els.groups.querySelectorAll('.tk-row[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect()));

  let total = 0;
  for (const [status] of STATUSES) {
    const g = els.groups.querySelector(`[data-group="${status}"]`);
    const ts = listTasks(status);
    total += ts.length;
    const ul = g.querySelector('.tk-rows');
    keepSessionFocus(ul, () => void (ul.innerHTML = ts.map(rowHtml).join('')));
    ul.querySelectorAll('.tk-row[data-key]').forEach((row) => (row._ses = sessionSig(getTask(row.dataset.key))));
    g.querySelector('[data-gcount]').textContent = ts.length;
    g.hidden = filterOn() && !ts.length;
    const chev = g.querySelector('.tk-group__chev');
    if (!gsap.isTweening(chev)) gsap.set(chev, { rotation: collapsed.has(status) ? -90 : 0 });
  }
  els.listSub.textContent = filterOn() ? `${total} match${total === 1 ? '' : 'es'}` : `${total} on the board`;
  els.listEmpty.hidden = total > 0;
  els.groups.hidden = total === 0;

  if (!motion) return;
  let n = 0;
  els.groups.querySelectorAll('.tk-rows:not([hidden]) .tk-row').forEach((el) => {
    const old = before.get(el.dataset.key);
    if (!old) {
      const i = n++;
      gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', delay: Math.min(i, 12) * 0.015, clearProps: 'transform,opacity' });
      return;
    }
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (dx || dy) gsap.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.55, ease: 'power3.inOut', clearProps: 'transform' });
  });
}

const statusSig = () => JSON.stringify(STATUSES);
let colSig = statusSig();
/** The active board's lists changed (rename, add, switch): rebuild the column shells, cards are repainted by renderBoard/renderList. */
function rebuildColumns() {
  const tmp = document.createElement('div');
  tmp.innerHTML = shell();
  els.board.innerHTML = tmp.querySelector('.tk-board').innerHTML;
  els.groups.innerHTML = tmp.querySelector('.tk-groups').innerHTML;
  els.cols = Object.fromEntries([...els.board.querySelectorAll('.tk-col')].map((c) => [c.dataset.status, c]));
  colSig = statusSig();
}

function renderAll(animate) {
  if (colSig !== statusSig()) rebuildColumns();
  const wasEmpty = els.tk.classList.contains('is-empty');
  syncStart();
  renderHead(animate);
  renderBar();
  if (view === 'board') renderBoard(animate);
  else renderList(animate);
  paintSessions();
  dirty = false;
  // First task added (or the last one removed): bring the new layout in.
  const nowEmpty = els.tk.classList.contains('is-empty');
  if (animate && wasEmpty !== nowEmpty) {
    revealCards(nowEmpty ? [els.start] : [els.bar, ...(view === 'board' ? Object.values(els.cols) : [els.listcard])], { y: 18, stagger: 0.05, kids: false });
  }
}

function onData() {
  if (!root || root.hidden) {
    dirty = true;
    return;
  }
  if (drag) {
    pending = true;
    return;
  }
  renderAll(true);
}

// ---------- view / filters ----------
function setView(v) {
  if (v === view) return;
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  const outgoing = view === 'board' ? [...els.board.querySelectorAll('.tk-col')].filter(onScreen) : [els.listcard];
  view = v;
  collapseOut(outgoing, () => {
    gsap.set(outgoing, { clearProps: 'all' });
    els.board.hidden = view !== 'board';
    els.listcard.hidden = view !== 'list';
    if (view === 'board') renderBoard(false);
    else renderList(false);
    paintSessions();
    const incoming = view === 'board' ? [...els.board.querySelectorAll('.tk-col')] : [els.listcard];
    revealCards(incoming, { y: 18, stagger: 0.05, from: 0.8, kids: false });
    const items = view === 'board' ? els.board.querySelectorAll('.tk-card') : els.groups.querySelectorAll('.tk-rows:not([hidden]) .tk-row');
    fadeUp([...items].filter(onScreen).slice(0, 40), { y: 12, stagger: 0.018, delay: 0.16 });
  });
}

function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

function applyFilter() {
  renderBar();
  if (view === 'board') renderBoard(true);
  else renderList(true);
}

function clearFilters() {
  Object.assign(filter, { project: '', mine: false, prio: '', q: '' });
  searchCall?.kill();
  els.search.value = '';
  applyFilter();
}

function boardMenu(anchor) {
  const cur = activeBoard().id;
  const rows = boards()
    .map((b) => `<button type="button" class="menu__item" role="menuitemradio" aria-checked="${b.id === cur}" data-b="${esc(b.id)}"><span>${esc(b.name)}</span><i class="tk-pmenu__tick">${b.id === cur ? icon('check', 'menu__check') : ''}</i></button>`)
    .join('');
  const html = `<div class="menu" role="menu" aria-label="Boards">${rows}</div>
    <form class="tk-bmenu__form"><input type="text" class="tk-bmenu__input" placeholder="Board name" maxlength="60" aria-label="Board name" autocomplete="off">
      <button type="button" class="btn btn--accent btn--sm" data-bact="add">Add</button>
      <button type="button" class="btn btn--glass btn--sm" data-bact="rename">Rename</button>${boards().length > 1 ? '<button type="button" class="btn btn--glass btn--sm" data-bact="del">Delete</button>' : ''}</form>`;
  const el = openPopover(anchor, html, { cls: 'pop--menu tk-pmenu', align: 'start' });
  if (!el) return;
  (el.querySelector('[aria-checked="true"]') || el.querySelector('.menu__item')).focus();
  const input = el.querySelector('.tk-bmenu__input');
  el.addEventListener('submit', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    const act = e.target.closest('[data-bact]')?.dataset.bact;
    if (b) {
      closePopover();
      anchor.focus();
      return switchBoard(b.dataset.b);
    }
    if (!act) return;
    const name = input.value.trim();
    if (act === 'del') {
      closePopover();
      return void (confirm(`Delete “${activeBoard().name}”? Its cards move to ${boards().find((x) => x.id !== cur).name}.`) && deleteBoard(cur));
    }
    if (!name) return input.focus();
    closePopover();
    if (act === 'add') addBoard(name);
    else renameBoard(cur, name);
  });
}

function projectMenu(anchor) {
  const active = boardTasks();
  const rows = state.projects
    .map((p) => ({ p, open: active.filter((t) => t.projectId === p.id && t.status !== 'done').length, any: active.some((t) => t.projectId === p.id) }))
    .filter((r) => r.any);
  const item = (id, lead, name, meta) =>
    `<button type="button" class="menu__item" role="menuitemradio" aria-checked="${filter.project === id}" data-p="${id}">${lead}<span>${esc(name)}</span>${
      meta ? `<small class="tk-pmenu__count">${meta}</small>` : ''
    }<i class="tk-pmenu__tick">${filter.project === id ? icon('check', 'menu__check') : ''}</i></button>`;
  const none = !rows.length
    ? `<p class="tk-pmenu__none" role="note">${icon('folder')}<span>${state.projects.length ? 'No tasks are in a project yet' : 'No projects yet'}</span></p>`
    : '';
  const html = `<div class="menu" role="menu" aria-label="Filter by project">${item('', '<span class="tk-hue tk-hue--all" aria-hidden="true"></span>', 'All projects', '')}${rows
    .map((r) => item(r.p.id, `<span class="tk-hue hue--${r.p.hue}" aria-hidden="true"></span>`, r.p.name, `${r.open} open`))
    .join('')}${none}</div>`;
  const el = openPopover(anchor, html, { cls: 'pop--menu tk-pmenu', align: 'start' });
  if (!el) return;
  const btns = [...el.querySelectorAll('.menu__item')];
  (btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0]).focus();
  fadeUp(btns, { y: 6, stagger: 0.02, duration: 0.35 });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    closePopover();
    anchor.focus();
    if (filter.project === b.dataset.p) return;
    filter.project = b.dataset.p;
    applyFilter();
  });
  el.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = btns[(i + 1) % btns.length];
    else if (e.key === 'ArrowUp') next = btns[(i - 1 + btns.length) % btns.length];
    else if (e.key === 'Home') next = btns[0];
    else if (e.key === 'End') next = btns[btns.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });
}

function prioMenu(anchor) {
  const pick = (v) => () => {
    anchor.focus();
    if (filter.prio === v) return;
    filter.prio = v;
    applyFilter();
  };
  openMenu(anchor, [
    { label: 'Any priority', checked: !filter.prio, onSelect: pick('') },
    '-',
    ...[...PRIORITIES].reverse().map((p) => ({ label: cap(p), checked: filter.prio === p, onSelect: pick(p) })),
  ]);
}

// ---------- moves (menu + keyboard) ----------
function moveTo(t, status, { focusSel = '.tk-card__more' } = {}) {
  const snap = snapshot();
  if (status !== 'done') {
    // Top of the target column: everyone else shifts down one slot.
    boardTasks()
      .filter((x) => x.status === status && x !== t)
      .sort(byOrder)
      .forEach((x, i) => (x.order = i + 1));
    t.order = 0;
  }
  const changed = t.status !== status;
  if (changed) setTaskStatus(t, status);
  else commit('tasks');
  notify(status === 'done' ? `Done: ${t.title}` : changed ? `Moved to ${statusLabel(status)}` : `Moved to the top of ${statusLabel(status)}`, {
    undo: () => restore(snap),
  });
  requestAnimationFrame(() => root.querySelector(`.tk-card[data-key="${CSS.escape(t.id)}"] ${focusSel}`)?.focus({ preventScroll: true }));
}

function cardMenu(btn) {
  const t = getTask(btn.closest('[data-key]')?.dataset.key);
  if (!t) return;
  openMenu(
    btn,
    [
      ...STATUSES.map(([s, label]) => ({
        label: `Move to ${label}`,
        checked: t.status === s,
        onSelect: () => (t.status === s ? btn.focus() : moveTo(t, s)),
      })),
      '-',
      { label: 'Open task', icon: 'arrowRight', onSelect: () => openDeep(t.id) },
    ],
    { align: 'end' },
  );
}

// ---------- deep-linked drawer ----------
function openDeep(id) {
  const target = `#/tasks/${encodeURIComponent(id)}`;
  if (location.hash !== target) location.hash = target;
  else showTask(id);
}

function showTask(id) {
  if (!getTask(id)) {
    openTask(id); // shows the "no longer exists" notice
    history.replaceState(null, '', '#/tasks');
    return;
  }
  openTask(id);
  const dlg = document.getElementById('drawer');
  if (dlg && !dlg._tkWatch) {
    dlg._tkWatch = true;
    dlg.addEventListener('close', () => {
      if (location.hash.startsWith('#/tasks/')) history.replaceState(null, '', '#/tasks');
    });
  }
}

// ---------- list interactions ----------
function toggleGroup(btn) {
  const g = btn.closest('[data-group]');
  const id = g.dataset.group;
  const ul = g.querySelector('.tk-rows');
  const chev = g.querySelector('.tk-group__chev');
  const closing = !collapsed.has(id);
  closing ? collapsed.add(id) : collapsed.delete(id);
  btn.setAttribute('aria-expanded', !closing);
  gsap.to(chev, { rotation: closing ? -90 : 0, duration: dur(0.45), ease: 'back.out(2)' });
  const rows = [...ul.children];
  if (closing) {
    if (reduced() || !rows.length) {
      ul.hidden = true;
      return;
    }
    gsap.to(rows.filter(onScreen), {
      opacity: 0, y: -6, duration: 0.16, ease: 'power2.in', stagger: 0.012,
      onComplete: () => {
        if (collapsed.has(id)) ul.hidden = true;
        gsap.set(rows, { clearProps: 'opacity,transform' });
      },
    });
  } else {
    gsap.killTweensOf(rows);
    gsap.set(rows, { clearProps: 'opacity,transform' });
    ul.hidden = false;
    fadeUp(rows.slice(0, 30), { y: 8, stagger: 0.02, duration: 0.4 });
  }
}

function checkRow(btn) {
  const row = btn.closest('[data-key]');
  const t = getTask(row.dataset.key);
  if (!t || row.dataset.busy) return;
  row.dataset.busy = '1';
  const on = t.status !== 'done';
  row.classList.toggle('is-done', on);
  btn.setAttribute('aria-checked', on);
  if (!reduced()) gsap.fromTo(btn.querySelector('.check'), { scale: 0.6 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
  gsap.delayedCall(dur(0.45), () => {
    toggleDone(t);
    if (t.status !== 'done') notify(`Reopened “${t.title}”`, { ico: 'reset', undo: () => setTaskStatus(t, 'done') });
  });
}

// ---------- drag & drop ----------
function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'tk-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  return layer;
}

function onPointerDown(e) {
  if (drag || view !== 'board') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!e.isPrimary) return;
  const el = e.target.closest('.tk-card[data-key]');
  if (!el || !els.board.contains(el) || e.target.closest('[data-more], a[href], [data-ses-launch], [data-gh-pr], .ses-strip__ask, .ses-strip__acts')) return;
  const t = getTask(el.dataset.key);
  if (!t) return;
  const mouse = e.pointerType === 'mouse';
  drag = {
    el, task: t, pointerId: e.pointerId, mouse, on: false,
    x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, t: performance.now(), vx: 0,
    slot: null, col: null, idx: -1, col0: t.status, idx0: -1, hold: null, rot: null, ox: 0, oy: 0, h: 0,
  };
  if (!mouse) {
    if (!reduced()) gsap.to(el, { scale: 0.975, duration: 0.28, ease: 'power2.out' });
    drag.hold = gsap.delayedCall(0.28, lift);
  }
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  addEventListener('pointercancel', onPointerUp);
}

function cancelPress() {
  if (!drag || drag.on) return;
  drag.hold?.kill();
  const { el, mouse } = drag;
  detach();
  drag = null;
  if (!mouse && !reduced()) gsap.to(el, { scale: 1, duration: 0.45, ease: 'back.out(2)', clearProps: 'transform' });
  else gsap.set(el, { clearProps: 'transform' });
  flushPending();
}

function detach() {
  removeEventListener('pointermove', onPointerMove);
  removeEventListener('pointerup', onPointerUp);
  removeEventListener('pointercancel', onPointerUp);
  gsap.ticker.remove(autoScroll);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const now = performance.now();
  const dx = e.clientX - drag.px;
  const dt = Math.max(1, now - drag.t);
  drag.px = e.clientX;
  drag.py = e.clientY;
  drag.t = now;
  if (!drag.on) {
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (drag.mouse && dist > 5) lift();
    else if (!drag.mouse && dist > 10) cancelPress();
    return;
  }
  drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4;
  gsap.set(drag.el, { x: drag.px - drag.x0, y: drag.py - drag.y0 });
  drag.rot?.(clamp(-9, 9, 2.5 + drag.vx * 7));
  hitTest();
}

function lift() {
  const d = drag;
  if (!d || d.on) return;
  d.on = true;
  const { el } = d;
  gsap.killTweensOf(el);
  gsap.set(el, { clearProps: 'transform,opacity' });
  const r = el.getBoundingClientRect();
  d.left = r.left;
  d.top = r.top;
  d.h = r.height;
  d.offsetY = d.y0 - r.top;

  const slot = document.createElement('div');
  slot.className = 'tk-slot';
  slot.style.height = `${r.height}px`;
  el.before(slot);
  d.slot = slot;
  d.col = d.col0;
  d.idx0 = d.idx = slotIndex();

  ensureLayer().append(el);
  Object.assign(el.style, { position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0 });
  el.classList.add('is-lifted');
  els.cols[d.col0].classList.add('is-over');
  document.documentElement.classList.add('tk-dragging');
  els.board.classList.add('is-dragging');
  gsap.set(el, { x: d.px - d.x0, y: d.py - d.y0, rotation: reduced() ? 0 : 2.5 });
  if (!reduced()) {
    gsap.fromTo(el, { scale: 1 }, { scale: 1.045, duration: 0.5, ease: 'back.out(2.4)' });
    d.rot = gsap.quickTo(el, 'rotation', { duration: 0.45, ease: 'power3.out' });
  }
  gsap.ticker.add(autoScroll);
  updateEmpties();
  if (navigator.vibrate && !d.mouse) navigator.vibrate(8);
}

function listCards(list) {
  return [...list.querySelectorAll(':scope > .tk-card[data-key]')];
}

function slotIndex() {
  const list = drag.slot.parentElement;
  return [...list.children].filter((c) => c === drag.slot || c.matches('.tk-card[data-key]')).indexOf(drag.slot);
}

function hitTest() {
  const d = drag;
  if (!d?.on) return;
  let best = null;
  let bestDist = Infinity;
  for (const [status] of STATUSES) {
    const r = els.cols[status].getBoundingClientRect();
    const dist = d.px < r.left ? r.left - d.px : d.px > r.right ? d.px - r.right : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = status;
    }
  }
  const list = els.cols[best].querySelector('[data-list]');
  let idx;
  if (best === 'done') idx = d.col0 === 'done' ? d.idx0 : 0;
  else {
    const centre = d.py - d.offsetY + d.h / 2;
    const cards = listCards(list);
    idx = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      const mid = r.top - (gsap.getProperty(cards[i], 'y') || 0) + r.height / 2;
      if (mid > centre) {
        idx = i;
        break;
      }
    }
  }
  if (best !== d.col || idx !== d.idx) moveSlot(best, idx);
}

function moveSlot(status, idx) {
  const d = drag;
  const from = els.cols[d.col].querySelector('[data-list]');
  const to = els.cols[status].querySelector('[data-list]');
  const sibs = new Set([...listCards(from), ...listCards(to)]);
  const motion = !reduced();
  const before = new Map();
  if (motion) sibs.forEach((c) => before.set(c, c.getBoundingClientRect()));

  const cards = listCards(to);
  to.insertBefore(d.slot, cards[idx] || null);
  if (d.col !== status) {
    els.cols[d.col].classList.remove('is-over');
    els.cols[status].classList.add('is-over');
  }
  d.col = status;
  d.idx = idx;
  updateEmpties();
  if (!motion) return;
  gsap.fromTo(d.slot, { scale: 0.94 }, { scale: 1, duration: 0.45, ease: 'back.out(2)', clearProps: 'transform' });
  sibs.forEach((c) => {
    const old = before.get(c);
    gsap.set(c, { x: 0, y: 0 });
    const now = c.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) gsap.fromTo(c, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.42, ease: 'power3.out', overwrite: 'auto' });
  });
}

function updateEmpties() {
  for (const [status] of STATUSES) {
    const col = els.cols[status];
    const list = col.querySelector('[data-list]');
    const empty = col.querySelector('.tk-col__empty');
    empty.hidden = listCards(list).length > 0 || list.contains(drag?.slot);
  }
}

function autoScroll() {
  const d = drag;
  if (!d?.on) return;
  let moved = false;
  const b = els.board;
  if (b.scrollWidth > b.clientWidth + 1) {
    const r = b.getBoundingClientRect();
    const zone = Math.min(72, r.width * 0.16);
    let s = 0;
    if (d.px < r.left + zone) s = -16 * clamp(0, 1, 1 - (d.px - r.left) / zone);
    else if (d.px > r.right - zone) s = 16 * clamp(0, 1, 1 - (r.right - d.px) / zone);
    if (s) {
      const prev = b.scrollLeft;
      b.scrollLeft += s;
      moved ||= b.scrollLeft !== prev;
    }
  }
  const bottom = innerHeight - (phone() ? 124 : 64);
  let v = 0;
  if (d.py < 96) v = -18 * clamp(0, 1, 1 - d.py / 96);
  else if (d.py > bottom) v = 18 * clamp(0, 1, (d.py - bottom) / (innerHeight - bottom));
  if (v) {
    const prev = scrollY;
    scrollBy(0, v);
    moved ||= scrollY !== prev;
  }
  d.vx *= 0.85;
  d.rot?.(clamp(-9, 9, 2.5 + d.vx * 7));
  if (moved) hitTest();
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.on) return cancelPress();
  dropDrag(false);
}

function dropDrag(instant) {
  const d = drag;
  if (!d?.on) return;
  detach();
  blockClicksUntil = Date.now() + 450;
  const { el, slot } = d;
  const finish = () => {
    slot.replaceWith(el);
    gsap.killTweensOf(el);
    el.style.cssText = '';
    gsap.set(el, { clearProps: 'all' });
    el.classList.remove('is-lifted');
    document.documentElement.classList.remove('tk-dragging');
    els.board.classList.remove('is-dragging');
    Object.values(els.cols).forEach((c) => c.classList.remove('is-over'));
    drag = null;
    const intoDone = d.col === 'done' && d.col0 !== 'done';
    if (!instant && !intoDone && !reduced())
      gsap.fromTo(el, { scaleX: 1.03, scaleY: 0.96 }, { scaleX: 1, scaleY: 1, duration: 0.65, ease: 'elastic.out(1, 0.45)', clearProps: 'transform' });
    if (d.col !== d.col0 || (d.idx !== d.idx0 && d.col !== 'done')) commitDrop(d);
    else flushPending(true);
  };
  if (instant || reduced()) return finish();
  const s = slot.getBoundingClientRect();
  d.rot = null;
  gsap.killTweensOf(el);
  gsap.to(el, { x: s.left - d.left, y: s.top - d.top, rotation: 0, scale: 1, duration: 0.4, ease: 'power3.out', onComplete: finish });
}

function commitDrop(d) {
  const t = d.task;
  const snap = snapshot();
  if (d.col !== 'done') {
    renumber(d.col);
    const keys = listCards(els.cols[d.col].querySelector('[data-list]')).map((c) => c.dataset.key);
    const i = keys.indexOf(t.id);
    const prev = getTask(keys[i - 1]);
    const next = getTask(keys[i + 1]);
    const po = prev && prev !== t ? prev.order : null;
    const no = next && next !== t ? next.order : null;
    t.order = po != null && no != null ? (po + no) / 2 : po != null ? po + 0.5 : no != null ? no - 0.5 : 0;
    renumberWith(d.col, t);
  }
  pending = false;
  const changed = t.status !== d.col;
  if (changed) setTaskStatus(t, d.col);
  else commit('tasks');
  notify(d.col === 'done' && changed ? `Done: ${t.title}` : changed ? `Moved to ${statusLabel(d.col)}` : `Reordered in ${statusLabel(d.col)}`, {
    undo: () => restore(snap),
  });
}

/** Renumber a target column including a task that may still carry its old status. */
function renumberWith(status, t) {
  boardTasks()
    .filter((x) => x.status === status || x === t)
    .sort(byOrder)
    .forEach((x, i) => (x.order = i));
}

function flushPending(force = false) {
  if (!pending && !force) return;
  pending = false;
  if (root && !root.hidden) renderAll(true);
}

// ---------- wiring ----------
function wire() {
  root.addEventListener(
    'click',
    (e) => {
      if (Date.now() < blockClicksUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  root.addEventListener('click', (e) => {
    const t = e.target;
    const holder = t.closest('.tk-card[data-key], .tk-row[data-key]');
    if (holder && t.closest('[data-ses-launch], [data-ses], [data-gh-pr]')) {
      const task = getTask(holder.dataset.key);
      if (task && handleSessionClick(e, task)) return;
    }
    const f = t.closest('[data-f]');
    if (f) {
      const kind = f.dataset.f;
      if (kind === 'board') boardMenu(f);
      else if (kind === 'project') projectMenu(f);
      else if (kind === 'prio') prioMenu(f);
      else if (kind === 'mine') {
        filter.mine = !filter.mine;
        applyFilter();
        if (filter.mine && !reduced()) gsap.fromTo(f.querySelector('.av'), { scale: 0.5 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', clearProps: 'transform' });
      } else if (kind === 'clear') {
        clearFilters();
        els.search.focus();
      }
      return;
    }
    if (t.closest('[data-more]')) return cardMenu(t.closest('[data-more]'));
    if (t.closest('[data-done]')) return checkRow(t.closest('[data-done]'));
    const open = t.closest('[data-open]');
    if (open) return openDeep(open.closest('[data-key]').dataset.key);
    const add = t.closest('[data-add]');
    if (add) return newTask({ status: add.dataset.add, projectId: filter.project || undefined });
    if (t.closest('[data-act="new"]')) return newTask({ projectId: filter.project || undefined });
    const all = t.closest('[data-all]');
    if (all) {
      showAllDone = !showAllDone;
      renderBoard(true);
      return;
    }
    const gb = t.closest('.tk-group__btn');
    if (gb) toggleGroup(gb);
  });

  // Keyboard alternative to dragging: Alt + ←/→ moves a focused card.
  root.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.target.matches('input, textarea, select')) return;
    const holder = e.target.closest('.tk-card[data-key], .tk-row[data-key]');
    if (!holder) return;
    const t = getTask(holder.dataset.key);
    if (!t) return;
    const i = STATUSES.findIndex(([s]) => s === t.status);
    const next = STATUSES[i + (e.key === 'ArrowRight' ? 1 : -1)];
    e.preventDefault();
    if (!next) return;
    if (holder.classList.contains('tk-row')) {
      const snap = snapshot();
      setTaskStatus(t, next[0]);
      notify(`Moved to ${next[1]}`, { undo: () => restore(snap) });
      requestAnimationFrame(() => root.querySelector(`.tk-row[data-key="${CSS.escape(t.id)}"] .tk-row__title`)?.focus());
    } else moveTo(t, next[0], { focusSel: '.tk-card__open' });
  });

  els.search.addEventListener('input', () => {
    searchCall?.kill();
    searchCall = gsap.delayedCall(0.14, () => {
      const q = els.search.value.trim();
      if (q === filter.q) return;
      filter.q = q;
      applyFilter();
    });
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !els.search.value) return;
    e.stopPropagation();
    e.preventDefault();
    searchCall?.kill();
    els.search.value = '';
    if (filter.q) {
      filter.q = '';
      applyFilter();
    }
  });

  // Session controls on cards never start a drag (see onPointerDown).
  els.board.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('submit', (e) => {
    const holder = e.target.closest('[data-key]');
    const task = holder && getTask(holder.dataset.key);
    if (task) handleSessionSubmit(e, task);
    else if (e.target.closest('[data-ses-reply]')) e.preventDefault();
  });
  root.addEventListener('input', (e) => {
    const holder = e.target.closest('[data-key]');
    if (holder) trackSessionDraft(e, getTask(holder.dataset.key));
  });
  root.addEventListener('contextmenu', (e) => drag && e.target.closest('.tk-card') && e.preventDefault());
  document.addEventListener('touchmove', (e) => drag?.on && e.cancelable && e.preventDefault(), { passive: false });
  addEventListener('blur', () => (drag?.on ? dropDrag(true) : cancelPress()));

  bindSegmented(root.querySelector('.tk-viewseg'), setView);
  bindSegmented(root.querySelector('.tk-sortseg'), (v) => {
    sort = v;
    renderList(true);
  });

  subscribe('tasks', onData);
  subscribe('projects', onData);
  subscribe('sessions', paintSessions);
  subscribe('bridge', paintSessions);
}

// ---------- intro ----------
function intro(first) {
  headIntro(root);
  const boxes = els.tk.classList.contains('is-empty') ? [els.start] : [els.bar, ...(view === 'board' ? Object.values(els.cols) : [els.listcard])];
  revealCards(boxes, { y: 30, stagger: 0.06, delay: 0.12, kids: false });
  if (reduced()) return;
  if (view === 'board') {
    STATUSES.forEach(([s], i) => {
      const list = els.cols[s].querySelector('[data-list]');
      const cards = listCards(list).slice(0, first ? 10 : 5);
      fadeUp(cards, { y: first ? 22 : 12, stagger: 0.05, delay: 0.36 + i * 0.07 });
      const meters = cards.map((c) => c.querySelector('.tk-meter i')).filter(Boolean);
      if (meters.length) gsap.from(meters, { scaleX: 0, duration: 0.9, ease: 'power3.out', stagger: 0.05, delay: 0.6 + i * 0.07 });
    });
  } else {
    const items = [...els.groups.querySelectorAll('.tk-group:not([hidden]) .tk-group__btn, .tk-rows:not([hidden]) .tk-row')].slice(0, 40);
    fadeUp(items, { y: 10, stagger: 0.022, delay: 0.34 });
  }
}

// ---------- page ----------
export const page = {
  title: 'Tasks',
  mount(el) {
    root = el;
    root.innerHTML = shell();
    els.head = root.querySelector('.head');
    els.sub = root.querySelector('[data-sub]');
    els.stats = [...root.querySelectorAll('.head .stat')];
    els.tk = root.querySelector('.tk');
    els.start = root.querySelector('.tk-start');
    els.bar = root.querySelector('.tk-bar');
    els.search = root.querySelector('.tk-find__input');
    els.board = root.querySelector('.tk-board');
    els.cols = Object.fromEntries([...root.querySelectorAll('.tk-col')].map((c) => [c.dataset.status, c]));
    els.listcard = root.querySelector('#tk-listcard');
    els.groups = root.querySelector('.tk-groups');
    els.listSub = root.querySelector('[data-list-sub]');
    els.listEmpty = root.querySelector('.tk-list-empty');
    syncStart();
    renderBar();
    renderBoard(false);
    renderList(false);
    els.stats[2].classList.toggle('is-alert', stats().late > 0);
    wire();
  },
  enter({ params = [], first, same }) {
    if (!same) {
      if (dirty) renderAll(false);
      intro(first);
    }
    const id = params[0];
    if (id) gsap.delayedCall(same ? 0 : 0.45, () => showTask(id));
    else if (same && document.getElementById('drawer')?.open) closeDrawer();
  },
  leave() {
    searchCall?.kill();
    if (drag?.on) dropDrag(true);
    else if (drag) cancelPress();
  },
};
