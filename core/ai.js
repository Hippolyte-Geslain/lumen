// AI providers + router. Every network call goes through guard.fetch; keys come from secrets and never leave core.
// Provider config (persisted at settings/ai): { providers: [{id, kind, baseUrl?, model?, local?, enabled?}], routes: { chat, fast } }.
// kinds: anthropic | openai (any OpenAI-compatible server: OpenAI, LM Studio, llama-server) | ollama | claude-code (local CLI login).
import { spawn as nodeSpawn } from 'node:child_process';

const err = (code, message) => Object.assign(new Error(message), { code });

export const DEFAULT_PROVIDERS = [
  { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', local: true },
  { id: 'lmstudio', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', local: true },
  { id: 'claude-code', kind: 'claude-code' },
];

const TIER_MODELS = {
  anthropic: { fast: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' },
  openai: { fast: 'gpt-4o-mini', default: 'gpt-4o', deep: 'gpt-4o' },
  ollama: { fast: 'llama3.2', default: 'llama3.2', deep: 'llama3.2' },
};

async function json(res, who) {
  if (res.status === 429) throw err('rate_limited', `${who} rate limit`);
  if (res.status === 401 || res.status === 403) throw err('provider_offline', `${who} rejected the key`);
  if (!res.ok) throw err('provider_error', `${who} answered ${res.status}`);
  return res.json();
}
const trim = (u) => String(u).replace(/\/+$/, '');
const post = (guard, url, headers, body) => guard.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// Adapters: chat({cfg, key, model, messages, guard}) -> text; models({cfg, key, guard}) -> string[].
const adapters = {
  anthropic: {
    needsKey: true,
    async chat({ cfg, key, model, messages, guard }) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') || undefined;
      const b = await json(await post(guard, `${trim(cfg.baseUrl)}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
        model, max_tokens: 1024, system, messages: messages.filter((m) => m.role !== 'system'),
      }), 'anthropic');
      return (b.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    },
    async models({ cfg, key, guard }) {
      const res = await guard.fetch(`${trim(cfg.baseUrl)}/v1/models`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      return ((await json(res, 'anthropic')).data || []).map((m) => m.id);
    },
  },
  openai: {
    needsKey: false, // local servers (LM Studio, llama-server) don't need one
    async chat({ cfg, key, model, messages, guard }) {
      const b = await json(await post(guard, `${trim(cfg.baseUrl)}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, { model, messages }), cfg.id);
      return b.choices?.[0]?.message?.content || '';
    },
    async models({ cfg, key, guard }) {
      const res = await guard.fetch(`${trim(cfg.baseUrl)}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
      return ((await json(res, cfg.id)).data || []).map((m) => m.id);
    },
  },
  ollama: {
    needsKey: false,
    async chat({ cfg, model, messages, guard }) {
      const b = await json(await post(guard, `${trim(cfg.baseUrl)}/api/chat`, {}, { model, messages, stream: false }), 'ollama');
      return b.message?.content || '';
    },
    async models({ cfg, guard }) {
      return ((await json(await guard.fetch(`${trim(cfg.baseUrl)}/api/tags`), 'ollama')).models || []).map((m) => m.name);
    },
  },
  'claude-code': {
    needsKey: false,
    // Drives the user's own signed-in Claude Code CLI; no credentials pass through Lumen. The CLI talks to the cloud, so air-gapped mode blocks it.
    async chat({ messages, model, guard, spawn = nodeSpawn }) {
      if (guard.getMode() === 'airgap') throw err('blocked_by_sovereignty_mode', 'Air-gapped mode blocks Claude Code');
      const prompt = messages.map((m) => (m.role === 'user' ? m.content : `${m.role}: ${m.content}`)).join('\n\n');
      return new Promise((resolve, reject) => {
        const args = ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])];
        const p = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
        let out = ''; let errOut = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (errOut += d));
        p.on('error', () => reject(err('provider_offline', 'Claude Code is not installed')));
        p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(err('provider_offline', /login|auth/i.test(errOut) ? 'Sign in to Claude Code first' : `Claude Code exited ${code}`))));
        p.stdin.end(prompt);
      });
    },
    async models() { return []; },
  },
};

export function createAI({ guard, secrets, store, spawn }) {
  const read = () => {
    const saved = store.get('settings/ai') || {};
    const byId = new Map((saved.providers || []).map((p) => [p.id, p]));
    const providers = DEFAULT_PROVIDERS.map((d) => ({ ...d, ...(byId.get(d.id) || {}) }));
    for (const p of saved.providers || []) if (!DEFAULT_PROVIDERS.some((d) => d.id === p.id) && adapters[p.kind]) providers.push(p);
    return { providers, routes: saved.routes || {} };
  };
  const keyOf = (cfg) => { const n = cfg.secret || cfg.id; return secrets.has(n) ? secrets.get(n) : null; };
  const find = (id) => { const cfg = read().providers.find((p) => p.id === id); if (!cfg) throw err('not_found', `Unknown provider ${id}`); return cfg; };
  const needsKey = (cfg) => adapters[cfg.kind].needsKey || (cfg.kind === 'openai' && !cfg.local);
  const usable = (cfg) => cfg.enabled !== false && (!needsKey(cfg) || keyOf(cfg));

  /** Candidate order for a role: the routed provider first, then the other usable ones with local servers ahead of cloud. */
  function order(role) {
    const { providers, routes } = read();
    const routed = routes[role] && providers.find((p) => p.id === routes[role]);
    const rest = providers.filter((p) => p !== routed && p.kind !== 'claude-code' && usable(p));
    const cloud = rest.filter((p) => !p.local); const local = rest.filter((p) => p.local);
    return [routed, ...cloud, ...local].filter((p) => p && p.enabled !== false);
  }

  async function chat(messages, { modelTier = 'default', role } = {}) {
    if (!Array.isArray(messages) || !messages.length) throw err('bad_request', 'Missing messages');
    const tier = TIER_MODELS.anthropic[modelTier] ? modelTier : 'default';
    let last; let blocked;
    for (const cfg of order(role || (tier === 'fast' ? 'fast' : 'chat'))) {
      if (needsKey(cfg) && !keyOf(cfg)) continue;
      try {
        const model = cfg.model || TIER_MODELS[cfg.kind]?.[tier];
        const text = await adapters[cfg.kind].chat({ cfg, key: keyOf(cfg), model, messages, guard, spawn });
        return { text, provider: cfg.id };
      } catch (e) {
        if (e.code === 'rate_limited') throw e;
        if (e.code === 'blocked_by_sovereignty_mode') blocked = e;
        else last = e;
      }
    }
    if (blocked && !last) throw err('provider_offline', 'No AI provider reachable in this sovereignty mode');
    throw err('provider_offline', last?.code === 'provider_error' || last?.code === 'provider_offline' ? last.message : 'No AI provider configured');
  }

  return {
    chat,
    sample: async (prompt, opts = {}) => {
      if (typeof prompt !== 'string' || !prompt) throw err('bad_request', 'Missing prompt');
      return chat([{ role: 'user', content: prompt }], { modelTier: opts.modelTier });
    },
    get: () => ({ ...read(), providers: read().providers.map((p) => ({ ...p, hasKey: !!(p.secret || p.id) && secrets.has(p.secret || p.id) })) }),
    set({ providers, routes } = {}) {
      const cur = read();
      const clean = (providers || cur.providers).filter((p) => p?.id && adapters[p.kind]).map(({ id, kind, baseUrl, model, local, enabled, secret }) => ({ id: String(id), kind, baseUrl, model, local, enabled, secret }));
      store.set('settings/ai', { providers: clean, routes: routes || cur.routes });
    },
    async models(id) { const cfg = find(id); return adapters[cfg.kind].models({ cfg, key: keyOf(cfg), guard }); },
    /** Connection test: lists models (or, for the CLI, runs a one-word prompt). */
    async test(id) {
      const cfg = find(id);
      if (cfg.kind === 'claude-code') { await adapters['claude-code'].chat({ messages: [{ role: 'user', content: 'Reply with ok' }], guard, spawn }); return { ok: true, models: [] }; }
      if (needsKey(cfg) && !keyOf(cfg)) throw err('provider_offline', 'No key saved');
      return { ok: true, models: await adapters[cfg.kind].models({ cfg, key: keyOf(cfg), guard }) };
    },
  };
}
