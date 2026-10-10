import { test, expect, type Page } from '@playwright/test';
import { login, USERS } from './helpers';
import { G, tokenFor, fn, rest, count } from './api';

// Admin-created users are email-confirmed at creation and can sign in immediately; nobody needs a verification email.
const admin = () => tokenFor(...USERS.admin as unknown as [string, string]);
const emails = async () => (await (await fetch(`${G}/__test/emails`)).json()) as { kind: string; email: string }[];
const grant = (email: string, password: string) => fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
async function status(id: string) {
  const r = await fn(await admin(), 'admin-users', { action: 'auth_status' });
  expect(r.status).toBe(200);
  return (r.body.users as { id: string; confirmed: boolean }[]).find((u) => u.id === id);
}
async function signInUi(page: Page, email: string, password: string) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe.serial('auto-confirmed admin-created users', () => {
  test('default Add User flow: temporary password, confirmed at creation, immediate sign-in, first-login password change', async ({ page, browser }) => {
    const sent = (await emails()).length;
    await login(page, 'admin');
    await page.goto('/admin/users/');
    await page.getByRole('button', { name: 'Add user' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('button', { name: 'Temporary password (recommended)' })).toHaveClass(/on/);
    await expect(dlg.getByRole('button', { name: 'Create user' })).toBeVisible(); // no "Send invitation" by default
    await dlg.getByLabel('Full name').fill('Nadia Newhire');
    await dlg.getByLabel('Email').fill('nadia@accord.test');
    const pw = await dlg.getByLabel(/Temporary password \(/).inputValue(); // pre-generated, visible to copy
    expect(pw).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{16}$/);
    await dlg.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('User created')).toBeVisible();
    expect((await emails()).length).toBe(sent); // no email of any kind
    const tok = await admin();
    const p = (await rest(tok, 'profiles?select=id,role,active,must_change_password&email=eq.nadia@accord.test')).body[0];
    expect(p).toMatchObject({ role: 'bd_executive', active: true, must_change_password: true });
    expect((await status(p.id))!.confirmed).toBe(true);
    await expect(page.getByRole('row').filter({ hasText: 'nadia@accord.test' }).getByTestId('badge-unconfirmed')).toHaveCount(0);

    // immediate email + password sign-in, then the forced password change, then the CRM with the BD role
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await signInUi(p2, 'nadia@accord.test', pw);
    await expect(p2).toHaveURL(/\/set-password\//);
    await p2.getByLabel('New password').fill('Nadia-Own-Passw0rd');
    await p2.getByLabel('Repeat password').fill('Nadia-Own-Passw0rd');
    await p2.getByRole('button', { name: 'Save password' }).click();
    await expect(p2).toHaveURL(/\/dashboard\//);
    await p2.goto('/leads/');
    await expect(p2.getByRole('button', { name: 'New lead' })).toBeVisible(); // BD can work
    await p2.goto('/admin/users/');
    await expect(p2).toHaveURL(/\/dashboard\//); // but is not an admin
    await ctx.close();
  });

  test('invited (unconfirmed) users: clear message, admin can confirm, a temporary password also confirms', async ({ page }) => {
    const tok = await admin();
    const inv1 = await fn(tok, 'admin-users', { action: 'create', email: 'invited-one@accord.test', full_name: 'Ivy Invited', role: 'viewer' });
    const inv2 = await fn(tok, 'admin-users', { action: 'create', email: 'invited-two@accord.test', full_name: 'Ike Invited', role: 'viewer' });
    expect(inv1.body.mode).toBe('invite'); expect(inv2.body.mode).toBe('invite');
    expect((await status(inv1.body.user_id))!.confirmed).toBe(false);

    await login(page, 'admin');
    await page.goto('/admin/users/');
    const row1 = page.getByRole('row').filter({ hasText: 'invited-one@accord.test' });
    await expect(row1.getByTestId('badge-unconfirmed')).toBeVisible();
    // (1) setting a temporary password confirms the account → immediate sign-in
    await row1.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Set temporary password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate' }).click();
    const pw = await page.getByRole('dialog').getByLabel('New temporary password').inputValue();
    await page.getByRole('dialog').getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('Temporary password set')).toBeVisible();
    await expect(row1.getByTestId('badge-unconfirmed')).toHaveCount(0);
    expect((await grant('invited-one@accord.test', pw)).status).toBe(200);
    // (2) "Confirm email" on its own (password untouched)
    const row2 = page.getByRole('row').filter({ hasText: 'invited-two@accord.test' });
    await row2.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Confirm email' }).click();
    await expect(page.getByText('Email confirmed — the user can sign in now')).toBeVisible();
    await expect(row2.getByTestId('badge-unconfirmed')).toHaveCount(0);
    expect((await status(inv2.body.user_id))!.confirmed).toBe(true);
  });

  test('sign-in errors are specific and safe (EN + AR); inactive and deleted users cannot sign in', async ({ page }) => {
    const tok = await admin();
    const mk = await fn(tok, 'admin-users', { action: 'create', email: 'gone@accord.test', full_name: 'Gus Gone', role: 'bd_executive', temporary_password: 'Gone-Passw0rd-123' });
    const off = await fn(tok, 'admin-users', { action: 'create', email: 'paused@accord.test', full_name: 'Pia Paused', role: 'viewer', temporary_password: 'Paused-Passw0rd-1' });
    expect((await grant('paused@accord.test', 'Paused-Passw0rd-1')).status).toBe(200); // confirmed: works at once
    expect((await fn(tok, 'admin-users', { action: 'update', user_id: off.body.user_id, active: false })).status).toBe(200);
    expect((await fn(tok, 'admin-users', { action: 'delete', user_id: mk.body.user_id })).status).toBe(200);

    await signInUi(page, 'bd1@accord.test', 'not-the-password');
    await expect(page.getByText('Incorrect email or password')).toBeVisible();
    await signInUi(page, 'paused@accord.test', 'Paused-Passw0rd-1');
    await expect(page.getByText('This account is inactive. Please contact an ACCORD administrator.')).toBeVisible();
    await signInUi(page, 'gone@accord.test', 'Gone-Passw0rd-123');
    await expect(page.getByText('Incorrect email or password')).toBeVisible(); // deleted: no account any more
    await expect(page.getByText(/Email not confirmed|Invalid login credentials|banned/i)).toHaveCount(0); // never raw Supabase text
    // Arabic
    await page.getByRole('button', { name: 'Language' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('input[type=email]').fill('paused@accord.test');
    await page.locator('input[type=password]').fill('Paused-Passw0rd-1');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('هذا الحساب غير نشط. يُرجى التواصل مع مسؤول ACCORD.')).toBeVisible();
    await page.getByRole('button', { name: 'اللغة' }).click();
  });

  test('roles still enforced for auto-confirmed users; only admins may confirm or read auth status', async () => {
    const tok = await admin();
    const v = await fn(tok, 'admin-users', { action: 'create', email: 'vera@accord.test', full_name: 'Vera Viewer', role: 'viewer', temporary_password: 'Vera-Passw0rd-123' });
    const vt = await tokenFor('vera@accord.test', 'Vera-Passw0rd-123');
    expect((await rest(vt, 'leads?select=id&limit=1')).body.length).toBe(1); // viewer can read
    const ins = await rest(vt, 'leads', { method: 'POST', body: JSON.stringify({ name: 'Viewer cannot add' }) });
    expect(ins.status).toBeGreaterThanOrEqual(400); // …but not write
    const bd = await tokenFor(...USERS.bd1 as unknown as [string, string]);
    for (const [tk, st] of [[bd, 403], [vt, 403], [null, 401]] as const) {
      expect((await fn(tk, 'admin-users', { action: 'confirm_email', user_id: v.body.user_id })).status).toBe(st);
      expect((await fn(tk, 'admin-users', { action: 'auth_status' })).status).toBe(st);
    }
    // public self-registration stays impossible through the CRM: there is no sign-up in the app, and the function
    // refuses any non-admin caller (checked above)
  });

  test('cleanup: every test account from this spec is deleted', async () => {
    const tok = await admin();
    const list = 'nadia@accord.test,invited-one@accord.test,invited-two@accord.test,paused@accord.test,vera@accord.test';
    const ids = (await rest(tok, `profiles?select=id&deleted_at=is.null&email=in.(${list})`)).body as { id: string }[];
    for (const { id } of ids) expect((await fn(tok, 'admin-users', { action: 'delete', user_id: id })).status).toBe(200);
    expect(await count(tok, 'profiles', `deleted_at=is.null&email=in.(${list},gone@accord.test)`)).toBe(0);
  });
});
