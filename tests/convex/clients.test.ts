/// <reference types="vite/client" />
// Clients: the Venta-gate lookup + session-only inline creation + manage_clients-guarded edits.
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
  test('matches prefix + taxId exactly (session-gated, any active employee)', async () => {
    const { t, fx } = await setup();
    // cajeroPlain has manage_clients only — an operational lookup needs just a
    // valid session, no management permission.
    const found = await t.query(api.clients.byTaxId, {
      token: fx.cajeroPlainToken,
      taxPrefix: 'V',
      taxId: '5.123.456',
    });
    expect(found?._id).toBe(fx.clientId);

    // Same number under a different prefix → no match
    await expect(
      t.query(api.clients.byTaxId, {
        token: fx.cajeroPlainToken,
        taxPrefix: 'J',
        taxId: '5.123.456',
      })
    ).resolves.toBeNull();
  });
});

describe('clients reads — gated by requireSession (internal POS, no public endpoints)', () => {
  test('list returns the client base for any valid session', async () => {
    const { t, fx } = await setup();
    const clients = await t.query(api.clients.list, {
      token: fx.cajeroPlainToken,
    });
    expect(clients.some((c) => c._id === fx.clientId)).toBe(true);
  });

  test('list and byTaxId reject when there is no valid session', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.clients.list, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
    await expect(
      t.query(api.clients.byTaxId, {
        token: 'not-a-real-token',
        taxPrefix: 'V',
        taxId: '5.123.456',
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('clients.create — session-only (part of the sale flow)', () => {
  test('a logged-in employee WITHOUT manage_clients CAN create (sale-flow contract)', async () => {
    const { t, fx } = await setup();
    // cajeroVoid holds view_reports + void_sales — NOT manage_clients. Under the
    // revised contract a valid session alone is enough to register a walk-in
    // mid-sale, so this must SUCCEED (it was rejected before AUTH-2 was relaxed).
    const client = await t.mutation(api.clients.create, {
      token: fx.cajeroVoidToken,
      name: 'Cliente de mostrador',
      taxPrefix: 'V',
      taxId: '1.000.000',
      kind: 'person',
    });
    expect(client._id).toBeDefined();
    expect(client.name).toBe('Cliente de mostrador');
  });

  test('a manager (manage_clients) creates and receives the full doc back', async () => {
    const { t, fx } = await setup();
    const client = await t.mutation(api.clients.create, {
      token: fx.cajeroPlainToken, // has manage_clients
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
    const { t, fx } = await setup();
    const client = await t.mutation(api.clients.create, {
      token: fx.ownerToken,
      name: 'John Smith',
      taxPrefix: 'E',
      taxId: '82.456.103',
      kind: 'foreign',
    });
    expect(client.taxPrefix).toBe('E');
    expect(client.kind).toBe('foreign');
  });

  test('still rejects when there is no valid session', async () => {
    const { t } = await setup();
    // Session precedes any business logic: an unknown token is rejected before
    // any write, exactly as for update/remove.
    await expect(
      t.mutation(api.clients.create, {
        token: 'not-a-real-token',
        name: 'X',
        taxPrefix: 'V',
        taxId: '1.000.000',
        kind: 'person',
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('clients.update / remove — guarded by manage_clients', () => {
  test('reject without a valid session (token verified before the perm gate)', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.clients.update, {
        token: 'not-a-real-token',
        clientId: fx.clientId,
        patch: { name: 'X' },
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
    await expect(
      t.mutation(api.clients.remove, {
        token: 'not-a-real-token',
        clientId: fx.clientId,
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });

  test('rejects actors without manage_clients (both update and remove)', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.clients.update, {
        token: fx.cajeroVoidToken, // view_reports + void_sales only
        clientId: fx.clientId,
        patch: { name: 'Otro nombre' },
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
    // remove stays management-only too — relaxing create must not leak here.
    await expect(
      t.mutation(api.clients.remove, {
        token: fx.cajeroVoidToken,
        clientId: fx.clientId,
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('patches fields; an empty string CLEARS a stored contact field', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.clients.update, {
      token: fx.cajeroPlainToken, // has manage_clients
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
      token: fx.cajeroPlainToken,
      clientId: fx.clientId,
    });
    await expect(
      t.run((ctx) => ctx.db.get('clients', fx.clientId))
    ).resolves.toBeNull();
    await t.mutation(api.clients.remove, {
      token: fx.cajeroPlainToken,
      clientId: fx.clientId,
    });
  });
});
