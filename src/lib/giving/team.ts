import "server-only";
import {
  ensureTreasuryRole,
  grantTreasuryRole,
  listTreasuryTeam,
  revokeTreasuryRole,
  TEAM_SURFACES,
  type EnsureTreasuryRoleResult,
  type GrantTreasuryRoleResult,
  type RevokeTreasuryRoleResult,
} from "@/lib/treasury/team";

/**
 * The giving team - docs/work-log/2026-10-15-online-giving.md, Phase 2 R3
 * (F138, DECISION-170), Phase 3 P3-18 and the Phase 3 API contract "team.ts".
 *
 * NOW A WRAPPER (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-14,
 * F296). The logic - the five safety steps, the subset rule called unchanged,
 * the revoke that ends and never deletes - lives in `@/lib/treasury/team`,
 * parameterized by a surface; this file is `surface: "giving"` with the exported
 * names and result kinds this module always had, so the giving team actions,
 * page and tests import it unchanged.
 *
 * WHAT CHANGED UNDERNEATH. "Giving-only" widened to "treasury-only": a role is
 * delegable here when every key it carries is in a treasury module (giving or
 * reimbursement), because the `treasurer` role now carries reimbursement keys
 * too (drizzle/0074) and the F138 point of this page is handing the treasurer
 * role to a successor. The page still lists only roles and grants that carry a
 * giving key, and the actor gate is still `giving.manage`. The result kind
 * `not_giving_only` keeps its name for the callers that switch on it; it now
 * means "carries a key outside Giving and Reimbursements".
 *
 * The audit writes (`TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` with
 * `path: "giving_team"`, `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`) belong to
 * `team/actions.ts`, after the commit.
 */

export const GIVING_TEMPLATE_KEYS = ["treasurer", "giving_recorder"] as const;
export type GivingTemplateKey = (typeof GIVING_TEMPLATE_KEYS)[number];

// The wrapper's list and the shared surface table must agree.
if (TEAM_SURFACES.giving.templateKeys.join() !== GIVING_TEMPLATE_KEYS.join()) {
  throw new Error("giving/team.ts: GIVING_TEMPLATE_KEYS disagrees with TEAM_SURFACES.giving");
}

// ---------------------------------------------------------------------------
// listGivingTeam
// ---------------------------------------------------------------------------

export interface TeamGrant {
  grantId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  grantee:
    | { kind: "person"; personId: string; displayName: string }
    | { kind: "group"; groupName: string };
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  givingKeys: string[];
  /** False when the role carries non-treasury keys or the grant is group-arm: end it under Roles. */
  endableHere: boolean;
}

export interface TeamRole {
  id: string;
  key: string;
  name: string;
  givingKeys: string[];
}

export type ListGivingTeamResult =
  | {
      kind: "ok";
      grants: TeamGrant[];
      /** Active, org-owned, treasury-only roles that carry a giving key. */
      assignableRoles: TeamRole[];
      /** Current members a role can be granted to (names only). */
      people: Array<{ personId: string; displayName: string }>;
      /** The giving template roles this org has no active role for. */
      missingTemplates: GivingTemplateKey[];
    }
  | { kind: "forbidden" };

export async function listGivingTeam(
  personId: string,
  organizationId: string,
): Promise<ListGivingTeamResult> {
  const result = await listTreasuryTeam("giving", personId, organizationId);
  if (result.kind === "forbidden") return result;
  return {
    kind: "ok",
    grants: result.grants.map(({ ownKeys, ...grant }): TeamGrant => ({ ...grant, givingKeys: ownKeys })),
    assignableRoles: result.assignableRoles.map(({ ownKeys, ...role }): TeamRole => ({ ...role, givingKeys: ownKeys })),
    people: result.people,
    missingTemplates: result.missingTemplates as GivingTemplateKey[],
  };
}

// ---------------------------------------------------------------------------
// grantGivingRole
// ---------------------------------------------------------------------------

export type GrantGivingRoleResult =
  | Exclude<GrantTreasuryRoleResult, { kind: "not_treasury_only" }>
  /** Empty, or carries a key outside Giving and Reimbursements: use Roles instead. */
  | { kind: "not_giving_only" };

export async function grantGivingRole(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  input: { roleId: string; personId: string },
): Promise<GrantGivingRoleResult> {
  const result = await grantTreasuryRole("giving", actorPersonId, organizationId, actorUserId, input);
  return result.kind === "not_treasury_only" ? { kind: "not_giving_only" } : result;
}

// ---------------------------------------------------------------------------
// revokeGivingRole
// ---------------------------------------------------------------------------

export type RevokeGivingRoleResult =
  | Exclude<RevokeTreasuryRoleResult, { kind: "not_treasury_only" }>
  /** A group-arm grant, or a role with keys outside Giving and Reimbursements: end it under Roles. */
  | { kind: "not_giving_only" };

export async function revokeGivingRole(
  actorPersonId: string,
  organizationId: string,
  input: { grantId: string },
): Promise<RevokeGivingRoleResult> {
  const result = await revokeTreasuryRole("giving", actorPersonId, organizationId, input);
  return result.kind === "not_treasury_only" ? { kind: "not_giving_only" } : result;
}

// ---------------------------------------------------------------------------
// ensureGivingRole (P3-18)
// ---------------------------------------------------------------------------

export type EnsureGivingRoleResult =
  | Exclude<EnsureTreasuryRoleResult, { kind: "not_treasury_only" }>
  /** The org's role of that key carries a key outside Giving and Reimbursements. */
  | { kind: "not_giving_only" };

/**
 * Reuse-and-reactivate (F109) the org-owned role built from a giving template;
 * see `ensureTreasuryRole`. Only the two giving templates are reachable
 * (`templateKey` is a closed enum).
 */
export async function ensureGivingRole(
  actorPersonId: string,
  organizationId: string,
  input: { templateKey: GivingTemplateKey },
): Promise<EnsureGivingRoleResult> {
  const result = await ensureTreasuryRole("giving", actorPersonId, organizationId, input);
  return result.kind === "not_treasury_only" ? { kind: "not_giving_only" } : result;
}
