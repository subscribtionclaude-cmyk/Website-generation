import type { RawCatalog, RawProduct, RawVariant } from '@/domain/catalog/raw';
import { resolveTime } from '@/domain/catalog/raw';
import type {
  AdminBrand,
  AdminCategory,
  AdminProduct,
  AdminResult,
  AdminVariant,
  BrandInput,
  BulkVariantPatch,
  CatalogLookups,
  CategoryInput,
  CountResult,
  InventoryFilter,
  InventoryRow,
  MovementFilter,
  MovementRow,
  PriceHistoryFilter,
  PriceHistoryRow,
  ProductFilter,
  ProductInput,
  ProductListItem,
  ProductStateAction,
  SaveResult,
  StockAdjustResult,
  StockAdjustmentType,
} from '../schemas';
import { WARRANTY_KINDS } from '../schemas';
import { normaliseSku, validateProductInput, validLt, SLUG_PATTERN } from '../validation';
import {
  type AdminActor,
  type DemoAdminContext,
  lower,
  ltText,
  matchesText,
  type Page,
  paginate,
  requireAny,
} from './context';

/** Seed rows have no edit timestamp; this stable value stands in for their updatedAt. */
export const SEED_UPDATED_AT = '2026-01-01T00:00:00.000Z';

const stockState = (available: number, threshold: number, active: boolean) =>
  !active ? 'inactive' : available <= 0 ? 'out' : available <= threshold ? 'low' : 'in_stock';

/** DEMO MODE ONLY — catalog administration over the in-browser demo catalog (see context.ts). */
export class DemoAdminCatalog {
  private readonly ctx: DemoAdminContext;

  constructor(ctx: DemoAdminContext) {
    this.ctx = ctx;
  }

  private get raw(): RawCatalog {
    return this.ctx.raw;
  }

  // ── Lookups & helpers ─────────────────────────────────────────────────────
  private liveProducts() {
    return this.raw.products.filter((p) => !p.deletedAt);
  }
  private liveBrands() {
    return this.raw.brands.filter((b) => !b.deletedAt);
  }
  private liveCategories() {
    return this.raw.categories.filter((c) => !c.deletedAt);
  }
  productById(id: string) {
    return this.liveProducts().find((p) => p.id === id);
  }
  variantById(id: string): { product: RawProduct; variant: RawVariant } | null {
    for (const product of this.liveProducts()) {
      const variant = product.variants.find((v) => v.id === id && !v.retiredAt);
      if (variant) return { product, variant };
    }
    return null;
  }
  private brandId(slug: string) {
    return this.raw.brands.find((b) => b.slug === slug)?.id ?? '';
  }
  private categoryBySlug(slug: string) {
    return this.raw.categories.find((c) => c.slug === slug);
  }
  private categoryById(id: string) {
    return this.liveCategories().find((c) => c.id === id);
  }

  onHand(variantId: string) {
    return this.ctx.commerce.onHand(variantId);
  }
  reserved(variantId: string) {
    return this.ctx.commerce.reservedQuantity(variantId);
  }

  variantLabel(product: RawProduct, variant: RawVariant) {
    return product.options.flatMap((o) => {
      const value = o.values.find((v) => v.key === variant.options[o.key]);
      return value ? [value.label] : [];
    });
  }

  private lastPriceChange(variantId: string) {
    const row = [...this.ctx.state.priceHistory].reverse().find((h) => h.variantId === variantId);
    return row
      ? {
          at: row.createdAt,
          reason: row.reason,
          source: row.source,
          oldPrice: row.oldPrice,
          by: row.actorName,
        }
      : null;
  }

  private hasHistory(product: RawProduct) {
    const ids = new Set(product.variants.map((v) => v.id));
    const skus = new Set(product.variants.map((v) => v.sku));
    return (
      this.ctx.commerce
        .orderRecords()
        .some(
          (o) =>
            o.items.some((i) => skus.has(i.sku) || i.productSlug === product.slug) ||
            o.reservations.some((r) => ids.has(r.variantId)),
        ) ||
      this.ctx.services
        .records()
        .some((r) => r.targetVariantId !== null && ids.has(r.targetVariantId)) ||
      this.ctx.customer.adminState().reviews.some((r) => r.productId === product.id) ||
      this.raw.reviews.some((r) => r.product === product.slug)
    );
  }

  private hasActiveOffer(product: RawProduct) {
    const now = this.ctx.now().getTime();
    return this.raw.offers.some((o) => {
      if (o.status !== 'published' || !o.products.some((p) => p.slug === product.slug))
        return false;
      const s = resolveTime(o.startsAt, this.ctx.now());
      const e = resolveTime(o.endsAt, this.ctx.now());
      return (!s || new Date(s).getTime() <= now) && (!e || new Date(e).getTime() > now);
    });
  }

  lookups(actor: AdminActor): CatalogLookups {
    requireAny(
      actor,
      'catalog.view',
      'inventory.manage',
      'pricing.manage',
      'marketing.manage',
      'content.view',
      'data.import',
    );
    return {
      brands: this.liveBrands()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b) => ({ id: b.id, slug: b.slug, name: b.name, isVisible: b.isVisible })),
      categories: this.liveCategories()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          parentId: c.parentSlug ? (this.categoryBySlug(c.parentSlug)?.id ?? null) : null,
          isVisible: c.isVisible,
        })),
    };
  }

  // ── Products ──────────────────────────────────────────────────────────────
  private variantJson(v: RawVariant): AdminVariant {
    const stock = this.onHand(v.id);
    const reserved = this.reserved(v.id);
    return {
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      stock,
      reserved,
      available: stock - reserved,
      lowStockThreshold: v.lowStockThreshold,
      isActive: v.isActive,
      isDefault: v.isDefault,
      warranty: v.warranty,
      warrantyKind: v.warrantyKind,
      updatedAt: v.updatedAt ?? SEED_UPDATED_AT,
      options: v.options,
      lastPriceChange: this.lastPriceChange(v.id),
    };
  }

  productJson(p: RawProduct): AdminProduct {
    return {
      id: p.id,
      slug: p.slug,
      brandId: this.brandId(p.brandSlug),
      model: p.model,
      name: p.name,
      subtitle: p.subtitle,
      description: p.description,
      warranty: p.warranty,
      warrantyKind: p.warrantyKind,
      availabilityState: p.availabilityState,
      status: p.status,
      isVisible: p.isVisible,
      isNew: p.isNew,
      isFeatured: p.isFeatured,
      releaseDate: p.releaseDate
        ? (resolveTime(p.releaseDate, this.ctx.now())?.slice(0, 10) ?? null)
        : null,
      keywords: p.keywords,
      seoTitle: p.seo.title,
      seoDescription: p.seo.description,
      isDemo: true,
      createdAt: p.createdAt ?? SEED_UPDATED_AT,
      updatedAt: p.updatedAt ?? SEED_UPDATED_AT,
      hasHistory: this.hasHistory(p),
      categories: p.categorySlugs.flatMap((slug, i) => {
        const c = this.categoryBySlug(slug);
        return c ? [{ id: c.id, isPrimary: i === 0 }] : [];
      }),
      options: p.options.map((o) => ({
        key: o.key,
        name: o.name,
        values: o.values.map((v) => ({ key: v.key, label: v.label, swatchHex: v.hex })),
      })),
      variants: p.variants.filter((v) => !v.retiredAt).map((v) => this.variantJson(v)),
      media: [...p.media]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          url: m.url,
          posterUrl: m.posterUrl,
          captionsUrl: m.captionsUrl,
          alt: m.alt,
          width: m.width,
          height: m.height,
          isCover: m.isCover,
          variantSku: m.variantSku,
          colorKey: m.colorKey,
        })),
      specGroups: p.specGroups.map((g) => ({
        key: g.key,
        title: g.title,
        items: g.items.map((i) => ({
          key: i.key,
          label: i.label,
          value: i.value,
          visible: i.visible,
        })),
      })),
      relations: p.relations.flatMap((r) => {
        if (r.kind === 'bought_together') return [];
        const target = this.liveProducts().find((x) => x.slug === r.slug);
        return target
          ? [{ kind: r.kind, productId: target.id, slug: target.slug, name: target.name }]
          : [];
      }),
    };
  }

  listProducts(actor: AdminActor, filter: ProductFilter): Page<ProductListItem> {
    requireAny(actor, 'catalog.view', 'inventory.manage', 'pricing.manage');
    const rows = this.liveProducts()
      .map((p) => {
        const variants = p.variants.filter((v) => !v.retiredAt);
        const states = variants.map((v) => {
          const available = this.onHand(v.id) - this.reserved(v.id);
          return { available, state: stockState(available, v.lowStockThreshold, v.isActive) };
        });
        const prices = variants
          .filter((v) => v.isActive && v.price !== null)
          .map((v) => v.price as number);
        const brand = this.raw.brands.find((b) => b.slug === p.brandSlug);
        const category = this.categoryBySlug(p.categorySlugs[0] ?? '');
        const cover =
          [...p.media]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .find((m) => m.isCover && m.kind === 'image') ??
          p.media.find((m) => m.kind === 'image');
        const item: ProductListItem = {
          id: p.id,
          slug: p.slug,
          name: p.name,
          model: p.model,
          status: p.status,
          isVisible: p.isVisible,
          isDemo: true,
          isNew: p.isNew,
          isFeatured: p.isFeatured,
          availabilityState: p.availabilityState,
          updatedAt: p.updatedAt ?? SEED_UPDATED_AT,
          brand: brand ? { id: brand.id, name: brand.name } : null,
          category: category ? { id: category.id, name: category.name } : null,
          image: cover?.url ?? null,
          startingPrice: prices.length ? Math.min(...prices) : null,
          variantCount: variants.length,
          stock: {
            total: states.reduce((n, s) => n + Math.max(s.available, 0), 0),
            available: states.filter((s) => s.state === 'in_stock' || s.state === 'low').length,
            out: states.filter((s) => s.state === 'out').length,
            low: states.filter((s) => s.state === 'low').length,
          },
          hasOffer: this.hasActiveOffer(p),
        };
        return { item, p, variants };
      })
      .filter(({ item, p, variants }) => {
        if (
          !matchesText(
            filter.q,
            ltText(p.name),
            p.slug,
            p.model,
            ...variants.map((v) => v.sku),
            ...variants.map((v) => v.barcode),
          )
        )
          return false;
        if (filter.brandId && item.brand?.id !== filter.brandId) return false;
        if (
          filter.categoryId &&
          !p.categorySlugs.some((s) => this.categoryBySlug(s)?.id === filter.categoryId)
        )
          return false;
        if (filter.status && p.status !== filter.status) return false;
        if (filter.visibility && (filter.visibility === 'visible') !== p.isVisible) return false;
        if (filter.stock === 'out' && item.stock.out === 0) return false;
        if (filter.stock === 'low' && item.stock.low === 0) return false;
        if (filter.stock === 'in_stock' && item.stock.available === 0) return false;
        if (filter.offer && (filter.offer === 'with') !== item.hasOffer) return false;
        if (filter.data === 'live') return false;
        return true;
      })
      .map(({ item }) => item);
    const sort = filter.sort ?? 'updated_desc';
    const byName = (a: ProductListItem, b: ProductListItem) =>
      lower(a.name.en ?? a.name.ar).localeCompare(lower(b.name.en ?? b.name.ar));
    rows.sort((a, b) => {
      switch (sort) {
        case 'name':
          return byName(a, b);
        case 'price_asc':
          return (a.startingPrice ?? Infinity) - (b.startingPrice ?? Infinity) || byName(a, b);
        case 'price_desc':
          return (b.startingPrice ?? -Infinity) - (a.startingPrice ?? -Infinity) || byName(a, b);
        case 'stock_asc':
          return a.stock.total - b.stock.total || byName(a, b);
        default:
          return b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
      }
    });
    return paginate(rows, filter);
  }

  getProduct(actor: AdminActor, id: string): AdminProduct | null {
    requireAny(actor, 'catalog.view', 'inventory.manage', 'pricing.manage');
    const p = this.productById(id);
    return p ? this.productJson(p) : null;
  }

  private recordPrice(
    actor: AdminActor,
    product: RawProduct,
    variant: RawVariant,
    before: { price: number | null; compareAt: number | null },
    reason: string | null,
    source: 'admin' | 'bulk' | 'import' | 'system',
  ) {
    if (before.price === variant.price && before.compareAt === variant.compareAtPrice) return;
    this.ctx.state.seq += 1;
    this.ctx.state.priceHistory.push({
      id: this.ctx.state.seq,
      createdAt: this.ctx.stamp(),
      variantId: variant.id,
      productId: product.id,
      oldPrice: before.price,
      newPrice: variant.price,
      oldCompareAt: before.compareAt,
      newCompareAt: variant.compareAtPrice,
      reason: reason?.trim() || null,
      source,
      actorName: actor.name,
    });
  }

  saveProduct(
    actor: AdminActor,
    input: ProductInput,
    source: 'admin' | 'import' = 'admin',
  ): SaveResult {
    requireAny(actor, 'catalog.manage');
    const problem = validateProductInput(input);
    if (problem) return { ok: false, ...problem };
    const slug = input.slug.trim().toLowerCase();
    const existing = input.id ? this.productById(input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    const brand = this.liveBrands().find((b) => b.id === input.brandId);
    if (!brand) return { ok: false, code: 'brand_required', field: 'brandId' };
    const categories = input.categoryIds.map((id) => this.categoryById(id));
    if (categories.some((c) => !c))
      return { ok: false, code: 'category_required', field: 'categoryIds' };
    if (input.warrantyKind && !WARRANTY_KINDS.includes(input.warrantyKind))
      return { ok: false, code: 'invalid_warranty' };
    if (this.raw.products.some((p) => p.slug === slug && p.id !== input.id))
      return { ok: false, code: 'slug_taken', field: 'slug' };
    const otherSkus = new Set(
      this.raw.products.flatMap((p) =>
        p.variants.filter((v) => !input.variants.some((iv) => iv.id === v.id)).map((v) => v.sku),
      ),
    );
    if (input.variants.some((v) => otherSkus.has(normaliseSku(v.sku))))
      return { ok: false, code: 'sku_taken', field: 'variants' };
    for (const r of input.relations) {
      if (
        !this.productById(r.productId) ||
        !['accessory', 'similar', 'recommended', 'compatible'].includes(r.kind)
      )
        return { ok: false, code: 'invalid_relation', field: 'relations' };
    }
    if (existing) {
      if ((existing.updatedAt ?? SEED_UPDATED_AT) !== input.expectedUpdatedAt)
        return { ok: false, code: 'stale' };
      for (const v of input.variants) {
        if (!v.id) continue;
        const current = existing.variants.find((x) => x.id === v.id && !x.retiredAt);
        if (!current || (current.updatedAt ?? SEED_UPDATED_AT) !== v.updatedAt)
          return { ok: false, code: 'stale_variant' };
      }
    }
    const priceChanges = input.variants.filter((v) => {
      const current = v.id ? existing?.variants.find((x) => x.id === v.id) : undefined;
      return current
        ? current.price !== v.price || current.compareAtPrice !== v.compareAtPrice
        : v.price !== null || v.compareAtPrice !== null;
    }).length;
    if (priceChanges > 0 && !actor.can('pricing.manage'))
      return { ok: false, code: 'pricing_forbidden', field: 'variants' };
    if (
      input.variants.some((v) => !v.id && (v.initialStock ?? 0) > 0) &&
      !actor.can('inventory.manage')
    )
      return { ok: false, code: 'inventory_forbidden', field: 'variants' };

    const now = this.ctx.stamp();
    const before = existing ? structuredClone(existing) : null;
    const product: RawProduct = existing ?? {
      id: this.ctx.uuid(),
      slug,
      brandSlug: brand.slug,
      categorySlugs: [],
      model: null,
      name: input.name,
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
      options: [],
      variants: [],
      media: [],
      specGroups: [],
      relations: [],
      seo: { title: null, description: null },
    };
    const primary =
      input.primaryCategoryId && input.categoryIds.includes(input.primaryCategoryId)
        ? input.primaryCategoryId
        : input.categoryIds[0];
    const orderedCats = [
      ...(primary ? [primary] : []),
      ...input.categoryIds.filter((id) => id !== primary),
    ];
    Object.assign(product, {
      slug,
      brandSlug: brand.slug,
      categorySlugs: orderedCats.flatMap((id) => this.categoryById(id)?.slug ?? []),
      model: input.model?.trim() || null,
      name: input.name,
      subtitle: input.subtitle,
      description: input.description,
      warranty: input.warranty,
      warrantyKind: input.warrantyKind,
      availabilityState: input.availabilityState,
      status: input.status,
      isVisible: input.isVisible,
      isNew: input.isNew,
      isFeatured: input.isFeatured,
      releaseDate: input.releaseDate,
      keywords: input.keywords.slice(0, 1000),
      seo: { title: input.seoTitle, description: input.seoDescription },
      updatedAt: now,
      options: input.options.map((o) => ({
        key: o.key,
        name: o.name,
        values: o.values.map((v) => ({ key: v.key, label: v.label, hex: v.swatchHex ?? null })),
      })),
    });

    const kept = new Set<string>();
    const defaultSku = input.variants.find((v) => v.isDefault)?.sku ?? input.variants[0]?.sku ?? '';
    const nextVariants: RawVariant[] = [];
    const initial: { variant: RawVariant; qty: number }[] = [];
    for (const v of input.variants) {
      const sku = normaliseSku(v.sku);
      const current = v.id ? product.variants.find((x) => x.id === v.id) : undefined;
      const priceBefore = {
        price: current?.price ?? null,
        compareAt: current?.compareAtPrice ?? null,
      };
      const changed =
        !current ||
        current.sku !== sku ||
        current.price !== v.price ||
        current.compareAtPrice !== v.compareAtPrice ||
        current.isActive !== v.isActive ||
        current.lowStockThreshold !== v.lowStockThreshold ||
        current.barcode !== (v.barcode?.trim() || null) ||
        current.warrantyKind !== v.warrantyKind ||
        JSON.stringify(current.warranty) !== JSON.stringify(v.warranty) ||
        JSON.stringify(current.options) !== JSON.stringify(v.options);
      const variant: RawVariant = {
        id: current?.id ?? this.ctx.uuid(),
        sku,
        options: v.options,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        stock: current?.stock ?? 0,
        lowStockThreshold: v.lowStockThreshold,
        isActive: v.isActive,
        isDefault: normaliseSku(defaultSku) === sku,
        warranty: v.warranty,
        barcode: v.barcode?.trim() || null,
        warrantyKind: v.warrantyKind,
        updatedAt: changed ? now : (current?.updatedAt ?? null),
        retiredAt: null,
      };
      kept.add(variant.id);
      nextVariants.push(variant);
      const initialStock = v.initialStock ?? 0;
      if (!current && initialStock > 0) initial.push({ variant, qty: initialStock });
      this.recordPrice(actor, product, variant, priceBefore, input.priceReason, source);
    }
    // Removed variants are retired (kept for order history), never deleted.
    const retired = product.variants
      .filter((v) => !kept.has(v.id))
      .map((v) => ({ ...v, isActive: false, isDefault: false, retiredAt: v.retiredAt ?? now }));
    product.variants = [...nextVariants, ...retired];

    product.media = input.media.map((m, i) => ({
      id: `${product.id}-m${i + 1}`,
      kind: m.kind,
      url: m.url,
      posterUrl: m.posterUrl,
      captionsUrl: m.captionsUrl ?? null,
      alt: m.alt ?? input.name,
      width: m.width,
      height: m.height,
      colorKey: m.colorKey,
      variantSku: m.variantSku ? normaliseSku(m.variantSku) : null,
      isCover: m.isCover,
      sortOrder: i + 1,
    }));
    if (!product.media.some((m) => m.isCover)) {
      const firstImage = product.media.find((m) => m.kind === 'image');
      if (firstImage) firstImage.isCover = true;
    }
    product.specGroups = input.specGroups.map((g) => ({
      key: g.key,
      title: g.title,
      items: g.items.map((i) => ({
        key: i.key,
        label: i.label,
        value: i.value,
        visible: i.visible,
      })),
    }));
    const derived = product.relations.filter((r) => r.kind === 'bought_together');
    const seen = new Set<string>();
    product.relations = [
      ...input.relations.flatMap((r, i) => {
        const target = this.productById(r.productId);
        const key = `${r.kind}:${target?.slug}`;
        if (!target || seen.has(key)) return [];
        seen.add(key);
        return [{ kind: r.kind, slug: target.slug, sortOrder: i + 1 }];
      }),
      ...derived,
    ];
    if (!existing) this.raw.products.push(product);
    for (const { variant, qty } of initial) {
      this.ctx.commerce.applyStockChange(variant.id, qty, {
        reason: 'initial',
        note: 'Initial stock',
        actorName: actor.name,
      });
    }
    this.ctx.audit(
      actor,
      existing ? 'catalog.product_saved' : 'catalog.product_created',
      'public.products',
      product.id,
      before ? { slug: before.slug, status: before.status, name: before.name } : null,
      { slug: product.slug, status: product.status, name: product.name },
      { variants: input.variants.length, price_changes: priceChanges },
    );
    this.ctx.catalogChanged();
    return { ok: true, id: product.id, updatedAt: now };
  }

  setProductsState(actor: AdminActor, ids: string[], action: ProductStateAction): CountResult {
    requireAny(actor, 'catalog.manage');
    if (ids.length === 0 || ids.length > 500) return { ok: false, code: 'invalid_selection' };
    let count = 0;
    const now = this.ctx.stamp();
    for (const p of this.liveProducts()) {
      if (!ids.includes(p.id)) continue;
      if (action === 'publish') p.status = 'published';
      else if (action === 'draft' || action === 'restore') p.status = 'draft';
      else if (action === 'archive') p.status = 'archived';
      else p.isVisible = action === 'show';
      p.updatedAt = now;
      count += 1;
    }
    this.ctx.audit(actor, `catalog.products_${action}`, 'public.products', null, null, null, {
      ids,
      count,
    });
    this.ctx.catalogChanged();
    return { ok: true, updated: count };
  }

  duplicateProduct(actor: AdminActor, id: string): SaveResult {
    requireAny(actor, 'catalog.manage');
    const source = this.productById(id);
    if (!source) return { ok: false, code: 'not_found' };
    const src = this.productJson(source);
    let suffix = 1;
    let slug = `${src.slug.slice(0, 70)}-copy`;
    while (this.raw.products.some((p) => p.slug === slug)) {
      suffix += 1;
      slug = `${src.slug.slice(0, 70)}-copy-${suffix}`;
    }
    const result = this.saveProduct(actor, {
      slug,
      brandId: src.brandId,
      categoryIds: src.categories.map((c) => c.id),
      primaryCategoryId: src.categories.find((c) => c.isPrimary)?.id ?? null,
      model: src.model,
      name: src.name,
      subtitle: src.subtitle,
      description: src.description,
      warranty: src.warranty,
      warrantyKind: src.warrantyKind,
      availabilityState: src.availabilityState,
      status: 'draft',
      isVisible: src.isVisible,
      isNew: src.isNew,
      isFeatured: src.isFeatured,
      releaseDate: src.releaseDate,
      keywords: src.keywords,
      seoTitle: src.seoTitle,
      seoDescription: src.seoDescription,
      options: src.options,
      variants: src.variants.map((v) => ({
        sku: `${v.sku.slice(0, 55)}-COPY${suffix}`,
        barcode: null,
        options: v.options,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        initialStock: 0,
        lowStockThreshold: v.lowStockThreshold,
        isActive: v.isActive,
        isDefault: v.isDefault,
        warranty: v.warranty,
        warrantyKind: v.warrantyKind,
      })),
      media: src.media.map((m) => ({ ...m, variantSku: null })),
      specGroups: src.specGroups,
      relations: src.relations.map((r) => ({ kind: r.kind, productId: r.productId })),
      priceReason: `Duplicated from ${src.slug}`,
    });
    if (result.ok)
      this.ctx.audit(
        actor,
        'catalog.product_duplicated',
        'public.products',
        result.id,
        null,
        null,
        { source: id },
      );
    return result;
  }

  deleteProduct(actor: AdminActor, id: string): AdminResult {
    requireAny(actor, 'catalog.manage');
    const p = this.productById(id);
    if (!p) return { ok: false, code: 'not_found' };
    if (this.hasHistory(p)) return { ok: false, code: 'has_history' };
    this.raw.products = this.raw.products.filter((x) => x.id !== id);
    this.ctx.audit(actor, 'catalog.product_deleted', 'public.products', id, null, null, {
      slug: p.slug,
    });
    this.ctx.catalogChanged();
    return { ok: true };
  }

  // ── Pricing ───────────────────────────────────────────────────────────────
  setVariantPrice(
    actor: AdminActor,
    variantId: string,
    price: number | null,
    compareAt: number | null,
    reason: string,
    expectedUpdatedAt: string | null,
  ): AdminResult<{ updatedAt: string }> {
    requireAny(actor, 'pricing.manage');
    const found = this.variantById(variantId);
    if (!found) return { ok: false, code: 'not_found' };
    const { product, variant } = found;
    if ((variant.updatedAt ?? SEED_UPDATED_AT) !== expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    if (
      (price !== null && (!Number.isFinite(price) || price < 0)) ||
      (compareAt !== null && (!Number.isFinite(compareAt) || compareAt < 0)) ||
      (price !== null && compareAt !== null && compareAt <= price)
    )
      return { ok: false, code: 'invalid_price' };
    if (variant.price === price && variant.compareAtPrice === compareAt)
      return { ok: false, code: 'no_change' };
    const before = { price: variant.price, compareAt: variant.compareAtPrice };
    variant.price = price;
    variant.compareAtPrice = compareAt;
    variant.updatedAt = this.ctx.stamp();
    this.recordPrice(actor, product, variant, before, reason, 'admin');
    this.ctx.audit(
      actor,
      'price.changed',
      'public.product_variants',
      variant.sku,
      before,
      { price, compareAt },
      { reason },
    );
    this.ctx.catalogChanged();
    return { ok: true, updatedAt: variant.updatedAt };
  }

  bulkUpdateVariants(
    actor: AdminActor,
    ids: string[],
    patch: BulkVariantPatch,
    reason: string,
  ): CountResult {
    requireAny(actor, 'catalog.manage', 'pricing.manage', 'inventory.manage');
    if (ids.length === 0 || ids.length > 500) return { ok: false, code: 'invalid_selection' };
    const mode = patch.priceMode ?? null;
    const compare = patch.compareAt ?? 'keep';
    const value = patch.priceValue;
    if (mode || compare !== 'keep') {
      if (!actor.can('pricing.manage')) return { ok: false, code: 'pricing_forbidden' };
      if (
        mode &&
        (value === undefined ||
          !Number.isFinite(value) ||
          (mode === 'set' && value < 0) ||
          (mode === 'percent' && (value < -90 || value > 500)))
      )
        return { ok: false, code: 'invalid_price' };
      if (!reason.trim()) return { ok: false, code: 'reason_required' };
    }
    if (
      ('isActive' in patch || 'warrantyKind' in patch || 'warranty' in patch) &&
      !actor.can('catalog.manage')
    )
      return { ok: false, code: 'catalog_forbidden' };
    if ('lowStockThreshold' in patch) {
      if (!actor.can('inventory.manage') && !actor.can('catalog.manage'))
        return { ok: false, code: 'inventory_forbidden' };
      if (!Number.isInteger(patch.lowStockThreshold) || (patch.lowStockThreshold ?? -1) < 0)
        return { ok: false, code: 'invalid_threshold' };
    }
    if (patch.warrantyKind && !WARRANTY_KINDS.includes(patch.warrantyKind))
      return { ok: false, code: 'invalid_warranty' };
    const targets = ids.flatMap((id) => this.variantById(id) ?? []);
    if (mode && mode !== 'set' && targets.some((t) => t.variant.price === null))
      return { ok: false, code: 'price_missing' };
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const v = value ?? 0;
    const nextPrice = (p: number | null) =>
      mode === 'set'
        ? round2(v)
        : p === null
          ? null
          : mode === 'percent'
            ? Math.round(p * (1 + v / 100))
            : mode === 'amount'
              ? round2(p + v)
              : p;
    if (targets.some((t) => (nextPrice(t.variant.price) ?? 0) < 0))
      return { ok: false, code: 'invalid_price' };
    const now = this.ctx.stamp();
    for (const { product, variant } of targets) {
      const before = { price: variant.price, compareAt: variant.compareAtPrice };
      const newPrice = nextPrice(variant.price);
      if (compare === 'clear') variant.compareAtPrice = null;
      else if (compare === 'previous' && mode) variant.compareAtPrice = variant.price;
      variant.price = newPrice;
      if (
        variant.compareAtPrice !== null &&
        variant.price !== null &&
        variant.compareAtPrice <= variant.price
      )
        variant.compareAtPrice = null;
      if (patch.isActive !== undefined) variant.isActive = patch.isActive;
      if (patch.lowStockThreshold !== undefined)
        variant.lowStockThreshold = patch.lowStockThreshold;
      if ('warrantyKind' in patch) variant.warrantyKind = patch.warrantyKind ?? null;
      if ('warranty' in patch) variant.warranty = patch.warranty ?? null;
      variant.updatedAt = now;
      this.recordPrice(actor, product, variant, before, reason, 'bulk');
    }
    this.ctx.audit(
      actor,
      'catalog.variants_bulk_updated',
      'public.product_variants',
      null,
      null,
      patch,
      {
        ids,
        count: targets.length,
        reason,
      },
    );
    this.ctx.catalogChanged();
    return { ok: true, updated: targets.length };
  }

  listPriceHistory(actor: AdminActor, filter: PriceHistoryFilter): Page<PriceHistoryRow> {
    requireAny(actor, 'pricing.manage', 'catalog.view');
    const rows = [...this.ctx.state.priceHistory]
      .reverse()
      .flatMap((h): PriceHistoryRow[] => {
        const product = this.raw.products.find((p) => p.id === h.productId);
        const variant = product?.variants.find((v) => v.id === h.variantId);
        if (!product || !variant) return [];
        return [
          {
            id: h.id,
            createdAt: h.createdAt,
            variantId: h.variantId,
            productId: h.productId,
            sku: variant.sku,
            productName: product.name,
            productSlug: product.slug,
            variantLabel: this.variantLabel(product, variant),
            oldPrice: h.oldPrice,
            newPrice: h.newPrice,
            oldCompareAt: h.oldCompareAt,
            newCompareAt: h.newCompareAt,
            reason: h.reason,
            source: h.source,
            actorName: h.actorName,
            isDemo: true,
          },
        ];
      })
      .filter(
        (r) =>
          (!filter.variantId || r.variantId === filter.variantId) &&
          (!filter.productId || r.productId === filter.productId) &&
          (!filter.source || r.source === filter.source) &&
          (!filter.from || r.createdAt >= filter.from) &&
          (!filter.to || r.createdAt < filter.to) &&
          matchesText(filter.q, r.sku, ltText(r.productName), r.productSlug) &&
          matchesText(filter.actor, r.actorName),
      );
    return paginate(rows, filter);
  }

  // ── Stock ─────────────────────────────────────────────────────────────────
  private backInStockAt(variantId: string): string | null {
    const since = this.ctx.now().getTime() - 14 * 86_400_000;
    const row = [...this.ctx.commerce.movementRecords()]
      .reverse()
      .find(
        (m) =>
          m.variantId === variantId &&
          m.delta > 0 &&
          m.quantityAfter - m.delta <= 0 &&
          new Date(m.at).getTime() > since,
      );
    return row?.at ?? null;
  }

  listInventory(actor: AdminActor, filter: InventoryFilter): Page<InventoryRow> {
    requireAny(actor, 'inventory.manage', 'catalog.view');
    const view = filter.view ?? 'all';
    const rows: InventoryRow[] = [];
    for (const p of this.liveProducts()) {
      if (filter.brandId && this.brandId(p.brandSlug) !== filter.brandId) continue;
      if (
        filter.categoryId &&
        !p.categorySlugs.some((s) => this.categoryBySlug(s)?.id === filter.categoryId)
      )
        continue;
      for (const v of p.variants) {
        if (v.retiredAt) continue;
        if (!matchesText(filter.q, v.sku, ltText(p.name)) && v.barcode !== filter.q?.trim())
          continue;
        const quantity = this.onHand(v.id);
        const reserved = this.reserved(v.id);
        const available = quantity - reserved;
        const moves = this.ctx.commerce.movementRecords().filter((m) => m.variantId === v.id);
        const back = this.backInStockAt(v.id);
        const match =
          view === 'low'
            ? v.isActive && available > 0 && available <= v.lowStockThreshold
            : view === 'out'
              ? v.isActive && available <= 0
              : view === 'back_in_stock'
                ? v.isActive && available > 0 && back !== null
                : true;
        if (!match) continue;
        rows.push({
          variantId: v.id,
          productId: p.id,
          sku: v.sku,
          productName: p.name,
          productSlug: p.slug,
          variantLabel: this.variantLabel(p, v),
          quantity,
          reserved,
          available,
          lowStockThreshold: v.lowStockThreshold,
          isActive: v.isActive,
          state: stockState(available, v.lowStockThreshold, v.isActive),
          lastMovementAt: moves[moves.length - 1]?.at ?? null,
          backInStockAt: back,
          updatedAt: v.updatedAt ?? SEED_UPDATED_AT,
          isDemo: true,
        });
      }
    }
    rows.sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));
    return paginate(rows, filter);
  }

  adjustStock(
    actor: AdminActor,
    variantId: string,
    type: StockAdjustmentType,
    quantity: number,
    reason: string,
    expectedQuantity: number | null,
  ): StockAdjustResult {
    requireAny(actor, 'inventory.manage');
    if (!['addition', 'reduction', 'damage', 'return', 'correction'].includes(type))
      return { ok: false, code: 'invalid_type' };
    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      (type !== 'correction' && quantity === 0) ||
      quantity > 100000
    )
      return { ok: false, code: 'invalid_quantity', field: 'quantity' };
    if (!reason.trim()) return { ok: false, code: 'reason_required', field: 'reason' };
    const found = this.variantById(variantId);
    if (!found) return { ok: false, code: 'not_found' };
    const before = this.onHand(variantId);
    if (expectedQuantity !== null && expectedQuantity !== before)
      return { ok: false, code: 'stale', quantity: before };
    const after =
      type === 'addition' || type === 'return'
        ? before + quantity
        : type === 'correction'
          ? quantity
          : before - quantity;
    if (after < 0) return { ok: false, code: 'negative', quantity: before };
    if (after === before) return { ok: false, code: 'no_change' };
    const reserved = this.reserved(variantId);
    if (after < reserved) return { ok: false, code: 'below_reserved', reserved };
    this.ctx.commerce.applyStockChange(variantId, after - before, {
      reason: type,
      note: reason.trim().slice(0, 500),
      actorName: actor.name,
    });
    found.variant.updatedAt = this.ctx.stamp();
    this.ctx.audit(
      actor,
      'stock.adjusted',
      'public.product_variants',
      found.variant.sku,
      { quantity: before },
      { quantity: after },
      { type, reason },
    );
    this.ctx.catalogChanged();
    return {
      ok: true,
      before,
      after,
      reserved,
      available: after - reserved,
      updatedAt: found.variant.updatedAt,
    };
  }

  listStockMovements(actor: AdminActor, filter: MovementFilter): Page<MovementRow> {
    requireAny(actor, 'inventory.manage', 'catalog.view');
    const orders = this.ctx.commerce.orderRecords();
    const rows = this.ctx.commerce
      .movementRecords()
      .map((m, i) => ({ m, id: i + 1 }))
      .reverse()
      .flatMap(({ m, id }): MovementRow[] => {
        const found = this.raw.products
          .map((p) => ({ p, v: p.variants.find((v) => v.id === m.variantId) }))
          .find((x) => x.v);
        if (!found?.v) return [];
        const type =
          m.reason === 'sale' || m.reason === 'cancellation_restock' ? m.reason : m.reason;
        return [
          {
            id,
            createdAt: m.at,
            type,
            variantId: m.variantId,
            sku: found.v.sku,
            productName: found.p.name,
            variantLabel: this.variantLabel(found.p, found.v),
            quantityBefore: m.quantityBefore ?? m.quantityAfter - m.delta,
            change: m.delta,
            quantityAfter: m.quantityAfter,
            reason: m.note ?? null,
            orderNumber: m.orderId
              ? (orders.find((o) => o.id === m.orderId)?.orderNumber ?? null)
              : null,
            actorName: m.actorName ?? null,
            isDemo: true,
          },
        ];
      })
      .filter(
        (r) =>
          (!filter.variantId || r.variantId === filter.variantId) &&
          (!filter.type || r.type === filter.type) &&
          (!filter.from || r.createdAt >= filter.from) &&
          (!filter.to || r.createdAt < filter.to) &&
          matchesText(filter.q, r.sku, ltText(r.productName), r.orderNumber) &&
          matchesText(filter.actor, r.actorName),
      );
    return paginate(rows, filter);
  }

  // ── Categories ────────────────────────────────────────────────────────────
  listCategories(actor: AdminActor): AdminCategory[] {
    requireAny(actor, 'catalog.view');
    return this.liveCategories()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        parentId: c.parentSlug ? (this.categoryBySlug(c.parentSlug)?.id ?? null) : null,
        name: c.name,
        description: c.description,
        icon: c.icon,
        imageUrl: c.imageUrl,
        sortOrder: c.sortOrder,
        isVisible: c.isVisible,
        showInNav: c.showInNav,
        showOnHome: c.showOnHome,
        showInShop: c.showInShop,
        showInCategoryGrid: c.showInCategoryGrid,
        seoTitle: c.seoTitle,
        seoDescription: c.seoDescription,
        isDemo: true,
        updatedAt: c.updatedAt ?? SEED_UPDATED_AT,
        productCount: this.liveProducts().filter((p) => p.categorySlugs.includes(c.slug)).length,
        childCount: this.liveCategories().filter((x) => x.parentSlug === c.slug).length,
      }));
  }

  saveCategory(actor: AdminActor, input: CategoryInput): SaveResult {
    requireAny(actor, 'catalog.manage');
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) return { ok: false, code: 'invalid_slug', field: 'slug' };
    if (!validLt(input.name)) return { ok: false, code: 'name_required', field: 'name' };
    if (input.icon && !/^[a-z-]{1,30}$/.test(input.icon))
      return { ok: false, code: 'invalid_icon', field: 'icon' };
    if (input.imageUrl && !/^(\/|https:\/\/|data:image\/)/.test(input.imageUrl))
      return { ok: false, code: 'invalid_image', field: 'imageUrl' };
    if (this.raw.categories.some((c) => c.slug === slug && c.id !== input.id))
      return { ok: false, code: 'slug_taken', field: 'slug' };
    const parent = input.parentId ? this.categoryById(input.parentId) : null;
    if (input.parentId && !parent)
      return { ok: false, code: 'parent_not_found', field: 'parentId' };
    if (parent) {
      let cursor: typeof parent | undefined = parent;
      let depth = 0;
      while (cursor) {
        if (cursor.id === input.id) return { ok: false, code: 'cycle', field: 'parentId' };
        depth += 1;
        if (depth > 10) return { ok: false, code: 'too_deep', field: 'parentId' };
        cursor = cursor.parentSlug ? this.categoryBySlug(cursor.parentSlug) : undefined;
      }
    }
    const now = this.ctx.stamp();
    const existing = input.id ? this.categoryById(input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    if (existing && (existing.updatedAt ?? SEED_UPDATED_AT) !== input.expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    const oldSlug = existing?.slug;
    const fields = {
      slug,
      parentSlug: parent?.slug ?? null,
      name: input.name,
      description: input.description,
      icon: input.icon || null,
      imageUrl: input.imageUrl || null,
      isVisible: input.isVisible,
      showInNav: input.showInNav,
      showOnHome: input.showOnHome,
      showInShop: input.showInShop,
      showInCategoryGrid: input.showInCategoryGrid,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      updatedAt: now,
    };
    let id: string;
    if (existing) {
      const before = { ...existing };
      Object.assign(existing, fields);
      id = existing.id;
      if (oldSlug && oldSlug !== slug) this.renameCategorySlug(oldSlug, slug);
      this.ctx.audit(actor, 'update', 'public.categories', id, before, { ...existing });
    } else {
      id = this.ctx.uuid();
      const siblings = this.liveCategories().filter((c) => c.parentSlug === (parent?.slug ?? null));
      this.raw.categories.push({
        id,
        ...fields,
        sortOrder: input.sortOrder || Math.max(0, ...siblings.map((c) => c.sortOrder)) + 1,
        deletedAt: null,
      });
      this.ctx.audit(actor, 'insert', 'public.categories', id, null, fields);
    }
    this.ctx.catalogChanged();
    return { ok: true, id, updatedAt: now };
  }

  private renameCategorySlug(from: string, to: string) {
    for (const c of this.raw.categories) if (c.parentSlug === from) c.parentSlug = to;
    for (const p of this.raw.products)
      p.categorySlugs = p.categorySlugs.map((s) => (s === from ? to : s));
    for (const b of this.raw.brands)
      b.categorySlugs = b.categorySlugs.map((s) => (s === from ? to : s));
    for (const o of this.raw.offers)
      o.categorySlugs = o.categorySlugs.map((s) => (s === from ? to : s));
  }

  reorderCategories(actor: AdminActor, parentId: string | null, ids: string[]): AdminResult {
    requireAny(actor, 'catalog.manage');
    const parentSlug = parentId ? (this.categoryById(parentId)?.slug ?? '__missing__') : null;
    const cats = ids.flatMap((id) => this.categoryById(id) ?? []);
    if (cats.length !== ids.length || cats.some((c) => c.parentSlug !== parentSlug))
      return { ok: false, code: 'invalid_selection' };
    const now = this.ctx.stamp();
    cats.forEach((c, i) => {
      c.sortOrder = i + 1;
      c.updatedAt = now;
    });
    this.ctx.audit(
      actor,
      'catalog.categories_reordered',
      'public.categories',
      parentId,
      null,
      null,
      { ids },
    );
    this.ctx.catalogChanged();
    return { ok: true };
  }

  deleteCategory(actor: AdminActor, id: string): AdminResult {
    requireAny(actor, 'catalog.manage');
    const c = this.categoryById(id);
    if (!c) return { ok: false, code: 'not_found' };
    if (
      this.liveCategories().some((x) => x.parentSlug === c.slug) ||
      this.liveProducts().some((p) => p.categorySlugs.includes(c.slug))
    )
      return { ok: false, code: 'in_use' };
    c.deletedAt = this.ctx.stamp();
    c.isVisible = false;
    this.ctx.audit(actor, 'catalog.category_deleted', 'public.categories', id, null, null, {
      slug: c.slug,
    });
    this.ctx.catalogChanged();
    return { ok: true };
  }

  // ── Brands ────────────────────────────────────────────────────────────────
  listBrands(actor: AdminActor): AdminBrand[] {
    requireAny(actor, 'catalog.view');
    return this.liveBrands()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        logoUrl: b.logoUrl,
        sortOrder: b.sortOrder,
        isVisible: b.isVisible,
        isFeatured: b.isFeatured,
        showOnApple: b.showOnApple,
        seoTitle: b.seoTitle,
        seoDescription: b.seoDescription,
        isDemo: true,
        updatedAt: b.updatedAt ?? SEED_UPDATED_AT,
        categoryIds: b.categorySlugs.flatMap((s) => this.categoryBySlug(s)?.id ?? []),
        productCount: this.liveProducts().filter((p) => p.brandSlug === b.slug).length,
      }));
  }

  saveBrand(actor: AdminActor, input: BrandInput): SaveResult {
    requireAny(actor, 'catalog.manage');
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(slug) || !SLUG_PATTERN.test(slug))
      return { ok: false, code: 'invalid_slug', field: 'slug' };
    if (!validLt(input.name)) return { ok: false, code: 'name_required', field: 'name' };
    if (input.logoUrl && !/^(\/|https:\/\/|data:image\/)/.test(input.logoUrl))
      return { ok: false, code: 'invalid_image', field: 'logoUrl' };
    if (this.raw.brands.some((b) => b.slug === slug && b.id !== input.id))
      return { ok: false, code: 'slug_taken', field: 'slug' };
    const existing = input.id ? this.liveBrands().find((b) => b.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    if (existing && (existing.updatedAt ?? SEED_UPDATED_AT) !== input.expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    const now = this.ctx.stamp();
    const fields = {
      slug,
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl || null,
      isVisible: input.isVisible,
      isFeatured: input.isFeatured,
      showOnApple: input.showOnApple,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      categorySlugs: input.categoryIds.flatMap((id) => this.categoryById(id)?.slug ?? []),
      updatedAt: now,
    };
    let id: string;
    if (existing) {
      const before = { ...existing };
      if (existing.slug !== slug)
        for (const p of this.raw.products) if (p.brandSlug === existing.slug) p.brandSlug = slug;
      Object.assign(existing, fields, { sortOrder: input.sortOrder ?? existing.sortOrder });
      id = existing.id;
      this.ctx.audit(actor, 'update', 'public.brands', id, before, { ...existing });
    } else {
      id = this.ctx.uuid();
      this.raw.brands.push({
        id,
        ...fields,
        sortOrder: input.sortOrder || Math.max(0, ...this.raw.brands.map((b) => b.sortOrder)) + 1,
        deletedAt: null,
      });
      this.ctx.audit(actor, 'insert', 'public.brands', id, null, fields);
    }
    this.ctx.catalogChanged();
    return { ok: true, id, updatedAt: now };
  }

  deleteBrand(actor: AdminActor, id: string): AdminResult {
    requireAny(actor, 'catalog.manage');
    const b = this.liveBrands().find((x) => x.id === id);
    if (!b) return { ok: false, code: 'not_found' };
    if (this.liveProducts().some((p) => p.brandSlug === b.slug))
      return { ok: false, code: 'in_use' };
    b.deletedAt = this.ctx.stamp();
    b.isVisible = false;
    this.ctx.audit(actor, 'catalog.brand_deleted', 'public.brands', id, null, null, {
      slug: b.slug,
    });
    this.ctx.catalogChanged();
    return { ok: true };
  }
}
