/// <reference types="vite/client" />
// Clients: the Venta-gate lookup + ungated inline creation + guarded edits.
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

describe('clients.byTaxId — the Venta identification gate', () => {
  test('matches prefix + taxId exactly', async () => {
    const { t, fx } = await setup();
    const found = await t.query(api.clients.byTaxId, {
      taxPrefix: 'V',
      taxId: '5.123.456',
    });
    expect(found?._id).toBe(fx.clientId);

    // Same number under a different prefix → no match
    await expect(
      t.query(api.clients.byTaxId, { taxPrefix: 'J', taxId: '5.123.456' })
    ).resolves.toBeNull();
  });
});

describe('clients.create — inline at the gate, NO permission guard', () => {
  test('any cashier creates and receives the full doc back', async () => {
    const { t } = await setup();
    // Note: deliberately no actorId argument — the mutation is ungated.
    const client = await t.mutation(api.clients.create, {
      name: 'Restaurante La Estancia',
      taxPrefix: 'J',
      taxId: '15564124-0',
      kind: 'business',
      email: 'compras@laestancia.com',
      phone: '',
      address: '',
    });
    expect(client._id).toBeDefined();
    expect(typeof client.createdAt).toBe('number');
    expect(client.email).toBe('compras@laestancia.com');
    // Empty-string contact fields are omitted entirely
    expect(client.phone).toBeUndefined();
    expect(client.address).toBeUndefined();
  });

  test('supports the foreign (E) prefix', async () => {
    const { t } = await setup();
    const client = await t.mutation(api.clients.create, {
      name: 'John Smith',
      taxPrefix: 'E',
      taxId: '82.456.103',
      kind: 'foreign',
    });
    expect(client.taxPrefix).toBe('E');
    expect(client.kind).toBe('foreign');
  });
});

describe('clients.update / remove — guarded by manage_clients', () => {
  test('rejects actors without manage_clients', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.clients.update, {
        actorId: fx.cajeroVoid, // view_reports + void_sales only
        clientId: fx.clientId,
        patch: { name: 'Otro nombre' },
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('patches fields; an empty string CLEARS a stored contact field', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.clients.update, {
      actorId: fx.cajeroPlain, // has manage_clients
      clientId: fx.clientId,
      patch: { name: 'María G. de Pérez', email: '' },
    });
    const client = await t.run((ctx) => ctx.db.get('clients', fx.clientId));
    expect(client!.name).toBe('María G. de Pérez');
    expect(client!.email).toBeUndefined(); // was maria@correo.com — cleared
    expect(client!.phone).toBe('+507 6000-1122'); // untouched
  });

  test('remove deletes and is idempotent', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.clients.remove, {
      actorId: fx.cajeroPlain,
      clientId: fx.clientId,
    });
    await expect(
      t.run((ctx) => ctx.db.get('clients', fx.clientId))
    ).resolves.toBeNull();
    await t.mutation(api.clients.remove, {
      actorId: fx.cajeroPlain,
      clientId: fx.clientId,
    });
  });
});
