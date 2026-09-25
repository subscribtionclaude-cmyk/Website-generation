import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  brandSchema,
  catalogPageSchema,
  categorySchema,
  productDetailSchema,
  productSummarySchema,
} from '@/domain/catalog/schemas';
import {
  actionResultSchema,
  myRequestsSchema,
  recommendationsSchema,
  requestResultSchema,
} from '@/domain/customer/schemas';
import type { RequestClaim } from '@/domain/customer/types';
import type { CatalogQuery } from '@/domain/catalog/types';
import { contentEntrySchema, offerSchema, pageSectionSchema } from '@/domain/content/schemas';
import type {
  CatalogRepository,
  ContentRepository,
  CustomerRequestsRepository,
  EntryFilter,
  RequestResult,
  StockAlertRequest,
  WaitlistRequest,
} from '../types';
import { rpc } from './rpc';

/**
 * Storefront reads go through SECURITY DEFINER RPCs (supabase/migrations/*_storefront_rpcs.sql):
 * they return only published, in-window rows, compute stock STATES (never quantities) and exclude
 * demo rows unless the staging flag features.showDemoCatalog is on.
 */
function toRpcQuery(query: CatalogQuery) {
  return {
    q: query.q ?? null,
    brands: query.brands ?? [],
    categories: query.categories ?? [],
    minPrice: query.minPrice ?? null,
    maxPrice: query.maxPrice ?? null,
    storage: query.storage ?? [],
    colors: query.colors ?? [],
    inStockOnly: query.inStockOnly ?? false,
    onOffer: query.onOffer ?? false,
    newOnly: query.newOnly ?? false,
    featuredOnly: query.featuredOnly ?? false,
    availability: query.availability ?? [],
    sort: query.sort ?? 'featured',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 12,
  };
}

export class SupabaseCatalogRepository implements CatalogRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  listBrands() {
    return rpc(this.client, 'catalog_brands', {}, z.array(brandSchema));
  }

  listCategories() {
    return rpc(this.client, 'catalog_categories', {}, z.array(categorySchema));
  }

  search(query: CatalogQuery) {
    return rpc(this.client, 'catalog_search', { p_query: toRpcQuery(query) }, catalogPageSchema);
  }

  getProduct(slug: string) {
    return rpc(this.client, 'catalog_product', { p_slug: slug }, productDetailSchema.nullable());
  }

  getProductsByIds(ids: string[]) {
    const uuids = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
    if (uuids.length === 0) return Promise.resolve([]);
    return rpc(this.client, 'catalog_products', { p_ids: uuids }, z.array(productSummarySchema));
  }

  getRecommendations(slug: string) {
    return rpc(
      this.client,
      'product_recommendations',
      { p_product_slug: slug },
      recommendationsSchema.nullable(),
    );
  }
}

export class SupabaseContentRepository implements ContentRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  listPageSections(pageKey: string) {
    return rpc(
      this.client,
      'storefront_page_sections',
      { p_page_key: pageKey },
      z.array(pageSectionSchema),
    );
  }

  listOffers() {
    return rpc(this.client, 'storefront_offers', {}, z.array(offerSchema));
  }

  getOffer(slug: string) {
    return rpc(this.client, 'storefront_offer', { p_slug: slug }, offerSchema.nullable());
  }

  listEntries(filter: EntryFilter = {}) {
    return rpc(
      this.client,
      'storefront_entries',
      {
        p_types: filter.types ?? [],
        p_featured_only: filter.featuredOnly ?? false,
        p_limit: filter.limit ?? 24,
      },
      z.array(contentEntrySchema),
    );
  }

  getEntry(slug: string) {
    return rpc(this.client, 'storefront_entry', { p_slug: slug }, contentEntrySchema.nullable());
  }
}

export class SupabaseCustomerRequestsRepository implements CustomerRequestsRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  requestStockAlert(request: StockAlertRequest): Promise<RequestResult> {
    return rpc(
      this.client,
      'request_stock_alert',
      {
        p_product_slug: request.productSlug,
        p_variant_sku: request.variantSku,
        p_name: request.name,
        p_phone: request.phone,
        p_email: request.email,
        p_locale: request.locale,
      },
      requestResultSchema,
    );
  }

  joinWaitlist(request: WaitlistRequest): Promise<RequestResult> {
    return rpc(
      this.client,
      'join_waitlist',
      {
        p_product_slug: request.productSlug,
        p_name: request.name,
        p_phone: request.phone,
        p_email: request.email,
        p_desired_storage: request.desiredStorage,
        p_desired_color: request.desiredColor,
        p_locale: request.locale,
      },
      requestResultSchema,
    );
  }

  listMine() {
    return rpc(this.client, 'list_my_requests', {}, myRequestsSchema);
  }

  cancel(kind: 'notify' | 'waitlist', id: string) {
    return rpc(this.client, 'cancel_my_request', { p_kind: kind, p_id: id }, actionResultSchema);
  }

  claim(claims: RequestClaim[]) {
    return rpc(
      this.client,
      'claim_my_requests',
      { p_claims: claims },
      z.object({ linked: z.number().int().min(0) }),
    );
  }
}
