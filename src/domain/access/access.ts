import type { LocalizedText } from '@/domain/localized';
import type { PermissionKey } from './permissions';

export interface RoleSummary {
  key: string;
  rank: number;
  name: LocalizedText;
}

/** The signed-in user's effective access, resolved server-side by `public.get_my_access()`. */
export interface AccessProfile {
  userId: string;
  roles: RoleSummary[];
  /** Owner: every permission, including ones added in future migrations. */
  grantsAll: boolean;
  permissions: ReadonlySet<PermissionKey>;
}

export const NO_ACCESS = (userId: string): AccessProfile => ({
  userId,
  roles: [],
  grantsAll: false,
  permissions: new Set(),
});

/**
 * UI-side permission check. This only shapes the interface — the database enforces the same rules
 * through RLS policies and security-definer RPCs (`app.has_permission`), so hiding a button is never
 * the security boundary.
 */
export function hasPermission(
  access: AccessProfile | null | undefined,
  permission: PermissionKey,
): boolean {
  if (!access) return false;
  return access.grantsAll || access.permissions.has(permission);
}

export function hasAnyPermission(
  access: AccessProfile | null | undefined,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.some((permission) => hasPermission(access, permission));
}

export function isStaff(access: AccessProfile | null | undefined): boolean {
  return Boolean(access && access.roles.length > 0);
}

export function highestRank(access: AccessProfile | null | undefined): number {
  return access?.roles.reduce((max, role) => Math.max(max, role.rank), 0) ?? 0;
}
