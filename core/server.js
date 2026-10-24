import http from 'node:http';
import { WebSocketServer } from 'ws';
import { openStore } from './store/db.js';
import { createGuard } from './net/guard.js';

const ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']);

// JSON-RPC over WS: {id,method,params} -> {id,result} | {id,error:{code,message,server}}; pushes {event:'db',sub,body}.
export async function startCore({ dir, token, port = 0 }) {
  const store = openStore(dir);
  const guard = createGuard({ mode: 'local' });
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
        case 'mcp.callTool': return fail(id, 'server_not_connected', 'No connector registered');
        case 'sample': return fail(id, 'provider_offline', 'No AI provider configured');
        default: return fail(id, 'not_found', `Unknown method ${method}`);
      }
    });
    ws.on('close', () => subs.forEach((off) => off()));
  }

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, guard, store,
    async close() { wss.clients.forEach((c) => c.terminate()); await new Promise((r) => server.close(r)); store.close(); },
  };
}
