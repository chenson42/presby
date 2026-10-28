import "server-only";
import { sql } from "drizzle-orm";
import type { getPlatformDb } from "@/lib/db";
import type { OrganizationType } from "@/lib/authz";

/**
 * The founding-administrator bundle and holder gate - docs/work-log/
 * 2026-09-28-founding-administrator.md (DECISION-155, F107-F112, F118, F150),
 * as reshaped by docs/work-log/2026-10-21-invitations.md (DECISION-183,
 * Batch 2d).
 *
 * WHAT THIS MODULE IS NOW. It used to hold `designateFoundingAdministrator()`,
 * a `getPlatformDb()` transaction that resolved a typed email to a `users` row
 * and wrote the designation. Under the invitation model (C1) a designation is
 * an INVITATION the email's owner accepts, and the effect it used to write
 * lives in the ungranted plpgsql helper `presby_apply_founding_administrator`
 * (drizzle/0059), reached only through `presby_accept_invitation`. The
 * TypeScript transaction, `deriveNameFromUser()` and the result type were
 * DELETED in Batch 2d, after `designation-parity.db.test.ts` proved the SQL
 * writes exactly what the TypeScript wrote (and froze that as a golden
 * snapshot, which is now the pin). What remains here is what the page and the
 * tests still read:
 *
 *   - `foundingAdministratorPlan()`: DISPLAY COPY of the bundle (the confirm
 *     dialog's permission list, the office template name). The authority is
 *     `presby_founding_administrator_permission_keys(org_type)` in SQL;
 *     `invitations.db.test.ts` pins the two EQUAL for every `organization_type`
 *     enum value read from the catalog, so a future key edits SQL, this file
 *     and the backfill together.
 *   - `countFoundingAdministratorHolders()`: a thin wrapper over the owner-only
 *     `presby_founding_administrator_holder_count(org)`, the single source for
 *     the send gate (`issue.ts`), this page's count and the accept gate. Owner
 *     only (a cross-org count is an oracle), so it runs on the platform
 *     connection the page already holds.
 *
 * TWO HIERARCHIES, MECHANICALLY: nothing here writes a platform-held grant or
 * adds a platform predicate to any tenant authority check. The resolver files
 * (`src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts`,
 * `drizzle/0010_presby_resolver.sql`) are not imported (a `type`-only
 * `OrganizationType` aside) and are unchanged by the invitation pipeline; a
 * source-scan test pins that no `src/lib/onboarding` module imports them.
 */

/** Every `app_role_permissions` key the founding-administrator's
 * ADMINISTRATION role carries, plus (presbytery only) the one template-less
 * oversight permission (DECISION-119). Not `permissions.ts` -- this is a
 * tenant `app_roles`/`app_role_permissions` key set, an entirely different
 * catalog from the platform-shell `FEATURES.*` one. */
export type FoundingAdministratorPlan = {
  administration: {
    key: "founding_administrator";
    name: "Founding Administrator";
    permissionKeys: string[];
  };
  officeTemplateKey: "presbytery_stated_clerk" | "congregation_stated_clerk" | null;
};

/**
 * The direct sibling of `org-provisioning.ts`'s `baselineRoleSeedPlan()` /
 * `groupSeedPlan()` -- same file-local, inline-conditional shape
 * (DECISION-100's precedent), same reason: this is a fixed, code-reviewed
 * bundle, not a tenant-configurable one. Exported (unlike its siblings)
 * because it is also the shape a future "preview what this grants" admin
 * affordance and this module's own unit tests read directly, without
 * re-deriving the plan from the transaction's own side effects.
 *
 * F111 (DECISION-155): under `assertPermissionSubset()`, an organization's
 * reachable permission set is permanently closed at whatever this bundle
 * contains -- `adoptTemplate()`/`grantRole()` can never raise it. Every key
 * here is individually justified in the work-log's Phase 2 Ruling 3; do NOT
 * add a permission "just in case" -- that is the exact accretion
 * DECISION-101/103/106 refused three times.
 *
 * F118 (Phase 2 addendum, DECISION-155 amended 2026-09-28): `staff.manage`
 * joins the base below. Ruling 3's original criterion (i) read "no
 * constitutional template *carries* it" -- `personnel_admin` carries
 * `staff.manage`, so the original bundle excluded it. That criterion was
 * wrong: F111 already proves "carried by a template" and "deliverable to an
 * organization" are different facts, because `adoptTemplate()` runs
 * `assertPermissionSubset()` over the full template set, so a template can
 * only ever hand an org a set the adopter already holds -- a template
 * carrying a key nobody at the org holds delivers nothing, ever. Criterion
 * (i) is therefore amended to "no constitutional template *can deliver*
 * it," under which `staff.manage` qualifies (verified: `personnel_admin` is
 * unreachable for every real organization while the subset check stands).
 * It is also the *only* in-app person-creation path that writes no
 * `roll_actions` row (the staff-hire surface pins `rollAction: { kind:
 * "none" }`, `src/app/(org)/o/[slug]/admin/staff/actions.ts`) -- without it
 * a freshly designated organization can manage roles/features/tickets for
 * itself but can never onboard a second person, the mandatory browser
 * rehearsal's own discovery (Phase 4 Batch C, step 6). `roll.propose` and
 * `roll.approve` stay excluded, and the exclusion is now load-bearing, not
 * incidental: `roll.approve` is carried by no template, so `roll.propose`
 * alone would manufacture permanently unapprovable pending roll actions,
 * and granting both to one platform-designated person would be the
 * Session's act performed unilaterally -- both forbidden by "The Roll Is
 * the System of Record" / "The Court Is Not a Group." Residual, named: a
 * congregation's founding administrator can still not enrol a member on
 * the roll; closing that is the F111 follow-on pipeline's work.
 */
export function foundingAdministratorPlan(
  organizationType: OrganizationType,
): FoundingAdministratorPlan {
  const base = [
    "people.manage",
    "roles.manage",
    "role_grants.manage",
    "groups.manage",
    "officers.manage",
    "org_features.manage",
    "tickets.file",
    "staff.manage",
    // F150 (custom domains, DECISION-180): tier-1 and unconstitutional (the
    // brand_admin precedent, DECISION-101), so no stated_clerk binding - but
    // under assertPermissionSubset() a key nobody at the org holds can never be
    // granted, so without this entry domains.manage would be ungrantable
    // everywhere. Meets the amended criterion (i): no template can deliver it.
    // drizzle/0057 backfills roles already designated; the additive-only
    // reconcile in designation step 9 tops up a re-designation.
    "domains.manage",
    // F292 (careers, DECISION-265, operator ruling Q4 2026-10-25): both
    // careers keys, for the same F111 reason as domains.manage - without them
    // nobody at an organization holds either key, so the `hiring_committee`
    // template could never be adopted or granted there. careers.manage is
    // tier 1 (postings are public content). careers.applicants is TIER 3, the
    // first key above tier 1 in this bundle: an accepted `paper` residual
    // (the founding administrator can read applications once the
    // applications increment ships), detected by that increment's
    // resume-download audit row. Unconstitutional (DECISION-078: no PC(USA)
    // office's duty is hiring), so no stated_clerk binding. drizzle/0071
    // re-creates the SQL function in the same order and backfills roles
    // already designated.
    "careers.manage",
    "careers.applicants",
  ];
  return {
    administration: {
      key: "founding_administrator",
      name: "Founding Administrator",
      permissionKeys:
        organizationType === "presbytery"
          ? [...base, "congregation_oversight.manage"]
          : base,
    },
    officeTemplateKey:
      organizationType === "presbytery"
        ? "presbytery_stated_clerk"
        : organizationType === "congregation"
          ? "congregation_stated_clerk"
          : null,
  };
}

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

/**
 * How many DISTINCT people CURRENTLY hold `roles.manage` or
 * `role_grants.manage` at `organizationId` (person-arm grants and group-arm
 * grants expanded through a live group membership) - the founding-
 * administrator gate's count, read fresh on every call and never cached
 * (`role-definitions.ts:120-124`'s own "never trusted from an earlier render"
 * discipline).
 *
 * The CTE is `presby_founding_administrator_holder_count()` in SQL, lifted
 * verbatim in drizzle/0059 - including its known asymmetry with the giving
 * count (the group arm checks `gm.ends_on is null` with no date window and no
 * membership join, so an ENDED membership still counts here but not for
 * giving; kept for parity with the shipped behaviour, a TODO for a future
 * ruling). NEVER `presby_effective_permissions()` (F107: it raises unless
 * `presby_current_org()` equals its argument, and this connection has no org
 * context).
 */
export async function countFoundingAdministratorHolders(
  platformDb: PlatformDb | PlatformTx,
  organizationId: string,
): Promise<number> {
  const result = await platformDb.execute(
    sql`select presby_founding_administrator_holder_count(${organizationId}::uuid) as holder_count`,
  );
  return Number(
    (result as unknown as { rows?: Array<{ holder_count?: number | string }> }).rows?.[0]
      ?.holder_count ?? 0,
  );
}
