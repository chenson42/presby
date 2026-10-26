/**
 * The public events calendar's reader and its pins -
 * docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 T5 and T6.
 * No database: `@/lib/db` is mocked, and the migration is read as text.
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
import {
  PUBLIC_CALENDAR_FEATURE_KEY,
  PUBLIC_CALENDAR_MONTHS_AFTER,
  PUBLIC_CALENDAR_MONTHS_BEFORE,
  PUBLIC_CALENDAR_ROW_CAP,
  type PublicCalendarEvent,
} from "@/lib/calendar/public-contract";
import { ORG_FEATURE_CATALOG, isCategoryAxisOn } from "@/lib/org-features";
import { DEFAULT_ORG_TIME_ZONE } from "@/lib/shared/org-time";
import { mapPublicCalendarRow, readPublicCalendar } from "./public-calendar";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../drizzle/0067_presby_public_events_calendar.sql"),
  "utf8",
);

// ---------------------------------------------------------------------------
// T5: the SQL's literals are the TypeScript's constants
// ---------------------------------------------------------------------------

describe("T5 - the definer's literals are pinned to the TypeScript constants", () => {
  it("names the toggle key the catalog entry carries, and the member-calendar key", () => {
    expect(PUBLIC_CALENDAR_FEATURE_KEY).toBe("org_portal.public_calendar");
    expect(MIGRATION).toContain(`'${PUBLIC_CALENDAR_FEATURE_KEY}'`);
    expect(ORG_FEATURE_CATALOG.some((e) => e.key === PUBLIC_CALENDAR_FEATURE_KEY)).toBe(true);
    expect(MIGRATION).toContain("'org_portal.calendar'");
    expect(ORG_FEATURE_CATALOG.some((e) => e.key === "org_portal.calendar")).toBe(true);
  });

  it("composes the category the catalog says, for both keys, and no orgTypes allow-list exists to repeat", () => {
    for (const key of [PUBLIC_CALENDAR_FEATURE_KEY, "org_portal.calendar"]) {
      const entry = ORG_FEATURE_CATALOG.find((e) => e.key === key);
      expect(entry, key).toBeDefined();
      expect(entry!.category, key).toBe("worship");
      // The SQL repeats no applicability allow-list. An allow-list added later
      // fails HERE and forces the migration to follow.
      expect(entry!.orgTypes, key).toBeNull();
      expect(entry!.flag, key).toBeNull();
    }
    expect(MIGRATION).toContain("c.category = 'worship'");
  });

  it("reads the same category-axis flag the application reads", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);
    await isCategoryAxisOn();
    const flagKey = String(mockIsFlagEnabled.mock.calls[0]![0]);
    expect(flagKey).toBe("org_portal.feature_categories");
    expect(MIGRATION).toContain(`f.key = '${flagKey}'`);
  });

  it("mirrors the row cap and the window as the SQL states them", () => {
    expect(PUBLIC_CALENDAR_ROW_CAP).toBe(400);
    expect(MIGRATION).toMatch(new RegExp(`c_cap\\s+constant integer := ${PUBLIC_CALENDAR_ROW_CAP};`));
    expect(MIGRATION).toContain(
      `- interval '${PUBLIC_CALENDAR_MONTHS_BEFORE} month')`,
    );
    expect(MIGRATION).toContain(
      `+ interval '${PUBLIC_CALENDAR_MONTHS_AFTER + 1} months')`,
    );
  });

  it("uses the application's default organization time zone for an org with no settings row", () => {
    expect(MIGRATION).toMatch(
      new RegExp(`c_zone constant text\\s+:= '${DEFAULT_ORG_TIME_ZONE}';`),
    );
  });
});

// ---------------------------------------------------------------------------
// T6: mapper narrowing
// ---------------------------------------------------------------------------

function event(over: Record<string, unknown> = {}) {
  return {
    title: "Harvest supper",
    starts_at: "2027-03-14T18:00",
    ends_at: "2027-03-14T20:00",
    location: "Fellowship hall",
    description: "Bring a dish.",
    type_name: "Fellowship",
    type_color: "teal",
    ...over,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    state: "available",
    org_today: "2027-03-10",
    first_month: "2027-02",
    last_month: "2028-03",
    truncated: false,
    member_calendar_on: true,
    contact_phone: "555-0100",
    events_json: [event()],
    ...over,
  };
}

const UNAVAILABLE = { state: "unavailable" };

describe("T6 - mapPublicCalendarRow", () => {
  it("maps an available row field by field", () => {
    expect(mapPublicCalendarRow(row())).toEqual({
      state: "available",
      orgToday: "2027-03-10",
      firstMonth: { year: 2027, month: 2 },
      lastMonth: { year: 2028, month: 3 },
      truncated: false,
      memberCalendarOn: true,
      contactPhone: "555-0100",
      events: [
        {
          title: "Harvest supper",
          startsAt: "2027-03-14T18:00",
          endsAt: "2027-03-14T20:00",
          dayKey: "2027-03-14",
          location: "Fellowship hall",
          description: "Bring a dish.",
          typeName: "Fellowship",
          typeColor: "teal",
        },
      ],
    });
  });

  it("maps the unavailable row, a missing row and any other state to unavailable", () => {
    expect(mapPublicCalendarRow({ state: "unavailable" })).toEqual(UNAVAILABLE);
    expect(mapPublicCalendarRow(undefined)).toEqual(UNAVAILABLE);
    expect(mapPublicCalendarRow(row({ state: "live" }))).toEqual(UNAVAILABLE);
    expect(mapPublicCalendarRow(row({ state: undefined }))).toEqual(UNAVAILABLE);
  });

  it("maps a malformed row to unavailable, NEVER to an empty list", () => {
    const bad: Array<Record<string, unknown>> = [
      row({ org_today: "2027-02-30" }),
      row({ org_today: null }),
      row({ first_month: "2027-13" }),
      row({ first_month: null }),
      row({ last_month: "27-03" }),
      row({ last_month: 202703 }),
      row({ first_month: "2028-04", last_month: "2027-02" }), // reversed
      row({ first_month: "2027-01", last_month: "2028-03" }), // 15 months
      row({ truncated: "false" }),
      row({ truncated: null }),
      row({ member_calendar_on: 1 }),
      row({ contact_phone: 5550100 }),
      row({ events_json: "[]" }), // a string where the driver should have parsed jsonb
      row({ events_json: null }),
      row({ events_json: {} }),
      row({ events_json: [null] }),
      row({ events_json: ["x"] }),
      row({ events_json: [event({ title: "" })] }),
      row({ events_json: [event({ title: null })] }),
      row({ events_json: [event({ starts_at: "2027-03-14" })] }),
      row({ events_json: [event({ starts_at: "2027-02-30T10:00" })] }),
      row({ events_json: [event({ starts_at: 5 })] }),
      row({ events_json: [event({ location: 5 })] }),
      row({ events_json: [event({ description: {} })] }),
      row({ events_json: [event({ type_name: [] })] }),
    ];
    for (const r of bad) {
      expect(mapPublicCalendarRow(r), JSON.stringify(r).slice(0, 120)).toEqual(UNAVAILABLE);
    }
  });

  it("refuses an event outside the window, in either direction", () => {
    expect(
      mapPublicCalendarRow(row({ events_json: [event({ starts_at: "2027-01-31T10:00", ends_at: null })] })),
    ).toEqual(UNAVAILABLE);
    expect(
      mapPublicCalendarRow(row({ events_json: [event({ starts_at: "2028-04-01T10:00", ends_at: null })] })),
    ).toEqual(UNAVAILABLE);
    // The window's own edges are inside it.
    expect(
      mapPublicCalendarRow(
        row({
          events_json: [
            event({ starts_at: "2027-02-01T00:00", ends_at: null }),
            event({ starts_at: "2028-03-31T23:59", ends_at: null }),
          ],
        }),
      ).state,
    ).toBe("available");
  });

  it("refuses more events than the row cap", () => {
    const many = Array.from({ length: PUBLIC_CALENDAR_ROW_CAP + 1 }, () => event());
    expect(mapPublicCalendarRow(row({ events_json: many }))).toEqual(UNAVAILABLE);
    const atCap = Array.from({ length: PUBLIC_CALENDAR_ROW_CAP }, () => event());
    expect(mapPublicCalendarRow(row({ events_json: atCap })).state).toBe("available");
  });

  it("accepts a genuinely empty list from a successful read", () => {
    const mapped = mapPublicCalendarRow(row({ events_json: [] }));
    expect(mapped.state).toBe("available");
    expect(mapped.state === "available" && mapped.events).toEqual([]);
  });

  it("tolerates exactly three things: an end not after the start, an unknown colour, an empty string for an optional field", () => {
    const m = mapPublicCalendarRow(
      row({
        events_json: [
          event({ ends_at: "2027-03-14T18:00", type_color: "chartreuse", location: "", description: "" }),
          event({ ends_at: "2027-03-14T17:00" }),
          event({ ends_at: null, type_color: null, type_name: null }),
          event({ ends_at: "not a time" }),
        ],
      }),
    );
    expect(m.state).toBe("available");
    if (m.state !== "available") return;
    expect(m.events[0]).toMatchObject({ endsAt: null, typeColor: "neutral", location: null, description: null });
    expect(m.events[1]!.endsAt).toBeNull(); // before the start
    expect(m.events[2]).toMatchObject({ endsAt: null, typeColor: "neutral", typeName: null });
    expect(m.events[3]!.endsAt).toBeNull();
  });

  it("keeps an end on a later day", () => {
    const m = mapPublicCalendarRow(row({ events_json: [event({ ends_at: "2027-03-15T09:00" })] }));
    expect(m.state === "available" && m.events[0]!.endsAt).toBe("2027-03-15T09:00");
  });

  it("maps ONLY the allow-listed keys: an extra key on the row (an id, a flag) never reaches the page", () => {
    const m = mapPublicCalendarRow(
      row({
        events_json: [
          event({
            id: "d9100000-0000-0000-0000-0000000000a1",
            allows_checkin: true,
            created_by: "someone",
            is_public: true,
            website_listed: true,
            parent_event_id: "x",
          }),
        ],
      }),
    );
    expect(m.state).toBe("available");
    if (m.state !== "available") return;
    expect(Object.keys(m.events[0]!).sort()).toEqual(
      ["dayKey", "description", "endsAt", "location", "startsAt", "title", "typeColor", "typeName"],
    );
    expect(JSON.stringify(m)).not.toMatch(/d9100000|allows|created_by|website_listed|parent_event/);
  });

  it("PublicCalendarEvent has no id field (type level)", () => {
    expectTypeOf<PublicCalendarEvent>().not.toHaveProperty("id");
    expectTypeOf<PublicCalendarEvent>().toHaveProperty("title");
  });
});

// ---------------------------------------------------------------------------
// T6: the reader
// ---------------------------------------------------------------------------

describe("T6 - readPublicCalendar", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    vi.restoreAllMocks();
  });

  it("returns the mapped row for a successful read, array or { rows } shaped", async () => {
    mockExecute.mockResolvedValueOnce([row({ events_json: [] })]);
    expect((await readPublicCalendar("alder-creek")).state).toBe("available");
    mockExecute.mockResolvedValueOnce({ rows: [{ state: "unavailable" }] });
    expect(await readPublicCalendar("alder-creek-2")).toEqual(UNAVAILABLE);
  });

  it("a thrown error returns unavailable and logs the slug only (never the error or its message)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(
      new Error("connection to db-secret-host.example.invalid failed: password=hunter2"),
    );
    expect(await readPublicCalendar("bramblewood")).toEqual(UNAVAILABLE);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("[public-calendar] readPublicCalendar read failed; treating as unavailable");
    expect(logged).toContain("bramblewood");
    expect(logged).not.toMatch(/hunter2|db-secret-host|failed: password/);
    expect(spy.mock.calls[0]).toHaveLength(2);
    expect(spy.mock.calls[0]![1]).toEqual({ slug: "bramblewood" });
  });

  it("a driver that returns no rows reads as unavailable, not as an empty list", async () => {
    mockExecute.mockResolvedValueOnce([]);
    expect(await readPublicCalendar("fernwood")).toEqual(UNAVAILABLE);
  });

  it("a non-slug input never reaches the database", async () => {
    for (const bad of ["", "Church-One", "a.b", "church-one.invalid", "x y", "../etc", "a;drop", "-lead"]) {
      expect(await readPublicCalendar(bad), bad).toEqual(UNAVAILABLE);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("calls the definer with the slug as a bound parameter, on the anonymous db", async () => {
    mockExecute.mockResolvedValueOnce([row()]);
    await readPublicCalendar("elm-street");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const q = mockExecute.mock.calls[0]![0] as { queryChunks?: unknown[] };
    const flat = JSON.stringify(q.queryChunks);
    expect(flat).toContain("presby_public_events_calendar");
    expect(flat).toContain("elm-street");
  });
});
