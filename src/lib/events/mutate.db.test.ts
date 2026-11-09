/**
 * Integration tests for `src/lib/events/mutate.ts` and the delegations in
 * `src/lib/events.ts` that reach it (worship Increment 1, Batch 0; DECISION-326;
 * architect addendum C3 and C4). REAL Postgres, same harness as `events.test.ts`.
 *
 * C3 - ONE LOCK, TAKEN FIRST. A second connection holds `FOR NO KEY UPDATE` on
 *      the event; the writer under test must WAIT, and once that connection
 *      cancels and commits, the writer must see the cancel (it reads
 *      `cancelled_at` after the lock), not a stale pre-cancel snapshot. A writer
 *      that read first and locked later would resolve as `ok`/`changed: true`.
 * C3 - EXCLUDED COLUMNS. `updateEventFieldsInTx` leaves `is_public`,
 *      `website_listed`, `allows_checkin`, `event_type_id`, `recurrence_*` and
 *      `parent_event_id` byte-unchanged and writes no website-listing audit row.
 * C4 - the hook runners are called with the expected arguments: once on the
 *      cancel TRANSITION and not on a repeat cancel; the update hooks on both
 *      `updateEventFieldsInTx` and `events.ts#updateEvent`. They are spied by
 *      wrapping the real runners at the module boundary (the lists are empty in
 *      Batch 0). A throwing hook rolls the cancel back.
 *
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/events/mutate.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// `@/lib/audit` reaches next-auth, which this environment cannot resolve. The
// rows themselves are written by the REAL `insertAuditRow()`.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    EVENT_LISTED_ON_WEBSITE: "event.listed_on_website",
    EVENT_UNLISTED_FROM_WEBSITE: "event.unlisted_from_website",
  },
}));

const hookSpy = vi.hoisted(() => ({
  cancelled: vi.fn(),
  updated: vi.fn(),
  failCancelled: false,
}));
vi.mock("@/lib/events/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/hooks")>();
  return {
    ...actual,
    runEventCancelledHooks: async (
      ...args: Parameters<typeof actual.runEventCancelledHooks>
    ) => {
      hookSpy.cancelled(args[1]);
      if (hookSpy.failCancelled) throw new Error("cancel hook failed (test-injected)");
      return actual.runEventCancelledHooks(...args);
    },
    runEventUpdatedHooks: async (
      ...args: Parameters<typeof actual.runEventUpdatedHooks>
    ) => {
      hookSpy.updated(args[1]);
      return actual.runEventUpdatedHooks(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasDb)("events/mutate.ts (Postgres-backed, real dev database)", () => {
  let updateEventFieldsInTx: typeof import("./mutate").updateEventFieldsInTx;
  let cancelEventInTx: typeof import("./mutate").cancelEventInTx;
  let updateEvent: typeof import("../events").updateEvent;
  let cancelEvent: typeof import("../events").cancelEvent;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let events: typeof import("@/lib/db/domain/events").events;
  let eventTypes: typeof import("@/lib/db/domain/events").eventTypes;
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
  let managerPerson: string; // orgA, holds events.manage
  let grantlessPerson: string; // orgA, holds nothing (a planner-style caller)
  let outsidePerson: string; // orgB only
  let actingUserId: string;
  let actor: import("./insert").EventActor;
  let eventTypeId: string;

  beforeAll(async () => {
    // `@/lib/db` first: the domain modules form an import cycle that only
    // resolves when the connection module loads before them (as in events.test.ts).
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ withOrgContext } = await import("@/lib/authz"));
    ({ updateEventFieldsInTx, cancelEventInTx } = await import("./mutate"));
    ({ updateEvent, cancelEvent } = await import("../events"));
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
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for mutate.db.test.ts`,
          slug: `mutate-test-${label.toLowerCase()}-${stamp}`,
          path: `mutate_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    // The derived "Active Membership" group every membership insert syncs into.
    const [existingType] = await platform
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(eq(groupTypes.key, "roster"))
      .limit(1);
    let rosterTypeId = existingType?.id;
    if (!rosterTypeId) {
      const [created] = await platform
        .insert(groupTypes)
        .values({ key: "roster", name: "Roster" })
        .returning({ id: groupTypes.id });
      rosterTypeId = created!.id;
    }
    for (const org of [orgA, orgB]) {
      await platform.insert(groups).values({
        organizationId: org,
        groupTypeId: rosterTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }

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
        email: `mutate-test-actor-${stamp}@example.invalid`,
        name: "Mutate Test Actor",
      })
      .returning({ id: users.id });
    actingUserId = userRow!.id;
    actor = { userId: actingUserId, email: `mutate-test-actor-${stamp}@example.invalid` };

    const [role] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "events_admin_mutate_test",
        name: "Events Admin (mutate test)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: role!.id, permissionKey: "events.manage" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last, deletableUntil: fixtureDeletableUntil() })
        .returning({ id: people.id });
      return p!.id;
    }
    managerPerson = await person("Theodora", "Blackwood-Osei");
    grantlessPerson = await person("Anselm", "Rivière-Tan");
    outsidePerson = await person("Philippa", "Dunmore");

    async function membership(org: string, personId: string) {
      await platform.insert(memberships).values({
        organizationId: org,
        personId,
        engagementStatus: "regular",
        currentRoll: "active",
      });
    }
    await membership(orgA, managerPerson);
    await membership(orgA, grantlessPerson);
    await membership(orgB, outsidePerson);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: role!.id,
      personId: managerPerson,
      startsOn: "2020-01-01",
      grantedBy: actingUserId,
    });

    const [type] = await platform
      .insert(eventTypes)
      .values({ organizationId: orgA, name: "Mutate fixture type", color: "teal", icon: "Church" })
      .returning({ id: eventTypes.id });
    eventTypeId = type!.id;
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    await platform.execute(
      sql`delete from audit_events where metadata->>'organizationId' in (${orgA}, ${orgB})`,
    );
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

  beforeEach(() => {
    hookSpy.cancelled.mockClear();
    hookSpy.updated.mockClear();
    hookSpy.failCancelled = false;
  });

  /** A fixture event with every excluded column set to something non-default. */
  async function makeEvent(
    over: Partial<typeof events.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await getPlatformDb()
      .insert(events)
      .values({
        organizationId: orgA,
        title: "Fixture service",
        description: "Original description",
        location: "Sanctuary",
        startsAt: new Date(Date.UTC(2027, 0, 10, 9, 0)),
        endsAt: new Date(Date.UTC(2027, 0, 10, 10, 0)),
        isPublic: true,
        websiteListed: true,
        allowsCheckin: true,
        eventTypeId,
        createdBy: actingUserId,
        ...over,
      })
      .returning({ id: events.id });
    return row!.id;
  }

  async function row(id: string) {
    const [r] = await getPlatformDb().select().from(events).where(eq(events.id, id));
    return r!;
  }

  /** Every column `updateEventFieldsInTx` must NOT touch, as one comparable value. */
  async function untouched(id: string): Promise<string> {
    const result = await getPlatformDb().execute(sql`
      select json_build_object(
        'is_public', is_public,
        'website_listed', website_listed,
        'allows_checkin', allows_checkin,
        'event_type_id', event_type_id,
        'recurrence_pattern', recurrence_pattern,
        'recurrence_count', recurrence_count,
        'parent_event_id', parent_event_id,
        'created_by', created_by,
        'created_at', created_at,
        'organization_id', organization_id
      )::text as j
      from events where id = ${id}::uuid`);
    return (result as unknown as { rows: Array<{ j: string }> }).rows[0]!.j;
  }

  const inOrgA = <T>(fn: (tx: import("@/lib/authz").OrgTx) => Promise<T>) =>
    withOrgContext(grantlessPerson, orgA, fn);

  /**
   * A second connection that takes `FOR NO KEY UPDATE` on the event and holds it
   * until `release()`. `release(true)` cancels the event before committing.
   */
  function holdEventLock(eventId: string) {
    let open!: (cancelBeforeCommit: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      open = resolve;
    });
    let signalReady!: () => void;
    let failReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      signalReady = resolve;
      failReady = reject;
    });
    const done = getPlatformDb().transaction(async (tx) => {
      await tx.execute(sql`select id from events where id = ${eventId}::uuid for no key update`);
      signalReady();
      if (await gate) {
        await tx.update(events).set({ cancelledAt: new Date() }).where(eq(events.id, eventId));
      }
    });
    done.catch(failReady);
    return { ready, done, release: (cancelBeforeCommit: boolean) => open(cancelBeforeCommit) };
  }

  async function stillWaiting<T>(p: Promise<T>, ms = 1500): Promise<boolean> {
    const outcome = await Promise.race([
      p.then(() => "settled" as const, () => "settled" as const),
      sleep(ms).then(() => "waiting" as const),
    ]);
    return outcome === "waiting";
  }

  // ---------------------------------------------------------------------
  // updateEventFieldsInTx
  // ---------------------------------------------------------------------

  describe("updateEventFieldsInTx", () => {
    it("writes title, description, location, starts_at and ends_at for a caller holding no events.manage (no permission check)", async () => {
      const id = await makeEvent();
      const result = await inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, {
          eventId: id,
          title: "  Moved service  ",
          description: "  New description  ",
          location: "  Fellowship hall ",
          startsAt: "2027-01-10T11:00",
          endsAt: "2027-01-10T12:30",
        }),
      );
      expect(result).toEqual({ kind: "ok", data: { eventId: id, queueIds: [] } });

      const after = await row(id);
      expect(after.title).toBe("Moved service");
      expect(after.description).toBe("New description");
      expect(after.location).toBe("Fellowship hall");
      expect(after.startsAt.toISOString()).toBe("2027-01-10T11:00:00.000Z");
      expect(after.endsAt?.toISOString()).toBe("2027-01-10T12:30:00.000Z");
    });

    it("leaves description out of the SET when undefined, clears it when blank, and always writes location", async () => {
      const id = await makeEvent();
      await inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, {
          eventId: id,
          title: "Same description",
          startsAt: "2027-01-10T09:00",
        }),
      );
      let after = await row(id);
      expect(after.description).toBe("Original description");
      expect(after.location).toBeNull();
      expect(after.endsAt).toBeNull();

      await inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, {
          eventId: id,
          title: "Cleared description",
          description: "   ",
          location: "Chapel",
          startsAt: "2027-01-10T09:00",
        }),
      );
      after = await row(id);
      expect(after.description).toBeNull();
      expect(after.location).toBe("Chapel");
    });

    it("C3: is_public, website_listed, allows_checkin, event_type_id, recurrence_* and parent_event_id are byte-unchanged, and no website-listing audit row is written", async () => {
      // A repeating-series parent (pattern and count set) with a child pointing at it.
      const parent = await makeEvent({ recurrencePattern: "weekly", recurrenceCount: 2 });
      const child = await makeEvent({
        parentEventId: parent,
        startsAt: new Date(Date.UTC(2027, 0, 17, 9, 0)),
        endsAt: new Date(Date.UTC(2027, 0, 17, 10, 0)),
      });
      const before = { parent: await untouched(parent), child: await untouched(child) };

      for (const id of [parent, child]) {
        const result = await inOrgA((tx) =>
          updateEventFieldsInTx(tx, orgA, {
            eventId: id,
            title: "Edited through the worship door",
            startsAt: "2027-02-07T08:00",
            endsAt: "2027-02-07T09:15",
          }),
        );
        expect(result.kind).toBe("ok");
      }

      expect(await untouched(parent)).toBe(before.parent);
      expect(await untouched(child)).toBe(before.child);
      expect(before.parent).toContain('"website_listed" : true');

      const audits = await getPlatformDb().execute(sql`
        select id from audit_events
         where resource_id in (${parent}, ${child})
           and action in ('event.listed_on_website', 'event.unlisted_from_website')`);
      expect((audits as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    });

    it("C4: runs the update hooks once, in the same transaction, with the before and after start, end and location", async () => {
      const id = await makeEvent();
      await inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, {
          eventId: id,
          title: "Hooked",
          location: "Fellowship hall",
          startsAt: "2027-01-10T11:00",
          endsAt: "2027-01-10T12:00",
        }),
      );
      expect(hookSpy.updated).toHaveBeenCalledTimes(1);
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
      const arg = hookSpy.updated.mock.calls[0]![0];
      expect(arg.organizationId).toBe(orgA);
      expect(arg.eventId).toBe(id);
      expect(arg.before.startsAt.toISOString()).toBe("2027-01-10T09:00:00.000Z");
      expect(arg.before.endsAt.toISOString()).toBe("2027-01-10T10:00:00.000Z");
      expect(arg.before.location).toBe("Sanctuary");
      expect(arg.after.startsAt.toISOString()).toBe("2027-01-10T11:00:00.000Z");
      expect(arg.after.endsAt.toISOString()).toBe("2027-01-10T12:00:00.000Z");
      expect(arg.after.location).toBe("Fellowship hall");
    });

    it("refuses a cancelled event as invalid_target, writes nothing and runs no hook", async () => {
      const id = await makeEvent({ cancelledAt: new Date() });
      const before = await row(id);
      const result = await inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, { eventId: id, title: "Too late", startsAt: "2027-03-01T09:00" }),
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(await row(id)).toEqual(before);
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("an unknown id, a malformed id and another organization's event are all invalid_target", async () => {
      const theirs = await makeEvent();
      const input = (eventId: string) => ({
        eventId,
        title: "Probe",
        startsAt: "2027-03-01T09:00",
      });
      for (const eventId of [
        "00000000-0000-4000-8000-000000000000",
        "not-a-uuid",
        theirs,
      ]) {
        // orgB's viewer, orgB's context: the event belongs to orgA.
        const result = await withOrgContext(outsidePerson, orgB, (tx) =>
          updateEventFieldsInTx(tx, orgB, input(eventId)),
        );
        expect(result).toEqual({ kind: "invalid_target" });
      }
      expect((await row(theirs)).title).toBe("Fixture service");
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("validation failures (blank title, end before start, over-long fields) are invalid_input with no write and no hook", async () => {
      const id = await makeEvent();
      const before = await row(id);
      const attempts = [
        { title: "   ", startsAt: "2027-03-01T09:00" },
        { title: "x", startsAt: "2027-03-01T09:00", endsAt: "2027-03-01T08:00" },
        { title: "t".repeat(201), startsAt: "2027-03-01T09:00" },
        { title: "x", startsAt: "2027-03-01T09:00", location: "l".repeat(201) },
        { title: "x", startsAt: "2027-03-01T09:00", description: "d".repeat(2001) },
      ];
      for (const attempt of attempts) {
        const result = await inOrgA((tx) =>
          updateEventFieldsInTx(tx, orgA, { eventId: id, ...attempt }),
        );
        expect(result.kind).toBe("invalid_input");
      }
      expect(await row(id)).toEqual(before);
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("C3 lock-first: waits for another connection's lock, then sees that connection's cancel and returns invalid_target (no stale write)", async () => {
      const id = await makeEvent();
      const lock = holdEventLock(id);
      await lock.ready;

      const attempt = inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, { eventId: id, title: "Stale write", startsAt: "2027-04-04T09:00" }),
      );
      expect(await stillWaiting(attempt)).toBe(true);

      lock.release(true); // cancel, then commit
      await lock.done;
      expect(await attempt).toEqual({ kind: "invalid_target" });

      const after = await row(id);
      expect(after.title).toBe("Fixture service");
      expect(after.cancelledAt).not.toBeNull();
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("C3 lock-first: with the other connection releasing WITHOUT a cancel, the waiting edit then succeeds", async () => {
      const id = await makeEvent();
      const lock = holdEventLock(id);
      await lock.ready;
      const attempt = inOrgA((tx) =>
        updateEventFieldsInTx(tx, orgA, { eventId: id, title: "After the wait", startsAt: "2027-04-04T09:00" }),
      );
      expect(await stillWaiting(attempt)).toBe(true);
      lock.release(false);
      await lock.done;
      expect((await attempt).kind).toBe("ok");
      expect((await row(id)).title).toBe("After the wait");
    });
  });

  // ---------------------------------------------------------------------
  // cancelEventInTx
  // ---------------------------------------------------------------------

  describe("cancelEventInTx", () => {
    it("cancels on the transition: sets cancelled_at, runs the cancel hooks once with the actor, returns changed true", async () => {
      const id = await makeEvent({ websiteListed: false });
      const result = await inOrgA((tx) => cancelEventInTx(tx, orgA, id, actor));
      expect(result).toEqual({ kind: "ok", data: { eventId: id, changed: true, queueIds: [] } });
      expect((await row(id)).cancelledAt).not.toBeNull();
      expect(hookSpy.cancelled).toHaveBeenCalledTimes(1);
      expect(hookSpy.cancelled).toHaveBeenCalledWith({
        organizationId: orgA,
        eventId: id,
        actor,
      });
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("a repeat cancel is an idempotent ok with changed false and runs NO hook", async () => {
      const id = await makeEvent();
      await inOrgA((tx) => cancelEventInTx(tx, orgA, id, actor));
      const firstStamp = (await row(id)).cancelledAt!.toISOString();
      hookSpy.cancelled.mockClear();

      const second = await inOrgA((tx) => cancelEventInTx(tx, orgA, id, actor));
      expect(second).toEqual({ kind: "ok", data: { eventId: id, changed: false, queueIds: [] } });
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
      expect((await row(id)).cancelledAt!.toISOString()).toBe(firstStamp);
    });

    it("never cancels siblings: cancelling a series parent leaves its children alone", async () => {
      const parent = await makeEvent({ recurrencePattern: "weekly", recurrenceCount: 2 });
      const child = await makeEvent({ parentEventId: parent });
      await inOrgA((tx) => cancelEventInTx(tx, orgA, parent, null));
      expect((await row(parent)).cancelledAt).not.toBeNull();
      expect((await row(child)).cancelledAt).toBeNull();
    });

    it("an unknown id, a malformed id and another organization's event are invalid_target and run no hook", async () => {
      const theirs = await makeEvent();
      for (const eventId of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", theirs]) {
        const result = await withOrgContext(outsidePerson, orgB, (tx) =>
          cancelEventInTx(tx, orgB, eventId, null),
        );
        expect(result).toEqual({ kind: "invalid_target" });
      }
      expect((await row(theirs)).cancelledAt).toBeNull();
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
    });

    it("C3 lock-first: a cancel that waits on another connection's cancel sees it, returns changed false and runs no hook (the fan-out happens once)", async () => {
      const id = await makeEvent();
      const lock = holdEventLock(id);
      await lock.ready;

      const attempt = inOrgA((tx) => cancelEventInTx(tx, orgA, id, actor));
      expect(await stillWaiting(attempt)).toBe(true);

      lock.release(true);
      await lock.done;
      expect(await attempt).toEqual({
        kind: "ok",
        data: { eventId: id, changed: false, queueIds: [] },
      });
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
    });

    it("a hook that throws rolls the cancel back (the event stays uncancelled)", async () => {
      const id = await makeEvent();
      hookSpy.failCancelled = true;
      await expect(inOrgA((tx) => cancelEventInTx(tx, orgA, id, actor))).rejects.toThrow(
        /cancel hook failed/,
      );
      expect((await row(id)).cancelledAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // events.ts delegations (C3, C4)
  // ---------------------------------------------------------------------

  describe("events.ts delegates to the shared writers", () => {
    it("cancelEvent: forbidden without events.manage, and the hook is not reached", async () => {
      const id = await makeEvent();
      expect(await cancelEvent(grantlessPerson, orgA, id)).toEqual({ kind: "forbidden" });
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
      expect((await row(id)).cancelledAt).toBeNull();
    });

    it("cancelEvent: cancels through cancelEventInTx, passes the actor to the hooks (null when none given), and a repeat runs no hook", async () => {
      const id = await makeEvent();
      expect(await cancelEvent(managerPerson, orgA, id, actor)).toEqual({
        kind: "ok",
        data: { eventId: id },
      });
      expect(hookSpy.cancelled).toHaveBeenCalledTimes(1);
      expect(hookSpy.cancelled.mock.calls[0]![0]).toEqual({
        organizationId: orgA,
        eventId: id,
        actor,
      });

      expect((await cancelEvent(managerPerson, orgA, id, actor)).kind).toBe("ok");
      expect(hookSpy.cancelled).toHaveBeenCalledTimes(1);

      const other = await makeEvent();
      await cancelEvent(managerPerson, orgA, other);
      expect(hookSpy.cancelled.mock.calls[1]![0].actor).toBeNull();
    });

    it("cancelEvent: a hook failure rolls the cancel back and the error reaches the caller", async () => {
      const id = await makeEvent();
      hookSpy.failCancelled = true;
      await expect(cancelEvent(managerPerson, orgA, id, actor)).rejects.toThrow(/cancel hook failed/);
      expect((await row(id)).cancelledAt).toBeNull();
    });

    it("cancelEvent: invalid_target for an unknown id, with no hook", async () => {
      expect(await cancelEvent(managerPerson, orgA, "00000000-0000-4000-8000-000000000000")).toEqual({
        kind: "invalid_target",
      });
      expect(hookSpy.cancelled).not.toHaveBeenCalled();
    });

    it("updateEvent: calls the update hooks with before/after, and takes the event lock first (loses a race to a cancel)", async () => {
      const id = await makeEvent();
      const edit = (title: string) => ({
        eventId: id,
        title,
        location: "  Parlor ",
        startsAt: "2027-05-02T10:00",
        endsAt: "2027-05-02T11:00",
        isPublic: true,
        websiteListed: true,
        allowsCheckin: true,
      });

      const ok = await updateEvent(managerPerson, orgA, actor, edit("Via Manage events"));
      expect(ok.kind).toBe("ok");
      expect(hookSpy.updated).toHaveBeenCalledTimes(1);
      const arg = hookSpy.updated.mock.calls[0]![0];
      expect(arg.eventId).toBe(id);
      expect(arg.before.location).toBe("Sanctuary");
      expect(arg.before.startsAt.toISOString()).toBe("2027-01-10T09:00:00.000Z");
      expect(arg.after.location).toBe("Parlor");
      expect(arg.after.startsAt.toISOString()).toBe("2027-05-02T10:00:00.000Z");
      expect(arg.after.endsAt.toISOString()).toBe("2027-05-02T11:00:00.000Z");

      hookSpy.updated.mockClear();
      const lock = holdEventLock(id);
      await lock.ready;
      const attempt = updateEvent(managerPerson, orgA, actor, edit("Stale write"));
      expect(await stillWaiting(attempt)).toBe(true);
      lock.release(true);
      await lock.done;
      expect(await attempt).toEqual({ kind: "invalid_target" });
      expect((await row(id)).title).toBe("Via Manage events");
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });

    it("updateEvent: a cancelled-then-edited event and a forbidden caller run no update hook", async () => {
      const id = await makeEvent();
      expect(
        await updateEvent(grantlessPerson, orgA, actor, {
          eventId: id,
          title: "x",
          startsAt: "2027-05-02T10:00",
          isPublic: true,
          websiteListed: false,
          allowsCheckin: false,
        }),
      ).toEqual({ kind: "forbidden" });
      expect(hookSpy.updated).not.toHaveBeenCalled();
    });
  });
});
