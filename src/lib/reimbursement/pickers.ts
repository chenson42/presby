import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { checkDirectoryView, findDirectoryPersonIds } from "@/lib/directory";
import { holdsPermissions } from "@/lib/treasury/keys";
import { rowsOf } from "./db-util";
import { REIMBURSEMENT_KEYS } from "./keys";
import { BENEFICIARY_QUERY_MAX, BENEFICIARY_QUERY_MIN, BENEFICIARY_RESULTS_MAX } from "./limits";
import { cleanText, textLength } from "./text";
import type { RequestActor } from "./requests";

/**
 * The beneficiary picker - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * file plan (`pickers.ts`), accepted residual 6, EC17.
 *
 * "Pay someone else back" is for a holder of `reimbursement.request_for_others`.
 * The search runs in this order, each step a closed door:
 *   1. the caller holds `request_for_others` (else nothing, and nothing is
 *      learned: the answer is an empty list, exactly as for a query that
 *      matches no one);
 *   2. the caller may see the directory at all (`checkDirectoryView`, the same
 *      call `getDirectory()` makes);
 *   3. `findDirectoryPersonIds`, which applies the directory's own eligibility
 *      predicate - so a `directory_hidden` member is never offered, and
 *      neither is someone who has left or is merged (residual 6: an on-behalf
 *      holder cannot name a member who is hidden from the directory).
 * Names only come back (a display name and the id the form will post): no
 * email, phone or address, at most eight, and a query under two characters is
 * not searched. The id the form posts is NEVER trusted: `saveRequest`
 * re-checks it with `isDirectoryListedPerson` before the definer.
 */

export interface BeneficiaryCandidate {
  personId: string;
  displayName: string;
}

export async function searchBeneficiaries(
  actor: Pick<RequestActor, "personId" | "organizationId">,
  query: string,
): Promise<BeneficiaryCandidate[]> {
  const cleaned = cleanText(query) ?? "";
  if (textLength(cleaned) < BENEFICIARY_QUERY_MIN || textLength(cleaned) > BENEFICIARY_QUERY_MAX) return [];

  return withOrgContext(actor.personId, actor.organizationId, async (tx) => {
    const [holds] = await holdsPermissions(tx, actor, [REIMBURSEMENT_KEYS.requestForOthers]);
    if (!holds) return [];
    if (!(await checkDirectoryView(tx, actor.personId, actor.organizationId))) return [];

    const ids = await findDirectoryPersonIds(tx, actor.organizationId, cleaned, BENEFICIARY_RESULTS_MAX);
    if (ids.length === 0) return [];

    const rows = rowsOf(
      await tx.execute(sql`
        select p.id, btrim(concat_ws(' ', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name), p.last_name)) as display_name
          from people p
         where p.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
         order by lower(p.last_name), lower(p.first_name), p.id
         limit ${BENEFICIARY_RESULTS_MAX}`),
    );
    return rows.map((r) => ({ personId: String(r.id), displayName: String(r.display_name) }));
  });
}
