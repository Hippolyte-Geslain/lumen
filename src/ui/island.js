// The island: one black capsule at the top of the screen that morphs between
// hidden, a compact focus timer, a toast ("note") and the full timer. Its
// visible shape is a clip-path inset animated through a proxy object, so the
// box itself never re-lays out.

import { gsap, reduced, dur } from '../lib/motion.js';
import { esc, icon } from '../lib/dom.js';
import * as focus from '../focus.js';

const SIZES = { hidden: [120, 34], compact: [204, 38], note: [384, 62], full: [440, 168] };
const MAX_W = 440;
const MAX_H = 168;
const TONES = { ok: '#30d158', info: '#6e6af0', warn: '#ff9f0a' };

let el, compactEl, noteEl, fullEl;
let mode = 'hidden';
const shape = { w: 120, h: 34 };
let noteTimer = null;

function paint() {
  const sx = (MAX_W - shape.w) / 2;
  el.style.clipPath = `inset(0 ${sx}px ${MAX_H - shape.h}px ${sx}px round ${Math.min(shape.h / 2, 44)}px)`;
}

function setMode(next) {
  if (next === mode) return;
  const prev = mode;
  mode = next;
  el.dataset.mode = next;
  el.classList.toggle('is-open', next !== 'hidden');
  const [w, h] = SIZES[next];
  gsap.killTweensOf(shape);
  const panels = { compact: compactEl, note: noteEl, full: fullEl };
  for (const [k, p] of Object.entries(panels)) {
    const on = k === next;
    p.inert = !on;
    gsap.to(p, on
      ? { opacity: 1, scale: 1, duration: dur(0.42), delay: dur(0.14), ease: 'power3.out' }
      : { opacity: 0, scale: 0.94, duration: dur(0.14) });
  }
  if (reduced()) {
    Object.assign(shape, { w, h });
    return paint();
  }
  if (next === 'hidden') {
    gsap.to(shape, { w, h, duration: 0.35, ease: 'power3.in', onUpdate: paint });
    gsap.to(el.firstElementChild, { opacity: 0, y: -12, duration: 0.3, delay: 0.1 });
    return;
  }
  if (prev === 'hidden') {
    Object.assign(shape, { w: 120, h: 34 });
    gsap.fromTo(el.firstElementChild, { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.3 });
  }
  const ease = next === 'compact' && prev !== 'hidden' ? 'back.out(1.6)' : 'elastic.out(1, 0.72)';
  gsap.to(shape, { w, h, duration: next === 'full' ? 0.8 : 0.7, ease, onUpdate: paint });
}

const restMode = () => (focus.isRunning() ? 'compact' : 'hidden');

/** Toast. tone: ok | info | warn. Returns nothing; undo runs the callback. */
export function notify(msg, { undo = null, ico = 'check', tone = 'ok', hold } = {}) {
  clearTimeout(noteTimer);
  noteEl.innerHTML = `<span class="island__ico" style="background:${TONES[tone]}">${icon(ico)}</span>
    <span class="island__msg">${esc(msg)}</span>${undo ? '<button type="button" class="island__undo">Undo</button>' : ''}`;
  noteEl.querySelector('.island__undo')?.addEventListener('click', () => {
    clearTimeout(noteTimer);
    setMode(restMode());
    undo();
  });
  setMode('note');
  noteTimer = setTimeout(() => setMode(restMode()), (hold ?? (undo ? 5 : 2.6)) * 1000);
}

function ring(r, progress, cls) {
  const c = 2 * Math.PI * r;
  return `<svg class="${cls}" viewBox="0 0 ${r * 2 + 6} ${r * 2 + 6}"><circle cx="${r + 3}" cy="${r + 3}" r="${r}" class="ring-bg"/><circle cx="${r + 3}" cy="${r + 3}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}"/></svg>`;
}

function renderTimer() {
  const s = focus.snapshot();
  if (!s) return;
  el.classList.toggle('is-paused', !!s.paused);
  compactEl.innerHTML = `${ring(9, s.progress, 'island__ring')}<span class="island__label">Focus</span><span class="island__time">${focus.mmss(s.remaining)}</span>`;
  const title = s.task ? esc(s.task.title) : `${s.minutes}-minute block`;
  const t = fullEl.querySelector('.island__bigtime');
  if (t && fullEl.dataset.paused === String(!!s.paused)) {
    t.textContent = focus.mmss(s.remaining);
    const fg = fullEl.querySelector('.ring-fg');
    const c = 2 * Math.PI * 30;
    fg.setAttribute('stroke-dashoffset', c * (1 - s.progress));
    return;
  }
  fullEl.dataset.paused = String(!!s.paused);
  fullEl.innerHTML = `<div class="island__top">${ring(30, s.progress, 'island__bigring')}
      <div class="island__meta"><span class="island__kicker">Focus session</span><b>${title}</b></div>
      <span class="island__bigtime">${focus.mmss(s.remaining)}</span></div>
    <div class="island__btns">
      <button type="button" class="island__btn" data-act="add">+5 min</button>
      <span class="island__spacer"></span>
      <button type="button" class="island__btn island__btn--round" data-act="toggle" aria-label="${s.paused ? 'Resume' : 'Pause'}">${icon(s.paused ? 'play' : 'pause')}</button>
      <button type="button" class="island__btn island__btn--round island__btn--stop" data-act="stop" aria-label="Stop">${icon('stop')}</button>
    </div>`;
}

export function initIsland() {
  el = document.querySelector('.island');
  compactEl = el.querySelector('.island__compact');
  noteEl = el.querySelector('.island__note');
  fullEl = el.querySelector('.island__full');
  [compactEl, noteEl, fullEl].forEach((p) => {
    p.inert = true;
    gsap.set(p, { opacity: 0 });
  });
  paint();

  compactEl.addEventListener('click', () => setMode('full'));
  fullEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (!reduced()) gsap.fromTo(b, { scale: 0.86 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
    const s = focus.snapshot();
    if (b.dataset.act === 'add') {
      focus.addMinutes(5);
      notify('Added 5 minutes', { ico: 'clock', tone: 'info', hold: 1.2 });
    }
    if (b.dataset.act === 'toggle') s?.paused ? focus.resume() : focus.pause();
    if (b.dataset.act === 'stop') focus.stop();
  });
  document.addEventListener('pointerdown', (e) => mode === 'full' && !el.contains(e.target) && setMode('compact'));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && mode === 'full' && setMode('compact'));

  focus.onFocus('start', () => {
    renderTimer();
    notify('Focus started — notifications are held', { ico: 'bolt', tone: 'info', hold: 1.1 });
  });
  ['tick', 'pause', 'resume'].forEach((t) => focus.onFocus(t, renderTimer));
  focus.onFocus('stop', () => notify('Focus session ended', { ico: 'stop', tone: 'info' }));
  focus.onFocus('done', () => notify('Focus complete — take a short break', { ico: 'coffee', hold: 4 }));

  if (focus.isRunning()) {
    renderTimer();
    setMode('compact');
  }
}
