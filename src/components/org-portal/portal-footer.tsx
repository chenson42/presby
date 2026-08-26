import Link from "next/link";
import { visiblePortalTiles } from "@/lib/org-portal/tiles";
import type { OrgProfileForFooter } from "@/lib/sites";

/**
 * The portal footer — Increment 3 of docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md. Server Component, no `'use
 * client'`: nothing here needs interactivity.
 *
 * INDEPENDENT READ, LIKE `PortalNav`'s OWN PRECEDENT: calls
 * `visiblePortalTiles()` itself rather than accepting it as a prop from
 * `layout.tsx`/`PortalNav` — the same "self-sufficient, independently-read
 * chrome" shape `PortalNav`'s own header documents ("a degraded switcher
 * does not take this row down, and vice versa"). This means the cheap,
 * DB-free, flag-table-backed `visiblePortalTiles()` read runs twice per
 * request when `org_portal.chrome_v3` is on (once for `PortalNav`, once
 * here) — named, not hidden, per Phase 3's Component Plan; tracked as a
 * docs/TODO.md follow-up alongside the already-named `resolveOrgContext`
 * double-read if `visiblePortalTiles()` ever needs org-scoped filtering that
 * makes the double call more than a rounding error.
 *
 * THREE BLOCKS, IN ORDER, per Phase 3's Component Plan:
 *
 *   1. Contact info — org name + address + a `tel:` phone link. Omitted
 *      ENTIRELY (not an empty bordered section, not a "no contact info on
 *      file" placeholder) when `profile` is `null` or both `address` and
 *      `phone` are `null` — a brand-new tenant with no `organization_profiles`
 *      row yet must render a working footer, not a broken layout or missing-
 *      data copy (Phase 1 Gap 3 / Phase 3 Edge Cases). Checked as
 *      `profile?.address || profile?.phone` (truthy on either), never
 *      `!!profile` alone, so a row with only ONE of the two fields set still
 *      renders that one line. The address/phone lines render at `text-base`
 *      (`TYPE_SCALE`'s `body` role), an explicit override of the wrapping
 *      div's ambient `text-sm` — `TYPE_SCALE` itself forbids `dense`/
 *      `text-sm` for a paragraph a member needs to read (docs/work-log/
 *      2026-08-26-portal-visual-modernization.md Phase 3). The org-name
 *      label, the nav recap, and the copyright line stay `text-sm` — all
 *      legitimate label/metadata/legal-boilerplate uses `TYPE_SCALE`'s
 *      `dense` role explicitly permits.
 *   2. Nav recap — `<nav aria-label="Footer">`, plain `<Link>`s, Home
 *      prepended unconditionally (matching `PortalNav`'s own "Home is
 *      hardcoded, not a PORTAL_TILES row" convention) followed by
 *      `visiblePortalTiles()`'s flag-filtered entries. No active-state
 *      styling — this is a footer, not the persistent nav row.
 *   3. Copyright line.
 *
 * ADDRESS RENDERS AS PLAIN TEXT, NOT A MAPS DEEP LINK — the "URL-encode into
 * a maps link" behavior belongs to the unrelated public-site profile display
 * (`PublishedSite.profile`, a presby-site-kit consumer). No such requirement
 * was named for this footer; inventing one would be scope creep (Phase 3
 * Component Plan, explicit).
 *
 * NO `*-brand[-*]` UTILITY CLASS HERE, deliberately — this file lives under
 * `src/components/`, which `check-brand-scope.mjs`'s C1 rule does not permit
 * (only `src/app/(org)/` and `src/app/(public)/` may use that class family).
 * Every color below resolves through a semantic token already legal
 * tree-wide (`border-border`, `text-muted-foreground`, `text-foreground`).
 *
 * GATE DISCIPLINE IS THE CALLER'S JOB, NOT THIS COMPONENT'S: `layout.tsx`
 * only renders `<PortalFooter>` inside its `resolved.kind === "ok"` branch,
 * behind `org_portal.chrome_v3` — this component itself performs no
 * membership or flag check, matching `PortalNav`'s own division of labor.
 *
 * CALLS `visiblePortalTiles("operate")`, NOT `"administer"` (portal-reorg
 * pipeline, docs/work-log/2026-08-26-portal-reorg-and-modernization.md) — a
 * fourth call site the Phase 3 design didn't separately enumerate, updated
 * here for the same reason `PortalNav`'s own persistent-nav call was: the
 * footer recap is a day-to-day-tools surface, matching what `PortalNav` and
 * the main portal page show, not the permission-gated setup tools now on the
 * `/o/<slug>/admin` hub.
 */
export async function PortalFooter({
  slug,
  organizationName,
  profile,
}: {
  slug: string;
  organizationName: string;
  profile: OrgProfileForFooter | null;
}) {
  const tiles = await visiblePortalTiles("operate");
  const hasContactInfo = Boolean(profile?.address || profile?.phone);

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-8 text-sm text-muted-foreground">
        {hasContactInfo && (
          <div className="space-y-1">
            <p className="font-medium text-foreground">{organizationName}</p>
            {profile?.address && (
              <p className="text-base">{profile.address}</p>
            )}
            {profile?.phone && (
              <a
                href={`tel:${profile.phone}`}
                className="flex min-h-11 w-fit items-center text-base hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {profile.phone}
              </a>
            )}
          </div>
        )}
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            <li>
              <Link
                href={`/o/${slug}`}
                className="flex min-h-11 items-center hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Home
              </Link>
            </li>
            {tiles.map((tile) => (
              <li key={tile.key}>
                <Link
                  href={tile.href(slug)}
                  className="flex min-h-11 items-center hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {tile.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          © {new Date().getFullYear()} {organizationName}. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}
