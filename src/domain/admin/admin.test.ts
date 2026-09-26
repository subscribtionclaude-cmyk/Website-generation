import { beforeEach, describe, expect, it } from 'vitest';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test fixture');
  return value;
}
import { DemoCommerceStore, actorOf } from '@/repositories/demo/demoCommerce';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import foundationSql from '../../../supabase/migrations/20260929100000_admin_foundation.sql?raw';
import { csvCell, flattenRow, parseCsv, toCsv } from './csv';
import { customRange, presetRange, storeDay, storeDayStart, tzOffsetMinutes } from './dateRange';
import { auditModule } from './demo/data';
import type { AdminActor } from './demo/demoAdmin';
import { jsonDiff, redactSecrets } from './diff';
import { applyMapping, autoMap, missingRequired } from './importMapping';
import type { ProductInput } from './schemas';
import { slaState, viewMatches } from './sla';
import {
  optionCombinations,
  slugify,
  validateOfferInput,
  validateProductInput,
} from './validation';

// ── CSV ───────────────────────────────────────────────────────────────────────
describe('csv', () => {
  it('neutralises spreadsheet formulas on export (= + - @ tab CR)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+201000')).toBe("'+201000");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe(`"'\tcmd"`);
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
    expect(csvCell('آيفون')).toBe('آيفون');
    expect(csvCell(null)).toBe('');
  });

  it('writes a BOM + CRLF document Excel opens with Arabic intact', () => {
    const doc = toCsv([{ sku: 'A', name: 'سماعة, لاسلكية' }]);
    expect(doc.startsWith('﻿')).toBe(true);
    expect(doc).toBe('﻿sku,name\r\nA,"سماعة, لاسلكية"\r\n');
  });

  it('parses quotes, escaped quotes, CRLF, BOM and semicolon files', () => {
    const parsed = parseCsv('﻿sku;name\r\n"A;1";"He said ""hi"""\r\n\r\nB;x\n');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.headers).toEqual(['sku', 'name']);
    expect(parsed.rows).toEqual([
      ['A;1', 'He said "hi"'],
      ['B', 'x'],
    ]);
  });

  it('treats formulas in imported files as inert text and strips control characters', () => {
    const parsed = parseCsv('sku,price\n=cmd|calc,1\u0007000\n');
    expect(parsed.rows[0]).toEqual(['=cmd|calc', '1000']);
  });

  it('flattens nested export rows', () => {
    expect(flattenRow({ name: { ar: 'أ', en: 'A' }, n: 1 })).toEqual({
      'name.ar': 'أ',
      'name.en': 'A',
      n: 1,
    });
  });
});

describe('import mapping', () => {
  it('auto-maps English and Arabic headers and reports missing required columns', () => {
    const mapping = autoMap(['SKU', 'اسم المنتج', 'Price EGP', 'الكمية', 'Colour']);
    expect(mapping).toMatchObject({ sku: 0, nameAr: 1, price: 2, stock: 3, color: 4 });
    expect(missingRequired({})).toEqual(['sku']);
    const rows = applyMapping(
      { headers: [], delimiter: ',', rows: [['A-1', 'اسم', '100', '', 'Black']] },
      mapping,
    ).rows;
    expect(rows[0]).toEqual({ sku: 'A-1', nameAr: 'اسم', price: '100', color: 'Black' });
  });
});

// ── Dates ─────────────────────────────────────────────────────────────────────
describe('date ranges (Cairo)', () => {
  it('uses Cairo calendar days including DST', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'))).toBe(120);
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'))).toBe(180);
    expect(storeDayStart('2026-07-15').toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(storeDay(new Date('2026-07-14T21:30:00Z'))).toBe('2026-07-15');
  });

  it('builds today / 7d / custom ranges with an exclusive end', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const today = presetRange('today', now);
    expect(today.from).toBe('2026-09-25T21:00:00.000Z');
    expect(today.to).toBe('2026-09-26T21:00:00.000Z');
    expect(presetRange('7d', now).from).toBe('2026-09-19T21:00:00.000Z');
    expect(customRange('2026-09-10', '2026-09-01')).toBeNull();
    expect(customRange('2026-09-01', '2026-09-01')?.to).toBe('2026-09-01T21:00:00.000Z');
  });
});

describe('audit diff & redaction', () => {
  it('lists added, removed and changed paths and ignores updatedAt noise', () => {
    expect(
      jsonDiff(
        { price: 10, a: { b: 1 }, gone: true, updatedAt: 'x' },
        { price: 12, a: { b: 1, c: 2 }, updatedAt: 'y' },
      ),
    ).toEqual([
      { path: 'price', kind: 'changed', before: 10, after: 12 },
      { path: 'a.c', kind: 'added', after: 2 },
      { path: 'gone', kind: 'removed', before: true },
    ]);
  });

  it('redacts secret-looking keys at any depth (mirrors app.redact_secrets)', () => {
    expect(
      redactSecrets({ password: 'x', nested: { api_key: 'k', ok: 1 }, list: [{ token: 't' }] }),
    ).toEqual({
      password: '[redacted]',
      nested: { api_key: '[redacted]', ok: 1 },
      list: [{ token: '[redacted]' }],
    });
    expect(foundationSql).toContain(
      'password|secret|token|api_?key|otp|hash|idempotency|signature|credential',
    );
  });

  it('maps entity types / actions to modules like app.audit_module', () => {
    expect(auditModule('public.product_variants', 'update')).toBe('catalog');
    expect(auditModule('x', 'stock.adjusted')).toBe('catalog');
    expect(auditModule('public.site_settings', 'update')).toBe('settings');
    expect(auditModule('public.user_roles', 'insert')).toBe('access');
    expect(auditModule('export', 'export.orders')).toBe('data');
  });
});

describe('SLA aging', () => {
  const hours = { warnHours: 24, overdueHours: 48 };
  const now = new Date('2026-09-26T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  it('ages open requests and pauses while the customer owes an answer', () => {
    const base = { status: 'diagnosing', awaitingCustomer: false, openOffer: false };
    expect(slaState({ ...base, lastChangeAt: at(2) }, hours, now)).toBe('on_track');
    expect(slaState({ ...base, lastChangeAt: at(30) }, hours, now)).toBe('approaching');
    expect(slaState({ ...base, lastChangeAt: at(60) }, hours, now)).toBe('overdue');
    expect(slaState({ ...base, openOffer: true, lastChangeAt: at(60) }, hours, now)).toBe(
      'waiting_customer',
    );
    expect(slaState({ ...base, status: 'completed', lastChangeAt: at(60) }, hours, now)).toBe(
      'closed',
    );
    expect(viewMatches({ ...base, status: 'new', lastChangeAt: at(1) }, 'new')).toBe(true);
    expect(viewMatches({ ...base, lastChangeAt: at(1) }, 'in_progress')).toBe(true);
  });
});

// ── Shared validation ─────────────────────────────────────────────────────────
const baseProduct = (over: Partial<ProductInput> = {}): ProductInput => ({
  slug: 'test-phone',
  brandId: 'b',
  categoryIds: ['c'],
  primaryCategoryId: null,
  model: null,
  name: { ar: 'هاتف', en: 'Phone' },
  subtitle: null,
  description: null,
  warranty: null,
  warrantyKind: null,
  availabilityState: 'available',
  status: 'draft',
  isVisible: true,
  isNew: false,
  isFeatured: false,
  releaseDate: null,
  keywords: '',
  seoTitle: null,
  seoDescription: null,
  options: [
    {
      key: 'storage',
      name: { ar: 'السعة' },
      values: [
        { key: '128gb', label: { ar: '128' }, swatchHex: null },
        { key: '256gb', label: { ar: '256' }, swatchHex: null },
      ],
    },
  ],
  variants: [
    {
      sku: 'TP-128',
      barcode: null,
      options: { storage: '128gb' },
      price: 100,
      compareAtPrice: null,
      lowStockThreshold: 2,
      isActive: true,
      isDefault: true,
      warranty: null,
      warrantyKind: null,
    },
  ],
  media: [],
  specGroups: [],
  relations: [],
  priceReason: null,
  ...over,
});

describe('product / offer validation', () => {
  it('accepts a valid aggregate and names the failing field otherwise', () => {
    expect(validateProductInput(baseProduct())).toBeNull();
    expect(validateProductInput(baseProduct({ slug: 'Bad Slug' }))).toEqual({
      code: 'invalid_slug',
      field: 'slug',
    });
    const v = must(baseProduct().variants[0]);
    expect(validateProductInput(baseProduct({ variants: [v, { ...v }] }))?.code).toBe(
      'duplicate_sku',
    );
    expect(
      validateProductInput(baseProduct({ variants: [{ ...v, compareAtPrice: 90 }] }))?.code,
    ).toBe('invalid_price');
    expect(
      validateProductInput(baseProduct({ variants: [{ ...v, options: { storage: '1tb' } }] }))
        ?.code,
    ).toBe('invalid_combination');
  });

  it('builds Storage × Color matrices', () => {
    expect(
      optionCombinations([
        { key: 'storage', values: [{ key: 'a' }, { key: 'b' }] },
        { key: 'color', values: [{ key: 'x' }, { key: 'y' }] },
      ]),
    ).toHaveLength(4);
    expect(slugify('iPhone 17 Pro Max!')).toBe('iphone-17-pro-max');
  });

  it('enforces kind-specific offer rules', () => {
    const offer = {
      slug: 'promo',
      kind: 'promo_code' as const,
      title: { ar: 'عرض' },
      subtitle: null,
      description: null,
      badge: { ar: 'خصم' },
      mediaKind: null,
      mediaUrl: null,
      mediaAlt: null,
      ctaLabel: null,
      ctaHref: null,
      discountPercent: 10,
      discountAmount: null,
      bundlePrice: null,
      promoCode: 'SAVE10',
      minSubtotal: null,
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
      buyQuantity: null,
      getQuantity: null,
      startsAt: null,
      endsAt: null,
      showCountdown: false,
      featuredOnHome: false,
      status: 'draft' as const,
      sortOrder: 1,
      seoTitle: null,
      seoDescription: null,
      products: [],
      categoryIds: [],
    };
    expect(validateOfferInput(offer)).toBeNull();
    expect(validateOfferInput({ ...offer, promoCode: 'x' })?.code).toBe('invalid_code');
    expect(validateOfferInput({ ...offer, kind: 'flash', promoCode: null })?.code).toBe(
      'end_required',
    );
    expect(validateOfferInput({ ...offer, kind: 'fixed', promoCode: null })?.code).toBe(
      'discount_required',
    );
    expect(validateOfferInput({ ...offer, ctaHref: 'javascript:alert(1)' })?.code).toBe(
      'invalid_link',
    );
  });
});

// ── Demo admin engine (parity with supabase/tests/sql/10_admin.test.sql) ─────
function fakeAuth(
  role: string | null,
  userId = role ? `demo-${role}` : 'demo-customer-a@test.local',
) {
  return {
    getSession: async () => ({ userId, email: `${role ?? 'a'}@demo.invalid`, isDemo: true }),
    demo: { getRoleKey: () => role, signInAsRole: async () => ({}) },
  } as unknown as DemoAuthService;
}

describe('demo admin engine', () => {
  let store: DemoCommerceStore;
  const as = (role: string): Promise<AdminActor> => actorOf(fakeAuth(role), store);

  beforeEach(() => {
    localStorage.clear();
    store = new DemoCommerceStore();
  });

  it('matches the SQL RBAC matrix for key admin areas', async () => {
    const probes: [string, (a: AdminActor) => unknown][] = [
      ['catalog', (a) => store.admin.catalog.listProducts(a, {})],
      ['pricing', (a) => store.admin.catalog.listPriceHistory(a, {})],
      ['customers', (a) => store.admin.ops.listCustomers(a, {})],
      ['audit', (a) => store.admin.data.listAuditLogs(a, {})],
      [
        'analytics',
        (a) => store.admin.data.analytics(a, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', true),
      ],
      ['import', (a) => store.admin.data.listImportJobs(a)],
    ];
    const row = async (role: string) => {
      const a = await as(role);
      return probes
        .map(([, fn]) => {
          try {
            fn(a);
            return '1';
          } catch {
            return '0';
          }
        })
        .join('');
    };
    expect(await row('owner')).toBe('111111');
    expect(await row('sales')).toBe('111000');
    expect(await row('design_editor')).toBe('000000');
    expect(await row('repairs_team')).toBe('001000');
  });

  it('records price history with the reason and detects stale edits', async () => {
    const owner = await as('owner');
    const product = must(store.admin.catalog.listProducts(owner, { q: 'iPhone 17' }).items[0]);
    const detail = must(store.admin.catalog.getProduct(owner, product.id));
    const v = must(detail.variants[0]);
    const ok = store.admin.catalog.setVariantPrice(
      owner,
      v.id,
      1234,
      null,
      'Supplier update',
      v.updatedAt,
    );
    expect(ok.ok).toBe(true);
    const stale = store.admin.catalog.setVariantPrice(owner, v.id, 1300, null, 'x', v.updatedAt);
    expect(stale).toEqual({ ok: false, code: 'stale' });
    const history = store.admin.catalog.listPriceHistory(owner, { variantId: v.id }).items;
    expect(history[0]).toMatchObject({
      oldPrice: v.price,
      newPrice: 1234,
      reason: 'Supplier update',
    });
    // The storefront sees the new price immediately.
    expect(store.engine().variant(v.id)?.regularPrice).toBe(1234);
    const audit = store.admin.data.listAuditLogs(owner, { module: 'catalog' }).items;
    expect(audit.some((r) => r.action === 'price.changed')).toBe(true);
  });

  it('adjusts stock with movement history and refuses invalid adjustments', async () => {
    const owner = await as('owner');
    const row = must(store.admin.catalog.listInventory(owner, { q: 'IP17' }).items[0]);
    expect(
      store.admin.catalog.adjustStock(
        owner,
        row.variantId,
        'reduction',
        row.quantity + 1,
        'x',
        null,
      ),
    ).toMatchObject({ ok: false, code: 'negative' });
    expect(
      store.admin.catalog.adjustStock(owner, row.variantId, 'addition', 3, '', null),
    ).toMatchObject({
      ok: false,
      code: 'reason_required',
    });
    const res = store.admin.catalog.adjustStock(
      owner,
      row.variantId,
      'addition',
      3,
      'Delivery',
      row.quantity,
    );
    expect(res).toMatchObject({ ok: true, before: row.quantity, after: row.quantity + 3 });
    const moves = store.admin.catalog.listStockMovements(owner, { variantId: row.variantId }).items;
    expect(moves[0]).toMatchObject({ type: 'addition', change: 3, reason: 'Delivery' });
    const sales = await as('sales');
    expect(() =>
      store.admin.catalog.adjustStock(sales, row.variantId, 'addition', 1, 'x', null),
    ).toThrow();
  });

  it('creates, hides and publishes products; drafts never reach the storefront', async () => {
    const owner = await as('owner');
    const lookups = store.admin.catalog.lookups(owner);
    const input = baseProduct({
      brandId: must(lookups.brands[0]).id,
      categoryIds: [must(lookups.categories[0]).id],
    });
    input.variants = input.variants.map((v) => ({ ...v, initialStock: 4 }));
    const saved = store.admin.catalog.saveProduct(owner, input);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(store.engine().product('test-phone')).toBeNull();
    store.admin.catalog.setProductsState(owner, [saved.id], 'publish');
    expect(store.engine().product('test-phone')?.name.en).toBe('Phone');
    store.admin.catalog.setProductsState(owner, [saved.id], 'hide');
    expect(store.engine().product('test-phone')).toBeNull();
    const stock = must(store.admin.catalog.listInventory(owner, { q: 'TP-128' }).items[0]);
    expect(stock.quantity).toBe(4);
    // Content editors cannot change prices through the editor.
    const editor = await as('content_editor');
    expect(() => store.admin.catalog.saveProduct(editor, input)).toThrow();
    // Reloading keeps the edited demo catalog.
    const reloaded = new DemoCommerceStore();
    expect(reloaded.admin.catalog.getProduct(owner, saved.id)?.slug).toBe('test-phone');
  });

  it('runs settings draft → publish → rollback with conflict detection', async () => {
    const owner = await as('owner');
    const current = must(store.settings.published('shipping'));
    const first = store.settings.saveDraft(
      owner,
      'shipping',
      { ...current, defaultMode: 'pickup' },
      null,
    );
    expect(first).toMatchObject({ ok: true });
    expect(store.settings.saveDraft(owner, 'shipping', current, null)).toEqual({
      ok: false,
      code: 'draft_conflict',
    });
    const published = store.settings.publish(owner, 'shipping', 'Pickup first');
    expect(published).toEqual({ ok: true, version: 2 });
    expect(store.settings.published('shipping')?.defaultMode).toBe('pickup');
    expect(store.settings.rollback(owner, 'shipping', 1, null)).toEqual({ ok: true, version: 3 });
    expect(store.settings.published('shipping')?.defaultMode).toBe(current.defaultMode);
    const sales = await as('sales');
    expect(store.settings.saveDraft(sales, 'store', {}, null)).toBe('forbidden');
  });

  it('prevents role escalation and self-granting', async () => {
    const manager = await as('store_manager');
    expect(store.access.setRolePermissions(manager, 'store_manager', ['roles.manage']).ok).toBe(
      false,
    );
    const superAdmin = await as('super_admin');
    expect(
      store.access.setRolePermissions(superAdmin, 'sales', ['orders.view', 'security.manage']),
    ).toMatchObject({
      ok: true,
    });
    expect(store.access.changeRole(superAdmin, 'demo-sales', 'sales', 'owner')).toEqual({
      ok: false,
      code: 'only_owner_can_grant_owner',
    });
    const owner = await as('owner');
    expect(store.access.setSuspended(owner, 'demo-owner', true, 'x')).toEqual({
      ok: false,
      code: 'cannot_suspend_self',
    });
    expect(store.access.setSuspended(owner, 'demo-sales', true, 'Left the company')).toEqual({
      ok: true,
    });
    expect((await as('sales')).can('orders.view')).toBe(false);
  });

  it('previews imports without changing anything and commits all-or-nothing', async () => {
    const owner = await as('owner');
    const before = store.admin.catalog.listProducts(owner, {}).total;
    const preview = store.admin.data.importPreview(owner, 'new.csv', [
      {
        sku: 'IMP-1',
        productSlug: 'imported-phone',
        nameAr: 'هاتف مستورد',
        nameEn: 'Imported',
        brand: 'apple',
        category: 'phones',
        price: '5000',
        stock: '2',
        storage: '128GB',
      },
      { sku: 'IMP-2', productSlug: 'imported-phone', price: '5500', storage: '256 gb' },
      { sku: '=cmd', productSlug: 'x', price: '1' },
      { sku: 'IMP-1', productSlug: 'imported-phone', price: '1' },
    ]);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.summary).toMatchObject({ createProduct: 1, createVariant: 1, errors: 2 });
    expect(must(preview.rows[2]).errors).toContain('formula_not_allowed');
    expect(must(preview.rows[3]).errors).toContain('duplicate_in_file');
    expect(store.admin.catalog.listProducts(owner, {}).total).toBe(before);
    expect(store.admin.data.importCommit(owner, preview.jobId, false)).toEqual({
      ok: false,
      code: 'has_errors',
    });
    expect(store.admin.data.importCommit(owner, preview.jobId, true)).toEqual({
      ok: true,
      applied: 2,
    });
    const created = must(store.admin.catalog.listProducts(owner, { q: 'imported-phone' }).items[0]);
    expect(created).toMatchObject({ status: 'draft', variantCount: 2 });
    const history = store.admin.catalog.listPriceHistory(owner, { source: 'import' }).items;
    expect(history).toHaveLength(2);
  });

  it('keeps customer CRM notes staff-only and audited', async () => {
    const owner = await as('owner');
    const customerId = 'demo-customer-a@test.local';
    store.customer.profile(customerId);
    const note = store.admin.ops.saveCustomerNote(
      owner,
      customerId,
      null,
      'Prefers WhatsApp',
      false,
      null,
    );
    expect(note.ok).toBe(true);
    expect(store.admin.ops.getCustomer(owner, customerId)?.notes[0]?.body).toBe('Prefers WhatsApp');
    const sales = await as('sales');
    expect(() =>
      store.admin.ops.saveCustomerNote(sales, customerId, null, 'x', false, null),
    ).toThrow();
    expect(
      store.admin.data.listAuditLogs(owner, { entityType: 'public.customer_notes' }).total,
    ).toBe(1);
  });
});
