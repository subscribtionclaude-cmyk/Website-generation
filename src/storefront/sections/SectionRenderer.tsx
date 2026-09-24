import type { ComponentType, ReactNode } from 'react';
import { resolveSections, type ResolvedSection, type SectionType } from '@/domain/content/sections';
import { useI18n } from '@/i18n/context';
import { usePageSections } from '../data/hooks';
import { BrandLines, BudgetSection, CategoryGrid, PromoBanner } from './CatalogSections';
import { HeroCampaign } from './HeroCampaign';
import {
  BranchContact,
  ComingSoonSection,
  ContentRail,
  TrustFeature,
  TrustStrip,
} from './InfoSections';
import { OfferGroup, OfferRail } from './OfferSections';
import { ProductRail } from './ProductRail';
import styles from './sections.module.css';

type SectionComponent<T extends SectionType> = ComponentType<{
  id: string;
  props: Extract<ResolvedSection, { type: T }>['props'];
  level: 1 | 2;
}>;

/**
 * Section registry: section type → component. The same type keys and zod prop schemas
 * (domain/content/sections.ts) are what the Phase 07 Site Editor edits.
 */
const SECTION_COMPONENTS: { [T in SectionType]: SectionComponent<T> } = {
  hero_campaign: HeroCampaign,
  product_rail: ProductRail,
  offer_rail: OfferRail,
  offer_group: OfferGroup,
  category_grid: CategoryGrid,
  brand_lines: BrandLines,
  budget_search: BudgetSection,
  promo_banner: PromoBanner,
  coming_soon: ComingSoonSection,
  content_rail: ContentRail,
  trust_strip: TrustStrip,
  trust_feature: TrustFeature,
  branch_contact: BranchContact,
};

function reportInvalid(id: string, reason: string) {
  if (import.meta.env.DEV) console.warn(`[sections] skipped ${id}: ${reason}`);
}

export function RenderSections({
  sections,
  heroIsPageHeading = true,
}: {
  sections: ResolvedSection[];
  /** The first hero section carries the page's h1 (false when the page renders its own h1). */
  heroIsPageHeading?: boolean;
}) {
  return (
    <>
      {sections.map((section, index) => {
        const Component = SECTION_COMPONENTS[section.type] as SectionComponent<typeof section.type>;
        const level = heroIsPageHeading && index === 0 && section.type === 'hero_campaign' ? 1 : 2;
        return (
          <Component key={section.id} id={`s-${section.id}`} props={section.props} level={level} />
        );
      })}
    </>
  );
}

/**
 * Renders a CMS page. `header` is rendered when the first section isn't a hero (the page's own
 * heading), `fallback` when sections can't be loaded (live mode shows an error, never demo data).
 */
export function SectionPage({
  pageKey,
  header,
  fallback,
  headerAlways = false,
}: {
  pageKey: string;
  header?: ReactNode;
  fallback: ReactNode;
  /** Always render `header` (with the page h1) — the hero then uses h2. */
  headerAlways?: boolean;
}) {
  const { t } = useI18n();
  const { data, isPending, isError } = usePageSections(pageKey);
  if (isPending)
    return <div className={styles.section} aria-busy="true" aria-label={t('common.loading')} />;
  if (isError) return <>{fallback}</>;
  const sections = resolveSections(data, reportInvalid);
  if (sections.length === 0) return <>{fallback}</>;
  const hasHero = sections[0]?.type === 'hero_campaign';
  return (
    <>
      {(headerAlways || !hasHero) && header}
      <RenderSections sections={sections} heroIsPageHeading={!headerAlways} />
    </>
  );
}
