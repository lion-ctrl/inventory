// Phase 6.5 — build the durable SALE_CREATE op + the local PENDING_SYNC receipt for
// a sale confirmed OFFLINE. Pure (soldAt is passed in, not read from the clock) so it
// is unit-testable. The captured ivaPct + exchangeRate ride to the server via the op,
// so a later sync stamps the sale with the rate in effect WHEN it happened, not
// today's (Bs volatility, §6.5).
import type {
  CartItem,
  CleanSplit,
  Client,
  ClientSnapshot,
  CompletedSale,
  SaleItemSnapshot,
} from '@/types';
import type { SaleCreatePayload } from './sync';

export function buildOfflineSale(input: {
  cart: CartItem[];
  client: Client;
  total: number;
  method: string;
  splits: CleanSplit[];
  tendered?: number;
  ivaPct: number;
  exchangeRate: number;
  now: number;
}): { payload: SaleCreatePayload; completedSale: CompletedSale } {
  const itemSnapshots: SaleItemSnapshot[] = input.cart.map((i) => ({
    productId: i._id,
    name: i.name,
    sku: i.sku,
    barcode: i.barcode,
    price: i.price,
    qty: i.qty,
    glyph: i.glyph,
    exempt: i.exempt,
  }));

  const clientSnapshot: ClientSnapshot = {
    name: input.client.name,
    taxPrefix: input.client.taxPrefix,
    taxId: input.client.taxId,
    kind: input.client.kind,
    email: input.client.email,
    phone: input.client.phone,
    address: input.client.address,
  };

  const payload: SaleCreatePayload = {
    clientId: input.client._id,
    items: input.cart.map((i) => ({ productId: i._id, qty: i.qty })),
    method: input.method,
    splits: input.splits,
    ...(input.tendered !== undefined ? { tendered: input.tendered } : {}),
    ivaPct: input.ivaPct,
    exchangeRate: input.exchangeRate,
    soldAt: input.now,
  };

  const completedSale: CompletedSale = {
    invoice: null, // server mints it on sync; the receipt shows PENDING_SYNC
    pendingSync: true,
    total: input.total,
    items: itemSnapshots,
    method: input.method,
    ...(input.tendered !== undefined ? { tendered: input.tendered } : {}),
    splits: input.splits,
    client: clientSnapshot,
    ivaPct: input.ivaPct,
    exchangeRate: input.exchangeRate,
  };

  return { payload, completedSale };
}
