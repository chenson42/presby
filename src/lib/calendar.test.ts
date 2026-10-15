/**
 * Integration tests for src/lib/calendar.ts - the member read path - against a
 * REAL Postgres connection (the `events.test.ts` harness: `hasDb` skip-guard,
 * dynamic imports in `beforeAll`, `deletable_until` fixture orgs, torn down per
 * file). Run for real with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/calendar.test.ts
 *
 * EVERY read test runs under all three process time zones (UTC, a DST zone, a
 * no-DST zone) with injected `now` values chosen so the org-local day differs
 * from the UTC day, e.g. 2026-11-01T03:30:00Z is the evening of Oct 31 in New
 * York. Stored event times are wall-clock text and must come back identical
 * whatever the process zone; "today" must follow the ORG's zone.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { TEST_TIME_ZONES, useProcessTimeZone } from "@/lib/testing/time-zone";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
// calendar.ts -> org-features.ts -> @/lib/audit -> @/auth (next-auth) is not
// resolvable here (the constraint org-features.test.ts documents). Reads only.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

const AXIS_FLAG = "org_portal.feature_categories";

describe.skipIf(!hasDb)("calendar.ts (Postgres-backed, real dev database)", () => {
  let getMonthCalendar: typeof import("./calendar").getMonthCalendar;
  let getMemberEvent: typeof import("./calendar").getMemberEvent;
  let listUpcomingMemberEvents: typeof import("./calendar").listUpcomingMemberEvents;
  let events: typeof import("@/lib/db/domain/events").events;
  let eventTypes: typeof import("@/lib/db/domain/events").eventTypes;
  let featureFlags: typeof import("@/lib/db/schema").featureFlags;
  let organizationFeatureCategories: typeof import("@/lib/db/domain/org-feature-categories").organizationFeatureCategories;
  let parseWallClock: typeof import("@/lib/events/wall-clock").parseWallClock;
  let fx: CalendarFixture;

  // Organizations
  let orgA: string; // America/New_York row; the rich month fixture
  let orgB: string; // a different tenant: foreign ids
  let orgU: string; // upcoming-feed fixture (NY row)
  let orgH: string; // Pacific/Honolulu row
  let orgN: string; // NO settings row (the F132 default)
  let orgZ: string; // zero event types, one event
  let orgEmpty: string; // no types, no events
  let orgOff: string; // calendar toggle row = false
  let orgNoToggle: string; // no toggle row at all

  // People
  // A person can hold a membership in ONE organization only (the
  // presby_guard_membership_insert guard), so every org gets its own viewer.
  const viewers = new Map<string, string>();
  const V = (org: string): string => viewers.get(org)!;
  let pView: string; // events.view only, orgA's viewer
  let pManage: string; // events.manage only, orgA
  let pManageOff: string; // events.manage only, orgOff
  let pNone: string; // member of A, holds nothing
  let pOut: string; // events.view in B only

  // orgA types
  const typeA: Record<"worship" | "study" | "youth" | "music" | "general", string> =
    {} as never;
  let typeBFallback: string;

  // orgA events
  const evA: Record<string, string> = {};
  let evForeign: string;
  // orgU
  const evU: Record<string, string> = {};
  let uSeriesParent: string;
  let uTie1: string;
  let uTie2: string;

  async function addType(
    organizationId: string,
    t: {
      name: string;
      color: string;
      icon: string;
      sortOrder: number;
      isActive?: boolean;
      isFallback?: boolean;
    },
  ) {
    const [row] = await fx.platform
      .insert(eventTypes)
      .values({
        organizationId,
        name: t.name,
        color: t.color,
        icon: t.icon,
        sortOrder: t.sortOrder,
        isActive: t.isActive ?? true,
        isFallback: t.isFallback ?? false,
      })
      .returning({ id: eventTypes.id });
    return row!.id;
  }

  async function addEvent(
    organizationId: string,
    e: {
      id?: string;
      title: string;
      startsAt: string;
      endsAt?: string;
      typeId?: string | null;
      isPublic?: boolean;
      cancelled?: boolean;
      parentId?: string;
      pattern?: string;
      count?: number;
    },
  ) {
    const [row] = await fx.platform
      .insert(events)
      .values({
        ...(e.id ? { id: e.id } : {}),
        organizationId,
        title: e.title,
        startsAt: parseWallClock(e.startsAt),
        endsAt: e.endsAt ? parseWallClock(e.endsAt) : null,
        isPublic: e.isPublic ?? true,
        eventTypeId: e.typeId ?? null,
        cancelledAt: e.cancelled ? new Date() : null,
        parentEventId: e.parentId ?? null,
        recurrencePattern: e.pattern ?? null,
        recurrenceCount: e.count ?? null,
      })
      .returning({ id: events.id });
    return row!.id;
  }

  beforeAll(async () => {
    ({ getMonthCalendar, getMemberEvent, listUpcomingMemberEvents } = await import(
      "./calendar"
    ));
    ({ events, eventTypes } = await import("@/lib/db/domain/events"));
    ({ featureFlags } = await import("@/lib/db/schema"));
    ({ organizationFeatureCategories } = await import(
      "@/lib/db/domain/org-feature-categories"
    ));
    ({ parseWallClock } = await import("@/lib/events/wall-clock"));
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("calendar-test");

    const on = { calendarToggle: true as const };
    orgA = await fx.makeOrg("a", { ...on, timeZone: "America/New_York" });
    orgB = await fx.makeOrg("b", { ...on, timeZone: "America/New_York" });
    orgU = await fx.makeOrg("u", { ...on, timeZone: "America/New_York" });
    orgH = await fx.makeOrg("h", { ...on, timeZone: "Pacific/Honolulu" });
    orgN = await fx.makeOrg("n", { ...on }); // no settings row
    orgZ = await fx.makeOrg("z", { ...on });
    orgEmpty = await fx.makeOrg("empty", { ...on });
    orgOff = await fx.makeOrg("off", { calendarToggle: false });
    orgNoToggle = await fx.makeOrg("notoggle", {});

    pManage = await fx.makePerson("Percival", "Hartnell");
    pManageOff = await fx.makePerson("Marguerite", "Dunlop");
    pNone = await fx.makePerson("Nerys", "Ashcombe");
    pOut = await fx.makePerson("Oswin", "Farthing");

    const surnames = ["Brightwater", "Calloway", "Dunmore", "Eversley", "Fairbourne", "Galloway", "Hartwell"];
    let n = 0;
    for (const org of [orgA, orgU, orgH, orgN, orgZ, orgEmpty, orgNoToggle]) {
      const person = await fx.makePerson("Viola", surnames[n++]);
      viewers.set(org, person);
      await fx.enroll(org, person, ["events.view"]);
    }
    pView = V(orgA);
    await fx.enroll(orgA, pManage, ["events.manage"]);
    await fx.enroll(orgOff, pManageOff, ["events.manage"]);
    await fx.enroll(orgA, pNone, []);
    await fx.enroll(orgB, pOut, ["events.view"]);

    // ---- orgA: types ------------------------------------------------------
    typeA.worship = await addType(orgA, { name: "Worship", color: "teal", icon: "Church", sortOrder: 10 });
    typeA.study = await addType(orgA, { name: "Study", color: "sky", icon: "BookOpen", sortOrder: 20 });
    typeA.youth = await addType(orgA, { name: "Youth", color: "lime", icon: "Backpack", sortOrder: 30 });
    typeA.music = await addType(orgA, { name: "Music", color: "violet", icon: "Music", sortOrder: 40, isActive: false });
    typeA.general = await addType(orgA, { name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isFallback: true });

    // ---- orgA: events -----------------------------------------------------
    evA.worship = await addEvent(orgA, { title: "Sunday Worship", startsAt: "2026-10-04T10:00", endsAt: "2026-10-04T11:00", typeId: typeA.worship });
    evA.study = await addEvent(orgA, { title: "Members Only Study", startsAt: "2026-10-06T19:00", typeId: typeA.study, isPublic: false });
    evA.potluck = await addEvent(orgA, { title: "Untyped Potluck", startsAt: "2026-10-10T12:00" });
    evA.cancelled = await addEvent(orgA, { title: "Cancelled Picnic", startsAt: "2026-10-11T10:00", typeId: typeA.worship, cancelled: true });
    evA.concert = await addEvent(orgA, { title: "Retired Type Concert", startsAt: "2026-10-12T19:00", typeId: typeA.music });
    evA.multiDay = await addEvent(orgA, { title: "Retreat", startsAt: "2026-10-16T18:00", endsAt: "2026-10-18T12:00", typeId: typeA.study });
    evA.nov = await addEvent(orgA, { title: "November Thing", startsAt: "2026-11-15T10:00", typeId: typeA.worship });
    // Half-open bounds around the October 2026 grid (2026-09-27 .. 2026-10-31).
    evA.bBefore = await addEvent(orgA, { title: "B before first day", startsAt: "2026-09-26T23:59:59" });
    evA.bFirst = await addEvent(orgA, { title: "B first day midnight", startsAt: "2026-09-27T00:00:00" });
    evA.bFirstPlus = await addEvent(orgA, { title: "B first day plus one second", startsAt: "2026-09-27T00:00:01" });
    evA.bLast = await addEvent(orgA, { title: "B last minute", startsAt: "2026-10-31T23:59:59" });
    evA.bAfter = await addEvent(orgA, { title: "B day after midnight", startsAt: "2026-11-01T00:00:00" });

    // ---- orgB: a foreign tenant -------------------------------------------
    typeBFallback = await addType(orgB, { name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isFallback: true });
    evForeign = await addEvent(orgB, { title: "Foreign Event", startsAt: "2026-10-04T09:00", typeId: typeBFallback });

    // ---- orgU: the upcoming feed ------------------------------------------
    const uWorship = await addType(orgU, { name: "Worship", color: "teal", icon: "Church", sortOrder: 10 });
    await addType(orgU, { name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isFallback: true });
    evU.old = await addEvent(orgU, { title: "Old Event", startsAt: "2026-10-20T10:00" });
    // Exactly 00:00 on "today" (Nov 1): the lower bound is INCLUSIVE.
    evU.midnight = await addEvent(orgU, { title: "Midnight Today", startsAt: "2026-11-01T00:00" });
    evU.morning = await addEvent(orgU, { title: "Morning Service", startsAt: "2026-11-01T10:30", typeId: uWorship });
    evU.cancelledLater = await addEvent(orgU, { title: "Cancelled Later", startsAt: "2026-11-02T10:00", cancelled: true });
    evU.private = await addEvent(orgU, { title: "Members Only Later", startsAt: "2026-11-03T08:00", isPublic: false });
    uTie1 = await addEvent(orgU, { id: "00000000-0000-4000-8000-0000000000a1", title: "Tie One", startsAt: "2026-11-03T09:00" });
    uTie2 = await addEvent(orgU, { id: "00000000-0000-4000-8000-0000000000a2", title: "Tie Two", startsAt: "2026-11-03T09:00" });
    uSeriesParent = await addEvent(orgU, { title: "Weekly Choir", startsAt: "2026-10-05T19:00", pattern: "weekly", count: 5 });
    evU.choirPast = await addEvent(orgU, { title: "Weekly Choir", startsAt: "2026-10-12T19:00", parentId: uSeriesParent });
    evU.choirNext = await addEvent(orgU, { title: "Weekly Choir", startsAt: "2026-11-02T19:00", parentId: uSeriesParent });
    await addEvent(orgU, { title: "Weekly Choir", startsAt: "2026-11-09T19:00", parentId: uSeriesParent });
    await addEvent(orgU, { title: "Weekly Choir", startsAt: "2026-11-16T19:00", parentId: uSeriesParent });
    for (let i = 1; i <= 14; i += 1) {
      await addEvent(orgU, {
        title: `Filler ${i}`,
        startsAt: `2027-03-${String(i).padStart(2, "0")}T08:00`,
      });
    }

    // ---- zone orgs ----------------------------------------------------------
    evA.honolulu = await addEvent(orgH, { title: "Honolulu Evening", startsAt: "2026-10-31T18:00" });
    evA.nyLate = await addEvent(orgN, { title: "NY Late", startsAt: "2026-10-31T20:00" });
    await addType(orgN, { name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isFallback: true });
    evA.zOnly = await addEvent(orgZ, { title: "Typeless Event", startsAt: "2026-10-10T10:00" });
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  describe.each(TEST_TIME_ZONES)("under process TZ=%s", (zone) => {
    useProcessTimeZone(zone, { beforeAll, afterAll });

    const MID_OCT = new Date("2026-10-15T16:00:00Z");
    const OCT = { year: 2026, month: 10 };

    function titles(entries: Array<{ title: string }>) {
      return entries.map((e) => e.title);
    }

    async function monthA(
      requestedTypeIds: readonly string[] = [],
      month: { year: number; month: number } = OCT,
    ) {
      const result = await getMonthCalendar(pView, orgA, {
        month,
        requestedTypeIds,
        now: MID_OCT,
      });
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      return result.data;
    }

    // -----------------------------------------------------------------------
    describe("the gate matrix", () => {
      it("events.view only: ok, canManage false", async () => {
        const r = await getMonthCalendar(pView, orgA, { month: OCT, requestedTypeIds: [], now: MID_OCT });
        expect(r.kind).toBe("ok");
        if (r.kind === "ok") expect(r.data.canManage).toBe(false);
      });

      it("events.manage only: ok, canManage true (R8: manage reads what the admin list reads)", async () => {
        const r = await getMonthCalendar(pManage, orgA, { month: OCT, requestedTypeIds: [], now: MID_OCT });
        expect(r.kind).toBe("ok");
        if (r.kind === "ok") expect(r.data.canManage).toBe(true);
      });

      it("a member holding neither: forbidden, from all three exports", async () => {
        expect(await getMonthCalendar(pNone, orgA, { month: OCT, requestedTypeIds: [], now: MID_OCT })).toEqual({ kind: "forbidden" });
        expect(await getMemberEvent(pNone, orgA, evA.worship)).toEqual({ kind: "forbidden" });
        expect(await listUpcomingMemberEvents(pNone, orgA, { limit: 5, now: MID_OCT })).toEqual({ kind: "forbidden" });
      });

      it("forbidden comes BEFORE any lookup: a garbage id and a real id answer identically", async () => {
        expect(await getMemberEvent(pNone, orgA, "not-a-uuid")).toEqual({ kind: "forbidden" });
        expect(await getMemberEvent(pNone, orgA, "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "forbidden" });
      });

      it("toggle OFF: disabled even for a manager, from all three exports", async () => {
        expect(await getMonthCalendar(pManageOff, orgOff, { requestedTypeIds: [], now: MID_OCT })).toEqual({ kind: "disabled" });
        expect(await getMemberEvent(pManageOff, orgOff, evA.worship)).toEqual({ kind: "disabled" });
        expect(await listUpcomingMemberEvents(pManageOff, orgOff, { limit: 3, now: MID_OCT })).toEqual({ kind: "disabled" });
      });

      it("NO toggle row: disabled (a missing row is OFF, DECISION-097)", async () => {
        expect(await getMonthCalendar(V(orgNoToggle), orgNoToggle, { requestedTypeIds: [], now: MID_OCT })).toEqual({ kind: "disabled" });
      });

      it("the feature-categories axis ON with the worship category off: disabled", async () => {
        const [prior] = await fx.platform
          .select({ enabled: featureFlags.enabled })
          .from(featureFlags)
          .where(eq(featureFlags.key, AXIS_FLAG));
        await fx.platform
          .insert(featureFlags)
          .values({ key: AXIS_FLAG, enabled: true })
          .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: true } });
        await fx.platform
          .insert(organizationFeatureCategories)
          .values({ organizationId: orgA, category: "worship", enabled: false });
        try {
          expect(
            await getMonthCalendar(pView, orgA, { month: OCT, requestedTypeIds: [], now: MID_OCT }),
          ).toEqual({ kind: "disabled" });
          // With the axis flag OFF the category row has no effect.
          await fx.platform
            .update(featureFlags)
            .set({ enabled: false })
            .where(eq(featureFlags.key, AXIS_FLAG));
          const r = await getMonthCalendar(pView, orgA, { month: OCT, requestedTypeIds: [], now: MID_OCT });
          expect(r.kind).toBe("ok");
        } finally {
          await fx.platform
            .delete(organizationFeatureCategories)
            .where(eq(organizationFeatureCategories.organizationId, orgA));
          if (prior) {
            await fx.platform.update(featureFlags).set({ enabled: prior.enabled }).where(eq(featureFlags.key, AXIS_FLAG));
          } else {
            await fx.platform.delete(featureFlags).where(eq(featureFlags.key, AXIS_FLAG));
          }
        }
      });
    });

    // -----------------------------------------------------------------------
    describe("getMonthCalendar: what a member sees", () => {
      it("returns the whole visible grid range in (starts_at, id) order, as wall-clock text", async () => {
        const data = await monthA();
        const t = titles(data.entries);
        expect(t).toEqual([
          "B first day midnight",
          "B first day plus one second",
          "Sunday Worship",
          "Members Only Study",
          "Untyped Potluck",
          "Retired Type Concert",
          "Retreat",
          "B last minute",
        ]);
        const worship = data.entries.find((e) => e.title === "Sunday Worship")!;
        expect(worship.startsAtWallClock).toBe("2026-10-04T10:00");
        expect(worship.endsAtWallClock).toBe("2026-10-04T11:00");
        expect(worship.dayKey).toBe("2026-10-04");
        // Seconds are dropped by to_char to the minute.
        expect(data.entries.find((e) => e.title === "B last minute")!.startsAtWallClock).toBe("2026-10-31T23:59");
      });

      it("every entry has exactly the member-safe key set", async () => {
        const data = await monthA();
        for (const entry of data.entries) {
          expect(Object.keys(entry).sort()).toEqual([
            "dayKey",
            "endsAtWallClock",
            "eventType",
            "id",
            "isPublic",
            "location",
            "startsAtWallClock",
            "title",
          ]);
        }
      });

      it("month bounds are HALF-OPEN: last grid day 23:59:59 in, the day after 00:00:00 out; one second before the first day out, at it in", async () => {
        const oct = titles((await monthA()).entries);
        expect(oct).toContain("B last minute");
        expect(oct).toContain("B first day midnight");
        expect(oct).toContain("B first day plus one second");
        expect(oct).not.toContain("B day after midnight");
        expect(oct).not.toContain("B before first day");

        // The same boundary rows from the other side: the November grid starts on 2026-11-01.
        const nov = titles((await monthA([], { year: 2026, month: 11 })).entries);
        expect(nov).toContain("B day after midnight");
        expect(nov).not.toContain("B last minute");
      });

      it("excludes CANCELLED events and includes non-public ones (members see members-only)", async () => {
        const data = await monthA();
        const t = titles(data.entries);
        expect(t).not.toContain("Cancelled Picnic");
        const study = data.entries.find((e) => e.title === "Members Only Study")!;
        expect(study).toBeDefined();
        expect(study.isPublic).toBe(false);
      });

      it("a multi-day event is returned once, on its start day", async () => {
        const data = await monthA();
        const retreat = data.entries.filter((e) => e.title === "Retreat");
        expect(retreat).toHaveLength(1);
        expect(retreat[0].dayKey).toBe("2026-10-16");
        expect(retreat[0].endsAtWallClock).toBe("2026-10-18T12:00");
      });

      it("untyped events RESOLVE to the fallback type in SQL", async () => {
        const data = await monthA();
        const potluck = data.entries.find((e) => e.title === "Untyped Potluck")!;
        expect(potluck.eventType).toEqual({
          id: typeA.general,
          name: "General",
          colorToken: "neutral",
          iconKey: "CalendarDays",
        });
      });

      it("the pills are the ACTIVE types, fallback LAST; the retired type is not a pill", async () => {
        const data = await monthA();
        expect(data.types.map((t) => t.name)).toEqual(["Worship", "Study", "Youth", "General"]);
        expect(data.types.map((t) => t.id)).not.toContain(typeA.music);
        expect(data.types[0]).toEqual({
          id: typeA.worship,
          name: "Worship",
          colorToken: "teal",
          iconKey: "Church",
        });
      });

      it("a retired-type event appears under All, keeps its own type, and under no active filter", async () => {
        const all = await monthA();
        const concert = all.entries.find((e) => e.title === "Retired Type Concert")!;
        expect(concert.eventType?.name).toBe("Music");

        const worshipOnly = await monthA([typeA.worship]);
        expect(titles(worshipOnly.entries)).not.toContain("Retired Type Concert");
        const generalOnly = await monthA([typeA.general]);
        expect(titles(generalOnly.entries)).not.toContain("Retired Type Concert");

        // Asking for the retired type itself: it is not active, so the filter
        // drops it and collapses to All.
        const asked = await monthA([typeA.music]);
        expect(asked.activeTypeIds).toEqual([]);
        expect(titles(asked.entries)).toContain("Retired Type Concert");
      });
    });

    // -----------------------------------------------------------------------
    describe("getMonthCalendar: the type filter", () => {
      it("a subset filters entries and is reported as activeTypeIds", async () => {
        const data = await monthA([typeA.worship]);
        expect(data.activeTypeIds).toEqual([typeA.worship]);
        expect(titles(data.entries)).toEqual(["Sunday Worship"]);
      });

      it("the fallback filters untyped events as General", async () => {
        const data = await monthA([typeA.general]);
        expect(data.activeTypeIds).toEqual([typeA.general]);
        const t = titles(data.entries);
        expect(t).toContain("Untyped Potluck");
        expect(t).toContain("B last minute");
        expect(t).not.toContain("Sunday Worship");
      });

      it("a filter covering every ACTIVE type collapses to All (activeTypeIds [])", async () => {
        const data = await monthA([typeA.worship, typeA.study, typeA.youth, typeA.general]);
        expect(data.activeTypeIds).toEqual([]);
        expect(data.entries).toHaveLength(8);
      });

      it("another org's UUID-shaped id is dropped by the intersection, not merely hidden", async () => {
        const only = await monthA([typeBFallback]);
        expect(only.activeTypeIds).toEqual([]);
        expect(only.entries).toHaveLength(8); // as if no filter

        const mixed = await monthA([typeA.worship, typeBFallback]);
        expect(mixed.activeTypeIds).toEqual([typeA.worship]);
        expect(titles(mixed.entries)).toEqual(["Sunday Worship"]);
      });

      it("a random UUID that exists nowhere is ignored too", async () => {
        const data = await monthA(["11111111-2222-4333-8444-555555555555"]);
        expect(data.activeTypeIds).toEqual([]);
      });

      it("counts distinguish 'filters hide everything' from 'empty month'", async () => {
        const hidden = await monthA([typeA.youth]);
        expect(hidden.entries).toHaveLength(0);
        expect(hidden.inMonthCount).toBe(0);
        expect(hidden.unfilteredInMonthCount).toBeGreaterThan(0);
        expect(hidden.orgHasEvents).toBe(true);

        const all = await monthA();
        // In-month = October only (the grid's adjacent-month rows are not counted).
        expect(all.inMonthCount).toBe(6);
        expect(all.unfilteredInMonthCount).toBe(6);
      });

      it("an empty month in an org that has events: orgHasEvents true", async () => {
        const data = await monthA([], { year: 2000, month: 1 });
        expect(data.entries).toEqual([]);
        expect(data.inMonthCount).toBe(0);
        expect(data.unfilteredInMonthCount).toBe(0);
        expect(data.orgHasEvents).toBe(true);
      });

      it("an org with no events at all: orgHasEvents false", async () => {
        const r = await getMonthCalendar(V(orgEmpty), orgEmpty, { month: OCT, requestedTypeIds: [], now: MID_OCT });
        expect(r.kind).toBe("ok");
        if (r.kind !== "ok") return;
        expect(r.data.orgHasEvents).toBe(false);
        expect(r.data.entries).toEqual([]);
        expect(r.data.types).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    describe("getMonthCalendar: orgs without a full type set", () => {
      it("a zero-types org renders: eventType is null, types is []", async () => {
        const r = await getMonthCalendar(V(orgZ), orgZ, { month: OCT, requestedTypeIds: [], now: MID_OCT });
        expect(r.kind).toBe("ok");
        if (r.kind !== "ok") return;
        expect(r.data.types).toEqual([]);
        expect(r.data.entries).toHaveLength(1);
        expect(r.data.entries[0].eventType).toBeNull();
        // A filter has nothing to match against; it is All.
        const filtered = await getMonthCalendar(V(orgZ), orgZ, { month: OCT, requestedTypeIds: [typeA.worship], now: MID_OCT });
        expect(filtered.kind === "ok" && filtered.data.entries).toHaveLength(1);
      });

      it("a fallback-only org renders its untyped events as General", async () => {
        const r = await getMonthCalendar(V(orgN), orgN, {
          month: { year: 2026, month: 10 },
          requestedTypeIds: [],
          now: MID_OCT,
        });
        expect(r.kind).toBe("ok");
        if (r.kind !== "ok") return;
        expect(r.data.types.map((t) => t.name)).toEqual(["General"]);
        expect(r.data.entries[0].eventType?.name).toBe("General");
      });
    });

    // -----------------------------------------------------------------------
    describe("getMonthCalendar: 'today' and the default month follow the ORG's zone", () => {
      it("the same instant is a different day (and month) in different org zones", async () => {
        // 2026-11-01T09:59Z: Honolulu is Oct 31 23:59, New York is Nov 1 04:59.
        const now = new Date("2026-11-01T09:59:00Z");
        const honolulu = await getMonthCalendar(V(orgH), orgH, { requestedTypeIds: [], now });
        const newYork = await getMonthCalendar(pView, orgA, { requestedTypeIds: [], now });
        expect(honolulu.kind === "ok" && honolulu.data).toMatchObject({
          timeZone: "Pacific/Honolulu",
          todayKey: "2026-10-31",
          month: { year: 2026, month: 10 },
          isCurrentMonth: true,
        });
        expect(newYork.kind === "ok" && newYork.data).toMatchObject({
          timeZone: "America/New_York",
          todayKey: "2026-11-01",
          month: { year: 2026, month: 11 },
          isCurrentMonth: true,
        });
      });

      it("the month-end evening: UTC says November, the org says October", async () => {
        const r = await getMonthCalendar(pView, orgA, {
          requestedTypeIds: [],
          now: new Date("2026-11-01T03:30:00Z"),
        });
        expect(r.kind === "ok" && r.data).toMatchObject({
          todayKey: "2026-10-31",
          month: { year: 2026, month: 10 },
        });
      });

      it("an org with NO settings row uses the default zone (F132)", async () => {
        const r = await getMonthCalendar(V(orgN), orgN, {
          requestedTypeIds: [],
          now: new Date("2026-11-01T03:30:00Z"),
        });
        expect(r.kind === "ok" && r.data).toMatchObject({
          timeZone: "America/New_York",
          todayKey: "2026-10-31",
        });
      });

      it("an explicit month other than the current one is not 'current'", async () => {
        const r = await getMonthCalendar(pView, orgA, {
          month: { year: 2026, month: 9 },
          requestedTypeIds: [],
          now: MID_OCT,
        });
        expect(r.kind === "ok" && r.data.isCurrentMonth).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    describe("getMemberEvent", () => {
      it("returns the detail with EXACTLY the member-safe key set", async () => {
        const r = await getMemberEvent(pView, orgA, evA.worship);
        expect(r.kind).toBe("ok");
        if (r.kind !== "ok") return;
        expect(r.data.canManage).toBe(false);
        expect(r.data.event).not.toBeNull();
        expect(Object.keys(r.data.event!).sort()).toEqual([
          "description",
          "endsAtWallClock",
          "eventType",
          "id",
          "isSeriesOccurrence",
          "location",
          "startsAtWallClock",
          "title",
        ]);
        expect(r.data.event).toMatchObject({
          id: evA.worship,
          title: "Sunday Worship",
          startsAtWallClock: "2026-10-04T10:00",
          endsAtWallClock: "2026-10-04T11:00",
          isSeriesOccurrence: false,
        });
        expect(r.data.event!.eventType?.name).toBe("Worship");
      });

      it("a non-public event is visible; an untyped one carries the fallback", async () => {
        const study = await getMemberEvent(pView, orgA, evA.study);
        expect(study.kind === "ok" && study.data.event?.title).toBe("Members Only Study");
        const potluck = await getMemberEvent(pView, orgA, evA.potluck);
        expect(potluck.kind === "ok" && potluck.data.event?.eventType?.name).toBe("General");
      });

      it("a manager sees canManage true", async () => {
        const r = await getMemberEvent(pManage, orgA, evA.worship);
        expect(r.kind === "ok" && r.data.canManage).toBe(true);
      });

      it("isSeriesOccurrence is true for a series parent and for a child", async () => {
        const parent = await getMemberEvent(V(orgU), orgU, uSeriesParent);
        const child = await getMemberEvent(V(orgU), orgU, evU.choirNext);
        expect(parent.kind === "ok" && parent.data.event?.isSeriesOccurrence).toBe(true);
        expect(child.kind === "ok" && child.data.event?.isSeriesOccurrence).toBe(true);
      });

      it("event: null, AFTER the gate, for a garbage id, another org's id, a missing id, and a cancelled id", async () => {
        const nullEvent = { kind: "ok", data: { event: null, canManage: false } };
        expect(await getMemberEvent(pView, orgA, "not-a-uuid")).toEqual(nullEvent);
        expect(await getMemberEvent(pView, orgA, "' or 1=1 --")).toEqual(nullEvent);
        expect(await getMemberEvent(pView, orgA, evForeign)).toEqual(nullEvent);
        expect(await getMemberEvent(pView, orgA, "00000000-0000-4000-8000-000000000000")).toEqual(nullEvent);
        expect(await getMemberEvent(pView, orgA, evA.cancelled)).toEqual(nullEvent);
      });

      it("a member of another org cannot read this org's event through their own org", async () => {
        const r = await getMemberEvent(pOut, orgB, evA.worship);
        expect(r).toEqual({ kind: "ok", data: { event: null, canManage: false } });
      });
    });

    // -----------------------------------------------------------------------
    describe("listUpcomingMemberEvents", () => {
      // 2026-11-02T04:30Z is 23:30 on Nov 1 in New York (UTC says Nov 2).
      const EVENING_NOV_1 = new Date("2026-11-02T04:30:00Z");
      // One hour later: 00:30 on Nov 2 in New York.
      const AFTER_MIDNIGHT = new Date("2026-11-02T05:30:00Z");

      async function upcoming(now: Date, limit: number, org = orgU) {
        const r = await listUpcomingMemberEvents(V(org), org, { limit, now });
        if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
        return r.data;
      }

      it("is listed until its day ends: a 10:30 event is returned at 23:30 org time and gone at 00:30 the next org day", async () => {
        const evening = await upcoming(EVENING_NOV_1, 12);
        expect(titles(evening)).toContain("Morning Service");
        const next = await upcoming(AFTER_MIDNIGHT, 12);
        expect(titles(next)).not.toContain("Morning Service");
      });

      it("the lower bound is inclusive: an event at exactly 00:00 today is returned", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        expect(rows.find((r) => r.id === evU.midnight)?.startsAtWallClock).toBe("2026-11-01T00:00");
      });

      it("a series whose parent has passed still yields its NEXT child, once, keyed by the parent", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        const choir = rows.filter((r) => r.title === "Weekly Choir");
        expect(choir).toHaveLength(1);
        expect(choir[0].id).toBe(evU.choirNext);
        expect(choir[0].seriesKey).toBe(uSeriesParent);
        expect(choir[0].startsAtWallClock).toBe("2026-11-02T19:00");
      });

      it("a standalone event's seriesKey is its own id", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        const morning = rows.find((r) => r.title === "Morning Service")!;
        expect(morning.seriesKey).toBe(morning.id);
      });

      it("excludes cancelled and past events, includes non-public ones", async () => {
        const t = titles(await upcoming(EVENING_NOV_1, 12));
        expect(t).not.toContain("Cancelled Later");
        expect(t).not.toContain("Old Event");
        expect(t).toContain("Members Only Later");
      });

      it("is ordered by (starts_at, id)", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        const sorted = [...rows].sort((a, b) =>
          a.startsAtWallClock === b.startsAtWallClock
            ? a.id.localeCompare(b.id)
            : a.startsAtWallClock.localeCompare(b.startsAtWallClock),
        );
        expect(rows.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
        const ids = rows.map((r) => r.id);
        expect(ids.indexOf(uTie1)).toBeGreaterThan(-1);
        expect(ids.indexOf(uTie1)).toBeLessThan(ids.indexOf(uTie2));
      });

      it("limit clamps: 0 -> 1, -5 -> 1, NaN -> 1, 99 -> 12, 3 -> 3", async () => {
        expect(await upcoming(EVENING_NOV_1, 0)).toHaveLength(1);
        expect(await upcoming(EVENING_NOV_1, -5)).toHaveLength(1);
        expect(await upcoming(EVENING_NOV_1, Number.NaN)).toHaveLength(1);
        expect(await upcoming(EVENING_NOV_1, Number.POSITIVE_INFINITY)).toHaveLength(1);
        expect(await upcoming(EVENING_NOV_1, 99)).toHaveLength(12);
        expect(await upcoming(EVENING_NOV_1, 3)).toHaveLength(3);
      });

      it("returns exactly the documented key set, with the type resolved (fallback for untyped)", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual([
            "endsAtWallClock",
            "eventType",
            "id",
            "location",
            "seriesKey",
            "startsAtWallClock",
            "title",
          ]);
          expect(Object.keys(row.eventType!).sort()).toEqual(["colorToken", "iconKey", "name"]);
        }
        expect(rows.find((r) => r.title === "Morning Service")!.eventType).toEqual({
          name: "Worship",
          colorToken: "teal",
          iconKey: "Church",
        });
        expect(rows.find((r) => r.title === "Tie One")!.eventType).toEqual({
          name: "General",
          colorToken: "neutral",
          iconKey: "CalendarDays",
        });
      });

      it("the upcoming set is a SUBSET of the calendar's default set for each event's month", async () => {
        const rows = await upcoming(EVENING_NOV_1, 12);
        expect(rows.length).toBeGreaterThan(5);
        for (const row of rows) {
          const [y, m] = row.startsAtWallClock.slice(0, 7).split("-").map(Number);
          const cal = await getMonthCalendar(V(orgU), orgU, {
            month: { year: y, month: m },
            requestedTypeIds: [],
            now: EVENING_NOV_1,
          });
          expect(cal.kind).toBe("ok");
          if (cal.kind !== "ok") continue;
          expect(cal.data.entries.map((e) => e.id)).toContain(row.id);
        }
      });

      it("'today' is the ORG's day: a Honolulu event at 18:00 is still upcoming at 03:30Z, a New York 20:00 event is too, and at 04:30Z New York has rolled over", async () => {
        const at0330 = new Date("2026-11-01T03:30:00Z"); // NY Oct 31 23:30 / HNL Oct 31 17:30
        const at0430 = new Date("2026-11-01T04:30:00Z"); // NY Nov 1 00:30
        expect(titles(await upcoming(at0330, 5, orgH))).toContain("Honolulu Evening");
        expect(titles(await upcoming(at0330, 5, orgN))).toContain("NY Late");
        // New York (no settings row, default zone) has rolled to Nov 1: the Oct 31 event is gone.
        expect(titles(await upcoming(at0430, 5, orgN))).not.toContain("NY Late");
        // Honolulu is still Oct 31 (18:30 local).
        expect(titles(await upcoming(at0430, 5, orgH))).toContain("Honolulu Evening");
      });

      it("a zero-types org's events carry eventType null", async () => {
        const rows = await upcoming(new Date("2026-10-09T12:00:00Z"), 3, orgZ);
        expect(rows).toHaveLength(1);
        expect(rows[0].eventType).toBeNull();
      });
    });

    describe("isolation", () => {
      it("never returns another org's events from any export", async () => {
        const mine = await monthA();
        expect(mine.entries.map((e) => e.id)).not.toContain(evForeign);
        const rows = await listUpcomingMemberEvents(pView, orgA, { limit: 12, now: new Date("2026-01-01T12:00:00Z") });
        expect(rows.kind === "ok" && rows.data.map((r) => r.id)).not.toContain(evForeign);
      });
    });
  });

  it("fixture sanity: every fixture event belongs to a fixture org", async () => {
    const rows = await fx.platform
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.organizationId, [orgA, orgB, orgU]));
    expect(rows.length).toBeGreaterThan(20);
  });
});
