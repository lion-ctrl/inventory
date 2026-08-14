// Unit 3 — reading a typed quantity (product-base-unit). One parser for every
// quantity input in the app, so a product accepted in the cart is accepted in a
// purchase and vice versa.
import { describe, expect, test } from 'vitest';
import { normalizeQty, parseQty, qtyToInput } from '@/lib/qty';

describe('parseQty — counted units keep their old behaviour exactly', () => {
  test('reads a whole number', () => {
    expect(parseQty('12', undefined)).toBe(12);
    expect(parseQty('12', 'crate')).toBe(12);
  });

  test('keeps only the digits, as the stepper always has', () => {
    // Not a new rule: `parseInt(raw.replace(/\D/g, ''))` is what every quantity
    // input did before units existed, and a counted product must not change.
    expect(parseQty('1.5', undefined)).toBe(15);
    expect(parseQty('1.000', undefined)).toBe(1000);
    expect(parseQty('3 cajas', 'crate')).toBe(3);
  });

  test('nothing usable reads as nothing, never as zero', () => {
    // null and 0 are different answers: 0 is a quantity the caller would clamp,
    // null means "the field is mid-edit, leave the value alone".
    expect(parseQty('', undefined)).toBeNull();
    expect(parseQty('abc', undefined)).toBeNull();
  });
});

describe('parseQty — measured units accept a fraction', () => {
  test('reads a decimal point', () => {
    expect(parseQty('1.5', 'kilogram')).toBe(1.5);
    expect(parseQty('0.25', 'kilogram')).toBe(0.25);
  });

  test('reads a decimal COMMA, which is what a Spanish keyboard gives', () => {
    expect(parseQty('1,5', 'kilogram')).toBe(1.5);
  });

  test('a leading separator is read as a leading zero', () => {
    expect(parseQty('.5', 'liter')).toBe(0.5);
    expect(parseQty(',5', 'liter')).toBe(0.5);
  });

  test('only the FIRST separator counts', () => {
    // Someone typing over an existing value produces this constantly.
    expect(parseQty('1.5.5', 'kilogram')).toBe(1.55);
  });

  test('rounds to the precision a scale actually has', () => {
    expect(parseQty('1.23456', 'kilogram')).toBe(1.235);
  });

  test('nothing usable still reads as nothing', () => {
    expect(parseQty('', 'kilogram')).toBeNull();
    expect(parseQty('.', 'kilogram')).toBeNull();
    expect(parseQty('kg', 'kilogram')).toBeNull();
  });
});

describe('qtyToInput — what the field shows back', () => {
  test('a counted quantity keeps the thousands grouping it always had', () => {
    // Spanish groups from FIVE digits, not four: 1000 stays 1000.
    expect(qtyToInput(10000, undefined)).toBe('10.000');
    expect(qtyToInput(3, 'crate')).toBe('3');
  });

  test('a measured quantity shows a plain decimal, with no grouping', () => {
    // Grouping and a decimal separator cannot coexist here: `es` writes one
    // thousand as `1.000`, and reading that back as a decimal would give 1.
    expect(qtyToInput(1.5, 'kilogram')).toBe('1.5');
    expect(qtyToInput(2, 'kilogram')).toBe('2');
    expect(qtyToInput(1000, 'kilogram')).toBe('1000');
  });

  test('what the field shows can always be read back', () => {
    for (const [n, unit] of [
      [1.5, 'kilogram'],
      [0.25, 'liter'],
      [12, 'crate'],
      [10000, undefined],
    ] as const) {
      expect(parseQty(qtyToInput(n, unit), unit)).toBe(n);
    }
  });
});

// normalizeQty reads a COMPLETE value, parseQty reads one being TYPED. Conflating
// them inflated stock tenfold: the counted branch of parseQty strips the decimal
// separator, so a stored "2.5" arrived as 25.
describe('normalizeQty — reading a value that is already in the field', () => {
  test('a fractional value under a COUNTED unit floors, never inflates', () => {
    expect(normalizeQty('2.5', 'crate')).toBe(2);
    expect(normalizeQty('2,5', 'crate')).toBe(2);
  });

  test('the same string under a MEASURED unit keeps its fraction', () => {
    expect(normalizeQty('2.5', 'kilogram')).toBe(2.5);
    expect(normalizeQty('2,5', 'kilogram')).toBe(2.5);
  });

  test('flooring is chosen over rounding: stock is inventory, not a statistic', () => {
    // 2.5 crates rounded UP would invent half a crate that is not on the shelf.
    expect(normalizeQty('2.9', 'crate')).toBe(2);
  });

  test('an unreadable field yields null rather than a fabricated zero', () => {
    expect(normalizeQty('', 'kilogram')).toBeNull();
    expect(normalizeQty('abc', 'crate')).toBeNull();
  });

  test('reads back the plain String(n) the product form is seeded with', () => {
    // This is the ACTUAL input: the form seeds `String(initial.stock)`, never a
    // grouped or localised string. Every stored value must survive the trip.
    for (const [n, unit] of [
      [2.5, 'kilogram'],
      [0.25, 'liter'],
      [12, 'crate'],
      [10000, 'crate'],
      [10000, undefined],
    ] as const) {
      expect(normalizeQty(String(n), unit)).toBe(n);
    }
  });

  test('does NOT accept a grouped string — that is qtyToInput territory', () => {
    // `es` writes ten thousand as '10.000', and reading that as a decimal gives
    // 10. normalizeQty deliberately does not try to disambiguate a grouping dot
    // from a decimal one, because '2.5' and '10.000' cannot both be resolved
    // from the string alone. The cart and purchase inputs pair qtyToInput with
    // parseQty; the product form pairs String(n) with normalizeQty. Mixing the
    // pairs is the bug, and this test exists so nobody wires them together.
    expect(qtyToInput(10000, 'crate')).toBe('10.000');
    expect(normalizeQty('10.000', 'crate')).toBe(10);
  });
});
