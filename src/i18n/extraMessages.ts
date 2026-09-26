import type { Locale } from './config';

/**
 * Dictionaries registered by lazily loaded feature chunks (e.g. the Phase 05 service pages) so
 * their strings stay out of the storefront entry chunk. The translator reads these live arrays
 * at call time, after the core dictionary and before the Arabic fallback.
 */
export const EXTRA_MESSAGES: Record<Locale, object[]> = { ar: [], en: [] };

export function registerMessages(dictionaries: Record<Locale, object>): void {
  for (const locale of Object.keys(dictionaries) as Locale[]) {
    const tree = dictionaries[locale];
    if (!EXTRA_MESSAGES[locale].includes(tree)) EXTRA_MESSAGES[locale].push(tree);
  }
}
