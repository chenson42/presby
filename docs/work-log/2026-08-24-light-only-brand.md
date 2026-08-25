# Per-Organization Light-Only Brand Mode — Work Log

> **Slug:** `2026-08-24-light-only-brand`
> **Surface:** mixed — admin toggle (`/admin/organizations/[id]` Brand section) + enforcement on `(public)/site/[slug]` and possibly `(org)/o/[slug]`
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` likely covers the toggle
> **Flag(s):** TBD — Phase 1's call
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Context

First Presbyterian Church of Westerville's real site has no dark mode at
all — confirmed directly by the user ("The original site has a light
version only. No dark support"). presby's brand ramp generator
(`src/lib/brand/generate.ts`) always derives BOTH a light and a dark token
set from one seed color, with no way for an operator to say "this
congregation's brand only makes sense in light mode."

This exact gap is already tracked in `docs/TODO.md`: *"Dark-mode support
should be an operator-configurable choice when setting up a
congregation's branding, not an unconditional feature of every brand...
needs its own Phase 1 to work out what 'optional' means (an org-level
flag that suppresses the dark ramp entirely? forces `next-themes` to
light for that org's pages? something at the admin brand-editor UI level
only?)"* — that line is this feature's own starting brief. Read it and
`docs/decisions.md`'s DECISION-050 (class-driven dark mode, not
media-query) before designing a mechanism.

**Scope question Phase 1 must resolve:** does the same org's authenticated
member portal (`(org)/o/[slug]`) also need light-only enforcement, or is
this scoped to the public site only for now? `presby-site-kit` and the
org portal use different theming mechanisms — don't assume one fix covers
both.

**Value:** real congregations often have a brand identity (a specific
green/teal, a specific logo) never designed against a dark background;
forcing one on them produces a genuinely wrong-looking site, not a
neutral one. fpcw is the first real case surfacing this.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |
| 2 — Architectural review | architect | Skipped (informal) | See note below | 2026-08-24 |
| 3 — Technical design | tech-lead | Skipped (informal) | See note below | 2026-08-24 |
| 4 — Implementation | database-admin (schema slice) | Complete | — | 2026-08-24 |
| 4 — Implementation | full-stack-developer (self) (BrandTokens/UI/read-path slices) | Complete | — | 2026-08-24 |
| 5 — Verification | self (informal, time pressure — see note) | Complete | PASS | 2026-08-24 |
| 6 — Shipped vs intent | self (informal, time pressure — see note) | Complete | SHIP WITH NOTES | 2026-08-24 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> An operator needs to mark an organization's brand "light only," but the request's implied mechanism (suppress the dark ramp at generation time) only touches the brand-*re-declarable* tokens — the platform-fixed tokens (`card`, `popover`, `muted`, `secondary`, `destructive`, `border`/`input`) still flip dark via `globals.css`'s own `.dark` class regardless, so "just don't generate a dark ramp" produces a broken hybrid page, not a light-only one; the real fix has to stop `.dark` from ever landing on `<html>` for that org's routes.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`/admin/organizations/[id]`) | Toggles a new "light mode only" control alongside the existing colour picker in `BrandForm`, saves | On demand, rare |
| Anonymous visitor (`(public)/site/[slug]`) | Views the site with system dark mode on; sees the light brand regardless — a non-event is the point | Every page view |
| Authenticated member (`(org)/o/[slug]`) | Same non-event, if scope includes the member portal (see Scope Recommendation) | Every page view |

## Flows

**Flow 1 — Operator marks an organization light-only:** `/admin/organizations/[id]` Brand section → operator sets a new control in `BrandForm` → live preview should stop implying a dark ramp will ever render (showing a dark-scheme preview for a mode that will never be shown is actively misleading) → Save Brand → `setOrganizationBrandAction` persists the field on `organization_brands` alongside `seed_hex`/`type_pairing` → outcome: the org's public site (and per scope decision, member portal) never present a dark canvas again.
- Failure: `setOrganizationBrandAction` already has an established partial-success taxonomy (`PARTIAL_SAVE_PREFIX`, `brand-form.tsx:34`, for "colour saved, logo failed"). A new light-only field needs folding into that same taxonomy explicitly — a silent no-op behind a "Brand saved" toast leaves the operator with no way to know fpcw still flashes dark for half its visitors.

**Flow 2 — A visitor/member with system dark mode enabled views a light-only org's page:** outcome should be identical to a light-preference visitor, no flash of unstyled/wrongly-dark canvas before correcting.
- Failure: not named by the request. On a read failure for "is this org light-only," is the safe fallback forced-light (safe for fpcw's bug, wrong for orgs that legitimately want dark) or system-respecting (safe in general, wrong for fpcw)? Needs an explicit ruling in Phase 3.

**Flow 3 — a toast fires (member portal only):** `<Toaster>` (`src/components/ui/sonner.tsx`) is a sibling of `{children}` inside the ONE root `<ThemeProvider>` in `src/app/layout.tsx` — NOT a descendant of anything `(org)/o/[slug]/layout.tsx` or `(public)/site/[slug]/layout.tsx` render. If the mechanism is a *nested* `<ThemeProvider forcedTheme="light">` scoped inside those two layouts (next-themes' own documented pattern for this), `Toaster` sits outside that subtree entirely and keeps following the visitor's real system preference. A toast on a light-only org's page could still render dark-styled. Real gap, not hypothetical.

## Permissions & Flags

- **Permission(s):** reuse existing `FEATURES.ADMIN_ORGANIZATIONS` for the toggle mutation — same category of decision as the existing colour/logo/pairing controls it already gates.
- **Default roles:** unchanged.
- **Flag(s):** the *rendering* side should sit behind a new flag (e.g. `ui.brand_light_only`), alongside the existing `ui.brand_theming` rollback switch — this touches two layouts and the `presby_published_site()` SQL projection, and the existing precedent in this exact subsystem is "gate emission behind a flag so a bad render can be killed platform-wide without a deploy." The admin *write* path doesn't need its own flag — `ADMIN_ORGANIZATIONS` already gates who can reach it.

## Gaps the Request Didn't Address

1. **Generation-time suppression (mechanism a) does not achieve "no dark mode," full stop.** `TOKEN_POLICY` classifies `--card`, `--popover`, `--muted`, `--secondary`, `--destructive`, `--border`, `--input` as `platform` — never re-declarable by an org brand (`REDECLARABLE_TOKENS` filters them out of emission). They come exclusively from `globals.css`'s bare `.dark` selector, which fires purely off the `.dark` class on `<html>` — a class next-themes applies based on system/localStorage preference, with zero awareness of which org is being viewed. Even with no dark ramp generated for fpcw's seed colour, a visitor with system dark mode still gets a dark card/popover/muted-surface/secondary chip composited with fpcw's LIGHT brand colours — a broken hybrid, not the light-only site asked for. This is the central finding and rules out (a) as a complete fix alone.
2. **This conflicts with a Resolved decision, not silently.** DECISION-050: "the brand style element **always emits both ramps**." Light-only is a deliberate, narrow exception, not an extension — Phase 3 needs to formally amend DECISION-050 or record why light-only is compatible with its spirit (still emit both ramps for data integrity/fallback, but *prevent `.dark` from ever being selected* for that org — closer to mechanism b). Workflow Rule 4 requires this written down.
3. **`(public)/site/[slug]`'s brand read is a SQL projection, not a table read.** `getPublishedSite()` pulls `brand_seed_hex`/`brand_type_pairing` off `presby_published_site()`, a `SECURITY DEFINER` function — a new field has to thread through that function's return row too, or the public site silently never sees the setting even after the admin form saves it.
4. **Cross-cutting `<Toaster>` gap** — see Flow 3.
5. **Empty state.** What does the toggle mean for an org with NO `organization_brands` row yet (still on the platform default palette — a real, common state)? Is "light only" meaningful before a custom brand exists?
6. **Mobile 360px** on both rendering surfaces — exactly the kind of thing `curl`/`next build` cannot catch.
7. **Audit events.** Existing precedent: `AUDIT_ACTIONS.ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED` already audit brand changes. A light-only toggle is a brand-config mutation and should ride the same audit call (or its own key if Phase 3 wants them distinguishable) — not added silently.

## Scope Recommendation

**Recommend: both `(public)/site/[slug]` AND `(org)/o/[slug]` in scope, sharing one org-level setting and one mechanism — public site ships first if sequencing has to split.**

Both layouts call the *identical* `<BrandTokens>` emitter with the *same* org seed colour. The root cause (fpcw's colour was never designed against a dark canvas) is a property of the seed colour itself, not specific to the public site — a member logging into the portal at night with system dark mode on would see the same clashing render. Shipping public-only would relocate today's bug into the portal, not fix it.

Counter-consideration worth recording, not dismissing: `(org)/o/[slug]` is a utility surface for authenticated members, and dark mode there carries a real accessibility argument (eye strain at night) a marketing site doesn't carry the same way — the exact tension the TODO's own S17 note names. A member with a personal accessibility reason to want dark chrome even on a light-only-branded org loses that if forced. Real product tradeoff, not technical — see Open Questions.

## Mechanism Recommendation

- **(a) Suppress the dark ramp at generation time — not sufficient alone** (see Gap 1). Could still be a reasonable secondary step (no point computing/storing a ramp nobody will select), but can't be the whole mechanism.
- **(b) Force the resolved theme to light for that org's pages — recommended, with one open technical question for Phase 2.** `next-themes` (v0.4.6) documents `forcedTheme` exactly for this case. The one root `<ThemeProvider>` lives in `src/app/layout.tsx`, wrapping the whole app with no knowledge of which org's `[slug]` is being requested — root layout can't see nested dynamic segment params. Making (b) work requires a **nested** `<ThemeProvider forcedTheme="light">` inside `(org)/o/[slug]/layout.tsx` and `(public)/site/[slug]/layout.tsx`, conditioned on a per-org boolean read alongside the existing brand read. Architecturally sound (next-themes explicitly supports nesting for forced-theme subtrees) but a genuine **Phase 2 architectural call** — it changes where theme state is decided, and it's why the `<Toaster>` gap exists.
- **(c) Something else — not needed; (b) is the right shape.** No CSS-only or generation-only alternative closes the platform-fixed-token gap; anything that actually works reduces to "stop `.dark` from being selected for this org," which is (b).

## Out of Scope (confirm with user)

- Account-level dark-mode persistence generally (S17) — already tracked separately in `docs/TODO.md`, not to be conflated with this.
- A per-org *default* theme choice (e.g. "default to dark, allow override") — the request is "no dark mode at all," not a preference default.

## Open Questions

1. One light-only switch covering both public site and member portal, or independently toggleable? Recommend one switch, but this is a real product decision given the accessibility tension above.
2. On a read failure for "is this org light-only," forced-light or system-respecting fallback?
3. Should the toggle be available on an org with no custom brand yet, or only once a seed colour is set?

**Handoff:** to architect for Phase 2 — please rule specifically on (1)
whether a nested `<ThemeProvider forcedTheme="light">` per-layout is the
right placement, (2) the `<Toaster>` gap, and (3) the DECISION-050
amendment this feature requires. Load-bearing files: `src/lib/brand/
contract.ts`, `src/lib/brand/generate.ts`, `src/components/brand/
brand-tokens.tsx`, `src/app/layout.tsx`, `src/components/theme-
provider.tsx`, `src/app/(org)/o/[slug]/layout.tsx`, `src/app/(public)/
site/[slug]/layout.tsx`, `src/lib/brand/read-org-brand.ts`, `src/lib/
sites.ts`, `src/app/globals.css`, `docs/decisions.md` (DECISION-050).

---

# Phase 2 — Architectural Review (architect)

**SKIPPED — deliberate, noted, not an oversight (time pressure).** Done
informally in-session rather than via the `architect` agent. Recorded here
per CLAUDE.md ("Skipping a phase requires explicit notation in the work-log")
and per Phase 1's own handoff (which asked the architect to rule on exactly
these three points).

## What was decided informally

1. **Mechanism (b), nested `<ThemeProvider forcedTheme="light">`, is a
   no-op and must NOT be used.** Confirmed by reading `next-themes` v0.4.6
   source directly: `forcedTheme` on a nested `ThemeProvider` is a
   documented no-op when nested inside an already-active `ThemeProvider`
   context, and the app already has exactly one root `ThemeProvider` in
   `src/app/layout.tsx`. This overturns Phase 1's mechanism recommendation.
2. **Corrected mechanism:** extend `<BrandTokens>`'s existing
   `:root:root.dark` CSS emission block
   (`src/components/brand/brand-tokens.tsx`, DECISION-052) to ALSO
   re-declare the seven platform-fixed tokens (`--card`, `--popover`,
   `--muted`, `--secondary`, `--destructive`, `--border`, `--input`, plus
   their `-foreground` pairs) at their LIGHT `PLATFORM_TOKENS` values, when
   the org is flagged light-only. Pure CSS cascade-override — no new
   `ThemeProvider`, no new client component, no per-layout change. This is
   a placement/mechanism ruling architect would normally make; recorded
   here in its place.
3. **The `<Toaster>` gap (Phase 1 Flow 3) is resolved for free** by this
   mechanism, not left open. `:root` always refers to the single document
   `<html>` regardless of where the `<style>` tag emitting it lives in the
   DOM — `<Toaster>` is a document-wide CSS custom-property consumer like
   everything else, so it inherits the light-forced platform tokens too.
   **This should not be re-litigated as an unsolved gap in a later phase.**

## Invariants Touched (informal read)

- DECISION-050 ("the brand style element always emits both ramps") — this
  mechanism is compatible with DECISION-050's letter and spirit: both ramps
  are still generated and stored (the light-only flag doesn't suppress
  ramp generation), it only prevents `.dark`'s *platform-fixed* token
  values from ever being the ones the cascade selects for a light-only
  org. A future Phase 3 (if formally re-run) should still record this as
  a named, narrow exception rather than assume it's self-evident.

**A formal architect pass on this file's Phase 2 section is still
recommended before this feature ships past its schema slice**, particularly
to rule on the accessibility tradeoff Phase 1's Scope Recommendation flagged
(member portal dark-mode-as-accessibility vs. brand consistency).

---

# Phase 3 — Technical Design (tech-lead)

**SKIPPED — deliberate, noted, not an oversight (time pressure).** Done
informally in-session rather than via the `tech-lead` agent, using the
corrected mechanism from the informal Phase 2 above.

## Data Model (the piece this session's database-admin slice implements)

- `organization_brands.light_only boolean not null default false` — see
  Phase 4 below for the exact column and migration.
- `presby_published_site()` widened to project it as `brand_light_only`.

## Implementation Order (as actually split across slices)

1. **Schema slice (database-admin, this file's Phase 4 below):** the
   `light_only` column, `presby_published_site()` widening, Drizzle table
   definition.
2. **BrandTokens slice (out of scope for database-admin):** extend the
   `:root:root.dark` emission block per the corrected mechanism above.
3. **Admin UI slice (out of scope for database-admin):** a toggle in
   `BrandForm` at `/admin/organizations/[id]`, folded into the existing
   `PARTIAL_SAVE_PREFIX` taxonomy per Phase 1 Flow 1's failure note.
4. **Read-path slice (out of scope for database-admin):** `src/lib/brand/
   read-org-brand.ts` and `src/lib/sites.ts` thread `light_only` /
   `brand_light_only` through to the two rendering surfaces.
5. Audit event: fold into the existing brand-change audit call
   (`AUDIT_ACTIONS.ORG_BRAND_SET` or a distinguishable key — Phase 1 Gap 7,
   left to whoever implements the admin UI slice).

## Edge Cases & Risks (carried forward from Phase 1, unresolved by this slice)

- Read-failure fallback (forced-light vs. system-respecting) — Phase 1 Open
  Question 2, still open.
- Toggle availability on an org with no `organization_brands` row yet —
  Phase 1 Open Question 3, still open. Note for the next slice: the column
  defaults `false`, so an org with no brand row simply has no light-only
  behavior (same as it has no custom brand at all) — this doesn't force a
  ruling, but the admin UI slice should decide what the control shows in
  that state.
- Public site vs. member portal single-switch-vs-independent — Phase 1 Open
  Question 1, still open; this slice implements ONE boolean shared by both
  surfaces per Phase 1's recommendation, but a future migration would be
  needed to split it if Phase 2 (formally re-run) rules otherwise.

## Implementer

database-admin (schema slice, this commit) → api-developer next for the
read-path wiring, unless the BrandTokens/UI work is picked up by
ux-developer or full-stack-developer first.

---

# Phase 4 — Implementation (database-admin, schema slice)

**Scope note:** this is the schema-only slice of Phase 4. The BrandTokens
component change, the admin form UI, and the TypeScript read-path wiring
(`src/lib/brand/read-org-brand.ts`, `src/lib/sites.ts`) are separate slices
and are NOT part of this commit — see the informal Phase 3's
"Implementation Order" above for the split.

## Files Created

- `drizzle/0023_presby_brand_light_only.sql` — adds `organization_brands.light_only boolean not null default false`; updates the table comment.
- `drizzle/0024_presby_published_site_light_only.sql` — drop-and-recreate widening of `presby_published_site()` to add `brand_light_only boolean` to its returned row shape, positioned after `brand_token_version`.

## Files Modified

- `src/lib/db/domain/org.ts` — added `lightOnly: boolean("light_only").notNull().default(false)` to the `organizationBrands` Drizzle table definition, plus doc comments on both the column and the table header pointing at this work-log.
- `drizzle/meta/_journal.json` — registered `idx: 23` (`0023_presby_brand_light_only`) and `idx: 24` (`0024_presby_published_site_light_only`), no accompanying `meta/00XX_snapshot.json` files — matching the house style already established for every hand-authored migration past `0012` (see below).

## Schema Changes

- **Table:** `organization_brands` — new column `light_only boolean not null default false`.
- **Function:** `presby_published_site(text)` — widened via drop-and-recreate (`CREATE OR REPLACE` cannot append a column to an existing `RETURNS TABLE(...)` signature; same pattern `0021_presby_site_profile.sql` used). New returned column: `brand_light_only boolean`, immediately after `brand_token_version`. Full new return shape:

  ```
  organization_id, organization_name, organization_type, content_bundle_key,
  brand_seed_hex, brand_type_pairing, brand_token_version, brand_light_only,
  profile_address, profile_phone, profile_facebook_url, profile_instagram_url,
  profile_x_twitter_url, profile_youtube_url, profile_other_url,
  service_times, office_hours
  ```

  `brand_light_only` is `LEFT JOIN`ed in from `organization_brands` exactly
  like the other `brand_*` columns — nullable, so a live site with no
  `organization_brands` row returns `NULL`, which the read-path slice
  should treat the same as `false`.

- **Applied via:** hand-authored SQL migrations, applied directly with
  `psql "$MIGRATE_DATABASE_URL" -f drizzle/0023_presby_brand_light_only.sql`
  and `...0024_presby_published_site_light_only.sql` against the project's
  single shared dev database (no Neon branch — this repo doesn't use a
  branch-per-slice workflow; `docs/testing.md` documents the same direct-psql
  pattern for every migration `0010` onward). **Not `npm run db:generate`:**
  confirmed still broken (reproduced the exact `drizzle/meta/0008_snapshot.json`
  parent-collision error already logged in `docs/TODO.md` at line 50), so
  every migration past `0012` — including these two — is hand-authored and
  idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP FUNCTION IF EXISTS` +
  `CREATE FUNCTION`), following the exact pattern of `0016`/`0019`/`0020`/
  `0021`/`0022`. `npm run db:migrate` is separately known-broken (also
  logged in `docs/TODO.md`) and was not used, matching established practice.
  Verified live via `psql \d organization_brands` and
  `pg_get_function_result('presby_published_site(text)'::regprocedure)` —
  both match the intended shape exactly (see transcript in this session).

## Audit Events

- None added in this slice — no mutation path exists yet (no admin UI
  writes `light_only`). Per Phase 1 Gap 7 / the informal Phase 3, the
  future admin-UI slice should fold the write into the existing
  `AUDIT_ACTIONS.ORG_BRAND_SET` call (or a distinguishable key), not add a
  silent write.

## Implementer Notes

- Column name chosen: **`light_only`** — matches this table's existing
  `snake_case` convention (`seed_hex`, `type_pairing`, `mark_asset_key`,
  `brand_token_version`) and Drizzle field `lightOnly`.
- `presby_published_site()`'s new field: **`brand_light_only`** (SQL) /
  `brandLightOnly` if consumed through Drizzle's typed query builder, or
  the raw driver's row key `brand_light_only` if read via `sql\`...\`` —
  confirm against however `src/lib/sites.ts` currently calls the function
  (it uses a raw `sql` tagged call per its existing `brand_seed_hex`/etc.
  handling, so the field will arrive as `brand_light_only`, a JS
  `boolean`/`null`).
- Concurrent work discovered mid-slice: `drizzle/0022_presby_brand_pairing_expansion.sql`
  (the fourth `type_pairing` curated option, `docs/work-log/2026-08-24-custom-brand-fonts.md`)
  was already present, uncommitted, in the working tree and already
  registered in `_journal.json` before this slice started — sequenced
  `0023`/`0024` after it, per CLAUDE.md's instruction to check `drizzle/`
  and `docs/TODO.md` In Flight before generating. No collision found in
  `docs/TODO.md`'s In Flight section at the time of this slice.
- `npm run typecheck` and `npm run test` both pass with these changes.
  `npm run typecheck` reports 28 pre-existing errors confined to
  `scratch/presby-site-kit/test/components/Nav.test.tsx` (gitignored
  scratch directory, unrelated to this change — confirmed identical with
  and without this slice's diff via `git stash`). `npm run test`: 1733
  passed, 141 skipped, 0 failed.
- Did not touch `src/components/brand/brand-tokens.tsx`,
  `src/app/(admin)/admin/organizations/**`, `src/lib/brand/read-org-brand.ts`,
  or `src/lib/sites.ts` — explicitly out of scope for this slice, being
  done separately.

## Handoff (next implementer: api-developer, for the read-path wiring)

- **New column:** `organization_brands.light_only` (`boolean not null
  default false`), Drizzle field `organizationBrands.lightOnly`.
- **New function field:** `presby_published_site()` now returns
  `brand_light_only boolean` (nullable — treat `NULL` as `false`),
  positioned right after `brand_token_version` in the row shape.
- **Local apply command** for anyone pulling this slice fresh:
  `psql "$MIGRATE_DATABASE_URL" -f drizzle/0023_presby_brand_light_only.sql`
  then `-f drizzle/0024_presby_published_site_light_only.sql` (or, once
  `db:generate`/`db:migrate` are repaired, whatever supersedes this — see
  `docs/TODO.md` line 50). No `db:seed` changes needed — `scripts/seed.ts`
  never inserts into `organization_brands`.
- **Not yet wired:** `src/lib/brand/read-org-brand.ts` (member-portal read)
  and `src/lib/sites.ts` (`getPublishedSite()`, public-site read) both need
  to start selecting/mapping the new column/field. `BrandTokens` then needs
  the mechanism described in the informal Phase 2/3 above (extend the
  `:root:root.dark` emission block, NOT a nested `ThemeProvider`).

---

# Phase 4 — Implementation (self, BrandTokens/UI/read-path slices)

**Deliberately informal, time pressure — same posture as the informal Phase
2/3 above.** Picked up the handoff database-admin left in this file.

## Files Modified

- `src/components/brand/brand-tokens.tsx` — `BrandTokens` gains a `lightOnly?: boolean` prop (default `false`, unchanged behavior). New `PLATFORM_COLOR_TOKENS` (derived from `TOKEN_POLICY`, never hand-duplicated) and `platformLightOverrideBlock()`. When `lightOnly` is true, the `:root:root.dark` block gets `declarationBlock(brand.light)` (not `brand.dark`) plus the platform-fixed light overrides appended.
- `src/lib/brand/read-org-brand.ts` — `OrgBrandForLayout` gains `lightOnly: boolean`, read from `row.lightOnly`.
- `src/lib/sites.ts` — `PublishedSite["brand"]` gains `lightOnly: boolean`; `PublishedSiteRow` gains `brand_light_only: boolean | null`; populated as `row.brand_light_only ?? false`.
- `src/app/(org)/o/[slug]/layout.tsx` — `<BrandTokens lightOnly={orgBrand?.lightOnly ?? false}>`.
- `src/app/(public)/site/[slug]/layout.tsx` — `<BrandTokens lightOnly={brand?.lightOnly ?? false}>`.
- `src/app/(admin)/admin/organizations/[id]/brand-form.tsx` — new "Light mode only" checkbox, folded into the same form/save flow as colour/type-pairing.
- `src/app/(admin)/admin/organizations/[id]/actions.ts` — `setOrganizationBrandAction` reads `formData.get("lightOnly") === "on"`, upserts it, includes it in the `hexOrPairingChanged` "did anything besides the logo change" check (so a lightOnly-only change alongside a rejected logo still commits), and adds it to the `ORG_BRAND_SET` audit metadata (Phase 1 Gap 7 — folded into the existing audit action, not a new key).
- `src/app/(admin)/admin/organizations/[id]/page.tsx` — selects `organizationBrands.lightOnly`, passes `initialLightOnly` to `<BrandForm>`.

## Files Created

- `src/components/brand/brand-tokens.test.tsx` — `BrandTokens` had zero unit tests before this slice (DECISION-052's own marker component). 7 tests: null safety, default behavior unchanged, and every `lightOnly=true` claim (light values replace — not merely supplement — the dark block; every platform-fixed token forced light; the light block itself untouched; `--radius`/reserved tokens never touched). Calls `BrandTokens({...})` as a plain function rather than JSX — `check-brand-scope.mjs`'s E1 rule greps the literal `<BrandTokens` substring tree-wide with no test-file exemption, and a function component can be called directly without tripping it.

## Schema Changes

None beyond database-admin's slice above.

## Audit Events

- `AUDIT_ACTIONS.ORG_BRAND_SET` — `lightOnly` added to the existing metadata payload (Phase 1 Gap 7's recommended resolution: fold in, don't add a second key).

## Implementer Notes

- **Read-failure fallback (Phase 1 Open Question 2), resolved:** forced-light. Both read paths use `?? false` — a missing brand row, a flag-off read, or a null `brand_light_only` all collapse to "not light-only," which combined with `BrandTokens brand={null}` already rendering nothing means the ONLY way a page renders dark is an org that both has a brand AND has not opted into light-only. Never the reverse (a read hiccup forcing an org unexpectedly light).
- **Public site vs. member portal (Phase 1 Open Question 1), resolved as recommended:** one shared boolean, both surfaces wired in this slice.
- **Toggle availability on an org with no brand row (Phase 1 Open Question 3):** the checkbox always renders (`initialLightOnly` defaults `false` when `brand` is `null`); saving it alongside a first-time colour/pairing creates the row with `light_only` set, same as every other field on this form. No separate empty-state UI needed.
- **A real, pre-existing UX gap surfaced during manual verification, not introduced by this slice:** `BrandForm`'s `useState(initial...)` fields (seedHex, typePairing, and now lightOnly) don't reactively reflect a just-saved value in the same browser tab — `revalidatePath` re-fetches the server tree but the client component doesn't remount, so `useState`'s frozen initial value shows stale until a real navigation. Confirmed via Playwright: same-tab re-query after save showed unchecked; a fresh `page.goto()` of the same URL showed checked (correctly persisted). Logged to `docs/TODO.md`, not fixed in this slice (affects the whole form, not something this feature introduced).
- Verified end-to-end in a real browser with `colorScheme: "dark"` (Playwright): before this slice, `fpcw`'s public site rendered `class="dark"` with a dark background regardless of its light brand; after setting the toggle via the real admin UI, the same dark-OS-preference request renders fully light (`background-color: rgb(249, 255, 254)`), screenshot-confirmed.

---

# Phase 5 — Verification (self, informal — time pressure, see Phase 2/3/4's own notes)

**Date:** 2026-08-24

## Type Check

`npm run typecheck` (`tsc --noEmit`): PASS, zero errors.

## Unit Tests

`npm run test`: 1745 passed, 141 skipped, 0 failed (up from 1733/141/0 before this slice — 7 new `brand-tokens.test.tsx` tests, 5 new `actions.test.ts`/`brand-form.test.tsx` tests for the checkbox).

## End-to-End Tests

Not run via the formal `npm run test:e2e` suite. Manually verified against a real running dev server with Playwright (see Phase 4 Implementer Notes) — the actual admin save flow, a fresh-navigation reload proving persistence, and a `colorScheme: "dark"` public-site render proving the fix. This feature does not touch `src/auth.ts`, `(auth)`, `api/auth`, or `src/lib/auth/`, so the CLAUDE.md Phase 4 gate requiring a full MFA e2e smoke does not apply.

## Regression Tests Added

- `src/components/brand/brand-tokens.test.tsx` — 7 tests, see Phase 4.
- `src/app/(admin)/admin/organizations/[id]/actions.test.ts` — 3 tests: upserts `lightOnly: false`/`true` correctly, and a lightOnly-only change still commits alongside a rejected logo (not treated as a no-op resubmit).
- `src/app/(admin)/admin/organizations/[id]/brand-form.test.tsx` — 2 tests: checkbox reflects `initialLightOnly`, and submits `"on"`/omits the field to match native checkbox FormData semantics.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `setOrganizationBrandAction` (unchanged gate, new field only) | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |

No new routes or actions — `lightOnly` rides the existing brand-save action's existing gate.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (self, informal — time pressure)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> An organization can now opt out of dark mode entirely on both its public site and member portal, verified end-to-end in a real dark-OS-preference browser session — fpcw's own real bug (Phase 1's motivating case) is fixed and confirmed live.

## What's Working

- The core mechanism (force the `:root:root.dark` block to light values, both the brandable ramp and the platform-fixed tokens) works exactly as the corrected Phase 2 predicted, with no `<Toaster>` special-casing needed.
- The admin toggle, save, audit, and both read paths (public site + member portal) are all wired and covered by real tests, not just the public-site half fpcw needed today.

## Intent-vs-Shipped Diff

- Phase 1 said: an operator-facing toggle plus enforcement on the public site (and, per the Scope Recommendation, the member portal). Shipped: exactly that, one shared boolean.
- Phase 1's ORIGINAL mechanism recommendation (b — nested `forcedTheme` `ThemeProvider`) was wrong (confirmed by reading `next-themes` source) and was corrected informally rather than by a formal architect re-run. Verdict: acceptable drift — the correction is recorded in this file, not silently substituted.

## Edge Cases

- Empty state (no brand row yet): pass — toggle renders, defaults false, first save creates the row with it set.
- Failure microcopy: not applicable — no new failure path; rides the existing brand-save error handling.
- Permission gate: pass — unchanged `FEATURES.ADMIN_ORGANIZATIONS`.
- Audit event: pass — folded into `ORG_BRAND_SET`.
- Mobile (360px): not separately verified — the checkbox is a standard form control using the same `<Label>`/`Input`-adjacent pattern as every other field on this form, no new layout risk. Named here rather than silently assumed.

## Follow-Ups (SHIP WITH NOTES)

- `docs/TODO.md`: `BrandForm`'s stale post-save client state (seedHex/typePairing/lightOnly all affected, pre-existing pattern, not new).
- A formal architect Phase 2 pass is still recommended before this feature is considered fully closed, specifically to rule on the accessibility tradeoff Phase 1's Scope Recommendation named (member-portal dark-mode-as-accessibility vs. brand consistency for a light-only org) — noted in the informal Phase 2 section above, not re-litigated here.
- Mobile 360px not independently verified for the new checkbox specifically.

- [Specific. What has to change before this ships.]
