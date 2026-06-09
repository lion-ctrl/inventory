import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";

// Self-hosted fonts (offline-first PWA) — same families/weights the prototype loaded
// from Google Fonts: Inter 400–800, JetBrains Mono 400/500/700, Fraunces 500/700.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/700.css";

// Design tokens first, then component styles (same order as the prototype)
import "@/styles/tokens.css";
import "@/styles/app.css";

import { SessionProvider } from "@/state/SessionContext";
import { CartProvider } from "@/state/CartContext";
import AppShell from "./AppShell";

registerSW({ immediate: true });

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <SessionProvider>
          <CartProvider>
            <AppShell />
          </CartProvider>
        </SessionProvider>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
);
