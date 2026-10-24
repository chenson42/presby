/**
 * Source-scan tests for the approval boundaries (docs/work-log/2026-10-22-
 * founding-admin-directory.md, Increment 2 Phase 3 Test Plan 1.9; R1, R13,
 * R16; DECISION-203, DECISION-205; F180). Each one reads source text, so a
 * property that is otherwise only true by review becomes a failing test the
 * moment someone breaks it. The behaviour itself is proven by `roll.test.ts`,
 * `officers.test.ts` and the database suites.
 *
 * THE 0063 SAFETY PROOF LIVES HERE: `drizzle/0063` revokes UPDATE and DELETE on
 * `roll_actions` from `presby_app`, which is safe only because no application
 * code updates or deletes that table. The scan below is what keeps that true
 * after this pipeline ships.
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

/** Removes `--` SQL line comments. */
function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gm, "");
}

const ROLL = path.join("src", "lib", "roll.ts");

describe("only src/lib/roll.ts calls the two decision definer functions (R1)", () => {
  const callPattern = /presby_(decide|withdraw)_roll_action\s*\(/;

  it("no other source file contains a call to either function", () => {
    const offenders = sourceFiles("src")
      .filter((rel) => rel !== ROLL)
      .filter((rel) => callPattern.test(stripComments(read(rel))));
    expect(offenders).toEqual([]);
  });

  it("roll.ts calls each exactly once (a second call site would be a second place to forget the audit row)", () => {
    const code = stripComments(read(ROLL));
    expect(code.match(/from\s+presby_decide_roll_action\s*\(/g)).toHaveLength(1);
    expect(code.match(/from\s+presby_withdraw_roll_action\s*\(/g)).toHaveLength(1);
  });
});

describe("no application code updates or deletes roll_actions (the 0063 safety proof, F180)", () => {
  const patterns: Array<[string, RegExp]> = [
    ["update(rollActions)", /\.update\(\s*rollActions\s*\)/],
    ["delete(rollActions)", /\.delete\(\s*rollActions\s*\)/],
    ["update roll_actions", /\bupdate\s+(only\s+)?(public\.)?"?roll_actions"?\b/i],
    ["delete from roll_actions", /\bdelete\s+from\s+(only\s+)?(public\.)?"?roll_actions"?\b/i],
  ];

  it.each(patterns)("no non-test file under src/ matches %s", (_label, pattern) => {
    const offenders = sourceFiles("src").filter((rel) => pattern.test(stripComments(read(rel))));
    expect(offenders).toEqual([]);
  });

  it("the only src file that INSERTs into roll_actions are the two proposal writers (roll.ts and people.ts), always pending", () => {
    const writers = sourceFiles("src").filter((rel) => /\.insert\(\s*rollActions\s*\)/.test(stripComments(read(rel))));
    expect(writers.sort()).toEqual([path.join("src", "lib", "people.ts"), ROLL].sort());
    for (const rel of writers) {
      const code = stripComments(read(rel));
      for (const block of code.split(/\.insert\(\s*rollActions\s*\)/).slice(1)) {
        const values = block.slice(0, block.indexOf(".returning"));
        expect(values, rel).toMatch(/approvalStatus:\s*"pending"/);
      }
    }
  });

  it("neither migration deletes anything (soft-delete rule)", () => {
    for (const file of [
      "drizzle/0062_presby_session_approval.sql",
      "drizzle/0063_presby_roll_decide_lockdown.sql",
    ]) {
      expect(stripSqlComments(read(file)), file).not.toMatch(/\bdelete\s+from\b/i);
    }
  });
});

describe("audit is written in the same transaction (R13, F180)", () => {
  const roll = stripComments(read(ROLL));

  it("roll.ts no longer imports recordAudit at all", () => {
    expect(roll).not.toMatch(/\brecordAudit\b/);
  });

  it("approve, deny and withdraw are written with insertAuditRow(tx, ...)", () => {
    expect(roll).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_APPROVED/);
    expect(roll).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_DENIED/);
    expect(roll).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.ROLL_ACTION_WITHDRAWN/);
  });

  it("an approval never reuses the on-record key, and the decision keys never appear outside their own function", () => {
    const approveBlock = roll.slice(
      roll.indexOf("export async function approveRollAction("),
      roll.indexOf("export async function denyRollAction("),
    );
    expect(approveBlock).toContain("ROLL_ACTION_APPROVED");
    expect(approveBlock).not.toContain("ROLL_ACTION_RECORDED");
    expect(approveBlock).not.toContain("ROLL_ACTION_DENIED");
    const denyBlock = roll.slice(
      roll.indexOf("export async function denyRollAction("),
      roll.indexOf("export async function withdrawRollAction("),
    );
    expect(denyBlock).toContain("ROLL_ACTION_DENIED");
    expect(denyBlock).not.toContain("ROLL_ACTION_APPROVED");
    const withdrawBlock = roll.slice(
      roll.indexOf("export async function withdrawRollAction("),
      roll.indexOf("export type ApproveRollActionsResult"),
    );
    expect(withdrawBlock).toContain("ROLL_ACTION_WITHDRAWN");
    expect(withdrawBlock).not.toContain("ROLL_ACTION_DENIED");
  });

  it("the audit metadata carries ids, dates and the reason only: no name field is ever passed", () => {
    const metadataBlocks = [...roll.matchAll(/metadata: \{([\s\S]*?)\}/g)].map((m) => m[1]!);
    expect(metadataBlocks.length).toBeGreaterThanOrEqual(5);
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/\b(name|displayName|firstName|lastName|email)\b/i);
    }
  });

  it("each decision pre-checks the right key before it calls the database: approve and deny roll.approve, withdraw roll.propose", () => {
    const blockOf = (start: string, end: string) =>
      roll.slice(roll.indexOf(start), roll.indexOf(end));
    const approve = blockOf("export async function approveRollAction(", "export async function denyRollAction(");
    const deny = blockOf("export async function denyRollAction(", "export async function withdrawRollAction(");
    const withdraw = blockOf("export async function withdrawRollAction(", "export type ApproveRollActionsResult");
    expect(approve.indexOf("hasRollApprove(")).toBeGreaterThan(-1);
    expect(approve.indexOf("hasRollApprove(")).toBeLessThan(approve.indexOf("callDecideFunction("));
    expect(deny.indexOf("hasRollApprove(")).toBeGreaterThan(-1);
    expect(deny.indexOf("hasRollApprove(")).toBeLessThan(deny.indexOf("callDecideFunction("));
    expect(withdraw.indexOf("hasRollPropose(")).toBeGreaterThan(-1);
    expect(withdraw.indexOf("hasRollPropose(")).toBeLessThan(withdraw.indexOf("presby_withdraw_roll_action"));
    expect(withdraw).not.toContain("hasRollApprove(");
  });

  it("the decision is fixed by WHICH function is called, never by an input field: no decision/status parameter is read from a caller's input", () => {
    for (const fn of ["approveRollAction(", "denyRollAction(", "withdrawRollAction("]) {
      const start = roll.indexOf(`export async function ${fn}`);
      const signature = roll.slice(start, roll.indexOf("): Promise<", start));
      expect(signature).not.toMatch(/decision|status|approvedBy|decidedBy/i);
    }
  });
});

describe("officer-term audit is written in the same transaction (R13, DECISION-205)", () => {
  const officers = stripComments(read("src/lib/officers.ts"));
  const actions = stripComments(read("src/app/(org)/o/[slug]/admin/officers/actions.ts"));

  it("startOfficerTerm and endOfficerTerm write their keys with insertAuditRow(tx, ...), never recordAudit()", () => {
    expect(officers).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.OFFICER_TERM_STARTED/);
    expect(officers).toMatch(/insertAuditRow\(tx, \{\s*action: AUDIT_ACTIONS\.OFFICER_TERM_ENDED/);
    expect(officers).not.toMatch(/recordAudit\(\{\s*action: AUDIT_ACTIONS\.OFFICER_TERM_(STARTED|ENDED)/);
  });

  it("both stamp selfRecorded", () => {
    const start = officers.slice(
      officers.indexOf("export async function startOfficerTerm("),
      officers.indexOf("export async function endOfficerTerm("),
    );
    const end = officers.slice(
      officers.indexOf("export async function endOfficerTerm("),
      officers.indexOf("export async function setOfficerTermPublicListed("),
    );
    expect(start).toMatch(/selfRecorded/);
    expect(end).toMatch(/selfRecorded/);
  });

  it("officers/actions.ts calls no recordAudit and imports no audit module at all", () => {
    expect(actions).not.toMatch(/\brecordAudit\b/);
    expect(actions).not.toMatch(/from\s+["']@\/lib\/audit["']/);
  });

  it("the end-term audit reads the person and office from the term's own row, not from input", () => {
    const end = officers.slice(
      officers.indexOf("export async function endOfficerTerm("),
      officers.indexOf("export async function setOfficerTermPublicListed("),
    );
    expect(end).toMatch(/personId:\s*term\.personId/);
    expect(end).toMatch(/office:\s*term\.office/);
    expect(end).not.toMatch(/input\.personId|input\.office/);
  });

  it("officers.ts still never writes group_memberships (The Court Is Not a Group)", () => {
    expect(officers).not.toMatch(/groupMemberships/);
    expect(officers).not.toMatch(/insert\s+into\s+group_memberships|update\s+group_memberships/i);
  });
});

describe("the pending-queue actions never call recordAudit (the lib audits in the transaction)", () => {
  it("pending/actions.ts has no recordAudit and no audit import", () => {
    const code = stripComments(read("src/app/(org)/o/[slug]/admin/community/pending/actions.ts"));
    expect(code).not.toMatch(/\brecordAudit\b/);
    expect(code).not.toMatch(/from\s+["']@\/lib\/audit["']/);
  });

  it("no action file under the community tree takes an organization id or a decision from the client", () => {
    for (const rel of [
      "src/app/(org)/o/[slug]/admin/community/pending/actions.ts",
    ]) {
      const code = stripComments(read(rel));
      expect(code, rel).not.toMatch(/input\.organizationId/);
      expect(code, rel).not.toMatch(/input\.(decision|status|approvedBy|decidedBy)/);
    }
  });
});
