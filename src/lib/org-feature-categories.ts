import "server-only";
import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import {
  withOrgContext,
  type OrgTx,
  type OrganizationType,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { organizationFeatureCategories } from "@/lib/db/domain/org-feature-categories";
import {
  PORTAL_TILES,
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  type PortalDomain,
} from "@/lib/org-portal/tiles";

/**
 * The fourth gating axis (docs/work-log/2026-08-27-feature-categories.md,
 * Phase 3; DECISION-130) — coarser than `organization_feature_toggles`,
 * composed into `isOrgFeatureEnabled()` (`src/lib/org-features.ts`) rather
 * than absorbed into that file (architect's Phase 2 re-run ruling: a fourth,
 * structurally distinct gating concept gets its own module, the same way
 * `people.ts`/`roll.ts` stay split).
 *
 * ONE-DIRECTIONAL DEPENDENCY, LOAD-BEARING (DECISION-130): `org-features.ts`
 * imports FROM this module (`categoryEnabledInTx`); this module MUST NEVER
 * import anything back from `org-features.ts` (in particular
 * `ORG_FEATURE_CATALOG`) — doing so would create a real import cycle. This is
 * also why `toggleOrgFeatureCategory()` below cannot itself enumerate which
 * `feature_key`s a category mutation affects and therefore does not call
 * `recordAudit()` — the Server Action does, where both modules are
 * importable with no cycle. See that function's own comment.
 */

const ORG_FEATURES_MANAGE = "org_features.manage";

/** Dual-purpose flag (DECISION-130): gates the category-picker UI section
 * AND is the axis kill-switch consulted by `isOrgFeatureCategoryEnabled()`
 * below and by `org-features.ts`'s `isOrgFeatureEnabled()` composition. OFF
 * means the whole axis is inert — every category resolves enabled, no row
 * read even fires from the composition's perspective — not merely "UI
 * hidden." `listFeatureCategories()`/`toggleOrgFeatureCategory()` do NOT
 * consult this flag: an admin must still be able to see and edit category
 * rows directly (e.g. via a future dev tool, or before the UI ships) even
 * while the composition axis is dark, so a disabled flag never orphans
 * existing rows from ever being editable again. */
const CATEGORY_AXIS_FLAG = "org_portal.feature_categories";

/**
 * The closed, six-value selectable catalog — `PortalDomain` minus
 * `"administration"` (Phase 1 Gap 2: administration must never be
 * selectable as a ministry category; enforced independently, and more
 * strongly, by the schema-layer CHECK constraint on
 * `organization_feature_categories.category`).
 */
export type OrgFeatureCategory = Exclude<PortalDomain, "administration">;

const CATEGORY_KEYS: ReadonlySet<string> = new Set(
  DOMAIN_ORDER.filter((domain) => domain !== "administration"),
);

/** Resolver-layer guard, defense-in-depth alongside the schema CHECK
 * constraint (DECISION-130) — not exported, same "closed catalog validated
 * at the boundary" shape `isCatalogKey()` establishes in `org-features.ts`. */
function isCategoryKey(key: string): key is OrgFeatureCategory {
  return CATEGORY_KEYS.has(key);
}

/**
 * The categories one organization is offered at all, derived from
 * `PORTAL_TILES` — never a hand-maintained org-type-to-category mapping
 * (Phase 1/2 ruling). `distinct(tile.domain)` over every tile whose
 * `orgTypeScope` admits `organizationType` (or is universal), excluding
 * `"administration"`. Deliberately NOT filtered by `tile.flagKey`/
 * `isFlagEnabled()` — the picker offers every structurally-applicable
 * category regardless of which of that domain's tiles have shipped yet,
 * the same "full roadmap visible" posture `PORTAL_TILES`'s own
 * coming-soon placeholders already take. Pure and synchronous — no DB call,
 * safe to unit test directly and to call outside a transaction.
 */
export function offeredCategories(
  organizationType: OrganizationType,
): OrgFeatureCategory[] {
  const offered = new Set<OrgFeatureCategory>();
  for (const tile of PORTAL_TILES) {
    if (tile.domain === "administration") continue;
    if (tile.orgTypeScope && !tile.orgTypeScope.includes(organizationType)) {
      continue;
    }
    offered.add(tile.domain as OrgFeatureCategory);
  }
  return DOMAIN_ORDER.filter(
    (domain): domain is OrgFeatureCategory =>
      domain !== "administration" && offered.has(domain as OrgFeatureCategory),
  );
}

/** Own private copy, same one-permission-per-file convention
 * `role-grants.ts`/`directory.ts`/`org-features.ts` each already follow —
 * not shared. */
async function hasOrgFeaturesManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${ORG_FEATURES_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/**
 * Mid-transaction helper (mirrors `authz.ts`'s `assertPermissionSubset(tx,
 * ...)` precedent) — the composition primitive `isOrgFeatureEnabled()`
 * (`src/lib/org-features.ts`) calls this from INSIDE its own already-open
 * `withOrgContext` transaction, so composing two axes costs one transaction,
 * not two. Exported for direct unit testing of the default-on behavior in
 * isolation.
 *
 * DEFAULT-ON, DELIBERATE DEVIATION FROM THIS CODEBASE'S "MISSING ROW -> FALSE"
 * CONVENTION (`organization_feature_toggles`/`isOrgFeatureEnabled()` in
 * `org-features.ts`, `feature_flags`/`isFlagEnabled()` in `flags.ts` — every
 * other axis in this codebase reads a missing row as OFF). A missing row HERE
 * means ENABLED. DO NOT "FIX" THIS TO `?? false` — that silently
 * re-introduces the exact live regression the architect's Phase 2 re-run
 * (docs/work-log/2026-08-27-feature-categories.md) overturned Phase 1's own
 * AND-composition-plus-backfill recommendation to avoid: this axis lands ON
 * TOP OF already-live per-org `organization_feature_toggles` state for real
 * orgs, so a false default would retroactively remove access a toggle
 * already granted, not neutrally gate something new that never existed
 * before. Only an explicit `enabled = false` row restricts. See DECISION-130.
 *
 * Deliberately does NOT itself consult `CATEGORY_AXIS_FLAG` — the flag
 * kill-switch is the CALLER's responsibility (`isOrgFeatureEnabled()` checks
 * it once, outside this call, per its own header comment; `listFeatureCategories()`
 * and `toggleOrgFeatureCategory()` intentionally never check it at all, so an
 * admin can still see/edit category state while the composition axis is
 * dark).
 */
export async function categoryEnabledInTx(
  tx: OrgTx,
  organizationId: string,
  category: OrgFeatureCategory,
): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: organizationFeatureCategories.enabled })
    .from(organizationFeatureCategories)
    .where(
      and(
        eq(organizationFeatureCategories.organizationId, organizationId),
        eq(organizationFeatureCategories.category, category),
      ),
    )
    .limit(1);
  return row?.enabled ?? true;
}

/**
 * Public, `cache()`-deduplicated wrapper around `categoryEnabledInTx` for
 * direct callers outside an existing transaction — symmetric with
 * `isOrgFeatureEnabled()`'s own shape. No Phase 4 call site needs this yet
 * (every consumer reaches categories through `isOrgFeatureEnabled()`'s
 * composition instead), kept for API symmetry and isolated testability, not
 * because something calls it today.
 *
 * An invalid category string returns `false` (never ambiguously "enabled"
 * for a key that doesn't exist). When `org_portal.feature_categories` is
 * OFF, returns `true` unconditionally — axis kill-switch, no DB read at all.
 */
export const isOrgFeatureCategoryEnabled = cache(
  async (
    personId: string,
    organizationId: string,
    category: string,
  ): Promise<boolean> => {
    if (!isCategoryKey(category)) {
      return false;
    }
    if (!(await isFlagEnabled(CATEGORY_AXIS_FLAG))) {
      return true;
    }
    return withOrgContext(personId, organizationId, (tx) =>
      categoryEnabledInTx(tx, organizationId, category),
    );
  },
);

export interface FeatureCategoryEntry {
  category: OrgFeatureCategory;
  label: string;
  /** `row?.enabled ?? true` — DEFAULT-ON, see `categoryEnabledInTx()`. */
  enabled: boolean;
  /** ISO-8601, or `null` when the org has never toggled this category. */
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export type ListFeatureCategoriesResult =
  | { kind: "ok"; categories: FeatureCategoryEntry[] }
  | { kind: "forbidden" };

interface CategoryRow {
  category: string;
  enabled: boolean;
  updated_at: string;
  updated_by_email: string | null;
}

/**
 * Every category `offeredCategories(organizationType)` returns, defaulted
 * true unless an explicit row says otherwise. Gated on `org_features.manage`
 * (own private `hasOrgFeaturesManage(tx, ...)` copy, same one-permission-
 * per-file convention `role-grants.ts`/`directory.ts`/`org-features.ts` each
 * already follow).
 */
export async function listFeatureCategories(
  viewerPersonId: string,
  organizationId: string,
  organizationType: OrganizationType,
): Promise<ListFeatureCategoriesResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOrgFeaturesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select fc.category as category,
             fc.enabled as enabled,
             to_json(fc.updated_at) #>> '{}' as updated_at,
             u.email as updated_by_email
        from organization_feature_categories fc
        left join users u on u.id = fc.updated_by
       where fc.organization_id = ${organizationId}::uuid
    `);
    const rows = (result as unknown as { rows?: CategoryRow[] }).rows ?? [];
    const byCategory = new Map(rows.map((row) => [row.category, row]));

    const categories: FeatureCategoryEntry[] = offeredCategories(
      organizationType,
    ).map((category) => {
      const row = byCategory.get(category);
      return {
        category,
        label: DOMAIN_LABELS[category],
        enabled: row?.enabled ?? true,
        updatedAt: row?.updated_at ?? null,
        updatedByEmail: row?.updated_by_email ?? null,
      };
    });

    return { kind: "ok", categories };
  });
}

export type ToggleOrgFeatureCategoryResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "invalid_category" };

/**
 * Turns `category` on or off for `organizationId`. Check-then-write only —
 * mirrors `toggleOrgFeature()`'s check-then-write split exactly, but does NOT
 * call `recordAudit()` itself (contrast `toggleOrgFeature`, which does). This
 * module has no dependency on `org-features.ts` (one-directional composition
 * — `org-features.ts` depends on THIS module, not the reverse, to avoid a
 * real import cycle — see this file's header), so it has no access to
 * `ORG_FEATURE_CATALOG` and cannot itself enumerate which `feature_key`s a
 * category affects. The Server Action
 * (`src/app/(org)/o/[slug]/admin/features/actions.ts`) calls `recordAudit()`
 * instead, with that enumeration — mirroring `role-grants.ts`/
 * `admin/roles/actions.ts`'s lib-does-check-and-write/action-does-audit
 * split, NOT `org-features.ts`'s own audit-in-lib split for
 * `toggleOrgFeature()`, and named here as the deliberate, forced divergence
 * from the sibling file's pattern (DECISION-130).
 */
export async function toggleOrgFeatureCategory(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  category: string,
  enabled: boolean,
): Promise<ToggleOrgFeatureCategoryResult> {
  if (!isCategoryKey(category)) {
    return { kind: "invalid_category" };
  }

  return withOrgContext(
    actorPersonId,
    organizationId,
    async (tx): Promise<ToggleOrgFeatureCategoryResult> => {
      if (!(await hasOrgFeaturesManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      await tx
        .insert(organizationFeatureCategories)
        .values({
          organizationId,
          category,
          enabled,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [
            organizationFeatureCategories.organizationId,
            organizationFeatureCategories.category,
          ],
          set: { enabled, updatedBy: actorUserId, updatedAt: new Date() },
        });

      return { kind: "ok" };
    },
  );
}
