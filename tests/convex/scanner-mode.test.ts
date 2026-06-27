/// <reference types="vite/client" />
// Scanner mode setting: the owner chooses between the physical (HID) scanner
// and the device camera in Ajustes. Optional field — absent means 'physical'.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

describe('settings.scannerMode', () => {
  test('is absent by default (legacy rows) and round-trips through update', async () => {
    const { t, fx } = await setup();

    const before = await t.query(api.settings.get, {});
    expect(before?.scannerMode).toBeUndefined(); // undefined → physical in the UI

    await t.mutation(api.settings.update, {
      token: fx.ownerToken,
      patch: { scannerMode: 'camera' },
    });
    const after = await t.query(api.settings.get, {});
    expect(after?.scannerMode).toBe('camera');

    await t.mutation(api.settings.update, {
      token: fx.ownerToken,
      patch: { scannerMode: 'physical' },
    });
    const back = await t.query(api.settings.get, {});
    expect(back?.scannerMode).toBe('physical');
  });

  test('stays behind the manage_settings guard', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.settings.update, {
        token: fx.cajeroVoidToken, // no manage_settings
        patch: { scannerMode: 'camera' },
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });
});
