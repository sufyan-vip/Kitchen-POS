import { ipcMain } from 'electron';
import { getDB } from '../db';
import { toMinorUnits } from '../services/money';
import { writeAuditLog } from '../services/audit';
import { findActiveShiftForTimestamp, recordCashPayment } from '../services/cash';
import { assertCurrentPermission } from '../services/authz';

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loyalty_points: number;
  total_visits: number;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
}

interface BillRow {
  bill_id: number;
  bill_number: string;
  total_amount: number;
  order_id: number;
  created_at: string;
}

interface OrderItemRow {
  name: string;
  qty: number;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error occurred';
}

export function registerCustomersIPC() {
  ipcMain.handle('customers:getAll', async () => {
    try {
      assertCurrentPermission('customers_view');
      const db = getDB();
      const customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
      return { success: true, data: customers };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('customers:getById', async (_, id: number) => {
    try {
      assertCurrentPermission('customers_view');
      const db = getDB();
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
      if (!customer) { return { success: false, error: 'Customer not found' }; }
      return { success: true, data: customer };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('customers:create', async (_, payload: { name: string; phone?: string; email?: string; credit_limit?: number }) => {
    try {
      assertCurrentPermission('customers_manage');
      const db = getDB();
      const info = db.prepare(`
        INSERT INTO customers (name, phone, email, credit_limit)
        VALUES (?, ?, ?, ?)
      `).run(payload.name, payload.phone ?? null, payload.email ?? null, payload.credit_limit ?? 0);
      return { success: true, data: { id: info.lastInsertRowid } };
    } catch (e: unknown) {
      const msg = errMsg(e);
      if (msg.includes('UNIQUE constraint failed')) {
        return { success: false, error: 'Phone number already exists.' };
      }
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('customers:update', async (_, payload: { id: number; name: string; phone?: string; email?: string; credit_limit?: number }) => {
    try {
      assertCurrentPermission('customers_manage');
      const db = getDB();
      db.prepare(`
        UPDATE customers SET name = ?, phone = ?, email = ?, credit_limit = ? WHERE id = ?
      `).run(payload.name, payload.phone ?? null, payload.email ?? null, payload.credit_limit ?? 0, payload.id);
      return { success: true };
    } catch (e: unknown) {
      const msg = errMsg(e);
      if (msg.includes('UNIQUE constraint failed')) {
        return { success: false, error: 'Phone number already exists.' };
      }
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('customers:delete', async (_, id: number) => {
    try {
      assertCurrentPermission('customers_manage');
      const db = getDB();
      db.prepare('DELETE FROM customers WHERE id = ?').run(id);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('customers:search', async (_, query: string) => {
    try {
      assertCurrentPermission('customers_view');
      const db = getDB();
      const search = `%${query}%`;
      const customers = db.prepare(`
        SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name ASC LIMIT 10
      `).all(search, search);
      return { success: true, data: customers };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('customers:settleBalance', async (_, payload: { customerId: number; amount: number; method: string }) => {
    try {
      assertCurrentPermission('customers_manage');
      const db = getDB();

      const customer = db.prepare('SELECT outstanding_balance FROM customers WHERE id = ?').get(payload.customerId) as { outstanding_balance: number | null } | undefined;
      if (!customer) {
        return { success: false, error: 'Customer not found.' };
      }

      // Integer paisa throughout, matching the payments/billing architecture.
      const amountMinor = toMinorUnits(payload.amount);
      if (amountMinor <= 0) {
        return { success: false, error: 'Settlement amount must be greater than zero.' };
      }
      const outstandingMinor = Math.round((customer.outstanding_balance ?? 0) * 100);
      if (amountMinor > outstandingMinor) {
        return { success: false, error: `Amount exceeds outstanding balance of Rs ${(outstandingMinor / 100).toFixed(2)}.` };
      }
      const method = payload.method.toLowerCase();
      const validMethods = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'other'];
      if (!validMethods.includes(method)) {
        return { success: false, error: `Unsupported payment method: ${method}` };
      }

      const shiftId = findActiveShiftForTimestamp(db, new Date().toISOString());
      const paymentId = db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, transaction_reference, provider_reference, status, reference, failure_reason, metadata, paid_at)
          VALUES (NULL, ?, ?, ?, ?, 'PKR', NULL, NULL, 'PAID', ?, NULL, NULL, CURRENT_TIMESTAMP)
        `).run(method, method, amountMinor / 100, amountMinor, 'Balance Settlement');
        const id = Number(info.lastInsertRowid);
        // Cash settlements flow into the active shift's cash tally, exactly
        // like cash payments on bills.
        if (method === 'cash') { recordCashPayment(db, shiftId, 'SALE', amountMinor, id); }
        db.prepare('UPDATE customers SET outstanding_balance = ? WHERE id = ?')
          .run((outstandingMinor - amountMinor) / 100, payload.customerId);
        writeAuditLog(db, {
          action: 'customer_balance_settled', entityType: 'customer', entityId: payload.customerId,
          details: { amount_minor: amountMinor, method, paymentId: id },
        });
        return id;
      })();

      return { success: true, data: { paymentId } };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('customers:getHistory', async (_, customerId: number) => {
    try {
      assertCurrentPermission('customers_view');
      const db = getDB();
      const bills = db.prepare(`
        SELECT b.id as bill_id, b.bill_number, b.total_amount, o.id as order_id, o.created_at
        FROM bills b
        JOIN orders o ON b.order_id = o.id
        WHERE o.customer_id = ?
        ORDER BY o.created_at DESC
      `).all(customerId) as BillRow[];

      const history = bills.map(b => {
        const items = db.prepare('SELECT name, qty FROM order_items WHERE order_id = ?').all(b.order_id) as OrderItemRow[];
        return {
          orderId: b.order_id,
          date: b.created_at,
          billNumber: b.bill_number,
          totalAmount: b.total_amount,
          items,
        };
      });

      return { success: true, data: history };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  });
}
