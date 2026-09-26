/** Admin date ranges, computed on Cairo calendar days (the store's business timezone). */
export const STORE_TIME_ZONE = 'Africa/Cairo';
export const RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  preset: RangePreset;
  /** Inclusive start (ISO instant). */
  from: string;
  /** Exclusive end (ISO instant). */
  to: string;
}

/** Offset (minutes east of UTC) of the store timezone at a given instant (handles DST). */
export function tzOffsetMinutes(at: Date, timeZone = STORE_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** "YYYY-MM-DD" of the store calendar day containing `at`. */
export function storeDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIME_ZONE }).format(at);
}

/** Start of a store calendar day ("YYYY-MM-DD") as a UTC instant. */
function dayParts(day: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return [y, m, d];
}

export function storeDayStart(day: string): Date {
  const [y, m, d] = dayParts(day);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const offset = tzOffsetMinutes(guess);
  const first = new Date(guess.getTime() - offset * 60000);
  // Re-check across a DST switch that happens on that day.
  const offset2 = tzOffsetMinutes(first);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60000);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  const today = storeDay(now);
  const span = preset === 'today' ? 0 : preset === '7d' ? 6 : 29;
  return {
    preset,
    from: storeDayStart(addDays(today, -span)).toISOString(),
    to: storeDayStart(addDays(today, 1)).toISOString(),
  };
}

/** Custom range from two store days (inclusive); null when invalid or reversed. */
export function customRange(fromDay: string, toDay: string): DateRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return null;
  if (fromDay > toDay) return null;
  return {
    preset: 'custom',
    from: storeDayStart(fromDay).toISOString(),
    to: storeDayStart(addDays(toDay, 1)).toISOString(),
  };
}
