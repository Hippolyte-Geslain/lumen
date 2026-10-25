// `sample`: one-shot completion against the first configured provider.
// Order: anthropic, openai, then a local ollama. All traffic goes through guard.fetch.
const TIERS = {
  anthropic: { fast: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' },
  openai: { fast: 'gpt-4o-mini', default: 'gpt-4o', deep: 'gpt-4o' },
  ollama: { fast: 'llama3.2', default: 'llama3.2', deep: 'llama3.2' },
};

const err = (code, message) => Object.assign(new Error(message), { code });

async function json(res, provider) {
  if (res.status === 429) throw err('rate_limited', `${provider} rate limit`);
  if (res.status === 401 || res.status === 403) throw err('provider_offline', `${provider} rejected the key`);
  if (!res.ok) throw err('provider_error', `${provider} answered ${res.status}`);
  return res.json();
}

const call = {
  async anthropic({ guard, key, model, prompt }) {
    const res = await guard.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    const b = await json(res, 'anthropic');
    return (b.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  },
  async openai({ guard, key, model, prompt }) {
    const res = await guard.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    return (await json(res, 'openai')).choices?.[0]?.message?.content || '';
  },
  async ollama({ guard, model, prompt }) {
    const res = await guard.fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    return (await json(res, 'ollama')).response || '';
  },
};

export function createSampler({ guard, secrets }) {
  return async function sample(prompt, opts = {}) {
    if (typeof prompt !== 'string' || !prompt) throw err('bad_request', 'Missing prompt');
    const tier = TIERS.anthropic[opts.modelTier] ? opts.modelTier : 'default';
    const order = ['anthropic', 'openai'].filter((p) => secrets.has(p)).concat('ollama');
    let last;
    for (const provider of order) {
      try {
        const key = provider === 'ollama' ? null : secrets.get(provider);
        const text = await call[provider]({ guard, key, model: TIERS[provider][tier], prompt });
        return { text, provider };
      } catch (e) {
        if (e.code === 'blocked_by_sovereignty_mode' || e.code === 'rate_limited') throw e;
        last = e;
      }
    }
    throw err('provider_offline', last?.code === 'provider_error' || last?.code === 'provider_offline' ? last.message : 'No AI provider configured');
  };
}
