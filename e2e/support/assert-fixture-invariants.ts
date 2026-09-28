/**
 * assert-fixture-invariants.ts — per-spec fixture-drift guards.
 *
 * docs/work-log/2026-09-25-e2e-red-on-main.md, Phase 1: the `admin` e2e
 * fixture (e2e/support/users.ts) is documented and asserted, in
 * post-login-routing.spec.ts, admin-login.spec.ts, and member-home.spec.ts,
 * to carry ZERO organization memberships — that is precisely what routes it
 * to `/admin` (row 4 of CLAUDE.md's Post-Login Landing table) rather than the
 * `/home` chooser (row 5). On a shared, long-lived Neon dev branch that
 * invariant can silently drift: an agent signing in as `admin@presby.invalid`
 * to manually verify an `fpcw` admin page leaves behind a real membership row
 * that no committed seed script created.
 *
 * When that happens, the resulting spec failure reads as a routing
 * regression — the wrong pathname — with no hint that the actual cause is
 * data, not code. This guard makes the drift loud and named instead: it
 * throws with the row count and a pointer to the backlog entry, BEFORE any
 * test in the affected spec runs, rather than letting the drift masquerade as
 * a `computeDestination()` bug.
 *
 * Uses the OWNER connection (`E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL`),
 * following e2e/support/seed-orgs.ts's own justification: counting a fixture
 * user's memberships across every organization needs to see past the RLS a
 * tenant connection would otherwise filter by org context.
 *
 * Deliberately NOT folded into globalSetup (see the work-log's Phase 3 Edge
 * Cases): that would be a suite-wide "any e2e-owned user with an unexpected
 * membership" invariant, a larger blast radius than this bug-fix pipeline's
 * scope, and it is tracked separately in docs/TODO.md.
 */

import { neon } from "@neondatabase/serverless";
import { E2E_USERS } from "./users";
import { platformSql } from "./db";
import { RESERVED_YEAR_MIN, RESERVED_YEAR_MAX } from "./sasr-fixture";

/**
 * Throws if `admin@presby.invalid` carries any organization membership.
 *
 * Not a warning, not a skip — matching global-setup.ts's own "nothing here is
 * conditional" philosophy (see its header comment). A silently-skipped guard
 * is indistinguishable from no guard at all.
 */
export async function assertAdminFixtureHasNoOrgs(): Promise<void> {
  const platformDbUrl =
    process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL;
  if (!platformDbUrl) {
    throw new Error(
      "[assert-fixture-invariants] No platform database URL. Set " +
        "PLATFORM_DATABASE_URL (or E2E_PLATFORM_DATABASE_URL) in .env.local.",
    );
  }

  const sql = neon(platformDbUrl);
  const email = E2E_USERS.admin.email;

  const rows = await sql`
    SELECT o.slug
    FROM memberships m
    JOIN people p ON p.id = m.person_id
    JOIN users u ON u.id = p.user_id
    JOIN organizations o ON o.id = m.organization_id
    WHERE u.email = ${email}
      AND p.merged_into_id IS NULL
  `;

  if (rows.length > 0) {
    const slugs = rows.map((r) => r.slug as string).join(", ");
    throw new Error(
      `[assert-fixture-invariants] e2e fixture invariant violated: ${email} ` +
        `carries ${rows.length} organization membership(s) (${slugs}); this ` +
        "fixture is asserted elsewhere to carry zero. This is shared-dev-" +
        "database drift, not a routing regression — see " +
        "docs/work-log/2026-09-25-e2e-red-on-main.md and docs/TODO.md's " +
        "shared-dev-database-hygiene entry.",
    );
  }
}

// ---------------------------------------------------------------------------
// presbytery-portal e2e coverage (2026-09-28-presbytery-e2e, DECISION-157)
// ---------------------------------------------------------------------------
//
// Both guards below are the mechanical enforcement of "leave the DB exactly
// as found," called from filings-round-trip.spec.ts's own beforeAll AND
// afterAll (architect Phase 2 Notes §8) — not folded into globalSetup, same
// reasoning assertAdminFixtureHasNoOrgs() above already documents: this is a
// scoped, per-spec check, not a suite-wide invariant.

/**
 * Throws if any `statistical_returns` row exists in the reserved
 * 2090-2099 SASR report-year band. Called in `beforeAll` (a prior crashed
 * run left rows behind) AND `afterAll` (this run leaked) — the direct
 * mechanical descendant of the withdraw pipeline's QA FAIL
 * (docs/work-log/2026-09-26-withdraw-publication.md): "don't leave stray
 * fixture rows" becomes a check that names the damage the moment it
 * happens, rather than a comment trusted to be followed.
 */
export async function assertNoStrayFixtureReturns(): Promise<void> {
  const sql = platformSql("assert-fixture-invariants");

  const rows = (await sql`
    SELECT o.slug, sr.report_year, sr.id
      FROM statistical_returns sr
      JOIN organizations o ON o.id = sr.organization_id
     WHERE sr.report_year BETWEEN ${RESERVED_YEAR_MIN} AND ${RESERVED_YEAR_MAX}
  `) as { slug: string; report_year: number; id: string }[];

  if (rows.length > 0) {
    const described = rows
      .map((r) => `${r.slug}/${r.report_year} (${r.id})`)
      .join(", ");
    throw new Error(
      `[assert-fixture-invariants] ${rows.length} stray statistical_returns ` +
        `row(s) found in the reserved ${RESERVED_YEAR_MIN}-${RESERVED_YEAR_MAX} ` +
        `SASR band: ${described}. Either a prior e2e run crashed before its ` +
        "own teardown ran, or this run is leaking fixture rows — see " +
        "e2e/support/sasr-fixture.ts's removePublishedReturn().",
    );
  }
}

/**
 * Throws unless Alder Creek's SINGLE seeded SASR publication (report year
 * 2025) is present and un-withdrawn. This is the direct mechanical
 * descendant of the withdraw pipeline's own QA FAIL: it turns "never
 * withdraw the seed row" (DECISION-157) from a comment into a check that
 * names the damage the moment it happens, on whichever spec did it.
 * `scripts/test-rls.sql` asserts against this exact row by id
 * (`presby_list_own_congregation_publications()` returning count 1) — a
 * spec that withdraws it breaks the isolation suite, not merely itself.
 */
export async function assertSeedPublicationsIntact(): Promise<void> {
  const sql = platformSql("assert-fixture-invariants");

  const rows = (await sql`
    SELECT p.id, p.withdrawn_at
      FROM publications p
      JOIN statistical_returns sr
        ON sr.id = p.artifact_id AND sr.organization_id = p.organization_id
      JOIN organizations o ON o.id = p.organization_id
     WHERE o.slug = 'alder-creek'
       AND p.record_class = 'statistical_return'
       AND sr.report_year = 2025
  `) as { id: string; withdrawn_at: string | null }[];

  if (rows.length === 0) {
    throw new Error(
      "[assert-fixture-invariants] Alder Creek's seeded 2025 SASR publication " +
        "is MISSING. scripts/test-rls.sql asserts against this row by id — " +
        "the isolation suite is now broken, not just this spec. See DECISION-157 " +
        "and docs/work-log/2026-09-26-withdraw-publication.md's QA FAIL.",
    );
  }
  const withdrawn = rows.find((r) => r.withdrawn_at !== null);
  if (withdrawn) {
    throw new Error(
      `[assert-fixture-invariants] Alder Creek's seeded 2025 SASR publication ` +
        `(${withdrawn.id}) has been WITHDRAWN. DECISION-157 forbids any spec or ` +
        "manual rehearsal from withdrawing this row — scripts/test-rls.sql " +
        "asserts against it as live and un-withdrawn. See " +
        "docs/work-log/2026-09-26-withdraw-publication.md's QA FAIL.",
    );
  }
}
