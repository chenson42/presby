import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext, type OrganizationType } from "@/lib/authz";
import { assertGivingSession, givingTotpRedirectUrl, loadGivingContext } from "@/lib/giving/access";

/**
 * The gate the two statement route handlers (`[statementId]/download`,
 * `print`) run, in the order stated once in `src/lib/giving/access.ts` and
 * mirrored from `gifts/export/route.ts`:
 *
 *   1. signed in           -> 307 to /signin with this URL as the callback
 *   2. Node-side 2FA (R4)  -> 307 to /totp with this URL as the callback
 *   3. four-way org miss   -> 404 (no such organization) / 403 (no relationship
 *                             or an ended one); ONE body for every 403
 *   4. applicability, org toggle, then a giving key -> 403
 *
 * Route handlers are not wrapped by layouts and `check:audit` scans only
 * `actions.ts`, so the audit write each route performs is hand-audited (QA reads
 * it). Every non-success answer is a plain-text body with `no-store`; the 404 is
 * ONE shape (`notFound()`), reused for "no such organization" and, in the
 * download route, for "no such statement" - so nothing in a response says
 * which of the two it was.
 */

export function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function notFound(): Response {
  return plain(404, "Not found");
}

export interface StatementRouteOk {
  ok: true;
  userId: string;
  org: { personId: string; organizationId: string; organizationType: OrganizationType; name: string; slug: string };
  has: { view: boolean; record: boolean; manage: boolean };
}

export async function gateStatementRoute(
  request: Request,
  slug: string,
  anyOf: ReadonlyArray<"view" | "manage">,
): Promise<StatementRouteOk | { ok: false; response: Response }> {
  const url = new URL(request.url);
  const selfPath = `${url.pathname}${url.search}`;

  const session = await auth();
  const check = assertGivingSession(session);
  if (check.kind === "unauthenticated") {
    return {
      ok: false,
      response: Response.redirect(new URL(`/signin?callbackUrl=${encodeURIComponent(selfPath)}`, request.url), 307),
    };
  }
  if (check.kind === "two_factor_required") {
    return {
      ok: false,
      response: Response.redirect(new URL(givingTotpRedirectUrl(selfPath), request.url), 307),
    };
  }

  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind === "not-found") return { ok: false, response: notFound() };
  if (resolved.kind !== "ok") {
    return { ok: false, response: plain(403, "You don't have access to that organization.") };
  }

  let context: Awaited<ReturnType<typeof loadGivingContext>>;
  try {
    context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) {
      return { ok: false, response: plain(403, "You don't have access to that organization.") };
    }
    return { ok: false, response: plain(503, "We can't check your access right now. Try again in a moment.") };
  }
  if (context.kind !== "ok" || !anyOf.some((key) => context.has[key])) {
    return { ok: false, response: plain(403, "You don't have permission to download statements.") };
  }

  return {
    ok: true,
    userId: check.userId,
    org: {
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
      name: resolved.org.name,
      slug: resolved.org.slug,
    },
    has: context.has,
  };
}

/** Headers every PDF answer carries: a private, uncacheable attachment the browser may not sniff. */
export function pdfHeaders(filename: string, byteLength: number): HeadersInit {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(byteLength),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
