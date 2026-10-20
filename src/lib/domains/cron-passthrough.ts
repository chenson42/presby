import { timingSafeEqual } from "node:crypto";

/**
 * cron-passthrough.ts - the A6 exemption (Phase 2 addendum A6, Phase 3 API
 * Contract section 2; amends R4 and DECISION-176).
 *
 * WHY IT EXISTS. Vercel's cron docs say only "an HTTP GET request to your
 * project's production deployment URL"; they do not rule out a scheduled
 * invocation arriving on a church's custom domain (the same ambiguity behind
 * F148). R4 makes `/api/*` a 404 on every custom host, so a cron that landed
 * there would fail SILENTLY, and since T5 made church mail depend entirely on
 * the email-queue cron, that is worse than any host-resolution bug. So the
 * proxy's custom-host branch lets one request class through before the rewrite.
 *
 * WHAT IT PASSES, and only this: `CRON_SECRET` is set and non-empty AND the
 * pathname is STRICTLY EQUAL to one of `CRON_PATHS` AND `Authorization` is
 * `Bearer ${CRON_SECRET}` under a constant-time compare. Nothing else:
 *   - never keyed on the user agent or `x-vercel-cron-schedule` (forgeable);
 *   - no prefix, no trailing slash, no case folding, no decoding, no dot
 *     segments: `/api/cron/email-queue/`, `/API/cron/email-queue`,
 *     `/api/cron/%65mail-queue` and `//api/cron/email-queue` all MISS and fall
 *     through to the same rewrite (so the same neutral 404) as any other
 *     `/api/*` path. Next hands the proxy a pathname that is already
 *     normalized, which is the only form that can match;
 *   - no database, no cookies, no session.
 * The handlers keep their own bearer check, so this is a second lock on the
 * same key, not a replacement for either.
 *
 * `CRON_PATHS` is pinned to `vercel.json`'s `crons[].path` set by a test (set
 * equality: a cron added to one and not the other fails CI).
 *
 * PROXY-SAFE: `node:crypto` only. src/proxy.ts may import this file, host.ts
 * and probe.ts from this module and nothing else (check:proxy-imports).
 */
export const CRON_PATHS: readonly string[] = [
  "/api/cron/email-queue",
  "/api/cron/maintenance",
  "/api/cron/giving",
  "/api/cron/domains",
];

/** Constant-time equality with an explicit length check (timingSafeEqual throws on unequal lengths). */
function bearerMatches(authorization: string, secret: string): boolean {
  const a = Buffer.from(authorization);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * True only for an exact cron path carrying the exact bearer. Pure: takes its
 * three inputs and reads nothing ambient. Never throws.
 */
export function isCronRequest(
  pathname: string,
  authorization: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (typeof secret !== "string" || secret === "") return false;
  if (typeof authorization !== "string" || authorization === "") return false;
  if (!CRON_PATHS.includes(pathname)) return false;
  return bearerMatches(authorization, secret);
}
