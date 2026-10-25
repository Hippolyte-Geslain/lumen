// Applies automation rules: card events come from diffing the board on every change, daily rules from a minute tick.
// Rules never trigger rules: while a rule's actions apply, the resulting changes are folded into the snapshot silently.
import { state, STATUSES, subscribe, cardTasks, commit } from '../store.js';
import { applyAction } from '../ui/chat.js';
import { notify } from '../ui/island.js';
import { cleanRules, eventsFromDiff, plan, dailyDue } from '../lib/automations.js';

const keys = () => STATUSES.map(([k]) => k);
export const rules = () => cleanRules(state.settings.automations, keys());

let snap = null;
let busy = false;
const snapshot = () => new Map(cardTasks().map((t) => [t.id, t.status]));

function run(items) {
  busy = true;
  try {
    for (const { a } of items) {
      try {
        if (a.type === 'notify') notify(a.text, { ico: 'bolt' });
        else applyAction(a);
      } catch { /* the card was deleted meanwhile */ }
    }
  } finally { busy = false; snap = snapshot(); }
}

export function startAutomations() {
  snap = snapshot();
  subscribe('tasks', () => {
    if (busy || !snap) return;
    const events = eventsFromDiff(snap, cardTasks());
    snap = snapshot();
    const rs = rules();
    if (rs.length && events.length) run(events.flatMap((e) => plan(rs, e)));
  });
  const tick = () => {
    const now = Date.now(); const last = state.settings.autoRuns || (state.settings.autoRuns = {});
    const due = rules().filter((r) => dailyDue(r, now, last[r.id] || 0));
    if (!due.length) return;
    for (const r of due) last[r.id] = now;
    commit('settings');
    run(due.flatMap((r) => plan([r], { type: 'daily' })));
  };
  setInterval(tick, 60_000);
  setTimeout(tick, 3000);
}
