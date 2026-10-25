import './live/local.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

import { gsap, reduced, dur, moveLens, collapseOut, pressEffects, magnetic, bounceIcon } from './lib/motion.js';
import { qs, qsa, esc, icon, relTime } from './lib/dom.js';
import { glassify, trackGlint, refreshGlass } from './glass.js';
import { applyLook, setLook, getLook, onLook, resolvedTheme, wallpaperSvg } from './look.js';
import { state, commit, subscribe, me, openTasks, unreadCount, resetDemo, member } from './store.js';
import { ROUTES } from './routes.js';
import { avatar, enableLift } from './ui/components.js';
import { initIsland, notify } from './ui/island.js';
import { initFinder, openFinder } from './ui/finder.js';
import { openChat } from './ui/chat.js';
import {
  openPopover, closePopover, openMenu, openDrawer, confirm, collapseCard, focusedCard, newTask, newEvent, newProject, openTask, openEvent,
} from './ui/overlays.js';
import * as focus from './focus.js';
import { LIVE, startLive } from './live/index.js';
import { managePermissions, allow } from './live/runtime.js';
import { markNoticeRead, createEvent } from './live/sources.js';
import { startSessions, setNotifier } from './live/sessions.js';
import { initDock } from './ui/dock.js';
import { startGithub } from './live/github.js';

const html = document.documentElement;

// ---------- router ----------
const modules = new Map();
let current = null; // { name, page, view }
let navToken = 0;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const route = ROUTES.find((r) => r.name === parts[0]);
  return route ? { route, params: parts.slice(1) } : { route: ROUTES[0], params: [] };
}

const titleOf = (page, route, params) => (typeof page.title === 'function' ? page.title(params) : page.title || route.title);

function setActiveNav(name, animate) {
  qsa('[data-route]').forEach((a) => (a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const more = qs('#tab-more');
  const inMore = ['projects', 'files', 'insights', 'team', 'settings'].includes(name);
  more.toggleAttribute('data-current', inMore);
  inMore ? more.setAttribute('aria-current', 'page') : more.removeAttribute('aria-current');
  moveLens(qs('.nav__lens'), qs(`.nav__item[data-route="${name}"]`), { animate, axis: 'y' });
  moveLens(qs('.tabbar__lens'), inMore ? more : qs(`.tab[data-route="${name}"]`), { animate, axis: 'x' });
}

function setTitle(t) {
  document.title = `${t} · Lumen`;
  qs('#compact-title').textContent = t;
}

let titleObserver = null;
function watchTitle(view) {
  titleObserver?.disconnect();
  const h = qs('.head__title', view);
  html.classList.remove('is-scrolled');
  if (!h) return;
  titleObserver = new IntersectionObserver(([e]) => html.classList.toggle('is-scrolled', !e.isIntersecting && e.boundingClientRect.top < 40), { rootMargin: '-12px 0px 0px 0px' });
  titleObserver.observe(h);
}

async function navigate(initial = false) {
  const token = ++navToken;
  const { route, params } = parseHash();
  closePopover();
  if (focusedCard()) collapseCard();
  renderPinned();

  if (current?.name === route.name) {
    current.page.enter({ params, first: false, same: true });
    setTitle(titleOf(current.page, route, params));
    return;
  }

  let mod = modules.get(route.name);
  if (!mod) {
    try {
      mod = (await route.load()).page;
    } catch (err) {
      console.error(err);
      notify(`${route.title} couldn't load. Check your connection and try again.`, { ico: 'x', tone: 'warn' });
      return;
    }
    if (token !== navToken) return;
    modules.set(route.name, mod);
    mod.mount(qs(`[data-view="${route.name}"]`));
  }
  const view = qs(`[data-view="${route.name}"]`);
  const prev = current;
  prev?.page.leave?.();
  setActiveNav(route.name, !initial);
  setTitle(titleOf(mod, route, params));

  const swap = () => {
    if (token !== navToken) return;
    qsa('.view').forEach((v) => (v.hidden = v !== view));
    if (prev) gsap.set(qsa('.glass, .stat, .head__lead, .head__actions', prev.view), { clearProps: 'clipPath,opacity,transform' });
    scrollTo(0, 0);
    const first = !view.dataset.entered;
    current = { name: route.name, page: mod, view };
    mod.enter({ params, first, same: false });
    view.dataset.entered = '1';
    watchTitle(view);
    if (!initial) qs('.head__title', view)?.focus({ preventScroll: true });
  };

  if (prev && !reduced()) {
    gsap.to(qsa('.head__lead, .head__actions', prev.view), { opacity: 0, y: -8, duration: 0.18, ease: 'power2.in' });
    const visible = qsa('.glass, .stat', prev.view).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    collapseOut(visible, swap);
    if (!visible.length) setTimeout(swap, 180);
  } else swap();
}

// ---------- sidebar bits ----------
function renderPinned() {
  const open = parseHash();
  const pid = open.route.name === 'projects' ? open.params[0] : null;
  qs('.pinned').innerHTML = state.projects
    .filter((p) => p.starred)
    .slice(0, 5)
    .map((p) => `<li><a href="#/projects/${p.id}" class="hue--${p.hue}" ${p.id === pid ? 'aria-current="page"' : ''}><i></i><span>${esc(p.name)}</span></a></li>`)
    .join('');
  qs('#pinned-label').hidden = !qs('.pinned').children.length;
}

function renderCounts() {
  const n = openTasks(state.me).length;
  qs('#count-tasks').textContent = n || '';
  const inbox = qs('#count-inbox');
  if (inbox) inbox.textContent = state.unread ? (state.unread > 99 ? '99+' : state.unread) : '';
  const u = unreadCount();
  qs('#bell-badge').hidden = !u;
  qs('#btn-bell').setAttribute('aria-label', u ? `Notifications, ${u} unread` : 'Notifications');
}

function renderMe() {
  const m = me();
  // Settings may override what the connectors know about you.
  const name = state.settings.name || m.name || 'You';
  const role = state.settings.role || m.email || '';
  qs('.side__me').innerHTML = `${avatar(m.id, 'md', { presence: true })}<span class="side__who"><b>${esc(name)}</b><small>${esc(role)}</small></span>${icon('chevronDown')}`;
  qs('#btn-me-top').innerHTML = avatar(m.id, 'sm');
}

const SOURCES = [['calendar', 'Calendar'], ['gmail', 'Gmail'], ['drive', 'Drive'], ['workspace', 'Lumen data']];
function renderStatus() {
  const el = qs('#live-status');
  if (!LIVE) {
    el.hidden = false;
    el.className = 'side__status is-demo';
    el.innerHTML = `<i></i><span>Demo data</span>`;
    el.title = 'Open Lumen from claude.ai to use your own calendar, mail and files.';
    return;
  }
  const states = SOURCES.map(([k, label]) => [label, state.live[k]?.status || 'loading']);
  const bad = states.filter(([, st]) => st === 'error' || st === 'off');
  const loading = states.some(([, st]) => st === 'loading');
  el.hidden = false;
  el.className = `side__status ${bad.length ? 'is-warn' : loading ? 'is-sync' : 'is-live'}`;
  el.innerHTML = `<i></i><span>${bad.length ? `${bad.map(([l]) => l).join(', ')} need attention` : loading ? 'Syncing…' : 'Live'}</span>`;
  el.title = states.map(([l, st]) => `${l}: ${st}`).join('\n');
}

function themeLabel() {
  qs('#btn-theme').setAttribute('aria-label', `Switch to ${resolvedTheme() === 'dark' ? 'light' : 'dark'} theme`);
}

// ---------- global menus ----------
function createMenu(anchor) {
  const open = parseHash();
  const projectId = open.route.name === 'projects' ? open.params[0] : undefined;
  openMenu(anchor, [
    { label: 'New task', icon: 'tasks', onSelect: () => newTask({ projectId }) },
    { label: 'New event', icon: 'calendar', onSelect: () => newEvent({ projectId }) },
    { label: 'New project', icon: 'folder', onSelect: () => newProject() },
    '-',
    focus.isRunning()
      ? { label: 'Focus is running', icon: 'bolt', onSelect: () => {} }
      : { label: `Focus for ${state.settings.focusMinutes} min`, icon: 'bolt', onSelect: () => focus.start() },
  ], { align: 'end' });
}

function bellMenu(anchor) {
  const render = () => `<div class="notes"><div class="notes__head"><b>Notifications</b>
      <button type="button" class="btn btn--ghost btn--sm" data-all ${unreadCount() ? '' : 'disabled'}>Mark all read</button></div>
    <div class="notes__list">${state.notices.length ? '' : `<p class="notes__empty">${LIVE ? 'You’re all caught up.' : 'No notifications.'}</p>`}${state.notices
      .map((n) => `<a class="pop__row ${n.read ? '' : 'is-unread'}" href="${n.href}" data-id="${n.id}">${avatar(n.who, 'sm')}<span><b>${esc(member(n.who)?.name)}</b> ${esc(n.text)}<small>${relTime(n.at)}</small></span></a>`)
      .join('')}</div></div>`;
  const el = openPopover(anchor, render(), { cls: 'pop--wide', align: 'end', label: 'Notifications' });
  el?.addEventListener('click', (e) => {
    if (e.target.closest('[data-all]')) {
      state.notices.forEach((n) => (markNoticeRead(n.id), (n.read = true)));
      commit('notices');
      el.innerHTML = render();
      return;
    }
    const row = e.target.closest('.pop__row');
    if (row) {
      markNoticeRead(row.dataset.id);
      state.notices.find((n) => n.id === row.dataset.id).read = true;
      commit('notices');
      closePopover();
    }
  });
}

function meMenu(anchor, align) {
  const t = getLook().theme;
  openMenu(anchor, [
    { label: 'Settings', icon: 'gear', onSelect: () => (location.hash = '#/settings') },
    { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: shortcuts },
    '-',
    { label: 'Light', checked: t === 'light', onSelect: () => setLook({ theme: 'light' }) },
    { label: 'Dark', checked: t === 'dark', onSelect: () => setLook({ theme: 'dark' }) },
    { label: 'Match system', checked: t === 'system', onSelect: () => setLook({ theme: 'system' }) },
    '-',
    ...(LIVE
      ? [{ label: 'Connections & permissions', icon: 'link', onSelect: () => managePermissions().then((ok) => ok || (location.hash = '#/settings/connections')) }]
      : [{
          label: 'Reset demo data', icon: 'reset', danger: true,
          async onSelect() {
            if (!(await confirm('Reset demo data?', 'Every change you made will be replaced with fresh sample data.', 'Reset'))) return;
            resetDemo();
            notify('Demo data reset', { ico: 'reset' });
            setTimeout(() => location.reload(), 700);
          },
        }]),
  ], { align });
}

const KEYS = [
  ['⌘ K  or  /', 'Search'], ['N', 'Create menu'], ['T', 'New task'], ['F', 'Start focus'], ['G then H', 'Go home'], ['G then T', 'Go to tasks'],
  ['G then E', 'Go to inbox'], ['G then F', 'Go to files'], ['G then C', 'Go to calendar'], ['G then P', 'Go to projects'], ['G then I', 'Go to insights'], ['G then M', 'Go to people'], ['G then S', 'Go to settings'], ['⌘ J  or  A', 'Assistant'], ['?', 'This list'], ['Esc', 'Close'],
];
function shortcuts() {
  openDrawer(`<h2 class="dr-title">Keyboard shortcuts</h2><dl class="keys">${KEYS.map(([k, l]) => `<div><dt>${l}</dt><dd>${k.split('  ').map((p) => p.split(' ').map((x) => (x === 'or' || x === 'then' ? `<span class="faint">${x}</span>` : `<kbd>${x}</kbd>`)).join(' ')).join(' ')}</dd></div>`).join('')}</dl>`, { label: 'Keyboard shortcuts' });
}

function bindKeys() {
  let g = 0;
  const GO = { h: 'home', e: 'inbox', t: 'tasks', c: 'calendar', p: 'projects', f: 'files', i: 'insights', m: 'team', s: 'settings' };
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return openFinder();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      return openChat();
    }
    if (e.key === 'Escape' && focusedCard()) return collapseCard();
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || qs('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (Date.now() - g < 1200 && GO[k]) {
      g = 0;
      location.hash = `#/${GO[k]}`;
      return;
    }
    if (k === 'g') g = Date.now();
    else if (k === '/') {
      e.preventDefault();
      openFinder();
    } else if (k === 'n') createMenu(qs('#btn-new'));
    else if (k === 't') newTask();
    else if (k === 'a') openChat();
    else if (k === 'f' && !focus.isRunning()) focus.start();
    else if (e.key === '?') shortcuts();
  });
}

// ---------- boot ----------
function bindShell() {
  qs('#btn-search').addEventListener('click', openFinder);
  qs('#btn-search-m').addEventListener('click', (e) => {
    bounceIcon(e.currentTarget);
    openFinder();
  });
  qs('#btn-chat').addEventListener('click', openChat);
  qs('#btn-new').addEventListener('click', (e) => createMenu(e.currentTarget));
  qs('#btn-theme').addEventListener('click', (e) => {
    bounceIcon(e.currentTarget);
    setLook({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' });
  });
  qs('#btn-bell').addEventListener('click', (e) => bellMenu(e.currentTarget));
  qs('#btn-me').addEventListener('click', (e) => meMenu(e.currentTarget, 'start'));
  qs('#btn-me-top').addEventListener('click', (e) => meMenu(e.currentTarget, 'end'));
  qs('#tab-more').addEventListener('click', (e) =>
    openMenu(e.currentTarget, [
      { label: 'Projects', icon: 'folder', onSelect: () => (location.hash = '#/projects') },
      { label: 'Files', icon: 'layers', onSelect: () => (location.hash = '#/files') },
      { label: 'Insights', icon: 'chart', onSelect: () => (location.hash = '#/insights') },
      { label: 'People', icon: 'users', onSelect: () => (location.hash = '#/team') },
      { label: 'Settings', icon: 'gear', onSelect: () => (location.hash = '#/settings') },
    ], { align: 'end' }),
  );
  qs('.scrim').addEventListener('click', collapseCard);
  qs('#live-status').addEventListener('click', () => (location.hash = '#/settings/connections'));
  // Fix buttons rendered by sourceNote() anywhere in the app.
  document.addEventListener('click', async (e) => {
    const allowBtn = e.target.closest('[data-allow]');
    if (allowBtn) {
      const ok = await allow(allowBtn.dataset.allow);
      if (ok) location.reload();
      else notify('Allow it from the artifact’s Permissions menu in claude.ai', { ico: 'link', tone: 'info' });
    }
    if (e.target.closest('[data-permissions]')) managePermissions().then((ok) => ok || notify('Open the artifact’s Permissions menu in claude.ai', { ico: 'link', tone: 'info' }));
  });
  document.addEventListener('pane:task', (e) => openTask(e.detail));
  document.addEventListener('pane:event', (e) => openEvent(e.detail));

  const placeLenses = () => setActiveNav(current?.name ?? parseHash().route.name, false);
  new ResizeObserver(placeLenses).observe(qs('.nav__track'));
  new ResizeObserver(placeLenses).observe(qs('.tabbar__track'));
  new ResizeObserver(() => html.style.setProperty('--tools-w', `${qs('.toolbar__tools').offsetWidth}px`)).observe(qs('.toolbar__tools'));
}

function intro() {
  if (reduced()) return;
  const tl = gsap.timeline();
  tl.fromTo('.side', { clipPath: 'inset(10% 30% 10% 30% round 32px)', x: -30, opacity: 0 }, { clipPath: 'inset(-40px round 32px)', x: 0, opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'clipPath,transform,opacity' }, 0);
  tl.fromTo('.brand, .nav__item, .side__group, .side__me', { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', stagger: 0.035, clearProps: 'all' }, 0.15);
  tl.fromTo('.toolbar__tools, .tabbar > *', { clipPath: 'inset(20% 20% 20% 20% round 999px)', y: -16, opacity: 0 }, { clipPath: 'inset(-30px round 999px)', y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', clearProps: 'all' }, 0.1);
}

async function boot() {
  applyLook();
  qs('.wall').innerHTML = wallpaperSvg('w');
  themeLabel();
  onLook(() => {
    themeLabel();
    refreshGlass();
  });
  renderCounts();
  renderMe();
  renderPinned();
  subscribe('tasks', renderCounts);
  subscribe('notices', renderCounts);
  subscribe('projects', renderPinned);
  subscribe('settings', renderMe);
  subscribe('members', renderMe);
  subscribe('threads', renderCounts);
  subscribe('live', renderStatus);
  renderStatus();
  // Optional: mirror focus sessions as "Focus time" in Google Calendar.
  focus.onFocus('start', (s) => {
    if (!LIVE || !state.settings.blockFocusTime) return;
    createEvent({ title: s.task ? `Focus: ${s.task.title}` : 'Focus', start: s.started, end: s.started + s.minutes * 60000, kind: 'focus' }).catch(() => {});
  });
  startLive();
  setNotifier(notify);
  initDock();
  startSessions();
  // GitHub rides on the bridge: load it each time the bridge comes (back) up.
  // startGithub() stops its own refresh timer while the bridge is down.
  let bridgeWas = state.bridge?.status;
  subscribe('bridge', () => {
    const now = state.bridge.status;
    if (now !== bridgeWas && (now === 'ok' || bridgeWas === 'ok')) startGithub();
    bridgeWas = now;
  });
  bindShell();
  bindKeys();
  initFinder();
  initIsland();
  magnetic();
  glassify();
  trackGlint();
  pressEffects();

  if (!location.hash) history.replaceState(null, '', '#/home');
  await document.fonts.ready;
  html.classList.add('is-ready');
  intro();
  setTimeout(() => navigate(true), reduced() ? 0 : 120);
  addEventListener('hashchange', () => navigate(false));
  setTimeout(enableLift, 1400);
}

// Dev-only handle for inspecting/advancing animations from devtools.
if (import.meta.env.DEV) window.__gsap = gsap;

boot();
