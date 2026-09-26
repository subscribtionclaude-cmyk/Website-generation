import { MAX_IMPORT_ROWS, type ParsedCsv } from './csv';

/** Columns the product importer understands (validated again, authoritatively, by the server). */
export const IMPORT_FIELDS = [
  'sku',
  'productSlug',
  'nameEn',
  'nameAr',
  'brand',
  'category',
  'price',
  'stock',
  'storage',
  'color',
  'colorHex',
  'lowStockThreshold',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_IMPORT_FIELDS: ImportField[] = ['sku'];

export type ImportMapping = Partial<Record<ImportField, number>>;

const normalise = (h: string) => h.toLowerCase().replace(/[\s_\-.]/g, '');

const ALIASES: Record<ImportField, string[]> = {
  sku: ['sku', 'variantsku', 'code', 'كود', 'رمز'],
  productSlug: ['productslug', 'slug', 'product', 'handle', 'المنتج'],
  nameEn: ['nameen', 'name', 'englishname', 'productname', 'title'],
  nameAr: ['namear', 'arabicname', 'الاسم', 'اسمالمنتج'],
  brand: ['brand', 'brandslug', 'الماركة', 'العلامة'],
  category: ['category', 'categoryslug', 'القسم', 'الفئة'],
  price: ['price', 'priceegp', 'السعر'],
  stock: ['stock', 'quantity', 'qty', 'الكمية', 'المخزون'],
  storage: ['storage', 'capacity', 'السعة'],
  color: ['color', 'colour', 'اللون'],
  colorHex: ['colorhex', 'hex', 'swatch'],
  lowStockThreshold: ['lowstockthreshold', 'lowstock', 'threshold', 'حدالتنبيه'],
};

/** Suggest a mapping from header names (each column used at most once). */
export function autoMap(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && ALIASES[field].includes(normalise(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

export interface MappedImport {
  rows: Partial<Record<ImportField, string>>[];
  truncated: boolean;
}

/** Apply a column mapping. Values stay strings; nothing is evaluated or coerced here. */
export function applyMapping(parsed: ParsedCsv, mapping: ImportMapping): MappedImport {
  const rows = parsed.rows.slice(0, MAX_IMPORT_ROWS).map((cells) => {
    const out: Partial<Record<ImportField, string>> = {};
    for (const field of IMPORT_FIELDS) {
      const idx = mapping[field];
      if (idx === undefined) continue;
      const value = cells[idx] ?? '';
      if (value !== '') out[field] = value;
    }
    return out;
  });
  return { rows, truncated: parsed.rows.length > MAX_IMPORT_ROWS };
}

export function missingRequired(mapping: ImportMapping): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((f) => mapping[f] === undefined);
}

/** A ready-to-fill template (header row only) so staff start from the supported columns. */
export const IMPORT_TEMPLATE_COLUMNS: readonly ImportField[] = IMPORT_FIELDS;
