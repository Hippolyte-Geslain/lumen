// Focus session timer. Time is derived from timestamps, so it survives reloads.

import { gsap } from 'gsap';
import { state, commit, logActivity, task } from './store.js';
import { uid } from './lib/dom.js';

const KEY = 'lumen:focus';
let session = null;
try {
  session = JSON.parse(localStorage.getItem(KEY));
} catch {}

const listeners = new Map();
export function onFocus(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
const emit = (type) => listeners.get(type)?.forEach((f) => f(snapshot()));
const save = () => {
  try {
    session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY);
  } catch {}
};

const elapsed = () => (session ? (session.paused ?? Date.now()) - session.started - session.pausedFor : 0);
export function snapshot() {
  if (!session) return null;
  const total = session.minutes * 60000;
  const e = Math.min(total, elapsed());
  return { ...session, total, elapsed: e, remaining: total - e, progress: e / total, task: session.taskId ? task(session.taskId) : null };
}
export const isRunning = () => !!session;

export function start(minutes = state.settings.focusMinutes, taskId = null) {
  session = { minutes, taskId, started: Date.now(), pausedFor: 0, paused: null };
  save();
  emit('start');
}
export function pause() {
  if (!session || session.paused) return;
  session.paused = Date.now();
  save();
  emit('pause');
}
export function resume() {
  if (!session?.paused) return;
  session.pausedFor += Date.now() - session.paused;
  session.paused = null;
  save();
  emit('resume');
}
export function addMinutes(n = 5) {
  if (!session) return;
  session.minutes += n;
  save();
  emit('tick');
}

function log(minutes) {
  if (minutes < 1) return;
  state.focus.push({ id: uid('f'), at: Date.now(), minutes, who: state.me, taskId: session.taskId });
  logActivity('focus', `finished a ${minutes}-minute focus session`);
  commit('focus', 'activity');
}

export function stop() {
  if (!session) return;
  log(Math.floor(elapsed() / 60000));
  session = null;
  save();
  emit('stop');
}

let lastSecond = -1;
gsap.ticker.add(() => {
  if (!session || session.paused) return;
  const s = snapshot();
  const sec = Math.ceil(s.remaining / 1000);
  if (sec === lastSecond) return;
  lastSecond = sec;
  if (s.remaining <= 0) {
    log(session.minutes);
    session = null;
    save();
    emit('done');
    return;
  }
  emit('tick');
});

export const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
