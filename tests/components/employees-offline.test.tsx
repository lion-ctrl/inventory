// @vitest-environment jsdom
// Phase 11 — Employees is ONLINE-ONLY: PIN material never touches the device (§24),
// so nothing is mirrored. Offline the whole screen shows a "requiere conexión" state.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 'tok' }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => false }));
vi.mock('@/screens/Stored', () => ({ DateField: () => <input aria-label="date" /> }));

import EmployeesScreen from '@/screens/Employees';

afterEach(() => cleanup());

describe('Employees — offline (online-only, §11)', () => {
  test('offline: renders the "Empleados requiere conexión" state, not the list', () => {
    render(<EmployeesScreen />);
    expect(screen.getByText('Empleados requiere conexión')).toBeDefined();
    // No "Agregar empleado" trigger offline (the whole screen is blocked).
    expect(
      screen.queryByRole('button', { name: /Agregar empleado/ })
    ).toBeNull();
  });
});
