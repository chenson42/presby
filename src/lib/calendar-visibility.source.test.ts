/**
 * Source-scan tripwire for the members-only rule (docs/work-log/2026-11-02-
 * members-only-events.md, T1; DECISION-316, F418). DB-free: it reads source
 * text, so a property that is otherwise true only by review becomes a failing
 * test the moment someone breaks it. The behaviour is proven by
 * `calendar.test.ts`, which runs as `presby_app` against a real database.
 *
 * WHY A SCAN AND NOT THE DATABASE. A members-only event is hidden from a
 * visitor by the TypeScript reader (`memberVisible()` in `calendar.ts`), not by
 * RLS: this is authorization inside one tenant, and RLS enforces tenancy. The
 * tradeoff, accepted by the operator (2026-11-02, Q2): a future member-side
 * reader of `events` that forgets the predicate leaks. This test is what makes
 * that a failing test instead of a review catch.
 *
 * Every scan has a deliberately offending sample proving it CAN fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

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

/** A statement that reads the `events` table: raw SQL or the Drizzle builder. */
const READS_EVENTS =
  /\b(?:from|join)\s+events\b|\.from\(\s*events\s*\)|\.(?:inner|left|right|full)Join\(\s*events\b/;

/**
 * The text of every statement that reads `events`: each `.execute(` window that
 * contains `from events`, `join events` or the shared `${MEMBER_FROM}` fragment
 * (which is `from events e ...`). The fragment's own definition is a template,
 * not a statement, so it is skipped.
 */
function eventsStatements(code: string): string[] {
  const starts: number[] = [];
  for (let i = code.indexOf(".execute("); i !== -1; i = code.indexOf(".execute(", i + 1)) starts.push(i);
  const out: string[] = [];
  starts.forEach((start, n) => {
    const window = code.slice(start, starts[n + 1] ?? code.length);
    if (/\b(?:from|join)\s+events\b|\$\{MEMBER_FROM\}/.test(window)) out.push(window);
  });
  return out;
}

/**
 * The files allowed to name the `events` table, each with its reason. Anything
 * else under `src/` that reads `events` is a new reader and must either go
 * through `calendar.ts` or be added here with the rule it applies.
 */
const ALLOWED_READERS: Record<string, string> = {
  "src/lib/calendar.ts": "the member read path; every statement interpolates memberVisible()",
  "src/lib/events.ts": "the manager surface (events.manage): a manager must see what they manage",
  "src/lib/event-types.ts": "a usage COUNT behind event_types.manage; selects no event content",
  "src/lib/events/mutate.ts":
    "writer: locks and reads one event row by id; returns no event content to its caller beyond the id, and passes before/after start, end and location only to the update hooks",
};

describe("calendar visibility: the members-only rule has one reader (DECISION-316)", () => {
  const CALENDAR = stripComments(read("src/lib/calendar.ts"));

  it("every `from events` statement in calendar.ts interpolates memberVisible(", () => {
    const statements = eventsStatements(CALENDAR);
    expect(statements.length).toBeGreaterThanOrEqual(5);
    for (const statement of statements) {
      expect(statement, statement.slice(0, 80)).toMatch(/\$\{memberVisible\(/);
    }
  });

  it("the argument-less MEMBER_VISIBLE constant is gone (the argument is required)", () => {
    expect(CALENDAR).not.toMatch(/\bMEMBER_VISIBLE\b/);
    expect(CALENDAR).toMatch(/function memberVisible\(seesMembersOnly: boolean\)/);
    // No call passes a literal: the viewer's standing is the only input.
    expect(CALENDAR).not.toMatch(/memberVisible\(\s*(?:true|false)\s*\)/);
  });

  it("the gate asks the standing classifier by name, scoped to this organization and the live membership", () => {
    expect(CALENDAR).toContain("presby_membership_standing(m.current_roll, m.engagement_status)");
    expect(CALENDAR).toMatch(/m\.organization_id = \$\{organizationId\}::uuid/);
    expect(CALENDAR).toMatch(/m\.person_id = \$\{personId\}::uuid/);
    expect(CALENDAR).toContain("m.ended_on is null");
    // Visitors only (operator ruling 2026-11-02, Q1): the classifier's 'visitor' answer is the one tested.
    expect(CALENDAR).toMatch(/presby_membership_standing\([^)]*\)\s*<>\s*'visitor'/);
  });

  it("no other non-test source file reads the events table", () => {
    const readers = sourceFiles("src")
      .filter((rel) => !rel.startsWith(path.join("src", "lib", "testing") + path.sep))
      .filter((rel) => !rel.startsWith(path.join("src", "lib", "db", "domain") + path.sep))
      .filter((rel) => READS_EVENTS.test(stripComments(read(rel))))
      .sort();
    expect(readers).toEqual(Object.keys(ALLOWED_READERS).sort());
  });

  it("the scan can fail: a deliberately offending sample is seen", () => {
    const unfiltered =
      "await tx.execute(sql`select e.id from events e where e.organization_id = ${org}::uuid and e.cancelled_at is null`);";
    const [statement] = eventsStatements(stripComments(unfiltered));
    expect(statement).toBeDefined();
    expect(/\$\{memberVisible\(/.test(statement!)).toBe(false);

    expect(READS_EVENTS.test(stripComments("await tx.select().from(events).where(x);"))).toBe(true);
    expect(READS_EVENTS.test(stripComments("sql`select 1 from events e join x`"))).toBe(true);
    // A comment alone is not a reader, and `event_types` is not `events`.
    expect(READS_EVENTS.test(stripComments("// from events e"))).toBe(false);
    expect(READS_EVENTS.test(stripComments("sql`select 1 from event_types t`"))).toBe(false);

    expect(/\bMEMBER_VISIBLE\b/.test("${MEMBER_VISIBLE}")).toBe(true);
  });
});
