import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, resolveOrgContext } from "@/lib/authz";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

/**
 * The `(org)` auth pattern every careers page repeats (session, the four-way miss,
 * `assertOrgAccess`), in one place so the three pages cannot drift. The auth check
 * lives in the PAGE, not the layout, so the deep link survives (the `(org)` contract);
 * these pages call this first thing.
 *
 * `redirect()` and `notFound()` throw, so a caller only ever sees `ok` or a state to
 * render. The careers gate itself (toggle, then `careers.manage`) runs inside the lib's
 * first transaction, not here.
 */
export type CareersAccess =
  | { ok: true; org: { personId: string; organizationId: string; name: string; slug: string } }
  | { ok: false; node: ReactElement };

export async function resolveCareersAccess(slug: string, path: string): Promise<CareersAccess> {
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
  return {
    ok: true,
    org: {
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      name: resolved.org.name,
      slug,
    },
  };
}
