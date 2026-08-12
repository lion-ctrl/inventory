## ADDED Requirements

### Requirement: The store keeps a base of suppliers identified by RIF

The system SHALL persist a supplier record for each company the store buys from, carrying a name and a Venezuelan tax identity expressed as the same `taxPrefix` (`V` | `J` | `E`) plus `taxId` pair used for clients. Optional contact and commercial detail SHALL include a contact person, an email, a landline and a mobile kept as separate fields, a flat address, free-text payment terms, a website, and notes. Empty optional fields MUST NOT be stored as empty strings.

#### Scenario: A supplier is created with the minimum identity

- **WHEN** an authorized user creates a supplier with a name and a RIF, leaving the optional fields blank
- **THEN** the supplier is stored, is immediately active, and none of the blank optional fields is persisted

#### Scenario: Payment terms are free text

- **WHEN** a supplier is saved with payment terms such as "15 días neto" or "50% al pedir"
- **THEN** the value is stored verbatim, without being matched against a fixed list of terms

### Requirement: A RIF identifies exactly one supplier

The system SHALL refuse to create or update a supplier whose `taxPrefix` + `taxId` pair already belongs to another supplier, and SHALL explain the refusal in Spanish. The uniqueness check MUST resolve through the tax-id index rather than scanning the table, and an update that leaves the pair unchanged MUST NOT be refused for colliding with itself.

#### Scenario: A duplicate RIF is refused

- **WHEN** a user creates a second supplier with a RIF that already exists
- **THEN** the creation is rejected with "Ya existe un proveedor con ese RIF." and no second record is stored

#### Scenario: A supplier keeps its own RIF while editing other fields

- **WHEN** a user edits a supplier's contact details without changing its RIF
- **THEN** the update succeeds

### Requirement: Retiring a supplier preserves its history

The system SHALL represent a supplier that is no longer used as inactive rather than requiring deletion, and an inactive supplier SHALL remain readable. Deletion SHALL remain available as an explicit, separate action.

#### Scenario: A supplier is deactivated

- **WHEN** a user marks a supplier inactive
- **THEN** the supplier still appears in the base, marked as inactive, and its recorded purchases remain readable

### Requirement: Reading the supplier base is operational, editing it is gated by permission

The system SHALL allow any authenticated session to read the supplier base, because selecting a supplier is part of ordinary operation. The system SHALL require the `manage_suppliers` permission to create, update or delete a supplier, and SHALL reject an unauthorized attempt with a Spanish permission error. A request without a valid session SHALL be rejected before any permission is considered.

#### Scenario: A cashier without the permission can read but not write

- **WHEN** an authenticated employee lacking `manage_suppliers` lists suppliers and then attempts to create one
- **THEN** the list is returned and the create is rejected with "Sin permisos para esta acción."

#### Scenario: An unauthenticated request is rejected

- **WHEN** a supplier read is attempted without a valid session token
- **THEN** the request is rejected as an invalid or expired session

### Requirement: The supplier permission is granted explicitly, never inherited

The system SHALL treat an employee whose stored permissions do not mention `manage_suppliers` as **not** holding it. Introducing the permission MUST NOT invalidate employee records created before it existed, and MUST NOT grant the capability to anyone by default.

#### Scenario: An employee predating the permission has no access

- **WHEN** an employee whose permission map was stored before `manage_suppliers` existed opens the app
- **THEN** the supplier section is unavailable to them until the permission is granted explicitly

#### Scenario: The owner is unaffected

- **WHEN** the owner, whose permissions are the "all" sentinel, opens the app
- **THEN** the supplier section is available without any change to their record

### Requirement: The supplier base is readable offline and unwritable offline

Following the per-screen offline contract, the system SHALL mirror the supplier list locally so it renders and searches without a connection, and SHALL block every supplier write while offline with a visible connection-required notice rather than attempting the mutation. The local supplier mirror SHALL be cleared on logout together with the other disposable mirrors.

#### Scenario: The list renders offline while writes are blocked

- **WHEN** the device is offline on the Suppliers screen
- **THEN** the supplier list and its search still render from the mirror, and the create, edit and delete controls are disabled behind the offline notice

#### Scenario: Logging out clears the local supplier mirror

- **WHEN** a user logs out
- **THEN** the mirrored supplier rows are removed from local storage along with the other disposable mirrors
