import { randomBytes } from 'node:crypto';
import { startCore } from './server.js';

// Wrapped in a function (no top-level await) so the sidecar can be bundled to CommonJS for Node SEA.
async function main() {
  const token = process.env.LUMEN_CORE_TOKEN || randomBytes(24).toString('hex');
  const core = await startCore({
    dir: process.env.LUMEN_DATA_DIR || '.lumen-data',
    token,
    port: Number(process.env.LUMEN_CORE_PORT || 0),
  });
  console.log('LUMEN_CORE_READY ' + JSON.stringify({ port: core.port, token }));
  process.on('SIGTERM', async () => { await core.close(); process.exit(0); });
}
main();
