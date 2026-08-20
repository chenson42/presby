"use server";

import { headers } from "next/headers";
import { getRequestIp } from "@/lib/request-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { submitSiteContactMessage } from "@/lib/sites";
import type { ActionResult } from "@/types/actions";

/**
 * `(public)/site/[slug]`'s Server Actions — the one anonymous write path in
 * this whole feature. See docs/work-log/2026-08-20-public-sites.md Phase 3
 * "Server actions — call sites", DECISION-083.
 *
 * No `auth()` anywhere in this file — every caller is an anonymous visitor
 * by construction, and `src/proxy.ts`'s `/site/*` bypass (commit 3,
 * DECISION-085) means this route never reaches the Edge auth check either.
 */

/**
 * Submits a `ContactForm` message for the public site at `slug`.
 *
 * Order, deliberately: honeypot check first (free — costs nothing to reject
 * a bot before it can consume rate-limit budget), then the IP-keyed rate
 * limit (mirrors `(password-reset)/actions.ts`'s identical precedent, scoped
 * per-site so one bad IP can't exhaust every congregation's shared budget at
 * once), then the query-layer call, which re-derives `organizationId` from
 * `slug` itself — never trusts anything from the client but the slug already
 * baked into the URL.
 *
 * No audit event — an anonymous, low-stakes content submission is not a
 * security-sensitive mutation, matching `replyToTicket`'s own "a reply is
 * conversation, not a security-sensitive mutation" precedent.
 */
export async function submitContactMessageAction(
  slug: string,
  formData: FormData,
): Promise<ActionResult> {
  // Honeypot: a hidden field real visitors never fill. Non-empty -> fake
  // success, no DB write, no rate-limit consumption — a bot that fills every
  // field gets no signal that anything tripped.
  const honeypot = String(formData.get("_hp") ?? "");
  if (honeypot.trim().length > 0) {
    return { ok: true };
  }

  const hdrs = await headers();
  const ip = getRequestIp(hdrs);

  const limited = await checkRateLimit(
    `site_contact:${slug}:${ip ?? "unknown"}`,
    { max: 5, windowSeconds: 3600 },
    { userId: null, actor: ip ?? "unknown", reason: "site_contact_form" },
  );
  if (!limited.allowed) {
    const mins = Math.ceil(limited.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `Too many messages sent. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }

  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const body = String(formData.get("body") ?? "");

  const result = await submitSiteContactMessage(slug, { name, email, body });

  switch (result.kind) {
    case "not_live":
      return {
        ok: false,
        error: "This site isn't accepting messages right now.",
      };
    case "invalid_input":
      return { ok: false, error: result.error };
    case "ok":
      return { ok: true };
  }
}
