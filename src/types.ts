// App-level types shared by screens, contexts and components.
// Convex docs are the source of truth; these aliases keep ports 1:1 readable.
import type { Doc, Id } from '@convex/_generated/dataModel';

export type Product = Doc<'products'>;
export type Category = Doc<'categories'>;
export type Client = Doc<'clients'>;
// Employees / sales / held carts reach the client as PUBLIC projections: the PIN
// hashing material (pinHash/pinSalt — AUTH-4) and the cashierId credential
// surface (AUTH-2) never leave the server. These aliases mirror auth.me,
// employees.list, sales.history and heldCarts.list so call sites stay 1:1.
export type Employee = Omit<Doc<'employees'>, 'pinHash' | 'pinSalt'>;
export type Sale = Omit<Doc<'sales'>, 'cashierId'>;
export type HeldCart = Omit<Doc<'heldCarts'>, 'cashierId'>;
export type Settings = Doc<'settings'>;

export type CategoryWithCount = Category & { count: number };

/** Cart line = live product snapshot + qty (prototype kept `{...product, qty}`). */
export type CartItem = Product & { qty: number };

export type MethodId =
  | 'cash'
  | 'cash_bs'
  | 'card'
  | 'transfer'
  | 'mobile'
  | 'zelle';

/** Editable split row as typed in the PaymentSheet (amount is the raw input string). */
export interface SplitRow {
  id: number;
  /** One of MethodId — typed as string because rows round-trip through <select>/storage. */
  method: string;
  amount: string;
}

/** Normalized split sent to checkout / stored on the sale (amount in USD). */
export interface CleanSplit {
  method: string;
  amount: number;
  entered?: number;
  currency?: string;
}

/** Snapshot of a sold line as stored inside sales.items / heldCarts.items. */
export interface SaleItemSnapshot {
  productId: Id<'products'>;
  name: string;
  sku?: string;
  barcode?: string;
  cat?: string;
  price: number;
  qty: number;
  glyph?: string;
  exempt?: boolean;
}

/** Snapshot of the client embedded on a sale / held cart. */
export interface ClientSnapshot {
  name: string;
  taxPrefix: string;
  taxId: string;
  kind?: string;
  email?: string;
  phone?: string;
  address?: string;
}

/** What the Success screen receives after checkout (mirrors prototype completedSale). */
export interface CompletedSale {
  /** Server invoice # once minted; null while a synced-offline sale awaits it (§6.5). */
  invoice: string | null;
  /** true when the sale was queued OFFLINE and is awaiting sync (PENDING_SYNC, §6.5). */
  pendingSync?: boolean;
  total: number;
  items: SaleItemSnapshot[];
  method: string;
  tendered?: number;
  splits: CleanSplit[] | null;
  client: ClientSnapshot | null;
  ivaPct: number;
  exchangeRate: number;
}

export const NEW_SPLIT_ROW = (): SplitRow[] => [
  { id: 1, method: 'cash', amount: '' },
];

export const pad8 = (n: number | string) => String(n).padStart(8, '0');
