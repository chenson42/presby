/**
 * statistics-fixture.ts — shared teardown for `congregation_statistics` rows an
 * e2e spec wrote (DECISION-157: mutation helpers in `e2e/support/` carry an
 * assert-and-throw guard, not a comment).
 *
 * `congregation_statistics` is append-only (`congregation_statistics_freeze`
 * trigger), so a spec can only remove its own rows by disabling that trigger
 * for the length of one DO block. The guard below refuses anything that is not
 * an e2e fixture organization in the reserved 2090-2099 year band, and the
 * function verifies the trigger is enabled again before it returns.
 *
 * Used by `presbytery-reports.spec.ts` (year 2095) and
 * `hydration/statistics-congregation.spec.ts` (year 2096).
 */

import type { Sql } from "./db";

const E2E_ORG_ID_PREFIX = "e2e00000-";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function removeCongregationStatistics(
  sql: Sql,
  organizationId: string,
  aboutOrgId: string,
  year: number,
): Promise<void> {
  for (const id of [organizationId, aboutOrgId]) {
    if (!UUID_RE.test(id) || !id.startsWith(E2E_ORG_ID_PREFIX)) {
      throw new Error(
        `[statistics-fixture] refusing to delete congregation_statistics for non-fixture organization "${id}" ` +
          `(fixture ids start with ${E2E_ORG_ID_PREFIX}).`,
      );
    }
  }
  if (!Number.isInteger(year) || year < 2090 || year > 2099) {
    throw new Error(
      `[statistics-fixture] refusing to delete congregation_statistics for year ${year}: ` +
        "e2e fixtures live in the reserved 2090-2099 band (DECISION-157).",
    );
  }
  await sql.query(`
    do $cleanup$
    begin
      alter table congregation_statistics disable trigger congregation_statistics_freeze;
      delete from congregation_statistics
       where organization_id = '${organizationId}'::uuid
         and about_org_id = '${aboutOrgId}'::uuid
         and year = ${year};
      alter table congregation_statistics enable trigger congregation_statistics_freeze;
    end
    $cleanup$;
  `);
  await sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`;
  const rows = (await sql`
    select tgenabled from pg_trigger where tgname = 'congregation_statistics_freeze'
  `) as { tgenabled: string }[];
  if (rows[0]?.tgenabled !== "O") {
    throw new Error(
      "[statistics-fixture] teardown left congregation_statistics_freeze " +
        "disabled -- append-only enforcement is OFF until this is fixed by hand.",
    );
  }
}
