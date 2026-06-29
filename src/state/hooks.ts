import { api } from '@convex/_generated/api';
import { useCachedQuery } from './useCachedQuery';
import { useSession } from './SessionContext';
import type { CategoryWithCount, Client, Product, Settings } from '@/types';

// Stable empty array so effects depending on these lists don't re-fire every render.
const EMPTY: never[] = [];

// settings.get is the ONE intentionally-public query (store branding is read on
// the unauthenticated Login boot path), so it is NOT token-gated. See
// convex/settings.ts for the documented decision.
export function useSettingsDoc(): Settings | null | undefined {
  return useCachedQuery(api.settings.get, {}, 'settings');
}

export function useBsRate(): number {
  const s = useSettingsDoc();
  return s?.bsRate ?? 0;
}

// products/categories/clients are session-gated server-side (internal POS — no
// public endpoints). The acting employee is resolved from the session token, so
// every read must replay it. No session → 'skip' (no server call, no data),
// which is correct: only the login-gated screens render these lists.
export function useProducts(): Product[] {
  const { token } = useSession();
  return (
    (useCachedQuery(
      api.products.list,
      token ? { token } : 'skip',
      'products'
    ) as Product[] | undefined) ?? EMPTY
  );
}

export function useCategories(): CategoryWithCount[] {
  const { token } = useSession();
  return (
    (useCachedQuery(
      api.categories.list,
      token ? { token } : 'skip',
      'categories'
    ) as CategoryWithCount[] | undefined) ?? EMPTY
  );
}

export function useClients(): Client[] {
  const { token } = useSession();
  return (
    (useCachedQuery(
      api.clients.list,
      token ? { token } : 'skip',
      'clients'
    ) as Client[] | undefined) ?? EMPTY
  );
}
