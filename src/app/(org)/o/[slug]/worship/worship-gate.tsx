import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import type { WorshipViewer } from "@/lib/worship/access";
import { getWorshipContext } from "@/lib/worship/reads";
import type { WorshipResult } from "@/lib/worship/result";
import type { WorshipHas, WorshipKeyName } from "@/lib/worship/vocab";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { WorshipForbidden, WorshipLoadError, WorshipNotApplicable, WorshipOff } from "./worship-states";

/**
 * The `(org)` auth sequence every worship page repeats, in one place so the member
 * tree and the admin tree cannot drift - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "Permissions & Flags -> Gate order":
 *
 *   signed in (the deep link survives in `callbackUrl`)
 *     -> the four-way org miss (`resolveOrgContext`, DECISION-040) and `assertOrgAccess`
 *     -> org-type applicability, then the toggle (`getWorshipContext`, one transaction)
 *     -> the keys: `anyOf` (a holder of ANY listed key), or none for the member surface.
 *
 * The auth check lives in the PAGE, not the layout, so the deep link survives (the
 * `(org)` contract). `redirect()` and `notFound()` throw, so a caller only ever sees
 * `ok` or a node to render. A database failure while reading the gate is a load
 * error, never "off" and never "not allowed"; an `OrgAccessError` (the membership
 * ended mid-request) is rethrown to `[slug]/error.tsx`.
 *
 * No `loading.tsx` exists under `worship/**` or `admin/worship/**`: several segments
 * call `notFound()` and a Suspense boundary would flush a 200 first (CLAUDE.md,
 * DECISION-251).
 */

export interface WorshipPageIdentity {
  viewer: WorshipViewer;
  slug: string;
  organizationName: string;
  has: WorshipHas;
}

export type WorshipPageGate = { ok: true; identity: WorshipPageIdentity } | { ok: false; node: ReactElement };

export async function gateWorshipPage(options: {
  slug: string;
  /** This page's own path, for the sign-in `callbackUrl`. */
  path: string;
  /** Open to a holder of ANY of these keys; omit for the member surface. */
  anyOf?: readonly WorshipKeyName[];
  /** The page's `<h1>` on a state page. */
  heading: string;
  /** Where "Try again" goes on a load error. */
  retryHref?: string;
}): Promise<WorshipPageGate> {
  const { slug, path, anyOf, heading } = options;
  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return {
        ok: false,
        node: <OrgAccessDenied name={resolved.name} organizationType={resolved.organizationType} slug={slug} />,
      };
    case "ended":
      return { ok: false, node: <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} /> };
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const viewer: WorshipViewer = {
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    organizationType: resolved.org.organizationType,
    userId: session.user.id,
    email: session.user.email ?? null,
  };
  const name = resolved.org.name;

  let context: Awaited<ReturnType<typeof getWorshipContext>>;
  try {
    context = await getWorshipContext(viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { ok: false, node: <WorshipLoadError href={options.retryHref ?? path} heading={heading} /> };
  }
  if (context.kind === "not_applicable") return { ok: false, node: <WorshipNotApplicable heading={heading} /> };
  if (context.kind === "toggle_off") {
    return {
      ok: false,
      node: <WorshipOff name={name} slug={slug} canManageFeatures={context.canManageFeatures} heading={heading} />,
    };
  }
  if (anyOf && anyOf.length > 0 && !anyOf.some((key) => context.has[key])) {
    return { ok: false, node: <WorshipForbidden name={name} heading={heading} /> };
  }
  return { ok: true, identity: { viewer, slug, organizationName: name, has: context.has } };
}

/**
 * A store read's answer for a page. `ok` gives the data; `not_found` and `forbidden`
 * are the organization's own 404 (the same answer as an unknown id, so an id cannot
 * be probed); the gate's own refusals (they can only happen on a race with the
 * toggle) and any other failure render their honest state.
 */
export function readOrState<T>(
  result: WorshipResult<T>,
  options: { slug: string; name: string; heading: string; retryHref: string },
): { ok: true; data: T } | { ok: false; node: ReactElement } {
  switch (result.kind) {
    case "ok":
      return { ok: true, data: result.data };
    case "not_found":
    case "forbidden":
      notFound();
    case "not_applicable":
      return { ok: false, node: <WorshipNotApplicable heading={options.heading} /> };
    case "toggle_off":
      return {
        ok: false,
        node: <WorshipOff name={options.name} slug={options.slug} canManageFeatures={false} heading={options.heading} />,
      };
    default:
      return { ok: false, node: <WorshipLoadError href={options.retryHref} heading={options.heading} /> };
  }
}

