/**
 * U6: `check:audit` scans only `actions.ts` files that call `db.` directly, and
 * every congregation-record write lives in `store.ts`, so it cannot see the audit
 * rows this module writes. This source scan is the proof it would have been
 * (docs/work-log/2026-11-17-congregation-profile.md, R4 "check:audit blind spot",
 * Phase 3 "API Contract" and "Test plan" U6; the person-photos and reimbursement
 * `audit-coverage.test.ts` precedent):
 *
 *   - the fourteen Increment 1 keys exist in `AUDIT_ACTIONS`, as `tenant.oversight_*`;
 *   - every exported `store.ts` write calls `audit(` EXACTLY ONCE, with its own
 *     key, and `audit()` writes with `insertAuditRow(tx, ...)` (the SAME
 *     transaction), never `recordAudit()`;
 *   - the metadata keys each call passes equal the allowlist: ids, enumerations,
 *     booleans, years and field NAMES only;
 *   - every one of the fourteen keys is used.
 *
 * The behavioural half (a failed audit insert undoes the change; sentinel values
 * in every free-text and money field appear in no audit row) is `store.db.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STORE = readFileSync(path.join(__dirname, "store.ts"), "utf8");
const AUDIT_TS = readFileSync(path.join(__dirname, "../audit.ts"), "utf8");

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const KEYS: Record<string, string> = {
  OVERSIGHT_PROFILE_SET: "tenant.oversight_profile.set",
  OVERSIGHT_BUILDING_CREATED: "tenant.oversight_building.created",
  OVERSIGHT_BUILDING_UPDATED: "tenant.oversight_building.updated",
  OVERSIGHT_BUILDING_RETIRED: "tenant.oversight_building.retired",
  OVERSIGHT_BUILDING_REMOVED: "tenant.oversight_building.removed",
  OVERSIGHT_APPRAISAL_RECORDED: "tenant.oversight_appraisal.recorded",
  OVERSIGHT_APPRAISAL_REMOVED: "tenant.oversight_appraisal.removed",
  OVERSIGHT_INSURANCE_RECORDED: "tenant.oversight_insurance.recorded",
  OVERSIGHT_INSURANCE_UPDATED: "tenant.oversight_insurance.updated",
  OVERSIGHT_INSURANCE_REMOVED: "tenant.oversight_insurance.removed",
  OVERSIGHT_LOAN_RECORDED: "tenant.oversight_loan.recorded",
  OVERSIGHT_LOAN_UPDATED: "tenant.oversight_loan.updated",
  OVERSIGHT_LOAN_PAID_OFF: "tenant.oversight_loan.paid_off",
  OVERSIGHT_LOAN_REMOVED: "tenant.oversight_loan.removed",
};

/** function -> [audit key, resourceType, allowed metadata keys beyond organizationId and aboutOrgId]. */
const WRITES: Record<string, [string, string, string[]]> = {
  setProfile: ["OVERSIGHT_PROFILE_SET", "oversight_profile", ["created", "changed"]],
  createBuilding: ["OVERSIGHT_BUILDING_CREATED", "oversight_building", ["buildingId", "primary", "previousPrimaryBuildingId"]],
  updateBuilding: ["OVERSIGHT_BUILDING_UPDATED", "oversight_building", ["buildingId", "changed", "previousPrimaryBuildingId"]],
  retireBuilding: ["OVERSIGHT_BUILDING_RETIRED", "oversight_building", ["buildingId", "reason"]],
  reinstateBuilding: ["OVERSIGHT_BUILDING_UPDATED", "oversight_building", ["buildingId", "changed", "previousPrimaryBuildingId"]],
  removeBuilding: ["OVERSIGHT_BUILDING_REMOVED", "oversight_building", ["buildingId"]],
  recordAppraisal: ["OVERSIGHT_APPRAISAL_RECORDED", "oversight_appraisal", ["buildingId", "appraisalId", "assessedYear"]],
  removeAppraisal: ["OVERSIGHT_APPRAISAL_REMOVED", "oversight_appraisal", ["buildingId", "appraisalId"]],
  recordInsurance: ["OVERSIGHT_INSURANCE_RECORDED", "oversight_insurance", ["insuranceId", "policyYear"]],
  updateInsurance: ["OVERSIGHT_INSURANCE_UPDATED", "oversight_insurance", ["insuranceId", "policyYear", "changed"]],
  removeInsurance: ["OVERSIGHT_INSURANCE_REMOVED", "oversight_insurance", ["insuranceId", "policyYear"]],
  recordLoan: ["OVERSIGHT_LOAN_RECORDED", "oversight_loan", ["loanId", "kind"]],
  updateLoan: ["OVERSIGHT_LOAN_UPDATED", "oversight_loan", ["loanId", "kind", "changed"]],
  markLoanPaidOff: ["OVERSIGHT_LOAN_PAID_OFF", "oversight_loan", ["loanId", "kind"]],
  removeLoan: ["OVERSIGHT_LOAN_REMOVED", "oversight_loan", ["loanId", "kind"]],
};

interface Fn {
  name: string;
  body: string;
}

/** The exported functions, each body running to the next top-level function (exported or not) or constant. */
function exportedFunctions(source: string): Fn[] {
  const c = stripComments(source);
  const starts = [...c.matchAll(/\n(?:export )?(?:async )?function (\w+)|\nconst \w+ =|\nclass \w+/g)];
  return starts
    .map((m, i) => ({ text: m[0], name: m[1], index: m.index!, end: starts[i + 1]?.index ?? c.length }))
    .filter((m) => m.text.startsWith("\nexport") && m.name)
    .map((m) => ({ name: m.name!, body: c.slice(m.index, m.end) }));
}

/** Every `audit(` call in a body: the text from the call to its closing parenthesis. */
function auditCalls(body: string): string[] {
  const calls: string[] = [];
  for (const m of body.matchAll(/await audit\(/g)) {
    let depth = 0;
    let end = m.index! + "await audit".length;
    for (let i = end; i < body.length; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    calls.push(body.slice(m.index!, end + 1));
  }
  return calls;
}

/** The top-level keys of the metadata object literal (the last argument) of an `audit(` call. */
function metadataKeys(call: string): string[] {
  const open = call.lastIndexOf("{");
  // The metadata is the final `{ ... }` argument: find its start by matching back from the call's end.
  let depth = 0;
  let start = -1;
  for (let i = call.length - 1; i >= 0; i--) {
    if (call[i] === "}") depth++;
    else if (call[i] === "{" && --depth === 0) {
      start = i;
      break;
    }
  }
  const inner = call.slice(start >= 0 ? start + 1 : open + 1, call.lastIndexOf("}"));
  const keys: string[] = [];
  let level = 0;
  let current = "";
  const flush = () => {
    const entry = current.trim();
    current = "";
    if (!entry) return;
    const m = /^(\w+)\s*(?::|$)/.exec(entry);
    if (m) keys.push(m[1]!);
  };
  for (const ch of inner) {
    if (ch === "{" || ch === "[" || ch === "(") level++;
    if (ch === "}" || ch === "]" || ch === ")") level--;
    if (ch === "," && level === 0) flush();
    else current += ch;
  }
  flush();
  return keys;
}

const fns = exportedFunctions(STORE);

describe("audit coverage of src/lib/oversight/store.ts (U6)", () => {
  it("finds the module's writes (the scan is not vacuous)", () => {
    expect(fns.map((f) => f.name).sort()).toEqual(Object.keys(WRITES).sort());
  });

  it("the fourteen keys exist in AUDIT_ACTIONS as tenant.oversight_*", () => {
    for (const [key, value] of Object.entries(KEYS)) {
      expect(AUDIT_TS, key).toContain(`${key}: "${value}"`);
      expect(value).toMatch(/^tenant\.oversight_[a-z]+\.[a-z_]+$/);
    }
  });

  it("every write calls audit( exactly once, with its own key and resource type", () => {
    for (const fn of fns) {
      const calls = auditCalls(fn.body);
      expect(calls, `${fn.name} must audit exactly once`).toHaveLength(1);
      const [key, resourceType] = WRITES[fn.name]!;
      expect(calls[0], fn.name).toContain(`AUDIT_ACTIONS.${key},`);
      expect(calls[0], fn.name).toContain(`"${resourceType}"`);
    }
  });

  it("audit() writes with insertAuditRow(tx, ...) in the same transaction; recordAudit is nowhere in the file", () => {
    const code = stripComments(STORE);
    const body = /async function audit\([\s\S]*?\n}\n/.exec(code)?.[0] ?? "";
    expect(body).toMatch(/insertAuditRow\(\s*tx\b/);
    expect(body).toMatch(/metadata: \{ organizationId: ctx\.organizationId, aboutOrgId, \.\.\.metadata \}/);
    expect(code).not.toMatch(/\brecordAudit\b/);
    expect(code).toMatch(/from "@\/lib\/audit-tx"/);
  });

  it("the metadata keys each call passes equal the allowlist: ids, enumerations, booleans, years and field names only", () => {
    for (const fn of fns) {
      const [, , allowed] = WRITES[fn.name]!;
      const keys = metadataKeys(auditCalls(fn.body)[0]!);
      expect(keys.sort(), fn.name).toEqual([...allowed].sort());
    }
  });

  it("no audit call passes a field that could carry a value: no amount, number, carrier, lender, note, caption or address", () => {
    const forbidden = /\b(amount|amountCents|balance|policyNumber|carrier|lender|notes?|caption|address|streetAddress|guaranteeNote|name|phone|city|county|input|values)\b\s*[:,}]/;
    for (const fn of fns) {
      for (const call of auditCalls(fn.body)) {
        const meta = call.slice(call.indexOf("aboutOrgId,") + "aboutOrgId,".length);
        expect(meta, fn.name).not.toMatch(forbidden);
      }
    }
  });

  it("every one of the fourteen keys is used", () => {
    const used = new Set(Object.values(WRITES).map(([key]) => key));
    expect([...used].sort()).toEqual(Object.keys(KEYS).sort());
  });

  it("the helpers that write without auditing (demotePrimary) are called only from audited functions", () => {
    const callers = fns.filter((f) => /\bdemotePrimary\(/.test(f.body)).map((f) => f.name).sort();
    expect(callers).toEqual(["createBuilding", "updateBuilding"]);
  });
});

describe("the scan's helpers fail on samples that break the rules", () => {
  it("auditCalls and metadataKeys read a call and its keys", () => {
    const call = auditCalls("await audit(tx, ctx, AUDIT_ACTIONS.X, \"t\", id, aboutOrgId, { buildingId: b, changed, nested: { a: 1 } });")[0]!;
    expect(metadataKeys(call)).toEqual(["buildingId", "changed", "nested"]);
  });
  it("a call with an extra key does not equal the allowlist", () => {
    const call = auditCalls("await audit(tx, ctx, AUDIT_ACTIONS.X, \"t\", id, aboutOrgId, { loanId: l, kind, amount: a });")[0]!;
    expect(metadataKeys(call).sort()).not.toEqual(["kind", "loanId"]);
  });
  it("a function with no audit call, or two, is caught", () => {
    expect(auditCalls("export function a() { return 1; }")).toHaveLength(0);
    expect(auditCalls("await audit(tx, c, K, 't', i, a, {}); await audit(tx, c, K, 't', i, a, {});")).toHaveLength(2);
  });
});
