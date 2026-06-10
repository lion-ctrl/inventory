# Handoff: Smart Inventory POS

## Overview
A complete point-of-sale + inventory management web app for a small Venezuelan retail store (multi-category: food, drinks, pharmacy, cleaning, hardware). It covers the full sale flow (client identification → barcode scan / product search → cart → split multi-currency payment → receipt), plus product/category management, client management, employee management with RBAC, sales history with refunds, held ("parked") sales, settings, and a per-user profile.

**Target stack chosen by the owner: React PWA + Vite + Convex.** This document maps the design to that stack. **Read `IMPLEMENTATION_PLAN.md` next** — it contains the step-by-step build plan: project setup, file structure, the full Convex schema, every query/mutation to write, receipt logic, PWA strategy, build milestones, and the acceptance checklist.

## About the Design Files
The files in this bundle are **design references created as an HTML prototype** (React 18 UMD + Babel-in-browser + plain CSS). They show the intended look and behavior — they are NOT production code to copy verbatim. Your task is to **recreate these designs in a Vite + React PWA codebase backed by Convex**, using proper ES modules, a real router, and Convex queries/mutations instead of the in-memory mock state.

That said, the JSX is real, working React. Component structure, state logic, RBAC checks, currency math, and all CSS can be ported nearly 1:1 — the main translation work is module syntax, routing, and moving data from `data.jsx` mocks into Convex.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy (all UI text is Spanish), interactions, and responsive behavior are final. Recreate pixel-perfectly. All design tokens live in `src/ds/colors_and_type.css`; all component styles in `src/styles.css` (~3100 lines, organized by screen with banner comments).

## Files
| File | Contents |
|---|---|
| `Smart Inventory POS.html` | Entry point — open in a browser to run the prototype. Shows script load order. |
| `src/ds/colors_and_type.css` | **Design tokens**: colors, type scale, spacing, radii, shadows, motion + semantic type classes (`.t-h1`, `.t-num`, `.t-label`…). Load first. |
| `src/styles.css` | All component/screen styles, responsive rules, scrollbar styling. Loads after tokens. |
| `src/data.jsx` | Mock data + business helpers: `CATALOG`, `CATEGORIES`, `CLIENTS`, `SALES_HISTORY`, `EMPLOYEES`, `PERMISSIONS`, `ROLE_LABELS`, `can(user, perm)` RBAC check, money/date formatters, Bs exchange-rate helpers. **This file defines your Convex schema.** |
| `src/primitives.jsx` | Shared UI kit: `Button`, `IconButton`, `Chip`, `Input`, `Sheet` (modal/bottom-sheet), `AppBar`, `Pagination`, `EmptyState`, `Toast`, icon wrapper (Lucide), etc. |
| `src/app.jsx` | App shell: collapsible sidebar (desktop ≥768px) / full-height drawer (mobile), route state + RBAC route guard, online/offline state, layout tweaks. |
| `src/login.jsx` | Login / PIN screen. |
| `src/dashboard.jsx` | "Inicio" home: greeting, today's stats, quick-action cards (ordered as menu), recent sales. |
| `src/sale.jsx` | "Venta": client identification gate (V/J + cédula/RIF), barcode scanner bar, product search, cart, stock limits, exento (IVA-exempt) handling. |
| `src/scan.jsx` | "Escanear": product info lookup only (same scanner + search, no cart/payment). Shows paused products too. |
| `src/payment.jsx` | Split payments in USD/Bs (Efectivo $, Efectivo Bs, Tarjeta, Pago Móvil, Zelle, Transferencia), change calculation, success screen, printable receipt (Bs only, IVA + Exento lines, N° 00000001 format). |
| `src/stored.jsx` | "Ventas en espera": parked carts to serve the next customer in line; resume/discard. |
| `src/history.jsx` | "Historial de ventas": date-range + method + refund filters, responsive table (desktop) / cards (mobile), sale detail modal, **reimburse flow** (restores stock, stores refund date/reason), reprint. |
| `src/products.jsx` | Product CRUD, category CRUD with product reassignment before delete, pause/unpause (paused products are removed from carts), exento flag, low-stock filter, pagination. |
| `src/clients.jsx` | Client CRUD (V/J prefix + cédula/RIF), search + date-range filter, pagination. |
| `src/employees.jsx` | Employee CRUD, roles (Propietario/Administrador/Cajero), per-employee granular permissions, 6-digit PIN with show/hide eye, created-date + range filter. |
| `src/profile.jsx` | "Mi perfil": hero card with avatar + role chip, own data editing. |
| `src/settings.jsx` | "Ajustes": store data (name, RIF, phone, address), billing (next invoice number, Impuestos/IVA %), exchange rate Bs/$, edit sheets that only enable Guardar when dirty. |

Script load order in the HTML = dependency order: `ds/colors_and_type.css` → `styles.css` → `data.jsx` → `primitives.jsx` → screen files → `app.jsx`. Each screen file exports its components to `window` (prototype artifact — replace with ES module imports).

## Design Tokens (summary — authoritative source is `ds/colors_and_type.css`)
- **Background** `--paper #F7F4EE` (warm paper) · cards `--surface #FFFFFF` · dark panels `--surface-ink #15161A`
- **Ink** `#15161A` / `#3A3D45` / `#6E727B` / `#A9ACB3` · hairlines `--line #E2DCCE`
- **Accent (brand green)** `--accent #1F8A5B`, hover `#15703F`, soft bg `#DDEFE3`, text-on-soft `#0C3F23`
- **Warn (terracotta)** `#C2410C` + soft `#FCE7DA` — low stock, atención · **Danger** `#B42318` + `#FCE4E1` · **Info blue** `#1F5FB7` + `#DDE8F8`
- **Receipt paper** `#FFF9E8`
- **Fonts**: Inter (UI), JetBrains Mono (SKUs, barcodes, totals, receipt), Fraunces (display moments only)
- **Numbers always tabular**: `.t-num` (`font-variant-numeric: tabular-nums`)
- **Spacing**: 4px base scale · **Radii**: 4/8/12/16/24/999px · **Shadows**: 3 subtle paper-like levels · **Focus ring**: green `rgba(31,138,91,0.28)`, never browser blue
- **Motion**: 120/200/320ms, `cubic-bezier(0.22,1,0.36,1)`
- Role chip colors: Propietario = green (accent-soft), Administrador = info blue, Cajero = purple.

## Responsive Behavior (important, heavily iterated)
- **<768px (mobile)**: full-height drawer menu (locks body scroll), hamburger in header, hidden scrollbars (`.content` scrolls like a native app), product search becomes a "Buscar producto" full-height bottom sheet (drag-to-close on the whole header area, touch supported), tables become card lists, scanner bar pinned above the scroll area.
- **≥768px (desktop)**: collapsible sidebar — expanded shows icons+labels; collapsed is a 76px icon rail. The hamburger toggle fills the entire menu header square (header height, no dead space), menu header height matches the app header. Sidebar shows the "Conectado" chip above the user name.
- **Venta screen only**: two-column (cart right) at **≥1000px**; below that, single column with floating cart button.
- Modals/sheets: max-height **90vh**, internal scroll, action buttons sticky at the bottom; desktop centered dialog, mobile bottom sheet. Sheets must not stretch with content.
- Pagination bars stick flush to the bottom (no gap leaking content behind), consistent across Historial / Productos / Clientes / Empleados / Ventas en espera.
- Breakpoint quirk to keep: `.appbar` gets `padding-bottom: 5px` at `<350px` when the action button wraps below.

## Domain Rules & State (drives your Convex schema)
- **Currency**: catalog prices in USD; **receipts show Bs only** (exchange rate set in Ajustes). Dollar-based methods are printed without any dollar mention: Zelle → "Transferencia", Efectivo dólar → "Efectivo".
- **Receipts**: auto-generated sequential number, 8-digit zero-padded (`N° 00000001`), no CAJA line, no Efectivo/Cambio lines, IVA summed into total, `Exento (E)` line **only when** the sale contains exempt products.
- **Taxes**: IVA % from Ajustes ("Impuestos"); products can be flagged **Exento** (filter chip "EXENTO IVA" in Productos; "No exento" label otherwise).
- **Sales require a client** — no anonymous sales. Identification by `V-` (cédula) or `J-` (RIF) before the cart unlocks; client can be created inline.
- **RBAC**: roles Propietario / Administrador / Cajero — every role's permissions can be limited individually. Permissions (in menu order): Historial de ventas, Reembolsar ventas, Productos, Clientes, Empleados, Ajustes. `can(user, perm)` in `data.jsx` is the single check; sidebar items and routes are both gated. Owner session uses the `'all'` sentinel.
- **Refunds**: restore stock, store sale + reimburse dates, reason required, refunded sales filterable in Historial.
- **Paused products**: hidden from Venta search, removed from any live cart when paused, still visible in Escanear (info-only screen).
- **Held sales** ("Ventas en espera"): park the current cart to serve the next customer; resume restores cart + client.
- **Employees**: 6-digit PIN (show/hide eye), active flag, created date; the logged-in user is shown in "Mi perfil", not in the Empleados table.
- **Categories**: deletable only after reassigning its products to another category (guided flow in the delete modal).
- **Date/time format**: Spanish, `dd/mm/yyyy`, 12h with a.m./p.m.; full month names where written out (e.g. "Enero"). Date-range filters: both ends required before filtering, future dates disabled.
- **Edit modals everywhere**: Guardar disabled until a field actually changed (dirty check).
- **Online/offline**: header shows connection state; design assumes offline-queueing later (PWA service worker + Convex offline-first fits this).

## Suggested Convex Mapping
Tables: `products`, `categories`, `clients`, `employees`, `sales` (with embedded items array, `refund: {date, reason} | null`), `heldCarts`, `settings` (singleton: store info, ivaPct, exchangeRate, nextInvoiceNumber). Invoice numbering should be a Convex mutation that atomically increments `nextInvoiceNumber`. `can()` becomes a shared helper used in both UI and Convex function guards.

## Interactions & Animations
- Sheets/drawers slide in 200–320ms with `--ease-out`; backdrop fade.
- Buttons: hover darkens (`--accent-2`), disabled at 50%-ish opacity, no scale tricks.
- Toasts for CRUD confirmations.
- Scanner input auto-focuses; scanning shows detected barcode format transiently (only while scanning).
- The prototype has a "Tweaks" panel (`tweaks-panel.jsx` in the project root) — **prototype-only tooling, do not port**.

## Assets
- Icons: [Lucide](https://lucide.dev) (loaded from CDN in the prototype — use `lucide-react` in Vite).
- Fonts via Google Fonts: Inter, JetBrains Mono, Fraunces.
- Product images are emoji glyphs in mock data — replace with real product images when available.
- No proprietary/brand assets.
