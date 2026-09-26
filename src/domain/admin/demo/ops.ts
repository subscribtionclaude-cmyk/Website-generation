import type { LocalizedText } from '@/domain/localized';
import {
  NOTIFICATION_TEMPLATES,
  setDemoTemplateOverrides,
  unknownPlaceholder,
} from '@/domain/customer/templates';
import { isTerminal } from '@/domain/services/status';
import type { ServiceKind } from '@/domain/services/types';
import type { DemoServiceRecord } from '@/domain/services/demoServices';
import { normalizeEgyptianPhone } from '@/lib/phone';
import type {
  AbandonedCartFilter,
  AbandonedCartRow,
  AdminResult,
  AdminReview,
  AdminReviewFilter,
  AdminServiceFilter,
  AdminServicePage,
  AdminServiceRow,
  Assignee,
  CustomerDetail,
  CustomerFilter,
  CustomerListItem,
  FollowUpState,
  NotificationAdmin,
  Recipient,
  ServiceContext,
  ServicePriority,
  WaitlistFilter,
  WaitlistRow,
} from '../schemas';
import { FOLLOW_UP_STATES, SERVICE_PRIORITIES } from '../schemas';
import { PRIORITY_ORDER, slaHoursFor, slaState, viewMatches } from '../sla';
import { validLt } from '../validation';
import {
  type AdminActor,
  type DemoAdminContext,
  matchesText,
  type Page,
  paginate,
  requireAny,
} from './context';

const SERVICE_PERMISSION = {
  repair: { view: 'repairs.view', manage: 'repairs.manage' },
  trade_in: { view: 'tradein.view', manage: 'tradein.manage' },
  used: { view: 'used_requests.view', manage: 'used_requests.manage' },
  after_sales: { view: 'after_sales.view', manage: 'after_sales.manage' },
} as const;

const demoEmail = (userId: string) =>
  userId.startsWith('demo-customer-') ? userId.slice('demo-customer-'.length) : null;

/** DEMO MODE ONLY — orders / customers / services / engagement administration (see context.ts). */
export class DemoAdminOps {
  private readonly ctx: DemoAdminContext;

  constructor(ctx: DemoAdminContext) {
    this.ctx = ctx;
    this.syncTemplates();
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  orderAssignees(actor: AdminActor): Assignee[] {
    requireAny(actor, 'orders.view');
    return this.ctx.access
      .staffIds()
      .filter((id) => !this.ctx.access.isSuspended(id))
      .filter((id) => this.ctx.access.actor(id, null).can('orders.manage'))
      .map((id) => ({ id, name: this.ctx.staffName(id) }));
  }

  assignOrder(actor: AdminActor, orderId: string, staffId: string | null): AdminResult {
    requireAny(actor, 'orders.manage');
    if (staffId && !this.ctx.access.actor(staffId, null).can('orders.manage'))
      return { ok: false, code: 'invalid_staff' };
    const result = this.ctx.commerce.assignOrder(actor, orderId, staffId);
    if (result.ok)
      this.ctx.audit(actor, 'order.assigned', 'public.orders', orderId, null, { staffId });
    return result;
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  private isStaffId(id: string) {
    return (
      (id.startsWith('demo-') && !id.startsWith('demo-customer-')) ||
      this.ctx.access.roleKeys(id).length > 0
    );
  }

  private customerIds(): string[] {
    const ids = new Set<string>(Object.keys(this.ctx.customer.adminState().profiles));
    for (const o of this.ctx.commerce.orderRecords()) ids.add(o.customerId);
    return [...ids].filter((id) => !this.isStaffId(id));
  }

  private customerEmail(id: string) {
    return (
      demoEmail(id) ??
      this.ctx.commerce.orderRecords().find((o) => o.customerId === id && o.customer.email)
        ?.customer.email ??
      null
    );
  }

  private stats(id: string) {
    const orders = this.ctx.commerce.orderRecords().filter((o) => o.customerId === id);
    const state = this.ctx.customer.adminState();
    const openRequests =
      this.ctx.services.records().filter((r) => r.userId === id && !isTerminal(r.status)).length +
      state.requests.filter(
        (r) => r.userId === id && (r.status === 'pending' || r.status === 'waiting'),
      ).length;
    return {
      ordersCount: orders.length,
      lifetimeValue: orders
        .filter((o) => o.status !== 'cancelled')
        .reduce((n, o) => n + o.totals.paidAmount, 0),
      lastOrderAt:
        orders
          .map((o) => o.createdAt)
          .sort()
          .pop() ?? null,
      openRequests,
      wishlistCount: state.wishlist[id]?.length ?? 0,
    };
  }

  listCustomers(actor: AdminActor, filter: CustomerFilter): Page<CustomerListItem> {
    requireAny(actor, 'customers.view');
    const profiles = this.ctx.customer.adminState().profiles;
    const digits = filter.q?.replace(/[^0-9]/g, '') ?? '';
    const rows = this.customerIds()
      .map((id): CustomerListItem => {
        const p = profiles[id];
        const order = this.ctx.commerce.orderRecords().find((o) => o.customerId === id);
        return {
          id,
          name: p?.fullName ?? order?.customer.name ?? null,
          email: this.customerEmail(id),
          phone: p?.phone ?? order?.customer.phone ?? null,
          joinedAt: p?.createdAt ?? order?.createdAt ?? null,
          preferredLocale: p?.preferredLocale ?? null,
          ...this.stats(id),
        };
      })
      .filter(
        (c) =>
          matchesText(filter.q, c.name, c.email) ||
          (digits.length >= 4 && (c.phone ?? '').replace(/[^0-9]/g, '').includes(digits)),
      );
    const sort = filter.sort ?? 'joined_desc';
    rows.sort((a, b) =>
      sort === 'orders_desc'
        ? b.ordersCount - a.ordersCount
        : sort === 'value_desc'
          ? b.lifetimeValue - a.lifetimeValue
          : sort === 'last_order_desc'
            ? (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? '')
            : (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''),
    );
    return paginate(rows, filter);
  }

  getCustomer(actor: AdminActor, id: string): CustomerDetail | null {
    requireAny(actor, 'customers.view');
    if (!this.customerIds().includes(id)) return null;
    const state = this.ctx.customer.adminState();
    const p = state.profiles[id];
    const orders = this.ctx.commerce
      .orderRecords()
      .filter((o) => o.customerId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const engine = this.ctx.engine();
    const followUp = this.ctx.state.followUps[id];
    const cart = this.ctx.commerce.getCart(id);
    return {
      id,
      name: p?.fullName ?? orders[0]?.customer.name ?? null,
      email: this.customerEmail(id),
      phone: p?.phone ?? orders[0]?.customer.phone ?? null,
      preferredLocale: p?.preferredLocale ?? null,
      joinedAt: p?.createdAt ?? null,
      isStaff: false,
      lastSignInAt: null,
      stats: this.stats(id),
      addresses: (state.addresses[id] ?? []).map((a) => ({
        id: a.id,
        label: a.label ?? null,
        governorate: a.governorate,
        area: a.area,
        address: a.address,
        notes: a.notes ?? null,
        phone: a.phone ?? null,
        isDefault: a.isDefault,
      })),
      orders: actor.can('orders.view')
        ? orders.slice(0, 20).map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            createdAt: o.createdAt,
            status: o.status,
            paymentStatus: o.paymentStatus,
            total: o.totals.total,
            isDemo: true,
          }))
        : null,
      serviceRequests: this.ctx.services
        .records()
        .filter((r) => r.userId === id && actor.can(SERVICE_PERMISSION[r.kind].view))
        .slice(-20)
        .reverse()
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          number: r.number,
          status: r.status,
          title: this.ctx.services.titleOf(r),
          createdAt: r.createdAt,
          isDemo: true,
        })),
      reviews: state.reviews
        .filter((r) => r.userId === id)
        .map((r) => {
          const product = this.ctx.raw.products.find((x) => x.id === r.productId);
          return {
            id: r.id,
            rating: r.rating,
            status: r.status,
            createdAt: r.createdAt,
            product: product ? { slug: product.slug, name: product.name } : null,
          };
        }),
      notifications: state.notifications
        .filter((n) => n.userId === id)
        .slice(-20)
        .reverse()
        .map((n) => ({
          id: n.id,
          category: n.category,
          title: n.title,
          createdAt: n.createdAt,
          read: n.readAt !== null,
        })),
      notes: this.ctx.state.notes
        .filter((n) => n.customerId === id)
        .sort(
          (a, b) =>
            Number(b.isPinned) - Number(a.isPinned) || b.createdAt.localeCompare(a.createdAt),
        )
        .map((n) => ({
          id: n.id,
          body: n.body,
          isPinned: n.isPinned,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          authorName: n.authorName,
        })),
      activity: {
        cartItems: cart.items.filter((i) => !i.savedForLater && engine.variant(i.variantId)).length,
        recentlyViewed: state.recent[id]?.length ?? 0,
        followUp: followUp ?? null,
      },
    };
  }

  saveCustomerNote(
    actor: AdminActor,
    customerId: string,
    noteId: string | null,
    body: string,
    pinned: boolean,
    expectedUpdatedAt: string | null,
  ): AdminResult<{ id: string; updatedAt: string }> {
    requireAny(actor, 'customers.manage');
    const text = body.trim();
    if (text.length < 1 || text.length > 4000) return { ok: false, code: 'invalid_note' };
    if (!this.customerIds().includes(customerId)) return { ok: false, code: 'not_found' };
    const now = this.ctx.stamp();
    if (noteId) {
      const note = this.ctx.state.notes.find((n) => n.id === noteId && n.customerId === customerId);
      if (!note) return { ok: false, code: 'not_found' };
      if (note.updatedAt !== expectedUpdatedAt) return { ok: false, code: 'stale' };
      const before = { body: note.body, isPinned: note.isPinned };
      note.body = text;
      note.isPinned = pinned;
      note.updatedAt = now;
      this.ctx.audit(actor, 'update', 'public.customer_notes', note.id, before, {
        body: text,
        isPinned: pinned,
      });
      this.ctx.persist();
      return { ok: true, id: note.id, updatedAt: now };
    }
    const id = this.ctx.uuid();
    this.ctx.state.notes.push({
      id,
      customerId,
      body: text,
      isPinned: pinned,
      createdAt: now,
      updatedAt: now,
      authorName: actor.name,
    });
    this.ctx.audit(actor, 'insert', 'public.customer_notes', id, null, {
      customerId,
      body: text,
      isPinned: pinned,
    });
    this.ctx.persist();
    return { ok: true, id, updatedAt: now };
  }

  deleteCustomerNote(actor: AdminActor, noteId: string): AdminResult {
    requireAny(actor, 'customers.manage');
    const note = this.ctx.state.notes.find((n) => n.id === noteId);
    if (!note) return { ok: false, code: 'not_found' };
    this.ctx.state.notes = this.ctx.state.notes.filter((n) => n.id !== noteId);
    this.ctx.audit(actor, 'delete', 'public.customer_notes', noteId, { body: note.body }, null);
    this.ctx.persist();
    return { ok: true };
  }

  // ── Abandoned carts ───────────────────────────────────────────────────────
  listAbandonedCarts(
    actor: AdminActor,
    filter: AbandonedCartFilter,
  ): Page<AbandonedCartRow> & {
    settings: { enabled: boolean; thresholdHours: number; followUp: string };
  } {
    requireAny(actor, 'customers.view');
    const list = this.ctx.customer.abandonedCarts(actor);
    const engine = this.ctx.engine();
    const profiles = this.ctx.customer.adminState().profiles;
    const nowMs = this.ctx.now().getTime();
    const rows = list.items
      .map((row): AbandonedCartRow => {
        const cart = this.ctx.commerce.getCart(row.customerId);
        const value = cart.items
          .filter((i) => !i.savedForLater)
          .reduce((n, i) => n + i.quantity * (engine.variant(i.variantId)?.price ?? 0), 0);
        const f = this.ctx.state.followUps[row.customerId];
        return {
          customerId: row.customerId,
          customerName: row.customerName ?? row.email?.split('@')[0] ?? null,
          email: row.email,
          phone: profiles[row.customerId]?.phone ?? null,
          itemCount: row.itemCount,
          lastActivity: row.lastActivity,
          cartValue: value,
          followUp: f?.state ?? 'none',
          followUpNote: f?.note ?? null,
          followUpAt: f?.updatedAt ?? null,
          reminded: row.reminded,
          items: row.items,
        };
      })
      .filter(
        (r) =>
          (filter.minHours == null ||
            nowMs - new Date(r.lastActivity).getTime() > filter.minHours * 3_600_000) &&
          (filter.minValue == null || r.cartValue >= filter.minValue) &&
          (!filter.state || r.followUp === filter.state) &&
          matchesText(filter.q, r.email, r.customerName),
      );
    return { ...paginate(rows, filter), settings: list.settings };
  }

  setCartFollowup(
    actor: AdminActor,
    customerId: string,
    state: FollowUpState,
    note: string | null,
  ): AdminResult {
    requireAny(actor, 'customers.manage');
    if (!FOLLOW_UP_STATES.includes(state)) return { ok: false, code: 'invalid_state' };
    if (note && note.length > 1000) return { ok: false, code: 'invalid_note' };
    const before = this.ctx.state.followUps[customerId] ?? null;
    this.ctx.state.followUps[customerId] = {
      state,
      note: note?.trim() || null,
      updatedAt: this.ctx.stamp(),
    };
    this.ctx.audit(
      actor,
      'update',
      'public.cart_followups',
      customerId,
      before,
      this.ctx.state.followUps[customerId],
    );
    this.ctx.persist();
    return { ok: true };
  }

  // ── Service queues ────────────────────────────────────────────────────────
  private lastChange(r: DemoServiceRecord) {
    const times = r.events
      .filter((e) => ['status', 'created', 'customer_response'].includes(e.type))
      .map((e) => e.createdAt);
    return times.sort().pop() ?? r.createdAt;
  }

  private slaSubject(r: DemoServiceRecord) {
    return {
      status: r.status,
      awaitingCustomer: r.awaitingCustomer,
      openOffer: r.offers.some((o) => o.status === 'sent'),
      lastChangeAt: this.lastChange(r),
    };
  }

  private slaHours(kind: ServiceKind) {
    return slaHoursFor(this.ctx.settings.published('service_sla'), kind);
  }

  priority(id: string): ServicePriority {
    return this.ctx.state.priorities[id] ?? 'normal';
  }

  listServiceRequests(
    actor: AdminActor,
    kind: ServiceKind,
    filter: AdminServiceFilter,
  ): AdminServicePage {
    requireAny(actor, SERVICE_PERMISSION[kind].view);
    const now = this.ctx.now();
    const hours = this.slaHours(kind);
    const q = filter.q?.trim();
    const digits = q?.replace(/[^0-9]/g, '') ?? '';
    const base = this.ctx.services
      .records()
      .filter((r) => r.kind === kind)
      .map((r) => {
        const subject = this.slaSubject(r);
        const device = (r.details.device ?? {}) as Record<string, unknown>;
        return { r, subject, sla: slaState(subject, hours, now), device };
      })
      .filter(({ r, device }) => {
        const budget = typeof device.budget === 'number' ? device.budget : null;
        return (
          (!filter.status || r.status === filter.status) &&
          (!filter.assigned ||
            (filter.assigned === 'me'
              ? r.assignedTo === actor.userId
              : filter.assigned === 'unassigned'
                ? r.assignedTo === null
                : r.assignedTo === filter.assigned)) &&
          (!filter.priority || this.priority(r.id) === filter.priority) &&
          (!filter.deviceCategory || r.deviceCategory === filter.deviceCategory) &&
          (!filter.afterSalesType || r.afterSalesType === filter.afterSalesType) &&
          (!filter.battery || device.batteryPreference === filter.battery) &&
          (!filter.tax || device.taxPreference === filter.tax) &&
          (filter.budgetMin == null || (budget !== null && budget >= filter.budgetMin)) &&
          (filter.budgetMax == null || (budget !== null && budget <= filter.budgetMax)) &&
          (!filter.from || r.createdAt >= filter.from) &&
          (!filter.to || r.createdAt < filter.to) &&
          (!q ||
            matchesText(q, r.number, r.contactName, r.brand, r.model) ||
            (digits.length > 0 && r.contactPhone.includes(digits)))
        );
      });
    const view = filter.view ?? 'open';
    const matched = base
      .filter((b) => viewMatches(b.subject, view) && (!filter.sla || b.sla === filter.sla))
      .sort(
        (a, b) =>
          PRIORITY_ORDER[this.priority(a.r.id)] - PRIORITY_ORDER[this.priority(b.r.id)] ||
          a.r.createdAt.localeCompare(b.r.createdAt),
      );
    const page = paginate(matched, filter);
    const count = (fn: (b: (typeof base)[number]) => boolean) => base.filter(fn).length;
    return {
      ok: true,
      total: page.total,
      items: page.items.map(({ r, sla, device }): AdminServiceRow => {
        const title = this.ctx.services.titleOf(r);
        return {
          id: r.id,
          kind: r.kind,
          number: r.number,
          status: r.status,
          title,
          deviceCategory: r.deviceCategory,
          afterSalesType: r.afterSalesType,
          awaitingCustomer: r.awaitingCustomer,
          openOffer: r.offers.some((o) => o.status === 'sent'),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          isDemo: true,
          contactName: r.contactName,
          contactPhone: r.contactPhone,
          priority: this.priority(r.id),
          sla,
          lastChangeAt: this.lastChange(r),
          ageHours: Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 3_600_000),
          budget: typeof device.budget === 'number' ? device.budget : null,
          batteryPreference:
            typeof device.batteryPreference === 'string' ? device.batteryPreference : null,
          taxPreference: typeof device.taxPreference === 'string' ? device.taxPreference : null,
          product: r.kind === 'after_sales' ? title : null,
          assignedTo: r.assignedTo
            ? { id: r.assignedTo, name: this.ctx.staffName(r.assignedTo) }
            : null,
        };
      }),
      counts: {
        new: count((b) => viewMatches(b.subject, 'new')),
        awaiting: count((b) => viewMatches(b.subject, 'awaiting')),
        in_progress: count((b) => viewMatches(b.subject, 'in_progress')),
        ready: count((b) => viewMatches(b.subject, 'ready')),
        completed: count((b) => viewMatches(b.subject, 'completed')),
        overdue: count((b) => b.sla === 'overdue'),
        approaching: count((b) => b.sla === 'approaching'),
      },
      sla: hours,
    };
  }

  setServicePriority(actor: AdminActor, id: string, priority: ServicePriority): AdminResult {
    const r = this.ctx.services.records().find((x) => x.id === id);
    if (!r) return { ok: false, code: 'not_found' };
    requireAny(actor, SERVICE_PERMISSION[r.kind].manage);
    if (!SERVICE_PRIORITIES.includes(priority)) return { ok: false, code: 'invalid_priority' };
    const before = this.priority(id);
    this.ctx.state.priorities[id] = priority;
    this.ctx.audit(
      actor,
      'service.priority_changed',
      'public.service_requests',
      id,
      { priority: before },
      { priority },
    );
    this.ctx.persist();
    return { ok: true };
  }

  serviceContext(actor: AdminActor, id: string): ServiceContext | null {
    const r = this.ctx.services.records().find((x) => x.id === id);
    if (!r) return null;
    requireAny(actor, SERVICE_PERMISSION[r.kind].view);
    return {
      priority: this.priority(id),
      sla: slaState(this.slaSubject(r), this.slaHours(r.kind), this.ctx.now()),
      slaHours: this.slaHours(r.kind),
      lastChangeAt: this.lastChange(r),
      notifications: this.ctx.customer
        .adminState()
        .notifications.filter((n) => n.dedupeKey.startsWith(`service:${id}:`))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((n) => ({
          id: n.id,
          templateKey: n.templateKey ?? null,
          title: n.title,
          createdAt: n.createdAt,
          read: n.readAt !== null,
        })),
    };
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  listReviews(actor: AdminActor, filter: AdminReviewFilter): Page<AdminReview> {
    requireAny(actor, 'reviews.moderate');
    const orders = this.ctx.commerce.orderRecords();
    const rows = this.ctx.customer
      .adminState()
      .reviews.map((r): AdminReview => {
        const product = this.ctx.raw.products.find((p) => p.id === r.productId);
        const order = orders.find((o) => o.id === r.orderId);
        return {
          id: r.id,
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: r.authorName,
          verifiedBuyer: r.verifiedBuyer,
          status: r.status,
          createdAt: r.createdAt,
          imageUrl: null,
          imagePath: r.imagePath,
          isDemo: true,
          moderationNote: r.moderationNote,
          moderatedAt: r.moderatedAt,
          orderNumber: order?.orderNumber ?? null,
          eligible: Boolean(order && order.status !== 'cancelled'),
          product: { slug: product?.slug ?? '', name: product?.name ?? { ar: '—' } },
          history: this.ctx.state.audit
            .filter((a) => a.entityType === 'public.product_reviews' && a.entityId === r.id)
            .map((a) => ({
              at: a.occurredAt,
              action: a.action,
              status: ((a.after as { status?: string } | null)?.status ?? null) as string | null,
              by: a.actorName,
            })),
        };
      })
      .filter(
        (r) =>
          (!filter.status || r.status === filter.status) &&
          (!filter.rating || r.rating === filter.rating) &&
          (!filter.from || r.createdAt >= filter.from) &&
          (!filter.to || r.createdAt < filter.to) &&
          matchesText(
            filter.q,
            r.body,
            r.title,
            r.authorName,
            r.product.slug,
            r.product.name.ar,
            r.product.name.en,
          ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(rows, filter);
  }

  // ── Waitlists / notify-me ─────────────────────────────────────────────────
  listWaitlist(actor: AdminActor, filter: WaitlistFilter): Page<WaitlistRow> {
    requireAny(actor, 'waitlists.manage');
    const engine = this.ctx.engine();
    const expiryDays = 90;
    const nowMs = this.ctx.now().getTime();
    const rows = this.ctx.customer
      .adminState()
      .requests.map((r): WaitlistRow => {
        const product = this.ctx.raw.products.find((p) => p.id === r.productId);
        const variant = r.variantId
          ? product?.variants.find((v) => v.id === r.variantId)
          : undefined;
        const available = r.variantId
          ? (engine.variant(r.variantId)?.available ?? 0) > 0
          : (product?.variants ?? []).some((v) => (engine.variant(v.id)?.available ?? 0) > 0);
        const expired = nowMs - new Date(r.createdAt).getTime() > expiryDays * 86_400_000;
        const status =
          r.status === 'pending' || r.status === 'waiting'
            ? expired
              ? 'expired'
              : 'active'
            : r.status;
        const open = status === 'active';
        return {
          id: r.id,
          kind: r.kind,
          productId: r.productId,
          productName: product?.name ?? { ar: '—' },
          productSlug: product?.slug ?? '',
          sku: variant?.sku ?? null,
          variantLabel:
            product && variant
              ? product.options.flatMap((o) => {
                  const v = o.values.find((x) => x.key === variant.options[o.key]);
                  return v ? [v.label] : [];
                })
              : null,
          customerName: r.name,
          phone: r.phone,
          email: r.email,
          hasAccount: r.userId !== null,
          status,
          createdAt: r.createdAt,
          notifiedAt: r.availableAt,
          availableNow: available,
          readiness: !open
            ? 'closed'
            : !available
              ? 'waiting'
              : r.userId
                ? 'ready_in_app'
                : 'ready_contact',
        };
      })
      .filter(
        (r) =>
          (!filter.kind || r.kind === filter.kind) &&
          (!filter.status || r.status === filter.status) &&
          (!filter.readyOnly ||
            r.readiness === 'ready_in_app' ||
            r.readiness === 'ready_contact') &&
          matchesText(
            filter.q,
            r.customerName,
            r.phone,
            r.email,
            r.sku,
            r.productSlug,
            r.productName.ar,
            r.productName.en,
          ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(rows, filter);
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  private syncTemplates() {
    setDemoTemplateOverrides(this.ctx.state.templates);
  }

  notificationAdmin(actor: AdminActor): NotificationAdmin {
    requireAny(actor, 'notifications.manage');
    const channels = (this.ctx.settings.published('notifications')?.channels ?? {}) as Record<
      string,
      { enabled: boolean }
    >;
    const since = this.ctx.now().getTime() - 30 * 86_400_000;
    const sent = this.ctx.customer
      .adminState()
      .notifications.filter((n) => new Date(n.createdAt).getTime() >= since);
    return {
      channels: { in_app: { enabled: true }, ...channels },
      templates: Object.entries(NOTIFICATION_TEMPLATES)
        .map(([key, t]) => {
          const o = this.ctx.state.templates[key];
          return {
            key,
            category: t.category,
            title: o?.title ?? t.title,
            body: o?.body ?? t.body,
            isActive: o?.isActive ?? true,
            updatedAt: o?.updatedAt ?? '2026-01-01T00:00:00.000Z',
            sent30d: sent.filter((n) => n.templateKey === key).length,
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  saveTemplate(
    actor: AdminActor,
    key: string,
    title: LocalizedText,
    body: LocalizedText,
    isActive: boolean,
    expectedUpdatedAt: string | null,
  ): AdminResult<{ updatedAt: string }> {
    requireAny(actor, 'notifications.manage');
    const base = NOTIFICATION_TEMPLATES[key];
    if (!base) return { ok: false, code: 'not_found' };
    const current = this.ctx.state.templates[key];
    if ((current?.updatedAt ?? '2026-01-01T00:00:00.000Z') !== expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    if (
      !validLt(title) ||
      !validLt(body) ||
      title.ar.length > 120 ||
      (title.en ?? '').length > 120 ||
      body.ar.length > 1000 ||
      (body.en ?? '').length > 1000
    )
      return { ok: false, code: 'invalid_message' };
    if (unknownPlaceholder(title.ar, title.en, body.ar, body.en))
      return { ok: false, code: 'unknown_placeholder' };
    const updatedAt = this.ctx.stamp();
    this.ctx.state.templates[key] = { title, body, isActive, updatedAt };
    this.ctx.audit(
      actor,
      'update',
      'public.notification_templates',
      key,
      current
        ? { title: current.title, body: current.body, isActive: current.isActive }
        : { title: base.title, body: base.body },
      { title, body, isActive },
    );
    this.syncTemplates();
    this.ctx.persist();
    return { ok: true, updatedAt };
  }

  sendNotifications(
    actor: AdminActor,
    userIds: string[],
    title: LocalizedText,
    body: LocalizedText,
    actionPath: string | null,
  ): AdminResult<{ sent: number }> {
    requireAny(actor, 'notifications.manage');
    const unique = [...new Set(userIds)];
    if (unique.length === 0 || unique.length > 200) return { ok: false, code: 'invalid_selection' };
    if (!validLt(title) || !validLt(body) || title.ar.length > 120 || body.ar.length > 1000)
      return { ok: false, code: 'invalid_message' };
    if (actionPath && !/^\/[a-zA-Z0-9/_\-?=&.#%]*$/.test(actionPath))
      return { ok: false, code: 'invalid_path' };
    const known = new Set(this.customerIds());
    let sent = 0;
    for (const id of unique) {
      if (!known.has(id)) continue;
      this.ctx.customer.sendManual(id, title, body, actionPath, `manual:${this.ctx.uuid()}`);
      sent += 1;
    }
    this.ctx.audit(actor, 'notification.bulk_sent', 'notification', null, null, {
      title,
      recipients: sent,
    });
    this.ctx.persist();
    return { ok: true, sent };
  }

  searchRecipients(actor: AdminActor, q: string): Recipient[] {
    requireAny(actor, 'notifications.manage');
    const needle = q.trim();
    if (needle.length < 2) return [];
    const digits = needle.replace(/[^0-9]/g, '');
    const profiles = this.ctx.customer.adminState().profiles;
    return this.customerIds()
      .map((id) => ({
        id,
        name: profiles[id]?.fullName ?? null,
        email: this.customerEmail(id),
        phone: profiles[id]?.phone ?? null,
      }))
      .filter(
        (c) =>
          matchesText(needle, c.name, c.email) ||
          (digits.length >= 4 &&
            (normalizeEgyptianPhone(c.phone ?? '') ?? c.phone ?? '')
              .replace(/[^0-9]/g, '')
              .includes(digits)),
      )
      .slice(0, 20)
      .map(({ id, name, email }) => ({ id, name, email }));
  }
}
