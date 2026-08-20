import "server-only";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import {
  appRolePermissions,
  appRoles,
  roleGrants,
} from "@/lib/db/domain/authz";
import { groups } from "@/lib/db/domain/groups";
import { memberships, people } from "@/lib/db/domain/people";

/**
 * Tenant role administration — P9 (`docs/work-log/2026-08-19-tenant-
 * administration.md`, DECISION-066/067/068). Grants and revokes EXISTING
 * `role_grants` rows for EXISTING `app_roles`; it creates neither (out of
 * scope, per Phase 1's "no wildcard-role-template" finding).
 *
 * SAME SHAPE AS `src/lib/directory.ts` (DECISION-061's precedent, extended
 * by DECISION-068 to the first tenant MUTATION module): one
 * `withOrgContext()` transaction per exported function, doing everything —
 * permission check, validation, the write — inside it. Thrown exceptions for
 * genuine failure (bad input shape, `OrgAccessError`); typed result variants
 * for every expected/denied outcome. Never conflate the two: a caller must be
 * able to tell "you don't hold role_grants.manage" apart from "the database
 * is down" without a try/catch around a result read.
 *
 * SIX ADVERSARIAL FINDINGS, each closed by a specific piece of this module,
 * not by the caller:
 *
 *   1. Self/other-escalation (`grantRole`) — DECISION-068's subset check.
 *      The granter's own `presby_effective_permissions()` set is read INSIDE
 *      this transaction and compared against the target role's
 *      `app_role_permissions`; a grant whose role carries anything the
 *      granter does not already hold is rejected with the missing keys
 *      named, never silently narrowed or silently allowed.
 *   2. Cross-org write — every function takes `organizationId` as an
 *      explicit parameter it never re-derives from anything client-supplied;
 *      `withOrgContext()` re-verifies the caller's OWN membership at that
 *      org before any query runs, and `grantRole`/`revokeRole` additionally
 *      re-verify the ROLE and the TARGET belong to this same org before
 *      touching the subset check (closes the "supply an id from another
 *      org" variant specifically).
 *   3. No wildcard template — this module has no "create a role" or "edit a
 *      role's permissions" surface at all; it only ever reads
 *      `app_role_permissions` rows that already exist.
 *   4. The arm-1 cascade gap, surfaced not fixed — `listGrants` joins
 *      `memberships.ended_on` for a person-arm grant and returns it
 *      VERBATIM as `membershipEnded`. A grant on a lapsed membership is not
 *      filtered out and not auto-ended; it is exactly as visible as any
 *      other row, with the one extra fact a viewer needs to notice it.
 *   5. Enumeration via the bare `people` table — `getGrantFormOptions`'s
 *      person list is a JOIN through `memberships` scoped to this org
 *      (current only, `ended_on is null`), the same F21 shape
 *      `directory.ts` already closed once. A person who is only a member
 *      elsewhere never appears, even though `people` itself has no
 *      organization scoping to prevent a bare scan from finding them.
 *   6. Self-lockout — `revokeRole` counts every OTHER currently-effective
 *      `role_grants.manage` holder at this org (expanding a group grant to
 *      its live `group_memberships`) before ending a grant whose role
 *      itself carries `role_grants.manage`, and refuses (writing nothing)
 *      if that count would hit zero. A grant whose role does not carry
 *      `role_grants.manage` skips the count entirely — it carries no
 *      lockout risk.
 *
 * THE FORBIDDEN CHECK RUNS FIRST IN ALL FOUR FUNCTIONS — `listGrants`,
 * `getGrantFormOptions`, `grantRole`, `revokeRole` — via the private
 * `hasRoleGrantsManage` helper below, a single `presby_has_permission(...,
 * 'role_grants.manage')` call, before any other work. This is load-bearing,
 * not incidental: `role_grants.manage` is the entire reason DECISION-066
 * minted a new constitutional role instead of extending `session_member` or
 * bootstrapping onto `active_membership` — "that would hand every member
 * the power to grant roles to every other member" is DECISION-066's own
 * phrase for the exact failure mode a missing gate on `grantRole`
 * reproduces. Without this check, ANY current member — holding nothing but
 * the baseline `directory.view` every `active_membership` grants via
 * `member` — could call `grantRole` for any role whose permission set is a
 * subset of what they already hold (e.g. `member` itself, or `property_
 * chair`), with zero `role_grants.manage` and zero administrative standing.
 * That is a real authorization bypass, caught in review (not by the
 * flagship test, which this history is worth keeping): an earlier draft of
 * this module omitted the gate specifically to satisfy that flagship test's
 * literal wording ("a person holding ONLY `directory.view` ... attempts to
 * grant a role carrying `role_grants.manage`" was read as requiring the
 * granter to REACH the subset check without holding `role_grants.manage`
 * first) — but the gate-then-subset ordering below is what the six
 * adversarial findings, DECISION-066, and Phase 1's own one-line take
 * ("nobody can pass a permission check to administer anyone else's access")
 * all actually require. The flagship escalation scenario in
 * `role-grants.test.ts` is fixture'd accordingly: a person who legitimately
 * holds `role_grants.manage` (and nothing else) attempting to grant a role
 * that ALSO requires a permission they don't hold — that is the case the
 * subset check exists for, and it is meaningless to test on a granter who
 * never gets past the gate.
 *
 * THE SUBSET CHECK IS A SECOND, INDEPENDENT LAYER ON TOP OF THE GATE, not a
 * replacement for it — DECISION-068's actual purpose: even a legitimate
 * `role_grants.manage` holder cannot use that one permission to hand out
 * OTHER permissions they don't personally hold (a narrowly-scoped
 * administrative role, e.g. one bound only to `role_grants.manage`, cannot
 * launder itself into `roll.approve` by granting a role that carries both).
 * Granting a role that itself carries `role_grants.manage` additionally
 * requires already holding it via the gate above — the subset check's own
 * "you must hold what you hand out" property is defense in depth on top of
 * that, not the sole mechanism.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROLE_GRANTS_MANAGE = "role_grants.manage";

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The single-permission gate every exported function in this module checks
 * FIRST. Not exported — this is deliberately the one place
 * `presby_has_permission(..., 'role_grants.manage')` is spelled out, so the
 * four call sites cannot drift the way `directory.ts`'s own header warns a
 * hand-copied check eventually would.
 */
async function hasRoleGrantsManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${ROLE_GRANTS_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// listGrants
// ---------------------------------------------------------------------------

export interface GrantListEntry {
  grantId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  grantee:
    | {
        kind: "person";
        personId: string;
        displayName: string;
        /** 'YYYY-MM-DD', or null. Finding 4 — surfaced verbatim, never
         * filtered and never treated as an implicit revoke. */
        membershipEnded: string | null;
      }
    | { kind: "group"; groupId: string; groupName: string };
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  grantedByEmail: string | null;
  grantReason: string | null;
}

export type GrantListResult =
  | { kind: "ok"; grants: GrantListEntry[] }
  | { kind: "forbidden" };

interface GrantListRow {
  grant_id: string;
  role_id: string;
  role_key: string;
  role_name: string;
  person_id: string | null;
  group_id: string | null;
  person_first_name: string | null;
  person_last_name: string | null;
  person_preferred_name: string | null;
  membership_ended: string | null;
  group_name: string | null;
  starts_on: string;
  granted_by_email: string | null;
  grant_reason: string | null;
}

/**
 * Who holds what, right now, at `organizationId` — Flow 3 (DECISION-067's
 * partial consolation for the deferred tenant audit reader). Only
 * currently-effective grants (`starts_on <= current_date`, `ends_on is null
 * or ends_on > current_date`); an ended grant is history, not "who holds
 * what today", and belongs to the audit reader this pipeline explicitly does
 * not build.
 */
export async function listGrants(
  viewerPersonId: string,
  organizationId: string,
): Promise<GrantListResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRoleGrantsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select
        rg.id                as grant_id,
        rg.role_id            as role_id,
        ar.key                as role_key,
        ar.name               as role_name,
        rg.person_id           as person_id,
        rg.group_id            as group_id,
        p.first_name           as person_first_name,
        p.last_name            as person_last_name,
        p.preferred_name       as person_preferred_name,
        m.ended_on::text       as membership_ended,
        g.name                 as group_name,
        rg.starts_on::text     as starts_on,
        u.email                as granted_by_email,
        rg.grant_reason        as grant_reason
        from role_grants rg
        join app_roles ar on ar.id = rg.role_id
        left join people p on p.id = rg.person_id
        left join memberships m
               on m.person_id = rg.person_id
              and m.organization_id = rg.organization_id
        left join groups g on g.id = rg.group_id
        left join users u on u.id = rg.granted_by
       where rg.organization_id = ${organizationId}::uuid
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
       order by ar.name, p.last_name, p.first_name, g.name
    `);

    const rows = (result as unknown as { rows?: GrantListRow[] }).rows ?? [];
    const grants: GrantListEntry[] = rows.map((row) => {
      const grantee: GrantListEntry["grantee"] =
        row.person_id !== null
          ? {
              kind: "person",
              personId: row.person_id,
              displayName: `${row.person_preferred_name ?? row.person_first_name} ${row.person_last_name}`,
              membershipEnded: row.membership_ended,
            }
          : {
              kind: "group",
              groupId: row.group_id as string,
              groupName: row.group_name ?? "",
            };
      return {
        grantId: row.grant_id,
        roleId: row.role_id,
        roleKey: row.role_key,
        roleName: row.role_name,
        grantee,
        startsOn: row.starts_on,
        grantedByEmail: row.granted_by_email,
        grantReason: row.grant_reason,
      };
    });

    return { kind: "ok", grants };
  });
}

// ---------------------------------------------------------------------------
// getGrantFormOptions
// ---------------------------------------------------------------------------

export interface GrantFormOptions {
  roles: Array<{ id: string; key: string; name: string }>;
  people: Array<{ personId: string; displayName: string }>;
  groups: Array<{ groupId: string; name: string; derived: boolean }>;
}

export type GrantFormOptionsResult =
  | { kind: "ok"; options: GrantFormOptions }
  | { kind: "forbidden" };

/**
 * The grant form's own data — roles and groups scoped by `organization_id`
 * (RLS + an explicit `where`, belt and suspenders since these are tenant
 * tables), and people scoped through `memberships` — NEVER a bare `select *
 * from people` (finding 5).
 */
export async function getGrantFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<GrantFormOptionsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRoleGrantsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const roleRows = await tx
      .select({ id: appRoles.id, key: appRoles.key, name: appRoles.name })
      .from(appRoles)
      .where(eq(appRoles.organizationId, organizationId))
      .orderBy(appRoles.name);

    // Finding 5: scoped through memberships, current only. A person who is
    // only a member at a DIFFERENT org never appears here, no matter how
    // many rows a bare `people` scan would find.
    const peopleRows = await tx
      .select({
        personId: memberships.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .orderBy(people.lastName, people.firstName);

    const groupRows = await tx
      .select({
        id: groups.id,
        name: groups.name,
        derivedFrom: groups.derivedFrom,
      })
      .from(groups)
      .where(eq(groups.organizationId, organizationId))
      .orderBy(groups.name);

    return {
      kind: "ok",
      options: {
        roles: roleRows,
        people: peopleRows.map((row) => ({
          personId: row.personId,
          displayName: `${row.preferredName ?? row.firstName} ${row.lastName}`,
        })),
        groups: groupRows.map((row) => ({
          groupId: row.id,
          name: row.name,
          derived: row.derivedFrom !== null,
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// grantRole
// ---------------------------------------------------------------------------

export type RoleGrantee =
  | { kind: "person"; personId: string }
  | { kind: "group"; groupId: string };

export interface GrantRoleInput {
  roleId: string;
  target: RoleGrantee;
  /** 'YYYY-MM-DD', defaults to today. */
  startsOn?: string;
}

export type GrantResult =
  | { kind: "ok"; grantId: string; roleKey: string }
  | { kind: "forbidden" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "invalid_role" }
  | { kind: "invalid_target" };

/**
 * Grants `input.roleId` to `input.target` at `organizationId`.
 *
 * `granterUserId` IS DELIBERATELY A SEPARATE PARAMETER FROM
 * `granterPersonId`, and this is not a stylistic choice — `role_grants.
 * granted_by` is a foreign key to `users.id` (the platform identity), while
 * every other identity this function touches (`granterPersonId`, the
 * membership checks `withOrgContext()` runs, the subset check's own
 * `effective permissions` lookup) is `people.id` (the tenant identity).
 * Reusing `granterPersonId` for `granted_by` would violate the FK the moment
 * `people.id !== users.id`, which is the common case, not the exception —
 * see `src/lib/brand/read-org-brand.ts`'s header for the SAME bug, caught by
 * running the equivalent code against a real browser rather than trusting
 * the shape on paper (P0.5). The Server Action layer (`admin/roles/
 * actions.ts`) is what has both ids available at once, from `cachedAuth()`
 * (`session.user.id`, a `users.id`) and `resolveOrgContext()`
 * (`resolved.org.personId`, a `people.id`) — it passes both in rather than
 * this function re-deriving one from the other.
 *
 * ORDER OF OPERATIONS, each step named because a later reorder would
 * reopen a finding:
 *   0. `hasRoleGrantsManage` gate — `forbidden` if the granter doesn't hold
 *      `role_grants.manage` at all. Runs before anything else, same as the
 *      other three exported functions — see the module header for why this
 *      is load-bearing, not incidental.
 *   1. Validate `roleId` belongs to THIS org — `invalid_role`, not a thrown
 *      error and not `escalation_denied`, so the caller can render "that
 *      role doesn't exist" distinctly from "you can't grant that".
 *   2. Validate the target (a current membership, or a group) belongs to
 *      THIS org — `invalid_target`, same reasoning.
 *   3. DECISION-068's subset check — the granter's live
 *      `presby_effective_permissions()` set against the target role's
 *      `app_role_permissions`, both read inside this same transaction.
 *      `escalation_denied` names every missing key. A second, independent
 *      authorization layer on top of step 0 — see the module header.
 *   4. Insert.
 */
export async function grantRole(
  granterPersonId: string,
  organizationId: string,
  granterUserId: string,
  input: GrantRoleInput,
): Promise<GrantResult> {
  if (input.startsOn !== undefined && !DATE_RE.test(input.startsOn)) {
    // Genuine bad input, not a denial — thrown, per this module's own
    // "thrown exceptions for genuine failure" contract.
    throw new Error(
      `grantRole: startsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.startsOn)}`,
    );
  }

  return withOrgContext(granterPersonId, organizationId, async (tx) => {
    if (!(await hasRoleGrantsManage(tx, granterPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [role] = await tx
      .select({ id: appRoles.id, key: appRoles.key })
      .from(appRoles)
      .where(
        and(
          eq(appRoles.id, input.roleId),
          eq(appRoles.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!role) {
      return { kind: "invalid_role" };
    }

    if (input.target.kind === "person") {
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, input.target.personId),
            eq(memberships.organizationId, organizationId),
            isNull(memberships.endedOn),
          ),
        )
        .limit(1);
      if (!membership) {
        return { kind: "invalid_target" };
      }
    } else {
      const [group] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(
            eq(groups.id, input.target.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!group) {
        return { kind: "invalid_target" };
      }
    }

    // DECISION-068: two ordinary, already-org-scoped reads inside this same
    // transaction — no new SQL function, no crossing an org boundary.
    const granterPermsResult = await tx.execute(sql`
      select permission_key
        from presby_effective_permissions(
               ${granterPersonId}::uuid,
               ${organizationId}::uuid,
               current_date
             )
    `);
    const granterPermKeys = new Set(
      (
        (
          granterPermsResult as unknown as {
            rows?: Array<{ permission_key: string }>;
          }
        ).rows ?? []
      ).map((r) => r.permission_key),
    );

    const targetPermsResult = await tx.execute(sql`
      select permission_key
        from app_role_permissions
       where role_id = ${input.roleId}::uuid
    `);
    const targetPermKeys = (
      (
        targetPermsResult as unknown as {
          rows?: Array<{ permission_key: string }>;
        }
      ).rows ?? []
    ).map((r) => r.permission_key);

    const missingPermissions = targetPermKeys.filter(
      (key) => !granterPermKeys.has(key),
    );
    if (missingPermissions.length > 0) {
      return { kind: "escalation_denied", missingPermissions };
    }

    const startsOn = input.startsOn ?? todayDateString();
    const [inserted] = await tx
      .insert(roleGrants)
      .values({
        organizationId,
        roleId: input.roleId,
        personId: input.target.kind === "person" ? input.target.personId : null,
        groupId: input.target.kind === "group" ? input.target.groupId : null,
        startsOn,
        grantedBy: granterUserId,
      })
      .returning({ id: roleGrants.id });

    return { kind: "ok", grantId: inserted!.id, roleKey: role.key };
  });
}

// ---------------------------------------------------------------------------
// revokeRole
// ---------------------------------------------------------------------------

export type RevokeResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "self_lockout_blocked" };

/**
 * Ends `grantId` (`ends_on = current_date`) — NEVER deletes; the row is the
 * audit trail (finding 4's cascade-gap discussion applies here too: an ended
 * grant stays a readable fact forever).
 *
 * Finding 6 — before ending a grant whose role itself carries
 * `role_grants.manage`, counts every OTHER currently-effective
 * `role_grants.manage` holder at this org (a person-arm grant counts its
 * person directly; a group-arm grant expands to its live, non-ended
 * `group_memberships`) and refuses with `self_lockout_blocked`, writing
 * nothing, if that count would hit zero. A grant whose role does not carry
 * `role_grants.manage` skips the count — there is no lockout risk to guard.
 */
export async function revokeRole(
  granterPersonId: string,
  organizationId: string,
  grantId: string,
): Promise<RevokeResult> {
  return withOrgContext(granterPersonId, organizationId, async (tx) => {
    if (!(await hasRoleGrantsManage(tx, granterPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [grant] = await tx
      .select({ id: roleGrants.id, roleId: roleGrants.roleId })
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.id, grantId),
          eq(roleGrants.organizationId, organizationId),
          lte(roleGrants.startsOn, sql`current_date`),
          or(
            isNull(roleGrants.endsOn),
            gt(roleGrants.endsOn, sql`current_date`),
          ),
        ),
      )
      .limit(1);
    if (!grant) {
      return { kind: "not_found" };
    }

    const [managePermission] = await tx
      .select({ permissionKey: appRolePermissions.permissionKey })
      .from(appRolePermissions)
      .where(
        and(
          eq(appRolePermissions.roleId, grant.roleId),
          eq(appRolePermissions.permissionKey, ROLE_GRANTS_MANAGE),
        ),
      )
      .limit(1);

    if (managePermission) {
      const holderResult = await tx.execute(sql`
        with active_manage_grants as (
          select rg.id as grant_id, rg.person_id, rg.group_id
            from role_grants rg
            join app_role_permissions arp on arp.role_id = rg.role_id
           where rg.organization_id = ${organizationId}::uuid
             and arp.permission_key = ${ROLE_GRANTS_MANAGE}
             and rg.id != ${grantId}::uuid
             and rg.starts_on <= current_date
             and (rg.ends_on is null or rg.ends_on > current_date)
        ),
        holder_people as (
          select person_id as pid
            from active_manage_grants
           where person_id is not null
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
      const holderCount =
        (
          holderResult as unknown as {
            rows?: Array<{ holder_count?: number }>;
          }
        ).rows?.[0]?.holder_count ?? 0;
      if (holderCount === 0) {
        return { kind: "self_lockout_blocked" };
      }
    }

    await tx.execute(sql`
      update role_grants set ends_on = current_date where id = ${grantId}::uuid
    `);

    return { kind: "ok" };
  });
}
