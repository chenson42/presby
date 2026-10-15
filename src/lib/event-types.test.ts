/**
 * Integration tests for src/lib/event-types.ts against a REAL Postgres
 * connection (the `events.test.ts` harness). Run for real with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/event-types.test.ts
 *
 * Also carries two proofs the schema pipeline owed this commit:
 *   - the 0054 backfill, re-executed against fixture orgs of ALL FIVE
 *     organization types, produces exactly `eventTypeSeedPlan(type)` and is
 *     idempotent;
 *   - A2: deleting an organization that owns typed events removes both
 *     `events` and `event_types` (the composite NO ACTION FK waits for the end
 *     of the cascade statement).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("event-types.ts (Postgres-backed, real dev database)", () => {
  let lib: typeof import("./event-types");
  let eventTypes: typeof import("@/lib/db/domain/events").eventTypes;
  let events: typeof import("@/lib/db/domain/events").events;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let eventTypeSeedPlan: typeof import("@/lib/events/type-seed-plan").eventTypeSeedPlan;
  let parseWallClock: typeof import("@/lib/events/wall-clock").parseWallClock;
  let fx: CalendarFixture;

  let orgX: string; // the main fixture: starts with no types
  let orgY: string; // a different tenant
  let manager: string; // event_types.manage only, orgX
  let eventsOnly: string; // events.manage only, orgX
  let managerY: string; // event_types.manage only, orgY
  let actor: string;

  beforeAll(async () => {
    lib = await import("./event-types");
    ({ eventTypes, events } = await import("@/lib/db/domain/events"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ eventTypeSeedPlan } = await import("@/lib/events/type-seed-plan"));
    ({ parseWallClock } = await import("@/lib/events/wall-clock"));
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("event-types-test");
    actor = fx.actingUserId;

    orgX = await fx.makeOrg("x", { calendarToggle: true });
    orgY = await fx.makeOrg("y", { calendarToggle: true });
    manager = await fx.makePerson("Isadora", "Penhallow");
    eventsOnly = await fx.makePerson("Cornelius", "Vane");
    managerY = await fx.makePerson("Rosalind", "Thackeray");
    await fx.enroll(orgX, manager, ["event_types.manage"]);
    await fx.enroll(orgX, eventsOnly, ["events.manage"]);
    await fx.enroll(orgY, managerY, ["event_types.manage"]);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  async function rowsOf(organizationId: string) {
    return fx.platform
      .select()
      .from(eventTypes)
      .where(eq(eventTypes.organizationId, organizationId))
      .orderBy(eventTypes.isFallback, eventTypes.sortOrder, eventTypes.name);
  }

  async function wipeTypes(organizationId: string) {
    await fx.platform.delete(events).where(eq(events.organizationId, organizationId));
    // The owner connection may delete event_types; presby_app/platform may not.
    await fx.platform.delete(eventTypes).where(eq(eventTypes.organizationId, organizationId));
  }

  async function ok<T>(p: Promise<{ kind: string; data?: T }>): Promise<T> {
    const r = await p;
    if (r.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r.data as T;
  }

  // -------------------------------------------------------------------------
  describe("permissions: event_types.manage ONLY", () => {
    it("events.manage alone is forbidden everywhere, and canManageEventTypes is false", async () => {
      const fakeId = "00000000-0000-4000-8000-000000000000";
      expect(await lib.canManageEventTypes(eventsOnly, orgX)).toBe(false);
      expect(await lib.listEventTypes(eventsOnly, orgX)).toEqual({ kind: "forbidden" });
      expect(
        await lib.createEventType(eventsOnly, orgX, actor, { name: "Nope", color: "teal", icon: "Church" }),
      ).toEqual({ kind: "forbidden" });
      expect(
        await lib.updateEventType(eventsOnly, orgX, actor, { id: fakeId, name: "Nope", color: "teal", icon: "Church" }),
      ).toEqual({ kind: "forbidden" });
      expect(await lib.setEventTypeActive(eventsOnly, orgX, actor, fakeId, false)).toEqual({ kind: "forbidden" });
      expect(await lib.moveEventType(eventsOnly, orgX, actor, fakeId, "up")).toEqual({ kind: "forbidden" });
      expect(await lib.seedStandardEventTypes(eventsOnly, orgX, actor)).toEqual({ kind: "forbidden" });
      expect(await rowsOf(orgX)).toEqual([]); // and NOTHING was written
    });

    it("event_types.manage grants the gate", async () => {
      expect(await lib.canManageEventTypes(manager, orgX)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("seedStandardEventTypes", () => {
    it("a congregation gets the standard nine, stamped with updated_by; a second call creates 0", async () => {
      await wipeTypes(orgX);
      const first = await ok(lib.seedStandardEventTypes(manager, orgX, actor));
      expect(first).toEqual({ created: 9 });
      const rows = await rowsOf(orgX);
      expect(rows).toHaveLength(9);
      expect(rows.filter((r) => r.isFallback)).toHaveLength(1);
      expect(rows.every((r) => r.updatedBy === actor)).toBe(true);
      expect(rows.map((r) => r.name).sort()).toEqual(
        eventTypeSeedPlan("congregation").map((t) => t.name).sort(),
      );

      expect(await ok(lib.seedStandardEventTypes(manager, orgX, actor))).toEqual({ created: 0 });
      expect(await rowsOf(orgX)).toHaveLength(9);
    });

    it("tops up only what is missing and never changes an existing row", async () => {
      await wipeTypes(orgX);
      const created = await ok(lib.createEventType(manager, orgX, actor, { name: "Worship", color: "rose", icon: "Mic" }));
      expect(await ok(lib.seedStandardEventTypes(manager, orgX, actor))).toEqual({ created: 8 });
      const [worship] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, created.id));
      expect(worship).toMatchObject({ name: "Worship", color: "rose", icon: "Mic" }); // the admin's own row
    });

    it("survives an existing fallback that is named differently (the partial unique index, not the name index)", async () => {
      await wipeTypes(orgX);
      await fx.platform.insert(eventTypes).values({
        organizationId: orgX, name: "Everything Else", color: "neutral", icon: "CalendarDays",
        sortOrder: 99, isActive: true, isFallback: true,
      });
      const r = await ok(lib.seedStandardEventTypes(manager, orgX, actor));
      expect(r.created).toBe(8); // the standard General conflicted on the fallback index and was skipped
      const rows = await rowsOf(orgX);
      expect(rows.filter((x) => x.isFallback).map((x) => x.name)).toEqual(["Everything Else"]);
    });

    it("a presbytery gets the fallback only", async () => {
      const presbytery = await fx.makeOrg("presb", { organizationType: "presbytery" });
      const person = await fx.makePerson("Evander", "Lisle");
      await fx.enroll(presbytery, person, ["event_types.manage"]);
      expect(await ok(lib.seedStandardEventTypes(person, presbytery, actor))).toEqual({ created: 1 });
      const rows = await rowsOf(presbytery);
      expect(rows.map((r) => [r.name, r.isFallback])).toEqual([["General", true]]);
    });
  });

  // -------------------------------------------------------------------------
  describe("createEventType", () => {
    it("validates before the database: name, color, icon, and the reserved neutral", async () => {
      await wipeTypes(orgX);
      const create = (over: Partial<{ name: string; color: string; icon: string }>) =>
        lib.createEventType(manager, orgX, actor, { name: "Valid", color: "teal", icon: "Church", ...over });

      expect(await create({ name: "" })).toMatchObject({ kind: "invalid_input", message: "Name is required." });
      expect(await create({ name: "   " })).toMatchObject({ kind: "invalid_input", message: "Name is required." });
      expect(await create({ name: "x".repeat(61) })).toMatchObject({
        kind: "invalid_input",
        message: "Name must be 60 characters or fewer.",
      });
      expect(await create({ color: "magenta" })).toMatchObject({ kind: "invalid_input", message: "Choose a color." });
      expect(await create({ color: "neutral" })).toMatchObject({ kind: "invalid_input", message: "Choose a color." });
      expect(await create({ icon: "Rocket" })).toMatchObject({ kind: "invalid_input", message: "Choose an icon." });
      expect(await rowsOf(orgX)).toEqual([]);
    });

    it("accepts a 60-character name, trims it, and appends at max(sort_order)+10 ignoring the fallback", async () => {
      await wipeTypes(orgX);
      await fx.platform.insert(eventTypes).values({
        organizationId: orgX, name: "General", color: "neutral", icon: "CalendarDays",
        sortOrder: 99, isActive: true, isFallback: true,
      });
      const a = await ok(lib.createEventType(manager, orgX, actor, { name: `  ${"a".repeat(60)}  `, color: "teal", icon: "Church" }));
      const b = await ok(lib.createEventType(manager, orgX, actor, { name: "Second", color: "sky", icon: "BookOpen" }));
      const c = await ok(lib.createEventType(manager, orgX, actor, { name: "Third", color: "lime", icon: "Backpack" }));
      const rows = await fx.platform.select().from(eventTypes).where(inArray(eventTypes.id, [a.id, b.id, c.id]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a.id)).toMatchObject({ name: "a".repeat(60), sortOrder: 10, isActive: true, isFallback: false, updatedBy: actor });
      expect(byId.get(b.id)!.sortOrder).toBe(20);
      expect(byId.get(c.id)!.sortOrder).toBe(30);
    });

    it("the first type in an empty org gets sort_order 10", async () => {
      await wipeTypes(orgX);
      const a = await ok(lib.createEventType(manager, orgX, actor, { name: "Only", color: "teal", icon: "Church" }));
      const [row] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, a.id));
      expect(row.sortOrder).toBe(10);
    });

    it("rejects a duplicate name case-insensitively, with the exact message, writing nothing", async () => {
      await wipeTypes(orgX);
      await ok(lib.createEventType(manager, orgX, actor, { name: "Worship", color: "teal", icon: "Church" }));
      const r = await lib.createEventType(manager, orgX, actor, { name: "  WORSHIP ", color: "sky", icon: "Mic" });
      expect(r).toEqual({ kind: "invalid_input", message: "You already have an event type called 'WORSHIP'." });
      expect(await rowsOf(orgX)).toHaveLength(1);
    });

    it("a RETIRED type still reserves its name", async () => {
      await wipeTypes(orgX);
      const w = await ok(lib.createEventType(manager, orgX, actor, { name: "Worship", color: "teal", icon: "Church" }));
      await ok(lib.setEventTypeActive(manager, orgX, actor, w.id, false));
      const r = await lib.createEventType(manager, orgX, actor, { name: "worship", color: "sky", icon: "Church" });
      expect(r).toMatchObject({ kind: "invalid_input", message: "You already have an event type called 'worship'." });
    });

    it("the same name in ANOTHER org is fine (the index is per organization)", async () => {
      await wipeTypes(orgX);
      await wipeTypes(orgY);
      await ok(lib.createEventType(manager, orgX, actor, { name: "Worship", color: "teal", icon: "Church" }));
      const r = await lib.createEventType(managerY, orgY, actor, { name: "Worship", color: "teal", icon: "Church" });
      expect(r.kind).toBe("ok");
    });

    it("a 23505 from the unique index (the race) maps to the SAME message, via the post-transaction catch", async () => {
      await wipeTypes(orgX);
      // Hold an UNCOMMITTED row with the contested name open on another connection.
      // createEventType's pre-check cannot see it; its INSERT then blocks on the
      // unique index, and fails with 23505 the moment the holder commits.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let holderInserted!: () => void;
      const inserted = new Promise<void>((resolve) => { holderInserted = resolve; });
      const holder = fx.platform.transaction(async (tx) => {
        await tx.insert(eventTypes).values({
          organizationId: orgX, name: "Raced", color: "rose", icon: "Church",
          sortOrder: 10, isActive: true, isFallback: false,
        });
        holderInserted();
        await gate;
      });
      await inserted;

      let settled = false;
      const racing = lib
        .createEventType(manager, orgX, actor, { name: "Raced", color: "sky", icon: "Church" })
        .finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(settled).toBe(false); // blocked on the index, not answered by the pre-check
      release();
      await holder;
      expect(await racing).toEqual({
        kind: "invalid_input",
        message: "You already have an event type called 'Raced'.",
      });
      expect(await rowsOf(orgX)).toHaveLength(1);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  describe("updateEventType", () => {
    async function withFallbackAndTwo() {
      await wipeTypes(orgX);
      const fb = await fx.platform
        .insert(eventTypes)
        .values({ organizationId: orgX, name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isActive: true, isFallback: true })
        .returning({ id: eventTypes.id });
      const a = await ok(lib.createEventType(manager, orgX, actor, { name: "Alpha", color: "teal", icon: "Church" }));
      const b = await ok(lib.createEventType(manager, orgX, actor, { name: "Beta", color: "sky", icon: "BookOpen" }));
      return { fallbackId: fb[0].id, a: a.id, b: b.id };
    }

    it("renames, recolours and re-icons, stamping updated_by", async () => {
      const { a } = await withFallbackAndTwo();
      await ok(lib.updateEventType(manager, orgX, actor, { id: a, name: "Alpha Prime", color: "rose", icon: "Music" }));
      const [row] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, a));
      expect(row).toMatchObject({ name: "Alpha Prime", color: "rose", icon: "Music", updatedBy: actor });
    });

    it("renaming a type to its own name in a different case is allowed (the pre-check excludes the row itself)", async () => {
      const { a } = await withFallbackAndTwo();
      const r = await lib.updateEventType(manager, orgX, actor, { id: a, name: "ALPHA", color: "teal", icon: "Church" });
      expect(r.kind).toBe("ok");
    });

    it("refuses another type's name with the exact message", async () => {
      const { a } = await withFallbackAndTwo();
      const r = await lib.updateEventType(manager, orgX, actor, { id: a, name: "beta", color: "teal", icon: "Church" });
      expect(r).toEqual({ kind: "invalid_input", message: "You already have an event type called 'beta'." });
    });

    it("the fallback keeps neutral (a different colour is refused) but its name and icon are editable", async () => {
      const { fallbackId } = await withFallbackAndTwo();
      expect(
        await lib.updateEventType(manager, orgX, actor, { id: fallbackId, name: "General", color: "teal", icon: "CalendarDays" }),
      ).toEqual({ kind: "invalid_input", message: "The default type keeps its neutral color." });
      const r = await lib.updateEventType(manager, orgX, actor, { id: fallbackId, name: "Everything else", color: "neutral", icon: "Users" });
      expect(r.kind).toBe("ok");
      const [row] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, fallbackId));
      expect(row).toMatchObject({ name: "Everything else", color: "neutral", icon: "Users", isFallback: true });
    });

    it("refuses neutral on an ordinary type", async () => {
      const { a } = await withFallbackAndTwo();
      expect(
        await lib.updateEventType(manager, orgX, actor, { id: a, name: "Alpha", color: "neutral", icon: "Church" }),
      ).toEqual({ kind: "invalid_input", message: "Choose a color." });
    });

    it("validates fields", async () => {
      const { a } = await withFallbackAndTwo();
      expect(await lib.updateEventType(manager, orgX, actor, { id: a, name: "", color: "teal", icon: "Church" })).toMatchObject({ kind: "invalid_input" });
      expect(await lib.updateEventType(manager, orgX, actor, { id: a, name: "ok", color: "pink", icon: "Church" })).toMatchObject({ kind: "invalid_input" });
      expect(await lib.updateEventType(manager, orgX, actor, { id: a, name: "ok", color: "teal", icon: "Rocket" })).toMatchObject({ kind: "invalid_input" });
    });

    it("invalid_target for a garbage id, a missing id, and ANOTHER org's id", async () => {
      await withFallbackAndTwo();
      await wipeTypes(orgY);
      const y = await ok(lib.createEventType(managerY, orgY, actor, { name: "Y type", color: "teal", icon: "Church" }));
      const input = { name: "x", color: "teal", icon: "Church" };
      expect(await lib.updateEventType(manager, orgX, actor, { ...input, id: "not-a-uuid" })).toEqual({ kind: "invalid_target" });
      expect(await lib.updateEventType(manager, orgX, actor, { ...input, id: "00000000-0000-4000-8000-000000000000" })).toEqual({ kind: "invalid_target" });
      expect(await lib.updateEventType(manager, orgX, actor, { ...input, id: y.id })).toEqual({ kind: "invalid_target" });
      const [untouched] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, y.id));
      expect(untouched.name).toBe("Y type");
    });
  });

  // -------------------------------------------------------------------------
  describe("setEventTypeActive", () => {
    it("retires and reactivates, and retiring touches NO event", async () => {
      await wipeTypes(orgX);
      const t = await ok(lib.createEventType(manager, orgX, actor, { name: "Worship", color: "teal", icon: "Church" }));
      const [ev] = await fx.platform
        .insert(events)
        .values({ organizationId: orgX, title: "Typed", startsAt: parseWallClock("2026-10-04T10:00"), eventTypeId: t.id })
        .returning({ id: events.id });

      await ok(lib.setEventTypeActive(manager, orgX, actor, t.id, false));
      const [retired] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, t.id));
      expect(retired.isActive).toBe(false);
      const [stillTyped] = await fx.platform.select({ typeId: events.eventTypeId }).from(events).where(eq(events.id, ev.id));
      expect(stillTyped.typeId).toBe(t.id);

      await ok(lib.setEventTypeActive(manager, orgX, actor, t.id, true));
      const [back] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, t.id));
      expect(back.isActive).toBe(true);
    });

    it("the fallback can't be retired (exact message); reactivating it is always fine", async () => {
      await wipeTypes(orgX);
      await ok(lib.seedStandardEventTypes(manager, orgX, actor));
      const [fb] = await fx.platform.select().from(eventTypes).where(and(eq(eventTypes.organizationId, orgX), eq(eventTypes.isFallback, true)));
      expect(await lib.setEventTypeActive(manager, orgX, actor, fb.id, false)).toEqual({
        kind: "invalid_input",
        message: "The default type can't be retired.",
      });
      expect((await lib.setEventTypeActive(manager, orgX, actor, fb.id, true)).kind).toBe("ok");
      const [still] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, fb.id));
      expect(still.isActive).toBe(true);
    });

    it("invalid_target for a garbage, missing, or another org's id", async () => {
      await wipeTypes(orgY);
      const y = await ok(lib.createEventType(managerY, orgY, actor, { name: "Y2", color: "teal", icon: "Church" }));
      expect(await lib.setEventTypeActive(manager, orgX, actor, "nope", false)).toEqual({ kind: "invalid_target" });
      expect(await lib.setEventTypeActive(manager, orgX, actor, y.id, false)).toEqual({ kind: "invalid_target" });
      const [row] = await fx.platform.select().from(eventTypes).where(eq(eventTypes.id, y.id));
      expect(row.isActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("moveEventType", () => {
    async function ordered() {
      const result = await lib.listEventTypes(manager, orgX);
      if (result.kind !== "ok") throw new Error("list failed");
      return result.data.map((r) => [r.name, r.sortOrder] as const);
    }

    async function seedFour() {
      await wipeTypes(orgX);
      await fx.platform.insert(eventTypes).values({
        organizationId: orgX, name: "General", color: "neutral", icon: "CalendarDays",
        sortOrder: 99, isActive: true, isFallback: true,
      });
      const ids: Record<string, string> = {};
      for (const [name, color] of [["A", "teal"], ["B", "sky"], ["C", "lime"], ["D", "rose"]] as const) {
        ids[name] = (await ok(lib.createEventType(manager, orgX, actor, { name, color, icon: "Church" }))).id;
      }
      return ids;
    }

    it("swaps with the neighbour and renumbers 10, 20, 30...; the fallback stays last at 99", async () => {
      const ids = await seedFour();
      await ok(lib.moveEventType(manager, orgX, actor, ids.C, "up"));
      expect(await ordered()).toEqual([["A", 10], ["C", 20], ["B", 30], ["D", 40], ["General", 99]]);
      await ok(lib.moveEventType(manager, orgX, actor, ids.A, "down"));
      expect(await ordered()).toEqual([["C", 10], ["A", 20], ["B", 30], ["D", 40], ["General", 99]]);
    });

    it("moving past either end is a no-op ok", async () => {
      const ids = await seedFour();
      expect((await lib.moveEventType(manager, orgX, actor, ids.A, "up")).kind).toBe("ok");
      expect((await lib.moveEventType(manager, orgX, actor, ids.D, "down")).kind).toBe("ok");
      expect(await ordered()).toEqual([["A", 10], ["B", 20], ["C", 30], ["D", 40], ["General", 99]]);
    });

    it("retired types take part in the order", async () => {
      const ids = await seedFour();
      await ok(lib.setEventTypeActive(manager, orgX, actor, ids.B, false));
      await ok(lib.moveEventType(manager, orgX, actor, ids.C, "up")); // swaps with retired B
      expect((await ordered()).map(([n]) => n)).toEqual(["A", "C", "B", "D", "General"]);
    });

    it("the fallback is never moved", async () => {
      await seedFour();
      const [fb] = await fx.platform.select().from(eventTypes).where(and(eq(eventTypes.organizationId, orgX), eq(eventTypes.isFallback, true)));
      expect(await lib.moveEventType(manager, orgX, actor, fb.id, "up")).toMatchObject({ kind: "invalid_input" });
      expect(await lib.moveEventType(manager, orgX, actor, fb.id, "down")).toMatchObject({ kind: "invalid_input" });
      expect((await ordered()).at(-1)).toEqual(["General", 99]);
    });

    it("repairs a gappy / duplicated order into 10, 20, 30...", async () => {
      const ids = await seedFour();
      await fx.platform.update(eventTypes).set({ sortOrder: 5 }).where(eq(eventTypes.id, ids.A));
      await fx.platform.update(eventTypes).set({ sortOrder: 5 }).where(eq(eventTypes.id, ids.B));
      await ok(lib.moveEventType(manager, orgX, actor, ids.D, "up"));
      const sortOrders = (await ordered()).filter(([n]) => n !== "General").map(([, s]) => s);
      expect(sortOrders).toEqual([10, 20, 30, 40]);
    });

    it("invalid_target for a garbage or another org's id", async () => {
      await seedFour();
      await wipeTypes(orgY);
      const y = await ok(lib.createEventType(managerY, orgY, actor, { name: "Y3", color: "teal", icon: "Church" }));
      expect(await lib.moveEventType(manager, orgX, actor, "x", "up")).toEqual({ kind: "invalid_target" });
      expect(await lib.moveEventType(manager, orgX, actor, y.id, "up")).toEqual({ kind: "invalid_target" });
    });
  });

  // -------------------------------------------------------------------------
  describe("listEventTypes", () => {
    it("lists ALL rows (retired included), fallback LAST, with usage counts that include cancelled events", async () => {
      await wipeTypes(orgX);
      await ok(lib.seedStandardEventTypes(manager, orgX, actor));
      const rows0 = await ok(lib.listEventTypes(manager, orgX));
      expect(rows0).toHaveLength(9);
      expect(rows0.at(-1)).toMatchObject({ name: "General", isFallback: true, usageCount: 0 });
      expect(rows0.filter((r) => !r.isActive).length).toBe(4);

      const worship = rows0.find((r) => r.name === "Worship")!;
      await fx.platform.insert(events).values([
        { organizationId: orgX, title: "One", startsAt: parseWallClock("2026-10-04T10:00"), eventTypeId: worship.id },
        { organizationId: orgX, title: "Two", startsAt: parseWallClock("2026-10-11T10:00"), eventTypeId: worship.id, cancelledAt: new Date() },
      ]);
      const rows1 = await ok(lib.listEventTypes(manager, orgX));
      expect(rows1.find((r) => r.name === "Worship")!.usageCount).toBe(2);
      expect(rows1.find((r) => r.name === "Music")!.usageCount).toBe(0);
      expect(Object.keys(rows1[0]).sort()).toEqual(["color", "icon", "id", "isActive", "isFallback", "name", "sortOrder", "usageCount"]);
    });

    it("an org with no types lists []", async () => {
      await wipeTypes(orgX);
      expect(await ok(lib.listEventTypes(manager, orgX))).toEqual([]);
    });

    it("never lists another org's types", async () => {
      await wipeTypes(orgY);
      await ok(lib.createEventType(managerY, orgY, actor, { name: "Y only", color: "teal", icon: "Church" }));
      const mine = await ok(lib.listEventTypes(manager, orgX));
      expect(mine.map((r) => r.name)).not.toContain("Y only");
    });
  });

  // -------------------------------------------------------------------------
  describe("migration 0054 backfill, re-executed against fixture orgs of every type", () => {
    const MIGRATION = readFileSync(
      path.resolve(__dirname, "../../drizzle/0054_presby_calendar_event_types.sql"),
      "utf8",
    );
    const BLOCK = MIGRATION.split("-- BEGIN backfill-event-types")[1]?.split(
      "-- END backfill-event-types",
    )[0];

    it("the marked block exists", () => {
      expect(BLOCK).toBeTruthy();
      expect(BLOCK).toContain("where not exists (select 1 from event_types et where et.organization_id = o.id)");
    });

    it("produces exactly eventTypeSeedPlan(type) for all five organization types, and is idempotent", async () => {
      const types = ["congregation", "new_worshiping_community", "presbytery", "synod", "general_assembly"] as const;
      const orgs = new Map<(typeof types)[number], string>();
      for (const t of types) {
        orgs.set(t, await fx.makeOrg(`bf-${t.replace(/_/g, "")}`, { organizationType: t }));
      }
      const ids = [...orgs.values()];

      // Scope the whole-database block to the fixture orgs only.
      const scoped = BLOCK!.replace(
        "where not exists",
        `where o.id in (${ids.map((id) => `'${id}'::uuid`).join(", ")}) and not exists`,
      );
      expect(scoped).not.toBe(BLOCK);

      const run = () => fx.platform.execute(sql.raw(scoped));
      await run();

      for (const [type, id] of orgs) {
        const rows = await fx.platform
          .select({
            name: eventTypes.name, color: eventTypes.color, icon: eventTypes.icon,
            sortOrder: eventTypes.sortOrder, isActive: eventTypes.isActive, isFallback: eventTypes.isFallback,
          })
          .from(eventTypes)
          .where(eq(eventTypes.organizationId, id))
          .orderBy(eventTypes.sortOrder);
        expect(rows, type).toEqual(
          eventTypeSeedPlan(type).map((t) => ({
            name: t.name, color: t.color, icon: t.icon,
            sortOrder: t.sortOrder, isActive: t.isActive, isFallback: t.isFallback,
          })),
        );
        expect(rows.length).toBe(type === "congregation" || type === "new_worshiping_community" ? 9 : 1);
      }

      const countBefore = (await fx.platform.select({ id: eventTypes.id }).from(eventTypes).where(inArray(eventTypes.organizationId, ids))).length;
      await run();
      const countAfter = (await fx.platform.select({ id: eventTypes.id }).from(eventTypes).where(inArray(eventTypes.organizationId, ids))).length;
      expect(countAfter).toBe(countBefore);
      expect(countBefore).toBe(9 + 9 + 1 + 1 + 1);
    });
  });

  // -------------------------------------------------------------------------
  describe("A2: deleting an organization that owns typed events", () => {
    it("removes the events AND the event types (the composite NO ACTION FK waits for the end of the cascade)", async () => {
      const doomed = await fx.makeOrg("doomed");
      const [t] = await fx.platform
        .insert(eventTypes)
        .values({ organizationId: doomed, name: "Worship", color: "teal", icon: "Church", sortOrder: 10 })
        .returning({ id: eventTypes.id });
      await fx.platform.insert(eventTypes).values({
        organizationId: doomed, name: "General", color: "neutral", icon: "CalendarDays",
        sortOrder: 99, isFallback: true,
      });
      await fx.platform.insert(events).values([
        { organizationId: doomed, title: "Typed A", startsAt: parseWallClock("2026-10-04T10:00"), eventTypeId: t.id },
        { organizationId: doomed, title: "Typed B", startsAt: parseWallClock("2026-10-11T10:00"), eventTypeId: t.id },
      ]);
      // The fixture window is open (deletable_until), so the owner may delete it.
      await fx.platform.update(organizations).set({ deletableUntil: fixtureDeletableUntil() }).where(eq(organizations.id, doomed));
      await fx.platform.delete(organizations).where(eq(organizations.id, doomed));

      expect(await fx.platform.select({ id: events.id }).from(events).where(eq(events.organizationId, doomed))).toEqual([]);
      expect(await fx.platform.select({ id: eventTypes.id }).from(eventTypes).where(eq(eventTypes.organizationId, doomed))).toEqual([]);
    });
  });
});
