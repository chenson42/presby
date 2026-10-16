import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import {
  assertGivingSession,
  givingTotpRedirectUrl,
  loadGivingContext,
} from "@/lib/giving/access";
import { continueConnect } from "@/lib/giving/connection";

/**
 * `GET /o/<slug>/admin/giving/connect/refresh` - Stripe's `refresh_url`
 * (docs/work-log/2026-10-15-online-giving.md, Phase 3 "Admin - connection").
 *
 * Stripe sends the treasurer here when an onboarding link has expired, been
 * used or is otherwise invalid. The handler mints a FRESH link for the open
 * connection and answers 307 to it. Anything that goes wrong - not signed in
 * as a manager, no connection, Stripe unreachable - sends the treasurer back
 * to `/o/<slug>/admin/giving` with a notice code; this handler never renders a
 * page and never reveals more than that.
 *
 * It is a GET that mints an onboarding link, so it is gated like any
 * administration surface (Stripe's own docs require authenticating before this
 * redirect, in case the URL leaks): signed in -> Node-side 2FA -> four-way org
 * miss -> applicability, org toggle, `giving.manage`. The 307 target is
 * origin-asserted inside `client.ts` (`accounts.stripe.com` /
 * `connect.stripe.com`). A GET with a side effect on a third party is made safe
 * by minting only a link for the caller's OWN connection: it creates and
 * changes nothing in presby.
 *
 * Audit: nothing security-sensitive changes (a link is minted), so no row.
 * Hand-audited here because `check:audit` scans `actions.ts` only.
 */

export const dynamic = "force-dynamic";

function back(request: Request, slug: string, notice: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/o/${encodeURIComponent(slug)}/admin/giving?connect=${notice}`, request.url),
    307,
  );
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
  if (resolved.kind !== "ok") return back(request, slug, "no_access");

  let context: Awaited<ReturnType<typeof loadGivingContext>>;
  try {
    context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) return back(request, slug, "no_access");
    return back(request, slug, "unavailable");
  }
  if (context.kind !== "ok" || !context.has.manage) return back(request, slug, "no_access");

  const result = await continueConnect(
    {
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      userId: check.userId,
      email: session?.user?.email ?? null,
    },
    slug,
  );
  if (result.kind === "redirect") return NextResponse.redirect(result.url, 307);
  if (result.kind === "no_connection") return back(request, slug, "no_connection");
  if (result.kind === "stripe_unconfigured") return back(request, slug, "unconfigured");
  return back(request, slug, "refresh_failed");
}
