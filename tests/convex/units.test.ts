// Unit 3 — the base unit a product is sold in (product-base-unit).
// The catalogue is PURE data so the server's validator and every screen's label
// come from one list. "May this be fractional" is DERIVED from the unit rather
// than stored beside it, so the two can never disagree.
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_UNIT,
  PRODUCT_UNITS,
  formatQty,
  isMeasured,
  unitLabel,
} from '@convex/units';

describe('the unit catalogue', () => {
  test('covers the thirteen units the store actually uses', () => {
    expect(PRODUCT_UNITS.map((u) => u.id)).toEqual([
      'unit',
      'bottle',
      'crate',
      'can',
      'jar',
      'bag',
      'pack',
      'keg',
      'pallet',
      'liter',
      'milliliter',
      'kilogram',
      'gram',
    ]);
  });

  test('the default is the counted unit, and it comes first', () => {
    expect(DEFAULT_UNIT).toBe('unit');
    expect(PRODUCT_UNITS[0].id).toBe(DEFAULT_UNIT);
  });

  test('every unit carries a Spanish label and both short forms', () => {
    for (const unit of PRODUCT_UNITS) {
      expect(unit.label.length).toBeGreaterThan(0);
      expect(typeof unit.short).toBe('string');
      expect(typeof unit.shortPlural).toBe('string');
    }
  });
});

describe('isMeasured — which units accept a fraction', () => {
  test('the four measures do', () => {
    expect(['liter', 'milliliter', 'kilogram', 'gram'].map(isMeasured)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test('the default and every packaging form do NOT', () => {
    const counted = [
      'unit',
      'bottle',
      'crate',
      'can',
      'jar',
      'bag',
      'pack',
      'keg',
      'pallet',
    ];
    expect(counted.map(isMeasured)).toEqual(counted.map(() => false));
  });

  test('an absent unit is counted — that is what every existing product is', () => {
    expect(isMeasured(undefined)).toBe(false);
    expect(isMeasured('')).toBe(false);
  });

  test('an unknown unit is counted, never fractional by accident', () => {
    // A value the catalogue does not know must fail CLOSED: allowing a fraction
    // for it would let a bad write turn crates into half-crates.
    expect(isMeasured('parsec')).toBe(false);
  });
});

describe('formatQty — a quantity is never ambiguous about what it counts', () => {
  test('the default unit shows a bare number, as it always has', () => {
    expect(formatQty(2, 'unit')).toBe('2');
    expect(formatQty(2, undefined)).toBe('2');
  });

  test('a measured unit carries its symbol, singular or not', () => {
    expect(formatQty(1, 'kilogram')).toBe('1 kg');
    expect(formatQty(1.5, 'kilogram')).toBe('1.5 kg');
    expect(formatQty(500, 'gram')).toBe('500 g');
    expect(formatQty(1.5, 'liter')).toBe('1.5 L');
    expect(formatQty(750, 'milliliter')).toBe('750 ml');
  });

  test('a packaging unit agrees in number with its quantity', () => {
    // "2 caja" reads like a bug. The plural is stored, not guessed by adding an
    // s — `barril` would come out `barrils`.
    expect(formatQty(1, 'crate')).toBe('1 caja');
    expect(formatQty(2, 'crate')).toBe('2 cajas');
    expect(formatQty(1, 'keg')).toBe('1 barril');
    expect(formatQty(3, 'keg')).toBe('3 barriles');
  });

  test('a fraction keeps only the digits it needs', () => {
    expect(formatQty(2.0, 'kilogram')).toBe('2 kg');
    expect(formatQty(0.25, 'kilogram')).toBe('0.25 kg');
    // Float noise from arithmetic must not reach the screen.
    expect(formatQty(0.1 + 0.2, 'kilogram')).toBe('0.3 kg');
  });
});

describe('unitLabel — what the product form offers', () => {
  test('names the unit in Spanish', () => {
    expect(unitLabel('kilogram')).toBe('Kilogramo');
    expect(unitLabel('crate')).toBe('Caja');
  });

  test('an absent unit reads as the default rather than blank', () => {
    expect(unitLabel(undefined)).toBe('Unidad');
  });
});
