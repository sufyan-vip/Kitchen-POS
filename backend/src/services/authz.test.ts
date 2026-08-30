import { describe, expect, it } from 'vitest';
import { assertPermission, getRolePermissions, hasPermission, setCurrentRole, ROLES } from './authz';

describe('role-based access control', () => {
  it('defines the full set of roles including inventory', () => {
    expect(ROLES).toEqual(['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory']);
  });

  it('grants admin everything', () => {
    for (const p of ['orders_create', 'refunds', 'payments', 'settings', 'staff', 'audit_view', 'floor_layout_management', 'purchasing_manage', 'tax_configuration']) {
      expect(hasPermission('admin', p as never), p).toBe(true);
    }
  });

  it('grants manager everything except staff management', () => {
    expect(hasPermission('manager', 'refunds')).toBe(true);
    expect(hasPermission('manager', 'purchasing_manage')).toBe(true);
    expect(hasPermission('manager', 'staff')).toBe(false);
  });

  it('limits cashier to payment-related permissions', () => {
    expect(hasPermission('cashier', 'payments')).toBe(true);
    expect(hasPermission('cashier', 'discounts')).toBe(true);
    expect(hasPermission('cashier', 'refunds')).toBe(false);
    expect(hasPermission('cashier', 'inventory_adjust')).toBe(false);
    expect(hasPermission('cashier', 'settings')).toBe(false);
    expect(hasPermission('cashier', 'menu_viewing')).toBe(true);
  });

  it('gives waiters order + table permissions only', () => {
    expect(hasPermission('waiter', 'orders_create')).toBe(true);
    expect(hasPermission('waiter', 'table_status_management')).toBe(true);
    expect(hasPermission('waiter', 'payments')).toBe(false);
    expect(hasPermission('waiter', 'voids')).toBe(false);
    expect(hasPermission('waiter', 'inventory_view')).toBe(false);
  });

  it('gives kitchen KOT update access without billing', () => {
    expect(hasPermission('kitchen', 'kot_view')).toBe(true);
    expect(hasPermission('kitchen', 'kot_update')).toBe(true);
    expect(hasPermission('kitchen', 'payments')).toBe(false);
    expect(hasPermission('kitchen', 'orders_create')).toBe(false);
  });

  it('gives the inventory role purchasing and stock powers', () => {
    expect(hasPermission('inventory', 'inventory_adjust')).toBe(true);
    expect(hasPermission('inventory', 'inventory_cost')).toBe(true);
    expect(hasPermission('inventory', 'suppliers_manage')).toBe(true);
    expect(hasPermission('inventory', 'purchasing_manage')).toBe(true);
    expect(hasPermission('inventory', 'expenses_manage')).toBe(true);
    expect(hasPermission('inventory', 'payments')).toBe(false);
    expect(hasPermission('inventory', 'orders_create')).toBe(false);
  });

  it('asserts permissions and throws for missing ones', () => {
    expect(() => { assertPermission('cashier', 'refunds'); }).toThrow(/Permission denied/);
    expect(() => { assertPermission(null, 'payments'); }).toThrow(/Permission denied/);
    expect(() => { assertPermission('admin', 'payments'); }).not.toThrow();
  });

  it('tracks the current role for service-side enforcement', () => {
    setCurrentRole('kitchen');
    expect(getRolePermissions('kitchen')).toContain('kot_update');
    setCurrentRole(null);
    expect(getRolePermissions(null)).toEqual([]);
  });
});
