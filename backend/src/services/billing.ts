import { getDB } from '../db';
import { calcBillTotals } from './tax';
import { toMinorUnits } from './money';
import { getPaymentProvider, PaymentStatus } from './payments';
import { getOrderById, getOrderItems, releaseTable } from './order-service';
import { getAppSettings, getSettingsStore } from './settings';
import { writeAuditLog } from './audit';
import { findActiveShiftForTimestamp, recordCashPayment } from './cash';

export interface PaymentPayload {
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
  const store = getSettingsStore();
  const lastNumber = store.get('last_bill_number', 0) as number;
  const year = new Date().getFullYear();
  const prefix = (store.get('invoice_prefix', 'INV') as string) || 'INV';
  return `${prefix}-${year}-${(lastNumber + 1).toString().padStart(4, '0')}`;
}

function normalizePaymentMethod(method: string): string {
  if (method === 'upi' || method === 'complimentary') { return 'other'; }
  return method;
}

function providerFor(method: string, explicit?: string): string {
  if (explicit) { return explicit; }
  if (['jazzcash', 'easypaisa', 'bank_transfer', 'card', 'cash', 'other', 'unpaid'].includes(method)) { return method; }
  return 'other';
}

/**
 * Create a bill from the order's STORED authoritative totals. Payments are
 * validated: no negatives, no overpayment, no duplicate settlement, and the
 * order is only completed when fully settled (or closed with an unpaid
 * balance on a customer account).
 */
export async function createBill(
  orderId: number,
  payments: PaymentPayload[],
  discount: { type: 'PERCENT' | 'FIXED' | null; value: number } | number | null = null,
  customerId?: number,
) {
  const db = getDB();
  const order = getOrderById(orderId);
  if (!order) { throw new Error('Order not found'); }
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED') { throw new Error('Order is already closed'); }

  // Normalise discount input (legacy callers pass a number of rupees)
  let discountType: 'PERCENT' | 'FIXED' | null = null;
  let discountMinor = 0;
  if (typeof discount === 'number') {
    discountType = 'FIXED';
    discountMinor = toMinorUnits(discount);
  } else if (discount?.type) {
    discountType = discount.type;
    discountMinor = discount.type === 'PERCENT'
      ? Math.round((order.subtotal_minor * Math.min(Math.max(discount.value || 0, 0), 100)) / 100)
      : toMinorUnits(discount.value);
  }

  const settings = getAppSettings();
  const currency = settings.currency || 'PKR';

  // Authoritative totals: order snapshot + this bill's discount (a discount
  // applied at bill time is stored on the order so history stays consistent)
  const totalMinor = Math.max(0, order.total_minor - discountMinor);
  if (order.discount_type === null && discountMinor > 0) {
    db.prepare('UPDATE orders SET discount_type = ?, discount_percent = ?, discount_minor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(discountType, discountType === 'PERCENT' ? (discount as { value: number }).value : null, order.discount_minor + discountMinor, orderId);
  }

  const billNumber = getNextBillNumber();

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
    // ── Payment validation ────────────────────────────────────────────
    // Start from amounts already settled on earlier partial bills so
    // multi-payment settlement never overpays.
    let paidMinor = order.total_paid_minor;
    const validated: Array<PaymentPayload & { amountMinor: number; method: string; provider: string }> = [];
    for (const p of payments) {
      const amountMinor = toMinorUnits(p.amount);
      if (amountMinor <= 0) { throw new Error('Payment amounts must be positive'); }
      const method = normalizePaymentMethod(p.method);
      const validMethods = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'other', 'unpaid'];
      if (!validMethods.includes(method)) { throw new Error(`Unsupported payment method: ${method}`); }
      const status: PaymentStatus = p.status ?? (['cash', 'card', 'bank_transfer', 'other', 'unpaid'].includes(method) ? 'PAID' : 'PENDING');
      if (status === 'PAID') {
        paidMinor += amountMinor;
        if (paidMinor > totalMinor) {
          throw new Error('Overpayment: payment amount exceeds the bill total');
        }
      }
      validated.push({ ...p, amountMinor, method, provider: providerFor(method, p.provider) });
    }

    const unpaidMinor = validated.filter(p => p.method === 'unpaid' && (p.status ?? 'PAID') === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
    if (unpaidMinor > 0 && !customerId) {
      throw new Error('Customer must be selected for unpaid balances.');
    }
    if (unpaidMinor > 0 && customerId) {
      const customer = db.prepare('SELECT credit_limit, outstanding_balance FROM customers WHERE id = ?').get(customerId) as { credit_limit: number | null; outstanding_balance: number | null } | undefined;
      if (!customer) { throw new Error('Customer not found'); }
      // Customers store rupee-denominated REAL columns; compare in integer paise.
      const outstandingMinor = Math.round((customer.outstanding_balance ?? 0) * 100);
      const creditLimitMinor = Math.round((customer.credit_limit ?? 0) * 100);
      if (outstandingMinor + unpaidMinor > creditLimitMinor) {
        throw new Error('Credit limit exceeded for this customer');
      }
    }

    const items = getOrderItems(orderId);
    const legacyTotals = calcBillTotals(items.map(i => ({
      unit_price: 0,
      unit_price_minor: i.unit_price_minor ?? Math.round(i.unit_price * 100),
      qty: i.qty,
      tax_rate: i.tax_rate ?? 0,
      tax_name: i.tax_name,
      tax_mode: (i.tax_mode ?? 'exclusive') as 'exclusive' | 'inclusive',
    })), {
      enabled: settings.tax_enabled,
      name: settings.tax_name,
      rate: settings.tax_rate || 0,
      mode: settings.tax_mode,
      rounding: settings.tax_rounding,
      serviceChargeEnabled: settings.service_charge_enabled,
      serviceChargeRate: settings.service_charge_rate || 0,
      deliveryChargeMinor: order.delivery_charge_minor,
    });

    const taxMinor = order.tax_minor;
    const serviceChargeMinor = order.service_charge_minor;
    const subtotalMinor = order.subtotal_minor;
    const totalDiscountMinor = order.discount_minor + discountMinor;

    const info = db.prepare(`
      INSERT INTO bills (
        bill_number, order_id, taxable_amount, cgst_amount, sgst_amount, discount_amount, total_amount, customer_id, business_date,
        currency, taxable_amount_minor, tax_name, tax_rate, tax_mode, tax_amount, tax_amount_minor,
        service_charge_amount, service_charge_minor, delivery_charge_amount, delivery_charge_minor, total_amount_minor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      billNumber, orderId, legacyTotals.taxable_amount, 0, 0, totalDiscountMinor / 100, totalMinor / 100, customerId ?? null, order.business_date ?? null,
      currency, subtotalMinor, order.tax_name ?? (settings.tax_enabled ? settings.tax_name : 'Tax'), order.tax_rate, order.tax_mode,
      taxMinor / 100, taxMinor,
      serviceChargeMinor / 100, serviceChargeMinor, order.delivery_charge_minor / 100, order.delivery_charge_minor, totalMinor,
    );

    const shiftId = findActiveShiftForTimestamp(db, order.created_at);
    const insertPayment = db.prepare(`
      INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, transaction_reference, provider_reference, status, reference, failure_reason, metadata, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of validated) {
      const paymentStatus: PaymentStatus = p.status ?? (['cash', 'card', 'bank_transfer', 'other', 'unpaid'].includes(p.method) ? 'PAID' : 'PENDING');
      const paymentInfo = insertPayment.run(
        orderId, p.provider, p.method, p.amountMinor / 100, p.amountMinor, currency,
        p.transactionReference ?? p.reference ?? null, p.providerReference ?? null, paymentStatus,
        p.reference ?? null, null, p.metadata ? JSON.stringify(p.metadata) : null,
        paymentStatus === 'PAID' ? new Date().toISOString() : null,
      );
      if (paymentStatus === 'PAID' && p.method === 'cash') {
        recordCashPayment(db, shiftId, 'SALE', p.amountMinor, Number(paymentInfo.lastInsertRowid));
      }
      if (p.method === 'unpaid' && paymentStatus === 'PAID') {
        db.prepare('UPDATE customers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(p.amountMinor / 100, customerId);
      }
    }

    const settledMinor = paidMinor + unpaidMinor;
    const fullyPaid = settledMinor >= totalMinor && validated.length > 0;
    db.prepare('UPDATE orders SET total_paid_minor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(paidMinor, orderId);

    if (customerId) {
      db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customerId, orderId);
      db.prepare('UPDATE customers SET total_visits = total_visits + 1 WHERE id = ?').run(customerId);
    }

    if (fullyPaid) {
      db.prepare(`
        UPDATE orders SET status = 'COMPLETED', kds_status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(orderId);
      if (settings.auto_release_table_on_bill && order.table_id) {
        releaseTable(order.table_id);
      }
    } else if (unpaidMinor > 0 && settledMinor >= totalMinor) {
      // Balance is on customer account — order completes; the unpaid ledger is tracked
      db.prepare(`
        UPDATE orders SET status = 'COMPLETED', kds_status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(orderId);
      if (settings.auto_release_table_on_bill && order.table_id) {
        releaseTable(order.table_id);
      }
    }

    writeAuditLog(db, {
      action: 'bill_created', entityType: 'bill', entityId: Number(info.lastInsertRowid),
      details: { orderId, bill_number: billNumber, total_minor: totalMinor, paid_minor: paidMinor, unpaid_minor: unpaidMinor },
    });

    return {
      billId: Number(info.lastInsertRowid),
      bill_number: billNumber,
      order_id: orderId,
      order_number: order.order_number,
      taxable_amount: legacyTotals.taxable_amount,
      tax_amount: taxMinor / 100,
      discount_amount: totalDiscountMinor / 100,
      service_charge_amount: serviceChargeMinor / 100,
      delivery_charge_amount: order.delivery_charge_minor / 100,
      total_amount: totalMinor / 100,
      total_amount_minor: totalMinor,
      paid_minor: paidMinor,
      remaining_minor: Math.max(0, totalMinor - paidMinor - unpaidMinor),
      currency,
      payment_status: fullyPaid ? 'PAID' : 'PAYMENT_PENDING',
    };
  })();

  const store = getSettingsStore();
  const lastNumber = store.get('last_bill_number', 0) as number;
  store.set('last_bill_number', lastNumber + 1);

  return result;
}

export function getBillForOrder(orderId: number): unknown {
  const db = getDB();
  const bill = db.prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
  if (!bill) { return null; }
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').all(orderId);
  const items = getOrderItems(orderId);
  return { bill, payments, items };
}

export function getBillById(billId: number): unknown {
  const db = getDB();
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) { return null; }
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = (SELECT order_id FROM bills WHERE id = ?) ORDER BY id').all(billId);
  const items = getOrderItems((bill as { order_id: number }).order_id);
  return { bill, payments, items };
}
