// Phase 6.2 — the durable pending-ops queue (OFFLINE_FIRST_FEATURES §6).
//
// Every offline write becomes one row in `db.pendingOps` (the Phase 0.2 shape).
// This module only ENQUEUES; draining/syncing (status transitions, retries, op
// deletion) is the sync engine's job (Phase 6.4). A queued op is NEVER deleted
// here — logout preserves it (Phase 0.4) and only the sync engine removes it,
// after the backend confirms receipt.
import { db } from './db';
import type { PendingOp, PendingOpType } from './db';

// The stable device id is seeded once into `meta` on first run (db.on('populate'),
// FEATURES §19). Read it for every op; self-heal by minting one if it is somehow
// absent (e.g. a partially-initialised store) so `deviceId` is always a string.
async function resolveDeviceId(): Promise<string> {
  const row = await db.meta.get('deviceId');
  if (row && typeof row.value === 'string') return row.value;
  const id = crypto.randomUUID();
  await db.meta.put({ key: 'deviceId', value: id });
  return id;
}

/**
 * Append an offline write to the durable queue. Generates the `idempotencyKey`
 * at ENQUEUE time (persisted with the op so retries reuse it — the server's
 * `by_idempotencyKey` index makes replays return the existing row, never a
 * duplicate; OFFLINE_FIRST_PLAN §6.3, Risk 3). Starts `pending` with `attempts`
 * at 0. Returns the auto-incremented `localId`.
 */
export async function enqueuePendingOp(
  type: PendingOpType,
  payload: unknown
): Promise<number> {
  const now = Date.now();
  const op: PendingOp = {
    idempotencyKey: crypto.randomUUID(),
    type,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    deviceId: await resolveDeviceId(),
  };
  // add() resolves the auto-incremented ++localId (typed number | undefined by the
  // optional PK; the counter always yields a number).
  return (await db.pendingOps.add(op)) as number;
}
