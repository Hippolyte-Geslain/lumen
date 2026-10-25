// Trello board export (Menu > Print and export > JSON) -> { name, lists, cards }.
// lists: [[key, name]] with a Done-like list mapped to the reserved 'done'; cards carry status, labels, checklist subtasks and comments.
const DONE = /^(done|complete[d]?|shipped|finished|closed|termin[ée]s?)$/i;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

export function parseTrello(json, { me = 'me', uid = (p) => p + Math.random().toString(36).slice(2, 9) } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.lists) || !Array.isArray(data.cards)) throw new Error('Not a Trello board export');
  const open = data.lists.filter((l) => !l.closed).sort((a, b) => a.pos - b.pos);
  const keyOf = new Map();
  const used = new Set(['done']);
  const lists = [];
  let doneName = '';
  for (const l of open) {
    if (DONE.test(l.name.trim()) && !keyOf.has('done')) { keyOf.set(l.id, 'done'); doneName = l.name.trim(); continue; }
    let k = slug(l.name);
    while (used.has(k)) k += '-2';
    used.add(k);
    keyOf.set(l.id, k);
    lists.push([k, l.name.trim()]);
  }
  if (!lists.length) lists.push(['todo', 'To do']);
  lists.push(['done', doneName || 'Done']);

  const checks = new Map();
  for (const c of data.checklists || []) checks.set(c.idCard, [...(checks.get(c.idCard) || []), ...(c.checkItems || []).sort((a, b) => a.pos - b.pos)]);
  const notes = new Map();
  for (const a of data.actions || []) if (a.type === 'commentCard' && a.data?.card?.id) notes.set(a.data.card.id, [...(notes.get(a.data.card.id) || []), a]);

  const now = Date.now();
  const cards = data.cards
    .filter((c) => !c.closed && keyOf.has(c.idList))
    .sort((a, b) => a.pos - b.pos)
    .map((c, i) => {
      const status = keyOf.get(c.idList);
      const act = Date.parse(c.dateLastActivity) || now;
      return {
        id: uid('t'), title: String(c.name).slice(0, 200), status, priority: 'medium', assignee: me,
        due: c.due ? Date.parse(c.due) : now + 7 * 86_400_000, created: act, doneAt: status === 'done' || c.dueComplete ? act : null, est: 1,
        order: i, labels: (c.labels || []).map((l) => ({ name: l.name || l.color, color: l.color })).filter((l) => l.name),
        subtasks: (checks.get(c.id) || []).map((it) => ({ id: uid('s'), title: it.name, done: it.state === 'complete' })),
        comments: (notes.get(c.id) || []).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map((a) => ({ id: uid('c'), who: me, at: Date.parse(a.date) || now, text: a.data.text })),
        notes: c.desc || '', source: { kind: 'trello', url: c.shortUrl || c.url || '' },
      };
    });
  return { name: data.name || 'Trello board', lists, cards };
}
