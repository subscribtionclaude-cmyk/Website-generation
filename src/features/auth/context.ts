import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { hasPermission, isStaff, type AccessProfile } from '@/domain/access/access';
import type { PermissionKey } from '@/domain/access/permissions';
import { useRuntime } from '@/runtime/context';
import type { AuthService, AuthSession } from '@/services/auth/types';

export type AuthState =
  { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: AuthSession };

export interface AuthContextValue {
  state: AuthState;
  service: AuthService;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function useSession(): AuthSession | null {
  const { state } = useAuth();
  return state.status === 'signed_in' ? state.session : null;
}

export const accessQueryKey = (userId: string | null) => ['access', userId] as const;

export interface AccessState {
  status: 'signed_out' | 'loading' | 'ready' | 'error';
  access: AccessProfile | null;
  isStaff: boolean;
  can: (permission: PermissionKey) => boolean;
  refetch: () => void;
}

/** Effective roles/permissions of the signed-in user (resolved by the backend). */
export function useAccess(): AccessState {
  const { repositories } = useRuntime();
  const { state } = useAuth();
  const userId = state.status === 'signed_in' ? state.session.userId : null;
  const query = useQuery({
    queryKey: accessQueryKey(userId),
    queryFn: () => repositories.access.getMyAccess(),
    enabled: userId !== null,
    staleTime: 60_000,
  });
  const access = query.data ?? null;
  const status: AccessState['status'] =
    state.status === 'loading'
      ? 'loading'
      : userId === null
        ? 'signed_out'
        : query.isPending
          ? 'loading'
          : query.isError
            ? 'error'
            : 'ready';
  return {
    status,
    access,
    isStaff: isStaff(access),
    can: (permission) => hasPermission(access, permission),
    refetch: () => void query.refetch(),
  };
}
