import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import demoCatalogJson from '@seed/demo/catalog.json';
import { SYSTEM_ROLES } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import {
  DemoCommerce,
  type DemoActor,
  type DemoCommerceState,
} from '@/domain/commerce/demoCommerce';
import type { CreateOrderPayload } from '@/domain/commerce/types';
import { DemoCustomer, type DemoCustomerState } from '@/domain/customer/demoCustomer';
import {
  abandonedCartSettingsSchema,
  commerceSettingsSchema,
  engagementSettingsSchema,
  featuresSettingsSchema,
  orderReviewSettingsSchema,
  repairCatalogSettingsSchema,
  servicesSettingsSchema,
  storeSettingsSchema,
} from '@/domain/settings/schemas';
import servicesSql from '../../../supabase/migrations/20260928100000_services.sql?raw';
import requestsSql from '../../../supabase/migrations/20260928100100_service_requests.sql?raw';
import {
  DemoServicePermissionError,
  DemoServices,
  type DemoMediaInfo,
  type DemoServicesState,
} from './demoServices';
import { mediaProblem, sniffMime, tradeInDifference } from './media';
import {
  isTerminal,
  progressIndex,
  staffStatusOptions,
  statusTemplate,
  customerCanCancel,
} from './status';
import { SERVICE_STATUSES, type RepairInput, type ServiceBucket, type TradeInInput } from './types';
import { cleanText, normalizeMobile, repairProblem } from './validation';

const raw = rawCatalogSchema.parse(demoCatalogJson);
const variant = (sku: string) => {
  const v = raw.products.flatMap((p) => p.variants).find((x) => x.sku === sku);
  if (!v) throw new Error(sku);
  return v.id;
};
const TARGET = variant('IP18P-256GB-ORANGE');
const CABLE = variant('USBC-1M-WHITE');
const services = servicesSettingsSchema.parse(baseSeed.settings.services);
const repairCatalog = repairCatalogSettingsSchema.parse(
  baseSeed.settings.repair_catalog,
).categories;

function setup() {
  let now = new Date('2026-09-25T12:00:00Z');
  let commerceState: DemoCommerceState | null = null;
  let customerState: DemoCustomerState | null = null;
  let servicesState: DemoServicesState | null = null;
  let version = 0;
  let cached: { engine: CatalogEngine; version: number } | null = null;
  const engine = () => {
    if (!cached || cached.version !== version) cached = { engine: commerce.engine(), version };
    return cached.engine;
  };
  const commerce = new DemoCommerce({
    raw,
    storage: {
      load: () => commerceState,
      save: (s) => {
        version += 1;
        commerceState = structuredClone(s);
      },
    },
    settings: () => ({
      features: featuresSettingsSchema.parse(baseSeed.settings.features),
      commerce: commerceSettingsSchema.parse({
        ...baseSeed.settings.commerce,
        maxOpenOrdersPerCustomer: 20,
      }),
      orderReview: orderReviewSettingsSchema.parse({
        ...baseSeed.settings.order_review,
        newCustomer: { enabled: false, minTotal: 30000 },
        highValue: { enabled: false, threshold: 100000 },
        splitPayment: { enabled: false },
        unfinishedOrders: { enabled: false, maxCount: 2, windowDays: 7 },
        velocity: { enabled: false, maxOrders: 3, windowHours: 1 },
        multipleExpensive: { enabled: false, unitPrice: 20000, minUnits: 2 },
      }),
      store: storeSettingsSchema.parse(baseSeed.settings.store),
    }),
    now: () => now,
  });
  let seq = 0;
  const random = () => `${(seq += 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const customer = new DemoCustomer({
    raw,
    commerce,
    settings: () => ({
      engagement: engagementSettingsSchema.parse(baseSeed.settings.engagement),
      abandonedCart: abandonedCartSettingsSchema.parse(baseSeed.settings.abandoned_cart),
    }),
    storage: { load: () => customerState, save: (s) => (customerState = structuredClone(s)) },
    now: () => now,
    random,
    engine,
  });
  const media = new Map<string, DemoMediaInfo>();
  let settings = { services, repairCatalog };
  const svc = new DemoServices({
    raw,
    commerce,
    customer,
    settings: () => settings,
    storage: { load: () => servicesState, save: (s) => (servicesState = structuredClone(s)) },
    mediaInfo: (bucket, path) => media.get(`${bucket}/${path}`) ?? null,
    now: () => now,
    random,
    engine,
  });
  const actor = (userId: string | null, role?: string): DemoActor => {
    const def = SYSTEM_ROLES.find((r) => r.key === role);
    return {
      userId,
      email: userId ? `${userId}@demo.invalid` : null,
      can: (p) => Boolean(def && (def.grantsAll || def.permissions.includes(p))),
    };
  };
  const upload = (
    bucket: ServiceBucket,
    owner: string,
    ext: string,
    mime: string,
    size: number,
  ) => {
    const path = `${owner}/${crypto.randomUUID()}.${ext}`;
    media.set(`${bucket}/${path}`, { bucket, path, mime, size });
    return path;
  };
  const order = (who: string) => {
    const quote = commerce.quote(who, [{ variantId: CABLE, quantity: 1 }], {
      fulfillment: 'delivery',
    });
    const payload: CreateOrderPayload = {
      idempotencyKey: crypto.randomUUID(),
      items: quote.lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        expectedUnitPrice: l.unitPrice,
      })),
      expectedTotal: quote.totals.total,
      promoCode: null,
      contact: { name: 'Test', phone: '01012345678' },
      fulfillment: { method: 'delivery', governorate: 'cairo', area: 'Nasr', address: '12 Street' },
      payment: { method: 'cod' },
      note: null,
      locale: 'en',
    };
    const result = commerce.createOrder(actor(who), payload);
    if (!result.ok) throw new Error(result.code);
    return result.order;
  };
  const deliver = (orderId: string) => {
    const manager = actor('manager', 'store_manager');
    expect(commerce.setShipping(manager, orderId, { fee: 50 }).ok).toBe(true);
    for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const)
      expect(commerce.setStatus(manager, orderId, status, null).ok).toBe(true);
  };
  const inbox = (userId: string) => customer.listNotifications(userId, { limit: 50 }).items;
  return {
    svc,
    actor,
    upload,
    order,
    deliver,
    inbox,
    setSettings: (next: typeof settings) => (settings = next),
    tick: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const repairInput = (over: Partial<RepairInput> = {}): RepairInput => ({
  idempotencyKey: crypto.randomUUID(),
  contact: { name: 'Alice Hanna', phone: '0101 234 5678' },
  preferredContact: 'whatsapp',
  locale: 'en',
  device: { category: 'smartphone', brand: 'Apple', model: 'iPhone 15 Pro' },
  diagnosis: { component: 'screen', symptom: 'broken_glass', unsure: false, viewer: '3d' },
  consultation: false,
  description: 'The screen cracked after a fall and touch is patchy.',
  handoff: 'store_visit',
  media: [],
  ...over,
});

const tradeInput = (over: Partial<TradeInInput> = {}): TradeInInput => ({
  idempotencyKey: crypto.randomUUID(),
  contact: { name: 'Alice Hanna', phone: '01012345678' },
  preferredContact: 'phone',
  locale: 'ar',
  current: {
    category: 'smartphone',
    brand: 'Apple',
    model: 'iPhone 14 Pro Max',
    storage: '256GB',
    color: 'Deep Purple',
    batteryHealth: 86,
    taxPaid: 'yes',
    openedBefore: 'no',
    repairedBefore: 'no',
    accessories: ['box', 'cable'],
    conditions: ['scratches'],
    notes: null,
  },
  target: { variantId: TARGET },
  media: [],
  ...over,
});

describe('service rules (pure)', () => {
  it('money: trade-in difference is exact in piasters and may be negative', () => {
    expect(tradeInDifference(72000, 20000.5)).toBe(51999.5);
    expect(tradeInDifference(0.3, 0.1)).toBe(0.2);
    expect(tradeInDifference(10000, 12000.25)).toBe(-2000.25);
  });

  it('media: file type is sniffed from bytes, not trusted from the browser', () => {
    const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(sniffMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0'))).toBe('image/heic');
    expect(sniffMime(new TextEncoder().encode('\0\0\0\x18ftypisom\0\0\0\0'))).toBe('video/mp4');
    expect(
      sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffMime(new TextEncoder().encode('%PDF-1.7 something long'))).toBeNull();
  });

  it('media: limits for size, count and videos', () => {
    const limits = { ...services.media };
    const none = { images: 0, videos: 0 };
    expect(mediaProblem({ mime: null, size: 10 }, none, limits)).toBe('invalid_media_type');
    expect(mediaProblem({ mime: 'image/webp', size: limits.maxImageBytes + 1 }, none, limits)).toBe(
      'media_too_large',
    );
    expect(mediaProblem({ mime: 'video/mp4', size: 1000 }, { images: 0, videos: 1 }, limits)).toBe(
      'too_many_videos',
    );
    expect(
      mediaProblem({ mime: 'image/png', size: 10 }, { images: limits.maxFiles, videos: 0 }, limits),
    ).toBe('too_many_files');
    expect(mediaProblem({ mime: 'video/mp4', size: 10 }, none, limits, false)).toBe(
      'video_not_allowed',
    );
    expect(mediaProblem({ mime: 'image/jpeg', size: 10 }, none, limits)).toBeNull();
  });

  it('status rules: terminal, cancel windows, staff options and notifications', () => {
    expect(isTerminal('not_available')).toBe(true);
    expect(customerCanCancel('repair', 'quote_sent')).toBe(true);
    expect(customerCanCancel('repair', 'repairing')).toBe(false);
    const options = staffStatusOptions('repair', 'under_review', null);
    expect(options).not.toContain('quote_sent');
    expect(options).toContain('diagnosing');
    expect(staffStatusOptions('after_sales', 'approved', 'warranty')).toContain(
      'warranty_handling',
    );
    expect(staffStatusOptions('after_sales', 'approved', 'warranty')).not.toContain(
      'refund_handling',
    );
    expect(staffStatusOptions('repair', 'completed', null)).toEqual([]);
    expect(statusTemplate('repair', 'diagnosing')).toBeNull();
    expect(statusTemplate('repair', 'ready')).toBe('service.repair.ready');
    expect(progressIndex('repair', 'customer_approved')).toBe(4);
    expect(progressIndex('used', 'cancelled')).toBe(-1);
  });

  it('SQL parity: statuses and notification rules match the migrations', () => {
    for (const [kind, statuses] of Object.entries(SERVICE_STATUSES)) {
      const match = new RegExp(`when '${kind}' then array\\[([^\\]]+)\\]`).exec(servicesSql);
      expect(match, kind).not.toBeNull();
      const sqlStatuses = [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect(sqlStatuses).toEqual([...statuses]);
    }
    for (const template of [
      'service.repair.ready',
      'service.trade_in.inspection',
      'service.used.not_available',
      'service.after_sales.completed',
    ])
      expect(requestsSql).toContain(`'${template}'`);
  });

  it('validation mirrors the database', () => {
    expect(normalizeMobile('0101 234 5678')).toBe('+201012345678');
    expect(normalizeMobile('0224567890')).toBeNull();
    expect(cleanText('  hi\u0007 ', 10)).toBe('hi');
    expect(
      repairProblem(
        repairInput({ device: { category: 'toaster', brand: 'x', model: 'y' } }),
        repairCatalog,
      )?.code,
    ).toBe('invalid_device');
    expect(
      repairProblem(
        repairInput({
          diagnosis: { component: 'screen', symptom: 'drains_fast', unsure: false, viewer: '2d' },
        }),
        repairCatalog,
      )?.field,
    ).toBe('symptom');
    expect(repairProblem(repairInput({ description: 'short' }), repairCatalog)?.code).toBe(
      'invalid_description',
    );
    expect(repairProblem(repairInput(), repairCatalog)).toBeNull();
  });
});

describe('demo service engine (mirrors the SQL RPCs)', () => {
  it('repair: intake, media validation, privacy, staff quote, approval and notifications', () => {
    const t = setup();
    const alice = t.actor('alice');
    const photo = t.upload('repairs', 'alice', 'webp', 'image/webp', 350_000);
    const bobPhoto = t.upload('repairs', 'bob', 'webp', 'image/webp', 1000);
    const bad = t.upload('repairs', 'alice', 'png', 'image/webp', 1000);
    expect(
      t.svc.create(alice, 'repair', repairInput({ media: [{ path: bobPhoto }] })),
    ).toMatchObject({
      code: 'invalid_media',
    });
    expect(t.svc.create(alice, 'repair', repairInput({ media: [{ path: bad }] }))).toMatchObject({
      code: 'invalid_media_type',
    });
    const input = repairInput({ media: [{ path: photo, label: 'damage' }] });
    const created = t.svc.create(alice, 'repair', input);
    if (!created.ok) throw new Error(created.code);
    expect(created.request.number).toMatch(/^RP-2026-000001$/);
    expect(t.svc.create(alice, 'repair', input)).toMatchObject({ ok: true, duplicate: true });
    expect(t.svc.create(alice, 'repair', repairInput({ media: [{ path: photo }] }))).toMatchObject({
      code: 'media_in_use',
    });
    const number = created.request.number;
    expect(t.svc.getMine(t.actor('bob'), number)).toBeNull();
    expect(t.svc.canReadMedia(t.actor('bob'), 'repairs', photo)).toBe(false);
    expect(t.svc.canReadMedia(t.actor('tech', 'repairs_team'), 'repairs', photo)).toBe(true);

    expect(() => t.svc.staffList(t.actor('editor', 'content_editor'), 'repair')).toThrow(
      DemoServicePermissionError,
    );
    const cs = t.actor('cs', 'customer_service');
    expect(() => t.svc.setStatusStaff(cs, created.request.id, 'under_review', null)).toThrow(
      DemoServicePermissionError,
    );
    const tech = t.actor('tech', 'repairs_team');
    expect(t.svc.setStatusStaff(tech, created.request.id, 'quote_sent', null)).toMatchObject({
      code: 'use_offer',
    });
    t.svc.addNote(tech, created.request.id, 'INTERNAL remark', false);
    expect(
      t.svc.sendRepairQuote(tech, created.request.id, 'estimate', 1500.555, null),
    ).toMatchObject({
      code: 'invalid_amount',
    });
    t.svc.sendRepairQuote(tech, created.request.id, 'estimate', 4500, 'Original display');
    const view = t.svc.getMine(alice, number);
    expect(JSON.stringify(view)).not.toContain('INTERNAL');
    expect(view?.status).toBe('quote_sent');
    expect(view?.offers[0]?.amount).toBe(4500);
    const quoteNotice = t.inbox('alice').find((n) => n.body.en?.includes('EGP 4,500'));
    expect(quoteNotice?.actionPath).toBe(`/account/requests/${number}`);
    const offerId = view?.offers[0]?.id ?? '';
    expect(t.svc.respondOffer(alice, offerId, 'accept', null)).toMatchObject({
      ok: true,
      request: { status: 'customer_approved' },
    });
    expect(t.svc.cancel(alice, number, null)).toMatchObject({ code: 'cannot_cancel' });
    t.svc.setStatusStaff(tech, created.request.id, 'ready', null);
    t.svc.setStatusStaff(tech, created.request.id, 'completed', null);
    expect(t.svc.setStatusStaff(tech, created.request.id, 'repairing', null)).toMatchObject({
      code: 'closed',
    });
    const titles = t.inbox('alice').map((n) => n.title.en);
    expect(titles.filter((x) => x === 'Your device is ready')).toHaveLength(1);
  });

  it('trade-in: authoritative target price, exact difference, supersede, expiry', () => {
    const t = setup();
    const alice = t.actor('alice');
    expect(
      t.svc.create(
        alice,
        'trade_in',
        tradeInput({ current: { ...tradeInput().current, conditions: ['none', 'dents'] } }),
      ),
    ).toMatchObject({ code: 'invalid_condition' });
    const created = t.svc.create(alice, 'trade_in', tradeInput());
    if (!created.ok) throw new Error(created.code);
    const sales = t.actor('sales', 'sales');
    expect(
      t.svc.sendTradeInOffer(sales, created.request.id, {
        deviceValue: 20000,
        targetPrice: 1,
        note: null,
        inspectionNote: null,
        validDays: null,
      }),
    ).toMatchObject({ code: 'catalog_price_only' });
    const sent = t.svc.sendTradeInOffer(sales, created.request.id, {
      deviceValue: 20000.5,
      targetPrice: null,
      note: 'Good condition',
      inspectionNote: 'Final after inspection',
      validDays: null,
    });
    if (!sent.ok) throw new Error(sent.code);
    const offer = sent.request.offers[0];
    expect(offer?.targetPrice).toBeGreaterThan(0);
    expect(offer?.difference).toBe(tradeInDifference(offer?.targetPrice ?? 0, 20000.5));
    expect(sent.request.status).toBe('offer_sent');

    const manual = t.svc.create(
      alice,
      'trade_in',
      tradeInput({
        target: {
          manual: { brand: 'Apple', model: 'iPhone 17 Pro Max', storage: '512GB', color: null },
        },
      }),
    );
    if (!manual.ok) throw new Error(manual.code);
    const noPrice = t.svc.sendTradeInOffer(sales, manual.request.id, {
      deviceValue: 12000,
      targetPrice: null,
      note: null,
      inspectionNote: null,
      validDays: 1,
    });
    expect(noPrice).toMatchObject({ code: 'invalid_amount' });
    t.svc.sendTradeInOffer(sales, manual.request.id, {
      deviceValue: 12000.25,
      targetPrice: 50000,
      note: null,
      inspectionNote: null,
      validDays: 1,
    });
    const second = t.svc.sendTradeInOffer(sales, manual.request.id, {
      deviceValue: 13000,
      targetPrice: 50000,
      note: null,
      inspectionNote: null,
      validDays: 1,
    });
    if (!second.ok) throw new Error(second.code);
    expect(second.request.offers.filter((o) => o.status === 'sent')).toHaveLength(1);
    expect(second.request.offers[0]?.difference).toBe(37000);
    t.tick(2 * 86_400_000);
    const number = second.request.number;
    const mine = t.svc.getMine(alice, number);
    expect(mine?.offers[0]?.expired).toBe(true);
    expect(t.svc.respondOffer(alice, mine?.offers[0]?.id ?? '', 'accept', null)).toMatchObject({
      code: 'offer_expired',
    });
  });

  it('used request: professional options, staff proposal photos visible to the owner only', () => {
    const t = setup();
    const alice = t.actor('alice');
    const created = t.svc.create(alice, 'used', {
      idempotencyKey: crypto.randomUUID(),
      contact: { name: 'Alice', phone: '01012345678' },
      preferredContact: 'whatsapp',
      locale: 'ar',
      device: {
        category: 'smartphone',
        brand: 'Apple',
        model: 'iPhone 15 Pro',
        storage: '256GB',
        color: null,
        batteryPreference: '90_plus',
        taxPreference: 'tax_paid',
        budget: 38000,
        notes: null,
      },
    });
    if (!created.ok) throw new Error(created.code);
    expect(created.request.number).toMatch(/^UD-/);
    const sales = t.actor('sales', 'sales');
    const photo = t.upload('used-requests', 'sales', 'webp', 'image/webp', 1000);
    const sent = t.svc.sendUsedProposal(
      sales,
      created.request.id,
      {
        brand: 'Apple',
        model: 'iPhone 15 Pro',
        storage: '256GB',
        color: 'Natural',
        batteryHealth: 91,
        condition: 'Very good',
        taxStatus: 'tax_paid',
      },
      36500,
      null,
      [{ path: photo }],
    );
    expect(sent).toMatchObject({ ok: true, request: { status: 'option_found' } });
    expect(t.svc.canReadMedia(alice, 'used-requests', photo)).toBe(true);
    expect(t.svc.canReadMedia(t.actor('bob'), 'used-requests', photo)).toBe(false);
    const mine = t.svc.getMine(alice, created.request.number);
    expect(mine?.offers[0]?.media).toHaveLength(1);
    expect(t.svc.respondOffer(alice, mine?.offers[0]?.id ?? '', 'accept', null)).toMatchObject({
      request: { status: 'customer_interested' },
    });
  });

  it('after-sales: owned delivered items only, policy version, one open per item and type', () => {
    const t = setup();
    const alice = t.actor('alice');
    const order = t.order('alice');
    expect(t.svc.afterSalesItems(alice)).toHaveLength(0);
    t.deliver(order.id);
    const items = t.svc.afterSalesItems(alice);
    expect(items).toHaveLength(1);
    const itemId = items[0]?.itemId ?? '';
    const base = {
      idempotencyKey: crypto.randomUUID(),
      contact: { name: 'Alice', phone: '01012345678' },
      preferredContact: 'whatsapp' as const,
      locale: 'en' as const,
      orderItemId: itemId,
      type: 'warranty' as const,
      reason: 'defective' as const,
      description: 'The cable stopped charging after a week.',
      policyVersion: services.afterSales.policyVersion,
      policyAccepted: true,
      media: [],
    };
    expect(t.svc.create(t.actor('carol'), 'after_sales', base)).toMatchObject({
      code: 'not_eligible',
    });
    expect(t.svc.create(alice, 'after_sales', { ...base, policyAccepted: false })).toMatchObject({
      code: 'policy_required',
    });
    expect(t.svc.create(alice, 'after_sales', { ...base, policyVersion: 'old' })).toMatchObject({
      code: 'policy_changed',
    });
    const created = t.svc.create(alice, 'after_sales', base);
    if (!created.ok) throw new Error(created.code);
    expect(
      t.svc.create(alice, 'after_sales', { ...base, idempotencyKey: crypto.randomUUID() }),
    ).toMatchObject({ code: 'duplicate_open' });
    const cs = t.actor('cs', 'customer_service');
    expect(t.svc.setStatusStaff(cs, created.request.id, 'warranty_handling', null)).toMatchObject({
      code: 'approval_required',
    });
    expect(t.svc.decideAfterSales(cs, created.request.id, 'rejected', null)).toMatchObject({
      code: 'reason_required',
    });
    t.svc.decideAfterSales(cs, created.request.id, 'approved', 'Bring it to the branch');
    expect(t.svc.setStatusStaff(cs, created.request.id, 'refund_handling', null)).toMatchObject({
      code: 'invalid_status',
    });
    expect(t.inbox('alice').some((n) => n.title.en === 'Your request was approved')).toBe(true);
    expect(t.svc.listMine(alice, { kind: 'after_sales' }).total).toBe(1);
  });

  it('demo requests are staff-only, labelled, and limits apply', () => {
    const t = setup();
    const staff = t.svc.staffList(t.actor('owner', 'owner'), 'repair');
    expect(staff.items.some((r) => r.number === 'RP-2026-900001' && r.isDemo)).toBe(true);
    expect(t.svc.listMine(t.actor('alice')).total).toBe(0);
    t.setSettings({
      services: { ...services, requests: { maxOpenPerCustomer: 1 } },
      repairCatalog,
    });
    expect(t.svc.create(t.actor('bob'), 'repair', repairInput()).ok).toBe(true);
    expect(t.svc.create(t.actor('bob'), 'repair', repairInput())).toMatchObject({
      code: 'too_many_open',
    });
  });
});
