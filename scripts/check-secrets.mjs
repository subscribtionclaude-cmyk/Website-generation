// Secret guard (runs after `vite build` in `npm run check`).
//
// 1. Frontend environment: no VITE_* variable may carry a secret-looking NAME or VALUE
//    (everything VITE_* is embedded in the public bundle).
// 2. Built output (dist/**): no credential patterns, and none of the values of the server-only
//    variables present in this environment (SUPABASE_SERVICE_ROLE_KEY, every integration secret
//    named in src/domain/integrations/integration-catalog.json).
// 3. Tracked files (git ls-files): no real-looking credentials. Test fixtures (*.test.*, SQL test
//    suites) are skipped — they hold synthetic look-alikes on purpose to prove refusal paths.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const catalog = JSON.parse(
  readFileSync('src/domain/integrations/integration-catalog.json', 'utf8'),
);
const SERVER_ONLY = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_AUTH_GOOGLE_SECRET',
  'SUPABASE_AUTH_APPLE_SECRET',
  'INTEGRATIONS_CRON_SECRET',
  ...catalog.integrations.flatMap((i) => i.secrets),
]);

const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|CREDENTIAL|API_KEY|ACCESS_KEY)/;
const PUBLIC_NAMES = new Set(['VITE_SUPABASE_ANON_KEY']);

/** Credential shapes that must never be committed or shipped to browsers. */
const PATTERNS = [
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['OpenAI-style key', /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9]{20,}/],
  ['Stripe-style live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/],
  ['Meta access token', /\bEAA[A-Za-z0-9]{40,}/],
  ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

function jwtRoles(text) {
  const roles = [];
  for (const match of text.matchAll(
    /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g,
  )) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload && typeof payload.role === 'string') roles.push(payload.role);
    } catch {
      /* not a JWT */
    }
  }
  return roles;
}

function findings(text) {
  const out = PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
  if (jwtRoles(text).includes('service_role')) out.push('service-role JWT');
  return out;
}

const problems = [];

// ── 1. Frontend environment ────────────────────────────────────────────────
function parseEnvFile(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}
const envSources = [['process.env', process.env]];
for (const file of readdirSync('.').filter((f) => f.startsWith('.env')))
  envSources.push([file, parseEnvFile(file)]);
for (const [source, env] of envSources) {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue;
    if (SERVER_ONLY.has(name.slice(5)))
      problems.push(`${source}: ${name} exposes a server-only variable to the browser`);
    else if (!PUBLIC_NAMES.has(name) && SECRET_NAME.test(name))
      problems.push(`${source}: ${name} looks like a secret — VITE_* values are public`);
    if (value && findings(String(value)).length > 0)
      problems.push(`${source}: ${name} holds a secret-looking value`);
  }
}

// ── 2. Built output ────────────────────────────────────────────────────────
const serverValues = [...SERVER_ONLY]
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => typeof value === 'string' && value.length >= 8);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
let scanned = 0;
if (existsSync('dist')) {
  for (const file of walk('dist').filter((f) =>
    /\.(js|mjs|html|map|css|json|webmanifest|txt|xml)$/.test(f),
  )) {
    const text = readFileSync(file, 'utf8');
    scanned += 1;
    for (const label of findings(text)) problems.push(`${file}: ${label}`);
    for (const [name, value] of serverValues)
      if (text.includes(value)) problems.push(`${file}: contains the value of ${name}`);
  }
} else {
  problems.push('dist/ not found — run `vite build` first');
}

// ── 3. Tracked files ───────────────────────────────────────────────────────
const SKIP = [
  /\.test\.[cm]?[jt]sx?$/,
  /^supabase\/tests\//,
  /^e2e\//,
  /package-lock\.json$/,
  /\.(png|jpe?g|webp|avif|gif|ico|woff2?|glb|pdf)$/i,
];
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !SKIP.some((re) => re.test(f)) && existsSync(f));
for (const file of tracked) {
  if (/^\.env/.test(file) && file !== '.env.example') problems.push(`${file}: env file is tracked`);
  const text = readFileSync(file, 'utf8');
  for (const label of findings(text)) problems.push(`${file}: ${label}`);
}

if (problems.length > 0) {
  console.error(`Secret guard failed:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `Secret guard OK — ${scanned} built files and ${tracked.length} tracked files clean; ` +
    `${SERVER_ONLY.size} server-only names never exposed as VITE_*.`,
);
