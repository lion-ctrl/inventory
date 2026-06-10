import { api } from '@convex/_generated/api';
import { useCachedQuery } from './useCachedQuery';
import type { CategoryWithCount, Client, Product, Settings } from '@/types';

// Stable empty array so effects depending on these lists don't re-fire every render.
const EMPTY: never[] = [];

export function useSettingsDoc(): Settings | null | undefined {
  return useCachedQuery(api.settings.get, {}, 'settings');
}

export function useBsRate(): number {
  const s = useSettingsDoc();
  return s?.bsRate ?? 0;
}

export function useProducts(): Product[] {
  return (useCachedQuery(api.products.list, {}, 'products') as Product[] | undefined) ?? EMPTY;
}

export function useCategories(): CategoryWithCount[] {
  return (useCachedQuery(api.categories.list, {}, 'categories') as CategoryWithCount[] | undefined) ?? EMPTY;
}

export function useClients(): Client[] {
  return (useCachedQuery(api.clients.list, {}, 'clients') as Client[] | undefined) ?? EMPTY;
}
