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
    // Remote-Neon round trips occasionally exceed the 5s/10s Vitest
    // defaults across the ~30 DB-backed spec files that talk to the real
    // database — two boundary flakes measured on this pipeline's own branch
    // (2026-09-26, docs/work-log/2026-09-26-ci-db-tests.md). Harmless for the
    // pure suite: nothing there approaches even 5s.
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Vitest 4 removed `coverage.all` — `include` is how "count files no
      // test touches yet" is expressed now. The prior config's silent
      // default (only files a test actually imports) is why 121 source
      // files never appeared in any coverage report (2026-09-25 test-
      // coverage review, N-4 family).
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      // @default false in Vitest 4 (reporters.d.ts). Confirmed 2026-09-26:
      // a run with any failing test writes NO coverage/ directory at all
      // unless this is set. Keep it set even after a given red run's cause
      // is fixed — otherwise the next red run silently loses coverage
      // again the same way.
      reportOnFailure: true,
    },
  },
});
