import { SearchX, SlidersHorizontal, X } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import {
  activeFilterCount,
  parseCatalogQuery,
  serializeCatalogQuery,
} from '@/domain/catalog/queryParams';
import type { CatalogFacets, CatalogQuery, CatalogSort } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs';
import { BudgetSearch } from '../components/BudgetSearch';
import { FeaturedProductGrid, ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import { FilterPanel } from '../catalog/FilterPanel';
import { useBrands, useCatalogPages, useCatalogSearch, useCategories } from '../data/hooks';
import { NotFoundPage } from './NotFoundPage';
import styles from '../catalog/store.module.css';

const SORTS: { value: CatalogSort; key: CoreMessageKey }[] = [
  { value: 'featured', key: 'catalog.sortFeatured' },
  { value: 'newest', key: 'catalog.sortNewest' },
  { value: 'price_asc', key: 'catalog.sortPriceAsc' },
  { value: 'price_desc', key: 'catalog.sortPriceDesc' },
  { value: 'best_selling', key: 'catalog.sortBestSelling' },
];

type Locked = Pick<CatalogQuery, 'brands' | 'categories'>;

interface ListingProps {
  title: string;
  subtitle?: string | null;
  crumbs: Crumb[];
  locked?: Locked;
  /** Show the search box (store + search pages). */
  withSearch?: boolean;
  /** Content above the results (budget form …). */
  intro?: ReactNode;
  /** Results need a precondition (e.g. a budget) before listing. */
  requires?: (query: CatalogQuery) => boolean;
  emptyIntro?: ReactNode;
  noIndex?: boolean;
  showFeatured?: boolean;
}

/**
 * Shared listing page for /store, /category/:slug, /brand/:slug, /search and /budget.
 * All filter state lives in the URL (shareable, back-button safe); filtered URLs are noindex and
 * canonicalise to the unfiltered path.
 */
function CatalogListing({
  title,
  subtitle,
  crumbs,
  locked = {},
  withSearch = false,
  intro,
  requires,
  emptyIntro,
  noIndex = false,
  showFeatured = false,
}: ListingProps) {
  const { t, format } = useI18n();
  const { catalog } = useSettings();
  const [params, setParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerTitleId = useId();
  const resultsId = useId();

  const urlQuery = parseCatalogQuery(params);
  const { page: _page, ...rest } = urlQuery;
  const query: CatalogQuery = { ...rest, ...stripEmpty(locked) };
  const filters = activeFilterCount(urlQuery);
  const ready = requires ? requires(query) : true;

  const pages = useCatalogPages(query, catalog.pageSize);
  const firstPage = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const total = firstPage?.total ?? 0;
  const isUnfiltered = filters === 0 && !query.q && !urlQuery.sort;
  const featured = useCatalogSearch(
    { ...stripEmpty(locked), featuredOnly: true, pageSize: 4 },
    showFeatured && isUnfiltered,
  );

  usePageMeta({
    title,
    description: subtitle ?? undefined,
    noIndex: noIndex || filters > 0 || Boolean(query.q),
  });

  const update = (patch: Partial<CatalogQuery>) => {
    const next: CatalogQuery = { ...urlQuery, ...patch, page: undefined };
    // Route-locked dimensions (/brand/:slug, /category/:slug) never leak into the query string.
    if (locked.brands?.length) next.brands = undefined;
    if (locked.categories?.length) next.categories = undefined;
    setParams(serializeCatalogQuery(next), { preventScrollReset: true });
  };

  const clearAll = () => {
    const next: CatalogQuery = { q: urlQuery.q, sort: urlQuery.sort };
    setParams(serializeCatalogQuery(next), { preventScrollReset: true });
  };

  const panel = (
    <FilterPanel
      query={query}
      facets={firstPage?.facets}
      locked={{
        brands: Boolean(locked.brands?.length),
        categories: Boolean(locked.categories?.length),
      }}
      onChange={update}
    />
  );

  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs items={crumbs} />
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>
      {withSearch && <SearchForm initial={query.q ?? ''} />}
      {intro}
      {!ready ? (
        emptyIntro
      ) : (
        <>
          {showFeatured && isUnfiltered && featured.data && featured.data.items.length > 0 && (
            <section className={styles.featuredStrip} aria-labelledby={`${resultsId}-featured`}>
              <SectionHeading id={`${resultsId}-featured`} title={t('catalog.featuredTitle')} />
              <FeaturedProductGrid products={featured.data.items} />
            </section>
          )}
          <div className={styles.layout}>
            <aside className={styles.sidebar} aria-label={t('catalog.filters')}>
              {panel}
            </aside>
            <section aria-labelledby={resultsId}>
              <h2 id={resultsId} className="visually-hidden">
                {showFeatured && isUnfiltered ? t('catalog.allProducts') : title}
              </h2>
              <div className={styles.toolbar}>
                <p className={styles.count} role="status" aria-live="polite">
                  {pages.isPending
                    ? t('common.loading')
                    : t('catalog.results', { count: format.number(total) })}
                </p>
                <div className={styles.toolbarEnd}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={styles.filterButton}
                    icon={<SlidersHorizontal aria-hidden="true" />}
                    onClick={() => setDrawerOpen(true)}
                    aria-haspopup="dialog"
                  >
                    {filters
                      ? t('catalog.filtersCount', { count: format.number(filters) })
                      : t('catalog.filters')}
                  </Button>
                  <SortSelect
                    value={query.sort ?? 'featured'}
                    onChange={(sort) => update({ sort })}
                  />
                </div>
              </div>
              <ActiveFilters
                query={urlQuery}
                facets={firstPage?.facets}
                locked={locked}
                onChange={update}
                onClear={clearAll}
              />
              {pages.isPending ? (
                <ProductGridSkeleton count={8} columns={3} />
              ) : pages.isError ? (
                <StateMessage icon={<SearchX />} title={t('catalog.loadError')} role="alert" />
              ) : items.length === 0 ? (
                <StateMessage
                  icon={<SearchX />}
                  title={t('catalog.noResultsTitle')}
                  body={t('catalog.noResultsBody')}
                  actions={
                    <>
                      {filters > 0 && (
                        <Button variant="primary" onClick={clearAll}>
                          {t('catalog.clearAll')}
                        </Button>
                      )}
                      <ButtonLink to="/contact" variant="secondary">
                        {t('common.contactUs')}
                      </ButtonLink>
                    </>
                  }
                />
              ) : (
                <>
                  <ProductGrid
                    products={items}
                    columns={3}
                    linkQuery={query.colors?.length === 1 ? `color=${query.colors[0]}` : undefined}
                  />
                  <div className={styles.more}>
                    <p className={styles.count}>
                      {t('catalog.showingOf', {
                        shown: format.number(items.length),
                        total: format.number(total),
                      })}
                    </p>
                    {pages.hasNextPage && (
                      <Button
                        variant="secondary"
                        loading={pages.isFetchingNextPage}
                        onClick={() => void pages.fetchNextPage()}
                      >
                        {t('catalog.loadMore')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} labelledBy={drawerTitleId}>
            <div className={styles.drawerHead}>
              <h2 id={drawerTitleId} className={styles.drawerTitle}>
                {t('catalog.filters')}
              </h2>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setDrawerOpen(false)}
                aria-label={t('common.close')}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className={styles.drawerBody}>{panel}</div>
            <div className={styles.drawerFoot}>
              <Button variant="secondary" onClick={clearAll} disabled={filters === 0}>
                {t('catalog.clearAll')}
              </Button>
              <Button variant="primary" onClick={() => setDrawerOpen(false)}>
                {t('catalog.showResults', { count: format.number(total) })}
              </Button>
            </div>
          </Drawer>
        </>
      )}
    </div>
  );
}

function stripEmpty(locked: Locked): Locked {
  const out: Locked = {};
  if (locked.brands?.length) out.brands = locked.brands;
  if (locked.categories?.length) out.categories = locked.categories;
  return out;
}

function SortSelect({
  value,
  onChange,
}: {
  value: CatalogSort;
  onChange: (sort: CatalogSort) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={styles.sort}>
      <label htmlFor={id}>{t('catalog.sort')}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as CatalogSort)}>
        {SORTS.map((sort) => (
          <option key={sort.value} value={sort.value}>
            {t(sort.key)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActiveFilters({
  query,
  facets,
  locked,
  onChange,
  onClear,
}: {
  query: CatalogQuery;
  facets: CatalogFacets | undefined;
  locked: Locked;
  onChange: (patch: Partial<CatalogQuery>) => void;
  onClear: () => void;
}) {
  const { t, locale, format } = useI18n();
  const chips: { id: string; label: string; remove: () => void }[] = [];
  const label = (list: CatalogFacets['brands'] | undefined, key: string) => {
    const found = list?.find((o) => o.key === key);
    return found ? resolveLocalized(found.label, locale) : key;
  };
  const listChips = (
    key: 'brands' | 'categories' | 'storage' | 'colors',
    facet: keyof CatalogFacets,
  ) => {
    if (key in locked && locked[key as keyof Locked]?.length) return;
    for (const value of query[key] ?? []) {
      chips.push({
        id: `${key}-${value}`,
        label: label(facets?.[facet] as CatalogFacets['brands'], value),
        remove: () => {
          const next = (query[key] ?? []).filter((v) => v !== value);
          onChange({ [key]: next.length ? next : undefined });
        },
      });
    }
  };
  listChips('categories', 'categories');
  listChips('brands', 'brands');
  listChips('storage', 'storage');
  listChips('colors', 'colors');
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    chips.push({
      id: 'price',
      label:
        query.minPrice !== undefined && query.maxPrice !== undefined
          ? t('catalog.priceChip', {
              min: format.money(query.minPrice),
              max: format.money(query.maxPrice),
            })
          : query.minPrice !== undefined
            ? t('catalog.priceChipMin', { min: format.money(query.minPrice) })
            : t('catalog.priceChipMax', { max: format.money(query.maxPrice ?? 0) }),
      remove: () => onChange({ minPrice: undefined, maxPrice: undefined }),
    });
  }
  if (query.inStockOnly)
    chips.push({
      id: 'stock',
      label: t('catalog.inStockOnly'),
      remove: () => onChange({ inStockOnly: undefined }),
    });
  if (query.onOffer)
    chips.push({
      id: 'offers',
      label: t('catalog.onOfferOnly'),
      remove: () => onChange({ onOffer: undefined }),
    });
  if (query.newOnly)
    chips.push({
      id: 'new',
      label: t('catalog.newOnly'),
      remove: () => onChange({ newOnly: undefined }),
    });
  if (chips.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label={t('catalog.filters')}>
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            type="button"
            className={styles.chip}
            onClick={chip.remove}
            aria-label={t('catalog.removeFilter', { label: chip.label })}
          >
            {chip.label}
            <X aria-hidden="true" />
          </button>
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <button type="button" className={styles.clear} onClick={onClear}>
            {t('catalog.clearAll')}
          </button>
        </li>
      )}
    </ul>
  );
}

export function SearchForm({ initial }: { initial: string }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const id = useId();
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setValue(initial);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    void navigate(localizePath(q ? `/search?q=${encodeURIComponent(q)}` : '/store', locale));
  };
  return (
    <form role="search" className={styles.search} onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        {t('search.label')}
      </label>
      <input
        id={id}
        type="search"
        className={styles.searchInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('search.placeholder')}
        enterKeyHint="search"
        maxLength={80}
      />
      <Button type="submit" variant="primary">
        {t('search.submit')}
      </Button>
    </form>
  );
}

// ── Route components ─────────────────────────────────────────

export function StorePage() {
  const { t } = useI18n();
  return (
    <CatalogListing
      title={t('catalog.storeTitle')}
      subtitle={t('catalog.storeSubtitle')}
      crumbs={[{ label: t('common.home'), href: '/' }, { label: t('catalog.storeTitle') }]}
      withSearch
      showFeatured
    />
  );
}

export function SearchPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const title = q ? t('catalog.searchResultsFor', { q }) : t('search.label');
  return (
    <CatalogListing
      title={title}
      crumbs={[
        { label: t('common.home'), href: '/' },
        { label: t('catalog.storeTitle'), href: '/store' },
        { label: title },
      ]}
      withSearch
      noIndex
    />
  );
}

export function CategoryPage() {
  const { slug = '' } = useParams();
  const { t, locale } = useI18n();
  const { data, isPending } = useCategories();
  if (isPending) return <ListingSkeleton />;
  const category = data?.find((c) => c.slug === slug);
  if (!category) return <NotFoundPage />;
  const parent = category.parentSlug ? data?.find((c) => c.slug === category.parentSlug) : null;
  const name = resolveLocalized(category.name, locale);
  return (
    <CatalogListing
      key={slug}
      title={name}
      subtitle={category.description ? resolveLocalized(category.description, locale) : null}
      crumbs={[
        { label: t('common.home'), href: '/' },
        { label: t('catalog.storeTitle'), href: '/store' },
        ...(parent
          ? [{ label: resolveLocalized(parent.name, locale), href: `/category/${parent.slug}` }]
          : []),
        { label: name },
      ]}
      locked={{ categories: [slug] }}
    />
  );
}

export function BrandPage() {
  const { slug = '' } = useParams();
  const { t, locale } = useI18n();
  const { data, isPending } = useBrands();
  if (isPending) return <ListingSkeleton />;
  const brand = data?.find((b) => b.slug === slug);
  if (!brand) return <NotFoundPage />;
  const name = resolveLocalized(brand.name, locale);
  return (
    <CatalogListing
      key={slug}
      title={t('catalog.brandTitle', { brand: name })}
      subtitle={brand.description ? resolveLocalized(brand.description, locale) : null}
      crumbs={[
        { label: t('common.home'), href: '/' },
        { label: t('catalog.storeTitle'), href: '/store' },
        { label: name },
      ]}
      locked={{ brands: [slug] }}
    />
  );
}

export function BudgetPage() {
  const { t, format } = useI18n();
  const [params] = useSearchParams();
  const query = parseCatalogQuery(params);
  const min = query.minPrice ?? null;
  const max = query.maxPrice ?? null;
  const has = min !== null || max !== null;
  const range =
    min !== null && max !== null
      ? t('catalog.priceChip', { min: format.money(min), max: format.money(max) })
      : min !== null
        ? t('catalog.priceChipMin', { min: format.money(min) })
        : t('catalog.priceChipMax', { max: format.money(max ?? 0) });
  return (
    <CatalogListing
      title={has ? t('budget.resultsFor', { range }) : t('budget.pageTitle')}
      subtitle={has ? null : t('budget.subtitle')}
      crumbs={[{ label: t('common.home'), href: '/' }, { label: t('budget.pageTitle') }]}
      intro={
        <div className={styles.featuredStrip}>
          <BudgetSearch
            headingId="budget-form"
            headingLevel={2}
            title={t('budget.title')}
            current={{ min, max }}
          />
        </div>
      }
      requires={(q) => q.minPrice !== undefined || q.maxPrice !== undefined}
      emptyIntro={<p className={styles.subtitle}>{t('budget.chooseFirst')}</p>}
      noIndex
    />
  );
}

function ListingSkeleton() {
  return (
    <div className={`container ${styles.page}`} aria-busy="true">
      <ProductGridSkeleton count={8} columns={3} />
    </div>
  );
}
