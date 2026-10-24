// People. Demo mode: the seeded team, with live local clocks and workload
// meters. Live mode: real collaborators derived from calendar attendees and
// mail senders. Either way a profile opens in the shared drawer (#/team/<id>).
import '../styles/pages/team.css';

import { gsap, Flip, reduced, revealCards, collapseOut, fadeUp, countTo, bounceIcon } from '../lib/motion.js';
import { esc, icon, uid, startOfDay, addDays, fmtTime, dueLabel, dayLabel, fmtHours, relTime } from '../lib/dom.js';
import { state, commit, subscribe, member, me, openTasks, openHours, focusMinutesBetween, project, firstName } from '../store.js';
import {
  pageHead, headIntro, avatar, PRESENCE, segmented, bindSegmented, iconBtn, projectIcon, priorityPill, emptyState, sourceNote,
} from '../ui/components.js';
import {
  openPopover, closePopover, openMenu, openDrawer, closeDrawer, formModal, openTask, openEvent, notify, liveAction, newEvent, KIND,
} from '../ui/overlays.js';
import { draft, suggestTimes } from '../live/sources.js';
import { collaborators } from '../live/people.js';

// ---------- constants ----------
const TEAMS = ['Product', 'Design', 'Engineering', 'Marketing'];
const TEAM_HUE = { Product: 'blue', Design: 'pink', Engineering: 'indigo', Marketing: 'orange' };
const STATUS = [
  ['online', 'Online', 'check'],
  ['focus', 'Focus', 'bolt'],
  ['away', 'Away', 'moon'],
];
const STATUS_WORD = { online: 'online', focus: 'in focus', away: 'away', meeting: 'in a meeting' };
const KIND_HUE = { meeting: 'indigo', focus: 'purple', review: 'teal', deadline: 'pink', social: 'orange' };
const MAX_ROWS = 6;
const RING_C = 2 * Math.PI * 40;

const teamHue = (m) => TEAM_HUE[m.team] || 'blue';
const isMe = (id) => id === state.me;

// ---------- time zones ----------
const fmtCache = new Map();
function zoneFmt(tz) {
  if (!fmtCache.has(tz)) {
    let f;
    try {
      f = {
        time: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }),
        parts: new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }),
      };
    } catch {
      f = zoneFmt(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    fmtCache.set(tz, f);
  }
  return fmtCache.get(tz);
}
const localTime = (tz, at = new Date()) => zoneFmt(tz).time.format(at);
function zoneParts(tz, at = new Date()) {
  const o = {};
  for (const p of zoneFmt(tz).parts.formatToParts(at)) o[p.type] = +p.value || 0;
  return o;
}
// Minutes east of UTC for a zone at a given instant.
function zoneOffset(tz, at = new Date()) {
  const p = zoneParts(tz, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}
const isDaytime = (tz) => {
  const h = zoneParts(tz).hour % 24;
  return h >= 7 && h < 19;
};
function offsetText(m) {
  if (isMe(m.id)) return 'Your time';
  const mine = me();
  const diff = zoneOffset(m.tz) - zoneOffset(mine?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!diff) return 'Same time as you';
  const h = Math.abs(diff) / 60;
  return `${+h.toFixed(2)}h ${diff > 0 ? 'ahead' : 'behind'}`;
}

// ---------- workload ----------
function load(m) {
  const hours = openHours(m.id);
  const cap = m.capacity || 1;
  const ratio = hours / cap;
  const level = ratio > 1 ? 'over' : ratio > 0.85 ? 'high' : 'ok';
  return { hours, cap, ratio, level };
}
const LEVEL_PILL = { high: 'Nearly full', over: 'Over capacity' };

// ---------- module state ----------
let root;
let grid;
let filter = 'all';
let seg = null;
let clock = null;
let openId = null;
let pendingOpen = null;
let animTimer = null;
const sigs = new Map();
const ratios = new Map();

// ---------- header ----------
function stats() {
  const ms = state.members;
  const online = ms.filter((m) => m.presence !== 'away').length;
  const focusN = ms.filter((m) => m.presence === 'focus').length;
  const avg = ms.length ? (ms.reduce((s, m) => s + Math.min(load(m).ratio, 2), 0) / ms.length) * 100 : 0;
  return { online, focusN, avg, people: ms.length, teams: new Set(ms.map((m) => m.team)).size };
}
const subText = (s) => `${s.people} ${s.people === 1 ? 'person' : 'people'} · ${s.teams} ${s.teams === 1 ? 'team' : 'teams'}`;

function updateHead() {
  const s = stats();
  root.querySelector('.head__sub').textContent = subText(s);
  const vals = [s.online, s.focusN, Math.round(s.avg)];
  const fmts = [(v) => Math.round(v), (v) => Math.round(v), (v) => `${Math.round(v)}%`];
  root.querySelectorAll('.head__stats [data-count]').forEach((b, i) => {
    if (+b.dataset.count === vals[i]) return;
    b.dataset.count = vals[i];
    countTo(b, vals[i], fmts[i]);
    const st = b.closest('.stat');
    st.classList.remove('is-bump');
    void st.offsetWidth;
    st.classList.add('is-bump');
  });
  const suffix = root.querySelector('.head__stats .stat small');
  if (suffix) suffix.textContent = `/ ${s.people}`;
}

// ---------- member card ----------
function presenceHtml(m) {
  if (m.invited) return `<span class="mcard__presence is-invited">${icon('mail')}Invite sent</span>`;
  return `<span class="mcard__presence"><i class="presence-dot presence--${m.presence}"></i>${PRESENCE[m.presence] || 'Away'}</span>`;
}

function clockHtml(m, cls = 'mcard__where') {
  const day = isDaytime(m.tz);
  return `<span class="${cls}" data-day="${day}">${icon(day ? 'sun' : 'moon')}<b data-clock="${esc(m.tz)}">${localTime(m.tz)}</b><span>${esc(m.city || '')}</span></span>`;
}

function sigOf(m) {
  const l = load(m);
  return [m.name, m.role, m.team, m.presence, m.city, m.tz, m.invited ? 1 : 0, l.hours, l.cap, openTasks(m.id).length].join('|');
}

function cardHtml(m) {
  const l = load(m);
  const n = openTasks(m.id).length;
  const first = firstName(m.id) || m.name.split(' ')[0];
  const mine = isMe(m.id);
  const shown = filter === 'all' || m.team === filter;
  return `<article class="mcard glass hue--${teamHue(m)}" data-key="${m.id}" data-team="${esc(m.team)}" data-lift ${shown ? '' : 'hidden'}>
    <div class="mcard__top">
      ${avatar(m.id, 'lg', { presence: !m.invited })}
      <div class="mcard__id">
        <h3 class="mcard__name"><a href="#/team/${encodeURIComponent(m.id)}">${esc(m.name)}</a>${mine ? '<span class="you">You</span>' : ''}</h3>
        <p class="mcard__role">${esc(m.role)}</p>
      </div>
      <span class="pchip hue--${teamHue(m)} mcard__team">${esc(m.team)}</span>
    </div>
    <div class="mcard__info">
      ${presenceHtml(m)}
      ${clockHtml(m)}
      <span class="mcard__offset">${offsetText(m)}</span>
    </div>
    <div class="mload mload--${l.level}">
      <div class="mload__head"><span>Workload${LEVEL_PILL[l.level] ? ` <em>${LEVEL_PILL[l.level]}</em>` : ''}</span><span><b>${l.hours}h</b> / ${l.cap}h</span></div>
      <div class="mload__bar" role="meter" aria-label="${esc(`${first}'s workload`)}" aria-valuemin="0" aria-valuemax="${l.cap}" aria-valuenow="${l.hours}" aria-valuetext="${l.hours} of ${l.cap} hours">
        <i style="transform:scaleX(${Math.min(1, l.ratio)})"></i>
      </div>
    </div>
    <footer class="mcard__foot">
      <span class="mcard__tasks">${icon('tasks')}${n} open task${n === 1 ? '' : 's'}</span>
      <div class="mcard__acts">
        <a class="btn btn--glass btn--sm" href="#/team/${encodeURIComponent(m.id)}" aria-label="${esc(`Profile of ${m.name}`)}">Profile</a>
        ${
          mine
            ? `<button type="button" class="btn btn--glass btn--sm mcard__status" data-status aria-haspopup="menu" aria-label="Your status: ${esc(PRESENCE[m.presence] || 'Away')}"><i class="presence-dot presence--${m.presence}"></i>Status</button>`
            : iconBtn('message', `Message ${first}`, `data-msg="${m.id}" aria-haspopup="dialog" aria-expanded="false"`, 'ibtn--glass ibtn--sm')
        }
      </div>
    </footer>
  </article>`;
}

const cardsAll = () => [...grid.querySelectorAll('.mcard')];
const cardsShown = () => cardsAll().filter((c) => !c.hidden);

function renderGrid() {
  sigs.clear();
  ratios.clear();
  grid.innerHTML = state.members.map(cardHtml).join('') + emptyHtml();
  state.members.forEach((m) => {
    sigs.set(m.id, sigOf(m));
    ratios.set(m.id, Math.min(1, load(m).ratio));
  });
  updateEmpty();
}

const emptyHtml = () =>
  `<div class="tgrid-empty" hidden>${emptyState('No one here yet', 'Invite someone to this team.', 'users', `<button type="button" class="btn btn--glass btn--sm" data-act="invite">${icon('plus')}Invite</button>`)}</div>`;

function updateEmpty() {
  grid.querySelector('.tgrid-empty').hidden = cardsShown().length > 0;
}

// Pause CSS hover transitions while GSAP drives card transforms.
function animating(sec = 1.4) {
  grid.classList.add('is-anim');
  clearTimeout(animTimer);
  animTimer = setTimeout(() => grid.classList.remove('is-anim'), sec * 1000);
}

function growBars(cards, delay = 0, from = null) {
  if (reduced()) return;
  cards.forEach((c, i) => {
    const bar = c.querySelector('.mload__bar i');
    const r = Math.min(1, load(member(c.dataset.key) || { id: '', capacity: 1 }).ratio);
    gsap.fromTo(bar, { scaleX: from ?? 0 }, { scaleX: r, duration: from == null ? 1 : 0.8, ease: 'power3.inOut', delay: delay + i * 0.04, overwrite: true });
  });
}

function popDots(els, delay = 0) {
  if (reduced()) return;
  gsap.fromTo(els, { '--dot-s': 0.2 }, { '--dot-s': 1, duration: 0.6, ease: 'back.out(3)', stagger: 0.03, delay, clearProps: '--dot-s' });
}

// ---------- reconcile on store change ----------
function reconcile() {
  const existing = new Map(cardsAll().map((c) => [c.dataset.key, c]));
  const added = [];
  let addedHidden = false;
  for (const m of state.members) {
    const sig = sigOf(m);
    const c = existing.get(m.id);
    existing.delete(m.id);
    if (!c) {
      grid.querySelector('.tgrid-empty').insertAdjacentHTML('beforebegin', cardHtml(m));
      const nc = grid.querySelector(`.mcard[data-key="${CSS.escape(m.id)}"]`);
      added.push(nc);
      if (nc.hidden) addedHidden = true;
    } else if (sigs.get(m.id) !== sig) {
      const old = ratios.get(m.id) ?? 0;
      c.insertAdjacentHTML('afterend', cardHtml(m));
      const nc = c.nextElementSibling;
      c.remove();
      nc.hidden = c.hidden;
      if (!reduced()) {
        const bar = nc.querySelector('.mload__bar i');
        gsap.fromTo(bar, { scaleX: old }, { scaleX: Math.min(1, load(m).ratio), duration: 0.8, ease: 'power3.inOut' });
      }
    }
    sigs.set(m.id, sig);
    ratios.set(m.id, Math.min(1, load(m).ratio));
  }
  // Removed members clip out.
  const gone = [...existing.values()];
  gone.forEach((c) => {
    sigs.delete(c.dataset.key);
    ratios.delete(c.dataset.key);
  });
  collapseOut(gone.filter((c) => !c.hidden), () => {
    gone.forEach((c) => c.remove());
    updateEmpty();
  });

  if (addedHidden) seg?.select('all');
  const visibleNew = added.filter((c) => !c.hidden);
  if (visibleNew.length) {
    animating();
    revealCards(visibleNew, { y: 18, stagger: 0.04, kids: false });
    growBars(visibleNew, 0.3);
  }
  updateEmpty();
  updateHead();
  refreshProfilePresence();
}

// ---------- filter ----------
function applyFilter(v, animate = true) {
  filter = v;
  const want = (c) => v === 'all' || c.dataset.team === v;
  const all = cardsAll();
  const leaving = all.filter((c) => !c.hidden && !want(c));
  const staying = all.filter((c) => !c.hidden && want(c));
  const entering = all.filter((c) => c.hidden && want(c));
  if (!animate || reduced()) {
    all.forEach((c) => (c.hidden = !want(c)));
    updateEmpty();
    return;
  }
  animating(1.6);
  collapseOut(leaving, () => {
    const fs = Flip.getState(staying);
    leaving.forEach((c) => {
      c.hidden = true;
      gsap.set(c, { clearProps: 'clipPath,opacity,transform' });
    });
    entering.forEach((c) => (c.hidden = false));
    updateEmpty();
    Flip.from(fs, { duration: 0.65, ease: 'power3.inOut', clearProps: 'transform' });
    revealCards(entering, { y: 18, stagger: 0.04, delay: 0.1, kids: false });
    growBars(entering, 0.3);
  }, { duration: 0.2 });
}

function updateFilterFade() {
  const wrap = root.querySelector('.tfilter-wrap');
  if (!wrap) return;
  wrap.classList.toggle('is-more', wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 1);
}

// ---------- clocks ----------
function tickClocks() {
  document.querySelectorAll('[data-clock]').forEach((b) => {
    const tz = b.dataset.clock;
    b.textContent = localTime(tz);
    const wrap = b.parentElement;
    const day = String(isDaytime(tz));
    if (wrap?.dataset.day !== undefined && wrap.dataset.day !== day) {
      wrap.dataset.day = day;
      wrap.querySelector('.ico')?.replaceWith(document.createRange().createContextualFragment(icon(day === 'true' ? 'sun' : 'moon')));
    }
  });
  document.querySelectorAll('[data-local-hint]').forEach((s) => {
    const m = member(s.dataset.localHint);
    if (m) s.textContent = `${localTime(m.tz)} for ${firstName(m.id)}`;
  });
}

// ---------- message composer ----------
function composer(m) {
  const first = firstName(m.id);
  return `<form class="msg" novalidate>
    <div class="msg__to">${avatar(m.id, 'sm')}<span>To <b>${esc(m.name)}</b></span></div>
    <label class="sr" for="msg-${m.id}">Message to ${esc(first)}</label>
    <textarea class="msg__text" id="msg-${m.id}" name="text" rows="3" placeholder="Write to ${esc(first)}…"></textarea>
    <div class="msg__foot"><small class="faint" data-local-hint="${m.id}">${localTime(m.tz)} for ${esc(first)}</small>
      <button type="submit" class="btn btn--accent btn--sm">${icon('arrowRight')}Send</button></div>
  </form>`;
}

function wireComposer(form, m, onSent) {
  const ta = form.querySelector('textarea');
  const send = () => {
    if (!ta.value.trim()) {
      ta.focus();
      if (!reduced()) gsap.fromTo(form, { x: -6 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    onSent();
    notify(`Message sent to ${firstName(m.id)}`, { ico: 'message', tone: 'info' });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  });
  if (matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => ta.focus());
}

function openMessage(btn) {
  const m = member(btn.dataset.msg);
  if (!m) return;
  bounceIcon(btn);
  const el = openPopover(btn, composer(m), { cls: 'pop--msg', align: 'end', label: `Message ${firstName(m.id)}` });
  if (!el) return;
  wireComposer(el.querySelector('form'), m, () => {
    closePopover();
    btn.focus();
  });
}

// ---------- your status ----------
function setMyStatus(v, { silent = false } = {}) {
  const m = me();
  if (!m || m.presence === v) return;
  const prev = { presence: m.presence, focusUntil: m.focusUntil };
  m.presence = v;
  m.focusUntil = v === 'focus' ? Date.now() + (state.settings.focusMinutes || 25) * 60000 : null;
  commit('members');
  if (silent) return;
  const ico = STATUS.find(([k]) => k === v)?.[2] || 'check';
  notify(`You're now ${STATUS_WORD[v]}`, {
    ico,
    tone: 'info',
    undo: () => {
      Object.assign(m, prev);
      commit('members');
      if (openId === m.id) syncStatusSeg();
    },
  });
}

function statusMenu(btn) {
  const m = me();
  openMenu(btn, STATUS.map(([v, label, ico]) => ({ label, icon: ico, checked: m.presence === v, onSelect: () => setMyStatus(v) })), { align: 'end' });
}

// ---------- invite ----------
function invite() {
  const teamDefault = filter === 'all' ? 'Product' : filter;
  formModal({
    title: 'Invite someone',
    sub: 'They join as soon as they accept.',
    submit: 'Send invite',
    fields: [
      { name: 'name', label: 'Name', required: true, wide: true, hint: 'For example, Sam Rivera' },
      { name: 'email', label: 'Email', type: 'email', required: true, wide: true },
      { name: 'role', label: 'Role', hint: 'Optional, e.g. Product Designer' },
      { name: 'team', label: 'Team', type: 'select', options: TEAMS.map((t) => [t, t]), value: teamDefault },
    ],
    onSubmit(v) {
      const email = v.email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "That email doesn't look right.";
      if (state.members.some((m) => (m.email || '').toLowerCase() === email.toLowerCase())) return 'Someone with that email is already on the team.';
      const mine = me();
      const nm = {
        id: uid('m'), name: v.name.trim(), role: v.role.trim() || 'Teammate', team: v.team || 'Product',
        presence: 'away', city: mine?.city || '', tz: mine?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
        email, capacity: 32, focusUntil: null, invited: true,
      };
      state.members.push(nm);
      commit('members');
      const first = nm.name.split(' ')[0];
      notify(`Invite sent to ${first}`, {
        ico: 'mail',
        undo: () => {
          const i = state.members.indexOf(nm);
          if (i >= 0) state.members.splice(i, 1);
          commit('members');
        },
      });
      setTimeout(() => {
        grid.querySelector(`.mcard[data-key="${CSS.escape(nm.id)}"]`)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      }, 300);
    },
  });
}

// ---------- profile drawer ----------
function weekBounds() {
  const today = startOfDay();
  const ws = state.settings?.weekStart ?? 1;
  const start = addDays(today, -((today.getDay() - ws + 7) % 7));
  return [start.getTime(), addDays(start, 7).getTime()];
}

function profileHtml(m) {
  const l = load(m);
  const mine = isMe(m.id);
  const first = firstName(m.id);
  const [ws, we] = weekBounds();
  const focusMin = focusMinutesBetween(ws, Date.now(), m.id);
  const tasks = openTasks(m.id).sort((a, b) => a.due - b.due);
  const today = startOfDay().getTime();
  const evs = state.events
    .filter((e) => e.start >= ws && e.start < we && e.kind !== 'focus' && (e.attendees || []).includes(m.id))
    .sort((a, b) => a.start - b.start);
  const projs = state.projects.filter((p) => p.lead === m.id || (p.members || []).includes(m.id));
  const pct = Math.round(l.ratio * 100);
  const extra = tasks.length - MAX_ROWS;

  const taskRows = tasks.length
    ? `<ul class="prof__list">${tasks
        .slice(0, MAX_ROWS)
        .map((t) => {
          const late = t.due < today;
          return `<li><button type="button" class="prof__row" data-task="${t.id}">${projectIcon(t.projectId, 'sm')}
            <span class="prof__txt"><b>${esc(t.title)}</b><small class="${late ? 'is-late' : ''}">${dueLabel(t.due)} · ${esc(project(t.projectId)?.name || '')}</small></span>
            ${t.priority === 'high' || t.priority === 'urgent' ? priorityPill(t.priority) : ''}</button></li>`;
        })
        .join('')}</ul>${extra > 0 ? `<a class="btn btn--ghost btn--sm prof__more" href="#/tasks">${extra} more on the board${icon('chevronRight')}</a>` : ''}`
    : `<p class="prof__none">${icon('check')}Nothing open. Free to help.</p>`;

  const evRows = evs.length
    ? `<ul class="prof__list">${evs
        .slice(0, 5)
        .map((e) => {
          const hue = project(e.projectId)?.hue || KIND_HUE[e.kind] || 'blue';
          const d = new Date(e.start);
          return `<li><button type="button" class="prof__row" data-event="${e.id}">
            <span class="prof__day hue--${hue}"><small>${d.toLocaleDateString('en-US', { weekday: 'short' })}</small><b>${d.getDate()}</b></span>
            <span class="prof__txt"><b>${esc(e.title)}</b><small>${dayLabel(e.start)} · ${fmtTime(e.start)}</small></span></button></li>`;
        })
        .join('')}</ul>`
    : `<p class="prof__none">${icon('calendar')}A clear week.</p>`;

  const projRows = projs.length
    ? `<ul class="prof__list">${projs
        .map((p) => `<li><a class="prof__proj" href="#/projects/${encodeURIComponent(p.id)}">${projectIcon(p.id, 'sm')}<span class="prof__txt"><b>${esc(p.name)}</b><small>${p.lead === m.id ? 'Lead' : 'Member'}</small></span>${icon('chevronRight')}</a></li>`)
        .join('')}</ul>`
    : `<p class="prof__none">${icon('folder')}Not on a project yet.</p>`;

  return `<article class="prof hue--${teamHue(m)}">
    <header class="prof__hero">
      ${avatar(m.id, 'xl', { presence: !m.invited, extra: 'prof__av' })}
      <div class="prof__who">
        <h2 class="prof__name">${esc(m.name)}</h2>
        <p class="prof__role">${esc(m.role)}</p>
        <div class="prof__chips"><span class="pchip hue--${teamHue(m)}">${esc(m.team)}</span><span class="prof__presence">${presenceHtml(m)}</span></div>
      </div>
    </header>
    ${
      mine
        ? `<div class="prof__status"><span class="prof__label" id="prof-status-l">Your status</span>${segmented('Your status', STATUS.map(([v, l]) => [v, l]), m.presence === 'meeting' ? 'online' : m.presence, 'prof__seg')}</div>`
        : ''
    }
    <dl class="prof__meta">
      <div><dt>Email</dt><dd>${icon('mail')}<a href="mailto:${esc(m.email)}">${esc(m.email)}</a></dd></div>
      <div><dt>Local time</dt><dd>${clockHtml(m, 'prof__clock')}</dd></div>
    </dl>
    <div class="prof__stats mload--${l.level}">
      <div class="prof__ring" role="img" aria-label="${pct}% of capacity booked">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" class="prof__track"/><circle cx="50" cy="50" r="40" class="prof__arc" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - Math.min(1, l.ratio))}"/></svg>
        <span><b>${pct}%</b><small>load</small></span>
      </div>
      <dl class="prof__nums">
        <div><dt>Workload</dt><dd>${l.hours}h of ${l.cap}h</dd></div>
        <div><dt>Focus this week</dt><dd>${focusMin ? fmtHours(focusMin) : '0m'}</dd></div>
        <div><dt>Open tasks</dt><dd>${tasks.length}</dd></div>
      </dl>
    </div>
    <section class="prof__block"><h3>Open tasks <span class="badge">${tasks.length}</span></h3>${taskRows}</section>
    <section class="prof__block"><h3>This week <span class="badge">${evs.length}</span></h3>${evRows}</section>
    <section class="prof__block"><h3>Projects <span class="badge">${projs.length}</span></h3>${projRows}</section>
    ${
      mine
        ? ''
        : `<footer class="prof__foot">
        <button type="button" class="btn btn--accent" data-compose aria-expanded="false">${icon('message')}Message ${esc(first)}</button>
        <a class="btn btn--glass" href="mailto:${esc(m.email)}">${icon('mail')}Email</a>
        <div class="prof__compose" hidden></div>
      </footer>`
    }
  </article>`;
}

let profSeg = null;
function syncStatusSeg() {
  const m = me();
  profSeg?.select(m.presence === 'meeting' ? 'online' : m.presence, { silent: true });
}

function refreshProfilePresence() {
  if (!openId) return;
  const m = member(openId);
  const body = document.querySelector('#drawer .prof');
  if (!m || !body) return;
  const av = body.querySelector('.prof__av');
  if (av && !m.invited && av.dataset.presence !== m.presence) {
    av.dataset.presence = m.presence;
    popDots([av], 0);
  }
  const pl = body.querySelector('.prof__presence');
  if (pl) pl.innerHTML = presenceHtml(m);
  if (isMe(m.id)) syncStatusSeg();
}

function resetHash() {
  if (location.hash.startsWith('#/team/')) {
    history.replaceState(null, '', '#/team');
    document.title = 'People · Lumen';
    const ct = document.getElementById('compact-title');
    if (ct) ct.textContent = 'People';
  }
}

function openProfile(id) {
  const m = member(id);
  if (!m) {
    history.replaceState(null, '', '#/team');
    document.title = 'People · Lumen';
    notify("That person isn't on the team", { ico: 'x', tone: 'warn' });
    return;
  }
  openId = id;
  profSeg = null;
  openDrawer(profileHtml(m), {
    label: `${m.name}, profile`,
    onClose() {
      if (openId === id) openId = null;
      profSeg = null;
      resetHash();
    },
    onMount(body) {
      const segEl = body.querySelector('.prof__seg');
      if (segEl) profSeg = bindSegmented(segEl, (v) => setMyStatus(v));
      if (!reduced()) {
        const arc = body.querySelector('.prof__arc');
        gsap.fromTo(arc, { strokeDashoffset: RING_C }, { strokeDashoffset: RING_C * (1 - Math.min(1, load(m).ratio)), duration: 1.2, delay: 0.25, ease: 'power3.inOut' });
        popDots(body.querySelectorAll('.prof__av'), 0.45);
      }
      body.addEventListener('click', (e) => {
        const tk = e.target.closest('[data-task]');
        const ev = e.target.closest('[data-event]');
        if (tk || ev) {
          openId = null;
          resetHash();
          return tk ? openTask(tk.dataset.task) : openEvent(ev.dataset.event);
        }
        if (e.target.closest('a[href^="#/"]')) {
          openId = null;
          return;
        }
        const cb = e.target.closest('[data-compose]');
        if (cb) toggleCompose(body, cb, m);
      });
    },
  });
}

// The shared popover layer sits under the modal drawer's top layer, so the
// drawer composes inline instead.
function toggleCompose(body, btn, m) {
  const box = body.querySelector('.prof__compose');
  const open = box.hidden;
  btn.setAttribute('aria-expanded', open);
  bounceIcon(btn);
  if (!open) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.innerHTML = composer(m);
  box.hidden = false;
  fadeUp([box], { y: 10, duration: 0.4 });
  wireComposer(box.querySelector('form'), m, () => {
    box.hidden = true;
    box.innerHTML = '';
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  });
}

const drawerOpen = () => document.getElementById('drawer')?.open;

// ---------- page ----------
function render() {
  const s = stats();
  const actions = `<div class="tfilter-wrap">${segmented('Team', [['all', 'All'], ...TEAMS.map((t) => [t, t])], filter, 'tfilter')}</div>
    <button type="button" class="btn btn--accent" data-act="invite">${icon('user')}Invite</button>`;
  root.innerHTML = `${pageHead({
    title: 'People',
    sub: subText(s),
    actions,
    stats: [
      { label: 'Online now', value: s.online, suffix: `/ ${s.people}` },
      { label: 'In focus', value: s.focusN },
      { label: 'Average load', value: Math.round(s.avg), fmt: 'pct' },
    ],
  })}<div class="tgrid"></div>`;
  grid = root.querySelector('.tgrid');
  renderGrid();

  const segEl = root.querySelector('.tfilter');
  seg = bindSegmented(segEl, (v) => applyFilter(v));
  const wrap = root.querySelector('.tfilter-wrap');
  segEl.addEventListener('click', (e) => {
    const b = e.target.closest('.seg__btn');
    b?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  });
  wrap.addEventListener('scroll', updateFilterFade, { passive: true });
  new ResizeObserver(updateFilterFade).observe(wrap);
}

function intro() {
  headIntro(root);
  const shown = cardsShown().filter((c) => {
    const r = c.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });
  animating(1.6);
  revealCards(shown, { y: 28, stagger: 0.04, delay: 0.1, kids: false });
  if (reduced()) return;
  growBars(cardsShown(), 0.4);
  popDots(shown.map((c) => c.querySelector('.av[data-presence]')).filter(Boolean), 0.4);
  shown.forEach((c, i) => fadeUp(c.querySelectorAll('.mcard__info > *'), { y: 6, stagger: 0.012, delay: 0.4 + i * 0.04 }));
}

function startClock() {
  clearInterval(clock);
  tickClocks();
  clock = setInterval(tickClocks, 30_000);
}

const demoPage = {
  title: (params) => (params?.[0] && member(params[0])?.name) || 'People',
  mount(el) {
    root = el;
    root.classList.add('page-team');
    render();
    root.addEventListener('click', (e) => {
      const msg = e.target.closest('[data-msg]');
      if (msg) return openMessage(msg);
      const st = e.target.closest('[data-status]');
      if (st) return statusMenu(st);
      if (e.target.closest('[data-act="invite"]')) return invite();
    });
    subscribe('members', () => root.isConnected && reconcile());
    subscribe('tasks', () => root.isConnected && reconcile());
  },
  enter({ params, first, same }) {
    if (!same) {
      if (!first) render();
      startClock();
      intro();
      requestAnimationFrame(updateFilterFade);
    }
    const id = params?.[0];
    pendingOpen?.kill();
    pendingOpen = null;
    if (id) {
      if (id !== openId || !drawerOpen()) {
        const want = `#/team/${encodeURIComponent(id)}`;
        pendingOpen = gsap.delayedCall(same || reduced() ? 0 : 0.45, () => {
          pendingOpen = null;
          if (location.hash === want || decodeURIComponent(location.hash) === `#/team/${id}`) openProfile(id);
        });
      }
    } else if (openId && drawerOpen()) {
      closeDrawer();
    }
  },
  leave() {
    clearInterval(clock);
    clock = null;
    pendingOpen?.kill();
    pendingOpen = null;
    closePopover();
    if (openId && drawerOpen()) closeDrawer();
    openId = null;
  },
};

// =============================================================================
// Live mode: People = collaborators() from calendar attendees + mail senders.
// No local clocks, workload, invites or "your status" here: none of that exists
// in the connectors. Actions go through Gmail drafts and Calendar suggestions.
// =============================================================================
const ORG_HUES = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo'];
const orgOf = (m) => m.team || 'Other';
const orgHue = (org) => (org === 'Personal' ? 'teal' : ORG_HUES[[...org].reduce((a, c) => a + c.charCodeAt(0), 0) % ORG_HUES.length]);
const PAGE_SIZE = 48;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const firstOf = (m) => (m.name || m.email || '').split(/\s+/)[0];
const hhmmOf = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const pendingSource = (k) => {
  const s = state.live?.[k];
  return !s || s.status === 'loading';
};
const EV_HUE = { meeting: 'indigo', focus: 'purple', review: 'teal', deadline: 'pink', social: 'orange', personal: 'teal', ooo: 'orange', allday: 'indigo' };

const lp = {
  root: null, grid: null, notes: null, segWrap: null, seg: null,
  filter: 'all', query: '', limit: PAGE_SIZE, orgsKey: '', sig: '', keys: new Set(),
  openId: null, wantOpen: null, pending: null, raf: 0, dirty: false, popOpen: false, searchT: 0,
};

// ---------- free-slot parsing ----------
// suggest_time's payload shape isn't documented: walk it (bounded) and keep any
// object that carries a start and an end that both parse as dates. Nothing is logged.
const SLOT_START = ['start', 'startTime', 'start_time', 'startDateTime', 'begin'];
const SLOT_END = ['end', 'endTime', 'end_time', 'endDateTime', 'finish'];
function toMs(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
  if (typeof v === 'string') return /\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  if (typeof v === 'object') return toMs(v.dateTime ?? v.date_time ?? v.iso ?? v.date);
  return NaN;
}
export function parseSlots(payload, limit = 5) {
  const out = [];
  const seen = new Set();
  let budget = 4000;
  const visit = (node, depth) => {
    if (depth > 9 || --budget < 0 || node == null) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if ((t[0] === '{' || t[0] === '[') && t.length < 300_000) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {}
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const sk = SLOT_START.find((k) => k in node);
    const ek = SLOT_END.find((k) => k in node);
    if (sk && ek) {
      const s = toMs(node[sk]);
      const e = toMs(node[ek]);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        if (!seen.has(s)) {
          seen.add(s);
          out.push({ start: s, end: e });
        }
        return;
      }
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(payload, 0);
  const floor = Date.now() - 5 * 60000;
  return out.filter((s) => s.start >= floor).sort((a, b) => a.start - b.start).slice(0, limit);
}

// ---------- data ----------
function topOrgs(list) {
  const n = new Map();
  list.forEach((m) => n.set(orgOf(m), (n.get(orgOf(m)) || 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([o]) => o);
}

function matches(m) {
  const q = lp.query.trim().toLowerCase();
  if (lp.filter !== 'all' && orgOf(m) !== lp.filter) return false;
  return !q || (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
}

/** person id → their next shared meeting (events are sorted by start). */
function nextShared() {
  const now = Date.now();
  const map = new Map();
  for (const e of state.events) {
    if (e.start <= now || e.allDay) continue;
    for (const a of e.attendees || []) if (a !== 'me' && !map.has(a)) map.set(a, e);
  }
  return map;
}

function liveStats(list) {
  return {
    people: list.length,
    meeting: list.filter((m) => m.presence === 'meeting').length,
    orgs: new Set(list.map(orgOf)).size,
  };
}

// ---------- card ----------
const dayChip = (e) => {
  const d = new Date(e.start);
  return `<span class="prof__day hue--${EV_HUE[e.kind] || 'indigo'}" aria-hidden="true"><small>${d.toLocaleDateString('en-US', { weekday: 'short' })}</small><b>${d.getDate()}</b></span>`;
};

function personCard(m, next) {
  const org = orgOf(m);
  const hue = orgHue(org);
  const href = `#/team/${encodeURIComponent(m.id)}`;
  const meet = m.presence === 'meeting';
  const nextHtml = next
    ? `<button type="button" class="pcard__next" data-event="${esc(next.id)}" aria-label="${esc(`Next meeting together: ${next.title}, ${dayLabel(next.start)} at ${fmtTime(next.start)}`)}">
        ${dayChip(next)}
        <span class="prof__txt"><small>Next together</small><b>${esc(next.title)}</b><small>${dayLabel(next.start)} · ${fmtTime(next.start)}</small></span>
      </button>`
    : `<p class="pcard__next is-none">${icon('calendar')}No upcoming meeting together</p>`;
  return `<article class="mcard pcard glass hue--${hue}" data-key="${esc(m.id)}" data-lift>
    <div class="mcard__top">
      ${avatar(m.id, 'lg', { presence: meet })}
      <div class="mcard__id">
        <h3 class="mcard__name"><a href="${href}">${esc(m.name)}</a></h3>
        <p class="mcard__role">${esc(m.email)}</p>
      </div>
      <span class="pchip hue--${hue} mcard__team">${esc(org)}</span>
    </div>
    <dl class="pcard__facts">
      <div><dt>${icon('chart')}<span class="sr">Interactions</span></dt><dd>${plural(m.meetings || 0, 'meeting')} · ${plural(m.mails || 0, 'email')} <small>(90 days)</small></dd></div>
      <div><dt>${icon('clock')}<span class="sr">Last interaction</span></dt><dd>${m.lastSeen ? `Last contact ${relTime(m.lastSeen)}` : 'No contact yet'}</dd></div>
      ${meet ? `<div class="pcard__now"><dt><i class="presence-dot presence--meeting"></i><span class="sr">Presence</span></dt><dd>In a meeting with you now</dd></div>` : ''}
    </dl>
    ${nextHtml}
    <footer class="mcard__foot">
      <div class="mcard__acts">
        <button type="button" class="btn btn--glass btn--sm" data-mail="${esc(m.id)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(`Email ${m.name}`)}">${icon('mail')}Email</button>
        <button type="button" class="btn btn--glass btn--sm" data-find="${esc(m.id)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(`Find a time with ${m.name}`)}">${icon('calendar')}Find a time</button>
      </div>
      <a class="btn btn--ghost btn--sm" href="${href}" aria-label="${esc(`Profile of ${m.name}`)}">Profile</a>
    </footer>
  </article>`;
}

const skeletonCards = (n = 6) =>
  Array.from({ length: n }, () => `<div class="mcard pcard pcard--skel glass" aria-hidden="true">
    <div class="mcard__top"><span class="skel pcard__skav"></span><div class="mcard__id"><span class="skel pcard__skl"></span><span class="skel pcard__skl is-short"></span></div></div>
    <span class="skel pcard__skl"></span><span class="skel pcard__skbox"></span></div>`).join('');

// ---------- head ----------
function updateLiveHead(list) {
  const s = liveStats(list);
  const sub = lp.root.querySelector('.head__sub');
  if (sub) sub.textContent = s.people ? `${plural(s.people, 'person')} from your calendar and inbox` : 'From your calendar and inbox';
  const vals = [s.people, s.meeting, s.orgs];
  lp.root.querySelectorAll('.head__stats [data-count]').forEach((b, i) => {
    if (+b.dataset.count === vals[i]) return;
    b.dataset.count = vals[i];
    countTo(b, vals[i]);
  });
}

function renderOrgSeg(list) {
  const orgs = topOrgs(list);
  const key = orgs.join('|');
  if (key === lp.orgsKey && lp.seg) return;
  lp.orgsKey = key;
  if (lp.filter !== 'all' && !orgs.includes(lp.filter)) lp.filter = 'all';
  lp.segWrap.hidden = orgs.length < 2;
  lp.segWrap.innerHTML = segmented('Filter by organisation', [['all', 'All'], ...orgs.map((o) => [esc(o), esc(o)])], esc(lp.filter), 'tfilter');
  lp.seg = bindSegmented(lp.segWrap.querySelector('.tfilter'), (v) => setLiveFilter(v));
  updateFilterFade();
}

// ---------- grid ----------
function renderLive({ animate = false } = {}) {
  if (!lp.root) return;
  lp.notes.innerHTML = sourceNote('calendar') + sourceNote('gmail');
  const all = collaborators();
  updateLiveHead(all);
  renderOrgSeg(all);
  // Keep an open composer/slot picker anchored: refresh once it closes.
  if (lp.popOpen) {
    lp.dirty = true;
    return;
  }
  const loading = !all.length && (pendingSource('calendar') || pendingSource('gmail'));
  lp.grid.setAttribute('aria-busy', String(loading));
  const list = all.filter(matches);
  const shown = list.slice(0, lp.limit);
  const next = nextShared();
  const sig = loading
    ? 'loading'
    : JSON.stringify([lp.filter, lp.query, lp.limit, list.length, all.length, shown.map((m) => [m.id, m.name, m.team, m.presence, m.meetings, m.mails, Math.floor((m.lastSeen || 0) / 60000), next.get(m.id)?.id])]);
  if (sig === lp.sig) return;
  lp.sig = sig;

  // Restore focus to the same control after the rebuild.
  const act = document.activeElement;
  const focusKey = act && lp.grid.contains(act) ? act.closest('[data-key]')?.dataset.key : null;
  const focusSel = focusKey ? (act.matches('[data-mail]') ? '[data-mail]' : act.matches('[data-find]') ? '[data-find]' : act.matches('[data-event]') ? '[data-event]' : '.mcard__name a') : null;

  if (loading) {
    lp.grid.innerHTML = skeletonCards();
    lp.keys.clear();
    return;
  }
  let html = shown.map((m) => personCard(m, next.get(m.id))).join('');
  if (!all.length) {
    const failed = ['calendar', 'gmail'].every((k) => ['error', 'off'].includes(state.live?.[k]?.status));
    html = `<div class="tgrid-empty">${emptyState(
      failed ? 'Your connectors are unavailable' : 'No collaborators yet',
      failed ? 'Connect Google Calendar or Gmail to see the people you work with.' : 'People you meet with or who email you will show up here.',
      'users',
    )}</div>`;
  } else if (!list.length) {
    html = `<div class="tgrid-empty">${emptyState(
      'No matches',
      lp.query.trim() ? `Nobody matches “${lp.query.trim()}”.` : 'Nobody in this organisation.',
      'search',
      `<button type="button" class="btn btn--glass btn--sm" data-act="clear">Show everyone</button>`,
    )}</div>`;
  } else if (list.length > shown.length) {
    html += `<div class="tgrid-more"><button type="button" class="btn btn--glass btn--sm" data-act="more">Show ${Math.min(PAGE_SIZE, list.length - shown.length)} more</button><small class="faint">${shown.length} of ${list.length}</small></div>`;
  }
  lp.grid.innerHTML = html;

  const fresh = [...lp.grid.querySelectorAll('.pcard')].filter((c) => !lp.keys.has(c.dataset.key));
  lp.keys = new Set(shown.map((m) => m.id));
  if (animate && fresh.length) {
    animating(1.4);
    revealCards(fresh, { y: 18, stagger: 0.03, kids: false });
  }
  if (focusSel) lp.grid.querySelector(`.pcard[data-key="${CSS.escape(focusKey)}"] ${focusSel}`)?.focus({ preventScroll: true });
}

function scheduleLive() {
  if (!lp.root) return;
  if (lp.root.hidden) {
    lp.dirty = true;
    return;
  }
  cancelAnimationFrame(lp.raf);
  lp.raf = requestAnimationFrame(() => {
    renderLive({ animate: true });
    tryPendingProfile();
  });
}

function setLiveFilter(v) {
  if (v === lp.filter) return;
  lp.filter = v;
  lp.limit = PAGE_SIZE;
  const old = [...lp.grid.querySelectorAll('.pcard, .tgrid-empty, .tgrid-more')];
  lp.keys.clear();
  collapseOut(old, () => {
    lp.sig = '';
    renderLive({ animate: true });
  }, { duration: 0.16 });
}

// ---------- email composer (Gmail draft) ----------
function mailForm(m) {
  const id = uid('pm');
  return `<form class="msg pmail" novalidate>
    <div class="msg__to">${avatar(m.id, 'sm')}<span>Draft to <b>${esc(m.name)}</b></span></div>
    <label class="sr" for="${id}-s">Subject</label>
    <input class="input pmail__subj" id="${id}-s" name="subject" placeholder="Subject" autocomplete="off" maxlength="300">
    <label class="sr" for="${id}-b">Message</label>
    <textarea class="msg__text" id="${id}-b" name="body" rows="4" placeholder="Write to ${esc(firstOf(m))}…"></textarea>
    <div class="msg__foot"><small class="faint">Saved as a Gmail draft. Nothing is sent.</small>
      <button type="submit" class="btn btn--accent btn--sm">${icon('mail')}Create draft</button></div>
  </form>`;
}

function wireMail(form, m, onDone) {
  const subj = form.querySelector('[name="subject"]');
  const body = form.querySelector('[name="body"]');
  const btn = form.querySelector('[type="submit"]');
  const submit = async () => {
    if (btn.disabled) return;
    const subject = subj.value.trim();
    const text = body.value.trim();
    if (!subject && !text) {
      subj.focus();
      if (!reduced()) gsap.fromTo(form, { x: -6 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    btn.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const r = await liveAction(() => draft({ to: [m.email], subject, body: text }), {
      busy: 'Creating the draft in Gmail…',
      done: `Draft to ${firstOf(m)} is waiting in Gmail`,
      server: 'Gmail',
      ico: 'mail',
    });
    btn.disabled = false;
    form.removeAttribute('aria-busy');
    if (r && form.isConnected) onDone();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit().catch(() => {});
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit().catch(() => {});
    }
  });
  if (matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => subj.focus());
}

// ---------- find a time ----------
function slotsHtml(m, slots) {
  return `<div class="pslots" role="group" aria-label="${esc(`Free times with ${firstOf(m)}`)}">
    <p class="pslots__lead">${icon('calendar')}<span>Free for 30 min with <b>${esc(firstOf(m))}</b></span></p>
    <ul>${slots
      .map((s) => `<li><button type="button" class="pslot" data-slot="${s.start}"><b>${dayLabel(s.start)}</b><span>${fmtTime(s.start)} – ${fmtTime(s.end)}</span>${icon('chevronRight')}</button></li>`)
      .join('')}</ul>
    <button type="button" class="btn btn--ghost btn--sm" data-slot="any">Pick another time</button>
  </div>`;
}

function wireSlots(container, m, onPick) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    onPick();
    if (b.dataset.slot === 'any') return newEvent({ guests: m.email });
    const t = +b.dataset.slot;
    newEvent({ date: new Date(t), time: hhmmOf(t), guests: m.email });
  });
  if (matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => container.querySelector('.pslot')?.focus());
}

/** Resolves the parsed slots, [] when nothing parseable came back, null on failure. */
async function fetchSlots(m, btn) {
  if (btn.dataset.busy) return null;
  btn.dataset.busy = '1';
  btn.setAttribute('aria-busy', 'true');
  try {
    const payload = await liveAction(() => suggestTimes([m.email], 30), {
      busy: `Checking free times with ${firstOf(m)}…`,
      server: 'Google Calendar',
      ico: 'calendar',
    });
    if (payload === null) return null;
    const slots = parseSlots(payload);
    if (slots.length) notify(`${plural(slots.length, 'free time')} with ${firstOf(m)}`, { ico: 'calendar', tone: 'info' });
    else {
      notify('No suggestion came back. Pick a time yourself.', { ico: 'calendar', tone: 'info', hold: 3.5 });
      newEvent({ guests: m.email });
    }
    return slots;
  } finally {
    delete btn.dataset.busy;
    btn.removeAttribute('aria-busy');
  }
}

// ---------- popovers from cards ----------
function cardPopover(btn, html, label, wire) {
  bounceIcon(btn);
  lp.popOpen = true;
  const el = openPopover(btn, html, {
    cls: 'pop--msg',
    align: 'end',
    label,
    onClose() {
      lp.popOpen = false;
      if (lp.dirty) {
        lp.dirty = false;
        scheduleLive();
      }
    },
  });
  if (!el) {
    lp.popOpen = false;
    return;
  }
  wire(el);
}

function openMailFor(btn) {
  const m = member(btn.dataset.mail);
  if (!m) return;
  cardPopover(btn, mailForm(m), `Email ${m.name}`, (el) =>
    wireMail(el.querySelector('form'), m, () => {
      closePopover();
      btn.focus();
    }),
  );
}

async function openFindFor(btn) {
  const m = member(btn.dataset.find);
  if (!m) return;
  const wasOpen = btn.getAttribute('aria-expanded') === 'true';
  closePopover();
  if (wasOpen) return;
  const slots = await fetchSlots(m, btn);
  if (!slots?.length || !btn.isConnected || lp.root.hidden) return;
  cardPopover(btn, slotsHtml(m, slots), `Free times with ${m.name}`, (el) => wireSlots(el, m, () => closePopover()));
}

// ---------- profile drawer ----------
function evRow(e) {
  const when = e.allDay ? dayLabel(e.start) : `${dayLabel(e.start)} · ${fmtTime(e.start)}`;
  const kind = KIND[e.kind] && e.kind !== 'meeting' ? ` · ${KIND[e.kind]}` : '';
  return `<li><button type="button" class="prof__row" data-event="${esc(e.id)}">${dayChip(e)}
    <span class="prof__txt"><b>${esc(e.title)}</b><small>${when}${kind}</small></span></button></li>`;
}

function liveProfileHtml(m) {
  const now = Date.now();
  const shared = state.events.filter((e) => (e.attendees || []).includes(m.id));
  const upcoming = shared.filter((e) => e.start > now).sort((a, b) => a.start - b.start).slice(0, 5);
  const recent = shared.filter((e) => e.start <= now).sort((a, b) => b.start - a.start).slice(0, 5);
  const threads = state.threads.filter((t) => t.from === m.id).sort((a, b) => b.at - a.at).slice(0, 6);
  const org = orgOf(m);
  const hue = orgHue(org);
  const meet = m.presence === 'meeting';
  const list = (rows, none, ico) => (rows.length ? `<ul class="prof__list">${rows.join('')}</ul>` : `<p class="prof__none">${icon(ico)}${none}</p>`);
  const threadRows = threads.map(
    (t) => `<li><a class="prof__proj" href="#/inbox/${encodeURIComponent(t.id)}">${icon('mail')}
      <span class="prof__txt"><b>${esc(t.subject)}</b><small>${relTime(t.at)}${t.snippet ? ` · ${esc(t.snippet)}` : ''}</small></span>
      ${t.unread ? '<span class="badge">New</span>' : ''}</a></li>`,
  );
  return `<article class="prof hue--${hue}">
    <header class="prof__hero">
      ${avatar(m.id, 'xl', { presence: meet, extra: 'prof__av' })}
      <div class="prof__who">
        <h2 class="prof__name">${esc(m.name)}</h2>
        <p class="prof__role">${esc(m.email)}</p>
        <div class="prof__chips"><span class="pchip hue--${hue}">${esc(org)}</span>${
          meet ? `<span class="mcard__presence"><i class="presence-dot presence--meeting"></i>In a meeting with you</span>` : ''
        }</div>
      </div>
    </header>
    <dl class="prof__meta">
      <div><dt>Meetings together</dt><dd>${m.meetings || 0} <span class="faint">· 90 days</span></dd></div>
      <div><dt>Emails in your inbox</dt><dd>${m.mails || 0}</dd></div>
      <div><dt>Last contact</dt><dd>${m.lastSeen ? relTime(m.lastSeen) : 'None yet'}</dd></div>
    </dl>
    <section class="prof__block"><h3>Coming up together <span class="badge">${upcoming.length}</span></h3>${list(upcoming.map(evRow), 'Nothing scheduled together.', 'calendar')}</section>
    <section class="prof__block"><h3>Recent meetings <span class="badge">${recent.length}</span></h3>${list(recent.map(evRow), 'No meetings in the last 90 days.', 'clock')}</section>
    <section class="prof__block"><h3>Recent threads <span class="badge">${threads.length}</span></h3>${list(threadRows, 'No recent mail from them in your inbox.', 'mail')}</section>
    <footer class="prof__foot">
      <button type="button" class="btn btn--accent" data-pmail aria-expanded="false">${icon('mail')}Email</button>
      <button type="button" class="btn btn--glass" data-pfind aria-expanded="false">${icon('calendar')}Find a time</button>
      <a class="btn btn--glass" href="#/inbox">${icon('search')}Search mail</a>
      <div class="prof__compose" hidden></div>
    </footer>
  </article>`;
}

function liveResetHash() {
  if (!location.hash.startsWith('#/team/')) return;
  history.replaceState(null, '', '#/team');
  document.title = 'People · Lumen';
  const ct = document.getElementById('compact-title');
  if (ct) ct.textContent = 'People';
}

function openLiveProfile(id) {
  const key = String(id).toLowerCase();
  const m = member(key);
  if (!m || m.id === 'me') {
    if (!m && (pendingSource('calendar') || pendingSource('gmail'))) {
      lp.wantOpen = key; // data still arriving; tryPendingProfile retries.
      return;
    }
    lp.wantOpen = null;
    liveResetHash();
    notify("That person isn't in your calendar or inbox", { ico: 'x', tone: 'warn' });
    return;
  }
  lp.wantOpen = null;
  lp.openId = m.id;
  openDrawer(liveProfileHtml(m), {
    label: `${m.name}, profile`,
    onClose() {
      if (lp.openId === m.id) lp.openId = null;
      liveResetHash();
    },
    onMount(body) {
      const box = body.querySelector('.prof__compose');
      const mailBtn = body.querySelector('[data-pmail]');
      const findBtn = body.querySelector('[data-pfind]');
      const closeBox = () => {
        box.hidden = true;
        box.innerHTML = '';
        delete box.dataset.mode;
        mailBtn.setAttribute('aria-expanded', 'false');
        findBtn.setAttribute('aria-expanded', 'false');
      };
      const showBox = (mode, html, btn) => {
        closeBox();
        box.dataset.mode = mode;
        box.innerHTML = html;
        box.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        fadeUp([box], { y: 10, duration: 0.4 });
      };
      const onFind = async () => {
        if (box.dataset.mode === 'slots') return closeBox();
        const slots = await fetchSlots(m, findBtn);
        if (!slots?.length || !box.isConnected) return;
        showBox('slots', slotsHtml(m, slots), findBtn);
        wireSlots(box, m, closeBox);
      };
      body.addEventListener('click', (e) => {
        const ev = e.target.closest('[data-event]');
        if (ev) {
          lp.openId = null;
          liveResetHash();
          return openEvent(ev.dataset.event);
        }
        if (e.target.closest('a[href^="#/"]')) {
          // Leaving for the inbox: the drawer goes with us.
          lp.openId = null;
          closeDrawer();
          return;
        }
        if (e.target.closest('[data-pmail]')) {
          bounceIcon(mailBtn);
          if (box.dataset.mode === 'mail') return closeBox();
          showBox('mail', mailForm(m), mailBtn);
          wireMail(box.querySelector('form'), m, () => {
            closeBox();
            mailBtn.focus();
          });
          return;
        }
        if (e.target.closest('[data-pfind]')) onFind().catch(() => {});
      });
    },
  });
}

function tryPendingProfile() {
  const id = lp.wantOpen;
  if (!id || !location.hash.startsWith('#/team/')) return;
  if (member(id) || (!pendingSource('calendar') && !pendingSource('gmail'))) openLiveProfile(id);
}

// ---------- page ----------
function renderLiveShell() {
  const all = collaborators();
  const s = liveStats(all);
  const actions = `<div class="tfilter-wrap" hidden></div>
    <label class="psearch">${icon('search')}<span class="sr">Search people by name or email</span>
      <input class="input" type="search" name="q" placeholder="Search name or email" autocomplete="off" spellcheck="false" value="${esc(lp.query)}"></label>`;
  lp.root.innerHTML = `${pageHead({
    title: 'People',
    sub: 'From your calendar and inbox',
    actions,
    stats: [
      { label: 'People', value: s.people },
      { label: 'In a meeting with you now', value: s.meeting },
      { label: 'Orgs', value: s.orgs },
    ],
  })}<div class="pnotes"></div><div class="tgrid" aria-busy="false"></div>`;
  lp.grid = lp.root.querySelector('.tgrid');
  grid = lp.grid; // shared helpers (animating) work on the grid in view
  lp.notes = lp.root.querySelector('.pnotes');
  lp.segWrap = lp.root.querySelector('.tfilter-wrap');
  lp.seg = null;
  lp.orgsKey = '';
  lp.sig = '';
  lp.keys.clear();
  lp.segWrap.addEventListener('scroll', updateFilterFade, { passive: true });
  new ResizeObserver(updateFilterFade).observe(lp.segWrap);
  const input = lp.root.querySelector('.psearch input');
  input.addEventListener('input', () => {
    clearTimeout(lp.searchT);
    lp.searchT = setTimeout(() => {
      lp.query = input.value;
      lp.limit = PAGE_SIZE;
      renderLive({ animate: true });
    }, 140);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      lp.query = '';
      renderLive({ animate: true });
    }
  });
  renderLive();
}

const livePage = {
  title: (params) => (params?.[0] && member(String(params[0]).toLowerCase())?.name) || 'People',
  mount(el) {
    lp.root = root = el;
    el.classList.add('page-team', 'page-people');
    renderLiveShell();
    el.addEventListener('click', (e) => {
      const mb = e.target.closest('[data-mail]');
      if (mb) return openMailFor(mb);
      const fb = e.target.closest('[data-find]');
      if (fb) return void openFindFor(fb).catch(() => {});
      const ev = e.target.closest('.pcard [data-event]');
      if (ev) return openEvent(ev.dataset.event);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'more') {
        lp.limit += PAGE_SIZE;
        renderLive({ animate: true });
      }
      if (act === 'clear') {
        lp.query = '';
        const input = el.querySelector('.psearch input');
        if (input) input.value = '';
        lp.seg?.select('all', { silent: true });
        lp.filter = 'all';
        lp.limit = PAGE_SIZE;
        renderLive({ animate: true });
      }
    });
    ['members', 'events', 'threads', 'live'].forEach((t) => subscribe(t, scheduleLive));
  },
  enter({ params, same }) {
    if (!same) {
      if (lp.dirty) {
        lp.dirty = false;
        renderLive();
      }
      headIntro(lp.root);
      const shown = [...lp.grid.querySelectorAll('.pcard')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0;
      });
      animating(1.6);
      revealCards(shown, { y: 28, stagger: 0.04, delay: 0.1, kids: false });
      requestAnimationFrame(updateFilterFade);
    }
    const id = params?.[0] ? String(params[0]).toLowerCase() : null;
    lp.pending?.kill();
    lp.pending = null;
    if (id) {
      if (id !== lp.openId || !drawerOpen()) {
        lp.pending = gsap.delayedCall(same || reduced() ? 0 : 0.45, () => {
          lp.pending = null;
          if (location.hash.startsWith('#/team/') && decodeURIComponent(location.hash.slice(7)).toLowerCase() === id) openLiveProfile(id);
        });
      }
    } else {
      lp.wantOpen = null;
      if (lp.openId && drawerOpen()) closeDrawer();
    }
  },
  leave() {
    lp.pending?.kill();
    lp.pending = null;
    lp.wantOpen = null;
    closePopover();
    if (lp.openId && drawerOpen()) closeDrawer();
    lp.openId = null;
  },
};

export const page = state.demo ? demoPage : livePage;
