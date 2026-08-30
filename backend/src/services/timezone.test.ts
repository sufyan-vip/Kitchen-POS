import { describe, expect, it } from 'vitest';
import {
  zonedDateStr, zonedMidnightUtcMs, zonedDayRange, shiftDateStr, shiftMonthStart,
  reportRangeUtc, makeTrendBucket, DEFAULT_TIMEZONE,
} from './timezone';

describe('timezone helpers — configured application timezone (default Asia/Karachi)', () => {
  it('zonedDateStr converts UTC instants to the configured calendar date', () => {
    // PKT = UTC+5, no DST: 2026-08-30T19:00:00Z is 2026-08-31 00:00 in Karachi
    expect(zonedDateStr(Date.parse('2026-08-30T19:00:00Z'), 'Asia/Karachi')).toBe('2026-08-31');
    expect(zonedDateStr(Date.parse('2026-08-30T18:59:59Z'), 'Asia/Karachi')).toBe('2026-08-30');
    // UTC itself
    expect(zonedDateStr(Date.parse('2026-08-30T12:00:00Z'), 'UTC')).toBe('2026-08-30');
  });

  it('zonedMidnightUtcMs lands on local midnight for fixed-offset zones', () => {
    expect(zonedMidnightUtcMs('2026-08-31', 'Asia/Karachi')).toBe(Date.parse('2026-08-30T19:00:00Z'));
    expect(zonedMidnightUtcMs('2026-08-31', 'Asia/Kolkata')).toBe(Date.parse('2026-08-30T18:30:00Z')); // UTC+5:30
    expect(zonedMidnightUtcMs('2026-08-31', 'UTC')).toBe(Date.parse('2026-08-31T00:00:00Z'));
  });

  it('handles DST transitions at midnight (America/New_York, 2026-03-08)', () => {
    // 2026-03-08 00:00 EST = 05:00Z; the next midnight (03-09) is EDT = 04:00Z
    expect(zonedMidnightUtcMs('2026-03-08', 'America/New_York')).toBe(Date.parse('2026-03-08T05:00:00Z'));
    expect(zonedMidnightUtcMs('2026-03-09', 'America/New_York')).toBe(Date.parse('2026-03-09T04:00:00Z'));
  });

  it('zonedDayRange gives a half-open UTC window with correct boundaries', () => {
    const day = zonedDayRange('2026-08-31', DEFAULT_TIMEZONE);
    expect(day.startUtc).toBe('2026-08-30 19:00:00');
    expect(day.endUtc).toBe('2026-08-31 19:00:00');
    // Midnight-boundary membership: 23:59:59 PKT not in range, 00:00:00 PKT is
    expect('2026-08-30 18:59:59' >= day.startUtc && '2026-08-30 18:59:59' < day.endUtc).toBe(false);
    expect('2026-08-30 19:00:00' >= day.startUtc && '2026-08-30 19:00:00' < day.endUtc).toBe(true);
  });

  it('reportRangeUtc builds daily/weekly/monthly/yearly/custom ranges', () => {
    const now = new Date('2026-08-30T12:00:00Z'); // 2026-08-30 17:00 PKT
    const daily = reportRangeUtc('daily', 'Asia/Karachi', now);
    expect(daily.params).toEqual(['2026-08-29 19:00:00', '2026-08-30 19:00:00']);
    expect(daily.startDate).toBe('2026-08-30');
    expect(daily.endDate).toBe('2026-08-30');

    const yesterday = reportRangeUtc('yesterday', 'Asia/Karachi', now);
    expect(yesterday.params).toEqual(['2026-08-28 19:00:00', '2026-08-29 19:00:00']);

    const weekly = reportRangeUtc('weekly', 'Asia/Karachi', now);
    expect(weekly.params).toEqual(['2026-08-23 19:00:00', '2026-08-30 19:00:00']);
    expect(weekly.startDate).toBe('2026-08-24');
    expect(weekly.endDate).toBe('2026-08-30');

    const monthly = reportRangeUtc('monthly', 'Asia/Karachi', now);
    expect(monthly.params).toEqual(['2026-07-31 19:00:00', '2026-08-31 19:00:00']);
    expect(monthly.startDate).toBe('2026-08-01');
    expect(monthly.endDate).toBe('2026-08-31');

    const yearly = reportRangeUtc('yearly', 'Asia/Karachi', now);
    expect(yearly.params).toEqual(['2025-12-31 19:00:00', '2026-12-31 19:00:00']);
    expect(yearly.startDate).toBe('2026-01-01');
    expect(yearly.endDate).toBe('2026-12-31');

    const custom = reportRangeUtc('custom', 'Asia/Karachi', now, '2026-08-10', '2026-08-12');
    expect(custom.params).toEqual(['2026-08-09 19:00:00', '2026-08-12 19:00:00']);
    expect(custom.startDate).toBe('2026-08-10');
    expect(custom.endDate).toBe('2026-08-12');

    // Unknown filter falls back to daily
    expect(reportRangeUtc('bogus', 'Asia/Karachi', now).params).toEqual(daily.params);
  });

  it('makeTrendBucket labels timestamps in the configured timezone', () => {
    const hour = makeTrendBucket('%H', 'Asia/Karachi');
    // 2026-08-30T18:59:59Z → 23:59 PKT → hour 23; T19:00:00Z → 00:00 PKT next day
    expect(hour('2026-08-30 18:59:59')).toBe('23');
    expect(hour('2026-08-30 19:00:00')).toBe('00');
    const day = makeTrendBucket('%Y-%m-%d', 'Asia/Karachi');
    expect(day('2026-08-30 18:59:59')).toBe('2026-08-30');
    expect(day('2026-08-30 19:00:00')).toBe('2026-08-31');
    const month = makeTrendBucket('%Y-%m', 'Asia/Karachi');
    expect(month('2026-08-30 19:00:00')).toBe('2026-08');
  });

  it('shiftDateStr / shiftMonthStart handle month and year edges', () => {
    expect(shiftDateStr('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateStr('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftMonthStart('2026-08-30')).toBe('2026-09-01');
    expect(shiftMonthStart('2026-12-15')).toBe('2027-01-01');
  });
});
