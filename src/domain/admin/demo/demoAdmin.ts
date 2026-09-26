import { SYSTEM_ROLES } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import type { RawCatalog } from '@/domain/catalog/raw';
import type { DemoCommerce } from '@/domain/commerce/demoCommerce';
import type { PageSection } from '@/domain/content/types';
import type { DemoCustomer } from '@/domain/customer/demoCustomer';
import type { DemoServices } from '@/domain/services/demoServices';
import type { DemoAccessControl } from '../demoAccess';
import type { DemoSettings } from '../demoSettings';
import { DemoAdminCatalog } from './catalog';
import { DemoAdminContent } from './content';
import {
  type AdminActor,
  type DemoAdminContext,
  type DemoAdminState,
  emptyDemoAdminState,
} from './context';
import { DemoAdminData } from './data';
import { DemoAdminOps } from './ops';

const MAX_AUDIT_ROWS = 2000;

export interface DemoAdminOptions {
  raw: RawCatalog;
  commerce: DemoCommerce;
  customer: DemoCustomer;
  services: DemoServices;
  settings: DemoSettings;
  access: DemoAccessControl;
  baseSections: PageSection[];
  storage: { load(): DemoAdminState | null; save(state: DemoAdminState): void };
  /** Persist the edited demo catalog and invalidate the storefront engine. */
  onCatalogChange: () => void;
  engine: () => CatalogEngine;
  now?: () => Date;
  uuid?: () => string;
}

/**
 * DEMO MODE ONLY — the Phase 06 admin RPCs mirrored in this browser. Modules share one context;
 * every write is permission-checked against the demo role registry and recorded in the demo audit
 * log. Live mode never constructs this class (it calls the database instead).
 */
export class DemoAdmin {
  readonly catalog: DemoAdminCatalog;
  readonly ops: DemoAdminOps;
  readonly content: DemoAdminContent;
  readonly data: DemoAdminData;
  private readonly ctx: DemoAdminContext;

  constructor(options: DemoAdminOptions) {
    const now = options.now ?? (() => new Date());
    let lastStamp = 0;
    const state = options.storage.load() ?? emptyDemoAdminState();
    const ctx: DemoAdminContext = {
      raw: options.raw,
      commerce: options.commerce,
      customer: options.customer,
      services: options.services,
      settings: options.settings,
      access: options.access,
      state,
      now,
      stamp: () => {
        lastStamp = Math.max(now().getTime(), lastStamp + 1);
        return new Date(lastStamp).toISOString();
      },
      uuid: options.uuid ?? (() => crypto.randomUUID()),
      persist: () => options.storage.save(ctx.state),
      catalogChanged: () => {
        options.onCatalogChange();
        options.storage.save(ctx.state);
      },
      engine: options.engine,
      staffName: (id) => this.staffName(id),
      audit: (
        actor,
        action,
        entityType,
        entityId,
        before = null,
        after = null,
        metadata = null,
      ) => {
        ctx.state.seq += 1;
        ctx.state.audit.push({
          id: ctx.state.seq,
          occurredAt: ctx.stamp(),
          actorId: actor.userId,
          actorName: actor.name,
          actorEmail: actor.email,
          actorRole: actor.roleKey,
          action,
          entityType,
          entityId,
          before: before ?? null,
          after: after ?? null,
          metadata: metadata ?? null,
        });
        if (ctx.state.audit.length > MAX_AUDIT_ROWS)
          ctx.state.audit = ctx.state.audit.slice(-MAX_AUDIT_ROWS);
        options.storage.save(ctx.state);
      },
    };
    this.ctx = ctx;
    this.catalog = new DemoAdminCatalog(ctx);
    this.ops = new DemoAdminOps(ctx);
    this.content = new DemoAdminContent(ctx, options.baseSections);
    this.data = new DemoAdminData(ctx, this.catalog, this.ops);
  }

  /** Display name of a staff user: preview accounts use their role name. */
  staffName(id: string): string | null {
    const role = SYSTEM_ROLES.find((r) => `demo-${r.key}` === id);
    if (role) return `${role.name.en ?? role.name.ar} (demo)`;
    const profile = this.ctx.customer.adminState().profiles[id];
    return (
      profile?.fullName ??
      (id.startsWith('demo-customer-') ? id.slice('demo-customer-'.length) : null)
    );
  }

  /** Record an audit event for demo writes made through the Phase 03–05 staff screens. */
  audit(
    actor: AdminActor,
    action: string,
    entityType: string,
    entityId: string | null,
    after?: unknown,
  ) {
    this.ctx.audit(actor, action, entityType, entityId, null, after ?? null);
  }

  /** Page sections with staff edits applied (the demo storefront reads these). */
  sections(pageKey: string): PageSection[] {
    return this.content.sections(pageKey);
  }

  /** Demo data summary (rows per area) — everything in demo mode is demo data. */
  demoSummary(): Record<string, number> {
    const raw = this.ctx.raw;
    return {
      products: raw.products.filter((p) => !p.deletedAt).length,
      product_variants: raw.products.reduce((n, p) => n + p.variants.length, 0),
      offers: raw.offers.length,
      content_entries: raw.entries.length,
      orders: this.ctx.commerce.orderRecords().length,
      service_requests: this.ctx.services.records().length,
      product_reviews: this.ctx.customer.adminState().reviews.length + raw.reviews.length,
      audit_logs: this.ctx.state.audit.length,
    };
  }
}

export type { AdminActor } from './context';
export { DemoAdminForbidden } from './context';
