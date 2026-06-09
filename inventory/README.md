# Smart Inventory POS — React PWA + Vite + Convex

Production port of the high-fidelity HTML prototype (see `../README.md` and
`../IMPLEMENTATION_PLAN.md`). All UI text is Spanish; design tokens and styles are
ported verbatim from the prototype.

No auth package is used: login checks the `employees` table directly — email +
6-digit PIN. The owner/admin assigns PINs in **Empleados**; anyone can update their
own PIN in **Mi perfil**.

## Run (development)

```bash
pnpm dev        # starts Convex (local deployment) + Vite together
```

First run only — seed the demo data (in a second terminal, after `pnpm dev` is up):

```bash
npx convex run seed:run
```

## Login (seeded demo team)

| Usuario | Email | PIN (contraseña) | Rol |
|---|---|---|---|
| Carlos Méndez | carlos@mitienda.com | 482106 | Propietario (todos los permisos) |
| Lucía Fernández | lucia.fernandez@mitienda.com | 741022 | Administrador (todos) |
| Juan Pérez | juan.perez@mitienda.com | 135708 | Cajero (historial + clientes) |

The full team (10 employees with granular permissions) is seeded from the prototype's
`data.jsx` — manage them in **Empleados**.

## Stack

- **Vite + React + TypeScript** — screens ported 1:1 from the prototype JSX.
- **Convex** — schema, queries/mutations with validators, RBAC re-checked server-side,
  atomic invoice numbering (`settings.nextInvoiceNumber`), stock decrement on checkout,
  refunds restore stock. Local anonymous dev deployment (no account needed).
- **PWA** — `vite-plugin-pwa` (autoUpdate), self-hosted fonts via @fontsource, app shell
  precached; product/category/client/settings data mirrored to localStorage so Escanear
  and the Venta cart work offline. Checkout requires connection (by design — matches the
  prototype's offline dialog).

## Project layout

See `PORTING_CONVENTIONS.md` for the file map, the Convex API surface, and the porting
rules used during the build.
