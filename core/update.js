// Manual update check. The feed is a JSON document { version, url, notes? } at a URL the user configures;
// nothing is fetched unless they press the button, and the request goes through the sovereignty guard.
const err = (code, message) => Object.assign(new Error(message), { code });
const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export const isNewer = (a, b) => { const x = parse(a); const y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

export function createUpdater({ guard, store, version }) {
  return {
    get: () => ({ version, feed: store.get('settings/update')?.feed || '' }),
    setFeed(feed) {
      if (feed && !feed.startsWith('https://')) throw err('bad_request', 'The update feed must be an https:// URL');
      store.set('settings/update', { feed: feed || '' });
    },
    async check() {
      const feed = store.get('settings/update')?.feed;
      if (!feed) throw err('bad_request', 'Set an update feed URL first');
      const res = await guard.fetch(feed, { headers: { accept: 'application/json' } });
      if (!res.ok) throw err('provider_error', `Update feed answered ${res.status}`);
      const j = await res.json().catch(() => ({}));
      if (typeof j.version !== 'string') throw err('provider_error', 'The update feed has no version');
      return { current: version, latest: j.version, newer: isNewer(j.version, version), url: typeof j.url === 'string' && j.url.startsWith('https://') ? j.url : '', notes: String(j.notes || '').slice(0, 500) };
    },
  };
}
