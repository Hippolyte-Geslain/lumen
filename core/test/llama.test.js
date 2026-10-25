import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLlama, pickAsset, MODELS } from '../llama.js';

const memStore = () => { const m = new Map(); return { get: (p) => m.get(p), set: (p, b) => m.set(p, b) }; };
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const body = (buf) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } });
const resp = (status, { json, buf, headers = {} } = {}) => ({
  status, ok: status < 400, headers: new Headers(headers), json: async () => json, body: buf ? body(buf) : null,
});
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tick = () => new Promise((r) => setTimeout(r, 20));
const settle = async (l) => { for (let i = 0; i < 100 && l.isBusy(); i++) await tick(); };

const asset = (name, digest) => ({ name, browser_download_url: `https://github.com/ggml-org/llama.cpp/releases/download/b1/${name}`, digest });
const winCpu = process.platform === 'win32' ? 'llama-b1-bin-win-cpu-x64.zip' : process.platform === 'darwin' ? 'llama-b1-bin-macos-x64.zip' : 'llama-b1-bin-ubuntu-x64.zip';

function make({ fetchImpl, spawn, healthMs = 800 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'llama-'));
  const calls = [];
  const guard = { fetch: async (u, i) => { calls.push(String(u)); return fetchImpl(String(u), i); } };
  const extract = async (archive, dest) => { mkdirSync(join(dest, 'build'), { recursive: true }); writeFileSync(join(dest, 'build', EXE), 'bin'); };
  return { llama: createLlama({ guard, store: memStore(), dir, extract, spawn, healthMs, port: 18080 }), calls, dir };
}

describe('llama asset choice', () => {
  const assets = ['llama-b1-bin-win-cpu-x64.zip', 'llama-b1-bin-win-vulkan-x64.zip', 'llama-b1-bin-win-cuda-12.4-x64.zip', 'llama-b1-bin-macos-arm64.tar.gz', 'llama-b1-bin-ubuntu-x64.tar.gz'].map((name) => ({ name }));
  it('picks the CPU build by default and Vulkan on request', () => {
    expect(pickAsset(assets, { platform: 'win32', arch: 'x64' }).name).toBe('llama-b1-bin-win-cpu-x64.zip');
    expect(pickAsset(assets, { platform: 'win32', arch: 'x64', variant: 'vulkan' }).name).toBe('llama-b1-bin-win-vulkan-x64.zip');
    expect(pickAsset(assets, { platform: 'darwin', arch: 'arm64' }).name).toBe('llama-b1-bin-macos-arm64.tar.gz');
    expect(pickAsset(assets, { platform: 'win32', arch: 'arm64' })).toBeNull();
  });
});

describe('llama install', () => {
  const zip = Buffer.from('zipbytes');
  it('downloads through the guard hop by hop, verifies the digest, and finds the binary', async () => {
    const { llama, calls } = make({ fetchImpl: async (u) => {
      if (u.includes('api.github.com')) return resp(200, { json: [{ tag_name: 'b0', assets: [] }, { tag_name: 'b1', assets: [asset(winCpu, 'sha256:' + sha(zip))] }] });
      if (u.includes('github.com/ggml-org')) return resp(302, { headers: { location: 'https://release-assets.githubusercontent.com/x' } });
      return resp(200, { buf: zip, headers: { 'content-length': String(zip.length) } });
    } });
    llama.install();
    await settle(llama);
    const st = llama.status();
    expect(st.job).toMatchObject({ kind: 'install', error: '', finished: true });
    expect(st).toMatchObject({ installed: true, tag: 'b1' });
    expect(calls.map((c) => new URL(c).hostname)).toEqual(['api.github.com', 'github.com', 'release-assets.githubusercontent.com']);
  });
  it('discards a download whose digest does not match', async () => {
    const { llama, dir } = make({ fetchImpl: async (u) => {
      if (u.includes('api.github.com')) return resp(200, { json: [{ assets: [asset(winCpu, 'sha256:' + '0'.repeat(64))] }] });
      return resp(200, { buf: zip });
    } });
    llama.install();
    await settle(llama);
    expect(llama.status().job.error).toMatch(/SHA-256/);
    expect(llama.status().installed).toBe(false);
    expect(existsSync(join(dir, 'llama', winCpu + '.part'))).toBe(false);
  });
  it('surfaces a blocked host instead of hanging', async () => {
    const { llama } = make({ fetchImpl: async () => { throw Object.assign(new Error('Egress to api.github.com blocked in airgap mode'), { code: 'blocked_by_sovereignty_mode' }); } });
    llama.install();
    await settle(llama);
    expect(llama.status().job).toMatchObject({ error: expect.stringContaining('blocked'), finished: false });
  });
  it('refuses a redirect to plain http', async () => {
    const { llama } = make({ fetchImpl: async () => resp(302, { headers: { location: 'http://evil.example/x' } }) });
    llama.install();
    await settle(llama);
    expect(llama.status().job.error).toMatch(/non-https/);
  });
});

describe('llama models and server', () => {
  const gguf = Buffer.from('GGUFdata');
  const m = MODELS[0];
  it('downloads a model, verifies x-linked-etag, then starts and stops the server', async () => {
    let spawned; const ev = new EventEmitter(); ev.kill = () => ev.emit('exit', 0);
    const { llama } = make({
      spawn: (bin, args) => { spawned = { bin, args }; return ev; },
      fetchImpl: async (u) => {
        if (u.includes('api.github.com')) return resp(200, { json: [{ tag_name: 'b1', assets: [asset(winCpu)] }] });
        if (u.endsWith('/health')) return resp(200);
        if (u.includes('huggingface.co')) return resp(302, { headers: { location: 'https://cdn-lfs.hf.co/y', 'x-linked-etag': `"${sha(gguf)}"` } });
        return resp(200, { buf: gguf });
      },
    });
    llama.install(); await settle(llama);
    llama.download(m.id); await settle(llama);
    expect(llama.status().job).toMatchObject({ kind: 'model', error: '', finished: true });
    expect(llama.status()).toMatchObject({ model: m.id, models: expect.arrayContaining([expect.objectContaining({ id: m.id, installed: true })]) });
    const st = await llama.start();
    expect(st.running).toBe(true);
    expect(spawned.args).toEqual(expect.arrayContaining(['--host', '127.0.0.1', '--port', '18080']));
    expect(readFileSync(spawned.args[1])).toEqual(gguf);
    expect(llama.stop().running).toBe(false);
  });
  it('rejects a model whose hash differs from the one Hugging Face advertises', async () => {
    const { llama } = make({ fetchImpl: async (u) => (u.includes('huggingface.co') ? resp(302, { headers: { location: 'https://cdn-lfs.hf.co/y', 'x-linked-etag': `"${'a'.repeat(64)}"` } }) : resp(200, { buf: gguf })) });
    llama.download(m.id); await settle(llama);
    expect(llama.status().job.error).toMatch(/SHA-256/);
    expect(llama.status().models[0].installed).toBe(false);
  });
  it('validates input and refuses to start without a binary or model', async () => {
    const { llama } = make({ fetchImpl: async () => resp(404) });
    expect(() => llama.download('nope')).toThrow(/Unknown model/);
    await expect(llama.start()).rejects.toMatchObject({ code: 'not_found' });
    expect(() => llama.setModel('../../etc/passwd')).toThrow();
  });
});
