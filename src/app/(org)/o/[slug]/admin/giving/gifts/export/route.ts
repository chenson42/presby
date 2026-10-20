import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  assertGivingSession,
  givingTotpRedirectUrl,
  loadGivingContext,
} from "@/lib/giving/access";
import { buildGiftsCsv } from "@/lib/giving/csv";
import { parseGiftFilters } from "@/lib/giving/gift-input";
import { exportGifts } from "@/lib/giving/gifts";

/**
 * `GET /o/<slug>/admin/giving/gifts/export?from&to&fund&status&source[&donor]`
 * - the gifts CSV (G25), docs/work-log/2026-10-15-online-giving.md, Phase 3 API
 * contract. A bulk tier-2 read, so it is gated like every giving surface AND
 * audited INSIDE this handler: `check:audit` scans only `actions.ts` files, so
 * the `GIVING_GIFTS_EXPORTED` write below is hand-audited (QA reads it).
 *
 * Gate order (stated once in `src/lib/giving/access.ts`):
 *   1. signed in           -> 307 to /signin with this URL as the callback
 *   2. Node-side 2FA (R4)  -> 307 to /totp with this URL as the callback
 *   3. four-way org miss   -> 404 (no such organization) / 403 (no relationship
 *                             or an ended one); one body for the 403s
 *   4. applicability, org toggle, then `giving.view` -> 403
 *   5. query               -> 413 over 50,000 rows ("Narrow the date range")
 *   6. audit, then respond
 *
 * The file: live-mode gifts only; header and column set pinned by `csv.ts`
 * (no email, address or memo); RFC 4180 quoting with a formula-injection
 * prefix; `text/csv; charset=utf-8`, `attachment`, `Cache-Control: no-store`.
 * The audit event carries the row count and the filters (ids and dates),
 * never a donor's name.
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
  const url = new URL(request.url);
  const selfPath = `${url.pathname}${url.search}`;

  const session = await auth();
  const check = assertGivingSession(session);
  if (check.kind === "unauthenticated") {
    return NextResponse.redirect(
      new URL(`/signin?callbackUrl=${encodeURIComponent(selfPath)}`, request.url),
      307,
    );
  }
  if (check.kind === "two_factor_required") {
    return NextResponse.redirect(new URL(givingTotpRedirectUrl(selfPath), request.url), 307);
  }

  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind === "not-found") return text(404, "Not found");
  if (resolved.kind !== "ok") return text(403, "You don't have access to that organization.");

  let context: Awaited<ReturnType<typeof loadGivingContext>>;
  try {
    context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) return text(403, "You don't have access to that organization.");
    return text(503, "We can't check your access right now. Try again in a moment.");
  }
  if (context.kind !== "ok" || !context.has.view) {
    return text(403, "You don't have permission to export gifts.");
  }

  const filters = parseGiftFilters(Object.fromEntries(url.searchParams.entries()));
  const result = await exportGifts(resolved.org.personId, resolved.org.organizationId, filters);
  if (result.kind === "forbidden") return text(403, "You don't have permission to export gifts.");
  if (result.kind === "too_many") return text(413, "Narrow the date range: that export is more than 50,000 gifts.");

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_GIFTS_EXPORTED,
    resourceType: "giving_gifts",
    resourceId: resolved.org.organizationId,
    metadata: {
      organizationId: resolved.org.organizationId,
      rowCount: result.rows.length,
      filters,
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buildGiftsCsv(result.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gifts-${slug}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
