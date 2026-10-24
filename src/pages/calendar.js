// Calendar: a month grid with a springy selection ring beside a sticky day
// agenda, and a week timeline (8:00–19:00) with overlap lanes. All-day events
// sit as bars on top of a day (month) or in their own row (week). In live mode
// events are coloured by calendar, and a legend hides calendars locally.
import '../styles/pages/calendar.css';

import { gsap, reduced, revealTitle, revealCards, collapseOut, fadeUp, popIn } from '../lib/motion.js';
import { esc, icon, startOfDay, addDays, sameDay, fmtTime, weekday } from '../lib/dom.js';
import { state, subscribe, project, boardTasks } from '../store.js';
import { pageHead, headIntro, card, avatarStack, segmented, bindSegmented, sourceNote } from '../ui/components.js';
import { newEvent, openEvent, openTask, toggleDone, KIND } from '../ui/overlays.js';

// ---------- constants ----------
const H0 = 8;
const H1 = 19;
const SPAN = H1 - H0;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MAX_DUE = 5;

const KINDS = {
  meeting: { hue: 'indigo', ico: 'users', label: 'Meeting' },
  focus: { hue: 'purple', ico: 'moon', label: 'Focus block' },
  review: { hue: 'teal', ico: 'sparkle', label: 'Review' },
  deadline: { hue: 'pink', ico: 'flag', label: 'Deadline' },
  social: { hue: 'orange', ico: 'message', label: 'Team' },
  personal: { hue: 'teal', ico: 'user', label: KIND.personal },
  ooo: { hue: 'orange', ico: 'globe', label: KIND.ooo },
  allday: { hue: 'indigo', ico: 'sun', label: KIND.allday },
};
const kindOf = (e) => KINDS[e.kind] || KINDS.meeting;

// ---------- live calendars ----------
const LIVE_MODE = !state.demo;
const CAL_HUES = ['blue', 'purple', 'teal', 'orange', 'pink', 'green', 'indigo'];
const HIDDEN_KEY = 'lumen:cal-hidden';
function loadHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
const hidden = loadHidden();
function saveHidden() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {}
}
function calHue(id) {
  const i = state.calendars.findIndex((c) => c.id === id);
  return CAL_HUES[Math.max(0, i) % CAL_HUES.length];
}
// Live events have no project: colour by calendar (or kind when unknown).
const hueOf = (e) => (LIVE_MODE ? (e.calendarId ? calHue(e.calendarId) : kindOf(e).hue) : project(e.projectId)?.hue || kindOf(e).hue);
const shownEvents = () => (LIVE_MODE && hidden.size ? state.events.filter((e) => !hidden.has(e.calendarId)) : state.events);
/** Calendars that actually feed events, in the user's calendar order. */
function feedingCalendars() {
  const ids = new Set(state.events.map((e) => e.calendarId));
  return state.calendars.filter((c) => ids.has(c.id));
}
const calLoading = () => LIVE_MODE && state.live?.calendar?.status === 'loading' && !state.events.length;
const pendingRsvp = (e) => e.rsvp === 'needsAction';
/** Shared state classes for pills, blocks and agenda rows. */
function evCls(e, now) {
  let c = '';
  if (e.end <= now) c += ' is-past';
  if (pendingRsvp(e)) c += ' is-pending';
  if (e.rsvp === 'declined') c += ' is-declined';
  if (e.kind === 'ooo') c += ' is-ooo';
  return c;
}
const pendingMark = (e) => (pendingRsvp(e) ? '<span class="cal-q" aria-hidden="true">?</span>' : '');
const ariaExtra = (e) => (pendingRsvp(e) ? ', invitation awaiting your answer' : e.rsvp === 'declined' ? ', declined' : '');

// ---------- date helpers ----------
const sod = (d) => startOfDay(d).getTime();
const weekStartDay = () => state.settings?.weekStart ?? 1;
const startOfWeek = (d) => {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() - weekStartDay() + 7) % 7));
};
const firstOfMonth = (d) => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), 1);
const sameMonth = (a, b) => new Date(a).getMonth() === new Date(b).getMonth() && new Date(a).getFullYear() === new Date(b).getFullYear();
function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getDate();
  const t = new Date(x.getFullYear(), x.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return t;
}
const monthName = (d, style = 'long') => new Date(d).toLocaleDateString('en-US', { month: style });
const longDay = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
const hourLabel = (h) => (h === 12 ? 'Noon' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function lengthLabel(e) {
  if (e.allDay) {
    const days = Math.max(1, Math.round((e.end - e.start) / DAY));
    return days > 1 ? `${days} days` : 'All day';
  }
  const min = Math.round((e.end - e.start) / 60000);
  return min < 60 ? `${min} min` : `${+(min / 60).toFixed(1)} h`;
}
const placeLabel = (e) => (e.place === 'video' ? 'Video call' : e.place || '');

function relDay(ts) {
  const n = Math.round((ts - sod(new Date())) / DAY);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return weekday(ts, 'long');
}

// ---------- module state ----------
let root;
let view = 'month';
let selected = sod(new Date());
let cursor = firstOfMonth(new Date());
let dirty = false;
let navTween = null;
let armed = false;
let armCall = null;
let nowCall = null;
let seg = null;
const el = {};

// ---------- data helpers ----------
function milestonesByDay() {
  const map = new Map();
  for (const p of state.projects) {
    for (const m of p.milestones || []) {
      const k = sod(m.due);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ ...m, project: p });
    }
  }
  return map;
}

// Timed events by start day (all-day ones live in allDayByDay).
function eventsByDay(from, days) {
  const map = new Map();
  const a = from;
  const b = addDays(new Date(from), days).getTime();
  shownEvents()
    .filter((e) => !e.allDay && e.start >= a && e.start < b)
    .sort((x, y) => x.start - y.start)
    .forEach((e) => {
      const k = sod(e.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
  return map;
}

// All-day events on every day they cover (multi-day ones repeat).
function allDayByDay(from, days) {
  const map = new Map();
  const evs = shownEvents().filter((e) => e.allDay);
  if (!evs.length) return map;
  for (let i = 0; i < days; i++) {
    const d = addDays(new Date(from), i);
    const a = d.getTime();
    const b = addDays(d, 1).getTime();
    const on = evs.filter((e) => e.start < b && e.end > a);
    if (on.length) map.set(a, on);
  }
  return map;
}

/** One day for the agenda: all-day first, then timed by start. */
function dayEvents(ts) {
  const b = addDays(new Date(ts), 1).getTime();
  const evs = shownEvents();
  const ad = evs.filter((e) => e.allDay && e.start < b && e.end > ts);
  const timed = evs.filter((e) => !e.allDay && e.start >= ts && e.start < b).sort((x, y) => x.start - y.start);
  return [...ad, ...timed];
}

function tasksDueOn(ts) {
  return boardTasks()
    .filter((t) => t.due >= ts && t.due < ts + DAY)
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.due - b.due);
}

function eventsThisWeek() {
  const a = startOfWeek(new Date()).getTime();
  return shownEvents().filter((e) => e.start >= a && e.start < a + 7 * DAY).length;
}

// Split one day's events into clusters of overlapping events, then give each
// a lane; every member of a cluster shares the cluster's lane count.
function layoutLanes(evs) {
  const out = [];
  let cluster = [];
  let lanes = [];
  let maxEnd = -Infinity;
  const flush = () => {
    cluster.forEach((o) => (o.of = lanes.length));
    cluster = [];
    lanes = [];
  };
  for (const e of evs) {
    const end = Math.max(e.end, e.start + 15 * 60000);
    if (e.start >= maxEnd) {
      flush();
      maxEnd = -Infinity;
    }
    let lane = lanes.findIndex((x) => x <= e.start);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(end);
    } else lanes[lane] = end;
    const o = { e, lane, of: 1 };
    cluster.push(o);
    out.push(o);
    maxEnd = Math.max(maxEnd, end);
  }
  flush();
  return out;
}

// ---------- header ----------
function titleText() {
  if (view === 'month') return `${monthName(cursor)} ${cursor.getFullYear()}`;
  const a = startOfWeek(cursor);
  const b = addDays(a, 6);
  if (sameMonth(a, b)) return `${monthName(a)} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${monthName(a, 'short')} – ${monthName(b, 'short')} ${b.getFullYear()}`;
  return `${monthName(a, 'short')} ${a.getFullYear()} – ${monthName(b, 'short')} ${b.getFullYear()}`;
}

function setTitle(animate) {
  const h = root.querySelector('.head__title');
  const text = titleText();
  if ((h.getAttribute('aria-label') || h.textContent) === text) return;
  delete h.dataset.split;
  h.removeAttribute('aria-label');
  h.textContent = text;
  if (animate) revealTitle(h);
  el.live.textContent = text;
}

function updateSub() {
  const n = eventsThisWeek();
  const pending = shownEvents().filter((e) => pendingRsvp(e) && e.end > Date.now()).length;
  root.querySelector('.head__sub').textContent = calLoading()
    ? 'Loading your calendar…'
    : `${plural(n, 'event')} this week${pending ? ` · ${plural(pending, 'invitation')} to answer` : ''}`;
}

// ---------- source note + calendar legend ----------
function legendHtml() {
  if (!LIVE_MODE) return '';
  const cals = feedingCalendars();
  if (!cals.length) return '';
  return `<div class="cal-legend" role="group" aria-label="Calendars shown">${cals
    .map((c) => {
      const on = !hidden.has(c.id);
      return `<button type="button" class="cal-chip hue--${calHue(c.id)}" data-cal="${esc(c.id)}" aria-pressed="${on}" title="${esc(`${on ? 'Hide' : 'Show'} ${c.summary}`)}"><i aria-hidden="true"></i><span>${esc(c.summary)}</span></button>`;
    })
    .join('')}</div>`;
}

let topSig = '';
function renderTop() {
  const html = sourceNote('calendar') + legendHtml();
  if (html === topSig) return;
  topSig = html;
  // Keep keyboard focus on a legend chip across the rebuild.
  const focusCal = document.activeElement?.closest?.('.cal-top [data-cal]')?.dataset.cal;
  for (const slot of [el.monthTop, el.wkTop]) {
    slot.innerHTML = html;
    slot.hidden = !html;
  }
  if (focusCal) {
    const card = view === 'month' ? el.monthTop : el.wkTop;
    [...card.querySelectorAll('[data-cal]')].find((b) => b.dataset.cal === focusCal)?.focus();
  }
}

function toggleCalendar(id) {
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  saveHidden();
  topSig = '';
  renderTop();
  renderView();
  if (view === 'week') renderAgenda();
  updateSub();
  if (view === 'month') placeRing();
}

function updateNavLabels() {
  const unit = view === 'month' ? 'month' : 'week';
  root.querySelector('[data-nav="-1"]').setAttribute('aria-label', `Previous ${unit}`);
  root.querySelector('[data-nav="-1"]').title = `Previous ${unit}`;
  root.querySelector('[data-nav="1"]').setAttribute('aria-label', `Next ${unit}`);
  root.querySelector('[data-nav="1"]').title = `Next ${unit}`;
}

// ---------- month ----------
function renderMonth() {
  const start = startOfWeek(cursor);
  const evMap = eventsByDay(start.getTime(), 42);
  const adMap = allDayByDay(start.getTime(), 42);
  const msMap = milestonesByDay();
  const loading = calLoading();
  const today = sod(new Date());
  const now = Date.now();
  const wk = [];
  for (let i = 0; i < 7; i++) wk.push(`<span>${weekday(addDays(start, i))}</span>`);
  el.wd.innerHTML = wk.join('');

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const ts = d.getTime();
    const next = addDays(d, 1).getTime();
    const ad = adMap.get(ts) || [];
    const timed = evMap.get(ts) || [];
    const evs = [...ad, ...timed];
    const ms = msMap.get(ts) || [];
    const out = !sameMonth(d, cursor);
    const dow = d.getDay();
    const cls = [
      'cal-day',
      out && 'is-out',
      ts === today && 'is-today',
      (dow === 0 || dow === 6) && 'is-weekend',
      ts < today && 'is-past',
    ].filter(Boolean).join(' ');
    const invites = evs.filter(pendingRsvp).length;
    const label = [
      ts === today ? 'Today' : '',
      longDay(d),
      evs.length ? plural(evs.length, 'event') : loading ? 'loading' : 'no events',
      invites ? plural(invites, 'invitation') + ' to answer' : '',
      ...ms.map((m) => `milestone: ${m.title}`),
    ].filter(Boolean).join(', ');
    const more = evs.length > 3 ? `<span class="cal-more">+${evs.length - 3}<span class="cal-more__w"> more</span></span>` : '';
    const flags = ms
      .slice(0, 2)
      .map((m) => `<span class="cal-flag hue--${m.project.hue}${m.done ? ' is-done' : ''}" title="${esc(m.title)}">${icon('flag')}</span>`)
      .join('');
    // All-day bars first (squared where they continue), then timed pills.
    const bars = ad
      .slice(0, 3)
      .map((e) => `<span class="cal-ev cal-ev--bar hue--${hueOf(e)}${evCls(e, now)}${e.start < ts ? ' is-cont-l' : ''}${e.end > next ? ' is-cont-r' : ''}">${pendingMark(e)}${esc(e.title)}</span>`)
      .join('');
    const pills =
      bars +
      timed
        .slice(0, Math.max(0, 3 - ad.length))
        .map((e) => `<span class="cal-ev hue--${hueOf(e)}${evCls(e, now)}">${pendingMark(e)}${esc(e.title)}</span>`)
        .join('') +
      (loading && !out && (i * 7) % 5 < 2 ? `<span class="skel cal-skel" style="width:${55 + ((i * 37) % 40)}%"></span>` : '');
    const dots = evs
      .slice(0, 4)
      .map((e) => `<i class="hue--${hueOf(e)}${pendingRsvp(e) ? ' is-pending' : ''}"></i>`)
      .join('');
    html += `<button type="button" class="${cls}" data-day="${ts}" tabindex="${ts === selected ? 0 : -1}" aria-pressed="${ts === selected}"${
      ts === today ? ' aria-current="date"' : ''
    } aria-label="${esc(label)}">
      <span class="cal-day__top"><span class="cal-day__n">${d.getDate()}</span>${more}${flags ? `<span class="cal-day__flags">${flags}</span>` : ''}</span>
      <span class="cal-day__evs">${pills}</span>
      ${dots ? `<span class="cal-day__dots" aria-hidden="true">${dots}</span>` : ''}
    </button>`;
  }
  el.grid.innerHTML = html;
  el.grid.setAttribute('aria-label', titleText());
  // A selection outside the 42 cells would leave no tabbable cell.
  if (!el.grid.querySelector('[tabindex="0"]')) el.grid.querySelector('.cal-day:not(.is-out)')?.setAttribute('tabindex', '0');
}

const cells = () => [...el.grid.querySelectorAll('.cal-day')];
const selectedCell = () => el.grid.querySelector(`[data-day="${selected}"]`);

function cascade(delay, amount) {
  if (reduced()) return;
  gsap.fromTo(
    cells(),
    { opacity: 0, y: 10, scale: 0.94 },
    { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)', delay, stagger: { grid: [6, 7], from: 'start', amount }, clearProps: 'opacity,transform' },
  );
}

// ---------- selection ring ----------
function hideRing() {
  armed = false;
  armCall?.kill();
  armCall = null;
  gsap.killTweensOf(el.ring);
  if (reduced()) gsap.set(el.ring, { opacity: 0 });
  else gsap.to(el.ring, { opacity: 0, duration: 0.12, ease: 'power1.out' });
}

function armRing(delay = 0) {
  armCall?.kill();
  armCall = gsap.delayedCall(reduced() ? 0 : delay, () => {
    armCall = null;
    armed = true;
    placeRing();
  });
}

function placeRing({ animate = false } = {}) {
  if (!armed || view !== 'month') return;
  const cell = selectedCell();
  if (!cell || !cell.offsetWidth) {
    gsap.set(el.ring, { opacity: 0 });
    return;
  }
  const box = { x: cell.offsetLeft, y: cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight };
  const shown = gsap.getProperty(el.ring, 'opacity') > 0.5;
  if (!shown) {
    gsap.killTweensOf(el.ring);
    gsap.set(el.ring, box);
    if (reduced()) gsap.set(el.ring, { opacity: 1, scale: 1 });
    else gsap.fromTo(el.ring, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2.2)' });
    return;
  }
  if (!animate || reduced()) {
    gsap.set(el.ring, box);
    return;
  }
  gsap.to(el.ring, { ...box, duration: 0.6, ease: 'elastic.out(1, 0.78)', overwrite: 'auto' });
  gsap.fromTo(
    el.ring,
    { scale: 1 },
    { keyframes: [{ scale: 0.92, duration: 0.12, ease: 'power2.out' }, { scale: 1, duration: 0.55, ease: 'elastic.out(1, 0.5)' }], overwrite: 'auto' },
  );
}

// ---------- agenda ----------
function agendaBody() {
  const ts = selected;
  const now = Date.now();
  const isToday = ts === sod(new Date());
  const evs = dayEvents(ts);
  const ms = milestonesByDay().get(ts) || [];
  const due = tasksDueOn(ts);
  const showCal = LIVE_MODE && feedingCalendars().length - hidden.size > 1;

  if (calLoading() && !evs.length) {
    return `<div class="cal-skel-ag" aria-label="Loading events" role="status">${[0, 1, 2]
      .map(() => '<div class="cal-skel-ag__row"><span class="skel"></span><span class="skel"></span></div>')
      .join('')}</div>`;
  }

  if (!evs.length && !ms.length && !due.length) {
    return `<div class="cal-free">
      <span class="cal-free__ico">${icon('calendar')}</span>
      <b>A clear day</b><span>Nothing on the calendar${isToday ? ' today' : ''}.</span>
      <button type="button" class="btn btn--glass btn--sm" data-act="add">${icon('plus')}Add event</button>
    </div>`;
  }

  const msHtml = ms
    .map((m) => `<p class="cal-ms hue--${m.project.hue}${m.done ? ' is-done' : ''}"><span class="cal-ms__ico">${icon(m.done ? 'check' : 'flag')}</span>
      <span><b>${esc(m.title)}</b><small>${esc(m.project.name)} milestone</small></span></p>`)
    .join('');

  const items = evs.map((e) => {
    const k = kindOf(e);
    const live = !e.allDay && now >= e.start && now < e.end;
    const pending = pendingRsvp(e);
    const place = e.place
      ? `<span class="cal-tl__place">${icon(e.place === 'video' ? 'video' : 'pin')}${esc(placeLabel(e))}</span>`
      : '';
    const meet = e.meetUrl && /^https:\/\//i.test(e.meetUrl) && e.end > now ? e.meetUrl : null;
    const soon = live || (e.start > now && e.start - now < 10 * 60000);
    const acts =
      pending || meet
        ? `<div class="cal-tl__acts">${
            pending ? `<button type="button" class="btn btn--sm btn--glass cal-respond" data-event="${esc(e.id)}" aria-label="${esc(`Respond to ${e.title}`)}">${icon('message')}Respond</button>` : ''
          }${
            meet ? `<a class="btn btn--sm ${soon ? 'btn--accent' : 'btn--glass'}" href="${esc(meet)}" target="_blank" rel="noopener" aria-label="${esc(`Join ${e.title} (opens in a new tab)`)}">${icon('video')}${live ? 'Join now' : 'Join'}</a>` : ''
          }</div>`
        : '';
    const when = e.allDay ? lengthLabel(e) : `${fmtTime(e.start)}, ${lengthLabel(e)}`;
    return {
      start: e.allDay ? -Infinity : e.start,
      html: `<li class="cal-tl__item hue--${hueOf(e)}${evCls(e, now)}${live ? ' is-live' : ''}${e.allDay ? ' is-allday' : ''}">
        <button type="button" class="cal-tl__btn" data-event="${esc(e.id)}" aria-label="${esc(`${e.title}, ${when}${live ? ', happening now' : ''}${ariaExtra(e)}`)}">
          <span class="cal-tl__time">${e.allDay ? `<b>All day</b>${lengthLabel(e) !== 'All day' ? `<small>${lengthLabel(e)}</small>` : ''}` : `<b>${fmtTime(e.start)}</b><small>${lengthLabel(e)}</small>`}</span>
          <span class="cal-tl__rail" aria-hidden="true"></span>
          <span class="cal-tl__body">
            <span class="cal-tl__title">${pendingMark(e)}${esc(e.title)}</span>
            ${place}
            <span class="cal-tl__foot">${(e.attendees || []).length > 1 ? avatarStack(e.attendees, 'xs', 4) : ''}
              <span class="cal-kind">${icon(k.ico)}${esc(k.label)}</span>
              ${showCal && e.calendar ? `<span class="cal-tl__cal">${esc(e.calendar)}</span>` : ''}
              ${pending ? '<span class="cal-invite">Invitation</span>' : ''}
              ${live ? '<span class="cal-live">Now</span>' : ''}</span>
          </span>
        </button>${acts}
      </li>`,
    };
  });
  let tl = items.map((i) => i.html);
  if (isToday) {
    const marker = `<li class="cal-tl__now" aria-label="Now, ${fmtTime(now)}"><time>${fmtTime(now)}</time><span></span></li>`;
    const at = items.findIndex((i) => i.start > now);
    tl.splice(at < 0 ? tl.length : at, 0, marker);
  }
  const tlHtml = evs.length ? `<ol class="cal-tl">${tl.join('')}</ol>` : '<p class="cal-none">No events.</p>';

  let dueHtml = '';
  if (due.length) {
    const rows = due
      .slice(0, MAX_DUE)
      .map((t) => {
        const p = project(t.projectId);
        const done = t.status === 'done';
        return `<li class="cal-task${done ? ' is-done' : ''}">
          <button type="button" class="cal-task__box" role="checkbox" aria-checked="${done}" data-done="${t.id}" aria-label="${esc(`Mark “${t.title}” ${done ? 'not done' : 'done'}`)}"><span class="check"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span></button>
          <button type="button" class="cal-task__t" data-task="${t.id}"><span>${esc(t.title)}</span>
            ${p ? `<small class="hue--${p.hue}"><i></i>${esc(p.name)}</small>` : ''}</button>
        </li>`;
      })
      .join('');
    const extra = due.length - MAX_DUE;
    dueHtml = `<section class="cal-due">
      <h3>${isToday ? 'Due today' : 'Due this day'} <span class="badge">${due.length}</span></h3>
      <ul>${rows}</ul>
      ${extra > 0 ? `<a class="btn btn--ghost btn--sm cal-due__more" href="#/tasks">${extra} more in Tasks${icon('chevronRight')}</a>` : ''}
    </section>`;
  }
  return msHtml + tlHtml + dueHtml;
}

function renderAgenda() {
  const ts = selected;
  const n = dayEvents(ts).length;
  el.agTitle.textContent = relDay(ts);
  el.agSub.textContent = `${shortDate(ts)} · ${n ? plural(n, 'event') : calLoading() ? 'loading…' : 'no events'}`;
  el.ag.innerHTML = agendaBody();
}

function swapAgenda(animate = true) {
  if (!animate || reduced() || view !== 'month') return renderAgenda();
  const parts = [el.ag, el.agTitle, el.agSub];
  gsap.killTweensOf(parts);
  gsap.to(parts, {
    opacity: 0, y: 6, duration: 0.12, ease: 'power2.in',
    onComplete() {
      renderAgenda();
      gsap.set(parts, { opacity: 1, y: 0 });
      gsap.fromTo([el.agTitle, el.agSub], { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', stagger: 0.04, clearProps: 'opacity,transform' });
      fadeUp(el.ag.children, { y: 10, stagger: 0.035, duration: 0.45 });
    },
  });
}

// ---------- week ----------
function renderWeek() {
  const start = startOfWeek(cursor);
  const ws = start.getTime();
  const end = addDays(start, 6);
  const evMap = eventsByDay(ws, 7);
  const adMap = allDayByDay(ws, 7);
  const today = sod(new Date());
  const now = Date.now();
  const loading = calLoading();
  const adIds = new Set([...adMap.values()].flat().map((e) => e.id));
  const total = [...evMap.values()].reduce((s, a) => s + a.length, 0) + adIds.size;

  el.wkTitle.textContent = sameMonth(start, end)
    ? `${shortDate(start)} – ${end.getDate()}`
    : `${shortDate(start)} – ${shortDate(end)}`;
  el.wkSub.textContent = plural(total, 'event');

  let head = '<div class="cal-wk__corner"></div>';
  let cols = '';
  let adCols = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const ts = d.getTime();
    const isToday = ts === today;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    head += `<div class="cal-wk__day${isToday ? ' is-today' : ''}"${isToday ? ' aria-current="date"' : ''}><small>${weekday(d)}</small><b>${d.getDate()}</b></div>`;
    const ad = adMap.get(ts) || [];
    const next = addDays(d, 1).getTime();
    adCols += `<div class="cal-wk__adcol${isToday ? ' is-today' : ''}" role="group" aria-label="${esc(`All day, ${longDay(d)}`)}">${ad
      .slice(0, 3)
      .map(
        (e) => `<button type="button" class="cal-adblk hue--${hueOf(e)}${evCls(e, now)}${e.start < ts ? ' is-cont-l' : ''}${e.end > next ? ' is-cont-r' : ''}" data-event="${esc(e.id)}" aria-label="${esc(`${e.title}, ${lengthLabel(e)}${ariaExtra(e)}`)}">${pendingMark(e)}<span>${esc(e.title)}</span></button>`,
      )
      .join('')}${ad.length > 3 ? `<span class="cal-adblk__more">+${ad.length - 3}</span>` : ''}</div>`;
    const blocks = layoutLanes(evMap.get(ts) || [])
      .map(({ e, lane, of }) => {
        const sH = (e.start - ts) / HOUR;
        const eH = (e.end - ts) / HOUR;
        if (eH <= H0 || sH >= H1) return '';
        const top = Math.max(H0, sH);
        const bottom = Math.min(H1, Math.max(sH + 0.25, eH));
        const short = eH - sH < 0.9;
        const place = placeLabel(e);
        const style = `top:${((top - H0) / SPAN) * 100}%;height:${((bottom - top) / SPAN) * 100}%;left:${(lane / of) * 100}%;width:${100 / of}%`;
        return `<button type="button" class="cal-blk hue--${hueOf(e)}${evCls(e, now)}${short ? ' is-short' : ''}" data-event="${esc(e.id)}" style="${style}"
          aria-label="${esc(`${e.title}, ${fmtTime(e.start)} to ${fmtTime(e.end)}${place ? `, ${place}` : ''}${ariaExtra(e)}`)}">
          <b>${pendingMark(e)}${esc(e.title)}</b>${short ? '' : `<small>${fmtTime(e.start)}${place ? ` · ${esc(place)}` : ''}</small>`}
        </button>`;
      })
      .join('') +
      (loading && (i * 3) % 4 !== 1
        ? `<span class="skel cal-skelblk" aria-hidden="true" style="top:${8 + ((i * 23) % 50)}%;height:${9 + ((i * 11) % 10)}%"></span>`
        : '');
    cols += `<div class="cal-wk__col${isToday ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}" data-col="${ts}" role="group" aria-label="${esc(longDay(d))}">${blocks}${
      isToday ? '<span class="cal-now" aria-hidden="true"></span>' : ''
    }</div>`;
  }
  let hours = '';
  for (let i = 0; i < SPAN; i++) hours += `<span style="top:${(i / SPAN) * 100}%">${hourLabel(H0 + i)}</span>`;
  const adRow = adIds.size ? `<div class="cal-wk__allday"><div class="cal-wk__adlabel">All day</div>${adCols}</div>` : '';
  el.wk.innerHTML = `<div class="cal-wk__head">${head}</div>${adRow}
    <div class="cal-wk__body"><div class="cal-wk__hours" aria-hidden="true">${hours}</div>${cols}</div>`;
  placeNow();
}

function placeNow() {
  const line = el.wk?.querySelector('.cal-now');
  if (!line) return;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  line.hidden = h < H0 || h >= H1;
  line.style.top = `${((h - H0) / SPAN) * 100}%`;
}

function tickNow() {
  nowCall?.kill();
  nowCall = gsap.delayedCall(60, () => {
    placeNow();
    const t = el.ag?.querySelector('.cal-tl__now time');
    if (t) t.textContent = fmtTime(Date.now());
    tickNow();
  });
}

function popBlocks(delay = 0) {
  if (reduced()) return;
  gsap.fromTo(
    el.wk.querySelectorAll('.cal-blk'),
    { opacity: 0, y: 14, scale: 0.94 },
    { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.7)', stagger: 0.025, delay, clearProps: 'opacity,transform' },
  );
}

function scrollToToday() {
  const col = el.wk.querySelector('.cal-wk__col.is-today');
  const sc = el.wkScroll;
  if (sc.scrollWidth <= sc.clientWidth) return;
  sc.scrollTo({ left: col ? Math.max(0, col.offsetLeft - 66) : 0, behavior: reduced() ? 'auto' : 'smooth' });
}

// ---------- rendering ----------
function renderView() {
  if (view === 'month') {
    renderMonth();
    renderAgenda();
  } else renderWeek();
}

function renderAll() {
  renderTop();
  renderView();
  if (view === 'week') renderAgenda();
  setTitle(false);
  updateSub();
  dirty = false;
}

function shell() {
  const actions = `<div class="cal-nav" role="group" aria-label="Calendar navigation">
      <button type="button" class="ibtn cal-nav__btn" data-nav="-1" aria-label="Previous month" title="Previous month">${icon('chevronLeft')}</button>
      <button type="button" class="btn cal-nav__btn cal-nav__today" data-nav="0">Today</button>
      <button type="button" class="ibtn cal-nav__btn" data-nav="1" aria-label="Next month" title="Next month">${icon('chevronRight')}</button>
    </div>
    ${segmented('Calendar view', [['month', 'Month'], ['week', 'Week']], view, 'cal-viewseg')}
    <button type="button" class="btn btn--accent" data-act="new">${icon('plus')}New event</button>`;

  const month = `<section class="card glass cal-monthcard" aria-label="Month">
      <div class="cal-top" hidden></div>
      <div class="cal-wd" aria-hidden="true"></div>
      <div class="cal-stage"><div class="cal-grid" role="group"></div><span class="cal-ring" aria-hidden="true"></span></div>
    </section>`;
  const agenda = card({
    id: 'cal-agenda',
    cls: 'cal-agenda',
    title: 'Today',
    sub: '&nbsp;',
    tools: `<button type="button" class="btn btn--glass btn--sm" data-act="add">${icon('plus')}Add event</button>`,
    body: '<div class="cal-ag"></div>',
  });
  const week = card({
    id: 'cal-week',
    cls: 'cal-weekcard',
    title: 'Week',
    sub: '&nbsp;',
    tools: '<span class="cal-hint">Click an empty slot to add</span>',
    body: '<div class="cal-top" hidden></div><div class="cal-wk__scroll"><div class="cal-wk"></div></div>',
  });

  root.innerHTML = `${pageHead({ title: titleText(), sub: '&nbsp;', actions })}
    <p class="sr" aria-live="polite"></p>
    <div class="cal${view === 'week' ? ' is-week' : ''}">${month}${agenda}${week}</div>`;

  const q = (s) => root.querySelector(s);
  Object.assign(el, {
    live: q('[aria-live]'),
    cal: q('.cal'),
    monthCard: q('.cal-monthcard'),
    monthTop: q('.cal-monthcard .cal-top'),
    wkTop: q('#cal-week .cal-top'),
    wd: q('.cal-wd'),
    stage: q('.cal-stage'),
    grid: q('.cal-grid'),
    ring: q('.cal-ring'),
    agCard: q('#cal-agenda'),
    agTitle: q('#cal-agenda .card__title'),
    agSub: q('#cal-agenda .card__sub'),
    ag: q('.cal-ag'),
    wkCard: q('#cal-week'),
    wkTitle: q('#cal-week .card__title'),
    wkSub: q('#cal-week .card__sub'),
    wkScroll: q('.cal-wk__scroll'),
    wk: q('.cal-wk'),
  });
  el.agTitle.classList.add('cal-agenda__title');
  setVisibility();
}

function setVisibility() {
  const week = view === 'week';
  el.cal.classList.toggle('is-week', week);
  el.monthCard.hidden = week;
  el.agCard.hidden = week;
  el.wkCard.hidden = !week;
}

const visibleCards = () => [...el.cal.querySelectorAll(':scope > .card:not([hidden])')];

// ---------- navigation ----------
function focusSelected() {
  if (view === 'month') selectedCell()?.focus({ preventScroll: false });
}

function slide(dir, mutate, { focus = false } = {}) {
  navTween?.progress(1).kill();
  if (view === 'month') hideRing();
  const target = view === 'month' ? el.grid : el.wk;
  const after = () => {
    mutate();
    renderView();
    setTitle(true);
    if (focus) focusSelected();
  };
  if (reduced()) {
    after();
    if (view === 'month') armRing(0);
    navTween = null;
    return;
  }
  const tl = gsap.timeline({ onComplete: () => (navTween = null) });
  tl.to(target, { x: -dir * 44, opacity: 0, duration: 0.17, ease: 'power2.in' });
  tl.add(() => {
    after();
    if (view === 'month') swapAgendaIn();
  });
  tl.fromTo(target, { x: dir * 56, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: 'expo.out', clearProps: 'transform,opacity' });
  if (view === 'month') tl.add(() => armRing(0), 0.17 + 0.22);
  else tl.add(() => popBlocks(), 0.17 + 0.12);
  navTween = tl;
}

// Agenda already re-rendered by renderView(); give it the stagger-in.
function swapAgendaIn() {
  fadeUp([el.agTitle, el.agSub], { y: 6, stagger: 0.04, duration: 0.4 });
  fadeUp(el.ag.children, { y: 10, stagger: 0.035, duration: 0.45 });
}

function nav(dir) {
  const today = startOfDay();
  const tts = today.getTime();
  if (dir === 0) {
    const inView = view === 'month' ? sameMonth(today, cursor) : sod(startOfWeek(cursor)) === sod(startOfWeek(today));
    if (inView) return select(tts, { focus: false });
    const d = tts > (view === 'month' ? cursor.getTime() : startOfWeek(cursor).getTime()) ? 1 : -1;
    return slide(d, () => {
      selected = tts;
      cursor = view === 'month' ? firstOfMonth(today) : today;
    });
  }
  if (view === 'month') {
    slide(dir, () => {
      cursor = addMonths(cursor, dir);
      cursor = firstOfMonth(cursor);
      selected = sameMonth(today, cursor) ? tts : cursor.getTime();
    });
  } else {
    slide(dir, () => {
      cursor = addDays(cursor, 7 * dir);
      selected = sod(startOfWeek(cursor)) === sod(startOfWeek(today)) ? tts : addDays(new Date(selected), 7 * dir).getTime();
    });
  }
}

function select(ts, { focus = true } = {}) {
  if (view !== 'month') {
    selected = ts;
    return;
  }
  if (ts === selected) {
    if (focus) focusSelected();
    if (!armed) armRing(0);
    return;
  }
  selected = ts;
  cells().forEach((c) => {
    const on = +c.dataset.day === ts;
    c.setAttribute('aria-pressed', on);
    c.tabIndex = on ? 0 : -1;
  });
  if (focus) focusSelected();
  placeRing({ animate: true });
  swapAgenda(true);
}

function goToDay(d, opts = {}) {
  const ts = sod(d);
  if (sameMonth(d, cursor)) return select(ts, opts);
  const dir = ts > cursor.getTime() ? 1 : -1;
  slide(dir, () => {
    cursor = firstOfMonth(d);
    selected = ts;
  }, opts);
}

function switchView(v) {
  if (v === view) return;
  navTween?.progress(1).kill();
  hideRing();
  const old = visibleCards();
  view = v;
  cursor = v === 'week' ? new Date(selected) : firstOfMonth(selected);
  collapseOut(old, () => {
    gsap.set(old, { clearProps: 'all' });
    setVisibility();
    renderView();
    setTitle(true);
    updateNavLabels();
    const now = visibleCards();
    revealCards(now, { y: 18, stagger: 0.06, from: 0.6 });
    if (v === 'week') {
      popBlocks(0.2);
      requestAnimationFrame(scrollToToday);
    } else {
      cascade(0.1, 0.22);
      armRing(0.4);
    }
  });
}

function newAt() {
  const today = startOfDay();
  let day = new Date(selected);
  if (view === 'week') {
    const ws = startOfWeek(cursor);
    day = ws > today ? ws : today;
    if (addDays(startOfWeek(cursor), 7) <= today) day = startOfWeek(cursor);
  }
  return sameDay(day, today) ? newEvent({ date: day }) : newEvent({ date: day, time: '10:00' });
}

// ---------- wiring ----------
function wire() {
  seg = bindSegmented(root.querySelector('.cal-viewseg'), switchView);

  root.addEventListener('click', (e) => {
    const t = e.target;
    const navBtn = t.closest('[data-nav]');
    if (navBtn) return nav(+navBtn.dataset.nav);
    const calChip = t.closest('[data-cal]');
    if (calChip) return toggleCalendar(calChip.dataset.cal);
    const ev = t.closest('[data-event]');
    if (ev) return openEvent(ev.dataset.event);
    const done = t.closest('[data-done]');
    if (done) return checkTask(done);
    const tk = t.closest('[data-task]');
    if (tk) return openTask(tk.dataset.task);
    const day = t.closest('.cal-day');
    if (day) return goToDay(new Date(+day.dataset.day), { focus: true });
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'new') return newAt();
    if (act === 'add') return selected === sod(new Date()) ? newEvent({ date: new Date(selected) }) : newEvent({ date: new Date(selected), time: '10:00' });
    const col = t.closest('.cal-wk__col');
    if (col && e.detail > 0) {
      const r = col.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      const h = Math.min(H1 - 0.5, Math.max(H0, H0 + Math.floor(f * SPAN * 2) / 2));
      newEvent({ date: new Date(+col.dataset.col), time: hhmm(h) });
    }
  });

  el.grid.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cal-day');
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    const d = new Date(+cell.dataset.day);
    let next;
    switch (e.key) {
      case 'ArrowLeft': next = addDays(d, -1); break;
      case 'ArrowRight': next = addDays(d, 1); break;
      case 'ArrowUp': next = addDays(d, -7); break;
      case 'ArrowDown': next = addDays(d, 7); break;
      case 'PageUp': next = addMonths(d, -1); break;
      case 'PageDown': next = addMonths(d, 1); break;
      case 'Home': next = startOfWeek(d); break;
      case 'End': next = addDays(startOfWeek(d), 6); break;
      default: return;
    }
    e.preventDefault();
    goToDay(next, { focus: true });
  });

  new ResizeObserver(() => placeRing()).observe(el.stage);

  const onData = (agendaOnly) => () => {
    if (root.hidden) {
      dirty = true;
      return;
    }
    if (!agendaOnly) {
      if (view === 'month') {
        renderMonth();
        placeRing();
      } else renderWeek();
      updateSub();
    }
    renderAgenda();
  };
  subscribe('events', () => {
    renderTop();
    onData(false)();
  });
  subscribe('projects', onData(false));
  subscribe('tasks', onData(true));
  // Live: the source note, legend and loading skeleton follow the connector.
  let lastStatus = state.live?.calendar?.status;
  subscribe('live', () => {
    renderTop();
    const st = state.live?.calendar?.status;
    if (st === lastStatus) return;
    lastStatus = st;
    onData(false)();
  });
  subscribe('calendars', () => {
    renderTop();
    onData(false)();
  });
}

function checkTask(btn) {
  const t = state.tasks.find((x) => x.id === btn.dataset.done);
  if (!t || btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const li = btn.closest('.cal-task');
  const on = t.status !== 'done';
  li.classList.toggle('is-done', on);
  btn.setAttribute('aria-checked', on);
  popIn(btn.querySelector('.check'));
  gsap.delayedCall(reduced() ? 0 : 0.35, () => toggleDone(t));
}

function intro(first) {
  headIntro(root);
  revealCards(visibleCards(), { y: 30, stagger: 0.08, delay: 0.12 });
  if (view === 'month') {
    hideRing();
    cascade(0.3, first ? 0.4 : 0.22);
    armRing(first ? 0.8 : 0.6);
    fadeUp([...el.ag.children], { y: 12, stagger: 0.045, delay: 0.42 });
  } else {
    popBlocks(0.35);
    gsap.delayedCall(reduced() ? 0 : 0.35, scrollToToday);
  }
}

export const page = {
  title: 'Calendar',
  mount(node) {
    root = node;
    root.classList.add('page-cal');
    shell();
    renderAll();
    wire();
    requestAnimationFrame(() => seg?.place(false));
  },
  enter({ first, same }) {
    if (same) return;
    if (dirty) renderAll();
    else {
      renderTop();
      placeNow();
    }
    tickNow();
    intro(first);
  },
  leave() {
    nowCall?.kill();
    nowCall = null;
    navTween?.progress(1).kill();
    navTween = null;
  },
};
