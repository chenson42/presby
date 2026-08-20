"use server";

import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { submitFeedback } from "@/lib/tickets";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/types/actions";

/**
 * `/o/<slug>/feedback` — the baseline-member congregation-feedback on-ramp
 * (Flow 0). See docs/work-log/2026-08-20-support-tickets.md Phase 3, "the
 * baseline on-ramp".
 *
 * `auth()` directly, fresh `resolveOrgContext(session.user.id, slug)` on
 * every call — same identity-resolution shape as `tickets/actions.ts`.
 * `submitFeedback()` itself carries no permission gate (any current member);
 * `withOrgContext()`'s own membership re-check is the entire gate.
 */
export async function submitCongregationFeedbackAction(
  slug: string,
  body: string,
): Promise<ActionResult<{ feedbackId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  // Rate-limited: 5/hour, same shape as (member)/feedback/actions.ts's
  // submitFeedback — this surface, unlike ticket filing, is reachable by
  // every current member, the same open-exposure profile platform feedback
  // already has.
  const rateLimitResult = await checkRateLimit(
    `congregation-feedback:${resolved.org.personId}`,
    { max: 5, windowSeconds: 3600 },
    {
      userId: session.user.id,
      actor: session.user.email ?? session.user.id,
      reason: "congregation feedback submission",
    },
  );
  if (!rateLimitResult.allowed) {
    return { ok: false, error: "Too many submissions — come back in a bit." };
  }

  // audit-exempt: personal-data submission, rate-limited, matches platform
  // feedback's own precedent ((member)/feedback/actions.ts's submitFeedback).
  const result = await submitFeedback(resolved.org.personId, resolved.org.organizationId, body);

  if (result.kind === "invalid_input") {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: { feedbackId: result.feedbackId } };
}
