/**
 * U6: `check:audit` scans only `actions.ts` files that call `db.` directly, and
 * every committee write lives in `store.ts`, so it cannot see the audit rows this
 * module writes. This source scan is the proof it would have been (docs/work-log/
 * 2026-11-19-presbytery-committees.md, Phase 3 "API Contract" and "Test plan" U6;
 * the oversight and person-photos `audit-coverage.test.ts` precedent):
 *
 *   - the nine Increment 1 keys exist in `AUDIT_ACTIONS`, as `tenant.committee.*`;
 *   - every exported `store.ts` write calls `audit(` the expected number of times
 *     (once; `updateCommittee` may write two), each with its own key, and `audit()`
 *     writes with `insertAuditRow(tx, ...)` (the SAME transaction), never
 *     `recordAudit()`;
 *   - the metadata keys each call passes equal the allowlist: ids, enumerations,
 *     booleans, counts, dates and field NAMES only, never a name, purpose,
 *     meets-when text or a person's name;
 *   - every one of the nine keys is used.
 *
 * The behavioural half (a failed audit insert undoes the change; sentinel strings
 * in every free-text field appear in no audit row) is `store.db.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STORE = readFileSync(path.join(__dirname, "store.ts"), "utf8");
const AUDIT_TS = readFileSync(path.join(__dirname, "../audit.ts"), "utf8");

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const KEYS: Record<string, string> = {
  COMMITTEE_CREATED: "tenant.committee.created",
  COMMITTEE_UPDATED: "tenant.committee.updated",
  COMMITTEE_LABELLED: "tenant.committee.labelled",
  COMMITTEE_DISSOLVED: "tenant.committee.dissolved",
  COMMITTEE_MEMBER_ADDED: "tenant.committee.member_added",
  COMMITTEE_MEMBER_ROLE_CHANGED: "tenant.committee.member_role_changed",
  COMMITTEE_MEMBER_ENDED: "tenant.committee.member_ended",
  COMMITTEE_MEMBER_LISTED: "tenant.committee.member_listed",
  COMMITTEE_MEMBER_UNLISTED: "tenant.committee.member_unlisted",
};

interface Expected {
  /** The audit key (or keys, in call order) the function writes. */
  keys: string[][];
  resourceType: string;
  /** Allowed metadata keys beyond `organizationId`, per call. */
  metadata: string[][];
}

const COMMITTEE_ONLY = ["committeeId"];

/** function -> what it audits, with which resource type and which metadata keys. Ids, enumerations, booleans, counts, dates and field names only. */
const WRITES: Record<string, Expected> = {
  createCommittee: {
    keys: [["COMMITTEE_CREATED"]],
    resourceType: "committee",
    metadata: [[...COMMITTEE_ONLY, "kind"]],
  },
  updateCommittee: {
    keys: [["COMMITTEE_UPDATED"], ["COMMITTEE_LABELLED"]],
    resourceType: "committee",
    metadata: [[...COMMITTEE_ONLY, "changed"], [...COMMITTEE_ONLY, "kind", "previousKind"]],
  },
  dissolveCommittee: {
    keys: [["COMMITTEE_DISSOLVED"]],
    resourceType: "committee",
    metadata: [[...COMMITTEE_ONLY, "dissolvedOn", "seatsEnded", "carriesRole"]],
  },
  addCommitteeSeat: {
    keys: [["COMMITTEE_MEMBER_ADDED"]],
    resourceType: "committee_member",
    metadata: [[...COMMITTEE_ONLY, "membershipId", "personId", "role", "startsOn", "endsOn", "grantsRole", "roleIds"]],
  },
  changeCommitteeSeatRole: {
    keys: [["COMMITTEE_MEMBER_ROLE_CHANGED"]],
    resourceType: "committee_member",
    metadata: [[...COMMITTEE_ONLY, "membershipId", "newMembershipId", "personId", "fromRole", "toRole", "effectiveOn", "grantsRole", "publicListed"]],
  },
  endCommitteeSeat: {
    keys: [["COMMITTEE_MEMBER_ENDED"]],
    resourceType: "committee_member",
    metadata: [[...COMMITTEE_ONLY, "membershipId", "personId", "role", "endsOn", "cancelled"]],
  },
  setCommitteeSeatPublicListed: {
    keys: [["COMMITTEE_MEMBER_LISTED", "COMMITTEE_MEMBER_UNLISTED"]],
    resourceType: "committee_member",
    metadata: [[...COMMITTEE_ONLY, "membershipId", "personId"]],
  },
};

/** Keys that could carry a value or a name: never allowed in any audit metadata. */
const FORBIDDEN_KEYS = /^(name|purpose|meetsWhen|description|title|charge|minute|text|displayName|personName|committeeName|existingName|firstName|lastName|email|input|values)$/;

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

describe("audit coverage of src/lib/committees/store.ts (U6)", () => {
  it("finds the module's writes (the scan is not vacuous)", () => {
    expect(fns.map((f) => f.name).sort()).toEqual(Object.keys(WRITES).sort());
  });

  it("the nine keys exist in AUDIT_ACTIONS as tenant.committee.*", () => {
    for (const [key, value] of Object.entries(KEYS)) {
      expect(AUDIT_TS, key).toContain(`${key}: "${value}"`);
      expect(value).toMatch(/^tenant\.committee\.[a-z_]+$/);
    }
  });

  it("every write calls audit( the expected number of times, with its own key(s) and resource type", () => {
    for (const fn of fns) {
      const expected = WRITES[fn.name]!;
      const calls = auditCalls(fn.body);
      expect(calls, `${fn.name} must audit ${expected.keys.length} time(s)`).toHaveLength(expected.keys.length);
      calls.forEach((call, i) => {
        for (const key of expected.keys[i]!) expect(call, `${fn.name} #${i}`).toContain(`AUDIT_ACTIONS.${key}`);
        expect(call, fn.name).toContain(`"${expected.resourceType}"`);
      });
    }
  });

  it("audit() writes with insertAuditRow(tx, ...) in the same transaction; recordAudit is nowhere in the file", () => {
    const code = stripComments(STORE);
    const body = /async function audit\([\s\S]*?\n}\n/.exec(code)?.[0] ?? "";
    expect(body).toMatch(/insertAuditRow\(\s*tx\b/);
    expect(body).toMatch(/metadata: \{ organizationId: ctx\.organizationId, \.\.\.metadata \}/);
    expect(code).not.toMatch(/\brecordAudit\b/);
    expect(code).toMatch(/from "@\/lib\/audit-tx"/);
  });

  it("the metadata keys each call passes equal the allowlist: ids, enumerations, booleans, counts, dates and field names only", () => {
    for (const fn of fns) {
      const expected = WRITES[fn.name]!;
      auditCalls(fn.body).forEach((call, i) => {
        expect(metadataKeys(call).sort(), `${fn.name} #${i}`).toEqual([...expected.metadata[i]!].sort());
      });
    }
  });

  it("no audit call passes a key that could carry a name or free text", () => {
    for (const fn of fns) {
      for (const call of auditCalls(fn.body)) {
        for (const key of metadataKeys(call)) expect(key, fn.name).not.toMatch(FORBIDDEN_KEYS);
      }
    }
  });

  it("every one of the nine keys is used", () => {
    const used = new Set(Object.values(WRITES).flatMap((w) => w.keys.flat()));
    expect([...used].sort()).toEqual(Object.keys(KEYS).sort());
  });

  it("the store's one `changed` array can only carry the three closed field names", () => {
    const contract = readFileSync(path.join(__dirname, "contract.ts"), "utf8");
    expect(contract).toMatch(/CHANGED_FIELDS = \["name", "purpose", "meetsWhen"\] as const/);
    expect(stripComments(STORE)).toMatch(/const changed: ChangedField\[\] = \[\]/);
  });
});

describe("the scan's helpers fail on samples that break the rules", () => {
  it("auditCalls and metadataKeys read a call and its keys", () => {
    const call = auditCalls('await audit(tx, ctx, AUDIT_ACTIONS.X, "t", id, { committeeId, changed, nested: { a: 1 }, flag: ok ? [1] : undefined });')[0]!;
    expect(metadataKeys(call)).toEqual(["committeeId", "changed", "nested", "flag"]);
  });
  it("a call with an extra key does not equal the allowlist, and a name-bearing key is forbidden", () => {
    const call = auditCalls('await audit(tx, ctx, AUDIT_ACTIONS.X, "t", id, { committeeId, name: n });')[0]!;
    expect(metadataKeys(call).sort()).not.toEqual(["committeeId"]);
    for (const key of ["name", "purpose", "meetsWhen", "personName", "displayName", "committeeName", "title", "charge"]) {
      expect(key).toMatch(FORBIDDEN_KEYS);
    }
    expect("committeeId").not.toMatch(FORBIDDEN_KEYS);
  });
  it("a function with no audit call, or two, is counted", () => {
    expect(auditCalls("export function a() { return 1; }")).toHaveLength(0);
    expect(auditCalls("await audit(tx, c, K, 't', i, {}); await audit(tx, c, K, 't', i, {});")).toHaveLength(2);
  });
});
