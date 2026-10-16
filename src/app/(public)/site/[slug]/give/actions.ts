"use server";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/request-ip";
import { verifyTurnstile } from "@/lib/turnstile";
import { createPublicIntent, startGiveSession } from "@/lib/giving/give-session";
import {
  GIVE_FORM_FIELDS,
  formString,
  isSlugShaped,
  parseGiveForm,
  type GiveResult,
} from "@/lib/giving/give-input";
import { GIVE_MESSAGES } from "@/lib/giving/giving-copy";

/**
 * `(public)/site/[slug]/give`'s one Server Action - the anonymous way a visitor
 * starts a gift. docs/work-log/2026-10-15-online-giving.md, Phase 3 "Public
 * surface actions" and "Checkout-intent lifecycle". The donor leaves presby for
 * Stripe-hosted Checkout by REDIRECT ONLY; card and bank data never touch this
 * server (SAQ-A).
 *
 * No `auth()`, no session, no cookie: every caller is anonymous by construction
 * and `src/proxy.ts`'s `/site/*` bypass means the Edge never sees this route.
 * The organization comes from the `slug` argument (the URL segment) and nowhere
 * else; the database re-derives it and refuses an unknown or non-tenant slug.
 *
 * ORDER IS THE DEFENCE (R13) - cheapest and least informative first:
 *   1. honeypot        a filled hidden field answers a fake `unavailable`, spends NO budget
 *   2. rate limits     three keys, each checked only if the one before allowed it:
 *                        giving_session:<slug>:<ip>   10 per 10 minutes
 *                        giving_session_site:<slug>   120 per hour
 *                        giving_session_global        2000 per hour (the platform's Stripe key is
 *                                                     shared by every congregation, so exhausting
 *                                                     it is a cross-tenant outage)
 *   3. Turnstile       a no-op unless TURNSTILE_SECRET_KEY is set
 *   4. parse           the amount is a STRING parsed once by `parseAmountToCents`
 *   5. intent -> Stripe  `startGiveSession` (the database computes the total)
 * The in-memory limiter is per serverless instance: Upstash configured is a
 * go-live item (docs/deployment.md), and the database's flood cap in
 * `presby_giving_create_intent_*` (the 201st `created` intent an hour) is the
 * infrastructure-independent backstop.
 *
 * The redirect targets are built from `givingOrigin()` (env), never from the
 * request: this file reads `headers()` for the client IP only.
 *
 * Returns the `GiveResult` union and nothing else; never throws.
 */
export async function createPublicGiveSessionAction(
  slug: string,
  formData: FormData,
): Promise<GiveResult> {
  try {
    // 1. Honeypot: a hidden field real visitors never fill. Fake "not available",
    // no rate-limit spend, no database - a bot learns nothing.
    if (formString(formData, GIVE_FORM_FIELDS.honeypot).trim().length > 0) {
      return { kind: "unavailable" };
    }
    // A slug is a DNS label. Anything else is not a congregation, and must not
    // mint limiter keys (the in-memory store is bounded but shared).
    if (!isSlugShaped(slug)) return { kind: "unavailable" };

    const ip = getRequestIp(await headers());
    const actor = ip ?? "unknown";

    // 2. Rate limits, in the stated order; the first refusal answers.
    const limits = [
      { key: `giving_session:${slug}:${actor}`, max: 10, windowSeconds: 600, reason: "giving_session_ip" },
      { key: `giving_session_site:${slug}`, max: 120, windowSeconds: 3600, reason: "giving_session_site" },
      { key: "giving_session_global", max: 2000, windowSeconds: 3600, reason: "giving_session_global" },
    ];
    for (const limit of limits) {
      const verdict = await checkRateLimit(
        limit.key,
        { max: limit.max, windowSeconds: limit.windowSeconds },
        { userId: null, actor, reason: limit.reason },
      );
      if (!verdict.allowed) {
        return { kind: "rate_limited", retryAfterSeconds: verdict.retryAfterSeconds };
      }
    }

    // 3. Turnstile (the widget's own field is accepted as a fallback).
    const token =
      formString(formData, GIVE_FORM_FIELDS.turnstileToken) ||
      formString(formData, GIVE_FORM_FIELDS.turnstileWidgetField);
    if (!(await verifyTurnstile(token || null, ip))) {
      return { kind: "invalid", field: "form", message: GIVE_MESSAGES.captcha };
    }

    // 4. Parse. The first wrong field is named.
    const parsed = parseGiveForm(formData);
    if (!parsed.ok) return parsed.result;

    // 5. Intent -> Stripe.
    // audit-exempt: an anonymous, low-stakes request to START a gift is not a
    // security-sensitive mutation (like the public contact form). Money moves only
    // when Stripe's signed webhook is applied, and that path audits what it records.
    return await startGiveSession({
      surface: "public",
      slug,
      parsed: parsed.value,
      create: () => createPublicIntent(slug, parsed.value),
    });
  } catch {
    // checkRateLimit / headers / verifyTurnstile failing is not a reason to leak a stack.
    return { kind: "error" };
  }
}
