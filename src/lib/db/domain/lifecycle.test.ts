/**
 * Owner-connection proofs for the lifecycle/affiliation schema layer
 * (`drizzle/0044_presby_org_lifecycle.sql` and
 * `drizzle/0045_presby_about_org_affiliation.sql`).
 *
 * WHY THIS FILE EXISTS ALONGSIDE `scripts/test-rls.sql`. That suite runs as
 * `presby_app` and can only ever prove what a tenant connection sees. Two of
 * this schema's protections are specifically about the OTHER connection:
 *
 *   - `presby_freeze_lifecycle_event()` (Ruling A5) exists precisely because
 *     an absent grant does not bind `neondb_owner`, which holds every
 *     privilege by ownership and is the role `PLATFORM_DATABASE_URL`
 *     connects as. `BYPASSRLS` exempts a role from RLS policies, never from
 *     triggers — so the trigger's rejection can only be demonstrated here.
 *   - The `parent_id`-cache-vs-`presby_org_affiliated()` agreement (Phase 2
 *     Notes item 3, this pipeline's riskiest coupling) has a GLOBAL form
 *     that `presby_app` structurally cannot count, because
 *     `organization_affiliations` is tenant-isolated to the recording
 *     council. `test-rls.sql` proves the Northern Reach's slice; this proves
 *     the whole database.
 *
 * Same split `src/lib/org-provisioning.test.ts` already uses for
 * `presby_guard_organizations_delete()`.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/db/domain/lifecycle.test.ts
 *
 * Every mutating assertion runs inside a transaction that always rolls back,
 * so this file writes nothing durable beyond its own four fixture
 * organizations — which matters more than usual here: a lifecycle event, once
 * inserted, can never be deleted by anyone.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "organization lifecycle + about-org enforcement (Postgres-backed, owner connection)",
  () => {
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationAffiliations: typeof import("@/lib/db/domain/lifecycle").organizationAffiliations;
    let organizationLifecycleEvents: typeof import("@/lib/db/domain/lifecycle").organizationLifecycleEvents;
    let organizationSuccessions: typeof import("@/lib/db/domain/lifecycle").organizationSuccessions;
    let congregationStatistics: typeof import("@/lib/db/domain/presbytery").congregationStatistics;
    let users: typeof import("@/lib/db/schema").users;

    const stamp = Date.now();
    const createdOrgIds: string[] = [];

    /** Presbytery A held `congC` until 1995; presbytery B has it since. */
    let presbyteryA = "";
    let presbyteryB = "";
    let congC = "";
    /** A congregation that has only ever belonged to presbytery A. */
    let congD = "";
    /**
     * An unaffiliated congregation, used only as a succession SUCCESSOR so
     * the cardinality probes have three distinct organizations to work with.
     */
    let congE = "";
    /** A sixth body, used only as a third merge predecessor (F54). */
    let congF = "";
    let userId = "";

    const TRANSFER_DATE = "1995-01-01";

    beforeAll(async () => {
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({
        organizationAffiliations,
        organizationLifecycleEvents,
        organizationSuccessions,
      } = await import("@/lib/db/domain/lifecycle"));
      ({ congregationStatistics } = await import(
        "@/lib/db/domain/presbytery"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const [anyUser] = await platform
        .select({ id: users.id })
        .from(users)
        .limit(1);
      if (!anyUser) {
        throw new Error(
          "[lifecycle.test] no users rows in this database — run scripts/seed-dev.sql first.",
        );
      }
      userId = anyUser.id;

      async function makeOrg(label: string, type: string): Promise<string> {
        const slug = `lifecycle-test-${label}-${stamp}`;
        const [row] = await platform
          .insert(organizations)
          .values({
            // Fixture teardown window — drizzle/0044's BEFORE DELETE guard
            // fires on THIS connection too.
            deletableUntil: fixtureDeletableUntil(),
            organizationType: type as "presbytery",
            name: `Fixture ${label} for lifecycle.test.ts`,
            slug,
            path: slug.replace(/-/g, "_"),
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        createdOrgIds.push(row!.id);
        return row!.id;
      }

      presbyteryA = await makeOrg("presbytery-a", "presbytery");
      presbyteryB = await makeOrg("presbytery-b", "presbytery");
      congC = await makeOrg("cong-c", "congregation");
      congD = await makeOrg("cong-d", "congregation");
      congE = await makeOrg("cong-e", "congregation");
      // A sixth body, added 2026-09-24 for F54's "third predecessor after a
      // valid merge" repro: that probe needs THREE distinct predecessors and
      // a distinct successor, and organization_successions_not_self forbids
      // reusing one of the other five for both ends.
      congF = await makeOrg("cong-f", "congregation");

      // The redistricting shape, in the order the seed uses: the CLOSED
      // historical row first (unbounded below — F41), then the open one, so
      // presby_apply_affiliation_to_org_tree() lands on the current parent.
      await platform.insert(organizationAffiliations).values({
        organizationId: presbyteryA,
        subjectOrgId: congC,
        parentOrgId: presbyteryA,
        relationshipType: "member_congregation",
        effectiveFrom: null,
        effectiveTo: TRANSFER_DATE,
        authority: "recorded",
        minuteReference: "Fixture: predates our records, closed 1995",
        recordedBy: userId,
        // The close attribution is INLINE as of 2026-09-24 (F49):
        // `organization_affiliations_closed_shape` refuses a closed row that
        // carries no attribution, and `organization_affiliations_guard`
        // refuses the follow-up UPDATE that would otherwise supply it.
        // `closedBy` stays null on purpose — it is the acting USER, and there
        // is no `app.current_user_id` GUC (Ruling A4), which is exactly why
        // that column is excluded from the CHECK.
        closedByOrgId: presbyteryA,
        closedOn: TRANSFER_DATE,
        closedMinuteReference: "Fixture: the 1995 boundary change",
      });
      await platform.insert(organizationAffiliations).values({
        organizationId: presbyteryB,
        subjectOrgId: congC,
        parentOrgId: presbyteryB,
        relationshipType: "member_congregation",
        effectiveFrom: TRANSFER_DATE,
        authority: "recorded",
        minuteReference: "Fixture: the 1995 boundary change",
        recordedBy: userId,
      });
      await platform.insert(organizationAffiliations).values({
        organizationId: presbyteryA,
        subjectOrgId: congD,
        parentOrgId: presbyteryA,
        relationshipType: "member_congregation",
        effectiveFrom: "1970-01-01",
        authority: "recorded",
        minuteReference: "Fixture: cong D has only ever been A's",
        recordedBy: userId,
      });
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // Children before parents: organizations.parent_id has no cascade, and
      // organization_affiliations cascades only on subject_org_id.
      for (const id of [...createdOrgIds].reverse()) {
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    });

    /**
     * Drizzle wraps a driver error in its own `Failed query: …` and hangs the
     * real one off `.cause`, so a bare `rejects.toThrow(/…/)` matches the
     * wrapper's text and never the database's.
     */
    async function expectDbError(
      run: () => Promise<unknown>,
      pattern: RegExp,
    ): Promise<void> {
      let caught: unknown;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const chain: string[] = [];
      let current: unknown = caught;
      for (let depth = 0; depth < 5 && current; depth += 1) {
        if (current instanceof Error) chain.push(current.message);
        current = current instanceof Error ? current.cause : undefined;
      }
      expect(chain.join(" :: ")).toMatch(pattern);
    }

    /**
     * The DATABASE's own message for a rejected statement — the innermost
     * link of the `.cause` chain, deliberately not the joined chain
     * `expectDbError` matches against. Drizzle's `Failed query: …` wrapper
     * embeds the SQL and its parameters, so two probes that differ only in a
     * uuid would never compare equal through it. Byte-identity is the
     * property under test wherever this is used (DECISION-139).
     */
    async function captureDbError(run: () => Promise<unknown>): Promise<string> {
      let caught: unknown;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      let message = "";
      let current: unknown = caught;
      for (let depth = 0; depth < 5 && current; depth += 1) {
        if (current instanceof Error) message = current.message;
        current = current instanceof Error ? current.cause : undefined;
      }
      return message;
    }

    /**
     * The owner-connection transaction handle every probe below is handed.
     * Spelled out once so the GUC helpers can take it by name instead of
     * re-deriving the same four-deep `Parameters<…>` chain.
     */
    type LifecycleTx = Parameters<
      Parameters<ReturnType<typeof getPlatformDb>["transaction"]>[0]
    >[0];

    /**
     * Declare which lifecycle act this transaction is recording, standing in
     * for the future `presby_record_lifecycle_event()` (F54 / DECISION-141,
     * 2026-09-24; the marker became id-carrying 2026-09-25, QA-1).
     *
     * WHY EVERY FIXTURE BELOW NEEDS IT. `organization_lifecycle_events` and
     * `organization_successions` are one immutable aggregate, and since the
     * sixth Phase 3 loop-back BOTH tables refuse an unmarked `INSERT` on every
     * connection — including this owner one, where no grant binds and only a
     * trigger can. Nothing in the tree arms the flag yet, by design, so a
     * fixture that writes either table directly has to make the same claim the
     * sanctioned writer will. Without it, every probe below would fail on the
     * guard instead of on the mechanism it names.
     *
     * WHY IT TAKES AN ID. The marker no longer carries the boolean `'true'`;
     * it carries the `organization_lifecycle_events.id` this transaction is
     * recording, and `presby_guard_lifecycle_write()` compares the row in
     * front of it against that value — `new.id` on the events table,
     * `new.event_id` on the successions table. So the claim is no longer
     * "some sanctioned act is in progress" but "this specific row belongs to
     * the act now being recorded". The practical consequence for every fixture
     * here: the event id must be CLIENT-GENERATED (`newEventId()`) and armed
     * BEFORE the insert, and the insert must supply it explicitly rather than
     * leaning on the column default — there is no way to arm a value the
     * database has not produced yet.
     */
    async function armLifecycleWrite(
      tx: LifecycleTx,
      eventId: string,
    ): Promise<void> {
      await tx.execute(
        sql`select set_config('presby.lifecycle_write_active', ${eventId}, true)`,
      );
    }

    /**
     * A client-generated `organization_lifecycle_events.id`, minted before the
     * insert so the marker can name it. `presby_record_lifecycle_event()` will
     * do the same thing server-side with `gen_random_uuid()`.
     */
    function newEventId(): string {
      return randomUUID();
    }

    /**
     * Drop the marker again inside the same transaction. This is how a
     * "later, separate, unsanctioned write" is expressed in a test that can
     * never commit: a lifecycle event is permanent once committed (that is the
     * property under test, and a committed one would also block the fixture
     * organizations' teardown), so the reviewer's "after a valid merge is
     * committed, insert a third predecessor" repro is reproduced by arming,
     * writing the valid act, forcing its constraints, then disarming and
     * writing the extra edge.
     *
     * The empty string, not `'false'`: the guard reads the marker through
     * `nullif(…, '')`, so blank and unset take the same branch and this cannot
     * be mistaken for "armed for an act literally named false".
     */
    async function disarmLifecycleWrite(tx: LifecycleTx): Promise<void> {
      await tx.execute(
        sql`select set_config('presby.lifecycle_write_active', '', true)`,
      );
    }

    const ROLLBACK = "__lifecycle_test_rollback__";

    /**
     * Run `body` inside a transaction that ALWAYS rolls back. A lifecycle
     * event cannot be deleted once committed (that is the property under
     * test), so every probe that inserts one has to unwind itself.
     */
    async function inRollback(
      body: (tx: LifecycleTx) => Promise<void>,
    ): Promise<void> {
      const platform = getPlatformDb();
      try {
        await platform.transaction(async (tx) => {
          await body(tx);
          throw new Error(ROLLBACK);
        });
      } catch (err) {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      }
    }

    // -------------------------------------------------------------------
    // Ruling A5 — the freeze fires on the OWNER connection
    // -------------------------------------------------------------------

    describe("presby_freeze_lifecycle_event (drizzle/0044, Ruling A5)", () => {
      it("refuses an UPDATE of a recorded lifecycle event on the owner connection — a grant cannot bind the owner, a trigger can", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "organized",
              effectiveOn: "2026-01-01",
              minuteReference: "Fixture: freeze probe",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          await expectDbError(
            () =>
              tx
                .update(organizationLifecycleEvents)
                .set({ notes: "tampered" })
                .where(eq(organizationLifecycleEvents.id, event!.id)),
            /a minuted act is immutable; record a correcting act instead/,
          );
        });
      });

      it("refuses a DELETE of a recorded lifecycle event on the owner connection", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "organized",
              effectiveOn: "2026-01-02",
              minuteReference: "Fixture: freeze probe (delete)",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          await expectDbError(
            () =>
              tx
                .delete(organizationLifecycleEvents)
                .where(eq(organizationLifecycleEvents.id, event!.id)),
            /a minuted act is immutable; record a correcting act instead/,
          );
        });
      });

      it("still lets presby_transfer_affiliation() close an affiliation row after the grant narrowing — the DEFINER function runs with its owner's privileges, not the caller's", async () => {
        const platform = getPlatformDb();
        // Proven through the tenant-facing path the function is written for:
        // the current parent correcting its own row. If the narrowed grant
        // had broken the function, this raises the uniform rejection.
        await inRollback(async (tx) => {
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          const closedBefore = await tx.execute(
            sql`select count(*)::int as n from organization_affiliations
                 where subject_org_id = ${congC} and effective_to is not null`,
          );
          await tx.execute(
            sql`select presby_transfer_affiliation(
                  ${congC}::uuid, ${presbyteryB}::uuid, 'member_congregation',
                  current_date, 'Fixture: relationship-type correction')`,
          );
          const closedAfter = await tx.execute(
            sql`select count(*)::int as n from organization_affiliations
                 where subject_org_id = ${congC} and effective_to is not null`,
          );
          const before = Number(
            (closedBefore.rows[0] as { n: number | string }).n,
          );
          const after = Number(
            (closedAfter.rows[0] as { n: number | string }).n,
          );
          expect(after).toBe(before + 1);
        });
        expect(platform).toBeDefined();
      });

      it("grants presby_platform select + insert and nothing else on both lifecycle tables", async () => {
        const platform = getPlatformDb();
        const result = await platform.execute(
          sql`select c.relname::text as relname, a.privilege_type::text as privilege_type
                from pg_class c, aclexplode(c.relacl) a
               where c.relname in ('organization_lifecycle_events', 'organization_affiliations')
                 and a.grantee = 'presby_platform'::regrole
               order by 1, 2`,
        );
        const shape = (
          result.rows as Array<{ relname: string; privilege_type: string }>
        ).map((r) => `${r.relname}.${r.privilege_type}`);
        expect(shape).toEqual([
          "organization_affiliations.INSERT",
          "organization_affiliations.SELECT",
          "organization_lifecycle_events.INSERT",
          "organization_lifecycle_events.SELECT",
        ]);
      });
    });

    // -------------------------------------------------------------------
    // Phase 5 Finding 1 — organization_successions: event scope, the freeze,
    // and the cardinality proofs that moved here from scripts/test-rls.sql
    // -------------------------------------------------------------------
    //
    // WHY HERE AND NOT IN test-rls.sql. That suite runs as `presby_app`,
    // which after the Finding 1 revoke holds SELECT and nothing else on this
    // table — so it can prove the GRANT (and does, at 32(j)) and can never
    // reach the trigger behind it: the grant check fires first. The owner
    // connection is the only place the future `presby_record_lifecycle_
    // event()` DEFINER writer's privilege level can be simulated, and it is
    // also the connection the freeze exists for, since no grant binds
    // `neondb_owner`. Setting `app.current_org_id` here does not filter the
    // owner (BYPASSRLS), which is exactly what makes "an owner-privileged
    // writer acting in a foreign council's context" expressible at all.
    describe("organization_successions write path (drizzle/0044, Phase 5 Finding 1)", () => {
      /** An event id that exists nowhere, for the byte-identity probe. */
      const NO_SUCH_EVENT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

      it("refuses a succession row naming a lifecycle event the current org does not own — the write QA reproduced, now rejected", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-01",
              minuteReference: "Fixture: event-scope probe",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          // Presbytery A: a council with no standing over presbytery B's
          // minuted act, and one that cannot even SELECT the event.
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryA}, true)`,
          );
          await expectDbError(
            () =>
              tx.insert(organizationSuccessions).values({
                eventId: event!.id,
                predecessorOrgId: congC,
                successorOrgId: congE,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("raises the BYTE-IDENTICAL uniform literal whether the event is another council's or does not exist at all", async () => {
        let foreign = "";
        let missing = "";

        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-02",
              minuteReference: "Fixture: uniform-message probe",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryA}, true)`,
          );
          foreign = await captureDbError(() =>
            tx.insert(organizationSuccessions).values({
              eventId: event!.id,
              predecessorOrgId: congC,
              successorOrgId: congE,
            }),
          );
        });

        await inRollback(async (tx) => {
          // Armed to NO_SUCH_EVENT itself, deliberately: the guard now binds
          // to an id, so arming to anything else would make the GUARD refuse
          // this row and the probe would no longer reach the event-scope
          // trigger it exists to measure. Arming to the missing id makes the
          // row's declared act match the transaction's, leaving
          // presby_check_succession_event() as the only layer with an
          // objection — which is the point of the byte-identity comparison.
          await armLifecycleWrite(tx, NO_SUCH_EVENT);
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryA}, true)`,
          );
          // A BEFORE INSERT trigger runs ahead of the FK's own AFTER-row
          // check, so this is the trigger's message and not a foreign-key
          // violation naming the table.
          missing = await captureDbError(() =>
            tx.insert(organizationSuccessions).values({
              eventId: NO_SUCH_EVENT,
              predecessorOrgId: congC,
              successorOrgId: congE,
            }),
          );
        });

        expect(foreign).toBe(
          "organization_lifecycle_events: this change is not permitted",
        );
        expect(missing).toBe(foreign);
      });

      it("accepts succession rows from the council that owns the event, and the legal `divided` shape passes the deferred cardinality check", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-03",
              minuteReference: "Fixture: a legal division",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congD,
          });
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congE,
          });

          // Forces the DEFERRED constraint trigger without committing.
          await tx.execute(sql`set constraints all immediate`);

          const rows = await tx.execute(
            sql`select count(*)::int as n from organization_successions
                 where event_id = ${event!.id}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(2);
        });
      });

      it("lets the FIRST predecessor of a `merged` event insert cleanly and fails only at constraint-check time — deferred, not immediate", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "merged",
              effectiveOn: "2026-02-04",
              minuteReference: "Fixture: an incomplete merge",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          // Must SUCCEED: a merged event needs >= 2 predecessors, which
          // cannot be true at the instant the first row is written.
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congE,
          });
          const rows = await tx.execute(
            sql`select count(*)::int as n from organization_successions
                 where event_id = ${event!.id}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(1);

          await expectDbError(
            () => tx.execute(sql`set constraints all immediate`),
            /a merged event needs at least 2 predecessors and exactly 1 successor \(found 1 \/ 1\)/,
          );
        });
      });

      it("refuses an UPDATE of a succession row on the owner connection — a grant cannot bind the owner, a trigger can", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-05",
              minuteReference: "Fixture: succession freeze (update)",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          const [row] = await tx
            .insert(organizationSuccessions)
            .values({
              eventId: event!.id,
              predecessorOrgId: congC,
              successorOrgId: congD,
            })
            .returning({ id: organizationSuccessions.id });

          await expectDbError(
            () =>
              tx
                .update(organizationSuccessions)
                .set({ successorOrgId: congE })
                .where(eq(organizationSuccessions.id, row!.id)),
            /a succession row is the content of a minuted act and is immutable; record a correcting act instead/,
          );
        });
      });

      it("refuses a DELETE of a succession row on the owner connection — the integrity half of Finding 1", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-06",
              minuteReference: "Fixture: succession freeze (delete)",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          const [row] = await tx
            .insert(organizationSuccessions)
            .values({
              eventId: event!.id,
              predecessorOrgId: congC,
              successorOrgId: congD,
            })
            .returning({ id: organizationSuccessions.id });

          await expectDbError(
            () =>
              tx
                .delete(organizationSuccessions)
                .where(eq(organizationSuccessions.id, row!.id)),
            /a succession row is the content of a minuted act and is immutable; record a correcting act instead/,
          );
        });
      });

      it("grants presby_app SELECT only and presby_platform select + insert on organization_successions", async () => {
        const platform = getPlatformDb();
        const result = await platform.execute(
          sql`select a.grantee::regrole::text as grantee,
                     a.privilege_type::text as privilege_type
                from pg_class c, aclexplode(c.relacl) a
               where c.relname = 'organization_successions'
                 and a.grantee::regrole::text in ('presby_app', 'presby_platform')
               order by 1, 2`,
        );
        const shape = (
          result.rows as Array<{ grantee: string; privilege_type: string }>
        ).map((r) => `${r.grantee}.${r.privilege_type}`);
        expect(shape).toEqual([
          "presby_app.SELECT",
          "presby_platform.INSERT",
          "presby_platform.SELECT",
        ]);
      });
    });

    // -------------------------------------------------------------------
    // The 2026-09-24 hardening pass (F48 / F49 / DECISION-140), on the
    // connection that matters. `presby_app` holds no INSERT, UPDATE or DELETE
    // on either table, so from `scripts/test-rls.sql` every probe below would
    // be refused by the permission check before the constraint or trigger
    // under test could fire. `PLATFORM_DATABASE_URL` connects as
    // `neondb_owner`, which owns both tables and holds every privilege by
    // ownership (F44) — here the CHECK and the trigger are the only things
    // standing, which is the whole claim.
    // -------------------------------------------------------------------

    // -------------------------------------------------------------------
    // The 2026-09-24 round-two hardening (F54 / DECISION-141): creation
    // guarded as strongly as mutation. Both tables' INSERT is now gated by
    // one transaction-local GUC, and the aggregate's cardinality is checked
    // from BOTH ends rather than only from the successions side.
    //
    // This connection is the whole point: `presby_app` holds no INSERT on
    // `organization_successions` at all and its grant fires before any
    // trigger, so scripts/test-rls.sql can only ever prove the grant there.
    // `neondb_owner` holds every privilege by ownership (F44), so here the
    // guard is the only thing standing — which is exactly the connection the
    // external reviewer's repro assumed.
    //
    // WHAT THIS BLOCK DOES NOT PROVE, stated up front because the earlier
    // version of it overclaimed and QA caught the overclaim (QA-1,
    // 2026-09-25). `presby.lifecycle_write_active` carries the event id being
    // recorded, so the guard binds every row to the act the transaction
    // DECLARED — proven below, one test per table branch. It does NOT make a
    // committed act's topology immutable: a later, separate transaction that
    // deliberately re-arms the marker to a settled event's OWN id is accepted.
    // That is a named, accepted residual (drizzle/0044 section 12a, F44 class,
    // owner-connection-bounded) and there is deliberately no red/skipped test
    // for it — this file cannot commit a lifecycle event at all, since a
    // committed one is permanent and would block the fixture teardown, so any
    // such test would be a stand-in that proves something else while reading
    // as if it proved the residual. That is the exact mistake being corrected
    // here; prose is the honest instrument.
    // -------------------------------------------------------------------

    describe("the lifecycle creation guard (F54 / DECISION-141)", () => {
      it("refuses a raw INSERT into organization_lifecycle_events with presby.lifecycle_write_active unarmed — a grant never bound the owner, and a shape CHECK proves form, not provenance", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                organizationId: presbyteryB,
                subjectOrgId: congC,
                event: "organized",
                effectiveOn: "2026-03-01",
                minuteReference: "Fabricated: no sanctioned writer",
                recordedBy: userId,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("refuses a raw INSERT into organization_successions with the GUC unarmed, even for an event that exists and is in scope", async () => {
        await inRollback(async (tx) => {
          // The event is written through the sanctioned path...
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-03-02",
              minuteReference: "Fixture: a real division",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );

          // ...and the edge is not. organization_successions_event_scope
          // CANNOT catch this: the event exists and belongs to the acting
          // council, which is precisely the case it is written to allow.
          await disarmLifecycleWrite(tx);
          await expectDbError(
            () =>
              tx.insert(organizationSuccessions).values({
                eventId: event!.id,
                predecessorOrgId: congC,
                successorOrgId: congD,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("refuses a THIRD predecessor added to an already-valid merge once the marker is dropped — the UNARMED half of the reviewer's repro, which cardinality cannot see", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congE,
              event: "merged",
              effectiveOn: "2026-03-03",
              minuteReference: "Fixture: A + B -> C, lawfully minuted",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congE,
          });
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congD,
            successorOrgId: congE,
          });
          // The act as minuted is complete and VALID at this point: forcing
          // the deferred checks proves it rather than assuming it.
          await tx.execute(sql`set constraints all immediate`);

          // An unsanctioned write, standing in for a second transaction —
          // which this file cannot use: a committed lifecycle event is
          // permanent and would block the fixture teardown.
          //
          // SAID PLAINLY, because the previous version of this test claimed
          // more than it proved (QA-1, 2026-09-25): dropping the marker is
          // NOT the reviewer's repro. It proves "unarmed is refused", which
          // is true and worth pinning, and which the id-binding correction
          // did not change. The reviewer's actual repro — a later transaction
          // that RE-ARMS to this settled event's own id — is a named,
          // accepted residual (drizzle/0044 section 12a) and is not refused
          // by anything; see the describe-block comment above.
          //
          // congF, a body not already in this merge: a repeat of congC or
          // congD would also trip organization_successions_edge_unique, and
          // the probe has to be one only the guard can refuse.
          await disarmLifecycleWrite(tx);
          await expectDbError(
            () =>
              tx.insert(organizationSuccessions).values({
                eventId: event!.id,
                predecessorOrgId: congF,
                successorOrgId: congE,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );

        });
      });

      // -----------------------------------------------------------------
      // THE ID BINDING (QA-1, 2026-09-25, eighth Phase 3 loop-back).
      // presby.lifecycle_write_active carries the event id the transaction is
      // recording, not the boolean 'true'. The two tests below are the whole
      // difference between "some sanctioned act is in progress" and "this row
      // belongs to the act now being recorded" — one per table, because the
      // guard reads a different column on each (new.id vs new.event_id) and a
      // single test would leave one branch unexercised.
      // -----------------------------------------------------------------

      it("refuses a succession row whose event_id names a DIFFERENT act than the one this transaction declared — the binding, not merely the arming", async () => {
        await inRollback(async (tx) => {
          // Act Y: a real, in-scope event, written through its own sanctioned
          // arming. It has to EXIST and belong to the acting council, or
          // organization_successions_event_scope (which sorts before the
          // guard, `e` < `g`) would refuse first and the probe would prove
          // that trigger instead of this one.
          const otherEventId = newEventId();
          await armLifecycleWrite(tx, otherEventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: otherEventId,
            organizationId: presbyteryB,
            subjectOrgId: congD,
            event: "organized",
            effectiveOn: "2026-03-09",
            minuteReference: "Fixture: act Y, a separate minuted act",
            recordedBy: userId,
          });

          // Act X: the act this transaction now declares it is recording.
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "divided",
            effectiveOn: "2026-03-10",
            minuteReference: "Fixture: act X, the declared act",
            recordedBy: userId,
          });

          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );

          // An edge belonging to Y, written while the transaction says it is
          // recording X. Armed, in scope, well-formed, cardinality-legal —
          // and refused, because it is not part of the declared act.
          await expectDbError(
            () =>
              tx.insert(organizationSuccessions).values({
                eventId: otherEventId,
                predecessorOrgId: congC,
                successorOrgId: congE,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });

        // The positive control, and it has to be its own transaction: a
        // rejected statement aborts the enclosing one. The IDENTICAL edge
        // shape against the DECLARED act is accepted — without this, the
        // refusal above would also pass if the guard refused every succession
        // row outright.
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "divided",
            effectiveOn: "2026-03-10",
            minuteReference: "Fixture: act X, the declared act",
            recordedBy: userId,
          });
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          await tx.insert(organizationSuccessions).values({
            eventId,
            predecessorOrgId: congC,
            successorOrgId: congE,
          });
          const rows = await tx.execute(
            sql`select count(*)::int as n from organization_successions
                 where event_id = ${eventId}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(1);
        });
      });

      it("refuses a lifecycle event whose OWN id is not the id the transaction armed — the events-table branch of the binding", async () => {
        await inRollback(async (tx) => {
          const declared = newEventId();
          const impostor = newEventId();
          await armLifecycleWrite(tx, declared);

          // Authority sorts before the guard (`a` < `g`) and this row passes
          // it — presbyteryB is one level above congC — so the guard is the
          // only layer left to object, and it objects to the id.
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                id: impostor,
                organizationId: presbyteryB,
                subjectOrgId: congC,
                event: "organized",
                effectiveOn: "2026-03-11",
                minuteReference: "Fixture: an event the transaction never declared",
                recordedBy: userId,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("accepts the event whose id the transaction DID arm — the matching-id positive control for both branches", async () => {
        await inRollback(async (tx) => {
          const declared = newEventId();
          await armLifecycleWrite(tx, declared);
          await tx.insert(organizationLifecycleEvents).values({
            id: declared,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "organized",
            effectiveOn: "2026-03-12",
            minuteReference: "Fixture: the declared act, written",
            recordedBy: userId,
          });
          const rows = await tx.execute(
            sql`select count(*)::int as n from organization_lifecycle_events
                 where id = ${declared}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(1);
        });
      });

      it("reads the marker through nullif, so a BLANK marker is unarmed rather than an act literally named empty", async () => {
        await inRollback(async (tx) => {
          await tx.execute(
            sql`select set_config('presby.lifecycle_write_active', '', true)`,
          );
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                organizationId: presbyteryB,
                subjectOrgId: congC,
                event: "organized",
                effectiveOn: "2026-03-13",
                minuteReference: "Fabricated: blank marker",
                recordedBy: userId,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("binds the guard to new.id / new.event_id in the deployed function body — the structural half of QA-1, so a boolean-marker regression fails here too", async () => {
        const platform = getPlatformDb();
        const body = await platform.execute(sql`
          select pg_get_functiondef(oid) as def
            from pg_proc where proname = 'presby_guard_lifecycle_write'
        `);
        const def = String((body.rows[0] as { def: string }).def);
        expect(def).toContain("new.id::text");
        expect(def).toContain("new.event_id::text");
        expect(def).toContain("tg_table_name");
        // The old boolean sentinel, gone: the guard must not compare the
        // marker against the literal 'true' anywhere.
        expect(def).not.toMatch(/lifecycle_write_active', true\), ''\) <> 'true'/);
      });

      it("and it is the GUARD refusing that third predecessor, not cardinality — the identical edge is accepted while the marker is still set", async () => {
        // The positive control for the repro above, and it has to be its own
        // transaction: a rejected statement aborts the enclosing one, so the
        // two halves cannot share a rollback block.
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congE,
              event: "merged",
              effectiveOn: "2026-03-08",
              minuteReference: "Fixture: A + B + D -> C, all in one act",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          await tx.execute(
            sql`select set_config('app.current_org_id', ${presbyteryB}, true)`,
          );
          for (const predecessor of [congC, congD, congF]) {
            await tx.insert(organizationSuccessions).values({
              eventId: event!.id,
              predecessorOrgId: predecessor,
              successorOrgId: congE,
            });
          }
          // Three predecessors still satisfies "at least 2 predecessors and
          // exactly 1 successor" — which is exactly why cardinality could
          // never have caught the write above, and why the GUC had to.
          await tx.execute(sql`set constraints all immediate`);
          const rows = await tx.execute(
            sql`select count(distinct predecessor_org_id)::int as n
                  from organization_successions where event_id = ${event!.id}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(3);
        });
      });

      it("accepts a well-formed event AND its succession rows in one armed transaction — the plumbing presby_record_lifecycle_event() will use, proven before it exists", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-03-04",
              minuteReference: "Fixture: one sanctioned transaction",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congD,
          });
          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congE,
          });
          await tx.execute(sql`set constraints all immediate`);
          const rows = await tx.execute(
            sql`select count(*)::int as n from organization_successions
                 where event_id = ${event!.id}`,
          );
          expect(Number((rows.rows[0] as { n: number | string }).n)).toBe(2);
        });
      });

      it("rejects a merged event committed with ZERO succession rows, at commit — the hole the successions-side trigger structurally could not see", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "merged",
            effectiveOn: "2026-03-05",
            minuteReference: "Fixture: a merge that merges nothing",
            recordedBy: userId,
          });
          // Nothing on organization_successions ever fires here — no row was
          // written to it. Only the new event-side deferred trigger can object.
          await expectDbError(
            () => tx.execute(sql`set constraints all immediate`),
            /a merged event needs at least 2 predecessors and exactly 1 successor \(found 0 \/ 0\)/,
          );
        });
      });

      it("rejects a divided event with zero succession rows too, and leaves the no-edge event types alone", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "divided",
            effectiveOn: "2026-03-06",
            minuteReference: "Fixture: a division that divides nothing",
            recordedBy: userId,
          });
          await expectDbError(
            () => tx.execute(sql`set constraints all immediate`),
            /a divided event needs exactly 1 predecessor and at least 2 successors \(found 0 \/ 0\)/,
          );
        });

        // `dissolved` carries no succession rows BY RULE: the same trigger
        // must not object to it, or the refactor broke the per-event-type
        // rules it was supposed to preserve.
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "dissolved",
            effectiveOn: "2026-03-07",
            minuteReference: "Fixture: a lawful dissolution",
            recordedBy: userId,
          });
          await tx.execute(sql`set constraints all immediate`);
        });
      });

      it("shares ONE guard function, ONE flag and ONE extracted cardinality body across both tables — the catalog shape", async () => {
        const platform = getPlatformDb();
        const triggers = await platform.execute(sql`
          select c.relname::text as relname, t.tgname::text as tgname,
                 p.proname::text as proname,
                 (t.tgtype & 4) = 4 as on_insert,
                 t.tgdeferrable as deferrable_,
                 t.tgenabled::text as enabled
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_proc p on p.oid = t.tgfoid
           where c.relname in ('organization_lifecycle_events', 'organization_successions')
             and t.tgname in ('organization_lifecycle_events_guard',
                              'organization_successions_guard',
                              'organization_lifecycle_events_cardinality')
           order by 1, 2
        `);
        expect(
          (
            triggers.rows as Array<{
              relname: string;
              tgname: string;
              proname: string;
              on_insert: boolean;
              deferrable_: boolean;
              enabled: string;
            }>
          ).map(
            (r) =>
              `${r.tgname} -> ${r.proname} (insert=${r.on_insert}, deferred=${r.deferrable_}, enabled=${r.enabled})`,
          ),
        ).toEqual([
          "organization_lifecycle_events_cardinality -> presby_check_lifecycle_event_cardinality (insert=true, deferred=true, enabled=O)",
          "organization_lifecycle_events_guard -> presby_guard_lifecycle_write (insert=true, deferred=false, enabled=O)",
          "organization_successions_guard -> presby_guard_lifecycle_write (insert=true, deferred=false, enabled=O)",
        ]);

        // The counting/raising body exists in exactly ONE place, and both
        // cardinality triggers call it rather than carrying a copy.
        const shared = await platform.execute(sql`
          select count(*)::int as n from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and p.proname in ('presby_check_succession_cardinality',
                              'presby_check_lifecycle_event_cardinality')
            and pg_get_functiondef(p.oid) like '%presby_lifecycle_event_cardinality_check%'
        `);
        expect(Number((shared.rows[0] as { n: number | string }).n)).toBe(2);
      });
    });

    // -------------------------------------------------------------------
    // The lifecycle event's own rules (moved from test-rls.sql 32(k),
    // 2026-09-25). presby_app held `select, insert` on
    // organization_lifecycle_events until drizzle/0044 narrowed it to SELECT
    // (Phase 2 Ruling 1's function-mediated shape, the one
    // organization_successions has carried since Phase 5 Finding 1). The
    // grant now refuses before any trigger or CHECK on this table can fire,
    // so a tenant-connection probe of those mechanisms proves only the grant.
    // They run here instead, on the connection where the grant is irrelevant
    // and the trigger is the only thing standing.
    // -------------------------------------------------------------------

    describe("the lifecycle event's own rules (moved from test-rls.sql 32(k))", () => {
      it("refuses a council recording a lifecycle event against ITSELF — a presbytery cannot constitutionally dissolve itself", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                id: eventId,
                organizationId: presbyteryB,
                subjectOrgId: presbyteryB,
                event: "dissolved",
                effectiveOn: "2026-04-01",
                minuteReference: "Fixture: self-targeting",
                recordedBy: userId,
              }),
            // insufficient_privilege from presby_assert_council_authority(),
            // not check_violation from organization_lifecycle_events_not_self:
            // a BEFORE INSERT trigger runs ahead of the table's own CHECK.
            // The CHECK stays as defence in depth for a writer that reaches
            // the table with the trigger disabled.
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("refuses a presbytery acting on another PRESBYTERY — one level above only, G-3.0301(a)", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                id: eventId,
                organizationId: presbyteryB,
                subjectOrgId: presbyteryA,
                event: "dissolved",
                effectiveOn: "2026-04-02",
                minuteReference: "Fixture: two levels off",
                recordedBy: userId,
              }),
            /organization_lifecycle_events: this change is not permitted/,
          );
        });
      });

      it("refuses a received event with no external_body, and requires the counterparty only for received/dismissed", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await expectDbError(
            () =>
              tx.insert(organizationLifecycleEvents).values({
                id: eventId,
                organizationId: presbyteryB,
                subjectOrgId: congC,
                event: "received",
                effectiveOn: "2026-04-03",
                minuteReference: "Fixture: no counterparty",
                recordedBy: userId,
              }),
            /organization_lifecycle_events_external_body_shape/,
          );
        });
        // ...and the same event WITH the counterparty is accepted, so the
        // CHECK is proven to be about the missing column and not about the
        // event type.
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "received",
            effectiveOn: "2026-04-04",
            externalBody: "Fixture Presbytery of Elsewhere",
            minuteReference: "Fixture: with counterparty",
            recordedBy: userId,
          });
        });
      });

      it("runs the dissolution path end to end: the cache moves and is dated, the affiliation closes, parent_id follows it to null, and the ARCHIVE still resolves", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          // congC belongs to presbyteryB since 1995 (the fixture's
          // redistricting shape), so B is the council that may dissolve it.
          await tx.insert(organizationLifecycleEvents).values({
            id: eventId,
            organizationId: presbyteryB,
            subjectOrgId: congC,
            event: "dissolved",
            effectiveOn: "2026-06-30",
            minuteReference: "Fixture: dissolution path, item 3",
            recordedBy: userId,
          });

          const cache = await tx.execute(sql`
            select lifecycle_status::text as status,
                   lifecycle_as_of::text as as_of,
                   (parent_id is null) as parent_cleared
              from organizations where id = ${congC}::uuid
          `);
          expect(cache.rows[0]).toMatchObject({
            status: "dissolved",
            as_of: "2026-06-30",
            parent_cleared: true,
          });

          const open = await tx.execute(sql`
            select count(*)::int as n from organization_affiliations
             where subject_org_id = ${congC}::uuid and effective_to is null
          `);
          expect(Number((open.rows[0] as { n: number | string }).n)).toBe(0);

          // The property that lets a dissolved congregation's 1990 return
          // stay attributable: affiliation is answered AS OF a date, so
          // closing it in 2026 cannot rewrite 2020.
          const before = await tx.execute(sql`
            select presby_org_affiliated(${congC}::uuid, ${presbyteryB}::uuid, date '2020-01-01') as v
          `);
          const after = await tx.execute(sql`
            select presby_org_affiliated(${congC}::uuid, ${presbyteryB}::uuid, date '2026-12-31') as v
          `);
          expect((before.rows[0] as { v: boolean }).v).toBe(true);
          expect((after.rows[0] as { v: boolean }).v).toBe(false);
        });
      });

      it("grants presby_app SELECT and nothing else on BOTH lifecycle tables — the 2026-09-25 narrowing, asserted where the tables are", async () => {
        const platform = getPlatformDb();
        const result = await platform.execute(sql`
          select c.relname::text as relname, a.privilege_type::text as privilege_type
            from pg_class c, aclexplode(c.relacl) a
           where c.relname in ('organization_lifecycle_events', 'organization_successions')
             and a.grantee = 'presby_app'::regrole
           order by 1, 2
        `);
        expect(
          (
            result.rows as Array<{ relname: string; privilege_type: string }>
          ).map((r) => `${r.relname}.${r.privilege_type}`),
        ).toEqual([
          "organization_lifecycle_events.SELECT",
          "organization_successions.SELECT",
        ]);
      });
    });

    describe("organization_successions_edge_unique (F48 / DECISION-140)", () => {
      it("refuses the same (event, predecessor, successor) edge twice — one fact written twice is not two facts", async () => {
        await inRollback(async (tx) => {
          const eventId = newEventId();
          await armLifecycleWrite(tx, eventId);
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
              id: eventId,
              organizationId: presbyteryB,
              subjectOrgId: congC,
              event: "divided",
              effectiveOn: "2026-02-07",
              minuteReference: "Fixture: F48 duplicate edge",
              recordedBy: userId,
            })
            .returning({ id: organizationLifecycleEvents.id });

          await tx.insert(organizationSuccessions).values({
            eventId: event!.id,
            predecessorOrgId: congC,
            successorOrgId: congD,
          });
          // The IDENTICAL triple, not a different successor: the constraint
          // is about one fact recorded twice, not about cardinality (which
          // presby_check_succession_cardinality() already resists, because it
          // counts `count(distinct …)`).
          await expectDbError(
            () =>
              tx.insert(organizationSuccessions).values({
                eventId: event!.id,
                predecessorOrgId: congC,
                successorOrgId: congD,
              }),
            /organization_successions_edge_unique/,
          );
        });
      });
    });

    describe("organization_affiliations row shape (F49 / DECISION-140)", () => {
      /** A legal base row, so each probe varies exactly one thing. */
      function base(overrides: Record<string, unknown>) {
        return {
          organizationId: presbyteryA,
          subjectOrgId: congE,
          parentOrgId: presbyteryA,
          relationshipType: "member_congregation",
          effectiveFrom: "1980-01-01",
          authority: "recorded",
          minuteReference: "Fixture: F49 base row",
          recordedBy: userId,
          ...overrides,
        } as never;
      }

      it("refuses an EMPTY effective range — daterange(d, d) is valid, empty, and overlaps nothing, so the EXCLUDE constraint never sees it", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(organizationAffiliations).values(
                base({
                  effectiveFrom: "1980-01-01",
                  effectiveTo: "1980-01-01",
                  closedByOrgId: presbyteryA,
                  closedOn: "1980-01-01",
                  closedMinuteReference: "Fixture: same-day close",
                }),
              ),
            /organization_affiliations_range_order/,
          );
        });
      });

      it("refuses an INVERTED effective range", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(organizationAffiliations).values(
                base({
                  effectiveFrom: "1990-01-01",
                  effectiveTo: "1980-01-01",
                  closedByOrgId: presbyteryA,
                  closedOn: "1980-01-01",
                  closedMinuteReference: "Fixture: inverted",
                }),
              ),
            /organization_affiliations_range_order/,
          );
        });
      });

      it("refuses a CLOSED row with no close attribution, and an OPEN row that carries some", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx
                .insert(organizationAffiliations)
                .values(base({ effectiveTo: "1995-01-01" })),
            /organization_affiliations_closed_shape/,
          );
        });
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(organizationAffiliations).values(
                base({
                  closedOn: "1995-01-01",
                  closedMinuteReference: "Fixture: attribution with no act",
                }),
              ),
            /organization_affiliations_closed_shape/,
          );
        });
      });

      it("accepts a closed row whose closed_by is null — the Ruling A4 exclusion is deliberate, not an oversight", async () => {
        await inRollback(async (tx) => {
          await tx.insert(organizationAffiliations).values(
            base({
              subjectOrgId: congE,
              effectiveFrom: "1900-01-01",
              effectiveTo: "1901-01-01",
              closedByOrgId: presbyteryA,
              closedBy: null,
              closedOn: "1901-01-01",
              closedMinuteReference: "Fixture: a close with no acting USER",
            }),
          );
        });
      });

      it("refuses a body that is its own council", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx
                .insert(organizationAffiliations)
                .values(base({ parentOrgId: congE })),
            /organization_affiliations_not_self|organization_affiliations: this change is not permitted/,
          );
        });
      });
    });

    describe("organization_affiliations_guard (F49 / DECISION-140)", () => {
      it("refuses a raw UPDATE of 1994 affiliation history on the OWNER connection — the grant revoke never bound neondb_owner (F44)", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx
                .update(organizationAffiliations)
                .set({ minuteReference: "tamper" })
                .where(eq(organizationAffiliations.subjectOrgId, congD)),
            /organization_affiliations: this change is not permitted/,
          );
        });
      });

      it("refuses a raw DELETE on the OWNER connection", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx
                .delete(organizationAffiliations)
                .where(eq(organizationAffiliations.subjectOrgId, congD)),
            /organization_affiliations: this change is not permitted/,
          );
        });
      });

      it("still lets a deletable_until-stamped fixture organization DELETE cascade cleanly — the test a naive 'always reject DELETE' implementation fails", async () => {
        // This is the reason the DELETE arm reads a GUC rather than mirroring
        // organization_successions' unconditional freeze. `subject_org_id` is
        // ON DELETE CASCADE *specifically* so fixture teardown works, and
        // `presby_guard_organizations_delete()` arms the flag once it has
        // validated `deletableUntil` — pre-authorizing the cascade Postgres
        // fires immediately afterwards, in the same transaction, with no
        // change to any of the 15+ existing teardown call sites.
        const platform = getPlatformDb();
        const slug = `lifecycle-cascade-${stamp}`;
        const [org] = await platform
          .insert(organizations)
          .values({
            deletableUntil: fixtureDeletableUntil(),
            organizationType: "congregation",
            name: "Fixture cascade org for lifecycle.test.ts",
            slug,
            path: slug.replace(/-/g, "_"),
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        await platform.insert(organizationAffiliations).values({
          organizationId: presbyteryA,
          subjectOrgId: org!.id,
          parentOrgId: presbyteryA,
          relationshipType: "member_congregation",
          effectiveFrom: "2020-01-01",
          authority: "recorded",
          minuteReference: "Fixture: cascade teardown",
          recordedBy: userId,
        });

        // The plain teardown every fixture already performs.
        await platform.delete(organizations).where(eq(organizations.id, org!.id));

        const left = await platform.execute(sql`
          select count(*)::int as n from organization_affiliations
           where subject_org_id = ${org!.id}::uuid
        `);
        expect((left.rows[0] as { n: number }).n).toBe(0);
      });
    });

    // -------------------------------------------------------------------
    // Increment 3 — the about-org trigger, and the coupling it must honour
    // -------------------------------------------------------------------

    describe("presby_check_about_org_affiliated (drizzle/0045)", () => {
      it("refuses a statistics row about an organization that has never been this council's", async () => {
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(congregationStatistics).values({
                organizationId: presbyteryB,
                aboutOrgId: congD,
                year: 2025,
                provenance: "presbytery_entered",
                endingActive: 10,
              }),
            /congregation_statistics: the organization this record is about was not affiliated with this council as of 2025/,
          );
        });
      });

      it("accepts a statistics row for a year the council actually held the congregation, and refuses the same row from the council that holds it TODAY", async () => {
        // A (the 1970–1995 parent) may record 1990.
        await inRollback(async (tx) => {
          await tx.insert(congregationStatistics).values({
            organizationId: presbyteryA,
            aboutOrgId: congC,
            year: 1990,
            provenance: "imported",
            endingActive: 118,
          });
          const rows = await tx
            .select({ id: congregationStatistics.id })
            .from(congregationStatistics)
            .where(eq(congregationStatistics.organizationId, presbyteryA));
          expect(rows).toHaveLength(1);
        });

        // B — which holds congC today, and whose own UI check
        // (`organizations.parent_id = organizationId`,
        // src/lib/presbytery.ts:143) WOULD offer it — may not. This is the
        // designed divergence between the two answers (F30/F31): the archive
        // belongs to the council that received it. Asserted so the
        // divergence is a recorded fact, not a surprise in production.
        await inRollback(async (tx) => {
          await expectDbError(
            () =>
              tx.insert(congregationStatistics).values({
                organizationId: presbyteryB,
                aboutOrgId: congC,
                year: 1990,
                provenance: "imported",
                endingActive: 118,
              }),
            /congregation_statistics: the organization this record is about was not affiliated with this council as of 1990/,
          );
        });
      });

      it("treats the row's year as the WHOLE year: the transfer year is writable by the receiving council", async () => {
        // congC moved to B on 1995-01-01. B may record 1995.
        await inRollback(async (tx) => {
          await tx.insert(congregationStatistics).values({
            organizationId: presbyteryB,
            aboutOrgId: congC,
            year: 1995,
            provenance: "imported",
            endingActive: 100,
          });
          const rows = await tx
            .select({ id: congregationStatistics.id })
            .from(congregationStatistics)
            .where(eq(congregationStatistics.organizationId, presbyteryB));
          expect(rows).toHaveLength(1);
        });
      });
    });

    // -------------------------------------------------------------------
    // Phase 2 Notes item 3 — the coupling, proven globally
    // -------------------------------------------------------------------

    describe("parent_id cache vs presby_org_affiliated() — the whole database", () => {
      it("agrees for every parented organization: the shipped UI's parent_id answer and the trigger's affiliation answer cannot differ today", async () => {
        const platform = getPlatformDb();
        const result = await platform.execute(
          sql`select o.id::text as id, o.slug::text as slug
                from organizations o
               where o.parent_id is not null
                 and not presby_org_affiliated(o.id, o.parent_id, current_date)`,
        );
        // Any row here is a congregation src/lib/presbytery.ts:143,169 and
        // src/lib/credentials.ts:522,710 would offer that drizzle/0045's
        // trigger then refuses — a user-facing error on a shipped page.
        expect(result.rows).toEqual([]);
      });

      it("keeps parent_id a pure cache: every open affiliation's parent_org_id is its subject's parent_id, and the two counts match", async () => {
        const platform = getPlatformDb();
        const drift = await platform.execute(
          sql`select o.id::text as id
                from organizations o
                join organization_affiliations a
                  on a.subject_org_id = o.id and a.effective_to is null
               where o.parent_id is distinct from a.parent_org_id`,
        );
        expect(drift.rows).toEqual([]);

        const counts = await platform.execute(
          sql`select (select count(*)::int from organizations where parent_id is not null) as parented,
                     (select count(*)::int from organization_affiliations where effective_to is null) as open_rows`,
        );
        const row = counts.rows[0] as {
          parented: number | string;
          open_rows: number | string;
        };
        expect(Number(row.parented)).toBe(Number(row.open_rows));
      });
    });
  },
);
