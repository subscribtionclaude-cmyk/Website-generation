import { describe, expect, it } from 'vitest';
import { normalizeIntl as clean } from '@/test/intl';
import {
  formatClockTime,
  formatWeekday,
  getTimeZoneOffsetMinutes,
  getZonedParts,
  zonedDateTimeToUtc,
} from './zoned';

describe('Cairo timezone helpers', () => {
  it('applies Egyptian DST: UTC+2 in winter, UTC+3 in summer', () => {
    expect(getTimeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'))).toBe(120);
    expect(getTimeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'))).toBe(180);
  });

  it('reads wall-clock parts in Cairo', () => {
    // 2026-09-24 22:30 UTC = Friday 01:30 in Cairo (UTC+3)
    expect(getZonedParts(new Date('2026-09-24T22:30:00Z'))).toMatchObject({
      year: 2026,
      month: 9,
      day: 25,
      hour: 1,
      minute: 30,
      weekday: 5,
    });
  });

  it('converts Cairo wall-clock times to UTC instants', () => {
    expect(
      zonedDateTimeToUtc({ year: 2026, month: 10, day: 31, hour: 23, minute: 59 }).toISOString(),
    ).toBe('2026-10-31T21:59:00.000Z');
    expect(zonedDateTimeToUtc({ year: 2026, month: 1, day: 1 }).toISOString()).toBe(
      '2025-12-31T22:00:00.000Z',
    );
  });

  it('formats clock times and weekdays per locale', () => {
    expect(clean(formatClockTime('00:00', { locale: 'en', numerals: 'latn' }))).toBe('12:00 AM');
    expect(clean(formatClockTime('13:00', { locale: 'en', numerals: 'latn' }))).toBe('1:00 PM');
    expect(clean(formatClockTime('13:00', { locale: 'ar', numerals: 'latn' }))).toBe('1:00 م');
    expect(formatWeekday(6, { locale: 'ar', numerals: 'latn' })).toBe('السبت');
    expect(formatWeekday(5, { locale: 'en', numerals: 'latn' })).toBe('Friday');
  });
});
