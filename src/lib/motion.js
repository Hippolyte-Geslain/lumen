import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(Flip);
export { gsap, Flip };

const rm = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => rm.matches;
export const dur = (s) => (rm.matches ? 0 : s);

// ---------- headline: words → chars that rise into place ----------
export function splitTitle(el) {
  if (!el || el.dataset.split) return;
  el.dataset.split = '1';
  const text = el.textContent;
  el.setAttribute('aria-label', text);
  el.innerHTML = text
    .split(' ')
    .map((w) => `<span class="word" aria-hidden="true">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`)
    .join(' ');
}

export function revealTitle(el, delay = 0) {
  if (!el) return;
  splitTitle(el);
  const chars = el.querySelectorAll('.ch');
  if (reduced()) return gsap.set(chars, { clearProps: 'all' });
  gsap.fromTo(chars, { yPercent: 115, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 0.85, ease: 'power4.out', stagger: 0.022, delay });
}

// ---------- cards: clip open from the centre, overshooting the box ----------
const clip = (f) => `inset(${f * 50}% ${f * 50}% ${f * 50}% ${f * 50}% round var(--r-lg))`;

export function revealCards(els, { y = 26, stagger = 0.06, delay = 0, from = 0.42, kids = true } = {}) {
  els = gsap.utils.toArray(els);
  if (!els.length) return;
  if (reduced()) return gsap.set(els, { clearProps: 'clipPath,opacity,transform' });
  gsap.fromTo(
    els,
    { clipPath: clip(from), y, scale: 0.97, opacity: 0 },
    {
      clipPath: 'inset(-60px -60px -60px -60px round var(--r-lg))',
      y: 0, scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out', stagger, delay,
      onComplete() {
        gsap.set(this.targets(), { clearProps: 'clipPath,transform,opacity' });
      },
    },
  );
  if (kids) {
    els.forEach((el, i) => {
      const children = el.querySelectorAll(':scope > *');
      gsap.fromTo(children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.04, delay: delay + i * stagger + 0.14, clearProps: 'opacity,transform' });
    });
  }
}

export function collapseOut(els, done, { duration = 0.18 } = {}) {
  els = gsap.utils.toArray(els);
  if (!els.length || reduced()) return done?.();
  gsap.to(els, { clipPath: clip(0.4), opacity: 0, scale: 0.98, duration, ease: 'power2.in', onComplete: done });
}

export function fadeUp(els, { x = 0, y = 12, stagger = 0.04, delay = 0, duration = 0.55 } = {}) {
  els = gsap.utils.toArray(els);
  if (!els.length || reduced()) return;
  gsap.fromTo(els, { opacity: 0, x, y }, { opacity: 1, x: 0, y: 0, duration, ease: 'power3.out', stagger, delay, clearProps: 'opacity,transform' });
}

export function dealIn(els, { delay = 0 } = {}) {
  els = gsap.utils.toArray(els);
  if (!els.length || reduced()) return;
  gsap.fromTo(
    els,
    { y: 40, opacity: 0, scale: 0.94, rotate: (i) => (i % 2 ? 3 : -3) },
    { y: 0, opacity: 1, scale: 1, rotate: 0, duration: 0.7, ease: 'back.out(1.4)', stagger: 0.05, delay, clearProps: 'opacity,transform' },
  );
}

export function popIn(el) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { scale: 0.6 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
}

export function bounceIcon(btn) {
  const svg = btn?.querySelector('svg');
  if (!svg || reduced()) return;
  gsap.fromTo(svg, { scale: 0.72 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.4)', clearProps: 'transform' });
}

const counted = new WeakMap();
export function countTo(el, value, fmt = (v) => Math.round(v)) {
  const from = counted.get(el) ?? 0;
  counted.set(el, value);
  if (reduced()) {
    el.textContent = fmt(value);
    return;
  }
  const o = { v: from };
  gsap.to(o, { v: value, duration: 1.1, ease: 'power3.out', onUpdate: () => (el.textContent = fmt(o.v)) });
}

// ---------- the jelly lens behind the active nav item / segment ----------
export function moveLens(lens, target, { animate = true, axis = 'x' } = {}) {
  if (!lens) return;
  if (!target || !target.offsetWidth) {
    gsap.set(lens, { opacity: 0 });
    lens._box = null;
    return;
  }
  const box = [target.offsetLeft, target.offsetTop, target.offsetWidth, target.offsetHeight];
  const [x, y, w, h] = box;
  const prev = lens._box;
  lens._box = box;
  const visible = gsap.getProperty(lens, 'opacity') > 0.5;
  gsap.killTweensOf(lens);
  if (!animate || reduced() || !prev || !visible) {
    gsap.set(lens, { x, y, width: w, height: h, scaleX: 1, scaleY: 1, opacity: 1 });
    return;
  }
  const [px, py, pw, ph] = prev;
  const along = axis === 'x' ? 'scaleX' : 'scaleY';
  const cross = axis === 'x' ? 'scaleY' : 'scaleX';
  const travel = axis === 'x' ? Math.abs(x - px) : Math.abs(y - py);
  const size = axis === 'x' ? w : h;
  const k = Math.min(0.5, 0.16 + (0.14 * travel) / size);
  gsap.set(lens, { width: w, height: h, opacity: 1 });
  gsap.fromTo(
    lens,
    { x: px + pw / 2 - w / 2, y: py + ph / 2 - h / 2 },
    { x, y, duration: 0.62, ease: 'back.out(1.35)' },
  );
  gsap.fromTo(
    lens,
    { scaleX: pw / w, scaleY: ph / h },
    {
      keyframes: [
        { [along]: 1 + k, [cross]: 1 - 0.45 * k, duration: 0.16, ease: 'power2.out' },
        { scaleX: 1, scaleY: 1, duration: 0.85, ease: 'elastic.out(1.1, 0.38)' },
      ],
    },
  );
}

// ---------- FLIP a keyed list across a DOM mutation ----------
export function flipList(container, mutate) {
  const before = new Map();
  container.querySelectorAll('[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect()));
  mutate();
  if (reduced()) return;
  container.querySelectorAll('[data-key]').forEach((el) => {
    const old = before.get(el.dataset.key);
    if (!old) {
      gsap.fromTo(el, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)', clearProps: 'opacity,transform' });
      return;
    }
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (dx || dy) gsap.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.55, ease: 'power3.inOut', clearProps: 'transform' });
  });
}

// ---------- press feedback: squash buttons, ripple surfaces ----------
const PRESSABLE = '.btn, .ibtn, .tbtn, .seg__btn, .nav__item, .tab, .tabbar__search, .search-pill, .island__btn, .sw, .wp, .side__me, .pinned a';

function ripple(host, e, big) {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const wrap = document.createElement('span');
  wrap.className = 'ripple-wrap';
  const dot = document.createElement('span');
  dot.className = 'ripple';
  const r = host.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  wrap.append(dot);
  host.append(wrap);
  const far = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
  gsap.fromTo(
    dot,
    { scale: 0.2, opacity: big ? 0.55 : 0.9 },
    { scale: Math.min((far * 2.2) / 20, big ? 60 : 30), opacity: 0, duration: big ? 1.1 : 0.75, ease: 'power2.out', onComplete: () => wrap.remove() },
  );
}

export function pressEffects() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || reduced()) return;
    const t = e.target;
    if (t.closest('input, textarea, select, [contenteditable], .tk-card')) return;
    const btn = t.closest(PRESSABLE);
    if (btn && !btn.disabled) {
      gsap.timeline()
        .to(btn, { scaleX: 1.07, scaleY: 0.9, duration: 0.11, ease: 'power2.out' })
        .to(btn, { scaleX: 1, scaleY: 1, duration: 0.7, ease: 'elastic.out(1.15, 0.32)', clearProps: 'transform' });
      ripple(btn, e, false);
      return;
    }
    const surface = t.closest('.glass:not(.glass--thick)');
    if (surface && !surface.closest('.side, .toolbar, .tabbar')) ripple(surface, e, true);
  });
}

// Elements with .magnetic drift toward the pointer.
export function magnetic(root = document) {
  if (reduced() || !matchMedia('(hover: hover)').matches) return;
  root.querySelectorAll('.magnetic').forEach((el) => {
    if (el._mag) return;
    el._mag = true;
    const qx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
    const qy = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      qx((e.clientX - r.left - r.width / 2) * 0.24);
      qy((e.clientY - r.top - r.height / 2) * 0.3);
    });
    el.addEventListener('pointerleave', () => {
      qx(0);
      qy(0);
    });
  });
}
