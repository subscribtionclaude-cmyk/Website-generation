import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Layout';
import { ErrorNote, Loading } from '../components/ui';

export function LoginPage() {
  const { session, loading, signIn, noAccess, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/dashboard/';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  if (loading) return <Loading />;
  if (session && !noAccess) return <Navigate to={from} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await signIn(email, password); nav(from, { replace: true }); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  async function forgot() {
    setErr(null); setInfo('');
    if (!email.trim()) { setErr(new Error('Enter your email first')); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password/` });
    // identical message either way: never reveal whether an account exists
    if (error && error.status && error.status >= 500) setErr(new Error('Could not send the email right now'));
    else setInfo('If that email has CRM access, a reset link is on its way.');
  }
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <Logo dark={false} />
        <h2 style={{ textAlign: 'center' }}>Sign in to ACCORD CRM</h2>
        {noAccess && <div className="notice bad">This account has no active CRM access. Ask an administrator. <button type="button" className="btn sm" onClick={() => signOut()}>Sign out</button></div>}
        <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <ErrorNote error={err} />
        {info && <div className="notice ok">{info}</div>}
        <button className="btn primary lg" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="btn ghost" type="button" onClick={forgot}>Forgot password?</button>
      </form>
    </div>
  );
}

/** Landing page for invitation + password-reset links, and for forced password change. */
export function SetPasswordPage() {
  const { session, loading, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);
  if (loading || (!session && !waited)) return <Loading />;
  if (!session) return <Navigate to="/login/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (pw.length < 12) { setErr(new Error('Use at least 12 characters')); return; }
    if (pw !== pw2) { setErr(new Error('Passwords do not match')); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      await supabase.rpc('clear_must_change_password');
      await refreshProfile();
      nav('/dashboard/', { replace: true });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <Logo dark={false} />
        <h2 style={{ textAlign: 'center' }}>{profile?.must_change_password ? 'Choose a new password' : 'Set your password'}</h2>
        <div className="field"><label htmlFor="n1">New password</label><input id="n1" type="password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label htmlFor="n2">Repeat password</label><input id="n2" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        <span className="muted small">At least 12 characters.</span>
        <ErrorNote error={err} />
        <button className="btn primary lg" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  );
}

export function NoAccessPage() {
  const { signOut, session } = useAuth();
  return (
    <div className="auth-wrap"><div className="card auth-card">
      <Logo dark={false} />
      <h2 style={{ textAlign: 'center' }}>No CRM access</h2>
      <p className="muted" style={{ textAlign: 'center' }}>{session?.user.email} is signed in but has no active ACCORD CRM profile. Please ask an administrator to grant access.</p>
      <button className="btn primary" onClick={() => signOut()}>Sign out</button>
    </div></div>
  );
}
