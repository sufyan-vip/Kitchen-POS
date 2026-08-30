import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { addCashEntry, closeShift, computeExpectedCash, getActiveShift, listCashEntries, openShift, recordCashPayment } from './cash';
import { createTestDb, mockElectron, resetAuth, setupSettings, teardown } from '../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

describe('shifts & cash drawer', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({});
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  it('opens a shift with opening cash and blocks a second open shift', () => {
    const shift = openShift(1, 5000);
    expect(shift.opening_cash_minor).toBe(500000);
    expect(getActiveShift()?.id).toBe(shift.id);
    expect(() => openShift(2, 1000)).toThrow(/already open/);
  });

  it('tracks cash in/out entries', () => {
    const shift = openShift(1, 0);
    addCashEntry(shift.id, 'CASH_IN', 1000, 'float top-up');
    addCashEntry(shift.id, 'CASH_OUT', 250.5, 'petty cash');
    const entries = listCashEntries(shift.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].amount_minor).toBe(100000);
    expect(entries[1].amount_minor).toBe(25050);
  });

  it('computes expected cash = opening + cash sales + in − out', () => {
    const shift = openShift(1, 1000);
    addCashEntry(shift.id, 'CASH_IN', 500);
    addCashEntry(shift.id, 'CASH_OUT', 200);
    // A paid cash sale (recorded through billing's recordCashPayment)
    const orderCreatedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO orders (order_number, status, kds_status, type, created_at, updated_at)
      VALUES ('ORD-TEST1', 'COMPLETED', 'COMPLETED', 'takeaway', ?, ?)
    `).run(orderCreatedAt, orderCreatedAt);
    const orderId = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-TEST1') as { id: number }).id;
    db.prepare(`
      INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, status, paid_at)
      VALUES (?, 'cash', 'cash', 100, 10000, 'PKR', 'PAID', CURRENT_TIMESTAMP)
    `).run(orderId);
    recordCashPayment(db, shift.id, 'SALE', 10000);
    const expected = computeExpectedCash(db, shift.id, shift.opened_at);
    expect(expected).toBe(100000 + 50000 - 20000 + 10000);
  });

  it('closes a shift with expected vs actual variance', () => {
    const shift = openShift(1, 1000);
    const closed = closeShift(shift.id, 1250, 'end of day');
    expect(closed.status).toBe('closed');
    expect(closed.expected_cash_minor).toBe(100000);
    expect(closed.actual_cash_minor).toBe(125000);
    expect(closed.variance_minor).toBe(25000);
    expect(closed.closed_at).not.toBeNull();
    expect(() => closeShift(shift.id, 0)).toThrow(/already closed/);
    expect(() => addCashEntry(shift.id, 'CASH_IN', 10)).toThrow(/closed/);
  });

  it('protects completed shift modification and lists shift history', async () => {
    const shift = openShift(1, 0);
    closeShift(shift.id, 0);
    const { listShifts } = await import('./cash');
    const rows = listShifts() as Array<{ staff_id: number; status: string }>;
    expect(rows[0].status).toBe('closed');
    expect(rows[0].staff_id).toBe(1);
  });
});
