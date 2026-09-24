import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRuntime } from '@/runtime/context';
import { AuthContext, type AuthContextValue, type AuthState } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useRuntime();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    auth
      .getSession()
      .then((session) => {
        if (active) setState(session ? { status: 'signed_in', session } : { status: 'signed_out' });
      })
      .catch(() => {
        if (active) setState({ status: 'signed_out' });
      });
    const unsubscribe = auth.subscribe((session) => {
      if (!active) return;
      setState(session ? { status: 'signed_in', session } : { status: 'signed_out' });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  const userId = state.status === 'signed_in' ? state.session.userId : null;

  // Private data must never survive a user switch or sign-out. Convention: every private query key is
  // scoped as [name, userId, ...]; only public published settings are shared across users.
  useEffect(() => {
    if (state.status === 'loading') return;
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'settings' && query.queryKey[1] !== userId,
    });
  }, [queryClient, state.status, userId]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setState({ status: 'signed_out' });
  }, [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, service: auth, signOut }),
    [state, auth, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
