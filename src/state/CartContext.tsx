import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { NEW_SPLIT_ROW } from '@/types';
import type { CartItem, Client, CompletedSale, HeldCart, SplitRow } from '@/types';
import { useSession } from './SessionContext';
import { useClients, useProducts } from './hooks';

interface CartValue {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  selectedClient: Client | null;
  setSelectedClientId: (id: Id<'clients'> | null) => void;
  splits: SplitRow[];
  setSplits: Dispatch<SetStateAction<SplitRow[]>>;
  splitsIdRef: MutableRefObject<number>;
  resetPayment: () => void;
  /** productId → qty reserved by held ("en espera") carts; reduces availability in Venta */
  reserved: Record<string, number>;
  heldCarts: HeldCart[];
  pauseSale: (note?: string) => Promise<void>;
  resumeSale: (heldCartId: Id<'heldCarts'>) => Promise<void>;
  discardStored: (heldCartId: Id<'heldCarts'>) => Promise<void>;
  completedSale: CompletedSale | null;
  setCompletedSale: (s: CompletedSale | null) => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const products = useProducts();
  const clients = useClients();
  const heldCartsQuery = useQuery(api.heldCarts.list, user ? {} : 'skip');
  // Memoized so the `?? []` fallback doesn't invalidate downstream memo deps every render.
  const heldCarts = useMemo<HeldCart[]>(() => heldCartsQuery ?? [], [heldCartsQuery]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<Id<'clients'> | null>(null);
  const [splits, setSplits] = useState<SplitRow[]>(NEW_SPLIT_ROW());
  const splitsIdRef = useRef(2);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);

  const park = useMutation(api.heldCarts.park);
  const resume = useMutation(api.heldCarts.resume);
  const discard = useMutation(api.heldCarts.discard);

  // Port of the prototype's setProductsAndSyncCart: when products change, refresh the
  // cart snapshots and drop lines that became unsellable (paused) or were removed.
  useEffect(() => {
    if (products.length === 0) return;
    const byId = new Map(products.map((p) => [p._id, p]));
    setCart((c) => {
      const next: CartItem[] = [];
      let changed = false;
      for (const item of c) {
        const live = byId.get(item._id);
        if (!live || live.sellable === false) {
          changed = true;
          continue;
        }
        next.push({ ...live, qty: item.qty });
        if (live !== (item as unknown)) changed = true;
      }
      return changed || next.length !== c.length ? next : c;
    });
  }, [products]);

  const reserved = useMemo(() => {
    const m: Record<string, number> = {};
    for (const held of heldCarts) {
      for (const it of held.items ?? []) {
        m[it.productId] = (m[it.productId] || 0) + it.qty;
      }
    }
    return m;
  }, [heldCarts]);

  const selectedClient = useMemo(
    () => clients.find((c) => c._id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const value = useMemo<CartValue>(() => {
    const resetPayment = () => {
      setSplits(NEW_SPLIT_ROW());
      splitsIdRef.current = 2;
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
      reserved,
      heldCarts,
      completedSale,
      setCompletedSale,
      pauseSale: async (note?: string) => {
        if (cart.length === 0 || !user) return;
        const cleanSplits = splits
          .filter((r) => parseFloat(r.amount) > 0)
          .map((r) => ({ method: r.method, amount: parseFloat(r.amount) || 0 }));
        await park({
          actorId: user._id,
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
        if (!user) return;
        const res = await resume({ actorId: user._id, heldCartId });
        const byId = new Map(products.map((p) => [p._id, p]));
        const items: CartItem[] = [];
        for (const it of res.items ?? []) {
          const live = byId.get(it.productId);
          if (live && live.sellable !== false) items.push({ ...live, qty: it.qty });
        }
        setCart(items);
        setSelectedClientId((res.client?._id) ?? null);
        const restored = (res.splits ?? []) as { method: string; amount: number }[];
        if (restored.length > 0) {
          setSplits(
            restored.map((s, i) => ({
              id: i + 1,
              method: s.method,
              amount: s.amount > 0 ? String(s.amount) : '',
            })),
          );
          splitsIdRef.current = restored.length + 1;
        } else {
          resetPayment();
        }
      },
      discardStored: async (heldCartId: Id<'heldCarts'>) => {
        if (!user) return;
        await discard({ actorId: user._id, heldCartId });
      },
    };
  }, [cart, selectedClient, selectedClientId, splits, reserved, heldCarts, completedSale, user, products, park, resume, discard]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
