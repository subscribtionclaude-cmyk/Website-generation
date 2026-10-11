import { start } from './infra.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

// stash handles on globalThis so teardown (same process) can stop them
export default async function setup() {
  const stack = await start();
  const dir = resolve(process.cwd(), 'dist-e2e');
  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain' };
  // the exact same no-fallback static behaviour as scripts/serve-static.mjs
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    let full = join(dir, normalize(decodeURIComponent(url.pathname)));
    let s = await stat(full).catch(() => null);
    if (s?.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }).end(); return; }
      full = join(full, 'index.html'); s = await stat(full).catch(() => null);
    }
    if (!s) { res.writeHead(404).end('404 ' + url.pathname); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream' }).end(await readFile(full));
  }).listen(4173, '127.0.0.1');
  (globalThis as any).__e2e = { stack, server };
}
