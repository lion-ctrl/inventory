// Pure session-token primitives: high-entropy generation + SHA-256 hash-at-rest.
// Web Crypto is available in the edge-runtime test env (and Convex's default
// runtime), so these need no Node built-ins.
import { describe, expect, test } from 'vitest';
import {
  generateToken,
  hashToken,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
} from '@convex/sessions';

describe('generateToken()', () => {
  test('returns a 256-bit token encoded as url-safe base64 (43 chars, no padding)', () => {
    const token = generateToken();
    // 32 random bytes → 43 base64url chars without '=' padding.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // base64url never contains the standard-alphabet/padding characters.
    expect(token).not.toMatch(/[+/=]/);
  });

  test('is unguessable: every call yields a fresh value', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateToken());
    expect(seen.size).toBe(100);
  });
});

describe('hashToken()', () => {
  test('is a deterministic SHA-256 hex digest (64 lowercase hex chars)', async () => {
    const a = await hashToken('abc');
    const b = await hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches the canonical SHA-256 test vectors', async () => {
    // SHA-256("") and SHA-256("abc") — the published NIST vectors.
    expect(await hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('different tokens hash to different digests', async () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(await hashToken(t1)).not.toBe(await hashToken(t2));
  });

  test('the raw token is never recoverable from the hash (length-fixed, not the input)', async () => {
    const token = generateToken();
    const hash = await hashToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });
});

describe('session lifetimes', () => {
  test('IDLE_TTL_MS is a 30-minute sliding (idle) window', () => {
    expect(IDLE_TTL_MS).toBe(30 * 60 * 1000);
  });

  test('ABSOLUTE_TTL_MS is a 24-hour hard cap from login', () => {
    expect(ABSOLUTE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  test('the idle window is far shorter than the absolute cap', () => {
    expect(IDLE_TTL_MS).toBeLessThan(ABSOLUTE_TTL_MS);
  });
});
