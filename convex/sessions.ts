// Pure session-token primitives. Web Crypto (`crypto.getRandomValues`,
// `crypto.subtle.digest`) is available in Convex's DEFAULT runtime — do NOT add
// `"use node"`. This module holds no registered Convex functions; it is a
// helper used by `auth.login`/`auth.logout`/`auth.renewSession` (mint / revoke /
// renew) and `permissions.requireSession` (validate + slide the idle window).

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
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lowercase hex encoding of raw bytes. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
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
 * are only needed for low-entropy secrets like the 6-digit PIN, which is the
 * separate `login-hardening` change's concern, not this one.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}
