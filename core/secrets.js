import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Secrets live in the store under `secrets/<name>` as ciphertext only.
// Windows: DPAPI (current-user scope) via PowerShell. Elsewhere: AES-256-GCM keyed from LUMEN_SECRET_KEY.
// Plaintext is never returned over RPC; only core code calls get().
const PS = (script, input) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true }).trim();

const dpapi = {
  protect: (s) => PS('$t=[Console]::In.ReadToEnd(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString', s),
  unprotect: (c) => PS('$c=[Console]::In.ReadToEnd().Trim(); $s=ConvertTo-SecureString $c; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', c),
};

function aes(key) {
  const k = scryptSync(key, 'lumen-secrets', 32);
  return {
    protect(s) {
      const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', k, iv);
      const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    },
    unprotect(b64) {
      const b = Buffer.from(b64, 'base64'); const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

export function createSecrets(store, { backend } = {}) {
  const be = backend || (process.platform === 'win32' ? dpapi : (process.env.LUMEN_SECRET_KEY ? aes(process.env.LUMEN_SECRET_KEY) : null));
  const need = () => { if (!be) throw Object.assign(new Error('No secret backend (set LUMEN_SECRET_KEY)'), { code: 'secrets_unavailable' }); return be; };
  const path = (n) => `secrets/${n}`;
  const valid = (n) => { if (!/^[\w.-]{1,64}$/.test(n)) throw Object.assign(new Error('Bad secret name'), { code: 'bad_request' }); return n; };
  return {
    set(name, value) { store.set(path(valid(name)), { c: need().protect(String(value)) }); },
    get(name) { const r = store.get(path(valid(name))); return r ? need().unprotect(r.c) : null; },
    has(name) { return !!store.get(path(valid(name))); },
    delete(name) { store.set(path(valid(name)), null); },
  };
}
