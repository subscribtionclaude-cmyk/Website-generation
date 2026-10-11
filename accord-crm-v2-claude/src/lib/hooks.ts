import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from './supabase';
import { cairoToday } from './cairo';
import type { CallMetrics } from './metrics';
import { useAuth } from './auth';

/** Re-renders when the Cairo calendar day changes, so "today" metrics reset to zero at Cairo midnight. */
export function useCairoToday(): string {
  const [d, setD] = useState(cairoToday());
  useEffect(() => {
    const t = setInterval(() => { const n = cairoToday(); setD((p) => (p === n ? p : n)); }, 20_000);
    return () => clearInterval(t);
  }, []);
  return d;
}

export function useMyCallMetrics(date?: string) {
  const today = useCairoToday();
  const d = date ?? today;
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['callMetrics', profile?.id, d],
    enabled: Boolean(profile),
    refetchInterval: 60_000,
    queryFn: async (): Promise<CallMetrics> => {
      const res = await supabase.rpc('my_call_metrics', { p_date: d });
      return unwrap(res) as unknown as CallMetrics;
    },
  });
}

export function useRangeMetrics(from: string, to: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['callMetricsRange', profile?.id, from, to],
    enabled: Boolean(profile),
    queryFn: async (): Promise<CallMetrics> => {
      const res = await supabase.rpc('call_metrics', { p_user: profile!.id, p_from: from, p_to: to });
      return unwrap(res) as unknown as CallMetrics;
    },
  });
}

export function useActiveSession() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['callSession', profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from('call_sessions').select('*').eq('user_id', profile!.id).is('ended_at', null)
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return data as { id: string; started_at: string } | null;
    },
  });
}
