import "server-only";
import { resolveSiteOrganization } from "@/lib/sites";
import { buildSiteUrls } from "@/lib/site-urls";
import { SPOT_THE_SCAM_FEATURE_KEY } from "./contract";
import { readPublicLearn } from "./public";

/**
 * Whether the public Spot the scam page is live, for the `(org)` page's leader panel
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "TypeScript surface" and flag F442;
 * DECISION-334). The panel must never say "live" while the public route 404s, so it runs the
 * public route's OWN two steps in the SAME order: `resolveSiteOrganization` (the render flag,
 * host rules, `presby_published_site`), then `readPublicLearn` (the toggle and the site-live
 * gates). Never `withOrgContext`, never `getPlatformDb()`: a second computation of the same
 * answer could disagree with the route.
 *
 * The address is built ONLY from `SiteUrls`, with the database-returned slug and, when a custom
 * host is serving, the database-returned canonical host (`redirectHost`): never from a request
 * value. A read that did not complete is `unknown`, never `not_live`.
 */
export type LeaderLink =
  | { kind: "live"; address: string; href: string }
  | { kind: "not_live" }
  | { kind: "unknown" };

export async function readLeaderLink(slug: string): Promise<LeaderLink> {
  const org = await resolveSiteOrganization(slug);
  if (org.kind !== "ok") return org.reason === "read_failed" ? { kind: "unknown" } : { kind: "not_live" };

  const learn = await readPublicLearn(org.slug, SPOT_THE_SCAM_FEATURE_KEY);
  if (learn.state === "failed") return { kind: "unknown" };
  if (learn.state === "unavailable") return { kind: "not_live" };

  // The slug URL hands off to a serving custom host (307), so share the host's own address.
  const urls = org.redirectHost
    ? buildSiteUrls({ mode: "host", host: org.redirectHost, slug: org.slug, platformOrigin: org.urls.origin })
    : org.urls;
  const href = urls.origin + urls.spotTheScam();
  return { kind: "live", address: href.replace(/^https?:\/\//, ""), href };
}
