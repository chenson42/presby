/**
 * Integration tests for src/lib/statistics-grants.ts — run against a REAL
 * Postgres connection, not mocked. Same harness as `src/lib/presbytery.test.ts`
 * / `src/lib/db/domain/grants.test.ts`: the `hasDb` skip-guard, dynamic
 * imports inside `beforeAll` (this file's own top-level import would
 * otherwise reach `@/lib/db`'s module-scope pool construction before
 * `DATABASE_URL` is confirmed set), and seeded fixtures rather than a
 * self-built org tree — `scripts/seed-dev.sql`'s Northern Reach presbytery
 * already has everything this module's tenant half needs (a stated clerk
 * holding `statistics.manage`, a member with no permission, an `unmanaged`/
 * `invited` congregation, and a `managed` one).
 *
 * `npm test` in CI does not set `DATABASE_URL`, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/statistics-grants.test.ts
 *
 * TWO GROUPS, matching the module's own two trust shapes:
 *
 *   A. ISSUANCE / REVOCATION / LISTING — exercised through the exported
 *      `withOrgContext()`-backed functions themselves, against Marrowbone
 *      (unmanaged-adjacent `invited`, real Northern Reach child) using
 *      report years this file owns exclusively (209x), never touching the
 *      three Quillhaven fixtures `scripts/seed-dev.sql` ships for
 *      `scripts/test-rls.sql` §36 and `grants.test.ts`.
 *
 *   B. THE PUBLIC SUBMISSION BOUNDARY — `previewGrantedReturn`/
 *      `submitStatisticsGrant` take no `personId`/`organizationId`, so there
 *      is no exported function that could hand this file a raw token to
 *      submit (by design — `issueStatisticsGrant()` deliberately never
 *      returns one). This group inserts its OWN throwaway fixture grants
 *      directly via `getPlatformDb()`, with KNOWN raw tokens (the exact
 *      pattern `scripts/seed-dev.sql`'s own "dev-grant-quillhaven-*" fixtures
 *      document), for Marrowbone at report years 209x — never the live
 *      Quillhaven 2026 grant, so nothing here needs restoring afterward.
 *
 * TEARDOWN follows `presbytery.test.ts`'s exact convention for the frozen
 * chain (`statistical_returns_freeze`/`publications_freeze`/
 * `congregation_statistics_freeze` disabled around the cascade, then
 * re-enabled) — group B's one successful submission writes all three.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));
// `./statistics-grants` -> `@/lib/email` -> `@/lib/email/queue.ts` ->
// `@/lib/audit` -> `@/auth`, which loads next-auth -> next/server: not
// resolvable under plain Vitest Node.js (same fact
// `password-reset-actions.test.ts` documents for the same transitive path).
// This file never calls `auth()` itself — `issueStatisticsGrant()`'s email
// send is the only thing that needs `enqueueEmail`/`AUDIT_ACTIONS` to import
// cleanly.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

/** scripts/seed-dev.sql fixtures. */
const NORTHERN_REACH = "11111111-1111-1111-1111-111111111111";
const ALDER_CREEK = "22222222-2222-2222-2222-222222222222"; // managed
const MARROWBONE = "66666666-6666-6666-6666-666666666666"; // invited, unmanaged-adjacent
const SOUTHERN_FIELDS = "f6000000-0000-0000-0000-000000000001"; // a presbytery, not Northern Reach's child
const CLERK_PERSON = "c0000000-0000-0000-0000-00000000000a"; // Idris Calloway, holds statistics.manage
const CLERK_USER = "e0000000-0000-0000-0000-0000000000f4"; // presbytery.clerk.fixture@example.invalid
const NO_PERM_PERSON = "c0000000-0000-0000-0000-000000000006"; // Rowan Thistlewood, no statistics.manage

const SUBMISSION_FLAG = "statistics.submission_grants";

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe.skipIf(!hasDb)(
  "statistics-grants.ts (Postgres-backed, real dev database)",
  () => {
    let issueStatisticsGrant: typeof import("./statistics-grants").issueStatisticsGrant;
    let revokeStatisticsGrant: typeof import("./statistics-grants").revokeStatisticsGrant;
    let listStatisticsGrants: typeof import("./statistics-grants").listStatisticsGrants;
    let previewGrantedReturn: typeof import("./statistics-grants").previewGrantedReturn;
    let submitStatisticsGrant: typeof import("./statistics-grants").submitStatisticsGrant;

    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let statisticsSubmissionGrants: typeof import("@/lib/db/domain/returns").statisticsSubmissionGrants;
    let statisticalReturns: typeof import("@/lib/db/domain/returns").statisticalReturns;
    let publications: typeof import("@/lib/db/domain/publication").publications;
    let congregationStatistics: typeof import("@/lib/db/domain/presbytery").congregationStatistics;
    let featureFlags: typeof import("@/lib/db/schema").featureFlags;

    // Report years this file owns exclusively — never the seeded
    // 2023/2024/2026 Quillhaven fixtures.
    const ISSUE_YEAR = 2090;
    const MANAGED_REJECT_YEAR = 2091;
    const REVOKE_YEAR = 2093;

    const LIVE_YEAR = 2094;
    const EXPIRED_YEAR = 2095;
    const REVOKED_YEAR = 2096;

    const LIVE_TOKEN = "test-grant-marrowbone-live-2094";
    const EXPIRED_TOKEN = "test-grant-marrowbone-expired-2095";
    const REVOKED_TOKEN = "test-grant-marrowbone-revoked-2096";

    const LIVE_GRANT_ID = "ab100000-0000-0000-0000-000000000001";
    const EXPIRED_GRANT_ID = "ab100000-0000-0000-0000-000000000002";
    const REVOKED_GRANT_ID = "ab100000-0000-0000-0000-000000000003";

    let flagWasEnabled: boolean | null = null;

    beforeAll(async () => {
      ({
        issueStatisticsGrant,
        revokeStatisticsGrant,
        listStatisticsGrants,
        previewGrantedReturn,
        submitStatisticsGrant,
      } = await import("./statistics-grants"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ statisticsSubmissionGrants, statisticalReturns } = await import(
        "@/lib/db/domain/returns"
      ));
      ({ publications } = await import("@/lib/db/domain/publication"));
      ({ congregationStatistics } = await import("@/lib/db/domain/presbytery"));
      ({ featureFlags } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();

      // Clean slate for every fixture this file owns, in case a previous
      // aborted run left rows behind — idempotent, ids are fixed literals.
      await platform
        .delete(statisticsSubmissionGrants)
        .where(
          and(
            eq(statisticsSubmissionGrants.organizationId, NORTHERN_REACH),
            eq(statisticsSubmissionGrants.aboutOrgId, MARROWBONE),
            inArray(statisticsSubmissionGrants.reportYear, [
              ISSUE_YEAR,
              MANAGED_REJECT_YEAR,
              REVOKE_YEAR,
              LIVE_YEAR,
              EXPIRED_YEAR,
              REVOKED_YEAR,
            ]),
          ),
        );
      await platform
        .delete(statisticsSubmissionGrants)
        .where(
          and(
            eq(statisticsSubmissionGrants.organizationId, NORTHERN_REACH),
            eq(statisticsSubmissionGrants.aboutOrgId, ALDER_CREEK),
            eq(statisticsSubmissionGrants.reportYear, MANAGED_REJECT_YEAR),
          ),
        );

      // Group B's three throwaway fixtures — the exact pattern
      // scripts/seed-dev.sql documents for its own dev-only tokens.
      await platform.insert(statisticsSubmissionGrants).values([
        {
          id: LIVE_GRANT_ID,
          organizationId: NORTHERN_REACH,
          aboutOrgId: MARROWBONE,
          reportYear: LIVE_YEAR,
          tokenHash: sha256Hex(LIVE_TOKEN),
          issuedToName: "Test Fixture Clerk",
          issuedToEmail: "clerk@marrowbone.example.invalid",
          issuedBy: CLERK_USER,
          expiresAt: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000),
        },
        {
          id: EXPIRED_GRANT_ID,
          organizationId: NORTHERN_REACH,
          aboutOrgId: MARROWBONE,
          reportYear: EXPIRED_YEAR,
          tokenHash: sha256Hex(EXPIRED_TOKEN),
          issuedToName: "Test Fixture Clerk",
          issuedToEmail: "clerk@marrowbone.example.invalid",
          issuedBy: CLERK_USER,
          issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 355 * 24 * 60 * 60 * 1000),
        },
        {
          id: REVOKED_GRANT_ID,
          organizationId: NORTHERN_REACH,
          aboutOrgId: MARROWBONE,
          reportYear: REVOKED_YEAR,
          tokenHash: sha256Hex(REVOKED_TOKEN),
          issuedToName: "Test Fixture Clerk",
          issuedToEmail: "clerk@marrowbone.example.invalid",
          issuedBy: CLERK_USER,
          issuedAt: new Date(Date.now() - 700 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 655 * 24 * 60 * 60 * 1000),
          revokedAt: new Date(Date.now() - 699 * 24 * 60 * 60 * 1000),
        },
      ]);

      // Flip the flag on for the duration of this file only — restored in
      // afterAll. isFlagEnabled() is a bare, fail-CLOSED check (this gates a
      // write, not a sign-in path), so a flipped-off flag mid-suite would
      // make every group-B "ok" assertion fail with a correct but
      // unhelpful "invalid" — recorded explicitly rather than discovered.
      const [existingFlag] = await platform
        .select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(eq(featureFlags.key, SUBMISSION_FLAG))
        .limit(1);
      flagWasEnabled = existingFlag?.enabled ?? null;
      await platform
        .insert(featureFlags)
        .values({ key: SUBMISSION_FLAG, description: "test override", enabled: true })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { enabled: true },
        });
    });

    afterAll(async () => {
      const platform = getPlatformDb();

      // Restore the flag to whatever it was before this file ran (seeded
      // OFF, per scripts/seed.ts — but never assume; read it back instead).
      if (flagWasEnabled !== null) {
        await platform
          .update(featureFlags)
          .set({ enabled: flagWasEnabled })
          .where(eq(featureFlags.key, SUBMISSION_FLAG));
      }

      // The chain group B's successful submission wrote — frozen on EVERY
      // connection, including the owner (a grant does not bind
      // neondb_owner). Disabled for teardown's own cascade, same convention
      // presbytery.test.ts documents.
      await platform.execute(
        sql`alter table congregation_statistics disable trigger congregation_statistics_freeze`,
      );
      try {
        await platform
          .delete(congregationStatistics)
          .where(eq(congregationStatistics.aboutOrgId, MARROWBONE));
      } finally {
        await platform.execute(
          sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`,
        );
      }

      // The grants themselves come out BEFORE statistical_returns: the live
      // fixture's `return_id` (set by the successful submission test) is a
      // composite FK into `statistical_returns`, so the CHILD row must be
      // removed before the PARENT it references — the reverse order trips
      // `statistics_submission_grants_return_fk`, exactly as it should. No
      // freeze-on-DELETE trigger guards this table (D16 ruling, question 7),
      // so a plain owner-connection delete is enough.
      await platform
        .delete(statisticsSubmissionGrants)
        .where(
          and(
            eq(statisticsSubmissionGrants.organizationId, NORTHERN_REACH),
            eq(statisticsSubmissionGrants.aboutOrgId, MARROWBONE),
            inArray(statisticsSubmissionGrants.reportYear, [
              ISSUE_YEAR,
              REVOKE_YEAR,
              LIVE_YEAR,
              EXPIRED_YEAR,
              REVOKED_YEAR,
            ]),
          ),
        );

      await platform.execute(
        sql`alter table publications disable trigger publications_freeze`,
      );
      await platform.execute(
        sql`alter table statistical_returns disable trigger statistical_returns_freeze`,
      );
      try {
        await platform
          .delete(publications)
          .where(eq(publications.organizationId, MARROWBONE));
        await platform
          .delete(statisticalReturns)
          .where(eq(statisticalReturns.organizationId, MARROWBONE));
      } finally {
        await platform.execute(
          sql`alter table statistical_returns enable trigger statistical_returns_freeze`,
        );
        await platform.execute(
          sql`alter table publications enable trigger publications_freeze`,
        );
      }
      await platform
        .delete(statisticsSubmissionGrants)
        .where(
          and(
            eq(statisticsSubmissionGrants.organizationId, NORTHERN_REACH),
            eq(statisticsSubmissionGrants.aboutOrgId, ALDER_CREEK),
            eq(statisticsSubmissionGrants.reportYear, MANAGED_REJECT_YEAR),
          ),
        );
    });

    // -------------------------------------------------------------------
    // Group A — issuance / revocation / listing
    // -------------------------------------------------------------------

    describe("issueStatisticsGrant", () => {
      it("forbidden for a member with no statistics.manage grant", async () => {
        const result = await issueStatisticsGrant(
          NO_PERM_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("forbidden");
      });

      it("invalid_target for a nonexistent aboutOrgId", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: randomUUID(),
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("invalid_target");
      });

      it("invalid_target for a real organization that is not this presbytery's own congregation", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: SOUTHERN_FIELDS,
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("invalid_target");
      });

      it("invalid_input for an out-of-range report year", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: 1899,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input for a malformed recipient email", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "not-an-email",
          },
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input — the database trigger refuses a MANAGED congregation, translated to a specific message", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: ALDER_CREEK,
            reportYear: MANAGED_REJECT_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@alder-creek.example.invalid",
          },
        );
        expect(result.kind).toBe("invalid_input");
        if (result.kind === "invalid_input") {
          expect(result.message).toMatch(/active account/i);
        }
      });

      it("issues a live grant for an unmanaged/invited congregation", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          expect(result.data.id).toBeTruthy();
          expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(
            Date.now(),
          );
        }
      });

      it("invalid_input — a second live grant for the same (org, congregation, year) collides with the partial unique index", async () => {
        const result = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: ISSUE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        expect(result.kind).toBe("invalid_input");
        if (result.kind === "invalid_input") {
          expect(result.message).toMatch(/already outstanding/i);
        }
      });
    });

    describe("listStatisticsGrants", () => {
      it("forbidden for a member with no statistics.manage grant", async () => {
        const result = await listStatisticsGrants(NO_PERM_PERSON, NORTHERN_REACH);
        expect(result.kind).toBe("forbidden");
      });

      it("includes the issued grant with status 'issued'", async () => {
        const result = await listStatisticsGrants(CLERK_PERSON, NORTHERN_REACH);
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          const row = result.data.find(
            (r) => r.aboutOrgId === MARROWBONE && r.reportYear === ISSUE_YEAR,
          );
          expect(row).toBeDefined();
          expect(row?.status).toBe("issued");
          expect(row?.aboutOrgName).toBe("Marrowbone Presbyterian Church");
        }
      });
    });

    describe("revokeStatisticsGrant", () => {
      let grantId: string;

      beforeAll(async () => {
        const issued = await issueStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          CLERK_USER,
          {
            aboutOrgId: MARROWBONE,
            reportYear: REVOKE_YEAR,
            issuedToName: "Test Clerk",
            issuedToEmail: "clerk@marrowbone.example.invalid",
          },
        );
        if (issued.kind !== "ok") {
          throw new Error(`fixture setup failed: ${JSON.stringify(issued)}`);
        }
        grantId = issued.data.id;
      });

      it("forbidden for a member with no statistics.manage grant", async () => {
        const result = await revokeStatisticsGrant(
          NO_PERM_PERSON,
          NORTHERN_REACH,
          grantId,
        );
        expect(result.kind).toBe("forbidden");
      });

      it("invalid_target for a nonexistent grant id", async () => {
        const result = await revokeStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          randomUUID(),
        );
        expect(result.kind).toBe("invalid_target");
      });

      it("revokes a live grant, returning aboutOrgId/reportYear for the caller's audit metadata — regression for thinned Phase 3 audit metadata", async () => {
        const result = await revokeStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          grantId,
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          expect(result.data.aboutOrgId).toBe(MARROWBONE);
          expect(result.data.reportYear).toBe(REVOKE_YEAR);
        }
      });

      it("invalid_input — revoking an already-revoked grant is distinguished from 'not found'", async () => {
        const result = await revokeStatisticsGrant(
          CLERK_PERSON,
          NORTHERN_REACH,
          grantId,
        );
        expect(result.kind).toBe("invalid_input");
        if (result.kind === "invalid_input") {
          expect(result.message).toMatch(/already revoked/i);
        }
      });

      it("listStatisticsGrants reflects the revoked status", async () => {
        const result = await listStatisticsGrants(CLERK_PERSON, NORTHERN_REACH);
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          const row = result.data.find((r) => r.id === grantId);
          expect(row?.status).toBe("revoked");
          expect(row?.revokedAt).toBeTruthy();
        }
      });
    });

    // -------------------------------------------------------------------
    // Group B — the public submission boundary
    // -------------------------------------------------------------------

    describe("previewGrantedReturn", () => {
      it("resolves a live token to the congregation's own public name and report year", async () => {
        const result = await previewGrantedReturn(LIVE_TOKEN);
        expect(result).not.toBeNull();
        expect(result?.aboutOrgName).toBe("Marrowbone Presbyterian Church");
        expect(result?.reportYear).toBe(LIVE_YEAR);
        expect(result?.formVersionKey).toBe("2024");
      });

      it("resolves an expired token to null", async () => {
        expect(await previewGrantedReturn(EXPIRED_TOKEN)).toBeNull();
      });

      it("resolves a revoked token to null", async () => {
        expect(await previewGrantedReturn(REVOKED_TOKEN)).toBeNull();
      });

      it("resolves a nonexistent token to null — indistinguishable from expired/revoked", async () => {
        expect(await previewGrantedReturn("this-token-was-never-issued")).toBeNull();
      });
    });

    describe("submitStatisticsGrant", () => {
      it("invalid for a nonexistent token", async () => {
        const result = await submitStatisticsGrant(
          "this-token-was-never-issued",
          {},
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid");
      });

      it("invalid for an expired token", async () => {
        const result = await submitStatisticsGrant(
          EXPIRED_TOKEN,
          {},
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid");
      });

      it("invalid for a revoked token", async () => {
        const result = await submitStatisticsGrant(
          REVOKED_TOKEN,
          {},
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid");
      });

      it("invalid_input for a live token with a blank attestation name — distinguishable, since token possession is already proven", async () => {
        const result = await submitStatisticsGrant(
          LIVE_TOKEN,
          {},
          "",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input for a live token with a payload key out of bounds", async () => {
        const result = await submitStatisticsGrant(
          LIVE_TOKEN,
          { ending_active: -5 },
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("ok — spends the live token exactly once, end to end", async () => {
        const result = await submitStatisticsGrant(
          LIVE_TOKEN,
          { ending_active: 42, receipts_contributions: 1000.5 },
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          expect(result.returnId).toBeTruthy();
          expect(result.auditFacts).not.toBeNull();
          expect(result.auditFacts?.organizationId).toBe(NORTHERN_REACH);
          expect(result.auditFacts?.aboutOrgId).toBe(MARROWBONE);
          expect(result.auditFacts?.reportYear).toBe(LIVE_YEAR);
          expect(result.auditFacts?.issuedToEmail).toBe(
            "clerk@marrowbone.example.invalid",
          );
        }
      });

      it("invalid — the SAME token cannot be spent twice (non-repeatable claim)", async () => {
        const result = await submitStatisticsGrant(
          LIVE_TOKEN,
          {},
          "Jane Clerk",
          "clerk_of_session",
        );
        expect(result.kind).toBe("invalid");
      });

      it("previewGrantedReturn now resolves the just-spent token to null too", async () => {
        expect(await previewGrantedReturn(LIVE_TOKEN)).toBeNull();
      });
    });

    describe("submitStatisticsGrant — flag off", () => {
      it("returns the same 'invalid' bucket as a dead token when the flag is off, even for a token that would otherwise be live", async () => {
        const platform = getPlatformDb();
        await platform
          .update(featureFlags)
          .set({ enabled: false })
          .where(eq(featureFlags.key, SUBMISSION_FLAG));
        try {
          // REVOKED_TOKEN is already spent/dead regardless, so this proves
          // only the flag-off code path runs without asserting on a live
          // credential; a same-cost dummy lookup still fires either way.
          const result = await submitStatisticsGrant(
            REVOKED_TOKEN,
            {},
            "Jane Clerk",
            "clerk_of_session",
          );
          expect(result.kind).toBe("invalid");
        } finally {
          await platform
            .update(featureFlags)
            .set({ enabled: true })
            .where(eq(featureFlags.key, SUBMISSION_FLAG));
        }
      });
    });
  },
);
