// Pure parsing helpers for the legacy "Accord New Data" Google Sheet.
// No Deno / Node APIs here so the same file is unit-tested with vitest and runs in the Edge Function.

export type Cell = string | number | boolean | null | undefined;

export interface ParsedContact { name: string; title: string }
export interface LeadRow {
  row_number: number;
  company: string;
  external_lead_id: string | null;
  emails: string[];
  phones: string[];
  linkedin: string[];
  contacts: ParsedContact[];
  email_sent: boolean | null;
  contacted: boolean | null;
  called: boolean | null;
  status: string | null;
  next_step: string | null;
  last_activity: string | null;
  follow_up_date: string | null;
  notes: string | null;
  extra_notes: string[];
}
export interface ProjectRow {
  row_number: number;
  developer: string;
  project: string;
  attributes: Record<string, string>;
}
export interface ParseResult<T> {
  headerRow: number;
  columns: Record<string, number>;
  rows: T[];
  warnings: { row: number; message: string }[];
}

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00A0]/g;

export function clean(v: Cell): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(INVISIBLE, ' ').replace(/\r/g, '').trim();
}

export function normHeader(h: Cell): string {
  return clean(h).toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

export function parseBool(v: Cell): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = clean(v).toLowerCase();
  if (['true', 'yes', 'y', '1', 'x', '✓'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

/** ISO yyyy-mm-dd, Google serial numbers, or null (ambiguous formats are NOT guessed). */
export function parseDate(v: Cell): string | null | undefined {
  if (v === null || v === undefined || clean(v) === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 20000 || v > 80000) return undefined; // implausible date serial
    const ms = Math.round((v - 25569) * 86400 * 1000); // 25569 = 1970-01-01 in Sheets serials
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = clean(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(`${m[1]}-${m[2]}-${m[3]}`)) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return undefined; // unparseable / ambiguous -> caller records a warning, never invents a date
}

export function parseEmails(v: Cell): string[] {
  const s = clean(v).replace(/\\n/g, '\n');
  const found = s.match(/[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? [];
  return uniq(found.map((e) => e.toLowerCase().replace(/^[.']+|[.']+$/g, '')));
}

export function parsePhones(v: Cell): string[] {
  const s = clean(v).replace(/\\n/g, '\n');
  const out: string[] = [];
  for (const chunk of s.split(/[\n;,/|]+/)) {
    const tokens = chunk.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const digitLen = (t: string) => t.replace(/\D/g, '').length;
    // "0102 5408565 01287777850" -> several numbers only when every token already looks like a full number
    if (tokens.length > 1 && tokens.every((t) => digitLen(t) >= 9)) {
      for (const t of tokens) out.push(normPhone(t));
    } else {
      out.push(normPhone(tokens.join('')));
    }
  }
  return uniq(out.filter((p) => p.replace(/\D/g, '').length >= 7));
}

function normPhone(p: string): string {
  const plus = p.trim().startsWith('+') ? '+' : '';
  return plus + p.replace(/\D/g, '');
}

export function parseLinkedIn(v: Cell): string[] {
  const s = clean(v).replace(/\\n/g, '\n');
  const out: string[] = [];
  const re = /linkedin\.com\/(in|company)\/([^\s?#/\\"'<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(`https://www.linkedin.com/${m[1].toLowerCase()}/${m[2].replace(/%[0-9A-F]{2}.*$/i, '').replace(/\.\.\.$/, '')}`);
  return uniqBy(out, (u) => u.toLowerCase());
}

/** "Name | Title" per line (also copes with several people squeezed onto one line). */
export function parseContacts(v: Cell): ParsedContact[] {
  const s = clean(v).replace(/\\n/g, '\n');
  const people: ParsedContact[] = [];
  for (const rawLine of s.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length <= 2) {
      people.push({ name: collapse(parts[0]), title: collapse(parts[1] ?? '') });
      continue;
    }
    // "A | Title A  B | Title B  C | Title C": titles and next names are separated by 2+ spaces
    let name = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i];
      if (i === parts.length - 1) {
        people.push({ name: collapse(name), title: collapse(seg) });
      } else {
        const idx = seg.search(/\s{2,}(?!.*\s{2,})/);
        if (idx === -1) { people.push({ name: collapse(name), title: collapse(seg) }); name = ''; }
        else { people.push({ name: collapse(name), title: collapse(seg.slice(0, idx)) }); name = seg.slice(idx).trim(); }
      }
    }
  }
  return uniqBy(people.filter((p) => p.name), (p) => p.name.toLowerCase());
}

function collapse(s: string): string { return s.replace(/\s+/g, ' ').trim(); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function uniqBy<T>(a: T[], k: (x: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of a) { const key = k(x); if (!seen.has(key)) { seen.add(key); out.push(x); } }
  return out;
}

export function parseLeadId(v: Cell): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : String(v);
  const s = clean(v);
  if (!s) return null;
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

// --- header detection ------------------------------------------------------------------------
const LEAD_HEADERS: Record<string, string[]> = {
  company: ['company', 'companyname', 'organization', 'organisation', 'account', 'lead', 'leadname'],
  email: ['email', 'emails', 'emailaddress', 'emailaddresses'],
  sent: ['sent', 'emailsent'],
  contact: ['contact', 'contacts', 'contactname', 'contactperson', 'contactpersons'],
  linkedin: ['linkedin', 'linkedinurl', 'linkedinprofile'],
  contacted: ['contacted'],
  phone: ['phoneno', 'phone', 'phonenumber', 'phones', 'mobile', 'tel'],
  called: ['called'],
  status: ['status', 'temperature'],
  next_step: ['nextstep', 'nextsteps'],
  lead_id: ['leadid', 'externalleadid', 'id'],
  last_activity: ['lastactivity', 'lastactivitydate'],
  follow_up_date: ['followupdate', 'followup', 'nextfollowup', 'followupon'],
  notes: ['notes', 'note', 'comments'],
};

export function findHeaderRow(values: Cell[][], mustHave: string[][], maxScan = 10): number {
  for (let i = 0; i < Math.min(values.length, maxScan); i++) {
    const norm = (values[i] ?? []).map(normHeader);
    if (mustHave.every((alts) => alts.some((a) => norm.includes(a)))) return i;
  }
  return -1;
}

export function parseLeadSheet(values: Cell[][]): ParseResult<LeadRow> {
  const warnings: { row: number; message: string }[] = [];
  const h = findHeaderRow(values, [LEAD_HEADERS.company]);
  if (h === -1) throw new Error('Could not find a header row containing "Company"');
  const header = values[h].map(normHeader);
  const columns: Record<string, number> = {};
  for (const [field, alts] of Object.entries(LEAD_HEADERS)) {
    const idx = header.findIndex((x) => alts.includes(x));
    if (idx !== -1) columns[field] = idx;
  }
  const mapped = new Set(Object.values(columns));
  const rows: LeadRow[] = [];
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    // rows with no company whose other cells are empty / unticked checkboxes are formatting leftovers, not data
    const meaningful = (c: Cell) => clean(c) !== '' && c !== false && clean(c).toLowerCase() !== 'false';
    if (!row.some(meaningful)) continue;
    const get = (f: string): Cell => (columns[f] === undefined ? undefined : row[columns[f]]);
    const sheetRow = r + 1;
    const extra: string[] = [];
    row.forEach((c, i) => { if (!mapped.has(i) && clean(c)) extra.push(clean(c)); });
    const la = parseDate(get('last_activity'));
    const fu = parseDate(get('follow_up_date'));
    if (la === undefined) warnings.push({ row: sheetRow, message: `Unrecognised Last Activity date: ${clean(get('last_activity'))}` });
    if (fu === undefined) warnings.push({ row: sheetRow, message: `Unrecognised Follow-up Date: ${clean(get('follow_up_date'))}` });
    rows.push({
      row_number: sheetRow,
      company: collapse(clean(get('company'))),
      external_lead_id: parseLeadId(get('lead_id')),
      emails: parseEmails(get('email')),
      phones: parsePhones(get('phone')),
      linkedin: parseLinkedIn(get('linkedin')),
      contacts: parseContacts(get('contact')),
      email_sent: parseBool(get('sent')),
      contacted: parseBool(get('contacted')),
      called: parseBool(get('called')),
      status: clean(get('status')) || null,
      next_step: collapse(clean(get('next_step'))) || null,
      last_activity: la ?? null,
      follow_up_date: fu ?? null,
      notes: clean(get('notes')) || null,
      extra_notes: extra,
    });
  }
  return { headerRow: h + 1, columns, rows, warnings };
}

export function parseProjectSheet(values: Cell[][]): ParseResult<ProjectRow> {
  const h = findHeaderRow(values, [['developer', 'developers', 'developername'], ['project', 'projects', 'projectname']]);
  if (h === -1) throw new Error('Could not find a header row containing DEVELOPER and PROJECT');
  const header = values[h].map(normHeader);
  const dev = header.findIndex((x) => ['developer', 'developers', 'developername'].includes(x));
  const prj = header.findIndex((x) => ['project', 'projects', 'projectname'].includes(x));
  const rows: ProjectRow[] = [];
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    if (row.every((c) => clean(c) === '')) continue;
    const attributes: Record<string, string> = {};
    // only columns that have a real header are kept (index / constant helper columns are ignored)
    values[h].forEach((hd, i) => {
      if (i !== dev && i !== prj && clean(hd) && clean(row[i])) attributes[clean(hd)] = clean(row[i]);
    });
    rows.push({ row_number: r + 1, developer: collapse(clean(row[dev])), project: collapse(clean(row[prj])), attributes });
  }
  return { headerRow: h + 1, columns: { developer: dev, project: prj }, rows, warnings: [] };
}

export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
