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
    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(1);
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

    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(0);
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
    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(0);

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

describe('heldCarts — role-scoped visibility', () => {
  /** One parked sale per actor, so every assertion has a foreign cart to miss. */
  async function parkOnePerActor(
    t: Awaited<ReturnType<typeof setup>>['t'],
    fx: Awaited<ReturnType<typeof setup>>['fx']
  ) {
    for (const token of [
      fx.ownerToken,
      fx.adminToken,
      fx.cajeroVoidToken,
      fx.cajeroPlainToken,
    ]) {
      await t.mutation(api.heldCarts.park, {
        token,
        items: [{ productId: fx.cola, qty: 1 }],
      });
    }
  }

  test('a cajero sees only the carts they parked', async () => {
    const { t, fx } = await setup();
    await parkOnePerActor(t, fx);

    const carts = await t.query(api.heldCarts.list, {
      token: fx.cajeroPlainToken,
    });
    expect(carts).toHaveLength(1);
    // The one cart a cajero sees is the one they parked: 4 exist in total.
    const all = await t.run((ctx) => ctx.db.query('heldCarts').collect());
    expect(all).toHaveLength(4);
    expect(all.find((c) => c._id === carts[0]._id)!.cashierId).toBe(
      fx.cajeroPlain
    );
  });

  test('view_reports does not widen a cajero — the ROLE decides, not the permission', async () => {
    const { t, fx } = await setup();
    await parkOnePerActor(t, fx);

    // cajeroVoid holds view_reports + void_sales and still sees only their own.
    const carts = await t.query(api.heldCarts.list, {
      token: fx.cajeroVoidToken,
    });
    expect(carts).toHaveLength(1);
  });

  test('owner and admin see every cart, attributed by employee name', async () => {
    const { t, fx } = await setup();
    await parkOnePerActor(t, fx);

    for (const token of [fx.ownerToken, fx.adminToken]) {
      const carts = await t.query(api.heldCarts.list, { token });
      expect(carts).toHaveLength(4);
      expect(carts.map((c) => c.cashierName).sort()).toEqual([
        'Ana Torres', // cajeroPlain
        'Carlos Méndez', // owner
        'Lucía Herrera', // admin
        'Pedro Ramírez', // cajeroVoid
      ]);
      // Attribution travels as a NAME — the employee _id stays server-side (AUTH-2).
      expect(carts[0]).not.toHaveProperty('cashierId');
    }
  });

  test('a cajero never receives the cashierName attribution', async () => {
    const { t, fx } = await setup();
    await parkOnePerActor(t, fx);

    const [own] = await t.query(api.heldCarts.list, {
      token: fx.cajeroPlainToken,
    });
    expect(own.cashierName).toBeUndefined();
  });

  test("a cajero cannot resume another cashier's parked sale", async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroVoidToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    const [foreign] = await t.query(api.heldCarts.list, {
      token: fx.ownerToken,
    });

    await expect(
      t.mutation(api.heldCarts.resume, {
        token: fx.cajeroPlainToken,
        heldCartId: foreign._id,
      })
    ).rejects.toThrow('Esta venta en espera pertenece a otro cajero.');

    // Rejected resume must NOT delete the row.
    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(1);
  });

  test("a cajero cannot discard another cashier's parked sale", async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroVoidToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    const [foreign] = await t.query(api.heldCarts.list, {
      token: fx.ownerToken,
    });

    await expect(
      t.mutation(api.heldCarts.discard, {
        token: fx.cajeroPlainToken,
        heldCartId: foreign._id,
      })
    ).rejects.toThrow('Esta venta en espera pertenece a otro cajero.');
    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(1);
  });

  test('a cajero may resume and discard their OWN parked sales', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroPlainToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroPlainToken,
      items: [{ productId: fx.agua, qty: 2 }],
    });
    const own = await t.query(api.heldCarts.list, {
      token: fx.cajeroPlainToken,
    });
    expect(own).toHaveLength(2);

    await t.mutation(api.heldCarts.resume, {
      token: fx.cajeroPlainToken,
      heldCartId: own[0]._id,
    });
    await t.mutation(api.heldCarts.discard, {
      token: fx.cajeroPlainToken,
      heldCartId: own[1]._id,
    });
    await expect(
      t.query(api.heldCarts.list, { token: fx.cajeroPlainToken })
    ).resolves.toHaveLength(0);
  });

  test("owner and admin may resume or discard any cashier's parked sale", async () => {
    const { t, fx } = await setup();
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroPlainToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    await t.mutation(api.heldCarts.park, {
      token: fx.cajeroVoidToken,
      items: [{ productId: fx.agua, qty: 1 }],
    });
    const carts = await t.query(api.heldCarts.list, { token: fx.ownerToken });

    await t.mutation(api.heldCarts.resume, {
      token: fx.ownerToken,
      heldCartId: carts[0]._id,
    });
    await t.mutation(api.heldCarts.discard, {
      token: fx.adminToken,
      heldCartId: carts[1]._id,
    });
    await expect(
      t.query(api.heldCarts.list, { token: fx.ownerToken })
    ).resolves.toHaveLength(0);
  });
});
