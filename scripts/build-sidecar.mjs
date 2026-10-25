// Packages core/ into a single executable (Node SEA) at src-tauri/binaries/lumen-core-<target-triple>[.exe],
// the name Tauri's externalBin expects. Usage: node scripts/build-sidecar.mjs
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from 'postject';

const out = 'src-tauri/binaries';
const tmp = '.sidecar-build';
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

function triple() {
  try {
    const m = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }));
    if (m) return m[1];
  } catch { /* no rust toolchain: fall back to the common triple for this platform */ }
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}
const t = triple();
const exe = process.platform === 'win32' ? '.exe' : '';

// SEA needs one CommonJS file; core uses ESM and import.meta.url (for createRequire of node:sqlite).
await build({
  entryPoints: ['core/index.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: join(tmp, 'core.cjs'), logLevel: 'warning',
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
});

writeFileSync(join(tmp, 'sea.json'), JSON.stringify({ main: join(tmp, 'core.cjs'), output: join(tmp, 'sea.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', join(tmp, 'sea.json')], { stdio: 'inherit' });

const target = join(out, `lumen-core-${t}${exe}`);
copyFileSync(process.execPath, target);
await inject(target, 'NODE_SEA_BLOB', (await import('node:fs')).readFileSync(join(tmp, 'sea.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
console.log('built', target, existsSync(target) ? '' : '(missing?)');
