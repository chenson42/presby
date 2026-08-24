import "server-only";
import { eq, isNull } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { groupTypes, groups } from "@/lib/db/domain/groups";
import { isReservedSlug } from "@/lib/reserved-slugs";
import type { OrganizationType, PlatformStatus } from "@/lib/authz";

/**
 * Org creation — the one write path for `organizations` (see this repo's own
 * `docs/work-log/2026-08-24-admin-org-create.md`, before which no such path
 * existed anywhere in presby). Mirrors `src/lib/sites.ts`'s shape: a plain
 * `src/lib/` module, not under `db/domain/` (schema-only by that directory's
 * convention), owning SQL correctness. `new/actions.ts` wraps this with a
 * thin FormData-parsing layer, exactly like `provisionSiteAction` wraps
 * `provisionSite`.
 *
 * `createOrganization()` seeds the F16 derived groups (Session, Board of
 * Deacons, Active Membership) in the SAME transaction as the org insert —
 * not a follow-up step — because `drizzle/0017`'s
 * `memberships_sync_derived_group` trigger raises a hard exception the first
 * time ANYONE inserts a `memberships` row for an org with no
 * `active_membership` group. A two-step "insert org, then seed groups"
 * sequence would leave a real window where the org exists but is unusable.
 */

export type CreateOrganizationInput = {
  name: string;
  slug: string;
  organizationType: OrganizationType;
  platformStatus: PlatformStatus;
};

export type CreateOrganizationResult =
  | { kind: "ok"; organizationId: string }
  | { kind: "invalid_input"; error: string }
  | { kind: "slug_taken" }
  | { kind: "reserved_slug" }
  // The platform-wide group_types rows (`court`, `roster`) are missing —
  // `npm run db:seed` has not been run against this database with
  // scripts/seed.ts's seedGroupTypes() addition. Distinct from
  // invalid_input: nothing the admin typed is wrong, this is a deploy-time
  // prerequisite that hasn't happened yet.
  | { kind: "provisioning_incomplete" };

/**
 * `path` derivation for a parentless, freshly-created org. `organizations.path`
 * segments use underscores in the existing fixture
 * (`scripts/seed-dev.sql`, e.g. `'northern_reach.alder_creek'`) while `slug`
 * legally contains hyphens (`organizations_slug_format` permits
 * `[a-z0-9-]`) — and the column is slated to migrate to a real Postgres
 * `ltree`, whose labels reject hyphens outright. Named and unit-tested on its
 * own; never an inline `.replace()` at the call site (Phase 2 ruling).
 *
 * This ticket creates root organizations only (`parentId` stays null), so
 * the derivation is exactly the slug with hyphens folded to underscores —
 * there is no parent path to prefix onto.
 */
export function deriveOrgPath(slug: string): string {
  return slug.replace(/-/g, "_");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * The `groups` rows to seed for a freshly-created org, conditional on
 * `organizationType` — confirmed against `scripts/seed-dev.sql`'s own
 * fixture shape (lines ~57-88): a congregation gets Session, Board of
 * Deacons, AND Active Membership; every other organization type (presbytery,
 * synod, general_assembly, new_worshiping_community) gets Active Membership
 * only, mirroring the fixture's own presbytery row (no Session, no Board of
 * Deacons — a presbytery has neither in this schema).
 */
function groupSeedPlan(
  organizationType: OrganizationType,
): Array<{
  groupTypeKey: "court" | "roster";
  name: string;
  derivedFrom: "session" | "diaconate" | "active_membership";
}> {
  const activeMembership = {
    groupTypeKey: "roster" as const,
    name: "Active Membership",
    derivedFrom: "active_membership" as const,
  };
  if (organizationType !== "congregation") {
    return [activeMembership];
  }
  return [
    {
      groupTypeKey: "court",
      name: "Session",
      derivedFrom: "session",
    },
    {
      groupTypeKey: "court",
      name: "Board of Deacons",
      derivedFrom: "diaconate",
    },
    activeMembership,
  ];
}

/**
 * Creates the `organizations` row plus its F16 derived groups in one
 * `platformDb.transaction()`. Field-shape validation (name length, slug
 * format, reserved-slug, enum membership) is the CALLER's job
 * (`new/actions.ts`) — this function trusts its input's shape and owns only
 * database-level correctness: the `group_types` bootstrap check, the
 * `path` derivation, the unique-slug race, and the conditional group insert.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  // Defense-in-depth, not the primary check: `new/actions.ts` already
  // rejects a reserved slug before ever calling this function (cheap, no DB
  // round-trip). Checked again HERE because this is the single write path
  // for `organizations.slug` — Phase 3 Edge Cases names it explicitly: "a
  // future second write path must remember to call isReservedSlug() too."
  // Owning the check at this layer, not only in the caller, means any future
  // caller gets it for free rather than by remembering.
  if (isReservedSlug(input.slug)) {
    return { kind: "reserved_slug" };
  }

  const platformDb = getPlatformDb();

  // Step 1: the platform-wide group_types rows must already exist —
  // find, never create inline (Phase 2's explicit rejection of that
  // shortcut: it duplicates seed semantics into a hot mutation path).
  const templateRows = await platformDb
    .select({ id: groupTypes.id, key: groupTypes.key })
    .from(groupTypes)
    .where(isNull(groupTypes.organizationId));
  const courtTypeId = templateRows.find((r) => r.key === "court")?.id;
  const rosterTypeId = templateRows.find((r) => r.key === "roster")?.id;
  if (!courtTypeId || !rosterTypeId) {
    return { kind: "provisioning_incomplete" };
  }
  const typeIdByKey: Record<"court" | "roster", string> = {
    court: courtTypeId,
    roster: rosterTypeId,
  };

  // Step 2 (pre-check): a clean rejection for the common case. The catch
  // below covers the TOCTOU gap between this SELECT and the INSERT —
  // matching provisionSite()'s own shape in src/lib/sites.ts.
  const [existingOrg] = await platformDb
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, input.slug))
    .limit(1);
  if (existingOrg) return { kind: "slug_taken" };

  const path = deriveOrgPath(input.slug);
  const plan = groupSeedPlan(input.organizationType);

  try {
    const organizationId = await platformDb.transaction(async (tx) => {
      const [orgRow] = await tx
        .insert(organizations)
        .values({
          name: input.name,
          slug: input.slug,
          organizationType: input.organizationType,
          platformStatus: input.platformStatus,
          path,
        })
        .returning({ id: organizations.id });

      await tx.insert(groups).values(
        plan.map((g) => ({
          organizationId: orgRow.id,
          groupTypeId: typeIdByKey[g.groupTypeKey],
          name: g.name,
          membershipSource: "derived" as const,
          derivedFrom: g.derivedFrom,
          isProtected: true,
        })),
      );

      return orgRow.id;
    });

    return { kind: "ok", organizationId };
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "slug_taken" };
    throw err;
  }
}

// Re-exported so callers (the server action, tests) never need to import
// from @/lib/authz just to get these two type aliases.
export type { OrganizationType, PlatformStatus };
