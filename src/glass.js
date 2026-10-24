// Liquid glass: each `.glass` element gets its own SVG filter whose
// displacement map is a signed-distance field of the element's rounded
// rectangle. Pixels near the rim are pushed outward (refraction), the whole
// surface gets a slight lens magnification, then the result is frosted and
// saturated. Applied through `backdrop-filter: url(#id)` (Chromium only);
// every other engine keeps the plain CSS blur from styles.

import { gsap } from 'gsap';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 28; // filter region overflow, so refracted edges have pixels to pull from

const PRESETS = {
  chrome: { frost: 3.2, band: 30, mag: 0.035, sat: 1.6, aberrate: true, strength: 1 },
  card: { frost: 5.5, band: 26, mag: 0.012, sat: 1.7, aberrate: false, strength: 0.9 },
  thick: { frost: 14, band: 20, mag: 0.01, sat: 1.5, aberrate: false, strength: 0.7 },
  small: { frost: 4.5, band: 18, mag: 0.03, sat: 1.7, aberrate: false, strength: 0.9 },
};

export const supportsLiquid = (() => {
  // Only Blink renders SVG filters inside backdrop-filter.
  return (
    'userAgentData' in navigator &&
    CSS.supports('backdrop-filter', 'blur(1px)') &&
    !matchMedia('(prefers-reduced-transparency: reduce)').matches
  );
})();

function presetFor(el) {
  if (el.classList.contains('glass--chrome')) return 'chrome';
  if (el.classList.contains('glass--thick')) return 'thick';
  if (el.classList.contains('stat') || el.offsetHeight < 90) return 'small';
  return 'card';
}

let defs = null;
function filterDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.append(defs);
  document.body.prepend(svg);
  return defs;
}

// Displacement map: R = x offset, G = y offset, 128 = no movement.
function renderMap(w, h, radius, preset, scale) {
  const fullW = w + PAD * 2;
  const fullH = h + PAD * 2;
  // Keep the canvas under ~300k pixels; feImage stretches it back up.
  const k = Math.min(1, Math.sqrt(300_000 / (fullW * fullH)));
  const cw = Math.max(8, Math.round(fullW * k));
  const ch = Math.max(8, Math.round(fullH * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const px = img.data;

  const band = Math.min(preset.band, w / 2, h / 2);
  const halfW = w / 2 - radius;
  const halfH = h / 2 - radius;
  const short = Math.max(1, Math.min(w, h) / 2);
  const lens = preset.mag * Math.min(w, h);

  for (let j = 0; j < ch; j++) {
    const y = (j + 0.5) / k - PAD - h / 2;
    for (let i = 0; i < cw; i++) {
      const x = (i + 0.5) / k - PAD - w / 2;
      const o = (j * cw + i) * 4;
      px[o + 2] = 128;
      px[o + 3] = 255;

      // Rounded-rect SDF plus its outward normal.
      const qx = Math.abs(x) - halfW;
      const qy = Math.abs(y) - halfH;
      let dist, nx, ny;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        dist = len - radius;
        nx = (qx / len) * Math.sign(x);
        ny = (qy / len) * Math.sign(y);
      } else if (qx > qy) {
        dist = qx - radius;
        nx = Math.sign(x);
        ny = 0;
      } else {
        dist = qy - radius;
        nx = 0;
        ny = Math.sign(y);
      }

      if (dist >= 0) {
        px[o] = 128;
        px[o + 1] = 128;
        continue;
      }

      // Magnify toward the centre, refract outward inside the rim band.
      let dx = (-x / short) * lens;
      let dy = (-y / short) * lens;
      const depth = -dist;
      if (depth < band) {
        const bend = (1 - depth / band) ** 2.2 * Math.min(depth / 1.2, 1) * preset.strength * scale * 0.5;
        dx += nx * bend;
        dy += ny * bend;
      }
      px[o] = clampByte(128 + (dx / scale) * 254);
      px[o + 1] = clampByte(128 + (dy / scale) * 254);
    }
  }

  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL()), 'image/png'),
  );
}

const clampByte = (v) => Math.max(0, Math.min(255, v));

// One isolated-channel color matrix: keeps only R, G or B (plus alpha).
const channelMatrix = (c) =>
  [0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((col) => +(row === c && col === c)).join(' ')).join('  ') + '  0 0 0 1 0';

const cache = new Map();
let nextId = 0;

function filterFor(kind, w, h, radius) {
  const key = `${kind}:${w}x${h}r${radius}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const preset = PRESETS[kind];
  const id = `lg${++nextId}`;
  const scale = Math.round(Math.min(Math.max(Math.min(w, h) * 0.55, 26), kind === 'chrome' ? 64 : 52));
  const fw = w + PAD * 2;
  const fh = h + PAD * 2;

  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', -PAD);
  filter.setAttribute('y', -PAD);
  filter.setAttribute('width', fw);
  filter.setAttribute('height', fh);

  const displace = (s, out) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${out}"/>`;

  // Chrome glass splits RGB with slightly different scales: chromatic aberration.
  const bend = preset.aberrate
    ? [0.94, 1, 1.08]
        .map((m, c) => displace(scale * m, `d${c}`) + `<feColorMatrix in="d${c}" type="matrix" values="${channelMatrix(c)}" result="c${c}"/>`)
        .join('') +
      '<feBlend in="c0" in2="c1" mode="screen" result="c01"/><feBlend in="c01" in2="c2" mode="screen" result="bent"/>'
    : displace(scale, 'bent');

  filter.innerHTML =
    `<feImage result="map" preserveAspectRatio="none" x="${-PAD}" y="${-PAD}" width="${fw}" height="${fh}"/>` +
    bend +
    `<feGaussianBlur in="bent" stdDeviation="${preset.frost}" result="frost"/>` +
    `<feColorMatrix in="frost" type="saturate" values="${preset.sat}"/>`;
  filterDefs().append(filter);

  const image = filter.querySelector('feImage');
  const entry = { id, ready: renderMap(w, h, radius, preset, scale).then((href) => image.setAttribute('href', href)) };
  cache.set(key, entry);
  return entry;
}

// Measuring is batched onto the GSAP ticker so a burst of resizes (a page
// transition, a drag) costs one layout read per frame.
const dirty = new Set();
const observer = new ResizeObserver((entries) => entries.forEach((e) => dirty.add(e.target)));
let lite = false; // slow device: only chrome keeps refraction
const solid = () => document.documentElement.classList.contains('is-solid');

function apply(el) {
  if (!el.isConnected) {
    observer.unobserve(el);
    return;
  }
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (w < 12 || h < 12) return;
  const kind = presetFor(el);
  if (solid() || (lite && kind !== 'chrome')) {
    if (el.__lg) {
      el.style.removeProperty('backdrop-filter');
      el.__lg = undefined;
    }
    return;
  }
  const radius = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2));
  const f = filterFor(kind, w, h, radius);
  if (el.__lg === f.id) return;
  el.__lg = f.id;
  f.ready.then(() => {
    if (el.__lg === f.id && el.isConnected) el.style.setProperty('backdrop-filter', `url(#${f.id})`);
  });
}

// Watchdog: if the 75th-percentile frame is slower than ~38fps after a few
// seconds, drop refraction on everything but the chrome.
const samples = [];
let last = 0;
function watch(time) {
  const dt = (time - last) * 1000;
  last = time;
  if (document.hidden || dt > 250 || !dt) return;
  samples.push(dt);
  if (samples.length < 240) return;
  gsap.ticker.remove(watch);
  samples.sort((a, b) => a - b);
  if (samples[Math.floor(samples.length * 0.75)] > 26) {
    document.documentElement.classList.add('lg-lite');
    setGlassLite(true);
  }
}

gsap.ticker.add(() => {
  if (!dirty.size) return;
  // Cap per frame so a page full of cards never stalls one frame.
  let n = 0;
  for (const el of dirty) {
    dirty.delete(el);
    apply(el);
    if (++n >= 3) break;
  }
});

let started = false;
export function glassify(root = document) {
  if (!supportsLiquid) return;
  if (!started) {
    started = true;
    gsap.ticker.add(watch);
    // New cards arrive through innerHTML renders; pick them up automatically.
    new MutationObserver((muts) => {
      if (muts.some((m) => m.addedNodes.length)) glassify(document);
    }).observe(document.body, { childList: true, subtree: true });
  }
  root.querySelectorAll('.glass, .stat').forEach((el) => {
    if (el.__lgObserved || el.dataset.lg === 'off') return;
    el.__lgObserved = true;
    observer.observe(el);
    dirty.add(el);
  });
}

export function setGlassLite(on) {
  lite = on;
  refreshGlass();
}

export function refreshGlass() {
  document.querySelectorAll('.glass, .stat').forEach((el) => el.__lgObserved && dirty.add(el));
}

// Specular glint that follows the pointer across glass surfaces.
export function trackGlint() {
  document.addEventListener(
    'pointermove',
    (e) => {
      const el = e.target.closest?.('.glass');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
    },
    { passive: true },
  );
}
