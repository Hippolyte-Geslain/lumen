// Automations: small "when X happens, do Y" rules over the board. Pure planning logic; the runtime applies the result.
// A rule: { id, name, on, trigger: { type, to?, at? }, action: { type, ...fields } }
// Triggers: card_created | card_moved (optional `to` list key) | daily (`at` "HH:MM").
// Actions reuse the assistant's vocabulary (move_task, complete_task, set_priority, create_task) plus `notify`.
// Card-bound actions act on the card that fired the trigger; text fields accept {{title}}.

export const TRIGGERS = { card_created: 'A card is added', card_moved: 'A card moves to a list', daily: 'Every day at a time' };
export const RULE_ACTIONS = { move_task: 'Move the card to…', complete_task: 'Mark the card done', set_priority: 'Set the card priority…', create_task: 'Add a card…', notify: 'Notify me…' };

const PRI = ['low', 'medium', 'high', 'urgent'];
const fill = (s, t) => String(s ?? '').replace(/\{\{\s*title\s*\}\}/g, t?.title ?? '').slice(0, 200);

/** Keep only well-formed rules (the settings blob may come from an older build or a hand edit). */
export function cleanRules(raw, statuses = []) {
  const keys = new Set(statuses);
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const t = r?.trigger; const a = r?.action;
    if (!r || typeof r.id !== 'string' || !TRIGGERS[t?.type] || !RULE_ACTIONS[a?.type]) continue;
    if (t.type === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.at || '')) continue;
    if (t.type === 'card_moved' && t.to && !keys.has(t.to)) continue;
    if (a.type === 'move_task' && !keys.has(a.status)) continue;
    if (a.type === 'set_priority' && !PRI.includes(a.priority)) continue;
    if ((a.type === 'create_task' || a.type === 'notify') && !String(a.title ?? a.text ?? '').trim()) continue;
    if (t.type === 'daily' && ['move_task', 'complete_task', 'set_priority'].includes(a.type)) continue; // no card to act on
    out.push({ id: r.id, name: String(r.name || '').slice(0, 60), on: r.on !== false, trigger: { ...t }, action: { ...a } });
  }
  return out;
}

/** Diff two {id → status} snapshots into card events. */
export function eventsFromDiff(prev, tasks) {
  const ev = [];
  for (const t of tasks) {
    if (!prev.has(t.id)) ev.push({ type: 'card_created', task: t });
    else if (prev.get(t.id) !== t.status) ev.push({ type: 'card_moved', task: t, from: prev.get(t.id), to: t.status });
  }
  return ev;
}

/** Concrete actions to apply for one event. */
export function plan(rules, ev) {
  const out = [];
  for (const r of rules) {
    if (!r.on || r.trigger.type !== ev.type) continue;
    if (ev.type === 'card_moved' && r.trigger.to && r.trigger.to !== ev.to) continue;
    const a = r.action; const t = ev.task;
    const label = r.name || TRIGGERS[r.trigger.type];
    if (a.type === 'notify') out.push({ rule: r.id, a: { type: 'notify', text: fill(a.text ?? a.title, t) } });
    else if (a.type === 'create_task') out.push({ rule: r.id, a: { type: 'create_task', title: fill(a.title, t), ...(a.status ? { status: a.status } : {}) } });
    else if (t) {
      if (a.type === 'move_task' && t.status === a.status) continue;
      if (a.type === 'complete_task' && t.status === 'done') continue;
      if (a.type === 'set_priority' && t.priority === a.priority) continue;
      out.push({ rule: r.id, label, a: { ...a, id: t.id } });
    }
  }
  return out;
}

/** True when a daily rule should fire: its time has passed today and it has not run today. */
export function dailyDue(rule, now, lastRun) {
  if (!rule.on || rule.trigger.type !== 'daily') return false;
  const [h, m] = rule.trigger.at.split(':').map(Number);
  const d = new Date(now); d.setHours(h, m, 0, 0);
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  return now >= d.getTime() && !(lastRun >= startOfDay.getTime());
}

export const describeRule = (r, statusLabel = (k) => k) => {
  const t = r.trigger; const a = r.action;
  const when = t.type === 'daily' ? `Every day at ${t.at}` : t.type === 'card_created' ? 'When a card is added' : t.to ? `When a card moves to ${statusLabel(t.to)}` : 'When a card moves';
  const then = { move_task: `move it to ${statusLabel(a.status)}`, complete_task: 'mark it done', set_priority: `set priority ${a.priority}`, create_task: `add “${a.title}”`, notify: `notify “${a.text ?? a.title}”` }[a.type];
  return `${when}, ${then}`;
};
