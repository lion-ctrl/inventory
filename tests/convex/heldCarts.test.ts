/// <reference types="vite/client" />
// "Ventas en espera": park / resume / discard round-trip.
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

describe('heldCarts.park', () => {
  test('snapshots live items (paused allowed), pads the code, advances the counter', async () => {
    const { t, fx } = await setup();

    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [
        { productId: fx.cola, qty: 1 },
        { productId: fx.pintura, qty: 2 }, // paused — parking does NOT enforce sellable
      ],
      splits: [{ method: 'cash_bs', amount: 100 }],
      note: 'Vuelve en 10 min',
    });

    const carts = await t.query(api.heldCarts.list, { token: fx.ownerToken });
    expect(carts).toHaveLength(1);
    const cart = carts[0];
    expect(cart.code).toBe('00001001');
    expect(cart.total).toBe(46.5); // 1.50 + 2×22.50
    expect(cart.client?.name).toBe('María González');
    expect(cart.items.map((i) => i.qty)).toEqual([1, 2]);
    expect(cart.splits).toEqual([{ method: 'cash_bs', amount: 100 }]);
    expect(cart.note).toBe('Vuelve en 10 min');

    // Parking never consumes stock
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(24);

    const settings = await t.run((ctx) =>
      ctx.db.get('settings', fx.settingsId)
    );
    expect(settings!.nextHeldCode).toBe(1002);
  });

  test('rejects empty carts and inactive actors', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.heldCarts.park, {
        token: fx.ownerToken,
        items: [],
      })
    ).rejects.toThrow('No hay productos en el carrito.');

    await expect(
      t.mutation(api.heldCarts.park, {
        token: fx.inactiveToken,
        items: [{ productId: fx.cola, qty: 1 }],
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('heldCarts.resume / discard', () => {
  test('resume and discard validate the acting employee server-side', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    const [cart] = await t.query(api.heldCarts.list, { token: fx.ownerToken });

    await expect(
      t.mutation(api.heldCarts.resume, {
        token: fx.inactiveToken,
        heldCartId: cart._id,
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
    await expect(
      t.mutation(api.heldCarts.discard, {
        token: fx.inactiveToken,
        heldCartId: cart._id,
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');

    // The held sale must survive both rejected attempts.
    await expect(t.query(api.heldCarts.list, { token: fx.ownerToken })).resolves.toHaveLength(1);
  });

  test('resume returns live client + snapshots + splits and deletes the row', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 3 }],
      splits: [{ method: 'cash', amount: 2 }],
    });
    const [cart] = await t.query(api.heldCarts.list, { token: fx.ownerToken });

    const resumed = await t.mutation(api.heldCarts.resume, {
      token: fx.ownerToken,
      heldCartId: cart._id,
    });
    expect(resumed.client?._id).toBe(fx.clientId);
    expect(resumed.items).toHaveLength(1);
    expect(resumed.items[0]).toMatchObject({
      productId: fx.cola,
      qty: 3,
      price: 1.5,
    });
    expect(resumed.splits).toEqual([{ method: 'cash', amount: 2 }]);

    await expect(t.query(api.heldCarts.list, { token: fx.ownerToken })).resolves.toHaveLength(0);
  });

  test('resume yields a null client when the client was deleted after parking', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    await t.run((ctx) => ctx.db.delete('clients', fx.clientId));

    const [cart] = await t.query(api.heldCarts.list, { token: fx.ownerToken });
    const resumed = await t.mutation(api.heldCarts.resume, {
      token: fx.ownerToken,
      heldCartId: cart._id,
    });
    expect(resumed.client).toBeNull();
  });

  test('discard removes the row and tolerates already-deleted ids', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    const [cart] = await t.query(api.heldCarts.list, { token: fx.ownerToken });

    await t.mutation(api.heldCarts.discard, {
      token: fx.ownerToken,
      heldCartId: cart._id,
    });
    await expect(t.query(api.heldCarts.list, { token: fx.ownerToken })).resolves.toHaveLength(0);

    // Second discard of the same id is a silent no-op
    await t.mutation(api.heldCarts.discard, {
      token: fx.ownerToken,
      heldCartId: cart._id,
    });
  });
});

describe('heldCarts.list — AUTH-2 session gating + no cashierId leak', () => {
  test('rejects an unknown/missing session token', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.heldCarts.list, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });

  test('omits the stored cashierId from every returned cart (kept on the row)', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });

    const carts = await t.query(api.heldCarts.list, { token: fx.ownerToken });
    expect(carts).toHaveLength(1);
    expect(carts[0]).not.toHaveProperty('cashierId');

    // The id stays STORED for audit — only the public projection drops it.
    const stored = await t.run(async (ctx) => {
      const rows = await ctx.db.query('heldCarts').collect();
      return rows[0];
    });
    expect(stored.cashierId).toBe(fx.owner);
  });
});
