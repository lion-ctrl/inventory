// Phase 6.2 — local ids for entities created offline.
//
// Convex owns every real `_id`: a row's id only exists after the server inserts
// it (OFFLINE_FIRST_PLAN §6.2.1). Offline we can't get one, yet a dependent op
// (a sale) must already reference the entity, so we mint a placeholder
// `local:<uuid>`. The sync engine (Phase 6.4) later creates the real row and
// remaps `local:… → realId` before the dependent op is sent. `isLocalId` lets any
// consumer tell a placeholder apart from a real Convex id.
export const LOCAL_ID_PREFIX = 'local:';

/** Mint a placeholder id for an entity created while offline. */
export function mintLocalId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}

/** True when `id` is a placeholder minted offline (not yet a real Convex id). */
export function isLocalId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_ID_PREFIX);
}
