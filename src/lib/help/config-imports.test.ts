/**
 * next.config.ts is loaded outside the `@/` alias and spreads helpRedirects() into
 * redirects(), so the three files it pulls in must import one another by relative
 * path only, and must not pull in anything that needs a bundler.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const FILES = ["types.ts", "registry.ts", "select.ts"];

describe("config-loadable help files", () => {
  for (const file of FILES) {
    it(`${file} has no @/ runtime import and no non-relative runtime import`, () => {
      const src = readFileSync(path.join(DIR, file), "utf8");
      // `=` is excluded so `export const X = [ ... ]` is never read as a re-export: a registry label that
      // ends in the word "from" (the Reimbursements queue has one) would otherwise look like `from "`.
      const runtime = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;=]*?from\s*["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      for (const spec of runtime) {
        expect(spec.startsWith("./"), `${file} imports "${spec}"`).toBe(true);
      }
      expect(src).not.toMatch(/from\s*["']@\//);
    });
  }
  it("the registry has no fs and no server-only import", () => {
    const src = readFileSync(path.join(DIR, "registry.ts"), "utf8");
    expect(src).not.toMatch(/node:fs|server-only/);
  });
});
