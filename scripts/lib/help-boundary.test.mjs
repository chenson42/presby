/**
 * H19, the help import boundary (R8). Fixture tests for which files are entries and
 * what each entry may not reach.
 */
import { describe, it, expect } from "vitest";
import { checkHelpBoundary, helpBoundaryEntries, SERVER_ACTION_STOPS } from "./help-boundary.mjs";

const f = (path, content = "") => ({ path, content });
const rules = (v) => v.map((x) => x.rule).sort();

describe("helpBoundaryEntries", () => {
  const all = [
    "src/app/(documentation)/help/page.tsx",
    "src/app/(documentation)/help/[slug]/page.tsx",
    "src/app/(documentation)/help/contact/page.tsx",
    "src/app/(documentation)/help/contact/contact-form.tsx",
    "src/app/(documentation)/help/contact/actions.ts",
    "src/app/(documentation)/docs/page.tsx",
    "src/app/(documentation)/layout.tsx",
    "src/lib/help/registry.ts",
    "src/components/help/needs-block.tsx",
    "src/components/shared/markdown-document.tsx",
    "src/components/shared/other.tsx",
    "src/lib/other.ts",
  ];
  it("selects the bounded trees; help/contact's page and island are entries, only its one stop file is not (DECISION-304)", () => {
    expect(helpBoundaryEntries(all)).toEqual([
      "src/app/(documentation)/help/page.tsx",
      "src/app/(documentation)/help/[slug]/page.tsx",
      "src/app/(documentation)/help/contact/page.tsx",
      "src/app/(documentation)/help/contact/contact-form.tsx",
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
  it("a test file importing the database is not walked", () => {
    const files = [f("src/lib/help/x.test.ts", 'import "@/lib/db/index";'), f("src/lib/db/index.ts")];
    expect(checkHelpBoundary(files)).toEqual([]);
  });
  it("allows server-only (content.ts reads fs at build) and node builtins", () => {
    const files = [f("src/lib/help/content.ts", 'import "server-only"; import { readFileSync } from "node:fs";')];
    expect(checkHelpBoundary(files)).toEqual([]);
  });
});

describe("the contact form's one stop file (DECISION-304)", () => {
  const STOP = "src/app/(documentation)/help/contact/actions.ts";
  const SEG = "src/app/(documentation)/help/contact/";
  const stopOk = f(STOP, '"use server";\nimport { db } from "@/lib/db";\nimport { headers } from "next/headers";\nexport async function a() {}');
  const dbFile = f("src/lib/db/index.ts");

  it("names exactly one stop file", () => {
    expect(SERVER_ACTION_STOPS).toEqual([STOP]);
  });

  it("reaches the stop file but does not follow it: its database and next/headers imports are not violations", () => {
    const files = [
      f(`${SEG}page.tsx`, 'import { Form } from "./contact-form";'),
      f(`${SEG}contact-form.tsx`, 'import { a } from "./actions";'),
      stopOk,
      dbFile,
    ];
    expect(checkHelpBoundary(files)).toEqual([]);
  });

  it("still walks the page and the island: the island reaching the database directly fails", () => {
    const files = [f(`${SEG}contact-form.tsx`, 'import { db } from "@/lib/db";'), stopOk, dbFile];
    expect(rules(checkHelpBoundary(files))).toEqual(["P1"]);
  });

  it("still walks what the island imports: an impure library file fails", () => {
    const files = [
      f(`${SEG}contact-form.tsx`, 'import { x } from "@/lib/help-contact/contract";'),
      f("src/lib/help-contact/contract.ts", 'import { db } from "@/lib/db";'),
      stopOk,
      dbFile,
    ];
    expect(rules(checkHelpBoundary(files))).toEqual(["P1"]);
  });

  it("the exemption is not the subtree any more: another help/contact file may not reach the database", () => {
    const files = [f(`${SEG}other.ts`, 'import { db } from "@/lib/db";'), stopOk, dbFile];
    expect(rules(checkHelpBoundary(files))).toEqual(["P1"]);
  });

  it("S1: a stop file that does not begin with \"use server\" fails", () => {
    const files = [f(STOP, 'import { headers } from "next/headers";\n"use server";')];
    const v = checkHelpBoundary(files);
    expect(rules(v)).toEqual(["S1"]);
    expect(v[0].file).toBe(STOP);
  });

  it("S1 accepts single quotes, a semicolon-free directive and a leading comment", () => {
    expect(checkHelpBoundary([f(STOP, "// header\n'use server'\nexport async function a() {}")])).toEqual([]);
  });

  it("S2: an import of the stop file from outside its segment fails, even where the walk never goes", () => {
    const files = [
      stopOk,
      f("src/lib/elsewhere.ts", 'import { a } from "@/app/(documentation)/help/contact/actions";'),
    ];
    const v = checkHelpBoundary(files);
    expect(rules(v)).toEqual(["S2"]);
    expect(v[0].file).toBe("src/lib/elsewhere.ts");
  });

  it("S2: a help-tree file importing the stop from outside the segment fails too", () => {
    const files = [
      stopOk,
      f("src/app/(documentation)/help/page.tsx", 'import { a } from "./contact/actions";'),
    ];
    expect(rules(checkHelpBoundary(files))).toEqual(["S2"]);
  });

  it("S2 ignores a test file, which may import the action to call it", () => {
    const files = [stopOk, f("src/lib/x.test.ts", 'import { a } from "@/app/(documentation)/help/contact/actions";')];
    expect(checkHelpBoundary(files)).toEqual([]);
  });

  it("P4: the segment exists but the stop file is missing", () => {
    const files = [f(`${SEG}page.tsx`, "")];
    expect(rules(checkHelpBoundary(files))).toEqual(["P4"]);
  });
});
