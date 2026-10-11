import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { USERS } from './helpers';
import { tokenFor, rest, rpc, fn } from './api';

const forged = (claims: object) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${h}.${p}.${createHmac('sha256', 'attacker-guess-secret-attacker-guess-secret').update(`${h}.${p}`).digest('base64url')}`;
};

test.describe('security at the API layer (RLS + Edge Functions)', () => {
  test('anonymous / forged tokens get nothing', async () => {
    for (const t of [null, forged({ role: 'authenticated', sub: '00000000-0000-0000-0000-0000000000a1' }), forged({ role: 'service_role' })]) {
      const r = await rest(t, 'leads?select=*');
      expect([401, 403]).toContain(r.status);
      expect([401, 403]).toContain((await rpc(t, 'my_call_metrics')).status);
      expect([401, 403]).toContain((await rest(t, 'profiles?select=*')).status);
      expect([401, 403]).toContain((await fn(t, 'admin-users', { action: 'ping' })).status);
    }
  });
  test('Edge Functions: JWT + active profile + admin role are all enforced server-side', async () => {
    expect((await fn(null, 'admin-users', { action: 'ping' })).status).toBe(401);
    for (const who of ['bd1', 'viewer', 'inactive'] as const) {
      const tok = await tokenFor(...USERS[who] as [string, string]).catch(() => null);
      if (!tok) continue;
      const r = await fn(tok, 'admin-users', { action: 'ping' });
      expect(r.status, who).toBe(403);
      expect((await fn(tok, 'admin-users', { action: 'create', email: 'x@y.zz', role: 'admin', temporary_password: 'Xx-123456789012' })).status, who).toBe(403);
      expect((await fn(tok, 'google-sheet-sync', { action: 'scan' })).status, who).toBe(403);
    }
    const nop = await tokenFor(...USERS.noprofile as [string, string]);
    expect((await fn(nop, 'admin-users', { action: 'ping' })).status).toBe(403);
    // role in the request body is never trusted
    const bd = await tokenFor(...USERS.bd1 as [string, string]);
    expect((await fn(bd, 'admin-users', { action: 'ping', role: 'admin', user: { role: 'admin' } })).status).toBe(403);
  });
  test('BD / viewer cannot read admin data or escalate through the REST API', async () => {
    for (const who of ['bd1', 'viewer'] as const) {
      const t = await tokenFor(...USERS[who] as [string, string]);
      expect((await rest(t, 'audit_logs?select=*')).body).toEqual([]);
      expect((await rest(t, 'sync_runs?select=*')).body).toEqual([]);
      expect((await rpc(t, 'admin_report', { p_from: '2026-01-01', p_to: '2026-01-02' })).status).toBeGreaterThanOrEqual(400);
      expect((await rpc(t, 'sync_apply_leads', { p_run: '00000000-0000-0000-0000-000000000000', p_actor: null, p_sheet: 's', p_rows: [] })).status).toBeGreaterThanOrEqual(400);
      expect((await rpc(t, 'svc_upsert_profile', { p_actor: '00000000-0000-0000-0000-0000000000b1', p_user: '00000000-0000-0000-0000-0000000000b1', p_email: 'bd1@accord.test', p_full_name: 'x', p_role: 'admin', p_active: true })).status).toBeGreaterThanOrEqual(400);
      const patch = await rest(t, 'profiles?id=eq.00000000-0000-0000-0000-0000000000b1', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ role: 'admin' }) });
      expect(patch.body).toEqual([]); // RLS filtered the update to zero rows
      expect((await rest(t, 'audit_logs', { method: 'POST', body: JSON.stringify({ entity: 'x', action: 'y' }) })).status).toBeGreaterThanOrEqual(400);
    }
    const bd = await tokenFor(...USERS.bd1 as [string, string]);
    const other = await rest(bd, 'call_attempts?select=id&user_id=eq.00000000-0000-0000-0000-0000000000b2');
    expect(other.status).toBe(200); // lead-history visibility is by design…
    const upd = await rest(bd, 'call_attempts?user_id=eq.00000000-0000-0000-0000-0000000000b2', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ notes: 'tamper' }) });
    expect(upd.body).toEqual([]); // …but other people's calls cannot be edited
    const metrics = await rpc(bd, 'call_metrics', { p_user: '00000000-0000-0000-0000-0000000000b2', p_from: '2026-01-01', p_to: '2026-12-31' });
    expect(metrics.status).toBeGreaterThanOrEqual(400);
  });
  test('viewer cannot write anything', async () => {
    const t = await tokenFor(...USERS.viewer as [string, string]);
    expect((await rpc(t, 'log_call', { p_lead_id: '11111111-1111-1111-1111-111111111111', p_outcome: 'responded' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(t, 'leads', { method: 'POST', body: JSON.stringify({ name: 'x', created_by: '00000000-0000-0000-0000-0000000000c1' }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(t, 'follow_ups', { method: 'POST', body: JSON.stringify({ lead_id: '11111111-1111-1111-1111-111111111111', due_date: '2030-01-01', created_by: '00000000-0000-0000-0000-0000000000c1' }) })).status).toBeGreaterThanOrEqual(400);
  });
});
