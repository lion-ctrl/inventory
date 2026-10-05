// AUTH-5 — strict Content-Security-Policy (the primary XSS defense). This module
// is the ONE source of the directives: vite.config.ts injects buildCspMeta() as
// the build-time <meta http-equiv>, vercel.json ships the same policy plus the
// header-only directives as the response header, and tests/unit/csp.test.ts
// locks both copies to this file. Pure on purpose — no imports, no DOM, no Node —
// so vite.config.ts (tsconfig.node.json) and the app/tests (tsconfig.app.json)
// both compile it.
//
// Convex authenticates over a WebSocket (connection params / args), NOT cookies,
// so the session token MUST be JS-readable. That rules out HTTP-only cookies and
// makes CSP — not CSRF tokens — the real mitigation against token exfiltration via
// XSS. Every directive below is justified against what the app ACTUALLY loads
// (verified by grepping the source — no speculative allowances):
//
//   default-src 'self'        Deny-by-default; any directive not listed inherits this.
//   base-uri 'self'           Block <base> hijacking of every relative URL.
//   object-src 'none'         No <object>/<embed>; removes a legacy plugin XSS vector.
//   script-src 'self'
//     'wasm-unsafe-eval'      App JS is bundled & same-origin. The ONLY relaxation is
//                             'wasm-unsafe-eval', REQUIRED by zxing-wasm: Emscripten's
//                             WebAssembly.instantiate() is blocked under a bare
//                             script-src 'self'. This keyword permits WASM compilation
//                             ONLY — it does NOT enable JS eval(). We deliberately do
//                             NOT add 'unsafe-inline' or 'unsafe-eval'.
//   style-src 'self'
//     'unsafe-inline'         REQUIRED: the UI sets React inline style={{…}} attributes
//                             pervasively, and CSP cannot hash/nonce style ATTRIBUTES
//                             (only <style> elements). Style injection is far lower risk
//                             than script injection, which stays locked down above.
//   img-src 'self' data:
//     blob:
//     https://*.convex.cloud  Local SVG/PNG assets + data: SVGs used as CSS
//                             background-image (see src/styles/app.css). blob: is the
//                             local preview of a product photo before it is saved.
//                             https://*.convex.cloud is Convex File Storage, where the
//                             saved photo's resolved URL points — the same wildcard
//                             host connect-src trusts. Never '*' or a bare https:.
//   font-src 'self'           @fontsource fonts are self-hosted/bundled — no Google
//                             Fonts (or any) CDN.
//   connect-src 'self'
//     https://*.convex.cloud
//     wss://*.convex.cloud    The Convex client: initial HTTPS handshake + the live
//                             WebSocket. OMITTING THESE KILLS THE APP. No Convex
//                             httpActions exist (no convex/http.ts) → *.convex.site is
//                             not needed. Narrow the wildcard to the exact deployment
//                             host (VITE_CONVEX_URL) at deploy time for a tighter policy.
//   worker-src 'self'         The vite-plugin-pwa service worker (same-origin).
//   manifest-src 'self'       The generated PWA web manifest (same-origin).
//   form-action 'self'        The two <form>s (Login, Sale client-gate) submit nowhere
//                             external — they are onSubmit-only with preventDefault.
//
// HARDENING AT THE HOSTING LAYER — two protections CANNOT travel in a <meta> tag and
// MUST be sent as real HTTP response headers by the static host / CDN:
//   • frame-ancestors 'none'  (clickjacking)  — also send X-Frame-Options: DENY
//   • report-to / report-uri  (violation telemetry)
//   The header is therefore CSP_DIRECTIVES + CSP_HEADER_ONLY_DIRECTIVES — what
//   vercel.json ships, beside X-Frame-Options: DENY. It is deliberately NOT spelled
//   out again here: a second hand-typed copy is how this policy drifted once.

export type CspDirective = readonly [name: string, sources: readonly string[]];

/** Convex File Storage and the Convex API share this wildcard host. */
export const CONVEX_CLOUD_ORIGIN = 'https://*.convex.cloud';

export const CSP_DIRECTIVES: readonly CspDirective[] = [
  ['default-src', ["'self'"]],
  ['base-uri', ["'self'"]],
  ['object-src', ["'none'"]],
  ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'blob:', CONVEX_CLOUD_ORIGIN]],
  ['font-src', ["'self'"]],
  ['connect-src', ["'self'", CONVEX_CLOUD_ORIGIN, 'wss://*.convex.cloud']],
  ['worker-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['form-action', ["'self'"]],
];

/** Directives a <meta> cannot carry; the response header (vercel.json) adds them. */
export const CSP_HEADER_ONLY_DIRECTIVES: readonly CspDirective[] = [
  ['frame-ancestors', ["'none'"]],
];

/** `name source…` clauses joined by `; ` — the vercel.json header format. */
export function serializeCsp(directives: readonly CspDirective[]): string {
  return directives
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** Inverse of serializeCsp for any policy string: directive name → sources. */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const clause of policy.split(';')) {
    const [name, ...sources] = clause.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/**
 * The build-time <meta> as data. Its literal types make it structurally a Vite
 * HtmlTagDescriptor without importing `vite`, so this module stays pure.
 */
export type CspMetaTag = {
  tag: 'meta';
  attrs: { 'http-equiv': 'Content-Security-Policy'; content: string };
  injectTo: 'head-prepend';
};

/** The <meta http-equiv> vite.config.ts injects into the production build. */
export function buildCspMeta(): CspMetaTag {
  return {
    tag: 'meta',
    attrs: {
      'http-equiv': 'Content-Security-Policy',
      content: serializeCsp(CSP_DIRECTIVES),
    },
    injectTo: 'head-prepend',
  };
}
