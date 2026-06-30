## ADDED Requirements

### Requirement: The in-progress cart is persisted to a durable local draft

The system SHALL write the in-progress cart through to a singleton Dexie `cartDraft` row (`id: 'active'`) on every change. The persisted draft MUST capture the cart items, the selected client, the payment splits, and the splits id counter (`CartContext` state at `src/state/CartContext.tsx:70-74`), so the sale state outlives the React session.

#### Scenario: Cart changes are written through to the draft

- **WHEN** the cashier adds, edits the quantity of, or removes an item, selects a client, or changes the payment splits
- **THEN** the `cartDraft` row (`id: 'active'`) is updated with the current cart, `selectedClientId`, `splits`, and splits id counter

### Requirement: The cart is recovered after reload or browser restart

On mount, the system SHALL hydrate the cart state from the `cartDraft` row exactly once, BEFORE any write-through runs, so a reload or browser restart restores the in-progress sale. The hydration guard MUST prevent the initial empty state from overwriting a saved draft.

#### Scenario: A reload restores the in-progress sale

- **WHEN** a cart with items, a selected client, and splits exists and the page is reloaded (or the browser is restarted)
- **THEN** the cart, selected client, and splits are restored from the `cartDraft` row

#### Scenario: Initial empty state does not clobber a saved draft

- **WHEN** the provider mounts and the write-through effect would run before hydration completes
- **THEN** the saved draft is hydrated first and the empty initial cart does not overwrite it (hydration is guarded)

### Requirement: A restored draft self-heals against live data

A draft restored from Dexie SHALL be reconciled against the live product data, so lines for deleted or unavailable products are dropped and snapshots are refreshed before the cart is acted on. The persisted draft MUST NOT be treated as authoritative over current product state.

#### Scenario: A restored line for a deleted product is dropped

- **WHEN** a draft is restored that contains a line for a product no longer present in the live catalog
- **THEN** the reconciliation drops that line and the remaining valid lines are kept

### Requirement: The draft is discarded on sale completion and on discard

The system SHALL delete the `cartDraft` row when the sale is discarded (`discardSale`, `src/state/CartContext.tsx:151`) and when a checkout completes and the cart resets, so a stale draft is never restored after the sale it belonged to is finished.

#### Scenario: Discarding the sale clears the draft

- **WHEN** the cashier discards the in-progress sale
- **THEN** the `cartDraft` row is deleted and a subsequent reload restores an empty cart

#### Scenario: Completing checkout clears the draft

- **WHEN** a checkout completes and the cart resets
- **THEN** the `cartDraft` row is deleted so the finished sale is not restored on reload

### Requirement: Logout discards the cart draft

On logout, the system SHALL clear the `cartDraft` row as part of the disposable local teardown, so an in-progress cart does not persist across a session change. The cart draft is disposable and is NOT preserved across logout (unlike unsynced `pendingOps`, which the guarded-logout capability preserves).

#### Scenario: A draft does not survive logout

- **WHEN** a `cartDraft` exists and the user logs out
- **THEN** the `cartDraft` row is cleared, and the next session starts with an empty cart
