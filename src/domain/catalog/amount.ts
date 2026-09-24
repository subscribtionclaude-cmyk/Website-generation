/**
 * Parse a customer-entered EGP amount. Accepts Latin or Arabic-Indic digits and ignores thousands
 * separators/spaces. Returns null for empty input and NaN for anything invalid.
 */
export function parseAmount(raw: string): number | null {
  const western = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\u066C\s]/g, '');
  if (western === '') return null;
  if (!/^\d+(\.\d+)?$/.test(western)) return NaN;
  return Math.round(Number(western));
}
