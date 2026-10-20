import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import {
  assertGivingSession,
  givingTotpRedirectUrl,
  loadGivingContext,
} from "@/lib/giving/access";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  GivingForbidden,
  GivingLoadError,
  GivingNotApplicable,
  GivingSectionForbidden,
  GivingToggleOff,
} from "./giving-admin-states";

/**
 * The gate EVERY `/o/<slug>/admin/giving/**` page runs, in one place so eleven
 * pages cannot drift. docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Gate order on every surface":
 *
 *   1. sign-in (a signed-out visitor keeps their deep link as `callbackUrl`)
 *   2. the four-way org miss -> `assertOrgAccess` (the auth check lives in the
 *      PAGE, not a layout: a layout cannot see the pathname)
 *   3. the Node-side 2FA check (R4): `twoFactorRequired && !twoFactorVerified`
 *      redirects to `/totp?callbackUrl=<this page>`
 *   4. org-type applicability, then the org toggle ("off" is an honest state at
 *      HTTP 200, never a 404)
 *   5. the permission: any of the keys the page names. Holding SOME giving key
 *      but not the one this page needs gets the section-specific state; holding
 *      none gets the general one.
 *
 * Each page CALLS this at its top and returns `gate.node` when `ok` is false -
 * the page still owns its own auth sequence; this function is the shared
 * implementation of it (a pure call, no layout, no `loading.tsx`).
 *
 * `redirect()` and `notFound()` throw, so they behave exactly as inline calls.
 * A database failure while reading the gate is NEVER an empty or "off" answer:
 * it renders `GivingLoadError`. An `OrgAccessError` (membership ended mid
 * request) is rethrown to `[slug]/error.tsx`.
 */

export type GivingNeedKey = "view" | "record" | "manage";

export interface GivingPageGateOk {
  ok: true;
  userId: string;
  org: {
    personId: string;
    organizationId: string;
    name: string;
    organizationType: OrganizationType;
    slug: string;
  };
  has: { view: boolean; record: boolean; manage: boolean };
}

export type GivingPageGate = GivingPageGateOk | { ok: false; node: ReactNode };

export async function gateGivingPage(options: {
  slug: string;
  /** This page's own path (for `callbackUrl`s): `/o/<slug>/admin/giving/funds`. */
  path: string;
  /** The page is open to a holder of ANY of these keys. */
  anyOf: readonly GivingNeedKey[];
  /** The page's name in the section-forbidden sentence ("Funds"). */
  section: string;
}): Promise<GivingPageGate> {
  const { slug, path, anyOf, section } = options;

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
        node: (
          <OrgAccessDenied
            name={resolved.name}
            organizationType={resolved.organizationType}
            slug={slug}
          />
        ),
      };
    case "ended":
      return {
        ok: false,
        node: <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />,
      };
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const sessionCheck = assertGivingSession(session);
  if (sessionCheck.kind === "two_factor_required") {
    redirect(givingTotpRedirectUrl(path));
  }
  if (sessionCheck.kind === "unauthenticated") {
    redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  }

  let context: Awaited<ReturnType<typeof loadGivingContext>>;
  try {
    context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { ok: false, node: <GivingLoadError slug={slug} href={path} /> };
  }

  const name = resolved.org.name;
  switch (context.kind) {
    case "not_applicable":
      return { ok: false, node: <GivingNotApplicable name={name} /> };
    case "toggle_off":
      return {
        ok: false,
        node: <GivingToggleOff name={name} slug={slug} canManageFeatures={context.canManageFeatures} />,
      };
    case "forbidden":
      return { ok: false, node: <GivingForbidden name={name} /> };
    case "ok":
      break;
  }

  if (!anyOf.some((key) => context.has[key])) {
    return { ok: false, node: <GivingSectionForbidden name={name} section={section} slug={slug} /> };
  }

  return {
    ok: true,
    userId: session.user.id,
    org: {
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      name,
      organizationType: resolved.org.organizationType,
      slug,
    },
    has: context.has,
  };
}
