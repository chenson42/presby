import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { people, memberships } from "@/lib/db/domain/people";
import { appRoles, appRolePermissions, roleGrants } from "@/lib/db/domain/authz";
import { users } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import type { OrganizationType } from "@/lib/authz";

/**
 * The founding-administrator designation — docs/work-log/
 * 2026-09-28-founding-administrator.md, DECISION-155, F107-F112.
 *
 * Closes DECISION-100/101/106's standing gap: `createOrganization()`
 * (src/lib/org-provisioning.ts) seeds exactly one group-arm `member` /
 * `directory.view` role, so nobody at a freshly created organization holds
 * `role_grants.manage` or `roles.manage` — every subsequent grant runs
 * through `assertPermissionSubset()` (src/lib/authz.ts), which refuses a key
 * nobody at the org already holds, and no in-app code path has ever set
 * `people.user_id` for a real account. This module is that path: it
 * resolves a platform operator's typed email to a `users` row, links (or
 * reuses) that account's `people` row at the target organization, and
 * grants an enumerated, unprotected `founding_administrator` role plus the
 * org-type's constitutional office template.
 *
 * CONNECTION CHOICE, STATED ONCE: `getPlatformDb()` throughout, NEVER
 * `withOrgContext()`. `withOrgContext(personId, orgId, fn)` verifies an
 * ACTIVE MEMBERSHIP before trusting the org id, and the precondition of this
 * entire act is that no such membership (and often no such person) exists
 * yet — fabricating one to satisfy the gate would be exactly the
 * "phantom membership" violation of Two Hierarchies Intersect Nowhere that
 * `.../admin/organizations/[id]/actions.ts`'s own header names by name.
 * `docs/schema-design-2.md` §2c's function-mediation rule (a SECURITY
 * DEFINER function for cross-council reach) does not apply either: this act
 * is platform -> one organization, with no second council anywhere in it
 * (DECISION-155, Phase 2 Ruling 1).
 *
 * TWO HIERARCHIES, MECHANICALLY: this module writes no platform-held
 * `role_grants` row, no platform-held `memberships` row, and adds no
 * platform predicate to any tenant authority check. `role_grants.grantedBy`
 * carries the operator's `users.id` as PROVENANCE ONLY -- no arm of the
 * resolver (drizzle/0010_presby_resolver.sql) ever reads it. The mechanical
 * test: `src/lib/authz.ts`, `src/lib/role-definitions.ts`,
 * `src/lib/role-grants.ts` and `drizzle/0010_presby_resolver.sql` are
 * UNCHANGED by this pipeline -- see this module's own test file for the
 * "four files unchanged" assertion that pins it.
 *
 * DECISION-106's subset check (`assertPermissionSubset()`) is NOT bypassed
 * here -- it is simply not on this path. That function takes an `OrgTx` (a
 * `presby_app` transaction) and an `actorPersonId`; this transaction has
 * neither. No bypass parameter is added to `assertPermissionSubset()`,
 * `adoptTemplate()` or `grantRole()` by this pipeline, and none of those
 * three functions are imported here.
 *
 * TWO DELIBERATE DIVERGENCES FROM `createPerson()` (src/lib/people.ts),
 * both because the owner connection sees the world differently than a
 * tenant one (Phase 2 Ruling 1):
 *   1. `.returning({ id: people.id })`, not a client-generated
 *      `randomUUID()`. That trick exists in `createPerson()` only because
 *      `people`'s RETURNING-side SELECT policy bites under `presby_app`;
 *      `neondb_owner` bypasses RLS, so the workaround is unnecessary noise
 *      here.
 *   2. A pre-check `select` for "does this user already have a person row,
 *      and where" is legal on this connection (it sees across every
 *      organization) and is used for the humane, named result below. It is
 *      NOT the sole gate: `memberships_guard_insert` (F108) and
 *      `role_grants_needs_membership` are the authoritative, trigger-level
 *      refusals the pre-check's named result stands in front of.
 *
 * F110/F112 -- `people_user_id_unique_idx` DOES NOT EXIST. Phase 2 Ruling 9
 * designed a partial unique index on `people.user_id` for `drizzle/0054`,
 * but Batch A's pre-flight probe against `development` found it is blocked
 * by a COMMITTED FIXTURE (`scripts/seed-dev.sql`'s `router.dup@` pair,
 * seeded specifically to be the duplicate `userOrganizations()`'s
 * TypeScript de-duplication loop collapses) -- the index and that fixture
 * cannot coexist, so `drizzle/0054` was withheld (see the work-log's Batch A
 * section and the proposed F112). Consequence, stated here so nobody
 * "fixes" this file by assuming the index landed: the pre-check `select` in
 * `resolveDesignee()` below plus the `memberships_guard_insert` trigger
 * refusal are the WHOLE defence against a second live `people` row sharing
 * one `user_id` -- there is no unique-violation catch for it, and none
 * should be added until F112's follow-up pipeline lands the index for real.
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

export type FoundingAdministratorResult =
  | {
      kind: "ok";
      mode: "created_person" | "existing_person";
      personId: string;
      userId: string;
      administrationRoleId: string;
      administrationRoleKey: "founding_administrator";
      officeRoleId: string | null;
      officeRoleKey: string | null;
      /** Union of both halves, for audit metadata. */
      permissionKeys: string[];
      /** Always 0 -- the gate already proved it before any write. */
      priorHolderCount: 0;
    }
  | { kind: "no_such_user" }
  | { kind: "user_inactive" }
  | { kind: "person_elsewhere" }
  | { kind: "membership_ended"; endedOn: string }
  | { kind: "has_holders"; holderCount: number }
  | { kind: "provisioning_incomplete" }
  | { kind: "race" }
  | { kind: "db_error" };

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

/**
 * Concatenates `err.message` with every `.cause` in the chain -- copied
 * (not imported) from `src/lib/people.ts:29-34`'s own helper of the same
 * name and shape. NOT imported from `people.ts` because that module is
 * `withOrgContext()`-only by its own stated convention (one
 * `withOrgContext()` transaction per export); a platform-connection helper
 * importing from it would falsify that module's own header. Drizzle's
 * `DrizzleQueryError` wraps the driver's actual Postgres error as `.cause`,
 * so matching against `err.message` alone misses it entirely.
 */
function errorMessageChain(err: unknown, depth = 0): string {
  if (depth > 5 || err === null || err === undefined) return "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause ? `${message} :: ${errorMessageChain(cause, depth + 1)}` : message;
}

/**
 * `users.name` split on the FIRST space -- firstName is everything before
 * it, lastName is everything after (including any further spaces), falling
 * back to the email local-part when `name` is null or blank. Documented
 * discrepancy: Phase 2 Ruling 6 / Phase 3's prose describes this as "split
 * on the last space," but the pipeline's own worked example (this
 * pipeline's seed fixture, `founding.fixture@example.invalid`, `users.name
 * = "Fixture Founding Admin"`) is stated to yield `firstName: "Fixture"`,
 * `lastName: "Founding Admin"` -- which only a FIRST-space split produces.
 * This implementation follows the worked example (the more specific and
 * more recently verified source) rather than the prose, and names the
 * discrepancy here rather than silently picking one -- see
 * `founding-administrator.test.ts`'s pinned regression case for exactly
 * this fixture name. A single-word name (no space at all) maps both fields
 * to that one word, since neither column tolerates null and an
 * empty-string surname reads as broken in the directory.
 */
export function deriveNameFromUser(
  name: string | null,
  email: string,
): { firstName: string; lastName: string } {
  const trimmed = name?.trim();
  if (trimmed) {
    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace === -1) {
      return { firstName: trimmed, lastName: trimmed };
    }
    return {
      firstName: trimmed.slice(0, firstSpace).trim(),
      lastName: trimmed.slice(firstSpace + 1).trim(),
    };
  }
  const localPart = email.split("@")[0]?.trim();
  const fallback = localPart && localPart.length > 0 ? localPart : email;
  return { firstName: fallback, lastName: fallback };
}

/**
 * How many DISTINCT people currently hold `roles.manage` OR
 * `role_grants.manage` at `organizationId` -- person-arm grants directly,
 * group-arm grants expanded through live (non-ended) `group_memberships`.
 * A DELIBERATE PARALLEL IMPLEMENTATION of `wouldZeroOutRolesManageHolders`
 * (src/lib/role-definitions.ts:171-203), not a shared import: that helper
 * runs on `presby_app` inside `withOrgContext()` and excludes one specific
 * role's own grants (a definition-side edit); this one runs on the platform
 * connection with NO exclusion (there is nothing to exclude -- this asks
 * "does anyone at all currently hold either key"), and it must NOT call
 * `presby_effective_permissions()` (F107): that function raises
 * `insufficient_privilege` unless `presby_current_org()` equals its org
 * argument, and the platform connection has no org context -- satisfying
 * that guard by calling `set_config('app.current_org_id', ...)` on a
 * BYPASSRLS pooled connection is forbidden by Phase 2's Isolation ruling.
 *
 * Exported as `countFoundingAdministratorHolders()` below for `page.tsx`'s
 * own read-only display of the same count; this function is the shared
 * implementation both call.
 */
async function foundingAdministratorHolderCount(
  tx: PlatformTx | PlatformDb,
  organizationId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    with active_manage_grants as (
      select rg.id as grant_id, rg.person_id, rg.group_id
        from role_grants rg
        join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${organizationId}::uuid
         and arp.permission_key in ('roles.manage', 'role_grants.manage')
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    ),
    holder_people as (
      select person_id as pid from active_manage_grants where person_id is not null
      union
      select gm.person_id as pid
        from active_manage_grants amg
        join group_memberships gm on gm.group_id = amg.group_id
       where amg.group_id is not null
         and gm.organization_id = ${organizationId}::uuid
         and gm.ends_on is null
    )
    select count(distinct pid)::int as holder_count from holder_people
  `);
  return (
    (result as unknown as { rows?: Array<{ holder_count?: number }> }).rows?.[0]
      ?.holder_count ?? 0
  );
}

/**
 * Read-only, outside any transaction -- the SAME CTE the designation
 * transaction's own gate runs (`foundingAdministratorHolderCount()` above),
 * exposed for `page.tsx`'s display of "does this organization already have
 * a founding administrator." Read fresh on every call, never cached, per
 * `role-definitions.ts:120-124`'s own "never trusted from an earlier
 * render" discipline -- the caller must re-invoke this on every render, not
 * stash its result.
 */
export async function countFoundingAdministratorHolders(
  platformDb: PlatformDb,
  organizationId: string,
): Promise<number> {
  return foundingAdministratorHolderCount(platformDb, organizationId);
}

type PersonLookupRow = {
  person_id: string;
  membership_org_id: string | null;
  membership_ended_on: string | null;
};

type PersonClassification =
  | { mode: "no_person" }
  | { mode: "existing_person"; personId: string }
  | { mode: "membership_ended"; personId: string; endedOn: string }
  | { mode: "person_elsewhere"; personId: string }
  | { mode: "zero_membership"; personId: string };

/**
 * Classifies a `userId`'s `people` row(s) against `organizationId`. Every
 * `people` row maps to AT MOST ONE `memberships` row in this schema outside
 * `presby_link_person()`'s special path: `presby_guard_membership_insert()`
 * (drizzle/0009) refuses a second `memberships` insert for a person who
 * already has ANY membership row anywhere, ended or not. So under normal
 * operation `rows` has 0 or 1 entries. It can legitimately have MORE than
 * one only in the F110/F112 duplicate-`people`-row-per-`user_id` state this
 * pipeline's own missing index would have forbidden (see this module's
 * header) -- handled defensively below by scanning every candidate row and
 * returning the most specific/most protective classification found, never
 * by assuming uniqueness.
 */
function classifyPersonRows(
  rows: PersonLookupRow[],
  organizationId: string,
): PersonClassification {
  if (rows.length === 0) {
    return { mode: "no_person" };
  }
  const atThisOrg = rows.find((r) => r.membership_org_id === organizationId);
  if (atThisOrg) {
    return atThisOrg.membership_ended_on
      ? {
          mode: "membership_ended",
          personId: atThisOrg.person_id,
          endedOn: atThisOrg.membership_ended_on,
        }
      : { mode: "existing_person", personId: atThisOrg.person_id };
  }
  const elsewhere = rows.find((r) => r.membership_org_id !== null);
  if (elsewhere) {
    return { mode: "person_elsewhere", personId: elsewhere.person_id };
  }
  // Defensive branch (Phase 3's own naming): unreachable through any code
  // path this codebase ships today -- createPerson() and
  // designateFoundingAdministrator() are the only two writers of a
  // people+memberships pair, and both are atomic, so a people row with zero
  // memberships anywhere should not exist. Handled without crashing rather
  // than asserted against a live trigger.
  return { mode: "zero_membership", personId: rows[0]!.person_id };
}

/**
 * Designates `email`'s account as `organizationId`'s founding administrator.
 * ONE `getPlatformDb()` transaction. See this module's header for the
 * connection choice and its two divergences from `createPerson()`.
 *
 * STATEMENT ORDER (binding, work-log Phase 3 "API Contract" / Phase 2
 * Ruling 1/5 -- each step named because a reorder would reopen a finding):
 *
 *   1. `select ... for update` on the organizations row -- the
 *      serialization point (Phase 2 Ruling 5): when the holder count is
 *      zero there are no role_grants rows to lock, so the organizations row
 *      is the phantom-read fix. Also reads `organizationType` fresh here,
 *      never trusted from a caller-supplied value (mirrors
 *      `resolveOrganizationType()`, role-definitions.ts:233-243).
 *   2. The holder-count gate (`foundingAdministratorHolderCount()`) --
 *      count > 0 => `has_holders`, transaction rolls back untouched.
 *   3. User lookup by (pre-normalized) email -- `no_such_user` /
 *      `user_inactive`.
 *   4. Person lookup across the whole database (legal on this connection)
 *      -- classified by `classifyPersonRows()` into `created_person` /
 *      `existing_person` / `membership_ended` / `person_elsewhere` /
 *      the defensive `zero_membership` branch.
 *   5. `people` insert (created_person only), `.returning()`.
 *   6. `memberships` insert (created_person and the defensive
 *      zero_membership branch only) -- staff-style (DECISION-128/129):
 *      `engagementStatus: "staff"`, `currentRoll: null`, no `roll_actions`
 *      row.
 *   7. `app_roles` administration role -- reuse-and-reactivate (F109).
 *   8. `app_roles` office role, when `officeTemplateKey !== null` -- reads
 *      the live template row and its permissions (mirrors
 *      `adoptTemplate()`'s own read, role-definitions.ts:768-858), then the
 *      same reuse-and-reactivate lookup.
 *   9. `app_role_permissions` -- additive-only reconcile (`on conflict do
 *      nothing`), never subtractive, so a recovery designation cannot claw
 *      back a permission the org's own `roles.manage` holder later added.
 *  10. `role_grants` insert(s), person-arm, `grantedBy: operatorUserId`
 *      (provenance only -- no resolver arm reads it).
 *  11. Return `{ kind: "ok", ... }`.
 *
 * ERROR CATCHES, in this order, all matched via `errorMessageChain()`:
 *   - `memberships_guard_insert` (F108) -> `person_elsewhere`. The
 *     authoritative backstop behind step 4's pre-check.
 *   - `role_grants_needs_membership` -> `membership_ended`. Backstop for a
 *     race between step 4's classification and step 10's write; the exact
 *     ended date is not parsed out of the trigger's message (Phase 3's own
 *     instruction) and is not otherwise available post-error (Postgres
 *     aborts the rest of the transaction once one statement raises), so
 *     this backstop path reports the refusal without a specific date. Not
 *     reachable through step 4's own classification, which already returns
 *     `membership_ended` (with a real date) before any write is attempted.
 *   - the derived-group sync trigger's FK message -> `provisioning_incomplete`.
 *     Reachable only for an organization predating the F16 group seed.
 *   - `isUniqueViolation(err)` -> `race`. The `app_roles_org_key` TOCTOU
 *     backstop behind steps 7/8's reuse-and-reactivate lookup -- same
 *     posture as `createOrganization()`'s `slug_taken` catch.
 *   - anything else -> `db_error`, logged via `console.error` (matching
 *     `recordAudit()`'s own swallow-and-log posture) and returned typed,
 *     NOT rethrown -- a deliberate, named divergence from
 *     `org-provisioning.ts`'s "unknown errors rethrow" convention: this
 *     page's other actions all return a `PolicyResult` and never let an
 *     exception reach the client, and an admin who just typed an email will
 *     retry immediately.
 */
export async function designateFoundingAdministrator(
  organizationId: string,
  email: string,
  operatorUserId: string,
): Promise<FoundingAdministratorResult> {
  const platformDb = getPlatformDb();
  const normalizedEmail = email.trim().toLowerCase();

  try {
    return await platformDb.transaction(async (tx) => {
      // Step 1: lock the organization row, read its type fresh.
      const [orgRow] = await tx
        .select({
          id: organizations.id,
          organizationType: organizations.organizationType,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update")
        .limit(1);
      if (!orgRow) {
        // Programmer error: the caller already resolved this organization
        // to render the admin page it is calling from. Thrown, not a typed
        // result -- matching grantRole()'s own "malformed input" contract.
        throw new Error(
          `designateFoundingAdministrator: no organization ${organizationId}`,
        );
      }

      // Step 2: the gate. Blocked while ANY roles.manage/role_grants.manage
      // holder is currently effective -- the same sentence as the
      // lockout-recovery condition (Phase 2 Ruling 5).
      const holderCount = await foundingAdministratorHolderCount(
        tx,
        organizationId,
      );
      if (holderCount > 0) {
        return { kind: "has_holders" as const, holderCount };
      }

      // Step 3: user lookup.
      const [userRow] = await tx
        .select({ id: users.id, isActive: users.isActive, name: users.name })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (!userRow) {
        return { kind: "no_such_user" as const };
      }
      if (!userRow.isActive) {
        return { kind: "user_inactive" as const };
      }

      // Step 4: person lookup, across the whole database (legal on this
      // connection -- Ruling 1 divergence 2).
      const personRowsResult = await tx.execute(sql`
        select p.id as person_id,
               m.organization_id as membership_org_id,
               m.ended_on as membership_ended_on
          from people p
          left join memberships m on m.person_id = p.id
         where p.user_id = ${userRow.id}::uuid
           and p.merged_into_id is null
      `);
      const personRows = (
        personRowsResult as unknown as { rows?: PersonLookupRow[] }
      ).rows ?? [];
      const classification = classifyPersonRows(personRows, organizationId);

      if (classification.mode === "membership_ended") {
        return {
          kind: "membership_ended" as const,
          endedOn: classification.endedOn,
        };
      }
      if (classification.mode === "person_elsewhere") {
        return { kind: "person_elsewhere" as const };
      }

      let personId: string;
      let mode: "created_person" | "existing_person";

      if (classification.mode === "no_person") {
        mode = "created_person";
        const { firstName, lastName } = deriveNameFromUser(
          userRow.name,
          normalizedEmail,
        );
        const [personRow] = await tx
          .insert(people)
          .values({ firstName, lastName, userId: userRow.id })
          .returning({ id: people.id });
        personId = personRow!.id;

        // Step 6 (created_person branch): staff-style membership
        // (DECISION-128/129). No roll_actions row, ever, for this kind.
        await tx.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "staff",
        });
      } else if (classification.mode === "zero_membership") {
        // Defensive branch (see classifyPersonRows()'s own comment): a
        // people row with no membership anywhere. Treated as
        // existing_person's identity, but still needs the membership row
        // this org requires.
        mode = "existing_person";
        personId = classification.personId;
        await tx.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "staff",
        });
      } else {
        // classification.mode === "existing_person"
        mode = "existing_person";
        personId = classification.personId;
      }

      // Step 7: administration role, reuse-and-reactivate (F109).
      const plan = foundingAdministratorPlan(orgRow.organizationType);
      const administrationRoleId = await upsertAppRole(tx, {
        organizationId,
        key: plan.administration.key,
        name: plan.administration.name,
      });
      await addPermissionsToRole(
        tx,
        administrationRoleId,
        plan.administration.permissionKeys,
      );

      // Step 8: office role, only when the org type has one. Reads the
      // live template row's own permission set so drizzle/0037/0052 stay
      // the single source (mirrors adoptTemplate(), role-definitions.ts:
      // 768-858).
      let officeRoleId: string | null = null;
      let officeRoleKey: string | null = null;
      let officePermissionKeys: string[] = [];
      if (plan.officeTemplateKey) {
        const [template] = await tx
          .select({
            id: appRoles.id,
            key: appRoles.key,
            name: appRoles.name,
          })
          .from(appRoles)
          .where(
            and(
              eq(appRoles.key, plan.officeTemplateKey),
              isNull(appRoles.organizationId),
              or(
                isNull(appRoles.organizationTypeScope),
                eq(appRoles.organizationTypeScope, orgRow.organizationType),
              ),
            ),
          )
          .limit(1);
        if (template) {
          officePermissionKeys = await permissionKeysForRole(tx, template.id);
          officeRoleId = await upsertAppRole(tx, {
            organizationId,
            key: template.key,
            name: template.name,
          });
          officeRoleKey = template.key;
          await addPermissionsToRole(tx, officeRoleId, officePermissionKeys);
        }
        // template not found: the catalog is missing a row this pipeline
        // expects to exist. Not modeled as a distinct result variant
        // (Phase 3 did not name one) -- the act still succeeds with the
        // administration half alone, same as a type with no office at all.
      }

      // Step 10: grants, person-arm, one per role minted/reused above.
      await tx.insert(roleGrants).values({
        organizationId,
        roleId: administrationRoleId,
        personId,
        grantedBy: operatorUserId,
        grantReason: "founding administrator designation",
      });
      if (officeRoleId) {
        await tx.insert(roleGrants).values({
          organizationId,
          roleId: officeRoleId,
          personId,
          grantedBy: operatorUserId,
          grantReason: "founding administrator designation",
        });
      }

      return {
        kind: "ok" as const,
        mode,
        personId,
        userId: userRow.id,
        administrationRoleId,
        administrationRoleKey: "founding_administrator" as const,
        officeRoleId,
        officeRoleKey,
        permissionKeys: [
          ...plan.administration.permissionKeys,
          ...officePermissionKeys,
        ],
        priorHolderCount: 0 as const,
      };
    });
  } catch (err) {
    const chain = errorMessageChain(err);
    if (/already exists elsewhere/.test(chain)) {
      return { kind: "person_elsewhere" };
    }
    if (
      /cannot open a position at an organization where the membership ended on/.test(
        chain,
      )
    ) {
      // Backstop only -- see this function's own doc comment. Step 4's
      // classification already returns membership_ended (with a real date)
      // before any write is attempted; reaching this catch means the
      // membership ended in the narrow window between that read and this
      // write, and Postgres has already aborted the rest of the
      // transaction, so no further read can recover the date.
      return { kind: "membership_ended", endedOn: "unknown" };
    }
    if (/has no derived group active_membership/.test(chain)) {
      return { kind: "provisioning_incomplete" };
    }
    if (isUniqueViolation(err)) {
      return { kind: "race" };
    }
    // Matches recordAudit()'s own swallow-and-log posture; an unexpected DB
    // error here must never crash the caller (this page's other actions all
    // return a PolicyResult, never let an exception reach the client).
    console.error("[designateFoundingAdministrator] unexpected error", err);
    return { kind: "db_error" };
  }
}

/** Every `app_role_permissions` key currently bound to `roleId`. Sibling to
 * `role-definitions.ts`'s private helper of the same name and shape
 * (role-definitions.ts:99-108) -- not imported, since that module is
 * `withOrgContext()`-only. */
async function permissionKeysForRole(
  tx: PlatformTx,
  roleId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ permissionKey: appRolePermissions.permissionKey })
    .from(appRolePermissions)
    .where(eq(appRolePermissions.roleId, roleId));
  return rows.map((r) => r.permissionKey);
}

/**
 * F109 -- reuse-and-reactivate. Looks up `(organizationId, key)` in
 * `app_roles` (unique per `app_roles_org_key`); if found, clears
 * `deactivatedAt` when set and returns the existing id; if not found,
 * inserts a fresh, unprotected, custom-kind row. A recovery designation
 * (the org's `founding_administrator`/office role already exists, possibly
 * deactivated with its grants ended) reuses rather than inserting a second
 * row, which would collide with `app_roles_org_key` and surface as `race`.
 */
async function upsertAppRole(
  tx: PlatformTx,
  input: { organizationId: string; key: string; name: string },
): Promise<string> {
  const [existing] = await tx
    .select({ id: appRoles.id, deactivatedAt: appRoles.deactivatedAt })
    .from(appRoles)
    .where(
      and(
        eq(appRoles.organizationId, input.organizationId),
        eq(appRoles.key, input.key),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.deactivatedAt !== null) {
      await tx
        .update(appRoles)
        .set({ deactivatedAt: null })
        .where(eq(appRoles.id, existing.id));
    }
    return existing.id;
  }
  const [inserted] = await tx
    .insert(appRoles)
    .values({
      organizationId: input.organizationId,
      key: input.key,
      name: input.name,
      roleKind: "custom",
      isProtected: false,
    })
    .returning({ id: appRoles.id });
  return inserted!.id;
}

/**
 * Additive-only reconcile (tech-lead's ruling, work-log Phase 3 API
 * Contract step 9, not in Phase 2's own text): `on conflict do nothing` for
 * every key in `permissionKeys`, NEVER subtractive. A recovery designation
 * must restore at least the bundle's floor; it must not claw back a
 * permission the org's own `roles.manage` holder deliberately added to
 * either role after the first designation.
 */
async function addPermissionsToRole(
  tx: PlatformTx,
  roleId: string,
  permissionKeys: string[],
): Promise<void> {
  if (permissionKeys.length === 0) return;
  await tx
    .insert(appRolePermissions)
    .values(permissionKeys.map((permissionKey) => ({ roleId, permissionKey })))
    .onConflictDoNothing();
}
