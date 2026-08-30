import { ipcMain } from 'electron';
import {
  cancelPurchase, createPurchase, getPurchaseItems, listPurchases, listSuppliers,
  receivePurchase, saveSupplier, SupplierInput, PurchaseInput,
} from '../services/suppliers';

function wrap<T>(fn: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: fn() };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export function registerSuppliersIPC() {
  ipcMain.handle('suppliers:list', async (_event, payload: { includeInactive?: boolean } = {}) =>
    wrap(() => listSuppliers(payload.includeInactive ?? false)));
  ipcMain.handle('suppliers:save', async (_event, payload: SupplierInput) => wrap(() => saveSupplier(payload)));

  ipcMain.handle('purchases:list', async (_event, payload: { supplierId?: number; limit?: number } = {}) =>
    wrap(() => listPurchases(payload.supplierId, payload.limit)));
  ipcMain.handle('purchases:items', async (_event, payload: { purchaseId: number }) =>
    wrap(() => getPurchaseItems(payload.purchaseId)));
  ipcMain.handle('purchases:create', async (_event, payload: PurchaseInput) => wrap(() => createPurchase(payload)));
  ipcMain.handle('purchases:receive', async (_event, payload: { purchaseId: number }) => wrap(() => receivePurchase(payload.purchaseId)));
  ipcMain.handle('purchases:cancel', async (_event, payload: { purchaseId: number }) => wrap(() => { cancelPurchase(payload.purchaseId); return true; }));
}
