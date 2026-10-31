import { NextResponse } from "next/server";
import { OrgAccessError } from "@/lib/authz";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementRoute } from "@/lib/reimbursement/gate";
import { renderRequestPdf } from "@/lib/reimbursement/print";
import { buildPrintModel } from "@/lib/reimbursement/print-model";
import { getRequestDetail } from "@/lib/reimbursement/reads";

/**
 * `GET /o/<slug>/reimbursements/<id>/print` - the request as a one-page form,
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 4,
 * Copy C11, EC24, EC44.
 *
 * WHO: any viewer of the request (the requester, the person being paid, an
 * approver of the group, the treasury team) - the same people who can open the
 * request page, decided by the same definer. No key is needed or implied, so the
 * gate takes none (the member surface). WHAT: the REQUESTER PROJECTION only. The
 * route asks the database for the `member` level even for a treasury-key holder
 * and `buildPrintModel` accepts nothing wider, so no payment, note, approver or
 * history name can reach the sheet.
 *
 * Gate order (`gateReimbursementRoute`, stated once in `gate.ts`): signed in
 * (307 to /signin with this URL as the callback), the Node-side 2FA check (307 to
 * /totp), the four-way org miss (404 / 403 with one body), applicability and the
 * toggle (404), then the request itself: a request that does not exist, one the
 * viewer may not see, a malformed id and a refused identity are ONE 404 with the
 * same body, so nothing in the response says which. A database failure is 503.
 *
 * A GET that writes nothing: no audit row (a print is a read of what the page
 * already shows), no state change. The bytes are a pure function of the model
 * (`print.ts`); nothing is stored. `Cache-Control: private, no-store`,
 * `attachment`, `nosniff`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  const { slug, id } = await params;
  const gate = await gateReimbursementRoute({ request, slug });
  if (!gate.ok) return gate.response;

  let found: Awaited<ReturnType<typeof getRequestDetail>>;
  try {
    found = await getRequestDetail(gate, id, "member");
  } catch (err) {
    if (err instanceof OrgAccessError) return text(403, COPY.gate.noOrgAccess);
    return text(503, COPY.gate.accessCheckFailed);
  }
  if (found.kind !== "ok" || found.detail.level !== "member") return text(404, COPY.receipts.notFoundBody);

  const { detail } = found;
  const bytes = await renderRequestPdf(buildPrintModel({ organizationName: gate.organizationName, detail }));
  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reimbursement-request-${detail.id.slice(0, 8)}.pdf"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
