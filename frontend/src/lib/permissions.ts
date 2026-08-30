/**
 * Client-side mirror of the backend authorization matrix
 * (backend/src/services/authz.ts). UI-only: it hides navigation and renders
 * an access-denied state for pages the signed-in role cannot use.
 *
 * The BACKEND remains the authoritative enforcement point — every IPC call
 * still runs assertCurrentPermission(). This module never grants access; it
 * only improves UX by not showing actions that would be rejected.
 *
 * Keep the role → permission mapping identical to backend/src/services/authz.ts.
 */
export type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'inventory';

export type Permission =
  // Orders
  | 'orders_view' | 'orders_create' | 'orders_edit' | 'voids' | 'discounts'
  // KOT / KDS
  | 'kot_create' | 'kot_view' | 'kot_update'
  // Billing & payments
  | 'payments' | 'refunds'
  // Menu
  | 'menu_viewing' | 'menu_creation' | 'menu_editing' | 'menu_deactivation'
  | 'category_management' | 'variant_management' | 'modifier_management'
  // Tables
  | 'table_viewing' | 'table_management' | 'dining_area_management'
  | 'table_status_management' | 'floor_layout_management'
  // Inventory
  | 'inventory_view' | 'inventory_adjust' | 'inventory_cost' | 'inventory_recipes'
  // Suppliers & purchasing
  | 'suppliers_view' | 'suppliers_manage' | 'purchasing_view' | 'purchasing_manage'
  // Expenses
  | 'expenses_view' | 'expenses_manage'
  // Customers
  | 'customers_view' | 'customers_manage'
  // Shifts
  | 'shifts_view' | 'shifts_manage'
  // Reports, settings, staff, audit
  | 'reports' | 'settings' | 'staff' | 'tax_configuration' | 'audit_view';

const rolePermissions: Partial<Record<Role, Permission[]>> = {
  admin: [
    'orders_view', 'orders_create', 'orders_edit', 'voids', 'discounts',
    'kot_create', 'kot_view', 'kot_update',
    'payments', 'refunds',
    'inventory_view', 'inventory_adjust', 'inventory_cost', 'inventory_recipes',
    'suppliers_view', 'suppliers_manage', 'purchasing_view', 'purchasing_manage',
    'expenses_view', 'expenses_manage',
    'customers_view', 'customers_manage',
    'shifts_view', 'shifts_manage',
    'reports', 'settings', 'staff', 'tax_configuration', 'audit_view',
    'menu_viewing', 'table_viewing',
    'menu_creation', 'menu_editing', 'menu_deactivation', 'category_management',
    'variant_management', 'modifier_management', 'table_management',
    'dining_area_management', 'table_status_management', 'floor_layout_management',
  ],
  manager: [
    'orders_view', 'orders_create', 'orders_edit', 'voids', 'discounts',
    'kot_create', 'kot_view', 'kot_update',
    'payments', 'refunds',
    'inventory_view', 'inventory_adjust', 'inventory_cost', 'inventory_recipes',
    'suppliers_view', 'suppliers_manage', 'purchasing_view', 'purchasing_manage',
    'expenses_view', 'expenses_manage',
    'customers_view', 'customers_manage',
    'shifts_view', 'shifts_manage',
    'reports', 'settings', 'tax_configuration', 'audit_view',
    'menu_viewing', 'table_viewing',
    'menu_creation', 'menu_editing', 'menu_deactivation', 'category_management',
    'variant_management', 'modifier_management', 'table_management',
    'dining_area_management', 'table_status_management', 'floor_layout_management',
  ],
  cashier: [
    'orders_view', 'orders_create', 'orders_edit', 'discounts',
    'kot_create', 'kot_view',
    'payments',
    'inventory_view',
    'customers_view', 'customers_manage',
    'shifts_view', 'shifts_manage',
    'reports',
    'menu_viewing', 'table_viewing',
  ],
  waiter: [
    'orders_view', 'orders_create', 'orders_edit',
    'kot_create', 'kot_view',
    'table_viewing', 'table_status_management',
    'menu_viewing',
    'customers_view',
  ],
  kitchen: [
    'kot_view', 'kot_update',
    'menu_viewing', 'table_viewing',
  ],
  inventory: [
    'inventory_view', 'inventory_adjust', 'inventory_cost', 'inventory_recipes',
    'suppliers_view', 'suppliers_manage', 'purchasing_view', 'purchasing_manage',
    'expenses_view', 'expenses_manage',
    'menu_viewing',
  ],
};

/** UI mirror of backend hasPermission(). Unknown roles get nothing. */
export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  if (!role) { return false; }
  return (rolePermissions[role as Role] ?? []).includes(permission);
}

/** Minimum permission required to open each top-level route (mirrors backend IPC guards). */
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/dashboard': 'reports',
  '/tables': 'table_viewing',
  '/order': 'orders_create',
  '/kds': 'kot_view',
  '/past-orders': 'reports',
  '/customers': 'customers_view',
  '/menu': 'menu_viewing',
  '/inventory': 'inventory_view',
  '/purchasing': 'purchasing_view',
  '/expenses': 'expenses_view',
  '/reports': 'reports',
  '/staff': 'staff',
  '/settings': 'settings',
};
