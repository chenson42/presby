import { NextResponse } from "next/server";
import { OrgAccessError } from "@/lib/authz";
import { platformOrigin } from "@/lib/domains/host";
import { checkRateLimit } from "@/lib/rate-limit";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementRoute } from "@/lib/reimbursement/gate";
import { MAX_RECEIPT_BYTES, MAX_RECEIPT_UPLOADS_PER_HOUR } from "@/lib/reimbursement/limits";
import {
  preflightReceipt,
  storeAndAttachReceipt,
  type AttachRefusal,
  type PreflightRefusal,
  type ReceiptContentType,
} from "@/lib/reimbursement/receipts";
import {
  declaredTooLarge,
  originRefused,
  parseSingleFile,
  readBoundedBody,
  receiptDisplayName,
  sha256Hex,
  sniffReceipt,
} from "@/lib/reimbursement/upload-request";
import { sanitizeImage } from "@/lib/storage/image-sanitize";
import { treasuryTotpRedirectUrl } from "@/lib/treasury/session";

/**
 * `POST /o/<slug>/reimbursements/<id>/receipts` - attach ONE receipt to the
 * caller's own draft or sent-back request. docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 API Contract Layer 4 and "Receipts and the F289 audience API",
 * Copy C4, EC41, EC42.
 *
 * WHY A ROUTE AND NOT A SERVER ACTION: a server action's body is bounded at 1 MB
 * by the framework and cannot be bounded tighter by the route; here the body is
 * read as a stream, counted as it arrives, and cancelled at the cap.
 *
 * ORDER (each step refuses before the next one costs anything):
 *   1. `gateReimbursementRoute` (signed in, Node-side 2FA, the four-way org miss,
 *      applicability, the toggle). The upload is a `fetch`, so its refusals are
 *      JSON the form can read instead of a redirect it cannot follow.
 *   2. `Origin` must equal the platform origin (a missing or foreign Origin is a 403).
 *   3. The per-user hourly rate limit.
 *   4. A declared `Content-Length` over the cap is refused unread.
 *   5. `receipt_preflight`: may this creator add a receipt NOW? Before the file is
 *      read, so a refused upload never writes a blob.
 *   6. The bounded body read, then EXACTLY ONE file part named `file`.
 *   7. The magic-byte sniff (png, jpeg, webp, pdf): content, never the extension or
 *      the declared type.
 *   8. An image is re-encoded by `sanitizeImage` (EXIF and every other metadata
 *      segment dropped, oriented, bounded); a PDF passes through (an accepted
 *      residual, DECISION-270: it is served as a download under a sandbox CSP).
 *   9. `store({ audience: "private" })`, then `attach_receipt`; the response
 *      carries the request's NEW `revision` so the form's next save is not stale.
 *
 * The success body is `{ attachmentId, displayName, byteSize, contentType,
 * revision }`. A failure is `{ kind }` with a status, where `kind` is one of
 * `too_large`, `not_allowed`, `unreadable`, `too_many`, `duplicate`,
 * `not_editable`, `rate_limited`, `two_factor_required` (with `redirectTo`),
 * `not_found`, `refused` (with the gate's own `error` sentence) and `failed`. The
 * route words nothing for the member: the form turns a `kind` into a Copy C4
 * sentence naming the file it knows. An `invalid_shape` from attach, or any
 * unexpected error, is `failed` (a bug, never worded as the member's fault).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FailKind =
  | "too_large"
  | "not_allowed"
  | "unreadable"
  | "too_many"
  | "duplicate"
  | "not_editable"
  | "rate_limited"
  | "two_factor_required"
  | "not_found"
  | "refused"
  | "failed";

function fail(status: number, kind: FailKind, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json({ kind, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** The gate answers a `Response` built for a page-style caller; the form needs JSON. */
async function gateFailure(response: Response, slug: string, id: string): Promise<NextResponse> {
  if (response.status === 307) {
    const location = new URL(response.headers.get("location") ?? "/signin", "http://localhost");
    if (location.pathname === "/totp") {
      // Back to the form after the challenge: this route has no page to return to.
      return fail(403, "two_factor_required", { redirectTo: treasuryTotpRedirectUrl(`/o/${slug}/reimbursements/${id}/edit`) });
    }
    return fail(401, "refused", { error: COPY.gate.signedOut });
  }
  if (response.status === 404) return fail(404, "not_found");
  // Could not read the gate (a database failure): its own answer, never "not allowed".
  if (response.status >= 500) return fail(503, "failed");
  return fail(response.status, "refused", { error: await response.text() });
}

const PREFLIGHT_KIND: Record<PreflightRefusal, [number, FailKind]> = {
  not_found: [404, "not_found"],
  not_editable: [409, "not_editable"],
  too_many_receipts: [409, "too_many"],
};

const ATTACH_KIND: Record<AttachRefusal, [number, FailKind]> = {
  not_found: [404, "not_found"],
  not_editable: [409, "not_editable"],
  too_many_receipts: [409, "too_many"],
  duplicate_in_request: [409, "duplicate"],
  // The type and size came from the store's own return and the key is the one just stored: a
  // refusal here is a defect, not something the member did.
  invalid_shape: [500, "failed"],
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  const { slug, id } = await params;

  const gate = await gateReimbursementRoute({ request, slug });
  if (!gate.ok) return gateFailure(gate.response, slug, id);

  if (originRefused(request.headers, platformOrigin())) return fail(403, "refused", { error: COPY.gate.notPermitted });
  if (!UUID.test(id)) return fail(404, "not_found");

  const verdict = await checkRateLimit(
    `reimbursement-receipt:${gate.userId}`,
    { max: MAX_RECEIPT_UPLOADS_PER_HOUR, windowSeconds: 3600 },
    { userId: gate.userId, actor: gate.email ?? gate.userId, reason: "reimbursement receipt upload" },
  );
  if (!verdict.allowed) {
    return fail(429, "rate_limited", {}, { "Retry-After": String(verdict.retryAfterSeconds) });
  }

  if (declaredTooLarge(request.headers)) return fail(413, "too_large");

  try {
    const preflight = await preflightReceipt(gate, id);
    if (preflight.kind === "denied") return fail(403, "refused", { error: COPY.gate.notPermitted });
    if (preflight.kind === "refused") {
      const [status, kind] = PREFLIGHT_KIND[preflight.outcome];
      return fail(status, kind);
    }

    const body = await readBoundedBody(request);
    if (!body.ok) return body.reason === "too_large" ? fail(413, "too_large") : fail(400, "not_allowed");
    const part = await parseSingleFile(body.bytes, request.headers.get("content-type"));
    if (!part.ok) return fail(400, "not_allowed");

    const sniffed = sniffReceipt(part.bytes);
    if (sniffed === null) return fail(415, "not_allowed");

    let stored: { bytes: Buffer; contentType: ReceiptContentType };
    if (sniffed === "application/pdf") {
      if (part.bytes.byteLength > MAX_RECEIPT_BYTES) return fail(413, "too_large");
      stored = { bytes: part.bytes, contentType: "application/pdf" };
    } else {
      const clean = await sanitizeImage(part.bytes, { maxBytes: MAX_RECEIPT_BYTES });
      if (!clean.ok) return clean.reason === "too_large" ? fail(413, "too_large") : fail(422, "unreadable");
      stored = { bytes: clean.bytes, contentType: clean.contentType };
    }

    const attached = await storeAndAttachReceipt(gate, {
      requestId: id,
      bytes: stored.bytes,
      contentType: stored.contentType,
      receivedSha256: sha256Hex(part.bytes),
      displayName: receiptDisplayName(part.name, stored.contentType),
    });
    if (attached.kind === "denied") return fail(403, "refused", { error: COPY.gate.notPermitted });
    if (attached.kind === "refused") {
      const [status, kind] = ATTACH_KIND[attached.outcome];
      return fail(status, kind);
    }
    return NextResponse.json(attached.receipt, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof OrgAccessError) return fail(403, "refused", { error: COPY.gate.noOrgAccess });
    // A database or storage failure: its own answer, never "not allowed". No detail leaves the
    // server, and the log line names only the error's class (no file name, no bytes, no ids).
    console.error("[reimbursement/receipts] upload failed", { error: err instanceof Error ? err.name : "unknown" });
    return fail(503, "failed");
  }
}
