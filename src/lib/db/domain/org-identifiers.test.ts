/**
 * Owner-connection proofs for `organization_identifiers`' write-authority
 * model (`drizzle/0043_presby_org_identifiers.sql`, F47 / DECISION-140).
 *
 * WHY THIS FILE EXISTS. The table shipped in `drizzle/0043` with
 * `select, insert, update, delete` granted to `presby_app` and no RLS at all,
 * and with no test file of its own anywhere in the repository — a tenant
 * connection could rewrite or erase ANOTHER organization's identifier,
 * including flipping `is_verified`, the column
 * `organization_identifiers_kind_value_verified_idx` makes globally
 * significant. The 2026-09-24 external implementation review found it; this is
 * the first code that exercises the table.
 *
 * `scripts/test-rls.sql` section 32(n) carries the tenant half — the grant
 * shape, the trigger's catalog shape, and the authorization matrix of
 * `presby_set_organization_identifier()` as `presby_app` sees it. What it
 * structurally CANNOT show is the half that actually matters (F44 / Ruling
 * B3): `PLATFORM_DATABASE_URL` connects as `neondb_owner`, which owns the
 * table and holds every privilege by OWNERSHIP, so the revoke binds nobody who
 * can reach the database today. The guard trigger is what binds the owner —
 * `BYPASSRLS` and ownership exempt a role from RLS policies and from grants,
 * never from triggers — and only this connection can prove it.
 *
 * FAILING-FIRST. Each of the two "the owner cannot" tests below was run
 * against the schema as shipped (grant narrowing applied, guard trigger
 * dropped) and PASSED the raw UPDATE and DELETE, reproducing the hole exactly
 * as reported, before the trigger was re-created.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/db/domain/org-identifiers.test.ts
 *
 * Nothing durable is written: every probe runs inside a transaction that
 * always rolls back, which matters here because an identifier row is guarded
 * against DELETE on every connection — a row committed by accident could not
 * be cleaned up without disarming a global trigger.
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
/** A presbytery with no relationship to Alder Creek at all. */
const WESTERN_BASIN = "f7000000-0000-0000-0000-000000000001";

const UNIFORM_DENIAL =
  "organization_identifiers: this change is not permitted";

type Rows = { rows?: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (r as Rows).rows ?? [];

describe.skipIf(!hasDb)(
  "organization_identifiers write authority (Postgres-backed, owner connection)",
  () => {
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;

    beforeAll(async () => {
      ({ getPlatformDb } = await import("@/lib/db"));
    });

    const ROLLBACK = "__org_identifiers_test_rollback__";

    /** An owner-connection transaction that always rolls back. */
    async function inOwnerRollback(
      organizationId: string | null,
      body: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>,
    ): Promise<void> {
      const platform = getPlatformDb();
      try {
        await platform.transaction(async (tx) => {
          if (organizationId !== null) {
            await tx.execute(
              sql`select set_config('app.current_org_id', ${organizationId}, true)`,
            );
          }
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

    /** Seed one identifier row for Alder Creek inside the caller's transaction. */
    async function seedAlderIdentifier(tx: {
      execute: (q: unknown) => Promise<unknown>;
    }): Promise<string> {
      const rows = rowsOf(
        await tx.execute(sql`
          insert into organization_identifiers
            (organization_id, kind, value_normalized, is_verified, source)
          values (${ALDER_CREEK}::uuid, 'pcusa_pin', '70000001', true,
                  'org-identifiers.test.ts fixture')
          returning id
        `),
      );
      return rows[0]!.id as string;
    }

    // -------------------------------------------------------------------
    // The guard: the half no grant can deliver (F44)
    // -------------------------------------------------------------------

    describe("organization_identifiers_guard", () => {
      it("refuses a raw UPDATE on the OWNER connection — including the is_verified flip the review's example names", async () => {
        await inOwnerRollback(null, async (tx) => {
          const id = await seedAlderIdentifier(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                update organization_identifiers
                   set value_normalized = '99999999', is_verified = true
                 where id = ${id}::uuid
              `),
            new RegExp(UNIFORM_DENIAL),
          );
        });
      });

      it("refuses a raw DELETE on the OWNER connection", async () => {
        await inOwnerRollback(null, async (tx) => {
          const id = await seedAlderIdentifier(tx);
          await expectDbError(
            () =>
              tx.execute(
                sql`delete from organization_identifiers where id = ${id}::uuid`,
              ),
            new RegExp(UNIFORM_DENIAL),
          );
        });
      });

      it("is armed on UPDATE and DELETE only — INSERT is deliberately left to the grant and the partial unique index", async () => {
        // Named residual, not an oversight (F47 / docs/TODO.md): a colliding
        // VERIFIED insert is already refused by
        // organization_identifiers_kind_value_verified_idx, and an unverified
        // false claim about another org is the bounded presby_platform-only
        // risk class this pipeline has accepted elsewhere. Engineering a
        // bootstrap-vs-tenant distinction into an INSERT guard is more
        // machinery than today's problem needs.
        await inOwnerRollback(null, async (tx) => {
          await seedAlderIdentifier(tx);
          await expectDbError(
            () =>
              tx.execute(sql`
                insert into organization_identifiers
                  (organization_id, kind, value_normalized, is_verified)
                values (${BRAMBLEWOOD}::uuid, 'pcusa_pin', '70000001', true)
              `),
            /organization_identifiers_kind_value_verified_idx/,
          );
        });
      });
    });

    // -------------------------------------------------------------------
    // The sanctioned writer
    // -------------------------------------------------------------------

    describe("presby_set_organization_identifier()", () => {
      it("lets an organization assert and then verify its OWN identifier, passing the guard it arms itself", async () => {
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          const first = rowsOf(
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000002', false, 'fixture') as id
            `),
          )[0];
          expect(first!.id).toBeTruthy();

          const second = rowsOf(
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000002', true, null) as id
            `),
          )[0];
          expect(second!.id).toBe(first!.id);

          const row = rowsOf(
            await tx.execute(sql`
              select is_verified, source from organization_identifiers
               where id = ${first!.id as string}::uuid
            `),
          )[0];
          expect(row!.is_verified).toBe(true);
          // A null p_source does not erase the recorded provenance.
          expect(row!.source).toBe("fixture");
        });
      });

      it("lets a COUNCIL WITH STANDING write and verify a member congregation's identifier — the onboarding case", async () => {
        await inOwnerRollback(NORTHERN_REACH, async (tx) => {
          const row = rowsOf(
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'psvonline_congregation_id', '7777', true,
                'fixture: presbytery onboarding') as id
            `),
          )[0];
          expect(row!.id).toBeTruthy();
          const stored = rowsOf(
            await tx.execute(sql`
              select organization_id, is_verified from organization_identifiers
               where id = ${row!.id as string}::uuid
            `),
          )[0];
          expect(stored!.organization_id).toBe(ALDER_CREEK);
          expect(stored!.is_verified).toBe(true);
        });
      });

      it("refuses a peer congregation, an unrelated council and a missing org context with ONE byte-identical literal", async () => {
        const messages: string[] = [];
        for (const actor of [BRAMBLEWOOD, WESTERN_BASIN]) {
          await inOwnerRollback(actor, async (tx) => {
            let caught: unknown;
            try {
              await tx.execute(sql`
                select presby_set_organization_identifier(
                  ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000003', true, null)
              `);
            } catch (err) {
              caught = err;
            }
            expect(caught).toBeDefined();
            const cause = (caught as Error).cause as Error | undefined;
            messages.push(cause?.message ?? (caught as Error).message);
          });
        }
        // No org context at all — the confused-deputy floor every DEFINER
        // function in this codebase shares.
        await inOwnerRollback("", async (tx) => {
          let caught: unknown;
          try {
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000003', true, null)
            `);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeDefined();
          const cause = (caught as Error).cause as Error | undefined;
          messages.push(cause?.message ?? (caught as Error).message);
        });

        expect(messages).toHaveLength(3);
        for (const m of messages) expect(m).toContain(UNIFORM_DENIAL);
        // Byte-identical across every cause: a probing caller must not be
        // able to tell "you are not authorized" from "no such organization".
        expect(new Set(messages).size).toBe(1);
      });

      it("uses its OWN literal, not organization_affiliations' — one literal per table (DECISION-139)", async () => {
        await inOwnerRollback(BRAMBLEWOOD, async (tx) => {
          await expectDbError(
            () =>
              tx.execute(sql`
                select presby_set_organization_identifier(
                  ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000004', true, null)
              `),
            new RegExp(UNIFORM_DENIAL),
          );
        });
        await inOwnerRollback(BRAMBLEWOOD, async (tx) => {
          let caught: unknown;
          try {
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'pcusa_pin', '70000004', true, null)
            `);
          } catch (err) {
            caught = err;
          }
          const cause = (caught as Error).cause as Error | undefined;
          expect(cause?.message).not.toContain("organization_affiliations");
        });
      });

      it("keys on (organization_id, kind, value_normalized), so a second identifier of the same kind is RECORDED rather than overwriting the first", async () => {
        // A congregation may legitimately hold two legacy_import keys from two
        // source systems; keying the upsert on (org, kind) alone would
        // silently replace one claim with another.
        await inOwnerRollback(ALDER_CREEK, async (tx) => {
          const a = rowsOf(
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'legacy_import', 'sys-a-1', false, 'system A') as id
            `),
          )[0];
          const b = rowsOf(
            await tx.execute(sql`
              select presby_set_organization_identifier(
                ${ALDER_CREEK}::uuid, 'legacy_import', 'sys-b-9', false, 'system B') as id
            `),
          )[0];
          expect(a!.id).not.toBe(b!.id);
          const n = rowsOf(
            await tx.execute(sql`
              select count(*)::int as n from organization_identifiers
               where organization_id = ${ALDER_CREEK}::uuid and kind = 'legacy_import'
            `),
          )[0];
          expect(n!.n).toBe(2);
        });
      });
    });

    // -------------------------------------------------------------------
    // The grant shape, read from the catalog on the connection that can see
    // every role's entry
    // -------------------------------------------------------------------

    describe("the grant shape", () => {
      it("gives presby_app SELECT only and leaves presby_platform's DML as documented intent", async () => {
        const platform = getPlatformDb();
        const result = await platform.execute(sql`
          select a.grantee::regrole::text as grantee,
                 a.privilege_type::text as privilege_type
            from pg_class c, aclexplode(c.relacl) a
           where c.relname = 'organization_identifiers'
             and a.grantee::regrole::text in ('presby_app', 'presby_platform')
           order by 1, 2
        `);
        const shape = (
          result.rows as Array<{ grantee: string; privilege_type: string }>
        ).map((r) => `${r.grantee}.${r.privilege_type}`);
        expect(shape).toEqual([
          "presby_app.SELECT",
          "presby_platform.DELETE",
          "presby_platform.INSERT",
          "presby_platform.SELECT",
          "presby_platform.UPDATE",
        ]);
      });
    });
  },
);
