## ADDED Requirements

### Requirement: Login issues a session token
On a valid email + PIN, the system SHALL create a session bound to that employee and return a single random session token plus its expiry. Login SHALL NOT return the employee's raw document `_id` (nor the PIN) as the means of authentication.

#### Scenario: Successful login returns a token
- **WHEN** a request to `login` provides a correct email and PIN for an active employee
- **THEN** the system creates a session and returns `{ ok: true, token, expiresAt }` (the raw token only here, once)

#### Scenario: Invalid credentials issue no session
- **WHEN** `login` is called with a wrong email or PIN
- **THEN** no session is created and a generic error is returned (no token)

#### Scenario: Inactive employee issues no session
- **WHEN** `login` is called with correct credentials for an employee whose `active` is false
- **THEN** no session is created and an "inactive user" error is returned

### Requirement: Token secrecy at rest
The system SHALL store only a one-way hash of the token (`sha256`) in the `sessions` table and MUST NEVER persist or return the raw token except the single time it is returned by `login`.

#### Scenario: The stored session holds only the hash
- **WHEN** a session is created at login
- **THEN** the persisted `sessions` row contains `tokenHash` (the hash) and never the raw token

### Requirement: Authenticated operations require a valid session token
Every privileged function (the ~22 operations across sales, held carts, products, clients, categories, employees, settings) SHALL require a `token` argument and SHALL resolve the acting employee via the session. A request MUST be rejected when the token is missing, unknown, expired, or its employee is inactive. The system SHALL NOT accept a raw employee `_id` as authorization.

#### Scenario: Valid session authorizes the operation
- **WHEN** a privileged function is called with a token whose session exists, is unexpired, and maps to an active employee with the required permission
- **THEN** the operation proceeds as that employee

#### Scenario: Missing or unknown token is rejected
- **WHEN** a privileged function is called with no token or a token that matches no session
- **THEN** the operation is rejected with an authorization error and no effect occurs

#### Scenario: A raw employee id is no longer accepted
- **WHEN** a caller passes an employee document `_id` where a `token` is expected
- **THEN** the operation is rejected (the id is not a valid session token)

### Requirement: Sessions expire by inactivity, under an absolute cap
A session SHALL carry two deadlines: an **idle deadline** (`expiresAt`, ~30 minutes) that is refreshed forward by activity, and an **absolute cap** (`absoluteExpiresAt`, ~24 hours from login) that is fixed at issuance and never extended. A session MUST be treated as invalid once EITHER deadline has passed. Each authenticated mutation SHALL slide the idle deadline forward to `min(now + idle TTL, absolute cap)`; authenticated queries SHALL validate the session WITHOUT sliding it. Both TTLs SHALL be tunable constants.

#### Scenario: Activity slides the idle window forward
- **WHEN** an authenticated mutation runs on a session whose idle deadline has not passed and whose absolute cap is still in the future
- **THEN** the session's `expiresAt` moves forward to `min(now + idle TTL, absoluteExpiresAt)` and the session stays valid

#### Scenario: An idle session is rejected
- **WHEN** a privileged function is called with a token whose idle deadline (`expiresAt`) is in the past, even though its absolute cap has not been reached
- **THEN** the operation is rejected as unauthenticated

#### Scenario: The absolute cap is enforced despite activity
- **WHEN** a privileged function is called with a token whose absolute cap (`absoluteExpiresAt`) is in the past, even though its idle window was just refreshed
- **THEN** the operation is rejected as unauthenticated

#### Scenario: Sliding never exceeds the absolute cap
- **WHEN** the idle window would slide forward while the absolute cap is nearer than one idle TTL away
- **THEN** the new `expiresAt` is clamped to `absoluteExpiresAt` and never goes beyond it

### Requirement: Sessions can be renewed within their lifetime
A `renewSession` mutation SHALL accept a `token` and, when the session is still valid (not past its idle deadline nor its absolute cap), SHALL slide `expiresAt` forward to `min(now + idle TTL, absoluteExpiresAt)` and return the new `expiresAt`. When the session is past either deadline (or otherwise invalid), `renewSession` SHALL reject the request so the client re-authenticates, and SHALL NEVER extend a session beyond its absolute cap.

#### Scenario: Renewing a valid session extends the idle window
- **WHEN** `renewSession` is called with a token whose session is still within both deadlines
- **THEN** the session's `expiresAt` is pushed forward (clamped to the absolute cap) and the new `expiresAt` is returned

#### Scenario: Renewing past the absolute cap is rejected
- **WHEN** `renewSession` is called with a token whose absolute cap has passed
- **THEN** the renewal is rejected (the client must log in again) and no new validity is granted

### Requirement: Logout revokes the session server-side
A `logout` mutation SHALL delete the caller's session row so the token becomes immediately unusable on the server (not merely cleared on the client).

#### Scenario: A token stops working after logout
- **WHEN** `logout` is called with a valid token and then any privileged function is called with that same token
- **THEN** the session no longer exists and the second call is rejected

### Requirement: Public functions do not expose employee credentials
Functions reachable without a session SHALL NOT return an employee `_id` that can be used as a credential. `sales.history` and `heldCarts.list` SHALL omit `cashierId` from their results (the human-readable `cashierName` snapshot remains) and SHALL require a valid session. `clients.create` SHALL enforce a permission check.

#### Scenario: Sales history no longer leaks the cashier id
- **WHEN** `sales.history` returns sales
- **THEN** each sale includes `cashierName` but NOT `cashierId`

#### Scenario: Held carts listing requires a session
- **WHEN** `heldCarts.list` is called without a valid session
- **THEN** it is rejected, and when authorized it does not return `cashierId`

#### Scenario: Creating a client requires authorization
- **WHEN** `clients.create` is called without a valid session / required permission
- **THEN** it is rejected
