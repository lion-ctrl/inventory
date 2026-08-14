/**
 * The base unit a product is sold in — a PURE module, deliberately free of
 * Convex imports so the schema's validator, the server's guards and every screen
 * that shows a quantity all read the same catalogue. Reached from `src/` through
 * the `@convex/*` alias, one way only (see AGENTS.md rule 6).
 *
 * The single most important property here: whether a product may be sold in
 * fractions is DERIVED from its unit rather than stored next to it. A separate
 * `allowsFractions` flag is a second source of truth, and the day it disagrees
 * with the unit you get half a crate.
 */

interface ProductUnit {
  id: string;
  /** Shown in the product form's selector. */
  label: string;
  /** Shown beside a quantity of exactly one. Empty for the default unit. */
  short: string;
  /** Shown beside any other quantity — stored, not guessed. */
  shortPlural: string;
  /** Measured units are continuous, so a fraction of one is a real amount. */
  measured: boolean;
}

/**
 * The thirteen units of the catalogue this app was modelled on, in the order the
 * form offers them: the default first, then packaging forms, then measures.
 * A custom unit is deliberately NOT offered — see the change's design.
 */
export const PRODUCT_UNITS = [
  { id: 'unit', label: 'Unidad', short: '', shortPlural: '', measured: false },
  {
    id: 'bottle',
    label: 'Botella',
    short: 'botella',
    shortPlural: 'botellas',
    measured: false,
  },
  {
    id: 'crate',
    label: 'Caja',
    short: 'caja',
    shortPlural: 'cajas',
    measured: false,
  },
  {
    id: 'can',
    label: 'Lata',
    short: 'lata',
    shortPlural: 'latas',
    measured: false,
  },
  {
    id: 'jar',
    label: 'Frasco',
    short: 'frasco',
    shortPlural: 'frascos',
    measured: false,
  },
  {
    id: 'bag',
    label: 'Bolsa',
    short: 'bolsa',
    shortPlural: 'bolsas',
    measured: false,
  },
  {
    id: 'pack',
    label: 'Paquete',
    short: 'paquete',
    shortPlural: 'paquetes',
    measured: false,
  },
  // `barriles`, not `barrils` — which is why the plural is stored rather than
  // produced by appending an s.
  {
    id: 'keg',
    label: 'Barril',
    short: 'barril',
    shortPlural: 'barriles',
    measured: false,
  },
  {
    id: 'pallet',
    label: 'Paleta',
    short: 'paleta',
    shortPlural: 'paletas',
    measured: false,
  },
  {
    id: 'liter',
    label: 'Litro',
    short: 'L',
    shortPlural: 'L',
    measured: true,
  },
  {
    id: 'milliliter',
    label: 'Mililitro',
    short: 'ml',
    shortPlural: 'ml',
    measured: true,
  },
  {
    id: 'kilogram',
    label: 'Kilogramo',
    short: 'kg',
    shortPlural: 'kg',
    measured: true,
  },
  { id: 'gram', label: 'Gramo', short: 'g', shortPlural: 'g', measured: true },
  // `as const satisfies` keeps every id a literal type — which is what lets the
  // schema build its validator FROM this list instead of restating it — while
  // still checking each entry against the shape above.
] as const satisfies readonly ProductUnit[];

/** Every unit the catalogue knows, as a type. Derived, never restated. */
export type ProductUnitId = (typeof PRODUCT_UNITS)[number]['id'];

/**
 * What every absent or unrecognised unit falls back to. Taken from the
 * catalogue's first entry rather than looked up by id: the list is a literal, so
 * the compiler knows it is not empty and no non-null assertion is needed to say
 * so — and the fallback cannot drift from the catalogue, because it IS the
 * catalogue's first row.
 */
const FALLBACK_UNIT = PRODUCT_UNITS[0];

/**
 * What a product with no declared unit is. Every product created before this
 * capability existed is one of these, which is why the field stays optional and
 * needs no backfill. Derived from the fallback so the two can never disagree.
 */
export const DEFAULT_UNIT = FALLBACK_UNIT.id;

// Keyed by plain `string`, not by `ProductUnitId`: every caller reaches this
// with a value read off a document or a form, and the whole job of `lookup` is
// to answer for one the catalogue may not know.
const BY_ID = new Map<string, ProductUnit>(
  PRODUCT_UNITS.map((unit) => [unit.id, unit])
);

/** The catalogue entry for a unit, falling back to the default. */
function lookup(unit?: string): ProductUnit {
  return BY_ID.get(unit ?? DEFAULT_UNIT) ?? FALLBACK_UNIT;
}

/**
 * May this product be sold in fractions? Absent and UNKNOWN units both answer
 * no: failing closed means a value the catalogue does not recognise can never
 * turn crates into half-crates.
 */
export function isMeasured(unit?: string): boolean {
  return BY_ID.get(unit ?? DEFAULT_UNIT)?.measured ?? false;
}

/** The unit's Spanish name, as the product form's selector shows it. */
export function unitLabel(unit?: string): string {
  return lookup(unit).label;
}

/** Quantities are entered by hand, so three decimals is past any real precision. */
const QTY_DECIMALS = 3;

/**
 * Round a quantity to the precision the app actually keeps, dropping the float
 * noise arithmetic leaves behind (`0.1 + 0.2`). Exported so the parser that
 * READS a quantity and the formatter that SHOWS it round identically — two
 * copies of a rounding rule is how a scale reading and its label drift apart.
 */
export function roundQty(n: number): number {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round(n * factor) / factor;
}

/**
 * A quantity with its unit, so `2` is never ambiguous between two pieces and two
 * crates. The default unit renders bare — a plain number is exactly what it has
 * always meant, and `2 unidades` is noise on every line of every screen.
 */
export function formatQty(qty: number, unit?: string): string {
  const entry = lookup(unit);
  // `String` drops the trailing zeros a `toFixed` would have added.
  const n = String(roundQty(qty));
  const suffix = qty === 1 ? entry.short : entry.shortPlural;
  return suffix ? `${n} ${suffix}` : n;
}
