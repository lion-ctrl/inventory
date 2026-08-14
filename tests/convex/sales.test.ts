/// <reference types="vite/client" />
// Characterization tests for sales.checkout / sales.refund — the money path.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';
import type { Fixtures } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx: Fixtures = await t.run(seedBase);
  return { t, fx };
}

const cash = (amount: number) => [{ method: 'cash', amount }];

describe('sales.checkout', () => {
  test('invoice sale: exempt-aware IVA, snapshots, padded invoice number', async () => {
    const { t, fx } = await setup();

    // cola 1.50×2 (taxable) + agua 0.80×1 (exempt)
    const sale = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [
        { productId: fx.cola, qty: 2 },
        { productId: fx.agua, qty: 1 },
      ],
      method: 'cash',
      splits: cash(4.19),
      tendered: 5,
    });

    // Totals: subtotal 3.80, taxable base 3.00, IVA 13% = 0.39, total 4.19
    expect(sale.subtotal).toBe(3.8);
    expect(sale.tax).toBe(0.39);
    expect(sale.total).toBe(4.19);

    // Invoice numbering: 8-digit zero-padded, starting at the seeded counter
    expect(sale.invoiceNumber).toBe('00000043');

    // Snapshots frozen on the sale
    expect(sale.cashierName).toBe('Carlos Méndez');
    expect(sale.client).toMatchObject({
      name: 'María González',
      taxPrefix: 'V',
      taxId: '5.123.456',
    });
    expect(sale.ivaPct).toBe(13);
    expect(sale.exchangeRate).toBe(36.5);
    expect(sale.tendered).toBe(5);
    expect(typeof sale.soldAt).toBe('number');

    // Item snapshots: category label + exempt flag only where it applies
    expect(sale.items).toHaveLength(2);
    const colaItem = sale.items.find((i) => i.productId === fx.cola)!;
    const aguaItem = sale.items.find((i) => i.productId === fx.agua)!;
    expect(colaItem).toMatchObject({
      name: 'Coca-Cola 600ml',
      price: 1.5,
      qty: 2,
      cat: 'Bebidas',
    });
    expect(colaItem.exempt).toBeUndefined();
    expect(aguaItem.exempt).toBe(true);
  });

  test('decrements stock and advances the invoice counter atomically', async () => {
    const { t, fx } = await setup();

    await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [
        { productId: fx.cola, qty: 2 },
        { productId: fx.agua, qty: 1 },
      ],
      method: 'cash',
      splits: cash(4.19),
    });

    const after = await t.run(async (ctx) => ({
      cola: await ctx.db.get('products', fx.cola),
      agua: await ctx.db.get('products', fx.agua),
      settings: await ctx.db.get('settings', fx.settingsId),
    }));
    expect(after.cola!.stock).toBe(22);
    expect(after.agua!.stock).toBe(55);
    expect(after.settings!.nextInvoiceNumber).toBe(44);

    // Next sale gets the next number
    const second = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 1 }],
      method: 'card',
      splits: [{ method: 'card', amount: 1.7 }],
    });
    expect(second.invoiceNumber).toBe('00000044');
  });

  test('every sale is an invoice: IVA always applies (no ticket path)', async () => {
    const { t, fx } = await setup();
    // cola 1.50×2 = 3.00 taxable → IVA 13% = 0.39, total 3.39.
    const sale = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 2 }],
      method: 'cash',
      splits: cash(3.39),
    });
    expect(sale.subtotal).toBe(3);
    expect(sale.tax).toBe(0.39);
    expect(sale.total).toBe(3.39);
  });

  test('merges duplicate product lines before applying stock math', async () => {
    const { t, fx } = await setup();
    const sale = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [
        { productId: fx.cola, qty: 1 },
        { productId: fx.cola, qty: 2 },
      ],
      method: 'cash',
      splits: cash(5.09),
    });
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].qty).toBe(3);
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(21);
  });

  test('splits must cover the server-computed total (0.011 tolerance)', async () => {
    const { t, fx } = await setup();
    const items = [
      { productId: fx.cola, qty: 2 },
      { productId: fx.agua, qty: 1 },
    ];
    // total = 4.19 → paying 4.17 (short by 0.02) is rejected
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items,
        method: 'cash',
        splits: cash(4.17),
      })
    ).rejects.toThrow('El pago no cubre el total. Verifica los montos.');

    // ...but a 0.01 shortfall is within tolerance (characterized behavior)
    const sale = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items,
      method: 'cash',
      splits: cash(4.18),
    });
    expect(sale.total).toBe(4.19);
  });

  test('rejects insufficient stock with the Spanish message', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cafe, qty: 3 }],
        method: 'cash',
        splits: cash(17.4),
      })
    ).rejects.toThrow(
      'Stock insuficiente: Café molido 250g. Quedan 2 unidades.'
    );
  });

  test('rejects paused products, empty carts, zero quantities and missing clients', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [{ productId: fx.pintura, qty: 1 }],
        method: 'cash',
        splits: cash(22.5),
      })
    ).rejects.toThrow('Producto no disponible: Pintura blanca 1gal');

    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [],
        method: 'cash',
        splits: cash(0),
      })
    ).rejects.toThrow('No hay productos en el carrito.');

    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 0 }],
        method: 'cash',
        splits: cash(0),
      })
    ).rejects.toThrow('Cantidad inválida en el carrito.');

    const goneClient = await t.run(async (ctx) => {
      const id = await ctx.db.insert('clients', {
        name: 'Temp',
        taxPrefix: 'V',
        taxId: '1.111.111',
        kind: 'person',
        createdAt: Date.now(),
      });
      await ctx.db.delete('clients', id);
      return id;
    });
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: goneClient,
        items: [{ productId: fx.cola, qty: 1 }],
        method: 'cash',
        splits: cash(1.7),
      })
    ).rejects.toThrow('Cliente no encontrado.');
  });

  test('inactive employees cannot sell', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.inactiveToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 1 }],
        method: 'cash',
        splits: cash(1.7),
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('sales.checkout — physical-stock backstop (parked carts reserve nothing)', () => {
  // Parking a sale reserves NO stock: availability is LIVE physical stock for
  // every cashier. A held cart holding units of a product does NOT lower how
  // much another cashier can sell — the only server backstop is physical stock.
  // A hold that loses its stock is reconciled when RESUMED, not blocked here.
  async function setupWithHeldCart() {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);
    // Reset cola to exactly stock 5, then park a cart holding 1 of it.
    await t.run((ctx) => ctx.db.patch('products', fx.cola, { stock: 5 }));
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    return { t, fx };
  }

  test('sells the FULL physical stock even while another cart holds units', async () => {
    const { t, fx } = await setupWithHeldCart(); // physical 5, 1 held elsewhere
    // The hold reserves nothing: all 5 physical units are sellable right now.
    const sale = await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 5 }],
      method: 'cash',
      splits: cash(8.48), // 5×1.50 = 7.50 + 13% IVA
    });
    expect(sale.subtotal).toBe(7.5);

    const after = await t.run(async (ctx) => ({
      cola: await ctx.db.get('products', fx.cola),
      carts: await ctx.db.query('heldCarts').collect(),
    }));
    // Physical stock is fully consumed, and the parked cart is UNTOUCHED —
    // holds neither block the sale nor are drained by it.
    expect(after.cola!.stock).toBe(0);
    expect(after.carts).toHaveLength(1);
  });

  test('still rejects a sale that exceeds PHYSICAL stock (the guard that stays)', async () => {
    const { t, fx } = await setupWithHeldCart(); // physical stock 5
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 6 }], // 6 > 5 physical
        method: 'cash',
        splits: cash(10.17),
      })
    ).rejects.toThrow(
      'Stock insuficiente: Coca-Cola 600ml. Quedan 5 unidades.'
    );

    // The rejected sale consumed nothing.
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(5);
  });

  test('park is NOT blocked by units held in other parked carts', async () => {
    const { t, fx } = await setupWithHeldCart(); // already holds 1 of cola (stock 5)
    // Parking a second cart holding all 5 must succeed — holds do not block holds.
    await t.mutation(api.heldCarts.park, {
      token: fx.ownerToken,
      items: [{ productId: fx.cola, qty: 5 }],
    });
    const carts = await t.query(api.heldCarts.list, { token: fx.ownerToken });
    expect(carts).toHaveLength(2);
    // Parking never consumes stock either.
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(5);
  });
});

describe('sales.refund', () => {
  async function checkoutOnce(t: ReturnType<typeof convexTest>, fx: Fixtures) {
    return await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [
        { productId: fx.cola, qty: 2 },
        { productId: fx.agua, qty: 1 },
      ],
      method: 'cash',
      splits: cash(4.19),
    });
  }

  test('restores stock and stamps refund date + reason', async () => {
    const { t, fx } = await setup();
    const sale = await checkoutOnce(t, fx);

    await t.mutation(api.sales.refund, {
      token: fx.cajeroVoidToken, // has void_sales
      saleId: sale._id,
      reason: 'Producto dañado',
    });

    const after = await t.run(async (ctx) => ({
      cola: await ctx.db.get('products', fx.cola),
      agua: await ctx.db.get('products', fx.agua),
      sale: await ctx.db.get('sales', sale._id),
    }));
    expect(after.cola!.stock).toBe(24);
    expect(after.agua!.stock).toBe(56);
    expect(after.sale!.refund).toMatchObject({ reason: 'Producto dañado' });
    expect(typeof after.sale!.refund!.date).toBe('number');
  });

  test('rejects double refunds', async () => {
    const { t, fx } = await setup();
    const sale = await checkoutOnce(t, fx);
    await t.mutation(api.sales.refund, {
      token: fx.ownerToken,
      saleId: sale._id,
      reason: 'Error de cobro',
    });
    await expect(
      t.mutation(api.sales.refund, {
        token: fx.ownerToken,
        saleId: sale._id,
        reason: 'Otra vez',
      })
    ).rejects.toThrow('Esta venta ya fue reembolsada.');
  });

  test('requires the void_sales permission server-side', async () => {
    const { t, fx } = await setup();
    const sale = await checkoutOnce(t, fx);
    await expect(
      t.mutation(api.sales.refund, {
        token: fx.cajeroPlainToken, // manage_clients only
        saleId: sale._id,
        reason: 'No autorizado',
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('skips stock restore for products deleted after the sale', async () => {
    const { t, fx } = await setup();
    const sale = await checkoutOnce(t, fx);

    await t.run((ctx) => ctx.db.delete('products', fx.cola));
    await t.mutation(api.sales.refund, {
      token: fx.ownerToken,
      saleId: sale._id,
      reason: 'Cliente devolvió todo',
    });

    const agua = await t.run((ctx) => ctx.db.get('products', fx.agua));
    expect(agua!.stock).toBe(56); // surviving product restored; deleted one skipped silently
  });
});

// --- sales.history: server-side date window --------------------------------
// The screen only ever shows today or a custom range, but the query used to
// `.collect()` the WHOLE sales table on every load — and, because Convex queries
// are live subscriptions, on every new sale, to every connected cashier. The
// window now travels to the server and resolves through the `by_soldAt` index.
describe('sales.history — server-side window', () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** Insert a sale straight at `soldAt`; checkout would stamp Date.now(). */
  async function plantSale(
    t: Awaited<ReturnType<typeof setup>>['t'],
    fx: Awaited<ReturnType<typeof setup>>['fx'],
    soldAt: number,
    invoiceNumber: string
  ) {
    await t.run(async (ctx) => {
      const client = (await ctx.db.get('clients', fx.clientId))!;
      await ctx.db.insert('sales', {
        invoiceNumber,
        clientId: fx.clientId,
        client: {
          name: client.name,
          taxPrefix: client.taxPrefix,
          taxId: client.taxId,
        },
        cashierId: fx.owner,
        cashierName: 'Carlos Méndez',
        items: [],
        subtotal: 1,
        tax: 0,
        total: 1,
        method: 'cash',
        ivaPct: 13,
        exchangeRate: 36.5,
        soldAt,
      });
    });
  }

  async function seedThreeDays() {
    const { t, fx } = await setup();
    const now = Date.now();
    await plantSale(t, fx, now, '00000001'); // today
    await plantSale(t, fx, now - DAY, '00000002'); // yesterday
    await plantSale(t, fx, now - 30 * DAY, '00000003'); // last month
    return { t, fx, now };
  }

  test('returns only the sales inside [from, to]', async () => {
    const { t, fx, now } = await seedThreeDays();

    const today = await t.query(api.sales.history, {
      token: fx.ownerToken,
      from: now - 60 * 60 * 1000,
      to: now + 60 * 60 * 1000,
    });
    expect(today.sales.map((s) => s.invoiceNumber)).toEqual(['00000001']);

    const lastWeek = await t.query(api.sales.history, {
      token: fx.ownerToken,
      from: now - 7 * DAY,
      to: now + 60 * 60 * 1000,
    });
    expect(lastWeek.sales.map((s) => s.invoiceNumber)).toEqual([
      '00000001',
      '00000002',
    ]);
  });

  test('an open-ended bound still narrows the window', async () => {
    const { t, fx, now } = await seedThreeDays();

    const fromOnly = await t.query(api.sales.history, {
      token: fx.ownerToken,
      from: now - 7 * DAY,
    });
    expect(fromOnly.sales).toHaveLength(2);
    const toOnly = await t.query(api.sales.history, {
      token: fx.ownerToken,
      to: now - 7 * DAY,
    });
    expect(toOnly.sales).toHaveLength(1);
  });

  test('a capped result SAYS it was capped — money must never be silently short', async () => {
    const { t, fx, now } = await seedThreeDays();

    const capped = await t.query(api.sales.history, {
      token: fx.ownerToken,
      limit: 2,
    });
    expect(capped.sales).toHaveLength(2);
    // Newest first: the cap keeps the most recent sales, never the oldest.
    expect(capped.sales.map((s) => s.invoiceNumber)).toEqual([
      '00000001',
      '00000002',
    ]);
    // Revenue totals are computed from this array, so the screen has to know it
    // is looking at a slice rather than reporting a smaller figure as the truth.
    expect(capped.truncated).toBe(true);
    expect(now).toBeGreaterThan(0);
  });

  test('a complete result is not flagged as capped', async () => {
    const { t, fx } = await seedThreeDays();
    const all = await t.query(api.sales.history, { token: fx.ownerToken });
    expect(all.sales).toHaveLength(3);
    expect(all.truncated).toBe(false);
  });

  test('still session-gated and still hides cashierId', async () => {
    const { t, fx } = await seedThreeDays();
    await expect(
      t.query(api.sales.history, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');

    const { sales: onlySales } = await t.query(api.sales.history, {
      token: fx.ownerToken,
    });
    const [sale] = onlySales;
    expect(sale).not.toHaveProperty('cashierId');
  });
});

// Unit 3 — fractional quantities (product-base-unit). The server already
// tolerates them: `snapshotLines` validates `qty > 0` and nothing more. These
// tests PIN that tolerance, so a future guard written for counted products
// cannot silently break every product sold by weight.
describe('sales — a weighed product survives checkout', () => {
  test('1.5 kg is sold, totalled and taken off stock as 1.5', async () => {
    const { t, fx } = await setup();
    const cheese = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000009090',
      name: 'Queso amarillo',
      price: 8,
      stock: 10,
      minStock: 1,
      unit: 'kilogram',
    });

    const sale = await t.mutation(api.sales.checkout, {
      token: fx.cajeroPlainToken,
      clientId: fx.clientId,
      items: [{ productId: cheese, qty: 1.5 }],
      method: 'cash',
      // 1.5 x $8.00 = $12.00 plus IVA — the money path is untouched by the
      // quantity being fractional.
      splits: cash(13.92),
      tendered: 13.92,
    });

    expect(sale.items[0].qty).toBe(1.5);
    // 1.5 × $8.00 — money is rounded by the same rule as every other amount.
    expect(sale.subtotal).toBe(12);
    const row = await t.run((ctx) => ctx.db.get('products', cheese));
    expect(row!.stock).toBe(8.5);
  });

  test('a quantity of zero is still refused, fractions or not', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.sales.checkout, {
        token: fx.cajeroPlainToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 0 }],
        method: 'cash',
        splits: cash(0),
      })
    ).rejects.toThrow('Cantidad inválida en el carrito.');
  });
});

// `roundQty` existed to drop float noise and was called at no write site. Stock
// 0.3 minus 0.1 stored 0.19999999999999998: the screen rounded it to "0.2 kg",
// the next sale of 0.2 was refused as insufficient, and the displayed stock was
// permanently unsellable. The values here are chosen to be binary-INEXACT on
// purpose — the earlier tests all used halves and quarters, which cannot fail.
describe('sales — a fractional stock never accumulates float residue', () => {
  test('selling 0.1 from 0.3 leaves exactly 0.2, and 0.2 is then sellable', async () => {
    const { t, fx } = await setup();
    const productId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000002222',
      name: 'Queso de mano',
      price: 10,
      stock: 0.3,
      minStock: 0,
      unit: 'kilogram',
    });

    await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId, qty: 0.1 }],
      method: 'cash',
      splits: cash(5),
    });

    const afterFirst = (await t.run((ctx) =>
      ctx.db.get('products', productId)
    ))!;
    // Raw arithmetic would leave 0.19999999999999998 here.
    expect(afterFirst.stock).toBe(0.2);

    // The whole point: what the screen shows must still be sellable.
    await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId, qty: 0.2 }],
      method: 'cash',
      splits: cash(5),
    });
    const afterSecond = (await t.run((ctx) =>
      ctx.db.get('products', productId)
    ))!;
    expect(afterSecond.stock).toBe(0);
  });
});
