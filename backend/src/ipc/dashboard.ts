import { ipcMain } from 'electron';
import { getDB } from '../db';

export function registerDashboardIPC() {
  ipcMain.handle('dashboard:getMetrics', async (_event, payload: { filter: string }) => {
    try {
      const db = getDB();
      const filter = payload.filter;
      let dateCondition = '';
      let trendGroupFormat = '';
      switch (filter) {
        case 'yesterday': dateCondition = "date(created_at, 'localtime') = date('now', '-1 day', 'localtime')"; trendGroupFormat = "%H"; break;
        case 'weekly': dateCondition = "date(created_at, 'localtime') >= date('now', '-6 days', 'localtime')"; trendGroupFormat = "%Y-%m-%d"; break;
        case 'monthly': dateCondition = "strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')"; trendGroupFormat = "%Y-%m-%d"; break;
        default: dateCondition = "date(created_at, 'localtime') = date('now', 'localtime')"; trendGroupFormat = "%H";
      }
      const totalSales = ((db.prepare(`SELECT SUM(total_amount) as total FROM bills WHERE ${dateCondition}`).get() as { total: number | null }).total) ?? 0;
      const ordersQuery = db.prepare(`SELECT COUNT(id) as count, SUM(covers) as covers FROM orders WHERE ${dateCondition}`).get() as { count: number, covers: number | null };
      const averageOrderValue = ordersQuery.count > 0 ? totalSales / ordersQuery.count : 0;
      const outstandingBalances = ((db.prepare(`SELECT SUM(outstanding_balance) as total FROM customers`).get() as { total: number | null }).total) ?? 0;
      const trendQuery = db.prepare(`SELECT strftime('${trendGroupFormat}', created_at, 'localtime') as label, SUM(total_amount) as sales, COUNT(id) as orders FROM bills WHERE ${dateCondition} GROUP BY label ORDER BY label ASC`).all() as { label: string, sales: number, orders: number }[];
      const topItemsQuery = db.prepare(`SELECT oi.name, SUM(oi.qty) as quantity FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE ${dateCondition.replace(/created_at/g, 'o.created_at')} GROUP BY oi.menu_item_id, oi.name ORDER BY quantity DESC LIMIT 5`).all() as { name: string, quantity: number }[];
      const paymentRows = db.prepare(`SELECT method, COALESCE(SUM(amount),0) total FROM payments WHERE status = 'PAID' AND ${dateCondition.replace(/created_at/g, 'COALESCE(paid_at, created_at)')} GROUP BY method`).all() as { method: string; total: number }[];
      const paymentBreakdown: Record<string, number> = { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0 };
      for (const row of paymentRows) {if (row.method in paymentBreakdown) {paymentBreakdown[row.method] = row.total;}}
      const openTables = (db.prepare(`SELECT COUNT(DISTINCT table_id) count FROM orders WHERE status IN ('open','kot_sent') AND table_id IS NOT NULL`).get() as { count: number }).count;
      const kitchenPendingOrders = (db.prepare(`SELECT COUNT(DISTINCT order_id) count FROM order_items WHERE preparation_status IN ('pending','preparing')`).get() as { count: number }).count;
      const lowStockItems = (db.prepare(`SELECT COUNT(*) count FROM inventory_items WHERE qty_in_stock <= low_stock_alert_at`).get() as { count: number }).count;
      return { success: true, data: { metrics: { totalSales, totalOrders: ordersQuery.count, averageOrderValue, totalCustomers: ordersQuery.covers ?? 0, outstandingBalances, ...paymentBreakdown, openTables, kitchenPendingOrders, lowStockItems }, trendData: trendQuery, topItemsData: topItemsQuery } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });
}
