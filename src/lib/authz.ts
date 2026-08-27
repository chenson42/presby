import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";

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

/**
 * Thrown by `withOrgContext` when the in-transaction membership check finds no
 * active relationship.
 *
 * Typed rather than a bare `Error` so the `(org)` error boundary can tell "your
 * access to this organization ended" apart from a genuine fault, and so a
 * future logger can key on it.
 *
 * REACHING THIS IS THE RARE PATH, and that is by design. The common cases —
 * bookmark, revoked access, a slug the user was never a member of — are caught
 * by `resolveOrgContext()` returning `ended` / `forbidden` / `not-found`, which
 * produce named, humane pages. This error is the genuine race: the membership
 * disappears BETWEEN the resolve and the transaction. Next replaces an error
 * message with a digest in production, so the boundary that catches it cannot
 * render the organization name — the named message has to come from
 * `resolveOrgContext`, not from here.
 */
export class OrgAccessError extends Error {
  readonly personId: string;
  readonly organizationId: string;

  constructor(personId: string, organizationId: string) {
    super(
      `withOrgContext: person ${personId} holds no active membership at ${organizationId}`,
    );
    this.name = "OrgAccessError";
    this.personId = personId;
    this.organizationId = organizationId;
  }
}

/**
 * The transaction handle every tenant-mutation module's per-export
 * transaction runs in — `withOrgContext`'s own callback parameter, named so
 * `assertPermissionSubset` (and any future shared, mid-transaction helper)
 * can spell it out without redeclaring the same `Parameters<Parameters<...>>`
 * indirection at every call site (`role-grants.ts`/`role-definitions.ts`
 * previously each carried their own private copy of this exact type).
 */
export type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  fn: (tx: OrgTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Membership check runs BEFORE the context is set, so it cannot be
    // satisfied by the very context it is meant to authorize.
    //
    // IT GOES THROUGH A SECURITY DEFINER FUNCTION, AND THAT IS LOAD-BEARING.
    // `memberships` is FORCE RLS on `organization_id = presby_current_org()`,
    // and at this point no org GUC is set — deliberately. A plain SELECT here
    // is therefore filtered to zero rows for EVERY person at EVERY
    // organization, so the gate rejects the members it exists to admit:
    // failing closed, looking correct, and taking the whole org portal with it.
    // That was a real, measured defect (drizzle/0015_presby_membership_probe.sql
    // records the numbers) and it is finding F26 in its purest form. Rewriting
    // this as a Drizzle join re-breaks it silently; scripts/test-rls.sql
    // section 13 is what fails if anyone does.
    const check = await tx.execute(sql`
      select presby_membership_is_active(
               ${personId}::uuid,
               ${organizationId}::uuid
             ) as is_active
    `);
    const rows =
      (check as unknown as { rows?: Array<{ is_active?: boolean }> }).rows ?? [];
    if (rows[0]?.is_active !== true) {
      throw new OrgAccessError(personId, organizationId);
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
 * The escalation-check DECISION-068 introduced for `grantRole()` — extracted
 * (DECISION-106 ruling 1) so every write that changes what a role can do runs
 * the same posture, not just grants. `docs/work-log/
 * 2026-08-26-role-permissions-admin.md`'s Phase 1 central finding was
 * precisely that role-*definition* edits (create a role, edit its permission
 * set, adopt a template) had NO equivalent check at all — an admin holding
 * `roles.manage` could edit a role they already hold to add a tier-3
 * permission with zero escalation review, since no `role_grants` row was ever
 * inserted for that path.
 *
 * Reads the actor's own live `presby_effective_permissions()` set INSIDE
 * `tx` — the caller's already-open `withOrgContext()` transaction; this
 * function never opens its own, so it can run mid-transaction from
 * `role-grants.ts`'s `grantRole()` and `role-definitions.ts`'s
 * `createRole()`/`setRolePermissions()`/`adoptTemplate()` alike — and diffs
 * `proposedPermissionKeys` against it. Missing keys are named, never
 * silently narrowed or silently allowed.
 *
 * CALL-SITE CONTRACT, and it differs by caller on purpose:
 *   - `grantRole()` passes the target role's FULL permission set — its
 *     existing, unchanged behavior; only the check's location moved here.
 *   - `setRolePermissions()` passes only the ADDED DELTA, never the full
 *     resulting set. A pure permission REMOVAL has an empty delta, which is
 *     why the empty-array case below short-circuits to `{ ok: true }` before
 *     touching the database at all, rather than falling through to a query
 *     whose `missingPermissions` would happen to also come back empty for
 *     the wrong reason: removing a permission can never escalate anyone, and
 *     a round trip that merely happens to agree with that is not the same
 *     property as never being reachable as a false denial in the first
 *     place.
 */
export async function assertPermissionSubset(
  tx: OrgTx,
  actorPersonId: string,
  organizationId: string,
  proposedPermissionKeys: string[],
): Promise<{ ok: true } | { ok: false; missingPermissions: string[] }> {
  if (proposedPermissionKeys.length === 0) {
    return { ok: true };
  }

  const actorPermsResult = await tx.execute(sql`
    select permission_key
      from presby_effective_permissions(
             ${actorPersonId}::uuid,
             ${organizationId}::uuid,
             current_date
           )
  `);
  const actorPermKeys = new Set(
    (
      (
        actorPermsResult as unknown as {
          rows?: Array<{ permission_key: string }>;
        }
      ).rows ?? []
    ).map((r) => r.permission_key),
  );

  const missingPermissions = proposedPermissionKeys.filter(
    (key) => !actorPermKeys.has(key),
  );
  if (missingPermissions.length > 0) {
    return { ok: false, missingPermissions };
  }
  return { ok: true };
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

export type OrganizationType =
  | "general_assembly"
  | "synod"
  | "presbytery"
  | "congregation"
  | "new_worshiping_community";

export type PlatformStatus = "managed" | "unmanaged" | "invited";

/**
 * One relationship between a user and an organization.
 *
 * NOT "one membership the user is on the roll of". DECISION-039: `memberships`
 * is the universal relationship anchor and roll status is a COLUMN on it, not
 * its meaning — the presbytery-committee elder, the secretary who worships
 * elsewhere, and the installed pastor whose membership is at the presbytery all
 * appear here. Anything rendered from this must therefore carry no membership
 * language; the org name and type are the whole of it.
 */
export interface UserOrganization {
  organizationId: string;
  personId: string;
  membershipId: string;
  name: string;
  organizationType: OrganizationType;
  slug: string;
  platformStatus: PlatformStatus;
  /** 'YYYY-MM-DD', or null when the relationship is current. */
  endedOn: string | null;
  /** ISO-8601. Ordering input only; never rendered. */
  membershipCreatedAt: string;
}

interface UserOrganizationRow {
  organization_id: string;
  person_id: string;
  membership_id: string;
  name: string;
  organization_type: string;
  slug: string;
  platform_status: string;
  ended_on: string | null;
  membership_created_at: string;
}

/**
 * Every organization this user holds a relationship with — ended ones and
 * non-tenant ones included, filtered by nothing but the caller's own identity.
 *
 * A person routinely holds more than one: an installed pastor has membership at
 * the presbytery and service at a congregation, and a ruling elder may sit on a
 * presbytery committee. Assuming one org per user is the easiest thing to bake
 * into the first screen and the most annoying to unpick later.
 *
 * This is the unfiltered truth on purpose. `/no-organization` has to tell
 * "you're not connected to a congregation" apart from "your only congregation
 * is still being set up", and the org-lost path has to name and date the
 * relationship that ended. A function that filtered would force a second one
 * the first time either of those was written.
 */
export async function userOrganizations(
  userId: string,
): Promise<UserOrganization[]> {
  // Goes through a SECURITY DEFINER function, not a plain query. This is a
  // genuine cross-org read: with no org context RLS correctly returns nothing,
  // and with one set it would only ever return that single org. The function is
  // scoped to the caller's OWN person rows, so it reveals nothing but where the
  // user already belongs.
  //
  // The two casts are load-bearing, not tidiness. The Neon WebSocket driver
  // parses `date` into a JS Date in the SERVER's local zone, so `ended_on`
  // arrives as 2026-03-31T04:00:00Z for a 31 March relationship — a date that
  // renders as the 30th for anyone west of the deployment. Casting in SQL keeps
  // it the 'YYYY-MM-DD' string the schema actually means. Same reason for
  // to_json() on the timestamp: one ISO-8601 string, no zone guessing.
  const result = await db.execute(sql`
    select organization_id,
           person_id,
           membership_id,
           name,
           organization_type,
           slug,
           platform_status,
           ended_on::text as ended_on,
           to_json(membership_created_at) #>> '{}' as membership_created_at
      from presby_user_organizations(${userId}::uuid)
  `);
  const rows =
    (result as unknown as { rows?: UserOrganizationRow[] }).rows ?? [];

  // De-duplicate by organization, taking the FIRST row per organization id.
  //
  // `memberships_person_org_key` already makes two memberships for one person
  // at one org impossible, so the only reachable duplicate is two
  // non-tombstoned `people` rows sharing a `user_id` — which happens after a
  // botched merge and would otherwise render one congregation twice and make
  // slug resolution non-deterministic.
  //
  // "First" is deterministic because the function's ORDER BY is part of its
  // contract: organization_type, name, current-before-ended, created_at, id. So
  // a live relationship always wins over an ended one, and two live ones
  // resolve by age. Do not reorder here — reorder there.
  const seen = new Map<string, UserOrganization>();
  for (const row of rows) {
    if (seen.has(row.organization_id)) continue;
    seen.set(row.organization_id, {
      organizationId: row.organization_id,
      personId: row.person_id,
      membershipId: row.membership_id,
      name: row.name,
      organizationType: row.organization_type as OrganizationType,
      slug: row.slug,
      platformStatus: row.platform_status as PlatformStatus,
      endedOn: row.ended_on,
      membershipCreatedAt: row.membership_created_at,
    });
  }
  return [...seen.values()];
}

/**
 * The subset a user can actually enter — the org chooser's data.
 *
 * Current relationships at `managed` organizations, and nothing else. An
 * `unmanaged` org is in the hierarchy but is not a tenant, so it has no portal
 * to enter; an `invited` one is still being set up and entering it needs a
 * tenant permission that does not exist yet.
 *
 * Defined as a filter over `userOrganizations` rather than as a second query,
 * so the two can never disagree about what the database said. The filter lives
 * here rather than in the SQL deliberately: it is policy, it changes, and it
 * should show up in a diff and in a unit test rather than inside a SECURITY
 * DEFINER function whose WHERE clause is also a security boundary.
 */
export async function availableOrganizations(
  userId: string,
): Promise<UserOrganization[]> {
  const all = await userOrganizations(userId);
  return all.filter(isEnterableOrganization);
}

/**
 * Is there a portal behind this relationship?
 *
 * The enterability policy as a pure predicate, exported because THE CHOOSER AND
 * THE ROUTER MUST NOT DISAGREE. `/orgs` has to read the unfiltered list anyway —
 * it names the organizations still being set up — so it would otherwise carry
 * its own inline copy of this condition, and the day the two drift is the day
 * `/launch` forwards a single-org user into `/o/<slug>` that the chooser refuses
 * to show a card for. One definition, used by both.
 */
export function isEnterableOrganization(org: UserOrganization): boolean {
  return org.endedOn === null && org.platformStatus === "managed";
}

/** The organization a request is scoped to, resolved from a URL slug. */
export interface OrgContext {
  organizationId: string;
  personId: string;
  name: string;
  organizationType: OrganizationType;
  slug: string;
  platformStatus: PlatformStatus;
}

/**
 * The four-way answer to "may this user open /o/<slug>" (DECISION-040).
 *
 * `forbidden` carries the organization NAME and nothing about its
 * `platformStatus`, because what the response may not disclose is which
 * congregations are tenants — commercial and pastoral information PC(USA) does
 * not publish. The org tree itself is public (§17) and P2 is building a public
 * search over it, so naming the organization leaks nothing.
 */
export type OrgResolution =
  | { kind: "ok"; org: OrgContext }
  | { kind: "ended"; name: string; endedOn: string }
  | { kind: "forbidden"; name: string; organizationType: OrganizationType }
  | { kind: "not-found" };

/**
 * Resolves a URL slug INSIDE THE USER'S OWN MEMBERSHIP SET.
 *
 * THE RESOLUTION ORDER IS THE SECURITY PROPERTY AND MUST NOT BE INVERTED.
 * Never look `organizations` up by slug and hand the resulting id to
 * `withOrgContext`: that table is deliberately not tenant-isolated, so the
 * lookup succeeds for every organization on the platform, it turns "not a
 * member" into an exception instead of a page, and it leaves an unauthorized
 * organization id one refactor away from a `set_config`. Resolve first, then
 * set context — DECISION-035.
 *
 * The single call to `userOrganizations` answers both halves at once: the
 * function returns `person_id` beside `organization_id`, which is exactly the
 * composite `(personId, organizationId)` pair `withOrgContext` needs. It must
 * never be assembled from two queries (F2).
 *
 * This is a read OUTSIDE any transaction, so it is not the gate.
 * `withOrgContext` re-checks membership inside the transaction, before the
 * context is set, and that check is the authoritative one.
 */
export async function resolveOrgContext(
  userId: string,
  slug: string,
): Promise<OrgResolution> {
  const rows = await userOrganizations(userId);
  const match = rows.find((row) => row.slug === slug);

  if (match) {
    // Ended is checked BEFORE platform status on purpose: an ended
    // relationship at an `unmanaged` organization is still named and dated,
    // which discloses nothing about tenancy — the user already knew the
    // organization exists and that they were related to it.
    if (match.endedOn !== null) {
      return { kind: "ended", name: match.name, endedOn: match.endedOn };
    }
    if (match.platformStatus === "managed") {
      return {
        kind: "ok",
        org: {
          organizationId: match.organizationId,
          personId: match.personId,
          name: match.name,
          organizationType: match.organizationType,
          slug: match.slug,
          platformStatus: match.platformStatus,
        },
      };
    }
    // Active at an `invited` or `unmanaged` organization: there is no portal
    // behind it, and entering one needs a tenant permission that does not
    // exist until P1. Same response as a non-member — see below.
    return {
      kind: "forbidden",
      name: match.name,
      organizationType: match.organizationType,
    };
  }

  // No relationship at all. The organization may still exist in the public
  // tree, and naming it is the humane answer (DECISION-040). The name comes
  // from a narrow public read that CANNOT see platform_status, so the three
  // `forbidden` branches above and below are indistinguishable by construction
  // rather than by careful authorship.
  const summary = await publicOrgSummary(slug);
  if (!summary) return { kind: "not-found" };
  return {
    kind: "forbidden",
    name: summary.name,
    organizationType: summary.organizationType,
  };
}

/**
 * The public org tree, narrowed to what an access-denied page may say: name and
 * type. Nothing else, and specifically NEVER `platform_status`.
 *
 * A separate function rather than a field on the membership read, because the
 * leak DECISION-040 guards against is one careless prop-drill away: the moment
 * this returns a row carrying `platform_status`, a page can vary its copy — or
 * its response time — by whether a congregation is a customer.
 *
 * Legal on the RLS-enforced `db` connection with NO org context set:
 * `organizations` carries a bare `grant select ... to presby_app` and no policy
 * (`drizzle/0009_presby_rls.sql`), because the org tree is public information.
 * `getPlatformDb()` is forbidden here, as everywhere on a user-facing path.
 */
export async function publicOrgSummary(
  slug: string,
): Promise<{ name: string; organizationType: OrganizationType } | null> {
  const [row] = await db
    .select({
      name: organizations.name,
      organizationType: organizations.organizationType,
    })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!row) return null;
  return { name: row.name, organizationType: row.organizationType };
}

/**
 * Runs the authoritative gate and reads nothing.
 *
 * `resolveOrgContext` is a read outside the transaction; this is the
 * in-transaction re-check, which is what makes the check unsatisfiable by the
 * very context it authorizes. A page that renders no tenant data still calls it
 * — otherwise the `(org)` contract ("every page reads through
 * `withOrgContext`") is true only of the pages that happen to need data, and
 * the first page that does not becomes the hole.
 *
 * Throws `OrgAccessError` when the relationship has gone between the resolve
 * and the transaction.
 */
export async function assertOrgAccess(
  personId: string,
  organizationId: string,
): Promise<void> {
  await withOrgContext(personId, organizationId, async () => {});
}
