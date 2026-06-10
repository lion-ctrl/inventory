import { useEffect, useMemo } from 'react';
import { useQuery } from 'convex/react';

const PREFIX = 'posCache.';

/**
 * useQuery that mirrors its last successful result to localStorage and serves the
 * cached copy while the live result is unavailable (offline PWA reloads).
 * Cached docs are plain JSON — ids remain valid strings.
 */
export function useCachedQuery(query: any, args: any, cacheKey: string): any {
  const live = useQuery(query, args);
  useEffect(() => {
    if (live !== undefined) {
      try {
        localStorage.setItem(PREFIX + cacheKey, JSON.stringify(live));
      } catch {
        /* storage full/unavailable — cache is best-effort */
      }
    }
  }, [live, cacheKey]);
  const cached = useMemo(() => {
    if (live !== undefined) return undefined;
    try {
      const raw = localStorage.getItem(PREFIX + cacheKey);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }, [live, cacheKey]);
  return live !== undefined ? live : cached;
}
