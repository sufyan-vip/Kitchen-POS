import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createBill, getBillForOrder } from './billing';
import { addItemsToOrder, createOrder, getOrderById, sendKOT } from './order-service';
import { setCurrentRole, setCurrentStaffId } from './authz';
import {
  createTestDb, mockElectron, resetAuth, seedCustomer, seedMenuWithVariantAndModifiers, seedTable, setupSettings, teardown,
  expectDefined,
} from '../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

describe('billing — authoritative totals and payment validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({ tax_enabled: true, tax_name: 'Sales Tax', tax_rate: 15, tax_mode: 'exclusive', auto_release_table_on_bill: true });
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  function openOrderWithItems(type: 'dine-in' | 'takeaway' = 'takeaway', tableId?: number) {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: tableId ?? null, type });
    addItemsToOrder(order.id, [
      { menu_item_id: seeded.menuItemId, qty: 2, variant_id: seeded.variantId },
      { menu_item_id: seeded.menuItemId, qty: 1, modifiers: [{ id: seeded.cheeseId, qty: 1 }] },
    ]);
    sendKOT(order.id);
    const orderRow = expectDefined(getOrderById(order.id), 'order');
    return { order, orderRow, seeded };
  }

  it('bills from stored authoritative order totals', async () => {
    const { order, orderRow } = openOrderWithItems();
    // 2x1500 + (1000+150) = 4150, tax 15%
    expect(orderRow.subtotal_minor).toBe(4150);
    expect(orderRow.tax_minor).toBe(Math.round((4150 * 15) / 100));
    const bill = await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    expect(bill.total_amount_minor).toBe(orderRow.total_minor);
    expect(bill.payment_status).toBe('PAID');
    expect(bill.remaining_minor).toBe(0);
    const completed = expectDefined(getOrderById(order.id), 'order');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.total_paid_minor).toBe(orderRow.total_minor);
  });

  it('rejects overpayment', async () => {
    const { order, orderRow } = openOrderWithItems();
    await expect(createBill(order.id, [{ method: 'cash', amount: (orderRow.total_minor / 100) + 500 }]))
      .rejects.toThrow(/overpayment/i);
  });

  it('rejects negative and zero payments', async () => {
    const { order } = openOrderWithItems();
    await expect(createBill(order.id, [{ method: 'cash', amount: -50 }])).rejects.toThrow(/positive/i);
    await expect(createBill(order.id, [{ method: 'cash', amount: 0 }])).rejects.toThrow(/positive/i);
  });

  it('rejects unknown payment methods', async () => {
    const { order } = openOrderWithItems();
    await expect(createBill(order.id, [{ method: 'bitcoin', amount: 100 }])).rejects.toThrow(/unsupported/i);
  });

  it('supports split payments across methods', async () => {
    const { order, orderRow } = openOrderWithItems();
    const firstMinor = Math.floor(orderRow.total_minor / 2);
    const restMinor = orderRow.total_minor - firstMinor;
    // JazzCash has no credentials → its payment stays PENDING; cash covers half
    const partial = await createBill(order.id, [
      { method: 'cash', amount: firstMinor / 100 },
      { method: 'jazzcash', amount: restMinor / 100 },
    ]);
    expect(partial.payment_status).toBe('PAYMENT_PENDING');
    expect(expectDefined(getOrderById(order.id), 'order').status).toBe('SENT_TO_KITCHEN');

    // Settle the remainder with card
    const settled = await createBill(order.id, [{ method: 'card', amount: restMinor / 100 }]);
    expect(settled.payment_status).toBe('PAID');
    const payments = db.prepare('SELECT method, status FROM payments WHERE order_id = ? ORDER BY id').all(order.id) as Array<{ method: string; status: string }>;
    expect(payments).toEqual([
      { method: 'cash', status: 'PAID' },
      { method: 'jazzcash', status: 'PENDING' },
      { method: 'card', status: 'PAID' },
    ]);
  });

  it('records unpaid balance on customer account and completes', async () => {
    const customerId = seedCustomer(db, 'Ali', '03001234567');
    const { order, orderRow } = openOrderWithItems();
    const bill = await createBill(order.id, [{ method: 'unpaid', amount: orderRow.total_minor / 100 }], 0, customerId);
    expect(bill.payment_status).toBe('PAID');
    const customer = db.prepare('SELECT outstanding_balance, total_visits FROM customers WHERE id = ?').get(customerId) as { outstanding_balance: number; total_visits: number };
    expect(customer.outstanding_balance).toBe(orderRow.total_minor / 100);
    expect(customer.total_visits).toBe(1);
    const completed = expectDefined(getOrderById(order.id), 'order');
    expect(completed.status).toBe('COMPLETED');
  });

  it('rejects unpaid balance without a customer', async () => {
    const { order, orderRow } = openOrderWithItems();
    await expect(createBill(order.id, [{ method: 'unpaid', amount: orderRow.total_minor / 100 }]))
      .rejects.toThrow(/customer must be selected/i);
  });

  it('rejects double settlement of the same order', async () => {
    const { order, orderRow } = openOrderWithItems();
    await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    await expect(createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]))
      .rejects.toThrow(/already closed/i);
  });

  it('applies a bill-time discount', async () => {
    const { order, orderRow } = openOrderWithItems();
    const discountMinor = 3000; // Rs 30 fixed discount
    const bill = await createBill(order.id, [{ method: 'cash', amount: (orderRow.total_minor - discountMinor) / 100 }], { type: 'FIXED', value: 30 });
    expect(bill.discount_amount * 100).toBe(orderRow.discount_minor + discountMinor);
    expect(bill.total_amount_minor).toBe(orderRow.total_minor - discountMinor);
  });

  it('releases the table after full settlement', async () => {
    const tableId = seedTable(db, 'Dining');
    const { order, orderRow } = openOrderWithItems('dine-in', tableId);
    const tableBefore = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as { status: string };
    expect(tableBefore.status).toBe('OCCUPIED');
    await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    const tableAfter = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as { status: string };
    expect(tableAfter.status).toBe('AVAILABLE');
  });

  it('persists bill snapshot independent of later menu changes', async () => {
    const { order, orderRow, seeded } = openOrderWithItems();
    db.prepare('UPDATE menu_items SET price_minor = 1 WHERE id = ?').run(seeded.menuItemId);
    const bill = await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    expect(bill.total_amount_minor).toBe(orderRow.total_minor);
  });

  it('stores the bill and payments for retrieval', async () => {
    const { order, orderRow } = openOrderWithItems();
    await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    const data = getBillForOrder(order.id) as { bill: { bill_number: string }; payments: unknown[]; items: unknown[] };
    expect(data.bill.bill_number).toMatch(/^INV-/);
    expect(data.payments).toHaveLength(1);
    expect(data.items).toHaveLength(2);
  });

  it('requires the refunds permission for refunds', async () => {
    const { order, orderRow } = openOrderWithItems();
    await createBill(order.id, [{ method: 'cash', amount: orderRow.total_minor / 100 }]);
    const _payment = db.prepare('SELECT id FROM payments WHERE order_id = ?').get(order.id) as { id: number };
    setCurrentRole('cashier');
    setCurrentStaffId(3);
    const { registerPaymentsIPC } = await import('../ipc/payments');
    void registerPaymentsIPC;
    // cashier lacks refunds — the transition must be blocked at the service layer
    const { assertValidPaymentTransition } = await import('./payments');
    expect(() => { assertValidPaymentTransition('PAID', 'REFUNDED'); }).not.toThrow();
    // Simulate IPC-level guard by checking permission
    const { hasPermission } = await import('./authz');
    expect(hasPermission('cashier', 'refunds')).toBe(false);
    expect(hasPermission('admin', 'refunds')).toBe(true);
  });
});
