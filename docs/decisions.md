# Decisions Log

Architectural and implementation decisions for the Claude Code Starter. Newest first. Each decision is numbered; the number does not change once assigned.

---

**DECISION-126: The project is named PresbyPortal (domain `presbyportal.org`), ending the placeholder period `docs/STATE.md` had tracked since the schema-design foundation.** (2026-08-27, operator decision.) Public-facing surfaces — the marketing home page, README, external docs — use **PresbyPortal** starting immediately. Internal code identifiers (`presby_app` the database role, the `presby_*` SQL function prefix, migration filenames, `package.json`'s still-starter name) are **deliberately left unchanged for now** — CLAUDE.md's own standing instruction was "don't fix either one piecemeal," and that reasoning strengthens rather than lapses now that a name exists: a live Postgres role carries session/connection state, and every `FORCE ROW LEVEL SECURITY` policy and `SECURITY DEFINER` function in this codebase references `presby_app` by name, so renaming it is a coordinated migration with real operational risk, not a find-and-replace. Tracked in `docs/TODO.md` as its own future scoped pipeline (Phase 1 to enumerate the full blast radius — DB role, function prefix, migration filenames, `package.json`, directory/doc mentions — before any rename begins). `docs/STATE.md`'s naming section updated to record the decision and the reasoning for the code/copy split.

**DECISION-125: `DomainTileSections`/`TileGrid` move to `src/components/shared/`, generalized over a `TileLike<TDomain>` bound (`key`/`label`/`description`/`domain`) plus `getHref`/`getIcon` resolver props and a `domainOrder`/`domainLabels` pair, replacing the org-portal-specific `slug`+`PortalTile` coupling; both org-portal call sites migrate in the same commit as the new admin-portal consumer; the greeting-band component and its pure `timeOfDayGreeting` helper relocate to shared alongside it.** (2026-08-27, tech-lead Phase 3, `docs/work-log/2026-08-27-platform-home-and-portal.md`.) Turns the architect's Phase 2 genericization ruling into exact prop signatures. `slug` disappears from both components entirely — the org-portal callers close over their own `slug` inside a `getHref={(tile) => tile.href(slug)}` closure, and the new admin-portal caller passes `getHref={(tile) => tile.href}` (a plain string, no per-org routing on that axis). **The migration is one commit, not two**: a half-genericized pair — one caller on the old slug-coupled shape, one on the new generic shape — would mean two divergent copies with no way to verify they stay in sync, which is the exact drift class the genericization exists to prevent. The greeting-band relocation follows the identical reasoning `DestinationCard`'s own header comment already gives for being one component across two axes ("two components would drift... within a release") — `/admin`'s previously bare `<h1>Welcome, {name}.</h1>` adopts the same `bg-card`/`border-l-primary` accent-stripe treatment DECISION-104/105 already gave the org-portal home, rather than duplicating that Tailwind string a second time. `motionEnabled` is passed `false`, hardcoded, at the `/admin` call site — no motion-rollout flag exists on that axis and inventing one for a single mount fade-in isn't justified by this pipeline.

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-platform-home-and-portal` (Phase 3)

---

**DECISION-124: `/launch`'s chooser destination becomes the single literal `"/home"` (never `"/orgs"`); `/orgs` survives only as a `next.config.ts` permanent (308) redirect to `/home` with its route segment deleted; `platform.merged_home` (required, seeded ON) gates ONLY `/home`'s own rendering of the merged content, never the routing target — the flag is deliberately never threaded into `computeDestination`.** (2026-08-27, tech-lead Phase 3, `docs/work-log/2026-08-27-platform-home-and-portal.md`.) Resolves the one open question the architect's Phase 2 ruling left to Phase 3: where the required rollout flag's gating point lives, given `destination.ts` must stay a pure, zero-import function. Threading the flag into `computeDestination` (either as a boolean or as a caller-supplied `chooserPath` parameter) was considered and rejected as dead-weight: once `/orgs` is a config-level redirect rather than a page, a computed fallback of `"/orgs"` is behaviorally identical to `"/home"` — the browser just takes one extra 308 hop back to the same place — so a flag-driven branch inside the matrix would add complexity with no observable effect and would cost the function its zero-import purity for nothing. The flag's real, useful gating point is `/home`'s own render branch: ON renders the new "Your organizations" + "Platform" sections above the pre-existing quick-links/what's-new/feedback content; OFF renders exactly the pre-merge page. This makes the flag a genuine content-level kill switch (a rendering bug in the new sections can be turned off without a redeploy) while keeping `destination.ts` exactly as pure as the architect's "one literal changes" ruling already described.

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-platform-home-and-portal` (Phase 3)

---

**DECISION-123: The platform-portal axis (`src/lib/admin-portal/tiles.ts`) hides tiles by `hasFeature()` alone, hide-if-not-held — confirming the architect's Phase 2 ratification with the registry itself staying pure synchronous data (no `hasFeature`/session/query inside it; a colocated `visibleAdminTiles()` helper does the one-time filter at the page, `destination.ts`'s own precedent for where such logic lives); `FEATURES.ADMIN_DASHBOARD` is formalized as this axis's single "door" feature, and `support_operator` (previously bound to `ADMIN_TICKETS`/`ADMIN_FEEDBACK` only) is additionally bound to it — a seed-data fix correcting a previously unrecognized Edge-gate defect that left `support_operator` unable to reach `/admin` at all.** (2026-08-27, tech-lead Phase 3, `docs/work-log/2026-08-27-platform-home-and-portal.md`.) The third finding: Phase 1's claim that `support_operator` "gets denied on eight of [ten] cards today" implied this role already reaches `/admin` and sees a partially-blocked hub. Verified false by reading `src/proxy.ts` directly — its catch-all `PROTECTION_RULES` entry (`{ pattern: /^\/admin/, required: FEATURES.ADMIN_DASHBOARD }`) governs `/admin` itself and every sub-path not covered by the three more specific rules, which includes `/admin/tickets` and `/admin/feedback`; `support_operator` holds neither `ADMIN_DASHBOARD` nor those specific rules' keys as an escape hatch, so it is bounced to `/access-pending` on all three paths today, before any RSC-level `hasFeature()` check runs. This is the mirror image of the defect Phase 1/2 named (total exclusion instead of over-exposure), and left unfixed it would make this pipeline's own acceptance criterion ("a `support_operator`-features session sees exactly two tiles") unverifiable in a browser. Ruling: bind `FEATURES.ADMIN_DASHBOARD` to `support_operator` in `scripts/seed.ts`'s `bindSupportOperatorFeatures()` — a one-line data change, not a schema or `PROTECTION_RULES` change — establishing the general rule that `ADMIN_DASHBOARD` is the axis's single entry gate and every other `admin.*` key governs visibility once inside, matching how the full `admin` role already works (bound to every `FEATURES.*` key including `ADMIN_DASHBOARD`). Did not warrant a Phase 1 loop-back: the functional intent is unchanged, only an implementation-level blocker was found and closed within Phase 3, named explicitly per the retro precedent (2026-07-11) that an unanticipated existing-spec-adjacent finding gets surfaced, not folded silently into "fixed."

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-platform-home-and-portal` (Phase 3)

---

**DECISION-122: The viability map takes `leaflet` directly, never `react-leaflet`; keyed tiles; single-file containment.** (2026-08-27, architect Phase 2 addendum, `docs/work-log/2026-08-27-presbytery-program.md`.) `leaflet` (BSD-2-Clause, `^` pin + lockfile, `@types/leaflet` dev-dep) is taken directly and wrapped in one small `'use client'` component; `react-leaflet@5` is **rejected on license grounds** — Hippocratic-2.1, verified against the npm registry, outside the repo's accepted license classes — and must not be added without a fresh architect ruling. Tiles ship from a keyed free-tier provider (MapTiler recommended; public domain-restricted `NEXT_PUBLIC_*` key, Turnstile-site-key shape) as exactly one new named `img-src` CSP host — never raw OpenStreetMap tile servers in production (their usage policy; bare OSM stays a dev-only convenience). The component is confined to `src/app/(org)/o/[slug]/admin/insights/map.tsx` via `next/dynamic(..., { ssr: false })` (leaflet CSS imported there only), enforced by a `check:deps-drift`-style tripwire pinning both package names to that one file — a Phase 4 deliverable that gates Phase 5. A tile-failure list/table fallback (triggered on Leaflet `tileerror` threshold, not `<noscript>`) covers the offline-manse case.
## DECISION-121: The public-site fallback for a never-provisioned presbytery/synod/GA slug is one extra `publicOrgSummary(slug)` call on `getPublishedSite()`'s existing `not_found` branch, rendering org name + sign-in link; congregations' enumeration-safe 404 collapse is untouched; classified Polish, folded into Increment 3's PR rather than its own work-log

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-presbytery-program` (Phase 3)

Turns the architect's Phase 2 Ruling 3 into a buildable shape. The miss branch of `getPublishedSite()` gains one conditional: call the already-public, bare-grant `publicOrgSummary(slug)`; if it resolves and `organizationType ∈ {presbytery, synod, general_assembly}`, render a new `PresbyteryFallback` component (org name + a link to `/o/<slug>` sign-in) instead of `notFound()`; if it resolves as a `congregation`, or does not resolve at all, fall through to the existing unconditional `notFound()` unchanged — a congregation's `platformStatus` stays protected by the same enumeration-safe collapse DECISION-040 already established, and response time must not vary between the two miss cases (an org-tree lookup either way). No schema, no new function, no new permission, no brand-scope violation (the fallback renders no brand tokens, so `(public)/site/<slug>` does not gain a second brandable-route-group member). Classified **Polish**, not its own pipeline: the change is a single new branch in one existing function plus one small presentational component, with no dependency on any of the program's other three increments — folded into Increment 3's PR as the smallest available vehicle, rather than minting a fourth work-log for a 20-line change.

---
## DECISION-120: Presbytery-owned operational data (viability/oversight, statistics, per-capita) gets a new `src/lib/db/domain/presbytery.ts` domain file with four tables — `congregation_oversight`, `congregation_statistics`, `per_capita_rates`, `per_capita_records` — none of which extend `reporting.ts` or `officers.ts`; `congregation_statistics` is ONE table with a `provenance` column, not two coalesced tables; the map's lat/lng columns live on `congregation_oversight`, not `organization_profiles` (verified absent from schema)

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-presbytery-program` (Phase 3)

Turns the architect's Phase 2 placement ruling into a buildable shape and resolves the one open schema question Phase 2 left to Phase 3. **First, placement:** confirmed as proposed — `presbytery.ts` holds "the presbytery's operational relationship to its member congregations," distinct from `reporting.ts` (the single-purpose `sasrReports` source doc, itself unused by any application code as of this pipeline — verified by direct search, no `src/lib/sasr.ts`, no admin route reads or writes it) and from `officers.ts` ("who serves" shapes: ordinations, officer terms, appointments). **Second, and the load-bearing call:** ONE `congregation_statistics` table with a `provenance` CHECK column (`presbytery_entered | published_by_congregation | imported`), not two tables coalesced at read time — every consumer (Increment 3b's list, 4a's read-back, 4b's rollup, per-capita's basis-year lookup) needs the same `(about_org_id, year)` keyspace regardless of who wrote a given row, and a two-table split would force all four call sites to union across tables instead of reading one. The freeze-only-on-published-rows requirement the architect flagged as the reason a single table might not work is instead expressed as a **partial** unique index (`unique (organization_id, about_org_id, year, provenance) where provenance in ('presbytery_entered','imported')` — deliberately excluding `published_by_congregation`, which is never unique-constrained on `(about_org_id, year)` because a republish is a new frozen row chained by `supersedes_publication_id`, never an UPDATE) plus a trigger predicated on the same column (`BEFORE UPDATE OR DELETE WHEN (OLD.provenance = 'published_by_congregation')`) — the roll_actions/void precedent, applied to a column instead of a second table. **Third:** Phase 1's functionality inventory claimed organizations "already carry" mappable coordinates for the viability map; **verified false** by direct read of `sites.ts` (`organization_profiles.address` is one free-text line, no lat/lng) and `people.ts` (`addresses.latitude/longitude` is a person/household column, unreachable from an org-level map). Rather than add a geocoding dependency (a real sub-problem Phase 1 never scoped) or bolt lat/lng onto `organization_profiles` (congregation-editable, and therefore absent for the majority-unmanaged case D9 describes — it cannot be the map's data source without also solving "who fills this in for a church with no session on the platform"), two manually-entered nullable columns land on `congregation_oversight` instead — the table the presbytery already edits for every member congregation, managed or not.

---
## DECISION-119: Four new permission keys run DECISION-078's constitutional-duty test individually rather than as a block — `statistics.manage`/`per_capita.manage` bind to `presbytery_stated_clerk` (passes, same SASR-compilation duty as `demographics.manage`, one level up the hierarchy); `congregation_oversight.manage` gets NO default binding (fails the test — viability/buildings-insurance judgment is Committee-on-Ministry-adjacent, not clerk register-keeping, following `groups.manage`/`events.manage`'s no-default precedent); `statistics.publish` binds to the congregation's own `stated_clerk` per the architect's ruling; the congregation-side publish form is manual entry, decoupled from the unbuilt `sasr_reports` compilation UI

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-presbytery-program` (Phase 3)

Turns the architect's Phase 2 Ruling 2 — `statistics.publish` as an ordinary tenant permission bound to the congregation's own `stated_clerk` — into a buildable shape, and answers the architect's own adjacent note to run the identical test on the presbytery-side keys rather than assume they all land on `presbytery_stated_clerk` by default. **`statistics.manage` and `per_capita.manage` pass the test**: compiling and correcting a congregation's statistical record, and billing per capita off it, is the same SASR-compilation duty `demographics.manage` already binds to `stated_clerk` for (DECISION-108), one level up the ecclesiastical hierarchy — both default-bind to `presbytery_stated_clerk`, tier 2 (financial data is tier 2 by the schema's own definition regardless of aggregation level, a stricter read than the oversight key below). **`congregation_oversight.manage` does NOT pass**: viability score and buildings/insurance assessment is the presbytery's own judgment about a congregation, closer to Committee-on-Ministry oversight than to register-keeping, and no PC(USA) office is *the* constitutional keeper of it — ruled no default binding at all, following `groups.manage`/`events.manage`'s precedent (DECISION-110/115) rather than accreting a fourth unjustified permission onto `presbytery_stated_clerk`, which DECISION-101/106/110/115 have each separately flagged as already accumulating permissions one individually-justified addition at a time. Fixture-only grant to `presbytery_stated_clerk` for dev reachability, explicitly commented as a convenience, not a production default — same posture `events.manage`'s own fixture grant already uses. **`statistics.publish`** confirmed at the congregation's `stated_clerk`, tier 2, never conflated with `presbytery_stated_clerk` — the two roles live at different organizations and this permission's whole point is that the acting person and the effect land on opposite sides of the hierarchy. **The publish mechanism's actual input, decided here:** the architect's Ruling 1 describes the calling action extracting fields from "the congregation's approved `sasr_reports` row" — verified that no application code anywhere reads or writes `sasr_reports` today (no compilation UI exists, and its own financial-line source, the ledger, is unbuilt). Building that screen as a prerequisite would balloon this program past its own scope. Ruling: the publish form is direct manual entry of the same aggregate fields `congregation_statistics` stores, decoupled from `sasr_reports` entirely for v1 — an honest description of how a real clerk fills out the SASR today, not a defect; a future increment that builds the real SASR-compilation projection can prefill this same form later without changing the publish mechanism (`presby_publish_sasr_snapshot()`'s parameter list is unaffected either way). Tracked in `docs/TODO.md` as a named future reconciliation.

---
## DECISION-118: `presby_publish_sasr_snapshot()` takes NO organization-id parameter of any kind — it reads `presby_current_org()` to learn the publisher and derives the presbytery target from `organizations.parent_id`/`organization_type`, so there is nothing in its signature to spoof; every SASR aggregate is an individually named, range-validated parameter; a symmetric `presby_list_own_congregation_publications()` SECURITY DEFINER read function is added (not named by Phase 2) so a congregation can read its own published rows back for the "publication history" requirement without a bespoke cross-org RLS policy; the viability map's rendering approach is named (Leaflet) and explicitly GATED on an architect Phase 2 dependency addendum

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-presbytery-program` (Phase 3)

Turns the architect's Phase 2 Ruling 1 (SECURITY DEFINER function, parameter-list-as-allow-list, derived-never-asserted target) into a buildable shape. **First, the confused-deputy property is made stronger than "no caller-supplied target":** the function accepts no organization id at all, source or target — it reads `presby_current_org()` (already verified by `withOrgContext()`'s membership check before the function is ever called) to learn which congregation is publishing, then walks exactly one `parent_id` link and checks `organization_type = 'presbytery'`, raising on either a missing parent or a wrong type. **Second, the parameter list**, matching `congregation_statistics`'s column set 1:1 (report year, minute reference, then every SASR gain/loss/roll/demographic/disability/officer/baptism/youth/financial aggregate as its own named typed parameter) — every count validated non-negative and bounded inside the function itself (the trust boundary, not the calling action, per F26: an action-layer-only check would not survive a future second caller). **Third, a read counterpart the architect's ruling didn't explicitly name but the same mechanism family already covers:** Phase 1 asks for "publication history," and a congregation cannot otherwise read a row that now lives in its parent presbytery's tenant space (`congregation_statistics.organization_id` is the presbytery for every provenance, including published ones) — RLS's ordinary `tenant_isolation` policy filters it to zero rows from the congregation's own context. Rather than reopen a bespoke cross-org RLS policy (§17 reserves that shape for exactly two named cases, and DECISION-112 already declined a third), a second narrow SECURITY DEFINER function, `presby_list_own_congregation_publications()`, filters internally to `about_org_id = presby_current_org() AND provenance = 'published_by_congregation'` — the same "controlled read, not a policy" shape `presby_match_person()` already established. **Fourth, the viability map:** a dependency-free rendering was weighed first, per the operator's explicit instruction, and rejected as impractical for an arbitrary multi-congregation pin map — an inline SVG cannot generalize to arbitrary geography, and a static-tile `<img>` approach cannot place more than one marker without either a paid/keyed static-map API (which is not actually dependency-free, it trades an npm package for an external service contract) or client-side tile-stitching, which is fragile. `leaflet` is named as the right-sized dependency for the map slice only — small, no CDN required — but per the dependency rule this is **an architect Phase 2 addendum, and the map slice must not be implemented until that addendum is approved** and a tile provider is chosen (raw OpenStreetMap tiles disallow production use at scale per their own policy). The rest of Increment 4b (rollup dashboard, stat cards, vacant pulpits, per-capita) has no dependency on this gate and proceeds independently.

---
## DECISION-117: `PortalTile.domain` is a required, closed 7-value union (People & Membership / Worship & Events / Giving & Finance / Governance & Courts / Reports & Insights / Communications / Administration), orthogonal to `category`/`orgTypeScope`; the persistent nav's domain-anchor computation excludes the `administration` domain to avoid colliding with the pre-existing hardcoded "Administration" hub link; check-in/kiosk and public-calendar management fold into Events' own roadmap rather than becoming separate tiles, and per-capita/SASR + imports & reports collapse into one presbytery placeholder tile; "Give feedback" is removed from the tile/nav/footer registry mid-design and re-surfaces as an avatar-menu item plus the reused platform daily-feedback-prompt card

**Status:** Resolved · **Date:** 2026-08-27 · **Feature:** `2026-08-27-product-ia-scaffold` (Phase 3)

Five implementation calls turning the architect's Phase 2 rulings into a buildable shape. **First, the taxonomy itself:** `domain` joins `category`/`orgTypeScope` as a third orthogonal, presentation-only field on `PortalTile` — required (no optional/default variant), so a future tile omitting it fails at `tsc` rather than falling back silently, the same discipline the `organizationType` required-parameter bug fix already validated. It is never a gate (DECISION-003 reaffirmed): a tile's reachability is still governed entirely by `flagKey` + `orgTypeScope` + the destination's own permission check. **Second, and the real finding of this design pass:** an early draft would have assigned the `feedback` tile (an operate-category tile) to the `"administration"` domain, which — once the nav's domain-anchor computation existed — would have produced a SECOND nav entry labeled "Administration" pointing at `/o/<slug>#domain-administration`, colliding with the pre-existing hardcoded "Administration" entry that points at `/o/<slug>/admin`. Resolved by ruling the `administration` domain value out of the nav's anchor computation entirely (it exists only to bucket Roles/Features/Branding/Tickets on the admin hub's own domain grouping) — moot once `feedback` was separately removed from the tile registry altogether (see below), but the exclusion is kept as a standing rule, not deleted, because nothing structurally stops a future operate-category tile from repeating the same mistake. **Third, the fold decisions:** check-in/kiosk and public-calendar management do not become their own placeholder tiles — Phase 1's own functionality universe already frames them as increments 3–4 of the built Events feature, and a separate stub route would misleadingly imply a separate product; per-capita/SASR rollup and data imports & reports collapse into one presbytery-scoped placeholder tile (`reports`) rather than two, since both are the same class of back-office compliance work with no requirements signal differentiating them yet, while `insights` (universal analytics/dashboards) stays a separate tile because its audience and `orgTypeScope` genuinely differ. **Fourth, the anchor-matching fix:** `usePathname()` never carries a `#fragment`, so `portal-nav-links.tsx`'s `matchesEntry` must strip the fragment from `entry.href` before comparing, AND every anchor entry must be marked `exact: true` — without the second half, a stripped anchor href (e.g. `/o/<slug>`) becomes a prefix of every subpage in the org and would falsely read as "active" everywhere. **Fifth, a mid-design operator correction:** "Give feedback" is deleted from `PORTAL_TILES` entirely (not merely reassigned a domain) and re-surfaces as two independent, non-merged surfaces — an optional `feedbackHref` prop threaded through `GlobalNav`/`AvatarMenu` (linking to the existing org-scoped `/o/<slug>/feedback`) and the platform's existing dismissible daily feedback-prompt card (a genuinely different product, DECISION-070's `feedback`/`congregation_feedback` split unchanged) reused verbatim — moved to `src/components/shared/` — on the org portal home, gated by the same `org_portal.feedback` flag. A pre-existing, independent inconsistency was found in the course of this work (`/o/<slug>/feedback/page.tsx` still gates on `org_portal.tickets`, not `org_portal.feedback`) and is named in `docs/TODO.md` rather than fixed, per the operator's explicit "the route survives unchanged" instruction.

---
## DECISION-116: `credentials.manage` is one permission key, not an `ordinations.manage`/`appointments.manage` split; the presbytery-scoped Stated Clerk template gets its own key (`presbytery_stated_clerk`), never reusing the congregation `stated_clerk` literal; a transferring-in minister with no `people` row at the presbytery is blocked with guidance to the existing member-creation path, never an inline create; schema-first-then-full-stack is the implementer split

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-presbytery-functionality` (Phase 3, Increment 2)

Four implementation calls turning DECISION-112's architectural rulings into a buildable shape. **First, the permission split Phase 2 left open:** one `credentials.manage` key gates both the ordination-status UI and the appointments UI, not two. Both are the same constitutional duty (register-keeping, G-3.0304) exercised by the same office on the same page, and no scenario in this increment calls for a holder of one without the other — splitting would repeat the one-key-at-a-time accretion DECISION-101/106/110 already flag as a smell when two capabilities never actually diverge. Revisit if a future increment wants a read-only credentials viewer. **Second:** the new template role is keyed `presbytery_stated_clerk`, not the literal `stated_clerk` DECISION-112's own Phase 2 notes floated reusing across type-scopes. `app_roles`' `(organization_id, key)` uniqueness doesn't enforce distinctness across two `organization_id IS NULL` rows, so it would have been technically safe — but the congregation-scoped `stated_clerk` (Alder Creek, fixture-only, Tobias Renwick) and this new presbytery template carry entirely different permission sets today and may diverge further; a shared literal key invites a future reader of `app_roles` to assume one role definition where there are two. A distinct key costs nothing and removes the ambiguity outright. **Third, Phase 1's flagged undefined case (a transferring-in TE with no `people` row at the presbytery yet):** RULED blocked, not solved with an inline create. `recordOrdination()`/`recordAppointment()` both require a CURRENT `memberships` row at the org (the same F21 discipline every other write path in this codebase already applies — `startOfficerTerm`, `grantRole`), so an empty person-picker is the correct signal, not a bug: a minister must be received into presbytery membership (its own `roll_actions`/G-2.0402 event) before a credential can attach to them. The empty state names the actual next step ("add them via Members") rather than reading as a dead end; building a second, parallel person-creation surface inside the credentials form would duplicate `people.manage`'s validation and let a credential attach to a person outside the roll process, the same shape of shortcut F21's own discipline exists to refuse. **Fourth, the implementer split:** database-admin (schema + `test-rls.sql` §27) then full-stack-developer (server module, UI, actions, audit, flag/tile) — not a three-way api/ux split. This feature is one permission gate, one form-options query, and no client/server complexity that doesn't already fold into the `CredentialsResult` variant shapes the design specifies; the session's own precedent for features this size (`groups-and-officers`, `role-permissions-admin`) is schema-first-then-one-implementer, and a three-way split here would hand off two small, tightly coupled halves across two agents for no coordination benefit.

---
## DECISION-115: `events.manage` binds to no default role (follows `groups.manage`'s DECISION-110 precedent, not `stated_clerk`); series generation/extension is capped at 52 occurrences, counted against the series total; `parent_event_id` is a plain self-referential FK (no composite), the same-org property enforced entirely at the application layer; a new `org_portal.events` tile-visibility flag is required by the pre-existing tile-registry convention, distinct from DECISION-113's "no feature flag this increment"

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-events-model` (Phase 3, Increment 1+2)

Four implementation calls turning DECISION-113's architectural rulings into a buildable shape. **First, the permission binding:** `events.manage` gets no default role binding, applying DECISION-078's test directly — no PC(USA) office is the constitutional keeper of the congregation's calendar, the identical reasoning DECISION-110 used for `groups.manage` rather than folding one more capability onto `stated_clerk`, which DECISION-101/106/110 have already flagged as accumulating permissions one individually-justified addition at a time. Fixture-only grant to `stated_clerk` in `scripts/seed-dev.sql` for test reachability, explicitly commented as a convenience, not a production default — same posture as `groups.manage`'s own fixture comment. **Second, the recurrence bound:** Phase 2 named "recurrence generation bounds" as an open risk without specifying one; this pass sets a 52-occurrence cap (roughly a year of weekly events), enforced as a SERIES-TOTAL limit — `createEvent`'s initial count and `extendSeriesPattern`'s `existingCount + additionalCount` are both checked against it — not a per-call limit, so a series cannot be grown past the cap through repeated small extensions. **Third, `parent_event_id`'s exact shape:** per the architect's Phase 2 ruling that a composite self-FK is not expressible here without circularity, the column is a plain (non-composite) self-referential FK using Drizzle's explicit-return-type idiom (`(): AnyPgColumn => events.id`) rather than no FK at all — referential integrity to *some* `events` row is still enforced by the database, only the same-organization property is left to the application layer (`createEvent`'s children are copied from the just-inserted parent in the same transaction by construction; `extendSeriesPattern` re-loads the parent scoped to `(id, organizationId)` before generating anything). Flagged as an accepted, narrow deviation from Composite Tenant Keys, same class as `groupMemberships.officerTermId` (DECISION-060) — not silently accepted, named here and in the schema's own comment. **Fourth:** the portal-tile registry (`src/lib/org-portal/tiles.ts`) requires every entry to carry a `flagKey` with no optional variant — a new `org_portal.events` flag (seeded off) is added purely as the tile-visibility rollout lever, the same mechanism `org_portal.groups`/`org_portal.officers` already use for their own flag-less core features. This is orthogonal to, and does not reopen, DECISION-113's "no flag this increment" ruling, which concerned a feature-existence gate (the Increment-4 public-projection flag), not the pre-existing, unrelated tile-routing convention every other admin surface already opts into.

---
## DECISION-114: `src/lib/children.ts` is scoped to the children's-ministry guardian-linking use case only, not a general `person_relationships` module; `children.roster` holders see an unmasked `dateOfBirth` on the roster, bypassing both `person_privacy.directory_hidden` and `hide_birthday`

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-childrens-ministry` (Phase 3, Increment A)

Two implementation calls turning DECISION-111's rulings into a buildable shape. **First, module scope and name:** the new read/write surface for `person_relationships` (guardian-link CRUD) lives in `src/lib/children.ts`, not `person-relationships.ts` — deliberately narrower than the table it touches. `person_relationships` also models adult-to-adult relationships (`spouse`, `sibling`, `pastor`) that this pipeline has no requirement to expose and that DECISION-111 never authorized gating behind `children.roster`; naming the module after the table would invite a future caller to bolt an unrelated relationship type onto a permission that was minted specifically to keep a Sunday-school coordinator away from data they have no reason to hold. A future adult-relationships/emergency-contact feature gets its own module and its own permission, not an extension of this one. **Second, and the more consequential ruling:** `getChildrenRoster()` deliberately does not route through `directory.ts`'s `directoryEligibilityWhereSql()`/field-level `CASE WHEN` machinery, on two independent grounds. `person_privacy.directory_hidden` is not applied — a family that opted a child out of the public congregational directory should still appear on the internal children's-safety roster, the same "shown by role, not by directory privacy" reasoning `deriveDeaconsByOrgUnit()` already established for officers. More significantly, `person_privacy.hide_birthday` (default `true` for every person) is also not applied: `children.roster`'s entire purpose is computing and displaying age, which is impossible from a nulled birthday, so holding the permission is itself the authorization to see an unmasked `dateOfBirth` for anyone the roster's age-cutoff query returns. This is a narrow, single-purpose bypass of the directory's privacy layer — analogous to `person_medical`/`person_notes` already sitting entirely outside `person_privacy`'s reach — not a general weakening of `hide_birthday`, which continues to null the column for every other reader (`getDirectory()`, `getHouseholdDetail()`, `getPersonDetail()` are all unchanged).

---
## DECISION-113: `events` is one flat table with `parent_event_id` self-FK + stored pattern string (no RRULE, no template/instance split); coexists with, never subsumes, `organization_service_times`; occurrence times are wall-clock (no tz); the children's-ministry check-in contract is frozen to six columns (`id`, `organization_id`, `starts_at`, `ends_at`, `cancelled_at`, `allows_checkin`)

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-events-model` (Phase 2)

Architectural review of the events schema-first pipeline ruled on Phase 1's three framed tradeoffs plus the cross-pipeline check-in interface. **Recurrence:** fpcw-directory's proven flat-table shape is adopted as-is — discrete row per occurrence, `parent_event_id` self-FK, a stored convenience `recurrence_pattern` never parsed at read time, no RRULE, no template/instance split (reserved for worship-if-ever); pattern edits extend/regenerate the horizon and never rewrite a materialized row, mirroring the append-only spirit of `roll_actions` without being roll data — a discrete occurrence a check-in may already reference must not silently move under it. **Service-times boundary:** `organization_service_times` and `events` coexist with a bright line — the former is a dateless, forever-recurring weekly schedule feeding the public-site header only, and neither table ever writes to or generates rows in the other; the recurring Sunday service is deliberately NOT auto-materialized into `events`. **Timezone:** occurrence timestamps are wall-clock local (`timestamp` without time zone), not `timestamptz` — no org-timezone column exists anywhere in the schema (D6, US-only scope), and materializing each occurrence as a discrete row at generation time means a stored wall-clock value survives a DST transition with no extra machinery, unlike a pre-resolved UTC instant that would need an assumed IANA zone stored somewhere it doesn't live. `cancelled_at` is the one legitimate `timestamptz` column (an audit-style instant, not a schedule fact). **The check-in contract (cross-pipeline, frozen):** children's-ministry Increment C may depend on exactly `events.id`, `organization_id` (its own FK must be the composite `(event_id, organization_id)`), `starts_at`, `ends_at`, `cancelled_at`, and `allows_checkin` (adopted over fpcw's `is_drop_off` — generic enough to serve non-children check-in later), and no other column, without a joint re-review of both pipelines. **Also ruled:** `events.manage` is tier 1 and NOT a Rule-7 audited mutation (matching the `replaceOrganizationServiceTimes`/`setOrganizationProfile` precedent — content configuration, not an identity/access/security-control change); the public projection widens `presby_published_site()` in place (never a second function) behind a new `sites.public_events` flag, with the `is_public` filter enforced inside the SQL function's own WHERE clause — never an app-layer post-filter, so a Next.js-layer bug structurally cannot leak a members-only meeting through the public page; placement `/o/[slug]/admin/events` with portal-tile category `operate` (DECISION-105's routine-work test); no new dependency — fpcw's ~200-line vanilla recurrence math ports directly, no date/recurrence library warranted.

---
## DECISION-112: Pastoral appointments get a new presbytery-owned `appointments` table; `ordinations` gains a `status` column distinct from `endedOn`; presbytery-scoped constitutional role templates seed via the already-wired `organizationTypeScope`/`adoptTemplate` machinery; `credentials.manage` binds to a presbytery-scoped Stated Clerk template, not `executive_presbyter`

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-presbytery-functionality` (Phase 2, Increment 2)

Four rulings. **First, the appointments model:** a new `appointments` table (psvonline's shape with presby's composite-key discipline), NOT `role_grants` + new `app_roles` — a pastoral call is "does this person hold this ecclesiastical office at this congregation," and expressing it through the software-permission tables would be the identical conflation the officers pipeline named and refused (`officer_terms.office = 'clerk_of_session'` stays a data value, never an `app_roles.key`). Not `officer_terms` either — its derived-group-materialization trigger and session/diaconate semantics don't apply. The table lives in `src/lib/db/domain/officers.ts` (the third "who serves in what capacity" shape there), **owned by the presbytery** — forced structurally, not chosen stylistically: the composite person FK (`personId, organizationId → memberships`) that F2-safety requires can only resolve at the presbytery, since a minister's membership is at the presbytery per D1, exactly like `ordinations`' existing FK. `servingOrgId` references `organizations` directly (plain FK — legal because `organizations` is the one cross-tenant-readable structural table per §17). **The congregation-side read of a presbytery-owned appointment is explicitly deferred** to Increment 3/4's publication mechanism — NOT solved with a bespoke cross-org RLS policy (§17 reserves policy-based cross-org reads for exactly two named cases; a third would be new architectural surface). D9 makes this cheap to defer: most member congregations are unmanaged with no "other side" to read from anyway. **Second:** `ordinations` as it stands cannot express honorably-retired/on-leave — its `endedOn`/`endedReason` model true removal from ordered ministry only, and collapsing retirement into them would record a retired TE as no longer ordained, the exact error "Ordination Is Lifelong" exists to prevent. A new nullable `status` column (psvonline's credential-status enum as prior art: active/honorably_retired/on_leave/etc.), default active, distinct from the removal columns. **Third:** presbytery-scoped constitutional role templates seed via a hand-written migration inserting `organization_id IS NULL, organization_type_scope = 'presbytery'` template rows — the `listTemplateRoles`/`adoptTemplate` machinery (DECISION-109) is already wired end-to-end and filters by org type, so presbytery admins self-serve through the existing `/admin/roles/new` UI with no new backend or UI. Noted for Phase 3: `app_roles`' unique `(organization_id, key)` doesn't deduplicate two NULL-org rows sharing a key, so reusing the literal `stated_clerk` key across type scopes needs the type-filter verified, not assumed. **Fourth:** `credentials.manage` (tier 1 — who serves as pastor is register/public data, not tier-2/3) binds to the new presbytery-scoped Stated Clerk template per DECISION-078's test (recording ordination status and calls IS the clerk's register-keeping duty, G-3.0304) — deliberately not `executive_presbyter`, which is program leadership, not the register-keeping office; binding there would repeat the administratively-empowered-but-not-constitutionally-dutied mistake the test exists to catch.

---
## DECISION-111: `children.roster` binds to a new `children_ministry_admin` role, deliberately separate from `member_care_admin`; children are first-class `people` rows (no separate youth-registrations table); `person_relationships` stays global/`person_id`-keyed with application-level permission gating added for the first time

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-childrens-ministry` (Phase 2, Increment A)

Increment A (children's roster + staff-entered guardian linking) rulings. **First, the data model:** children are first-class `people` rows with `memberships` — the existing roll categories (`baptized_member`/`other_participant`) already cover them, `dateOfBirth`/`grade`/`school` already exist on `people`, and "is this a child" is a derived age-cutoff query, not a stored flag. No fpcw-style separate `youth_registrations` table (that shape was a single-tenant convenience, not a design to port). Nothing is missing on `people` for this increment. **Second, the permission:** a new tier-2 `children.roster` binds to a new constitutional, protected role `children_ministry_admin` — applying DECISION-078's constitutional-duty test (no PC(USA) office corresponds to "Sunday-school coordinator"; it's a staffing convenience, not a clerking or pastoral-care duty) and the DECISION-101/106/108/109 precedent of minting a dedicated role when no office fits. Kept deliberately separate from `member_care_admin`: Phase 1's own requirement — a roster-holder must not automatically see allergy/medical data — is only true if these are two different roles a congregation can grant to two different people. **Third, `person_relationships` isolation:** it is a global table (no `organization_id`, D1 pattern), RLS-gated only by the child's own membership visibility, mirroring `addresses`/`contact_methods` — correctly narrow at the DB layer, but zero application-level permission check exists on it today and zero application code reads or writes it. Increment A adds explicit `hasPermission()` gating (the `person-sensitive.ts` shape) on both read and write of guardian rows; RLS is tenancy, never authorization. Noted for Phase 3, not fixed in A: the INSERT policy checks `person_id` but nothing on `related_person_id` — a thin existence-oracle, not an F21-shaped data leak (the related person's own rows stay separately gated). **Fourth:** no schema change for off-system guardian phone numbers this increment — the UI defaults to linking existing `people` rows (which already carry `contactMethods`), free-text `relatedName` remains the fallback, and the missing-phone gap is explicitly deferred until check-in makes a dialable number operationally necessary. **Placement:** everything extends the existing `admin/members/` tree (a filtered roster view is fine; no parallel `/admin/children` data path), guardian-link management as its own co-located section following the `edit/sensitive/` precedent. New flag `org_portal.children_ministry`, seeded off. New audit keys for guardian-link mutations.

---
## DECISION-110: Groups administration — `groups.group_type_id` always resolves to the platform-wide (`organization_id IS NULL`) template row, matching `court`/`roster`'s existing pattern; the org-scoped `committee` `group_types` row in `scripts/seed-dev.sql` is unresolved fixture drift, not a per-org-custom-types feature (D8); `presby_reject_derived_group_write()` is widened to reject DELETE of a derived `group_memberships` row, and a new trigger on `groups` rejects direct edits to a derived group's name/description/meets_when

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-groups-admin` (Phase 2)

Four rulings turning Phase 1's gap list into architectural direction. **First, the data-model question:** the two candidate `group_types` rows for `committee` were traced via `git log -S` — `organization_id IS NULL` ("committee", platform-wide) was seeded in the very first schema commit alongside `court`/`roster`, clearly intended as a platform template exactly like them; the org-scoped duplicate at the presbytery was added later, bundled into an unrelated commit purely to satisfy one fixture, with no comment justifying why it didn't reference the platform row. There is no requirements signal for a real "per-org custom group types" feature, and `group_types` is a fixed 5-key taxonomy by design — building one would reopen the exact tenant-extensibility door D8 exists to keep closed. Ruling: every `groups.group_type_id` write resolves against the platform-wide template row, matching `createOrganization()`'s existing `court`/`roster` lookup exactly; `scripts/seed.ts`'s `seedGroupTypes()` is extended to also seed `committee`/`small_group`/`choir`/`team` platform-wide (the real production gap — today only `court`/`roster` exist outside fixtures), and the fixture's org-scoped duplicate is corrected to reference the platform row instead of diverging from it. **Second:** a single new `groups.manage` permission (module `groups`, tier 1) — no definition/assignment split the way `roles.manage`/`role_grants.manage` needed one, since `group_role` grants nothing and `group_types` isn't tenant-extensible. Fixture/seed-granted only, no default binding: applying DECISION-078's test directly, no PC(USA) office is *the* constitutional keeper of committee rosters, and `stated_clerk` already carries seven accumulated permissions per DECISION-106's own accounting — the exact drift that test exists to stop extending. **Third, the trigger gaps:** confirmed by direct read of `presby_reject_derived_group_write()` — its guard is false for a DELETE of an already-derived `group_memberships` row (only catches an UPDATE converting `source` away from `'derived'`), and no trigger at all exists on `groups` itself, so a direct `UPDATE groups SET name = ...` on a derived row (Session, Board of Deacons) goes completely unblocked today. Because "The Court Is Not a Group" is classified `trigger`, not `paper`, at `/developer`, leaving these as application-layer-only checks would let a `trigger`-class invariant quietly degrade — Phase 3 must design a migration widening the DELETE branch and adding a new `groups` UPDATE-rejection trigger, with SQL-layer regression tests, application-layer checks staying on as defense-in-depth rather than the sole enforcement. **Fourth:** no DB overlap constraint on `group_memberships` (unlike `officer_terms_no_overlap`'s GIST exclusion) — a duplicate committee-roster row carries none of officer terms' quorum/minute-validity stakes, so an app-level check-before-insert is proportionate; a DB exclusion constraint here would be disproportionate to the actual risk.

---
## DECISION-109: `roles.manage` binds to a new `role_admin` role (constitutional, protected, person-arm, fixture-bound to a fresh person, never Tobias Renwick or Marguerite Ashcombe); `app_roles`' RLS policy is split so template rows (`organization_id IS NULL`) become readable by every tenant for the first time; deactivating a role ends its live `role_grants` rows in the same transaction; the definition-side self-lockout guard is generalized from `revokeRole()`'s existing one

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-role-permissions-admin` (Phase 3)

Four implementation calls turning DECISION-106's architectural rulings into a buildable shape. **First, `role_admin`'s fixture binding:** person-arm, direct-granted, same reasoning DECISION-103 used for `brand_admin` (no polity body votes on "what does a committee role contain," so there's nothing for a group grant to represent) — but bound to neither existing multi-role fixture person (Tobias Renwick already holds `property_chair` + `stated_clerk`; Marguerite Ashcombe already holds `support_contact` + `brand_admin`), since a third role on either would recreate the exact "one person, every capability" concentration DECISION-103 flagged and declined to repeat for the second role alone. database-admin adds a fresh fixture person at Phase 4. **Second, and the largest finding of this design pass:** `app_roles` carries the standard loop-generated `tenant_isolation` policy (`organization_id = presby_current_org()`) from `drizzle/0009_presby_rls.sql`. For a template row `organization_id` is `NULL`, and `NULL = presby_current_org()` evaluates to `NULL` under every org context — the `organization_type_scope`/`organization_id IS NULL` template columns DECISION-100 called "dormant" are not merely unused, they are structurally unreadable by `presby_app` regardless of any application code, because RLS filters them out before any query runs. Flow 5b (template adoption) is unimplementable without fixing this, so the migration splits `app_roles`' single policy into a widened `SELECT` (`organization_id = presby_current_org() OR organization_id IS NULL`) and an unchanged `INSERT`/`UPDATE`/`DELETE` (`organization_id = presby_current_org()` only) — following `drizzle/0028_presby_people_write_rls_fix.sql`'s exact idempotent single-table-override pattern, not a rewrite of the shared loop. A tenant can now see the global template catalog but can never write an `organization_id IS NULL` row, mirroring `organizations`' existing "public tree, no tenant write" shape. **Third:** `presby_effective_permissions()` has no `deactivated_at` awareness, and Phase 2 declined to touch that SQL function for this feature. A `deactivated_at` column alone would therefore be cosmetic — a "deactivated" role would keep granting everything it carries to everyone who already holds it. `deactivateRole()` instead ends every currently-effective `role_grants` row pointing at the role (`ends_on = current_date`) in the SAME transaction as setting `deactivated_at`, reusing `revokeRole()`'s existing non-destructive "end, never delete" mechanism rather than teaching the resolver a new column. **Fourth:** a custom role can carry `roles.manage` the same as any other permission, so removing it (`setRolePermissions`) or deactivating a role that carries it (`deactivateRole`) can zero out an organization's `roles.manage` holders exactly the way revoking a `role_grants.manage` grant already can — `revokeRole()`'s finding-6 holder-count lockout guard is generalized to both new write paths rather than left asymmetric (grant-side guarded, definition-side not), closing the same class of gap Phase 1's central finding named for the escalation check.

---
## DECISION-108: Per-key DECISION-078 test applied to the four new sensitive-info permissions — `pastoral_notes.manage` binds to `installed_pastor` (retiring the orphaned `pastoral.notes.view`), `demographics.manage` binds to `stated_clerk`, `medical.manage`/`disabilities.manage` bind to a new `member_care_admin` role; write semantics fixed per table (insert-only / upsert / upsert / set-replace); `person_notes.visibility` enforced via an `ordinations`-derived clergy check

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-member-sensitive-info` (Phase 3)

Architect's Phase 2 left the per-key role binding, write semantics, and the `person_notes.visibility` enforcement mechanism to Phase 3, naming pastoral_notes/demographics as plausible-but-unverified candidates and ruling medical/disabilities settled (mint a new role). Running DECISION-078's actual test rather than assuming it: **`pastoral_notes.manage` → `installed_pastor`** passes cleanly — clergy confidentiality (`person_notes.visibility = 'clergy_only'`) *is* the pastoral relationship this office already names (DECISION-079's own reasoning, applied to the same table). This also surfaced a real, previously undetected gap: `pastoral.notes.view` — a tier-3 permission seeded only in `scripts/seed-dev.sql`, bound to `installed_pastor`, and never wired to any read/write path in the app — already existed for this exact table. Rather than run a second, overlapping key alongside the new `pastoral_notes.manage`, this pipeline retires `pastoral.notes.view` (never migration-seeded, so no production data depends on it) and supersedes it with the new key on the same office. **`demographics.manage` → `stated_clerk`** also passes: `docs/schema-design.md`'s own language ties SASR demographic/disability compilation to "clerks," and DECISION-078 already established SASR/register-keeping as the Clerk of Session's constitutional duty for `roll.propose`/`officers.manage` — demographics compilation is a direct extension, not a convenience binding. Neither binding needs a new `role_grants` row; both offices' existing fixture grants (Tobias Renwick, `stated_clerk`) carry the new permission for free.

**`medical.manage` and `disabilities.manage` → new role, `member_care_admin`.** Neither table has a constitutional analog — `person_medical` is operational children's-safety data (allergies, medications, pickup authorization) with no PC(USA) office correlate, and `person_disabilities` is the schema's own "sharpest edge": staff-observed, non-consensual, *per-person* data, distinct from the *aggregate* SASR disability count `stated_clerk` already touches via `demographics.manage`. Bundling exactly these two (not four) onto one role is judged not to reproduce "No Role Carries a Wildcard": both permissions share one coherent purpose (accountability for vulnerable-person safety/accommodation records), neither has any other constitutional claimant, and no role in the catalog holds more than two of the four new keys. `role_kind = 'constitutional'`, `is_protected = true` (mirrors `brand_admin`'s DECISION-101 shape: a baseline role every congregation should have available, not a staff-invented committee role), person-arm, direct-granted (mirrors `brand_admin`/`support_contact`: an ordinary single-accountable-office action with no polity vote behind it, so nothing for a group grant to represent). Fixture-bound to Aldous Fennimore (`c0000000-…-0007`) — an active, unburdened household head — rather than stacking a fifth capability onto any of the four fixture people who already hold at least one role.

**Write semantics**, read directly off each table's own shape rather than assumed uniform: `person_notes` (auto `id`, `createdAt`, no `updatedAt`) is **insert-only** — a log of care contacts, no edit/delete path in v1. `person_demographics` and `person_medical` (both `personId` as literal primary key, both carrying `updatedAt`/`$onUpdate`) are **upserts** — one row per person, `INSERT … ON CONFLICT (person_id) DO UPDATE`. `person_disabilities` (composite PK on `(personId, category)`, no `updatedAt` at all) is **set-replace** — delete every row for the person, then insert the submitted category set, in one transaction — the same "no history table, no concurrent-editor story, whole-list replace over per-row diff" reasoning DECISION-092 already established for `organization_service_times`/`organization_office_hours`.

**`person_notes.visibility` enforcement:** architect ruled the column is a second, finer filter beneath the table-level permission, not a fifth permission key. Implemented as a read-time predicate mirroring `directory.ts`'s `hide_email`/`hide_phone` CASE-WHEN shape, but on the inverse axis — the row's own tag gates the *reader*, not a person's own privacy opt-out. Any `pastoral_notes.manage` holder sees `staff`/`pastoral` rows; `clergy_only` rows are additionally gated on `exists (select 1 from ordinations where person_id = viewer and organization_id = org and ministry = 'minister_of_word_and_sacrament' and ended_on is null)` — the same lifelong-ordination signal "Ordination is lifelong; service is termed" already establishes as authoritative elsewhere in the schema. Failing rows are omitted from the result set entirely, not nulled-in-place — a list has no honest placeholder for "a note you can't read exists here." Because `pastoral_notes.manage` binds only to `installed_pastor` (always ordained) in this pipeline, the filter is a no-op today; it exists for the day a non-clergy holder is ever bound to the same key.

---
## DECISION-107: Edit-time roll-action recording is gated on `roll.propose` alone (not `people.manage`); ships behind a new dedicated flag reusing `org_portal.members_create`'s existing org toggle; F19 is scoped out via the mechanical rule "kind allow-listed only if `resulting_roll` is non-null," correcting Phase 2's own contradictory `certificate_dismissed` note

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-member-roll-on-edit` (Phase 3)

Three implementation calls made turning Phase 2's ruling into a concrete design. **First, permission scope:** `recordRollAction()` checks `roll.propose` only, not `people.manage` — Phase 1 assumed both (mirroring `createPerson()`, which also writes `people`/`addresses`/`contact_methods` and genuinely needs `people.manage`). This function touches only `roll_actions` against an already-existing person, so requiring `people.manage` would incorrectly block a clerk who holds `roll.propose` without it — the same reasoning Phase 2 already used in the opposite direction for `updatePerson()` (gated on `people.manage` alone, deliberately not `roll.propose`). **Second, flag design:** a new global `org_portal.members_roll_action_edit` flag (seeded off, checked bare — a toggle, not an auth path) gates the new form, but no new per-org toggle is added; it composes with `org_portal.members_create`'s existing organization-feature-toggle row rather than asking a church to flip a second checkbox for what reads, to them, as one more capability of a screen they already opted into. This gives the platform an independent kill switch (worth the one extra flag given `roll_actions` is append-only) without a second per-org opt-in surface. **Third, F19 scope:** rather than enumerate "termination-shaped kinds" by hand (Phase 2's own notes did this twice and produced two different, contradictory lists — one excluding `certificate_dismissed`, the shorthand in Note 1 including it as safe), the edit-time allow-list is defined mechanically as every `roll_action_kind` whose `resulting_roll` is non-null (a pure roll-gain or roll-enrollment). No kind that only *adds* to a roll can ever need `officer_terms`/`role_grants`/`group_memberships` to change, so F19's gap cannot be reached through this list regardless of which kinds get added to the enum later — `certificate_dismissed` is correctly excluded (it nulls `resulting_roll`, exactly like `death`), resolving the contradiction in the stricter direction. The termination trigger itself (`terminate_person_participation()`) is not built here — filed to `docs/TODO.md` as its own dated `database-admin` pipeline — and `docs/schema-design.md`'s F19 status is corrected from "Applied §8" to "Open" in the same commit as this design.

---
## DECISION-106: New `roles.manage` permission (distinct from `role_grants.manage`) binds to a new `role_admin` role, not `stated_clerk`; the escalation subset-check is extracted from `grantRole()` into a shared `assertPermissionSubset()` in `src/lib/authz.ts` so role-definition edits get the same posture as role-grants; role deletion is soft-deactivate only, gated on `isProtected` (not `role_kind`)

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-role-permissions-admin` (Phase 2)

Five rulings made turning Phase 1's gap list into architectural direction. **First, the escalation gap (the load-bearing item):** `grantRole()`'s subset check only fires when a NEW `role_grants` row is inserted — nothing today stops a `roles.manage` holder from editing a role they already hold to add a tier-3 permission to it, no new grant event, no `escalation_denied`, instant self-escalation on save. Ruling: extract `grantRole()`'s inline subset check into a shared `assertPermissionSubset(tx, actorPersonId, organizationId, proposedPermissionKeys)` in `src/lib/authz.ts`. `grantRole()` keeps calling it with the target role's full `app_role_permissions` set (unchanged); the new `role-definitions.ts` module's `setRolePermissions()` calls it with only the **added delta** (`newKeys − oldKeys`), never the full resulting set — removing a permission can never escalate anyone, and requiring the editor to already hold every permission a legacy custom role currently carries would block legitimate removals. **Second:** a new `roles.manage` permission (module `authz`, tier 1), distinct from `role_grants.manage` — assignment ("who holds this role") and definition ("what this role contains") are different-risk capabilities; collapsing them would silently hand every `role_grants.manage` holder role-definition power with no individual review, the same one-permission-at-a-time accretion DECISION-101 named for `branding.manage`. **Third:** `roles.manage` does NOT bind to `stated_clerk` — applying DECISION-078's constitutional-duty test directly, "defining what roles/permissions exist in this organization" is not the Clerk of Session's constitutional office (register-keeping), and `stated_clerk` already carries seven accumulated permissions, the exact drift DECISION-101 refused to extend further. A new constitutional, protected role (`role_admin`, shaped like `brand_admin`) holds it instead — not implicitly coupled to whoever holds `role_grants.manage` either, since that binding on `stated_clerk` is a pre-DECISION-080 bootstrap artifact, not a precedent to extend. This reopens the founding-administrator bootstrap gap DECISION-100/101 already deferred to the queued P2 (backbone and onboarding) pipeline — not this pipeline's to close. **Fourth:** role deletion through this UI is soft-deactivate only (a new nullable `appRoles.deactivatedAt` column) — `role_grants.roleId → appRoles.id` is `onDelete: cascade` today, and even gating a hard DELETE on "zero active grants" would still let cascade destroy *ended* (historical) `role_grants` rows, the append-only trail `revokeRole()`'s own contract protects. The FK's `onDelete: cascade` is flagged as a standing latent risk independent of this feature (`docs/TODO.md`), not fixed here. **Fifth:** create/edit/deactivate gate on `appRoles.isProtected` (the column the schema was actually built to gate mutation on), not `role_kind` (a descriptive label that currently correlates but isn't the invariant-bearing column) — `isProtected = true` roles stay fully read-only through this UI regardless of kind.

---
## DECISION-105: Operator correction, same day — `members`/`officers` move back to `category: "operate"` (routine congregational work, not org setup) and `tickets` moves to `"administer"`; the `tile` Button variant's full-bleed `bg-primary` fill is replaced with a `bg-card` + border + shadow elevation treatment, brand color pushed down to a small icon badge

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-portal-reorg-and-modernization` / `2026-08-26-portal-visual-modernization` (post-ship correction, before commit)

Two direct operator corrections landed against DECISION-104's work before it was committed. **First, categorization:** the operator's read on "main portal = functionality for the org, org admin = setting up this org" placed `members` (adding a person, recording roll actions) and `officers` (recording officer terms) on the wrong side — these are done routinely, by the same people, as ordinary congregational work, not org setup, so both move `administer` → `operate` and show on the home tile grid and top-level nav again. `tickets` moves the other way, `operate` → `administer` — filing a platform-support ticket is closer to administering the org's relationship with the platform than day-to-day ministry. `roles`, `features`, and `branding` are unchanged (all three are genuinely "set this org up" tasks). `visiblePortalTiles()`'s contract (flag-then-category, no permission check, DECISION-003) is untouched — only which tiles carry which category value changed. **Second, visual:** the operator flagged DECISION-104's full-bleed solid `bg-primary` tile fill as flat and unpleasant to look at, not the "modern, bolder, more depth" the visual-modernization brief asked for. The `tile` Button variant now renders a `bg-card` surface with a border and `shadow-sm`, deepening to `shadow-lg` with a slight `-translate-y-0.5` lift on hover (`hover:border-primary/40` too) — depth communicated by elevation rather than a saturated fill. The brand color didn't disappear from the tile: it moved to a small `bg-primary/10 text-primary` badge behind the tile's icon, so `--primary` still reads on every tile (and still cascades per DECISION-046) without painting the whole card. The trailing chevron now nudges on hover (`group-hover:translate-x-0.5`) as the replacement motion cue, still unflagged per DECISION-104's own reasoning (a hover-triggered CSS transition, not an autonomous load-triggered animation — same category as the already-unflagged `PersonCard`/`HouseholdCard`/`DeaconCard` hover-shadow, DECISION-099). A follow-up operator note asked for rounder card corners; `tile` now carries `rounded-xl` over the base variant's `rounded-md`. As a side effect, the explicit `p-5` the card layout needed for the new content (icon badge, heading, description) also closes the pre-existing "tile renders 0px vertical padding" gap (`docs/TODO.md`, `size="lg"` carries no `py-*` utility) — no separate fix was needed.

---
## DECISION-104: Portal-modernization bold color blocks route through `bg-primary`/`text-primary-foreground` (never `bg-brand-raw`); the tile-grid CTA treatment becomes a new `Button` `variant="tile"`; only the greeting band's mount fade-in is flagged (`org_portal.motion`), hover-triggered transitions are not

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-portal-visual-modernization` (Phase 3)

Three implementation calls made while turning DECISION-102's Phase 2 ruling into a concrete design. **First:** `contract.ts` classifies `--brand-raw`/`--brand-raw-foreground` as `additive` — declared only by `<BrandTokens>` for an org with a configured brand row, never in `globals.css`'s platform-default `:root`, and `globals.css`'s `@theme inline` block has no `--color-brand-raw` mapping yet either. A brand-new tenant with no brand row (`orgBrand === null`) would render an undefined custom property. `--primary`/`--primary-foreground` have no such gap (declared unconditionally in both `:root` and `.dark`, already Tailwind-mapped), so every bold surface in this pass (`Greeting`'s band, `TileGrid`'s tiles) uses `bg-primary`/`text-primary-foreground`, not the more literally "raw seed" token the reference site's full-bleed fills might otherwise suggest. Wiring `--color-brand-raw` into Tailwind for a genuinely unbounded decorative surface is left for a future pass that actually needs it. **Second:** the tile grid's bold CTA treatment becomes a new `buttonVariants` entry (`tile`) in `button.tsx` — documented as divergence #4 in that file's existing house-style header — rather than a one-off `className` string, per Component Rule 5/C2; the layout properties it needs (`flex-col`, `h-auto`, `text-left`) are additive to `default`'s already-correct `bg-primary`/`text-primary-foreground` fill. **Third:** only the greeting band's CSS mount fade-in is gated behind the new `org_portal.motion` flag (seeded off) — it is the one autonomous, load-triggered animation in this pass, matching Phase 1's own named risk category (an animation that could fail to become visible). The new `hover:brightness-105` on tile tiles and the `border-primary` active-nav accent are hover/state-triggered CSS transitions, the same category as the already-shipped, unflagged `hover:shadow-md` on `PersonCard`/`HouseholdCard`/`DeaconCard` (DECISION-099) — not flagged, for consistency with that precedent.

---
## DECISION-103: `brand_admin` binds person-arm (direct-granted to Marguerite Ashcombe in the fixture), not group-arm; the tenant brand-set action combines the `(slug, input)` and FormData server-action conventions; a tenant-set brand change cannot revalidate a live public site's cache

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-tenant-branding-permission` (Phase 3)

DECISION-101/Phase 2 minted `brand_admin` but left the `role_grants` binding arm (person vs. group) to Phase 3, since no ecclesiastical office dictates the shape the way it did for `officers.manage`. Person-arm, direct-granted, following `stated_clerk`/`treasurer`/`installed_pastor`/`support_contact`'s precedent rather than `member`/`session_member`/`diaconate_member`'s group-arm one: branding is an ordinary single-accountable-office action (one person picks a colour, uploads a file) with no polity body whose *vote* approves the change, so there is nothing for a group grant to represent. Fixture-bound directly to Marguerite Ashcombe (`c0000000-…-000001`), not Tobias Renwick — he already holds `property_chair` + `stated_clerk`, and a third role on one fixture person would recreate the "one person, every capability" concentration `support_contact`'s own binding (DECISION-080) was written to interrupt; Marguerite already holds `support_contact`, and a second external-facing/administrative office on the same person is an ordinary pairing, not a wildcard accretion onto one already-overloaded office.

The new tenant action, `setOrgBrandAction(slug, formData)`, deliberately combines two conventions rather than inventing a third: every other `(org)` action in this tree takes `(slug, input: object)` (no file upload exists on any of those paths); the platform's own brand action takes raw `FormData` (for its file input) with no `slug`/org-identity parameter at all (it authorizes via a platform feature flag, not tenant membership). This is the first tenant action with a file input, so it keeps `slug` as a trusted, server-bound first argument (never trusting organization identity from client data, per every other tenant action's discipline) and takes `FormData` as the second argument (for the logo file). Documented so a future reviewer doesn't read the divergence as an inconsistency.

A tenant-set brand change cannot invalidate a live public site's cached render the way the platform action's `revalidateLiveSitePath()` does: `(org)` route handlers run exclusively on the RLS-enforced `presby_app` connection, `organization_sites` carries no `presby_app` grant at all (DECISION-081), and `getPlatformDb()` is forbidden in the `(org)` subtree by its own contract. A congregation that rebrands through the new tenant path may see its public site's colours go stale until the next content ingest or until an operator re-saves through the platform form. Named and deferred, tracked in `docs/TODO.md`, not solved by this pipeline — the same "surfaced, not fixed" posture `role-grants.ts`'s own finding 4 established for the arm-1 cascade gap.

---
## DECISION-102: Portal visual-modernization pass scopes to `(org)` only, no new dependency, `TYPE_SCALE` adoption scopes to files this pipeline touches, every bolder color/shadow treatment routes through the existing brand-token cascade

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-portal-visual-modernization` (Phase 2)

Portal visual-modernization pass scopes to `(org)` only (not `(account)`/`(member)`, which stay platform-chrome per DECISION-047 — extending a bolder/motion-forward pass to platform-chrome pages every organization sees identically is a different, unscoped ask needing its own Phase 1 if wanted later). No new npm dependency — motion is achieved with Tailwind transitions/CSS and `prefers-reduced-motion`, not a library, since the existing stack already solves it (a motion library fails the Dependency Evaluation Criteria's "already solved by an existing dependency" test before any bundle-size question is reached). `TYPE_SCALE` adoption scopes to the portal-chrome files this pipeline touches, not the full ~432/105-site (`text-sm`/`text-xs`) codebase migration the original request's stale figures implied. Every bolder color/shadow treatment must route through the existing brand-token custom properties (`bg-primary`/`bg-accent`-family utilities, DECISION-046), never a hardcoded value that would bypass a congregation's own brand override. Boldness belongs on chrome/CTAs/headings, never body text or information density, given the codebase's own `MIN_MEMBER_FACING_PX`/legibility-first stance and the operator's own "not overwhelming" qualifier. `prefers-reduced-motion` is a hard requirement, not a nice-to-have, given this repo's documented history of motion-adjacent bugs invisible to `curl`/`tsc`/`next build`.

---
## DECISION-101: Tenant-facing branding management does not implicate "Two Hierarchies Intersect Nowhere"; binds to a new `brand_admin` role, not `stated_clerk`; neutralize and the platform brand form both stay platform-only/live

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-tenant-branding-permission` (Phase 2)

Tenant-facing branding management (`branding.manage`, new `brand_admin` role) does not implicate "Two Hierarchies Intersect Nowhere" — that invariant polices ecclesiastical/cross-tenant reach (one tier or one tenant reaching into another's data), not a congregation managing its own `organization_brands` row, which its own RLS policy (`organization_id = presby_current_org()`) already makes structurally impossible to escape regardless of who holds the permission. The correct invariants to check this move against are Permissions vs. Flags and No Role Carries a Wildcard, both of which it passes: a new, narrowly-scoped tenant permission, not a platform grant leaking down. `organization_brands`/`organization_brand_history`'s RLS/grant shape was already provisioned for exactly this tenant path in `drizzle/0016` (its own comment names "slice d's withOrgContext()-based editor" by name) — no schema change is needed.

`branding.manage` does **not** bind to `stated_clerk` — DECISION-078's constitutional-duty test fails it (choosing a seed color and uploading a logo has no constitutional analog), and the office already carries six other permissions accumulated one individually-justified addition at a time, which is exactly how a role becomes a wildcard "one layer down" without anyone deciding it should. A new `brand_admin` role is minted instead (constitutional/protected shape, mirroring `member`'s baseline-role precedent; person-arm vs. group-arm `role_grants` binding left to Phase 3, since no single ecclesiastical office dictates the shape here the way it did for `officers.manage`). "Neutralize" (remediation against an abusive tenant's brand) stays platform-only — a tenant admin already has the equivalent via "set." The platform `/admin/organizations/[id]` brand form stays live as an override/break-glass path, not retired — it's the only path that can act when the tenant path is unreachable (suspended org, flag off, or an org with zero `brand_admin` holders — the same founding-administrator bootstrap gap DECISION-100 already named and deferred, not this pipeline's to close either). New audit key `TENANT_BRAND_SET` (`"tenant.brand.set"`), distinct from the existing platform-actor `ORG_BRAND_SET`, per the established `org.*`-vs-`tenant.*` actor-axis convention already used by `ORG_FEATURE_TOGGLED`/`OFFICER_TERM_STARTED` and their platform-actor counterparts.

---
## DECISION-100: `createOrganization()`'s baseline-role seed closes only the `member`/`directory.view`/Active-Membership half, using `role_grants`' group arm in the same transaction as the F16 group seed; the `stated_clerk`-equivalent "founding administrator" bootstrap is deferred wholesale to the queued P2 (backbone and onboarding), not built as a narrow platform-admin escape hatch; `app_roles.organizationTypeScope`'s dormant template columns stay unwired, extending `groupSeedPlan()`'s inline-plan precedent instead

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-org-provisioning-baseline-roles` (Phase 2)

Two calls left open by the `2026-08-26-groups-and-officers` Phase 1 split. **First:** `role_grants`' FK is two-armed (`personId` XOR `groupId`, `role_grants_principal_check`) — the group arm's FK (`groups(id, organization_id)`) is satisfiable inside `createOrganization()`'s own transaction because the `active_membership` group is inserted two statements earlier (F16); the person arm's FK (`role_grants_person_fk` → `memberships(person_id, organization_id)`) is not, since a freshly-created org has no people yet. This makes "seed the `member` role, granted to the `active_membership` group" fully closeable now, with zero schema change and zero new permission — it was never actually FK-blocked, only the person-granted half was. **Second:** the analyst's proposed alternative to full deferral — a narrow platform-admin "grant the first tenant role" action on `/admin/organizations/[id]`, usable when an org has zero `role_grants.manage` holders, naming an already-existing person+membership — does not survive tracing: `/o/[slug]/admin/members` (the only in-app path to create a person+membership) is itself gated on `people.manage`, which nobody holds at a genuinely fresh org either. The premise "naming an already-existing person" has no referent for the case the hatch is meant to fix; building it would mean either shipping a hatch that doesn't close the real gap, or quietly also building person/membership creation inside it — which is P2 (backbone and onboarding)'s scope, already queued in `docs/STATE.md`, not a side door. The founding-administrator bootstrap (role AND the person/membership creation it depends on) is deferred there in full. **Third:** `app_roles.organizationTypeScope`/`organizationId IS NULL` template columns (dormant since their introduction, unused by F16's own group seed) stay dormant here too — the baseline role being seeded (`member`→`directory.view`) has no organization-type variance for the templating mechanism to serve; wiring a generic resolver to a plan with zero branches is premature abstraction. `groupSeedPlan()`'s inline-conditional shape is extended with a sibling `baselineRoleSeedPlan()`, ready to branch the day a type-varying baseline role is proposed for real.

---
## DECISION-099: Portal card hover treatment ports fpcw-directory's shadow-lift only, never its whole-card `cursor-pointer` or a full-card accent flood, on cards with more than one link target

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-portal-fpcw-directory-ux`

fpcw-directory's `member-card.tsx` applies `hover:shadow-md transition-shadow cursor-pointer` to a card that is ONE whole clickable `<a>`. presby's `PersonCard`/`HouseholdCard` are not single-link cards — each holds a name `<Link>`, independent `mailto:`/`tel:` links, and plain text — so copying `cursor-pointer` onto the outer `<Card>` would tell a mouse hovering over inert whitespace or a phone number that the whole card is one click target, which it is not. `person-card.tsx`/`household-card.tsx` get `hover:shadow-md transition-shadow` only; `tile-grid.tsx` (a genuine single-link-per-tile card, already carrying `hover:bg-accent hover:text-accent-foreground`) gets both the pre-existing color-shift and the new shadow-lift, matching fpcw's fuller treatment where the card shape actually matches. `deacon-card.tsx` — no link at all — gets the shadow-lift purely for visual-family consistency with the two cards it always renders beside, with no cursor or interactive-role change; this is the one card in the four-file diff where the treatment is cosmetic rather than an affordance. Revisit if any of these cards is ever restructured into a single whole-card link (at which point `cursor-pointer` becomes honest again).

---
## DECISION-098: `getOrgProfileForFooter` is membership-verified and `cache()`-wrapped like `getOrgBrandForLayout`, but its rollout flag is checked by the CALLER, not internally — mirroring `getOrgMarkForLayout`, not its own sibling

**Status:** Resolved · **Date:** 2026-08-26 · **Feature:** `2026-08-26-portal-fpcw-directory-ux`

`src/lib/sites.ts` gains a fifth caller shape for `organization_profiles`: a genuine tenant-member read (`getOrgProfileForFooter(organizationId, personId)`, address/phone only — the five social-link columns are out of scope for this pass, a pure future widening of the same `select`). It is structurally identical to `getOrgMarkForLayout()` (`src/lib/brand/read-org-brand.ts`): `withOrgContext()`-based, `cache()`-wrapped, `OrgAccessError` collapses to `null`, no row collapses to `null`. Where it diverges from that file's OTHER export, `getOrgBrandForLayout()`, is the flag check: `getOrgBrandForLayout` checks `ui.brand_theming` internally, because that flag is a property of whether branding should ever render, independent of caller. `org_portal.chrome_v3` is a rollout/rollback lever over a specific chrome feature's existence, the same role `org_portal.chrome_v2` already plays for `getOrgMarkForLayout` — and `getOrgMarkForLayout` does NOT check its flag internally; `(org)/o/[slug]/layout.tsx` does, because it is the one place both flags are read together. `getOrgProfileForFooter` follows that precedent, not `getOrgBrandForLayout`'s. Tradeoff named: a future direct caller of `getOrgProfileForFooter` that skips the flag check gets live data regardless of rollout state — a paper contract, not database- or trigger-enforced, same class as several `/developer`-marked invariants already are. Revisit if a second caller ever needs this reader outside `layout.tsx`'s own gate.

---
## DECISION-097: Per-org feature enablement is a third gating axis — `organization_feature_toggles`, composing with (never replacing) the global `feature_flags` kill switch and per-user permissions

**Status:** Resolved · **Date:** 2026-08-25 · **Feature:** `2026-08-25-member-management`

Direct mid-pipeline user requirement: congregations and presbyteries want different feature sets, and every feature needs to be individually toggleable by an org's own admin, not just globally. Before this decision, gating had two axes only — `feature_flags` (platform-wide, no `organization_id` at all) and per-user `permissions`/`role_grants` (who, within an entitled org, may act). Neither let one specific organization opt a feature on/off independent of other orgs of the same type. A JSONB key on `organizationSettings` was rejected — that column holds configuration facts (`hasDeacons`, etc.), not access-control state, and stuffing a toggle catalog into an untyped blob would set the wrong precedent for the very next feature. New table `organization_feature_toggles` (`organization_id`, `feature_key` — same string as the matching `feature_flags` key, `enabled boolean default false`, `updated_at`, `updated_by`), resolver `isOrgFeatureEnabled()` in `src/lib/org-features.ts` mirroring `flags.ts`'s `cache()` shape. Gate order for every `org_portal.*`-style feature: `isFlagEnabled` (deploy-time rollback lever) → `isOrgFeatureEnabled` (does this org have it) → the permission check (who may act) — DECISION-003 ("two mechanisms, never merged") is extended to three named, bounded axes, not violated. Org-type-aware defaults (a presbytery defaulting differently than a congregation) are explicitly deferred until a second feature key demonstrates the need; a future `organization_type_feature_defaults` table would mirror `app_roles.organizationTypeScope`'s existing template/override precedent. Admin surface is `/o/[slug]/admin/features` — the congregation's own tenant admin, not the platform operator's `/admin/organizations/[id]`.

---
## DECISION-096: Adds `react-hook-form` + `zod` (+ `@hookform/resolvers`) as dependencies; `src/lib/people.ts`/`src/lib/roll.ts` are the write-side domain modules for the roll; the member-creation wizard and approval worklist live at `/o/[slug]/admin/members`, not `/directory`

**Status:** Resolved · **Date:** 2026-08-25 · **Feature:** `2026-08-25-member-management`

First real writer to `people`/`roll_actions`/`memberships`. Placement: `/admin/roles` is the existing precedent for a permission-gated tenant write surface living apart from the broad-read `directory.view` tree (which has zero writers by design) — `/admin/members` mirrors it, keeping a narrower-permission route out of a tree whose whole shape implies open read access. `src/lib/people.ts` mirrors `directory.ts`'s shape (one file, `withOrgContext`, thin wrappers over `presby_match_person`/`presby_link_person`); `src/lib/roll.ts` is a sibling, not folded in, mirroring the existing `db/domain/people.ts` vs `db/domain/roll.ts` split and keeping the append-only/immutable-on-approval invariant's code in one place as roll-action kinds grow. `react-hook-form`+`zod` cross the architect-approval threshold `docs/ui-standards.md` sets (>4 fields) for the wizard's cross-step, Back-lossless client state — evaluated against the standard dependency criteria and approved; `@hookform/resolvers` is RHF's own small zod-integration glue, a corollary of the same approval. `roll_action.approved`/`denied` get `AUDIT_ACTIONS` entries — a roll action outranks a role grant in constitutional weight. Same-actor propose/approve is permitted by design (no invariant addresses it; the UI surfaces a "you proposed this" badge instead of blocking).

---
## DECISION-095: A household's deacon is derived from `officer_terms.org_unit_id` (nullable, `CHECK (org_unit_id is null or office = 'deacon')`, composite FK to `org_units`), not a hand-editable FK on `households`/`org_units`; `directory.view_hidden` binds to a new `diaconate_member` role (granted to the derived Board of Deacons group) and, as the "Church Administrator" stand-in, directly to `stated_clerk`

**Status:** Resolved · **Date:** 2026-08-24 · **Feature:** `2026-08-24-portal-home-directory` (Phase 4, Increment 4a)

Phase 2 (architect) rejected two shapes before landing on this one: a plain `org_units.deacon_person_id` repeats F15's `shepherd_person_id` mistake (a hand-editable FK that can point at a non-deacon, with no dates); a new `care_assignments` table duplicates state `officer_terms` already owns and creates a second place service-dates can drift from the term. `officer_terms.org_unit_id` makes a household's deacon a pure derivation (`office = 'deacon' and org_unit_id = ... and ends_on is null`) — dates authoritative, nothing to fall out of sync, and F2's composite-tenant-key discipline (mirroring `memberships.orgUnitId`) prevents a term at one org from scoping to another org's district. `directory.view_hidden`'s permission-catalog row is migration-seeded (`drizzle/0025_presby_deacon_linkage.sql`, following 0017/0018's precedent); its `app_roles`/`app_role_permissions`/`role_grants` bindings are fixture-only in `scripts/seed-dev.sql` (same reasoning as `stated_clerk`, DECISION-066 — no production role-seeding surface exists yet). The Phase 1 analyst's recommended binding named "Church Administrator," which does not exist in the role catalog (`src/lib/db/domain/authz.ts`'s own comment names it aspirationally) — `stated_clerk` is the closest existing office, already holding `role_grants.manage`, and gets `directory.view_hidden` added to its existing grant rather than minting a new role for a binding this pipeline didn't ask to invent.

---
## DECISION-094: Amends DECISION-047 — brand emission reaches `(org)/o/[slug]/layout.tsx`, `(public)/site/[slug]/layout.tsx`, and `(auth)/signin/page.tsx`, three specific files, not route groups; `/totp`, `/forgot-password`, and `/reset-password` stay platform-chrome

**Status:** Resolved · **Date:** 2026-08-24 · **Feature:** `2026-08-24-branded-signin` (Phase 2)

DECISION-047 scoped per-org branding to exactly two route groups, `(org)/o/[slug]` and `(public)/site/[slug]`, to keep the "which surfaces can reveal a configured tenant's brand" question closed and machine-checkable. This feature adds a third, narrower exception: `/signin`, reached via `?callbackUrl=/o/<slug>/...` from a congregation's own live public site, shows that congregation's logo, colors, and fonts around the unchanged Google/credentials form. The exception is a single **page**, not a route group — `(auth)` also hosts `/totp`, `/forgot-password`, and `/reset-password`, and a `(auth)/layout.tsx` cannot see which child page is rendering (the same reason the `(org)` contract puts its own auth check in the page, not the layout, per CLAUDE.md), so a layout-scoped emitter would either brand all four pages (out of scope) or need a fragile page-to-layout signal. Those three pages remain platform-chrome in this increment — a branded `/signin` → platform-chrome `/totp` flash mid-flow is accepted, not fixed here. The tenant-enumeration concern DECISION-047 exists to police is resolved by gating the brand read on "this org already runs a live `/site/<slug>`" (`getPublishedSiteBrand()`, `src/lib/sites.ts`, the fourth caller-shape-1 sibling — runs the identical `presby_published_site()` query and enumeration-safe collapse `getPublishedSite()`/`resolvePublishedOrganization()` already use), so `/signin`'s brand is a cosmetic mirror of information the org already publishes anonymously, never a new oracle. `scripts/check-brand-scope.mjs`'s `EMITTERS` allowlist gets its third entry, `{ path: "src/app/(auth)/signin/page.tsx", required: true }`, set to `required: true` in the same commit as the emission itself.

---
## DECISION-093: A fourth curated type pairing — `contemporary` (Montserrat / Open Sans) — widens `organization_brands_type_pairing_allowed` in `drizzle/0022_presby_brand_pairing_expansion.sql`; the mood-name convention is preserved (label is the mood word, family names live only in `why`)

**Status:** Resolved · **Date:** 2026-08-24 · **Feature:** `2026-08-24-custom-brand-fonts` (Phase 3)

FPCW's real site uses Montserrat (headings/buttons) + Open Sans (body) exactly, confirmed from the live site's compiled stylesheet — branch (a) from Phase 1 (a fourth curated, self-hosted pairing through the existing `next/font/google` mechanism) was chosen over branch (b) (open font selection for any admin), which the user explicitly ruled out of scope, preserving A8's "no runtime request to Google Fonts ever leaves a member's browser" guarantee untouched. `contemporary` was chosen over the other Phase 2 candidate, `civic`, because `civic` register is already claimed by the `modern` pairing's own `why` text (Public Sans, "engineered by the U.S. government") — reusing it here would restate an existing pairing's story rather than describe this one. Same widen-the-shared-CHECK precedent as `blob_assets_content_type_allowed` (DECISION-088 and its predecessor): one curated set, one CHECK, widened by migration, never silently.

---
## DECISION-092: `presby_published_site()` returns service times and office hours as two separately-aggregated `jsonb` arrays (`service_times`, `office_hours`), not one `kind`-tagged array; the admin editor replaces a kind's entire row set on save rather than diffing individual rows

**Status:** Resolved · **Date:** 2026-08-21 · **Feature:** `2026-08-21-public-site-org-profile` (Phase 3)

Two related shape calls the architect left open for Phase 3. Read side: filtering by `kind` inside the SQL aggregate itself (`jsonb_agg(...) filter (where kind = 'service')` / `... 'office_hours'`, two correlated subqueries in the same `SELECT`) means presby-site-kit's `ServiceTimes` component and whatever renders office hours never group or filter one array client-side — each gets its own, and Phase 1 Gap 6's "every field independently omittable" contract falls directly out of it (`serviceTimes: []` or `officeHours: []`, never one array a component has to partition first). Write side: the admin editor treats each kind's row set as one unit — a transaction that deletes every `organization_service_times` row for `(organization_id, kind)` and re-inserts the submitted list, not per-row diffed CRUD with client-tracked row identity — because there is no `organization_service_times` history table (resolved Q6) and no concurrent-editor story to protect against (platform-admin-only, low-frequency per Phase 1's own cadence note). A diffed update model would buy correctness this feature has no consumer for; whole-list replace is the smaller surface and the one precedent-free choice here that still composes cleanly with "no history table."

---
## DECISION-091: Structured service times land in a genuine child table (`organization_service_times`, typed `day_of_week`/`start_time`/`end_time`/`label` columns, composite tenant key), not a JSONB array column on `organization_profiles`

**Status:** Resolved · **Date:** 2026-08-21 · **Feature:** `2026-08-21-public-site-org-profile` (Phase 2)

The user chose structure over the analyst's own free-text recommendation specifically to get real schema, not a nicer-looking admin form — a JSONB array is still schema-less at the database layer (no per-entry `CHECK`, no `time` typing, no planner visibility), and would silently reintroduce the free-text problem one level down inside a column that only *reads* as structured. `presby_published_site()` still satisfies the "one query, never a second function" requirement (Phase 1 Gap 5) via a correlated `jsonb_agg` subquery folded into its existing `SELECT` list, not a second read path.

---
## DECISION-090: Public-site org profile data lands in a new table (`organization_profiles`), not by extending `organization_sites`; its `presby_app` grant follows the `organization_brands` precedent (forward-looking full CRUD, declared ahead of a named future consumer), not `organization_sites`' "no grant, ever"

**Status:** Resolved · **Date:** 2026-08-21 · **Feature:** `2026-08-21-public-site-org-profile` (Phase 2)

`organization_sites`' own table comment states, in the author's own capitals, "NO PUBLIC GRANT and NO presby_app TABLE GRANT, EVER" — a hard marker on that specific table, not a general policy, and the same comment separately confirms a tenant editor was "confirmed dead" for that table's data. Profile data's tenant editor is the opposite fact: the user resolved Phase 1's Open Question 1 by naming it "deferred as its own future follow-up, same pattern as the brand editor's own deferred slice d" — the same already-scoped-but-deferred shape that earned `organization_brands` its forward-looking `presby_app` grant (`0016_presby_brand_storage.sql`). This ruling is contingent on that deferred tenant-editor follow-up being tracked as a named `docs/TODO.md` line, not left as only a work-log answer nobody re-reads.

---
## DECISION-089: `ContactForm`'s read side is a third section on the existing `/o/<slug>/tickets` page, gated by `tickets.file`; no new tenant permission, no platform-side triage surface

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 3)

Phase 2 left this open, naming `tickets.file` as the plausible-but-undecided reuse candidate. Confirmed, on the identical reasoning DECISION-074 already established for congregation feedback on the same page: a congregation's own `tickets.file` role-holder is exactly who should see messages a stranger sent through their public site, and `admin/roles/page.tsx`'s "two related sections, one page" precedent (already extended once, to three sections in this codebase's own history) is the established shape for a small review queue that doesn't warrant a fourth route. Unlike `tickets`/`congregation_feedback`, `site_contact_messages` gets **no platform-side (`admin/*`) triage surface and no `presby_platform` table grant** — there is no analog to `/admin/tickets` in this design, and granting platform-wide read access to every congregation's inbound public-contact messages with no consumer to use it would be exactly the unused-privilege surface "No Role Carries a Wildcard" warns against, applied at the grant layer. `markSiteContactMessageReadAction` is audit-exempt (routine triage, matching `dismissFeedbackAction`'s identical posture) — reading your own inbox is not a security-sensitive mutation.

---
## DECISION-088: `blob_assets` widens again to admit `application/json` for the normalized site content bundle; the pre-existing Drizzle/DB drift (Phase 2 Note 7) is fixed in the same commit

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 3)

Same union-of-consumer-needs reasoning as DECISION-073: `blob_assets` is one shared table with one CHECK constraint and one `ALLOWED_CONTENT_TYPES` constant; the normalized site bundle (front-matter + parsed MDX AST + resolved image-key map) is structured JSON, not one of the four existing types, so the shared outer bound widens rather than forking the adapter. The ingest route's own 422-on-malformed-bundle validation is the real per-consumer gate, exactly as the ticket-attachment magic-byte sniff is for that consumer — widening the shared CHECK changes nothing about what any other caller accepts in practice. Bundled in the same migration/commit as fixing `src/lib/db/domain/assets.ts`'s pre-existing drift (its Drizzle `check()` calls still declared the pre-`0019` PNG/JPEG/WEBP/2MB values even though the live DB constraint was already widened to PNG/JPEG/WEBP/PDF/10MB) — flagged by the architect in Phase 2 as adjacent, not introduced by this pipeline, but cheapest to fix now rather than let a third consumer land on top of an already-inconsistent source of truth.

---
## DECISION-087: The ingest endpoint's GitHub Actions OIDC verification is implemented inline with `node:crypto` against GitHub's published JWKS, not a new JWT-verification dependency; the ingested commit SHA is read from the token's own `sha` claim, never the request body

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 3)

Architect's Phase 2 approved exactly one new dependency for this pipeline (`presby-site-kit`, DECISION-082) — a second one (a JWT/JWKS library, to verify GitHub's OIDC tokens) would be scope the architect didn't rule on and would force a Phase 2 loop-back for a verification step that is, in fact, implementable without any new package: fetch and cache GitHub's JWKS (`https://token.actions.githubusercontent.com/.well-known/jwks`, module-level in-memory cache with a TTL, mirroring `rate-limit.ts`'s own plain-`Map` pattern), select the signing key by `kid`, `crypto.createPublicKey({ key: jwk, format: "jwk" })`, and `crypto.verify("RSA-SHA256", ...)` over the base64url-decoded JWT parts — roughly the same shape and size as DECISION-057's inline OKLCH transcription, which already established "small, auditable, and no second consumer anywhere in the tree" as sufficient reason to skip a dependency in this exact codebase. Separately, and independent of the dependency question: the ingested `commitSha` is read from the **verified token's own `sha` claim**, never trusted from the JSON request body — a request body value could be set to any string by whatever produced the POST, while the `sha` claim is bound cryptographically to the specific workflow run that requested the token, closing a spoofing gap where a compromised or misconfigured CI step could claim ingest for a commit the token was never actually minted for.

---
## DECISION-086: `presby-site-kit`'s consumability is compiled output checked into the tag, not a build step `presby`'s install runs; the repo must exist (even as a stub) before Phase 4's render-path commit, but its real component library does not

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 3)

Two questions Phase 2 named as real, undecided work (Note 6). **Consumability**: a git dependency's default `npm install` runs a `prepare` script if the package defines one — if `site-kit` relied on that to compile itself, `presby`'s own install would invoke `site-kit`'s toolchain (whatever TypeScript/bundler versions it pins) inside `presby`'s CI, a second uncontrolled toolchain `presby`'s own `npm run check`/build pipeline never asked for. Instead `site-kit`'s own release process compiles and commits `dist/` before cutting a tag, the same shape as consuming any pre-built npm-registry package applied to a pinned git tag (DECISION-082) instead of a registry version. **Sequencing**: `presby`'s side of the integration is exactly one named import, `import { renderSiteBundle } from "presby-site-kit"`, taking normalized pages, brand tokens, and an image-URL builder function (never raw bytes — `site-kit` never touches the blob adapter directly) and returning JSX or `null`. Faking that import inside `presby`'s own tree (a local module shadowing the real package name) is exactly the "shadowing a real package name is a resolution trap" DECISION-048 already rejected for the `radix-ui` alias case, so the resolution is instead to create the real `presby-site-kit` repo now, with a trivial `renderSiteBundle` stub (prose + a placeholder, ignoring the MDX AST and component allowlist entirely) tagged `v0.0.1-stub`, and point `presby` at that tag. Phase 4's render-path commit is real and testable against it; a later, out-of-scope pipeline builds the actual component library and cuts `v1.0.0`, at which point `presby` bumps one pinned tag with no change to its own `page.tsx`.

---
## DECISION-085: `src/proxy.ts` requires an explicit anonymous-bypass for `/site/*`, added before the public-sites feature ships — without it, every anonymous visitor is redirected to `/signin`

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 2)

Discovered by tracing `src/proxy.ts`'s actual control flow rather than assuming DECISION-041's "`(public)` is unauthenticated by contract" was already enforced at the Edge: `PUBLIC_PATHS` is an exact-match `Set` (no `/site/<slug>` entry, and cannot have one — the slug varies), and no `PROTECTION_RULES` pattern matches `/site/*` either, so an anonymous request falls through to the `edgeAuth()`/`session?.user` check and is redirected to `/signin`. `/api/*` is unconditionally bypassed already (confirmed, no change needed — the ingest endpoint needs nothing), but `(public)/site/[slug]` is a page route, not an API route, and isn't covered by that bypass. Fix: add `if (pathname === "/site" || pathname.startsWith("/site/")) return NextResponse.next();` before the `edgeAuth()` call, mirroring the file's existing `/account/verify-email/` prefix-bypass. Required for Phase 4, not optional — a correctness gap in the existing gate, found before any code was written, not a design choice for this pipeline to make.

---
## DECISION-084: The ingest endpoint's `SITE_CONTENT_INGESTED` audit write is intentionally outside `check:audit`'s scan scope, following the existing four-precedent pattern; the tripwire itself is not widened

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 2)

Confirmed by reading `scripts/check-audit-coverage.mjs` directly: it scans only files literally named `actions.ts`/`actions.tsx`, so a route handler's mutation is structurally invisible to it. `src/lib/audit.ts` already documents four instances of exactly this shape (`RATE_LIMIT_BLOCKED`, `EMAIL_QUEUE_PERMANENT_FAILURE`, `ACCESS_DENIED`, `USER_ACCOUNT_LOCKED`), each with an inline comment explaining the gap is intentional. `SITE_CONTENT_INGESTED` (actor `null`, `resourceType: "organization"`, metadata carrying the OIDC-verified repo/commit-sha) follows the same documented-precedent pattern rather than triggering a widening of the tripwire's scan path, which would be unscoped work — retroactively touching every existing route handler, including the `api/webhooks/*` tree DECISION-028 already carves out — that doesn't belong to this pipeline.

---
## DECISION-083: `ContactForm` submissions land in a new FORCE-RLS tenant table (`site_contact_messages`), not a straight-to-email design; a honeypot field plus IP-keyed rate limiting is the v1 bot mitigation, no CAPTCHA vendor evaluated

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 2)

Follows DECISION-069/070's identical isolation reasoning — a tenant-scoped reader is needed (a congregation's own role-holder reviewing messages sent to them), so an RLS-less or email-only design is ruled out the same way it was for `tickets`/`feedback`, rather than inventing a new pattern for the one write path that happens to be anonymous. `organizations` has no contact-email column today, so a mail-only design would need to invent one anyway and would lose the audit-visible record and delivery resilience every other write path in this app already gets by landing in a table first. Written via a `blob-store.ts`-style trusted-org-context call, gated on "this org's site is `status = 'live'`" in place of the membership check `withOrgContext()` normally performs — the anonymous-write equivalent of "verify before you trust the org id," since RLS trusts whatever org id it's handed and an anonymous caller could otherwise stuff a message into any UUID by guessing. `checkRateLimit()` needs no change to support an IP-only key (`getRequestIp()`, DECISION-017). No CAPTCHA vendor is evaluated or pre-approved; a honeypot field is judged sufficient for v1, revisit only if real abuse is observed — mirrors DECISION-077's identical "ship the minimal defensible thing" posture. The read side (which tenant role sees submitted messages) is left open for Phase 3, with `tickets.file` as the plausible-but-undecided reuse candidate.

---
## DECISION-082: `presby-site-kit` is a real, direct npm dependency of `presby` (a pinned-tag git reference), not an external-only repo `presby` never imports

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 2)

The locked architecture's own framing — "whatever `site-kit` version is currently running inside `presby`," one server rendering every org's content through one versioned component set — only works if `site-kit`'s renderer/component library executes inside `presby`'s own build. Confirmed against this project's dependency-evaluation criteria: Edge runtime isn't a concern (this route needs the DB and is never Edge, per the Edge Gate invariant); bundle size is acceptable (server-rendered, only `ContactForm`'s submit interaction ships client JS); license should be stated explicitly at `site-kit`'s creation (MIT, matching `presby`'s own) rather than inherited by assumption. Pinned to an **exact tag** (`github:<org>/presby-site-kit#v1.2.0`), never a floating branch ref — the git-dependency equivalent of this repo's existing `^`-pinned discipline; `package-lock.json`'s resolved commit SHA is a second independent anchor. One-directional only — `site-kit` and `site-<slug>` repos never depend on `presby`. `site-kit`'s own consumability (compiled output checked into the tag, vs. a build step `presby`'s install must run) is named as real, undecided implementation work for Phase 3/4, not assumed away.

---
## DECISION-081: The sites-status table is `organization_sites`, shaped like `organization_brands` (degenerate PK, FORCE RLS, no public grant), not named `sites`

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-public-sites` (Phase 2)

Ratifies Phase 1's recommendation after reading `organization_brands`' actual RLS/grant SQL directly (`drizzle/0016_presby_brand_storage.sql`) and confirming DECISION-049's reasoning transfers unmodified: a site's status (`provisioning`/`live`/`suspended`) is the same shape of signal DECISION-040 already ruled must stay hidden, and `organization_brands` already solved exactly this shape once — no public grant, ever, FORCE RLS, `presby_current_org()` policy. Renamed away from `sites` specifically to avoid colliding with `docs/schema-design.md` §14's now-superseded sketch, which used that identifier for an unrelated, much larger DB-composition shape. Columns: `organization_id` (PK, degenerate — one row per org, matching `organization_brands`), `repo`, `status` (`provisioning|live|suspended`), `last_ingested_commit_sha`, `last_ingested_at`, `content_bundle_key`, `updated_by` (nullable, unlike `organization_brands.updated_by` — machine ingest writes have no `users.id` to attribute). Provisioning writes (admin operator) and ingest writes (OIDC-verified machine caller) both use `getPlatformDb()` — both are "verified, no membership" callers, the same shape; the public read never touches this table directly, only through the existing DECISION-041/049 SECURITY DEFINER projection.

---
## DECISION-080: Exact role-catalog bindings for `tickets.file`/`ledger.approve`/`pastoral.notes.view` — `support_contact` (Marguerite Ashcombe), `treasurer` (Priya Balakrishnan), `installed_pastor` (Rowan Thistlewood); the `FEATURES.ADMIN_TICKETS` cross-pipeline dependency lands in support-tickets' Phase 4 commit 2 (api-developer), not commit 3 (ux-developer)

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-role-catalog` (Phase 3)

Two naming/allocation calls Phase 1/2 explicitly deferred to Phase 3, plus one factual correction found while verifying rather than relaying a summary. **Role keys**: `support_contact` (custom, unprotected, matches `property_chair`'s shape — Phase 1's own working name, confirmed); `treasurer` (constitutional, protected — `src/lib/db/domain/officers.ts:84`'s own `office` column comment already anticipates this exact string, and line 96 already lists Treasurer among the schema's open-ended offices alongside Clerk of Session); `installed_pastor` (constitutional, protected — lifted verbatim from `docs/schema-design.md` §8's own phrase "installed pastors from `officer_terms` where the ministry is teaching elder," satisfying DECISION-079's constraint that the key name the pastoral relationship, not a presiding function). **Holders**, applying Phase 1's "don't stack everything on one person" reasoning concretely: Marguerite Ashcombe (already the Phase 1-named `tickets.file` candidate) for `support_contact`; Priya Balakrishnan — an existing, already-seeded ordained deacon whose one term ended 2025-01-12 with no successor, not a new fixture person — for `treasurer`, since Tobias Renwick already holds `property_chair` and `stated_clerk` and a third grant to him would recreate the concentration this pipeline exists to interrupt; Rowan Thistlewood — the fixture's own pastor, D1's whole justification, holding no other role — for `installed_pastor`. Desmond Okonkwo (not a member) and Hallie Vandermeer (a minor) were considered and rejected for `treasurer` on the fixture's own facts, not arbitrarily skipped. **Correction**: this pipeline's own Phase 1/2 briefing described the platform Support Operator bundle's `FEATURES.ADMIN_TICKETS` dependency as sibling pipeline `2026-08-20-support-tickets`'s Phase 4 commit 3 (ux-developer); reading that pipeline's own Phase 3 Implementation Order directly shows the `src/lib/permissions.ts` edit is listed under commit 2 (api-developer). The dependency itself (Phase 2 Note 1) is unchanged and still blocks role-catalog's own Commit B; only the commit number attributing which implementer resolves it was wrong, corrected here rather than propagated silently into Phase 4's instructions.

---
## DECISION-079: `pastoral.notes.view` must bind to an office representing the actual pastoral relationship (installed or temporary-supply pastor), never to a presiding-function label like "moderator"

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-role-catalog` (Phase 2)

Moderator of Session is ordinarily held ex officio by the installed pastor, but it is a presiding function that can be held by someone with no ongoing pastoral relationship to the congregation — a presbytery-appointed moderator during a pastoral vacancy, who may be a ruling elder or a minister from another church entirely. Binding tier-3 pastoral-notes access (`docs/schema-design.md`'s own "strictest grant in the system," `visibility = 'clergy_only'`) to "whoever moderates the meeting" would let that role admit a non-clergy or externally-appointed holder into the strictest read grant in the schema. The office key Phase 3 picks must name the pastoral relationship itself, not the meeting-chairing function — exact string is Phase 3's call, this is a tier-sensitivity constraint on that call, not a name.

---
## DECISION-078: `roll.propose` binds to `stated_clerk` (a new `app_role_permissions` row, no new role); the standing test for any future capability proposed against `stated_clerk` is constitutional duty vs. software convenience

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-role-catalog` (Phase 2)

`roll.approve` is already bound to `session_member` (the derived Session group — a collective body decision, G-2.0401's body-vote model); `roll.propose` on `stated_clerk` completes a clean propose/approve separation of duties — one accountable individual drafts, the body approves — and register-keeping is squarely the Clerk of Session's own constitutional duty (`docs/schema-design.md` §8 already assigns roll/register maintenance to this office). This is categorically different from `tickets.file`'s original binding (DECISION-072, corrected): that had nothing to do with clerking and was bound to `stated_clerk` only because no other office existed — expediency, not duty. The standing test for anything proposed against `stated_clerk` going forward: does this permission belong to the Clerk of Session's actual constitutional job, or is `stated_clerk` just the only administratively-empowered office that happens to exist in the fixture? `roll.propose` passes; `tickets.file` did not. Recorded so the next pipeline doesn't have to re-litigate DECISION-072's arc from scratch.

---
## DECISION-077: Ticket lifecycle emails route through a new shared `src/lib/tickets-notifications.ts`, not inline `enqueueEmail()` calls scattered across three action files; no rate-limiting or digestion is added on top

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3 revision)

The user asked for five email triggers beyond the one submit-confirmation the original Phase 3 design already had: a new ticket to the `FEATURES.ADMIN_TICKETS` pool, an operator reply to the submitter, a submitter reply to the assignee (or the pool if unassigned), a `resolved`/`declined` status change to the submitter, and a promoted-feedback ticket to the original feedback author. `feedback/actions.ts`'s own inline `buildFeedbackEmailHtml()` precedent is the right shape for a single-table, single-file feature; it is the wrong shape here because these five triggers fire from **three different files across two route trees** (`(org)/tickets/actions.ts`, `(org)/feedback/actions.ts`, `(admin)/tickets/actions.ts`), and the "who holds `FEATURES.ADMIN_TICKETS`" lookup (needed by both the new-ticket notification and the assignment dropdown that already existed in the design) would otherwise be maintained twice under two different names. `src/lib/tickets-notifications.ts` holds the pool lookup and the five `notify*` builders; `src/lib/tickets.ts` itself stays DB-only, no email import — the same separation `feedback/actions.ts` already draws between mutation and side-effect, just factored out because three call sites need it, not one. Uses the plain `db` export, not `getPlatformDb()`: `users`/`userRoles`/`roles`/`roleFeatures` carry no RLS (absent from `0009`'s `tenant_tables` array), so there is no F26-shaped connection concern here the way there is for `tickets`/`ticket_messages` themselves. Separately: no `checkRateLimit()` or digestion logic is added to any of the five triggers — each maps to genuinely new information (existence, a reply, a terminal outcome, a promotion), routine internal triage (`triaged`/`in_progress`, reclassify/area/priority/assign) fires no email at all by design, and every event-producing action (`tickets.file` filing/replying) is already role-gated to a small, accountable circle — a materially different spam-exposure profile than `congregation_feedback` submission, which stays rate-limited on its own existing precedent. Revisit only if real usage shows otherwise.

---
## DECISION-076: `tickets.area` is a CHECK-constrained controlled vocabulary, not free text; `tickets.priority` mirrors `change_class`'s submitter-suggests/operator-confirms pattern exactly, defaulting to `normal`

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3 revision)

The user's own framing — "well thought out and formal enough that AI can work the initial pass," naming "area, classification, priority" explicitly — is a request for structured fields an automated first pass can branch on, which a free-text `area` column would defeat by construction (more prose to parse, not less). `area` gets the same shape `change_class` already has: a short flat CHECK list (`directory`, `roll`, `roles`, `giving`, `events`, `website`, `account`, `other`), submitter-set at filing, operator-correctable at triage via a new `setTicketAreaAction`, never submitter-authoritative — consistent with the existing `change_class` posture rather than inventing a second policy for a sibling field. The list mixes today's real org-portal surfaces with pillars the project overview already names but hasn't built (`giving`, `events`, `website`), because a ticket can legitimately be about something that doesn't exist yet, plus an `other` escape valve so a bad-fit report isn't forced into a wrong bucket (the same escape-valve reasoning tags-only D8 relies on elsewhere in the schema). `priority` (`low | normal | high | urgent`, DB default `normal`) mirrors `change_class`'s pattern exactly, per the most-consistent-choice reasoning the user's own framing pointed at: submitter sets it as a required `FileTicketInput` field (not DB-default-as-substitute-for-required), operator-correctable via a new `setTicketPriorityAction`. Both new operator-correction actions are kept as their own single-field mutations — sibling to, not folded into, the existing `reclassifyTicketAction` — each writing its own `ticket_actions` row (`area_changed`, `priority_changed`), matching `reclassified`'s existing one-action-one-field shape rather than having one action silently do double or triple duty depending on which fields are present in its input. Both fields are audit-exempt by the same "routine triage" reasoning already established for `change_class`/status/assignment — no new `AUDIT_ACTIONS` keys.

---
## DECISION-075: `ticket_actions.audit_event_id` ships always-null in this pipeline; the working audit↔ticket correlation is one-directional (`audit_events.metadata.ticketId`), not the column its own name implies

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3)

Phase 2 Note 3 named `ticket_actions.audit_event_id` as the ticket→audit half of a two-way correlation, alongside `recordAudit()`'s existing `metadata.ticketId` convention (audit→ticket, DECISION-067's precedent). Building the ticket→audit half for real requires `recordAudit()` to return the inserted row's id; today it returns `Promise<void>` by design (`src/lib/audit.ts` — audit writes are fire-and-forget, swallowing failures so a mutation never fails because its own audit write did), and changing that signature is a change to a shared, load-bearing platform module used by every existing `AUDIT_ACTIONS` call site, not a ticket-support concern. Rather than leave the column silently unpopulated with no explanation for a future reader wondering why it's always null, or invent a second read-after-insert query in every audited ticket action just to backfill it, the column ships as declared schema headroom for a future `recordAudit()` change, and the correlation that actually works in this pipeline is the existing one-directional `metadata.ticketId` on the audit row. Named explicitly rather than left as an unexplained gap between the column's name and its behavior.

---
## DECISION-074: Congregation feedback review lives as a section on the existing `/o/<slug>/tickets` list page, not a fourth route; the baseline-member on-ramp is a new `/o/<slug>/feedback` page, not a reuse of `(member)/feedback`'s component

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3)

Two page-shape calls Phase 2 left open. **(1)** "Review incoming feedback" (Flow 0) could have been a separate route or a section of the ticket list; `admin/roles/page.tsx` already established the precedent of two related sections on one page ("Who holds what" + "Grant a role") rather than fragmenting a triage workflow across screens, and promoting a feedback row into a ticket is naturally the SAME "new ticket" form (`/tickets/new`), pre-filled and reached via `?fromFeedback=<id>`, rather than a distinct promotion UI — so the queue lives on `/tickets` (discovery) and the act of promoting reuses `/tickets/new` (the same form Flow 1 already needs), one page component with two submit targets. **(2)** `(member)/feedback`'s existing action writes to the platform `feedback` table (`userId`-only, no org concept, DECISION-070's stated invariant) — reusing its client component for congregation feedback would mean branching a shared component on which table to write to, recreating at the component layer the exact "two products sharing a textarea" conflation DECISION-070 already rejected at the schema layer. `/o/<slug>/feedback` is a new, small, dedicated page and component instead.

---
## DECISION-073: The `blob_assets` CHECK constraints widen to the union of every consumer's needs (PNG/JPEG/WEBP/PDF, 10MB); each caller keeps its own narrower magic-byte sniff as the real per-feature gate; PDF is always an opaque download, never rendered inline, regardless of who uploaded it

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3)

DECISION-071 required an explicit, enumerated call on ticket attachments' accepted types and size cap. `blob_assets` is one shared generic table (DECISION-055/058) with one CHECK constraint and one `src/lib/storage/blob-store.ts` constant (`ALLOWED_CONTENT_TYPES`/`MAX_BYTE_SIZE`) — there is no per-consumer variant of either without splitting the adapter back into two tables, which would undo DECISION-055/058's whole point. The org-brand logo path already proves the correct shape for this without needing the shared constant narrowed: `setOrganizationBrandAction` calls its OWN `sniffImageContentType()` (recognizes only image magic bytes) and `MAX_LOGO_BYTES` (2MB) BEFORE ever calling `store()`, so widening the shared DB CHECK / adapter constant to also admit `application/pdf` up to 10MB does not change what the logo path actually accepts — its own narrower gate is unaffected. The ticket-attachment action gets an equivalent, separately-narrower sniffer (image magic bytes + `%PDF-`) as its own outer bound. Separately: PDF attachments are served as opaque downloads only (`Content-Disposition: attachment`), never in an `<iframe>`/inline viewer, categorically and regardless of who uploaded them — the same reasoning G7 already applies to excluding SVG outright (a format able to carry executable content is not made safe by the uploader being a trusted, permission-gated role-holder). Raster images DO render inline for the ticket-attachment consumer specifically, unlike a hypothetical "everything is opaque" blanket rule — ticket filers are always either a `tickets.file` role-holder or a platform operator, a narrower and more accountable circle than the arbitrary-member exposure a blanket policy would be guarding against, and screenshots are materially more useful triaged at a glance than behind a click.

---
## DECISION-072: `tickets.file` is bound to the existing `stated_clerk` constitutional role, not a new tenant role; no new `role_grants` row is needed at Alder Creek, only a new `app_role_permissions` row

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 3)

Phase 1 named `stated_clerk` as the natural first candidate and left confirmation to Phase 3. Confirmed: DECISION-066's reasoning for why `role_grants.manage` belongs to a designated administrative office rather than a derived group applies to `tickets.file` with the same force — filing a ticket that reaches the platform team is an administrative/records function of the same office G-3.0104 already gives the software-access decision to, and minting a second new constitutional role for this one pipeline would be inventing polity-office machinery Phase 1 never asked for (the same "no wildcard role template" discipline `role-grants.ts`'s own header names). Piggybacking means `scripts/seed-dev.sql` needs exactly one new `app_role_permissions` row (`stated_clerk` → `tickets.file`) at Alder Creek's existing `f0000000-...-005` role — the existing `role_grants` row granting `stated_clerk` to Tobias Renwick already carries the new permission for free. This also produces an emergent, unbuilt-for-free protection: because `stated_clerk` carries BOTH `role_grants.manage` and `tickets.file`, `revokeRole()`'s existing self-lockout guard (finding 6, `role-grants.ts`) already refuses to leave an org with zero `role_grants.manage` holders, which — as a side effect of the shared role — also means an org can never organically reach zero `tickets.file` holders through the app's own revoke path. A future congregation that binds `tickets.file` to a *different* role without `role_grants.manage` would not inherit this protection automatically; flagged in the Phase 3 design's Edge Cases as a named residual risk for `docs/TODO.md`, not solved speculatively here.

**Correction, 2026-08-20 (`2026-08-20-role-catalog` Phase 1):** Superseded by explicit product direction — the concentration this decision's own residual-risk note warned about (every new tenant capability landing on `stated_clerk`) was judged not worth the convenience once named directly. `tickets.file` moves to its own custom, non-constitutional role instead (see the role-catalog pipeline's Phase 1/3 for the replacement binding and its exact name). The emergent self-lockout protection this decision bought is deliberately given up, not lost by oversight: `revokeRole()`'s guard checks only `role_grants.manage`, so a role holding solely `tickets.file` was never a candidate for that protection regardless of which role it lived on — `property_chair` already carries the identical exposure today and has not been treated as blocking. See `docs/work-log/2026-08-20-role-catalog.md` for the full reasoning and `docs/TODO.md` for the tracked consequence.

---
## DECISION-071: Ticket attachments reuse `src/lib/storage/blob-store.ts`'s `store()`/`resolve()` interface unchanged; the `blob_assets` content-type/size CHECK constraints are explicitly widened in Phase 3, not silently inherited from the logo path

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 2)

The adapter's dual-caller shape (a platform-authorized caller with no membership, or a tenant-authorized caller that already ran `withOrgContext()` for something else, `organizationId` trusted either way) already fits both `/o/<slug>/tickets/new` (tenant submitter) and `/admin/tickets` (platform triage reading the attachment back) without modification — proven end to end by the brand-logo path. What's logo-specific is the CHECK constraint's *values* (`blob_assets_content_type_allowed`: PNG/JPEG/WEBP only; `blob_assets_byte_size_bounds`: ≤2MB), which is data, not the interface — ticket artifacts almost certainly need at least PDF and possibly a different size cap. Widening the constraint is ordinary schema work (database-admin, Phase 4), but Phase 3 must make it a deliberate, enumerated decision (exact MIME list, size cap, and whether any script-capable format is accepted as an opaque download only, never rendered inline — SVG stays rejected regardless; PDF can carry embedded JS too if added) rather than silently carrying the logo path's policy forward.

---
## DECISION-070: Flow 0's congregation feedback is a new tenant-scoped table in `src/lib/db/domain/support.ts`, not a nullable `organization_id` added to `schema.ts`'s `feedback` table; `feedback`'s existing shape, audience, and stated privacy invariant are untouched

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 2)

Same isolation argument as DECISION-069, applied to `feedback` specifically: it is RLS-less by design, like `audit_events`, and Flow 0 needs a *tenant-scoped* reader ("the org's designated `tickets.file` role-holder reviews incoming feedback for their organization") — filtering by `WHERE organization_id = X` in application code on an RLS-less table is a convention, not an isolation guarantee, the exact thing "Isolation Is a Database Property" rules out. Beyond isolation, platform-app feedback (bugs/suggestions to `ADMIN_ROLE`, `contextPath`/`appVersion` columns, no org concept, no promotion path) and congregation-experience feedback (triaged by an org's own role-holder, promotable into a ticket) are different products sharing a textarea, not the same feature — conflating them would import columns meaningless to the new flow or fork the table's meaning in place. `feedback` stays exactly as it is; the new table lives alongside `tickets` in `support.ts`, FORCE RLS, keyed by `person_id` (the `(org)`-scoped identity, never `users.id` — the same axis `role-grants.ts`'s header warns against conflating).

---
## DECISION-069: Support tickets are FORCE-RLS tenant tables (`src/lib/db/domain/support.ts`), not a platform-shell table with a plain `organization_id`; the platform triage surface reads the same rows via `getPlatformDb()`

**Status:** Resolved · **Date:** 2026-08-20 · **Feature:** `2026-08-20-support-tickets` (Phase 2)

DECISION-067 already identified "`organization_id` as a plain column on an RLS-less platform-shell table" as unsafe-by-construction for a tenant-scoped reader (`audit_events`), and deferred building the safe version because nothing needed it yet — this pipeline's Flow 2 needs a tenant-scoped ticket reader now, so deferring isn't available. Tickets' two audiences (an org's own role-holder at `/o/<slug>/tickets`, and the platform's bypass connection at `/admin/tickets`) are the ordinary shape every tenant table already supports for free (the same duality `getPlatformDb()` already exercises reading `organization_brands`/`blob_assets`); it is not the genuine two-tenant-simultaneous-read problem `organizations`/`person_links`/`transfer_certificates` solved with bespoke cross-tenant policies, so no bespoke pattern is needed either. `submitter_person_id` is a plain FK to the global `people(id)` (D1 already made `people` global, so F2's composite-key concern doesn't apply the way it did pre-D1) guarded by a write-time current-membership check inside the query-layer transaction, mirroring `role-grants.ts`'s target-validation shape; `ticket_messages`/`ticket_actions` FK into `tickets(id, organization_id)` as a genuine composite per F2 proper.

---
## DECISION-068: The self/other-escalation subset check runs as two ordinary, already-org-scoped reads inside the mutation's `withOrgContext()` transaction — no new privileged SQL function

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-administration` (Phase 2)

The granter's own effective permissions come from `effectivePermissions()` (already exported, `src/lib/authz.ts`); the target role's permission set comes from a plain `SELECT` over `app_role_permissions`/`permissions` — global, non-RLS catalog tables joined through an `app_roles` row already scoped to the transaction's org context by FORCE RLS. Both reads happen inside the one transaction the mutation already opens; neither crosses an org boundary, so neither needs SECURITY DEFINER. `presby_effective_permissions()` itself already self-guards against being used as a fishing tool outside the caller's current org context — building a second privileged function to perform a same-org comparison it can already answer twice over would be the wildcard-shaped shortcut the adversarial pass warns against, one layer below the checker instead of the checked. Lives in a new `src/lib/role-grants.ts`, parallel to `directory.ts` (DECISION-061's precedent for the first tenant mutation's query-layer module).

---

## DECISION-067: The tenant-facing audit reader is deferred; Flow 3 ("who holds what") is the safe, partial consolation

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-administration` (Phase 2)

`audit_events` is absent from `drizzle/0009_presby_rls.sql`'s `tenant_tables` array — it has no RLS policy at all, so a tenant-scoped reader built on today's `resourceId`-overload convention (already used by `ORG_BRAND_SET`/`NEUTRALIZED` for a platform-only reader) would be readable cross-tenant by construction, the same shape DECISION-049 already rejected once for `organization_brands`. Building a safe reader needs a dedicated `organization_id`-bearing FORCE-RLS projection or a narrowly-scoped SECURITY DEFINER function — real schema work this pipeline's Phase 1 scope did not ask for. `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` are still written unconditionally (CLAUDE.md Rule 7; the write path needs no RLS since no reader exists yet to leak to), with `organization_id` recorded explicitly in `metadata` so a future reader isn't guessing at convention. Flow 3 ("who holds what," via `presby_effective_permissions()`/`explainPermission()`, already RLS-correct and already in scope) is a genuinely better answer to current-state questions but does not cover history — a tenant-facing audit reader stays a named, tracked `docs/TODO.md` follow-up, not a silently-closed gap.

---

## DECISION-066: `stated_clerk` is a new constitutional role, direct-granted only — the bootstrap permission for tenant administration is not an extension of `session_member`

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-administration` (Phase 2)

The `role_grants.manage` permission cannot bootstrap onto `session_member` (bound to the derived Session group): that would hand every sitting elder the power to grant and revoke administrative access simultaneously, on no individual act of designation, wildly out of proportion to `session_member`'s existing binding (`roll.approve`, a collective-body decision G-2.0401 already models as a body vote). PC(USA) polity already separates the two: G-3.0104's Stated Clerk is a designated administrative office at every council (congregation, presbytery, synod), elected by the body but exercising its records/execution duty individually — the correct shape for "who clicks grant/revoke in the software." New constitutional role `stated_clerk`, `role_kind: 'constitutional'`, `is_protected: true`, holding a new global permission `role_grants.manage` (module `authz`, tier 1, migration-seeded per DECISION-063's precedent), granted by a **direct** (`person_id`, arm 1) `role_grants` row — never bound to a derived group. Fixture-scoped in `scripts/seed-dev.sql` for now, matching `session_member`/`property_chair`/`member`'s existing form; `organizationTypeScope`-templating stays deferred to G-B (real org provisioning), unbuilt per DECISION-063. This is the first arm-1 grant proving `role_grants.manage` end to end, and it makes DECISION-062's flagged cascade gap live for the first time — inherited, not introduced, by this pipeline.

**Correction, 2026-08-19 (Phase 6, `2026-08-19-tenant-administration`):** This entry's framing of the `role_grants` arm-1 cascade-on-membership-end gap as "live for the first time... inherited, not introduced" was a research gap in this decision's own review, not a live gap in the schema. `drizzle/0014_presby_org_router.sql`'s `presby_guard_membership_end()` (predating this decision by migration number) already rejects ending a membership while an open `role_grants` row exists at that organization, and `scripts/test-rls.sql` already asserted this before P9's Phase 2 ran. The state is unreachable through any ordinary application mutation path; `role-grants.ts`'s `listGrants()` `membershipEnded` field remains correct, harmless defensive code for the one path that can still produce it (a direct historical-data import bypassing the trigger), not evidence of a live gap. See `docs/work-log/2026-08-19-tenant-administration.md` Phase 4 commit 2 and Phase 6.

---

## DECISION-065: The `active_membership` derived group's grantee population is "any current `memberships` row"; directory *content* eligibility is the narrower, already-documented fpcw-style formula — the two populations are deliberately different

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 3)

Two distinct questions were bundled under "`directory.view`'s baseline" and needed separating. **Who is a member of the `active_membership` derived group** (and therefore eligible for a `directory.view` grant) is `memberships.ended_on is null` — no narrower. This is not a new definition; it is the codebase's existing, canonical answer to "does this person have a current relationship with this org," already load-bearing in `presby_membership_is_active()` (`drizzle/0015_presby_membership_probe.sql`, the `withOrgContext()` gate) and `presby_available_organizations()`/`presby_user_organizations()` (`drizzle/0010_presby_resolver.sql`). Narrowing it to roll status for this one feature would mean the platform disagrees with itself about what "current" means depending on which page is asking — the exact drift `presby_membership_is_active()`'s own comment warns against ("if the two drift, a card appears for an organization the gate then refuses"). **Who *appears as a row* in the rendered directory** is unrelated and already specified in `docs/schema-design.md` §11 ("Directory eligibility... following fpcw's `visibility.ts`"): `current_roll in (active, baptized, affiliate, other_participant) OR engagement_status = 'regular'`, minus `directory_hidden`, minus deceased — narrower than "any current membership," and deliberately so: a first-time visitor with a live `memberships` row can be granted the *ability* to browse the directory (matching every other member's baseline access) without themselves being *published in* it, which is the correct default until a church has actually engaged them. `src/lib/directory.ts`'s query additionally excludes `people.merged_into_id is not null`, beyond the literal §11 formula, on the `presby_match_person()` precedent that a tombstoned person never renders.

---

## DECISION-064: A missing `person_privacy` row defaults to the table's own column defaults, not to full exclusion

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 3)

No trigger, seed, or application code anywhere creates a `person_privacy` row today (confirmed by search: `grep -rn person_privacy drizzle/ scripts/ src/` finds only the table definition and its comment, `drizzle/0011_presby_comments.sql:111`, and `scripts/seed-dev.sql` never inserts one) — every membership in the dev fixture is currently unconfigured, and this is the state every real congregation starts in until a self-service privacy page ships (unbuilt; no pipeline owns it yet). Defaulting a missing row to "fully hidden" would ship a directory that renders zero people for every congregation until each member individually visits a settings page that does not exist, which fails P1's own acceptance bar ("a member with the grant sees the directory") for the entire seed fixture on day one. Instead, `src/lib/directory.ts`'s query `LEFT JOIN`s `person_privacy` and `COALESCE`s each flag to the *same default the column itself declares* (`directory_hidden`→false, `hide_email`→false, `hide_phone`→false, `hide_address`→false, `hide_birthday`→true, `hide_photo`→false) — so a missing row behaves identically to a freshly-inserted, never-touched one, and the fallback is checkable against the schema rather than invented policy. `hide_birthday`'s default is `true` already (`src/lib/db/domain/privacy.ts:35`), so this is not "default everything visible" — it is "trust the table's own declared defaults," which happen to be protective on the one field the schema author already flagged as sensitive. Flagged as debt: this defaulting is load-bearing until a self-service privacy page exists to ever populate the row for real, same shape as DECISION-062's deferred items — lands in `docs/TODO.md`.

---

## DECISION-063: The `directory.view` permission-catalog row is seeded in the migration itself, not `scripts/seed.ts`; the `active_membership` derived group is seeded at every fixture organization, not only the one proving the permission end-to-end

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 3)

*(Merged 2026-08-19 — two related seeding rulings from the same commit had been minted under this number twice, in separate work-log recording passes. `docs/decisions.md`'s own rule is that a number never changes once assigned; combining them here rather than renumbering, since both are about the same commit's seed scope and neither has been referenced externally by its old wording.)*

`permissions` carries no `organization_id` — it is explicitly "global, code-seeded, never tenant-writable" (`src/lib/db/domain/authz.ts:24`) — but nothing in a real (non-dev) deployment inserts into it today; only `scripts/seed-dev.sql`, a synthetic dev-only fixture, does. `scripts/seed.ts` (`npm run db:seed`, the production-safe seed) cannot be the home for it either: it drives entirely off `FEATURE_CATALOG` in `src/lib/permissions.ts`, which is the *platform* shell catalog and is FROZEN against church-facing keys by explicit standing rule. Since `permissions` needs no org to exist first (unlike `app_roles`/`groups`/`role_grants`, which are inescapably per-org), an idempotent `insert ... on conflict (key) do nothing` inside `drizzle/0017_presby_membership_roster.sql` seeds it in every environment `db:migrate` reaches, dev and real alike — consistent with how `0009`/`0010` already treat "global catalog, seeded by migration" (`permissions` and the resolver functions) as the migration's job, not a TS seed script's.

Separately: the sync trigger (DECISION-060) fails loudly — by design, matching F16's reasoning — when a `memberships` row is inserted or updated at an organization with no `active_membership` derived group yet. `scripts/seed-dev.sql` inserts memberships at six fixture organizations, not the two Phase 2 anticipated when scoping "prove it once." Re-running the seed after the migration would raise on the first membership insert at any of the other four. The fix is not to weaken the trigger's fail-loudly behavior — that behavior is exactly what closes G-A's original gap (a silently-missing baseline grant with no error) — but to seed the derived group everywhere a membership can be inserted. **The role binding** (the `member` role, `app_role_permissions`, and the `role_grants` row actually granting `directory.view`) **stays scoped to Alder Creek alone** — the derived group's existence is a structural requirement of every org with memberships; wiring a permission through it is still the one-org proof Phase 2 intended. Same logic extends to the permission row's own placement above: per-org rows (a new `app_roles` row, `app_role_permissions`, `role_grants`) stay fixture-only in `scripts/seed-dev.sql`, because no code anywhere provisions a *real* organization yet (G-B) — the same non-answer already on record, not worsened here.

---

## DECISION-062: `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` and the `role_grants` arm-1 cascade-on-membership-end fix are deferred to whichever pipeline first writes a person-targeted grant mutation

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 2)

P1 writes no `actions.ts` code that grants a role to a person — `directory.view`'s baseline flows entirely through DECISION-060's derived group, a migration and a seed fixture, not an application mutation. `check:audit`'s tripwire scans only `src/app/**/actions.ts`; adding `AUDIT_ACTIONS` keys with nothing writing them repeats the built-and-unwired trap already on record for the platform `ADMIN_ROLE` wildcard, one layer down. Likewise, `role_grants`' arm-1 (`person_id`) cascade gap is real but untouched by P1 — the derived-group mechanism is immune to it by construction (arm 2 already reads `group_memberships.ends_on`, kept in sync with `memberships.ended_on` by the new trigger). Both items land in `docs/TODO.md`, owned by whichever pipeline first writes a person-targeted `role_grants` mutation — most likely **P9**, the tenant administration surface.

**Correction, 2026-08-19 (Phase 6, `2026-08-19-tenant-administration`):** "the `role_grants` arm-1... cascade gap is real" was a research gap in this decision's own Phase 2 review, not an accurate statement of the schema at the time it was written. `drizzle/0014_presby_org_router.sql`'s `presby_guard_membership_end()` — migration number `0014`, predating this decision's `0017` — already rejects ending a membership while an open `role_grants` row exists at that organization, and `scripts/test-rls.sql` already asserted this before P1's own Phase 2 ran. See DECISION-066's identical correction and `docs/work-log/2026-08-19-tenant-administration.md` Phase 4 commit 2 / Phase 6 for the full account.

---

## DECISION-061: The first real tenant-content read gets its own query-layer module (`src/lib/directory.ts`), not a function folded into `db/domain/`; privacy filtering is enforced in SQL, never in the Server Component

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 2)

`src/lib/db/domain/*.ts` is schema only — every file is `pgTable` definitions; query/business logic over that schema lives one level up (`src/lib/authz.ts`, `src/lib/audit.ts`). The congregation directory is the first read of real church content, so it sets precedent for P8/P9 rather than reusing an ad hoc location: a new `src/lib/directory.ts` holds one function performing the membership re-check, the `directory.view` permission check, and the privacy-filtered query inside a single `withOrgContext()` transaction. `person_privacy.directory_hidden` rows are excluded in the query's `WHERE` clause — never selected, not merely hidden at render — and the five field-level hide flags are applied as `CASE WHEN` expressions in the `SELECT` list, so a hidden value is never materialized as a JS value a later refactor could leak. The route lives at `src/app/(org)/o/[slug]/directory/page.tsx`, repeating the existing per-page `resolveOrgContext`/four-way-miss/`assertOrgAccess` pattern (the `(org)` contract's auth-in-page rule), rendering its permission-denied state inline inside the branded shell rather than through the DECISION-040 miss page or an un-branded route.

---

## DECISION-060: The tenant permission catalog's baseline-grant problem is solved by a new derived group (`active_membership`), not a fifth resolver arm

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-tenant-permissions-portal` (Phase 2)

`role_grants` requires an explicit row per grantee, which does not scale to "every active member can view the directory." The precedent for automatic, roster-wide grants is Session/Diaconate — materialized into `group_memberships` by trigger because the permission resolver's arm 2 reads that table directly, and a view would make members invisible to the join (F3). A new `groups.derived_from = 'active_membership'` value, trigger-synced from `memberships` (mirroring the officer-roster sync trigger, keyed on a new `membership_id` column analogous to `officer_term_id`), routes entirely through arm 2 **unmodified** — `presby_effective_permissions()`, a `security definer` function every isolation test exercises, does not change. The alternative (a fifth arm reading `memberships` directly for "implicit" grants) was rejected: it either still needs a role/group target and just reinvents the derived group with bespoke plumbing, or it bypasses `role_grants`' uniform provenance model, undermining "why can Jane see this" traceability — and it is the wildcard-shaped shortcut the adversarial pass pre-emptively warned against, one layer below the role catalog instead of at it. Unlike `officer_term_id`, the new `membership_id` column gets a composite FK to `memberships(id, organization_id)` — `officer_term_id`'s bare, unconstrained `uuid` is a pre-existing gap (flagged for a future database-admin review), not a pattern to repeat.

---

## DECISION-059: `organization_brand_history` records only `'updated'` and `'neutralized'`, never `'created'`

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice c, Phase 3)

A history row exists to let a future restore UI show "the previous brand, as a swatch and a date." There is nothing to restore *to* from a creation event — the state before a first-ever brand is the platform default, which needs no row. Recording a `'created'` row anyway would push the "the oldest row might mean 'go back to nothing'" distinction into application logic instead of the schema.

---

## DECISION-058: The blob storage adapter lives at `src/lib/storage/`, not folded into `src/lib/db/domain/`

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice c, Phase 3)

DECISION-030 requires that no caller query the blob table directly — reads and writes go through a service interface. That interface is a small abstraction boundary, the same category as `src/lib/authz.ts` or `src/lib/brand/`, not a schema module in the shape every other `domain/` file is. `src/lib/storage/blob-store.ts` holds the interface and the Postgres-backed implementation; `src/lib/db/domain/assets.ts` holds only the `blobAssets` table definition, imported by the storage module and nothing else.

---

## DECISION-057: The ramp generator implements sRGB↔OKLCH conversion inline rather than adding a colour-science dependency; the property test samples a deterministic grid, not a fuzzer

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice b, Phase 3)

`generate.ts` needs OKLCH math beyond what `contrast.ts` provides, and the property test needs to sweep a large seed space. Both could reach for a dependency (`culori`, `fast-check`); neither is pre-approved and neither has a second consumer anywhere in the tree. Transcribing Ottosson's reference OKLCH formulas inline is ~40 lines — small and auditable, consistent with DECISION-048's dependency discipline. The property test uses a fixed, deterministic grid (hue × chroma bands × named edge seeds) rather than randomized fuzzing, so a CI failure is reproducible by seed value alone.

---

## DECISION-056: Slice c's public/anonymous brand read path is deferred to P3; slice c ships tenant storage, `(org)` membership-scoped emission, and `(admin)`-only write/preview only

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice c, Phase 2 re-run)

Neither the DECISION-041 published-content projection, nor the `(public)` route group, nor a `sites`/publish-status model exist yet. `publicOrgSummary()` is the DECISION-040 mechanism — a bare-grant read on `organizations`, gated on slug existence, never `platform_status` — not the DECISION-041 projection, and its bare-grant access pattern is explicitly forbidden for `organization_brands` by DECISION-049 ("no public grant on this table, ever"). Pulling a minimal projection forward would mean inventing a throwaway publish-gate with no real data model behind it, which P3 would have to reconcile against its actual `sites` state machine later — the same duplication DECISION-055 was just ruled out for storage. There is also currently zero anonymous consumer of a public brand read (no public site, no presbytery directory), so nothing is lost by deferring. **Corrects the decomposition table's "slice c blocks P3"**: slice c still supplies the schema P3 needs, but P3 now owns building the DECISION-041 projection and wiring brand into it as a field — not inheriting a working public path for free. `EMITTERS[0]` (`(org)/o/[slug]/layout.tsx`) in `check-brand-scope.mjs` flips to `required: true` once slice c wires `<BrandTokens>` there; `EMITTERS[1]` (`(public)/site/[slug]/layout.tsx`) stays `required: false` until P3 creates the file, per the tripwire's own reviewable-diff-at-creation design.

---

## DECISION-055: Slice c builds DECISION-030's storage adapter now, scoped to the blob table and service interface only; the logo is its first consumer, not person photos

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice c, Phase 2 re-run)

DECISION-030's own Impact section states the blob table and service interface are unbuilt; slice c's plan to "ride" that adapter had nothing to ride. Building a brand-specific asset path instead was rejected: it would contradict the original Phase 2's own ruling that "the adapter is not what diverges — the authorization wrapped around it is," and would recreate the exact "two homes" storage-duplication failure G9 already named for tokens. Slice c builds the tenant-scoped, composite-keyed blob table plus a minimal `resolve`/`store` service interface and wires the logo as its only caller; it does not touch `people.photo_key` or migrate any photo code, since none exists yet. Closes the "Photo storage service... unbuilt" line in `docs/TODO.md`.

---

## DECISION-054: `--accent`/`--accent-foreground` gets a role, a token mapping, and a contrast floor; the contract's closed vocabulary had a gap

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice b, Phase 2 re-run)

`contract.ts` classified `--accent` `bounded` (a constraint the slice-b generator must implement) but declared no `BRAND_ROLE`, no `ROLE_TO_TOKEN` entry, and no `LEGAL_PAIRS` floor for it — the generator could touch a token with nothing checking its output. Patch: add `"accent"`/`"on-accent"` to `BRAND_ROLES`, `accent: "--accent"` / `"on-accent": "--accent-foreground"` to `ROLE_TO_TOKEN`, and `{ fg: "on-accent", bg: "accent", min: 7, kind: "body", derives: "D1" }` to `LEGAL_PAIRS`, matching the existing `muted-surface` pair's shape (content-axis, 7:1). Lands as a follow-up patch to slice 0's already-shipped file, before slice b's property test is written.

---

## DECISION-053: Slice a is not a zero-visual-change slice, and it proves its claim with a self-comparing screenshot harness

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice a)

Three acceptance categories (pixel-identical / attributable / named); the diff-level rule that the sweep deletes class strings rather than authoring them; a Playwright `visual` project with gitignored `.visual/` baselines captured before and after on one machine, at 360 and 1280 in both schemes, zero new dependencies. Committed CI baselines need a pinned container and are deferred.

---

## DECISION-052: The brand-scope marker is the emitting component, and the tripwire has four clauses

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice a)

`<BrandTokens>` *is* the `<style>` element, so grep-presence and behaviour-presence are one fact; a `data-brand-scope` attribute would mark a wrapper DECISION-050 already ruled out. E3 (no `<style>` outside `src/components/brand/`) closes the copy-paste bypass and is enforceable today at zero violations. The consumer clause that can be demonstrated failing is **C2 (hand-rolled primitives, 44 real violations)**, not the `--brand-*` clause, which is vacuous until slice c. Palette literals are out of scope pending semantic status tokens. Emission uses `:root:root` / `:root:root.dark` for specificity rather than relying on source order, and a plain string child rather than `dangerouslySetInnerHTML`.

---

## DECISION-051: The token partition is three-way, and the platform default palette is corrected to meet its own floor

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice 0)

Brandable / bounded / platform, closed over every property `globals.css` declares, closure enforced by a test that parses the CSS. `--accent` and `--accent-foreground` are *bounded*, not brandable, because accent is menu-hover under content-axis text (later revisited — see DECISION-054, which adds accent's missing contrast floor without changing this classification). Six pairs of the current default palette fail the floors the contract declares — including `ring` on `primary` at 1.00:1, a focus ring that has been invisible on the primary button in both schemes since P0 — so slice 0 corrects five token values and adds a structural ring offset rather than shipping a contract its reference implementation violates.

---

## DECISION-050: `next-themes` is approved for the colour scheme only; the brand style element always emits both ramps

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice a)

The org flash (a congregation's colours persisting through a context switch) and the scheme flash (light/dark) are **different problems**. Server-side emission solves the first entirely and `next-themes` contributes nothing to it; `next-themes`' pre-paint script solves the second, which nothing installed currently addresses. The brand payload is emitted as a **`:root`-scoped `<style>` element — not an inline style on a wrapper div, because Radix portals and the root-layout `<Toaster>` render outside any such wrapper** — carrying both `:root{…light…}` and `.dark{…dark…}`, with `next-themes` selecting by class. Emitting only the current scheme would force a re-render on toggle and re-create the very flash next-themes exists to prevent. The style element **must be nonce-able** from day one so an enforced CSP (DECISION-024 defers this to forks) does not break every branded page. `next-themes` ships in system/localStorage mode in slice a; **S17's account-level persistence is a `users` column plus a server-rendered initial class and is explicitly not slice a** — flagged rather than shipping device-level and calling S17 satisfied.

---

## DECISION-049: Brand lives in its own tenant table with two read paths and no public grant; `theme_tokens` is struck from §14; logo assets are content-addressed

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice c)

`organization_brands` (PK `organization_id`, FORCE RLS) rather than `organization_settings.settings` jsonb, on DECISION-033's precedent — hot read path, CHECK constraints with teeth, and A7's "never echo the user's string" enforced by the **database** rather than by server-side discipline. **Not columns on `organizations`**, because that table carries a bare public grant precisely because the org tree is public — brand there would be readable by any authenticated caller with no org context, an enumeration oracle arrived at by following an existing precedent. Two read paths over one source: the RLS membership read inside `withOrgContext()`, and the DECISION-041 narrow SECURITY DEFINER published-content function, which carries the brand payload as a **field of the published projection** rather than a slug-keyed endpoint — a standalone public brand lookup is an enumeration oracle. Logo bytes ride DECISION-030's adapter unchanged; what diverges is the gate and the cache posture — content-addressed immutable URLs (the property that makes bytes-in-Postgres affordable on an anonymous path served every page load), one route handler per trust class, favicon and social card derived at write time. `theme_tokens jsonb` is removed from `docs/schema-design.md` §14 and the earlier G6 constraint on it is superseded.

---

## DECISION-048: The `radix-ui` umbrella is not adopted; generation is normalised by a wrapper and drift is a tripwire

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice a)

Two occurrences, two hand-reverts, and slice a runs `shadcn add` ten-plus times — which is where the third occurrence becomes the *silent* one. Rejected on **supply-chain surface** (~40 packages in the audit and update path to use six, in a repo whose charter is a small auditable baseline), not on bundle size, which is roughly neutral. Instead: **`npm run ui:add`** wraps the CLI, rewrites `from "radix-ui"` to the individual packages, and restores the lockfile; **`npm run check:deps-drift`** fails the build if `radix-ui` reappears in `package.json` or any `src/` import — converting "an implementer must remember to md5 the lockfile" into a build failure. A tsconfig path alias to a local shim was considered and rejected: it fixes the import but not the dependency install, and shadowing a real package name is a resolution trap. Separately, `--radius-sm/md/lg/xl` are remapped onto `--radius` with `--radius` chosen so `rounded-md` is a no-op at today's `0.375rem`; **`--radius` is a platform token and is not per-org brandable** — a congregation does not choose corner radius.

---

## DECISION-047: The un-brandable rule is enforced by a tripwire on the emitter; the denial page, the org error boundary, and `/developer` render un-branded

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slices 0, a, c)

`scripts/check-brand-scope.mjs` asserts the brand-scope marker appears in exactly `(org)/o/[slug]/layout.tsx` and `(public)/site/[slug]/layout.tsx`, and that additive `--brand-*` utilities appear nowhere outside those groups. The DECISION-040 access-denied page is un-branded — a branded 403 tells a prober the org is a configured tenant — and this is achieved by **the brand read returning `null` for a non-member** rather than by a rule at the 403, because the org layout renders *above* the denial, ended-relationship and 404 pages by deliberate design. The org error boundary is un-branded too: it names the organization from `publicOrgSummary()` and takes **no dependency on the brand read path**, overturning the "church's masthead" half of Flow 6 — an error page that paints in the brand depends on the read that may have just failed, and colour is not what tells a visitor they are in the right place. `/developer` is exempt and already structurally so. **Un-brandable does not mean logo-free:** brand-as-chrome is scoped to two layouts; logo-as-content on a neutral plate is legal wherever the caller is authorized — otherwise someone strips the marks off the chooser to satisfy the tripwire, in the one place G3 says they matter most.

---

## DECISION-046: The brand token contract is a dependency-free data module; branding is a cascade override of the existing token set

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** `2026-08-19-brand-foundation` (slice 0)

**Branding introduces no new styling system.** It re-declares the raw custom properties `globals.css` already maps through `@theme inline`, so no component changes to become brandable — a primitive keeps writing `bg-primary`, and whether that paints platform blue or a congregation's burgundy is decided by whether an ancestor re-declared `--primary`. That is what makes the un-brandable rule mechanically true rather than aspirational.

`src/lib/brand/contract.ts` holds the closed role vocabulary, the legal-pairs matrix (**a runtime `as const` array with the type derived from it, never two hand-maintained lists**), each pair's contrast floor, the **closed partition of re-declarable vs never-re-declarable tokens** (S15 made machine-readable — semantic colours, cards, popovers, muted surfaces, inputs and borders are never re-declarable), the type scale, and `BRAND_TOKEN_VERSION`. Deliberately not `server-only` — server components, the generator, the property test, and the cron agent's instruction data all consume it — and it carries **zero runtime imports**, which is what lets it be imported from an Edge handler, a DB-less vitest run, and a `.mjs` script. `generate.ts` and `emit.ts` import it; it imports neither. The property test iterates `LEGAL_PAIRS` and reads each floor **from the pair**, so adding a pair adds its assertion and a pair whose floor was never decided cannot be added.

---

## DECISION-045: The foundation pipelines defer Phase 5 and 6 to a single operator-led verification

**Status:** Resolved · **Date:** 2026-08-19 · **Feature:** foundation program (P0, P0.5, P1)

### Decision

For the foundation pipelines only — the post-login router, the design and brand
foundation, and the org portal shell — **Phase 5 (qa) and Phase 6 (analyst) are
deferred**, not skipped. The operator is the verifier for these phases and will
verify the foundation **as a whole**, once it is coherent enough to judge.

Operator's reasoning, 2026-08-19: *"i don't want to invest in QE until we know
that we have built exactly what we want."* Independent verification of a surface
that is about to be re-skinned by the branding pass, and re-shelled by P1, would
be verifying something that will not survive.

### What is NOT deferred

Everything mechanical keeps running on every slice, because it is cheap and it
catches real defects:

- `typecheck`, `lint --max-warnings=0`, unit tests, `build`, both tripwires
- the Playwright e2e suite and the `test-rls.sql` isolation suite
- **implementers author their own tests** (the qa charter change of 2026-08-18)
  — that does not pause. QA being deferred is not permission to ship untested code.

What is deferred is the **independent judgment**: qa's PASS/FAIL/BLOCKED verdict
and analyst's shipped-vs-intent.

### The debt, and why it is tracked

Deferred verification fails when nobody remembers what was deferred. Every
pipeline that defers records a line under **Verification debt** in
`docs/TODO.md`, and the combined pass clears them by name. A pipeline that
defers without adding its line has skipped a phase silently, which CLAUDE.md
forbids.

### One item flagged as different in kind

`drizzle/0015_presby_membership_probe.sql` — the SECURITY DEFINER probe that
fixed `withOrgContext()` — was written by a **ux-developer** during a UI slice,
because that is where the defect surfaced. It changes the isolation model, it is
the third occurrence of the F26 pattern, and the agent that wrote it said itself
it wants a database-admin's eye. Deferring "did we build the right screen" is a
different risk from deferring "is the tenant gate correct." Recorded here so the
distinction is deliberate rather than accidental.

---

## DECISION-044: The destination matrix reads two platform predicates, not one; the membership/position guard is bidirectional; the 403 renders at 200 until `forbidden()` stabilises

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P0) · **Class:** implementation

Three implementation rulings taken in P0's technical design.

**(1) `canAccessAdmin` and `isPlatformAdmin` are separate inputs to `computeDestination`.** Phase 1's matrix has one column labelled `is_platform_admin`; it is two. `canAccessAdmin` (session claims: `ADMIN_ROLE` or `FEATURES.ADMIN_DASHBOARD`) is what the Edge enforces on `/admin`; `isPlatformAdmin` (`users.is_platform_admin`, read live) is the developer-portal predicate per S5/DECISION-034. Nothing seeds `is_platform_admin` today, so they are held by the same people by accident. Routing on the wrong one ships a bug either way: sending an `is_platform_admin` holder to `/admin` bounces them to `/access-pending`, and sending a `canAccessAdmin` holder straight to `/admin` makes the Developer card the operator asked for permanently unreachable. Rule: **zero orgs + `canAccessAdmin` + not `isPlatformAdmin` → `/admin`; any `isPlatformAdmin` → `/orgs`**, which satisfies both halves of the brief ("only a super admin goes straight in"; "a developer has a card").

**(2) The DECISION-039 guard is two triggers, not one.** Ending a membership under an open officer term or role grant fails loudly (the architect's ruling), **and** opening a position at an organization whose membership has already ended fails loudly — an integrity guard enforceable in one direction only is a paper invariant in the other, and the hole is reached by simply reordering the two writes. Only positions still **open** when the membership ended are constrained, so importing a congregation's historical session records for someone who has since left keeps working. Neither function is `SECURITY DEFINER`, deliberately: both read rows at the same organization as the row being written, and any write that reaches them already carries that org's `app.current_org_id`. That is the opposite case from `presby_guard_membership_insert`, which probes across orgs and must be DEFINER (F26) — the migration comment says so, or the next reader adds DEFINER as cargo cult.

**(3) The unauthorized-org page renders at HTTP 200.** DECISION-040 specifies a 403; Next's `forbidden()` is still behind `experimental.authInterrupts` (verified 2026-08-18, canary only) and enabling an experimental flag is an architect-scope config change P0 is not taking. The property DECISION-040 exists to protect — one response, byte-identical across `managed`/`invited`/`unmanaged` — is fully satisfied by the rendered page; `not-found` keeps a real 404 via `notFound()`. Revisit when the API stabilises; tracked in `docs/TODO.md`.

---

## DECISION-043: Tenant administration lives inside `(org)`; `(admin)` and `src/lib/permissions.ts` stay platform-only

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P9)

Church, presbytery, and synod administration are **one surface** at `/o/<slug>/admin/...`, gated by tenant permissions from `presby_effective_permissions()` — not three route trees, and not the inherited `(admin)` shell. Which sections render is a function of `(organization_type, effective permissions)`, matching how `section_type` already models org-type variation as data. Putting a church administrator in `(admin)` would make one shell's access depend on two incompatible axes — Edge `FEATURES.*` claims and in-transaction per-org permissions — which is DECISION-035's prohibition relocated into a route group; it is also the "platform admin is above a national admin" error wearing a nav bar. Reuse happens at the component layer: P0.5 extracts shared admin chrome into `src/components/shared/`. New pipeline **P9 — Tenant administration surface**, depends on P1, own Phase 1.

---

## DECISION-042: Staff and employment are their own domain module, not an extension of `officer_terms`

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P8)

"Staff" exists today only as a visibility level and a data-source enum. New module `src/lib/db/domain/staff.ts` — ordination is lifelong, service is termed, employment is neither, and a minister's terms of call is a third thing again. **Absence does not block P1**: portal access runs on `memberships` + `role_grants`, both of which exist (DECISION-039); do not invent a staff-based access axis, which would be a second tenancy relation competing with the one the schema is keyed on. **Absence does block P7**, and the public staff block must **not** be derived from `officer_terms` — that would publish every ruling elder to the open internet by virtue of election, violating the public-publication consent G10 requires. Compensation and terms of call are tier 2. New pipeline **P8**, depends on P1, blocks P7.

---

## DECISION-041: The public site lives at `/site/<slug>` under a new `(public)` route group; the verified custom domain is canonical

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P3)

Organization-type-neutral (presbyteries and synods get sites too), unambiguous against `/o/`, and it pairs with the editor: `/o/<slug>/site` edits what `/site/<slug>` serves. `(public)` is unauthenticated by contract: reads only through the narrow SECURITY DEFINER published-content reader, `getPlatformDb()` forbidden, no server-side session read in the page body, no `dangerouslySetInnerHTML`. Canonicalisation: a verified custom domain is canonical and self-referencing; `<slug>.presby.app` 301s to it while verification holds and **becomes self-canonical during a lapse** — the S6 fail-soft interlock, because a canonical tag pointing at broken DNS would de-index the congregation at the worst possible moment; `presby.app/site/<slug>` is never canonical, always `noindex`, an internal rewrite target that 308s on a direct hit. **Rule: canonical always points at the host currently serving verified content.**

**Correction, 2026-08-20 (`2026-08-20-public-sites` Phase 1, confirmed by the user):** This entry's routing and canonicalization contract stands unchanged — reuse it, don't re-litigate it. But this entry also implied a data model ("`/o/<slug>/site` edits what `/site/<slug>` serves") and `docs/schema-design.md` §14's `sites`/`site_pages`/`site_sections` sketch built on that implication, with a live in-browser editor ("P4 the church's site editor," `docs/STATE.md`'s queue) as its next pipeline. **That data model and that editor are both superseded, by explicit user decision, not inferred.** Public-site content instead lives in per-congregation Git repositories, staged by CI, and rendered by presby from a structured bundle (see `docs/work-log/2026-08-20-public-sites.md`) — there is no `site_pages`/`site_sections` table, and there is no in-browser WYSIWYG editor. Editing a site is a git commit, made by a platform operator pairing with Claude Code through the support-ticket loop (`2026-08-20-support-tickets`), the same as any other `content`/`config`/`theme`-class change. "P4 the church's site editor" does not survive in any form — the ticket loop is the editor. `(public)` remaining unauthenticated-by-contract, and reading only through a narrow, status-gated function rather than a bare grant, both carry forward as the correct shape for the new model too.

---

## DECISION-040: An unauthorized org deep-link names the organization; `platform_status` is what stays indistinguishable

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P0)

Supersedes the identical-404 ruling recorded in the original Phase 2 section. Four cases: active membership → enter; ended membership → named and dated; **slug resolves in the public org tree with no membership → 403 naming the organization, byte-identical across `managed` / `invited` / `unmanaged`**; slug resolves to nothing → 404. Naming the org leaks only the org tree, which is already public (§17) and which P2 is building a public search over. What must not leak is **which congregations are tenants** — commercial and pastoral information PC(USA) does not publish. The 403's org name comes from a narrow public-tree read returning name and type only, never from `presby_user_organizations`. **"Request access" is P1, not P0**: it needs a pending-request table and a notification target, and no tenant permission catalog exists to name a recipient until P1. Its Phase 1 must treat a request button behind a public org list as a mass-notification vector against every congregation in the denomination.

---

## DECISION-039: `memberships` is the universal relationship anchor; a position never grants access without one

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P0)

S10 required no query change: `officer_terms` and `role_grants` both composite-FK into `memberships(person_id, organization_id)` (`drizzle/0008_presby_domain.sql:524`, `:546`), so a position at an org is **structurally impossible** without a membership row there, and `presby_available_organizations` — which joins `memberships` with **no `current_roll` filter** — already returns the presbytery for a ruling elder on a presbytery committee. Roll status is a *column on the relationship*, not its meaning. The real defect is that the FK does not constrain `ended_on`: an active officer term can outlive its membership, silently stranding a seated officer on a date with no corresponding write (F29's shape applied to office). Fix is a trigger — **ending a membership while an open term or role grant exists at that org fails loudly, naming the term**; it never auto-ends the term, because ending a term is a minuted act. Chooser cards therefore carry **no membership language**. Stewardship still grants nothing: the card query joins `memberships` and must never join `organizations.path` or `parent_id`.

---

## DECISION-038: A custom domain gets its own org-scoped session; the platform origin remains the sole identity provider

**Status:** Resolved · **Date:** 2026-08-18 · **Feature:** `2026-08-18-backbone-and-org-sites` (P10)

S2 is overridden by S9 — but **not** by making NextAuth multi-origin. `src/auth.ts` and `src/lib/auth/config.ts` are unmodified and continue to serve exactly one origin; all credential entry, OAuth, and TOTP stay on the platform origin, which avoids an N-entry Google redirect allowlist entirely. A verified church host receives a separate, `__Host-`-prefixed, org-scoped cookie minted from a single-use handoff token.

**The isolation boundary:** a session minted on a third-party-controlled host is scoped to one organization, carries no platform authority, and cannot be exchanged for a session on any other origin. The context switcher and platform-admin route are links back to the platform origin, not surfaces served on the church's host.

The token must prove: issuer (key distinct from the session secret); audience bound to the exact host and its verified org; subject + auth time + `amr`; single use with atomic `jti` consume; TTL ≤ 60s; non-transitivity (no reverse token). Threats answered: post-verification DNS repointing (audience binding + single use), cookie tossing from a sibling host such as `mail.firstpres.org` (`__Host-` prefix, which NextAuth's default cookie name lacks), 2FA downgrade (`amr` carry-forward, challenge on the platform origin before minting). `trustHost: true` becomes a verified-host allowlist riding P5's Edge host map. **Prerequisite: `next-auth` beta.31 → beta.32 (GHSA-x445-f3h2-j279, OAuth cookies not provider-bound) ships first** — building a multi-origin handoff on a library with an open advisory about cookies not being bound to their issuer is indefensible. Own pipeline (**P10**), depends on P5, last in the program, running-server e2e gate mandatory.

---

## DECISION-037: `twoFactorRequired` stays a session-level most-restrictive-wins boolean; the Edge 2FA gate extends to `/o/*` now

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-backbone-and-org-sites` (P0)

`presby_two_factor_required()` already ORs across the user's orgs, so the current claim over-enforces rather than under-enforces, and `twoFactorVerified` is legitimately session-level because possession of a factor does not become unproven on switching congregations. Per-org refinement can therefore only ever relax the gate — the safe direction to defer in. When P1 wants it, the shape is an **additive** JWT claim (`twoFactorRequiredOrgIds`) alongside the unchanged boolean: no table changes, no migration, and `projectJWTOntoSession`'s conservative default already covers in-flight sessions. The gate move is pulled forward from P1 to P0 (one line in `src/proxy.ts`) so no tier-2 org page can ever ship ahead of it; safe because `/totp` already walks an un-enrolled user into `/account/2fa` rather than stranding them.

---

## DECISION-036: shadcn/ui is initialised properly as a P0 prerequisite, at zero new runtime dependencies; migrating existing surfaces is a separate pipeline

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-backbone-and-org-sites` (P0)

`class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot` and `lucide-react` are already installed but `src/lib/utils.ts` and `cn()` do not exist and `components.json` was never created — the design system was paid for and never taken delivery of. P0 adds `cn()`, `components.json`, exactly three generated primitives (`button`, `card`, `badge`, all server-safe), and expands `globals.css` from 6 tokens to the shadcn set while keeping every existing token name working. Blocking for P0 because the chooser is the first new user-facing page in a program explicitly asked to be consistent, and shipping the ninth hand-rolled copy of the same button string is the wrong call. The rest — 7 hand-rolled tables, 8 hand-rolled buttons, regenerating `alert-dialog.tsx`, dark-mode strategy, reconciling the 562-line `docs/ui-standards.md` with real primitives — is **P0.5 — Design foundation**, a parallel pipeline that must land before P3. `@radix-ui/react-alert-dialog` and `tw-animate-css` are pre-approved for P0.5; `next-themes` is deferred pending the dark-mode ruling.

---

## DECISION-035: Org membership is authorized in the RSC layer, never at the Edge; the org list is read per request and never cached in the JWT

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-backbone-and-org-sites` (P0)

`src/proxy.ts` enforces authentication, active status, and 2FA for `/o/*` and stops there — no `PROTECTION_RULES` entry, because `FEATURES.*` is the platform axis and org membership is the tenant axis. `resolveOrgContext(userId, slug)` resolves the slug *within the user's own membership set* and feeds `withOrgContext`, which re-checks inside the transaction. `presby_available_organizations` is dropped and recreated as `presby_user_organizations`, returning `platform_status` and `ended_on` and filtering neither — policy moves to two TypeScript wrappers, which lets one function answer "which orgs can I enter," "is my church still being set up," and "did my access end," and makes an enumeration-safe three-way response possible. Free to change today: the function has exactly one wrapper and zero call sites. The list is read per request, matching the precedent set by `developer/guard.ts` reading `is_platform_admin` live, because a JWT-cached membership list is the stale-authorization bug and buys nothing on a gate path that re-checks in-transaction anyway.

**Consequence, stated so nobody "optimizes" it back:** the Edge cannot pre-filter `/o/<slug>` by membership. That is correct, not a limitation.

---

## DECISION-034: Post-login routing splits into `/launch`, `/orgs`, and `/no-organization`; `/` stays anonymous; org URLs are `/o/<slug>` under a new `(org)` route group

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-backbone-and-org-sites` (P0)

`src/app/page.tsx` never redirects a signed-in user — it stays the anonymous backbone page, because P2 wants it static and P5 makes the meaning of `/` host-dependent. `/launch` is the single post-authentication target and holds the nine-case destination matrix as a pure, unit-tested function; `/orgs` is the chooser and never auto-forwards, so a zero-org platform admin can still reach the Developer card; `/no-organization` is the zero-org page. The org segment is the **slug**, not the id: the org tree is already public, and P5 needs the same token as the platform subdomain label. The slug is therefore **immutable** — renaming a congregation changes `name`, never `slug` — enforced by a DNS-label CHECK constraint and a column comment; a future `organization_slug_aliases` table serving 301s is the escape hatch. New route group `(org)`: auth-only and org-scoped, `withOrgContext` only, `getPlatformDb()` forbidden in the subtree, no page may assume the user arrived via the chooser. The public site tree (P3/P5) must **not** live under `/o/` — two trust surfaces must not share a URL prefix. Requires CLAUDE.md updates to Project Layout, the route-group rules, and a new `Post-Login Landing` section, which is referenced by the agent instructions today but does not exist.

---

## DECISION-033: The 2FA requirement is per-congregation, resolved at sign-in by a SECURITY DEFINER function

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-two-factor-policy`

### Decision

Whether a member must use two-factor authentication is decided by
`organization_settings.require_two_factor`, per congregation, default **false**.
A user is required if **their own `users.two_factor_required` column is set OR
any organization they hold an active membership in requires it** —
most-restrictive wins. Both remain subject to the install-wide `auth.require_2fa`
master switch.

The organization arm is resolved at sign-in by
`presby_two_factor_required(uuid)`, which is **`SECURITY DEFINER`**, and must
stay that way.

### Rationale

**Why not a feature flag.** `feature_flags` has no `organization_id` and should
not grow one. A flag is an environment toggle; a congregation's security policy
is tenant state (DECISION-003).

**Why `organization_settings` and not `organizations`.** `organizations` is
deliberately not tenant-isolated — the PC(USA) org tree is public information —
and per-org configuration already lives in settings. A typed column rather than a
key in the `settings` jsonb, because it is read on the sign-in path.

**Why most-restrictive wins.** A person can hold memberships in several
organizations; a minister of Word and Sacrament is a member of the presbytery
while serving a congregation (G-2.0502). The requirement is resolved *before* any
organization is selected — sign-in precedes the org switcher — so there is no
"current org" to consult.

**Why SECURITY DEFINER is load-bearing.** This is finding F26 in a new place. The
lookup runs on the RLS-enforced connection with no org GUC set, and none can be
set, because choosing an organization happens after authentication. A plain join
is filtered to zero rows and returns false *for exactly the users the policy
protects* — it fails silently, looks correct, and disables the feature. Measured
as `presby_app` with no GUC: the function returns **true** where the equivalent
naive join sees **0 rows**. Both are permanent assertions in
`scripts/test-rls.sql`.

### Impact

- Rewriting the org arm as a Drizzle join silently disables per-church 2FA. The
  isolation suite fails if anyone tries.
- A DB error resolving the org arm returns false — it never *newly imposes* a
  challenge on someone who has not enrolled, matching DECISION-026's posture.
- The toggle lives in the platform admin shell only because no church-facing
  admin UI exists yet.

---

## DECISION-032: The e2e suite owns its test users; no environment variables

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-e2e-owns-its-users`

### Decision

E2E fixture users are **hardcoded** in `e2e/support/users.ts` and provisioned by
`globalSetup` on every run. No `SEED_*` environment variables, and **no
`test.skip()` for missing configuration anywhere in `e2e/`**.

The dividing line: **test users are fixture data and the suite owns them; roles
and features are application catalog data and stay with `scripts/seed.ts`.** The
seeder binds users to roles that must already exist and fails loudly if they do
not. A fixture that invented its own permission catalog could pass a spec against
permissions that do not match production.

### Rationale

The env-driven arrangement had a failure mode worse than the inconvenience it
avoided: with the variables unset, `globalSetup` skipped session acquisition,
every authenticated spec skipped itself, and Playwright exited **0**. Measured
2026-08-18: `6 passed, 42 skipped` — a green suite that ran 12% of itself.

CLAUDE.md's Phase 5 gate requires e2e against a real dev server with an
MFA-enrolled user for any auth-touching change, and says a deferred check is
`BLOCKED`, never `PASS`. A suite that silently shrinks lets that gate be
satisfied by a run in which the auth specs never executed. The v0.7.0 notes cite
"48/48" for a command that today yields 6.

### Safety of a committed test password

The fixture password is not a secret and cannot become one:

- every fixture email ends in `@example.invalid`, a reserved TLD (RFC 2606) that
  can never resolve
- `seed-users.ts` **refuses** to provision any user whose email lacks that
  suffix, so the code cannot touch a real account even pointed at the wrong database
- the DB isolation guard still runs first

### Impact

- `npm run test:e2e` works from a clean checkout with a database and
  `npm run db:seed`; nothing else to configure.
- Prerequisites that remain now **fail loudly**: absent role catalog, and
  `RATE_LIMIT_DISABLED` (sign-in is capped at 5/min per `ip:email`, and a blocked
  attempt renders as "Wrong email or password" with `failed_login_attempts` at 0
  — indistinguishable from a bad password without this check).
- `scripts/seed.ts` keeps its `SEED_ADMIN_*` path for a human wanting a local
  login. It is no longer load-bearing for tests.

---

## DECISION-031: The training deck is removed from presby

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** `2026-08-18-remove-deck`

### Decision

`deck/` is deleted, along with the four `deck:*` npm scripts, the CLAUDE.md
re-render rule, and the `/pre-push` deck-staleness check. **DECISION-005
(committing the rendered PDF) is superseded** — there is no deck to render.

### Rationale

The deck is a *Claude Code training* artifact inherited from the starter — its
own frontmatter reads header "Working with Claude Code", footer
`github.com/chenson42/claudecode-nextjs-starter`. presby is a church platform.
Carrying a presentation about a different subject meant carrying a behavior rule,
a pre-push check, four scripts, and ~10 MB of committed binaries for something
this project does not present.

Operator decision, following the open question raised by the identity pass.

### Impact

- Git history retains the deck blobs. No history rewrite: the repo is already
  pushed, nothing in the deck is sensitive, and rewriting shared history to
  reclaim ~10 MB is a bad trade.
- `/personalize-starter` still has a "keep the deck?" step; it deletes a
  directory that is already gone, which is a harmless no-op.
- If presby ever wants a deck of its own, it starts from a blank file about
  presbyteries — not from an edit of this one.

---

## DECISION-030: Person photos live in the database for now, behind a pluggable storage service

**Status:** Resolved
**Date:** 2026-08-18
**Feature:** open question §18.4 / finding F13

### Decision

Store person photo bytes **in Postgres for now**, but reach them only through a
storage service interface — never by querying the blob table directly from a
page, an action, or a component. Moving to object storage later must be a change
of one adapter, not a change of every call site.

`people.photo_key` stays as it is: an opaque key, not a URL and not bytes. The
adapter resolves a key to a stream or a URL. A database adapter returns bytes
from a blob table; a cloud adapter returns a signed URL. Callers cannot tell the
difference, and that is the whole point.

### Rationale

The operator's call: nothing is live, no congregation has uploaded a photo, and
provisioning a bucket now buys nothing except a second system to configure and
secure before there is anything to put in it. Database storage also inherits
tenant isolation for free — a blob table is a tenant table, so RLS covers it,
where an object store needs its own path-scoping scheme that RLS cannot enforce.

**This deliberately overrides F13**, which said to move to object storage
*before* Phase 1 ships, not after, on the grounds that `bytea` bloats the
database and every backup (`../fpcw-directory` already carries base64-in-text and
it is a known smell). That cost is real and is accepted knowingly. The service
boundary is the mitigation: F13's warning was about being *unable* to move
cheaply, and an adapter is what makes the move cheap.

### Impact

- A blob table is required (photo bytes keyed by `photo_key`, tenant-scoped with
  the composite key every tenant table carries) plus the service interface. Both
  are unbuilt — tracked in `docs/TODO.md`.
- Any code that reads a photo goes through the service. A direct query against
  the blob table from a page or action is a review failure, because it is
  precisely what makes the eventual migration expensive.
- Revisit when photo bytes are a measurable share of database size or backup
  time, or when the first tenant with a full directory of photos lands —
  whichever comes first.

---

## DECISION-029: Periodic reviews consolidated into two recurring slots; work-log template is the single handoff format

**Status:** Resolved
**Date:** 2026-07-11
**Feature:** `2026-07-11-instruction-layer-slim`

### Decision

**1. Review slots.** The eight independent review cadences are consolidated into two recurring slots: a **release slot** (14 days, or at each release if sooner: `test-coverage` + `retrospective`) and a **monthly health-check** (30 days, one bundled session: `code`, `documentation`, `security`, `agent-instruction`, `dependencies`). Fork-only syncs (`upstream-sync` 14 d, `downstream-sync` 30 d) are unchanged. Each review type keeps its own line in `docs/reviews/log.md`, preserving per-type history.

**Why:** eight weeks of log history showed the 7-day reviews ran once (2026-05-17) and the 30-day reviews were executed in batch sessions anyway (all on 05-17, again on 07-01). The independent cadences produced overdue-review noise at session start without producing more frequent reviews. Two slots match observed practice; the session-start cadence check now has two dates to evaluate instead of eight.

**2. Handoff format.** `docs/work-log/_template.md` is the single canonical per-phase handoff format. The generic "standard handoff template" previously duplicated in all nine agent files (and conflicting with the template's structured sections) is removed; agent files point at the template instead.

### Consequences

- `test-coverage` and `retrospective` cadence moves 7 d → 14 d (or per-release, whichever is sooner).
- CLAUDE.md → Periodic Reviews, `docs/reviews/log.md` header, and the qa / tech-lead agent files reflect the slots.
- If reviews start slipping under the bundled model (e.g., health-checks routinely >45 days), revisit — the slots are a floor, not a ceiling.

---

## DECISION-028: `api/webhooks/` subtree is the sanctioned location for inbound webhook handlers; disabled-when-unset returns 200 not 5xx

**Status:** Resolved
**Date:** 2026-07-02
**Feature:** `2026-07-02-email-observability`

### Decision

The first webhook handler in the starter (`/api/webhooks/resend`) establishes the following conventions for all subsequent webhook integrations:

**1. Placement:** All inbound webhook route handlers live under `src/app/api/webhooks/<provider>/route.ts`. No webhook handler belongs in `api/admin/` (admin requires auth; webhooks authenticate via signature) or at the top level of `api/` (flat namespace does not scale when multiple providers are integrated).

**2. Signature verification is the route handler's responsibility.** Each handler verifies its own provider signature before doing anything else. The proxy (`src/proxy.ts`) does not participate in webhook authentication — it bypasses the auth gate for `api/webhooks/*` paths, leaving signature verification entirely to the route handler body. This is correct because (a) the proxy cannot read the raw body without consuming it, and (b) each provider has a different signature scheme.

**3. Disabled-when-unset posture:** When the required env var (e.g., `RESEND_WEBHOOK_SECRET`) is absent, the handler returns **HTTP 200** with a JSON body indicating the webhook is not configured — **not 503 or 401**.

Rationale: 503 (Service Unavailable) is a retryable status code. Any webhook provider that delivers to an endpoint returning 503 will retry indefinitely. A missing env var is a permanent configuration state, not a transient failure. Returning 200 acknowledges the delivery and terminates it cleanly. The response body `{received: false, note: "Webhook not configured."}` distinguishes this case from a successful handled delivery `{received: true, handled: true}` in server logs.

401 is also wrong — it implies the caller could authenticate if it provided different credentials, which is not the case when the server has no secret to compare against.

**4. Unknown event types return 200.** A webhook handler must never return 4xx or 5xx for an event type it does not recognize. Providers retry on 4xx/5xx. Returning 200 with `{received: true, handled: false}` acknowledges the event without triggering a retry storm. This is the correct posture for forward-compatibility: the provider may introduce new event types that the starter does not handle yet.

**5. 500 is acceptable for transient DB errors.** A DB-unavailable condition during an otherwise-valid signed webhook event is a server-side transient failure. Returning 500 allows the provider to retry after the DB recovers. This is the one case where a 5xx is appropriate.

### Convention going forward

Any new webhook integration (Stripe, GitHub, etc.) placed in `src/app/api/webhooks/<provider>/route.ts` must:
- Check for its required env var and return 200 + `{received: false, note: "..."}` if absent
- Verify the provider signature before reading the event body (and return 400 on invalid signature — providers do NOT retry 400s, which is the correct behavior for a genuine bad-signature rejection)
- Return 200 + `{received: true, handled: false}` for unknown event types
- Return 200 + `{received: true, handled: true}` on successful processing
- Return 500 only for transient server errors (DB down, etc.)

The proxy `PUBLIC_PATHS` or equivalent `api/webhooks/*` bypass must be confirmed for each new provider path — the proxy must not redirect to sign-in before the handler can verify the signature.

### What is NOT changed

- `src/proxy.ts` route gating logic is unchanged. `api/webhooks/*` paths fall through the proxy without an auth redirect by virtue of being in the `api/` subtree (which the proxy does not redirect to sign-in). This must be verified in Phase 3 for any new webhook path.
- No new npm dependencies from this decision (the svix-vs-hand-rolled ruling is a Phase 4 implementation choice, not an architectural decision).

### Impact

- Establishes `src/app/api/webhooks/` as the canonical webhook handler location.
- `src/app/api/webhooks/resend/route.ts` is the first concrete instance.
- No existing files are changed by this decision.

---

## DECISION-027: Maintenance cron route is a sibling to the operational cron route; `vercel.json` carries both schedules

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-token-gc`

### Decision

Background maintenance tasks (token GC, data pruning, housekeeping sweeps) live in a dedicated `/api/cron/maintenance` route handler (`src/app/api/cron/maintenance/route.ts`), separate from operationally-critical background workers. The existing `/api/cron/email-queue` route's contract — "process pending outbound email" — is not extended with unrelated tasks.

Both routes share the `CRON_SECRET` environment variable for authentication. Both schedules live in `vercel.json` under `"crons"`. Schedules are independent: email-queue runs every 5 minutes; maintenance runs daily at 03:00 UTC (`"0 3 * * *"`).

### Rationale

1. **Separation of operational vs. maintenance concerns.** `/api/cron/email-queue` is an operational worker — a failure there delays email delivery for real users. `/api/cron/maintenance` is a housekeeping sweep — a failure there leaves stale rows in the database but does not affect user-facing flows. Coupling them forces maintenance failures to appear as email-queue failures (or vice versa) in logs, making incident triage harder.

2. **Independent schedules.** Email delivery requires a 5-minute cadence; token GC needs daily cadence at most. Running GC every 5 minutes is wasteful; running email processing once daily is dangerous. Separate routes allow independent scheduling without a branching dispatch table inside a single handler.

3. **Extensibility.** A dedicated `/api/cron/maintenance` route is the natural home for future maintenance tasks (email queue row pruning, audit_events archiving, etc.) that forks will add. A single handler with a clear "maintenance" contract is easier to extend than a mixed-concern email handler.

4. **Teaching artifact clarity.** A fork developer reading the project's cron configuration should immediately understand that there are two kinds of background work: operational (email-queue) and maintenance. Two named routes make this distinction obvious without reading the handler bodies.

### `vercel.json` shape (approved)

```json
{
  "crons": [
    { "path": "/api/cron/email-queue", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/maintenance", "schedule": "0 3 * * *" }
  ]
}
```

### Convention going forward

- New operational cron workers (e.g., a Stripe webhook reprocessor) get their own `/api/cron/<feature>` route with an appropriate schedule.
- Additional maintenance tasks (row pruning, archiving) are added to `/api/cron/maintenance` as additional DELETE statements in the same handler, not as new cron routes.
- `CRON_SECRET` is the single shared authentication mechanism for all cron routes. No new cron-specific env vars.

### What is NOT changed

- `/api/cron/email-queue` handler and schedule are unchanged.
- `CRON_SECRET` semantics are unchanged.
- No new npm dependencies.

### Impact

- Adds `src/app/api/cron/maintenance/route.ts`.
- `vercel.json`: adds second cron entry for the maintenance route.

---

## DECISION-026: Fail-open requirement for auth-critical feature flags; named wrapper pattern in `src/lib/auth/`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-auth-mode-flags`

### Decision

Feature flags that gate an authentication path (sign-in, credential validation) MUST use explicit fail-open handling at the check site. The standard `isFlagEnabled(key)` function is NOT safe to use directly for auth-critical flags because it returns `false` on a missing row or DB error — and `false` on a flag that means "allow this auth path" translates to "deny all sign-ins during a DB blip."

**Required pattern for auth-critical flags:**

```typescript
// Named helper in src/lib/auth/ with explicit fail-open semantics
export async function isLocalLoginEnabled(): Promise<boolean> {
  try {
    const row = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, "auth.local_login"),
    });
    // row undefined (flag not yet seeded) → treat as enabled (fail-open)
    // row.enabled false → explicitly disabled by an admin
    return row === undefined ? true : row.enabled;
  } catch {
    // DB unreachable → fail-open: never lock out credentials sign-in due to a DB blip
    return true;
  }
}
```

The helper is named, unit-testable (same DI pattern as `src/lib/auth/lockout.ts`), and documents the fail-open rationale in its own body.

### Classification rule

A flag is "auth-critical" if its `false` value prevents an authentication path from completing AND the flag is expected to be `true` in the vast majority of deployments.

`auth.local_login` meets both criteria. `auth.require_2fa` does NOT — its `false` value means "no forced 2FA," which is the safe and expected default; fail-closed on `false` is correct there.

### Standard `isFlagEnabled()` semantics (unchanged)

`isFlagEnabled(key)` returns `false` on a missing row. This is the correct default for feature-toggle flags (missing flag = feature is off). It must NOT be used for auth-blocking flags without a fail-open wrapper.

### Convention going forward

Any future flag whose `false` value blocks a sign-in or sign-up path must use an explicit fail-open wrapper, not `isFlagEnabled()` directly. The wrapper lives in `src/lib/auth/` and includes a `catch → true` block with a comment naming the blip-safety rationale.

### What is NOT changed

- `isFlagEnabled()` semantics are unchanged.
- `auth.require_2fa` uses standard `isFlagEnabled()` — its fail-closed-on-missing behavior is correct.
- No new npm dependencies.

### Impact

- Adds `src/lib/auth/local-login.ts` (or equivalent) with `isLocalLoginEnabled()` and a companion unit test.
- `src/auth.ts` `authorize()`: replaces any direct `isFlagEnabled("auth.local_login")` call with `isLocalLoginEnabled()`.
- `scripts/seed.ts`: registers `auth.local_login` with `enabled: true` and `auth.require_2fa` with `enabled: true`.

---

## DECISION-025: Per-account lockout state — two columns on `users`; logic in `src/lib/auth/lockout.ts`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-account-lockout`

Two architectural sub-decisions bundled because they answer the same question: where does lockout state and lockout logic live?

### Sub-decision 1 — Schema: two columns on `users`, not a separate table

`failedLoginAttempts` (integer, NOT NULL, default 0) and `lockedUntil` (timestamptz, nullable) are added directly to the `users` table in migration 0005.

**Rationale:**

1. `authorize()` already fetches the user row by email before any lockout check can fire. Adding two columns to that row eliminates a second roundtrip — no join, no separate fetch.
2. The `users` table already holds auth-state columns in this neighborhood (`isActive`, `lastLoginAt`, `twoFactorRequired`). Lockout state is logically a property of the user's authentication posture, not a separate entity.
3. A `user_lockout` separate table would force every lockout check through a join, complicating the `authorize()` read path with no benefit at the starter's scale.
4. The npvitals reference (`src/lib/auth.ts:8-9`) confirms two columns on `users` are sufficient.

**Index guidance:** No index on `failed_login_attempts` or `locked_until` is warranted. Both columns are accessed only on a row already retrieved by primary key.

**Width tradeoff acknowledged:** The `users` table grows to 13 columns. Forks with very wide `users` tables and tight row-width budgets can extract to a `user_lockout` table; this decision documents the starter's default.

### Sub-decision 2 — Logic: `src/lib/auth/lockout.ts`, DI'd pure helper

The lockout evaluation logic is extracted to `src/lib/auth/lockout.ts` following the exact shape of `src/lib/auth/sign-in-gate.ts` (DECISION-015 precedent): pure functions, injected dependencies, no direct `db` import inside the module. Actual DB writes stay in `authorize()` where `db` is in scope.

The helper exports:
- `checkLockout(user: { failedLoginAttempts: number; lockedUntil: Date | null }, now: Date): { locked: boolean; resetCounter: boolean }` — pure, synchronous. `resetCounter: true` when the lock window has expired (signals `authorize()` to reset the counter before bcrypt, giving the user a fresh window rather than immediately re-locking on next failure).
- `LOCKOUT_THRESHOLD = 5` — failure count that triggers a lock.
- `LOCKOUT_DURATION_SECONDS = 900` — fifteen minutes.

**Convention going forward:** Any future auth-adjacent guard logic that requires unit-testable evaluation without a real database follows the same DI'd pure-function pattern in `src/lib/auth/`. Helper evaluates state; caller handles persistence.

### What is NOT changed

- No new npm dependencies.
- No `src/proxy.ts` changes (lockout runs in Node runtime `authorize()`, not at the Edge).
- No admin UI for lockout state (out of scope for this iteration; tracked in `docs/TODO.md`).
- OAuth sign-ins are unaffected — `authorize()` is credentials-only; `evaluateSignIn()` is unchanged.

### Impact

- `src/lib/db/schema.ts`: add `failedLoginAttempts` and `lockedUntil` to `users`.
- `drizzle/0005_*.sql`: generated via `npm run db:generate`.
- Adds `src/lib/auth/lockout.ts` with `checkLockout()`, `LOCKOUT_THRESHOLD`, `LOCKOUT_DURATION_SECONDS`.
- Adds `src/lib/auth/lockout.test.ts` with unit tests (pure logic, no DB mock needed).
- `src/auth.ts` `authorize()`: insert lockout check + conditional-increment UPDATE + success-path reset.
- `src/lib/audit.ts` `AUDIT_ACTIONS`: add `USER_ACCOUNT_LOCKED: "user.account_locked"`.
- `src/app/(password-reset)/reset-password/` action: reset both lockout columns in the password-update batch.

---

## DECISION-024: Report-only CSP posture — starter ships `Content-Security-Policy-Report-Only`; enforced CSP deferred to forks

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-security-headers`

### Decision

The starter ships `Content-Security-Policy-Report-Only` — not an enforced `Content-Security-Policy`. An enforced CSP is explicitly deferred to forks as a follow-on hardening step.

### Rationale

1. **Static `next.config.ts` headers cannot generate nonces.** Enforced CSP with `'unsafe-inline'` in `script-src` or `style-src` provides minimal protection — an attacker who can inject a `<script>` tag can inject inline JS that the `'unsafe-inline'` directive permits. Real CSP security requires nonce-based or hash-based `script-src` that removes `'unsafe-inline'`. Nonce generation requires per-request middleware (the nonce must be injected into both the HTTP header and the `<script>` tag in the same request). That is out of scope for a `next.config.ts` static-header approach. Shipping an enforced `'unsafe-inline'` CSP would give the false impression of protection.

2. **Report-only is safe to start loose.** Violations surface in devtools and any connected `report-uri` endpoint without breaking the app. This gives fork developers visibility into what a tighter policy would catch before they commit to enforcement.

3. **The starter is a fork baseline, not a production app.** A CSP that is enforced prematurely and breaks a fork's first third-party integration is a worse outcome than a report-only posture that forks can gradually tighten.

### Fork-tightening path (to be documented in code comment)

1. Deploy report-only. Observe violations for several days in devtools or a `report-uri` aggregation endpoint (add `/api/csp-report` + a route handler).
2. Narrow directives based on observed violations. For any new external script or font, add the domain rather than keeping `'unsafe-inline'`.
3. Add nonce generation in `src/proxy.ts` (or a custom Next.js `middleware.ts`) and pass the nonce to `<Script>` components. Remove `'unsafe-inline'` from `script-src`.
4. Rename the header key from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.

### Convention going forward

`Content-Security-Policy-Report-Only` is the sanctioned CSP header key in this starter. No enforced `Content-Security-Policy` header is shipped. Any PR that adds an enforced CSP must go through the full pipeline with a Phase 2 ruling on nonce strategy.

### Directive set (approved for initial implementation)

```
default-src 'self'
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
img-src 'self' data: https://lh3.googleusercontent.com
font-src 'self'
connect-src 'self'
frame-src 'none'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

### What is NOT changed

- No new npm dependencies.
- `next.config.ts` is the only file touched.
- No runtime code; headers are static strings.

### Impact

- `next.config.ts`: adds `Content-Security-Policy-Report-Only` to `securityHeaders`; drops `preload` from `Strict-Transport-Security`; adds `allowedDevOrigins: ["*.trycloudflare.com"]` to `nextConfig`.
- A comment in `next.config.ts` at the CSP entry documents the fork-tightening path.
- A comment at `Strict-Transport-Security` explains why `preload` is intentionally omitted.
- A comment at `allowedDevOrigins` identifies it as a dev tunnel accommodation; fork owners who do not use Cloudflare tunnels may remove it.

---

## DECISION-023: TZ posture (write-local / read-UTC) and APP_VERSION (JSON import at build time)

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

Two implementation decisions bundled because they both answer "what does the client send to the server?" for the feedback form.

### Sub-decision 1 — TZ posture: write-local / read-UTC (option b)

The `feedbackPromptState` table stores `lastSnoozedDate` and `lastSubmittedDate` as `'YYYY-MM-DD'` text in the member's **local** timezone, derived from a client-provided `tzOffsetMinutes` field. The server-side `shouldShowFeedbackPrompt` check reads UTC "today" (`new Date().toISOString().slice(0, 10)`) to determine whether to suppress the prompt card.

This creates a known asymmetry: a member in UTC-8 who submits at 11 PM local time (7 AM next UTC day) will write `lastSubmittedDate = "YYYY-MM-DD"` (their local date), but the next server render will compare against UTC "today" — which may already be the following day. In practice this means the suppression could fail to trigger for a narrow midnight window. This is acceptable for a template — the alternative (option c, a `timezone` IANA column on `users`) requires schema work and a UI to set it, which is out of scope.

**Implementation rule:** `computeLocalDate(tzOffsetMinutes: number | null | undefined): string` is a private helper in `src/app/(member)/feedback/actions.ts`. It clamps `tzOffsetMinutes` to `[-720, +840]` (the full valid IANA range) and falls back to 0 (UTC) when the value is `null` or `undefined`. This handles the `429ed48` null-narrowing case from the huddleup reference.

```typescript
function computeLocalDate(tzOffsetMinutes: number | null | undefined): string {
  const offset = typeof tzOffsetMinutes === "number"
    ? Math.max(-720, Math.min(840, tzOffsetMinutes))
    : 0;
  const localMs = Date.now() - offset * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}
```

The `tzOffsetMinutes` value is captured from `new Date().getTimezoneOffset()` at submit/snooze time (in the client component) and passed as part of the action payload. It is clamped server-side regardless of what the client sends.

**CLAUDE.md note:** the "Feedback and Dev-Loop Wiring" invariant subsection documents this asymmetry explicitly so fork developers understand it is intentional, not a bug.

### Sub-decision 2 — APP_VERSION: JSON import at build time via `src/lib/version.ts`

The feedback form's bug-category context block displays the current app version. The starter does not have a version utility. Options considered:

1. `next.config.ts` build env (`env: { NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version }`) — requires touching `next.config.ts` and adds a `NEXT_PUBLIC_` env that shows in the client bundle explicitly.
2. `import pkg from "../../package.json"` in a `src/lib/version.ts` module — `resolveJsonModule: true` is already in `tsconfig.json`; the import is resolved at compile time; the version string is a build-time constant included in the client bundle.
3. Drop appVersion from v1 — loses useful bug context.

**Decision: option 2** — `src/lib/version.ts` with a plain JSON module import.

```typescript
// src/lib/version.ts
// Build-time constant — resolved from package.json at compile time.
// No 'server-only' marker: FeedbackForm is a 'use client' component that imports this.
// The version string is not sensitive and safe in the client bundle.
import pkg from "../../package.json";
export const APP_VERSION: string = pkg.version;
```

The relative path from `src/lib/version.ts` to the project root is `../../package.json`. This resolves correctly. No new dependencies; no `next.config.ts` change. The string is baked in at build time — a rebuild is required for version changes (which is already required for any code change).

### What is NOT changed

- No new npm dependencies.
- No `next.config.ts` changes.
- No user-visible schema column for timezone (IANA string column deferred).

### Impact

- Adds `src/lib/version.ts`.
- `src/app/(member)/feedback/actions.ts`: contains `computeLocalDate` helper; `tzOffsetMinutes` is an optional nullable field in `submitFeedback` and `snoozeFeedbackPrompt` inputs.
- CLAUDE.md: "Feedback and Dev-Loop Wiring" Key Invariants subsection documents the UTC-read / local-write asymmetry.

---

## DECISION-022: SessionStart hook convention — `.mjs` with `@neondatabase/serverless`; registered in `.claude/settings.json`; prompt-injection boundary is count-only output

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

### Decision

SessionStart hooks for this starter are written as Node ESM scripts (`scripts/*.mjs`) and registered in `.claude/settings.json` under the `hooks.SessionStart` array. The feedback hook specifically uses `@neondatabase/serverless` for a direct HTTP query rather than `tsx` + Drizzle.

**Implementation conventions derived from this decision:**

1. **Script extension:** `.mjs`, not `.ts`. Consistent with the existing `scripts/` convention (`check-audit-coverage.mjs`, `commit-msg.mjs`, `stats-escape.mjs`). No compile step, no tsx invocation — a hook must be fast and have zero friction on a fresh fork that has only run `npm install`.

2. **Query mechanism:** `@neondatabase/serverless`'s `neon(DATABASE_URL)` tagged-template SQL. This package is already a production dependency — it is always present after `npm install` without any additional installation. It makes a single HTTP request and returns the result. No ORM initialization, no schema import, no TypeScript compilation.

3. **Silent-skip invariant:** The script reads `DATABASE_URL` from `.env.local` in the project root (using `fs.readFileSync` in a try/catch). If the file is absent, the var is missing, or the DB query throws for any reason, the script exits 0 with no output. The hook is informational only; it must never block session startup.

4. **Prompt-injection boundary (non-negotiable):** The hook prints ONLY a count integer and static operator instructions authored in the script source. It NEVER fetches or prints any feedback body, category, submitter name, or any other member-supplied content. The query is always `SELECT count(*) FROM feedback WHERE status = 'new'` — a scalar integer. This boundary must be stated in the script's header comment and is enforced by code review.

5. **`.claude/settings.json` registration:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/feedback-check.mjs"
          }
        ]
      }
    ]
  }
}
```

   The existing `permissions` key remains at the top level alongside `hooks`. Tech-lead should verify the exact hook format against Claude Code's hook documentation when implementing; the shape above matches the `update-config` skill's documented convention but Claude Code hook syntax evolves.

6. **Project-scoped (not user-scoped).** The hook lives in `.claude/settings.json` (checked into the repo), not in the user's `~/.claude/settings.json`. This means the hook fires for any Claude Code session in this project directory — for both the project author and any contributor who checks out the repo. This is the correct scope for the teaching-artifact and dev-loop posture.

### Rationale

**Why `.mjs` over `.ts`?** `tsx` is a devDependency present after `npm install`, so it IS available. But a SessionStart hook fires before any work has begun — before the dev server, before a build. Requiring tsx execution adds a compilation step, and any TypeScript error in the script (e.g., a missing type for an imported Drizzle schema that changed) could silently cause the hook to error. A `.mjs` with `@neondatabase/serverless` is simpler, faster, and cannot be broken by schema changes.

**Why `@neondatabase/serverless` over Neon MCP?** The hook must work on any fork — including forks that do not configure the Neon MCP. `@neondatabase/serverless` is a production dependency that every fork inherits by default. The huddleup implementation shelled out to `psql`; that approach requires psql installed locally and a `DATABASE_URL_UNPOOLED` var (direct connection, not pooled). The HTTP-based `neon()` client uses the standard `DATABASE_URL` (pooled is fine for a single query) and requires no local tooling beyond Node.

**Prompt-injection rationale.** Feedback body is user-supplied content. A malicious member could submit a body containing LLM instruction text designed to hijack the next Claude Code session that reads it. The only safe output from a hook that reads untrusted-user data is a count integer and literal strings from the script source. This is a hard security constraint documented here so it survives any future refactoring.

### What is NOT changed

- No new npm dependencies.
- No schema change.
- Existing `.claude/settings.json` `permissions` block is unchanged; `hooks` is a new top-level sibling.

### Impact

- Adds `scripts/feedback-check.mjs`.
- Adds `hooks.SessionStart` block to `.claude/settings.json`.
- CLAUDE.md: adds session-start checklist step (see CLAUDE.md changes enumerated in Phase 1 of the feedback work-log).

---

## DECISION-021: No `_components/` sub-convention in route groups; page-local interactive components colocated as named files; cross-route-group member actions in `(member)/<feature>/actions.ts`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

### Decision

Two sub-decisions bundled because they answer the same question: where does interactive or shared code live when it doesn't clearly belong to a single page?

**1. `_components/` is NOT a convention in this starter.**

Some Next.js projects create `_components/` subdirectories within route groups (e.g., `(member)/home/_components/FeedbackPromptCard.tsx`). This starter does NOT use this pattern.

Reason: `_components/` is an ad-hoc local convention with no official Next.js meaning. Downstream forks that copy this pattern without understanding the precedent will apply it inconsistently — some routes get `_components/`, some don't, and the distinction between "local component" and "shared component" blurs. The starter's two-tier system is cleaner:

- **Colocated at page level:** components used only by one page live as named `.tsx` files alongside `page.tsx` in the same directory (e.g., `src/app/(admin)/admin/users/[id]/deactivate-card.tsx`, `src/app/(admin)/admin/users/[id]/two-factor-card.tsx`). This pattern is already established in the codebase.
- **`src/components/shared/`:** components used by more than one route group or page. No `src/components/admin/` directory has been created yet — colocated admin components handle that need. If the admin surface grows to a point where shared admin components accumulate, a `src/components/admin/` directory can be introduced via a separate DECISION.

For the feedback feature specifically:
- `FeedbackPromptCard` (client island, used only at `/home`) → `src/app/(member)/home/feedback-prompt-card.tsx`
- `FeedbackForm` (used at `/home` dialog AND `/account` form) → `src/components/shared/feedback-form.tsx`
- `FeedbackStatusControl` (admin triage client island, used only at `/admin/feedback`) → `src/app/(admin)/admin/feedback/feedback-status-control.tsx`

**2. Cross-route-group member server actions live in `(member)/<feature>/actions.ts`.**

When a server action is needed from two different route groups (e.g., `submitFeedback()` is called from both `(member)/home` and `(account)/account`), the action lives in a named subdirectory under the primary route group that owns the feature: `src/app/(member)/feedback/actions.ts`.

Why not `src/lib/`? `src/lib/` is for pure server-side utilities, ORM helpers, and cross-cutting infrastructure — not for product-level mutations with auth checks and rate limits. Putting `submitFeedback()` in `src/lib/` would break the separation between "library code" and "application code that happens to be shared."

Why not colocated with the home page? `src/app/(member)/home/actions.ts` would force the account page to import from the home page's directory, which is semantically wrong (the account page doesn't "belong" to the home page's module). A sibling directory `(member)/feedback/` is semantically correct: it's a feature module within the member route group.

Cross-group import: `import { submitFeedback } from "@/app/(member)/feedback/actions"` from `(account)/account/page.tsx` is allowed. Next.js route groups are organizational and do not create module isolation boundaries — the parentheses affect URL structure only, not module resolution.

### Convention going forward

- No new `_components/` directories.
- Page-local interactive components: named `.tsx` colocated with `page.tsx`.
- Shared cross-route-group components: `src/components/shared/`.
- Member-facing server actions used from multiple route groups: `src/app/(member)/<feature>/actions.ts`.
- Admin-only server actions: colocated `actions.ts` in the admin page directory.

### What is NOT changed

- `src/components/shared/` and `src/components/ui/` are unchanged.
- Existing colocated admin components (deactivate-card.tsx, two-factor-card.tsx) are unchanged and confirmed as the precedent.
- No new npm dependencies. No schema change.

### Impact

- `src/app/(member)/feedback/actions.ts` — new module (Phase 4: api-developer)
- `src/app/(member)/home/feedback-prompt-card.tsx` — new colocated client island (Phase 4: ux-developer)
- `src/components/shared/feedback-form.tsx` — new shared component (Phase 4: ux-developer)
- `src/app/(admin)/admin/feedback/feedback-status-control.tsx` — new colocated admin client island (Phase 4: ux-developer)

---

## DECISION-020: NextAuth 5 beta.31 credentials endpoint always returns HTTP 302; `json=true` is a no-op; success check is `status < 400`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-e2e-auth-infra`

### Decision

`POST /api/auth/callback/credentials` in NextAuth 5 beta.31 (Auth.js beta) **always** returns HTTP 302, regardless of whether `json=true` is included in the form body. It never returns a 2xx JSON response. The session cookie is issued in the `Set-Cookie` header of the 302 response. The redirect `Location` is derived from `AUTH_URL` (the env var), not the request host — so it may point at a different port than the test server.

**Implementation rules derived from this finding:**

1. Do NOT use `callbackRes.ok()` to check for sign-in success — it returns `false` on 302.
2. Do NOT include `json=true` in the credentials POST form data — it has no effect and adds misleading code (it was a NextAuth v4 convention that is not honored in v5 beta.31).
3. Do NOT include `totpCode` — the starter's `authorize()` accepts `email` and `password` only; undeclared fields are silently dropped.
4. Success check: `callbackRes.status() < 400`. Any 4xx or 5xx is a hard failure; 3xx is the expected success response.
5. Use `maxRedirects: 0` on the Playwright `request.post()` call to prevent Playwright from following the 302 to `AUTH_URL` (which may be a different host/port). The session cookie is captured from the first response.
6. Verify session by calling `GET /api/auth/session` with the captured cookies and asserting `session.user.email === expectedEmail`.

### Evidence

Live probe run against `npm run dev -- -p 3100` with `SEED_ADMIN_EMAIL=admin@claudecode.info` credentials (2026-07-01):
- GET `/api/auth/csrf` → 200 OK, `{"csrfToken":"..."}`, sets `authjs.csrf-token` cookie.
- POST `/api/auth/callback/credentials` (without `json=true`) → 302, `location: http://localhost:3000`, `set-cookie: authjs.session-token=<JWE>`.
- POST `/api/auth/callback/credentials` (with `json=true`) → identical 302, identical session cookie.
- GET `/api/auth/session` with session cookie → 200 OK, full session JSON with `user.email`, `user.roles`, `user.features`, `user.twoFactorRequired`, `user.twoFactorVerified`.

### What is NOT changed

- The NextAuth sign-in flow for users in the browser is unaffected — this decision applies only to programmatic API calls in `globalSetup`.
- The `callbackUrl` form field should be set to `${baseURL}/home` for clarity and to satisfy any future strict-origin validation.

---

## DECISION-019: E2E testing conventions — `e2e/support/` directory, API sign-in for storageState, DB isolation guard posture, per-spec `test.use()`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-e2e-auth-infra`

### Decision

Four sub-decisions bundled because they form one cohesive e2e testing convention layer:

**1. `e2e/support/` for non-spec infrastructure.**
All Playwright infrastructure that is not a test file belongs in `e2e/support/`. At minimum: `e2e/support/global-setup.ts`. If the module grows to warrant splitting (e.g., a reusable auth-helper extracted from setup), `e2e/support/auth-helpers.ts` is the correct destination. Spec files remain flat in `e2e/`. This mirrors the npvitals pattern and is the convention downstream forks copy.

**2. Per-spec `test.use({ storageState })`, not per-role Playwright projects.**
`playwright.config.ts` gains one addition: `globalSetup: './e2e/support/global-setup.ts'`. The existing single Chromium project and flat spec structure are otherwise unchanged. New specs and the role-boundaries spec opt in to cached auth via `test.use({ storageState: 'e2e/support/.auth/admin.json' })` at the describe-block level. Existing tests continue to drive the sign-in UI without breaking — adoption is incremental. Per-role Playwright projects (one project per auth role, each project pre-sets storageState) are rejected because they would require splitting existing multi-role spec files and restructuring the 20 passing tests — too much churn for the benefit at the starter's current scale.

**3. API sign-in in globalSetup; fail loudly on acquisition failure.**
The `globalSetup` acquires per-role sessions by POSTing to NextAuth's credentials endpoint (`/api/auth/callback/credentials` with a fresh CSRF token from `/api/auth/csrf`, then verifying via `/api/auth/session`) rather than driving the sign-in UI. Saved `.json` files live under `e2e/support/.auth/` (gitignored). Refresh logic: re-acquire if the file is absent or older than 12 h.

Stale-state posture: when credentials env vars are set and the API sign-in fails or returns an unauthenticated session, `globalSetup` throws. In CI, a stale or invalid storageState that goes undetected is worse than a hard build failure. When credentials vars are absent, `globalSetup` skips that role's acquisition; per-spec `test.skip(!SEED_*)` guards continue to gate those tests as before.

**4. DB isolation guard: warn locally, hard-block in CI.**
`globalSetup` inspects `DATABASE_URL`. If the host matches `*.neon.tech`:
- **Local dev (no `CI` env var):** print a prominent stderr warning naming the risk and continue. The author's own dev runs are against a Neon dev DB; blocking here would break them immediately.
- **CI (`CI=true`):** throw with an actionable message unless `E2E_DATABASE_URL` (a separate isolated DB URL) or `E2E_ALLOW_SHARED_DB=true` (explicit opt-out) is set. This protects fork CI pipelines from silently polluting a shared Neon database.
- `E2E_ALLOW_SHARED_DB=true` overrides the CI hard-fail in both local and CI; teams that intentionally share a DB own the risk.

### Rationale

1. **Teaching-artifact lens on directory shape.** The `e2e/support/` separation is the natural Playwright home for infrastructure that is not a spec. Showing it explicitly — rather than a flat helpers.ts alongside spec files — is the pattern downstream forks are most likely to copy and extend correctly. A flat structure that mixes spec files and infrastructure requires forks to invent the separation themselves.

2. **Minimal churn over optimal shape.** The per-role Playwright project split is architecturally cleaner but requires restructuring the existing 20 tests. At the starter's current scale, the churn is disproportionate to the benefit. Per-spec `test.use()` achieves the same caching with zero changes to existing specs and a clear incremental migration path.

3. **API sign-in is faster and more durable for setup.** UI sign-in is the right thing to test in specs — it exercises the sign-in page, form, and NextAuth redirect. For globalSetup (acquiring a session that dozens of specs reuse), the UI path is brittle: a rendering delay or selector change fails the acquisition for all specs. The API path is a direct, stable contract with NextAuth.

4. **DB guard protects forks without breaking the author's workflow.** The author's `DATABASE_URL` is a Neon dev database. A hard block at any posture would make the guard the first thing a fork owner removes. The warn-locally / block-in-CI split makes the guard meaningful for the audience that matters most (fork CI pipelines) while leaving the author's workflow intact.

### Convention going forward

- Any new e2e infrastructure file (fixtures, page objects, setup utilities) lives in `e2e/support/`.
- Spec files that need authenticated sessions call `test.use({ storageState: 'e2e/support/.auth/<role>.json' })` at the describe-block level. They do NOT sign in via UI in `beforeEach`.
- `e2e/support/.auth/` is gitignored. CI re-acquires fresh state on each run via `globalSetup`.
- The DB isolation guard posture must not be weakened without an explicit decision revision here.

### What is NOT changed

- No new npm dependencies. Playwright is already present.
- No schema changes.
- Seed script: no changes required. The three seeded users already exist with the correct attributes.
- TOTP enrolment e2e is explicitly out of scope (tracked as a Backlog item in `docs/TODO.md`).

### Impact

- Adds `e2e/support/global-setup.ts`.
- Adds `e2e/support/.auth/` directory pattern (gitignored).
- `playwright.config.ts`: adds `globalSetup: './e2e/support/global-setup.ts'`.
- Adds `e2e/role-boundaries.spec.ts`.
- `.env.example`: adds commented `E2E_ALLOW_SHARED_DB` entry.
- `docs/TODO.md`: adds "TOTP enrolment e2e" to Backlog.

---

## DECISION-018: Email module splits into `src/lib/email/` directory; queue stores rendered HTML at rest

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-email-queue`

### Sub-decision 1 — Directory split

`src/lib/email.ts` (single file, currently 61 lines) is promoted to `src/lib/email/` with three files:

- `send.ts` — the existing `sendEmail()` low-level transport + `sendPasswordResetEmail()` template function.
- `queue.ts` — `enqueueEmail()`, the atomic claim function, the process/retry loop, and dev intercept/redirect env-var handling.
- `index.ts` — barrel that re-exports `sendEmail`, `sendPasswordResetEmail`, and `enqueueEmail`. Existing call sites at `@/lib/email` continue to work without path changes.

**Rationale:**

1. **Readability threshold.** The queue module adds an enqueue function, a single-statement CTE claim query, a process/retry loop with exponential backoff, and dev-intercept/redirect handling — roughly 150–200 lines. Combined with the existing 61 lines, a single file would exceed 220 lines of mixed concerns (transport + persistence + scheduling). The starter's mandate is a "small, opinionated baseline that stays readable." A 220-line file with two unrelated concerns (send vs. queue) is not single-pass readable for a fork developer.

2. **Distinct concerns.** `send.ts` answers "how do I send an email now?" `queue.ts` answers "how do I persist an email so it's sent reliably later?" These are different enough that coupling them in one file would mislead fork developers about which part to edit when adding a new template (send.ts) vs. tuning retry policy (queue.ts).

3. **`src/lib/auth/` precedent.** The auth module was a single `auth.ts` before it outgrew a single concern; it now lives in `src/lib/auth/` with `config.ts`, `safe-callback.ts`, `sign-in-gate.ts`, and a request-ip module extracted alongside it. The same progression applies here. A directory is the right structure once the module has two meaningfully separate responsibilities.

4. **Zero import-path churn at existing call sites.** The barrel re-export at `index.ts` means `import { sendEmail } from "@/lib/email"` continues to resolve exactly as before. No call site needs updating.

**What is NOT a directory split:**

Smaller modules with one concern stay as single files. `flags.ts`, `permissions.ts`, `two-factor.ts`, `rate-limit.ts` are all single-file because each has one primary responsibility. The rule is: a directory when there are two meaningfully distinct concerns that a fork developer would want to find and edit independently.

### Sub-decision 2 — Store rendered HTML at rest

The `email_queue` table stores the **fully rendered HTML body** (and plain-text body) in columns on the row, not a template key + JSON params.

**Rationale:**

1. **Matches the existing `SendEmailInput` interface.** `sendEmail()` already accepts `{ to, subject, html, text? }`. `enqueueEmail()` wraps `sendEmail()`'s input — it would accept the same shape. Storing what the transport already receives requires no re-render step and no template registry in the queue.

2. **Simpler to implement and teach.** A template-key + JSON-params approach requires the queue processor to know how to invoke each template function by name, maintain a template registry, and re-render on every retry. That's a non-trivial indirection that adds complexity without benefiting the starter's primary audience.

3. **Retries are safe without re-rendering.** The rendered HTML and resolved reset/verify URLs are correct at enqueue time. Retrying the same rendered row is safe — the link was already generated and the recipient is already determined. Template-at-send-time re-rendering would re-resolve relative timestamps, which could behave differently on the 4th retry.

4. **Tradeoff documented for forks.** Storing rendered HTML does persist more data (full HTML, including any user-supplied name or email address rendered into the template). Forks with strict data-minimization requirements should store template key + JSON params and re-render at send time. This architectural note belongs in a comment at the `emailQueue` table definition in `schema.ts`.

### Convention going forward

Any future email send site: call `enqueueEmail({ to, subject, html, text? })`. Do not call `sendEmail()` directly from server actions or pages — the queue is the only sanctioned path for outbound email. `sendEmail()` is an internal transport function called only by the queue processor. This invariant prevents silent-drop regressions if the queue is bypassed.

### Impact

- `src/lib/email.ts` is deleted; replaced by `src/lib/email/send.ts`, `src/lib/email/queue.ts`, `src/lib/email/index.ts`.
- All existing `import ... from "@/lib/email"` call sites continue to work via the barrel.
- New `emailQueue` table in `src/lib/db/schema.ts` with columns: `id`, `to` (recipient email, text), `subject`, `html`, `text` (nullable), `status` (text: `'queued' | 'processing' | 'sent' | 'failed'`), `attemptCount`, `maxAttempts`, `nextRetryAt` (timestamp with timezone), `claimedAt` (timestamp with timezone, nullable), `sentAt` (timestamp with timezone, nullable), `lastError` (text, nullable), `providerMessageId` (text, nullable), `createdAt`, `updatedAt`.
- Composite index on `(status, nextRetryAt)` for the claim query.
- `import "server-only"` in both `send.ts` and `queue.ts`.

---

## DECISION-017: `getRequestIp()` extracted to `src/lib/request-ip.ts`; canonical IP-extraction precedence established

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-record-audit-helper`

### Decision

IP extraction is extracted from `src/lib/rate-limit.ts` into a new shared module at `src/lib/request-ip.ts`. Both `rate-limit.ts` (which previously owned the implementation) and the new `recordAudit()` helper in `src/lib/audit.ts` import `getRequestIp()` from there.

The canonical IP-extraction precedence for this starter is:

1. `cf-connecting-ip` — if present, unconditionally trusted. Cloudflare sets this at the network edge; it cannot be injected by clients on Cloudflare-fronted deployments. If Cloudflare is not in the path, the header is absent (Vercel strips unrecognized headers), so there is no spoofing risk.
2. `x-forwarded-for` (first value) — consulted only when `TRUST_PROXY_HEADERS=true`. Explicitly opt-in because XFF is trivially spoofable without a controlled proxy chain.
3. `x-real-ip` — the Vercel-set fallback. Reliable on Vercel without any env-var configuration; absent in local dev.

### Rationale

1. **Avoid coupling two unrelated modules.** Before this decision, `getRequestIp()` lived in `src/lib/rate-limit.ts`, a rate-limiting module. Having `src/lib/audit.ts` import from `rate-limit.ts` just to get an IP would be a backwards dependency: auditing would depend on rate-limiting infrastructure. Extracting the function removes that coupling entirely.

2. **Single source of truth.** The starter previously had no `cf-connecting-ip` handling in rate limiting and would have had a different precedence in auditing if the fertilityluna reference were copied verbatim. Two different IP-extraction implementations in the same request path (rate limiting sees one IP; audit log sees another) defeat the forensic purpose of the audit log. A shared module ensures both subsystems see the same client IP for the same request.

3. **Correct precedence.** The original `getRequestIp()` never checked `cf-connecting-ip`. This is fixed in the extracted version. Any fork running behind Cloudflare now gets consistent, correct IP attribution in both rate-limit keys and audit rows.

4. **Teaching artifact clarity.** `src/lib/request-ip.ts` is a purpose-named, single-function module — analogous to `src/lib/flags.ts` and `src/lib/permissions.ts`. A fork developer looking for "where does IP extraction live?" has one obvious answer.

### Convention going forward

Any future module that needs the client IP (e.g., geo-gating, abuse detection) imports `getRequestIp()` from `@/lib/request-ip`. Do not re-implement inline.

### What is NOT changed

- The behavior of `TRUST_PROXY_HEADERS` is unchanged; the env-var semantics are identical to the prior implementation.
- `rate-limit.ts` behavior is unchanged; it now delegates to `request-ip.ts` instead of housing the implementation.
- No schema change, no permission change, no feature flag.

### Impact

- Adds `src/lib/request-ip.ts` with `getRequestIp(hdrs)` implementing the three-tier precedence above.
- `src/lib/rate-limit.ts`: remove local `getRequestIp` function; add `import { getRequestIp } from "@/lib/request-ip"`.
- `src/lib/audit.ts`: import `getRequestIp` from `@/lib/request-ip`; use in `recordAudit()`.

---

## DECISION-016: `trustHost: true` set in code, not env-only

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-nextauth-trusthost` (BUG-4)

### Decision

Add `trustHost: true` directly to the `authConfig` object in `src/lib/auth/config.ts`, not as a deployment-time env var requirement.

### Placement: `config.ts`, not `auth.ts`

`trustHost` is placed in `authConfig` (rather than in the `NextAuth({...})` options object in `src/auth.ts`) for one concrete reason: `authConfig` is a directly importable TypeScript object, so `config.test.ts` can assert `authConfig.trustHost === true` with zero mocking. `src/auth.ts` exports only the NextAuth result (`handlers`, `auth`, `signIn`, `signOut`, `unstable_update`), not the raw config — there is no testable surface there without reaching into NextAuth internals.

The edge-runtime note in `config.ts` is unaffected: `trustHost` is a declarative property with no node-only import, so it is safe on the Edge runtime. The edge proxy (`proxy.ts`) doesn't execute OAuth callbacks and is indifferent to the flag — it is present because `authConfig` is the shared base, not because the proxy needs it.

### Code vs Env rationale

| Factor | Code (`trustHost: true`) | Env (`AUTH_TRUST_HOST=true`) |
|--------|--------------------------|------------------------------|
| Fork-and-go audience | Works with zero env config | Requires deployer to discover and set the var before the production failure |
| fpcw production incident | Proven fix (`e47322a`) | Would have required the deployer to know the var existed |
| Security posture | Same as Vercel's auto-trust via `VERCEL` env | Same — Vercel doesn't require the deployer to opt in either |
| Proxy hygiene assumption | Must set Host header correctly | Identical assumption |
| Env override available | Yes — `AUTH_URL` or `AUTH_TRUST_HOST` still work as alternatives | N/A |

The starter's explicit goal is "fork-and-go." An env-only fix requires deployers to read the right docs section before shipping — the fpcw incident proves that does not happen reliably. The code-level fix mirrors the security posture Vercel itself accepts (auto-trusting via an env signal the platform sets, not one the deployer sets).

### Deployment assumption

The reverse proxy terminating TLS must set the `Host` header from the public hostname. This is standard behaviour for nginx, Caddy, Cloudflare (proxy and Tunnel), Kinsta, Railway, Fly.io, Render, and any other well-configured proxy. A misconfigured proxy that passes the internal hostname creates a host-header injection risk — but that same misconfiguration breaks OAuth URL construction regardless of this flag. The code comment at the config site names this assumption explicitly.

### What is NOT changed

- No permission, flag, schema, or session/JWT semantic change.
- No new npm dependency.
- The `AUTH_URL` env var continues to act as an independent `trustHost` signal — deployers who set `AUTH_URL=https://myapp.com` in production get the same effect via NextAuth's env detection. The `.env.example` comment is strengthened to make this explicit.

### Alternatives rejected

- **`AUTH_TRUST_HOST=true` env-only:** Rejected. Requires deployer awareness before the production failure. Contradicts the fork-and-go goal.
- **`AUTH_URL` comment strengthening only:** Partial mitigation. Covers deployers who correctly set `AUTH_URL`; does not cover those who leave it at the default (common since v4 `NEXTAUTH_URL` muscle memory).
- **Placing `trustHost` in `src/auth.ts`:** Rejected. No testable surface without mocking NextAuth internals.

### Impact

- `src/lib/auth/config.ts`: add `trustHost: true` with a multi-line comment naming the off-Vercel rationale and the security assumption.
- `src/lib/auth/config.test.ts`: add one assertion — `expect(authConfig.trustHost).toBe(true)`.
- `.env.example`: strengthen the `AUTH_URL` comment; add a commented `AUTH_TRUST_HOST` line documenting the env-only alternative.

---

## DECISION-015: `signIn` callback — drop credentials belt-and-suspenders lookup; OAuth gate uses email key

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-oauth-first-signin-accessdenied` (BUG-3)

### Decision

Two sub-decisions bundled because they shape the same extracted gate function:

**1. Drop the credentials double-check in `signIn`.**
The current `signIn` callback performs a `db.query.users.findFirst({ where: eq(users.id, user.id) })` for all providers, including credentials. For credentials sign-ins this is redundant: `authorize()` already looks up the user by email, checks `!user.isActive`, and returns `null` (causing NextAuth to short-circuit before calling `signIn`) if the user is inactive. By the time `signIn` is invoked for a credentials user, `authorize()` has already validated the user and returned their real DB UUID as `user.id`. The extra lookup adds a round-trip that produces no new information. The gate function for the credentials branch returns `true` unconditionally.

Defense-in-depth is preserved by two other mechanisms: (a) `authorize()` itself checks `isActive` before returning; (b) the stale-JWT check in the `jwt` callback re-reads `isActive` on every subsequent request and returns `{}` (signout) if the row has been deactivated.

**2. OAuth branch uses verified email as the lookup key.**
Auth.js v5 runs the `signIn` callback before the adapter creates a new user row. On a first-time Google sign-in, `user.id` is Google's `sub` string (not a DB UUID), so an id-keyed lookup always misses. The fix keys the OAuth lookup off `user.email` (which Google verifies at token issuance). Logic: no row → allow (adapter will create); row with `isActive = true` → allow; row with `isActive = false` → deny.

The extracted gate function (`src/lib/auth/sign-in-gate.ts`) takes the provider name and an injected `findUserByEmail` dependency so all four branches are unit-testable without a real database.

### Deletion strategy constraint

The email-keyed gate is only sound as long as deactivated user rows remain in the database. The starter's mandated deletion strategy is **soft deactivation (`isActive = false`)** — hard-delete is prohibited. The delete-account stub (`src/app/(account)/account/actions.ts:279`) must document this constraint when it is implemented. If a future implementer chooses hard-delete, an additional guard (e.g. a `deleted_emails` blocklist) is required alongside the email-keyed check.

### Alternatives rejected

- **Keep the credentials double-check:** Rejected because it is a dead round-trip with no safety benefit beyond what `authorize()` and the JWT stale check already provide. "Belt and suspenders" is not a free call on every credentials sign-in.
- **Inline fix in `src/auth.ts` (explore.press minimal approach):** Viable but not unit-testable without mocking the Drizzle `db` object directly, which is fragile. The extracted DI'd gate follows the `safe-callback.ts` precedent already established in `src/lib/auth/`.

### Impact

- Adds `src/lib/auth/sign-in-gate.ts` with `evaluateSignIn(provider, user, findUserByEmail)`.
- Adds `src/lib/auth/sign-in-gate.test.ts` with four unit tests.
- `src/auth.ts` `signIn` callback: replace the current 8-line id-keyed lookup with a single `evaluateSignIn(...)` call.

---

## DECISION-014: Keep `drizzle-orm/neon-http`; `db.batch()` is the project convention for atomic multi-write

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-verify-email-neon-http-transaction` (BUG-1)

### Decision

The DB connection (`src/lib/db/index.ts`) stays on `drizzle-orm/neon-http`. The fix for the `db.transaction()` call in the verify-email page uses `db.batch([...])`, and `db.batch()` is codified as the project-wide convention for any group of writes that must be atomic.

### Rationale

1. **Switching drivers is an architectural decision, not a bug fix.** Migrating from `neon-http` to `neon-serverless` would enable `db.transaction()`, but it changes the connection model (WebSocket vs. HTTP), affects cold-start latency, and requires a separate pooling configuration review. That work belongs in its own pipeline entry, not inside a bug fix for a single page.

2. **`db.batch()` is a correct and proven solution.** Neon executes all statements in a `db.batch()` call as a single server-side transaction — atomicity is fully preserved. The explore.press fork resolved an identical class of defect with `db.batch()` in commit `d55a165` and the fix has been running in production since 2026-06-19.

3. **`neon-http` is the right default for the starter's serverless target.** The starter ships Vercel-ready. HTTP-based connections work without WebSocket support (which some edge runtimes restrict) and need no persistent connection management. The serverless driver is the correct pick for the majority of fork deployments.

4. **Documenting the constraint as a convention prevents recurrence.** The admin actions file (`src/app/(admin)/admin/users/[id]/actions.ts:74-76`) already contains a prose comment about the constraint. Adding it to `docs/decisions.md` elevates it from a local comment to a searchable project rule.

### Convention going forward

When two or more writes must be atomic and no write depends on a mid-batch intermediate result, use:

```typescript
await db.batch([
  db.update(table).set({ ... }).where(...),
  db.delete(otherTable).where(...),
  db.insert(auditEvents).values({ ... }),
] as unknown as Parameters<typeof db.batch>[0]);
```

The `as unknown as Parameters<typeof db.batch>[0]` cast is required because Drizzle's batch type parameter is strict about element types; the double-cast is the minimal workaround consistent with explore.press's proven pattern. If a future Drizzle version relaxes the type, the cast can be removed without functional change.

When the batch list is dynamic (variable length at runtime), build the array first then cast on the `await` call — identical pattern, same cast.

### When `db.batch()` is NOT sufficient

If write N depends on a value produced by write N-1 (e.g., an insert that returns a generated ID needed by the next insert), `db.batch()` cannot be used because a batch cannot consume its own intermediate results. In that case either: (a) pre-read the needed value before the batch, or (b) switch to `neon-serverless` for that action file. Document the exception in the action file comment.

### Alternatives Rejected

- **Switch to `drizzle-orm/neon-serverless` now:** Deferred. Correct long-term option for teams that need interactive transactions with mid-write reads, but an architectural change that deserves its own pipeline entry.
- **Sequential writes (huddleup's idempotent approach):** Viable only if each write is independently safe to retry. The verify-email page's three writes are not idempotent in the same way — a second email-update after token deletion would silently succeed. `db.batch()` is strictly safer.

### Impact

- `src/app/(email-verify)/account/verify-email/[token]/page.tsx`: `db.transaction()` → `db.batch()`.
- `src/app/(admin)/admin/users/[id]/actions.ts`: comment stays as-is (it documents why NOT to use `db.transaction()`; now also references this decision by number).

---

## DECISION-013: `sanitizeCallbackUrl` extracted to shared helper; fallback changed to `/home`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-post-login-routing-and-e2e`

### Decision

`sanitizeCallbackUrl` was a private function in `src/app/(auth)/totp/actions.ts`. With the post-login routing feature, the same validation is needed in `src/app/(auth)/signin/page.tsx` (which was passing the raw `callbackUrl` searchParam unsanitized to `signIn()`). The function is extracted to `src/lib/auth/safe-callback.ts` so both callers share a single implementation.

The fallback return value changes from `/admin` to `/home` throughout (the new post-login landing). All existing callers that previously relied on `?? "/admin"` are updated to pass through `sanitizeCallbackUrl(raw)` with no manual fallback.

Function contract:
```typescript
// src/lib/auth/safe-callback.ts
export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return "/home";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}
```

### Rationale

1. **`signin/page.tsx` was unsanitized.** The sign-in page read `sp.callbackUrl` from the URL query string and passed it directly to `signIn("google", { redirectTo: ... })` and `signIn("credentials", { redirectTo: ... })`. NextAuth 5 beta.31 performs internal same-origin validation, but relying on undocumented beta internals for a security property is insufficient — particularly when the codebase already has an explicit sanitization function for exactly this class of attack.

2. **DRY over duplication.** The validation logic (reject `//` prefix, reject non-`/` prefix, fallback) would otherwise be duplicated across two callers. A shared helper is the obvious canonical location.

3. **Fallback to `/home` not `/admin`.** After this feature ships, the correct post-login landing is `/home`. A fallback to `/admin` is wrong for most users (who lack `admin.dashboard`) and would send them to `/access-pending` on an invalid callback. `/home` is the correct safe default.

### Alternatives Rejected

- **Leave `signin/page.tsx` unsanitized and rely on NextAuth's `redirectTo` validation:** Rejected because NextAuth 5 beta behavior is not specified in its changelog and may change between beta versions. Explicit sanitization is the safer and more consistent choice.
- **Inline the check in each caller:** Rejected because duplicated logic with independent fallback values would diverge on the next change.

### Impact

- Adds `src/lib/auth/safe-callback.ts`.
- `src/app/(auth)/signin/page.tsx`: import `sanitizeCallbackUrl`; replace `sp.callbackUrl ?? "/admin"` with `sanitizeCallbackUrl(sp.callbackUrl)`.
- `src/app/(auth)/totp/actions.ts`: remove local `sanitizeCallbackUrl` function; add import from shared location.
- `src/app/(auth)/totp/page.tsx`: replace `sp.callbackUrl ?? "/admin"` with `sanitizeCallbackUrl(sp.callbackUrl)`; add import.

---

## DECISION-012: Member home route group, global nav placement, and post-login landing invariant

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-post-login-routing-and-e2e`

### Decisions

**1. Member home route:** `src/app/(member)/home/page.tsx` with a group-level layout at `src/app/(member)/layout.tsx`.

The `(member)` route group is the home for authenticated member-facing pages that are not part of the admin shell or the account settings area. `/home` is the only route in the group initially; the group name signals that future member-facing pages (a notifications page, a billing summary, etc.) belong here rather than in `(admin)` or `(account)`.

Alternatives rejected:
- Top-level `src/app/home/page.tsx` with no route group: possible but provides no layout seam to attach the global nav without the nav bleeding into unrelated routes.
- `(app)` as the group name: rejected — "app" is ambiguous in a Next.js context (`src/app/` already IS the app directory). `(member)` is explicit about the audience.

**2. Global nav component:** `src/components/shared/global-nav.tsx` — a Server Component.

Rendered only inside `src/app/(member)/layout.tsx`. It does NOT appear in:
- The root layout (`src/app/layout.tsx`) — that would bleed into signin, access-pending, and public pages.
- The admin shell layout (`src/app/(admin)/admin/layout.tsx`) — admin has its own sidebar nav; double-nav is wrong.
- The account layout (`src/app/(account)/layout.tsx`) — account has its own sidebar nav.

Server/client split: the global nav is a pure Server Component. It receives the session object from the parent layout (which calls `auth()`) and renders the conditional Admin link server-side by checking `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`. No `useSession()` needed. No client component needed. Sign-out is implemented as an inline `"use server"` form action, identical to the pattern already used in `(admin)/admin/layout.tsx` and `(account)/layout.tsx`.

**3. `proxy.ts` changes:** None required for route protection. `/home` is not in `PUBLIC_PATHS` and not in `PROTECTION_RULES`, so it falls through to the auth-only block (line 65-77 of `proxy.ts`). Only change: update the comment at line 76 to include `/home` in the list of documented auth-only routes.

**4. Post-login landing invariant:** The default `callbackUrl` in `src/app/(auth)/signin/page.tsx` and the fallback in `src/app/(auth)/totp/actions.ts` must both change from `/admin` to `/home`. This is a load-bearing invariant: any future code that hard-codes `/admin` as a post-auth destination is wrong unless the user specifically requested the admin area. Documenting as an explicit starter invariant in CLAUDE.md.

**5. `(account)/layout.tsx` sidebar:** The "← Home" link currently points to `/`. After this feature, it should point to `/home` (the post-login landing). Tech-lead must update this link.

**6. `access-pending/page.tsx`:** Should gain a link back to `/home` after this feature ships, so users who are bounced to access-pending have an escape route. Not a blocker but must be addressed in Phase 4.

### Invariants not changed

- No new npm dependencies. Confirmed unnecessary.
- No schema change.
- The 2FA gate does not apply to `/home`. This is intentional — `proxy.ts` only enforces `twoFactorRequired && !twoFactorVerified` for `isAdminRoute` paths. The decision to NOT gate the member home behind 2FA must be stated explicitly in the Phase 3 design doc so forks that want site-wide 2FA know where to add the check.

### CLAUDE.md updates (tech-lead must carry into Phase 3)

- Project Layout section: add `(member)/home/` entry.
- Key Invariants section: add "Post-Login Landing = /home" invariant, including the proxy fall-through note.

---

## DECISION-011: Repository renamed from `claudecode` to `claudecode-nextjs-starter`

**Status:** Resolved
**Date:** 2026-05-19

**Decision:** Renamed the canonical repository from `github.com/chenson42/claudecode` to `github.com/chenson42/claudecode-nextjs-starter`.

**Rationale:** The original name had three problems:

1. **Trademark adjacency.** "Claude Code" is Anthropic's product name. A repo called `claudecode` reads as either official or as squatting — neither is intended. The new name contextualizes the brand-signal as "Next.js starter for Claude Code workflows" rather than "is Claude Code."
2. **Opacity.** A user landing on `chenson42/claudecode` had no idea what the artifact is. The new name describes it.
3. **Aging.** If Anthropic renames its product, the old repo name becomes stale; the new name still reads sensibly because "Next.js starter" carries the artifact identity.

**Alternatives considered:** `agent-sdlc-starter`, `phase-gate-starter`, `agent-pipeline-starter` — all rejected because they buried the "Claude Code" signal entirely, which would hurt discoverability for the intended audience (people searching for Claude Code workflows in a Next.js context). The chosen name balances keeping the searchable brand-signal while no longer reading as a product-name claim.

**Impact:**

- All in-repo references to `chenson42/claudecode` updated to `chenson42/claudecode-nextjs-starter` (skills, decisions, work-logs, README, deck, package.json `name`).
- `package.json` `name` field changes from `claudecode-starter` to `claudecode-nextjs-starter`. The `personalize-starter` skill's "is this still the canonical starter?" marker is updated accordingly.
- `DECISION-009`'s hardcoded `CANONICAL_URL` constant is updated; the architectural call from `DECISION-009` (hardcode rather than read from `package.json`) is unchanged.
- GitHub auto-redirects `chenson42/claudecode` → `chenson42/claudecode-nextjs-starter` forever, so existing clones, commit references, and external links keep working. The repo rename itself is a separate manual operation (via `gh repo rename` or GitHub web UI) that the user runs.

**Tradeoff:** Any future Anthropic product rename re-opens the question. The hedge is that the artifact identity ("Next.js starter") doesn't depend on the brand-signal, so a future rename would be a smaller delta than this one.

---

## DECISION-010: Commit-message standard — hook delivery, script placement, grandfather cutoff, MTTR scope

**Status:** Resolved
**Date:** 2026-05-18

Four sub-decisions bundled because they are interdependent:

1. **Hook delivery:** `scripts/install-hooks.sh` invoked via the `prepare` npm lifecycle script — no new dependency. The starter's strong preference against unnecessary packages rules out `husky` when a 10-line shell script achieves the same result. `prepare` runs on `npm install`, giving forks automatic installation on clone. The shell script is committed to `scripts/` and symlinks (or copies) the hook into `.git/hooks/commit-msg`.

2. **Hook validator placement:** `scripts/commit-msg.mjs` — a Node ESM script matching the `check-audit-coverage.mjs` precedent already in `scripts/`. This allows the validator and `stats:escape` to share a common message-parsing helper in the same file or a co-located `scripts/commit-msg-parse.mjs`. Inline shell validation is rejected: regex in bash is brittle and the error-message requirements (name the specific missing field) are easier to satisfy in Node.

3. **`stats:escape` output:** stdout only. `scripts/stats-escape.mjs` prints to stdout; the tech-lead pipes it into the work-log manually. A file output (`docs/reviews/stats-escape-latest.md`) would need cleanup logic, a gitignore entry, or a commit every retrospective. Stdout is simpler and consistent with `check-audit-coverage.mjs`.

4. **Grandfather cutoff:** the date the feature ships (2026-05-18). No grace period. The cutoff is printed in the output header on every `stats:escape` run so the first retrospective number is honest. **MTTR deferred** to a follow-up work-log. No `Fixes-Bug:` trailer in this iteration; the escape-rate breakdown is the deliverable.

**Impact:** Adds `scripts/commit-msg.mjs`, `scripts/install-hooks.sh`, `scripts/stats-escape.mjs`. Adds `prepare` entry to `package.json`. Adds "Commit Message Standards" section to `CLAUDE.md`. Adds a cross-link to `.claude/agents/tech-lead.md`. Updates per-phase status in work-log.

---

## DECISION-009: Upstream-sync canonical URL — hardcoded in skill, not read from package.json

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** The canonical starter URL (`https://github.com/chenson42/claudecode-nextjs-starter`) is hardcoded as a constant inside `.claude/skills/upstream-sync/SKILL.md`. It is NOT read from `package.json`.

**Rationale:** `package.json` in this project has no `repository` field (confirmed by grep). Requiring forks to populate `package.json` to make fork-detection work would be a silent failure mode — most forks won't know to add it. The hardcoded URL is inspectable inside the skill file itself, and a fork that deliberately wants to change the upstream target would edit the skill anyway. The alternative (reading from some config field) adds a new convention that nothing else in the project uses.

**Tradeoff:** If the canonical repo ever moves (org rename, repo rename), every fork's skill file would need to be updated. This is acceptable because repo moves are rare and the skill is the one file you'd update anyway.

**Impact:** Phase 4 sets `CANONICAL_URL = "https://github.com/chenson42/claudecode-nextjs-starter"` in the skill's pre-flight section. Trailing `.git` is stripped from `git remote get-url origin` output before comparison.

---

## DECISION-008: Upstream-sync review — skill placement, state file, cadence, and agent owner

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** Four sub-decisions bundled here because they are all inter-dependent:

1. **Skill body:** `.claude/skills/upstream-sync/SKILL.md` — matches the single-file-per-skill convention already established by every other skill in `.claude/skills/`.

2. **State file:** `.claude/upstream-state.json` — flat, machine-readable, committed to the fork's repo (not gitignored). Shape (sketch): `{ "upstreamUrl": "...", "forkPointSha": "...", "lastSyncedSha": "...", "lastSyncedDate": "..." }`. This is simpler than parsing prose from `docs/reviews/log.md` and survives log re-formatting. No `.claude/state/` subdirectory created — a single file is sufficient and the "state directory for future files" risk is over-engineering.

3. **Cadence:** **14 days.** The two existing 7-day reviews are high-frequency by design (test coverage, retrospective). The five 30-day reviews are for slower-moving surfaces. Security patches from upstream can sit 30 days in a fork without notice; 14 days halves that exposure without adding session-start noise. `upstream-sync` is added to `docs/reviews/log.md` as `upstream-sync` (cadence: 14 days).

4. **Agent owner:** **tech-lead.** Already owns the retrospective (7-day) and documentation review (30-day). The upstream-sync review is instruction-layer work — reading release notes and commit classifications — which is directly analogous to the documentation review. A new section is appended to `tech-lead.md` under `## Ownership`. No new agent.

**Rationale summary:** Smallest footprint, consistent with existing conventions, 14-day cadence chosen for security-fix latency rather than convenience.

**Impact:** Adds `.claude/skills/upstream-sync/SKILL.md` (in Phase 4). Adds `.claude/upstream-state.json` (created by the skill on first run). Edits `docs/reviews/log.md` header bullet list (add `upstream-sync`). Edits `CLAUDE.md` `## Periodic Reviews` table (add 8th row) and changes "Seven reviews" to "Eight reviews". Edits `.claude/agents/tech-lead.md` `## Ownership` section (add upstream-sync paragraph).

---

## DECISION-007: `<FormattedDate>` lives in `src/components/shared/`, not `src/components/ui/`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** The timezone-safe date primitive is placed at `src/components/shared/formatted-date.tsx`, not inside `src/components/ui/`. The ESLint guard banning `toLocale*` outside that file uses a `no-restricted-syntax` pattern in `eslint.config.mjs` with a targeted `files` override that exempts the primitive's own path. The SSR fallback rendered inside `<time dateTime={iso}>` is the date portion of the ISO string (`YYYY-MM-DD`), marked `suppressHydrationWarning`.

**Rationale:**

1. **Placement.** `src/components/ui/` is reserved for generated shadcn/Radix primitives — the project instructions say "auto-generated; don't hand-edit." `<FormattedDate>` is hand-authored, cross-cutting (used by both `(admin)` and `(account)` surfaces), and requires `'use client'`. It belongs in `src/components/shared/`, which CLAUDE.md defines as "cross-cutting components used by both surfaces." No new top-level directory is needed.

2. **ESLint rule.** A `no-restricted-syntax` pattern in the existing `eslint.config.mjs` requires zero new dependencies and no plugin infrastructure. The pattern targets the `MemberExpression` where the property name matches `toLocaleString|toLocaleDateString|toLocaleTimeString`. A `files` override block in the same flat config exempts `src/components/shared/formatted-date.tsx`. This is the simplest mechanism consistent with the project's strong preference against new dependencies and custom infrastructure.

3. **SSR fallback.** The ISO-8601 string from the database (e.g., `2026-05-18T14:32:00.000Z`) is available server-side. Rendering the date portion (`YYYY-MM-DD`, extracted with `.toISOString().slice(0, 10)` — not a locale call) inside `<time>` gives the SSR output a stable, unambiguous placeholder that is close in character length to most formatted results. On hydration the client replaces it with the viewer's local format. `suppressHydrationWarning` is set on the `<time>` element to prevent the React warning caused by the intentional mismatch. Rendering nothing (empty string) would cause a jarring layout shift; rendering the full ISO timestamp would be confusing to end users if JS were slow.

**Impact:** Adds `src/components/shared/formatted-date.tsx`. Adds one `no-restricted-syntax` config block plus one `files` override to `eslint.config.mjs`. No new npm packages. All five call sites in `(admin)` and `(account)` switch from direct `toLocale*` calls to `<FormattedDate>`. A new Key Invariant is added to `CLAUDE.md` and a one-liner is added to `.claude/agents/ux-developer.md`.

---

## DECISION-006: Forgot-password flow uses a separate `(password-reset)` route group

**Status:** Resolved
**Date:** 2026-05-17

**Decision:** The forgot-password flow (`/forgot-password`, `/reset-password`) lives in a new `src/app/(password-reset)/` route group rather than being merged into the existing `(email-verify)` group. The two public paths are added to `PUBLIC_PATHS` in `src/proxy.ts` (no prefix exception needed — the token is a query parameter, not a path segment).

**Rationale:** `(email-verify)` owns `/account/verify-email/[token]` — an authenticated-user flow where the token-consumption page is the only unauthenticated step. The forgot-password flow is unauthenticated end-to-end, lives in a different URL namespace, and writes to a different token table. Merging them into a shared "unauthenticated tokens" group would create a brittle grouping that conflates two unrelated concerns. The `(email-verify)` group is the pattern precedent (no layout, proxy bypass) but not a shared container.

**Impact:** Adds `src/app/(password-reset)/forgot-password/page.tsx` and `src/app/(password-reset)/reset-password/page.tsx`. The `(password-reset)` group has no `layout.tsx`. Two `PUBLIC_PATHS` entries added to `src/proxy.ts`. API route handlers under `src/app/api/auth/forgot-password/route.ts` and `src/app/api/auth/reset-password/route.ts` follow the existing pattern for auth-adjacent handlers.

---

## DECISION-005: Rendered deck PDF is committed to the repo

**Status:** Superseded by [DECISION-031](#decision-031-the-training-deck-is-removed-from-presby) (2026-08-18) — presby has no deck
**Date:** 2026-05-16

**Decision:** `deck/slides.pdf` is checked into git and re-committed every time `deck/slides.md` changes. `deck/slides.pptx` stays gitignored.

**Rationale:** A teaching artifact needs to be downloadable from the GitHub UI by anyone — including viewers who don't have Marp installed and don't want to run a build step. PDF is the lowest-common-denominator format; PPTX is large (~7 MB), Office-specific, and easily re-rendered from the source.

**Impact:** The repo will accumulate one PDF blob per non-trivial slide edit. At ~360 KB per snapshot, this is acceptable for the first few years of the project but will need revisiting later — `git lfs` migration, periodic squash, or moving the PDF to GitHub Releases are all viable when the history gets noisy. Flag this for review at the next 30-day documentation review.

---

## DECISION-004: Track the freshest sibling project (fertilityluna) for framework versions

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** When choosing major versions for Next.js, React, NextAuth, Drizzle, Tailwind, ESLint config, and TypeScript, the starter pins to whatever the most recently active sibling project (currently `~/git/fertilityluna`) is running. That means: Next.js 16.2, React 19.2, NextAuth 5.0.0-beta.31, Drizzle 0.45.2, Tailwind v4, ESLint config Next 16.2, TypeScript 5.9, otplib v13.

**Rationale:** A starter that drifts behind the freshest production project becomes a worse template than the production project itself. By policy-aligning to fertilityluna's versions, the starter benefits from the upgrade work already done there — Tailwind v4 migration, otplib v13's repackaged API, React 19.2's compiler-friendly patterns — without the starter's author having to re-litigate each bump in isolation. This also makes onboarding from fertilityluna (or any sibling) to a new fork trivial: the dependency graphs match.

**Impact:** Tailwind config moved from `tailwind.config.ts` to CSS-based config in `src/app/globals.css` (via the `@theme` block). PostCSS now uses `@tailwindcss/postcss` instead of the v3 plugin + autoprefixer stack. The starter no longer ships a JS Tailwind config file. Periodically re-check the sibling-project versions at the 30-day dependency review and bump accordingly.

---

## DECISION-003: Permissions are distinct from feature flags

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Maintain two separate concepts in the starter — *permissions* (per-user authorization) and *feature flags* (per-environment toggles) — backed by separate schema, separate runtime helpers, and separate admin surfaces. They will never be merged into a single mechanism.

- Permissions live in the `features` table, are bound to roles via `role_features`, and are checked at runtime with `hasFeature(session.user.features, FEATURES.KEY)`. The static catalog is `FEATURE_CATALOG` in `src/lib/permissions.ts`.
- Flags live in the `feature_flags` table and are checked with `isFlagEnabled(key)` in `src/lib/flags.ts`.

**Rationale:** The two concepts answer different questions. "Is this *user* allowed to do X?" requires per-user state and changes as users gain or lose roles. "Is feature X *turned on* for this environment?" requires environment-level state and is the right unit for staged rollouts, dark-launches, and kill switches. Conflating them — common in starters that ship only one — forces every fork to either re-implement the missing concept or distort one mechanism to do both jobs badly. Keeping them distinct from day one means downstream forks inherit a model that scales.

**Impact:** Every new gated feature in this starter (and in forks) asks both questions independently. Forks that don't need flags can ignore the flag table; forks that don't need granular permissions can use the single `admin.dashboard` feature as a coarse admin gate. Neither concept hides inside the other.

---

## DECISION-002: TOTP 2FA over WebAuthn for the starter's default factor

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Ship TOTP (time-based one-time passwords via RFC 6238) as the second factor in the starter, with the secret encrypted at rest under `AUTH_TOTP_ENCRYPTION_KEY`, recovery codes hashed, and a trusted-device cookie for the "remember this browser" affordance. WebAuthn is *not* included in the starter.

**Rationale:** TOTP works on every device a fork's users already own (Google Authenticator, 1Password, Authy, Bitwarden, the iCloud Keychain). It requires no platform-specific UI, no attestation logic, no FIDO server. The implementation is small enough to read top-to-bottom (`src/lib/two-factor.ts`) and the admin can reset a user's enrolment with one click when a phone is lost. WebAuthn is the better second factor in the abstract, but it adds platform-specific authenticator handling, attestation policy, and a more complicated reset path that most forks don't need on day one. Forks that need WebAuthn can add it as an additional factor alongside TOTP without rewriting the starter's auth flow.

**Impact:** New users land on `/signin/totp` after their first password (or first OAuth sign-in if the user has `twoFactorRequired = true`). The TOTP secret is generated server-side, displayed once as a QR code, and stored AES-GCM-encrypted. Recovery codes are issued in the same step. The middleware enforces the 2FA gate at the edge for any route that requires it.

---

## DECISION-001: Neon Postgres with Drizzle ORM

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Use Neon as the Postgres host and Drizzle ORM as the query layer for the starter. App connections use the pooled host (`-pooler` suffix) via `@neondatabase/serverless`; Drizzle Kit uses the direct (unpooled) host for DDL.

**Rationale:** Neon's branching is the killer feature for an SDLC-focused starter — every schema change can happen on a disposable branch, tested with the seed script, and only promoted to `main` when the shape is right. Scale-to-zero keeps the cost-of-ownership for a fresh fork at effectively zero until it has traffic. The serverless driver fits Next.js route handlers, server actions, and the Edge runtime constraints without separate connection pooling code. Drizzle ORM was chosen over Prisma for three reasons: (1) the generated query layer is a thin TypeScript wrapper rather than an out-of-process binary, which means no separate `prisma generate` step in the fork's build; (2) `schema.ts` is the source of truth and is reviewed as code, not as a separate `.prisma` DSL; (3) `db:push` makes early development on a branch fast, while `db:generate` produces reviewable SQL once the schema stabilizes.

**Impact:** The fork needs two environment variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). The schema in `src/lib/db/schema.ts` covers NextAuth's adapter tables plus the starter's own surface (roles, features, role bindings, TOTP, recovery codes, trusted devices, feature flags, audit events, migration seeds). Migrations during early development run via `db:push`; once a fork is in production, `db:generate` + committed SQL becomes the right path.
