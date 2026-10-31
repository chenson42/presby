/**
 * Source-scan tests for the R51 pin and the writer list (Community Increment
 * 3a, Batch B; docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase
 * 3 section 6.3, scans 2 and 3; DECISION-233). DB-free: each reads source text,
 * so a property that is otherwise true only by review becomes a failing test
 * the moment someone breaks it. The behaviour is proven by the DB suites
 * (`membership-standing.db.test.ts`, `community-engagement.db.test.ts`) and the
 * live-catalog scan 1 is in the first of them.
 *
 * Every scan has a deliberately offending sample proving it CAN fail: a scan
 * that cannot fail is not a tripwire.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EDITABLE_ENGAGEMENTS,
  ENGAGEMENT_STATUSES,
  LISTED_ROLLS,
} from "./membership-standing";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every non-test .ts/.tsx file under `dir` (relative to the repo root). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Removes // line comments and block comments so a scan sees code only. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:\\"'`])\/\/.*$/gm, "$1");
}

// `src/lib/testing/` is test support (fixtures that insert, update and delete
// throwaway rows on the owner connection), never application code.
const SRC = sourceFiles("src").filter((rel) => !rel.startsWith(path.join("src", "lib", "testing") + path.sep));
const code = (rel: string) => stripComments(read(rel));
const filesMatching = (pattern: RegExp, except: readonly string[] = []) =>
  SRC.filter((rel) => !except.includes(rel)).filter((rel) => pattern.test(code(rel)));

const MIGRATION = read("drizzle/0066_presby_membership_standing.sql");
const M65 = read("drizzle/0065_presby_sign_in_and_connect.sql");

// ---------------------------------------------------------------------------
// Scan 2: nobody re-codes the standing test
// ---------------------------------------------------------------------------

describe("scan 2: the roll list and the engagement test live in one place (R51)", () => {
  const MIRROR = "src/lib/membership-standing.ts";
  // The Drizzle mirror of the CHECK is the one other place the five engagement values are written.
  const CHECK_MIRROR = path.join("src", "lib", "db", "domain", "people.ts");

  const FOUR_ROLL_SQL = /'active',\s*'baptized',\s*'affiliate',\s*'other_participant'/;
  const ENGAGEMENT_TEST = /engagement_status\s*=\s*'(regular|visitor)'/;

  it("no non-test source file but the classifier's mirror contains the four-roll SQL list", () => {
    expect(filesMatching(FOUR_ROLL_SQL, [MIRROR])).toEqual([]);
  });

  it("no non-test source file contains `engagement_status = 'regular'` or `'visitor'` in code (the test is a call to the classifier)", () => {
    expect(filesMatching(ENGAGEMENT_TEST, [MIRROR, CHECK_MIRROR])).toEqual([]);
  });

  it("the Directory predicate and the Community lists ask the classifier by name", () => {
    expect(code("src/lib/directory.ts")).toContain("presby_membership_standing(m.current_roll, m.engagement_status) = 'listed'");
    expect(code("src/lib/community.ts")).toContain("presby_membership_standing(m.current_roll, m.engagement_status) = 'visitor'");
    expect(code("src/lib/community.ts")).toContain("presby_membership_standing(m.current_roll, m.engagement_status) = 'inactive'");
  });

  it("the TypeScript mirror lists exactly the rolls and engagements the SQL does", () => {
    const classifier = M65.slice(M65.indexOf("create or replace function presby_membership_standing("));
    const body = classifier.slice(0, classifier.indexOf("$$;"));
    const sqlRolls = [...body.matchAll(/p_current_roll in \(([^)]*)\)/g)]
      .flatMap((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
    expect([...LISTED_ROLLS]).toEqual(sqlRolls);
    const sqlEngagements = [...new Set([...body.matchAll(/p_engagement_status\s*(?:=|in)\s*\(?\s*'([a-z_]+)'(?:,\s*'([a-z_]+)')?/g)]
      .flatMap((m) => [m[1]!, m[2]].filter((x): x is string => Boolean(x))))].sort();
    expect(sqlEngagements).toEqual(["inactive", "moved_away", "regular", "staff", "visitor"]);
  });

  it("ENGAGEMENT_STATUSES equals the 0066 CHECK and the Drizzle mirror of it, as sets", () => {
    const fromSql = /memberships_engagement_status_allowed\s*\n\s*check \(engagement_status in \(([^)]*)\)\)/.exec(MIGRATION);
    expect(fromSql, "the CHECK in 0066").not.toBeNull();
    const sqlValues = [...fromSql![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...sqlValues].sort()).toEqual([...ENGAGEMENT_STATUSES].sort());

    const mirror = /"memberships_engagement_status_allowed",\s*sql`[^`]*in \(([^)]*)\)`/.exec(read("src/lib/db/domain/people.ts"));
    expect(mirror, "the Drizzle mirror").not.toBeNull();
    const mirrorValues = [...mirror![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...mirrorValues].sort()).toEqual([...ENGAGEMENT_STATUSES].sort());
  });

  it("an administrator may set every stored engagement but staff", () => {
    expect([...EDITABLE_ENGAGEMENTS].sort()).toEqual(ENGAGEMENT_STATUSES.filter((e) => e !== "staff").sort());
  });

  it("the scan can fail: a deliberately offending sample is seen", () => {
    const offender = "const q = `select 1 from memberships m where m.engagement_status = 'regular'`;";
    const list = "const r = `m.current_roll in ('active', 'baptized', 'affiliate', 'other_participant')`;";
    expect(ENGAGEMENT_TEST.test(stripComments(offender))).toBe(true);
    expect(FOUR_ROLL_SQL.test(stripComments(list))).toBe(true);
    // ...and a comment alone is not an offence (the scans read code).
    expect(ENGAGEMENT_TEST.test(stripComments("// engagement_status = 'regular'"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scan 3: the writer list
// ---------------------------------------------------------------------------

describe("scan 3: one module updates the engagement, the archive marker and the visit details", () => {
  const WRITER = "src/lib/community-engagement.ts";

  /** An UPDATE of memberships that sets the named column(s), in raw SQL or in Drizzle. */
  const updatesColumn = (sqlName: string, drizzleName: string) =>
    new RegExp(
      `update\\s+memberships\\b(?:\\s+\\w+)?\\s+set\\b[^;\`]*\\b${sqlName}\\s*=|\\.update\\(\\s*memberships\\s*\\)[\\s\\S]{0,400}?\\b${drizzleName}\\s*:`,
      "i",
    );

  it("`engagement_status` is updated only by community-engagement.ts (the INSERT sites are not updates)", () => {
    expect(filesMatching(updatesColumn("engagement_status", "engagementStatus"))).toEqual([WRITER]);
  });

  it("`first_visit_date` and `how_heard` are updated only by community-engagement.ts", () => {
    expect(filesMatching(updatesColumn("first_visit_date", "firstVisitDate"))).toEqual([WRITER]);
    expect(filesMatching(updatesColumn("how_heard", "howHeard"))).toEqual([WRITER]);
  });

  it("the archive marker is written (`ended_reason = <marker>`) only by community-engagement.ts", () => {
    const writes = /\bended_reason\s*=\s*\$\{COMMUNITY_ARCHIVE_ENDED_REASON\}|\bendedReason\s*:\s*COMMUNITY_ARCHIVE_ENDED_REASON/;
    expect(filesMatching(writes)).toEqual([WRITER]);
  });

  it("the marker's literal is spelled in one place, and referenced by exactly the writer, the two readers and the label derivation", () => {
    expect(filesMatching(/community_archived/, [])).toEqual(["src/lib/roll-action-kinds.ts"]);
    expect(filesMatching(/\bCOMMUNITY_ARCHIVE_ENDED_REASON\b/).sort()).toEqual(
      ["src/lib/community-engagement.ts", "src/lib/community-labels.ts", "src/lib/community.ts", "src/lib/roll-action-kinds.ts"].sort(),
    );
  });

  it("the other writers of `ended_on` and `ended_reason` on memberships are unchanged: roll.ts never updates memberships; the participant paths are the 0061 definers", () => {
    expect(code("src/lib/roll.ts")).not.toMatch(/update\s+memberships|\.update\(\s*memberships\s*\)/i);
  });

  it("community.ts stays read-only", () => {
    expect(code("src/lib/community.ts")).not.toMatch(/\.(insert|update|delete)\(|\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });

  it("the library writes its audit row with insertAuditRow(tx, ...) in the change's transaction, never recordAudit()", () => {
    const lib = code(WRITER);
    expect(lib).toMatch(/insertAuditRow\(tx, \{/);
    expect(lib).not.toMatch(/recordAudit\(/);
    // One audit call per write function: four writes, four rows.
    expect(lib.match(/insertAuditRow\(tx, \{/g)).toHaveLength(4);
  });

  it("no source file deletes a membership, a person or a derived row (all removals are soft)", () => {
    expect(filesMatching(/\bdelete\s+from\s+(memberships|people|group_memberships)\b|\.delete\(\s*(memberships|people|groupMemberships)\s*\)/i, [])).toEqual([]);
  });

  it("the scan can fail: deliberately offending samples are seen", () => {
    const rawUpdate = "await tx.execute(sql`update memberships set engagement_status = 'regular' where id = 1`);";
    const aliased = "await tx.execute(sql`update memberships m set engagement_status = ${x} where m.id = 1`);";
    const drizzle = "await tx.update(memberships).set({ engagementStatus: 'regular' }).where(eq(memberships.id, 1));";
    const insert = "await tx.insert(memberships).values({ engagementStatus: 'visitor' });";
    const re = updatesColumn("engagement_status", "engagementStatus");
    expect(re.test(rawUpdate)).toBe(true);
    expect(re.test(aliased)).toBe(true);
    expect(re.test(drizzle)).toBe(true);
    // ...and an INSERT is not an update.
    expect(re.test(insert)).toBe(false);
    expect(updatesColumn("how_heard", "howHeard").test("update memberships set how_heard = null where id = 1")).toBe(true);
  });
});
