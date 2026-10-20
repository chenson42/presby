import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { appRoles, appRolePermissions, roleGrants } from "@/lib/db/domain/authz";
import { users } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";

/**
 * The first-treasurer designation — docs/work-log/2026-10-15-online-giving.md,
 * Phase 2 R2 (G1, DECISION-170), Phase 3 "Designation". A second, narrow
 * instance of DECISION-155's shape (`founding-administrator.ts`, which this
 * file sits beside and mirrors): a platform operator names the first holder
 * of `giving.manage` at a congregation that has none, and after that the
 * congregation runs its own giving team through `src/lib/giving/team.ts`
 * (R3, F138). It is NOT the F111 resolution and does not subsume it.
 *
 * WHAT IT DOES, in R2's order (each step named because a reorder reopens a
 * finding):
 *   1. `select ... for update` on the organizations row, reading the type
 *      fresh. Anything but `congregation` / `new_worshiping_community` is
 *      `not_applicable` (a presbytery cannot hold giving keys: the toggle
 *      and this designation both refuse it).
 *   2. The zero-holder GATE: nobody currently effectively holds
 *      `giving.manage` at this org, counting person-arm grants and live
 *      group-arm grants as a plain CTE. NEVER `presby_effective_permissions()`
 *      (F107: it raises unless `presby_current_org()` equals its argument, and
 *      this connection has no org context; satisfying that by `set_config` on
 *      a BYPASSRLS connection is forbidden). Blocked while any holder exists;
 *      the block condition and the lockout-recovery condition are one
 *      sentence (R2).
 *   3. User lookup by normalized email: `no_such_user` / `user_inactive`.
 *   4. The user's live person must hold an ACTIVE MEMBERSHIP at THIS org:
 *      `not_a_member` / `membership_ended`. THIS CREATES NO PERSON AND NO
 *      MEMBERSHIP — unlike the founding administrator, a treasurer is already
 *      someone at the congregation (the founding administrator can enrol a
 *      staff-kind anchor first). Fabricating a membership to satisfy a gate
 *      is the "phantom membership" violation Two Hierarchies forbids.
 *   5. Reuse-and-reactivate (F109) the org-owned `treasurer` role, copied
 *      from the template row (kind and protected flag included), with an
 *      ADDITIVE-ONLY permission reconcile (`on conflict do nothing`): a
 *      recovery designation restores the floor and never claws back what the
 *      congregation's own `roles.manage` holder added.
 *   6. Likewise mint, but DO NOT GRANT, the org-owned `giving_recorder`
 *      role, so the first treasurer can immediately delegate recording
 *      (F138) without needing `roles.manage` they will not hold.
 *   7. One person-arm `role_grants` row for the treasurer role:
 *      `granted_by` = the operator (provenance only; no resolver arm reads
 *      it), `grant_reason` = "treasurer designation".
 *
 * CONNECTION CHOICE, STATED ONCE: `getPlatformDb()` for the whole
 * transaction, never `withOrgContext()`, for the reason
 * `founding-administrator.ts`'s header gives (the act is a platform
 * operator's, and its precondition is that no holder of any key that could
 * satisfy `withOrgContext`'s callers exists). It writes NO giving table and
 * adds no platform predicate to any tenant authority check (Two Hierarchies):
 * the grant is an ordinary `role_grants` row once minted. THE FOUR
 * RESOLVER-SIDE FILES — `src/lib/authz.ts`, `src/lib/role-definitions.ts`,
 * `src/lib/role-grants.ts`, `drizzle/0010_presby_resolver.sql` — ARE NOT
 * IMPORTED HERE AND ARE UNCHANGED BY THIS PIPELINE; the sibling test pins both
 * facts. `assertPermissionSubset()`, `adoptTemplate()` and `grantRole()` are
 * untouched and unreachable from this module.
 *
 * Imports no giving table (`@/lib/db/domain/giving`): the designation is
 * authority plumbing, not giving data, and a static test holds the line.
 */

/** Organization types a treasurer can be designated at. An ALLOW-LIST — the
 * org-type enum has five values and a new one must default to "not
 * applicable". Equal to `ORG_FEATURE_CATALOG`'s `org_portal.giving`
 * `orgTypes` (set-equality pinned in the catalog test). */
export const TREASURER_DESIGNATION_ORG_TYPES = [
  "congregation",
  "new_worshiping_community",
] as const;

type DesignationOrgType = (typeof TREASURER_DESIGNATION_ORG_TYPES)[number];

/** Whether `organizationType` is one a treasurer can be designated at. */
export function treasurerDesignationApplies(
  organizationType: string,
): organizationType is DesignationOrgType {
  return (TREASURER_DESIGNATION_ORG_TYPES as readonly string[]).includes(
    organizationType,
  );
}

const MANAGE_KEY = "giving.manage";
const TREASURER_ROLE_KEY = "treasurer";
const RECORDER_ROLE_KEY = "giving_recorder";

export type TreasurerDesignationResult =
  | {
      kind: "ok";
      personId: string;
      userId: string;
      treasurerRoleId: string;
      recorderRoleId: string;
      /** Union of both roles' bound keys after the additive reconcile, for
       * audit metadata. */
      permissionKeys: string[];
      /** Always 0 — the gate already proved it before any write. */
      priorHolderCount: 0;
    }
  | { kind: "not_applicable" }
  | { kind: "has_holders"; holderCount: number }
  | { kind: "no_such_user" }
  | { kind: "user_inactive" }
  | { kind: "not_a_member" }
  | { kind: "membership_ended"; endedOn: string }
  | { kind: "provisioning_incomplete" }
  | { kind: "race" }
  | { kind: "db_error" };

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

/** `err.message` plus every `.cause` — copied (not imported) from
 * `founding-administrator.ts` for the same reason that module copies it from
 * `people.ts`: Drizzle wraps the driver's Postgres error as `.cause`. */
function errorMessageChain(err: unknown, depth = 0): string {
  if (depth > 5 || err === null || err === undefined) return "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause ? `${message} :: ${errorMessageChain(cause, depth + 1)}` : message;
}

/**
 * How many DISTINCT people CURRENTLY EFFECTIVELY hold `giving.manage` at
 * `organizationId`: a person-arm grant, or a group-arm grant expanded through
 * a live group membership. "Effective" mirrors the resolver's own arms 1 and
 * 2 (`presby_effective_permissions()`, and the inline copy in
 * `presby_two_factor_required()` arm B): the grant is inside its date window,
 * the person is not merged and holds an ACTIVE membership at this org, and a
 * group-arm member's group membership is inside its window. Without the
 * membership condition a grant stranded on someone whose membership ended
 * would count as a holder the resolver does not recognise, and the control
 * (and lockout recovery) would never reappear.
 *
 * Commission and delegation arms are deliberately absent: DECISION-175 (1) /
 * F139 — three 0055 triggers refuse a role carrying a `giving` module key as
 * an `administrative_commissions` / `org_delegations` role, so those arms
 * cannot carry `giving.manage`.
 *
 * A plain CTE on the platform connection, NEVER `presby_effective_permissions()`
 * (F107, see this module's header). Exported for the admin page's read-only
 * display; the designation transaction runs the same function as its gate.
 */
export async function countGivingManageHolders(
  tx: PlatformTx | PlatformDb,
  organizationId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    with manage_grants as (
      select rg.person_id, rg.group_id
        from role_grants rg
        join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${organizationId}::uuid
         and arp.permission_key = ${MANAGE_KEY}
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    ),
    holder_people as (
      select mg.person_id as pid
        from manage_grants mg
       where mg.person_id is not null
      union
      select gm.person_id as pid
        from manage_grants mg
        join group_memberships gm on gm.group_id = mg.group_id
       where mg.group_id is not null
         and gm.organization_id = ${organizationId}::uuid
         and gm.starts_on <= current_date
         and (gm.ends_on is null or gm.ends_on > current_date)
    )
    select count(distinct hp.pid)::int as holder_count
      from holder_people hp
      join people p on p.id = hp.pid and p.merged_into_id is null
      join memberships m on m.person_id = hp.pid
       and m.organization_id = ${organizationId}::uuid
       and m.ended_on is null
  `);
  return (
    (result as unknown as { rows?: Array<{ holder_count?: number }> }).rows?.[0]
      ?.holder_count ?? 0
  );
}

type PersonMembershipRow = {
  person_id: string;
  membership_ended_on: string | null;
};

/**
 * Designates `email`'s account as `organizationId`'s first treasurer. ONE
 * `getPlatformDb()` transaction; see this module's header for the order.
 *
 * ERROR CATCHES (all matched through `errorMessageChain()`), mirroring
 * `designateFoundingAdministrator`:
 *   - `role_grants_needs_membership` -> `membership_ended`. A backstop for a
 *     race between step 4's read and step 7's write; Postgres aborts the rest
 *     of the transaction once a statement raises, so the date is not
 *     recoverable and is reported as "unknown". Step 4 itself returns the
 *     real date before any write is attempted.
 *   - the derived-group sync trigger's FK message -> `provisioning_incomplete`.
 *   - `isUniqueViolation` -> `race` (`app_roles_org_key` TOCTOU behind steps
 *     5/6's reuse-and-reactivate lookup).
 *   - anything else -> `db_error`, logged (class only, via the error chain's
 *     own console line) and returned typed rather than rethrown: the page's
 *     other actions never let an exception reach the client, and an operator
 *     who just typed an email will retry immediately.
 */
export async function designateTreasurer(
  organizationId: string,
  email: string,
  operatorUserId: string,
): Promise<TreasurerDesignationResult> {
  const platformDb = getPlatformDb();
  const normalizedEmail = email.trim().toLowerCase();

  try {
    return await platformDb.transaction(async (tx) => {
      // Step 1: serialize on the org row, read the type fresh.
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
        // Programmer error: the caller resolved this organization to render
        // the page it is calling from. Thrown, not a typed result.
        throw new Error(`designateTreasurer: no organization ${organizationId}`);
      }
      if (!treasurerDesignationApplies(orgRow.organizationType)) {
        return { kind: "not_applicable" as const };
      }

      // Step 2: the gate.
      const holderCount = await countGivingManageHolders(tx, organizationId);
      if (holderCount > 0) {
        return { kind: "has_holders" as const, holderCount };
      }

      // Step 3: user lookup.
      const [userRow] = await tx
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (!userRow) return { kind: "no_such_user" as const };
      if (!userRow.isActive) return { kind: "user_inactive" as const };

      // Step 4: the user's live person, at THIS org. Creates nothing. A user
      // can (in the F110/F112 duplicate-person state) have more than one live
      // person row, so scan them all and prefer an active membership here.
      const personRowsResult = await tx.execute(sql`
        select p.id as person_id, m.ended_on as membership_ended_on
          from people p
          join memberships m on m.person_id = p.id
           and m.organization_id = ${organizationId}::uuid
         where p.user_id = ${userRow.id}::uuid
           and p.merged_into_id is null
      `);
      const personRows =
        (personRowsResult as unknown as { rows?: PersonMembershipRow[] }).rows ??
        [];
      const active = personRows.find((r) => r.membership_ended_on === null);
      if (!active) {
        const ended = personRows[0];
        if (ended) {
          return {
            kind: "membership_ended" as const,
            endedOn: String(ended.membership_ended_on),
          };
        }
        return { kind: "not_a_member" as const };
      }
      const personId = active.person_id;

      // Steps 5-6: read BOTH templates first (so a missing one aborts before
      // any write), then mint/reuse the org-owned roles.
      const treasurerTemplate = await readTemplate(
        tx,
        TREASURER_ROLE_KEY,
        orgRow.organizationType,
      );
      const recorderTemplate = await readTemplate(
        tx,
        RECORDER_ROLE_KEY,
        orgRow.organizationType,
      );
      if (!treasurerTemplate || !recorderTemplate) {
        return { kind: "provisioning_incomplete" as const };
      }

      const treasurerRoleId = await upsertAppRole(tx, organizationId, {
        key: treasurerTemplate.key,
        name: treasurerTemplate.name,
        roleKind: treasurerTemplate.roleKind,
        isProtected: treasurerTemplate.isProtected,
      });
      await addPermissionsToRole(tx, treasurerRoleId, treasurerTemplate.permissionKeys);

      const recorderRoleId = await upsertAppRole(tx, organizationId, {
        key: recorderTemplate.key,
        name: recorderTemplate.name,
        roleKind: recorderTemplate.roleKind,
        isProtected: recorderTemplate.isProtected,
      });
      await addPermissionsToRole(tx, recorderRoleId, recorderTemplate.permissionKeys);

      // Step 7: ONE grant, person-arm, treasurer only. The recorder role is
      // minted and left ungranted.
      await tx.insert(roleGrants).values({
        organizationId,
        roleId: treasurerRoleId,
        personId,
        grantedBy: operatorUserId,
        grantReason: "treasurer designation",
      });

      return {
        kind: "ok" as const,
        personId,
        userId: userRow.id,
        treasurerRoleId,
        recorderRoleId,
        permissionKeys: [
          ...new Set([
            ...treasurerTemplate.permissionKeys,
            ...recorderTemplate.permissionKeys,
          ]),
        ].sort(),
        priorHolderCount: 0 as const,
      };
    });
  } catch (err) {
    const chain = errorMessageChain(err);
    if (
      /cannot open a position at an organization where the membership ended on/.test(
        chain,
      )
    ) {
      return { kind: "membership_ended", endedOn: "unknown" };
    }
    if (/has no derived group active_membership/.test(chain)) {
      return { kind: "provisioning_incomplete" };
    }
    if (isUniqueViolation(err)) {
      return { kind: "race" };
    }
    console.error("[designateTreasurer] unexpected error", err);
    return { kind: "db_error" };
  }
}

type RoleTemplate = {
  id: string;
  key: string;
  name: string;
  roleKind: string;
  isProtected: boolean;
  permissionKeys: string[];
};

/** The live template row (`organization_id IS NULL`) for `key`, in scope for
 * `organizationType`, with its bound permission keys — so 0055's template
 * stays the single source for what each role carries. */
async function readTemplate(
  tx: PlatformTx,
  key: string,
  organizationType: string,
): Promise<RoleTemplate | null> {
  const [template] = await tx
    .select({
      id: appRoles.id,
      key: appRoles.key,
      name: appRoles.name,
      roleKind: appRoles.roleKind,
      isProtected: appRoles.isProtected,
    })
    .from(appRoles)
    .where(
      and(
        eq(appRoles.key, key),
        isNull(appRoles.organizationId),
        or(
          isNull(appRoles.organizationTypeScope),
          // The scope column is a pg enum; the value was already proven to be
          // one of its members by `treasurerDesignationApplies`.
          eq(
            appRoles.organizationTypeScope,
            organizationType as DesignationOrgType,
          ),
        ),
      ),
    )
    .limit(1);
  if (!template) return null;
  const keys = await tx
    .select({ permissionKey: appRolePermissions.permissionKey })
    .from(appRolePermissions)
    .where(eq(appRolePermissions.roleId, template.id));
  return { ...template, permissionKeys: keys.map((k) => k.permissionKey) };
}

/**
 * F109 — reuse-and-reactivate. Looks up `(organizationId, key)`; if found,
 * clears `deactivatedAt` when set and returns the existing id UNCHANGED
 * otherwise (its name, kind and protected flag are the congregation's now);
 * if not found, inserts a row copying the template's kind and protected flag.
 */
async function upsertAppRole(
  tx: PlatformTx,
  organizationId: string,
  input: { key: string; name: string; roleKind: string; isProtected: boolean },
): Promise<string> {
  const [existing] = await tx
    .select({ id: appRoles.id, deactivatedAt: appRoles.deactivatedAt })
    .from(appRoles)
    .where(
      and(eq(appRoles.organizationId, organizationId), eq(appRoles.key, input.key)),
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
      organizationId,
      key: input.key,
      name: input.name,
      roleKind: input.roleKind,
      isProtected: input.isProtected,
    })
    .returning({ id: appRoles.id });
  return inserted!.id;
}

/** Additive-only reconcile: `on conflict do nothing`, never subtractive. */
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
