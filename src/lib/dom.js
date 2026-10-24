export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let uidN = 0;
export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}${(++uidN).toString(36)}`;

// 24-unit stroke icons.
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  tasks: 'M4 4h16v16H4zM8 12l3 3 5-6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  video: 'M15 10l5-3v10l-5-3M3 6h12v12H3z',
  pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  stop: 'M6 6h12v12H6z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  message: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5zM9 10H5l-2 3h5M14 15v4l-3 2v-5',
  phone: 'M7 2h10v20H7zM11 18h2',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 21zM7.5 11h.01M10.5 7h.01M15.5 8h.01',
  sprout: 'M7 20h10M12 20v-8M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5',
  megaphone: 'M3 11v3l11 5V6L3 11zM14 8a4 4 0 0 1 0 8M6 15l1 5h3l-1-4',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1a3 3 0 0 1 0 6h-1M8 2v3M12 2v3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  drag: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  comment: 'M4 4h16v12H8l-4 4z',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  minus: 'M5 12h14',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M10 2h4',
  drop: 'M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  brand: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12h16M12 4v16',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  pr: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v12M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 15V8a2 2 0 0 0-2-2h-5M14 3l-3 3 3 3',
  commit: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6',
  issue: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
};

export const ICONS = Object.keys(PATHS);
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name] || PATHS.sparkle}"/></svg>`;
}

// ---------- formatting ----------
const DAY = 86_400_000;
export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtHours = (min) => (min >= 60 ? `${+(min / 60).toFixed(1)}h` : `${Math.round(min)}m`);
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtTimeRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
export const weekday = (d, style = 'short') => new Date(d).toLocaleDateString('en-US', { weekday: style });

export function relTime(t) {
  const diff = (t - Date.now()) / 60000;
  const abs = Math.abs(diff);
  if (abs < 1) return 'just now';
  if (abs < 60) return diff < 0 ? `${Math.round(abs)} min ago` : `in ${Math.round(abs)} min`;
  if (abs < 1440) return diff < 0 ? `${Math.round(abs / 60)} h ago` : `in ${Math.round(abs / 60)} h`;
  if (abs < 1440 * 7) return diff < 0 ? `${Math.round(abs / 1440)} d ago` : `in ${Math.round(abs / 1440)} d`;
  return fmtDate(t);
}

export function dayLabel(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function dueLabel(d) {
  const n = daysBetween(new Date(), d);
  if (n < -1) return `${-n} days late`;
  if (n === -1) return 'Yesterday';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 7) return weekday(d, 'long');
  return fmtDate(d);
}

export const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Offer a generated file. Inside a claude.ai Artifact page-started downloads
 * are blocked, so the `downloads` capability asks the viewer instead.
 * Resolves true when saved (or handed to the browser), false otherwise.
 */
export async function download(name, text, mime = 'text/csv') {
  if (typeof window.claude?.use === 'function') {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (!dl) return false;
    try {
      await dl.save({ filename: name, data: new Blob([text], { type: mime }) });
      return true;
    } catch {
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Open another website in a new tab through a real link (window.open is unreliable in Artifacts). */
export function openExternal(url) {
  if (!/^https:\/\//.test(url || '')) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.append(a);
  a.click();
  a.remove();
}

export const toCsv = (rows) =>
  rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');

export function highlight(text, q) {
  const t = esc(text);
  if (!q) return t;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t;
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}
