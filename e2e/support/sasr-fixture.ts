/**
 * sasr-fixture.ts — stages and removes a published-return chain for a
 * Playwright-owned (`e2e-*`) congregation, through the product's own
 * `presby_publish_sasr_snapshot()` — never a hand-rolled imitation of it
 * (2026-09-28-presbytery-e2e, architect Phase 2 Notes §1a).
 *
 * WHY THIS EXISTS, AND WHY IT IS SHARED RATHER THAN SPEC-LOCAL: the
 * publish -> withdraw round trip (filings-round-trip.spec.ts) and the
 * presbytery's own filing-history read
 * (admin/reports/[aboutOrgId]/page.tsx) both need a real, live publication
 * chain to exist before they can be exercised, and the teardown here is the
 * most dangerous code in the suite — it disables three append-only freeze
 * triggers on tables SHARED with `scripts/seed-dev.sql`'s own fixtures
 * (Alder Creek's single, un-withdrawn 2025 publication, which
 * `scripts/test-rls.sql` asserts against by id). DECISION-157 governs this
 * file: it may only publish or withdraw for organizations whose slug starts
 * with `e2e-`, and only for report years in the reserved 2090-2099 band —
 * both guards are assert-and-throw, not comments, because the failure they
 * prevent (docs/work-log/2026-09-26-withdraw-publication.md, Phase 5) has
 * already happened once.
 */

import type { Sql } from "./db";

export const RESERVED_YEAR_MIN = 2090;
export const RESERVED_YEAR_MAX = 2099;

/**
 * Report years already claimed by other e2e specs, so the next pipeline
 * doesn't have to grep for them (architect Phase 2 ruling 2c). NOT an
 * enforced cross-file registry — enforcement is `assertReservedYear()`'s band
 * check below; this is a comment made a data structure so it stays current
 * instead of drifting across two file headers.
 */
export const CLAIMED_REPORT_YEARS: Record<string, number[]> = {
  "statistics-submit.spec.ts": [2091, 2092, 2093],
  "presbytery-reports.spec.ts": [2095],
  "filings-round-trip.spec.ts": [2094, 2096],
};

function assertReservedYear(reportYear: number): void {
  if (
    !Number.isInteger(reportYear) ||
    reportYear < RESERVED_YEAR_MIN ||
    reportYear > RESERVED_YEAR_MAX
  ) {
    throw new Error(
      `[sasr-fixture] refusing report year ${reportYear}: e2e fixtures must ` +
        `use the reserved ${RESERVED_YEAR_MIN}-${RESERVED_YEAR_MAX} band ` +
        `(DECISION-157) — see CLAIMED_REPORT_YEARS for years already in use.`,
    );
  }
}

/**
 * DECISION-157's mechanical guard: refuse any organization whose slug does
 * not start with "e2e-". A guard is what would have prevented the Alder
 * Creek incident; a comment would not have.
 */
async function assertE2EOrg(sql: Sql, organizationId: string): Promise<void> {
  const rows = (await sql`
    select slug from organizations where id = ${organizationId}::uuid
  `) as { slug: string }[];
  const slug = rows[0]?.slug;
  if (!slug || !slug.startsWith("e2e-")) {
    throw new Error(
      `[sasr-fixture] refusing to touch organization ${organizationId} ` +
        `(slug "${slug ?? "<none>"}") — sasr-fixture.ts only publishes or ` +
        `withdraws for e2e-* organizations (DECISION-157).`,
    );
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Stages a real, live publication chain for `congregationOrgId` at
 * `reportYear` — through the product's own `presby_publish_sasr_snapshot()`.
 * Every SASR field beyond the two required parameters defaults to null; this
 * fixture stages the PRESENCE of a filing, not its statistical content.
 *
 * ONE STATEMENT: `set_config('app.current_org_id', ...)` and the function
 * call live in the SAME `do $$ ... $$` block, because the neon() HTTP driver
 * gives every separate tagged-template call its own implicit transaction and
 * the GUC is transaction-local (seed-orgs.ts mechanic 2). The DO body is a
 * dollar-quoted string, so the ids/values below are inlined text, not bind
 * parameters — `congregationOrgId` is vetted by `assertE2EOrg()` first, and
 * `minuteReference` is escaped for embedded single quotes.
 *
 * The publication id is NOT returned by the DO block (PL/pgSQL DO blocks
 * cannot return a value) — it is read back in a SEPARATE, immediately
 * following SELECT, safe because the publish already committed (each
 * neon() call is its own transaction) and the read is scoped to exactly the
 * row this call just created (newest by published_at for this org+year).
 */
export async function stagePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number; minuteReference: string },
): Promise<{ publicationId: string }> {
  assertReservedYear(opts.reportYear);
  await assertE2EOrg(sql, opts.congregationOrgId);

  const safeMinute = escapeSqlLiteral(opts.minuteReference);
  await sql.query(`
    do $stage$
    begin
      perform set_config('app.current_org_id', '${opts.congregationOrgId}', true);
      perform presby_publish_sasr_snapshot(${opts.reportYear}, '${safeMinute}');
    end
    $stage$;
  `);

  const rows = (await sql`
    select p.id
      from publications p
      join statistical_returns sr
        on sr.id = p.artifact_id and sr.organization_id = p.organization_id
     where p.organization_id = ${opts.congregationOrgId}::uuid
       and p.record_class = 'statistical_return'
       and sr.report_year = ${opts.reportYear}
     order by p.published_at desc
     limit 1
  `) as { id: string }[];
  const publicationId = rows[0]?.id;
  if (!publicationId) {
    throw new Error(
      `[sasr-fixture] presby_publish_sasr_snapshot() reported success but no ` +
        `publications row was found for ${opts.congregationOrgId} / ${opts.reportYear}.`,
    );
  }
  return { publicationId };
}

/**
 * Removes a staged publication chain — the disable/delete/re-enable
 * discipline statistics-submit.spec.ts:223-260 already established, copied
 * in shape and improved per F115 (verified re-enable, not merely attempted).
 * ONE `do $$ ... $$` block so a failing delete rolls the disables back too.
 * The `congregation_statistics` delete resolves its own recipient (the
 * presbytery) from the still-present `publications` row rather than
 * requiring a third parameter — the delete order (congregation_statistics,
 * then publications, then statistical_returns) keeps that row available
 * until it's no longer needed. See this file's Edge Cases note in the
 * work-log: reordering the deletes would silently orphan the
 * congregation_statistics row.
 */
export async function removePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number },
): Promise<void> {
  assertReservedYear(opts.reportYear);
  await assertE2EOrg(sql, opts.congregationOrgId);

  await sql.query(`
    do $cleanup$
    begin
      alter table congregation_statistics disable trigger congregation_statistics_freeze;
      alter table publications disable trigger publications_freeze;
      alter table statistical_returns disable trigger statistical_returns_freeze;

      delete from congregation_statistics
       where about_org_id = '${opts.congregationOrgId}'::uuid
         and year = ${opts.reportYear}
         and organization_id = (
           select recipient_org_id from publications
            where organization_id = '${opts.congregationOrgId}'::uuid
              and record_class = 'statistical_return'
              and artifact_id in (
                select id from statistical_returns
                 where organization_id = '${opts.congregationOrgId}'::uuid
                   and report_year = ${opts.reportYear}
              )
            limit 1
         );

      delete from publications
       where organization_id = '${opts.congregationOrgId}'::uuid
         and record_class = 'statistical_return'
         and artifact_id in (
           select id from statistical_returns
            where organization_id = '${opts.congregationOrgId}'::uuid
              and report_year = ${opts.reportYear}
         );

      delete from statistical_returns
       where organization_id = '${opts.congregationOrgId}'::uuid
         and report_year = ${opts.reportYear};

      alter table statistical_returns enable trigger statistical_returns_freeze;
      alter table publications enable trigger publications_freeze;
      alter table congregation_statistics enable trigger congregation_statistics_freeze;
    end
    $cleanup$;
  `);
  // Defensive belt, not the primary mechanism — idempotent regardless of
  // whether the DO block's own re-enables above already ran.
  await sql`alter table statistical_returns enable trigger statistical_returns_freeze`;
  await sql`alter table publications enable trigger publications_freeze`;
  await sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`;

  // F115: VERIFY the final state rather than trust the enables above ran.
  // Constrained by `tgrelid` (via `c.relname`) as well as `tgname` (QA Phase 5
  // observation, sasr-fixture.ts:208): `tgname` alone is not unique across the
  // catalog, so the WHERE clause below pins each trigger name to the specific
  // table it must live on rather than matching a same-named trigger anywhere.
  const rows = (await sql`
    select c.relname as table_name, t.tgenabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where (t.tgname, c.relname) in (
       ('congregation_statistics_freeze', 'congregation_statistics'),
       ('publications_freeze', 'publications'),
       ('statistical_returns_freeze', 'statistical_returns')
     )
  `) as { table_name: string; tgenabled: string }[];
  const notEnabled = rows.filter((r) => r.tgenabled !== "O");
  if (notEnabled.length > 0) {
    throw new Error(
      `[sasr-fixture] teardown left ${notEnabled.length} freeze trigger(s) ` +
        `disabled: ${notEnabled.map((r) => r.table_name).join(", ")}. ` +
        `Append-only enforcement is OFF on shared tables until this is fixed by hand.`,
    );
  }
}
