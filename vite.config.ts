import { defineConfig } from 'vite';
import type { Plugin, HtmlTagDescriptor } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { buildCspMeta } from './src/security/csp';

// AUTH-5 — strict Content-Security-Policy (the primary XSS defense).
// The directives and every line of their rationale live in src/security/csp.ts
// (the one source); vercel.json ships the matching response header;
// tests/unit/csp.test.ts locks the header to the source and scans THIS file as
// text, so a hand-typed directive here — even inside a comment — fails the suite.
//
// DELIVERY — why a build-only <meta> and not a static one:
//   index.html is shared by `vite dev`, whose HMR relies on inline dev-client scripts
//   and a ws:// socket that this policy would BLOCK. So the meta is injected ONLY into
//   the production build output (apply: 'build'); dev is left untouched.
function cspMetaPlugin(): Plugin {
  return {
    name: 'inventory-csp-meta',
    apply: 'build',
    transformIndexHtml: (): HtmlTagDescriptor[] => [buildCspMeta()],
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
