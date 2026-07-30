/**
 * E2E app server bootstrap.
 * 1. Ensures the frontend build exists (builds it when missing).
 * 2. Seeds an isolated SQLite database (e2e/.data) — never touches dev data.
 * 3. Starts the backend on E2E_PORT serving the built frontend.
 *
 * Used by playwright.config.ts webServer, but can also be run directly:
 *   node e2e/serve.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDist = path.join(root, 'frontend', 'dist');
const dataDir = path.join(root, 'e2e', '.data');
const port = process.env.E2E_PORT || '3100';

const env = { ...process.env, DB_DIR: dataDir, PORT: port, NODE_ENV: 'test' };

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, ...opts });
  if (res.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} failed with code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

if (!existsSync(path.join(frontendDist, 'index.html'))) {
  console.log('▸ frontend/dist missing — building frontend…');
  run('npm', ['run', 'build'], { cwd: path.join(root, 'frontend') });
}

console.log('▸ Seeding isolated e2e database…');
rmSync(dataDir, { recursive: true, force: true });
run('npx', ['tsx', 'src/db/seed.ts'], { cwd: backendDir });

console.log(`▸ Starting Clínica Tanah on http://127.0.0.1:${port} …`);
const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: backendDir, env, stdio: 'inherit' });

// Playwright terminates THIS process — make sure the tsx child dies with us,
// otherwise a stale server (old code, old DB) keeps holding the port.
function shutdown(code = 0) {
  if (!server.killed) server.kill('SIGTERM');
  setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 1500).unref();
  process.exit(code);
}
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => { if (!server.killed) server.kill('SIGKILL'); });
