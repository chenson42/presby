import "server-only";
import { sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { OFF_WARNING_FALLBACK, offWarningCopy } from "@/lib/person-photos/copy";
import { countChosenPhotos } from "@/lib/person-photos/reader";
import { openRequestCount } from "@/lib/reimbursement/counts";
import { REIMBURSEMENT_TOGGLE_KEY } from "@/lib/reimbursement/keys";

/**
 * Page-side "turning this OFF has a consequence" warnings for the Features
 * page - docs/work-log/2026-10-15-online-giving.md, Phase 3 "Files to modify".
 *
 * A REGISTRY the Features PAGE reads and `src/lib/org-features.ts` never
 * imports: DECISION-130's one-way rule keeps the catalog (a pure list of
 * toggles) free of feature-specific queries, so a warning is data the page asks
 * for, not logic the catalog carries. A key without an entry has no warning.
 *
 * Three entries: `org_portal.giving`, `org_portal.person_photos` and
 * `org_portal.reimbursement` (treasury
 * Increment 1, Copy C1). Turning Reimbursements OFF hides the pages and deletes
 * nothing, so an administrator who turns it off with requests still in flight
 * is told how many ("open" = submitted, returned or approved; drafts are not
 * counted), by `openRequestCount()` - the same kind of SECURITY DEFINER BARE
 * COUNT, readable by an `org_features.manage` holder with no money key. A count
 * of zero is no warning at all.
 *
 * Giving: turning Giving OFF hides every giving page and tile; it does NOT stop Stripe events being recorded, and it
 * does not cancel a donor's monthly gift - that keeps charging in Stripe until
 * it is cancelled there. So when monthly gifts are active the church is told,
 * in a dialog, before the switch flips. The count is
 * `presby_giving_active_schedule_count()`, a SECURITY DEFINER BARE COUNT that
 * reads only `presby_current_org()`, which is why an `org_features.manage`
 * holder (who holds no giving key) may see it.
 *
 * If the count cannot be read, the warning is still shown, generically: a
 * database blip must not silently remove the one thing that tells a treasurer
 * their donors are still being charged.
 *
 * `org_portal.person_photos` (docs/work-log/2026-10-26-person-photos-inc1.md,
 * Copy C1): turning it OFF hides every photo of a person, including on the
 * public website, so when photos are chosen the church is told how many before
 * the switch flips. The count comes from `reader.ts` (`countChosenPhotos`,
 * distinct photos with an active designation, worded "chosen for", never "shown"), so
 * this module never imports the photo tables. Zero chosen photos: no warning.
 * The copy lives in `person-photos/copy.ts`; the warning names the cached-copy
 * residual ("up to a day") and says nothing is deleted.
 */

export interface OffWarning {
  title: string;
  description: string;
}

type OffWarningLoader = (tx: OrgTx) => Promise<OffWarning | null>;

export const GIVING_FEATURE_KEY = "org_portal.giving";
export const PERSON_PHOTOS_FEATURE_KEY = "org_portal.person_photos";

const REGISTRY: Record<string, OffWarningLoader> = {
  [GIVING_FEATURE_KEY]: async (tx) => {
    const result = await tx.execute(sql`select presby_giving_active_schedule_count() as n`);
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
      n?: number;
    }>;
    const count = Number(rows[0]?.n ?? 0);
    if (count <= 0) return null;
    return {
      title: "Monthly gifts are still active",
      description:
        `${count} monthly ${count === 1 ? "gift is" : "gifts are"} still active in Stripe and keep${count === 1 ? "s" : ""} ` +
        "charging until cancelled there. Turning this off hides Giving; it does not stop recording.",
    };
  },
  [PERSON_PHOTOS_FEATURE_KEY]: async (tx) => {
    const count = await countChosenPhotos(tx);
    return count > 0 ? offWarningCopy(count) : null;
  },
  [REIMBURSEMENT_TOGGLE_KEY]: async (tx) => {
    const count = await openRequestCount(tx);
    return count > 0 ? reimbursementWarning(count) : null;
  },
};

/** Copy C1, verbatim. `n` is `presby_reimbursement_open_count()`. */
function reimbursementWarning(n: number): OffWarning {
  const noun = n === 1 ? `${n} request is open` : `${n} requests are open`;
  return {
    title: "Reimbursement requests are still open",
    description:
      `${noun} (waiting for approval, for the requester, or for payment). ` +
      "Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.",
  };
}

const GENERIC_WARNING: OffWarning = {
  title: "Check before turning this off",
  description: "We couldn't check what this affects just now.",
};

const FALLBACK: Record<string, OffWarning> = {
  [PERSON_PHOTOS_FEATURE_KEY]: { ...OFF_WARNING_FALLBACK },
  [GIVING_FEATURE_KEY]: {
    title: "Monthly gifts may still be active",
    description:
      "We couldn't check for active monthly gifts just now. Any that exist keep charging in Stripe until cancelled there. Turning this off hides Giving; it does not stop recording.",
  },
  [REIMBURSEMENT_TOGGLE_KEY]: {
    title: "Reimbursement requests may still be open",
    description:
      "We couldn't check how many requests are open just now. Turning this off hides the pages and nothing is deleted.",
  },
};

/**
 * The warnings for the toggles that are currently ON and have a registry entry.
 * Each loader runs in its OWN transaction (a failed statement aborts the
 * transaction it ran in, so one feature's failure cannot poison another's). A
 * loader that throws becomes that feature's generic warning (never silence); an
 * `OrgAccessError` from `withOrgContext` is NOT swallowed - it propagates to the
 * page, which already rethrows it.
 */
export async function loadOffWarnings(
  personId: string,
  organizationId: string,
  enabledKeys: readonly string[],
): Promise<Record<string, OffWarning>> {
  const out: Record<string, OffWarning> = {};
  for (const key of enabledKeys.filter((k) => k in REGISTRY)) {
    let failed = false;
    let warning: OffWarning | null = null;
    try {
      warning = await withOrgContext(personId, organizationId, (tx) => REGISTRY[key]!(tx));
    } catch (err) {
      if (err instanceof OrgAccessError) throw err;
      failed = true;
    }
    if (warning) out[key] = warning;
    else if (failed) out[key] = FALLBACK[key] ?? GENERIC_WARNING;
  }
  return out;
}
