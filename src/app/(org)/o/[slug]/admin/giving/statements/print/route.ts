import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { loadPrintRun } from "@/lib/giving/statements";
import { parseYearParam } from "@/lib/giving/statements/pure";
import { renderStatementPdf } from "@/lib/giving/statements/render-pdf";
import { gateStatementRoute, pdfHeaders, plain } from "../route-gate";

/**
 * `GET /o/<slug>/admin/giving/statements/print?year=YYYY` - the PRINT RUN: one
 * PDF, one statement per page run, for every LATEST statement of the year.
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Statements (Batch 5)".
 * `giving.view`.
 *
 * The run is generated ON DEMAND from the frozen snapshots by the SAME pure
 * renderer that rendered each statement at issue (never stored). A test renders
 * one snapshot alone and inside a batch and compares the extracted text, and a
 * database test re-renders an issued statement and gets the stored bytes back.
 *
 * A bulk read of every donor's name and address, so it is audited INSIDE this
 * handler (`GIVING_STATEMENTS_BULK_DOWNLOADED`, with the year and a count -
 * never a name) after the render succeeds and before the bytes are sent.
 * Gate order is `route-gate.ts`'s; then: a bad `year` is 400; a year with no
 * statements is 404; more than 1,000 statements is 413.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const gate = await gateStatementRoute(request, slug, ["view"]);
  if (!gate.ok) return gate.response;

  const year = parseYearParam(new URL(request.url).searchParams.get("year") ?? undefined);
  if (year === null) return plain(400, "Choose a year, like ?year=2027.");

  const run = await loadPrintRun(gate.org.personId, gate.org.organizationId, year);
  switch (run.kind) {
    case "forbidden":
      return plain(403, "You don't have permission to download statements.");
    case "invalid_year":
      return plain(400, "Choose a year that has ended or is under way.");
    case "empty":
      return plain(404, "No statements have been issued for that year.");
    case "too_many":
      return plain(413, "That is more than 1,000 statements. Print them in smaller groups from the list.");
    case "ok":
      break;
  }

  const bytes = await renderStatementPdf(run.statements.map((s) => s.snapshot));

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_STATEMENTS_BULK_DOWNLOADED,
    resourceType: "giving_statements",
    resourceId: gate.org.organizationId,
    metadata: { organizationId: gate.org.organizationId, taxYear: year, count: run.statements.length },
  });

  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: pdfHeaders(`statements-${year}-${gate.org.slug}.pdf`, body.byteLength),
  });
}
