## ADDED Requirements

### Requirement: An offline sale is stored locally and queued as a durable operation

When a checkout is completed offline, the system SHALL store the sale locally as a `PENDING_SYNC` record with a local receipt number and SHALL enqueue a durable `pendingOps` row of type `SALE_CREATE`. The sale MUST NOT be lost on reload or browser restart, and MUST NOT be shown as an official/final sale until the backend confirms it.

#### Scenario: Offline checkout enqueues a pending sale

- **WHEN** the device is offline and the cashier completes a checkout
- **THEN** a local `PENDING_SYNC` sale with a local receipt number is stored and a `SALE_CREATE` op is enqueued in `pendingOps`

#### Scenario: A pending sale is never presented as official

- **WHEN** locally-queued pending sales are displayed (e.g. in History or Dashboard)
- **THEN** they are clearly marked `PENDING_SYNC`, separated from official sales, and never counted in official totals

### Requirement: Every pending operation carries a complete, durable record

Each `pendingOps` row SHALL include: a local operation id, an operation type (`SALE_CREATE` | `CUSTOMER_CREATE` | `STOCK_ADJUSTMENT` | `PRODUCT_CREATE_DRAFT`), the payload, an idempotency key, a status, an attempt count, created/updated timestamps, the last error, and the device id. The idempotency key MUST be generated at enqueue time and persisted with the op so that every retry of that op reuses the same key.

#### Scenario: An enqueued op has all required fields

- **WHEN** an offline write is enqueued
- **THEN** the `pendingOps` row records type, payload, idempotency key, status, attempts, createdAt/updatedAt, lastError, and deviceId

#### Scenario: The idempotency key is stable across retries

- **WHEN** an op is retried after a failure
- **THEN** it is sent with the same idempotency key that was generated when it was first enqueued

### Requirement: The server sync mutation is idempotent

The system SHALL provide an idempotent `sales.syncOffline` Convex mutation that accepts an `idempotencyKey` and authenticates via a session token. Before creating any record it MUST look up an existing sale by that key (`by_idempotencyKey` index) and, if one exists, return it unchanged instead of creating a duplicate. The non-idempotent `sales.checkout` MUST NOT be used for replaying offline sales.

#### Scenario: A first sync creates the official sale

- **WHEN** `sales.syncOffline` is called with an idempotency key that has no existing sale
- **THEN** it re-validates stock on the server, consumes the invoice number, decrements stock, and inserts the official sale stamped with the idempotency key and device id

#### Scenario: A duplicate sync returns the existing sale

- **WHEN** `sales.syncOffline` is called again with an idempotency key that already has a sale
- **THEN** it returns the existing sale and creates no duplicate, no new invoice number, and no additional stock movement

### Requirement: A single-flight sync engine drains the queue and owns op deletion

The system SHALL provide a client-side sync engine that processes `pendingOps` in creation order (`pending → syncing → synced | failed | conflict`), with retry and capped backoff, a bounded maximum attempt count, and a single-flight lock so multiple sync loops never run concurrently. The sync engine SHALL run on app start, when the connection returns, on Convex reconnect, on an explicit "Sync now", and when a new op is enqueued. It MUST be the ONLY place a `pendingOps` row is deleted, and only after the backend confirms receipt.

#### Scenario: Reconnecting drains the queue

- **WHEN** the device reconnects with queued `pendingOps`
- **THEN** the sync engine processes them in `createdAt` order, marking each `syncing` then `synced` on success

#### Scenario: A synced op is deleted only after backend confirmation

- **WHEN** the sync engine sends an op and the backend confirms the result
- **THEN** the op is removed at that point — and not before confirmation, and not by any other code path

#### Scenario: Concurrent sync loops are prevented

- **WHEN** a sync trigger fires while a sync pass is already running
- **THEN** the single-flight lock prevents a second concurrent pass

### Requirement: Sync conflicts are typed, surfaced, and never auto-resolved

During sync the system SHALL detect business-rule conflicts and represent them as typed codes — at minimum `STOCK_INSUFFICIENT`, `PRODUCT_DELETED`, `PRODUCT_DISABLED`, `PRICE_CHANGED`, `TAX_CHANGED`, `CUSTOMER_NOT_FOUND`, `DUPLICATE_OPERATION`, `AUTH_EXPIRED`, `PERMISSION_DENIED` (FEATURES §15). On a conflict the op SHALL be marked `conflict` with its detail stored locally and a clear message shown; the system MUST NOT delete or silently auto-resolve a conflicted op.

#### Scenario: Insufficient server stock marks the op as a conflict

- **WHEN** `sales.syncOffline` re-validates stock and finds it insufficient
- **THEN** it returns a `STOCK_INSUFFICIENT` conflict code, the op is marked `conflict` (not deleted), and the conflict detail is stored for manual handling

#### Scenario: An expired session during sync forces re-authentication

- **WHEN** an op fails to sync because the session token has expired
- **THEN** the op is marked `AUTH_EXPIRED` (not deleted) and the user is prompted to re-authenticate before sync continues

#### Scenario: Two cashiers selling the last unit — the loser conflicts

- **WHEN** two devices each queue an offline sale for the last unit of a product and both sync
- **THEN** the server accepts the first and returns `STOCK_INSUFFICIENT` for the second, whose op becomes a `conflict` rather than being auto-resolved or forced negative

### Requirement: Local stock is a snapshot, not authoritative

The system SHALL treat locally cached stock as a snapshot and MUST re-validate stock on the server during sync. It MUST NOT blindly trust offline stock, and MUST NOT silently force stock negative on sync unless an explicit supervisor/override rule allows it.

#### Scenario: Server stock re-validation governs the synced sale

- **WHEN** an offline sale is synced
- **THEN** the server re-checks stock at sync time and the local snapshot does not override the server's decision
