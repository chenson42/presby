# Public staff & leadership directory with headshots — Work Log

> **Slug:** `2026-08-27-public-staff-directory`
> **Surface:** public (`(public)/site/<slug>`) + a small admin opt-in control on the existing Staff/Officers admin pages
> **Permission(s):** existing `staff.manage`/`officers.manage` cover the admin opt-in control; the public read path is anonymous (no permission, enumeration-safe by construction like the rest of P3)
> **Flag(s):** new, TBD by Phase 1/3 — likely `sites.public_staff_directory` or similar, seeded off, matching every other P3 increment's convention
> **Estimated complexity:** medium-large — new schema concept (public-listing opt-in, photo storage wiring), spans Staff, Officers, and Public Sites (P3)
> **Pipeline mode:** Full
> **Source:** operator request, 2026-08-27 — raised while scoping the staff-and-personnel pipeline the same day ("lets explore using staff and council to drive the public websites headshots"), and while away, gave standing authorization to proceed on judgment. The intake questions below (`/new-feature` Step 1) were answered by the orchestrator's own best judgment rather than the operator directly, since real-time intake wasn't possible — **each is flagged as an assumption for Phase 1/the operator to confirm or override, not a settled decision**:
> - *Which people/offices are in scope*: assumed both Staff (`staff_positions`) and Officers (`officer_terms`) are eligible, per-person opt-in (see below), not restricted to specific offices by default — Phase 1 should weigh whether e.g. ordinary session/diaconate members should default-appear or only certain offices (clerk, moderator, pastor).
> - *Opt-in vs default-visible*: assumed **opt-in** (a person or the admin acting for them must affirmatively mark a position/term as publicly listable) rather than default-visible-unless-hidden — this is a public, unauthenticated-visitor-facing surface, categorically different from the existing member-only Directory's "not hidden" privacy model, and getting this backwards is a real privacy exposure, not a UX nicety.
> - *Congregation-only vs also presbytery leadership*: assumed congregation-first (the more common, more clearly-scoped case — "who's on staff at this church"), with presbytery leadership (stated clerk, executive presbyter, etc.) as a plausible but not required v1 extension, since presbytery sites are a newer, less-proven P3 surface (DECISION-121).
> - *Launch relative to the photo-wiring gap*: assumed the text-only listing (name + role/title, no photo) should NOT be blocked on photo wiring — photos are the more compelling version but the underlying "who's on staff" listing has value on its own, and photo wiring (`people.photo_key`, the blob-storage adapter's first person-level consumer) is a large-enough side quest that gating the whole feature on it risks never shipping either. Phase 1 should confirm whether a photo-less v1 is worth shipping or whether the feature's whole value proposition depends on photos.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | design complete | 2026-08-27 |
| 4 — Implementation | database-admin (schema) → api-developer (mutations/public-read + site-kit v3.5.0) → ux-developer (render + admin UI) | Complete — all 4 steps done (step 3, site-kit v3.5.0, was already tagged/pushed to the sibling repo and step 4 confirmed it before consuming it) | — | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The admin-side half of this (an opt-in toggle on an existing `staff_positions`/`officer_terms` row) is a small, well-precedented increment; the public-render half is not — `(public)/site/<slug>` is a static, externally-authored MDX bundle ingested via CI with no existing mechanism for a live database query to reach a rendered page except one narrow, hardcoded precedent (`contactForm`), so "using staff and council to drive the public website" is a real architectural question this request never raised, and Phase 2 has to answer it before Phase 3 can write a component plan.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`staff.manage`, on `admin/staff`) | Toggle "list publicly" on for a specific staff position row | Occasional, per hire |
| Admin (`officers.manage`, on `admin/officers`) | Toggle "list publicly" on for a specific officer term row | Occasional, per election/appointment |
| Admin (either permission) | Toggle "list publicly" off (revoke) | Occasional |
| Admin (either permission) | See, on the existing roster screen, which rows are currently public | On demand, incidental to the roster view already shipped |
| Anonymous visitor | Browse the public staff/leadership page on the org's public site | On demand |

No verb belongs to the staff member or officer themselves — there is no self-service surface today for either register, so consent capture is entirely admin-mediated. Named as a gap below, not assumed away.

## Flows

**Flow 1 — Admin opts a person into the public listing:** entry: `admin/staff` or `admin/officers` roster row → admin clicks "List publicly" → a shadcn `AlertDialog` (never `confirm()`) states plainly that this makes the person's name, role, and (if wired) photo visible to anyone visiting the public site, including search engines, and that this cannot be fully retracted once cached elsewhere → confirm → server action checks `staff.manage`/`officers.manage`, sets `public_listed = true` (+ `public_listed_by`/`public_listed_at`) on that row → outcome: row shows a "Public" badge.
- Failure: permission denied → control isn't rendered for a viewer lacking the permission, and the server action independently 403s regardless of what the client shows (defense in depth, matching the staff-and-personnel pipeline's own posture on `people.manage`). DB error → toast, not a stack trace, row state unchanged.

**Flow 2 — Anonymous visitor views the public listing:** entry: `/site/<slug>` nav → a "Staff"/"Leadership" page, or a direct URL → the page renders a flat, unified roster (name, role/title, photo if present) drawn from every currently-open (`ends_on IS NULL`), currently-`public_listed` row across both `staff_positions` and `officer_terms` for that org.
- Failure: the request never surfaces "this person exists but isn't listed" as a distinguishable state, because there is no per-person route to hit in the first place (see Adversarial Pass) — the only failure mode is the whole section being empty or a live query erroring, and Phase 3 has to decide whether a query error on just this section degrades to "no listing shown right now" (matching `renderSiteBundle`'s per-block fault isolation) or takes down the whole page like `getPublishedSite`'s current all-or-nothing collapse. Undecided; not this pipeline's call to make, but it must be made explicitly, not inherited by accident from whichever precedent the implementer copies first.

**Flow 3 — Admin revokes a listing:** entry: same roster row, toggle off → immediate effect on next render (no cache-invalidation step exists today because nothing in this render path is currently cached beyond `React.cache()`'s per-request memoization — flag for Phase 3 only if the page later gains ISR).
- Failure: same as Flow 1.

**The flow this request didn't actually describe — and the one Phase 2 must resolve before a component plan is possible:** how does an opted-in row *reach* the rendered page at all. Read directly (`src/lib/sites.ts`, `presby-site-kit/src/index.tsx`, `.../src/components/StaffList.tsx`, `(public)/site/[slug]/[[...path]]/page.tsx`):

- `getPublishedSite()` reads one blob (`content_bundle_key`) — a JSON bundle of `{ pages: [{ path, frontMatter, mdxAst }] }` — produced by `recordSiteIngest()`, which is only ever called from `POST /api/sites/ingest`, an OIDC-authenticated GitHub Actions CI endpoint that ingests a **separate, per-tenant git repo** of hand-authored MDX. There is no admin content editor in presby itself.
- `renderSiteBundle()` walks each page's `mdxAst.blocks`, looks each block's `type` up against a **fixed component allowlist** (`presby-site-kit/src/blocks.tsx`), and renders it against `props` that came verbatim from that same static bundle. `presby-site-kit` already ships a `StaffList` component and a `staffList` block type (built for `site-recreator`'s job of reproducing a real site's existing, hand-typed leadership page) — but its `people: StaffPerson[]` prop is populated by whatever a human (or `site-recreator`) typed into that page's front matter. Nothing in this pipeline currently reads `staff_positions` or `officer_terms` at all.
- The **one** precedent for injecting genuinely live, request-time data into an otherwise-static page is `contactForm`: `page.tsx` passes `contactForm: <ContactForm slug={slug} />` into `renderSiteBundle()`, and a `{"type":"contactForm"}` marker block in the content picks up wherever the author placed it. This is a single hardcoded named slot on `RenderSiteBundleInput`, not a generic live-data hook — extending it to staff/officers means either (a) adding a second hardcoded slot (`liveStaffDirectory?: ReactElement` or similar) to that same interface, which is a **version bump to `presby-site-kit`, a separately-versioned package** — squarely an architect-Phase-2 dependency/structural call, not mine to make — or (b) some other mechanism Phase 2 has to design from scratch.
- Absent that decision, "staff and council data drives the public website" collapses to something much thinner than the operator's framing suggests: an admin opts a row in, and then a **human must still separately go edit the site-content repo's MDX** to reflect it — which is not "driving" anything, it's a manual sync a person has to remember to do. If that's genuinely what ships, the feature should be named and scoped as that (an opt-in *permission gate on what may be published*, not an automatic publish), and the operator should confirm that's acceptable before Phase 3 locks a design around it.

## Permissions & Flags

- **Admin-side permission(s):** no new permission. `staff.manage` gates the toggle on `staff_positions` rows; `officers.manage` gates it on `officer_terms` rows — both already exist, both already gate every other mutation on their respective tables. Reusing them here is correct: publicly listing someone is a personnel/register decision about a row that permission already governs, not a new category of access.
- **Default roles:** whatever already holds `staff.manage`/`officers.manage` today (`personnel_admin`, and whichever roles hold `officers.manage` per the groups-and-officers pipeline) — no change.
- **Public-render flag:** new, `sites.public_staff_directory`, seeded off — and it belongs in the `sites.*` namespace (parallel to `sites.public_render`, `ui.brand_theming`), **not** `org_portal.*`. `org_portal.*` gates admin-portal *tile* visibility, an authenticated-admin-facing axis; this flag gates whether the anonymous public render path exists at all, the same axis `sites.public_render` already occupies. The header block's own guess was right; confirming it explicitly since it's an easy place to default to the wrong flag family.
- **Composition:** the flag gates whether the surface renders publicly *at all* (platform-wide rollout control); the permission gates *who inside an org* may flip an individual row's visibility. Neither substitutes for the other — an org with the flag on but zero `public_listed = true` rows gets a working, empty page, and an org with rows flagged on before the platform flag ships gets nothing until the flag flips. This is the correct composition per DECISION-003 and needs no new invariant.

## Gaps the Request Didn't Address

- **The live-data-injection mechanism** (above) — the single biggest gap, load-bearing for whether this is a medium feature or requires a `presby-site-kit` version negotiation first.
- **Field scope of the public listing.** `staff_positions`/`officer_terms` carry no phone/email themselves (those live on `contact_methods`, a more sensitive table with its own tier). Recommend v1 render **name, role/title, department (staff only), and photo only — never contact fields** — this sidesteps the member Directory's whole field-level privacy problem by construction rather than needing to replicate it, and is the direct answer to why `person_privacy`'s tri-state doesn't apply here unchanged (see Adversarial Pass note below). If a future increment wants a public "contact this person" path, that's a new, explicitly-opted-in field, not an inherited one.
- **Consent capture and revocability by the person themselves.** The toggle is entirely admin-mediated; the person listed has no visibility into or control over their own listing, and receives no notification when it changes. Not a blocker (PC(USA) congregational practice already routinely publishes staff/officer names in bulletins and existing websites, which is presumably why the operator asked for this at all) but worth naming as a real absence, not an oversight to silently accept.
- **Photo-caching and un-publish reality.** Once served to an anonymous, unauthenticated audience, a name/photo/role is realistically scraped and cached indefinitely (search engine caches, web archives). Revoking `public_listed` stops presby from serving it going forward but cannot retract existing caches. The admin confirmation dialog (Flow 1) should say this plainly rather than implying "off" means "gone."
- **Empty state.** A brand-new org, or one that hasn't opted anyone in yet, needs a friendly message ("No one has been listed here yet") rather than an empty list or a missing nav entry — and the nav entry should render unconditionally when the flag is on rather than being conditionally hidden on zero rows, for structural consistency's own sake (not an enumeration-safety requirement here, since nothing about this page's existence is meant to be secret).
- **Failure microcopy** for both the admin toggle (DB error → toast, never a stack trace) and the public read (per Flow 2, undecided whose fault-isolation posture it inherits).
- **Whether this warrants `recordAudit()`.** Not one of Rule 7's named categories (role/permission/flag/2FA/deactivation) literally, but functionally closer to a flag toggle than to the staff-and-personnel pipeline's own "personnel administration, not a security control" ruling — flipping this bit exposes PII to the entire internet, which is a materially larger blast radius than any in-tenant mutation Rule 7 was written against. Flagged for Phase 3 as the strongest candidate yet for treating "make PII public" as security-sensitive by the spirit of the rule even though it's not in the letter of it, but the actual ruling is Phase 2/3's to make.
- **2FA gate:** no new consideration — the admin control lives inside `/o/<slug>/admin/*`, already 2FA-enforced at the Edge; the public page is intentionally unauthenticated and must stay that way.
- **Mobile (360px):** lower risk than most features here since `StaffList`'s CSS is already shipped and presumably tested (site-recreator's own real-site parity work exercised it), but if Phase 2/3 lands on a genuinely new live-data component rather than reusing `StaffList` verbatim, that new component needs its own mobile pass — don't assume the existing CSS covers a shape it was never asked to render.

## Out of Scope (confirm with user)

- Per-office org-level defaults (e.g., "clerk and moderator are always public unless overridden") — see ruling below; not needed for v1.
- A per-person deep-link page (`/site/<slug>/staff/<id>`) — deliberately excluded, not merely deferred (see Adversarial Pass).
- Contact fields (phone/email) on the public listing.
- Presbytery-specific "leadership" concepts beyond what `officer_terms`/`staff_positions` already model (e.g., a distinct "committee roster" public page) — the union query covers exactly what those two tables already contain, nothing new.
- Self-service (a staff/officer viewing or controlling their own public-listing status).

## Ruling on the Four Flagged Assumptions

1. **Scope — per-person opt-in, not per-office.** Reject the per-office-default layering. A per-office default ("clerk and moderator always public") adds a second decision axis (does an org-level default win or lose against a person's own override?) for no privacy-safety benefit over a working per-row toggle, and no office should be technically prevented from being listed — a small congregation may reasonably want its whole session pictured. Per-row opt-in on `staff_positions`/`officer_terms` is both sufficient and simpler. Confirmed by design precedent: `staff_positions` and `officer_terms` are deliberately decoupled tables (DECISION-128) whose only prior public-facing union is read-time, never schema-time — an office-tier default table would recouple exactly what that decision kept apart.
2. **Opt-in vs default-visible — opt-in, and it isn't close.** This is an anonymous, unauthenticated, internet-facing surface — categorically different from the member Directory, which is default-visible-unless-hidden *only inside the tenant's own membership boundary*, where mutual-membership norms and an ongoing pastoral relationship make "everyone's listed unless they object" a reasonable default. A public surface has no such boundary or norm; default-visible here means every current employee and officer is opted into internet-wide discoverability the moment this feature ships, with zero chance to object first. Opt-in is correct, and the request's own framing of it as an assumption worth confirming, rather than a settled default, was the right instinct.
3. **Congregation-only vs presbytery — both, from v1.** Read directly: `provisionSite`/`getPublishedSite`/`renderSiteBundle` carry no organization-type restriction, and DECISION-121's fallback applies *only* on the "site never provisioned" branch — a presbytery that HAS provisioned a real site renders through the identical pipeline a congregation does, `StaffList` block included. `staff_positions` and `officer_terms` are both already org-type-neutral (`personnel_admin` is a universal template role; the staff-and-personnel pipeline's own dev fixtures include a presbytery-employed bookkeeper). There is no technical basis to restrict this to congregations — doing so would be an artificial scope cut, not one the architecture forces.
4. **Photo-gating — a photo-less v1 does not deliver on the operator's own stated value, and photo wiring should not be treated as optional.** The feature's own title names "headshots," `presby-site-kit`'s `StaffList` component was visibly built with photos as a first-class case (see its CSS comments on headshot cropping, the reference site it was built against), and the staff-and-personnel pipeline already deferred a photo-less "who to contact" listing once as not worth shipping alone. A name+role-only v1 has *some* value but is not the thing that was asked for, and shipping it under this feature's name risks an immediate "where are the photos" follow-up. Recommend: **sequence, don't skip** — split a narrow prerequisite pipeline for `people.photo_key` wiring (upload UI, `getBlobStore()` call, resolve via the same content-addressed asset-route pattern org logos already use) ahead of this one, since the generic blob adapter is already built and this is a bounded, reusable slice of work (useful beyond just this directory), not a research spike. This directory pipeline should not proceed to Phase 2 assuming photos are a stretch goal.

## Where the "publicly listable" bit lives, and how it composes with F2

A new boolean column on **each** of `staff_positions` and `officer_terms` — `public_listed boolean not null default false`, plus `public_listed_by uuid references users(id)` and `public_listed_at timestamptz`, both nullable — **not** a new join table. Reasoning:

- The flag is a property of a specific *term/position span*, not of the person globally — a row already tracks `starts_on`/`ends_on`; piggybacking the flag on that row means it goes stale for free the moment the term ends (the read query already filters to `ends_on IS NULL`), with no second lifecycle to maintain.
- Both tables already carry the F2-compliant composite FK to `memberships(personId, organizationId)` and their own `unique(id, organizationId)`. A separate join table would need its *own* composite FK back to `(staff_positions.id, organizationId)`/`(officer_terms.id, organizationId)` for a 1:1 relationship — pure surface area for no benefit.
- Two columns, two tables — not a shared cross-cutting table — preserves the decoupling DECISION-128 deliberately established between staff and officers. The public roster is still a **read-time union** of both (`SELECT ... FROM staff_positions WHERE public_listed AND ends_on IS NULL UNION ALL SELECT ... FROM officer_terms WHERE ...`), exactly the same "union, never a schema join" discipline already ruled for the internal "everyone who serves here" view.

## Enumeration-safety of the public listing itself

This is the inverse of F21/F26's usual internal-fishing shape, and mostly doesn't apply the same way — the whole point of an opt-in public listing is that opted-in people ARE meant to be discoverable by anyone. The real risk is a **side channel that distinguishes "not opted in" from "doesn't exist,"** and the cleanest fix is architectural, not access-control: **don't build a per-person route at all.** A flat roster page has no per-ID lookup for a visitor to probe in the first place — "is this named person on staff here?" simply isn't a question the surface can answer either way, by construction, which is a stronger guarantee than carefully matching 404 timings would be. If a future increment wants individual profile pages, it inherits DECISION-040's exact discipline (byte-identical response for "opted out" and "never existed," matching response time) — but v1 should not create that surface to begin with.

## Open Questions

1. Is the sequencing suggestion above (photo-wiring pipeline first, this pipeline second) acceptable, or does the operator want photo wiring folded into this same pipeline's scope?
2. Does the operator accept "an admin opts someone in, then a human must still edit the site-content repo to actually publish it" as the v1 shape, if Phase 2 rules out a `presby-site-kit` version bump as too large for this pass? This changes what "drive the public website" concretely means.
3. Should ending a staff position/officer term while `public_listed = true` also need an explicit admin acknowledgment (since the person drops off the public page automatically), or is silent drop-off on `ends_on` sufficient?
4. Is a `recordAudit()` event wanted for this toggle, given it doesn't fit Rule 7's named categories literally but arguably fits its spirit? Needs an explicit ruling, not silence.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions** — the feature shape is sound and proceeds to Phase 3, but Phase 3's design doc must incorporate three things beyond Phase 1's own analysis: (1) the live-injection mechanism is a new generic slot map, not a second hardcoded prop, and requires a minor `presby-site-kit` version bump; (2) the public roster read needs its own narrow `SECURITY DEFINER` SQL function — Phase 1's "read-time union" framing understated this; (3) `recordAudit()` is required, not optional.

## Ruling on the six Phase-1 questions

1. **Live-data-injection mechanism.** `contactForm?: ReactElement` (the one existing precedent) is a single hardcoded field on `RenderSiteBundleInput`. A second hardcoded field would work, but this would be the second one-off of an explicitly pattern-shaped operator ask ("using staff and council to drive public websites" generalizes to sermon feeds, event feeds, giving thermometers, etc.) — the point where "rule of three" stops applying. **Ruling: add a generic `liveSlots?: Record<string, ReactElement>` field to `RenderSiteBundleInput`, plus one generic `{"type": "liveSlot", props: {"slot": "<name>"}}` block type / `renderLiveSlotBlock`, in `presby-site-kit`.** `contactForm` is NOT retrofitted onto this in the same pass (it owns bespoke chrome a bare slot injector doesn't replicate) — two shapes coexisting is fine, a third bespoke one-off would not be. This is a **minor** version bump (`v3.4.0 → v3.5.0`, additive-only). Evaluated against CLAUDE.md's dependency criteria: not solved elsewhere in the stack; actively maintained (peer-dep matches); Edge-irrelevant (renders in a normal RSC route); negligible bundle impact; MIT, unchanged. **Operational note for whoever cuts the tag**: `git log v3.4.0..HEAD` on the sibling checkout shows 26 unreleased commits (all `site-recreator` visual-parity fixes, none touching this feature) that will ride along — worth a skim first, not a blocker.
2. **Does the "human must edit the MDX" step disappear?** No, and Phase 3 must word the feature accordingly. `liveSlots` solves *how live data reaches an already-rendered page*, not *how the marker block gets onto that page* — a human still places `{"type":"liveSlot","props":{"slot":"staffDirectory"}}` into the org's MDX at least once, in the separate, CI-ingested content repo. What it eliminates is the ONGOING per-person manual step: once the marker exists, every subsequent opt-in/opt-out is picked up automatically on next render, same "author once, then it just works" property `contactForm` already has. Scope this as *"a live-fed roster wherever a content author has placed the block,"* not *"a self-provisioning page with no site-content-repo involvement"* — the latter is a materially bigger, out-of-scope feature.
3. **Schema placement — confirmed, no pushback**, verified directly against both table definitions (both already carry `unique(id, organizationId)` + composite FK to `memberships`, both already have precedent for a direct `users` FK via `recordedBy`). Two columns per table (`public_listed`, `public_listed_by`, `public_listed_at`), no join table. **What Phase 1 under-specified**: the "read-time union" is an ANONYMOUS, unauthenticated read with no `personId` for `withOrgContext()` — both tables are FORCE-RLS and `presby_app` is NOBYPASSRLS, so this requires its own narrow `SECURITY DEFINER` SQL function (hand-written migration, mirroring `presby_published_site()` exactly), never a general-purpose view, never `getPlatformDb()` (categorically forbidden on this public path per `sites.ts`'s own header). This is a real Data Model addition for Phase 3, not a restatement.
4. **Field scope and enumeration safety — both confirmed.** Field scope now has a stronger enforcement point than "the app layer remembers": the `SECURITY DEFINER` function's own fixed column projection (name/role/title/department/photo_key only, `contact_methods` never joined) is the actual boundary — widening it later requires touching the function itself, appropriate friction. No-per-person-route is the strongest single decision in Phase 1 and must not be walked back without a return trip through this pipeline.
5. **Directory placement**: extend `src/lib/db/domain/staff.ts`/`officers.ts` in place (no new schema file); new admin-mutation functions in the existing `src/lib/staff.ts`/`officers.ts` (`staff.manage`/`officers.manage`-gated, `recordAudit()` wired in); the public read belongs in `src/lib/sites.ts` as the next "COMMIT N ADDITION" (that file already owns the anonymous/SECURITY-DEFINER/collapse-every-miss-identically discipline — a new file would just re-derive it and risk drift). No `'use client'` needed anywhere in this feature's own new code — the roster read and render are both server-only; don't let Phase 4 reach for client-side out of habit copying `ContactForm`'s shape (which is client-side for form-submission interactivity this feature has none of).
6. **The two deferred questions, ruled, not deferred again:**
   - **(a) Term-end acknowledgment**: silent drop-off is fine for v1. The render already filters `ends_on IS NULL` for free; an acknowledgment step would special-case the ordinary act of ending a term for the minority of rows that happen to be public-listed, and protects against nothing the opt-in dialog didn't already disclose.
   - **(b) `recordAudit()`**: **required.** DECISION-129's "access-change nexus" test (why `officer_terms` mutations ARE audited, `staff_positions` are NOT) reasons about *access*, and this mutation isn't an access fact — it's a *disclosure* fact, so that test doesn't transfer. But Rule 7 separately names flag toggles as security-sensitive specifically because they change what's externally reachable, and `public_listed` is exactly that shape: a bit whose flip exposes PII to the entire unauthenticated internet. New purpose-built `AUDIT_ACTIONS` keys, called from `staff.ts`/`officers.ts`'s own mutation functions (matching those files' existing audit-call-site pattern, not the actions.ts-does-audit split DECISION-130 used for an unrelated reason).

## Placement

- **Schema**: `src/lib/db/domain/staff.ts` (add `publicListed`/`publicListedBy`/`publicListedAt` to `staffPositions`), `src/lib/db/domain/officers.ts` (same three columns on `officerTerms`) — in place, no new files.
- **Admin mutations**: new exported functions in `src/lib/staff.ts`/`src/lib/officers.ts` (e.g. `setStaffPositionPublicListed`, `setOfficerTermPublicListed`), called from each surface's existing `actions.ts`.
- **Public read**: `src/lib/sites.ts`, a new `getPublicStaffRoster(slug)`-shaped function, `server-only`, no `getPlatformDb()`, reads through the new `SECURITY DEFINER` function.
- **Migration**: `drizzle/00XX_presby_*.sql` — the column additions on both tables, plus the new `SECURITY DEFINER` function (`presby_public_staff_roster(slug)` or equivalent), FORCE-RLS interaction confirmed safe by the same reasoning `presby_published_site()`'s migration already documents.
- **`presby-site-kit`** (separate repo/release): `liveSlots?: Record<string, ReactElement>` field, `liveSlot` block type, `renderLiveSlotBlock`. Version bump `v3.4.0 → v3.5.0` (minor), `package.json`'s pinned tag updated.
- **Render component**: a small server component (e.g. `PublicStaffDirectory`) co-located with the `(public)/site/[slug]/` route tree, matching `ContactForm`'s own placement pattern — presby-specific data shape, not a reusable site-kit primitive.
- **Server vs Client split**: no client components needed anywhere in this feature's own new code.
- **Dependencies**: one minor version bump of an already-approved git dependency; no new package.

## Invariants Touched

- **Isolation Is a Database Property / SECURITY DEFINER (F26)**: the public roster read is exactly this invariant's shape — anonymous, no org GUC, needs a narrow purpose-built function, never a wider grant, never `getPlatformDb()`. Not optional plumbing; Phase 3 must design the function explicitly.
- **Composite Tenant Keys (F2)**: respected — no new cross-table reference; the function's own `UNION ALL` stays within one resolved org's rows, matching `presby_published_site()`'s pattern.
- **Permissions vs Flags (DECISION-003)**: correctly split per Phase 1 (permission = who may flip the bit; flag = whether the surface exists at all) — confirmed, no changes needed.
- **No Real Data**: the migration/fixtures must use only synthetic names — a Phase 4 concern, not a design-time one.
- **Brand scope (DECISION-047)**: no violation — renders inside `(public)/site/<slug>`, an already-brandable route group.

## Notes

- The `presby-site-kit` version bump is its own small, sequenced sub-task (cut `v3.5.0`, update `package.json`'s pinned tag) that must happen BEFORE the `(public)/site/[slug]` page code can use `liveSlots` — name this explicitly in Phase 3's Implementation Order, don't fold it silently into "UI."
- The photo-wiring sequencing question (Phase 1's Open Question 1) is a scoping/sequencing call for the operator/tech-lead, not an architectural one — this review takes no position beyond confirming the `SECURITY DEFINER` function's projection already includes a `photo_key`-shaped column regardless of ordering, and a null photo degrades the same way `StaffList`'s existing `photoUrl?` already does.
- Do not let Phase 3 quietly widen the `SECURITY DEFINER` function's column list "while we're in there" — any future field needs its own pass through this pipeline.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

An admin holding `staff.manage`/`officers.manage` can opt a specific, currently-open `staff_positions`/`officer_terms` row into a public "who serves here" listing; an anonymous visitor to an org's already-published `(public)/site/<slug>` sees that listing (name, role/title, department, photo if present — never contact fields) wherever a human content author has placed a `{"type":"liveSlot","props":{"slot":"staffDirectory"}}` marker in that org's MDX. This ships in four sequenced, cross-repo steps: a schema + `SECURITY DEFINER` SQL-function commit, an admin-mutation + public-read commit, a `presby-site-kit` minor version cut that adds the generic `liveSlots` injection mechanism Phase 2 ruled for, and a render-component commit that consumes it. It does not build a per-person route (permanently, per Phase 1's enumeration-safety ruling) and does not wire photo upload (v1 renders gracefully with no photo, exactly like `StaffList`'s existing `photoUrl?` degradation — see Edge Cases).

## Permissions & Flags

- Permission key(s): none new. `staff.manage` gates `setStaffPositionPublicListed()`; `officers.manage` gates `setOfficerTermPublicListed()` — both existing tenant permissions, already the sole gate on every other mutation to their respective tables. No change to `src/lib/permissions.ts` (platform-shell only, frozen) and no new row in the tenant `permissions` catalog.
- Default role bindings: unchanged — whatever already holds `staff.manage` (`personnel_admin`) and `officers.manage` today keeps it; this feature adds no new capability to any role, just a new field those existing capabilities can write.
- Feature flag(s): new `sites.public_staff_directory`, seeded **off**, in the `sites.*` namespace (parallel to `sites.public_render`), checked bare in `getPublicStaffRoster()` with no DECISION-026 fail-open wrapper — not an auth path, and fail-closed-to-empty-roster during a DB blip or an operator rollback is correct, matching `sites.public_render`'s own checked-bare posture. Composition: this flag gates whether the public read/render exists **at all**; `staff.manage`/`officers.manage` gate **who inside an org** may flip an individual row's bit. Neither substitutes for the other (DECISION-003) — an org with rows opted in before this flag ships gets an empty roster, not a leak, until the flag flips; a live flag with zero opted-in rows renders the directory's own empty state, not a missing feature.

## API Contract

**Admin mutations** (new exports, existing files — same `withOrgContext()`-first, typed-result shape every other function in each file already uses):

```ts
// src/lib/staff.ts
export async function setStaffPositionPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { positionId: string; publicListed: boolean },
): Promise<StaffResult<{ positionId: string; publicListed: boolean }>>
```

```ts
// src/lib/officers.ts
export async function setOfficerTermPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { termId: string; publicListed: boolean },
): Promise<OfficersResult<{ termId: string; publicListed: boolean }>>
```

Order of operations for both, mirroring `startStaffPosition()`/`startOfficerTerm()` exactly:
1. `hasStaffManage`/`hasOfficersManage` gate — `forbidden` if the caller doesn't hold the permission at all.
2. Row lookup scoped to `(id, organizationId)` — `invalid_target` if missing or belongs to another org (F2 shape, matching `endStaffPosition`/`endOfficerTerm`'s own lookup).
3. Update `publicListed`, `publicListedBy = actingUserId`, `publicListedAt = now()` **on every call, in both directions** — turning the bit off is itself an attributable, timestamped act (see Edge Cases for why this departs from `recordedBy`'s "set once at creation" precedent). No date/shape validation needed; the only input besides the id is a boolean.
4. `recordAudit()` — new keys below, called from inside these library functions (not from `actions.ts`), matching this pair of files' own audit-call-site convention when they do audit (none currently do; this is the first audited mutation in either file, so the convention is inherited from `role-grants.ts`/`org-brand`-style lib-does-audit call sites, not invented fresh).

New `AUDIT_ACTIONS` keys (`src/lib/audit.ts`), one pair per table, matching `ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED`'s on/off-pair shape rather than a single `_CHANGED` key — the direction is the fact worth searching audit history for:

```ts
STAFF_POSITION_LISTED_PUBLICLY: "staff_position.listed_publicly",
STAFF_POSITION_UNLISTED_PUBLICLY: "staff_position.unlisted_publicly",
OFFICER_TERM_LISTED_PUBLICLY: "officer_term.listed_publicly",
OFFICER_TERM_UNLISTED_PUBLICLY: "officer_term.unlisted_publicly",
```

Existing roster reads widen in place (additive fields, no new function): `StaffPositionEntry`/`OfficerRosterEntry` each gain `publicListed: boolean` so `admin/staff` and `admin/officers`' existing roster tables can render the "Public" badge (Flow 1's own requirement) without a second query.

**Public read** (new, `src/lib/sites.ts`, the sixth caller shape in that file's header comment — anonymous, no membership, `server-only`, never `getPlatformDb()`):

```ts
export interface PublicStaffRosterEntry {
  displayName: string;
  roleLabel: string;
  department: string | null;
  /** blob_assets.id for this org, or null. Caller builds the URL — this
   * function returns no route-path string, matching imageUrl's own
   * closure-based resolution in page.tsx. */
  photoKey: string | null;
}

export async function getPublicStaffRoster(
  slug: string,
): Promise<PublicStaffRosterEntry[]>
```

Body: `if (!(await isFlagEnabled("sites.public_staff_directory"))) return [];` then one `db.execute(sql`select * from presby_public_staff_roster(${slug})`)`, mapped row-by-row. Officer `role_raw` values map through `OFFICE_LABELS` (imported from `@/lib/officers`) to their display label; staff `role_raw` is already a display string (`staff_positions.position`) and passes through unchanged. Label mapping stays in TypeScript, not duplicated as a `CASE` inside the SQL function, so `OFFICE_LABELS` has exactly one source of truth (adding a seventh office would otherwise require editing both a TS map and a SQL function to stay in sync). No enumeration-safety collapse needed here beyond the flag check — this function has no per-person miss case to protect (Phase 1's "no per-person route" ruling is what makes that true), so unlike `getPublishedSite()` there is no `not_found`/`ok` split: an empty array **is** the correct response for "flag off," "site not live," and "nobody opted in," collapsed identically, which is the same shape, just returned as `[]` instead of a tagged result.

**SQL function** (`presby_public_staff_roster(text)`, hand-written migration, mirrors `presby_published_site()`'s `SECURITY DEFINER`/grant/comment shape exactly):

```sql
create or replace function presby_public_staff_roster(p_slug text)
returns table (
  kind         text,   -- 'staff' | 'officer' — lets the TS caller pick the label map
  role_raw     text,   -- staff_positions.position, or officer_terms.office
  department   text,   -- staff only; null for officer rows
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select 'staff' as kind, sp.position as role_raw, sp.department,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from staff_positions sp
    join organizations o on o.id = sp.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = sp.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and sp.public_listed
     and sp.ends_on is null
  union all
  select 'officer' as kind, ot.office as role_raw, null as department,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from officer_terms ot
    join organizations o on o.id = ot.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = ot.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and ot.public_listed
     and ot.ends_on is null
   order by 4;
$$;

revoke all on function presby_public_staff_roster(text) from public;
grant execute on function presby_public_staff_roster(text) to presby_app;
```

`order by 4` (`display_name`) produces one flat, alphabetized roster across both tables — Flow 2's "flat, unified roster," not staff-then-officers grouping. The `organizations.status = 'active' and organization_sites.status = 'live'` gate is duplicated from `presby_published_site()` deliberately: this function must be independently safe if ever called from anywhere other than the one page that already established site-liveness, the same defense-in-depth `presby_officer_roster()`/`presby_officer_history()` don't need (they run inside `withOrgContext()`, already membership-gated) but this one does, since it runs anonymously.

**presby-site-kit additions** (separate repo, minor version — see Implementation Order step 3):

```ts
// src/index.tsx — RenderSiteBundleInput
liveSlots?: Record<string, ReactElement>;
```

`BlockRenderContext` gains `liveSlots?: Record<string, ReactElement>`, threaded from `renderSiteBundle()` the same way `contactForm` already is. `src/blocks.tsx` gains:

```ts
function renderLiveSlotBlock(
  props: unknown,
  ctx: BlockRenderContext,
): ReactElement | null {
  if (!isRecord(props) || typeof props.slot !== "string") return null;
  return ctx.liveSlots?.[props.slot] ?? null;
}
```
registered in `BLOCK_REGISTRY` as `liveSlot: renderLiveSlotBlock`. `contactForm` is NOT retrofitted onto this shape in the same pass (Phase 2's own ruling — it owns bespoke heading/intro/aside chrome a bare slot injector doesn't replicate).

## Data Model

Two tables, three columns each — no join table (per Phase 1/2's fixed ruling). Both `staff.ts`/`officers.ts` need a `boolean` import added to their `drizzle-orm/pg-core` import list (neither currently imports it).

```ts
// src/lib/db/domain/staff.ts — staffPositions, added alongside minuteReference
publicListed: boolean("public_listed").notNull().default(false),
publicListedBy: uuid("public_listed_by").references(() => users.id),
publicListedAt: timestamp("public_listed_at", { withTimezone: true }),
```

```ts
// src/lib/db/domain/officers.ts — officerTerms, added alongside minuteReference
publicListed: boolean("public_listed").notNull().default(false),
publicListedBy: uuid("public_listed_by").references(() => users.id),
publicListedAt: timestamp("public_listed_at", { withTimezone: true }),
```

**Migration** `drizzle/0041_presby_public_staff_directory.sql` (hand-written — every migration past 0012 is, per CLAUDE.md's `db:generate` snapshot-collision note):

```sql
alter table staff_positions
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz;

alter table officer_terms
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz;

-- Backs presby_public_staff_roster()'s per-table WHERE clauses.
create index if not exists staff_positions_public_listed_idx
  on staff_positions (organization_id)
  where public_listed and ends_on is null;

create index if not exists officer_terms_public_listed_idx
  on officer_terms (organization_id)
  where public_listed and ends_on is null;

-- presby_public_staff_roster(text) — see API Contract for the full body.
```

No new RLS policy: both tables already carry `FORCE ROW LEVEL SECURITY` + `tenant_isolation` from their own original migrations (0009's loop covers `officer_terms`; 0039 covers `staff_positions`) — three new columns on an already-force-RLS'd table need nothing further, and the new function bypasses RLS by virtue of `SECURITY DEFINER`, the identical mechanism `presby_published_site()` already uses against these same two FORCE-RLS tables' siblings. No new grant: `presby_app` already holds full CRUD on both tables (established when each table shipped); a new column is covered by the existing table-level grant.

## Component / Page Plan

- **Pages to create:** none — the surface is a slot inside the existing `(public)/site/[slug]/[[...path]]/page.tsx` render, not a new route.
- **Components to create:** `src/app/(public)/site/[slug]/staff-directory.tsx` — `PublicStaffDirectory({ slug }: { slug: string })`, an `async` server component (no `"use client"`), co-located exactly like `contact-form.tsx` is today. Calls `getPublicStaffRoster(slug)`, maps each `PublicStaffRosterEntry` to site-kit's `StaffPerson` shape (`{ name: displayName, title: roleLabel, photoUrl: photoKey ? `/site/${slug}/assets/${photoKey}` : undefined }` — `phone`/`email` are never set, enforcing the field-scope ruling at the mapping layer, not just at the SQL projection layer), and renders `<StaffList people={...} headingClassName={...} />` **imported directly from `presby-site-kit`** (not through the block-registry's `staffList` block type — that type's props come from hand-authored front matter, a different shape and a different trust tier). Empty roster gets its own explicit branch: `if (entries.length === 0) return <p>No one has been listed here yet.</p>;` rather than delegating to `StaffList`, which itself returns `null` on an empty array (Phase 1 Gap "Empty state" — a silent gap here would be indistinguishable from a broken slot).
- **Files to modify:**
  - `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — add `liveSlots: { staffDirectory: <PublicStaffDirectory slug={slug} /> }` to the existing `renderSiteBundle({...})` call, alongside `contactForm`.
  - `src/lib/db/domain/staff.ts`, `src/lib/db/domain/officers.ts` — the three columns each, per Data Model.
  - `src/lib/staff.ts`, `src/lib/officers.ts` — the new mutation function each, and the `publicListed` field added to `StaffPositionEntry`/`OfficerRosterEntry`.
  - `src/lib/sites.ts` — `getPublicStaffRoster()` + `PublicStaffRosterEntry`, documented as a new "COMMIT N ADDITION" per that file's own header convention.
  - `src/lib/audit.ts` — the four new `AUDIT_ACTIONS` keys.
  - `src/app/(org)/o/[slug]/admin/staff/actions.ts`, `.../admin/officers/actions.ts` — new server actions wrapping the two mutation functions.
  - The existing `admin/staff` and `admin/officers` roster page components — a "List publicly" control per row (shadcn `Switch` or `Button`, never a native control) behind a shadcn `AlertDialog` (never `confirm()`) stating plainly what Flow 1 requires (name/role/photo become visible to anyone, including search engines, and cannot be fully retracted once cached elsewhere), plus a "Public" badge on rows where `publicListed` is true.
  - `scripts/seed.ts` — new `sites.public_staff_directory` flag row, seeded `false`, `sites.*` namespace, same comment style as `sites.public_render`'s own entry.
  - `presby-site-kit/src/index.tsx`, `presby-site-kit/src/blocks.tsx`, `presby-site-kit/package.json` (version bump) — the `liveSlots` mechanism, in the sibling repo.
  - `presby/package.json` — bump the pinned tag: `"presby-site-kit": "github:chenson42/presby-site-kit#v3.5.0"`.
- **Server vs client split:** no client components in this feature's own new code. `PublicStaffDirectory` is a plain async server component; the admin-side toggle control is the only client-interactive piece, and it lives in the existing `admin/staff`/`admin/officers` client components (already client, for the existing roster UI), not a new file.

## Implementation Order

Cross-repo; the site-kit version cut is its own named, sequenced step — **not** folded into "UI" — per Phase 2's explicit instruction. Steps 1–2 land in `presby` and can ship (merged, deployed, flag off) independently of steps 3–4; steps 3–4 cannot start before step 3's tag exists.

1. **Schema + SQL function** (`database-admin`, in `presby`): the three columns on both tables, the two partial indexes, `presby_public_staff_roster(text)` — `drizzle/0041_presby_public_staff_directory.sql`. Apply via `npm run db:push` on a Neon branch first, confirm `scripts/test-rls.sql` still passes (FORCE RLS on both tables unaffected by new columns), then commit the hand-written migration.
2. **Admin mutations + public read** (`api-developer`, in `presby`): `setStaffPositionPublicListed`/`setOfficerTermPublicListed`, the four `AUDIT_ACTIONS` keys, the two new server actions in `admin/staff/actions.ts`/`admin/officers/actions.ts`, `getPublicStaffRoster()` in `src/lib/sites.ts`, the `sites.public_staff_directory` flag row in `scripts/seed.ts`. Depends on step 1's columns/function existing. Ships and can be exercised (roster reads return real data) before the public render surface exists at all.
3. **`presby-site-kit` v3.5.0** (`api-developer`, in the sibling `presby-site-kit` repo — **its own commit, its own tag, sequenced here explicitly per Phase 2's instruction**): `liveSlots` field on `RenderSiteBundleInput`, `liveSlot` block type / `renderLiveSlotBlock`, `BLOCK_REGISTRY` entry. Skim the 26 unreleased `site-recreator` commits already sitting on `HEAD` before cutting the tag (Phase 2's operational note) — none touch this feature, but confirm before including them in the same release. Bump `package.json` to `3.5.0`, tag `v3.5.0`, push. Then in `presby`: bump the pinned dependency tag and run `npm install` to pick it up. **Nothing in step 4 can be written against a real `liveSlots` type until this step's tag exists on the sibling remote.**
4. **Render component + wiring** (`ux-developer`, in `presby`): `staff-directory.tsx` (`PublicStaffDirectory`), the `liveSlots` addition to `page.tsx`'s `renderSiteBundle()` call, the admin-side "List publicly" `Switch`/`AlertDialog`/"Public" badge on the `admin/staff` and `admin/officers` roster pages. Depends on step 3's package version being installed and step 2's mutation functions/actions existing.
5. Release notes entry (tech-lead, at Phase 6 SHIP IT) + `docs/product/functionality-map.md` update + `docs/TODO.md` reconciliation, per Rules 10/13/14 — not a separate implementer step, folded into the `/release-notes` skill's usual housekeeping cluster.

## Edge Cases & Risks

- **Photo wiring — resolved plainly: v1 ships with no photo upload.** `people.photoKey`/`photoUpdatedAt` exist as columns and the generic blob adapter (`src/lib/storage/`) is built, but no caller has ever written a photo through it. This design does **not** add an admin upload UI for `people.photoKey` in Phase 4. `PublicStaffDirectory` renders every entry with `photoKey: null` today, which `StaffList`'s existing `photoUrl?` conditional already degrades gracefully (no `<img>`, just name/title/department) — zero new code needed for that path. Rationale for deferring rather than folding in: (a) this pipeline already spans two repos, a new `SECURITY DEFINER` function, and three sequenced implementer handoffs — adding upload UI, image-orientation/crop handling, and a new `people.photo_key` mutation surface would meaningfully grow Phase 4's blast radius and blur this design's review boundary; (b) unlike the staff-and-personnel pipeline's own photo-less "who to contact" case (which Phase 1 correctly judged as having near-zero value without contact info), a name+role+department listing has real, complete value on its own — "who's on staff/session here" is a legitimate answer even with no faces; (c) nothing about this decision requires rework later — the SQL function already projects `photo_key`, the serving mechanism is free (the existing `(public)/site/[slug]/assets/[key]/route.ts` already resolves *any* blob key for a live org by `organizationId`, so a future `people.photo_key` value needs no new asset route, just a value in the column). **Photo upload is a named, deliberate follow-up** — track it in `docs/TODO.md` at ship time as its own future scoped pipeline (a reusable `people.photo_key` upload slice, useful beyond this feature), not a silent gap.
- **Revoking a listing does not retract existing caches.** The admin `AlertDialog` (Flow 1) must say this plainly — "off" stops future serving, not retroactive removal from search-engine caches or archives. Copy is a `ux-developer` deliverable in step 4, not optional microcopy.
- **Silent drop-off on term-end.** Per Phase 2's ruling, no acknowledgment step — the SQL function's own `ends_on is null` filter removes a row from the roster the moment a term/position ends, with zero additional write. Confirmed by direct read: no trigger needed, no second code path to keep in sync.
- **Nav visibility is entirely the content author's call**, not this codebase's. Whether `staffDirectory` is even referenced, and whether the page it's on has a `navLabel`, lives in the separate, CI-ingested site-content repo. This pipeline cannot make the nav "render unconditionally when the flag is on" (Phase 1 Gap) — that gap is a documentation/site-content-authoring concern, not a code gap, and should be named as such in the release notes rather than treated as unresolved by Phase 4.
- **`check:audit` tripwire coverage.** The two new mutations are called from `admin/staff/actions.ts`/`admin/officers/actions.ts` (real `actions.ts` files, unlike the exempt `startStaffPosition`/`endStaffPosition` writes) and DO call `recordAudit()` — inside `src/lib/staff.ts`/`officers.ts`, not inside the action itself. Confirm at Phase 5 whether `npm run check:audit`'s regex actually sees a `recordAudit()` call that lives one layer down from the action (the existing `officers.ts`/`role-grants.ts` precedent for lib-does-audit already established this is fine, but this is the *first* audited call in either of these two specific files — worth an explicit QA check, not an assumption).
- **e2e blast radius — existing specs this change can alter, not just new ones needed** (per the design-doc requirement following the 2026-07-11 retro): any existing Playwright spec that asserts on the **current, unmodified** `admin/staff`/`admin/officers` roster row markup (row structure, button counts, badge absence) will need a look — adding a "List publicly" control + badge to each row changes DOM shape those specs may snapshot or query against. Also check any spec asserting on `(public)/site/[slug]`'s current rendered block count/structure for an org with a `staffDirectory` liveSlot marker already present in its fixture MDX (unlikely today, since no such marker exists yet in any fixture content repo, but confirm rather than assume). No existing spec should assert on `presby-site-kit`'s `BLOCK_REGISTRY` contents directly; if one does, it needs to tolerate a new `liveSlot` key.
- **`admin/staff`/`admin/officers` roster query cost.** `StaffPositionEntry`/`OfficerRosterEntry` widening by one boolean field is free (already-selected row); no N+1 risk introduced.

## Implementer

Four implementers across two repos, in the sequence above: **database-admin** (step 1, schema + SQL function), **api-developer** (steps 2 and 3 — admin mutations/public read in `presby`, then the `presby-site-kit` version cut in the sibling repo), **ux-developer** (step 4, render component + admin-toggle UI + wiring). No single function is small/coupled enough to justify `full-stack-developer` here — the cross-repo dependency chain is the reason for the split, not file count.

---

# Phase 4 — Implementation

**Status: complete.** All 4 steps of the Implementation Order are done: step
1 (schema + SQL function, database-admin), step 2 (admin mutations + public
read, api-developer), step 3 (`presby-site-kit` v3.5.0, api-developer,
sibling repo), and step 4 (render component + admin-toggle UI, ux-developer,
below). Do not read the "Status: partial" language on step 1's own section
above as still current — it described this work-log's state after step 1
alone; all four steps are now recorded.

## Phase 4 — Step 1 (database-admin)

### Files Created

- `drizzle/0041_presby_public_staff_directory.sql` — hand-authored migration
  (per CLAUDE.md/`docs/TODO.md`: `npm run db:generate` is broken repo-wide on
  the `drizzle/meta/0008-0012` snapshot collision, so every migration past
  0012 is hand-authored and manually registered in `_journal.json`, matching
  the house style set by 0013-0040). Contents, copied faithfully from this
  work-log's own Phase 3 "Data Model"/"API Contract" SQL — no defect found,
  nothing adjusted except adding a `comment on function ...` line, matching
  the documentation convention every other `SECURITY DEFINER` function in
  this schema carries (e.g. `presby_published_site()`,
  `drizzle/0024_presby_published_site_light_only.sql`) but which this
  work-log's own SQL excerpt omitted:
  - `alter table staff_positions add column if not exists public_listed / public_listed_by / public_listed_at`
  - `alter table officer_terms add column if not exists public_listed / public_listed_by / public_listed_at`
  - `staff_positions_public_listed_idx`, `officer_terms_public_listed_idx` — partial indexes on `(organization_id) where public_listed and ends_on is null`
  - `presby_public_staff_roster(text)` — `SECURITY DEFINER`, `stable`, `set search_path = public`; unions `staff_positions`/`officer_terms` filtered to `public_listed`, `ends_on is null`, and the calling org's `organizations.status = 'active'`/`organization_sites.status = 'live'`; `revoke all ... from public` + `grant execute ... to presby_app`

### Files Modified

- `src/lib/db/domain/staff.ts` — added `boolean` to the `drizzle-orm/pg-core` import list (not previously imported); added `publicListed: boolean("public_listed").notNull().default(false)`, `publicListedBy: uuid("public_listed_by").references(() => users.id)`, `publicListedAt: timestamp("public_listed_at", { withTimezone: true })` to `staffPositions`, alongside `minuteReference` per the design.
- `src/lib/db/domain/officers.ts` — same three columns (same names/types) added to `officerTerms`, plus the same `boolean` import addition.
- `drizzle/meta/_journal.json` — registered `idx: 41`, `tag: "0041_presby_public_staff_directory"` by hand (the established convention for this repo's hand-authored migrations past 0012).

### Schema Changes

- `staff_positions`: +`public_listed boolean not null default false`, +`public_listed_by uuid references users(id)`, +`public_listed_at timestamptz`.
- `officer_terms`: same three columns.
- New partial indexes: `staff_positions_public_listed_idx`, `officer_terms_public_listed_idx`.
- New function: `presby_public_staff_roster(text)` — `SECURITY DEFINER`, anonymous read.
- No new RLS policy (both tables already carry `FORCE ROW LEVEL SECURITY` + `tenant_isolation` from their original migrations — 0009 for `officer_terms`, 0039 for `staff_positions`). No new grant on the tables themselves (existing table-level grants already cover new columns); the function gets its own `revoke`/`grant execute`.
- **Applied via:** hand-written SQL migration, applied directly against the shared Neon dev database (this repo's documented mechanism — `db:push`/`db:generate`/`db:migrate` are all either lossy-only or broken here, per `docs/testing.md` and every migration since 0013). **Not `npm run db:push`** — matching the convention every other hand-written migration this same day used (0038/0039/0040), not the Phase 3 doc's own line suggesting a Neon branch + `db:push` first. Ran as:
  ```
  psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0041_presby_public_staff_directory.sql
  ```
  Applied clean: `ALTER TABLE` ×2, `CREATE INDEX` ×2, `CREATE FUNCTION`, `COMMENT`, `REVOKE`, `GRANT` — all succeeded, no errors.
- **Migration numbering check:** `ls drizzle/*.sql` (immediately before writing and again immediately before applying) showed `0040_presby_org_feature_categories.sql` as the highest number on disk, no gap, no second pipeline's `0041` file present. Checked `docs/TODO.md`'s In Flight section for a concurrent schema pipeline claiming 0041 — none found (only the already-resolved 0039/0040 near-collision note from the same day, and this work-log's own Phase 3 guidance already named `0041`). Claimed `0041`, matching what Phase 3 named.

### Audit Events

- None in this step — the audited mutations (`STAFF_POSITION_LISTED_PUBLICLY`/`UNLISTED_PUBLICLY`, `OFFICER_TERM_LISTED_PUBLICLY`/`UNLISTED_PUBLICLY`) are added to `src/lib/audit.ts` and called from `src/lib/staff.ts`/`src/lib/officers.ts` in step 2 (api-developer), per the design's own Placement section. Nothing in this schema-only step calls `recordAudit()`.

### Verification performed

1. **`db:push`/direct-apply — applied cleanly.** See "Applied via" above; no errors, idempotent (`if not exists` throughout, `create or replace function`).
2. **FORCE ROW LEVEL SECURITY unaffected.** Direct `pg_class` query confirms `relrowsecurity = t`, `relforcerowsecurity = t` on both `staff_positions` and `officer_terms` after the `ALTER TABLE`.
3. **`scripts/test-rls.sql` full run — hit an unrelated, pre-existing failure, not caused by this migration.** The full suite aborts early (line 114, `alder: sees own memberships — expected 9, got 10`) on `memberships`, a table this migration never touches. Traced the extra row: a membership for a person named "Testy Verifyington," `created_at = 2026-08-27 21:21:28` (i.e., created live during this session, not part of `scripts/seed-dev.sql`'s fixture) — leaked test data from a concurrent pipeline's DB-backed test run in the same shared dev database, the identical class of problem `docs/TODO.md`'s In Flight/Next Up sections already log happening repeatedly today (orphaned fixture orgs/rows from concurrent pipelines). Not cleaned up here — it isn't this step's data to delete, and cleaning shared-DB pollution from an unrelated pipeline is out of scope for a schema-only commit. **Logged as a new `docs/TODO.md` line** (see below) rather than silently worked around.
   - Since the full suite couldn't run past that point, ran a **targeted, pollution-immune isolation proof** instead (ad hoc script, not committed — scratch only), covering exactly what the full suite's own `staff_positions`/`officer_terms` sections (§27-ish) check, using shape assertions instead of exact row counts: FORCE RLS on both tables (pass), `alder` sees zero foreign-org rows on either table (pass), `bramblewood` cannot INSERT a row naming `alder`'s `organization_id` on either table — including populating the new `public_listed` column in the attempted insert — rejected by `tenant_isolation`'s `WITH CHECK` on both (`insufficient_privilege`, pass), and `presby_app`'s table grant is still full select/insert/update/delete on both (pass, 4/4 each). All passed.
   - Sanity-checked the new function directly as `presby_app`: `select * from presby_public_staff_roster('nonexistent-slug-xyz')` returns 0 rows (enumeration-safe collapse, no error); `\df+` confirms `security: definer`, `presby_app=X` execute grant, no `public` privilege.
4. **`npm run typecheck` — PASS**, clean, no errors.

### Implementer Notes

- No deviation from the Phase 3 design's SQL — copied faithfully. The one addition (a `comment on function` line) is documentation-only, matching every other `SECURITY DEFINER` function's precedent in this schema; it changes no behavior and was not called out as optional in Phase 3, so noting it explicitly here rather than treating it as silent scope creep.
- Followed the **actual** house convention for applying hand-written migrations (direct `psql` against the shared dev database, per 0038/0039/0040's own precedent) rather than the Phase 3 doc's `npm run db:push` on a Neon branch suggestion — `db:push` is lossy/dev-branch-oriented and every migration this same day used the direct-apply path instead. Named explicitly per this pipeline's own instruction to check recent migrations for the actual convention rather than assume.
- Added a new `docs/TODO.md` line for the unrelated shared-dev-DB test-pollution finding (see below) rather than fixing it — it belongs to whichever pipeline's teardown leaked it, not to this schema-only step.
- **Next implementer (api-developer, step 2):** the three new columns (`publicListed`/`publicListedBy`/`publicListedAt`) are live on both `staffPositions` and `officerTerms` in `src/lib/db/domain/staff.ts`/`officers.ts`, and `presby_public_staff_roster(text)` is live and callable as `presby_app` (tested against the shared dev DB). To pick this up locally: `npm run db:push` is unnecessary against the shared dev DB (already applied there) but **is** needed against a fresh branch/environment — otherwise just pull `main` after this commits. No seed change was made in this step, so `npm run db:seed` is not required by this step alone.

---

## Phase 4 — Step 2 (api-developer) — COMPLETE

Scope: admin mutations + public read, `presby` only. Steps 3
(`presby-site-kit` v3.5.0, sibling repo) and 4 (render component + admin-toggle
UI) are separate implementers and untouched by this step.

### Files Modified

- `src/lib/staff.ts` — added `setStaffPositionPublicListed(viewerPersonId, organizationId, actingUserId, input: { positionId, publicListed })` per the Phase 3 API Contract's 4-step order (`hasStaffManage` gate → `(id, organizationId)`-scoped lookup → update all three columns on every call, both directions → `recordAudit()`). Added `publicListed: boolean` to `StaffPositionEntry`, threaded into `listStaffRoster()`'s existing select (additive field, same query, no new query). Imported `AUDIT_ACTIONS`/`recordAudit` from `@/lib/audit` — the first import of that module in this file. Header comment amended to name this as the one exception to the file's "no `recordAudit()` calls" posture (DECISION-129 covers hiring/termination only; this mutation is a disclosure fact, not an access fact — Phase 2 ruling 6b).
- `src/lib/officers.ts` — same shape: `setOfficerTermPublicListed(viewerPersonId, organizationId, actingUserId, input: { termId, publicListed })`, gated by `hasOfficersManage`, same 4-step order. Added `publicListed: boolean` to `OfficerRosterEntry`, threaded into `listOfficerRoster()`'s existing SQL (`ot.public_listed as public_listed`, no new query). Imported `AUDIT_ACTIONS`/`recordAudit`. Header comment amended to flag this as a DELIBERATE divergence from this file's own established pattern — `startOfficerTerm`/`endOfficerTerm` are audited from `admin/officers/actions.ts`, not from this file; `setOfficerTermPublicListed` is audited from inside `officers.ts` itself, per the work-log's explicit Phase 3 instruction to follow "lib-does-audit," not this file's own actual precedent.
- `src/lib/audit.ts` — added the four `AUDIT_ACTIONS` keys verbatim as specified: `STAFF_POSITION_LISTED_PUBLICLY` / `STAFF_POSITION_UNLISTED_PUBLICLY` / `OFFICER_TERM_LISTED_PUBLICLY` / `OFFICER_TERM_UNLISTED_PUBLICLY` (values `staff_position.listed_publicly`, `staff_position.unlisted_publicly`, `officer_term.listed_publicly`, `officer_term.unlisted_publicly`).
- `src/lib/sites.ts` — added `getPublicStaffRoster(slug: string): Promise<PublicStaffRosterEntry[]>` as the file's "COMMIT 5 ADDITION" (matching the header's existing "COMMIT N ADDITION" convention — the file counts by commit, not by caller-shape, so this is COMMIT 5 even though the header text calls it "a SIXTH caller shape"). Body: `if (!isFlagEnabled("sites.public_staff_directory")) return [];` then `db.execute(sql\`select * from presby_public_staff_roster(${slug})\`)`, mapped row-by-row. Officer `role_raw` maps through `OFFICE_LABELS` (the real, confirmed export name from `@/lib/officers` — no discrepancy from the work-log's spec); staff `role_raw` passes through unchanged. **One deviation from the literal spec, load-bearing, not cosmetic:** `OFFICE_LABELS` is imported via a runtime **dynamic** `import("@/lib/officers")` inside the function body, not the static top-level import the work-log's prose implies. Reason: `@/lib/officers` now imports `@/lib/audit` (this step's own change), which imports `@/auth` (next-auth) — a module `sites.test.ts`'s Vitest environment cannot resolve (`Cannot find module '.../node_modules/next/server'`). A static import would have broken every existing test in `sites.test.ts`, not just new ones. This mirrors the file's own established precedent one paragraph up (`resolveTypePairing()`'s dynamic import of `@/lib/brand/fonts`, for the analogous `next/font/google` SWC-only-export problem) — same shape of problem (a test-environment-only module resolution failure), different root package.
- `scripts/seed.ts` — added the `sites.public_staff_directory` flag row (seeded `false`), placed immediately after `sites.public_render`'s own entry, matching that entry's comment style and the `sites.*` namespace ruling from Phase 3.
- `src/app/(org)/o/[slug]/admin/staff/actions.ts` — added `setStaffPositionPublicListedAction(slug, input)`, wrapping `setStaffPositionPublicListed()` with this file's established `resolveActingIdentity()` → call → `OfficersResult`/`StaffResult`-to-`ActionResult` mapping → `revalidatePath()` shape. Calls **no** `recordAudit()` itself (the mutation's own audit call lives in `staff.ts`) — header comment amended to name this exception to the file's "no recordAudit() calls" posture.
- `src/app/(org)/o/[slug]/admin/officers/actions.ts` — added `setOfficerTermPublicListedAction(slug, input)`, same shape. Calls no `recordAudit()` itself — a DELIBERATE divergence from `startOfficerTermAction`/`endOfficerTermAction` in the SAME file, which do call `recordAudit()`. Header comment amended to name this explicitly so a future reader doesn't "fix" the apparent inconsistency by moving the call.
- `src/lib/audit.test.ts` — added the four new keys to `EXPECTED_ENTRIES` (the drift-regression fixture); `EXPECTED_COUNT` is derived from `Object.keys(...).length`, so no separate count edit was needed.
- `src/app/(org)/o/[slug]/admin/staff/staff-roster.test.tsx`, `.../officers/officer-roster.test.tsx` — added `publicListed: false` to the two hand-typed `StaffPositionEntry`/`OfficerRosterEntry` fixture objects each file declares (`OPEN_ENTRY`/`ENDED_ENTRY`, `ELDER_ENTRY`/`DEACON_ENTRY`). Required for `npm run typecheck` to pass once the field became non-optional on both interfaces — mechanical, not new UI (UI itself is step 4/ux-developer's scope, untouched here).

### API Contract Delivered

```ts
// src/lib/staff.ts
export async function setStaffPositionPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { positionId: string; publicListed: boolean },
): Promise<StaffResult<{ positionId: string; publicListed: boolean }>>
```

```ts
// src/lib/officers.ts
export async function setOfficerTermPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { termId: string; publicListed: boolean },
): Promise<OfficersResult<{ termId: string; publicListed: boolean }>>
```

```ts
// src/lib/sites.ts
export interface PublicStaffRosterEntry {
  displayName: string;
  roleLabel: string;
  department: string | null;
  photoKey: string | null;
}
export async function getPublicStaffRoster(slug: string): Promise<PublicStaffRosterEntry[]>
```

Server actions (both `'use server'`, both re-resolving `organizationId` via `resolveActingIdentity()` — never client-supplied):

```ts
// src/app/(org)/o/[slug]/admin/staff/actions.ts
export async function setStaffPositionPublicListedAction(
  slug: string,
  input: { positionId: string; publicListed: boolean },
): Promise<ActionResult<{ positionId: string; publicListed: boolean }>>
```

```ts
// src/app/(org)/o/[slug]/admin/officers/actions.ts
export async function setOfficerTermPublicListedAction(
  slug: string,
  input: { termId: string; publicListed: boolean },
): Promise<ActionResult<{ termId: string; publicListed: boolean }>>
```

**Auth/permission gate per entry point:**

| Entry point | Auth | Permission |
|---|---|---|
| `setStaffPositionPublicListed()` | caller must resolve via `withOrgContext()` (verified membership) | `staff.manage`, checked first, `forbidden` otherwise |
| `setOfficerTermPublicListed()` | same | `officers.manage`, checked first |
| `setStaffPositionPublicListedAction()` | `auth()` + `resolveOrgContext()` in the action body; 401-equivalent `"You must be signed in..."` if no session | delegates to the lib gate above (defense in depth — the action does not re-check the permission itself) |
| `setOfficerTermPublicListedAction()` | same | same, delegates to `officers.manage` |
| `getPublicStaffRoster()` | anonymous, no auth at all | none — gated only by `sites.public_staff_directory` (flag, not permission), per DECISION-003 |

**Flag:** `sites.public_staff_directory`, seeded `false`, `sites.*` namespace, checked bare (no DECISION-026 wrapper — not an auth path). Composition confirmed unchanged from Phase 3: gates whether the public read exists at all; the two permissions gate who may flip a row's bit. Neither substitutes for the other.

### Audit Events

`STAFF_POSITION_LISTED_PUBLICLY` / `STAFF_POSITION_UNLISTED_PUBLICLY` / `OFFICER_TERM_LISTED_PUBLICLY` / `OFFICER_TERM_UNLISTED_PUBLICLY`, all four called from inside `src/lib/staff.ts`/`officers.ts` (never from `actions.ts`), metadata `{ organizationId, publicListed }`, resource type `staff_position`/`officer_term`, resource id the position/term id. Fires on every call in both directions (turning the bit off is itself audited, not just turning it on) — proven by `staff.test.ts`/`officers.test.ts`'s own `mockRecordAudit` assertions for both directions.

### `check:audit` Tripwire-Coverage Finding (the work-log's own open question, now resolved)

**Confirmed: the tripwire is blind to this mutation, on two independent counts, not one.**

1. `scripts/check-audit-coverage.mjs` walks only `src/app/**/actions.ts`/`actions.tsx` files. `src/lib/staff.ts` and `src/lib/officers.ts` — where the actual `tx.update(...)` calls and the `recordAudit()` calls both live — are never visited by the script at all; they aren't under `src/app` and aren't named `actions.ts`.
2. Even restricting to the two `actions.ts` files this mutation DOES touch: the script's `MUTATION_RE` (`/\bdb\s*\.\s*(insert|update|delete)\b/`) looks for a literal `db.insert|update|delete` call *in that file*. Neither `admin/staff/actions.ts` nor `admin/officers/actions.ts` calls `db.*` directly anywhere (confirmed by direct grep before writing this section) — every mutation in both files goes through a `src/lib/*.ts` function. So `MUTATION_RE` never matches in either `actions.ts` file for ANY mutation in this feature area, and the script exits clean without ever reaching the `AUDIT_RE` check.

Net: `npm run check:audit` passing here is **not evidence of coverage** — it would pass identically if the `recordAudit()` calls in `staff.ts`/`officers.ts` were deleted entirely. The only real proof this mutation is audited is `staff.test.ts`'s and `officers.test.ts`'s own `mockRecordAudit` assertions (both fire, both directions, correct action key/metadata) — confirmed passing against the real dev database. Documented in both library files' own doc comments so a future reader doesn't mistake a green `check:audit` run for coverage of this call site.

### Tests Written

All run against the real dev database (`dotenv -e .env.local -- vitest run ...`), following each target file's own established harness (`hasDb` skip-guard, dynamic imports in `beforeAll`, self-contained fixture create/teardown):

- `src/lib/staff.test.ts` — new `describe("setStaffPositionPublicListed")`: `forbidden` (no audit fires) in the existing permission-gate block; `invalid_target` for a missing id and for a cross-org id; the ON direction (sets all three columns, `recordAudit` called with `STAFF_POSITION_LISTED_PUBLICLY`, correct metadata) then the OFF direction on the SAME row (columns updated again, `STAFF_POSITION_UNLISTED_PUBLICLY`). `recordAudit()` mocked at the module boundary (`@/lib/audit` transitively imports `@/auth`/next-auth, unresolvable under plain Vitest — same posture `children.test.ts`/`person-sensitive.test.ts` already establish).
- `src/lib/officers.test.ts` — identical shape, new `describe("setOfficerTermPublicListed")`, same mock, same four cases (forbidden/cross-org invalid_target/ON/OFF), `OFFICER_TERM_LISTED_PUBLICLY`/`UNLISTED_PUBLICLY`.
- `src/lib/sites.test.ts` — new `describe("getPublicStaffRoster")`, reusing the file's existing `orgLive`/`orgSuspended` fixtures: flag off → `[]`; flag on → a flat, alphabetized union of one public staff row and one public officer row, excluding a not-opted-in row and an ended-but-opted-in row (proves the SQL function's `ends_on is null` filter), with the officer's `role_raw` mapped through `OFFICE_LABELS` ("trustee" → "Trustee") and the staff `role_raw` passed through verbatim; revoking `publicListed` removes the row on the next read; a suspended org's own opted-in rows never surface (`organization_sites.status = 'live'` gate, defense-in-depth); a nonexistent slug returns `[]`. Required adding a `vi.mock("@/lib/audit", ...)` to this file — new, for the same transitive-next-auth reason as above, since `getPublicStaffRoster()`'s dynamic `import("@/lib/officers")` now pulls that chain in whenever the roster contains an officer row. Teardown required an additional fix beyond the mock: deleting the four fixture people directly (not via a cascading `organizations` delete, since `orgLive` is shared across the whole file) left their `group_memberships` rows (from `orgLive`'s pre-existing "Active Membership" derived group) as an FK blocker with no `ON DELETE CASCADE` — fixed by explicitly deleting those `group_memberships` rows first, inside the same disable/re-enable `group_memberships_reject_derived` wrap every other teardown in this file already uses.
- `src/app/(org)/o/[slug]/admin/staff/actions.test.ts` — extended the file's existing REAL-Postgres harness (not mocked, per this file's own established convention) with a `describe("setStaffPositionPublicListedAction")`: forbidden for a `people.manage`-only session; a full ON-then-OFF happy path against a real position created via the also-real `startStaffPositionAction`; `invalid_target` for a nonexistent id.
- `src/app/(org)/o/[slug]/admin/officers/actions.test.ts` — extended the file's existing MOCKED harness (mocking `@/lib/officers` at the boundary, per this file's own established convention — the opposite convention from the staff file, both pre-existing and both followed as-is) with a `describe("setOfficerTermPublicListedAction — OfficersResult → ActionResult mapping")`: identity resolution (not-signed-in, correct args passed through), `forbidden`/`invalid_target`/`ok` result mapping, and an explicit assertion that `recordAudit` is called **zero** times from this action on the `ok` path — the deliberate divergence from `startOfficerTermAction`/`endOfficerTermAction`'s own `recordAudit()` calls two describe blocks up in the same file.

### Verification Performed

1. **`npm run typecheck`** — PASS, clean.
2. **Targeted test files**, real dev database (`dotenv -e .env.local -- vitest run <files>`):
   - `src/lib/staff.test.ts` + `src/lib/officers.test.ts`: 55/55 passed.
   - `src/lib/sites.test.ts`: 64/64 passed.
   - `src/lib/staff.test.ts` + `src/lib/officers.test.ts` + `src/lib/audit.test.ts` together: 70/70 passed.
   - `admin/staff/actions.test.ts`: 5/5 passed.
   - `admin/officers/actions.test.ts`: 20/20 passed.
   - `staff-roster.test.tsx` + `officer-roster.test.tsx` (no DB needed): 11/11 passed.
3. **`npm test`** (full suite, no `.env.local`, matches CI): 237 files, 3071 passed, 618 skipped (DB-gated files), 0 failed.
4. **`npm run check:audit`** — passes, but see the tripwire-coverage finding above; a passing run here is not evidence of coverage for this feature's two new audited mutations.
5. **`npm run lint`** — 7 pre-existing errors / 190 pre-existing warnings, none in any file this step touched (confirmed by grepping the lint output against this step's changed filenames).
6. **Full-suite real-DB run** (`dotenv -e .env.local -- vitest run`, both with default file-parallelism and again with `--no-file-parallelism`) surfaced 3 additional failures — **all three independently pre-existing and already logged in `docs/TODO.md`, unrelated to this step's changes**, confirmed by: (a) re-running the same files in isolation (clean), and (b) matching each failure to an existing `docs/TODO.md` line predating this step:
   - `src/lib/rate-limit.test.ts` (3 sub-tests) — already logged: `RATE_LIMIT_DISABLED=true` in `.env.local` breaks this suite's in-memory assertions whenever the whole suite loads `.env.local` together; the documented workaround (scope `dotenv -e .env.local` to individual DB-backed files, never suite-wide) is exactly what every command above already does.
   - `src/lib/roll.test.ts` / `src/lib/staff.test.ts` (whichever ran last in a given pass) — already logged: `roll.test.ts`'s `afterAll` is missing the `group_memberships_reject_derived` disable/enable wrap around its cascading `organizations` delete, a regression predating this pipeline (`docs/TODO.md`'s dated entry from the 2026-08-27 presbytery-oversight-statistics pipeline). Not this step's file to fix.
   No failure in either full-suite run occurred inside this step's own new test code when that code was run in isolation or alongside its direct siblings (item 2 above).

### Implementer Notes

- Followed the Phase 3 spec's 4-step mutation order exactly for both `setStaffPositionPublicListed`/`setOfficerTermPublicListed` — no reordering, no added validation beyond what was specified (the only input besides the id is a boolean, per the design).
- **One confirmed discrepancy from the work-log's framing, not from its instruction:** Phase 3 said `recordAudit()` for `officers.ts` should follow "this pair of files' own audit-call-site convention when they do audit... inherited from `role-grants.ts`/`org-brand`-style lib-does-audit call sites." Direct inspection found `role-grants.ts`/`org-brand`'s audit calls actually live in THEIR OWN `actions.ts` files, not in the lib files themselves — and `officers.ts`'s own sibling mutations (`startOfficerTerm`/`endOfficerTerm`) are audited from `admin/officers/actions.ts`, not from `officers.ts`. The premise that a "lib-does-audit" convention was already established doesn't hold on direct inspection. Implemented per the work-log's EXPLICIT instruction anyway (`recordAudit()` inside `staff.ts`/`officers.ts`, not `actions.ts`) since that instruction was unambiguous regardless of the (inaccurate) precedent cited for it — this is a design decision for tech-lead/architect to revisit, not mine to override at Phase 4. Named here per this pipeline's own instruction not to redesign but to report findings.
- `getPublicStaffRoster()`'s dynamic (not static) import of `OFFICE_LABELS` is the one place implementation diverged from the letter of the Phase 3 snippet — documented above and in the function's own doc comment; the divergence is required for correctness under this test environment, not a style preference, and does not change the function's runtime behavior in the real Next.js server process.
- **Next implementer (api-developer, step 3, sibling `presby-site-kit` repo):** nothing in this step blocks step 3 — the `liveSlots` mechanism is independent of the admin-mutation/public-read work done here. `getPublicStaffRoster()` and both server actions are live and callable now; step 3 can proceed on its own schedule per the Implementation Order's own note that steps 1–2 ship independently of steps 3–4.
- **Next implementer (ux-developer, step 4):** `StaffPositionEntry.publicListed`/`OfficerRosterEntry.publicListed` are live on the existing roster reads — the "Public" badge and the "List publicly" `Switch`/`AlertDialog` control can be built against `setStaffPositionPublicListedAction`/`setOfficerTermPublicListedAction` directly; both return `{ positionId, publicListed }`/`{ termId, publicListed }` on success. No UI was added in this step (out of scope, confirmed not touched). `staff-roster.test.tsx`/`officer-roster.test.tsx`'s two fixture objects now include `publicListed: false` — extend rather than replace when adding the badge's own test coverage.

---

## Phase 4 — Step 3 (api-developer, sibling `presby-site-kit` repo) — CONFIRMED ALREADY COMPLETE

**Found already done at the start of step 4, not re-done.** `../presby-site-kit`
(sibling checkout) already had `v3.5.0` tagged and pushed to `origin`
(`git ls-remote --tags origin` confirms `refs/tags/v3.5.0` on the remote,
resolving to commit `6deef0c` — "feat: v3.5.0 -- generic liveSlots injection
mechanism") before this step started. Verified directly, not assumed:

- `src/index.tsx`'s `RenderSiteBundleInput` carries `liveSlots?:
  Record<string, ReactElement>`, threaded into `BlockRenderContext` and into
  `renderSiteBundle()`'s own body exactly as Phase 3 specified.
- `src/blocks.tsx` has `renderLiveSlotBlock` and a `liveSlot:
  renderLiveSlotBlock` entry in `BLOCK_REGISTRY`, matching Phase 3's snippet
  verbatim (`props.slot` must be a string; returns `ctx.liveSlots?.[slot] ??
  null`).
- `package.json` in the sibling repo reads `"version": "3.5.0"`.
- `StaffList`/`StaffPerson` are exported from `src/index.tsx` with the exact
  shape Phase 3's Component Plan names (`name`, optional `title`/`phone`/
  `email`, optional `photoUrl`).

No commit was made in the sibling repo by this step. Named explicitly per
this work-log's own instruction not to silently skip a step — this is a
confirmation, not a no-op.

## Phase 4 — Step 4 (ux-developer) — COMPLETE

Scope: `presby`'s own dependency bump onto the confirmed `v3.5.0` tag, the
`staffDirectory` live-slot render component, wiring it into `page.tsx`, and
the admin-side "List publicly" `Switch`/`AlertDialog`/"Public" badge on
`admin/staff` and `admin/officers`.

### Files Modified

- `package.json` — bumped the pinned dependency: `"presby-site-kit":
  "github:chenson42/presby-site-kit#v3.4.0"` → `"...#v3.5.0"`.
- `package-lock.json` — regenerated by `npm install`. **Not a plain `npm
  install`** in the end — the first `npm install` after editing
  `package.json` left `node_modules/presby-site-kit` at the OLD resolved
  commit (`81d1b16`, `v3.4.0`) despite the lockfile's own top-level
  `dependencies` block already reading `#v3.5.0` — npm's git-dependency
  cache did not re-resolve the ref on a bare `npm install` here. Fixed by
  removing `node_modules/presby-site-kit` and running `npm install
  presby-site-kit@github:chenson42/presby-site-kit#v3.5.0` explicitly, which
  correctly re-resolved to `6deef0c` (the real `v3.5.0` commit) and updated
  `package-lock.json`'s own `node_modules/presby-site-kit` entry to match.
  Confirmed the new type is actually visible before writing any code against
  it: `grep liveSlots node_modules/presby-site-kit/dist/index.d.ts` showed
  `liveSlots?: Record<string, ReactElement>;` only after this fix, not after
  the first bare `npm install`. Named here because a future implementer
  bumping this same pinned git dependency should not assume a bare `npm
  install` is sufficient — verify the installed `dist/*.d.ts` actually
  changed, don't trust the lockfile diff alone.
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — added `import {
  PublicStaffDirectory } from "../staff-directory"` and `liveSlots: {
  staffDirectory: <PublicStaffDirectory slug={slug} /> }` to the existing
  `renderSiteBundle({...})` call, alongside `contactForm`. Added a doc
  comment above the call explaining the generic-slot vs. bespoke-prop
  distinction for the next reader (Phase 2's own ruling that `contactForm`
  is NOT retrofitted onto this shape).
- `src/app/(org)/o/[slug]/admin/staff/staff-roster.tsx` — added a "Public
  listing" column (`PublicListingToggle` per row). **Hidden below `sm:`**
  (see Edge Cases below — this is a real finding from browser verification,
  not a design-doc requirement).
- `src/app/(org)/o/[slug]/admin/officers/officer-roster.tsx` — same shape,
  same `PublicListingToggle` (officers' own copy), same `hidden sm:table-cell`
  treatment.

### Files Created

- `src/app/(public)/site/[slug]/staff-directory.tsx` — `PublicStaffDirectory({
  slug })`, an `async` server component, no `"use client"`. Calls
  `getPublicStaffRoster(slug)`, maps each entry to site-kit's `StaffPerson`
  shape (`name`/`title`/`photoUrl` only — `phone`/`email` never set, per the
  design's field-scope-enforced-at-two-layers instruction), explicit empty
  branch (`<p>No one has been listed here yet.</p>`), otherwise `<StaffList
  people={...} />` imported directly from `presby-site-kit` (not through the
  block registry's `staffList` block type).
- `src/app/(org)/o/[slug]/admin/staff/public-listing-toggle.tsx` — the
  `Switch` + `AlertDialog` + `Badge` control for a single `staff_positions`
  row. Duplicated (not shared) with the officers twin below, matching this
  codebase's existing per-domain-file convention for the structurally
  similar "end this row" dialogs (`end-position-dialog.tsx`/
  `end-term-dialog.tsx` are separate files too).
- `src/app/(org)/o/[slug]/admin/officers/public-listing-toggle.tsx` — the
  `officer_terms` twin, same shape, `termId`/`officeLabel` instead of
  `positionId`/`position`.
- `src/app/(public)/site/[slug]/staff-directory.test.tsx`,
  `src/app/(org)/o/[slug]/admin/staff/public-listing-toggle.test.tsx`,
  `src/app/(org)/o/[slug]/admin/officers/public-listing-toggle.test.tsx` —
  new test files, see Tests Written below.
- `src/app/(org)/o/[slug]/admin/staff/staff-roster.test.tsx`,
  `.../officers/officer-roster.test.tsx`,
  `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — extended, not
  replaced (see Tests Written).

### The `AlertDialog` Confirms BOTH Directions, Not Just Turning the Bit On

Phase 1's Edge Cases required the "off does not retract" disclosure to
actually reach the admin, not just live in a design doc — the only way to
guarantee that is to show the dialog on every direction change, not only
when opting someone in. `PublicListingToggle` is CONTROLLED by a
`pendingValue: boolean | null` state, not an `AlertDialogTrigger` — clicking
the `Switch` never flips its own visible `checked` state immediately; it
stages the requested direction and opens the dialog. The `Switch`'s `checked`
prop only changes after the server action actually resolves `ok: true`,
using the server's own returned `publicListed` value (falling back to the
requested direction if the server response omits `data`, which the
`ActionResult<T>` contract allows for `ok: true`). A denied result leaves
`checked` exactly where it was — never the attempted value — matching
`features-list.tsx`'s own "never contradict the row you're looking at until
it changes for real" discipline for the same `Switch` component at a lower
trust threshold.

Dialog copy, verbatim:
- Turning ON: *"This makes [name]'s name, role, and photo (if one is on
  file) visible to anyone visiting the public website — including search
  engines and archival crawlers."*
- Turning OFF: *"This stops serving [name]'s listing going forward. It does
  not retract anything already cached or indexed elsewhere (search engines,
  web archives) — turning this off is not a full retraction."*

### Tests Written

- `src/app/(org)/o/[slug]/admin/staff/public-listing-toggle.test.tsx` (9
  cases) and the officers twin (7 cases) — both mock `./actions` and
  `sonner` at the module boundary (same reasoning `end-position-dialog.test.tsx`'s
  header gives). Pin: initial render (badge/switch state for both
  `publicListed` values); clicking the switch opens the dialog WITHOUT
  flipping the switch's own visible state (queried with `{ hidden: true }` —
  Radix's modal `AlertDialog` marks the rest of the page `aria-hidden` while
  open, which `getByRole` respects by default); the ON-direction and
  OFF-direction copy differ; Cancel calls the action zero times and leaves
  the switch unchanged; Confirm calls the action with the exact
  `positionId`/`termId` + `publicListed` pair and only then flips the switch/
  badge; a denied result surfaces via `toast.error` and leaves the switch at
  its prior committed value.
- `src/app/(public)/site/[slug]/staff-directory.test.tsx` (4 cases) — mocks
  `@/lib/sites` at the module boundary (same reasoning `[[...path]]/
  page.test.tsx`'s header gives for the same module). Pins: the empty-roster
  branch renders the explicit message, never a silent `null`; a non-empty
  roster renders every entry's name/role; `photoUrl` is built from
  `slug`+`photoKey` when present and left `undefined` (no `<img>`) when
  `photoKey` is `null`; no `mailto:` link or `data-slot="phone"` element ever
  renders, proving field-scope enforcement at this mapping layer
  independently of the SQL projection layer.
- `staff-roster.test.tsx`/`officer-roster.test.tsx` — extended with a new
  `PUBLIC_ENTRY` fixture and a new describe block each: a not-yet-listed row
  renders a switch and no badge; an already-listed row renders the badge and
  a checked switch. Both files' existing `vi.mock("./actions", ...)` calls
  were extended with the new action name (`PublicListingToggle` imports
  `./actions` too, so the roster test's existing mock needed the new export
  or the whole module import would fail).
- `[[...path]]/page.test.tsx` — one new test: `renderSiteBundle()` receives a
  truthy `liveSlots.staffDirectory` element, mirroring the existing
  `contactForm` assertion immediately above it.

### Verification Performed

1. **`npm run typecheck`** — PASS, clean, after fixing two `result.data`
   possibly-`undefined` errors (`ActionResult<T>`'s `data` is optional even
   on `ok: true` — fixed with `result.data?.publicListed ?? next`, `next`
   being the locally-captured requested direction).
2. **Targeted test files** (`npx vitest run` on the 6 new/modified files
   above): 58/58 passed on the first clean run (after one fix — see Bugs
   Found below).
3. **`npm test`** (full suite): 240 files passed, 26 skipped (DB-gated),
   3096 passed, 618 skipped, 0 failed — up from step 2's own 3071 passed (25
   net new tests: 9 + 7 toggle tests, 2 + 2 roster additions, 4
   staff-directory tests, 1 page.test.tsx addition).
4. **`npm run build`** (full production build) — clean, no errors. `/site/
   [slug]/[[...path]]`, `/o/[slug]/admin/staff`, `/o/[slug]/admin/officers`
   all present in the route manifest as dynamic (`ƒ`) routes, matching their
   pre-existing classification.
5. **`npm run check`** (all four tripwires) — all pass:
   `check:audit`/`check:sql-date`/`check:deps-drift`/`check:brand-scope`.
6. **`npm run lint`** — same 7 pre-existing errors / 190 pre-existing
   warnings step 2 already documented, confirmed by grep that none are in
   any file this step touched.

### Bugs Found During Implementation (fixed before handoff, not left for QA)

1. **Two `TS18048` "possibly undefined" errors** on `result.data.publicListed`
   in both `public-listing-toggle.tsx` files — `ActionResult<T>`'s `data`
   field is `T | undefined` even when `ok: true`. Fixed with a `next`
   fallback (the locally-known requested direction) rather than a
   non-null assertion, so a theoretical `{ ok: true }` with no `data` still
   degrades to the correct optimistic value instead of throwing.
2. **A jsdom-only test bug, not a UI bug** — `public-listing-toggle.test.tsx`
   (both files)'s "opens the confirmation dialog without changing the
   switch's own visible state" test initially called plain `getByRole("switch")`
   while the dialog was open, which failed because Radix's modal
   `AlertDialog` sets `aria-hidden="true"` on the rest of the page while
   open (correct accessibility behavior — a screen reader should not reach
   background content behind an open modal). Fixed by adding `{ hidden: true }`
   to that one query. Named explicitly because this is exactly the kind of
   thing that looks like a real bug in a test failure message but isn't one.
3. **A real, browser-verified mobile regression, found and fixed before
   handoff** — see "Real-Browser Verification" below for the full account.
   Adding the "Public listing" column as always-visible pushed "End
   position"/"End term" out of the initial 390px/360px frame with no visible
   affordance that more columns existed — the exact failure mode
   `officer-roster.tsx`'s own header comment already documents for
   `Class year`/`District`. Fixed by hiding the new column below `sm:`,
   joining `Department`/`Class year`/`District` in that set, rather than
   shipping a column that silently broke an existing, working mobile layout.

### Real-Browser Verification (Workflow Rule: "Verify in a Browser")

**Yes, done — Playwright is installed in this repo and was driven directly
via a throwaway Node script through the Bash tool** (not a dedicated
browser-automation tool grant, but functionally equivalent: a real Chromium
instance, a real dev server, a real Postgres connection). The script itself
was NOT committed (scratch-only, per CLAUDE.md's `private`/`scratch`
discipline) — it lived in the session's scratchpad directory, mirrored
`e2e/public-sites.spec.ts`'s own "capture original state → mutate directly
via `neon()` against `PLATFORM_DATABASE_URL` → screenshot → restore →
confirm by direct query" discipline, and every mutation it made was reverted
and confirmed reverted before this step ended.

**What was exercised, for real, in a real browser:**

1. **Admin toggle UI, `admin/staff` and `admin/officers`, at 390px, 360px,
   and 1280px desktop.** Signed in as `elder.fixture@example.invalid` (the
   existing sign-in-capable Alder Creek fixture person, Marguerite Ashcombe —
   reused rather than inventing a new fixture user, per this session's own
   "don't invent one unless genuinely necessary" instinct), after temporarily
   granting her `staff.manage`/`officers.manage` via the existing
   `personnel_admin`/`stated_clerk` role ids at Alder Creek (a real,
   temporary `role_grants` insert, deleted in the `finally` block —
   `scripts/seed-dev.sql`'s own comment two lines from this same feature's
   fixture block already documents this exact pattern: "temporarily
   hand-granted to stated_clerk during Phase 4 browser verification, then
   removed").
   - **At 390px/360px, first attempt**: the new "Public listing" column
     rendered always-visible, pushing "End position" off the initial frame —
     confirmed by comparing directly against an earlier, unrelated
     verification screenshot of the SAME page from before this feature
     existed (`roster-mobile.png`, from an earlier phase's own browser
     check), which shows the identical "En..." partial-clip at the frame's
     right edge as a PRE-EXISTING, unrelated clipping issue — so the fix
     below is about the NEW column specifically, not about matching a
     baseline this page never actually achieved.
   - Fixed (see Bugs Found #3), re-verified: at 360px/390px the roster now
     matches its pre-feature layout exactly (Public listing simply absent,
     no new overflow); at 1280px desktop, the "Public listing" column, its
     `Switch`, and the "Public" badge all render cleanly alongside "End
     position"/"End term" with no clipping.
   - Clicked a `Switch` (Marisol Windham, Church Secretary): the
     `AlertDialog` opened with the exact "List Marisol Windham publicly as
     Church Secretary?" copy and the internet-wide-visibility disclosure.
     Confirmed with "Yes, list publicly" — the row updated to show the
     "Public" badge and a checked switch, `router.refresh()` fired, no page
     reload needed.
   - On `admin/officers`, clicked a `Switch` (Tobias Renwick, Clerk of
     Session), confirmed the dialog opened, then clicked Cancel — the row
     stayed un-badged, unchecked, and `setOfficerTermPublicListedAction` was
     never called (this exercised Cancel in a real browser, not just under
     jsdom).
   - **One screenshot artifact, diagnosed and confirmed NOT a bug**: an
     early dialog screenshot (taken immediately on the confirm click)
     appeared visually "washed out," with the dialog's title text seeming to
     overlap the page content behind it. Re-captured with a 400ms wait after
     the click (letting Radix's own 200ms `fade-in`/`zoom-in` open animation
     finish) and the dialog rendered as a clean, solid, correctly-centered
     modal card with both "Cancel" and "Yes, list publicly" fully visible —
     confirming the first screenshot caught the dialog mid-animation, not a
     real rendering defect.
2. **The public-facing directory, `/site/alder-creek`, unauthenticated, at
   390px.** Staged a real, live content bundle (a `blob_assets` row + an
   `organization_sites` update to `status = 'live'`, mirroring
   `e2e/public-sites.spec.ts`'s `stageLiveBundle()` exactly) containing one
   page with a single `{"type": "liveSlot", "props": {"slot":
   "staffDirectory"}}` block — the actual marker shape a real content author
   would place in the separate, CI-ingested site-content repo. Set
   `staff_positions.public_listed = true` directly on Marisol Windham's row
   (the admin-UI path to the same state was already proven in step 1's
   walkthrough above; this step isolates the public-render half).
   `sites.public_render`/`sites.public_staff_directory` were both already
   `true` in the shared dev database (pre-existing state, not something this
   verification needed to flip). Navigated to `/site/alder-creek` as a fresh,
   unauthenticated browser context: **HTTP 200, and the rendered body text
   read "Marisol Windham / Church Secretary" via `presby-site-kit`'s real
   `StaffList` component, with no phone or email anywhere on the page** —
   the full pipeline (opt-in bit → SQL function → `getPublicStaffRoster()` →
   `PublicStaffDirectory` → `liveSlots.staffDirectory` → the `liveSlot` block
   renderer → `StaffList`) proven working end to end in a real browser, not
   inferred from passing unit tests. Screenshot saved
   (`7-public-site-staff-directory-390px.png` in the session scratchpad).
3. **Every mutation this verification made was reverted and confirmed
   reverted by direct query** before this step ended: the temporary
   `role_grants` rows (0 remaining), `auth.require_2fa` (restored to its
   captured original `true`), `sites.public_render`/
   `sites.public_staff_directory` (both already `true`, unchanged),
   `organization_sites.status`/`content_bundle_key` (restored to the
   captured pre-existing `provisioning` status and pre-existing bundle key —
   this org already had an unrelated leftover bundle from an earlier
   session's own testing, which this verification did not touch or clean up,
   since it predates this step and isn't this step's data to delete),
   `staff_positions.public_listed`/`officer_terms.public_listed` for both
   touched rows (both confirmed back to `false`). The dev server itself
   (restarted once, to guarantee `node_modules/presby-site-kit` was actually
   at `v3.5.0` and not a stale in-memory module graph from before the
   dependency bump) was stopped at the end of this step rather than left
   running.

**Not done, and named as such rather than left silent:** no new committed
`e2e/*.spec.ts` file was written for this feature. The verification above
used the identical mechanism `e2e/public-sites.spec.ts` already establishes
and could be converted into one relatively cheaply by a future pass, but
authoring a new permanent Playwright spec (with its own fixture-cleanup
discipline, CI runtime cost, and `test.describe.serial` sequencing against a
shared dev database) was judged out of scope for this implementation step
relative to the unit/component test coverage above, which QA can run
mechanically; the real-browser pass instead served this step's own
Workflow-Rule obligation to verify, not to leave permanent regression
coverage at the e2e layer. Flagged as a candidate follow-up, not a gap
silently absorbed.

### Copy Strings for a Fork's Branding Pass

None of this feature's own new copy is organization-name-branded (the
`AlertDialog` copy uses the person's own name and role/office, not the
congregation's name) — nothing here needs a fork's branding-pass review
beyond what `admin/staff`/`admin/officers`' existing copy already carries.
The public-facing empty state ("No one has been listed here yet.") and the
dialog's two direction-specific paragraphs are the only new user-visible
strings this step introduces.

### UX Tradeoffs

- **"Public listing" is desktop/tablet-only (`hidden sm:table-cell`), not a
  design-doc requirement but a real, browser-verified necessity** — see Bugs
  Found #3 and Real-Browser Verification above. An admin on a phone can see
  who else already has the "End position"/"End term" action without
  scrolling, but cannot see or flip the public-listing bit without switching
  to a wider viewport or landscape orientation. Given Phase 1's own framing
  of this action's cadence ("occasional, per hire"/"per election," not a
  look-up-on-the-go action), this reads as the right tradeoff rather than a
  compromise forced by running out of time — but it is a real capability gap
  for a mobile-only admin, named here rather than left to be rediscovered.
- **The confirmation dialog fires on BOTH directions**, not only when
  opting someone in. This is one more click than a bare optimistic toggle
  (like `features-list.tsx`'s own un-confirmed `Switch`) for the "turn it
  back off" case, which arguably doesn't need the SAME weight of warning a
  first-time opt-in does. Chosen deliberately anyway, because Phase 1's own
  Edge Cases required the "off does not retract from caches" disclosure to
  reach the admin at the moment they act, not just live in a design doc a
  human may never read.
- **Duplication over abstraction**: `admin/staff/public-listing-toggle.tsx`
  and `admin/officers/public-listing-toggle.tsx` are near-identical files.
  This matches the codebase's own existing precedent (`end-position-dialog.tsx`/
  `end-term-dialog.tsx` are equally duplicated), but a future third
  `*_manage`-gated "publicly list this row" surface should prompt actually
  extracting a shared component rather than a third copy.

### Next Steps

Phase 4 is complete in full. **Next: qa (Phase 5)** — the design doc's own
Edge Cases flagged one thing QA should specifically check, not infer from a
green `npm run check:audit`: the tripwire is mechanically blind to this
feature's two audited mutations (see step 2's own "Tripwire-Coverage
Finding" section above) — the only real proof of audit coverage is the
`mockRecordAudit` assertions inside `staff.test.ts`/`officers.test.ts`, which
QA should run and read, not just observe passing. A reviewer clicking
through in a browser should sign in as an admin holding `staff.manage`/
`officers.manage` (no seeded fixture holds either as a normal, permanent
grant today — Desmond Okonkwo/Rowan Thistlewood hold `personnel_admin` but
have no `users` row; Tobias Renwick holds `officers.manage` via
`stated_clerk` and may or may not be sign-in-capable, unconfirmed), visit
`/o/<slug>/admin/staff` and `/o/<slug>/admin/officers` at a `sm:`-or-wider
viewport, exercise the toggle in both directions, and (with
`sites.public_staff_directory` on and a live site carrying a `staffDirectory`
`liveSlot` marker) confirm the public page reflects it.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27
**Verified by:** qa

All checks below were re-run fresh by qa against the live tree and the real dev
database — not inferred from any implementer's own claims.

## Type Check

`npm run typecheck`: **PASS**, clean, zero errors.

## Unit Tests

`npm test` (full suite, no `.env.local`, matches CI): 240 files, 3096 passed,
0 failed, 618 skipped (DB-gated). Matches step 4's claimed numbers exactly —
confirmed not stale.

DB-backed suites re-run live against the real dev database:
- `src/lib/staff.test.ts` + `src/lib/officers.test.ts` + `src/lib/sites.test.ts`
  + `src/lib/audit.test.ts`: 134/134 passed.
- `admin/staff/actions.test.ts` + `admin/officers/actions.test.ts`: 25/25 passed.

## End-to-End Tests

No new committed Playwright spec exists for this feature's full click-through
flow (toggle → confirm dialog → server action → DB → public render). Named as
an **advisory gap for Phase 6**, not a QA FAIL: CLAUDE.md's mandatory-e2e
clause is scoped to auth-touching diffs only (confirmed below this feature
touches none of `src/auth.ts`/`src/app/(auth)/`/`src/app/api/auth/`/
`src/lib/auth/`), the Phase 3 design never scoped a new e2e spec as a required
deliverable, and the underlying functional claims are independently proven by
real-Postgres-backed integration tests rather than mocks. Recommend tracking
in `docs/TODO.md` at ship time as a named follow-up. Separately, ux-developer's
real-browser walkthrough (screenshots at 360/390/1280px, a live DB
mutation/revert exercising both the toggle and a live-rendered public page
with `sites.public_staff_directory` on and a `staffDirectory` `liveSlot`
marker) confirms the flow works end-to-end, even without a committed spec.

Existing e2e blast-radius check: no existing spec touches the modified roster
DOM (`admin/staff`/`admin/officers`/`staff-roster`/`officer-roster`) or
asserts on `BLOCK_REGISTRY`/`liveSlot`/`site/[slug]` contents — no existing
spec is at risk from this change.

## Regression Tests Added

- `src/lib/staff.test.ts:723-790` — `setStaffPositionPublicListed` ON-then-OFF
  against a real Postgres row re-read, asserting `mockRecordAudit` fires with
  the correct `AUDIT_ACTIONS` key on both directions — guards against the
  audit call silently regressing on the OFF direction.
- `src/lib/officers.test.ts` (~823-880) — identical shape for
  `setOfficerTermPublicListed`.
- `src/lib/sites.test.ts` — `getPublicStaffRoster`: flag off → `[]`; ON →
  correct union/label-mapping/`ends_on is null` filtering; suspended org
  excluded; nonexistent slug → `[]` — guards against the enumeration-safety
  and field-scope rulings regressing silently.
- `staff-directory.test.tsx` — empty-roster branch, `photoUrl` construction,
  asserts no `mailto:`/phone element is ever rendered — guards against a
  future edit accidentally widening the field projection.
- `public-listing-toggle.test.tsx` (both domains) — dialog opens without
  flipping the visible switch state pre-confirm; Cancel calls the action zero
  times; a denied result reverts the optimistic UI state.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (not touched by this feature; confirmed current)
- `src/lib/two-factor.ts`: 91.3% statements / 100% branches (not touched; confirmed current)
- `src/lib/flags.ts`: 100% (not touched by this feature; confirmed current)

## Independent Verification (beyond the standard checklist)

- **`check:audit` blind spot — confirmed real** by reading
  `scripts/check-audit-coverage.mjs` directly: it only walks
  `src/app/**/actions.ts` files (never `src/lib/*.ts`, where the actual
  `recordAudit()` calls live), and even in the two `actions.ts` files this
  feature touches, its `MUTATION_RE` never matches because neither file calls
  `db.*` directly. A green `check:audit` here is not evidence of coverage —
  real coverage is proven by the `mockRecordAudit` assertions in
  `staff.test.ts`/`officers.test.ts`, read directly and confirmed correct on
  both directions.
- **Enumeration safety — confirmed by direct code read and a live DB query.**
  `presby_public_staff_roster(p_slug text)` takes only a slug; no per-person
  lookup path exists anywhere in the new code. Queried the live dev DB
  directly with a nonexistent slug: 0 rows, no error.
- **Field scope — confirmed by direct code read.** `contact_methods` appears
  nowhere in the SQL function body except its own documentation comment;
  `staff-directory.tsx`'s mapping to `StaffPerson` never sets `phone`/`email`.
- **`sites.public_staff_directory` flag — confirmed** seeded `false` in
  `scripts/seed.ts`, and `getPublicStaffRoster()` short-circuits to `[]` when
  off, read directly in the code.
- **F2 discipline — confirmed by direct code read**: both new mutation
  functions look up the target row scoped to `(id, organizationId)` before
  writing, matching `endStaffPosition`/`endOfficerTerm`'s own precedent.
- **Mobile-overflow fix — confirmed present**: `hidden sm:table-cell` on the
  new column and its cell in both `staff-roster.tsx` and `officer-roster.tsx`.
- **`presby-site-kit` v3.5.0 pin — confirmed durable under a genuinely fresh
  `npm ci`**, not just a warm local cache: an isolated scratch `npm ci`
  resolved `presby-site-kit@3.5.0` from the pinned lockfile commit hash, and
  `dist/index.d.ts` contains `liveSlots`.
- **Direct DB confirmation**: `staff_positions`/`officer_terms` both show
  `relrowsecurity = t`, `relforcerowsecurity = t`; `presby_public_staff_roster`
  shows `prosecdef = t`, `presby_app` holds execute, `public` does not.

## Feature-Gate Audit

*(Verified by reading route/action bodies directly, not by inferring from green tests.)*

| Route or action | `auth()` present? | Permission/flag check present? | Correct key? |
|---|---|---|---|
| `setStaffPositionPublicListed()` (`src/lib/staff.ts`) | via `withOrgContext()` | yes — `hasStaffManage` (`staff.manage`), `forbidden` otherwise | yes |
| `setOfficerTermPublicListed()` (`src/lib/officers.ts`) | via `withOrgContext()` | yes — `hasOfficersManage` (`officers.manage`) | yes |
| `setStaffPositionPublicListedAction()` (`admin/staff/actions.ts`) | yes — `auth()` in `resolveActingIdentity()` | delegates to the lib gate (defense in depth, no duplicated re-check) | yes |
| `setOfficerTermPublicListedAction()` (`admin/officers/actions.ts`) | yes, same shape | delegates to `officers.manage` gate | yes |
| `getPublicStaffRoster()` (`src/lib/sites.ts`) | anonymous by design | yes — `isFlagEnabled("sites.public_staff_directory")`, fail-closed to `[]` | yes |
| `presby_public_staff_roster(text)` SQL function | N/A (anonymous by design) | fixed column projection is the enforcement point; `revoke all from public` / `grant execute to presby_app` | yes |

No route wrongly returns data to an under-privileged caller; no gate missing or misnamed.

## Auth-Touching Scope Check

Confirmed false: none of this feature's created/modified files overlap
`src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`. The
stricter auth e2e gate does not apply; standard verification applies.

## Verdict

**PASS**

All required checks are green, freshly re-run. The feature-gate audit found
no missing or misnamed gate. Enumeration safety, field scope, F2 discipline,
the flag default, and the mobile fix were each confirmed by direct code/DB
inspection. The `check:audit` blind spot is real and correctly compensated
for by real-DB-backed unit tests. The `presby-site-kit` v3.5.0 pin is durable
under a fresh `npm ci`. One advisory gap for Phase 6: no committed Playwright
e2e spec for this feature's click-through flow — recommend a `docs/TODO.md`
follow-up line at ship time, not a blocker given the strength of the real-DB
integration coverage and the documented manual real-browser verification.

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Every privacy/safety-critical ruling from Phase 1 — opt-in not default-visible, per-row not per-office, no per-person route ever, field scope enforced twice, `recordAudit()` on both directions — landed exactly as designed and was independently re-verified at both Phase 5 and Phase 6; but the feature is named "with headshots" and ships with zero headshots, directly contradicting Phase 1's own explicit reversal that a photo-less v1 "does not deliver on the operator's own stated value" and should be *sequenced behind*, not *shipped without*, photo wiring — and a real, previously-unflagged gap surfaced at Phase 6: the public roster read has no fail-closed handling for a DB error, silently defaulting to the riskier of the two explicitly-undecided options Phase 1 named.

## What's Working

- **The admin opt-in flow (Flow 1/3) is better than what Phase 1 asked for.** The `AlertDialog` fires on *both* directions, not just opt-in, with copy that plainly names the caching/retraction reality ("It does not retract anything already cached or indexed elsewhere") — Phase 1's Edge Case ("photo-caching and un-publish reality... the confirmation dialog should say this plainly") is honored word-for-word, and the implementer went further than the design doc strictly required by confirming this in a real browser on both `admin/staff` and `admin/officers`, including the Cancel path.
- **Enumeration safety by construction holds all the way through.** No per-person route exists anywhere in `(public)/site/[slug]/` (confirmed by directory listing); `presby_public_staff_roster(text)` takes only a slug; a nonexistent slug returns zero rows with no error, confirmed live by both the implementer and QA against the real dev DB. This was Phase 1's strongest single ruling and it was not walked back at any phase.
- **Field-scope enforcement is genuinely two independent layers**, exactly as Phase 3 designed: the SQL function's own column projection never selects `contact_methods`, and `staff-directory.tsx`'s mapping to `StaffPerson` never sets `phone`/`email` — either layer could regress alone without leaking a contact field, confirmed by a dedicated test (`staff-directory.test.tsx`) asserting no `mailto:` link ever renders.
- **The flag/permission composition is correct and confirmed live**: `sites.public_staff_directory` (off) short-circuits `getPublicStaffRoster()` to `[]` before any query runs; `staff.manage`/`officers.manage` gate who may flip a row's bit; neither substitutes for the other, and a real end-to-end browser walkthrough (opt-in bit → SQL function → `PublicStaffDirectory` → `liveSlots.staffDirectory` → `StaffList`) was actually driven through a live Chromium instance against the real dev DB, not merely inferred from green tests.
- **The cross-repo `presby-site-kit` v3.5.0 dependency is durable**: QA independently confirmed a fresh `npm ci` (not a warm cache) resolves the pinned tag and the installed `dist/index.d.ts` actually contains `liveSlots`.

## Intent-vs-Shipped Diff

- Phase 1 said: per-person opt-in, not per-office defaults (Ruling 1). Shipped: two boolean columns per table (`staff_positions.public_listed`, `officer_terms.public_listed`), no join table, no office-tier default. **Verdict: matches.**
- Phase 1 said: opt-in, not default-visible — "and it isn't close" (Ruling 2). Shipped: both columns default `false`; the only path to `true` is the admin `Switch` + confirmation dialog. **Verdict: matches.**
- Phase 1 said: congregation and presbytery both, from v1, with no artificial org-type restriction (Ruling 3). Shipped: `presby_public_staff_roster()` restricts only on `organizations.status = 'active'` and `organization_sites.status = 'live'`, no `organization_type` check anywhere in the function or the render path. **Verdict: matches.**
- Phase 1 said: a photo-less v1 "does not deliver on the operator's own stated value... photo wiring should not be treated as optional... sequence, don't skip... this directory pipeline should not proceed to Phase 2 assuming photos are a stretch goal" (Ruling 4). Phase 2 punted the sequencing question back to "operator/tech-lead," and Phase 3 (DECISION-131, third point) shipped v1 with photo upload *not sequenced first but simply deferred as a named follow-up*, reasoning that a name+role+department listing has standalone value and costs nothing to complete later. Shipped: exactly the "skip" option Phase 1's ruling explicitly argued against, not the "sequence" option it recommended. **Verdict: acceptable drift, not a regression** — the technical claim that nothing requires rework later is true and independently verifiable (the asset route already resolves any blob key by org, so a future `photo_key` value needs zero new plumbing) and the feature does deliver real, honest value without photos. But it is a real drift from an explicit Phase 1 ruling that should have looped back through Phase 1 rather than being resolved unilaterally at Phase 3 — flagged as a note, and the "headshots" framing should not appear in any release-notes/what's-new copy until photos actually ship.
- Phase 1 said (Flow 2's own unresolved question): a query error on the public read must explicitly choose between "degrades to no listing shown" (per-block fault isolation) or "takes down the whole page" (`getPublishedSite()`'s all-or-nothing collapse) — "undecided; not this pipeline's call to make, but it must be made explicitly, not inherited by accident." Shipped: neither Phase 2 nor Phase 3's design doc makes this decision anywhere findable, and the code (`getPublicStaffRoster()`, no `try/catch`; `renderSiteBundle()`, no per-block error boundary; no `error.tsx` under `(public)/site/[slug]/`) inherits the all-or-nothing collapse by accident — precisely the failure mode Phase 1 warned against. **Verdict: regression against an explicit Phase 1 instruction**, though bounded in practice (flag ships off; `getPublishedSite()` already carries the identical risk profile today as an accepted precedent, so this isn't a new class of platform risk, just an unexamined instance of an old one). **Closed same-day — see the Phase 4 bug-fix addendum below.**
- Phase 2 said: silent drop-off on term-end is sufficient, no acknowledgment step. Shipped: `ends_on is null` filter in the SQL function, no trigger, no second write path. **Verdict: matches.**
- Phase 2 said: `recordAudit()` is required, not optional (ruling 6b). Shipped: four new `AUDIT_ACTIONS` keys, called from inside `staff.ts`/`officers.ts` on every call in both directions — confirmed via direct code read and via `mockRecordAudit` assertions in `staff.test.ts`/`officers.test.ts`, which QA correctly identified as the *only* real proof of coverage since `check:audit`'s tripwire is mechanically blind to this call-site shape (confirmed independently by both the implementer and QA reading `scripts/check-audit-coverage.mjs` directly). **Verdict: matches, and the tripwire gap itself is a legitimate, well-documented finding worth a monthly-review line, not this feature's own defect.**

## Edge Cases

- Empty state: **pass** — `PublicStaffDirectory` has an explicit `entries.length === 0` branch rendering "No one has been listed here yet." rather than delegating to `StaffList`'s own silent `null`, exactly per Phase 1's named gap.
- Failure microcopy: **pass (admin side) / fixed same-day (public-read side)** — the admin toggle correctly surfaces a DB/denied error via `toast.error` and reverts the optimistic UI state. The public read initially had no fail-closed handling for a DB error at all — see the Phase 4 bug-fix addendum below, closed before this pipeline's own SHIP WITH NOTES took effect.
- Permission gate: **pass** — `staff.manage`/`officers.manage` checked first in both library functions (`forbidden` otherwise), both server actions delegate rather than duplicate the check (defense in depth without redundant logic to drift).
- Audit event: **pass** — all four keys fire on both directions, confirmed by both implementer tests and independent QA re-run.
- Mobile (360px): **pass, with a disclosed tradeoff** — a real, browser-caught regression (the new column pushing "End position"/"End term" off-frame) was found and fixed *before* handoff by hiding "Public listing" below `sm:`. The tradeoff (a phone-only admin cannot see or flip the bit without a wider viewport) is real and named, but matches Phase 1's own framing of this action's cadence ("occasional, per hire/election," not a look-up-on-the-go action) — an acceptable, disclosed limitation, not a defect.

## Follow-Ups (SHIP WITH NOTES)

1. **Photo upload wiring for `people.photo_key` — treat as a priority follow-up, not a someday item.** This directly reverses the "sequence, don't skip" instinct Phase 1's own review gave, and the feature's public-facing name promises headshots it doesn't deliver. The serving mechanism needs zero further schema work (`(public)/site/[slug]/assets/[key]/route.ts` already resolves any blob key by `organizationId`); what's missing is purely upload UI + a mutation. Tracked in `docs/TODO.md`.
2. **No committed Playwright e2e spec for the toggle → confirm → server action → DB → public render click-through.** QA correctly did not FAIL this (CLAUDE.md's mandatory-e2e clause is scoped to auth-touching diffs, and this feature touches none of them; the real-DB integration coverage plus a documented, screenshot-backed real-browser walkthrough substantively cover the same claims). Filed in `docs/TODO.md`'s "Blocking a flag flip / go-live" section — must exist before `sites.public_staff_directory` ever flips on for a real organization.
3. ~~`getPublicStaffRoster()` needs fail-closed error handling.~~ **Closed same-day** — see the Phase 4 bug-fix addendum immediately below.
4. Mobile capability gap, disclosed not hidden: an admin cannot see or flip the "Public listing" control below the `sm:` breakpoint. No action required now.

---

## Phase 4 — Bug-Fix Addendum (same-day, Phase 6 follow-up closed)

**Bug-Fix Variant per CLAUDE.md — brief, since the fix is small and the root cause is already fully diagnosed above.**

**Phase 1 (brief):** Confirmed real. `getPublicStaffRoster()` (`src/lib/sites.ts`) wraps no error handling around `db.execute(sql\`select * from presby_public_staff_roster(${slug})\`)`. A transient DB error (connection blip, statement timeout) throws uncaught up through `PublicStaffDirectory` into `renderSiteBundle()`, which has no per-block error boundary — the entire `(public)/site/[slug]` page fails for that org, not just the staff section. Phase 1's original functional review explicitly named this exact decision ("must be made explicitly, not inherited by accident") and it was never made at Phase 2 or Phase 3. Fix preserves intended behavior: a transient error degrades to an empty roster (same as "flag off" or "nobody opted in"), never a page-wide failure.

**Phase 2:** Skipped — no invariant touched, no new dependency, no structural change; a `try/catch` inside an existing function.

**Phase 3:** Skipped — the fix is a two-line change with an obvious shape; documented here instead of a separate design doc.

**Phase 4 (implementer: api-developer):** `getPublicStaffRoster()` wraps the `db.execute()` call in `try/catch`; on error, logs via this file's existing error-logging convention (matching how other anonymous-read functions in `sites.ts` already handle a query failure — checked and followed, not invented) and returns `[]` — the same fail-closed value as "flag off," making the failure mode indistinguishable from an empty roster rather than a broken page. Added a regression test in `src/lib/sites.test.ts`: mocks `db.execute` to reject, asserts `getPublicStaffRoster()` resolves to `[]` rather than throwing. Confirmed the test fails against the pre-fix code (throws, doesn't resolve) and passes after.

**Phase 5 (qa):** Verified the regression test fails on the pre-fix code and passes on the post-fix code; confirmed no other caller of `getPublicStaffRoster()` assumed a thrown error as signal (none did); full suite re-run clean.

**Phase 6:** Confirmed — the public-read fail-closed decision Phase 1 flagged as unmade is now made, matches the safer of the two named options, and required no rework of anything upstream.
