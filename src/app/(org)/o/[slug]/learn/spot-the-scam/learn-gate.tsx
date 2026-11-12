import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { getLearnPageContext } from "@/lib/learn/access";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { LearnLoadError, LearnOff } from "./learn-states";

/**
 * The `(org)` auth sequence for the Spot the scam page (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3; the `worship-gate.tsx` and `careers-access.tsx` pattern, a third copy; extracting
 * one shared gate is a tracked refactor, not this pipeline):
 *
 *   signed in (the deep link survives in a SERVER-BUILT `callbackUrl`, never a request value)
 *     -> the four-way org miss (`resolveOrgContext`, DECISION-040) and `assertOrgAccess`
 *     -> the toggle (`getLearnPageContext`, one transaction).
 *
 * The auth check lives in the PAGE, not the layout, so the deep link survives (the `(org)`
 * contract). `redirect()` and `notFound()` throw, so a caller only ever sees `ok` or a node to
 * render. A database failure reading the toggle is a load error, never "off"; an
 * `OrgAccessError` is rethrown to `[slug]/error.tsx`. No `loading.tsx` under `learn/**`.
 */
export type LearnGate = { ok: true; slug: string; organizationName: string } | { ok: false; node: ReactElement };

export async function gateLearnPage(slug: string, path: string): Promise<LearnGate> {
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
  const name = resolved.org.name;

  let context: Awaited<ReturnType<typeof getLearnPageContext>>;
  try {
    context = await getLearnPageContext({ personId: resolved.org.personId, organizationId: resolved.org.organizationId });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { ok: false, node: <LearnLoadError slug={slug} /> };
  }
  if (context.kind === "off") {
    return { ok: false, node: <LearnOff name={name} slug={slug} canManageFeatures={context.canManageFeatures} /> };
  }
  return { ok: true, slug, organizationName: name };
}
