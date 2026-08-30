import { ipcMain } from 'electron';
import {
  addCashEntry, closeShift, getActiveShift, listCashEntries, listShifts, openShift, ShiftRow,
} from '../services/cash';
import { getDB } from '../db';

function wrap<T>(fn: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: fn() };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export function registerCashIPC() {
  ipcMain.handle('shifts:getActive', async () => wrap(() => getActiveShift()));

  ipcMain.handle('shifts:open', async (_event, payload: { staffId: number; openingCash: number | string }) =>
    wrap(() => openShift(payload.staffId, payload.openingCash)));

  ipcMain.handle('shifts:close', async (_event, payload: { shiftId: number; closingCash: number | string; note?: string }) =>
    wrap(() => closeShift(payload.shiftId, payload.closingCash, payload.note ?? null)));

  ipcMain.handle('shifts:list', async (_event, payload: { limit?: number } = {}) => wrap(() => listShifts(payload.limit)));

  ipcMain.handle('shifts:addCashEntry', async (_event, payload: { shiftId: number; type: 'CASH_IN' | 'CASH_OUT'; amount: number | string; note?: string }) =>
    wrap(() => addCashEntry(payload.shiftId, payload.type, payload.amount, payload.note ?? null)));

  ipcMain.handle('shifts:getCashEntries', async (_event, payload: { shiftId: number }) =>
    wrap(() => listCashEntries(payload.shiftId)));

  // Legacy totals endpoint — payment breakdown since a timestamp
  ipcMain.handle('shifts:getTotals', async (_event, payload: { openedAt: string }) => {
    return wrap(() => {
      const db = getDB();
      const rows = db.prepare(`
        SELECT method, COALESCE(SUM(amount_minor), 0) AS total_minor
        FROM payments
        WHERE status = 'PAID' AND COALESCE(paid_at, created_at) >= ?
        GROUP BY method
      `).all(payload.openedAt) as Array<{ method: string; total_minor: number }>;
      const totals: Record<string, number> = { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0, unpaid: 0 };
      for (const row of rows) {
        if (row.method in totals) { totals[row.method] = row.total_minor / 100; }
      }
      return totals;
    });
  });
}

export type { ShiftRow };
