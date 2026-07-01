// Phase 6.2 — offline CUSTOMER_CREATE (OFFLINE_FIRST_PLAN §6.2 / §6.2.1).
//
// Convex owns the real client `_id`, which only exists after the server insert;
// offline we can't get it, yet the sale must already reference the client. So when
// the cashier registers a walk-in from Venta while offline we:
//   (a) mint a local id `local:<uuid>` (Convex-independent placeholder);
//   (b) insert a `_local`-tagged client row into the Dexie `clients` mirror so the
//       Venta client list can show + select it offline. The tag makes the
//       background mirror refresh PRESERVE the row instead of wiping it on the next
//       online sync (see useMirroredQuery — clear()+bulkPut() would otherwise drop
//       any row the server result doesn't yet include);
//   (c) enqueue a CUSTOMER_CREATE op carrying the local id + form payload. The op
//       is created FIRST (smaller createdAt) so it syncs before the dependent
//       SALE_CREATE; the sync engine (Phase 6.4) creates the real client and remaps
//       local → real before the sale is sent.
// Returns the local id so the caller sets it as the cart's `selectedClientId` and
// the sale can proceed.
import { db } from './db';
import type { Client } from '@/types';
import type { Id } from '@convex/_generated/dataModel';
import { mintLocalId } from './localId';
import { enqueuePendingOp } from './pendingOps';

/** Client fields captured by Venta's inline create form. */
export interface ClientDraftInput {
  name: string;
  taxPrefix: Client['taxPrefix'];
  taxId: string;
  kind: Client['kind'];
  email?: string;
  phone?: string;
  address?: string;
}

/** Payload of a queued CUSTOMER_CREATE op: everything `clients.create` needs plus
 *  the local id it must be remapped from on sync. */
export interface CustomerCreatePayload extends ClientDraftInput {
  localId: string;
}

export async function createOfflineClient(
  input: ClientDraftInput
): Promise<Id<'clients'>> {
  const localId = mintLocalId();
  const now = Date.now();

  // Omit empty-string contact fields entirely, mirroring convex/clients.ts create.
  const contact = {
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.address ? { address: input.address } : {}),
  };

  // The `_local` tag survives the mirror refresh (useMirroredQuery). `_id` and
  // `_creationTime` masquerade as a real Convex doc so consumers treat it like any
  // other client until the sync engine replaces it with the server row.
  const row: Client & { _local: true } = {
    _id: localId as Id<'clients'>,
    _creationTime: now,
    name: input.name,
    taxPrefix: input.taxPrefix,
    taxId: input.taxId,
    kind: input.kind,
    createdAt: now,
    _local: true,
    ...contact,
  };
  await db.clients.put(row);

  const payload: CustomerCreatePayload = {
    localId,
    name: input.name,
    taxPrefix: input.taxPrefix,
    taxId: input.taxId,
    kind: input.kind,
    ...contact,
  };
  await enqueuePendingOp('CUSTOMER_CREATE', payload);

  return localId as Id<'clients'>;
}
