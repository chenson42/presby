/**
 * H19, the help import boundary (R8). Fixture tests for which files are entries and
 * what each entry may not reach.
 */
import { describe, it, expect } from "vitest";
import { checkHelpBoundary, helpBoundaryEntries } from "./help-boundary.mjs";

const f = (path, content = "") => ({ path, content });
const rules = (v) => v.map((x) => x.rule).sort();

describe("helpBoundaryEntries", () => {
  const all = [
    "src/app/(documentation)/help/page.tsx",
    "src/app/(documentation)/help/[slug]/page.tsx",
    "src/app/(documentation)/help/contact/page.tsx",
    "src/app/(documentation)/docs/page.tsx",
    "src/app/(documentation)/layout.tsx",
    "src/lib/help/registry.ts",
    "src/components/help/needs-block.tsx",
    "src/components/shared/markdown-document.tsx",
    "src/components/shared/other.tsx",
    "src/lib/other.ts",
  ];
  it("selects the five bounded trees and exempts help/contact (Increment 2, C1)", () => {
    expect(helpBoundaryEntries(all)).toEqual([
      "src/app/(documentation)/help/page.tsx",
      "src/app/(documentation)/help/[slug]/page.tsx",
      "src/app/(documentation)/docs/page.tsx",
      "src/lib/help/registry.ts",
      "src/components/help/needs-block.tsx",
      "src/components/shared/markdown-document.tsx",
    ]);
  });
  it("skips test files", () => {
    expect(helpBoundaryEntries(["src/lib/help/a.test.ts", "src/lib/help/b.ts"])).toEqual(["src/lib/help/b.ts"]);
  });
});

describe("checkHelpBoundary", () => {
  const clean = [
    f("src/lib/help/registry.ts", 'import type { X } from "./types";'),
    f("src/lib/help/types.ts"),
  ];
  it("passes a clean help tree", () => {
    expect(checkHelpBoundary(clean)).toEqual([]);
  });
  it("passes with no help files at all", () => {
    expect(checkHelpBoundary([f("src/app/page.tsx")])).toEqual([]);
  });

  const bad = {
    "the database": [f("src/lib/db/index.ts"), 'import { db } from "@/lib/db";'],
    "@/auth": [f("src/auth.ts"), 'import { auth } from "@/auth";'],
    "@/lib/flags": [f("src/lib/flags.ts"), 'import { isFlagEnabled } from "@/lib/flags";'],
    "@/lib/authz": [f("src/lib/authz.ts"), 'import { withOrgContext } from "@/lib/authz";'],
    "a sites module": [f("src/lib/sites-ingest.ts"), 'import { x } from "@/lib/sites-ingest";'],
    "sites.ts": [f("src/lib/sites.ts"), 'import { x } from "@/lib/sites";'],
  };
  for (const [what, [target, line]] of Object.entries(bad)) {
    it(`fails an import of ${what}, directly`, () => {
      const files = [f("src/lib/help/registry.ts", line), target];
      expect(rules(checkHelpBoundary(files))).toEqual(["P1"]);
    });
  }
  it("fails next-auth and next/headers", () => {
    expect(rules(checkHelpBoundary([f("src/components/help/a.tsx", 'import { SessionProvider } from "next-auth/react";')]))).toEqual(["P3"]);
    expect(rules(checkHelpBoundary([f("src/components/help/a.tsx", 'import { headers } from "next/headers";')]))).toEqual(["P3"]);
  });
  it("fails a transitive reach, naming the chain", () => {
    const files = [
      f("src/app/(documentation)/help/page.tsx", 'import { x } from "@/lib/helper";'),
      f("src/lib/helper.ts", 'import { db } from "@/lib/db/index";'),
      f("src/lib/db/index.ts"),
    ];
    const v = checkHelpBoundary(files);
    expect(rules(v)).toEqual(["P1"]);
    expect(v[0].chain[0]).toBe("src/app/(documentation)/help/page.tsx");
  });
  it("lets help/contact reach the database (Increment 2), but not the rest of the help tree", () => {
    const files = [f("src/app/(documentation)/help/contact/actions.ts", 'import "@/lib/db/index";'), f("src/lib/db/index.ts")];
    expect(checkHelpBoundary(files)).toEqual([]);
  });
  it("a test file importing the database is not walked", () => {
    const files = [f("src/lib/help/x.test.ts", 'import "@/lib/db/index";'), f("src/lib/db/index.ts")];
    expect(checkHelpBoundary(files)).toEqual([]);
  });
  it("allows server-only (content.ts reads fs at build) and node builtins", () => {
    const files = [f("src/lib/help/content.ts", 'import "server-only"; import { readFileSync } from "node:fs";')];
    expect(checkHelpBoundary(files)).toEqual([]);
  });
});
