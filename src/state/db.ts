// Offline-first local store (Phase 0.2). Convex is the source of truth + live
// reactivity; this Dexie/IndexedDB database is the offline MIRROR plus a durable
// pending-writes queue. Mirror tables key on the Convex `_id` string as primary
// key, so `bulkPut` upserts by Convex identity. All local-only tables (cartDraft,
// pendingOps, meta) are declared up front even though pendingOps is not WRITTEN
// until Phase 6 — declaring it now lets the guarded logout reference db.pendingOps
// from day one (its count is simply 0 until Venta).
import Dexie, { type EntityTable } from 'dexie';
import type {
  Product,
  Category,
  Client,
  Settings,
  CartItem,
  SplitRow,
} from '@/types';
import type { Id } from '@convex/_generated/dataModel';

// Local-only row shapes (not Convex docs).
export interface CartDraft {
  id: 'active'; // singleton key
  cart: CartItem[]; // CartContext.tsx:70
  selectedClientId: Id<'clients'> | null; // CartContext.tsx:71-72
  splits: SplitRow[]; // CartContext.tsx:73
  splitsNextId: number; // CartContext.tsx:74 (splitsIdRef.current)
  updatedAt: number;
}
export type PendingOpType =
  | 'SALE_CREATE'
  | 'CUSTOMER_CREATE'
  | 'STOCK_ADJUSTMENT'
  | 'PRODUCT_CREATE_DRAFT';
export type PendingOpStatus =
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'conflict'
  | 'cancelled';
export interface PendingOp {
  localId?: number; // ++ auto PK
  idempotencyKey: string; // crypto.randomUUID(), generated at ENQUEUE
  type: PendingOpType;
  payload: unknown;
  status: PendingOpStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  deviceId: string; // FEATURES §19
}
export interface MetaRow {
  key: string;
  value: unknown;
}

const db = new Dexie('intentory-pos') as Dexie & {
  products: EntityTable<Product, '_id'>;
  categories: EntityTable<Category, '_id'>;
  clients: EntityTable<Client, '_id'>;
  settings: EntityTable<Settings, '_id'>;
  cartDraft: EntityTable<CartDraft, 'id'>;
  pendingOps: EntityTable<PendingOp, 'localId'>;
  meta: EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  // — Convex mirror (PK = Convex _id). Whole doc is stored; only INDEXED fields listed. —
  // Indexes mirror convex/schema.ts (by_barcode, by_category) + useful direct lookups.
  // NOTE: Scan/Sale search the in-memory array (see Phase 5), so these indexes are for
  // direct lookups / future index-backed search, not required for offline search to work.
  products: '_id, barcode, sku, name, categoryId, sellable, _creationTime',
  categories: '_id, label',
  // clients: compound [taxPrefix+taxId] mirrors Convex index by_taxId (clients.byTaxId).
  clients: '_id, name, [taxPrefix+taxId], createdAt',
  settings: '_id', // singleton; no secondary index needed
  // — Local-only durable —
  cartDraft: 'id', // one row, id='active'
  pendingOps: '++localId, &idempotencyKey, type, status, createdAt, updatedAt',
  meta: 'key', // deviceId, lastSyncAt.<table>, optional currentUser snapshot
});

// First-run seed: a stable device id (FEATURES §19).
db.on('populate', async () => {
  await db.meta.put({ key: 'deviceId', value: crypto.randomUUID() });
});

export { db };
