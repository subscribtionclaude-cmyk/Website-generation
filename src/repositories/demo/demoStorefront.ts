import pageSectionsJson from '@seed/base/page-sections.json';
import type { PageSection } from '@/domain/content/types';
import type { DemoCommerceStore } from './demoCommerce';
import type { CatalogRepository, ContentRepository } from '../types';

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

  async getProductsByIds(ids: string[]) {
    await delay(80);
    return this.store.customer.summariesByIds(ids);
  }

  async getRecommendations(slug: string) {
    await delay();
    return this.store.customer.recommendations(slug);
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
