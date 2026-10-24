// Home: a personal dashboard. Greeting header, then a named-area grid of
// widgets — rings, up next, focus, my tasks, week bars, projects, people.
// In live mode (published to claude.ai) the people card becomes an inbox
// glance, projects give way to recent Drive files (until the user has
// projects of their own), and an optional Claude brief sits above the grid.
// Rendered once on mount; store changes patch individual widgets while the
// view is visible, or mark it dirty for a full re-render on the next enter.

import '../styles/pages/home.css';
import {
  state, subscribe, member, project, task as getTask, dueToday, overdue, openTasks, doneBetween, focusMinutesBetween, projectProgress, PROJECT_STATUS,
} from '../store.js';
import { esc, icon, startOfDay, addDays, sameDay, fmtDate, fmtTime, fmtTimeRange, fmtHours, dueLabel, dayLabel, relTime, weekday } from '../lib/dom.js';
import { gsap, dur, reduced, revealCards, fadeUp, flipList, splitTitle } from '../lib/motion.js';
import {
  pageHead, headIntro, card, avatar, avatarStack, projectIcon, projectChip, priorityPill, emptyState, segmented, bindSegmented, animateCounts, PRESENCE,
  sourceNote, sourceReady,
} from '../ui/components.js';
import { bindCardExpand, collapseCard, newTask, openEvent, toggleDone, notify, liveAction } from '../ui/overlays.js';
import * as focus from '../focus.js';
import { barChart } from '../charts.js';
import { call } from '../live/runtime.js';
import { ask, aiAvailable, aiErrorText, briefPrompt } from '../live/ai.js';
import { startGithub, projectForRepo } from '../live/github.js';
import { ghOverviewState, ghRow, issueTaskBtn, addIssueTask, findIssue } from '../ui/github.js';

const DAY = 86_400_000;
const FOCUS_GOAL = 120;
const LENGTHS = [15, 25, 50];
const PRESENCE_ORDER = ['focus', 'meeting', 'online', 'away'];
// Demo mode runs on the seed; live mode fills in from the viewer's connectors.
const live = !state.demo;

let root;
let chart = null;
let peopleSeg = null;
let lenSeg = null;
let tab = 'team';
let F = LENGTHS.includes(state.settings.focusMinutes) ? state.settings.focusMinutes : 25;
let dirty = false;
let clock = null;
let withProjects = false; // live: whether the projects card is in the grid
let liveSig = {}; // live: last seen status per source, to re-render only on change

// Claude brief (live only). Kept outside the DOM so re-renders keep it.
const brief = { ai: false, status: 'idle', text: '', error: '', at: 0, run: 0, ctrl: null, saving: false, docUrl: '' };

const hidden = () => !root || root.hidden;
const $ = (sel) => root.querySelector(sel);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const hasProjects = () => state.projects.length > 0;

// ---------- derived data ----------
// Timed events only: all-day blocks and out-of-office never count as "up next".
const timed = (e) => !e.allDay && e.kind !== 'allday' && e.kind !== 'ooo';
const isMeeting = (e) => timed(e) && e.kind !== 'focus' && e.kind !== 'deadline';
// Hours in meetings (live week chart): real meetings with someone else.
const withOthers = (e) => isMeeting(e) && e.attendees.length > 1;

function metrics() {
  const a = startOfDay().getTime();
  const b = a + DAY;
  const now = Date.now();
  const doneToday = state.tasks.filter((t) => t.assignee === state.me && t.doneAt && t.doneAt >= a && t.doneAt < b).length;
  const due = dueToday(state.me);
  const goal = Math.max(due.length, doneToday, 1);
  const mine = state.focus.filter((f) => f.who === state.me && f.at >= a && f.at < b);
  const focusMin = focusMinutesBetween(a, b, state.me);
  const meetings = myEventsFrom(a, b).filter((e) => isMeeting(e) && e.start >= a);
  return {
    doneToday, goal, focusMin, sessions: mine.length,
    meetings: meetings.length,
    met: meetings.filter((e) => e.end <= now).length,
    meetingsLeft: meetings.filter((e) => e.end > now).length,
    tasksLeft: due.filter((t) => t.status !== 'done').length,
    open: openTasks(state.me).length,
    late: overdue(state.me).length,
  };
}

function myEventsFrom(a, b = Infinity) {
  return state.events.filter((e) => e.attendees.includes(state.me) && e.start < b && e.end > a).sort((x, y) => x.start - y.start);
}

function myTasks() {
  const seen = new Set();
  return [...overdue(state.me), ...dueToday(state.me)]
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .sort((x, y) => (x.status === 'done') - (y.status === 'done') || x.due - y.due)
    .slice(0, 7);
}

function weekStart() {
  const today = startOfDay();
  const ws = state.settings.weekStart ?? 1;
  return addDays(today, -((today.getDay() - ws + 7) % 7));
}

// Minutes of meetings overlapping [a, b).
const meetingMinutes = (a, b) =>
  state.events.filter(withOthers).reduce((s, e) => s + Math.max(0, Math.min(e.end, b) - Math.max(e.start, a)), 0) / 60000;

function weekData() {
  const today = startOfDay();
  const start = weekStart();
  if (live) {
    const items = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const a = d.getTime();
      return { label: weekday(d), value: Math.round(meetingMinutes(a, a + DAY) / 6) / 10, highlight: sameDay(d, today) };
    });
    const s = start.getTime();
    const sofar = meetingMinutes(s, s + 7 * DAY);
    const last = meetingMinutes(s - 7 * DAY, s);
    return { items, sofar, last, delta: last ? Math.round(((sofar - last) / last) * 100) : null };
  }
  const items = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const a = d.getTime();
    return { label: weekday(d), value: doneBetween(a, a + DAY).length, highlight: sameDay(d, today) };
  });
  const now = Date.now();
  const sofar = doneBetween(start.getTime(), now).length;
  const last = doneBetween(start.getTime() - 7 * DAY, now - 7 * DAY).length;
  const delta = last ? Math.round(((sofar - last) / last) * 100) : sofar ? 100 : 0;
  return { items, sofar, last, delta };
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const firstNameOfMe = () => (state.settings.name || state.members[0]?.name || '').trim().split(/\s+/)[0] || 'there';
const titleText = () => `${greeting()}, ${firstNameOfMe()}`;

// ---------- header ----------
function subLine(m) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (live) return `${esc(date)} · ${plural(m.meetings, 'meeting')} today · ${plural(m.open, 'open task')} · ${(state.unread || 0).toLocaleString('en-US')} unread`;
  return `${esc(date)} · ${plural(m.meetingsLeft, 'meeting')} and ${plural(m.tasksLeft, 'task')} left today`;
}

function headActions() {
  const now = Date.now();
  const end = startOfDay().getTime() + DAY;
  const next = myEventsFrom(now, end).find((e) => e.start > now && timed(e));
  return `<button type="button" class="btn btn--glass" data-act="task">${icon('plus')}New task</button>${
    next ? `<button type="button" class="btn btn--accent" data-event="${esc(next.id)}">${icon(next.place === 'video' ? 'video' : 'calendar')}Next: ${fmtTime(next.start)}</button>` : ''
  }`;
}

// Index of the stat that flashes when a task is ticked off.
const FLASH = live ? 2 : 0;

function statList(m) {
  if (live) {
    return [
      { label: 'Meetings today', value: m.meetings },
      { label: 'Unread mail', value: state.unread || 0, href: '#/inbox' },
      { label: 'Open tasks', value: m.open },
      { label: 'Focus today', value: m.focusMin, fmt: 'hours' },
    ];
  }
  return [
    { label: 'Done today', value: m.doneToday, suffix: `/ ${m.goal}` },
    { label: 'Focus today', value: m.focusMin, fmt: 'hours' },
    { label: 'Overdue', value: m.late },
  ];
}

function headHtml(m) {
  return pageHead({ title: titleText(), sub: subLine(m), actions: headActions(), stats: statList(m) });
}

// pageHead renders plain stats; give the linked ones a full-size hit area.
function linkStats(m) {
  const stats = root.querySelectorAll('.head .stat');
  statList(m).forEach((s, i) => {
    if (!s.href || !stats[i]) return;
    stats[i].classList.add('stat--link');
    stats[i].insertAdjacentHTML('beforeend', `<a class="stat__hit" href="${s.href}" aria-label="${esc(s.label)}: open"></a>`);
  });
}

function setTitle() {
  const el = $('.head__title');
  const text = titleText();
  if (!el || (el.getAttribute('aria-label') ?? el.textContent) === text) return;
  delete el.dataset.split;
  el.textContent = text;
  splitTitle(el);
}

function updateHead(m, { flash = false } = {}) {
  const head = $('.head');
  if (!head) return;
  const sub = head.querySelector('.head__sub');
  if (sub) sub.innerHTML = subLine(m);
  const actions = head.querySelector('.head__actions');
  if (actions) actions.innerHTML = headActions();
  const stats = head.querySelectorAll('.stat');
  const list = statList(m);
  stats.forEach((s, i) => {
    const b = s.querySelector('b[data-count]');
    if (b && list[i]) b.dataset.count = list[i].value;
    const hit = s.querySelector('.stat__hit');
    if (hit && list[i]) hit.setAttribute('aria-label', `${list[i].label}: ${list[i].value}, open`);
  });
  if (!live) {
    const goal = stats[0]?.querySelector('small');
    if (goal) goal.textContent = `/ ${m.goal}`;
  }
  animateCounts(head);
  const fl = stats[FLASH];
  if (flash && fl) {
    fl.classList.remove('is-flash');
    void fl.offsetWidth;
    fl.classList.add('is-flash');
    if (!reduced()) gsap.fromTo(fl, { y: -4, scale: 1.06 }, { y: 0, scale: 1, duration: 0.6, ease: 'back.out(2.4)', clearProps: 'transform' });
  }
}

// ---------- rings ----------
const RINGS = [
  ['tasks', 56, 'Tasks'],
  ['focus', 41, 'Focus'],
  ['meet', 26, 'Meetings'],
];
const ringP = (m) => [m.doneToday / m.goal, m.focusMin / FOCUS_GOAL, m.meetings ? m.met / m.meetings : 0].map((p) => Math.min(1, Math.max(0.012, p)));

function ringsHtml(m) {
  const ps = ringP(m);
  const svg = RINGS.map(([k, r], i) => {
    const c = 2 * Math.PI * r;
    return `<circle class="rings__track rings--${k}" cx="68" cy="68" r="${r}"/><circle class="rings__arc rings--${k}" cx="68" cy="68" r="${r}" data-c="${c}" data-p="${ps[i]}" stroke-dasharray="${c * ps[i]} ${c}"/>`;
  }).join('');
  const legend = [
    [m.doneToday, `/ ${m.goal}`],
    [fmtHours(m.focusMin), '/ 2h'],
    [m.met, `/ ${m.meetings}`],
  ];
  return `<div class="rings-wrap">
    <svg class="home-rings" viewBox="0 0 136 136" role="img" aria-label="Tasks ${m.doneToday} of ${m.goal}, focus ${fmtHours(m.focusMin)} of 2 hours, meetings ${m.met} of ${m.meetings}">${svg}</svg>
    <dl class="rings__legend">${RINGS.map(([k, , label], i) => `<div class="rings__row rings--${k}"><dt>${label}</dt><dd><b>${legend[i][0]}</b><small>${legend[i][1]}</small></dd></div>`).join('')}</dl>
  </div>`;
}

function tweenRings({ fromZero = false, delay = 0 } = {}) {
  root.querySelectorAll('.rings__arc').forEach((arc, i) => {
    const c = +arc.dataset.c;
    const to = `${c * +arc.dataset.p} ${c}`;
    gsap.killTweensOf(arc);
    if (reduced()) return arc.setAttribute('stroke-dasharray', to);
    const vars = { attr: { 'stroke-dasharray': to }, duration: 1.4, ease: 'power3.inOut', delay: delay + i * 0.12 };
    if (fromZero) gsap.fromTo(arc, { attr: { 'stroke-dasharray': `0.01 ${c}` } }, vars);
    else gsap.to(arc, vars);
  });
}

function updateRings(m) {
  const wrap = $('.rings-wrap');
  if (!wrap) return;
  const ps = ringP(m);
  wrap.querySelectorAll('.rings__arc').forEach((arc, i) => (arc.dataset.p = ps[i]));
  const legend = [[m.doneToday, `/ ${m.goal}`], [fmtHours(m.focusMin), '/ 2h'], [m.met, `/ ${m.meetings}`]];
  wrap.querySelectorAll('.rings__row dd').forEach((dd, i) => (dd.innerHTML = `<b>${legend[i][0]}</b><small>${legend[i][1]}</small>`));
  wrap.querySelector('svg').setAttribute('aria-label', `Tasks ${m.doneToday} of ${m.goal}, focus ${fmtHours(m.focusMin)} of 2 hours, meetings ${m.met} of ${m.meetings}`);
  tweenRings();
}

// ---------- shared live bits ----------
const skelRows = (n, cls = '') =>
  `<div class="hskel ${cls}" aria-hidden="true">${Array.from({ length: n }, () => '<span class="hskel__row"><i class="skel hskel__av"></i><span class="hskel__lines"><i class="skel"></i><i class="skel"></i></span></span>').join('')}</div>`;
const srcSlot = (key) => (live ? `<div class="src-slot" data-src="${key}">${sourceNote(key)}</div>` : '');

// ---------- up next ----------
function countdown(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

function joinHtml(hero) {
  if (!live) return hero.place === 'video' ? `<button type="button" class="btn btn--accent btn--sm next__join" data-join="${esc(hero.id)}">${icon('video')}Join</button>` : '';
  const url = safeUrl(hero.meetUrl);
  return url
    ? `<a class="btn btn--accent btn--sm next__join" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Join “${esc(hero.title)}” (opens in a new tab)">${icon('video')}Join</a>`
    : '';
}

function nextHtml() {
  const slot = srcSlot('calendar');
  if (live && !sourceReady('calendar')) return `<div class="next-wrap">${slot}${skelRows(3, 'hskel--next')}</div>`;
  const now = Date.now();
  const upcoming = myEventsFrom(now, now + 8 * DAY).filter((e) => e.end > now && timed(e));
  const hero = upcoming[0];
  if (!hero) {
    return `<div class="next-wrap">${slot}${live ? emptyState('Nothing coming up', 'Your next 8 days are clear.', 'calendar') : emptyState('Nothing else today', 'Your calendar is clear.', 'calendar')}</div>`;
  }
  const p = hero.projectId ? project(hero.projectId) : null;
  const now0 = hero.start <= now;
  const isToday = sameDay(hero.start, now);
  const when = now0
    ? '<span class="next__live"><i></i>Now</span>'
    : isToday
      ? `in <b data-countdown="${hero.start}">${countdown(hero.start - now)}</b>`
      : esc(dayLabel(hero.start));
  const video = hero.place === 'video';
  const needsReply = hero.rsvp === 'needsAction';
  const rest = upcoming.slice(1).filter((e) => sameDay(e.start, hero.start)).slice(0, 3);
  return `<div class="next-wrap">${slot}
    <div class="next hue--${p?.hue || 'indigo'}">
      <button type="button" class="next__hit" data-event="${esc(hero.id)}" aria-label="${esc(hero.title)}, ${esc(fmtTimeRange(hero.start, hero.end))}${needsReply ? ', not answered yet' : ''}"></button>
      <span class="next__when">${when}</span>
      <b class="next__title">${esc(hero.title)}</b>
      <span class="next__meta">${icon('clock')}${esc(fmtTimeRange(hero.start, hero.end))}${hero.place ? ` · ${video ? 'Video call' : esc(hero.place)}` : ''}</span>
      ${needsReply ? `<span class="next__rsvp">${icon('bell')}Invitation not answered yet — open to reply</span>` : ''}
      <span class="next__foot">${avatarStack(hero.attendees, 'sm', 4)}${joinHtml(hero)}</span>
    </div>
    ${rest.length ? `<ul class="next__rest">${rest
      .map((e) => `<li><button type="button" data-event="${esc(e.id)}" class="hue--${(e.projectId && project(e.projectId)?.hue) || 'indigo'}"><i></i><span>${esc(e.title)}</span><small>${fmtTime(e.start)}</small></button></li>`)
      .join('')}</ul>` : ''}
  </div>`;
}

function renderNext() {
  const wrap = $('.next-wrap');
  if (wrap) wrap.outerHTML = nextHtml();
}

// Refresh time-sensitive bits once a minute while visible.
function tickClock() {
  clock?.kill();
  clock = gsap.delayedCall(60, () => {
    if (!hidden()) {
      const now = Date.now();
      const cd = $('[data-countdown]');
      if (cd && +cd.dataset.countdown > now) cd.textContent = countdown(+cd.dataset.countdown - now);
      else renderNext();
      if (live) {
        renderInbox();
        renderFiles();
        renderCode({ force: true });
      }
    }
    tickClock();
  });
}

// ---------- focus ----------
const C_FOCUS = 2 * Math.PI * 62;

function focusTasksOptions() {
  const seen = new Set();
  const list = [...dueToday(state.me), ...overdue(state.me)].filter((t) => t.status !== 'done' && !seen.has(t.id) && seen.add(t.id));
  return `<option value="">No task — just focus</option>${list.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}`;
}

function focusPanel(s) {
  if (!s) {
    return `<div class="focus__panel">
      <label class="focus__label" for="home-focus-task">Focus on</label>
      <select class="focus__select" id="home-focus-task" data-focus-task>${focusTasksOptions()}</select>
      <button type="button" class="btn btn--accent focus__go">${icon('play')}Start focus</button>
    </div>`;
  }
  return `<div class="focus__panel">
    <span class="focus__label">Focusing on</span>
    <b class="focus__on">${s.task ? esc(s.task.title) : `${s.minutes}-minute block`}</b>
    <div class="focus__btns">
      <button type="button" class="btn btn--glass btn--sm" data-f="pause">${icon(s.paused ? 'play' : 'pause')}${s.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" class="btn btn--glass btn--sm" data-f="stop">${icon('stop')}End</button>
    </div>
  </div>`;
}

function focusTodayHtml(m) {
  return `<div class="focus__today"><span>Focused today</span><b>${fmtHours(m.focusMin)} · ${plural(m.sessions, 'session')}</b>
    <span class="focus__meter" role="meter" aria-label="Focus goal" aria-valuemin="0" aria-valuemax="${FOCUS_GOAL}" aria-valuenow="${Math.min(FOCUS_GOAL, m.focusMin)}"><i data-v="${Math.min(1, m.focusMin / FOCUS_GOAL)}"></i></span></div>`;
}

function focusHtml(m) {
  const s = focus.snapshot();
  return `<div class="focus ${s ? 'is-running' : ''} ${s?.paused ? 'is-paused' : ''}">
    <div class="focus__main">
      <div class="focus__dial">
        <svg viewBox="0 0 150 150" aria-hidden="true"><circle class="focus__track" cx="75" cy="75" r="62"/><circle class="focus__arc" cx="75" cy="75" r="62" stroke-dasharray="${C_FOCUS}" stroke-dashoffset="${C_FOCUS * (1 - (s ? s.progress : 0))}"/></svg>
        <div class="focus__center"><b class="focus__time">${focus.mmss(s ? s.remaining : F * 60000)}</b><small class="focus__state">${!s ? 'Ready' : s.paused ? 'Paused' : 'Focusing'}</small></div>
      </div>
      ${focusPanel(s)}
    </div>
    ${focusTodayHtml(m)}
  </div>`;
}

function growMeter(delay = 0) {
  const i = $('.focus__meter i');
  if (!i) return;
  const v = +i.dataset.v;
  if (reduced()) return gsap.set(i, { scaleX: v });
  gsap.to(i, { scaleX: v, duration: 0.9, ease: 'power3.out', delay });
}

function syncFocus(type) {
  const wrap = $('.focus');
  if (!wrap) return;
  const s = focus.snapshot();
  const time = wrap.querySelector('.focus__time');
  const arc = wrap.querySelector('.focus__arc');
  if (type === 'tick' && s) {
    time.textContent = focus.mmss(s.remaining);
    arc.setAttribute('stroke-dashoffset', C_FOCUS * (1 - s.progress));
    return;
  }
  wrap.classList.toggle('is-running', !!s);
  wrap.classList.toggle('is-paused', !!s?.paused);
  $('.w-focus')?.classList.toggle('is-running', !!s);
  time.textContent = focus.mmss(s ? s.remaining : F * 60000);
  wrap.querySelector('.focus__state').textContent = !s ? 'Ready' : s.paused ? 'Paused' : 'Focusing';
  arc.setAttribute('stroke-dashoffset', C_FOCUS * (1 - (s ? s.progress : 0)));
  const keep = wrap.querySelector('[data-focus-task]')?.value;
  wrap.querySelector('.focus__panel').outerHTML = focusPanel(s);
  const sel = wrap.querySelector('[data-focus-task]');
  if (sel && keep && sel.querySelector(`option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
  if (type === 'start' && !reduced()) gsap.fromTo(wrap.querySelector('.focus__dial'), { scale: 0.92 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
  if (type !== 'tick') fadeUp(wrap.querySelectorAll('.focus__panel > *'), { y: 6, stagger: 0.03, duration: 0.4 });
}

function updateFocusToday(m) {
  const el = $('.focus__today');
  if (!el) return;
  el.outerHTML = focusTodayHtml(m);
  const i = $('.focus__meter i');
  const prev = el.querySelector('.focus__meter i');
  if (i && prev) gsap.set(i, { scaleX: gsap.getProperty(prev, 'scaleX') });
  growMeter();
}

// ---------- my tasks ----------
function taskRow(t) {
  const done = t.status === 'done';
  const late = !done && t.due < startOfDay().getTime();
  return `<li class="mytask ${done ? 'is-done' : ''}" data-key="${esc(t.id)}">
    <button type="button" class="mytask__check" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Reopen' : 'Complete'} “${esc(t.title)}”" data-done="${esc(t.id)}"><span class="check">${icon('check')}</span></button>
    <a class="mytask__body" href="#/tasks/${encodeURIComponent(t.id)}">
      <span class="mytask__title">${esc(t.title)}</span>
      <span class="mytask__meta">${projectChip(t.projectId)}<span class="${late ? 'is-late' : ''}">${esc(dueLabel(t.due))}</span></span>
    </a>
    ${!done && (t.priority === 'high' || t.priority === 'urgent') ? priorityPill(t.priority) : ''}
  </li>`;
}

// What sits under the (empty) list: a first-task invite, "all clear", or a skeleton while live data loads.
function tasksEmpty() {
  if (live && !sourceReady('workspace') && !state.tasks.length) return skelRows(3);
  if (live && !openTasks(state.me).length && !state.tasks.some((t) => t.assignee === state.me)) {
    return emptyState('Your list is empty', 'Add your first task — it stays private to you.', 'tasks', `<button type="button" class="btn btn--accent btn--sm" data-act="task">${icon('plus')}New task</button>`);
  }
  if (live && openTasks(state.me).length) return emptyState('Nothing due today', `${plural(openTasks(state.me).length, 'open task')} on your list.`, 'check');
  return emptyState('All clear', 'Nothing due today. Nice.', 'check');
}

function tasksHtml() {
  const list = myTasks();
  return `${srcSlot('workspace')}${list.length ? `<ul class="mytasks">${list.map(taskRow).join('')}</ul>` : `<ul class="mytasks"></ul>${tasksEmpty()}`}`;
}

function renderTasks() {
  const body = $('.w-tasks .card__body');
  const ul = body?.querySelector('.mytasks');
  if (!ul) return;
  const list = myTasks();
  flipList(ul, () => {
    ul.innerHTML = list.map(taskRow).join('');
  });
  body.querySelectorAll(':scope > .empty, :scope > .hskel').forEach((el) => el.remove());
  if (!list.length) ul.insertAdjacentHTML('afterend', tasksEmpty());
}

// ---------- week ----------
const deltaHtml = (w) => {
  if (live) {
    if (w.delta == null) return `<span class="delta delta--plain">${w.sofar ? 'none last week' : 'a clear week'}</span>`;
    // More meetings isn't "good" or "bad": keep the pill neutral.
    return `<span class="delta delta--plain">${w.delta >= 0 ? '+' : '−'}${Math.abs(w.delta)}% vs last week</span>`;
  }
  const up = w.delta >= 0;
  return `<span class="delta delta--${up ? 'up' : 'down'}">${up ? '+' : '−'}${Math.abs(w.delta)}% vs last week</span>`;
};
const weekSumHtml = (w) =>
  live
    ? `<b data-count="${w.sofar}" data-fmt="hours">0</b> in meetings this week ${deltaHtml(w)}`
    : `<b data-count="${w.sofar}">0</b> finished so far ${deltaHtml(w)}`;
const barFmt = (v) => (live ? (v ? `${v}h` : '0') : `${v}`);
const barTitle = (it) => (live ? `${it.label}: ${it.value} h in meetings` : `${it.label}: ${it.value} done`);

function weekHtml(w) {
  return `${srcSlot('calendar')}<div class="week"><p class="week__sum">${weekSumHtml(w)}</p><div class="week__chart" role="img" aria-label="${live ? 'Hours in meetings per day this week' : 'Tasks finished per day this week'}"></div></div>`;
}

function mountChart(w) {
  const host = $('.week__chart');
  if (!host) return;
  chart = barChart(host, { items: w.items, height: 170, fmt: barFmt, tone: 'blue' });
  host.querySelectorAll('.bars__col').forEach((c, i) => (c.title = barTitle(w.items[i])));
}

function updateWeek(w, { replay = false } = {}) {
  const sum = $('.week__sum');
  if (sum) {
    sum.querySelector('b[data-count]').dataset.count = w.sofar;
    sum.querySelector('.delta').outerHTML = deltaHtml(w);
    animateCounts(sum);
  }
  if (!chart) return;
  if (replay && !reduced()) gsap.set(root.querySelectorAll('.week__chart .bars__bar'), { height: 0 });
  chart.update(w.items);
  root.querySelectorAll('.week__chart .bars__col').forEach((c, i) => (c.title = barTitle(w.items[i])));
}

// ---------- projects ----------
function projectsHtml() {
  const list = state.projects.filter((p) => p.status !== 'done').slice(0, 5);
  if (!list.length) return `<ul class="hprojects"></ul>${emptyState('No active projects', 'Start one from the Projects page.', 'folder')}`;
  return `<ul class="hprojects">${list
    .map((p) => {
      const pct = projectProgress(p.id);
      return `<li><a class="hproject hue--${p.hue}" href="#/projects/${encodeURIComponent(p.id)}">
        ${projectIcon(p.id, 'md')}
        <span class="hproject__name"><b>${esc(p.name)}</b><small>${esc(PROJECT_STATUS[p.status])} · due ${esc(fmtDate(p.due))}</small></span>
        <span class="hproject__bar" role="progressbar" aria-label="${esc(p.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}"><i data-v="${pct}"></i></span>
        <span class="hproject__pct">${Math.round(pct * 100)}%</span>
        ${avatarStack(p.members, 'xs', 3)}
      </a></li>`;
    })
    .join('')}</ul>`;
}

function growProjectBars({ delay = 0, from = true } = {}) {
  const bars = root.querySelectorAll('.hproject__bar i');
  bars.forEach((i, k) => {
    const v = +i.dataset.v;
    if (reduced()) return gsap.set(i, { scaleX: v });
    if (from) gsap.fromTo(i, { scaleX: 0 }, { scaleX: v, duration: 1.1, ease: 'power3.out', delay: delay + k * 0.08 });
    else gsap.to(i, { scaleX: v, duration: 0.8, ease: 'power3.out' });
  });
}

function renderProjects() {
  const card = $('.w-projects .card__body');
  if (!card) return;
  const old = new Map([...card.querySelectorAll('.hproject')].map((a) => [a.getAttribute('href'), gsap.getProperty(a.querySelector('.hproject__bar i'), 'scaleX')]));
  card.innerHTML = projectsHtml();
  card.querySelectorAll('.hproject').forEach((a) => {
    const v = old.get(a.getAttribute('href'));
    if (v != null) gsap.set(a.querySelector('.hproject__bar i'), { scaleX: v });
  });
  growProjectBars({ from: false });
}

// ---------- inbox (live) ----------
function inboxList() {
  const newest = (a, b) => b.at - a.at;
  const unread = state.threads.filter((t) => t.unread).sort(newest);
  // Top up with the latest read threads so the card stays full.
  const read = state.threads.filter((t) => !t.unread).sort(newest);
  return [...unread, ...read].slice(0, 5);
}

function mailRow(t) {
  const who = member(t.from);
  const name = who?.name || t.fromEmail || 'Unknown sender';
  const av = (who && avatar(t.from, 'sm')) || `<span class="av av--sm av--more" aria-hidden="true">${icon('mail')}</span>`;
  return `<li><a class="hmail ${t.unread ? 'is-unread' : ''}" href="#/inbox/${encodeURIComponent(t.id)}">
    ${av}
    <span class="hmail__text">
      <span class="hmail__top"><b>${esc(name)}</b><small>${esc(relTime(t.at))}</small></span>
      <span class="hmail__subj">${t.unread ? '<i class="hmail__dot" aria-hidden="true"></i><span class="home-sr">Unread: </span>' : ''}${esc(t.subject || '(no subject)')}</span>
    </span>
  </a></li>`;
}

function inboxHtml() {
  const slot = srcSlot('gmail');
  if (!sourceReady('gmail')) return `${slot}${skelRows(5)}`;
  const list = inboxList();
  if (!list.length) return `${slot}${emptyState('Inbox zero', 'Nothing waiting in your inbox.', 'mail')}`;
  return `${slot}<ul class="hmails">${list.map(mailRow).join('')}</ul>`;
}

const inboxSub = () => (sourceReady('gmail') ? (state.unread ? `${state.unread.toLocaleString('en-US')} unread` : 'All read') : 'Gmail');

function renderInbox() {
  const c = $('.w-inbox');
  if (!c) return;
  c.querySelector('.card__body').innerHTML = inboxHtml();
  const sub = c.querySelector('.card__sub');
  if (sub) sub.textContent = inboxSub();
}

// ---------- recent files (live) ----------
const FILE_KIND = {
  doc: ['edit', 'blue', 'Doc'],
  sheet: ['grid', 'green', 'Sheet'],
  slides: ['layers', 'orange', 'Slides'],
  pdf: ['brand', 'pink', 'PDF'],
  folder: ['folder', 'purple', 'Folder'],
  image: ['eye', 'teal', 'Image'],
  video: ['video', 'indigo', 'Video'],
  file: ['link', 'indigo', 'File'],
};

function fileRow(f) {
  const [ico, hue, label] = FILE_KIND[f.kind] || FILE_KIND.file;
  const when = f.modified ? `edited ${relTime(f.modified)}` : f.viewed ? `opened ${relTime(f.viewed)}` : '';
  const inner = `<span class="picon picon--sm hue--${hue}">${icon(ico)}</span>
    <span class="hfile__text"><b>${esc(f.title || 'Untitled')}</b><small>${label}${when ? ` · ${esc(when)}` : ''}</small></span>`;
  const url = safeUrl(f.url);
  return url
    ? `<li><a class="hfile" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}${icon('arrowRight', 'hfile__go')}<span class="home-sr">(opens in a new tab)</span></a></li>`
    : `<li><div class="hfile">${inner}</div></li>`;
}

function filesHtml() {
  const slot = srcSlot('drive');
  if (!sourceReady('drive')) return `${slot}${skelRows(5)}`;
  const list = state.files.slice(0, 5);
  if (!list.length) return `${slot}${emptyState('No recent files', 'Files you open in Google Drive show up here.', 'layers')}`;
  return `${slot}<ul class="hfiles">${list.map(fileRow).join('')}</ul>`;
}

function renderFiles() {
  const body = $('.w-files .card__body');
  if (body) body.innerHTML = filesHtml();
}

// ---------- code: GitHub (live) ----------
const GH_MAX = 4;

function codeSub() {
  const st = ghOverviewState();
  if (st.kind !== 'ok') return st.kind === 'loading' ? 'Loading from GitHub…' : 'GitHub';
  const o = state.github.overview;
  return `${plural(o.review_requests?.length || 0, 'review')} · ${plural(o.my_prs?.length || 0, 'pull request')} · ${plural(o.assigned_issues?.length || 0, 'issue')}`;
}

function ghGroup({ title, ico, items, row, none, more }) {
  const extra = items.length - GH_MAX;
  return `<section class="ghgroup" aria-label="${esc(title)}">
    <h3 class="ghgroup__h">${icon(ico)}${esc(title)}<span class="badge">${items.length}</span></h3>
    ${items.length
      ? `<ul class="ghrows">${items.slice(0, GH_MAX).map(row).join('')}</ul>${extra > 0
        ? `<a class="ghgroup__more" href="${more}" target="_blank" rel="noopener noreferrer">+${extra} more on GitHub<span class="home-sr"> (opens in a new tab)</span></a>` : ''}`
      : `<p class="ghgroup__none">${esc(none)}</p>`}
  </section>`;
}

function codeHtml() {
  const st = ghOverviewState();
  if (st.kind === 'off') return `<div class="src-note" role="status">${icon('code')}<span>${esc(st.text)}</span></div>`;
  if (st.kind === 'error') {
    return `<div class="src-note src-note--warn" role="status">${icon('bolt')}<span>${esc(st.text)}</span><button type="button" class="btn btn--sm btn--glass" data-gh="retry">Try again</button></div>`;
  }
  if (st.kind === 'loading') return skelRows(4);
  const o = state.github.overview;
  const newest = (a, b) => (b.updated || 0) - (a.updated || 0);
  return `<div class="ghcard">
    ${ghGroup({ title: 'Reviews for you', ico: 'eye', items: [...(o.review_requests || [])].sort(newest), row: (pr) => ghRow(pr), none: 'No reviews waiting on you.', more: 'https://github.com/pulls/review-requested' })}
    ${ghGroup({ title: 'Your pull requests', ico: 'pr', items: [...(o.my_prs || [])].sort(newest), row: (pr) => ghRow(pr), none: 'No open pull requests.', more: 'https://github.com/pulls' })}
    ${ghGroup({ title: 'Assigned issues', ico: 'issue', items: [...(o.assigned_issues || [])].sort(newest), row: (i) => ghRow(i, issueTaskBtn(i)), none: 'Nothing assigned to you.', more: 'https://github.com/issues/assigned' })}
  </div>`;
}

let codeSig = '';
const codeSigNow = () => {
  const g = state.github || {};
  return JSON.stringify([ghOverviewState(), g.at, (g.overview?.assigned_issues || []).map((i) => !!state.tasks.find((t) => t.source?.url === i.url))]);
};
function renderCode({ force = false } = {}) {
  const c = $('.w-code');
  if (!c) return;
  const sig = codeSigNow();
  if (!force && sig === codeSig) return;
  codeSig = sig;
  const body = c.querySelector('.card__body');
  // Keep keyboard focus on the same row (an added issue's button becomes "In tasks").
  const a = document.activeElement;
  const key = body.contains(a) ? a.dataset.ghIssue || a.dataset.ghDone || a.getAttribute('href') : null;
  body.innerHTML = codeHtml();
  const sub = c.querySelector('.card__sub');
  if (sub) sub.textContent = codeSub();
  if (key) {
    const k = CSS.escape(key);
    body.querySelector(`[data-gh-issue="${k}"], [data-gh-done="${k}"], a[href="${k}"]`)?.focus({ preventScroll: true });
  }
}

// ---------- brief (live + Claude available) ----------
function briefTextHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      list ??= [];
      list.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`), (list = null);
    out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

const briefWaiting = () => !sourceReady('calendar') && !sourceReady('gmail');

function briefTools() {
  const b = brief;
  const busy = b.status === 'loading' || b.status === 'streaming';
  if (b.status === 'idle') {
    const wait = briefWaiting();
    return `<button type="button" class="btn btn--accent btn--sm" data-brief="ask" ${wait ? 'disabled title="Waiting for your calendar and mail"' : ''}>${icon('sparkle')}Brief me</button>`;
  }
  const doc = b.docUrl
    ? `<a class="btn btn--ghost btn--sm" href="${esc(b.docUrl)}" target="_blank" rel="noopener noreferrer">${icon('link')}Open doc<span class="home-sr"> (opens in a new tab)</span></a>`
    : b.status === 'done' && b.text
      ? `<button type="button" class="btn btn--glass btn--sm" data-brief="doc" ${b.saving ? 'disabled' : ''}>${icon('edit')}${b.saving ? 'Saving…' : 'Save as Doc'}</button>`
      : '';
  return `${doc}<button type="button" class="btn btn--glass btn--sm" data-brief="refresh" ${busy ? 'disabled' : ''}>${icon('reset')}Refresh</button>`;
}

function briefBody() {
  const b = brief;
  if (b.status === 'idle') return '<p class="brief__lede">A 30-second read on today: meetings, invitations, tasks and mail that need you.</p>';
  if (b.status === 'error') {
    return `<div class="src-note src-note--warn" role="alert">${icon('bolt')}<span>${esc(b.error)}</span><button type="button" class="btn btn--sm btn--glass" data-brief="refresh">Try again</button></div>`;
  }
  const loading = b.status === 'loading' && !b.text;
  return `<div class="brief__text" aria-live="polite" aria-busy="${b.status !== 'done'}">${
    loading ? '<span class="brief__think"><i class="skel"></i><i class="skel"></i><i class="skel"></i><span class="home-sr">Claude is writing your brief…</span></span>' : briefTextHtml(b.text)
  }</div>`;
}

const briefSub = () => (brief.at && brief.status === 'done' ? `From Claude · ${fmtTime(brief.at)}` : 'From Claude, using what Lumen sees');

function briefCardHtml() {
  return card({ cls: 'w-brief', title: 'Brief', sub: esc(briefSub()), tools: briefTools(), body: briefBody() });
}

function renderBrief({ textOnly = false } = {}) {
  const c = $('.w-brief');
  if (!c) return;
  const el = c.querySelector('.brief__text');
  if (textOnly && el && brief.text) {
    el.innerHTML = briefTextHtml(brief.text);
    return;
  }
  c.querySelector('.card__tools').innerHTML = briefTools();
  c.querySelector('.card__body').innerHTML = briefBody();
  const sub = c.querySelector('.card__sub');
  if (sub) sub.textContent = briefSub();
}

function mountBrief({ animate = false } = {}) {
  const slot = $('.brief-slot');
  if (!slot || !brief.ai) return;
  slot.innerHTML = briefCardHtml();
  if (animate) revealCards(slot.querySelectorAll('.w-brief'), { y: 18 });
}

async function runBrief(cache) {
  brief.ctrl?.abort();
  const ctrl = new AbortController();
  const run = ++brief.run;
  Object.assign(brief, { ctrl, status: 'loading', text: '', error: '', docUrl: '' });
  renderBrief();
  try {
    const text = await ask(briefPrompt(), {
      cache,
      signal: ctrl.signal,
      onText(t) {
        if (run !== brief.run) return;
        brief.text = t;
        if (brief.status === 'loading') {
          brief.status = 'streaming';
          renderBrief();
        } else renderBrief({ textOnly: true });
      },
    });
    if (run !== brief.run) return;
    brief.text = (text ?? brief.text ?? '').trim();
    Object.assign(brief, brief.text ? { status: 'done', at: Date.now() } : { status: 'error', error: 'Claude returned an empty brief. Try again.' });
  } catch (err) {
    if (run !== brief.run || ctrl.signal.aborted) return;
    // Keep whatever streamed in if the stream broke halfway.
    if (brief.text) Object.assign(brief, { status: 'done', at: Date.now() });
    else Object.assign(brief, { status: 'error', error: aiErrorText(err) });
  } finally {
    if (run === brief.run) brief.ctrl = null;
  }
  if (run === brief.run) renderBrief();
}

async function saveBrief() {
  if (brief.saving || !brief.text) return;
  brief.saving = true;
  renderBrief();
  const date = new Date(brief.at || Date.now()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const name = `Brief — ${date}`.slice(0, 200);
  const markdown = `# ${name}\n\n${brief.text}\n`.slice(0, 30_000);
  const res = await liveAction(
    () => call('Claude Docs', 'batch', { container: { kind: 'project', create: { name, doc: { markdown } } }, batch: [] }),
    { busy: 'Saving your brief to Claude Docs…', done: 'Brief saved to Claude Docs', server: 'Claude Docs', ico: 'edit' },
  );
  brief.saving = false;
  const url = safeUrl(res?.url);
  if (url) brief.docUrl = url;
  renderBrief();
}

// ---------- people / activity (demo) ----------
function presenceDetail(m) {
  const now = Date.now();
  if (m.presence === 'focus') {
    const until = m.focusUntil && m.focusUntil > now ? m.focusUntil : Math.ceil((now + 40 * 60000) / (15 * 60000)) * 15 * 60000;
    return `until ${fmtTime(until)}`;
  }
  if (m.presence === 'meeting') {
    const evs = state.events.filter((e) => e.attendees.includes(m.id) && sameDay(e.start, now));
    const ev = evs.find((e) => e.start <= now && e.end > now) || evs.find((e) => e.end > now) || evs[evs.length - 1];
    return ev ? ev.title : m.role;
  }
  if (m.presence === 'away') return m.city;
  return m.role;
}

function peopleHtml() {
  if (tab === 'activity') {
    const items = state.activity.slice(0, 6);
    if (!items.length) return emptyState('Quiet so far', 'Activity from the team shows up here.', 'sparkle');
    return `<ol class="feed">${items
      .map((a) => {
        const who = member(a.who);
        const p = a.projectId ? project(a.projectId) : null;
        const inner = `${avatar(a.who, 'sm')}<span class="feed__text"><span><b>${esc(who?.name.split(' ')[0] ?? 'Someone')}</b> ${esc(a.text)}</span><small>${esc(relTime(a.at))}${p ? ` · ${esc(p.name)}` : ''}</small></span>`;
        return `<li>${a.href ? `<a class="feed__item" href="${esc(a.href)}">${inner}</a>` : `<div class="feed__item">${inner}</div>`}</li>`;
      })
      .join('')}</ol>`;
  }
  const people = state.members
    .filter((m) => m.id !== state.me)
    .sort((a, b) => PRESENCE_ORDER.indexOf(a.presence) - PRESENCE_ORDER.indexOf(b.presence))
    .slice(0, 6);
  return `<ul class="people">${people
    .map((m) => `<li><a class="person" href="#/team/${m.id}">${avatar(m.id, 'md', { presence: true })}<span class="person__text"><b>${esc(m.name)}</b><small><span class="presence-dot presence--${m.presence}"></span>${esc(PRESENCE[m.presence])} · ${esc(presenceDetail(m))}</small></span></a></li>`)
    .join('')}</ul>`;
}

function renderPeople() {
  const wrap = $('.people-wrap');
  if (wrap) wrap.innerHTML = peopleHtml();
}

function switchPeople(v) {
  tab = v;
  const wrap = $('.people-wrap');
  if (!wrap) return;
  if (reduced()) {
    wrap.innerHTML = peopleHtml();
    return;
  }
  gsap.killTweensOf(wrap);
  gsap.to(wrap, {
    opacity: 0, y: 6, duration: 0.15, ease: 'power2.in',
    onComplete() {
      wrap.innerHTML = peopleHtml();
      gsap.fromTo(wrap, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', clearProps: 'opacity,transform' });
      fadeUp(wrap.querySelectorAll('li'), { y: 8, stagger: 0.035, duration: 0.4 });
    },
  });
}

// ---------- full render ----------
function cardsHtml(m, w) {
  const s = focus.snapshot();
  const projects = card({ cls: 'w-projects', area: 'proj', title: 'Projects', sub: 'Active work and progress', tools: `<a class="btn btn--ghost btn--sm" href="#/projects">See all</a>`, body: projectsHtml() });
  const common = `
    ${card({ cls: 'w-rings', area: 'rings', title: 'Today', sub: 'Close your rings', body: ringsHtml(m) })}
    ${card({ cls: 'w-next', area: 'next', title: 'Up next', tools: `<a class="btn btn--ghost btn--sm" href="#/calendar">Calendar</a>`, body: nextHtml() })}
    ${card({ cls: `w-focus ${s ? 'is-running' : ''}`, area: 'focus', title: 'Focus', sub: 'The island keeps the time', tools: segmented('Session length', LENGTHS.map((n) => [String(n), `${n}m`]), String(F), 'seg--sm focus__len'), body: focusHtml(m) })}
    ${card({ cls: 'w-tasks', area: 'tasks', title: 'My tasks', sub: 'Due today and late', tools: `<a class="btn btn--ghost btn--sm" href="#/tasks">All tasks</a>`, body: tasksHtml() })}
    ${card({ cls: 'w-week', area: 'week', title: 'This week', sub: live ? 'Hours in meetings' : 'Tasks the team finished', expand: true, body: weekHtml(w) })}`;
  if (!live) {
    return `${common}${projects}
    ${card({ cls: 'w-people', area: 'people', title: 'Right now', tools: segmented('People view', [['team', 'Team'], ['activity', 'Activity']], tab, 'seg--sm'), body: `<div class="people-wrap">${peopleHtml()}</div>` })}`;
  }
  return `${common}
    ${card({ cls: 'w-inbox', area: 'inbox', title: 'Inbox', sub: esc(inboxSub()), tools: `<a class="btn btn--ghost btn--sm" href="#/inbox">Open inbox</a>`, body: inboxHtml() })}
    ${card({ cls: 'w-files', area: 'files', title: 'Recent files', sub: 'Google Drive', tools: `<a class="btn btn--ghost btn--sm" href="#/files">All files</a>`, body: filesHtml() })}
    ${card({ cls: 'w-code', area: 'code', title: 'Code', sub: esc(codeSub()), tools: `<a class="btn btn--ghost btn--sm" href="https://github.com/pulls" target="_blank" rel="noopener noreferrer">Pull requests<span class="home-sr"> (opens GitHub in a new tab)</span></a>`, body: codeHtml() })}
    ${withProjects ? projects : ''}`;
}

function render() {
  const m = metrics();
  const w = weekData();
  withProjects = live && hasProjects();
  root.innerHTML = `${headHtml(m)}
  ${live ? '<div class="brief-slot"></div>' : ''}
  <div class="home ${live ? 'home--live' : ''} ${withProjects ? 'home--proj' : ''}">${cardsHtml(m, w)}</div>`;

  linkStats(m);
  mountBrief();
  root.querySelectorAll('.home > .card:not(.w-week)').forEach((c) => (c.dataset.lift = ''));
  mountChart(w);
  lenSeg = bindSegmented($('.focus__len'), (v) => {
    F = +v;
    if (!focus.isRunning()) $('.focus__time').textContent = focus.mmss(F * 60000);
  });
  const pSeg = $('.w-people .seg');
  peopleSeg = pSeg ? bindSegmented(pSeg, switchPeople) : null;
  // An expanded card lives in <body>, outside the delegated root listener.
  const week = $('.w-week');
  week.addEventListener('click', (e) => {
    if (e.target.closest('[data-expand]') && week.classList.contains('is-focus')) collapseCard();
  });
  liveSig = liveSignature();
  codeSig = live ? codeSigNow() : '';
  dirty = false;
}

// Full re-render while visible (e.g. the grid gains a projects card): settle
// everything into its final state without replaying the intro.
function rerender() {
  render();
  animateCounts($('.head'));
  growProjectBars({ from: false });
  growMeter();
  updateWeek(weekData());
  lenSeg?.place(false);
  peopleSeg?.place(false);
}

function refreshAll({ tasks = false } = {}) {
  const m = metrics();
  updateHead(m, { flash: tasks });
  updateRings(m);
  updateFocusToday(m);
}

// Live: which sources changed status since the last paint.
const SOURCES = ['calendar', 'gmail', 'drive', 'workspace'];
function liveSignature() {
  const out = {};
  for (const k of SOURCES) {
    const s = state.live?.[k];
    out[k] = `${s?.status}|${s?.text}|${sourceReady(k)}`;
  }
  return out;
}

function onLive() {
  const sig = liveSignature();
  const changed = SOURCES.filter((k) => sig[k] !== liveSig[k]);
  liveSig = sig;
  if (!changed.length) return;
  if (changed.includes('calendar')) {
    renderNext();
    const slot = $('.w-week [data-src="calendar"]');
    if (slot) slot.innerHTML = sourceNote('calendar');
  }
  if (changed.includes('gmail')) renderInbox();
  if (changed.includes('drive')) renderFiles();
  if (changed.includes('workspace')) {
    const slot = $('.w-tasks [data-src="workspace"]');
    if (slot) slot.innerHTML = sourceNote('workspace');
    renderTasks();
  }
  if (brief.status === 'idle' && (changed.includes('calendar') || changed.includes('gmail'))) renderBrief();
}

// ---------- wiring ----------
function wire() {
  root.addEventListener('click', (e) => {
    const t = e.target;
    const join = t.closest('button[data-join]');
    if (join) {
      const ev = state.events.find((x) => x.id === join.dataset.join);
      notify(`Joining “${ev?.title ?? 'call'}”…`, { ico: 'video', tone: 'info' });
      return;
    }
    const gi = t.closest('[data-gh-issue]');
    if (gi) {
      const issue = findIssue(gi.dataset.ghIssue);
      if (issue) addIssueTask(issue, projectForRepo(issue.repo)?.id ?? null);
      renderCode();
      return;
    }
    if (t.closest('[data-gh="retry"]')) {
      startGithub();
      return;
    }
    const b = t.closest('[data-brief]');
    if (b) {
      if (b.disabled) return;
      const act = b.dataset.brief;
      if (act === 'ask') runBrief(true);
      else if (act === 'refresh') runBrief(false);
      else if (act === 'doc') saveBrief();
      return;
    }
    const done = t.closest('[data-done]');
    if (done) {
      const task = getTask(done.dataset.done);
      if (!task || done.dataset.busy) return;
      done.dataset.busy = '1';
      const next = task.status !== 'done';
      done.setAttribute('aria-checked', String(next));
      done.closest('.mytask')?.classList.toggle('is-done', next);
      if (!reduced()) gsap.fromTo(done.querySelector('.check'), { scale: 0.6 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', clearProps: 'transform' });
      // Let the check animate before the list reorders.
      gsap.delayedCall(dur(0.28), () => toggleDone(task));
      return;
    }
    const ev = t.closest('[data-event]');
    if (ev) return openEvent(ev.dataset.event);
    if (t.closest('[data-act="task"]')) return newTask({ assignee: state.me });
    if (t.closest('.focus__go')) {
      const sel = $('[data-focus-task]');
      focus.start(F, sel?.value || null);
      return;
    }
    const f = t.closest('[data-f]');
    if (f) {
      const s = focus.snapshot();
      if (f.dataset.f === 'pause') s?.paused ? focus.resume() : focus.pause();
      else {
        focus.stop();
        notify('Focus session ended', { ico: 'stop', tone: 'info' });
      }
    }
  });

  const onChange = (fn) => () => (hidden() ? (dirty = true) : fn());
  subscribe('tasks', onChange(() => {
    renderTasks();
    refreshAll({ tasks: true });
    if (!live) updateWeek(weekData());
    renderProjects();
    if (live) renderCode();
    if (!focus.isRunning()) {
      const sel = $('[data-focus-task]');
      if (sel) {
        const keep = sel.value;
        sel.innerHTML = focusTasksOptions();
        if (sel.querySelector(`option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
      }
    }
  }));
  subscribe('focus', onChange(() => refreshAll()));
  subscribe('events', onChange(() => {
    renderNext();
    const m = metrics();
    updateHead(m);
    if (live) {
      updateRings(m);
      updateWeek(weekData());
    }
  }));
  subscribe('activity', onChange(() => tab === 'activity' && renderPeople()));
  subscribe('projects', onChange(() => (live && hasProjects() !== withProjects ? rerender() : renderProjects())));
  subscribe('members', onChange(() => {
    setTitle();
    if (live) renderInbox();
    else if (tab === 'team') renderPeople();
  }));
  subscribe('settings', onChange(() => {
    setTitle();
    updateWeek(weekData());
  }));
  if (live) {
    subscribe('threads', onChange(() => {
      renderInbox();
      updateHead(metrics());
    }));
    subscribe('files', onChange(renderFiles));
    subscribe('github', onChange(renderCode));
    subscribe('bridge', onChange(renderCode));
    subscribe('live', onChange(onLive));
  }

  ['start', 'pause', 'resume', 'stop', 'done'].forEach((type) => focus.onFocus(type, () => !hidden() && syncFocus(type)));
  focus.onFocus('tick', () => !hidden() && syncFocus('tick'));
}

// ---------- intro ----------
function intro() {
  headIntro(root);
  const cards = root.querySelectorAll('.w-brief, .home > .card');
  revealCards(cards, { delay: 0.12, y: 30 });
  tweenRings({ fromZero: true, delay: 0.45 });
  const w = weekData();
  gsap.delayedCall(dur(0.45), () => updateWeek(w, { replay: true }));
  growProjectBars({ delay: 0.45 });
  growMeter(0.5);
  fadeUp(root.querySelectorAll('.mytask, .next__rest li, .person, .hproject, .feed li, .hmails li, .hfiles li, .ghgroup'), { y: 10, stagger: 0.03, delay: 0.45 });
}

export const page = {
  title: 'Home',
  mount(el) {
    root = el;
    render();
    wire();
    bindCardExpand(root);
    tickClock();
    if (live) {
      aiAvailable()
        .then((ok) => {
          brief.ai = !!ok;
          if (ok && root) mountBrief({ animate: !hidden() });
        })
        .catch(() => (brief.ai = false));
    }
  },
  enter({ first, same }) {
    if (same) return;
    if (dirty && !first) render();
    else {
      // Time moves on while the view is away.
      renderNext();
      updateHead(metrics());
      syncFocus('sync');
    }
    intro();
    lenSeg?.place(false);
    peopleSeg?.place(false);
  },
};
