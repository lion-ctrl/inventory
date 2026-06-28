## ADDED Requirements

### Requirement: Failed login attempts are counted per normalized email within the window

The system SHALL track failed login attempts per normalized (trimmed, lowercased) email address. Each failed attempt — wrong PIN, unknown email, or an attempt made while locked out — SHALL increment or initialize the counter for that email within the current fixed time window. Attempts for unknown email addresses MUST be counted identically to attempts for known emails so that the lockout mechanism cannot be used to enumerate which addresses exist in the system.

#### Scenario: A failed attempt increments the counter

- **WHEN** `login` is called with an email and PIN that do not match any active employee
- **THEN** the `loginAttempts` counter for the normalized email is incremented by 1 (or created at 1 if no counter exists for the current window)

#### Scenario: Attempts against unknown emails are counted

- **WHEN** `login` is called with an email address that does not correspond to any employee
- **THEN** the attempt is recorded in `loginAttempts` for that normalized email, exactly as a failed attempt against a known employee's email would be

### Requirement: The (MAX+1)th attempt within the window is rejected with a generic lockout error

After `MAX_ATTEMPTS` (5) failed login attempts within the current fixed time window, the system SHALL reject every subsequent attempt for that email with a generic lockout error message — even when the supplied credentials are correct. The lockout check MUST occur BEFORE credential evaluation so that no information about credential validity is revealed once the threshold is reached.

#### Scenario: The (MAX+1)th attempt is rejected even with correct credentials

- **WHEN** `login` has already recorded `MAX_ATTEMPTS` (5) failed attempts for a normalized email within the current window
- **AND** a subsequent `login` call supplies the correct PIN for that email's employee
- **THEN** `login` returns `{ ok: false, error: '<lockout message>' }` without evaluating the credentials and without creating a session

#### Scenario: Fewer than MAX_ATTEMPTS failures do not trigger the lockout

- **WHEN** `login` has recorded fewer than `MAX_ATTEMPTS` (5) failed attempts for a normalized email within the current window
- **THEN** the next attempt proceeds to normal credential evaluation (returning the wrong-credentials error on failure, or a session on success)

### Requirement: A successful login resets the attempt counter

When a login attempt succeeds — credentials are valid, the employee is active, and the lockout threshold was not reached — the system SHALL delete or zero the failed-attempt counter for that normalized email, so the next login attempt begins with a clean slate.

#### Scenario: Success clears the counter

- **WHEN** `login` succeeds (correct email and PIN, employee active, counter below `MAX_ATTEMPTS`)
- **THEN** the `loginAttempts` record for that email is removed or zeroed, and a subsequent failed attempt for the same email is treated as the first failure of a new window

### Requirement: The lockout auto-lifts when the fixed window expires

When the `WINDOW_MS` (15-minute) time window that started the counter has elapsed, the accumulated failed attempts SHALL no longer count toward the lockout. The next login attempt after the window ends MUST be treated as the first attempt of a new window and MUST NOT be rejected on the basis of the previous window's failures.

#### Scenario: Lockout lifts after the window expires

- **WHEN** `login` has been locked out for a given email (counter at or above `MAX_ATTEMPTS`)
- **AND** at least `WINDOW_MS` milliseconds have elapsed since `windowStart`
- **THEN** the next login attempt for that email is treated as the start of a new window — a failure increments a fresh counter starting at 1, and a success proceeds normally

### Requirement: The lockout message is generic and identical for existing and non-existent emails

The lockout error string returned by `login` SHALL be the same static value regardless of whether the normalized email corresponds to a real employee. This prevents an attacker from using lockout behavior to enumerate which addresses exist in the system. The lockout message SHALL be distinct from the wrong-credentials message.

#### Scenario: Locked-out existing email and locked-out unknown email return the same error

- **WHEN** `login` has exceeded `MAX_ATTEMPTS` for both a real employee's email and a non-existent email address
- **THEN** both calls return `{ ok: false, error: '<lockout message>' }` where the `error` string is byte-for-byte identical in both cases and is not equal to the wrong-credentials message
