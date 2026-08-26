# Org Portal Administration Hub — Work Log

> **Slug:** `2026-08-26-portal-reorg-and-modernization`
> **Surface:** `(org)/o/[slug]` portal shell/IA only — a net-new `/o/[slug]/admin` hub index and a `category` discriminant on `PORTAL_TILES` (`src/lib/org-portal/tiles.ts`)
> **Permission(s):** none new. Folds in the already-shipped `org_features.manage`-gated Features page (link-only, zero server change) and the (also already-shipped, sibling pipeline) `officers.manage`-gated Officers pages.
> **Flag(s):** a new `org_portal.admin_hub` flag, seeded off.
> **Estimated complexity:** small-medium — one new Server Component page, one field addition to an existing registry, no schema, no permission.
> **Pipeline mode:** Full, but narrowed. Split at Phase 2 (architect, 2026-08-26) from the original combined "portal reorg & visual modernization" pass into three siblings — this file keeps only the hub/IA piece. See `docs/work-log/2026-08-26-tenant-branding-permission.md` and `docs/work-log/2026-08-26-portal-visual-modernization.md` for the other two.
> **Source — operator direction (2026-08-26):** "org administration might need its own page (similar to `../fpcw-directory`'s admin page)... the main portal page should be all about functionality for that organization. org admin should be about setting up this org." Carried forward unabridged from the original combined Phase 1 below.

**Note on Phase 1 below:** retained unabridged (the branding and visual-modernization slices apply to the sibling files now, not here, per the Phase 2 ruling — kept as the historical record of the combined analysis rather than edited down, matching the `groups-and-officers` precedent).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | ux-developer | Complete | Implemented, tests written and passing | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Two of the three sub-asks (the admin hub/IA split, and the visual-chrome pass) are straightforward extensions of existing, already-shipped patterns and are close to ready; the third (moving branding from platform-only to tenant-self-service) is the one genuinely invariant-adjacent decision in this work-log and must not be waved through as "just add a permission" — it needs the architect's explicit ruling on directionality before Phase 3 designs anything, and the analyst recommends forking it into its own pipeline.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member, org portal (`/o/[slug]`) | Browses directory, files/tracks a ticket, gives feedback, finds a person | Per session, frequent |
| Authenticated member holding ≥1 `*.manage` tenant permission | Opens a new "Organization Administration" hub (`/o/[slug]/admin`, net-new index) | Occasional, deliberate |
| Org admin (`branding.manage` — net-new tenant permission, name TBD Phase 3) | Sets seed color, type pairing, logo, light-only toggle for their own congregation | Rare (setup/rebrand), from the hub |
| Org admin (`org_features.manage` — existing) | Toggles an optional portal feature on/off for their org | Rare, from the hub (page itself unchanged, only newly linked) |
| Org admin (`people.manage`, `role_grants.manage`, `officers.manage` — existing) | Adds a person/approves roll actions, grants/revokes roles, records officer terms | Occasional — relocated (link-only) from the main page into the hub |
| Any org-page viewer | Experiences a bolder/more energetic visual chrome (color blocks, type weight, motion) on existing flows | Every visit — presentation delta, not a new verb |
| Platform admin (`FEATURES.ADMIN_ORGANIZATIONS`) | Continues to reach `/admin/organizations/[id]`'s brand form (status TBD — retire vs. keep as override) | Unchanged unless Phase 3 retires it |

**Named split for "is officers setup or day-to-day":** the defensible line isn't frequency, it's audience. Directory/Tickets/Feedback are reachable and meaningful to *every* member regardless of permission level — "day-to-day," stays on `/o/[slug]`. Members/Roles/Officers/Features/(new) Branding are all destinations whose own page gates on a `*.manage`/`*.propose` tenant permission — a permission-less member never has a reason to be there. That's "setup," moves to the hub. Officers records a rare event, but so does granting a role — rarity isn't the test; "does this exist only for permission holders" is, and Officers passes that test the same way Roles does.

## Flows

**Flow 1 — Reach the Organization Administration hub:** entry: `/o/[slug]` → a persistent "Administration" link (placement TBD) → `/o/[slug]/admin` (net-new index route) → card grid (fpcw-directory pattern: flat, no sidebar) → click a card → destination page.
- Failure: hub-level flag off → generic unavailable state. **Undefined by the request:** does a viewer with zero setup permissions see every card present but every click 403s, or does the hub itself hide cards it can determine the viewer lacks permission for? Changes the empty-state design materially (Gap #2).

**Flow 2 — Org admin sets branding for their own congregation:** entry: hub → "Branding" card → `/o/[slug]/admin/branding` (net-new `(org)`-scoped route, `withOrgContext()` only) → pick seed hex / type pairing / optional logo / light-only → submit → server re-validates hex format and the new tenant permission via `presby_has_permission()` → generator computes tokens, contrast floor enforced algorithmically (confirmed, Gap #6) → brand row written, `organizationBrandHistory` row written (existing table, actor-agnostic schema), audit event fires, live site path revalidated.
- Failure: invalid hex → inline error, client and server; logo upload failure → no-op on resubmit with no other changes (existing behavior, must replicate); permission denied → the page's own `Forbidden` state, matching every other `/o/[slug]/admin/*` page.

**Flow 3 — Org admin toggles a feature, now discoverable:** entry: hub → "Features" card → **the existing, unmodified** `/o/[slug]/admin/features` page → toggle → existing `toggleOrgFeature()` path, already audited (`ORG_FEATURE_TOGGLED`). Confirmed: zero server-side change required — this is pure discoverability/linking work. The operator's "features are gonna have to be enabled/disabled by the org admin" is **already shipped**; the gap is only that nothing points at it.
- Failure: unchanged — existing `FeaturesForbidden`/`FeaturesLoadError`/`FeaturesFlagOff` states already cover this.

**Flow 4 — Visual modernization is a cross-cutting delta** on Flows 1–3 and the existing main-page flows, not a new flow with its own entry/outcome.
- Failure: if a scroll/reveal motion technique needs JS to become visible and that JS fails or is blocked, content must not stay invisible — CSS-only, `prefers-reduced-motion`-respecting techniques are the safe default.

## Permissions & Flags

**Part A.1 — hub + reclassification:**
- No new permission for the hub route itself, but Phase 3 must design an "does this viewer hold at least one setup-category permission" check — no aggregate helper exists today (every existing check is single-permission).
- New flag following the `org_portal.*` convention: something like `org_portal.admin_hub`, default off until wired.
- `PortalTile` needs a new discriminant field (`category: "operate" | "administer"`, naming TBD Phase 3) on the **single existing** `PORTAL_TILES` registry — not a second parallel array. `category` must be presentational routing only, never a second permission check (DECISION-003).

**Part A.2 — branding permission move (the load-bearing one):**
- New tenant permission required, name TBD Phase 3, following the `<noun>.manage` convention.
- Default role bindings: **do not silently reuse** the bootstrap Stated-Clerk-equivalent office every prior new tenant permission has ridden along on. Branding writes to a **public-facing** surface (the org's live site); prior permissions are all internal-data mutations. Different blast radius — "No Role Carries a Wildcard" argues for an explicit decision here.
- Flag: recommend `org_portal.branding` for the new tenant editor.
- **Confirmed via source:** `FEATURES.ADMIN_ORGANIZATIONS` is a platform-shell RBAC feature, entirely disjoint from `presby_has_permission()`. **Confirmed via the code's own comment** (`(admin)/admin/organizations/[id]/actions.ts:41-49`): this exact tenant-facing editor is already named in the codebase as "slice d, still blocked on P1's tenant permission catalog" — this Phase 1 pass is the blocking dependency the code already anticipated. A point in favor of the ask being well-formed, not a license to skip architect review of directionality.
- Org-type gating: `organizationType` has five values; nothing today differentiates branding access by type, and the request doesn't say. Open Question.

**Part B — visual modernization:**
- No new permission.
- Recommend a flag for the motion piece specifically (`org_portal.motion` or similar) since motion is the one genuinely behavioral change; pure shadow/type-scale CSS changes don't need their own flag if they carry no behavioral branch.

## Gaps the Request Didn't Address

1. **Reclassification churn.** Moving Members/Roles/Officers off the main page onto a hub is a small UX regression for muscle memory — URLs don't change, only where they're linked from; Phase 3 should decide whether a transition period keeps a pointer on the main page.
2. **Hub empty/permission-mismatch state is undefined** (Flow 1) — matters more than usual here since the hub's whole premise is "the operator has trouble finding branding setup." If the hub itself is a dead end for a brand-new org, the stated problem isn't solved.
3. **Mobile (360px) is not automatically inherited.** A new hub page must be explicitly checked at 360px, not assumed because the underlying tile-grid component is already shipped elsewhere.
4. **Audit story for the new write path was never mentioned by the request.** Confirmed: `AUDIT_ACTIONS.ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED` already exist and fire from the platform path. Phase 3 must decide whether the tenant path reuses these keys or mints tenant-scoped variants — Workflow Rule 7 territory, cannot ship silently.
5. **Rate limiting/repeat-change abuse — investigated, not asserted.** No throttle exists on the platform brand-write path today either; multiplying the number of actors who can self-serve changes the abuse-risk shape even though per-actor risk is unchanged and self-inflicted. Named as a real Phase 2 question, not a required mitigation.
6. **Contrast-floor self-correction — checked, confirmed.** `src/lib/brand/generate.ts`'s `searchBrandLightness()`/`pickAchromaticForeground()` *guarantee* every generated pairing clears the `LEGAL_PAIRS` floor algorithmically, with no human review step on the platform path either. The operator's implicit worry (a congregation setting an inaccessible brand with nobody watching) is already fully mitigated by math for both the existing and proposed path.
7. **The "244 text-sm / 97 text-xs" claim in the work-log metadata is stale.** Actual count: **432** `text-sm` across 143 files, **105** `text-xs` across 47 files (excluding `.test.` files) — the real unmigrated surface is ~1.8x larger than stated. Phase 3 should scope `TYPE_SCALE` adoption to the portal-chrome files this pipeline actually touches, not a whole-app migration.
8. **"Bolder colors/shadows like the public site" needs correcting against the actual reference.** `presby-site-kit/src/styles.css` has **3 total `box-shadow` declarations**, all subtle — it is not shadow-heavy. Its actual "boldness" is full-bleed saturated color blocks, a heavy gradient scrim over hero photography, and a large heavy-weight display heading (`font-size: 5rem; font-weight: 800`). The portal's *current* shadow usage (`hover:shadow-md`, interaction-only) is already comparatively the more shadow-forward of the two surfaces. Phase 3 should target color-block boldness and type weight, not chase a drop-shadow aesthetic the reference doesn't actually have.
9. **Motion's failure mode is exactly the class of bug "Verify in a Browser" warns about** (blocked assets killing hydration, iOS CSS bugs, a disclosure that never opens). Must ship flagged and be verified in an actual browser at 360px, not asserted from source reading.
10. **"Bolder" vs. "not overwhelming"/elderly-skewing membership is a real tension the request doesn't resolve.** The codebase's own stance (`MIN_MEMBER_FACING_PX = 14`, the type-pairing "legibility wins over character... audience skews older") argues boldness belongs on CTAs/headings/chrome, not body text or information density.

## Out of Scope (confirm with user)

- A full `TYPE_SCALE` migration across all 143/47 affected files site-wide — scope to portal-chrome surfaces this pipeline touches.
- Retiring the platform admin's own branding page/form (Open Question — may stay as an override/break-glass path).
- Any change to `LEGAL_PAIRS` or the brandable/bounded/platform token partition itself — Part B is presentation-only within the existing cascade, per DECISION-046.
- A second, org-configurable palette mechanism outside the existing seed-hex + type-pairing generator — the tenant path should offer exactly what the platform path offers today, nothing more permissive.
- The "neutralize" capability moving to the tenant side. Recommend it **stays platform-only** — the existing code frames it as remediation against "an abusive tenant," an inherently adversarial platform-vs-tenant action, not a self-service one. A tenant admin can already achieve the equivalent (reset to default) through "set."
- Rate limiting on brand-change frequency (named as a gap, not a committed deliverable).

## Open Questions

- Does `/admin/organizations/[id]`'s brand form stay live as a platform override after tenant self-service ships, or is it retired?
- Does self-service branding apply to all five `organizationType` values, or congregation-only?
- Where does the link to the new admin hub live on the main portal page — new persistent nav item, or folded into this session's just-shipped footer/`ButtonGroup`?
- Confirm: "neutralize" stays platform-only (recommendation, not yet decided).
- Should Part B's visual pass be scoped to the portal (`(org)` tree) only, or extend to `(account)`/`(member)` shell pages too? Recommend portal-only.
- **Pipeline structure — recommendation, not a deferral:** fork into three work-log pipelines at Phase 2, mirroring the earlier groups-and-officers split:
  1. **`portal-admin-hub-ia`** (hub page, tile reclassification, folding in the existing Features page) — low invariant risk, close to ready, no new permission.
  2. **`tenant-branding-permission`** (the platform→tenant permission move) — invariant-adjacent, requires the architect's **explicit** sign-off on the "Two Hierarchies Intersect Nowhere" directionality question (a capability moving from the platform axis to the tenant axis, unusual — most changes go the other way) before Phase 3 designs anything. Must not be waved through as "just add a permission."
  3. **`portal-visual-modernization`** (Part B) — presentation-only, no schema/permission surface, ships and rolls back independently of the other two.
- Informational, for Phase 6 later: the operator's own `admin@presby.invalid` (Dev Admin role at fpcw) test account should be checked at verification time for whichever new tenant permission ships, so live-testing isn't blocked on a fixture gap discovered post-ship.

**Handoff:** architect (Phase 2) — with the explicit ask to rule on the fork (one pipeline vs. three) and, regardless of the fork outcome, to issue a named invariant ruling on the branding platform→tenant permission move before any Phase 3 design work touches it.

---

# Phase 2 — Architectural Review (architect)

## Ruling on the three-way fork

**Confirmed, not overruled** — same as the `groups-and-officers` precedent, for the same reasons. Hub/IA touches no schema and no new permission; the branding move is the one genuinely invariant-adjacent change and needs its own focused review; the visual pass is presentation-only within the existing cascade (DECISION-046) and ships/rolls back independently. Combining them would force one Phase 3 doc to carry three unrelated review lenses.

This file is narrowed to Part A.1 only (the hub/IA reorganization) — the lowest-risk, closest-to-ready piece. See `docs/work-log/2026-08-26-tenant-branding-permission.md` (DECISION-101) and `docs/work-log/2026-08-26-portal-visual-modernization.md` (DECISION-102) for the other two, both Phase-2-complete. No hard sequencing dependency between the three, though hub/IA shipping first is recommended since the branding page needs somewhere to be linked from to be discoverable — the operator's original stated problem.

## Verdict

**Approved with suggestions.**

## Placement

- **Directory placement:** new file `(org)/o/[slug]/admin/page.tsx` — a sibling of the *existing* `(org)/o/[slug]/admin/{features,roles,members,officers}/` directories, under the *existing* `(org)/o/[slug]/admin/layout.tsx` (confirmed by reading it — it already exists, carries the "Back to portal" link, and explicitly declares itself the parent for exactly this kind of page: "NO NAV ARRAY... a real tenant nav is deliberately deferred to whichever future page makes a second link exist to navigate between" — that future page is this one). No new top-level directory anywhere.
- **`PortalTile`'s `category` field:** add it to the existing, single `PORTAL_TILES` array in `src/lib/org-portal/tiles.ts` — never a second parallel registry. The file's own header comment is explicit that it is deliberately flag-only today ("must never grow a second permission check — that would be two gates disagreeing about the same grant, DECISION-003"). `category: "operate" | "administer"` is safe to add **only** because it stays in that same lane — pure routing metadata (which page renders it), never a second authorization signal. **Concrete rule for Phase 3:** the hub page's own reachability check is `isFlagEnabled("org_portal.admin_hub")` and nothing else; `category` decides which of two pages a tile renders on, never whether a click succeeds — that authority stays entirely with the destination route.
- **Server vs. client split:** `admin/page.tsx` is a **Server Component**, reading a `category`-filtered slice of `visiblePortalTiles()` (or a new sibling `visibleAdminTiles()` — Phase 3's naming call, but it must be one function reused by both `/o/[slug]` and `/o/[slug]/admin`, not two independently-maintained flag-check loops). Matches every other precedent this session already established (`roles/page.tsx`, `features/page.tsx`, `officers/page.tsx` — all Server Components, `'use client'` reserved for mutation forms only). No mutation exists on this page, so there is no client-component surface here beyond whatever the card-grid tile component itself already is.
- **Dependencies:** none. A flat card grid is exactly what `Card`/`Button`/the existing tile-grid component already render — no new npm package warranted for "stats row + quick-action cards," matching fpcw-directory's own reference implementation. `docs/ui-standards.md`'s existing `Card`/`Button` conventions and `check:brand-scope`'s C2 rule apply unchanged.

## Invariants Touched

- **Permissions vs. Flags (DECISION-003)** — the one invariant genuinely at risk here, and it holds. `category` is presentational routing only; Phase 3's acceptance criteria must include a test asserting that a tile with a "setup" category and a flag-on-but-permission-denied viewer still reaches its destination page (which renders its own honest `Forbidden` state) rather than being hidden by the hub itself. **Resolution of Phase 1's Gap 2** ("does a viewer with zero setup permissions see every card, 403ing on click, or does the hub hide cards it can determine they lack permission for?"): **show every flag-enabled card; let the destination page's own gate be the only permission signal.** A hub that hides cards by permission would need to duplicate every destination's permission-resolution logic at the hub layer — a second gate, exactly what DECISION-003 rules out.
- **Two Hierarchies Intersect Nowhere / `(org)` contract** — untouched. The hub renders nothing that isn't already gated at its destination; it introduces no new read of tenant data.
- **Brand scope (DECISION-047)** — untouched; `admin/page.tsx` sits beneath `[slug]/layout.tsx`, which is the sole `<BrandTokens>` emitter in this subtree (confirmed: `admin/layout.tsx`'s own header states it deliberately does not emit a second one). The hub inherits the org's brand cascade for free.

## Notes

1. **Reclassification churn (Phase 1 Gap 1):** no hard requirement, but recommend Phase 3 keep a lightweight pointer/link on the main portal page during a transition window rather than a silent link removal.
2. **Mobile (360px):** the hub is a brand-new page — must be verified in an actual phone-viewport browser per "Verify in a Browser," not assumed inherited from wherever the tile-grid component is already shipped.
3. **Confirmed reuse, not reinvention:** the existing `(org)/o/[slug]/admin/features` page needs zero server-side change — this pipeline's only obligation there is adding its tile (with `category: "administer"`) to the registry.
4. **`~/git/fpcw-directory` CLAUDE.md path fix** (Phase 1's research) — genuinely out of scope for this pipeline; a one-line doc fix is Trivial-class and doesn't need its own work-log entry. Fine to fix opportunistically, not gated on this pipeline.

## Implementer(s) Phase 3 should expect

**ux-developer**, single commit. No schema, no new permission catalog row, no API contract beyond the one-field `PortalTile` type widening (`tiles.test.ts`'s existing snapshot discipline already protects this — Phase 3 must update that test).

## Handoff

**Next: tech-lead (Phase 3), for this file only.** Carry forward: the `category`-is-routing-only rule and its concrete Phase 3 test obligation (permission-denied-but-flag-on tile still navigates and 403s at the destination); the "show every flag-enabled card, never permission-pre-filter" resolution of Gap 2; the mobile-verification requirement; confirmation that `/o/[slug]/admin/features` needs no server change, only a registry entry. Do not re-litigate the branding move or the visual pass here — both now live in their own files with their own completed Phase 2s.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Add a net-new `/o/[slug]/admin` hub page (a Server Component under the
already-existing `admin/layout.tsx`) that surfaces the org's "setup"
destinations — Members, Roles, Officers, and the already-shipped-but-unlinked
Features page — as a flat card grid, gated by one new flag
(`org_portal.admin_hub`, seeded off). This splits `PORTAL_TILES` into two
audiences without duplicating any flag-check logic: `/o/[slug]` keeps the
day-to-day tools (Directory, Tickets, Feedback) and the hub gets the
permission-gated setup tools, via one shared, category-parameterized filter
function. No new permission, no schema change — this is registry
reclassification plus one new route, matching the closest-to-ready slice the
architect narrowed Phase 2 to.

## Permissions & Flags

- **Permission key(s):** none new. Every "administer" tile still points at a
  destination page that already gates itself on its own tenant permission
  (`people.manage`/roll-action grants for Members, `role_grants.manage` for
  Roles, `officers.manage` for Officers, `org_features.manage` for Features).
  The hub route introduces no permission check of its own — per the
  architect's explicit ruling, it must not, because that would be a second
  gate disagreeing with the destination (DECISION-003).
- **Default role bindings:** n/a — no permission added.
- **Feature flag(s):** new `org_portal.admin_hub`, seeded **off**
  (`scripts/seed.ts`'s `seedFlags()`, same shape as the neighboring
  `org_portal.*` rows — see the existing `org_portal.features` entry as the
  template). This flag is the **sole** reachability gate for the hub page
  itself and for the new "Administration" entry in the persistent
  `PortalNav` row (see Component Plan) — it is not consulted anywhere else and
  it never substitutes for a tile's own `flagKey` check.

## API Contract

No routes. One type change and one function-signature change, both in
`src/lib/org-portal/tiles.ts`:

```ts
export type PortalTileCategory = "operate" | "administer";

export interface PortalTile {
  key: string;
  label: string;
  description: string;
  href: (slug: string) => string;
  flagKey: string;
  category: PortalTileCategory;      // NEW — routing only, never a permission check
}

// NEW signature — category-parameterized, one implementation, two call sites
export async function visiblePortalTiles(
  category: PortalTileCategory,
): Promise<PortalTile[]>;
```

`visiblePortalTiles()` currently takes no argument and returns every
flag-visible tile; every existing caller is updated to pass a category
explicitly (there is no backward-compatible default — an unparameterized call
is exactly the bug this design has to make impossible to write by accident).
Internals unchanged: filter `PORTAL_TILES` by `category`, then by
`isFlagEnabled(tile.flagKey)`, same `Promise.all` shape as today. This is the
"one shared function reused by both pages" the architect required — `/o/
[slug]/page.tsx` calls `visiblePortalTiles("operate")`, `/o/[slug]/admin/
page.tsx` calls `visiblePortalTiles("administer")`. No second loop, no
`visibleAdminTiles()` wrapper — the category is just the caller's argument.

## Data Model

No schema changes required. `org_portal.admin_hub` is a `feature_flags` row
(existing table), added via `scripts/seed.ts`'s `seedFlags()`, same mechanism
as every other `org_portal.*` flag — not a migration.

## Component / Page Plan

**Pages to create:**
- `src/app/(org)/o/[slug]/admin/page.tsx` — Server Component. Repeats the
  `(org)` auth pattern in full (session → `resolveOrgContext()` →
  not-found/forbidden/ended switch → `assertOrgAccess()`), identical in
  structure to `admin/features/page.tsx` and `admin/roles/page.tsx` one
  directory shallower (imports `../org-states`, not `../../org-states`).
  After the gate: check `isFlagEnabled("org_portal.admin_hub")`; if off,
  render `AdminHubFlagOff` (a plain "not turned on yet" message, same register
  as `FeaturesFlagOff` — **not** a 404, matching the architect's Phase 1
  Flow-1 resolution that a flag-off hub is a generic-unavailable state, not an
  access denial). If on, call `visiblePortalTiles("administer")` and render
  `<h1>Organization Administration</h1>` + a one-line subtitle + `<TileGrid
  slug={slug} tiles={tiles} />` (the existing component, unchanged — it
  already renders a flat grid and already renders `null` for an empty `tiles`
  array). **Edge case:** because this page has no other content to fall back
  on the way `/o/[slug]` has (greeting, find-a-person), an empty tile grid
  here (hub flag on, but every administer tile's own flag off) reads as a
  dead page. Add one short "Nothing is turned on here yet" line, rendered
  only when `tiles.length === 0`, so the hub is never a silent blank instead
  of the greeting-carries-it fallback the main page has.

**Components to create:**
- `src/app/(org)/o/[slug]/admin/admin-hub-states.tsx` — one export,
  `AdminHubFlagOff`, modeled on `features-states.tsx`'s three-block pattern
  (this page only needs the one state; not-found/forbidden/ended are handled
  one level up by the shared `org-states.tsx`, reused as-is).

**Files to modify:**
- `src/lib/org-portal/tiles.ts` — add `PortalTileCategory` + `category` field;
  reclassify `members`/`roles`/`officers` → `"administer"`, `directory`/
  `tickets`/`feedback` → `"operate"`; add the new `features` tile entry
  (`category: "administer"`, `flagKey: "org_portal.features"` — already
  seeded, confirmed in `scripts/seed.ts`, zero server-side change needed per
  Phase 1/2); **rename the `roles` tile's `label`** from `"Administration"` to
  `"Roles"` — it now sits as a card *inside* a page titled "Organization
  Administration," and `"Roles"` matches that destination page's own `<h1>`
  (`admin/roles/page.tsx:122`), the same convention every other tile already
  follows (`members`/`officers`/`features` labels all match their
  destination's own heading); re-parameterize `visiblePortalTiles()`.
- `src/lib/org-portal/tiles.test.ts` — update the snapshot-style key-list test
  (now seven keys, including `features`); add `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`
  entry for `org_portal.admin_hub` isn't needed here (it's not a tile flag,
  it's the hub's own gate — don't add it to this set, it would assert
  something untrue); add a new test asserting every tile's `category` is one
  of the two literal values (guards a future tile shipping with neither
  filter matching it — a silent third state); update every existing
  `visiblePortalTiles()` call in the test file to pass `"operate"` or
  `"administer"` explicitly and split the "returns every tile when every flag
  is on" case into two (one per category, asserting the *other* category's
  tiles are absent even with every flag on — this is the test that actually
  proves categories partition rather than just relabel).
- `src/app/(org)/o/[slug]/page.tsx` — call site becomes
  `visiblePortalTiles("operate")`.
- `src/app/(org)/o/[slug]/page.test.tsx` — its `visiblePortalTiles` mock
  currently ignores arguments; leave the mock shape but add an assertion that
  it was called with `"operate"`, so a future accidental swap to
  `"administer"` here fails a unit test instead of silently listing setup
  tools on the main page.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — **this is a third, previously
  unmentioned call site** that this design must account for: the persistent
  header nav row (`PortalNav`, rendered on every `(org)` page once
  `org_portal.chrome_v2` is on) currently calls the unparameterized
  `visiblePortalTiles()` and lists every visible tile regardless of category.
  Change to `visiblePortalTiles("operate")` — the persistent nav keeps
  showing day-to-day tools, matching what the main page shows — **plus** one
  new hardcoded entry, `{ label: "Administration", href: `/o/${slug}/admin`,
  exact: false }`, appended only when `isFlagEnabled("org_portal.admin_hub")`
  is true. This is the same pattern `PortalNav` already uses for its
  unconditional `Home` entry (a hardcoded, non-`PORTAL_TILES` row), just
  conditioned on a flag instead of always-on, and it directly answers Phase
  1's open question ("where does the link to the hub live") without adding a
  second nav mechanism. Fetch the flag in the same `Promise.all` as the tiles
  call.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx` — update the
  `visiblePortalTiles` mock to accept (and ignore, or assert on) the
  `"operate"` argument; add `isFlagEnabled` mock; add a case asserting the
  "Administration" entry appears last when the hub flag is on and is absent
  when it's off. The existing test's inline mock tile object for `roles`
  still uses `label: "Administration"` — update it to `"Roles"` to match the
  registry rename, so this test doesn't silently pin the label this design
  just retired.
- `docs/product/functionality-map.md` — one-line update noting the new
  `/o/[slug]/admin` hub and the Members/Roles/Officers/Features
  reclassification (Rule 14, at ship time).

## Implementation Order

1. `src/lib/org-portal/tiles.ts` — type + registry changes (category field,
   reclassification, new `features` tile, `roles` label rename,
   re-parameterized `visiblePortalTiles()`).
2. `scripts/seed.ts` — add the `org_portal.admin_hub` flag row, seeded off.
3. Update the two existing call sites (`page.tsx`, `portal-nav.tsx`) to pass
   an explicit category; add the hardcoded "Administration" nav entry.
4. New `admin/page.tsx` + `admin-hub-states.tsx`.
5. Update `tiles.test.ts`, `page.test.tsx`, `portal-nav.test.tsx`; add
   `admin/page.test.tsx` (flag-off state, flag-on renders the grid, the
   `(org)` four-way-miss branches — mirror `features/page.test.tsx`'s
   structure).
6. No audit events — no mutation exists on this page.
7. Release notes entry (member-visible navigation change — Workflow Rule 13
   applies: this is member-visible enough, for the permission-holding subset
   of members, to be worth a `whats_new_entries` line at Phase 6, tech-lead's
   call at ship time, not a hard requirement here).
8. `docs/product/functionality-map.md` update, same commit as the above per
   Rule 14.

## Edge Cases & Risks

- **e2e blast radius: none.** Confirmed by reading `e2e/` — no existing
  Playwright spec asserts on `/o/[slug]` portal content, the tile grid, or
  any `/o/[slug]/admin/*` page (the only `admin-*.spec.ts` files test the
  *platform* `/admin` tree, a different route group entirely; grepped for
  `PORTAL_TILES`/`TileGrid`/`admin/roles` across `e2e/` with zero hits). The
  real blast radius is at the **unit** layer: `tiles.test.ts`,
  `page.test.tsx`, and `portal-nav.test.tsx` all directly assert the
  pre-category behavior (the unparameterized call, the "Administration"
  label, the un-split tile list) and **will fail** the moment `category` and
  the re-parameterized signature land — this is expected breakage this design
  accounts for in the Implementation Order, not a discovered-after-the-fact
  regression.
- **`category` drifting into a second permission check.** The single
  highest-risk mistake here, called out explicitly by the architect: a future
  edit that makes the hub (or the main page) skip a tile because the viewer
  lacks a permission, rather than because a flag is off. The `tiles.test.ts`
  addition (every tile has exactly one of the two literal categories, and a
  flag-on-permission-denied click still reaches the destination) is the
  regression guard; `admin/page.tsx`'s own header comment must repeat the
  "never a second gate" rule the way `tiles.ts`'s header already does.
  **Concrete acceptance test:** flag-on, permission-denied viewer sees the
  Members/Roles/Officers/Features cards on the hub and gets that
  destination's own `Forbidden` state on click — not a hidden card.
- **Empty hub.** Hub flag on, every administer-tile flag off → `TileGrid`
  renders `null` and the page would otherwise be a bare heading. Covered
  above with a one-line fallback message; needs its own test.
- **Reclassification churn (Phase 1 Gap 1, carried forward).** URLs are
  unchanged — only which page links to them. No redirect or transition
  period is being built; a person who bookmarked `/o/[slug]/admin/roles`
  before this ships keeps working identically.
- **Mobile (360px) — Phase 4/5 gate, not optional.** New page, must be
  checked in an actual phone-viewport browser per "Verify in a Browser," not
  assumed inherited from the shared `TileGrid`/`Card` components (they were
  verified at 360px in their own prior pipeline, not in this one).
- **`PortalNav`'s "Administration" entry ordering.** It's appended after
  every operate tile, mirroring `Home`'s unconditional-prepend pattern in
  reverse (append vs. prepend) — pick one and pin it with a test;
  recommendation above is append-last since it's the "setup," not
  "day-to-day," destination.

## Out of Scope (confirmed with the architect's Phase 2 narrowing)

- The branding permission move and the visual-modernization pass — both live
  in their own sibling work-log files with their own completed Phase 2s; this
  design does not touch either.
- Any new persistent nav *mechanism* — the one addition here (a single
  hardcoded, flag-gated entry) reuses `PortalNav`'s existing `Home` pattern
  exactly; it is not a new nav array, dropdown, or breadcrumb.
- Retiring or redirecting the old destination URLs — they are unchanged.
- A "which cards can I actually use" pre-filter at the hub — explicitly ruled
  out by the architect; the destination page's own `Forbidden` state is the
  only permission signal a viewer ever sees.

## Implementer

**ux-developer** — single commit, matching the architect's Phase 2
expectation. No schema, no new permission catalog row, no route handler; the
only "API" surface is the one-field `PortalTile` type widening and the
re-parameterized `visiblePortalTiles()`, both already covered by the existing
snapshot-style test discipline this design updates rather than replaces.

---

# Phase 4 — Implementation

**Date:** 2026-08-26
**Implementer:** ux-developer

## Files Created

- `src/app/(org)/o/[slug]/admin/page.tsx` — the net-new `/o/<slug>/admin`
  hub index. Server Component, full `(org)` auth pattern (`cachedAuth()` →
  `resolveOrgContext()` → the four-way-miss switch → `assertOrgAccess()`),
  gated solely on `isFlagEnabled("org_portal.admin_hub")`. Flag-on calls
  `visiblePortalTiles("administer")` and renders the result through the
  existing `TileGrid`; a `tiles.length === 0` fallback ("Nothing is turned
  on here yet") covers the empty-hub edge case. Performs NO permission check
  of its own anywhere in the file — the file's header comment states the
  rule explicitly and the accompanying test suite proves it two ways (a
  comment-stripped source scan, and a rendering assertion that every tile
  `visiblePortalTiles()` returns renders unconditionally).
- `src/app/(org)/o/[slug]/admin/admin-hub-states.tsx` — `AdminHubFlagOff`,
  the one non-data-bearing state this page needs (not-found/forbidden/ended
  are handled one level up by the existing `org-states.tsx`).
- `src/app/(org)/o/[slug]/admin/page.test.tsx` — orchestration tests:
  flag-before-registry ordering, the non-negotiable no-permission-pre-filter
  acceptance criterion (source scan + rendering proof that Members/Roles/
  Officers/Features all render regardless of a "permission-denied" framing),
  the empty-hub fallback, and the shared four-way-miss response.

## Files Modified

- `src/lib/org-portal/tiles.ts` — added `PortalTileCategory = "operate" |
  "administer"` and a `category` field on `PortalTile`; reclassified
  `members`/`roles`/`officers` → `"administer"`, `directory`/`tickets`/
  `feedback` → `"operate"`; added the new `features` tile
  (`category: "administer"`, `flagKey: "org_portal.features"`, confirmed
  against the already-shipped `admin/features/page.tsx`, zero server
  change); renamed the `roles` tile's `label` from `"Administration"` to
  `"Roles"` (it now sits inside a page titled "Organization
  Administration"); re-parameterized `visiblePortalTiles(category)` to one
  shared implementation — filters `PORTAL_TILES` by `category`, then by
  `isFlagEnabled(tile.flagKey)`, same shape as before, no second loop.
- `src/lib/org-portal/tiles.test.ts` — updated every existing assertion for
  the new `category` field and the seven-tile registry; added a
  category-literal-shape test; split the "every flag on" case into
  operate/administer variants that each assert the *other* category's tiles
  are absent (proves categories partition, not just relabel); every
  `visiblePortalTiles()` call now passes an explicit category; added a test
  asserting the exact `isFlagEnabled` call set for a category (nothing
  outside the tile flagKeys is ever consulted — no second gate).
- `src/app/(org)/o/[slug]/page.tsx` — call site → `visiblePortalTiles("operate")`.
- `src/app/(org)/o/[slug]/page.test.tsx` — mock now forwards its argument;
  added an assertion that the ON-path call is `"operate"`, not
  `"administer"`.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — `visiblePortalTiles("operate")`
  plus a new hardcoded, flag-gated `{ label: "Administration", href:
  \`/o/${slug}/admin\`, exact: false }` entry, appended last, gated on
  `isFlagEnabled("org_portal.admin_hub")` — mirrors the existing
  unconditional `Home` entry's pattern, fetched in the same `Promise.all`.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx` — rewritten for the
  category-parameterized mock and the new flag mock; added cases for the
  "Administration" entry appearing last (flag on) and being absent (flag
  off); updated the inline `roles` tile fixture's label to `"Roles"`.
- `scripts/seed.ts` — added the `org_portal.admin_hub` flag row, seeded
  `enabled: false`, same shape/rationale-comment convention as its
  `org_portal.*` siblings.
- **A fourth call site the Phase 3 design did not separately enumerate:**
  `src/components/org-portal/portal-footer.tsx` also called the
  unparameterized `visiblePortalTiles()` (the persistent footer's nav
  recap). Since the re-parameterized signature has no backward-compatible
  default, this call site would not compile otherwise. Updated to
  `visiblePortalTiles("operate")` — the footer recap is a day-to-day-tools
  surface, matching `PortalNav`'s own choice, not the hub's permission-gated
  setup tools. `src/components/org-portal/portal-footer.test.tsx` updated
  to forward the mock's argument and assert the `"operate"` call.
- `src/components/org-portal/tile-grid.tsx` — added a `features` entry
  (`SlidersHorizontal` icon) to the render-layer-only icon lookup so the new
  tile doesn't fall back to the generic `LayoutGrid` icon; `tile-grid.tsx`
  itself needed no other change (already renders `null` for an empty
  array, reused as-is by the hub for the non-empty case).
- `src/components/org-portal/tile-grid.test.tsx` — added `category` to the
  two hand-built `PortalTile` fixtures (now a required field).

## Schema Changes

- None. `org_portal.admin_hub` is a `feature_flags` row added via
  `scripts/seed.ts`'s `seedFlags()`, run with `npm run db:seed` (idempotent,
  `onConflictDoNothing`), not a migration.

## Audit Events

- None — no mutation exists on this page or in this diff. The hub is a pure
  read/routing surface.

## Implementer Notes

- **The fourth call site.** Phase 3's design enumerated three call sites
  (`page.tsx`, `portal-nav.tsx`, and the registry itself) but missed
  `portal-footer.tsx`, which also calls `visiblePortalTiles()` unparameterized.
  Since the new signature has no default, this was a compile error, not a
  silent bug — caught immediately by `npm run typecheck`. Fixed it the same
  way as the two enumerated call sites (`"operate"`), documented inline in
  `portal-footer.tsx`'s own header comment, and added a matching test
  assertion. Noting this explicitly for QA and Phase 6 since it's a
  divergence from the literal Phase 3 file list, not a scope change.
- **Acceptance criterion, verified three ways.** (1) Unit test: a
  comment-stripped source scan of `admin/page.tsx` proves no permission-
  resolving function name appears in its executable code. (2) Unit test: a
  mocked `visiblePortalTiles()` returning all four administer tiles renders
  all four as links unconditionally — there is no filtering step between
  the registry read and the render. (3) Live browser verification (below):
  signed in as `elder.fixture@example.invalid` (holds only `tickets.file` —
  zero admin/setup permissions) at `alder-creek`, the hub showed all four
  cards (Members, Roles, Officers, Features), and clicking through to
  `/o/alder-creek/admin/roles` and `/o/alder-creek/admin/officers` rendered
  each destination's own honest `Forbidden` copy ("You don't have
  permission to grant or revoke roles…" / "…manage officer terms…") rather
  than a hidden card or a hub-level denial.
- **Empty-hub fallback implemented as a plain conditional, not a second
  `TileGrid` prop.** `admin/page.tsx` checks `tiles.length === 0` itself and
  renders the "Nothing is turned on here yet" line in that branch, calling
  `TileGrid` only for the non-empty case — `TileGrid` itself is unchanged
  and still independently renders `null` for an empty array (used by the
  main page, which has other content to fall back on).
- **Officers page copy needed no change.** `admin/officers/page.tsx`'s
  existing microcopy — "Granting software access (Administration → Roles)
  is done separately" — was written before this pipeline but now reads as
  literally correct: "Administration" is the hub's own `<h1>` and "Roles" is
  the card inside it. Left as-is.
- **Live browser verification, 360px, dev server at localhost:3000.** Ran
  `npm run db:seed` to insert the new flag row, then used a scratch
  Playwright script (not committed — lived in the gitignored `scratch/`,
  deleted after use) to: sign in as `elder.fixture@example.invalid`
  (zero admin permissions) and `admin@presby.invalid`; verify the hub at
  `/o/alder-creek/admin` renders all four administer tiles in a single
  mobile column with 44px+ touch targets; verify the mobile hamburger menu
  lists `Home, Directory, Tickets, Give feedback, Administration` in that
  order (append-last, as designed); verify flag-off renders
  `AdminHubFlagOff`'s "isn't turned on yet" copy and the nav's
  "Administration" entry disappears entirely; verify the two destination
  pages' own `Forbidden` states render on click-through (see acceptance
  criterion above). One incidental discovery, unrelated to this pipeline:
  `alder-creek` (the only fixture org clerk.fixture/elder.fixture can sign
  into) carries `organization_settings.require_two_factor = true`, which
  blocked a plain credentials sign-in for these password-only fixtures.
  Temporarily set it to `false` for the verification session and restored
  it to `true` immediately after — not a change this pipeline owns or is
  shipping, flagging it here only because it briefly touched shared dev-DB
  state and a reviewer re-running the same check should know why it was
  necessary.
- **Flag state left in the dev DB.** `org_portal.admin_hub` is left
  **enabled** in the dev database after verification, matching the
  established precedent in this same dev DB where every other
  `org_portal.*` flag (`chrome_v2`, `chrome_v3`, `feedback`, `features`,
  `roles`, `officers`, `members_create`, `tickets`, `home_v2`,
  `directory`, `directory_v2`) is already left on for continued operator
  testing (`docs/TODO.md`'s "deliberately ON in the dev DB for the fpcw
  demo" note on the portal-chrome entry). The flag row itself still seeds
  **off** in `scripts/seed.ts` for every other environment/fork.
- **Pre-existing, unrelated lint failure.** `npm run lint` reports one
  error in `src/app/(org)/o/[slug]/portal-nav-links.tsx` (`react-hooks/
  set-state-in-effect`) — confirmed pre-existing via `git stash` (present
  identically on `main` before this diff). Not touched by this pipeline;
  not this implementer's file to fix under this work-log's scope.
- **Concurrent sibling-pipeline activity in the same working tree.** During
  implementation, unrelated files (`portal-nav-links.tsx`, `greeting.tsx`,
  `button.tsx`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`,
  `drizzle/0030_presby_branding_permission.sql`, etc.) appeared modified —
  none touched by this implementer, presumably the sibling
  `tenant-branding-permission` or `portal-visual-modernization` pipelines
  running in parallel per the Phase 2 fork. Left entirely alone. `npm run
  typecheck`, the full `npm run test`, and this pipeline's own targeted
  test files were all re-verified passing after noticing this, to confirm
  no cross-contamination.
- **`docs/product/functionality-map.md` deliberately not touched here.**
  Workflow Rule 14 updates it "at ship time" (Phase 6), in the same
  housekeeping cluster as release notes and the `docs/TODO.md`
  reconciliation — not at Phase 4. Left for Phase 6 (analyst)/whoever ships.
- **What a reviewer should click through in the browser:** sign in as
  `clerk.fixture@example.invalid` or `elder.fixture@example.invalid`
  (password `e2e-fixture-only-not-a-secret`; alder-creek currently requires
  2FA per its own `organization_settings` policy — unrelated to this
  pipeline — so a plain credentials sign-in from a fresh browser will hit
  `/totp`; there is no enrolled secret for either fixture in the dev DB, so
  this is a blocker for a *fresh* browser session that hasn't already
  authenticated). `org_portal.admin_hub` is currently **on** in the dev DB.
  Visit `/o/alder-creek` → note the new "Administration" entry, last, in
  both the desktop-width nav row and the mobile hamburger menu → click it →
  `/o/alder-creek/admin` → four cards (Members, Roles, Officers, Features)
  regardless of which fixture is signed in → click each → each destination
  renders its own honest state (grant list for `clerk.fixture`, `Forbidden`
  copy for `elder.fixture`). Toggle `org_portal.admin_hub` off via
  `/admin/flags` (as a platform admin) to see `AdminHubFlagOff` and confirm
  the nav entry disappears.
- **New copy strings for a fork's branding pass to review:** "Organization
  Administration" (hub `<h1>`), "Set up {name} — members, roles, officers,
  and features." (hub subtitle), "Nothing is turned on here yet." (empty
  hub), "Organization administration isn't turned on for {name} yet."
  (`AdminHubFlagOff`), "Features"/"Turn optional portal features on or off
  for this organization." (new tile), "Roles" (renamed tile label,
  previously "Administration"), "Administration" (new nav entry label).
- **UX tradeoffs:** the hub reuses `TileGrid` completely unstyled beyond
  what already exists — no hub-specific visual treatment, per the
  architect's "no new component" placement ruling and the Phase-2-narrowed
  scope (visual modernization is the sibling `portal-visual-modernization`
  pipeline's job, not this one's). The "Nothing is turned on here yet" empty
  state is a single muted-foreground line, matching the register of every
  other flag-off state in this tree rather than inventing a richer
  empty-state illustration/CTA — consistent with `docs/ui-standards.md` and
  cheap to restyle later without a structural change.

## Test Output

`npm run typecheck` — PASS, no errors.

`npm run build` — PASS. Route table includes `ƒ /o/[slug]/admin` alongside
the existing `/o/[slug]/admin/{features,members,officers,roles}` siblings.

`npm run check` (audit / sql-date / deps-drift / brand-scope) — all four
PASS.

Targeted test files:
```
npx vitest run src/lib/org-portal/tiles.test.ts \
  "src/app/(org)/o/[slug]/admin/page.test.tsx" \
  "src/app/(org)/o/[slug]/portal-nav.test.tsx" \
  "src/app/(org)/o/[slug]/page.test.tsx" \
  src/components/org-portal/tile-grid.test.tsx \
  src/components/org-portal/portal-footer.test.tsx

 Test Files  6 passed (6)
      Tests  61 passed (61)
```

Full suite: `npm run test` →
```
 Test Files  154 passed | 15 skipped (169)
      Tests  2226 passed | 304 skipped (2530)
```
(A stray `fatal: cannot change to '/nonexistent/path/for/this/test'` line on
stderr is pre-existing/unrelated — some other suite's git-shell-out fixture;
does not affect the pass count, confirmed by re-running with `git stash`
before any of this pipeline's edits.)

`npm run lint` — one pre-existing failure in
`src/app/(org)/o/[slug]/portal-nav-links.tsx` (`react-hooks/
set-state-in-effect`), confirmed via `git stash` to exist identically on
`main` before this diff. Not introduced by, or in scope for, this pipeline.

e2e blast-radius grep (per Phase 3's own instruction): confirmed zero
Playwright specs assert on portal-tile content, `PORTAL_TILES`, `TileGrid`,
or any `/o/[slug]/admin/*` page body — the specs that do visit `/o/<slug>*`
URLs (`header-controls.spec.ts`, `post-login-routing.spec.ts`,
`totp-callback-bypass.spec.ts`, `branded-signin.spec.ts`,
`public-sites.spec.ts`) only assert on the URL/pathname or on chrome
elements this diff didn't touch. `org_portal.admin_hub` also seeds off, so
none of them can reach the new nav entry or hub page by default.

Live-browser verification (360px, dev server at localhost:3000, both
`elder.fixture@example.invalid` — zero admin permissions — and confirmed
against the flag-off state): see Implementer Notes above for the full
narrative; screenshots were taken via a scratch Playwright script in the
gitignored `scratch/` directory and deleted after use, per CLAUDE.md's
No Real Data / scratch-is-untracked discipline.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS**

## Unit Tests

Targeted files for this pipeline (`tiles.test.ts`, `admin/page.test.tsx`, `portal-nav.test.tsx`, `page.test.tsx`, `tile-grid.test.tsx`, `portal-footer.test.tsx`), run independently, isolated from sibling-pipeline contamination: **61/61 passed**. A full-suite run mid-session showed 2 failures in `audit.test.ts`, traced conclusively to a concurrently-running sibling pipeline (`tenant-branding-permission`) mutating `src/lib/audit.ts` in the same shared working tree — not this diff's own files, confirmed via `git status`/`git diff --stat`.

## End-to-End Tests

Not required — not an auth-touching diff. Confirmed via grep: zero existing specs reference `PORTAL_TILES`/`TileGrid`/`visiblePortalTiles`/`/o/*/admin`. `org_portal.admin_hub` seeds off by default.

## Source-Read Verification (the non-negotiable acceptance criterion)

Read `admin/page.tsx` directly: the only authz-adjacent call is `assertOrgAccess()` (a membership re-validation via `withOrgContext()`, not a permission check — identical to what the un-gated main portal page also calls). No `hasFeature(`/`hasPermission(`/`presby_has_permission`/`.manage`/`.propose` string appears anywhere in the file. The sole reachability gate is `isFlagEnabled("org_portal.admin_hub")`; `visiblePortalTiles("administer")` filters only by category then by each tile's own flag — nothing else. Matches the architect's Phase 2 ruling exactly, confirmed independently of the implementer's own narrative.

## Regression Tests Added

- `admin/page.test.tsx:186-202` — asserts the hub's own source performs no permission check of any kind, only the flag check. Guards against a future edit silently adding a per-tile permission check at the hub layer (the DECISION-003 violation named as the single highest-risk mistake).
- `admin/page.test.tsx:204-224` — a viewer with zero tenant permissions still sees every flag-enabled administer tile. Guards the same property at the rendering layer.
- `tiles.test.ts:73-77` — every tile's `category` is one of the two literal values. Guards against a future tile shipping with neither, silently invisible on both pages.
- `tiles.test.ts:213-224` — `category` is routing-only, asserting the exact `isFlagEnabled` call set so a second gate added later fails immediately.

## Coverage on Critical Modules

`src/lib/permissions.ts`/`two-factor.ts`/`flags.ts`: n/a, untouched by this diff. This pipeline's own modules (measured via raw v8 JSON, since the text-table reporter drops bracket-path files): `tiles.ts` 100%, `admin/page.tsx` 100% stmts/100% branches, `admin-hub-states.tsx` 100%, `portal-nav.tsx` 100%, `portal-footer.tsx` 100%, `tile-grid.tsx` 100%, `(org)/o/[slug]/page.tsx` 92.3% stmts (two pre-existing uncovered branches, unrelated to this pipeline's one-line change there).

## Feature-Gate Audit

No protected routes or actions touched — confirmed by reading the diff directly: zero `route.ts` handlers and zero `"use server"` actions added or changed. The hub's sole reachability gate is `isFlagEnabled("org_portal.admin_hub")` by explicit architect-ruled design; "may this person actually use it" is deferred entirely to each destination page's own existing, unmodified gate.

| Route or action | `auth()`/session present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `GET /o/[slug]/admin` | yes — `cachedAuth()` + `assertOrgAccess()` (membership check, not permission, by design) | intentionally absent | n/a — flag-only, `isFlagEnabled("org_portal.admin_hub")` confirmed correct |
| `GET /o/[slug]` (`visiblePortalTiles("operate")`) | unchanged | n/a | n/a |
| `portal-nav.tsx` (operate tiles + hardcoded Administration entry) | n/a, no mutation | n/a | `isFlagEnabled("org_portal.admin_hub")` confirmed correct |
| `portal-footer.tsx` (`visiblePortalTiles("operate")`) | n/a, no mutation | n/a | n/a |

## Additional Verification

All four call sites read directly and confirmed passing the correct category. `tiles.ts` reclassification confirmed correct. `admin/features/page.tsx`'s zero-server-change claim confirmed via `git diff --stat`. `scripts/seed.ts` confirmed to seed `org_portal.admin_hub` off. No new npm dependency (`package.json`/`package-lock.json` diff empty). Typecheck, build, all four tripwires clean.

## Verdict

**PASS**

Both mandatory checks (source-read, automated test) independently confirm the non-negotiable acceptance criterion holds. The one full-suite failure observed is attributable to a concurrent sibling pipeline, not this diff. A dev-DB fixture drift was found while attempting a live click-through (Alder Creek's fixture person/membership rows in `seed-dev.sql` aren't present in the currently-running dev DB) — an environment-hygiene item, not a code defect, noted for Phase 6/TODO follow-up.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The hub does exactly what Phase 1 asked for — a flat, flag-gated, permission-agnostic "Organization Administration" index that reuses the existing registry/tile-grid pattern and gives the eventual branding page (and any future "administer"-category page) a slot to drop into with zero re-architecture — and the one non-negotiable acceptance criterion (never a second permission gate, DECISION-003) was independently confirmed by both QA and this review reading the source directly; what's left is routine ship-time housekeeping, not a defect.

## What's Working

- **The audience test survives contact with the destinations.** `members`/`roles`/`officers`/`features` (each gated on its own `*.manage` permission at the destination) landed in `"administer"`; `directory`/`tickets`/`feedback` (meaningful to every member regardless of permission) stayed `"operate"`. The split matches the Phase 1 table exactly.
- **The hub genuinely receives a future "Branding" tile for free.** Adding a tile is one object literal in `PORTAL_TILES` with `category: "administer"` and a real `flagKey` — `admin/page.tsx` iterates whatever `visiblePortalTiles("administer")` returns with no per-tile special-casing.
- **DECISION-003 held, verified independently, not just trusted.** The hub's only authz-adjacent call is `assertOrgAccess()` (membership, not permission); the sole reachability gate is `isFlagEnabled("org_portal.admin_hub")`. No `hasPermission`/`.manage`/`.propose` string appears anywhere in the hub's executable code.
- **The registry reclassification and label rename are small, correct, low-risk.** Renaming the `roles` tile's label from `"Administration"` to `"Roles"` avoids a naming collision with the hub's own `<h1>`.
- **The empty-hub fallback is genuinely handled**, distinct from the flag-off state, each with its own test.
- **The fourth call site (`portal-footer.tsx`) was caught by a compile error, not a runtime bug** — good design decision by tech-lead (a signature with no backward-compatible default), validated in practice.
- **Live browser verification actually happened**, at 360px, with a zero-permission fixture, confirming click-through to each destination's own honest `Forbidden` state.

## Intent-vs-Shipped Diff

- Phase 1: "the main portal page should be all about functionality for that organization... org administration might need its own page." Shipped: exactly this split. **Matches.**
- Phase 1 Gap 2 (hub empty/permission-mismatch state undefined) → Phase 2 resolved it ("show every flag-enabled card, never permission-pre-filter") → Phase 4 shipped exactly that, verified by source read, automated test, and live click-through. **Matches — gap closed, not just documented.**
- Phase 1 Gap 1 (reclassification churn) → Phase 2/3 recommendation was "consider a transition pointer," not required → shipped with no transition pointer, URLs unchanged. **Acceptable drift** — Phase 1 flagged this as optional.
- Phase 1 Gap 3 (mobile 360px must be explicitly checked) → Phase 4 did a live 360px verification. **Matches.**
- Phase 2's placement/component-plan (no new directory, no new npm dependency, Server Component, existing `TileGrid`/`Card`) → shipped exactly as specified. **Matches.**
- Phase 3's three enumerated call sites → Phase 4 found and fixed a fourth (`portal-footer.tsx`) via a compile error, correctly resolved the same way as the other three. **Acceptable drift**, disclosed prominently, not discovered after the fact.
- Phase 1's "persistent Administration link (placement TBD)" → shipped as an appended, flag-gated entry in `PortalNav`, mirroring the existing `Home` pattern. **Matches**, resolves the open placement question.

## Edge Cases

- Empty state: **pass** — distinct "Nothing is turned on here yet" vs. flag-off message, both tested.
- Failure microcopy: **pass, appropriately minimal** — no mutation/network-failure surface of its own; reuses the shared `(org)` four-way-miss states unchanged.
- Permission gate: **pass** — confirmed independently by this review and by QA: the hub performs zero permission checks; each destination remains the sole gate.
- Audit event: **not applicable** — no mutation exists on this page.
- Mobile (360px): **pass** — explicitly verified live, not inferred. Grid collapses to a single column, touch targets ≥44px, hamburger-menu ordering confirmed.

## Follow-Ups (SHIP WITH NOTES)

1. **Ship-time housekeeping, same commit that lands this pipeline (Rules 10/14):**
   - `docs/product/functionality-map.md` — add the `/o/[slug]/admin` hub (flag `org_portal.admin_hub`, seeded off) and the Members/Roles/Officers/Features reclassification to the "presby: org portal" bullet.
   - `docs/TODO.md` — Done line for this pipeline, dated today.
2. **What's-new advisory (Rule 13): draft-but-defer.** `org_portal.admin_hub` ships seeded OFF — matches the established `org_portal.officers`/`org_portal.tickets` pattern (publish only once flipped on for a real org).
3. **Sibling-pipeline working-tree contamination (QA's flag) — confirmed real, a process note, not a defect.** Resolves once all three siblings from today's Phase 2 fork land.
4. **Dev-DB fixture drift — does not need its own new `docs/TODO.md` line.** Already covered by the existing Verification-debt entry and the newer 2FA-enrollment-fixture entries logged under the pagination/edit-person pipelines. Recommend the next pipeline that touches dev fixtures consolidate these rather than adding a fourth near-duplicate line.
5. **`org_portal.admin_hub` left enabled in the shared dev DB post-verification** — matches established precedent for every other `org_portal.*` flag in this environment. Still seeds off for every other environment/fork.
6. **For whoever ships the branding sibling next:** confirm at that pipeline's own Phase 6 that adding the Branding tile really was the trivial follow-up promised here.

**Feedback-row status (Rule 12):** not applicable — operator direction, not an in-app feedback row.
