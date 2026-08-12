/// <reference types="vite/client" />
// Suppliers CRUD. Reads are operational (any valid session — the product form and
// the expense form both need the list); writes are management, behind
// manage_suppliers. Mirrors the clients module's contract.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

const DISTRIBUIDORA = {
  name: 'Distribuidora El Sol, C.A.',
  taxPrefix: 'J' as const,
  taxId: '40123456-7',
  contactName: 'Ramón Silva',
  email: 'ventas@elsol.com.ve',
  phone: '02125550101',
  mobile: '04141234567',
  address: 'Av. Bolívar, Galpón 4, Valencia',
  paymentTerms: '15 días neto',
  website: 'https://elsol.com.ve',
  notes: 'Entrega los martes.',
};

describe('suppliers.create', () => {
  test('stores the supplier, defaults to active, drops empty optionals', async () => {
    const { t, fx } = await setup();

    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
      contactName: DISTRIBUIDORA.contactName,
      paymentTerms: DISTRIBUIDORA.paymentTerms,
      // Empty strings must not be stored as empty fields.
      email: '',
      phone: '',
    });

    expect(created.name).toBe(DISTRIBUIDORA.name);
    expect(created.taxPrefix).toBe('J');
    expect(created.contactName).toBe('Ramón Silva');
    expect(created.paymentTerms).toBe('15 días neto');
    // A new supplier is usable immediately.
    expect(created.active).toBe(true);
    expect(created).not.toHaveProperty('email');
    expect(created).not.toHaveProperty('phone');
    expect(typeof created.createdAt).toBe('number');
  });

  test('requires manage_suppliers', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.suppliers.create, {
        token: fx.cajeroPlainToken, // manage_clients only
        name: 'Proveedor X',
        taxPrefix: 'J',
        taxId: '40999999-9',
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    // An admin holding the permission may create.
    await t.mutation(api.suppliers.create, {
      token: fx.adminToken,
      name: 'Proveedor X',
      taxPrefix: 'J',
      taxId: '40999999-9',
    });
    await expect(
      t.query(api.suppliers.list, { token: fx.adminToken })
    ).resolves.toHaveLength(1);
  });

  test('rejects an empty name or RIF instead of storing a blank supplier', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.suppliers.create, {
        token: fx.ownerToken,
        name: '   ',
        taxPrefix: 'J',
        taxId: '40123456-7',
      })
    ).rejects.toThrow('El nombre del proveedor es obligatorio.');

    // An empty RIF must NOT reach the duplicate guard, whose message would
    // blame a collision that is not the real problem.
    await expect(
      t.mutation(api.suppliers.create, {
        token: fx.ownerToken,
        name: 'Proveedor X',
        taxPrefix: 'J',
        taxId: '',
      })
    ).rejects.toThrow('El RIF del proveedor es obligatorio.');
  });

  test('rejects a duplicate RIF', async () => {
    const { t, fx } = await setup();
    const base = {
      token: fx.ownerToken,
      taxPrefix: 'J' as const,
      taxId: '40123456-7',
    };
    await t.mutation(api.suppliers.create, { ...base, name: 'Primero' });

    await expect(
      t.mutation(api.suppliers.create, { ...base, name: 'Segundo' })
    ).rejects.toThrow('Ya existe un proveedor con ese RIF.');
  });
});

describe('suppliers.list', () => {
  test('any valid session may read the supplier base', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });

    // A cajero without manage_suppliers still reads: the product and expense
    // forms need to pick a supplier.
    const list = await t.query(api.suppliers.list, {
      token: fx.cajeroPlainToken,
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe(DISTRIBUIDORA.name);
  });

  test('rejects an unknown/missing session token', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.suppliers.list, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('suppliers.update', () => {
  test('patches fields and clears an optional with an empty string', async () => {
    const { t, fx } = await setup();
    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
      email: DISTRIBUIDORA.email,
      notes: DISTRIBUIDORA.notes,
    });

    await t.mutation(api.suppliers.update, {
      token: fx.ownerToken,
      supplierId: created._id,
      patch: {
        paymentTerms: '30 días neto',
        email: '', // clears
      },
    });

    const [row] = await t.query(api.suppliers.list, { token: fx.ownerToken });
    expect(row.paymentTerms).toBe('30 días neto');
    expect(row.email).toBeUndefined();
    expect(row.notes).toBe(DISTRIBUIDORA.notes); // untouched
  });

  test('deactivating keeps the supplier readable (history must not break)', async () => {
    const { t, fx } = await setup();
    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });

    await t.mutation(api.suppliers.update, {
      token: fx.ownerToken,
      supplierId: created._id,
      patch: { active: false },
    });

    const [row] = await t.query(api.suppliers.list, { token: fx.ownerToken });
    expect(row.active).toBe(false);
  });

  test('requires manage_suppliers', async () => {
    const { t, fx } = await setup();
    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });

    await expect(
      t.mutation(api.suppliers.update, {
        token: fx.cajeroPlainToken,
        supplierId: created._id,
        patch: { name: 'Otro' },
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('a blank name or RIF cannot be patched over a good one', async () => {
    const { t, fx } = await setup();
    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });

    // `name` is REQUIRED in supplierFields: a blank patch would leave a row that
    // is schema-valid and unusable in the UI.
    await expect(
      t.mutation(api.suppliers.update, {
        token: fx.ownerToken,
        supplierId: created._id,
        patch: { name: '  ' },
      })
    ).rejects.toThrow('El nombre del proveedor es obligatorio.');
    await expect(
      t.mutation(api.suppliers.update, {
        token: fx.ownerToken,
        supplierId: created._id,
        patch: { taxId: '' },
      })
    ).rejects.toThrow('El RIF del proveedor es obligatorio.');

    const [row] = await t.query(api.suppliers.list, { token: fx.ownerToken });
    expect(row.name).toBe(DISTRIBUIDORA.name);
  });
});

describe('suppliers.remove — purchases keep their supplier alive', () => {
  test('refuses to delete a supplier that has purchases', async () => {
    const { t, fx } = await setup();
    const supplier = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId: supplier._id,
      items: [{ productId: fx.cola, qty: 5 }],
      entered: 10,
      currency: 'usd',
    });

    // Deleting would orphan an order that already raised stock, and its history
    // would become unreachable through bySupplier.
    await expect(
      t.mutation(api.suppliers.remove, {
        token: fx.ownerToken,
        supplierId: supplier._id,
      })
    ).rejects.toThrow(
      'No puedes eliminar un proveedor con compras registradas. Márcalo como inactivo.'
    );
    await expect(
      t.query(api.suppliers.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(1);
  });

  test('deactivating is the way out, and it keeps the purchases readable', async () => {
    const { t, fx } = await setup();
    const supplier = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId: supplier._id,
      items: [{ productId: fx.cola, qty: 5 }],
      entered: 10,
      currency: 'usd',
    });

    await t.mutation(api.suppliers.update, {
      token: fx.ownerToken,
      supplierId: supplier._id,
      patch: { active: false },
    });
    await expect(
      t.query(api.purchases.bySupplier, {
        token: fx.ownerToken,
        supplierId: supplier._id,
      })
    ).resolves.toHaveLength(1);
  });
});

describe('suppliers.remove', () => {
  test('deletes the row, tolerates an already-deleted id, needs the permission', async () => {
    const { t, fx } = await setup();
    const created = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: DISTRIBUIDORA.name,
      taxPrefix: DISTRIBUIDORA.taxPrefix,
      taxId: DISTRIBUIDORA.taxId,
    });

    await expect(
      t.mutation(api.suppliers.remove, {
        token: fx.cajeroPlainToken,
        supplierId: created._id,
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    await t.mutation(api.suppliers.remove, {
      token: fx.ownerToken,
      supplierId: created._id,
    });
    await expect(
      t.query(api.suppliers.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(0);

    // Second removal of the same id is a silent no-op.
    await t.mutation(api.suppliers.remove, {
      token: fx.ownerToken,
      supplierId: created._id,
    });
  });
});
