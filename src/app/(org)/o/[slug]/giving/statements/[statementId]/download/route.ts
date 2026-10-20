import { auth } from "@/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { notFound, pdfHeaders, plain } from "@/lib/giving/pdf-response";
import { findMyStatementForDownload } from "@/lib/giving/self";
import { getBlobStore } from "@/lib/storage/blob-store";

/**
 * `GET /o/<slug>/giving/statements/<statementId>/download` - a MEMBER downloads
 * one of their OWN year-end statements. docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Member self-read" and Batch 6. No giving key is held or needed.
 *
 * What it serves is the bytes `store()` kept at issue (DECISION-173): never a
 * re-render, so this route imports neither the renderer nor `statements.ts`
 * (pdfkit, fonts, the mail queue) and needs no `outputFileTracingIncludes` key.
 * The blob is read only through the storage adapter.
 *
 * Gate, in order (not the admin `route-gate.ts`: that one forces 2FA and a giving
 * key, which a member needs neither of; the response shapes come from the shared
 * `@/lib/giving/pdf-response`, which the admin routes use too):
 *   1. signed in            -> 307 to /signin keeping this URL as the callback
 *   2. four-way org miss    -> 404 (no such organization) / 403 (no relationship
 *                              or an ended one, ONE body)
 *   3. ownership, inside `findMyStatementForDownload`: the viewer's own current
 *      membership resolved there, no target parameter
 *
 * THE PARITY RULE. A statement that is absent, malformed, someone else's,
 * another organization's, or whose organization has Giving turned off answers
 * the SAME 404 - one status, one body, one set of headers, the same as "no such
 * organization" - so nothing in a response says which. The lookup is the only
 * thing that varies, and it is one statement either way.
 *
 * AUDIT. Route handlers are outside `check:audit`'s scan, so the event is
 * written here, by hand (QA reads this file): `GIVING_STATEMENT_DOWNLOADED`,
 * after the bytes are in hand and before they are sent, ids and the year only,
 * marked `self: true` to tell it from a treasurer's download. Never a name, an
 * address or an amount. A refusal is not a download and writes nothing.
 *
 * Headers: `application/pdf`, `attachment`, `Cache-Control: private, no-store`,
 * `X-Content-Type-Options: nosniff` (the shared `pdfHeaders`).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; statementId: string }> },
): Promise<Response> {
  const { slug, statementId } = await params;
  const url = new URL(request.url);

  const session = await auth();
  if (!session?.user?.id) {
    const selfPath = `${url.pathname}${url.search}`;
    return Response.redirect(new URL(`/signin?callbackUrl=${encodeURIComponent(selfPath)}`, request.url), 307);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind === "not-found") return notFound();
  if (resolved.kind !== "ok") return plain(403, "You don't have access to that organization.");
  const { org } = resolved;

  let found: Awaited<ReturnType<typeof findMyStatementForDownload>>;
  try {
    found = await findMyStatementForDownload(org.personId, org.organizationId, statementId);
  } catch (err) {
    if (err instanceof OrgAccessError) return plain(403, "You don't have access to that organization.");
    return plain(503, "We can't check your statements right now. Try again in a moment.");
  }
  if (found.kind === "not_found") return notFound();

  const blob = await getBlobStore().resolve({ organizationId: org.organizationId, key: found.statement.blobAssetId });
  if (!blob) return notFound();

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_STATEMENT_DOWNLOADED,
    resourceType: "giving_statement",
    resourceId: found.statement.id,
    metadata: {
      organizationId: org.organizationId,
      statementId: found.statement.id,
      taxYear: found.statement.taxYear,
      version: found.statement.version,
      self: true,
    },
  });

  const filename = `statement-${found.statement.taxYear}-v${found.statement.version}-${found.statement.id.slice(0, 8)}.pdf`;
  const body = new Uint8Array(blob.bytes);
  return new Response(body, { status: 200, headers: pdfHeaders(filename, body.byteLength) });
}
