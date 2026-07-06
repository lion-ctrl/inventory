// Toast — non-blocking in-app notifications that replace native browser alert()s
// (owner directive: no OS/browser dialogs). A single ToastProvider (mounted in
// main.tsx) exposes `useToast()` → { error, success, info }; each call drops a
// self-dismissing card into a fixed bottom-center viewport (portaled to <body>).
// useToast returns a NO-OP when no provider is mounted, so component tests that
// render a screen without wrapping it never crash — toasts are simply silent.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type ToastTone = 'error' | 'success' | 'info';

export interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 4500;

const TONE: Record<ToastTone, { bg: string; fg: string; icon: string }> = {
  error: { bg: 'var(--danger-soft)', fg: 'var(--danger)', icon: 'alert-triangle' },
  success: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', icon: 'check-circle' },
  info: { bg: 'var(--info-soft)', fg: 'var(--info)', icon: 'info' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = (idRef.current += 1); // monotonic id (no Date.now / Math.random)
    setToasts((list) => [...list, { id, tone, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      error: (m) => push('error', m),
      success: (m) => push('success', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <ToastViewport toasts={toasts} onDismiss={dismiss} />,
          document.body
        )}
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 3000,
        pointerEvents: 'none',
        padding: '0 16px',
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const t = TONE[toast.tone];
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 480,
        background: t.bg,
        borderRadius: 'var(--r-lg)',
        padding: '12px 14px',
        boxShadow: 'var(--shadow-3)',
        font: '500 14px var(--font-sans)',
        color: 'var(--ink)',
      }}
    >
      <Icon name={t.icon} size={18} color={t.fg} />
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="cerrar"
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'inline-flex',
          padding: 2,
          color: 'var(--ink-3)',
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

const NOOP: ToastApi = {
  error: () => {},
  success: () => {},
  info: () => {},
};

/** Access the toast API. Returns a no-op when no ToastProvider is mounted (so a
 *  screen rendered bare in a test never throws — its toasts are simply silent). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
