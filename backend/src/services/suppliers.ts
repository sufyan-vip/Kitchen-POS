/**
 * Suppliers & purchasing. Receiving a purchase generates inventory stock
 * movements ('purchase') with the unit cost recorded for valuation.
 */
import type Database from 'better-sqlite3';
import { getDB } from '../db';
import { writeAuditLog } from './audit';
import { assertCurrentPermission } from './authz';
import { toMinorUnits } from './money';
import { recordMovement } from './inventory-service';

export interface SupplierInput {
  id?: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active?: number | boolean;
}

export interface PurchaseItemInput {
  inventory_item_id: number;
  qty: number;
  unit_cost: number | string;
}

export interface PurchaseInput {
  id?: number;
  supplier_id: number;
  items: PurchaseItemInput[];
  note?: string | null;
}

function db(): Database.Database { return getDB(); }

function cleanText(value: string | null | undefined, max = 300): string | null {
  if (value === undefined || value === null) { return null; }
  const s = value.trim();
  return s ? s.slice(0, max) : null;
}

export function listSuppliers(includeInactive = false): unknown[] {
  assertCurrentPermission('suppliers_view');
  const activeClause = includeInactive ? '' : 'WHERE is_active = 1';
  return db().prepare(`SELECT * FROM suppliers ${activeClause} ORDER BY is_active DESC, name`).all();
}

export function saveSupplier(input: SupplierInput): { id: number } {
  assertCurrentPermission('suppliers_manage');
  const name = cleanText(input.name, 150);
  if (!name) { throw new Error('Supplier name is required'); }
  const database = db();
  let isActive = 1;
  if (input.is_active !== undefined) { isActive = input.is_active ? 1 : 0; }
  if (input.id !== undefined) {
    const id = input.id;
    const result = database.prepare(`
      UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, cleanText(input.phone, 60), cleanText(input.email, 150), cleanText(input.address, 300), cleanText(input.notes, 1000), isActive, id);
    if (result.changes === 0) { throw new Error('Supplier not found'); }
    writeAuditLog(database, { action: 'update', entityType: 'supplier', entityId: id, details: { name } });
    return { id };
  }
  const info = database.prepare('INSERT INTO suppliers (name, phone, email, address, notes, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, cleanText(input.phone, 60), cleanText(input.email, 150), cleanText(input.address, 300), cleanText(input.notes, 1000), isActive);
  const id = Number(info.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'supplier', entityId: id, details: { name } });
  return { id };
}

export function listPurchases(supplierId?: number, limit = 200): unknown[] {
  assertCurrentPermission('purchasing_view');
  const params: unknown[] = [];
  let where = '';
  if (supplierId) {
    where = 'WHERE p.supplier_id = ?';
    params.push(supplierId);
  }
  params.push(Math.min(Math.max(Math.trunc(limit), 1), 500));
  return db().prepare(`
    SELECT p.*, s.name AS supplier_name
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    ${where} ORDER BY p.id DESC LIMIT ?
  `).all(...params);
}

export function getPurchaseItems(purchaseId: number): unknown[] {
  assertCurrentPermission('purchasing_view');
  return db().prepare(`
    SELECT pi.*, ii.name AS item_name, ii.unit
    FROM purchase_items pi JOIN inventory_items ii ON ii.id = pi.inventory_item_id
    WHERE pi.purchase_id = ?
  `).all(purchaseId);
}

export function createPurchase(input: PurchaseInput): { id: number; purchase_number: string } {
  assertCurrentPermission('purchasing_manage');
  if (input.items.length === 0) { throw new Error('Purchase must contain at least one item'); }
  const supplierId = Math.trunc(input.supplier_id);
  if (!Number.isFinite(supplierId) || supplierId <= 0) { throw new Error('Supplier is required'); }
  const database = db();

  return database.transaction(() => {
    const supplier = database.prepare('SELECT id FROM suppliers WHERE id = ? AND is_active = 1').get(supplierId);
    if (!supplier) { throw new Error('Supplier not found or inactive'); }

    let totalMinor = 0;
    const lines: Array<{ inventory_item_id: number; qty: number; unit_cost_minor: number; line_total_minor: number }> = [];
    for (const raw of input.items) {
      const inventoryItemId = Math.trunc(raw.inventory_item_id);
      const qty = raw.qty;
      if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) { throw new Error('Invalid inventory item'); }
      if (!Number.isFinite(qty) || qty <= 0) { throw new Error('Purchase quantity must be positive'); }
      const unitCostMinor = toMinorUnits(raw.unit_cost);
      if (unitCostMinor < 0) { throw new Error('Unit cost cannot be negative'); }
      const lineTotal = Math.round(unitCostMinor * qty);
      totalMinor += lineTotal;
      lines.push({ inventory_item_id: inventoryItemId, qty, unit_cost_minor: unitCostMinor, line_total_minor: lineTotal });
    }

    const seq = (database.prepare("SELECT value FROM counters WHERE name = 'purchase'").get() as { value: number } | undefined)?.value ?? 0;
    const purchaseNumber = `PO-${String(seq + 1).padStart(6, '0')}`;
    database.prepare("INSERT INTO counters (name, value) VALUES ('purchase', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(seq + 1);

    const info = database.prepare(`
      INSERT INTO purchases (purchase_number, supplier_id, status, total_minor, note, created_by)
      VALUES (?, ?, 'ORDERED', ?, ?, ?)
    `).run(purchaseNumber, supplierId, totalMinor, cleanText(input.note, 1000), null);
    const purchaseId = Number(info.lastInsertRowid);
    const insertLine = database.prepare(`
      INSERT INTO purchase_items (purchase_id, inventory_item_id, qty, unit_cost_minor, line_total_minor)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const line of lines) { insertLine.run(purchaseId, line.inventory_item_id, line.qty, line.unit_cost_minor, line.line_total_minor); }

    writeAuditLog(database, { action: 'create', entityType: 'purchase', entityId: purchaseId, details: { purchase_number: purchaseNumber, supplierId, total_minor: totalMinor } });
    return { id: purchaseId, purchase_number: purchaseNumber };
  })();
}

/**
 * Receive a purchase: marks it RECEIVED and generates 'purchase' stock
 * movements with the recorded unit costs. Idempotent — receiving twice is
 * rejected; partial receiving is not supported (receive the whole PO).
 */
export function receivePurchase(purchaseId: number): { id: number; purchase_number: string } {
  assertCurrentPermission('purchasing_manage');
  const database = db();
  return database.transaction(() => {
    const purchase = database.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as
      | { id: number; purchase_number: string; status: string } | undefined;
    if (!purchase) { throw new Error('Purchase not found'); }
    if (purchase.status === 'RECEIVED') { throw new Error('Purchase already received'); }
    if (purchase.status === 'CANCELLED') { throw new Error('Cancelled purchase cannot be received'); }

    const lines = database.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId) as
      Array<{ id: number; inventory_item_id: number; qty: number; unit_cost_minor: number }>;

    for (const line of lines) {
      recordMovement(database, {
        itemId: line.inventory_item_id,
        type: 'purchase',
        qtyChange: line.qty,
        unitCostMinor: line.unit_cost_minor,
        reference: purchase.purchase_number,
        note: `Purchase received (${purchase.purchase_number})`,
      });
      database.prepare('UPDATE purchase_items SET received_qty = qty WHERE id = ?').run(line.id);
    }

    database.prepare("UPDATE purchases SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(purchaseId);
    writeAuditLog(database, { action: 'received', entityType: 'purchase', entityId: purchaseId, details: { purchase_number: purchase.purchase_number, lines: lines.length } });
    return { id: purchaseId, purchase_number: purchase.purchase_number };
  })();
}

export function cancelPurchase(purchaseId: number): void {
  assertCurrentPermission('purchasing_manage');
  const database = db();
  database.transaction(() => {
    const purchase = database.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as { id: number; status: string; purchase_number: string } | undefined;
    if (!purchase) { throw new Error('Purchase not found'); }
    if (purchase.status === 'RECEIVED') { throw new Error('Received purchases cannot be cancelled; reverse stock manually'); }
    database.prepare("UPDATE purchases SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(purchaseId);
    writeAuditLog(database, { action: 'cancelled', entityType: 'purchase', entityId: purchaseId, details: { purchase_number: purchase.purchase_number } });
  })();
}
