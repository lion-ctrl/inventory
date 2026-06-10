// @vitest-environment jsdom
// PaymentSheet — the split-payment UI math that feeds checkout.
import { useRef, useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PaymentSheet } from '@/screens/Payment';
import type { CleanSplit, SplitRow } from '@/types';

afterEach(cleanup);

function Harness({
  total = 10,
  bsRate = 36.5,
  onConfirm = () => {},
}: {
  total?: number;
  bsRate?: number;
  onConfirm?: (method: string, tendered: number, splits: CleanSplit[]) => void;
}) {
  const [splits, setSplits] = useState<SplitRow[]>([
    { id: 1, method: 'cash', amount: '' },
  ]);
  const nextIdRef = useRef(2);
  return (
    <PaymentSheet
      total={total}
      salesType="invoice"
      bsRate={bsRate}
      splits={splits}
      setSplits={setSplits}
      nextIdRef={nextIdRef}
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );
}

const amountInput = (placeholder = '$ 0.00') =>
  screen.getByPlaceholderText(placeholder);
const confirmButton = () =>
  screen.getByRole('button', { name: 'Confirmar venta' });

describe('PaymentSheet', () => {
  test('shows the USD total and its Bs conversion', () => {
    render(<Harness total={10} bsRate={36.5} />);
    expect(screen.getByText('Total a cobrar')).toBeDefined();
    expect(screen.getByText('$10.00')).toBeDefined();
    expect(screen.getByText('Bs 365.00')).toBeDefined();
    expect(confirmButton()).toHaveProperty('disabled', true);
  });

  test('underpayment shows "Falta" and keeps confirm disabled', async () => {
    const user = userEvent.setup();
    render(<Harness total={10} />);
    await user.type(amountInput(), '4');
    expect(screen.getByText('Falta')).toBeDefined();
    // Paid $4.00 (Bs 146.00); missing $6.00 (Bs 219.00)
    expect(screen.getByText(/\$6\.00 · Bs 219\.00/)).toBeDefined();
    expect(confirmButton()).toHaveProperty('disabled', true);
  });

  test('overpayment shows "Excedido en"', async () => {
    const user = userEvent.setup();
    render(<Harness total={10} />);
    await user.type(amountInput(), '12');
    expect(screen.getByText('Excedido en')).toBeDefined();
    expect(confirmButton()).toHaveProperty('disabled', true);
  });

  test('exact payment confirms with normalized USD splits', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness total={10} onConfirm={onConfirm} />);

    await user.type(amountInput(), '10');
    expect(screen.getByText('Total cubierto')).toBeDefined();
    expect(confirmButton()).toHaveProperty('disabled', false);

    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith('cash', 10, [
      { method: 'cash', amount: 10, entered: 10, currency: 'usd' },
    ]);
  });

  test('input sanitizes pasted garbage to a money string', async () => {
    const user = userEvent.setup();
    render(<Harness total={10} />);
    const input = amountInput() as HTMLInputElement;
    await user.type(input, '12a.5.7');
    expect(input.value).toBe('12.57');
  });

  test('split payment: a Bs row converts by the rate and completes the total', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness total={10} bsRate={36.5} onConfirm={onConfirm} />);

    // First row (cash USD): $5
    await user.type(amountInput(), '5');

    // Add a second method: Efectivo Bs
    await user.click(screen.getByRole('button', { name: /Agregar método/ }));
    expect(screen.getByText('Elige un método')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Efectivo Bs/ }));

    // Typed in Bs: 182.50 Bs = $5.00
    const bsInput = amountInput('Bs 0.00') as HTMLInputElement;
    await user.type(bsInput, '182.5');
    expect(screen.getByText('= $5.00')).toBeDefined();
    expect(screen.getByText('Total cubierto')).toBeDefined();

    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith('cash', 10, [
      { method: 'cash', amount: 5, entered: 5, currency: 'usd' },
      { method: 'cash_bs', amount: 5, entered: 182.5, currency: 'bs' },
    ]);
  });

  test('rows can be removed once there is more than one', async () => {
    const user = userEvent.setup();
    render(<Harness total={10} />);
    // Single row → no delete button
    expect(screen.queryByRole('button', { name: 'Quitar método' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Agregar método/ }));
    await user.click(screen.getByRole('button', { name: /Zelle/ }));
    expect(
      screen.getAllByRole('button', { name: 'Quitar método' })
    ).toHaveLength(2);

    await user.click(
      screen.getAllByRole('button', { name: 'Quitar método' })[1]
    );
    expect(screen.queryByRole('button', { name: 'Quitar método' })).toBeNull();
  });
});
