import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cancelPurchase, createPurchase, listPurchases, receivePurchase, saveSupplier } from './suppliers';
import { convertQuantity, recordMovement } from './inventory-service';
import { createTestDb, mockElectron, resetAuth, setupSettings, teardown } from '../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

describe('suppliers & purchasing', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({});
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  it('creates and lists suppliers', () => {
    const { id } = saveSupplier({ name: 'Meat Wholesale', phone: '0300-1111111', address: 'Karachi' });
    const suppliers = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as { name: string; phone: string; address: string; is_active: number };
    expect(suppliers.name).toBe('Meat Wholesale');
    expect(suppliers.phone).toBe('0300-1111111');
    expect(suppliers.is_active).toBe(1);
  });

  it('creates purchases with monotonic PO numbers', () => {
    const supplierId = saveSupplier({ name: 'Veggies Ltd' }).id;
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock, low_stock_alert_at) VALUES ('Tomato', 'kg', 5, 2)").run().lastInsertRowid);
    const po1 = createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 10, unit_cost: 150 }] });
    const po2 = createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 5, unit_cost: 150 }] });
    expect(po1.purchase_number).toBe('PO-000001');
    expect(po2.purchase_number).toBe('PO-000002');
    expect(db.prepare('SELECT total_minor FROM purchases WHERE id = ?').get(po1.id) as { total_minor: number }).toEqual({ total_minor: 150000 });
  });

  it('receives a purchase and generates stock movements', () => {
    const supplierId = saveSupplier({ name: 'Veggies Ltd' }).id;
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock, low_stock_alert_at) VALUES ('Tomato', 'kg', 5, 2)").run().lastInsertRowid);
    const po = createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 10, unit_cost: 150 }] });
    const before = (db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(invId) as { qty_in_stock: number }).qty_in_stock;
    receivePurchase(po.id);
    const after = (db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(invId) as { qty_in_stock: number }).qty_in_stock;
    expect(after).toBe(before + 10);
    const movement = db.prepare("SELECT type, qty_change, unit_cost_minor, reference FROM inventory_log WHERE item_id = ? AND type = 'purchase'").get(invId) as { type: string; qty_change: number; unit_cost_minor: number; reference: string };
    expect(movement.qty_change).toBe(10);
    expect(movement.unit_cost_minor).toBe(15000);
    expect(movement.reference).toBe('PO-000001');
    expect((db.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }).status).toBe('RECEIVED');
    expect(() => receivePurchase(po.id)).toThrow(/already received/);
  });

  it('cancels an open purchase; rejects cancelling received ones', () => {
    const supplierId = saveSupplier({ name: 'Veggies Ltd' }).id;
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit) VALUES ('Tomato', 'kg')").run().lastInsertRowid);
    const po = createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 1, unit_cost: 100 }] });
    cancelPurchase(po.id);
    expect((db.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }).status).toBe('CANCELLED');
    const po2 = createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 1, unit_cost: 100 }] });
    receivePurchase(po2.id);
    expect(() => { cancelPurchase(po2.id); }).toThrow(/reverse stock manually/);
  });

  it('lists purchases with supplier names', () => {
    const supplierId = saveSupplier({ name: 'Fish Market' }).id;
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit) VALUES ('Fish', 'kg')").run().lastInsertRowid);
    createPurchase({ supplier_id: supplierId, items: [{ inventory_item_id: invId, qty: 2, unit_cost: 800 }] });
    const rows = listPurchases() as Array<{ supplier_name: string; total_minor: number }>;
    expect(rows[0].supplier_name).toBe('Fish Market');
    expect(rows[0].total_minor).toBe(160000);
  });
});

describe('inventory units and movements', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({ allow_negative_inventory: false });
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  it('converts between compatible units', () => {
    expect(convertQuantity(2, 'kg', 'g')).toBe(2000);
    expect(convertQuantity(500, 'ml', 'litre')).toBe(0.5);
    expect(convertQuantity(3, 'pcs', 'pcs')).toBe(3);
    expect(() => convertQuantity(1, 'kg', 'litre')).toThrow();
  });

  it('blocks negative stock by default', () => {
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock) VALUES ('Flour', 'kg', 1)").run().lastInsertRowid);
    expect(() => recordMovement(db, { itemId: invId, type: 'sale', qtyChange: -2 })).toThrow(/insufficient stock/i);
  });

  it('allows negative stock when the setting enables it', () => {
    setupSettings({ allow_negative_inventory: true });
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock) VALUES ('Flour', 'kg', 1)").run().lastInsertRowid);
    recordMovement(db, { itemId: invId, type: 'sale', qtyChange: -2 });
    const row = db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(invId) as { qty_in_stock: number };
    expect(row.qty_in_stock).toBe(-1); // when negative inventory is enabled, the real balance is preserved
  });

  it('records all movement types and tracks stock_after', () => {
    const invId = Number(db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock) VALUES ('Oil', 'litre', 0)").run().lastInsertRowid);
    recordMovement(db, { itemId: invId, type: 'purchase', qtyChange: 10 });
    recordMovement(db, { itemId: invId, type: 'wastage', qtyChange: -2 });
    recordMovement(db, { itemId: invId, type: 'correction', qtyChange: 1 });
    const log = db.prepare('SELECT type, qty_change, stock_after FROM inventory_log WHERE item_id = ? ORDER BY id').all(invId) as Array<{ type: string; qty_change: number; stock_after: number }>;
    expect(log.map(l => l.type)).toEqual(['purchase', 'wastage', 'correction']);
    expect(log[2].stock_after).toBe(9);
    expect((db.prepare('SELECT qty_in_stock FROM inventory_items WHERE id = ?').get(invId) as { qty_in_stock: number }).qty_in_stock).toBe(9);
  });
});
