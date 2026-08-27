/**
 * Integration tests for src/lib/events.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/groups.test.ts`'s exact harness:
 * the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./events` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file.
 *
 * INCLUDES THE MANDATORY TRIGGER-DISABLE TEARDOWN WRAP even though this
 * module never touches `groups`/`group_memberships` directly: every fixture
 * `memberships` insert below fires `presby_sync_derived_membership_group()`
 * (drizzle/0017), which materializes a row in this org's derived "Active
 * Membership" `group_memberships` group — the same real, still-open derived
 * row `groups.test.ts`/`officers.test.ts`/`children.test.ts` already
 * document. Deleting the fixture organizations at teardown cascades through
 * those rows, which `presby_reject_derived_group_write()` correctly refuses
 * to let any connection delete by cascade — the trigger must be disabled for
 * the duration of the teardown delete, same as those three files.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/events.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("events.ts (Postgres-backed, real dev database)", () => {
  let listEvents: typeof import("./events").listEvents;
  let getEvent: typeof import("./events").getEvent;
  let createEvent: typeof import("./events").createEvent;
  let updateEvent: typeof import("./events").updateEvent;
  let extendSeriesPattern: typeof import("./events").extendSeriesPattern;
  let cancelEvent: typeof import("./events").cancelEvent;

  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;

  const stamp = Date.now();

  let orgA: string;
  let orgB: string;

  let managerPerson: string; // orgA — holds events.manage
  let grantlessPerson: string; // orgA — holds nothing
  let outsidePerson: string; // orgB only — cross-org invalid_target

  let actingUserId: string;

  beforeAll(async () => {
    ({ listEvents, getEvent, createEvent, updateEvent, extendSeriesPattern, cancelEvent } =
      await import("./events"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for events.test.ts`,
          slug: `events-test-${label.toLowerCase()}-${stamp}`,
          path: `events_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    // Every `memberships` insert below fires `presby_sync_derived_membership_
    // group()` (drizzle/0017), which requires a derived "Active Membership"
    // group to already exist at the org — same fixture step
    // groups.test.ts/children.test.ts/officers.test.ts already need for the
    // identical reason (see this file's own header).
    const [gt] = await platform
      .insert(groupTypes)
      .values({ organizationId: null, key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let rosterTypeId = gt?.id;
    if (!rosterTypeId) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      rosterTypeId = existing!.id;
    }
    async function activeMembershipGroup(organizationId: string) {
      await platform.insert(groups).values({
        organizationId,
        groupTypeId: rosterTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }
    await activeMembershipGroup(orgA);
    await activeMembershipGroup(orgB);

    await platform
      .insert(permissions)
      .values({
        key: "events.manage",
        module: "events",
        description: "Create, edit, and cancel calendar events, including repeating series",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `events-test-actor-${stamp}@example.invalid`,
        name: "Events Test Actor",
      })
      .returning({ id: users.id });
    actingUserId = userRow!.id;

    const [roleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "events_admin_test",
        name: "Events Admin (test)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: roleRow!.id, permissionKey: "events.manage" });

    // A SECOND holder, at orgB, so the isolation tests below exercise a
    // genuine cross-org invalid_target (withOrgContext succeeds — this
    // viewer has a real, active membership at orgB — but the target event's
    // own organizationId is orgA) rather than an unrelated OrgAccessError
    // from calling with a person who has no membership at orgB at all.
    const [roleRowB] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgB,
        key: "events_admin_test_b",
        name: "Events Admin (test, org B)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: roleRowB!.id, permissionKey: "events.manage" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }
    managerPerson = await person("Wilhelmina", "Ashgrove");
    grantlessPerson = await person("Barnabas", "Croft");
    outsidePerson = await person("Ottilie", "Marsh");

    async function membership(organizationId: string, personId: string) {
      await platform.insert(memberships).values({
        organizationId,
        personId,
        engagementStatus: "regular",
        currentRoll: "active",
      });
    }
    await membership(orgA, managerPerson);
    await membership(orgA, grantlessPerson);
    await membership(orgB, outsidePerson);

    await platform.insert(roleGrants).values([
      {
        organizationId: orgA,
        roleId: roleRow!.id,
        personId: managerPerson,
        startsOn: "2020-01-01",
        grantedBy: actingUserId,
      },
      {
        organizationId: orgB,
        roleId: roleRowB!.id,
        personId: outsidePerson,
        startsOn: "2020-01-01",
        grantedBy: actingUserId,
      },
    ]);
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    // Same trigger-disable teardown convention as groups.test.ts/
    // officers.test.ts/children.test.ts — see this file's own header.
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    for (const id of [managerPerson, grantlessPerson, outsidePerson]) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, actingUserId));
  });

  // ---------------------------------------------------------------------
  // Permission gate
  // ---------------------------------------------------------------------

  describe("permission gate — events.manage checked before any read or write", () => {
    it("listEvents: forbidden for a person holding no events.manage", async () => {
      const result = await listEvents(grantlessPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getEvent: forbidden for a person holding no events.manage", async () => {
      const result = await getEvent(grantlessPerson, orgA, "00000000-0000-0000-0000-000000000000");
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("createEvent: forbidden for a person holding no events.manage, AND NOTHING IS WRITTEN", async () => {
      const before = await listEvents(managerPerson, orgA);
      const result = await createEvent(grantlessPerson, orgA, actingUserId, {
        title: "Should never be created",
        startsAt: "2027-01-01T10:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result).toEqual({ kind: "forbidden" });
      const after = await listEvents(managerPerson, orgA);
      expect(after.kind).toBe("ok");
      expect((after as { data: unknown[] }).data.length).toEqual(
        (before as { data: unknown[] }).data.length,
      );
    });

    it("cancelEvent: forbidden for a person holding no events.manage", async () => {
      const result = await cancelEvent(
        grantlessPerson,
        orgA,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // ---------------------------------------------------------------------
  // createEvent — single event
  // ---------------------------------------------------------------------

  describe("createEvent — a single, non-recurring event", () => {
    it("creates one row and it is readable via getEvent", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Session meeting",
        description: "Stated meeting",
        location: "Fellowship hall",
        startsAt: "2027-03-01T19:00",
        endsAt: "2027-03-01T20:30",
        isPublic: false,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.occurrenceIds).toEqual([result.data.eventId]);

      const detail = await getEvent(managerPerson, orgA, result.data.eventId);
      expect(detail.kind).toBe("ok");
      if (detail.kind !== "ok") return;
      expect(detail.data.title).toBe("Session meeting");
      expect(detail.data.startsAt).toBe("2027-03-01T19:00:00");
      expect(detail.data.endsAt).toBe("2027-03-01T20:30:00");
      expect(detail.data.isPublic).toBe(false);
      expect(detail.data.isRecurringSeries).toBe(false);
      expect(detail.data.isSeriesOccurrence).toBe(false);
      expect(detail.data.cancelledAt).toBeNull();
      expect(detail.data.seriesOccurrences).toEqual([]);
    });

    it("rejects an end time before the start time", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Bad times",
        startsAt: "2027-03-01T19:00",
        endsAt: "2027-03-01T18:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("rejects a title over 200 characters", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "x".repeat(201),
        startsAt: "2027-03-01T19:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("rejects an empty title", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "   ",
        startsAt: "2027-03-01T19:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });
  });

  // ---------------------------------------------------------------------
  // createEvent — recurring series + the 52-occurrence cap at CREATION
  // ---------------------------------------------------------------------

  describe("createEvent — a repeating series", () => {
    it("generates count discrete rows sharing parentEventId, pattern/count on the parent ONLY", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Choir practice",
        startsAt: "2027-04-01T18:00",
        endsAt: "2027-04-01T19:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 4 },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.occurrenceIds).toHaveLength(4);

      const parentDetail = await getEvent(managerPerson, orgA, result.data.eventId);
      expect(parentDetail.kind).toBe("ok");
      if (parentDetail.kind !== "ok") return;
      expect(parentDetail.data.recurrencePattern).toBe("weekly");
      expect(parentDetail.data.recurrenceCount).toBe(4);
      expect(parentDetail.data.isRecurringSeries).toBe(true);
      expect(parentDetail.data.seriesOccurrences).toHaveLength(3);

      const childId = result.data.occurrenceIds[1];
      const childDetail = await getEvent(managerPerson, orgA, childId);
      expect(childDetail.kind).toBe("ok");
      if (childDetail.kind !== "ok") return;
      expect(childDetail.data.recurrencePattern).toBeNull();
      expect(childDetail.data.recurrenceCount).toBeNull();
      expect(childDetail.data.isSeriesOccurrence).toBe(true);
      expect(childDetail.data.startsAt).toBe("2027-04-08T18:00:00");
      expect(childDetail.data.endsAt).toBe("2027-04-08T19:00:00");
      // The parent and the other 2 siblings, excluding itself.
      expect(childDetail.data.seriesOccurrences).toHaveLength(3);
      expect(
        childDetail.data.seriesOccurrences.some((s) => s.eventId === childId),
      ).toBe(false);
    });

    it("rejects an invalid recurrence pattern, writing nothing", async () => {
      const before = await listEvents(managerPerson, orgA);
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Bad pattern",
        startsAt: "2027-05-01T10:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "fortnightly", count: 3 },
      });
      expect(result.kind).toBe("invalid_input");
      const after = await listEvents(managerPerson, orgA);
      expect((after as { data: unknown[] }).data.length).toEqual(
        (before as { data: unknown[] }).data.length,
      );
    });

    it("accepts a creation count of exactly 52 (the cap)", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Max series",
        startsAt: "2027-06-01T09:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 52 },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.occurrenceIds).toHaveLength(52);
    });

    it("rejects a creation count of 53 — the 52-occurrence series-total cap (DECISION-115)", async () => {
      const result = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Over the cap",
        startsAt: "2027-07-01T09:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 53 },
      });
      expect(result.kind).toBe("invalid_input");
    });
  });

  // ---------------------------------------------------------------------
  // getEvent — enumeration / cross-org isolation
  // ---------------------------------------------------------------------

  describe("getEvent — isolation and enumeration safety", () => {
    it("invalid_target for a nonexistent id", async () => {
      const result = await getEvent(
        managerPerson,
        orgA,
        "11111111-1111-1111-1111-111111111111",
      );
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for an id that belongs to a different org", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Alder Creek only",
        startsAt: "2027-08-01T09:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      // outsidePerson holds events.manage AT ORG B (a real, active
      // membership there, so withOrgContext succeeds) — reading orgA's
      // event id through orgB's own context proves the row is invisible
      // outside its own org, indistinguishable from a nonexistent id.
      const result = await getEvent(outsidePerson, orgB, created.data.eventId);
      expect(result).toEqual({ kind: "invalid_target" });
    });
  });

  // ---------------------------------------------------------------------
  // updateEvent
  // ---------------------------------------------------------------------

  describe("updateEvent — edits ONE occurrence, never the recurrence fields", () => {
    it("edits title/location and leaves recurrencePattern/recurrenceCount untouched on a parent", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Bible study",
        startsAt: "2027-09-01T18:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 3 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const updated = await updateEvent(managerPerson, orgA, {
        eventId: created.data.eventId,
        title: "Bible study (updated)",
        location: "Room 4",
        startsAt: "2027-09-01T18:30",
        isPublic: false,
        allowsCheckin: true,
      });
      expect(updated).toEqual({ kind: "ok", data: { eventId: created.data.eventId } });

      const detail = await getEvent(managerPerson, orgA, created.data.eventId);
      expect(detail.kind).toBe("ok");
      if (detail.kind !== "ok") return;
      expect(detail.data.title).toBe("Bible study (updated)");
      expect(detail.data.location).toBe("Room 4");
      expect(detail.data.startsAt).toBe("2027-09-01T18:30:00");
      expect(detail.data.isPublic).toBe(false);
      expect(detail.data.allowsCheckin).toBe(true);
      // Untouched — updateEvent is not extendSeriesPattern.
      expect(detail.data.recurrencePattern).toBe("weekly");
      expect(detail.data.recurrenceCount).toBe(3);
    });

    it("invalid_target for a nonexistent id", async () => {
      const result = await updateEvent(managerPerson, orgA, {
        eventId: "22222222-2222-2222-2222-222222222222",
        title: "Nope",
        startsAt: "2027-09-01T18:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for an already-cancelled occurrence", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "To be cancelled",
        startsAt: "2027-09-10T09:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      await cancelEvent(managerPerson, orgA, created.data.eventId);

      const result = await updateEvent(managerPerson, orgA, {
        eventId: created.data.eventId,
        title: "Should not apply",
        startsAt: "2027-09-10T09:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("rejects an end time before the start time", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Time check",
        startsAt: "2027-09-15T09:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await updateEvent(managerPerson, orgA, {
        eventId: created.data.eventId,
        title: "Time check",
        startsAt: "2027-09-15T09:00",
        endsAt: "2027-09-15T08:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });
  });

  // ---------------------------------------------------------------------
  // extendSeriesPattern — extend/regenerate the horizon, the 52-cap on
  // EXTENSION (counted against the series TOTAL, not per-call)
  // ---------------------------------------------------------------------

  describe("extendSeriesPattern", () => {
    it("generates additionalCount rows forward from the series' latest occurrence, and updates the parent's own pattern/count", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Youth group",
        startsAt: "2027-10-01T18:00",
        endsAt: "2027-10-01T19:00",
        isPublic: true,
        allowsCheckin: true,
        recurrence: { pattern: "weekly", count: 3 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const extended = await extendSeriesPattern(managerPerson, orgA, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 2,
      });
      expect(extended.kind).toBe("ok");
      if (extended.kind !== "ok") return;
      expect(extended.data.occurrenceIds).toHaveLength(2);

      const parentDetail = await getEvent(managerPerson, orgA, created.data.eventId);
      expect(parentDetail.kind).toBe("ok");
      if (parentDetail.kind !== "ok") return;
      expect(parentDetail.data.recurrenceCount).toBe(5);
      expect(parentDetail.data.seriesOccurrences).toHaveLength(4);

      // The series' last occurrence continues forward from the PREVIOUS
      // latest occurrence (2027-10-15, the 3rd weekly date), not from the
      // parent's own start date.
      const lastChildDetail = await getEvent(
        managerPerson,
        orgA,
        extended.data.occurrenceIds[1],
      );
      expect(lastChildDetail.kind).toBe("ok");
      if (lastChildDetail.kind !== "ok") return;
      expect(lastChildDetail.data.startsAt).toBe("2027-10-29T18:00:00");
      expect(lastChildDetail.data.endsAt).toBe("2027-10-29T19:00:00");
    });

    it("invalid_target when the id is not a series parent (a standalone event)", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Not a series",
        startsAt: "2027-11-01T09:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target when the id is a CHILD occurrence, not the parent", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Series for child guard",
        startsAt: "2027-11-05T09:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, {
        parentEventId: created.data.occurrenceIds[1],
        pattern: "weekly",
        additionalCount: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("rejects an extension that would push the series TOTAL past 52", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Near the cap",
        startsAt: "2027-12-01T09:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 50 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 3,
      });
      expect(result.kind).toBe("invalid_input");

      // Nothing was written — the series is still exactly 50 occurrences.
      const parentDetail = await getEvent(managerPerson, orgA, created.data.eventId);
      expect(parentDetail.kind).toBe("ok");
      if (parentDetail.kind !== "ok") return;
      expect(parentDetail.data.recurrenceCount).toBe(50);
    });

    it("invalid_target for a parent id belonging to a different org", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Cross-org series",
        startsAt: "2028-01-01T09:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(outsidePerson, orgB, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });
  });

  // ---------------------------------------------------------------------
  // cancelEvent
  // ---------------------------------------------------------------------

  describe("cancelEvent — soft-cancel only, idempotent, never cascades", () => {
    it("sets cancelledAt and the event still appears in listEvents (visibly marked, not removed)", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Rained out picnic",
        startsAt: "2027-06-15T12:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const cancelled = await cancelEvent(managerPerson, orgA, created.data.eventId);
      expect(cancelled).toEqual({ kind: "ok", data: { eventId: created.data.eventId } });

      const detail = await getEvent(managerPerson, orgA, created.data.eventId);
      expect(detail.kind).toBe("ok");
      if (detail.kind !== "ok") return;
      expect(detail.data.cancelledAt).not.toBeNull();

      const list = await listEvents(managerPerson, orgA);
      expect(list.kind).toBe("ok");
      if (list.kind !== "ok") return;
      expect(list.data.some((e) => e.eventId === created.data.eventId)).toBe(true);
    });

    it("is idempotent — cancelling an already-cancelled event returns ok, not an error", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Double cancel",
        startsAt: "2027-06-20T12:00",
        isPublic: true,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      await cancelEvent(managerPerson, orgA, created.data.eventId);
      const second = await cancelEvent(managerPerson, orgA, created.data.eventId);
      expect(second).toEqual({ kind: "ok", data: { eventId: created.data.eventId } });
    });

    it("does not cascade to a series' children", async () => {
      const created = await createEvent(managerPerson, orgA, actingUserId, {
        title: "Cancel-parent-only series",
        startsAt: "2027-06-25T12:00",
        isPublic: true,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      await cancelEvent(managerPerson, orgA, created.data.eventId);

      const childDetail = await getEvent(
        managerPerson,
        orgA,
        created.data.occurrenceIds[1],
      );
      expect(childDetail.kind).toBe("ok");
      if (childDetail.kind !== "ok") return;
      expect(childDetail.data.cancelledAt).toBeNull();
    });

    it("invalid_target for a nonexistent id", async () => {
      const result = await cancelEvent(
        managerPerson,
        orgA,
        "33333333-3333-3333-3333-333333333333",
      );
      expect(result).toEqual({ kind: "invalid_target" });
    });
  });

  // ---------------------------------------------------------------------
  // listEvents ordering
  // ---------------------------------------------------------------------

  describe("listEvents", () => {
    it("orders by startsAt ascending", async () => {
      const result = await listEvents(managerPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const starts = result.data.map((e) => e.startsAt);
      const sorted = [...starts].sort();
      expect(starts).toEqual(sorted);
    });
  });
});
