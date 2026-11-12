/**
 * The Learn contract - pure: no `server-only`, no database, no `next/*`. Safe for a
 * client component, the public pages, the slot and the `(org)` page alike
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "API Contract"; DECISION-330 to 333).
 */

/** The per-org toggle. The catalog entry in `src/lib/org-features.ts` repeats this string and `presby_learn_enabled()` (drizzle/0087) composes it in SQL; `learn-toggle.test.ts` pins the three equal. */
export const SPOT_THE_SCAM_FEATURE_KEY = "org_portal.spot_the_scam";

/** The `liveSlot` block name a content author places (`{"type":"liveSlot","props":{"slot":"spotTheScam"}}`). */
export const SPOT_THE_SCAM_SLOT = "spotTheScam";

/** The platform-owned page, relative to a site. `SiteUrls.spotTheScam()` returns this (host mode) or `page(...)` of it (slug mode); `contract.test.ts` pins the equality. */
export const SPOT_THE_SCAM_PAGE_PATH = "/learn/spot-the-scam";

/**
 * The closed list of toggle keys the anonymous reader accepts. A key outside it never
 * reaches the database; the SQL predicate's own `CASE` is closed too (DECISION-331), so
 * an anonymous caller can never use this read to ask about a non-Learn toggle. A later
 * static Learn page adds its key here and to the predicate in its own migration.
 */
export const LEARN_PUBLIC_KEYS = [SPOT_THE_SCAM_FEATURE_KEY] as const;
export type LearnPublicKey = (typeof LEARN_PUBLIC_KEYS)[number];

/**
 * What the one anonymous read returns. `unavailable` is ONE answer for every cause (the
 * toggle or the category is off, the site is not serving, the organization is not
 * active, the slug is unknown: DECISION-040, DECISION-154); `failed` is a read that did
 * not complete and says nothing about the organization.
 */
export type PublicLearn =
  | { state: "available" }
  | { state: "unavailable" }
  | { state: "failed" };

export function isLearnPublicKey(key: unknown): key is LearnPublicKey {
  return typeof key === "string" && (LEARN_PUBLIC_KEYS as readonly string[]).includes(key);
}
