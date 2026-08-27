import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  visiblePortalTiles,
} from "@/lib/org-portal/tiles";
import { DomainTileSections } from "@/components/shared/domain-tile-sections";
import { TILE_ICONS } from "@/components/org-portal/tile-icons";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { AdminHubFlagOff } from "./admin-hub-states";

/**
 * `/o/<slug>/admin` — the Organization Administration hub index. Portal-reorg
 * pipeline (docs/work-log/2026-08-26-portal-reorg-and-modernization.md,
 * Phase 3), the net-new route the architect placed as a sibling of the
 * existing `admin/{features,roles,members,officers}/` directories, under
 * the existing `admin/layout.tsx`.
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as `admin/features/
 * page.tsx` and `admin/roles/page.tsx` one directory shallower — see those
 * files' headers for the fuller rationale on why the auth check lives in
 * the page rather than the layout.
 *
 * THE HUB'S OWN REACHABILITY GATE IS `isFlagEnabled("org_portal.admin_hub")`
 * AND NOTHING ELSE. This is the single highest-risk rule in this file's
 * design (architect's Phase 2 ruling, resolving Phase 1's Gap 2): the hub
 * shows every flag-enabled `"administer"`-category tile from
 * `visiblePortalTiles("administer")` REGARDLESS OF THE VIEWER'S OWN
 * PERMISSIONS. It performs no permission check of its own — not
 * `people.manage`, not `role_grants.manage`, not `officers.manage`, not
 * `org_features.manage`. Each destination page remains the sole authority
 * on "may THIS person": a permission-less viewer sees every card here and
 * gets that destination's own honest `Forbidden` state on click. A hub that
 * pre-filtered cards by permission would have to duplicate every
 * destination's permission-resolution logic at this layer — a second gate,
 * exactly what DECISION-003 rules out. DO NOT "FIX" THIS BY ADDING A
 * PERMISSION CHECK HERE — see `tiles.ts`'s own header for the same rule
 * stated at the registry layer.
 *
 * DOMAIN-SECTIONED, NOT A FLAT GRID (commit 2, docs/work-log/
 * 2026-08-27-product-ia-scaffold.md, Phase 3, DECISION-117): `TileGrid` is
 * replaced with `DomainTileSections`, applied uniformly — no "big enough"
 * threshold — grouping the same `visiblePortalTiles("administer", ...)`
 * result under labeled domain headings (Roles/Features/Branding/Tickets all
 * bucket to "Administration" today). The `tiles.length === 0` short-circuit
 * above is unchanged.
 */
export default async function AdminHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded
          name={resolved.name}
          endedOn={resolved.endedOn}
          slug={slug}
        />
      );
    case "ok":
      break;
  }

  // The authoritative gate — see `../page.tsx`'s identical call for the full
  // rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const adminHubEnabled = await isFlagEnabled("org_portal.admin_hub");
  if (!adminHubEnabled) {
    return <AdminHubFlagOff name={resolved.org.name} />;
  }

  const tiles = await visiblePortalTiles("administer", resolved.org.organizationType);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organization Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up {resolved.org.name} — members, roles, officers, and
          features.
        </p>
      </div>

      {tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is turned on here yet.
        </p>
      ) : (
        <DomainTileSections
          tiles={tiles}
          getHref={(tile) => tile.href(slug)}
          getIcon={(tile) => TILE_ICONS[tile.key]}
          domainOrder={DOMAIN_ORDER}
          domainLabels={DOMAIN_LABELS}
        />
      )}
    </section>
  );
}
