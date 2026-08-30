import { ipcMain } from 'electron';
import { createBill, getBillById, getBillForOrder, PaymentPayload } from '../services/billing';
import { assertCurrentPermission } from '../services/authz';
import { getDB } from '../db';

interface CreateBillPayload {
  orderId: number;
  payments: PaymentPayload[];
  discount?: { type: 'PERCENT' | 'FIXED' | null; value: number } | number;
  customerId?: number;
}

export function registerBillingIPC() {
  ipcMain.handle('billing:createBill', async (_event, payload: CreateBillPayload) => {
    try {
      assertCurrentPermission('payments');
      if ((typeof payload.discount === 'number' && payload.discount > 0)
        || (typeof payload.discount === 'object' && payload.discount.type && payload.discount.value > 0)) {
        assertCurrentPermission('discounts');
      }
      const res = await createBill(payload.orderId, payload.payments, payload.discount ?? 0, payload.customerId);
      return { success: true, data: res };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });

  ipcMain.handle('billing:getBill', async (_event, payload: { orderId?: number; billId?: number }) => {
    try {
      assertCurrentPermission('payments');
      const db = getDB();
      if (payload.billId) {
        return { success: true, data: getBillById(payload.billId) };
      }
      if (payload.orderId) {
        const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(payload.orderId) as { id: number } | undefined;
        if (!order) { return { success: false, error: 'Order not found' }; }
        return { success: true, data: getBillForOrder(payload.orderId) };
      }
      return { success: false, error: 'Provide orderId or billId' };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
  });
}
