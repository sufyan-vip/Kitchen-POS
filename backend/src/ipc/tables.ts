import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';

export function registerTablesIPC() {
  ipcMain.handle('tables:getAll', async () => {
    try {
      assertCurrentPermission('table_viewing');
      const db = getDB();
      const tables = db.prepare('SELECT * FROM tables WHERE is_active = 1').all();
      return { success: true, data: tables };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('tables:upsert', async (_, table: any) => {
    try {
      assertCurrentPermission('table_management');
      const db = getDB();
      if (table.id) {
        db.prepare('UPDATE tables SET name = ?, capacity = ?, identifier = COALESCE(?, identifier), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(table.name, table.capacity, table.identifier ?? null, table.id);
        return { success: true };
      }
      const defaultArea = db.prepare("SELECT id FROM dining_areas WHERE is_active = 1 ORDER BY sort_order, id LIMIT 1").get() as { id: number } | undefined;
      if (!defaultArea) {
        return { success: false, error: 'No active dining area exists' };
      }
      const identifier = table.identifier ?? table.name;
      const result = db.prepare(`
        INSERT INTO tables (dining_area_id, identifier, name, capacity, status, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'AVAILABLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(defaultArea.id, identifier, table.name, table.capacity);
      return { success: true, data: { id: result.lastInsertRowid, ...table } };
      
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('tables:delete', async (_, id: number) => {
    try {
      assertCurrentPermission('table_management');
      const db = getDB();
      const activeOrder = db.prepare("SELECT order_number FROM orders WHERE table_id = ? AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1").get(id) as { order_number: string } | undefined;
      if (activeOrder) {
        return { success: false, error: `Cannot deactivate table with an active order (${activeOrder.order_number})` };
      }
      db.prepare("UPDATE tables SET is_active = 0, status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('tables:updateCustomName', async (_, payload: { id: number; customName: string | null }) => {
    try {
      assertCurrentPermission('table_management');
      const db = getDB();
      db.prepare('UPDATE tables SET custom_name = ? WHERE id = ?').run(payload.customName, payload.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
