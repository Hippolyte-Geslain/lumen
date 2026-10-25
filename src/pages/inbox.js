// Inbox: the latest Gmail threads with category filters, keyboard triage and a
// reading pane (a right column on wide screens, the shared drawer below).
// Lumen never sends mail: replies are saved as Gmail drafts.
import '../styles/pages/inbox.css';

import { gsap, reduced, dur, revealCards, fadeUp, flipList, countTo, popIn, bounceIcon } from '../lib/motion.js';
import { esc, icon, initials, relTime, fmtTime, dayLabel, startOfDay, addDays, uid } from '../lib/dom.js';
import { state, subscribe, commit, member, logActivity, activeBoard } from '../store.js';
import { pageHead, headIntro, card, avatar, segmented, bindSegmented, iconBtn, sourceNote, sourceReady } from '../ui/components.js';
import { openDrawer, closeDrawer, liveAction, notify } from '../ui/overlays.js';
import { LIVE, SERVERS, invalidate, explain } from '../live/runtime.js';
import * as gmail from '../live/sources.js';
import { isBot, parseAddress } from '../live/people.js';
import { aiAvailable, ask, replyPrompt, summarizePrompt, aiErrorText } from '../live/ai.js';

// ---------- module state ----------
const DEMO = !LIVE || state.demo;
const GMAIL = SERVERS.gmail;
const CATS = [['personal', 'Primary'], ['updates', 'Updates'], ['promotions', 'Promotions'], ['social', 'Social'], ['all', 'All']];
const catName = (c) => CATS.find(([v]) => v === c)?.[1] ?? 'All';
const wideMq = matchMedia('(min-width: 1101px)');
const wide = () => wideMq.matches;

let root;
let dirty = false;
let aiOk = false;
let typing = null;
let refreshing = null; // timeout id while a refresh is in flight
let zeroShown = false;
let lastG = 0;
let leaving = false;
const filter = { cat: 'personal', unread: false, q: '' };
let remote = null; // Gmail search results: { q, list, loading, error }
let shownIds = [];
let selId = null; // keyboard cursor
let openId = null; // thread in the reading pane
let cur = null; // reading-pane state for openId
let drawerHost = null;
let switching = false; // moving the reader between drawer and column
const summaries = new Map();
const els = {};

// ---------- people ----------
const HUES = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo'];
const hueOf = (s) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

function nameOf(id, email = '') {
  if (id === 'me') return 'me';
  return member(id)?.name || email || 'Unknown sender';
}

/** Member avatar, or initials from the address when the member has no name yet. */
function face(id, email = '', size = 'md') {
  const m = member(id);
  if (m?.name) return avatar(id, size);
  const label = email || '?';
  const letters = initials(label.split('@')[0].replace(/[._+-]+/g, ' ').trim() || '?');
  return `<span class="av av--${size} hue--${hueOf(label)}" title="${esc(label)}">${esc(letters)}</span>`;
}

const botSender = (t) => t.from === 'me' || (member(t.from)?.bot ?? isBot(t.fromEmail || ''));
const needsReply = (t) => t.unread && t.important && !botSender(t);

// ---------- data ----------
const findThread = (id) => state.threads.find((t) => t.id === id) || remote?.list.find((t) => t.id === id) || null;

function hay(t) {
  return `${t.subject} ${t.snippet} ${nameOf(t.from, t.fromEmail)} ${t.fromEmail}`.toLowerCase();
}

function visible() {
  if (remote) return remote.list.filter((t) => !filter.unread || t.unread);
  const q = filter.q.toLowerCase();
  return state.threads.filter((t) => (filter.cat === 'all' || t.category === filter.cat) && (!filter.unread || t.unread) && (!q || hay(t).includes(q)));
}

function stats() {
  const ts = state.threads;
  const sod = startOfDay().getTime();
  return {
    unread: Math.max(state.unread || 0, ts.filter((t) => t.unread).length),
    reply: ts.filter(needsReply).length,
    today: ts.filter((t) => t.at >= sod).length,
  };
}

function subText(s) {
  if (!sourceReady('gmail')) return 'Loading your mail…';
  if (!s.unread) return 'Everything is read';
  return `${s.unread} unread${s.reply ? ` · ${s.reply} may need a reply` : ''}`;
}

const loadingList = () => !remote && !state.threads.length && (state.live.gmail?.status === 'loading' || !state.live.gmail);

// ---------- markup ----------
const STAR = icon('star');

function rowHtml(t) {
  const name = nameOf(t.from, t.fromEmail);
  const sel = t.id === selId;
  const tab = sel ? 0 : -1;
  const cls = `ib-row${t.unread ? ' is-unread' : ''}${sel ? ' is-sel' : ''}${t.id === openId ? ' is-open' : ''}`;
  const at = t.at ? `<time class="ib-row__time" datetime="${new Date(t.at).toISOString()}" title="${esc(new Date(t.at).toLocaleString())}">${esc(relTime(t.at))}</time>` : '';
  return `<li class="${cls}" data-key="${esc(t.id)}">
    <button type="button" class="ib-row__open" data-open tabindex="${tab}" aria-describedby="ib-help"${t.id === openId ? ' aria-current="true"' : ''}>
      ${face(t.from, t.fromEmail, 'md')}
      <span class="ib-row__main">
        <span class="ib-row__top"><span class="ib-row__from">${esc(name)}</span>${t.count > 1 ? `<span class="ib-row__count">${t.count}</span>` : ''}${
          needsReply(t) ? '<span class="ib-row__flag" title="Important">Important</span>' : ''
        }${at}</span>
        <span class="ib-row__subj">${esc(t.subject)}</span>
        <span class="ib-row__snip">${esc(t.snippet)}</span>
      </span>
      <span class="sr">${t.unread ? ', unread' : ''}${t.starred ? ', starred' : ''}</span>
    </button>
    <span class="ib-row__acts">
      ${t.inbox ? `<button type="button" class="ibtn ibtn--sm" data-arch tabindex="${tab}" aria-label="Archive “${esc(t.subject)}”" title="Archive (e)">${icon('download')}</button>` : ''}
      <button type="button" class="ibtn ibtn--sm" data-read tabindex="${tab}" aria-label="Mark “${esc(t.subject)}” as ${t.unread ? 'read' : 'unread'}" title="Mark as ${t.unread ? 'read' : 'unread'} (u)">${icon(t.unread ? 'check' : 'mail')}</button>
    </span>
    <button type="button" class="ib-star" data-star tabindex="${tab}" aria-pressed="${!!t.starred}" aria-label="Star “${esc(t.subject)}”" title="Star (s)">${STAR}</button>
  </li>`;
}

function skelRows(n = 7) {
  return Array.from({ length: n }, (_, i) => `<li class="ib-row ib-row--skel" aria-hidden="true"><div class="ib-row__open">
      <span class="skel ib-sk-av"></span><span class="ib-row__main">
        <span class="skel ib-sk-line" style="width:${32 + ((i * 17) % 30)}%"></span>
        <span class="skel ib-sk-line" style="width:${58 + ((i * 23) % 34)}%"></span>
        <span class="skel ib-sk-line ib-sk-line--faint" style="width:${70 + ((i * 11) % 25)}%"></span></span></div></li>`).join('');
}

function shell() {
  const s = stats();
  const head = pageHead({
    title: 'Inbox',
    sub: `<span data-sub>${esc(subText(s))}</span>`,
    actions: `<a class="btn btn--glass" href="https://mail.google.com" target="_blank" rel="noopener">${icon('mail')}Open Gmail</a>${iconBtn('reset', 'Refresh inbox', 'data-act="refresh"', 'ibtn--glass ib-refresh')}`,
    stats: [
      { label: 'Unread', value: s.unread },
      { label: 'Needs reply', value: s.reply },
      { label: 'Today', value: s.today },
    ],
  });

  const bar = `<div class="ib-bar glass" role="group" aria-label="Filter mail">
    ${segmented('Category', CATS.map(([v, l]) => [v, `<span>${l}</span><small class="ib-seg__n" data-n="${v}"></small>`]), filter.cat, 'ib-cats')}
    <button type="button" class="ib-chip" data-act="unread" aria-pressed="${filter.unread}">${icon('eye')}<span>Unread only</span></button>
    <label class="ib-find">${icon('search')}<span class="sr">Filter loaded mail, or press Enter to search Gmail</span>
      <input type="search" class="ib-find__input" placeholder="Filter, or Enter to search Gmail" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
  </div>`;

  const list = card({
    cls: 'ib-list',
    title: 'Conversations',
    sub: '<span data-list-sub></span>',
    body: `<div data-note></div>
      <div class="ib-results" data-results hidden></div>
      <ul class="ib-rows" data-rows aria-label="Conversations"></ul>
      <div data-empty hidden></div>
      <p class="sr" id="ib-help">J and K move between conversations, Enter opens, E archives, S stars, U marks read or unread.</p>`,
  });

  return `${head}<div class="ib">${bar}<div class="ib-main">${list}
    <section class="card glass ib-reader" aria-label="Reading pane"><div class="ib-reader__body" data-reader></div></section></div></div>`;
}

function demoShell() {
  const feats = [
    ['filter', 'Primary, Updates, Promotions and Social at a glance'],
    ['keyboard', 'Triage from the keyboard: j, k, e, s and u'],
    ['sparkle', 'Summaries and reply drafts written by Claude'],
    ['tasks', 'Turn any email into a task in one click'],
  ];
  return `${pageHead({
    title: 'Inbox',
    sub: 'Your Gmail, triaged',
    actions: `<a class="btn btn--glass" href="https://mail.google.com" target="_blank" rel="noopener">${icon('mail')}Open Gmail</a>`,
  })}
  <section class="card glass ib-demo">
    <span class="ib-demo__art" aria-hidden="true">${icon('mail')}</span>
    <div class="ib-demo__text">
      <h2>Inbox shows your Gmail</h2>
      <p>Open Lumen from claude.ai with the Gmail connector and this page fills with your latest conversations. Replies are saved to your Gmail drafts, and Lumen never sends mail on its own.</p>
      <ul class="ib-demo__list">${feats.map(([i, t]) => `<li>${icon(i)}<span>${esc(t)}</span></li>`).join('')}</ul>
      <p class="faint">This demo has no mailbox, so there’s nothing to show here.</p>
    </div>
  </section>`;
}

// ---------- header / bar ----------
function renderHead(animate) {
  const s = stats();
  els.sub.textContent = subText(s);
  [s.unread, s.reply, s.today].forEach((v, i) => {
    const b = els.stats[i].querySelector('b');
    if (+b.dataset.count === v) return;
    b.dataset.count = v;
    countTo(b, v);
    if (animate) flash(els.stats[i]);
  });
  // Unread count per category on the segmented control.
  for (const [v] of CATS) {
    const n = state.threads.filter((t) => t.unread && (v === 'all' || t.category === v)).length;
    const el = els.bar.querySelector(`[data-n="${v}"]`);
    el.textContent = n ? (n > 99 ? '99+' : n) : '';
  }
}

function flash(el) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

function renderNote() {
  els.note.innerHTML = sourceNote('gmail');
}

// ---------- list ----------
/** mode: 'flip' (data changed), 'fade' (filter changed) or '' (no motion). */
function renderList(mode = '') {
  const list = visible();
  const loading = loadingList() || !!remote?.loading;
  const ids = list.map((t) => t.id);

  // Keep the cursor valid: a vanished row hands it to its neighbour.
  if (!ids.includes(selId)) {
    const at = shownIds.indexOf(selId);
    selId = ids.length ? ids[Math.min(Math.max(at, 0), ids.length - 1)] : null;
  }
  const focusIn = els.rows.contains(document.activeElement);
  const focusKind = focusIn ? ['data-star', 'data-arch', 'data-read'].find((a) => document.activeElement.hasAttribute(a)) || 'data-open' : null;
  const focusKey = focusIn ? document.activeElement.closest('[data-key]')?.dataset.key : null;

  const html = loading ? skelRows() : list.map(rowHtml).join('');
  const mutate = () => (els.rows.innerHTML = html);
  const hadRows = !!els.rows.querySelector('[data-key]');
  if (mode === 'flip' && hadRows && !loading) flipList(els.rows, mutate);
  else mutate();
  els.rows.setAttribute('aria-busy', loading);
  shownIds = loading ? [] : ids;

  if (focusIn) {
    const key = focusKey === selId || ids.includes(focusKey) ? focusKey : selId;
    const row = key && rowEl(key);
    (row?.querySelector(`[${focusKind}]`) || row?.querySelector('[data-open]'))?.focus({ preventScroll: true });
  }

  if (mode === 'fade' && !loading) fadeUp([...els.rows.children].slice(0, 14), { y: 10, stagger: 0.022, duration: 0.42 });

  renderResults();
  renderEmpty(list, loading);
  els.listSub.textContent = loading
    ? 'Loading…'
    : remote
      ? `${list.length} result${list.length === 1 ? '' : 's'} from Gmail`
      : `${list.length} in ${filter.cat === 'all' ? 'your inbox' : catName(filter.cat)}${filter.unread ? ', unread' : ''}`;
}

function renderResults() {
  els.results.hidden = !remote;
  if (!remote) return;
  els.results.innerHTML = `${icon('search')}<span>Results for <b>“${esc(remote.q)}”</b></span>
    <button type="button" class="ib-clear" data-act="clear-search">${icon('x')}Clear search</button>`;
}

function renderEmpty(list, loading) {
  const box = els.empty;
  const show = !loading && !list.length && !(state.live.gmail?.status === 'error' && !state.threads.length && !remote);
  box.hidden = !show;
  if (!show) {
    zeroShown = false;
    return;
  }
  if (remote?.error) {
    box.innerHTML = `<div class="empty">${icon('bolt')}<b>Search didn’t work</b><span>${esc(remote.error)}</span>
      <button type="button" class="btn btn--glass btn--sm" data-act="retry-search">Try again</button></div>`;
    return;
  }
  if (remote) {
    box.innerHTML = `<div class="empty">${icon('search')}<b>No results in Gmail</b><span>Nothing matched “${esc(remote.q)}”. Gmail search operators like from: or has:attachment work here.</span></div>`;
    return;
  }
  const filtered = filter.q || filter.unread || (filter.cat !== 'all' && state.threads.length);
  if (!state.threads.length || (!filter.q && filter.unread && !state.threads.some((t) => t.unread))) {
    const all = !state.threads.length;
    box.innerHTML = `<div class="ib-zero"><span class="ib-zero__sun" aria-hidden="true">${icon(all ? 'sun' : 'check')}</span>
      <b>${all ? 'Inbox zero' : 'All caught up'}</b><span>${all ? 'Nothing left in your inbox. Enjoy the quiet.' : 'No unread mail left. Nice work.'}</span></div>`;
    if (!zeroShown) celebrate(box.querySelector('.ib-zero'));
    zeroShown = true;
    return;
  }
  zeroShown = false;
  if (filtered) {
    const where = filter.cat === 'all' ? 'your inbox' : catName(filter.cat);
    box.innerHTML = `<div class="empty">${icon(filter.q ? 'search' : 'filter')}<b>Nothing here</b><span>${
      filter.q ? `No loaded conversation in ${esc(where)} matches “${esc(filter.q)}”. Press Enter to search all of Gmail.` : `No ${filter.unread ? 'unread ' : ''}conversations in ${esc(where)}.`
    }</span><button type="button" class="btn btn--glass btn--sm" data-act="clear-filters">Show all mail</button></div>`;
  }
}

function celebrate(el) {
  if (!el || reduced()) return;
  const sun = el.querySelector('.ib-zero__sun');
  popIn(sun);
  gsap.fromTo(sun.querySelector('svg'), { rotate: -90 }, { rotate: 0, duration: 1.2, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
  fadeUp(el.querySelectorAll('b, span:not(.ib-zero__sun)'), { y: 8, delay: 0.15 });
}

const rowEl = (id) => els.rows.querySelector(`.ib-row[data-key="${CSS.escape(id)}"]`);

/** Move the cursor without re-rendering rows (roving tabindex). */
function setSel(id, { focus = false } = {}) {
  selId = id;
  els.rows.querySelectorAll('.ib-row[data-key]').forEach((row) => {
    const on = row.dataset.key === id;
    row.classList.toggle('is-sel', on);
    row.classList.toggle('is-open', row.dataset.key === openId);
    const open = row.querySelector('[data-open]');
    if (row.dataset.key === openId) open.setAttribute('aria-current', 'true');
    else open.removeAttribute('aria-current');
    row.querySelectorAll('button').forEach((b) => (b.tabIndex = on ? 0 : -1));
  });
  if (focus) {
    const row = id && rowEl(id);
    row?.querySelector('[data-open]').focus();
    row?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
}

function step(delta) {
  if (!shownIds.length) return;
  const i = shownIds.indexOf(selId);
  const next = delta === Infinity ? shownIds.length - 1 : delta === -Infinity ? 0 : Math.max(0, Math.min(shownIds.length - 1, (i < 0 ? 0 : i) + delta));
  setSel(shownIds[next], { focus: true });
}

// ---------- actions ----------
async function setRead(t, read) {
  if (!t || t.unread === !read) return;
  // sources.js rolls the change back itself if Gmail refuses.
  await liveAction(() => gmail.markRead(t, read), { server: GMAIL, ico: 'mail' });
}

async function toggleStar(t) {
  if (!t) return;
  const on = !t.starred;
  await liveAction(() => gmail.star(t, on), { server: GMAIL, ico: 'star' });
}

function putBack(t) {
  if (!state.threads.some((x) => x.id === t.id)) {
    state.threads.push(t);
    state.threads.sort((a, b) => b.at - a.at);
  }
  commit('threads');
}

async function doArchive(t) {
  if (!t?.inbox) return;
  const i = shownIds.indexOf(t.id);
  const nextId = shownIds[i + 1] ?? shownIds[i - 1] ?? null;
  const wasOpen = openId === t.id;
  const row = rowEl(t.id);
  if (row && !reduced()) await gsap.to(row, { opacity: 0, x: 36, duration: 0.2, ease: 'power2.in' });
  if (selId === t.id) selId = nextId;
  if (remote) remote.list = remote.list.filter((x) => x.id !== t.id);
  if (wasOpen) {
    if (wide() && nextId) openDeep(nextId);
    else closeReader();
  }
  const ok = await liveAction(() => gmail.archive(t), {
    server: GMAIL,
    ico: 'download',
    done: 'Archived',
    undo: () => {
      putBack(t);
      liveAction(() => gmail.unarchive(t), { server: GMAIL, ico: 'mail', done: 'Moved back to the inbox' });
    },
  });
  if (!ok) putBack(t);
}

function makeTask(t) {
  const due = addDays(startOfDay(), 1);
  due.setHours(17, 0, 0, 0);
  const proj = state.projects.find((p) => p.status !== 'done') || state.projects[0] || null;
  const sender = nameOf(t.from, t.fromEmail);
  const title = (t.subject || 'Follow up on email').slice(0, 200);
  const task = {
    id: uid('t'), title, projectId: proj?.id ?? null, status: 'todo', priority: 'medium', assignee: state.me,
    due: due.getTime(), created: Date.now(), doneAt: null, est: 1,
    order: Math.min(0, ...state.tasks.filter((x) => x.order < 1000).map((x) => x.order)) - 1 - Math.random() * 0.01,
    boardId: activeBoard().id, subtasks: [], comments: [],
    source: { kind: 'mail', threadId: t.id, messageId: t.lastMessageId },
    notes: `From ${sender}${t.fromEmail && sender !== t.fromEmail ? ` <${t.fromEmail}>` : ''}\nOpen in Gmail: ${t.url || 'https://mail.google.com'}`,
  };
  state.tasks.push(task);
  logActivity('task', `added “${title}” from Gmail`, task.projectId);
  commit('tasks', 'activity');
  notify(`Task added · due tomorrow`, {
    ico: 'tasks',
    undo: () => {
      const i = state.tasks.indexOf(task);
      if (i >= 0) state.tasks.splice(i, 1);
      commit('tasks');
    },
  });
}

// The spinner runs until Gmail reports back (or 12 s pass).
let refreshArmed = false;
let refreshBtn = null;
function stopRefresh() {
  clearTimeout(refreshing);
  refreshing = null;
  refreshArmed = false;
  refreshBtn?.classList.remove('is-spin');
  refreshBtn?.removeAttribute('aria-busy');
}

async function refresh(btn) {
  if (refreshing) return;
  refreshBtn = btn;
  btn?.classList.add('is-spin');
  btn?.setAttribute('aria-busy', 'true');
  refreshing = setTimeout(stopRefresh, 12_000);
  try {
    await gmail.refreshGmail(); // the inbox watch redelivers; no loading flash
    refreshArmed = true;
  } catch {
    stopRefresh();
  }
  if (remote && !remote.loading) runSearch(remote.q);
}

// ---------- search ----------
async function runSearch(q) {
  remote = { q, list: [], loading: true, error: '' };
  renderList();
  const mine = remote;
  try {
    const list = await gmail.searchMail(q, 20);
    if (remote !== mine) return;
    remote.list = list.sort((a, b) => b.at - a.at);
  } catch (err) {
    if (remote !== mine) return;
    remote.error = explain(err, GMAIL).text;
  }
  remote.loading = false;
  renderList('fade');
}

function clearSearch({ focus = true } = {}) {
  remote = null;
  typing?.kill();
  filter.q = '';
  els.search.value = '';
  renderList('fade');
  if (focus) els.search.focus();
}

// ---------- reading pane ----------
function openDeep(id) {
  const target = `#/inbox/${encodeURIComponent(id)}`;
  if (location.hash !== target) location.hash = target;
  else openThread(id);
}

function pseudoThread(id, msgs) {
  const first = msgs[0] || {};
  const last = msgs[msgs.length - 1] || {};
  return {
    id, subject: first.subject || last.subject || '(no subject)', snippet: '', from: last.from, fromEmail: parseAddress(last.fromRaw || '').email,
    at: last.at || 0, count: msgs.length, unread: false, important: false, starred: false, inbox: false, category: 'personal',
    url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`, lastMessageId: last.id,
  };
}

function openThread(id) {
  if (cur?.id === id) return showReader();
  stopAi(cur);
  const t = findThread(id);
  cur = {
    id, t, msgs: null, err: '', expanded: new Set(), showAll: false,
    composing: false, draft: '', drafting: false, ctrl: null,
    summary: summaries.get(id) || '', summarizing: false, sumErr: '', sumCtrl: null,
  };
  openId = id;
  if (shownIds.includes(id)) setSel(id);
  else setSel(selId);
  showReader();
  loadThread(cur);
  if (t?.unread) setRead(t, true);
}

async function loadThread(c) {
  try {
    const msgs = await gmail.readThread(c.id);
    if (cur !== c) return;
    c.msgs = msgs;
    if (!c.t) c.t = pseudoThread(c.id, msgs);
    c.err = '';
  } catch (err) {
    if (cur !== c) return;
    c.err = explain(err, GMAIL).text;
  }
  paintReader();
  // Focus the subject in the drawer so screen readers start at the top.
  if (!wide() && host()) host().querySelector('.ib-read__subj')?.focus({ preventScroll: true });
}

function host() {
  if (wide()) return els.reader;
  return drawerHost?.isConnected ? drawerHost : null;
}

function showReader() {
  if (wide()) return paintReader();
  if (host()) return paintReader();
  openDrawer('', {
    label: 'Email',
    onMount(body) {
      drawerHost = body;
      body.classList.add('ib-drawer');
      bindReader(body);
      paintReader();
    },
    onClose() {
      drawerHost = null;
      if (switching) return;
      const was = openId;
      stopAi(cur);
      cur = null;
      openId = null;
      if (location.hash.startsWith('#/inbox/')) history.replaceState(null, '', '#/inbox');
      if (!root || root.hidden || leaving) return;
      setSel(selId);
      if (was && rowEl(was)) setSel(was, { focus: true });
    },
  });
}

function closeReader() {
  stopAi(cur);
  cur = null;
  openId = null;
  if (location.hash.startsWith('#/inbox/')) history.replaceState(null, '', '#/inbox');
  if (drawerHost?.isConnected) closeDrawer();
  if (els.reader) paintReader();
  setSel(selId);
}

function stopAi(c) {
  c?.ctrl?.abort();
  c?.sumCtrl?.abort();
}

function subjectFor(c) {
  return c.t?.subject || c.msgs?.[0]?.subject || '';
}

function readerHtml(c) {
  if (!c) {
    return `<div class="ib-pick">${icon('mail')}<b>No conversation open</b><span>Pick one from the list, or use J and K then Enter.</span></div>`;
  }
  const subj = subjectFor(c);
  return `<article class="ib-read" aria-busy="${!c.msgs && !c.err}">
    <header class="ib-read__head">
      <h2 class="ib-read__subj" tabindex="-1">${subj ? esc(subj) : '<span class="skel ib-sk-title"></span><span class="sr">Loading</span>'}</h2>
      <div class="ib-read__tools" data-part="tools">${toolsHtml(c)}</div>
    </header>
    <div class="ib-read__acts" data-part="acts">${actsHtml(c)}</div>
    <div data-part="sum">${sumHtml(c)}</div>
    <div data-part="msgs">${msgsHtml(c)}</div>
    <div data-part="compose">${composeHtml(c)}</div>
  </article>`;
}

function toolsHtml(c) {
  const t = c.t;
  if (!t) return '';
  return `<button type="button" class="ib-star ib-star--inline" data-r="star" aria-pressed="${!!t.starred}" aria-label="Star this conversation">${STAR}</button>
    ${t.inbox ? iconBtn('download', 'Archive', 'data-r="archive"', 'ibtn--sm') : ''}
    ${iconBtn('mail', 'Mark as unread', 'data-r="unread"', 'ibtn--sm')}`;
}

function actsHtml(c) {
  const ready = !!c.msgs?.length;
  const t = c.t;
  return `<button type="button" class="btn btn--sm btn--accent" data-r="reply" ${ready ? '' : 'disabled'}>${icon('message')}Reply</button>
    ${aiOk ? `<button type="button" class="btn btn--sm btn--glass" data-r="ai" ${ready ? '' : 'disabled'} aria-pressed="${c.drafting}">${icon('sparkle')}${c.drafting ? 'Stop drafting' : 'Draft with Claude'}</button>` : ''}
    ${aiOk ? `<button type="button" class="btn btn--sm btn--glass" data-r="sum" ${ready && !c.summarizing ? '' : 'disabled'}>${icon('bolt')}Summarize</button>` : ''}
    <button type="button" class="btn btn--sm btn--glass" data-r="task" ${t ? '' : 'disabled'}>${icon('tasks')}Make a task</button>
    ${t?.url ? `<a class="btn btn--sm btn--ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${icon('link')}Open in Gmail</a>` : ''}`;
}

function sumText(s) {
  return esc(s).replace(/^(Next:)/m, '<b>$1</b>');
}

function sumHtml(c) {
  if (!c.summary && !c.summarizing && !c.sumErr) return '';
  const body = c.sumErr ? `<p class="ib-sum__text">${esc(c.sumErr)}</p>` : `<p class="ib-sum__text" data-sumtext>${c.summary ? sumText(c.summary) : '<span class="ib-dots" aria-label="Thinking"><i></i><i></i><i></i></span>'}</p>`;
  return `<aside class="ib-sum" aria-live="polite" aria-label="Summary by Claude">
    <div class="ib-sum__head">${icon('sparkle')}<b>Summary</b>${iconBtn('x', 'Hide summary', 'data-r="sum-close"', 'ibtn--sm')}</div>${body}</aside>`;
}

function msgsHtml(c) {
  if (c.err) {
    return `<div class="src-note src-note--warn" role="alert">${icon('bolt')}<span>${esc(c.err)}</span><button type="button" class="btn btn--sm btn--glass" data-r="retry">Try again</button></div>`;
  }
  if (!c.msgs) {
    return `<div class="ib-msgs-skel" aria-hidden="true">${[0, 1].map(() => `<div class="ib-msg"><div class="ib-msg__head"><span class="skel ib-sk-av ib-sk-av--sm"></span><span class="skel ib-sk-line" style="width:38%"></span></div>
      <span class="skel ib-sk-line" style="width:92%;margin-top:14px"></span><span class="skel ib-sk-line" style="width:84%"></span><span class="skel ib-sk-line" style="width:60%"></span></div>`).join('')}</div>`;
  }
  const ms = c.msgs;
  if (!ms.length) return `<div class="empty">${icon('mail')}<b>This conversation is empty</b><span>It may have been deleted in Gmail.</span></div>`;
  const n = ms.length;
  const hideMid = n > 4 && !c.showAll;
  let out = '';
  ms.forEach((m, i) => {
    if (hideMid && i > 0 && i < n - 2) {
      if (i === 1) out += `<li class="ib-more-wrap"><button type="button" class="ib-more" data-r="all">${n - 3} earlier messages</button></li>`;
      return;
    }
    out += msgHtml(m, i === n - 1, c.expanded.has(m.id));
  });
  return `<ol class="ib-msgs" aria-label="${n} message${n === 1 ? '' : 's'}">${out}</ol>`;
}

function msgHtml(m, last, expanded) {
  const email = parseAddress(m.fromRaw || '').email;
  const name = nameOf(m.from, email);
  const open = last || expanded;
  const when = m.at ? `<time datetime="${new Date(m.at).toISOString()}" title="${esc(new Date(m.at).toLocaleString())}">${esc(`${dayLabel(m.at)}, ${fmtTime(m.at)}`)}</time>` : '';
  const who = `<span class="ib-msg__who"><b>${esc(name === 'me' ? 'Me' : name)}</b><small>${open ? esc(email) : esc(peek(m.body))}</small></span>`;
  const head = `${face(m.from, email, 'sm')}${who}${when}`;
  if (!open) {
    return `<li class="ib-msg is-collapsed"><button type="button" class="ib-msg__head" data-r="expand" data-id="${esc(m.id)}" aria-expanded="false">${head}</button></li>`;
  }
  const top = last ? `<div class="ib-msg__head">${head}</div>` : `<button type="button" class="ib-msg__head" data-r="expand" data-id="${esc(m.id)}" aria-expanded="true">${head}</button>`;
  const atts = m.attachments?.length
    ? `<ul class="ib-atts" aria-label="Attachments">${m.attachments.map((a) => `<li title="Open in Gmail to download">${icon('layers')}<span>${esc(a)}</span></li>`).join('')}</ul>`
    : '';
  return `<li class="ib-msg${last ? ' is-last' : ''}">${top}<div class="ib-msg__body">${bodyHtml(m.body)}</div>${atts}</li>`;
}

// Plain-text bodies: escape, keep line breaks (CSS pre-wrap), link URLs and
// fold the quoted history of earlier replies.
const QUOTE_HEAD = /^\s*(On\s.+wrote:|Le\s.+a\s+écrit\s*:|-{2,}\s*(Original Message|Message d'origine|Forwarded message)\s*-{2,})\s*$/i;

function bodyHtml(raw = '') {
  const text = String(raw).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = text.split('\n');
  const cut = lines.findIndex(
    (l, i) => i > 0 && (QUOTE_HEAD.test(l) || QUOTE_HEAD.test(`${l} ${lines[i + 1] || ''}`) || (/^>/.test(l) && lines.slice(i).every((x) => /^>|^\s*$/.test(x)))),
  );
  const main = cut > 0 ? lines.slice(0, cut).join('\n').trimEnd() : text;
  const quoted = cut > 0 ? lines.slice(cut).join('\n') : '';
  return `<div class="ib-text">${main ? linkify(main) : '<span class="faint">(no text)</span>'}</div>${
    quoted ? `<details class="ib-quote"><summary><span aria-hidden="true">•••</span><span class="sr">Show quoted text</span></summary><div class="ib-text ib-text--quoted">${linkify(quoted)}</div></details>` : ''
  }`;
}

function linkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => {
    let url = u;
    let tail = '';
    const stop = url.search(/&(quot|#39|lt|gt);/);
    if (stop >= 0) {
      tail = url.slice(stop);
      url = url.slice(0, stop);
    }
    const punct = url.match(/[).,;:!?\]]+$/);
    if (punct) {
      tail = punct[0] + tail;
      url = url.slice(0, -punct[0].length);
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

function peek(body = '') {
  const line = String(body).split('\n').map((l) => l.trim()).find((l) => l && !/^>/.test(l)) || '';
  return line.slice(0, 140);
}

function replyTo(c) {
  const theirs = [...(c.msgs || [])].reverse().find((m) => m.from !== 'me');
  const email = theirs ? parseAddress(theirs.fromRaw || '').email : '';
  return { email: email || c.t?.fromEmail || '', id: theirs?.from || c.t?.from };
}

function composeHtml(c) {
  if (!c.composing) return '';
  const to = replyTo(c);
  const subj = subjectFor(c);
  return `<form class="ib-compose" data-compose>
    <div class="ib-compose__head"><span class="faint">To</span> <b>${esc(nameOf(to.id, to.email))}</b>${to.email && nameOf(to.id, to.email) !== to.email ? ` <span class="faint">${esc(to.email)}</span>` : ''}
      <span class="ib-compose__subj faint">${esc(reSubject(subj))}</span></div>
    <label class="sr" for="ib-reply">Your reply</label>
    <textarea class="input ib-compose__text" id="ib-reply" rows="7" placeholder="Write your reply…" ${c.drafting ? 'aria-busy="true"' : ''}>${esc(c.draft)}</textarea>
    <div class="ib-compose__foot">
      <span class="ib-compose__hint">${icon('shield')}Saved as a Gmail draft. You send it from Gmail.</span>
      <button type="button" class="btn btn--sm btn--ghost" data-r="discard">Discard</button>
      <button type="submit" class="btn btn--sm btn--accent" ${c.drafting ? 'disabled' : ''}>${icon('mail')}Save draft in Gmail</button>
    </div>
  </form>`;
}

const reSubject = (s) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

function paintReader() {
  const h = host();
  if (!h) return;
  h.innerHTML = readerHtml(cur);
  if (cur?.msgs && !reduced()) fadeUp(h.querySelectorAll('.ib-msg'), { y: 10, stagger: 0.04, duration: 0.45 });
}

function paintPart(part) {
  const el = host()?.querySelector(`[data-part="${part}"]`);
  if (!el || !cur) return;
  el.innerHTML = { tools: toolsHtml, acts: actsHtml, sum: sumHtml, msgs: msgsHtml, compose: composeHtml }[part](cur);
}

function textarea() {
  return host()?.querySelector('.ib-compose__text');
}

function startReply() {
  if (!cur?.msgs) return;
  cur.composing = true;
  paintPart('compose');
  const ta = textarea();
  if (!ta) return;
  ta.focus();
  ta.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  if (!reduced()) gsap.fromTo(ta.closest('.ib-compose'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: dur(0.4), ease: 'power3.out', clearProps: 'all' });
}

async function aiDraft(c) {
  if (!c?.msgs?.length) return;
  if (c.drafting) return c.ctrl?.abort();
  c.composing = true;
  c.drafting = true;
  c.ctrl = new AbortController();
  const signal = c.ctrl.signal;
  const before = c.draft;
  c.draft = '';
  paintPart('compose');
  paintPart('acts');
  textarea()?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  try {
    const text = await ask(replyPrompt(c.msgs), {
      signal,
      cache: false,
      onText: (full) => {
        if (cur !== c || signal.aborted) return;
        c.draft = full;
        const ta = textarea();
        if (ta) {
          ta.value = full;
          ta.scrollTop = ta.scrollHeight;
        }
      },
    });
    if (cur === c && !signal.aborted && text) c.draft = text;
  } catch (err) {
    if (!signal.aborted) notify(aiErrorText(err), { ico: 'x', tone: 'warn', hold: 4 });
    if (!c.draft) c.draft = before;
  }
  c.drafting = false;
  c.ctrl = null;
  if (cur !== c) return;
  paintPart('compose');
  paintPart('acts');
  textarea()?.focus({ preventScroll: true });
}

async function summarize(c) {
  if (!c?.msgs?.length || c.summarizing) return;
  c.summarizing = true;
  c.summary = '';
  c.sumErr = '';
  c.sumCtrl = new AbortController();
  const signal = c.sumCtrl.signal;
  paintPart('sum');
  paintPart('acts');
  try {
    const text = await ask(summarizePrompt(c.msgs), {
      signal,
      onText: (full) => {
        if (cur !== c || signal.aborted) return;
        c.summary = full;
        const p = host()?.querySelector('[data-sumtext]');
        if (p) p.innerHTML = sumText(full);
      },
    });
    if (text) c.summary = text;
    if (c.summary) summaries.set(c.id, c.summary);
  } catch (err) {
    if (!signal.aborted) c.sumErr = aiErrorText(err);
  }
  c.summarizing = false;
  c.sumCtrl = null;
  if (cur !== c) return;
  paintPart('sum');
  paintPart('acts');
}

async function saveDraft(c) {
  const body = (textarea()?.value ?? c.draft).trim();
  if (!body) {
    notify('Write something first', { ico: 'edit', tone: 'info' });
    textarea()?.focus();
    return;
  }
  const to = replyTo(c);
  if (!to.email) return notify('No address to reply to', { ico: 'x', tone: 'warn' });
  c.draft = body;
  const btn = host()?.querySelector('.ib-compose [type="submit"]');
  if (btn) btn.disabled = true;
  const lastId = c.msgs?.[c.msgs.length - 1]?.id || c.t?.lastMessageId;
  const ok = await liveAction(() => gmail.draft({ to: [to.email], subject: reSubject(subjectFor(c)), body, replyToMessageId: lastId }), {
    busy: 'Saving your draft in Gmail…',
    done: 'Draft saved. It’s waiting in your Gmail drafts.',
    server: GMAIL,
    ico: 'mail',
  });
  if (cur !== c) return;
  if (ok) {
    c.composing = false;
    c.draft = '';
    paintPart('compose');
    host()?.querySelector('[data-r="reply"]')?.focus({ preventScroll: true });
  } else if (btn?.isConnected) btn.disabled = false;
}

function bindReader(h) {
  if (h._ib) return;
  h._ib = true;
  h.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b || !cur) return;
    const c = cur;
    const t = c.t ? findThread(c.id) || c.t : null;
    switch (b.dataset.r) {
      case 'star':
        bounceIcon(b);
        return toggleStar(t);
      case 'archive':
        return doArchive(t);
      case 'unread':
        setRead(t, false);
        notify('Marked as unread', { ico: 'mail', tone: 'info' });
        return closeReader();
      case 'reply':
        return startReply();
      case 'ai':
        return aiDraft(c);
      case 'sum':
        return summarize(c);
      case 'sum-close':
        c.sumCtrl?.abort();
        c.summary = '';
        c.sumErr = '';
        summaries.delete(c.id);
        paintPart('sum');
        return host()?.querySelector('[data-r="sum"]')?.focus();
      case 'task':
        return t && makeTask(t);
      case 'discard':
        c.ctrl?.abort();
        c.composing = false;
        c.draft = '';
        paintPart('compose');
        return host()?.querySelector('[data-r="reply"]')?.focus();
      case 'retry':
        c.err = '';
        paintPart('msgs');
        return loadThread(c);
      case 'all':
        c.showAll = true;
        paintPart('msgs');
        return host()?.querySelector('.ib-msg__head')?.focus();
      case 'expand': {
        const id = b.dataset.id;
        c.expanded.has(id) ? c.expanded.delete(id) : c.expanded.add(id);
        paintPart('msgs');
        const again = host()?.querySelector(`[data-r="expand"][data-id="${CSS.escape(id)}"]`);
        again?.focus({ preventScroll: true });
        if (c.expanded.has(id) && again) fadeUp(again.parentElement.querySelectorAll('.ib-msg__body, .ib-atts'), { y: 6, duration: 0.35 });
      }
    }
  });
  h.addEventListener('input', (e) => {
    if (e.target.classList.contains('ib-compose__text') && cur && !cur.drafting) cur.draft = e.target.value;
  });
  h.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-compose]')) return;
    e.preventDefault();
    if (cur) saveDraft(cur);
  });
  h.addEventListener('keydown', (e) => {
    // ⌘/Ctrl + Enter saves the draft from the textarea.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.classList.contains('ib-compose__text') && cur && !cur.drafting) {
      e.preventDefault();
      saveDraft(cur);
    }
  });
}

// ---------- wiring ----------
function wire() {
  root.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') {
      bounceIcon(t.closest('[data-act]'));
      return refresh(t.closest('[data-act]'));
    }
    if (act === 'unread') {
      filter.unread = !filter.unread;
      t.closest('[data-act]').setAttribute('aria-pressed', filter.unread);
      return renderList('fade');
    }
    if (act === 'clear-search') return clearSearch();
    if (act === 'retry-search' && remote) return runSearch(remote.q);
    if (act === 'clear-filters') {
      filter.unread = false;
      filter.q = '';
      els.search.value = '';
      els.bar.querySelector('[data-act="unread"]').setAttribute('aria-pressed', 'false');
      els.cats.select('all', { silent: true });
      filter.cat = 'all';
      return renderList('fade');
    }

    const row = t.closest('.ib-row[data-key]');
    if (!row) return;
    const th = findThread(row.dataset.key);
    if (!th) return;
    if (t.closest('[data-star]')) {
      setSel(th.id);
      bounceIcon(t.closest('[data-star]'));
      return toggleStar(th);
    }
    if (t.closest('[data-arch]')) return doArchive(th);
    if (t.closest('[data-read]')) return setRead(th, th.unread);
    if (t.closest('[data-open]')) {
      setSel(th.id);
      openDeep(th.id);
    }
  });

  els.rows.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const row = e.target.closest('.ib-row[data-key]');
    if (!row) return;
    const th = findThread(row.dataset.key);
    const k = e.key;
    // "g then e" is the global go-to-inbox chord: never treat it as archive.
    if (k === 'g') {
      lastG = Date.now();
      return;
    }
    if (Date.now() - lastG < 1200 && /^[a-z]$/.test(k)) {
      lastG = 0;
      return;
    }
    if (k === 'j' || k === 'ArrowDown') step(1);
    else if (k === 'k' || k === 'ArrowUp') step(-1);
    else if (k === 'Home') step(-Infinity);
    else if (k === 'End') step(Infinity);
    else if (k === 'e' && th?.inbox) doArchive(th);
    else if (k === 's' && th) {
      bounceIcon(row.querySelector('[data-star]'));
      toggleStar(th);
    } else if (k === 'u' && th) setRead(th, th.unread);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Clicking a row's buttons moves the cursor there too.
  els.rows.addEventListener('focusin', (e) => {
    const row = e.target.closest('.ib-row[data-key]');
    if (row && row.dataset.key !== selId) setSel(row.dataset.key);
  });

  els.search.addEventListener('input', () => {
    typing?.kill();
    typing = gsap.delayedCall(0.14, () => {
      const q = els.search.value.trim();
      if (remote && q !== remote.q) remote = null;
      if (q === filter.q && !remote) return renderList();
      filter.q = q;
      renderList();
    });
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = els.search.value.trim();
      if (q.length >= 3) {
        typing?.kill();
        filter.q = '';
        runSearch(q);
      } else if (q) notify('Type at least 3 characters to search Gmail', { ico: 'search', tone: 'info' });
    } else if (e.key === 'Escape' && (els.search.value || remote)) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    } else if (e.key === 'ArrowDown' && shownIds.length) {
      e.preventDefault();
      setSel(selId || shownIds[0], { focus: true });
    }
  });

  els.cats = bindSegmented(els.bar.querySelector('.ib-cats'), (v) => {
    filter.cat = v;
    if (remote) {
      remote = null;
      els.search.value = '';
      filter.q = '';
    }
    renderList('fade');
  });

  bindReader(els.reader);
  wideMq.addEventListener('change', onWideChange);
  subscribe('threads', onThreads);
  subscribe('live', onLive);
}

function onWideChange() {
  if (!root || root.hidden) return;
  if (wide()) {
    if (drawerHost?.isConnected) {
      switching = true;
      Promise.resolve(closeDrawer()).finally(() => (switching = false));
    }
    paintReader();
  } else if (cur) showReader();
}

function onThreads() {
  if (!root || root.hidden) {
    dirty = true;
    return;
  }
  renderHead(true);
  renderList('flip');
  // A refresh replaces thread objects: keep the reader pointing at fresh data.
  if (cur) {
    const fresh = findThread(cur.id);
    if (fresh) cur.t = fresh;
    paintPart('tools');
  }
}

let lastGmail = null;
function onLive() {
  const st = state.live.gmail?.status;
  if (refreshArmed && st !== 'loading') stopRefresh();
  if (!root || root.hidden) {
    dirty = true;
    return;
  }
  renderNote();
  if (st !== lastGmail) {
    lastGmail = st;
    renderHead(false);
    renderList();
  }
}

function renderAll() {
  renderNote();
  renderHead(false);
  renderList();
  paintReader();
  dirty = false;
}

// ---------- intro ----------
function intro(first) {
  headIntro(root);
  if (DEMO) {
    const demo = root.querySelector('.ib-demo');
    revealCards([demo], { y: 30, delay: 0.12 });
    if (!reduced()) {
      popIn(demo.querySelector('.ib-demo__art'));
      fadeUp(demo.querySelectorAll('.ib-demo__list li'), { y: 8, stagger: 0.06, delay: 0.45 });
    }
    return;
  }
  const boxes = [els.bar, els.listCard, ...(wide() ? [els.readerCard] : [])];
  revealCards(boxes, { y: 30, stagger: 0.06, delay: 0.12, kids: false });
  fadeUp([...els.rows.children].slice(0, first ? 12 : 6), { y: first ? 18 : 10, stagger: 0.035, delay: 0.32 });
}

// ---------- page ----------
export const page = {
  title: 'Inbox',
  mount(el) {
    root = el;
    if (DEMO) {
      root.innerHTML = demoShell();
      return;
    }
    root.innerHTML = shell();
    els.sub = root.querySelector('[data-sub]');
    els.stats = [...root.querySelectorAll('.head .stat')];
    els.bar = root.querySelector('.ib-bar');
    els.search = root.querySelector('.ib-find__input');
    els.listCard = root.querySelector('.ib-list');
    els.listSub = root.querySelector('[data-list-sub]');
    els.note = root.querySelector('[data-note]');
    els.results = root.querySelector('[data-results]');
    els.rows = root.querySelector('[data-rows]');
    els.empty = root.querySelector('[data-empty]');
    els.readerCard = root.querySelector('.ib-reader');
    els.reader = root.querySelector('[data-reader]');
    lastGmail = state.live.gmail?.status;
    renderAll();
    wire();
    aiAvailable().then((ok) => {
      aiOk = !!ok;
      if (aiOk && cur) {
        paintPart('acts');
        paintPart('compose');
      }
    });
  },
  enter({ params = [], first, same }) {
    leaving = false;
    const id = params[0];
    // Left on a wide screen with a thread open, back on a narrow one.
    if (!DEMO && !same && !id && cur && !host()) {
      stopAi(cur);
      cur = null;
      openId = null;
    }
    if (!same) {
      if (dirty && !DEMO) renderAll();
      intro(first);
    }
    if (DEMO) return;
    if (id) gsap.delayedCall(same ? 0 : 0.35, () => openThread(id));
    else if (same && openId) closeReader();
  },
  leave() {
    leaving = true;
    typing?.kill();
    if (cur?.drafting || cur?.summarizing) stopAi(cur);
    if (drawerHost?.isConnected) closeDrawer();
  },
};
