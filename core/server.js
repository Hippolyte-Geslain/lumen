import http from 'node:http';
import { WebSocketServer } from 'ws';
import { openStore } from './store/db.js';
import { createGuard } from './net/guard.js';
import { createSecrets } from './secrets.js';
import { createAI } from './ai.js';
import { createNotes } from './notes.js';
import { createAttachments } from './attachments.js';
import { createConnectors } from './mcp.js';

const ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']);

// JSON-RPC over WS: {id,method,params} -> {id,result} | {id,error:{code,message,server}}; pushes {event:'db',sub,body}.
export async function startCore({ dir, token, port = 0 }) {
  const store = openStore(dir);
  const saved = store.get('settings/sovereignty') || {};
  const guard = createGuard({ mode: saved.mode || 'local', allow: saved.allow || [] });
  guard.onChange((c) => store.set('settings/sovereignty', c));
  const secrets = createSecrets(store);
  const attachments = createAttachments({ db: store.db, dir: store.dir });
  const notes = createNotes({ db: store.db, store });
  const ai = createAI({ guard, secrets, store });
  const connectors = createConnectors({ guard, secrets });
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
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
        case 'attachments.add': case 'attachments.list': case 'attachments.read': case 'attachments.remove': {
          try {
            const r = method === 'attachments.add' ? attachments.add(params) : method === 'attachments.list' ? attachments.list(params.cardId)
              : method === 'attachments.read' ? attachments.read(params.id) : { ok: attachments.remove(params.id) };
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
    port: server.address().port, guard, store, secrets, connectors, ai, attachments, notes,
    async close() { wss.clients.forEach((c) => c.terminate()); await new Promise((r) => server.close(r)); store.close(); },
  };
}
