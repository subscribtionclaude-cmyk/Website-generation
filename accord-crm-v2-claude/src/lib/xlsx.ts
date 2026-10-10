import { zipSync, strToU8 } from 'fflate';

// Minimal, dependency-light XLSX (Office Open XML) writer used by the export features.
// Supports several sheets, a styled header row, title/section rows, frozen header, column widths and
// right-to-left sheets (Arabic). Cells are written as inline strings or numbers — no formulas, no macros.
export type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;
  /** optional title rows printed above the table (e.g. report header) */
  title?: string[];
  header?: string[];
  rows: Cell[][];
  /** extra bold "section" rows, rendered with the section style: index into rows */
  sectionRows?: number[];
  widths?: number[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  // strip characters that are illegal in XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// Excel sheet names: max 31 chars, no []:*?/\
const sheetName = (n: string, used: Set<string>) => {
  let s = n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let k = 2; const base = s; while (used.has(s)) s = `${base.slice(0, 28)} ${k++}`;
  used.add(s); return s;
};

// style ids: 0 normal, 1 header, 2 title, 3 section, 4 wrapped text
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF062D8F"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0A1B3D"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF062D8F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EBD3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><bottom style="thin"><color rgb="FFD4AF37"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="5"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment vertical="center"/></xf><xf fontId="2" applyFont="1"/><xf fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
</styleSheet>`;

function sheetXml(s: Sheet, rtl: boolean): string {
  const rows: string[] = []; let r = 0;
  const cell = (v: Cell, c: number, style = 0) => {
    const ref = `${col(c)}${r + 1}`; const st = style ? ` s="${style}"` : '';
    if (v === null || v === undefined || v === '') return style ? `<c r="${ref}"${st}/>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    const str = String(v); const wrap = !style && (str.length > 60 || str.includes('\n')) ? ' s="4"' : st;
    return `<c r="${ref}"${wrap} t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
  };
  for (const t of s.title ?? []) { rows.push(`<row r="${r + 1}">${cell(t, 0, 2)}</row>`); r++; }
  if (s.title?.length) r++; // blank spacer row
  const headerRow = s.header ? r + 1 : 0;
  if (s.header) { rows.push(`<row r="${r + 1}">${s.header.map((h, i) => cell(h, i, 1)).join('')}</row>`); r++; }
  const sections = new Set(s.sectionRows ?? []);
  s.rows.forEach((row, i) => { rows.push(`<row r="${r + 1}">${row.map((v, c) => cell(v, c, sections.has(i) ? 3 : 0)).join('')}</row>`); r++; });
  const ncol = Math.max(s.header?.length ?? 0, ...s.rows.map((x) => x.length), 1);
  const widths = s.widths ?? Array.from({ length: ncol }, (_, i) => {
    const lens = [s.header?.[i] ?? '', ...s.rows.slice(0, 400).map((x) => (x[i] === null || x[i] === undefined ? '' : String(x[i])))].map((x) => x.length);
    return Math.min(60, Math.max(10, ...lens) + 2);
  });
  const pane = headerRow ? `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}>${pane}</sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData>${headerRow && s.rows.length ? `<autoFilter ref="A${headerRow}:${col(ncol - 1)}${headerRow + s.rows.length}"/>` : ''}</worksheet>`;
}

/** Build an .xlsx file in memory. */
export function buildXlsx(sheets: Sheet[], opts: { rtl?: boolean; title?: string } = {}): Uint8Array {
  const used = new Set<string>(); const names = sheets.map((s) => sheetName(s.name, used));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? 'ACCORD CRM export')}</dc:title><dc:creator>ACCORD CRM</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s, Boolean(opts.rtl))); });
  return zipSync(files, { level: 6 });
}

export function downloadBytes(name: string, bytes: Uint8Array, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
