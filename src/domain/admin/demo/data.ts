import { SYSTEM_ROLES } from '@/domain/access/permissions';
import type { RawProduct } from '@/domain/catalog/raw';
import { isTerminal } from '@/domain/services/status';
import type { ServiceKind } from '@/domain/services/types';
import { redactSecrets } from '../diff';
import { storeDay } from '../dateRange';
import type { ImportField } from '../importMapping';
import type {
  AccountLookup,
  Analytics,
  AuditDetail,
  AuditFilter,
  AuditModule,
  AuditRow,
  Dashboard,
  ExportKind,
  ExportResult,
  ImportCommit,
  ImportJob,
  ImportPreview,
  ImportRowResult,
  StaffMember,
} from '../schemas';
import { SKU_PATTERN } from '../validation';
import type { DemoAdminCatalog } from './catalog';
import {
  type AdminActor,
  type DemoAdminContext,
  DemoAdminForbidden,
  matchesText,
  type Page,
  paginate,
  requireAny,
} from './context';
import type { DemoAdminOps } from './ops';

const KINDS: ServiceKind[] = ['repair', 'trade_in', 'used', 'after_sales'];
const SERVICE_VIEW = {
  repair: 'repairs.view',
  trade_in: 'tradein.view',
  used: 'used_requests.view',
  after_sales: 'after_sales.view',
} as const;

/** Mirror of app.audit_module (entity type / action → admin module filter). */
export function auditModule(entityType: string, action: string): AuditModule {
  const starts = (...p: string[]) => p.some((x) => action.startsWith(x));
  if (
    [
      'public.products',
      'public.product_variants',
      'public.brands',
      'public.categories',
      'public.product_relations',
      'public.product_media',
      'public.price_history',
    ].includes(entityType) ||
    starts('catalog.', 'stock.', 'price.')
  )
    return 'catalog';
  if (
    ['public.orders', 'public.payment_records'].includes(entityType) ||
    starts('order.', 'payment.')
  )
    return 'orders';
  if (
    ['public.service_requests', 'public.service_offers'].includes(entityType) ||
    starts('service.')
  )
    return 'services';
  if (entityType === 'public.site_settings' || starts('setting.')) return 'settings';
  if (
    ['public.roles', 'public.role_permissions', 'public.user_roles', 'public.profiles'].includes(
      entityType,
    ) ||
    starts('access.', 'staff.')
  )
    return 'access';
  if (
    ['public.offers', 'public.content_entries', 'public.page_sections'].includes(entityType) ||
    starts('content.', 'offer.', 'marketing.')
  )
    return 'content';
  if (
    [
      'public.product_reviews',
      'public.customer_notes',
      'public.notification_templates',
      'public.cart_followups',
    ].includes(entityType) ||
    starts('review.', 'customer.', 'notification.')
  )
    return 'customers';
  if (starts('data.', 'demo.', 'import.', 'export.')) return 'data';
  return 'other';
}

const changedFields = (before: unknown, after: unknown): string[] | null => {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => k !== 'updatedAt' && JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
};

const storageKey = (value: string | undefined) => {
  if (!value?.trim()) return null;
  const v = value.replace(/\s/g, '').toUpperCase();
  return /^[0-9]{1,4}(GB|TB)$/.test(v) ? v.toLowerCase() : '!invalid';
};
const colorKey = (value: string | undefined) => {
  if (!value?.trim()) return null;
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || null
  );
};
const numberOrNaN = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** DEMO MODE ONLY — audit, staff, dashboard, analytics, exports, backup and import (see context.ts). */
export class DemoAdminData {
  private readonly ctx: DemoAdminContext;
  private readonly catalog: DemoAdminCatalog;
  private readonly ops: DemoAdminOps;

  constructor(ctx: DemoAdminContext, catalog: DemoAdminCatalog, ops: DemoAdminOps) {
    this.ctx = ctx;
    this.catalog = catalog;
    this.ops = ops;
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  private auditRow(e: DemoAdminContext['state']['audit'][number]): AuditRow {
    return {
      id: e.id,
      occurredAt: e.occurredAt,
      actorId: e.actorId,
      actorName: e.actorName,
      actorEmail: e.actorEmail,
      actorRole: e.actorRole,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      module: auditModule(e.entityType, e.action),
      changedFields: changedFields(e.before, e.after),
    };
  }

  listAuditLogs(actor: AdminActor, filter: AuditFilter): Page<AuditRow> {
    requireAny(actor, 'audit.view');
    const rows = [...this.ctx.state.audit]
      .reverse()
      .map((e) => this.auditRow(e))
      .filter(
        (r) =>
          matchesText(filter.actor, r.actorName, r.actorEmail) &&
          (!filter.action || r.action.toLowerCase().includes(filter.action.toLowerCase())) &&
          (!filter.module || r.module === filter.module) &&
          (!filter.entityType || r.entityType === filter.entityType) &&
          (!filter.entityId || r.entityId === filter.entityId) &&
          (!filter.from || r.occurredAt >= filter.from) &&
          (!filter.to || r.occurredAt < filter.to),
      );
    return paginate(rows, filter);
  }

  getAuditLog(actor: AdminActor, id: number): AuditDetail | null {
    requireAny(actor, 'audit.view');
    const e = this.ctx.state.audit.find((x) => x.id === id);
    if (!e) return null;
    return {
      ...this.auditRow(e),
      before: redactSecrets(e.before ?? null),
      after: redactSecrets(e.after ?? null),
      metadata: redactSecrets(e.metadata ?? null),
    };
  }

  // ── Staff ─────────────────────────────────────────────────────────────────
  listStaff(
    actor: AdminActor,
    filter: { q?: string | null; status?: 'active' | 'suspended' | null },
  ): StaffMember[] {
    requireAny(actor, 'users.view');
    const profiles = this.ctx.customer.adminState().profiles;
    return this.ctx.access
      .staffIds()
      .map((id): StaffMember => {
        const roles = this.ctx.access.roleKeys(id).flatMap((k) => this.ctx.access.role(k) ?? []);
        const suspension = this.ctx.access.suspension(id);
        const roleKey = SYSTEM_ROLES.find((r) => `demo-${r.key}` === id)?.key;
        return {
          id,
          email: roleKey
            ? `${roleKey}@demo.invalid`
            : id.startsWith('demo-customer-')
              ? id.slice(14)
              : null,
          name: this.ctx.staffName(id),
          status: suspension ? 'suspended' : 'active',
          suspendedAt: suspension?.at ?? null,
          suspensionReason: suspension?.reason ?? null,
          lastActiveAt: this.ctx.access.lastActive(id),
          createdAt: profiles[id]?.createdAt ?? null,
          rank: Math.max(0, ...roles.map((r) => r.rank)),
          roles: roles.map((r) => ({ key: r.key, name: r.name, rank: r.rank })),
        };
      })
      .filter(
        (s) =>
          (!filter.status || s.status === filter.status) && matchesText(filter.q, s.name, s.email),
      )
      .sort((a, b) => b.rank - a.rank || (a.email ?? '').localeCompare(b.email ?? ''));
  }

  lookupAccount(actor: AdminActor, email: string): AccountLookup {
    requireAny(actor, 'roles.manage');
    const needle = email.trim().toLowerCase();
    const role = SYSTEM_ROLES.find((r) => `${r.key}@demo.invalid` === needle);
    const id = role
      ? `demo-${role.key}`
      : Object.keys(this.ctx.customer.adminState().profiles).find(
          (k) => k === `demo-customer-${needle}`,
        );
    if (!id) return { found: false };
    return {
      found: true,
      id,
      email: needle,
      name: this.ctx.staffName(id) ?? this.ctx.customer.adminState().profiles[id]?.fullName ?? null,
      roles: this.ctx.access.roleKeys(id),
    };
  }

  // ── Dashboard & analytics ─────────────────────────────────────────────────
  private assertRange(from: string, to: string) {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime();
    if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f || t - f > 400 * 86_400_000)
      throw new RangeError('invalid_range');
  }

  private variantStock() {
    let low = 0;
    let out = 0;
    for (const p of this.ctx.raw.products) {
      if (p.deletedAt || p.status !== 'published') continue;
      for (const v of p.variants) {
        if (v.retiredAt || !v.isActive) continue;
        const available = this.catalog.onHand(v.id) - this.catalog.reserved(v.id);
        if (available <= 0) out += 1;
        else if (available <= v.lowStockThreshold) low += 1;
      }
    }
    return { low, out };
  }

  private serviceBlock(kind: ServiceKind, from: string, to: string) {
    const records = this.ctx.services.records().filter((r) => r.kind === kind);
    const rows = this.ops.listServiceRequests({ ...this.systemActor() }, kind, {
      view: 'open',
      limit: 1,
    });
    return {
      open: records.filter((r) => !isTerminal(r.status)).length,
      overdue: rows.counts.overdue,
      created: records.filter((r) => r.createdAt >= from && r.createdAt < to).length,
    };
  }

  /** Internal read-only actor for aggregates the caller is already allowed to see. */
  private systemActor(): AdminActor {
    return {
      userId: null,
      email: null,
      name: null,
      roleKey: null,
      roles: [],
      grantsAll: true,
      rank: 100,
      suspended: false,
      can: () => true,
    };
  }

  dashboard(actor: AdminActor, from: string, to: string, includeDemo: boolean): Dashboard {
    requireAny(actor, 'dashboard.view');
    this.assertRange(from, to);
    const all = this.ctx.commerce.orderRecords();
    const inRange = includeDemo ? all.filter((o) => o.createdAt >= from && o.createdAt < to) : [];
    const valid = inRange.filter((o) => o.status !== 'cancelled');
    const open = includeDemo ? all : [];
    const services: Record<string, { open: number; overdue: number; created: number }> = {};
    for (const kind of KINDS) {
      if (!actor.can(SERVICE_VIEW[kind])) continue;
      services[kind] = includeDemo
        ? this.serviceBlock(kind, from, to)
        : { open: 0, overdue: 0, created: 0 };
    }
    const requests = this.ctx.customer.adminState().requests;
    return {
      range: { from, to },
      includeDemo,
      orders: actor.can('orders.view')
        ? {
            count: valid.length,
            revenue: valid.reduce((n, o) => n + o.totals.total, 0),
            paid: valid.reduce((n, o) => n + o.totals.paidAmount, 0),
            averageOrderValue: valid.length
              ? Math.round((valid.reduce((n, o) => n + o.totals.total, 0) / valid.length) * 100) /
                100
              : 0,
            cancelled: inRange.filter((o) => o.status === 'cancelled').length,
            demoExcluded: includeDemo
              ? 0
              : all.filter((o) => o.createdAt >= from && o.createdAt < to).length,
            pendingVerification: open.filter(
              (o) => o.paymentStatus === 'verification_pending' && o.status !== 'cancelled',
            ).length,
            manualReview: open.filter(
              (o) => o.manualReview.status === 'pending' && o.status !== 'cancelled',
            ).length,
            open: open.filter((o) => !['completed', 'cancelled', 'delivered'].includes(o.status))
              .length,
          }
        : null,
      stock:
        actor.can('inventory.manage') || actor.can('catalog.view')
          ? includeDemo
            ? this.variantStock()
            : { low: 0, out: 0 }
          : null,
      services: Object.keys(services).length ? services : null,
      reviews: actor.can('reviews.moderate')
        ? {
            pending: includeDemo
              ? this.ctx.customer.adminState().reviews.filter((r) => r.status === 'pending').length
              : 0,
          }
        : null,
      requests: actor.can('waitlists.manage')
        ? {
            notify: requests.filter((r) => r.kind === 'notify' && r.status === 'pending').length,
            waitlist: requests.filter((r) => r.kind === 'waitlist' && r.status === 'waiting')
              .length,
          }
        : null,
      carts: actor.can('customers.view')
        ? { abandoned: this.ctx.customer.abandonedCarts(actor).total }
        : null,
      activity: actor.can('audit.view')
        ? [...this.ctx.state.audit]
            .reverse()
            .slice(0, 10)
            .map((e) => ({
              id: e.id,
              occurredAt: e.occurredAt,
              action: e.action,
              entityType: e.entityType,
              entityId: e.entityId,
              module: auditModule(e.entityType, e.action),
              actorName: e.actorName,
            }))
        : null,
    };
  }

  analytics(actor: AdminActor, from: string, to: string, includeDemo: boolean): Analytics {
    requireAny(actor, 'analytics.view');
    this.assertRange(from, to);
    const all = includeDemo ? this.ctx.commerce.orderRecords() : [];
    const inRange = all.filter((o) => o.createdAt >= from && o.createdAt < to);
    const valid = inRange.filter((o) => o.status !== 'cancelled');
    const revenue = valid.reduce((n, o) => n + o.totals.total, 0);
    const customers = new Set(valid.map((o) => o.customerId));
    const activeCarts = includeDemo
      ? [
          ...new Set([...customers, ...Object.keys(this.ctx.customer.adminState().profiles)]),
        ].filter((id) => {
          const at = this.ctx.commerce.cartActivity(id);
          return at !== null && at >= from && at < to;
        }).length
      : 0;
    const byDay = new Map<string, { orders: number; revenue: number }>();
    for (const o of valid) {
      const day = storeDay(new Date(o.createdAt));
      const cur = byDay.get(day) ?? { orders: 0, revenue: 0 };
      byDay.set(day, { orders: cur.orders + 1, revenue: cur.revenue + o.totals.total });
    }
    const count = <T extends string>(items: T[]) =>
      items.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
    const sellers = new Map<
      string,
      { slug: string; name: RawProduct['name']; quantity: number; revenue: number }
    >();
    for (const o of valid) {
      for (const i of o.items) {
        if ((i as { isGift?: boolean }).isGift) continue;
        const cur = sellers.get(i.productSlug) ?? {
          slug: i.productSlug,
          name: i.productName,
          quantity: 0,
          revenue: 0,
        };
        cur.quantity += i.quantity;
        cur.revenue += i.lineSubtotal - i.discountAmount;
        sellers.set(i.productSlug, cur);
      }
    }
    const repeat = [...customers].filter(
      (id) => all.filter((o) => o.customerId === id && o.status !== 'cancelled').length >= 2,
    ).length;
    const records = includeDemo ? this.ctx.services.records() : [];
    const stock = includeDemo ? this.variantStock() : { low: 0, out: 0 };
    return {
      range: { from, to },
      includeDemo,
      totals: {
        orders: valid.length,
        revenue,
        paid: valid.reduce((n, o) => n + o.totals.paidAmount, 0),
        averageOrderValue: valid.length ? Math.round((revenue / valid.length) * 100) / 100 : 0,
        cancelled: inRange.length - valid.length,
        itemsSold: valid.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0),
        customers: customers.size,
        activeCarts,
        conversion:
          activeCarts > 0 ? Math.round((customers.size / activeCarts) * 10000) / 10000 : null,
      },
      byDay: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v })),
      byStatus: count(inRange.map((o) => o.status)),
      byPayment: count(valid.map((o) => o.paymentMethod)),
      bestSellers: [...sellers.values()]
        .sort((a, b) => b.quantity - a.quantity || a.slug.localeCompare(b.slug))
        .slice(0, 10)
        .map((s) => ({
          productId: this.ctx.raw.products.find((p) => p.slug === s.slug)?.id ?? s.slug,
          slug: s.slug,
          name: s.name,
          quantity: s.quantity,
          revenue: s.revenue,
        })),
      repeatCustomers: { customers: repeat, ofCustomers: customers.size },
      services: Object.fromEntries(
        KINDS.map((k) => {
          const rs = records.filter((r) => r.kind === k);
          return [
            k,
            {
              created: rs.filter((r) => r.createdAt >= from && r.createdAt < to).length,
              completed: rs.filter(
                (r) => r.status === 'completed' && r.updatedAt >= from && r.updatedAt < to,
              ).length,
              open: rs.filter((r) => !isTerminal(r.status)).length,
            },
          ];
        }),
      ),
      stock,
      abandonedCarts: includeDemo ? this.ctx.customer.abandonedCarts(actor).total : 0,
    };
  }

  // ── Exports & backup ──────────────────────────────────────────────────────
  exportData(
    actor: AdminActor,
    kind: ExportKind,
    filter: Record<string, unknown> = {},
  ): ExportResult {
    requireAny(actor, 'reports.export');
    let rows: Record<string, unknown>[];
    const products = this.ctx.raw.products.filter((p) => !p.deletedAt);
    const brandSlug = (p: RawProduct) => p.brandSlug;
    switch (kind) {
      case 'products':
        requireAny(actor, 'catalog.view');
        rows = [...products]
          .sort((a, b) => a.slug.localeCompare(b.slug))
          .map((p) => ({
            slug: p.slug,
            name_ar: p.name.ar,
            name_en: p.name.en ?? null,
            brand: brandSlug(p),
            category: p.categorySlugs[0] ?? null,
            status: p.status,
            visible: p.isVisible,
            availability: p.availabilityState,
            variants: p.variants.filter((v) => !v.retiredAt).length,
            is_demo: true,
            updated_at: p.updatedAt,
          }));
        break;
      case 'variants':
      case 'prices':
      case 'stock':
      case 'catalog':
        requireAny(actor, 'catalog.view');
        rows = products.flatMap((p) =>
          p.variants
            .filter((v) => !v.retiredAt)
            .map((v) => {
              const color = p.options
                .find((o) => o.key === 'color')
                ?.values.find((x) => x.key === v.options.color);
              const stock = this.catalog.onHand(v.id);
              const reserved = this.catalog.reserved(v.id);
              return {
                product_slug: p.slug,
                product_name_ar: p.name.ar,
                product_name_en: p.name.en ?? null,
                brand: p.brandSlug,
                category: p.categorySlugs[0] ?? null,
                sku: v.sku,
                barcode: v.barcode,
                storage: v.options.storage ?? null,
                color: color?.label.en ?? null,
                price: v.price,
                compare_at_price: v.compareAtPrice,
                stock,
                reserved,
                available: stock - reserved,
                low_stock_threshold: v.lowStockThreshold,
                active: v.isActive,
                is_demo: true,
              };
            }),
        );
        break;
      case 'orders':
        requireAny(actor, 'orders.view');
        rows = [...this.ctx.commerce.orderRecords()]
          .filter(
            (o) =>
              (!filter.from || o.createdAt >= String(filter.from)) &&
              (!filter.to || o.createdAt < String(filter.to)),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((o) => ({
            order_number: o.orderNumber,
            created_at: o.createdAt,
            status: o.status,
            payment_method: o.paymentMethod,
            payment_status: o.paymentStatus,
            fulfillment: o.fulfillment.method,
            customer_name: o.customer.name,
            customer_phone: o.customer.phone,
            subtotal: o.totals.subtotal,
            discount: o.totals.discountTotal,
            shipping_fee: o.totals.shippingFee,
            total: o.totals.total,
            paid: o.totals.paidAmount,
            remaining: o.totals.remainingAmount,
            is_demo: true,
          }));
        break;
      case 'customers':
        requireAny(actor, 'customers.view');
        rows = this.ops.listCustomers(actor, { limit: 200 }).items.map((c) => ({
          name: c.name,
          email: c.email,
          phone: c.phone,
          joined_at: c.joinedAt,
          ordersCount: c.ordersCount,
          lifetimeValue: c.lifetimeValue,
          lastOrderAt: c.lastOrderAt,
          openRequests: c.openRequests,
          wishlistCount: c.wishlistCount,
        }));
        break;
      case 'repair':
      case 'trade_in':
      case 'used':
      case 'after_sales':
        requireAny(actor, SERVICE_VIEW[kind]);
        rows = this.ops
          .listServiceRequests(actor, kind, { view: 'all', limit: 200 })
          .items.map((r) => ({
            number: r.number,
            created_at: r.createdAt,
            status: r.status,
            priority: r.priority,
            contact_name: r.contactName,
            contact_phone: r.contactPhone,
            device_category: r.deviceCategory,
            after_sales_type: r.afterSalesType,
            sla: r.sla,
            is_demo: true,
          }));
        break;
      case 'price_history':
        rows = this.catalog.listPriceHistory(actor, { limit: 200 }).items.map((h) => ({
          created_at: h.createdAt,
          sku: h.sku,
          old_price: h.oldPrice,
          new_price: h.newPrice,
          old_compare_at: h.oldCompareAt,
          new_compare_at: h.newCompareAt,
          reason: h.reason,
          source: h.source,
          actor: h.actorName,
        }));
        break;
      case 'stock_movements':
        rows = this.catalog.listStockMovements(actor, { limit: 200 }).items.map((m) => ({
          created_at: m.createdAt,
          sku: m.sku,
          type: m.type,
          before: m.quantityBefore,
          change: m.change,
          after: m.quantityAfter,
          reason: m.reason,
          order_number: m.orderNumber,
          actor: m.actorName,
        }));
        break;
      default:
        throw new RangeError('unknown_export');
    }
    this.ctx.audit(actor, `export.${kind}`, 'export', kind, null, null, { rows: rows.length });
    return { kind, generatedAt: this.ctx.now().toISOString(), rows };
  }

  exportBackup(actor: AdminActor): Record<string, unknown> {
    requireAny(actor, 'data.backup');
    this.ctx.audit(actor, 'data.backup_exported', 'backup', null);
    const system = this.systemActor();
    return {
      format: 'malek-store-backup',
      version: 1,
      generatedAt: this.ctx.now().toISOString(),
      note: 'DEMO backup of this browser preview. Configuration, catalog and content only. It does not replace your database provider backups and contains no customer, order or authentication data.',
      settings: Object.fromEntries(
        Object.entries(this.ctx.settings.backup()).map(([k, v]) => [k, { value: v }]),
      ),
      brands: this.catalog.listBrands(system),
      categories: this.catalog.listCategories(system),
      products: this.ctx.raw.products
        .filter((p) => !p.deletedAt)
        .map((p) => {
          const doc = this.catalog.productJson(p);
          return {
            ...doc,
            variants: doc.variants.map(
              ({ lastPriceChange: _l, reserved: _r, available: _a, ...v }) => v,
            ),
          };
        }),
      offers: this.ctx.raw.offers,
      entries: this.ctx.raw.entries,
      notificationTemplates: this.ops.notificationAdmin(system).templates,
      roles: this.ctx.access.roles().map((r) => ({
        key: r.key,
        rank: r.rank,
        grantsAll: r.grantsAll,
        permissions: r.permissions,
      })),
    };
  }

  // ── Import (preview → confirm) ────────────────────────────────────────────
  private validateRow(
    actor: AdminActor,
    row: Partial<Record<ImportField, string>>,
    seen: Set<string>,
    newSlugs: Set<string>,
  ): Omit<ImportRowResult, 'rowNo'> {
    const errors: string[] = [];
    const sku = (row.sku ?? '').trim().toUpperCase();
    const slug = (row.productSlug ?? '').trim().toLowerCase();
    const price = numberOrNaN(row.price);
    const stockText = row.stock?.trim() || null;
    const storage = storageKey(row.storage);
    const color = colorKey(row.color);
    if (
      (['sku', 'productSlug', 'brand', 'category'] as const).some((k) =>
        /^\s*[=+@]/.test(row[k] ?? ''),
      )
    )
      errors.push('formula_not_allowed');
    if (!SKU_PATTERN.test(sku)) errors.push('invalid_sku');
    if (seen.has(sku)) errors.push('duplicate_in_file');
    if (price !== null && (Number.isNaN(price) || price < 0 || price > 10_000_000))
      errors.push('invalid_price');
    if (stockText !== null && !/^[0-9]{1,6}$/.test(stockText)) errors.push('invalid_stock');
    if (storage === '!invalid') errors.push('invalid_storage');
    const found = this.ctx.raw.products
      .filter((p) => !p.deletedAt)
      .flatMap((p) => p.variants.filter((v) => !v.retiredAt).map((v) => ({ p, v })))
      .find((x) => x.v.sku === sku);
    let action: ImportRowResult['action'];
    let brandId: string | null = null;
    let categoryId: string | null = null;
    let product: RawProduct | undefined;
    if (found) {
      action = 'update';
      product = found.p;
      if (slug && slug !== found.p.slug) errors.push('sku_belongs_to_other_product');
      if (row.price?.trim() && price !== found.v.price && !actor.can('pricing.manage'))
        errors.push('pricing_forbidden');
      const onHand = this.catalog.onHand(found.v.id);
      if (stockText && Number(stockText) !== onHand && !actor.can('inventory.manage'))
        errors.push('inventory_forbidden');
      if (
        stockText &&
        /^[0-9]{1,6}$/.test(stockText) &&
        Number(stockText) < this.catalog.reserved(found.v.id)
      )
        errors.push('below_reserved');
    } else {
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) errors.push('invalid_slug');
      if (price === null) errors.push('price_required');
      if (price !== null && !actor.can('pricing.manage')) errors.push('pricing_forbidden');
      if ((stockText ?? '0') !== '0' && !actor.can('inventory.manage'))
        errors.push('inventory_forbidden');
      if (this.ctx.raw.products.some((p) => p.variants.some((v) => v.sku === sku && v.retiredAt)))
        errors.push('sku_retired');
      product = this.ctx.raw.products.find((p) => p.slug === slug && !p.deletedAt);
      if (!product && newSlugs.has(slug)) action = 'create_variant';
      else if (product) {
        action = 'create_variant';
        const keys = product.options.map((o) => o.key);
        if (
          (storage === null) === keys.includes('storage') ||
          (color === null) === keys.includes('color') ||
          keys.some((k) => k !== 'storage' && k !== 'color')
        )
          errors.push('options_mismatch');
      } else {
        action = 'create_product';
        if (!row.nameAr?.trim()) errors.push('name_required');
        const b = (row.brand ?? '').trim();
        brandId =
          this.ctx.raw.brands.find(
            (x) =>
              !x.deletedAt &&
              (x.slug === b.toLowerCase() ||
                x.name.en?.toLowerCase() === b.toLowerCase() ||
                x.name.ar === b),
          )?.id ?? null;
        if (!brandId) errors.push('unknown_brand');
        const c = (row.category ?? '').trim();
        categoryId =
          this.ctx.raw.categories.find(
            (x) =>
              !x.deletedAt &&
              (x.slug === c.toLowerCase() ||
                x.name.en?.toLowerCase() === c.toLowerCase() ||
                x.name.ar === c),
          )?.id ?? null;
        if (!categoryId) errors.push('unknown_category');
      }
    }
    return {
      action: errors.length ? 'error' : action,
      errors,
      data: {
        sku,
        productSlug: slug || product?.slug || null,
        nameAr: row.nameAr?.trim() || null,
        nameEn: row.nameEn?.trim() || null,
        brandId,
        categoryId,
        price: price !== null && !Number.isNaN(price) ? price : null,
        compareAtPrice: null,
        stock: stockText && /^[0-9]{1,6}$/.test(stockText) ? Number(stockText) : null,
        storage: storage === '!invalid' ? null : storage,
        storageLabel: row.storage?.trim() || null,
        color,
        colorLabel: row.color?.trim() || null,
        colorHex: row.colorHex && /^#[0-9a-fA-F]{6}$/.test(row.colorHex) ? row.colorHex : null,
        lowStockThreshold:
          row.lowStockThreshold && /^[0-9]{1,4}$/.test(row.lowStockThreshold)
            ? Number(row.lowStockThreshold)
            : null,
        productId: product?.id ?? null,
        variantId: found?.v.id ?? null,
        currentPrice: found?.v.price ?? null,
        currentStock: found ? this.catalog.onHand(found.v.id) : null,
      },
    };
  }

  importPreview(
    actor: AdminActor,
    fileName: string,
    rows: Partial<Record<ImportField, string>>[],
  ): ImportPreview {
    requireAny(actor, 'data.import');
    if (!actor.can('catalog.manage')) throw new DemoAdminForbidden('forbidden');
    if (rows.length === 0 || rows.length > 2000) return { ok: false, code: 'invalid_rows' };
    const seen = new Set<string>();
    const newSlugs = new Set<string>();
    const results: ImportRowResult[] = rows.map((row, i) => {
      const r = this.validateRow(actor, row, seen, newSlugs);
      seen.add(String(r.data.sku));
      if (r.action === 'create_product') newSlugs.add(String(r.data.productSlug));
      return { rowNo: i + 1, ...r };
    });
    const summary = {
      total: results.length,
      createProduct: results.filter((r) => r.action === 'create_product').length,
      createVariant: results.filter((r) => r.action === 'create_variant').length,
      update: results.filter((r) => r.action === 'update').length,
      errors: results.filter((r) => r.action === 'error').length,
    };
    const job = {
      id: this.ctx.uuid(),
      fileName: fileName.slice(0, 200) || null,
      status: 'previewed' as const,
      rows: results,
      summary,
      error: null,
      createdAt: this.ctx.now().toISOString(),
      committedAt: null,
      createdBy: actor.name,
    };
    this.ctx.state.importJobs = [job, ...this.ctx.state.importJobs].slice(0, 20);
    this.ctx.audit(actor, 'import.previewed', 'import', job.id, null, null, summary);
    this.ctx.persist();
    return { ok: true, jobId: job.id, summary, rows: results };
  }

  importCommit(actor: AdminActor, jobId: string, validOnly: boolean): ImportCommit {
    requireAny(actor, 'data.import');
    if (!actor.can('catalog.manage')) throw new DemoAdminForbidden('forbidden');
    const job = this.ctx.state.importJobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, code: 'not_found' };
    if (job.status !== 'previewed') return { ok: false, code: `already_${job.status}` };
    if (this.ctx.now().getTime() - new Date(job.createdAt).getTime() > 3_600_000) {
      job.status = 'cancelled';
      job.error = 'expired';
      this.ctx.persist();
      return { ok: false, code: 'expired' };
    }
    if (!validOnly && job.rows.some((r) => r.action === 'error'))
      return { ok: false, code: 'has_errors' };
    // All-or-nothing: re-validate every row against the current catalog before changing anything.
    const seen = new Set<string>();
    const newSlugs = new Set<string>();
    const checks = job.rows
      .filter((r) => r.action !== 'error')
      .map((r) => {
        const d = r.data;
        const brand = this.ctx.raw.brands.find((b) => b.id === d.brandId)?.slug;
        const category = this.ctx.raw.categories.find((c) => c.id === d.categoryId)?.slug;
        const check = this.validateRow(
          actor,
          {
            sku: String(d.sku ?? ''),
            productSlug: d.productSlug ? String(d.productSlug) : undefined,
            nameAr: d.nameAr ? String(d.nameAr) : undefined,
            nameEn: d.nameEn ? String(d.nameEn) : undefined,
            brand,
            category,
            price: d.price !== null && d.price !== undefined ? String(d.price) : undefined,
            stock: d.stock !== null && d.stock !== undefined ? String(d.stock) : undefined,
            storage: d.storageLabel ? String(d.storageLabel) : undefined,
            color: d.colorLabel ? String(d.colorLabel) : undefined,
            colorHex: d.colorHex ? String(d.colorHex) : undefined,
            lowStockThreshold:
              d.lowStockThreshold !== null && d.lowStockThreshold !== undefined
                ? String(d.lowStockThreshold)
                : undefined,
          },
          seen,
          newSlugs,
        );
        seen.add(String(check.data.sku));
        if (check.action === 'create_product') newSlugs.add(String(check.data.productSlug));
        return { rowNo: r.rowNo, check };
      });
    const failed = checks.find((c) => c.check.action === 'error');
    if (failed) {
      job.status = 'failed';
      job.error = `row ${failed.rowNo}: ${failed.check.errors.join(', ')}`;
      this.ctx.persist();
      return { ok: false, code: 'failed', message: job.error };
    }
    const snapshot = structuredClone(this.ctx.raw);
    try {
      for (const { check } of checks) this.applyImportRow(actor, job.fileName, check);
    } catch (error) {
      // Restore the catalog exactly as it was (the preview promised all-or-nothing).
      Object.assign(this.ctx.raw, snapshot);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'failed';
      this.ctx.persist();
      return { ok: false, code: 'failed', message: job.error };
    }
    job.status = 'committed';
    job.committedAt = this.ctx.now().toISOString();
    job.summary = { ...job.summary, applied: checks.length };
    this.ctx.audit(actor, 'import.committed', 'import', job.id, null, null, {
      applied: checks.length,
      validOnly,
    });
    this.ctx.persist();
    this.ctx.catalogChanged();
    return { ok: true, applied: checks.length };
  }

  private applyImportRow(
    actor: AdminActor,
    fileName: string | null,
    check: Omit<ImportRowResult, 'rowNo'>,
  ) {
    const d = check.data as Record<string, string | number | null>;
    const now = this.ctx.stamp();
    const note = `Import ${fileName ?? ''}`.slice(0, 500);
    if (check.action === 'update') {
      const found = this.catalog.variantById(String(d.variantId));
      if (!found) throw new Error('variant_missing');
      const before = { price: found.variant.price, compareAt: found.variant.compareAtPrice };
      if (d.price !== null) found.variant.price = Number(d.price);
      if (d.lowStockThreshold !== null)
        found.variant.lowStockThreshold = Number(d.lowStockThreshold);
      if (
        found.variant.compareAtPrice !== null &&
        found.variant.price !== null &&
        found.variant.compareAtPrice <= found.variant.price
      )
        found.variant.compareAtPrice = null;
      found.variant.updatedAt = now;
      if (
        before.price !== found.variant.price ||
        before.compareAt !== found.variant.compareAtPrice
      ) {
        this.ctx.state.seq += 1;
        this.ctx.state.priceHistory.push({
          id: this.ctx.state.seq,
          createdAt: now,
          variantId: found.variant.id,
          productId: found.product.id,
          oldPrice: before.price,
          newPrice: found.variant.price,
          oldCompareAt: before.compareAt,
          newCompareAt: found.variant.compareAtPrice,
          reason: `Import: ${fileName ?? ''}`,
          source: 'import',
          actorName: actor.name,
        });
      }
      if (d.stock !== null) {
        const delta = Number(d.stock) - this.catalog.onHand(found.variant.id);
        if (delta !== 0)
          this.ctx.commerce.applyStockChange(found.variant.id, delta, {
            reason: 'import',
            note,
            actorName: actor.name,
          });
      }
      return;
    }
    let product =
      check.action === 'create_variant'
        ? this.ctx.raw.products.find((p) => p.slug === d.productSlug && !p.deletedAt)
        : undefined;
    if (check.action === 'create_product') {
      const brand = this.ctx.raw.brands.find((b) => b.id === d.brandId);
      const category = this.ctx.raw.categories.find((c) => c.id === d.categoryId);
      if (!brand || !category) throw new Error('brand_or_category_missing');
      product = {
        id: this.ctx.uuid(),
        slug: String(d.productSlug),
        brandSlug: brand.slug,
        categorySlugs: [category.slug],
        model: null,
        name: { ar: String(d.nameAr), en: String(d.nameEn ?? d.nameAr) },
        subtitle: null,
        description: null,
        availabilityState: 'available',
        isNew: false,
        isFeatured: false,
        releaseDate: null,
        warranty: null,
        bestSellerScore: 0,
        keywords: '',
        status: 'draft',
        isVisible: true,
        warrantyKind: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        options: [
          ...(d.storage
            ? [{ key: 'storage', name: { ar: 'المساحة', en: 'Storage' }, values: [] }]
            : []),
          ...(d.color ? [{ key: 'color', name: { ar: 'اللون', en: 'Colour' }, values: [] }] : []),
        ],
        variants: [],
        media: [],
        specGroups: [],
        relations: [],
        seo: { title: null, description: null },
      };
      this.ctx.raw.products.push(product);
    }
    if (!product) throw new Error('product_missing');
    const options: Record<string, string> = {};
    if (d.storage) {
      const opt = product.options.find((o) => o.key === 'storage');
      if (!opt) throw new Error('options_mismatch');
      if (!opt.values.some((v) => v.key === d.storage))
        opt.values.push({
          key: String(d.storage),
          label: { ar: String(d.storage).toUpperCase(), en: String(d.storage).toUpperCase() },
          hex: null,
        });
      options.storage = String(d.storage);
    }
    if (d.color) {
      const opt = product.options.find((o) => o.key === 'color');
      if (!opt) throw new Error('options_mismatch');
      if (!opt.values.some((v) => v.key === d.color))
        opt.values.push({
          key: String(d.color),
          label: { ar: String(d.colorLabel), en: String(d.colorLabel) },
          hex: d.colorHex ? String(d.colorHex) : null,
        });
      options.color = String(d.color);
    }
    const variant = {
      id: this.ctx.uuid(),
      sku: String(d.sku),
      options,
      price: d.price === null ? null : Number(d.price),
      compareAtPrice: null,
      stock: 0,
      lowStockThreshold: d.lowStockThreshold === null ? 2 : Number(d.lowStockThreshold),
      isActive: true,
      isDefault: !product.variants.some((v) => !v.retiredAt),
      warranty: null,
      barcode: null,
      warrantyKind: null,
      updatedAt: now,
      retiredAt: null,
    };
    product.variants.push(variant);
    product.updatedAt = now;
    this.ctx.state.seq += 1;
    this.ctx.state.priceHistory.push({
      id: this.ctx.state.seq,
      createdAt: now,
      variantId: variant.id,
      productId: product.id,
      oldPrice: null,
      newPrice: variant.price,
      oldCompareAt: null,
      newCompareAt: null,
      reason: `Import: ${fileName ?? ''}`,
      source: 'import',
      actorName: actor.name,
    });
    if (Number(d.stock ?? 0) > 0)
      this.ctx.commerce.applyStockChange(variant.id, Number(d.stock), {
        reason: 'import',
        note,
        actorName: actor.name,
      });
  }

  listImportJobs(actor: AdminActor): ImportJob[] {
    requireAny(actor, 'data.import');
    return this.ctx.state.importJobs.map((j) => ({
      id: j.id,
      fileName: j.fileName,
      status: j.status,
      rowCount: j.rows.length,
      summary: j.summary,
      error: j.error,
      createdAt: j.createdAt,
      committedAt: j.committedAt,
      createdBy: j.createdBy,
    }));
  }
}
