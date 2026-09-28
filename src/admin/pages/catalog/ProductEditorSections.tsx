import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Grid3x3, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  AVAILABILITY_STATES,
  RELATION_KINDS,
  WARRANTY_KINDS,
  type AdminProduct,
  type CatalogLookups,
  type RelationKind,
} from '@/domain/admin/schemas';
import { slugify } from '@/domain/admin/validation';
import type { LocalizedText } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { CheckboxField, InputField, LocalizedField, SelectField } from '../../ui/fields';
import { Panel } from '../../ui/PageHeader';
import { useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from './catalogHooks';
import { ImageUpload } from './catalogParts';
import {
  changedPrices,
  emptyVariant,
  fillMatrix,
  uid,
  variantTitle,
  type ProductDraft,
  type SpecGroupDraft,
} from './productDraft';

export type SetDraft = (update: (draft: ProductDraft) => ProductDraft) => void;

interface SectionProps {
  draft: ProductDraft;
  set: SetDraft;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

function MoveButtons({
  index,
  length,
  onMove,
  label,
}: {
  index: number;
  length: number;
  onMove: (delta: number) => void;
  label: string;
}) {
  const { at } = useAdminI18n();
  return (
    <>
      <button
        type="button"
        className={styles.iconButton}
        disabled={index === 0}
        aria-label={`${at('ui.moveUp')}: ${label}`}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        disabled={index === length - 1}
        aria-label={`${at('ui.moveDown')}: ${label}`}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </button>
    </>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────
export function DetailsSection({
  draft,
  set,
  lookups,
  isNew,
  errors,
}: SectionProps & { lookups: CatalogLookups; isNew: boolean; errors: Record<string, string> }) {
  const { at } = useAdminI18n();
  const loc = useLocalized();
  const [slugTouched, setSlugTouched] = useState(!isNew);
  return (
    <div className={styles.stack}>
      <Panel title={at('catalog.editor.basics')} headingLevel={3}>
        <div className={styles.formGrid}>
          <LocalizedField
            className={styles.full}
            legend={at('catalog.editor.name')}
            required
            value={draft.name}
            error={errors.name}
            maxLength={200}
            onChange={(name) =>
              set((d) => ({
                ...d,
                name,
                slug: slugTouched ? d.slug : slugify(name.en || d.slug),
              }))
            }
          />
          <InputField
            label={at('catalog.editor.slug')}
            hint={at('catalog.editor.slugHint')}
            value={draft.slug}
            ltr
            required
            maxLength={80}
            error={errors.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set((d) => ({ ...d, slug: e.target.value.toLowerCase() }));
            }}
          />
          <InputField
            label={at('catalog.editor.model')}
            value={draft.model}
            ltr
            maxLength={120}
            onChange={(e) => set((d) => ({ ...d, model: e.target.value }))}
          />
          <SelectField
            label={at('catalog.col.brand')}
            value={draft.brandId}
            required
            error={errors.brandId}
            onChange={(e) => set((d) => ({ ...d, brandId: e.target.value }))}
            options={[
              { value: '', label: at('catalog.editor.chooseBrand') },
              ...lookups.brands.map((b) => ({ value: b.id, label: loc(b.name) })),
            ]}
          />
          <SelectField
            label={at('catalog.col.status')}
            value={draft.status}
            onChange={(e) =>
              set((d) => ({ ...d, status: e.target.value as ProductDraft['status'] }))
            }
            options={(['draft', 'published', 'archived'] as const).map((s) => ({
              value: s,
              label: at(`catalog.status.${s}`),
            }))}
          />
          <SelectField
            label={at('catalog.editor.availability')}
            value={draft.availabilityState}
            onChange={(e) =>
              set((d) => ({
                ...d,
                availabilityState: e.target.value as ProductDraft['availabilityState'],
              }))
            }
            options={AVAILABILITY_STATES.map((s) => ({
              value: s,
              label: at(`catalog.availability.${s}` as AdminMessageKey),
            }))}
          />
          <InputField
            type="date"
            label={at('catalog.editor.releaseDate')}
            value={draft.releaseDate}
            onChange={(e) => set((d) => ({ ...d, releaseDate: e.target.value }))}
          />
          <div className={`${styles.full} ${styles.chips}`}>
            <CheckboxField
              label={at('catalog.editor.visible')}
              checked={draft.isVisible}
              onChange={(isVisible) => set((d) => ({ ...d, isVisible }))}
            />
            <CheckboxField
              label={at('catalog.editor.featured')}
              checked={draft.isFeatured}
              onChange={(isFeatured) => set((d) => ({ ...d, isFeatured }))}
            />
            <CheckboxField
              label={at('catalog.editor.newRelease')}
              checked={draft.isNew}
              onChange={(isNew) => set((d) => ({ ...d, isNew }))}
            />
          </div>
        </div>
      </Panel>
      <Panel title={at('catalog.editor.categories')} headingLevel={3}>
        {errors.categoryIds && (
          <p className={styles.error} role="alert">
            {errors.categoryIds}
          </p>
        )}
        <fieldset className={styles.formGrid} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">{at('catalog.editor.categories')}</legend>
          {lookups.categories.map((c) => {
            const checked = draft.categoryIds.includes(c.id);
            return (
              <div key={c.id} className={styles.chips} style={{ alignItems: 'center' }}>
                <CheckboxField
                  label={`${c.parentId ? '— ' : ''}${loc(c.name)}`}
                  checked={checked}
                  onChange={(on) =>
                    set((d) => {
                      const categoryIds = on
                        ? [...d.categoryIds, c.id]
                        : d.categoryIds.filter((x) => x !== c.id);
                      const primary = categoryIds.includes(d.primaryCategoryId)
                        ? d.primaryCategoryId
                        : (categoryIds[0] ?? '');
                      return { ...d, categoryIds, primaryCategoryId: primary };
                    })
                  }
                />
                {checked && (
                  <label className={`${styles.check} ${styles.small}`}>
                    <input
                      type="radio"
                      name="primary-category"
                      checked={draft.primaryCategoryId === c.id}
                      onChange={() => set((d) => ({ ...d, primaryCategoryId: c.id }))}
                    />
                    {at('catalog.editor.primary')}
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>
      </Panel>
      <Panel title={at('catalog.editor.descriptions')} headingLevel={3}>
        <div className={styles.stack}>
          <LocalizedField
            legend={at('catalog.editor.subtitle')}
            value={draft.subtitle}
            maxLength={240}
            onChange={(subtitle) => set((d) => ({ ...d, subtitle }))}
          />
          <LocalizedField
            legend={at('catalog.editor.description')}
            value={draft.description}
            multiline
            rows={6}
            onChange={(description) => set((d) => ({ ...d, description }))}
          />
          <InputField
            label={at('catalog.editor.keywords')}
            hint={at('catalog.editor.keywordsHint')}
            value={draft.keywords}
            maxLength={1000}
            onChange={(e) => set((d) => ({ ...d, keywords: e.target.value }))}
          />
        </div>
      </Panel>
    </div>
  );
}

// ── Variants (options + matrix) ─────────────────────────────────────────────
export function VariantsSection({
  draft,
  set,
  product,
  canPrice,
  canStock,
  error,
}: SectionProps & {
  product: AdminProduct | null;
  canPrice: boolean;
  canStock: boolean;
  error?: string;
}) {
  const { at } = useAdminI18n();
  const { locale, format } = useI18n();
  const priceChanges = changedPrices(draft, product);
  const setVariant = (index: number, patch: Partial<ProductDraft['variants'][number]>) =>
    set((d) => ({
      ...d,
      variants: d.variants.map((v, i) =>
        i === index ? { ...v, ...patch } : patch.isDefault ? { ...v, isDefault: false } : v,
      ),
    }));
  return (
    <div className={styles.stack}>
      <Panel
        title={at('catalog.editor.options')}
        headingLevel={3}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus aria-hidden="true" />}
            onClick={() =>
              set((d) => ({
                ...d,
                options: [
                  ...d.options,
                  {
                    key: d.options.some((o) => o.key === 'storage')
                      ? d.options.some((o) => o.key === 'color')
                        ? `option${d.options.length + 1}`
                        : 'color'
                      : 'storage',
                    name: { ar: '', en: '' },
                    values: [],
                  },
                ],
              }))
            }
          >
            {at('catalog.editor.addOption')}
          </Button>
        }
      >
        <p className={`${styles.muted} ${styles.small}`}>{at('catalog.editor.optionsHint')}</p>
        <div className={styles.stack}>
          {draft.options.map((o, oi) => (
            <div key={oi} className={styles.repeat}>
              <div className={styles.repeatHead}>
                <strong>{o.name.ar || o.key || at('catalog.editor.option')}</strong>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`${at('ui.remove')}: ${o.name.ar || o.key}`}
                  onClick={() =>
                    set((d) => ({ ...d, options: d.options.filter((_, i) => i !== oi) }))
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              <div className={styles.formGrid}>
                <InputField
                  label={at('catalog.editor.optionKey')}
                  hint={at('catalog.editor.optionKeyHint')}
                  value={o.key}
                  ltr
                  maxLength={31}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      options: d.options.map((x, i) =>
                        i === oi ? { ...x, key: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <LocalizedField
                  legend={at('catalog.editor.optionName')}
                  required
                  value={o.name}
                  onChange={(name) =>
                    set((d) => ({
                      ...d,
                      options: d.options.map((x, i) => (i === oi ? { ...x, name } : x)),
                    }))
                  }
                />
              </div>
              {o.values.map((v, vi) => (
                <div key={vi} className={styles.formGrid} style={{ alignItems: 'end' }}>
                  <LocalizedField
                    legend={at('catalog.editor.value', { n: vi + 1 })}
                    required
                    value={v.label}
                    onChange={(label) =>
                      set((d) => ({
                        ...d,
                        options: d.options.map((x, i) =>
                          i === oi
                            ? {
                                ...x,
                                values: x.values.map((y, j) =>
                                  j === vi
                                    ? { ...y, label, key: y.key || slugify(label.en || label.ar) }
                                    : y,
                                ),
                              }
                            : x,
                        ),
                      }))
                    }
                  />
                  <div className={styles.formGrid}>
                    <InputField
                      label={at('catalog.editor.valueKey')}
                      value={v.key}
                      ltr
                      maxLength={40}
                      onChange={(e) =>
                        set((d) => ({
                          ...d,
                          options: d.options.map((x, i) =>
                            i === oi
                              ? {
                                  ...x,
                                  values: x.values.map((y, j) =>
                                    j === vi ? { ...y, key: e.target.value.toLowerCase() } : y,
                                  ),
                                }
                              : x,
                          ),
                        }))
                      }
                    />
                    <InputField
                      label={at('catalog.editor.swatch')}
                      value={v.swatchHex}
                      ltr
                      placeholder="#000000"
                      maxLength={7}
                      onChange={(e) =>
                        set((d) => ({
                          ...d,
                          options: d.options.map((x, i) =>
                            i === oi
                              ? {
                                  ...x,
                                  values: x.values.map((y, j) =>
                                    j === vi ? { ...y, swatchHex: e.target.value } : y,
                                  ),
                                }
                              : x,
                          ),
                        }))
                      }
                    />
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`${at('ui.remove')}: ${v.label.ar || v.key}`}
                        onClick={() =>
                          set((d) => ({
                            ...d,
                            options: d.options.map((x, i) =>
                              i === oi ? { ...x, values: x.values.filter((_, j) => j !== vi) } : x,
                            ),
                          }))
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden="true" />}
                  onClick={() =>
                    set((d) => ({
                      ...d,
                      options: d.options.map((x, i) =>
                        i === oi
                          ? {
                              ...x,
                              values: [
                                ...x.values,
                                { key: '', label: { ar: '', en: '' }, swatchHex: '' },
                              ],
                            }
                          : x,
                      ),
                    }))
                  }
                >
                  {at('catalog.editor.addValue')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={at('catalog.editor.variants', { count: draft.variants.length })}
        headingLevel={3}
        actions={
          <>
            {draft.options.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Grid3x3 aria-hidden="true" />}
                onClick={() => set((d) => ({ ...d, variants: fillMatrix(d) }))}
              >
                {at('catalog.editor.fillMatrix')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus aria-hidden="true" />}
              onClick={() =>
                set((d) => ({
                  ...d,
                  variants: [...d.variants, emptyVariant({}, d.variants.length === 0)],
                }))
              }
            >
              {at('catalog.editor.addVariant')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live>
            {error}
          </Alert>
        )}
        {!canPrice && <Alert tone="info">{at('catalog.editor.priceLocked')}</Alert>}
        <div className={styles.stack}>
          {draft.variants.map((v, vi) => {
            const title = variantTitle(draft, v, locale);
            return (
              <div key={v.uid} className={styles.repeat}>
                <div className={styles.repeatHead}>
                  <span className={styles.chips}>
                    <strong>{title}</strong>
                    {v.isDefault && <Badge tone="brand">{at('catalog.editor.default')}</Badge>}
                    {!v.isActive && <Badge>{at('catalog.editor.inactive')}</Badge>}
                    {!v.id && <Badge tone="info">{at('catalog.editor.newVariant')}</Badge>}
                  </span>
                  <span className={styles.rowActions}>
                    <label className={`${styles.check} ${styles.small}`}>
                      <input
                        type="radio"
                        name="default-variant"
                        checked={v.isDefault}
                        onChange={() => setVariant(vi, { isDefault: true })}
                      />
                      {at('catalog.editor.makeDefault')}
                    </label>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`${at('ui.remove')}: ${title}`}
                      onClick={() =>
                        set((d) => ({ ...d, variants: d.variants.filter((_, i) => i !== vi) }))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                </div>
                <div className={`${styles.formGrid} ${styles.formGrid3}`}>
                  {draft.options.map((o) => (
                    <SelectField
                      key={o.key}
                      label={o.name.ar || o.key}
                      value={v.options[o.key] ?? ''}
                      onChange={(e) =>
                        setVariant(vi, {
                          options: Object.fromEntries(
                            Object.entries({ ...v.options, [o.key]: e.target.value }).filter(
                              ([, val]) => val !== '',
                            ),
                          ),
                        })
                      }
                      options={[
                        { value: '', label: '—' },
                        ...o.values.map((val) => ({
                          value: val.key,
                          label: (locale === 'en' && val.label.en) || val.label.ar || val.key,
                        })),
                      ]}
                    />
                  ))}
                  <InputField
                    label="SKU"
                    value={v.sku}
                    ltr
                    required
                    maxLength={64}
                    onChange={(e) => setVariant(vi, { sku: e.target.value.toUpperCase() })}
                  />
                  <InputField
                    label={at('catalog.editor.barcode')}
                    value={v.barcode}
                    ltr
                    maxLength={64}
                    onChange={(e) => setVariant(vi, { barcode: e.target.value })}
                  />
                  <InputField
                    label={at('catalog.editor.price')}
                    value={v.price}
                    inputMode="decimal"
                    ltr
                    disabled={!canPrice}
                    onChange={(e) => setVariant(vi, { price: e.target.value })}
                    hint={
                      v.lastPriceChange
                        ? at('catalog.editor.lastChange', {
                            price:
                              v.lastPriceChange.oldPrice === null
                                ? '—'
                                : format.money(v.lastPriceChange.oldPrice, { fractionDigits: 0 }),
                            date: format.date(v.lastPriceChange.at),
                          })
                        : undefined
                    }
                  />
                  <InputField
                    label={at('catalog.editor.compareAt')}
                    value={v.compareAt}
                    inputMode="decimal"
                    ltr
                    disabled={!canPrice}
                    onChange={(e) => setVariant(vi, { compareAt: e.target.value })}
                  />
                  {v.id ? (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>{at('catalog.editor.stock')}</span>
                      <span>
                        {at('catalog.editor.stockNow', {
                          stock: format.number(v.stock ?? 0),
                          reserved: format.number(v.reserved ?? 0),
                        })}{' '}
                        <Link to={`/admin/inventory?q=${encodeURIComponent(v.sku)}`}>
                          {at('catalog.editor.adjustStock')}
                        </Link>
                      </span>
                    </div>
                  ) : (
                    <InputField
                      label={at('catalog.editor.initialStock')}
                      value={v.initialStock}
                      inputMode="numeric"
                      ltr
                      disabled={!canStock}
                      onChange={(e) => setVariant(vi, { initialStock: e.target.value })}
                    />
                  )}
                  <InputField
                    label={at('catalog.editor.lowStock')}
                    value={v.lowStockThreshold}
                    inputMode="numeric"
                    ltr
                    onChange={(e) => setVariant(vi, { lowStockThreshold: e.target.value })}
                  />
                  <SelectField
                    label={at('catalog.editor.variantWarranty')}
                    value={v.warrantyKind}
                    onChange={(e) =>
                      setVariant(vi, {
                        warrantyKind: e.target.value as ProductDraft['warrantyKind'],
                      })
                    }
                    options={[
                      { value: '', label: at('catalog.editor.inheritWarranty') },
                      ...WARRANTY_KINDS.map((k) => ({
                        value: k,
                        label: at(`catalog.warranty.${k}` as AdminMessageKey),
                      })),
                    ]}
                  />
                  <CheckboxField
                    label={at('catalog.editor.active')}
                    checked={v.isActive}
                    onChange={(isActive) => setVariant(vi, { isActive })}
                  />
                </div>
                {v.warrantyKind === 'custom' && (
                  <LocalizedField
                    legend={at('catalog.editor.customWarranty')}
                    value={v.warranty}
                    onChange={(warranty) => setVariant(vi, { warranty })}
                  />
                )}
              </div>
            );
          })}
        </div>
        {product && product.variants.some((pv) => !draft.variants.some((v) => v.id === pv.id)) && (
          <Alert tone="warning">{at('catalog.editor.retireNote')}</Alert>
        )}
        {priceChanges > 0 && canPrice && (
          <div style={{ marginBlockStart: 'var(--space-4)' }}>
            <InputField
              label={at('catalog.editor.priceReason', { count: priceChanges })}
              hint={at('ui.reasonHint')}
              value={draft.priceReason}
              maxLength={300}
              onChange={(e) => set((d) => ({ ...d, priceReason: e.target.value }))}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Media ───────────────────────────────────────────────────────────────────
export function MediaSection({ draft, set }: SectionProps) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const [videoUrl, setVideoUrl] = useState('');
  const colorOption = draft.options.find((o) => o.key === 'color');
  const update = (index: number, patch: Partial<ProductDraft['media'][number]>) =>
    set((d) => ({
      ...d,
      media: d.media.map((m, i) =>
        i === index ? { ...m, ...patch } : patch.isCover ? { ...m, isCover: false } : m,
      ),
    }));
  return (
    <Panel
      title={at('catalog.editor.media')}
      headingLevel={3}
      actions={
        <ImageUpload
          onUploaded={(url, size) =>
            set((d) => ({
              ...d,
              media: [
                ...d.media,
                {
                  uid: uid('m'),
                  kind: 'image',
                  url,
                  posterUrl: '',
                  alt: { ...d.name },
                  width: size?.width ?? null,
                  height: size?.height ?? null,
                  isCover: !d.media.some((m) => m.isCover),
                  variantSku: '',
                  colorKey: '',
                },
              ],
            }))
          }
        />
      }
    >
      <p className={`${styles.muted} ${styles.small}`}>{at('catalog.editor.mediaHint')}</p>
      <form
        className={styles.filters}
        style={{ marginBlock: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault();
          const url = videoUrl.trim();
          if (!url) return;
          set((d) => ({
            ...d,
            media: [
              ...d.media,
              {
                uid: uid('m'),
                kind: 'video',
                url,
                posterUrl: '',
                alt: { ...d.name },
                width: null,
                height: null,
                isCover: false,
                variantSku: '',
                colorKey: '',
              },
            ],
          }));
          setVideoUrl('');
        }}
      >
        <InputField
          label={at('catalog.editor.videoUrl')}
          hint={at('catalog.editor.videoHint')}
          value={videoUrl}
          ltr
          type="url"
          placeholder="https://…/clip.mp4"
          onChange={(e) => setVideoUrl(e.target.value)}
        />
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary" icon={<Plus aria-hidden="true" />}>
            {at('catalog.editor.addVideo')}
          </Button>
        </div>
      </form>
      {draft.media.length === 0 ? (
        <div className={styles.emptyBox}>{at('catalog.editor.noMedia')}</div>
      ) : (
        <ul className={styles.mediaGrid} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {draft.media.map((m, i) => {
            const label = `${at('catalog.editor.mediaItem', { n: i + 1 })}`;
            return (
              <li
                key={m.uid}
                className={[styles.mediaCard, m.isCover && styles.mediaCover]
                  .filter(Boolean)
                  .join(' ')}
              >
                {m.kind === 'image' ? (
                  <img src={m.url} alt={m.alt.ar || label} loading="lazy" />
                ) : (
                  // Muted preview only; the storefront renders captions / poster.
                  <video src={m.url} muted preload="metadata" aria-label={label} />
                )}
                <span className={styles.chips}>
                  {m.isCover && (
                    <Badge tone="brand" icon={<Star aria-hidden="true" />}>
                      {at('catalog.editor.cover')}
                    </Badge>
                  )}
                  {m.kind === 'video' && <Badge>{at('catalog.editor.video')}</Badge>}
                </span>
                {m.kind === 'image' && !m.isCover && (
                  <Button size="sm" variant="ghost" onClick={() => update(i, { isCover: true })}>
                    {at('catalog.editor.makeCover')}
                  </Button>
                )}
                <InputField
                  label={at('catalog.editor.altAr')}
                  value={m.alt.ar}
                  maxLength={200}
                  onChange={(e) => update(i, { alt: { ...m.alt, ar: e.target.value } })}
                />
                {colorOption && (
                  <SelectField
                    label={at('catalog.editor.forColor')}
                    value={m.colorKey}
                    onChange={(e) => update(i, { colorKey: e.target.value })}
                    options={[
                      { value: '', label: at('catalog.editor.allColors') },
                      ...colorOption.values.map((v) => ({
                        value: v.key,
                        label: (locale === 'en' && v.label.en) || v.label.ar || v.key,
                      })),
                    ]}
                  />
                )}
                <SelectField
                  label={at('catalog.editor.forVariant')}
                  value={m.variantSku}
                  onChange={(e) => update(i, { variantSku: e.target.value })}
                  options={[
                    { value: '', label: at('catalog.editor.allVariants') },
                    ...draft.variants
                      .filter((v) => v.sku)
                      .map((v) => ({
                        value: v.sku,
                        label: `${v.sku} · ${variantTitle(draft, v, locale)}`,
                      })),
                  ]}
                />
                <span className={styles.rowActions}>
                  <MoveButtons
                    index={i}
                    length={draft.media.length}
                    label={label}
                    onMove={(delta) => set((d) => ({ ...d, media: move(d.media, i, delta) }))}
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`${at('ui.remove')}: ${label}`}
                    onClick={() => set((d) => ({ ...d, media: d.media.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Specifications ──────────────────────────────────────────────────────────
export function SpecsSection({
  draft,
  set,
  productId,
}: SectionProps & { productId: string | null }) {
  const { at } = useAdminI18n();
  const setGroup = (gi: number, update: (g: SpecGroupDraft) => SpecGroupDraft) =>
    set((d) => ({ ...d, specGroups: d.specGroups.map((g, i) => (i === gi ? update(g) : g)) }));
  return (
    <div className={styles.stack}>
      <Panel
        title={at('catalog.editor.specs')}
        headingLevel={3}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus aria-hidden="true" />}
            onClick={() =>
              set((d) => ({
                ...d,
                specGroups: [
                  ...d.specGroups,
                  {
                    uid: uid('g'),
                    key: `group-${d.specGroups.length + 1}`,
                    title: { ar: '', en: '' },
                    items: [],
                  },
                ],
              }))
            }
          >
            {at('catalog.editor.addGroup')}
          </Button>
        }
      >
        <p className={`${styles.muted} ${styles.small}`}>{at('catalog.editor.specsHint')}</p>
        <div className={styles.stack}>
          {draft.specGroups.map((g, gi) => (
            <div key={g.uid} className={styles.repeat}>
              <div className={styles.repeatHead}>
                <strong>{g.title.ar || g.key}</strong>
                <span className={styles.rowActions}>
                  <MoveButtons
                    index={gi}
                    length={draft.specGroups.length}
                    label={g.title.ar || g.key}
                    onMove={(delta) =>
                      set((d) => ({ ...d, specGroups: move(d.specGroups, gi, delta) }))
                    }
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`${at('ui.remove')}: ${g.title.ar || g.key}`}
                    onClick={() =>
                      set((d) => ({ ...d, specGroups: d.specGroups.filter((_, i) => i !== gi) }))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </div>
              <div className={styles.formGrid}>
                <InputField
                  label={at('catalog.editor.groupKey')}
                  value={g.key}
                  ltr
                  maxLength={41}
                  onChange={(e) =>
                    setGroup(gi, (x) => ({ ...x, key: e.target.value.toLowerCase() }))
                  }
                />
                <LocalizedField
                  legend={at('catalog.editor.groupTitle')}
                  required
                  value={g.title}
                  onChange={(title) => setGroup(gi, (x) => ({ ...x, title }))}
                />
              </div>
              {g.items.map((item, ii) => (
                <div
                  key={item.uid}
                  className={styles.repeat}
                  style={{ background: 'var(--color-surface-elevated)' }}
                >
                  <div className={styles.formGrid}>
                    <LocalizedField
                      legend={at('catalog.editor.specLabel')}
                      required
                      value={item.label}
                      onChange={(label) =>
                        setGroup(gi, (x) => ({
                          ...x,
                          items: x.items.map((y, j) =>
                            j === ii
                              ? {
                                  ...y,
                                  label,
                                  key: y.key || slugify(label.en || label.ar) || `spec-${ii + 1}`,
                                }
                              : y,
                          ),
                        }))
                      }
                    />
                    <LocalizedField
                      legend={at('catalog.editor.specValue')}
                      required
                      value={item.value}
                      onChange={(value) =>
                        setGroup(gi, (x) => ({
                          ...x,
                          items: x.items.map((y, j) => (j === ii ? { ...y, value } : y)),
                        }))
                      }
                    />
                  </div>
                  <span className={styles.rowActions}>
                    <CheckboxField
                      label={at('catalog.editor.specVisible')}
                      checked={item.visible}
                      onChange={(visible) =>
                        setGroup(gi, (x) => ({
                          ...x,
                          items: x.items.map((y, j) => (j === ii ? { ...y, visible } : y)),
                        }))
                      }
                    />
                    <MoveButtons
                      index={ii}
                      length={g.items.length}
                      label={item.label.ar || item.key}
                      onMove={(delta) =>
                        setGroup(gi, (x) => ({ ...x, items: move(x.items, ii, delta) }))
                      }
                    />
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`${at('ui.remove')}: ${item.label.ar || item.key}`}
                      onClick={() =>
                        setGroup(gi, (x) => ({ ...x, items: x.items.filter((_, j) => j !== ii) }))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden="true" />}
                  onClick={() =>
                    setGroup(gi, (x) => ({
                      ...x,
                      items: [
                        ...x.items,
                        {
                          uid: uid('s'),
                          key: '',
                          label: { ar: '', en: '' },
                          value: { ar: '', en: '' },
                          visible: true,
                        },
                      ],
                    }))
                  }
                >
                  {at('catalog.editor.addSpec')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <CopySpecs
        productId={productId}
        onCopy={(groups) => set((d) => ({ ...d, specGroups: groups }))}
      />
    </div>
  );
}

function ProductPicker({
  excludeId,
  onPick,
  label,
}: {
  excludeId: string | null;
  onPick: (p: { id: string; name: LocalizedText; slug: string }) => void;
  label: string;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const results = useQuery({
    queryKey: ['admin', 'product-picker', term],
    queryFn: () => repo.listProducts({ q: term, limit: 8 }),
    enabled: term.length >= 2,
  });
  return (
    <div className={styles.stack}>
      <form
        className={styles.filters}
        role="search"
        aria-label={label}
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
      >
        <InputField label={label} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary" icon={<Search aria-hidden="true" />}>
            {at('ui.search')}
          </Button>
        </div>
      </form>
      {results.data && (
        <ul
          className={styles.stack}
          style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-1)' }}
        >
          {results.data.items
            .filter((p) => p.id !== excludeId)
            .map((p) => (
              <li key={p.id} className={styles.chips} style={{ alignItems: 'center' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden="true" />}
                  onClick={() => onPick(p)}
                >
                  {loc(p.name)}
                </Button>
                <span className={`${styles.mono} ${styles.muted}`}>{p.slug}</span>
              </li>
            ))}
          {results.data.items.length === 0 && <li className={styles.muted}>{at('ui.empty')}</li>}
        </ul>
      )}
    </div>
  );
}

function CopySpecs({
  productId,
  onCopy,
}: {
  productId: string | null;
  onCopy: (groups: SpecGroupDraft[]) => void;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const loc = useLocalized();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Panel title={at('catalog.editor.copySpecs')} headingLevel={3}>
      <p className={`${styles.muted} ${styles.small}`}>{at('catalog.editor.copySpecsHint')}</p>
      <ProductPicker
        excludeId={productId}
        label={at('catalog.editor.findProduct')}
        onPick={async (p) => {
          try {
            const source = await repo.getProduct(p.id);
            if (!source) return;
            onCopy(
              source.specGroups.map((g) => ({
                uid: uid('g'),
                key: g.key,
                title: { ar: g.title.ar, en: g.title.en ?? '' },
                items: g.items.map((i) => ({
                  uid: uid('s'),
                  key: i.key,
                  label: { ar: i.label.ar, en: i.label.en ?? '' },
                  value: { ar: i.value.ar, en: i.value.en ?? '' },
                  visible: i.visible,
                })),
              })),
            );
            setMessage(at('catalog.editor.copied', { name: loc(p.name) }));
          } catch (e) {
            setMessage(errorText(e));
          }
        }}
      />
      {message && (
        <p role="status" className={styles.small}>
          {message}
        </p>
      )}
    </Panel>
  );
}

// ── Warranty ────────────────────────────────────────────────────────────────
export function WarrantySection({ draft, set }: SectionProps) {
  const { at } = useAdminI18n();
  return (
    <Panel title={at('catalog.editor.warranty')} headingLevel={3}>
      <div className={styles.stack}>
        <SelectField
          label={at('catalog.editor.warrantyKind')}
          value={draft.warrantyKind}
          onChange={(e) =>
            set((d) => ({ ...d, warrantyKind: e.target.value as ProductDraft['warrantyKind'] }))
          }
          options={[
            { value: '', label: at('ui.notSet') },
            ...WARRANTY_KINDS.map((k) => ({
              value: k,
              label: at(`catalog.warranty.${k}` as AdminMessageKey),
            })),
          ]}
        />
        <LocalizedField
          legend={at('catalog.editor.warrantyText')}
          hint={at('catalog.editor.warrantyHint')}
          value={draft.warranty}
          multiline
          rows={3}
          onChange={(warranty) => set((d) => ({ ...d, warranty }))}
        />
        <Alert tone="info">{at('catalog.editor.warrantyVariantNote')}</Alert>
      </div>
    </Panel>
  );
}

// ── Relations ───────────────────────────────────────────────────────────────
export function RelationsSection({
  draft,
  set,
  productId,
}: SectionProps & { productId: string | null }) {
  const { at } = useAdminI18n();
  const loc = useLocalized();
  const [kind, setKind] = useState<RelationKind>('accessory');
  return (
    <div className={styles.stack}>
      <Panel title={at('catalog.editor.relations')} headingLevel={3}>
        <p className={`${styles.muted} ${styles.small}`}>{at('catalog.editor.relationsHint')}</p>
        {RELATION_KINDS.map((k) => {
          const items = draft.relations.filter((r) => r.kind === k);
          return (
            <div key={k} style={{ marginBlockEnd: 'var(--space-3)' }}>
              <h4 className={styles.fieldLabel}>
                {at(`catalog.relation.${k}` as AdminMessageKey)}
              </h4>
              {items.length === 0 ? (
                <p className={`${styles.muted} ${styles.small}`}>{at('ui.none')}</p>
              ) : (
                <ul className={styles.chips} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {items.map((r) => (
                    <li key={r.productId}>
                      <Badge>
                        {loc(r.name)}
                        <button
                          type="button"
                          className={styles.iconButton}
                          style={{ width: 22, height: 22, border: 0, background: 'none' }}
                          aria-label={`${at('ui.remove')}: ${loc(r.name)}`}
                          onClick={() =>
                            set((d) => ({
                              ...d,
                              relations: d.relations.filter(
                                (x) => !(x.kind === k && x.productId === r.productId),
                              ),
                            }))
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </Panel>
      <Panel title={at('catalog.editor.addRelation')} headingLevel={3}>
        <SelectField
          label={at('catalog.editor.relationKind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as RelationKind)}
          options={RELATION_KINDS.map((k) => ({
            value: k,
            label: at(`catalog.relation.${k}` as AdminMessageKey),
          }))}
        />
        <ProductPicker
          excludeId={productId}
          label={at('catalog.editor.findProduct')}
          onPick={(p) =>
            set((d) =>
              d.relations.some((r) => r.kind === kind && r.productId === p.id)
                ? d
                : {
                    ...d,
                    relations: [
                      ...d.relations,
                      { kind, productId: p.id, name: p.name, slug: p.slug },
                    ],
                  },
            )
          }
        />
        <Alert tone="info">{at('catalog.editor.boughtTogetherNote')}</Alert>
      </Panel>
    </div>
  );
}

// ── SEO ─────────────────────────────────────────────────────────────────────
export function SeoSection({ draft, set }: SectionProps) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const title =
    (locale === 'en' && draft.seoTitle.en) ||
    draft.seoTitle.ar ||
    (locale === 'en' && draft.name.en) ||
    draft.name.ar;
  const description =
    (locale === 'en' && draft.seoDescription.en) ||
    draft.seoDescription.ar ||
    (locale === 'en' && draft.subtitle.en) ||
    draft.subtitle.ar;
  return (
    <Panel title={at('catalog.editor.seo')} headingLevel={3}>
      <div className={styles.stack}>
        <LocalizedField
          legend={at('catalog.editor.seoTitle')}
          hint={at('catalog.editor.seoTitleHint')}
          value={draft.seoTitle}
          maxLength={70}
          onChange={(seoTitle) => set((d) => ({ ...d, seoTitle }))}
        />
        <LocalizedField
          legend={at('catalog.editor.seoDescription')}
          value={draft.seoDescription}
          multiline
          rows={3}
          maxLength={170}
          onChange={(seoDescription) => set((d) => ({ ...d, seoDescription }))}
        />
        <div
          className={styles.previewFrame}
          aria-label={at('catalog.editor.searchPreview')}
          role="group"
        >
          <p className={styles.fieldLabel}>{at('catalog.editor.searchPreview')}</p>
          <p style={{ color: 'var(--color-info)', fontWeight: 600 }}>{title || '—'}</p>
          <p className={`${styles.mono} ${styles.small} ${styles.muted}`}>/product/{draft.slug}</p>
          <p className={styles.small}>{description || '—'}</p>
        </div>
      </div>
    </Panel>
  );
}
