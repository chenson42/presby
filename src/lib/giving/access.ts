import "server-only";
import { withOrgContext, type OrganizationType } from "@/lib/authz";
import {
  GIVING_KEYS,
  GIVING_TOGGLE_KEY,
} from "./access-pure";
import { holdsPermissions } from "./keys";
import {
  ORG_FEATURE_CATALOG,
  isCategoryAxisOn,
  orgFeatureEnabledInTx,
  orgTypeAdmitted,
} from "@/lib/org-features";

/**
 * The giving surfaces' shared gate — docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Permissions & Flags → Gate order on every surface", steps 3 to 5.
 * (Steps 1 and 2 — the Edge, then `cachedAuth()` -> `resolveOrgContext()` ->
 * `assertOrgAccess()` — stay in each page/action/route, because the auth check
 * lives in the page, not here and not in a layout.)
 *
 *   3. `assertGivingSession()`  the Node-side 2FA check (R4). The Edge reads
 *      the `twoFactorRequired` claim, which refreshes only when the session is
 *      re-derived, so a user who has JUST been granted a giving key carries a
 *      stale `false` until then. Every `admin/giving/**` surface therefore
 *      re-checks the claim itself and refuses when
 *      `twoFactorRequired && !twoFactorVerified`: pages redirect to
 *      `/totp?callbackUrl=...`, actions return `{ kind: "two_factor_required" }`,
 *      route handlers answer a 307 to the same URL. The MEMBER giving pages
 *      (`/o/<slug>/giving/**`) are NOT forced — the self-view needs no key and
 *      holding none requires no 2FA. This function is pure on purpose: it reads
 *      only the session the caller already has.
 *   4. `loadGivingContext()`    org-type applicability, then the org toggle
 *      (`orgFeatureEnabledInTx`, which composes the category axis), then —
 *      only when the toggle is on — the viewer's three giving keys, all in ONE
 *      `withOrgContext` transaction. "Off" is an honest state, never a 404, and
 *      it carries `canManageFeatures` so the page can link to Features only for
 *      someone who can use it, without a second page-level permission read
 *      (DECISION-162's rule).
 *   5. The page/action then applies the specific key it needs from `has`.
 *
 * NO PLATFORM FLAG anywhere in this file (R11): giving is toggle-only, and
 * `ORG_FEATURE_CATALOG`'s `org_portal.giving` entry has `flag: null`. Ingest
 * (webhook, cron, replay) never calls this module — turning Giving off hides
 * surfaces and never stops recording recurring gifts.
 *
 * RLS enforces tenancy, not authorization (CLAUDE.md → Isolation): the
 * `has.*` answers come from `presby_has_permission()`, the resolver, never from
 * a session claim and never from `FEATURES.*`.
 */

const ORG_FEATURES_MANAGE = "org_features.manage";

// The pure half (keys, toggle key, 2FA check, /totp redirect) lives in
// ./access-pure so it loads without a database; re-exported here so callers
// have one import site.
export {
  GIVING_KEYS,
  GIVING_TOGGLE_KEY,
  assertGivingSession,
  givingTotpRedirectUrl,
  type GivingKey,
  type GivingSessionCheck,
  type GivingSessionLike,
} from "./access-pure";

// ---------------------------------------------------------------------------
// Step 4 — applicability, toggle, then the viewer's keys
// ---------------------------------------------------------------------------

/** What `resolveOrgContext()`'s `ok` branch already hands the page. */
export interface GivingViewer {
  personId: string;
  organizationId: string;
  organizationType: OrganizationType;
}

export type GivingContext =
  /** The organization's type is outside the toggle's allow-list (a presbytery,
   * synod or GA). No database was touched. */
  | { kind: "not_applicable" }
  /** The org toggle is off (or the giving category is). `canManageFeatures` is
   * read in the same transaction so the page can offer the Features link. */
  | { kind: "toggle_off"; canManageFeatures: boolean }
  /** Toggle on, but the viewer holds none of the three giving keys. */
  | { kind: "forbidden" }
  | {
      kind: "ok";
      /** Exactly which giving keys the viewer holds right now. No key implies
       * another; a page needing `giving.manage` checks `has.manage`. */
      has: { view: boolean; record: boolean; manage: boolean };
    };

/**
 * Loads the gate answers for one viewer at one organization. Throws
 * `OrgAccessError` (from `withOrgContext`) when the membership ended between
 * the resolve and the transaction — genuinely broken, not a "disabled" answer —
 * and lets a database failure throw; the caller turns that into its LoadError
 * state, never an empty or "off" answer (a blip must not read as revoked).
 */
export async function loadGivingContext(viewer: GivingViewer): Promise<GivingContext> {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === GIVING_TOGGLE_KEY);
  // Defensive: the catalog entry is the single source of the applicability
  // list; a missing entry is a programming error, not a runtime state.
  if (!entry) throw new Error(`loadGivingContext: ${GIVING_TOGGLE_KEY} is not in ORG_FEATURE_CATALOG`);

  if (!orgTypeAdmitted(entry.orgTypes, viewer.organizationType)) {
    return { kind: "not_applicable" };
  }

  // The category-axis kill switch is read OUTSIDE the transaction
  // (isFlagEnabled runs on its own connection); see org-features.ts.
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const enabled = await orgFeatureEnabledInTx(
      tx,
      viewer.organizationId,
      GIVING_TOGGLE_KEY,
      categoryAxisOn,
    );
    if (!enabled) {
      const [canManageFeatures] = await holdsPermissions(tx, viewer, [ORG_FEATURES_MANAGE]);
      return { kind: "toggle_off", canManageFeatures: canManageFeatures === true };
    }

    const [view, record, manage] = await holdsPermissions(tx, viewer, [
      GIVING_KEYS.view,
      GIVING_KEYS.record,
      GIVING_KEYS.manage,
    ]);
    const has = { view: view === true, record: record === true, manage: manage === true };
    if (!has.view && !has.record && !has.manage) return { kind: "forbidden" };
    return { kind: "ok", has };
  });
}

/**
 * The TOGGLE-ONLY gate for the member give surface (`/o/<slug>/giving/give`):
 * applicability, then the org toggle, and NO giving key (the member self-view
 * and member give need none - Phase 3 "Member give"). Same reads as
 * `loadGivingContext`, minus the key lookup, so a plain member is never
 * `forbidden`. Throws like `loadGivingContext` (`OrgAccessError`, a database
 * failure); the caller maps those to its own error state, never to "off".
 */
export type GivingToggleState = "not_applicable" | "toggle_off" | "on";

export async function loadGivingToggle(viewer: GivingViewer): Promise<GivingToggleState> {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === GIVING_TOGGLE_KEY);
  if (!entry) throw new Error(`loadGivingToggle: ${GIVING_TOGGLE_KEY} is not in ORG_FEATURE_CATALOG`);
  if (!orgTypeAdmitted(entry.orgTypes, viewer.organizationType)) return "not_applicable";

  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const enabled = await orgFeatureEnabledInTx(tx, viewer.organizationId, GIVING_TOGGLE_KEY, categoryAxisOn);
    return enabled ? "on" : "toggle_off";
  });
}

// The data modules gate on this; it lives in ./keys so they need not import the
// toggle machinery above. Re-exported for the one-import-site convention.
export { givingKeysInTx } from "./keys";
