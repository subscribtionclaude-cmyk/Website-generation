import {
  Archive,
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  DatabaseBackup,
  FileText,
  FlaskConical,
  Globe,
  History,
  LayoutDashboard,
  Newspaper,
  Package,
  Palette,
  Plug,
  Receipt,
  RefreshCcw,
  Recycle,
  RotateCcw,
  ShieldCheck,
  Star,
  Store,
  Tags,
  TicketPercent,
  Truck,
  Upload,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@/domain/access/permissions';

export type AdminNavGroup =
  'overview' | 'operations' | 'catalog' | 'customers' | 'content' | 'insights' | 'system';

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  'overview',
  'operations',
  'catalog',
  'customers',
  'content',
  'insights',
  'system',
];

export interface AdminModule {
  id: string;
  /** Path relative to /admin ('' = dashboard). */
  path: string;
  group: AdminNavGroup;
  icon: LucideIcon;
  /** Permission required to see and open the module (enforced again by the database). */
  permission: PermissionKey;
  /** null = available now; otherwise the phase that delivers the module's screens. */
  plannedPhase: number | null;
  /** Available now but read-only until its editing phase. */
  readOnlyUntilPhase?: number;
}

/**
 * Admin module registry — drives the sidebar, route guards and "planned" pages.
 * Adding a module in a later phase = flipping `plannedPhase` to null and registering its route.
 */
export const ADMIN_MODULES: AdminModule[] = [
  {
    id: 'dashboard',
    path: '',
    group: 'overview',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    plannedPhase: null,
  },

  {
    id: 'orders',
    path: 'orders',
    group: 'operations',
    icon: ClipboardList,
    permission: 'orders.view',
    plannedPhase: null,
  },
  {
    id: 'shipping',
    path: 'shipping',
    group: 'operations',
    icon: Truck,
    permission: 'shipping.manage',
    plannedPhase: 6,
  },
  {
    id: 'receipts',
    path: 'receipts',
    group: 'operations',
    icon: Receipt,
    permission: 'settings.manage',
    plannedPhase: 6,
  },
  {
    id: 'repairs',
    path: 'repairs',
    group: 'operations',
    icon: Wrench,
    permission: 'repairs.view',
    plannedPhase: 5,
  },
  {
    id: 'trade-in',
    path: 'trade-in',
    group: 'operations',
    icon: RefreshCcw,
    permission: 'tradein.view',
    plannedPhase: 5,
  },
  {
    id: 'used-requests',
    path: 'used-requests',
    group: 'operations',
    icon: Recycle,
    permission: 'used_requests.view',
    plannedPhase: 5,
  },
  {
    id: 'after-sales',
    path: 'after-sales',
    group: 'operations',
    icon: RotateCcw,
    permission: 'after_sales.view',
    plannedPhase: 5,
  },

  {
    id: 'products',
    path: 'products',
    group: 'catalog',
    icon: Package,
    permission: 'catalog.view',
    plannedPhase: 6,
  },
  {
    id: 'categories',
    path: 'categories',
    group: 'catalog',
    icon: Tags,
    permission: 'catalog.manage',
    plannedPhase: 6,
  },
  {
    id: 'brands',
    path: 'brands',
    group: 'catalog',
    icon: Archive,
    permission: 'catalog.manage',
    plannedPhase: 6,
  },
  {
    id: 'inventory',
    path: 'inventory',
    group: 'catalog',
    icon: Boxes,
    permission: 'inventory.manage',
    plannedPhase: 6,
  },
  {
    id: 'offers',
    path: 'offers',
    group: 'catalog',
    icon: TicketPercent,
    permission: 'marketing.manage',
    plannedPhase: 6,
  },

  {
    id: 'customers',
    path: 'customers',
    group: 'customers',
    icon: Users,
    permission: 'customers.view',
    plannedPhase: 6,
  },
  {
    id: 'reviews',
    path: 'reviews',
    group: 'customers',
    icon: Star,
    permission: 'reviews.moderate',
    plannedPhase: 6,
  },
  {
    id: 'waitlists',
    path: 'waitlists',
    group: 'customers',
    icon: Bell,
    permission: 'waitlists.manage',
    plannedPhase: 6,
  },
  {
    id: 'notifications',
    path: 'notifications',
    group: 'customers',
    icon: Bell,
    permission: 'notifications.manage',
    plannedPhase: 4,
  },

  {
    id: 'site-editor',
    path: 'site-editor',
    group: 'content',
    icon: Palette,
    permission: 'design.edit',
    plannedPhase: 7,
  },
  {
    id: 'news',
    path: 'news',
    group: 'content',
    icon: Newspaper,
    permission: 'content.view',
    plannedPhase: 6,
  },
  {
    id: 'legal',
    path: 'legal',
    group: 'content',
    icon: FileText,
    permission: 'legal.manage',
    plannedPhase: 6,
  },
  {
    id: 'seo',
    path: 'seo',
    group: 'content',
    icon: Globe,
    permission: 'content.manage',
    plannedPhase: 8,
  },

  {
    id: 'analytics',
    path: 'analytics',
    group: 'insights',
    icon: BarChart3,
    permission: 'analytics.view',
    plannedPhase: 6,
  },
  {
    id: 'import-export',
    path: 'import-export',
    group: 'insights',
    icon: Upload,
    permission: 'data.import',
    plannedPhase: 6,
  },

  {
    id: 'store-settings',
    path: 'settings/store',
    group: 'system',
    icon: Store,
    permission: 'settings.view',
    plannedPhase: null,
    readOnlyUntilPhase: 6,
  },
  {
    id: 'roles',
    path: 'access/roles',
    group: 'system',
    icon: ShieldCheck,
    permission: 'users.view',
    plannedPhase: null,
    readOnlyUntilPhase: 6,
  },
  {
    id: 'audit-log',
    path: 'audit-log',
    group: 'system',
    icon: History,
    permission: 'audit.view',
    plannedPhase: 6,
  },
  {
    id: 'integrations',
    path: 'integrations',
    group: 'system',
    icon: Plug,
    permission: 'integrations.manage',
    plannedPhase: 9,
  },
  {
    id: 'demo-data',
    path: 'demo-data',
    group: 'system',
    icon: FlaskConical,
    permission: 'demo.manage',
    plannedPhase: 8,
  },
  {
    id: 'backups',
    path: 'backups',
    group: 'system',
    icon: DatabaseBackup,
    permission: 'data.backup',
    plannedPhase: 10,
  },
];

export function findAdminModuleByPath(path: string): AdminModule | undefined {
  return ADMIN_MODULES.find((module) => module.path === path);
}

export function adminHref(module: AdminModule): string {
  return module.path ? `/admin/${module.path}` : '/admin';
}
