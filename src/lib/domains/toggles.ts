import "server-only";
import { and, eq } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { organizationFeatureToggles } from "@/lib/db/domain/org-features";
import { ORG_FEATURE_CATALOG } from "@/lib/org-features";
import type { OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "./audit-tx";

/**
 * toggles.ts - the platform-connection writer for the operator-enabled org
 * toggles (`org_portal.domains`, `org_portal.mail_domain`).
 *
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 T9; operator ruling Q1
 * ("platform admin only, for now"). The catalog marks these `operatorEnabled`,
 * so the tenant path (`toggleOrgFeature`) refuses them with `invalid_key` and
 * `listFeatureToggles` never lists them; this is the one door, and it belongs
 * to a platform admin (the action that calls it checks
 * `FEATURES.ADMIN_ORGANIZATIONS`). It runs on the platform connection because a
 * platform operator has no membership to hand `withOrgContext`, and fabricating
 * one is the phantom membership "Two Hierarchies Intersect Nowhere" forbids.
 *
 * Audited with the EXISTING `tenant.org_feature.toggled` key and
 * `metadata.via = "platform"`, in the same transaction as the write, so the
 * church's audit reader sees the same event shape whoever flipped it. A write
 * that changes nothing (the toggle already has that value) writes no row and no
 * audit event.
 */

export const OPERATOR_TOGGLE_KEYS: readonly string[] = ORG_FEATURE_CATALOG.filter(
  (entry) => entry.operatorEnabled,
).map((entry) => entry.key);

export type SetOperatorToggleResult =
  | { kind: "ok"; changed: boolean }
  | { kind: "invalid_key" }
  | { kind: "not_found" };

export async function setOperatorOrgToggle(
  operator: { userId: string; email: string | null },
  organizationId: string,
  key: string,
  enabled: boolean,
): Promise<SetOperatorToggleResult> {
  if (!OPERATOR_TOGGLE_KEYS.includes(key)) return { kind: "invalid_key" };

  return getPlatformDb().transaction(async (platformTx): Promise<SetOperatorToggleResult> => {
    const tx = platformTx as OrgTx;
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return { kind: "not_found" };

    const [current] = await tx
      .select({ enabled: organizationFeatureToggles.enabled })
      .from(organizationFeatureToggles)
      .where(
        and(
          eq(organizationFeatureToggles.organizationId, organizationId),
          eq(organizationFeatureToggles.featureKey, key),
        ),
      )
      .limit(1);
    // Unchanged: the row already says so, or there is no row and OFF is
    // requested (a missing row already means OFF, DECISION-097 - do not
    // manufacture one).
    if (current === undefined ? enabled === false : current.enabled === enabled) {
      return { kind: "ok", changed: false };
    }

    await tx
      .insert(organizationFeatureToggles)
      .values({ organizationId, featureKey: key, enabled, updatedBy: operator.userId })
      .onConflictDoUpdate({
        target: [organizationFeatureToggles.organizationId, organizationFeatureToggles.featureKey],
        set: { enabled, updatedBy: operator.userId, updatedAt: new Date() },
      });

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.ORG_FEATURE_TOGGLED,
      actor: { userId: operator.userId, email: operator.email },
      resourceType: "organization_feature_toggle",
      resourceId: key,
      metadata: { organizationId, featureKey: key, enabled, via: "platform" },
    });
    return { kind: "ok", changed: true };
  });
}
