/**
 * Submission grants — the OWNER-CONNECTION half of the credential mechanism
 * (`drizzle/0049_presby_submission_grants.sql`, D16 / DECISION-147 / F80;
 * `docs/work-log/2026-09-25-submission-grants.md`).
 *
 * WHY THIS FILE EXISTS, and what it proves that `scripts/test-rls.sql` section
 * 40 structurally cannot. `presby_app` holds `select`, `insert` and a
 * COLUMN-LEVEL `update (revoked_at)` on `statistics_submission_grants` and
 * nothing else, so every probe of the claim and the stamp is refused there by
 * the PERMISSION CHECK before `presby_freeze_statistics_submission_grant()` is
 * ever consulted — which proves the grant, not the guard. This file runs on
 * `PLATFORM_DATABASE_URL`, which connects as `neondb_owner`: a role no grant
 * binds and which `BYPASSRLS` exempts from every policy, so the trigger is the
 * only thing standing (F44). Reasoning of the shape "X cannot happen because
 * the grant forbids it" is FALSE on this connection, and that is precisely the
 * connection `getPlatformDb()` hands to platform-shell code.
 *
 * It also carries the two things no tenant connection can stage at all:
 *
 *   - the STALE-CREDENTIAL half of F80 (a grant whose issuing presbytery no
 *     longer holds the congregation). Creating one requires the issuance
 *     trigger to be absent, because that trigger refuses any about-org not
 *     affiliated TODAY; and staging it by transferring the congregation
 *     afterwards requires the two presbyteries' COMMON SUPERIOR as actor,
 *     which the fixture's rootless northern reach does not have.
 *   - the DISARMED direct-INSERT refusal on the publish chain, still holding
 *     after `drizzle/0049` moved the arming site into the extracted
 *     `presby_write_return_publication_chain()`.
 *
 * NOTHING DURABLE IS WRITTEN. Every probe runs inside a transaction that
 * always rolls back — which matters more than usual here, because a filed
 * return and a publication are frozen by trigger on every connection, so a row
 * committed by accident could not be cleaned up without disabling a global
 * trigger.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/grants.test.ts
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
/** D9: the unmanaged congregation — the population a grant exists for. */
const QUILLHAVEN = "44444444-4444-4444-4444-444444444444";
/** The presbytery that held Quillhaven until the 1995 boundary change. */
const SOUTHERN_FIELDS = "f6000000-0000-0000-0000-000000000001";
/** The presbytery's own stated-clerk user — a real `users` row for issued_by. */
const PRESBYTERY_CLERK_USER = "e0000000-0000-0000-0000-0000000000f4";

type Rows = { rows?: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (r as Rows).rows ?? [];

describe.skipIf(!hasDb)(
  "statistics_submission_grants (Postgres-backed: the owner connection, where only triggers bind)",
  () => {
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;

    beforeAll(async () => {
      ({ getPlatformDb } = await import("@/lib/db"));
    });

    const ROLLBACK = "__grants_test_rollback__";

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
     * wrapper and never the database. Same helper shape as
     * `publication.test.ts` and `lifecycle.test.ts`.
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
     * probes without savepoints silently collapses into one real assertion and
     * N false passes.
     */
    let savepointSeq = 0;
    async function expectDbErrorInTx(
      tx: { execute: (q: unknown) => Promise<unknown> },
      run: () => Promise<unknown>,
      pattern: RegExp,
    ): Promise<void> {
      savepointSeq += 1;
      const name = `grant_probe_${savepointSeq}`;
      await tx.execute(sql.raw(`savepoint ${name}`));
      try {
        await expectDbError(run, pattern);
      } finally {
        await tx.execute(sql.raw(`rollback to savepoint ${name}`));
      }
    }

    /** 64 hex characters, which is what the token_hash CHECK requires. */
    const tokenHash = () =>
      sql`md5(random()::text) || md5(random()::text || clock_timestamp()::text)`;

    /**
     * Insert a live grant and return its id. Runs on the owner connection, so
     * the two BEFORE INSERT triggers — not any grant — are what it has to
     * satisfy.
     */
    async function issueGrant(
      tx: { execute: (q: unknown) => Promise<unknown> },
      opts: {
        org?: string;
        aboutOrg?: string;
        year: number;
        expiresIn?: string;
      },
    ): Promise<{ id: string; hash: string }> {
      const row = rowsOf(
        await tx.execute(sql`
          insert into statistics_submission_grants
            (organization_id, about_org_id, report_year, token_hash,
             issued_to_name, issued_to_email, issued_by, expires_at)
          values (${opts.org ?? NORTHERN_REACH}::uuid,
                  ${opts.aboutOrg ?? QUILLHAVEN}::uuid,
                  ${opts.year},
                  ${tokenHash()},
                  'Odalys Fenwick', 'clerk@quillhaven.example.invalid',
                  ${PRESBYTERY_CLERK_USER}::uuid,
                  now() + ${sql.raw(`interval '${opts.expiresIn ?? "30 days"}'`)})
          returning id, token_hash
        `),
      )[0]!;
      return { id: String(row.id), hash: String(row.token_hash) };
    }

    const armClaim = (tx: { execute: (q: unknown) => Promise<unknown> }) =>
      tx.execute(sql`select set_config('presby.grant_claim_active', 'true', true)`);

    // -----------------------------------------------------------------------
    describe("the freeze trigger, on the connection where no grant binds", () => {
      it("refuses an UNARMED claim even from the owner — a BYPASSRLS role is exempt from policies, never from triggers (F44)", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2090 });
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set submitted_at = now()
                 where id = ${grant.id}::uuid
              `),
            /may only be claimed by the sanctioned submission function/,
          );
        });
      });

      it("refuses an UNARMED stamp, the second half of the same act", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2090 });
          await armClaim(tx);
          await tx.execute(sql`
            update statistics_submission_grants
               set submitted_at = now()
             where id = ${grant.id}::uuid
          `);
          // Disarm by starting a fresh transaction-local value is not possible
          // inside one transaction, so the stamp is probed in its own
          // transaction below; here the point is that the CLAIM succeeded once
          // armed, which the next assertion depends on.
          const row = rowsOf(
            await tx.execute(
              sql`select submitted_at, return_id from statistics_submission_grants where id = ${grant.id}::uuid`,
            ),
          )[0]!;
          expect(row.submitted_at).not.toBeNull();
          expect(row.return_id).toBeNull();
        });

        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2090 });
          await armClaim(tx);
          await tx.execute(sql`
            update statistics_submission_grants
               set submitted_at = now()
             where id = ${grant.id}::uuid
          `);
          // Unarm: set_config to a non-'true' value, transaction-local.
          await tx.execute(
            sql`select set_config('presby.grant_claim_active', 'off', true)`,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set return_id = null
                 where id = ${grant.id}::uuid
              `),
            /a claimed grant may only be stamped with return_id, once/,
          );
        });
      });

      it("refuses a MIXED-SHAPE update: a revocation may only move revoked_at, and a claim may only move submitted_at", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2090 });

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set revoked_at = now(), report_year = 2091
                 where id = ${grant.id}::uuid
              `),
            /a revocation may only set revoked_at/,
          );

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set revoked_at = now(), issued_to_email = 'elsewhere@example.invalid'
                 where id = ${grant.id}::uuid
              `),
            /a revocation may only set revoked_at/,
          );

          await armClaim(tx);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set submitted_at = now(), token_hash = ${tokenHash()}
                 where id = ${grant.id}::uuid
              `),
            /a claim must set submitted_at alone/,
          );
        });
      });

      it("refuses EVERY update once the row is terminal — revoked, or stamped with a return", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2090 });
          await tx.execute(sql`
            update statistics_submission_grants
               set revoked_at = now()
             where id = ${grant.id}::uuid
          `);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set revoked_at = null
                 where id = ${grant.id}::uuid
              `),
            /already revoked at/,
          );
          await armClaim(tx);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set submitted_at = now()
                 where id = ${grant.id}::uuid
              `),
            /already revoked at/,
          );
        });
      });

      it("accepts the three sanctioned transitions and nothing else — revoke; claim; stamp", async () => {
        await inOwnerRollback(async (tx) => {
          const revoked = await issueGrant(tx, { year: 2092 });
          await tx.execute(sql`
            update statistics_submission_grants
               set revoked_at = now()
             where id = ${revoked.id}::uuid
          `);

          // Claim + stamp, end to end, through the real function — which is
          // the only thing that arms the marker in production.
          const live = await issueGrant(tx, { year: 2093 });
          const returned = rowsOf(
            await tx.execute(sql`
              select presby_submit_granted_return(
                ${live.hash}, '{"ending_active": 41}'::jsonb,
                'Odalys Fenwick', 'clerk_of_session') as return_id
            `),
          )[0]!;
          expect(returned.return_id).toBeTruthy();

          const row = rowsOf(
            await tx.execute(sql`
              select submitted_at, return_id
                from statistics_submission_grants where id = ${live.id}::uuid
            `),
          )[0]!;
          expect(row.submitted_at).not.toBeNull();
          expect(String(row.return_id)).toBe(String(returned.return_id));
        });
      });
    });

    // -----------------------------------------------------------------------
    describe("the issuance triggers, on the owner path", () => {
      it("refuses a grant about a MANAGED congregation — the exclusion is a trigger, not a dropdown filter", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () => issueGrant(tx, { aboutOrg: ALDER_CREEK, year: 2090 }),
            /already has an active account and self-files through its own portal/,
          );
        });
      });

      it("refuses a grant about a congregation this council does not hold TODAY", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              issueGrant(tx, {
                org: SOUTHERN_FIELDS,
                aboutOrg: QUILLHAVEN,
                year: 1990,
              }),
            /was not affiliated with this council as of/,
          );
        });
      });

      it("refuses an expiry that does not outlast its own issuance, and a malformed token hash", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistics_submission_grants
                  (organization_id, about_org_id, report_year, token_hash,
                   issued_to_name, issued_to_email, issued_by, issued_at, expires_at)
                values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 2090,
                        ${tokenHash()}, 'Odalys Fenwick',
                        'clerk@quillhaven.example.invalid',
                        ${PRESBYTERY_CLERK_USER}::uuid,
                        now(), now() - interval '1 day')
              `),
            /statistics_submission_grants_expiry_shape/,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistics_submission_grants
                  (organization_id, about_org_id, report_year, token_hash,
                   issued_to_name, issued_to_email, issued_by, expires_at)
                values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 2090,
                        'NOT-A-SHA256', 'Odalys Fenwick',
                        'clerk@quillhaven.example.invalid',
                        ${PRESBYTERY_CLERK_USER}::uuid,
                        now() + interval '10 days')
              `),
            /statistics_submission_grants_token_hash_shape/,
          );
        });
      });
    });

    // -----------------------------------------------------------------------
    describe("F80 — the two affiliation instants", () => {
      it("refuses a STALE credential: a grant issued by a presbytery that no longer holds the congregation", async () => {
        await inOwnerRollback(async (tx) => {
          // The issuance trigger refuses this row by design, and that refusal
          // is itself asserted above. Disabling it INSIDE this rolled-back
          // transaction is the only way to stage the historical state the
          // claim-time re-verification exists for: the Southern Fields held
          // Quillhaven until 1995 and could legitimately have issued a grant
          // then; the northern reach holds it now.
          await tx.execute(
            sql.raw(
              "alter table statistics_submission_grants disable trigger statistics_submission_grants_about_org",
            ),
          );
          const stale = await issueGrant(tx, {
            org: SOUTHERN_FIELDS,
            aboutOrg: QUILLHAVEN,
            year: 2024,
          });
          await tx.execute(
            sql.raw(
              "alter table statistics_submission_grants enable trigger statistics_submission_grants_about_org",
            ),
          );

          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                select presby_submit_granted_return(
                  ${stale.hash}, '{"ending_active": 41}'::jsonb,
                  'Odalys Fenwick', 'clerk_of_session')
              `),
            /presby_submit_granted_return: grant not usable/,
          );

          // ...and nothing was claimed. The refusal precedes the UPDATE.
          const row = rowsOf(
            await tx.execute(sql`
              select submitted_at from statistics_submission_grants
               where id = ${stale.id}::uuid
            `),
          )[0]!;
          expect(row.submitted_at).toBeNull();
        });
      });

      it("refuses a LATE FILING for a year the issuing council did not hold the congregation, with the SAME message the self-publish path sees", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 1990 });
          let grantMessage = "";
          let publishMessage = "";

          await tx.execute(sql.raw("savepoint f80_grant"));
          try {
            await tx.execute(sql`
              select presby_submit_granted_return(
                ${grant.hash}, '{"ending_active": 41}'::jsonb,
                'Odalys Fenwick', 'clerk_of_session')
            `);
          } catch (err) {
            let cur: unknown = err;
            for (let d = 0; d < 5 && cur; d += 1) {
              if (cur instanceof Error && /chain:/.test(cur.message)) {
                grantMessage = cur.message;
              }
              cur = cur instanceof Error ? cur.cause : undefined;
            }
          }
          await tx.execute(sql.raw("rollback to savepoint f80_grant"));

          await tx.execute(sql.raw("savepoint f80_publish"));
          try {
            await tx.execute(
              sql`select set_config('app.current_org_id', ${QUILLHAVEN}, true)`,
            );
            await tx.execute(
              sql`select presby_publish_sasr_snapshot(1990, 'n/a', p_ending_active => 41)`,
            );
          } catch (err) {
            let cur: unknown = err;
            for (let d = 0; d < 5 && cur; d += 1) {
              if (cur instanceof Error && /chain:/.test(cur.message)) {
                publishMessage = cur.message;
              }
              cur = cur instanceof Error ? cur.cause : undefined;
            }
          }
          await tx.execute(sql.raw("rollback to savepoint f80_publish"));

          expect(grantMessage).toMatch(
            /presby_write_return_publication_chain: .* was not affiliated with .* during 1990/,
          );
          expect(grantMessage).toBe(publishMessage);
        });
      });
    });

    // -----------------------------------------------------------------------
    describe("the extracted chain writer (F55/DECISION-141 after the move)", () => {
      it("still refuses an UNMARKED direct INSERT into all three chain tables on the owner connection", async () => {
        await inOwnerRollback(async (tx) => {
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into statistical_returns
                  (organization_id, about_org_id, report_year, form_version_key,
                   provenance, payload, reconciled, attested_at)
                values (${QUILLHAVEN}::uuid, ${QUILLHAVEN}::uuid, 2094, '2024',
                        'submitted', '{"ending_active": 41}'::jsonb, true, now())
              `),
            /may only be written by a sanctioned publication function/,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into publications
                  (organization_id, recipient_org_id, record_class, artifact_id)
                values (${QUILLHAVEN}::uuid, ${NORTHERN_REACH}::uuid,
                        'statistical_return', gen_random_uuid())
              `),
            /may only be written by a sanctioned publication function/,
          );
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                insert into congregation_statistics
                  (organization_id, about_org_id, year, provenance, ending_active)
                values (${NORTHERN_REACH}::uuid, ${QUILLHAVEN}::uuid, 2094,
                        'published_by_congregation', 41)
              `),
            /may only be written by a sanctioned publication function/,
          );
        });
      });

      it("is not callable by the application roles — containment is by grant, not by hope", async () => {
        await inOwnerRollback(async (tx) => {
          const row = rowsOf(
            await tx.execute(sql`
              select
                bool_or(has_function_privilege('presby_app', p.oid, 'execute')) as app,
                bool_or(has_function_privilege('presby_platform', p.oid, 'execute')) as platform
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'presby_write_return_publication_chain'
            `),
          )[0]!;
          expect(row.app).toBe(false);
          expect(row.platform).toBe(false);
        });
      });

      it("writes the artifact, the event and the projection in ONE transaction, with the attestation the grant path supplies", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2095 });
          const returned = rowsOf(
            await tx.execute(sql`
              select presby_submit_granted_return(
                ${grant.hash},
                '{"ending_active": 41, "receipts_contributions": 84000.00}'::jsonb,
                'Odalys Fenwick', 'clerk_of_session') as return_id
            `),
          )[0]!;
          const returnId = String(returned.return_id);

          const artifact = rowsOf(
            await tx.execute(sql`
              select organization_id, about_org_id, provenance, reconciled,
                     attested_by_name, attested_role, attested_at
                from statistical_returns where id = ${returnId}::uuid
            `),
          )[0]!;
          expect(artifact.organization_id).toBe(QUILLHAVEN);
          expect(artifact.about_org_id).toBe(QUILLHAVEN);
          expect(artifact.provenance).toBe("submitted");
          expect(artifact.attested_by_name).toBe("Odalys Fenwick");
          expect(artifact.attested_role).toBe("clerk_of_session");
          expect(artifact.attested_at).not.toBeNull();

          const event = rowsOf(
            await tx.execute(sql`
              select id, organization_id, recipient_org_id, published_at
                from publications where artifact_id = ${returnId}::uuid
            `),
          )[0]!;
          expect(event.organization_id).toBe(QUILLHAVEN);
          expect(event.recipient_org_id).toBe(NORTHERN_REACH);

          const projection = rowsOf(
            await tx.execute(sql`
              select organization_id, about_org_id, year, provenance,
                     ending_active, receipts_contributions, published_at
                from congregation_statistics
               where publication_id = ${String(event.id)}::uuid
            `),
          )[0]!;
          expect(projection.organization_id).toBe(NORTHERN_REACH);
          expect(projection.about_org_id).toBe(QUILLHAVEN);
          expect(projection.provenance).toBe("published_by_congregation");
          expect(Number(projection.ending_active)).toBe(41);
          expect(Number(projection.receipts_contributions)).toBe(84000);
          // F39: the projection's copy of the event's instant is EXACT, not
          // a second now() — one function, one transaction.
          expect(String(projection.published_at)).toBe(
            String(event.published_at),
          );
        });
      });

      it("rejects a payload key the form spec does not declare, before anything is written", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2096 });
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                select presby_submit_granted_return(
                  ${grant.hash}, '{"not_a_sasr_field": 3}'::jsonb,
                  'Odalys Fenwick', 'clerk_of_session')
              `),
            /field|spec|not declared|unknown/i,
          );
          const row = rowsOf(
            await tx.execute(sql`
              select submitted_at from statistics_submission_grants
               where id = ${grant.id}::uuid
            `),
          )[0]!;
          expect(row.submitted_at).toBeNull();
        });
      });

      it("rejects an out-of-range attestation with a DISTINGUISHABLE error — token possession is already proven, so specificity is not a leak", async () => {
        await inOwnerRollback(async (tx) => {
          const grant = await issueGrant(tx, { year: 2097 });
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                select presby_submit_granted_return(
                  ${grant.hash}, '{"ending_active": 41}'::jsonb, '   ', 'clerk_of_session')
              `),
            /attestation out of range/,
          );
        });
      });
    });

    // -----------------------------------------------------------------------
    describe("the composite FK and the documented DELETE residual", () => {
      it("refuses a stamp pointing at a return owned by a DIFFERENT congregation (F2)", async () => {
        await inOwnerRollback(async (tx) => {
          const alderReturn = rowsOf(
            await tx.execute(sql`
              select id from statistical_returns
               where organization_id = ${ALDER_CREEK}::uuid
               limit 1
            `),
          )[0];
          if (!alderReturn) return; // no seeded Alder return on this branch
          const grant = await issueGrant(tx, { year: 2098 });
          await armClaim(tx);
          await tx.execute(sql`
            update statistics_submission_grants
               set submitted_at = now()
             where id = ${grant.id}::uuid
          `);
          await expectDbErrorInTx(
            tx,
            () =>
              tx.execute(sql`
                update statistics_submission_grants
                   set return_id = ${String(alderReturn.id)}::uuid
                 where id = ${grant.id}::uuid
              `),
            /statistics_submission_grants_return_fk/,
          );
        });
      });

      it("carries NO before-delete trigger — the documented, bounded residual (Phase 2 question 7), so an organization teardown cascades", async () => {
        await inOwnerRollback(async (tx) => {
          const row = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n
                from pg_trigger t
                join pg_class c on c.oid = t.tgrelid
               where c.relname = 'statistics_submission_grants'
                 and not t.tgisinternal
                 and (t.tgtype & 8) = 8
            `),
          )[0]!;
          expect(Number(row.n)).toBe(0);
        });
      });
    });

    // -----------------------------------------------------------------------
    describe("catalog pins the application depends on", () => {
      it("pins search_path = public, pg_temp on every SECURITY DEFINER function drizzle/0049 defines (F60/DECISION-148)", async () => {
        await inOwnerRollback(async (tx) => {
          const rows = rowsOf(
            await tx.execute(sql`
              select p.proname, array_to_string(p.proconfig, ',') as config
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef
                 and p.proname in ('presby_write_return_publication_chain',
                                   'presby_publish_sasr_snapshot',
                                   'presby_submit_granted_return',
                                   'presby_preview_granted_return')
               order by p.proname
            `),
          );
          expect(rows).toHaveLength(4);
          for (const row of rows) {
            expect(String(row.config)).toBe("search_path=public, pg_temp");
          }
        });
      });

      it("keeps EXACTLY ONE arming site for the publish chain after the extraction", async () => {
        await inOwnerRollback(async (tx) => {
          const rows = rowsOf(
            await tx.execute(sql`
              select p.proname
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prokind = 'f'
                 and pg_get_functiondef(p.oid)
                     like '%set_config(''presby.publication_write_active''%'
            `),
          );
          expect(rows.map((r) => String(r.proname))).toEqual([
            "presby_write_return_publication_chain",
          ]);
        });
      });
    });
  },
);
