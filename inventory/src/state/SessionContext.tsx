import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { Employee } from '@/types';
import { can as rbacCan } from '@/lib/rbac';
import type { PermissionId } from '@/lib/rbac';

const STORAGE_KEY = 'pos.employeeId';

export type LoginResult = { ok: true } | { ok: false; error: string };

interface SessionValue {
  user: Employee | null;
  /** true while a persisted session is being re-validated on boot */
  loading: boolean;
  login: (email: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
  can: (perm: PermissionId) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [employeeId, setEmployeeId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // auth.me takes a plain string and normalizes server-side, so a stale id from an
  // older deployment resolves to null instead of throwing.
  const me = useQuery(api.auth.me, employeeId ? { employeeId } : 'skip') as
    | Employee
    | null
    | undefined;
  const loginMut = useMutation(api.auth.login);

  // Persisted session no longer valid (deleted/deactivated employee) → clear it.
  useEffect(() => {
    if (employeeId && me === null) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      setEmployeeId(null);
    }
  }, [employeeId, me]);

  const value = useMemo<SessionValue>(() => {
    const user = (employeeId ? me : null) ?? null;
    return {
      user,
      loading: !!employeeId && me === undefined,
      login: async (email: string, pin: string) => {
        try {
          const res = await loginMut({ email, pin });
          if (res.ok) {
            try {
              localStorage.setItem(STORAGE_KEY, res.employee._id);
            } catch {
              /* ignore */
            }
            setEmployeeId(res.employee._id);
            return { ok: true };
          }
          return { ok: false, error: res.error };
        } catch {
          return { ok: false, error: 'Sin conexión con el servidor. Intenta de nuevo.' };
        }
      },
      logout: () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setEmployeeId(null);
      },
      can: (perm: PermissionId) => rbacCan(user, perm),
    };
  }, [employeeId, me, loginMut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export type { Id };
