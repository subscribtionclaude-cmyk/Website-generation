import type { OptionValue } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import styles from './catalog.module.css';

/** Compact colour indicator for cards (names are announced to screen readers). */
export function ColorSwatches({ colors, max = 5 }: { colors: OptionValue[]; max?: number }) {
  const { t, locale } = useI18n();
  if (colors.length === 0) return null;
  const shown = colors.slice(0, max);
  const names = colors.map((c) => resolveLocalized(c.label, locale)).join('، ');
  return (
    <div className={styles.swatches}>
      <span className="visually-hidden">
        {t('catalog.colorsCount', { count: colors.length })}: {names}
      </span>
      {shown.map((c) => (
        <span
          key={c.key}
          className={styles.swatch}
          style={{ background: c.hex ?? '#ccc' }}
          aria-hidden="true"
        />
      ))}
      {colors.length > max && (
        <span className={styles.swatchMore} aria-hidden="true">
          {t('catalog.moreColors', { count: colors.length - max })}
        </span>
      )}
    </div>
  );
}
