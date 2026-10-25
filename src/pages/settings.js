// Settings: a sticky section nav with a jelly lens that follows scroll, and
// glass groups — connections, (live) calendar, profile, notifications,
// appearance, focus, data. Deep-linkable as #/settings/<section>.
// Live mode (published to claude.ai) shows connector status, calendar
// choices and profile overrides; demo mode explains how to go live.

import '../styles/pages/settings.css';
import { state, commit, subscribe, me, member, project, cardTasks, statusLabel, resetDemo, STATUSES, setBoardLists, importBoard } from '../store.js';
import { clickupToBoard, notionToBoard } from '../lib/pmimport.js';
import { cleanRules, describeRule, TRIGGERS, RULE_ACTIONS } from '../lib/automations.js';
import { esc, icon, download, toCsv, relTime, uid, openExternal } from '../lib/dom.js';
import { gsap, dur, reduced, revealCards, fadeUp, dealIn, moveLens } from '../lib/motion.js';
import { pageHead, headIntro, avatar, segmented, bindSegmented, sourceNote, sourceReady } from '../ui/components.js';
import { confirm, notify } from '../ui/overlays.js';
import { getLook, setLook, onLook, WALLS, ACCENTS, wallpaperSvg } from '../look.js';
import { managePermissions } from '../live/runtime.js';
import { parseTrello } from '../lib/trello.js';
import { startGithub } from '../live/github.js';
import { GH_DEMO } from '../ui/github.js';
import * as focus from '../focus.js';

// Demo mode runs on the seed; live mode reads the viewer's connectors.
const live = !state.demo;

const SECTIONS = [
  ['connections', 'Connections', 'link', 'green'],
  ...(live ? [['calendar', 'Calendar', 'calendar', 'indigo']] : []),
  ['profile', 'Profile', 'user', 'blue'],
  ['notifications', 'Notifications', 'bell', 'pink'],
  ['appearance', 'Appearance', 'palette', 'purple'],
  ['board', 'Board', 'layers', 'indigo'],
  ['automations', 'Automations', 'bolt', 'orange'],
  ['focus', 'Focus', 'clock', 'orange'],
  ...(window.claude?.local ? [['ai', 'AI models', 'sparkle', 'purple']] : []),
  ...(window.claude?.local ? [['notes', 'Notes', 'file', 'teal'], ['google', 'Google', 'link', 'blue'], ['pm', 'ClickUp & Notion', 'download', 'purple']] : []),
  ...(window.claude?.local ? [['sovereignty', 'Sovereignty', 'shield', 'orange']] : []),
  ['data', 'Data', 'layers', 'teal'],
];
const IDS = SECTIONS.map(([id]) => id);

const NOTIFY = [
  ['mentions', 'Mentions', 'When someone @mentions you', 'message', 'blue'],
  ['due', 'Due dates', 'The morning a task of yours is due', 'flag', 'orange'],
  ['meetings', 'Meetings', 'Five minutes before they start', 'calendar', 'pink'],
  ['digest', 'Daily digest', 'One summary at 9:00 AM', 'mail', 'teal'],
  ['focusEnd', 'Focus finished', 'When a session ends', 'clock', 'purple'],
];

// Live sources, as keyed in state.live: [key, label, icon, hue, what it brings, connector name].
const SOURCES = [
  ['calendar', 'Google Calendar', 'calendar', 'blue', 'Meetings, invitations and focus time', 'Google Calendar'],
  ['gmail', 'Gmail', 'mail', 'pink', 'Unread mail, threads and drafts', 'Gmail'],
  ['drive', 'Google Drive', 'layers', 'green', 'Recent and starred files', 'Google Drive'],
  ['workspace', 'Lumen data', 'shield', 'purple', 'Your tasks, projects and focus log, private to you', ''],
];

// Connectors Lumen doesn't use yet, and what each would unlock.
const MORE = [
  ['Google Tasks', 'Two-way sync between Lumen tasks and Google Tasks on your phone', 'tasks', 'blue'],
  ['ClickUp', 'The tasks and docs assigned to you, on Home and the task board', 'target', 'purple'],
  ['Notion', 'Your Notion pages and databases next to your Drive files', 'brand', 'indigo'],
  ['Linear', 'Assigned issues and cycles as tasks, with real due dates', 'bolt', 'orange'],
  ['GitHub', 'Review requests and assigned issues in My tasks', 'rocket', 'teal'],
  ['Slack', 'Mentions and DMs beside your mail in the inbox glance', 'message', 'pink'],
];

const STEPS = [
  ['focusMinutes', 'Session', 15, 90, 5],
  ['breakMinutes', 'Break', 5, 30, 5],
];

const AUTO_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
const MINUS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let root;
let current = IDS[0];
let themeSeg;
let glassSeg;
let spyPaused = false;
let spyTimer = null;
let saveTimer = null;
let ghostN = 0;
const inBand = new Set();

const $ = (sel) => root.querySelector(sel);
const $$ = (sel) => [...root.querySelectorAll(sel)];
const phone = () => matchMedia('(max-width: 760px)').matches;
const wallName = (id) => WALLS.find(([w]) => w === id)?.[1] ?? id;
const accentName = (id) => ACCENTS.find(([a]) => a === id)?.[1] ?? id;

// ---------- markup ----------
function cell({ ico, hue, label, hint = '', ctl = '', forId = '', cls = '', hintKey = '' }) {
  const title = forId ? `<label for="${forId}">${label}</label>` : `<b>${label}</b>`;
  return `<li class="cell ${cls}">
    <span class="picon picon--sm hue--${hue} cell__ico">${icon(ico)}</span>
    <div class="cell__main">
      <div class="cell__text">${title}${hint ? `<small ${hintKey ? `data-hint="${hintKey}"` : ''}>${hint}</small>` : ''}</div>
      ${ctl ? `<div class="cell__ctl">${ctl}</div>` : ''}
    </div>
  </li>`;
}

function linkCell({ ico, hue, label, hint, act, cls = '' }) {
  return `<li class="cell cell--link ${cls}">
    <button type="button" class="cell__btn" data-act="${act}">
      <span class="picon picon--sm hue--${hue} cell__ico">${icon(ico)}</span>
      <span class="cell__main"><span class="cell__text"><b>${label}</b><small ${act === 'export' ? 'data-hint="export"' : ''}>${hint}</small></span>${icon('chevronRight', 'cell__chev')}</span>
    </button>
  </li>`;
}

const group = (id, title, sub, body) => `<section class="sgroup glass" id="set-${id}" data-sec="${id}" aria-labelledby="set-${id}-title">
    <header class="sgroup__head"><h2 class="sgroup__title" id="set-${id}-title">${title}</h2><p class="sgroup__sub">${sub}</p></header>
    ${body}
  </section>`;

const toggle = (attr, checked, id) =>
  `<label class="switch"><input type="checkbox" role="switch" id="${id}" ${attr} ${checked ? 'checked' : ''}><span></span></label>`;

// ---------- identity ----------
// Live: name and role in settings override what the connectors detected;
// the email always comes from the account.
const DETECTED_FALLBACK = { name: 'You', email: '', role: '' };
const detected = (key) => (state.members[0] || {})[key] || '';

function shown(key, override = state.settings[key]) {
  if (!live) return override ?? '';
  if (key === 'email') return detected('email');
  return override || detected(key) || DETECTED_FALLBACK[key];
}
const identity = () => ({ name: shown('name'), email: shown('email'), role: shown('role') });

function inputValue(key) {
  if (live && key === 'email') return detected('email');
  return state.settings[key] ?? '';
}
const PLACEHOLDER = { name: 'Your name', email: '', role: 'e.g. Product designer' };
const placeholderFor = (key) => (live ? detected(key) || PLACEHOLDER[key] : '');

function navHtml() {
  const id = identity();
  return `<nav class="snav glass" aria-label="Settings sections">
    <a class="snav__me" href="#/settings/profile" data-go="profile">
      <span data-me-av>${avatar(state.me, 'lg', { presence: true })}</span>
      <span class="snav__who"><b data-me="name">${esc(id.name)}</b><small data-me="email">${esc(id.email)}</small></span>
    </a>
    <div class="snav__track">
      <span class="snav__lens" aria-hidden="true"></span>
      ${SECTIONS.map(([id, label, ico, hue]) => `<a class="snav__item" href="#/settings/${id}" data-go="${id}"><span class="picon picon--sm hue--${hue}">${icon(ico)}</span><span class="snav__label">${label}</span>${icon('chevronRight', 'snav__chev')}</a>`).join('')}
    </div>
  </nav>`;
}

// ---------- connections ----------
function statusOf(key) {
  const s = state.live?.[key];
  if (!s || s.status === 'loading') return { tone: 'wait', label: 'Connecting…' };
  if (s.status === 'ok') return s.partial ? { tone: 'warn', label: 'Partly connected' } : { tone: 'ok', label: 'Connected' };
  if (s.status === 'readonly') return { tone: 'info', label: 'Read-only' };
  if (s.status === 'off') return { tone: 'off', label: 'Off' };
  return { tone: s.tone === 'info' ? 'info' : 'warn', label: 'Needs attention' };
}

function connHint(key, desc) {
  const s = state.live?.[key];
  const synced = s?.storedAt ? `last synced ${relTime(s.storedAt)}` : '';
  if (!s || s.status === 'loading') return [desc, synced].filter(Boolean).join(' · ');
  if (s.status === 'ok') {
    const lead = key === 'workspace' ? 'Saving to your private Lumen space' : synced ? synced[0].toUpperCase() + synced.slice(1) : 'Synced';
    return [lead, s.partial ? s.text : ''].filter(Boolean).join(' · ');
  }
  return [s.text || desc, synced].filter(Boolean).join(' · ');
}

function connRows() {
  return SOURCES.map(([key, label, ico, hue, desc, server]) => {
    const st = statusOf(key);
    const allow = state.live?.[key]?.fix === 'allow' && server ? `<button type="button" class="btn btn--sm btn--glass" data-allow="${esc(server)}">Allow</button>` : '';
    return cell({
      ico, hue, label, hint: esc(connHint(key, desc)), cls: 'cell--conn',
      ctl: `<span class="conn__ctl">${allow}<span class="conn__status conn--${st.tone}"><i class="conn__dot" aria-hidden="true"></i>${esc(st.label)}</span></span>`,
    });
  }).join('');
}

// ---------- session bridge (Claude Code on this PC) ----------
const BRIDGE_SNIPPET = '"lumen": { "command": "node", "args": ["C:/Users/Cycrustmine/coding/perso/dashCoder/bridge/lumen-bridge.mjs"] }';

function bridgeStatus() {
  const b = state.bridge || {};
  if (b.status === 'ok') {
    const runs = state.sessions || [];
    const running = runs.filter((r) => r.status === 'running').length;
    const queued = runs.filter((r) => r.status === 'queued').length;
    return { tone: 'ok', label: ['Connected', `${running} running`, queued ? `${queued} queued` : ''].filter(Boolean).join(' · ') };
  }
  if (b.status === 'checking') return { tone: 'wait', label: 'Connecting…' };
  return { tone: 'off', label: 'Off' };
}

function bridgeHint() {
  const b = state.bridge || {};
  if (b.status === 'ok') {
    const i = b.info || {};
    return [i.version ? `Lumen bridge ${i.version}` : 'Lumen bridge', i.limit ? `up to ${i.limit} sessions at once, others queue` : ''].filter(Boolean).join(' · ');
  }
  if (b.status === 'checking') return 'Looking for the bridge in the Claude desktop app…';
  return b.text || 'Sessions run from the Claude desktop app.';
}

function bridgeCell() {
  const st = bridgeStatus();
  return cell({
    ico: 'sparkle', hue: 'purple', label: 'Session bridge', hint: esc(bridgeHint()), cls: 'cell--conn',
    ctl: `<span class="conn__ctl"><span class="conn__status conn--${st.tone}"><i class="conn__dot" aria-hidden="true"></i>${esc(st.label)}</span></span>`,
  });
}

// GitHub rides on the bridge and the GitHub CLI signed in on this PC.
function githubCell() {
  const g = state.github || {};
  const b = state.bridge || {};
  let tone = 'off';
  let label = 'Off';
  let hint = '';
  let fix = '';
  if (state.demo) hint = GH_DEMO;
  else if (b.status !== 'ok') hint = b.status === 'checking' ? 'Waiting for the Lumen bridge…' : b.text || g.text || 'GitHub needs the Lumen bridge.';
  else if (g.status === 'ok' && g.overview) {
    tone = 'ok';
    label = 'Connected';
    hint = g.overview.login ? `Signed in as ${g.overview.login}` : 'Signed in to the GitHub CLI';
  } else if (g.status === 'error' || g.status === 'off') {
    tone = 'warn';
    label = 'Not signed in';
    hint = g.text || 'Sign in to the GitHub CLI on this PC.';
    fix = '<button type="button" class="btn btn--sm btn--glass" data-act="github-retry">Check again</button>';
  } else {
    tone = 'wait';
    label = 'Connecting…';
    hint = 'Reading your GitHub account through the bridge…';
  }
  return cell({
    ico: 'code', hue: 'indigo', label: 'GitHub', cls: 'cell--conn',
    hint: `${esc(hint)}${tone === 'warn' && !/gh auth login/.test(hint) ? ' · run <code>gh auth login</code> in a terminal' : ''}`,
    ctl: `<span class="conn__ctl">${fix}<span class="conn__status conn--${tone}"><i class="conn__dot" aria-hidden="true"></i>${esc(label)}</span></span>`,
  });
}

function bridgeHtml() {
  return `<div class="bridge">
    <ul class="cells" data-bridge>${bridgeCell()}</ul>
    <ul class="cells" data-github>${githubCell()}</ul>
    <div class="bridge__help">
      <p>Lumen runs Claude Code sessions in the background on your PC through a small local bridge. It only works when Lumen is open in the Claude desktop app. To register it, add this under <code>mcpServers</code> in <code>claude_desktop_config.json</code>, then restart the app:</p>
      <div class="bridge__code"><pre tabindex="0" aria-label="Bridge configuration"><code data-bridge-snippet>${esc(BRIDGE_SNIPPET)}</code></pre>
        <button type="button" class="btn btn--glass btn--sm" data-act="copy-bridge">${icon('link')}Copy</button></div>
      <p>Claude Code must be signed in on this PC: run <code>claude /login</code> once in a terminal. For GitHub, sign in the GitHub CLI once with <code>gh auth login</code>; Lumen never sees your token.</p>
    </div>
  </div>`;
}

function refreshBridge() {
  const ul = $('[data-bridge]');
  if (ul) ul.innerHTML = bridgeCell();
  refreshGithub();
}

function refreshGithub() {
  const ul = $('[data-github]');
  if (!ul) return;
  const had = ul.contains(document.activeElement);
  ul.innerHTML = githubCell();
  if (had) (ul.querySelector('[data-act="github-retry"]') || $('[data-act="copy-bridge"]'))?.focus({ preventScroll: true });
}

function copyBridge(btn) {
  const done = () => notify('Copied the bridge configuration', { ico: 'check' });
  const fallback = () => {
    const code = $('[data-bridge-snippet]');
    if (!code) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    notify(ok ? 'Copied the bridge configuration' : 'Selected: press Ctrl+C to copy', { ico: ok ? 'check' : 'link', tone: ok ? 'ok' : 'info' });
  };
  try {
    // Called straight from the click so the browser treats it as a user gesture.
    const job = navigator.clipboard?.writeText(BRIDGE_SNIPPET);
    if (!job) return fallback();
    job.then(done, fallback);
  } catch {
    fallback();
  }
  btn.focus();
}

function connectionsHtml() {
  if (!live) {
    return group('connections', 'Connections', 'Where Lumen gets its data', `
      <div class="conn-demo">
        <span class="picon picon--md hue--green">${icon('sparkle')}</span>
        <div class="conn-demo__text">
          <b>You’re looking at the demo</b>
          <p>Everything here is sample data. Publish Lumen as an artifact on claude.ai and it goes live: it reads your own Google Calendar, Gmail and Google Drive through your claude.ai connectors, and keeps your tasks and projects in a private space only you can see.</p>
        </div>
      </div>
      ${bridgeHtml()}`);
  }
  const more = MORE.map(([label, hint, ico, hue]) => cell({ ico, hue, label: esc(label), hint: esc(hint) })).join('');
  return group('connections', 'Connections', 'What Lumen reads, through your claude.ai connectors', `
    <div class="conn-grid">
      <div class="conn-col">
        <ul class="cells" data-conn>${connRows()}</ul>
        <div class="conn__actions">
          <button type="button" class="btn btn--glass btn--sm" data-act="perms">${icon('shield')}Manage permissions</button>
          <p class="conn__fallback" role="status" data-perms-note></p>
        </div>
      </div>
      <div class="conn-col">
        <h3 class="conn__h">What else Lumen could use</h3>
        <ul class="cells cells--more">${more}</ul>
        <p class="conn__foot">${icon('link')}<span>Ask your claude.ai admin or add it in Settings → Connectors.</span></p>
      </div>
    </div>
    ${bridgeHtml()}`);
}

function refreshConnections() {
  const ul = $('[data-conn]');
  if (ul && !ul.contains(document.activeElement)) ul.innerHTML = connRows();
}

// ---------- calendar (live) ----------
const ownCalendars = () => state.calendars.filter((c) => !c.resource);
// settings.calendars: null = primary + every non-resource calendar.
function enabledCalendars() {
  const sel = state.settings.calendars;
  return new Set(Array.isArray(sel) ? sel : ownCalendars().map((c) => c.id));
}

function calendarListHtml() {
  const cals = ownCalendars();
  if (!cals.length) {
    const loading = !sourceReady('calendar') || state.live?.calendar?.status === 'loading';
    return `<li class="cells__note">${loading ? 'Loading your calendars…' : 'No calendars found in this Google account.'}</li>`;
  }
  const on = enabledCalendars();
  return [...cals]
    .sort((a, b) => !!b.primary - !!a.primary || !!a.holidays - !!b.holidays || String(a.summary || '').localeCompare(String(b.summary || '')))
    .map((c, i) => cell({
      ico: c.primary ? 'user' : c.holidays ? 'globe' : 'calendar',
      hue: c.primary ? 'blue' : c.holidays ? 'teal' : 'indigo',
      label: `${esc(c.summary || 'Untitled calendar')}${c.primary ? ' <span class="cal-pill">Primary</span>' : ''}`,
      hint: esc(c.description || (c.holidays ? 'Holidays' : c.tz || '')),
      forId: `set-cal-${i}`,
      ctl: toggle(`data-cal="${esc(c.id)}"`, on.has(c.id), `set-cal-${i}`),
    }))
    .join('');
}

function calendarHtml() {
  const s = state.settings;
  return group('calendar', 'Calendar', 'Which calendars feed Lumen, and how it treats them', `
    <div class="src-slot" data-src="calendar">${sourceNote('calendar')}</div>
    <ul class="cells" data-cals>${calendarListHtml()}</ul>
    <ul class="cells cells--sep">
      ${cell({ ico: 'x', hue: 'pink', label: 'Hide declined events', hint: 'Meetings you said no to stay out of Lumen', forId: 'set-hideDeclined', ctl: toggle('data-setting="hideDeclined"', s.hideDeclined, 'set-hideDeclined') })}
      ${cell({ ico: 'timer', hue: 'orange', label: 'Block focus sessions in Google Calendar', hint: 'Each focus session also adds Focus time to your calendar', forId: 'set-blockFocusTime', ctl: toggle('data-setting="blockFocusTime"', s.blockFocusTime, 'set-blockFocusTime') })}
    </ul>`);
}

function refreshCalendar() {
  const list = $('[data-cals]');
  if (list) {
    // Don't yank a switch out from under the keyboard: update it in place.
    if (list.contains(document.activeElement) && list.querySelectorAll('[data-cal]').length === ownCalendars().length) {
      const on = enabledCalendars();
      list.querySelectorAll('[data-cal]').forEach((i) => (i.checked = on.has(i.dataset.cal)));
    } else list.innerHTML = calendarListHtml();
  }
  const slot = $('[data-src="calendar"]');
  if (slot) slot.innerHTML = sourceNote('calendar');
  $$('[data-setting]').forEach((i) => (i.checked = !!state.settings[i.dataset.setting]));
}

// ---------- profile ----------
function profileHtml() {
  const id = identity();
  const input = (key, type, auto) => {
    const ro = live && key === 'email';
    const ph = placeholderFor(key);
    return `<input class="cell__input" id="set-${key}" type="${type}" data-profile="${key}" value="${esc(inputValue(key))}" autocomplete="${auto}" spellcheck="false"${
      ph ? ` placeholder="${esc(ph)}"` : ''}${ro ? ' readonly aria-describedby="set-email-hint"' : ''}>`;
  };
  return group('profile', 'Profile', live ? 'Lumen reads these from your account — type to override' : 'How the team sees you', `
    <div class="me-card">
      <span data-me-av>${avatar(state.me, 'xl', { presence: true })}</span>
      <div class="me-card__text"><b data-me="name">${esc(id.name)}</b><span data-me="role">${esc(id.role)}</span><small data-me="email">${esc(id.email)}</small></div>
    </div>
    <ul class="cells">
      ${cell({ ico: 'user', hue: 'blue', label: 'Name', forId: 'set-name', ctl: input('name', 'text', 'name') })}
      ${cell({ ico: 'mail', hue: 'indigo', label: 'Email', hint: live ? '<span id="set-email-hint">From your Google account</span>' : '', forId: 'set-email', cls: live ? 'cell--ro' : '', ctl: input('email', 'email', 'email') })}
      ${cell({ ico: 'tasks', hue: 'teal', label: 'Role', forId: 'set-role', ctl: input('role', 'text', 'organization-title') })}
    </ul>`);
}

function notifyHtml() {
  const n = state.settings.notify;
  return group('notifications', 'Notifications', 'What Lumen taps you on the shoulder for', `<ul class="cells">${NOTIFY.map(([key, label, hint, ico, hue]) =>
    cell({
      ico, hue, label, hint, forId: `set-n-${key}`,
      ctl: `<label class="switch"><input type="checkbox" role="switch" id="set-n-${key}" data-notify="${key}" ${n[key] ? 'checked' : ''}><span></span></label>`,
    })).join('')}</ul>`);
}

function appearanceHtml() {
  const look = getLook();
  const theme = segmented('Theme', [['light', `${icon('sun')}Light`], ['dark', `${icon('moon')}Dark`], ['system', `${AUTO_ICON}Auto`]], look.theme, 'set-theme');
  const glass = segmented('Glass', [['clear', 'Clear'], ['tinted', 'Tinted']], look.glass, 'set-glass');
  const walls = `<div class="wps" role="group" aria-label="Wallpaper">${WALLS.map(([id, name]) => `<button type="button" class="wp" data-wall="${id}" aria-pressed="${look.wall === id}">
      <span class="wp__art" data-wall="${id}">${wallpaperSvg(`wp-${id}-`, 'wp__svg')}
        <i class="wp__ui wp__ui--side"></i><i class="wp__ui wp__ui--card"></i><i class="wp__ui wp__ui--chip"></i>
        <span class="wp__check">${icon('check')}</span></span>
      <span class="wp__name">${name}</span></button>`).join('')}</div>`;
  const swatches = `<div class="sws" role="group" aria-label="Accent colour">${ACCENTS.map(([id, name]) => `<button type="button" class="sw sw--${id}" data-accent="${id}" aria-pressed="${look.accent === id}" aria-label="${name}" title="${name}"><span class="sw__dot">${icon('check')}</span></button>`).join('')}</div>`;
  return group('appearance', 'Appearance', 'The whole app re-tints through its glass', `<ul class="cells">
    ${cell({ ico: 'moon', hue: 'indigo', label: 'Theme', hint: 'Auto follows your system', ctl: theme })}
    ${cell({ ico: 'sparkle', hue: 'pink', label: 'Wallpaper', hint: esc(wallName(look.wall)), hintKey: 'wall', cls: 'cell--block', ctl: walls })}
    ${cell({ ico: 'palette', hue: 'orange', label: 'Accent', hint: esc(accentName(look.accent)), hintKey: 'accent', cls: 'cell--block cell--accent', ctl: swatches })}
    ${cell({ ico: 'layers', hue: 'blue', label: 'Glass', hint: 'Clear shows more of the wallpaper', ctl: glass })}
    ${cell({ ico: 'eye', hue: 'green', label: 'Reduce transparency', hint: 'Solid surfaces, no frost', forId: 'set-solid', ctl: `<label class="switch"><input type="checkbox" role="switch" id="set-solid" data-look="solid" ${look.solid ? 'checked' : ''}><span></span></label>` })}
  </ul>`);
}

function stepperHtml([key, label, min, max, by]) {
  const v = state.settings[key];
  return `<div class="stepper" data-step="${key}" data-min="${min}" data-max="${max}" data-by="${by}">
    <span class="stepper__label" id="step-${key}">${label}</span>
    <div class="stepper__row">
      <button type="button" class="stepper__btn" data-dir="-1" aria-label="Shorter ${label.toLowerCase()}" ${v <= min ? 'disabled' : ''}>${MINUS}</button>
      <output class="stepper__out" aria-live="polite" aria-labelledby="step-${key}"><span class="stepper__num"><b>${v}</b></span><small>min</small></output>
      <button type="button" class="stepper__btn" data-dir="1" aria-label="Longer ${label.toLowerCase()}" ${v >= max ? 'disabled' : ''}>${icon('plus')}</button>
    </div>
  </div>`;
}

function focusCellHtml() {
  const s = focus.snapshot();
  const st = state.settings;
  const hint = s ? `In focus · ${focus.mmss(s.remaining)} left` : `${st.focusMinutes} minutes, then a ${st.breakMinutes}-minute break`;
  const btn = s
    ? `<button type="button" class="btn btn--glass btn--sm" data-act="focus">${icon('stop')}End session</button>`
    : `<button type="button" class="btn btn--accent btn--sm" data-act="focus">${icon('play')}Start</button>`;
  return { hint, btn };
}

function focusHtml() {
  const { hint, btn } = focusCellHtml();
  return group('focus', 'Focus', 'The timer the island keeps', `
    <div class="steppers">${STEPS.map(stepperHtml).join('')}</div>
    <ul class="cells">${cell({ ico: 'play', hue: 'orange', label: 'Start a session now', hint: esc(hint), hintKey: 'focus', cls: 'cell--go', ctl: `<span data-focus-btn>${btn}</span>` })}</ul>`);
}

// ---------- automations ----------
const opts = (list, sel) => list.map(([k, n]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

function autoRowsHtml() {
  const rules = cleanRules(state.settings.automations, STATUSES.map(([k]) => k));
  const sl = (k) => STATUSES.find(([x]) => x === k)?.[1] ?? k;
  const row = (r) => `<li class="cell"><div class="cell__main"><div class="cell__text"><b>${esc(describeRule(r, sl))}</b></div>
    <div class="cell__ctl"><button type="button" class="btn btn--glass btn--sm" data-act="auto-toggle" data-id="${esc(r.id)}">${r.on ? 'On' : 'Off'}</button>
    <button type="button" class="btn btn--glass btn--sm" data-act="auto-del" data-id="${esc(r.id)}" aria-label="Delete rule">${icon('trash')}</button></div></div></li>`;
  const prio = ['low', 'medium', 'high', 'urgent'].map((p) => [p, p]);
  return `${rules.map(row).join('') || '<li class="cell"><div class="cell__main"><div class="cell__text"><small>No rules yet.</small></div></div></li>'}
    <li class="cell"><div class="cell__main"><div class="cell__text" data-auto-form>
      <select class="cell__input" data-auto="trigger">${opts(Object.entries(TRIGGERS))}</select>
      <select class="cell__input" data-auto="to" aria-label="List">${opts([['', 'any list'], ...STATUSES])}</select>
      <input class="cell__input" data-auto="at" type="time" value="08:00" aria-label="Time">
      <select class="cell__input" data-auto="action">${opts(Object.entries(RULE_ACTIONS))}</select>
      <select class="cell__input" data-auto="status" aria-label="Target list">${opts(STATUSES)}</select>
      <select class="cell__input" data-auto="priority" aria-label="Priority">${opts(prio, 'high')}</select>
      <input class="cell__input" data-auto="text" placeholder="Text ({{title}} = card title)" maxlength="120"></div>
    <div class="cell__ctl"><button type="button" class="btn btn--accent btn--sm" data-act="auto-add">${icon('plus')}Add rule</button></div></div></li>`;
}

function automationsHtml() {
  return group('automations', 'Automations', 'When something happens on your board, do something. Runs while Lumen is open.', `<ul class="cells" data-auto-list>${autoRowsHtml()}</ul>`);
}

function autoAct(act, el) {
  const rules = state.settings.automations = cleanRules(state.settings.automations, STATUSES.map(([k]) => k));
  if (act === 'auto-toggle') { const r = rules.find((x) => x.id === el.dataset.id); if (r) r.on = !r.on; }
  else if (act === 'auto-del') state.settings.automations = rules.filter((x) => x.id !== el.dataset.id);
  else {
    const v = (k) => $(`[data-auto="${k}"]`).value;
    const trigger = { type: v('trigger'), ...(v('trigger') === 'card_moved' && v('to') ? { to: v('to') } : {}), ...(v('trigger') === 'daily' ? { at: v('at') } : {}) };
    const type = v('action');
    const text = v('text').trim();
    const action = { type, ...(type === 'move_task' ? { status: v('status') } : {}), ...(type === 'set_priority' ? { priority: v('priority') } : {}), ...(type === 'create_task' ? { title: text, status: v('status') } : {}), ...(type === 'notify' ? { text } : {}) };
    const next = cleanRules([{ id: uid('r'), on: true, trigger, action }], STATUSES.map(([k]) => k));
    if (!next.length) return notify('That combination does not make sense (card actions need a card trigger, text actions need text).', { ico: 'x', tone: 'warn' });
    state.settings.automations = [...rules, ...next];
  }
  commit('settings');
  const ul = $('[data-auto-list]');
  if (ul) ul.innerHTML = autoRowsHtml();
}

// ---------- board columns ----------
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

function boardRowsHtml() {
  const lists = STATUSES.filter(([k]) => k !== 'done');
  const n = (k) => state.tasks.filter((t) => t.status === k).length;
  const row = ([k, name], i) => `<li class="cell"><div class="cell__main"><div class="cell__text"><input class="cell__input" data-list="${esc(k)}" value="${esc(name)}" maxlength="24" aria-label="List name"><small>${n(k)} tasks</small></div>
    <div class="cell__ctl">
      <button type="button" class="btn btn--glass btn--sm" data-act="list-up" data-key="${esc(k)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn btn--glass btn--sm" data-act="list-del" data-key="${esc(k)}" aria-label="Remove list" ${lists.length < 2 ? 'disabled' : ''}>${icon('trash')}</button>
    </div></div></li>`;
  const done = STATUSES[STATUSES.length - 1];
  return `${lists.map(row).join('')}<li class="cell"><div class="cell__main"><div class="cell__text"><b>${esc(done[1])}</b><small>Completion list, always last</small></div></div></li>
    <li class="cell"><div class="cell__main"><div class="cell__text"><input class="cell__input" data-list-new placeholder="New list name" maxlength="24" aria-label="New list name"></div>
    <div class="cell__ctl"><button type="button" class="btn btn--accent btn--sm" data-act="list-add">${icon('plus')}Add</button></div></div></li>`;
}

function boardHtml() {
  return group('board', 'Board', 'The columns of your task board', `<ul class="cells" data-board-lists>${boardRowsHtml()}</ul>`);
}

function saveLists(lists) {
  setBoardLists([...lists, STATUSES[STATUSES.length - 1]]);
  const ul = $('[data-board-lists]');
  if (ul) ul.innerHTML = boardRowsHtml();
}

function boardAct(act, el) {
  const lists = STATUSES.filter(([k]) => k !== 'done').map((l) => [...l]);
  const i = lists.findIndex(([k]) => k === el.dataset.key);
  if (act === 'list-add') {
    const input = $('[data-list-new]');
    const name = input.value.trim();
    if (!name) return input.focus();
    let key = slug(name);
    while (STATUSES.some(([k]) => k === key)) key += '-2';
    saveLists([...lists, [key, name]]);
  } else if (act === 'list-up' && i > 0) {
    [lists[i - 1], lists[i]] = [lists[i], lists[i - 1]];
    saveLists(lists);
  } else if (act === 'list-del' && lists.length > 1) {
    lists.splice(i, 1);
    saveLists(lists); // orphaned tasks are rehomed to the first list by commit()
  }
}

// ---------- sovereignty (local core only) ----------
const MODES = [
  ['airgap', 'Air-gapped', 'Nothing leaves this machine'],
  ['local', 'Allow-list', 'Only hosts you approve'],
  ['cloud', 'Cloud', 'Any host'],
];
const SECRET_NAMES = ['anthropic', 'openai', 'github', 'gitlab', 'clickup', 'notion'];

// ---------- ClickUp & Notion import (local core only) ----------
function pmHtml() {
  if (!window.claude?.local) return '';
  return group('pm', 'ClickUp & Notion', 'Import a ClickUp list or a Notion database as a new board. Save the API token under Sovereignty → vault first. Needs network access to that host.', `<ul class="cells">
    <li class="cell"><div class="cell__text"><b>ClickUp list</b><small>The number at the end of the list's URL</small></div>
      <div class="cell__ctl"><input class="cell__input" data-pm-clickup placeholder="List ID" autocomplete="off" spellcheck="false"><button type="button" class="btn btn--sm btn--glass" data-act="pm-clickup">Import</button></div></li>
    <li class="cell"><div class="cell__text"><b>Notion database</b><small>The 32-character ID in the database URL; share it with your integration first</small></div>
      <div class="cell__ctl"><input class="cell__input" data-pm-notion placeholder="Database ID" autocomplete="off" spellcheck="false"><button type="button" class="btn btn--sm btn--glass" data-act="pm-notion">Import</button></div></li>
  </ul>`);
}

async function pmAct(act) {
  const mcp = await window.claude.use('mcp');
  try {
    if (act === 'pm-clickup') {
      const listId = $('[data-pm-clickup]').value.trim();
      const res = await mcp.callTool('clickup', 'tasks', { listId });
      const r = clickupToBoard(res.payload ?? res, { name: `ClickUp ${listId}`, me: state.me, uid });
      importBoard(r.name, r.lists, r.cards);
      notify(`Imported ${r.cards.length} ClickUp tasks`, { ico: 'download' });
    } else {
      const databaseId = $('[data-pm-notion]').value.trim().replace(/-/g, '');
      const res = await mcp.callTool('notion', 'query_database', { databaseId });
      const r = notionToBoard(res.payload ?? res, { name: 'Notion database', me: state.me, uid });
      importBoard(r.name, r.lists, r.cards);
      notify(`Imported ${r.cards.length} Notion pages`, { ico: 'download' });
    }
  } catch (e) { notify(String(e?.message || e), { ico: 'x', tone: 'warn' }); }
}

// ---------- Google (local core only) ----------
function googleHtml() {
  if (!window.claude?.local) return '';
  return group('google', 'Google', 'Calendar, Gmail (read only) and Drive search. Create a Desktop-app OAuth client in your Google Cloud console and paste it here; tokens stay in the local vault.', `<ul class="cells">
    <li class="cell"><div class="cell__text"><b>OAuth client</b><small data-google="state">Not connected</small></div>
      <div class="cell__ctl"><input class="cell__input" data-google-id placeholder="Client ID" autocomplete="off" spellcheck="false"><input class="cell__input" data-google-secret type="password" placeholder="Client secret (if any)" autocomplete="off"><button type="button" class="btn btn--sm btn--glass" data-act="google-connect">Connect</button><button type="button" class="btn btn--sm btn--glass" data-act="google-off">Disconnect</button></div></li>
  </ul>`);
}

async function refreshGoogle() {
  const g = await window.claude?.use?.('google');
  const st = $('[data-google="state"]');
  if (!g || !st) return;
  const r = await g.status().catch(() => null);
  st.textContent = r?.connected ? 'Connected' : r?.hasClient ? 'Client saved, not signed in' : 'Not connected';
}

async function googleAct(act) {
  const g = await window.claude.use('google');
  try {
    if (act === 'google-off') { await g.disconnect(); notify('Google disconnected', { ico: 'check' }); }
    else {
      const id = $('[data-google-id]').value.trim();
      if (id) await g.setClient(id, $('[data-google-secret]').value);
      const { url } = await g.begin();
      $('[data-google-secret]').value = '';
      openExternal(url);
      notify('Finish signing in in your browser, then come back', { ico: 'link' });
      setTimeout(refreshGoogle, 15000);
    }
  } catch (e) { notify(String(e?.message || e), { ico: 'x', tone: 'warn' }); }
  refreshGoogle();
}

// ---------- notes folder (local core only) ----------
function notesHtml() {
  if (!window.claude?.local) return '';
  return group('notes', 'Notes', 'Point Lumen at a folder of Markdown or text (an Obsidian vault works). The assistant can then quote it. Indexed on this machine only.', `<ul class="cells">
    <li class="cell"><div class="cell__text"><b>Folder</b><small data-notes="state">Not set</small></div>
      <div class="cell__ctl"><input class="cell__input" data-notes-dir placeholder="C:\\Users\\you\\Notes" autocomplete="off" spellcheck="false"><button type="button" class="btn btn--sm btn--glass" data-act="notes-save">Use folder</button><button type="button" class="btn btn--sm btn--glass" data-act="notes-index">Reindex</button><button type="button" class="btn btn--sm btn--glass" data-act="notes-off">Stop</button></div></li>
  </ul>`);
}

async function refreshNotes() {
  const notes = await window.claude?.use?.('notes');
  const st = $('[data-notes="state"]');
  if (!notes || !st) return;
  const r = await notes.get().catch(() => null);
  st.textContent = r?.root ? r.root : 'Not set';
  const i = $('[data-notes-dir]'); if (i && r?.root && !i.value) i.value = r.root;
}

async function notesAct(act) {
  const notes = await window.claude.use('notes');
  const st = $('[data-notes="state"]');
  try {
    if (act === 'notes-save') {
      await notes.setRoot($('[data-notes-dir]').value.trim());
    } else if (act === 'notes-off') { await notes.setRoot(''); $('[data-notes-dir]').value = ''; refreshNotes(); return; }
    if (st) st.textContent = 'Indexing…';
    const r = await notes.reindex();
    notify(`Notes indexed: ${r.files} files (${r.added} new or changed)`, { ico: 'download' });
  } catch (e) { notify(String(e?.message || e), { ico: 'x', tone: 'warn' }); }
  refreshNotes();
}

// ---------- AI providers (local core only) ----------
const AI_LABEL = { anthropic: 'Anthropic', openai: 'OpenAI', ollama: 'Ollama (local)', lmstudio: 'LM Studio (local)', llamacpp: 'llama.cpp server (local)', 'claude-code': 'Claude Code (your CLI login)' };
let aiCfg = null;

function aiHtml() {
  if (!window.claude?.local) return '';
  return group('ai', 'AI models', 'Pick which model answers. Local models never leave this machine; keys live in the vault (see Sovereignty).', `<ul class="cells" data-ai="list"><li class="cell"><small>Loading…</small></li></ul><p class="cell__hint" data-ai="usage"></p>`);
}

function aiRows() {
  const ul = $('[data-ai="list"]');
  if (!ul || !aiCfg) return;
  const route = aiCfg.routes.chat;
  ul.innerHTML = aiCfg.providers.map((p) => {
    const keyed = p.kind === 'anthropic' || (p.kind === 'openai' && !p.local);
    const state = p.enabled === false ? 'Disabled' : keyed ? (p.hasKey ? 'Key in vault' : 'No key yet') : 'No key needed';
    return `<li class="cell"><div class="cell__text"><b>${esc(AI_LABEL[p.id] || p.id)}</b><small data-ai-state="${esc(p.id)}">${state}${route === p.id ? ' · default' : ''}</small></div>
      <div class="cell__ctl">${p.kind === 'claude-code' ? '' : `<input class="cell__input" data-ai-model="${esc(p.id)}" list="ai-models-${esc(p.id)}" placeholder="Model (auto)" value="${esc(p.model || '')}" autocomplete="off" spellcheck="false"><datalist id="ai-models-${esc(p.id)}"></datalist>`}
      <button type="button" class="btn btn--sm btn--glass" data-act="ai-test" data-id="${esc(p.id)}">Test</button>
      <button type="button" class="btn btn--sm btn--glass" data-act="ai-default" data-id="${esc(p.id)}" ${route === p.id ? 'disabled' : ''}>Use first</button>
      <button type="button" class="btn btn--sm btn--glass" data-act="ai-toggle" data-id="${esc(p.id)}">${p.enabled === false ? 'Enable' : 'Disable'}</button></div></li>`;
  }).join('');
}

async function refreshAi() {
  const ai = await window.claude?.use?.('ai');
  if (!ai || !root) return;
  aiCfg = await ai.get().catch(() => null);
  aiRows();
  const u = $('[data-ai="usage"]');
  if (u) {
    const days = await ai.usage().catch(() => ({}));
    const week = Object.keys(days).sort().slice(-7).flatMap((k) => Object.entries(days[k]));
    const by = {};
    for (const [p, v] of week) { const a = (by[p] ||= { calls: 0, tok: 0 }); a.calls += v.calls; a.tok += v.in + v.out; }
    u.textContent = Object.keys(by).length ? `Last 7 days (estimated): ${Object.entries(by).map(([p, v]) => `${AI_LABEL[p] || p} ${v.calls} calls, ~${v.tok.toLocaleString()} tokens`).join(' · ')}` : 'No AI calls yet.';
  }
}

async function aiAct(act, el) {
  const ai = await window.claude.use('ai');
  const id = el.dataset.id;
  try {
    if (act === 'ai-test') {
      const st = $(`[data-ai-state="${id}"]`);
      if (st) st.textContent = 'Testing…';
      const r = await ai.test(id);
      if (st) st.textContent = r.models.length ? `Connected · ${r.models.length} models` : 'Connected';
      const dl = $(`#ai-models-${id}`);
      if (dl) dl.innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join('');
      return;
    }
    if (act === 'ai-default') aiCfg = await ai.set({ routes: { ...aiCfg.routes, chat: id, fast: id } });
    else if (act === 'ai-toggle') {
      const p = aiCfg.providers.find((x) => x.id === id);
      aiCfg = await ai.set({ providers: aiCfg.providers.map((x) => (x.id === id ? { ...x, enabled: p.enabled === false } : x)) });
    }
    aiRows();
  } catch (e) {
    const st = $(`[data-ai-state="${id}"]`);
    if (st) st.textContent = String(e?.message || e);
  }
}

async function aiModel(el) {
  const ai = await window.claude.use('ai');
  const id = el.dataset.aiModel;
  aiCfg = await ai.set({ providers: aiCfg.providers.map((x) => (x.id === id ? { ...x, model: el.value.trim() || undefined } : x)) }).catch(() => aiCfg);
}

function sovereigntyHtml() {
  if (!window.claude?.local) return '';
  return group('sovereignty', 'Sovereignty', 'Control what this app may reach on the network, and keep API keys in the local vault.', `<ul class="cells">
    <li class="cell"><div class="cell__text"><b>Network mode</b><small data-sov="hint"></small></div>
      <div class="cell__ctl sov__modes" role="radiogroup" aria-label="Network mode">${MODES.map(([id, label, hint]) => `<button type="button" class="btn btn--sm btn--glass" role="radio" aria-checked="false" data-act="sov-mode" data-mode="${id}" title="${esc(hint)}">${label}</button>`).join('')}</div></li>
    <li class="cell"><div class="cell__text"><b>Allowed hosts</b><small>Used in allow-list mode. Loopback is always allowed.</small></div>
      <div class="cell__ctl"><input class="cell__input" data-sov-host placeholder="api.example.com" autocomplete="off" spellcheck="false"><button type="button" class="btn btn--sm btn--glass" data-act="sov-allow">Add</button></div></li>
    <li class="cell sov__hosts"><ul data-sov="hosts" class="sov__list"></ul></li>
    ${SECRET_NAMES.map((n) => `<li class="cell"><div class="cell__text"><b>${n} key</b><small data-sov-secret-state="${n}">Checking…</small></div>
      <div class="cell__ctl"><input class="cell__input" type="password" data-sov-secret="${n}" placeholder="Paste key" autocomplete="off"><button type="button" class="btn btn--sm btn--glass" data-act="sov-save" data-name="${n}">Save</button><button type="button" class="btn btn--sm btn--glass" data-act="sov-del" data-name="${n}">Remove</button></div></li>`).join('')}
    <li class="cell"><div class="cell__text"><b>Network log</b><small>Recent outbound requests and whether they were allowed.</small></div>
      <div class="cell__ctl"><button type="button" class="btn btn--sm btn--glass" data-act="sov-clearlog">Clear</button></div></li>
    <li class="cell sov__hosts"><ul data-sov="log" class="sov__list sov__log"></ul></li>
  </ul>`);
}

async function refreshSovereignty() {
  const guard = await window.claude?.use?.('guard');
  const sec = await window.claude?.use?.('secrets');
  if (!guard || !sec || !root) return;
  const g = await guard.get().catch(() => null);
  if (g) {
    $$('[data-act="sov-mode"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === g.mode)));
    const m = MODES.find(([id]) => id === g.mode);
    const h = $('[data-sov="hint"]'); if (h && m) h.textContent = m[2];
    const ul = $('[data-sov="hosts"]');
    if (ul) ul.innerHTML = g.allow.length
      ? g.allow.map((x) => `<li><code>${esc(x)}</code> <button type="button" class="btn btn--sm btn--glass" data-act="sov-remove" data-host="${esc(x)}">Remove</button></li>`).join('')
      : '<li><small>No hosts allowed.</small></li>';
  }
  for (const n of SECRET_NAMES) {
    const r = await sec.has(n).catch(() => null);
    const el = $(`[data-sov-secret-state="${n}"]`);
    if (el) el.textContent = r?.has ? 'Stored in the local vault' : 'Not set';
  }
  const log = await guard.log(20).catch(() => []);
  const lu = $('[data-sov="log"]');
  if (lu) lu.innerHTML = log.length
    ? log.slice().reverse().map((e) => `<li><code>${esc(e.host)}</code> <small>${e.allowed ? 'allowed' : 'blocked'} · ${esc(e.mode)} · ${relTime(e.ts)}</small></li>`).join('')
    : '<li><small>No requests yet.</small></li>';
}

async function sovereigntyAct(act, el) {
  const guard = await window.claude.use('guard');
  const sec = await window.claude.use('secrets');
  try {
    if (act === 'sov-mode') await guard.setMode(el.dataset.mode);
    else if (act === 'sov-allow') {
      const i = $('[data-sov-host]'); const host = i.value.trim().toLowerCase();
      if (host) { await guard.allow(host); i.value = ''; }
    } else if (act === 'sov-remove') await guard.remove(el.dataset.host);
    else if (act === 'sov-clearlog') await guard.clearLog();
    else if (act === 'sov-save') {
      const i = $(`[data-sov-secret="${el.dataset.name}"]`);
      if (i.value) { await sec.set(el.dataset.name, i.value); i.value = ''; notify('Key saved to the local vault', { ico: 'shield' }); }
    } else if (act === 'sov-del') await sec.delete(el.dataset.name);
  } catch (e) { notify(String(e?.message || e), { ico: 'shield', tone: 'warn' }); }
  refreshSovereignty();
}

function dataHtml() {
  return group('data', 'Data', live ? 'Your tasks, projects and focus log live in your private Lumen space' : 'Everything stays in this browser', `<ul class="cells">
    ${linkCell({ ico: 'download', hue: 'green', label: 'Export tasks as CSV', hint: `${cardTasks().length} tasks, one row each`, act: 'export' })}
    ${linkCell({ ico: 'download', hue: 'blue', label: 'Import a Trello board', hint: 'Pick the JSON file from Trello Print and export', act: 'import-trello' })}
    ${live
      ? linkCell({ ico: 'trash', hue: 'danger', label: 'Clear Lumen data', hint: 'Delete your tasks, projects, focus log and activity', act: 'clear', cls: 'cell--danger' })
      : linkCell({ ico: 'reset', hue: 'danger', label: 'Reset demo data', hint: 'Back to the sample workspace', act: 'reset', cls: 'cell--danger' })}
  </ul>`);
}

function render() {
  const sub = live ? 'Your connections, calendars, profile and the look of Lumen' : 'Your profile, the look of Lumen, and when it nudges you';
  root.innerHTML = `${pageHead({ title: 'Settings', sub })}
  <div class="settings">
    ${navHtml()}
    <div class="settings__col">
      ${connectionsHtml()}${live ? calendarHtml() : ''}${profileHtml()}${notifyHtml()}${appearanceHtml()}${boardHtml()}${automationsHtml()}${focusHtml()}${aiHtml()}${notesHtml()}${googleHtml()}${pmHtml()}${sovereigntyHtml()}${dataHtml()}
      <div class="settings__end" aria-hidden="true"></div>
    </div>
  </div>`;
}

// ---------- nav + scroll spy ----------
function setCurrent(id, animate = true) {
  if (!IDS.includes(id)) return;
  current = id;
  $$('.snav__item').forEach((a) => (a.dataset.go === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  moveLens($('.snav__lens'), $(`.snav__item[data-go="${id}"]`), { animate, axis: 'y' });
}

function pauseSpy() {
  spyPaused = true;
  clearTimeout(spyTimer);
  const resume = () => {
    clearTimeout(spyTimer);
    spyTimer = setTimeout(() => (spyPaused = false), 80);
  };
  addEventListener('scrollend', resume, { once: true });
  spyTimer = setTimeout(() => (spyPaused = false), 1100);
}

function goTo(id, { replace = true } = {}) {
  const el = $(`#set-${id}`);
  if (!el) return;
  setCurrent(id);
  pauseSpy();
  const top = el.getBoundingClientRect().top + scrollY - (phone() ? 76 : 96);
  scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  if (replace) history.replaceState(null, '', `#/settings/${id}`);
}

function spy() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => (e.isIntersecting ? inBand.add(e.target.dataset.sec) : inBand.delete(e.target.dataset.sec)));
      if (root.hidden || spyPaused) return;
      const hit = IDS.find((id) => inBand.has(id));
      if (hit && hit !== current) setCurrent(hit);
    },
    { rootMargin: '-28% 0px -62% 0px' },
  );
  $$('.sgroup').forEach((s) => io.observe(s));
  const last = IDS[IDS.length - 1];
  const end = new IntersectionObserver(([e]) => {
    if (root.hidden || spyPaused || !e.isIntersecting || scrollY <= 40) return;
    if (current !== last) setCurrent(last);
  });
  end.observe($('.settings__end'));
  new ResizeObserver(() => setCurrent(current, false)).observe($('.snav__track'));
}

// ---------- profile ----------
function mirror(field, value) {
  const text = shown(field, value.trim());
  $$(`[data-me="${field}"]`).forEach((el) => (el.textContent = text));
}

function saveProfile() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const v = Object.fromEntries($$('[data-profile]').map((i) => [i.dataset.profile, i.value.trim()]));
  const s = state.settings;
  if (live) {
    // Overrides only (blank = use the detected value); the email belongs to the account.
    if (v.name === (s.name || '') && v.role === (s.role || '')) return;
    Object.assign(s, { name: v.name, role: v.role });
    commit('settings');
    notify('Saved');
    return;
  }
  if (!v.name) return notify("Your name can't be empty", { ico: 'user', tone: 'warn' });
  if (!EMAIL_RE.test(v.email)) return notify("That email doesn't look right", { ico: 'mail', tone: 'warn' });
  if (v.name === s.name && v.email === s.email && v.role === s.role) return;
  Object.assign(s, v);
  const m = me();
  if (m) Object.assign(m, { name: v.name, email: v.email, role: v.role });
  commit('settings', 'members');
  $$('[data-me-av]').forEach((el, i) => (el.innerHTML = avatar(state.me, i === 0 ? 'lg' : 'xl', { presence: true })));
  notify('Saved');
}

// ---------- feedback ----------
function squish(input) {
  if (reduced()) return;
  const track = input.nextElementSibling;
  gsap.fromTo(track, { scaleX: 1.08, scaleY: 0.9 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.4)', clearProps: 'transform' });
  const ico = input.closest('.cell')?.querySelector('.cell__ico');
  if (ico) gsap.fromTo(ico, { scale: 0.86, rotate: input.checked ? -8 : 8 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(2.6)', clearProps: 'transform' });
}

function crossfadeWall(id) {
  const wall = document.querySelector('.wall');
  const old = getLook().wall;
  if (!wall || reduced()) return setLook({ wall: id });
  document.querySelectorAll('.wall-ghost').forEach((g) => {
    gsap.killTweensOf(g);
    g.remove();
  });
  const ghost = wall.cloneNode(false);
  ghost.classList.add('wall-ghost');
  ghost.dataset.wall = old;
  // Fresh ids: gradient stops resolve vars where they live, so the ghost
  // needs its own defs to keep showing the old palette.
  ghost.innerHTML = wallpaperSvg(`ghost${++ghostN}-`);
  wall.after(ghost);
  setLook({ wall: id });
  gsap.to(ghost, { opacity: 0, duration: 0.7, ease: 'power2.inOut', onComplete: () => ghost.remove() });
}

function syncLook() {
  const look = getLook();
  themeSeg?.select(look.theme, { silent: true });
  glassSeg?.select(look.glass, { silent: true });
  $$('.wp').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wall === look.wall)));
  $$('.sw').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accent === look.accent)));
  const solid = $('#set-solid');
  if (solid) solid.checked = !!look.solid;
  const wh = $('[data-hint="wall"]');
  if (wh) wh.textContent = wallName(look.wall);
  const ah = $('[data-hint="accent"]');
  if (ah) ah.textContent = accentName(look.accent);
}

function syncValues() {
  const s = state.settings;
  $$('[data-profile]').forEach((i) => {
    if (document.activeElement !== i) i.value = inputValue(i.dataset.profile);
    const ph = placeholderFor(i.dataset.profile);
    if (ph) i.placeholder = ph;
  });
  const id = identity();
  ['name', 'email', 'role'].forEach((f) => $$(`[data-me="${f}"]`).forEach((el) => (el.textContent = id[f])));
  if (live) $$('[data-me-av]').forEach((el, i) => (el.innerHTML = avatar(state.me, i === 0 ? 'lg' : 'xl', { presence: true })));
  $$('[data-notify]').forEach((i) => (i.checked = !!s.notify?.[i.dataset.notify]));
  $$('.stepper').forEach((st) => {
    const v = s[st.dataset.step];
    st.querySelector('.stepper__num b').textContent = v;
    st.querySelector('[data-dir="-1"]').disabled = v <= +st.dataset.min;
    st.querySelector('[data-dir="1"]').disabled = v >= +st.dataset.max;
  });
  const ex = $('[data-hint="export"]');
  if (ex) ex.textContent = `${cardTasks().length} tasks, one row each`;
}

function refreshFocusCell(hintOnly = false) {
  const { hint, btn } = focusCellHtml();
  const h = $('[data-hint="focus"]');
  if (h) h.textContent = hint;
  if (hintOnly) return;
  const b = $('[data-focus-btn]');
  if (b) b.innerHTML = btn;
}

function step(st, dir) {
  const key = st.dataset.step;
  const min = +st.dataset.min;
  const max = +st.dataset.max;
  const by = +st.dataset.by;
  const old = state.settings[key];
  const v = Math.min(max, Math.max(min, Math.round((old + dir * by) / by) * by));
  if (v === old) return;
  state.settings[key] = v;
  commit('settings');
  const minus = st.querySelector('[data-dir="-1"]');
  const plus = st.querySelector('[data-dir="1"]');
  const pressed = dir < 0 ? minus : plus;
  minus.disabled = v <= min;
  plus.disabled = v >= max;
  if (pressed.disabled) (dir < 0 ? plus : minus).focus();
  const num = st.querySelector('.stepper__num');
  const b = num.querySelector('b');
  if (reduced()) b.textContent = v;
  else {
    gsap.killTweensOf(b);
    gsap.to(b, {
      yPercent: dir > 0 ? -60 : 60, opacity: 0, duration: 0.12, ease: 'power2.in',
      onComplete() {
        b.textContent = v;
        gsap.fromTo(b, { yPercent: dir > 0 ? 60 : -60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.42, ease: 'back.out(2.2)', clearProps: 'transform,opacity' });
      },
    });
    const svg = pressed.querySelector('svg');
    if (svg) gsap.fromTo(svg, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
  }
  refreshFocusCell(true);
}

function importTrello() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const { name, lists, cards } = parseTrello(await file.text(), { me: state.me, uid });
      importBoard(name, lists, cards);
      notify(`Imported “${name}”: ${cards.length} cards`, { ico: 'download' });
    } catch (e) {
      notify(e?.message || 'That file could not be imported', { ico: 'x', tone: 'warn' });
    }
  };
  input.click();
}

function exportCsv() {
  const iso = (t) => {
    if (!t) return '';
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const tasks = cardTasks();
  const rows = [
    ['Title', 'Project', 'Status', 'Priority', 'Assignee', 'Due', 'Created', 'Done', 'Estimate (h)'],
    ...tasks.map((t) => [
      t.title, project(t.projectId)?.name ?? '', statusLabel(t.status), t.priority[0].toUpperCase() + t.priority.slice(1),
      member(t.assignee)?.name ?? '', iso(t.due), iso(t.created), iso(t.doneAt), t.est,
    ]),
  ];
  download('lumen-tasks.csv', toCsv(rows));
  notify(`Exported ${tasks.length} tasks`, { ico: 'download' });
}

async function resetData() {
  try {
    if (!(await confirm('Reset demo data?', 'Tasks, events and your edits go back to the sample workspace.', 'Reset'))) return;
    resetDemo();
    location.reload();
  } catch {
    notify('The demo data could not be reset', { ico: 'x', tone: 'warn' });
  }
}

// Live: wipe what Lumen owns. Each topic commits on its own so each
// database document is rewritten (empty) independently.
async function clearData() {
  try {
    const ok = await confirm('Clear Lumen data?', 'Your tasks, projects, focus history and activity are deleted for good. Your calendar, mail and files are not touched.', 'Clear');
    if (!ok) return;
    if (focus.isRunning()) focus.stop();
    for (const topic of ['tasks', 'projects', 'focus', 'activity']) {
      state[topic].length = 0;
      commit(topic);
    }
    notify('Lumen data cleared', { ico: 'trash' });
  } catch {
    notify('Lumen data could not be cleared', { ico: 'x', tone: 'warn' });
  }
}

async function openPermissions(btn) {
  const note = $('[data-perms-note]');
  if (btn) btn.disabled = true;
  let ok = false;
  try {
    ok = await managePermissions();
  } catch {
    ok = false;
  }
  if (btn) btn.disabled = false;
  if (note) note.textContent = ok ? '' : 'Lumen can’t open it from here. Use the Permissions menu of this artifact in claude.ai.';
}

// ---------- wiring ----------
function wire() {
  themeSeg = bindSegmented($('.set-theme'), (theme) => setLook({ theme }));
  glassSeg = bindSegmented($('.set-glass'), (glass) => setLook({ glass }));

  root.addEventListener('click', (e) => {
    const t = e.target;
    const go = t.closest('[data-go]');
    if (go) {
      e.preventDefault();
      goTo(go.dataset.go);
      return;
    }
    const wp = t.closest('.wp');
    if (wp) {
      if (wp.dataset.wall === getLook().wall) return;
      crossfadeWall(wp.dataset.wall);
      if (!reduced()) {
        gsap.fromTo(wp.querySelector('.wp__art'), { scale: 0.9 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.45)', clearProps: 'transform' });
        gsap.fromTo(wp.querySelector('.wp__check'), { scale: 0.3 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
      }
      return;
    }
    const sw = t.closest('.sw');
    if (sw) {
      if (sw.dataset.accent === getLook().accent) return;
      setLook({ accent: sw.dataset.accent });
      if (!reduced()) gsap.fromTo(sw.querySelector('.sw__dot'), { scale: 0.72 }, { scale: 1, duration: 0.65, ease: 'elastic.out(1.1, 0.4)', clearProps: 'transform' });
      return;
    }
    const stepBtn = t.closest('.stepper__btn');
    if (stepBtn) return step(stepBtn.closest('.stepper'), +stepBtn.dataset.dir);
    const actEl = t.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (act === 'focus') {
      if (focus.isRunning()) focus.stop();
      else focus.start(state.settings.focusMinutes);
    } else if (act === 'export') exportCsv();
    else if (act === 'import-trello') importTrello();
    else if (act === 'reset') resetData();
    else if (act === 'clear') clearData();
    else if (act?.startsWith('list-')) boardAct(act, actEl);
    else if (act?.startsWith('auto-')) autoAct(act, actEl);
    else if (act === 'perms') openPermissions(actEl);
    else if (act === 'copy-bridge') copyBridge(actEl);
    else if (act === 'github-retry') startGithub();
    else if (act?.startsWith('sov-')) sovereigntyAct(act, actEl).then(refreshAi);
    else if (act?.startsWith('ai-')) aiAct(act, actEl);
    else if (act?.startsWith('notes-')) notesAct(act);
    else if (act?.startsWith('google-')) googleAct(act);
    else if (act?.startsWith('pm-')) pmAct(act);
  });

  root.addEventListener('change', (e) => {
    if (e.target.dataset?.aiModel) aiModel(e.target);
    const t = e.target;
    if (t.matches('[data-notify]')) {
      state.settings.notify[t.dataset.notify] = t.checked;
      commit('settings');
      squish(t);
    } else if (t.matches('[data-look="solid"]')) {
      setLook({ solid: t.checked });
      squish(t);
    } else if (t.matches('[data-list]')) {
      const name = t.value.trim();
      if (!name) return void (t.value = statusLabel(t.dataset.list));
      setBoardLists(STATUSES.map(([k, l]) => (k === t.dataset.list ? [k, name] : [k, l])));
    } else if (t.matches('[data-setting]')) {
      state.settings[t.dataset.setting] = t.checked;
      commit('settings');
      squish(t);
    } else if (t.matches('[data-cal]')) {
      const ids = $$('[data-cal]').filter((i) => i.checked).map((i) => i.dataset.cal);
      if (!ids.length) {
        t.checked = true;
        notify('Keep at least one calendar on', { ico: 'calendar', tone: 'warn' });
        return;
      }
      // From the first toggle on, an explicit list (null meant "primary + all").
      state.settings.calendars = ids;
      commit('settings');
      squish(t);
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches('[data-profile]') || t.readOnly) return;
    mirror(t.dataset.profile, t.value);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProfile, 800);
  });
  root.addEventListener('focusout', (e) => {
    if (e.target.matches('[data-profile]') && saveTimer) saveProfile();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-list-new]')) {
      e.preventDefault();
      boardAct('list-add', e.target);
    } else if (e.key === 'Enter' && e.target.matches('[data-profile]')) {
      e.preventDefault();
      if (saveTimer) saveProfile();
    }
  });

  onLook(syncLook);
  ['start', 'pause', 'resume', 'stop', 'done'].forEach((type) => focus.onFocus(type, () => refreshFocusCell()));
  focus.onFocus('tick', () => !root.hidden && refreshFocusCell(true));
  subscribe('tasks', () => {
    const ex = $('[data-hint="export"]');
    if (ex) ex.textContent = `${cardTasks().length} tasks, one row each`;
  });
  subscribe('bridge', refreshBridge);
  subscribe('github', refreshGithub);
  subscribe('sessions', refreshBridge);
  if (live) {
    subscribe('live', () => {
      refreshConnections();
      refreshCalendar();
    });
    subscribe('calendars', refreshCalendar);
    // Settings and the detected identity arrive after mount in live mode.
    subscribe('settings', () => {
      syncValues();
      refreshCalendar();
    });
    subscribe('members', syncValues);
  }
  spy();
}

// ---------- intro ----------
function inView(els) {
  return els.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  });
}

function intro() {
  headIntro(root);
  revealCards([$('.snav'), ...$$('.sgroup')], { delay: 0.12, y: 30, kids: false });
  gsap.delayedCall(dur(0.4), () => setCurrent(current, false));
  fadeUp($$('.snav__item, .snav__me'), { x: -8, y: 0, stagger: 0.035, delay: 0.4 });
  fadeUp(inView($$('.cell:not(.cell--block), .me-card, .stepper, .conn-demo')), { y: 10, stagger: 0.025, delay: 0.4 });
  const tiles = inView($$('.wp'));
  dealIn(tiles, { delay: 0.5 });
  if (!reduced()) {
    const dots = $$('.sw__dot');
    gsap.fromTo(dots, { scale: 0.4 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', stagger: 0.04, delay: 0.65, clearProps: 'transform' });
  }
}

export const page = {
  title: 'Settings',
  mount(el) {
    root = el;
    render();
    wire();
  },
  enter({ params = [], first, same }) {
    const sec = IDS.includes(params[0]) ? params[0] : null;
    if (same) {
      if (sec && sec !== current) goTo(sec, { replace: false });
      return;
    }
    syncLook();
    syncValues();
    refreshFocusCell();
    refreshBridge();
    refreshSovereignty();
    refreshAi();
    refreshNotes();
    refreshGoogle();
    if (live) {
      refreshConnections();
      refreshCalendar();
    }
    themeSeg?.place(false);
    glassSeg?.place(false);
    intro();
    if (sec) {
      setCurrent(sec, false);
      pauseSpy();
      gsap.delayedCall(first ? 0.5 : 0.3, () => goTo(sec, { replace: false }));
    } else {
      current = IDS[0];
      setCurrent(current, false);
    }
  },
};
