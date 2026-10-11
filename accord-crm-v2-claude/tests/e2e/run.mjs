// Build the app against the LOCAL stack and run the browser suites. usage: node tests/e2e/run.mjs [playwright args…]
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = { ...process.env, VITE_SUPABASE_URL: 'http://127.0.0.1:54400', NO_PROXY: '127.0.0.1,localhost' };
// anon key is just a JWT with role=anon signed by the local-only secret
const { ANON_KEY } = await import('./infra.mjs');
// E2E_RUNTIME_CONFIG=1 proves the shipped artifact: build with NO backend env, then point it at the stack via /config.js only.
const runtimeCfg = Boolean(process.env.E2E_RUNTIME_CONFIG);
if (runtimeCfg) { delete env.VITE_SUPABASE_URL; delete env.VITE_SUPABASE_ANON_KEY; } else env.VITE_SUPABASE_ANON_KEY = ANON_KEY;
execFileSync('npx', ['tsc', '--noEmit'], { cwd: root, stdio: 'inherit' });
execFileSync('npx', ['vite', 'build', '--outDir', 'dist-e2e', '--emptyOutDir'], { cwd: root, env, stdio: 'inherit' });
execFileSync('node', ['scripts/postbuild.mjs', 'dist-e2e'], { cwd: root, stdio: 'inherit' });
if (runtimeCfg) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(root, 'dist-e2e/config.js'), `window.ACCORD_CONFIG = { supabaseUrl: 'http://127.0.0.1:54400', supabaseAnonKey: '${ANON_KEY}' };`);
  console.log('runtime config.js written (no backend values were baked into the bundle)');
}
const r = spawnSync('npx', ['playwright', 'test', '-c', 'tests/e2e/playwright.config.ts', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
