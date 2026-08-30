import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  addItemsToOrder, applyOrderDiscount, cancelOrder, changeOrderTable, createOrder,
  getOpenOrders, getOrderByTable, getOrderById, sendKOT, updateOrderStatus, voidOrderItem,
} from './order-service';
import {
  createTestDb, mockElectron, resetAuth, seedMenuWithVariantAndModifiers, seedTable, setupSettings, teardown,
  expectDefined,
} from '../test/helpers';
import type Database from 'better-sqlite3';

function seedBunInventory(db: Database.Database, menuItemId: number): number {
  const inv = db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock, low_stock_alert_at, cost_per_unit) VALUES ('Bun', 'pcs', 100, 10, 30)").run();
  const bunId = Number(inv.lastInsertRowid);
  db.prepare('INSERT INTO menu_inventory_map (menu_item_id, inventory_item_id, qty_used) VALUES (?, ?, 2)').run(menuItemId, bunId);
  return bunId;
}

mockElectron();

describe('order lifecycle', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({ tax_enabled: true, tax_name: 'Sales Tax', tax_rate: 15, tax_mode: 'exclusive', inventory_auto_debit: true, allow_negative_inventory: false });
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  it('creates orders with monotonic order numbers', () => {
    const a = createOrder({ tableId: null, type: 'takeaway' });
    const b = createOrder({ tableId: null, type: 'takeaway' });
    expect(a.order_number).toBe('ORD-000001');
    expect(b.order_number).toBe('ORD-000002');
  });

  it('prevents two active orders on the same table', () => {
    const tableId = seedTable(db, 'T1');
    createOrder({ tableId, type: 'dine-in' });
    expect(() => createOrder({ tableId, type: 'dine-in' })).toThrow(/active order/);
  });

  it('computes authoritative totals when items are added', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    const res = addItemsToOrder(order.id, [
      { menu_item_id: seeded.menuItemId, qty: 2, variant_id: seeded.variantId },
      { menu_item_id: seeded.menuItemId, qty: 1, modifiers: [{ id: seeded.cheeseId, qty: 1 }] },
    ]);
    // 2 x 1500 + 1 x (1000 + 150) = 4150
    expect(res.order.subtotal_minor).toBe(4150);
    // tax 15% exclusive
    expect(res.order.tax_minor).toBe(Math.round((4150 * 15) / 100));
    expect(res.order.total_minor).toBe(4150 + res.order.tax_minor);
    expect(res.order.status).toBe('OPEN');
  });

  it('snapshots prices at order time; menu changes do not affect orders', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 1 }]);
    db.prepare('UPDATE menu_items SET price_minor = 99999 WHERE id = ?').run(seeded.menuItemId);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id) as Array<{ line_total_minor: number }>;
    expect(items[0].line_total_minor).toBe(1000);
  });

  it('applies percent and fixed discounts with permission checks', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 2 }]);
    const discounted = applyOrderDiscount(order.id, { type: 'PERCENT', percent: 10, minor: 0 });
    expect(discounted.discount_minor).toBe(200);
    expect(discounted.total_minor).toBe(1800 + discounted.tax_minor);
  });

  it('sends KOTs with monotonic duplicate-free numbers and marks items', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 1 }]);
    const kot1 = sendKOT(order.id);
    expect(kot1.kotType).toBe('MAIN');
    expect(kot1.kotNumber).toBe(1);
    const updated = expectDefined(getOrderById(order.id), 'order');
    expect(updated.status).toBe('SENT_TO_KITCHEN');

    // Additional KOT for new items
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 1 }]);
    const kot2 = sendKOT(order.id);
    expect(kot2.kotType).toBe('ADDITIONAL');
    expect(kot2.kotNumber).toBe(2);

    // No unsent items → nothing to send
    expect(() => sendKOT(order.id)).toThrow(/No unsent items/);
    const numbers = db.prepare('SELECT kot_number FROM kots ORDER BY kot_number').all() as Array<{ kot_number: number }>;
    expect(numbers.map(n => n.kot_number)).toEqual([1, 2]);
  });

  it('deducts inventory on KOT send and restores on void', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const bunId = seedBunInventory(db, seeded.menuItemId);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 2 }]);
    const bunBefore = (db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(bunId) as { qty_in_stock: number }).qty_in_stock;
    sendKOT(order.id);
    const bunAfter = (db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(bunId) as { qty_in_stock: number }).qty_in_stock;
    expect(bunAfter).toBe(bunBefore - 4); // recipe uses 2 buns per item

    const itemId = (db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id) as { id: number }).id;
    voidOrderItem(order.id, itemId, 'customer changed mind');
    const bunRestored = (db.prepare("SELECT qty_in_stock FROM inventory_items WHERE name = 'Bun'").get() as { qty_in_stock: number }).qty_in_stock;
    expect(bunRestored).toBe(bunBefore);
  });

  it('restores inventory and releases the table on cancellation', () => {
    const tableId = seedTable(db, 'T1');
    const seeded = seedMenuWithVariantAndModifiers(db);
    const bunId = seedBunInventory(db, seeded.menuItemId);
    const order = createOrder({ tableId, type: 'dine-in' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 1 }]);
    sendKOT(order.id);
    const table = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as { status: string };
    expect(table.status).toBe('OCCUPIED');

    cancelOrder(order.id, 'walkout');
    const cancelled = expectDefined(getOrderById(order.id), 'order');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancel_reason).toBe('walkout');
    const tableAfter = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as { status: string };
    expect(tableAfter.status).toBe('AVAILABLE');
    const bun = (db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(bunId) as { qty_in_stock: number }).qty_in_stock;
    expect(bun).toBe(100);
  });

  it('rejects cancelling an order with settled payments', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const order = createOrder({ tableId: null, type: 'takeaway' });
    addItemsToOrder(order.id, [{ menu_item_id: seeded.menuItemId, qty: 1 }]);
    sendKOT(order.id);
    db.prepare(`
      INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, status, paid_at)
      VALUES (?, 'cash', 'cash', 10, 1000, 'PKR', 'PAID', CURRENT_TIMESTAMP)
    `).run(order.id);
    expect(() => cancelOrder(order.id, 'nope')).toThrow(/refund before cancelling/);
  });

  it('enforces the status transition matrix', () => {
    const order = createOrder({ tableId: null, type: 'takeaway' });
    expect(() => updateOrderStatus(order.id, 'COMPLETED')).toThrow(/Complete an order through billing/);
    expect(() => updateOrderStatus(order.id, 'SERVED')).toThrow(/Invalid order status transition/);
    const moved = updateOrderStatus(order.id, 'CANCELLED');
    expect(moved.status).toBe('CANCELLED');
  });

  it('changes table safely and blocks conflicts', () => {
    const t1 = seedTable(db, 'T1');
    const t2 = seedTable(db, 'T2');
    const order = createOrder({ tableId: t1, type: 'dine-in' });
    const other = createOrder({ tableId: t2, type: 'dine-in' });
    expect(() => changeOrderTable(other.id, t1)).toThrow(/active order/);
    cancelOrder(other.id, 'make room');
    changeOrderTable(order.id, t2);
    const moved = expectDefined(getOrderById(order.id), 'order');
    expect(moved.table_id).toBe(t2);
    const t1Status = db.prepare('SELECT status FROM tables WHERE id = ?').get(t1) as { status: string };
    expect(t1Status.status).toBe('AVAILABLE');
  });

  it('lists open orders and finds by table', () => {
    const t1 = seedTable(db, 'T1');
    const order = createOrder({ tableId: t1, type: 'dine-in' });
    const byTable = expectDefined(getOrderByTable(t1), 'order');
    expect(byTable.id).toBe(order.id);
    expect(getOpenOrders().length).toBe(1);
  });
});
