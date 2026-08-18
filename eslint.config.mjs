// Flat ESLint config for the Claude Code Starter.
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
  // Exempt the primitive itself — it is the one place toLocale* is intentional.
  {
    files: ["src/components/shared/formatted-date.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
];

export default config;
