// Pure PBKDF2 PIN-hashing primitives (AUTH-4).
// hashPin / verifyPin live in convex/sessions.ts alongside the other Web Crypto helpers.
import { describe, expect, test } from 'vitest';
import { hashPin, verifyPin } from '@convex/sessions';

describe('hashPin() / verifyPin() — PBKDF2-SHA-256 PIN hashing', () => {
  test('round-trip: verifyPin returns true for the correct PIN', async () => {
    const pin = '482106';
    const { pinHash, pinSalt } = await hashPin(pin);
    expect(await verifyPin(pin, pinSalt, pinHash)).toBe(true);
  });

  test('wrong PIN returns false', async () => {
    const pin = '482106';
    const { pinHash, pinSalt } = await hashPin(pin);
    expect(await verifyPin('000000', pinSalt, pinHash)).toBe(false);
  });

  test('no-salt call generates a random salt each time (different pinSalt AND different pinHash)', async () => {
    const pin = '482106';
    const a = await hashPin(pin);
    const b = await hashPin(pin);
    expect(a.pinSalt).not.toBe(b.pinSalt);
    expect(a.pinHash).not.toBe(b.pinHash);
  });

  test('same salt → same hash (deterministic)', async () => {
    const pin = '482106';
    const fixedSalt = '0102030405060708090a0b0c0d0e0f10';
    const a = await hashPin(pin, fixedSalt);
    const b = await hashPin(pin, fixedSalt);
    expect(a.pinHash).toBe(b.pinHash);
    expect(a.pinSalt).toBe(fixedSalt);
  });

  test('salt string round-trips: stored pinSalt can be reused for verifyPin', async () => {
    const pin = '123456';
    const { pinHash: h1, pinSalt } = await hashPin(pin);
    const { pinHash: h2 } = await hashPin(pin, pinSalt);
    expect(h1).toBe(h2);
  });

  // FROZEN VECTOR — computed once on first GREEN run, never to change.
  // Pins: PBKDF2 params (algorithm=SHA-256, iterations=100_000, output=256 bits, encoding=hex).
  // If any of those change, this test must break.
  test('stable known vector: PBKDF2-SHA-256, 100k iters, 256-bit output, hex-encoded', async () => {
    const pin = '123456';
    const fixedSaltHex = '0102030405060708090a0b0c0d0e0f10';
    const { pinHash, pinSalt } = await hashPin(pin, fixedSaltHex);

    // Salt must round-trip byte-for-byte
    expect(pinSalt).toBe(fixedSaltHex);
    // Output is 256 bits = 64 hex chars
    expect(pinHash).toMatch(/^[0-9a-f]{64}$/);

    // FROZEN on first GREEN run (2026-06-28).
    // pin='123456', salt=0x0102030405060708090a0b0c0d0e0f10,
    // PBKDF2-SHA-256 100 000 iters, 256-bit output, hex-encoded.
    // A change to iterations, hash, output length, or encoding MUST break this test.
    expect(pinHash).toBe(
      '817d1b4df96a0a34a0a6ce16443088d71b6393f87deae91a51fa6797f8aef906'
    );
  });
});
