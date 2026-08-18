import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Tenant authorization.
 *
 * TWO AUTHORIZATION SCOPES, deliberately separate — the same "two hierarchies
 * intersect nowhere" invariant the schema is built on:
 *
 *   PLATFORM   `src/lib/permissions.ts` (FEATURES, roles, user_roles).
 *              Inherited from the starter. Governs the /admin shell: users,
 *              flags, email queue, audit viewer. Global, small, and FROZEN —
 *              no church-facing feature is ever added to it.
 *
 *   TENANT     this file. Governs everything church-facing, resolved per
 *              organization and per date by presby_effective_permissions().
 *
 * A platform admin is not above a national admin, and holding every platform
 * feature grants nothing inside a congregation: the tenant connection is
 * NOBYPASSRLS, so platform-ness cannot widen a tenant query.
 */

export type PermissionSource = "direct" | "group" | "commission" | "delegation";

export interface EffectivePermission {
  permission_key: string;
  sensitivity_tier: number;
  source_kind: PermissionSource;
  source_name: string;
  role_name: string;
  grant_id: string;
}

/**
 * Runs `fn` with the organization context set for the duration of ONE
 * transaction, and only after confirming the person actually belongs to that
 * organization.
 *
 * The verification is not optional. RLS enforces TENANCY, not AUTHORIZATION:
 * the policy trusts whatever org id it is handed, so it stops a query crossing
 * tenants but does not decide which tenant you are. That check lives here.
 *
 * `set_config(..., true)` is transaction-local. Anything else would leak the
 * context to the next request on a pooled connection.
 */
export async function withOrgContext<T>(
  personId: string,
  organizationId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Membership check runs BEFORE the context is set, so it cannot be
    // satisfied by the very context it is meant to authorize.
    const check = await tx.execute(sql`
      select 1 from memberships
       where person_id = ${personId}::uuid
         and organization_id = ${organizationId}::uuid
         and ended_on is null
       limit 1
    `);
    const rows = (check as unknown as { rows?: unknown[] }).rows ?? [];
    if (rows.length === 0) {
      throw new Error(
        `withOrgContext: person ${personId} holds no active membership at ${organizationId}`,
      );
    }

    await tx.execute(
      sql`select set_config('app.current_org_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Every permission this person holds at this organization, with provenance.
 *
 * `asOf` exists so an audit can ask who could approve payments in March. It is
 * also why a term ending drops access on its own: the resolver reads dates
 * rather than row existence.
 */
export async function effectivePermissions(
  personId: string,
  organizationId: string,
  asOf?: Date,
): Promise<EffectivePermission[]> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const asOfDate = asOf ? asOf.toISOString().slice(0, 10) : null;
    const result = await tx.execute(sql`
      select * from presby_effective_permissions(
        ${personId}::uuid,
        ${organizationId}::uuid,
        coalesce(${asOfDate}::date, current_date)
      )
    `);
    return (
      (result as unknown as { rows?: EffectivePermission[] }).rows ?? []
    );
  });
}

/** Route-gate predicate. */
export async function hasPermission(
  personId: string,
  organizationId: string,
  permissionKey: string,
  asOf?: Date,
): Promise<boolean> {
  const perms = await effectivePermissions(personId, organizationId, asOf);
  return perms.some((p) => p.permission_key === permissionKey);
}

/**
 * Explains a permission: which role granted it, and via what.
 *
 * Built alongside the resolver rather than after it, because a union-based
 * model becomes unauditable within a year without one. "Why can Jane see the
 * donor list" has to have an answer before an AI support worker is allowed
 * anywhere near the permission system.
 */
export async function explainPermission(
  personId: string,
  organizationId: string,
  permissionKey: string,
): Promise<EffectivePermission[]> {
  const perms = await effectivePermissions(personId, organizationId);
  return perms.filter((p) => p.permission_key === permissionKey);
}

/**
 * Organizations this signed-in user can act in — the org switcher's data.
 *
 * A person routinely holds more than one: an installed pastor has membership at
 * the presbytery and service at a congregation, and a ruling elder may sit on a
 * presbytery committee. Assuming one org per user is the easiest thing to bake
 * into the first screen and the most annoying to unpick later.
 */
export async function availableOrganizations(userId: string) {
  // Goes through a SECURITY DEFINER function, not a plain query. This is a
  // genuine cross-org read: with no org context RLS correctly returns nothing,
  // and with one set it would only ever return that single org. The function is
  // scoped to the caller's OWN person rows, so it reveals nothing but where the
  // user already belongs.
  const result = await db.execute(sql`
    select * from presby_available_organizations(${userId}::uuid)
  `);
  return (
    (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []
  );
}
