import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PageHead, Field, ErrorNote } from '../components/ui';
import { ROLE_LABEL } from '../lib/labels';

export default function SettingsPage() {
  const { profile, refreshProfile, signOut } = useAuth(); const toast = useToast();
  const [name, setName] = useState(profile!.full_name); const [phone, setPhone] = useState(profile!.phone ?? '');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function saveProfile() {
    const { error } = await supabase.rpc('update_my_profile', { p_full_name: name, p_phone: phone || null });
    if (error) toast(error.message, 'bad'); else { await refreshProfile(); toast('Profile saved', 'ok'); }
  }
  async function changePw() {
    setErr(null);
    if (pw.length < 12) { setErr(new Error('Use at least 12 characters')); return; }
    if (pw !== pw2) { setErr(new Error('Passwords do not match')); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setErr(error); else { setPw(''); setPw2(''); toast('Password changed', 'ok'); }
  }
  return (
    <>
      <PageHead title="Profile & settings" />
      <div className="grid cols-2">
        <div className="card card-pad col">
          <h2>Profile</h2>
          <dl className="kv"><dt>Email</dt><dd>{profile!.email}</dd><dt>Role</dt><dd>{ROLE_LABEL[profile!.role]}</dd></dl>
          <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
          <div><button className="btn primary" onClick={saveProfile}>Save</button></div>
        </div>
        <div className="card card-pad col">
          <h2>Change password</h2>
          <Field label="New password"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repeat"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <ErrorNote error={err} />
          <div className="row"><button className="btn primary" onClick={changePw}>Change password</button><button className="btn" onClick={() => signOut()}>Sign out</button></div>
          <span className="muted small">Passwords are handled by Supabase Auth and are never stored by this app.</span>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>ACCORD CRM V2 · Africa/Cairo · installable on iPad / iPhone via Share → Add to Home Screen.</p>
    </>
  );
}
