// @vitest-environment jsdom
// Toast — the in-app notification that replaces native browser alert()s. A
// consumer calls useToast().error(...) and a self-dismissing card appears; the
// close button and the auto-dismiss timeout both remove it. Rendered with NO
// provider, useToast is a no-op so a bare screen never crashes.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components';

function Trigger() {
  const toast = useToast();
  return <button onClick={() => toast.error('Algo salió mal')}>go</button>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  test('useToast().error shows a toast; the close button dismisses it', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    expect(screen.queryByText('Algo salió mal')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText('Algo salió mal')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'cerrar' }));
    await waitFor(() =>
      expect(screen.queryByText('Algo salió mal')).toBeNull()
    );
  });

  test('a toast auto-dismisses after the timeout', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    act(() => {
      screen.getByRole('button', { name: 'go' }).click();
    });
    expect(screen.getByText('Algo salió mal')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000); // past AUTO_DISMISS_MS (4500)
    });
    expect(screen.queryByText('Algo salió mal')).toBeNull();
  });

  test('useToast is a no-op with NO provider — a bare consumer never throws', () => {
    expect(() => render(<Trigger />)).not.toThrow();
  });
});
