// Serve a directory (e.g. the unzipped deploy ZIP) with a dumb static server and verify that every route,
// every asset referenced by the HTML, and every lazy chunk referenced by the JS resolves with HTTP 200.
// usage: node scripts/verify-static.mjs <dir>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) throw new Error('usage: verify-static.mjs <dir>');
const port = 4890;
const srv = spawn('node', [join(root, 'scripts/serve-static.mjs'), dir, String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const base = `http://127.0.0.1:${port}`;
const routes = [...readFileSync(join(root, 'src/routes.ts'), 'utf8').matchAll(/'(\/[a-z0-9\-/]*\/)'/g)].map((m) => m[1]);
const failures = []; const seen = new Set(); let checked = 0;
async function get(path, expectType) {
  if (seen.has(path)) return null; seen.add(path);
  const r = await fetch(base + path); checked++;
  const body = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200 || body.length === 0) failures.push(`${r.status} ${path}`);
  else if (expectType && !(r.headers.get('content-type') ?? '').includes(expectType)) failures.push(`bad content-type ${path}: ${r.headers.get('content-type')}`);
  return body.toString('latin1');
}
try {
  for (const r of routes) {
    const html = await get(r, 'text/html');
    if (!html) continue;
    for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) await get(m[1]);
  }
  // follow the lazy-chunk graph: any hashed asset filename mentioned inside a JS chunk must exist and be served
  const queue = [...seen].filter((p) => p.endsWith('.js') && p.startsWith('/assets/'));
  while (queue.length) {
    const p = queue.pop(); const js = readFileSync(join(dir, p), 'utf8');
    for (const m of js.matchAll(/([\w.\-]+-[A-Za-z0-9_\-]{6,10}\.(?:js|css))/g)) {
      const q = `/assets/${m[1]}`;
      if (!seen.has(q)) { await get(q); queue.push(q); }
    }
  }
  for (const p of ['/manifest.webmanifest', '/config.js', '/sw.js', '/icons/accord-icon-192.png', '/icons/accord-icon-512.png', '/icons/accord-icon-maskable-512.png', '/icons/accord-apple-touch-icon.png', '/icons/accord-favicon-32.png', '/icons/accord-favicon-64.png', '/brand/accord-app-icon.png', '/brand/accord-logo-light.png', '/brand/accord-logo-dark.png', '/404.html']) await get(p);
} finally { srv.kill(); }
if (failures.length) { console.error('STATIC VERIFY FAILED:\n' + failures.join('\n')); process.exit(1); }
console.log(`static verify OK — ${routes.length} routes + ${checked - routes.length} assets/chunks fetched over plain HTTP, all 200`);
