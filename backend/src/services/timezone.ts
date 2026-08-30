import { getAppSettings } from './settings';

/**
 * Application-timezone helpers for reports and dashboards.
 *
 * All timestamps are stored in UTC (SQLite CURRENT_TIMESTAMP). Report date
 * boundaries must be computed in the *configured* application timezone
 * (default Asia/Karachi), never the machine's local timezone, so results are
 * identical on any host. Offsets are resolved with Intl (DST-aware) and the
 * results are expressed as UTC SQLite strings for range comparisons.
 */

export const DEFAULT_TIMEZONE = 'Asia/Karachi';

/** IANA name of the configured application timezone. */
export function getAppTimezone(): string {
  const settings = getAppSettings();
  return typeof settings.timezone === 'string' && settings.timezone.length > 0 ? settings.timezone : DEFAULT_TIMEZONE;
}

/** Calendar date (YYYY-MM-DD) of `utcMs` in `timeZone`. */
export function zonedDateStr(utcMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(new Date(utcMs));
}

/** UTC offset (ms) of `at` in `timeZone` (Intl-based, DST-aware). */
export function utcOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') { p[part.type] = part.value; }
  }
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asUtcMs = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asUtcMs - at.getTime();
}

/** UTC instant (ms) of local midnight for calendar date `dateStr` in `timeZone`. */
export function zonedMidnightUtcMs(dateStr: string, timeZone: string): number {
  const anchor = Date.parse(`${dateStr}T00:00:00Z`);
  let guess = anchor - utcOffsetMs(timeZone, new Date(anchor));
  // DST edge: if the offset at the first guess differs (transition at
  // midnight), one refinement pass lands on the true local midnight.
  if (zonedDateStr(guess, timeZone) !== dateStr) {
    guess = anchor - utcOffsetMs(timeZone, new Date(guess));
  }
  return guess;
}

/** UTC SQLite string (YYYY-MM-DD HH:MM:SS) for `utcMs`. */
export function sqliteUtc(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 19).replace('T', ' ');
}

export interface ZonedDay {
  startUtcMs: number;
  endUtcMs: number;
  startUtc: string;
  endUtc: string;
  startDate: string;
  endDate: string;
}

/** Half-open [start, end) UTC range covering calendar date `dateStr` in `timeZone`. */
export function zonedDayRange(dateStr: string, timeZone: string): ZonedDay {
  const startUtcMs = zonedMidnightUtcMs(dateStr, timeZone);
  const endUtcMs = zonedMidnightUtcMs(shiftDateStr(dateStr, 1), timeZone);
  return {
    startUtcMs, endUtcMs,
    startUtc: sqliteUtc(startUtcMs), endUtc: sqliteUtc(endUtcMs),
    startDate: dateStr, endDate: dateStr,
  };
}

/** Calendar date shifted by `days` (may be negative). */
export function shiftDateStr(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** First day (YYYY-MM-01) of the month after `dateStr`. */
export function shiftMonthStart(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

const UTC_CONDITION = 'created_at >= ? AND created_at < ?';

export interface ReportRange {
  /** WHERE condition for UTC timestamp columns (created_at etc.). */
  condition: string;
  params: string[];
  /** Inclusive calendar dates in the configured timezone. */
  startDate: string;
  endDate: string;
  trendGroupFormat: '%H' | '%Y-%m-%d' | '%Y-%m';
}

/**
 * Half-open UTC range for a report filter. `now` is injected for tests.
 * Filters keep their historical semantics: daily = today, weekly = last
 * 6 days + today, monthly = current calendar month, yearly = current year.
 */
export function reportRangeUtc(filter: string, timeZone: string, now: Date, start?: string, end?: string): ReportRange {
  const today = zonedDateStr(now.getTime(), timeZone);
  switch (filter) {
    case 'daily':
    case 'today': {
      const r = zonedDayRange(today, timeZone);
      return { condition: UTC_CONDITION, params: [r.startUtc, r.endUtc], startDate: today, endDate: today, trendGroupFormat: '%H' };
    }
    case 'yesterday': {
      const y = shiftDateStr(today, -1);
      const r = zonedDayRange(y, timeZone);
      return { condition: UTC_CONDITION, params: [r.startUtc, r.endUtc], startDate: y, endDate: y, trendGroupFormat: '%H' };
    }
    case 'weekly': {
      const from = shiftDateStr(today, -6);
      const startUtc = sqliteUtc(zonedMidnightUtcMs(from, timeZone));
      const endUtc = sqliteUtc(zonedMidnightUtcMs(shiftDateStr(today, 1), timeZone));
      return { condition: UTC_CONDITION, params: [startUtc, endUtc], startDate: from, endDate: today, trendGroupFormat: '%Y-%m-%d' };
    }
    case 'monthly': {
      const monthStart = `${today.slice(0, 7)}-01`;
      const nextMonthStart = shiftMonthStart(today);
      const startUtc = sqliteUtc(zonedMidnightUtcMs(monthStart, timeZone));
      const endUtc = sqliteUtc(zonedMidnightUtcMs(nextMonthStart, timeZone));
      return {
        condition: UTC_CONDITION, params: [startUtc, endUtc],
        startDate: monthStart, endDate: shiftDateStr(nextMonthStart, -1), trendGroupFormat: '%Y-%m-%d',
      };
    }
    case 'yearly': {
      const yearStart = `${today.slice(0, 4)}-01-01`;
      const nextYearStart = `${Number(today.slice(0, 4)) + 1}-01-01`;
      const startUtc = sqliteUtc(zonedMidnightUtcMs(yearStart, timeZone));
      const endUtc = sqliteUtc(zonedMidnightUtcMs(nextYearStart, timeZone));
      return {
        condition: UTC_CONDITION, params: [startUtc, endUtc],
        startDate: yearStart, endDate: shiftDateStr(nextYearStart, -1), trendGroupFormat: '%Y-%m',
      };
    }
    case 'custom': {
      const from = start ?? today;
      const to = end ?? today;
      const startUtc = sqliteUtc(zonedMidnightUtcMs(from, timeZone));
      const endUtc = sqliteUtc(zonedMidnightUtcMs(shiftDateStr(to, 1), timeZone));
      return { condition: UTC_CONDITION, params: [startUtc, endUtc], startDate: from, endDate: to, trendGroupFormat: '%Y-%m-%d' };
    }
    default:
      return reportRangeUtc('daily', timeZone, now);
  }
}

/** Bucket a UTC SQLite timestamp into the report trend label (in `timeZone`). */
export function makeTrendBucket(format: '%H' | '%Y-%m-%d' | '%Y-%m', timeZone: string): (utcSql: string) => string {
  const parse = (utcSql: string): Date => new Date(`${utcSql.replace(' ', 'T')}Z`);
  if (format === '%H') {
    const dtf = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false });
    return utcSql => dtf.format(parse(utcSql)).replace('24', '00');
  }
  if (format === '%Y-%m') {
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
    return utcSql => dtf.format(parse(utcSql));
  }
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return utcSql => dtf.format(parse(utcSql));
}
