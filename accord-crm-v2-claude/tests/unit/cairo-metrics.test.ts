import { describe, expect, it } from 'vitest';
import { addDays, cairoDate, cairoDayStart, fromCairo, monthRange, prevMonthRange, presetRange, weekRange, toLocalInput, fromLocalInput } from '../../src/lib/cairo';
import { achievement, applyCall, remaining, responseRate, type CallMetrics } from '../../src/lib/metrics';
import { computeMilestones } from '../../src/lib/milestones';
import { toCsv } from '../../src/lib/csv';

describe('Cairo business calendar', () => {
  it('assigns the business day in Cairo, not UTC', () => {
    // 22:30 UTC on 1 Feb = 00:30 on 2 Feb in Cairo (UTC+2 in winter)
    expect(cairoDate(new Date('2026-02-01T22:30:00Z'))).toBe('2026-02-02');
    expect(cairoDate(new Date('2026-02-01T21:59:59Z'))).toBe('2026-02-01');
  });
  it('handles Egypt daylight saving (UTC+3 in summer)', () => {
    expect(cairoDayStart('2026-07-10').toISOString()).toBe('2026-07-09T21:00:00.000Z');
    expect(cairoDayStart('2026-01-10').toISOString()).toBe('2026-01-09T22:00:00.000Z');
    expect(fromCairo('2026-07-10', '09:30').toISOString()).toBe('2026-07-10T06:30:00.000Z');
  });
  it('date-time-local inputs round-trip through Cairo', () => {
    const iso = fromLocalInput('2026-03-05T14:15')!;
    expect(toLocalInput(iso)).toBe('2026-03-05T14:15');
  });
  it('date arithmetic and ranges', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(weekRange('2026-02-04')).toEqual({ from: '2026-02-01', to: '2026-02-07' }); // Sun..Sat
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(prevMonthRange('2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(presetRange('previous_week', '2026-02-04')).toEqual({ from: '2026-01-25', to: '2026-01-31' });
  });
});

describe('call metrics math', () => {
  it('target 150: 75 calls = 50%, remaining 75; 165 calls = 110%, remaining 0 (never capped)', () => {
    expect(achievement(75, 150)).toBe(50); expect(remaining(75, 150)).toBe(75);
    expect(achievement(165, 150)).toBe(110); expect(remaining(165, 150)).toBe(0);
    expect(achievement(10, 0)).toBeNull();
  });
  it('response rate', () => { expect(responseRate(3, 10)).toBe(30); expect(responseRate(0, 0)).toBeNull(); });
  it('optimistic update keeps totals consistent', () => {
    const base: CallMetrics = { total: 2, responded: 1, did_not_respond: 1, unique_leads: 1, response_rate: 50, target: 4, has_target: true, achievement_pct: 50, remaining: 2 };
    const n = applyCall(base, 'responded', false);
    expect(n).toMatchObject({ total: 3, responded: 2, did_not_respond: 1, unique_leads: 1, remaining: 1, achievement_pct: 75 });
  });
});

describe('milestones never fabricate progress', () => {
  it('a brand-new lead shows nothing done', () => {
    const m = computeMilestones({});
    expect(m.map((x) => x.state)).toEqual(['warn', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });
  it('proposal sent without response = RESPONSE active, DECISION open', () => {
    const m = Object.fromEntries(computeMilestones({ contacts_count: 1, total_calls: 3, responded_calls: 1, meetings_attended: 1, form_status: 'completed', proposal_status: 'sent', proposal_response: 'awaiting_response', pipeline_stage: 'proposal' }).map((x) => [x.key, x.state]));
    expect(m).toMatchObject({ call: 'done', meeting: 'done', form: 'done', proposal: 'done', response: 'active', decision: 'pending' });
  });
  it('won/lost only from the explicit stage', () => {
    expect(computeMilestones({ pipeline_stage: 'won' }).at(-1)?.state).toBe('done');
    expect(computeMilestones({ pipeline_stage: 'lost' }).at(-1)?.state).toBe('bad');
  });
});

describe('csv export', () => {
  it('is Excel friendly and blocks formula injection', () => {
    const csv = toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', 5], [null, 'ok']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"a,b"'); expect(csv).toContain('"say ""hi"""'); expect(csv).toContain("'=HYPERLINK");
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
