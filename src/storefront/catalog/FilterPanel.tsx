import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import type { CatalogFacets, CatalogQuery, FacetOption } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { parseAmount } from '@/domain/catalog/amount';
import styles from './store.module.css';

type ListKey = 'categories' | 'brands' | 'storage' | 'colors';

export interface FilterPanelProps {
  query: CatalogQuery;
  facets: CatalogFacets | undefined;
  /** Dimensions fixed by the route (e.g. /brand/apple locks "brands"). */
  locked: Partial<Record<ListKey, boolean>>;
  onChange: (patch: Partial<CatalogQuery>) => void;
}

function toggle(list: string[] | undefined, key: string): string[] | undefined {
  const next = list?.includes(key) ? list.filter((k) => k !== key) : [...(list ?? []), key];
  return next.length ? next : undefined;
}

/** Faceted filters. Every control is a native checkbox/input in a fieldset with a legend. */
export function FilterPanel({ query, facets, locked, onChange }: FilterPanelProps) {
  const { t, locale, format } = useI18n();

  const checkboxGroup = (
    key: ListKey,
    legend: string,
    options: FacetOption[] | undefined,
    variant: 'list' | 'pill' | 'color',
  ) => {
    if (locked[key] || !options || options.length === 0) return null;
    const selected = query[key];
    return (
      <fieldset className={styles.group}>
        <legend>{legend}</legend>
        <ul className={variant === 'pill' ? styles.optionsInline : styles.options}>
          {options.map((option) => {
            const checked = selected?.includes(option.key) ?? false;
            const label = resolveLocalized(option.label, locale);
            const input = (
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange({ [key]: toggle(selected, option.key) })}
                // Disabled when nothing matches, unless it is already selected (so it can be cleared).
                disabled={option.count === 0 && !checked}
              />
            );
            if (variant === 'pill') {
              return (
                <li key={option.key}>
                  <label className={styles.pill}>
                    {input}
                    <span>
                      {label}
                      <span className="visually-hidden"> ({format.number(option.count)})</span>
                    </span>
                  </label>
                </li>
              );
            }
            return (
              <li key={option.key}>
                <label className={styles.check}>
                  {input}
                  {variant === 'color' && option.hex && (
                    <span
                      className={styles.swatch}
                      style={{ background: option.hex }}
                      aria-hidden="true"
                    />
                  )}
                  <span>{label}</span>
                  <span className={styles.checkCount}>{format.number(option.count)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  };

  return (
    <div className={styles.panel}>
      {checkboxGroup('categories', t('catalog.filterCategory'), facets?.categories, 'list')}
      {checkboxGroup('brands', t('catalog.filterBrand'), facets?.brands, 'list')}
      <PriceFilter query={query} range={facets?.price} onChange={onChange} />
      {checkboxGroup('storage', t('catalog.filterStorage'), facets?.storage, 'pill')}
      {checkboxGroup('colors', t('catalog.filterColor'), facets?.colors, 'color')}
      <fieldset className={styles.group}>
        <legend>{t('catalog.filterMore')}</legend>
        <ul className={styles.options}>
          <li>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={query.inStockOnly ?? false}
                onChange={(e) => onChange({ inStockOnly: e.target.checked || undefined })}
              />
              {t('catalog.inStockOnly')}
            </label>
          </li>
          <li>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={query.onOffer ?? false}
                onChange={(e) => onChange({ onOffer: e.target.checked || undefined })}
              />
              {t('catalog.onOfferOnly')}
            </label>
          </li>
          <li>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={query.newOnly ?? false}
                onChange={(e) => onChange({ newOnly: e.target.checked || undefined })}
              />
              {t('catalog.newOnly')}
            </label>
          </li>
        </ul>
      </fieldset>
    </div>
  );
}

function PriceFilter({
  query,
  range,
  onChange,
}: {
  query: CatalogQuery;
  range: CatalogFacets['price'] | undefined;
  onChange: (patch: Partial<CatalogQuery>) => void;
}) {
  const { t, format } = useI18n();
  const id = useId();
  const [min, setMin] = useState(query.minPrice?.toString() ?? '');
  const [max, setMax] = useState(query.maxPrice?.toString() ?? '');
  const [error, setError] = useState(false);
  // Keep inputs in sync when the URL changes (chip removed, back button …).
  const [synced, setSynced] = useState({ min: query.minPrice, max: query.maxPrice });
  if (synced.min !== query.minPrice || synced.max !== query.maxPrice) {
    setSynced({ min: query.minPrice, max: query.maxPrice });
    setMin(query.minPrice?.toString() ?? '');
    setMax(query.maxPrice?.toString() ?? '');
  }

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const minValue = parseAmount(min);
    const maxValue = parseAmount(max);
    if (
      Number.isNaN(minValue) ||
      Number.isNaN(maxValue) ||
      (minValue !== null && maxValue !== null && minValue > maxValue)
    ) {
      setError(true);
      return;
    }
    setError(false);
    onChange({ minPrice: minValue ?? undefined, maxPrice: maxValue ?? undefined });
  };

  return (
    <form onSubmit={apply} noValidate>
      <fieldset className={styles.group}>
        <legend>{t('catalog.filterPrice')}</legend>
        {range?.min != null && range.max != null && (
          <p className={styles.priceHint}>
            {t('catalog.priceChip', { min: format.money(range.min), max: format.money(range.max) })}
          </p>
        )}
        <div className={styles.priceRow}>
          <label className="visually-hidden" htmlFor={`${id}-min`}>
            {t('catalog.minPrice')}
          </label>
          <input
            id={`${id}-min`}
            className={styles.searchInput}
            inputMode="numeric"
            placeholder={t('catalog.minPrice')}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-invalid={error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <label className="visually-hidden" htmlFor={`${id}-max`}>
            {t('catalog.maxPrice')}
          </label>
          <input
            id={`${id}-max`}
            className={styles.searchInput}
            inputMode="numeric"
            placeholder={t('catalog.maxPrice')}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            aria-invalid={error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className={styles.priceHint}>
            {t('budget.invalid')}
          </p>
        )}
        <Button type="submit" variant="secondary" size="sm" block>
          {t('catalog.applyPrice')}
        </Button>
      </fieldset>
    </form>
  );
}
