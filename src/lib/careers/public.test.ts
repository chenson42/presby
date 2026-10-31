/**
 * The careers anonymous reader and its pins - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T16 (mappers, reader) and the literal-pin half of T6. No database:
 * `@/lib/db` is mocked and the migration is read as text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));
const mockIsFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args) }));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG, isCategoryAxisOn } from "@/lib/org-features";
import { DEFAULT_ORG_TIME_ZONE } from "@/lib/shared/org-time";
import {
  CAREERS_FEATURE_KEY,
  PUBLIC_POSTINGS_CAP,
  type PublicPosting,
  type PublicPostingSummary,
} from "./contract";
import {
  mapPublicCareersRow,
  mapPublicPostingRow,
  readPublicCareers,
  readPublicPosting,
} from "./public";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../drizzle/0071_presby_careers.sql"),
  "utf8",
);

// ---------------------------------------------------------------------------
// T6 (literal pins): the SQL's literals are the TypeScript's constants
// ---------------------------------------------------------------------------

describe("T6 - the definer's literals are pinned to the TypeScript constants", () => {
  it("names the toggle key the catalog entry carries", () => {
    expect(CAREERS_FEATURE_KEY).toBe("org_portal.careers");
    expect(MIGRATION).toContain(`'${CAREERS_FEATURE_KEY}'`);
    expect(ORG_FEATURE_CATALOG.some((e) => e.key === CAREERS_FEATURE_KEY)).toBe(true);
  });

  it("composes the category the catalog says, and repeats no orgTypes allow-list", () => {
    const entry = ORG_FEATURE_CATALOG.find((e) => e.key === CAREERS_FEATURE_KEY);
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("people");
    expect(entry!.orgTypes).toBeNull();
    expect(entry!.flag).toBeNull();
    expect(entry!.operatorEnabled).toBe(false);
    expect(entry!.provisionedOn).toBe(false);
    expect(MIGRATION).toContain("c.category = 'people'");
  });

  it("reads the same category-axis flag the application reads", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);
    await isCategoryAxisOn();
    const flagKey = String(mockIsFlagEnabled.mock.calls[0]![0]);
    expect(flagKey).toBe("org_portal.feature_categories");
    expect(MIGRATION).toContain(`f.key = '${flagKey}'`);
  });

  it("mirrors the public list cap as the SQL states it", () => {
    expect(PUBLIC_POSTINGS_CAP).toBe(100);
    expect(MIGRATION).toMatch(new RegExp(`c_cap\\s+constant integer := ${PUBLIC_POSTINGS_CAP};`));
  });

  it("uses the application's default organization time zone for an org with no settings row", () => {
    expect(MIGRATION).toContain(`'${DEFAULT_ORG_TIME_ZONE}'`);
  });
});

// ---------------------------------------------------------------------------
// T16: mapper narrowing
// ---------------------------------------------------------------------------

function posting(over: Record<string, unknown> = {}) {
  return {
    slug: "music-director",
    title: "Music Director",
    location: "Fernwood",
    employment_type: "part_time",
    pay_min_cents: 4500,
    pay_max_cents: 6000,
    pay_unit: "hour",
    summary: "Lead our choirs.",
    posted_on: "2026-10-01",
    closing_date: "2026-12-01",
    ...over,
  };
}

function listRow(over: Record<string, unknown> = {}) {
  return {
    state: "available",
    organization_name: "Fernwood Presbyterian",
    contact_phone: "555-0100",
    org_today: "2026-10-25",
    postings_json: [posting()],
    posting_json: null,
    ...over,
  };
}

const UNAVAILABLE = { state: "unavailable" };
const FAILED = { state: "failed" };

describe("T16 - mapPublicCareersRow", () => {
  it("maps an available row field by field", () => {
    expect(mapPublicCareersRow(listRow())).toEqual({
      state: "available",
      organizationName: "Fernwood Presbyterian",
      contactPhone: "555-0100",
      orgToday: "2026-10-25",
      postings: [
        {
          slug: "music-director",
          title: "Music Director",
          location: "Fernwood",
          employmentType: "part_time",
          payMinCents: 4500,
          payMaxCents: 6000,
          payUnit: "hour",
          summary: "Lead our choirs.",
          postedOn: "2026-10-01",
          closingDate: "2026-12-01",
        },
      ],
    });
  });

  it("an EMPTY list is a successful available read, distinct from failed", () => {
    expect(mapPublicCareersRow(listRow({ postings_json: [] }))).toMatchObject({ state: "available", postings: [] });
  });

  it("a missing or empty phone is null; a non-string phone is failed", () => {
    expect(mapPublicCareersRow(listRow({ contact_phone: null }))).toMatchObject({ contactPhone: null });
    expect(mapPublicCareersRow(listRow({ contact_phone: undefined }))).toMatchObject({ contactPhone: null });
    expect(mapPublicCareersRow(listRow({ contact_phone: "" }))).toMatchObject({ contactPhone: null });
    expect(mapPublicCareersRow(listRow({ contact_phone: 5550100 }))).toEqual(FAILED);
  });

  it("the unavailable row (every other column null) is unavailable", () => {
    expect(
      mapPublicCareersRow({ state: "unavailable", organization_name: null, contact_phone: null, org_today: null, postings_json: null, posting_json: null }),
    ).toEqual(UNAVAILABLE);
  });

  it("pay may be absent: all three null", () => {
    const [p] = (mapPublicCareersRow(listRow({ postings_json: [posting({ pay_min_cents: null, pay_max_cents: null, pay_unit: null, closing_date: null })] })) as { postings: PublicPostingSummary[] }).postings;
    expect(p).toMatchObject({ payMinCents: null, payMaxCents: null, payUnit: null, closingDate: null });
  });

  describe.each([
    ["no row at all", undefined],
    ["an unknown state", listRow({ state: "weird" })],
    ["a posting-read state on a list", listRow({ state: "open" })],
    ["a missing state", { ...listRow(), state: undefined }],
    ["a null organization name", listRow({ organization_name: null })],
    ["an empty organization name", listRow({ organization_name: "" })],
    ["a non-date org_today", listRow({ org_today: "tomorrow" })],
    ["an impossible org_today", listRow({ org_today: "2026-02-30" })],
    ["postings_json as a STRING (the driver should have parsed it)", listRow({ postings_json: JSON.stringify([posting()]) })],
    ["postings_json as an object", listRow({ postings_json: { 0: posting() } })],
    ["postings_json null on an available row", listRow({ postings_json: null })],
    [`more than the cap (${PUBLIC_POSTINGS_CAP + 1}) postings`, listRow({ postings_json: Array.from({ length: PUBLIC_POSTINGS_CAP + 1 }, (_, i) => posting({ slug: `p-${i}` })) })],
    ["one bad posting among good ones", listRow({ postings_json: [posting(), posting({ title: "" }), posting({ slug: "other" })] })],
    ["a null posting entry", listRow({ postings_json: [null] })],
    ["an array posting entry", listRow({ postings_json: [[]] })],
    ["an unknown employment type", listRow({ postings_json: [posting({ employment_type: "contract" })] })],
    ["an unknown pay unit", listRow({ postings_json: [posting({ pay_unit: "month" })] })],
    ["a bad posted_on", listRow({ postings_json: [posting({ posted_on: "10/01/2026" })] })],
    ["a null posted_on", listRow({ postings_json: [posting({ posted_on: null })] })],
    ["a bad closing_date", listRow({ postings_json: [posting({ closing_date: "2026-13-40" })] })],
    ["a fractional pay amount", listRow({ postings_json: [posting({ pay_min_cents: 45.5 })] })],
    ["a negative pay amount", listRow({ postings_json: [posting({ pay_min_cents: -1 })] })],
    ["a string pay amount", listRow({ postings_json: [posting({ pay_max_cents: "6000" })] })],
    ["a non-slug posting slug", listRow({ postings_json: [posting({ slug: "../x" })] })],
    ["an uppercase posting slug", listRow({ postings_json: [posting({ slug: "Music" })] })],
    ["a missing key", listRow({ postings_json: [{ ...posting(), summary: undefined }] })],
    ["a non-string location", listRow({ postings_json: [posting({ location: 5 })] })],
  ])("%s maps to FAILED, never to an empty list", (_label, row) => {
    it("fails closed", () => {
      expect(mapPublicCareersRow(row as Record<string, unknown> | undefined)).toEqual(FAILED);
    });
  });

  it("an empty location is allowed (a draft requires none, a published one does; the mapper trusts the definer's CHECK)", () => {
    expect(mapPublicCareersRow(listRow({ postings_json: [posting({ location: "" })] }))).toMatchObject({ state: "available" });
  });

  it("ignores keys beyond the allow-list: an unexpected id never reaches the mapped object", () => {
    const mapped = mapPublicCareersRow(
      listRow({ postings_json: [{ ...posting(), id: "99999999-9999-9999-9999-999999999999", organization_id: "x", status: "published", version: 3 }] }),
    );
    expect(JSON.stringify(mapped)).not.toContain("99999999");
    expect(Object.keys((mapped as { postings: object[] }).postings[0]!).sort()).toEqual(
      ["closingDate", "employmentType", "location", "payMaxCents", "payMinCents", "payUnit", "postedOn", "slug", "summary", "title"],
    );
  });
});

describe("T16 - mapPublicPostingRow", () => {
  const openRow = (over: Record<string, unknown> = {}) => ({
    state: "open",
    organization_name: "Fernwood Presbyterian",
    contact_phone: null,
    org_today: "2026-10-25",
    postings_json: null,
    posting_json: { ...posting(), description_md: "## Duties\n\nLead." },
    ...over,
  });
  const closedRow = (over: Record<string, unknown> = {}) => ({
    state: "closed",
    organization_name: "Fernwood Presbyterian",
    contact_phone: "555-0100",
    org_today: "2026-10-25",
    postings_json: null,
    posting_json: { slug: "music-director", title: "Music Director" },
    ...over,
  });

  it("maps an open posting, including the description", () => {
    expect(mapPublicPostingRow(openRow())).toEqual({
      state: "open",
      organizationName: "Fernwood Presbyterian",
      contactPhone: null,
      posting: {
        slug: "music-director",
        title: "Music Director",
        location: "Fernwood",
        employmentType: "part_time",
        payMinCents: 4500,
        payMaxCents: 6000,
        payUnit: "hour",
        summary: "Lead our choirs.",
        postedOn: "2026-10-01",
        closingDate: "2026-12-01",
        descriptionMd: "## Duties\n\nLead.",
      },
    });
  });

  it("maps a closed posting to slug and title only, even if the row carried more", () => {
    const mapped = mapPublicPostingRow(
      closedRow({ posting_json: { slug: "music-director", title: "Music Director", description_md: "LEAKED", pay_min_cents: 1 } }),
    );
    expect(mapped).toEqual({
      state: "closed",
      organizationName: "Fernwood Presbyterian",
      contactPhone: "555-0100",
      slug: "music-director",
      title: "Music Director",
    });
    expect(JSON.stringify(mapped)).not.toContain("LEAKED");
  });

  it("unavailable and not_found pass through", () => {
    expect(mapPublicPostingRow({ state: "unavailable" })).toEqual(UNAVAILABLE);
    expect(mapPublicPostingRow({ state: "not_found" })).toEqual({ state: "not_found" });
  });

  describe.each([
    ["no row", undefined],
    ["a list state on a posting read", { ...openRow(), state: "available" }],
    ["an unknown state", openRow({ state: "gone" })],
    ["open with no description", openRow({ posting_json: { ...posting() } })],
    ["open with a non-string description", openRow({ posting_json: { ...posting(), description_md: 5 } })],
    ["open with a bad pay unit", openRow({ posting_json: { ...posting(), pay_unit: "week", description_md: "x" } })],
    ["open with a null posting_json", openRow({ posting_json: null })],
    ["open with posting_json as a string", openRow({ posting_json: JSON.stringify(posting()) })],
    ["open with an array posting_json", openRow({ posting_json: [] })],
    ["open with no organization name", openRow({ organization_name: null })],
    ["closed with no title", closedRow({ posting_json: { slug: "x" } })],
    ["closed with a non-slug slug", closedRow({ posting_json: { slug: "A B", title: "T" } })],
    ["closed with a null posting_json", closedRow({ posting_json: null })],
    ["a non-string phone", openRow({ contact_phone: {} })],
  ])("%s maps to FAILED", (_label, row) => {
    it("fails closed", () => {
      expect(mapPublicPostingRow(row as Record<string, unknown> | undefined)).toEqual(FAILED);
    });
  });
});

describe("T16 - the mapped objects have no id", () => {
  it("PublicPostingSummary and PublicPosting carry no identifier or internal column", () => {
    type Banned = "id" | "organizationId" | "organization_id" | "status" | "version" | "sortOrder" | "createdBy" | "updatedAt";
    expectTypeOf<Extract<keyof PublicPostingSummary, Banned>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof PublicPosting, Banned>>().toEqualTypeOf<never>();
  });
});

// ---------------------------------------------------------------------------
// T16: the readers
// ---------------------------------------------------------------------------

describe("T16 - readPublicCareers / readPublicPosting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a non-slug key never reaches the database and is unavailable", async () => {
    for (const bad of ["", "Not A Slug", "church.example.invalid", "../x", "a".repeat(200), "UPPER"]) {
      expect(await readPublicCareers(bad), bad).toEqual(UNAVAILABLE);
      expect(await readPublicPosting(bad, "music-director"), bad).toEqual(UNAVAILABLE);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("the list read is one definer call with the slug as a parameter", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [listRow()] });
    const result = await readPublicCareers("fernwood");
    expect(result.state).toBe("available");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(mockExecute.mock.calls[0]![0]);
    expect(text).toContain("presby_public_careers");
  });

  it("the posting read passes both parameters and maps the row", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ state: "closed", organization_name: "Fernwood Presbyterian", contact_phone: null, org_today: "2026-10-25", postings_json: null, posting_json: { slug: "a", title: "A" } }],
    });
    expect(await readPublicPosting("fernwood", "a")).toMatchObject({ state: "closed", slug: "a", title: "A" });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("accepts the driver's bare-array result shape too", async () => {
    mockExecute.mockResolvedValueOnce([listRow({ postings_json: [] })]);
    expect(await readPublicCareers("fernwood-array")).toMatchObject({ state: "available", postings: [] });
  });

  it("a thrown error is FAILED (not unavailable, not empty), logs the slug only, and never the error text", async () => {
    mockExecute.mockRejectedValueOnce(new Error("select * from presby_public_careers('fernwood-throws') SECRET-SQL-TEXT password=hunter2"));
    const result = await readPublicCareers("fernwood-throws");
    expect(result).toEqual(FAILED);
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    const logged = JSON.stringify(calls[0]);
    expect(logged).toContain("fernwood-throws");
    expect(logged).not.toContain("SECRET-SQL-TEXT");
    expect(logged).not.toContain("hunter2");
    expect(calls[0]!.every((arg) => !(arg instanceof Error))).toBe(true);
  });

  it("the posting reader fails the same way", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom SECRET"));
    expect(await readPublicPosting("fernwood-throws-2", "a")).toEqual(FAILED);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain("SECRET");
  });

  it("an absent row is FAILED, never an empty list", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    expect(await readPublicCareers("fernwood-norows")).toEqual(FAILED);
  });

  it("a posting key too long to be a slug is not_found without a query", async () => {
    expect(await readPublicPosting("fernwood", "a".repeat(201))).toEqual({ state: "not_found" });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("a malformed-but-short posting key is left to the definer (the same gate, the same read count)", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ state: "not_found", organization_name: null, contact_phone: null, org_today: null, postings_json: null, posting_json: null }] });
    expect(await readPublicPosting("fernwood-bad-key", "Bad Key!")).toEqual({ state: "not_found" });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
