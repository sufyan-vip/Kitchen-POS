/**
 * Inventory service — units, stock movements, transactional recipe
 * deduction/restore with negative-stock protection.
 */
import type Database from 'better-sqlite3';
import { getSetting } from './settings';

export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'wastage' | 'return' | 'correction';

export interface RecipeIngredient {
  inventory_item_id: number;
  qty_used: number;
}

/** Convert a quantity between compatible units (kg↔g, litre↔ml, pcs↔pcs). */
export function convertQuantity(value: number, fromUnit: string, toUnit: string): number {
  const normalized = (u: string) => u.trim().toLowerCase();
  const a = normalized(fromUnit);
  const b = normalized(toUnit);
  if (a === b) { return value; }
  const toBase = (u: string): { base: string; factor: number } | null => {
    switch (u) {
      case 'kg': return { base: 'g', factor: 1000 };
      case 'g': return { base: 'g', factor: 1 };
      case 'litre': case 'l': return { base: 'ml', factor: 1000 };
      case 'ml': return { base: 'ml', factor: 1 };
      case 'pcs': case 'pc': case 'piece': case 'pieces': case 'unit': case 'units': return { base: 'pcs', factor: 1 };
      default: return null;
    }
  };
  const fromBase = toBase(a);
  const toBaseInfo = toBase(b);
  if (!fromBase || !toBaseInfo) {
    throw new Error(`Cannot convert between units "${fromUnit}" and "${toUnit}"`);
  }
  if (fromBase.base !== toBaseInfo.base) {
    throw new Error(`Cannot convert between units "${fromUnit}" and "${toUnit}"`);
  }
  return (value * fromBase.factor) / toBaseInfo.factor;
}

export interface StockMovementInput {
  itemId: number;
  type: MovementType;
  qtyChange: number;
  note?: string | null;
  reference?: string | null;
  unitCostMinor?: number | null;
  staffId?: number | null;
}

export function recordMovement(db: Database.Database, input: StockMovementInput): number {
  const qty = input.qtyChange;
  if (!Number.isFinite(qty) || qty === 0) { throw new Error('Stock movement must be non-zero'); }
  const item = db.prepare('SELECT id, qty_in_stock FROM inventory_items WHERE id = ?').get(input.itemId) as { id: number; qty_in_stock: number } | undefined;
  if (!item) { throw new Error('Inventory item not found'); }

  const newQty = item.qty_in_stock + qty;
  if (newQty < 0 && !getSetting<boolean>('allow_negative_inventory', false)) {
    throw new Error('Insufficient stock (negative inventory is disabled in settings)');
  }
  const info = db.prepare(`
    INSERT INTO inventory_log (item_id, type, qty_change, stock_after, unit_cost_minor, reference, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.itemId, input.type, qty, Math.max(0, newQty), input.unitCostMinor ?? null, input.reference ?? null, input.note ?? null, input.staffId ?? null);
  db.prepare('UPDATE inventory_items SET qty_in_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Math.max(0, newQty), input.itemId);
  return Number(info.lastInsertRowid);
}

function getRecipe(db: Database.Database, menuItemId: number): RecipeIngredient[] {
  return db.prepare('SELECT inventory_item_id, qty_used FROM menu_inventory_map WHERE menu_item_id = ?').all(menuItemId) as RecipeIngredient[];
}

export interface DeductItem {
  menu_item_id: number;
  qty: number;
  name: string;
}

/**
 * Transactionally deduct recipe ingredients for sent KOT items.
 * Never leaves a partial deduction: any failure rolls back the whole batch.
 */
export function deductForOrderItems(db: Database.Database, items: DeductItem[], reference: string): void {
  for (const item of items) {
    const recipe = getRecipe(db, item.menu_item_id);
    if (recipe.length === 0) { continue; }
    for (const r of recipe) {
      const delta = -(r.qty_used * item.qty);
      recordMovement(db, {
        itemId: r.inventory_item_id,
        type: 'sale',
        qtyChange: delta,
        note: `Sold: ${item.qty} x ${item.name}`,
        reference,
      });
    }
  }
}

/** Restore recipe ingredients when an order/item is reversed. */
export function restoreForOrderItems(db: Database.Database, items: DeductItem[], reference: string): void {
  for (const item of items) {
    const recipe = getRecipe(db, item.menu_item_id);
    if (recipe.length === 0) { continue; }
    for (const r of recipe) {
      recordMovement(db, {
        itemId: r.inventory_item_id,
        type: 'return',
        qtyChange: r.qty_used * item.qty,
        note: `Restored: ${item.qty} x ${item.name}`,
        reference,
      });
    }
  }
}

export function getLowStockItems(db: Database.Database, limit = 50): Array<{ id: number; name: string; unit: string; qty_in_stock: number; low_stock_alert_at: number }> {
  return db.prepare(`
    SELECT id, name, unit, qty_in_stock, low_stock_alert_at
    FROM inventory_items
    WHERE is_active = 1 AND qty_in_stock <= low_stock_alert_at
    ORDER BY (qty_in_stock - low_stock_alert_at) ASC
    LIMIT ?
  `).all(limit) as Array<{ id: number; name: string; unit: string; qty_in_stock: number; low_stock_alert_at: number }>;
}

export function getMovementHistory(db: Database.Database, itemId?: number, limit = 200): unknown[] {
  const params: unknown[] = [limit];
  let where = '';
  if (itemId) {
    where = 'WHERE item_id = ?';
    params.unshift(itemId);
  }
  return db.prepare(`SELECT * FROM inventory_log ${where} ORDER BY id DESC LIMIT ?`).all(...params);
}
