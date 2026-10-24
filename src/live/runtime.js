// Bridge to the claude.ai Artifact runtime. Inside a published Artifact,
// `window.claude.use(name)` resolves capability namespaces (or null); in a
// plain browser (`npm run dev`) there is no `window.claude` and Lumen runs on
// its demo seed.

export const LIVE = typeof window !== 'undefined' && typeof window.claude?.use === 'function';

const caps = {};
const pending = {};

/** Resolve a capability once; null when this view can't run it. */
export function use(name) {
  if (!LIVE) return Promise.resolve(null);
  if (name in caps) return Promise.resolve(caps[name]);
  pending[name] ??= window.claude
    .use(name)
    .catch(() => null)
    .then((ns) => (caps[name] = ns));
  return pending[name];
}

// Connector display names, exactly as declared in the publish manifest.
export const SERVERS = {
  calendar: 'Google Calendar',
  gmail: 'Gmail',
  drive: 'Google Drive',
  docs: 'Claude Docs',
};

/** One action call. Resolves the payload; rejects with the McpError. */
export async function call(server, tool, input = {}, options) {
  const mcp = await use('mcp');
  if (!mcp) throw { code: 'not_granted', message: 'Connectors are not available in this view.' };
  const res = await mcp.callTool(server, tool, input, options);
  return res.payload ?? res;
}

/** Keep a read current. handler({payload, storedAt}) / onError(err). Returns unsubscribe. */
export function watch(server, tool, input, handler, onError, { every } = {}) {
  let off = () => {};
  let stopped = false;
  use('mcp').then((mcp) => {
    if (stopped) return;
    if (!mcp) return onError?.({ code: 'not_granted', message: 'Connectors are not available in this view.' });
    off = mcp.watchTool(
      server,
      tool,
      input,
      (ev) => {
        if (ev.type === 'data') handler({ payload: ev.result.payload ?? ev.result, storedAt: ev.result.cache?.storedAt ?? Date.now() });
        else onError?.(ev.error);
      },
      { cache: { staleTime: 60_000 }, ...(every ? { refetchInterval: every } : {}) },
    );
  });
  return () => {
    stopped = true;
    off();
  };
}

export async function invalidate(server, tool) {
  const mcp = await use('mcp');
  try {
    await mcp?.invalidate(server, tool);
  } catch {}
}

// Each failure code has its own fix; this is the copy a section shows.
export function explain(err, server) {
  const name = err?.server || server || 'this connector';
  switch (err?.code) {
    case 'needs_reauth':
      return { tone: 'warn', text: `Reconnect ${name} in claude.ai Settings → Connectors.`, fix: 'reconnect' };
    case 'server_not_connected':
    case 'server_not_found':
      return { tone: 'warn', text: `Add ${name} in claude.ai Settings → Connectors.`, fix: 'add' };
    case 'selection_required':
      return { tone: 'warn', text: `Choose which ${name} account to use when claude.ai asks.`, fix: 'choose' };
    case 'not_in_manifest':
    case 'approval_required':
    case 'consent_required':
      return { tone: 'info', text: `${name} isn't allowed for this page yet.`, fix: 'allow' };
    case 'blocked_by_policy':
      return { tone: 'warn', text: `Your organization blocks this ${name} action.`, fix: null };
    case 'server_unavailable':
    case 'rate_limited':
      return { tone: 'info', text: `${name} is not answering right now — retrying shortly.`, fix: 'wait' };
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return { tone: 'info', text: 'Open Lumen from claude.ai to use your connectors.', fix: null };
    case 'tool_error':
      return { tone: 'warn', text: `${name}: ${String(err.message || 'the request failed').slice(0, 160)}`, fix: null };
    default:
      return { tone: 'warn', text: `${name} had a problem. Try again in a moment.`, fix: 'wait' };
  }
}

/** Open the artifact's Permissions panel (a button, never on load). */
export async function managePermissions() {
  const p = await use('permissions');
  if (!p) return false;
  try {
    await p.manage();
    return true;
  } catch {
    return false;
  }
}

export async function allow(server) {
  const p = await use('permissions');
  if (!p) return null;
  try {
    return await p.request([`mcp:${server}`]);
  } catch {
    return null;
  }
}

// ---------- time helpers for Google tools (local time, no offset, no Z) ----------
const pad = (n) => String(n).padStart(2, '0');
export const localIso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export const decodeEntities = (s = '') =>
  String(s)
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
