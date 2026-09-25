/**
 * The publication mechanism, end to end, through the paths an application
 * will actually use — `drizzle/0046_presby_statistical_returns.sql` and
 * `drizzle/0047_presby_publications.sql`.
 *
 * WHY THIS FILE EXISTS. `presby_publish_sasr_snapshot()` has NO application
 * caller (Phase 1 grepped `src/app` and `src/lib` and found it referenced only
 * in comments and migrations), and increment 5 rewrites it from the inside:
 * three rows instead of one, a recipient resolved from the affiliation history
 * instead of `organizations.parent_id`, a different return value, and a
 * supersession chain that moved tables. `scripts/test-rls.sql` exercises all
 * of that from raw `psql`, which proves the DATABASE is right. This file is
 * the only proof that the contract survives the way a route handler will hold
 * it: `withOrgContext()` on the RLS-enforced `db` connection, with the
 * membership check in front of it, and Drizzle marshalling the results.
 *
 * It also carries the two assertions `test-rls.sql` structurally cannot make,
 * the same split batch A's deviation 14 and batch B's deviation 10 record:
 * `presby_app` holds no UPDATE or DELETE on `publications` or
 * `statistical_returns`, so its rejection arrives from the permission check
 * before the freeze trigger ever fires — and withdrawal, the ONE legitimate
 * UPDATE, has no tenant-side path at all. Both are demonstrated here on
 * `PLATFORM_DATABASE_URL`, which connects as `neondb_owner` and which no
 * grant binds.
 *
 * NOTHING DURABLE IS WRITTEN. Every mutating probe runs inside a transaction
 * that always rolls back, which matters more here than usual: a filed return
 * and a publication are both frozen by trigger on every connection, so a row
 * committed by accident could not be cleaned up without disabling a global
 * trigger — the exact pattern `docs/TODO.md`'s unreliable-teardown item is
 * about. The read-back assertions use the SEEDED Alder Creek publication
 * (`scripts/seed-dev.sql`, or its `drizzle/0047` backfilled equivalent on a
 * database that was migrated rather than freshly seeded — the tests are
 * deliberately id-agnostic so both shapes pass).
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/db/domain/publication.test.ts
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

/** scripts/seed-dev.sql fixtures. */
const NORTHERN_REACH = "11111111-1111-1111-1111-111111111111";
const ALDER_CREEK = "22222222-2222-2222-2222-222222222222";
const BRAMBLEWOOD = "33333333-3333-3333-3333-333333333333";
const WESTERN_BASIN = "f7000000-0000-0000-0000-000000000001";
/** The presbytery that held Quillhaven until the 1995 boundary change. */
const SOUTHERN_FIELDS = "f6000000-0000-0000-0000-000000000001";
const QUILLHAVEN = "44444444-4444-4444-4444-444444444444";
/** The presbytery under the Coastal Plain synod — never affiliated with the above. */
const TIDEWATER = "f8000000-0000-0000-0000-000000000002";
/** Tobias Renwick — Alder Creek's stated clerk, the `statistics.publish` holder. */
const CLERK_OF_SESSION = "c0000000-0000-0000-0000-000000000002";
/** Idris Calloway — the northern reach's stated clerk, `statistics.manage`. */
const PRESBYTERY_CLERK = "c0000000-0000-0000-0000-00000000000a";
/** The year scripts/seed-dev.sql publishes for. */
const SEEDED_YEAR = 2025;

type Rows = { rows?: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (r as Rows).rows ?? [];

describe.skipIf(!hasDb)(
  "SASR publication (Postgres-backed: withOrgContext + the owner connection)",
  () => {
    let withOrgContext: typeof import("@/lib/authz").withOrgContext;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let getCongregationStatisticsRollup: typeof import("@/lib/presbytery").getCongregationStatisticsRollup;

    beforeAll(async () => {
      ({ withOrgContext } = await import("@/lib/authz"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ getCongregationStatisticsRollup } = await import("@/lib/presbytery"));
    });

    const ROLLBACK = "__publication_test_rollback__";

    /**
     * Run `body` inside a `withOrgContext()` transaction that ALWAYS rolls
     * back. The membership check, the `app.current_org_id` GUC and the RLS
     * enforcement are all real — only the commit is withheld.
     */
    async function inOrgRollback(
      personId: string,
      organizationId: string,
      body: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>,
    ): Promise<void> {
      try {
        await withOrgContext(personId, organizationId, async (tx) => {
          await body(tx as unknown as { execute: (q: unknown) => Promise<unknown> });
          throw new Error(ROLLBACK);
        });
      } catch (err) {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      }
    }

    /** The same, on the owner connection, with an org GUC set by hand. */
    async function inOwnerRollback(
      organizationId: string | null,
      body: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>,
    ): Promise<void> {
      const platform = getPlatformDb();
      try {
        await platform.transaction(async (tx) => {
          if (organizationId) {
            await tx.execute(
              sql`select set_config('app.current_org_id', ${organizationId}, true)`,
            );
          }
          await body(tx as unknown as { execute: (q: unknown) => Promise<unknown> });
          throw new Error(ROLLBACK);
        });
      } catch (err) {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      }
    }

    /**
     * Arm `presby.publication_write_active`, transaction-local, exactly as
     * `presby_publish_sasr_snapshot()` does before its own three inserts
     * (F55 / DECISION-141, 2026-09-24).
     *
     * WHY EVERY DIRECT-INSERT FIXTURE BELOW NEEDS IT. `statistical_returns`,
     * `publications` and the `published_by_congregation` branch of
     * `congregation_statistics` are one atomic act — a filed return, the
     * publication event that files it, and the recipient's projection of it —
     * and since the sixth Phase 3 loop-back all three refuse an unmarked
     * `INSERT` on every connection, this owner one included, where no grant
     * binds. A fixture writing any of them directly is standing in for the
     * sanctioned function and has to make the same claim it makes. Without
     * this, every CHECK and field-spec probe below would be refused one layer
     * earlier, by the guard, and would stop proving what it names.
     *
     * The live tenant path (`presbytery_entered` / `imported` rows through
     * `setCongregationStatistics()`) is deliberately NOT affected: the
     * projection guard carries a `WHEN (new.provenance =
     * ''published_by_congregation'')` clause, so those inserts never invoke it.
     */
    async function armPublicationWrite(tx: {
      execute: (q: unknown) => Promise<unknown>;
    }): Promise<void> {
      await tx.execute(
        sql`select set_config('presby.publication_write_active', 'true', true)`,
      );
    }

    /**
     * Arm `presby.withdrawal_write_active` (F56 / DECISION-141, 2026-09-24).
     *
     * A SEPARATE, UNSHARED FLAG from the one above, and deliberately so: the
     * future `presby_withdraw_publication()` runs in a different transaction
     * at a different time from the publish path, so there is no
     * transaction-local claim for it to piggyback on. Nothing in the database
     * arms this yet, so until that function ships the withdrawal transition is
     * unreachable ON THIS CONNECTION — the owner one, where no grant binds
     * (F44) and the trigger conjunct is the only layer — and these fixtures
     * are what prove the shape the function will depend on still works.
     *
     * NOT "on every connection", which is what this comment used to say and
     * what QA-2 disproved on 2026-09-25: a GUC is a marker any role can set,
     * so `presby_app` could arm it and write `congregation_statistics.
     * withdrawn_at` with its whole-table UPDATE grant. That half is closed by
     * a column-level grant instead (`drizzle/0047` section 10), asserted in
     * `scripts/test-rls.sql` section 35(d). Two different mechanisms for two
     * different connections; this file owns the owner-side one.
     */
    async function armWithdrawalWrite(tx: {
      execute: (q: unknown) => Promise<unknown>;
    }): Promise<void> {
      await tx.execute(
        sql`select set_config('presby.withdrawal_write_active', 'true', true)`,
      );
    }

    /**
     * Drizzle wraps a driver error in its own `Failed query: …` and hangs the
     * real one off `.cause`, so a bare `rejects.toThrow(/…/)` matches the
     * wrapper's text and never the database's. Same helper shape as
     * `lifecycle.test.ts`.
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
     * `expectDbError` inside an OPEN transaction that must keep going.
     *
     * A raised error aborts the whole Postgres transaction — every later
     * statement then fails with "current transaction is aborted" rather than
     * with the message under test, which silently turns a sequence of
     * assertions into one assertion and four false passes. A savepoint per
     * probe is what keeps a multi-step sequence (set the withdrawal, then
     * prove three separate later touches each raise) honest.
     */
    let savepointSeq = 0;
    async function expectDbErrorInTx(
      tx: { execute: (q: unknown) => Promise<unknown> },
      run: () => Promise<unknown>,
      pattern: RegExp,
    ): Promise<void> {
      savepointSeq += 1;
      const name = `pub_probe_${savepointSeq}`;
      await tx.execute(sql.raw(`savepoint ${name}`));
      try {
        await expectDbError(run, pattern);
      } finally {
        await tx.execute(sql.raw(`rollback to savepoint ${name}`));
      }
    }

    // -------------------------------------------------------------------
    // The write path, through withOrgContext() — the contract's only proof
    // -------------------------------------------------------------------

    describe("presby_publish_sasr_snapshot() through withOrgContext()", () => {
      it("writes the artifact, the event and the projection in one transaction, and returns the ARTIFACT's id", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          const published = await tx.execute(sql`
            select presby_publish_sasr_snapshot(
              2091,
              'Session stated meeting, 2092-01-11, item 4',
              p_ending_active => 214,
              p_ending_baptized => 46,
              p_avg_weekly_worship_attendance => 168,
              p_receipts_contributions => 418000.00
            ) as return_id
          `);
          const returnId = rowsOf(published)[0]?.return_id as string;
          expect(returnId).toBeTruthy();

          // 1. THE ARTIFACT — owned by the publishing congregation, so it is
          //    visible under this very tenant context.
          const artifact = rowsOf(
            await tx.execute(sql`
              select organization_id, about_org_id, report_year, form_version_key,
                     provenance, reconciled, payload
                from statistical_returns where id = ${returnId}::uuid
            `),
          )[0];
          expect(artifact).toMatchObject({
            organization_id: ALDER_CREEK,
            about_org_id: ALDER_CREEK,
            report_year: 2091,
            form_version_key: "2024",
            provenance: "submitted",
            reconciled: true,
          });
          // The payload is the as-reported record, gated by the 2024
          // field_spec — unreported fields are stripped rather than archived
          // as sixty nulls.
          expect(artifact!.payload).toMatchObject({
            ending_active: 214,
            ending_baptized: 46,
            avg_weekly_worship_attendance: 168,
          });
          expect(Object.keys(artifact!.payload as object)).not.toContain(
            "gains_certificate",
          );

          // 2. THE EVENT — addressed to the council resolved from the
          //    AFFILIATION HISTORY, never from organizations.parent_id, and
          //    never passed as a parameter (there is no such parameter).
          const event = rowsOf(
            await tx.execute(sql`
              select id, organization_id, recipient_org_id, record_class,
                     supersedes_id, minute_reference, withdrawn_at, published_at
                from publications where artifact_id = ${returnId}::uuid
            `),
          )[0];
          expect(event).toMatchObject({
            organization_id: ALDER_CREEK,
            recipient_org_id: NORTHERN_REACH,
            record_class: "statistical_return",
            supersedes_id: null,
            minute_reference: "Session stated meeting, 2092-01-11, item 4",
            withdrawn_at: null,
          });

          // 3. THE PROJECTION — at the RECIPIENT, so the congregation cannot
          //    see it under its own tenant policy; it reads through the
          //    DEFINER function, whose contract survives the column change.
          const projection = rowsOf(
            await tx.execute(sql`
              select id, organization_id, about_org_id, year, provenance,
                     publication_id, published_at, minute_reference, ending_active
                from presby_list_own_congregation_publications(2091)
            `),
          )[0];
          expect(projection).toMatchObject({
            organization_id: NORTHERN_REACH,
            about_org_id: ALDER_CREEK,
            year: 2091,
            provenance: "published_by_congregation",
            publication_id: event!.id,
            ending_active: 214,
          });

          // F39, at the source: the projection's copy of the event's facts is
          // the SAME INSTANT, not a second now(). This is the claim Ruling 5
          // made when it refused to move these two columns.
          expect(projection!.published_at).toEqual(event!.published_at);
          expect(projection!.minute_reference).toEqual(event!.minute_reference);
        });
      });

      it("chains a same-year republish through publications.supersedes_id, derived and never passed", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          const first = rowsOf(
            await tx.execute(sql`
              select presby_publish_sasr_snapshot(2092, 'First filing', p_ending_active => 200) as id
            `),
          )[0]!.id as string;
          const second = rowsOf(
            await tx.execute(sql`
              select presby_publish_sasr_snapshot(2092, 'Correction', p_ending_active => 201) as id
            `),
          )[0]!.id as string;

          const chain = rowsOf(
            await tx.execute(sql`
              select p2.supersedes_id, p1.id as first_pub, p1.supersedes_id as first_supersedes
                from publications p1, publications p2
               where p1.artifact_id = ${first}::uuid
                 and p2.artifact_id = ${second}::uuid
            `),
          )[0];
          expect(chain!.supersedes_id).toEqual(chain!.first_pub);
          // The chain points backwards only: a published event is never edited.
          expect(chain!.first_supersedes).toBeNull();
        });
      });

      it("refuses a report year predating the congregation's affiliation to its CURRENT council, with a named error rather than the opaque about-org rejection", async () => {
        // The increment-3/increment-5 collision, surfaced deliberately:
        // drizzle/0045 checks the projection as of the REPORT YEAR while D19
        // resolves the recipient as of TODAY. Quillhaven is the fixture where
        // those differ, but Alder Creek's own affiliation opened in 1962, so
        // 1950 is the same shape on the seeded congregation.
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                select presby_publish_sasr_snapshot(1950, 'n/a', p_ending_active => 10)
              `),
            /was not affiliated with its current council .* during 1950/,
          );
        });
      });

      it("range-validates at the trust boundary: a negative count is refused, not clamped", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                select presby_publish_sasr_snapshot(2093, 'n/a', p_ending_active => -5)
              `),
            /a value is out of the allowed range/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // The read path, through withOrgContext() from the RECIPIENT
    // -------------------------------------------------------------------

    describe("presby_list_published_returns_to_me() through withOrgContext()", () => {
      it("gives the recipient presbytery the as-reported artifact it cannot read any other way", async () => {
        await withOrgContext(PRESBYTERY_CLERK, NORTHERN_REACH, async (tx) => {
          // The direct read the tenant policy refuses — the artifact lives in
          // the congregation's tenant space.
          const direct = rowsOf(
            await tx.execute(sql`select count(*)::int as n from statistical_returns`),
          )[0];
          expect(direct!.n).toBe(0);

          const inbox = rowsOf(
            await tx.execute(sql`
              select publication_id, about_org_id, report_year, form_version_key,
                     payload, withdrawn_at, withdrawn_by, withdrawn_minute_reference,
                     return_id, minute_reference, published_at
                from presby_list_published_returns_to_me(${ALDER_CREEK}::uuid, ${SEEDED_YEAR})
            `),
          );
          expect(inbox).toHaveLength(1);
          expect(inbox[0]).toMatchObject({
            about_org_id: ALDER_CREEK,
            report_year: SEEDED_YEAR,
            form_version_key: "2024",
            // The whole withdrawal triple is in the signature; under the base
            // filter (withdrawn_at is null) all three are always null.
            withdrawn_at: null,
            withdrawn_by: null,
            withdrawn_minute_reference: null,
          });
          expect(inbox[0]!.payload).toHaveProperty("ending_active");
        });
      });

      it("takes no council id: naming another council's congregation and year from the wrong context still returns nothing", async () => {
        // Western Basin is a real seeded presbytery with no publications of
        // its own. There is no parameter through which it could read the
        // northern reach's inbox — the caller is the GUC.
        await inOwnerRollback(WESTERN_BASIN, async (tx) => {
          const any = rowsOf(
            await tx.execute(
              sql`select count(*)::int as n from presby_list_published_returns_to_me()`,
            ),
          )[0];
          expect(any!.n).toBe(0);
          const named = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n
                from presby_list_published_returns_to_me(${ALDER_CREEK}::uuid, ${SEEDED_YEAR})
            `),
          )[0];
          expect(named!.n).toBe(0);
        });
      });

      it("keeps the shipped projection reader working: getCongregationStatisticsRollup() still sees the published row, with published_at intact (F39)", async () => {
        // This is the reader Ruling 5 refused to break. It orders on
        // published_at and coalesces provenance with it, and it reads
        // congregation_statistics directly — no DEFINER join, which is the
        // whole reason those two columns stayed on the projection.
        const result = await getCongregationStatisticsRollup(
          PRESBYTERY_CLERK,
          NORTHERN_REACH,
          SEEDED_YEAR,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        const alder = result.data.find((r) => r.organizationId === ALDER_CREEK);
        expect(alder).toBeDefined();
        expect(alder!.provenance).toBe("published_by_congregation");
        expect(alder!.hasData).toBe(true);
        expect(alder!.publishedAt).toBeTruthy();
        expect(alder!.minuteReference).toBeTruthy();

        // A congregation with no filing for the year still appears, with no
        // data — the empty state the rollup is built around.
        const bramble = result.data.find((r) => r.organizationId === BRAMBLEWOOD);
        expect(bramble).toBeDefined();
        expect(bramble!.hasData).toBe(false);
      });
    });

    // -------------------------------------------------------------------
    // The owner connection — the half test-rls.sql structurally cannot reach
    // -------------------------------------------------------------------

    describe("immutability on the owner connection (no grant binds neondb_owner)", () => {
      it("refuses an UPDATE of a filed statistical_returns row", async () => {
        await inOwnerRollback(null, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                update statistical_returns set reconciled = false
                 where about_org_id = ${ALDER_CREEK}::uuid and report_year = ${SEEDED_YEAR}
              `),
            /a filed return is immutable/,
          );
        });
      });

      it("refuses a DELETE of a publication outright — a publication is an event", async () => {
        await inOwnerRollback(null, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                delete from publications where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /a publication is an event and is never deleted/,
          );
        });
      });

      it("refuses an UPDATE that moves any column outside the withdrawal triple", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                update publications set minute_reference = 'tampered'
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /the only permitted UPDATE is a single withdrawal/,
          );
        });
      });

      it("refuses withdrawal attribution with no withdrawal — withdrawn_by and withdrawn_minute_reference alone are not an act", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          const [userRow] = rowsOf(
            await tx.execute(sql`select id from users limit 1`),
          );
          await expectDbError(
            () =>
              tx.execute(sql`
                update publications
                   set withdrawn_by = ${userRow!.id as string}::uuid,
                       withdrawn_minute_reference = 'Presbytery 2027-03-01, item 2'
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /a withdrawal must set withdrawn_at/,
          );
        });
      });

      it("permits the ONE transition — the three withdrawal columns set together, once — and refuses every later touch", async () => {
        // The exact three-step sequence the 2026-09-24 external review asks
        // for, on the connection that can actually perform it: set once,
        // then any further UPDATE raises, then DELETE raises.
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          // Stands in for the future presby_withdraw_publication() (F56 /
          // DECISION-141): the transition is well-shaped AND sanctioned, and
          // since 2026-09-24 the trigger requires both.
          await armWithdrawalWrite(tx);
          const [userRow] = rowsOf(
            await tx.execute(sql`select id from users limit 1`),
          );
          const userId = userRow!.id as string;

          await tx.execute(sql`
            update publications
               set withdrawn_at = now(),
                   withdrawn_by = ${userId}::uuid,
                   withdrawn_minute_reference = 'Session stated meeting, 2027-03-01, item 2 (withdrawal)'
             where recipient_org_id = ${NORTHERN_REACH}::uuid
          `);
          const withdrawn = rowsOf(
            await tx.execute(sql`
              select withdrawn_by, withdrawn_minute_reference
                from publications
               where recipient_org_id = ${NORTHERN_REACH}::uuid and withdrawn_at is not null
            `),
          );
          expect(withdrawn).toHaveLength(1);
          // The act is ATTRIBUTED, which is the whole point of the triple.
          expect(withdrawn[0]!.withdrawn_by).toBe(userId);
          expect(withdrawn[0]!.withdrawn_minute_reference).toMatch(/withdrawal/);

          // A second UPDATE touching any other column raises...
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update publications set minute_reference = 'tampered'
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /the only permitted UPDATE is a single withdrawal/,
          );
          // ...and so does any attempt to reverse, re-date or re-minute it.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update publications set withdrawn_at = null, withdrawn_by = null,
                                        withdrawn_minute_reference = null
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /neither reversed, re-dated nor re-minuted/,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update publications
                   set withdrawn_minute_reference = 'a different minute'
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /neither reversed, re-dated nor re-minuted/,
          );
          // ...and DELETE still raises on a withdrawn row.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                delete from publications where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /a publication is an event and is never deleted/,
          );
        });
      });
    });

    describe("withdrawal — Option A throughout (F52 / DECISION-140)", () => {
      it("keeps the withdrawn publication in the recipient's read-back, carrying the whole withdrawal triple", async () => {
        // REVERSED 2026-09-24 (F52 / DECISION-140). This test previously
        // asserted `visibleAfter === 0`: the read function filtered
        // `withdrawn_at is null` (Option B — withdrawal REVOKES the
        // recipient's read) while the projection row was left untouched
        // (Option A — the recipient RETAINS what it received). Half of each
        // is the one answer that is certainly wrong, and it is what this test
        // was pinning.
        //
        // Option A throughout: the recipient keeps the artifact, marked. A
        // withdrawn return still comes back, with withdrawn_at/by/
        // minute_reference so the recipient can see WHO withdrew it and under
        // which minute, and every consumer computing CURRENT totals filters
        // `withdrawn_at is null` itself. Same permanence rule that voids a
        // roll action rather than deleting it, and G-3.0107's "a ceased
        // council's records become the property of the next higher council".
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          const before = rowsOf(
            await tx.execute(sql`
              select set_config('app.current_org_id', ${NORTHERN_REACH}, true) as _;
            `),
          );
          expect(before).toBeDefined();

          const visibleBefore = rowsOf(
            await tx.execute(
              sql`select count(*)::int as n from presby_list_published_returns_to_me()`,
            ),
          )[0];
          expect(visibleBefore!.n).toBe(1);

          const projectionBefore = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from congregation_statistics
               where organization_id = ${NORTHERN_REACH}::uuid
                 and about_org_id = ${ALDER_CREEK}::uuid
                 and provenance = 'published_by_congregation'
            `),
          )[0];
          expect(projectionBefore!.n).toBe(1);

          const [userRow] = rowsOf(
            await tx.execute(sql`select id from users limit 1`),
          );
          // The sanctioned-writer marker the future presby_withdraw_
          // publication() sets (F56 / DECISION-141).
          await armWithdrawalWrite(tx);
          await tx.execute(sql`
            update publications
               set withdrawn_at = now(),
                   withdrawn_by = ${userRow!.id as string}::uuid,
                   withdrawn_minute_reference = 'Session stated meeting, 2027-03-01, item 2 (withdrawal)'
             where recipient_org_id = ${NORTHERN_REACH}::uuid
          `);

          const after = rowsOf(
            await tx.execute(sql`
              select withdrawn_at, withdrawn_by, withdrawn_minute_reference
                from presby_list_published_returns_to_me()
            `),
          );
          expect(after).toHaveLength(1);
          expect(after[0]!.withdrawn_at).not.toBeNull();
          expect(after[0]!.withdrawn_by).not.toBeNull();
          expect(after[0]!.withdrawn_minute_reference).toBe(
            "Session stated meeting, 2027-03-01, item 2 (withdrawal)",
          );

          const projectionAfter = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from congregation_statistics
               where organization_id = ${NORTHERN_REACH}::uuid
                 and about_org_id = ${ALDER_CREEK}::uuid
                 and provenance = 'published_by_congregation'
                 and publication_id is not null
            `),
          )[0];
          expect(projectionAfter!.n).toBe(1);
        });
      });

      it("lets the projection row be MARKED withdrawn, exactly once, with nothing else on the row moving", async () => {
        // The projection's half of Option A. There is no withdraw FUNCTION in
        // this pipeline — the future `presby_withdraw_publication()` sets the
        // publication's triple and this column together in one transaction —
        // so what is proven here is that both freeze triggers permit exactly
        // that pair of transitions and nothing else, which is why they are
        // written before the writer exists.
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          // Both halves of the pair are gated on the same marker (F56 /
          // DECISION-141), so the projection's half arms it here too.
          await armWithdrawalWrite(tx);
          const [row] = rowsOf(
            await tx.execute(sql`
              select id from congregation_statistics
               where organization_id = ${NORTHERN_REACH}::uuid
                 and about_org_id = ${ALDER_CREEK}::uuid
                 and provenance = 'published_by_congregation'
               limit 1
            `),
          );
          const csId = row!.id as string;

          // Any OTHER change to a published row is still refused, withdrawal
          // or not — the guard is one permitted transition, not an open door.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update congregation_statistics set ending_active = 1 where id = ${csId}::uuid
              `),
            /published rows are immutable/,
          );

          // ...including withdrawal PLUS something else in the same statement.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update congregation_statistics
                   set withdrawn_at = now(), ending_active = 1
                 where id = ${csId}::uuid
              `),
            /published rows are immutable/,
          );

          // The one permitted transition.
          await tx.execute(sql`
            update congregation_statistics set withdrawn_at = now() where id = ${csId}::uuid
          `);
          const marked = rowsOf(
            await tx.execute(sql`
              select withdrawn_at from congregation_statistics where id = ${csId}::uuid
            `),
          )[0];
          expect(marked!.withdrawn_at).not.toBeNull();

          // ...and only once. A withdrawal is itself an act.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update congregation_statistics set withdrawn_at = now() where id = ${csId}::uuid
              `),
            /published rows are immutable/,
          );

          // DELETE is refused as it always was.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(
                sql`delete from congregation_statistics where id = ${csId}::uuid`,
              ),
            /published rows are immutable/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // The field_spec gate, from the application connection
    // -------------------------------------------------------------------

    /**
     * MOVED HERE FROM `scripts/test-rls.sql` AND FROM `inOrgRollback`,
     * 2026-09-24 (F50 / DECISION-140). Both this block and section 34(f) of
     * the RLS suite used to insert into `statistical_returns` from the TENANT
     * connection. `INSERT` is now revoked from `presby_app` and
     * `presby_platform`, so every one of these probes would be refused by the
     * permission check before the trigger or CHECK under test could fire —
     * proving the revoke, not the gate.
     *
     * On `PLATFORM_DATABASE_URL` (`neondb_owner`) the grant is irrelevant and
     * the trigger is the only thing standing, which is precisely the property
     * F44 says has to be proven separately. Nothing durable is written: every
     * probe is inside a transaction that always rolls back.
     */
    describe("presby_enforce_sasr_field_spec() — the closed allow-list, on the owner path (D8 / DECISION-118)", () => {
      it("accepts a payload whose keys, types and bounds all match the 2024 spec", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await tx.execute(sql`
            insert into statistical_returns
              (organization_id, about_org_id, report_year, form_version_key,
               provenance, payload, reconciled, attested_at)
            values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                    'submitted',
                    '{"ending_active": 214, "receipts_contributions": 1234.50}'::jsonb,
                    true, now())
          `);
          const n = rowsOf(
            await tx.execute(
              sql`select count(*)::int as n from statistical_returns where report_year = 2094`,
            ),
          )[0];
          expect(n!.n).toBe(1);
        });
      });

      it("refuses a payload key the form version does not declare", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 1, "vestry_size": 3}'::jsonb, true, now())
              `),
            /is not declared by form version 2024/,
          );
        });
      });

      it("refuses a value of the wrong JSON type", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": "two hundred"}'::jsonb, true, now())
              `),
            /statistical_returns/,
          );
        });
      });

      it("refuses a negative count — the bound lives in the spec, not in a second rule that could drift from it", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": -1}'::jsonb, true, now())
              `),
            /bounds it below at 0/,
          );
        });
      });

      it("refuses a value above the declared ceiling", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 99999999}'::jsonb, true, now())
              `),
            /statistical_returns/,
          );
        });
      });

      it("refuses a submitted return ABOUT another congregation", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${BRAMBLEWOOD}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 10}'::jsonb, true, now())
              `),
            /statistical_returns_submitted_is_self/,
          );
        });
      });

      it("treats a PLACEHOLDER generation as fail-closed: an empty payload is fine, any key is not", async () => {
        await inOwnerRollback(SOUTHERN_FIELDS, async (tx) => {
          await armPublicationWrite(tx);
          await tx.execute(sql`
            insert into statistical_returns
              (organization_id, about_org_id, report_year, form_version_key,
               provenance, payload, reconciled)
            values (${SOUTHERN_FIELDS}::uuid, ${QUILLHAVEN}::uuid, 1990, '1984',
                    'imported', '{}'::jsonb, false)
          `);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${SOUTHERN_FIELDS}::uuid, ${QUILLHAVEN}::uuid, 1991, '1984',
                        'imported', '{"ending_active": 100}'::jsonb, false)
              `),
            /is not declared by form version 1984/,
          );
        });
      });
    });

    /**
     * MOVED HERE for the same reason (section 34(g) of `scripts/test-rls.sql`,
     * F50). The imported-row about-org rule (R3.14) is the one cross-org shape
     * `statistical_returns` has, and it must resolve to the council that
     * ACTUALLY received the return, not to whoever holds the congregation
     * today.
     */
    describe("the imported-row about-org rule on the owner path (R3.14)", () => {
      it("lets the council that received a 1990 return archive it, and refuses one for a year it did not hold the congregation", async () => {
        await inOwnerRollback(SOUTHERN_FIELDS, async (tx) => {
          await armPublicationWrite(tx);
          await tx.execute(sql`
            insert into statistical_returns
              (organization_id, about_org_id, report_year, form_version_key,
               provenance, payload, reconciled)
            values (${SOUTHERN_FIELDS}::uuid, ${QUILLHAVEN}::uuid, 1990, '1984',
                    'imported', '{}'::jsonb, false)
          `);
          const n = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from statistical_returns
               where about_org_id = ${QUILLHAVEN}::uuid and report_year = 1990
            `),
          )[0];
          expect(n!.n).toBe(1);

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${SOUTHERN_FIELDS}::uuid, ${QUILLHAVEN}::uuid, 2020, '2024',
                        'imported', '{}'::jsonb, false)
              `),
            /statistical_returns/,
          );

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${SOUTHERN_FIELDS}::uuid, ${TIDEWATER}::uuid, 2020, '2024',
                        'imported', '{}'::jsonb, false)
              `),
            /statistical_returns/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // F50 / F51 / F53 — the hardening pass, on the connection that matters
    // -------------------------------------------------------------------

    describe("statistical_returns_provenance_shape (F50 / DECISION-140)", () => {
      it("refuses a SUBMITTED return that claims no reconciliation", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2095, '2024',
                        'submitted', '{"ending_active": 1}'::jsonb, false, now())
              `),
            /statistical_returns_provenance_shape/,
          );
        });
      });

      it("refuses a SUBMITTED return with no attestation instant at all", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2095, '2024',
                        'submitted', '{"ending_active": 1}'::jsonb, true)
              `),
            /statistical_returns_provenance_shape/,
          );
        });
      });

      it("refuses an IMPORTED return marked reconciled — a 1987 row that does not balance is a fact about 1987", async () => {
        await inOwnerRollback(SOUTHERN_FIELDS, async (tx) => {
          await armPublicationWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${SOUTHERN_FIELDS}::uuid, ${QUILLHAVEN}::uuid, 1990, '1984',
                        'imported', '{}'::jsonb, true)
              `),
            /statistical_returns_provenance_shape/,
          );
        });
      });

      it("still lets presby_publish_sasr_snapshot() write its submitted row — the CHECK does not outlaw the only live writer", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          const published = rowsOf(
            await tx.execute(sql`
              select presby_publish_sasr_snapshot(
                2096, 'Session stated meeting, fixture, item 3', p_ending_active => 7
              ) as return_id
            `),
          )[0];
          expect(published!.return_id).toBeTruthy();
        });
      });
    });

    // -------------------------------------------------------------------
    // The 2026-09-24 round-two hardening (F55 / DECISION-141): the return ->
    // publication -> projection chain is ONE sanctioned act, and creation is
    // guarded as strongly as mutation. The grants revoked at F50/F51 bind
    // presby_app and presby_platform; they bind nothing on THIS connection
    // (F44), and the CHECK constraints prove a row's SHAPE, never its
    // PROVENANCE. These probes are the reviewer's "false submitted artifact"
    // repro at each of the three tables.
    // -------------------------------------------------------------------

    describe("the publication-chain creation guard (F55 / DECISION-141)", () => {
      it("refuses a fabricated statistical_returns row on the owner connection — every CHECK satisfied, no publish in progress", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 212}'::jsonb, true, now())
              `),
            /publication chain: this row may only be written by a sanctioned publication function/,
          );
        });
      });

      it("refuses a fabricated publications row on the owner connection — the event is an act, not a row anyone may write", async () => {
        await inOwnerRollback(null, async (tx) => {
          const [ret] = rowsOf(
            await tx.execute(sql`
              select id, organization_id from statistical_returns limit 1
            `),
          );
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id,
                   minute_reference)
                values (${ret!.organization_id as string}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid,
                        'Fabricated session minute')
              `),
            /publication chain: this row may only be written by a sanctioned publication function/,
          );
        });
      });

      it("refuses a fabricated published_by_congregation projection — the repro stopped one step earlier than the other two", async () => {
        await inOwnerRollback(null, async (tx) => {
          const [pub] = rowsOf(
            await tx.execute(sql`
              select id, organization_id, recipient_org_id from publications
               where recipient_org_id = ${NORTHERN_REACH}::uuid limit 1
            `),
          );
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into congregation_statistics
                  (organization_id, about_org_id, year, provenance, publication_id,
                   published_at, minute_reference, ending_active)
                values (${pub!.recipient_org_id as string}::uuid,
                        ${pub!.organization_id as string}::uuid,
                        2094, 'published_by_congregation', ${pub!.id as string}::uuid,
                        now(), 'Fabricated session minute', 999)
              `),
            /publication chain: this row may only be written by a sanctioned publication function/,
          );
        });
      });

      it("leaves the LIVE tenant path alone: a presbytery_entered projection inserts with no marker at all (the WHEN clause)", async () => {
        // The regression that matters most in this loop-back. A table-wide
        // guard on congregation_statistics — which is what the review's prose
        // implied — would have broken setCongregationStatisticsAction, a
        // shipped, member-facing write path. The WHEN clause means the trigger
        // is never invoked for these two provenances at all.
        await inOwnerRollback(NORTHERN_REACH, async (tx) => {
          await tx.execute(sql`
            insert into congregation_statistics
              (organization_id, about_org_id, year, provenance, ending_active)
            values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 2094,
                    'presbytery_entered', 41)
          `);
          await tx.execute(sql`
            insert into congregation_statistics
              (organization_id, about_org_id, year, provenance, ending_active)
            values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 2095,
                    'imported', 42)
          `);
          const rows = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from congregation_statistics
               where organization_id = ${NORTHERN_REACH}::uuid
                 and about_org_id = ${ALDER_CREEK}::uuid
                 and year in (2094, 2095)
            `),
          );
          expect(rows[0]!.n).toBe(2);
        });
      });

      it("accepts the same three rows when the marker IS set — the guard gates the path, not the row", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          await armPublicationWrite(tx);
          const [ret] = rowsOf(
            await tx.execute(sql`
              insert into statistical_returns
                (organization_id, about_org_id, report_year, form_version_key,
                 provenance, payload, reconciled, attested_at)
              values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2093, '2024',
                      'submitted', '{"ending_active": 212}'::jsonb, true, now())
              returning id
            `),
          );
          const [pub] = rowsOf(
            await tx.execute(sql`
              insert into publications
                (organization_id, recipient_org_id, record_class, artifact_id,
                 minute_reference)
              values (${ALDER_CREEK}::uuid, ${NORTHERN_REACH}::uuid,
                      'statistical_return', ${ret!.id as string}::uuid,
                      'Fixture: an armed publish')
              returning id
            `),
          );
          expect(pub!.id).toBeTruthy();

          // The projection belongs to the RECIPIENT presbytery even though
          // this transaction is in the congregation's context: the owner
          // connection is not filtered by the policy, which is exactly the
          // shape presby_publish_sasr_snapshot() relies on when it writes the
          // recipient's row from the publisher's context.
          await tx.execute(sql`
            insert into congregation_statistics
              (organization_id, about_org_id, year, provenance, publication_id,
               published_at, minute_reference, ending_active)
            values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 2093,
                    'published_by_congregation', ${pub!.id as string}::uuid,
                    now(), 'Fixture: an armed publish', 212)
          `);
          const rows = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from congregation_statistics
               where publication_id = ${pub!.id as string}::uuid
            `),
          );
          expect(rows[0]!.n).toBe(1);
        });
      });

      it("arms the marker inside presby_publish_sasr_snapshot() itself, and all three guards are live — the catalog shape", async () => {
        const platform = getPlatformDb();
        const triggers = rowsOf(
          await platform.execute(sql`
            select c.relname::text as relname, t.tgname::text as tgname,
                   p.proname::text as proname,
                   pg_get_triggerdef(t.oid) like '%published_by_congregation%' as scoped,
                   t.tgenabled::text as enabled
              from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
              join pg_proc p on p.oid = t.tgfoid
             where p.proname = 'presby_guard_publication_write'
             order by 1, 2
          `),
        );
        expect(
          triggers.map(
            (r) => `${r.relname}.${r.tgname} scoped=${r.scoped} enabled=${r.enabled}`,
          ),
        ).toEqual([
          "congregation_statistics.congregation_statistics_publication_guard scoped=true enabled=O",
          "publications.publications_guard scoped=false enabled=O",
          "statistical_returns.statistical_returns_guard scoped=false enabled=O",
        ]);

        const armed = rowsOf(
          await platform.execute(sql`
            select count(*)::int as n from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname = 'presby_publish_sasr_snapshot'
              and p.prosecdef
              and pg_get_functiondef(p.oid)
                  like '%set_config(''presby.publication_write_active'', ''true'', true)%'
          `),
        );
        expect(armed[0]!.n).toBe(1);
      });
    });

    describe("publications_withdrawal_shape, corrected (F51 / DECISION-140)", () => {
      it("refuses a withdrawn_at with no withdrawer and no minute — the exact row the previous predicate allowed", async () => {
        // FAILING-FIRST RELATIVE TO THE SHIPPED SCHEMA. The old predicate was
        // `withdrawn_at is not null or (withdrawn_by is null and
        // withdrawn_minute_reference is null)`, which is TRUE whenever
        // withdrawn_at is set, whatever the other two hold. This row passed.
        //
        // SPLIT IN TWO 2026-09-24 (F56 / DECISION-141), and the split is the
        // point. This probe previously ran with no withdrawal marker set and
        // matched `/a withdrawal must set withdrawn_at|publications_withdrawal
        // _shape|withdrawn_by/`. Once the sanctioned-writer conjunct landed,
        // the unarmed statement is refused by the GUARD, one layer earlier —
        // and the old regex is loose enough that it would have gone on
        // passing while proving something else entirely. So: this half ARMS
        // the marker, which is the only way the shape CHECK is still the
        // thing under test, and the half below proves the guard on its own.
        await inOwnerRollback(null, async (tx) => {
          await armWithdrawalWrite(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                update publications set withdrawn_at = now()
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /publications_withdrawal_shape/,
          );
        });
      });

      it("refuses the SAME withdrawal with no sanctioned withdrawal writer, one layer earlier and with a different message (F56)", async () => {
        await inOwnerRollback(null, async (tx) => {
          const [userRow] = rowsOf(
            await tx.execute(sql`select id from users limit 1`),
          );
          // A perfectly well-shaped withdrawal triple — nothing here trips
          // publications_withdrawal_shape, the freeze's column comparison, or
          // the already-withdrawn check. The only thing wrong with it is that
          // no sanctioned withdrawal function performed it, and until
          // presby_withdraw_publication() exists, none can.
          await expectDbError(
            () =>
              tx.execute(sql`
                update publications
                   set withdrawn_at = now(),
                       withdrawn_by = ${userRow!.id as string}::uuid,
                       withdrawn_minute_reference = 'Fabricated withdrawal minute'
                 where recipient_org_id = ${NORTHERN_REACH}::uuid
              `),
            /a withdrawal is an authorized act and may only be recorded by the sanctioned withdrawal function/,
          );
        });
      });

      it("refuses the PROJECTION half of the pair with the marker unarmed, so neither half is independently reachable (F56)", async () => {
        await inOwnerRollback(null, async (tx) => {
          const [row] = rowsOf(
            await tx.execute(sql`
              select id from congregation_statistics
               where organization_id = ${NORTHERN_REACH}::uuid
                 and about_org_id = ${ALDER_CREEK}::uuid
                 and provenance = 'published_by_congregation'
               limit 1
            `),
          );
          // The transition that WAS permitted before this loop-back:
          // withdrawn_at null -> not null with nothing else moving. It is the
          // legitimate shape, which is exactly why the marker is what has to
          // refuse it — a publication withdrawn without its projection, or the
          // reverse, is a recipient silently disagreeing with the act.
          await expectDbError(
            () =>
              tx.execute(sql`
                update congregation_statistics set withdrawn_at = now()
                 where id = ${row!.id as string}::uuid
              `),
            /published rows are immutable/,
          );
        });
      });

      it("refuses a withdrawer with no withdrawal, on a direct owner INSERT", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armPublicationWrite(tx);
          const [ret] = rowsOf(
            await tx.execute(sql`
              select id, organization_id from statistical_returns limit 1
            `),
          );
          const [userRow] = rowsOf(
            await tx.execute(sql`select id from users limit 1`),
          );
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id,
                   withdrawn_by)
                values (${ret!.organization_id as string}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid,
                        ${userRow!.id as string}::uuid)
              `),
            /publications_withdrawal_shape/,
          );
        });
      });
    });

    describe("publications_supersession — supersession is a CHAIN (F51 / DECISION-140)", () => {
      /**
       * Every probe publishes twice through the DEFINER function and then
       * forges the second publication's `supersedes_id` on the owner
       * connection, which is the only way to reach the trigger: the function
       * DERIVES `supersedes_id` and never accepts it.
       */
      async function seedTwo(
        tx: { execute: (q: unknown) => Promise<unknown> },
      ): Promise<{ first: string; second: string }> {
        await tx.execute(
          sql`select set_config('app.current_org_id', ${ALDER_CREEK}, true)`,
        );
        await tx.execute(
          sql`select presby_publish_sasr_snapshot(2097, 'm1', p_ending_active => 1)`,
        );
        await tx.execute(
          sql`select presby_publish_sasr_snapshot(2098, 'm2', p_ending_active => 2)`,
        );
        const rows = rowsOf(
          await tx.execute(sql`
            select p.id, r.report_year
              from publications p join statistical_returns r on r.id = p.artifact_id
             where p.organization_id = ${ALDER_CREEK}::uuid
               and r.report_year in (2097, 2098)
             order by r.report_year
          `),
        );
        return { first: rows[0]!.id as string, second: rows[1]!.id as string };
      }

      it("refuses a predecessor from a different report year", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armPublicationWrite(tx);
          const { first } = await seedTwo(tx);
          const [ret] = rowsOf(
            await tx.execute(sql`
              select r.id from statistical_returns r
               where r.organization_id = ${ALDER_CREEK}::uuid and r.report_year = 2098
            `),
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id, supersedes_id)
                values (${ALDER_CREEK}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid, ${first}::uuid)
              `),
            /supersedes_id must name this council's own earlier publication/,
          );
        });
      });

      it("refuses a predecessor belonging to another congregation, and one addressed to another recipient", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armPublicationWrite(tx);
          const { first } = await seedTwo(tx);
          const [ret] = rowsOf(
            await tx.execute(sql`
              select r.id from statistical_returns r
               where r.organization_id = ${ALDER_CREEK}::uuid and r.report_year = 2097
            `),
          );
          // Different organization_id on the new row.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id, supersedes_id)
                values (${BRAMBLEWOOD}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid, ${first}::uuid)
              `),
            /supersedes_id must name this council's own earlier publication|publications_artifact_fk/,
          );
          // Different recipient_org_id on the new row.
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id, supersedes_id)
                values (${ALDER_CREEK}::uuid, ${WESTERN_BASIN}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid, ${first}::uuid)
              `),
            /supersedes_id must name this council's own earlier publication/,
          );
          // A predecessor that does not exist at all — same literal, so the
          // trigger is not a cross-tenant existence oracle (F40).
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id, supersedes_id)
                values (${ALDER_CREEK}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid,
                        '00000000-0000-0000-0000-0000000000ff'::uuid)
              `),
            /supersedes_id must name this council's own earlier publication/,
          );
        });
      });

      it("still chains a legitimate same-year republish, and forbids a FORK off the same predecessor", async () => {
        await inOwnerRollback(null, async (tx) => {
          await armPublicationWrite(tx);
          await tx.execute(
            sql`select set_config('app.current_org_id', ${ALDER_CREEK}, true)`,
          );
          await tx.execute(
            sql`select presby_publish_sasr_snapshot(2099, 'm1', p_ending_active => 1)`,
          );
          await tx.execute(
            sql`select presby_publish_sasr_snapshot(2099, 'm2', p_ending_active => 2)`,
          );
          const chained = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n
                from publications p join statistical_returns r on r.id = p.artifact_id
               where p.organization_id = ${ALDER_CREEK}::uuid
                 and r.report_year = 2099 and p.supersedes_id is not null
            `),
          )[0];
          expect(chained!.n).toBe(1);

          const [predecessor] = rowsOf(
            await tx.execute(sql`
              select p.supersedes_id as id
                from publications p join statistical_returns r on r.id = p.artifact_id
               where p.organization_id = ${ALDER_CREEK}::uuid
                 and r.report_year = 2099 and p.supersedes_id is not null
            `),
          );
          const [ret] = rowsOf(
            await tx.execute(sql`
              select r.id from statistical_returns r
               where r.organization_id = ${ALDER_CREEK}::uuid and r.report_year = 2099
               order by r.created_at desc limit 1
            `),
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id, supersedes_id)
                values (${ALDER_CREEK}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', ${ret!.id as string}::uuid,
                        ${predecessor!.id as string}::uuid)
              `),
            /publications_supersedes_once_idx/,
          );
        });
      });
    });

    describe("the projection's RECIPIENT end (F51 / DECISION-140)", () => {
      it("refuses a projection row whose recipient is not the publication's recipient", async () => {
        // The forgery has to keep the SOURCE end honest to isolate the new
        // constraint: `about_org_id` must still equal the publication's
        // `organization_id` (or the older source-end FK fires first) and the
        // projection's own `organization_id` must be a council the about-org
        // WAS affiliated with in that year (or drizzle/0045's about-org
        // trigger fires first). So the mismatch is planted on the
        // publication: Alder Creek publishes to the WESTERN BASIN, and the
        // NORTHERN REACH then claims the projection.
        await inOwnerRollback(null, async (tx) => {
          await armPublicationWrite(tx);
          const [ret] = rowsOf(
            await tx.execute(sql`
              select id from statistical_returns
               where organization_id = ${ALDER_CREEK}::uuid limit 1
            `),
          );
          const [forged] = rowsOf(
            await tx.execute(sql`
              insert into publications
                (organization_id, recipient_org_id, record_class, artifact_id, minute_reference)
              values (${ALDER_CREEK}::uuid, ${WESTERN_BASIN}::uuid,
                      'statistical_return', ${ret!.id as string}::uuid, 'fixture')
              returning id
            `),
          );
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into congregation_statistics
                  (organization_id, about_org_id, year, provenance, publication_id,
                   published_at, minute_reference)
                values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid,
                        2093, 'published_by_congregation', ${forged!.id as string}::uuid,
                        now(), 'forged')
              `),
            /congregation_statistics_publication_recipient_fk/,
          );
        });
      });
    });

    describe("sasr_form_versions.field_spec is frozen once a return leans on it (F53 / DECISION-140)", () => {
      it("refuses the edit under ANOTHER tenant's context — which is what proves the DEFINER is load-bearing", async () => {
        // An INVOKER-mode version of the trigger would see zero referencing
        // `statistical_returns` rows from Bramblewood's context (the seeded
        // 2024 return belongs to Alder Creek, and the table is FORCE RLS) and
        // would let this edit through, silently redefining the spec through
        // which Alder Creek's frozen payload is read. That is the F26 shape
        // this pipeline has hit twice before.
        await inOwnerRollback(BRAMBLEWOOD, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                update sasr_form_versions
                   set field_spec = '{"fields": {}}'::jsonb
                 where key = '2024'
              `),
            /field_spec is frozen/,
          );
        });
      });

      it("leaves an UNUSED placeholder generation freely editable", async () => {
        await inOwnerRollback(null, async (tx) => {
          await tx.execute(sql`
            update sasr_form_versions
               set field_spec = '{"fields": {"ending_active": {"type": "integer", "min": 0, "max": 100}}}'::jsonb
             where key = '2022'
          `);
          const row = rowsOf(
            await tx.execute(
              sql`select field_spec from sasr_form_versions where key = '2022'`,
            ),
          )[0];
          expect(JSON.stringify(row!.field_spec)).toContain("ending_active");
        });
      });

      it("permits a byte-identical no-op write, so the migration's own upsert still converges on re-apply", async () => {
        await inOwnerRollback(null, async (tx) => {
          const before = rowsOf(
            await tx.execute(
              sql`select field_spec from sasr_form_versions where key = '2024'`,
            ),
          )[0];
          await tx.execute(sql`
            update sasr_form_versions
               set field_spec = ${JSON.stringify(before!.field_spec)}::jsonb
             where key = '2024'
          `);
        });
      });
    });
  },
);
