import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Profile {
  id: string; email: string; full_name: string; phone: string | null;
  role: 'admin' | 'bd_executive' | 'viewer'; active: boolean; must_change_password: boolean;
}
interface AuthState {
  loading: boolean; session: Session | null; profile: Profile | null; noAccess: boolean;
  isAdmin: boolean; isStaff: boolean; // isStaff = may write (admin or BD executive)
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
/** Safe, translatable sign-in error (never the raw Supabase text). A deleted account and a wrong password look the
 *  same on purpose, so the form does not reveal which emails exist. */
export function signInMessage(error: { code?: string; status?: number; message?: string }): string {
  const code = error.code ?? ''; const msg = (error.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Incorrect email or password';
  if (code === 'user_banned' || msg.includes('banned')) return 'This account is inactive. Please contact an ACCORD administrator.';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'This account is not activated yet. Please ask an ACCORD administrator to confirm it.';
  if (code === 'signup_disabled' || code === 'user_not_found') return 'This account is not permitted to access ACCORD CRM.';
  if (error.status === 429 || code.startsWith('over_') || msg.includes('rate limit')) return 'Too many sign-in attempts. Please wait a minute and try again.';
  if (!error.status || error.status >= 500 || msg.includes('fetch')) return 'Backend unavailable — please try again shortly';
  return 'Sign-in failed. Please try again.';
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = (): AuthState => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('id,email,full_name,phone,role,active,must_change_password').eq('id', s.user.id).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      // defer to avoid deadlocking inside the auth callback
      setTimeout(() => { loadProfile(s); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    loading, session, profile,
    noAccess: Boolean(session) && !loading && (!profile || !profile.active),
    isAdmin: profile?.active === true && profile.role === 'admin',
    isStaff: profile?.active === true && (profile.role === 'admin' || profile.role === 'bd_executive'),
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(signInMessage(error));
    },
    signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
    refreshProfile: async () => { const { data } = await supabase.auth.getSession(); await loadProfile(data.session); },
  }), [loading, session, profile, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
