# Implementation Plan — Smart Inventory POS → React PWA + Vite + Convex

This is the step-by-step build plan. Follow it in order. The `README.md` describes WHAT the design is; this file describes exactly HOW to implement it. The HTML prototype in this bundle is the source of truth for look & behavior — when in doubt, open it and compare.

---

## 0. Ground rules

- **Do not redesign anything.** All visuals, copy (Spanish), spacing, and breakpoints are final. Port `ds/colors_and_type.css` and `styles.css` as-is; do not rewrite them in Tailwind or CSS-in-JS.
- The prototype's JSX is real React 18 — reuse its component structure and logic. The work is: ES modules, real routing, Convex data layer, PWA shell.
- Keep ALL business rules listed in README §"Domain Rules". They were iterated heavily with the owner.
- `tweaks-panel.jsx` and the `force-mobile`/`force-desktop` shell classes are prototype-only tooling. **Do not port them.** Strip any `tweaks`/`useTweaks` references from app.jsx while porting.

## 1. Project setup

```bash
npm create vite@latest smart-pos -- --template react-ts
cd smart-pos
npm i convex lucide-react
npm i -D vite-plugin-pwa
npx convex dev   # creates convex/ folder
```

- TypeScript recommended (the prototype is JS; typing as you port is the cheapest time to do it).
- Configure `vite-plugin-pwa` with `registerType: 'autoUpdate'`, a manifest (name "Inventory POS", display `standalone`, theme color `#1F8A5B`, background `#F7F4EE`), and icons.
- Routing: `react-router-dom` v6. The prototype uses a `route` state string in `app.jsx` — map each value to a path (see §4).

## 2. Target file structure

```
src/
  styles/
    tokens.css          ← ds/colors_and_type.css verbatim
    app.css             ← styles.css verbatim
  components/           ← from primitives.jsx, one file per component
    Button.tsx  IconButton.tsx  Chip.tsx  Input.tsx  Sheet.tsx
    AppBar.tsx  Pagination.tsx  EmptyState.tsx  Toast.tsx  Icon.tsx ...
  lib/
    rbac.ts             ← can(), PERMISSIONS, ROLE_LABELS  (from data.jsx)
    money.ts            ← USD/Bs formatters, exchange helpers (from data.jsx)
    dates.ts            ← Spanish date/time formatters (from data.jsx)
  screens/
    Login.tsx  Dashboard.tsx  Sale.tsx  Scan.tsx  Payment.tsx
    Stored.tsx  History.tsx  Products.tsx  Clients.tsx
    Employees.tsx  Profile.tsx  Settings.tsx
  AppShell.tsx          ← from app.jsx (sidebar/drawer, guard, online state)
  main.tsx
convex/
  schema.ts
  products.ts  categories.ts  clients.ts  employees.ts
  sales.ts  heldCarts.ts  settings.ts  auth.ts
```

Porting mechanics per screen file: delete the `Object.assign(window, {...})` footer, add `import`/`export`, replace `window.X` references with imports, replace data globals (`CATALOG`, `CLIENTS`, …) with Convex hooks.

## 3. CSS port

1. Copy both CSS files verbatim. Import order in `main.tsx`: `tokens.css` then `app.css`.
2. Keep the Google Fonts `@import` (Inter, JetBrains Mono, Fraunces) or self-host for the PWA (preferred: `@fontsource` packages, since offline matters).
3. Keep the scrollbar rules exactly — they hide Edge's scrollbar arrow buttons, which the owner explicitly requested.
4. Delete only the `.force-mobile` / `.force-desktop` blocks (tweaks tooling).

## 4. Routes & RBAC guard

| Prototype `route` value | Path                          | Permission required        |
| ----------------------- | ----------------------------- | -------------------------- |
| `dashboard`             | `/`                           | none (any logged-in user)  |
| `scan`                  | `/escanear`                   | none                       |
| `sale`                  | `/venta`                      | none                       |
| `payment`, `success`    | `/venta/pago`, `/venta/exito` | none (reached from /venta) |
| `stored`                | `/ventas-en-espera`           | none                       |
| `history`               | `/historial`                  | `view_reports`             |
| `products`              | `/productos`                  | `manage_products`          |
| `clients`               | `/clientes`                   | `manage_clients`           |
| `employees`             | `/empleados`                  | `manage_employees`         |
| `profile`               | `/perfil`                     | none                       |
| `settings`              | `/ajustes`                    | `manage_settings`          |
| `login`                 | `/login`                      | public                     |

- Guard = the `ROUTE_PERMS` + redirect-to-dashboard effect in `app.jsx`; reimplement as a `<RequirePerm>` wrapper. Sidebar items are ALSO filtered by the same `can()` — both must stay in sync (share the table above).
- `void_sales` (Reembolsar ventas) gates the refund button inside Historial, not a route.
- Menu order (final): Inicio, Escanear, Venta, Ventas en espera, Historial, Productos, Clientes, Empleados, Ajustes, Mi perfil, Cerrar sesión.

## 5. Convex schema (`convex/schema.ts`)

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const permissions = v.object({
  view_reports: v.boolean(),
  void_sales: v.boolean(),
  manage_products: v.boolean(),
  manage_clients: v.boolean(),
  manage_employees: v.boolean(),
  manage_settings: v.boolean(),
});

export default defineSchema({
  categories: defineTable({
    label: v.string(),
  }),

  products: defineTable({
    barcode: v.string(), // EAN-13 etc. — scanner matches on this
    sku: v.string(),
    name: v.string(),
    priceUsd: v.number(), // catalog prices are USD
    stock: v.number(),
    minStock: v.number(), // low-stock threshold (chip "N EN STOCK")
    categoryId: v.id('categories'),
    paused: v.boolean(), // hidden from Venta, visible in Escanear
    exempt: v.boolean(), // Exento de IVA
    glyph: v.optional(v.string()), // emoji placeholder until real images
  })
    .index('by_barcode', ['barcode'])
    .index('by_category', ['categoryId']),

  clients: defineTable({
    name: v.string(),
    taxPrefix: v.union(v.literal('V'), v.literal('J')), // cédula | RIF
    taxId: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
  }).index('by_taxId', ['taxPrefix', 'taxId']),

  employees: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('cajero')),
    permissions, // EVERY role is individually limitable
    pin: v.string(), // 6 digits — hash in production
    active: v.boolean(),
  }),

  sales: defineTable({
    invoiceNumber: v.string(), // "00000001" — 8-digit zero-padded
    clientId: v.id('clients'), // sales ALWAYS have a client
    cashierId: v.id('employees'),
    items: v.array(
      v.object({
        productId: v.id('products'),
        name: v.string(), // snapshot at sale time
        unitPriceUsd: v.number(), // snapshot
        qty: v.number(),
        exempt: v.boolean(), // snapshot
      })
    ),
    exchangeRate: v.number(), // Bs per USD at sale time (snapshot!)
    ivaPct: v.number(), // snapshot
    payments: v.array(
      v.object({
        // split payments
        method: v.union(
          v.literal('cash_usd'),
          v.literal('cash_bs'),
          v.literal('card'),
          v.literal('pago_movil'),
          v.literal('zelle'),
          v.literal('transfer')
        ),
        amountUsd: v.number(),
      })
    ),
    refund: v.optional(v.object({ date: v.number(), reason: v.string() })),
  }).index('by_invoice', ['invoiceNumber']),

  heldCarts: defineTable({
    // "Ventas en espera"
    clientId: v.id('clients'),
    cashierId: v.id('employees'),
    items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
    note: v.optional(v.string()),
  }),

  settings: defineTable({
    // singleton row
    storeName: v.string(),
    storeRif: v.string(), // shown on receipt header (single place)
    phone: v.string(),
    address: v.string(),
    ivaPct: v.number(), // label in UI: "Impuestos"
    exchangeRate: v.number(), // Bs per USD
    nextInvoiceNumber: v.number(), // starts at 1 → prints "00000001"
    currency: v.string(), // fixed: "Dólar estadounidense"
  }),
});
```

Seed initial data from `src/data.jsx` (`CATALOG`, `CATEGORIES`, `CLIENTS`, `EMPLOYEES`, `SALES_HISTORY`) via a Convex seed script so the app looks populated on first run.

## 6. Convex functions (queries `q:` / mutations `m:`)

- **products.ts** — `q:list` (filters: search, category, low-stock, paused, exempt; pagination), `q:byBarcode`, `m:create`, `m:update`, `m:setPaused` (⚠ pausing must also be handled client-side: remove the product from any open cart), `m:adjustStock`, `m:remove`.
- **categories.ts** — `q:list`, `m:create`, `m:update`, `m:removeWithReassign(categoryId, reassignToId)` — single mutation that re-points all products then deletes; never orphan products.
- **clients.ts** — `q:list` (search + created date-range, pagination), `q:byTaxId(prefix, taxId)` (the Venta identification gate), `m:create`, `m:update`, `m:remove`.
- **employees.ts** — same CRUD pattern; `q:list` excludes the logged-in user (they live in /perfil). `m:update` handles role + per-permission toggles + active flag + 6-digit PIN.
- **sales.ts** —
  - `m:checkout(cart, clientId, payments)`: validates stock, **atomically** reads + increments `settings.nextInvoiceNumber`, snapshots `exchangeRate`/`ivaPct`/prices, decrements product stock, inserts sale. Returns the sale for the success screen.
  - `q:history(filters)`: date range (both ends required, no future), payment method, refunded-only, pagination.
  - `m:refund(saleId, reason)`: guards `void_sales`, restores stock for every item, sets `refund: {date: Date.now(), reason}`. Refusing double refunds.
- **heldCarts.ts** — `q:list`, `m:park`, `m:resume` (returns cart + client, deletes row), `m:discard`.
- **settings.ts** — `q:get`, `m:update` (guards `manage_settings`).
- **auth.ts** — `m:loginWithPin(pin)` → employee session. Owner sessions get the `'all'` permissions sentinel, matching `can()`.

**Enforce RBAC server-side too**: every mutation re-checks the permission with the shared `can()` logic — UI gating alone is not security.

## 7. Receipt logic (port from payment.jsx exactly)

- Number format: `N° ${String(n).padStart(8, "0")}`.
- Amounts on the printed receipt are **Bs only** (multiply USD totals by the sale's snapshotted `exchangeRate`).
- Method names on receipt hide dollars: `zelle` → "Transferencia", `cash_usd` → "Efectivo". No "$" anywhere on the receipt.
- Lines: Subtotal, IVA (summed into total), `Exento (E)` **only if** the sale has ≥1 exempt item. No "CAJA", no "Efectivo/Cambio" lines.
- Header shows store name + RIF (once), address, phone, date `dd/mm/yyyy` + 12h a.m./p.m.
- Print via a dedicated print stylesheet (the prototype's receipt styles are in `styles.css` under the RECEIPT banner).

## 8. PWA / offline

- Precache the app shell + fonts via `vite-plugin-pwa` (Workbox).
- Convex handles live data when online. For the offline story the header already shows: keep the `online` boolean (navigator.onLine + Convex connection state) wired to the "Conectado/Sin conexión" chip in the sidebar.
- Minimum viable offline: Escanear + Venta cart building work offline against cached product data; queue `checkout` mutations and flush on reconnect. (Invoice numbers are assigned server-side at flush time — never client-side, to keep the sequence gapless.)

## 9. Build order (suggested milestones)

1. **Shell**: Vite + CSS port + AppShell (sidebar/drawer/collapse rail) + router + static screens with mock data imported from `data.jsx`. Visual parity with the prototype at 360px, 768px, 1000px, 1440px.
2. **Convex read path**: schema, seed, swap mocks for `useQuery` on Dashboard, Productos, Clientes, Historial, Empleados, Ajustes.
3. **Write path**: all CRUD mutations + dirty-checked edit sheets + toasts.
4. **Sale flow**: client gate → scanner (use `keydown` buffering for HID barcode scanners; the prototype's scanner bar shows the detected format transiently) → cart → split payment → atomic checkout → success + receipt print.
5. **Refunds, held carts, RBAC server enforcement, login by PIN.**
6. **PWA**: manifest, service worker, offline cart, install prompt. Lighthouse PWA pass.

## 10. Acceptance checklist (compare against the prototype)

- [ ] Every screen pixel-matches the prototype at mobile + desktop widths.
- [ ] Sidebar: collapsed rail = 76px, hamburger fills the full header square, "Conectado" chip sits above the user name inside the menu.
- [ ] Venta refuses to add items until a client is identified (V/J input). Two-column ≥1000px only.
- [ ] Pausing a product removes it from open carts and from Venta search, but it still appears in Escanear.
- [ ] Checkout decrements stock; refund restores it and records date + reason; refunded sales filterable.
- [ ] Receipt: 8-digit number, Bs-only amounts, no dollar wording, conditional Exento line.
- [ ] Date-range filters: require both ends, block future dates; Spanish formats everywhere (dd/mm/yyyy, 12h a.m./p.m., full month names).
- [ ] All edit modals: Guardar disabled until dirty; modals cap at 90vh with sticky action buttons.
- [ ] RBAC: each role limitable per-permission; menu + routes + mutations all enforce `can()`.
- [ ] Pagination bars flush to the viewport bottom on every list screen, no content visible behind them.
- [ ] PWA installs, loads offline, and the connection chip reflects real state.
