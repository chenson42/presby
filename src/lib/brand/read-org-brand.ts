import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { OrgAccessError, withOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { organizationBrands } from "@/lib/db/domain/org";
import { getBlobStore } from "@/lib/storage/blob-store";
import { generateBrandTokens, type BrandTokenSet } from "./generate";
import { resolveTypePairing, type ResolvedTypePairing } from "./fonts";
import { TYPE_PAIRINGS, type TypePairingKey } from "./contract";

/**
 * The `(org)` brand read — P0.5 slice c, commit `c4`. The ONE function
 * `(org)/o/[slug]/layout.tsx` calls to decide what `<BrandTokens>` renders.
 *
 * ⚠ DEVIATION FROM THE DESIGN'S LITERAL SIGNATURE, found by running this
 * against a real browser rather than trusting the shape on paper — the
 * design brief specified `getOrgBrandForLayout(organizationId: string)`,
 * deriving `personId` internally from `cachedAuth()`. That does not work:
 * `session.user.id` is `users.id` (the auth identity), and
 * `withOrgContext()` — and the `memberships.person_id` it checks against —
 * needs `people.id`. Those are DIFFERENT ids related through
 * `people.user_id`, and `resolveOrgContext()` is exactly the function that
 * already did that join to produce `resolved.org.personId`. Deriving
 * `personId` a second, WRONG way here didn't fail loudly — it failed
 * exactly like "no membership": `withOrgContext()` threw `OrgAccessError`
 * for a real member, on every request, and the caller (by design) cannot
 * tell that apart from "not a member" or "flag off". A `console.error`
 * planted at each return point during verification was what surfaced it; a
 * screenshot alone would have shown a quietly-unbranded page and nothing
 * else. See this commit's work-log section for the full account. FIX: this
 * function takes the ALREADY-RESOLVED `personId` (`resolved.org.personId`)
 * as a second parameter instead of re-deriving it, which is also cheaper —
 * no second `cachedAuth()` call.
 *
 * NULL-SAFE BY CONSTRUCTION, not by discipline. Three, and only three,
 * reasons this returns `null`, and the caller never needs to tell them apart
 * — all three mean "render the platform default":
 *
 *   1. `ui.brand_theming` is off. The platform-wide rollback switch
 *      (Phase 3 (re-run), "Permissions & Flags") — gates (org) EMISSION only;
 *      the (admin) write/preview path at `/admin/organizations` works
 *      regardless, so an operator can stage a brand before this flips.
 *   2. No active membership. The common case is filtered before this
 *      function is even called — the layout only calls it after
 *      `resolveOrgContext()` returns `"ok"`, which means the caller already
 *      resolved a live relationship and the `personId`/`organizationId` pair
 *      it hands in came from that resolution, not from a raw session. The
 *      RARE case is the genuine race `OrgAccessError` documents in
 *      authz.ts: the relationship vanishes between that resolve and this
 *      function's own `withOrgContext()` re-check, which runs regardless of
 *      the caller's prior resolve — RLS demands a live, in-transaction
 *      membership check before it will hand back a row from
 *      `organization_brands`, and skipping it here because "the layout
 *      already knows" would be exactly the kind of shortcut F26 punishes.
 *   3. No `organization_brands` row. This organization has never been
 *      branded (or was neutralised) — the platform default is correct, not
 *      a degraded state.
 *
 * TOKENS ARE REGENERATED LIVE FROM THE STORED SEED, NEVER CACHED AS
 * RENDERED CSS. `organization_brands` stores `seed_hex` and
 * `brand_token_version`, not a colour ramp — `generateBrandTokens()` is
 * pure and deterministic (D8), so recomputing it on every read costs one
 * OKLCH round-trip per request and keeps `BRAND_TOKEN_VERSION` meaningful:
 * if a future generator version bump ever needs to re-render an org's
 * ALREADY-STORED tokens differently, a cached CSS string would still be
 * serving the old render until something remembered to invalidate it. A
 * stored ramp is a second place ramps live, and the two WILL drift (see
 * G9's rejection of `sites.theme_tokens` for the same reason). Finding for
 * Phase 6: if this read ever shows up as a hot path in production, the fix
 * is an org-scoped cache keyed on `(organization_id, brand_token_version)`
 * — invalidated automatically by the version bump itself — not a raw CSS
 * cache that has to be told when to expire.
 *
 * `cache()`-wrapped so a second call with the same arguments within one RSC
 * render pass (e.g. a future child segment wanting the same data) costs
 * nothing further. It does NOT dedupe against `resolveOrgContext()`'s own DB
 * read, which both this layout and `page.tsx`'s `assertOrgAccess()` call
 * independently today — `resolveOrgContext` is not itself `cache()`-wrapped,
 * so the membership list is read twice per `(org)` page render. Named here
 * rather than silently accepted: see docs/TODO.md for the follow-up (wrap
 * `resolveOrgContext` in `cache()`, matching `cachedAuth.ts`'s precedent) —
 * deferred out of this commit to keep the diff scoped to the files this
 * design names.
 */
export type OrgBrandForLayout = {
  /** Both `light` and `dark` — DECISION-050. `<BrandTokens>` emits both in
   * one element so `next-themes` can select between them with zero re-render. */
  tokens: BrandTokenSet;
  fontPairing: ResolvedTypePairing;
  /** `organization_brands.light_only` — see docs/work-log/2026-08-24-
   * light-only-brand.md. Passed straight through to `<BrandTokens
   * lightOnly>`; this function doesn't interpret it. */
  lightOnly: boolean;
};

const TYPE_PAIRING_KEYS = new Set<string>(TYPE_PAIRINGS.map((p) => p.key));

/** Identical pattern to `/admin/organizations/[id]/actions.ts`'s own guard —
 * the DB CHECK (`organization_brands_type_pairing_allowed`) already refuses
 * anything else at write time, so reaching the fallback below means the
 * CHECK was added after a row existed, or the constraint was dropped in a
 * hand-run migration. A church's colours should not vanish because of that;
 * a fallback to "classic" degrades to a font choice, not a blank page. */
function isTypePairingKey(value: string): value is TypePairingKey {
  return TYPE_PAIRING_KEYS.has(value);
}

export const getOrgBrandForLayout = cache(
  async (
    organizationId: string,
    personId: string,
  ): Promise<OrgBrandForLayout | null> => {
    // Reason 1 — cheapest check first, no DB round trip for the membership
    // or the brand row if the platform-wide switch is off.
    if (!(await isFlagEnabled("ui.brand_theming"))) return null;

    let row;
    try {
      row = await withOrgContext(personId, organizationId, async (tx) => {
        const [r] = await tx
          .select()
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, organizationId))
          .limit(1);
        return r ?? null;
      });
    } catch (err) {
      // Reason 2, the rare path — see this function's header comment.
      if (err instanceof OrgAccessError) return null;
      throw err;
    }

    // Reason 3 — never branded, or neutralised back to the platform default.
    if (!row) return null;

    const { tokens } = generateBrandTokens(row.seedHex);
    const pairingKey = isTypePairingKey(row.typePairing)
      ? row.typePairing
      : "classic";

    return { tokens, fontPairing: resolveTypePairing(pairingKey), lightOnly: row.lightOnly };
  },
);

/**
 * The `(org)` header-mark read — portal-chrome pipeline (docs/work-log/
 * 2026-08-25-portal-chrome.md), `GlobalNav`'s `orgMark` prop.
 *
 * DELIBERATELY NOT GATED ON `ui.brand_theming`, unlike `getOrgBrandForLayout`
 * above — a logo is identity, not brand chrome (DECISION-047's "un-brandable
 * does not mean logo-free", G7). An organization's mark should still swap in
 * for the platform wordmark even with the colour/font rollback switch off;
 * the two flags answer different questions and this function does not
 * conflate them. It IS gated on `org_portal.chrome_v2` — but by the caller
 * (`(org)/o/[slug]/layout.tsx`), not here, the same division of labor
 * `getOrgBrandForLayout` already has with `ui.brand_theming`: this function
 * is a plain data read, and the flag check belongs where the flag is defined
 * to gate ("Org-identity header ... in (org)").
 *
 * MEMBERSHIP-VERIFIED, same pattern as `getOrgBrandForLayout`: the caller
 * must have already resolved an ACTIVE relationship (`resolveOrgContext()`
 * returning `"ok"`) and hands in THAT resolution's `organizationId`/
 * `personId` pair, not a raw session id. `withOrgContext()` re-verifies
 * inside the transaction regardless of what the caller already found — same
 * F26-motivated discipline, not a redundant check.
 *
 * INLINES THE LOGO AS A `data:` URI AT RENDER TIME, exactly like
 * `/admin/organizations/[id]/page.tsx` already does — NOT the public
 * `/site/<slug>/assets/<key>` route, which is gated on `sites.public_render`
 * + site publication (an unrelated feature) and would 404 a portal header for
 * any organization without a published public site. The header is an
 * authenticated, server-rendered page; there is nothing to gain here from a
 * second asset route this pipeline doesn't otherwise need.
 *
 * Returns `null` on: no `organization_brands` row, a row with no
 * `markAssetKey`, an unresolvable blob (a stale key from a deleted asset —
 * `resolve()` itself returns `null` rather than throwing), or the same
 * `OrgAccessError` race `getOrgBrandForLayout` documents. The caller treats
 * `null` as "no mark, render initials" — `OrgMark` already does that
 * fallback, so this function does not need a separate "not found" shape.
 *
 * `cache()`-wrapped for the same reason as `getOrgBrandForLayout`: a second
 * call with the same arguments within one RSC render pass costs nothing
 * further.
 */
export type OrgMarkForLayout = {
  markSrc: string | null;
};

export const getOrgMarkForLayout = cache(
  async (
    organizationId: string,
    personId: string,
  ): Promise<OrgMarkForLayout | null> => {
    let row;
    try {
      row = await withOrgContext(personId, organizationId, async (tx) => {
        const [r] = await tx
          .select({ markAssetKey: organizationBrands.markAssetKey })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, organizationId))
          .limit(1);
        return r ?? null;
      });
    } catch (err) {
      if (err instanceof OrgAccessError) return null;
      throw err;
    }

    if (!row?.markAssetKey) return null;

    const resolved = await getBlobStore().resolve({
      organizationId,
      key: row.markAssetKey,
    });
    if (!resolved) return null;

    return {
      markSrc: `data:${resolved.contentType};base64,${resolved.bytes.toString("base64")}`,
    };
  },
);
