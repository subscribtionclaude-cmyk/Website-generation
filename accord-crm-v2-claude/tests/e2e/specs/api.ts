// Raw API helpers for specs (talk to the local gateway exactly like the browser does).
export const G = 'http://127.0.0.1:54400';
export async function tokenFor(email: string, password: string): Promise<string> {
  const r = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json() as { access_token?: string };
  if (!j.access_token) throw new Error(`login failed for ${email}`);
  return j.access_token;
}
export async function rest(token: string | null, path: string, init: RequestInit = {}) {
  const r = await fetch(`${G}/rest/v1/${path}`, { ...init, headers: { 'Content-Type': 'application/json', apikey: 'x', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) } });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}
export const rpc = (token: string | null, fn: string, args: object = {}) => rest(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
export async function fn(token: string | null, name: string, body: object, extra: Record<string, string> = {}) {
  const r = await fetch(`${G}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
export async function count(token: string, table: string, filter = ''): Promise<number> {
  const r = await fetch(`${G}/rest/v1/${table}?select=id${filter ? `&${filter}` : ''}`, { method: 'HEAD', headers: { Authorization: `Bearer ${token}`, apikey: 'x', Prefer: 'count=exact' } });
  return Number((r.headers.get('content-range') ?? '*/0').split('/')[1]);
}
