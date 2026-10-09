import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, KeyRound, Mail } from 'lucide-react';
import { supabase, callFunction, unwrap } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Modal, Field, Select } from '../../components/ui';
import { ROLE_LABEL } from '../../lib/labels';
import { fmtDate, cairoToday } from '../../lib/cairo';
import { t } from '../../lib/i18n';

interface U { id: string; email: string; full_name: string; role: string; active: boolean; created_at: string; must_change_password: boolean }
const ROLE_OPTS: [string, string][] = [['admin', 'Admin'], ['bd_executive', 'BD Executive'], ['viewer', 'Viewer']];

export default function AdminUsers() {
  const { profile } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [dlg, setDlg] = useState<null | 'new' | { edit: U } | { temp: U }>(null);
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: async () => unwrap(await supabase.from('profiles').select('*').order('created_at')) as U[] });
  const targets = useQuery({ queryKey: ['currentTargets'], queryFn: async () => {
    const t = cairoToday();
    const { data, error } = await supabase.from('user_targets').select('user_id,daily_call_target').eq('active', true).lte('effective_from', t).or(`effective_to.is.null,effective_to.gte.${t}`);
    if (error) throw new Error(error.message); return Object.fromEntries((data ?? []).map((x) => [x.user_id, x.daily_call_target as number]));
  } });
  const refresh = () => { for (const k of [['adminUsers'], ['profiles'], ['currentTargets'], ['adminTargets']]) qc.invalidateQueries({ queryKey: k }); };
  async function act(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast(ok, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } }

  return (
    <>
      <PageHead title={t('Users & access')} sub={t('Public sign-up is disabled — access exists only for people listed here.')} actions={<button className="btn primary" onClick={() => setDlg('new')}><UserPlus /> {t('Add user')}</button>} />
      <ErrorNote error={users.error} />
      <div className="card table-wrap">
        {users.isLoading ? <Loading /> : (
          <table className="t" aria-label={t('Users')}><thead><tr><th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Role')}</th><th className="r">{t('Daily target')}</th><th>{t('Status')}</th><th>{t('Added')}</th><th /></tr></thead><tbody>
            {users.data?.map((u) => (
              <tr key={u.id}><td><b>{u.full_name || '—'}</b>{u.id === profile!.id && <span className="badge info"> {t('you')}</span>}</td><td>{u.email}</td>
                <td><span className="badge stage">{ROLE_LABEL[u.role]}</span></td><td className="r num">{u.role === 'bd_executive' ? targets.data?.[u.id] ?? <span className="muted">{t('not set')}</span> : '—'}</td>
                <td><span className={`badge ${u.active ? 'ok' : 'bad'}`}>{u.active ? 'Active' : 'Deactivated'}</span>{u.must_change_password && <span className="badge warn"> {t('must change pw')}</span>}</td><td>{fmtDate(u.created_at)}</td>
                <td className="r nowrap">
                  <button className="btn sm" onClick={() => setDlg({ edit: u })}>{t('Edit')}</button>
                  <button className="btn sm ghost" title={t('Send password reset email')} onClick={() => act(() => callFunction('admin-users', { action: 'send_reset', user_id: u.id }), 'Reset email sent')}><Mail /></button>
                  <button className="btn sm ghost" title={t('Set temporary password')} onClick={() => setDlg({ temp: u })}><KeyRound /></button>
                  {u.id !== profile!.id && <button className={`btn sm ${u.active ? 'bad' : 'ok'}`} onClick={() => { if (!u.active || confirm(`Deactivate ${u.email}? They are blocked immediately.`)) act(() => callFunction('admin-users', { action: 'update', user_id: u.id, active: !u.active }), u.active ? 'User deactivated' : 'User reactivated'); }}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
                </td></tr>))}
          </tbody></table>)}
      </div>
      {dlg === 'new' && <NewUser onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'edit' in dlg && <EditUser u={dlg.edit} self={dlg.edit.id === profile!.id} target={targets.data?.[dlg.edit.id]} onClose={() => { setDlg(null); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'temp' in dlg && <TempPw u={dlg.temp} onClose={() => setDlg(null)} />}
    </>
  );
}

function NewUser({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [role, setRole] = useState('bd_executive'); const [target, setTarget] = useState('100');
  const [mode, setMode] = useState<'invite' | 'temp'>('invite'); const [pw, setPw] = useState(''); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setErr(null); setBusy(true);
    try {
      await callFunction('admin-users', { action: 'create', email, full_name: name, role, daily_call_target: role === 'bd_executive' && target !== '' ? Number(target) : null, temporary_password: mode === 'temp' ? pw : undefined });
      toast(mode === 'invite' ? 'Invitation email sent' : 'User created — they must change the password at first sign-in', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('Add user')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{mode === 'invite' ? 'Send invitation' : 'Create user'}</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid"><Field label={t('Email')}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label={t('Full name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('Role')}><Select value={role} onChange={setRole} options={ROLE_OPTS} /></Field>
        {role === 'bd_executive' && <Field label={t('Daily call target')}><input type="number" min="0" max="2000" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>}</div>
      <div className="field"><label>How should they get access?</label><div className="chips"><button className={`chip ${mode === 'invite' ? 'on' : ''}`} onClick={() => setMode('invite')}>{t('Email invitation (recommended)')}</button><button className={`chip ${mode === 'temp' ? 'on' : ''}`} onClick={() => setMode('temp')}>{t('Temporary password')}</button></div></div>
      {mode === 'temp' && <Field label={t('Temporary password (min 12 chars, mixed case + digit)')}><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
      <span className="muted small">{t('Passwords are sent over TLS to a server function, handed to Supabase Auth and never stored, logged or shown again. With a temporary password the user must choose a new one at first sign-in.')}</span>
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
      toast('User updated', 'ok'); onClose();
    } catch (e) { setErr(e); }
  }
  return (
    <Modal title={`Edit ${u.email}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Save')}</button></>}>
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
  async function save() { try { await callFunction('admin-users', { action: 'set_temp_password', user_id: u.id, password: pw }); toast('Temporary password set — user must change it at next sign-in', 'ok'); onClose(); } catch (e) { setErr(e); } }
  return (
    <Modal narrow title={`Temporary password · ${u.email}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Set password')}</button></>}>
      <ErrorNote error={err} />
      <Field label={t('New temporary password')}><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <span className="muted small">{t('Prefer "send reset email" where possible. Existing passwords can never be displayed.')}</span>
    </Modal>
  );
}
