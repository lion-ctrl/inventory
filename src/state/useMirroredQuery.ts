// Phase 0.3 — the Convex-primary / Dexie-fallback read primitive.
//
// Same 3-arg shape as the old useCachedQuery(query, args, key), so swapping a
// shared hook's body is a one-line change. It runs the Convex `useQuery` live;
// every successful server result is written into its Dexie mirror table in the
// background; and the Dexie mirror is served ONLY while the live result is
// `undefined` (loading / offline). `'skip'` (no session token) ⇒ [] so a
// logged-out user sees NO data — closing the read half of the old logout leak
// (useCachedQuery returned the stale localStorage cache even with no session).
import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

type MirrorTable = 'products' | 'categories' | 'clients';

export function useMirroredQuery<T extends { _id: string }>(
  query: any,
  args: any,
  table: MirrorTable,
  confirmed: boolean = true
): T[] | undefined {
  // Hit the SERVER only with a CONFIRMED session (`confirmed`). A present-but-
  // unconfirmed token (stale on boot, or auth.me still loading) would make
  // requireSession THROW an uncaught ConvexError — and there is NO error boundary,
  // so it white-screens the app. Offline, auth.me never resolves, so we lean on the
  // mirror below (served on TOKEN presence, `args`). Net: the server is never
  // called with an unconfirmed token, yet offline reloads still show mirrored data.
  const live = useQuery(query, confirmed ? args : 'skip') as T[] | undefined;

  // Background mirror: every successful server result refreshes Dexie.
  useEffect(() => {
    if (live === undefined) return; // loading / offline → keep last mirror
    void db.transaction('rw', db[table], async () => {
      // Preserve locally-created (offline) rows tagged `_local` across the refresh.
      // The server result does NOT yet include a queued draft (e.g. a Phase 6.2
      // offline client), so a naive clear()+bulkPut(live) would WIPE it. Read the
      // `_local` rows first and re-put them after the live refresh. No-op for tables
      // with no drafts (products/categories). The sync engine (Phase 6.4) removes a
      // draft only after it is remapped to the real Convex row.
      const all: Array<{ _local?: boolean }> = await (
        db[table] as any
      ).toArray();
      const localRows = all.filter((r) => r._local === true);
      await db[table].clear(); // full refresh (small single-store POS)
      await (db[table] as any).bulkPut(live); // bulkPut upserts by _id
      if (localRows.length > 0) await (db[table] as any).bulkPut(localRows);
    });
  }, [live, table]);

  // Offline fallback only. 'skip' (no session) ⇒ [] so logged-out users see NO data.
  const skipped = args === 'skip';
  const cached = useLiveQuery(
    () => (skipped ? [] : (db[table] as any).toArray()),
    [skipped]
  ) as T[] | undefined;

  return live !== undefined ? live : cached; // Convex-primary; Dexie fills the gap
}
