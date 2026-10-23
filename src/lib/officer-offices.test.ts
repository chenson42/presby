/**
 * The office vocabulary and its pins to the database
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2 Phase 3
 * Test Plan 1.8 and 1.10; DECISION-206). Pure: reads the migration and two
 * source files as text; no database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
// The domain barrel first: a bare `domain/officers` entry trips the known
// circular-import ordering defect (see roll-action-kinds.test.ts).
import "@/lib/db/domain";

vi.mock("server-only", () => ({}));
// `officers.ts` imports the tenant connection; the re-export check below needs
// only its module shape, never a database.
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));
vi.mock("@/lib/audit-tx", () => ({ insertAuditRow: vi.fn() }));

import {
  OFFICER_OFFICES,
  OFFICE_LABELS,
  PASTOR_OFFICES,
  SESSION_OFFICES,
  isPastorOffice,
  isSessionOffice,
} from "./officer-offices";
import * as officersLib from "./officers";
import * as officeLabelsUi from "@/app/(org)/o/[slug]/admin/officers/office-labels";

const root = path.resolve(__dirname, "../..");
const MIGRATION_0062 = readFileSync(
  path.join(root, "drizzle/0062_presby_session_approval.sql"),
  "utf8",
);
const OFFICERS_SOURCE = readFileSync(path.join(root, "src/lib/officers.ts"), "utf8");

function quoted(list: string): string[] {
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("OFFICER_OFFICES", () => {
  it("equals the officer_terms_office_allowed CHECK in 0062", () => {
    const start = MIGRATION_0062.indexOf(
      "alter table officer_terms add constraint officer_terms_office_allowed",
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const match = /check \(office in \(([^)]*)\)\)/.exec(MIGRATION_0062.slice(start));
    expect(match, "the CHECK's office list was not found").not.toBeNull();
    expect([...OFFICER_OFFICES].sort()).toEqual(quoted(match![1]!).sort());
  });

  it("equals listOfficerRoster()'s all_offices values list", () => {
    const match = /with all_offices\(office\) as \(\s*values([\s\S]*?)\n\s*\),/.exec(
      OFFICERS_SOURCE,
    );
    expect(match, "the all_offices values list was not found").not.toBeNull();
    expect([...OFFICER_OFFICES].sort()).toEqual(quoted(match![1]!).sort());
  });

  it("has a label for every office and no extra", () => {
    expect(Object.keys(OFFICE_LABELS).sort()).toEqual([...OFFICER_OFFICES].sort());
    for (const office of OFFICER_OFFICES) {
      expect(OFFICE_LABELS[office].length).toBeGreaterThan(0);
    }
    expect(OFFICE_LABELS.installed_pastor).toBe("Installed Pastor");
    expect(OFFICE_LABELS.co_pastor).toBe("Co-Pastor");
    expect(OFFICE_LABELS.associate_pastor).toBe("Associate Pastor");
  });

  it("puts the pastor offices after ruling_elder (presentational order)", () => {
    expect(OFFICER_OFFICES.slice(0, 4)).toEqual([
      "ruling_elder",
      "installed_pastor",
      "co_pastor",
      "associate_pastor",
    ]);
  });
});

describe("SESSION_OFFICES", () => {
  it("equals the '-> session' arms of presby_sync_derived_group()'s CASE in 0062", () => {
    const start = MIGRATION_0062.indexOf("create or replace function presby_sync_derived_group()");
    expect(start).toBeGreaterThanOrEqual(0);
    const fn = MIGRATION_0062.slice(
      start,
      MIGRATION_0062.indexOf("end $$;", start),
    );
    const sessionArms = [...fn.matchAll(/when '([a-z_]+)'\s+then 'session'/g)].map(
      (m) => m[1]!,
    );
    expect([...SESSION_OFFICES].sort()).toEqual(sessionArms.sort());
  });

  it("is G-3.0201: elders and installed, co- and associate pastors; never the moderator or deacon", () => {
    expect([...SESSION_OFFICES]).toEqual([
      "ruling_elder",
      "installed_pastor",
      "co_pastor",
      "associate_pastor",
    ]);
    for (const office of ["moderator", "deacon", "clerk_of_session", "treasurer", "trustee"]) {
      expect(isSessionOffice(office)).toBe(false);
    }
  });

  it("is a subset of the vocabulary, and PASTOR_OFFICES a subset of that", () => {
    for (const office of SESSION_OFFICES) expect(OFFICER_OFFICES).toContain(office);
    for (const office of PASTOR_OFFICES) expect(SESSION_OFFICES).toContain(office);
    expect([...PASTOR_OFFICES]).toEqual(["installed_pastor", "co_pastor", "associate_pastor"]);
    expect(isPastorOffice("ruling_elder")).toBe(false);
    expect(isPastorOffice("installed_pastor")).toBe(true);
  });

  it("the helpers refuse non-strings and look-alikes", () => {
    expect(isSessionOffice(undefined)).toBe(false);
    expect(isSessionOffice({ toString: () => "ruling_elder" })).toBe(false);
    expect(isPastorOffice(null)).toBe(false);
  });
});

describe("one list, re-exported", () => {
  it("officers.ts and the UI office-labels file re-export the very same arrays and labels", () => {
    expect(officersLib.OFFICER_OFFICES).toBe(OFFICER_OFFICES);
    expect(officersLib.OFFICE_LABELS).toBe(OFFICE_LABELS);
    expect(officeLabelsUi.OFFICER_OFFICES).toBe(OFFICER_OFFICES);
    expect(officeLabelsUi.OFFICE_LABELS).toBe(OFFICE_LABELS);
    expect(officeLabelsUi.SESSION_OFFICES).toBe(SESSION_OFFICES);
  });

  it("officers.ts no longer declares its own list", () => {
    expect(OFFICERS_SOURCE).not.toMatch(/export const OFFICER_OFFICES\s*=\s*\[/);
    expect(OFFICERS_SOURCE).not.toMatch(/export const OFFICE_LABELS\s*:/);
  });
});
