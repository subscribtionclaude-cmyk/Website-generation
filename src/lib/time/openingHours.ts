import { BUSINESS_TIME_ZONE, getZonedParts, type Weekday } from './zoned';

/**
 * Opening-hours rule in business (Cairo) wall-clock time.
 * `close` <= `open` means the shift ends the NEXT day (e.g. 12:00 → 00:00, 13:00 → 01:00).
 * `open === close` means open 24 hours.
 */
export interface OpeningHoursRule {
  days: Weekday[];
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export interface OpenStatus {
  isOpen: boolean;
  /** Next moment the status flips (closing time if open, opening time if closed). */
  nextChange: {
    time: string; // "HH:MM" wall clock
    weekday: Weekday;
    /** Whole days from "today" in Cairo: 0 = today, 1 = tomorrow … */
    dayOffset: number;
  } | null;
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidClockTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function toMinutes(hhmm: string): number {
  const match = TIME_PATTERN.exec(hhmm);
  if (!match) throw new Error(`Invalid time "${hhmm}" (expected HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function toClock(minuteOfDay: number): string {
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface WeeklyInterval {
  start: number; // minute of week (0 = Sunday 00:00)
  duration: number; // minutes, 1 … 1440
}

function toIntervals(rules: readonly OpeningHoursRule[]): WeeklyInterval[] {
  const intervals: WeeklyInterval[] = [];
  for (const rule of rules) {
    const open = toMinutes(rule.open);
    let duration = toMinutes(rule.close) - open;
    if (duration <= 0) duration += MINUTES_PER_DAY;
    for (const day of new Set(rule.days)) {
      intervals.push({ start: day * MINUTES_PER_DAY + open, duration });
    }
  }
  return intervals;
}

const mod = (value: number, base: number) => ((value % base) + base) % base;

/** Is the store open at `now` (evaluated in Cairo time), and when does that change? */
export function getOpenStatus(
  rules: readonly OpeningHoursRule[],
  now: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): OpenStatus {
  const intervals = toIntervals(rules);
  if (intervals.length === 0) return { isOpen: false, nextChange: null };

  const parts = getZonedParts(now, timeZone);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const nowMinute = parts.weekday * MINUTES_PER_DAY + minuteOfDay;

  // Currently open: pick the interval that keeps us open the longest (handles overlaps).
  let minutesUntilClose = -1;
  for (const interval of intervals) {
    const elapsed = mod(nowMinute - interval.start, MINUTES_PER_WEEK);
    if (elapsed < interval.duration) {
      minutesUntilClose = Math.max(minutesUntilClose, interval.duration - elapsed);
    }
  }

  const describe = (minutesAhead: number): OpenStatus['nextChange'] => {
    const target = nowMinute + minutesAhead;
    return {
      time: toClock(target),
      weekday: Math.floor(mod(target, MINUTES_PER_WEEK) / MINUTES_PER_DAY) as Weekday,
      dayOffset: Math.floor((minuteOfDay + minutesAhead) / MINUTES_PER_DAY),
    };
  };

  if (minutesUntilClose > 0) {
    // 24/7 schedules never close.
    if (minutesUntilClose >= MINUTES_PER_WEEK) return { isOpen: true, nextChange: null };
    return { isOpen: true, nextChange: describe(minutesUntilClose) };
  }

  let minutesUntilOpen = Number.POSITIVE_INFINITY;
  for (const interval of intervals) {
    minutesUntilOpen = Math.min(
      minutesUntilOpen,
      mod(interval.start - nowMinute, MINUTES_PER_WEEK),
    );
  }
  return { isOpen: false, nextChange: describe(minutesUntilOpen) };
}

export interface OpeningHoursGroup {
  days: Weekday[]; // consecutive days in display order
  open: string;
  close: string;
}

/**
 * Collapse the weekly schedule into display rows, e.g.
 *   Saturday – Thursday: 12:00 PM – 12:00 AM
 *   Friday: 1:00 PM – 1:00 AM
 * Days are ordered from `weekStartsOn` (Saturday for Egypt). Closed days are omitted.
 */
export function groupOpeningHours(
  rules: readonly OpeningHoursRule[],
  weekStartsOn: Weekday = 6,
): OpeningHoursGroup[] {
  const byDay = new Map<Weekday, { open: string; close: string }>();
  for (const rule of rules) {
    for (const day of rule.days) byDay.set(day, { open: rule.open, close: rule.close });
  }

  const groups: OpeningHoursGroup[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = ((weekStartsOn + i) % 7) as Weekday;
    const hours = byDay.get(day);
    const last = groups.at(-1);
    const lastDay = last?.days.at(-1);
    const isConsecutive = lastDay !== undefined && (lastDay + 1) % 7 === day;
    if (!hours) continue;
    if (last && isConsecutive && last.open === hours.open && last.close === hours.close) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], open: hours.open, close: hours.close });
    }
  }
  return groups;
}
