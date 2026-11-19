/**
 * U4: the contract's closed lists, limits and vocabulary equal the CHECK lists and
 * bounds PARSED OUT OF the migration (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "Test plan"). A list changed in one place and not the
 * other fails here. No database: the migration is read as text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Enter the domain cycle through the canonical entry point first (see oversight/contract.test.ts);
// ./committees is re-exported from domain/index.ts only at integration (Rule 16).
import "@/lib/db/schema";
import { COMMITTEE_DETAIL_KINDS, COMMISSION_MEMBER_ROLES } from "@/lib/db/domain/committees";
import { COMMITTEES_FLAG as REPORTS_CONTRACT_FLAG } from "@/lib/presbytery-reports/contract";
import { COMMITTEE_ROLES, GROUP_ROLE_VALUES } from "@/lib/group-roles";
import {
  CHANGED_FIELDS,
  COMMISSION_CHANGED_FIELDS,
  COMMITTEE_KIND_VALUES,
  COMMITTEE_KINDS,
  COMMITTEE_ROLE_OPTIONS,
  COMMITTEES_FLAG,
  GROUPS_MANAGE_KEY,
  LIMITS,
  isCommitteeKind,
} from "./contract";

const ROOT = path.resolve(__dirname, "../../..");
const SQL = readFileSync(path.join(ROOT, "drizzle/0090_presby_committees.sql"), "utf8");
const CONTRACT_SOURCE = readFileSync(path.join(__dirname, "contract.ts"), "utf8");
const GROUPS_SOURCE = readFileSync(path.join(ROOT, "src/lib/groups.ts"), "utf8");

/** The values of the `check (<column> ... in (...))` line whose text names the column. */
function listFor(column: string, requiredText = ""): string[] {
  const lines = SQL.split("\n").filter((l) => new RegExp(`\\bcheck\\s*\\(.*\\b${column}\\b.*\\bin\\s*\\(`, "i").test(l) && l.includes(requiredText));
  if (lines.length !== 1) throw new Error(`expected exactly one CHECK list for ${column}${requiredText ? ` (${requiredText})` : ""}, found ${lines.length}`);
  const inner = /\bin\s*\(([^)]*)\)/i.exec(lines[0]!)![1]!;
  return [...inner.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("contract.ts against drizzle/0090 (U4)", () => {
  it("GROUP_ROLE_VALUES is the group_role CHECK list, as a set", () => {
    expect([...GROUP_ROLE_VALUES].sort()).toEqual(listFor("group_role").sort());
  });

  it("COMMITTEE_KINDS is the committee_details kind CHECK list, and the Drizzle mirror agrees", () => {
    expect([...COMMITTEE_KIND_VALUES].sort()).toEqual(listFor("kind").sort());
    expect([...COMMITTEE_DETAIL_KINDS].sort()).toEqual([...COMMITTEE_KIND_VALUES].sort());
    expect(COMMITTEE_KINDS.map((k) => k.label)).toEqual(["Required", "Standing", "Ad hoc"]);
    expect(isCommitteeKind("ad_hoc")).toBe(true);
    expect(isCommitteeKind("other")).toBe(false);
  });

  it("COMMITTEE_ROLES (the offer set) is also the commission member CHECK list, six values, no leader", () => {
    const commissionRoles = listFor("role", "'vice_chair'").sort();
    expect([...COMMITTEE_ROLES].sort()).toEqual(commissionRoles);
    expect([...COMMISSION_MEMBER_ROLES].sort()).toEqual(commissionRoles);
    expect(COMMITTEE_ROLES).toHaveLength(6);
    expect(commissionRoles).not.toContain("leader");
    expect(COMMITTEE_ROLE_OPTIONS.map((o) => o.value)).toEqual([...COMMITTEE_ROLES]);
    expect(COMMITTEE_ROLE_OPTIONS.map((o) => o.label)).toEqual(["Chair", "Vice chair", "Clerk", "Secretary", "Ex officio", "Member"]);
  });

  it("every database date column the module writes has the 1900-01-01 floor LIMITS.dateFloor names", () => {
    expect(LIMITS.dateFloor).toBe("1900-01-01");
    expect(SQL).toContain("dissolved_on >= date '1900-01-01'");
    expect(SQL).toContain("starts_on >= date '1900-01-01'");
  });

  it("the name limit is the one groups.ts enforces (200), and purpose and meets-when are within the column's reach", () => {
    expect(LIMITS.nameMax).toBe(200);
    expect(GROUPS_SOURCE).toMatch(/name\.length > 200/);
    expect(LIMITS.purposeMax).toBe(2000);
    expect(LIMITS.meetsWhenMax).toBe(200);
    expect(LIMITS.startAheadYears).toBe(5);
    expect(LIMITS.endAheadYears).toBe(10);
  });

  it("the commission limits are the char_length bounds in 0090 section 3 (parsed out of the migration)", () => {
    expect(SQL).toMatch(/char_length\(btrim\(title\)\) between 1 and 200/);
    expect(LIMITS.titleMax).toBe(200);
    expect(SQL).toMatch(/charge is null or char_length\(charge\) <= 500/);
    expect(LIMITS.chargeMax).toBe(500);
    expect(SQL).toMatch(/minute_reference is null or char_length\(minute_reference\) <= 200/);
    expect(SQL).toMatch(/ended_minute_reference is null or char_length\(ended_minute_reference\) <= 200/);
    expect(LIMITS.minuteMax).toBe(200);
    expect(SQL).toContain("appointed_on >= date '1900-01-01'");
  });

  it("the commission audit `changed` vocabulary is field names only", () => {
    expect([...COMMISSION_CHANGED_FIELDS]).toEqual(["title", "charge", "congregation", "appointedOn", "minuteReference"]);
  });

  it("the audit `changed` vocabulary is field names only", () => {
    expect([...CHANGED_FIELDS]).toEqual(["name", "purpose", "meetsWhen"]);
  });

  it("the flag is the existing global one and equals the reports contract's; the key is groups.manage", () => {
    expect(COMMITTEES_FLAG).toBe("org_portal.committees");
    expect(REPORTS_CONTRACT_FLAG).toBe(COMMITTEES_FLAG);
    expect(GROUPS_MANAGE_KEY).toBe("groups.manage");
  });

  it("is pure: its only runtime import is the pure role vocabulary (a client form may import it)", () => {
    const code = CONTRACT_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const imports = [...code.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/group-roles"]);
    expect(code).not.toMatch(/server-only|@\/lib\/permissions|FEATURES/);
  });

  it("0090 never names presby_founding_administrator_permission_keys (the F362 integration hazard), not even in a comment", () => {
    expect(SQL).not.toMatch(/presby_founding_administrator_permission_keys/);
  });
});
