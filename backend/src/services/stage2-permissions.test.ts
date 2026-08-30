import { describe, expect, it } from 'vitest';
import { hasPermission } from './authz';

describe('Stage 2 permissions', () => {
  it('gives administrators and managers complete Stage 2 management access', () => {
    const permissions = [
      'menu_viewing', 'menu_creation', 'menu_editing', 'menu_deactivation', 'category_management',
      'variant_management', 'modifier_management', 'table_viewing', 'table_management',
      'dining_area_management', 'table_status_management', 'floor_layout_management',
    ] as const;
    for (const permission of permissions) {
      expect(hasPermission('admin', permission)).toBe(true);
      expect(hasPermission('manager', permission)).toBe(true);
    }
  });

  it('keeps view-only roles from changing menu data while allowing table status work for waiters', () => {
    expect(hasPermission('cashier', 'menu_viewing')).toBe(true);
    expect(hasPermission('cashier', 'menu_editing')).toBe(false);
    expect(hasPermission('waiter', 'table_viewing')).toBe(true);
    expect(hasPermission('waiter', 'table_status_management')).toBe(true);
    expect(hasPermission('waiter', 'floor_layout_management')).toBe(false);
    expect(hasPermission('kitchen', 'modifier_management')).toBe(false);
  });
});
