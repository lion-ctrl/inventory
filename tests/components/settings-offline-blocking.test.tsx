// @vitest-environment jsdom
// Phase 4 (Settings) — OFFLINE WRITE-BLOCKING (FEATURES §18, "tax configuration
// changes"). Reads stay available offline (the store config renders from the Dexie
// singleton mirror so Scan/Sale/Payment math keeps working), but every
// settings.update WRITE is blocked: the preference toggles (printAuto /
// emailReceipt / lowStockAlerts / soundScan) AND the editor sheets' "Guardar"
// (store / billing / bsrate / currency / scanner). Each blocked path shows the
// standard "Sin conexión" banner; online the same controls are enabled and no
// offline banner shows. Opening an editor to VIEW current values stays allowed
// offline — only the write (Guardar) is disabled.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Settings } from '@/types';

const { onlineMock, settingsMock } = vi.hoisted(() => ({
  onlineMock: { current: true },
  settingsMock: { current: null as Settings | null },
}));

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineMock.current }));
vi.mock('@/state/hooks', () => ({
  useSettingsDoc: () => settingsMock.current,
  useBsRate: () => 0,
  useProducts: () => [],
  useCategories: () => [],
  useClients: () => [],
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 't', user: { name: 'Ana', role: 'admin' } }),
}));

import SettingsScreen from '@/screens/Settings';

const makeSettings = (over: Partial<Settings> = {}): Settings =>
  ({
    _id: 's1',
    _creationTime: 0,
    storeName: 'Bodega Central',
    storeRif: 'J-12345678-9',
    phone: '',
    address: '',
    currency: 'USD',
    taxName: 'IVA',
    ivaPct: 16,
    bsRate: 36.5,
    printAuto: false,
    emailReceipt: false,
    lowStockAlerts: false,
    soundScan: false,
    scannerMode: 'physical',
    nextInvoiceNumber: 1,
    ...over,
  }) as unknown as Settings;

const renderSettings = (online: boolean) => {
  onlineMock.current = online;
  settingsMock.current = makeSettings();
  return render(<SettingsScreen />);
};

const btn = (name: RegExp | string) => screen.getByRole('button', { name });
const toggle = (name: string) => screen.getByRole('switch', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onlineMock.current = true;
  settingsMock.current = null;
});

describe('Ajustes — offline write-blocking (FEATURES §18)', () => {
  test('offline: preference toggles are disabled and the screen shows the read-only notice', () => {
    renderSettings(false);
    expect(toggle('Alertas de bajo stock')).toHaveProperty('disabled', true);
    expect(toggle('Sonido al escanear')).toHaveProperty('disabled', true);
    expect(toggle('Imprimir automáticamente')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Solo lectura\. Los ajustes requieren conexión/)
    ).toBeDefined();
  });

  test('online: preference toggles are enabled and no read-only notice is shown', () => {
    renderSettings(true);
    expect(toggle('Alertas de bajo stock')).toHaveProperty('disabled', false);
    expect(toggle('Sonido al escanear')).toHaveProperty('disabled', false);
    expect(
      screen.queryByText(/Solo lectura\. Los ajustes requieren conexión/)
    ).toBeNull();
  });

  test('offline: the rate editor opens (read) but "Guardar" is blocked with the offline notice', async () => {
    const user = userEvent.setup();
    renderSettings(false);

    // Reads aren't blocked: the row still opens the editor sheet to VIEW the value.
    await user.click(
      screen.getByText('Valor del dólar').closest('button') as HTMLElement
    );

    // Even after editing (making the form dirty), Guardar stays disabled offline.
    const input = screen.getByPlaceholderText('36.50');
    await user.clear(input);
    await user.type(input, '99');
    expect(btn('Guardar')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Guardar los ajustes requiere conexión/)
    ).toBeDefined();
  });

  test('online: the rate editor enables "Guardar" once edited (no offline notice)', async () => {
    const user = userEvent.setup();
    renderSettings(true);

    await user.click(
      screen.getByText('Valor del dólar').closest('button') as HTMLElement
    );

    // A change makes the form dirty → Guardar is enabled online, no offline banner.
    const input = screen.getByPlaceholderText('36.50');
    await user.clear(input);
    await user.type(input, '99');
    expect(btn('Guardar')).toHaveProperty('disabled', false);
    expect(screen.queryByText(/requiere conexión/)).toBeNull();
  });
});
