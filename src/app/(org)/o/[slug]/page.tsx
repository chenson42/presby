import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, resolveOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import {
  OrgAccessDenied,
  OrgAccessEnded,
  OrgPortalStub,
} from "./org-states";

/**
 * `/o/<slug>` — the organization landing page, and the first route in the
 * `(org)` tree (see the contract in `(org)/layout.tsx`).
 *
 * THE FOUR-WAY MISS RESPONSE (DECISION-040) is the substance of this page in
 * P0; the portal itself is P1.
 *
 *   active relationship at a `managed` org  → enter
 *   ENDED relationship at that org          → named and dated
 *   the slug is in the public org tree,     → access denied, naming it, with
 *   but no relationship                       ONE string for `managed`,
 *                                             `invited` and `unmanaged` alike
 *   the slug is nothing                     → 404
 *
 * THE RESOLUTION ORDER IS THE SECURITY PROPERTY. `resolveOrgContext()` resolves
 * the slug INSIDE the user's own relationship set; it never looks
 * `organizations` up by slug and hands the id to `withOrgContext()`, because
 * that table is not tenant-isolated and the lookup succeeds for every
 * organization on the platform.
 *
 * The auth check is here rather than in the layout on purpose: a layout cannot
 * see the pathname, so it would have to guess a `callbackUrl` and lose the deep
 * link — which is exactly the defect `(member)/layout.tsx` carries.
 */
export default async function OrgPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      // A real 404, rendered by not-found.tsx.
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} />
      );
    case "ok":
      break;
  }

  // The authoritative gate: an in-transaction membership re-check that reads
  // nothing. `resolveOrgContext` ran outside any transaction and is therefore
  // not the gate; this is. Every `(org)` page calls it — including the ones
  // with no tenant data to read, because the first page that skips it is the
  // hole. It throws OrgAccessError if the relationship vanished in between,
  // which error.tsx catches.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const directoryEnabled = await isFlagEnabled("org_portal.directory");
  const rolesEnabled = await isFlagEnabled("org_portal.roles");

  return (
    <OrgPortalStub
      name={resolved.org.name}
      organizationType={resolved.org.organizationType}
      slug={resolved.org.slug}
      directoryEnabled={directoryEnabled}
      rolesEnabled={rolesEnabled}
    />
  );
}
