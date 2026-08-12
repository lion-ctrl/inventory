// Client-side RBAC mirror — must behave exactly like convex/permissions.can().
import { describe, expect, test } from 'vitest';
import { can, perms, PERMISSIONS, ROLE_LABELS } from '@/lib/rbac';

describe('can()', () => {
  test('no user → no permissions', () => {
    expect(can(null, 'view_reports')).toBe(false);
    expect(can(undefined, 'manage_settings')).toBe(false);
  });

  test("'all' sentinel grants everything and is checked before the active flag", () => {
    expect(can({ permissions: 'all' }, 'manage_employees')).toBe(true);
    expect(can({ permissions: 'all', active: false }, 'void_sales')).toBe(true);
  });

  test('granular permissions: exact grants, inactive users lose access', () => {
    const user = { permissions: perms('view_reports', 'manage_clients') };
    expect(can(user, 'view_reports')).toBe(true);
    expect(can(user, 'manage_clients')).toBe(true);
    expect(can(user, 'void_sales')).toBe(false);
    expect(can({ ...user, active: false }, 'view_reports')).toBe(false);
  });
});

describe('perms() builder', () => {
  test('produces the full 6-key map with only the granted flags on', () => {
    const map = perms('void_sales');
    expect(Object.keys(map)).toHaveLength(PERMISSIONS.length);
    expect(map.void_sales).toBe(true);
    expect(map.view_reports).toBe(false);
    expect(map.manage_settings).toBe(false);
  });
});

describe('catalog constants', () => {
  test('PERMISSIONS keeps the menu order the sidebar and forms rely on', () => {
    expect(PERMISSIONS.map((p) => p.id)).toEqual([
      'view_reports',
      'void_sales',
      'manage_products',
      'manage_clients',
      // Suppliers sits next to Clients: both are party records, and the
      // Employees permission form reads top-to-bottom in this order.
      'manage_suppliers',
      'manage_employees',
      'manage_settings',
    ]);
  });

  test('role labels are the Spanish chips', () => {
    expect(ROLE_LABELS).toMatchObject({
      owner: 'Propietario',
      admin: 'Administrador',
      cajero: 'Cajero',
    });
  });
});
