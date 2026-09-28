import { useQuery } from '@tanstack/react-query';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import type { SectionRefs } from '@/domain/siteEditor/defaults';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';

interface Choice {
  value: string;
  label: string;
}

/**
 * Reference choices for section fields, read from the PUBLIC storefront data (the same published
 * brands, categories, offers, campaigns and trust items the storefront renders). Nothing here needs
 * catalog permissions, and nothing is invented: an empty list simply means "type a value".
 */
export function useReferences(trustItems: { id: string; title: LocalizedText }[]) {
  const { repositories } = useRuntime();
  const { locale } = useI18n();
  const opts = { staleTime: 60_000, retry: false } as const;
  const brands = useQuery({
    queryKey: ['public', 'brands'],
    queryFn: () => repositories.catalog.listBrands(),
    ...opts,
  });
  const categories = useQuery({
    queryKey: ['public', 'categories'],
    queryFn: () => repositories.catalog.listCategories(),
    ...opts,
  });
  const offers = useQuery({
    queryKey: ['public', 'offers'],
    queryFn: () => repositories.content.listOffers(),
    ...opts,
  });
  const entries = useQuery({
    queryKey: ['public', 'entries', {}],
    queryFn: () => repositories.content.listEntries({}),
    ...opts,
  });

  const name = (v: LocalizedText, slug: string) => `${resolveLocalized(v, locale)} · ${slug}`;
  const brandChoices: Choice[] = (brands.data ?? []).map((b) => ({
    value: b.slug,
    label: name(b.name, b.slug),
  }));
  const categoryChoices: Choice[] = (categories.data ?? []).map((c) => ({
    value: c.slug,
    label: name(c.name, c.slug),
  }));
  const offerChoices: Choice[] = (offers.data ?? []).map((o) => ({
    value: o.slug,
    label: name(o.title, o.slug),
  }));
  const entryChoices = (types?: string[]): Choice[] =>
    (entries.data ?? [])
      .filter((e) => !types || types.includes(e.type))
      .map((e) => ({ value: e.slug, label: name(e.title, e.slug) }));
  const trustChoices: Choice[] = trustItems.map((t) => ({
    value: t.id,
    label: name(t.title, t.id),
  }));

  const table: Record<string, Choice[]> = {
    'section.campaignSlug': entryChoices(['campaign']),
    'section.teaserSlug': entryChoices(),
    'section.brandSlug': brandChoices,
    'section.source.brands': brandChoices,
    'section.filter.brands': brandChoices,
    'section.source.categories': categoryChoices,
    'section.filter.categories': categoryChoices,
    'section.lines.categorySlug': categoryChoices,
    'section.filter.slugs': offerChoices,
    'section.itemId': trustChoices,
    'section.itemIds': trustChoices,
  };

  const choices = (key: string) => {
    const list = table[key];
    return list && list.length > 0 ? list : undefined;
  };

  const refs: SectionRefs = {
    campaignSlugs: entryChoices(['campaign']).map((c) => c.value),
    brandSlugs: brandChoices.map((c) => c.value),
    categorySlugs: categoryChoices.map((c) => c.value),
    trustItemIds: trustChoices.map((c) => c.value),
  };

  const entryTitle = (slug: string) => {
    const entry = entries.data?.find((e) => e.slug === slug);
    return entry ? resolveLocalized(entry.title, locale) : null;
  };

  return { choices, refs, entryTitle };
}
