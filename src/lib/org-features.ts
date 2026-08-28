import "server-only";
import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { organizationFeatureToggles } from "@/lib/db/domain/org-features";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { isFlagEnabled } from "@/lib/flags";
import {
  categoryEnabledInTx,
  type OrgFeatureCategory,
} from "@/lib/org-feature-categories";
import { DOMAIN_LABELS } from "@/lib/org-portal/tiles";

/**
 * Per-org feature enablement — the third gating axis (DECISION-097,
 * docs/work-log/2026-08-25-member-management.md "Per-Org Feature Enablement —
 * Architectural Ruling", refined by Phase 3's design). Composes with, never
 * replaces, the global `feature_flags` kill switch and the per-user
 * `permissions` catalog (DECISION-003): flag -> org toggle -> permission,
 * cheapest and most centrally-controlled first.
 *
 * SIGNATURE DEVIATION FROM THE RULING, STATED EXPLICITLY (Phase 3's own
 * text): the ruling's shorthand was `isOrgFeatureEnabled(organizationId,
 * key)`. Reading the toggle row requires the RLS org GUC to be set, and the
 * Isolation invariant is unconditional — "verify membership before calling
 * set_config" — so this resolver cannot set `app.current_org_id` from a bare
 * `organizationId` without a `personId` to check membership against first.
 * Every real call site already has `personId` in hand (a page or action that
 * has already run `resolveOrgContext()`), so the actual signature threads it
 * through: `isOrgFeatureEnabled(personId, organizationId, key)`.
 *
 * FOURTH AXIS, ADDED (docs/work-log/2026-08-27-feature-categories.md, Phase
 * 3; DECISION-130): a coarser, org-chosen "which ministry areas apply to
 * this org" checkpoint composed IN FRONT of the per-feature toggle read
 * below — flag -> CATEGORY -> org toggle -> permission. Composition lives
 * HERE, inside `isOrgFeatureEnabled()` itself, specifically so every
 * existing and future call site inherits it for free with no changes at the
 * call site (Phase 1's adversarial-pass requirement: server-side
 * enforcement, not just page-render gating). The category check only runs
 * when `org_portal.feature_categories` is on — see `categoryEnabledInTx()`
 * (`src/lib/org-feature-categories.ts`) for the axis kill-switch and the
 * default-on resolution it implements. This is a fourth, coarser version of
 * the same "does this org have this" question the toggle already answers,
 * not a permission and not a flag itself (Permissions vs Flags holds
 * structurally) — documented here per the architect's Phase 2 instruction
 * not to describe it as "just derivation."
 */

const CATEGORY_AXIS_FLAG = "org_portal.feature_categories";

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ORG_FEATURES_MANAGE = "org_features.manage";

/**
 * The whitelist the admin UI renders and `toggleOrgFeature()` validates
 * against. Lives here, NOT `src/lib/permissions.ts` — that catalog is
 * platform-shell-only and frozen (its own header says so).
 */
export const ORG_FEATURE_CATALOG = [
  {
    key: "org_portal.members_create",
    name: "Add & approve members",
    description:
      "Lets this organization's admins create people and approve roll actions.",
    // Feature-categories axis (docs/work-log/2026-08-27-feature-categories.md,
    // Phase 3) — People & Membership.
    category: "people" as const,
  },
  // Member edit: tiered sensitive information (docs/work-log/
  // 2026-08-26-member-sensitive-info.md, Phase 3/DECISION-108). A DEDICATED
  // key, NOT reusing org_portal.members_create — that flag's kill switch
  // covers person/roll creation, a materially different risk profile than
  // leaking pastoral/medical/demographic data to the wrong role.
  {
    key: "org_portal.sensitive_info",
    name: "Tiered sensitive information",
    description:
      "Lets this organization enter pastoral notes, demographics, medical/allergy info, and disability records for its members, subject to each viewer's own tier-3 permission grants.",
    category: "people" as const,
  },
] as const;

export type OrgFeatureKey = (typeof ORG_FEATURE_CATALOG)[number]["key"];

function isCatalogKey(key: string): key is OrgFeatureKey {
  return ORG_FEATURE_CATALOG.some((entry) => entry.key === key);
}

/** The single-permission gate every write/list function below checks first,
 * a single `presby_has_permission(..., 'org_features.manage')` call — same
 * pattern as `role-grants.ts`'s `hasRoleGrantsManage()` and `directory.ts`'s
 * `checkDirectoryView()`. */
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
 * Reads whether `key` is enabled for `organizationId`, as seen by `personId`.
 * Deduplicated via React `cache()` within one RSC render pass, matching
 * `isFlagEnabled()`'s own shape — a no-op (and therefore harmless) inside a
 * server action, per that file's own note.
 *
 * Missing row -> `false`. This is NOT an auth-critical flag per DECISION-026
 * — it composes *underneath* a permission check, never instead of one, so
 * "false on any ambiguity" is the right default, same as `isFlagEnabled()`.
 *
 * Throws `OrgAccessError` (via `withOrgContext`) if `personId` holds no
 * active membership at `organizationId` — genuinely broken, not a "disabled"
 * answer, same distinction `directory.ts`'s header draws.
 */
export const isOrgFeatureEnabled = cache(
  async (
    personId: string,
    organizationId: string,
    key: string,
  ): Promise<boolean> => {
    // Fourth axis composition (DECISION-130) — see this file's own header.
    // The flag read happens ONCE, outside the transaction (isFlagEnabled()
    // has its own cache()/connection, not `tx`); the category read itself
    // happens INSIDE the same withOrgContext transaction as the toggle read
    // below, so composing two axes costs one transaction, not two.
    const catalogEntry = ORG_FEATURE_CATALOG.find((entry) => entry.key === key);
    const categoryAxisOn = catalogEntry
      ? await isFlagEnabled(CATEGORY_AXIS_FLAG)
      : false;

    return withOrgContext(personId, organizationId, async (tx) => {
      if (catalogEntry && categoryAxisOn) {
        const categoryEnabled = await categoryEnabledInTx(
          tx,
          organizationId,
          catalogEntry.category,
        );
        if (!categoryEnabled) {
          // A category-off result short-circuits to false without the
          // second round trip to organization_feature_toggles.
          return false;
        }
      }

      const [row] = await tx
        .select({ enabled: organizationFeatureToggles.enabled })
        .from(organizationFeatureToggles)
        .where(
          and(
            eq(organizationFeatureToggles.organizationId, organizationId),
            eq(organizationFeatureToggles.featureKey, key),
          ),
        )
        .limit(1);
      return row?.enabled ?? false;
    });
  },
);

export interface FeatureToggleEntry {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  /** ISO-8601, or `null` when the org has never toggled this key. */
  updatedAt: string | null;
  updatedByEmail: string | null;
  /** Feature-categories axis (DECISION-130). */
  category: OrgFeatureCategory;
  categoryLabel: string;
  /** `true` when `org_portal.feature_categories` is off (axis inert) or
   * when the category resolves enabled; `false` only when the flag is on
   * AND an explicit off row exists for this entry's category. */
  categoryEnabled: boolean;
}

export type ListFeatureTogglesResult =
  | { kind: "ok"; toggles: FeatureToggleEntry[] }
  | { kind: "forbidden" };

interface ToggleRow {
  feature_key: string;
  enabled: boolean;
  updated_at: string;
  updated_by_email: string | null;
}

/**
 * Every catalog entry, with this org's current state — a missing row
 * defaults to `enabled: false`, same convention as the resolver, so the
 * admin page never has to special-case "never toggled" vs "explicitly off".
 */
export async function listFeatureToggles(
  viewerPersonId: string,
  organizationId: string,
): Promise<ListFeatureTogglesResult> {
  // Same "read the flag once, outside the transaction" shape as
  // isOrgFeatureEnabled() above.
  const categoryAxisOn = await isFlagEnabled(CATEGORY_AXIS_FLAG);

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOrgFeaturesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select ft.feature_key as feature_key,
             ft.enabled as enabled,
             to_json(ft.updated_at) #>> '{}' as updated_at,
             u.email as updated_by_email
        from organization_feature_toggles ft
        left join users u on u.id = ft.updated_by
       where ft.organization_id = ${organizationId}::uuid
    `);
    const rows = (result as unknown as { rows?: ToggleRow[] }).rows ?? [];
    const byKey = new Map(rows.map((row) => [row.feature_key, row]));

    // One category read per DISTINCT category (today just "people"), cached
    // for the duration of this call — never one read per catalog entry.
    const categoryCache = new Map<OrgFeatureCategory, boolean>();
    async function categoryEnabledCached(
      category: OrgFeatureCategory,
    ): Promise<boolean> {
      if (!categoryAxisOn) return true;
      let cached = categoryCache.get(category);
      if (cached === undefined) {
        cached = await categoryEnabledInTx(tx, organizationId, category);
        categoryCache.set(category, cached);
      }
      return cached;
    }

    const toggles: FeatureToggleEntry[] = await Promise.all(
      ORG_FEATURE_CATALOG.map(async (entry) => {
        const row = byKey.get(entry.key);
        return {
          key: entry.key,
          name: entry.name,
          description: entry.description,
          enabled: row?.enabled ?? false,
          updatedAt: row?.updated_at ?? null,
          updatedByEmail: row?.updated_by_email ?? null,
          category: entry.category,
          categoryLabel: DOMAIN_LABELS[entry.category],
          categoryEnabled: await categoryEnabledCached(entry.category),
        };
      }),
    );

    return { kind: "ok", toggles };
  });
}

export type ToggleOrgFeatureResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "invalid_key" };

/**
 * Turns `key` on or off for `organizationId`. Gated on `org_features.manage`
 * (checked inside the same transaction as the write, same discipline as
 * every other module in this tree). Rejects a `key` outside
 * `ORG_FEATURE_CATALOG` with `invalid_key` — an expected outcome, not a
 * crash, same "expected outcome, not a thrown error" contract `grantRole`'s
 * `invalid_role` establishes.
 *
 * `recordAudit()` is called from HERE, not from a co-located `actions.ts` —
 * a deliberate divergence from `role-grants.ts`/`admin/roles/actions.ts`'s
 * split (lib does the check+write, the Server Action does the audit+
 * revalidate). This Phase 4 pass builds no `actions.ts` files at all (those
 * are the next agent's UI-layer work per this pipeline's task split), and
 * `org_features.manage` is a permission/access-control-adjacent mutation
 * that must never ship un-audited — see the work-log's Phase 4 note.
 * Audited AFTER the transaction commits (`result.kind === "ok"`, checked
 * outside `withOrgContext`), so a row is never recorded for a write that
 * rolled back.
 */
export async function toggleOrgFeature(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  key: string,
  enabled: boolean,
): Promise<ToggleOrgFeatureResult> {
  if (!isCatalogKey(key)) {
    return { kind: "invalid_key" };
  }

  const result = await withOrgContext(
    actorPersonId,
    organizationId,
    async (tx): Promise<ToggleOrgFeatureResult> => {
      if (!(await hasOrgFeaturesManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      await tx
        .insert(organizationFeatureToggles)
        .values({
          organizationId,
          featureKey: key,
          enabled,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [
            organizationFeatureToggles.organizationId,
            organizationFeatureToggles.featureKey,
          ],
          set: { enabled, updatedBy: actorUserId, updatedAt: new Date() },
        });

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.ORG_FEATURE_TOGGLED,
      resourceType: "organization_feature_toggle",
      resourceId: key,
      metadata: { organizationId, featureKey: key, enabled },
    });
  }

  return result;
}
