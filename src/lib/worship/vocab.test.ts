/**
 * The worship vocabularies are the Drizzle mirror's, the migration's and the
 * permission catalog's - pure (the migration is read as text).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

// Enter the domain cycle through the canonical entry point first
// (worship.schema.test.ts gives the reason); ./worship is re-exported from
// ./index.ts only at integration (Rule 16).
import "@/lib/db/schema";
import {
  WORSHIP_ASSIGNMENT_STATUSES,
  WORSHIP_NOTICE_OUTCOMES,
  WORSHIP_REASONS,
  WORSHIP_RESPONSE_SOURCES,
  WORSHIP_WITHDRAWN_REASONS,
} from "@/lib/db/domain/worship";
import { foundingAdministratorPlan } from "@/lib/onboarding/founding-administrator";
import {
  ANSWERS,
  ASSIGNMENT_STATUSES,
  LIMITS,
  NOTICE_OUTCOMES,
  REASONS,
  REASON_LABELS,
  RESPONSE_SOURCES,
  WITHDRAWN_REASONS,
  WORSHIP_KEYS,
  WORSHIP_TEMPLATE_KEYS,
  WORSHIP_TOGGLE_KEY,
  holdsAnyWorshipKey,
  isReason,
  statusForAnswer,
} from "./vocab";

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../drizzle/0085_presby_worship.sql"), "utf8");

describe("the vocabularies equal the Drizzle mirror (which the schema test pins to the CHECKs)", () => {
  it.each([
    ["statuses", ASSIGNMENT_STATUSES, WORSHIP_ASSIGNMENT_STATUSES],
    ["reasons", REASONS, WORSHIP_REASONS],
    ["response sources", RESPONSE_SOURCES, WORSHIP_RESPONSE_SOURCES],
    ["notice outcomes", NOTICE_OUTCOMES, WORSHIP_NOTICE_OUTCOMES],
    ["withdrawn reasons", WITHDRAWN_REASONS, WORSHIP_WITHDRAWN_REASONS],
  ] as const)("%s", (_name, mine, mirror) => {
    expect([...mine]).toEqual([...mirror]);
  });
});

describe("keys, toggle and template keys", () => {
  it("the three keys are the ones the migration creates and the founding bundle carries", () => {
    expect(Object.values(WORSHIP_KEYS)).toEqual(["worship.manage", "worship.plan", "worship.schedule"]);
    for (const key of Object.values(WORSHIP_KEYS)) expect(MIGRATION).toContain(`'${key}'`);
    const congregation = foundingAdministratorPlan("congregation").administration.permissionKeys;
    for (const key of Object.values(WORSHIP_KEYS)) expect(congregation).toContain(key);
  });

  it("the toggle key is the catalog key and the migration's toggle function reads it", () => {
    expect(WORSHIP_TOGGLE_KEY).toBe("org_portal.worship");
    expect(MIGRATION).toContain(`t.feature_key = '${WORSHIP_TOGGLE_KEY}'`);
  });

  it("the four notice template keys are person-addressed, unique, and in the worship.notice namespace", () => {
    const keys = Object.values(WORSHIP_TEMPLATE_KEYS);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^worship\.notice\.[a-z]+$/);
  });

  it("holdsAnyWorshipKey is true for any one key and false for none", () => {
    expect(holdsAnyWorshipKey({ manage: false, plan: false, schedule: false })).toBe(false);
    expect(holdsAnyWorshipKey({ manage: false, plan: false, schedule: true })).toBe(true);
    expect(holdsAnyWorshipKey({ manage: true, plan: false, schedule: false })).toBe(true);
  });
});

describe("answers and reasons", () => {
  it("accepted is stored as confirmed, declined as declined", () => {
    expect(ANSWERS).toEqual(["accepted", "declined"]);
    expect(statusForAnswer("accepted")).toBe("confirmed");
    expect(statusForAnswer("declined")).toBe("declined");
  });

  it("every reason has a label, and isReason is exact", () => {
    for (const reason of REASONS) expect(REASON_LABELS[reason]).toMatch(/^[A-Z][a-z]+$/);
    expect(isReason("away")).toBe(true);
    expect(isReason("vacation")).toBe(false);
    expect(isReason(undefined)).toBe(false);
  });
});

describe("limits mirror the database where the database has one", () => {
  it("position name 60, team name 80, service type name 80, location 200, guest name 80", () => {
    expect(MIGRATION).toMatch(/char_length\(name\) between 1 and 60/);
    expect(LIMITS.positionName).toBe(60);
    expect(MIGRATION).toMatch(/char_length\(name\) between 1 and 80/);
    expect(LIMITS.serviceTypeName).toBe(80);
    expect(LIMITS.guestName).toBe(80);
    expect(LIMITS.serviceTypeLocation).toBe(200);
  });

  it("slots 1 to 20, duration 15 to 480, 50 live blockouts", () => {
    expect(MIGRATION).toMatch(/slots between 1 and 20/);
    expect([LIMITS.slotsMin, LIMITS.slotsMax]).toEqual([1, 20]);
    expect(MIGRATION).toMatch(/duration_minutes between 15 and 480/);
    expect([LIMITS.durationMin, LIMITS.durationMax]).toEqual([15, 480]);
    expect(MIGRATION).toMatch(/c_live_cap constant integer := 50/);
    expect(LIMITS.blockoutLiveCap).toBe(50);
  });
});
