import catalog from './access-catalog.json';

/**
 * Permission keys as a literal union. `access-catalog.json` is the shared contract with the database;
 * `permissions.test.ts` fails if this list and the JSON drift apart.
 */
export const PERMISSION_KEYS = [
  'dashboard.view',
  'catalog.view',
  'catalog.manage',
  'pricing.manage',
  'inventory.manage',
  'orders.view',
  'orders.manage',
  'payments.verify',
  'shipping.manage',
  'customers.view',
  'customers.manage',
  'repairs.view',
  'repairs.manage',
  'tradein.view',
  'tradein.manage',
  'used_requests.view',
  'used_requests.manage',
  'after_sales.view',
  'after_sales.manage',
  'reviews.moderate',
  'waitlists.manage',
  'notifications.manage',
  'marketing.manage',
  'content.view',
  'content.manage',
  'content.publish',
  'legal.manage',
  'design.edit',
  'design.publish',
  'analytics.view',
  'reports.export',
  'data.import',
  'data.backup',
  'demo.manage',
  'settings.view',
  'settings.manage',
  'settings.publish',
  'integrations.manage',
  'security.manage',
  'users.view',
  'users.manage',
  'roles.manage',
  'audit.view',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SYSTEM_ROLE_KEYS = [
  'owner',
  'super_admin',
  'store_manager',
  'sales',
  'customer_service',
  'repairs_team',
  'content_editor',
  'design_editor',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const PERMISSION_MODULES = [
  'dashboard',
  'catalog',
  'orders',
  'customers',
  'services',
  'engagement',
  'content',
  'design',
  'analytics',
  'data',
  'settings',
  'access',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export interface PermissionDefinition {
  key: PermissionKey;
  module: PermissionModule;
  sensitive: boolean;
}

export interface RoleDefinition {
  key: string;
  rank: number;
  grantsAll: boolean;
  name: { ar: string; en?: string };
  permissions: PermissionKey[];
  isSystem: boolean;
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = catalog.permissions.map((p) => {
  if (!isPermissionKey(p.key)) throw new Error(`Unknown permission in catalog: ${p.key}`);
  return { key: p.key, module: p.module as PermissionModule, sensitive: p.sensitive };
});

/** System role definitions with `"*"` expanded to the full permission list. */
export const SYSTEM_ROLES: RoleDefinition[] = catalog.roles.map((role) => ({
  key: role.key,
  rank: role.rank,
  grantsAll: role.grantsAll,
  name: role.name,
  isSystem: true,
  permissions:
    role.permissions === '*'
      ? [...PERMISSION_KEYS]
      : (role.permissions as string[]).filter(isPermissionKey),
}));
