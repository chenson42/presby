import "server-only";
import { withOrgContext, type OrganizationType } from "@/lib/authz";
import {
  ORG_FEATURE_CATALOG,
  isCategoryAxisOn,
  orgFeatureEnabledInTx,
  orgTypeAdmitted,
} from "@/lib/org-features";
import { holdsPermissions } from "@/lib/treasury/keys";
import { REIMBURSEMENT_KEYS, REIMBURSEMENT_TOGGLE_KEY, type ReimbursementHas } from "./keys";

/**
 * The reimbursement surfaces' shared gate, steps 4 and 5 - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 "Permissions & Flags -> Gate order (every surface)"
 * and P3-3, P3-15; the `giving/access.ts` shape.
 *
 *   signed in -> `assertTreasurySession` (Node-side 2FA) -> the four-way org miss
 *   -> org-type applicability -> the toggle -> the key or seat
 *
 * (The first three live in `gate.ts`, which owns the auth sequence.) This file
 * is applicability, then the org toggle, then - only when the toggle is on - the
 * viewer's four keys, all in ONE `withOrgContext` transaction. "Off" is an
 * honest state, never a 404, and it carries `canManageFeatures` so the page can
 * link to Features only for someone who can use it, without a second
 * page-level permission read (DECISION-162's rule).
 *
 * UNLIKE giving there is no `forbidden` kind here: the member surface is open
 * to every member (who may FILE is decided by the database,
 * `presby_reimbursement_may_file`, and approval is a seat, not a key), so the
 * caller applies the key it needs from `has`.
 *
 * NO PLATFORM FLAG anywhere in this file: the per-organization toggle is the
 * whole off switch (`flag: null`), and it is enforced HERE, in TypeScript,
 * only - the database does not read it (P3-15, accepted residual 9). A
 * missing toggle row is OFF.
 *
 * RLS enforces tenancy, not authorization: the `has.*` answers come from
 * `presby_has_permission()`, the resolver, never from a session claim and
 * never from `FEATURES.*`.
 */

const ORG_FEATURES_MANAGE = "org_features.manage";

/** What `resolveOrgContext()`'s `ok` branch already hands the page. */
export interface ReimbursementViewer {
  personId: string;
  organizationId: string;
  organizationType: OrganizationType;
}

export type ReimbursementContext =
  /** A presbytery, synod or GA: outside the toggle's allow-list. No database was touched. */
  | { kind: "not_applicable" }
  /** The org toggle is off (or the giving category is). */
  | { kind: "toggle_off"; canManageFeatures: boolean }
  | { kind: "ok"; has: ReimbursementHas };

/**
 * Loads the gate answers for one viewer at one organization. Throws
 * `OrgAccessError` (from `withOrgContext`) when the membership ended between
 * the resolve and the transaction - genuinely broken, not a "disabled" answer -
 * and lets a database failure throw; the caller turns that into its LoadError
 * state, never an empty or "off" answer (a blip must not read as revoked).
 */
export async function loadReimbursementContext(viewer: ReimbursementViewer): Promise<ReimbursementContext> {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === REIMBURSEMENT_TOGGLE_KEY);
  // Defensive: the catalog entry is the single source of the applicability
  // list; a missing entry is a programming error, not a runtime state.
  if (!entry) throw new Error(`loadReimbursementContext: ${REIMBURSEMENT_TOGGLE_KEY} is not in ORG_FEATURE_CATALOG`);

  if (!orgTypeAdmitted(entry.orgTypes, viewer.organizationType)) {
    return { kind: "not_applicable" };
  }

  // The category-axis kill switch is read OUTSIDE the transaction
  // (isFlagEnabled runs on its own connection); see org-features.ts.
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const enabled = await orgFeatureEnabledInTx(tx, viewer.organizationId, REIMBURSEMENT_TOGGLE_KEY, categoryAxisOn);
    if (!enabled) {
      const [canManageFeatures] = await holdsPermissions(tx, viewer, [ORG_FEATURES_MANAGE]);
      return { kind: "toggle_off", canManageFeatures: canManageFeatures === true };
    }

    const [requestForOthers, view, pay, manage] = await holdsPermissions(tx, viewer, [
      REIMBURSEMENT_KEYS.requestForOthers,
      REIMBURSEMENT_KEYS.view,
      REIMBURSEMENT_KEYS.pay,
      REIMBURSEMENT_KEYS.manage,
    ]);
    return {
      kind: "ok",
      has: {
        requestForOthers: requestForOthers === true,
        view: view === true,
        pay: pay === true,
        manage: manage === true,
      },
    };
  });
}
