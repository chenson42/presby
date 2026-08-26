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
 */
export interface PortalTile {
  key: string;
  label: string;
  description: string;
  href: (slug: string) => string;
  flagKey: string;
}

export const PORTAL_TILES: readonly PortalTile[] = [
  {
    key: "members",
    label: "Members",
    description: "Add a person and record roll actions.",
    href: (slug) => `/o/${slug}/admin/members`,
    flagKey: "org_portal.members_create",
  },
  {
    key: "directory",
    label: "Directory",
    description: "Browse the congregation directory.",
    href: (slug) => `/o/${slug}/directory`,
    flagKey: "org_portal.directory",
  },
  {
    key: "roles",
    label: "Administration",
    description: "Manage roles and permissions for this organization.",
    href: (slug) => `/o/${slug}/admin/roles`,
    flagKey: "org_portal.roles",
  },
  {
    key: "tickets",
    label: "Tickets",
    description: "File and track support tickets.",
    href: (slug) => `/o/${slug}/tickets`,
    flagKey: "org_portal.tickets",
  },
  {
    key: "feedback",
    label: "Give feedback",
    description: "Share feedback about your congregation's portal.",
    href: (slug) => `/o/${slug}/feedback`,
    flagKey: "org_portal.feedback",
  },
] as const;

/**
 * The tiles a viewer sees — filtered by flag only, nothing else. Order
 * follows `PORTAL_TILES`'s declaration order, which the tile grid renders
 * as-is (no re-sorting at the render layer).
 */
export async function visiblePortalTiles(): Promise<PortalTile[]> {
  const checks = await Promise.all(
    PORTAL_TILES.map(async (tile) => ({
      tile,
      enabled: await isFlagEnabled(tile.flagKey),
    })),
  );
  return checks.filter((c) => c.enabled).map((c) => c.tile);
}
