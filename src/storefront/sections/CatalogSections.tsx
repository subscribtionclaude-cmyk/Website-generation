import { ArrowRight, CircleCheck, RefreshCcw, Smartphone, Wrench } from 'lucide-react';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { BudgetSearch } from '../components/BudgetSearch';
import { DataIcon } from '../components/icons';
import { SectionHeading } from '../components/SectionHeading';
import { useCategories } from '../data/hooks';
import contentStyles from '../components/content.module.css';
import styles from './sections.module.css';

/** "Shop by category": dynamic categories flagged showInCategoryGrid (no hard-coded list). */
export function CategoryGrid({ id, props }: { id: string; props: SectionProps<'category_grid'> }) {
  const { locale, t, format } = useI18n();
  const { data } = useCategories();
  const categories = (data ?? [])
    .filter((c) => c.showInCategoryGrid && c.parentSlug === null)
    .slice(0, props.limit);
  if (categories.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
      />
      <ul className={`${contentStyles.tiles} ${contentStyles.tilesWide}`}>
        {categories.map((category) => (
          <li key={category.slug}>
            <LocaleLink to={`/category/${category.slug}`} className={contentStyles.tile}>
              <span className={contentStyles.tileIcon}>
                <DataIcon name={category.icon} />
              </span>
              {resolveLocalized(category.name, locale)}
              <span className={contentStyles.tileCount}>
                {t('catalog.productCount', { count: format.number(category.productCount) })}
              </span>
            </LocaleLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Brand line-up (e.g. Apple: iPhone, Mac, iPad …) linking to brand × category listings. */
export function BrandLines({ id, props }: { id: string; props: SectionProps<'brand_lines'> }) {
  const { locale } = useI18n();
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        eyebrow={props.eyebrow ? resolveLocalized(props.eyebrow, locale) : null}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
        link={
          props.cta
            ? { label: resolveLocalized(props.cta.label, locale), href: props.cta.href }
            : null
        }
      />
      <ul className={styles.lines}>
        {props.lines.map((line) => (
          <li key={`${line.categorySlug}-${line.icon}`}>
            <LocaleLink
              to={`/brand/${props.brandSlug}?category=${line.categorySlug}`}
              className={styles.line}
            >
              <DataIcon name={line.icon} />
              {resolveLocalized(line.label, locale)}
            </LocaleLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BudgetSection({ id, props }: { id: string; props: SectionProps<'budget_search'> }) {
  const { locale } = useI18n();
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <BudgetSearch
        headingId={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
      />
    </section>
  );
}

const TONE = {
  dark: styles.promoDark,
  brand: styles.promoBrand,
  light: styles.promoLight,
} as const;

/** Trade-in / repairs promo. Illustration is icon-based (no fabricated imagery or claims). */
export function PromoBanner({ id, props }: { id: string; props: SectionProps<'promo_banner'> }) {
  const { locale } = useI18n();
  const headingId = `${id}-title`;
  const onDark = props.tone === 'dark';
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <div className={`${styles.promo} ${TONE[props.tone]}`}>
        <div className={styles.promoCopy}>
          {props.eyebrow && (
            <p className={styles.promoEyebrow}>{resolveLocalized(props.eyebrow, locale)}</p>
          )}
          <h2 id={headingId} className={styles.promoTitle}>
            {resolveLocalized(props.title, locale)}
          </h2>
          {props.body && <p className={styles.promoBody}>{resolveLocalized(props.body, locale)}</p>}
          {props.points.length > 0 && (
            <ul className={styles.promoPoints}>
              {props.points.map((point, index) => (
                <li key={index}>
                  <CircleCheck aria-hidden="true" />
                  {resolveLocalized(point, locale)}
                </li>
              ))}
            </ul>
          )}
          <div className={styles.promoActions}>
            <ButtonLink
              to={props.cta.href}
              variant={props.tone === 'brand' ? 'primary' : 'accent'}
              size="lg"
            >
              {resolveLocalized(props.cta.label, locale)}
            </ButtonLink>
            {props.secondaryCta && (
              <ButtonLink
                to={props.secondaryCta.href}
                variant={onDark ? 'inverse' : 'secondary'}
                size="lg"
              >
                {resolveLocalized(props.secondaryCta.label, locale)}
              </ButtonLink>
            )}
          </div>
        </div>
        {props.illustration !== 'none' && (
          <div className={styles.promoArt} aria-hidden="true">
            {props.illustration === 'trade_in' ? (
              <>
                <span className={styles.promoArtIcon}>
                  <Smartphone />
                </span>
                <RefreshCcw className={styles.promoArrow} />
                <span className={styles.promoArtIcon}>
                  <Smartphone />
                </span>
              </>
            ) : (
              <>
                <span className={styles.promoArtIcon}>
                  <Smartphone />
                </span>
                <ArrowRight className={`${styles.promoArrow} flip-rtl`} />
                <span className={styles.promoArtIcon}>
                  <Wrench />
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
