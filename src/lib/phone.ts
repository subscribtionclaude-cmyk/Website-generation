/**
 * Egyptian phone helpers. Numbers are stored as entered by staff and normalized to E.164 for links.
 *  Mobile:   01[0125]XXXXXXXX  → +201XXXXXXXXX
 *  Landline: 0 + area code + subscriber (e.g. 02XXXXXXXX) → +20…
 *  Hotlines: 5-digit short codes (e.g. 19xxx) → dialable as-is, not E.164.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const index = ARABIC_INDIC.indexOf(digit);
    return String(index >= 0 ? index : EXTENDED_ARABIC_INDIC.indexOf(digit));
  });
}

function compact(value: string): string {
  return toLatinDigits(value).replace(/[\s\-().]/g, '');
}

/** Returns an E.164 string (e.g. "+201212004229") or null if the input isn't a valid Egyptian number. */
export function normalizeEgyptianPhone(input: string): string | null {
  const value = compact(input);
  let national: string;
  if (value.startsWith('+20')) national = value.slice(3);
  else if (value.startsWith('0020')) national = value.slice(4);
  else if (/^20\d{10}$/.test(value)) national = value.slice(2);
  else if (value.startsWith('0')) national = value.slice(1);
  else return null;

  if (national.startsWith('0')) return null;
  if (/^1[0125]\d{8}$/.test(national)) return `+20${national}`; // mobile
  if (/^[2-9]\d{7,8}$/.test(national)) return `+20${national}`; // landline
  return null;
}

export function isHotline(input: string): boolean {
  return /^\d{5}$/.test(compact(input));
}

export function isEgyptianMobile(input: string): boolean {
  const e164 = normalizeEgyptianPhone(input);
  return e164 !== null && /^\+201[0125]\d{8}$/.test(e164);
}

/** Any number staff may configure: a valid Egyptian number or a 5-digit hotline. */
export function isDialablePhone(input: string): boolean {
  return normalizeEgyptianPhone(input) !== null || isHotline(input);
}

/** `tel:` link target. Falls back to digits-only for hotlines; returns null when not dialable. */
export function toTelHref(input: string): string | null {
  const e164 = normalizeEgyptianPhone(input);
  if (e164) return `tel:${e164}`;
  if (isHotline(input)) return `tel:${compact(input)}`;
  return null;
}
