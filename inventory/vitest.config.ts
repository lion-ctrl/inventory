import { defineConfig } from "vitest/config";
import path from "path";

// Backend tests (convex/*.test.ts) run in edge-runtime per the Convex guidelines.
// UI tests opt into jsdom per file with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "./convex"),
    },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
