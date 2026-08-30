import { describe, expect, it, afterEach } from 'vitest';
import { createTestDb, expectDefined, mockElectron, resetAuth, seedCustomer, setupSettings, teardown } from '../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

describe('customers:settleBalance — paisa-correct settlement with audit', () => {
  let db: Database.Database;

  afterEach(() => { teardown(); });

  it('records a paisa payment row, reduces the balance and writes an audit event', async () => {
    db = createTestDb();
    resetAuth();
    setupSettings({});
    const customerId = seedCustomer(db, 'Ali', '03001234567');
    db.prepare('UPDATE customers SET outstanding_balance = 125.5 WHERE id = ?').run(customerId); // Rs 125.50

    // ipcMain mock: capture handlers (setup.ts mock returns { handle: () => undefined })
    const ipcMain = await import('electron').then(m => m.ipcMain as unknown as { handle: (ch: string, fn: unknown) => void; __handlers?: Map<string, unknown> });

    // Register the real IPC module against the mock and grab the handler.
    const { registerCustomersIPC } = await import('../ipc/customers');
    const captured = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>();
    const realHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = ((ch: string, fn: (e: unknown, p: unknown) => Promise<unknown>) => { captured.set(ch, fn); }) as typeof ipcMain.handle;
    registerCustomersIPC();
    ipcMain.handle = realHandle;

    const handler = expectDefined(captured.get('customers:settleBalance'), 'handler');
    const res = await handler(null, { customerId, amount: 25.5, method: 'cash' }) as { success: boolean; error?: string; data?: { paymentId: number } };
    expect(res.success).toBe(true);

    const payment = db.prepare('SELECT order_id, method, amount, amount_minor, currency, status, reference, provider FROM payments WHERE id = ?').get(expectDefined(res.data, 'data').paymentId) as {
      order_id: number | null; method: string; amount: number; amount_minor: number; currency: string; status: string; reference: string; provider: string;
    };
    expect(payment.order_id).toBeNull();
    expect(payment.method).toBe('cash');
    expect(payment.provider).toBe('cash');
    expect(payment.amount_minor).toBe(2550);      // integer paisa
    expect(payment.amount).toBe(25.5);            // legacy rupee column stays consistent
    expect(payment.currency).toBe('PKR');
    expect(payment.status).toBe('PAID');
    expect(payment.reference).toBe('Balance Settlement');

    const customer = db.prepare('SELECT outstanding_balance FROM customers WHERE id = ?').get(customerId) as { outstanding_balance: number };
    expect(customer.outstanding_balance).toBe(100); // 125.50 - 25.50

    const audit = db.prepare("SELECT action, entity_type, entity_id, details FROM audit_logs WHERE action = 'customer_balance_settled'").get() as { action: string; entity_type: string; entity_id: number; details: string };
    expect(audit.entity_type).toBe('customer');
    expect(audit.entity_id).toBe(customerId);
    expect(JSON.parse(audit.details)).toEqual({ amount_minor: 2550, method: 'cash', paymentId: expectDefined(res.data, 'data').paymentId });
  });

  it('routes cash settlements into the active shift cash tally', async () => {
    db = createTestDb();
    resetAuth();
    setupSettings({});
    const customerId = seedCustomer(db, 'Ali');
    db.prepare('UPDATE customers SET outstanding_balance = 500 WHERE id = ?').run(customerId);
    db.prepare("INSERT INTO shifts (staff_id, opened_at, opening_cash_minor, status) VALUES (1, CURRENT_TIMESTAMP, 0, 'open')").run();

    const { registerCustomersIPC } = await import('../ipc/customers');
    const captured = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>();
    const ipcMain = await import('electron').then(m => m.ipcMain as unknown as { handle: (ch: string, fn: unknown) => void });
    const realHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = ((ch: string, fn: (e: unknown, p: unknown) => Promise<unknown>) => { captured.set(ch, fn); }) as typeof ipcMain.handle;
    registerCustomersIPC();
    ipcMain.handle = realHandle;

    const res = await expectDefined(captured.get('customers:settleBalance'), 'handler')(null, { customerId, amount: 100, method: 'cash' }) as { success: boolean; error?: string };
    expect(res.success).toBe(true);

    const entry = db.prepare('SELECT type, amount_minor, payment_id FROM shift_cash_entries').get() as { type: string; amount_minor: number; payment_id: number };
    expect(entry.type).toBe('SALE');
    expect(entry.amount_minor).toBe(10000);
    expect(entry.payment_id).toBeGreaterThan(0);
  });

  it('rejects overpayment, non-positive amounts and unsupported methods', async () => {
    db = createTestDb();
    resetAuth();
    setupSettings({});
    const customerId = seedCustomer(db, 'Ali');
    db.prepare('UPDATE customers SET outstanding_balance = 50 WHERE id = ?').run(customerId);

    const { registerCustomersIPC } = await import('../ipc/customers');
    const captured = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>();
    const ipcMain = await import('electron').then(m => m.ipcMain as unknown as { handle: (ch: string, fn: unknown) => void });
    const realHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = ((ch: string, fn: (e: unknown, p: unknown) => Promise<unknown>) => { captured.set(ch, fn); }) as typeof ipcMain.handle;
    registerCustomersIPC();
    ipcMain.handle = realHandle;
    const handler = expectDefined(captured.get('customers:settleBalance'), 'handler');

    const over = await handler(null, { customerId, amount: 50.01, method: 'cash' }) as { success: boolean; error?: string };
    expect(over.success).toBe(false);
    expect(over.error).toMatch(/exceeds outstanding/i);

    const zero = await handler(null, { customerId, amount: 0, method: 'cash' }) as { success: boolean; error?: string };
    expect(zero.success).toBe(false);
    expect(zero.error).toMatch(/greater than zero/i);

    const bad = await handler(null, { customerId, amount: 10, method: 'bitcoin' }) as { success: boolean; error?: string };
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/unsupported payment method/i);

    // Nothing was recorded by the failed attempts
    expect((db.prepare('SELECT COUNT(*) c FROM payments').get() as { c: number }).c).toBe(0);
    expect((db.prepare('SELECT outstanding_balance FROM customers WHERE id = ?').get(customerId) as { outstanding_balance: number }).outstanding_balance).toBe(50);
  });
});
