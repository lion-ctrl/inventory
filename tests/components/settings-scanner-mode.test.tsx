// @vitest-environment jsdom
// Ajustes → Preferencias → "Modo de escaneo": the owner alternates between the
// physical scanner and the device camera.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

import { useMutation, useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { SessionProvider } from '@/state/SessionContext';
import SettingsScreen from '@/screens/Settings';

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);

// auth.me PUBLIC projection — no pin material. The session credential is the token.
const owner = {
  _id: 'e_owner',
  _creationTime: 0,
  name: 'Carlos Méndez',
  email: 'carlos@mitienda.com',
  phone: '0',
  role: 'owner',
  permissions: 'all',
  active: true,
  createdAt: 0,
};

const OWNER_TOKEN = 'tok_owner';

const settingsDoc = {
  _id: 's1',
  _creationTime: 0,
  storeName: 'Tienda Ejemplo, C.A',
  storeRif: 'J-31234567-8',
  phone: '+507 269-0000',
  address: 'Av. Principal 123',
  currency: 'USD',
  taxName: 'IVA',
  ivaPct: 13,
  bsRate: 36.5,
  nextInvoiceNumber: 43,
  nextHeldCode: 1001,
  printAuto: true,
  emailReceipt: false,
  lowStockAlerts: true,
  soundScan: true,
  // scannerMode deliberately absent — legacy rows default to the physical scanner
};

const mutationFns = new Map<string, ReturnType<typeof vi.fn>>();
const mutationFor = (name: string) => {
  if (!mutationFns.has(name))
    mutationFns.set(
      name,
      vi.fn(async () => null)
    );
  return mutationFns.get(name)!;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pos.sessionToken', OWNER_TOKEN);
  localStorage.setItem('pos.sessionExpiresAt', String(Date.now() + 30 * 60 * 1000));
  mutationFns.clear();
  useQueryMock.mockImplementation(((query: any, args: any) => {
    if (args === 'skip') return undefined;
    switch (getFunctionName(query)) {
      case 'auth:me':
        return owner;
      case 'settings:get':
        return settingsDoc;
      default:
        return undefined;
    }
  }) as any);
  useMutationMock.mockImplementation(((ref: any) =>
    mutationFor(getFunctionName(ref))) as any);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);

describe('Ajustes — Modo de escaneo', () => {
  test('shows the row defaulting to the physical scanner', () => {
    render(<SettingsScreen />, { wrapper });
    expect(screen.getByText('Modo de escaneo')).toBeDefined();
    expect(screen.getByText('Escáner físico')).toBeDefined();
  });

  test('the owner switches to the camera and the patch persists it', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />, { wrapper });

    await user.click(screen.getByRole('button', { name: /Modo de escaneo/ }));
    const select = screen.getByLabelText('Escáner');

    // Dirty check: Guardar enabled only after an actual change
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toHaveProperty('disabled', true);

    await user.selectOptions(select, 'camera');
    expect(guardar).toHaveProperty('disabled', false);

    await user.click(guardar);
    expect(mutationFor('settings:update')).toHaveBeenCalledWith({
      token: OWNER_TOKEN,
      patch: { scannerMode: 'camera' },
    });
  });
});
