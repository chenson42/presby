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

    describe("withdrawal, and what it does NOT touch", () => {
      it("removes the publication from the recipient's read-back while leaving the projection row exactly where it is", async () => {
        // THE RULE THE SPEC GIVES, stated because it is a deliberate gap and
        // not an oversight (Phase 3 Edge Cases, "Withdrawn publications and
        // the projection row"): withdrawal marks the publication EVENT only.
        // `congregation_statistics` has no withdrawn_at of its own, and this
        // pipeline does NOT act on the projection — a withdrawn publication's
        // projection row stays in the presbytery's typed keyspace, and the
        // rollup keeps returning it, until some future function explicitly
        // reacts to withdrawal. Reading the projection is the presbytery's
        // right either way; what withdrawal revokes is access to the
        // ARTIFACT.
        await inOwnerRollback(null, async (tx) => {
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
          await tx.execute(sql`
            update publications
               set withdrawn_at = now(),
                   withdrawn_by = ${userRow!.id as string}::uuid,
                   withdrawn_minute_reference = 'Session stated meeting, 2027-03-01, item 2 (withdrawal)'
             where recipient_org_id = ${NORTHERN_REACH}::uuid
          `);

          const visibleAfter = rowsOf(
            await tx.execute(
              sql`select count(*)::int as n from presby_list_published_returns_to_me()`,
            ),
          )[0];
          expect(visibleAfter!.n).toBe(0);

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
    });

    // -------------------------------------------------------------------
    // The field_spec gate, from the application connection
    // -------------------------------------------------------------------

    describe("presby_enforce_sasr_field_spec() (D8 / DECISION-118)", () => {
      it("refuses a payload key the form version does not declare", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 1, "vestry_size": 3}'::jsonb, true)
              `),
            /is not declared by form version 2024/,
          );
        });
      });

      it("refuses a negative count — the bound lives in the spec, not in a second rule that could drift from it", async () => {
        await inOrgRollback(CLERK_OF_SESSION, ALDER_CREEK, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": -1}'::jsonb, true)
              `),
            /bounds it below at 0/,
          );
        });
      });
    });
  },
);
