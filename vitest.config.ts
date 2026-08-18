import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Default Vitest config.
 *
 * `environment: "node"` is correct for everything under `src/lib/` (pure
 * functions, crypto, server-only helpers). When you add tests for React
 * components, either flip this to "jsdom" globally or use an inline
 * `// @vitest-environment jsdom` annotation at the top of those specs.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
