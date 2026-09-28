import type {
  AdminProduct,
  AdminVariant,
  ProductInput,
  ProductStatus,
  RelationKind,
  WarrantyKind,
} from '@/domain/admin/schemas';
import { ltOrNull, normaliseSku, optionCombinations, comboKey } from '@/domain/admin/validation';
import type { LocalizedText } from '@/domain/localized';
import { toDraft, type LocalizedDraft } from '../../ui/hooks';

/** Editable form state of the product editor (strings for inputs; converted on save). */
export interface OptionValueDraft {
  key: string;
  label: LocalizedDraft;
  swatchHex: string;
}
export interface OptionDraft {
  key: string;
  name: LocalizedDraft;
  values: OptionValueDraft[];
}
export interface VariantDraft {
  /** Stable React key (the id for saved variants). */
  uid: string;
  id?: string;
  updatedAt?: string;
  sku: string;
  barcode: string;
  options: Record<string, string>;
  price: string;
  compareAt: string;
  initialStock: string;
  lowStockThreshold: string;
  isActive: boolean;
  isDefault: boolean;
  warrantyKind: WarrantyKind | '';
  warranty: LocalizedDraft;
  /** Read-only context for saved variants. */
  stock?: number;
  reserved?: number;
  lastPriceChange?: AdminVariant['lastPriceChange'];
}
export interface MediaDraft {
  uid: string;
  kind: 'image' | 'video';
  url: string;
  posterUrl: string;
  alt: LocalizedDraft;
  width: number | null;
  height: number | null;
  isCover: boolean;
  variantSku: string;
  colorKey: string;
}
export interface SpecItemDraft {
  uid: string;
  key: string;
  label: LocalizedDraft;
  value: LocalizedDraft;
  visible: boolean;
}
export interface SpecGroupDraft {
  uid: string;
  key: string;
  title: LocalizedDraft;
  items: SpecItemDraft[];
}
export interface RelationDraft {
  kind: RelationKind;
  productId: string;
  name: LocalizedText;
  slug: string;
}
export interface ProductDraft {
  slug: string;
  brandId: string;
  categoryIds: string[];
  primaryCategoryId: string;
  model: string;
  name: LocalizedDraft;
  subtitle: LocalizedDraft;
  description: LocalizedDraft;
  warranty: LocalizedDraft;
  warrantyKind: WarrantyKind | '';
  availabilityState: AdminProduct['availabilityState'];
  status: ProductStatus;
  isVisible: boolean;
  isNew: boolean;
  isFeatured: boolean;
  releaseDate: string;
  keywords: string;
  seoTitle: LocalizedDraft;
  seoDescription: LocalizedDraft;
  options: OptionDraft[];
  variants: VariantDraft[];
  media: MediaDraft[];
  specGroups: SpecGroupDraft[];
  relations: RelationDraft[];
  priceReason: string;
}

let uidCounter = 0;
export const uid = (prefix = 'n') => `${prefix}${++uidCounter}`;

const num = (n: number | null) => (n === null ? '' : String(n));

export function emptyVariant(
  options: Record<string, string> = {},
  isDefault = false,
): VariantDraft {
  return {
    uid: uid('v'),
    sku: '',
    barcode: '',
    options,
    price: '',
    compareAt: '',
    initialStock: '0',
    lowStockThreshold: '2',
    isActive: true,
    isDefault,
    warrantyKind: '',
    warranty: { ar: '', en: '' },
  };
}

export function emptyDraft(): ProductDraft {
  return {
    slug: '',
    brandId: '',
    categoryIds: [],
    primaryCategoryId: '',
    model: '',
    name: { ar: '', en: '' },
    subtitle: { ar: '', en: '' },
    description: { ar: '', en: '' },
    warranty: { ar: '', en: '' },
    warrantyKind: '',
    availabilityState: 'available',
    status: 'draft',
    isVisible: true,
    isNew: false,
    isFeatured: false,
    releaseDate: '',
    keywords: '',
    seoTitle: { ar: '', en: '' },
    seoDescription: { ar: '', en: '' },
    options: [],
    variants: [emptyVariant({}, true)],
    media: [],
    specGroups: [],
    relations: [],
    priceReason: '',
  };
}

export function draftFromProduct(p: AdminProduct): ProductDraft {
  return {
    slug: p.slug,
    brandId: p.brandId,
    categoryIds: p.categories.map((c) => c.id),
    primaryCategoryId: p.categories.find((c) => c.isPrimary)?.id ?? p.categories[0]?.id ?? '',
    model: p.model ?? '',
    name: toDraft(p.name),
    subtitle: toDraft(p.subtitle),
    description: toDraft(p.description),
    warranty: toDraft(p.warranty),
    warrantyKind: p.warrantyKind ?? '',
    availabilityState: p.availabilityState,
    status: p.status,
    isVisible: p.isVisible,
    isNew: p.isNew,
    isFeatured: p.isFeatured,
    releaseDate: p.releaseDate ?? '',
    keywords: p.keywords,
    seoTitle: toDraft(p.seoTitle),
    seoDescription: toDraft(p.seoDescription),
    options: p.options.map((o) => ({
      key: o.key,
      name: toDraft(o.name),
      values: o.values.map((v) => ({
        key: v.key,
        label: toDraft(v.label),
        swatchHex: v.swatchHex ?? '',
      })),
    })),
    variants: p.variants.map((v) => ({
      uid: v.id,
      id: v.id,
      updatedAt: v.updatedAt,
      sku: v.sku,
      barcode: v.barcode ?? '',
      options: v.options,
      price: num(v.price),
      compareAt: num(v.compareAtPrice),
      initialStock: '0',
      lowStockThreshold: String(v.lowStockThreshold),
      isActive: v.isActive,
      isDefault: v.isDefault,
      warrantyKind: v.warrantyKind ?? '',
      warranty: toDraft(v.warranty),
      stock: v.stock,
      reserved: v.reserved,
      lastPriceChange: v.lastPriceChange,
    })),
    media: p.media.map((m) => ({
      uid: m.id ?? uid('m'),
      kind: m.kind,
      url: m.url,
      posterUrl: m.posterUrl ?? '',
      alt: toDraft(m.alt),
      width: m.width,
      height: m.height,
      isCover: m.isCover,
      variantSku: m.variantSku ?? '',
      colorKey: m.colorKey ?? '',
    })),
    specGroups: p.specGroups.map((g) => ({
      uid: uid('g'),
      key: g.key,
      title: toDraft(g.title),
      items: g.items.map((i) => ({
        uid: uid('s'),
        key: i.key,
        label: toDraft(i.label),
        value: toDraft(i.value),
        visible: i.visible,
      })),
    })),
    relations: p.relations.map((r) => ({
      kind: r.kind,
      productId: r.productId,
      name: r.name,
      slug: r.slug,
    })),
    priceReason: '',
  };
}

const lt = (d: LocalizedDraft) => ltOrNull(d.ar, d.en);
const ltRequired = (d: LocalizedDraft): LocalizedText => lt(d) ?? { ar: '' };
const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
};
const parseInt0 = (s: string, fallback: number) => {
  const n = Number(s);
  return s.trim() === '' ? fallback : Number.isInteger(n) ? n : Number.NaN;
};

/** Convert the form into the RPC payload (the server re-validates everything). */
export function draftToInput(draft: ProductDraft, product?: AdminProduct | null): ProductInput {
  return {
    id: product?.id,
    expectedUpdatedAt: product?.updatedAt,
    slug: draft.slug.trim().toLowerCase(),
    brandId: draft.brandId,
    categoryIds: draft.categoryIds,
    primaryCategoryId: draft.primaryCategoryId || null,
    model: draft.model.trim() || null,
    name: ltRequired(draft.name),
    subtitle: lt(draft.subtitle),
    description: lt(draft.description),
    warranty: lt(draft.warranty),
    warrantyKind: draft.warrantyKind || null,
    availabilityState: draft.availabilityState,
    status: draft.status,
    isVisible: draft.isVisible,
    isNew: draft.isNew,
    isFeatured: draft.isFeatured,
    releaseDate: draft.releaseDate || null,
    keywords: draft.keywords,
    seoTitle: lt(draft.seoTitle),
    seoDescription: lt(draft.seoDescription),
    options: draft.options.map((o) => ({
      key: o.key.trim(),
      name: ltRequired(o.name),
      values: o.values.map((v) => ({
        key: v.key.trim(),
        label: ltRequired(v.label),
        swatchHex: v.swatchHex.trim() || null,
      })),
    })),
    variants: draft.variants.map((v) => ({
      id: v.id,
      updatedAt: v.updatedAt,
      sku: normaliseSku(v.sku),
      barcode: v.barcode.trim() || null,
      options: v.options,
      price: parseNum(v.price),
      compareAtPrice: parseNum(v.compareAt),
      initialStock: v.id ? undefined : parseInt0(v.initialStock, 0),
      lowStockThreshold: parseInt0(v.lowStockThreshold, 2),
      isActive: v.isActive,
      isDefault: v.isDefault,
      warranty: lt(v.warranty),
      warrantyKind: v.warrantyKind || null,
    })),
    media: draft.media.map((m) => ({
      kind: m.kind,
      url: m.url.trim(),
      posterUrl: m.posterUrl.trim() || null,
      captionsUrl: null,
      alt: lt(m.alt),
      width: m.width,
      height: m.height,
      isCover: m.isCover,
      variantSku: m.variantSku ? normaliseSku(m.variantSku) : null,
      colorKey: m.colorKey || null,
    })),
    specGroups: draft.specGroups.map((g) => ({
      key: g.key.trim(),
      title: ltRequired(g.title),
      items: g.items.map((i) => ({
        key: i.key.trim(),
        label: ltRequired(i.label),
        value: ltRequired(i.value),
        visible: i.visible,
      })),
    })),
    relations: draft.relations.map((r) => ({ kind: r.kind, productId: r.productId })),
    priceReason: draft.priceReason.trim() || null,
  };
}

/** Variants whose price / compare-at differ from the loaded product (price history needs a reason). */
export function changedPrices(draft: ProductDraft, product?: AdminProduct | null): number {
  if (!product) return draft.variants.filter((v) => v.price.trim() !== '').length;
  return draft.variants.filter((v) => {
    const current = product.variants.find((x) => x.id === v.id);
    if (!current) return v.price.trim() !== '';
    return (
      num(current.price) !== v.price.trim() || num(current.compareAtPrice) !== v.compareAt.trim()
    );
  }).length;
}

/** Add the missing option combinations as new variants (matrix editing, e.g. Storage × Color). */
export function fillMatrix(draft: ProductDraft): VariantDraft[] {
  const existing = new Set(draft.variants.map((v) => comboKey(v.options)));
  const base = (draft.slug || 'SKU')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 30);
  const additions = optionCombinations(draft.options)
    .filter((combo) => !existing.has(comboKey(combo)))
    .map((combo) => {
      const variant = emptyVariant(combo, false);
      variant.sku = [base, ...Object.values(combo).map((k) => k.toUpperCase())]
        .join('-')
        .slice(0, 64);
      return variant;
    });
  const variants = [
    ...draft.variants.filter((v) => v.id || v.sku || Object.keys(v.options).length),
    ...additions,
  ];
  const first = variants[0];
  if (first && !variants.some((v) => v.isDefault)) variants[0] = { ...first, isDefault: true };
  return variants;
}

/** Human-readable option combination of a variant (e.g. "256GB / Black"). */
export function variantTitle(draft: ProductDraft, v: VariantDraft, locale: 'ar' | 'en'): string {
  const parts = draft.options.flatMap((o) => {
    const value = o.values.find((x) => x.key === v.options[o.key]);
    if (!value) return [];
    return [(locale === 'en' && value.label.en) || value.label.ar || value.key];
  });
  return parts.join(' / ') || v.sku || '—';
}
