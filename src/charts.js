// Hand-drawn charts: SVG line/area + donut + rings, DOM bars. GSAP animates
// the draw-in and morphs when the data changes.

import { gsap, reduced } from './lib/motion.js';
import { esc } from './lib/dom.js';

let chartN = 0;
const tip = (() => {
  let el;
  return {
    show(html, x, y) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'chart-tip';
        document.body.append(el);
      }
      el.innerHTML = html;
      el.style.left = `${Math.min(innerWidth - el.offsetWidth - 8, x + 14)}px`;
      el.style.top = `${y - el.offsetHeight - 10}px`;
      el.style.opacity = 1;
    },
    hide() {
      if (el) el.style.opacity = 0;
    },
  };
})();

// Monotone cubic path: smooth, never overshoots the data points.
function smoothPath(pts) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const d = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  let p = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = (x1 - x0) / 3;
    p += `C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return p;
}

/**
 * Line / area chart.
 * series: [{ name, tone: 'blue'|..., values: number[] }], labels: string[]
 * Returns { update(series, labels) }.
 */
export function lineChart(host, { series, labels, height = 220, fmt = (v) => v, area = true }) {
  const id = `ch${++chartN}`;
  let cur = { series, labels };
  const draw = (animate) => {
    const w = Math.max(200, host.clientWidth);
    const h = height;
    const pad = { l: 34, r: 8, t: 10, b: 24 };
    const all = cur.series.flatMap((s) => s.values);
    const max = Math.max(1, ...all) * 1.15;
    const n = cur.labels.length;
    const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, n - 1);
    const Y = (v) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f * 0.87));
    const every = Math.ceil(n / Math.max(2, Math.floor(w / 70)));
    host.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" height="${h}" role="img" aria-label="${esc(cur.series.map((s) => s.name).join(', '))}">
      <defs>${cur.series.map((s, k) => `<linearGradient id="${id}g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--${s.tone})" stop-opacity=".32"/><stop offset="1" stop-color="var(--${s.tone})" stop-opacity="0"/></linearGradient>`).join('')}
      <clipPath id="${id}c"><rect class="wipe" x="0" y="0" width="${animate && !reduced() ? 0 : w}" height="${h}"/></clipPath></defs>
      ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${cur.labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${X(i)}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
      <g clip-path="url(#${id}c)">
        ${cur.series
          .map((s, k) => {
            const pts = s.values.map((v, i) => [X(i), Y(v)]);
            const line = smoothPath(pts);
            return `${area ? `<path d="${line}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#${id}g${k})"/>` : ''}<path d="${line}" fill="none" class="tone-stroke--${s.tone}" stroke-width="2.5" stroke-linecap="round"/>`;
          })
          .join('')}
      </g>
      <line class="xhair" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--text-3)" stroke-dasharray="3 3" opacity="0"/>
      ${cur.series.map((s, k) => `<circle class="dot dot${k} tone--${s.tone}" r="4.5" stroke="var(--glass-solid)" stroke-width="2" opacity="0"/>`).join('')}
    </svg>`;
    const svg = host.querySelector('svg');
    if (animate && !reduced()) gsap.to(svg.querySelector('.wipe'), { attr: { width: w }, duration: 1.2, ease: 'power3.inOut' });

    const at = (i) => {
      const xh = svg.querySelector('.xhair');
      xh.setAttribute('x1', X(i));
      xh.setAttribute('x2', X(i));
      xh.setAttribute('opacity', 1);
      cur.series.forEach((s, k) => {
        const d = svg.querySelector(`.dot${k}`);
        d.setAttribute('cx', X(i));
        d.setAttribute('cy', Y(s.values[i]));
        d.setAttribute('opacity', 1);
      });
      const r = svg.getBoundingClientRect();
      tip.show(`<b>${esc(cur.labels[i])}</b>${cur.series.map((s) => `${esc(s.name)}: ${fmt(s.values[i])}`).join('<br>')}`, r.left + (X(i) / w) * r.width, r.top + (Y(Math.max(...cur.series.map((s) => s.values[i]))) / h) * r.height);
    };
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * w;
      at(Math.max(0, Math.min(n - 1, Math.round(((x - pad.l) / (w - pad.l - pad.r)) * (n - 1)))));
    });
    svg.addEventListener('pointerleave', () => {
      tip.hide();
      svg.querySelectorAll('.xhair, .dot').forEach((el) => el.setAttribute('opacity', 0));
    });
  };
  draw(true);
  const ro = new ResizeObserver(() => draw(false));
  ro.observe(host);
  host.closest('.card')?.addEventListener('card:resize', () => draw(false));
  return {
    update(series, labels = cur.labels) {
      cur = { series, labels };
      draw(true);
    },
  };
}

/**
 * Bar chart in plain DOM. items: [{ label, value, highlight?, tone? }]
 */
export function barChart(host, { items, height = 160, fmt = (v) => v, tone = 'blue' }) {
  host.classList.add('bars');
  host.style.setProperty('--bars-h', `${height}px`);
  const render = (list, animate) => {
    const max = Math.max(1, ...list.map((i) => i.value));
    const exists = host.children.length === list.length;
    if (!exists) {
      host.innerHTML = list
        .map((it) => `<div class="bars__col ${it.highlight ? 'is-today' : ''}" title="${esc(it.label)}: ${esc(fmt(it.value))}">
          <span class="bars__val">${esc(fmt(it.value))}</span><span class="bars__track"><i class="bars__bar tone--${it.tone || tone}"></i></span><span class="bars__label">${esc(it.label)}</span></div>`)
        .join('');
    }
    [...host.children].forEach((col, i) => {
      const bar = col.querySelector('.bars__bar');
      col.querySelector('.bars__val').textContent = fmt(list[i].value);
      col.classList.toggle('is-today', !!list[i].highlight);
      const pct = (list[i].value / max) * 100;
      if (reduced()) bar.style.height = `${pct}%`;
      else gsap.to(bar, { height: `${pct}%`, duration: animate && !exists ? 0.9 : 0.6, ease: animate && !exists ? 'back.out(1.4)' : 'power3.inOut', delay: animate && !exists ? i * 0.04 : 0 });
    });
  };
  render(items, true);
  return { update: (list) => render(list, true) };
}

/**
 * Donut. segments: [{ label, value, tone }]
 */
export function donutChart(host, { segments, size = 160, stroke = 18, center = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const gap = segments.length > 1 ? 3 : 0;
  let acc = 0;
  host.innerHTML = `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" class="donut__svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/>
      ${segments
        .map((s, i) => {
          const len = Math.max(0, (s.value / total) * c - gap);
          const off = -acc;
          acc += (s.value / total) * c;
          return `<circle class="donut__seg tone-stroke--${s.tone}" data-i="${i}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="butt" stroke-dasharray="${len} ${c}" stroke-dashoffset="${off}" data-len="${len}"/>`;
        })
        .join('')}
    </svg><div class="donut__center">${center}</div></div>`;
  if (!reduced()) {
    host.querySelectorAll('.donut__seg').forEach((seg, i) => {
      const len = +seg.dataset.len;
      gsap.fromTo(seg, { attr: { 'stroke-dasharray': `0 ${c}` } }, { attr: { 'stroke-dasharray': `${len} ${c}` }, duration: 0.7, ease: 'power3.out', delay: 0.15 + i * 0.12 });
    });
  }
  return host.querySelector('.donut');
}

/**
 * Concentric progress rings. rings: [{ value 0..1, color css }]
 */
export function rings(host, { rings: list, size = 150, stroke = 14, gap = 4 }) {
  host.innerHTML = `<svg class="rings" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${list
    .map((ring, i) => {
      const r = size / 2 - stroke / 2 - i * (stroke + gap);
      const c = 2 * Math.PI * r;
      return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${ring.color}" stroke-opacity=".22" stroke-width="${stroke}"/>
        <circle class="rings__fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${ring.color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, ring.value))}" data-c="${c}" data-v="${Math.min(1, ring.value)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    })
    .join('')}</svg>`;
  if (!reduced()) {
    host.querySelectorAll('.rings__fg').forEach((el, i) => {
      const c = +el.dataset.c;
      gsap.fromTo(el, { attr: { 'stroke-dashoffset': c } }, { attr: { 'stroke-dashoffset': c * (1 - +el.dataset.v) }, duration: 1.4, ease: 'power3.out', delay: 0.2 + i * 0.12 });
    });
  }
}

/** Tiny sparkline string. */
export function spark(values, { w = 80, h = 24, tone = 'blue' } = {}) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i * w) / Math.max(1, values.length - 1), h - 2 - (v / max) * (h - 4)]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${smoothPath(pts)}" fill="none" class="tone-stroke--${tone}" stroke-width="2" stroke-linecap="round"/></svg>`;
}
