import { fromMinorUnits, toMinorUnits } from './money';

export type TaxRounding = 'line' | 'bill';
export type TaxMode = 'exclusive' | 'inclusive';

export interface TaxSettings {
  enabled: boolean;
  name: string;
  rate: number;
  mode: TaxMode;
  rounding: TaxRounding;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  deliveryChargeMinor: number;
}

export interface TaxSnapshot {
  tax_name: string;
  tax_rate: number;
  tax_mode: TaxMode;
}

export interface OrderItem {
  id?: number;
  unit_price: number;
  unit_price_minor?: number | null;
  qty: number;
  tax_rate?: number | null;
  tax_name?: string | null;
  tax_mode?: TaxMode | null;
  cgst_rate?: number;
  sgst_rate?: number;
  discount?: number;
  discount_minor?: number | null;
}

export interface BillTotals {
  taxable_amount: number;
  tax_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  discount_amount: number;
  service_charge_amount: number;
  delivery_charge_amount: number;
  total_amount: number;
  taxable_amount_minor: number;
  tax_amount_minor: number;
  discount_amount_minor: number;
  service_charge_minor: number;
  delivery_charge_minor: number;
  total_amount_minor: number;
  tax_name: string;
  tax_rate: number;
  tax_mode: TaxMode;
}

export function getTaxSettings(store?: { get: (key: string, defaultValue?: unknown) => unknown }): TaxSettings {
  const safeStore = store ?? { get: (_key: string, defaultValue?: unknown) => defaultValue };
  return {
    enabled: safeStore.get('tax_enabled', false) as boolean,
    name: (safeStore.get('tax_name', 'Sales Tax') as string) || 'Sales Tax',
    rate: Number(safeStore.get('tax_rate', 0) ?? 0),
    mode: (() => { const v = safeStore.get('tax_mode', 'exclusive'); return v === 'inclusive' || v === 'exclusive' ? v : 'exclusive'; })(),
    rounding: (() => { const v = safeStore.get('tax_rounding', 'line'); return v === 'line' || v === 'bill' ? v : 'line'; })(),
    serviceChargeEnabled: safeStore.get('service_charge_enabled', false) as boolean,
    serviceChargeRate: Number(safeStore.get('service_charge_rate', 0) ?? 0),
    deliveryChargeMinor: (() => { const v = safeStore.get('delivery_charge', 0); return toMinorUnits(typeof v === 'number' || typeof v === 'string' ? v : 0); })(),
  };
}

function roundRate(amountMinor: number, rate: number): number {
  return Math.round((amountMinor * rate) / 100);
}

export function calcLineItemTaxMinor(unitPriceMinor: number, qty: number, rate: number, mode: TaxMode, discountMinor = 0) {
  const grossMinor = unitPriceMinor * qty;
  const afterDiscountMinor = Math.max(0, grossMinor - discountMinor);
  if (rate <= 0) {
    return { taxableMinor: afterDiscountMinor, taxMinor: 0, totalMinor: afterDiscountMinor };
  }
  if (mode === 'inclusive') {
    const taxableMinor = Math.round((afterDiscountMinor * 100) / (100 + rate));
    const taxMinor = afterDiscountMinor - taxableMinor;
    return { taxableMinor, taxMinor, totalMinor: afterDiscountMinor };
  }
  const taxMinor = roundRate(afterDiscountMinor, rate);
  return { taxableMinor: afterDiscountMinor, taxMinor, totalMinor: afterDiscountMinor + taxMinor };
}

export function calcBillTotals(items: OrderItem[], settings: TaxSettings = getTaxSettings()): BillTotals {
  let taxableMinor = 0;
  let taxMinor = 0;
  let discountMinor = 0;
  let totalBeforeChargesMinor = 0;

  for (const item of items) {
    const unitMinor = item.unit_price_minor ?? toMinorUnits(item.unit_price);
    const itemDiscountMinor = item.discount_minor ?? toMinorUnits(item.discount ?? 0);
    const rate = settings.enabled ? (item.tax_rate ?? settings.rate) : 0;
    const mode = (item.tax_mode ?? settings.mode);
    const line = calcLineItemTaxMinor(unitMinor, item.qty, rate, mode, itemDiscountMinor);
    taxableMinor += line.taxableMinor;
    taxMinor += line.taxMinor;
    discountMinor += itemDiscountMinor;
    totalBeforeChargesMinor += line.totalMinor;
  }

  const serviceChargeMinor = settings.serviceChargeEnabled ? roundRate(taxableMinor, settings.serviceChargeRate) : 0;
  const deliveryChargeMinor = settings.deliveryChargeMinor;
  const totalMinor = totalBeforeChargesMinor + serviceChargeMinor + deliveryChargeMinor;

  return {
    taxable_amount: fromMinorUnits(taxableMinor),
    tax_amount: fromMinorUnits(taxMinor),
    cgst_amount: 0,
    sgst_amount: 0,
    discount_amount: fromMinorUnits(discountMinor),
    service_charge_amount: fromMinorUnits(serviceChargeMinor),
    delivery_charge_amount: fromMinorUnits(deliveryChargeMinor),
    total_amount: fromMinorUnits(totalMinor),
    taxable_amount_minor: taxableMinor,
    tax_amount_minor: taxMinor,
    discount_amount_minor: discountMinor,
    service_charge_minor: serviceChargeMinor,
    delivery_charge_minor: deliveryChargeMinor,
    total_amount_minor: totalMinor,
    tax_name: settings.enabled ? settings.name : 'Tax',
    tax_rate: settings.enabled ? settings.rate : 0,
    tax_mode: settings.mode,
  };
}

export function getCurrentTaxSnapshot(store?: { get: (key: string, defaultValue?: unknown) => unknown }): TaxSnapshot {
  const settings = getTaxSettings(store);
  return { tax_name: settings.enabled ? settings.name : 'Tax', tax_rate: settings.enabled ? settings.rate : 0, tax_mode: settings.mode };
}
