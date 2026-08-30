import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';
import { convertQuantity, getLowStockItems, getMovementHistory, recordMovement, MovementType } from '../services/inventory-service';
import { toMinorUnits } from '../services/money';
import { writeAuditLog } from '../services/audit';

interface UpsertInventoryItemPayload {
  id?: number;
  name: string;
  unit: string;
  low_stock_alert_at?: number;
  cost_per_unit?: number | string;
  is_active?: number | boolean;
}

interface AdjustInventoryPayload {
  item_id: number;
  type: MovementType;
  qty_change: number;
  note?: string;
}

export function registerInventoryIPC() {
  ipcMain.handle('inventory:getAll', async () => {
    try {
      assertCurrentPermission('inventory_view');
      const db = getDB();
      const items = db.prepare('SELECT * FROM inventory_items ORDER BY is_active DESC, name ASC').all();
      return { success: true, data: items };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:getLowStock', async () => {
    try {
      assertCurrentPermission('inventory_view');
      return { success: true, data: getLowStockItems(getDB()) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:getMovements', async (_event, payload: { itemId?: number; limit?: number } = {}) => {
    try {
      assertCurrentPermission('inventory_view');
      return { success: true, data: getMovementHistory(getDB(), payload.itemId, payload.limit ?? 200) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:convert', async (_event, payload: { value: number; from: string; to: string }) => {
    try {
      assertCurrentPermission('inventory_view');
      return { success: true, data: convertQuantity(payload.value, payload.from, payload.to) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:upsertItem', async (_event, payload: UpsertInventoryItemPayload) => {
    try {
      assertCurrentPermission('inventory_adjust');
      const name = payload.name.trim();
      if (!name) { throw new Error('Item name is required'); }
      const unit = payload.unit.trim().toLowerCase();
      if (!unit) { throw new Error('Unit is required'); }
      const db = getDB();
      let isActive = 1;
      if (payload.is_active !== undefined) { isActive = payload.is_active ? 1 : 0; }
      if (payload.id) {
        assertCurrentPermission('inventory_cost');
        db.prepare(`
          UPDATE inventory_items
          SET name = ?, unit = ?, low_stock_alert_at = ?, cost_per_unit = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(name, unit, payload.low_stock_alert_at ?? 0, toMinorUnits(payload.cost_per_unit ?? 0) / 100, isActive, payload.id);
        writeAuditLog(db, { action: 'update', entityType: 'inventory_item', entityId: payload.id, details: { name, unit } });
        return { success: true, data: { id: payload.id } };
      }
      const result = db.prepare(`
        INSERT INTO inventory_items (name, unit, low_stock_alert_at, cost_per_unit, qty_in_stock, is_active)
        VALUES (?, ?, ?, ?, 0, 1)
      `).run(name, unit, payload.low_stock_alert_at ?? 0, toMinorUnits(payload.cost_per_unit ?? 0) / 100);
      const id = Number(result.lastInsertRowid);
      writeAuditLog(db, { action: 'create', entityType: 'inventory_item', entityId: id, details: { name, unit } });
      return { success: true, data: { id } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:adjust', async (_event, payload: AdjustInventoryPayload) => {
    try {
      assertCurrentPermission('inventory_adjust');
      if (['correction'].includes(payload.type)) { assertCurrentPermission('inventory_cost'); }
      const db = getDB();
      const info = db.transaction(() => {
        const logId = recordMovement(db, {
          itemId: payload.item_id,
          type: payload.type,
          qtyChange: payload.qty_change,
          note: payload.note ?? null,
        });
        writeAuditLog(db, { action: 'stock_movement', entityType: 'inventory_item', entityId: payload.item_id, details: { type: payload.type, qty_change: payload.qty_change, logId } });
        return logId;
      })();
      return { success: true, data: { id: info } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('inventory:updateRecipe', async (_event, payload: { menuItemId: number; ingredients: Array<{ inventory_item_id: number; qty_used: number }> }) => {
    try {
      assertCurrentPermission('inventory_recipes');
      const db = getDB();
      const menuItem = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(payload.menuItemId);
      if (!menuItem) { throw new Error('Menu item not found'); }
      db.transaction(() => {
        db.prepare('DELETE FROM menu_inventory_map WHERE menu_item_id = ?').run(payload.menuItemId);
        const insert = db.prepare('INSERT INTO menu_inventory_map (menu_item_id, inventory_item_id, qty_used) VALUES (?, ?, ?)');
        for (const ing of payload.ingredients) {
          const inv = db.prepare('SELECT id, unit FROM inventory_items WHERE id = ?').get(ing.inventory_item_id) as { id: number; unit: string } | undefined;
          if (!inv) { throw new Error('Inventory item not found'); }
          const qty = ing.qty_used;
          if (!Number.isFinite(qty) || qty <= 0) { throw new Error('Recipe quantity must be positive'); }
          insert.run(payload.menuItemId, ing.inventory_item_id, qty);
        }
      })();
      writeAuditLog(db, { action: 'recipe_updated', entityType: 'menu_item', entityId: payload.menuItemId, details: { ingredients: payload.ingredients.length } });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
