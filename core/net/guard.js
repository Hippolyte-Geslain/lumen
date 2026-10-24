// Single egress point for the core. Every outbound request goes through guard.fetch.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MODES = new Set(['airgap', 'local', 'cloud']);
const LOG_MAX = 500;

export function createGuard({ mode = 'local', allow = [], log = () => {} } = {}) {
  const state = { mode, allow: new Set(allow) };
  const ring = [];
  const onChange = new Set();
  const notify = () => { for (const fn of onChange) fn({ mode: state.mode, allow: [...state.allow] }); };
  const permitted = (host) => {
    if (LOOPBACK.has(host)) return true;
    if (state.mode === 'cloud') return true;
    if (state.mode === 'local') return state.allow.has(host);
    return false;
  };
  return {
    getMode: () => state.mode,
    setMode(m) {
      if (!MODES.has(m)) throw Object.assign(new Error(`Unknown mode ${m}`), { code: 'bad_request' });
      state.mode = m; notify();
    },
    allowlist: () => [...state.allow],
    allowHost(h) { state.allow.add(String(h).toLowerCase()); notify(); },
    removeHost(h) { state.allow.delete(String(h).toLowerCase()); notify(); },
    onChange(fn) { onChange.add(fn); return () => onChange.delete(fn); },
    log: (n = 100) => ring.slice(-n),
    clearLog() { ring.length = 0; },
    async fetch(url, init) {
      const host = new URL(url).hostname.toLowerCase();
      const allowed = permitted(host);
      const entry = { ts: Date.now(), url: String(url), host, mode: state.mode, allowed };
      ring.push(entry); if (ring.length > LOG_MAX) ring.shift();
      log(entry);
      if (!allowed) {
        throw Object.assign(new Error(`Egress to ${host} blocked in ${state.mode} mode`), { code: 'blocked_by_sovereignty_mode' });
      }
      return fetch(url, init);
    },
  };
}
