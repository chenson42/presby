import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseSiteKey } from "@/lib/domains/host";
import { givingOrigin } from "./origin";
import { rowsOf } from "./db-util";

/**
 * Where a PUBLIC donor is sent back to after Stripe Checkout (docs/work-log/
 * 2026-10-19-custom-domains.md, Phase 2 R5, Phase 3 section 4, DECISION-181).
 *
 * A donor who gives from `https://church.example/give` must come back to
 * `https://church.example/give/return`, not to the platform's `/site/<slug>/give`
 * - the church's domain is the site they were on and trust. So `success_url` and
 * `cancel_url` for the PUBLIC surface are built on this origin:
 *
 *   - the organization's SERVING canonical custom host, from the DATABASE
 *     (`presby_published_site(slug).serving_host`: the same predicate that decides
 *     whether the host serves and whether the slug URL redirects, so a donor is
 *     never sent to a host that is dark); otherwise
 *   - `givingOrigin()`, the platform origin from the environment.
 *
 * IT TAKES A SLUG AND NOTHING ELSE. It never reads the request, a header or a
 * form field (R3, A11): the slug is the one the database returned for the bound
 * site key, and the host comes from the database row. A spoofed `Host` or
 * `X-Forwarded-Host` has no way in. Treasurer onboarding (`connection.ts`) and the
 * statement-notice link (`statements.ts`) keep using `givingOrigin()` directly:
 * those are platform-host flows by design.
 *
 * FAILS TO THE PLATFORM ORIGIN, never to a guess: a missing row, a malformed host
 * or a database error all mean "no custom host", and the donor returns to the
 * platform URL exactly as before Track F. (A lookup failure is logged with the slug
 * only.) The one named residual (R5): `success_url` is fixed when the Checkout
 * session is created, so a host that lapses mid-checkout returns the donor to a 404.
 */
export interface DonorOrigin {
  /** `https://host` for a custom host, or the platform origin. No trailing slash. */
  origin: string;
  /** True when `origin` is a church's custom host (paths are clean: `/give`, not `/site/<slug>/give`). */
  custom: boolean;
}

export async function donorOrigin(slug: string): Promise<DonorOrigin | null> {
  try {
    const result = await db.execute(sql`select serving_host from presby_published_site(${slug}::text)`);
    const host = rowsOf(result)[0]?.serving_host;
    if (typeof host === "string" && parseSiteKey(host).kind === "host") {
      return { origin: `https://${host}`, custom: true };
    }
  } catch {
    console.error("[giving/donor-origin] serving host lookup failed; using the platform origin", { slug });
  }
  const platform = givingOrigin();
  return platform ? { origin: platform, custom: false } : null;
}
