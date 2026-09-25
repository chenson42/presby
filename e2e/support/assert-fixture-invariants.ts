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
