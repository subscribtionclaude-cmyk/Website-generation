import demoCatalogJson from '@seed/demo/catalog.json';
import pageSectionsJson from '@seed/base/page-sections.json';
import { createCatalogEngine, type CatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import type { PageSection } from '@/domain/content/types';
import { readStored, writeStored } from '@/lib/storage/localStore';
import { z } from 'zod';
import type {
  CatalogRepository,
  ContentRepository,
  CustomerRequestsRepository,
  RequestResult,
} from '../types';

/** Simulated latency keeps loading states honest during demo previews. */
const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));

let engine: { instance: CatalogEngine; builtAt: number } | null = null;

/** The demo catalog is validated once and re-anchored to "now" every 10 minutes (relative dates). */
function getEngine(): CatalogEngine {
  const nowMs = Date.now();
  if (!engine || nowMs - engine.builtAt > 10 * 60_000) {
    const raw = rawCatalogSchema.parse(demoCatalogJson);
    engine = { instance: createCatalogEngine(raw, new Date(nowMs)), builtAt: nowMs };
  }
  return engine.instance;
}

export class DemoCatalogRepository implements CatalogRepository {
  async listBrands() {
    await delay();
    return getEngine().brands();
  }

  async listCategories() {
    await delay();
    return getEngine().categories();
  }

  async search(query: Parameters<CatalogRepository['search']>[0]) {
    await delay();
    return getEngine().search(query);
  }

  async getProduct(slug: string) {
    await delay();
    return getEngine().product(slug);
  }
}

const pageSections: PageSection[] = pageSectionsJson.sections.map((s) => ({
  id: s.key,
  pageKey: s.pageKey,
  type: s.type,
  sortOrder: s.sortOrder,
  isVisible: s.isVisible,
  props: s.props,
}));

export class DemoContentRepository implements ContentRepository {
  async listPageSections(pageKey: string) {
    await delay(60);
    return pageSections.filter((s) => s.pageKey === pageKey);
  }

  async listOffers() {
    await delay();
    return getEngine().offers();
  }

  async getOffer(slug: string) {
    await delay();
    return getEngine().offer(slug);
  }

  async listEntries(filter?: Parameters<ContentRepository['listEntries']>[0]) {
    await delay();
    return getEngine().entries(filter);
  }

  async getEntry(slug: string) {
    await delay();
    return getEngine().entry(slug);
  }
}

const storedRequestsSchema = z.array(z.string());

/** DEMO: requests are kept in this browser tab only (nothing is sent anywhere). */
export class DemoCustomerRequestsRepository implements CustomerRequestsRepository {
  private record(kind: string, key: string): RequestResult {
    const storageKey = `demo-requests:${kind}`;
    const existing = readStored(storageKey, storedRequestsSchema, 'session') ?? [];
    if (existing.includes(key)) return { status: 'duplicate' };
    writeStored(storageKey, [...existing, key], 'session');
    return { status: 'created' };
  }

  async requestStockAlert(request: Parameters<CustomerRequestsRepository['requestStockAlert']>[0]) {
    await delay(300);
    return this.record(
      'stock',
      `${request.productSlug}:${request.variantSku ?? '*'}:${request.phone}`,
    );
  }

  async joinWaitlist(request: Parameters<CustomerRequestsRepository['joinWaitlist']>[0]) {
    await delay(300);
    return this.record('waitlist', `${request.productSlug}:${request.phone}`);
  }
}
