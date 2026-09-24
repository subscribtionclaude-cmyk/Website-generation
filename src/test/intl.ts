/**
 * Intl output contains invisible bidi marks (U+200E/U+200F/U+061C) in Arabic and no-break spaces
 * (U+00A0/U+202F) around currency codes and AM/PM so prices and times never wrap.
 * Normalise both for readable test assertions.
 */
export function normalizeIntl(value: string): string {
  return value.replace(/[\u200e\u200f\u061c]/g, '').replace(/[\u00a0\u202f]/g, ' ');
}
