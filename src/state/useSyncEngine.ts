// Phase 6.4 — mount-time wiring for the sync engine.
//
// The engine core (`sync.ts`) is a framework-agnostic module singleton, but a
// Convex mutation can only be obtained through the `useMutation` hook. This hook
// injects the bound runners + the live session token into the singleton and fires
// the AUTOMATIC triggers: app start (mount) and the browser `online` event. The
// "new op enqueued" trigger fires from `enqueuePendingOp` itself (see pendingOps.ts,
// which calls `requestSync`). A manual "Sync now" button is a later phase.
//
// Mounted once, high in the tree (AppShell), inside ConvexProvider + SessionProvider.
import { useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useSession } from './SessionContext';
import { configureSyncEngine, runSync } from './sync';

export function useSyncEngine(): void {
  const { token } = useSession();
  const createClientMut = useMutation(api.clients.create);
  const syncSaleMut = useMutation(api.sales.syncOffline);

  useEffect(() => {
    // Re-inject whenever the token or a bound mutation identity changes so the
    // engine's getToken() always reflects the current session.
    configureSyncEngine({
      createClient: (args) => createClientMut(args),
      syncSale: (args) => syncSaleMut(args),
      getToken: () => token,
    });

    // App-start + post-login drain. runSync is a no-op when logged out (no token)
    // or when the queue is empty and is single-flight guarded, so firing it
    // unconditionally — including on every reconnect — is safe.
    void runSync();

    const onOnline = () => void runSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [createClientMut, syncSaleMut, token]);
}
