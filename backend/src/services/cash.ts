/**
 * Cashier shift & cash drawer service.
 * Expected cash = opening cash + cash sales − cash refunds + cash in − cash out.
 * Completed shifts are protected from modification.
 */
import type Database from 'better-sqlite3';
import { getDB } from '../db';
import { writeAuditLog } from './audit';
import { assertCurrentPermission } from './authz';
import { toMinorUnits } from './money';

export interface ShiftRow {
  id: number;
  staff_id: number;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  opening_cash_minor: number;
  closing_cash_minor: number | null;
  expected_cash_minor: number | null;
  actual_cash_minor: number | null;
  variance_minor: number | null;
  status: 'open' | 'closed';
  closed_by: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashEntryRow {
  id: number;
  shift_id: number;
  type: 'CASH_IN' | 'CASH_OUT' | 'SALE' | 'REFUND';
  amount_minor: number;
  note: string | null;
  payment_id: number | null;
  created_by: number | null;
  created_at: string;
}

function db(): Database.Database { return getDB(); }

export function getActiveShift(): ShiftRow | null {
  return db().prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as ShiftRow | null;
}

export function getActiveShiftForStaff(staffId: number): ShiftRow | null {
  return db().prepare("SELECT * FROM shifts WHERE status = 'open' AND staff_id = ? ORDER BY id DESC LIMIT 1").get(staffId) as ShiftRow | null;
}

export function openShift(staffId: number, openingCash: number | string): ShiftRow {
  assertCurrentPermission('shifts_manage');
  const database = db();
  const openingMinor = toMinorUnits(openingCash);
  if (openingMinor < 0) { throw new Error('Opening cash cannot be negative'); }
  if (getActiveShift()) { throw new Error('A shift is already open'); }
  const info = database.prepare(`
    INSERT INTO shifts (staff_id, opened_at, opening_cash, opening_cash_minor, status)
    VALUES (?, CURRENT_TIMESTAMP, ?, ?, 'open')
  `).run(staffId, openingMinor / 100, openingMinor);
  const id = Number(info.lastInsertRowid);
  writeAuditLog(database, { action: 'shift_opened', entityType: 'shift', entityId: id, details: { staffId, opening_cash_minor: openingMinor } });
  return database.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as ShiftRow;
}

export function computeExpectedCash(database: Database.Database, shiftId: number, openedAt: string): number {
  const shift = database.prepare('SELECT opening_cash_minor, status FROM shifts WHERE id = ?').get(shiftId) as { opening_cash_minor: number; status: string } | undefined;
  if (!shift) { throw new Error('Shift not found'); }
  // Cash sales & refunds are derived from PAID cash payments after shift open
  const sale = database.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payments
    WHERE method = 'cash' AND status = 'PAID' AND COALESCE(paid_at, created_at) >= ?
  `).get(openedAt) as { total: number };
  const refund = database.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payments
    WHERE method = 'cash' AND status = 'REFUNDED' AND COALESCE(paid_at, created_at) >= ?
  `).get(openedAt) as { total: number };
  const entries = database.prepare("SELECT type, SUM(amount_minor) AS total FROM shift_cash_entries WHERE shift_id = ? GROUP BY type").all(shiftId) as Array<{ type: string; total: number }>;
  let cashIn = 0;
  let cashOut = 0;
  for (const e of entries) {
    if (e.type === 'CASH_IN') { cashIn += e.total; }
    if (e.type === 'CASH_OUT') { cashOut += e.total; }
  }
  return shift.opening_cash_minor + sale.total - refund.total + cashIn - cashOut;
}

export function addCashEntry(shiftId: number, type: 'CASH_IN' | 'CASH_OUT', amount: number | string, note?: string | null, staffId?: number): CashEntryRow {
  assertCurrentPermission('shifts_manage');
  const database = db();
  const amountMinor = toMinorUnits(amount);
  if (amountMinor <= 0) { throw new Error('Amount must be positive'); }
  const shift = database.prepare("SELECT id, status FROM shifts WHERE id = ?").get(shiftId) as { id: number; status: string } | undefined;
  if (!shift) { throw new Error('Shift not found'); }
  if (shift.status !== 'open') { throw new Error('Shift is closed'); }
  const info = database.prepare(`
    INSERT INTO shift_cash_entries (shift_id, type, amount_minor, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(shiftId, type, amountMinor, note ?? null, staffId ?? null);
  writeAuditLog(database, { action: type === 'CASH_IN' ? 'cash_in' : 'cash_out', entityType: 'shift', entityId: shiftId, details: { amount_minor: amountMinor } });
  return database.prepare('SELECT * FROM shift_cash_entries WHERE id = ?').get(Number(info.lastInsertRowid)) as CashEntryRow;
}

export function listCashEntries(shiftId: number): CashEntryRow[] {
  return db().prepare('SELECT * FROM shift_cash_entries WHERE shift_id = ? ORDER BY id').all(shiftId) as CashEntryRow[];
}

export function closeShift(shiftId: number, actualCash: number | string, note?: string | null, closedBy?: number): ShiftRow {
  assertCurrentPermission('shifts_manage');
  const database = db();
  return database.transaction(() => {
    const shift = database.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as ShiftRow | undefined;
    if (!shift) { throw new Error('Shift not found'); }
    if (shift.status !== 'open') { throw new Error('Shift already closed'); }
    const actualMinor = toMinorUnits(actualCash);
    if (actualMinor < 0) { throw new Error('Actual cash cannot be negative'); }
    const expectedMinor = computeExpectedCash(database, shiftId, shift.opened_at);
    const varianceMinor = actualMinor - expectedMinor;
    database.prepare(`
      UPDATE shifts SET
        closed_at = CURRENT_TIMESTAMP, closing_cash = ?, closing_cash_minor = ?,
        expected_cash_minor = ?, actual_cash_minor = ?, variance_minor = ?,
        status = 'closed', closed_by = ?, note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(actualMinor / 100, actualMinor, expectedMinor, actualMinor, varianceMinor, closedBy ?? null, note ?? null, shiftId);
    writeAuditLog(database, { action: 'shift_closed', entityType: 'shift', entityId: shiftId, details: { expected_minor: expectedMinor, actual_minor: actualMinor, variance_minor: varianceMinor } });
    return database.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as ShiftRow;
  })();
}

export function listShifts(limit = 100): unknown[] {
  assertCurrentPermission('shifts_view');
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  return db().prepare(`
    SELECT s.*, st.name AS staff_name FROM shifts s
    LEFT JOIN staff st ON st.id = s.staff_id
    ORDER BY s.id DESC LIMIT ?
  `).all(safeLimit);
}

/** Cash payment bookkeeping: SALE entries on PAID cash, REFUND on refunded cash. */
export function recordCashPayment(database: Database.Database, shiftId: number | null, kind: 'SALE' | 'REFUND', amountMinor: number, paymentId?: number): void {
  if (!shiftId) { return; }
  const shift = database.prepare("SELECT id, status FROM shifts WHERE id = ?").get(shiftId) as { id: number; status: string } | undefined;
  if (shift?.status !== 'open') { return; }
  database.prepare(`
    INSERT INTO shift_cash_entries (shift_id, type, amount_minor, payment_id)
    VALUES (?, ?, ?, ?)
  `).run(shiftId, kind, amountMinor, paymentId ?? null);
}

export function findActiveShiftForTimestamp(database: Database.Database, timestamp: string): number | null {
  const row = database.prepare("SELECT id FROM shifts WHERE status = 'open' AND opened_at <= ? ORDER BY id DESC LIMIT 1").get(timestamp) as { id: number } | undefined;
  return row?.id ?? null;
}
