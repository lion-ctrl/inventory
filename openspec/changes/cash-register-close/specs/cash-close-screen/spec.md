# Cash Close Screen Specification

## Purpose

The screen where a cashier counts USD and Bs against the server's blind figures, sees the per-currency difference, and reviews close history — gated the same way the backend is.

## Requirements

### Requirement: The Count Sheet Captures USD and Bs Separately and Reveals the Difference Only After Submission

The screen MUST present two independent count inputs and MUST NOT display `Efectivo esperado` or any difference before the cashier submits both counts. After submission it MUST render `Diferencia` (`Sobrante`/`Faltante`) for USD and for Bs as two separate figures.

#### Scenario: Nothing is revealed before the count

- GIVEN the cashier opens `Cierre de caja` with no count submitted
- WHEN the screen renders
- THEN two blank count inputs are shown and no expected or difference figure appears anywhere

#### Scenario: Difference renders per currency after submission

- GIVEN the cashier submits `Contado` USD and `Contado` Bs
- WHEN the server responds
- THEN `Diferencia` for USD and `Diferencia` for Bs render as two separate figures, never blended into one

### Requirement: The Screen Refuses to Close While Offline or While Sales Are Unsynced

The screen MUST disable the close action while the device is offline, and MUST also disable it while that cashier has any pending unsynced offline sale, because expected cash computed over an incomplete sale set is not true.

#### Scenario: Offline

- GIVEN the device is offline
- WHEN the cashier opens `Cierre de caja`
- THEN the close action is disabled and the screen states that a connection is required

#### Scenario: Online but a sale is still unsynced

- GIVEN the device is online but this cashier has an unsynced pending sale
- WHEN the cashier opens `Cierre de caja`
- THEN the close action stays disabled until that sale finishes syncing

### Requirement: Close History Respects the Same-Cashier / view_reports Boundary

The screen MUST always show the signed-in cashier their own close history. It MUST NOT offer a control to view another cashier's closes unless the session holds `view_reports`, and MUST hide — not merely disable — that control otherwise.

#### Scenario: A cajero sees only their own history

- GIVEN a cajero session without `view_reports`
- WHEN they open close history
- THEN only their own closes are listed and no other-cashier control is rendered

#### Scenario: view_reports can switch cashiers

- GIVEN a session with `view_reports`
- WHEN close history is opened
- THEN a control to view another cashier's closes is available

## Known Limitations

> Deliberately NOT a requirement — an accepted gap, not hardened into law.

### The unsynced-sale check only sees THIS device's pending-ops queue

Offline sales queue locally per device (Dexie `pendingOps`). If the same cashier sold on a SECOND device that still has unsynced sales, this screen — running on a different device — cannot detect that queue and will not refuse to close on that basis; the close would understate what is truly pending for that cashier.
