export const DEFAULT_MUTATION_ERROR = 'Ocurrió un error. Intenta de nuevo.';

/**
 * Message for a rejected mutation. A server `ConvexError(data)` reaches the
 * client with its Spanish text on `.data`; anything else — a network failure, a
 * client-side throw — gets the fallback.
 *
 * Narrowed from `unknown` at the boundary: a caught value is not an Error, and
 * typing it `any` would disable checking on every property read after it.
 *
 * Lives here rather than in a screen because Guardados and Proveedores had
 * byte-identical copies of it, and the copy is what rots — one screen gains a
 * case, the other keeps showing the generic message for the same failure.
 */
export function mutationError(
  e: unknown,
  fallback: string = DEFAULT_MUTATION_ERROR
): string {
  const data = (e as { data?: unknown } | null)?.data;
  return typeof data === 'string' ? data : fallback;
}
