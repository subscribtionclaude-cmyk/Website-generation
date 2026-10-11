// Fails (exit 1) if anything secret-looking is in the source tree or the compiled static output.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.local-e2e']);
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.sql', '.md', '.txt', '.webmanifest', '.toml', '.yml', '.yaml', '.env', '.example', '']);
const problems = [];

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) yield* walk(p); else yield p;
  }
}
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function scanFile(file, { frontend }) {
  const ext = extname(file);
  if (!TEXT.has(ext) && !file.endsWith('.env.example')) return;
  const rel = relative(root, file);
  if (rel.endsWith('scan-secrets.mjs')) return;
  const text = readFileSync(file, 'utf8');
  const add = (what) => problems.push(`${rel}: ${what}`);
  if (/-----BEGIN (RSA |EC |)PRIVATE KEY-----/.test(text)) add('PEM private key');
  if (/"private_key"\s*:\s*"-----BEGIN/.test(text) || /"client_email"\s*:\s*"[^"]+gserviceaccount\.com"[\s\S]{0,400}"private_key"/.test(text)) add('Google service-account JSON');
  if (/sb_secret_[A-Za-z0-9_\-]{10,}/.test(text)) add('Supabase secret key (sb_secret_…)');
  if (/postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{3,}@/.test(text)) add('database URL with password');
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_\-]{10,}\.([A-Za-z0-9_\-]{10,})\.[A-Za-z0-9_\-]{10,}/g)) {
    try { const claims = JSON.parse(b64(m[1])); if (claims.role === 'service_role' || claims.role === 'supabase_admin') add(`JWT with role=${claims.role}`); } catch { /* not a JWT */ }
  }
  if (frontend) {
    for (const w of ['SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT', 'service_role', 'BEGIN PRIVATE KEY', 'DB_PASSWORD', 'JWT_SECRET']) {
      if (text.includes(w)) add(`frontend output mentions "${w}"`);
    }
  }
}

const targets = [{ dir: root, frontend: false }];
if (existsSync(join(root, 'dist'))) targets.push({ dir: join(root, 'dist'), frontend: true });
let scanned = 0;
for (const t of targets) {
  for (const f of walk(t.dir)) {
    if (!t.frontend && f.startsWith(join(root, 'dist'))) continue; // dist handled with frontend rules
    scanFile(f, t); scanned++;
  }
}
if (problems.length) { console.error('SECRET SCAN FAILED:\n' + problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
console.log(`secret scan clean — ${scanned} files checked (source + ${existsSync(join(root, 'dist')) ? 'compiled output' : 'no dist'})`);
