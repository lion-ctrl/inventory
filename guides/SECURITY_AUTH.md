# 🔐 Seguridad — Autenticación (backlog de tickets)

> Revisión de seguridad del **2026-06-24** sobre el modelo de auth (PIN, sin auth package).
> La auth es **genuinamente vulnerable hoy**. El problema raíz NO es el PIN: es que la app
> autentica confiando en un **`_id` de documento de empleado** suministrado por el cliente,
> que **no es secreto** y **se filtra desde queries públicas** → impersonación sin login.
> Esto viola la propia guía del proyecto (`convex/_generated/ai/guidelines.md:180`:
> *"NEVER accept a userId as a function argument for authorization"*).
>
> Plan completo persistido en engram: topic `security/auth-hardening`.

## Leyenda

- **Severidad:** 🔴 Crítica · 🟠 Alta · 🟡 Media
- **Estado:** `[ ]` abierto · `🔧` en progreso (parte hecha, ticket NO cerrado) · `[x]` **cerrado y verificado** (lint + tests verdes).

## Resumen

| Ticket | Título | Sev. | Estado |
|--------|--------|------|--------|
| AUTH-1 | Reemplazar la credencial `_id` por **tokens de sesión** | 🔴 | 🔧 backend ✓ |
| AUTH-2 | Dejar de **filtrar el `_id`** de empleado por queries públicas + gatearlas | 🔴 | 🔧 backend ✓ |
| AUTH-3 | **Rate-limit / lockout** en `login` | 🟠 | [ ] |
| AUTH-4 | **Hashear los PIN** (PBKDF2 + salt) y dejar de devolver el PIN | 🟠 | [ ] |
| AUTH-5 | Cliente: guardar **token** (no `_id`), `logout` real + **CSP** | 🟡 | [ ] |
| AUTH-6 | **Expiración por inactividad** (sliding 30 min) + **tope absoluto** (24 h) + `renewSession` | 🟡 | 🔧 backend ✓ |

> **Orden recomendado:** AUTH-1 y AUTH-2 van **juntas** (cierran la impersonación, el agujero
> crítico) → luego AUTH-3 → AUTH-4 → AUTH-5. Hacerlo **ahora** mientras los datos son dummy
> (la migración es trivial) y antes de que más features usen el patrón `actorId`.

---

## AUTH-1 · 🔴 Reemplazar la credencial `_id` por tokens de sesión

- [ ] **Cerrado y verificado**

> 🔧 **Backend implementado y verde** (vitest **200 passed / 4 skipped**, 2026-06-26). Hecho: tabla `sessions` (`by_tokenHash`/`by_employee`), `requireSession` + `requirePerm(employee, perm)`, `login`/`logout`/`me` por token, y las 22 funciones migradas `actorId → token`. **Falta para CERRAR:** migrar el cliente (`SessionContext` + cada `useMutation` → grupo 5), correr `tsc`/lint tras `codegen`, deploy + revisión end-to-end. Sin commit ni deploy todavía. · La expiración fija de ~12 h se reemplaza por **idle + tope absoluto** → ver **AUTH-6**.

**Problema.** Cada mutation/query autenticada recibe `actorId: v.id('employees')` y confía
en él (`convex/permissions.ts:34-44` → `requirePerm` hace `ctx.db.get('employees', actorId)`).
El cliente guarda ese `_id` crudo (`src/state/SessionContext.tsx:10`, key `pos.employeeId`) y
lo reenvía como prueba de identidad. **El `_id` de documento —permanente, no secreto— es el
bearer token.** No expira, no se revoca, y se filtra (ver AUTH-2).

**Exploit.** Conseguís un `_id` válido (AUTH-2) → lo mandás como `actorId` a `checkout`,
`refund`, edición de productos/precios, etc. Sin login, sin PIN.

**Fix (Convex — `crypto` está disponible en el runtime default, sin `"use node"`).**
- Tabla nueva:
  ```ts
  sessions: defineTable({
    employeeId: v.id('employees'),
    tokenHash: v.string(),     // sha256(token) — NUNCA el token crudo
    expiresAt: v.number(),
    lastSeenAt: v.number(),
  }).index('by_tokenHash', ['tokenHash']).index('by_employee', ['employeeId'])
  ```
- `login` genera el token (`crypto.getRandomValues(new Uint8Array(32))` → base64url),
  guarda `sha256(token)` (`crypto.subtle.digest`), devuelve el **token crudo una sola vez**.
  Expiración ~12 h (un turno).
- Helper `requireSession(ctx, token)` → busca por `by_tokenHash`, valida expiración + `active`,
  devuelve el empleado. `requirePerm` pasa a recibir `(employee, perm)`.
- **Migrar ~22 funciones públicas** de `actorId: v.id('employees')` → `token: v.string()`.

**Archivos.** `convex/schema.ts`, `convex/auth.ts`, `convex/permissions.ts`, y todas las
funciones con `actorId` (`sales`, `heldCarts`, `products`, `clients`, `categories`,
`employees`, `settings`), `src/state/SessionContext.tsx`, cada `useMutation`.

**Listo cuando:**
- [x] Existe la tabla `sessions` con índices `by_tokenHash` / `by_employee`.
- [x] `login` devuelve un token random; se guarda solo el hash; expira.
- [x] `requireSession(token)` implementado y reemplaza a `requirePerm(actorId)`.
- [x] Las ~22 funciones reciben `token`, no `actorId`.
- [ ] `SessionContext` y los call sites pasan `token`.  ← pendiente (cliente / grupo 5)
- [x] TDD: sesión válida/expirada/revocada; token inválido rechazado — **tests verdes (vitest 200/4)**. _Lint/`tsc` pendiente de `codegen`._

---

## AUTH-2 · 🔴 Dejar de filtrar el `_id` de empleado + gatear las queries públicas

- [ ] **Cerrado y verificado**

> 🔧 **Backend implementado y verde** (2026-06-26). Hecho: `sales.history` y `heldCarts.list` ya NO devuelven `cashierId` y exigen sesión; `clients.create` ahora pide `manage_clients`; `settings.get` se deja **público a propósito** (branding del login). **Falta para CERRAR:** está atada a AUTH-1 — el cliente todavía manda `actorId`, así que end-to-end no corre hasta migrar el grupo 5; más `tsc`/lint + deploy. ⚠️ Ojo: el guard `manage_clients` en `clients.create` puede cambiar el flujo de venta para un cajero sin ese permiso — revisar al migrar el cliente.

**Problema.** Como el `_id` es la credencial, **cualquier query pública que lo devuelva
reparte credenciales usables** a quien sepa `VITE_CONVEX_URL` (que viaja en el bundle).

| Función | Ref | Filtra |
|---|---|---|
| `sales.history` | `convex/sales.ts:217-227` — pública, **sin args** | `cashierId: v.id('employees')` en cada venta |
| `heldCarts.list` | `convex/heldCarts.ts:12-18` — pública, **sin args** | `cashierId` en cada carrito |
| `clients.create` | `convex/clients.ts:35` | **sin ningún guard** (cualquiera inserta clientes) |
| `settings.get` | `convex/settings.ts:6` | lectura pública sin auth |

**Exploit.** `fetch` a `sales.history` → tomás un `cashierId` (mapean a empleados reales,
incluido el dueño) → impersonás (AUTH-1).

**Fix.**
- Sacar `cashierId` del `returns` de `sales.history` y `heldCarts.list` (la UI ya tiene el
  snapshot `cashierName`).
- Gatear ambas con `requireSession` (AUTH-1).
- Agregar guard a `clients.create`; revisar si `settings.get` debe requerir sesión.

**Listo cuando:**
- [x] `sales.history` / `heldCarts.list` no devuelven `cashierId` y exigen sesión.
- [x] `clients.create` tiene guard de permisos (`manage_clients`).
- [x] `settings.get` revisado → **lectura pública a propósito** (branding del login), documentado.
- [x] TDD: las queries rechazan sin sesión; no exponen `_id` — **tests verdes (vitest)**. _Lint/`tsc` pendiente de `codegen`._

---

## AUTH-3 · 🟠 Rate-limit / lockout en `login`

- [ ] **Cerrado y verificado**

**Problema.** PIN de 6 dígitos = **1.000.000** de combinaciones (`assertPin` →
`/^\d{6}$/`, `convex/permissions.ts:56`). El `login` (`convex/auth.ts:8-40`) **no tiene
ningún throttle ni lockout** (servidor ni cliente). Fuerza bruta de cualquier email en
minutos contra el endpoint público.

**Fix.** `@convex-dev/rate-limiter` (fixed-window), ej. **5 intentos / 15 min** por email
normalizado + un tope global; reset al éxito. Mensaje genérico (no revelar si el email existe).

**Listo cuando:**
- [ ] `login` cuenta intentos fallidos y bloquea tras el umbral.
- [ ] El bloqueo se resetea al login exitoso / al expirar la ventana.
- [ ] TDD: N+1 intentos → bloqueado; éxito resetea. Lint + tests verdes.

---

## AUTH-4 · 🟠 Hashear los PIN (PBKDF2 + salt) y dejar de devolver el PIN

- [ ] **Cerrado y verificado**

**Problema.** PIN en **texto plano**: `convex/schema.ts:113` (`pin: v.string()`), sembrados
plano en `convex/seed.ts` (dueño `'482106'`, etc.), y `login` compara plano
(`convex/auth.ts:23`). **Peor:** `login` **devuelve el empleado completo incluido el `pin`**
(`convex/auth.ts:38`). Un dump de DB, un log, o un admin leyendo `employees.list` expone
todas las credenciales en claro.

**Fix.**
- Reemplazar `pin` por `pinHash` + `pinSalt`. `salt = crypto.getRandomValues(16B)`;
  `pinHash = PBKDF2(pin, salt, 100k, SHA-256)` vía `crypto.subtle` (runtime default, sin Node).
- `login` hashea el input y compara contra `pinHash`. **Quitar `pin` del valor de retorno.**
- Migración **widen → backfill → narrow** (agregar `pinHash`/`pinSalt` opcionales → backfill
  por `@convex-dev/migrations` o al próximo login → quitar `pin`). Con datos dummy, alcanza
  con re-seedear hasheado.

**Listo cuando:**
- [ ] Schema usa `pinHash` + `pinSalt`; `pin` plano eliminado.
- [ ] `login` hashea y compara; ya **no** devuelve el PIN (ni el empleado completo crudo).
- [ ] `seed` siembra hasheado; datos existentes migrados.
- [ ] TDD: PIN correcto/incorrecto contra hash; el retorno no incluye `pin`. Lint + tests verdes.

---

## AUTH-5 · 🟡 Cliente: token (no `_id`), `logout` real + CSP

- [ ] **Cerrado y verificado**

**Problema.** El `_id` vive en `localStorage` como valor permanente, no expira y no se revoca
(`logout` es solo cliente: `src/state/SessionContext.tsx:78-85` borra localStorage, **no hay
sesión que matar en el servidor**). Un XSS lo exfiltra y sirve para siempre.

**Fix.**
- Guardar el **token** (AUTH-1) con su `expiresAt`; limpiar al expirar.
- `logout` mutation que **borra la fila de `sessions`** (revocación real).
- **CSP** estricta en el build de Vite (defensa contra XSS).
- Nota: las **cookies HTTP-only no encajan en Convex** — el cliente manda la auth por
  WebSocket (params de conexión / args), no por cookie, así que el token debe ser legible por
  JS. Mitigación correcta = expiración corta + revocación server-side + CSP (no cookies).
  Por lo mismo, **CSRF no aplica** (no hay credencial auto-enviada por cookie).

**Listo cuando:**
- [ ] El cliente guarda el token (no el `_id`) y respeta la expiración.
- [ ] `logout` borra la sesión en el servidor.
- [ ] CSP configurada en el build.
- [ ] TDD: logout invalida el token server-side. Lint + tests verdes.

---

## AUTH-6 · 🟡 Expiración por inactividad (sliding) + tope absoluto + renovación

- [ ] **Cerrado y verificado**

> 🔧 **Backend implementado y verde** (vitest **213 passed / 4 skipped**, 2026-06-26). Resuelve la *Open Question* del `design.md` (era *"fixed 12h"*). **Decisión:** **idle 30 min** (deslizante, se renueva con actividad) + **tope absoluto 24 h** (la sesión muere al techo aunque haya actividad); valores **ajustables**. Hecho: `sessions.absoluteExpiresAt`, `requireSession` desliza topeado al cap, nuevo `renewSession`. **Falta para CERRAR:** el refresh del **cliente** (~5 min antes, condicionado a actividad → grupo 5 / AUTH-5), `tsc`/lint tras `codegen`, deploy. Sin commit ni deploy.

**Problema.** La sesión de AUTH-1 expira a las **~12 h FIJAS** desde el login: el cajero se cae a mitad de turno aunque esté facturando. Y un idle puro **sin techo** dejaría una sesión robada (XSS) viva para siempre mientras el atacante la mantenga activa.

**Decisión / Fix.**
- `expiresAt` pasa a ser el **deadline de idle** (`now + 30 min`); se **desliza** en cada operación (mutation) y vía `renewSession`.
- Campo nuevo `absoluteExpiresAt` (`now + 24 h` al login) = **techo duro**: la sesión muere al cap pase lo que pase.
- `requireSession` valida idle **y** cap; en mutation empuja `expiresAt = min(now + idle, absoluteExpiresAt)`.
- Nuevo `renewSession(token)`: el cliente lo llama ~5 min antes de vencer **solo si hubo actividad real** del usuario (no incondicional, si no el idle no sirve); empuja la expiración, nunca más allá del cap; pasado el cap → re-login.
- Constantes `IDLE_TTL_MS` (30 min) / `ABSOLUTE_TTL_MS` (24 h), ajustables.

**Archivos.** `convex/schema.ts` (`sessions.absoluteExpiresAt`), `convex/sessions.ts` (constantes), `convex/permissions.ts` (`requireSession`/`resolveSession` deslizan + cap), `convex/auth.ts` (`login` setea ambos, nuevo `renewSession`), `src/state/SessionContext.tsx` (refresh proactivo condicionado a actividad — grupo 5). Specs: `openspec/changes/session-token-auth/{design,specs/session-auth/spec,tasks}.md`.

**Listo cuando:**
- [x] `sessions` tiene `absoluteExpiresAt`; `expiresAt` es el deadline de idle.
- [x] `requireSession` desliza el idle y rechaza al pasar idle **o** cap.
- [x] `renewSession(token)` empuja la expiración topeada al cap; rechaza pasado el cap.
- [ ] Cliente: refresh ~5 min antes, **condicionado a actividad** (no incondicional). _(grupo 5 / AUTH-5)_
- [x] TDD: desliza con actividad; muere por idle; muere por cap aunque activa; clamp del renew — **tests verdes (vitest 213/4)**. _Lint/`tsc` pendiente de `codegen`._
