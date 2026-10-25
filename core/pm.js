// Project-management connectors: ClickUp and Notion. Read tools run directly; write tools (create_*) are
// expected to be confirmed in the UI before the call (see the assistant's action tray).
const err = (code, message) => Object.assign(new Error(message), { code });
const ID = /^[\w-]+$/;
const id = (v, what) => { if (!ID.test(String(v ?? ''))) throw err('bad_request', `${what} is not a valid id`); return String(v); };
const str = (v, what, max = 2000) => { if (typeof v !== 'string' || !v.trim()) throw err('bad_request', `${what} is required`); return v.slice(0, max); };

function client({ guard, secrets, secret, label, base, headers }) {
  return async (path, init = {}) => {
    const key = secrets.has(secret) ? secrets.get(secret) : null;
    if (!key) throw err('not_connected', `Add a ${label} token in Settings`);
    const res = await guard.fetch(base + path, {
      ...init,
      headers: { ...headers(key), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (res.status === 401 || res.status === 403) throw err('not_connected', `${label} rejected the token`);
    if (res.status === 429) throw err('rate_limited', `${label} rate limit`);
    if (!res.ok) throw err('provider_error', `${label} answered ${res.status}`);
    return res.json();
  };
}

export function registerPm(register, { guard, secrets }) {
  const cu = client({ guard, secrets, secret: 'clickup', label: 'ClickUp', base: 'https://api.clickup.com/api/v2', headers: (k) => ({ authorization: k }) });
  register('clickup', {
    tools: {
      workspaces: () => cu('/team'),
      spaces: (i) => cu(`/team/${id(i.teamId, 'teamId')}/space`),
      lists: (i) => cu(`/space/${id(i.spaceId, 'spaceId')}/list`),
      tasks: (i) => cu(`/list/${id(i.listId, 'listId')}/task?include_closed=false`),
      create_task: (i) => cu(`/list/${id(i.listId, 'listId')}/task`, { method: 'POST', body: JSON.stringify({ name: str(i.name, 'name', 300), description: String(i.description ?? '').slice(0, 5000) }) }),
    },
  });

  const nt = client({ guard, secrets, secret: 'notion', label: 'Notion', base: 'https://api.notion.com/v1', headers: (k) => ({ authorization: `Bearer ${k}`, 'notion-version': '2022-06-28' }) });
  register('notion', {
    tools: {
      search: (i) => nt('/search', { method: 'POST', body: JSON.stringify({ query: String(i.query ?? '').slice(0, 200), page_size: 20 }) }),
      query_database: (i) => nt(`/databases/${id(i.databaseId, 'databaseId')}/query`, { method: 'POST', body: JSON.stringify({ page_size: 50 }) }),
      async create_page(i) {
        const db = id(i.databaseId, 'databaseId');
        const meta = await nt(`/databases/${db}`);
        const titleProp = Object.entries(meta.properties || {}).find(([, p]) => p.type === 'title')?.[0];
        if (!titleProp) throw err('bad_request', 'That database has no title property');
        return nt('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: db }, properties: { [titleProp]: { title: [{ text: { content: str(i.title, 'title', 300) } }] } } }) });
      },
    },
  });
}
