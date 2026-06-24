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
      actorId: fx.owner,
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
      actorId: fx.owner,
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
      actorId: fx.owner,
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
      actorId: fx.owner,
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
      actorId: fx.owner,
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
        actorId: fx.owner,
        clientId: fx.clientId,
        items,
        method: 'cash',
        splits: cash(4.17),
      })
    ).rejects.toThrow('El pago no cubre el total. Verifica los montos.');

    // ...but a 0.01 shortfall is within tolerance (characterized behavior)
    const sale = await t.mutation(api.sales.checkout, {
      actorId: fx.owner,
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
        actorId: fx.owner,
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
        actorId: fx.owner,
        clientId: fx.clientId,
        items: [{ productId: fx.pintura, qty: 1 }],
        method: 'cash',
        splits: cash(22.5),
      })
    ).rejects.toThrow('Producto no disponible: Pintura blanca 1gal');

    await expect(
      t.mutation(api.sales.checkout, {
        actorId: fx.owner,
        clientId: fx.clientId,
        items: [],
        method: 'cash',
        splits: cash(0),
      })
    ).rejects.toThrow('No hay productos en el carrito.');

    await expect(
      t.mutation(api.sales.checkout, {
        actorId: fx.owner,
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
        actorId: fx.owner,
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
        actorId: fx.inactive,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 1 }],
        method: 'cash',
        splits: cash(1.7),
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });
});

describe('sales.checkout — reserved ("en espera") availability', () => {
  // A product with physical stock 5 and 1 unit held in another "venta en
  // espera" (reserved = 1) is sellable only up to 4 in a NEW sale. The cap is a
  // server backstop: physical − reserved.
  async function setupReserved() {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);
    // Reset cola to exactly stock 5, then hold 1 of it in a parked cart.
    await t.run((ctx) => ctx.db.patch('products', fx.cola, { stock: 5 }));
    await t.mutation(api.heldCarts.park, {
      actorId: fx.owner,
      items: [{ productId: fx.cola, qty: 1 }],
    });
    return { t, fx };
  }

  test('rejects qty 5 when 1 unit is held (physical 5 − reserved 1 = 4 available)', async () => {
    const { t, fx } = await setupReserved();
    await expect(
      t.mutation(api.sales.checkout, {
        actorId: fx.owner,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty: 5 }],
        method: 'cash',
        splits: cash(8.48), // 5×1.50 = 7.50 + 13% IVA
      })
    ).rejects.toThrow(
      'No hay suficiente stock disponible para "Coca-Cola 600ml": hay 1 en espera.'
    );

    // The rejected sale consumed nothing.
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(5);
  });

  test('allows qty 4 when 1 unit is held, decrementing physical stock to 1', async () => {
    const { t, fx } = await setupReserved();
    const sale = await t.mutation(api.sales.checkout, {
      actorId: fx.owner,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 4 }],
      method: 'cash',
      splits: cash(6.78), // 4×1.50 = 6.00 + 13% IVA = 6.78
    });
    expect(sale.subtotal).toBe(6);

    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(1); // 5 − 4; the 1 held unit stays physically present
  });

  test('park is NOT blocked by reserved units from other held carts', async () => {
    const { t, fx } = await setupReserved(); // already holds 1 of cola (stock 5)
    // Parking a second cart holding all 5 must succeed — holds do not block holds.
    await t.mutation(api.heldCarts.park, {
      actorId: fx.owner,
      items: [{ productId: fx.cola, qty: 5 }],
    });
    const carts = await t.query(api.heldCarts.list, {});
    expect(carts).toHaveLength(2);
    // Parking never consumes stock either.
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(5);
  });
});

describe('sales.refund', () => {
  async function checkoutOnce(t: ReturnType<typeof convexTest>, fx: Fixtures) {
    return await t.mutation(api.sales.checkout, {
      actorId: fx.owner,
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
      actorId: fx.cajeroVoid, // has void_sales
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
      actorId: fx.owner,
      saleId: sale._id,
      reason: 'Error de cobro',
    });
    await expect(
      t.mutation(api.sales.refund, {
        actorId: fx.owner,
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
        actorId: fx.cajeroPlain, // manage_clients only
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
      actorId: fx.owner,
      saleId: sale._id,
      reason: 'Cliente devolvió todo',
    });

    const agua = await t.run((ctx) => ctx.db.get('products', fx.agua));
    expect(agua!.stock).toBe(56); // surviving product restored; deleted one skipped silently
  });
});
