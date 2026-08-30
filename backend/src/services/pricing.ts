/**
 * Authoritative order pricing — integer PKR minor units only.
 * Frontend-provided totals are never trusted; every line and every order is
 * re-priced server-side from stored menu snapshots.
 */
import type Database from 'better-sqlite3';
import { getAppSettings } from './settings';
import { toMinorUnits } from './money';

export interface ModifierSelectionInput {
  id: number;
  qty: number;
}

export interface OrderLineInput {
  menu_item_id: number;
  qty: number;
  variant_id?: number | null;
  modifiers?: ModifierSelectionInput[];
  note?: string | null;
}

export interface PricedLine {
  menu_item_id: number;
  name: string;
  qty: number;
  unit_price_minor: number;
  variant_id: number | null;
  variant_name: string | null;
  modifier_snapshot: ModifierSnapshot[];
  note: string | null;
  line_total_minor: number;
  tax_name: string | null;
  tax_rate: number;
  tax_mode: 'exclusive' | 'inclusive';
}

export interface ModifierSnapshot {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  price_minor: number;
  qty: number;
}

export interface OrderTotals {
  subtotal_minor: number;
  taxable_minor: number;
  tax_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  delivery_charge_minor: number;
  total_minor: number;
}

export interface OrderDiscount {
  type: 'PERCENT' | 'FIXED' | null;
  percent: number;
  minor: number;
}

function roundRate(amountMinor: number, rate: number): number {
  return Math.round((amountMinor * rate) / 100);
}

export function lineTax(line: Pick<OrderLineInput, never> & { taxable_minor: number; tax_rate: number; tax_mode: 'exclusive' | 'inclusive'; tax_enabled: boolean }): { taxable_minor: number; tax_minor: number } {
  const { taxable_minor, tax_rate, tax_mode, tax_enabled } = line;
  if (!tax_enabled || tax_rate <= 0) {
    return { taxable_minor, tax_minor: 0 };
  }
  if (tax_mode === 'inclusive') {
    const base = Math.round((taxable_minor * 100) / (100 + tax_rate));
    return { taxable_minor: base, tax_minor: taxable_minor - base };
  }
  return { taxable_minor, tax_minor: roundRate(taxable_minor, tax_rate) };
}

/**
 * Validate and price a single order line from menu snapshots.
 * Throws on inactive items/variants/modifiers or invalid modifier selections
 * (inactive modifier, min/max selection counts violated).
 */
export function priceOrderLine(
  db: Database.Database,
  input: OrderLineInput,
  taxSettings: { enabled: boolean; name: string; rate: number; mode: 'exclusive' | 'inclusive' },
): PricedLine {
  const qty = Math.trunc(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive whole number');
  }
  const menuItem = db.prepare(
    'SELECT id, name, price_minor, tax_name, tax_rate, tax_mode, is_active, is_available FROM menu_items WHERE id = ?'
  ).get(input.menu_item_id) as
    | { id: number; name: string; price_minor: number | null; tax_name: string | null; tax_rate: number | null; tax_mode: string | null; is_active: number; is_available: number }
    | undefined;
  if (!menuItem) { throw new Error(`Menu item ${input.menu_item_id} not found`); }
  if (!menuItem.is_active || !menuItem.is_available) { throw new Error(`"${menuItem.name}" is not available`); }

  const basePrice = menuItem.price_minor ?? toMinorUnits(0);

  // Variant
  let variantId: number | null = null;
  let variantName: string | null = null;
  let unitMinor = basePrice;
  if (input.variant_id !== undefined && input.variant_id !== null) {
    const variant = db.prepare(
      'SELECT id, name, price_minor, is_active FROM menu_item_variants WHERE id = ? AND menu_item_id = ?'
    ).get(input.variant_id, menuItem.id) as { id: number; name: string; price_minor: number; is_active: number } | undefined;
    if (!variant) { throw new Error(`Variant not found for "${menuItem.name}"`); }
    if (!variant.is_active) { throw new Error(`Variant "${variant.name}" is inactive`); }
    variantId = variant.id;
    variantName = variant.name;
    unitMinor = variant.price_minor;
  }

  // Modifiers + modifier group validation. Every group linked to the menu item
  // is validated — including required groups with zero selections.
  const linkedGroups = db.prepare(`
    SELECT g.id, g.name, g.selection_type, g.min_selections, g.max_selections, g.is_active
    FROM menu_item_modifier_groups mig
    JOIN modifier_groups g ON g.id = mig.modifier_group_id
    WHERE mig.menu_item_id = ?
    ORDER BY mig.sort_order, g.id
  `).all(menuItem.id) as Array<{ id: number; name: string; selection_type: 'single' | 'multiple'; min_selections: number; max_selections: number | null; is_active: number }>;

  const selected = input.modifiers ?? [];
  const byGroup = new Map<number, { groupName: string; items: { id: number; name: string; price_minor: number; qty: number }[]; totalQty: number }>();
  for (const sel of selected) {
    const mod = db.prepare(
      'SELECT m.id, m.name, m.price_minor, m.is_active, m.modifier_group_id FROM modifiers m WHERE m.id = ?'
    ).get(sel.id) as
      | { id: number; name: string; price_minor: number; is_active: number; modifier_group_id: number }
      | undefined;
    if (!mod) { throw new Error(`Modifier ${sel.id} not found`); }
    if (!mod.is_active) { throw new Error(`Modifier "${mod.name}" is inactive`); }
    if (!linkedGroups.some(g => g.id === mod.modifier_group_id)) {
      throw new Error(`Modifier "${mod.name}" is not available for "${menuItem.name}"`);
    }
    const selQty = Math.trunc(sel.qty);
    if (!Number.isFinite(selQty) || selQty <= 0) { throw new Error('Modifier quantity must be a positive whole number'); }
    const entry = byGroup.get(mod.modifier_group_id) ?? { groupName: linkedGroups.find(g => g.id === mod.modifier_group_id)?.name ?? 'Options', items: [], totalQty: 0 };
    const existing = entry.items.find(i => i.id === mod.id);
    if (existing) { existing.qty += selQty; } else { entry.items.push({ id: mod.id, name: mod.name, price_minor: mod.price_minor, qty: selQty }); }
    entry.totalQty += selQty;
    byGroup.set(mod.modifier_group_id, entry);
  }

  const modifierSnapshot: ModifierSnapshot[] = [];
  let modifierTotalMinor = 0;
  for (const groupRow of linkedGroups) {
    if (!groupRow.is_active) { throw new Error(`Options group "${groupRow.name}" is inactive`); }
    const group = byGroup.get(groupRow.id) ?? { groupName: groupRow.name, items: [], totalQty: 0 };
    if (groupRow.selection_type === 'single' && group.totalQty > 1) {
      throw new Error(`Only one selection allowed for "${groupRow.name}"`);
    }
    if (group.totalQty < groupRow.min_selections) {
      throw new Error(`Select at least ${groupRow.min_selections} option${groupRow.min_selections > 1 ? 's' : ''} for "${groupRow.name}"`);
    }
    if (groupRow.max_selections !== null && group.totalQty > groupRow.max_selections) {
      throw new Error(`Select at most ${groupRow.max_selections} option${groupRow.max_selections > 1 ? 's' : ''} for "${groupRow.name}"`);
    }
    for (const item of group.items) {
      modifierSnapshot.push({ id: item.id, group_id: groupRow.id, group_name: groupRow.name, name: item.name, price_minor: item.price_minor, qty: item.qty });
      modifierTotalMinor += item.price_minor * item.qty;
    }
  }

  unitMinor += modifierTotalMinor;
  const lineTotalMinor = unitMinor * qty;
  const taxMode = menuItem.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const taxRate = taxSettings.enabled ? (menuItem.tax_rate ?? taxSettings.rate) : 0;
  const taxName = taxSettings.enabled ? (menuItem.tax_name ?? taxSettings.name) : null;

  return {
    menu_item_id: menuItem.id,
    name: menuItem.name,
    qty,
    unit_price_minor: unitMinor,
    variant_id: variantId,
    variant_name: variantName,
    modifier_snapshot: modifierSnapshot,
    note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    line_total_minor: lineTotalMinor,
    tax_name: taxName,
    tax_rate: taxRate,
    tax_mode: taxMode,
  };
}

/**
 * Compute order totals from priced lines plus an order-level discount.
 * Line tax is computed per line with the configured rounding mode.
 */
export function computeOrderTotals(
  lines: { line_total_minor: number; tax_rate: number; tax_mode: 'exclusive' | 'inclusive'; tax_enabled: boolean }[],
  discount: OrderDiscount,
  settings: {
    taxEnabled: boolean;
    taxRate: number;
    taxMode: 'exclusive' | 'inclusive';
    serviceChargeEnabled: boolean;
    serviceChargeRate: number;
    deliveryChargeMinor: number;
  },
): OrderTotals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.line_total_minor, 0);

  // Discount (percent discount applies to the subtotal; fixed is absolute)
  let discountMinor = 0;
  if (discount.type === 'PERCENT') {
    const pct = Math.min(Math.max(discount.percent || 0, 0), 100);
    discountMinor = Math.round((subtotalMinor * pct) / 100);
  } else if (discount.type === 'FIXED') {
    discountMinor = Math.min(Math.max(Math.trunc(discount.minor) || 0, 0), subtotalMinor);
  }
  discountMinor = Math.min(discountMinor, subtotalMinor);

  // Per-line tax. Inclusive lines carry their tax inside the line total, so
  // only exclusive lines add tax on top. `tax_minor` always reports the full
  // tax (including embedded inclusive tax) for receipts and reports.
  let taxMinor = 0;
  let taxableMinor = 0;
  let exclusiveTaxMinor = 0;
  for (const line of lines) {
    const { taxable_minor, tax_minor } = lineTax({
      taxable_minor: line.line_total_minor,
      tax_rate: line.tax_rate,
      tax_mode: line.tax_mode,
      tax_enabled: line.tax_enabled,
    });
    taxableMinor += taxable_minor;
    taxMinor += tax_minor;
    if (line.tax_mode !== 'inclusive') { exclusiveTaxMinor += tax_minor; }
  }

  const serviceChargeMinor = settings.serviceChargeEnabled
    ? roundRate(taxableMinor, settings.serviceChargeRate)
    : 0;
  const deliveryChargeMinor = settings.deliveryChargeMinor;
  const totalMinor = Math.max(0, subtotalMinor - discountMinor + exclusiveTaxMinor + serviceChargeMinor + deliveryChargeMinor);

  return {
    subtotal_minor: subtotalMinor,
    taxable_minor: taxableMinor,
    tax_minor: taxMinor,
    discount_minor: discountMinor,
    service_charge_minor: serviceChargeMinor,
    delivery_charge_minor: deliveryChargeMinor,
    total_minor: totalMinor,
  };
}

export function getOrderPricingSettings(): {
  taxEnabled: boolean; taxName: string; taxRate: number; taxMode: 'exclusive' | 'inclusive';
  serviceChargeEnabled: boolean; serviceChargeRate: number; deliveryChargeMinor: number;
} {
  // Settings arrive from the electron-store as unknown values (a legacy install
  // may hold strings), so coerce defensively here.
  const s = getAppSettings() as unknown as Record<string, unknown>;
  return {
    taxEnabled: Boolean(s.tax_enabled),
    taxName: typeof s.tax_name === 'string' ? s.tax_name : 'Sales Tax',
    taxRate: Number(s.tax_rate) || 0,
    taxMode: s.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    serviceChargeEnabled: Boolean(s.service_charge_enabled),
    serviceChargeRate: Number(s.service_charge_rate) || 0,
    deliveryChargeMinor: toMinorUnits(typeof s.delivery_charge === 'number' ? s.delivery_charge : 0),
  };
}

export const ORDER_STATUS_FLOW = ['DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'] as const;
export type OrderStatus = typeof ORDER_STATUS_FLOW[number] | 'CANCELLED';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['SENT_TO_KITCHEN', 'CANCELLED'],
  SENT_TO_KITCHEN: ['PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
  PREPARING: ['READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
  READY: ['SERVED', 'COMPLETED', 'CANCELLED'],
  SERVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrderStatus(from: string, to: string): boolean {
  return from === to || (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertValidOrderTransition(from: string, to: string): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new Error(`Invalid order status transition: ${from} -> ${to}`);
  }
}

export const KDS_STATUS_FLOW = ['NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const;
export type KDSStatus = typeof KDS_STATUS_FLOW[number];

const KDS_TRANSITIONS: Record<string, string[]> = {
  NEW: ['PREPARING', 'COMPLETED', 'CANCELLED'],
  PREPARING: ['READY', 'COMPLETED', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionKDSStatus(from: string, to: string): boolean {
  return from === to || (KDS_TRANSITIONS[from] ?? []).includes(to);
}

export function assertValidKDSTransition(from: string, to: string): void {
  if (!canTransitionKDSStatus(from, to)) {
    throw new Error(`Invalid KDS status transition: ${from} -> ${to}`);
  }
}
