import "server-only";
import { inArray, sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { people } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { UUID_RE } from "./input";
import { parseReason } from "./designation-holder-copy";
import {
  buildHolderRows,
  type CompanionGrantRow,
  type HolderGrantRow,
  type RolePermissionRow,
} from "./designation-holder-rows";
import type {
  DesignationSlot,
  HolderActor,
  HolderRow,
  HolderSubjectKind,
} from "./designation-holder-types";

/**
 * Who holds a designation slot, and the one act of ending them (docs/work-log/
 * 2026-10-22-designation-revoke.md, Phase 3; DECISION-194/195/196, F169/F171).
 *
 * CONNECTION: `getPlatformDb()` ONLY, and this module is imported only from
 * `(admin)` code (`boundaries.test.ts` holds both lines). The caller is a
 * platform operator acting on a tenant as lockout recovery; there is no tenant
 * membership to verify, exactly as `issue.ts`. `src/lib/role-grants.ts` is the
 * tenant (`presby_app`) module and never imports the owner connection.
 *
 * READ: `listDesignationHolders` reads the slot's owner-only list function
 * (the single source the holder count is derived from, F169), the designation's
 * companion grants (founding administrator only), the display names of the
 * PERSON-arm subjects only, and the permission descriptions of the roles
 * involved. The names select names no contact or email column, and a group's
 * members are never name-resolved (DECISION-195). A failed read THROWS, exactly
 * as the count reads did: the page error boundary shows, and the invite form is
 * never offered off an empty list that was really a read failure.
 *
 * WRITE: `revokeDesignationHolder` runs `presby_revoke_designation_holder()`
 * (the ONLY platform-side writer of `role_grants.ends_on`) and, on `revoked`
 * only, the audit row, in ONE transaction via `insertAuditRow(tx, ...)`: a
 * failed audit insert rolls the revoke back (Workflow Rule 7). A refused or
 * idempotent outcome mutates nothing and writes no row. No `update role_grants`
 * appears in this file; the write lives in the SQL function.
 *
 * DATES cross the driver as YYYY-MM-DD strings (`::text`), never a typed date expression.
 * `uuid[]` crosses as a regex-validated `{id,id}` text literal cast `::uuid[]`
 * (drizzle's `sql` expands a JS array into a record, which is not an array).
 */

type PlatformDb = ReturnType<typeof getPlatformDb>;

export type { DesignationSlot, HolderRow } from "./designation-holder-types";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Error CLASS only, for logs: never the message (it can carry values). */
function errorClass(err: unknown): string {
  const code = codeOf(err) ?? codeOf((err as { cause?: unknown } | null)?.cause);
  const name = err instanceof Error ? err.name : typeof err;
  return code ? `${name}/${code}` : name;
}

function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

/** A `{id,id}` uuid[] literal; throws on anything that is not a uuid. */
function uuidArrayLiteral(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error("not a uuid");
  }
  return `{${ids.join(",")}}`;
}

function displayNameOf(row: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${row.preferredName ?? row.firstName} ${row.lastName}`;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export async function listDesignationHolders(
  platformDb: PlatformDb,
  organizationId: string,
  slot: DesignationSlot,
): Promise<{ holderPeopleCount: number; rows: HolderRow[] }> {
  // (1) The slot's list function: the single source (F169).
  const listFn =
    slot === "founding_administrator"
      ? sql`presby_founding_administrator_holder_grants`
      : sql`presby_giving_manage_holder_grants`;
  const grants = rowsOf<HolderGrantRow>(
    await platformDb.execute(sql`
      select grant_id::text, role_id::text, role_key, role_name, arm,
             subject_person_id::text, group_id::text, group_name, group_membership_source,
             holder_person_id::text, grant_starts_on::text, grant_reason
        from ${listFn}(${organizationId}::uuid)`),
  );

  const personSubjectIds = [
    ...new Set(grants.filter((g) => g.arm === "person" && g.subject_person_id).map((g) => g.subject_person_id!)),
  ];

  // (2) The designation's companion grants, one lateral query for every person.
  let companions: CompanionGrantRow[] = [];
  if (slot === "founding_administrator" && personSubjectIds.length > 0) {
    companions = rowsOf<CompanionGrantRow>(
      await platformDb.execute(sql`
        select s.person_id::text as person_id, c.grant_id::text, c.role_id::text,
               c.role_key, c.role_name, c.grant_starts_on::text
          from unnest(${uuidArrayLiteral(personSubjectIds)}::uuid[]) as s(person_id)
         cross join lateral presby_founding_administrator_companion_grants(
               ${organizationId}::uuid, s.person_id) c`),
    );
  }

  // (3) Display names, person-arm subjects only. No contact or email column.
  const names = new Map<string, string>();
  if (personSubjectIds.length > 0) {
    const nameRows = await platformDb
      .select({
        id: people.id,
        firstName: people.firstName,
        preferredName: people.preferredName,
        lastName: people.lastName,
      })
      .from(people)
      .where(inArray(people.id, personSubjectIds));
    for (const row of nameRows) names.set(row.id, displayNameOf(row));
  }

  // (4) What the roles involved carry, for the dialog's sentences.
  const roleIds = [...new Set([...grants.map((g) => g.role_id), ...companions.map((c) => c.role_id)])];
  let rolePermissions: RolePermissionRow[] = [];
  if (roleIds.length > 0) {
    rolePermissions = rowsOf<RolePermissionRow>(
      await platformDb.execute(sql`
        select arp.role_id::text as role_id, p.key, p.description
          from app_role_permissions arp
          join permissions p on p.key = arp.permission_key
         where arp.role_id = any(${uuidArrayLiteral(roleIds)}::uuid[])
         order by p.key`),
    );
  }

  return buildHolderRows({ slot, grants, companions, names, rolePermissions });
}

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------

export type RevokeDesignationHolderResult =
  | { kind: "revoked"; reachedZero: boolean }
  | { kind: "already_removed" }
  | { kind: "changed" }
  | { kind: "not_a_holder" }
  | { kind: "derived_group_refused" }
  | { kind: "not_applicable" }
  | { kind: "no_organization" }
  | { kind: "invalid_input"; field: "reason"; message: string }
  | { kind: "db_error" };

export interface RevokeDesignationHolderInput {
  organizationId: string;
  slot: DesignationSlot;
  subjectKind: HolderSubjectKind;
  subjectId: string;
  expectedGrantIds: string[];
  reason: string;
  actor: HolderActor;
}

interface RevokeFunctionRow {
  outcome: string;
  grant_ids: string[] | null;
  role_keys: string[] | null;
  applied_ends_on: string[] | null;
  clamped_to_membership_end: boolean | null;
  companion_grant_ids: string[] | null;
  revoked_holder_person_ids: string[] | null;
  holder_count_before: number | null;
  holder_count_after: number | null;
  open_invitation_ids: string[] | null;
}

const AUDIT_KEY = {
  founding_administrator: AUDIT_ACTIONS.ORG_FOUNDING_ADMINISTRATOR_REVOKED,
  treasurer: AUDIT_ACTIONS.ORG_TREASURER_REVOKED,
} as const;

const NON_REVOKED = new Set([
  "already_removed",
  "changed",
  "not_a_holder",
  "derived_group_refused",
  "not_applicable",
  "no_organization",
]);

export async function revokeDesignationHolder(
  input: RevokeDesignationHolderInput,
): Promise<RevokeDesignationHolderResult> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return { kind: "invalid_input", field: "reason", message: reason.message };

  try {
    return await getPlatformDb().transaction(async (tx): Promise<RevokeDesignationHolderResult> => {
      const result = await tx.execute(sql`
        select outcome, grant_ids::text[] as grant_ids, role_keys,
               applied_ends_on::text[] as applied_ends_on, clamped_to_membership_end,
               companion_grant_ids::text[] as companion_grant_ids,
               revoked_holder_person_ids::text[] as revoked_holder_person_ids,
               holder_count_before, holder_count_after,
               open_invitation_ids::text[] as open_invitation_ids
          from presby_revoke_designation_holder(
                 ${input.organizationId}::uuid, ${input.slot}::text, ${input.subjectKind}::text,
                 ${input.subjectId}::uuid, ${uuidArrayLiteral(input.expectedGrantIds)}::uuid[])`);
      const row = rowsOf<RevokeFunctionRow>(result)[0];
      if (!row) throw new Error("presby_revoke_designation_holder returned no row");

      if (row.outcome !== "revoked") {
        if (NON_REVOKED.has(row.outcome)) return { kind: row.outcome } as RevokeDesignationHolderResult;
        throw new Error("unexpected revoke outcome");
      }

      const revokedPeople = row.revoked_holder_person_ids ?? [];
      let selfRevoke = false;
      if (revokedPeople.length > 0) {
        const self = await tx.execute(sql`
          select 1 as hit from people
           where user_id = ${input.actor.userId}::uuid
             and id = any(${uuidArrayLiteral(revokedPeople)}::uuid[])
           limit 1`);
        selfRevoke = rowsOf<unknown>(self).length > 0;
      }

      const holderCountAfter = row.holder_count_after ?? 0;
      await insertAuditRow(tx, {
        action: AUDIT_KEY[input.slot],
        actor: { userId: input.actor.userId, email: input.actor.email },
        resourceType: "organization",
        resourceId: input.organizationId,
        metadata: {
          organizationId: input.organizationId,
          slot: input.slot,
          arm: input.subjectKind,
          ...(input.subjectKind === "person"
            ? { personId: input.subjectId }
            : { groupId: input.subjectId }),
          grantIds: row.grant_ids ?? [],
          roleKeys: row.role_keys ?? [],
          appliedEndsOn: row.applied_ends_on ?? [],
          clampedToMembershipEnd: row.clamped_to_membership_end === true,
          companionGrantIds: row.companion_grant_ids ?? [],
          reason: reason.reason,
          holderCountBefore: row.holder_count_before ?? 0,
          holderCountAfter: holderCountAfter,
          reachedZero: holderCountAfter === 0,
          selfRevoke,
          openInvitationIds: row.open_invitation_ids ?? [],
        },
      });

      return { kind: "revoked", reachedZero: holderCountAfter === 0 };
    });
  } catch (err) {
    console.error("[designation-holders] revoke failed:", errorClass(err));
    return { kind: "db_error" };
  }
}
