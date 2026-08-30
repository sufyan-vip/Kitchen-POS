import { ipcMain } from 'electron';
import {
  CategoryInput,
  deactivateCategory,
  deactivateDiningArea,
  deactivateMenuItem,
  deactivateModifier,
  deactivateModifierGroup,
  deactivateTable,
  deactivateVariant,
  DiningAreaInput,
  listCategories,
  listDiningAreas,
  listMenuItemModifierGroups,
  listMenuItems,
  listModifierGroups,
  listModifiers,
  listStage2AuditLogs,
  listTables,
  listVariants,
  MenuItemInput,
  ModifierGroupInput,
  ModifierInput,
  saveCategory,
  saveDiningArea,
  saveMenuItem,
  saveModifier,
  saveModifierGroup,
  saveTable,
  saveVariant,
  setMenuItemModifierGroups,
  setMenuItemAvailability,
  TableInput,
  updateTableLayout,
  updateTableStatus,
  VariantInput,
} from '../services/stage2';
import { TableShape, TableStatus } from '../services/stage2-validation';

function registerHandler<T>(operation: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: operation() };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Stage 2 operation failed' };
  }
}

export function registerStage2IPC(): void {
  ipcMain.handle('stage2:categories:list', async (_event, payload: { menuId: number; includeInactive?: boolean }) =>
    registerHandler(() => listCategories(payload.menuId, payload.includeInactive ?? false)));
  ipcMain.handle('stage2:categories:save', async (_event, payload: CategoryInput) =>
    registerHandler(() => saveCategory(payload)));
  ipcMain.handle('stage2:categories:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateCategory(id); }));

  ipcMain.handle('stage2:menu-items:list', async (_event, payload: { categoryId?: number; search?: string; includeInactive?: boolean } = {}) =>
    registerHandler(() => listMenuItems(payload.categoryId, payload.search ?? '', payload.includeInactive ?? false)));
  ipcMain.handle('stage2:menu-items:save', async (_event, payload: MenuItemInput) =>
    registerHandler(() => saveMenuItem(payload)));
  ipcMain.handle('stage2:menu-items:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateMenuItem(id); }));
  ipcMain.handle('stage2:menu-items:set-availability', async (_event, payload: { id: number; isAvailable: number | boolean }) =>
    registerHandler(() => { setMenuItemAvailability(payload.id, payload.isAvailable); }));

  ipcMain.handle('stage2:variants:list', async (_event, payload: { menuItemId: number; includeInactive?: boolean }) =>
    registerHandler(() => listVariants(payload.menuItemId, payload.includeInactive ?? false)));
  ipcMain.handle('stage2:variants:save', async (_event, payload: VariantInput) =>
    registerHandler(() => saveVariant(payload)));
  ipcMain.handle('stage2:variants:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateVariant(id); }));

  ipcMain.handle('stage2:modifier-groups:list', async (_event, payload: { includeInactive?: boolean } = {}) =>
    registerHandler(() => listModifierGroups(payload.includeInactive ?? false)));
  ipcMain.handle('stage2:modifier-groups:save', async (_event, payload: ModifierGroupInput) =>
    registerHandler(() => saveModifierGroup(payload)));
  ipcMain.handle('stage2:modifier-groups:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateModifierGroup(id); }));

  ipcMain.handle('stage2:modifiers:list', async (_event, payload: { modifierGroupId: number; includeInactive?: boolean }) =>
    registerHandler(() => listModifiers(payload.modifierGroupId, payload.includeInactive ?? false)));
  ipcMain.handle('stage2:modifiers:save', async (_event, payload: ModifierInput) =>
    registerHandler(() => saveModifier(payload)));
  ipcMain.handle('stage2:modifiers:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateModifier(id); }));

  ipcMain.handle('stage2:menu-item-modifier-groups:list', async (_event, menuItemId: number) =>
    registerHandler(() => listMenuItemModifierGroups(menuItemId)));
  ipcMain.handle('stage2:menu-item-modifier-groups:set', async (_event, payload: { menuItemId: number; modifierGroupIds: number[] }) =>
    registerHandler(() => { setMenuItemModifierGroups(payload.menuItemId, payload.modifierGroupIds); }));

  ipcMain.handle('stage2:dining-areas:list', async (_event, payload: { includeInactive?: boolean } = {}) =>
    registerHandler(() => listDiningAreas(payload.includeInactive ?? false)));
  ipcMain.handle('stage2:dining-areas:save', async (_event, payload: DiningAreaInput) =>
    registerHandler(() => saveDiningArea(payload)));
  ipcMain.handle('stage2:dining-areas:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateDiningArea(id); }));

  ipcMain.handle('stage2:tables:list', async (_event, payload: { diningAreaId?: number; includeInactive?: boolean } = {}) =>
    registerHandler(() => listTables(payload.diningAreaId, payload.includeInactive ?? false)));
  ipcMain.handle('stage2:tables:save', async (_event, payload: TableInput) =>
    registerHandler(() => saveTable(payload)));
  ipcMain.handle('stage2:tables:deactivate', async (_event, id: number) =>
    registerHandler(() => { deactivateTable(id); }));
  ipcMain.handle('stage2:tables:update-status', async (_event, payload: { id: number; status: TableStatus }) =>
    registerHandler(() => { updateTableStatus(payload.id, payload.status); }));
  ipcMain.handle('stage2:tables:update-layout', async (_event, payload: { id: number; position_x?: number; position_y?: number; width?: number; height?: number; rotation?: number; shape?: TableShape }) =>
    registerHandler(() => { updateTableLayout(payload); }));

  ipcMain.handle('stage2:audit:list', async (_event, limit?: number) =>
    registerHandler(() => listStage2AuditLogs(limit)));
}
