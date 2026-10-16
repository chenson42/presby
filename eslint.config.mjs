// Flat ESLint config for presby.
// Uses Next.js's bundled flat config (covers next, react, react-hooks, typescript,
// jsx-a11y, import) plus project-specific ignores.
import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  // Ban toLocale* everywhere — use <FormattedDate> from
  // src/components/shared/formatted-date.tsx to avoid SSR timezone mismatches.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
          message:
            "Use <FormattedDate> from src/components/shared/formatted-date.tsx instead of toLocale*() to avoid SSR timezone mismatches.",
        },
      ],
    },
  },
  // S1 (DECISION-166 / F134): the wall-clock paths use `Date` only through its
  // UTC fields. drizzle-orm writes a no-zone timestamp with toISOString() and
  // reads it back by appending "+0000", so a LOCAL getter, setter or
  // multi-argument constructor silently stores the typed digits only when the
  // server process happens to run in UTC. This block REPEATS the toLocale*
  // selector because a later `no-restricted-syntax` config REPLACES the
  // earlier one for the files it matches. Tests are excluded: they build
  // local Dates on purpose, to prove the bug stays fixed.
  {
    files: [
      "src/lib/events.ts",
      "src/lib/events/**/*.ts",
      "src/lib/calendar.ts",
      "src/lib/calendar/**/*.ts",
      "src/lib/shared/org-time.ts",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
          message:
            "Use <FormattedDate> from src/components/shared/formatted-date.tsx instead of toLocale*() to avoid SSR timezone mismatches.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$/]",
          message:
            "Wall-clock code reads and writes Date only through its UTC fields (getUTC*/setUTC*) - a local getter or setter stores the typed digits only when the server runs in UTC (F134).",
        },
        {
          selector: "CallExpression[callee.property.name='getTimezoneOffset']",
          message:
            "Wall-clock code must not depend on the process time zone (F134).",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length>1]",
          message:
            "new Date(y, m, d, ...) builds a LOCAL Date. Use new Date(Date.UTC(...)) (F134).",
        },
      ],
    },
  },
  // Exempt the primitive itself — it is the one place toLocale* is intentional.
  {
    files: ["src/components/shared/formatted-date.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Online giving, R8 / Phase 2 S1 / P3-2 (docs/work-log/2026-10-15-online-giving.md):
  // the `stripe` package is imported at runtime by EXACTLY ONE file,
  // src/lib/giving/providers/stripe/client.ts, the allowlist module — the only
  // code a restricted key's scope has to be reasoned about for. The same rule is
  // enforced independently, in CI and in `npm run check`, by
  // scripts/check-giving-boundaries.mjs (B1/B2); this block is the editor-time
  // half. Three layers, later config winning:
  //   1. Everywhere under src/: "stripe" and "stripe/*" are restricted, TYPE
  //      imports included (the provider-neutral core knows no provider's types).
  //   2. Inside the provider folder: type-only imports are allowed (normalize.ts
  //      and status.ts type their inputs with the SDK's types).
  //   3. client.ts, and test files in the provider folder (the replay harness
  //      signs payloads with the SDK's own test-header helper): unrestricted.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "stripe",
              message:
                "Only src/lib/giving/providers/stripe/client.ts imports the stripe package (R8). Call one of its exports.",
            },
          ],
          patterns: [
            {
              group: ["stripe/*"],
              message:
                "Only src/lib/giving/providers/stripe/client.ts imports the stripe package (R8). Call one of its exports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/giving/providers/stripe/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "stripe",
              allowTypeImports: true,
              message:
                "Only client.ts imports the stripe package at runtime (R8); type-only imports are fine in this folder.",
            },
          ],
          patterns: [
            {
              group: ["stripe/*"],
              allowTypeImports: true,
              message:
                "Only client.ts imports the stripe package at runtime (R8); type-only imports are fine in this folder.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/giving/providers/stripe/client.ts",
      "src/lib/giving/providers/stripe/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },
];

export default config;
