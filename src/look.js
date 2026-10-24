// Appearance: theme, wallpaper, accent, glass tint, solid surfaces.
// index.html applies the saved look before first paint; this keeps it live.

const KEY = 'lumen:look';
const DEFAULTS = { theme: 'dark', wall: 'aurora', accent: 'blue', glass: 'tinted', solid: false };

export const WALLS = [
  ['ash', 'Ash'], ['sand', 'Sand'], ['sage', 'Sage'],
  ['aurora', 'Aurora'], ['smoke', 'Smoke'], ['tide', 'Tide'], ['bloom', 'Bloom'], ['ember', 'Ember'], ['grove', 'Grove'], ['dusk', 'Dusk'],
];
export const ACCENTS = [['blue', 'Blue'], ['purple', 'Purple'], ['pink', 'Pink'], ['orange', 'Orange'], ['green', 'Green'], ['graphite', 'Graphite']];

let look = { ...DEFAULTS };
try {
  look = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {}

const listeners = new Set();
const sysDark = matchMedia('(prefers-color-scheme: dark)');
export const resolvedTheme = () => (look.theme === 'system' ? (sysDark.matches ? 'dark' : 'light') : look.theme);
export const getLook = () => ({ ...look });
export const onLook = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function applyLook() {
  const d = document.documentElement;
  d.dataset.theme = resolvedTheme();
  d.dataset.wall = look.wall;
  d.dataset.accent = look.accent;
  d.dataset.glass = look.glass;
  d.classList.toggle('is-solid', !!look.solid);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme() === 'dark' ? '#0a0a0c' : '#e4e4ea');
}

export function setLook(patch) {
  look = { ...look, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {}
  applyLook();
  listeners.forEach((f) => f(look));
}

sysDark.addEventListener('change', () => look.theme === 'system' && setLook({}));

// One SVG whose gradient stops read CSS variables, so switching wallpaper or
// theme is a pure CSS change — no re-render.
export function wallpaperSvg(prefix = 'w', cls = '') {
  const stop = (v, o = 0) => `<stop offset="${o}" style="stop-color:var(--${v})"/>`;
  const grad = (id, a, b, x1, y1, x2, y2) =>
    `<linearGradient id="${prefix}${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stop(a)}${stop(b, 1)}</linearGradient>`;
  const bubbles = [
    [180, 760, 38], [330, 640, 18], [520, 820, 54], [760, 700, 22], [980, 860, 30], [1180, 640, 46],
    [1340, 780, 20], [1460, 560, 34], [1260, 220, 26], [880, 180, 16], [420, 260, 28], [120, 380, 14],
  ];
  return `<svg class="${cls}" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="${prefix}bg" x1="0" y1="0" x2="1" y2="1">${stop('wbg1')}${stop('wbg2', 1)}</linearGradient>
    ${grad('a', 'wa1', 'wa2', 0, 0, 1, 1)}${grad('b', 'wb1', 'wb2', 0, 1, 1, 0)}${grad('c', 'wc1', 'wc2', 1, 0, 0, 1)}${grad('d', 'wd1', 'wd2', 0, 0, 1, 0)}
    <radialGradient id="${prefix}bub" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#fff" stop-opacity="0"/><stop offset=".9" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></radialGradient>
    <filter id="${prefix}soft"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#${prefix}bg)"/>
  <g filter="url(#${prefix}soft)" opacity=".95">
    <path d="M-100 -60C240 40 360 300 220 520 120 680-60 640-140 560Z" fill="url(#${prefix}a)"/>
    <path d="M1040-80C1300-40 1700 60 1720 320 1600 420 1380 360 1260 260 1140 160 1020 40 1040-80Z" fill="url(#${prefix}d)"/>
  </g>
  <path d="M-80 640C260 520 520 560 820 660S1360 760 1700 560V1080H-80Z" fill="url(#${prefix}b)" opacity=".9"/>
  <path d="M-80 820C300 720 620 760 900 840S1400 920 1700 780V1080H-80Z" fill="url(#${prefix}c)"/>
  <g class="wall__lines" fill="none" stroke="#fff">
    <path d="M-80 640C260 520 520 560 820 660S1360 760 1700 560" stroke-width="28" stroke-opacity=".08"/>
    <path d="M-80 640C260 520 520 560 820 660S1360 760 1700 560" stroke-width="1.5" stroke-opacity=".45"/>
    <path d="M-80 820C300 720 620 760 900 840S1400 920 1700 780" stroke-width="1.2" stroke-opacity=".35"/>
    <path d="M-100 -60C240 40 360 300 220 520" stroke-width="1" stroke-opacity=".25"/>
  </g>
  <g class="wall__bubbles">
    ${bubbles
      .map(
        ([x, y, r]) =>
          `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${prefix}bub)" stroke="#fff" stroke-opacity=".35"/><ellipse cx="${x - r * 0.35}" cy="${y - r * 0.4}" rx="${r * 0.32}" ry="${r * 0.14}" transform="rotate(-35 ${x - r * 0.35} ${y - r * 0.4})" fill="#fff" opacity=".7"/>`,
      )
      .join('')}
  </g>
</svg>`;
}
