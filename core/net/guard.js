// Single egress point. Everything that leaves the machine goes through guard.fetch so sovereignty modes are enforceable.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function createGuard({ mode = 'local', allow = [], log = () => {} } = {}) {
  const state = { mode, allow: new Set(allow) };
  const permitted = (host) => {
    if (LOOPBACK.has(host)) return true;
    if (state.mode === 'cloud') return true;
    if (state.mode === 'local') return state.allow.has(host);
    return false;
  };
  return {
    setMode(m) { state.mode = m; },
    allowHost(h) { state.allow.add(h); },
    async fetch(url, init) {
      const host = new URL(url).hostname;
      const ok = permitted(host);
      log({ ts: Date.now(), url, host, mode: state.mode, allowed: ok });
      if (!ok) {
        const err = new Error(`Egress to ${host} blocked in ${state.mode} mode`);
        err.code = 'blocked_by_sovereignty_mode';
        throw err;
      }
      return fetch(url, init);
    },
  };
}
