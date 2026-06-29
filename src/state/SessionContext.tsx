import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { Employee } from '@/types';
import { can as rbacCan } from '@/lib/rbac';
import type { PermissionId } from '@/lib/rbac';

// AUTH-5: the bearer credential is the SESSION TOKEN minted by auth.login. The
// client persists ONLY the token (+ its idle deadline) — never the employee id;
// the acting employee is resolved from the token on boot via auth.me.
const TOKEN_KEY = 'pos.sessionToken';
const EXPIRES_KEY = 'pos.sessionExpiresAt';
// Pre-AUTH-5 builds persisted the acting employee id here. It is no longer read,
// but must be wiped on boot (see the mount effect below) so a stale id can never
// linger in storage.
const LEGACY_EMPLOYEE_KEY = 'pos.employeeId';

// AUTH-6 (client half): slide the idle window ~5 min before it lapses, but ONLY
// when the cashier was actually active since the last renew — an unconditional
// timer would defeat the server's idle expiry. The idle TTL is 2 h, so a
// 30 s heartbeat is plenty granular.
const RENEW_LEAD_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
] as const;

export type LoginResult = { ok: true } | { ok: false; error: string };

interface SessionValue {
  user: Employee | null;
  /** The raw session token replayed on every privileged call (null = logged out). */
  token: string | null;
  /** true while a persisted token is being re-validated on boot */
  loading: boolean;
  login: (email: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
  can: (perm: PermissionId) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    readStored(TOKEN_KEY)
  );
  const [expiresAt, setExpiresAt] = useState<number | null>(() => {
    const raw = readStored(EXPIRES_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // Real user activity + last successful renew, tracked via refs so the
  // heartbeat reads the latest values without re-subscribing. Seeded to a real
  // timestamp in the mount effect below — Date.now() is impure and must not run
  // in the render-time useRef initializer (react-hooks/purity).
  const lastActivityRef = useRef<number>(0);
  const lastRenewRef = useRef<number>(0);

  // Boot revalidation: auth.me resolves the persisted token to its employee
  // (public projection) or null when the token is stale/expired/revoked.
  const me = useQuery(api.auth.me, token ? { token } : 'skip');
  const loginMut = useMutation(api.auth.login);
  const logoutMut = useMutation(api.auth.logout);
  const renewMut = useMutation(api.auth.renewSession);

  const persistSession = useCallback((tok: string, exp: number) => {
    try {
      localStorage.setItem(TOKEN_KEY, tok);
      localStorage.setItem(EXPIRES_KEY, String(exp));
    } catch {
      /* ignore */
    }
    // A fresh token (login) or a renew resets the activity/renew baseline.
    lastActivityRef.current = Date.now();
    lastRenewRef.current = Date.now();
    setToken(tok);
    setExpiresAt(exp);
  }, []);

  const clearLocalSession = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRES_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setExpiresAt(null);
  }, []);

  // One-time boot effect: wipe the legacy pre-AUTH-5 employee-id key and seed the
  // activity/renew baseline. Date.now() is impure, so it runs here rather than in
  // the useRef initializer (which re-evaluates every render — react-hooks/purity).
  // The refs are only read by the activity and heartbeat effects, which fire
  // after mount, so the 0 placeholder before this runs is never observed by the
  // renew gate (first tick is 30 s out).
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_EMPLOYEE_KEY);
    } catch {
      /* ignore */
    }
    const now = Date.now();
    lastActivityRef.current = now;
    lastRenewRef.current = now;
  }, []);

  // Token resolved to null (revoked / expired / inactive employee) → drop it.
  useEffect(() => {
    if (token && me === null) clearLocalSession();
  }, [token, me, clearLocalSession]);

  // Track real activity so the renew can be gated on it.
  useEffect(() => {
    if (!token) return;
    const mark = () => {
      lastActivityRef.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS)
      document.addEventListener(ev, mark, { passive: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) document.removeEventListener(ev, mark);
    };
  }, [token]);

  // AUTH-6 proactive refresh heartbeat. Re-subscribes whenever the deadline
  // moves (a successful renew bumps expiresAt, restarting the window).
  useEffect(() => {
    if (!token || expiresAt === null) return;
    let cancelled = false;

    const tick = async () => {
      const remaining = expiresAt - Date.now();
      // Past the idle deadline → the session has lapsed; drop it locally.
      // if (remaining <= 0) {
      //   clearLocalSession();
      //   return;
      // }
      // Not yet near the deadline → nothing to do.
      if (remaining > RENEW_LEAD_MS) return;
      // Within the lead window: renew ONLY if the cashier was active since the
      // last renew. No activity → let it lapse (idle expiry is the whole point).
      if (lastActivityRef.current <= lastRenewRef.current) return;
      try {
        const res = await renewMut({ token });
        if (cancelled) return;
        if (res.ok) {
          // persistSession resets the activity/renew baseline to "now".
          persistSession(token, res.expiresAt);
        } else {
          clearLocalSession();
        }
      } catch {
        /* transient network error — retry on the next heartbeat */
      }
    };

    const id = setInterval(() => void tick(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, expiresAt, renewMut, persistSession, clearLocalSession]);

  const login = useCallback(
    async (email: string, pin: string): Promise<LoginResult> => {
      try {
        const res = await loginMut({ email, pin });
        if (res.ok) {
          persistSession(res.token, res.expiresAt);
          return { ok: true };
        }
        return { ok: false, error: res.error };
      } catch {
        return {
          ok: false,
          error: 'Sin conexión con el servidor. Intenta de nuevo.',
        };
      }
    },
    [loginMut, persistSession]
  );

  const logout = useCallback(() => {
    // Drop local state immediately (instant UI logout), then revoke server-side.
    const current = token;
    clearLocalSession();
    if (current) {
      void logoutMut({ token: current }).catch(() => {
        /* already cleared locally; nothing else to do */
      });
    }
  }, [token, logoutMut, clearLocalSession]);

  const user = (token ? me : null) ?? null;

  const value = useMemo<SessionValue>(
    () => ({
      user,
      token,
      loading: !!token && me === undefined,
      login,
      logout,
      can: (perm: PermissionId) => rbacCan(user, perm),
    }),
    [user, token, me, login, logout]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export type { Id };
