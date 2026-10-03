// Built-site link check (runs after `npm run build` in `npm run check`).
// Every internal href / src on every prerendered page (Arabic + English) must resolve to:
//   - a real file in dist/ (assets, images, sitemap…), or
//   - a prerendered page (dist/<path>.html, dist/index.html for "/"), or
//   - an app route that the host serves with the SPA shell (a 200 rule in public/_redirects) —
//     except content pages (product, category, brand, news, offer, legal), which must have their
//     prerendered page: a link to one that is missing is a broken link.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const CONTENT = /^(\/en)?\/(product|category|brand|news|offers|legal)\/[^/]+$/;

const rules = readFileSync('public/_redirects', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [from, to, status] = l.split(/\s+/);
    return { from, to, status: Number(status) };
  });
const matches = (pattern, path) =>
  pattern === '/*'
    ? true
    : pattern.endsWith('/*')
      ? path.startsWith(pattern.slice(0, -1))
      : path === pattern;
const rule = (path) => rules.find((r) => matches(r.from, path));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = walk(DIST).filter((f) => f.endsWith('.html') && !f.endsWith('404.html'));
const problems = new Map();
let checked = 0;

function resolves(path) {
  if (path === '/' || path === '') return existsSync(join(DIST, 'index.html'));
  const clean = decodeURIComponent(path).replace(/\/+$/, '');
  if (existsSync(join(DIST, clean)) && statSync(join(DIST, clean)).isFile()) return true;
  if (existsSync(join(DIST, `${clean}.html`)) || existsSync(join(DIST, clean, 'index.html')))
    return true;
  if (CONTENT.test(clean)) return false;
  return rule(clean)?.status === 200;
}

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    const path = raw.split(/[?#]/)[0];
    checked += 1;
    if (!resolves(path)) {
      const list = problems.get(path) ?? [];
      list.push(page.slice(DIST.length));
      problems.set(path, list);
    }
  }
}

if (pages.length === 0) {
  console.error('Link check: no prerendered pages in dist/ — run `npm run build` first.');
  process.exit(1);
}
if (problems.size > 0) {
  console.error(`Link check failed — ${problems.size} broken internal link target(s):`);
  for (const [target, from] of problems)
    console.error(
      `  - ${target}  (on ${from.slice(0, 3).join(', ')}${from.length > 3 ? ', …' : ''})`,
    );
  process.exit(1);
}
console.log(`Link check OK — ${checked} internal links on ${pages.length} pages resolve.`);
