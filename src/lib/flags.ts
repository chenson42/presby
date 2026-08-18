import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";

/**
 * Deduplicated via React cache() — within a single RSC render pass (e.g. layout
 * + page both calling isFlagEnabled("demo.new_dashboard")), only one SELECT fires.
 *
 * NOT deduplicated in:
 *   - Server actions: each action invocation is a separate execution context;
 *     cache() is a no-op. If you need a flag in a server action, call this
 *     function as-is — the per-call SELECT is the cost, and it is acceptable.
 *   - NextAuth callbacks (authorize, jwt): same reason. cache() is a no-op
 *     outside RSC render trees. This is intentional and safe — the pending
 *     auth-mode-flags feature reads isFlagEnabled inside jwt(); the wrap has
 *     no effect there and does not change behavior.
 */
export const isFlagEnabled = cache(async (key: string): Promise<boolean> => {
  const row = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, key),
  });
  return row?.enabled ?? false;
});
