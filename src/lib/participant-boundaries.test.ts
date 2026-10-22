/**
 * Source-scan tests for the participant-on-record boundaries (docs/work-log/
 * 2026-10-22-founding-admin-directory.md, Phase 3 Test Plan 1.8, 1.7; R8, R14;
 * DECISION-198, DECISION-200). Each one reads source text, so a property that
 * is otherwise only true by review becomes a failing test the moment someone
 * breaks it. The behaviour itself is proven by the DB-backed suites.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Every non-test .ts/.tsx file under `dir` (relative to the repo root). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
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

describe("only src/lib/roll.ts calls the two participant definer functions (R8)", () => {
  const callPattern = /from\s+presby_(record|void)_participant_action\s*\(/;

  it("no other source file contains a call to either function", () => {
    const offenders = sourceFiles("src")
      .filter((rel) => rel !== path.join("src", "lib", "roll.ts"))
      .filter((rel) => callPattern.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it("roll.ts calls each exactly once (a second call site would be a second place to forget the audit row)", () => {
    const code = stripComments(read("src/lib/roll.ts"));
    expect(code.match(/from\s+presby_record_participant_action\s*\(/g)).toHaveLength(1);
    expect(code.match(/from\s+presby_void_participant_action\s*\(/g)).toHaveLength(1);
  });
});

describe("audit is written in the same transaction (R8)", () => {
  const roll = stripComments(read("src/lib/roll.ts"));

  it("the two on-record keys are written with insertAuditRow(tx, ...), never recordAudit()", () => {
    expect(roll).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_RECORDED/);
    expect(roll).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_VOIDED/);
    expect(roll).not.toMatch(/recordAudit\(\{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_(RECORDED|VOIDED)/);
  });

  it("an on-record act never reuses the Session's approval key", () => {
    const recordedBlock = roll.slice(
      roll.indexOf("export async function recordParticipantActionInTx"),
      roll.indexOf("export async function recordParticipantAction("),
    );
    expect(recordedBlock).not.toContain("ROLL_ACTION_APPROVED");
    const voidBlock = roll.slice(roll.indexOf("export async function voidParticipantAction"));
    expect(voidBlock.slice(0, voidBlock.indexOf("// ----"))).not.toContain("ROLL_ACTION_APPROVED");
  });

  it("the audit metadata carries ids and dates only: no name field is ever passed", () => {
    const metadataBlocks = [...roll.matchAll(/metadata: \{([\s\S]*?)\}/g)].map((m) => m[1]!);
    expect(metadataBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/\b(name|displayName|firstName|lastName|email)\b/i);
    }
  });
});

describe("visitors and staff stay out of the member Directory (DECISION-200)", () => {
  const directory = read("src/lib/directory.ts");
  const directoryCode = stripComments(directory);

  it("directory.ts never imports community.ts", () => {
    expect(directory).not.toMatch(/from\s+["'][^"']*community["']/);
  });

  it("no module the Directory's finder or portal home use imports community.ts", () => {
    for (const rel of ["src/lib/org-portal/find-person.ts", "src/lib/org-portal/home-data.ts"]) {
      expect(read(rel), rel).not.toMatch(/from\s+["'][^"']*\/community["']/);
    }
  });

  it("the eligibility predicate text never names the visitor or staff engagement values", () => {
    const start = directoryCode.indexOf("function directoryEligibilityWhereSql(");
    expect(start).toBeGreaterThan(-1);
    const body = directoryCode.slice(start, directoryCode.indexOf("\n}\n", start));
    expect(body).not.toMatch(/'visitor'|'staff'|"visitor"|"staff"/);
    // And the only engagement value it admits is the one it always did.
    expect(body).toContain("m.engagement_status = 'regular'");
  });

  it("nothing in directory.ts as a whole names those values in code", () => {
    expect(directoryCode).not.toMatch(/'visitor'|'staff'|"visitor"|"staff"/);
  });
});

describe("community.ts is people.manage-gated and read-only (DECISION-197, R14)", () => {
  const community = stripComments(read("src/lib/community.ts"));

  it("every withOrgContext transaction checks people.manage first", () => {
    const transactions = community.match(/withOrgContext\(/g)?.length ?? 0;
    const gates = community.match(/await canManagePeople\(/g)?.length ?? 0;
    expect(transactions).toBeGreaterThanOrEqual(3);
    expect(gates).toBe(transactions);
    expect(community).toContain('const PEOPLE_MANAGE = "people.manage"');
  });

  it("never gates on directory.view (these lists must work without it)", () => {
    expect(community).not.toContain("directory.view");
  });

  it("writes nothing: no insert, update or delete", () => {
    expect(community).not.toMatch(/\.(insert|update|delete)\(|\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("nothing new hard-deletes (R14, operator ruling: all deletes are soft)", () => {
  const files = [
    "src/lib/roll.ts",
    "src/lib/community.ts",
    "src/lib/community-labels.ts",
    "src/app/(org)/o/[slug]/admin/community/new/actions.ts",
    "src/app/(org)/o/[slug]/admin/community/[id]/edit/actions.ts",
  ];

  it.each(files)("%s has no delete statement", (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toMatch(/\.delete\(|\bdelete\s+from\b/i);
  });

  it("the on-record paths end a membership with ended_on only through the database function (TypeScript never updates memberships)", () => {
    const code = stripComments(read("src/lib/roll.ts"));
    expect(code).not.toMatch(/\.update\(memberships\)|update\s+memberships/i);
  });
});
