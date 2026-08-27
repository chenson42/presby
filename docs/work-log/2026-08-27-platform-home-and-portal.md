# Platform home page, merged post-login landing, and the platform portal — Work Log

> **Slug:** `2026-08-27-platform-home-and-portal`
> **Surface:** mixed — public `/` landing, post-login landing (currently /home + /orgs), and the (admin) shell redesign
> **Permission(s):** TBD — likely existing FEATURES.* only; the conditional experience routes on existing predicates
> **Flag(s):** TBD by Phase 1/3
> **Estimated complexity:** large — touches the post-login routing matrix and three surfaces
> **Pipeline mode:** Full
> **Source:** operator request, 2026-08-27 — "we need a presby home page that describes the platform. after you are logged in there are two awkward pages that really need to be merged. not sure how. platform admin page can be redesigned to use the same sorta design as the org portal. it is basically the platform portal. if you belong to an organization and have no other platform permissions then maybe you only see your organization. if you have platform permissions then you see the functionality you have access to."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-27 |
| 4 — Implementation | ux-developer (commit 1: admin portal) → full-stack-developer (commit 2: merged /home + redirect) → ux-developer (commit 3: marketing / redesign) | Complete — all three commits landed, 2973 tests green | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Three surfaces, one real behavior change to land: `/home` absorbs `/orgs`'s cards under the *unchanged* `/launch` fast-paths, `/admin` gets an org-portal-style domain tile grid but gates tiles by *held permission* (not a flag — a deliberate divergence from the org-portal precedent), and `/` gets a longer, honest description of a platform that still has no name.

## User Verbs (by class)

Anonymous: reads `/`, clicks Sign in (signed-in visitors see Continue — DECISION-034 unchanged). One-org member, no platform access: lands directly in `/o/<slug>`, never sees a landing shell (recommended Reading A). Multi-org member: lands on merged `/home` — org cards + what's-new + feedback prompt. canAccessAdmin/isPlatformAdmin holders: merged `/home` with org cards + Admin card (iff canAccessAdmin) + Developer card (iff isPlatformAdmin, independent). Admin in `/admin`: sees only the domain sections/tiles matching FEATURES they hold. Platform admin 0 orgs: existing fast path unchanged. Deactivated: bounced at proxy, untouched. Wordmark click mid-session → `/home` same merged content.

## Flows

1. **`/` product description:** no form, no DB read; signed-in sees same page + Continue (DECISION-034). Constraint: the project is unnamed — "presby" is the standing placeholder, safe to keep; expanded copy must not imply a chosen name.
2. **Merged landing (chooser case):** /launch "chooser" → `/home` (was /orgs): org cards (DECISION-039: name+type only) + Platform block + what's-new + feedback prompt. Org-list failure keeps /orgs's existing OrganizationsUnavailable degrade.
3. **Single-org fast path:** recommended unchanged (straight to /o/<slug>) — the literal reading of the operator's words; alternative Reading B in Open Questions.
4. **Platform portal `/admin`:** Edge admits on canAccessAdmin (unchanged); page renders domain-sectioned tiles, one per FEATURES.* key held. Direct URLs to unheld pages still hit those pages' existing hasFeature() denials (all seven verified self-gating today). **This fixes a real present defect: admin/page.tsx currently advertises all ten cards to every ADMIN_DASHBOARD holder — a support_operator (ADMIN_TICKETS+ADMIN_FEEDBACK only, DECISION-080) gets denied on eight of them today.**
5. **/orgs bookmark:** permanent redirect → /home; no loading.tsx on the redirecting segment.

## Permissions & Flags

- No new FEATURES.* key. Existing catalog + the two DECISION-044 predicates, meanings unchanged.
- **Ruling for the architect (stated, not assumed): platform tiles gate by hide-if-not-held (`hasFeature`)** — a deliberate divergence from PORTAL_TILES's flag-then-destination-authority split. Justified: (1) the operator's words are a visibility statement; (2) every destination already self-checks hasFeature() (verified), so hiding tiles adds no new authorization surface. A rollout flag (whether the new layout is live at all) stays orthogonal per DECISION-003.
- Recommended (optional) rollout flags: `platform.merged_home` and `admin.tile_grid`, each dark-shippable independently (home_v2 precedent). Tech-lead may skip for a change this contained.

## Gaps

- **The single-org fast path's fate is the load-bearing ambiguity** (Reading A vs B — operator fork).
- `/admin/design-system` has no FEATURES key at all — needs a decision (new key / always-visible meta tile / dropped).
- **Developer must NOT become a tile inside /admin** — isPlatformAdmin ≠ canAccessAdmin (DECISION-044); an isPlatformAdmin-only user can't reach /admin's shell. Developer stays its own /home card. Invariant-class, for the architect.
- Edge vs RSC enforcement inconsistency (only users/flags/docs have PROTECTION_RULES entries; seven pages rely on RSC self-checks + the broad Edge gate) — pre-existing, no hole confirmed, TODO candidate, not this feature's fix.
- `demo.new_dashboard` example banner's fate on the redesigned page — unaddressed.
- Stale /orgs links (no-organization/page.tsx "You already have access", nav, tests) need updating with the redirect.

## Out of Scope (confirm)

Marketing polish on `/` (assumed functional description, not a marketing site; P2's public org-search stays separate); naming the project; fixing the Edge/RSC inconsistency; changes to /no-organization and /access-pending beyond the stale link.

## Open Questions (operator)

1. Single-org fast path: Reading A (keep — never see the merged page; recommended) vs Reading B (merged page with just their card).
2. Survivor URL: /home (recommended — carries the platform-shell identity) vs /orgs vs a third.
3. Hide-if-not-held ratification (architect fork, argued above).
4. How much does `/` say — tight functional description (assumed) vs marketing-page ambition?
5. /admin/design-system's gate.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |

## Operator Answers (2026-08-27, recorded by the orchestrator)

1. **Single-org fast path: Reading A** — a one-org, no-platform-access member lands straight in /o/<slug> and never sees the merged page. The /launch matrix's fast paths stay exactly as shipped.
2. **Survivor URL: /home** — /orgs becomes a permanent redirect.
3. **Public `/`: functional description** — what presby is, who it serves, pre-release honesty, sign-in CTA; no marketing theater; expandable later.
4. **/admin/design-system: dropped from the tile grid** — stays reachable by URL, candidate to relocate under /developer later.

**Handoff:** architect (Phase 2) — must rule on (1) hide-if-not-held for the platform axis and (2) Developer-card independence from /admin (DECISION-044-class). Operator forks 1/2/4/5 route back before Phase 3 locks the design; they don't block Phase 2.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions** (operator answers 1/2/4/5 already recorded; this rules the reserved items)

## 1. Hide-if-not-held — RATIFIED, with the real justification

PORTAL_TILES is flag-only because a tenant permission check is a per-org in-transaction DB read the registry is designed to avoid (its own header: never grow a second permission check). The platform axis has no such cost: `FEATURES.*` is already ON the session — `hasFeature()` is a synchronous array read, and every /admin destination independently re-checks the identical call. Hiding a tile adds no authorization surface and produces LESS enumeration than today (the current page advertises the full admin surface to every ADMIN_DASHBOARD holder — the present defect). DECISION-003 preserved: the flag question stays orthogonal. **Phase 3 constraint: the registry stays a pure synchronous data module — no hasFeature()/session/query inside it; filtering happens once at the page.**

## 2. Developer-card independence — RATIFIED, invariant-class

/developer never nests in /admin (an isPlatformAdmin-only holder is not admitted to /admin by the Edge — DECISION-044's exact trap). Developer stays a /home card gated on the LIVE read via `cachedIsPlatformAdmin()` from nav-data (the memoized reader — GlobalNav already reads it; an unmemoized call doubles the query). Two independent card conditions, never one showPlatform boolean.

## 3. Registry shape

- **`src/lib/admin-portal/tiles.ts`** (mirrors org-portal naming; "platform-portal" rejected — overloaded term). New `AdminTile` type (key/label/description/plain href/requiredFeature/domain) — PORTAL_TILES types NOT reused across the axis (orgTypeScope and the seven-domain union have no platform analogue).
- **Genericize `DomainTileSections`/`TileGrid` into `src/components/shared/`** (both verified purely presentational), parameterized over tile shape + a domain/labels/order triple passed as props; each axis keeps its own tiles.ts. Also fixes today's admin/page.tsx hand-rolled `<Link className="rounded-lg...">` (a latent Component-Rule-5 violation) by routing through Button variant="tile".
- **Domain taxonomy (3, not 4):** People & Access (Users & roles, 2FA policy) · Platform Operations (Organizations, Flags, Audit, Email queue) · Content & Communications (Release notes, What's new, Feedback, **Tickets — FEATURES.ADMIN_TICKETS has NO tile today, a second present defect to fix in this pass**). No Developer-adjacent domain (design-system dropped per operator answer; would be a one-item non-gated domain).

## 4. Merge mechanics

- Both pages are (member); merged /home keeps the no-2FA posture; org cards confirmed public-tree data (name+type, DECISION-039) — the renders-no-tenant-data contract survives.
- **/orgs → /home via next.config.ts `redirects()` (permanent 308)** — never enters the React pipeline, no Suspense to accidentally open; delete the /orgs segment entirely; **relocate destination-card.tsx to src/components/shared/** (it's the card /home needs, already generic).
- destination.ts: one literal changes (chooser → /home); fast paths untouched (Reading A recorded); Reading B verified to remain a matrix-only change at zero structural cost.

## 5. Public `/`

Stays src/app/page.tsx, server-only, no deps; DECISION-034's signed-in Continue pattern kept; P5 not foreclosed (host-awareness lives at the Edge when it lands); copy must not imply a chosen name (the existing "presby" placeholder discipline).

## 6. Rollout flags — one required, one optional, namespace ruled

- **`platform.merged_home`: REQUIRED, not optional** — blast radius is every authenticated sign-in through /launch; a flag that can fall back the redirect target without redeploy is cheap insurance (home_v2 precedent class).
- `platform.admin_tile_grid`: optional (admin population only; every /admin/* page stays URL-reachable) — tech-lead's call.
- **Namespace ruling: `platform.*` for both, never `admin.*`** — FEATURES already owns the `admin.` dotted prefix as permission keys; a flag sharing it is the DECISION-003 ambiguity in miniature. First platform.* flags in the catalog.

## 7. Dependencies

None. No api-developer needed anywhere (no schema, no route handler, no server action).

## Invariants

DECISION-003/034/039/044 all respected as detailed; check:brand-scope unaffected; the redesign FIXES the latent Component-Rule-5 violation.

## Notes for Phase 3

(1) registry synchronous/data-only; (2) genericize shared components; (3) config-level redirect + delete /orgs segment + relocate destination-card; (4) fix both present defects (all-ten-cards; missing Tickets tile); (5) stale /orgs refs: no-organization/page.tsx:73, org-switcher.tsx:167/171 + comment, proxy.test.ts, destination.test.ts; (6) flag names platform.merged_home / platform.admin_tile_grid; (7) demo.new_dashboard banner's fate = tech-lead's call.

## Implementer split (3 commits)

1. admin-portal/tiles.ts + genericized shared components + /admin redesign — ux-developer.
2. Merged /home + config redirect + destination.ts one-liner + stale-link cleanup — full-stack-developer (or ux; tech-lead picks).
3. `/` copy expansion — ux-developer, foldable.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |

**Handoff:** tech-lead (Phase 3) — AdminTile/taxonomy finalization, the generic component signature, platform.merged_home's exact gating point, the two defect fixes, the three-commit order.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Three surfaces converge on one shape: a synchronous, hide-if-not-held tile
registry pattern, generalized so the platform axis (`/admin`) can reuse the
exact presentational machinery the org-portal axis already built. `/orgs` is
retired to a permanent config-level redirect and its content absorbed into
`/home`, which becomes the single post-chooser landing surface for every
authenticated sign-in that isn't a Reading-A fast path. `/admin`'s tile grid
is rebuilt on a new `src/lib/admin-portal/tiles.ts` registry filtered once, at
the page, by `hasFeature()` — fixing the two named present defects
(all-ten-cards-shown; the missing Tickets tile) — and, in the course of
verifying that fix is even reachable, this design surfaces and fixes a third,
previously-unrecognized defect: `support_operator` cannot reach `/admin` at
all today (see Edge Cases). `/` gets an expanded, still-honest functional
description. No schema changes; no api-developer.

## Permissions & Flags

- **No new `FEATURES.*` key.** `platform.tickets` reuses the already-cataloged
  `FEATURES.ADMIN_TICKETS` (`admin.tickets`) for its new tile — the key exists
  in `FEATURE_CATALOG` today and already gates `/admin/tickets` at the RSC
  layer; it has simply never had a tile.
- **`FEATURES.ADMIN_DASHBOARD` is formalized as the platform axis's single
  "door" feature.** Every other `admin.*` key gates which tile/page is visible
  *once inside* `/admin`; `ADMIN_DASHBOARD` alone gates whether `/admin` admits
  you at all (this is already how `src/proxy.ts`'s catch-all `PROTECTION_RULES`
  entry works — see Edge Cases for why this must be stated explicitly now).
- **Seed fix, not a new key:** `bindSupportOperatorFeatures()`
  (`scripts/seed.ts`) additionally binds `FEATURES.ADMIN_DASHBOARD` to
  `support_operator`, alongside its existing `ADMIN_TICKETS`/`ADMIN_FEEDBACK`.
  This is a **data** binding, not a schema or `FEATURE_CATALOG` change — no
  `db:push`, just `npm run db:seed` in dev and the equivalent for whichever
  environment owns this row in production. Required for the acceptance
  criterion "a `support_operator`-features session sees exactly two tiles" to
  be reachable at all (see Edge Cases — this was not previously true).
- **`platform.merged_home` — REQUIRED** (architect's ruling). Seeded
  **`enabled: true`** — this is a live-ship, not a dark-launch: it gates ONLY
  `/home`'s own rendering of the new "Your organizations" + "Platform"
  sections, never the routing target (see Component/Page Plan and Edge Cases
  for why the flag cannot usefully live in `destination.ts`). Disabling it in
  an incident is a content-only rollback: `/home` reverts to exactly its
  pre-merge shape (greeting, Account settings quick link, what's-new,
  feedback prompt) while remaining the correct landing page.
- **`platform.admin_tile_grid` — DECIDED OUT.** Not implemented. Rationale:
  (1) the redesign is strictly corrective (fixes over-exposure, adds a missing
  tile) rather than new risky behavior; (2) every `/admin/*` destination
  independently re-checks its own `hasFeature()` regardless of what the hub
  renders, so a rendering bug in the hub has zero authorization blast radius —
  worst case is a wrong or missing link, fixed by editing
  `src/lib/admin-portal/tiles.ts` and redeploying, not a DB-blip class of
  failure that needs an instant kill switch; (3) the population is
  platform-internal and small. Contrast with `platform.merged_home`, whose
  blast radius is every authenticated sign-in through `/launch` — that
  asymmetry is exactly why one flag is required and the other isn't. Fine to
  skip for a change this contained; revisit if a future `/admin` overhaul
  ships a materially riskier visual change to a materially larger admin
  population.

## API Contract

No new routes, no server actions. The only executable-signature change in the
whole pipeline is a return-value literal inside a pure function:

- `computeDestination(input: DestinationInput): Destination` — **unchanged
  signature.** The `"chooser"` branches' returned `path` changes from the
  literal `"/orgs"` to the literal `"/home"`. No new field on `DestinationInput`
  (see Component/Page Plan §4 for why `platform.merged_home` does not need to
  be threaded through this function at all).

## Data Model

No schema changes required. One data-seed change: `support_operator`'s feature
bindings in `scripts/seed.ts` gain `FEATURES.ADMIN_DASHBOARD` (see Permissions
& Flags above).

## Component / Page Plan

### 1. The `AdminTile` registry (commit 1)

`src/lib/admin-portal/tiles.ts` — new. Mirrors `src/lib/org-portal/tiles.ts`'s
naming, not its shape: **pure synchronous data, zero imports of
`hasFeature`/`isFlagEnabled`/session/query** (architect's Phase 2 constraint).
No `visiblePortalTiles`-style exported filter function lives here either —
`hasFeature()` is a trivial array-includes check on data the session already
carries, so per the architect's ruling the filtering happens once, at the
page. (A tiny colocated pure helper does the filtering — see below — but it
lives next to its one consumer, `destination.ts`'s own precedent, not in the
registry.)

```ts
export type AdminDomain =
  | "people_access"
  | "platform_operations"
  | "content_communications";

export const ADMIN_DOMAIN_LABELS: Record<AdminDomain, string> = {
  people_access: "People & Access",
  platform_operations: "Platform Operations",
  content_communications: "Content & Communications",
};

export const ADMIN_DOMAIN_ORDER: readonly AdminDomain[] = [
  "people_access",
  "platform_operations",
  "content_communications",
];

export interface AdminTile {
  key: string;
  label: string;
  description: string;
  /** Plain string — no per-org slug on this axis, unlike PortalTile.href. */
  href: string;
  requiredFeature: FeatureKey;
  domain: AdminDomain;
}

export const ADMIN_TILES: readonly AdminTile[] = [ /* table below */ ];
```

Full tile table (order = render order within each domain):

| key | label | href | requiredFeature | domain |
|---|---|---|---|---|
| `users` | Users & roles | `/admin/users` | `FEATURES.ADMIN_USERS` | People & Access |
| `2fa` | 2FA policy | `/admin/2fa` | `FEATURES.ADMIN_TWO_FACTOR` | People & Access |
| `organizations` | Organizations | `/admin/organizations` | `FEATURES.ADMIN_ORGANIZATIONS` | Platform Operations |
| `flags` | Feature flags | `/admin/flags` | `FEATURES.ADMIN_FLAGS` | Platform Operations |
| `audit` | Audit log | `/admin/audit` | `FEATURES.ADMIN_AUDIT` | Platform Operations |
| `email_queue` | Email queue | `/admin/email-queue` | `FEATURES.ADMIN_EMAIL_QUEUE` | Platform Operations |
| `docs` | Release notes | `/admin/docs` | `FEATURES.ADMIN_RELEASE_NOTES` | Content & Communications |
| `whats_new` | What's new | `/admin/whats-new` | `FEATURES.ADMIN_WHATS_NEW` | Content & Communications |
| `feedback` | Feedback | `/admin/feedback` | `FEATURES.ADMIN_FEEDBACK` | Content & Communications |
| `tickets` | Tickets | `/admin/tickets` | `FEATURES.ADMIN_TICKETS` | Content & Communications |

10 tiles, matching `FEATURE_CATALOG`'s 11 keys minus `ADMIN_DASHBOARD` (the
door feature, never a tile — see Permissions & Flags). `admin/design-system`
and `admin/sites` are **not** in this table — see Edge Cases for both.

`descriptions` reuse each page's existing card blurb verbatim from today's
`admin/page.tsx` (Tickets gets a new one: "Triage the cross-org support ticket
queue: status, assignment, classification, and replies" — matching
`FEATURE_CATALOG`'s own `ADMIN_TICKETS` description).

**The filter helper**, colocated with its one consumer per the
`destination.ts` precedent ("every subsequent pipeline will edit it... a page
that inlined these rules would be verifiable only through a browser" — same
logic applies to tile visibility):

```ts
// src/app/(admin)/admin/visible-tiles.ts
import { ADMIN_TILES, type AdminTile } from "@/lib/admin-portal/tiles";
import { hasFeature } from "@/lib/permissions";

export function visibleAdminTiles(
  features: string[] | undefined,
): AdminTile[] {
  return ADMIN_TILES.filter((tile) => hasFeature(features, tile.requiredFeature));
}
```

### 2. The generic shared tile components (commit 1, SAME commit as both migrations)

`src/components/shared/tile-grid.tsx` and
`src/components/shared/domain-tile-sections.tsx` — moved from
`src/components/org-portal/`, generalized. **Both org-portal call sites
(`(org)/o/[slug]/page.tsx` and `(org)/o/[slug]/admin/page.tsx`) are migrated to
the new props in the same commit as the admin-portal consumer.** A
half-genericized pair — one caller on the old slug-coupled shape, one on the
new generic shape — is worse than either the fully-old or fully-new state: it
means two divergent copies exist simultaneously with no way to verify they
stay in sync, exactly the drift class this genericization exists to prevent.

```ts
// tile-grid.tsx
export interface TileLike<TDomain extends string = string> {
  key: string;
  label: string;
  description: string;
  domain: TDomain;
}

export function TileGrid<TDomain extends string, TTile extends TileLike<TDomain>>({
  tiles,
  getHref,
  getIcon,
}: {
  tiles: TTile[];
  getHref: (tile: TTile) => string;
  /** Undefined for an unmapped key → falls back to LayoutGrid, same as today. */
  getIcon?: (tile: TTile) => LucideIcon | undefined;
}): React.ReactNode
```

```ts
// domain-tile-sections.tsx
export function DomainTileSections<TDomain extends string, TTile extends TileLike<TDomain>>({
  tiles,
  getHref,
  getIcon,
  domainOrder,
  domainLabels,
}: {
  tiles: TTile[];
  getHref: (tile: TTile) => string;
  getIcon?: (tile: TTile) => LucideIcon | undefined;
  /** The domain/labels/order triple the architect's ruling names. */
  domainOrder: readonly TDomain[];
  domainLabels: Record<TDomain, string>;
}): React.ReactNode
```

Neither file imports `@/lib/org-portal/tiles` any more — that is the whole
point of the genericization. `slug` disappears from both signatures; org-portal
callers close over their own `slug` in a `getHref` closure:

```ts
// (org)/o/[slug]/page.tsx and admin/page.tsx, both
<DomainTileSections
  tiles={tiles}
  getHref={(tile) => tile.href(slug)}
  getIcon={(tile) => TILE_ICONS[tile.key]}
  domainOrder={DOMAIN_ORDER}
  domainLabels={DOMAIN_LABELS}
/>
```

```ts
// (admin)/admin/page.tsx
<DomainTileSections
  tiles={visibleAdminTiles(session?.user?.features)}
  getHref={(tile) => tile.href}
  getIcon={(tile) => ADMIN_TILE_ICONS[tile.key]}
  domainOrder={ADMIN_DOMAIN_ORDER}
  domainLabels={ADMIN_DOMAIN_LABELS}
/>
```

The org-portal's existing `TILE_ICONS` keyed lookup moves out of
`tile-grid.tsx` (which is leaving org-portal entirely) into a new, small,
org-portal-owned `src/components/org-portal/tile-icons.tsx` (map + nothing
else). A parallel `src/app/(admin)/admin/tile-icons.ts` gets its own ten-entry
map, all pre-existing `lucide-react` icons (already a dependency — no
architect five-criteria pass needed): `Users`, `KeyRound`, `Landmark`,
`SlidersHorizontal`, `ShieldCheck`, `Mail`, `FileText`, `Megaphone`,
`MessageSquare`, `Ticket`.

**Also relocated in commit 1, same reasoning as `DestinationCard`** ("ONE
COMPONENT FOR BOTH ON PURPOSE... two components would drift... within a
release"): `src/components/org-portal/greeting.tsx` and
`src/lib/org-portal/greeting.ts` move to `src/components/shared/greeting-band.tsx`
and `src/lib/shared/greeting.ts` respectively, mechanically (a
"MOVED HERE, UNMODIFIED" header comment, matching
`feedback-prompt-card.tsx`'s own precedent). `/admin/page.tsx` adopts it in
place of its bare `<h1>Welcome, {name}.</h1>` — see Edge Cases for why (the
task's "keep consistent with what shipped in the tile-redesign era" note).
`motionEnabled` is passed `false`, hardcoded, at the `/admin` call site — there
is no `org_portal.motion`-equivalent flag on this axis and inventing one for a
single mount fade-in is not justified by this pipeline. **`/home` is NOT
touched by this relocation** — its existing bare `<h1 className="text-3xl
font-bold tracking-tight">` greeting is out of scope; the "operator disliked
the old color combo" note in Phase 1/2 concerned `/admin` specifically
(DECISION-104/105 already fixed org-portal's own version of this).

**`demo.new_dashboard` banner: RETIRED**, not kept above the grid. It was a
teaching example for `isFlagEnabled()`, wired to a flag that has never gated
an actual "new dashboard" (the banner IS the whole feature it describes). The
codebase has since accumulated many real `isFlagEnabled()` examples
(`org_portal.*`, this very pipeline's own `platform.merged_home`), so it no
longer earns its keep, and it clutters the real estate directly above a grid
that already needs an empty-state design (see Edge Cases). Removed from
`admin/page.tsx` and its seed row deleted from `scripts/seed.ts` — leaving the
row while deleting the banner would strand a dead flag whose own description
promises a UI that no longer exists.

### 3. `/admin/page.tsx` — full rewrite (commit 1)

Full-width pattern per `docs/ui-standards.md` (card grid = full-width, not
constrained): `<div className="space-y-8">` root, no second padding wrapper
(the admin layout's `p-8` stands). Composition:

1. `<GreetingBand displayName={...} motionEnabled={false} />` (relocated
   shared component) — replaces the bare `<h1>` + roles paragraph.
2. `visibleAdminTiles(session?.user?.features)` → `<DomainTileSections>` as
   shown above.
3. **Empty state, new** — per `docs/ui-standards.md`'s Empty States rule
   ("never leave a grid blank"): if `visibleAdminTiles(...).length === 0`
   (reachable — see Edge Cases), render a dashed-border card: "You don't have
   access to any admin tools yet." / "Contact a platform administrator to
   request the features you need." `DomainTileSections` already returns `null`
   on zero tiles, so this check wraps it, not replaces it internally.

### 4. Merged `/home` (commit 2)

`src/app/(member)/home/page.tsx` — rewritten to absorb `(member)/orgs`'s
content. `src/app/(member)/orgs/` deleted entirely (page, `destination-card.tsx`,
any tests specific to the segment). `destination-card.tsx` relocates to
`src/components/shared/destination-card.tsx`, mechanically, same
"MOVED HERE, UNMODIFIED" pattern.

**Composition order** (greeting first, cards next, platform block, then the
existing content, feedback last):

1. Existing greeting `<h1>` (untouched — see above).
2. **If `platform.merged_home` is enabled:**
   - "Your organizations" section (enterable org cards, `DestinationCard`,
     DECISION-039 name+type only) — rendered when `enterable.length > 0`.
   - "Platform" section (Admin card iff `canAccessAdmin`, Developer card iff
     `isPlatformAdmin`, independently — DECISION-044) — rendered when either
     holds.
   - "Still being set up" (pending `invited` orgs) — rendered when
     `pending.length > 0`.
   - **No `nothingToShow` empty state** — see Edge Cases: this case is
     provably unreachable at `/home` given `computeDestination`'s own guards,
     and carrying over dead code from `/orgs` (which needed it because it was
     independently URL-reachable with no upstream guard) is not "carrying the
     degrade over," it's importing an untestable branch.
3. Quick links: **"Account settings" only** — the existing "Admin dashboard"
   button is dropped; the Platform section above already covers that
   destination, and showing it twice reads as a bug, not a convenience.
4. What's-new card (existing, untouched).
5. Feedback prompt card (existing, untouched, last).

**If `platform.merged_home` is disabled:** skip step 2 entirely. The page
renders exactly its pre-merge shape (greeting → quick links, now including
"Admin dashboard" again since the Platform section didn't render → what's-new
→ feedback). This is the flag's whole job (see Permissions & Flags).

**Data reads**, mirroring `/orgs`'s existing shape exactly:
`Promise.all([cachedUserOrganizations(id), cachedIsPlatformAdmin(id)])`,
`sessionCanAccessAdmin(session.user)`, plus the existing what's-new query and
feedback-prompt-state read. **Org-list failure degrade carried over
verbatim**: if the `Promise.all` throws, the page returns *only*
`<OrganizationsUnavailable retryHref="/home" />` — no greeting, no what's-new,
no feedback prompt — matching `/orgs`'s existing all-or-nothing contract
exactly (a DB outage on that connection plausibly also threatens the
what's-new/feedback reads on the same pool, so this is the conservative,
already-tested choice, not a new judgment call).

**`destination.ts`: one literal changes, and nothing else** (architect's
ruling, confirmed buildable exactly as stated). Both `"chooser"`-reason return
statements' `path` become `"/home"`. **`platform.merged_home` is never
threaded into `computeDestination` or `DestinationInput`.** This was
considered and rejected: once `/orgs` is a config-level redirect (not a page),
a computed fallback of `"/orgs"` is behaviorally identical to `"/home"` — the
browser just takes one extra 308 hop back to the same place. Passing the flag
into the pure matrix would be dead-weight complexity with no observable
effect, and it would cost `destination.ts` its zero-import purity for nothing.
The flag's real, useful gating point is `/home`'s own render branch (§ above)
— that is where a rollback actually changes what the user sees.

**`next.config.ts`**: add a `redirects()` export —

```ts
async redirects() {
  return [{ source: "/orgs", destination: "/home", permanent: true }];
}
```

— a 308, never entering the React render pipeline, no `loading.tsx` to
accidentally open. `src/app/(member)/orgs/` is deleted, not left as a
redirect-only stub page.

**Stale-link cleanup** (same commit): `src/components/shared/org-switcher.tsx`
(two `/orgs` links + a doc-comment, lines ~58/167/171) →
`/home`/"Go to your home page" copy; `src/app/no-organization/page.tsx:73`
("Choose where to go" → `/home`); `src/proxy.test.ts`'s "leaves /orgs outside
the 2FA gate" test — **keep this test, retarget it at `/home`** (the
underlying property — the chooser-equivalent page is outside the org 2FA
gate — is still true and still worth asserting, just at the new path; do not
delete it).

### 5. `/` — copy expansion outline only (commit 3, foldable)

`src/app/page.tsx` stays server-only, no new deps (architect confirmed). Copy
is drafted by the implementer at Phase 4 within this outline, not written
here:

- **Headline**: keep "presby" — the standing placeholder is safe (per
  operator answer 3) and must not read as a chosen name.
- **What it is**: expand the current one-paragraph description into naming
  the actual, real functionality — church management (rolls, officers,
  directory), council operations, per-tenant public websites, and a
  support-ticket loop — grounded in `docs/product/functionality-map.md`, not
  aspirational.
- **Who it serves**: name congregations, presbyteries, and synods explicitly
  as distinct served levels (today's copy folds them into one sentence) — this
  is the one substantive content addition the operator asked for.
- **Honest pre-release note**: keep, verbatim in spirit — "pre-release,
  nothing here is a live congregation."
- **CTA**: unchanged — Sign in / Continue (DECISION-034), signed-in Continue
  path untouched.
- **Discipline**: no invented product name anywhere in the new copy; no
  claim of a capability not in the functionality map (e.g., giving/ledger,
  worship, and public event calendars are explicitly NOT built — don't imply
  otherwise).

## Implementation Order

1. **Commit 1 — ux-developer.** `src/lib/admin-portal/tiles.ts` (+ test) →
   genericize `TileGrid`/`DomainTileSections` into `src/components/shared/`
   and migrate both existing org-portal call sites in the same commit →
   relocate `greeting.ts`/`greeting.tsx` → shared, adopt at `/admin` → rewrite
   `/admin/page.tsx` (registry + empty state + retired banner) →
   `src/app/(admin)/admin/visible-tiles.ts` (+ test) → seed fix
   (`bindSupportOperatorFeatures` gains `ADMIN_DASHBOARD`; delete
   `demo.new_dashboard`'s seed row) → `proxy.test.ts` regression case for the
   support-operator fix (see Edge Cases).
2. **Commit 2 — full-stack-developer.** Spans server (`next.config.ts`
   redirect, `destination.ts` literal, the flag read) and client (`/home`'s
   rewritten composition) and is small — the textbook case for this
   implementer per CLAUDE.md's selection table. Delete `(member)/orgs/`,
   relocate `destination-card.tsx`, update `destination.test.ts`'s
   chooser-reason assertions, stale-link cleanup, seed
   `platform.merged_home: true`.
3. **Commit 3 — ux-developer, foldable into commit 1 or shipped alone.** `/`
   copy only; zero shared dependencies on the other two commits.

## Edge Cases & Risks

- **A third, previously-unrecognized present defect, found verifying this
  design's own acceptance criterion.** Phase 1 asserted `support_operator`
  "gets denied on eight of [ten cards] today" — implying they reach `/admin`
  and see a partially-blocked hub. **Verified false by reading `src/proxy.ts`
  directly.** `PROTECTION_RULES`'s catch-all entry (`{ pattern: /^\/admin/,
  required: FEATURES.ADMIN_DASHBOARD }`) governs `/admin` itself *and* every
  sub-path not covered by the three more-specific rules (`/admin/users`,
  `/admin/flags`, `/admin/docs`) — which includes `/admin/tickets` and
  `/admin/feedback`. `support_operator` is bound to `ADMIN_TICKETS` +
  `ADMIN_FEEDBACK` only (`scripts/seed.ts`), never `ADMIN_DASHBOARD` — so this
  role is bounced to `/access-pending` on `/admin`, `/admin/tickets`, and
  `/admin/feedback` alike, today, before any RSC-level `hasFeature()` check
  ever runs. This is the mirror image of the defect Phase 1/2 named (total
  exclusion, not over-exposure), and it would make the very acceptance
  criterion this design is built around ("support_operator sees exactly two
  tiles") unverifiable in a browser. **Fixed by the seed change above**
  (§ Permissions & Flags) rather than a `proxy.ts` change — establishing
  `ADMIN_DASHBOARD` as the axis's "door" feature is the smaller, more honest
  fix than adding two more `PROTECTION_RULES` entries, and it matches how the
  full `admin` role already works (bound to every `FEATURES.*` key including
  `ADMIN_DASHBOARD`). This did not warrant a full loop-back to Phase 1 — the
  functional intent ("support_operator sees exactly two tiles") is unchanged,
  only an implementation-level blocker was found and closed within Phase 3 —
  but it is named here in full per the retro precedent (2026-07-11) that an
  unanticipated existing-spec-adjacent finding gets surfaced explicitly, not
  folded silently into "fixed."
- **`visibleAdminTiles(features).length === 0` is reachable and must not
  render a blank grid.** A hypothetical user holding `ADMIN_DASHBOARD` alone
  (no other `admin.*` key) is admitted to `/admin` by the Edge but matches zero
  tiles. No such role exists in the current seed, but nothing prevents an
  operator from creating one via `/admin/users`' role assignment UI. Covered
  by the new empty-state design (§ Component Plan) and a `visible-tiles.test.ts`
  case.
- **Two more enumeration-shaped gaps found, explicitly out of scope for this
  pipeline** (naming them, not silently fixing them, per Workflow Rule 10/no
  silent skips): (1) `/admin/sites` (gated `FEATURES.ADMIN_ORGANIZATIONS`) has
  no tile in either the old or the new registry — same class of gap as the
  Tickets fix, not named by Phase 1/2, and adding it now would be scope creep
  on a design that was asked to fix exactly two named defects. (2)
  `src/app/(admin)/admin/layout.tsx`'s left-sidebar `nav` array is a
  hardcoded, unfiltered 12-item list — the identical "shows everything
  regardless of what's held" defect this pipeline fixes for the tile grid,
  unaddressed in the sidebar. Both are recorded to `docs/TODO.md` at commit
  time (Rule 10), not fixed here.
- **`admin/design-system` and `admin/sites` stay reachable by URL, ungated by
  a tile, per the operator's explicit decision** (design-system) and the
  scope note above (sites). Neither regresses — both were already reachable
  only by URL/nav-sidebar before this pipeline; nothing about this design
  removes an access path that existed.
- **`nothingToShow` is provably dead at `/home`.** Reaching `/home` via the
  chooser reason requires NOT matching any of `computeDestination`'s
  zero-org/no-platform, single-org, or platform-admin-only branches — every
  remaining case has `enterableOrgs.length >= 1` or platform access. Verified
  against every existing `destination.test.ts` row; carrying the empty-state
  block over from `/orgs` would add an untestable branch, so it's dropped
  (see Component Plan §4).
- **e2e blast radius — existing specs this change alters, not just new specs
  needed:**
  - `e2e/post-login-routing.spec.ts` tests 7, 10, 12 assert
    `pathname === "/orgs"` for the chooser and for direct `/orgs` navigation —
    **all three break** under this change and must be updated to `/home`
    (test 10's own docstring, "the chooser is a convenience, never a gate,"
    stays true, just at the new path).
  - `e2e/member-home.spec.ts` — every test asserting `/home`'s current bare
    content shape (quick links, what's-new, feedback) needs review: the
    merged content is additive when `platform.merged_home` is on, but any
    test hardcoding "exactly these sections in this order" needs the new
    sections added, not just tolerated.
  - `src/proxy.test.ts`'s "leaves /orgs outside the 2FA gate" test — retarget
    to `/home`, do not delete (see Component Plan §4).
  - `e2e/role-boundaries.spec.ts` — no existing `support_operator` fixture
    exists in `e2e/support/users.ts` today. The unit-level
    `visible-tiles.test.ts` covers the filtering logic without one; a
    permanent e2e fixture for this persona is a reasonable follow-up but not
    required by this pipeline (manual browser verification can bind the
    already-seeded `support_operator` role to a throwaway dev account instead
    — see the browser-verification matrix below).
- **Feedback-prompt opt-out state**: unchanged by this design — the existing
  `shouldShowFeedbackPrompt`/opt-out mechanism is reused verbatim at `/home`;
  no new suppression logic.
- **What's-new empty state**: unchanged — the existing `recentWhatsNew.length
  > 0` guard is reused verbatim.

## Tests

- `destination.test.ts` — every assertion currently expecting
  `{ path: "/orgs", reason: "chooser" }` updated to `{ path: "/home", reason:
  "chooser" }` (7 call sites). The requested-path tests for a literal
  `next=/orgs` input are **unchanged** — they test the pure
  requested-path-honoring branch, not the chooser, and remain correct (a
  stale `?next=/orgs` bookmark still round-trips correctly via the config
  redirect, just with one extra hop `computeDestination` itself is not
  responsible for).
- **Config redirect**: no existing infra tests `next.config.ts`'s `redirects()`
  — Vitest doesn't load the Next config pipeline, and no prior work-log added
  one. Naming this honestly rather than inventing a unit test that doesn't
  exercise the real thing: coverage is a Playwright assertion (`page.goto
  ("/orgs")` and assert the landed URL is `/home`), folded into the existing
  `e2e/post-login-routing.spec.ts` test 10 rewrite rather than a new spec file.
- `src/lib/admin-portal/tiles.test.ts` — exactly 10 tiles; no `design-system`
  or `sites` entry; every `requiredFeature` is a real `FEATURES.*` key; domain
  assignment matches the table above.
- `src/app/(admin)/admin/visible-tiles.test.ts` — a `support_operator`-shaped
  features array (`[ADMIN_TICKETS, ADMIN_FEEDBACK]`) returns exactly 2 tiles
  (Feedback, Tickets); a full-admin-shaped array (all `FEATURES.*` values)
  returns 10; an `ADMIN_DASHBOARD`-only array returns 0.
- `src/components/shared/tile-grid.test.tsx` /
  `domain-tile-sections.test.tsx` — both axes: one fixture using a
  `PortalTile`-shaped array + slug-closure `getHref`, one using an
  `AdminTile`-shaped array + plain-string `getHref`, proving the generic
  bound is satisfied by both real shapes, not just a synthetic one.
- Stale-link greps: `grep -rn '"/orgs"' src` (excluding
  `next.config.ts`/`destination.test.ts`'s intentional literal) returns
  nothing after commit 2.
- `proxy.test.ts` — new case: a session with
  `features: [ADMIN_DASHBOARD, ADMIN_TICKETS, ADMIN_FEEDBACK]` (the fixed
  `support_operator` shape) is admitted to `/admin`, `/admin/tickets`, and
  `/admin/feedback`.

## Browser Verification Matrix

At 1280px and 360px, four personas:

| Persona | What to verify |
|---|---|
| `support-operator-features` admin (ADMIN_DASHBOARD+ADMIN_TICKETS+ADMIN_FEEDBACK — bind via `/admin/users` to a throwaway account, or the seeded role post-fix) | `/admin` renders exactly 2 tiles, both in "Content & Communications," empty-state NOT shown |
| Full admin (`admin` role, existing e2e fixture) | `/admin` renders all 10 tiles across all 3 domains; `/home` shows the Platform section with both Admin and Developer... (Developer only if also `isPlatformAdmin`, which the `admin` fixture is not by default — verify Admin-only) |
| Multi-org member (`org-multi` e2e fixture) | `/home` shows "Your organizations" with 2 cards, no Platform section, no pending section |
| Platform-admin-zero-orgs (no e2e fixture exists today — construct manually) | `/home` shows Platform section (Developer, and Admin iff also `canAccessAdmin`), no org section, no `nothingToShow` block |

## Implementer

- **Commit 1**: ux-developer
- **Commit 2**: full-stack-developer
- **Commit 3**: ux-developer (foldable into commit 1)

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-27 |

**Handoff:** ux-developer — commit 1 (`src/lib/admin-portal/tiles.ts`, the
genericized `src/components/shared/{tile-grid,domain-tile-sections}.tsx` +
both org-portal call-site migrations, the relocated greeting-band, the
rewritten `/admin/page.tsx`, the `visible-tiles.ts` helper, the
`bindSupportOperatorFeatures` seed fix, and the `demo.new_dashboard` retirement)
first; full-stack-developer — commit 2 (merged `/home`, the `next.config.ts`
redirect, `destination.ts`'s one-literal change, stale-link cleanup) next;
ux-developer again — commit 3 (`/` copy), foldable into commit 1 at the
implementer's discretion. Each commit is independently buildable and
testable; land in this order since commit 2 assumes commit 1's shared
components already exist at `src/components/shared/`.

---

## Commit 3 correction (operator, 2026-08-27, after initial ship)

Operator reviewed the shipped public `/` copy and reversed the earlier "functional description" answer: **"It need some marketing flare. Needs to sell itself."** Re-scoping commit 3 as a real landing-page redesign, not a copy edit — orchestrator's design brief follows, grounded in the subject (Presbyterian polity's connectionalism — congregations connect upward through session/presbytery/synod/GA courts, the roll as permanent record) rather than a generic marketing template:

- **Palette:** existing platform tokens only (`--primary`, `--background`, `--foreground`, `--muted`, `--card`, `--border`) — no new hex/Tailwind-palette literals. A full-bleed `--primary`-background hero band (light text) replaces the plain-white open.
- **Signature element:** a minimal inline-SVG "connected courts" diagram (Congregation → Presbytery → Synod → General Assembly, `stroke="currentColor" text-primary`) — the product's actual organizing principle, not generic iconography.
- **Copy:** leads with the pain point before the feature list; feature claims stay honest against `docs/product/functionality-map.md` (no claims beyond what's shipped); the pre-release note, unnamed-project discipline, and DECISION-034 Continue/Sign-in behavior are unchanged.
- **Type scale — one documented exception:** `docs/ui-standards.md`'s 7-role TYPE_SCALE tops out at `text-3xl`/30px (an app-UI scale), too small for a real marketing hero. Add ONE new role, scoped explicitly to this page only (e.g. `hero` at `text-5xl`/`text-6xl` on `lg:`), documented in ui-standards.md as "marketing/landing hero only, never used in-app" — not a silent violation, not a silent underdelivery.
- Stays Polish class (no schema, no new deps, no route change) — Phases 2/3 remain skipped with this notation.

# Phase 4 — Implementation

## Commit 1 (ux-developer) — `admin-portal/tiles.ts`, genericized shared tile components, `/admin` rewrite, seed fix

**Date:** 2026-08-27 · **Implementer:** ux-developer

### Files Created

- `src/lib/admin-portal/tiles.ts` — the `AdminTile` registry: `AdminDomain`
  (3 values), `ADMIN_DOMAIN_LABELS`/`ADMIN_DOMAIN_ORDER`, and `ADMIN_TILES`
  (10 tiles, exact table from Phase 3). Pure synchronous data — zero imports
  of `hasFeature`/`isFlagEnabled`/session/query, per the architect's Phase 2
  constraint and DECISION-123.
- `src/lib/admin-portal/tiles.test.ts` — registry pins: exactly 10 tiles, no
  `design-system`/`sites` entry, every `requiredFeature` checked against the
  live `FEATURES` catalog (not a hard-coded snapshot), no tile gated on
  `ADMIN_DASHBOARD`, domain assignment matches the design table, and a
  comment-stripped source scan proving the module imports nothing from
  `@/lib/flags`/`next-auth`/`@/lib/db`/`@/auth` and calls neither
  `hasFeature()` nor `isFlagEnabled()`.
- `src/app/(admin)/admin/visible-tiles.ts` — the colocated
  `visibleAdminTiles(features)` filter helper (`destination.ts`'s own
  precedent for where such pure page-level logic lives), the one place
  `hasFeature()` meets the registry.
- `src/app/(admin)/admin/visible-tiles.test.ts` — the acceptance-criterion
  tests: a `support_operator`-shaped array (`[ADMIN_DASHBOARD, ADMIN_TICKETS,
  ADMIN_FEEDBACK]`) returns exactly Feedback + Tickets; a full-admin-shaped
  array (every `FEATURES.*` value) returns all 10; an `ADMIN_DASHBOARD`-only
  array returns 0 (the reachable empty-state edge case); `undefined`/`[]`
  return `[]` without throwing.
- `src/app/(admin)/admin/tile-icons.ts` — `ADMIN_TILE_ICONS`, the 10-entry
  `lucide-react` icon map for the platform axis (`Users`, `KeyRound`,
  `Landmark`, `SlidersHorizontal`, `ShieldCheck`, `Mail`, `FileText`,
  `Megaphone`, `MessageSquare`, `Ticket`). No new dependency.
- `src/components/shared/tile-grid.tsx` — the genericized `TileGrid`,
  parameterized over `TileLike<TDomain>` + `getHref`/`getIcon` resolver
  props, replacing the org-portal-specific `slug`+`PortalTile` coupling.
  Also fixes `/admin`'s latent Component-Rule-5 violation (the previous
  hand-rolled `<Link className="rounded-lg...">` card) by routing every
  tile through the same `Button variant="tile"` primitive the org-portal
  axis already used.
- `src/components/shared/tile-grid.test.tsx` — two fixtures (a
  `PortalTile`-shaped array + slug-closure `getHref`; an `AdminTile`-shaped
  array + plain-string `getHref`) proving the generic bound is satisfied by
  both real axis shapes, plus the empty-render and no-internal-chrome
  regressions carried over from the org-portal original.
- `src/components/shared/domain-tile-sections.tsx` — the genericized
  `DomainTileSections`, taking `domainOrder`/`domainLabels` as props instead
  of importing `@/lib/org-portal/tiles`'s runtime constants directly.
- `src/components/shared/domain-tile-sections.test.tsx` — same two-fixture
  proof at the section-bucketing layer (org-portal's 3-domain slice of its
  7-domain taxonomy, and the admin axis's full 3-domain taxonomy).
- `src/components/shared/greeting-band.tsx` — `GreetingBand`, relocated and
  renamed from `src/components/org-portal/greeting.tsx`'s `Greeting`
  (DECISION-125) — one component backing both `/o/<slug>` and the new
  `/admin`.
- `src/components/shared/greeting-band.test.tsx` — relocated, unmodified in
  assertion substance (import/component name updated for the rename).
- `src/lib/shared/greeting.ts` — `timeOfDayGreeting()`, relocated from
  `src/lib/org-portal/greeting.ts`, mechanically unmodified.
- `src/lib/shared/greeting.test.ts` — relocated, unmodified.
- `src/components/org-portal/tile-icons.tsx` — `TILE_ICONS`, the org-portal's
  own icon map, extracted out of `tile-grid.tsx` (which left
  `src/components/org-portal/` entirely) into its own small, axis-owned
  file. `src/lib/org-portal/tiles.ts` itself untouched.
- `src/app/(admin)/admin/page.test.tsx` — orchestration tests: the
  `support_operator`-shaped session sees exactly 2 tiles under Content &
  Communications with no empty state; a full-admin-shaped session sees all
  10 across all 3 domains; an `ADMIN_DASHBOARD`-only session sees the
  honest empty state, not a blank grid; `GreetingBand` replaces the old bare
  `<h1>`; the retired `demo.new_dashboard` banner never renders.

### Files Modified

- `src/app/(admin)/admin/page.tsx` — full rewrite. `visibleAdminTiles()`
  filters once, at the page, from `session.user.features`;
  `DomainTileSections` renders the three domains; the dashed-border empty
  state (`docs/ui-standards.md`'s Empty States pattern) covers the
  `ADMIN_DASHBOARD`-only edge case; `GreetingBand` (relocated shared
  component, `motionEnabled={false}` hardcoded) replaces the bare
  `<h1>Welcome, {name}.</h1>` + roles paragraph; the `demo.new_dashboard`
  banner and its `isFlagEnabled` import are gone.
- `src/app/(org)/o/[slug]/page.tsx` — migrated to the genericized shared
  components in the same commit (DECISION-125's one-commit rule): imports
  `GreetingBand` from `@/components/shared/greeting-band`,
  `DomainTileSections` from `@/components/shared/domain-tile-sections`, and
  `TILE_ICONS` from `@/components/org-portal/tile-icons`; passes
  `getHref={(tile) => tile.href(resolved.org.slug)}`,
  `getIcon={(tile) => TILE_ICONS[tile.key]}`, and the real
  `DOMAIN_ORDER`/`DOMAIN_LABELS` from `@/lib/org-portal/tiles`.
- `src/app/(org)/o/[slug]/page.test.tsx` — mock updated to
  `@/components/shared/domain-tile-sections` (+ a `TILE_ICONS` stub); the
  wiring assertion rewritten to check `tiles`/`getHref`/`domainOrder`/
  `domainLabels` props instead of the old `{slug, tiles}` shape.
- `src/app/(org)/o/[slug]/admin/page.tsx` — same migration: imports the
  shared `DomainTileSections` + `TILE_ICONS`, passes the same five props
  (`tiles`, `getHref={(tile) => tile.href(slug)}`, `getIcon`, `domainOrder`,
  `domainLabels`).
- `src/app/(org)/o/[slug]/admin/page.test.tsx` — mock path updated to
  `@/components/shared/domain-tile-sections`'s consumer (`@/lib/org-portal/
  tiles`'s `DOMAIN_LABELS`/`DOMAIN_ORDER` mock kept, since the page still
  reads those at import time); added a `TILE_ICONS` stub. All existing
  assertions (flag-before-registry ordering, no-permission-check source
  scan, domain-section headings, empty-hub fallback, four-way-miss) pass
  unmodified in substance.
- `scripts/seed.ts` — (1) `bindSupportOperatorFeatures()` additionally binds
  `FEATURES.ADMIN_DASHBOARD` (DECISION-123's seed fix — `support_operator`
  was previously bounced to `/access-pending` on `/admin` itself, never
  reaching the tile grid this pipeline built); (2) `demo.new_dashboard`'s
  `seedFlags()` row deleted, with a comment explaining the retirement,
  matching the banner's removal from `admin/page.tsx`.

### Files Deleted

- `src/components/org-portal/greeting.tsx` / `greeting.test.tsx` — relocated
  to `src/components/shared/greeting-band.{tsx,test.tsx}`.
- `src/lib/org-portal/greeting.ts` / `greeting.test.ts` — relocated to
  `src/lib/shared/greeting.{ts,test.ts}`.
- `src/components/org-portal/tile-grid.tsx` / `tile-grid.test.tsx` —
  replaced by the genericized `src/components/shared/tile-grid.{tsx,test.tsx}`.
- `src/components/org-portal/domain-tile-sections.tsx` /
  `domain-tile-sections.test.tsx` — replaced by the genericized
  `src/components/shared/domain-tile-sections.{tsx,test.tsx}`.

### Live dev-DB data fix (mirrors the seed change, applied via `psql` per task instruction)

- `INSERT INTO role_features (role_id, feature_key) SELECT r.id,
  'admin.dashboard' FROM roles r WHERE r.name = 'support_operator' ON
  CONFLICT DO NOTHING;` — `support_operator` now holds `admin.dashboard` +
  `admin.tickets` + `admin.feedback` in the live dev database, matching the
  seed fix, so a support-operator role assignment is verifiable in a
  browser without a fresh `db:seed` run.
- `DELETE FROM feature_flags WHERE key = 'demo.new_dashboard';` — mirrors
  the seed row deletion; the retired banner has no orphaned flag row left
  behind in the live dev database either.

### `docs/TODO.md`

- Added two Next-Up lines for the enumeration gaps Phase 3's Edge Cases
  named and explicitly deferred: `/admin/sites` has no tile in
  `ADMIN_TILES` (same class of gap the Tickets fix closed, out of scope for
  this pipeline); `admin/layout.tsx`'s hardcoded, unfiltered 12-item
  sidebar `nav` array has the identical "shows everything regardless of
  what's held" defect this pipeline fixed for the tile grid.

### Schema Changes

- None. `role_features`/`feature_flags` are data rows, not schema; no
  `db:push`/`db:generate`.

### Audit Events

- None. No new security-sensitive mutation — the registry, the filter
  helper, and the seed/data fixes are all read-path or provisioning-time
  changes, not a runtime mutation path a signed-in user triggers.

### Verification

- `npm run typecheck` — clean, zero errors.
- `npm test` (plain Vitest run) — **226 test files passed, 23 skipped (pre-
  existing, unrelated); 2953 tests passed, 552 skipped (pre-existing,
  unrelated); 0 failed.** (Two failures surfaced mid-implementation and were
  fixed before this count: a `tile-grid.test.tsx` assertion that
  over-generalized "no heading at all" to include the tile card's own
  `<h3>`, and a `tiles.test.ts` source-scan test that needed the same
  comment-stripping technique `admin/page.test.tsx`'s pre-existing scan
  uses, since the registry's own header comment names the forbidden
  imports as a "do not add this" warning.)
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all
  four tripwires pass.
- `npx eslint` on every file touched by this commit — clean. (Two
  pre-existing lint issues elsewhere in the tree — `portal-nav-links.tsx`'s
  `react-hooks/set-state-in-effect` and a `create-role-form.test.tsx`
  `<a>`-vs-`<Link>` warning — are untouched by this commit; already tracked
  in `docs/TODO.md`'s "Lint: 7 pre-existing errors on main" line.)

### Browser Verification

Dev server already running; `/tmp/state.json` is a full-admin (`admin`
role) storage state.

- **`/admin`, 1280px** (`admin-portal.png`): all 10 tiles render across the
  three domain sections (People & Access: Users & roles, 2FA policy;
  Platform Operations: Organizations, Feature flags, Audit log, Email
  queue; Content & Communications: Release notes, What's new, Feedback,
  Tickets), `GreetingBand` shows "Good afternoon, E2E Admin." with the
  accent-stripe treatment, no retired banner, cards route through the
  `Button variant="tile"` primitive with icon badges and trailing chevrons.
- **`/admin`, 360px** (`admin-portal-360.png`): single-column stacking,
  domain headings intact, cards remain touch-sized, sidebar collapses to
  a plain link list above the content — no overflow or clipping.
- **Org portal regression** (`org-home-regression.png`,
  `org-admin-hub-regression.png`, both at 1280px, `/o/fpcw` and
  `/o/fpcw/admin` under the same full-admin session, which holds a real
  membership there): both render byte-for-byte the same shape as before
  the genericization — greeting band with the org's own brand accent
  color, find-a-person, domain-sectioned tile grids (People & Membership /
  Worship & Events / Giving & Finance / Governance & Courts / Reports &
  Insights / Communications on the home page; Administration on the hub),
  feedback prompt card. Confirms the genericization is invisible to the
  org-portal axis, as designed.
- **Reduced-features session (support_operator-shaped, ADMIN_DASHBOARD +
  ADMIN_TICKETS + ADMIN_FEEDBACK only) — NOT verified in a browser.** No
  e2e fixture for this persona exists (`e2e/support/users.ts` has none, as
  Phase 3's Edge Cases already noted), and constructing one would mean
  either a second Playwright storage state (out of scope for this commit —
  no login flow was exercised) or hand-editing the live full-admin
  session's role bindings (which would perturb the very fixture used for
  the full-admin screenshots above). The live dev-DB data fix above makes
  this persona *reachable* the next time someone signs in as a
  support-operator-bound account, but I did not fabricate a screenshot for
  it. **This filtering is instead verified by `visible-tiles.test.ts`'s
  three-case unit test** (support_operator-shaped → 2 tiles;
  full-admin-shaped → 10; `ADMIN_DASHBOARD`-only → 0) and
  `admin/page.test.tsx`'s equivalent orchestration-level assertions, both
  passing. Naming this honestly per the task's own instruction rather than
  claiming browser coverage that doesn't exist.

### Implementer Notes

- **Deviation from the literal Phase 3 signature comment, functionally
  identical:** `admin/tile-icons.ts` types `ADMIN_TILE_ICONS` as
  `Record<AdminTile["key"], LucideIcon>`. Since `AdminTile.key` is typed
  `string` (not a closed union — the registry doesn't need one, unlike
  `PortalTile`'s domain), this is equivalent to `Record<string,
  LucideIcon>` and does not get compile-time exhaustiveness checking
  against the 10 real keys. Judged acceptable: `TileGrid`'s `getIcon` is
  optional and falls back to `LayoutGrid` for an unmapped key by design
  (the same "never crashes, degrades visibly" contract the org-portal
  original already had), so a future key added to `ADMIN_TILES` without a
  matching icon fails soft, not at `tsc`.
- **`org-portal/tile-icons.tsx` still carries icon entries for tiles that
  don't exist in `PORTAL_TILES` today were they ever removed** — not an
  issue introduced by this commit (the map is a direct, mechanical
  extraction of the exact object that lived inside the old
  `tile-grid.tsx`), just noting the extraction preserved rather than
  audited the map's contents.
- **`admin/page.tsx`'s `GreetingBand` reads `session?.user?.name`, not a
  separately-fetched display name** — unlike the org-portal call site
  (which threads a DB-read `displayName` through `getPortalHomeData()`),
  there is no platform-axis equivalent of "the viewer's own directory
  entry" to look up; the session's own `name` claim is the only signal
  available and was already what the pre-rewrite page used
  (`session?.user?.name ?? "admin"` in the old bare `<h1>`).  `GreetingBand`
  itself treats a missing name as `null` → "Welcome." — matching that
  same fallback intent, just routed through the shared component instead
  of an inline `??` at the call site.
- **No new e2e coverage added for the `/admin` tile grid** — Phase 3's own
  Tests section scoped this to unit-level coverage
  (`tiles.test.ts`/`visible-tiles.test.ts`/`page.test.tsx`) plus manual
  browser verification, explicitly deferring a permanent
  `support_operator` e2e fixture as "a reasonable follow-up but not
  required by this pipeline." Not added here, consistent with that scope
  call; flagged again above rather than silently skipped.
- **`docs/product/functionality-map.md` not updated in this commit.**
  Rule 14 ties that update to ship time (Phase 6) — this pipeline is still
  mid-flight (commits 2 and 3 remain). Noting here so it isn't forgotten:
  the map's admin-portal description and its `demo.new_dashboard` line
  both need a pass once the whole feature ships.

## Commit 3 (ux-developer) — `/` copy expansion

**Date:** 2026-08-27 · **Implementer:** ux-developer

### Files Modified

- `src/app/page.tsx` — copy expanded per Phase 3 §5's outline. Stays
  server-only, no new imports, no new deps. Changes:
  - Headline unchanged in text ("presby") but corrected to the `display`
    role per `docs/ui-standards.md`'s type scale (`text-3xl`, was the
    unscaled `text-4xl`) — the one type-scale correction made in this
    commit, since the page is a standalone hero outside the app shell and
    `display` is exactly that role's definition.
  - Two new `<h2>` sections at the `section` role (`text-xl font-semibold`):
    "What presby does" and "Who it serves" — replacing the single
    undifferentiated paragraph. Body copy is `text-base` (the `body` floor)
    throughout; no arbitrary or sub-14px sizes introduced.
  - "What presby does" names, grounded in
    `docs/product/functionality-map.md` (read before drafting, not
    invented): the membership roll and roll actions, officer terms and
    ordinations, the directory, committees and groups, the support-ticket
    loop, and per-tenant public websites. Deliberately silent on
    giving/ledger, worship, check-in, and a public event calendar — all
    named in the map as **NOT built** — so the copy makes no claim the
    platform can't back up.
  - "Who it serves" is the one substantive content addition the operator
    asked for (Phase 1, Operator Answer 3): congregations, presbyteries,
    and synods named as three distinct served levels, each keeping its own
    records — grounded in the presbytery-credentials and portal-IA
    functionality-map entries, not asserted generically.
  - The honest pre-release note ("Pre-release. Nothing here is a live
    congregation.") kept verbatim, unmoved in meaning.
  - The signed-in/signed-out CTA branch is **byte-identical in behavior** to
    the pre-commit version: signed-out renders "Sign in" → `/signin`;
    signed-in renders "Sign out" (a `'use server'` form calling
    `signOut({ redirectTo: "/" })`) and "Continue" → `/launch`, with the
    same DECISION-034 code comment preserved verbatim. No redirect was
    added or removed for a signed-in visitor.
  - Discipline check: no invented product name anywhere in the new copy —
    "presby" is the only name used, and every sentence reads as a
    description of a placeholder-named platform, not a branded product.

### Files Created

- `src/app/page.test.tsx` — new (no prior test existed for this page).
  Mirrors commit 1's `admin/page.test.tsx` session-mocking pattern
  (`vi.mock("@/auth", () => ({ auth: () => mockAuth(), signOut: vi.fn()
  }))`, `@vitest-environment jsdom`, render the awaited RSC element
  directly). 7 tests: signed-out shows "Sign in" and neither "Continue"
  nor "Sign out" nor the welcome-back line; signed-in shows "Continue"
  (href `/launch`) and "Sign out", not "Sign in", plus the welcome-back
  line with the session name; a session with no `name` falls back to
  `email` in the welcome-back line; the copy names congregations,
  presbyteries, and synods (`getAllByText`, since each term appears in
  more than one paragraph — a plain `getByText` throws on a multiple-match
  string); the pre-release note survives verbatim; the single `<h1>`'s
  text is exactly `"presby"` (no invented name); and there is exactly one
  `<h1>` with at least two `<h2>` section headings.

### Schema Changes

None.

### Audit Events

None — a public, unauthenticated marketing page with no mutation.

### Verification

- `npm run typecheck` — clean, zero errors.
- `npx vitest run src/app/page.test.tsx` — 7/7 passed.
- `npm test` (full suite) — **227 test files passed, 23 skipped
  (pre-existing, unrelated, matches commit 1's baseline); 2960 tests
  passed (2953 + this commit's 7), 552 skipped (pre-existing, unrelated);
  0 failed.**
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) —
  all four tripwires pass.
- `npx eslint src/app/page.tsx src/app/page.test.tsx` — clean.

### Browser Verification

Dev server already running on `localhost:3000`. Three Playwright contexts:

- **Signed-out, 1280px** (`public-home.png`): headline "presby", the
  intro line, both new "What presby does" / "Who it serves" sections in
  full, the pre-release note, and a single "Sign in" button. No
  "Continue"/"Sign out", no welcome-back line — matches DECISION-034 (an
  anonymous visitor gets the way in, nothing more).
- **Signed-out, 360px** (`public-home-360.png`): single-column, all
  copy reflows without horizontal scroll or clipping, headings and body
  text both legible at the mobile width, "Sign in" button remains a
  comfortable touch target. (A floating dev-tooling badge in the
  bottom-left corner of the screenshot is a pre-existing local dev
  overlay unrelated to this page — not part of the shipped UI.)
- **Signed-in (fresh context with `/tmp/state.json`'s full-admin storage
  state), 1280px** (not required by the task but captured to confirm no
  regression): same copy, plus "Welcome back, E2E Admin." and both "Sign
  out" and "Continue" (href `/launch`) buttons — the pre-existing
  signed-in branch renders unchanged.
- Screenshots are ephemeral verification artifacts (per commit 1's own
  precedent — `admin-portal.png`/`admin-portal-360.png` are referenced by
  name in this same Phase 4 section but were never committed to the
  repo); not added to version control.

### Implementer Notes

- The headline's `text-3xl` (was `text-4xl`) is the only visual change to
  content that existed before this commit — a `docs/ui-standards.md`
  type-scale correction (`display` role = `text-3xl`), not a copy change,
  and narrow enough that it does not read as a redesign.
- `docs/product/functionality-map.md` still not updated in this commit —
  correctly deferred to Phase 6 per Rule 14 and commit 1's own note; this
  pipeline remains mid-flight until commit 2 lands and Phase 5/6 run.
- No new copy strings need a fork's branding-pass review beyond the usual
  "presby" placeholder — the copy names no real congregation, uses only
  generic ecclesiastical terms (congregation/presbytery/synod), and
  matches the No Real Data invariant.

## Commit 3 — redo, marketing redesign (ux-developer)

**Date:** 2026-08-27 · **Implementer:** ux-developer

### Why this redo happened

The operator reviewed the shipped commit-3 copy (above) and reversed the
earlier "functional description" answer: **"It need some marketing flare.
Needs to sell itself."** The orchestrator re-scoped `/` as a real landing-page
redesign, grounded in the subject rather than a generic marketing template
(the full brief is recorded above, "Commit 3 correction"). This subsection
documents the redo; the prior copy-expansion pass above is left intact per
CLAUDE.md's instruction to preserve prior-phase output rather than summarize
it away.

### What changed from the first pass, and why

- **Full-bleed `bg-primary`/`text-primary-foreground` hero band**, replacing
  the plain white page the first pass kept. Platform tokens only — no new hex
  literals, no Tailwind palette classes — this route is not a brandable group
  (CLAUDE.md → The Brand Is a Cascade Override), so it always renders the
  platform palette, never a per-org brand, whether inside or outside the hero.
- **The headline now leads with the actual distinctive value** — Presbyterian
  connectionalism (courts answering upward: session → presbytery → synod →
  General Assembly) and the roll as permanent record — instead of a generic
  "manage your church" pitch. The first pass's literal `<h1>presby</h1>` is
  gone; "presby" now appears as a small kicker line above the headline, so the
  unnamed-project discipline stays visible without the headline itself being
  the placeholder word.
- **New signature element: an inline, hand-authored SVG** (`ConnectionalDiagram`,
  in `src/app/page.tsx`) — four circles connected by one line, `stroke`/`fill`
  `currentColor` inside a `text-primary-foreground` wrapper, `aria-hidden`
  because the four court names are real HTML text immediately below it
  (`Congregation`/`Presbytery`/`Synod`/`General Assembly`, at the `dense` role
  — captions under a diagram, not paragraph copy), not baked into the SVG
  itself. No icon library, no new dependency.
- **Everything after the hero returns to `bg-background`/`text-foreground`**
  — the "What presby does" and "Who it's for" sections are deliberately quiet:
  no gradients, no shadows, no second accent color. Boldness is spent in
  exactly one place, per the design brief's restraint principle.
- **Copy grounded strictly in `docs/product/functionality-map.md`'s
  actually-shipped capabilities**, re-verified against the map before writing
  a line: the roll and roll actions, officer terms/ordinations, the
  directory, committees and groups, event scheduling (single + recurring),
  the support-ticket loop, presbytery credentialing (ordinations, standing
  changes, pastoral appointments), and per-tenant public websites. Explicitly
  silent on giving/ledger, worship, check-in, and a public event calendar —
  all named in the map's "NOT built" line — matching the first pass's
  discipline, now with two more grounded capabilities named (groups, events)
  that the first pass's tighter copy had folded away.
- **One documented type-scale exception**: a new `hero` role added to
  `docs/ui-standards.md`'s `TYPE_SCALE` table (`text-5xl md:text-6xl`,
  48px→60px), explicitly scoped "marketing/landing hero only — never used
  in-app; `/` is the only consumer," with a paragraph explaining why it exists
  and when NOT to reach for it again. This supersedes the first pass's
  `display`-role (`text-3xl`) headline treatment — a real marketing hero needs
  a materially bigger size than the app-UI scale's ceiling, and the brief was
  explicit that this must be a *documented* exception, not a silent
  violation. `src/lib/brand/contract.ts`'s own `TYPE_SCALE` array (the
  runtime source of truth for the seven in-app roles, transcription-tested
  against `globals.css`) is intentionally **not** touched — the task scoped
  the exception to the doc table only, and adding an eighth entry there would
  pull the marketing-only role into `contract.test.ts`'s monotonic-sequence
  assertion and the zero-runtime-imports contract file for a size that has
  exactly one consumer and is not a brand/contrast concern.
- **Minimal motion**: a class-based `animate-in fade-in slide-in-from-bottom-4
  duration-700` on the hero's inner content wrapper only (`tw-animate-css`
  utilities, already imported in `globals.css` per an existing divergence
  note — no new dependency). No inline-style animation duration to bypass
  `globals.css`'s blanket `@media (prefers-reduced-motion: reduce)` rule;
  verified live (see Browser Verification) that the rule collapses the
  animation to ~0.01ms under emulated reduced motion.
- **DECISION-034's Continue/Sign-in behavior is byte-identical** — same
  `'use server'` sign-out form, same `/launch` Continue link and its code
  comment, same conditional branches. Only the visual treatment and
  surrounding copy changed, confirmed by re-running (and extending) the exact
  session-mocking test pattern from the prior pass.

### Files Modified

- `src/app/page.tsx` — full rewrite of the JSX/copy (imports unchanged:
  `next/link`, `@/auth`, `@/components/ui/button`, no new imports, no new
  deps). Adds one new local, non-exported component,
  `ConnectionalDiagram()`, colocated in the same file per the task's "your
  call, keep it simple" — it has exactly one consumer and is short enough
  not to earn its own file under `src/components/shared/`.
- `src/app/page.test.tsx` — rewritten for the new structure. 11 tests (was
  7): the two signed-out/signed-in behavior tests and the email-fallback
  test carried over verbatim; new tests assert the hero headline text, the
  "presby" kicker (`selector: "p"`, distinguishing it from the `<h1>`), the
  four court labels render, the diagram's `<svg>` carries `aria-hidden`,
  the grounded capability headings render ("What presby does",
  "Membership & records", "Council operations" — via `getByRole("heading",
  ...)` since the plain-text regex collided with the same phrase appearing
  in that section's own body copy, "Public websites"), that NOT-built
  capabilities (giving, worship) are absent, the pre-release note survives,
  the `<h1>` text is NOT literally `"presby"` (the placeholder now lives in
  the kicker instead), and the single-`<h1>`/`<h2>`-count structural check.
- `docs/ui-standards.md` — added the `hero` row to the `TYPE_SCALE` table
  plus a documentation paragraph explaining the exception (why it exists,
  its one consumer, and an explicit "don't reach for this on a second page
  without updating this row first"); updated the Page Header & Typography
  section's one-liner ("A standalone hero, outside the app shell, →
  `display`") to carve out the new narrower case ("A standalone marketing
  hero (currently only `/`) → `hero`. Any other standalone hero outside the
  app shell → `display`").

### Schema Changes

None.

### Audit Events

None — a public, unauthenticated marketing page with no mutation.

### Verification

- `npm run typecheck` — clean, zero errors.
- `npx vitest run src/app/page.test.tsx` — 11/11 passed. (One test needed a
  fix mid-implementation: a case-insensitive `getByText(/Council
  operations/i)` matched both the section's `<h3>` and its own body
  paragraph, which happens to contain the lowercase phrase "council
  operations" in a sentence — switched to `getByRole("heading", { name:
  "Council operations" })`, which is also the more precise assertion.)
- `npm test` (full suite) — **228 test files passed, 23 skipped
  (pre-existing, unrelated); 2973 tests passed (2962 baseline + this
  commit's 11), 552 skipped (pre-existing, unrelated); 0 failed.**
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all
  four tripwires pass. `check:brand-scope` in particular confirms the new
  hero band's `bg-primary`/`text-primary-foreground` usage doesn't trip the
  brand-scope tripwire — `/` was never and is still not one of the two
  brandable route groups, and no brand-emitter code was added here.
- `npx eslint src/app/page.tsx src/app/page.test.tsx` — clean.

### Browser Verification

Dev server already running on `localhost:3000`; `/tmp/state.json` is the
existing full-admin (`admin` role) storage state from commit 1. Four
Playwright contexts:

- **Signed-out, 1280px** (`marketing-home.png`): full-bleed blue hero with
  the "PRESBY" kicker, the three-line headline, the subhead, and the
  four-node diagram (Congregation → Presbytery → Synod → General Assembly)
  all rendering inside the primary band; below the fold, the two quiet
  `bg-background` sections ("What presby does" with its four capability
  groups, "Who it's for" with its three audience groups), the pre-release
  note, and a single "Sign in" button. No "Continue"/"Sign out", no
  welcome-back line.
- **Signed-out, 360px** (`marketing-home-360.png`): single column, hero
  headline wraps to five lines and stays legible (no clipping, no
  horizontal scroll), the diagram's four dots stay on one row while the
  labels wrap into a 2×2 grid beneath them (a deliberate, acceptable
  trade-off at this width — the diagram reads as a compact caption block,
  not a precisely-aligned technical chart), all body copy reflows cleanly,
  "Sign in" remains a comfortable touch target. (The floating dev-tooling
  badge in the bottom-left corner is a pre-existing local dev overlay
  unrelated to this page, carried over from the prior pass's own note.)
- **Signed-in (fresh context with `/tmp/state.json`'s full-admin storage
  state), 1280px** (`marketing-home-signedin.png`): identical hero/body
  copy, plus "Welcome back, E2E Admin." and both "Sign out" and "Continue"
  (href `/launch`) buttons — the pre-existing signed-in branch renders
  unchanged, confirming DECISION-034 byte-identical behavior.
- **Reduced motion**: a fourth headless context with
  `page.emulateMedia({ reducedMotion: "reduce" })`, then
  `getComputedStyle()` read on the hero's `.animate-in` wrapper —
  `animation-duration` measured at `1e-05s` (0.01ms), confirming
  `globals.css`'s blanket `@media (prefers-reduced-motion: reduce)` rule
  neutralizes the class-based fade/slide-in exactly as designed, with no
  inline-style duration bypassing it.
- Screenshots are ephemeral verification artifacts (same precedent as
  commits 1 and 3's first pass); not added to version control.

### Implementer Notes

- **`src/lib/brand/contract.ts`'s `TYPE_SCALE` was deliberately left
  untouched** — see "What changed" above. If a future page needs the `hero`
  role, that's the moment to decide whether it belongs in the runtime
  contract too; today it has exactly one consumer and the task scoped the
  exception to the doc.
- **The diagram's four labels render at the `dense` role
  (`text-sm`)**, matching the type-scale table's own guidance that
  `dense` covers "tabular cells, metadata, ... captions" rather than
  paragraph content — these are captions under a decorative graphic, not
  body copy, so `dense` (not `body`) is the correct role, not a
  legibility shortcut.
- **No new copy strings need a fork's branding-pass review** beyond the
  usual "presby" placeholder note already recorded above — the new hero
  copy names no real congregation and stays within the No Real Data
  invariant.
- `docs/product/functionality-map.md` still not updated in this commit —
  correctly deferred to Phase 6 per Rule 14; this pipeline remains
  mid-flight until Phase 5/6 run. (`docs/TODO.md` unaffected by this redo —
  no follow-up items were deferred or discovered in this pass.)

---

## Post-ship correction (operator, 2026-08-27) — public `/` page, second revision

The pipeline had already closed SHIP WITH NOTES with the marketing redesign in place (Commit 3, first pass). Four further additions the operator queued across several messages, dispatched as a follow-up increment against the same file:

1. **Sign-in moves to the top** — a slim header bar, not only inside the hero.
2. **PresbyPortal naming** (DECISION-126, landed after this pipeline's Phase 6) — the page's copy needed to actually say PresbyPortal, not "presby, unnamed."
3. **An open-source/sponsor line**: "PresbyPortal is open source, and its development is supported by the mission of First Presbyterian Church of Westerville." Real attribution copy for a real, willing sponsoring congregation — distinct in kind from the No-Real-Data invariant (which guards against fictional data masquerading as real, not honest real-world sponsor credit on a public marketing page).
4. **An architecture section** grounded in `docs/architecture.md` — a teaser, not a duplicate.
5. **A get-involved section** grounded in the real GitHub repo and LICENSE — no invented `CONTRIBUTING.md` process.

Still Polish class — copy/layout only, no schema/deps/route change. (Note: the orchestrator's first attempt to record this note via an automated string-replace silently failed to match and produced no visible heading — the implementer below worked directly from the full brief in its dispatch prompt instead, and flagged the missing heading honestly in its own Implementer Notes rather than proceeding blind. This note was added after the fact to make the pipeline's actual history match what happened.)

---

## Commit 3 — second revision (top nav, sponsor line, architecture + get-involved sections) (ux-developer)

**Date:** 2026-08-27 · **Implementer:** ux-developer

### Why this revision happened

This pipeline's Phase 6 already closed with **SHIP IT**. This is a tracked
**post-ship addition** to the already-shipped `/` page, requested directly
(four scoped changes), not a pipeline re-open — the Per-Phase Status table
above is intentionally untouched. The brief referenced a "Post-ship
correction (operator, 2026-08-27) — public `/` page, second revision"
subsection as the source of the full requirements; at the time this work
started, no such subsection existed yet in this file (confirmed by search).
The task message itself carried the full, detailed brief, so implementation
proceeded from that directly rather than blocking on a missing work-log
section — named here as a deviation, not silently worked around.

### What changed, and why

1. **Top sign-in bar.** A slim `border-b border-border bg-background` header
   now sits above the hero: the "PresbyPortal" wordmark (linking to `/`) on
   the left, the auth action on the right — "Sign in" when signed out;
   "Sign out" + "Continue" (→ `/launch`) when signed in, in that order,
   matching the prior bottom-of-page control's variants exactly (default
   `Button` for Sign in/Sign out, `outline` for Continue). The old
   bottom-of-page CTA row (the `<div className="flex gap-3">` block with the
   same three controls) was **removed**, not kept — with the top bar in
   place, repeating the same buttons lower on the page read as two
   competing prompts rather than a deliberate second chance to act. The
   "Welcome back, {name}." greeting stayed exactly where it was; a greeting
   with no button attached isn't a competing CTA.
2. **PresbyPortal naming (DECISION-126).** Every prose use of "presby" as a
   stand-in product name was replaced with "PresbyPortal": the hero body
   ("PresbyPortal is built around that shape…"), the "What PresbyPortal
   does" heading, and "adopts PresbyPortal" in the Public websites card. The
   small uppercase "presby" kicker that sat above the `<h1>` in the prior
   pass — added specifically to keep the unnamed-project placeholder visible
   without making the headline itself the placeholder word — is now
   **removed** rather than relabeled: its entire reason for existing was the
   project not having a settled name, and DECISION-126 closed that; the top
   bar's wordmark now carries the name instead of a second, smaller label
   repeating it. Code identifiers (`presby_app`, `presby_*` SQL functions,
   the `presby` GitHub repo/org name, `docs/work-log` filenames) are
   unaffected — this was a copy-only change scoped to this one file, per
   `docs/STATE.md`'s explicit "internal code identifiers do not change until
   [the rename pipeline] runs."
3. **Open source / sponsor section.** A short, two-line "Open source"
   section states the sponsor line verbatim: "PresbyPortal is open source,
   and its development is supported by the mission of First Presbyterian
   Church of Westerville." This is the **one sanctioned exception** to the
   No Real Data invariant on this page — real, willing-sponsor attribution,
   not fixture/seed data masquerading as real (CLAUDE.md → No Real Data
   guards the opposite direction). No other section on the page names a real
   congregation; verified by re-reading the diff line by line before
   finishing.
4. **Architecture teaser.** A "How it's built" section names three
   distinctive points from `docs/architecture.md` — the forced-RLS isolation
   model ("a tenant table can't be queried across organizations even by a
   bug, because the database itself refuses the read"), the roll as an
   append-only ledger rather than a status field, and the connectional data
   model (authority flows up through the courts by publication, never down
   by inheritance) — the third one explicitly ties back to the hero's own
   four-court diagram ("The same connectional shape drawn above governs the
   data too"). It ends with a real link, not a fabricated one:
   `docs/architecture.md` isn't served by any in-app route today (confirmed
   by reading `src/app/(admin)/admin/docs/page.tsx` directly — that route
   only renders `docs/release-notes/*.md`, nothing else under `docs/`), so
   the pointer is the file's actual GitHub blob URL on the real public repo,
   `https://github.com/chenson42/presby/blob/main/docs/architecture.md`
   (confirmed the file is committed on `main` before using the link).
5. **Get involved section.** States plainly that the source is public on
   GitHub under the MIT license (confirmed against the repo's actual
   `LICENSE` file) and links to the real repo,
   `https://github.com/chenson42/presby`. No invented contribution process —
   `CONTRIBUTING.md` doesn't exist in this repo (confirmed), so the copy
   says "Formal contribution guidelines aren't written yet" instead of
   describing a PR/review flow that isn't built.

Both external links (architecture doc, repo) share one `EXTERNAL_LINK_CLASSNAME`
constant — the platform's documented focus-ring pattern
(`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
focus-visible:ring-offset-background`) applied to an inline text link, since
no shadcn primitive covers that shape and the app had no prior external-link
precedent to follow (checked — zero `target="_blank"` usages anywhere else
in `src/`). Both open in a new tab (`target="_blank" rel="noreferrer"`)
since they leave the app.

No native browser dialogs, no new npm dependencies, no new font import, no
Tailwind palette literals (only existing tokens: `bg-background`,
`border-border`, `text-foreground`, `text-primary`, `text-muted-foreground`).
Platform tokens only, as required — this route stays outside the two
brandable groups either way.

### Files Modified

- `src/app/page.tsx` — top `<header>` bar added above the hero; the kicker
  paragraph removed from the hero; three prose "presby" → "PresbyPortal"
  edits; the bottom-of-page CTA row removed (its two conditionals relocated
  to the header, byte-identical in href/redirect behavior); three new
  `<section>`s added after "Who it's for" ("How it's built", "Open source",
  "Get involved"); one new local `EXTERNAL_LINK_CLASSNAME` constant. No new
  imports.
- `src/app/page.test.tsx` — rewritten for the new structure. 15 tests (was
  11): the signed-out/signed-in/email-fallback DECISION-034 tests carried
  over verbatim (unaffected by the relocation — they query by role/name, not
  position); a new top-bar test asserting the "PresbyPortal" wordmark links
  to `/`; the old "renders the 'presby' kicker" hero test replaced with a
  headline-only assertion (the kicker is gone); the "never implies a chosen
  product name" test rewritten to assert PresbyPortal naming instead of the
  old presby-placeholder framing, carefully excluding the real
  `github.com/chenson42/presby` repo-name text (a legitimate, unchangeable
  identifier, not a naming placeholder) from the negative assertion; three
  new tests for the Open source, architecture-teaser, and Get-involved
  sections, including asserting the actual `href` values of both external
  links and that the not-yet-real contribution-process line renders.

### Schema Changes

None.

### Audit Events

None — same public, unauthenticated marketing page as before, no mutation.

### Verification

- `npm run typecheck` — clean, zero errors.
- `npx vitest run src/app/page.test.tsx` — 15/15 passed. (Two tests needed a
  fix mid-implementation: `getByText(/permanent record/i)` matched both the
  hero paragraph and the new architecture section, so the assertion was
  retargeted to a phrase unique to the architecture section
  ("never edited afterward"); a blanket `queryByText(/\bpresby\b/i)` check
  also matched the visible `github.com/chenson42/presby` link text, so it
  was narrowed to `/^presby$/i` — the real repo name in a URL is not the
  naming-placeholder concern that test exists to catch.)
- `npm test` (full suite) — **228 test files passed, 23 skipped
  (pre-existing, unrelated); 2977 tests passed (2973 baseline + this
  commit's net +4: 15 vs. the prior pass's 11); 552 skipped (pre-existing,
  unrelated); 0 failed.**
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all
  four tripwires pass.
- `npx eslint src/app/page.tsx src/app/page.test.tsx` — clean.

### Browser Verification

Dev server already running on `localhost:3000`; `/tmp/state.json` is the
existing full-admin (`admin` role, E2E Admin) storage state. Playwright,
headless Chromium, three contexts:

- **Signed-out, 1280px** (`marketing-v2-top.png`, `marketing-v2-full.png`):
  the top bar renders "PresbyPortal" + a single "Sign in" button; the hero,
  diagram, and both original quiet sections are unchanged in substance; "How
  it's built," "Open source," and "Get involved" all render below "Who it's
  for," in that order, each with correct copy and working links (verified
  the architecture link's `href` is the GitHub blob URL and the repo link's
  `href` is the bare repo URL). Programmatic count confirmed exactly one
  "Sign in" link, zero "Continue" links, zero "Sign out" buttons on this
  page load — no duplicate or competing prompt.
- **Signed-out, 360px** (`marketing-v2-360.png`): top bar stays a comfortable
  touch target and doesn't wrap awkwardly against the wordmark; every new
  section reflows to single-column cleanly; no horizontal scroll; the
  external links remain legible and tappable.
- **Signed-in, 1280px** (`marketing-v2-signedin.png`, fresh context with
  `/tmp/state.json`): top bar shows "Sign out" + "Continue" (confirmed
  `href="/launch"`), zero "Sign in" links; "Welcome back, E2E Admin." still
  renders lower on the page, now as a plain informational line with no
  button attached — confirmed no competing CTA. Programmatic count: 0 Sign
  in, 1 Continue, 1 Sign out, 1 Welcome-back line. DECISION-034's behavior
  (never a redirect, `/launch` is the Continue target, the exact
  `'use server'` sign-out form) is unchanged — only relocated.

Screenshots are ephemeral verification artifacts (same precedent as the
prior two passes), written to the scratchpad, not added to version control.

### Implementer Notes

- **The "Post-ship correction … second revision" work-log subsection named
  in the task brief did not exist at the time this work started** (verified
  by direct search of this file). Proceeded from the task message's own
  detailed brief instead of blocking on it — flagging this so the
  orchestrator can reconcile whichever section it intended to have been
  here first, if any, against what actually shipped.
- **`docs/ui-standards.md`'s `hero` type-scale exception note (added in the
  prior pass) needed no changes** — the `hero` role still has exactly one
  consumer (`<h1>` on this page); nothing in this revision touches
  headline-level typography.
- **No changes to `docs/product/functionality-map.md`, `docs/TODO.md`, or
  `docs/architecture.md`** — this is copy on an already-shipped page, not a
  new capability; nothing here changes what's built or not-built. The one
  new externally-visible claim (the FPCW sponsor line) is attribution, not a
  functionality claim, so it doesn't belong in the functionality map.
- **New copy strings a fork's branding pass should review:** the
  "PresbyPortal" wordmark/name itself (already the settled project name per
  DECISION-126, but a fork operating under a different name would replace
  every occurrence on this page); the FPCW sponsor line (a fork sponsoring a
  different real congregation, or none, replaces or removes this line
  entirely — it is not a template to keep with a different name filled in,
  it names a specific real relationship this fork doesn't have); the GitHub
  repo/architecture links (a fork's own repository, if it has one, has its
  own URL).
- **No native dialogs, no new dependencies, no new font import** — confirmed
  by reading the diff; only Tailwind utility classes and one new local
  constant were added.

---

## Commit 2 (full-stack-developer) — merged `/home`, the `/orgs` redirect, `destination.ts`'s literal, stale-link cleanup

**Date:** 2026-08-27 · **Implementer:** full-stack-developer

### Files Created

- `src/components/shared/destination-card.tsx` — `DestinationCard`, relocated
  mechanically (unmodified in behavior, "MOVED HERE, UNMODIFIED" header
  comment matching `greeting-band.tsx`/`feedback-prompt-card.tsx`'s own
  precedent) from `src/app/(member)/orgs/destination-card.tsx`. Same markup,
  same styling, same contract — the whole card is the `<Link>`, focus ring on
  the link not the card, `title` an `<h3>` per `docs/ui-standards.md`.
- `src/app/(member)/home/page.test.tsx` — orchestration tests for the merged
  page: `platform.merged_home` OFF renders exactly the pre-merge shape and
  never calls `cachedUserOrganizations()`/`cachedIsPlatformAdmin()`; ON, a
  multi-org member sees both org cards and no Platform section; ON,
  `canAccessAdmin` alone renders the Admin card but not Developer; ON,
  `isPlatformAdmin` alone (zero organizations) renders Developer but not
  Admin and no "Your organizations" heading (Developer-card independence,
  DECISION-044); both predicates held renders both cards; a pending
  (`invited`) relationship renders "Still being set up" with no link; no
  `nothingToShow` empty state exists regardless of how the page is reached;
  the org-list read failing degrades to `<OrganizationsUnavailable>` ALONE —
  no greeting, no what's-new, no feedback prompt, and
  `getFeedbackPromptState()` is never called. 9/9 passing.

### Files Modified

- `src/app/(member)/home/page.tsx` — rewritten to absorb `/orgs`'s content
  behind `platform.merged_home` (`isFlagEnabled`). ON: "Your organizations"
  (enterable cards, rendered only when non-empty), "Platform" (Admin card iff
  `sessionCanAccessAdmin(user)`, Developer card iff `cachedIsPlatformAdmin()`
  — independently, DECISION-044), "Still being set up" (pending `invited`
  orgs) — each section's heading lives inside its own conditional, never
  above an empty section. The org-list `Promise.all` degrade is carried over
  verbatim from `/orgs`: a throw returns `<OrganizationsUnavailable
  retryHref="/home" />` ALONE, before the what's-new query or the feedback-
  prompt-state read ever run. OFF: the DB reads for organizations/platform-
  admin never happen at all (not just their rendering skipped) — the flag's
  whole job is a content-only rollback that costs nothing beyond the toggle
  check — and the page renders exactly its pre-merge shape, including the
  restored "Admin dashboard" quick link (`isAdmin` check, unchanged from the
  pre-merge page). No `nothingToShow` block carried over (Phase 3: provably
  unreachable via the chooser reason, would be an untestable branch). Data
  reads mirror `/orgs`'s prior shape exactly:
  `Promise.all([cachedUserOrganizations(id), cachedIsPlatformAdmin(id)])`
  (memoized readers, same ones the header already reads this request),
  `sessionCanAccessAdmin(session.user)`, unchanged what's-new query, unchanged
  feedback-prompt-state read.
- `next.config.ts` — added `redirects()`: `{ source: "/orgs", destination:
  "/home", permanent: true }` (308). Never enters the React render pipeline —
  no `loading.tsx` to accidentally open on a segment whose whole job would
  otherwise be to redirect.
- `src/app/launch/destination.ts` — the one literal change: both
  `"chooser"`-reason `return` statements' `path` changed from `"/orgs"` to
  `"/home"`. `platform.merged_home` is NOT threaded into this function or
  `DestinationInput` (Phase 3's explicit ruling, DECISION-124) — the function
  keeps its zero-import purity. Two doc comments (the `orgSlugFromPath`
  header, the final chooser branch) updated to describe the new target.
- `src/app/launch/destination.test.ts` — the 6 chooser-reason call sites
  (previously 5 single-line + 1 multi-line assertion) updated from `{ path:
  "/orgs", reason: "chooser" }` to `{ path: "/home", reason: "chooser" }`. The
  one requested-path literal test (`requestedPath: "/orgs"` → `{ path:
  "/orgs", reason: "requested-path" }`) is UNCHANGED per Phase 3 — it tests
  the pure requested-path-honoring branch, not the chooser, and a stale
  `?next=/orgs` bookmark still round-trips correctly via the config redirect
  regardless. 18/18 passing (up from 18 — no test added/removed, only
  assertions retargeted).
- `scripts/seed.ts` — added the `platform.merged_home` feature-flag row
  (`enabled: true`, per DECISION-124/architect's Phase 2 ruling that this is
  a live-ship, not a dark launch) with a description matching the flag's
  content-only-rollback contract. Inserted just before the "PRODUCT-IA
  SCAFFOLD PLACEHOLDER FLAGS" block (unrelated to that go-live sweep, kept
  separate).
- `src/components/shared/org-switcher.tsx` — the "All organizations" item's
  `href` changed from `/orgs` to `/home`, and its visible copy changed to "Go
  to your home page" (Phase 3's literal instruction). Two doc comments
  updated (the item's own JSDoc, and the `currentName` prop's "no
  organization context" example list, which dropped `/orgs` since it no
  longer exists as a page).
- `src/components/shared/org-switcher.test.tsx` — the "always offers the full
  chooser as the last item" test updated to query/assert `"Go to your home
  page"` / `href="/home"`; the no-org-context test's doc comment dropped
  `/orgs`.
- `src/app/no-organization/page.tsx:73` — "Choose where to go" link's `href`
  changed from `/orgs` to `/home`.
- `src/proxy.test.ts` — the "leaves /orgs outside the 2FA gate" test
  RETARGETED, not deleted, to `/home` (Phase 3's explicit instruction — the
  underlying property, that the chooser-equivalent page sits outside the org
  2FA gate, is still true and still worth asserting at the new path). Test
  name and both doc comments (file header, test body) updated to describe
  `/home` as the current chooser-equivalent surface and `/orgs` as its
  retired former self.
- `src/proxy.ts` — two comments updated for accuracy: the `isTwoFactorGated`
  block's "/orgs".startsWith("/o/") === false" note now reads `/home`'s
  equivalent, and the auth-only route list's trailing comment now notes
  `/orgs` no longer reaches this file at all (intercepted by the
  `next.config.ts` redirect before `edgeAuth()` runs).
- **Documentation-accuracy passes on files this commit's mechanism directly
  changed** (none change runtime behavior — comment-only, but left stale they
  would actively mislead the next reader): `src/app/launch/page.tsx`,
  `src/components/shared/organizations-unavailable.tsx`,
  `src/lib/authz.ts`/`authz.test.ts`, `src/lib/nav-data.ts`,
  `src/lib/platform-admin.ts`/`platform-admin.test.ts`, `src/app/robots.ts`,
  `src/app/(admin)/admin/design-system/page.tsx`'s example-card blurb
  (`/orgs` → `/home`). None of these were in Phase 3's named stale-link list;
  found by a full-repo grep for `/orgs` after the org-switcher copy change
  made the "All organizations" string itself stale in three more places (see
  e2e changes below) — the same grep surfaced these doc comments.
- `e2e/post-login-routing.spec.ts` — test 7 (two orgs → chooser) now asserts
  `/home` (the sign-in round trip never visits `/orgs` at all, since
  `computeDestination` now returns `/home` directly); test 10 (chooser is a
  convenience, never a gate) renamed and updated to assert `page.goto
  ("/orgs")` lands on `/home` with a 200 final response, not a stale `/orgs`
  render; test 12 (org switcher reaches the chooser) updated to click "Go to
  your home page" and wait for `/home`, not `/orgs`. Each carries a CONTRACT
  CHANGE comment naming DECISION-124.
- `e2e/header-controls.spec.ts` — the "offers the full chooser" test and the
  keyboard-navigation test both updated from "All organizations" text /
  `/orgs` target to "Go to your home page" / `/home`.
- `e2e/member-home.spec.ts` — test 4b renamed and updated: `platform.
  merged_home` seeded ON means the "Admin dashboard" quick link no longer
  renders for an admin visiting `/home` directly (the merged Platform
  section's Admin card covers that destination instead); the test now
  asserts the Platform heading and the Admin destination-card link render as
  real, accessible `<a>` elements instead. The a7-primitive-sweep regression
  this test guards against is preserved at the new location, not dropped.

### Files Deleted

- `src/app/(member)/orgs/page.tsx`, `error.tsx`, `loading.tsx`,
  `destination-card.tsx` — the entire segment, not left as a redirect-only
  stub (Phase 3's explicit instruction). No test file existed for this
  segment to relocate.

### Schema Changes

- None. `platform.merged_home` is a `feature_flags` data row, not a schema
  change — no `db:push`/`db:generate`. Applied to the live dev database via a
  direct `psql` `INSERT ... ON CONFLICT (key) DO NOTHING` mirroring
  `scripts/seed.ts`'s new entry exactly (mirrors commit 1's own
  live-dev-DB-fix pattern for the same reason: verifiable in a browser
  without a fresh `db:seed` run). Verified with a follow-up `SELECT`:
  `platform.merged_home | enabled = t`.

### Audit Events

- None. No new security-sensitive mutation — a rendering/routing change and
  a seed-data flag row, not a runtime mutation path a signed-in user
  triggers.

### Verification

- `npm run typecheck` — clean, zero errors (after restarting the dev server
  and clearing `.next/` — Next's route-type generation had a stale
  `../../src/app/(member)/orgs/page.tsx` reference from before the segment
  was deleted; `next.config.ts`'s new `redirects()` export also requires a
  server restart to take effect, since Next only reads config at boot).
- `npm test` (plain Vitest run) — **228 test files passed, 23 skipped
  (pre-existing, unrelated); 2973 tests passed, 552 skipped (pre-existing,
  unrelated); 0 failed.** (A `src/app/page.test.tsx` failure — commit 3's own
  file, untouched by this commit — was observed transiently mid-session while
  commit 3 was landing concurrently in the same working tree; it was gone on
  the next full run with no action from this commit, confirming it was
  commit 3's in-progress state, not something commit 2 caused or fixed.)
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all
  four tripwires pass.
- `npx eslint` on every file this commit touched — clean.
- `destination.test.ts` — 18/18 passing, confirming the single-org,
  platform-admin-only, and no-organization fast paths are byte-identical to
  before (only the 6 chooser-reason assertions changed).
- `e2e/*.spec.ts` changes above were edited but **not run against a live
  server as part of this commit's gate** — CLAUDE.md's Phase 4 gate requires
  a running-server e2e smoke only for auth-path-touching changes
  (`src/auth.ts`, `(auth)/`, `api/auth/`, `lib/auth/`); this commit touches
  none of those. The updated assertions were hand-verified against the same
  live dev server used for browser verification below (curl for the
  redirect status, a scripted Playwright session against `/home` for the org
  switcher's "Go to your home page" target) rather than a full `npm run
  test:e2e` pass, which QA's Phase 5 is the natural place to run in full.

### Browser Verification

Dev server restarted (required for `next.config.ts`'s new `redirects()` to
take effect) and re-verified up; `/tmp/state.json` is a full-admin (`admin`
role, `canAccessAdmin` true, `isPlatformAdmin` false) session holding real
memberships at `northern-reach` (presbytery) and `fpcw` (congregation) — the
"admin+orgs" persona from Phase 3's Browser Verification Matrix.

- **`/home`, 1280px** (`merged-home.png`): greeting "Welcome, E2E Admin.";
  "Your organizations" with two cards ("Presbytery of the Northern Reach" /
  Presbytery, "First Presbyterian Church of Westerville" / Congregation — name
  + type only, no membership language anywhere on the page); "Platform" with
  the Admin card only (no Developer card — this fixture is not
  `isPlatformAdmin`, confirming the two-predicates-independent gating);
  "Quick links" with "Account settings" only (no "Admin dashboard" — dropped
  because the Platform section above already covers it); What's-new (3
  seeded entries); the feedback prompt card. Matches Phase 3's Component Plan
  composition order exactly.
- **`/home`, 360px** (`merged-home-360.png`): single-column stacking, both org
  cards and the Admin card full-width, no overflow or clipping, feedback
  card's three actions remain reachable and legible.
- **`/orgs` → `/home` redirect** (`curl -sI http://localhost:3000/orgs`):
  ```
  HTTP/1.1 308 Permanent Redirect
  location: /home
  ```
- **The platform-admin-zero-orgs and multi-org-no-platform personas from
  Phase 3's matrix were NOT separately screenshotted** — no e2e fixture
  exists for either today (same gap Phase 3's Edge Cases named for the
  `support_operator` persona in commit 1), and constructing one would mean a
  second Playwright storage state, out of scope for this commit's browser
  pass. Both are instead covered by `page.test.tsx`'s dedicated unit tests
  (`isPlatformAdmin` alone → Developer card, no Admin, no org section; a
  2-org fixture with neither predicate → both cards, no Platform section),
  which exercise the exact same render branches a browser would. Naming this
  honestly rather than claiming screenshot coverage that doesn't exist.
- **The launch flow's fast paths (single-org, platform-admin-only) were NOT
  re-verified by signing out and back in** — no credential-based sign-out is
  available against the current session/storage-state setup, and this
  commit did not change either fast-path branch (only the chooser-reason
  literal). Verified instead via `destination.test.ts`'s unchanged
  single-org/platform-admin-only assertions, all 18/18 passing — the same
  honesty-over-fabricated-coverage principle as above.

### Implementer Notes

- **`e2e/support/routes.ts`'s visual-parity manifest still carries a `path:
  "/orgs"` entry (`storageState: "org-multi"`) — found, not fixed here.**
  `/orgs` redirecting means this entry now violates the file's own selection
  rule ("renders, never redirects"): the harness's `page.goto` follows the
  308 and gets a real 200 from `/home`, so `expectedStatus: 200` still
  passes, but the screenshot captured under the `orgs-*.png` filename is now
  `/home`'s merged content, not the old chooser page — and `routeSlug()`
  derives its filename purely from `path`, ignoring `storageState`, so simply
  renaming this entry's `path` to `/home` would collide with the manifest's
  existing `path: "/home"` (`storageState: "member"`) entry's own screenshot
  filename. Fixing this correctly needs either a `routeSlug` change or
  dropping the entry, plus a baseline re-capture (`npm run visual:baseline`)
  — not something to do blind inside this commit. Logged to `docs/TODO.md`.
- **Six `(org)/o/[slug]` error/not-found surfaces still link `/orgs`** for
  their "Back to your organizations" affordance. Functionally correct (the
  redirect still lands them on `/home`) but Phase 3's stale-link list
  deliberately scoped cleanup to three specific files, not these six —
  logged to `docs/TODO.md` as a cosmetic follow-up rather than expanded into
  scope here.
- **`docs/product/functionality-map.md` not updated in this commit** — same
  reasoning as commit 1's note: Rule 14 ties that update to ship time (Phase
  6), and commit 3 (the `/` copy expansion) is still outstanding.

**Handoff:** commit 3 remains (ux-developer, `/` copy expansion, foldable).
Once all three commits are complete, qa (Phase 5) should run the full
`test:e2e` suite (not just the hand-verified subset above) — in particular
`e2e/post-login-routing.spec.ts` tests 7/10/12, `e2e/header-controls.spec.ts`,
and `e2e/member-home.spec.ts` test 4b, all edited by this commit — against a
real dev server, and confirm the feature-gate audit for `platform.
merged_home` (content-only, no new authorization surface per Phase 3).

---

# Phase 5 — Verification (qa)

## Auth-gate applicability

Does NOT apply — no file under src/auth.ts, src/app/(auth)/, src/app/api/auth/, or src/lib/auth/ is touched (destination.ts is src/app/launch/; proxy.ts changes are comment-only). A live e2e smoke was run anyway given the every-sign-in blast radius.

## Runs

- npm run typecheck: clean. npm test: 2973/2973 passed, 0 failed (552 pre-existing skips, none in this pipeline's files — verified by isolated re-run: 141/141). npm run check: 4/4 tripwires.
- **Live e2e** (real dev server): 41 total across the three affected specs, 35 passed, 6 failed — **all 6 traced to causes outside this pipeline's diff**: a shared "admin" e2e fixture account carrying real org memberships since 2026-08-24 (predates this pipeline, breaking the zero-org-platform-admin fast-path precondition) and an already-shipped, unrelated org_portal.home_v2 copy change. Every assertion this pipeline itself added or modified — the /home redirect-target checks, org-switcher copy/href, Admin-dashboard-quick-link removal — passed.
- Live smoke: curl confirmed a real 308 /orgs→/home; /home renders Admin card without Developer card for this isPlatformAdmin=false fixture (the two-predicate independence, live); /admin renders with GreetingBand; 360px clean on /home, /admin, and /.

## Verified by direct read (not inferred from green tests)

- destination.ts's ONLY change is the two chooser-reason path literals; branches 1-4 are character-for-character untouched.
- platform.merged_home is read ONLY inside home/page.tsx — never threaded into destination.ts or DestinationInput (the architect's ruling honored).
- /home's Admin and Developer cards are two independently-evaluated conditionals, not one shared boolean (DECISION-044 upheld); org cards carry name+type only (DECISION-039).
- admin-portal/tiles.ts confirmed to import neither hasFeature nor isFlagEnabled (source-scan test) — the pure-registry constraint held.
- Both org-portal call sites migrated to the shared components; no orphaned duplicates remain.
- Stale-link sweep: only the two deliberately-deferred /orgs references remain, both confirmed actually named in docs/TODO.md.
- Marketing page: hero type-scale role documented (not silent); no Tailwind palette literals; DECISION-034 Continue behavior byte-identical; copy claims nothing beyond functionality-map.md.
- Live DB: support_operator now bound to admin.dashboard/.feedback/.tickets; demo.new_dashboard flag row absent; platform.merged_home enabled=true.

## Follow-up named, not silently absorbed

The shared e2e "admin" fixture account has accumulated real org memberships from repeated manual dev-DB browser verification across pipelines (including this one) — the zero-org-platform-admin fast path is currently only unit-tested, not e2e-verifiable. Recommend a dedicated, disposable zero-org platform-admin e2e fixture.

## Verdict

**PASS**

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> All four things the operator asked for landed — a landing page that sells the product, a merged /home that reads as one page, an /admin visibly the same portal as /o/<slug>, a conditional experience that neither over-shows nor breaks the fast path — but this ships live to every user immediately (platform.merged_home seeded ON), so the functionality-map staleness and missing what's-new entry are not deferrable housekeeping, they're part of shipping honestly.

## Live verification

/ (signed out, 1280+360): the connectional-courts framing lands — the subhead cashes out "connectional" in plain language before the diagram appears, so it doesn't require prior Presbyterian-polity knowledge. Copy stays disciplined against functionality-map.md (no claim beyond shipped capability). /home (two-org, canAccessAdmin session): reads as one coherent shell, not two pages stapled together — composition order matches the design exactly. /admin side-by-side with /o/fpcw/admin: same greeting-band-with-accent-stripe, same domain-sectioned grid, same tile styling — the clearest win in the pipeline; org-portal axis renders byte-for-byte unchanged. Conditional experience: destination.ts's only change is the two chooser literals (confirmed by diff); a full-admin session sees exactly its held tiles; the previous all-ten-cards defect is gone.

## Intent-vs-Shipped

All four Phase 1 asks matched, including two additional real defects found and fixed along the way (all-ten-cards-shown; support_operator's total /admin exclusion — DECISION-123), both documented not silently absorbed. The commit-3 reversal (functional description → marketing) is recorded honestly — the work-log preserves the first pass under its own heading rather than cleaning up the history.

## Edge Cases

Empty state pass (admin's zero-tile honest empty card). Failure microcopy pass (OrganizationsUnavailable degrade carried over verbatim). Permission gate pass, with one honest residual: the support_operator exactly-2-tiles case is unit-tested only, never walked in a live browser (already named, low-risk given the pure-data design). Audit n/a (no new mutation path). Mobile pass on /, /home, /admin.

## Additional judgments

QA's 6 e2e failures independently spot-checked, not taken on faith — the fixture-membership-drift root cause confirmed documented as far back as 2026-08-24 across four unrelated pipelines. Both required TODO follow-ups (e2e-fixture pollution; NWC scope) confirmed present exactly once, correctly attributed. DECISION-123/124/125 checked against actual source — no drift.

**functionality-map.md: confirmed stale in four spots, none touched by this pipeline (verified — its uncommitted diff belongs entirely to the concurrent presbytery pipeline). Corrected at close, not deferred**, given Rule 14's own text: "the backstop, not the place to defer a change you just shipped."

**Rule 13: an entry is warranted now, not deferred.** platform.merged_home ships enabled:true — every signed-in user's landing page changes immediately. **Published at close** (see below).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

**Housekeeping closed at commit:** functionality-map.md corrected (four spots + naming update to PresbyPortal), what's-new entry published (`whats_new_entries` row, "Your home page just got more useful"), TODO Done line added. Release notes at next cut (Feature class). Rule 12 n/a.
