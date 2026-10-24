// Projects: a filterable card grid (#/projects) and a per-project detail view
// (#/projects/<id>). Both live in the same route view, so list <-> detail
// navigation arrives as enter({ same: true }) and is animated here.
// In live mode projects are the viewer's own (often solo); the detail view
// also searches Google Drive and the calendar for things that mention them.

import '../styles/pages/projects.css';
import { gsap, Flip, reduced, fadeUp, revealCards, countTo, flipList } from '../lib/motion.js';
import { qs, qsa, esc, icon, uid, fmtDate, fmtTime, daysBetween, dayLabel, dueLabel, relTime, addDays } from '../lib/dom.js';
import {
  state, commit, subscribe, project, member, firstName, projectTasks, projectProgress, logActivity, PROJECT_STATUS, STATUSES,
} from '../store.js';
import {
  pageHead, headIntro, card, avatar, avatarStack, projectIcon, segmented, bindSegmented, emptyState, priorityPill, presenceLabel, iconBtn,
  sourceNote,
} from '../ui/components.js';
import { newProject, newTask, newEvent, openTask, openEvent, notify, bindCardExpand, liveAction, sessionGate, openPopover, closePopover } from '../ui/overlays.js';
import { SPACES, STATUS_LABEL, projectFolder, setProjectFolder, listFolders, bridgeError } from '../live/sessions.js';
import { lineChart } from '../charts.js';
import { searchFiles } from '../live/sources.js';
import { explain } from '../live/runtime.js';
import { loadRepo, cloneIntoProject, projectForRepo } from '../live/github.js';
import { ghGate, ghA, checksDot, reviewChip, draftBadge, issueTaskBtn, addIssueTask, findIssue } from '../ui/github.js';

const DAY = 86_400_000;
const ORDER = { active: 0, review: 1, planning: 2, done: 3 };
const FILTERS = [['all', 'All'], ['active', 'Active'], ['planning', 'Planning'], ['done', 'Shipped']];
const FMT = { int: (v) => Math.round(v).toLocaleString('en-US'), pct: (v) => `${Math.round(v)}%` };
const RC = 2 * Math.PI * 27; // progress ring circumference
const canHover = matchMedia('(hover: hover) and (pointer: fine)');

// ---------- module state ----------
let root;
let mode = null; // 'list' | 'detail' | 'missing'
let curId = null;
let filter = 'all';
let seg = null;
let burn = null;
let burnN = 0;
let showDone = false;
let token = 0;
let filterToken = 0;
const sigs = new Map();
const fileCache = new Map(); // project id → { status: 'loading'|'ok'|'error', q, files, text, tone, fix }

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byKey = (scope, key) => scope.querySelector(`[data-key="${CSS.escape(key)}"]`);
const matches = (p, f) => f === 'all' || (f === 'active' ? p.status === 'active' || p.status === 'review' : p.status === f);
const sorted = () => [...state.projects].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.due - b.due);
const elapsed = (p) => (p.status === 'done' ? 1 : clamp((Date.now() - p.start) / (p.due - p.start || 1), 0, 1));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isLive = () => !state.demo;
/** Only the viewer works on it: hide people-centric bits. */
const solo = (p) => !p.members?.length || p.members.every((id) => id === state.me);
const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseDay = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 17).getTime() : NaN;
};

function rel(t) {
  const n = daysBetween(new Date(), t);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

function resolve(params) {
  const id = params?.[0];
  if (!id) return { mode: 'list', id: null };
  return project(id) ? { mode: 'detail', id } : { mode: 'missing', id };
}

const inView = (el) => {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
};

// Header with our own stat tiles (supports text values and smooth re-counts).
function statsHtml(list) {
  return `<dl class="head__stats">${list
    .map((s) => `<div class="stat" data-stat="${s.key}"><dt>${esc(s.label)}</dt><dd>${
      s.text != null ? `<b>${esc(s.text)}</b>` : `<b data-n="${s.value}" data-f="${s.fmt || 'int'}">0</b>`
    }</dd></div>`)
    .join('')}</dl>`;
}
const head = (opts, stats) => pageHead(opts).trim().replace(/<\/header>$/, `${stats.length ? statsHtml(stats) : ''}</header>`);
const countAll = (scope) => qsa('[data-n]', scope).forEach((el) => countTo(el, +el.dataset.n, FMT[el.dataset.f] || FMT.int));

function updateStats(list) {
  list.forEach((s) => {
    const tile = qs(`[data-stat="${s.key}"]`, root);
    if (!tile) return;
    const b = qs('b', tile);
    tile.querySelector('dt').textContent = s.label;
    let changed = false;
    if (s.text != null) {
      changed = b.textContent !== s.text;
      delete b.dataset.n;
      b.textContent = s.text;
    } else {
      changed = b.dataset.n !== String(s.value);
      b.dataset.n = s.value;
      b.dataset.f = s.fmt || 'int';
      countTo(b, s.value, FMT[b.dataset.f]);
    }
    if (changed) flash(tile);
  });
}

function flash(el) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  if (!reduced()) gsap.fromTo(el, { y: -4, scale: 1.06 }, { y: 0, scale: 1, duration: 0.6, ease: 'back.out(2.4)', clearProps: 'transform' });
}

// ---------- shared bits ----------
const statusPill = (s) => `<span class="pstatus pstatus--${s}">${s === 'done' ? icon('check') : '<i></i>'}${PROJECT_STATUS[s]}</span>`;

const starLabel = (p) => (p.starred ? `Unpin ${p.name} from the sidebar` : `Pin ${p.name} to the sidebar`);
const starBtn = (p) =>
  `<button type="button" class="ibtn ibtn--sm pstar" data-star="${p.id}" aria-pressed="${p.starred}" aria-label="${esc(starLabel(p))}" title="${p.starred ? 'Pinned' : 'Pin to sidebar'}">${icon('star')}</button>`;
const pinBtn = (p) =>
  `<button type="button" class="btn btn--glass pstar pstar--btn" data-star="${p.id}" aria-pressed="${p.starred}" aria-label="${esc(starLabel(p))}">${icon('star')}<span>${p.starred ? 'Pinned' : 'Pin'}</span></button>`;

function refreshStars() {
  qsa('[data-star]', root).forEach((b) => {
    const p = project(b.dataset.star);
    if (!p) return;
    b.setAttribute('aria-pressed', p.starred);
    b.setAttribute('aria-label', starLabel(p));
    if (b.classList.contains('pstar--btn')) b.querySelector('span').textContent = p.starred ? 'Pinned' : 'Pin';
    else b.title = p.starred ? 'Pinned' : 'Pin to sidebar';
  });
}

function animateStar(btn, on) {
  const svg = btn?.querySelector('svg');
  if (!svg || reduced()) return;
  if (on) gsap.fromTo(svg, { scale: 0.4, rotate: -72 }, { scale: 1, rotate: 0, duration: 0.7, ease: 'back.out(2.6)', clearProps: 'transform' });
  else gsap.fromTo(svg, { scale: 0.8 }, { scale: 1, duration: 0.4, ease: 'back.out(3)', clearProps: 'transform' });
}

// ---------- progress ring ----------
function ring(v) {
  const pct = Math.round(v * 100);
  return `<div class="pring" data-v="${v}" role="img" aria-label="${pct}% of tasks done"><svg viewBox="0 0 64 64" aria-hidden="true">
    <circle class="pring__track" cx="32" cy="32" r="27"/><circle class="pring__arc" cx="32" cy="32" r="27" stroke-dasharray="${RC * v} ${RC}"/></svg><b aria-hidden="true">${pct}%</b></div>`;
}

function playRing(el, from = 0, delay = 0) {
  if (!el || reduced()) return;
  const v = +el.dataset.v;
  const arc = qs('.pring__arc', el);
  const label = qs('b', el);
  const o = { v: from };
  const paint = () => {
    arc.setAttribute('stroke-dasharray', `${RC * o.v} ${RC}`);
    label.textContent = `${Math.round(o.v * 100)}%`;
  };
  paint();
  gsap.to(o, { v, duration: 1.2, ease: 'power3.inOut', delay, onUpdate: paint });
}

// ---------- list ----------
function nextInfo(p) {
  if (p.status === 'done') return ['Shipped', 'Every milestone met', fmtDate(p.due)];
  if (!p.milestones.length) return ['Next milestone', 'None planned yet', `Due ${fmtDate(p.due)}`];
  const n = [...p.milestones].filter((m) => !m.done).sort((a, b) => a.due - b.due)[0];
  if (!n) return ['Milestones', 'All reached', `Due ${fmtDate(p.due)}`];
  return ['Next milestone', n.title, `${fmtDate(n.due)} · ${rel(n.due)}`];
}

function taskCounts(p) {
  const ts = projectTasks(p.id);
  return [ts.filter((t) => t.status === 'done').length, ts.length];
}

const sig = (p) => JSON.stringify([p.name, p.status, p.summary, p.due, p.members, p.hue, p.icon, taskCounts(p), nextInfo(p)]);

function cardHtml(p) {
  const [done, total] = taskCounts(p);
  const late = p.status !== 'done' && p.due < Date.now();
  const [kicker, title, meta] = nextInfo(p);
  return `<div class="pcard__top">${projectIcon(p.id, 'lg')}
      <div class="pcard__id"><h3 class="pcard__name"><a class="pcard__link" href="#/projects/${p.id}">${esc(p.name)}</a></h3>${statusPill(p.status)}</div>
      ${starBtn(p)}</div>
    <p class="pcard__sum">${esc(p.summary || 'No summary yet.')}</p>
    <div class="pcard__mid">${ring(projectProgress(p.id))}
      <div class="pcard__next"><small>${kicker}</small><b>${esc(title)}</b><span>${esc(meta)}</span></div></div>
    <footer class="pcard__foot">${solo(p) ? '' : avatarStack(p.members, 'sm', 4)}
      <span class="pcard__count">${done}/${total} tasks</span>
      <span class="pcard__due ${late ? 'is-late' : ''}" title="${late ? 'Past due' : 'Due date'}">${icon('calendar')}${fmtDate(p.due)}</span></footer>`;
}

function listStats() {
  const ps = state.projects;
  const live = ps.filter((p) => p.status === 'active' || p.status === 'review');
  const now = new Date();
  const month = ps.filter((p) => {
    const d = new Date(p.due);
    return p.status !== 'done' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const track = live.length ? (live.filter((p) => projectProgress(p.id) >= elapsed(p)).length / live.length) * 100 : 0;
  return [
    { key: 'active', label: 'Active', value: live.length },
    { key: 'shipped', label: 'Shipped', value: ps.filter((p) => p.status === 'done').length },
    { key: 'track', label: 'On track', value: Math.round(track), fmt: 'pct' },
    { key: 'month', label: 'Due this month', value: month },
  ];
}

const listSub = () => {
  if (!state.projects.length) return 'Nothing here yet';
  const shipped = state.projects.filter((p) => p.status === 'done').length;
  return `${state.projects.length - shipped} in flight · ${shipped} shipped`;
};

function startHtml() {
  const tips = [
    ['flag', 'Plan milestones and watch the timeline fill in'],
    ['tasks', 'Group your tasks and track them on the board'],
    ['calendar', isLive() ? 'See the meetings and Drive files that mention it' : 'Keep its meetings in one place'],
  ];
  return `<section class="pstart glass" aria-labelledby="pstart-title">
    <span class="pstart__art" aria-hidden="true">${icon('folder')}<i>${icon('plus')}</i></span>
    <h2 class="pstart__title" id="pstart-title">Create your first project</h2>
    <p class="pstart__text">A project is a home for one goal: its tasks, milestones and everything related.</p>
    <div class="pstart__acts">
      <button type="button" class="btn btn--accent" data-act="new">${icon('plus')}Create your first project</button>
      <button type="button" class="btn btn--glass" data-act="gh-new" aria-haspopup="dialog" aria-expanded="false">${icon('code')}New project from GitHub</button>
    </div>
    <ul class="pstart__tips">${tips.map(([ico, text]) => `<li>${icon(ico)}<span>${esc(text)}</span></li>`).join('')}</ul>
  </section>`;
}

function newCard(p) {
  const el = document.createElement('article');
  el.className = `pcard glass hue--${p.hue}`;
  el.dataset.key = p.id;
  el.innerHTML = cardHtml(p);
  bindLift(el);
  return el;
}

function listHtml() {
  const none = !state.projects.length;
  return head(
    {
      title: 'Projects',
      sub: `<span data-sub>${esc(listSub())}</span>`,
      actions: `${none ? '' : segmented('Show', FILTERS, filter, 'pfilter')}<button type="button" class="btn btn--glass" data-act="gh-new" aria-haspopup="dialog" aria-expanded="false">${icon('code')}From GitHub</button><button type="button" class="btn btn--accent" data-act="new">${icon('plus')}New project</button>`,
    },
    none ? [] : listStats(),
  ) + (none
    ? startHtml()
    : `<div class="pgrid"></div><div class="pgrid-empty" hidden>${emptyState('Nothing here yet', 'No projects match this filter.', 'folder')}</div>`);
}

function mountList() {
  const grid = qs('.pgrid', root);
  if (!grid) return;
  sigs.clear();
  sorted().forEach((p) => {
    const el = newCard(p);
    el.hidden = !matches(p, filter);
    grid.append(el);
    sigs.set(p.id, sig(p));
  });
  syncEmpty();
  seg = bindSegmented(qs('.pfilter', root), applyFilter);
}

function syncEmpty() {
  const empty = qs('.pgrid-empty', root);
  if (empty) empty.hidden = qsa('.pcard', root).some((c) => !c.hidden);
}

function bindLift(el) {
  el.addEventListener('pointerenter', () => {
    if (!canHover.matches || reduced()) return;
    el.classList.add('is-lift');
    gsap.to(el, { y: -4, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
  });
  el.addEventListener('pointerleave', () => {
    el.classList.remove('is-lift');
    if (reduced()) return;
    gsap.to(el, { y: 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto', clearProps: 'transform' });
  });
}

function applyFilter(v) {
  filter = v;
  const t = ++filterToken;
  const grid = qs('.pgrid', root);
  const cards = qsa('.pcard', grid);
  const want = (c) => matches(project(c.dataset.key), v);
  const leaving = cards.filter((c) => !c.hidden && !want(c));
  const entering = cards.filter((c) => c.hidden && want(c));
  const staying = cards.filter((c) => !c.hidden && want(c));

  if (reduced()) {
    cards.forEach((c) => (c.hidden = !want(c)));
    return syncEmpty();
  }

  const go = () => {
    if (t !== filterToken) return;
    const flip = Flip.getState(staying);
    cards.forEach((c) => (c.hidden = !want(c)));
    gsap.set(leaving, { clearProps: 'clipPath,opacity,transform' });
    syncEmpty();
    Flip.from(flip, { duration: 0.65, ease: 'power3.inOut', targets: staying });
    revealCards(entering, { y: 18, stagger: 0.05, delay: 0.1 });
    entering.forEach((c, i) => playRing(qs('.pring', c), 0, 0.25 + i * 0.06));
  };

  if (!leaving.length) return go();
  gsap.fromTo(
    leaving,
    { clipPath: 'inset(0% 0% 0% 0% round 30px)' },
    { clipPath: 'inset(12% 12% 12% 12% round 30px)', opacity: 0, scale: 0.97, duration: 0.2, ease: 'power2.in', onComplete: go },
  );
}

// Live reconcile of the grid after a store change.
function syncList() {
  // First project created, or the last one removed: swap the whole layout.
  if (!!qs('.pstart', root) !== !state.projects.length) return show({ mode: 'list', id: null }, 0, false);
  const grid = qs('.pgrid', root);
  if (!grid) return;
  const ps = sorted();
  const ids = new Set(ps.map((p) => p.id));

  // A new project that the current filter would hide resets the filter.
  if (ps.some((p) => !byKey(grid, p.id) && !matches(p, filter)) && filter !== 'all') {
    filter = 'all';
    seg?.select('all', { silent: true });
    qsa('.pcard', grid).forEach((c) => (c.hidden = false));
  }

  const changed = [];
  flipList(grid, () => {
    qsa('.pcard', grid).forEach((c) => {
      if (!ids.has(c.dataset.key)) {
        sigs.delete(c.dataset.key);
        c.remove();
      }
    });
    ps.forEach((p) => {
      let c = byKey(grid, p.id);
      const s = sig(p);
      if (!c) c = newCard(p);
      else if (sigs.get(p.id) !== s) {
        const old = +(qs('.pring', c)?.dataset.v ?? 0);
        c.className = `pcard glass hue--${p.hue}${c.classList.contains('is-lift') ? ' is-lift' : ''}`;
        c.innerHTML = cardHtml(p);
        changed.push([c, old]);
      }
      sigs.set(p.id, s);
      c.hidden = !matches(p, filter);
      grid.append(c);
    });
  });
  changed.forEach(([c, old]) => playRing(qs('.pring', c), old));
  refreshStars();
  syncEmpty();
  const sub = qs('[data-sub]', root);
  if (sub) sub.textContent = listSub();
  updateStats(listStats());
}

// ---------- detail ----------
function detailStats(p) {
  const ts = projectTasks(p.id);
  const done = ts.filter((t) => t.status === 'done').length;
  const left = daysBetween(new Date(), p.due);
  return [
    { key: 'progress', label: 'Progress', value: Math.round(projectProgress(p.id) * 100), fmt: 'pct' },
    { key: 'open', label: 'Open tasks', value: ts.length - done },
    { key: 'done', label: 'Done', value: done },
    p.status === 'done'
      ? { key: 'days', label: 'Status', text: 'Shipped' }
      : { key: 'days', label: left >= 0 ? 'Days left' : 'Days over', value: Math.abs(left) },
  ];
}

function overviewHtml(p) {
  const e = elapsed(p);
  const span = p.due - p.start || 1;
  const pos = (t) => clamp((t - p.start) / span, 0, 1) * 100;
  const lead = member(p.lead);
  const started = p.start <= Date.now();
  const reached = p.milestones.filter((m) => m.done).length;
  const nowCls = e < 0.1 ? 'is-start' : e > 0.9 ? 'is-end' : '';
  const alone = solo(p);
  return `<dl class="ov__facts">
      ${alone
        ? `<div><dt>${started ? 'Started' : 'Starts'}</dt><dd>${fmtDate(p.start)}</dd></div>`
        : `<div><dt>Lead</dt><dd>${lead ? `<a class="ov__lead" href="#/team/${encodeURIComponent(lead.id)}">${avatar(lead.id, 'xs')}<span>${esc(lead.name)}</span></a>` : '—'}</dd></div>`}
      <div><dt>Status</dt><dd>${statusPill(p.status)}</dd></div>
      <div><dt>Due</dt><dd>${fmtDate(p.due)}</dd></div>
    </dl>
    <div class="tline" role="img" aria-label="${Math.round(e * 100)}% of the planned time used, ${reached} of ${p.milestones.length} milestones reached">
      <div class="tline__track"><i class="tline__fill" style="width:${e * 100}%"></i>
        ${p.milestones.map((m) => `<span class="tline__ms ${m.done ? 'is-done' : ''}" style="left:${pos(m.due)}%" title="${esc(m.title)} · ${fmtDate(m.due)}"></span>`).join('')}
        ${p.status !== 'done' && started ? `<span class="tline__now ${nowCls}" style="left:${e * 100}%"><em>Today</em></span>` : ''}
      </div>
      <div class="tline__ends"><span>${started ? 'Started' : 'Starts'} ${fmtDate(p.start)}</span><span>${p.status === 'done' ? 'Shipped' : 'Due'} ${fmtDate(p.due)}</span></div>
    </div>
    ${alone ? '' : `<h3 class="pd-h">People <span class="badge">${p.members.length}</span></h3>
    <ul class="ov__people">${p.members
      .map((id) => {
        const m = member(id);
        if (!m) return '';
        return `<li><a href="#/team/${encodeURIComponent(id)}">${avatar(id, 'md', { presence: true })}<span><b>${esc(m.name || 'You')}</b><small>${id === p.lead ? 'Lead · ' : ''}${esc(presenceLabel(m) || '')}</small></span></a></li>`;
      })
      .join('')}</ul>`}`;
}

const msSub = (p) => (p.milestones.length ? `${p.milestones.filter((m) => m.done).length} of ${p.milestones.length} reached` : 'None yet');

function msFormHtml(p) {
  const last = Math.max(Date.now(), ...p.milestones.map((m) => m.due));
  const def = Math.min(addDays(new Date(last), 7).getTime(), Math.max(p.due, Date.now() + 7 * DAY));
  return `<form class="ms-add" data-ms-form novalidate>
    <label class="sr" for="ms-title">Milestone title</label>
    <input class="input ms-add__title" id="ms-title" name="msTitle" placeholder="Add a milestone" autocomplete="off" maxlength="120">
    <label class="sr" for="ms-due">Milestone date</label>
    <input class="input ms-add__due" id="ms-due" name="msDue" type="date" value="${isoDay(def)}" required>
    <button type="submit" class="btn btn--glass btn--sm">${icon('plus')}Add</button>
    <p class="ms-add__err" role="alert"></p>
  </form>`;
}

function msHtml(p) {
  if (!p.milestones.length) return emptyState('No milestones yet', 'Add the first one below and it lands on the timeline.', 'flag') + msFormHtml(p);
  const ms = [...p.milestones].sort((a, b) => a.due - b.due);
  const next = ms.find((m) => !m.done);
  return `<ol class="ms">${ms
    .map((m) => {
      const late = !m.done && m.due < Date.now();
      return `<li class="ms__item ${m.done ? 'is-done' : ''} ${m === next ? 'is-next' : ''}" data-key="${m.id}">
        <button type="button" class="ms__check" data-ms="${m.id}" aria-pressed="${m.done}" aria-label="${m.done ? 'Reopen' : 'Complete'} milestone: ${esc(m.title)}">${icon('check')}</button>
        <div class="ms__body"><b>${esc(m.title)}</b><small class="${late ? 'is-late' : ''}">${fmtDate(m.due)} · ${m.done ? 'Done' : rel(m.due)}</small></div>
        ${m === next ? '<span class="ms__tag">Next</span>' : ''}
        ${iconBtn('trash', `Delete milestone: ${m.title}`, `data-ms-del="${m.id}"`, 'ibtn--sm ms__del')}</li>`;
    })
    .join('')}</ol>${msFormHtml(p)}`;
}

/** Re-render the milestones card without losing a half-typed entry or focus. */
function paintMs(p) {
  const body = qs('#p-ms .card__body', root) || document.querySelector('#p-ms .card__body');
  if (!body) return;
  const form = qs('[data-ms-form]', body);
  const keep = form && {
    title: form.elements.msTitle.value,
    due: form.elements.msDue.value,
    focus: form.contains(document.activeElement) ? document.activeElement.name : null,
  };
  flipList(body, () => (body.innerHTML = msHtml(p)));
  const next = qs('[data-ms-form]', body);
  if (!keep || !next) return;
  next.elements.msTitle.value = keep.title;
  if (keep.due) next.elements.msDue.value = keep.due;
  if (keep.focus) next.elements[keep.focus]?.focus({ preventScroll: true });
}

/** Events linked to the project, or whose title or description mention its name. */
function projectEvents(p) {
  const q = p.name.trim().toLowerCase();
  const text = (s) => String(s || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  return state.events.filter((e) => e.projectId === p.id || (q.length >= 2 && (text(e.title).includes(q) || text(e.description).includes(q))));
}

const upSub = () => (isLive() ? 'Calendar events that mention this project' : 'What is scheduled, and what happened');

function evRow(e, past = false) {
  const d = new Date(e.start);
  const place = !e.place ? '' : e.place === 'video' ? ' · Video call' : ` · ${esc(e.place)}`;
  const others = (e.attendees || []).filter((id) => id !== state.me);
  return `<button type="button" class="pev ${past ? 'is-past' : ''}" data-event="${esc(e.id)}">
    <span class="pev__date" aria-hidden="true"><small>${d.toLocaleDateString('en-US', { month: 'short' })}</small><b>${d.getDate()}</b></span>
    <span class="pev__body"><b>${esc(e.title)}</b><small>${esc(dayLabel(e.start))}${e.allDay ? '' : ` · ${fmtTime(e.start)}`}${place}</small></span>
    ${others.length ? avatarStack(e.attendees, 'xs', 3) : ''}</button>`;
}

function upHtml(p) {
  const now = Date.now();
  const evs = projectEvents(p);
  const next = evs.filter((e) => e.end >= now).sort((a, b) => a.start - b.start).slice(0, 4);
  const earlier = evs.filter((e) => e.end < now).sort((a, b) => b.start - a.start).slice(0, 3);
  const acts = state.activity.filter((a) => a.projectId === p.id).slice(0, 4);
  const note = isLive() ? sourceNote('calendar') : '';
  const quiet = isLive() ? `No upcoming events mention “${esc(p.name)}”.` : 'Nothing on the calendar.';
  return `${note}${next.length ? `<div class="pev-list">${next.map((e) => evRow(e)).join('')}</div>` : `<p class="pd-quiet">${quiet}</p>`}
    ${earlier.length ? `<h3 class="pd-h">Earlier</h3><div class="pev-list">${earlier.map((e) => evRow(e, true)).join('')}</div>` : ''}
    <h3 class="pd-h">Recent activity</h3>
    ${acts.length
      ? `<ul class="feed">${acts.map((a) => `<li>${avatar(a.who, 'sm')}<p><b>${esc(firstName(a.who))}</b> ${esc(a.text)}<small>${relTime(a.at)}</small></p></li>`).join('')}</ul>`
      : '<p class="pd-quiet">Quiet so far.</p>'}`;
}

const taskSub = (p) => {
  const [done, total] = taskCounts(p);
  return `${total - done} open · ${done} done`;
};

function rowHtml(t, alone = false) {
  const done = t.status === 'done';
  const late = !done && t.due < new Date().setHours(0, 0, 0, 0);
  const prio = !done && (t.priority === 'high' || t.priority === 'urgent') ? priorityPill(t.priority) : '<span class="prow__nop"></span>';
  return `<li data-key="${t.id}"><button type="button" class="prow ${done ? 'is-done' : ''}" data-task="${t.id}">
    <span class="prow__title">${esc(t.title)}</span>${prio}
    <span class="prow__due ${late ? 'is-late' : ''}">${done ? fmtDate(t.doneAt) : esc(dueLabel(t.due))}</span>${alone ? '' : avatar(t.assignee, 'xs')}</button></li>`;
}

function tasksHtml(p) {
  const ts = projectTasks(p.id);
  if (!ts.length) return emptyState('No tasks yet', 'Add the first task to get this project moving.', 'tasks');
  const alone = solo(p) && ts.every((t) => t.assignee === state.me);
  return `<div class="ptasks ${alone ? 'is-solo' : ''}">${STATUSES.map(([k, label]) => {
    const list = ts.filter((t) => t.status === k).sort(k === 'done' ? (a, b) => b.doneAt - a.doneAt : (a, b) => a.due - b.due);
    const fold = k === 'done' && list.length
      ? `<button type="button" class="btn btn--ghost btn--sm pgroup__fold" data-fold aria-expanded="${showDone}" aria-controls="pdone">${showDone ? 'Hide' : 'Show'}</button>`
      : '';
    const body = list.length
      ? `<ul class="pgroup__list" ${k === 'done' ? `id="pdone" ${showDone ? '' : 'hidden'}` : ''}>${list.map((t) => rowHtml(t, alone)).join('')}</ul>`
      : `<p class="pgroup__empty">${k === 'todo' ? 'Nothing waiting.' : 'Nothing here.'}</p>`;
    return `<section class="pgroup" aria-label="${label}"><header class="pgroup__head"><i class="sdot sdot--${k}"></i><h3>${label}</h3><span class="badge">${list.length}</span>${fold}</header>${body}</section>`;
  }).join('')}</div>`;
}

function burnData(p) {
  const ts = projectTasks(p.id);
  if (!ts.length) return null;
  const a = Math.min(p.start, ...ts.map((t) => t.created));
  const b = p.status === 'done' ? Math.max(p.due, ...ts.map((t) => t.doneAt || 0)) : Date.now();
  if (b - a < 2 * DAY) return null;
  const N = 13;
  const pts = Array.from({ length: N }, (_, i) => a + ((b - a) * i) / (N - 1));
  return {
    labels: pts.map((t) => fmtDate(t)),
    series: [
      { name: 'Done', tone: p.hue, values: pts.map((t) => ts.filter((x) => x.doneAt && x.doneAt <= t).length) },
      { name: 'Total', tone: 'muted', values: pts.map((t) => ts.filter((x) => x.created <= t || (x.doneAt && x.doneAt <= t)).length) },
    ],
  };
}

function mountBurn(p) {
  const cardEl = qs('#p-burn', root) || document.getElementById('p-burn');
  const host = cardEl && qs('.burn__chart', cardEl);
  if (!host) return;
  // The burn-up only means something once the project has tasks.
  const none = !projectTasks(p.id).length;
  cardEl.hidden = none;
  if (none) {
    burn = null;
    host.innerHTML = '';
    return;
  }
  const data = burnData(p);
  if (!data) {
    burn = null;
    host.classList.add('is-empty');
    host.innerHTML = emptyState('Nothing to chart yet', 'The burn-up appears once tasks start landing.', 'chart');
    return;
  }
  host.classList.remove('is-empty');
  burnN = data.labels.length;
  if (burn) burn.update(data.series, data.labels);
  else {
    host.innerHTML = '';
    burn = lineChart(host, { ...data, height: 240, fmt: (v) => FMT.int(v) });
    chartKeys(host, () => burnN);
  }
}

// Arrow keys step through the chart's points by replaying its pointer handler.
function chartKeys(host, count) {
  host.tabIndex = 0;
  host.setAttribute('aria-label', 'Burn-up chart. Use the left and right arrow keys to read each point.');
  let i = -1;
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const svg = qs('svg', host);
    const n = count();
    if (!svg || !n) return;
    e.preventDefault();
    i = i < 0 ? n - 1 : clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
    const r = svg.getBoundingClientRect();
    const w = svg.viewBox.baseVal.width || r.width;
    const x = 34 + (i * (w - 42)) / Math.max(1, n - 1);
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (x / w) * r.width, clientY: r.top + 10 }));
  });
  host.addEventListener('blur', () => {
    i = -1;
    qs('svg', host)?.dispatchEvent(new PointerEvent('pointerleave'));
  });
}

// ---------- Drive files (live) ----------
const FILE_ICON = { doc: 'edit', sheet: 'grid', slides: 'layers', pdf: 'list', folder: 'folder', image: 'eye', video: 'video', file: 'link' };
const FILE_KIND = { doc: 'Doc', sheet: 'Sheet', slides: 'Slides', pdf: 'PDF', folder: 'Folder', image: 'Image', video: 'Video', file: 'File' };
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '');

function fileFix(fix) {
  if (fix === 'allow') return '<button type="button" class="btn btn--sm btn--glass" data-allow="Google Drive">Allow</button>';
  if (fix === 'reconnect' || fix === 'add' || fix === 'choose') return '<button type="button" class="btn btn--sm btn--glass" data-permissions>Open permissions</button>';
  return '';
}

function filesHtml(p) {
  const c = fileCache.get(p.id);
  if (!c || (c.status === 'loading' && !c.files.length)) {
    return `<ul class="pfiles" aria-busy="true" aria-label="Searching Google Drive">${[78, 62, 70]
      .map((w) => `<li class="pfile pfile--skel" aria-hidden="true"><span class="skel pfile__ic"></span><span class="pfile__body"><span class="skel" style="height:13px;width:${w}%"></span><span class="skel" style="height:11px;width:${w - 30}%"></span></span></li>`)
      .join('')}</ul>`;
  }
  if (c.status === 'error') return `<div class="src-note src-note--${c.tone || 'warn'}" role="status">${icon('bolt')}<span>${esc(c.text)}</span>${fileFix(c.fix)}</div>`;
  if (!c.files.length) return emptyState('No files found', `Nothing in your Drive mentions “${p.name}”.`, 'layers');
  return `<ul class="pfiles" ${c.status === 'loading' ? 'aria-busy="true"' : ''}>${c.files
    .map((f) => {
      const url = safeUrl(f.url);
      const inner = `<span class="pfile__ic pfile__ic--${f.kind}" aria-hidden="true">${icon(FILE_ICON[f.kind] || 'link')}</span>
        <span class="pfile__body"><b>${esc(f.title)}</b><small>${FILE_KIND[f.kind] || 'File'}${f.modified ? ` · Edited ${esc(relTime(f.modified))}` : ''}</small></span>`;
      return `<li>${url
        ? `<a class="pfile" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}${icon('arrowRight', 'pfile__go')}<span class="sr">(opens in a new tab)</span></a>`
        : `<div class="pfile">${inner}</div>`}</li>`;
    })
    .join('')}</ul>`;
}

const filesBtnInner = (loading) => `${icon('search')}<span>${loading ? 'Searching…' : 'Search Drive'}</span>`;
const filesBtn = (loading) =>
  `<button type="button" class="btn btn--ghost btn--sm pfiles__btn" data-act="files" aria-busy="${!!loading}">${filesBtnInner(loading)}</button>`;

function paintFiles(id) {
  if (mode !== 'detail' || curId !== id) return;
  const p = project(id);
  const cardEl = qs('#p-files', root) || document.getElementById('p-files');
  if (!p || !cardEl) return;
  const loading = fileCache.get(id)?.status === 'loading';
  // Update the button in place so keyboard focus stays on it.
  const btn = qs('[data-act="files"]', cardEl);
  if (btn) {
    btn.innerHTML = filesBtnInner(loading);
    btn.setAttribute('aria-busy', loading);
  }
  const body = qs('.card__body', cardEl);
  body.innerHTML = filesHtml(p);
  if (!loading) fadeUp(qsa('.pfile', body), { y: 8, stagger: 0.03 });
}

/** Search Drive for the project's name; one cached result per project. */
function loadFiles(p, { force = false } = {}) {
  if (!isLive() || !p) return;
  const c = fileCache.get(p.id);
  if (c?.status === 'loading') return;
  if (c && !force && c.q === p.name) return paintFiles(p.id);
  const q = p.name;
  const id = p.id;
  fileCache.set(id, { status: 'loading', q, files: c?.q === q ? c.files : [] });
  paintFiles(id);
  searchFiles(q, 8)
    .then(
      (files) => fileCache.set(id, { status: 'ok', q, files: files || [] }),
      (err) => {
        const e = explain(err, 'Google Drive');
        fileCache.set(id, { status: 'error', q, files: [], text: e.text, tone: e.tone, fix: e.fix });
      },
    )
    .then(() => paintFiles(id))
    .catch(() => {});
}

// ---------- Workspace: folder, memory, Claude sessions ----------
const folderCache = new Map(); // space → string[] | Promise
const spaceName = (id) => SPACES.find(([s]) => s === id)?.[1] || id;

function wsFolderHtml(p) {
  const f = projectFolder(p);
  const gate = sessionGate();
  if (gate) {
    return `<dl class="ws-where"><div><dt>Space</dt><dd>${f ? esc(spaceName(f.space)) : '—'}</dd></div><div><dt>Folder</dt><dd>${f ? esc(f.folder) : 'Not chosen yet'}</dd></div></dl>
      <p class="src-note" role="status">${icon('bolt')}<span>${esc(gate)}</span></p>`;
  }
  const space = f?.space || 'perso';
  return `<form class="ws-folder" data-ws-folder novalidate>
    <label class="field"><span class="field__label">Space</span><select name="space">${SPACES.map(([s, l]) => `<option value="${s}" ${s === space ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="field"><span class="field__label">Folder</span><input name="folder" value="${esc(f?.folder || p.name)}" maxlength="60" autocomplete="off" spellcheck="false"></label>
    <label class="field ws-folder__pick"><span class="field__label">Pick existing</span><select name="existing" data-ws-existing><option value="">${Array.isArray(folderCache.get(space)) ? 'Choose a folder…' : 'Load folders…'}</option></select></label>
    <button type="submit" class="btn btn--glass btn--sm ws-folder__save">${icon('check')}Save</button>
    <p class="field__hint ws-folder__hint">${f ? `Sessions run in ${esc(spaceName(f.space))} / ${esc(f.folder)}.` : 'No folder yet: the first session asks for one.'} Created if missing.</p>
  </form>`;
}

function wsMemHtml(p) {
  const mem = p.memory || [];
  if (!mem.length) return '<p class="pd-quiet">Nothing yet. Sessions add what they learn about the project here.</p>';
  return `<ul class="ws-mem">${mem
    .map((m, i) => `<li><span>${esc(m)}</span>${iconBtn('trash', `Forget: ${m.slice(0, 80)}`, `data-mem-del="${i}"`, 'ibtn--sm ws-mem__del')}</li>`)
    .join('')}</ul>`;
}

function wsRunsHtml(p) {
  const ids = new Set(state.tasks.filter((t) => t.projectId === p.id).map((t) => t.id));
  const runs = (state.sessions || []).filter((r) => ids.has(r.task_id)).sort((a, b) => b.updated - a.updated).slice(0, 8);
  if (!runs.length) return '<p class="pd-quiet">No sessions yet. Use “Launch a session” on one of the project’s tasks.</p>';
  return `<ul class="ws-runs">${runs
    .map((r) => {
      const t = state.tasks.find((x) => x.id === r.task_id);
      const text = r.status === 'waiting' ? r.question : r.status === 'error' ? r.error : ['queued', 'running'].includes(r.status) ? r.live : r.summary;
      return `<li><button type="button" class="ws-run ses--${r.status}" data-task="${esc(r.task_id)}">
        <span class="ses__dot" aria-hidden="true"></span>
        <span class="ws-run__body"><b>${esc(t?.title || r.task_title || 'Task')}</b>
          <small>${esc(STATUS_LABEL[r.status] || r.status)} · ${esc(relTime(r.updated))}</small>
          ${text ? `<span class="ws-run__text">${esc(text)}</span>` : ''}</span></button></li>`;
    })
    .join('')}</ul>`;
}

const wsSub = (p) => {
  const f = projectFolder(p);
  return f ? `${spaceName(f.space)} / ${f.folder}` : 'Where Claude works, and what it remembers';
};

function wsHtml(p) {
  return `<div data-ws-slot="folder">${wsFolderHtml(p)}</div>
    <h3 class="pd-h">GitHub</h3>
    <div data-ws-slot="gh">${wsGhHtml(p)}</div>
    <h3 class="pd-h">Memory <span class="badge" data-ws-memn>${(p.memory || []).length}</span></h3>
    <div data-ws-slot="mem">${wsMemHtml(p)}</div>
    <form class="ws-mem-add" data-mem-form novalidate>
      <label class="sr" for="ws-mem-input">Add a memory line</label>
      <input class="input" id="ws-mem-input" name="mem" placeholder="Something Claude should always know" maxlength="240" autocomplete="off">
      <button type="submit" class="btn btn--glass btn--sm">${icon('plus')}Add</button>
    </form>
    <h3 class="pd-h">Claude sessions</h3>
    <div data-ws-slot="runs">${wsRunsHtml(p)}</div>`;
}

/** Repaint parts of the Workspace card, keeping a half-edited folder form. */
function paintWs(p, parts = ['folder', 'gh', 'mem', 'runs']) {
  const cardEl = qs('#p-ws', root) || document.getElementById('p-ws');
  if (!cardEl) return;
  setSub('#p-ws', wsSub(p));
  const slot = (k) => qs(`[data-ws-slot="${k}"]`, cardEl);
  if (parts.includes('folder') && slot('folder')) {
    const form = qs('[data-ws-folder]', cardEl);
    const keep = form?.contains(document.activeElement) && { space: form.space.value, folder: form.folder.value, focus: document.activeElement.name };
    slot('folder').innerHTML = wsFolderHtml(p);
    const next = qs('[data-ws-folder]', cardEl);
    if (keep && next) {
      next.space.value = keep.space;
      next.folder.value = keep.folder;
      next.elements[keep.focus]?.focus({ preventScroll: true });
    }
  }
  if (parts.includes('mem') && slot('mem')) {
    slot('mem').innerHTML = wsMemHtml(p);
    const n = qs('[data-ws-memn]', cardEl);
    if (n) n.textContent = (p.memory || []).length;
  }
  if (parts.includes('runs') && slot('runs')) slot('runs').innerHTML = wsRunsHtml(p);
  if (parts.includes('gh') && slot('gh')) paintGh(p, slot('gh'));
}

/** Fill "Pick existing" from the bridge, once per space. */
function loadExisting(select) {
  const form = select.form;
  const space = form.space.value;
  const fill = (names) => {
    if (!select.isConnected || form.space.value !== space) return;
    const cur = form.folder.value.trim();
    select.innerHTML = `<option value="">${names.length ? 'Choose a folder…' : 'No folders in this space yet'}</option>${names
      .map((n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`)
      .join('')}`;
  };
  const c = folderCache.get(space);
  if (Array.isArray(c)) {
    if (select.options.length <= 1) fill(c);
    return;
  }
  if (c) return;
  select.firstElementChild.textContent = 'Loading…';
  const job = listFolders(space)
    .then((names) => {
      folderCache.set(space, names);
      fill(names);
    })
    .catch((err) => {
      folderCache.delete(space);
      if (select.isConnected) select.firstElementChild.textContent = 'Couldn’t load folders';
      notify(bridgeError(err), { ico: 'x', tone: 'warn', hold: 5 });
    });
  folderCache.set(space, job);
}

async function saveFolder(form) {
  const p = project(curId);
  if (!p) return;
  const space = form.space.value;
  const folder = form.folder.value.trim();
  if (!folder) {
    form.folder.focus();
    return notify('Give the folder a name', { ico: 'folder', tone: 'warn' });
  }
  const btn = qs('.ws-folder__save', form);
  if (btn) btn.disabled = true;
  const res = await liveAction(() => setProjectFolder(p, space, folder), { server: 'Lumen bridge', busy: 'Preparing the folder…', ico: 'folder' });
  if (btn?.isConnected) btn.disabled = false;
  if (!res) return;
  folderCache.delete(space);
  notify(res.created ? `Created ${spaceName(space)} / ${p.folder}` : `${p.name} now works in ${spaceName(space)} / ${p.folder}`, { ico: 'folder' });
}

function addMemory(form) {
  const p = project(curId);
  const v = form.mem.value.trim().slice(0, 240);
  if (!p || !v) return form.mem.focus();
  p.memory = [...(p.memory || []).filter((m) => m !== v), v];
  form.mem.value = '';
  commit('projects');
  form.mem.focus({ preventScroll: true });
}

function deleteMemory(i) {
  const p = project(curId);
  if (!p?.memory?.[i]) return;
  const [m] = p.memory.splice(i, 1);
  commit('projects');
  const dels = qsa('#p-ws [data-mem-del]', root);
  (dels[Math.min(i, dels.length - 1)] || qs('#ws-mem-input', root))?.focus({ preventScroll: true });
  notify('Removed from the project memory', {
    ico: 'trash',
    undo: () => {
      p.memory.splice(Math.min(i, p.memory.length), 0, m);
      commit('projects');
    },
  });
}

// ---------- Workspace: GitHub ----------
const ghReq = new Map(); // project id → { key, loading, error }
const ghKey = (p) => {
  const f = projectFolder(p);
  return f ? `${f.space}/${f.folder}` : '';
};
const REPO_RX = /^[\w.-]+\/[\w.-]+$/;
const repoInput = (form) => (form.repo.value.trim() || form.pick.value).replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');

/** Read the repository state of a project's folder (the core caches it a minute). */
function loadGh(p, { fresh = false } = {}) {
  if (!p || !isLive() || ghGate() || !projectFolder(p)) return;
  const key = ghKey(p);
  const r = ghReq.get(p.id);
  if (r?.loading && r.key === key) return;
  const moved = !!r && r.key !== key;
  ghReq.set(p.id, { key, loading: true, error: r?.key === key ? r.error : '' });
  paintWs(p, ['gh']);
  const id = p.id;
  loadRepo(p, { fresh: fresh || moved })
    .then(
      () => ghReq.set(id, { key }),
      (err) => ghReq.set(id, { key, error: bridgeError(err) }),
    )
    .then(() => {
      const cur = project(id);
      if (cur && mode === 'detail' && curId === id) paintWs(cur, ['gh']);
    });
}

const repoOptions = (repos) =>
  `<option value="">${repos.length ? 'Choose a repository…' : state.github?.status === 'loading' ? 'Loading your repositories…' : 'None loaded'}</option>
  ${repos.map((r) => `<option value="${esc(r.repo)}">${esc(r.repo)}${r.private ? ' (private)' : ''}</option>`).join('')}`;

function ghLinkForm(p, why) {
  const repos = state.github?.overview?.repos || [];
  const space = p.space || 'perso';
  return `<p class="pd-quiet">${esc(why)}</p>
    <form class="ws-gh-link" data-gh-link novalidate>
      <label class="field"><span class="field__label">Your repositories</span><select name="pick" ${repos.length ? '' : 'disabled'}>${repoOptions(repos)}</select></label>
      <label class="field"><span class="field__label">Space</span><select name="space">${SPACES.map(([s, l]) => `<option value="${s}" ${s === space ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field field--wide"><span class="field__label">Or type owner/name</span><input name="repo" placeholder="owner/name" maxlength="140" autocomplete="off" spellcheck="false"></label>
      <button type="submit" class="btn btn--glass btn--sm ws-gh-link__go">${icon('link')}Link a GitHub repo</button>
      <p class="field__hint field--wide">Lumen clones it into the space, in a folder named after the repository, and points this project there. That folder must be missing or empty.</p>
      <p class="ws-gh-link__err" role="alert"></p>
    </form>`;
}

function wsGhHtml(p) {
  const gate = ghGate();
  if (gate) return `<p class="pd-quiet">${esc(gate)}</p>`;
  if (!projectFolder(p)) return ghLinkForm(p, 'No folder yet. Choose one above, or start from a GitHub repository:');
  const req = ghReq.get(p.id) || {};
  const d = state.github?.repos?.[p.id];
  if (!d || req.key !== ghKey(p)) {
    if (req.error && !req.loading) return `<div class="src-note src-note--warn ws-gh__err" role="status">${icon('bolt')}<span>${esc(req.error)}</span><button type="button" class="btn btn--sm btn--glass" data-gh-refresh>Try again</button></div>`;
    return '<div class="ws-gh__skel" role="status" aria-label="Reading the repository"><i class="skel"></i><i class="skel"></i><i class="skel"></i></div>';
  }
  if (!d.exists) return ghLinkForm(p, 'The folder does not exist on this PC yet. Link a repository to clone it:');
  if (!d.repo) {
    const facts = d.git
      ? `<div class="ws-gh__facts">${d.branch ? `<span class="ws-gh__fact">${icon('branch')}${esc(d.branch)}</span>` : ''}<span class="ws-gh__fact ${d.dirty ? 'ws-gh__fact--warn' : ''}">${d.dirty ? plural(d.dirty, 'local change') : 'No local changes'}</span></div>`
      : '';
    return `${facts}${ghLinkForm(p, d.git ? 'This folder is a git repository with no GitHub remote named origin.' : 'This folder is not a git repository yet.')}`;
  }
  const url = d.url || `https://github.com/${d.repo}`;
  const commits = (d.commits || []).slice(0, 3);
  const prs = d.prs || [];
  const issues = (d.issues || []).slice(0, 5);
  const when = (t) => (t ? `<span class="ws-gh__when">${esc(relTime(t))}</span>` : '');
  const refresh = iconBtn('reset', req.loading ? 'Refreshing from GitHub…' : 'Refresh from GitHub', `data-gh-refresh${req.loading ? ' aria-busy="true"' : ''}`, 'ibtn--sm');
  return `<div class="ws-gh">
    <div class="ws-gh__top">${ghA(url, `${icon('code')}<span>${esc(d.repo)}</span>`, { cls: 'ws-gh__repo' })}${refresh}</div>
    ${req.error ? `<p class="src-note src-note--warn ws-gh__err" role="status">${icon('bolt')}<span>${esc(req.error)}</span></p>` : ''}
    <div class="ws-gh__facts">
      ${d.branch ? `<span class="ws-gh__fact" title="Current branch">${icon('branch')}<span class="sr">Branch </span>${esc(d.branch)}</span>` : ''}
      <span class="ws-gh__fact ${d.dirty ? 'ws-gh__fact--warn' : ''}">${d.dirty ? plural(d.dirty, 'local change') : 'No local changes'}</span>
      ${d.ahead ? `<span class="ws-gh__fact ws-gh__fact--info">${icon('arrowRight')}${plural(d.ahead, 'commit')} to push</span>` : ''}
    </div>
    ${commits.length ? `<h4 class="ws-gh__h">Latest commits</h4><ul class="ws-gh__list">${commits
      .map((c) => `<li class="ws-gh__item">${ghA(`${url}/commit/${encodeURIComponent(c.sha)}`, `<span class="ws-gh__sha">${esc(c.sha)}</span><span class="ws-gh__t">${esc(c.subject)}</span>`, { title: c.author ? `by ${c.author}` : '' })}${when(c.at)}</li>`)
      .join('')}</ul>` : ''}
    <h4 class="ws-gh__h">Open pull requests <span class="badge">${prs.length}</span></h4>
    ${prs.length ? `<ul class="ws-gh__list">${prs
      .map((pr) => `<li class="ws-gh__item">${checksDot(pr.checks)}${ghA(pr.url, `<span class="ws-gh__n">#${pr.number}</span><span class="ws-gh__t">${pr.draft ? draftBadge() : ''}${esc(pr.title)}</span>`, { title: [pr.branch, pr.author].filter(Boolean).join(' · ') })}${reviewChip(pr.review)}${when(pr.updated)}</li>`)
      .join('')}</ul>` : '<p class="pd-quiet">No open pull requests.</p>'}
    <h4 class="ws-gh__h">Open issues <span class="badge">${(d.issues || []).length}</span></h4>
    ${issues.length ? `<ul class="ws-gh__list">${issues
      .map((i) => `<li class="ws-gh__item">${ghA(i.url, `<span class="ws-gh__n">#${i.number}</span><span class="ws-gh__t">${esc(i.title)}</span>`)}${issueTaskBtn({ ...i, repo: d.repo })}</li>`)
      .join('')}</ul>` : '<p class="pd-quiet">No open issues.</p>'}
  </div>`;
}

/** Repaint the GitHub slot, keeping a half-filled link form and keyboard focus. */
function paintGh(p, slotEl) {
  const a = document.activeElement;
  const inside = slotEl.contains(a);
  const form = qs('[data-gh-link]', slotEl);
  const keep = form && { pick: form.pick.value, repo: form.repo.value, space: form.space.value, err: qs('.ws-gh-link__err', form)?.textContent || '' };
  let sel = null;
  if (inside) {
    const issue = a.dataset.ghIssue || a.dataset.ghDone;
    if (a.name && a.form) sel = `[data-gh-link] [name="${a.name}"]`;
    else if (issue) sel = `[data-gh-issue="${CSS.escape(issue)}"], [data-gh-done="${CSS.escape(issue)}"]`;
    else if (a.hasAttribute('data-gh-refresh')) sel = '[data-gh-refresh]';
    else if (a.getAttribute('href')) sel = `a[href="${CSS.escape(a.getAttribute('href'))}"]`;
  }
  slotEl.innerHTML = wsGhHtml(p);
  const next = qs('[data-gh-link]', slotEl);
  if (keep && next) {
    if ([...next.pick.options].some((o) => o.value === keep.pick)) next.pick.value = keep.pick;
    next.repo.value = keep.repo;
    next.space.value = keep.space;
    qs('.ws-gh-link__err', next).textContent = keep.err;
  }
  if (sel) (qs(sel, slotEl) || qs('[data-gh-refresh]', slotEl))?.focus({ preventScroll: true });
}

/** Clone a repository into the project, from the inline form. */
async function linkRepo(form) {
  const p = project(curId);
  if (!p) return;
  const err = qs('.ws-gh-link__err', form);
  const repo = repoInput(form);
  if (!REPO_RX.test(repo)) {
    err.textContent = 'Choose a repository, or type it as owner/name.';
    return (form.pick.disabled ? form.repo : form.pick).focus();
  }
  err.textContent = '';
  const btn = qs('.ws-gh-link__go', form);
  if (btn) btn.disabled = true;
  let failure = null;
  const res = await liveAction(
    () => cloneIntoProject(repo, form.space.value, p).catch((x) => Promise.reject((failure = x))),
    { server: 'Lumen bridge', busy: `Cloning ${repo}…`, done: `Linked ${repo} to ${p.name}`, ico: 'code' },
  );
  if (btn?.isConnected) btn.disabled = false;
  if (!res) {
    const out = qs('#p-ws .ws-gh-link__err', root) || err;
    out.textContent = bridgeError(failure);
    return;
  }
  loadGh(project(curId) || p, { fresh: true });
}

// ---------- New project from GitHub (list page) ----------
function openGhNew(anchor) {
  const gate = ghGate();
  const repos = state.github?.overview?.repos || [];
  const html = gate
    ? `<div class="gh-new"><h3 class="gh-new__title">${icon('code')}New project from GitHub</h3><p class="gh-new__sub">${esc(gate)}</p></div>`
    : `<form class="gh-new" novalidate>
      <h3 class="gh-new__title">${icon('code')}New project from GitHub</h3>
      <p class="gh-new__sub">Lumen clones the repository on your PC and makes it a project that Claude sessions work in.</p>
      <label class="field"><span class="field__label">Repository</span><select name="pick" ${repos.length ? '' : 'disabled'}>${repoOptions(repos)}</select></label>
      <label class="field"><span class="field__label">Or type owner/name</span><input name="repo" placeholder="owner/name" maxlength="140" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span class="field__label">Space</span><select name="space">${SPACES.map(([s, l]) => `<option value="${s}">${esc(l)}</option>`).join('')}</select></label>
      <p class="gh-new__err" role="alert"></p>
      <div class="gh-new__foot"><button type="submit" class="btn btn--accent btn--sm">${icon('code')}Clone and create</button></div>
    </form>`;
  const el = openPopover(anchor, html, { cls: 'pop--wide gh-pop', align: 'end', label: 'New project from GitHub' });
  if (!el) return;
  const form = el.querySelector('form');
  if (!form) return;
  (form.pick.disabled ? form.repo : form.pick).focus();
  form.pick.addEventListener('change', () => form.pick.value && (form.repo.value = ''));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('.gh-new__err', form);
    const repo = repoInput(form);
    if (!REPO_RX.test(repo)) {
      err.textContent = 'Choose a repository, or type it as owner/name.';
      return (form.pick.disabled ? form.repo : form.pick).focus();
    }
    const go = (p) => (location.hash = `#/projects/${encodeURIComponent(p.id)}`);
    const have = projectForRepo(repo);
    if (have) {
      closePopover();
      notify(`${repo} is already ${have.name}`, { ico: 'folder', tone: 'info' });
      return go(have);
    }
    err.textContent = '';
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    let failure = null;
    const p = await liveAction(
      () => cloneIntoProject(repo, form.space.value).catch((x) => Promise.reject((failure = x))),
      { server: 'Lumen bridge', busy: `Cloning ${repo}…`, done: `Created a project from ${repo}`, ico: 'code' },
    );
    if (!form.isConnected) return p && go(p);
    btn.disabled = false;
    if (!p) {
      err.textContent = bridgeError(failure);
      return;
    }
    closePopover();
    go(p);
  });
}

function detailHtml(p) {
  const legend = `<ul class="burn__legend"><li><i class="burn__swatch"></i>Done</li><li><i class="burn__dash"></i>Total</li></ul>`;
  const live = isLive();
  return head(
    {
      title: p.name,
      sub: `<span data-sub>${esc(p.summary || '')}</span>`,
      back: { href: '#/projects', label: 'Projects' },
      actions: `${pinBtn(p)}<button type="button" class="btn btn--glass" data-act="event">${icon('calendar')}New event</button><button type="button" class="btn btn--accent" data-act="task">${icon('plus')}New task</button>`,
    },
    detailStats(p),
  ) + `<div class="pd hue--${p.hue}">
    <div class="pd__col">
      ${card({ id: 'p-over', cls: 'pd-over', title: 'Overview', body: overviewHtml(p) })}
      ${card({ id: 'p-ms', cls: 'pd-ms', title: 'Milestones', sub: esc(msSub(p)), body: msHtml(p) })}
      ${card({ id: 'p-ws', cls: 'pd-ws', title: 'Workspace', sub: esc(wsSub(p)), body: wsHtml(p) })}
      ${live ? card({ id: 'p-files', cls: 'pd-files', title: 'Files', sub: esc(`Google Drive files that mention “${p.name}”`), tools: filesBtn(fileCache.get(p.id)?.status === 'loading'), body: filesHtml(p) }) : ''}
      ${card({ id: 'p-up', cls: 'pd-up', title: 'Meetings', sub: esc(upSub()), tools: '<a class="btn btn--ghost btn--sm" href="#/calendar">Calendar</a>', body: upHtml(p) })}
    </div>
    <div class="pd__col">
      ${card({ id: 'p-burn', cls: `pd-burn hue--${p.hue}`, title: 'Burn-up', sub: 'Tasks done against the total, over the project’s life', expand: true, body: `${legend}<div class="burn__chart"></div>` })}
      ${card({ id: 'p-tasks', cls: 'pd-tasks', title: 'Tasks', sub: esc(taskSub(p)), tools: `<button type="button" class="btn btn--accent btn--sm" data-act="task">${icon('plus')}Add task</button>`, body: tasksHtml(p) })}
    </div></div>`;
}

function mountDetail(p) {
  const h = qs('.head', root);
  h.classList.add('head--project');
  const ic = document.createElement('span');
  ic.className = 'head__icon';
  ic.innerHTML = projectIcon(p.id, 'lg');
  qs('.head__title', h).before(ic);
  mountBurn(p);
  loadFiles(p);
  loadGh(p);
}

const setBody = (sel, html) => {
  const b = qs(`${sel} .card__body`, root) || document.querySelector(`${sel} .card__body`);
  if (b) b.innerHTML = html;
  return b;
};
const setSub = (sel, text) => {
  const s = qs(`${sel} .card__sub`, root) || document.querySelector(`${sel} .card__sub`);
  if (s) s.textContent = text;
};

function syncDetail(topics) {
  const p = project(curId);
  if (!p) return show(resolve([curId]), 0, false);
  const has = (t) => topics.includes(t) || topics.includes('*');
  if (has('projects') || has('members')) {
    setBody('#p-over', overviewHtml(p));
    refreshStars();
    const sub = qs('[data-sub]', root);
    if (sub) sub.textContent = p.summary || '';
  }
  if (has('projects')) {
    paintMs(p);
    setSub('#p-ms', msSub(p));
    // Renamed: the Drive search and the subtitle follow the new name.
    if (isLive() && fileCache.get(p.id)?.q !== p.name) {
      setSub('#p-files', `Google Drive files that mention “${p.name}”`);
      loadFiles(p);
    }
  }
  if (has('tasks')) {
    const body = qs('#p-tasks .card__body', root);
    if (body) flipList(body, () => (body.innerHTML = tasksHtml(p)));
    setSub('#p-tasks', taskSub(p));
    mountBurn(p);
  }
  if (has('tasks') || has('projects')) updateStats(detailStats(p));
  if (has('projects') || has('bridge')) paintWs(p, has('projects') ? ['folder', 'gh', 'mem', 'runs'] : ['folder', 'gh']);
  if ((has('sessions') || has('tasks')) && !has('projects')) paintWs(p, has('tasks') ? ['runs', 'gh'] : ['runs']);
  if (has('github') && !has('projects')) paintWs(p, ['gh']);
  // A new folder, or the bridge coming up: read the repository again.
  if ((has('projects') || has('bridge')) && projectFolder(p) && !ghGate()) {
    const r = ghReq.get(p.id);
    if (!r || (r.key !== ghKey(p) && !r.loading) || (r.error && has('bridge'))) loadGh(p);
  }
  if (has('events') || has('activity') || has('projects') || (has('live') && isLive())) setBody('#p-up', upHtml(p));
}

// ---------- not found ----------
const missingHtml = () =>
  head({ title: 'Project not found', sub: 'The link may be old, or the project was removed.', back: { href: '#/projects', label: 'Projects' } }, []) +
  `<div class="pd-missing">${card({
    cls: 'pd-missing__card',
    body: emptyState('We couldn’t find that project', 'Pick one from the full list instead.', 'folder', `<a class="btn btn--accent" href="#/projects">${icon('grid')}All projects</a>`),
  })}</div>`;

// ---------- view switching ----------
function show(next, dir, same) {
  mode = next.mode;
  curId = next.id;
  burn = null;
  seg = null;
  if (mode === 'list') {
    root.innerHTML = listHtml();
    mountList();
  } else if (mode === 'detail') {
    const p = project(curId);
    root.innerHTML = detailHtml(p);
    mountDetail(p);
  } else root.innerHTML = missingHtml();

  if (same) {
    scrollTo(0, 0);
    qs('.head__title', root)?.focus({ preventScroll: true });
  }
  intro(dir);
}

function intro(dir) {
  headIntro(root);
  countAll(root);
  const cards = qsa('.pcard:not([hidden]), .card:not([hidden]), .pstart', root);
  revealCards(cards, { y: dir ? 18 : 28, stagger: 0.05, delay: 0.1 });
  if (reduced()) return;
  if (dir) {
    gsap.from(cards, { x: dir * 44, duration: 0.75, ease: 'expo.out', stagger: 0.05, delay: 0.1 });
    gsap.from(qs('.head__lead', root), { x: dir * 24, duration: 0.7, ease: 'expo.out' });
  }
  if (mode === 'list') {
    qsa('.pcard:not([hidden]) .pring', root).forEach((el, i) => playRing(el, 0, 0.4 + i * 0.06));
    qsa('.pcard[hidden] .pring', root).forEach((el) => playRing(el, 0, 0));
  } else if (mode === 'detail') {
    gsap.from(qsa('.tline__fill', root), { scaleX: 0, transformOrigin: '0 50%', duration: 1.1, ease: 'power3.out', delay: 0.4 });
    gsap.from(qsa('.tline__ms', root), { scale: 0.2, opacity: 0, duration: 0.5, ease: 'back.out(3)', stagger: 0.07, delay: 0.65, clearProps: 'transform,opacity' });
    gsap.from(qsa('.tline__now', root), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, ease: 'back.out(2.4)', delay: 0.95, clearProps: 'transform' });
    fadeUp(qsa('.ms__item, .ms-add, .ov__people li, .pgroup, .pev, .feed li, .pfile', root), { y: 10, stagger: 0.025, delay: 0.45 });
  }
}

function leaveThen(dir, done) {
  const out = qsa('.head__lead, .head__actions', root);
  gsap.to(out, { opacity: 0, x: -dir * 18, duration: 0.18, ease: 'power2.in' });
  const vis = qsa('.glass, .stat', root).filter(inView);
  if (!vis.length) return gsap.delayedCall(0.18, done);
  gsap.fromTo(
    vis,
    { clipPath: 'inset(0% 0% 0% 0% round 24px)' },
    { clipPath: 'inset(10% 10% 10% 10% round 24px)', x: -dir * 26, y: -6, scale: 0.97, opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: done },
  );
}

// ---------- interactions ----------
function onClick(e) {
  const el = e.target.closest('[data-star], [data-ms], [data-ms-del], [data-mem-del], [data-task], [data-event], [data-fold], [data-act], [data-gh-issue], [data-gh-refresh]');
  if (!el) return;

  if (el.dataset.ghIssue) {
    const issue = findIssue(el.dataset.ghIssue);
    if (issue) addIssueTask(issue, curId);
    return;
  }
  if (el.hasAttribute('data-gh-refresh')) return loadGh(project(curId), { fresh: true });

  if (el.dataset.memDel != null) return deleteMemory(+el.dataset.memDel);

  if (el.dataset.msDel) return deleteMilestone(el.dataset.msDel);

  if (el.dataset.star) {
    e.preventDefault();
    const p = project(el.dataset.star);
    if (!p) return;
    p.starred = !p.starred;
    animateStar(el, p.starred);
    commit('projects');
    notify(p.starred ? `Pinned ${p.name} to the sidebar` : `Unpinned ${p.name}`, {
      ico: 'star',
      undo: () => {
        p.starred = !p.starred;
        commit('projects');
      },
    });
    return;
  }

  if (el.dataset.ms) {
    const p = project(curId);
    const m = p?.milestones.find((x) => x.id === el.dataset.ms);
    if (!m) return;
    const flipMs = () => {
      m.done = !m.done;
      logActivity('project', `${m.done ? 'reached' : 'reopened'} the milestone “${m.title}”`, p.id);
      commit('projects', 'activity');
    };
    flipMs();
    const again = qs(`[data-ms="${CSS.escape(m.id)}"]`, root);
    again?.focus();
    if (m.done && again && !reduced()) gsap.fromTo(again, { scale: 0.6 }, { scale: 1, duration: 0.55, ease: 'back.out(3)', clearProps: 'transform' });
    notify(m.done ? `Milestone reached: ${m.title}` : `Reopened: ${m.title}`, {
      ico: 'flag',
      undo: () => {
        m.done = !m.done;
        commit('projects');
      },
    });
    return;
  }

  if (el.dataset.task) return openTask(el.dataset.task);
  if (el.dataset.event) return openEvent(el.dataset.event);

  if (el.hasAttribute('data-fold')) {
    showDone = !showDone;
    const list = qs('#pdone', root);
    el.setAttribute('aria-expanded', showDone);
    el.textContent = showDone ? 'Hide' : 'Show';
    if (list) {
      list.hidden = !showDone;
      if (showDone) fadeUp(list.children, { y: 8, stagger: 0.025 });
    }
    return;
  }

  const act = el.dataset.act;
  if (act === 'files') loadFiles(project(curId), { force: true });
  else if (act === 'new') newProject();
  else if (act === 'gh-new') openGhNew(el);
  else if (act === 'task') newTask({ projectId: curId });
  else if (act === 'event') newEvent({ projectId: curId });
}

// ---------- milestones: add / delete ----------
function addMilestone(form) {
  const p = project(curId);
  if (!p) return;
  const title = form.elements.msTitle.value.trim();
  const due = parseDay(form.elements.msDue.value);
  const err = qs('.ms-add__err', form);
  const fail = (msg, input) => {
    err.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    if (!reduced()) gsap.fromTo(form, { x: -6 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.3)' });
  };
  if (!title) return fail('Give the milestone a name.', form.elements.msTitle);
  if (Number.isNaN(due)) return fail('Pick a date for the milestone.', form.elements.msDue);
  const m = { id: uid('m'), title, due, done: false };
  p.milestones.push(m);
  logActivity('project', `planned the milestone “${title}”`, p.id);
  form.elements.msTitle.value = '';
  commit('projects', 'activity');
  qs('#p-ms [name="msTitle"]', root)?.focus({ preventScroll: true });
  const row = qs(`#p-ms [data-key="${CSS.escape(m.id)}"]`, root);
  if (row && !reduced()) gsap.fromTo(row, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out', clearProps: 'opacity,transform' });
  notify(`Milestone added: ${title}`, {
    ico: 'flag',
    undo: () => {
      const i = p.milestones.indexOf(m);
      if (i >= 0) p.milestones.splice(i, 1);
      commit('projects');
    },
  });
}

function deleteMilestone(id) {
  const p = project(curId);
  const i = p ? p.milestones.findIndex((m) => m.id === id) : -1;
  if (i < 0) return;
  const [m] = p.milestones.splice(i, 1);
  // Keep keyboard focus nearby: the next milestone's delete button, or the form.
  const items = qsa('#p-ms [data-ms-del]', root);
  const at = items.findIndex((b) => b.dataset.msDel === id);
  const nextId = items[at + 1]?.dataset.msDel || items[at - 1]?.dataset.msDel;
  commit('projects');
  (nextId ? qs(`#p-ms [data-ms-del="${CSS.escape(nextId)}"]`, root) : qs('#p-ms [name="msTitle"]', root))?.focus({ preventScroll: true });
  notify(`Deleted milestone: ${m.title}`, {
    ico: 'trash',
    undo: () => {
      p.milestones.splice(Math.min(i, p.milestones.length), 0, m);
      commit('projects');
    },
  });
}

function onSubmit(e) {
  const gh = e.target.closest?.('[data-gh-link]');
  if (gh) {
    e.preventDefault();
    return linkRepo(gh);
  }
  const ws = e.target.closest?.('[data-ws-folder], [data-mem-form]');
  if (ws) {
    e.preventDefault();
    return ws.hasAttribute('data-mem-form') ? addMemory(ws) : saveFolder(ws);
  }
  const form = e.target.closest?.('[data-ms-form]');
  if (!form) return;
  e.preventDefault();
  addMilestone(form);
}

function onInput(e) {
  const form = e.target.closest?.('[data-ms-form]');
  if (!form) return;
  e.target.removeAttribute('aria-invalid');
  const err = qs('.ms-add__err', form);
  if (err) err.textContent = '';
}

// "Pick existing": load lazily, and copy the choice into the folder field.
function onWsPick(e) {
  const pick = e.target.closest?.('[data-gh-link] [name="pick"]');
  if (pick && e.type === 'change' && pick.value) pick.form.repo.value = '';
  const sel = e.target.closest?.('[data-ws-existing]');
  if (sel && e.type !== 'change') return loadExisting(sel);
  if (sel && sel.value) sel.form.folder.value = sel.value;
  const space = e.target.closest?.('[data-ws-folder] [name="space"]');
  if (space && e.type === 'change') {
    const pick = space.form.existing;
    pick.innerHTML = `<option value="">${Array.isArray(folderCache.get(space.value)) ? 'Choose a folder…' : 'Load folders…'}</option>`;
  }
}

function onStore(topics) {
  if (!root || root.hidden || !mode) return; // enter() re-renders on the next visit
  if (mode !== 'detail' && topics.every((t) => ['live', 'sessions', 'bridge', 'github'].includes(t))) return;
  if (mode === 'list') syncList();
  else if (mode === 'detail') syncDetail(topics);
  else if (project(curId)) show(resolve([curId]), 0, false);
}

// ---------- page ----------
export const page = {
  title: (params) => (!params?.[0] ? 'Projects' : project(params[0])?.name ?? 'Project not found'),
  mount(el) {
    root = el;
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onWsPick);
    root.addEventListener('focusin', onWsPick);
    root.addEventListener('pointerdown', (e) => e.target.closest?.('[data-ws-existing]') && onWsPick(e));
    bindCardExpand(root);
    ['projects', 'tasks', 'events', 'activity', 'members', 'live', 'sessions', 'bridge', 'github'].forEach((t) => subscribe(t, onStore));
  },
  enter({ params, same }) {
    const next = resolve(params);
    if (same && next.mode === mode && next.id === curId) return;
    const dir = same && mode ? (next.mode === 'list' ? -1 : 1) : 0;
    const t = ++token;
    if (same && mode && !reduced()) leaveThen(dir, () => t === token && show(next, dir, true));
    else show(next, dir, same);
  },
};
