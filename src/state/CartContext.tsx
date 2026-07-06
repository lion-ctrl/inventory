import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Dispatch,
  MutableRefObject,
  ReactNode,
  SetStateAction,
} from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { NEW_SPLIT_ROW } from '@/types';
import type {
  CartItem,
  Client,
  CompletedSale,
  HeldCart,
  Product,
  SplitRow,
} from '@/types';
import { useSession } from './SessionContext';
import { useClients, useProducts } from './hooks';
import { db } from './db';

/**
 * A cart line reconciled against LIVE stock: 'gone' — sold out, so the line was
 * dropped; 'reduced' — only `left` units remain, so the line was clamped to
 * `left`. Surfaced whenever stock drops under a cart — on RESUME (a parked cart
 * reserves nothing) OR live, while a cashier holds a line another cashier sells.
 */
interface StockAdjustment {
  name: string;
  kind: 'gone' | 'reduced';
  left: number;
}

interface CartValue {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  selectedClient: Client | null;
  setSelectedClientId: (id: Id<'clients'> | null) => void;
  splits: SplitRow[];
  setSplits: Dispatch<SetStateAction<SplitRow[]>>;
  splitsIdRef: MutableRefObject<number>;
  resetPayment: () => void;
  /** Discard the whole in-progress sale: cart + payment splits + selected client. */
  discardSale: () => void;
  heldCarts: HeldCart[];
  pauseSale: (note?: string) => Promise<void>;
  resumeSale: (heldCartId: Id<'heldCarts'>) => Promise<void>;
  discardStored: (heldCartId: Id<'heldCarts'>) => Promise<void>;
  completedSale: CompletedSale | null;
  setCompletedSale: (s: CompletedSale | null) => void;
  /** Names of cart lines auto-removed because their product was paused (live or on resume). */
  pausedRemovals: string[];
  /** Clear the paused-removal notice once the cashier has acknowledged it. */
  dismissPausedRemovals: () => void;
  /** Lines reconciled against live stock on resume: dropped (sold out) or clamped. */
  stockAdjustments: StockAdjustment[];
  /** Clear the stock-adjustment notice once the cashier has acknowledged it. */
  dismissStockAdjustments: () => void;
}

const CartContext = createContext<CartValue | null>(null);

/**
 * Reconcile cart lines against LIVE products. Drops deleted lines silently and
 * paused lines by name (→ pausedNames); against live stock DROPS sold-out lines
 * ('gone') and CLAMPS reduced ones ('reduced', to what's left) — both surfaced as
 * StockAdjustments. Surviving lines get a fresh product snapshot. SHARED by the
 * products-sync effect (active cart) and resumeSale (held cart) so both self-heal
 * identically: a cashier can never hold more units than physically exist.
 */
function reconcileLinesAgainstLive(
  lines: { id: string; qty: number }[],
  products: Product[]
): { items: CartItem[]; pausedNames: string[]; adjustments: StockAdjustment[] } {
  const byId = new Map<string, Product>(
    products.map((p): [string, Product] => [p._id, p])
  );
  const items: CartItem[] = [];
  const pausedNames: string[] = [];
  const adjustments: StockAdjustment[] = [];
  for (const line of lines) {
    const live = byId.get(line.id);
    if (!live) continue; // deleted — drop silently
    if (live.sellable === false) {
      pausedNames.push(live.name); // paused — drop AND notify by name
      continue;
    }
    if (live.stock <= 0) {
      adjustments.push({ name: live.name, kind: 'gone', left: 0 });
      continue; // sold out now — drop the line
    }
    if (live.stock < line.qty) {
      adjustments.push({ name: live.name, kind: 'reduced', left: live.stock });
      items.push({ ...live, qty: live.stock }); // clamp to what's left
      continue;
    }
    items.push({ ...live, qty: line.qty }); // fine — refresh snapshot, keep qty
  }
  return { items, pausedNames, adjustments };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { token, user } = useSession();
  const products = useProducts();
  const clients = useClients();
  // Server read only with a CONFIRMED session — an unconfirmed/stale token throws
  // in requireSession (no error boundary → white screen). heldCarts has no offline
  // mirror yet, so it simply stays empty until the session is confirmed.
  const heldCartsQuery = useQuery(
    api.heldCarts.list,
    user && token ? { token } : 'skip'
  );
  // Memoized so the `?? []` fallback doesn't invalidate downstream memo deps every render.
  const heldCarts = useMemo<HeldCart[]>(
    () => heldCartsQuery ?? [],
    [heldCartsQuery]
  );

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClientId, setSelectedClientId] =
    useState<Id<'clients'> | null>(null);
  const [splits, setSplits] = useState<SplitRow[]>(NEW_SPLIT_ROW());
  const splitsIdRef = useRef(2);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(
    null
  );
  // Names of lines auto-dropped because their product was paused (sellable ===
  // false) server-side. Two feeds: (1) the live active-cart sync below, and
  // (2) resumeSale dropping paused lines from a resumed held cart. Surfaced as a
  // single Venta acknowledge MODAL; an external event, so it is recorded — never
  // confirmed.
  const [pausedRemovals, setPausedRemovals] = useState<string[]>([]);
  // Phase 5 (reserved removal) — lines reconciled against LIVE stock when a held
  // cart is RESUMED. Holds no longer reserve stock, so the parked units may have
  // been sold meanwhile; surfaced as a Venta acknowledge MODAL, sibling of
  // pausedRemovals (recorded, never confirmed).
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>(
    []
  );

  const park = useMutation(api.heldCarts.park);
  const resume = useMutation(api.heldCarts.resume);
  const discard = useMutation(api.heldCarts.discard);

  // Mirror the latest cart into a ref so the products-driven sync can diff
  // against it without re-firing on every cart edit (deps stay [products]) and
  // without doing impure work inside the setCart updater.
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Phase 6.1 — persistent cart. The in-progress sale (cart + selected client +
  // payment splits + next split id) lives in React state and would die on reload;
  // write it through to the durable `cartDraft` singleton on every change and
  // hydrate it once on mount. `hydratedRef` gates the write-through so the initial
  // empty state never clobbers a saved draft, and — with the fixed 'active' key
  // making `put` an idempotent upsert — keeps StrictMode's double-invoked effects
  // (main.tsx) safe. A restored draft self-heals against live products through the
  // reconciliation effect below (deleted/paused lines pruned), so no extra work here.
  const hydratedRef = useRef(false);
  useEffect(() => {
    // 1) Hydrate ONCE, before any write-through.
    void (async () => {
      const draft = await db.cartDraft.get('active');
      if (draft) {
        setCart(draft.cart);
        setSelectedClientId(draft.selectedClientId);
        setSplits(draft.splits);
        splitsIdRef.current = draft.splitsNextId;
      }
      hydratedRef.current = true;
    })();
  }, []);
  useEffect(() => {
    // 2) Write-through on every mutation, guarded until hydration has run.
    if (!hydratedRef.current) return; // don't clobber the saved draft with []
    void db.cartDraft.put({
      id: 'active',
      cart,
      selectedClientId,
      splits,
      splitsNextId: splitsIdRef.current,
      updatedAt: Date.now(),
    });
  }, [cart, selectedClientId, splits]);

  // Port of the prototype's setProductsAndSyncCart, extended to reconcile against
  // LIVE stock: when products change, refresh each cart snapshot and drop
  // deleted/paused/sold-out lines + clamp reduced ones — the active-cart sibling
  // of resumeSale. Paused removals and stock changes are surfaced so the last
  // cashier holding a just-sold product is told "ya no hay" (via the acknowledge
  // modal) instead of being allowed to oversell it.
  useEffect(() => {
    if (products.length === 0) return;
    const current = cartRef.current;
    if (current.length === 0) return;
    const { items, pausedNames, adjustments } = reconcileLinesAgainstLive(
      current.map((it) => ({ id: it._id, qty: it.qty })),
      products
    );
    setCart(items);
    if (pausedNames.length > 0)
      setPausedRemovals((prev) => [...prev, ...pausedNames]);
    if (adjustments.length > 0)
      setStockAdjustments((prev) => [...prev, ...adjustments]);
  }, [products]);

  const selectedClient = useMemo(
    () => clients.find((c) => c._id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  const value = useMemo<CartValue>(() => {
    const resetPayment = () => {
      setSplits(NEW_SPLIT_ROW());
      splitsIdRef.current = 2;
    };
    // Canonical "throw the sale away" used by every cancel/close path so they
    // all agree: empties the cart, resets payment splits, and detaches the
    // client — guaranteeing the next Venta visit re-shows the ClientGate.
    const discardSale = () => {
      setCart([]);
      setSelectedClientId(null);
      resetPayment();
      void db.cartDraft.delete('active'); // drop the persisted draft (Phase 6.1)
    };
    return {
      cart,
      setCart,
      selectedClient,
      setSelectedClientId,
      splits,
      setSplits,
      splitsIdRef,
      resetPayment,
      discardSale,
      heldCarts,
      completedSale,
      setCompletedSale,
      pausedRemovals,
      dismissPausedRemovals: () => setPausedRemovals([]),
      stockAdjustments,
      dismissStockAdjustments: () => setStockAdjustments([]),
      pauseSale: async (note?: string) => {
        if (cart.length === 0 || !token) return;
        const cleanSplits = splits
          .filter((r) => parseFloat(r.amount) > 0)
          .map((r) => ({
            method: r.method,
            amount: parseFloat(r.amount) || 0,
          }));
        await park({
          token,
          clientId: selectedClientId ?? undefined,
          items: cart.map((i) => ({ productId: i._id, qty: i.qty })),
          splits: cleanSplits.length > 0 ? cleanSplits : undefined,
          note: note || undefined,
        });
        setCart([]);
        setSelectedClientId(null);
        resetPayment();
      },
      resumeSale: async (heldCartId: Id<'heldCarts'>) => {
        if (!token) return;
        const res = await resume({ token, heldCartId });
        // Reconcile the resumed lines against LIVE data — same self-healing as the
        // active-cart products-sync effect: drop deleted/paused/sold-out, clamp
        // reduced. A parked cart reserves nothing, so its units may already be gone.
        const { items, pausedNames, adjustments } = reconcileLinesAgainstLive(
          (res.items ?? []).map((it) => ({ id: it.productId, qty: it.qty })),
          products
        );
        setCart(items);
        if (pausedNames.length > 0)
          setPausedRemovals((prev) => [...prev, ...pausedNames]);
        if (adjustments.length > 0)
          setStockAdjustments((prev) => [...prev, ...adjustments]);
        setSelectedClientId(res.client?._id ?? null);
        const restored = (res.splits ?? []) as {
          method: string;
          amount: number;
        }[];
        if (restored.length > 0) {
          setSplits(
            restored.map((s, i) => ({
              id: i + 1,
              method: s.method,
              amount: s.amount > 0 ? String(s.amount) : '',
            }))
          );
          splitsIdRef.current = restored.length + 1;
        } else {
          resetPayment();
        }
      },
      discardStored: async (heldCartId: Id<'heldCarts'>) => {
        if (!token) return;
        await discard({ token, heldCartId });
      },
    };
  }, [
    cart,
    selectedClient,
    selectedClientId,
    splits,
    heldCarts,
    completedSale,
    pausedRemovals,
    stockAdjustments,
    token,
    products,
    park,
    resume,
    discard,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
