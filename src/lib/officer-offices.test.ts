/**
 * The office vocabulary and its pins to the database
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2 Phase 3
 * Test Plan 1.8 and 1.10; DECISION-206; re-pointed by
 * docs/work-log/2026-10-25-parish-management.md Phase 4 Batch A, DECISION-242).
 * Pure: reads the migrations and two source files as text; no database.
 *
 * The pins read the NEWEST migration that (re)defines each object, found by
 * scanning drizzle/ rather than by a hard-coded number, so an integration
 * renumber needs no edit here. Today that is drizzle/0068_presby_parishes.sql
 * for both the CHECK and the CASE, and the test says so.
 */
import { readdirSync, readFileSync } from "node:fs";
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
// `officers.ts` reads the per-org parishes toggle through `org-features.ts`,
// which reaches the flag reader and so the connection pool at module scope.
vi.mock("@/lib/org-features", () => ({
  isCategoryAxisOn: vi.fn(),
  orgFeatureEnabledInTx: vi.fn(),
}));

import {
  AUTHORITY_OFFICES,
  OFFICER_OFFICES,
  OFFICE_LABELS,
  PASTOR_OFFICES,
  SESSION_OFFICES,
  isAuthorityOffice,
  isPastorOffice,
  isSessionOffice,
} from "./officer-offices";
import * as officersLib from "./officers";
import * as officeLabelsUi from "@/app/(org)/o/[slug]/admin/officers/office-labels";

const root = path.resolve(__dirname, "../..");
const CHECK_LEAD = "alter table officer_terms add constraint officer_terms_office_allowed";
const CASE_LEAD = "create or replace function presby_sync_derived_group()";

/** The newest drizzle/*.sql (by filename order) whose text contains `needle`. */
function newestMigrationWith(needle: string): { file: string; text: string } {
  const files = readdirSync(path.join(root, "drizzle"))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of files.reverse()) {
    const text = readFileSync(path.join(root, "drizzle", file), "utf8");
    if (text.includes(needle)) return { file, text };
  }
  throw new Error(`no migration contains "${needle}"`);
}

const CHECK_MIGRATION = newestMigrationWith(CHECK_LEAD);
const CASE_MIGRATION = newestMigrationWith(CASE_LEAD);

function caseBody(): string {
  const text = CASE_MIGRATION.text;
  const start = text.indexOf(CASE_LEAD);
  return text.slice(start, text.indexOf("end $$;", start));
}

const OFFICERS_SOURCE = readFileSync(path.join(root, "src/lib/officers.ts"), "utf8");

function quoted(list: string): string[] {
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("OFFICER_OFFICES", () => {
  it("the newest definition of the CHECK and of the derived-group CASE is the parishes migration (0068)", () => {
    expect(CHECK_MIGRATION.file).toMatch(/_presby_parishes\.sql$/);
    expect(CASE_MIGRATION.file).toMatch(/_presby_parishes\.sql$/);
  });

  it("equals the officer_terms_office_allowed CHECK in the newest migration that defines it", () => {
    const text = CHECK_MIGRATION.text;
    const start = text.lastIndexOf(CHECK_LEAD);
    expect(start).toBeGreaterThanOrEqual(0);
    const match = /check \(office in \(([^)]*)\)\)/.exec(text.slice(start));
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
    expect(OFFICE_LABELS.deacons_moderator).toBe("Moderator of the Board of Deacons");
    // S1 declined (P3-4): moderator keeps its label (DECISION-079).
    expect(OFFICE_LABELS.moderator).toBe("Moderator");
  });

  it("places deacons_moderator directly after deacon (presentational order)", () => {
    expect(OFFICER_OFFICES.indexOf("deacons_moderator")).toBe(
      OFFICER_OFFICES.indexOf("deacon") + 1,
    );
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
  it("equals the '-> session' arms of presby_sync_derived_group()'s CASE in the newest migration that defines it", () => {
    const fn = caseBody();
    const sessionArms = [...fn.matchAll(/when '([a-z_]+)'\s+then 'session'/g)].map(
      (m) => m[1]!,
    );
    expect([...SESSION_OFFICES].sort()).toEqual(sessionArms.sort());
  });

  it("the CASE maps exactly: Session offices -> session, deacon -> diaconate, deacons_moderator -> deacons_moderator, nothing else (moderator unmapped, DECISION-079)", () => {
    const arms = Object.fromEntries(
      [...caseBody().matchAll(/when '([a-z_]+)'\s+then '([a-z_]+)'/g)].map((m) => [m[1]!, m[2]!]),
    );
    expect(arms).toEqual({
      ruling_elder: "session",
      installed_pastor: "session",
      co_pastor: "session",
      associate_pastor: "session",
      deacon: "diaconate",
      deacons_moderator: "deacons_moderator",
    });
    for (const office of Object.keys(arms)) expect(OFFICER_OFFICES).toContain(office);
  });

  it("is G-3.0201: elders and installed, co- and associate pastors; never the moderator or deacon", () => {
    expect([...SESSION_OFFICES]).toEqual([
      "ruling_elder",
      "installed_pastor",
      "co_pastor",
      "associate_pastor",
    ]);
    for (const office of ["moderator", "deacon", "deacons_moderator", "clerk_of_session", "treasurer", "trustee"]) {
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

describe("AUTHORITY_OFFICES (F264, DECISION-242)", () => {
  it("is the Session offices plus the Board of Deacons Moderator seat, and nothing else", () => {
    expect([...AUTHORITY_OFFICES]).toEqual([...SESSION_OFFICES, "deacons_moderator"]);
    for (const office of AUTHORITY_OFFICES) expect(OFFICER_OFFICES).toContain(office);
  });

  it("recognises the seat and the Session offices; never moderator, deacon or the unmapped offices", () => {
    expect(isAuthorityOffice("deacons_moderator")).toBe(true);
    expect(isAuthorityOffice("ruling_elder")).toBe(true);
    for (const office of ["moderator", "deacon", "clerk_of_session", "treasurer", "trustee"]) {
      expect(isAuthorityOffice(office), office).toBe(false);
    }
    expect(isAuthorityOffice(undefined)).toBe(false);
  });

  it("SESSION_OFFICES does not include the seat (the derived-group CASE pin reads that list)", () => {
    expect(isSessionOffice("deacons_moderator")).toBe(false);
  });
});

describe("one list, re-exported", () => {
  it("officers.ts and the UI office-labels file re-export the very same arrays and labels", () => {
    expect(officersLib.OFFICER_OFFICES).toBe(OFFICER_OFFICES);
    expect(officersLib.OFFICE_LABELS).toBe(OFFICE_LABELS);
    expect(officeLabelsUi.OFFICER_OFFICES).toBe(OFFICER_OFFICES);
    expect(officeLabelsUi.OFFICE_LABELS).toBe(OFFICE_LABELS);
    expect(officeLabelsUi.SESSION_OFFICES).toBe(SESSION_OFFICES);
    expect(officeLabelsUi.AUTHORITY_OFFICES).toBe(AUTHORITY_OFFICES);
  });

  it("officers.ts no longer declares its own list", () => {
    expect(OFFICERS_SOURCE).not.toMatch(/export const OFFICER_OFFICES\s*=\s*\[/);
    expect(OFFICERS_SOURCE).not.toMatch(/export const OFFICE_LABELS\s*:/);
  });
});
