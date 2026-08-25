# Portal Chrome: Org-Named Header + Portal Menu — Work Log

> **Slug:** `2026-08-25-portal-chrome`
> **Title:** Inside `/o/<slug>`, the header carries the congregation's own identity (name/logo, not the "presby" wordmark) and a persistent portal menu (Home / Directory / Tickets / Admin per flags and grants). Plus a ruling on brand for `(account)` pages (user feedback: "account settings don't follow the branding scheme") — currently deliberate platform-palette because account pages are org-agnostic; the analyst works out whether a single-enterable-org rule should brand them.
> **Surface:** member — `(org)` chrome; possibly `(account)` (decision pending Phase 1)
> **Permission(s):** none new expected — menu mirrors destination gates (tiles.ts pattern)
> **Flag(s):** TBD Phase 1 (candidate: rides `org_portal.home_v2`, or its own `org_portal.chrome_v2`)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (touches the brand palette partition if `(account)` branding is adopted; otherwise Phase 2 may scope-skip that half with notation)
> **Source — user feedback (direct, in-session 2026-08-25):** "we don't need to see presby in the portal just the name of the organization" · "is there a menu for the portal yet?" · "account settings don't follow the branding scheme"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-25 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-25 |
| 4 — Implementation | ux-developer | Complete | — | 2026-08-25 |
| 5 — Verification | qa | Complete (second pass after rework) | PASS | 2026-08-25 |
| 4 — Rework (360px truncation contract) | ux-developer | Complete | — | 2026-08-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-25 |

---

# Phase 1 — Functional Refinement (analyst)

**Verdict:** READY WITH NOTES

**One-line take:** The header-wordmark and portal-menu asks are two small, low-risk fixes to real gaps (redundant "presby" beside a switcher that already shows the org name; no persistent way to reach Directory/Tickets/Admin except the home tile grid) — ship those now. The `(account)` branding ask is the right instinct but a wider blast radius (a fourth `EMITTERS` exception, a DECISION-094-style amendment, a new "single enterable org" rule) and should be scoped as its own increment if Phase 3 finds the token-partition work outweighs the chrome work.

## User Verbs (by surface)

**Authenticated member, `/o/<slug>/*`:** sees the org's own mark/name where "presby" sits today; clicks it to return to `/o/<slug>`; sees a persistent nav (Home/Directory/Tickets/Admin/Feedback, flag-filtered) from any org page, not just the home tile grid; clicks an entry and lands on that page or its honest denied state.
**Authenticated member, `/account`, `/account/2fa`:** today platform palette regardless of org; under the proposed rule, their single org's brand when exactly one enterable org.
**Outside org context (`/orgs`, `/home`, `/account`, `/admin`):** header stays platform-branded — the partition holds; don't extend EMITTERS beyond what's decided here.

## Flows

**A — Org-named header.** Any `/o/<slug>/*` page → GlobalNav with `currentOrgSlug` → org identity, not "presby" → click → `/o/<slug>` (org home), not platform `/`. Failure: the org-list read degrades exactly as GlobalNav already degrades — never crash or blank. **The redundancy is real**: OrgSwitcher's trigger already renders the org name. Recommend collapsing to one control — an `OrgMark` (logo/initials, no restated name) linking to `/o/<slug>`, with OrgSwitcher remaining the sole home of the name + switch affordance.

**B — Portal menu.** Nav row sourced from `visiblePortalTiles()`; the destination page's own gate stays the sole authority (tiles.ts's design comment). Convenience, not enforcement — deep links work unaided.

**C — (account) branding.** Today: platform palette unconditionally, no brand read at all. Proposed rule: brand with the user's org brand when exactly one enterable org (mirrors /launch's matrix philosophy, reuses the same availableOrganizations query — no new oracle); 0 or 2+ orgs → platform palette.

## Permissions & Flags

- Header swap: no new permission; recommend riding a new `org_portal.chrome_v2` (not `home_v2`) so rollback isn't entangled with the home redesign.
- Menu: no new permission; entries keep their tiles.ts flagKeys. **Pre-existing defect surfaced:** the `feedback` tile's flagKey is `org_portal.tickets` (borrowed, not its own) — consequential once it's a persistent header link; fix or accept explicitly in Phase 3.
- (account) branding, if adopted: its own flag (`org_portal.account_brand`) given token-partition risk.

## Gaps

1. No-logo empty state — OrgMark already falls back to initials; no new work.
2. Mobile 360-390px — five entries won't fit one row; hamburger vs wrap is an open Phase 3 question.
3. Active-state needs `usePathname()` — a client leaf, like OrgSwitcher/AvatarMenu already are; GlobalNav itself stays a Server Component.
4. (account) adoption = a fourth narrow EMITTERS exception (single file, DECISION-094's precedent exactly) + check-brand-scope entry.
5. Brand flip on portal → account → portal navigation must be verified live, not just code-read.
6. `/account/2fa` reachable pre-enrollment — brand read must not depend on TOTP status (orthogonal, but call it out).
7. The unreachable-in-practice no-session fallback header in `(org)/o/[slug]/layout.tsx` also hardcodes "presby" — minor inconsistency, note only.

## Adversarial Pass

No new redirect targets, forms, or cross-org queries; header/menu reuse GlobalNav's existing org-list read; the (account) rule reuses the query /launch already trusts. No enumeration surface. No audit requirement (no security-sensitive mutation).

## Out of Scope

The (public) site chrome; changing tiles.ts's flag-only gating philosophy.

## Open Questions for Phase 2/3

1. (account) branding: own follow-on pipeline vs increment 2 here?
2. Hamburger vs wrap at 360px?
3. Fix or accept the feedback tile's borrowed flagKey?

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-25 |


---

# Phase 2 — Architectural Review (architect)

**Verdict:** Approved with suggestions

## Placement

- `OrgMark` render lives **inside `GlobalNav`**, not a second header in the (org) layout — GlobalNav already owns org-identity resolution and is the shared header. Add an optional `orgMark?: { name: string; markSrc: string | null }` prop populated by the (org) layout from data it already reads (`getOrgBrandForLayout` / `resolveOrgContext`); GlobalNav gets NO new brand query and stays brand-blind for (member)/(admin), where the platform wordmark renders exactly as today.
- The persistent portal menu is **not** part of GlobalNav — org-only chrome, co-located under `src/app/(org)/o/[slug]/` (e.g. `portal-nav.tsx` beside `layout.tsx`), rendered from the layout below `<GlobalNav>`, following `tickets/layout.tsx`'s exact split: server piece resolving `visiblePortalTiles()` + a small `'use client'` leaf for `usePathname()` active-state.
- Mobile: **wrap, not hamburger** — `tickets/layout.tsx` is the precedent; the codebase has zero hamburger/disclosure nav and this pipeline doesn't introduce one.

## Invariants Touched

- **Brand scope (DECISION-047/094): none directly** — OrgMark consumes the cascade the (org) layout already emits; EMITTERS untouched. **Ruling: split `(account)` branding to its own work-log** — a fourth EMITTERS exception + decision entry is categorically heavier than a component swap inside an already-brandable layout. This pipeline ships chrome only (header identity + portal menu).
- **Permissions vs flags:** menu stays flag-only per tiles.ts's design comment; destination page remains sole authority. Compliant.
- **Flag:** `org_portal.chrome_v2` approved, covering both the wordmark swap and the menu as one rollback unit.
- **Feedback tile's borrowed flagKey: fix now** — persistent-header promotion graduates it from cosmetic to consequential; give it `org_portal.feedback`, seed the row, update the pinned tiles test.

## Notes

No new dependency; no schema change (the flag is a seeded row, not a migration); no DECISION entry needed (placement call within the existing partition).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-25 |

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Inside `/o/<slug>`, `GlobalNav`'s "presby" wordmark link is replaced by the organization's own `OrgMark` (logo or initials) linking to `/o/<slug>`, and a persistent, wrapping portal-menu row (Home / Directory / Administration / Tickets / Give feedback, flag-filtered) renders below the header on every org page. Both land behind one flag, `org_portal.chrome_v2`, so flag-OFF is byte-identical to today. The feedback tile's borrowed `org_portal.tickets` flagKey — harmless while cosmetic, consequential once it's a persistent link — gets its own `org_portal.feedback` flag. `(account)` branding is explicitly out of scope (Phase 2 ruling); it gets its own future work-log.

## Permissions & Flags

- No new permission. The menu mirrors `visiblePortalTiles()` exactly — flag-only, destination page remains sole authority (tiles.ts's design comment); the nav layer never checks `role_grants.manage`/`tickets.file`/`directory.view` itself.
- `org_portal.chrome_v2` — new flag, **seeded OFF**. Gates both the wordmark→`OrgMark` swap and the portal-nav row as one rollback unit.
- `org_portal.feedback` — new flag, **seeded OFF**. Replaces `feedback`'s borrowed `org_portal.tickets` key in `PORTAL_TILES`. `org_portal.tickets` stays as-is for the `tickets` tile alone.

## API Contract

No new routes or server actions. One new server-only read:

- `getOrgMarkForLayout(organizationId: string, personId: string): Promise<{ markSrc: string | null } | null>` — new function in `src/lib/brand/read-org-brand.ts`. Reads `organization_brands.markAssetKey` through `withOrgContext(personId, organizationId, …)`, the same membership-verified pattern `getOrgBrandForLayout` uses — but **not** gated on `ui.brand_theming`: a logo is identity, not brand chrome (DECISION-047 "un-brandable does not mean logo-free", G7). When `markAssetKey` exists, calls `getBlobStore().resolve()` and inlines a `data:` URI exactly as `(admin)/admin/organizations/[id]/page.tsx` already does — **not** the public `/site/<slug>/assets/<key>` route, which is gated on `sites.public_render` + site publication, an unrelated feature that would 404 a portal header for any org without a published public site. Returns `null` on no row, no key, or the same `OrgAccessError` race `getOrgBrandForLayout` documents; the caller treats `null` as "no mark," which `OrgMark` already renders as initials.

## Data Model

No schema changes required.

## Component / Page Plan

- **Modify** `src/components/shared/global-nav.tsx` — add `orgMark?: { name: string; markSrc: string | null } | null` prop. When present, the wordmark `<Link>` renders `<OrgMark name={orgMark.name} markSrc={orgMark.markSrc} size="sm" />`, linking to `/o/<currentOrgSlug>` instead of `/`. When absent (every non-`(org)` caller, and `(org)` itself when `chrome_v2` is OFF), `<Link href="/">presby</Link>` renders exactly as today — no new query, GlobalNav stays brand-blind for `(member)`/`(admin)`.
- **Create** `src/app/(org)/o/[slug]/portal-nav.tsx` — server component `PortalNav({ slug })`. Resolves `visiblePortalTiles()`, prepends a hardcoded `{ label: "Home", href: /o/${slug}, exact: true }` entry (Home is not a `PORTAL_TILES` row — `/o/<slug>` always resolves to something, stub or v2 home, regardless of any flag, so gating it on one is wrong), maps the rest to `{ label: tile.label, href: tile.href(slug), exact: false }` in declaration order, renders `<PortalNavLinks entries={entries} />`.
- **Create** `src/app/(org)/o/[slug]/portal-nav-links.tsx` — `'use client'` leaf, `usePathname()`-driven active state: `exact` entries match `pathname === href`; every other entry matches `pathname.startsWith(href)`. `flex flex-wrap gap-4 text-sm` row, mirroring `tickets/layout.tsx`'s nav classes — wrap, no hamburger.
- **Modify** `src/app/(org)/o/[slug]/layout.tsx` — read `org_portal.chrome_v2` once alongside the existing `resolveOrgContext()` call. When ON and `resolved.kind === "ok"`, call `getOrgMarkForLayout()` in parallel with `getOrgBrandForLayout` (`Promise.all`), pass `{ name: resolved.org.name, markSrc }` as `orgMark`, and render `<PortalNav slug={slug} />` below `<GlobalNav>`. Every other outcome (flag OFF, `forbidden`/`ended`/`not-found`, no session) renders neither — DECISION-040's access-denied/ended/404 copy stays untouched.

## Implementation Order

1. `scripts/seed.ts` — add `org_portal.chrome_v2` and `org_portal.feedback` rows, both `enabled: false`, with the same "ships dark" comment style as the existing `org_portal.*` entries.
2. `src/lib/org-portal/tiles.ts` — `feedback`'s `flagKey` → `org_portal.feedback`. Update `tiles.test.ts`'s `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS` and split the "tickets and feedback share one flag" test into two independent per-flag tests.
3. `src/lib/brand/read-org-brand.ts` — add `getOrgMarkForLayout()` + its unit test.
4. `src/components/shared/global-nav.tsx` — `orgMark` prop + conditional render + component test (prop absent → unchanged output).
5. `src/app/(org)/o/[slug]/portal-nav.tsx` + `portal-nav-links.tsx` + component tests (empty tiles → Home only; active-state exact vs prefix; declaration order).
6. `src/app/(org)/o/[slug]/layout.tsx` wiring + layout-level test (flag OFF → byte-identical header, no nav row; flag ON + `"ok"` → both render; flag ON + non-`"ok"` → neither renders).
7. Release notes + `docs/product/functionality-map.md` at Phase 6 ship time (not this pipeline's Phase 3 output).

## Edge Cases & Risks

- **Degraded org-list read:** `PortalNav`'s data source (`visiblePortalTiles()`) is independent of `GlobalNav`'s org-list read — one degrading doesn't touch the other.
- **`isFlagEnabled()` DB error:** fails closed per-key (CLAUDE.md invariant) — a blip silently hides the affected tile/row, never crashes.
- **All tiles' flags OFF:** the nav row is **never fully hidden** while `chrome_v2` is ON — `Home` is hardcoded and unconditional.
- **Admin-tile visibility:** reuses `org_portal.roles` exactly as `PORTAL_TILES` gates it — no `role_grants.manage` check at the nav layer.
- **Long org names at 360px:** applies to `OrgSwitcher` (already truncates), not `OrgMark` (fixed square, no text) — not a new risk. **CORRECTED POST-QA (Phase 4 rework, 2026-08-25):** wrong — swapping the text wordmark for the fixed-square `OrgMark` frees row width, which changes how much `OrgSwitcher` gets to truncate against; it was a real interaction, caught by `e2e/header-controls.spec.ts:155` expecting stale clipping. Resolved as a deliberate behavior change (fits-in-full now beats forced clipping), not a bug — see Phase 4 rework section.
- **Existing e2e blast radius:** `e2e/header-controls.spec.ts` and `e2e/member-home.spec.ts` exercise this exact `GlobalNav`/`(org)` chrome; neither asserts the wordmark's text/href today, so flag-OFF-by-default means no expected break, but both must re-run in Phase 5.

## Implementer

**ux-developer** — component/page work throughout (`GlobalNav` prop, two new co-located files, layout wiring); the one new read (`getOrgMarkForLayout`) is a narrow, pattern-following addition beside the component it feeds, consistent with this codebase's precedent for `(org)`/shared work (`docs/work-log/2026-08-19-brand-foundation.md` commit `a7`).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-25 |

---

# Phase 4 — Implementation (ux-developer)

**RESUMED SESSION.** A prior agent's Phase 4 attempt was interrupted mid-build
by a laptop sleep; this session read the partial diff before writing
anything, kept what already matched the Phase 3 design, corrected/finished
the rest, and completed the remainder.

## What Was Already Correct (kept as-is)

- `scripts/seed.ts` — `org_portal.chrome_v2` and `org_portal.feedback` rows,
  both `enabled: false`, no duplicates, comment style matches sibling
  `org_portal.*` entries.
- `src/lib/org-portal/tiles.ts` / `tiles.test.ts` — `feedback`'s `flagKey`
  was already `org_portal.feedback`; `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS` and
  the split "tickets and feedback are independent" tests were already in
  place. No changes needed.
- `src/lib/brand/read-org-brand.ts` — `getOrgMarkForLayout()` was already
  fully implemented, matching `getOrgBrandForLayout()`'s
  `withOrgContext()`/`OrgAccessError` pattern exactly and NOT gated on
  `ui.brand_theming` per the design's DECISION-047 reasoning. Only gap: it
  had zero test coverage (see below).
- `src/components/shared/global-nav.tsx` — the interrupted attempt's one
  line (`import { OrgMark } from "@/components/brand/org-mark"`) was correct
  and unused; built on top of it rather than redoing it.

## What Was NOT Yet Done (completed this session)

- `src/app/(org)/o/[slug]/layout.tsx` — the diff present at resume time was
  from an UNRELATED, already-in-flight pipeline (`light-only-brand`'s
  `lightOnly` prop on `<BrandTokens>`) — zero portal-chrome wiring existed.
  Added: `org_portal.chrome_v2` read in parallel with `resolveOrgContext()`;
  inside `resolved.kind === "ok"`, when the flag is ON, `getOrgMarkForLayout()`
  runs in parallel with `getOrgBrandForLayout()` (`Promise.all`), and
  `<PortalNav slug={slug} />` renders below `<GlobalNav orgMark={...}>`.
  Every other outcome (flag OFF, `forbidden`/`ended`/`not-found`, no
  session) renders neither, matching brand emission's existing branch.
- `src/components/shared/global-nav.tsx` — added the `orgMark` prop, the
  conditional wordmark swap (`<OrgMark>` linking to `/o/<slug>` vs. the
  unchanged `presby` link to `/`), and four new tests.
- `src/app/(org)/o/[slug]/portal-nav.tsx` (new) — server component,
  `visiblePortalTiles()` + a hardcoded, unconditional `Home` entry
  (`exact: true`) prepended ahead of the flag-filtered tiles, in declaration
  order.
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` (new) — `'use client'` leaf,
  `usePathname()`-driven active state. **One deliberate divergence from the
  design's literal wording:** the design says non-exact entries match via
  `pathname.startsWith(href)`; implemented as
  `pathname === href || pathname.startsWith(href + "/")` instead — a bare
  `startsWith` would false-positive `/o/acme/directory-archive` as
  "Directory" active (no sibling route happens to collide today, but the
  boundary is one route rename away from a real bug). Pinned by a
  regression-shaped test (`does not cross-match a differently-named sibling
  route`). `flex flex-wrap gap-4 text-sm` matches `tickets/layout.tsx`'s
  nav classes exactly — wrap, not hamburger, per the Phase 2 ruling.
- `src/lib/brand/read-org-brand.test.ts` (new) — DB-backed integration
  tests for `getOrgMarkForLayout()` (real Postgres, `describe.skipIf(!hasDb)`,
  same posture as `directory.test.ts`/`blob-store.test.ts`). Covers: real
  logo → `data:` URI through the same blob store the admin write path uses;
  no `organization_brands` row → `null`; a brand row with no `markAssetKey`
  → `null`; a person with no active membership at the org → `null` (the
  real `withOrgContext()` RLS/membership gate, not a mock); NOT gated on
  `ui.brand_theming` (no flag row exists in the fixture and the mark still
  resolves). `getOrgBrandForLayout()` itself is left untested — it shipped
  with zero coverage in the earlier brand-foundation pipeline and widening
  that gap is out of scope here.
- `src/app/(org)/o/[slug]/layout.test.tsx` (new) — orchestration tests for
  the wiring contract: flag OFF → `orgMark: null`, no `PortalNav`,
  `getOrgMarkForLayout` never called; flag ON + `"ok"` → both render, with
  and without a logo; flag ON + `forbidden`/`ended`/`not-found` → neither
  renders and neither brand function is called; no session → the
  unreachable-in-practice fallback header, unchanged.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx` (new) — entry-construction
  tests: Home-only when every tile flag is off, Home prepended ahead of
  visible tiles, declaration order preserved.
- `src/app/(org)/o/[slug]/portal-nav-links.test.tsx` (new) — active-state
  tests: exact vs. prefix matching, child-route matching, and the
  sibling-route non-collision regression above.
- `src/components/shared/global-nav.test.tsx` — four new tests: platform
  wordmark unchanged when `orgMark` is absent; `OrgMark` + `/o/<slug>` link
  when present; initials fallback when `markSrc` is `null`; defensive
  fallback to the platform wordmark if `orgMark` is ever passed without
  `currentOrgSlug` (the caller never actually does this, but the component
  doesn't trust that).

## Files Created

- `src/app/(org)/o/[slug]/portal-nav.tsx`
- `src/app/(org)/o/[slug]/portal-nav-links.tsx`
- `src/app/(org)/o/[slug]/portal-nav.test.tsx`
- `src/app/(org)/o/[slug]/portal-nav-links.test.tsx`
- `src/app/(org)/o/[slug]/layout.test.tsx`
- `src/lib/brand/read-org-brand.test.ts`

## Files Modified

- `src/app/(org)/o/[slug]/layout.tsx` — portal-chrome wiring (see above).
  The unrelated `lightOnly` line from the in-flight light-only-brand
  pipeline was left exactly as found.
- `src/components/shared/global-nav.tsx` — `orgMark` prop + conditional
  wordmark render.
- `src/components/shared/global-nav.test.tsx` — new `orgMark` describe block.

## Files Verified Already Correct, No Change Needed

- `scripts/seed.ts`, `src/lib/org-portal/tiles.ts`,
  `src/lib/org-portal/tiles.test.ts`, `src/lib/brand/read-org-brand.ts`.

## Schema Changes

None. Both flags are seeded rows, per the design.

## Audit Events

None — no security-sensitive mutation. Chrome/navigation only.

## Gates Run

- `npm run typecheck` — PASS, zero errors.
- `npm run test` — 124 files / 1933 tests passed, 10 files / 223 tests
  skipped (DB-backed suites, no `DATABASE_URL` in this shell profile —
  the same skip every other DB-backed suite in this repo takes under plain
  `npm run test`). Targeted re-run of the five files touched this session
  (`layout.test.tsx`, `portal-nav.test.tsx`, `portal-nav-links.test.tsx`,
  `global-nav.test.tsx`, `tiles.test.ts`): 41/41 passed.
- `dotenv -e .env.local -- vitest run src/lib/brand/read-org-brand.test.ts`
  — 5/5 passed against the real dev database (fixtures created and torn
  down: 4 orgs, 4 people, 1 blob asset, 1 fixture platform user for the
  `organization_brands.updated_by` FK).
- `npm run check` (all four tripwires: audit coverage, sql-date, deps-drift,
  brand-scope) — PASS.
- `npm run build` — PASS, `next build` succeeds, `/o/[slug]` and its
  children build as dynamic routes as expected.
- `npm run lint` — clean on every file touched this session (the repo-wide
  `npm run lint` run surfaces 36 pre-existing warnings, all under
  `scratch/presby-site-kit/` from an unrelated in-flight pipeline; zero on
  anything this pipeline touched).

## Browser Verification

Flipped `org_portal.chrome_v2` and `org_portal.feedback` to `enabled: true`
directly in the shared dev database (`PLATFORM_DATABASE_URL`) and **left
them ON** — the user is actively demoing the fpcw site build with this
admin account and the seed defaults (both OFF) are untouched, so a fresh
`db:seed` run reverts correctly. Signed in as `admin@presby.invalid` /
`e2e-fixture-only-not-a-secret` (active membership at `fpcw`) against the
shared dev server on `:3000` (not restarted).

- `/o/fpcw` at 1280px: fpcw's actual logo renders in the header (not
  initials — `organization_brands.mark_asset_key` is set for fpcw), linking
  to `/o/fpcw`; the org name renders beside it via `OrgSwitcher` as before;
  the portal-nav row shows Home / Directory / Give feedback (fpcw has no
  `org_portal.roles`/`org_portal.tickets` flag on, so Administration and
  Tickets are correctly absent — flag-only filtering confirmed live, not
  just in a mock).
- `/o/fpcw` at 390px: the nav row wraps cleanly, no horizontal scroll, all
  three links remain tappable.
- `/o/fpcw/directory` at 1280px and 390px: "Directory" renders with
  `aria-current="page"` styling (bold, `text-foreground`) while Home and
  Give feedback stay muted; no horizontal scroll at 390px.
- `/home` at 1280px: unchanged — platform `presby` wordmark linking to `/`,
  `Organizations` switcher, no portal-nav row. Confirms the EMITTERS/prop
  scoping: `GlobalNav` outside `(org)` never receives `orgMark` and renders
  exactly as before this pipeline.
- Initials fallback: checked via SQL rather than the browser — `alder-creek`
  has no `organization_brands` row at all (no logo), so the live fallback
  path wasn't independently reachable with the seeded fixture data without
  provisioning a third demo org. The initials-fallback CODE PATH is instead
  pinned directly by unit tests (`global-nav.test.tsx`'s "falls back to
  initials when orgMark carries no markSrc" and
  `layout.test.tsx`'s "falls back to initials-only rendering (markSrc:
  null)"), which is the `getOrgMarkForLayout() → null` → `OrgMark` branch
  exercised end-to-end at the component level. Flagged for whoever demos
  alder-creek next: if a logo gets attached to it, the initials fallback
  will no longer be visually reachable at all in this dataset.

## Implementer Notes

- **Divergence from the design's literal active-state matching rule**,
  documented above and in the code comment on `portal-nav-links.tsx`: exact
  match OR prefix-with-boundary, not a bare prefix. Chosen because a bare
  `pathname.startsWith(href)` is a latent false-positive on any future
  sibling route sharing a prefix (e.g. a hypothetical `/directory-export`
  page would show "Directory" as active) — strictly safer, same intent,
  same test list the design called for plus one regression case.
- **`getOrgMarkForLayout()` had no test file at all before this session**
  (neither did its sibling `getOrgBrandForLayout()`, pre-existing gap from
  the brand-foundation pipeline). Wrote the DB-backed suite fresh, including
  fixture plumbing the design didn't spell out at that level of detail: a
  person can hold only one `memberships` row across the whole platform
  unless linked through `presby_claim_person()` (`presby_guard_membership_insert`,
  drizzle/0009), so the fixture uses one person per organization rather than
  reusing a single person across the three brand-shaped orgs — and
  `organization_brands.updated_by` is a `NOT NULL` FK to `users`, requiring
  a fixture platform-user row the design's data model section didn't
  mention (no schema change, just an insert this test needed to make).
- **No new copy strings** a fork's branding pass needs to review — the
  nav labels (Home, Directory, Administration, Tickets, Give feedback) are
  unchanged tile-registry copy, and the `aria-label`s added
  (`"<name> home"`, `"<name> logo"`) are template strings built from each
  org's own name, not literal platform copy.
- **UX tradeoff:** the wordmark's focus/hit-area padding
  (`px-1 py-1` → `px-0 py-0` when swapped to `<OrgMark>`) trades a slightly
  smaller click target for keeping the logo's own rounded-square shape
  un-inset — `OrgMark` already supplies its own border/plate, so double
  padding would look like a mark floating inside an unnecessary frame.
  Still comfortably above the 44px target at `size="sm"` in the header
  context (verified via the 44px assertions in `header-controls.spec.ts`,
  which pass unchanged since the org-switcher/avatar targets are
  untouched — the wordmark link itself was never asserted against 44px and
  still isn't, matching its treatment as a link, not a button).
- **e2e blast radius:** `e2e/header-controls.spec.ts` (21/21 passed) and
  `e2e/member-home.spec.ts` (7/8 passed; the one failure — "seeded admin
  signs in and lands on /admin", landing on `/orgs` instead — is the
  pre-existing, documented dev-DB-pollution failure named in the task brief,
  not new). No new e2e specs were added this session; the design's test
  list was unit/component-level (tiles registry, portal-nav states,
  active-state, `getOrgMarkForLayout`), and both flags default OFF so the
  existing e2e suites are unaffected by construction until a future
  pipeline flips them on in the seed defaults.

## Next

**qa** — Phase 5. Both flags are currently ON in the shared dev database
(deliberately, for the fpcw demo) — qa should not treat that as a signal
about seed defaults; `scripts/seed.ts` still seeds both OFF.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | ux-developer | Complete | — | 2026-08-25 |


---

# Phase 5 — Test Verification (qa) — FIRST PASS

**Date:** 2026-08-25 · **Verdict: FAIL** (one finding; everything else green)

## Green

typecheck PASS · unit **1933/1933** (223 skips = the documented DB-guard pattern, reconciled file-by-file) · DB-backed brand/org-portal **30/30** (incl. getOrgMarkForLayout's no-membership → null via the real RLS gate) · build PASS · `npm run check` PASS ×4 (brand-scope green with OrgMark in GlobalNav) · flag-OFF regression floor verified at test AND code level (orgMark branch strictly additive) · feature-gate audit: getOrgMarkForLayout membership-verified inside withOrgContext and only reachable after `resolved.kind === "ok"` — cannot leak a foreign org's logo; menu is flag-only by design, no permission check crept in; both flags seeded OFF (dev DB deliberately ON for the demo) · live checks all pass (org identity + menu + active-state on /o/fpcw; platform wordmark untouched on /home and /admin; no horizontal scroll at 390px).

## The Finding (FAIL cite)

`e2e/header-controls.spec.ts:155` — new, reproducible, caused by this feature: at 360px on /o/e2e-presbytery, the OrgMark logo is narrower than the old "presby" text wordmark, freeing enough flex-row width that "Presbytery of the Eastern Fells" now fits un-clipped; the pre-existing test asserts `scrollWidth > clientWidth` (visible truncation). No wrap and no overflow occur — the *symptom* the test guards never happens — but the encoded assertion fails, and Phase 3's Edge Cases explicitly (and wrongly) waved this interaction off. Only manifests flag-ON; the flag-OFF pin cannot catch it by construction.

## Loop-back

To ux-developer (Phase 4): either constrain OrgSwitcher's available width so truncation is independent of the wordmark slot's occupant, or make and document the deliberate call that the wider-fitting behavior is correct and update the test's expectation — while proving with a longer fixture name that truncation still engages when genuinely needed. Correct Phase 3's edge-case note in the same pass.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (first pass) | qa | Complete | FAIL | 2026-08-25 |

---

# Phase 4 — Rework (360px truncation contract)

## The Call

**The wider-fitting behavior is correct; the old assertion was testing an
implementation detail (whether the wordmark happened to be text or a logo),
not the actual contract.** A name that fits on one row at 360px should show
in full — clipping a name that has room is worse UX than the "problem" QA's
finding surfaced. Truncation exists as a safety valve for names that
genuinely don't fit, not as a mandate that some name always be visibly
clipped. Went with the recommended direction over the alternative
(artificially constraining `OrgSwitcher`'s available width to force clipping
regardless of the wordmark's occupant) — that would trade a real UX
improvement for test stability, which is backwards.

Two things had to actually be proven, not just asserted around:

1. **The layout is genuinely fine at 360px** — no wrap, no page overflow, no
   cramped collision between logo/name/avatar. Read the QA failure
   screenshot first
   (`test-results/header-controls-org-switch-162bc-ating-the-organization-name-chromium/test-failed-1.png`)
   before touching the test: at 360px, `/o/e2e-presbytery` shows the
   presbytery's maroon-initialed "PF" OrgMark (its `organization_brands` row
   has a seed color but no logo asset — confirms the brand cascade is live,
   not just the mock), the full name "Presbytery of the Eastern Fells", the
   chevron, and the "EO" avatar circle, all on one row with visible spacing
   between each element — no crowding, nothing clipped by accident, nothing
   pushed to a second line. The header genuinely looks right.
2. **The safety valve still exists** for a name that IS too long. No current
   e2e fixture organization name is long enough to force real clipping in
   the new, wider-fitting layout (checked all four: `presbytery` "Presbytery
   of the Eastern Fells", `alpha` "Wrenfield Presbyterian Church", `beta`
   "Thistledown Presbyterian Church", `gamma` "Halloway Presbyterian
   Church" — all in the same 29–32 character range, and `beta`/`gamma` never
   reach the "ok" `resolveOrgContext()` branch that renders the chrome at
   all, so they couldn't be used for this even if longer). Rather than
   inventing an unrealistically long fixture org name (which the e2e
   seed-shape guard and CLAUDE.md's No-Real-Data house style both push
   against doing lightly), proved the mechanism at the component level
   instead: `src/components/shared/global-nav.test.tsx` renders `GlobalNav`
   with `orgMark` set and a synthetic ~100-character name no real 360px
   header could ever fit, and asserts the `truncate` class is still present
   on the org-name span. jsdom does no real layout (scrollWidth/clientWidth
   are always 0), so this can't measure actual pixel clipping — that's
   inherently e2e's job — but it does pin the CSS mechanism staying wired,
   which is the part a code change could silently break.

## Changes

- `e2e/header-controls.spec.ts` — rewrote "stays on one row at 360px,
  truncating the organization name" → "stays on one row at 360px, and keeps
  the truncation safety valve wired". New assertions: header height < 72px
  (one row, unchanged), avatar doesn't overflow the right edge (unchanged),
  `document.documentElement.scrollWidth <= 360` (new — the actual "did
  anything overflow the page" check, which is the real failure mode this
  test exists to catch), the name span's `scrollWidth <= clientWidth` (new —
  confirms the BETTER behavior actually shipped: the name is genuinely
  un-clipped now, not just that the old assertion was deleted), and the name
  span still carries the `truncate` class (new — the safety-valve
  structural pin). A long comment block above the test explains the
  rationale and points at the unit test below for the piece e2e can't prove
  with current fixtures.
- `src/components/shared/global-nav.test.tsx` — new test in the "orgMark
  prop" describe block: `"keeps the truncate mechanism wired for a name long
  enough to need it, even after the OrgMark swap frees width in the row"`.
  Renders with a synthetic long name via the same `FELLS`-shaped fixture
  spread, asserts `org-switcher-trigger` still contains a `span.truncate`
  carrying the full name text.
- `docs/work-log/2026-08-25-portal-chrome.md` — Phase 3's Edge Cases bullet
  ("Long org names at 360px... not a new risk") corrected in place with a
  **CORRECTED POST-QA** annotation rather than silently rewritten — it was
  wrong: the OrgMark swap does change how much width `OrgSwitcher` has to
  truncate against, which is exactly what QA's finding demonstrated.

## Gates Run

- `npx vitest run src/components/shared "src/app/(org)/o/[slug]"` — **380/380
  passed**, 42 files, no skips (no DB-backed suites in this targeted slice).
- `npm run typecheck` — PASS, zero errors.
- `npx eslint e2e/header-controls.spec.ts src/components/shared/global-nav.test.tsx`
  — clean.
- `npx playwright test e2e/header-controls.spec.ts e2e/member-home.spec.ts`
  against the shared dev server on `:3000` (not restarted; `org_portal.chrome_v2`
  and `org_portal.feedback` left ON exactly as Phase 4 first-pass left them —
  no flag state touched this session):
  - **`header-controls.spec.ts`: 21/21 passed**, including the rewritten
    360px test.
  - **`member-home.spec.ts`: 7/8 passed.** The one failure — "seeded admin
    signs in and lands on /admin", landing on `/orgs` instead — is the
    pre-existing, documented dev-DB-pollution failure named in the task
    brief (the admin fixture user has accumulated org relationships in the
    shared dev DB across sessions, which the `/launch` matrix correctly
    routes to `/orgs` per its own rules). Not touched, not new, not related
    to this change.

## Next

**qa** — Phase 5, second pass. Both flags remain ON in the shared dev
database (unchanged from Phase 4 first pass); `scripts/seed.ts` still seeds
both OFF.


---

# Phase 5 — Test Verification (qa) — SECOND PASS (SCOPED)

**Date:** 2026-08-25 · **Verdict: PASS**

Scope: the reworked 360px truncation contract only; all first-pass green results stand.

1. The rewritten e2e test (`header-controls.spec.ts:128-192`) is a real contract, not an inverted rubber-stamp: one row (<72px), avatar within 360px, page `scrollWidth ≤ 360` (the actual failure mode), name span un-clipped (proving the improvement shipped), `truncate` class pinned; inline comment discloses the dropped assertion and points at the unit test.
2. `global-nav.test.tsx:265-303`: synthetic ~102-char name WITH `orgMark` set — exercises exactly the configuration the bug required; honestly notes jsdom can't measure pixel clipping.
3. `header-controls.spec.ts` live: **21/21**. `src/components/shared` unit: **62/62**. typecheck clean.
4. Phase 3's wrong edge-case bullet left intact with a dated CORRECTED POST-QA annotation — honest correction, not a silent rewrite.

**PASS — no new findings.**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (second pass, scoped) | qa | Complete | PASS | 2026-08-25 |


---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The "presby" wordmark inside `/o/fpcw` is gone, replaced by the org's own logo linking to `/o/fpcw`, the org name renders exactly once, a wrapping portal-menu row with correct active-state persists on every org page, `(account)` branding was properly deferred rather than silently dropped, and platform surfaces stay untouched — all three originating feedback quotes addressed, verified live.

## What's Working (live, both widths)

- `/o/fpcw` header: logo → `/o/fpcw`, org name shown once (OrgSwitcher is the sole name-bearing element; the only "presby" match on the page is inside "Presby**terian**" in the org's own name).
- Menu flag-filtered correctly live (Administration/Tickets absent with their flags off; Home/Directory/Give feedback present, `aria-current` active-state right on both routes).
- `/home` and `/orgs` still platform-branded; EMITTERS scoping held.
- 390px: `scrollWidth === 390` on both checked routes; truncation safety valve pinned by the synthetic-long-name unit test (disclosed limitation: no fixture name is long enough to clip live in the wider-fitting layout).

## Intent-vs-Shipped Diff

Matches on every Phase 1 point: logo-only OrgMark + name-only OrgSwitcher; flag-only convenience menu with the destination as sole authority; `(account)` deferred with the TODO line present (Phase 2 ruling); feedback flagKey split to `org_portal.feedback`. The one drift — Phase 3's wrong 360px edge-case call — was caught by QA, fixed, and corrected in place with a dated annotation.

## Edge Cases

Empty state (no-logo initials): pinned at the component boundary; not live-reachable with current fixtures (alder-creek has no membership for the demo admin) — acceptable, noted. Failure microcopy: pass. Permission gate: pass (membership-verified logo read; no nav-layer authz leak). Audit: n/a, correct. Mobile: pass.

## Rule 12/13

Rule 12: n/a (in-session feedback, not a feedback-table row). Rule 13: recommend a what's-new entry when the chrome flag ships on for real congregations.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-25 |

**Pipeline closed.** Commits await user review per Workflow Rule 1.
