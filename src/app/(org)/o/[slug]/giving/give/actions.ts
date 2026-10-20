"use server";

import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext, userOrganizations } from "@/lib/authz";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertGivingSession, loadGivingToggle } from "@/lib/giving/access";
import { createMemberIntent, startGiveSession } from "@/lib/giving/give-session";
import {
  GIVE_FORM_FIELDS,
  formString,
  isSlugShaped,
  parseGiveForm,
  type GiveResult,
} from "@/lib/giving/give-input";

/**
 * `(org)/o/[slug]/giving/give`'s Server Action - a signed-in member starts a
 * gift. docs/work-log/2026-10-15-online-giving.md, Phase 3 "Member give".
 * Same `GiveResult` union and the same Checkout flow as the public action
 * (`startGiveSession`), with these differences, each deliberate:
 *
 *   - GATE ORDER: `auth()` -> Node-side 2FA claim -> `resolveOrgContext()` (the
 *     four-way miss) -> org applicability + the `org_portal.giving` toggle. NO
 *     giving key is needed: a plain member may give. The organization comes
 *     from the slug re-resolved INSIDE this user's own memberships, never from
 *     a client value.
 *   - `membership_id` is this user's own active membership at the resolved
 *     organization, read server-side - never a form field (a member cannot name
 *     another member's membership). It is the ONLY way an intent links a donor
 *     to a member (`presby_giving_create_intent_member`).
 *   - Rate limit by USER id (`giving_session_user:<userId>`, 10 per 10 minutes)
 *     and the shared platform key (`giving_session_global`). No per-site key: a
 *     flood of anonymous visitors must not be able to starve the congregation's
 *     own members, and no Turnstile: the caller is authenticated.
 *   - The honeypot is still honoured (free) and answers the same fake
 *     `unavailable`.
 *
 * A session that has gone stale (signed out, 2FA lapsed) is `error`, not
 * `unavailable`: giving is fine, the person only needs to sign in again, and the
 * Edge sends them there on the next navigation. Not a member, wrong org type and
 * toggle off are all the one `unavailable`.
 */
export async function createMemberGiveSessionAction(
  slug: string,
  formData: FormData,
): Promise<GiveResult> {
  try {
    if (formString(formData, GIVE_FORM_FIELDS.honeypot).trim().length > 0) {
      return { kind: "unavailable" };
    }
    if (!isSlugShaped(slug)) return { kind: "unavailable" };

    const session = await auth();
    const check = assertGivingSession(session);
    if (check.kind !== "ok") return { kind: "error" };

    const resolved = await resolveOrgContext(check.userId, slug);
    if (resolved.kind !== "ok") return { kind: "unavailable" };
    const org = resolved.org;

    let toggle: Awaited<ReturnType<typeof loadGivingToggle>>;
    try {
      toggle = await loadGivingToggle({
        personId: org.personId,
        organizationId: org.organizationId,
        organizationType: org.organizationType,
      });
    } catch (err) {
      // A membership that ended between the resolve and the transaction reads as
      // "not available"; a database blip is an honest error, never a silent "off".
      return err instanceof OrgAccessError ? { kind: "unavailable" } : { kind: "error" };
    }
    if (toggle !== "on") return { kind: "unavailable" };

    // The viewer's own active membership here. `OrgContext` does not carry its id.
    const memberships = await userOrganizations(check.userId);
    const membership = memberships.find(
      (m) => m.organizationId === org.organizationId && m.personId === org.personId && m.endedOn === null,
    );
    if (!membership) return { kind: "unavailable" };

    const actor = check.userId;
    const limits = [
      { key: `giving_session_user:${check.userId}`, max: 10, windowSeconds: 600, reason: "giving_session_user" },
      { key: "giving_session_global", max: 2000, windowSeconds: 3600, reason: "giving_session_global" },
    ];
    for (const limit of limits) {
      const verdict = await checkRateLimit(
        limit.key,
        { max: limit.max, windowSeconds: limit.windowSeconds },
        { userId: check.userId, actor, reason: limit.reason },
      );
      if (!verdict.allowed) {
        return { kind: "rate_limited", retryAfterSeconds: verdict.retryAfterSeconds };
      }
    }

    const parsed = parseGiveForm(formData);
    if (!parsed.ok) return parsed.result;

    // audit-exempt: starting a gift is not a security-sensitive mutation, and money
    // moves only when Stripe's signed webhook is applied (which audits what it records).
    return await startGiveSession({
      surface: "member",
      slug,
      parsed: parsed.value,
      create: () =>
        createMemberIntent(
          { personId: org.personId, organizationId: org.organizationId },
          membership.membershipId,
          parsed.value,
        ),
    });
  } catch {
    return { kind: "error" };
  }
}
