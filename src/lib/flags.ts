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
  try {
    const row = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, key),
    });
    return row?.enabled ?? false;
  } catch {
    // Fails CLOSED, platform-wide, and goes dark silently — every flag this
    // helper gates collapses to "disabled" for the duration of a DB blip.
    // That is what makes the log below load-bearing, not decorative. Never
    // log the error object itself: Neon/Drizzle's message embeds the failed
    // SQL text (and, on some paths, bound params) — the flag key is the only
    // safe thing to emit here. See docs/decisions.md DECISION-026 correction.
    console.error(
      "[flags] isFlagEnabled read failed; treating as disabled",
      { key },
    );
    return false;
  }
});
