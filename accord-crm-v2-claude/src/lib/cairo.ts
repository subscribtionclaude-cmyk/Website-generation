// All business-date logic uses Africa/Cairo (never the browser's local zone).
export const TZ = 'Africa/Cairo';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** YYYY-MM-DD of an instant, on the Cairo calendar. */
export function cairoDate(d: Date | string | number = new Date()): string {
  return dateFmt.format(new Date(d));
}
export const cairoToday = (): string => cairoDate(new Date());

/** UTC offset (minutes) of Cairo at a given instant (handles DST). */
export function cairoOffsetMinutes(at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(at);
  const name = p.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 120;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] ?? '0', 10));
}

/** Instant (ISO, UTC) for a Cairo wall-clock date + time. */
export function fromCairo(date: string, time = '00:00'): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = naive - cairoOffsetMinutes(new Date(naive)) * 60000;
  guess = naive - cairoOffsetMinutes(new Date(guess)) * 60000; // second pass settles DST edges
  return new Date(guess);
}
export const cairoDayStart = (date: string): Date => fromCairo(date, '00:00');
export const cairoDayEnd = (date: string): Date => cairoDayStart(addDays(date, 1));

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function dayOfWeek(date: string): number { // 0 = Sunday
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Week = Sunday..Saturday (the ACCORD working week runs Sunday–Thursday). */
export function weekRange(date: string): { from: string; to: string } {
  const from = addDays(date, -dayOfWeek(date));
  return { from, to: addDays(from, 6) };
}
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
export function prevMonthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  return monthRange(`${py}-${String(pm).padStart(2, '0')}-01`);
}

export type RangePreset = 'today' | 'yesterday' | 'this_week' | 'previous_week' | 'this_month' | 'previous_month' | 'custom';
export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today', yesterday: 'Yesterday', this_week: 'This week', previous_week: 'Previous week',
  this_month: 'This month', previous_month: 'Previous month', custom: 'Custom',
};
export function presetRange(p: RangePreset, today = cairoToday()): { from: string; to: string } {
  switch (p) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'this_week': return weekRange(today);
    case 'previous_week': return weekRange(addDays(weekRange(today).from, -1));
    case 'this_month': return monthRange(today);
    case 'previous_month': return prevMonthRange(today);
    default: return { from: today, to: today };
  }
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: iso.length === 10 ? 'UTC' : TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}
export function fmtTime(iso?: string | null): string {
  return iso ? timeFmt.format(new Date(iso)) : '—';
}
export function fmtDateTime(iso?: string | null): string {
  return iso ? `${fmtDate(iso)} · ${fmtTime(iso)}` : '—';
}
export function fmtRelative(iso?: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days}d ago` : fmtDate(iso);
}
export function daysBetween(a: string, b: string): number {
  const pa = a.split('-').map(Number); const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
/** value for <input type="datetime-local"> from an instant, in Cairo. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${cairoDate(d)}T${timeFmt.format(d)}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const [d, t] = v.split('T');
  return fromCairo(d, t || '00:00').toISOString();
}
