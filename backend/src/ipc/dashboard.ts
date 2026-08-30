import { ipcMain } from 'electron';
import { getDB } from '../db';
import { getLowStockItems } from '../services/inventory-service';
import { getAppTimezone, makeTrendBucket, reportRangeUtc } from '../services/timezone';

export function registerDashboardIPC() {
  ipcMain.handle('dashboard:getMetrics', async (_event, payload: { filter: string }) => {
    try {
      const db = getDB();
      const filter = payload.filter;
      const timeZone = getAppTimezone();
      // Report boundaries follow the configured application timezone
      // (default Asia/Karachi), never the machine's local timezone.
      const range = reportRangeUtc(filter === 'today' ? 'daily' : filter, timeZone, new Date());
      const dateCondition = range.condition;
      const rangeParams = range.params;
      const totalSalesMinor = (db.prepare(`SELECT COALESCE(SUM(total_amount_minor),0) as total FROM bills WHERE ${dateCondition}`).get(...rangeParams) as { total: number }).total;
      const totalSales = totalSalesMinor / 100;
      const ordersQuery = db.prepare(`SELECT COUNT(id) as count, COALESCE(SUM(covers),0) as covers FROM orders WHERE ${dateCondition}`).get(...rangeParams) as { count: number; covers: number };
      const averageOrderValue = ordersQuery.count > 0 ? totalSales / ordersQuery.count : 0;
      const outstandingBalances = (db.prepare('SELECT COALESCE(SUM(outstanding_balance),0) as total FROM customers').get() as { total: number }).total;
      const bucket = makeTrendBucket(range.trendGroupFormat, timeZone);
      const trendRows = db.prepare(`SELECT created_at, total_amount_minor FROM bills WHERE ${dateCondition}`).all(...rangeParams) as Array<{ created_at: string; total_amount_minor: number | null }>;
      const trendMap = new Map<string, { sales: number; orders: number }>();
      for (const row of trendRows) {
        const label = bucket(row.created_at);
        const entry = trendMap.get(label) ?? { sales: 0, orders: 0 };
        entry.sales += (row.total_amount_minor ?? 0) / 100;
        entry.orders += 1;
        trendMap.set(label, entry);
      }
      const trendQuery = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, v]) => ({ label, sales: v.sales, orders: v.orders }));
      const topItemsQuery = db.prepare(`SELECT oi.name, SUM(oi.qty) as quantity, COALESCE(SUM(oi.line_total_minor),0)/100.0 as revenue FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE ${dateCondition.replace(/created_at/g, 'o.created_at')} AND o.status = 'COMPLETED' GROUP BY oi.menu_item_id, oi.name ORDER BY quantity DESC LIMIT 5`).all(...rangeParams) as { name: string; quantity: number; revenue: number }[];
      const paymentRows = db.prepare(`SELECT method, COALESCE(SUM(amount_minor),0)/100.0 as total FROM payments WHERE status = 'PAID' AND ${dateCondition.replace(/created_at/g, 'COALESCE(paid_at, created_at)')} GROUP BY method`).all(...rangeParams) as { method: string; total: number }[];
      const paymentBreakdown: Record<string, number> = { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0, unpaid: 0 };
      for (const row of paymentRows) { if (row.method in paymentBreakdown) { paymentBreakdown[row.method] = row.total; } }
      const openTables = (db.prepare("SELECT COUNT(DISTINCT table_id) count FROM orders WHERE status NOT IN ('COMPLETED','CANCELLED') AND table_id IS NOT NULL").get() as { count: number }).count;
      const kitchenPendingKots = (db.prepare("SELECT COUNT(*) count FROM kots WHERE status IN ('NEW','PREPARING','READY')").get() as { count: number }).count;
      const completedOrdersToday = (db.prepare(`SELECT COUNT(*) count FROM orders WHERE status = 'COMPLETED' AND ${dateCondition}`).get(...rangeParams) as { count: number }).count;
      const lowStock = getLowStockItems(db, 8);
      const recentOrders = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.type, o.total_minor, o.created_at,
               t.name AS table_name, c.name AS customer_name
        FROM orders o
        LEFT JOIN tables t ON t.id = o.table_id
        LEFT JOIN customers c ON c.id = o.customer_id
        ORDER BY o.id DESC LIMIT 8
      `).all();
      return {
        success: true,
        data: {
          metrics: {
            totalSales, totalOrders: ordersQuery.count, averageOrderValue, totalCovers: ordersQuery.covers,
            outstandingBalances, ...paymentBreakdown, openTables, kitchenPendingKots, completedOrdersToday, lowStockCount: lowStock.length,
          },
          trendData: trendQuery,
          topItemsData: topItemsQuery,
          lowStock,
          recentOrders,
        },
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });
}
