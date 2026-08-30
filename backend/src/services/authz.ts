/* eslint-disable */
export type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export type Permission =
  | 'discounts'
  | 'refunds'
  | 'voids'
  | 'payments'
  | 'reports'
  | 'inventory'
  | 'settings'
  | 'staff'
  | 'tax_configuration'
  | 'menu_viewing'
  | 'menu_creation'
  | 'menu_editing'
  | 'menu_deactivation'
  | 'category_management'
  | 'variant_management'
  | 'modifier_management'
  | 'table_viewing'
  | 'table_management'
  | 'dining_area_management'
  | 'table_status_management'
  | 'floor_layout_management';

let currentRole: Role | null = null;

const stage2ViewPermissions: Permission[] = ['menu_viewing', 'table_viewing'];
const stage2ManagePermissions: Permission[] = [
  'menu_creation',
  'menu_editing',
  'menu_deactivation',
  'category_management',
  'variant_management',
  'modifier_management',
  'table_management',
  'dining_area_management',
  'table_status_management',
  'floor_layout_management',
];

const rolePermissions: Record<Role, Permission[]> = {
  admin: [
    'discounts', 'refunds', 'voids', 'payments', 'reports', 'inventory', 'settings', 'staff', 'tax_configuration',
    ...stage2ViewPermissions, ...stage2ManagePermissions,
  ],
  manager: [
    'discounts', 'refunds', 'voids', 'payments', 'reports', 'inventory', 'settings', 'tax_configuration',
    ...stage2ViewPermissions, ...stage2ManagePermissions,
  ],
  cashier: ['discounts', 'payments', 'reports', ...stage2ViewPermissions],
  waiter: [...stage2ViewPermissions, 'table_status_management'],
  kitchen: ['menu_viewing', 'table_viewing'],
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
