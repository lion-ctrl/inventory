# Cash Close Screen Specification

## Purpose

The screen where a cashier counts USD and Bs against the server's blind figures, sees the per-currency difference, and reviews close history — gated the same way the backend is.

## Requirements

### Requirement: The Count Sheet Captures USD and Bs Separately, Reveals the Difference Only After Submission, and the Reveal's Lifetime Is Bounded

The screen MUST present two independent count inputs and MUST NOT display `Efectivo esperado` or any difference before the cashier submits both counts. After submission it MUST render `Diferencia` (`Sobrante`/`Faltante`) for USD and for Bs as two separate figures, and MUST keep that result visible until the cashier acts again — it is the answer they just asked for. A successful submission MUST clear both count inputs, so a further accidental click cannot resubmit the same amounts against a window that has already moved on. The moment the cashier begins entering a NEW count, for either currency, the screen MUST take the previous result off screen before that new count is ever submitted: a stale result staying mounted while a new count is entered would let it anchor that new count, which is exactly what blind ordering exists to prevent, and would apply to every close after the first, not only the first.

> Amended (real defect, not a coverage gap): the reveal's lifetime was originally unspecified. A successful close reset every other in-flight flag but left the reveal and both count inputs untouched, so the previous result stayed mounted while the cashier typed their next count (breaking blindness on every close after the first), and the same, now-stale counts stayed valid enough to make the close action clickable again the instant the request finished — one further accidental click would have written a second, immutable close over a seconds-long window, with expected near zero against a full drawer count.

#### Scenario: Nothing is revealed before the count

- GIVEN the cashier opens `Cierre de caja` with no count submitted
- WHEN the screen renders
- THEN two blank count inputs are shown and no expected or difference figure appears anywhere

#### Scenario: Difference renders per currency after submission

- GIVEN the cashier submits `Contado` USD and `Contado` Bs
- WHEN the server responds
- THEN `Diferencia` for USD and `Diferencia` for Bs render as two separate figures, never blended into one

#### Scenario: A successful close clears the count inputs and disables the close action again

- GIVEN the cashier's count was just submitted and accepted
- WHEN the result renders
- THEN both count inputs are empty and the close action is disabled until new amounts are entered

#### Scenario: Starting a new count takes the previous result off screen

- GIVEN a close result is currently displayed
- WHEN the cashier types into either count input
- THEN the previous result is no longer shown, before the new count is submitted

### Requirement: The Screen Refuses to Close While Offline or While Sales Are Still Retrying, Always Discloses What It Cannot Wait For, and Never Blocks Permanently

The screen MUST disable the close action while the device is offline, and MUST also disable it while that cashier has a pending offline sale in a status the sync engine actively retries (queued, or retrying after a transient failure), because expected cash computed over an incomplete sale set is not true. It MUST NOT disable the close action for a pending sale in a status the sync engine never revisits — that sale's outcome will never change on its own, and blocking on it would make the close impossible forever. Two such statuses exist and are DIFFERENT facts about the cashier's money, so the screen MUST disclose each honestly and MUST NOT merge them into one message: a sale the server permanently rejected (it will never land), and a sale whose sync was interrupted before this device learned the outcome (unknown, not necessarily rejected). Even while the close is disabled for a genuinely retrying sale, the screen MUST offer an explicit, disclosed, and never-default control that lets the cashier close anyway, stating how many sales are still pending and that the expected figure may not include them — so no pending-sale status, present or future, can make the close permanently unreachable.

> Amended (structural revision): this requirement was fixed once per pending-sale status that turned out to be permanently stuck (a server-rejected sale, then an interrupted sync) and the defect kept reappearing under a new status each time. The rule is no longer "which statuses are safe to block on" — it is that blocking a resolvable wait is legitimate but blocking must never be the only path, because a resolvable wait can still fail to resolve (e.g. a retrying sale that keeps failing the same way indefinitely). The escape hatch is what makes this a closed class rather than one more instance.

#### Scenario: Offline

- GIVEN the device is offline
- WHEN the cashier opens `Cierre de caja`
- THEN the close action is disabled and the screen states that a connection is required

#### Scenario: Online but a sale is still retrying

- GIVEN the device is online but this cashier has a pending offline sale the sync engine is still actively retrying
- WHEN the cashier opens `Cierre de caja`
- THEN the close action stays disabled by default, the screen discloses how many such sales exist, and an explicit control is offered to close anyway

#### Scenario: A permanently rejected sale is disclosed, never blocks

- GIVEN the device is online and this cashier has a pending offline sale the server has permanently rejected
- WHEN the cashier opens `Cierre de caja`
- THEN the close action is enabled and the screen discloses, in Spanish, how many such sales were rejected and that their cash is not part of the expected figure

#### Scenario: An interrupted sync is disclosed separately from a rejection, never blocks

- GIVEN the device is online and this cashier has a pending offline sale whose sync was interrupted before this device learned whether the server received it
- WHEN the cashier opens `Cierre de caja`
- THEN the close action is enabled and the screen discloses, in a message distinct from a rejected sale's, that this sale's outcome is unknown and its cash may not be included in the expected figure

#### Scenario: The cashier can always close despite a retrying sale, by a deliberate act

- GIVEN the close action is disabled because of a pending offline sale still being retried
- WHEN the cashier uses the explicit "close anyway" control
- THEN the close proceeds, and it is never attempted with that acknowledgement implied or defaulted

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

### Requirement: A Cashier's Very First Close Requires an Explicit Opening Date

`closes.create` requires an explicit opening date when the calling cashier has no previous close. The screen MUST reveal a control for supplying it, but MUST NOT predict when it is needed: there is no reliable client-side signal for "this cashier has no previous close" (a `view_reports` session queries every cashier's closes at once, and the server never returns any cashier's identity on a close row). The screen MUST reveal the control only after the server has rejected an ordinary submission for exactly that reason, and MUST NOT send an opening date before that rejection.

> Added post-delivery. The three requirements above originally defined no control for supplying this date, which is why the screen first shipped without one — every cashier's first-ever close was unreachable until this was added.

#### Scenario: The opening-date control is absent until the server asks for it

- GIVEN a cashier with no previous close opens `Cierre de caja`
- WHEN the screen renders and before any count is submitted
- THEN no opening-date control is shown, and the ordinary submission does not include an opening date

#### Scenario: The server's rejection reveals the control

- GIVEN the cashier submits a count and the server rejects it because this is their first close
- WHEN the rejection is received
- THEN an opening-date control appears, defaulted to today, and the screen does not attempt another submission until the cashier acts on it

## Known Limitations

> Deliberately NOT a requirement — an accepted gap, not hardened into law.

### The unsynced-sale check only sees THIS device's pending-ops queue

Offline sales queue locally per device (Dexie `pendingOps`). If the same cashier sold on a SECOND device that still has unsynced sales, this screen — running on a different device — cannot detect that queue and will not refuse to close on that basis; the close would understate what is truly pending for that cashier.

### A permanently rejected sale's cash is genuinely uncounted, and nothing yet resolves it

A pending sale the server permanently rejects (e.g. the stock it needed was sold elsewhere before it synced) is disclosed, not blocked on — its cash is real physical money the cashier may still be holding, but it is not, and can never become, part of the server's expected figure. The difference the cashier sees is genuinely a surplus by that amount, not a mistake in the close. No screen in this application resolves, edits, or dismisses a rejected pending sale today; it stays queued and disclosed indefinitely until a future change adds that capability.

### An interrupted sync is unrecoverable at the queue level, and nothing yet resolves it either

A sale whose sync was interrupted (a crash, a closed tab, a killed PWA, or a reload during the network call) is left in a status the sync engine never revisits — this is a property of the queue itself, not a gap in this screen. This device genuinely does not know whether the server received that sale before the interruption, so its disclosure states an unknown outcome, not a rejection. Same honesty as the rejected-sale entry above: no screen in this application resolves, retries, or dismisses an interrupted sale today; it stays queued and disclosed indefinitely until a future change adds that capability.

### The cashier picker can only compare display names, never identities

AUTH-2 strips the cashier id from every close row this screen ever receives — `scope: 'all'` returns each row's frozen `cashierName` snapshot, never a `cashierId` a supervisor could compare against. The picker's filter is therefore necessarily a display-name comparison, not an identity comparison. If two employees share the same name, their closes are silently merged into one entry in the picker and their histories become indistinguishable from within this screen — there is no way to tell them apart here. This is real and currently unavoidable given AUTH-2 and D5's own reasoning (`design.md`), not an oversight to fix quietly; it is recorded so it is not mistaken for one.

### Both count fields accept dot decimals only — a typed comma is silently stripped, and this is a real hazard, not a cosmetic note

Both count inputs are sanitised by the same `sanitizeAmount` the Payment screen already uses in production, which keeps only digits and a dot and deletes every other character, including a comma, outright — it does not convert a comma to a dot. A Venezuelan cashier who types a comma decimal (the locally conventional form) gets a silently wrong number, not an error: `1234,50` becomes `123450` (100× too much), and `1.234,50` becomes `1.23` (roughly 1000× too little, because the thousands dot is read as the decimal point and the digits after it are truncated to two places). Because a close is immutable — `closes` exports only `create` and `list`, with no edit and no delete — a count entered this way becomes a permanent, fabricated `Sobrante` or `Faltante` attributed to that cashier's name, with no way to correct the row afterward. The count inputs' placeholders are the dot form (`0.00`) specifically so the screen does not itself instruct the format that produces this. Making `sanitizeAmount` locale-aware would fix this properly, but it is shared with the already-shipped Payment screen, so that change is out of this screen's scope and is not made here; this hazard is recorded, not silently tolerated.
