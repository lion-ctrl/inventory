/**
 * SKU derivation — a PURE module, deliberately free of Convex imports.
 *
 * The product form previews the code the server is about to assign, and the
 * server assigns it. A preview computed by different logic than the assignment
 * is worse than no preview: it teaches the user a code that then turns out to be
 * a different one. One function, two callers, one answer. The client reaches it
 * through the `@convex/*` alias that `vite.config.ts` and `tsconfig.app.json`
 * already declare.
 */

/**
 * A SKU is read off a shelf label and scanned down a mono column, so length is a
 * usability limit rather than a storage one. Names are cut at a word boundary.
 */
const MAX_LENGTH = 20;

/** For a name that carries no letters or digits at all — an emoji, whitespace. */
const FALLBACK = 'PROD';

/**
 * How many same-prefix codes the collision search will consider. It bounds both
 * the indexed read and the suffix walk, so the two can never disagree about how
 * far they looked.
 */
export const SKU_COLLISION_LIMIT = 200;

/**
 * Derive a readable code from a product name: accents folded, upper-cased,
 * punctuation dropped, words joined by a single hyphen.
 *
 * Word breaks are whitespace and hyphens ONLY. Splitting on every non-alphanumeric
 * character instead would turn `Harina P.A.N. 1kg` into `HARINA-P-A-N-1KG`, and
 * on a Venezuelan shelf that is not a corner case — it is the flour aisle.
 */
export function skuFromName(name: string): string {
  const words = name
    // NFD splits `ñ` into `n` + a combining tilde, which the next line drops —
    // folding the accent instead of deleting the letter under it.
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  if (words.length === 0) return FALLBACK;

  let sku = '';
  for (const word of words) {
    const next = sku ? `${sku}-${word}` : word;
    if (next.length > MAX_LENGTH) break;
    sku = next;
  }

  // A first word longer than the bound leaves nothing behind, and falling back
  // there would throw away the only information the name carries.
  return sku || words[0].slice(0, MAX_LENGTH);
}

/**
 * The smallest suffix that frees `base`, given the codes already taken.
 *
 * Returns `null` when the bound is exhausted rather than a code that might
 * already be in use — a duplicate SKU is silent, and the scanner would resolve
 * it to whichever product it happened to reach first.
 *
 * Holes are filled rather than skipped: nothing references a SKU whose product
 * was deleted, so reusing the gap is safe and keeps codes short.
 */
export function nextFreeSku(
  base: string,
  taken: ReadonlySet<string>,
  limit: number = SKU_COLLISION_LIMIT
): string | null {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= limit; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
