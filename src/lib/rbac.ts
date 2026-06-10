// Central RBAC — ported from prototype data.jsx. Permissions are authoritative;
// 'all' is the owner-session sentinel.

export type PermissionId =
  | 'view_reports'
  | 'void_sales'
  | 'manage_products'
  | 'manage_clients'
  | 'manage_employees'
  | 'manage_settings';

export type PermissionMap = Record<PermissionId, boolean>;
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

// Helper to build a permission map from a list of granted ids
export const perms = (...granted: PermissionId[]): PermissionMap =>
  Object.fromEntries(
    PERMISSIONS.map((p) => [p.id, granted.includes(p.id)])
  ) as PermissionMap;

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
