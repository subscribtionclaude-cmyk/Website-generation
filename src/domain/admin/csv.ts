/**
 * Dependency-free CSV for admin import/export (Excel "CSV UTF-8" compatible).
 *
 * Security: imported files are untrusted text. Cells are never evaluated — a value such as
 * `=HYPERLINK(...)` is just a string the server validates. Exported cells that a spreadsheet
 * would treat as a formula (leading = + - @, tab or carriage return) are neutralised with a
 * leading apostrophe (OWASP CSV injection guidance). Real numbers are written as numbers.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
const MAX_CELL_LENGTH = 2000;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: ',' | ';' | '\t';
}

/** Pick the delimiter that splits the header line into the most columns (outside quotes). */
function detectDelimiter(text: string): ParsedCsv['delimiter'] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best: ParsedCsv['delimiter'] = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t'] as const) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Strip control characters (except tab/newline inside quoted cells), trim and cap length. */
export function sanitizeCell(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const control = (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    if (!control) out += ch;
  }
  return out.trim().slice(0, MAX_CELL_LENGTH);
}

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF, BOM). Blank lines are skipped. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  const clean = records.map((r) => r.map(sanitizeCell)).filter((r) => r.some((c) => c !== ''));
  const [headers = [], ...rows] = clean;
  return { headers, rows, delimiter };
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralise one exported cell and quote it when needed. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",;\r\n\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document (BOM + CRLF so Excel opens Arabic text correctly). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Flatten nested export rows ({ name: { ar, en } } → name.ar, name.en) for spreadsheets. */
export function flattenRow(row: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenRow(value as Record<string, unknown>, name));
    } else out[name] = value;
  }
  return out;
}

/** Trigger a browser download for generated text (no server round-trip, no third party). */
export function downloadText(
  fileName: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
