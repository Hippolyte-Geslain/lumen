// ⌘K palette: pages, quick actions, then tasks / projects / people / events.

import { gsap, reduced, fadeUp } from '../lib/motion.js';
import { esc, icon, highlight } from '../lib/dom.js';
import { state, boardTasks, project, statusLabel } from '../store.js';
import { avatar, projectIcon } from './components.js';
import { closePopover, newTask, openEvent } from './overlays.js';
import * as focus from '../focus.js';
import { ROUTES } from '../routes.js';
import { openExternal } from '../lib/dom.js';
import { LIVE } from '../live/runtime.js';
import { searchMail, searchFiles } from '../live/sources.js';

// Remote results (Gmail / Drive) arrive after a pause in typing and are
// merged under their own groups; a newer query discards older answers.
let remote = { q: '', mail: [], files: [] };
let remoteTimer = 0;
let remoteToken = 0;
const FILE_ICON = { doc: 'edit', sheet: 'grid', slides: 'layers', pdf: 'list', folder: 'folder', image: 'eye', video: 'play', file: 'link' };

let dlg, input, list;
let results = [];
let sel = 0;

function build(q) {
  const ql = q.trim().toLowerCase();
  const has = (s) => s.toLowerCase().includes(ql);
  const out = [];
  const pages = ROUTES.filter((r) => !ql || has(r.title)).slice(0, ql ? 7 : 4);
  pages.forEach((r) => out.push({ group: 'Pages', label: r.title, lead: icon(r.icon), run: () => (location.hash = `#/${r.name}`) }));
  if (!ql) {
    out.push({ group: 'Actions', label: 'New task', lead: icon('plus'), run: () => newTask() });
    out.push(
      focus.isRunning()
        ? { group: 'Actions', label: 'Focus is running', lead: icon('bolt'), meta: '', run: () => {} }
        : { group: 'Actions', label: 'Start a focus session', lead: icon('bolt'), meta: `${state.settings.focusMinutes} minutes`, run: () => focus.start() },
    );
    return out;
  }
  boardTasks()
    .filter((t) => has(t.title))
    .slice(0, 5)
    .forEach((t) => out.push({ group: 'Tasks', label: t.title, meta: `${project(t.projectId)?.name} · ${statusLabel(t.status)}`, lead: projectIcon(t.projectId), run: () => (location.hash = `#/tasks/${t.id}`) }));
  state.projects
    .filter((p) => has(p.name) || has(p.summary))
    .slice(0, 4)
    .forEach((p) => out.push({ group: 'Projects', label: p.name, meta: p.summary, lead: projectIcon(p.id), run: () => (location.hash = `#/projects/${p.id}`) }));
  state.members
    .filter((m) => has(m.name) || has(m.role) || has(m.team))
    .slice(0, 4)
    .forEach((m) => out.push({ group: 'People', label: m.name, meta: `${m.role} · ${m.city}`, lead: avatar(m.id, 'xs'), run: () => (location.hash = `#/team/${m.id}`) }));
  // Mail and files: what's already loaded, then live search results.
  const mail = new Map(state.threads.filter((t) => has(t.subject) || has(t.snippet)).slice(0, 4).map((t) => [t.id, t]));
  if (remote.q === ql) remote.mail.forEach((t) => mail.size < 6 && mail.set(t.id, t));
  [...mail.values()].forEach((t) => out.push({ group: 'Mail', label: t.subject, meta: `${t.fromEmail || ''} · ${new Date(t.at).toLocaleDateString()}`, lead: icon('mail'), run: () => (location.hash = `#/inbox/${t.id}`) }));
  const files = new Map(state.files.filter((f) => has(f.title)).slice(0, 4).map((f) => [f.id, f]));
  if (remote.q === ql) remote.files.forEach((f) => files.size < 6 && files.set(f.id, f));
  [...files.values()].forEach((f) => out.push({ group: 'Files', label: f.title, meta: f.kind, lead: icon(FILE_ICON[f.kind] || 'link'), run: () => openExternal(f.url) }));
  state.events
    .filter((e) => has(e.title))
    .sort((a, b) => Math.abs(a.start - Date.now()) - Math.abs(b.start - Date.now()))
    .slice(0, 3)
    .forEach((e) => out.push({ group: 'Calendar', label: e.title, meta: new Date(e.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), lead: icon('calendar'), run: () => openEvent(e.id) }));
  return out;
}

function render() {
  const q = input.value;
  results = build(q);
  sel = Math.min(sel, Math.max(0, results.length - 1));
  if (!results.length) {
    list.innerHTML = `<li class="finder__empty"><b>Nothing matches “${esc(q)}”</b><span>Try a task, a project or a name.</span></li>`;
    input.removeAttribute('aria-activedescendant');
    return;
  }
  let group = '';
  list.innerHTML = results
    .map((r, i) => {
      const head = r.group !== group ? `<li class="finder__group" role="presentation">${(group = r.group)}</li>` : '';
      return `${head}<li class="finder__opt" role="option" id="fo-${i}" data-i="${i}" aria-selected="${i === sel}">
        <span class="finder__lead">${r.lead}</span><span class="finder__label">${highlight(r.label, q.trim())}</span>
        ${r.meta ? `<span class="finder__meta">${esc(r.meta)}</span>` : ''}${icon('arrowRight', 'go')}</li>`;
    })
    .join('');
  input.setAttribute('aria-activedescendant', `fo-${sel}`);
}

function select(i, scroll = true) {
  sel = (i + results.length) % results.length;
  list.querySelectorAll('.finder__opt').forEach((o) => o.setAttribute('aria-selected', +o.dataset.i === sel));
  input.setAttribute('aria-activedescendant', `fo-${sel}`);
  if (scroll) list.querySelector(`#fo-${sel}`)?.scrollIntoView({ block: 'nearest' });
}

function run(i) {
  const r = results[i];
  if (!r) return;
  close().then(() => r.run());
}

export function openFinder() {
  if (dlg.open) return close();
  closePopover();
  input.value = '';
  sel = 0;
  render();
  dlg.showModal();
  const parts = dlg.querySelectorAll('.finder__bar, .finder__list');
  if (!reduced()) {
    gsap.fromTo(parts, { clipPath: 'inset(25% 25% 25% 25% round 26px)', y: -14, opacity: 0 }, { clipPath: 'inset(-30px round 26px)', y: 0, opacity: 1, duration: 0.55, ease: 'expo.out', stagger: 0.06, clearProps: 'clipPath,transform' });
    fadeUp(list.querySelectorAll('li'), { y: 8, stagger: 0.025, delay: 0.1, duration: 0.4 });
  }
  input.focus();
}

function close() {
  return new Promise((done) => {
    if (!dlg.open) return done();
    const finish = () => {
      dlg.close();
      gsap.set(dlg.querySelectorAll('.finder__bar, .finder__list'), { clearProps: 'all' });
      done();
    };
    if (reduced()) return finish();
    gsap.to(dlg.querySelectorAll('.finder__bar, .finder__list'), { clipPath: 'inset(30% 30% 30% 30% round 26px)', opacity: 0, duration: 0.16, ease: 'power2.in', onComplete: finish });
  });
}

function queueRemote() {
  clearTimeout(remoteTimer);
  const q = input.value.trim().toLowerCase();
  if (!LIVE || q.length < 3) return;
  const token = ++remoteToken;
  remoteTimer = setTimeout(async () => {
    const [mail, files] = await Promise.allSettled([searchMail(q, 5), searchFiles(q, 5)]);
    if (token !== remoteToken || !dlg.open) return;
    remote = { q, mail: mail.status === 'fulfilled' ? mail.value : [], files: files.status === 'fulfilled' ? files.value : [] };
    const keep = results[sel]?.label;
    render();
    const i = results.findIndex((r) => r.label === keep);
    if (i >= 0) select(i, false);
  }, 350);
}

export function initFinder() {
  dlg = document.getElementById('finder');
  input = document.getElementById('finder-q');
  list = document.getElementById('finder-list');
  input.addEventListener('input', () => {
    sel = 0;
    render();
    queueRemote();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) select(sel + (e.key === 'ArrowDown' ? 1 : -1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(sel);
    }
  });
  list.addEventListener('pointermove', (e) => {
    const o = e.target.closest('.finder__opt');
    if (o && +o.dataset.i !== sel) select(+o.dataset.i, false);
  });
  list.addEventListener('click', (e) => {
    const o = e.target.closest('.finder__opt');
    if (o) run(+o.dataset.i);
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('click', (e) => e.target === dlg && close());
}
