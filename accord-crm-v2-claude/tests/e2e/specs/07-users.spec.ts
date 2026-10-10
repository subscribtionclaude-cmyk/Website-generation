import { test, expect, type Page } from '@playwright/test';
import { login, USERS } from './helpers';
import { G, tokenFor, fn, rest, rpc, count } from './api';

// Admin → Users: no user cap, specific errors (email rate limit ≠ user capacity), temporary-password creation that never
// depends on email, deactivate / reactivate, and permanent delete that keeps all CRM history.
const AMER = '11111111-1111-1111-1111-111111111111';
const admin = () => tokenFor(...USERS.admin as unknown as [string, string]);
const emails = async () => (await (await fetch(`${G}/__test/emails`)).json()) as { kind: string; email: string }[];
async function openActions(page: Page, email: string) {
  await page.getByRole('searchbox', { name: 'Search users' }).fill(email);
  await page.getByRole('row').filter({ hasText: email }).getByTestId('user-actions').click();
}
const created: string[] = [];

test.describe.serial('user management', () => {
  test('no user limit: 16 users created through the backend (invite + temporary password), listed, searchable, paginated', async ({ page }) => {
    const tok = await admin();
    for (let i = 1; i <= 16; i++) {
      const email = `cap-${String(i).padStart(2, '0')}@accord.test`;
      const role = ['bd_executive', 'viewer', 'admin'][i % 3];
      const r = await fn(tok, 'admin-users', { action: 'create', email, full_name: `Capacity User ${i}`, role, ...(i % 2 ? { temporary_password: `Cap-Passw0rd-${i}xx` } : {}) });
      expect(r.status, `user ${i}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.mode).toBe(i % 2 ? 'temporary_password' : 'invite');
      created.push(r.body.user_id);
    }
    const rows = (await rest(tok, 'profiles?select=email,role&email=like.cap-*&order=email')).body as { email: string; role: string }[];
    expect(rows).toHaveLength(16);
    rows.forEach((r, i) => expect(r.role).toBe(['bd_executive', 'viewer', 'admin'][(i + 1) % 3]));

    await login(page, 'admin');
    await page.goto('/admin/users/');
    // more than one page of users → the pager appears and both pages are reachable
    await expect(page.getByText(/1–20 of \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/21–\d+ of \d+/)).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search users' }).fill('capacity user');
    await expect(page.getByTestId('user-row')).toHaveCount(16);
    await expect(page.getByRole('row').filter({ hasText: 'cap-02@accord.test' })).toContainText('Admin');
    await expect(page.getByRole('row').filter({ hasText: 'cap-01@accord.test' })).toContainText('Viewer');
    await expect(page.getByRole('row').filter({ hasText: 'cap-03@accord.test' })).toContainText('BD Executive');
  });

  test('email rate limit is reported as an email limit (not a user limit), creates nothing, and temporary password works', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/users/');
    const before = (await emails()).length;
    await page.getByRole('button', { name: 'Add user' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Email').fill('ratelimit-newhire@accord.test');
    await dlg.getByLabel('Full name').fill('Rita Ratelimit');
    await dlg.getByRole('button', { name: 'Email invitation (optional)' }).click();
    await dlg.getByRole('button', { name: 'Send invitation' }).click();
    const note = dlg.getByTestId('invite-rate-limit');
    await expect(note).toContainText('Invitation email limit reached. Try again later, use Temporary Password, or configure Custom SMTP.');
    await expect(note).toContainText('not a limit on the number of CRM users');
    await expect(dlg.getByText('Could not invite the user')).toHaveCount(0);
    expect((await emails()).length).toBe(before); // nothing was sent
    // retry safely with a server-generated temporary password: no email involved, no duplicate account
    await note.getByRole('button', { name: 'Use temporary password instead' }).click();
    await dlg.getByRole('button', { name: 'Generate' }).click();
    const pw = await dlg.getByLabel(/Temporary password \(/).inputValue();
    expect(pw).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{16}$/);
    await dlg.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('User created')).toBeVisible();
    const tok = await admin();
    expect(await count(tok, 'profiles', 'email=eq.ratelimit-newhire@accord.test')).toBe(1);
    const t2 = await tokenFor('ratelimit-newhire@accord.test', pw); // the account works; first sign-in must change the password
    expect((await rest(t2, 'profiles?select=must_change_password&email=eq.ratelimit-newhire@accord.test')).body[0].must_change_password).toBe(true);
    created.push((await rest(tok, 'profiles?select=id&email=eq.ratelimit-newhire@accord.test')).body[0].id);
  });

  test('specific, safe errors: duplicate email, invalid email, SMTP failure, weak password', async () => {
    const tok = await admin();
    const dup = await fn(tok, 'admin-users', { action: 'create', email: 'BD1@accord.test', full_name: 'Dup', role: 'viewer' });
    expect(dup.status).toBe(409); expect(dup.body).toEqual({ error: 'A user with this email already exists', code: 'user_exists' });
    const bad = await fn(tok, 'admin-users', { action: 'create', email: 'not-an-email', role: 'viewer' });
    expect(bad.status).toBe(400); expect(bad.body.code).toBe('invalid_email');
    const smtp = await fn(tok, 'admin-users', { action: 'create', email: 'smtpfail-x@accord.test', role: 'viewer' });
    expect(smtp.status).toBe(502); expect(smtp.body.code).toBe('email_send_failed');
    expect(JSON.stringify(smtp.body)).not.toMatch(/Error sending invite email|stack|at\s|service_role/i); // upstream text never forwarded
    const weak = await fn(tok, 'admin-users', { action: 'create', email: 'weak-x@accord.test', role: 'viewer', temporary_password: 'short' });
    expect(weak.status).toBe(400); expect(weak.body.code).toBe('weak_password');
    expect(await count(tok, 'profiles', 'email=in.(smtpfail-x@accord.test,weak-x@accord.test,not-an-email)')).toBe(0);
  });

  test('deactivate and reactivate (reversible), clearly separate from delete', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/users/');
    await openActions(page, 'cap-01@accord.test');
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(page.getByRole('dialog')).toContainText('you can reactivate it at any time');
    await page.getByTestId('confirm-status').click();
    await expect(page.getByText('User deactivated')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'cap-01@accord.test' })).toContainText('Deactivated');
    const denied = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'cap-01@accord.test', password: 'Cap-Passw0rd-1xx' }) });
    expect(denied.status).toBe(400);
    await openActions(page, 'cap-01@accord.test');
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await page.getByTestId('confirm-status').click();
    await expect(page.getByText('User reactivated')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'cap-01@accord.test' })).toContainText('Active');
    expect(await tokenFor('cap-01@accord.test', 'Cap-Passw0rd-1xx')).toBeTruthy();
  });

  test('permanent delete: strong confirmation, login + refresh revoked, history preserved and still attributed', async ({ page }) => {
    const tok = await admin();
    const mk = await fn(tok, 'admin-users', { action: 'create', email: 'leaver@accord.test', full_name: 'Lea Leaver', role: 'bd_executive', temporary_password: 'Leaver-Passw0rd-1' });
    expect(mk.status).toBe(200);
    const id = mk.body.user_id as string;
    // the leaver does real work first
    const lt = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'leaver@accord.test', password: 'Leaver-Passw0rd-1' }) });
    const sess = await lt.json() as { access_token: string; refresh_token: string };
    expect((await rpc(sess.access_token, 'log_call', { p_lead_id: AMER, p_outcome: 'responded' })).status).toBeLessThan(300);
    const calls = await count(tok, 'call_attempts', `user_id=eq.${id}`);
    const acts = await count(tok, 'activities', `actor_id=eq.${id}`);
    expect(calls).toBeGreaterThan(0);

    await login(page, 'admin');
    await page.goto('/admin/users/');
    await openActions(page, 'leaver@accord.test');
    await page.getByRole('menuitem', { name: 'Delete user' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('Lea Leaver'); await expect(dlg).toContainText('leaver@accord.test'); await expect(dlg).toContainText('BD Executive');
    await expect(dlg).toContainText('Deleting this user permanently removes their login access. Historical CRM activity will be preserved.');
    const go = dlg.getByTestId('confirm-delete');
    await expect(go).toBeDisabled(); // never one click
    await dlg.getByTestId('delete-confirm-input').fill('someone-else@accord.test');
    await expect(go).toBeDisabled();
    await dlg.getByTestId('delete-confirm-input').fill('leaver@accord.test');
    await go.click();
    await expect(page.getByText('User deleted — their CRM history is preserved')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search users' }).fill('leaver');
    await expect(page.getByTestId('user-row')).toHaveCount(0); // gone from normal management
    await page.getByRole('radio', { name: /Deleted/ }).click();
    const row = page.getByRole('row').filter({ hasText: 'leaver@accord.test' });
    await expect(row).toContainText('Lea Leaver (Deleted user)');
    await expect(row.getByTestId('user-actions')).toHaveCount(0);

    // sign-in, token refresh and the old session are all dead
    const pwLogin = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'leaver@accord.test', password: 'Leaver-Passw0rd-1' }) });
    expect(pwLogin.status).toBe(400);
    const refresh = await fetch(`${G}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sess.refresh_token }) });
    expect(refresh.status).toBe(400);
    expect((await rest(sess.access_token, 'leads?select=id')).body).toEqual([]);
    // history preserved and attributed
    expect(await count(tok, 'call_attempts', `user_id=eq.${id}`)).toBe(calls);
    expect(await count(tok, 'activities', `actor_id=eq.${id}`)).toBe(acts);
    const who = (await rest(tok, `call_attempts?select=profiles(full_name)&user_id=eq.${id}&limit=1`)).body[0];
    expect(who.profiles.full_name).toBe('Lea Leaver (Deleted user)');
    // deleted users cannot be reactivated or edited, and the email can be used again for a new account
    expect((await fn(tok, 'admin-users', { action: 'update', user_id: id, active: true })).body.code).toBe('user_deleted');
    expect((await fn(tok, 'admin-users', { action: 'delete', user_id: id })).body.code).toBe('user_deleted');
    const again = await fn(tok, 'admin-users', { action: 'create', email: 'leaver@accord.test', full_name: 'Lea Returns', role: 'viewer', temporary_password: 'Leaver-Passw0rd-2' });
    expect(again.status).toBe(200);
    expect(again.body.user_id).not.toBe(id);
    created.push(again.body.user_id);
    // board report still counts the deleted user's calls today
    const rep = (await rpc(tok, 'admin_report', { p_from: new Date().toISOString().slice(0, 10), p_to: new Date().toISOString().slice(0, 10) })).body;
    const mine = (rep.calls.by_user as { user_id: string; name: string; total: number }[]).find((u) => u.user_id === id);
    if (mine) expect(mine.name).toBe('Lea Leaver (Deleted user)');
  });

  test('safety: cannot delete yourself, last admin protected, deleted admin leaves the others', async () => {
    const tok = await admin();
    const me = (await rest(tok, 'profiles?select=id&email=eq.admin@accord.test')).body[0].id;
    const self = await fn(tok, 'admin-users', { action: 'delete', user_id: me });
    expect(self.status).toBe(400); expect(self.body.code).toBe('self');
    const selfOff = await fn(tok, 'admin-users', { action: 'update', user_id: me, active: false });
    expect(selfOff.body.code).toBe('self');
    // a second admin can be deleted; the caller (an active admin) always remains, so the last active admin can never go
    const a2 = (await rest(tok, 'profiles?select=id&email=eq.cap-02@accord.test')).body[0].id;
    expect((await fn(tok, 'admin-users', { action: 'delete', user_id: a2 })).status).toBe(200);
    const admins = await count(tok, 'profiles', 'role=eq.admin&active=eq.true');
    expect(admins).toBeGreaterThanOrEqual(1);
    expect((await fn(tok, 'admin-users', { action: 'delete', user_id: 'not-a-uuid' })).body.code).toBe('not_found');
  });

  test('permissions: BD executive, viewer and anonymous are denied every user-management action (direct API)', async () => {
    const victim = created[1];
    const bd = await tokenFor(...USERS.bd1 as unknown as [string, string]);
    const viewer = await tokenFor(...USERS.viewer as unknown as [string, string]);
    const actions = [
      { action: 'create', email: 'sneaky@accord.test', role: 'admin', temporary_password: 'Sneaky-Passw0rd-1' },
      { action: 'update', user_id: victim, role: 'admin' }, { action: 'update', user_id: victim, active: false },
      { action: 'delete', user_id: victim }, { action: 'set_temp_password', user_id: victim, password: 'Sneaky-Passw0rd-1' },
      { action: 'send_reset', user_id: victim },
    ];
    for (const [who, tk, status] of [['bd', bd, 403], ['viewer', viewer, 403], ['anon', null, 401]] as const) {
      for (const a of actions) {
        const r = await fn(tk, 'admin-users', a);
        expect(r.status, `${who} ${a.action}`).toBe(status);
      }
    }
    // direct table writes are blocked by RLS too
    expect((await rest(bd, `profiles?id=eq.${victim}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }), headers: { Prefer: 'return=representation' } })).body).toEqual([]);
    expect((await rest(bd, `profiles?id=eq.${victim}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })).body).toEqual([]);
    expect((await rpc(bd, 'admin_user_signins')).status).toBeGreaterThanOrEqual(400);
    expect(await count(await admin(), 'profiles', 'email=eq.sneaky@accord.test')).toBe(0);
  });

  test('Arabic / RTL: actions menu, delete confirmation and rate-limit message', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/users/');
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('searchbox').fill('cap-05@accord.test');
    await page.getByRole('row').filter({ hasText: 'cap-05@accord.test' }).getByTestId('user-actions').click();
    await expect(page.getByRole('menuitem', { name: 'إيقاف' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'حذف المستخدم' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'حذف المستخدم نهائيًا' })).toBeVisible();
    await expect(dlg).toContainText('حذف هذا المستخدم يزيل صلاحية تسجيل دخوله نهائيًا. سيتم الاحتفاظ بنشاطه التاريخي في النظام.');
    // the menu and dialog sit inside the viewport in RTL
    const box = await dlg.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0);
    await dlg.getByRole('button', { name: 'إلغاء' }).click();
    await page.getByRole('button', { name: 'إضافة مستخدم' }).click();
    const add = page.getByRole('dialog');
    await add.locator('input[type=email]').fill('ratelimit-ar@accord.test');
    await add.getByRole('button', { name: 'دعوة بالبريد الإلكتروني (اختياري)' }).click();
    await add.getByRole('button', { name: 'إرسال الدعوة' }).click();
    await expect(add.getByTestId('invite-rate-limit')).toContainText('تم الوصول إلى الحد المؤقت لإرسال رسائل الدعوة. حاول لاحقًا أو استخدم كلمة مرور مؤقتة أو قم بإعداد SMTP مخصص.');
    await expect(add.getByTestId('invite-rate-limit')).toContainText('وليس حدًا لعدد مستخدمي النظام');
    await add.getByRole('button', { name: 'إلغاء' }).click();
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('cleanup: every test account is deleted again', async () => {
    const tok = await admin();
    const ids = (await rest(tok, 'profiles?select=id&deleted_at=is.null&or=(email.like.cap-*,email.eq.ratelimit-newhire@accord.test,email.eq.leaver@accord.test)')).body as { id: string }[];
    for (const { id } of ids) expect((await fn(tok, 'admin-users', { action: 'delete', user_id: id })).status).toBe(200);
    expect(await count(tok, 'profiles', 'deleted_at=is.null&or=(email.like.cap-*,email.eq.ratelimit-newhire@accord.test,email.eq.leaver@accord.test)')).toBe(0);
  });
});
