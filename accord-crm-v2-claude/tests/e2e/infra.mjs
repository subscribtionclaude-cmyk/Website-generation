// Local, fully offline stand-in for Supabase: Postgres 16 (real migrations) + PostgREST + a mock GoTrue/Storage gateway
// + REAL Edge Function code run under Deno + a mock Google Sheets API. Nothing here ships to production.
import { createServer, request as httpRequest } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sheet1, sheet2 } from './fixtures/google-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const PORTS = { gateway: 54400, postgrest: 54401, google: 54402, fnUsers: 54411, fnSync: 54412, app: 4173, pg: 54329 };
export const JWT_SECRET = 'e2e-only-jwt-secret-0123456789abcdef0123456789';
export const DB = 'accord_e2e';
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(claims, ttl = 3600) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl, ...claims }));
  return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
export function verifyJwt(t) {
  const [h, p, s] = (t ?? '').split('.');
  if (!s || createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  return c.exp * 1000 > Date.now() ? c : null;
}
export const ANON_KEY = signJwt({ role: 'anon' }, 10 * 365 * 86400);
export const SERVICE_KEY = signJwt({ role: 'service_role' }, 10 * 365 * 86400);

const procs = [];
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts }).toString();
const psql = (db, file) => sh('psql', ['-h', '/tmp', '-p', String(PORTS.pg), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);

export function resetDatabase() {
  sh('psql', ['-h', '/tmp', '-p', String(PORTS.pg), '-U', 'postgres', '-q', '-c', `drop database if exists ${DB} with (force)`, '-c', `create database ${DB}`]);
  psql(DB, join(root, 'supabase/tests/00_local_stub.sql'));
  for (const f of ['20261009000001_core_schema', '20261009000002_triggers', '20261009000003_rls', '20261009000004_functions', '20261009000005_storage', '20261009000006_seed']) psql(DB, join(root, `supabase/migrations/${f}.sql`));
  psql(DB, join(here, 'fixtures/seed.sql'));
}

function spawnProc(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  procs.push(p); return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, label, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url, { method: 'GET' }); if (r.status < 500) return; } catch { /* retry */ } await wait(300); }
  throw new Error(`${label} did not start`);
}

function proxy(req, res, port, path, extraHeaders = {}) {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: `127.0.0.1:${port}`, ...extraHeaders }; delete headers['content-length'];
    if (body.length) headers['content-length'] = body.length;
    const p = httpRequest({ host: '127.0.0.1', port, path, method: req.method, headers }, (r) => {
      const h = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !k.toLowerCase().startsWith('access-control-')));
      res.writeHead(r.statusCode, { ...h, ...cors(req) }); r.pipe(res);
    });
    p.on('error', (e) => { res.writeHead(502, cors(req)); res.end(JSON.stringify({ error: String(e) })); });
    p.end(body);
  });
}
const cors = (req) => ({ 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'content-range, content-type', 'Access-Control-Max-Age': '600' });

export async function start() {
  resetDatabase();
  const pool = new pg.Pool({ host: '/tmp', port: PORTS.pg, user: 'postgres', database: DB });
  const sent = []; const files = new Map();
  const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: u.raw_user_meta_data ?? {}, created_at: new Date().toISOString() });
  const session = (u) => ({ access_token: signJwt({ sub: u.id, role: 'authenticated', email: u.email }), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: Buffer.from(u.id).toString('base64url'), user: userJson(u) });
  const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { const b = Buffer.concat(c); r(b); }); });
  const json = (res, req, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors(req) }); res.end(JSON.stringify(obj)); };

  // --- PostgREST
  writeFileSync(join(here, '.postgrest.conf'), [
    `db-uri = "postgres://authenticator@127.0.0.1:${PORTS.pg}/${DB}"`, 'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${JWT_SECRET}"`,
    `server-port = ${PORTS.postgrest}`, 'db-pool = 10', 'db-max-rows = 5000', ''].join('\n'));
  // trust auth for the authenticator role is handled by pg_hba trust (initdb -A trust)
  spawnProc('postgrest', '/var/tmp/pgrst/postgrest', [join(here, '.postgrest.conf')]);
  await waitFor(`http://127.0.0.1:${PORTS.postgrest}/`, 'PostgREST');

  // --- Edge Functions (REAL code) under Deno
  const deno = join(root, 'node_modules/.bin/deno');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fnEnv = { SUPABASE_URL: `http://127.0.0.1:${PORTS.gateway}`, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SITE_URL: `http://127.0.0.1:${PORTS.app}`,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'crm-reader@accord-test.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
    GOOGLE_TOKEN_URL: `http://127.0.0.1:${PORTS.google}/token`, GOOGLE_SHEETS_BASE: `http://127.0.0.1:${PORTS.google}/v4/spreadsheets`, NO_COLOR: '1' };
  spawnProc('fn-users', deno, ['run', '-A', join(root, 'supabase/functions/admin-users/index.ts')], { ...fnEnv, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORTS.fnUsers}` });
  const syncProc = spawnProc('fn-sync', deno, ['run', '-A', join(root, 'supabase/functions/google-sheet-sync/index.ts')], { ...fnEnv, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORTS.fnSync}` });
  // a second sync instance WITHOUT credentials, to test the "not configured" path
  const noCredEnv = { ...fnEnv, GOOGLE_PRIVATE_KEY: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '' };
  spawnProc('fn-sync-nocred', deno, ['run', '-A', join(root, 'supabase/functions/google-sheet-sync/index.ts')], { ...noCredEnv, DENO_SERVE_ADDRESS: 'tcp:127.0.0.1:54413' });
  void syncProc;

  // --- mock Google
  const google = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/token') { await readBody(req); return json(res, req, 200, { access_token: 'mock-google-token', expires_in: 3600, token_type: 'Bearer' }); }
    if (!(req.headers.authorization ?? '').startsWith('Bearer mock-google-token')) return json(res, req, 401, {});
    const m = /^\/v4\/spreadsheets\/([^/]+)(\/values\/(.+))?$/.exec(u.pathname);
    if (!m) return json(res, req, 404, {});
    if (m[1] !== '127WeIut5Jjwbs6sS2w6fmqikrRlZbPZERElYh7eWclQ') return json(res, req, 404, { error: 'only the approved spreadsheet' });
    if (!m[2]) return json(res, req, 200, { properties: { title: 'Accord New Data' }, sheets: [{ properties: { title: 'Sheet1', gridProperties: { rowCount: sheet1.length, columnCount: 22 } } }, { properties: { title: 'Sheet2', gridProperties: { rowCount: sheet2.length, columnCount: 4 } } }] });
    const tab = decodeURIComponent(m[3]).replace(/^'|'$/g, '');
    if (req.method !== 'GET') return json(res, req, 405, {}); // the Sheet is read-only
    return json(res, req, 200, { values: tab === 'Sheet1' ? sheet1 : tab === 'Sheet2' ? sheet2 : [] });
  }).listen(PORTS.google, '127.0.0.1');

  // --- gateway: GoTrue mock + Storage mock + proxies
  const gateway = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'); const path = u.pathname;
      if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
      if (path.startsWith('/rest/v1/')) return proxy(req, res, PORTS.postgrest, path.slice('/rest/v1'.length) + u.search);
      if (path.startsWith('/functions/v1/')) {
        const name = path.slice('/functions/v1/'.length);
        const port = name === 'admin-users' ? PORTS.fnUsers : name === 'google-sheet-sync' ? (req.headers['x-test-no-creds'] ? 54413 : PORTS.fnSync) : null;
        if (!port) return json(res, req, 404, { error: 'no such function' });
        return proxy(req, res, port, '/');
      }
      if (path.startsWith('/auth/v1/')) {
        const body = (await readBody(req)).toString(); const data = body ? JSON.parse(body) : {};
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
        const route = path.slice('/auth/v1'.length);
        const q = (s, a) => pool.query(s, a).then((r) => r.rows);
        if (route === '/token' && u.searchParams.get('grant_type') === 'password') {
          const [usr] = await q('select * from auth.users where lower(email)=lower($1)', [data.email]);
          if (!usr || usr.password !== data.password || usr.banned) return json(res, req, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 400 });
          return json(res, req, 200, session(usr));
        }
        if (route === '/token' && u.searchParams.get('grant_type') === 'refresh_token') {
          const id = Buffer.from(data.refresh_token ?? '', 'base64url').toString(); const [usr] = await q('select * from auth.users where id::text=$1', [id]);
          return usr && !usr.banned ? json(res, req, 200, session(usr)) : json(res, req, 400, { error: 'invalid_grant' });
        }
        if (route === '/user' && req.method === 'GET') {
          const c = verifyJwt(bearer); if (!c || !c.sub) return json(res, req, 401, { msg: 'invalid JWT' });
          const [usr] = await q('select * from auth.users where id::text=$1', [c.sub]); return usr && !usr.banned ? json(res, req, 200, userJson(usr)) : json(res, req, 401, { msg: 'user not found' });
        }
        if (route === '/user' && req.method === 'PUT') {
          const c = verifyJwt(bearer); if (!c) return json(res, req, 401, { msg: 'invalid JWT' });
          if (data.password) await q('update auth.users set password=$2 where id::text=$1', [c.sub, data.password]);
          const [usr] = await q('select * from auth.users where id::text=$1', [c.sub]); return json(res, req, 200, userJson(usr));
        }
        if (route === '/logout') { res.writeHead(204, cors(req)); return res.end(); }
        if (route === '/recover') { sent.push({ kind: 'recover', email: data.email }); return json(res, req, 200, {}); }
        // admin API (service role only)
        const c = verifyJwt(bearer);
        if (route.startsWith('/admin/') || route === '/invite') {
          if (!c || c.role !== 'service_role') return json(res, req, 403, { msg: 'not admin' });
          if (route === '/admin/users' && req.method === 'POST') {
            const dup = await q('select 1 from auth.users where lower(email)=lower($1)', [data.email]); if (dup.length) return json(res, req, 422, { msg: 'User already registered', code: 422 });
            const [usr] = await q('insert into auth.users (email, password, raw_user_meta_data) values ($1,$2,$3) returning *', [data.email, data.password ?? null, data.user_metadata ?? {}]); return json(res, req, 200, userJson(usr));
          }
          if (route === '/invite') {
            const dup = await q('select 1 from auth.users where lower(email)=lower($1)', [data.email]); if (dup.length) return json(res, req, 422, { msg: 'User already registered', code: 422 });
            const [usr] = await q('insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning *', [data.email, data.data ?? {}]); sent.push({ kind: 'invite', email: data.email }); return json(res, req, 200, userJson(usr));
          }
          const m = /^\/admin\/users\/([0-9a-f-]+)$/.exec(route);
          if (m && req.method === 'PUT') {
            if (data.password) await q('update auth.users set password=$2 where id::text=$1', [m[1], data.password]);
            if (data.ban_duration) await q('update auth.users set banned=$2 where id::text=$1', [m[1], data.ban_duration !== 'none']);
            const [usr] = await q('select * from auth.users where id::text=$1', [m[1]]); return json(res, req, 200, userJson(usr));
          }
          if (m && req.method === 'DELETE') { await q('delete from auth.users where id::text=$1', [m[1]]); return json(res, req, 200, {}); }
        }
        return json(res, req, 404, { msg: 'not implemented in mock', route });
      }
      if (path.startsWith('/storage/v1/')) {
        const rest = path.slice('/storage/v1'.length); const body = await readBody(req);
        if (req.method === 'POST' && rest.startsWith('/object/sign/')) { const p = rest.slice('/object/sign/'.length); return json(res, req, 200, { signedURL: `/object/sign/${p}?token=mock` }); }
        if (req.method === 'GET' && rest.startsWith('/object/sign/')) { const f = files.get(decodeURIComponent(rest.slice('/object/sign/'.length))); if (!f) return json(res, req, 404, {}); res.writeHead(200, { 'Content-Type': f.type, ...cors(req) }); return res.end(f.body); }
        if (req.method === 'POST' && rest.startsWith('/object/')) { files.set(decodeURIComponent(rest.slice('/object/'.length)), { body, type: req.headers['content-type'] ?? 'application/octet-stream' }); return json(res, req, 200, { Key: rest.slice(8) }); }
        if (req.method === 'DELETE' && rest.startsWith('/object/')) { const b = JSON.parse(body.toString() || '{}'); for (const p of b.prefixes ?? []) files.delete(`${rest.slice('/object/'.length)}/${p}`); return json(res, req, 200, []); }
        return json(res, req, 404, {});
      }
      if (path === '/__test/emails') return json(res, req, 200, sent);
      if (path === '/__test/health') return json(res, req, 200, { ok: true });
      json(res, req, 404, { error: 'unknown route', path });
    } catch (e) { console.error('gateway error', e); json(res, req, 500, { error: String(e) }); }
  }).listen(PORTS.gateway, '127.0.0.1');

  await waitFor(`http://127.0.0.1:${PORTS.gateway}/__test/health`, 'gateway');
  // deno cold start (downloads npm:@supabase/supabase-js on first run)
  for (const port of [PORTS.fnUsers, PORTS.fnSync, 54413]) await waitFor(`http://127.0.0.1:${port}/`, `edge function :${port}`, 120000);
  return {
    pool, gateway, google,
    emails: () => sent,
    async stop() { for (const p of procs) p.kill('SIGTERM'); gateway.close(); google.close(); await pool.end().catch(() => {}); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const h = await start();
  console.log(`local stack up: gateway http://127.0.0.1:${PORTS.gateway}`);
  process.on('SIGINT', async () => { await h.stop(); process.exit(0); });
}
