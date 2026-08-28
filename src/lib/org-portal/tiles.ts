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
 * member regardless of permission (Directory, Members, Officers); "administer"
 * tiles are setting up or governing this org rather than running it day to
 * day (Roles, Features, Branding, Tickets) and all gate their own
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
 *
 * `domain` (docs/work-log/2026-08-27-product-ia-scaffold.md, Phase 3,
 * DECISION-117) is a FOURTH, ORTHOGONAL routing question — "which labeled
 * section on the home page / admin hub does this tile render under" —
 * layered on top of `category`/`orgTypeScope`/`flagKey` the same way each of
 * those was layered on. REQUIRED (no `?`), unlike `orgTypeScope`: a future
 * tile that omits it fails at `tsc`, not silently at render time with an
 * unmapped-key fallback — the same discipline the `organizationType`
 * required-parameter bug fix already validated. Presentation-only, never a
 * gate (DECISION-003 reaffirmed): a tile's reachability is governed entirely
 * by `flagKey` + `orgTypeScope` + the destination's own permission check,
 * same as always. See `PortalDomain`'s own comment for the taxonomy and the
 * `"administration"` nav-exclusion rule.
 *
 * "Give feedback" was removed from this registry entirely (mid-design
 * operator correction, docs/work-log/2026-08-27-product-ia-scaffold.md
 * §6/DECISION-117) — it no longer has a tile, a nav entry, or a footer
 * entry. It re-surfaces as an avatar-menu item and the platform's reused
 * dismissible daily feedback-prompt card, both still gated by the unchanged
 * `org_portal.feedback` flag. `/o/<slug>/feedback` itself is untouched.
 */
export type PortalTileCategory = "operate" | "administer";

/**
 * The seven-domain taxonomy (DECISION-117) every `PortalTile` is bucketed
 * into for presentation — which labeled `<section>` it renders under on the
 * home page (`DomainTileSections`, commit 2) and the admin hub, and which
 * nav anchor entry it contributes to (`portal-nav.tsx`, commit 2). Closed
 * union, not a free string — a typo'd domain fails at `tsc`, not silently at
 * render time.
 *
 * `"administration"` is special: it exists ONLY to bucket
 * Roles/Features/Branding/Tickets on the admin hub's own domain grouping. It
 * is EXCLUDED from the persistent nav row's domain-anchor computation
 * (`portal-nav.tsx`, commit 2) — the nav's existing hardcoded
 * "Administration" entry (unchanged, points at `/o/<slug>/admin`) already
 * owns that concept, and a second, anchor-based "Administration" entry
 * pointing at `/o/<slug>#domain-administration` would collide on the
 * identical label with a different destination. No current tile actually
 * forces this collision (every `"administration"`-domain tile below is
 * `category: "administer"`, so it never reaches the nav's operate-only
 * computation anyway), but the exclusion is a standing rule for commit 2's
 * `portal-nav.tsx` to implement, not an accident of today's data — a future
 * operate-category tile must not be assigned `domain: "administration"`
 * without revisiting this.
 */
export type PortalDomain =
  | "people" // People & Membership
  | "worship" // Worship & Events
  | "giving" // Giving & Finance
  | "governance" // Governance & Courts
  | "reports" // Reports & Insights
  | "communications" // Communications
  | "administration"; // Administration

export const DOMAIN_LABELS: Record<PortalDomain, string> = {
  people: "People & Membership",
  worship: "Worship & Events",
  giving: "Giving & Finance",
  governance: "Governance & Courts",
  reports: "Reports & Insights",
  communications: "Communications",
  administration: "Administration",
};

export const DOMAIN_ORDER: readonly PortalDomain[] = [
  "people",
  "worship",
  "giving",
  "governance",
  "reports",
  "communications",
  "administration",
];

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
  /**
   * REQUIRED (bug fix docs/work-log/2026-08-27-product-ia-scaffold.md,
   * DECISION-117) — see `PortalDomain`'s own comment for the taxonomy and
   * the `"administration"` nav-exclusion rule. Presentation-only, never a
   * gate: which labeled section a tile renders under, nothing about whether
   * it is reachable.
   */
  domain: PortalDomain;
  /**
   * A FIFTH, ORTHOGONAL routing question, same rule as `category`/
   * `orgTypeScope`/`domain`: presentational only, never a gate — the
   * destination route itself still renders its own honest state regardless
   * of this field. `undefined`/`false` means "a real, working tool";
   * `true` means the tile's own `TileGrid` rendering should read as
   * aspirational-roadmap rather than equal-weight-with-the-live-tools next
   * to it (muted icon badge, a "Coming soon" pill instead of trailing
   * description text, no hover-lift). Added 2026-08-27 after a live
   * comparison against a real congregation's portal showed every stub tile
   * rendering with identical visual weight to Members/Directory/Events —
   * diluting the page and reading as "unfinished" rather than "a roadmap."
   * Do NOT infer this from the description string containing "Coming
   * soon." — that was the ad hoc, un-structured precedent this field
   * replaces; every tile that sets this MUST also drop "Coming soon." from
   * its own `description` (the pill now carries that meaning) so the two
   * never disagree.
   */
  comingSoon?: boolean;
}

export const PORTAL_TILES: readonly PortalTile[] = [
  {
    key: "members",
    label: "Members",
    description: "Add a person and record roll actions.",
    href: (slug) => `/o/${slug}/admin/members`,
    flagKey: "org_portal.members_create",
    category: "operate",
    domain: "people",
  },
  {
    key: "directory",
    label: "Directory",
    description: "Browse the directory.",
    href: (slug) => `/o/${slug}/directory`,
    flagKey: "org_portal.directory",
    category: "operate",
    domain: "people",
  },
  {
    key: "roles",
    label: "Roles",
    description: "Manage roles and permissions for this organization.",
    href: (slug) => `/o/${slug}/admin/roles`,
    flagKey: "org_portal.roles",
    category: "administer",
    domain: "administration",
  },
  {
    key: "officers",
    label: "Officers",
    description: "Record officer terms and view the session/diaconate roster.",
    href: (slug) => `/o/${slug}/admin/officers`,
    flagKey: "org_portal.officers",
    category: "operate",
    domain: "governance",
  },
  {
    key: "tickets",
    label: "Tickets",
    description: "File and track support tickets.",
    href: (slug) => `/o/${slug}/tickets`,
    flagKey: "org_portal.tickets",
    category: "administer",
    domain: "administration",
  },
  {
    key: "groups",
    label: "Groups",
    description: "Manage committees, small groups, choirs, and teams.",
    href: (slug) => `/o/${slug}/admin/groups`,
    flagKey: "org_portal.groups",
    category: "operate",
    // docs/work-log/2026-08-27-product-ia-scaffold.md, Phase 3: the
    // architect's Phase 2 taxonomy table left `groups` unassigned. Tech-lead
    // call — People & Membership, not Governance & Courts: committees, small
    // groups, choirs, and teams are day-to-day people-organizing, not
    // constitutional office (Governance & Courts is reserved for
    // officer/credential/committee-of-the-court structures).
    domain: "people",
  },
  {
    key: "staff",
    label: "Staff",
    description: "Record paid, non-ordained staff positions.",
    href: (slug) => `/o/${slug}/admin/staff`,
    // docs/work-log/2026-08-27-staff-and-personnel.md, Phase 3 Component/
    // Page Plan / DECISION-129: new flag, seeded off (DECISION-115's
    // no-optional-variant convention).
    flagKey: "org_portal.staff",
    // Recording who's on payroll is routine record-keeping, not org setup —
    // same DECISION-105 test "members"/"groups"/"officers" already passed.
    category: "operate",
    // People & Membership, not Governance & Courts — staff are not a
    // constitutional office structure (Phase 1 point 4: staff_positions is
    // deliberately orthogonal to the ordination/officer register), same
    // reasoning "groups" already used.
    domain: "people",
    // No orgTypeScope — universal, congregation AND presbytery both employ
    // staff (Phase 1 point 3, no polity asymmetry the way ordination/
    // appointments have).
  },
  {
    key: "features",
    label: "Features",
    description: "Turn optional portal features on or off for this organization.",
    href: (slug) => `/o/${slug}/admin/features`,
    flagKey: "org_portal.features",
    category: "administer",
    domain: "administration",
  },
  {
    key: "branding",
    label: "Branding",
    description: "Set your organization's colour, type pairing, and logo.",
    href: (slug) => `/o/${slug}/admin/branding`,
    flagKey: "org_portal.branding",
    category: "administer",
    domain: "administration",
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
    domain: "worship",
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
    domain: "governance",
    // Bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md:
    // `credentials.manage` binds only to the presbytery-scoped `presbytery_
    // stated_clerk` template role (DECISION-112/116) — no congregation,
    // synod, or GA role can ever hold it. Without this the tile rendered on
    // every organization's portal home and nav row as a guaranteed dead end.
    // Allow-list, not `!== "congregation"` exclusion — synod/GA would
    // otherwise wrongly qualify.
    orgTypeScope: ["presbytery"],
  },
  // ============================================================
  // PRODUCT-IA SCAFFOLD PLACEHOLDER TILES — docs/work-log/
  // 2026-08-27-product-ia-scaffold.md (Phase 3, DECISION-117). Each
  // `flagKey` is seeded ON (see scripts/seed.ts's own loud comment block)
  // ONLY because presby has no real congregation onboarded yet and the
  // operator wants the full roadmap visible in dev (Phase 1 Operator Answer
  // 4) — flip to OFF before any real congregation or presbytery is
  // onboarded (docs/TODO.md go-live gate).
  //
  // GRADUATED (2026-08-27): `oversight` and `reports` are no longer stubs —
  // real schema and full admin pages shipped the same day
  // (docs/work-log/2026-08-27-presbytery-oversight-statistics.md) — so
  // `comingSoon` is NOT set on either, and their descriptions no longer say
  // "Coming soon." They follow the ordinary seeded-off convention instead of
  // this block's dev-visibility carve-out; left here because they're still
  // presbytery-scoped Product-IA-Scaffold tiles, not because they're inert.
  // ============================================================
  {
    key: "giving",
    label: "Giving & Finance",
    description: "Fund accounting, giving records, and budgets.",
    href: (slug) => `/o/${slug}/admin/giving`,
    flagKey: "org_portal.giving",
    category: "operate",
    domain: "giving",
    comingSoon: true,
  },
  {
    key: "worship",
    label: "Worship & Service Planning",
    description: "Service templates, liturgical roles, and scheduling.",
    href: (slug) => `/o/${slug}/admin/worship`,
    flagKey: "org_portal.worship",
    category: "operate",
    domain: "worship",
    comingSoon: true,
  },
  {
    key: "committees",
    label: "Committees & Commissions",
    description:
      "Presbytery committees, commissions, and administrative-commission tracking.",
    href: (slug) => `/o/${slug}/admin/committees`,
    flagKey: "org_portal.committees",
    category: "operate",
    domain: "governance",
    orgTypeScope: ["presbytery"],
    comingSoon: true,
  },
  {
    key: "oversight",
    label: "Congregation Oversight",
    description: "A presbytery's downward read into its member congregations.",
    href: (slug) => `/o/${slug}/admin/oversight`,
    flagKey: "org_portal.oversight",
    category: "operate",
    domain: "governance",
    orgTypeScope: ["presbytery"],
  },
  {
    key: "reports",
    label: "Per-Capita, SASR & Imports",
    description:
      "Per-capita/SASR rollup and data-import housekeeping for a presbytery.",
    href: (slug) => `/o/${slug}/admin/reports`,
    flagKey: "org_portal.reports",
    // docs/work-log/2026-08-27-product-ia-scaffold.md, Phase 3: presbytery
    // back-office/compliance filing lives on the admin hub, not the home
    // page — deliberately `administer`, not `operate` (unlike `insights`,
    // which is universal and day-to-day). Do not conflate the two: this is
    // the load-bearing category/domain-orthogonality example named in Phase
    // 3's Edge Cases.
    category: "administer",
    domain: "reports",
    orgTypeScope: ["presbytery"],
  },
  {
    key: "insights",
    label: "Insights & Analytics",
    description: "Dashboards, trends, and per-capita/membership insights.",
    href: (slug) => `/o/${slug}/admin/insights`,
    flagKey: "org_portal.insights",
    category: "operate",
    domain: "reports",
    comingSoon: true,
  },
  {
    key: "communications",
    label: "Communications",
    description: "Announcements, newsletters, and messaging.",
    href: (slug) => `/o/${slug}/admin/communications`,
    flagKey: "org_portal.communications",
    category: "operate",
    domain: "communications",
    comingSoon: true,
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
