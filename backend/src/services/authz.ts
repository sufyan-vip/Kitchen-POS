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

let currentRole: Role | null = null;
let currentStaffId: number | null = null;

export function setCurrentStaffId(staffId: number | null): void {
  currentStaffId = staffId;
}

export function getCurrentStaffId(): number | null {
  return currentStaffId;
}

const stage2ViewPermissions: Permission[] = ['menu_viewing', 'table_viewing'];
const stage2ManagePermissions: Permission[] = [
  'menu_creation', 'menu_editing', 'menu_deactivation', 'category_management',
  'variant_management', 'modifier_management', 'table_management',
  'dining_area_management', 'table_status_management', 'floor_layout_management',
];

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
    ...stage2ViewPermissions, ...stage2ManagePermissions,
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
    ...stage2ViewPermissions, ...stage2ManagePermissions,
  ],
  cashier: [
    'orders_view', 'orders_create', 'orders_edit', 'discounts',
    'kot_create', 'kot_view',
    'payments',
    'inventory_view',
    'customers_view', 'customers_manage',
    'shifts_view', 'shifts_manage',
    'reports',
    ...stage2ViewPermissions,
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

export function setCurrentRole(role: string | undefined | null): void {
  currentRole = role && role in rolePermissions ? role as Role : null;
}

export function getCurrentRole(): Role | null {
  return currentRole;
}

export function hasPermission(role: string | undefined | null, permission: Permission): boolean {
  if (!role) { return false; }
  return (rolePermissions[role as Role] ?? []).includes(permission);
}

export function assertPermission(role: string | undefined | null, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

export function assertCurrentPermission(permission: Permission): void {
  assertPermission(currentRole, permission);
}

export function getRolePermissions(role: string | null): Permission[] {
  if (!role) { return []; }
  return rolePermissions[role as Role] ?? [];
}

export const ROLES: Role[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory'];
