/* eslint-disable */
export type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export type Permission = 'discounts' | 'refunds' | 'voids' | 'payments' | 'reports' | 'inventory' | 'settings' | 'staff' | 'tax_configuration';

let currentRole: Role | null = null;

const rolePermissions: Record<Role, Permission[]> = {
  admin: ['discounts', 'refunds', 'voids', 'payments', 'reports', 'inventory', 'settings', 'staff', 'tax_configuration'],
  manager: ['discounts', 'refunds', 'voids', 'payments', 'reports', 'inventory', 'settings', 'tax_configuration'],
  cashier: ['discounts', 'payments', 'reports'],
  waiter: [],
  kitchen: [],
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
