import pageSectionsJson from '@seed/base/page-sections.json';
import type { PageSection } from '@/domain/content/types';
import type { DemoCommerceStore } from './demoCommerce';
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

/** Demo catalog reads come from the commerce store's engine, so reservations/sales change stock states. */
export class DemoCatalogRepository implements CatalogRepository {
  private readonly store: DemoCommerceStore;

  constructor(store: DemoCommerceStore) {
    this.store = store;
  }

  async listBrands() {
    await delay();
    return this.store.engine().brands();
  }

  async listCategories() {
    await delay();
    return this.store.engine().categories();
  }

  async search(query: Parameters<CatalogRepository['search']>[0]) {
    await delay();
    return this.store.engine().search(query);
  }

  async getProduct(slug: string) {
    await delay();
    return this.store.engine().product(slug);
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
  private readonly store: DemoCommerceStore;

  constructor(store: DemoCommerceStore) {
    this.store = store;
  }

  async listPageSections(pageKey: string) {
    await delay(60);
    return pageSections.filter((s) => s.pageKey === pageKey);
  }

  async listOffers() {
    await delay();
    return this.store.engine().offers();
  }

  async getOffer(slug: string) {
    await delay();
    return this.store.engine().offer(slug);
  }

  async listEntries(filter?: Parameters<ContentRepository['listEntries']>[0]) {
    await delay();
    return this.store.engine().entries(filter);
  }

  async getEntry(slug: string) {
    await delay();
    return this.store.engine().entry(slug);
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
