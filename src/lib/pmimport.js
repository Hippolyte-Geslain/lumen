// ClickUp list / Notion database -> { name, lists, cards }, the same shape the Trello import produces.
const DONE = /^(done|complete[d]?|closed|shipped|finished|termin[ée]s?)$/i;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
const PRIORITY = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };

/** Build lists from the statuses encountered, in first-seen order; a done-like status becomes the reserved 'done'. */
function buildLists(statusNames) {
  const keyOf = new Map(); const used = new Set(['done']); const lists = []; let doneName = '';
  for (const raw of statusNames) {
    const name = String(raw || 'To do').trim() || 'To do';
    if (keyOf.has(name)) continue;
    if (DONE.test(name) && !keyOf.has('__done')) { keyOf.set(name, 'done'); keyOf.set('__done', 1); doneName = name; continue; }
    let k = slug(name); while (used.has(k)) k += '-2';
    used.add(k); keyOf.set(name, k); lists.push([k, name]);
  }
  if (!lists.length) lists.push(['todo', 'To do']);
  lists.push(['done', doneName || 'Done']);
  return { lists, keyOf };
}

export function clickupToBoard(tasks, { name = 'ClickUp list', me = 'me', uid = (p) => p + Math.random().toString(36).slice(2, 9) } = {}) {
  const list = Array.isArray(tasks) ? tasks : tasks?.tasks;
  if (!Array.isArray(list)) throw new Error('Not a ClickUp task list');
  const { lists, keyOf } = buildLists(list.map((t) => t.status?.status));
  const now = Date.now();
  const cards = list.map((t, i) => {
    const status = keyOf.get(String(t.status?.status || 'To do').trim() || 'To do') || lists[0][0];
    return {
      id: uid('t'), title: String(t.name || 'Untitled').slice(0, 200), status, priority: PRIORITY[t.priority?.id] || 'medium', assignee: me,
      due: t.due_date ? Number(t.due_date) : now + 7 * 86_400_000, created: Number(t.date_created) || now, doneAt: status === 'done' ? Number(t.date_closed) || now : null,
      est: 1, order: i, labels: (t.tags || []).map((g) => ({ name: g.name, color: 'blue' })), subtasks: [], comments: [],
      notes: String(t.description || t.text_content || '').slice(0, 5000), source: { kind: 'clickup', url: t.url || '' },
    };
  });
  return { name, lists, cards };
}

const plain = (rt) => (rt || []).map((x) => x.plain_text || '').join('');

export function notionToBoard(result, { name = 'Notion database', me = 'me', uid = (p) => p + Math.random().toString(36).slice(2, 9) } = {}) {
  const pages = Array.isArray(result) ? result : result?.results;
  if (!Array.isArray(pages)) throw new Error('Not a Notion database result');
  const props = (p) => Object.entries(p.properties || {});
  const statusOf = (p) => { const e = props(p).find(([, v]) => v.type === 'status') || props(p).find(([k, v]) => v.type === 'select' && /status|state|stage/i.test(k)); return e?.[1][e[1].type]?.name; };
  const { lists, keyOf } = buildLists(pages.map(statusOf));
  const now = Date.now();
  const cards = pages.filter((p) => !p.archived).map((p, i) => {
    const title = plain(props(p).find(([, v]) => v.type === 'title')?.[1].title) || 'Untitled';
    const status = keyOf.get(String(statusOf(p) || 'To do').trim() || 'To do') || lists[0][0];
    const due = props(p).find(([, v]) => v.type === 'date' && v.date?.start)?.[1].date.start;
    const tags = props(p).filter(([, v]) => v.type === 'multi_select').flatMap(([, v]) => v.multi_select.map((o) => ({ name: o.name, color: 'blue' })));
    return {
      id: uid('t'), title: title.slice(0, 200), status, priority: 'medium', assignee: me, due: due ? Date.parse(due) : now + 7 * 86_400_000,
      created: Date.parse(p.created_time) || now, doneAt: status === 'done' ? Date.parse(p.last_edited_time) || now : null,
      est: 1, order: i, labels: tags, subtasks: [], comments: [], notes: '', source: { kind: 'notion', url: p.url || '' },
    };
  });
  return { name, lists, cards };
}
