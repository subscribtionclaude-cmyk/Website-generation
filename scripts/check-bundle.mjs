// Bundle budget guard (runs after `vite build` in `npm run check`).
// - The storefront entry chunk must stay under ENTRY_BUDGET.
// - three.js (WebGL) may only live in the lazily loaded repair-diagnostic viewer chunk, so Home,
//   Shop, Product, Checkout and Account never download it.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS = 'dist/assets';
const ENTRY_BUDGET = 400 * 1024;
const THREE_MARKER = 'WebGLRenderer';

const files = (await readdir(ASSETS)).filter((f) => f.endsWith('.js'));
const problems = [];

const html = await readFile('dist/index.html', 'utf8');
const entries = [...html.matchAll(/assets\/(index-[\w-]+\.js)/g)].map((m) => m[1]);
if (entries.length === 0) problems.push('entry chunk not found in dist/index.html');
for (const entry of entries) {
  const { size } = await stat(join(ASSETS, entry));
  if (size > ENTRY_BUDGET)
    problems.push(
      `entry ${entry} is ${(size / 1024).toFixed(1)} kB (budget ${ENTRY_BUDGET / 1024} kB)`,
    );
}

for (const file of files) {
  const source = await readFile(join(ASSETS, file), 'utf8');
  if (source.includes(THREE_MARKER) && !file.startsWith('Diagnostic3D-'))
    problems.push(`three.js found outside the lazy viewer chunk: ${file}`);
}
if (!files.some((f) => f.startsWith('Diagnostic3D-')))
  problems.push('the lazy Diagnostic3D chunk is missing');

if (problems.length > 0) {
  console.error(`✗ bundle budget:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `✓ bundle budget: entry within ${ENTRY_BUDGET / 1024} kB, three.js only in the lazy viewer`,
);
