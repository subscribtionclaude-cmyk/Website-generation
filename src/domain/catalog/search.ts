/**
 * Search text normalisation shared by the demo engine and (mirrored in SQL by app.normalize_search)
 * the database: lower-case, Arabic letter variants unified (أ/إ/آ/ٱ→ا, ى→ي, ة→ه), diacritics and
 * tatweel removed, Arabic-Indic digits → Latin, punctuation → spaces.
 */
const cp = (code: number) => String.fromCharCode(code);

const DIACRITICS = new RegExp(`[${cp(0x064b)}-${cp(0x0652)}${cp(0x0670)}${cp(0x0640)}]`, 'g');
const ALEF_VARIANTS = new RegExp(`[${cp(0x0623)}${cp(0x0625)}${cp(0x0622)}${cp(0x0671)}]`, 'g');
const ALEF = cp(0x0627);
const ALEF_MAKSURA = new RegExp(cp(0x0649), 'g');
const YEH = cp(0x064a);
const TEH_MARBUTA = new RegExp(cp(0x0629), 'g');
const HEH = cp(0x0647);
const ARABIC_DIGITS = new RegExp(`[${cp(0x0660)}-${cp(0x0669)}]`, 'g');

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(ALEF_VARIANTS, ALEF)
    .replace(ALEF_MAKSURA, YEH)
    .replace(TEH_MARBUTA, HEH)
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function searchTokens(query: string): string[] {
  return normalizeSearchText(query)
    .split(' ')
    .filter((token) => token.length > 0)
    .slice(0, 8);
}
