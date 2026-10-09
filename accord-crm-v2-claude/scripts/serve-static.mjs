// Deliberately dumb static server (no SPA fallback, no rewrites) to prove the export is host-agnostic.
// usage: node scripts/serve-static.mjs <dir> <port>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let full = join(dir, p);
    if (!full.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }
    let s = await stat(full).catch(() => null);
    if (s?.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }).end(); return; }
      full = join(full, 'index.html'); s = await stat(full).catch(() => null);
    }
    if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 not found: ' + url.pathname); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream' });
    res.end(await readFile(full));
  } catch (e) { res.writeHead(500).end('error'); }
}).listen(port, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${port} (${dir})`));
