// Unit 3 — reading a typed quantity (product-base-unit). One parser for every
// quantity input in the app, so a product accepted in the cart is accepted in a
// purchase and vice versa.
import { describe, expect, test } from 'vitest';
import { parseQty, qtyToInput } from '@/lib/qty';

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
