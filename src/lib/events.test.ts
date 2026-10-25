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
import { eq, inArray, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { useProcessTimeZone } from "@/lib/testing/time-zone";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
// environment cannot resolve - so it is mocked at the module boundary, keeping
// only the two keys this module writes. The audit ROWS are written by the REAL
// `insertAuditRow()` (`@/lib/audit-tx`) in the same transaction as the change
// (DECISION-240); this wrapper only lets a test force that insert to throw, to
// prove the change rolls back with it.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    EVENT_LISTED_ON_WEBSITE: "event.listed_on_website",
    EVENT_UNLISTED_FROM_WEBSITE: "event.unlisted_from_website",
  },
}));
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

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
  let setSeriesWebsiteListing: typeof import("./events").setSeriesWebsiteListing;
  let getEventTypePickerData: typeof import("./events").getEventTypePickerData;
  let eventTypes: typeof import("@/lib/db/domain/events").eventTypes;

  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let events: typeof import("@/lib/db/domain/events").events;
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
  let actor: import("./events").EventActor;

  beforeAll(async () => {
    ({
      listEvents,
      getEvent,
      createEvent,
      updateEvent,
      extendSeriesPattern,
      cancelEvent,
      setSeriesWebsiteListing,
      getEventTypePickerData,
    } = await import("./events"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ events, eventTypes } = await import("@/lib/db/domain/events"));
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
          // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
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
      .values({ key: "roster", name: "Roster" })
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
    actor = { userId: actingUserId, email: `events-test-actor-${stamp}@example.invalid` };

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
        .values({
          firstName: first,
          lastName: last,
          deletableUntil: fixtureDeletableUntil(),
        })
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
      const result = await createEvent(grantlessPerson, orgA, actor, {
        title: "Should never be created",
        startsAt: "2027-01-01T10:00",
        isPublic: true,
        websiteListed: false,
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
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Session meeting",
        description: "Stated meeting",
        location: "Fellowship hall",
        startsAt: "2027-03-01T19:00",
        endsAt: "2027-03-01T20:30",
        isPublic: false,
        websiteListed: false,
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
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Bad times",
        startsAt: "2027-03-01T19:00",
        endsAt: "2027-03-01T18:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("rejects a title over 200 characters", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "x".repeat(201),
        startsAt: "2027-03-01T19:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("rejects an empty title", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "   ",
        startsAt: "2027-03-01T19:00",
        isPublic: true,
        websiteListed: false,
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
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Choir practice",
        startsAt: "2027-04-01T18:00",
        endsAt: "2027-04-01T19:00",
        isPublic: true,
        websiteListed: false,
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
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Bad pattern",
        startsAt: "2027-05-01T10:00",
        isPublic: true,
        websiteListed: false,
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
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Max series",
        startsAt: "2027-06-01T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 52 },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.occurrenceIds).toHaveLength(52);
    });

    it("rejects a creation count of 53 — the 52-occurrence series-total cap (DECISION-115)", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Over the cap",
        startsAt: "2027-07-01T09:00",
        isPublic: true,
        websiteListed: false,
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Alder Creek only",
        startsAt: "2027-08-01T09:00",
        isPublic: true,
        websiteListed: false,
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Bible study",
        startsAt: "2027-09-01T18:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 3 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const updated = await updateEvent(managerPerson, orgA, actor, {
        eventId: created.data.eventId,
        title: "Bible study (updated)",
        location: "Room 4",
        startsAt: "2027-09-01T18:30",
        isPublic: false,
        websiteListed: false,
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
      const result = await updateEvent(managerPerson, orgA, actor, {
        eventId: "22222222-2222-2222-2222-222222222222",
        title: "Nope",
        startsAt: "2027-09-01T18:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for an already-cancelled occurrence", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "To be cancelled",
        startsAt: "2027-09-10T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      await cancelEvent(managerPerson, orgA, created.data.eventId);

      const result = await updateEvent(managerPerson, orgA, actor, {
        eventId: created.data.eventId,
        title: "Should not apply",
        startsAt: "2027-09-10T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("rejects an end time before the start time", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Time check",
        startsAt: "2027-09-15T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await updateEvent(managerPerson, orgA, actor, {
        eventId: created.data.eventId,
        title: "Time check",
        startsAt: "2027-09-15T09:00",
        endsAt: "2027-09-15T08:00",
        isPublic: true,
        websiteListed: false,
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Youth group",
        startsAt: "2027-10-01T18:00",
        endsAt: "2027-10-01T19:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: true,
        recurrence: { pattern: "weekly", count: 3 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Not a series",
        startsAt: "2027-11-01T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, actor, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target when the id is a CHILD occurrence, not the parent", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Series for child guard",
        startsAt: "2027-11-05T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, actor, {
        parentEventId: created.data.occurrenceIds[1],
        pattern: "weekly",
        additionalCount: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("rejects an extension that would push the series TOTAL past 52", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Near the cap",
        startsAt: "2027-12-01T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 50 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(managerPerson, orgA, actor, {
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Cross-org series",
        startsAt: "2028-01-01T09:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const result = await extendSeriesPattern(outsidePerson, orgB, actor, {
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Rained out picnic",
        startsAt: "2027-06-15T12:00",
        isPublic: true,
        websiteListed: false,
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
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Double cancel",
        startsAt: "2027-06-20T12:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      await cancelEvent(managerPerson, orgA, created.data.eventId);
      const second = await cancelEvent(managerPerson, orgA, created.data.eventId);
      expect(second).toEqual({ kind: "ok", data: { eventId: created.data.eventId } });
    });

    it("does not cascade to a series' children", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        title: "Cancel-parent-only series",
        startsAt: "2027-06-25T12:00",
        isPublic: true,
        websiteListed: false,
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


  // ---------------------------------------------------------------------
  // Event types (DECISION-161): the optional event_type_id on create/update
  // ---------------------------------------------------------------------

  describe("event types on the write path", () => {
    const UNAVAILABLE = "That event type isn't available. Choose another.";
    let worship: string; // orgA, active
    let study: string; // orgA, active
    let retiredOld: string; // orgA, retired
    let retiredOther: string; // orgA, retired
    let fallback: string; // orgA fallback
    let foreignType: string; // orgB, active

    async function addType(
      organizationId: string,
      name: string,
      opts: { color: string; isActive?: boolean; isFallback?: boolean; sortOrder: number },
    ) {
      const [row] = await getPlatformDb()
        .insert(eventTypes)
        .values({
          organizationId,
          name,
          color: opts.color,
          icon: "CalendarDays",
          sortOrder: opts.sortOrder,
          isActive: opts.isActive ?? true,
          isFallback: opts.isFallback ?? false,
        })
        .returning({ id: eventTypes.id });
      return row!.id;
    }

    async function storedTypeIds(ids: string[]): Promise<Array<string | null>> {
      const rows = await getPlatformDb()
        .select({ id: events.id, typeId: events.eventTypeId })
        .from(events)
        .where(inArray(events.id, ids));
      return ids.map((id) => rows.find((r) => r.id === id)!.typeId);
    }

    async function eventCount(): Promise<number> {
      const result = await listEvents(managerPerson, orgA);
      return result.kind === "ok" ? result.data.length : -1;
    }

    const base = {
      startsAt: "2027-05-01T10:00",
      isPublic: true,
      websiteListed: false,
      allowsCheckin: false,
    };

    beforeAll(async () => {
      worship = await addType(orgA, "Worship", { color: "teal", sortOrder: 10 });
      study = await addType(orgA, "Study", { color: "sky", sortOrder: 20 });
      retiredOld = await addType(orgA, "Old Retired", { color: "violet", sortOrder: 30, isActive: false });
      retiredOther = await addType(orgA, "Other Retired", { color: "rose", sortOrder: 40, isActive: false });
      fallback = await addType(orgA, "General", { color: "neutral", sortOrder: 99, isFallback: true });
      foreignType = await addType(orgB, "Foreign", { color: "teal", sortOrder: 10 });
    });

    it("createEvent writes the type; getEvent returns it as { id, name }", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        ...base,
        title: "Typed single",
        eventTypeId: worship,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(await storedTypeIds(result.data.occurrenceIds)).toEqual([worship]);
      const detail = await getEvent(managerPerson, orgA, result.data.eventId);
      expect(detail.kind === "ok" && detail.data.eventType).toEqual({ id: worship, name: "Worship" });
    });

    it("an untyped event has eventType null", async () => {
      const result = await createEvent(managerPerson, orgA, actor, { ...base, title: "Untyped" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(await storedTypeIds(result.data.occurrenceIds)).toEqual([null]);
      const detail = await getEvent(managerPerson, orgA, result.data.eventId);
      expect(detail.kind === "ok" && detail.data.eventType).toBeNull();
    });

    it("createEvent copies the type onto EVERY generated child of a series", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        ...base,
        title: "Typed series",
        eventTypeId: study,
        recurrence: { pattern: "weekly", count: 4 },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.occurrenceIds).toHaveLength(4);
      expect(await storedTypeIds(result.data.occurrenceIds)).toEqual([study, study, study, study]);
    });

    it("extendSeriesPattern copies the parent's type onto the new children", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        ...base,
        title: "Extend typed series",
        eventTypeId: worship,
        recurrence: { pattern: "weekly", count: 2 },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;
      const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 3,
      });
      expect(extended.kind).toBe("ok");
      if (extended.kind !== "ok") return;
      expect(await storedTypeIds(extended.data.occurrenceIds)).toEqual([worship, worship, worship]);
    });

    it("extending an UNTYPED series leaves the children untyped", async () => {
      const created = await createEvent(managerPerson, orgA, actor, {
        ...base,
        title: "Extend untyped series",
        recurrence: { pattern: "weekly", count: 2 },
      });
      if (created.kind !== "ok") throw new Error("create failed");
      const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
        parentEventId: created.data.eventId,
        pattern: "weekly",
        additionalCount: 1,
      });
      if (extended.kind !== "ok") throw new Error("extend failed");
      expect(await storedTypeIds(extended.data.occurrenceIds)).toEqual([null]);
    });

    describe("createEvent refuses an unusable type with invalid_input, writing NOTHING", () => {
      it.each([
        ["another org's type", () => foreignType],
        ["a garbage string", () => "not-a-uuid"],
        ["a SQL-looking string", () => "' or 1=1 --"],
        ["a retired type", () => retiredOld],
        ["a UUID that exists nowhere", () => "11111111-2222-4333-8444-555555555555"],
      ])("%s", async (_label, typeId) => {
        const before = await eventCount();
        const result = await createEvent(managerPerson, orgA, actor, {
          ...base,
          title: "Should not exist",
          eventTypeId: typeId(),
          recurrence: { pattern: "weekly", count: 3 },
        });
        expect(result).toEqual({ kind: "invalid_input", message: UNAVAILABLE });
        expect(await eventCount()).toBe(before);
      });

      it("the type check does not mask the length checks that come first", async () => {
        const result = await createEvent(managerPerson, orgA, actor, {
          ...base,
          title: "",
          eventTypeId: foreignType,
        });
        expect(result).toEqual({ kind: "invalid_input", message: "Title is required." });
      });
    });

    describe("updateEvent and the type", () => {
      async function typedEvent(typeId: string | null) {
        const created = await createEvent(managerPerson, orgA, actor, {
          ...base,
          title: "Update subject",
          eventTypeId: typeId,
        });
        if (created.kind !== "ok") throw new Error("create failed");
        return created.data.eventId;
      }
      const edit = (eventId: string, extra: { eventTypeId?: string | null } = {}) => ({
        eventId,
        title: "Update subject",
        startsAt: "2027-05-01T10:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        ...extra,
      });

      it("omitting eventTypeId leaves the type unchanged", async () => {
        const id = await typedEvent(worship);
        expect((await updateEvent(managerPerson, orgA, actor, edit(id))).kind).toBe("ok");
        expect(await storedTypeIds([id])).toEqual([worship]);
      });

      it("null clears the type", async () => {
        const id = await typedEvent(worship);
        expect((await updateEvent(managerPerson, orgA, actor, edit(id, { eventTypeId: null }))).kind).toBe("ok");
        expect(await storedTypeIds([id])).toEqual([null]);
      });

      it("a different ACTIVE type sets it", async () => {
        const id = await typedEvent(worship);
        expect((await updateEvent(managerPerson, orgA, actor, edit(id, { eventTypeId: study }))).kind).toBe("ok");
        expect(await storedTypeIds([id])).toEqual([study]);
      });

      it("updating one occurrence's type leaves the rest of the series alone (a mixed series)", async () => {
        const created = await createEvent(managerPerson, orgA, actor, {
          ...base,
          title: "Update subject",
          eventTypeId: worship,
          recurrence: { pattern: "weekly", count: 3 },
        });
        if (created.kind !== "ok") throw new Error("create failed");
        const [parentId, second, third] = created.data.occurrenceIds;
        expect((await updateEvent(managerPerson, orgA, actor, edit(second, { eventTypeId: study }))).kind).toBe("ok");
        expect(await storedTypeIds([parentId, second, third])).toEqual([worship, study, worship]);
      });

      it("a retired type ALREADY on this event is accepted; a DIFFERENT retired type is refused", async () => {
        const id = await typedEvent(worship);
        // Retire "Worship" out from under the event (owner connection).
        await getPlatformDb().update(eventTypes).set({ isActive: false }).where(eq(eventTypes.id, worship));
        try {
          // Re-saving with the type it already carries keeps working.
          expect((await updateEvent(managerPerson, orgA, actor, edit(id, { eventTypeId: worship }))).kind).toBe("ok");
          expect(await storedTypeIds([id])).toEqual([worship]);
          // Choosing some OTHER retired type is not.
          expect(await updateEvent(managerPerson, orgA, actor, edit(id, { eventTypeId: retiredOther }))).toEqual({
            kind: "invalid_input",
            message: UNAVAILABLE,
          });
          expect(await storedTypeIds([id])).toEqual([worship]);
        } finally {
          await getPlatformDb().update(eventTypes).set({ isActive: true }).where(eq(eventTypes.id, worship));
        }
      });

      it.each([
        ["another org's type", () => foreignType],
        ["a garbage string", () => "nope"],
      ])("refuses %s and changes nothing", async (_label, typeId) => {
        const id = await typedEvent(study);
        expect(await updateEvent(managerPerson, orgA, actor, edit(id, { eventTypeId: typeId() }))).toEqual({
          kind: "invalid_input",
          message: UNAVAILABLE,
        });
        expect(await storedTypeIds([id])).toEqual([study]);
      });
    });

    describe("getEventTypePickerData", () => {
      it("is forbidden without events.manage", async () => {
        expect(await getEventTypePickerData(grantlessPerson, orgA)).toEqual({ kind: "forbidden" });
      });

      it("offers the active non-fallback types in manager order; the fallback is not an option", async () => {
        const result = await getEventTypePickerData(managerPerson, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.data.options.map((o) => o.name)).toEqual(["Worship", "Study"]);
        expect(result.data.options.every((o) => o.isRetired === false)).toBe(true);
        expect(result.data.fallbackName).toBe("General");
        expect(result.data.options[0]).toEqual({
          id: worship,
          name: "Worship",
          colorToken: "teal",
          iconKey: "CalendarDays",
          isRetired: false,
        });
      });

      it("includes the event's CURRENT type when it is retired, flagged", async () => {
        const result = await getEventTypePickerData(managerPerson, orgA, { currentTypeId: retiredOld });
        if (result.kind !== "ok") throw new Error("picker failed");
        expect(result.data.options.map((o) => [o.name, o.isRetired])).toEqual([
          ["Worship", false],
          ["Study", false],
          ["Old Retired", true],
        ]);
      });

      it("a current type that is the fallback maps to 'No type' (not added); garbage or foreign ids add nothing", async () => {
        for (const currentTypeId of [fallback, "garbage", foreignType, null, undefined]) {
          const result = await getEventTypePickerData(managerPerson, orgA, { currentTypeId });
          if (result.kind !== "ok") throw new Error("picker failed");
          expect(result.data.options.map((o) => o.name)).toEqual(["Worship", "Study"]);
        }
      });

      it("never lists another org's types", async () => {
        const result = await getEventTypePickerData(outsidePerson, orgB);
        if (result.kind !== "ok") throw new Error("picker failed");
        expect(result.data.options.map((o) => o.name)).toEqual(["Foreign"]);
        expect(result.data.fallbackName).toBeNull();
      });
    });
  });


  // ---------------------------------------------------------------------
  // The public website listing (DECISION-238, DECISION-240; F251, F252)
  // ---------------------------------------------------------------------

  describe("website listing - derivation, series inheritance, audit and counts", () => {
    const ONE = "2027-06-07T10:00";

    const auditActions = ["event.listed_on_website", "event.unlisted_from_website"];

    async function flags(ids: string[]): Promise<Array<{ listed: boolean; isPublic: boolean }>> {
      const rows = await getPlatformDb()
        .select({ id: events.id, listed: events.websiteListed, isPublic: events.isPublic })
        .from(events)
        .where(inArray(events.id, ids));
      return ids.map((id) => {
        const r = rows.find((x) => x.id === id)!;
        return { listed: r.listed, isPublic: r.isPublic };
      });
    }

    /** The website audit rows for an event id (as resource), oldest first. */
    async function audits(resourceId: string): Promise<Array<Record<string, unknown>>> {
      const result = await getPlatformDb().execute(sql`
        select * from audit_events
         where resource_id = ${resourceId}::text and action in (${sql.join(
           auditActions.map((a) => sql`${a}`),
           sql`, `,
         )})
         order by created_at, id`);
      return (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
    }

    async function make(
      over: Partial<import("./events").CreateEventInput> = {},
    ): Promise<{ eventId: string; occurrenceIds: string[] }> {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Listing subject",
        startsAt: ONE,
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        ...over,
      });
      if (result.kind !== "ok") throw new Error(`create failed: ${result.kind}`);
      return result.data;
    }

    function edit(
      eventId: string,
      over: Partial<import("./events").UpdateEventInput> = {},
    ): import("./events").UpdateEventInput {
      return {
        eventId,
        title: "Listing subject",
        startsAt: ONE,
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        ...over,
      };
    }

    afterAll(async () => {
      auditControl.fail = false;
      await getPlatformDb().execute(
        sql`delete from audit_events where metadata->>'organizationId' in (${orgA}, ${orgB})`,
      );
    });

    describe("derivation: the stored value is wanted AND open-to-everyone", () => {
      it("a new event is NOT on the website unless it was asked to be", async () => {
        const { eventId } = await make();
        expect(await flags([eventId])).toEqual([{ listed: false, isPublic: true }]);
      });

      it("createEvent stores the wish when the event is open to everyone, on the parent and every child", async () => {
        const { occurrenceIds } = await make({
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 3 },
        });
        expect((await flags(occurrenceIds)).map((f) => f.listed)).toEqual([true, true, true]);
      });

      it("createEvent never lists a members-only event, whatever was posted", async () => {
        const { occurrenceIds } = await make({
          isPublic: false,
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 2 },
        });
        expect(await flags(occurrenceIds)).toEqual([
          { listed: false, isPublic: false },
          { listed: false, isPublic: false },
        ]);
        expect(await audits(occurrenceIds[0]!)).toHaveLength(0);
      });

      it("updateEvent stores the wish when open to everyone, and a posted true with isPublic false stores false", async () => {
        const { eventId } = await make();
        expect((await updateEvent(managerPerson, orgA, actor, edit(eventId, { websiteListed: true }))).kind).toBe("ok");
        expect(await flags([eventId])).toEqual([{ listed: true, isPublic: true }]);

        const other = await make();
        const result = await updateEvent(
          managerPerson,
          orgA,
          actor,
          edit(other.eventId, { isPublic: false, websiteListed: true }),
        );
        expect(result.kind).toBe("ok");
        expect(await flags([other.eventId])).toEqual([{ listed: false, isPublic: false }]);
      });
    });

    describe("regression for unticking 'Open to everyone' on a listed event tripping the CHECK (F251)", () => {
      it("saves without a constraint error and clears the listing in the same statement - regression for F251", async () => {
        const { eventId } = await make({ websiteListed: true });
        expect(await flags([eventId])).toEqual([{ listed: true, isPublic: true }]);

        // The editor unticks "Open to everyone"; the stale website wish may still be posted.
        const result = await updateEvent(
          managerPerson,
          orgA,
          actor,
          edit(eventId, { isPublic: false, websiteListed: true }),
        );
        expect(result.kind).toBe("ok");
        expect(await flags([eventId])).toEqual([{ listed: false, isPublic: false }]);

        const rows = await audits(eventId);
        expect(rows.map((r) => r.action)).toEqual([
          "event.listed_on_website",
          "event.unlisted_from_website",
        ]);
        expect(rows[1]!.metadata).toMatchObject({ via: "update", clearedBecauseMembersOnly: true });
      });
    });

    describe("regression for extending a series re-listing occurrences that were unlisted (F252)", () => {
      it("new occurrences inherit from the LATEST occurrence, not the parent row - regression for F252", async () => {
        const { eventId: parentId, occurrenceIds } = await make({
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 4 },
        });
        // Unlist "this and all later" from the second occurrence: the parent stays listed.
        const unlisted = await setSeriesWebsiteListing(managerPerson, orgA, actor, {
          eventId: occurrenceIds[1]!,
          listed: false,
        });
        expect(unlisted.kind).toBe("ok");
        expect((await flags(occurrenceIds)).map((f) => f.listed)).toEqual([true, false, false, false]);

        const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
          parentEventId: parentId,
          pattern: "weekly",
          additionalCount: 3,
        });
        expect(extended.kind).toBe("ok");
        if (extended.kind !== "ok") return;
        expect((await flags(extended.data.occurrenceIds)).map((f) => f.listed)).toEqual([false, false, false]);
        expect(await audits(parentId)).toHaveLength(2); // the create (listed) and the series unlist only
      });

      it("when the latest occurrence IS listed the new ones are listed, with one audit row naming the count", async () => {
        const { eventId: parentId } = await make({
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 2 },
        });
        const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
          parentEventId: parentId,
          pattern: "weekly",
          additionalCount: 2,
        });
        if (extended.kind !== "ok") throw new Error("extend failed");
        expect((await flags(extended.data.occurrenceIds)).map((f) => f.listed)).toEqual([true, true]);
        const rows = await audits(parentId);
        expect(rows.map((r) => r.action)).toEqual(["event.listed_on_website", "event.listed_on_website"]);
        expect(rows[1]!.metadata).toEqual({
          organizationId: orgA,
          via: "extend",
          changed: 2,
          rootEventId: parentId,
        });
      });

      it("a cancelled latest occurrence is skipped when choosing what to inherit", async () => {
        const { eventId: parentId, occurrenceIds } = await make({
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 3 },
        });
        // Unlist the last one, then cancel it: the latest NON-cancelled one (listed) rules.
        await setSeriesWebsiteListing(managerPerson, orgA, actor, { eventId: occurrenceIds[2]!, listed: false });
        await cancelEvent(managerPerson, orgA, occurrenceIds[2]!);
        const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
          parentEventId: parentId,
          pattern: "weekly",
          additionalCount: 1,
        });
        if (extended.kind !== "ok") throw new Error("extend failed");
        expect((await flags(extended.data.occurrenceIds)).map((f) => f.listed)).toEqual([true]);
      });

      it("a members-only series never extends onto the website", async () => {
        const { eventId: parentId } = await make({
          isPublic: false,
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 2 },
        });
        const extended = await extendSeriesPattern(managerPerson, orgA, actor, {
          parentEventId: parentId,
          pattern: "weekly",
          additionalCount: 2,
        });
        if (extended.kind !== "ok") throw new Error("extend failed");
        expect(await flags(extended.data.occurrenceIds)).toEqual([
          { listed: false, isPublic: false },
          { listed: false, isPublic: false },
        ]);
        expect(await audits(parentId)).toHaveLength(0);
      });
    });

    describe("audit exactly when the column changes (DECISION-240)", () => {
      it("createEvent: one row for a listed series naming the root and the count; none for an unlisted event", async () => {
        const { eventId, occurrenceIds } = await make({
          websiteListed: true,
          recurrence: { pattern: "weekly", count: 3 },
        });
        const rows = await audits(eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          action: "event.listed_on_website",
          actor_user_id: actingUserId,
          actor_email: actor.email,
          resource_type: "event",
          resource_id: eventId,
        });
        expect(rows[0]!.metadata).toEqual({
          organizationId: orgA,
          via: "create",
          changed: 3,
          rootEventId: eventId,
        });
        // Not one row per occurrence.
        expect(await audits(occurrenceIds[1]!)).toHaveLength(0);

        const plain = await make();
        expect(await audits(plain.eventId)).toHaveLength(0);
      });

      it("updateEvent: listed and unlisted rows on a flip; none on a no-op edit", async () => {
        const { eventId } = await make();
        await updateEvent(managerPerson, orgA, actor, edit(eventId, { title: "Retitled only" }));
        expect(await audits(eventId)).toHaveLength(0); // an edit that changes nothing about the listing

        await updateEvent(managerPerson, orgA, actor, edit(eventId, { websiteListed: true }));
        await updateEvent(managerPerson, orgA, actor, edit(eventId, { websiteListed: true, title: "Again" }));
        await updateEvent(managerPerson, orgA, actor, edit(eventId, { websiteListed: false }));
        const rows = await audits(eventId);
        expect(rows.map((r) => r.action)).toEqual([
          "event.listed_on_website",
          "event.unlisted_from_website",
        ]);
        expect(rows[0]!.metadata).toEqual({ organizationId: orgA, via: "update", changed: 1 });
        expect(rows[1]!.metadata).toEqual({ organizationId: orgA, via: "update", changed: 1 });
        expect(rows[0]!.actor_user_id).toBe(actingUserId);
      });

      it("cancelEvent writes no row and leaves the column alone (F254)", async () => {
        const { eventId } = await make({ websiteListed: true });
        expect((await cancelEvent(managerPerson, orgA, eventId)).kind).toBe("ok");
        expect(await audits(eventId)).toHaveLength(1); // the create only
        expect(await flags([eventId])).toEqual([{ listed: true, isPublic: true }]);
      });

      it("a forbidden call writes nothing and changes nothing", async () => {
        const { eventId } = await make({ websiteListed: true });
        const before = await audits(eventId);
        expect(
          await updateEvent(grantlessPerson, orgA, actor, edit(eventId, { websiteListed: false })),
        ).toEqual({ kind: "forbidden" });
        expect(
          await setSeriesWebsiteListing(grantlessPerson, orgA, actor, { eventId, listed: false }),
        ).toEqual({ kind: "forbidden" });
        expect(await audits(eventId)).toEqual(before);
        expect(await flags([eventId])).toEqual([{ listed: true, isPublic: true }]);
      });

      it("the audit row commits or rolls back WITH the change", async () => {
        const { eventId } = await make();
        auditControl.fail = true;
        try {
          await expect(
            updateEvent(managerPerson, orgA, actor, edit(eventId, { websiteListed: true })),
          ).rejects.toThrow(/audit insert failed/);
          await expect(
            createEvent(managerPerson, orgA, actor, {
              title: "Never stored",
              startsAt: ONE,
              isPublic: true,
              websiteListed: true,
              allowsCheckin: false,
            }),
          ).rejects.toThrow(/audit insert failed/);
        } finally {
          auditControl.fail = false;
        }
        expect(await flags([eventId])).toEqual([{ listed: false, isPublic: true }]);
        const gone = await getPlatformDb()
          .select({ id: events.id })
          .from(events)
          .where(sql`${events.organizationId} = ${orgA} and ${events.title} = 'Never stored'`);
        expect(gone).toHaveLength(0);
      });
    });

    describe("setSeriesWebsiteListing - counts match the rows written", () => {
      it("the confirm summary from getEvent equals what the write changes, for put and take, with cancelled and members-only rows mixed in", async () => {
        const { eventId: parentId, occurrenceIds } = await make({
          recurrence: { pattern: "weekly", count: 6 },
        });
        // occurrence 2 cancelled; occurrence 4 members-only
        expect((await cancelEvent(managerPerson, orgA, occurrenceIds[1]!)).kind).toBe("ok");
        expect(
          (
            await updateEvent(
              managerPerson,
              orgA,
              actor,
              edit(occurrenceIds[3]!, { isPublic: false, startsAt: "2027-06-28T10:00" }),
            )
          ).kind,
        ).toBe("ok");

        const detail = await getEvent(managerPerson, orgA, parentId);
        if (detail.kind !== "ok") throw new Error("detail failed");
        expect(detail.data.seriesWebsite).toMatchObject({
          fromStartsAt: expect.stringMatching(/^2027-06-07T10:00/),
          put: { changes: 4, skippedCancelled: 1, skippedMembersOnly: 1 },
          take: { changes: 0 },
          inheritsOnExtend: false,
        });

        const put = await setSeriesWebsiteListing(managerPerson, orgA, actor, { eventId: parentId, listed: true });
        expect(put).toEqual({
          kind: "ok",
          data: { changed: 4, unchanged: 0, skippedCancelled: 1, skippedMembersOnly: 1 },
        });
        expect((await flags(occurrenceIds)).map((f) => f.listed)).toEqual([true, false, true, false, true, true]);

        const rows = await audits(parentId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "event.listed_on_website", resource_id: parentId });
        expect(rows[0]!.metadata).toEqual({
          organizationId: orgA,
          via: "series",
          scope: "this_and_later",
          changed: 4,
          skippedCancelled: 1,
          skippedMembersOnly: 1,
          rootEventId: parentId,
          anchorEventId: parentId,
        });

        const after = await getEvent(managerPerson, orgA, occurrenceIds[2]!);
        if (after.kind !== "ok") throw new Error("detail failed");
        expect(after.data.seriesWebsite).toMatchObject({
          put: { changes: 0, skippedCancelled: 0, skippedMembersOnly: 1 },
          take: { changes: 3 },
          inheritsOnExtend: true,
        });

        const take = await setSeriesWebsiteListing(managerPerson, orgA, actor, {
          eventId: occurrenceIds[2]!,
          listed: false,
        });
        expect(take).toEqual({
          kind: "ok",
          data: { changed: 3, unchanged: 1, skippedCancelled: 0, skippedMembersOnly: 0 },
        });
        // Earlier rows are untouched; later ones are off.
        expect((await flags(occurrenceIds)).map((f) => f.listed)).toEqual([true, false, false, false, false, false]);
        expect((await audits(parentId)).map((r) => r.action)).toEqual([
          "event.listed_on_website",
          "event.unlisted_from_website",
        ]);
      });

      it("a call that would change nothing writes no audit row", async () => {
        const { eventId } = await make({ recurrence: { pattern: "weekly", count: 2 } });
        const result = await setSeriesWebsiteListing(managerPerson, orgA, actor, { eventId, listed: false });
        expect(result).toEqual({
          kind: "ok",
          data: { changed: 0, unchanged: 2, skippedCancelled: 0, skippedMembersOnly: 0 },
        });
        expect(await audits(eventId)).toHaveLength(0);
      });

      it("a standalone event has no series summary", async () => {
        const { eventId } = await make();
        const detail = await getEvent(managerPerson, orgA, eventId);
        if (detail.kind !== "ok") throw new Error("detail failed");
        expect(detail.data.seriesWebsite).toBeNull();
      });

      it("another organization's event id is invalid_target and nothing is written", async () => {
        const { eventId } = await make({ websiteListed: true });
        const before = await audits(eventId);
        expect(
          await setSeriesWebsiteListing(outsidePerson, orgB, actor, { eventId, listed: false }),
        ).toEqual({ kind: "invalid_target" });
        expect(
          await setSeriesWebsiteListing(managerPerson, orgA, actor, {
            eventId: "00000000-0000-0000-0000-000000000000",
            listed: false,
          }),
        ).toEqual({ kind: "invalid_target" });
        expect(
          await setSeriesWebsiteListing(managerPerson, orgA, actor, { eventId: "not-a-uuid", listed: false }),
        ).toEqual({ kind: "invalid_target" });
        expect(await audits(eventId)).toEqual(before);
        expect(await flags([eventId])).toEqual([{ listed: true, isPublic: true }]);
      });

      it("a non-boolean listed is invalid_input, never coerced", async () => {
        const { eventId } = await make();
        const result = await setSeriesWebsiteListing(managerPerson, orgA, actor, {
          eventId,
          listed: "true" as unknown as boolean,
        });
        expect(result.kind).toBe("invalid_input");
        expect(await flags([eventId])).toEqual([{ listed: false, isPublic: true }]);
      });
    });
  });

  // ---------------------------------------------------------------------
  // F134 — typed digits are stored as typed, whatever the server's zone
  // ---------------------------------------------------------------------

  describe("wall-clock storage under a non-UTC process — regression for typed event times shifting off-UTC (F134)", () => {
    // New York observes DST and is never UTC: the old LOCAL-field writer
    // stored 23:00 for a typed 19:00 here, and drifted a weekly series by an
    // hour across 2026-11-01.
    useProcessTimeZone("America/New_York", { beforeAll, afterAll });

    /** The stored digits, read raw on the owner connection (no driver Date). */
    async function storedDigits(ids: string[]): Promise<string[]> {
      const rows = await getPlatformDb()
        .select({
          id: events.id,
          stored: sql<string>`to_char(${events.startsAt}, 'YYYY-MM-DD HH24:MI:SS')`,
        })
        .from(events)
        .where(inArray(events.id, ids));
      return ids.map((id) => rows.find((r) => r.id === id)!.stored);
    }

    it("a single event stores the typed 19:00, not the UTC-shifted 23:00", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Wall-clock single",
        startsAt: "2026-10-14T19:00",
        endsAt: "2026-10-14T20:30",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(await storedDigits(result.data.occurrenceIds)).toEqual([
        "2026-10-14 19:00:00",
      ]);
      const detail = await getEvent(managerPerson, orgA, result.data.eventId);
      expect(detail.kind).toBe("ok");
      if (detail.kind !== "ok") return;
      expect(detail.data.startsAt).toBe("2026-10-14T19:00:00");
      expect(detail.data.endsAt).toBe("2026-10-14T20:30:00");
    });

    it("a weekly series across the US DST end stores 19:00 on every occurrence", async () => {
      const result = await createEvent(managerPerson, orgA, actor, {
        title: "Wall-clock series",
        startsAt: "2026-10-25T19:00",
        isPublic: true,
        websiteListed: false,
        allowsCheckin: false,
        recurrence: { pattern: "weekly", count: 3 },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(await storedDigits(result.data.occurrenceIds)).toEqual([
        "2026-10-25 19:00:00",
        "2026-11-01 19:00:00",
        "2026-11-08 19:00:00",
      ]);
    });
  });
});
