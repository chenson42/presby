/**
 * Fixture tests for the lifted import-graph primitives and the generic
 * checkImportBoundary (P3-3). The proxy walker's own behaviour stays pinned by
 * scripts/check-proxy-imports.test.mjs, which is unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  checkImportBoundary,
  importSpecifiers,
  normalize,
  resolveSpecifier,
  stripComments,
} from "./import-graph.mjs";

const f = (path, content) => ({ path, content });
const index = (...paths) => new Map(paths.map((p) => [p, ""]));

describe("the lifted primitives", () => {
  it("stripComments keeps strings and blanks comments, preserving lines", () => {
    const out = stripComments('const a = "// not a comment"; // gone\n/* x\ny */ const b = 1;');
    expect(out).toContain('"// not a comment"');
    expect(out).not.toContain("gone");
    expect(out.split("\n")).toHaveLength(3); // one per source line
  });
  it("importSpecifiers reads static, side-effect and dynamic imports and skips type-only", () => {
    const code = [
      'import a from "./a";',
      'import type { T } from "./types";',
      'import "./side";',
      'export { x } from "./re";',
      'const m = await import("./dyn");',
    ].join("\n");
    expect(importSpecifiers(code).sort()).toEqual(["./a", "./dyn", "./re", "./side"]);
  });
  it("normalize collapses . and ..", () => {
    expect(normalize("src/lib/../app/./x")).toBe("src/app/x");
  });
  it("resolveSpecifier resolves @/ and relative specifiers, with extension and index fallbacks", () => {
    const idx = index("src/lib/a.ts", "src/lib/dir/index.tsx", "src/app/p/page.tsx");
    expect(resolveSpecifier("@/lib/a", "src/app/p/page.tsx", idx)).toBe("src/lib/a.ts");
    expect(resolveSpecifier("../../lib/dir", "src/app/p/page.tsx", idx)).toBe("src/lib/dir/index.tsx");
    expect(resolveSpecifier("./missing", "src/app/p/page.tsx", idx)).toBeNull();
    expect(resolveSpecifier("next/headers", "src/app/p/page.tsx", idx)).toBeUndefined();
  });
});

const BAN = {
  path: (rel) => (rel.startsWith("src/lib/db/") ? "src/lib/db/**" : null),
  bare: [/^next-auth(\/|$)/, /^next\/headers$/],
};

describe("checkImportBoundary", () => {
  it("passes a clean graph", () => {
    const files = [f("src/e.ts", 'import "./a"; import "next/server";'), f("src/a.ts", "export const a = 1;")];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN })).toEqual([]);
  });

  it("P1: reports a banned path with the chain that reaches it", () => {
    const files = [
      f("src/e.ts", 'import "./a";'),
      f("src/a.ts", 'import { db } from "@/lib/db/index";'),
      f("src/lib/db/index.ts", "export const db = 1;"),
    ];
    const v = checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "P1", file: "src/a.ts" });
    expect(v[0].chain).toEqual(["src/e.ts", "src/a.ts", "src/lib/db/index.ts"]);
  });

  it("P3: reports a banned bare package", () => {
    const files = [f("src/e.ts", 'import { headers } from "next/headers";')];
    const v = checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN });
    expect(v.map((x) => x.rule)).toEqual(["P3"]);
  });

  it("P4: an unresolvable in-repo specifier fails loudly", () => {
    const files = [f("src/e.ts", 'import "./gone";')];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN }).map((x) => x.rule)).toEqual(["P4"]);
  });

  it("does not follow a type-only import, and ignores a commented-out one", () => {
    const files = [
      f("src/e.ts", 'import type { Db } from "@/lib/db/index";\n// import "@/lib/db/index";'),
      f("src/lib/db/index.ts", ""),
    ];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN })).toEqual([]);
  });

  it("walks every entry, and visits a shared module once", () => {
    const files = [
      f("src/e1.ts", 'import "./shared";'),
      f("src/e2.ts", 'import "./shared";'),
      f("src/shared.ts", 'import "next-auth/react";'),
    ];
    const v = checkImportBoundary(files, { entries: ["src/e1.ts", "src/e2.ts"], ban: BAN });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "P3", file: "src/shared.ts" });
  });

  it("walks into a module a banned module would have hidden only if it is not itself banned", () => {
    const files = [
      f("src/e.ts", 'import "@/lib/db/index";'),
      f("src/lib/db/index.ts", 'import "next-auth";'),
    ];
    // one violation per edge: the banned module is not walked into
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN }).map((x) => x.rule)).toEqual(["P1"]);
  });

  it("fails when an entry is not among the files", () => {
    const v = checkImportBoundary([], { entries: ["src/missing.ts"], ban: BAN });
    expect(v.map((x) => x.rule)).toEqual(["P4"]);
  });

  it("an empty entry list is a pass (nothing to walk)", () => {
    expect(checkImportBoundary([f("src/a.ts", "")], { entries: [], ban: BAN })).toEqual([]);
  });

  it("can treat a server-only import as a violation when asked", () => {
    const files = [f("src/e.ts", 'import "./s";'), f("src/s.ts", 'import "server-only";')];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN, serverOnly: true }).map((x) => x.rule)).toEqual(["P2"]);
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN })).toEqual([]);
  });

  it("stopAt: a stop file is reached but neither scanned nor followed (DECISION-304)", () => {
    const files = [
      f("src/e.ts", 'import "./stop";'),
      f("src/stop.ts", 'import "@/lib/db/index"; import "server-only"; import "next-auth";'),
      f("src/lib/db/index.ts", ""),
    ];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN, serverOnly: true, stopAt: ["src/stop.ts"] })).toEqual([]);
    // without the stop, the same graph is full of violations: the option is what changes it
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN, serverOnly: true }).length).toBeGreaterThan(0);
  });

  it("stopAt defaults to none, so a caller that passes nothing (check:proxy-imports) is unchanged", () => {
    const files = [f("src/e.ts", 'import "./s";'), f("src/s.ts", 'import "next-auth";')];
    expect(checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN }).map((x) => x.rule)).toEqual(["P3"]);
  });

  it("stopAt does not shield a sibling that imports the same banned module", () => {
    const files = [
      f("src/e.ts", 'import "./stop"; import "./other";'),
      f("src/stop.ts", 'import "next-auth";'),
      f("src/other.ts", 'import "next-auth";'),
    ];
    const v = checkImportBoundary(files, { entries: ["src/e.ts"], ban: BAN, stopAt: ["src/stop.ts"] });
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe("src/other.ts");
  });
});
