// What Lumen owns itself (tasks, projects, focus log, activity, settings)
// lives in the Artifact database under the viewer's private subtree:
//   data/users/<id>/<topic>  →  { items: [...] }  (settings: { value: {...} })
// One document per topic keeps writes coarse and well under the 256 KiB cap.

import { state, commit, onCommit, DEFAULT_SETTINGS } from '../store.js';
import { use } from './runtime.js';

const TOPICS = { tasks: 'items', projects: 'items', focus: 'items', activity: 'items', settings: 'value' };
const CAPS = { focus: 600, activity: 60 };
const refs = {};
const lastJson = {};
const timers = {};
const writing = {};
const ready = {}; // a topic writes only after its first snapshot, so a blank start never overwrites saved data

function setStatus(patch) {
  state.live.workspace = { ...(state.live.workspace || {}), ...patch };
  commit('live');
}

const snapshot = (topic) => {
  if (topic === 'settings') return { value: state.settings };
  const items = state[topic].slice(topic === 'focus' ? -CAPS.focus : 0, topic === 'activity' ? CAPS.activity : undefined);
  return { items };
};

async function flush(topic) {
  if (writing[topic]) return (timers[topic] = setTimeout(() => flush(topic), 400));
  const body = snapshot(topic);
  const json = JSON.stringify(body);
  if (json === lastJson[topic]) return;
  writing[topic] = true;
  try {
    await refs[topic].set(body);
    lastJson[topic] = json;
  } catch (err) {
    if (err?.code === 'quota_exceeded') setStatus({ status: 'error', code: err.code, text: 'Your Lumen storage is full — delete old tasks or projects.' });
    else if (err?.code === 'invalid_argument') setStatus({ status: 'readonly', code: err.code, text: 'This view can’t save changes.' });
    else if (err?.code === 'unavailable') setTimeout(() => flush(topic), 1500 + Math.random() * 1000);
    else setStatus({ status: 'error', code: err?.code, text: 'Changes could not be saved.' });
  } finally {
    writing[topic] = false;
  }
}

export async function startWorkspace() {
  const [db, user] = await Promise.all([use('db'), use('user')]);
  if (!db || !user) return setStatus({ status: 'off', text: 'Sign in to claude.ai to keep your tasks and projects.' });
  const id = await user.id();
  if (!id) return setStatus({ status: 'off', text: 'Sign in to claude.ai to keep your tasks and projects.' });

  // Who is viewing: name and email from the claude.ai profile when available.
  try {
    const me = await user.me();
    const m = state.members[0];
    if (me?.name && !m.name) m.name = me.name;
    if (me?.email && !m.email) m.email = me.email.toLowerCase();
    if (me?.email && !m.emails.includes(me.email.toLowerCase())) m.emails.push(me.email.toLowerCase());
    commit('members');
  } catch {}

  setStatus({ status: 'loading' });
  const base = db.collection(`data/users/${id}`);
  let loaded = 0;
  for (const [topic, field] of Object.entries(TOPICS)) {
    refs[topic] = base.doc(topic);
    refs[topic].onSnapshot(
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const first = !ready[topic];
        ready[topic] = true;
        const body = snap.exists ? snap.data() : null;
        const json = body ? JSON.stringify(body) : null;
        if (json && json === lastJson[topic]) return;
        if (json) lastJson[topic] = json;
        // Snapshots are frozen; pages edit records in place, so keep deep copies.
        const data = body ? structuredClone(body) : null;
        if (topic === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(data?.value || {}) };
        else state[topic] = data?.[field] || [];
        commit(topic === 'settings' ? 'settings' : topic);
        if (first && ++loaded === Object.keys(TOPICS).length) setStatus({ status: 'ok', code: null, text: '' });
      },
      (err) => setStatus({ status: 'error', code: err?.code, text: err?.code === 'revoked' ? 'Access to your Lumen data changed.' : 'Live sync stopped — reload to reconnect.' }),
    );
  }

  // Persist on commit, debounced per document, one write in flight at a time.
  onCommit((topics) => {
    for (const t of topics) {
      if (!refs[t] || !ready[t]) continue;
      clearTimeout(timers[t]);
      timers[t] = setTimeout(() => flush(t), 600);
    }
  });
}
