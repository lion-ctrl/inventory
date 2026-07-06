// @vitest-environment jsdom
// Phase 12 — Profile is ONLINE-ONLY for writes: `updateSelf` is a server mutation
// (PIN/email changes), so offline the "Editar perfil" entry point is disabled.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const online = { current: false };

vi.mock('convex/react', () => ({ useMutation: () => vi.fn() }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({
    user: {
      name: 'Carlos Méndez',
      role: 'owner',
      permissions: 'all',
      email: 'carlos@mitienda.com',
      phone: '04140000000',
    },
    token: 'tok',
  }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => online.current }));

import ProfileScreen from '@/screens/Profile';

afterEach(() => cleanup());

describe('Profile — offline (online-only writes, §12)', () => {
  test('offline: the "Editar perfil" button is disabled', () => {
    online.current = false;
    render(<ProfileScreen />);
    expect(
      screen.getByRole('button', { name: /Editar perfil/ })
    ).toHaveProperty('disabled', true);
  });

  test('online: the "Editar perfil" button is enabled', () => {
    online.current = true;
    render(<ProfileScreen />);
    expect(
      screen.getByRole('button', { name: /Editar perfil/ })
    ).toHaveProperty('disabled', false);
  });
});
