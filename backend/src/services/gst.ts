// Compatibility shim: the Pakistanized POS now uses configurable tax rules.
// Legacy imports from ./gst are preserved so old code and historical GST fields keep working.
export type { OrderItem, BillTotals, TaxSettings, TaxSnapshot } from './tax';
export { calcBillTotals, calcLineItemTaxMinor, getCurrentTaxSnapshot, getTaxSettings } from './tax';
