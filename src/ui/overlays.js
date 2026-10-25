import { gsap, Flip, reduced, dur, fadeUp } from '../lib/motion.js';
import { esc, icon, uid, fmtDate, fmtTimeRange, dayLabel, dueLabel, relTime, startOfDay, addDays } from '../lib/dom.js';
import { LABEL_HUE, LABEL_COLORS } from '../lib/labels.js';
import { state, commit, subscribe, member, project, task as getTask, logActivity, setTaskStatus, STATUSES, PRIORITIES, statusLabel, firstName, activeBoard, firstStatus, reviewStatus, isLaunchable } from '../store.js';
import {
  STATUS_LABEL, KINDS, SPACES, runFor, guessKind, hasSession, projectFolder, launch, answer, stop as stopSession, openTerminal, bridgeError,
} from '../live/sessions.js';
import { avatar, avatarStack, projectChip, priorityPill, segmented, bindSegmented, iconBtn } from './components.js';
import { notify } from './island.js';
import * as focus from '../focus.js';
import { LIVE, explain } from '../live/runtime.js';
import * as cal from '../live/sources.js';
import { collaborators } from '../live/people.js';
import { openPullRequest } from '../live/github.js';
import { ghGate, prChip, sourceChip, safeGh } from './github.js';

const phone = () => matchMedia('(max-width: 760px)').matches;
const clipFrom = (f) => `inset(${f * 50}% ${f * 50}% ${f * 50}% ${f * 50}% round 24px)`;

// ---------- popover ----------
let pop = null;

export function closePopover() {
  if (!pop) return;
  const { el, anchor, onClose, cleanup } = pop;
  pop = null;
  cleanup();
  anchor.setAttribute('aria-expanded', 'false');
  gsap.to(el, { clipPath: clipFrom(0.4), opacity: 0, duration: dur(0.16), ease: 'power2.in', onComplete: () => el.remove() });
  onClose?.();
}

export function openPopover(anchor, content, { cls = '', align = 'start', label = '', onClose } = {}) {
  if (pop?.anchor === anchor) return closePopover();
  closePopover();
  const el = document.createElement('div');
  el.className = `pop glass glass--thick ${cls}`;
  if (label) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
  }
  typeof content === 'string' ? (el.innerHTML = content) : el.append(content);
  // Dialogs live in the top layer; a popover opened from one must live inside it.
  (anchor.closest('dialog[open]') ?? document.querySelector('.pop-layer')).append(el);

  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = align === 'end' ? a.right - w : align === 'center' ? a.left + a.width / 2 - w / 2 : a.left;
  x = Math.max(12, Math.min(innerWidth - w - 12, x));
  const above = a.bottom + 10 + h > innerHeight - 12 && a.top - 10 - h > 12;
  const y = above ? a.top - 10 - h : a.bottom + 10;
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, transformOrigin: `${a.left + a.width / 2 - x}px ${above ? '100%' : '0'}` });
  anchor.setAttribute('aria-expanded', 'true');
  if (!reduced()) gsap.fromTo(el, { clipPath: clipFrom(0.55), y: above ? 8 : -8, opacity: 0 }, { clipPath: 'inset(-40px round 24px)', y: 0, opacity: 1, duration: 0.5, ease: 'expo.out', clearProps: 'clipPath' });

  const outside = (e) => !el.contains(e.target) && !anchor.contains(e.target) && closePopover();
  const key = (e) => {
    if (e.key === 'Escape') {
      closePopover();
      anchor.focus();
    }
  };
  const scroll = (e) => !el.contains(e.target) && closePopover();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key);
  addEventListener('resize', closePopover);
  addEventListener('scroll', scroll, true);
  pop = {
    el, anchor, onClose,
    cleanup() {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      removeEventListener('resize', closePopover);
      removeEventListener('scroll', scroll, true);
    },
  };
  return el;
}

/** items: [{label, icon?, checked?, danger?, onSelect}] or '-' separators. */
export function openMenu(anchor, items, { align = 'start' } = {}) {
  const html = `<div class="menu" role="menu">${items
    .map((it, i) =>
      it === '-'
        ? '<hr class="menu__sep">'
        : `<button type="button" class="menu__item ${it.danger ? 'is-danger' : ''}" role="${it.checked !== undefined ? 'menuitemradio' : 'menuitem'}" ${
            it.checked !== undefined ? `aria-checked="${!!it.checked}"` : ''
          } data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.checked ? icon('check', 'menu__check') : ''}</button>`,
    )
    .join('')}</div>`;
  const el = openPopover(anchor, html, { cls: 'pop--menu', align });
  if (!el) return;
  const btns = [...el.querySelectorAll('.menu__item')];
  btns[0]?.focus();
  fadeUp(btns, { y: 6, stagger: 0.02, duration: 0.35 });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.menu__item');
    if (!b) return;
    closePopover();
    items[+b.dataset.i].onSelect?.();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length].focus();
  });
}

// ---------- dialogs (modal + drawer share the motion) ----------
function showDialog(dlg, { side = false } = {}) {
  dlg.showModal();
  if (reduced()) return;
  const p = phone();
  gsap.fromTo(
    dlg,
    { x: side && !p ? 70 : 0, y: p ? 120 : side ? 0 : 30, clipPath: clipFrom(0.5), opacity: 0 },
    { x: 0, y: 0, opacity: 1, clipPath: 'inset(-40px round 30px)', duration: 0.6, ease: 'expo.out', clearProps: 'clipPath,transform' },
  );
}

function hideDialog(dlg, { side = false } = {}) {
  if (dlg.dataset.closing) return Promise.resolve();
  dlg.dataset.closing = '1';
  return new Promise((done) => {
    const finish = () => {
      dlg.close();
      delete dlg.dataset.closing;
      gsap.set(dlg, { clearProps: 'all' });
      done();
    };
    if (reduced()) return finish();
    const p = phone();
    gsap.to(dlg, { x: side && !p ? 48 : 0, y: p ? 80 : side ? 0 : 16, opacity: 0, clipPath: clipFrom(0.3), duration: 0.24, ease: 'power2.in', onComplete: finish });
  });
}

function wireDialog(dlg, close) {
  if (dlg._wired) return;
  dlg._wired = true;
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    dlg._close?.();
  });
  dlg.addEventListener('click', (e) => e.target === dlg && dlg._close?.());
}

// ---------- form modal ----------
/**
 * fields: [{name, label, type: text|date|time|number|select|textarea, value?, options?: [[v, label]], required?, wide?, hint?, min?, max?}]
 * onSubmit(values) may return an error string to keep the modal open.
 */
export function formModal({ title, sub = '', submit = 'Save', danger = false, fields = [], onSubmit }) {
  const dlg = document.getElementById('modal');
  closePopover();
  const control = (f) => {
    const common = `name="${f.name}" id="mf-${f.name}" ${f.required ? 'required' : ''}`;
    if (f.type === 'select')
      return `<select ${common}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea ${common} rows="3">${esc(f.value ?? '')}</textarea>`;
    return `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} autocomplete="off">`;
  };
  dlg.innerHTML = `<span class="grabber"></span><form class="mform" novalidate>
    <div class="mform__head">${iconBtn('x', 'Close', 'data-close', 'ibtn--glass')}
      <div class="mform__titles"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <button type="submit" class="btn btn--sm ${danger ? 'btn--danger' : 'btn--accent'}">${esc(submit)}</button></div>
    ${fields.length ? `<div class="mform__grid">${fields
      .map((f) => `<label class="field ${f.wide ? 'field--wide' : ''}" for="mf-${f.name}"><span class="field__label">${esc(f.label)}</span>${control(f)}${f.hint ? `<span class="field__hint">${esc(f.hint)}</span>` : ''}</label>`)
      .join('')}</div>` : ''}
    <p class="mform__err" role="alert"></p></form>`;
  return new Promise((resolve) => {
    const form = dlg.querySelector('form');
    const err = form.querySelector('.mform__err');
    const close = (v) => hideDialog(dlg).then(() => resolve(v));
    dlg._close = () => close(null);
    wireDialog(dlg);
    form.querySelector('[data-close]').addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const missing = [...form.querySelectorAll('[required]')].find((i) => !i.value.trim());
      const fail = (msg, input) => {
        err.textContent = msg;
        input?.focus();
        if (!reduced()) gsap.fromTo(form, { x: -6 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.3)' });
      };
      if (missing) return fail(`${fields.find((f) => f.name === missing.name).label} is required.`, missing);
      const values = Object.fromEntries(new FormData(form));
      const res = onSubmit?.(values);
      if (typeof res === 'string') return fail(res);
      close(values);
    });
    showDialog(dlg);
    fadeUp(form.querySelectorAll('.field'), { y: 10, stagger: 0.03, delay: 0.1 });
    if (matchMedia('(pointer: fine)').matches) form.querySelector('input, select, textarea')?.focus();
  });
}

export const confirm = (title, sub, label = 'Confirm', danger = true) =>
  formModal({ title, sub, submit: label, danger, fields: [] }).then((v) => v !== null);

// ---------- drawer ----------
let drawerClose = null;
export function openDrawer(html, { label = '', onMount, onClose } = {}) {
  const dlg = document.getElementById('drawer');
  closePopover();
  dlg.setAttribute('aria-label', label);
  dlg.innerHTML = `<span class="grabber"></span>${iconBtn('x', 'Close', 'data-close', 'drawer__close ibtn--glass')}<div class="drawer__body">${html}</div>`;
  let closed = false;
  const close = () =>
    hideDialog(dlg, { side: true }).then(() => {
      if (closed) return;
      closed = true;
      onClose?.();
    });
  drawerClose = close;
  dlg._close = close;
  wireDialog(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', close);
  if (!dlg.open) showDialog(dlg, { side: true });
  onMount?.(dlg.querySelector('.drawer__body'));
  fadeUp(dlg.querySelectorAll('.drawer__body > *'), { y: 12, stagger: 0.04, delay: 0.08 });
  return dlg.querySelector('.drawer__body');
}
export const closeDrawer = () => drawerClose?.();

// ---------- card expand ----------
let focused = null;
export const focusedCard = () => focused;

export function collapseCard() {
  if (!focused) return;
  const { card, ph } = focused;
  focused = null;
  const scrim = document.querySelector('.scrim');
  const state = Flip.getState(card);
  card.classList.remove('is-focus', 'glass--thick');
  ph.remove();
  document.documentElement.classList.remove('has-focus');
  gsap.to(scrim, { opacity: 0, duration: dur(0.3) });
  Flip.from(state, { scale: true, duration: dur(0.5), ease: 'power3.inOut', onComplete: () => card.dispatchEvent(new CustomEvent('card:resize')) });
}

export function bindCardExpand(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-expand]');
    if (!btn) return;
    const card = btn.closest('.card');
    if (focused?.card === card) return collapseCard();
    collapseCard();
    const ph = document.createElement('div');
    ph.className = 'card-ph';
    ph.style.cssText = `grid-area:${card.style.gridArea || 'auto'};height:${card.offsetHeight}px`;
    const s = Flip.getState(card);
    // The card stays in its page (position: fixed lifts it), so page listeners keep working.
    card.before(ph);
    card.classList.add('is-focus', 'glass--thick');
    focused = { card, ph };
    document.documentElement.classList.add('has-focus');
    gsap.to('.scrim', { opacity: 1, duration: dur(0.35) });
    Flip.from(s, { scale: true, duration: dur(0.6), ease: 'power3.inOut', onComplete: () => card.dispatchEvent(new CustomEvent('card:resize')) });
  });
}

// ---------- creators ----------
// In live mode the member list holds every mail sender; offer real people only.
const memberOpts = () =>
  (LIVE ? [state.members[0], ...collaborators().slice(0, 40)] : state.members).map((m) => [m.id, m.id === 'me' && LIVE ? `${m.name || 'Me'} (me)` : m.name]);

/** Run a connector write behind a toast; resolves the result, or null on failure. */
export async function liveAction(run, { busy, done, server = 'Google Calendar', ico = 'calendar', undo } = {}) {
  if (busy) notify(busy, { ico, tone: 'info', hold: 30 });
  try {
    const r = await run();
    if (done) notify(done, { ico, undo });
    return r ?? true;
  } catch (err) {
    notify(explain(err, server).text, { ico: 'x', tone: 'warn', hold: 5 });
    return null;
  }
}
const projectOpts = (all = false) => state.projects.filter((p) => all || p.status !== 'done').map((p) => [p.id, p.name]);
const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseDay = (s, h = 17, m = 0) => {
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

export function newTask(preset = {}) {
  return formModal({
    title: 'New task',
    submit: 'Add task',
    fields: [
      { name: 'title', label: 'Title', required: true, wide: true, value: preset.title },
      { name: 'projectId', label: 'Project', type: 'select', options: [['', 'No project'], ...projectOpts()], value: preset.projectId ?? '' },
      { name: 'assignee', label: 'Assignee', type: 'select', options: memberOpts(), value: preset.assignee || state.me },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), value: 'medium' },
      { name: 'due', label: 'Due', type: 'date', value: isoDay(preset.due ?? addDays(new Date(), 2)) },
      { name: 'status', label: 'Status', type: 'select', options: STATUSES, value: preset.status || firstStatus() },
      { name: 'est', label: 'Estimate (hours)', type: 'number', value: 2, min: 1, max: 40 },
    ],
    onSubmit(v) {
      const t = {
        id: uid('t'), title: v.title.trim(), projectId: v.projectId || null, status: v.status, priority: v.priority, assignee: v.assignee,
        due: parseDay(v.due), created: Date.now(), doneAt: v.status === 'done' ? Date.now() : null, est: +v.est || 1,
        order: Math.min(0, ...state.tasks.filter((x) => x.order < 1000).map((x) => x.order)) - 1 - Math.random() * 0.01,
        subtasks: [], comments: [], notes: '', boardId: activeBoard().id,
      };
      state.tasks.push(t);
      logActivity('task', `added “${t.title}”`, t.projectId);
      commit('tasks', 'activity');
      notify(`Added “${t.title}”`, {
        undo: () => {
          state.tasks.splice(state.tasks.indexOf(t), 1);
          commit('tasks');
        },
      });
    },
  });
}

export function newEvent(preset = {}) {
  const next = new Date(Date.now() + 3600_000);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return formModal({
    title: 'New event',
    submit: 'Add event',
    fields: [
      { name: 'title', label: 'Title', required: true, wide: true },
      { name: 'date', label: 'Date', type: 'date', value: isoDay(preset.date ?? next) },
      { name: 'time', label: 'Starts', type: 'time', value: preset.time ?? hhmm(next) },
      { name: 'len', label: 'Length', type: 'select', options: [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']], value: 30 },
      { name: 'kind', label: 'Type', type: 'select', value: preset.kind,
        options: LIVE ? [['meeting', 'Event'], ['focus', 'Focus time']] : [['meeting', 'Meeting'], ['focus', 'Focus'], ['review', 'Review'], ['deadline', 'Deadline'], ['social', 'Social']] },
      ...(LIVE ? [] : [{ name: 'projectId', label: 'Project', type: 'select', options: [['', 'None'], ...projectOpts()], value: preset.projectId ?? '' }]),
      { name: 'place', label: 'Where', wide: true, hint: 'Leave empty for a video call' },
      ...(LIVE ? [{ name: 'guests', label: 'Guests', wide: true, value: preset.guests ?? '', hint: 'Emails separated by commas. Google Calendar sends the invitations.' }] : []),
    ],
    onSubmit(v) {
      const [h, m] = v.time.split(':').map(Number);
      const start = parseDay(v.date, h, m);
      if (LIVE) {
        const raw = (v.guests || '').trim();
        const guests = raw.split(/[,;\s]+/).filter((x) => /.+@.+\..+/.test(x));
        if (raw && !guests.length) return 'Guests must be email addresses.';
        const title = v.title.trim();
        let created = null;
        liveAction(
          () => cal.createEvent({ title, start, end: start + v.len * 60000, kind: v.kind, place: v.place.trim() || (v.kind === 'focus' ? null : 'video'), attendees: guests }).then((r) => (created = r)),
          {
            busy: `Adding “${title}” to Google Calendar…`,
            done: `Added “${title}” · ${dayLabel(start)}`,
            undo: () => created?.id && liveAction(() => cal.deleteEvent({ gid: created.id, calendarId: 'primary' }), { done: 'Event removed', ico: 'trash' }),
          },
        );
        return;
      }
      const e = { id: uid('e'), title: v.title.trim(), start, end: start + v.len * 60000, kind: v.kind, projectId: v.projectId || null, attendees: [state.me], place: v.place.trim() || 'video' };
      state.events.push(e);
      commit('events');
      notify(`Added “${e.title}” · ${dayLabel(start)}`, { ico: 'calendar', tone: 'info', undo: () => (state.events.splice(state.events.indexOf(e), 1), commit('events')) });
    },
  });
}

export function newProject() {
  return formModal({
    title: 'New project',
    submit: 'Create',
    fields: [
      { name: 'name', label: 'Name', required: true, wide: true },
      { name: 'summary', label: 'Summary', type: 'textarea', wide: true },
      { name: 'lead', label: 'Lead', type: 'select', options: memberOpts(), value: state.me },
      { name: 'hue', label: 'Colour', type: 'select', options: ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo'].map((h) => [h, h[0].toUpperCase() + h.slice(1)]) },
      { name: 'due', label: 'Target date', type: 'date', value: isoDay(addDays(new Date(), 30)) },
      { name: 'icon', label: 'Icon', type: 'select', options: ['rocket', 'grid', 'layers', 'palette', 'sprout', 'megaphone', 'target', 'phone', 'bolt'].map((i) => [i, i[0].toUpperCase() + i.slice(1)]) },
    ],
    onSubmit(v) {
      const id = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 5);
      state.projects.push({ id, name: v.name.trim(), hue: v.hue, icon: v.icon, lead: v.lead, members: [...new Set([v.lead, state.me])], status: 'planning', summary: v.summary.trim(), starred: true, start: Date.now(), due: parseDay(v.due), milestones: [] });
      logActivity('project', `created ${v.name.trim()}`, id);
      commit('projects', 'activity');
      notify(`Created ${v.name.trim()}`, { ico: 'folder' });
      location.hash = `#/projects/${id}`;
    },
  });
}

// ---------- Claude sessions (task cards, rows and the task drawer) ----------
// The local bridge runs headless Claude Code; here we only show a short
// status, the live line, the summary, and answer questions.
const SES_ACTIVE = new Set(['queued', 'running']);
const KIND_SHORT = { code: 'Code', design: 'Design', docs: 'Docs', email: 'Email' };
const sesDrafts = new Map(); // task id → unsent answer, kept across re-renders
const DEMO_GATE = 'Open Lumen from the Claude desktop app to run sessions';

/** Why sessions can't run right now; '' when the bridge is ready. */
export function sessionGate() {
  if (state.demo) return DEMO_GATE;
  const b = state.bridge || {};
  if (b.status === 'ok') return '';
  if (b.status === 'checking') return 'Connecting to the Lumen bridge…';
  return b.text || DEMO_GATE;
}

/** The launch button a task offers: null, or {resume}. */
export function sessionCta(t) {
  if (!t || t.status === 'done') return null;
  const run = runFor(t);
  if (run && (SES_ACTIVE.has(run.status) || run.status === 'waiting')) return null;
  const resume = hasSession(t);
  if (t.status === reviewStatus() && t.status !== firstStatus()) return resume ? { resume: true } : null;
  return isLaunchable(t) ? { resume } : null;
}

/** True while a run of this task is working or waiting for an answer. */
export const sessionBusy = (t) => {
  const st = runFor(t)?.status;
  return SES_ACTIVE.has(st) ? 'working' : st === 'waiting' ? 'waiting' : '';
};

export function sessionCtaHtml(t, { compact = false, cls = '' } = {}) {
  const cta = sessionCta(t);
  if (!cta) return '';
  const gate = sessionGate();
  const label = cta.resume ? 'Resume work' : 'Launch a session';
  const ico = icon(cta.resume ? 'play' : 'sparkle');
  const off = gate ? ` aria-disabled="true" data-gate="${esc(gate)}"` : '';
  const tip = esc(gate || `${label} on “${t.title}”`);
  if (compact)
    return `<button type="button" class="ibtn ibtn--sm ses-cta ses-cta--icon ${gate ? 'is-off' : ''} ${cls}" data-ses-launch aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(label)}: ${esc(t.title)}${gate ? `. ${esc(gate)}` : ''}" title="${tip}"${off}>${ico}</button>`;
  return `<button type="button" class="ses-cta ${gate ? 'is-off' : ''} ${cls}" data-ses-launch aria-haspopup="dialog" aria-expanded="false" title="${tip}"${off}>${ico}<span>${label}</span>${gate ? `<span class="sr">. ${esc(gate)}</span>` : ''}</button>`;
}

const isMailTask = (t) => t?.source?.kind === 'mail' || /mail\.google\.com/.test(t?.notes || '');

/** Status, live line or summary, and the question with its reply form. */
export function sessionStripHtml(t, { full = false } = {}) {
  const run = runFor(t);
  if (!run) return '';
  const st = run.status;
  const gate = sessionGate();
  const dis = gate ? ` disabled title="${esc(gate)}"` : '';
  let body = '';
  if (SES_ACTIVE.has(st)) {
    const live = run.live || (st === 'queued' ? 'Waiting for a free slot…' : 'Working…');
    body = `<p class="ses-strip__live" title="${esc(live)}">${esc(live)}</p>`;
  } else if (st === 'waiting') {
    body = `<div class="ses-strip__ask">
      <p class="ses__q">${esc(run.question || run.summary || 'Claude needs a decision to continue.')}</p>
      ${run.options?.length ? `<div class="ses__opts">${run.options.map((o) => `<button type="button" class="btn btn--sm btn--glass" data-ses-opt="${esc(o)}"${dis}>${esc(o)}</button>`).join('')}</div>` : ''}
      <form class="ses__reply" data-ses-reply><input class="input" name="v" value="${esc(sesDrafts.get(t.id) || '')}" placeholder="Answer Claude…" autocomplete="off" aria-label="Answer Claude about “${esc(t.title)}”"${dis}><button class="btn btn--sm btn--accent" type="submit"${dis}>Send</button></form>
    </div>`;
  } else if (st === 'error') {
    body = `<p class="ses-strip__err">${esc(run.error || 'The session failed.')}</p>`;
  } else {
    const text = run.summary || run.live || '';
    if (text) body = `<p class="ses-strip__sum">${esc(text)}</p>`;
  }
  const files = run.files?.length && !SES_ACTIVE.has(st) ? `<span class="ses-strip__files">${run.files.length} file${run.files.length > 1 ? 's' : ''}</span>` : '';
  let acts = '';
  if (full) {
    const b = (act, ico, label) => `<button type="button" class="btn btn--sm btn--ghost" data-ses-act="${act}"${dis}>${icon(ico)}${label}</button>`;
    acts = [
      SES_ACTIVE.has(st) ? b('stop', 'stop', 'Stop') : '',
      run.session_id ? b('terminal', 'keyboard', 'Take over') : '',
      run.draft && isMailTask(t) ? b('draft', 'mail', 'Save as Gmail draft') : '',
    ].join('');
  }
  return `<div class="ses-strip ses--${st}${full ? ' ses-strip--full' : ''}" data-ses data-run="${esc(run.run_id)}">
    <p class="ses-strip__head"><span class="ses__dot" aria-hidden="true"></span><b>Claude</b><span class="ses-strip__st">${esc(STATUS_LABEL[st] || st)}</span>${files}${full ? `<span class="ses-strip__when">${relTime(run.updated)}</span>` : ''}</p>
    ${body}${acts ? `<div class="ses-strip__acts">${acts}</div>` : ''}
  </div>`;
}

/** Re-render `el` without losing a half-typed answer or keyboard focus. */
export function keepSessionFocus(el, paint) {
  const a = document.activeElement;
  if (!a || a === el || !el.contains(a)) return void paint();
  const row = a.closest('[data-key]');
  const scope = row && row !== el && el.contains(row) ? `[data-key="${CSS.escape(row.dataset.key)}"] ` : '';
  const attr = ['data-ses-launch', 'data-open', 'data-more', 'data-done', 'data-ses-act', 'data-ses-opt'].find((n) => a.hasAttribute(n));
  const sel = a.matches('[data-ses-reply] input')
    ? `${scope}[data-ses-reply] input`
    : attr ? `${scope}[${attr}${a.getAttribute(attr) ? `="${CSS.escape(a.getAttribute(attr))}"` : ''}]` : null;
  const caret = a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  const fresh = paint() || el;
  if (!sel || fresh.contains(document.activeElement)) return;
  const next = (fresh.matches?.(sel) && fresh) || fresh.querySelector(sel);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && next.setSelectionRange) next.setSelectionRange(...caret);
}

// One polite live region for the whole app: status changes only, never live lines.
const lastStatus = new Map();
let announcer = null;
function announceSessions() {
  for (const r of state.sessions || []) {
    const was = lastStatus.get(r.run_id);
    lastStatus.set(r.run_id, r.status);
    if (was === undefined || was === r.status) continue;
    if (!announcer?.isConnected) {
      announcer = document.createElement('p');
      announcer.className = 'sr';
      announcer.setAttribute('aria-live', 'polite');
      document.body.append(announcer);
    }
    const t = getTask(r.task_id);
    announcer.textContent = `Claude session on “${t?.title || r.task_title || 'a task'}”: ${STATUS_LABEL[r.status] || r.status}.`;
  }
}
subscribe('sessions', announceSessions);
// Seed the map so the first poll doesn't announce every known run.
queueMicrotask(() => (state.sessions || []).forEach((r) => lastStatus.set(r.run_id, r.status)));

async function sesAct(fn, done) {
  try {
    await fn();
    if (done) notify(done, { ico: 'check' });
  } catch (err) {
    notify(bridgeError(err), { ico: 'x', tone: 'warn', hold: 5 });
  }
}

/** The pop-over that starts (or resumes) a session for a task. */
export function openLaunch(anchor, t, { resume = hasSession(t) } = {}) {
  const gate = sessionGate();
  if (gate) return notify(gate, { ico: 'sparkle', tone: 'warn', hold: 4 });
  const p = project(t.projectId);
  const fixed = projectFolder(p);
  const spaceName = (id) => SPACES.find(([s]) => s === id)?.[1] || id;
  const kind0 = (resume && t.session?.kind) || guessKind(t);
  const space0 = t.session?.space || 'perso';
  const folder0 = (t.session?.folder || p?.name || t.title || '').slice(0, 60);
  const fid = uid('sl');
  const html = `<form class="ses-launch" novalidate>
    <h3 class="ses-launch__title">${icon(resume ? 'play' : 'sparkle')}${resume ? 'Resume work' : 'Launch a session'}</h3>
    <p class="ses-launch__sub">Claude works on “${esc(t.title)}” in the background on your PC and reports back here.</p>
    <div class="ses-launch__row"><span class="field__label" id="${fid}-k">Kind of work</span>
      ${segmented('Kind of work', KINDS.map(([k, label]) => [k, `<span title="${esc(label)}">${KIND_SHORT[k] || label}</span>`]), kind0, 'seg--sm ses-launch__kind')}</div>
    ${fixed
      ? `<p class="ses-launch__where">${icon('folder')}<span><span class="sr">Folder: </span>${esc(spaceName(fixed.space))} / ${esc(fixed.folder)}</span></p>`
      : `<div class="ses-launch__pick">
          <label class="field"><span class="field__label">Space</span><select name="space">${SPACES.map(([s, l]) => `<option value="${s}" ${s === space0 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span class="field__label">Folder</span><input name="folder" value="${esc(folder0)}" maxlength="60" autocomplete="off" spellcheck="false"></label>
          <span class="field__hint">Created if missing${p ? ` · saved as ${esc(p.name)}’s folder` : ''}</span>
        </div>`}
    <label class="field"><span class="field__label">Note for Claude <small class="faint">optional</small></span><textarea name="note" rows="2" placeholder="${resume ? 'What should change, or what to look at next' : 'Anything Claude should know first'}"></textarea></label>
    <p class="ses-launch__err" role="alert"></p>
    <div class="ses-launch__foot"><button type="submit" class="btn btn--accent btn--sm">${icon(resume ? 'play' : 'sparkle')}${resume ? 'Resume' : 'Launch'}</button></div>
  </form>`;
  const el = openPopover(anchor, html, { cls: 'pop--wide ses-pop', align: 'end', label: resume ? 'Resume work' : 'Launch a session' });
  if (!el) return;
  const form = el.querySelector('form');
  const seg = bindSegmented(form.querySelector('.seg'));
  (form.querySelector('[name="folder"]') || form.querySelector('.seg__btn[aria-pressed="true"]'))?.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const where = fixed || { space: form.space.value, folder: form.folder.value.trim() };
    if (!where.folder) {
      form.querySelector('.ses-launch__err').textContent = 'Give the folder a name.';
      return form.folder.focus();
    }
    const note = form.note.value;
    closePopover();
    anchor.isConnected && anchor.focus({ preventScroll: true });
    liveAction(() => launch(t, { kind: seg.value || kind0, note, where, resume }), {
      server: 'Lumen bridge', busy: 'Starting Claude…', done: 'Claude is on it', ico: 'sparkle',
    });
  });
}

function saveGmailDraft(t, run) {
  const th = t.source?.threadId && (state.threads || []).find((x) => x.id === t.source.threadId);
  const subject = th?.subject || t.title;
  liveAction(
    () => cal.draft({
      to: th?.fromEmail ? [th.fromEmail] : [],
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      body: run.draft,
      replyToMessageId: th?.lastMessageId || t.source?.messageId || undefined,
    }),
    { server: 'Gmail', ico: 'mail', busy: 'Saving the draft in Gmail…', done: 'Draft saved — review and send it from Gmail' },
  );
}

// ---------- pull requests (task cards, rows and the drawer) ----------
const prBusy = new Set(); // task ids with a pull request being opened

/** Claude finished a code session on this task and no pull request exists yet. */
export const prEligible = (t) =>
  !!t && !safeGh(t.pr?.url) && t.session?.kind === 'code' && (runFor(t)?.status || t.session?.status) === 'done';

/** Everything the PR controls depend on (for repaint signatures). */
export const prSig = (t) => [t?.pr?.url || '', prEligible(t), ghGate()].join('|');

/** The "Open pull request" button for a task, or ''. */
export function prCtaHtml(t, { full = false } = {}) {
  if (!prEligible(t)) return '';
  const gate = ghGate();
  const busy = prBusy.has(t.id);
  const off = gate ? ` aria-disabled="true" data-gate="${esc(gate)}"` : '';
  const btn = (draft) =>
    `<button type="button" class="${draft ? 'btn btn--sm btn--ghost' : `ses-cta${full ? ' ses-cta--wide' : ''}`} ${gate ? 'is-off' : ''}" data-gh-pr="${draft ? 'draft' : 'ready'}" data-gh-task="${esc(t.id)}" title="${esc(gate || (draft ? 'Push the branch and open a draft pull request' : 'Push the branch and open a pull request'))}"${off}${busy ? ' disabled aria-busy="true"' : ''}>${icon('pr')}<span>${busy ? 'Opening…' : draft ? 'As draft' : 'Open pull request'}</span>${gate ? `<span class="sr">. ${esc(gate)}</span>` : ''}</button>`;
  return full ? `<div class="dr-pr">${btn(false)}${btn(true)}</div>` : btn(false);
}

async function openPr(t, draft) {
  const gate = ghGate();
  if (gate) return notify(gate, { ico: 'pr', tone: 'warn', hold: 4 });
  if (prBusy.has(t.id)) return;
  prBusy.add(t.id);
  const btns = () => document.querySelectorAll(`[data-gh-task="${CSS.escape(t.id)}"]`);
  btns().forEach((b) => {
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    const label = b.querySelector('span');
    if (label && b.dataset.ghPr === (draft ? 'draft' : 'ready')) label.textContent = 'Opening…';
  });
  const res = await liveAction(() => openPullRequest(t, { draft }), {
    server: 'Lumen bridge', ico: 'pr', busy: `Pushing “${t.title}” and opening a pull request…`,
  });
  prBusy.delete(t.id);
  if (res) {
    notify(res.existed ? `Pull request${res.number ? ` #${res.number}` : ''} was already open` : `Opened pull request${res.number ? ` #${res.number}` : ''}`, { ico: 'pr' });
  } else {
    btns().forEach((b) => {
      b.disabled = false;
      b.removeAttribute('aria-busy');
      const label = b.querySelector('span');
      if (label) label.textContent = b.dataset.ghPr === 'draft' ? 'As draft' : 'Open pull request';
    });
  }
}

/** Click handling for session controls inside `scope`; true when handled. */
export function handleSessionClick(e, t) {
  const prBtn = e.target.closest('[data-gh-pr]');
  if (prBtn) {
    e.preventDefault();
    if (prBtn.disabled) return true;
    if (prBtn.dataset.gate) return notify(prBtn.dataset.gate, { ico: 'pr', tone: 'warn', hold: 4 }), true;
    openPr(t, prBtn.dataset.ghPr === 'draft');
    return true;
  }
  const launchBtn = e.target.closest('[data-ses-launch]');
  if (launchBtn) {
    e.preventDefault();
    if (launchBtn.dataset.gate) return notify(launchBtn.dataset.gate, { ico: 'sparkle', tone: 'warn', hold: 4 }), true;
    openLaunch(launchBtn, t, { resume: !!sessionCta(t)?.resume });
    return true;
  }
  const strip = e.target.closest('[data-ses]');
  if (!strip) return false;
  const run = runFor(t);
  const opt = e.target.closest('[data-ses-opt]');
  const act = e.target.closest('[data-ses-act]')?.dataset.sesAct;
  if (!run || (!opt && !act)) return !!(opt || act);
  if (opt) {
    sesDrafts.delete(t.id);
    sesAct(() => answer(run, opt.dataset.sesOpt), 'Answer sent — Claude is back on it');
  } else if (act === 'stop') sesAct(() => stopSession(run), 'Session stopped');
  else if (act === 'terminal') sesAct(() => openTerminal(run), 'Opened a Claude Code terminal');
  else if (act === 'draft') saveGmailDraft(t, run);
  return true;
}

/** Submit handling for the inline answer form; true when handled. */
export function handleSessionSubmit(e, t) {
  const f = e.target.closest?.('[data-ses-reply]');
  if (!f) return false;
  e.preventDefault();
  const run = runFor(t);
  const text = f.v.value.trim();
  if (!run || !text) return true;
  if (sessionGate()) return notify(sessionGate(), { ico: 'sparkle', tone: 'warn', hold: 4 }), true;
  sesDrafts.delete(t.id);
  f.v.value = '';
  sesAct(() => answer(run, text), 'Answer sent — Claude is back on it');
  return true;
}

/** Keep half-typed answers: call from an 'input' listener. */
export function trackSessionDraft(e, t) {
  if (t && e.target.matches?.('[data-ses-reply] input')) sesDrafts.set(t.id, e.target.value);
}

function claudeSecHtml(t) {
  const gate = sessionGate();
  const run = runFor(t);
  const past = (t.comments || []).filter((c) => c.who === 'claude').slice(-5).reverse();
  const cta = sessionCtaHtml(t, { cls: 'ses-cta--wide' });
  return `<h3>${icon('sparkle')}Claude${run ? ` <span class="badge">${esc(STATUS_LABEL[run.status] || run.status)}</span>` : ''}</h3>
    ${gate ? `<p class="dr-claude__off">${icon('bolt')}<span>${esc(gate)}</span></p>` : ''}
    ${sessionStripHtml(t, { full: true })}
    ${cta}
    ${safeGh(t.pr?.url) ? `<div class="dr-pr">${prChip(t)}${t.pr.branch ? `<span class="dr-pr__hint">from ${esc(t.pr.branch)}</span>` : ''}</div>` : prCtaHtml(t, { full: true })}
    ${!run && !cta && !past.length && !t.pr ? '<p class="faint dr-claude__none">No session on this task.</p>' : ''}
    ${past.length ? `<h4 class="dr-claude__h">Earlier summaries</h4><ul class="dr-claude__past">${past.map((c) => `<li><span class="faint">${relTime(c.at)}</span><p>${esc(c.text)}</p></li>`).join('')}</ul>` : ''}`;
}

// ---------- task drawer ----------
export function openTask(id, { onClose } = {}) {
  const t = getTask(id);
  if (!t) return notify('That task no longer exists', { ico: 'x', tone: 'warn' });
  const render = (body) => {
    const p = project(t.projectId);
    const late = t.status !== 'done' && t.due < startOfDay().getTime();
    const mailUrl = (t.notes || '').match(/https:\/\/mail\.google\.com\/\S+/)?.[0];
    const doneSubs = t.subtasks.filter((s) => s.done).length;
    body.innerHTML = `
      <div class="dr-kicker">${projectChip(t.projectId)} ${priorityPill(t.priority)}</div>
      <h2 class="dr-title">${esc(t.title)}</h2>
      <div class="dr-status">${segmented('Status', STATUSES.map(([v, l]) => [v, l]), t.status, 'seg--sm')}</div>
      <dl class="dr-meta">
        <div><dt>Assignee</dt><dd>${avatar(t.assignee, 'xs')} ${esc(member(t.assignee)?.name)}</dd></div>
        <div><dt>Due</dt><dd class="${late ? 'is-late' : ''}">${dueLabel(t.due)}</dd></div>
        <div><dt>Estimate</dt><dd>${t.est}h</dd></div>
        ${p ? `<div><dt>Project</dt><dd><a href="#/projects/${p.id}">${esc(p.name)}</a></dd></div>` : ''}
        ${mailUrl ? `<div><dt>Source</dt><dd><a href="${esc(mailUrl)}" target="_blank" rel="noopener">${icon('mail')}From email</a></dd></div>` : ''}
        ${!mailUrl && t.source?.kind === 'github' ? `<div><dt>Source</dt><dd>${sourceChip(t)}</dd></div>` : ''}
      </dl>
      <section class="dr-sec"><h3>Labels</h3>
        <div class="tk-labels">${(t.labels || []).map((l, i) => `<span class="tk-label" style="--lb:${LABEL_HUE[l.color] || '#888'}">${esc(l.name)}<button type="button" class="tk-label__x" data-unlabel="${i}" aria-label="Remove label ${esc(l.name)}">×</button></span>`).join('') || '<span class="faint">No labels.</span>'}</div>
        <form class="dr-add" data-form="label"><input class="input" name="v" placeholder="Add a label" autocomplete="off"><select class="input" name="c" aria-label="Label colour">${LABEL_COLORS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></form></section>
      <section class="dr-sec dr-claude" data-claude aria-label="Claude session">${claudeSecHtml(t)}</section>
      <section class="dr-sec"><h3>Subtasks <span class="badge">${doneSubs}/${t.subtasks.length}</span></h3>
        <ul class="dr-subs">${t.subtasks.map((s) => `<li><button type="button" class="dr-sub" role="checkbox" aria-checked="${s.done}" data-sub="${s.id}"><span class="check"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span><span>${esc(s.title)}</span></button></li>`).join('')}</ul>
        <form class="dr-add" data-form="sub"><input class="input" name="v" placeholder="Add a subtask" autocomplete="off"></form></section>
      <section class="dr-sec"><h3>Comments</h3>
        <ul class="dr-comments">${t.comments.map((c) => `<li>${avatar(c.who, 'sm')}<div><b>${esc(firstName(c.who))}</b> <span class="faint">${relTime(c.at)}</span><p>${esc(c.text)}</p></div></li>`).join('') || '<li class="faint">No comments yet.</li>'}</ul>
        <form class="dr-add" data-form="comment"><input class="input" name="v" placeholder="Write a comment" autocomplete="off"></form></section>
      <footer class="dr-foot">
        <button type="button" class="btn btn--glass" data-act="focus">${icon('bolt')}Focus on this</button>
        <button type="button" class="btn btn--accent" data-act="done">${t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
        ${iconBtn('trash', 'Delete task', 'data-act="delete"')}
      </footer>`;
    bindSegmented(body.querySelector('.seg'), (v) => {
      setTaskStatus(t, v);
      render(body);
    });
  };
  let unsubs = [];
  const unwatch = () => (unsubs.forEach((u) => u()), (unsubs = []));
  openDrawer('', {
    label: 'Task',
    onClose: () => {
      unwatch();
      onClose?.();
    },
    onMount(body) {
      render(body);
      // Only the Claude section follows the bridge; the rest re-renders on edits.
      let sig = '';
      const paintClaude = () => {
        if (!body.isConnected || !getTask(t.id) || document.getElementById('drawer')?.querySelector('.drawer__body') !== body) return unwatch();
        const sec = body.querySelector('[data-claude]');
        if (!sec) return;
        const r = runFor(t);
        const next = JSON.stringify([sessionGate(), prSig(t), t.status, t.session?.sessionId, r?.status, r?.live, r?.summary, r?.question, r?.options, r?.error, r?.draft ? 1 : 0, r?.files?.length, t.comments.length, r && relTime(r.updated)]);
        if (next === sig) return;
        sig = next;
        keepSessionFocus(sec, () => void (sec.innerHTML = claudeSecHtml(t)));
      };
      unwatch();
      unsubs = [subscribe('sessions', paintClaude), subscribe('bridge', paintClaude), subscribe('tasks', paintClaude)];
      body.addEventListener('input', (e) => trackSessionDraft(e, t));
      body.addEventListener('click', async (e) => {
        if (handleSessionClick(e, t)) return;
        const un = e.target.closest('[data-unlabel]');
        if (un) {
          t.labels.splice(+un.dataset.unlabel, 1);
          commit('tasks');
          render(body);
          return;
        }
        const sub = e.target.closest('[data-sub]');
        if (sub) {
          const s = t.subtasks.find((x) => x.id === sub.dataset.sub);
          s.done = !s.done;
          commit('tasks');
          render(body);
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'done') {
          setTaskStatus(t, t.status === 'done' ? firstStatus() : 'done');
          render(body);
        }
        if (act === 'focus') {
          closeDrawer();
          if (focus.isRunning()) focus.stop();
          focus.start(state.settings.focusMinutes, t.id);
        }
        if (act === 'delete' && (await confirm('Delete this task?', `“${t.title}” will be removed.`, 'Delete'))) {
          const i = state.tasks.indexOf(t);
          state.tasks.splice(i, 1);
          commit('tasks');
          closeDrawer();
          notify('Task deleted', { ico: 'trash', undo: () => (state.tasks.splice(i, 0, t), commit('tasks')) });
        }
      });
      body.addEventListener('submit', (e) => {
        if (handleSessionSubmit(e, t)) return;
        e.preventDefault();
        const v = e.target.v.value.trim();
        if (!v) return;
        if (e.target.dataset.form === 'label') {
          t.labels = t.labels || [];
          if (!t.labels.some((l) => l.name.toLowerCase() === v.toLowerCase())) t.labels.push({ name: v.slice(0, 30), color: e.target.c.value });
        } else if (e.target.dataset.form === 'sub') t.subtasks.push({ id: uid('s'), title: v, done: false });
        else t.comments.push({ id: uid('c'), who: state.me, at: Date.now(), text: v });
        commit('tasks');
        render(body);
        body.querySelector(`[data-form="${e.target.dataset.form}"] input`).focus();
      });
    },
  });
}

// ---------- event drawer ----------
export const KIND = { meeting: 'Meeting', focus: 'Focus', review: 'Review', deadline: 'Deadline', social: 'Social', personal: 'Event', ooo: 'Out of office', allday: 'All day' };
const RSVP = [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']];
export function openEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const video = ev.place === 'video';
  const live = Date.now() >= ev.start - 5 * 60000 && Date.now() < ev.end;
  // You answer invitations; you delete only what you own (or demo data).
  const canRsvp = LIVE && ev.rsvp && ev.organizer !== 'me' && ev.attendees.length > 1;
  const canDelete = !LIVE || ev.organizer === 'me' || !ev.organizer || ev.attendees.length <= 1;
  openDrawer(
    `<span class="kind kind--${ev.kind}">${KIND[ev.kind]}</span>
    <h2 class="dr-title">${esc(ev.title)}</h2>
    <dl class="dr-meta dr-meta--list">
      <div><dt>${icon('clock')}</dt><dd>${dayLabel(ev.start)} · ${fmtTimeRange(ev.start, ev.end)}</dd></div>
      ${ev.place ? `<div><dt>${icon(video ? 'video' : 'pin')}</dt><dd>${video ? 'Video call' : esc(ev.place)}</dd></div>` : ''}
      ${ev.projectId ? `<div><dt>${icon('folder')}</dt><dd>${projectChip(ev.projectId)}</dd></div>` : ''}
      <div><dt>${icon('users')}</dt><dd>${avatarStack(ev.attendees, 'sm', 6)}${ev.attendees.length > 1 ? ` <span class="faint">${ev.attendees.length} people</span>` : ''}</dd></div>
      ${ev.calendar ? `<div><dt>${icon('calendar')}</dt><dd>${esc(ev.calendar)}</dd></div>` : ''}
      ${(ev.attachments || []).map((a) => `<div><dt>${icon('link')}</dt><dd><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || 'Attachment')}</a></dd></div>`).join('')}
    </dl>
    ${ev.description ? `<p class="dr-desc">${esc(ev.description.replace(/<[^>]+>/g, ' ').slice(0, 600))}</p>` : ''}
    ${canRsvp ? `<div class="dr-rsvp"><span class="field__label">Going?</span>${segmented('RSVP', RSVP, ev.rsvp === 'needsAction' ? '' : ev.rsvp, 'seg--sm')}</div>` : ''}
    <footer class="dr-foot">
      ${video && ev.meetUrl ? `<a class="btn btn--accent" href="${esc(ev.meetUrl)}" target="_blank" rel="noopener">${icon('video')}${live ? 'Join now' : 'Join call'}</a>` : video ? `<button type="button" class="btn btn--accent" data-act="join">${icon('video')}${live ? 'Join now' : 'Join call'}</button>` : ''}
      ${ev.link ? `<a class="btn btn--glass" href="${esc(ev.link)}" target="_blank" rel="noopener">${icon('calendar')}Open in Calendar</a>` : ''}
      ${canDelete ? `<button type="button" class="btn btn--glass" data-act="remove">${icon('trash')}${LIVE ? 'Delete' : 'Remove'}</button>` : ''}
    </footer>`,
    {
      label: 'Event',
      onMount(body) {
        const seg = body.querySelector('.dr-rsvp .seg');
        if (seg) bindSegmented(seg, (v) => liveAction(() => cal.rsvp(ev, v), { done: `Answered “${RSVP.find((r) => r[0] === v)[1]}”`, ico: 'check' }));
        body.addEventListener('click', async (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'join') {
            notify(`Joining “${ev.title}”…`, { ico: 'video', tone: 'info' });
          }
          if (act === 'remove' && LIVE) {
            if (!(await confirm('Delete this event?', `“${ev.title}” will be removed from Google Calendar.`, 'Delete'))) return;
            closeDrawer();
            liveAction(() => cal.deleteEvent(ev), { busy: 'Deleting…', done: 'Event deleted', ico: 'trash' });
            return;
          }
          if (act === 'remove') {
            const i = state.events.indexOf(ev);
            state.events.splice(i, 1);
            commit('events');
            closeDrawer();
            notify('Event removed', { ico: 'trash', undo: () => (state.events.splice(i, 0, ev), commit('events')) });
          }
        });
      },
    },
  );
}

export function toggleDone(t) {
  setTaskStatus(t, t.status === 'done' ? firstStatus() : 'done');
  if (t.status === 'done') notify(`Completed “${t.title}”`, { undo: () => setTaskStatus(t, firstStatus()) });
}

export { notify, statusLabel, fmtDate };
