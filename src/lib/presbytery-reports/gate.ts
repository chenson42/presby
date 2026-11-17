import "server-only";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext, type OrganizationType } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { assertOrgSession, orgTotpRedirectUrl } from "@/lib/org-portal/session-check";
import { INSIGHTS_FLAG, REPORT_ORG_TYPES, REPORTS_FLAG, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { ROUTE_COPY } from "./copy";

/**
 * The one gate every presbytery report page and export route runs first
 * (docs/work-log/2026-11-15-presbytery-reports.md, Phase 3 "API Contract"),
 * with a page skin and a route skin like `reimbursement/gate.ts`. THE ORDER,
 * identical in both:
 *   1. signed in (a signed-out visitor keeps their deep link),
 *   2. the Node-side second-factor recheck, `assertOrgSession` - the Edge reads a
 *      claim that refreshes only when the session is re-derived, so a page
 *      never shows data its export would refuse,
 *   3. the four-way org miss (`resolveOrgContext`, DECISION-040) and
 *      `assertOrgAccess`,
 *   4. the page's own global flag (`org_portal.reports` for a report page,
 *      `org_portal.insights` for the dashboard; the BARE `isFlagEnabled`: it is
 *      a toggle, so DECISION-026's fail-open wrappers do not apply),
 *   5. the organization type (presbytery).
 * The report's own KEY is not checked here: each reader checks it inside its
 * own transaction (`presby_has_permission`, live), so no caller can skip it.
 *
 * On a route every refusal after the 404 is ONE 403 body - no relationship,
 * ended, `OrgAccessError`, flag off, wrong type, and (from the reader) a
 * missing key - because the org tree is public and the flag is global, so
 * nothing is lost by collapsing them and a prober learns nothing from the
 * difference. `boundaries.test.ts` pins that every `page.tsx` and `route.ts`
 * under the four segments calls this file.
 *
 * The page skin is one private core, `gatePresbyteryPage`, with a closed flag
 * union and no default, and two named exports over it (DECISION-342): no call
 * site passes a flag, so none can pass the wrong one, and `boundaries.test.ts`
 * pins each page to its own name.
 *
 * No `callbackUrl` or `next` is ever READ: the only redirects carry the
 * request's own path and query.
 */

/** Who passed a gate, with what the page needs to name the organization. */
export interface ReportIdentity extends ReportViewer {
  organizationName: string;
  organizationType: OrganizationType;
  slug: string;
}

/** The honest states a page renders in place of its content. */
export type ReportGateState =
  | { kind: "org_forbidden"; name: string; organizationType: OrganizationType }
  | { kind: "org_ended"; name: string; endedOn: string }
  | { kind: "flag_off"; name: string }
  | { kind: "not_applicable"; name: string };

export type ReportPageGate =
  | { ok: true; identity: ReportIdentity }
  | { ok: false; state: ReportGateState };

/** The flags a presbytery page gate may check: a closed union, never a free string. */
type PresbyteryPageFlag = typeof REPORTS_FLAG | typeof INSIGHTS_FLAG;

interface PageGateOptions {
  slug: string;
  /** This page's own path and query, for the sign-in and challenge callbacks. */
  path: string;
}

/** A presbytery report page's gate: the `org_portal.reports` flag. */
export function gateReportPage(options: PageGateOptions): Promise<ReportPageGate> {
  return gatePresbyteryPage({ ...options, flag: REPORTS_FLAG });
}

/** The dashboard's gate (`/admin/insights`): the `org_portal.insights` flag, same order and result. */
export function gateInsightsPage(options: PageGateOptions): Promise<ReportPageGate> {
  return gatePresbyteryPage({ ...options, flag: INSIGHTS_FLAG });
}

async function gatePresbyteryPage(options: PageGateOptions & { flag: PresbyteryPageFlag }): Promise<ReportPageGate> {
  const { slug, path, flag } = options;

  const session = await cachedAuth();
  const check = assertOrgSession(session);
  if (check.kind === "unauthenticated") redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  if (check.kind === "two_factor_required") redirect(orgTotpRedirectUrl(path));

  const resolved = await resolveOrgContext(check.userId, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return {
        ok: false,
        state: { kind: "org_forbidden", name: resolved.name, organizationType: resolved.organizationType },
      };
    case "ended":
      return { ok: false, state: { kind: "org_ended", name: resolved.name, endedOn: resolved.endedOn } };
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const name = resolved.org.name;
  if (!(await isFlagEnabled(flag))) return { ok: false, state: { kind: "flag_off", name } };
  if (!(REPORT_ORG_TYPES as readonly string[]).includes(resolved.org.organizationType)) {
    return { ok: false, state: { kind: "not_applicable", name } };
  }

  return {
    ok: true,
    identity: {
      userId: check.userId,
      email: session?.user?.email ?? null,
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationName: name,
      organizationType: resolved.org.organizationType,
      slug,
    },
  };
}

/**
 * Runs a reader for a page: `ok` data, `forbidden` (the key is missing), or
 * `error` (a thrown failure, rendered as a load error). An `OrgAccessError`
 * (membership ended mid-request) is rethrown to `[slug]/error.tsx`.
 */
export async function runReportRead<T>(
  read: () => Promise<ReportRead<T>>,
): Promise<{ kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "error" }> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** A plain-text, uncached answer: every non-200 an export route gives. */
export function reportText(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function gateReportRoute(options: {
  request: Request;
  slug: string;
}): Promise<({ ok: true } & ReportIdentity) | { ok: false; response: Response }> {
  const { request, slug } = options;
  const url = new URL(request.url);
  const selfPath = `${url.pathname}${url.search}`;

  const session = await auth();
  const check = assertOrgSession(session);
  if (check.kind === "unauthenticated") {
    return {
      ok: false,
      response: NextResponse.redirect(new URL(`/signin?callbackUrl=${encodeURIComponent(selfPath)}`, request.url), 307),
    };
  }
  if (check.kind === "two_factor_required") {
    return { ok: false, response: NextResponse.redirect(new URL(orgTotpRedirectUrl(selfPath), request.url), 307) };
  }

  try {
    const resolved = await resolveOrgContext(check.userId, slug);
    if (resolved.kind === "not-found") return { ok: false, response: reportText(404, ROUTE_COPY.notFound) };
    if (resolved.kind !== "ok") return { ok: false, response: reportText(403, ROUTE_COPY.forbidden) };

    await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

    const flagOn = await isFlagEnabled(REPORTS_FLAG);
    const typeOk = (REPORT_ORG_TYPES as readonly string[]).includes(resolved.org.organizationType);
    if (!flagOn || !typeOk) return { ok: false, response: reportText(403, ROUTE_COPY.forbidden) };

    return {
      ok: true,
      userId: check.userId,
      email: session?.user?.email ?? null,
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationName: resolved.org.name,
      organizationType: resolved.org.organizationType,
      slug,
    };
  } catch (err) {
    if (err instanceof OrgAccessError) return { ok: false, response: reportText(403, ROUTE_COPY.forbidden) };
    return { ok: false, response: reportText(503, ROUTE_COPY.gateFailed) };
  }
}

/** The CSV response for an export that passed (200 headers, Phase 3 "Export routes"). */
export function csvResponse(options: { csv: string; filenameBase: string; slug: string; now?: Date }): NextResponse {
  const stamp = (options.now ?? new Date()).toISOString().slice(0, 10);
  return new NextResponse(options.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${options.filenameBase}-${options.slug}-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Turns an export's outcome into its response: 403, the vacant-pulpits 409, or the file. */
export function respondWithExport(result: ReportExport, slug: string): Response {
  if (result.kind === "forbidden") return reportText(403, ROUTE_COPY.forbidden);
  if (result.kind === "nothing_to_export") return reportText(409, ROUTE_COPY.nothingToExport);
  return csvResponse({ csv: result.csv, filenameBase: result.filenameBase, slug });
}
