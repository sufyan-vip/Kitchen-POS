import { describe, expect, it } from 'vitest';
import { formatCurrency, formatCurrencyMinor, toMinorUnits } from './money';
import { calcBillTotals, calcLineItemTaxMinor, OrderItem, TaxSettings } from './tax';
import { assertValidPaymentTransition, canTransitionPaymentStatus, EasypaisaProvider, JazzCashProvider } from './payments';
import { hasPermission } from './authz';

const baseSettings: TaxSettings = {
  enabled: true,
  name: 'Sales Tax',
  rate: 15,
  mode: 'exclusive',
  rounding: 'line',
  serviceChargeEnabled: true,
  serviceChargeRate: 10,
  deliveryChargeMinor: 0,
};

describe('Pakistan POS money and tax', () => {
  it('formats PKR without INR symbols', () => {
    expect(formatCurrencyMinor(170000)).toBe('Rs 1,700');
    // Major units are never re-interpreted as paisa (receipts pass rupees).
    expect(formatCurrency(1700)).toBe('Rs 1,700');
    expect(formatCurrency(1700.5)).toBe('Rs 1,700.5');
    expect(formatCurrency('2300.50')).toBe('Rs 2,300.5');
  });

  it('uses minor units to avoid floating point drift', () => {
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });

  it('calculates exclusive tax and service charge', () => {
    const items: OrderItem[] = [{ unit_price: 1000, qty: 2, tax_rate: 15, tax_name: 'Sales Tax', tax_mode: 'exclusive' }];
    const totals = calcBillTotals(items, baseSettings);
    expect(totals.taxable_amount_minor).toBe(200000);
    expect(totals.tax_amount_minor).toBe(30000);
    expect(totals.service_charge_minor).toBe(20000);
    expect(totals.total_amount_minor).toBe(250000);
  });

  it('calculates inclusive tax', () => {
    const line = calcLineItemTaxMinor(11500, 1, 15, 'inclusive', 0);
    expect(line.taxableMinor).toBe(10000);
    expect(line.taxMinor).toBe(1500);
    expect(line.totalMinor).toBe(11500);
  });

  it('preserves historical item tax snapshots over current settings', () => {
    const items: OrderItem[] = [{ unit_price: 1000, qty: 1, tax_rate: 5, tax_name: 'Old Tax', tax_mode: 'exclusive' }];
    const totals = calcBillTotals(items, { ...baseSettings, rate: 20, serviceChargeEnabled: false });
    expect(totals.tax_amount_minor).toBe(5000);
  });
});

describe('payment state and providers', () => {
  it('allows pending payment to become paid or failed', () => {
    expect(canTransitionPaymentStatus('PENDING', 'PAID')).toBe(true);
    expect(canTransitionPaymentStatus('PENDING', 'FAILED')).toBe(true);
  });

  it('rejects invalid duplicate/terminal transitions', () => {
    expect(() => { assertValidPaymentTransition('FAILED', 'PAID'); }).toThrow(/Invalid payment status transition/);
    expect(canTransitionPaymentStatus('PAID', 'PAID')).toBe(true);
  });

  it('keeps JazzCash pending without configured credentials', async () => {
    const res = await new JazzCashProvider({}).createPayment({ orderId: 10, amountMinor: 1000, currency: 'PKR' });
    expect(res.status).toBe('PENDING');
    expect(res.metadata?.configured).toBe(false);
  });

  it('keeps Easypaisa pending without configured credentials', async () => {
    const res = await new EasypaisaProvider({}).createPayment({ orderId: 10, amountMinor: 1000, currency: 'PKR' });
    expect(res.status).toBe('PENDING');
    expect(res.metadata?.configured).toBe(false);
  });

  it('models cancellation and duplicate terminal states safely', () => {
    expect(canTransitionPaymentStatus('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionPaymentStatus('CANCELLED', 'PAID')).toBe(false);
  });
});

describe('permissions', () => {
  it('enforces permissions by role definitions', () => {
    expect(hasPermission('admin', 'tax_configuration')).toBe(true);
    expect(hasPermission('cashier', 'payments')).toBe(true);
    expect(hasPermission('waiter', 'refunds')).toBe(false);
    expect(hasPermission('kitchen', 'settings')).toBe(false);
  });
});
