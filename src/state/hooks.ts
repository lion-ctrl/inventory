import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '@convex/_generated/api';
import { db } from './db';
import { useMirroredQuery } from './useMirroredQuery';
import { useSession } from './SessionContext';
import type { CategoryWithCount, Client, Product, Settings } from '@/types';

// Stable empty array so effects depending on these lists don't re-fire every render.
const EMPTY: never[] = [];

// Phase 4 — Settings: this read is now Dexie-backed. settings.get is a SINGLETON
// (one row), so it uses the SAME Convex-primary / Dexie-fallback pattern as
// useMirroredQuery, adapted for a single doc: online it reads Convex live and
// mirrors the row via db.settings.put(live); offline it serves
// db.settings.toCollection().first(). The signature is unchanged
// (Settings | null | undefined), so every consumer (Settings, Scan, Sale, Payment
// and — through useBsRate — AppShell/Dashboard/Stored/Products/History) becomes
// settings-offline in one move. settings.get is session-gated server-side (owner
// directive: NOTHING is public); with no token we pass 'skip', which yields null
// and reads NO local mirror, so a logged-out device sees no settings (closing the
// read half of the old logout leak). This was the LAST useCachedQuery consumer.
export function useSettingsDoc(): Settings | null | undefined {
  const { token } = useSession();
  const args = token ? { token } : 'skip';
  const live = useQuery(api.settings.get, args);

  // Background mirror: every successful server result refreshes the singleton row.
  useEffect(() => {
    if (live === undefined) return; // loading / offline → keep last mirror
    void db.transaction('rw', db.settings, async () => {
      await db.settings.clear(); // singleton: only ever one row
      if (live) await db.settings.put(live);
    });
  }, [live]);

  // Offline fallback only. 'skip' (no session) ⇒ null so logged-out users see NO data.
  const skipped = args === 'skip';
  const cached = useLiveQuery(
    () =>
      skipped
        ? null
        : db.settings
            .toCollection()
            .first()
            .then((r) => r ?? null),
    [skipped]
  );

  return live !== undefined ? live : cached; // Convex-primary; Dexie fills the gap
}

export function useBsRate(): number {
  const s = useSettingsDoc();
  return s?.bsRate ?? 0;
}

// products/categories/clients are session-gated server-side (internal POS — no
// public endpoints). The acting employee is resolved from the session token, so
// every read must replay it. No session → 'skip' (no server call, no data),
// which is correct: only the login-gated screens render these lists.
//
// Phase 1 — Products: this read is now Dexie-backed via useMirroredQuery. The
// signature is unchanged (returns Product[]), so every consumer (Products,
// Dashboard, Scan, Sale, Stored, CartContext) becomes product-offline in one
// move: online it reads Convex live and mirrors into the `products` table;
// offline it serves that mirror.
export function useProducts(): Product[] {
  const { token } = useSession();
  return (
    useMirroredQuery<Product>(
      api.products.list,
      token ? { token } : 'skip',
      'products'
    ) ?? EMPTY
  );
}

// Phase 2 — Categories: this read is now Dexie-backed via useMirroredQuery. The
// signature is unchanged (still returns CategoryWithCount[] — the live `count`
// per category is part of the mirrored doc, so it survives offline as a
// snapshot), so every consumer (Products, Dashboard, Scan, Sale) becomes
// category-offline in one move: online it reads Convex live and mirrors into the
// `categories` table; offline it serves that mirror.
export function useCategories(): CategoryWithCount[] {
  const { token } = useSession();
  return (
    useMirroredQuery<CategoryWithCount>(
      api.categories.list,
      token ? { token } : 'skip',
      'categories'
    ) ?? EMPTY
  );
}

// Phase 3 — Clients: this read is now Dexie-backed via useMirroredQuery. The
// signature is unchanged (returns Client[]), so every consumer (Clients,
// Dashboard, Sale, CartContext) becomes client-offline in one move: online it
// reads Convex live and mirrors into the `clients` table; offline it serves that
// mirror (the Sale picker's tax-id match filters this array, so client selection
// works offline).
export function useClients(): Client[] {
  const { token } = useSession();
  return (
    useMirroredQuery<Client>(
      api.clients.list,
      token ? { token } : 'skip',
      'clients'
    ) ?? EMPTY
  );
}
