/**
 * Drift test for scripts/ci/e2e-reset-flags.sql (G8). The reset file lists the
 * seeded flags in SQL because psql cannot read scripts/seed.ts; this test
 * parses both and fails on any difference, so a flag added to the seed and
 * missed in the SQL cannot keep an inherited value on a QA branch. It also
 * pins the structure that makes a wrong-branch run harmless (G9): one
 * transaction, the refusal before the first update, nothing that quits.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = readFileSync(path.join(ROOT, "scripts", "seed.ts"), "utf8");
const RESET = readFileSync(path.join(ROOT, "scripts", "ci", "e2e-reset-flags.sql"), "utf8");
const BASELINE = readFileSync(path.join(ROOT, "scripts", "ci", "e2e-baseline-flags.sql"), "utf8");

/** Comments out of a source slice. `//` only counts at a line start or after whitespace (never `https://`). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/** { key -> enabled } for every flag seedFlags() inserts. */
function parseSeedFlags(src) {
  const start = src.indexOf("async function seedFlags()");
  const end = src.indexOf("for (const f of defaults)", start);
  if (start === -1 || end === -1) throw new Error("seedFlags() not found in scripts/seed.ts; update this test.");
  const body = stripComments(src.slice(start, end));
  const hits = [...body.matchAll(/\bkey:\s*"([^"]+)"/g)];
  const flags = new Map();
  hits.forEach((m, i) => {
    const segment = body.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : body.length);
    const literal = segment.match(/\benabled:\s*(true|false)\b/);
    if (!literal) {
      throw new Error(`seed.ts flag "${m[1]}" has no literal "enabled: true|false"; the reset file cannot mirror it.`);
    }
    flags.set(m[1], literal[1] === "true");
  });
  return flags;
}

/** { key -> enabled } for the rows between the BEGIN/END seed flags markers. */
function parseSqlFlags(sql) {
  const a = sql.indexOf("-- BEGIN seed flags");
  const b = sql.indexOf("-- END seed flags");
  if (a === -1 || b === -1 || b < a) throw new Error("seed flags markers missing from e2e-reset-flags.sql.");
  const flags = new Map();
  for (const m of sql.slice(a, b).matchAll(/\(\s*'([^']+)'\s*,\s*(true|false)\s*\)/g)) {
    flags.set(m[1], m[2] === "true");
  }
  return flags;
}

describe("e2e-reset-flags.sql mirrors scripts/seed.ts", () => {
  const seed = parseSeedFlags(SEED);
  const sql = parseSqlFlags(RESET);

  it("parsed a plausible number of flags from both sides (an empty match must not pass)", () => {
    expect(seed.size).toBeGreaterThanOrEqual(30);
    expect(sql.size).toBeGreaterThanOrEqual(30);
  });

  it("has the same key set", () => {
    const missingInSql = [...seed.keys()].filter((k) => !sql.has(k));
    const extraInSql = [...sql.keys()].filter((k) => !seed.has(k));
    expect({ missingInSql, extraInSql }).toEqual({ missingInSql: [], extraInSql: [] });
  });

  it("has the same enabled value for every key", () => {
    const differing = [...seed].filter(([k, v]) => sql.has(k) && sql.get(k) !== v).map(([k, v]) => `${k}: seed ${v}, sql ${sql.get(k)}`);
    expect(differing).toEqual([]);
  });

  it("every key the baseline file switches on exists in the seed", () => {
    const list = BASELINE.match(/where key in \(([^)]*)\)/);
    expect(list).not.toBeNull();
    const keys = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !seed.has(k))).toEqual([]);
  });
});

describe("e2e-reset-flags.sql structure", () => {
  const firstUpdate = RESET.search(/^\s*update\s+feature_flags/im);

  it("opens a transaction before the first update", () => {
    expect(firstUpdate).toBeGreaterThan(-1);
    expect(RESET.search(/^begin;/m)).toBeGreaterThan(-1);
    expect(RESET.search(/^begin;/m)).toBeLessThan(firstUpdate);
  });

  it("refuses unless pipeline_branch=1, before the first update", () => {
    const refusal = RESET.indexOf("refusing to run");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(firstUpdate);
    expect(RESET).toContain("-v pipeline_branch=1");
    expect(RESET).toMatch(/presby\.e2e_reset_confirmed/);
  });

  it("applies the baseline file inside the transaction, after the update", () => {
    const include = RESET.search(/^\\ir e2e-baseline-flags\.sql/m);
    expect(include).toBeGreaterThan(firstUpdate);
    expect(include).toBeLessThan(RESET.search(/^commit;/m));
  });

  it("ends with commit; and never quits the session", () => {
    expect(RESET.trimEnd().endsWith("commit;")).toBe(true);
    expect(RESET).not.toMatch(/\\q(uit)?\b/);
  });

  it("says the per-organization toggles were not touched", () => {
    expect(RESET).toContain("Per-organization toggles (organization_feature_toggles) were not touched.");
  });
});

describe("parser self-checks (the test must be able to fail)", () => {
  it("ignores an enabled: true inside a comment", () => {
    const src = 'async function seedFlags() {\n  const defaults = [\n    {\n      key: "a.b",\n      // enabled: true\n      enabled: false,\n    },\n  ];\n  for (const f of defaults)';
    expect([...parseSeedFlags(src)]).toEqual([["a.b", false]]);
  });

  it("names a flag whose enabled is not a literal", () => {
    const src = 'async function seedFlags() {\n  const defaults = [\n    { key: "a.b", enabled: flagDefault },\n  ];\n  for (const f of defaults)';
    expect(() => parseSeedFlags(src)).toThrow(/a\.b/);
  });
});
