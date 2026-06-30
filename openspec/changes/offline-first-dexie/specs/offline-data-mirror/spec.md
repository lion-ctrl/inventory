## ADDED Requirements

### Requirement: Convex remains the source of truth; Dexie is a read-through mirror

The system SHALL treat Convex as the live source of truth and SHALL serve a Dexie mirror table only when the live Convex result is unavailable (`undefined`). When a live result is present it MUST be returned in preference to the mirror, so the authoritative value always supersedes a cached one. The mirror SHALL NOT be promoted to an independent authority.

#### Scenario: Live Convex result is preferred over the mirror

- **WHEN** a mirrored read hook (`useMirroredQuery`) has a live Convex result for its query
- **THEN** the live result is returned and the Dexie mirror copy is not served

#### Scenario: Mirror is served only when the live result is unavailable

- **WHEN** the live Convex result is `undefined` (loading or offline) and the read is not skipped
- **THEN** the hook returns the contents of the corresponding Dexie mirror table

#### Scenario: The live value supersedes a stale mirror on reconnect

- **WHEN** the device reconnects and the live Convex result becomes defined again after the mirror was being served
- **THEN** the hook returns the live result, replacing the previously served mirror value

### Requirement: Every successful read refreshes its mirror table

On each successful (non-`undefined`) live result, the system SHALL write that result into the read's Dexie mirror table in the background, keyed by the Convex `_id`, so the mirror reflects the latest server data for the next offline render. A failed or still-loading read MUST NOT overwrite or clear the existing mirror.

#### Scenario: A successful result is written into the mirror

- **WHEN** a mirrored read receives a defined live result from Convex
- **THEN** the mirror table for that read is refreshed with the result (upserted by `_id`)

#### Scenario: An unavailable result leaves the last mirror intact

- **WHEN** the live result is `undefined` (offline or loading)
- **THEN** the mirror table is left unchanged, preserving the last successfully mirrored data

### Requirement: A session-less read yields no data

When a mirrored read is skipped because there is no session (`args === 'skip'`), the system SHALL return an empty result and SHALL NOT serve the Dexie mirror. A logged-out device MUST NOT see cached business data through a mirrored read. This closes the read-leak present in the legacy `useCachedQuery`, which returned its cache regardless of session.

#### Scenario: No session means no mirrored data

- **WHEN** a mirrored read hook is called with `args === 'skip'` (no session token)
- **THEN** it returns an empty array and does not read from the Dexie mirror table

#### Scenario: A logged-out reload shows no cached catalog

- **WHEN** the device is offline and reloaded while no session token is present
- **THEN** mirrored reads return empty and no products/categories/clients/settings are rendered from the mirror

### Requirement: Reads are migrated to the mirror screen by screen via the shared hooks

The four shared master-data read hooks (`useProducts`, `useCategories`, `useClients`, `useSettingsDoc` in `src/state/hooks.ts`) SHALL each be migrated from `useCachedQuery` to the mirrored primitive in its own phase, keeping the same return signature so every consumer screen becomes offline-readable without further change. A migrated hook MUST fill and serve its dedicated mirror table; a not-yet-migrated hook retains its previous behavior.

#### Scenario: Migrating a shared hook lights up all its consumers

- **WHEN** a shared read hook's body is repointed to the mirrored primitive (signature unchanged)
- **THEN** every screen consuming that hook reads from the mirror offline without any change to those screens

#### Scenario: Master-data mirror tables back the consumer screens offline

- **WHEN** the products, categories, clients, and settings reads are mirror-backed and the device goes offline
- **THEN** the consumer screens (Scan, Sale, Payment, Dashboard, Stored) render their cached catalog, categories, clients, and store settings from the mirror

### Requirement: Mirror tables are disposable and refill from Convex

Mirror tables (`products`, `categories`, `clients`, `settings`) SHALL be disposable: a breaking shape change MAY clear them on a Dexie version upgrade, and the next successful read refills them from Convex. Mirror clearing MUST NOT affect the durable local tables (`cartDraft`, `pendingOps`).

#### Scenario: A version upgrade may clear a mirror table without data loss

- **WHEN** the Dexie schema version is bumped and a mirror table is cleared on upgrade
- **THEN** the next online read of that data repopulates the mirror, and `cartDraft` / `pendingOps` are untouched
