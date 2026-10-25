// One state object, seeded deterministically and persisted to localStorage.
// The seed is rebuilt each day so relative dates ("due today", "3 days late")
// always read naturally in the demo.

import { startOfDay, addDays, uid } from './lib/dom.js';
import { LIVE } from './live/runtime.js';

const KEY = 'lumen:v1';
const VERSION = 1;

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const at = (dayOffset, hour = 9, min = 0) => {
  const d = addDays(startOfDay(), dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};

// n-th weekday from today (0 = today or next weekday).
function workday(n) {
  let d = startOfDay();
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  while (left > 0) {
    d = addDays(d, step);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

const MEMBERS = [
  ['maya', 'Maya Chen', 'Head of Product', 'Product', 'focus', 'Lisbon', 'Europe/Lisbon', 36],
  ['theo', 'Theo Bauer', 'Staff Engineer', 'Engineering', 'focus', 'Berlin', 'Europe/Berlin', 40],
  ['amara', 'Amara Diallo', 'Product Designer', 'Design', 'meeting', 'Dakar', 'Africa/Dakar', 38],
  ['ravi', 'Ravi Menon', 'Frontend Engineer', 'Engineering', 'online', 'Bangalore', 'Asia/Kolkata', 40],
  ['sofia', 'Sofia Ruiz', 'Marketing Lead', 'Marketing', 'meeting', 'Madrid', 'Europe/Madrid', 36],
  ['jonah', 'Jonah Park', 'Backend Engineer', 'Engineering', 'online', 'Seoul', 'Asia/Seoul', 40],
  ['leila', 'Leila Haddad', 'Design Lead', 'Design', 'online', 'Montréal', 'America/Toronto', 36],
  ['finn', 'Finn O’Brien', 'Product Manager', 'Product', 'away', 'Dublin', 'Europe/Dublin', 38],
  ['yuki', 'Yuki Tanaka', 'Motion Designer', 'Design', 'online', 'Tokyo', 'Asia/Tokyo', 32],
  ['carlos', 'Carlos Mendes', 'Content Strategist', 'Marketing', 'away', 'São Paulo', 'America/Sao_Paulo', 30],
  ['nadia', 'Nadia Petrova', 'QA Engineer', 'Engineering', 'online', 'Warsaw', 'Europe/Warsaw', 40],
  ['eli', 'Eli Brooks', 'Growth Marketer', 'Marketing', 'focus', 'Austin', 'America/Chicago', 36],
];

// [id, name, hue, icon, lead, members, status, startOffset, dueOffset, summary, starred, milestones]
const PROJECTS = [
  ['atlas', 'Atlas web app', 'blue', 'grid', 'theo', ['theo', 'ravi', 'amara', 'nadia', 'maya'], 'active', -48, 26,
    'The new customer dashboard: faster, keyboard-first and fully responsive.', true,
    [['Architecture review', -40], ['Design freeze', -18], ['Public beta', 9], ['GA release', 26]]],
  ['nimbus', 'Nimbus API v2', 'purple', 'layers', 'jonah', ['jonah', 'theo', 'nadia', 'finn'], 'active', -35, 18,
    'Versioned REST API with webhooks, rate limits and a typed SDK.', true,
    [['Schema draft', -28], ['SDK alpha', -6], ['Partner preview', 6], ['Launch', 18]]],
  ['quartz', 'Quartz design tokens', 'teal', 'palette', 'leila', ['leila', 'amara', 'yuki', 'ravi'], 'active', -60, 12,
    'One token source for web, iOS and Android, synced from Figma.', false,
    [['Token audit', -50], ['Color system', -22], ['Docs site', 12]]],
  ['pebble', 'Pebble onboarding', 'green', 'sprout', 'finn', ['finn', 'amara', 'eli', 'ravi'], 'review', -42, 4,
    'A calmer first week: guided setup, sample data and nudges.', false,
    [['Research synthesis', -34], ['Prototype tests', -12], ['Rollout 50%', 4]]],
  ['harbor', 'Harbor launch campaign', 'orange', 'megaphone', 'sofia', ['sofia', 'carlos', 'eli', 'yuki'], 'planning', -6, 40,
    'Launch film, press kit, landing page and the waitlist email series.', false,
    [['Creative brief', 3], ['Film shoot', 17], ['Launch day', 40]]],
  ['ledger', 'Ledger billing revamp', 'pink', 'target', 'maya', ['maya', 'jonah', 'nadia'], 'done', -90, -8,
    'Usage-based pricing, invoices and a self-serve plan switcher.', false,
    [['Pricing model', -80], ['Invoices', -40], ['Shipped', -8]]],
];

const TASK_TITLES = {
  atlas: ['Set up route-level code splitting', 'Keyboard shortcuts for list views', 'Responsive sidebar rail', 'Empty states for all widgets', 'Audit bundle size', 'Dark mode contrast pass', 'Saved filters', 'Command palette search ranking', 'Error boundary per card', 'Beta feedback triage', 'Accessibility review', 'Loading skeletons'],
  nimbus: ['Write OpenAPI schema for projects', 'Webhook retry policy', 'Rate limit headers', 'SDK pagination helpers', 'Deprecation notice copy', 'Partner sandbox keys', 'Load test the events endpoint', 'Changelog page', 'Idempotency keys', 'Auth scope matrix'],
  quartz: ['Map legacy colors to tokens', 'Figma sync plugin', 'Spacing scale proposal', 'Typography tokens for iOS', 'Docs site navigation', 'Motion tokens', 'Token linting in CI', 'Android theme export', 'Contrast checker page', 'Migration guide'],
  pebble: ['Synthesize interview notes', 'Sample workspace content', 'Checklist widget', 'Day-3 nudge email', 'Activation funnel dashboard', 'Usability test round 2', 'Copy review', 'Rollout plan', 'Skip-tour option', 'Welcome video'],
  harbor: ['Write creative brief', 'Shortlist directors', 'Press kit outline', 'Landing page wireframe', 'Waitlist email #1', 'Social teaser plan', 'Launch day run-of-show', 'Media list', 'Pricing page refresh', 'Customer quotes'],
  ledger: ['Pricing tiers spec', 'Invoice PDF template', 'Proration logic', 'Plan switcher UI', 'Tax handling', 'Dunning emails', 'Migration script', 'Billing settings page', 'Usage meter', 'Finance sign-off'],
};

const MY_TODAY = [
  ['Review Atlas beta checklist', 'atlas', 'high'],
  ['Approve Harbor creative brief', 'harbor', 'urgent'],
  ['Write Pebble rollout summary', 'pebble', 'high'],
  ['Answer Quartz token questions', 'quartz', 'medium'],
  ['Plan next sprint goals', 'atlas', 'medium'],
];
const MY_DONE_TODAY = [['Sync with Nimbus partners', 'nimbus'], ['Sign off pricing copy', 'ledger']];

const SUBTASKS = ['Draft', 'Review with team', 'Polish', 'Ship it'];
const COMMENTS = ['Looks good — one small note inline.', 'Can we push this to Thursday?', 'Pairing on this after standup.', 'Added the screenshots to the doc.', 'Blocked on the API change, ping me.'];

// [title, workday, hour, min, length, kind, project, attendees, place]
const EVENTS = [
  ['Standup', 0, 9, 30, 15, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Design review: Atlas tables', 0, 11, 0, 45, 'review', 'atlas', ['maya', 'amara', 'leila'], 'video'],
  ['Focus block', 0, 13, 30, 90, 'focus', null, ['maya'], null],
  ['Harbor kickoff', 0, 15, 30, 60, 'meeting', 'harbor', ['maya', 'sofia', 'carlos', 'eli'], 'Studio B'],
  ['Standup', 1, 9, 30, 15, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Nimbus partner call', 1, 14, 0, 45, 'meeting', 'nimbus', ['maya', 'jonah', 'finn'], 'video'],
  ['1:1 with Finn', 1, 16, 0, 30, 'meeting', null, ['maya', 'finn'], 'Cafe corner'],
  ['Standup', 2, 9, 30, 15, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Pebble rollout go/no-go', 2, 11, 0, 30, 'review', 'pebble', ['maya', 'finn', 'eli', 'amara'], 'video'],
  ['Team lunch', 2, 12, 30, 60, 'social', null, ['maya', 'theo', 'amara', 'ravi', 'leila', 'yuki'], 'Mercado'],
  ['Quartz docs deadline', 3, 17, 0, 30, 'deadline', 'quartz', ['leila', 'yuki'], null],
  ['Standup', 3, 9, 30, 15, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Sprint planning', 4, 10, 0, 60, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia', 'finn'], 'Room 4'],
  ['Atlas public beta', 7, 10, 0, 30, 'deadline', 'atlas', ['theo', 'ravi'], null],
  ['Brand film pitch', 5, 15, 0, 60, 'review', 'harbor', ['sofia', 'yuki', 'carlos'], 'Studio B'],
  ['Quarterly review', 8, 14, 0, 90, 'meeting', null, ['maya', 'sofia', 'leila', 'theo', 'finn'], 'Board room'],
  ['Retro', -1, 16, 0, 45, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Customer interview', -2, 11, 0, 45, 'meeting', 'pebble', ['finn', 'amara'], 'video'],
  ['Focus block', -1, 9, 0, 120, 'focus', null, ['maya'], null],
  ['Nimbus schema review', -3, 14, 0, 60, 'review', 'nimbus', ['jonah', 'theo', 'maya'], 'video'],
  ['Standup', -1, 9, 30, 15, 'meeting', 'atlas', ['maya', 'theo', 'ravi', 'amara', 'nadia'], 'video'],
  ['Book club', 6, 17, 30, 60, 'social', null, ['maya', 'leila', 'yuki', 'carlos'], 'Library'],
];

function seed() {
  const r = rng(2026);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const me = 'maya';

  const members = MEMBERS.map(([id, name, role, team, presence, city, tz, capacity]) => ({
    id, name, role, team, presence, city, tz, capacity,
    email: `${id}@lumen.dev`,
    focusUntil: presence === 'focus' ? at(0, 11, 30) : null,
  }));

  const projects = PROJECTS.map(([id, name, hue, icon, lead, mem, status, s, d, summary, starred, ms]) => ({
    id, name, hue, icon, lead, members: mem, status, summary, starred,
    start: at(s), due: at(d, 17),
    milestones: ms.map(([title, off], i) => ({ id: `${id}-m${i}`, title, due: at(off, 17), done: off < 0 })),
  }));

  const prios = ['low', 'medium', 'medium', 'high', 'high', 'urgent'];
  const tasks = [];
  for (const p of projects) {
    const titles = TASK_TITLES[p.id];
    titles.forEach((title, i) => {
      const f = i / titles.length;
      let status;
      if (p.status === 'done') status = 'done';
      else if (p.status === 'planning') status = i === 0 ? 'doing' : 'todo';
      else status = f < 0.6 ? 'done' : f < 0.72 ? 'review' : f < 0.86 ? 'doing' : 'todo';
      if (p.status === 'review' && status === 'todo') status = 'review';
      const due = at(Math.round((r() - 0.3) * 20));
      tasks.push({
        id: `${p.id}-${i}`, title, projectId: p.id, status,
        priority: pick(prios), assignee: pick(p.members),
        due, created: at(-Math.round(5 + r() * 30)),
        doneAt: status === 'done' ? at(-Math.round(1 + r() * 20), 15) : null,
        est: 1 + Math.floor(r() * 8), order: i,
        subtasks: i % 3 === 0 ? SUBTASKS.map((t, k) => ({ id: `${p.id}-${i}-s${k}`, title: t, done: k < (status === 'done' ? 4 : 1) })) : [],
        comments: i % 4 === 1 ? [{ id: `${p.id}-${i}-c0`, who: pick(p.members), at: at(-2, 14), text: pick(COMMENTS) }] : [],
        notes: '',
      });
    });
  }
  MY_TODAY.forEach(([title, projectId, priority], i) =>
    tasks.push({ id: `me-${i}`, title, projectId, status: i === 0 ? 'doing' : 'todo', priority, assignee: me, due: at(0, 17), created: at(-3), doneAt: null, est: 1 + (i % 3), order: -10 + i, subtasks: [], comments: [], notes: '' }),
  );
  MY_DONE_TODAY.forEach(([title, projectId], i) =>
    tasks.push({ id: `med-${i}`, title, projectId, status: 'done', priority: 'medium', assignee: me, due: at(0, 17), created: at(-4), doneAt: at(0, 9 + i), est: 1, order: -20 + i, subtasks: [], comments: [], notes: '' }),
  );
  // Background history for charts; order >= 1000 keeps them off boards and search.
  for (let d = -92; d < 0; d++) {
    const day = addDays(startOfDay(), d).getDay();
    if (day === 0 || day === 6) continue;
    const n = 2 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const p = pick(projects.filter((x) => x.status !== 'planning'));
      tasks.push({ id: `h${d}-${k}`, title: 'Archived task', projectId: p.id, status: 'done', priority: pick(prios), assignee: pick(p.members), due: at(d + Math.round(r() * 4 - 1)), created: at(d - 6), doneAt: at(d, 10 + k), est: 1 + Math.floor(r() * 6), order: 1000, subtasks: [], comments: [], notes: '' });
    }
  }

  const events = EVENTS.map(([title, wd, h, m, len, kind, projectId, attendees, place], i) => {
    const d = workday(wd);
    d.setHours(h, m, 0, 0);
    return { id: `e${i}`, title, start: d.getTime(), end: d.getTime() + len * 60000, kind, projectId, attendees, place };
  });

  const focus = [];
  for (let d = -92; d <= 0; d++) {
    const day = addDays(startOfDay(), d).getDay();
    if (day === 0 || day === 6) continue;
    for (const m of members) {
      if (r() < 0.45) continue;
      const sessions = 1 + Math.floor(r() * 3);
      for (let s = 0; s < sessions; s++) {
        const t = at(d, 9 + Math.floor(r() * 8), r() < 0.5 ? 0 : 30);
        if (t > Date.now()) continue;
        focus.push({ id: uid('f'), at: t, minutes: pick([25, 25, 50, 90]), who: m.id, taskId: null });
      }
    }
  }

  const activity = [
    [-12, 'theo', 'shipped “Responsive sidebar rail”', 'task', 'atlas'],
    [-35, 'amara', 'commented on “Checklist widget”', 'comment', 'pebble'],
    [-70, 'jonah', 'moved “Rate limit headers” to Review', 'task', 'nimbus'],
    [-110, 'leila', 'finished a 50-minute focus session', 'focus', 'quartz'],
    [-180, 'sofia', 'created Harbor launch campaign', 'project', 'harbor'],
    [-260, 'ravi', 'completed “Dark mode contrast pass”', 'task', 'atlas'],
    [-400, 'finn', 'scheduled “Pebble rollout go/no-go”', 'event', 'pebble'],
    [-520, 'nadia', 'completed “Load test the events endpoint”', 'task', 'nimbus'],
  ].map(([min, who, text, kind, projectId]) => ({ id: uid('a'), at: Date.now() + min * 60000, who, text, kind, projectId, href: `#/projects/${projectId}` }));

  const notices = [
    [-8, 'amara', 'mentioned you in “Design review: Atlas tables”', '#/calendar', false],
    [-46, 'theo', 'assigned you “Review Atlas beta checklist”', '#/tasks/me-0', false],
    [-95, 'sofia', 'shared the Harbor creative brief', '#/projects/harbor', false],
    [-300, 'jonah', 'replied to your comment on Nimbus', '#/projects/nimbus', true],
    [-1500, 'leila', 'invited you to “Book club”', '#/calendar', true],
  ].map(([min, who, text, href, read]) => ({ id: uid('n'), at: Date.now() + min * 60000, who, text, href, read }));

  return {
    version: VERSION, seededOn: todayKey(), me,
    members, projects, tasks, events, focus, activity, notices,
    settings: { name: 'Maya Chen', email: 'maya@lumen.dev', role: 'Head of Product', focusMinutes: 25, breakMinutes: 5, weekStart: 1, notify: { mentions: true, due: true, meetings: true, digest: false, focusEnd: true } },
  };
}

// Live mode (published Artifact): an empty personal workspace that the
// connectors and the per-user database fill in. Demo mode: the seed.
export const DEFAULT_SETTINGS = {
  name: '', email: '', role: '', focusMinutes: 25, breakMinutes: 5, weekStart: 1,
  notify: { mentions: true, due: true, meetings: true, digest: false, focusEnd: true },
  calendars: null, // null = primary + every non-resource calendar
  blockFocusTime: false, // mirror focus sessions as Focus time in Google Calendar
  hideDeclined: true,
  boards: null, // [{ id, name, lists: [[key, name], ...] }]; created on first use, 'done' is reserved (completion) and stays last
  boardId: 'main', // the board shown on Tasks
};

function blank() {
  return {
    version: VERSION, seededOn: todayKey(), me: 'me', demo: false,
    members: [{ id: 'me', name: '', role: '', team: '', presence: 'online', city: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, capacity: 40, email: '', emails: [] }],
    projects: [], tasks: [], events: [], focus: [], activity: [], notices: [],
    threads: [], files: [], calendars: [], unread: 0,
    live: {}, // per-source status: { calendar: {status, code, text, storedAt}, ... }
    settings: { ...DEFAULT_SETTINGS },
  };
}

function load() {
  if (LIVE) return blank();
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === VERSION && s.seededOn === todayKey()) return s;
  } catch {}
  return withExtras(seed());
}

// Fields the live sources own; the demo gets harmless empty versions.
function withExtras(s) {
  return { threads: [], files: [], calendars: [], unread: 0, live: {}, demo: true, ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
}

export const state = load();

// ---------- pub/sub ----------
const subs = new Map();
export function subscribe(topic, fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
}

const persisters = new Set();
/** Live mode registers a persister (the per-user database) for its topics. */
export const onCommit = (fn) => (persisters.add(fn), () => persisters.delete(fn));

export function commit(...topics) {
  if (!LIVE) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }
  if (topics.includes('settings') || topics.includes('tasks')) {
    const before = JSON.stringify(STATUSES);
    const moved = syncStatuses();
    if ((moved || before !== JSON.stringify(STATUSES)) && !topics.includes('tasks')) topics = [...topics, 'tasks']; // columns changed: repaint the board
  }
  persisters.forEach((f) => f(topics));
  const fns = new Set();
  for (const t of [...topics, '*']) subs.get(t)?.forEach((f) => fns.add(f));
  fns.forEach((f) => f(topics));
}

export function resetDemo() {
  Object.assign(state, LIVE ? { ...blank(), members: state.members, events: state.events, threads: state.threads, files: state.files, calendars: state.calendars, live: state.live, me: state.me } : withExtras(seed()));
  commit('members', 'projects', 'tasks', 'events', 'focus', 'activity', 'notices', 'settings');
}

export function logActivity(kind, text, projectId = null) {
  state.activity.unshift({ id: uid('a'), at: Date.now(), who: state.me, text, kind, projectId, href: projectId ? `#/projects/${projectId}` : null });
  state.activity.length = Math.min(state.activity.length, 60);
}

// ---------- selectors ----------
// Claude authors session comments but is not a person on the team, so it
// resolves here without appearing in state.members lists.
const CLAUDE = { id: 'claude', name: 'Claude', role: 'Assistant', team: 'Lumen', presence: 'online', city: '', tz: '', capacity: 0, bot: true };
export const member = (id) => state.members.find((m) => m.id === id) || (id === 'claude' ? CLAUDE : undefined);
export const project = (id) => state.projects.find((p) => p.id === id);
export const task = (id) => state.tasks.find((t) => t.id === id);
export const me = () => member(state.me);
export const firstName = (id) => member(id)?.name.split(' ')[0] ?? '';
export const cardTasks = () => state.tasks.filter((t) => t.order < 1000); // every board
/** Cards of the board shown on Tasks. A card without boardId belongs to the first board. */
export const boardTasks = () => {
  const id = activeBoard().id;
  const first = state.settings.boards[0].id;
  return cardTasks().filter((t) => (t.boardId ?? first) === id);
};
export const projectTasks = (pid) => cardTasks().filter((t) => t.projectId === pid);
export const openTasks = (who) => cardTasks().filter((t) => t.status !== 'done' && (!who || t.assignee === who));
export const projectProgress = (pid) => {
  const ts = state.tasks.filter((t) => t.projectId === pid && t.order < 1000);
  return ts.length ? ts.filter((t) => t.status === 'done').length / ts.length : 0;
};
export const dueToday = (who) => {
  const end = startOfDay().getTime() + 86_400_000;
  return cardTasks().filter((t) => t.assignee === who && t.due < end && (t.status !== 'done' || t.doneAt >= startOfDay().getTime()));
};
export const overdue = (who) => cardTasks().filter((t) => t.status !== 'done' && t.due < startOfDay().getTime() && (!who || t.assignee === who));
export const eventsOn = (day) => {
  const a = startOfDay(day).getTime();
  return state.events.filter((e) => e.start >= a && e.start < a + 86_400_000).sort((x, y) => x.start - y.start);
};
export const doneBetween = (a, b, who) => state.tasks.filter((t) => t.doneAt && t.doneAt >= a && t.doneAt < b && (!who || t.assignee === who));
export const focusMinutesBetween = (a, b, who) => state.focus.filter((f) => f.at >= a && f.at < b && (!who || f.who === who)).reduce((s, f) => s + f.minutes, 0);
export const unreadCount = () => state.notices.filter((n) => !n.read).length;
export const openHours = (who) => openTasks(who).reduce((s, t) => s + t.est, 0);

export const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];
const DEFAULT_LISTS = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];
/** Clean a list set: unique keys, 'done' always present and last, at least one other list. */
export function normalizeLists(raw) {
  const seen = new Set();
  const lists = (Array.isArray(raw) ? raw : []).filter((l) => Array.isArray(l) && l[0] && l[0] !== 'done' && !seen.has(l[0]) && seen.add(l[0])).map(([k, n]) => [String(k), String(n || k)]);
  const done = (Array.isArray(raw) ? raw : []).find((l) => l?.[0] === 'done');
  if (!lists.length) lists.push(['todo', 'To do']);
  lists.push(['done', done?.[1] || 'Done']);
  return lists;
}
function ensureBoards() {
  const st = state.settings;
  if (!Array.isArray(st.boards) || !st.boards.length) st.boards = [{ id: 'main', name: 'Board', lists: normalizeLists(st.boardLists || DEFAULT_LISTS) }];
  delete st.boardLists; // legacy single-board setting, folded into boards[0]
  st.boards = st.boards.filter((b) => b && b.id).map((b) => ({ id: String(b.id), name: String(b.name || 'Board'), lists: normalizeLists(b.lists) }));
  if (!st.boards.length) st.boards = [{ id: 'main', name: 'Board', lists: normalizeLists(DEFAULT_LISTS) }];
}
export function activeBoard() {
  ensureBoards();
  const st = state.settings;
  return st.boards.find((b) => b.id === st.boardId) || st.boards[0];
}
export const boards = () => (ensureBoards(), state.settings.boards);
export function addBoard(name) {
  ensureBoards();
  const base = String(name || 'Board').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
  let id = base;
  for (let i = 2; state.settings.boards.some((b) => b.id === id); i++) id = base + '-' + i;
  state.settings.boards.push({ id, name: String(name || 'Board').trim() || 'Board', lists: normalizeLists(DEFAULT_LISTS) });
  state.settings.boardId = id;
  commit('settings', 'tasks');
  return id;
}
export function renameBoard(id, name) {
  const b = boards().find((x) => x.id === id);
  if (b && name.trim()) { b.name = name.trim(); commit('settings'); }
}
export function switchBoard(id) {
  if (!boards().some((b) => b.id === id) || state.settings.boardId === id) return;
  state.settings.boardId = id;
  commit('settings', 'tasks');
}
/** Delete a board; its cards move to the first remaining board. The last board can't be deleted. */
export function deleteBoard(id) {
  const list = boards();
  if (list.length < 2) return false;
  const rest = list.filter((b) => b.id !== id);
  const dest = rest[0];
  for (const t of state.tasks) if ((t.boardId ?? list[0].id) === id) t.boardId = dest.id;
  state.settings.boards = rest;
  if (state.settings.boardId === id) state.settings.boardId = dest.id;
  commit('settings', 'tasks');
  return true;
}
/** Create a board with the given lists and cards (imports) and switch to it. */
export function importBoard(name, lists, cards) {
  const id = addBoard(name);
  const board = boards().find((b) => b.id === id);
  board.lists = normalizeLists(lists);
  for (const c of cards) state.tasks.push({ ...c, boardId: id });
  commit('settings', 'tasks');
  return id;
}
/** Replace the lists of the active board. */
export function setBoardLists(lists) {
  activeBoard().lists = normalizeLists(lists);
  commit('settings');
}
/** Rebuild STATUSES in place from the active board ('done' always exists and stays last), and rehome its orphaned tasks. */
export function syncStatuses() {
  const board = activeBoard();
  const lists = board.lists.map(([k, n]) => [k, n]);
  STATUSES.splice(0, STATUSES.length, ...lists);
  const keys = new Set(lists.map(([k]) => k));
  const first = state.settings.boards[0].id;
  let moved = false;
  for (const t of state.tasks) if ((t.boardId ?? first) === board.id && !keys.has(t.status)) { t.status = lists[0][0]; t.doneAt = null; moved = true; }
  return moved;
}
syncStatuses();
/** Board-agnostic roles: first list = inbox, second = in progress, penultimate = review (last is always done). */
export const firstStatus = () => STATUSES[0][0];
export const activeStatus = () => (STATUSES.length > 2 ? STATUSES[1][0] : STATUSES[0][0]);
export const reviewStatus = () => (STATUSES.length > 3 ? STATUSES[STATUSES.length - 2][0] : STATUSES[STATUSES.length - 1][0]);
/** A card an agent session can start from: still open and not yet in review. */
export const isLaunchable = (t) => !!t && t.status !== 'done' && (STATUSES.length <= 3 || t.status !== reviewStatus());
export const statusLabel = (s) => STATUSES.find(([k]) => k === s)?.[1] ?? s;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const PROJECT_STATUS = { planning: 'Planning', active: 'In progress', review: 'In review', done: 'Shipped' };

export function setTaskStatus(t, status) {
  if (t.status === status) return;
  t.status = status;
  t.doneAt = status === 'done' ? Date.now() : null;
  logActivity('task', status === 'done' ? `completed “${t.title}”` : `moved “${t.title}” to ${statusLabel(status)}`, t.projectId);
  commit('tasks', 'activity');
}
