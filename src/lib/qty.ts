import { isMeasured, roundQty } from '@convex/units';

/**
 * Reading and writing a typed quantity, per the product's base unit.
 *
 * One parser for every quantity input in the app — the cart line, the sale's
 * stepper, the purchase form — because the spec's promise is that a quantity
 * accepted in one of them is accepted in the others for the same product. Three
 * copies of this logic would be three chances to disagree.
 */

/**
 * What the user typed, as a number — or `null` when nothing usable is there.
 *
 * `null` and `0` are deliberately different answers: `0` is a quantity the
 * caller may clamp, `null` means the field is mid-edit and the current value
 * should be left alone.
 */
export function parseQty(raw: string, unit?: string): number | null {
  if (!isMeasured(unit)) {
    // Byte-identical to what every quantity input did before units existed: a
    // counted product must not change behaviour because this function appeared.
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  // A Spanish keyboard gives a comma, and the field may already be showing a
  // point, so both are the decimal separator. Only the FIRST one counts —
  // typing over an existing value produces `1.5.5` constantly.
  const digitsAndSeparators = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  const firstDot = digitsAndSeparators.indexOf('.');
  const normalized =
    firstDot === -1
      ? digitsAndSeparators
      : digitsAndSeparators.slice(0, firstDot + 1) +
        digitsAndSeparators.slice(firstDot + 1).replace(/\./g, '');

  const n = parseFloat(normalized);
  return Number.isFinite(n) ? roundQty(n) : null;
}

/**
 * Read a COMPLETE quantity string under a unit's rule — one already sitting in a
 * field, not one being typed into it.
 *
 * `parseQty` is for the second case, and for a COUNTED unit it strips every
 * non-digit so a partially typed value behaves exactly as it did before units
 * existed. That is right while typing and catastrophic when reading: it turns
 * the stored `"2.5"` of a product whose unit was later changed to a counted one
 * into 25, inflating inventory tenfold on any unrelated save.
 *
 * Counted units FLOOR: rounding 2.5 up to 3 invents half a kilo that is not on
 * the shelf, and the floored value is visible before saving so it can be fixed.
 *
 * Input is a plain `String(n)` or what was typed — NEVER the grouped output of
 * `qtyToInput`, since `2.5` and `10.000` cannot both be resolved from a string.
 * Cart and purchase fields pair `qtyToInput` with `parseQty`; the product form
 * pairs `String(n)` with this. Mixing the pairs is the bug.
 */
export function normalizeQty(raw: string, unit?: string): number | null {
  const n = parseFloat(raw.replace(/,/g, '.'));
  if (!Number.isFinite(n)) return null;
  return isMeasured(unit) ? roundQty(n) : Math.floor(n);
}

/**
 * What the quantity field shows for a value.
 *
 * A counted quantity keeps the `es` thousands grouping it has always had. A
 * measured one deliberately does NOT get it: `es` writes one thousand as
 * `1.000`, and reading that back as a decimal would give 1. Grouping and a
 * decimal separator cannot share a field, and the decimal is the one that
 * matters here.
 */
export function qtyToInput(n: number, unit?: string): string {
  return isMeasured(unit) ? String(roundQty(n)) : n.toLocaleString('es');
}
