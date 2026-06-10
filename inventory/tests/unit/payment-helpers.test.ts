// Pure money helpers from the payment flow (ported from the prototype).
import { describe, expect, test } from 'vitest';
import {
  METHODS,
  METHOD_CURRENCY,
  RECEIPT_METHOD_LABEL,
  receiptMethod,
  sanitizeAmount,
  splitUsd,
} from '@/screens/Payment';

describe('sanitizeAmount()', () => {
  test('keeps digits and at most one dot with two decimals', () => {
    expect(sanitizeAmount('12.34')).toBe('12.34');
    expect(sanitizeAmount('1.234')).toBe('1.23');
    expect(sanitizeAmount('12a.5.7')).toBe('12.57');
    expect(sanitizeAmount('Bs 36,50')).toBe('3650');
  });

  test('strips everything non-numeric', () => {
    expect(sanitizeAmount('abc')).toBe('');
    expect(sanitizeAmount('$ 4.19')).toBe('4.19');
  });
});

describe('splitUsd()', () => {
  test('Bs-currency methods convert by the exchange rate', () => {
    expect(splitUsd({ method: 'cash_bs', amount: '365' }, 36.5)).toBe(10);
    expect(splitUsd({ method: 'card', amount: '73' }, 36.5)).toBe(2);
  });

  test('USD methods pass through unchanged', () => {
    expect(splitUsd({ method: 'cash', amount: '5' }, 36.5)).toBe(5);
    expect(splitUsd({ method: 'zelle', amount: '12.5' }, 36.5)).toBe(12.5);
  });

  test('guards against a missing rate and empty amounts', () => {
    expect(splitUsd({ method: 'cash_bs', amount: '100' }, 0)).toBe(0);
    expect(splitUsd({ method: 'cash', amount: '' }, 36.5)).toBe(0);
  });
});

describe('payment method catalog', () => {
  test('the six methods keep their prototype ids and currencies', () => {
    expect(METHODS.map((m) => m.id)).toEqual([
      'cash',
      'cash_bs',
      'card',
      'transfer',
      'mobile',
      'zelle',
    ]);
    expect(METHOD_CURRENCY.cash).toBe('usd');
    expect(METHOD_CURRENCY.zelle).toBe('usd');
    expect(METHOD_CURRENCY.cash_bs).toBe('bs');
    expect(METHOD_CURRENCY.card).toBe('bs');
  });

  test('printed receipts never mention dollars', () => {
    // Dollar-based methods are masked on paper: README §Domain Rules.
    expect(RECEIPT_METHOD_LABEL.cash).toBe('Efectivo');
    expect(RECEIPT_METHOD_LABEL.zelle).toBe('Transferencia');
    expect(receiptMethod('mobile')).toBe('Pago móvil');
    expect(receiptMethod('desconocido')).toBe('desconocido');
  });
});
