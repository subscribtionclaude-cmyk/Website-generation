import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, KeyRound, Mail, Search, Pencil, UserX, UserCheck, Trash2, Wand2, Eye, EyeOff, Copy } from 'lucide-react';
import { supabase, callFunction, unwrap } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Modal, Field, Select, Segmented, Pager, ActionsMenu, Empty } from '../../components/ui';
import { ROLE_LABEL } from '../../lib/labels';
import { fmtDate, fmtDateTime, cairoToday } from '../../lib/cairo';
import { t, personName } from '../../lib/i18n';

interface U { id: string; email: string; full_name: string; role: string; active: boolean; created_at: string; must_change_password: boolean; deleted_at?: string | null }
type Status = 'current' | 'active' | 'inactive' | 'deleted';
const ROLE_OPTS: [string, string][] = [['admin', 'Admin'], ['bd_executive', 'BD Executive'], ['viewer', 'Viewer']];
const PAGE = 20;
const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

export default function AdminUsers() {
  const { profile } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [dlg, setDlg] = useState<null | 'new' | { edit: U } | { temp: U } | { status: U } | { del: U }>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<Status>('current'); const [page, setPage] = useState(0);
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: async () => unwrap(await supabase.from('profiles').select('*').order('created_at')) as U[] });
  // last sign-in comes from Supabase Auth via an admin-only RPC (migration 11); absent → column shows "—"
  const signins = useQuery({ queryKey: ['adminUserSignins'], queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_user_signins');
    if (error) return {} as Record<string, string | null>;
    return Object.fromEntries(((data ?? []) as { id: string; last_sign_in_at: string | null }[]).map((r) => [r.id, r.last_sign_in_at]));
  } });
  const targets = useQuery({ queryKey: ['currentTargets'], queryFn: async () => {
    const td = cairoToday();
    const { data, error } = await supabase.from('user_targets').select('user_id,daily_call_target').eq('active', true).lte('effective_from', td).or(`effective_to.is.null,effective_to.gte.${td}`);
    if (error) throw new Error(error.message); return Object.fromEntries((data ?? []).map((x) => [x.user_id, x.daily_call_target as number]));
  } });
  const refresh = () => { for (const k of [['adminUsers'], ['adminUserSignins'], ['profiles'], ['currentTargets'], ['adminTargets']]) qc.invalidateQueries({ queryKey: k }); };
  async function act(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast(t(ok), 'ok'); refresh(); } catch (e) { toast(t((e as Error).message), 'bad'); } }

  const all = users.data ?? [];
  const counts = { current: all.filter((u) => !u.deleted_at).length, deleted: all.filter((u) => u.deleted_at).length };
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => (status === 'deleted' ? Boolean(u.deleted_at) : !u.deleted_at && (status === 'current' || (status === 'active' ? u.active : !u.active))))
      .filter((u) => !s || u.email.toLowerCase().includes(s) || u.full_name.toLowerCase().includes(s) || (ROLE_LABEL[u.role] ?? '').toLowerCase().includes(s));
  }, [users.data, q, status]);
  const pageRows = list.slice(page * PAGE, (page + 1) * PAGE);
  const lastSeen = (id: string) => { const v = signins.data?.[id]; return v ? fmtDateTime(v) : <span className="muted">{t('Never')}</span>; };

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
                      <td><span className="badge stage">{ROLE_LABEL[u.role]}</span></td>
                      <td className="r num hide-sm">{u.role === 'bd_executive' && !u.deleted_at ? targets.data?.[u.id] ?? <span className="muted">{t('not set')}</span> : '—'}</td>
                      <td>{u.deleted_at ? <span className="badge bad" title={fmtDate(u.deleted_at)}>{t('Deleted')}</span>
                        : <><span className={`badge ${u.active ? 'ok' : 'warn'}`}>{u.active ? t('Active') : t('Deactivated')}</span>{u.must_change_password && <span className="badge warn"> {t('must change pw')}</span>}</>}</td>
                      <td className="hide-sm nowrap">{u.deleted_at ? <span className="muted">{t('Deleted {date}', { date: fmtDate(u.deleted_at) })}</span> : lastSeen(u.id)}</td>
                      <td className="r nowrap">
                        {!u.deleted_at && <ActionsMenu label={t('Actions for {email}', { email: u.email })} testId="user-actions" items={[
                          { key: 'edit', label: t('Edit user'), icon: <Pencil />, onSelect: () => setDlg({ edit: u }) },
                          { key: 'reset', label: t('Send password reset email'), icon: <Mail />, onSelect: () => act(() => callFunction('admin-users', { action: 'send_reset', user_id: u.id }), 'Reset email sent') },
                          { key: 'temp', label: t('Set temporary password'), icon: <KeyRound />, onSelect: () => setDlg({ temp: u }) },
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

function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false); const toast = useToast();
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
  const [mode, setMode] = useState<'invite' | 'temp'>('invite'); const [pw, setPw] = useState(''); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
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
        <Field label={t('Role')}><Select value={role} onChange={setRole} options={ROLE_OPTS} /></Field>
        {role === 'bd_executive' && <Field label={t('Daily call target')}><input type="number" min="0" max="2000" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>}</div>
      <div className="field"><label>{t('How should they get access?')}</label><div className="chips"><button className={`chip ${mode === 'invite' ? 'on' : ''}`} onClick={() => setMode('invite')}>{t('Email invitation (recommended)')}</button><button className={`chip ${mode === 'temp' ? 'on' : ''}`} onClick={() => setMode('temp')}>{t('Temporary password')}</button></div></div>
      {mode === 'temp' && <PasswordInput label={t('Temporary password (min 12 chars, mixed case + digit)')} value={pw} onChange={setPw} />}
      <span className="muted small">{mode === 'temp'
        ? t('The account is created directly on the server — no email is sent, so email limits do not apply. Give the password to the user securely; they must choose a new one at first sign-in.')
        : t('Passwords are sent over TLS to a server function, handed to Supabase Auth and never stored, logged or shown again. With a temporary password the user must choose a new one at first sign-in.')}</span>
    </Modal>
  );
}

function EditUser({ u, self, target, onClose }: { u: U; self: boolean; target?: number; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(u.full_name); const [role, setRole] = useState(u.role); const [tg, setT] = useState(target?.toString() ?? '');
  const [from, setFrom] = useState(cairoToday()); const [err, setErr] = useState<unknown>(null);
  async function save() {
    try {
      await callFunction('admin-users', { action: 'update', user_id: u.id, full_name: name, role, ...(role === 'bd_executive' && tg !== '' && Number(tg) !== target ? { daily_call_target: Number(tg), target_from: from } : {}) });
      toast(t('User updated'), 'ok'); onClose();
    } catch (e) { setErr(e); }
  }
  return (
    <Modal title={t('Edit {email}', { email: u.email })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Save')}</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid"><Field label={t('Full name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('Role')}><Select value={role} onChange={setRole} options={ROLE_OPTS} disabled={self} /></Field>
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
