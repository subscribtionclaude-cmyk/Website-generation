import type { PermissionKey } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import type { RawCatalog } from '@/domain/catalog/raw';
import type { DemoCommerce } from '@/domain/commerce/demoCommerce';
import type { DemoCustomer } from '@/domain/customer/demoCustomer';
import type { LocalizedText } from '@/domain/localized';
import type { DemoServices } from '@/domain/services/demoServices';
import type { DemoAccessActor, DemoAccessControl } from '../demoAccess';
import type { DemoSettings } from '../demoSettings';
import type { FollowUpState, ServicePriority } from '../schemas';

/**
 * DEMO MODE ONLY — shared state of the in-browser admin engine (Phase 06). Everything here lives in
 * this browser (localStorage) and is demo data; live mode uses the database RPCs instead.
 */
export interface DemoAuditEntry {
  id: number;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export interface DemoPriceRow {
  id: number;
  createdAt: string;
  variantId: string;
  productId: string;
  oldPrice: number | null;
  newPrice: number | null;
  oldCompareAt: number | null;
  newCompareAt: number | null;
  reason: string | null;
  source: 'admin' | 'bulk' | 'import' | 'system';
  actorName: string | null;
}

export interface DemoCustomerNote {
  id: string;
  customerId: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
}

export interface DemoImportJob {
  id: string;
  fileName: string | null;
  status: 'previewed' | 'committed' | 'failed' | 'cancelled';
  rows: { rowNo: number; action: string; data: Record<string, unknown>; errors: string[] }[];
  summary: Record<string, number>;
  error: string | null;
  createdAt: string;
  committedAt: string | null;
  createdBy: string | null;
}

export interface DemoAdminState {
  version: 1;
  seq: number;
  audit: DemoAuditEntry[];
  priceHistory: DemoPriceRow[];
  notes: DemoCustomerNote[];
  followUps: Record<string, { state: FollowUpState; note: string | null; updatedAt: string }>;
  priorities: Record<string, ServicePriority>;
  templates: Record<
    string,
    { title: LocalizedText; body: LocalizedText; isActive: boolean; updatedAt: string }
  >;
  sections: Record<
    string,
    {
      isVisible: boolean;
      props: Record<string, unknown>;
      updatedAt: string;
      updatedBy: string | null;
    }
  >;
  importJobs: DemoImportJob[];
}

export const emptyDemoAdminState = (): DemoAdminState => ({
  version: 1,
  seq: 0,
  audit: [],
  priceHistory: [],
  notes: [],
  followUps: {},
  priorities: {},
  templates: {},
  sections: {},
  importJobs: [],
});

export interface AdminActor extends DemoAccessActor {
  email: string | null;
  name: string | null;
  roleKey: string | null;
}

export class DemoAdminForbidden extends Error {
  readonly code = '42501';
}

export interface DemoAdminContext {
  raw: RawCatalog;
  commerce: DemoCommerce;
  customer: DemoCustomer;
  services: DemoServices;
  settings: DemoSettings;
  access: DemoAccessControl;
  state: DemoAdminState;
  now(): Date;
  /** Strictly increasing ISO timestamp (stale-edit detection needs distinct values). */
  stamp(): string;
  uuid(): string;
  persist(): void;
  /** Persist the edited demo catalog and rebuild the storefront engine. */
  catalogChanged(): void;
  engine(): CatalogEngine;
  staffName(id: string): string | null;
  audit(
    actor: AdminActor,
    action: string,
    entityType: string,
    entityId: string | null,
    before?: unknown,
    after?: unknown,
    metadata?: unknown,
  ): void;
}

export function requireAny(actor: AdminActor, ...permissions: PermissionKey[]) {
  if (!permissions.some((p) => actor.can(p))) throw new DemoAdminForbidden('forbidden');
}

export interface Page<T> {
  total: number;
  items: T[];
}

export function paginate<T>(rows: T[], filter: { limit?: number; offset?: number }, max = 200) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), max);
  const offset = Math.max(filter.offset ?? 0, 0);
  return { total: rows.length, items: rows.slice(offset, offset + limit) };
}

export const lower = (v: string | null | undefined) => (v ?? '').toLowerCase();

export function matchesText(
  q: string | null | undefined,
  ...values: (string | null | undefined)[]
) {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((v) => lower(v).includes(needle));
}

export const ltText = (v: LocalizedText | null | undefined) => `${v?.ar ?? ''} ${v?.en ?? ''}`;
