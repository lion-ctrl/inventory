// Phase 10 — a read-only view of the OFFLINE sales still queued locally (the
// SALE_CREATE pending ops). The op payload is minimal (productId + qty), so each is
// ENRICHED with the mirrored products/clients for display: total (from mirror prices
// + the CAPTURED ivaPct), item count, and client name. These are PENDING_SYNC — never
// official; the sync engine turns each into a real sale on reconnect and deletes the
// op, at which point it drops out of this list and appears in the official history.
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { PendingOp } from './db';
import { useClients, useProducts } from './hooks';
import type { SaleCreatePayload } from './sync';

export interface PendingSale {
  localId: number;
  soldAt: number;
  /** Estimated from the mirrored prices + the captured IVA — this sale is not
   *  official yet, so the server-computed total may differ if prices changed. */
  total: number;
  itemCount: number;
  clientName: string;
  method: string;
  status: PendingOp['status'];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function usePendingSales(): PendingSale[] {
  const products = useProducts();
  const clients = useClients();
  const ops = useLiveQuery(
    () => db.pendingOps.where('type').equals('SALE_CREATE').toArray(),
    []
  );

  return useMemo<PendingSale[]>(() => {
    if (!ops) return [];
    const productById = new Map(products.map((p) => [p._id, p]));
    const clientById = new Map(clients.map((c) => [c._id, c]));

    return ops
      .map((op): PendingSale => {
        const p = op.payload as SaleCreatePayload;
        let subtotal = 0;
        let exemptBase = 0;
        let itemCount = 0;
        for (const it of p.items) {
          itemCount += it.qty;
          const prod = productById.get(it.productId);
          if (!prod) continue; // deleted from the mirror — skip its money
          const line = prod.price * it.qty;
          subtotal += line;
          if (prod.exempt === true) exemptBase += line;
        }
        const tax = ((subtotal - exemptBase) * (p.ivaPct ?? 0)) / 100;
        const client = clientById.get(p.clientId as never);
        return {
          localId: op.localId ?? 0,
          soldAt: p.soldAt,
          total: round2(subtotal + tax),
          itemCount,
          clientName: client?.name ?? 'Cliente nuevo',
          method: p.method,
          status: op.status,
        };
      })
      .sort((a, b) => b.soldAt - a.soldAt);
  }, [ops, products, clients]);
}
