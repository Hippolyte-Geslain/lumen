// Assistant actions: the model proposes changes as JSON, the user confirms each one, then they are applied.
// Provider-agnostic on purpose (works with models that have no native tool calling): the reply may end with
//   ```actions
//   [{"type":"create_task","title":"..."}]
//   ```
// Everything is validated here; unknown or malformed proposals are dropped, never applied.

export const ACTION_TYPES = {
  create_task: ['title'],
  move_task: ['id', 'status'],
  complete_task: ['id'],
  set_priority: ['id', 'priority'],
};

export const ACTION_HELP = `To change the board, end your reply with ONE fenced block named actions holding a JSON array. Allowed actions:
- {"type":"create_task","title":string,"status"?:list key,"priority"?:"low"|"medium"|"high"|"urgent","due"?:"YYYY-MM-DD"}
- {"type":"move_task","id":task id,"status":list key}
- {"type":"complete_task","id":task id}
- {"type":"set_priority","id":task id,"priority":"low"|"medium"|"high"|"urgent"}
Only propose actions the user asked for. Use ids exactly as given in the context.`;

const FENCE = /```actions\s*\n([\s\S]*?)```/;

/** Split a reply into the visible text and the validated actions. */
export function parseActions(reply, { statuses = [], taskIds = new Set(), priorities = ['low', 'medium', 'high', 'urgent'] } = {}) {
  const m = FENCE.exec(reply || '');
  const text = (reply || '').replace(FENCE, '').trim();
  if (!m) return { text, actions: [] };
  let raw;
  try { raw = JSON.parse(m[1]); } catch { return { text, actions: [] }; }
  const keys = new Set(statuses);
  const ok = (a) => {
    if (!a || typeof a !== 'object' || !ACTION_TYPES[a.type]) return false;
    if (!ACTION_TYPES[a.type].every((k) => typeof a[k] === 'string' && a[k].trim())) return false;
    if (a.id && !taskIds.has(a.id)) return false;
    if (a.status && !keys.has(a.status)) return false;
    if (a.priority && !priorities.includes(a.priority)) return false;
    if (a.due && !/^\d{4}-\d{2}-\d{2}$/.test(a.due)) return false;
    return true;
  };
  return { text, actions: (Array.isArray(raw) ? raw : []).filter(ok).slice(0, 10) };
}

/** One-line description shown in the confirmation tray. */
export function describeAction(a, { title = () => '' } = {}) {
  switch (a.type) {
    case 'create_task': return `Create “${a.title}”${a.status ? ` in ${a.status}` : ''}${a.due ? `, due ${a.due}` : ''}`;
    case 'move_task': return `Move “${title(a.id)}” to ${a.status}`;
    case 'complete_task': return `Complete “${title(a.id)}”`;
    case 'set_priority': return `Set “${title(a.id)}” to ${a.priority}`;
    default: return a.type;
  }
}
