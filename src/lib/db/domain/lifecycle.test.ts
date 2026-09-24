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

    const ROLLBACK = "__lifecycle_test_rollback__";

    /**
     * Run `body` inside a transaction that ALWAYS rolls back. A lifecycle
     * event cannot be deleted once committed (that is the property under
     * test), so every probe that inserts one has to unwind itself.
     */
    async function inRollback(
      body: (tx: Parameters<
        Parameters<ReturnType<typeof getPlatformDb>["transaction"]>[0]
      >[0]) => Promise<void>,
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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

    describe("organization_successions_edge_unique (F48 / DECISION-140)", () => {
      it("refuses the same (event, predecessor, successor) edge twice — one fact written twice is not two facts", async () => {
        await inRollback(async (tx) => {
          const [event] = await tx
            .insert(organizationLifecycleEvents)
            .values({
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
