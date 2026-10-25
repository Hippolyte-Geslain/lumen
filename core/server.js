import http from 'node:http';
import { WebSocketServer } from 'ws';
import { openStore } from './store/db.js';
import { createGuard } from './net/guard.js';
import { createSecrets } from './secrets.js';
import { createAI } from './ai.js';
import { createNotes } from './notes.js';
import { createAttachments } from './attachments.js';
import { createAgents } from './agents.js';
import { createHostLumen } from './hostlumen.js';
import { createLlama } from './llama.js';
import { createBackup } from './backup.js';
import { createUpdater } from './update.js';
import { createGoogle } from './google.js';
import { createConnectors } from './mcp.js';

const ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']);

// JSON-RPC over WS: {id,method,params} -> {id,result} | {id,error:{code,message,server}}; pushes {event:'db',sub,body}.
export async function startCore({ dir, token, port = 0, ...opts }) {
  const store = openStore(dir);
  const saved = store.get('settings/sovereignty') || {};
  const guard = createGuard({ mode: saved.mode || 'local', allow: saved.allow || [] });
  guard.onChange((c) => store.set('settings/sovereignty', c));
  const secrets = createSecrets(store);
  const attachments = createAttachments({ db: store.db, dir: store.dir });
  const notes = createNotes({ db: store.db, store });
  const ai = createAI({ guard, secrets, store });
  const agents = createAgents({ store, guard, dir: store.dir, ...(opts.agents || {}) });
  const backup = createBackup({ store });
  const llama = createLlama({ guard, store, dir: store.dir, ...(opts.llama || {}) });
  llama.boot();
  const updater = createUpdater({ guard, store, version: opts.version || '0.1.0' });
  const connectors = createConnectors({ guard, secrets });
  const google = createGoogle({ guard, secrets });
  connectors.register('google', google.connector);
  connectors.register('host:lumen', createHostLumen({ agents, ...(opts.host || {}) }));
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/oauth/google') {
      // Loopback redirect from Google. Protected by the single-use random state, not the WS token.
      const page = (t) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>Lumen</title><p style="font:16px system-ui;margin:3em auto;max-width:28em">${t}</p>`); };
      return google.complete(u.searchParams.get('state'), u.searchParams.get('code')).then(() => page('Google is connected. You can close this tab and return to Lumen.'), (e) => page(String(e.message).replace(/[<&]/g, ' ')));
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = req.headers.origin;
    const bad = url.searchParams.get('token') !== token || (origin && !ORIGINS.has(origin));
    if (bad) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => onConn(ws));
  });

  function onConn(ws) {
    const subs = new Map();
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const fail = (id, code, message) => send({ id, error: { code, message, server: 'lumen-core' } });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const { id, method, params = {} } = m;
      switch (method) {
        case 'user.id': case 'user.me': return send({ id, result: { id: 'local', name: 'Local user' } });
        case 'db.get': return send({ id, result: store.get(params.path) });
        case 'db.set': store.set(params.path, params.body); return send({ id, result: { ok: true } });
        case 'db.subscribe': {
          const off = store.watch(params.path, (body) => send({ event: 'db', sub: params.sub, body }));
          subs.set(params.sub, off);
          send({ id, result: { ok: true } });
          return send({ event: 'db', sub: params.sub, body: store.get(params.path) });
        }
        case 'db.unsubscribe': subs.get(params.sub)?.(); subs.delete(params.sub); return send({ id, result: { ok: true } });
        case 'guard.get': return send({ id, result: { mode: guard.getMode(), allow: guard.allowlist() } });
        case 'guard.setMode': guard.setMode(params.mode); return send({ id, result: { mode: guard.getMode() } });
        case 'guard.allow': guard.allowHost(params.host); return send({ id, result: { allow: guard.allowlist() } });
        case 'guard.remove': guard.removeHost(params.host); return send({ id, result: { allow: guard.allowlist() } });
        case 'guard.log': return send({ id, result: guard.log(params?.n) });
        case 'guard.clearLog': guard.clearLog(); return send({ id, result: { ok: true } });
        case 'secrets.set': secrets.set(params.name, params.value); return send({ id, result: { ok: true } });
        case 'secrets.has': return send({ id, result: { has: secrets.has(params.name) } });
        case 'secrets.delete': secrets.delete(params.name); return send({ id, result: { ok: true } });
        case 'mcp.callTool': return connectors.callTool(params.server, params.tool, params.input).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'attachments.add': case 'attachments.list': case 'attachments.read': case 'attachments.remove': case 'attachments.removeCard': {
          try {
            const r = method === 'attachments.add' ? attachments.add(params) : method === 'attachments.list' ? attachments.list(params.cardId)
              : method === 'attachments.read' ? attachments.read(params.id) : method === 'attachments.removeCard' ? (attachments.removeCard(params.cardId), { ok: true }) : { ok: attachments.remove(params.id) };
            return send({ id, result: r });
          } catch (e) { return fail(id, e.code || 'internal', e.message); }
        }
        case 'notes.get': return send({ id, result: { root: notes.root() } });
        case 'notes.setRoot': case 'notes.reindex': case 'notes.search': {
          try {
            const r = method === 'notes.setRoot' ? { root: notes.setRoot(params.dir) } : method === 'notes.reindex' ? notes.reindex() : notes.search(params.query, params.limit);
            return send({ id, result: r });
          } catch (e) { return fail(id, e.code || 'internal', e.message); }
        }
        case 'agents.list': return send({ id, result: agents.list() });
        case 'agents.get': case 'agents.start': case 'agents.resume': case 'agents.stop': case 'agents.remove': {
          const run = method === 'agents.start' ? () => agents.start(params)
            : method === 'agents.resume' ? () => agents.resume(params.id, params.answer)
            : method === 'agents.stop' ? () => agents.stop(params.id)
            : method === 'agents.remove' ? () => agents.remove(params.id) : () => agents.get(params.id);
          return Promise.resolve().then(run).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        }
        case 'google.status': return send({ id, result: google.status() });
        case 'google.setClient': case 'google.begin': case 'google.disconnect': {
          try {
            if (method === 'google.setClient') google.setClient(params);
            else if (method === 'google.disconnect') google.disconnect();
            else return send({ id, result: google.begin(`http://127.0.0.1:${server.address().port}/oauth/google`) });
            return send({ id, result: google.status() });
          } catch (e) { return fail(id, e.code || 'internal', e.message); }
        }
        case 'backup.run': case 'backup.list': {
          try { return send({ id, result: method === 'backup.run' ? backup.run() : { dir: backup.dir, items: backup.list() } }); } catch (e) { return fail(id, e.code || 'internal', e.message); }
        }
        case 'update.get': return send({ id, result: updater.get() });
        case 'update.setFeed': try { updater.setFeed(params.feed); return send({ id, result: updater.get() }); } catch (e) { return fail(id, e.code || 'internal', e.message); }
        case 'update.check': return updater.check().then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'llama.status': return send({ id, result: llama.status() });
        case 'llama.install': case 'llama.download': case 'llama.removeModel': case 'llama.setModel': case 'llama.setAutostart': case 'llama.stop': {
          try {
            const r = method === 'llama.install' ? llama.install(params) : method === 'llama.download' ? llama.download(params.id)
              : method === 'llama.removeModel' ? (llama.removeModel(params.id), llama.status()) : method === 'llama.setModel' ? (llama.setModel(params.id), llama.status())
              : method === 'llama.setAutostart' ? (llama.setAutostart(params.on), llama.status()) : llama.stop();
            return send({ id, result: r });
          } catch (e) { return fail(id, e.code || 'internal', e.message); }
        }
        case 'llama.start': return llama.start(params).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'ai.usage': return send({ id, result: ai.usage() });
        case 'ai.get': return send({ id, result: ai.get() });
        case 'ai.set': ai.set(params); return send({ id, result: ai.get() });
        case 'ai.models': return ai.models(params.id).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'ai.test': return ai.test(params.id).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'ai.chat': return ai.chat(params.messages, params.opts).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        case 'sample': return ai.sample(params.prompt, params.opts).then((result) => send({ id, result }), (e) => fail(id, e.code || 'internal', e.message));
        default: return fail(id, 'not_found', `Unknown method ${method}`);
      }
    });
    ws.on('close', () => subs.forEach((off) => off()));
  }

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, guard, store, secrets, connectors, ai, attachments, notes, google, agents,
    async close() { llama.close(); wss.clients.forEach((c) => c.terminate()); await new Promise((r) => server.close(r)); store.close(); },
  };
}
