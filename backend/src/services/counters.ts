import type Database from 'better-sqlite3';

/**
 * Monotonic, race-safe counters stored in the database.
 * Must be called inside a transaction for full safety.
 */
export function nextCounterValue(db: Database.Database, name: string, prefix = ''): string {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number } | undefined;
  const next = (row?.value ?? 0) + 1;
  db.prepare(
    'INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value'
  ).run(name, next);
  return prefix ? `${prefix}${String(next).padStart(6, '0')}` : String(next);
}

export function nextCounterNumber(db: Database.Database, name: string): number {
  return Number(nextCounterValue(db, name));
}
