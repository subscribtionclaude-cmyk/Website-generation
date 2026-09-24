import { describe, expect, it } from 'vitest';
import { getOpenStatus, groupOpeningHours, type OpeningHoursRule } from './openingHours';
import { zonedDateTimeToUtc } from './zoned';

// MALEK STORE Abbasseya: Sat–Thu 12:00 PM → 12:00 AM, Friday 1:00 PM → 1:00 AM (Cairo time).
const HOURS: OpeningHoursRule[] = [
  { days: [6, 0, 1, 2, 3, 4], open: '12:00', close: '00:00' },
  { days: [5], open: '13:00', close: '01:00' },
];

/** Build an instant from Cairo wall-clock time. 2026-09-24 is a Thursday. */
const cairo = (day: number, hour: number, minute = 0) =>
  zonedDateTimeToUtc({ year: 2026, month: 9, day, hour, minute });

describe('getOpenStatus', () => {
  it('is open on a weekday afternoon and closes at midnight', () => {
    expect(getOpenStatus(HOURS, cairo(24, 15))).toEqual({
      isOpen: true,
      nextChange: { time: '00:00', weekday: 5, dayOffset: 1 },
    });
  });

  it('is closed on Thursday morning and opens today at noon', () => {
    expect(getOpenStatus(HOURS, cairo(24, 9, 30))).toEqual({
      isOpen: false,
      nextChange: { time: '12:00', weekday: 4, dayOffset: 0 },
    });
  });

  it('after Thursday midnight it is closed until Friday 1:00 PM', () => {
    expect(getOpenStatus(HOURS, cairo(25, 0, 30))).toEqual({
      isOpen: false,
      nextChange: { time: '13:00', weekday: 5, dayOffset: 0 },
    });
  });

  it("Friday's shift runs past midnight into Saturday (open at Sat 00:30, closes 01:00)", () => {
    expect(getOpenStatus(HOURS, cairo(26, 0, 30))).toEqual({
      isOpen: true,
      nextChange: { time: '01:00', weekday: 6, dayOffset: 0 },
    });
  });

  it('closed at Saturday 02:00 and opens the same day at noon', () => {
    expect(getOpenStatus(HOURS, cairo(26, 2))).toEqual({
      isOpen: false,
      nextChange: { time: '12:00', weekday: 6, dayOffset: 0 },
    });
  });

  it('handles empty and 24h schedules', () => {
    expect(getOpenStatus([], cairo(24, 12))).toEqual({ isOpen: false, nextChange: null });
    const allDay: OpeningHoursRule[] = [
      { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' },
    ];
    expect(getOpenStatus(allDay, cairo(24, 3)).isOpen).toBe(true);
  });

  it('rejects malformed times', () => {
    expect(() =>
      getOpenStatus([{ days: [1], open: '25:00', close: '10:00' }], cairo(24, 3)),
    ).toThrow();
  });
});

describe('groupOpeningHours', () => {
  it('groups consecutive days starting Saturday', () => {
    expect(groupOpeningHours(HOURS, 6)).toEqual([
      { days: [6, 0, 1, 2, 3, 4], open: '12:00', close: '00:00' },
      { days: [5], open: '13:00', close: '01:00' },
    ]);
  });

  it('does not merge non-consecutive days with equal hours', () => {
    const rules: OpeningHoursRule[] = [
      { days: [6, 1], open: '10:00', close: '18:00' },
      { days: [0], open: '12:00', close: '18:00' },
    ];
    expect(groupOpeningHours(rules, 6).map((g) => g.days)).toEqual([[6], [0], [1]]);
  });
});
