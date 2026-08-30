import { ipcMain } from 'electron';
import { getDB } from '../db';
import { getOrderById, getOrderItems, updateItemPreparationStatus, updateKOTStatus, updateOrderKDSStatus } from '../services/order-service';
import { KDSStatus } from '../services/pricing';
import { assertCurrentPermission } from '../services/authz';

interface KDSItem {
  id: number;
  name: string;
  qty: number;
  note: string | null;
  variant_name: string | null;
  modifier_snapshot: string | null;
  preparation_status: string;
  prepared_at: string | null;
  served_at: string | null;
}

interface KDSTicket {
  kot_id: number;
  kot_number: number;
  kot_type: 'MAIN' | 'ADDITIONAL';
  kot_status: string;
  kot_created_at: string;
  order_id: number;
  order_number: string;
  order_status: string;
  order_kds_status: string;
  table_id: number | null;
  table_name: string | null;
  order_note: string | null;
  type: 'dine-in' | 'takeaway' | 'delivery';
  created_at: string;
  items: KDSItem[];
}

function fetchTickets(since?: string): KDSTicket[] {
  const db = getDB();
  const params: unknown[] = [];
  let sinceClause = '';
  if (since) {
    sinceClause = 'AND (o.updated_at > ? OR k.updated_at > ?)';
    params.push(since, since);
  }
  const kots = db.prepare(`
    SELECT k.id AS kot_id, k.kot_number, k.kot_type, k.status AS kot_status, k.created_at AS kot_created_at,
           k.table_id, k.note AS kot_note,
           o.id AS order_id, o.order_number, o.status AS order_status, o.kds_status AS order_kds_status, o.table_id AS order_table_id,
           o.note AS order_note, o.type, o.created_at
    FROM kots k
    JOIN orders o ON o.id = k.order_id
    WHERE o.status NOT IN ('COMPLETED', 'CANCELLED') AND k.status != 'CANCELLED'
      ${sinceClause}
    ORDER BY k.created_at ASC, k.id ASC
  `).all(...params) as Array<{
    kot_id: number; kot_number: number; kot_type: 'MAIN' | 'ADDITIONAL'; kot_status: string; kot_created_at: string;
    table_id: number | null; kot_note: string | null; order_id: number; order_number: string; order_status: string;
    order_kds_status: string; order_table_id: number | null; order_note: string | null; type: 'dine-in' | 'takeaway' | 'delivery'; created_at: string;
  }>;

  const tickets: KDSTicket[] = [];
  for (const kot of kots) {
    // Table name lookup — takeaway/delivery tickets have no table and must not fail
    let tableName: string | null = null;
    if (kot.table_id) {
      const tableRow = db.prepare('SELECT name FROM tables WHERE id = ?').get(kot.table_id) as { name: string } | undefined;
      tableName = tableRow?.name ?? `Table ${kot.table_id}`;
    }
    const items = db.prepare(`
      SELECT id, name, qty, note, variant_name, modifier_snapshot, preparation_status, prepared_at, served_at
      FROM order_items
      WHERE order_id = ? AND kot_number = ? AND preparation_status != 'served'
      ORDER BY id
    `).all(kot.order_id, kot.kot_number) as KDSItem[];
    if (items.length === 0) { continue; }
    tickets.push({
      kot_id: kot.kot_id,
      kot_number: kot.kot_number,
      kot_type: kot.kot_type,
      kot_status: kot.kot_status,
      kot_created_at: kot.kot_created_at,
      order_id: kot.order_id,
      order_number: kot.order_number,
      order_status: kot.order_status,
      order_kds_status: kot.order_kds_status,
      table_id: kot.table_id,
      table_name: tableName,
      order_note: kot.order_note ?? kot.kot_note,
      type: kot.type,
      created_at: kot.created_at,
      items,
    });
  }
  return tickets;
}

export function registerKDSIPC() {
  ipcMain.handle('kds:getActiveTickets', async (_event, payload?: { since?: string }) => {
    try {
      assertCurrentPermission('kot_view');
      return { success: true, data: fetchTickets(payload?.since) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown KDS error' };
    }
  });

  ipcMain.handle('kds:updateItemStatus', async (_event, payload: { itemId: number; status: 'pending' | 'preparing' | 'ready' | 'served' }) => {
    try {
      const order = updateItemPreparationStatus(payload.itemId, payload.status);
      return { success: true, data: { order } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown KDS error' };
    }
  });

  // KOT-level status (NEW / PREPARING / READY / COMPLETED / CANCELLED)
  ipcMain.handle('kds:updateKotStatus', async (_event, payload: { kotId: number; status: KDSStatus }) => {
    try {
      const { kot, order } = updateKOTStatus(payload.kotId, payload.status);
      return { success: true, data: { kot, order } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown KDS error' };
    }
  });

  // Legacy order-level bump — kept for compatibility
  ipcMain.handle('kds:updateOrderStatus', async (_event, payload: { orderId: number; status: KDSStatus }) => {
    try {
      const order = updateOrderKDSStatus(payload.orderId, payload.status);
      return { success: true, data: { order } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown KDS error' };
    }
  });
}

export { getOrderById, getOrderItems };
