// Files: recent and starred Google Drive files, a kind filter, grid or list
// view, and a Drive search. Every file opens in Drive in a new tab.
import '../styles/pages/files.css';

import { gsap, Flip, reduced, dur, revealCards, fadeUp, countTo, popIn } from '../lib/motion.js';
import { esc, icon, initials, relTime, startOfDay, addDays, highlight } from '../lib/dom.js';
import { state, subscribe, member } from '../store.js';
import { pageHead, headIntro, card, avatar, segmented, bindSegmented, emptyState, sourceNote, sourceReady } from '../ui/components.js';
import { notify } from '../ui/overlays.js';
import { LIVE, SERVERS, explain } from '../live/runtime.js';
import { searchFiles, starredFiles } from '../live/sources.js';

// ---------- module state ----------
const DEMO = !LIVE || state.demo;
const DRIVE = SERVERS.drive;
const VIEW_KEY = 'lumen:files-view';
const KINDS = [['all', 'All'], ['doc', 'Docs'], ['sheet', 'Sheets'], ['slides', 'Slides'], ['pdf', 'PDFs'], ['other', 'Other']];
const MAIN_KINDS = ['doc', 'sheet', 'slides', 'pdf'];
// kind → [label, icon, hue]
const META = {
  doc: ['Doc', 'list', 'blue'],
  sheet: ['Sheet', 'grid', 'green'],
  slides: ['Slides', 'play', 'orange'],
  pdf: ['PDF', 'eye', 'pink'],
  folder: ['Folder', 'folder', 'yellow'],
  image: ['Image', 'palette', 'purple'],
  video: ['Video', 'video', 'teal'],
  file: ['File', 'link', 'indigo'],
};

let root;
let dirty = false;
let kind = 'all';
let view = readView();
let typing = null;
let q = ''; // local title filter
let remote = null; // Drive search: { q, list, loading, error }
const starred = { status: 'idle', list: [], error: '' };
const els = {};

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

// ---------- helpers ----------
const HUES = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo'];
const hueOf = (s) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

function ownerName(id) {
  if (!id) return '';
  if (id === 'me') return 'You';
  return member(id)?.name || id;
}

function ownerFace(id) {
  if (!id) return '';
  const m = member(id);
  const label = id === 'me' ? 'You' : m?.name || id;
  if (m?.name) return avatar(id, 'xs', { extra: 'fl-owner' });
  return `<span class="av av--xs hue--${hueOf(label)} fl-owner" title="${esc(label)}">${esc(initials(label.split('@')[0].replace(/[._+-]+/g, ' ').trim() || '?'))}</span>`;
}

const kindOk = (f) => kind === 'all' || (kind === 'other' ? !MAIN_KINDS.includes(f.kind) : f.kind === kind);
const urlOf = (f) => f.url || `https://drive.google.com/open?id=${encodeURIComponent(f.id)}`;

function whenOf(f) {
  if (f.viewed && f.viewed > f.modified) return `Opened ${relTime(f.viewed)}`;
  if (f.modified) return `Edited ${relTime(f.modified)}`;
  return '';
}

function weekStart() {
  const sod = startOfDay();
  return addDays(sod, -((sod.getDay() - (state.settings.weekStart ?? 1) + 7) % 7)).getTime();
}

function stats() {
  const fs = state.files;
  const ws = weekStart();
  return {
    recent: fs.length,
    week: fs.filter((f) => f.modified >= ws).length,
    shared: fs.filter((f) => f.owner !== 'me').length,
  };
}

function subText(s) {
  if (!sourceReady('drive')) return 'Loading from Google Drive…';
  return s.recent ? `${s.recent} recent file${s.recent === 1 ? '' : 's'} in Google Drive` : 'Nothing recent in Google Drive';
}

// ---------- markup ----------
function itemHtml(f, mark = '') {
  const [label, ico, hue] = META[f.kind] || META.file;
  const when = whenOf(f);
  const owner = ownerName(f.owner);
  return `<li class="fl-item" data-key="${esc(f.id)}"><a class="fl-card hue--${hue}" href="${esc(urlOf(f))}" target="_blank" rel="noopener" title="${esc(f.title)}">
    <span class="fl-tile" aria-hidden="true">${icon(ico)}</span>
    <span class="fl-card__title">${highlight(f.title, mark)}</span>
    <span class="fl-card__meta"><span class="fl-card__kind">${label}</span>${when ? `<span class="fl-card__when">${esc(when)}</span>` : ''}${
      owner ? `<span class="fl-card__owner-name">${esc(owner)}</span>` : ''
    }</span>
    <span class="fl-card__who">${ownerFace(f.owner)}</span>
    <span class="sr">${owner ? `, owned by ${esc(owner)}` : ''}, opens in a new tab</span>
  </a></li>`;
}

function skelHtml(n = 8) {
  return Array.from({ length: n }, (_, i) => `<li class="fl-item fl-item--skel" aria-hidden="true"><div class="fl-card">
      <span class="skel fl-tile"></span><span class="fl-card__title"><span class="skel fl-sk" style="width:${70 + ((i * 13) % 25)}%"></span><span class="skel fl-sk" style="width:${40 + ((i * 17) % 30)}%"></span></span>
      <span class="fl-card__meta"><span class="skel fl-sk fl-sk--sm"></span></span></div></li>`).join('');
}

function shell() {
  const s = stats();
  const head = pageHead({
    title: 'Files',
    sub: `<span data-sub>${esc(subText(s))}</span>`,
    actions:
      segmented('Files view', [['grid', `${icon('grid')}<span>Grid</span>`], ['list', `${icon('list')}<span>List</span>`]], view, 'fl-viewseg') +
      `<a class="btn btn--glass" href="https://drive.google.com" target="_blank" rel="noopener">${icon('layers')}Open Drive</a>`,
    stats: [
      { label: 'Recent', value: s.recent },
      { label: 'Edited this week', value: s.week },
      { label: 'Shared with me', value: s.shared },
    ],
  });

  const bar = `<div class="fl-bar glass" role="group" aria-label="Filter files">
    ${segmented('File type', KINDS, kind, 'fl-kinds')}
    <label class="fl-find">${icon('search')}<span class="sr">Filter recent files, or press Enter to search Google Drive</span>
      <input type="search" class="fl-find__input" placeholder="Filter, or Enter to search Drive" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
  </div>`;

  const recent = card({
    cls: 'fl-sec fl-recent',
    title: 'Recent',
    sub: '<span data-recent-sub></span>',
    body: `<div data-note></div>
      <div class="fl-results" data-results hidden></div>
      <ul class="fl-items is-${view}" data-recent aria-label="Recent files"></ul>
      <div data-recent-empty hidden></div>`,
  });

  const star = card({
    cls: 'fl-sec fl-starred',
    title: 'Starred',
    sub: '<span data-starred-sub></span>',
    body: `<ul class="fl-items is-${view}" data-starred aria-label="Starred files"></ul><div data-starred-empty hidden></div>`,
  });

  return `${head}<div class="fl">${bar}${recent}${star}</div>`;
}

function demoShell() {
  const kinds = ['doc', 'sheet', 'slides', 'pdf'];
  return `${pageHead({
    title: 'Files',
    sub: 'Your Google Drive, close at hand',
    actions: `<a class="btn btn--glass" href="https://drive.google.com" target="_blank" rel="noopener">${icon('layers')}Open Drive</a>`,
  })}
  <section class="card glass fl-demo">
    <span class="fl-demo__tiles" aria-hidden="true">${kinds.map((k) => `<span class="fl-tile hue--${META[k][2]}">${icon(META[k][1])}</span>`).join('')}</span>
    <div class="fl-demo__text">
      <h2>Files shows your Google Drive</h2>
      <p>Open Lumen from claude.ai with the Google Drive connector to see the documents, sheets and slides you worked on recently, your starred files, and a search across all of Drive.</p>
      <p class="faint">This demo has no Drive attached, so there’s nothing to list here.</p>
    </div>
  </section>`;
}

// ---------- render ----------
function flash(el) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

function renderHead(animate) {
  const s = stats();
  els.sub.textContent = subText(s);
  [s.recent, s.week, s.shared].forEach((v, i) => {
    const b = els.stats[i].querySelector('b');
    if (+b.dataset.count === v) return;
    b.dataset.count = v;
    countTo(b, v);
    if (animate) flash(els.stats[i]);
  });
}

function recentList() {
  if (remote) return remote.list.filter(kindOk);
  const needle = q.toLowerCase();
  return state.files.filter((f) => kindOk(f) && (!needle || f.title.toLowerCase().includes(needle)));
}

const WORDS = { all: ['file', 'files'], doc: ['doc', 'docs'], sheet: ['sheet', 'sheets'], slides: ['slide deck', 'slide decks'], pdf: ['PDF', 'PDFs'], other: ['other file', 'other files'] };
const kindWord = (n = 2) => WORDS[kind][n === 1 ? 0 : 1];

function renderRecent(animate = false) {
  els.note.innerHTML = sourceNote('drive');
  const loading = !!remote?.loading || (!remote && !state.files.length && (state.live.drive?.status === 'loading' || !state.live.drive));
  const list = loading ? [] : recentList();
  els.recent.innerHTML = loading ? skelHtml() : list.map((f) => itemHtml(f, remote ? '' : q)).join('');
  els.recent.setAttribute('aria-busy', loading);

  els.results.hidden = !remote;
  if (remote) {
    els.results.innerHTML = `${icon('search')}<span>Drive results for <b>“${esc(remote.q)}”</b></span>
      <button type="button" class="fl-clear" data-act="clear-search">${icon('x')}Clear search</button>`;
  }
  els.recentTitle.textContent = remote ? 'Search results' : 'Recent';
  els.recentSub.textContent = loading ? 'Loading…' : `${list.length} ${kindWord(list.length)}${remote ? ' found in Drive' : q ? ' matching' : ''}`;

  const failed = !remote && state.live.drive?.status === 'error' && !state.files.length;
  const empty = !loading && !list.length && !failed;
  els.recentEmpty.hidden = !empty;
  if (empty) {
    let html;
    if (remote?.error) html = emptyState('Search didn’t work', remote.error, 'bolt', '<button type="button" class="btn btn--glass btn--sm" data-act="retry-search">Try again</button>');
    else if (remote) html = emptyState('Nothing found', `No ${kindWord()} in Drive match “${remote.q}”.`, 'search');
    else if (!state.files.length) html = emptyState('No recent files', 'Files you open or edit in Google Drive show up here.', 'layers');
    else html = emptyState('Nothing here', q ? `No recent ${kindWord()} match “${q}”. Press Enter to search all of Drive.` : `No ${kindWord()} among your recent files.`, q ? 'search' : 'filter', '<button type="button" class="btn btn--glass btn--sm" data-act="clear-filters">Show all files</button>');
    els.recentEmpty.innerHTML = html;
  }
  if (animate && !loading) fadeUp([...els.recent.children].slice(0, 16), { y: 12, stagger: 0.025, duration: 0.45 });
}

function renderStarred(animate = false) {
  const loading = starred.status === 'loading' || starred.status === 'idle';
  const list = starred.list.filter(kindOk);
  els.starred.innerHTML = loading ? skelHtml(4) : list.map((f) => itemHtml(f)).join('');
  els.starred.setAttribute('aria-busy', loading);
  els.starredSub.textContent = loading ? 'Loading…' : starred.status === 'error' ? 'Unavailable' : `${list.length} starred ${kindWord(list.length)}`;
  const empty = !loading && !list.length;
  els.starredEmpty.hidden = !empty;
  if (empty) {
    els.starredEmpty.innerHTML =
      starred.status === 'error'
        ? `<div class="src-note src-note--warn" role="alert">${icon('bolt')}<span>${esc(starred.error)}</span><button type="button" class="btn btn--sm btn--glass" data-act="retry-starred">Try again</button></div>`
        : starred.list.length
          ? emptyState('No starred ' + kindWord(), 'Try another file type.', 'star')
          : emptyState('Nothing starred yet', 'Star a file in Google Drive to keep it here.', 'star');
  }
  if (animate && !loading) fadeUp([...els.starred.children].slice(0, 12), { y: 12, stagger: 0.03, duration: 0.45 });
}

function renderAll(animate = false) {
  renderHead(animate);
  renderRecent(animate);
  renderStarred(animate);
  dirty = false;
}

// ---------- data ----------
async function loadStarred() {
  starred.status = 'loading';
  starred.error = '';
  renderStarred();
  try {
    starred.list = await starredFiles();
    starred.status = 'ok';
  } catch (err) {
    starred.status = 'error';
    starred.error = explain(err, DRIVE).text;
  }
  if (root && !root.hidden) renderStarred(true);
  else dirty = true;
}

async function runSearch(text) {
  remote = { q: text, list: [], loading: true, error: '' };
  renderRecent();
  const mine = remote;
  try {
    const list = await searchFiles(text, 20);
    if (remote !== mine) return;
    remote.list = list;
  } catch (err) {
    if (remote !== mine) return;
    remote.error = explain(err, DRIVE).text;
  }
  remote.loading = false;
  renderRecent(true);
}

function clearSearch() {
  remote = null;
  q = '';
  typing?.kill();
  els.search.value = '';
  renderRecent(true);
  els.search.focus();
}

// ---------- view ----------
function setView(v) {
  if (v === view) return;
  view = v;
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  const lists = [els.recent, els.starred];
  const items = lists.flatMap((l) => [...l.children]).filter(onScreen).slice(0, 40);
  const st = !reduced() && items.length ? Flip.getState(items) : null;
  lists.forEach((l) => {
    l.classList.toggle('is-grid', v === 'grid');
    l.classList.toggle('is-list', v === 'list');
  });
  if (st) Flip.from(st, { duration: dur(0.55), ease: 'power3.inOut', stagger: 0.008, nested: true, prune: true });
}

function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
}

// ---------- wiring ----------
function wire() {
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear-search') return clearSearch();
    if (act === 'retry-search' && remote) return runSearch(remote.q);
    if (act === 'retry-starred') return loadStarred();
    if (act === 'clear-filters') {
      q = '';
      els.search.value = '';
      els.kinds.select('all', { silent: true });
      kind = 'all';
      renderRecent(true);
      renderStarred(true);
    }
  });

  els.search.addEventListener('input', () => {
    typing?.kill();
    typing = gsap.delayedCall(0.14, () => {
      const v = els.search.value.trim();
      if (remote && v !== remote.q) remote = null;
      q = v;
      renderRecent();
    });
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = els.search.value.trim();
      if (!v) return;
      if (v.length < 2) return notify('Type at least 2 characters to search Drive', { ico: 'search', tone: 'info' });
      typing?.kill();
      q = '';
      runSearch(v);
    } else if (e.key === 'Escape' && (els.search.value || remote)) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    }
  });

  els.kinds = bindSegmented(els.bar.querySelector('.fl-kinds'), (v) => {
    kind = v;
    renderRecent(true);
    renderStarred(true);
  });
  bindSegmented(root.querySelector('.fl-viewseg'), setView);

  subscribe('files', onData);
  subscribe('live', onLive);
}

function onData() {
  if (!root || root.hidden) {
    dirty = true;
    return;
  }
  renderHead(true);
  if (!remote) renderRecent();
}

let lastDrive = null;
function onLive() {
  const st = state.live.drive?.status;
  if (!root || root.hidden) {
    if (st !== lastDrive) dirty = true;
    return;
  }
  if (st === lastDrive) return;
  lastDrive = st;
  renderHead(false);
  renderRecent();
}

// ---------- intro ----------
function intro(first) {
  headIntro(root);
  if (DEMO) {
    const demo = root.querySelector('.fl-demo');
    revealCards([demo], { y: 30, delay: 0.12 });
    if (!reduced()) {
      demo.querySelectorAll('.fl-demo__tiles .fl-tile').forEach((t, i) => gsap.delayedCall(0.3 + i * 0.08, () => popIn(t)));
    }
    return;
  }
  revealCards([els.bar, els.recentCard, els.starredCard], { y: 30, stagger: 0.07, delay: 0.12, kids: false });
  fadeUp([...els.recent.children].slice(0, first ? 12 : 8), { y: first ? 18 : 10, stagger: 0.03, delay: 0.32 });
}

// ---------- page ----------
export const page = {
  title: 'Files',
  mount(el) {
    root = el;
    if (DEMO) {
      root.innerHTML = demoShell();
      return;
    }
    root.innerHTML = shell();
    els.sub = root.querySelector('[data-sub]');
    els.stats = [...root.querySelectorAll('.head .stat')];
    els.bar = root.querySelector('.fl-bar');
    els.search = root.querySelector('.fl-find__input');
    els.recentCard = root.querySelector('.fl-recent');
    els.recentTitle = els.recentCard.querySelector('.card__title');
    els.recentSub = root.querySelector('[data-recent-sub]');
    els.note = root.querySelector('[data-note]');
    els.results = root.querySelector('[data-results]');
    els.recent = root.querySelector('[data-recent]');
    els.recentEmpty = root.querySelector('[data-recent-empty]');
    els.starredCard = root.querySelector('.fl-starred');
    els.starredSub = root.querySelector('[data-starred-sub]');
    els.starred = root.querySelector('[data-starred]');
    els.starredEmpty = root.querySelector('[data-starred-empty]');
    lastDrive = state.live.drive?.status;
    renderAll(false);
    wire();
  },
  enter({ first, same }) {
    if (same) return;
    if (!DEMO) {
      if (dirty) renderAll(false);
      if (starred.status === 'idle') loadStarred();
    }
    intro(first);
  },
  leave() {
    typing?.kill();
  },
};
