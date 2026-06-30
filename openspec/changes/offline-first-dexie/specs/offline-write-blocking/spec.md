## ADDED Requirements

### Requirement: Risky admin writes are disabled while offline

While the device is offline, the system SHALL disable the risky admin write operations enumerated in FEATURES §18 and SHALL surface a clear connection-required notice instead of attempting the mutation. The blocked set MUST include: deleting products, changing prices, large stock adjustments, creating users, changing roles, category management, tax/settings configuration changes, refunds, and official invoice generation. The block MUST prevent the Convex mutation from being called offline, not merely hide it after a failure.

#### Scenario: A blocked admin write is prevented offline

- **WHEN** the device is offline and the user attempts a blocked admin write (e.g. edit a product price, delete a product, change a tax setting, or issue a refund)
- **THEN** the operation is not sent to Convex and the user sees a "requiere conexión" notice

#### Scenario: The same write succeeds online

- **WHEN** the device is online and the same admin write is attempted with the required permission
- **THEN** the operation proceeds normally against Convex

### Requirement: Reads remain available offline while writes are blocked

Disabling writes offline SHALL NOT disable reads. Each screen that blocks its writes offline MUST still render its cached data from the Dexie mirror, so the user can view the catalog, inventory snapshots, clients, and store settings without a connection.

#### Scenario: Cached data is viewable on a write-blocked screen

- **WHEN** the device is offline on a screen whose writes are blocked (e.g. Products or Settings)
- **THEN** the cached catalog / configuration still renders from the mirror, while the create/edit/delete controls show the offline notice

### Requirement: Write-blocking is applied per screen alongside that screen's read-mirror

Each screen phase SHALL deliver BOTH its read-mirror AND its offline write-blocking together; a screen MUST NOT become offline-readable without its risky writes being simultaneously gated. The connection state driving the gate SHALL come from the app's online detector (`useOnline`), consistent with the connection-state model (FEATURES §13).

#### Scenario: A migrated screen gates writes the moment it gains offline reads

- **WHEN** a screen's reads are migrated to the mirror in its phase
- **THEN** that same phase disables the screen's risky writes offline (no phase ships offline reads while leaving offline writes open)

#### Scenario: Employees stays fully online-only

- **WHEN** the device is offline and the user opens the Employees screen
- **THEN** the screen shows an online-required state, no employee mutation is callable, and no employee data is written to IndexedDB

### Requirement: Permitted offline actions are not blocked

The system SHALL still allow the FEATURES §18 offline allow-list: viewing cached products and inventory, creating customer drafts, and creating pending sales. These permitted actions MUST NOT be blocked by the offline write gate; they are queued or stored locally per the offline-sales-queue capability rather than rejected.

#### Scenario: Creating a pending sale is allowed offline

- **WHEN** the device is offline and the cashier completes a checkout
- **THEN** the sale is stored locally as a pending sale (not blocked), per the offline-sales-queue capability

#### Scenario: Creating a customer draft is allowed offline

- **WHEN** the device is offline and the cashier creates a new client from the sale flow
- **THEN** a local client draft is created and queued for sync (not blocked), while admin client `update`/`remove` remain blocked offline
