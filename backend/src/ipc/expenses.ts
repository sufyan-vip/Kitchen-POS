import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';
import { toMinorUnits } from '../services/money';
import { writeAuditLog } from '../services/audit';

interface ExpenseInput {
  id?: number;
  date: string;
  category: string;
  amount: number | string;
  description?: string | null;
  staff_id?: number | null;
  payment_method?: string;
}

export function registerExpensesIPC() {
  ipcMain.handle('expenses:getAll', async (event, payload: { start?: string, end?: string } = {}) => {
    try {
      assertCurrentPermission('expenses_view');
      const db = getDB();
      let query = `
        SELECT e.*, s.name as staff_name
        FROM expenses e
        LEFT JOIN staff s ON e.staff_id = s.id
      `;
      const params: unknown[] = [];
      if (payload.start && payload.end) {
        query += ' WHERE e.date >= ? AND e.date <= ?';
        params.push(payload.start, payload.end);
      } else if (payload.start) {
        query += ' WHERE e.date >= ?';
        params.push(payload.start);
      } else if (payload.end) {
        query += ' WHERE e.date <= ?';
        params.push(payload.end);
      }
      query += ' ORDER BY e.date DESC, e.id DESC';
      const expenses = db.prepare(query).all(...params);
      return { success: true, data: expenses };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('expenses:getCategories', async () => {
    try {
      assertCurrentPermission('expenses_view');
      return { success: true, data: getDB().prepare('SELECT * FROM expense_categories ORDER BY sort_order, name').all() };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('expenses:create', async (event, payload: ExpenseInput) => {
    try {
      assertCurrentPermission('expenses_manage');
      const db = getDB();
      const amountMinor = toMinorUnits(payload.amount);
      if (amountMinor < 0) { throw new Error('Amount cannot be negative'); }
      if (!payload.date) { throw new Error('Date is required'); }
      const category = payload.category.trim();
      if (!category) { throw new Error('Category is required'); }
      const stmt = db.prepare(`
        INSERT INTO expenses (date, category, amount, amount_minor, description, staff_id, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        payload.date,
        category,
        amountMinor / 100,
        amountMinor,
        payload.description ?? null,
        payload.staff_id ?? null,
        payload.payment_method ?? 'cash',
      );
      const id = Number(info.lastInsertRowid);
      writeAuditLog(db, { action: 'create', entityType: 'expense', entityId: id, details: { category, amount_minor: amountMinor, date: payload.date } });
      return { success: true, data: { id } };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('expenses:delete', async (event, payload: { id: number }) => {
    try {
      assertCurrentPermission('expenses_manage');
      const db = getDB();
      const stmt = db.prepare('DELETE FROM expenses WHERE id = ?');
      const info = stmt.run(payload.id);
      if (info.changes > 0) {
        writeAuditLog(db, { action: 'delete', entityType: 'expense', entityId: payload.id });
        return { success: true };
      }
      return { success: false, error: 'Expense not found' };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
