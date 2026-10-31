import { NextResponse } from "next/server";
import { COPY } from "@/lib/reimbursement/copy";
import { buildRequestsCsv } from "@/lib/reimbursement/csv-shape";
import { exportRequests } from "@/lib/reimbursement/csv-export";
import { gateReimbursementRoute } from "@/lib/reimbursement/gate";
import { parseExportFilters } from "@/lib/reimbursement/queue-query";

/**
 * `GET /o/<slug>/admin/reimbursements/export?from&to&status` - the requests CSV,
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 4,
 * P3-16, DECISION-271, EC37. A bulk tier-2 read, so it is gated like every
 * treasurer surface and AUDITED in the same transaction as the read
 * (`REIMBURSEMENT_EXPORTED`: row count and filters, never a name, amount or
 * purpose - see `csv-export.ts`). `check:audit` scans only `actions.ts` files, so
 * `route.test.ts` and `csv-export.test.ts` hold the hand-audited properties.
 *
 * Gate order (`gateReimbursementRoute`, stated once in `gate.ts`):
 *   1. signed in           -> 307 to /signin with this URL as the callback
 *   2. Node-side 2FA       -> 307 to /totp with this URL as the callback
 *   3. four-way org miss   -> 404 (no such organization) / 403 (no relationship or ended; one body)
 *   4. applicability and the org toggle -> 404 (a route has no "honest page")
 *   5. `reimbursement.view` -> 403
 *   6. query               -> 413 over 20,000 rows ("Narrow the date range"), never truncated
 *   7. audit (same transaction as the read), then respond
 *
 * The file: header and column set pinned by `csv-shape.ts` (the purpose is in;
 * the pre-approver, bank detail, email, phone and address are not); RFC 4180
 * quoting with the formula guard on every free-text cell; `text/csv; charset=
 * utf-8`, `attachment`, `Cache-Control: no-store`. The filters filter on the
 * organization-local date a request was last SUBMITTED.
 */

export const dynamic = "force-dynamic";

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const gate = await gateReimbursementRoute({ request, slug, anyOf: ["view"] });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseExportFilters(Object.fromEntries(url.searchParams.entries()));

  const result = await exportRequests(gate, filters);
  if (result.kind === "denied") return text(403, COPY.gate.notPermitted);
  if (result.kind === "too_many") return text(413, COPY.queue.exportTooLarge);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buildRequestsCsv(result.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reimbursements-${gate.slug}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
