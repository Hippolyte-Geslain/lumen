// Small HTML renderers shared by every page. They return strings; pages
// compose them into innerHTML and bind behaviour afterwards.

import { esc, icon, initials } from '../lib/dom.js';
import { member, project, PROJECT_STATUS, state as _state } from '../store.js';
import { gsap, moveLens, revealTitle, fadeUp, countTo } from '../lib/motion.js';

const HUES = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo'];
const hueFor = (s) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export const iconBtn = (name, label, attrs = '', cls = '') =>
  `<button type="button" class="ibtn ${cls}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;

/** A person's name as shown; for you, the Settings override wins. */
export const displayName = (id) => (id === 'me' && _state.settings?.name) || member(id)?.name || '';

export function avatar(id, size = 'sm', { presence = false, extra = '' } = {}) {
  const m = member(id) || (String(id || '').includes('@') ? { presence: 'away' } : null);
  if (!m) return '';
  // Live data can name someone only by address until more is known.
  const name = displayName(id) || (id === 'me' ? 'Me' : String(id).split('@')[0].replace(/[._-]+/g, ' '));
  const p = presence ? ` data-presence="${m.presence}"` : '';
  return `<span class="av av--${size} hue--${hueFor(name)} ${extra}" title="${esc(name)}"${p}>${initials(name)}</span>`;
}

export function avatarStack(ids, size = 'xs', max = 4) {
  const shown = ids.slice(0, max).map((id) => avatar(id, size)).join('');
  const more = ids.length > max ? `<span class="av av--${size} av--more">+${ids.length - max}</span>` : '';
  return `<span class="av-stack">${shown}${more}</span>`;
}

export const PRESENCE = { focus: 'In focus', meeting: 'In a meeting', online: 'Online', away: 'Away' };
export const presenceLabel = (m) => PRESENCE[m.presence];

export function projectIcon(id, size = 'sm') {
  const p = project(id);
  return p ? `<span class="picon picon--${size} hue--${p.hue}">${icon(p.icon)}</span>` : '';
}

export function projectChip(id) {
  const p = project(id);
  return p ? `<span class="pchip hue--${p.hue}">${esc(p.name)}</span>` : '';
}

export const projectStatus = (p) => PROJECT_STATUS[p.status];

export function priorityPill(p) {
  const label = p[0].toUpperCase() + p.slice(1);
  return `<span class="prio prio--${p}">${p === 'urgent' ? icon('flag') : ''}${label}</span>`;
}

export function emptyState(title, text, ico = 'sparkle', extra = '') {
  return `<div class="empty">${icon(ico)}<b>${esc(title)}</b><span>${esc(text)}</span>${extra}</div>`;
}

export function switchInput(name, checked, label) {
  return `<label class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
}

/**
 * stats: [{label, value, fmt?: 'int'|'hours'|'pct', suffix?, delta?, tone?: 'up'|'down'|'plain'}]
 */
export function pageHead({ title, sub = '', back = null, actions = '', stats = [] }) {
  return `<header class="head">
    <div class="head__lead">
      ${back ? `<a class="head__back" href="${back.href}">${icon('chevronLeft')}${esc(back.label)}</a>` : ''}
      <h1 class="head__title" tabindex="-1">${esc(title)}</h1>
      ${sub ? `<p class="head__sub">${sub}</p>` : ''}
    </div>
    ${actions ? `<div class="head__actions">${actions}</div>` : ''}
    ${
      stats.length
        ? `<dl class="head__stats">${stats
            .map(
              (s) => `<div class="stat"><dt>${esc(s.label)}</dt><dd><b data-count="${s.value}" data-fmt="${s.fmt || 'int'}">0</b>${
                s.suffix ? `<small>${esc(s.suffix)}</small>` : ''
              }${s.delta ? `<small class="delta delta--${s.tone || 'plain'}">${esc(s.delta)}</small>` : ''}</dd></div>`,
            )
            .join('')}</dl>`
        : ''
    }
  </header>`;
}

const FMT = {
  int: (v) => Math.round(v).toLocaleString('en-US'),
  hours: (v) => (v >= 60 ? `${(v / 60).toFixed(1)}h` : `${Math.round(v)}m`),
  pct: (v) => `${Math.round(v)}%`,
};

export function animateCounts(root) {
  root.querySelectorAll('[data-count]').forEach((el) => countTo(el, +el.dataset.count, FMT[el.dataset.fmt] || FMT.int));
}

// Header entrance: title chars, sub/actions fade, stats count up.
export function headIntro(root, delay = 0) {
  const head = root.querySelector('.head');
  if (!head) return;
  revealTitle(head.querySelector('.head__title'), delay);
  fadeUp(head.querySelectorAll('.head__sub, .head__back, .head__actions > *'), { y: 10, delay: delay + 0.15 });
  fadeUp(head.querySelectorAll('.stat'), { y: 14, delay: delay + 0.2, stagger: 0.05 });
  animateCounts(head);
}

export function card({ id = '', cls = '', area = '', title = '', sub = '', tools = '', expand = false, body = '' }) {
  return `<section class="card glass ${cls}" ${id ? `id="${id}"` : ''} ${area ? `style="grid-area:${area}"` : ''}>
    ${
      title
        ? `<div class="card__head"><div class="card__titles"><h2 class="card__title">${esc(title)}</h2>${sub ? `<p class="card__sub">${sub}</p>` : ''}</div>
      <div class="card__tools">${tools}${expand ? iconBtn('expand', 'Expand', 'data-expand', 'ibtn--sm') : ''}</div></div>`
        : ''
    }
    <div class="card__body">${body}</div>
  </section>`;
}

// ---------- segmented control ----------
export function segmented(label, options, current, cls = '') {
  return `<div class="seg ${cls}" role="group" aria-label="${esc(label)}"><span class="seg__pill"></span>${options
    .map(([v, html]) => `<button type="button" class="seg__btn" data-value="${v}" aria-pressed="${v === current}">${html}</button>`)
    .join('')}</div>`;
}

export function bindSegmented(el, onChange) {
  const pill = el.querySelector('.seg__pill');
  const btns = [...el.querySelectorAll('.seg__btn')];
  let value = btns.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.value;
  const place = (animate = false) => moveLens(pill, el.querySelector('[aria-pressed="true"]'), { animate, axis: 'x' });
  const select = (v, { silent = false } = {}) => {
    if (v === value) return;
    value = v;
    btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === v));
    place(true);
    if (!silent) onChange?.(v);
  };
  btns.forEach((b) => b.addEventListener('click', () => select(b.dataset.value)));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = btns.findIndex((b) => b.dataset.value === value);
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    select(next.dataset.value);
  });
  new ResizeObserver(() => place(false)).observe(el);
  requestAnimationFrame(() => place(false));
  return { place, select, get value() { return value; } };
}

// ---------- hover lift (enabled once the intro is done) ----------
export const enableLift = () => document.documentElement.classList.add('can-lift');

export { gsap };

// ---------- live source status ----------
// A section that depends on a connector shows this note when that source is
// loading or failing. key: calendar | gmail | drive | workspace.
const SOURCE_SERVER = { calendar: 'Google Calendar', gmail: 'Gmail', drive: 'Google Drive', workspace: '' };
export function sourceNote(key) {
  const s = _state.live?.[key];
  if (!s || s.status === 'ok') return '';
  if (s.status === 'loading') return `<div class="src-note">${icon('clock')}<span>Loading from ${SOURCE_SERVER[key] || 'Lumen'}…</span></div>`;
  const fix =
    s.fix === 'allow' && SOURCE_SERVER[key]
      ? `<button type="button" class="btn btn--sm btn--glass" data-allow="${SOURCE_SERVER[key]}">Allow</button>`
      : s.fix === 'reconnect' || s.fix === 'add' || s.fix === 'choose'
        ? `<button type="button" class="btn btn--sm btn--glass" data-permissions>Open permissions</button>`
        : '';
  return `<div class="src-note src-note--${s.tone || 'warn'}" role="status">${icon('bolt')}<span>${esc(s.text || 'Unavailable')}</span>${fix}</div>`;
}
/** True when the source has delivered at least once (or we're in demo mode). */
export const sourceReady = (key) => _state.demo || _state.live?.[key]?.status === 'ok' || !!_state.live?.[key]?.storedAt;
