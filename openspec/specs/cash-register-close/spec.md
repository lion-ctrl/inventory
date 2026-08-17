# Cash Register Close Specification

## Purpose

Lets a cashier count their physical drawer against what server-side data says should be in it, and learn a per-currency difference, without the expectation ever being revealed before the count is committed. Only `cash` and `cash_bs` splits reach a drawer.

## Requirements

### Requirement: Expected Cash Is Computed Only From `sale.splits`

The system MUST derive expected drawer cash exclusively from each sale's `splits` array. The system MUST NOT use `sale.method` for this purpose: `method` stores only `cleanSplits[0].method`, the first split row, and does not reflect a sale paid through more than one method.

#### Scenario: A mixed-method sale is not misclassified by `method`

- GIVEN a $50 sale with splits `[{method:'cash', amount:10}, {method:'transfer', amount:40}]`, stored with `method: 'cash'`
- WHEN a close computes expected USD for the window containing this sale
- THEN expected USD includes the $10 `cash` split only, never the full $50

#### Scenario: A sale with no drawer split contributes nothing

- GIVEN a sale whose only split is `{method:'transfer', amount:50}`
- WHEN a close computes expected cash for that window
- THEN neither expected USD nor expected Bs includes this sale

### Requirement: Expected Bolívares Is the Sum of `entered`, Never a Reconversion

The system MUST compute expected Bs as the sum of `entered` on every `cash_bs` split in the window. The system MUST NOT derive it by converting any split's USD `amount` at an exchange rate read at close time.

#### Scenario: Two sales frozen at different rates sum by entered, not by today's rate

- GIVEN Sale A has a `cash_bs` split of `amount: 100` with `entered: 3600` at that sale's `exchangeRate: 36`, and Sale B has a `cash_bs` split of `amount: 200` with `entered: 8000` at `exchangeRate: 40`, both inside the window
- WHEN the close computes expected Bs
- THEN expected Bs is 11600, unaffected by whatever exchange rate is current when the close happens

The two USD amounts MUST differ. With both at `amount: 100` the sums coincide (`100×36 + 100×40 === 100×38 × 2`), so reconverting the whole window at ANY single rate also lands on the stated total and the scenario is satisfied by the exact behaviour it forbids.

### Requirement: A Close's Window Continues From That Cashier's Own Last Close

A close's window MUST be `(previousClose.closedAt, now]`, scoped to sales and refunds attributed to that SAME `cashierId` only. When no previous close exists for that cashier, the system MUST require an explicit `openedAt` and use `(openedAt, now]` instead.

#### Scenario: A second close continues where the first left off

- GIVEN cashier A's last close closed at T1
- WHEN cashier A closes again at T2
- THEN the recorded window's start is exactly T1

#### Scenario: A cashier's first close requires an explicit openedAt

- GIVEN cashier B has never closed before
- WHEN cashier B attempts to close without supplying `openedAt`
- THEN the system refuses

#### Scenario: Two cashiers' windows never mix

- GIVEN cashier A and cashier B both sold during the same period
- WHEN cashier A closes
- THEN the resulting expected figures reflect only sales and refunds carrying cashier A's `cashierId`

### Requirement: A Refund Reduces the Close Whose Window Contains `refund.date`

`sale.refund` is `{ date, reason }` — no amount, no method — so the system MUST derive the refunded amount from the ORIGINAL sale's `splits`, split by split:

- A DRAWER split (`cash`, `cash_bs`) MUST reduce that SAME currency bucket by that SAME frozen figure — `entered` for `cash_bs`, `amount` (USD) for `cash`.
- A NON-drawer split (`card`, `transfer`, `mobile`, `zelle`) MUST reduce expected USD by that split's `amount`, because the money still leaves the drawer as cash regardless of how it was originally paid.

This reduction MUST be attributed to the close whose window contains `refund.date`, never the window containing `soldAt`.

#### Scenario: Refunding a card-paid sale still reduces USD

- GIVEN a sale paid entirely by `card` for $50, sold in an earlier window and refunded on a date inside the current window
- WHEN the current close computes expected USD
- THEN expected USD is reduced by $50, even though the sale has no `cash` or `cash_bs` split

#### Scenario: Refunding a mixed sale reduces both currencies

- GIVEN a sale with a `cash_bs` split (`entered: 1000`) and a `card` split (`amount: 20`), refunded inside the current window
- WHEN the close computes expected figures
- THEN expected Bs is reduced by 1000 and expected USD is reduced by 20

#### Scenario: The refund's own window is charged, not the sale's

- GIVEN a sale sold inside window W1 and refunded on a date inside a later window W2
- WHEN W1 and W2 are each closed
- THEN W1's expected cash is unaffected and W2's is reduced by the refund

### Requirement: The Count Is Blind

The system MUST NOT expose expected USD or expected Bs for a cashier's still-open window through any query before that cashier submits `closes.create`. `closes.create` MUST accept `countedUsd`/`countedBs`, compute expected figures server-side within that same call, and return the per-currency difference. Already-recorded closes remain normally readable via `closes.list`.

#### Scenario: Expected is not observable before this close is recorded

- GIVEN a cashier's window has not been closed yet
- WHEN anything queries the system before `closes.create` is called for it
- THEN no response contains that window's expected USD or Bs

#### Scenario: A recorded close's figures stay readable afterward

- GIVEN a close was recorded previously
- WHEN `closes.list` is called
- THEN its stored expected, counted, and difference figures are returned normally

### Requirement: USD and Bs Are Counted and Compared Independently

The system MUST accept `countedUsd` and `countedBs` as two independent figures and MUST compute `differenceUsd` and `differenceBs` separately. It MUST NOT blend them into one figure.

#### Scenario: A shortfall in one currency does not touch the other

- GIVEN expected USD 100 / Bs 5000, counted USD 95 / Bs 5000
- WHEN the close is recorded
- THEN `differenceUsd` is -5 and `differenceBs` is 0

### Requirement: A Close Is Immutable

The system MUST NOT expose any mutation capable of updating or deleting a recorded close.

#### Scenario: No edit or delete capability exists

- GIVEN a close has already been recorded
- WHEN the available `closes` operations are inspected
- THEN none of them can modify or remove an existing close record

### Requirement: Closing Your Own Drawer Is Session-Gated; Reading Another's Requires `view_reports`

The system MUST allow any valid session to close for the session's OWN `cashierId`, with no additional permission required. The system MUST require `view_reports` to read closes belonging to a DIFFERENT `cashierId`; a cashier's own closes MUST always be readable to them regardless of `view_reports`.

#### Scenario: A cajero closes their own drawer without view_reports

- GIVEN a cajero session holding no `view_reports` permission
- WHEN that cajero calls `closes.create`
- THEN the close is recorded under that cajero's own `cashierId`

#### Scenario: A cajero cannot read another cashier's closes

- GIVEN a cajero session holding no `view_reports` permission
- WHEN that cajero requests closes for a different `cashierId`
- THEN the system refuses

#### Scenario: view_reports reads any cashier's closes

- GIVEN a session holding `view_reports`
- WHEN it requests closes for any `cashierId`
- THEN the closes are returned

### Requirement: Purchases Never Contribute to Expected Cash

The system MUST NOT include any purchase in expected USD or expected Bs, under any window: `purchaseFields` carries no payment method, so no purchase can be attributed to a drawer. (This is unrelated to the `purchases.remove` hard-delete limitation recorded in `cash-flow-report`'s spec — that limitation is about a figure changing retroactively once a purchase row is deleted. Here a purchase is never counted whether it still exists or not, so nothing about a close can retroactively change because of one.)

#### Scenario: A purchase inside the window is ignored

- GIVEN a purchase recorded inside a close's window
- WHEN the close computes expected cash
- THEN the purchase contributes nothing to either currency

### Requirement: The Read Cap Is Per-Cashier and Always Has an Exit

A close reads a bounded number of rows inside one mutation transaction. That bound MUST be measured over the closing cashier's OWN sales and refunds only — putting `cashierId` inside the indexed range — never over the whole shop's volume with the cashier filter applied afterwards.

Going over the bound MUST NOT compute a quietly capped expected figure, and MUST NOT leave the drawer unclosable. Because a window start is derived from the previous close and cannot be renamed by the caller, a bare refusal is unrecoverable: every retry re-reads the same start against a strictly larger set. The system MUST therefore refuse once, naming an exit the caller can actually take, and on the cashier's explicit confirmation close over the most recent rows within the bound, recording on the row the point from which figures were actually counted.

#### Scenario: A colleague's volume never consumes this cashier's bound

- GIVEN another cashier has more sales inside the window than the bound allows, and this cashier has one
- WHEN this cashier closes
- THEN the close succeeds over this cashier's own sale, with no refusal and nothing recorded as partial

#### Scenario: An over-bound window refuses once, then closes on confirmation

- GIVEN a cashier's own window holds more sales than the bound allows
- WHEN they close without confirming a partial close
- THEN the close is refused with a message naming the confirmation as the remedy
- AND WHEN they close again confirming a partial close
- THEN the close succeeds, its expected figures cover only the most recent rows within the bound, and the row records the point counting actually started from

#### Scenario: A partial close does not compound

- GIVEN a partial close has been recorded
- WHEN that cashier closes again
- THEN the new window starts at the partial close's window END, not at the point it counted from, so no later sale is ever skipped

## Known Limitations

> Deliberately NOT a requirement — an accepted gap, not hardened into law.

### A partial close under-reports its own window, by design

The rows a partial close leaves uncounted are never counted by any later close: `closedAt` is the true window end and the next close continues from there. The cashier's physical count therefore exceeds the recorded expectation and the row shows a surplus. The recorded counted-from point is what makes that surplus explainable; nothing recovers the figures themselves.

### A close recorded against the wrong window cannot be corrected

Immutability means a close can never be edited or deleted, even when its window was wrong (closed too early, or missed entirely). The only remedy is a manual note or a correction reflected in the cashier's NEXT close; the recorded row itself never changes.

### A sale with no `splits` array is counted as zero, not flagged

`splits` is `v.optional` on the sale schema (rows predating split payments, if any, lack it). Such a sale contributes nothing to either currency — silently, not as an error. In practice each cashier's own explicit `openedAt` on adoption is expected to keep such history out of any window, but the schema does not enforce that boundary.
