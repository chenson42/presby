/**
 * Owner-connection proofs for the name-history / import-staging schema layer
 * (`drizzle/0053_presby_name_history_import_staging.sql`, D13 / D14 / F33 /
 * F37 / DECISION-153 / F100-F104;
 * `docs/work-log/2026-09-26-name-history-import-staging.md`).
 *
 * WHY THIS FILE EXISTS ALONGSIDE `scripts/test-rls.sql` section 42. That suite
 * runs as `presby_app` and can only ever prove what a tenant connection sees.
 * Three of this migration's protections are specifically about the OTHER
 * connection, and each for its own reason:
 *
 *   - `import_batches_freeze` / `import_rows_freeze` exist precisely because
 *     an absent DELETE grant does not bind `neondb_owner`, which owns these
 *     tables, holds every privilege by ownership, and is the role
 *     `PLATFORM_DATABASE_URL` connects as. `BYPASSRLS` exempts a role from RLS
 *     policies, never from triggers (F44) — so on the DELETE arm the trigger's
 *     rejection can only be demonstrated here. Section 42(d) proves the grant;
 *     this proves the guard.
 *   - `organization_name_history`'s EXCLUDE and its minute-shape CHECK are
 *     unreachable from `presby_app` at all: that role holds SELECT only, so
 *     the permission check fires before any constraint is consulted
 *     (F40/F103/Ruling 1). The migration's own backfill is the table's only
 *     writer this increment, and it runs as the owner — which makes this file
 *     the only place the constraints can be exercised by the writer that can
 *     actually reach them.
 *   - The backfill invariant has a GLOBAL form `presby_app` structurally
 *     cannot count: every backfill row's recording council is its own subject,
 *     so a tenant connection sees exactly one row — its own. Section 42(k)
 *     counts the projection's slice; this counts the whole database,
 *     `authority`/`city`/`organization_id` included, which the projection
 *     deliberately does not expose.
 *
 * Same split `lifecycle.test.ts`, `publication.test.ts` and `grants.test.ts`
 * already use.
 *
 * NOTHING DURABLE IS WRITTEN. Every probe runs inside a transaction that
 * always rolls back — which matters more here than almost anywhere else in the
 * suite, because an `import_rows` row committed by accident COULD NOT BE
 * CLEANED UP: DELETE is refused on every connection, by design.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/imports.test.ts
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
const QUILLHAVEN = "44444444-4444-4444-4444-444444444444";
/** The presbytery's own stated-clerk user — a real `users` row. */
const PRESBYTERY_CLERK_USER = "e0000000-0000-0000-0000-0000000000f4";
/** The seeded import batch and its one unresolved quarantine row. */
const SEEDED_BATCH = "ad000000-0000-0000-0000-000000000001";
const SEEDED_ROW = "ae000000-0000-0000-0000-000000000001";

type Rows = { rows?: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (r as Rows).rows ?? [];
const oneInt = (r: unknown): number => Number(rowsOf(r)[0]!.n);

describe.skipIf(!hasDb)(
  "name history + import quarantine (Postgres-backed, owner connection)",
  () => {
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;

    beforeAll(async () => {
      ({ getPlatformDb } = await import("@/lib/db"));
    });

    const ROLLBACK = "__imports_test_rollback__";

    /** Owner connection, always rolled back. */
    async function inOwnerRollback(
      body: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>,
    ): Promise<void> {
      const platform = getPlatformDb();
      try {
        await platform.transaction(async (tx) => {
          await body(
            tx as unknown as { execute: (q: unknown) => Promise<unknown> },
          );
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
     * `lifecycle.test.ts` and `publication.test.ts`.
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
     * A raised error aborts the whole Postgres transaction, so a sequence of
     * probes silently collapses into one assertion and four false passes
     * without a savepoint per probe.
     */
    let savepointSeq = 0;
    async function expectDbErrorInTx(
      tx: { execute: (q: unknown) => Promise<unknown> },
      run: () => Promise<unknown>,
      pattern: RegExp,
    ): Promise<void> {
      savepointSeq += 1;
      const name = `imports_probe_${savepointSeq}`;
      await tx.execute(sql.raw(`savepoint ${name}`));
      try {
        await expectDbError(run, pattern);
      } finally {
        await tx.execute(sql.raw(`rollback to savepoint ${name}`));
      }
    }

    /**
     * `statistical_returns_guard` (drizzle/0046 section 4b, F55/DECISION-141)
     * refuses any INSERT unless this transaction-local GUC is set. A fixture
     * writing the artifact directly stands in for the sanctioned function and
     * has to make the same claim it makes.
     */
    async function armPublicationWrite(tx: {
      execute: (q: unknown) => Promise<unknown>;
    }): Promise<void> {
      await tx.execute(
        sql`select set_config('presby.publication_write_active', 'true', true)`,
      );
    }

    // -------------------------------------------------------------------
    // The quarantine is durable ON THE CONNECTION WHERE NO GRANT BINDS
    // -------------------------------------------------------------------
    describe("import_rows_freeze / import_batches_freeze on the owner path (F44)", () => {
      /**
       * THE GRANT THE TRIGGER BODY DEPENDS ON, pinned. Both deny helpers are
       * SECURITY INVOKER and both are reachable from `presby_app`, because
       * Ruling 5 kept ordinary tenant DML (minus DELETE) on these two tables.
       * With EXECUTE revoked, a tenant UPDATE is still refused and still with
       * SQLSTATE 42501 — but by a FUNCTION ACL (`permission denied for
       * function presby_deny_import_row_change`) rather than by the guard's
       * own single literal, and a gutted, no-op guard body would go unnoticed.
       * `drizzle/0046_presby_statistical_returns.sql:469-476` is the standing
       * precedent (B-M1). `scripts/test-rls.sql` section 42(i)/(i2) pin the
       * literal on the tenant connection for `import_rows`; this pins the
       * grant itself for BOTH helpers, which is the only coverage the
       * batch-side one has.
       */
      it("keeps EXECUTE on both deny helpers for presby_app and presby_platform — regression for the deny helpers' missing EXECUTE grant", async () => {
        const platform = getPlatformDb();
        const granted = rowsOf(
          await platform.execute(sql`
            select p.proname::text as proname, r.rolname::text as grantee
              from pg_proc p
              cross join lateral aclexplode(p.proacl) a
              join pg_roles r on r.oid = a.grantee
             where p.proname in ('presby_deny_import_row_change',
                                 'presby_deny_import_batch_change')
               and a.privilege_type = 'EXECUTE'
               and r.rolname in ('presby_app', 'presby_platform')
             order by 1, 2
          `),
        ).map((r) => `${String(r.proname)}/${String(r.grantee)}`);
        expect(granted).toEqual([
          "presby_deny_import_batch_change/presby_app",
          "presby_deny_import_batch_change/presby_platform",
          "presby_deny_import_row_change/presby_app",
          "presby_deny_import_row_change/presby_platform",
        ]);
      });

      it("refuses DELETE of a quarantined row — the revoke binds presby_app, the TRIGGER is what binds neondb_owner", async () => {
        await inOwnerRollback(async (tx) => {
          // The premise, stated as a fact rather than assumed: this connection
          // holds DELETE by ownership, so nothing but the trigger can refuse.
          const owns = oneInt(
            await tx.execute(sql`
              select count(*)::int as n from (select 1) s
               where has_table_privilege(current_user, 'import_rows', 'DELETE')
            `),
          );
          expect(owns).toBe(1);

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(
                sql`delete from import_rows where id = ${SEEDED_ROW}::uuid`,
              ),
            /import_rows: this change is not permitted/,
          );
        });
      });

      it("refuses DELETE of the batch that contextualizes it", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(
                sql`delete from import_batches where id = ${SEEDED_BATCH}::uuid`,
              ),
            /import_batches: this change is not permitted/,
          );
        });
      });

      it("refuses an UPDATE of raw_payload or candidates — the audit trail is what the clerk SAW", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_rows set raw_payload = '{"rewritten": true}'::jsonb
                 where id = ${SEEDED_ROW}::uuid
              `),
            /import_rows: this change is not permitted/,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_rows set candidates = '[{"forged": true}]'::jsonb
                 where id = ${SEEDED_ROW}::uuid
              `),
            /import_rows: this change is not permitted/,
          );
        });
      });

      it("refuses an UPDATE of a batch's provenance columns", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_batches set worksheet = 'rewritten'
                 where id = ${SEEDED_BATCH}::uuid
              `),
            /import_batches: this change is not permitted/,
          );
        });
      });

      it("permits an UPDATE that changes no tracked column — the freeze is per-column, not a blanket refusal", async () => {
        await inOwnerRollback(async (tx) => {
          await tx.execute(sql`
            update import_batches set created_at = created_at
             where id = ${SEEDED_BATCH}::uuid
          `);
          const n = oneInt(
            await tx.execute(
              sql`select count(*)::int as n from import_batches where id = ${SEEDED_BATCH}::uuid`,
            ),
          );
          expect(n).toBe(1);
        });
      });

      /**
       * EVERY REFUSAL IS ONE LITERAL PER TABLE (DECISION-139 / DECISION-040's
       * byte-identical discipline), so a probe cannot tell "you may not delete
       * this" from "you may not edit that" from "that row is already
       * resolved."
       */
      it("raises exactly one literal per table, whatever the cause", async () => {
        await inOwnerRollback(async (tx) => {
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from pg_proc
             where proname in ('presby_deny_import_row_change',
                               'presby_deny_import_batch_change')
          `));
          expect(n).toBe(2);
          const distinct = oneInt(await tx.execute(sql`
            select count(distinct p.proname)::int as n
              from pg_proc p
             where p.proname in ('presby_freeze_import_row', 'presby_freeze_import_batch')
               and pg_get_functiondef(p.oid) not like '%raise exception%'
          `));
          // Neither freeze function raises directly; both delegate to their
          // table's single deny helper.
          expect(distinct).toBe(2);
        });
      });
    });

    // -------------------------------------------------------------------
    // The two-path resolution discipline, driven as the owner
    // -------------------------------------------------------------------
    describe("import_rows_freeze's two permitted paths (Ruling 5c / Ruling 6.1)", () => {
      /** A fresh unresolved row, inside the caller's rolled-back transaction. */
      async function stageRow(
        tx: { execute: (q: unknown) => Promise<unknown> },
        rowIndex: number,
        reportYear: number,
      ): Promise<string> {
        const row = rowsOf(
          await tx.execute(sql`
            insert into import_rows
              (batch_id, organization_id, row_index, raw_payload,
               original_name, original_city, report_year)
            values (${SEEDED_BATCH}::uuid, ${NORTHERN_REACH}::uuid, ${rowIndex},
                    '{"Congregation Name": "Probe Chapel"}'::jsonb,
                    'Probe Chapel', 'Nowhere', ${reportYear})
            returning id
          `),
        )[0];
        return String(row!.id);
      }

      it("PATH A resolves, and may never carry the pointer in the same step", async () => {
        await inOwnerRollback(async (tx) => {
          const id = await stageRow(tx, 800, 1987);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_rows
                   set resolution_kind = 'matched_existing',
                       resolved_org_id = ${ALDER_CREEK}::uuid,
                       resolved_by     = ${PRESBYTERY_CLERK_USER}::uuid,
                       resolved_at     = now(),
                       resulting_return_id = gen_random_uuid()
                 where id = ${id}::uuid
              `),
            /import_rows: this change is not permitted/,
          );
          await tx.execute(sql`
            update import_rows
               set resolution_kind = 'matched_existing',
                   resolved_org_id = ${ALDER_CREEK}::uuid,
                   resolved_by     = ${PRESBYTERY_CLERK_USER}::uuid,
                   resolved_at     = now()
             where id = ${id}::uuid
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from import_rows
             where id = ${id}::uuid and resolution_kind = 'matched_existing'
               and resulting_return_id is null
          `));
          expect(n).toBe(1);
        });
      });

      it("refuses a second resolution of an already-resolved row — set-once, with no correction path, by choice", async () => {
        await inOwnerRollback(async (tx) => {
          const id = await stageRow(tx, 801, 1987);
          await tx.execute(sql`
            update import_rows
               set resolution_kind = 'matched_existing',
                   resolved_org_id = ${ALDER_CREEK}::uuid,
                   resolved_by     = ${PRESBYTERY_CLERK_USER}::uuid,
                   resolved_at     = now()
             where id = ${id}::uuid
          `);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_rows set resolution_kind = 'rejected'
                 where id = ${id}::uuid
              `),
            /import_rows: this change is not permitted/,
          );
        });
      });

      it("refuses a Path-B-shaped stamp on a row that is still unresolved", async () => {
        await inOwnerRollback(async (tx) => {
          const id = await stageRow(tx, 802, 1987);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update import_rows set resulting_return_id = gen_random_uuid()
                 where id = ${id}::uuid
              `),
            /import_rows: this change is not permitted/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // organization_name_history — the constraints only the owner can reach
    // -------------------------------------------------------------------
    describe("organization_name_history constraints (unreachable from presby_app, F40/F103)", () => {
      it("the partial EXCLUDE refuses a second OPEN canonical row for the same subject", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into organization_name_history
                  (organization_id, subject_org_id, name_type, name, authority,
                   minute_reference, effective_from, effective_to)
                values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 'canonical',
                        'Overlap Probe Presbyterian Church', 'recorded', 'probe',
                        null, null)
              `),
            /organization_name_history_canonical_no_overlap|conflicting key value/,
          );
        });
      });

      it("...and the WHERE clause is doing the work: a former_name over the SAME interval is accepted", async () => {
        await inOwnerRollback(async (tx) => {
          await tx.execute(sql`
            insert into organization_name_history
              (organization_id, subject_org_id, name_type, name, authority,
               minute_reference, effective_from, effective_to)
            values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 'former_name',
                    'Overlap Probe Presbyterian Church', 'recorded', 'probe',
                    null, null)
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from organization_name_history
             where subject_org_id = ${ALDER_CREEK}::uuid and name_type = 'former_name'
          `));
          expect(n).toBe(1);
        });
      });

      it("...and an ADJACENT canonical succession is accepted — a rename closes one row and opens the next", async () => {
        await inOwnerRollback(async (tx) => {
          await tx.execute(sql`
            update organization_name_history set effective_from = '2001-01-01'
             where subject_org_id = ${QUILLHAVEN}::uuid
               and name_type = 'canonical' and effective_to is null
          `);
          await tx.execute(sql`
            insert into organization_name_history
              (organization_id, subject_org_id, name_type, name, authority,
               minute_reference, effective_from, effective_to)
            values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 'canonical',
                    'Predecessor Probe Presbyterian Church', 'recorded', 'probe',
                    null, '2001-01-01')
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from organization_name_history
             where subject_org_id = ${QUILLHAVEN}::uuid and name_type = 'canonical'
          `));
          expect(n).toBe(2);
        });
      });

      it("the minute-shape CHECK refuses a minute-less claim of officiality, and permits both honest alternatives", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into organization_name_history
                  (organization_id, subject_org_id, name_type, name, authority,
                   minute_reference)
                values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 'former_name',
                        'Minute Probe Presbyterian Church', 'recorded', null)
              `),
            /organization_name_history_minute_shape/,
          );
          // Marked as an inference: accepted.
          await tx.execute(sql`
            insert into organization_name_history
              (organization_id, subject_org_id, name_type, name, authority, minute_reference)
            values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 'former_name',
                    'Minute Probe Presbyterian Church', 'backfill', null)
          `);
          // A matching aid claims nothing, so it needs nothing: accepted.
          await tx.execute(sql`
            insert into organization_name_history
              (organization_id, subject_org_id, name_type, name, authority, minute_reference)
            values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 'legacy_import_name',
                    'MT AMITY CHAPEL', 'recorded', null)
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from organization_name_history
             where subject_org_id = ${QUILLHAVEN}::uuid
               and name in ('Minute Probe Presbyterian Church', 'MT AMITY CHAPEL')
          `));
          expect(n).toBe(2);
        });
      });

      it("the empty-range loophole is closed — daterange(d, d) overlaps nothing and would slip past the EXCLUDE", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into organization_name_history
                  (organization_id, subject_org_id, name_type, name, authority,
                   minute_reference, effective_from, effective_to)
                values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 'canonical',
                        'Empty Range Probe', 'recorded', 'probe',
                        '1990-01-01', '1990-01-01')
              `),
            /organization_name_history_range_order/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // The backfill, counted across the WHOLE database
    // -------------------------------------------------------------------
    describe("the backfill invariant (Ruling 7)", () => {
      /**
       * ALWAYS TRUE, at any moment in the database's life — the partial
       * EXCLUDE is what makes a second open canonical row unwritable, so if
       * this ever fails the EXCLUDE is gone.
       */
      it("never lets an organization carry more than one OPEN canonical row", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n from (
              select subject_org_id from organization_name_history
               where name_type = 'canonical' and effective_to is null
               group by subject_org_id having count(*) > 1) d
          `),
        );
        expect(n).toBe(0);
      });

      /**
       * COVERAGE, which is a weaker claim and is deliberately asserted as
       * one. `drizzle/0053`'s backfill covers every organization that existed
       * WHEN THE MIGRATION RAN; `scripts/seed-dev.sql` section (0) covers the
       * ones the fixture creates afterwards. An organization created later
       * still — by `createOrganization()`, by another suite's fixture, by a
       * future `presby_organize_congregation()` — has NO canonical row,
       * because this increment ships no writer at all (Phase 2 Ruling 1
       * defers `presby_record_org_name()`). That gap is named, not closed, so
       * this test tolerates orgs another suite leaked in and asserts what
       * actually matters: every SEEDED organization is covered.
       */
      it("covers every organization that predates it or comes from the seed", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n
              from organizations o
             where o.id in (${sql.raw(
               [NORTHERN_REACH, ALDER_CREEK, BRAMBLEWOOD, QUILLHAVEN]
                 .map((id) => `'${id}'::uuid`)
                 .join(", "),
             )})
               and not exists (
                 select 1 from organization_name_history h
                  where h.subject_org_id = o.id
                    and h.name_type = 'canonical'
                    and h.effective_to is null)
          `),
        );
        expect(n).toBe(0);
      });

      it("attributes each backfilled row to its own subject, with no minute and no city", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n from organization_name_history
             where authority = 'backfill'
               and (organization_id <> subject_org_id
                    or minute_reference is not null
                    or city is not null
                    or name_type <> 'canonical')
          `),
        );
        // Ruling 7: self-attribution is the truthful reading (nobody minuted a
        // body's own current name), and city stays null because
        // organization_profiles.address is free text — a wrongly parsed city
        // is worse than a missing one when city is the disambiguator (F33).
        expect(n).toBe(0);
      });

      it("computes the generated normalized columns with the same function the matcher uses (F101)", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n from organization_name_history h
             where h.name_normalized
                   is distinct from presby_normalize_org_match_text(h.name)
                or h.city_normalized
                   is distinct from presby_normalize_org_match_text(h.city)
          `),
        );
        expect(n).toBe(0);
      });
    });

    // -------------------------------------------------------------------
    // statistical_returns — the two additive changes (owner-only: presby_app
    // holds SELECT on that table and nothing else)
    // -------------------------------------------------------------------
    describe("statistical_returns additive changes (Ruling 6, Ruling 6.3 as narrowed)", () => {
      /** A staging row owned by `orgId`, inside the caller's transaction. */
      async function stageRowFor(
        tx: { execute: (q: unknown) => Promise<unknown> },
        orgId: string,
        rowIndex: number,
      ): Promise<string> {
        const batch = rowsOf(
          await tx.execute(sql`
            insert into import_batches
              (organization_id, source, worksheet, form_version_key, column_map, row_count)
            values (${orgId}::uuid, 'probe batch', 'Probe Sheet', '1984',
                    '{"Congregation Name": "original_name"}'::jsonb, 1)
            returning id
          `),
        )[0];
        const row = rowsOf(
          await tx.execute(sql`
            insert into import_rows
              (batch_id, organization_id, row_index, raw_payload, report_year)
            values (${String(batch!.id)}::uuid, ${orgId}::uuid, ${rowIndex},
                    '{"Congregation Name": "Probe"}'::jsonb, 2094)
            returning id
          `),
        )[0];
        return String(row!.id);
      }

      it("accepts an imported return whose staging_row_id belongs to the SAME tenant", async () => {
        await inOwnerRollback(async (tx) => {
          await armPublicationWrite(tx);
          const stagingId = await stageRowFor(tx, NORTHERN_REACH, 810);
          await tx.execute(sql`
            insert into statistical_returns
              (organization_id, about_org_id, report_year, form_version_key,
               provenance, payload, reconciled, staging_row_id)
            values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                    'imported', '{"ending_active": 41}'::jsonb, false,
                    ${stagingId}::uuid)
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from statistical_returns
             where staging_row_id = ${stagingId}::uuid
          `));
          expect(n).toBe(1);
        });
      });

      it("refuses one whose staging_row_id belongs to a DIFFERENT tenant — RI checks bypass row security, so a plain FK here would be an oracle in F40's family", async () => {
        await inOwnerRollback(async (tx) => {
          await armPublicationWrite(tx);
          const foreignStagingId = await stageRowFor(tx, ALDER_CREEK, 811);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, staging_row_id)
                values (${NORTHERN_REACH}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'imported', '{"ending_active": 41}'::jsonb, false,
                        ${foreignStagingId}::uuid)
              `),
            /statistical_returns_staging_row_fk|violates foreign key constraint/,
          );
        });
      });

      it("refuses a submitted return carrying a staging_row_id", async () => {
        await inOwnerRollback(async (tx) => {
          await armPublicationWrite(tx);
          const stagingId = await stageRowFor(tx, ALDER_CREEK, 812);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at, staging_row_id)
                values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 41}'::jsonb, true, now(),
                        ${stagingId}::uuid)
              `),
            /statistical_returns_import_provenance_shape/,
          );
        });
      });

      /**
       * THE REGRESSION THIS CHECK NEARLY BECAME. Ruling 6.3's literal text was
       * `(staging_row_id is null and source_ref is null)`, and applying it
       * aborted the migration: `drizzle/0047:683-691`'s backfill mints a
       * SUBMITTED return carrying `source_ref = 'backfill: reconstructed from
       * congregation_statistics <id> (drizzle/0047)'`, and `0047:789-799` then
       * matches on that exact value to repair the row idempotently. The
       * offending row cannot be corrected even in principle —
       * `statistical_returns_freeze` refuses UPDATE and DELETE on every
       * connection. `source_ref` is a general provenance note, not a D13-only
       * column; only `staging_row_id` is D13-only, and only it is constrained.
       */
      it("still permits a submitted return carrying a source_ref — drizzle/0047's backfill writes one, and that row can never be edited", async () => {
        await inOwnerRollback(async (tx) => {
          await armPublicationWrite(tx);
          await tx.execute(sql`
            insert into statistical_returns
              (organization_id, about_org_id, report_year, form_version_key,
               provenance, payload, reconciled, attested_at, source_ref)
            values (${ALDER_CREEK}::uuid, ${ALDER_CREEK}::uuid, 2094, '2024',
                    'submitted', '{"ending_active": 41}'::jsonb, true, now(),
                    'backfill: reconstructed from congregation_statistics probe (drizzle/0047)')
          `);
          const n = oneInt(await tx.execute(sql`
            select count(*)::int as n from statistical_returns
             where report_year = 2094 and source_ref is not null
          `));
          expect(n).toBe(1);
        });
      });
    });

    // -------------------------------------------------------------------
    // presby_match_organization() — the bits worth pinning off the tenant path
    // -------------------------------------------------------------------
    describe("presby_match_organization()", () => {
      it("returns zero rows, never an exception, for empty / null / whitespace input", async () => {
        const platform = getPlatformDb();
        for (const arg of ["", "   ", ".", null]) {
          const n = oneInt(
            await platform.execute(
              sql`select count(*)::int as n from presby_match_organization(${arg})`,
            ),
          );
          expect(n).toBe(0);
        }
      });

      it("ranks the year rather than filtering on it (F30)", async () => {
        const platform = getPlatformDb();
        const rows = rowsOf(
          await platform.execute(sql`
            select rank, confidence from presby_match_organization(
              'Mill Creek Presbyterian Church', 'Cranesport', 2010)
          `),
        );
        // 2010 is outside Mill Creek's canonical interval. The candidate is
        // still returned — a matcher that HID it would reproduce F30's
        // failure with a clean conscience — merely downranked.
        expect(rows).toHaveLength(1);
        expect(Number(rows[0]!.rank)).toBe(2);
        expect(rows[0]!.confidence).toBe("high");
      });

      it("normalizes whitespace and trailing punctuation identically to the stored generated column (F101)", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n from presby_match_organization(
              '  Mill  Creek Presbyterian Church. ', 'Cranesport', 1987)
             where rank = 1 and confidence = 'exact'
          `),
        );
        expect(n).toBe(1);
      });

      it("never returns platform_status, slug, status or deletable_until (DECISION-047; a SURFACE rule, F100)", async () => {
        const platform = getPlatformDb();
        const n = oneInt(
          await platform.execute(sql`
            select count(*)::int as n
              from pg_proc p, unnest(p.proargnames) nm
             where p.proname = 'presby_match_organization'
               and nm in ('platform_status', 'slug', 'status', 'deletable_until')
          `),
        );
        expect(n).toBe(0);
      });

      it("finds a candidate whose name-history row belongs to another council — the view's owner privileges are what make a cross-council import possible (D19)", async () => {
        const platform = getPlatformDb();
        const rows = rowsOf(
          await platform.execute(sql`
            select organization_id, name_type, lifecycle_status, current_parent_name
              from presby_match_organization('Quill Run Presbyterian Church')
          `),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.organization_id).toBe(QUILLHAVEN);
        expect(rows[0]!.name_type).toBe("former_name");
        // The labels the adversarial pass asked for, so a clerk is not
        // choosing blind between two same-named churches.
        expect(rows[0]!.lifecycle_status).toBe("active");
        expect(String(rows[0]!.current_parent_name)).toContain("Northern Reach");
      });

      it("returns Bramblewood's CLOSED canonical name, not only the open one — the point of dating names at all", async () => {
        const platform = getPlatformDb();
        const rows = rowsOf(
          await platform.execute(sql`
            select organization_id, effective_to
              from presby_match_organization('Mill Creek Presbyterian Church')
          `),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.organization_id).toBe(BRAMBLEWOOD);
        // check:sql-date's dormant case, stated concretely: this comes back
        // from a FUNCTION, so the Neon driver hands it over as a STRING with
        // no column OID to map against. The executor pipeline's first TS
        // caller must not assume a Date.
        expect(typeof rows[0]!.effective_to).toBe("string");
      });
    });
  },
);
