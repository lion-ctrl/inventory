// Central RBAC — ported from prototype data.jsx. Permissions are authoritative;
// 'all' is the owner-session sentinel.

export type PermissionId =
  | 'view_reports'
  | 'void_sales'
  | 'manage_products'
  | 'manage_clients'
  | 'manage_employees'
  | 'manage_settings'
  | 'manage_suppliers';

// Mirrors `permissionsValidator` in convex/schema.ts EXACTLY: this map is not
// only read, it is also sent back on save, so it must satisfy the server's
// validator. `manage_suppliers` is optional because it was added after employees
// already existed — absent reads as false through `can()`, fail-closed.
export interface PermissionMap {
  view_reports: boolean;
  void_sales: boolean;
  manage_products: boolean;
  manage_clients: boolean;
  manage_employees: boolean;
  manage_settings: boolean;
  manage_suppliers?: boolean;
}
export type Permissions = 'all' | PermissionMap;

export interface PermissionInfo {
  id: PermissionId;
  label: string;
  desc: string;
  icon: string;
}

export const PERMISSIONS: PermissionInfo[] = [
  {
    id: 'view_reports',
    label: 'Historial de ventas',
    desc: 'Ver ventas, cierres e informes',
    icon: 'receipt',
  },
  {
    id: 'void_sales',
    label: 'Reembolsar ventas',
    desc: 'Reembolsar una venta',
    icon: 'rotate-ccw',
  },
  {
    id: 'manage_products',
    label: 'Productos',
    desc: 'Crear, editar y ajustar stock y precios',
    icon: 'package',
  },
  {
    id: 'manage_clients',
    label: 'Clientes',
    desc: 'Crear y editar la base de clientes',
    icon: 'users',
  },
  {
    id: 'manage_suppliers',
    label: 'Proveedores',
    desc: 'Crear y editar la base de proveedores',
    icon: 'truck',
  },
  {
    id: 'manage_employees',
    label: 'Empleados',
    desc: 'Gestionar el equipo y sus permisos',
    icon: 'user-cog',
  },
  {
    id: 'manage_settings',
    label: 'Ajustes',
    desc: 'Configurar la tienda y el sistema',
    icon: 'settings',
  },
];

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  cajero: 'Cajero',
};

// Builds a permission map from a list of granted ids. Written out key by key
// (not Object.fromEntries) so the return type IS PermissionMap with no cast:
// adding a permission fails to compile until it is handled here. Mirrors the
// same helper in convex/seed.ts.
export const perms = (...granted: PermissionId[]): PermissionMap => ({
  view_reports: granted.includes('view_reports'),
  void_sales: granted.includes('void_sales'),
  manage_products: granted.includes('manage_products'),
  manage_clients: granted.includes('manage_clients'),
  manage_employees: granted.includes('manage_employees'),
  manage_settings: granted.includes('manage_settings'),
  manage_suppliers: granted.includes('manage_suppliers'),
});

/** Every permission id, in PERMISSIONS order — for "grant all" / "deny all". */
export const ALL_PERMISSION_IDS: PermissionId[] = PERMISSIONS.map((p) => p.id);

export interface RbacUser {
  permissions?: Permissions;
  active?: boolean;
  role?: string;
}

export function can(
  user: RbacUser | null | undefined,
  perm: PermissionId
): boolean {
  if (!user) return false;
  if (user.permissions === 'all') return true;
  if (user.active === false) return false;
  return !!(user.permissions && user.permissions[perm]);
}
