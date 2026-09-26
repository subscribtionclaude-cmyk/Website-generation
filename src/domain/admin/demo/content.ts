import { resolveTime, type RawCatalog } from '@/domain/catalog/raw';
import type { PageSection } from '@/domain/content/types';
import type {
  AdminEntry,
  AdminOffer,
  AdminResult,
  AdminSection,
  CountResult,
  EntryFilter,
  EntryInput,
  EntryListItem,
  OfferFilter,
  OfferInput,
  OfferListItem,
  ProductStatus,
  SaveResult,
} from '../schemas';
import { OFFER_KINDS, ENTRY_TYPES, PRODUCT_STATUSES } from '../schemas';
import { validateEntryInput, validateOfferInput } from '../validation';
import { SEED_UPDATED_AT } from './catalog';
import {
  type AdminActor,
  type DemoAdminContext,
  ltText,
  matchesText,
  type Page,
  paginate,
  requireAny,
} from './context';

type RawOffer = RawCatalog['offers'][number];
type RawEntry = RawCatalog['entries'][number];

/** DEMO MODE ONLY — offers, content entries and structured page-section edits (see context.ts). */
export class DemoAdminContent {
  private readonly ctx: DemoAdminContext;
  private readonly baseSections: PageSection[];

  constructor(ctx: DemoAdminContext, baseSections: PageSection[]) {
    this.ctx = ctx;
    this.baseSections = baseSections;
  }

  private time(value: string | null) {
    return resolveTime(value, this.ctx.now());
  }

  // ── Offers ────────────────────────────────────────────────────────────────
  private offerState(o: RawOffer): OfferListItem['state'] {
    if (o.status !== 'published') return o.status;
    const now = this.ctx.now().toISOString();
    const s = this.time(o.startsAt);
    const e = this.time(o.endsAt);
    if (s && s > now) return 'scheduled';
    if (e && e <= now) return 'expired';
    return 'active';
  }

  private redemptions(offerId: string) {
    return this.ctx.commerce
      .orderRecords()
      .filter((o) => o.status !== 'cancelled' && o.promoCode)
      .filter((o) => this.ctx.raw.offers.find((x) => x.id === offerId)?.promoCode === o.promoCode)
      .length;
  }

  private productBySlug(slug: string) {
    return this.ctx.raw.products.find((p) => p.slug === slug && !p.deletedAt);
  }

  listOffers(actor: AdminActor, filter: OfferFilter): Page<OfferListItem> {
    requireAny(actor, 'marketing.manage', 'content.view');
    const rows = this.ctx.raw.offers
      .map((o): OfferListItem => ({
        id: o.id,
        slug: o.slug,
        kind: (OFFER_KINDS as readonly string[]).includes(o.kind)
          ? (o.kind as OfferListItem['kind'])
          : 'price_drop',
        title: o.title,
        promoCode: o.promoCode,
        status: o.status,
        state: this.offerState(o),
        startsAt: this.time(o.startsAt),
        endsAt: this.time(o.endsAt),
        featuredOnHome: o.featuredOnHome,
        discountPercent: o.discountPercent,
        discountAmount: o.discountAmount,
        sortOrder: o.sortOrder,
        isDemo: true,
        updatedAt: o.updatedAt ?? SEED_UPDATED_AT,
        productCount: o.products.length,
        redemptions: this.redemptions(o.id),
      }))
      .filter(
        (o) =>
          (!filter.kind || o.kind === filter.kind) &&
          (!filter.state || o.state === filter.state || o.status === filter.state) &&
          (!filter.promoOnly || o.promoCode !== null) &&
          matchesText(filter.q, o.slug, o.promoCode, ltText(o.title)),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt));
    return paginate(rows, filter);
  }

  private offerJson(o: RawOffer): AdminOffer {
    return {
      id: o.id,
      slug: o.slug,
      kind: o.kind as AdminOffer['kind'],
      title: o.title,
      subtitle: o.subtitle,
      description: o.description,
      badge: o.badge,
      mediaKind: o.media?.kind ?? null,
      mediaUrl: o.media?.url ?? null,
      mediaAlt: o.media?.alt ?? null,
      ctaLabel: o.cta?.label ?? null,
      ctaHref: o.cta?.href ?? null,
      discountPercent: o.discountPercent,
      discountAmount: o.discountAmount,
      bundlePrice: o.bundlePrice,
      promoCode: o.promoCode,
      minSubtotal: o.minSubtotal,
      maxRedemptions: o.maxRedemptions,
      maxRedemptionsPerCustomer: o.maxRedemptionsPerCustomer,
      buyQuantity: o.buyQuantity,
      getQuantity: o.getQuantity,
      startsAt: this.time(o.startsAt),
      endsAt: this.time(o.endsAt),
      showCountdown: o.showCountdown,
      featuredOnHome: o.featuredOnHome,
      status: o.status,
      state: this.offerState(o),
      sortOrder: o.sortOrder,
      seoTitle: o.seoTitle,
      seoDescription: o.seoDescription,
      isDemo: true,
      updatedAt: o.updatedAt ?? SEED_UPDATED_AT,
      redemptions: this.redemptions(o.id),
      products: o.products.flatMap((p) => {
        const product = this.productBySlug(p.slug);
        if (!product) return [];
        const variant = p.variantSku
          ? product.variants.find((v) => v.sku === p.variantSku)
          : undefined;
        return [
          {
            productId: product.id,
            variantId: variant?.id ?? null,
            role: p.role,
            quantity: p.quantity,
            name: product.name,
            slug: product.slug,
          },
        ];
      }),
      categoryIds: o.categorySlugs.flatMap(
        (s) => this.ctx.raw.categories.find((c) => c.slug === s)?.id ?? [],
      ),
    };
  }

  getOffer(actor: AdminActor, id: string): AdminOffer | null {
    requireAny(actor, 'marketing.manage', 'content.view');
    const o = this.ctx.raw.offers.find((x) => x.id === id);
    return o ? this.offerJson(o) : null;
  }

  saveOffer(actor: AdminActor, input: OfferInput): SaveResult {
    requireAny(actor, 'marketing.manage');
    if (!OFFER_KINDS.includes(input.kind))
      return { ok: false, code: 'invalid_kind', field: 'kind' };
    if (!PRODUCT_STATUSES.includes(input.status)) return { ok: false, code: 'invalid_status' };
    const problem = validateOfferInput(input);
    if (problem) return { ok: false, ...problem };
    const slug = input.slug.trim().toLowerCase();
    const code = input.promoCode?.trim().toUpperCase() || null;
    if (
      code &&
      this.ctx.raw.offers.some((o) => o.promoCode?.toUpperCase() === code && o.id !== input.id)
    )
      return { ok: false, code: 'code_taken', field: 'promoCode' };
    const resolved = input.products.map((p) => {
      const product = this.ctx.raw.products.find((x) => x.id === p.productId && !x.deletedAt);
      const variant = p.variantId
        ? product?.variants.find((v) => v.id === p.variantId && !v.retiredAt)
        : undefined;
      return { product, variant, p };
    });
    if (resolved.some((x) => !x.product || (x.p.variantId && !x.variant)))
      return { ok: false, code: 'invalid_product', field: 'products' };
    const products = resolved.flatMap((x) => (x.product ? [{ ...x, product: x.product }] : []));
    if (this.ctx.raw.offers.some((o) => o.slug === slug && o.id !== input.id))
      return { ok: false, code: 'slug_taken', field: 'slug' };
    const existing = input.id ? this.ctx.raw.offers.find((o) => o.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    if (existing && (existing.updatedAt ?? SEED_UPDATED_AT) !== input.expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    const now = this.ctx.stamp();
    const fields: Omit<RawOffer, 'id'> = {
      slug,
      kind: input.kind,
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      badge: input.badge,
      media: input.mediaUrl
        ? {
            kind: input.mediaKind ?? 'image',
            url: input.mediaUrl,
            posterUrl: null,
            captionsUrl: null,
            alt: input.mediaAlt ?? input.title,
          }
        : null,
      cta: input.ctaHref && input.ctaLabel ? { label: input.ctaLabel, href: input.ctaHref } : null,
      discountPercent: input.discountPercent,
      discountAmount: input.discountAmount,
      bundlePrice: input.bundlePrice,
      promoCode: code,
      maxRedemptions: input.maxRedemptions,
      maxRedemptionsPerCustomer: input.maxRedemptionsPerCustomer,
      minSubtotal: input.minSubtotal,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      showCountdown: input.showCountdown,
      featuredOnHome: input.featuredOnHome,
      sortOrder: input.sortOrder,
      products: products.map((x) => ({
        slug: x.product.slug,
        role: x.p.role,
        variantSku: x.variant?.sku ?? null,
        quantity: Math.max(1, x.p.quantity),
      })),
      status: input.status,
      buyQuantity: input.kind === 'buy_x_get_y' ? input.buyQuantity : null,
      getQuantity: input.kind === 'buy_x_get_y' ? input.getQuantity : null,
      categorySlugs: input.categoryIds.flatMap(
        (id) => this.ctx.raw.categories.find((c) => c.id === id)?.slug ?? [],
      ),
      updatedAt: now,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
    };
    let id: string;
    if (existing) {
      const before = structuredClone(existing);
      Object.assign(existing, fields);
      id = existing.id;
      this.ctx.audit(actor, 'update', 'public.offers', id, before, fields);
    } else {
      id = this.ctx.uuid();
      this.ctx.raw.offers.push({ id, ...fields });
      this.ctx.audit(actor, 'insert', 'public.offers', id, null, fields);
    }
    this.ctx.catalogChanged();
    return { ok: true, id, updatedAt: now };
  }

  setOffersStatus(actor: AdminActor, ids: string[], status: ProductStatus): CountResult {
    requireAny(actor, 'marketing.manage');
    if (!PRODUCT_STATUSES.includes(status)) return { ok: false, code: 'invalid_status' };
    if (ids.length === 0 || ids.length > 200) return { ok: false, code: 'invalid_selection' };
    const now = this.ctx.stamp();
    let count = 0;
    for (const o of this.ctx.raw.offers) {
      if (!ids.includes(o.id)) continue;
      o.status = status;
      o.updatedAt = now;
      count += 1;
    }
    this.ctx.audit(
      actor,
      'marketing.offers_status',
      'public.offers',
      null,
      null,
      { status },
      { ids, count },
    );
    this.ctx.catalogChanged();
    return { ok: true, updated: count };
  }

  deleteOffer(actor: AdminActor, id: string): AdminResult<{ archived: boolean }> {
    requireAny(actor, 'marketing.manage');
    const o = this.ctx.raw.offers.find((x) => x.id === id);
    if (!o) return { ok: false, code: 'not_found' };
    if (this.redemptions(id) > 0) {
      o.status = 'archived';
      o.updatedAt = this.ctx.stamp();
      this.ctx.audit(actor, 'marketing.offer_archived', 'public.offers', id, null, null, {
        slug: o.slug,
      });
      this.ctx.catalogChanged();
      return { ok: true, archived: true };
    }
    this.ctx.raw.offers = this.ctx.raw.offers.filter((x) => x.id !== id);
    this.ctx.audit(actor, 'delete', 'public.offers', id, { slug: o.slug }, null);
    this.ctx.catalogChanged();
    return { ok: true, archived: false };
  }

  // ── Content entries ───────────────────────────────────────────────────────
  private entryLive(e: RawEntry) {
    const now = this.ctx.now().toISOString();
    const pub = this.time(e.publishAt) ?? now;
    const exp = this.time(e.expiresAt);
    return e.status === 'published' && pub <= now && (!exp || exp > now);
  }

  listEntries(actor: AdminActor, filter: EntryFilter): Page<EntryListItem> {
    requireAny(actor, 'content.view');
    const rows = this.ctx.raw.entries
      .map((e): EntryListItem => ({
        id: e.id,
        slug: e.slug,
        type: e.type,
        title: e.title,
        status: e.status,
        publishAt: this.time(e.publishAt) ?? this.ctx.now().toISOString(),
        expiresAt: this.time(e.expiresAt),
        isFeatured: e.isFeatured,
        mediaUrl: e.media?.url ?? null,
        isDemo: true,
        updatedAt: e.updatedAt ?? SEED_UPDATED_AT,
        live: this.entryLive(e),
      }))
      .filter(
        (e) =>
          (!filter.type || e.type === filter.type) &&
          (!filter.status || e.status === filter.status) &&
          matchesText(filter.q, e.slug, ltText(e.title)),
      )
      .sort((a, b) => b.publishAt.localeCompare(a.publishAt));
    return paginate(rows, filter);
  }

  private entryJson(e: RawEntry): AdminEntry {
    return {
      id: e.id,
      slug: e.slug,
      type: e.type,
      eyebrow: e.eyebrow,
      title: e.title,
      subtitle: e.subtitle,
      excerpt: e.excerpt,
      body: e.body,
      mediaKind: e.media?.kind ?? null,
      mediaUrl: e.media?.url ?? null,
      mediaPosterUrl: e.media?.posterUrl ?? null,
      mediaAlt: e.media?.alt ?? null,
      ctaLabel: e.cta?.label ?? null,
      ctaHref: e.cta?.href ?? null,
      secondaryCtaLabel: e.secondaryCta?.label ?? null,
      secondaryCtaHref: e.secondaryCta?.href ?? null,
      state: e.state,
      releaseDate: e.releaseDate ? (this.time(e.releaseDate)?.slice(0, 10) ?? null) : null,
      publishAt: this.time(e.publishAt) ?? this.ctx.now().toISOString(),
      expiresAt: this.time(e.expiresAt),
      isFeatured: e.isFeatured,
      status: e.status,
      seoTitle: e.seoTitle,
      seoDescription: e.seoDescription,
      isDemo: true,
      updatedAt: e.updatedAt ?? SEED_UPDATED_AT,
      products: e.products.flatMap((slug) => {
        const p = this.productBySlug(slug);
        return p ? [{ productId: p.id, name: p.name, slug: p.slug }] : [];
      }),
    };
  }

  getEntry(actor: AdminActor, id: string): AdminEntry | null {
    requireAny(actor, 'content.view');
    const e = this.ctx.raw.entries.find((x) => x.id === id);
    return e ? this.entryJson(e) : null;
  }

  saveEntry(actor: AdminActor, input: EntryInput): SaveResult {
    requireAny(actor, 'content.manage');
    if (!ENTRY_TYPES.includes(input.type))
      return { ok: false, code: 'invalid_type', field: 'type' };
    if (!PRODUCT_STATUSES.includes(input.status)) return { ok: false, code: 'invalid_status' };
    if (input.status === 'published' && !actor.can('content.publish'))
      return { ok: false, code: 'publish_forbidden', field: 'status' };
    const problem = validateEntryInput(input);
    if (problem) return { ok: false, ...problem };
    const slug = input.slug.trim().toLowerCase();
    if (this.ctx.raw.entries.some((e) => e.slug === slug && e.id !== input.id))
      return { ok: false, code: 'slug_taken', field: 'slug' };
    const existing = input.id ? this.ctx.raw.entries.find((e) => e.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    if (existing && (existing.updatedAt ?? SEED_UPDATED_AT) !== input.expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    const now = this.ctx.stamp();
    const fields: Omit<RawEntry, 'id'> = {
      slug,
      type: input.type,
      eyebrow: input.eyebrow,
      title: input.title,
      subtitle: input.subtitle,
      excerpt: input.excerpt,
      body: input.body,
      media: input.mediaUrl
        ? {
            kind: input.mediaKind ?? 'image',
            url: input.mediaUrl,
            posterUrl: input.mediaPosterUrl,
            captionsUrl: null,
            alt: input.mediaAlt ?? input.title,
          }
        : null,
      cta: input.ctaHref && input.ctaLabel ? { label: input.ctaLabel, href: input.ctaHref } : null,
      secondaryCta:
        input.secondaryCtaHref && input.secondaryCtaLabel
          ? { label: input.secondaryCtaLabel, href: input.secondaryCtaHref }
          : null,
      state: input.state,
      releaseDate: input.releaseDate,
      publishAt: input.publishAt,
      expiresAt: input.expiresAt,
      isFeatured: input.isFeatured,
      products: input.productIds.flatMap(
        (id) => this.ctx.raw.products.find((p) => p.id === id && !p.deletedAt)?.slug ?? [],
      ),
      status: input.status,
      updatedAt: now,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
    };
    let id: string;
    if (existing) {
      const before = structuredClone(existing);
      Object.assign(existing, fields);
      id = existing.id;
      this.ctx.audit(actor, 'update', 'public.content_entries', id, before, fields);
    } else {
      id = this.ctx.uuid();
      this.ctx.raw.entries.push({ id, ...fields });
      this.ctx.audit(actor, 'insert', 'public.content_entries', id, null, fields);
    }
    this.ctx.catalogChanged();
    return { ok: true, id, updatedAt: now };
  }

  setEntriesStatus(actor: AdminActor, ids: string[], status: ProductStatus): CountResult {
    requireAny(actor, 'content.publish');
    if (!PRODUCT_STATUSES.includes(status)) return { ok: false, code: 'invalid_status' };
    if (ids.length === 0 || ids.length > 200) return { ok: false, code: 'invalid_selection' };
    const now = this.ctx.stamp();
    let count = 0;
    for (const e of this.ctx.raw.entries) {
      if (!ids.includes(e.id)) continue;
      e.status = status;
      e.updatedAt = now;
      count += 1;
    }
    this.ctx.audit(
      actor,
      'content.entries_status',
      'public.content_entries',
      null,
      null,
      { status },
      { ids, count },
    );
    this.ctx.catalogChanged();
    return { ok: true, updated: count };
  }

  deleteEntry(actor: AdminActor, id: string): AdminResult {
    requireAny(actor, 'content.publish');
    const e = this.ctx.raw.entries.find((x) => x.id === id);
    if (!e) return { ok: false, code: 'not_found' };
    this.ctx.raw.entries = this.ctx.raw.entries.filter((x) => x.id !== id);
    this.ctx.audit(actor, 'delete', 'public.content_entries', id, { slug: e.slug }, null);
    this.ctx.catalogChanged();
    return { ok: true };
  }

  // ── Page sections (structured edits only — layout editing is Phase 07) ────
  sections(pageKey: string): PageSection[] {
    return this.baseSections
      .filter((s) => s.pageKey === pageKey)
      .map((s) => {
        const o = this.ctx.state.sections[s.id];
        return o ? { ...s, isVisible: o.isVisible, props: o.props } : s;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  listPageSections(actor: AdminActor, pageKey: string): AdminSection[] {
    requireAny(actor, 'content.view');
    return this.sections(pageKey).map((s) => {
      const o = this.ctx.state.sections[s.id];
      return {
        id: s.id,
        pageKey: s.pageKey,
        key: s.id,
        type: s.type,
        sortOrder: s.sortOrder,
        isVisible: s.isVisible,
        props: s.props as Record<string, unknown>,
        updatedAt: o?.updatedAt ?? SEED_UPDATED_AT,
        updatedBy: o?.updatedBy ?? null,
      };
    });
  }

  savePageSection(
    actor: AdminActor,
    id: string,
    isVisible: boolean,
    props: Record<string, unknown>,
    expectedUpdatedAt: string | null,
  ): AdminResult<{ updatedAt: string }> {
    requireAny(actor, 'content.manage');
    if (!actor.can('content.publish')) return { ok: false, code: 'publish_forbidden' };
    if (
      typeof props !== 'object' ||
      props === null ||
      Array.isArray(props) ||
      JSON.stringify(props).length > 65536
    )
      return { ok: false, code: 'invalid_props' };
    const base = this.baseSections.find((s) => s.id === id);
    if (!base) return { ok: false, code: 'not_found' };
    const current = this.ctx.state.sections[id];
    if ((current?.updatedAt ?? SEED_UPDATED_AT) !== expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    const updatedAt = this.ctx.stamp();
    this.ctx.state.sections[id] = { isVisible, props, updatedAt, updatedBy: actor.name };
    this.ctx.audit(
      actor,
      'update',
      'public.page_sections',
      id,
      { isVisible: current?.isVisible ?? base.isVisible, props: current?.props ?? base.props },
      { isVisible, props },
    );
    this.ctx.persist();
    return { ok: true, updatedAt };
  }
}
