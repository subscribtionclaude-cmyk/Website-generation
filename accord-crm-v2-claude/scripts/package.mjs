// Build the two deliverables into ./deliverables:
//   accord-crm-v2-claude-shipstatic-deploy.zip  — ONLY the static frontend (contents of dist/)
//   accord-crm-v2-claude-source.zip             — source + migrations + functions + docs (no secrets, no node_modules)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'deliverables');
mkdirSync(out, { recursive: true });
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Run `npm run build` first');
run('node', ['scripts/scan-secrets.mjs']);

const deploy = join(out, 'accord-crm-v2-claude-shipstatic-deploy.zip');
rmSync(deploy, { force: true });
run('zip', ['-r', '-X', '-q', deploy, '.'], { cwd: join(root, 'dist') });

const source = join(out, 'accord-crm-v2-claude-source.zip');
rmSync(source, { force: true });
run('zip', ['-r', '-X', '-q', source, '.',
  '-x', 'node_modules/*', 'dist/*', 'dist-e2e/*', 'test-results/*', 'playwright-report/*', 'deliverables/*', '.git/*', '*.zip',
  '.env', '.env.*', '*.local', '.postgrest.conf', 'tests/e2e/.postgrest.conf', '.local-e2e/*', '**/.DS_Store'], {});
// keep the template
run('zip', ['-q', source, '.env.example']);

const size = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;
console.log(`\n${deploy}  ${size(deploy)}\n${source}  ${size(source)}`);
