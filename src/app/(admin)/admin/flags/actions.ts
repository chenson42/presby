"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import { ADMIN_ROLE } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export async function toggleFlagAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.roles?.includes(ADMIN_ROLE)) throw new Error("Forbidden");

  const key = String(formData.get("key"));
  const current = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, key),
  });
  if (!current) return;

  const next = !current.enabled;
  await db
    .update(featureFlags)
    .set({ enabled: next, updatedAt: sql`now()` })
    .where(eq(featureFlags.key, key));

  await recordAudit({
    action: AUDIT_ACTIONS.FEATURE_FLAG_TOGGLED,
    resourceType: "feature_flag",
    resourceId: key,
    metadata: { from: current.enabled, to: next },
  });

  revalidatePath("/admin/flags");
}
