// @vitest-environment jsdom
// Phase 3 (Clients) — OFFLINE WRITE-BLOCKING (FEATURES §18). Reads stay available
// offline (the client list + search render from the Dexie mirror), but every admin
// WRITE is blocked: create / edit / delete a client in Clients.tsx, and the in-sale
// "Crear cliente" flow (ClientGate) in Sale.tsx. Each blocked action is a disabled
// control plus a visible "Sin conexión" banner; searching/selecting an existing
// client (reads) stay enabled. Online, the same controls are enabled and no offline
// banner shows. Offline customer DRAFTS (CUSTOMER_CREATE queued) are Phase 6 — for
// now create is simply blocked, not queued.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Client } from '@/types';

const { onlineMock, clientsMock } = vi.hoisted(() => ({
  onlineMock: { current: true },
  clientsMock: { current: [] as Client[] },
}));

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, key: 'test', pathname: '/clientes' }),
}));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineMock.current }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useProducts: () => [],
  useCategories: () => [],
  useClients: () => clientsMock.current,
  useSettingsDoc: () => null,
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 't', user: null }),
}));

import ClientsScreen from '@/screens/Clients';
import { ClientGate } from '@/screens/Sale';

const makeClient = (over: Partial<Client> = {}): Client =>
  ({
    _id: 'c_maria',
    _creationTime: 0,
    name: 'María González',
    taxPrefix: 'V',
    taxId: '5.123.456',
    kind: 'person',
    phone: '04140000000',
    email: '',
    address: 'Caracas',
    createdAt: 0,
    ...over,
  }) as unknown as Client;

const renderClients = (online: boolean) => {
  onlineMock.current = online;
  clientsMock.current = [makeClient()];
  return render(<ClientsScreen />);
};

const btn = (name: RegExp | string) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onlineMock.current = true;
  clientsMock.current = [];
});

describe('Clientes — offline write-blocking (FEATURES §18)', () => {
  test('offline: "Nuevo cliente" is disabled and the screen shows the offline notice', () => {
    renderClients(false);
    expect(btn(/Nuevo cliente/)).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        /Solo lectura\. No puedes crear, editar o eliminar clientes/
      )
    ).toBeDefined();
  });

  test('online: "Nuevo cliente" is enabled and no offline notice is shown', () => {
    renderClients(true);
    expect(btn(/Nuevo cliente/)).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Solo lectura\./)).toBeNull();
  });

  test('offline: the client detail blocks editar / eliminar with the offline notice', async () => {
    const user = userEvent.setup();
    renderClients(false);

    // Reads aren't blocked: the list renders and the row opens the detail sheet.
    await user.click(
      screen.getByText('María González').closest('.lrow') as HTMLElement
    );

    expect(btn(/Editar/)).toHaveProperty('disabled', true);
    expect(btn('Eliminar')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Editar y eliminar requieren conexión/)
    ).toBeDefined();
  });

  test('online: the client detail enables editar / eliminar (no offline notice)', async () => {
    const user = userEvent.setup();
    renderClients(true);

    await user.click(
      screen.getByText('María González').closest('.lrow') as HTMLElement
    );

    expect(btn(/Editar/)).toHaveProperty('disabled', false);
    expect(btn('Eliminar')).toHaveProperty('disabled', false);
    expect(screen.queryByText(/requieren conexión/)).toBeNull();
  });
});

describe('Venta · ClientGate — offline blocks "Crear cliente" (FEATURES §18)', () => {
  const renderGate = (online: boolean, onCreateClient = vi.fn()) => {
    render(
      <ClientGate
        clients={[makeClient()]}
        online={online}
        onClientFound={vi.fn()}
        onCreateClient={onCreateClient}
      />
    );
    return { onCreateClient };
  };

  test('offline: searching stays allowed (read) but "Crear cliente" is blocked', async () => {
    const user = userEvent.setup();
    renderGate(false);

    // Buscar cliente (search/read) stays enabled offline.
    const search = btn(/Buscar cliente/);
    expect(search).toHaveProperty('disabled', false);

    // An unknown id surfaces the create prompt — but the create write is blocked.
    await user.type(screen.getByPlaceholderText('12.345.678'), '9999999');
    await user.click(search);

    expect(btn(/Crear cliente/)).toHaveProperty('disabled', true);
    // The standard "Sin conexión" banner is present.
    expect(screen.getByText('Sin conexión')).toBeDefined();
  });

  test('online: "Crear cliente" is enabled and fires the inline create', async () => {
    const user = userEvent.setup();
    const { onCreateClient } = renderGate(true);

    await user.type(screen.getByPlaceholderText('12.345.678'), '9999999');
    await user.click(btn(/Buscar cliente/));

    const create = btn(/Crear cliente/);
    expect(create).toHaveProperty('disabled', false);
    await user.click(create);
    expect(onCreateClient).toHaveBeenCalledWith({
      prefix: 'V',
      taxId: '9.999.999',
    });
  });
});
