import { ipcMain } from 'electron';
import { printKOT, printBill } from '../services/printer';

interface KOTPayload { items: Array<{ name: string; qty: number }>; tableName: string; orderNote: string; }
interface BillPayload {
  bill: { bill_number: string; taxable_amount: number; tax_amount?: number; cgst_amount?: number; sgst_amount?: number; discount_amount: number; service_charge_amount?: number; delivery_charge_amount?: number; total_amount: number; currency?: string; tax_name?: string; date?: string; };
  orderItems: Array<{ name: string; qty: number; unit_price: number }>;
  settings: { restaurant_name?: string; outlet_name?: string; address?: string; city?: string; province?: string; phone?: string; receipt_footer?: string; currency?: string; tax_name?: string; };
}

export function registerPrinterIPC() {
  ipcMain.handle('print:kot', async (_, payload: KOTPayload) => {
    try { await printKOT(payload.items, payload.tableName, payload.orderNote); return { success: true }; }
    catch (e: unknown) { return { success: false, error: e instanceof Error ? e.message : 'Unknown printing error' }; }
  });
  ipcMain.handle('print:bill', async (_, payload: BillPayload) => {
    try { await printBill(payload.bill, payload.orderItems, payload.settings); return { success: true }; }
    catch (e: unknown) { return { success: false, error: e instanceof Error ? e.message : 'Unknown printing error' }; }
  });
}
