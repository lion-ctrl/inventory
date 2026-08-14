// The letter shown where a product's photograph would go.
import { describe, expect, test } from 'vitest';
import { initialOf } from '@/lib/initials';

describe('initialOf', () => {
  test('takes the first letter, upper-cased', () => {
    expect(initialOf('Coca-Cola 600ml')).toBe('C');
  });

  test('ignores leading whitespace rather than rendering a blank box', () => {
    expect(initialOf('  agua')).toBe('A');
  });

  test('falls back to ? for a missing or empty name', () => {
    expect(initialOf()).toBe('?');
    expect(initialOf('')).toBe('?');
    expect(initialOf('   ')).toBe('?');
  });

  test('an accented first letter survives as itself', () => {
    expect(initialOf('Ñame')).toBe('Ñ');
  });

  test('an astral first character is not cut in half', () => {
    // Indexing a string takes ONE UTF-16 code unit, so an emoji — two units —
    // would come back as a lone surrogate and render as a replacement box.
    // Products no longer carry emoji, which is exactly why a name is now free
    // to start with one.
    expect(initialOf('🥤 Refresco')).toBe('🥤');
  });
});
