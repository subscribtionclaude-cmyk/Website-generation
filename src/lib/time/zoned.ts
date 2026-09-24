import { intlLocaleFor, type Locale, type NumeralSystem } from '@/i18n/config';

/**
 * Business timezone. Timestamps are STORED in UTC (timestamptz) and RENDERED in Cairo time
 * for every business-facing view (offers, opening hours, reservations, timelines, reports).
 * Egypt observes DST (UTC+2 winter / UTC+3 summer); all conversions go through the IANA tz database.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Cairo';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday … 6 = Saturday

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  second: number;
  weekday: Weekday;
}

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in the given timezone (Cairo by default). */
export function getZonedParts(date: Date, timeZone: string = BUSINESS_TIME_ZONE): ZonedParts {
  const map: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) map[part.type] = part.value;
  const weekday = WEEKDAY_INDEX[map.weekday ?? ''];
  if (weekday === undefined) throw new Error(`Unexpected weekday from Intl: ${map.weekday}`);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday,
  };
}

/** Offset (minutes) of the timezone from UTC at that instant, e.g. +180 for Cairo in summer. */
export function getTimeZoneOffsetMinutes(
  date: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - instant) / 60_000);
}

export interface WallClockDateTime {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
}

/**
 * Convert a Cairo wall-clock date/time (e.g. an offer that ends "31 Oct 23:59 Cairo") to a UTC instant.
 * Non-existent local times (DST spring-forward gap) resolve forward to the next valid instant.
 */
export function zonedDateTimeToUtc(
  value: WallClockDateTime,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const guess = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour ?? 0,
    value.minute ?? 0,
  );
  const firstOffset = getTimeZoneOffsetMinutes(new Date(guess), timeZone);
  let result = guess - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(result), timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset * 60_000;
  return new Date(result);
}

export interface DateFormatContext {
  locale: Locale;
  numerals: NumeralSystem;
  timeZone?: string;
}

const displayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function displayFormatter(ctx: DateFormatContext, options: Intl.DateTimeFormatOptions) {
  const locale = intlLocaleFor(ctx.locale, ctx.numerals);
  const timeZone = ctx.timeZone ?? BUSINESS_TIME_ZONE;
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let formatter = displayFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    displayFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatDateTime(date: Date | string, ctx: DateFormatContext): string {
  return displayFormatter(ctx, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

export function formatDate(date: Date | string, ctx: DateFormatContext): string {
  return displayFormatter(ctx, { dateStyle: 'medium' }).format(new Date(date));
}

export function formatTime(date: Date | string, ctx: DateFormatContext): string {
  return displayFormatter(ctx, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

/** Format a wall-clock "HH:MM" (e.g. from opening hours) as a localized clock time: "1:00 PM" / "1:00 م". */
export function formatClockTime(hhmm: string, ctx: Omit<DateFormatContext, 'timeZone'>): string {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return displayFormatter(
    { ...ctx, timeZone: 'UTC' },
    { hour: 'numeric', minute: '2-digit' },
  ).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

/** Localized weekday name. 2023-01-01 was a Sunday. */
export function formatWeekday(
  weekday: Weekday,
  ctx: Omit<DateFormatContext, 'timeZone'>,
  style: 'long' | 'short' = 'long',
): string {
  return displayFormatter({ ...ctx, timeZone: 'UTC' }, { weekday: style }).format(
    new Date(Date.UTC(2023, 0, 1 + weekday)),
  );
}
