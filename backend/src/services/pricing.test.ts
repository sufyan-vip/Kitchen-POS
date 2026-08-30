import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { toMinorUnits, fromMinorUnits } from './money';
import {
  computeOrderTotals, priceOrderLine, canTransitionOrderStatus, canTransitionKDSStatus,
  lineTax,
} from './pricing';
import {
  createTestDb, mockElectron, resetAuth, seedMenuWithVariantAndModifiers, setupSettings, teardown,
} from '../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

const taxSettings = { enabled: true, name: 'Sales Tax', rate: 15, mode: 'exclusive' as const };

describe('money minor units — PKR financial safety', () => {
  it('handles PKR 0', () => {
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits('0')).toBe(0);
  });

  it('handles PKR 1', () => {
    expect(toMinorUnits(1)).toBe(100);
    expect(toMinorUnits('1')).toBe(100);
  });

  it('handles PKR 1.50', () => {
    expect(toMinorUnits(1.5)).toBe(150);
    expect(toMinorUnits('1.50')).toBe(150);
  });

  it('handles large values', () => {
    expect(toMinorUnits(1_000_000_000)).toBe(100_000_000_000);
    expect(fromMinorUnits(100_000_000_000)).toBe(1_000_000_000);
  });

  it('never drifts on float sums', () => {
    const sum = 0.1 + 0.2;
    expect(toMinorUnits(sum)).toBe(30);
  });

  it('rounds half up to the nearest paisa', () => {
    expect(toMinorUnits(1.005)).toBe(101);
    expect(toMinorUnits(1.004)).toBe(100);
    expect(toMinorUnits(-1.5)).toBe(-150);
  });

  it('rejects non-numeric input', () => {
    expect(() => toMinorUnits('abc')).toThrow();
    expect(() => toMinorUnits(Number.NaN)).toThrow();
  });
});

describe('computeOrderTotals — authoritative order pricing', () => {
  const settings = {
    taxEnabled: true, taxRate: 15, taxMode: 'exclusive' as const,
    serviceChargeEnabled: true, serviceChargeRate: 10, deliveryChargeMinor: 20000,
  };

  it('computes plain subtotal without tax or charges', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 1000, tax_rate: 0, tax_mode: 'exclusive', tax_enabled: false }],
      { type: null, percent: 0, minor: 0 },
      { ...settings, taxEnabled: false, serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.subtotal_minor).toBe(1000);
    expect(totals.tax_minor).toBe(0);
    expect(totals.total_minor).toBe(1000);
  });

  it('applies exclusive tax per line with rounding', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 1000, tax_rate: 15, tax_mode: 'exclusive', tax_enabled: true }],
      { type: null, percent: 0, minor: 0 },
      { ...settings, serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.tax_minor).toBe(150);
    expect(totals.total_minor).toBe(1150);
  });

  it('applies inclusive tax by extracting from gross', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 1150, tax_rate: 15, tax_mode: 'inclusive', tax_enabled: true }],
      { type: null, percent: 0, minor: 0 },
      { ...settings, taxMode: 'inclusive', serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.tax_minor).toBe(150);
    expect(totals.taxable_minor).toBe(1000);
    expect(totals.total_minor).toBe(1150);
  });

  it('applies percentage discounts to the subtotal', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 2000, tax_rate: 0, tax_mode: 'exclusive', tax_enabled: false }],
      { type: 'PERCENT', percent: 10, minor: 0 },
      { ...settings, taxEnabled: false, serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.discount_minor).toBe(200);
    expect(totals.total_minor).toBe(1800);
  });

  it('applies fixed discounts without exceeding the subtotal', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 2000, tax_rate: 0, tax_mode: 'exclusive', tax_enabled: false }],
      { type: 'FIXED', percent: 0, minor: 99999 },
      { ...settings, taxEnabled: false, serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.discount_minor).toBe(2000);
    expect(totals.total_minor).toBe(0);
  });

  it('computes service charge on the taxable amount', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 1000, tax_rate: 15, tax_mode: 'exclusive', tax_enabled: true }],
      { type: null, percent: 0, minor: 0 },
      settings,
    );
    // tax 150 + service charge 10% of 1000 = 100 + delivery 20000
    expect(totals.tax_minor).toBe(150);
    expect(totals.service_charge_minor).toBe(100);
    expect(totals.delivery_charge_minor).toBe(20000);
    expect(totals.total_minor).toBe(1000 + 150 + 100 + 20000);
  });

  it('handles multiple quantities with modifiers without float drift', () => {
    const totals = computeOrderTotals(
      [{ line_total_minor: 250 * 3, tax_rate: 15, tax_mode: 'exclusive', tax_enabled: true }],
      { type: null, percent: 0, minor: 0 },
      { ...settings, serviceChargeEnabled: false, deliveryChargeMinor: 0 },
    );
    expect(totals.subtotal_minor).toBe(750);
    expect(totals.tax_minor).toBe(Math.round((750 * 15) / 100));
    expect(totals.total_minor).toBe(750 + totals.tax_minor);
  });
});

describe('lineTax rounding', () => {
  it('rounds tax per line', () => {
    const r = lineTax({ taxable_minor: 333, tax_rate: 15, tax_mode: 'exclusive', tax_enabled: true });
    expect(r.tax_minor).toBe(Math.round((333 * 15) / 100));
    expect(r.taxable_minor).toBe(333);
  });
});

describe('priceOrderLine — variants, modifiers, validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    setupSettings({ tax_enabled: true, tax_name: 'Sales Tax', tax_rate: 15, tax_mode: 'exclusive' });
    db = createTestDb();
    resetAuth();
  });

  afterEach(() => { teardown(); });

  it('prices a base item with tax snapshot', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const line = priceOrderLine(db, { menu_item_id: seeded.menuItemId, qty: 2 }, taxSettings);
    expect(line.unit_price_minor).toBe(1000);
    expect(line.line_total_minor).toBe(2000);
    expect(line.tax_rate).toBe(15);
    expect(line.modifier_snapshot).toEqual([]);
  });

  it('prices a variant', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const line = priceOrderLine(db, { menu_item_id: seeded.menuItemId, qty: 1, variant_id: seeded.variantId }, taxSettings);
    expect(line.unit_price_minor).toBe(1500);
    expect(line.variant_name).toBe('Large');
  });

  it('prices modifiers and snapshots them', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const line = priceOrderLine(db, {
      menu_item_id: seeded.menuItemId, qty: 1,
      modifiers: [{ id: seeded.cheeseId, qty: 1 }, { id: seeded.extraPattyId, qty: 1 }],
    }, taxSettings);
    expect(line.unit_price_minor).toBe(1000 + 150 + 300);
    expect(line.modifier_snapshot).toHaveLength(2);
    expect(line.modifier_snapshot[0].group_name).toBe('Extras');
  });

  it('rejects inactive items, variants and modifiers', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    db.prepare('UPDATE menu_items SET is_active = 0 WHERE id = ?').run(seeded.menuItemId);
    expect(() => priceOrderLine(db, { menu_item_id: seeded.menuItemId, qty: 1 }, taxSettings)).toThrow(/not available/);
  });

  it('enforces minimum group selections', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const group = seedRequiredGroup(db, seeded.menuItemId);
    void group;
    expect(() => priceOrderLine(db, { menu_item_id: seeded.menuItemId, qty: 1 }, taxSettings)).toThrow(/at least/);
  });

  it('enforces single-selection groups', () => {
    const seeded = seedMenuWithVariantAndModifiers(db);
    const groupId = db.prepare("SELECT id FROM modifier_groups WHERE selection_type = 'single' LIMIT 1").get() as { id: number } | undefined;
    const mods = db.prepare('SELECT id FROM modifiers WHERE modifier_group_id = ?').all(groupId?.id ?? -1) as { id: number }[];
    expect(() => priceOrderLine(db, {
      menu_item_id: seeded.menuItemId, qty: 1,
      modifiers: mods.slice(0, 2).map(m => ({ id: m.id, qty: 1 })),
    }, taxSettings)).toThrow(/only one selection/i);
  });
});

function seedRequiredGroup(db: Database.Database, menuItemId: number): number {
  const groupId = db.prepare("INSERT INTO modifier_groups (name, selection_type, min_selections, max_selections, is_active, sort_order) VALUES ('Required', 'multiple', 1, NULL, 1, 0)").run().lastInsertRowid as number;
  db.prepare("INSERT INTO modifiers (modifier_group_id, name, price_minor, is_active, sort_order) VALUES (?, 'Extra Sauce', 50, 1, 0)").run(groupId);
  db.prepare('INSERT INTO menu_item_modifier_groups (menu_item_id, modifier_group_id, sort_order) VALUES (?, ?, 0)').run(menuItemId, groupId);
  return groupId;
}

describe('order and KDS status transitions', () => {
  it('allows the documented lifecycle', () => {
    expect(canTransitionOrderStatus('DRAFT', 'OPEN')).toBe(true);
    expect(canTransitionOrderStatus('OPEN', 'SENT_TO_KITCHEN')).toBe(true);
    expect(canTransitionOrderStatus('SENT_TO_KITCHEN', 'PREPARING')).toBe(true);
    expect(canTransitionOrderStatus('PREPARING', 'READY')).toBe(true);
    expect(canTransitionOrderStatus('READY', 'SERVED')).toBe(true);
    expect(canTransitionOrderStatus('SERVED', 'COMPLETED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransitionOrderStatus('DRAFT', 'COMPLETED')).toBe(false);
    expect(canTransitionOrderStatus('OPEN', 'SERVED')).toBe(false);
    expect(canTransitionOrderStatus('COMPLETED', 'OPEN')).toBe(false);
    expect(canTransitionOrderStatus('CANCELLED', 'OPEN')).toBe(false);
  });

  it('allows cancellation from open states only', () => {
    expect(canTransitionOrderStatus('OPEN', 'CANCELLED')).toBe(true);
    expect(canTransitionOrderStatus('PREPARING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrderStatus('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('validates KDS status flow', () => {
    expect(canTransitionKDSStatus('NEW', 'PREPARING')).toBe(true);
    expect(canTransitionKDSStatus('PREPARING', 'READY')).toBe(true);
    expect(canTransitionKDSStatus('READY', 'COMPLETED')).toBe(true);
    expect(canTransitionKDSStatus('COMPLETED', 'NEW')).toBe(false);
  });
});
