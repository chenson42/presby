import { NextResponse } from "next/server";
import { OrgAccessError } from "@/lib/authz";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementRoute } from "@/lib/reimbursement/gate";
import { lookupReceipt, readReceiptBytes } from "@/lib/reimbursement/receipts";

/**
 * `GET /o/<slug>/reimbursements/<id>/receipts/<attachmentId>` - the bytes of one
 * receipt. docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 4,
 * Copy C4, EC24.
 *
 * WHO: any viewer of the REQUEST (the requester, the person being paid, an
 * eligible approver of its group, the treasury team), decided by the same
 * database rule that decides who may open the request page. No key is named, so
 * the gate takes none (the member surface).
 *
 * Gate order (`gateReimbursementRoute`): signed in (307 to /signin), the Node-side
 * 2FA check (307 to /totp), the four-way org miss, applicability and the toggle
 * (404). Then the receipt: a missing id, a malformed id, a detached receipt, one on
 * another organization's request and one the viewer may not see are ONE 404 with
 * one body and the same headers, so nothing says which. A failure to read is 503.
 *
 * WHAT IS SERVED. Only a `private` blob of THIS organization (`resolve({ audience:
 * "private" })`), so a receipt can never be read through the public asset door and
 * a public image can never answer here. A view by anyone but the uploader writes
 * `tenant.reimbursement.receipt_viewed` (ids only) before a byte is read.
 *
 * HEADERS. The stored type is a JPEG or a PDF, both written by us. `nosniff`;
 * `no-store`; a CSP that sandboxes the document and allows nothing to load, so
 * even a hostile PDF that a browser opened inline could run nothing and fetch
 * nothing. An image is shown `inline`, a PDF is always a download (`attachment`);
 * the filename is chosen here, never taken from the upload.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function miss(): NextResponse {
  return new NextResponse(COPY.receipts.notFoundBody, { status: 404, headers: NO_STORE });
}

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, { status, headers: NO_STORE });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string; attachmentId: string }> },
): Promise<Response> {
  const { slug, id, attachmentId } = await params;
  const gate = await gateReimbursementRoute({ request, slug });
  if (!gate.ok) return gate.response;
  if (!UUID.test(id) || !UUID.test(attachmentId)) return miss();

  let found: Awaited<ReturnType<typeof lookupReceipt>>;
  let blob: Awaited<ReturnType<typeof readReceiptBytes>>;
  try {
    found = await lookupReceipt(gate, { requestId: id, attachmentId });
    if (found.kind !== "ok") return miss();
    blob = await readReceiptBytes(gate.organizationId, found.blobKey);
  } catch (err) {
    if (err instanceof OrgAccessError) return text(403, COPY.gate.noOrgAccess);
    return text(503, COPY.gate.accessCheckFailed);
  }
  if (blob === null) return miss();

  const isPdf = found.contentType === "application/pdf";
  const body = new Uint8Array(blob.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": found.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${isPdf ? "attachment" : "inline"}; filename="receipt-${attachmentId.slice(0, 8)}.${isPdf ? "pdf" : "jpg"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
