import "server-only";
import { isFlagEnabled } from "@/lib/flags";
import type { OrganizationType } from "@/lib/authz";

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
 *
 * `orgTypeScope` (docs/work-log/2026-08-27-credentials-tile-org-type.md) is a
 * THIRD, ORTHOGONAL routing question — "which kinds of organization is this
 * tile even a candidate for" — layered on top of `category` and `flagKey`
 * the same way `category` was layered on top of the original flag-only
 * design: presentational registry metadata, never a permission check. See
 * the `PortalTile` interface's own comment on the field for the array-vs-
 * scalar distinction from `app_roles.organizationTypeScope`.
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
  /**
   * Bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md: a THIRD,
   * ORTHOGONAL routing question, same rule as `category` — presentational
   * registry metadata, NEVER a permission check. Absent (`undefined`) means
   * universal — the tile is a candidate for every organization type, subject
   * only to `category` and `flagKey` as before.
   *
   * DELIBERATELY AN ALLOW-LIST ARRAY (`OrganizationType[] | undefined`), NOT
   * a single nullable enum like `app_roles.organizationTypeScope`. That
   * column answers "this role belongs to exactly one org type (or none, i.e.
   * every type)" — one role, one home court. A tile can legitimately belong
   * to more than one org type at once (nothing here rules out a future tile
   * scoped to `["presbytery", "synod"]`), so the shapes diverge on purpose:
   * `organizationTypeScope === value` is correct there, `scope.includes
   * (value)` is correct here. Do not collapse them to one field or one
   * comparison operator — the org-type enum has FIVE values (`general_
   * assembly`, `synod`, `presbytery`, `congregation`, `new_worshiping_
   * community`), and this is an ALLOW-LIST: check membership, never
   * `!== "congregation"` exclusion, which would wrongly admit synod/GA org
   * types that were never meant to see the tile either (architect's Phase 2
   * caution).
   */
  orgTypeScope?: readonly OrganizationType[];
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
    description: "Browse the directory.",
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
    description: "Share feedback about your organization's portal.",
    href: (slug) => `/o/${slug}/feedback`,
    flagKey: "org_portal.feedback",
    category: "operate",
  },
  {
    key: "groups",
    label: "Groups",
    description: "Manage committees, small groups, choirs, and teams.",
    href: (slug) => `/o/${slug}/admin/groups`,
    flagKey: "org_portal.groups",
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
  {
    key: "events",
    label: "Events",
    description: "Create and manage calendar events, including repeating series.",
    href: (slug) => `/o/${slug}/admin/events`,
    // docs/work-log/2026-08-26-events-model.md, Phase 3 / DECISION-115
    // ruling 4: `operate` (DECISION-113 ruling 7, DECISION-105's routine-work
    // test) — putting events on the calendar is day-to-day congregational
    // work, not org setup/governance.
    flagKey: "org_portal.events",
    category: "operate",
  },
  {
    key: "credentials",
    label: "Credentials",
    description:
      "Record ministry credential status changes and pastoral appointments.",
    href: (slug) => `/o/${slug}/admin/credentials`,
    // docs/work-log/2026-08-26-presbytery-functionality.md, Increment 2,
    // Phase 3 Component/Page Plan: "operate" (routine polity work,
    // DECISION-105's own test) — the same posture as officers/groups/events,
    // not org setup/governance.
    flagKey: "org_portal.credentials",
    category: "operate",
    // Bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md:
    // `credentials.manage` binds only to the presbytery-scoped `presbytery_
    // stated_clerk` template role (DECISION-112/116) — no congregation,
    // synod, or GA role can ever hold it. Without this the tile rendered on
    // every organization's portal home and nav row as a guaranteed dead end.
    // Allow-list, not `!== "congregation"` exclusion — synod/GA would
    // otherwise wrongly qualify.
    orgTypeScope: ["presbytery"],
  },
] as const;

/**
 * The tiles a viewer sees for one category at one organization — filtered by
 * category, then by `orgTypeScope` (if the tile declares one), then by flag,
 * nothing else. Order follows `PORTAL_TILES`'s declaration order, which the
 * tile grid renders as-is (no re-sorting at the render layer).
 *
 * FOUR CALLERS: `/o/<slug>/page.tsx` calls `visiblePortalTiles("operate",
 * organizationType)`, `/o/<slug>/admin/page.tsx` calls `visiblePortalTiles
 * ("administer", organizationType)`, and `portal-nav.tsx` and
 * `portal-footer.tsx` each call it with `"operate"` and the org type
 * threaded from `layout.tsx` — the footer was the caller a hand enumeration
 * missed and only `tsc` caught when this parameter became required
 * (2026-08-27 bug fix), which is exactly why it is required. There is no
 * unparameterized overload and no default category, and — bug fix, docs/
 * work-log/2026-08-27-credentials-tile-org-type.md — `organizationType` is
 * likewise REQUIRED, not defaulted. The failure modes are asymmetric: a
 * forgotten `organizationType` defaulting to "show everywhere" would
 * silently reopen the exact bug this parameter exists to close (the
 * presbytery-only Credentials tile rendering for every congregation); a
 * required parameter fails at `tsc` before it ships. An ungoverned call is
 * exactly the bug this signature makes impossible to write by accident
 * (Phase 3 design; org-type ruling per this bug fix's Phase 2 review).
 */
export async function visiblePortalTiles(
  category: PortalTileCategory,
  organizationType: OrganizationType,
): Promise<PortalTile[]> {
  const candidates = PORTAL_TILES.filter(
    (tile) =>
      tile.category === category &&
      (!tile.orgTypeScope || tile.orgTypeScope.includes(organizationType)),
  );
  const checks = await Promise.all(
    candidates.map(async (tile) => ({
      tile,
      enabled: await isFlagEnabled(tile.flagKey),
    })),
  );
  return checks.filter((c) => c.enabled).map((c) => c.tile);
}
