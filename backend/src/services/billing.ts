/* eslint-disable */
import Store from 'electron-store';
import { getDB } from '../db';
import { calcBillTotals, getTaxSettings, OrderItem } from './tax';
import { toMinorUnits } from './money';
import { getPaymentProvider, PaymentStatus } from './payments';

const store = new Store();

interface PaymentPayload {
  method: string;
  amount: number;
  reference?: string;
  provider?: string;
  status?: PaymentStatus;
  transactionReference?: string;
  providerReference?: string;
  metadata?: Record<string, unknown>;
}

export function getNextBillNumber(): string {
  const lastNumber = store.get('last_bill_number', 0) as number;
  const year = new Date().getFullYear();
  const prefix = (store.get('invoice_prefix', 'INV') as string) || 'INV';
  return `${prefix}-${year}-${(lastNumber + 1).toString().padStart(4, '0')}`;
}

function normalizePaymentMethod(method: string): string {
  if (method === 'upi' || method === 'complimentary') {return 'other';}
  return method;
}

function providerFor(method: string, explicit?: string): string {
  if (explicit) {return explicit;}
  if (['jazzcash', 'easypaisa', 'bank_transfer', 'card', 'cash', 'other'].includes(method)) {return method;}
  return 'other';
}

export async function createBill(orderId: number, payments: PaymentPayload[], discount: number, customerId?: number) {
  const db = getDB();
  const billNumber = getNextBillNumber();
  const currency = (store.get('currency', 'PKR') as string) || 'PKR';
  const taxSettings = getTaxSettings(store);

  for (const p of payments) {
    const provider = getPaymentProvider(providerFor(normalizePaymentMethod(p.method), p.provider));
    if (provider && !p.status) {
      // Create a provider-side request record, but never mark paid merely because the request was sent.
      const providerResult = await provider.createPayment({
        orderId,
        amountMinor: toMinorUnits(p.amount),
        currency,
        transactionReference: p.transactionReference ?? p.reference,
        metadata: p.metadata,
      });
      p.status = providerResult.status;
      p.transactionReference = providerResult.transactionReference;
      p.providerReference = providerResult.providerReference;
      p.metadata = { ...(p.metadata ?? {}), ...(providerResult.metadata ?? {}) };
    }
  }

  const result = db.transaction(() => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) as OrderItem[];
    const totals = calcBillTotals(items, taxSettings);
    const discountMinor = toMinorUnits(discount);
    totals.discount_amount_minor += discountMinor;
    totals.discount_amount = totals.discount_amount_minor / 100;
    totals.total_amount_minor = Math.max(0, totals.total_amount_minor - discountMinor);
    totals.total_amount = totals.total_amount_minor / 100;

    const orderRow = db.prepare('SELECT business_date FROM orders WHERE id = ?').get(orderId) as { business_date: string | null };

    const info = db.prepare(`
      INSERT INTO bills (
        bill_number, order_id, taxable_amount, cgst_amount, sgst_amount, discount_amount, total_amount, customer_id, business_date,
        currency, taxable_amount_minor, tax_name, tax_rate, tax_mode, tax_amount, tax_amount_minor,
        service_charge_amount, service_charge_minor, delivery_charge_amount, delivery_charge_minor, total_amount_minor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      billNumber, orderId, totals.taxable_amount, 0, 0, totals.discount_amount, totals.total_amount, customerId ?? null, orderRow.business_date ?? null,
      currency, totals.taxable_amount_minor, totals.tax_name, totals.tax_rate, totals.tax_mode, totals.tax_amount, totals.tax_amount_minor,
      totals.service_charge_amount, totals.service_charge_minor, totals.delivery_charge_amount, totals.delivery_charge_minor, totals.total_amount_minor
    );

    let paidMinor = 0;
    for (const p of payments) {
      const method = normalizePaymentMethod(p.method);
      const provider = providerFor(method, p.provider);
      const amountMinor = toMinorUnits(p.amount);
      const status: PaymentStatus = p.status ?? (['cash', 'card', 'bank_transfer', 'other', 'unpaid'].includes(method) ? 'PAID' : 'PENDING');
      db.prepare(`
        INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, transaction_reference, provider_reference, status, reference, failure_reason, metadata, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, provider, method, p.amount, amountMinor, currency, p.transactionReference ?? p.reference ?? null, p.providerReference ?? null, status, p.reference ?? null, null, p.metadata ? JSON.stringify(p.metadata) : null, status === 'PAID' ? new Date().toISOString() : null);
      if (status === 'PAID') {paidMinor += amountMinor;}
      if (method === 'unpaid') {
        if (!customerId) { throw new Error('Customer must be selected for unpaid balances.'); }
        db.prepare('UPDATE customers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(p.amount, customerId);
      }
    }

    const hasPending = payments.some(p => (p.status ?? 'PAID') !== 'PAID');
    db.prepare('UPDATE orders SET status = ?, customer_id = ? WHERE id = ?').run(hasPending || paidMinor < totals.total_amount_minor ? 'billed' : 'billed', customerId ?? null, orderId);

    const orderRecord = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(orderId) as { table_id: number };
    if (orderRecord && orderRecord.table_id) {
      db.prepare('UPDATE tables SET custom_name = NULL WHERE id = ?').run(orderRecord.table_id);
    }

    return {
      billId: info.lastInsertRowid,
      bill_number: billNumber,
      taxable_amount: totals.taxable_amount,
      tax_amount: totals.tax_amount,
      cgst_amount: 0,
      sgst_amount: 0,
      discount_amount: totals.discount_amount,
      service_charge_amount: totals.service_charge_amount,
      delivery_charge_amount: totals.delivery_charge_amount,
      total_amount: totals.total_amount,
      total_amount_minor: totals.total_amount_minor,
      currency,
      payment_status: hasPending || paidMinor < totals.total_amount_minor ? 'PAYMENT_PENDING' : 'PAID',
    };
  })();

  const lastNumber = store.get('last_bill_number', 0) as number;
  store.set('last_bill_number', lastNumber + 1);

  return result;
}
