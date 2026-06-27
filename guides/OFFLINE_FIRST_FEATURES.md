# Offline-First Features to Implement

## 1. PWA App Shell

- Configure the app as an installable PWA.
- Add `manifest.webmanifest`.
- Add app icons for mobile and desktop installation.
- Add a service worker.
- Cache the application shell:
  - HTML
  - JavaScript
  - CSS
  - icons
  - static assets
- Ensure the app can open without internet after the first successful load.
- Show an offline fallback screen if the app shell cannot load.

## 2. Local Database

- Add a local IndexedDB database.
- Use Dexie.js or an equivalent IndexedDB wrapper.
- Store local copies of critical app data:
  - products
  - barcodes
  - categories
  - prices
  - stock snapshots
  - customers
  - cashier profile
  - store settings
  - tax settings
- Add database versioning for future migrations.
- Add indexes for:
  - product ID
  - barcode
  - SKU
  - product name
  - sync status
  - created date

## 3. Product Cache

- Sync active products from Convex to IndexedDB.
- Store product data locally for offline search.
- Store barcode mappings locally.
- Store product price locally.
- Store last known stock snapshot locally.
- Store product active/inactive status locally.
- Store product `updatedAt` timestamp.
- Support incremental product cache updates.
- Support full product cache refresh.
- Mark deleted or disabled products locally instead of silently removing them.

## 4. Offline Product Search

- Allow product search while offline.
- Search by barcode.
- Search by SKU.
- Search by product name.
- Search by category.
- Allow scanning a barcode offline and matching it against the local product cache.
- Show a clear warning that stock and prices may be outdated while offline.

## 5. Local Cart

- Allow creating a cart while offline.
- Store cart drafts locally.
- Recover the last cart if the browser is closed or refreshed.
- Support adding products from local cache.
- Support changing item quantity.
- Support removing items.
- Support clearing the cart.
- Calculate subtotal locally.
- Calculate discounts locally only if rules are cached and safe.
- Calculate tax locally only if tax settings are cached and safe.
- Show that the cart is offline/pending when there is no connection.

## 6. Pending Operation Queue

- Create a durable local queue for offline writes.
- Store every offline write as a pending operation.
- Supported pending operation types:
  - `SALE_CREATE`
  - `STOCK_ADJUSTMENT`
  - `CUSTOMER_CREATE`
  - `PRODUCT_CREATE_DRAFT`
- Each pending operation must include:
  - local operation ID
  - operation type
  - payload
  - idempotency key
  - status
  - attempt count
  - created date
  - updated date
  - last error
- Operation statuses:
  - `pending`
  - `syncing`
  - `synced`
  - `failed`
  - `conflict`
  - `cancelled`

## 7. Offline Sale Creation

- Allow creating a sale while offline.
- Store the sale locally first.
- Create a pending `SALE_CREATE` operation.
- Generate a local sale ID.
- Generate a local receipt number.
- Mark the receipt as `PENDING_SYNC`.
- Show pending sales in the sales history.
- Prevent pending sales from being shown as final official sales.
- Allow retrying failed pending sales.
- Allow cancelling a pending sale before it syncs.

## 8. Official Sale Sync

- Create a Convex mutation to sync pending sales.
- The mutation must be idempotent.
- The mutation must accept an `idempotencyKey`.
- If the same operation is retried, return the existing sale instead of creating a duplicate.
- On successful sync:
  - create official sale
  - create sale items
  - create payment record
  - create stock movements
  - update inventory balances
  - return official sale number
  - return official receipt data
- Update the local sale from `PENDING_SYNC` to `SYNCED`.
- Replace or link the local receipt number with the official sale number.

## 9. Idempotency

- Every offline operation must have a unique idempotency key.
- Store idempotency keys locally.
- Store idempotency keys in Convex.
- Add Convex indexes for idempotency lookup.
- Return the existing result when the same idempotency key is received again.
- Use idempotency for:
  - sales
  - payments
  - stock adjustments
  - refunds
  - customer creation

## 10. Inventory Safety

- Treat Convex as the server source of truth.
- Treat local stock as a snapshot, not final truth.
- Validate stock again on the server during sync.
- Do not blindly trust offline stock.
- Do not allow unsafe offline stock adjustments by default.
- Add product-level offline settings:
  - `allowOfflineSales`
  - `offlineMaxQuantity`
  - `allowNegativeStock`
- If stock is insufficient during sync, mark the operation as `conflict`.
- Do not silently force stock negative unless a supervisor rule allows it.

## 11. Stock Movements

- Create a stock movement for every inventory change.
- Never update inventory balance without a movement record.
- Stock movement types:
  - `SALE`
  - `RETURN`
  - `MANUAL_ADJUSTMENT`
  - `PURCHASE_ENTRY`
  - `DAMAGED`
  - `EXPIRED`
  - `TRANSFER`
  - `SYNC_CORRECTION`
- Each stock movement must include:
  - product ID
  - warehouse/store ID
  - quantity
  - direction
  - reference type
  - reference ID
  - created by
  - created at
  - source device ID if applicable

## 12. Sync Engine

- Add a client-side sync engine.
- Run sync when:
  - the app starts
  - the internet connection returns
  - Convex reconnects
  - the user clicks “Sync now”
  - a new pending operation is created
- Process pending operations in order.
- Mark operations as `syncing` before sending.
- Mark operations as `synced` after success.
- Mark operations as `failed` after temporary errors.
- Mark operations as `conflict` after business-rule conflicts.
- Add retry with backoff.
- Limit maximum retry attempts.
- Prevent multiple sync loops from running at the same time.

## 13. Connection State

- Detect online/offline status.
- Detect Convex connection status.
- Show a persistent connection indicator.
- Connection states:
  - `online`
  - `offline`
  - `reconnecting`
  - `syncing`
  - `sync_failed`
- Do not rely only on `navigator.onLine`.
- Use Convex connection state when available.
- Show the number of pending operations.

## 14. Sync Status UI

- Show sync status clearly in the app.
- Show pending operation count.
- Show last successful sync time.
- Show failed sync count.
- Show conflict count.
- Add a “Sync now” action.
- Add a pending sales screen.
- Add a failed operations screen.
- Add a conflict resolution screen.
- Warn cashiers when they are selling offline.

## 15. Conflict Detection

- Detect conflicts during sync.
- Minimum conflict types:
  - `STOCK_INSUFFICIENT`
  - `PRODUCT_DELETED`
  - `PRODUCT_DISABLED`
  - `PRICE_CHANGED`
  - `TAX_CHANGED`
  - `CUSTOMER_NOT_FOUND`
  - `DUPLICATE_OPERATION`
  - `AUTH_EXPIRED`
  - `PERMISSION_DENIED`
- Store conflict details locally.
- Show clear conflict messages to the user.
- Do not delete conflicted operations automatically.

## 16. Conflict Resolution

- Add a manual conflict resolution flow.
- Allow resolving stock conflicts by:
  - adjusting quantity
  - cancelling the local sale
  - retrying after stock correction
  - supervisor override if allowed
- Allow resolving price conflicts by:
  - keeping offline price if policy allows
  - updating to current price
  - cancelling the sale
- Keep a record of who resolved the conflict.
- Keep a record of when the conflict was resolved.

## 17. Offline Receipts

- Generate local receipts for offline sales.
- Mark local receipts as `PENDING_SYNC`.
- Show a visible warning on pending receipts.
- Generate official receipts only after server sync.
- Link local receipt to official sale after sync.
- Allow printing/downloading pending receipts if business policy allows.
- Allow reprinting official receipts after sync.

## 18. Admin Restrictions Offline

- Restrict risky admin actions while offline.
- Do not allow offline:
  - deleting products
  - changing prices
  - creating users
  - changing roles
  - large stock adjustments
  - refunds
  - tax configuration changes
  - official invoice generation
- Allow offline:
  - viewing cached products
  - viewing cached inventory
  - creating product drafts
  - creating customer drafts
  - creating pending sales

## 19. Device Identity

- Generate a unique local device ID.
- Store the device ID locally.
- Include device ID in offline operations.
- Include device ID in synced sales.
- Include device ID in audit logs.
- Use device ID to debug sync issues.
- Optionally register trusted devices per store.

## 20. Audit Logs

- Create local sync logs.
- Create server audit logs in Convex.
- Track:
  - operation created locally
  - operation synced
  - operation failed
  - operation conflicted
  - operation resolved
  - operation cancelled
- Track user ID.
- Track device ID.
- Track timestamps.
- Track original payload when safe.
- Track server result ID.

## 21. Local Data Cleanup

- Add cleanup rules for old synced operations.
- Keep recent synced operations for a configurable period.
- Do not delete pending, failed, or conflicted operations.
- Add a manual maintenance action for admin users.
- Add storage usage monitoring.
- Warn the user if local storage is near quota.

## 22. Local Backup and Recovery

- Recover pending operations after app reload.
- Recover cart drafts after app reload.
- Recover pending sales after browser restart.
- Prevent data loss if the tab closes during sync.
- Avoid clearing IndexedDB during normal logout unless explicitly requested.
- Add a safe “reset local data” option for admins only.
- Warn before deleting local pending data.

## 23. Service Worker Update Flow

- Detect when a new app version is available.
- Show an update prompt.
- Avoid updating while a sale is in progress.
- Avoid updating while operations are syncing.
- Allow the user to refresh after current work is safe.
- Show current app version somewhere in settings.

## 24. Security

- Store only necessary data locally.
- Do not store raw passwords locally.
- Do not store long-lived sensitive secrets in IndexedDB.
- Encrypt highly sensitive local data if required.
- Require re-authentication after token expiration.
- Handle expired sessions during sync.
- Mark pending operations as `AUTH_EXPIRED` if sync fails due to authentication.
- Restrict conflict override to authorized roles.

## 25. Testing Requirements

- Test app launch while offline.
- Test product search while offline.
- Test barcode scanning against local cache.
- Test pending sale creation offline.
- Test app reload with pending sales.
- Test sync after reconnecting.
- Test duplicate sync attempts.
- Test idempotency.
- Test stock conflict.
- Test product disabled conflict.
- Test price changed conflict.
- Test auth expired during sync.
- Test service worker update during an active sale.
- Test IndexedDB persistence after browser restart.
- Test storage quota behavior.
- Test multiple cashiers selling the same product.
- Test poor connection and intermittent reconnects.

## 26. Recommended Implementation Order

1. Add PWA installability and app shell caching.
2. Add IndexedDB/Dexie local database.
3. Add product cache from Convex to IndexedDB.
4. Add offline product search.
5. Add local cart persistence.
6. Add pending operation queue.
7. Add offline pending sale creation.
8. Add idempotent Convex sale mutation.
9. Add sync engine.
10. Add sync status UI.
11. Add offline receipt status.
12. Add conflict detection.
13. Add conflict resolution UI.
14. Add admin restrictions while offline.
15. Add audit logs.
16. Add cleanup and recovery tools.
17. Add full offline-first test suite.
