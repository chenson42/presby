import "server-only";
import { isFlagEnabled } from "@/lib/flags";

/**
 * The portal-home tool-tile registry (Phase 2/3, Increment 1).
 *
 * FLAG-ONLY, AND THAT IS THE WHOLE DESIGN. A tile's visibility here answers
 * "is this feature on at all" — the same question `OrgPortalStub` already
 * asked with its four `*Enabled` booleans, now centralized in one data
 * module instead of four repeated `isFlagEnabled()` calls at the call site.
 * It is deliberately NOT gated on the viewer's own permission
 * (`directory.view`, `role_grants.manage`, `tickets.file`, …): the
 * destination route is the SOLE authority on that and renders its own honest
 * denied state (`DirectoryForbidden`, `TicketsForbidden`, …). This registry
 * must never grow a second permission check — that would be two gates
 * disagreeing about the same grant, which is the exact defect DECISION-003
 * ("a flag never gates a permission") exists to rule out.
 *
 * `PORTAL_TILES` mirrors `OrgPortalStub`'s four links exactly (directory,
 * administration, tickets, feedback) — same hrefs. Every `flagKey` here must
 * be a real row `scripts/seed.ts` seeds; the paired `tiles.test.ts` pins that
 * against a hard-coded snapshot of that seed list, because this module
 * cannot import `scripts/seed.ts` itself (it runs at script time against
 * `process.env.DATABASE_URL`, not import time).
 *
 * `feedback` carried a BORROWED flagKey (`org_portal.tickets`) through the
 * support-tickets pipeline — harmless while this tile lived only in a card
 * grid, but the portal-chrome pipeline (docs/work-log/
 * 2026-08-25-portal-chrome.md) promotes it to a persistent header link, at
 * which point a shared key becomes consequential (rolling back tickets would
 * silently take feedback with it). It now has its own `org_portal.feedback`
 * flag; `org_portal.tickets` keeps gating `tickets` alone.
 *
 * `category` (docs/work-log/2026-08-26-portal-reorg-and-modernization.md,
 * Phase 3) is a SECOND, ORTHOGONAL routing question added on top of the
 * flag-only design above — "which page renders this tile" (`/o/<slug>` for
 * `"operate"`, `/o/<slug>/admin` for `"administer"`), never "may this viewer
 * click it." It is presentational routing metadata ONLY. It must NEVER
 * become a second permission check, the same rule `flagKey` already follows:
 * a viewer with zero tenant permissions still sees every flag-enabled
 * `"administer"` tile on the hub, and gets that destination's own honest
 * `Forbidden` state on click — the hub performs no permission check of any
 * kind, only the flag check (architect's Phase 2 ruling, resolving Phase 1's
 * Gap 2). "operate" tiles are the day-to-day tools meaningful to every
 * member regardless of permission (Directory, Members, Officers, feedback);
 * "administer" tiles are setting up or governing this org rather than running
 * it day to day (Roles, Features, Branding, Tickets) and all gate their own
 * destination on a `*.manage`/`*.file` tenant permission. Operator correction
 * 2026-08-26: Members and Officers moved administer→operate (they're routine
 * congregational work, not org setup) and Tickets moved operate→administer
 * (filing a platform-support ticket is closer to administering the org's
 * platform relationship than day-to-day ministry).
 */
export type PortalTileCategory = "operate" | "administer";

export interface PortalTile {
  key: string;
  label: string;
  description: string;
  href: (slug: string) => string;
  flagKey: string;
  /** Routing only — which page renders the tile. Never a permission check. */
  category: PortalTileCategory;
}

export const PORTAL_TILES: readonly PortalTile[] = [
  {
    key: "members",
    label: "Members",
    description: "Add a person and record roll actions.",
    href: (slug) => `/o/${slug}/admin/members`,
    flagKey: "org_portal.members_create",
    category: "operate",
  },
  {
    key: "directory",
    label: "Directory",
    description: "Browse the congregation directory.",
    href: (slug) => `/o/${slug}/directory`,
    flagKey: "org_portal.directory",
    category: "operate",
  },
  {
    key: "roles",
    label: "Roles",
    description: "Manage roles and permissions for this organization.",
    href: (slug) => `/o/${slug}/admin/roles`,
    flagKey: "org_portal.roles",
    category: "administer",
  },
  {
    key: "officers",
    label: "Officers",
    description: "Record officer terms and view the session/diaconate roster.",
    href: (slug) => `/o/${slug}/admin/officers`,
    flagKey: "org_portal.officers",
    category: "operate",
  },
  {
    key: "tickets",
    label: "Tickets",
    description: "File and track support tickets.",
    href: (slug) => `/o/${slug}/tickets`,
    flagKey: "org_portal.tickets",
    category: "administer",
  },
  {
    key: "feedback",
    label: "Give feedback",
    description: "Share feedback about your congregation's portal.",
    href: (slug) => `/o/${slug}/feedback`,
    flagKey: "org_portal.feedback",
    category: "operate",
  },
  {
    key: "features",
    label: "Features",
    description: "Turn optional portal features on or off for this organization.",
    href: (slug) => `/o/${slug}/admin/features`,
    flagKey: "org_portal.features",
    category: "administer",
  },
  {
    key: "branding",
    label: "Branding",
    description: "Set your organization's colour, type pairing, and logo.",
    href: (slug) => `/o/${slug}/admin/branding`,
    flagKey: "org_portal.branding",
    category: "administer",
  },
] as const;

/**
 * The tiles a viewer sees for one category — filtered by category, then by
 * flag alone, nothing else. Order follows `PORTAL_TILES`'s declaration order,
 * which the tile grid renders as-is (no re-sorting at the render layer).
 *
 * ONE SHARED IMPLEMENTATION, TWO CALLERS: `/o/<slug>/page.tsx` calls
 * `visiblePortalTiles("operate")`, `/o/<slug>/admin/page.tsx` calls
 * `visiblePortalTiles("administer")`. There is no unparameterized overload
 * and no default category — an ungoverned call is exactly the bug this
 * signature makes impossible to write by accident (Phase 3 design).
 */
export async function visiblePortalTiles(
  category: PortalTileCategory,
): Promise<PortalTile[]> {
  const checks = await Promise.all(
    PORTAL_TILES.filter((tile) => tile.category === category).map(
      async (tile) => ({
        tile,
        enabled: await isFlagEnabled(tile.flagKey),
      }),
    ),
  );
  return checks.filter((c) => c.enabled).map((c) => c.tile);
}
