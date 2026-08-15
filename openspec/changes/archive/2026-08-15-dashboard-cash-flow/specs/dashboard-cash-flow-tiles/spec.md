# Dashboard Cash Flow Tiles Specification

## Purpose

Three Dashboard tiles — `Ingresos`, `Egresos`, `Diferencia` — plus a period selector, driven by `reports.cashFlow`. Reuses the screen's existing offline/partial visual language, with one deliberate departure: a truncated window blanks all three figures instead of showing a suspect number. `Ganancias`/`Utilidad` never appear here.

## Requirements

### Requirement: Three Tiles Beside Ventas / Productos

The Dashboard MUST render `Ingresos`, `Egresos`, and `Diferencia` tiles, sourced from `reports.cashFlow`, beside the existing `Ventas`/`Productos` tiles. `Ganancias` and `Utilidad` MUST NOT appear anywhere in this screen's copy.

#### Scenario: Happy path

- GIVEN an online session with `view_reports`
- WHEN the Dashboard loads for the default period
- THEN the three tiles render numeric values labelled `Ingresos`, `Egresos`, `Diferencia`

### Requirement: The Egresos Tile States What It Counts

`Egresos` MUST be labelled, in the text beside the number (not only a tooltip), as purchases to suppliers — e.g. "Compras a proveedores" — and MUST NOT be presented as the shop's total outgoing money, since rent, salaries, and utilities are not part of this figure.

#### Scenario: Cannot be read as total outgoings

- GIVEN the Egresos tile is rendered
- WHEN the user reads it without opening any tooltip
- THEN the visible text states the figure is purchases to suppliers, not every expense the shop has

### Requirement: Period Boundaries Are Computed in Local Time

The Dashboard MUST compute the selected period's `from`/`to` from the device's local calendar, not UTC, and send them to `reports.cashFlow` as epoch milliseconds.

#### Scenario: Month boundary in a UTC-4 timezone

- GIVEN the device's local timezone is UTC-4
- WHEN the Dashboard computes the current month's window
- THEN `from` is local midnight of day 1 and `to` is local end-of-day of the last day, both as epoch-ms

### Requirement: Period Selector Shows the Current Period Only

The selector MUST offer `Mes` (default), `Semana`, and `Día` for the CURRENT period only. It MUST NOT offer navigation to a previous period and MUST NOT show a comparison against a prior period; both are non-goals of this change.

#### Scenario: Default and no navigation

- GIVEN the Dashboard loads with no prior selection
- WHEN it renders
- THEN `Mes` is selected, the tiles show the current calendar month, no control moves to a previous period, and no comparison figure is shown

### Requirement: A Truncated Window Renders the Whole Block as Unavailable

When `reports.cashFlow` returns `truncated: true`, the Dashboard MUST render `Ingresos`, `Egresos`, and `Diferencia` all as unavailable — the same treatment as no data, never a numeric value with a partial caption. `Diferencia` is the number the owner acts on; showing it as suspect-but-numeric would invite treating it as sound.

#### Scenario: Truncated period

- GIVEN a period whose sales or purchases exceed the server's cap
- WHEN the Dashboard receives `truncated: true`
- THEN all three tiles show their unavailable state together, with no numeric value on any of them

### Requirement: Offline, All Three Figures Are Unavailable

Because `purchases` is not Dexie-mirrored, the Dashboard MUST show all three cash-flow tiles as unavailable whenever offline with no cached result this session, following the existing `salesUnavailable` pattern. It MUST NEVER compute or display a figure from partial or local-only data.

#### Scenario: Fresh offline load

- GIVEN the device is offline and `reports.cashFlow` has not resolved this session
- WHEN the Dashboard renders
- THEN `Ingresos`, `Egresos`, `Diferencia` all show the unavailable state, matching the existing offline sales tile

### Requirement: Permission-Denied Renders as Absent, Not an Error

An employee without `view_reports` MUST NOT see the cash-flow tiles or the period selector, and MUST NOT hit a visible thrown error. The Dashboard MUST hide them client-side via `can('view_reports')`; the server independently refuses the query regardless.

#### Scenario: Hidden for a cajero

- GIVEN an employee without `view_reports`
- WHEN the Dashboard renders
- THEN the three cash-flow tiles and the period selector are absent, and no error is shown
