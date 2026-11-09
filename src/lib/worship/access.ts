import "server-only";
import { withOrgContext, type OrgTx, type OrganizationType } from "@/lib/authz";
import {
  ORG_FEATURE_CATALOG,
  isCategoryAxisOn,
  orgFeatureEnabledInTx,
  orgTypeAdmitted,
} from "@/lib/org-features";
import { holdsAllKeys, holdsKeys, holdsPermission } from "./authority";
import { WORSHIP_TOGGLE_KEY, type WorshipHas, type WorshipKeyName } from "./vocab";

/**
 * The worship surfaces' shared gate, steps 4 and 5 - docs/work-log/2026-11-04-
 * worship-inc1.md, Phase 3 "Permissions & Flags -> Gate order" (the
 * `reimbursement/access.ts` shape; it does not import it).
 *
 *   signed in -> the four-way org miss -> `assertOrgAccess` (the page's work)
 *     -> org-type applicability -> the toggle (with the category axis)
 *     -> the viewer's keys
 *
 * Applicability, then the toggle, then - only when the toggle is on - the keys,
 * all in ONE `withOrgContext` transaction. "Off" is an honest state, never a
 * 404, and it carries `canManageFeatures` so a page links to Features only for
 * someone who can use it, without a second page-level read.
 *
 * There is NO `forbidden` kind in `loadWorshipContext`: the member surface is
 * open to every member (what a person may DO is decided per page and per store
 * export from `has` and the seat), so the caller applies the key it needs.
 *
 * NO PLATFORM FLAG anywhere in this file. The per-organization toggle is the
 * whole off switch (`flag: null`); a missing toggle row is OFF.
 *
 * A database failure while reading the gate is NEVER an empty or "off" answer:
 * this module lets it throw and the caller renders its load-error state. An
 * `OrgAccessError` (the membership ended between the resolve and the
 * transaction) also propagates.
 *
 * The category-axis kill switch is read OUTSIDE the transaction
 * (`isFlagEnabled` runs on its own connection; see org-features.ts), so a
 * gated transaction never holds a connection while it waits for another.
 */

/** What `resolveOrgContext()`'s `ok` branch hands the page, plus the signed-in user for the audit actor. */
export interface WorshipViewer {
  personId: string;
  organizationId: string;
  organizationType: OrganizationType;
  /** The signed-in user. The audit actor; never a request value. */
  userId: string;
  email: string | null;
}

export type WorshipContext =
  /** A presbytery, synod or GA: outside the toggle's allow-list. No database was touched. */
  | { kind: "not_applicable" }
  /** The toggle is off (or the worship category is). */
  | { kind: "toggle_off"; canManageFeatures: boolean }
  | { kind: "ok"; has: WorshipHas };

function catalogEntry() {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === WORSHIP_TOGGLE_KEY);
  // The catalog entry is the single source of the applicability list; a
  // missing entry is a programming error, not a runtime state.
  if (!entry) throw new Error(`worship: ${WORSHIP_TOGGLE_KEY} is not in ORG_FEATURE_CATALOG`);
  return entry;
}

export async function loadWorshipContext(viewer: WorshipViewer): Promise<WorshipContext> {
  if (!orgTypeAdmitted(catalogEntry().orgTypes, viewer.organizationType)) {
    return { kind: "not_applicable" };
  }
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<WorshipContext> => {
    const enabled = await orgFeatureEnabledInTx(tx, viewer.organizationId, WORSHIP_TOGGLE_KEY, categoryAxisOn);
    if (!enabled) return { kind: "toggle_off", canManageFeatures: await holdsPermission(tx, viewer, "org_features.manage") };
    return { kind: "ok", has: await holdsAllKeys(tx, viewer) };
  });
}

/** The two refusals every store export shares before it looks at a key. */
export type GateRefusal = { kind: "not_applicable" } | { kind: "toggle_off" };

/**
 * The gate every store export repeats inside its OWN `withOrgContext`
 * transaction (a server action is a public entry point and the page's gate is
 * not trusted): applicability, then the toggle, then the named keys. Runs `fn`
 * with the held keys only when the toggle is on; otherwise returns the refusal
 * and `fn` never runs. A `fn` that throws rolls its transaction back.
 */
export async function runGated<T>(
  viewer: WorshipViewer,
  names: readonly WorshipKeyName[],
  fn: (tx: OrgTx, has: Partial<WorshipHas>) => Promise<T>,
): Promise<T | GateRefusal> {
  if (!orgTypeAdmitted(catalogEntry().orgTypes, viewer.organizationType)) {
    return { kind: "not_applicable" };
  }
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const enabled = await orgFeatureEnabledInTx(tx, viewer.organizationId, WORSHIP_TOGGLE_KEY, categoryAxisOn);
    if (!enabled) return { kind: "toggle_off" } as const;
    return fn(tx, await holdsKeys(tx, viewer, names));
  });
}
