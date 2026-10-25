import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const p = spawn('src-tauri/binaries/lumen-core-x86_64-pc-windows-msvc.exe', [], { env: { ...process.env, LUMEN_DATA_DIR: (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/lumen-smoke-') } });
let buf = '';
p.stderr.on('data', (d) => process.stderr.write(d));
p.stdout.on('data', (d) => {
  buf += d;
  const m = /LUMEN_CORE_READY (.*)/.exec(buf);
  if (!m) return;
  const { port, token } = JSON.parse(m[1]);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'db.set', params: { path: 'a/b', body: { x: 1 } } })));
  ws.on('message', (r) => {
    const msg = JSON.parse(r);
    if (msg.id === 1) ws.send(JSON.stringify({ id: 2, method: 'db.get', params: { path: 'a/b' } }));
    else { console.log('smoke ok', JSON.stringify(msg)); p.kill(); process.exit(0); }
  });
});
setTimeout(() => { console.log('timeout'); p.kill(); process.exit(1); }, 15000);
