"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * Two-factor POLICY actions. This route used to hold a second copy of the
 * self-enrolment flow that lives at /account/2fa — same person, same tables,
 * same buttons, wearing an admin badge. That duplication is gone; enrolment
 * happens in one place, and this route governs who is required to do it.
 *
 * Resetting a stranded member's 2FA is NOT here: it already exists as
 * forceResetTwoFactor in (admin)/admin/users/[id]/actions.ts, next to the user
 * it acts on.
 *
 * WHY getPlatformDb(): listing every organization on the RLS-enforced
 * connection returns zero rows. The policies filter to the org GUC, and an
 * admin page has no org context — this is exactly what the second connection
 * exists for. Isolation stays a database property; the platform shell reads
 * across it deliberately, in one audited place.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PolicyResult = { ok: true } | { ok: false; error: string };

export async function setOrganizationTwoFactorAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TWO_FACTOR)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }
  const required = String(formData.get("required")) === "true";

  const platformDb = getPlatformDb();

  // organization_settings is keyed 1:1 by organization_id, and a congregation
  // may not have a settings row yet — upsert rather than update so turning the
  // policy on for the first time works without a prior write.
  const rows = await platformDb.execute(sql`
    INSERT INTO organization_settings (organization_id, require_two_factor)
    VALUES (${organizationId}::uuid, ${required})
    ON CONFLICT (organization_id) DO UPDATE
      SET require_two_factor = EXCLUDED.require_two_factor,
          updated_at = now()
    RETURNING organization_id
  `);
  if (rows.rows.length === 0) {
    return { ok: false, error: "Organization not found." };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_2FA_POLICY_CHANGED,
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { requireTwoFactor: required },
  });

  revalidatePath("/admin/2fa");
  return { ok: true };
}
