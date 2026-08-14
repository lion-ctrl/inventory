// Unit 4 — the SKU derives itself from the product name (product-sku-generation).
// This module is PURE on purpose: the form previews the code the server is about
// to assign, and a preview that disagrees with what gets stored is worse than no
// preview at all. One function, two callers, one answer.
import { describe, expect, test } from 'vitest';
import { nextFreeSku, skuFromName } from '@convex/sku';

describe('skuFromName — a readable code out of a shop name', () => {
  test('folds accents, upper-cases, and joins words with a single hyphen', () => {
    expect(skuFromName('Café con leche 250g')).toBe('CAFE-CON-LECHE-250G');
  });

  test('punctuation inside a word does not fragment it', () => {
    // "P.A.N." is one word to a human, and three to a naive split. Getting this
    // wrong on a Venezuelan shelf is not a corner case — it is the flour aisle.
    expect(skuFromName('Harina P.A.N. 1kg')).toBe('HARINA-PAN-1KG');
  });

  test('an already-hyphenated name keeps one hyphen per break', () => {
    expect(skuFromName('Coca-Cola 600ml')).toBe('COCA-COLA-600ML');
  });

  test('collapses runs of spaces rather than emitting empty segments', () => {
    expect(skuFromName('  Agua   mineral  1L ')).toBe('AGUA-MINERAL-1L');
  });

  test('a long name is cut at a word boundary, never mid-word', () => {
    const sku = skuFromName(
      'Refresco de naranja natural sin azúcar 1.5 litros'
    );
    expect(sku).toBe('REFRESCO-DE-NARANJA');
    expect(sku.length).toBeLessThanOrEqual(20);
  });

  test('a single word longer than the bound is truncated, not dropped', () => {
    // There is no word boundary to cut at here, and returning the fallback would
    // throw away the only information the name carries.
    expect(skuFromName('Supercalifragilisticoexpialidoso')).toBe(
      'SUPERCALIFRAGILISTIC'
    );
  });

  test('a name with no usable characters still yields a valid SKU', () => {
    expect(skuFromName('🥤🥤🥤')).toBe('PROD');
    expect(skuFromName('   ')).toBe('PROD');
    expect(skuFromName('')).toBe('PROD');
  });

  test('the ñ folds to N rather than disappearing', () => {
    expect(skuFromName('Piña colada')).toBe('PINA-COLADA');
  });
});

describe('nextFreeSku — the smallest suffix that frees the code', () => {
  test('an untaken code is returned as-is, with no suffix', () => {
    expect(nextFreeSku('CAFE', new Set<string>())).toBe('CAFE');
  });

  test('the second and third product of a name get -2 and -3', () => {
    expect(nextFreeSku('CAFE', new Set(['CAFE']))).toBe('CAFE-2');
    expect(nextFreeSku('CAFE', new Set(['CAFE', 'CAFE-2']))).toBe('CAFE-3');
  });

  test('a hole in the sequence is filled rather than skipped', () => {
    // -2 was freed by a deletion. Reusing it keeps codes short and is safe:
    // nothing references a SKU that no longer exists.
    expect(nextFreeSku('CAFE', new Set(['CAFE', 'CAFE-3']))).toBe('CAFE-2');
  });

  test('a longer code sharing the prefix is not mistaken for a collision', () => {
    // 'CAFE-CON-LECHE' starts with 'CAFE' and comes back in the same indexed
    // read, but it is a different product's base — not this code, taken.
    expect(nextFreeSku('CAFE', new Set(['CAFE-CON-LECHE']))).toBe('CAFE');
  });

  test('returns null when the attempt bound is exhausted, never a reused code', () => {
    const taken = new Set(['CAFE', 'CAFE-2', 'CAFE-3']);
    expect(nextFreeSku('CAFE', taken, 3)).toBeNull();
    expect(nextFreeSku('CAFE', taken, 4)).toBe('CAFE-4');
  });
});
