import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/lib/db/schema";
import { groupTypes } from "../src/lib/db/domain/groups";
import {
  ADMIN_ROLE,
  FEATURE_CATALOG,
  FEATURES,
  MEMBER_ROLE,
  SUPPORT_OPERATOR_ROLE,
} from "../src/lib/permissions";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in .env.local before running the seed.");
}
if (!process.env.PLATFORM_DATABASE_URL) {
  throw new Error(
    "Set PLATFORM_DATABASE_URL in .env.local before running the seed — " +
      "seedGroupTypes() needs the RLS-bypassing platform connection (see " +
      "its own comment for why).",
  );
}

const initialAdmins = (process.env.INITIAL_ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (initialAdmins.length === 0) {
  console.warn(
    "[seed] INITIAL_ADMIN_EMAILS is empty — the first sign-in won't auto-receive the admin role. " +
      "Set a comma-separated list in .env.local (e.g. you@example.com,teammate@example.com) before signing in.",
  );
} else {
  console.log(`[seed] Will auto-admin on first sign-in: ${initialAdmins.join(", ")}`);
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

// RLS-bypassing connection (presby_platform role), used ONLY by
// seedGroupTypes() below — group_types is a FORCE-RLS tenant table
// (drizzle/0009_presby_rls.sql) whose tenant_isolation policy is
// `organization_id = presby_current_org()`. A platform-wide template row has
// `organization_id IS NULL`, and NULL never equals anything under standard
// SQL equality — not even under a matching org context — so `db` (the plain
// presby_app connection every other seed function here correctly uses) can
// NEVER insert one; confirmed by running this script against a real database
// before this comment was written (see work-log Phase 4 Implementer Notes).
const platformSql = neon(process.env.PLATFORM_DATABASE_URL);
const platformDb = drizzle(platformSql, { schema });

async function seedRoles() {
  const defs = [
    { name: ADMIN_ROLE, displayName: "Admin", isSystem: true, sortOrder: 0 },
    {
      name: SUPPORT_OPERATOR_ROLE,
      displayName: "Support Operator",
      isSystem: true,
      sortOrder: 50,
    },
    { name: MEMBER_ROLE, displayName: "Member", isSystem: true, sortOrder: 100 },
  ];
  for (const r of defs) {
    await db.insert(schema.roles).values(r).onConflictDoNothing();
  }
  console.log("seeded roles");
}

async function seedFeatures() {
  for (const f of FEATURE_CATALOG) {
    await db.insert(schema.features).values(f).onConflictDoNothing();
  }
  console.log(`seeded ${FEATURE_CATALOG.length} features`);
}

async function seedFlags() {
  const defaults = [
    // demo.new_dashboard REMOVED (docs/work-log/
    // 2026-08-27-platform-home-and-portal.md, Phase 3): the teaching banner
    // it gated on /admin is retired — it never gated a real "new dashboard,"
    // and the codebase has since accumulated real isFlagEnabled() examples
    // (org_portal.*, this very pipeline's own platform.merged_home). Leaving
    // the row while deleting the banner would strand a dead flag whose own
    // description promises a UI that no longer exists.
    {
      key: "auth.local_login",
      // ON: credentials sign-in (email + password) is available. Seeded ON —
      // required for e2e global-setup (all three seeded users authenticate via
      // credentials). Turn OFF to make this deployment Google-OAuth-only;
      // authorize() rejects the credentials endpoint even if a POST is
      // crafted directly.
      description:
        "Enable email + password sign-in. OFF = OAuth-only; credentials endpoint is blocked.",
      enabled: true,
    },
    {
      key: "auth.require_2fa",
      // ON: effective twoFactorRequired = dbUser.twoFactorRequired AND this flag.
      // Seeded ON — required to keep the seeded MFA admin e2e test green (that
      // user has twoFactorRequired=true in DB; without this flag the proxy gate
      // does not fire). Turn OFF to globally disable forced 2FA regardless of
      // per-user column.
      description:
        "Org-level 2FA master switch. OFF = no user is TOTP-gated regardless of per-user column.",
      enabled: true,
    },
    {
      key: "ui.brand_theming",
      // ON: gates whether (org) actually EMITS a per-organization brand
      // (src/lib/brand/read-org-brand.ts) — never the /admin/organizations
      // write/preview path, which works regardless (DECISION-003: a flag
      // never gates a permission). Seeded ON — required for the e2e
      // visual-parity fixture (e2e-alpha carries a brand row; see
      // e2e/support/seed-orgs.ts) and matches this flag's own design intent
      // as a ROLLBACK lever: it starts on, and an operator turns it off if a
      // re-skin turns out unreadable for someone who cannot be seen in
      // advance. Turning it off does not touch any organization_brands row —
      // it is purely whether the per-org override is emitted.
      description:
        "Per-org brand emission in (org). OFF = every congregation renders the platform default regardless of what /admin/organizations has staged.",
      enabled: true,
    },
    {
      key: "org_portal.directory",
      // ON: /o/<slug>/directory is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (Phase 2, docs/work-log/2026-08-19-tenant-permissions-portal.md).
      // Never substitutes for directory.view: a member with the flag on and
      // no grant still sees the in-shell "you don't have permission" state,
      // not the directory itself (DECISION-003: a flag never gates a
      // permission). Seeded OFF — the first real tenant-content read ships
      // dark until Phase 4's ux-developer commit lands the page behind it.
      description:
        "Congregation directory page in (org). OFF = /o/<slug>/directory renders 'isn't available yet' regardless of the viewer's directory.view grant.",
      enabled: false,
    },
    {
      key: "org_portal.roles",
      // ON: /o/<slug>/admin/roles is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (Phase 3, docs/work-log/2026-08-19-tenant-administration.md).
      // Never substitutes for role_grants.manage: a stated clerk with the
      // flag on and no grant still sees the in-shell "you don't have
      // permission" state, not the roles page itself (DECISION-003: a flag
      // never gates a permission). Seeded OFF, same "ships dark until the
      // page lands" reasoning as org_portal.directory.
      description:
        "Tenant role-administration page in (org). OFF = /o/<slug>/admin/roles renders 'isn't available yet' regardless of the viewer's role_grants.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.home_v2",
      // ON: `/o/<slug>` renders the rebuilt portal home (greeting,
      // find-a-person, the "yours" zone, the flag-gated tile grid) instead
      // of `OrgPortalStub`. Checked bare, no DECISION-026 fail-open wrapper
      // — a toggle, not an auth path (Phase 3, docs/work-log/
      // 2026-08-24-portal-home-directory.md, Increment 1). Never
      // substitutes for any tile's own permission — the tile grid mirrors
      // each destination route's `hasFeature()`/`directory.view`-shaped
      // gate rather than duplicating it (DECISION-003). Seeded OFF: the
      // stub stays the regression floor until a later increment turns this
      // on; both branches coexist in page.tsx until then.
      description:
        "Portal home rebuild in (org). OFF = /o/<slug> renders the original P0 landing stub regardless of what the rebuilt home would otherwise show.",
      enabled: false,
    },
    {
      key: "org_portal.directory_v2",
      // ON: `/o/<slug>/directory` renders the search box + card grid
      // instead of today's flat `DirectoryList`. Checked bare, no
      // DECISION-026 fail-open wrapper — a toggle, not an auth path (Phase
      // 3, docs/work-log/2026-08-24-portal-home-directory.md, Increment 2).
      // Never substitutes for directory.view — the grid calls the same
      // `getDirectory()` permission check the flat list already makes
      // (DECISION-003). Seeded OFF: the flat list stays the regression
      // floor until this increment ships; both branches coexist in
      // directory/page.tsx until then.
      description:
        "Directory search + card-grid redesign in (org). OFF = /o/<slug>/directory renders today's flat member list regardless of search params in the URL.",
      enabled: false,
    },
    {
      key: "org_portal.tickets",
      // ON: /o/<slug>/tickets* AND /o/<slug>/feedback are reachable at all —
      // ONE flag gates both, deliberately (support-tickets pipeline, Phase
      // 3: "there is no product reason to ship the on-ramp without the
      // destination or vice versa, and a second flag would only invite the
      // two drifting out of sync"). Checked bare, no DECISION-026 fail-open
      // wrapper — a toggle, not an auth path. Never substitutes for
      // tickets.file: a role-holder with the flag on and no grant still
      // sees the in-shell "you don't have permission" state, not the
      // tickets page itself (DECISION-003). Seeded OFF, same "ships dark
      // until the page lands" reasoning as org_portal.directory/roles.
      description:
        "Support-ticket filing/triage and the congregation-feedback on-ramp in (org). OFF = /o/<slug>/tickets* and /o/<slug>/feedback render 'isn't turned on yet' regardless of the viewer's tickets.file grant.",
      enabled: false,
    },
    {
      key: "org_portal.chrome_v2",
      // ON: `GlobalNav`'s wordmark swaps to the organization's own `OrgMark`
      // (logo or initials) linking to `/o/<slug>` instead of the "presby"
      // link to `/`, AND the persistent portal-nav row (Home / Directory /
      // Administration / Tickets / Give feedback, flag-filtered) renders
      // below the header on every `/o/<slug>*` page. ONE flag for both,
      // deliberately — they are one visual unit and a rollback of one without
      // the other reads as half-finished chrome (docs/work-log/
      // 2026-08-25-portal-chrome.md, Phase 3). Checked bare, no DECISION-026
      // fail-open wrapper — a toggle, not an auth path. Never substitutes for
      // any tile's own permission — the nav row mirrors each destination
      // route's own gate the same way the home tile grid already does
      // (DECISION-003). Seeded OFF: flag-OFF is byte-identical to today's
      // header, the regression floor this pipeline pins with a test.
      description:
        "Org-identity header + persistent portal nav in (org). OFF = the header keeps the platform 'presby' wordmark and no nav row renders inside /o/<slug>.",
      enabled: false,
    },
    {
      key: "org_portal.chrome_v3",
      // ON: (1) directory/home card set (TileGrid, PersonCard, HouseholdCard,
      // DeaconCard) gets a `hover:shadow-md transition-shadow` lift and
      // TileGrid/PersonCard/HouseholdCard get inline lucide-react icons, AND
      // (2) a new `<PortalFooter>` (org contact info from
      // `organization_profiles`, a nav-link recap, a copyright line) renders
      // below `<main>` on every `/o/<slug>*` page. Bundled as ONE flag,
      // deliberately NOT extending the already-fully-live `org_portal.chrome_v2`
      // (docs/work-log/2026-08-26-portal-fpcw-directory-ux.md, Phase 1: "checked
      // live: chrome_v2 is enabled=true with no per-org exceptions — effectively
      // fully rolled out already") — this rework gets its own atomic rollback
      // boundary. Checked bare, no DECISION-026 fail-open wrapper — a toggle,
      // not an auth path. The footer's nav recap mirrors each destination
      // route's own gate the same way the tile grid and portal-nav row already
      // do (DECISION-003) — it adds no permission check of its own. Seeded
      // OFF: flag-OFF is byte-identical to today's card treatment/icons/footer
      // (i.e. no footer, plain cards), the regression floor this pipeline
      // pins with a test.
      description:
        "Card hover/icon treatment + portal footer in (org). OFF = cards keep today's plain styling and no <PortalFooter> renders below /o/<slug>*'s <main>.",
      enabled: false,
    },
    {
      key: "org_portal.feedback",
      // ON: /o/<slug>/feedback is reachable at all. Its own flag as of this
      // pipeline — it previously borrowed org_portal.tickets (support-tickets
      // pipeline's "ship the on-ramp with the destination" reasoning), which
      // was fine while the feedback tile was cosmetic (the home tile grid)
      // but became consequential once portal-nav promotes it to a persistent
      // header link (Phase 2 architect ruling, docs/work-log/
      // 2026-08-25-portal-chrome.md). org_portal.tickets keeps gating
      // /o/<slug>/tickets* alone. Checked bare, no DECISION-026 fail-open
      // wrapper — a toggle, not an auth path. Never substitutes for
      // tickets.file/whatever the feedback page's own grant is — the page
      // remains the sole authority (DECISION-003). Seeded OFF, same "ships
      // dark until the page lands" reasoning as its sibling org_portal.*
      // flags.
      description:
        "Congregation-feedback page in (org). OFF = /o/<slug>/feedback renders 'isn't turned on yet' regardless of the viewer's own grant.",
      enabled: false,
    },
    {
      key: "sites.public_render",
      // ON: the public /site/<slug> render path AND the ingest endpoint are
      // both live. Checked bare, no DECISION-026 fail-open wrapper — this is
      // not an auth path, and fail-closed-to-404 during a DB blip or an
      // operator-initiated rollback is the correct direction here (public-
      // sites pipeline, Phase 2/3). Gates BOTH the read path
      // ((public)/site/[slug]/{page,layout}.tsx and the asset route) and
      // ingest — a disabled feature rejects ingest too, not just hides the
      // read path, so an org's content can't go "live" behind a flag that
      // then flips on with stale-vs-fresh ambiguity. Does NOT gate
      // /admin/organizations' provisioning UI or /admin/sites — an operator
      // can provision and monitor sites while the public path stays off.
      // Seeded OFF, same "ships dark until the page lands" reasoning as
      // org_portal.directory/roles/tickets.
      description:
        "Public per-org website render + ingest. OFF = /site/<slug> 404s and ingest is rejected, regardless of organization_sites.status.",
      enabled: false,
    },
    {
      key: "org_portal.features",
      // ON: /o/<slug>/admin/features (the per-org feature-toggle admin
      // surface, DECISION-097) is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — a toggle, not an auth path
      // (docs/work-log/2026-08-25-member-management.md Deliverable A, Phase
      // 3). Never substitutes for org_features.manage: a stated clerk with
      // the flag on and no grant still sees the in-shell "you don't have
      // permission" state, not the features page itself (DECISION-003).
      // Seeded OFF, same "ships dark until the page lands" reasoning as
      // org_portal.directory/roles/tickets.
      description:
        "Per-org feature-toggle admin page in (org). OFF = /o/<slug>/admin/features renders 'isn't available yet' regardless of the viewer's org_features.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.members_create",
      // ON: /o/<slug>/admin/members* (create-person wizard + the pending
      // roll-action approve/deny worklist) is reachable at all — gated
      // ADDITIONALLY by the org-level org_portal.members_create toggle
      // (organization_feature_toggles), per DECISION-097's three-axis gate
      // order: this flag -> the org toggle of the same key -> the
      // people.manage/roll.propose/roll.approve permission checks
      // (docs/work-log/2026-08-25-member-management.md Deliverable B, Phase
      // 3). Checked bare, no DECISION-026 fail-open wrapper — a toggle, not
      // an auth path. Never substitutes for any of those permissions
      // (DECISION-003). Seeded OFF, same "ships dark until the page lands"
      // reasoning as its org_portal.* siblings.
      description:
        "Member-creation wizard + roll-action approval worklist in (org). OFF = /o/<slug>/admin/members* renders 'isn't turned on yet' regardless of the org toggle or the viewer's grants.",
      enabled: false,
    },
    {
      key: "org_portal.members_roll_action_edit",
      // ON (AND org_portal.members_create's flag+toggle pair, already
      // required to reach /admin/members/<id>/edit at all, both ALSO on):
      // `RecordRollActionForm` renders on the Edit-person screen, letting a
      // roll.propose holder record a roll action against an ALREADY-
      // EXISTING person, not just at creation time
      // (docs/work-log/2026-08-26-member-roll-on-edit.md). Checked bare, no
      // DECISION-026 fail-open wrapper — a toggle, not an auth path.
      // Deliberately a SEPARATE global flag from org_portal.members_create
      // rather than folded into it (Phase 3, DECISION-107) — `roll_actions`
      // is append-only, so this gives the platform an independent kill
      // switch for just the new mutation path without needing a second
      // per-org toggle (there is none — this rides org_portal.members_
      // create's existing organization_feature_toggles row). Never
      // substitutes for roll.propose, checked inside recordRollAction()
      // (DECISION-003). Seeded OFF, same "ships dark until the page lands"
      // reasoning as its org_portal.* siblings.
      description:
        "Record-a-roll-action section on the Edit-person screen in (org). OFF = only the create-person wizard can originate a roll action; the Edit screen shows no such section, regardless of the org toggle or the viewer's grants.",
      enabled: false,
    },
    {
      key: "ui.branded_signin",
      // ON: /signin renders the origin org's brand when reached via a live
      // public site's /o/<slug> callback. Checked bare, no DECISION-026
      // fail-open wrapper — this is a cosmetic toggle, not an auth path: the
      // fail direction here is the OPPOSITE of auth.local_login/
      // auth.require_2fa. isFlagEnabled()'s existing "false on missing row
      // or DB error" behavior is the SAFE default (falls to platform
      // chrome), so wrapping it would be reflexive, not correct (Phase 1/2,
      // docs/work-log/2026-08-24-branded-signin.md). Seeded OFF, same
      // "ships dark until the page lands" reasoning as org_portal.directory/
      // roles/tickets and sites.public_render.
      description:
        "ON: /signin renders the origin org's brand when reached via a live public site's /o/<slug> callback. OFF = /signin always renders platform-default chrome regardless of callbackUrl.",
      enabled: false,
    },
    {
      key: "org_portal.officers",
      // ON: /o/<slug>/admin/officers is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (docs/work-log/2026-08-26-groups-and-officers.md, Phase 3). Never
      // substitutes for officers.manage: a stated clerk with the flag on
      // and no grant still sees the in-shell "you don't have permission"
      // state, not the officers page itself (DECISION-003: a flag never
      // gates a permission). Seeded OFF, same "ships dark until the page
      // lands" reasoning as org_portal.directory/roles.
      description:
        "Officer-term administration page in (org). OFF = /o/<slug>/admin/officers renders 'isn't available yet' regardless of the viewer's officers.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.groups",
      // ON: /o/<slug>/admin/groups is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (docs/work-log/2026-08-26-groups-admin.md, Phase 3). Never
      // substitutes for groups.manage: a viewer with the flag on and no
      // grant still sees the in-page "you don't have permission" state, not
      // the groups page itself (DECISION-003: a flag never gates a
      // permission). Seeded OFF, same "ships dark until the page lands"
      // reasoning as org_portal.directory/roles/officers.
      description:
        "Committee/group administration page in (org). OFF = /o/<slug>/admin/groups renders 'isn't turned on yet' regardless of the viewer's groups.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.events",
      // ON: /o/<slug>/admin/events is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path,
      // same posture as org_portal.groups/officers (docs/work-log/
      // 2026-08-26-events-model.md, Phase 3 / DECISION-115 ruling 4). Never
      // substitutes for events.manage: a viewer with the flag on and no
      // grant still sees the in-page "you don't have permission" state, not
      // the events page itself (DECISION-003: a flag never gates a
      // permission). This is the standing PORTAL_TILES tile-registry
      // convention every entry opts into — orthogonal to, and not a reopening
      // of, DECISION-113's own "no feature-existence flag this increment"
      // ruling. Seeded OFF, same "ships dark until the page lands" reasoning
      // as org_portal.directory/roles/officers/groups.
      description:
        "Calendar-event administration page in (org). OFF = /o/<slug>/admin/events renders 'isn't turned on yet' regardless of the viewer's events.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.admin_hub",
      // ON: /o/<slug>/admin (the net-new Organization Administration hub
      // index) is reachable at all, and the persistent PortalNav row grows a
      // trailing "Administration" entry pointing at it. Checked bare, no
      // DECISION-026 fail-open wrapper — a toggle, not an auth path
      // (docs/work-log/2026-08-26-portal-reorg-and-modernization.md, Phase
      // 3). This is the SOLE reachability gate for the hub page and the nav
      // entry; it never substitutes for any destination tile's own flag or
      // permission — the hub shows every flag-enabled "administer" tile
      // regardless of the viewer's own grants, and each destination page
      // remains the sole authority on "may THIS person" (DECISION-003). Not
      // a `PORTAL_TILES` flagKey itself — the hub is a route, not a tile.
      // Seeded OFF, same "ships dark until the page lands" reasoning as its
      // org_portal.* siblings.
      description:
        "Organization Administration hub index in (org). OFF = /o/<slug>/admin renders 'isn't turned on yet' and the persistent nav shows no Administration entry, regardless of any individual admin tile's own flag or the viewer's grants.",
      enabled: false,
    },
    {
      key: "org_portal.branding",
      // ON: /o/<slug>/admin/branding (the tenant self-service brand editor —
      // seed colour, curated type pairing, optional logo, light-only toggle)
      // is reachable at all. Checked bare, no DECISION-026 fail-open wrapper
      // — a toggle, not an auth path (docs/work-log/
      // 2026-08-26-tenant-branding-permission.md, Phase 3). Never
      // substitutes for branding.manage: a brand_admin holder with the flag
      // off still sees "isn't available yet," not the editor (DECISION-003:
      // a flag never gates a permission). Seeded OFF, same "ships dark until
      // the page lands" reasoning as its org_portal.* siblings. The platform
      // admin's own /admin/organizations/[id] brand form is unaffected by
      // this flag — it stays live as an unconditional override regardless of
      // whether this flag or branding.manage exist for a given org.
      description:
        "Tenant self-service brand editor in (org). OFF = /o/<slug>/admin/branding renders 'isn't available yet' regardless of the viewer's branding.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.motion",
      // ON: the portal home's greeting band (`Greeting`, rendered only when
      // org_portal.home_v2 is already on) plays a one-time CSS mount
      // fade-in (`animate-in fade-in-0`, tw-animate-css) on load. Checked
      // bare, no DECISION-026 fail-open wrapper — a toggle, not an auth path
      // (docs/work-log/2026-08-26-portal-visual-modernization.md, Phase 3).
      // Gates ONLY the entrance animation, never the band's card/border
      // treatment itself — that renders unconditionally once
      // org_portal.home_v2 is on, flag or no flag (DECISION-003: a flag
      // never gates a permission, and here it doesn't even gate a whole
      // surface, just one animation layered on top of an always-rendered
      // one). `prefers-reduced-motion` still neutralizes the animation via
      // globals.css's existing tree-wide rule regardless of this flag's
      // state. Seeded OFF: rolled back independently of the rest of this
      // pipeline's unflagged color/type changes (DECISION-104).
      description:
        "Portal-home greeting band CSS mount fade-in. OFF = the band renders with no entrance animation (still its usual card/border treatment); ON = it fades in once on load, subject to prefers-reduced-motion.",
      enabled: false,
    },
    {
      key: "org_portal.sensitive_info",
      // ON: /o/<slug>/admin/members/<id>/edit/sensitive is reachable at
      // all — gated ADDITIONALLY by the org-level org_portal.sensitive_info
      // toggle (organization_feature_toggles), per DECISION-097's
      // three-axis gate order: this flag -> the org toggle of the same key
      // -> the pastoral_notes.manage/demographics.manage/medical.manage/
      // disabilities.manage permission checks inside
      // src/lib/person-sensitive.ts (docs/work-log/
      // 2026-08-26-member-sensitive-info.md, Phase 3/DECISION-108). A
      // DEDICATED flag, NOT reusing org_portal.members_create — that
      // flag's kill switch covers person/roll creation, a materially
      // different risk profile than leaking pastoral/medical/demographic
      // data to the wrong role. Checked bare, no DECISION-026 fail-open
      // wrapper — a toggle, not an auth path. Never substitutes for any of
      // the four permission checks (DECISION-003). Seeded OFF, same "ships
      // dark until the page lands" reasoning as its org_portal.* siblings.
      description:
        "Tiered sensitive-info sub-screen (pastoral notes, demographics, medical, disabilities) in (org). OFF = /o/<slug>/admin/members/<id>/edit/sensitive renders 'isn't turned on yet' regardless of the org toggle or the viewer's grants.",
      enabled: false,
    },
    {
      key: "org_portal.children_ministry",
      // ON: /o/<slug>/admin/members/children (the children's roster) and
      // /o/<slug>/admin/members/<id>/edit/guardians (guardian-link
      // management) are reachable at all. Checked BARE, no per-org
      // organization_feature_toggles row and no DECISION-026 fail-open
      // wrapper — a toggle, not an auth path (docs/work-log/
      // 2026-08-26-childrens-ministry.md, Phase 3): this is a brand-new
      // admin surface reachable only via the new `children.roster`
      // permission, the same shape as org_portal.officers/org_portal.groups
      // (a toggle, not an auth path, no per-org opt-in needed beyond the
      // flag itself) — NOT org_portal.members_create's toggle-composing
      // shape, which exists because that page shares surface with
      // people.manage more broadly. Never substitutes for children.roster: a
      // viewer with the flag on and no grant still sees MembersForbidden,
      // not the roster/guardians pages themselves (DECISION-003: a flag
      // never gates a permission). Seeded OFF, same "ships dark until the
      // page lands" reasoning as its org_portal.* siblings.
      description:
        "Children's roster + guardian-link management in (org). OFF = /o/<slug>/admin/members/children and .../edit/guardians render 'isn't turned on yet' regardless of the viewer's children.roster grant.",
      enabled: false,
    },
    {
      key: "org_portal.credentials",
      // ON: /o/<slug>/admin/credentials (ministry credentials & pastoral
      // appointments) is reachable at all. Checked bare, no DECISION-026
      // fail-open wrapper — a toggle, not an auth path (docs/work-log/
      // 2026-08-26-presbytery-functionality.md, Increment 2, mirroring
      // org_portal.officers's own block). Never substitutes for
      // credentials.manage: a stated clerk with the flag on and no grant
      // still sees the in-page "you don't have permission" state, not the
      // credentials page itself (DECISION-003: a flag never gates a
      // permission). Seeded OFF, same "ships dark until the page lands"
      // reasoning as its org_portal.* siblings.
      description:
        "Ministry credentials & pastoral appointments page in (org). OFF = /o/<slug>/admin/credentials renders 'isn't turned on yet' regardless of the viewer's credentials.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.oversight",
      // ON: /o/<slug>/admin/oversight (presbytery congregation-oversight —
      // viability, buildings/insurance) is reachable at all. Checked bare,
      // no DECISION-026 fail-open wrapper — a toggle, not an auth path.
      // GRADUATED OUT of the product-IA placeholder block below (docs/
      // work-log/2026-08-27-presbytery-program.md, Phase 3): Q1's
      // cross-org-RLS block dissolved by reframing (Phase 1) and this is
      // now a real feature (schema landed drizzle/0038_presby_presbytery_
      // program.sql) — same flag KEY reused verbatim per the "one durable
      // key across iterations" rule, its ComingSoon stub body replaced by
      // the real page under the SAME flag. Never substitutes for
      // congregation_oversight.manage. Seeded OFF, same "ships dark until
      // the page lands" reasoning as every other real org_portal.* flag —
      // flip manually in dev the same way org_portal.credentials is.
      description:
        "Presbytery congregation-oversight page in (org). OFF = /o/<slug>/admin/oversight renders 'isn't turned on yet' regardless of the viewer's congregation_oversight.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.reports",
      // ON: /o/<slug>/admin/reports (presbytery congregation statistics +
      // per-capita) is reachable at all. GRADUATED OUT of the placeholder
      // block below for the same reason as org_portal.oversight — the
      // publication mechanism (presby_publish_sasr_snapshot()) and its
      // schema landed in this same migration. Never substitutes for
      // statistics.manage/per_capita.manage. Seeded OFF.
      description:
        "Presbytery per-capita/SASR statistics page in (org). OFF = /o/<slug>/admin/reports renders 'isn't turned on yet' regardless of the viewer's statistics.manage/per_capita.manage grants.",
      enabled: false,
    },
    {
      key: "org_portal.insights",
      // ON: /o/<slug>/admin/insights (presbytery rollup dashboard) is
      // reachable at all. GRADUATED OUT of the placeholder block below —
      // Increment 4b builds the `presbytery` branch on top of this same
      // schema commit; every other org type keeps rendering ComingSoon
      // unchanged regardless of this flag. Seeded OFF.
      description:
        "Insights & analytics dashboards page in (org). OFF = /o/<slug>/admin/insights renders 'isn't turned on yet'. ON with the presbytery branch unbuilt = 'coming soon' stub for every non-presbytery org type.",
      enabled: false,
    },
    {
      key: "org_portal.statistical_publication",
      // ON: /o/<slug>/admin/statistics (the CONGREGATION-side annual
      // statistical publication page — Increment 4a) is reachable at all.
      // NEW flag, not a graduated placeholder — no existing scaffold stub
      // covers a congregation-scoped route (the three scaffold placeholders
      // above are all presbytery-only or universal-with-presbytery-only
      // content). Never substitutes for statistics.publish. Ships dark per
      // Operator Answer 2 (publication ships against seeded fixtures ahead
      // of real congregation onboarding) — seeded OFF.
      description:
        "Congregation annual statistical publication page in (org). OFF = /o/<slug>/admin/statistics renders 'isn't turned on yet' regardless of the viewer's statistics.publish grant.",
      enabled: false,
    },
    {
      key: "org_portal.feature_categories",
      // DUAL PURPOSE (docs/work-log/2026-08-27-feature-categories.md, Phase
      // 3; DECISION-130) — not merely a page-visibility toggle:
      //   1. UI GATE: the "Ministry areas" category-picker section on
      //      /o/<slug>/admin/features renders only when this flag is on;
      //      off, the page looks exactly as it does today (the existing
      //      per-feature toggle list, unchanged).
      //   2. AXIS KILL-SWITCH: isOrgFeatureEnabled()'s composition
      //      (src/lib/org-features.ts) only consults the fourth, coarser
      //      category axis (organization_feature_categories,
      //      src/lib/org-feature-categories.ts) when this flag is on. Off,
      //      the whole axis is inert — every category resolves enabled, no
      //      row read even fires — not merely "flag off, page hidden," so
      //      disabling this is a TRUE rollback of the mechanism, not a
      //      partial one. Checked bare, no DECISION-026 fail-open wrapper —
      //      a toggle, not an auth path. Never substitutes for
      //      org_features.manage (DECISION-003). Seeded OFF, same "ships
      //      dark until the page lands" reasoning as its org_portal.*
      //      siblings.
      description:
        "Org-chosen ministry-category gating (the fourth, coarser axis above the per-feature toggle) in (org). OFF = /o/<slug>/admin/features renders no category-picker section, and isOrgFeatureEnabled()'s composition never consults the category axis at all (every category resolves enabled).",
      enabled: false,
    },
    {
      key: "org_portal.staff",
      // ON: /o/<slug>/admin/staff (the paid, non-ordained staff-position
      // roster/history/add/end surface) is reachable at all — docs/work-log/
      // 2026-08-27-staff-and-personnel.md, Phase 3 Component/Page Plan;
      // DECISION-129. Portal-tile visibility only (DECISION-003 — never
      // substitutes for staff.manage, which the destination route itself
      // checks). Universal — no org-type restriction; both congregations and
      // presbyteries employ staff (Phase 1 point 3). Seeded OFF, same "ships
      // dark until the page lands" reasoning as its org_portal.* siblings
      // (org_portal.officers/groups/events).
      description:
        "Staff and personnel admin page in (org). OFF = /o/<slug>/admin/staff renders 'isn't turned on yet' regardless of the viewer's staff.manage grant.",
      enabled: false,
    },
    {
      key: "platform.merged_home",
      // ON: /home renders the merged post-chooser landing content — "Your
      // organizations" (enterable org cards), "Platform" (Admin card iff
      // canAccessAdmin, Developer card iff isPlatformAdmin, independently —
      // DECISION-044), and "Still being set up" (pending invited orgs) —
      // above the pre-existing quick-links/what's-new/feedback content
      // (docs/work-log/2026-08-27-platform-home-and-portal.md, Phase 3,
      // DECISION-124). REQUIRED, not optional — its blast radius is every
      // authenticated sign-in through /launch's chooser reason, which now
      // computes "/home" unconditionally (the flag was deliberately never
      // threaded into computeDestination; see destination.ts's own header
      // comment). Checked bare, no DECISION-026 fail-open wrapper — a
      // content toggle, not an auth path: OFF is a full, correct fallback
      // (/home's exact pre-merge shape), not a denial. Seeded ON — this is a
      // live-ship, not a dark launch; disabling it in an incident is a
      // content-only rollback, not a routing change (/orgs itself no longer
      // exists as a page — it is a next.config.ts permanent redirect to
      // /home regardless of this flag's value).
      description:
        "Merged post-chooser landing content on /home. OFF = /home renders exactly its pre-merge shape (greeting, Account settings + Admin dashboard quick links, what's-new, feedback) regardless of the viewer's organizations or platform access.",
      enabled: true,
    },
    // ============================================================
    // PRODUCT-IA SCAFFOLD PLACEHOLDER FLAGS — SEEDED ON, TEMPORARILY.
    // docs/work-log/2026-08-27-product-ia-scaffold.md (DECISION-117).
    // Every flag below gates an inert "coming soon" stub — zero data reads,
    // zero mutations (see coming-soon.tsx). Seeded ON *only* because presby
    // has no real congregation on it yet and the operator wants the full
    // roadmap visible in dev (Phase 1 Operator Answer 4, a deliberate,
    // documented deviation from this codebase's usual "ships dark until the
    // page lands" default).
    //
    // *** GO-LIVE GATE: BEFORE THE FIRST REAL CONGREGATION OR PRESBYTERY IS
    // ONBOARDED, FLIP EVERY FLAG IN THIS BLOCK TO `enabled: false`. *** The
    // go-live task SHRANK BY THREE (docs/work-log/2026-08-27-presbytery-
    // program.md, Phase 3): org_portal.oversight/.reports/.insights
    // graduated out of this block above — real features now sit behind
    // them, so they follow the ordinary "seeded off" convention instead of
    // waiting for the go-live sweep. Four flags remain in this block, not
    // seven.
    // Tracked in docs/TODO.md ("Go-live: flip placeholder flags off," same
    // commit). Do NOT remove a flag key when its real feature ships — flip
    // it deliberately at that point and delete its entry from this block
    // (the "one durable key across iterations" rule org_portal.home_v2/
    // directory_v2 already established).
    // ============================================================
    {
      key: "org_portal.giving",
      description:
        "Giving & fund-accounting placeholder area in (org). OFF = /o/<slug>/admin/giving renders 'isn't turned on yet'. ON with no feature built = 'coming soon' stub, not a working ledger.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.worship",
      description:
        "Worship & service-planning placeholder area in (org). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.committees",
      description:
        "Presbytery committees & commissions placeholder area in (org). Presbytery-scoped tile (orgTypeScope). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.communications",
      description:
        "Communications placeholder area in (org). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
  ];
  for (const f of defaults) {
    await db.insert(schema.featureFlags).values(f).onConflictDoNothing();
  }
  console.log(`seeded ${defaults.length} feature flags`);
}

/**
 * Platform-wide `group_types` templates (`organization_id IS NULL`) — the two
 * this codebase's own F16 group-seeding needs: `court` (Session, Board of
 * Deacons) and `roster` (Active Membership), plus the four manageable types
 * `/o/<slug>/admin/groups` lets an admin create (`committee`/`small_group`/
 * `choir`/`team` — docs/work-log/2026-08-26-groups-admin.md, DECISION-110
 * ruling 1). The latter four were deliberately NOT seeded before that
 * pipeline (docs/work-log/2026-08-24-admin-org-create.md Phase 2/3): no admin
 * surface created a `committee`-type group yet, so nothing in presby needed
 * those rows in a production-reachable seed path at the time.
 *
 * Without this, `createOrganization()` (src/lib/org-provisioning.ts) cannot
 * function against a real database at all — it fails closed with
 * `{ kind: "provisioning_incomplete" }` rather than create an org with no
 * derived groups. This is a ONE-TIME PLATFORM BOOTSTRAP: run `npm run
 * db:seed` once against a target database before the first
 * createOrganization() call there, not on every deploy.
 *
 * NOT `.onConflictDoNothing()` (the design doc's literal suggestion, matching
 * the `roles`/`features` pattern elsewhere in this file) — `group_types` has
 * NO unique constraint on `(organization_id, key)`, only a non-unique index
 * (`group_types_org_idx`). `id` is the sole unique column and is always a
 * fresh `defaultRandom()` UUID, so `ON CONFLICT DO NOTHING` would never
 * actually fire and re-running this script would insert a second `court`/
 * `roster` row every time. Explicit find-or-create instead, confirmed
 * idempotent by running twice against the dev database (see work-log Phase 4
 * Implementer Notes).
 */
async function seedGroupTypes() {
  const defs = [
    { key: "court", name: "Court" },
    { key: "roster", name: "Roster" },
    // Added for the groups-admin pipeline (docs/work-log/2026-08-26-groups-
    // admin.md, DECISION-110 ruling 1): the four manageable group types a
    // fresh install previously had no platform-wide template row for at
    // all — createGroup() (src/lib/groups.ts) resolves group_type_id against
    // exactly these four keys, and without this seed a new install has
    // nothing to reference.
    { key: "committee", name: "Committee" },
    { key: "small_group", name: "Small Group" },
    { key: "choir", name: "Choir" },
    { key: "team", name: "Team" },
  ];
  for (const g of defs) {
    // Both the read and the write use platformDb, not db — group_types is a
    // FORCE-RLS tenant table (see this function's own header comment). db
    // (presby_app, no org context) would see ZERO rows for a null-org-id
    // template even if one already exists, fail-closed by construction, and
    // would then fail the INSERT with a real RLS violation.
    const [existing] = await platformDb
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(and(isNull(groupTypes.organizationId), eq(groupTypes.key, g.key)))
      .limit(1);
    if (!existing) {
      await platformDb
        .insert(groupTypes)
        .values({ organizationId: null, key: g.key, name: g.name });
    }
  }
  console.log(`seeded ${defs.length} platform-wide group_types`);
}

async function bindAdminFeatures() {
  const admin = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (!admin) return;
  for (const key of Object.values(FEATURES)) {
    await db
      .insert(schema.roleFeatures)
      .values({ roleId: admin.id, featureKey: key })
      .onConflictDoNothing();
  }
  console.log("bound all features to admin");
}

async function bindSupportOperatorFeatures() {
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.name, SUPPORT_OPERATOR_ROLE),
  });
  if (!role) return;
  // ADMIN_DASHBOARD (docs/work-log/2026-08-27-platform-home-and-portal.md,
  // Phase 3, DECISION-123): a data-seed fix, not a new key or schema change.
  // Previously support_operator held ADMIN_TICKETS/ADMIN_FEEDBACK only,
  // which — because ADMIN_DASHBOARD is the platform axis's single "door"
  // feature (src/proxy.ts's catch-all PROTECTION_RULES entry) — left this
  // role bounced to /access-pending on /admin, /admin/tickets, and
  // /admin/feedback alike, before any RSC-level hasFeature() check ever
  // ran. This is what makes "a support_operator-features session sees
  // exactly two tiles" verifiable in a browser at all.
  for (const key of [
    FEATURES.ADMIN_DASHBOARD,
    FEATURES.ADMIN_TICKETS,
    FEATURES.ADMIN_FEEDBACK,
  ]) {
    await db
      .insert(schema.roleFeatures)
      .values({ roleId: role.id, featureKey: key })
      .onConflictDoNothing();
  }
  console.log("bound dashboard + tickets + feedback features to support_operator");
}

async function seedLocalAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping local admin seed. " +
        "Set both in .env.local to provision a credentials-login admin for testing.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  // Upsert the user. Password updates on each run so you can rotate it via
  // .env.local without manual DB surgery.
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    // Rotate the password and reactivate, but do NOT silently flip
    // `twoFactorRequired` back to false — a fork that enabled 2FA on this
    // user wants to keep it on across reseeds.
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local Admin",
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local admin: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local Admin",
        password: hash,
        emailVerified: new Date(),
        // Disabled on initial seed so /admin loads in one click for testing.
        // Flip to `true` (or omit) once you've enrolled in 2FA.
        twoFactorRequired: false,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local admin: ${email}`);
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (adminRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: adminRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local admin to admin role");
  }
}

async function seedMemberUser() {
  const email = (process.env.SEED_MEMBER_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_MEMBER_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_MEMBER_EMAIL / SEED_MEMBER_PASSWORD not set — skipping member seed. " +
        "Set both in .env.local to provision a credentials-login member for e2e testing.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local Member",
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local member: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local Member",
        password: hash,
        emailVerified: new Date(),
        twoFactorRequired: false,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local member: ${email}`);
  }

  const memberRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, MEMBER_ROLE),
  });
  if (memberRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: memberRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local member to member role");
  }
}

async function seedMfaAdminUser() {
  const email = (process.env.SEED_MFA_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_MFA_ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_MFA_ADMIN_EMAIL / SEED_MFA_ADMIN_PASSWORD not set — skipping MFA admin seed. " +
        "Set both in .env.local to provision a 2FA-gated admin for e2e routing tests.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local MFA Admin",
        // Preserve twoFactorRequired=true on re-seed — do not flip it back.
        twoFactorRequired: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local MFA admin: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local MFA Admin",
        password: hash,
        emailVerified: new Date(),
        // twoFactorRequired=true so proxy gates /admin routes behind TOTP.
        // No TOTP enrollment record is created — the e2e test only asserts the
        // redirect to /totp fires, not that the full challenge can be completed.
        twoFactorRequired: true,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local MFA admin: ${email}`);
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (adminRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: adminRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local MFA admin to admin role");
  }
}

async function main() {
  await seedRoles();
  await seedFeatures();
  await seedFlags();
  await seedGroupTypes();
  await bindAdminFeatures();
  await bindSupportOperatorFeatures();
  await seedLocalAdmin();
  await seedMemberUser();
  await seedMfaAdminUser();
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
