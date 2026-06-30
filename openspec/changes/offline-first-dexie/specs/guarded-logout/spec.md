## ADDED Requirements

### Requirement: Logout preserves unsynced pending operations

On logout, the system SHALL preserve every `pendingOps` row that the backend has not yet confirmed — those with status `pending`, `syncing`, `failed`, or `conflict`. Logout MUST NOT delete unsynced durable writes. Only the sync engine may remove a pending op, and only after the backend confirms receipt (per the offline-sales-queue capability).

#### Scenario: An unsynced op survives logout

- **WHEN** a `pendingOps` row with status `pending` (or `syncing` / `failed` / `conflict`) exists and the user logs out
- **THEN** that row still exists in IndexedDB after logout

#### Scenario: A pending op is removed only on backend confirmation

- **WHEN** a pending op is drained by the sync engine and the backend confirms receipt
- **THEN** the op is deleted at that point — and not by the logout flow

### Requirement: Logout clears the disposable mirror and cart draft

On logout the system SHALL clear the disposable local data: the mirror tables (`products`, `categories`, `clients`, `settings`), the `cartDraft` row, and disposable `meta`. When unsynced pending ops exist, the system SHALL clear ONLY this disposable set (a transaction over the mirror tables + `cartDraft`) and leave `pendingOps` intact (`src/state/SessionContext.tsx:101-157`).

#### Scenario: Disposable data is cleared while a pending op is preserved

- **WHEN** the user logs out while at least one unsynced pending op exists
- **THEN** the mirror tables and `cartDraft` are cleared, and `pendingOps` is left untouched

### Requirement: A full local wipe is allowed only when nothing is unsynced

When the unsynced pending-op count is zero, the system MAY delete the entire local database (`db.delete()`) — which also self-heals a corrupted store. This full-wipe branch MUST run only when the count is zero, so `pendingOps` is never destroyed by it.

#### Scenario: Full wipe when there is nothing to lose

- **WHEN** the user logs out and the unsynced pending-op count is zero
- **THEN** the entire local database is deleted

#### Scenario: No full wipe while unsynced work exists

- **WHEN** the user logs out and at least one unsynced pending op exists
- **THEN** the full-database delete is NOT performed; only the disposable data is cleared

### Requirement: Local teardown is best-effort and never blocks logout

The system SHALL drop the React/localStorage session state immediately on logout so the UI logs out instantly, and SHALL run the Dexie teardown in the background as best-effort. A failure of the local teardown MUST NOT block or fail the logout. Server-side session revocation (the `session-auth` `logout` mutation) is unchanged by this capability.

#### Scenario: Session state clears instantly regardless of local teardown

- **WHEN** the user logs out
- **THEN** the session token and expiry are removed immediately and the UI is logged out, while the IndexedDB teardown proceeds in the background

#### Scenario: A teardown error does not break logout

- **WHEN** the background IndexedDB teardown throws during logout
- **THEN** the error is swallowed and the logout still completes

### Requirement: Legacy local caches are shed on boot

On boot the system SHALL remove the legacy localStorage read mirror (`posCache.*` keys) written by the old `useCachedQuery`, so a logged-out device on an old install does not retain cached business data outside the guarded teardown.

#### Scenario: Old cache keys are removed at startup

- **WHEN** the app boots on a device that still has `posCache.*` localStorage keys from the legacy cache
- **THEN** those keys are removed during the one-time boot cleanup
