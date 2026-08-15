# Cash Flow Report Specification

## Purpose

Server-side aggregation of income (sale totals) and expenses (purchase totals) over a caller-supplied window, feeding the Dashboard's cash-flow tiles. This is cash flow — money in minus money out — not profit: the schema has no cost-of-goods-sold field (products carry only the selling price; a purchase carries one global `total`), so margin is not computable and `reports.cashFlow` MUST NOT be documented or labeled as profit.

## Requirements

### Requirement: Aggregation Runs Server-Side and Returns Figures Only

`reports.cashFlow` MUST compute `income`, `expenses`, and `net` on the server and MUST return only `income`, `expenses`, `net`, `salesCount`, `purchasesCount`, and `truncated` — never sale or purchase documents or line items.

#### Scenario: Happy path

- GIVEN a window containing several sales and purchases
- WHEN `reports.cashFlow` is called for that window
- THEN it returns the six aggregate fields and no documents or items

### Requirement: Income, Expenses, and Net Are Defined by soldAt / createdAt

Income MUST be the sum of `sale.total` for sales whose `soldAt` falls within the window. Expenses MUST be the sum of `purchase.total` for purchases whose `createdAt` falls within it, plus refund attribution (below). Net MUST equal income minus expenses.

#### Scenario: Mixed window

- GIVEN sales totalling $500 and purchases totalling $300 in the window
- WHEN `reports.cashFlow` is called
- THEN `income` is 500, `expenses` is 300, `net` is 200

#### Scenario: Empty window

- GIVEN no sale or purchase falls in the window
- WHEN `reports.cashFlow` is called
- THEN `income`, `expenses`, `net` are all 0 and the call does not throw

### Requirement: The Window Is an Inclusive Epoch-Millisecond Range; the Server Does No Timezone Arithmetic

`from`/`to` MUST be treated as an inclusive epoch-millisecond window exactly as received. The server MUST NOT convert or reinterpret them against any timezone — local-period boundaries (e.g. a Venezuela, UTC-4, calendar month) are the caller's responsibility.

#### Scenario: Sale near a local midnight boundary

- GIVEN a shop in Venezuela (UTC-4) and a sale sold at 23:50 local time on March 31
- WHEN the client computes March's boundaries in local time and calls `reports.cashFlow` with the resulting epoch-ms `to`
- THEN the sale's total is included in March's `income`, not April's

### Requirement: A Refunded Sale Splits Across Two Periods and Never Rewrites the Past

A refunded sale MUST count as income in the period it was sold (`soldAt`) and as an expense in the period it was refunded (`sale.refund.date`). Its contribution to a past period's `income` MUST NOT change once that period has passed.

#### Scenario: Refund crosses periods

- GIVEN a sale sold in period P1 for $50 and refunded in period P2
- WHEN `reports.cashFlow` is called for P1, then for P2
- THEN P1's `income` includes the $50 and `expenses` does not; P2's `expenses` includes the $50

#### Scenario: Past figures stay stable after the fact

- GIVEN `reports.cashFlow` was called for P1 before the refund happened
- WHEN it is called again for P1 after the refund
- THEN P1's `income` is identical both times

### Requirement: A Capped Window Reports truncated, Never a Short Total

The server MUST read up to `cap + 1` sales and up to `cap + 1` purchases per window. `truncated` MUST be a single flag, true whenever EITHER probe exceeds `cap` — never a per-side flag, never a silently short sum.

#### Scenario: One side exceeds the cap

- GIVEN a window with more than `cap` purchases and fewer than `cap` sales
- WHEN `reports.cashFlow` is called
- THEN `truncated` is true

#### Scenario: Both sides under the cap

- GIVEN a window with fewer than `cap` sales and purchases
- WHEN `reports.cashFlow` is called
- THEN `truncated` is false

### Requirement: view_reports Is Enforced Server-Side

`reports.cashFlow` MUST verify the session's employee holds `view_reports` before computing any figures, independent of any client-side check. Because this reuses the permission behind `sales.history`, any employee who may already read sales history can now also see what the shop pays its suppliers — an accepted consequence of reuse.

#### Scenario: Denied

- GIVEN a valid session for an employee without `view_reports`
- WHEN `reports.cashFlow` is called directly
- THEN it throws, regardless of what any client currently renders

#### Scenario: Granted

- GIVEN a valid session for an employee with `view_reports`
- WHEN `reports.cashFlow` is called
- THEN it returns figures

## Known Limitations

> Deliberately NOT a requirement. What follows describes behaviour that exists
> today and that this change does not fix. Writing it as a `Requirement` with a
> MUST would harden an accepted gap into a normative rule the moment these specs
> are merged — and a rule nothing tests, which is the worst kind. Recorded here
> so a reader learns the limitation without the archive turning it into law.

### Deleting a purchase retroactively lowers a past period's expenses

`purchases.remove` hard-deletes the purchase document (`convex/purchases.ts:184`), and `expenses` is recomputed live from whatever `purchases` rows still exist rather than from an immutable ledger. So a past period's `expenses` and `net` are not fixed while a purchase inside that period can still be deleted.

This is the inverse of how refunds behave, and the inconsistency is real: a refunded sale never changes the `income` of the period it was sold in — it is recorded as an expense in the period it was refunded — precisely so a report printed yesterday still matches today. A deleted purchase gets no such treatment.

Closing it means a soft delete or a tombstone on `purchases`, which is out of scope here. Until then, a cash-flow figure for a closed period is reproducible on the income side and only as stable as the purchase rows on the expense side.
