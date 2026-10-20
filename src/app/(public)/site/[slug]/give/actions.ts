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
import { parseSiteKey } from "@/lib/domains/host";
import { resolveGiveSite } from "@/lib/sites";

/**
 * `(public)/site/[slug]/give`'s one Server Action - the anonymous way a visitor
 * starts a gift. docs/work-log/2026-10-15-online-giving.md, Phase 3 "Public
 * surface actions" and "Checkout-intent lifecycle". The donor leaves presby for
 * Stripe-hosted Checkout by REDIRECT ONLY; card and bank data never touch this
 * server (SAQ-A).
 *
 * No `auth()`, no session, no cookie: every caller is anonymous by construction
 * and `src/proxy.ts`'s `/site/*` bypass means the Edge never sees this route (on
 * a church's own domain the proxy rewrites to the same route, still with no
 * session and no `Set-Cookie`).
 *
 * THE ORGANIZATION COMES FROM THE SITE KEY BOUND ON THE SERVER (Track F, R5):
 * `createPublicGiveSessionAction.bind(null, key)` in the page and the slot,
 * never a form field. The action re-resolves it with `resolveGiveSite()` - which
 * in host mode requires the request Host to equal the key - and uses the slug
 * THE DATABASE RETURNED for the limiter keys, the intent and the redirect
 * origin. The database re-derives the organization from that slug and refuses an
 * unknown or non-tenant one.
 *
 * ORDER IS THE DEFENCE (R13) - cheapest and least informative first:
 *   1. honeypot        a filled hidden field answers a fake `unavailable`, spends NO budget
 *   2. rate limits     three keys, each checked only if the one before allowed it:
 *                        giving_session:<key>:<ip>    10 per 10 minutes  (<key> = the bound site key:
 *                        giving_session_site:<key>    120 per hour        the slug, or a custom host)
 *                        giving_session_global        2000 per hour (the platform's Stripe key is
 *                                                     shared by every congregation, so exhausting
 *                                                     it is a cross-tenant outage)
 *   3. Turnstile       a no-op unless TURNSTILE_SECRET_KEY is set
 *   4. parse           the amount is a STRING parsed once by `parseAmountToCents`
 *   4b. resolve        the bound key -> the DB-returned slug (`resolveGiveSite`; host mode needs Host === key)
 *   5. intent -> Stripe  `startGiveSession` (the database computes the total)
 * The in-memory limiter is per serverless instance: Upstash configured is a
 * go-live item (docs/deployment.md), and the database's flood cap in
 * `presby_giving_create_intent_*` (the 201st `created` intent an hour) is the
 * infrastructure-independent backstop.
 *
 * The redirect targets (`success_url`, `cancel_url`) are built inside
 * `startGiveSession` from `donorOrigin(slug)`: the DATABASE's serving canonical
 * host for that organization, else the platform origin from the environment -
 * computed from the DB-returned slug, never from the request. A spoofed `Host` /
 * `X-Forwarded-Host` cannot move them (pinned by a test). This file reads
 * `headers()` for the client IP only.
 *
 * Returns the `GiveResult` union and nothing else; never throws.
 */
export async function createPublicGiveSessionAction(
  siteKey: string,
  formData: FormData,
): Promise<GiveResult> {
  try {
    // 1. Honeypot: a hidden field real visitors never fill. Fake "not available",
    // no rate-limit spend, no database - a bot learns nothing.
    if (formString(formData, GIVE_FORM_FIELDS.honeypot).trim().length > 0) {
      return { kind: "unavailable" };
    }
    // A site key is a slug (a DNS label) or a hostname. Anything else is not a
    // congregation, and must not mint limiter keys (the in-memory store is bounded but
    // shared). This is a SHAPE check only - no database - so it keeps the order below:
    // the cheapest, least informative defences run before anything touches the network.
    if (parseSiteKey(siteKey).kind === "invalid") return { kind: "unavailable" };

    const ip = getRequestIp(await headers());
    const actor = ip ?? "unknown";

    // 2. Rate limits, in the stated order; the first refusal answers.
    const limits = [
      // Keyed by the site key: the slug on a platform URL (unchanged), the host on a church's
      // own domain. The per-organization flood cap in the database is the backstop either way.
      { key: `giving_session:${siteKey}:${actor}`, max: 10, windowSeconds: 600, reason: "giving_session_ip" },
      { key: `giving_session_site:${siteKey}`, max: 120, windowSeconds: 3600, reason: "giving_session_site" },
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

    // 4b. Re-resolve the bound key against THIS request (host mode: the request Host must
    // EQUAL the key). From here on the organization is the slug THE DATABASE returned, never
    // anything the visitor sent.
    const target = await resolveGiveSite(siteKey);
    if (target === null || !isSlugShaped(target.slug)) return { kind: "unavailable" };
    const slug = target.slug;

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
