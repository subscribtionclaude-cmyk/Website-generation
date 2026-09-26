import {
  PERMISSION_KEYS,
  SYSTEM_ROLES,
  isPermissionKey,
  type PermissionKey,
  type RoleDefinition,
} from '@/domain/access/permissions';

/**
 * DEMO MODE ONLY — role permissions, staff role assignments and suspensions for the in-browser
 * preview, with the same escalation rules as the database (identity_access + admin_foundation
 * migrations): nobody edits or grants a role at or above their own rank (Owner excepted), only an
 * Owner grants/revokes Owner, the last Owner cannot be removed or suspended, and nobody grants a
 * permission they do not hold. Every demo permission check (actorOf) reads this registry.
 */
export interface DemoAccessState {
  version: 1;
  /** Edited permission lists per role key (system defaults otherwise). */
  rolePermissions: Record<string, PermissionKey[]>;
  /** Explicit role assignments per user id (default: the demo preview role of that user). */
  assignments: Record<string, string[]>;
  suspended: Record<string, { at: string; reason: string; by: string | null }>;
  lastActive: Record<string, string>;
}

export const emptyDemoAccessState = (): DemoAccessState => ({
  version: 1,
  rolePermissions: {},
  assignments: {},
  suspended: {},
  lastActive: {},
});

export interface DemoAccessStorage {
  load(): DemoAccessState | null;
  save(state: DemoAccessState): void;
}

export interface DemoStaffUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string | null;
}

/** Synthetic preview accounts: one per system role (`demo-<role>`, `<role>@demo.invalid`). */
export const demoStaffUserId = (roleKey: string) => `demo-${roleKey}`;
const roleFromDemoUser = (userId: string) =>
  SYSTEM_ROLES.find((r) => demoStaffUserId(r.key) === userId)?.key ?? null;

export interface DemoAccessActor {
  userId: string | null;
  roles: RoleDefinition[];
  grantsAll: boolean;
  rank: number;
  suspended: boolean;
  can: (permission: PermissionKey) => boolean;
}

export type AccessResult = { ok: true } | { ok: false; code: string };

export class DemoAccessControl {
  private state: DemoAccessState;
  private readonly storage: DemoAccessStorage;
  private readonly now: () => Date;

  constructor(options: { storage: DemoAccessStorage; now?: () => Date }) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.state = this.storage.load() ?? emptyDemoAccessState();
  }

  private persist() {
    this.storage.save(this.state);
  }

  role(key: string): RoleDefinition | undefined {
    const base = SYSTEM_ROLES.find((r) => r.key === key);
    if (!base) return undefined;
    const edited = this.state.rolePermissions[key];
    return edited && !base.grantsAll ? { ...base, permissions: edited } : base;
  }

  roles(): RoleDefinition[] {
    return SYSTEM_ROLES.flatMap((r) => this.role(r.key) ?? []);
  }

  /** Role keys of a user; the preview role applies until an admin changes the assignment. */
  roleKeys(userId: string, previewRole: string | null = roleFromDemoUser(userId)): string[] {
    return this.state.assignments[userId] ?? (previewRole ? [previewRole] : []);
  }

  isSuspended(userId: string | null): boolean {
    return Boolean(userId && this.state.suspended[userId]);
  }

  suspension(userId: string) {
    return this.state.suspended[userId] ?? null;
  }

  actor(userId: string | null, previewRole: string | null): DemoAccessActor {
    const suspended = this.isSuspended(userId);
    const roles =
      userId && !suspended
        ? this.roleKeys(userId, previewRole).flatMap((k) => this.role(k) ?? [])
        : [];
    const grantsAll = roles.some((r) => r.grantsAll);
    const permissions = new Set<PermissionKey>(
      grantsAll ? PERMISSION_KEYS : roles.flatMap((r) => r.permissions),
    );
    return {
      userId,
      roles,
      grantsAll,
      rank: Math.max(0, ...roles.map((r) => r.rank)),
      suspended,
      can: (p) => permissions.has(p),
    };
  }

  /** Every user that holds (or held) a staff role in this browser. */
  staffIds(extraUserIds: string[] = []): string[] {
    const ids = new Set<string>([
      ...SYSTEM_ROLES.map((r) => demoStaffUserId(r.key)),
      ...Object.keys(this.state.assignments),
      ...extraUserIds,
    ]);
    return [...ids].filter(
      (id) => this.roleKeys(id).length > 0 || this.state.suspended[id] !== undefined,
    );
  }

  lastActive(userId: string): string | null {
    return this.state.lastActive[userId] ?? null;
  }

  touch(userId: string | null) {
    if (!userId) return;
    const now = this.now().toISOString();
    const previous = this.state.lastActive[userId];
    // Like admin_touch_activity: at most one write per few minutes.
    if (previous && this.now().getTime() - new Date(previous).getTime() < 5 * 60_000) return;
    this.state.lastActive[userId] = now;
    this.persist();
  }

  private owners(): string[] {
    return this.staffIds().filter((id) => this.roleKeys(id).includes('owner'));
  }

  setRolePermissions(actor: DemoAccessActor, roleKey: string, permissions: string[]): AccessResult {
    if (!actor.can('roles.manage')) return { ok: false, code: 'forbidden' };
    const role = this.role(roleKey);
    if (!role) return { ok: false, code: 'role_not_found' };
    if (role.grantsAll) return { ok: false, code: 'owner_role_is_implicit' };
    if (!actor.grantsAll && role.rank >= actor.rank)
      return { ok: false, code: 'cannot_edit_role_at_or_above_own_rank' };
    if (!permissions.every(isPermissionKey)) return { ok: false, code: 'unknown_permission' };
    if (!actor.grantsAll && permissions.some((p) => !actor.can(p as PermissionKey)))
      return { ok: false, code: 'cannot_grant_permission_you_do_not_hold' };
    this.state.rolePermissions[roleKey] = [...new Set(permissions as PermissionKey[])];
    this.persist();
    return { ok: true };
  }

  changeRole(
    actor: DemoAccessActor,
    userId: string,
    fromRole: string | null,
    toRole: string | null,
  ): AccessResult {
    if (!actor.can('roles.manage')) return { ok: false, code: 'forbidden' };
    if (!toRole) return { ok: false, code: 'role_required' };
    if (fromRole === toRole) return { ok: true };
    const target = this.role(toRole);
    if (!target) return { ok: false, code: 'role_not_found' };
    if (target.grantsAll ? !actor.grantsAll : !actor.grantsAll && target.rank >= actor.rank)
      return {
        ok: false,
        code: target.grantsAll
          ? 'only_owner_can_grant_owner'
          : 'cannot_grant_role_at_or_above_own_rank',
      };
    const current = this.roleKeys(userId);
    if (fromRole) {
      const from = this.role(fromRole);
      if (from?.grantsAll) {
        if (!actor.grantsAll) return { ok: false, code: 'only_owner_can_revoke_owner' };
        if (this.owners().filter((id) => id !== userId).length === 0)
          return { ok: false, code: 'cannot_remove_last_owner' };
      } else if (from && !actor.grantsAll && from.rank >= actor.rank) {
        return { ok: false, code: 'cannot_revoke_role_at_or_above_own_rank' };
      }
    }
    this.state.assignments[userId] = [
      ...new Set([...current.filter((k) => k !== fromRole), toRole]),
    ];
    this.persist();
    return { ok: true };
  }

  setSuspended(
    actor: DemoAccessActor,
    userId: string,
    suspended: boolean,
    reason: string | null,
  ): AccessResult {
    if (!actor.can('users.manage')) return { ok: false, code: 'forbidden' };
    if (userId === actor.userId) return { ok: false, code: 'cannot_suspend_self' };
    const roles = this.roleKeys(userId).flatMap((k) => this.role(k) ?? []);
    if (roles.length === 0) return { ok: false, code: 'not_staff' };
    const targetOwner = roles.some((r) => r.grantsAll);
    const targetRank = Math.max(...roles.map((r) => r.rank));
    if (targetOwner && !actor.grantsAll) return { ok: false, code: 'only_owner_can_suspend_owner' };
    if (!actor.grantsAll && targetRank >= actor.rank) return { ok: false, code: 'rank_too_high' };
    if (suspended) {
      if (!reason?.trim()) return { ok: false, code: 'reason_required' };
      if (
        targetOwner &&
        this.owners().filter((id) => id !== userId && !this.isSuspended(id)).length === 0
      )
        return { ok: false, code: 'cannot_suspend_last_owner' };
      this.state.suspended[userId] = {
        at: this.now().toISOString(),
        reason: reason.trim(),
        by: actor.userId,
      };
    } else {
      this.state.suspended = Object.fromEntries(
        Object.entries(this.state.suspended).filter(([id]) => id !== userId),
      );
    }
    this.persist();
    return { ok: true };
  }
}
