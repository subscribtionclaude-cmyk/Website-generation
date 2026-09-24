import { z } from 'zod';
import { FALLBACK_LOCALE, type Locale } from '@/i18n/config';

/**
 * Bilingual content value, mirrored by the `public.localized_text` Postgres domain:
 * `{ "ar": "…", "en": "…" }` — Arabic is required (default + fallback), English optional.
 */
export interface LocalizedText {
  ar: string;
  en?: string | undefined;
}

export const localizedTextSchema = z.strictObject({
  ar: z.string().trim().min(1),
  en: z.string().trim().optional(),
});

/** Resolve for display: requested locale → Arabic fallback. Blank translations count as missing. */
export function resolveLocalized(value: LocalizedText | null | undefined, locale: Locale): string {
  if (!value) return '';
  const requested = value[locale]?.trim();
  if (requested) return requested;
  return value[FALLBACK_LOCALE]?.trim() ?? '';
}

export function hasTranslation(value: LocalizedText | null | undefined, locale: Locale): boolean {
  return Boolean(value?.[locale]?.trim());
}
