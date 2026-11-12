import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { ORG_FEATURE_CATALOG, isCategoryAxisOn, orgFeatureEnabledInTx } from "@/lib/org-features";
import { SPOT_THE_SCAM_FEATURE_KEY } from "./contract";

/**
 * The `(org)` Spot the scam page's one toggle read (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3 "TypeScript surface"; DECISION-334). The page is permission-blind (DECISION-162):
 * any member of the organization sees it while the toggle is on, so the only question is
 * "is this on for this organization", answered by `orgFeatureEnabledInTx` (the same
 * composition the anonymous route reads in SQL, `presby_learn_enabled`; `public.db.test.ts`
 * compares the two over the whole matrix).
 *
 * ONE `withOrgContext` transaction: the toggle and, only when it is off, whether the viewer
 * holds `org_features.manage` (so the off state links to Features only for someone who can
 * use it, with no second read). The category axis flag (and the entry's own platform flag,
 * `null` today) is read OUTSIDE the transaction: `isFlagEnabled` runs on its own connection.
 *
 * A database failure is NEVER an `off` answer: this lets it throw, and the page renders its
 * load-error state. An `OrgAccessError` (membership ended between the resolve and the
 * transaction) also propagates, to `[slug]/error.tsx`.
 */
export type LearnPageContext = { kind: "on" } | { kind: "off"; canManageFeatures: boolean };

export async function getLearnPageContext(viewer: { personId: string; organizationId: string }): Promise<LearnPageContext> {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === SPOT_THE_SCAM_FEATURE_KEY);
  // A missing entry is a programming error, not a runtime state.
  if (!entry) throw new Error(`learn: ${SPOT_THE_SCAM_FEATURE_KEY} is not in ORG_FEATURE_CATALOG`);
  const platformFlag: string | null = entry.flag;
  const flagOn = platformFlag === null ? true : await isFlagEnabled(platformFlag);
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<LearnPageContext> => {
    const enabled =
      flagOn && (await orgFeatureEnabledInTx(tx, viewer.organizationId, SPOT_THE_SCAM_FEATURE_KEY, categoryAxisOn));
    if (enabled) return { kind: "on" };
    const result = await tx.execute(
      sql`select presby_has_permission(${viewer.personId}::uuid, ${viewer.organizationId}::uuid, 'org_features.manage') as allowed`,
    );
    const rows = Array.isArray(result) ? result : ((result as { rows?: Array<{ allowed?: boolean }> }).rows ?? []);
    return { kind: "off", canManageFeatures: (rows[0] as { allowed?: boolean } | undefined)?.allowed === true };
  });
}
