import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { MIGRATION_0074 } from "./migration-text";
import { REIMBURSEMENT_KEYS, REIMBURSEMENT_TOGGLE_KEY, TREASURY_NEEDS } from "./keys";

describe("keys.ts agrees with drizzle/0074", () => {
  it("the four keys are exactly the permission rows 0074 inserts", () => {
    const inserted = [...MIGRATION_0074.matchAll(/\('(reimbursement\.[a-z_]+)', 'reimbursement',/g)].map((m) => m[1]!);
    expect(inserted.sort()).toEqual(Object.values(REIMBURSEMENT_KEYS).sort());
  });

  it("view, pay and manage require two-factor; request_for_others does not (Permissions & Flags table)", () => {
    const rows = [...MIGRATION_0074.matchAll(/\('(reimbursement\.[a-z_]+)', 'reimbursement',\s*'([^']*)', 2, (true|false)\)/g)];
    expect(rows).toHaveLength(4);
    const requires = Object.fromEntries(rows.map((r) => [r[1]!, r[3] === "true"]));
    expect(requires).toEqual({
      "reimbursement.request_for_others": false,
      "reimbursement.view": true,
      "reimbursement.pay": true,
      "reimbursement.manage": true,
    });
  });

  it("the descriptions in Copy C9 are the descriptions 0074 writes (Roles and the revoke dialog show them)", () => {
    const rows = [...MIGRATION_0074.matchAll(/\('(reimbursement\.[a-z_]+)', 'reimbursement',\s*'([^']*)', 2,/g)];
    for (const row of rows) {
      expect(COPY.permissionDescriptions[row[1] as keyof typeof COPY.permissionDescriptions], row[1]).toBe(row[2]);
    }
  });

  it("there is no reimbursement.request key (DECISION-269): who may file is the database's may_file", () => {
    expect(Object.values(REIMBURSEMENT_KEYS)).not.toContain("reimbursement.request");
  });

  it("the toggle key is the per-organization one (the catalog entry itself is pinned in org-feature-catalog.test.ts)", () => {
    expect(REIMBURSEMENT_TOGGLE_KEY).toBe("org_portal.reimbursement");
  });

  it("the treasury needs are the three keys that make the 'Treasurer view' link appear", () => {
    expect([...TREASURY_NEEDS]).toEqual(["view", "pay", "manage"]);
  });
});
