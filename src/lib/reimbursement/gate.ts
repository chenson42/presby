import "server-only";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { assertTreasurySession, treasuryTotpRedirectUrl } from "@/lib/treasury/session";
import { loadReimbursementContext } from "./access";
import { COPY } from "./copy";
import type { ReimbursementHas, ReimbursementNeed } from "./keys";

/**
 * The three gates every reimbursement entry point runs first - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 "Permissions & Flags -> Gate order",
 * P3-3, EC25. One implementation, three skins:
 *
 *   gateReimbursementPage    pages   (redirects and states a page renders)
 *   gateReimbursementAction  server actions   (`{ ok: false, error }`)
 *   gateReimbursementRoute   route handlers   (a `Response`)
 *
 * THE ORDER, identical in all three:
 *   1. signed in          (a signed-out visitor keeps their deep link)
 *   2. the Node-side 2FA check, `assertTreasurySession` - on EVERY reimbursement
 *      surface, not only `admin/**`. The Edge reads the `twoFactorRequired`
 *      claim, which refreshes only when the session is re-derived, so a user
 *      JUST granted a treasury key carries a stale `false`; without this a
 *      just-granted treasurer reaches treasurer data through the member route.
 *      It is a no-op for a requester or approver whose claim does not require
 *      2FA.
 *   3. the four-way org miss (`resolveOrgContext`, DECISION-040) and
 *      `assertOrgAccess`
 *   4. org-type applicability, then the toggle (`loadReimbursementContext`)
 *   5. the key: ANY of `anyOf`, or no key at all (omit it) for the member
 *      surface - who may FILE is the database's `may_file`, and approval is a
 *      seat the definer checks live
 *
 * `organizationId` NEVER comes from the client: an action takes the URL slug and
 * re-resolves it inside THIS user's own memberships, exactly as every other
 * `actions.ts` does. `auth()` is used directly in actions and routes (each is
 * its own invocation); pages use `cachedAuth()`.
 *
 * `gate-coverage.test.ts` is a source scan over both route trees: every
 * `page.tsx`, `actions.ts` and `route.ts` under `reimbursements/` and
 * `admin/reimbursements/` must call one of these (EC25).
 *
 * A database failure while reading the gate is NEVER an empty or "off" answer:
 * pages render a load error, actions say so, routes answer 503. An
 * `OrgAccessError` (membership ended mid-request) is rethrown from pages to
 * `[slug]/error.tsx`.
 */

/** Who passed a gate. `has` is read live from the resolver, never from the session. */
export interface ReimbursementIdentity {
  userId: string;
  email: string | null;
  personId: string;
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  slug: string;
  has: ReimbursementHas;
}

const MEMBER_HOME = (slug: string) => `/o/${slug}/reimbursements`;
const TREASURY_HOME = (slug: string) => `/o/${slug}/admin/reimbursements`;

function anyHeld(has: ReimbursementHas, anyOf: readonly ReimbursementNeed[] | undefined): boolean {
  if (!anyOf || anyOf.length === 0) return true;
  return anyOf.some((need) => has[need]);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** The honest states a page renders in place of its content (all at HTTP 200 except the 404/redirects). */
export type ReimbursementGateState =
  /** A relationship exists elsewhere / none: access denied, naming the organization (one string for all, DECISION-040). */
  | { kind: "org_forbidden"; name: string; organizationType: OrganizationType }
  | { kind: "org_ended"; name: string; endedOn: string }
  | { kind: "not_applicable"; name: string }
  | { kind: "toggle_off"; name: string; canManageFeatures: boolean }
  /** Toggle on, but the viewer holds none of the keys this page needs. */
  | { kind: "forbidden"; name: string }
  | { kind: "load_error" };

export type ReimbursementPageGate =
  | { ok: true; identity: ReimbursementIdentity }
  | { ok: false; state: ReimbursementGateState };

export async function gateReimbursementPage(options: {
  slug: string;
  /** This page's own path (for `callbackUrl`s): `/o/<slug>/reimbursements/<id>`. */
  path: string;
  /** Open to a holder of ANY of these keys; omit for the member surface. */
  anyOf?: readonly ReimbursementNeed[];
}): Promise<ReimbursementPageGate> {
  const { slug, path, anyOf } = options;

  const session = await cachedAuth();
  const check = assertTreasurySession(session);
  if (check.kind === "unauthenticated") {
    redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  }
  if (check.kind === "two_factor_required") {
    redirect(treasuryTotpRedirectUrl(path));
  }
  const userId = check.userId;

  const resolved = await resolveOrgContext(userId, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return { ok: false, state: { kind: "org_forbidden", name: resolved.name, organizationType: resolved.organizationType } };
    case "ended":
      return { ok: false, state: { kind: "org_ended", name: resolved.name, endedOn: resolved.endedOn } };
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  let context: Awaited<ReturnType<typeof loadReimbursementContext>>;
  try {
    context = await loadReimbursementContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { ok: false, state: { kind: "load_error" } };
  }

  const name = resolved.org.name;
  switch (context.kind) {
    case "not_applicable":
      return { ok: false, state: { kind: "not_applicable", name } };
    case "toggle_off":
      return { ok: false, state: { kind: "toggle_off", name, canManageFeatures: context.canManageFeatures } };
    case "ok":
      break;
  }
  if (!anyHeld(context.has, anyOf)) {
    return { ok: false, state: { kind: "forbidden", name } };
  }

  return {
    ok: true,
    identity: {
      userId,
      email: session?.user?.email ?? null,
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationName: name,
      organizationType: resolved.org.organizationType,
      slug,
      has: context.has,
    },
  };
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export interface ReimbursementGateFailure {
  ok: false;
  error: string;
  kind?: "two_factor_required";
  redirectTo?: string;
}

/**
 * The gate every reimbursement server action runs first. Every failure is a
 * plain `{ ok: false, error }` the form can toast, except the 2FA refusal,
 * which also carries `kind: "two_factor_required"` and a `redirectTo` so the
 * client can send the user to the challenge instead of leaving them with a
 * toast and no way forward. The database blip is its own honest message - never
 * a silent "not allowed".
 */
export async function gateReimbursementAction(
  slug: string,
  options: { anyOf?: readonly ReimbursementNeed[]; returnTo?: string } = {},
): Promise<({ ok: true } & ReimbursementIdentity) | ReimbursementGateFailure> {
  const session = await auth();
  const check = assertTreasurySession(session);
  if (check.kind === "unauthenticated") {
    return { ok: false, error: COPY.gate.signedOut };
  }
  if (check.kind === "two_factor_required") {
    const returnTo =
      options.returnTo ?? (options.anyOf && options.anyOf.length > 0 ? TREASURY_HOME(slug) : MEMBER_HOME(slug));
    return {
      ok: false,
      kind: "two_factor_required",
      error: COPY.gate.twoFactorRequired,
      redirectTo: treasuryTotpRedirectUrl(returnTo),
    };
  }

  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: COPY.gate.noOrgAccess };
  }

  let context: Awaited<ReturnType<typeof loadReimbursementContext>>;
  try {
    context = await loadReimbursementContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) return { ok: false, error: COPY.gate.noOrgAccess };
    return { ok: false, error: COPY.gate.accessCheckFailed };
  }

  switch (context.kind) {
    case "not_applicable":
      return { ok: false, error: COPY.page.notApplicable };
    case "toggle_off":
      return { ok: false, error: COPY.page.toggleOff(resolved.org.name) };
    case "ok":
      break;
  }
  if (!anyHeld(context.has, options.anyOf)) {
    return { ok: false, error: COPY.gate.notPermitted };
  }

  return {
    ok: true,
    userId: check.userId,
    email: session?.user?.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    organizationName: resolved.org.name,
    organizationType: resolved.org.organizationType,
    slug,
    has: context.has,
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The gate every reimbursement route handler runs first (receipts upload and
 * download, print, CSV export). Answers a `Response` when it refuses:
 *   - signed out: 307 to `/signin` with this URL as the callback;
 *   - 2FA required and unverified: 307 to `/totp` with this URL as the callback;
 *   - no such organization: 404 `Not found`; no relationship, or an ended one,
 *     403 with ONE body (DECISION-040);
 *   - not applicable or toggle off: 404 `Not found` (a route has no "honest
 *     page" to render, and the toggle must not be probe-able as a different
 *     status from a missing resource);
 *   - the key missing: 403;
 *   - a failure to read the gate: 503, never an "off" answer.
 * The route then applies its own per-resource rule (the request-viewer rule for
 * a receipt, the requester projection for print), whose misses are one 404.
 */
export async function gateReimbursementRoute(options: {
  request: Request;
  slug: string;
  anyOf?: readonly ReimbursementNeed[];
}): Promise<({ ok: true } & ReimbursementIdentity) | { ok: false; response: Response }> {
  const { request, slug, anyOf } = options;
  const url = new URL(request.url);
  const selfPath = `${url.pathname}${url.search}`;

  const session = await auth();
  const check = assertTreasurySession(session);
  if (check.kind === "unauthenticated") {
    return {
      ok: false,
      response: NextResponse.redirect(
        new URL(`/signin?callbackUrl=${encodeURIComponent(selfPath)}`, request.url),
        307,
      ),
    };
  }
  if (check.kind === "two_factor_required") {
    return {
      ok: false,
      response: NextResponse.redirect(new URL(treasuryTotpRedirectUrl(selfPath), request.url), 307),
    };
  }

  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind === "not-found") return { ok: false, response: text(404, COPY.receipts.notFoundBody) };
  if (resolved.kind !== "ok") return { ok: false, response: text(403, COPY.gate.noOrgAccess) };

  let context: Awaited<ReturnType<typeof loadReimbursementContext>>;
  try {
    context = await loadReimbursementContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) return { ok: false, response: text(403, COPY.gate.noOrgAccess) };
    return { ok: false, response: text(503, COPY.gate.accessCheckFailed) };
  }
  if (context.kind !== "ok") return { ok: false, response: text(404, COPY.receipts.notFoundBody) };
  if (!anyHeld(context.has, anyOf)) return { ok: false, response: text(403, COPY.gate.notPermitted) };

  return {
    ok: true,
    userId: check.userId,
    email: session?.user?.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    organizationName: resolved.org.name,
    organizationType: resolved.org.organizationType,
    slug,
    has: context.has,
  };
}
