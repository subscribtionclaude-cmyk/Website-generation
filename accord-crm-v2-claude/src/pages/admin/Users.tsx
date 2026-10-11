import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, KeyRound, Mail, MailCheck, SlidersHorizontal, Lock, RotateCcw, Search, Pencil, UserX, UserCheck, Trash2, Wand2, Eye, EyeOff, Copy } from 'lucide-react';
import { supabase, callFunction, unwrap } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Modal, Field, Select, Segmented, Pager, ActionsMenu, Empty } from '../../components/ui';
import { ROLE_LABEL } from '../../lib/labels';
import { fmtDate, fmtDateTime, cairoToday } from '../../lib/cairo';
import { t, personName } from '../../lib/i18n';
import { PERM_INFO, SECTION_LABEL, SECTION_ORDER } from '../../lib/permissionsMeta';
import { useCatalog } from './Roles';

interface U { id: string; email: string; full_name: string; role: string; active: boolean; created_at: string; must_change_password: boolean; deleted_at?: string | null }
type Status = 'current' | 'active' | 'inactive' | 'deleted';
const roleOpts = (): [string, string][] => (['admin', 'bd_executive', 'viewer'] as const).map((r) => [r, ROLE_LABEL[r]]);
const PAGE = 20;
const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

export default function AdminUsers() {
  const { profile } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [dlg, setDlg] = useState<null | 'new' | { edit: U } | { temp: U } | { status: U } | { del: U } | { perms: U }>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<Status>('current'); const [page, setPage] = useState(0);
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: async () => unwrap(await supabase.from('profiles').select('*').order('created_at')) as U[] });
  // email confirmation + last sign-in come from Supabase Auth via the admin-only Edge Function; unavailable → "—"
  const auth = useQuery({ queryKey: ['adminUserAuth'], queryFn: async () => {
    try {
      const r = await callFunction<{ users: { id: string; confirmed: boolean; last_sign_in_at: string | null }[] }>('admin-users', { action: 'auth_status' });
      return Object.fromEntries(r.users.map((x) => [x.id, x]));
    } catch { return {} as Record<string, { id: string; confirmed: boolean; last_sign_in_at: string | null }>; }
  } });
  const targets = useQuery({ queryKey: ['currentTargets'], queryFn: async () => {
    const td = cairoToday();
    const { data, error } = await supabase.from('user_targets').select('user_id,daily_call_target').eq('active', true).lte('effective_from', td).or(`effective_to.is.null,effective_to.gte.${td}`);
    if (error) throw new Error(error.message); return Object.fromEntries((data ?? []).map((x) => [x.user_id, x.daily_call_target as number]));
  } });
  // users whose access differs from their role template (explicit per-user overrides)
  const overrides = useQuery({ queryKey: ['userOverrides'], queryFn: async () => {
    const { data, error } = await supabase.from('user_permission_overrides').select('user_id');
    if (error) return {} as Record<string, number>;
    const m: Record<string, number> = {}; for (const r of (data ?? []) as { user_id: string }[]) m[r.user_id] = (m[r.user_id] ?? 0) + 1; return m;
  } });
  const refresh = () => { for (const k of [['adminUsers'], ['adminUserAuth'], ['profiles'], ['currentTargets'], ['adminTargets'], ['userOverrides'], ['perms']]) qc.invalidateQueries({ queryKey: k }); };
  async function act(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast(t(ok), 'ok'); refresh(); } catch (e) { toast(t((e as Error).message), 'bad'); } }

  const all = users.data ?? [];
  const counts = { current: all.filter((u) => !u.deleted_at).length, deleted: all.filter((u) => u.deleted_at).length };
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => (status === 'deleted' ? Boolean(u.deleted_at) : !u.deleted_at && (status === 'current' || (status === 'active' ? u.active : !u.active))))
      .filter((u) => !s || u.email.toLowerCase().includes(s) || u.full_name.toLowerCase().includes(s) || (ROLE_LABEL[u.role] ?? '').toLowerCase().includes(s));
  }, [users.data, q, status]);
  const pageRows = list.slice(page * PAGE, (page + 1) * PAGE);
  const lastSeen = (id: string) => { const v = auth.data?.[id]?.last_sign_in_at; return v ? fmtDateTime(v) : <span className="muted">{t('Never')}</span>; };
  const unconfirmed = (id: string) => auth.data?.[id]?.confirmed === false;

  return (
    <>
      <PageHead title={t('Users & access')} sub={t('Public sign-up is disabled — access exists only for people listed here.')}
        actions={<button className="btn primary" onClick={() => setDlg('new')}><UserPlus /> {t('Add user')}</button>} />
      <div className="card filters col" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="grow search"><Search /><input type="search" aria-label={t('Search users')} placeholder={t('Search name, email or role…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
          <Segmented<Status> label={t('Status')} value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[
            { key: 'current', label: <>{t('All')} <span className="muted num">{counts.current}</span></> },
            { key: 'active', label: t('Active') }, { key: 'inactive', label: t('Deactivated') },
            { key: 'deleted', label: <>{t('Deleted')} <span className="muted num">{counts.deleted}</span></> }]} />
        </div>
      </div>
      <ErrorNote error={users.error} />
      <div className="card">
        {users.isLoading ? <Loading /> : list.length === 0 ? <Empty icon={<Search />}>{t('No users match.')}</Empty> : (
          <>
            <div className="table-wrap">
              <table className="t" aria-label={t('Users')}><thead><tr><th>{t('Name')}</th><th className="hide-sm">{t('Email')}</th><th>{t('Role')}</th><th className="r hide-sm">{t('Daily target')}</th><th>{t('Status')}</th><th className="hide-sm">{t('Last sign-in')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead><tbody>
                {pageRows.map((u) => {
                  const self = u.id === profile!.id;
                  return (
                    <tr key={u.id} data-testid="user-row">
                      <td><b>{personName(u.full_name) || '—'}</b>{self && <span className="badge info"> {t('you')}</span>}<div className="muted small show-sm">{u.email}</div></td>
                      <td className="hide-sm">{u.email}</td>
                      <td><span className="badge stage">{ROLE_LABEL[u.role]}</span>{!u.deleted_at && overrides.data?.[u.id] ? <span className="badge info" data-testid="badge-overrides" title={t('{n} permission overrides', { n: overrides.data[u.id] })}> {t('Custom access')}</span> : null}</td>
                      <td className="r num hide-sm">{u.role === 'bd_executive' && !u.deleted_at ? targets.data?.[u.id] ?? <span className="muted">{t('not set')}</span> : '—'}</td>
                      <td>{u.deleted_at ? <span className="badge bad" title={fmtDate(u.deleted_at)}>{t('Deleted')}</span>
                        : <><span className={`badge ${u.active ? 'ok' : 'warn'}`}>{u.active ? t('Active') : t('Deactivated')}</span>{u.must_change_password && <span className="badge warn"> {t('must change pw')}</span>}{unconfirmed(u.id) && <span className="badge warn" data-testid="badge-unconfirmed"> {t('Email not confirmed')}</span>}</>}</td>
                      <td className="hide-sm nowrap">{u.deleted_at ? <span className="muted">{t('Deleted {date}', { date: fmtDate(u.deleted_at) })}</span> : lastSeen(u.id)}</td>
                      <td className="r nowrap">
                        {!u.deleted_at && <ActionsMenu label={t('Actions for {email}', { email: u.email })} testId="user-actions" items={[
                          { key: 'edit', label: t('Edit user'), icon: <Pencil />, onSelect: () => setDlg({ edit: u }) },
                          u.role !== 'admin' && { key: 'perms', label: t('Manage permissions'), icon: <SlidersHorizontal />, onSelect: () => setDlg({ perms: u }) },
                          { key: 'reset', label: t('Send password reset email'), icon: <Mail />, onSelect: () => act(() => callFunction('admin-users', { action: 'send_reset', user_id: u.id }), 'Reset email sent') },
                          { key: 'temp', label: t('Set temporary password'), icon: <KeyRound />, onSelect: () => setDlg({ temp: u }) },
                          unconfirmed(u.id) && { key: 'confirm', label: t('Confirm email'), icon: <MailCheck />, onSelect: () => act(() => callFunction('admin-users', { action: 'confirm_email', user_id: u.id }), 'Email confirmed — the user can sign in now') },
                          !self && { key: 'status', label: u.active ? t('Deactivate') : t('Reactivate'), icon: u.active ? <UserX /> : <UserCheck />, onSelect: () => setDlg({ status: u }) },
                          !self && { key: 'delete', label: t('Delete user'), icon: <Trash2 />, danger: true, onSelect: () => setDlg({ del: u }) },
                        ]} />}
                      </td>
                    </tr>);
                })}
              </tbody></table>
            </div>
            {list.length > PAGE && <Pager page={page} pageSize={PAGE} total={list.length} onPage={setPage} />}
          </>)}
      </div>
      {dlg === 'new' && <NewUser onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'edit' in dlg && <EditUser u={dlg.edit} self={dlg.edit.id === profile!.id} target={targets.data?.[dlg.edit.id]} onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'temp' in dlg && <TempPw u={dlg.temp} onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'status' in dlg && <StatusUser u={dlg.status} onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'del' in dlg && <DeleteUser u={dlg.del} onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'perms' in dlg && <ManagePermissions u={dlg.perms} onClose={() => { setDlg(null); refresh(); }} />}
    </>
  );
}

/** Strong random temporary password (16 chars, upper + lower + digit + symbol), generated in the browser. */
function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '-_.!@#%'];
  const all = sets.join(''); const r = new Uint32Array(16); crypto.getRandomValues(r);
  const chars = Array.from(r, (n, i) => (i < sets.length ? sets[i][n % sets[i].length] : all[n % all.length]));
  const s = new Uint32Array(chars.length); crypto.getRandomValues(s);
  for (let i = chars.length - 1; i > 0; i--) { const j = s[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

function PasswordInput({ label, value, onChange, initialShow }: { label: string; value: string; onChange: (v: string) => void; initialShow?: boolean }) {
  const [show, setShow] = useState(Boolean(initialShow)); const toast = useToast();
  return (
    <Field label={label} full>
      <div className="row nowrap">
        <input className="grow" type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        <button type="button" className="btn sm ghost icon" aria-label={show ? t('Hide password') : t('Show password')} title={show ? t('Hide password') : t('Show password')} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>
        <button type="button" className="btn sm" onClick={() => { onChange(generatePassword()); setShow(true); }}><Wand2 /> {t('Generate')}</button>
        {value && <button type="button" className="btn sm ghost icon" aria-label={t('Copy password')} title={t('Copy password')} onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast(t('Password copied'), 'ok'), () => {}); }}><Copy /></button>}
      </div>
    </Field>
  );
}

function NewUser({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [role, setRole] = useState('bd_executive'); const [target, setTarget] = useState('100');
  // recommended: temporary password — the account is confirmed at creation and can sign in immediately (no email)
  const [mode, setMode] = useState<'invite' | 'temp'>('temp'); const [pw, setPw] = useState(() => generatePassword()); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return; // one request at a time: a double click can never create two accounts
    setErr(null); setBusy(true);
    try {
      await callFunction('admin-users', { action: 'create', email, full_name: name, role, daily_call_target: role === 'bd_executive' && target !== '' ? Number(target) : null, temporary_password: mode === 'temp' ? pw : undefined });
      toast(mode === 'invite' ? t('Invitation email sent') : t('User created — they must change the password at first sign-in'), 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const rateLimited = codeOf(err) === 'email_rate_limit';
  return (
    <Modal title={t('Add user')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{mode === 'invite' ? t('Send invitation') : t('Create user')}</button></>}>
      {rateLimited ? (
        <div className="notice warn" role="alert" data-testid="invite-rate-limit">
          <b>{t('Invitation email limit reached. Try again later, use Temporary Password, or configure Custom SMTP.')}</b>
          <div className="small" style={{ marginTop: 4 }}>{t('This is a temporary limit on how many emails the email provider sends per hour — not a limit on the number of CRM users. No account was created, so retrying is safe.')}</div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setMode('temp'); setErr(null); }}><KeyRound /> {t('Use temporary password instead')}</button>
        </div>
      ) : <ErrorNote error={err} />}
      <div className="form-grid"><Field label={t('Email')}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label={t('Full name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('Role')}><Select value={role} onChange={setRole} options={roleOpts()} /></Field>
        {role === 'bd_executive' && <Field label={t('Daily call target')}><input type="number" min="0" max="2000" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>}</div>
      <div className="field"><label>{t('How should they get access?')}</label><div className="chips"><button className={`chip ${mode === 'temp' ? 'on' : ''}`} onClick={() => setMode('temp')}>{t('Temporary password (recommended)')}</button><button className={`chip ${mode === 'invite' ? 'on' : ''}`} onClick={() => setMode('invite')}>{t('Email invitation (optional)')}</button></div></div>
      {mode === 'temp' && <PasswordInput label={t('Temporary password (min 12 chars, mixed case + digit)')} value={pw} onChange={setPw} initialShow />}
      <span className="muted small">{mode === 'temp'
        ? t('The account is created on the server with its email already confirmed — no email is sent, so email limits do not apply, and the user can sign in immediately. Give them the password securely; they must choose a new one at first sign-in.')
        : t('An invitation email is sent; the user can only sign in after opening it. Supabase limits how many emails it sends per hour — use a temporary password if access is needed now.')}</span>
    </Modal>
  );
}

function EditUser({ u, self, target, onClose }: { u: U; self: boolean; target?: number; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(u.full_name); const [role, setRole] = useState(u.role); const [tg, setT] = useState(target?.toString() ?? '');
  const [from, setFrom] = useState(cairoToday()); const [err, setErr] = useState<unknown>(null);
  // a role change is confirmed only after the admin has seen what access is gained / lost (going forward only)
  const [diff, setDiff] = useState<null | { gained: string[]; lost: string[] }>(null);
  const roleChanged = role !== u.role;
  async function save() {
    try {
      if (roleChanged && !diff) {
        const [a, b] = await Promise.all([u.role, role].map(async (r) => unwrap(await supabase.rpc('role_template', { p_role: r })) as unknown as Record<string, boolean>));
        const keys = Object.keys(PERM_INFO);
        setDiff({ gained: keys.filter((k) => !a[k] && b[k]), lost: keys.filter((k) => a[k] && !b[k]) });
        return;
      }
      await callFunction('admin-users', { action: 'update', user_id: u.id, full_name: name, role, ...(role === 'bd_executive' && tg !== '' && Number(tg) !== target ? { daily_call_target: Number(tg), target_from: from } : {}) });
      toast(t('User updated'), 'ok'); onClose();
    } catch (e) { setErr(e); }
  }
  return (
    <Modal title={t('Edit {email}', { email: u.email })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} data-testid="edit-user-save">{roleChanged && diff ? t('Confirm role change') : t('Save')}</button></>}>
      <ErrorNote error={err} />
      {roleChanged && diff && (
        <div className="notice warn col" role="note" data-testid="role-change-summary">
          <b>{t('Changing role from {a} to {b}', { a: ROLE_LABEL[u.role], b: ROLE_LABEL[role] })}</b>
          <div className="small"><b>{t('Access gained')}:</b> {diff.gained.length ? diff.gained.map((k) => t(PERM_INFO[k].label)).join(' · ') : t('none')}</div>
          <div className="small"><b>{t('Access lost')}:</b> {diff.lost.length ? diff.lost.map((k) => t(PERM_INFO[k].label)).join(' · ') : t('none')}</div>
          <span className="muted small">{t('Applies from now on. Historical records are not changed.')}</span>
        </div>)}
      <div className="form-grid"><Field label={t('Full name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('Role')}><Select value={role} onChange={(v) => { setRole(v as U['role']); setDiff(null); }} options={roleOpts()} disabled={self} /></Field>
        {role === 'bd_executive' && <><Field label={t('Daily call target')}><input type="number" min="0" max="2000" value={tg} onChange={(e) => setT(e.target.value)} /></Field><Field label={t('Effective from')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></>}</div>
      {self && <span className="muted small">{t('You cannot change your own role here.')}</span>}
    </Modal>
  );
}

function TempPw({ u, onClose }: { u: U; onClose: () => void }) {
  const toast = useToast(); const [pw, setPw] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function save() { try { await callFunction('admin-users', { action: 'set_temp_password', user_id: u.id, password: pw }); toast(t('Temporary password set — user must change it at next sign-in'), 'ok'); onClose(); } catch (e) { setErr(e); } }
  return (
    <Modal narrow title={t('Temporary password · {email}', { email: u.email })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Set password')}</button></>}>
      <ErrorNote error={err} />
      <PasswordInput label={t('New temporary password')} value={pw} onChange={setPw} />
      <span className="muted small">{t('Prefer "send reset email" where possible. Existing passwords can never be displayed.')}</span>
    </Modal>
  );
}

function UserFacts({ u }: { u: U }) {
  return (
    <dl className="facts">
      <dt>{t('Name')}</dt><dd>{personName(u.full_name) || '—'}</dd>
      <dt>{t('Email')}</dt><dd>{u.email}</dd>
      <dt>{t('Role')}</dt><dd>{ROLE_LABEL[u.role]}</dd>
    </dl>
  );
}

function StatusUser({ u, onClose }: { u: U; onClose: () => void }) {
  const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const deactivate = u.active;
  async function save() {
    setBusy(true); setErr(null);
    try { await callFunction('admin-users', { action: 'update', user_id: u.id, active: !u.active }); toast(deactivate ? t('User deactivated') : t('User reactivated'), 'ok'); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal narrow title={deactivate ? t('Deactivate user') : t('Reactivate user')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className={`btn ${deactivate ? 'bad' : 'primary'}`} disabled={busy} onClick={save} data-testid="confirm-status">{deactivate ? t('Deactivate') : t('Reactivate')}</button></>}>
      <ErrorNote error={err} />
      <UserFacts u={u} />
      <p className="small">{deactivate
        ? t('Deactivating blocks sign-in and all CRM access immediately. The account and its history stay, and you can reactivate it at any time.')
        : t('Reactivating restores sign-in and CRM access with the same role. The user signs in with their existing password.')}</p>
    </Modal>
  );
}

function DeleteUser({ u, onClose }: { u: U; onClose: () => void }) {
  const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [typed, setTyped] = useState('');
  const ok = typed.trim().toLowerCase() === u.email.toLowerCase();
  async function del() {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try { await callFunction('admin-users', { action: 'delete', user_id: u.id }); toast(t('User deleted — their CRM history is preserved'), 'ok'); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal narrow title={t('Delete user permanently')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn bad" disabled={!ok || busy} onClick={del} data-testid="confirm-delete"><Trash2 /> {t('Delete user permanently')}</button></>}>
      <ErrorNote error={err} />
      <UserFacts u={u} />
      <div className="notice bad" role="note">
        <b>{t('Deleting this user permanently removes their login access. Historical CRM activity will be preserved.')}</b>
        <div className="small" style={{ marginTop: 4 }}>{t('Their calls, meetings, follow-ups, proposals, targets and audit entries stay and keep showing their name, marked "(Deleted user)". This cannot be undone — to block access temporarily, use Deactivate instead.')}</div>
      </div>
      <Field label={t('Type the email address {email} to confirm', { email: u.email })} full>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-testid="delete-confirm-input" onKeyDown={(e) => { if (e.key === 'Enter') void del(); }} />
      </Field>
    </Modal>
  );
}

/** Per-user overrides on top of the role template: inherited value, override, effective result. */
function ManagePermissions({ u, onClose }: { u: U; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const cat = useCatalog();
  const rows = useQuery({ queryKey: ['userPerms', u.id], queryFn: async () => unwrap(await supabase.rpc('user_effective_permissions', { p_user: u.id })) as unknown as { perm: string; inherited: boolean; override: boolean | null; effective: boolean; configurable: boolean }[] });
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setErr(null);
    try { const { error } = await fn(); if (error) throw new Error(error.message); await Promise.all([qc.invalidateQueries({ queryKey: ['userPerms', u.id] }), qc.invalidateQueries({ queryKey: ['userOverrides'] })]); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const byPerm = Object.fromEntries((rows.data ?? []).map((r) => [r.perm, r]));
  const nOver = (rows.data ?? []).filter((r) => r.override !== null).length;
  return (
    <Modal wide title={t('Permissions · {name}', { name: personName(u.full_name) || u.email })} onClose={onClose}
      footer={<><button className="btn" disabled={busy || nOver === 0} onClick={() => run(() => supabase.rpc('admin_reset_user_overrides', { p_user: u.id })).then(() => toast(t('Reset to role defaults'), 'ok'))} data-testid="reset-overrides"><RotateCcw /> {t('Reset to role defaults')}</button><button className="btn primary" onClick={onClose}>{t('Done')}</button></>}>
      <ErrorNote error={err} />
      <div className="notice small">{t('Role: {role}. The role template applies unless you set an explicit override. Overrides marked here differ from the role default.', { role: ROLE_LABEL[u.role] })} {nOver > 0 && <b>{t('{n} overrides', { n: nOver })}</b>}</div>
      {(!rows.data || !cat.data) ? <Loading /> : SECTION_ORDER.map((sec) => {
        const list = cat.data!.filter((c) => c.section === sec && byPerm[c.perm]);
        if (!list.length) return null;
        return (
          <section key={sec} className="col" style={{ gap: 0 }}>
            <h3 style={{ marginTop: 10 }}>{t(SECTION_LABEL[sec])}</h3>
            {list.map((c) => { const r = byPerm[c.perm]; return (
              <div key={c.perm} className="perm-row" data-testid={`uperm-${c.perm}`}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b>{t(PERM_INFO[c.perm]?.label ?? c.perm)}</b>{r.override !== null && <span className="badge info"> {t('Override')}</span>}
                  <div className="muted small">{t('Role default')}: {r.inherited ? t('Allowed') : t('Denied')} · {t('Effective')}: <b>{r.effective ? t('Allowed') : t('Denied')}</b></div>
                </div>
                {r.configurable ? (
                  <span className="perm-tri" role="radiogroup" aria-label={t(PERM_INFO[c.perm]?.label ?? c.perm)}>
                    {([[null, 'Role default'], [true, 'Allow'], [false, 'Deny']] as const).map(([v, l]) => (
                      <button key={String(v)} type="button" role="radio" aria-checked={r.override === v} className={r.override === v ? 'on' : ''} disabled={busy}
                        onClick={() => run(() => supabase.rpc('admin_set_user_override', { p_user: u.id, p_perm: c.perm, p_allowed: v }))}>{t(l)}</button>))}
                  </span>) : <span className="badge"><Lock size={12} /> {r.effective ? t('Always') : t('Not available')}</span>}
              </div>); })}
          </section>);
      })}
    </Modal>
  );
}
