// Bundled llama.cpp: fetches llama-server from the official GitHub releases, fetches a GGUF model from Hugging Face,
// and runs the server on loopback so the "llamacpp" AI provider works with nothing else installed.
// Every request goes through guard.fetch, one hop at a time (redirects included), so air-gapped / allow-list modes apply
// and each host shows in the network log. Downloads are checked against the publisher's SHA-256 when one is advertised.
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const err = (code, message) => Object.assign(new Error(message), { code });
const PORT = 8080;
// /releases/latest points at an unrelated release without binaries; the builds are the recent (pre)releases.
const RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10';

/** Hosts the downloads touch (including the CDNs they redirect to). The UI asks before allow-listing them. */
export const HOSTS = ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'huggingface.co', 'cdn-lfs.hf.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co'];

export const MODELS = [
  { id: 'llama-3.2-1b', name: 'Llama 3.2 1B Instruct (Q4_K_M)', size: '0.8 GB', url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf' },
  { id: 'qwen2.5-1.5b', name: 'Qwen 2.5 1.5B Instruct (Q4_K_M)', size: '1.1 GB', url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' },
  { id: 'llama-3.2-3b', name: 'Llama 3.2 3B Instruct (Q4_K_M)', size: '2.0 GB', url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf' },
];
const fileOf = (m) => basename(new URL(m.url).pathname);

/** Release asset for this machine, or null. `variant` is 'cpu' (default, runs anywhere) or 'vulkan'. */
export function pickAsset(assets, { platform = process.platform, arch = process.arch, variant = 'cpu' } = {}) {
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  const re = platform === 'win32' ? new RegExp(`-bin-win-${variant === 'vulkan' ? 'vulkan' : 'cpu'}-${a}\\.zip$`)
    : platform === 'darwin' ? new RegExp(`-bin-macos-${a}\\.(zip|tar\\.gz)$`)
    : new RegExp(`-bin-ubuntu-${variant === 'vulkan' ? 'vulkan-' : ''}${a}\\.(zip|tar\\.gz)$`);
  return assets.find((x) => re.test(x.name)) || null;
}

function findBinary(dir) {
  const want = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === want) return p;
    if (e.isDirectory()) { const f = findBinary(p); if (f) return f; }
  }
  return null;
}

export function createLlama({ guard, store, dir, spawn = nodeSpawn, extract, port = PORT, healthMs = 120_000 }) {
  const root = join(dir, 'llama');
  const binDir = join(root, 'bin');
  const modelDir = join(root, 'models');
  const read = () => store.get('settings/llama') || {};
  const write = (patch) => store.set('settings/llama', { ...read(), ...patch });
  let job = null; // { kind, label, done, total, error }
  let proc = null;
  let starting = false;

  const unzip = extract || ((archive, dest) => new Promise((resolve, reject) => {
    // bsdtar ships with Windows 10+ and macOS and reads zip and tar.gz; it refuses paths that escape dest.
    // On Windows use the system one by path: a GNU tar earlier on PATH (Git Bash) cannot read zip files.
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
    const p = spawn(tar, ['-xf', archive, '-C', dest], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(err('internal', 'Could not unpack the download'))));
  }));

  /** GET with every hop through the guard. Returns { res, headers } where headers merges the response headers of all hops. */
  async function get(url, init = {}) {
    const seen = {};
    for (let hop = 0; hop < 6; hop++) {
      const res = await guard.fetch(url, { ...init, redirect: 'manual' });
      for (const [k, v] of res.headers?.entries?.() || []) seen[k] = v;
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), url);
        if (next.protocol !== 'https:') throw err('provider_error', 'Refusing a redirect to a non-https URL');
        url = next.href;
        continue;
      }
      if (!res.ok) throw err('provider_error', `${new URL(url).hostname} answered ${res.status}`);
      return { res, headers: seen };
    }
    throw err('provider_error', 'Too many redirects');
  }

  async function download(url, dest, { sha, onProgress }) {
    const { res, headers } = await get(url);
    const want = (sha || headers['x-linked-etag'] || '').replace(/^"|"$/g, '').replace(/^sha256:/, '').toLowerCase();
    const total = Number(res.headers.get('content-length')) || 0;
    const part = `${dest}.part`;
    const hash = createHash('sha256');
    let done = 0;
    try {
      await pipeline(Readable.fromWeb(res.body), async function* (src) { for await (const c of src) { hash.update(c); done += c.length; onProgress(done, total); yield c; } }, createWriteStream(part));
      if (/^[0-9a-f]{64}$/.test(want) && hash.digest('hex') !== want) throw err('integrity', 'The download does not match its published SHA-256 and was discarded');
      renameSync(part, dest);
    } catch (e) { rmSync(part, { force: true }); throw e; }
  }

  function run(kind, label, fn) {
    if (busy()) throw err('busy', 'Another download is running');
    job = { kind, label, done: 0, total: 0, error: '' };
    const mine = job;
    fn((d, t) => { mine.done = d; mine.total = t; })
      .then(() => { mine.finished = true; }, (e) => { mine.error = e.message; mine.code = e.code; });
    return { started: true };
  }
  const busy = () => !!job && !job.error && !job.finished;

  const models = () => MODELS.map((m) => {
    const p = join(modelDir, fileOf(m));
    return { id: m.id, name: m.name, size: m.size, installed: existsSync(p) };
  });
  const customModels = () => (existsSync(modelDir) ? readdirSync(modelDir).filter((f) => f.endsWith('.gguf') && !MODELS.some((m) => fileOf(m) === f)) : []);
  const modelPath = (sel) => {
    const m = MODELS.find((x) => x.id === sel);
    const p = m ? join(modelDir, fileOf(m)) : sel && !/[\\/]/.test(sel) ? join(modelDir, sel) : null;
    return p && existsSync(p) ? p : null;
  };

  async function waitHealthy() {
    const t = Date.now();
    while (Date.now() - t < healthMs) {
      if (!proc) throw err('provider_offline', 'llama-server stopped while loading the model');
      try { const r = await guard.fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* still loading */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw err('provider_offline', 'llama-server did not become ready');
  }

  const api = {
    hosts: HOSTS,
    status() {
      const bin = existsSync(binDir) ? findBinary(binDir) : null;
      const st = read();
      return {
        installed: !!bin, tag: st.tag || '', model: st.model || '', running: !!proc && !starting, starting, port,
        models: models(), custom: customModels(), autostart: !!st.autostart, hosts: HOSTS,
        job: job && { kind: job.kind, label: job.label, done: job.done, total: job.total, error: job.error, finished: !!job.finished },
        platform: process.platform,
      };
    },
    install({ variant = 'cpu' } = {}) {
      return run('install', 'llama-server', async (progress) => {
        const list = await (await get(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'lumen' } })).res.json();
        const rel = (Array.isArray(list) ? list : []).find((r) => pickAsset(r.assets || [], { variant }));
        const asset = rel && pickAsset(rel.assets, { variant });
        if (!asset) throw err('unsupported', `No llama.cpp build for ${process.platform}/${process.arch}. Point Lumen at your own llama-server instead.`);
        mkdirSync(root, { recursive: true });
        const archive = join(root, asset.name);
        await download(asset.browser_download_url, archive, { sha: asset.digest, onProgress: progress });
        rmSync(binDir, { recursive: true, force: true });
        mkdirSync(binDir, { recursive: true });
        try { await unzip(archive, binDir); } finally { rmSync(archive, { force: true }); }
        if (!findBinary(binDir)) throw err('internal', 'The download did not contain llama-server');
        write({ tag: rel.tag_name || '' });
      });
    },
    download(id) {
      const m = MODELS.find((x) => x.id === id);
      if (!m) throw err('bad_request', 'Unknown model');
      return run('model', m.name, async (progress) => {
        mkdirSync(modelDir, { recursive: true });
        await download(m.url, join(modelDir, fileOf(m)), { onProgress: progress });
        if (!read().model) write({ model: m.id });
      });
    },
    removeModel(sel) {
      const p = modelPath(sel);
      if (!p) throw err('not_found', 'No such model');
      if (proc && read().model === sel) throw err('busy', 'Stop the server first');
      rmSync(p, { force: true });
      if (read().model === sel) write({ model: '' });
    },
    setModel(sel) { if (!modelPath(sel)) throw err('not_found', 'No such model'); write({ model: sel }); },
    setAutostart(on) { write({ autostart: !!on }); },
    async start({ model } = {}) {
      if (proc) return api.status();
      const bin = existsSync(binDir) ? findBinary(binDir) : null;
      if (!bin) throw err('not_found', 'Install llama-server first');
      const sel = model || read().model;
      const file = modelPath(sel);
      if (!file) throw err('not_found', 'Pick a downloaded model first');
      if (model) write({ model });
      starting = true;
      const child = spawn(bin, ['-m', file, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '4096'], { stdio: 'ignore', windowsHide: true });
      proc = child;
      child.on('exit', () => { if (proc === child) proc = null; });
      child.on('error', () => { if (proc === child) proc = null; });
      try { await waitHealthy(); } catch (e) { api.stop(); throw e; } finally { starting = false; }
      return api.status();
    },
    stop() {
      const p = proc; proc = null;
      if (p) { try { p.kill(); } catch { /* already gone */ } }
      return api.status();
    },
    async boot() { if (read().autostart && api.status().installed && modelPath(read().model)) await api.start().catch(() => {}); },
    close() { api.stop(); },
    isBusy: busy,
  };
  return api;
}
