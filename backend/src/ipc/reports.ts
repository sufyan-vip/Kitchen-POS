import { ipcMain } from 'electron';
import Store from 'electron-store';
import { getDB } from '../db';
import { printBill } from '../services/printer';
import { assertCurrentPermission } from '../services/authz';
import { getLowStockItems } from '../services/inventory-service';
import { getAppTimezone, makeTrendBucket, reportRangeUtc, sqliteUtc, zonedDateStr, zonedMidnightUtcMs, shiftDateStr } from '../services/timezone';

interface OrderRow {
  order_id: number;
  order_number: string;
  order_time: string;
  bill_time: string;
  total_amount: number;
  total_amount_minor: number;
  customer_name: string | null;
  type: 'dine-in' | 'takeaway' | 'delivery';
  business_date: string | null;
}

function formatHour(hourStr: string): string {
  const hour = parseInt(hourStr, 10);
  if (hour === 0) { return '12 AM'; }
  if (hour === 12) { return '12 PM'; }
  if (hour > 12) { return `${hour - 12} PM`; }
  return `${hour} AM`;
}

function dateRange(filter: string, start?: string, end?: string): ReturnType<typeof reportRangeUtc> {
  return reportRangeUtc(filter, getAppTimezone(), new Date(), start, end);
}

export function registerReportsIPC() {
  ipcMain.handle('reports:getPastOrders', async (_, payload: { filter: 'daily' | 'weekly' | 'monthly' | 'yearly'; page: number; limit: number }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const timeZone = getAppTimezone();
      const todayStr = zonedDateStr(Date.now(), timeZone);
      let rangeStartUtc = '';
      switch (payload.filter) {
        case 'daily': rangeStartUtc = sqliteUtc(zonedMidnightUtcMs(todayStr, timeZone)); break;
        case 'weekly': rangeStartUtc = sqliteUtc(zonedMidnightUtcMs(shiftDateStr(todayStr, -6), timeZone)); break;
        case 'monthly': rangeStartUtc = sqliteUtc(zonedMidnightUtcMs(`${todayStr.slice(0, 7)}-01`, timeZone)); break;
        case 'yearly': rangeStartUtc = sqliteUtc(zonedMidnightUtcMs(`${todayStr.slice(0, 4)}-01-01`, timeZone)); break;
      }
      const { page, limit } = payload;
      const offset = (page - 1) * limit;

      const totalCountRow = db.prepare(`
        SELECT COUNT(DISTINCT o.id) as count
        FROM orders o
        JOIN bills b ON o.id = b.order_id
        WHERE o.status = 'COMPLETED' AND datetime(o.created_at) >= ?
      `).get(rangeStartUtc) as { count: number };
      const totalPages = Math.max(1, Math.ceil(totalCountRow.count / limit));

      const orders = db.prepare(`
        SELECT
          o.id as order_id,
          o.order_number,
          o.created_at as order_time,
          b.created_at as bill_time,
          b.total_amount,
          b.total_amount_minor,
          c.name as customer_name,
          o.type,
          o.business_date
        FROM orders o
        JOIN bills b ON o.id = b.order_id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.status = 'COMPLETED' AND datetime(o.created_at) >= ?
        GROUP BY o.id, b.total_amount_minor
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?
      `).all(rangeStartUtc, limit, offset) as OrderRow[];

      const aggregates = db.prepare(`
        SELECT
          COUNT(DISTINCT b.id) AS total_orders,
          COALESCE(SUM(b.total_amount_minor), 0) AS total_revenue_minor
        FROM bills b
        JOIN orders o ON o.id = b.order_id
        WHERE datetime(o.created_at) >= ?
      `).get(rangeStartUtc) as { total_orders: number; total_revenue_minor: number };

      const totalRevenueMinor = aggregates.total_revenue_minor;
      const totalRevenue = totalRevenueMinor / 100;
      const average_order_value = aggregates.total_orders > 0 ? totalRevenue / aggregates.total_orders : 0;

      const data = orders.map(o => {
        const items = db.prepare('SELECT name, qty FROM order_items WHERE order_id = ?').all(o.order_id);
        const occupiedMs = new Date(o.bill_time).getTime() - new Date(o.order_time).getTime();
        return {
          id: o.order_id,
          order_number: o.order_number,
          amount: o.total_amount,
          amount_minor: o.total_amount_minor,
          customerName: o.customer_name ?? 'Walk-in',
          date: o.order_time,
          business_date: o.business_date ?? null,
          occupiedTimeMs: occupiedMs > 0 ? occupiedMs : 0,
          type: o.type,
          items,
        };
      });

      return {
        success: true,
        data: {
          stats: { totalOrders: aggregates.total_orders, totalRevenue, totalRevenueMinor, averageOrderValue: average_order_value },
          orders: data,
          totalPages,
          currentPage: page,
        },
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Sales summary: gross, discounts, tax, service charge, net, payment breakdown, trend ──
  ipcMain.handle('reports:sales', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end);
      const params = range.params;
      const aggregates = db.prepare(`
        SELECT
          COUNT(id) AS total_orders,
          COALESCE(SUM(total_amount_minor), 0) AS total_minor,
          COALESCE(SUM(tax_amount_minor), 0) AS tax_minor,
          COALESCE(SUM(service_charge_minor), 0) AS service_charge_minor,
          COALESCE(SUM(discount_amount_minor), 0) AS discount_minor,
          COALESCE(SUM(delivery_charge_minor), 0) AS delivery_charge_minor
        FROM bills
        WHERE ${range.condition}
      `).get(...params) as { total_orders: number; total_minor: number; tax_minor: number; service_charge_minor: number; discount_minor: number; delivery_charge_minor: number } | undefined;

      const paymentRows = db.prepare(`
        SELECT p.method, COALESCE(SUM(p.amount_minor), 0) AS total_minor
        FROM payments p
        JOIN bills b ON b.order_id = p.order_id
        WHERE p.status = 'PAID' AND ${range.condition.replace(/created_at/g, 'b.created_at')}
        GROUP BY p.method
      `).all(...params) as Array<{ method: string; total_minor: number }>;
      const paymentBreakdown: Record<string, number> = { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0, unpaid: 0 };
      for (const row of paymentRows) { if (row.method in paymentBreakdown) { paymentBreakdown[row.method] = row.total_minor / 100; } }

      const bucket = makeTrendBucket(range.trendGroupFormat, getAppTimezone());
      const trendRaw = db.prepare(`SELECT created_at, total_amount_minor FROM bills WHERE ${range.condition}`).all(...params) as Array<{ created_at: string; total_amount_minor: number | null }>;
      const trendMap = new Map<string, { orders: number; revenueMinor: number }>();
      for (const row of trendRaw) {
        const label = bucket(row.created_at);
        const entry = trendMap.get(label) ?? { orders: 0, revenueMinor: 0 };
        entry.orders += 1;
        entry.revenueMinor += row.total_amount_minor ?? 0;
        trendMap.set(label, entry);
      }
      const trendData = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, e]) => ({
        hour: range.trendGroupFormat === '%H' ? formatHour(label) : label,
        orders: e.orders,
        revenue: e.revenueMinor / 100,
      }));

      const totalMinor = aggregates?.total_minor ?? 0;
      return {
        success: true,
        data: {
          date: payload.filter,
          totalOrders: aggregates?.total_orders ?? 0,
          grossSales: totalMinor / 100,
          totalDiscount: (aggregates?.discount_minor ?? 0) / 100,
          totalTax: (aggregates?.tax_minor ?? 0) / 100,
          totalServiceCharge: (aggregates?.service_charge_minor ?? 0) / 100,
          totalDeliveryCharge: (aggregates?.delivery_charge_minor ?? 0) / 100,
          netSales: Math.max(0, totalMinor) / 100,
          paymentBreakdown,
          trendData,
        },
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Product performance ──────────────────────────────────────────────
  ipcMain.handle('reports:products', async (_, payload: { filter: string, start?: string, end?: string, limit?: number }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end).condition.replace(/created_at/g, 'o.created_at');
      const safeLimit = Math.min(Math.max(Math.trunc(payload.limit ?? 25), 1), 100);
      const rows = db.prepare(`
        SELECT oi.menu_item_id, oi.name, SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total_minor), 0) AS revenue_minor
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'COMPLETED' AND ${range}
        GROUP BY oi.menu_item_id, oi.name
        ORDER BY qty DESC
        LIMIT ?
      `).all(safeLimit) as Array<{ menu_item_id: number; name: string; qty: number; revenue_minor: number }>;
      return { success: true, data: rows.map(r => ({ ...r, revenue: r.revenue_minor / 100 })) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Category performance ─────────────────────────────────────────────
  ipcMain.handle('reports:categories', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end).condition.replace(/created_at/g, 'o.created_at');
      const rows = db.prepare(`
        SELECT c.name AS category, COUNT(DISTINCT o.id) AS orders,
               SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total_minor), 0) AS revenue_minor
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        JOIN categories c ON c.id = mi.category_id
        WHERE o.status = 'COMPLETED' AND ${range}
        GROUP BY c.id, c.name
        ORDER BY revenue_minor DESC
      `).all() as Array<{ category: string; orders: number; qty: number; revenue_minor: number }>;
      return { success: true, data: rows.map(r => ({ ...r, revenue: r.revenue_minor / 100 })) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Modifier popularity (from order item snapshots) ──────────────────
  ipcMain.handle('reports:modifiers', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end).condition.replace(/created_at/g, 'o.created_at');
      const rows = db.prepare(`
        SELECT oi.modifier_snapshot
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'COMPLETED' AND ${range} AND oi.modifier_snapshot IS NOT NULL
      `).all() as Array<{ modifier_snapshot: string }>;
      const counts = new Map<string, { name: string; group: string; qty: number; revenue_minor: number }>();
      for (const row of rows) {
        let parsed: Array<{ id: number; group_name: string; name: string; price_minor: number; qty: number }> = [];
        try { parsed = JSON.parse(row.modifier_snapshot); } catch { continue; }
        for (const m of parsed) {
          const key = `${m.group_name}::${m.name}`;
          const entry = counts.get(key) ?? { name: m.name, group: m.group_name, qty: 0, revenue_minor: 0 };
          entry.qty += m.qty;
          entry.revenue_minor += m.price_minor * m.qty;
          counts.set(key, entry);
        }
      }
      const data = Array.from(counts.values()).sort((a, b) => b.qty - a.qty);
      return { success: true, data: data.map(d => ({ ...d, revenue: d.revenue_minor / 100 })) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Table usage ──────────────────────────────────────────────────────
  ipcMain.handle('reports:tables', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end).condition.replace(/created_at/g, 'o.created_at');
      const rows = db.prepare(`
        SELECT t.name AS table_name, COUNT(o.id) AS orders,
               COALESCE(SUM(o.total_minor), 0) AS revenue_minor,
               COALESCE(SUM(o.covers), 0) AS covers
        FROM orders o
        JOIN tables t ON t.id = o.table_id
        WHERE o.status = 'COMPLETED' AND ${range}
        GROUP BY t.id, t.name
        ORDER BY orders DESC
      `).all() as Array<{ table_name: string; orders: number; revenue_minor: number; covers: number }>;
      return { success: true, data: rows.map(r => ({ ...r, revenue: r.revenue_minor / 100 })) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Kitchen performance ──────────────────────────────────────────────
  ipcMain.handle('reports:kitchen', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end).condition.replace(/created_at/g, 'k.created_at');
      const summary = db.prepare(`
        SELECT COUNT(*) AS total_kots,
               SUM(CASE WHEN k.status IN ('NEW','PREPARING','READY') THEN 1 ELSE 0 END) AS pending_kots,
               SUM(CASE WHEN k.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_kots,
               SUM(CASE WHEN k.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_kots
        FROM kots k WHERE ${range}
      `).get() as { total_kots: number; pending_kots: number; completed_kots: number; cancelled_kots: number };
      // Average preparation time: KOT creation → first item prepared
      const prep = db.prepare(`
        SELECT AVG((julianday(MIN(oi.prepared_at)) - julianday(k.created_at)) * 1440) AS avg_minutes
        FROM kots k
        JOIN order_items oi ON oi.order_id = k.order_id AND oi.kot_number = k.kot_number AND oi.prepared_at IS NOT NULL
        WHERE ${range}
        GROUP BY k.id
      `).all() as Array<{ avg_minutes: number | null }>;
      const valid = prep.filter(p => p.avg_minutes !== null).map(p => p.avg_minutes as number);
      const avgPrepMinutes = valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : 0;
      const hourBucket = makeTrendBucket('%H', getAppTimezone());
      const kotRows = db.prepare(`SELECT created_at FROM kots k WHERE ${range}`).all() as Array<{ created_at: string }>;
      const hourCounts = new Map<string, number>();
      for (const row of kotRows) {
        const label = hourBucket(row.created_at);
        hourCounts.set(label, (hourCounts.get(label) ?? 0) + 1);
      }
      const byHour = [...hourCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([hour, kots]) => ({ hour, kots, label: formatHour(hour) }));
      return { success: true, data: { ...summary, avgPrepMinutes, byHour } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Inventory reports ────────────────────────────────────────────────
  ipcMain.handle('reports:inventory', async (_, payload: { start?: string; end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const params: unknown[] = [];
      let dateClause = '';
      if (payload.start && payload.end) {
        dateClause = 'WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)';
        params.push(payload.start, payload.end);
      }
      const usage = db.prepare(`
        SELECT i.name, i.unit,
               SUM(CASE WHEN l.type = 'sale' THEN -l.qty_change ELSE 0 END) AS sold_qty,
               SUM(CASE WHEN l.type = 'purchase' THEN l.qty_change ELSE 0 END) AS purchased_qty,
               SUM(CASE WHEN l.type IN ('wastage','adjustment') THEN ABS(l.qty_change) ELSE 0 END) AS other_qty
        FROM inventory_log l
        JOIN inventory_items i ON i.id = l.item_id
        ${dateClause}
        GROUP BY i.id, i.name, i.unit
        ORDER BY sold_qty DESC
      `).all(...params) as Array<{ name: string; unit: string; sold_qty: number; purchased_qty: number; other_qty: number }>;
      const current = db.prepare(`
        SELECT id, name, unit, qty_in_stock, low_stock_alert_at, cost_per_unit, is_active
        FROM inventory_items ORDER BY is_active DESC, name
      `).all();
      return { success: true, data: { usage, current, lowStock: getLowStockItems(db, 100) } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  // ── Expenses summary ─────────────────────────────────────────────────
  ipcMain.handle('reports:expenses', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end);
      // expenses.date is a stored calendar date (YYYY-MM-DD), so filter by the
      // configured-timezone calendar dates rather than UTC instants.
      const rows = db.prepare(`
        SELECT category, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total_minor
        FROM expenses WHERE date >= ? AND date <= ?
        GROUP BY category ORDER BY total_minor DESC
      `).all(range.startDate, range.endDate) as Array<{ category: string; count: number; total_minor: number }>;
      const total = rows.reduce((s, r) => s + r.total_minor, 0);
      return { success: true, data: { categories: rows.map(r => ({ ...r, total: r.total_minor / 100 })), total: total / 100 } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  ipcMain.handle('reports:daily', async (_, payload: { filter: string, start?: string, end?: string }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const range = dateRange(payload.filter, payload.start, payload.end);
      const aggregates = db.prepare(`
        SELECT
          COUNT(id) AS total_orders,
          COALESCE(SUM(total_amount_minor), 0) AS total_revenue_minor,
          COALESCE(SUM(tax_amount_minor), 0) AS total_tax_minor,
          COALESCE(SUM(service_charge_minor), 0) AS total_service_charge_minor
        FROM bills WHERE ${range.condition}
      `).get(...range.params) as { total_orders: number; total_revenue_minor: number; total_tax_minor: number; total_service_charge_minor: number } | undefined;

      const bucket = makeTrendBucket(range.trendGroupFormat, getAppTimezone());
      const trendRaw = db.prepare(`SELECT created_at, total_amount_minor FROM bills WHERE ${range.condition}`).all(...range.params) as Array<{ created_at: string; total_amount_minor: number | null }>;
      const trendMap = new Map<string, { orders: number; revenueSumMinor: number }>();
      for (const row of trendRaw) {
        const label = bucket(row.created_at);
        const entry = trendMap.get(label) ?? { orders: 0, revenueSumMinor: 0 };
        entry.orders += 1;
        entry.revenueSumMinor += row.total_amount_minor ?? 0;
        trendMap.set(label, entry);
      }
      const trendData = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, e]) => ({
        hour: range.trendGroupFormat === '%H' ? formatHour(label) : label,
        orders: e.orders,
        revenue: e.revenueSumMinor / 100,
        revenueMinor: e.revenueSumMinor,
      }));

      return {
        success: true,
        data: {
          date: payload.filter,
          totalOrders: aggregates?.total_orders ?? 0,
          totalRevenue: (aggregates?.total_revenue_minor ?? 0) / 100,
          totalRevenueMinor: aggregates?.total_revenue_minor ?? 0,
          totalTax: (aggregates?.total_tax_minor ?? 0) / 100,
          totalTaxMinor: aggregates?.total_tax_minor ?? 0,
          totalServiceCharge: (aggregates?.total_service_charge_minor ?? 0) / 100,
          totalServiceChargeMinor: aggregates?.total_service_charge_minor ?? 0,
          hourlyData: trendData,
        },
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown reports aggregation error' };
    }
  });

  ipcMain.handle('reports:tax', async () => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const rows = db.prepare(`
        SELECT COALESCE(tax_name, 'Tax') AS tax_name, COALESCE(tax_rate, 0) AS tax_rate,
               COUNT(*) AS bill_count, COALESCE(SUM(tax_amount_minor), 0) AS tax_amount_minor,
               COALESCE(SUM(service_charge_minor), 0) AS service_charge_minor
        FROM bills
        GROUP BY tax_name, tax_rate
        ORDER BY tax_name
      `).all() as Array<{ tax_name: string; tax_rate: number; bill_count: number; tax_amount_minor: number; service_charge_minor: number }>;
      return { success: true, data: rows.map(r => ({
        tax_name: r.tax_name,
        tax_rate: r.tax_rate,
        bill_count: r.bill_count,
        tax_amount: r.tax_amount_minor / 100,
        tax_amount_minor: r.tax_amount_minor,
        service_charge_amount: r.service_charge_minor / 100,
        service_charge_minor: r.service_charge_minor,
      })) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown tax report error' };
    }
  });

  ipcMain.handle('reports:gst', async () => ({ success: true, data: [], warning: 'GST report was replaced by configurable tax summary for Pakistanized installs.' }));

  ipcMain.handle('reports:printPastBill', async (_, payload: { orderId: number }) => {
    try {
      assertCurrentPermission('reports');
      const db = getDB();
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(payload.orderId) as Record<string, unknown> | undefined;
      if (!bill) { throw new Error('Bill not found for this order.'); }
      const items = db.prepare(`
        SELECT name, qty, unit_price FROM order_items WHERE order_id = ?
      `).all(payload.orderId) as Array<{ name: string; qty: number; unit_price: number }>;

      const store = new Store();
      const settings = {
        restaurant_name: store.get('restaurant_name') as string,
        outlet_name: store.get('outlet_name') as string,
        address: store.get('address') as string,
        city: store.get('city') as string,
        province: store.get('province') as string,
        phone: store.get('phone') as string,
        currency: store.get('currency', 'PKR') as string,
        tax_name: store.get('tax_name', 'Sales Tax') as string,
        receipt_footer: store.get('receipt_footer', 'Thank You!') as string,
      };
      await printBill(bill as never, items, settings);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown printing error' };
    }
  });
}
