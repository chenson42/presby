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
];

export default config;
