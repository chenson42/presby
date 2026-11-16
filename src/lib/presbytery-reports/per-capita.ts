import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { perCapitaRates } from "@/lib/db/domain/presbytery";
import { fetchStatisticsForYears } from "@/lib/presbytery";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildPerCapitaCsv } from "./csv";
import { derivePerCapita, type PerCapitaData, type PerCapitaRecordFact } from "./derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("per_capita");

/** One billing year, or every year (the long-form file). */
export type PerCapitaParams = { kind: "year"; billingYear: number } | { kind: "all" };

interface RecordRow {
  about_org_id: string;
  name: string;
  billing_year: number;
  basis_year: number;
  ending_active_basis: number | null;
  rate_applied: string;
  billed_cents: string;
  paid_cents: string;
  paid_status: string;
  paid_on: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

/**
 * The per-capita read. Money is converted to integer cents IN SQL
 * (`round(x * 100)`, half away from zero, read back as a string because the
 * driver returns bigint as one) and never touched as a float: the stored
 * columns are unconstrained `numeric`, so a sub-cent value can exist (F449);
 * the page and the file both show the rounded figure, and outstanding is
 * computed from the rounded cents. `paid_at` is stored as midnight UTC of the
 * paid date, so `paid_on` reads in UTC.
 */
export async function readPerCapita(
  tx: OrgTx,
  viewer: ReportViewer,
  params: PerCapitaParams,
): Promise<ReportRead<PerCapitaData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const org = viewer.organizationId;
  const roster = await readRoster(tx, org);
  const year = params.kind === "year" ? params.billingYear : null;

  const records = rowsOf<RecordRow>(
    await tx.execute(sql`
      select r.about_org_id, o.name, r.billing_year, r.basis_year, r.ending_active_basis,
             r.rate_applied::text as rate_applied,
             round(r.amount_owed * 100)::bigint::text as billed_cents,
             round(coalesce(r.paid_amount, 0) * 100)::bigint::text as paid_cents,
             r.paid_status,
             to_char(r.paid_at at time zone 'UTC', 'YYYY-MM-DD') as paid_on
        from per_capita_records r
        join organizations o on o.id = r.about_org_id
       where r.organization_id = ${org}::uuid
         ${year === null ? sql`` : sql`and r.billing_year = ${year}::integer`}
       order by r.billing_year, o.name, r.id
    `),
  );
  const facts: PerCapitaRecordFact[] = records.map((r) => ({
    organizationId: r.about_org_id,
    name: r.name,
    billingYear: Number(r.billing_year),
    basisYear: Number(r.basis_year),
    endingActiveBasis: r.ending_active_basis === null ? null : Number(r.ending_active_basis),
    rateApplied: r.rate_applied,
    billedCents: r.billed_cents,
    paidCents: r.paid_cents,
    paidStatus: r.paid_status,
    paidOn: r.paid_on,
  }));

  let anyBillsAnyYear = year === null ? facts.length > 0 : false;
  if (year !== null) {
    anyBillsAnyYear =
      facts.length > 0 ||
      rowsOf<{ found: boolean }>(
        await tx.execute(sql`
          select exists(select 1 from per_capita_records where organization_id = ${org}::uuid) as found
        `),
      )[0]?.found === true;
  }

  let rateBasisYear: number | null = null;
  const basisFigureOrgIds = new Set<string>();
  if (year !== null) {
    const [rate] = await tx
      .select({ basisYear: perCapitaRates.basisYear })
      .from(perCapitaRates)
      .where(and(eq(perCapitaRates.organizationId, org), eq(perCapitaRates.billingYear, year)))
      .limit(1);
    rateBasisYear = rate?.basisYear ?? null;
    if (rateBasisYear !== null && facts.length > 0) {
      // The rule generatePerCapitaRecords skips on: no coalesced row, or a null ending active.
      const stats = (await fetchStatisticsForYears(tx, org, rateBasisYear, rateBasisYear)).get(rateBasisYear);
      for (const [orgId, row] of stats ?? []) {
        if (row.endingActive !== null) basisFigureOrgIds.add(orgId);
      }
    }
  }

  return {
    kind: "ok",
    data: derivePerCapita({ roster, records: facts, billingYear: year, rateBasisYear, basisFigureOrgIds, anyBillsAnyYear }),
  };
}

export function getPerCapita(viewer: ReportViewer, params: PerCapitaParams): Promise<ReportRead<PerCapitaData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readPerCapita(tx, viewer, params));
}

/** One transaction: the page's read, the CSV from its data, then the audit row. */
export function exportPerCapita(viewer: ReportViewer, params: PerCapitaParams): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readPerCapita(tx, viewer, params);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    const csv = buildPerCapitaCsv(read.data);
    const rowCount = read.data.rows.length;
    await auditReportExport(tx, viewer, {
      report: "per_capita",
      rowCount,
      ...(params.kind === "year" ? { billingYear: params.billingYear } : { allYears: true as const }),
    });
    return {
      kind: "ok",
      csv,
      rowCount,
      filenameBase: params.kind === "all" ? `${REPORT.filenameBase}-all-years` : REPORT.filenameBase,
    };
  });
}
