// Pure session-token and PIN-hashing primitives. Web Crypto
// (`crypto.getRandomValues`, `crypto.subtle`) is available in Convex's DEFAULT
// runtime — do NOT add `"use node"`. This module holds no registered Convex
// functions; it is a helper used by auth / permissions / employees.

/**
 * Idle (sliding) lifetime: a session dies after 30 minutes of INACTIVITY. Each
 * authenticated mutation — and an explicit `auth.renewSession` — slides this
 * deadline forward as `expiresAt = min(now + IDLE_TTL_MS, absoluteExpiresAt)`,
 * so an actively used session never idles out, yet can never escape the cap.
 */
export const IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Absolute cap: a session dies 24 hours after LOGIN no matter how active it is.
 * `absoluteExpiresAt` is fixed at issuance and NEVER slides — it is the hard
 * ceiling that every slide of `expiresAt` is clamped to.
 */
export const ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000;

/** Encode raw bytes as url-safe base64 without `=` padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Lowercase hex encoding of raw bytes. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Decode a lowercase hex string back to raw bytes. */
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Mint a fresh 256-bit session token (base64url of 32 CSPRNG bytes). This raw
 * value is the credential — it is returned to the client exactly once by
 * `login` and is NEVER stored. Only its `hashToken` digest is persisted.
 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

/**
 * One-way hash stored in `sessions.tokenHash`. A fast hash (SHA-256) is correct
 * here because the token is already high-entropy — slow KDFs (PBKDF2/bcrypt)
 * are only needed for low-entropy secrets like the 6-digit PIN, which is what
 * `hashPin`/`verifyPin` below are for.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// AUTH-4 — PIN hashing (PBKDF2-SHA-256 via Web Crypto, DEFAULT runtime)
//
// A 6-digit PIN is low-entropy (10^6 combinations) so a plain SHA-256 of the
// PIN is trivially reversible with a lookup table. PBKDF2 with a per-PIN
// random salt and 100,000 iterations makes offline brute-force expensive.
// Salt and hash are both stored as lowercase hex strings in the `employees`
// table (`pinSalt` / `pinHash`) so they round-trip cleanly as Convex strings.
// ---------------------------------------------------------------------------

/**
 * Hash a PIN with PBKDF2-SHA-256 (100 000 iterations, 256-bit output, hex).
 *
 * `salt` may be:
 *   - omitted → a fresh 16-byte CSPRNG salt is generated (for storage)
 *   - a hex string (the stored `pinSalt`) → decoded and reused (for verification)
 *   - a Uint8Array → used directly (for testing with fixed byte sequences)
 *
 * Returns `{ pinHash, pinSalt }` — both lowercase hex strings.
 */
export async function hashPin(
  pin: string,
  salt?: string | Uint8Array<ArrayBuffer>
): Promise<{ pinHash: string; pinSalt: string }> {
  let saltBytes: Uint8Array<ArrayBuffer>;
  if (salt === undefined) {
    saltBytes = crypto.getRandomValues(new Uint8Array(16));
  } else if (typeof salt === 'string') {
    saltBytes = fromHex(salt);
  } else {
    saltBytes = salt;
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256 // bits → 32 bytes → 64 hex chars
  );

  return {
    pinHash: toHex(new Uint8Array(derivedBits)),
    pinSalt: toHex(saltBytes),
  };
}

/**
 * Verify a plain-text PIN against the stored `pinSalt` + `pinHash`.
 * Recomputes the PBKDF2 hash and compares the fixed-length hex strings.
 */
export async function verifyPin(
  pin: string,
  pinSalt: string,
  pinHash: string
): Promise<boolean> {
  const { pinHash: computed } = await hashPin(pin, pinSalt);
  return computed === pinHash;
}
