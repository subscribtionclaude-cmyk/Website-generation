// Make the SPA work on a plain static host with NO rewrite rules:
// every client route gets its own <route>/index.html (a copy of the app shell), plus 404.html.
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, process.argv[2] ?? 'dist');
const shell = join(dist, 'index.html');
if (!existsSync(shell)) throw new Error('dist/index.html missing — run vite build first');
const routes = [...readFileSync(join(root, 'src/routes.ts'), 'utf8').matchAll(/'(\/[a-z0-9\-/]*\/)'/g)].map((m) => m[1]);
if (routes.length < 20) throw new Error(`expected the full route list, found ${routes.length}`);
for (const r of routes) {
  const dir = join(dist, r);
  mkdirSync(dir, { recursive: true });
  copyFileSync(shell, join(dir, 'index.html'));
}
copyFileSync(shell, join(dist, '404.html'));
console.log(`postbuild: wrote ${routes.length} route entry points + 404.html`);
