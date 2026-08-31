import { ipcMain } from 'electron';
import { getDB } from '../db';
import {
  addItemsToOrder, applyOrderDiscount, cancelOrder, changeOrderTable, createOrder,
  getLatestDraftOrder, getOpenOrders, getOrderByTable, getOrderById, getOrderItems,
  sendKOT, updateItemNote, updateItemQuantity, updateOrderStatus,
  updateOrderType, voidOrderItem, discardDraftOrder,
} from '../services/order-service';
import { assertCurrentPermission } from '../services/authz';
import { OrderDiscount, OrderStatus } from '../services/pricing';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error occurred';
}

function wrap<T>(fn: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: fn() };
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) };
  }
}

export function registerOrdersIPC() {
  // ── Create ──────────────────────────────────────────────────────────
  ipcMain.handle('orders:create', async (_event, payload: { tableId?: number | null; staffId?: number; covers?: number; note?: string; customerId?: number; type?: 'dine-in' | 'takeaway' | 'delivery'; status?: 'DRAFT' | 'OPEN' }) => {
    return wrap(() => {
      const { id, order_number } = createOrder({
        tableId: payload.tableId ?? null,
        staffId: payload.staffId,
        customerId: payload.customerId,
        type: payload.type,
        covers: payload.covers,
        note: payload.note,
        status: payload.status,
      });
      return { id, order_number };
    });
  });

  ipcMain.handle('orders:getOpen', async () => wrap(() => getOpenOrders()));
  ipcMain.handle('orders:getDraft', async () => wrap(() => {
    const draft = getLatestDraftOrder();
    return draft ? { ...draft, items: getOrderItems(draft.id) } : null;
  }));
  ipcMain.handle('orders:discardDraft', async (_event, payload: { orderId?: number }) => wrap(() => {
    discardDraftOrder(payload.orderId);
    return true;
  }));
  ipcMain.handle('orders:getById', async (_event, payload: { orderId: number }) => wrap(() => {
    const order = getOrderById(payload.orderId);
    if (!order) { throw new Error('Order not found'); }
    return { ...order, items: getOrderItems(payload.orderId) };
  }));

  ipcMain.handle('orders:getByTable', async (_event, payload: { tableId: number }) => wrap(() => {
    const order = getOrderByTable(payload.tableId);
    if (!order) { return null; }
    const row = getDB().prepare('SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = ?').get(order.id) as Record<string, unknown>;
    return { ...row, items: getOrderItems(order.id) };
  }));

  ipcMain.handle('orders:updateCustomer', async (_event, payload: { orderId: number; customerId: number }) => wrap(() => {
    assertCurrentPermission('orders_edit');
    const db = getDB();
    const order = getOrderById(payload.orderId);
    if (!order) { throw new Error('Order not found'); }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Closed orders cannot be edited'); }
    db.prepare('UPDATE orders SET customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payload.customerId, payload.orderId);
    return true;
  }));

  // ── Cart / items ────────────────────────────────────────────────────
  ipcMain.handle('orders:addItems', async (_event, payload: { orderId: number; items: unknown[]; staffId?: number; keepDraft?: boolean }) => {
    return wrap(() => {
      const result = addItemsToOrder(payload.orderId, payload.items as never[], payload.staffId, { keepDraft: payload.keepDraft === true });
      return { added: result.added, order: result.order };
    });
  });

  ipcMain.handle('orders:updateItemQty', async (_event, payload: { orderId: number; orderItemId: number; qty: number }) =>
    wrap(() => updateItemQuantity(payload.orderId, payload.orderItemId, payload.qty)));

  ipcMain.handle('orders:updateItemNote', async (_event, payload: { orderId: number; orderItemId: number; note: string | null }) =>
    wrap(() => { updateItemNote(payload.orderId, payload.orderItemId, payload.note); return true; }));

  ipcMain.handle('orders:voidItem', async (_event, payload: { orderId: number; orderItemId: number; reason?: string }) =>
    wrap(() => voidOrderItem(payload.orderId, payload.orderItemId, payload.reason)));

  // ── KOT ─────────────────────────────────────────────────────────────
  ipcMain.handle('orders:sendKOT', async (_event, payload: { orderId: number; staffId?: number }) =>
    wrap(() => sendKOT(payload.orderId, payload.staffId)));

  ipcMain.handle('orders:updateStatus', async (_event, payload: { orderId: number; status: OrderStatus; reason?: string }) =>
    wrap(() => updateOrderStatus(payload.orderId, payload.status, payload.reason)));

  ipcMain.handle('orders:updateType', async (_event, payload: { orderId: number; type: 'dine-in' | 'takeaway' | 'delivery'; deliveryAddress?: string | null }) =>
    wrap(() => updateOrderType(payload.orderId, payload.type, payload.deliveryAddress)));

  ipcMain.handle('orders:applyDiscount', async (_event, payload: { orderId: number; discount: OrderDiscount }) =>
    wrap(() => applyOrderDiscount(payload.orderId, payload.discount)));

  ipcMain.handle('orders:changeTable', async (_event, payload: { orderId: number; tableId: number }) =>
    wrap(() => changeOrderTable(payload.orderId, payload.tableId)));

  // ── Cancellation (legacy signature kept) ────────────────────────────
  ipcMain.handle('orders:cancelOrder', async (_event, payload: { orderId: number; note?: string }) =>
    wrap(() => cancelOrder(payload.orderId, payload.note)));

  // Legacy no-op stubs removed — the renderer uses the real channels above.
  ipcMain.handle('orders:addItem', async () => ({ success: false, error: 'Use orders:addItems' }));
  ipcMain.handle('orders:updateItem', async () => ({ success: false, error: 'Use orders:updateItemQty / orders:updateItemNote' }));
  ipcMain.handle('orders:removeItem', async () => ({ success: false, error: 'Use orders:voidItem' }));

  // ── Permissions helper for the renderer ─────────────────────────────
  ipcMain.handle('auth:check', async (_event, payload: { permission: string }) => {
    try {
      assertCurrentPermission(payload.permission as never);
      return { success: true, data: true };
    } catch (_e: unknown) {
      return { success: true, data: false };
    }
  });
}
