// window.claude shim backed by the local lumen-core sidecar (WS JSON-RPC).
// Defined synchronously so runtime.js sees LIVE=true at load; every capability
// resolves lazily once the socket is open. Without a core config (plain
// `npm run dev`, claude.ai Artifact) this file does nothing.

function coreConfig() {
  const g = typeof window !== 'undefined' ? window.__LUMEN_CORE__ : null;
  if (g?.port && g?.token) return g;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('core_port') && q.get('core_token')) return { port: q.get('core_port'), token: q.get('core_token') };
    const s = JSON.parse(sessionStorage.getItem('lumen:core') || 'null');
    if (s?.port && s?.token) return s;
  } catch {}
  const e = import.meta.env || {};
  if (e.VITE_LUMEN_CORE_PORT && e.VITE_LUMEN_CORE_TOKEN) return { port: e.VITE_LUMEN_CORE_PORT, token: e.VITE_LUMEN_CORE_TOKEN };
  return null;
}

function connect(cfg) {
  let seq = 0;
  const pending = new Map();
  const subs = new Map();
  const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/?token=${encodeURIComponent(cfg.token)}`);
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(Object.assign(new Error('core unreachable'), { code: 'unavailable' }));
  });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.event === 'db') return subs.get(msg.sub)?.(msg.body);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.rej(Object.assign(new Error(msg.error.message), { code: msg.error.code, server: msg.error.server })) : p.res(msg.result);
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.rej(Object.assign(new Error('core closed'), { code: 'unavailable' }));
    pending.clear();
  };
  const rpc = async (method, params = {}) => {
    await ready;
    return new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { rpc, subs, nextSub: () => `s${++seq}` };
}

export function installLocalClaude() {
  if (typeof window === 'undefined' || window.claude) return false;
  const cfg = coreConfig();
  if (!cfg) return false;
  const core = connect(cfg);

  const db = {
    collection: (col) => ({
      doc: (id) => {
        const path = `${col}/${id}`;
        return {
          set: (body) => core.rpc('db.set', { path, body }),
          get: async () => {
            const body = await core.rpc('db.get', { path });
            return { exists: body != null, data: () => body, metadata: { hasPendingWrites: false } };
          },
          onSnapshot: (next, error) => {
            const sub = core.nextSub();
            core.subs.set(sub, (body) => next({ exists: body != null, data: () => body, metadata: { hasPendingWrites: false } }));
            core.rpc('db.subscribe', { path, sub }).catch((e) => error?.(e));
            return () => { core.subs.delete(sub); core.rpc('db.unsubscribe', { sub }).catch(() => {}); };
          },
        };
      },
    }),
  };

  const caps = {
    db,
    user: { id: () => core.rpc('user.id'), me: () => core.rpc('user.me') },
    mcp: {
      callTool: (server, tool, input) => core.rpc('mcp.callTool', { server, tool, input }),
      watchTool: (server, tool, input, handler, options) => {
        let on = true;
        const run = () => core.rpc('mcp.callTool', { server, tool, input })
          .then((payload) => on && handler({ type: 'data', result: { payload, cache: { storedAt: Date.now() } } }))
          .catch((error) => on && handler({ type: 'error', error }));
        run();
        const t = options?.refetchInterval ? setInterval(run, options.refetchInterval) : null;
        return () => { on = false; if (t) clearInterval(t); };
      },
      invalidate: () => {},
    },
    permissions: { request: async () => true },
    downloads: {
      save: async ({ filename, data }) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(data);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    },
    guard: {
      get: () => core.rpc('guard.get'),
      setMode: (mode) => core.rpc('guard.setMode', { mode }),
      allow: (host) => core.rpc('guard.allow', { host }),
      remove: (host) => core.rpc('guard.remove', { host }),
      log: (n) => core.rpc('guard.log', { n }),
      clearLog: () => core.rpc('guard.clearLog'),
    },
    secrets: {
      set: (name, value) => core.rpc('secrets.set', { name, value }),
      has: (name) => core.rpc('secrets.has', { name }),
      delete: (name) => core.rpc('secrets.delete', { name }),
    },
    attachments: {
      add: (cardId, name, mime, data) => core.rpc('attachments.add', { cardId, name, mime, data }),
      list: (cardId) => core.rpc('attachments.list', { cardId }),
      read: (id) => core.rpc('attachments.read', { id }),
      remove: (id) => core.rpc('attachments.remove', { id }),
      removeCard: (cardId) => core.rpc('attachments.removeCard', { cardId }),
    },
    notes: {
      get: () => core.rpc('notes.get'),
      setRoot: (dir) => core.rpc('notes.setRoot', { dir }),
      reindex: () => core.rpc('notes.reindex'),
      search: (query, limit) => core.rpc('notes.search', { query, limit }),
    },
    agents: {
      list: () => core.rpc('agents.list'),
      get: (id) => core.rpc('agents.get', { id }),
      start: (p) => core.rpc('agents.start', p),
      resume: (id, answer) => core.rpc('agents.resume', { id, answer }),
      stop: (id) => core.rpc('agents.stop', { id }),
      remove: (id) => core.rpc('agents.remove', { id }),
    },
    google: {
      status: () => core.rpc('google.status'),
      setClient: (clientId, clientSecret) => core.rpc('google.setClient', { clientId, clientSecret }),
      begin: () => core.rpc('google.begin'),
      disconnect: () => core.rpc('google.disconnect'),
    },
    ai: {
      get: () => core.rpc('ai.get'),
      usage: () => core.rpc('ai.usage'),
      set: (cfg) => core.rpc('ai.set', cfg),
      models: (id) => core.rpc('ai.models', { id }),
      test: (id) => core.rpc('ai.test', { id }),
      chat: (messages, opts = {}) => core.rpc('ai.chat', { messages, opts }),
    },
    sample: (prompt, opts = {}) => core.rpc('sample', { prompt, opts: { modelTier: opts.modelTier, cache: opts.cache } }),
  };

  window.claude = { use: async (name) => caps[name] ?? null, local: true };
  return true;
}

installLocalClaude();
