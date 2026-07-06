// @vitest-environment jsdom
// ErrorBoundary — catches an uncaught render error and shows a recover screen
// instead of unmounting the whole app to a blank page (the failure mode a stale
// session / any thrown gated query used to cause).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ErrorBoundary } from '@/components';

function Boom(): never {
  throw new Error('boom');
}

afterEach(() => cleanup());

describe('ErrorBoundary', () => {
  test('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>contenido</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('contenido')).toBeDefined();
  });

  test('catches a render error and shows the recover UI instead of a blank page', () => {
    // React logs the caught error to console.error — silence the expected noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Algo salió mal')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeDefined();
    spy.mockRestore();
  });
});
