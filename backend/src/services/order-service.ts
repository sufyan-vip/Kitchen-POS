/**
 * Order lifecycle service — the authoritative layer for cart, KOT, discounts,
 * table assignment and order status transitions. All pricing flows through
 * pricing.ts (integer minor units). Renderer inputs are validated here; the
 * frontend never supplies totals.
 */
import type Database from 'better-sqlite3';
import { getDB } from '../db';
import { nextCounterNumber } from './counters';
import { writeAuditLog } from './audit';
import { assertCurrentPermission } from './authz';
import {
  OrderLineInput,
  OrderDiscount,
  priceOrderLine,
  computeOrderTotals,
  getOrderPricingSettings,
  assertValidOrderTransition,
  assertValidKDSTransition,
  OrderStatus,
  KDSStatus,
} from './pricing';
import { deductForOrderItems, restoreForOrderItems } from './inventory-service';
import { getSetting } from './settings';

export interface SendKOTResult {
  kotId: number;
  kotNumber: number;
  orderId: number;
  orderNumber: string;
  kotType: 'MAIN' | 'ADDITIONAL';
  items: Array<{ order_item_id: number; name: string; qty: number; variant_name: string | null; modifier_snapshot: string | null; note: string | null; line_total_minor: number }>;
}

export interface OrderRow {
  id: number;
  order_number: string;
  table_id: number | null;
  staff_id: number | null;
  customer_id: number | null;
  status: string;
  kds_status: string;
  type: 'dine-in' | 'takeaway' | 'delivery';
  covers: number;
  note: string | null;
  business_date: string | null;
  discount_type: 'PERCENT' | 'FIXED' | null;
  discount_percent: number | null;
  discount_minor: number;
  subtotal_minor: number;
  taxable_minor: number;
  tax_minor: number;
  service_charge_minor: number;
  delivery_charge_minor: number;
  total_minor: number;
  total_paid_minor: number;
  tax_name: string | null;
  tax_rate: number;
  tax_mode: 'exclusive' | 'inclusive';
  delivery_address: string | null;
  delivery_partner: string | null;
  kot_counter: number;
  completed_at: string | null;
  cancelled_by: number | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  menu_item_id: number;
  name: string;
  qty: number;
  unit_price: number;
  unit_price_minor: number | null;
  discount: number;
  discount_minor: number | null;
  tax_name: string | null;
  tax_rate: number | null;
  tax_mode: string | null;
  cgst_rate: number;
  sgst_rate: number;
  hsn_code: string | null;
  kot_printed: number;
  kot_number: number | null;
  preparation_status: 'pending' | 'preparing' | 'ready' | 'served';
  prepared_at: string | null;
  served_at: string | null;
  variant_id: number | null;
  variant_name: string | null;
  modifier_snapshot: string | null;
  line_total_minor: number | null;
  note: string | null;
  created_at: string | null;
}

function db(): Database.Database {
  return getDB();
}

export function getOrderById(orderId: number): OrderRow | null {
  const order = db().prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRow | undefined;
  return order ?? null;
}

/** Read an order inside a transaction, throwing when it is missing. */
function mustGetOrder(database: Database.Database, orderId: number): OrderRow {
  const order = database.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRow | undefined;
  if (!order) { throw new Error('Order not found'); }
  return order;
}

export function getOrderItems(orderId: number): OrderItemRow[] {
  return db().prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as OrderItemRow[];
}

export function getOpenOrders(): OrderRow[] {
  return db().prepare(
    "SELECT * FROM orders WHERE status NOT IN ('DRAFT','COMPLETED','CANCELLED') ORDER BY created_at"
  ).all() as OrderRow[];
}

/** Latest server-side draft cart (persistent store before the order is sent to kitchen). */
export function getLatestDraftOrder(): OrderRow | null {
  const order = db().prepare(
    "SELECT * FROM orders WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1"
  ).get() as OrderRow | undefined;
  return order ?? null;
}

export function discardDraftOrder(orderId?: number): void {
  assertCurrentPermission('orders_create');
  const database = db();
  database.transaction(() => {
    const target = orderId
      ? getOrderById(orderId)
      : database.prepare("SELECT * FROM orders WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1").get() as OrderRow | undefined;
    if (!target) { throw new Error('No draft cart found'); }
    if (target.status !== 'DRAFT') { throw new Error('Only draft carts can be discarded'); }
    database.prepare('DELETE FROM order_items WHERE order_id = ?').run(target.id);
    database.prepare(`UPDATE orders SET status = 'CANCELLED', kds_status = 'CANCELLED', cancel_reason = 'Draft cart discarded', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(target.id);
    if (target.table_id) { releaseTable(target.table_id); }
    writeAuditLog(database, { action: 'draft_discarded', entityType: 'order', entityId: target.id, details: { order_number: target.order_number } });
  })();
}

export function getOrderByTable(tableId: number): OrderRow | null {
  const order = db().prepare(
    "SELECT * FROM orders WHERE table_id = ? AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1"
  ).get(tableId) as OrderRow | undefined;
  return order ?? null;
}

export function createOrder(input: {
  tableId?: number | null;
  staffId?: number;
  customerId?: number;
  type?: 'dine-in' | 'takeaway' | 'delivery';
  covers?: number;
  note?: string;
  status?: 'DRAFT' | 'OPEN';
}): { id: number; order_number: string } {
  assertCurrentPermission('orders_create');
  const database = db();
  const type = input.type ?? (input.tableId ? 'dine-in' : 'takeaway');
  if (!['dine-in', 'takeaway', 'delivery'].includes(type)) { throw new Error('Invalid order type'); }
  const tableId = type === 'dine-in' ? (input.tableId ?? null) : null;
  const initialStatus = input.status === 'DRAFT' ? 'DRAFT' : 'OPEN';

  return database.transaction(() => {
    if (tableId) {
      const table = database.prepare('SELECT id, is_active FROM tables WHERE id = ?').get(tableId) as { id: number; is_active: number } | undefined;
      if (!table) { throw new Error('Table not found'); }
      if (!table.is_active) { throw new Error('Table is disabled'); }
      const existing = getOrderByTable(tableId);
      if (existing) { throw new Error(`Table already has an active order (${existing.order_number})`); }
    }
    const orderNumber = `ORD-${String(nextCounterNumber(database, 'order')).padStart(6, '0')}`;
    const businessDate = (database.prepare("SELECT business_date FROM business_sessions WHERE status = 'open' LIMIT 1").get() as { business_date: string } | undefined)?.business_date ?? null;
    const info = database.prepare(`
      INSERT INTO orders (order_number, table_id, staff_id, customer_id, status, kds_status, type, covers, note, business_date)
      VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)
    `).run(orderNumber, tableId ?? null, input.staffId ?? null, input.customerId ?? null, initialStatus, type, Math.max(1, Math.trunc(input.covers ?? 1)), input.note ?? null, businessDate);
    const id = Number(info.lastInsertRowid);
    if (tableId) { occupyTable(tableId); }
    writeAuditLog(database, { action: 'create', entityType: 'order', entityId: id, details: { order_number: orderNumber, type, tableId } });
    return { id, order_number: orderNumber };
  })();
}

/** Normalise a stored tax-mode string, falling back to the configured mode. */
function toTaxMode(value: string | null | undefined, fallback: 'exclusive' | 'inclusive'): 'exclusive' | 'inclusive' {
  if (value === 'inclusive') { return 'inclusive'; }
  if (value === 'exclusive') { return 'exclusive'; }
  return fallback;
}

/**
 * Add validated lines to an order (DRAFT/OPEN only). Prices are snapshotted
 * from the menu at this moment — later menu changes never alter the order.
 */
export function addItemsToOrder(orderId: number, lines: OrderLineInput[], _staffId?: number, options: { keepDraft?: boolean } = {}): { added: number; order: OrderRow } {
  assertCurrentPermission('orders_create');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Closed orders cannot be edited'); }

    const settings = getOrderPricingSettings();
    let added = 0;
    for (const line of lines) {
      const priced = priceOrderLine(database, line, {
      enabled: settings.taxEnabled,
      name: settings.taxName,
      rate: settings.taxRate,
      mode: settings.taxMode,
    });
      const info = database.prepare(`
        INSERT INTO order_items (
          order_id, menu_item_id, name, qty, unit_price, unit_price_minor, cgst_rate, sgst_rate, hsn_code,
          note, preparation_status, kot_printed, discount_minor, tax_name, tax_rate, tax_mode,
          variant_id, variant_name, modifier_snapshot, line_total_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, 'pending', 0, 0, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        orderId, priced.menu_item_id, priced.name, priced.qty,
        priced.unit_price_minor / 100, priced.unit_price_minor,
        priced.note, priced.tax_name, priced.tax_rate, priced.tax_mode,
        priced.variant_id, priced.variant_name,
        priced.modifier_snapshot.length > 0 ? JSON.stringify(priced.modifier_snapshot) : null,
        priced.line_total_minor,
      );
      added += info.changes;
    }

    const updated = recalcOrderTotals(orderId);
    if (updated.status === 'DRAFT' && !options.keepDraft) {
      database.prepare("UPDATE orders SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);
    }
    const final = mustGetOrder(database, orderId);
    writeAuditLog(database, { action: 'items_added', entityType: 'order', entityId: orderId, details: { added, total_minor: final.total_minor } });
    return { added, order: final };
  })();
}

/** Recompute authoritative totals from stored line snapshots + order discount. */
export function recalcOrderTotals(orderId: number): OrderRow {
  const database = db();
  const order = getOrderById(orderId);
  if (!order) { throw new Error('Order not found'); }
  const settings = getOrderPricingSettings();
  const items = getOrderItems(orderId);
  const lines = items.map(i => ({
    line_total_minor: (i.line_total_minor ?? (i.unit_price_minor ?? 0) * i.qty),
    tax_rate: settings.taxEnabled ? (i.tax_rate ?? settings.taxRate) : 0,
    tax_mode: toTaxMode(i.tax_mode, settings.taxMode),
    tax_enabled: settings.taxEnabled,
  }));
  const discount: OrderDiscount = order.discount_type ? { type: order.discount_type, percent: order.discount_percent ?? 0, minor: order.discount_minor } : { type: null, percent: 0, minor: 0 };
  const totals = computeOrderTotals(lines, discount, settings);
  const deliveryMinor = order.type === 'delivery' ? settings.deliveryChargeMinor : 0;

  database.prepare(`
    UPDATE orders SET
      subtotal_minor = ?, taxable_minor = ?, tax_minor = ?, discount_minor = ?,
      service_charge_minor = ?, delivery_charge_minor = ?, total_minor = ?,
      tax_name = ?, tax_rate = ?, tax_mode = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    totals.subtotal_minor, totals.taxable_minor, totals.tax_minor, totals.discount_minor,
    totals.service_charge_minor, deliveryMinor, totals.total_minor,
    settings.taxName, settings.taxRate, settings.taxMode, orderId,
  );
  return mustGetOrder(database, orderId);
}

export function updateOrderType(orderId: number, type: 'dine-in' | 'takeaway' | 'delivery', deliveryAddress?: string | null): OrderRow {
  assertCurrentPermission('orders_edit');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (!['DRAFT', 'OPEN'].includes(order.status)) { throw new Error('Order type can only be changed before sending to kitchen'); }
    if (!['dine-in', 'takeaway', 'delivery'].includes(type)) { throw new Error('Invalid order type'); }
    database.prepare('UPDATE orders SET type = ?, delivery_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(type, deliveryAddress ?? null, orderId);
    return recalcOrderTotals(orderId);
  })();
}

export function applyOrderDiscount(orderId: number, discount: OrderDiscount): OrderRow {
  assertCurrentPermission('discounts');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Completed orders cannot be discounted'); }
    const validDiscountTypes = ['PERCENT', 'FIXED'] as const;
    if (discount.type !== null && !validDiscountTypes.includes(discount.type)) { throw new Error('Invalid discount type'); }
    // FIXED discounts are stored in integer paise (discount.minor); PERCENT stores
    // the rate and recalc derives the amount from the current subtotal.
    let percent = 0;
    let fixedMinor = 0;
    if (discount.type === 'PERCENT') {
      percent = Math.min(Math.max(discount.percent || 0, 0), 100);
    } else if (discount.type === 'FIXED') {
      fixedMinor = Math.min(Math.max(Math.trunc(discount.minor) || 0, 0), 1e12);
    }
    database.prepare(`
      UPDATE orders SET discount_type = ?, discount_percent = ?, discount_minor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(discount.type, discount.type === 'PERCENT' ? percent : null, fixedMinor, orderId);
    const updated = recalcOrderTotals(orderId);
    writeAuditLog(database, { action: 'discount_applied', entityType: 'order', entityId: orderId, details: { type: discount.type, percent, minor: updated.discount_minor } });
    return updated;
  })();
}

export function updateItemQuantity(orderId: number, orderItemId: number, qty: number): OrderRow {
  assertCurrentPermission('orders_edit');
  const database = db();
  return database.transaction(() => {
    const item = database.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(orderItemId, orderId) as OrderItemRow | undefined;
    if (!item) { throw new Error('Order item not found'); }
    if (item.kot_number !== null) { throw new Error('Item already sent to kitchen; void it and re-add instead'); }
    const newQty = Math.trunc(qty);
    if (!Number.isFinite(newQty) || newQty <= 0) { throw new Error('Quantity must be a positive whole number'); }
    const unitMinor = item.unit_price_minor ?? Math.round(item.unit_price * 100);
    database.prepare('UPDATE order_items SET qty = ?, line_total_minor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newQty, unitMinor * newQty, orderItemId);
    const updated = recalcOrderTotals(orderId);
    writeAuditLog(database, { action: 'item_qty_updated', entityType: 'order_item', entityId: orderItemId, details: { orderId, qty: newQty } });
    return updated;
  })();
}

export function updateItemNote(orderId: number, orderItemId: number, note: string | null): void {
  assertCurrentPermission('orders_edit');
  const database = db();
  const item = database.prepare('SELECT id FROM order_items WHERE id = ? AND order_id = ?').get(orderItemId, orderId);
  if (!item) { throw new Error('Order item not found'); }
  database.prepare('UPDATE order_items SET note = ? WHERE id = ?').run(note?.trim() ? note.trim().slice(0, 500) : null, orderItemId);
}

/**
 * Send unsent items to the kitchen. Creates a new KOT with a monotonic,
 * duplicate-free KOT number, snapshots remain untouched, inventory is
 * deducted transactionally when auto-debit is enabled.
 */
export function sendKOT(orderId: number, staffId?: number): SendKOTResult {
  assertCurrentPermission('kot_create');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Closed orders cannot be sent to kitchen'); }
    const unsent = getOrderItems(orderId).filter(i => i.kot_number === null);
    if (unsent.length === 0) { throw new Error('No unsent items to send'); }

    const kotNumber = nextCounterNumber(database, 'kot');
    const kotType: 'MAIN' | 'ADDITIONAL' = order.kot_counter === 0 ? 'MAIN' : 'ADDITIONAL';
    const info = database.prepare(`
      INSERT INTO kots (kot_number, order_id, table_id, kot_type, status, printed, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'NEW', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(kotNumber, orderId, order.table_id, kotType, staffId ?? null);

    const mark = database.prepare('UPDATE order_items SET kot_number = ?, kot_printed = 0 WHERE id = ?');
    for (const item of unsent) { mark.run(kotNumber, item.id); }

    if (getSetting<boolean>('inventory_auto_debit', true)) {
      deductForOrderItems(database, unsent.map(i => ({ menu_item_id: i.menu_item_id, qty: i.qty, name: i.name })), `Order ${order.order_number} KOT #${kotNumber}`);
    }

    database.prepare(`
      UPDATE orders SET status = 'SENT_TO_KITCHEN', kds_status = 'NEW', kot_counter = kot_counter + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(orderId);

    const items = getOrderItems(orderId).filter(i => i.kot_number === kotNumber).map(i => ({
      order_item_id: i.id,
      name: i.name,
      qty: i.qty,
      variant_name: i.variant_name,
      modifier_snapshot: i.modifier_snapshot,
      note: i.note,
      line_total_minor: i.line_total_minor ?? 0,
    }));

    writeAuditLog(database, { action: 'kot_created', entityType: 'kot', entityId: Number(info.lastInsertRowid), details: { orderId, order_number: order.order_number, kot_number: kotNumber, kot_type: kotType, items: items.length } });
    return { kotId: Number(info.lastInsertRowid), kotNumber, orderId, orderNumber: order.order_number, kotType, items };
  })();
}

export function updateOrderStatus(orderId: number, to: OrderStatus, reason?: string): OrderRow {
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (to === 'CANCELLED') {
      return cancelOrder(orderId, reason ?? 'Cancelled', undefined);
    }
    if (to === 'COMPLETED') {
      // Completing must go through billing (payments first)
      throw new Error('Complete an order through billing');
    }
    assertValidOrderTransition(order.status, to);
    database.prepare(`
      UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? IN ('COMPLETED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `).run(to, to, orderId);
    writeAuditLog(database, { action: 'order_status', entityType: 'order', entityId: orderId, details: { from: order.status, to } });
    return mustGetOrder(database, orderId);
  })();
}

export function updateOrderKDSStatus(orderId: number, to: KDSStatus, staffId?: number): OrderRow {
  assertCurrentPermission('kot_update');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    assertValidKDSTransition(order.kds_status, to);
    if (to === 'CANCELLED') {
      const cancelled = cancelOrder(orderId, 'Cancelled from kitchen', staffId);
      return cancelled;
    }
    database.prepare('UPDATE orders SET kds_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(to, orderId);
    if (to === 'PREPARING' && order.status === 'SENT_TO_KITCHEN') {
      database.prepare("UPDATE orders SET status = 'PREPARING' WHERE id = ?").run(orderId);
    } else if (to === 'READY' && ['SENT_TO_KITCHEN', 'PREPARING'].includes(order.status)) {
      database.prepare("UPDATE orders SET status = 'READY' WHERE id = ?").run(orderId);
    } else if (to === 'COMPLETED' && order.status === 'READY') {
      database.prepare("UPDATE orders SET status = 'SERVED' WHERE id = ?").run(orderId);
    }
    writeAuditLog(database, { action: 'kds_status', entityType: 'order', entityId: orderId, details: { from: order.kds_status, to } });
    return mustGetOrder(database, orderId);
  })();
}

export function updateKOTStatus(kotId: number, to: KDSStatus, _staffId?: number): { kot: unknown; order: OrderRow } {
  assertCurrentPermission('kot_update');
  const database = db();
  return database.transaction(() => {
    const kot = database.prepare('SELECT * FROM kots WHERE id = ?').get(kotId) as { id: number; kot_number: number; order_id: number; status: string } | undefined;
    if (!kot) { throw new Error('KOT not found'); }
    assertValidKDSTransition(kot.status, to);
    database.prepare('UPDATE kots SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(to, kotId);
    writeAuditLog(database, { action: 'kot_status', entityType: 'kot', entityId: kotId, details: { kot_number: kot.kot_number, from: kot.status, to } });
    const updatedKot = database.prepare('SELECT * FROM kots WHERE id = ?').get(kotId);
    return { kot: updatedKot, order: updateOrderKDSStatusInternal(database, kot.order_id) };
  })();
}

function updateOrderKDSStatusInternal(database: Database.Database, orderId: number): OrderRow {
  const order = getOrderById(orderId);
  if (!order) { throw new Error('Order not found'); }
  const kots = database.prepare("SELECT status FROM kots WHERE order_id = ? AND status != 'CANCELLED'").all(orderId) as { status: string }[];
  if (kots.length === 0) { return order; }
  let next: KDSStatus = 'NEW';
  if (kots.every(k => k.status === 'COMPLETED')) {
    next = 'COMPLETED';
  } else if (kots.every(k => k.status === 'COMPLETED' || k.status === 'READY')) {
    next = 'READY';
  } else if (kots.some(k => k.status === 'PREPARING' || k.status === 'READY' || k.status === 'COMPLETED')) {
    next = 'PREPARING';
  }
  const statusMap: Record<string, OrderStatus> = { NEW: 'SENT_TO_KITCHEN', PREPARING: 'PREPARING', READY: 'READY', COMPLETED: 'SERVED' };
  database.prepare('UPDATE orders SET kds_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, orderId);
  if (order.status !== 'SERVED' && order.status !== 'COMPLETED') {
    database.prepare('UPDATE orders SET status = ? WHERE id = ?').run(statusMap[next], orderId);
  }
  return mustGetOrder(database, orderId);
}

export function updateItemPreparationStatus(orderItemId: number, status: 'pending' | 'preparing' | 'ready' | 'served'): OrderRow {
  assertCurrentPermission('kot_update');
  const database = db();
  return database.transaction(() => {
    const item = database.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId) as OrderItemRow | undefined;
    if (!item) { throw new Error('Order item not found'); }
    if (status === 'ready') {
      database.prepare("UPDATE order_items SET preparation_status = 'ready', prepared_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderItemId);
    } else if (status === 'served') {
      database.prepare("UPDATE order_items SET preparation_status = 'served', served_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderItemId);
    } else {
      database.prepare("UPDATE order_items SET preparation_status = ?, prepared_at = NULL, served_at = NULL WHERE id = ?").run(status, orderItemId);
    }
    // Derive KDS/order status from item state
    const items = database.prepare("SELECT preparation_status FROM order_items WHERE order_id = ?").all(item.order_id) as { preparation_status: string }[];
    const active = items.filter(i => i.preparation_status !== 'served');
    let kdsNext: KDSStatus;
    if (active.length === 0) { kdsNext = 'COMPLETED'; }
    else if (active.every(i => i.preparation_status === 'ready')) { kdsNext = 'READY'; }
    else if (active.some(i => ['preparing', 'ready'].includes(i.preparation_status))) { kdsNext = 'PREPARING'; }
    else { kdsNext = 'NEW'; }
    database.prepare('UPDATE orders SET kds_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(kdsNext, item.order_id);
    const order = mustGetOrder(database, item.order_id);
    if (kdsNext === 'PREPARING' && order.status === 'SENT_TO_KITCHEN') { database.prepare("UPDATE orders SET status = 'PREPARING' WHERE id = ?").run(order.id); }
    if (kdsNext === 'READY' && ['SENT_TO_KITCHEN', 'PREPARING'].includes(order.status)) { database.prepare("UPDATE orders SET status = 'READY' WHERE id = ?").run(order.id); }
    if (kdsNext === 'COMPLETED' && order.status === 'READY') { database.prepare("UPDATE orders SET status = 'SERVED' WHERE id = ?").run(order.id); }
    writeAuditLog(database, { action: 'item_prep_status', entityType: 'order_item', entityId: orderItemId, details: { to: status } });
    return mustGetOrder(database, item.order_id);
  })();
}

/** Void a single order item (permission: voids). Restores inventory if auto-debit. */
export function voidOrderItem(orderId: number, orderItemId: number, reason?: string): OrderRow {
  assertCurrentPermission('voids');
  const database = db();
  return database.transaction(() => {
    const item = database.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(orderItemId, orderId) as OrderItemRow | undefined;
    if (!item) { throw new Error('Order item not found'); }
    const order = mustGetOrder(database, orderId);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Closed orders cannot be edited'); }
    if (getSetting<boolean>('inventory_auto_debit', true) && item.kot_number !== null) {
      restoreForOrderItems(database, [{ menu_item_id: item.menu_item_id, qty: item.qty, name: item.name }], `Order ${order.order_number} item voided: ${reason ?? ''}`.trim());
    }
    database.prepare('DELETE FROM order_items WHERE id = ?').run(orderItemId);
    const updated = recalcOrderTotals(orderId);
    writeAuditLog(database, { action: 'item_voided', entityType: 'order_item', entityId: orderItemId, details: { orderId, reason: reason ?? null } });
    return updated;
  })();
}

/** Cancel an order (permission: voids). Restores inventory and releases the table. */
export function cancelOrder(orderId: number, reason?: string, staffId?: number): OrderRow {
  assertCurrentPermission('voids');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Order already closed'); }
    const paid = database.prepare("SELECT COALESCE(SUM(amount_minor),0) AS paid FROM payments WHERE order_id = ? AND status = 'PAID'").get(orderId) as { paid: number };
    if (paid.paid > 0) { throw new Error('Order has settled payments; issue a refund before cancelling'); }

    if (getSetting<boolean>('inventory_auto_debit', true)) {
      const items = getOrderItems(orderId).filter(i => i.kot_number !== null);
      restoreForOrderItems(database, items.map(i => ({ menu_item_id: i.menu_item_id, qty: i.qty, name: i.name })), `Order ${order.order_number} cancelled: ${reason ?? ''}`.trim());
    }
    database.prepare(`
      UPDATE orders SET status = 'CANCELLED', kds_status = 'CANCELLED', cancel_reason = ?, cancelled_by = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(reason ?? null, staffId ?? null, orderId);
    database.prepare("UPDATE kots SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status != 'COMPLETED'").run(orderId);
    if (order.table_id) { releaseTable(order.table_id); }
    writeAuditLog(database, { action: 'cancelled', entityType: 'order', entityId: orderId, details: { reason: reason ?? null } });
    return mustGetOrder(database, orderId);
  })();
}

/** Move a dine-in order to another table (blocks conflicting active orders). */
export function changeOrderTable(orderId: number, newTableId: number): OrderRow {
  assertCurrentPermission('orders_edit');
  const database = db();
  return database.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Closed orders cannot be moved'); }
    if (order.type !== 'dine-in') { throw new Error('Only dine-in orders can be assigned to a table'); }
    const table = database.prepare('SELECT id, is_active FROM tables WHERE id = ?').get(newTableId) as { id: number; is_active: number } | undefined;
    if (!table?.is_active) { throw new Error('Target table not found or disabled'); }
    const conflict = getOrderByTable(newTableId);
    if (conflict && conflict.id !== orderId) { throw new Error(`Table already has an active order (${conflict.order_number})`); }
    database.prepare('UPDATE orders SET table_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTableId, orderId);
    database.prepare('UPDATE kots SET table_id = ? WHERE order_id = ?').run(newTableId, orderId);
    releaseTable(order.table_id);
    database.prepare("UPDATE tables SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newTableId);
    writeAuditLog(database, { action: 'table_changed', entityType: 'order', entityId: orderId, details: { from: order.table_id, to: newTableId } });
    return mustGetOrder(database, orderId);
  })();
}

/** Mark the table free (called after billing completes or order cancels). */
export function releaseTable(tableId: number | null): void {
  if (!tableId) { return; }
  const database = db();
  const hasOtherOpen = database.prepare(
    "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1"
  ).get(tableId);
  if (hasOtherOpen) { return; }
  database.prepare("UPDATE tables SET status = 'AVAILABLE', custom_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(tableId);
  writeAuditLog(database, { action: 'table_released', entityType: 'table', entityId: tableId });
}

/** Occupy a table for an open dine-in order. */
export function occupyTable(tableId: number): void {
  const database = db();
  database.prepare("UPDATE tables SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(tableId);
}


