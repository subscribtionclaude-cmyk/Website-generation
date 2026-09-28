import type { SectionProps, SectionType } from '@/domain/content/sections';
import type { LocalizedText } from '@/domain/localized';
import type { EditablePage, LayoutSection } from './schemas';

/**
 * Starting props for "Add section". Text is a visible placeholder staff replace in the editor (it is
 * never published silently: the preview shows it and publishing is an explicit step). References
 * (campaign, brand, category, trust item) come from the store's own data — never invented.
 */
export interface SectionRefs {
  campaignSlugs: string[];
  brandSlugs: string[];
  categorySlugs: string[];
  trustItemIds: string[];
}

const text = (ar: string, en: string): LocalizedText => ({ ar, en });
const TITLE = text('عنوان القسم', 'Section title');

type Defaults = { [T in SectionType]: (refs: SectionRefs) => SectionProps<T> | null };

const DEFAULTS: Defaults = {
  hero_campaign: (r) =>
    r.campaignSlugs[0]
      ? { campaignSlug: r.campaignSlugs[0], teaserSlug: null, tone: 'dark' }
      : null,
  product_rail: () => ({
    eyebrow: null,
    title: TITLE,
    subtitle: null,
    source: { kind: 'featured' },
    limit: 4,
    layout: 'grid',
    cta: null,
  }),
  offer_rail: () => ({
    eyebrow: null,
    title: TITLE,
    subtitle: null,
    featuredOnly: false,
    filter: null,
    limit: 4,
    cta: null,
  }),
  offer_group: () => ({
    anchor: 'offers-group',
    title: TITLE,
    subtitle: null,
    filter: { kinds: ['limited_time'] },
  }),
  category_grid: () => ({
    title: text('تسوّق حسب القسم', 'Shop by category'),
    subtitle: null,
    limit: 8,
  }),
  brand_lines: (r) =>
    r.brandSlugs[0] && r.categorySlugs[0]
      ? {
          brandSlug: r.brandSlugs[0],
          eyebrow: null,
          title: TITLE,
          subtitle: null,
          lines: [
            { label: text('القسم', 'Category'), categorySlug: r.categorySlugs[0], icon: 'phone' },
          ],
          cta: null,
        }
      : null,
  budget_search: () => ({ title: text('ميزانيتك كام؟', 'What’s your budget?'), subtitle: null }),
  promo_banner: () => ({
    tone: 'light',
    illustration: 'none',
    eyebrow: null,
    title: TITLE,
    body: null,
    points: [],
    cta: { label: text('اعرف أكتر', 'Learn more'), href: '/store' },
    secondaryCta: null,
  }),
  coming_soon: () => ({ title: text('قريبًا', 'Coming soon'), subtitle: null, limit: 3 }),
  content_rail: () => ({
    title: text('أخبار MALEK', 'Malek updates'),
    subtitle: null,
    types: ['news'],
    limit: 3,
    cta: null,
  }),
  trust_strip: () => ({ title: null, itemIds: null }),
  trust_feature: (r) => (r.trustItemIds[0] ? { itemId: r.trustItemIds[0], eyebrow: null } : null),
  branch_contact: () => ({ title: text('زورنا في الفرع', 'Visit our branch'), subtitle: null }),
  media_banner: () => ({
    eyebrow: null,
    title: TITLE,
    body: null,
    images: [
      { url: '/brand/malek-store-logo.png', alt: text('شعار MALEK STORE', 'MALEK STORE logo') },
    ],
    layout: 'split',
    tone: 'light',
    cta: null,
  }),
};

/** Section types staff can add to each page (the page renderers support all of them). */
export const ADDABLE_TYPES: Record<EditablePage, SectionType[]> = {
  home: [
    'hero_campaign',
    'product_rail',
    'offer_rail',
    'category_grid',
    'brand_lines',
    'budget_search',
    'promo_banner',
    'media_banner',
    'coming_soon',
    'content_rail',
    'trust_strip',
    'trust_feature',
    'branch_contact',
  ],
  apple: [
    'hero_campaign',
    'brand_lines',
    'trust_feature',
    'product_rail',
    'offer_rail',
    'promo_banner',
    'media_banner',
    'category_grid',
    'trust_strip',
  ],
  offers: ['offer_group', 'offer_rail', 'promo_banner', 'media_banner', 'product_rail'],
};

export function defaultSectionProps(type: SectionType, refs: SectionRefs) {
  return DEFAULTS[type](refs) as Record<string, unknown> | null;
}

export function newSection(
  type: SectionType,
  key: string,
  refs: SectionRefs,
): LayoutSection | null {
  const props = defaultSectionProps(type, refs);
  if (!props) return null;
  if (type === 'offer_group') props.anchor = key;
  return { key, type, isVisible: true, props, design: {} };
}
