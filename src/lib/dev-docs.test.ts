/**
 * The developer portal's two hand lists must not fall out of step with the code.
 *
 * Both are tripwires in the way `src/lib/brand/contract.test.ts` is one for the
 * brand tokens: they cost nothing at runtime and fail CI the day someone adds a
 * table or a CLAUDE.md invariant and forgets the portal.
 *
 *   1. MODULES + PLATFORM_TABLES classify every table (F283).
 *   2. INVARIANTS + NOT_LISTED account for every `###` heading under CLAUDE.md
 *      "## Key Invariants" (F285).
 *
 * What these cannot check is the WORDING of an invariant entry or of an
 * isolation note. The portal labels those "Written by hand" for that reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  INVARIANTS,
  MODULES,
  NOT_LISTED,
  PLATFORM_MODULE,
  PLATFORM_TABLES,
  UNCLASSIFIED_MODULE,
  buildSchemaDocs,
} from "@/lib/dev-docs";

// dev-docs.ts imports the RLS connection; these tests read only its constants
// and the Drizzle table definitions, never a connection.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const ROOT = path.resolve(__dirname, "../..");

function exportedTableNames(): string[] {
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableConfig(t).name)
    .sort();
}

/** Tables declared in source, so one that is not exported is still seen. */
function declaredTableNames(): string[] {
  const dir = path.join(ROOT, "src/lib/db");
  const files = [
    path.join(dir, "schema.ts"),
    ...readdirSync(path.join(dir, "domain"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(dir, "domain", f)),
  ];
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bpgTable\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

const CLAUDE_MD = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

function keyInvariantHeadings(): string[] {
  const start = CLAUDE_MD.indexOf("\n## Key Invariants");
  expect(start, "CLAUDE.md has no '## Key Invariants' section").toBeGreaterThan(-1);
  const rest = CLAUDE_MD.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  const section = next === -1 ? rest : rest.slice(0, next);
  return [...section.matchAll(/^### (.+?)\s*$/gm)].map((m) => m[1]);
}

describe("the module map classifies every table (F283)", () => {
  const exported = exportedTableNames();

  it("sees the same tables in the exports as are declared in the schema files", () => {
    expect(
      exported,
      "a pgTable is declared but not re-exported from src/lib/db/schema.ts, or vice versa",
    ).toEqual(declaredTableNames());
  });

  it("every table is in MODULES or PLATFORM_TABLES", () => {
    const unclassified = exported.filter(
      (t) => !Object.hasOwn(MODULES, t) && !Object.hasOwn(PLATFORM_TABLES, t),
    );
    expect(
      unclassified,
      `Add each table to MODULES (a presby module, with a letter) or to PLATFORM_TABLES (the platform shell) in src/lib/dev-docs.ts: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("no entry names a table that no longer exists", () => {
    const real = new Set(exported);
    const stale = [...Object.keys(MODULES), ...Object.keys(PLATFORM_TABLES)].filter(
      (t) => !real.has(t),
    );
    expect(
      stale,
      `Remove from MODULES or PLATFORM_TABLES in src/lib/dev-docs.ts: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no table is in both lists", () => {
    const both = Object.keys(MODULES).filter((t) => Object.hasOwn(PLATFORM_TABLES, t));
    expect(
      both,
      `A table is either a presby module table or a platform shell table, not both: ${both.join(", ")}`,
    ).toEqual([]);
  });

  it("every PLATFORM_TABLES entry has a reason", () => {
    for (const [table, reason] of Object.entries(PLATFORM_TABLES)) {
      expect(reason.trim(), table).not.toBe("");
    }
  });

  it("every module heading is '<letter>. <name>' with a distinct letter", () => {
    const headings = [...new Set(Object.values(MODULES))];
    const letters = headings.map((h) => {
      const m = /^([A-Z])\. \S/.exec(h);
      expect(m, `module heading "${h}" should look like "M. Name"`).not.toBeNull();
      return m![1];
    });
    expect(new Set(letters).size, `two modules share a letter: ${headings.join(" | ")}`).toBe(
      letters.length,
    );
  });

  it("buildSchemaDocs files every table under its real heading, never 'Unclassified'", () => {
    const docs = buildSchemaDocs();
    expect(docs.map((d) => d.name).sort()).toEqual(exported);
    expect(docs.filter((d) => d.module === UNCLASSIFIED_MODULE).map((d) => d.name)).toEqual([]);
    expect(
      docs
        .filter((d) => d.module === PLATFORM_MODULE)
        .map((d) => d.name)
        .sort(),
    ).toEqual(Object.keys(PLATFORM_TABLES).sort());
  });

  it("the platform shell no longer uses the old starter label", () => {
    expect(PLATFORM_MODULE).toBe("Platform shell");
  });
});

describe("the invariants list accounts for every CLAUDE.md Key Invariants heading (F285)", () => {
  const headings = keyInvariantHeadings();
  const sources = new Set(
    INVARIANTS.map((i) => i.source).filter((s): s is string => s !== null),
  );

  it("finds the headings it is meant to check", () => {
    expect(headings.length).toBeGreaterThan(10);
  });

  it("every heading is a source in INVARIANTS or explained in NOT_LISTED", () => {
    const missing = headings.filter((h) => !sources.has(h) && !Object.hasOwn(NOT_LISTED, h));
    expect(
      missing,
      `CLAUDE.md has a Key Invariants heading the developer portal does not account for. Add an INVARIANTS entry with source set to the heading, or add it to NOT_LISTED with a reason, in src/lib/dev-docs.ts: ${missing.join(" | ")}`,
    ).toEqual([]);
  });

  it("every source names a heading that still exists (rename detection)", () => {
    const real = new Set(headings);
    const gone = [...sources].filter((s) => !real.has(s));
    expect(
      gone,
      `INVARIANTS names a CLAUDE.md heading that no longer exists (renamed or removed?). Update the source in src/lib/dev-docs.ts: ${gone.join(" | ")}`,
    ).toEqual([]);
  });

  it("every NOT_LISTED key is a real heading with a reason, and is not also a source", () => {
    const real = new Set(headings);
    for (const [heading, reason] of Object.entries(NOT_LISTED)) {
      expect(real.has(heading), `NOT_LISTED names a missing heading: ${heading}`).toBe(true);
      expect(reason.trim(), `NOT_LISTED needs a reason: ${heading}`).not.toBe("");
      expect(sources.has(heading), `${heading} is both listed and not listed`).toBe(false);
    }
  });

  it("enforcement uses only CLAUDE.md's vocabulary", () => {
    for (const inv of INVARIANTS) {
      expect(["database", "trigger", "paper"], inv.title).toContain(inv.enforcement);
    }
  });

  it("titles are unique and every entry has wording", () => {
    const titles = INVARIANTS.map((i) => i.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const inv of INVARIANTS) {
      expect(inv.detail.trim(), inv.title).not.toBe("");
    }
  });

  it("the wildcard entry states the bounded residual, not the stale 'must be removed before ship'", () => {
    const entry = INVARIANTS.find((i) => i.source === "No Role Carries a Wildcard");
    expect(entry).toBeDefined();
    expect(entry!.detail).not.toMatch(/must be removed before ship/i);
    expect(entry!.detail).toMatch(/Known violation, bounded/);
  });
});
