import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { findStatementForDownload } from "@/lib/giving/statements";
import { getBlobStore } from "@/lib/storage/blob-store";
import { gateStatementRoute, notFound, pdfHeaders, plain } from "../../route-gate";

/**
 * `GET /o/<slug>/admin/giving/statements/<statementId>/download` - streams one
 * issued statement's stored PDF. docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Statements (Batch 5)". `giving.view` OR `giving.manage`.
 *
 * What it serves is the bytes `store()` kept at issue (DECISION-173): never a
 * re-render, so the file is exactly what was issued, whatever the code has
 * become since. The blob is read only through the storage adapter.
 *
 * Gate order is `route-gate.ts`'s. After it:
 *   - an absent id, a malformed id and ANOTHER organization's statement all
 *     answer the SAME 404 (one body, one set of headers) - the lookup runs under
 *     this organization's RLS context, so a foreign id is simply not there, and
 *     nothing about the response can tell the three apart;
 *   - the audit event is written INSIDE this handler (`check:audit` scans only
 *     `actions.ts`; QA reads this file), after the bytes are in hand and before
 *     they are sent, and carries ids and the year - never a name or an amount;
 *   - `Content-Type: application/pdf`, `attachment`, `Cache-Control: private,
 *     no-store`, `X-Content-Type-Options: nosniff`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; statementId: string }> },
): Promise<Response> {
  const { slug, statementId } = await params;
  const gate = await gateStatementRoute(request, slug, ["view", "manage"]);
  if (!gate.ok) return gate.response;

  const found = await findStatementForDownload(gate.org.personId, gate.org.organizationId, statementId);
  if (found.kind === "forbidden") return plain(403, "You don't have permission to download statements.");
  if (found.kind === "not_found") return notFound();

  const blob = await getBlobStore().resolve({
    organizationId: gate.org.organizationId,
    key: found.statement.blobAssetId,
    audience: "private",
  });
  if (!blob) return notFound();

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_STATEMENT_DOWNLOADED,
    resourceType: "giving_statement",
    resourceId: found.statement.id,
    metadata: {
      organizationId: gate.org.organizationId,
      statementId: found.statement.id,
      donorId: found.statement.donorId,
      taxYear: found.statement.taxYear,
      version: found.statement.version,
    },
  });

  const filename = `statement-${found.statement.taxYear}-v${found.statement.version}-${found.statement.id.slice(0, 8)}.pdf`;
  const body = new Uint8Array(blob.bytes);
  return new Response(body, { status: 200, headers: pdfHeaders(filename, body.byteLength) });
}
