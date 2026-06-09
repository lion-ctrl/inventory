# Porting Conventions — Smart Inventory POS (prototype → Vite + React TS + Convex)

Authoritative contract for everyone porting screens. The prototype lives in `../src/*.jsx`
(plain React 18, window-global modules). The production app lives here (`inventory/`).
**Visual output must be pixel-identical: never rename CSS classes, never reword Spanish copy
(except the explicit whitelist below), never restructure JSX beyond what these rules require.**

Project rules:
- Package manager is **pnpm**. React is **v19** (the prototype's React 18 APIs are all fine).
- Before writing ANY code in `convex/`, read `convex/_generated/ai/guidelines.md` (project
  CLAUDE.md mandate — those rules override training data).
- **No auth package.** Login is a plain `employees` table check: email + 6-digit PIN
  (the "Contraseña" field). Owner/admin assigns PINs in Empleados; `employees.updateSelf`
  lets anyone change their own. PINs validated server-side as exactly 6 digits.

## File map

```
inventory/
  convex/                  schema.ts, permissions.ts, auth.ts, products.ts, categories.ts,
                           clients.ts, employees.ts, sales.ts, heldCarts.ts, settings.ts,
                           seed.ts (permissions.ts is a helper — no exported functions)
  src/
    styles/tokens.css      ported design tokens (do not touch)
    styles/app.css         ported component styles (do not touch)
    lib/rbac.ts            PERMISSIONS, ROLE_LABELS, perms(), can()  ← exists, import it
    types.ts               Product, Client, CartItem, SplitRow, CleanSplit, CompletedSale,
                           SaleItemSnapshot, ClientSnapshot, MethodId, SalesType, pad8 ← exists
    assets/logo-mark.svg   brand mark (import as URL: `import logoUrl from '../assets/logo-mark.svg'`)
    components/            Icon, IconButton, Button, Chip, Input, AppBar, Nav (NavContext/
                           NavLayout/NavSidebar/NavDrawer), BottomBar, Sheet, Banner,
                           Segmented, ConfirmDialog  + index.ts barrel
    state/                 SessionContext, CartContext, useOnline, useCachedQuery, hooks ← exist
    screens/               Login (exists), Dashboard, Sale, Scan, Payment (PaymentSheet+
                           SuccessScreen), Stored, History, Products, Clients, Employees,
                           Profile, Settings
    AppShell.tsx           router + nav + RBAC guard + payment overlay ← exists
    main.tsx               providers + css/font imports ← exists
```

## Mechanical port rules

| Prototype | Port |
|---|---|
| `window.X` globals / `Object.assign(window,...)` footer | ES module `import`/`export` |
| `React.useState` etc. | `import { useState, ... } from 'react'` (or keep `React.` with `import React`) — pick one per file, prefer named imports |
| Mock doc `.id` (`'P-0001'`, `'C-0002'`…) | Convex `._id` |
| Date fields as ISO strings | epoch **ms numbers** (`new Date(x)` still works — keep formatters as-is) |
| `CATALOG`, `CLIENTS`, `EMPLOYEES`, `SALES_HISTORY`, `CATEGORIES` globals | Convex `useQuery` data (see API surface) |
| Product pause flag | `sellable === false` means paused (field `sellable?: boolean`, undefined = sellable) |
| `tweaks` / `useTweaks` / `TweaksPanel` / `demoControls` props | **strip entirely**; `tweaks.salesType` → `settings.salesType`; `tweaks.density` → `'roomy'` literal |
| `class="shell force-mobile"` logic | removed; responsive behavior is pure CSS media queries + `window.innerWidth` checks |
| Lucide CDN `<i data-lucide>` hack | `<Icon name="kebab-name" />` from `components` (registry-based, same prop API) |
| `ds/logo-mark.svg` img src | `logoUrl` import from `src/assets/logo-mark.svg` |
| `alert('… (demo)')` placeholders | keep, **except** receipt printing: `onPrint` → `window.print()` |
| Local array mutations (`setClients(prev => …)`) | Convex mutation call + let `useQuery` reactivity update the UI |

TypeScript: `strict` is on but `noUnusedLocals/Parameters` are off. Type props with small
interfaces or inline types; use `any` pragmatically where prototype shapes are dynamic.
**Never run builds or dev servers yourself** — the orchestrator integrates and typechecks.

## Spanish copy whitelist (the ONLY allowed wording changes)

- Any mention of **ERPNext** → neutral server wording: "el servidor" / label `Servidor` value `Convex`.
- Offline-block dialog: "No se puede registrar la venta sin conexión con el servidor. Conéctate e intenta de nuevo."
- Login failure (new state, no prototype copy existed): `Credenciales inválidas. Verifica e intenta de nuevo.` / inactive: `Usuario inactivo. Contacta al propietario.`
- Settings sync sub when online: `Sincronización en tiempo real` (replaces fake "hace 2 min").

Everything else: byte-identical Spanish copy.

## Foundation components (exact APIs — already match prototype)

```tsx
Icon({ name, size = 22, color, style, ...rest })          // kebab-case lucide name
IconButton({ icon, onClick, ariaLabel, ...rest })
Button({ variant='primary', size, children, icon, onClick, disabled, type='button', block, style })
Chip({ tone='neutral', children, style })
Input({ mono, ...rest })                                   // <input class="input [mono]">
AppBar({ title, sub, left, right, brand, online })
NavContext / NavLayout({ nav, currentRoute, user, online, hidden, children })
BottomBar({ children, className })
Sheet({ onClose, children, dialog, title })                // mobile drag-to-close < 700px
Banner({ tone='info', icon, title, message, action })
Segmented({ options, value, onChange })
ConfirmDialog({ title, message, confirmLabel, cancelLabel='Cancelar', tone='primary', onConfirm, onCancel })
```

Import: `import { Button, Sheet, Icon, ... } from '../components'`.

## Contexts / hooks (`src/state` — already implemented)

```tsx
useSession() → {
  user: Employee | null,            // logged-in employee doc (owner has permissions 'all')
  loading: boolean,                 // true while re-validating a persisted session
  login(email, pin): Promise<{ ok: true } | { ok: false; error: string }>,
  logout(): void,
  can(perm: PermissionId): boolean,
}
useOnline() → boolean               // navigator.onLine, live
useSettingsDoc() → Settings | null | undefined   // cached-while-offline singleton
useBsRate() → number                // settings.bsRate ?? 0
useProducts() / useCategories() / useClients()   // cached-while-offline lists (default [])
useCart() → {
  cart: CartItem[], setCart,
  selectedClient: Client | null, setSelectedClientId(id: Id<'clients'> | null),
  splits: SplitRow[], setSplits, splitsIdRef,         // payment rows persist across pause/resume
  resetPayment(),
  reserved: Record<string, number>,                   // productId → qty reserved by held carts
  heldCarts: HeldCart[],
  pauseSale(note?: string): Promise<void>,
  resumeSale(heldCartId): Promise<void>,              // fills cart+client+splits, deletes held row
  discardStored(heldCartId): Promise<void>,
  completedSale: CompletedSale | null, setCompletedSale,
}
```

Screens take **no data props** (exception: `SaleScreen({ onConfirm })` wired by AppShell):
each screen does its own `useQuery`/`useMutation` (or the cached hooks above) and uses
`useNavigate()` for navigation callbacks (`onBack` → `navigate('/')`, etc.).

## Route table (react-router v7)

| Path | Screen | Guard |
|---|---|---|
| `/login` | Login | public |
| `/` | Dashboard | logged in |
| `/escanear` | Scan | logged in |
| `/venta` | Sale | logged in |
| `/venta/exito` | Success | logged in |
| `/ventas-en-espera` | Stored | logged in |
| `/historial` | History | `view_reports` |
| `/productos` | Products | `manage_products` |
| `/clientes` | Clients | `manage_clients` |
| `/empleados` | Employees | `manage_employees` |
| `/ajustes` | Settings | `manage_settings` |

`void_sales` gates the refund button inside Historial (not a route).

## Convex API surface (implement/consume EXACTLY this)

Q = query, M = mutation. All mutations that need RBAC re-check it server-side via
`convex/permissions.ts` (`requirePerm(ctx, actorId, perm)`) and throw `ConvexError` with a
Spanish message on failure. `actorId` is always the logged-in employee `_id`.

```
auth.login        M {email, pin} → {ok:true, employee} | {ok:false, error}
auth.me           Q {employeeId: string} → Employee | null   (normalizeId server-side; null if stale/missing/inactive — NEVER throws)

products.list     Q {} → Product[]
products.byBarcode Q {barcode} → Product | null
products.create   M {actorId, barcode, sku, name, price, stock, minStock, categoryId, exempt?, glyph?} → Id   [manage_products]
products.update   M {actorId, productId, patch:{barcode?,sku?,name?,price?,stock?,minStock?,categoryId?,exempt?,glyph?,sellable?}} → null   [manage_products]
products.setSellable M {actorId, productId, sellable} → null  [manage_products]
products.adjustStock M {actorId, productId, stock} → null     [manage_products] (absolute, ≥0)
products.remove   M {actorId, productId} → null               [manage_products]

categories.list   Q {} → (Category & {count})[]
categories.create M {actorId, label} → Id                     [manage_products]
categories.update M {actorId, categoryId, label} → null       [manage_products]
categories.removeWithReassign M {actorId, categoryId, reassignToId} → null  [manage_products]

clients.list      Q {} → Client[]
clients.byTaxId   Q {taxPrefix, taxId} → Client | null
clients.create    M {name, taxPrefix, taxId, kind, email?, phone?, address?} → Client   [NO guard — used inline at Venta gate]
clients.update    M {actorId, clientId, patch} → null         [manage_clients]
clients.remove    M {actorId, clientId} → null                [manage_clients]

employees.list    Q {actorId} → Employee[]                    [manage_employees] (excludes actor)
employees.create  M {actorId, name, email, phone, role, permissions, pin, active} → Id  [manage_employees] (pin must be 6 digits)
employees.update  M {actorId, employeeId, patch:{name?,email?,phone?,role?,permissions?,pin?,active?}} → null  [manage_employees] (pin 6 digits)
employees.updateSelf M {actorId, patch:{name?,email?,phone?,pin?}} → null   (pin 6 digits)
employees.remove  M {actorId, employeeId} → null              [manage_employees]

sales.checkout    M {actorId, clientId, items:[{productId, qty}], method, splits:[CleanSplit], type, tendered?} → Sale
                  — validates stock + that splits cover the SERVER-computed total (live prices),
                    atomically consumes settings.nextInvoiceNumber (pad8), decrements stock,
                    snapshots client/items/ivaPct/bsRate, sets soldAt = Date.now()
sales.history     Q {} → Sale[]   (soldAt desc; client+cashierName embedded as snapshots)
sales.refund      M {actorId, saleId, reason} → null          [void_sales] (restores stock, rejects double refund)

heldCarts.list    Q {} → HeldCart[]
heldCarts.park    M {actorId, clientId?, items:[{productId, qty}], splits?, note?} → null
heldCarts.resume  M {actorId, heldCartId} → {client: Client|null, items: SaleItemSnapshot[], splits?} (deletes row)
heldCarts.discard M {actorId, heldCartId} → null

settings.get      Q {} → Settings | null
settings.update   M {actorId, patch:{storeName?,storeRif?,phone?,address?,currency?,taxName?,ivaPct?,bsRate?,salesType?,printAuto?,emailReceipt?,lowStockAlerts?,soundScan?}} → null  [manage_settings]
```

Sale doc fields: `invoiceNumber, clientId, client (ClientSnapshot), cashierId, cashierName,
items (SaleItemSnapshot[]), subtotal, tax, total (USD), method, splits?, tendered?,
type ('invoice'|'ticket'), ivaPct, exchangeRate (Bs/$ snapshot), soldAt (ms),
refund?: {date, reason}`.

HeldCart doc fields: `code ('00001001'…), clientId?, client?, cashierId, items, splits?,
total, note?, createdAt (ms)`.

Settings doc fields: `storeName, storeRif, phone, address, currency, taxName, ivaPct, bsRate,
nextInvoiceNumber, nextHeldCode, salesType, printAuto, emailReceipt, lowStockAlerts, soundScan`.

## Data wiring patterns

```tsx
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';

const sales = useQuery(api.sales.history) ?? [];        // undefined while loading → default []
const update = useMutation(api.products.update);
try { await update({ actorId: user!._id, productId, patch }); }
catch (e: any) { alert(typeof e?.data === 'string' ? e.data : 'Ocurrió un error. Intenta de nuevo.'); }
```

- `ConvexError(message)` surfaces the Spanish message on `e.data` — show it with the screen's
  existing error affordance (Banner inside sheets when one exists, otherwise `alert`).
- For products/categories/clients/settings prefer the cached hooks (`useProducts()` etc.) so
  Escanear/Venta keep working offline.
- Money lives in **USD**; Bs displays multiply by `useBsRate()` live — EXCEPT printed/reprinted
  receipts, which must use the **sale's snapshotted** `exchangeRate` and `ivaPct`.
- Receipt totals math (port from payment.jsx exactly): `subtotal = Σ price·qty`,
  `exemptBase = Σ exempt lines`, `tax = type==='invoice' ? (subtotal−exemptBase)·ivaPct/100 : 0`,
  `total = subtotal + tax`. Receipt shows Bs only, method names via RECEIPT_METHOD_LABEL.
- Loading states: queries return `undefined` while loading — render the screen's empty/zero
  state (no spinners exist in the design; data arrives in ms).

## Hard DON'Ts

- Don't redesign, don't add CSS, don't rename classes, don't change breakpoints.
- Don't add npm dependencies (and never re-add an auth package or Tailwind).
- Don't run builds/typechecks/dev servers (orchestrator does integration).
- Don't edit files owned by another agent (see your prompt's file assignment).
- Don't port `tweaks-panel.jsx`, `force-mobile/desktop`, or demo controls.
