import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { usePreviewRole } from './preview';
import { setTerminology } from './terminology';

// Effective permissions for the UI. ONE request per user (my_permissions) — the database computes the same answer it
// enforces in RLS / RPCs, so the UI only mirrors the security boundary, it never is one.
// During an admin "Preview as role" the role TEMPLATE is used instead (role_template), so navigation and dashboards
// look exactly like that role's — while the identity and every server check stay the admin's.
export interface PermState { loading: boolean; perms: Record<string, boolean>; overrides: string[]; can: (p: string) => boolean }

const RAW = ['raw.leads', 'raw.calls', 'raw.meetings', 'raw.followups', 'raw.proposals'];
function legacyPerms(role?: string): Record<string, boolean> {
  const m: Record<string, boolean> = Object.fromEntries(RAW.map((p) => [p, Boolean(role)]));
  if (role === 'bd_executive' || role === 'admin') m['export.datasets'] = true;
  if (role === 'admin') m['export.full'] = true; // the management pages need migration 12's management_report — hidden until then
  return m;
}

export function usePerms(): PermState {
  const { profile, realAdmin } = useAuth();
  const preview = usePreviewRole();
  const usePreview = Boolean(realAdmin && preview);
  const q = useQuery({
    queryKey: ['perms', profile?.id, usePreview ? preview : null],
    enabled: Boolean(profile?.active),
    staleTime: 60_000,
    queryFn: async () => {
      if (usePreview) {
        const { data, error } = await supabase.rpc('role_template', { p_role: preview });
        if (error) throw new Error(error.message);
        return { perms: (data ?? {}) as Record<string, boolean>, overrides: [] as string[] };
      }
      const { data, error } = await supabase.rpc('my_permissions');
      // backend not yet on migration 12 (function missing): keep the pre-V6 behaviour by role so nothing breaks
      if (error && /PGRST202|Could not find the function/.test(`${error.code} ${error.message}`)) return { perms: legacyPerms(profile?.role), overrides: [] as string[] };
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as { perms?: Record<string, boolean>; overrides?: string[] };
      return { perms: d.perms ?? {}, overrides: d.overrides ?? [] };
    },
  });
  const perms = q.data?.perms ?? {};
  return { loading: q.isLoading, perms, overrides: q.data?.overrides ?? [], can: (p) => perms[p] === true }; // unknown → deny
}

/** Loads the admin-defined display labels once per session (members can read settings). */
export function TerminologySync() {
  const { session, profile } = useAuth();
  const q = useQuery({
    queryKey: ['terminology'], enabled: Boolean(session && profile?.active), staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'terminology').maybeSingle();
      if (error) return {};
      return (data?.value ?? {}) as Record<string, { en?: string; ar?: string }>;
    },
  });
  useEffect(() => { setTerminology(q.data ?? {}); }, [q.data]);
  return null;
}
