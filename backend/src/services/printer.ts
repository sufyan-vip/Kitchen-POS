/* eslint-disable */
import { BrowserWindow } from 'electron';
import { formatCurrency } from './money';

interface KOTPrintItem {
  name: string;
  qty: number;
}

interface BillPrintPayload {
  bill_number: string;
  taxable_amount: number;
  tax_amount?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  discount_amount: number;
  service_charge_amount?: number;
  delivery_charge_amount?: number;
  total_amount: number;
  currency?: string;
  tax_name?: string;
  date?: string;
}

interface BillItemPrintPayload {
  name: string;
  qty: number;
  unit_price: number;
}

interface OutletSettings {
  restaurant_name?: string;
  outlet_name?: string;
  address?: string;
  city?: string;
  province?: string;
  phone?: string;
  receipt_footer?: string;
  currency?: string;
  tax_enabled?: boolean;
  tax_name?: string;
  gstin?: string;
  is_gst_enabled?: boolean;
}

const hiddenWindows = new Set<BrowserWindow>();

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

async function printHtml(htmlContent: string): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: true,
      width: 400,
      height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    hiddenWindows.add(win);
    const cleanup = () => { if (!win.isDestroyed()) {win.close();} hiddenWindows.delete(win); };
    const timeout = setTimeout(() => { cleanup(); resolve(); }, 300000);
    win.webContents.once('did-finish-load', () => {
      win.webContents.print({ silent: false, printBackground: true, color: false, margins: { marginType: 'printableArea' } }, (success, errorType) => {
        clearTimeout(timeout);
        if (!success) {console.error('Print failed:', errorType);}
        resolve();
        cleanup();
      });
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  });
}

export async function printKOT(items: KOTPrintItem[], tableName: string, orderNote: string): Promise<void> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; } body{font-family:'Courier New',monospace;font-size:14px;font-weight:bold;color:black;line-height:1.3;margin:0;padding:20px;background:#e5e7eb;display:flex;justify-content:center;min-height:100vh;box-sizing:border-box}.receipt{width:300px;background:#fff;padding:20px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1)}@media print{body{padding:0;background:#fff;display:block;min-height:auto}.receipt{width:100%;padding:0;box-shadow:none;margin:0;max-width:none}}.text-center{text-align:center}.fw-bold{font-weight:bold}.fs-large{font-size:18px}.divider{border-bottom:2px dashed #000;margin:10px 0}.item{display:flex;justify-content:space-between;margin-bottom:6px;font-size:15px}.note{margin-top:10px;font-style:italic;font-size:14px}
  </style></head><body><div class="receipt">
    <div class="text-center fw-bold fs-large">*** KOT ***</div>
    <div class="text-center fs-large mt-2">Table: ${escapeHtml(tableName)}</div>
    <div class="text-center mt-2">Date: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</div>
    <div class="divider"></div>
    ${items.map(i => `<div class="item"><span>${escapeHtml(i.qty)} x ${escapeHtml(i.name)}</span></div>`).join('')}
    ${orderNote ? `<div class="divider"></div><div class="note">Note: ${escapeHtml(orderNote)}</div>` : ''}
    <div class="divider"></div><div class="text-center">End of KOT</div>
  </div></body></html>`;
  await printHtml(html);
}

export async function printBill(bill: BillPrintPayload, orderItems: BillItemPrintPayload[], settings: OutletSettings): Promise<void> {
  const currency = bill.currency ?? settings.currency ?? 'PKR';
  const taxAmount = bill.tax_amount ?? ((bill.cgst_amount ?? 0) + (bill.sgst_amount ?? 0));
  const taxName = bill.tax_name ?? settings.tax_name ?? 'Tax';
  const addressLine = [settings.address, settings.city, settings.province].filter(Boolean).join(', ');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; } body{font-family:'Courier New',monospace;font-size:13px;font-weight:bold;color:black;line-height:1.3;margin:0;padding:20px;background:#e5e7eb;display:flex;justify-content:center;min-height:100vh;box-sizing:border-box}.receipt{width:300px;background:#fff;padding:20px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1)}@media print{body{padding:0;background:#fff;display:block;min-height:auto}.receipt{width:100%;padding:0;box-shadow:none;margin:0;max-width:none}}.text-center{text-align:center}.fw-bold{font-weight:bold}.fs-large{font-size:18px}.divider{border-bottom:2px dashed #000;margin:10px 0}.item,.summary-row{display:flex;justify-content:space-between;margin-bottom:4px}.item-name{flex:1;padding-right:10px}.item-qty{width:40px}.item-total{width:90px;text-align:right}
  </style></head><body><div class="receipt">
    <div class="text-center fw-bold fs-large">${escapeHtml(settings.restaurant_name ?? settings.outlet_name ?? 'Restaurant POS')}</div>
    ${addressLine ? `<div class="text-center">${escapeHtml(addressLine)}</div>` : ''}
    ${settings.phone ? `<div class="text-center">${escapeHtml(settings.phone)}</div>` : ''}
    <div class="divider"></div>
    <div>Order/Bill: ${escapeHtml(bill.bill_number)}</div>
    <div>Date: ${bill.date ? new Date(`${bill.date}Z`).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</div>
    <div class="divider"></div>
    ${orderItems.map(i => `<div class="item"><span class="item-name">${escapeHtml(i.name)}</span><span class="item-qty">${i.qty}x</span><span class="item-total">${formatCurrency(i.qty * i.unit_price, currency)}</span></div>`).join('')}
    <div class="divider"></div>
    <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(bill.taxable_amount, currency)}</span></div>
    ${taxAmount > 0 ? `<div class="summary-row"><span>${escapeHtml(taxName)}:</span><span>${formatCurrency(taxAmount, currency)}</span></div>` : ''}
    ${bill.service_charge_amount && bill.service_charge_amount > 0 ? `<div class="summary-row"><span>Service Charge:</span><span>${formatCurrency(bill.service_charge_amount, currency)}</span></div>` : ''}
    ${bill.delivery_charge_amount && bill.delivery_charge_amount > 0 ? `<div class="summary-row"><span>Delivery Charge:</span><span>${formatCurrency(bill.delivery_charge_amount, currency)}</span></div>` : ''}
    ${bill.discount_amount > 0 ? `<div class="summary-row"><span>Discount:</span><span>-${formatCurrency(bill.discount_amount, currency)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="summary-row fw-bold fs-large"><span>TOTAL:</span><span>${formatCurrency(bill.total_amount, currency)}</span></div>
    <div class="divider"></div>
    <div class="text-center fw-bold">${escapeHtml(settings.receipt_footer ?? 'Thank You!')}</div>
  </div></body></html>`;
  await printHtml(html);
}
