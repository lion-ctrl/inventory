import { defineConfig } from 'vite';
import type { Plugin, HtmlTagDescriptor } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// AUTH-5 — strict Content-Security-Policy (the primary XSS defense).
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
//   img-src 'self' data:      Local SVG/PNG assets + data: SVGs used as CSS
//                             background-image (see src/styles/app.css). The scanner's
//                             blob: URL feeds an <a download>, not an <img>, so blob:
//                             is intentionally omitted here.
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
// DELIVERY — why a build-only <meta> and not a static one:
//   index.html is shared by `vite dev`, whose HMR relies on inline dev-client scripts
//   and a ws:// socket that this policy would BLOCK. So the meta is injected ONLY into
//   the production build output (apply: 'build'); dev is left untouched.
//
// HARDENING AT THE HOSTING LAYER — two protections CANNOT travel in a <meta> tag and
// MUST be sent as real HTTP response headers by the static host / CDN:
//   • frame-ancestors 'none'  (clickjacking)  — also send X-Frame-Options: DENY
//   • report-to / report-uri  (violation telemetry)
//   Recommended header (superset of the meta below), e.g. as a Netlify/Cloudflare
//   `public/_headers` rule or your server config:
//     Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none';
//       script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
//       img-src 'self' data:; font-src 'self';
//       connect-src 'self' https://*.convex.cloud wss://*.convex.cloud;
//       worker-src 'self'; manifest-src 'self'; form-action 'self';
//       frame-ancestors 'none'
//     X-Frame-Options: DENY
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
  "worker-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
].join('; ');

// Inject the CSP <meta> into the emitted index.html on BUILD ONLY (kept out of dev
// so HMR keeps working). frame-ancestors / report-* are header-only — see above.
function cspMetaPlugin(): Plugin {
  return {
    name: 'inventory-csp-meta',
    apply: 'build',
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: CONTENT_SECURITY_POLICY,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Inventory POS',
        short_name: 'Inventory POS',
        description: 'Punto de venta e inventario con escaneo de productos',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1F8A5B',
        background_color: '#F7F4EE',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // wasm: the zxing-wasm barcode decoder binary (~1 MiB) must be
        // precached or camera scanning dies offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
    cspMetaPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@convex': path.resolve(__dirname, './convex'),
    },
  },
});
