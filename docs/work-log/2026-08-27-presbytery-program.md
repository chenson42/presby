# Presbytery program: cross-org data, publications, and rollups — Work Log

> **Slug:** `2026-08-27-presbytery-program`
> **Surface:** (org) portal — presbytery-side AND congregation-side (the publication verb); no public-site content (presbytery public URL = portal login for now)
> **Permission(s):** TBD by Phase 1/3 — expect statistics/publication keys on both sides of the hierarchy
> **Flag(s):** TBD — likely per-increment org_portal.* flags per the established pattern
> **Estimated complexity:** large — multiple increments, schema-heavy, first cross-org data flow in the platform
> **Pipeline mode:** Full — one work-log per shipping increment once the program plan settles; this file holds the program-level Phases 1-3
> **Source:** operator request, 2026-08-27 — "lets start work on the presbytery. the public site can just be the login to the portal right now. lets harvest from ../../presby-portal [resolved: ~/git/psvonline-portal]. think long and hard about functionality and how it relates to data from other orgs and how it gets roll ups." Supersedes/absorbs the deferred Increments 1/3/4/5 of docs/work-log/2026-08-26-presbytery-functionality.md.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete (Increments 3/3b/4a/4b + public-site fallback) | Design complete; implementers named per increment | 2026-08-27 |
| 4 — Implementation | TBD per increment (see Sequencing) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Every psvonline-portal capability forces the same fork — "is this congregation a real tenant or not" — and it resolves cleanly for everything except annual statistics, where the resolution is **publication** (a mechanism that doesn't exist yet, three candidate shapes); the headline finding is that **Q1 (blocked "congregation oversight") was never a downward-read problem**: once "the presbytery's own opinion about a congregation" is separated from "the congregation's own statistics," only the latter needs publication — the shipped `appointments` table already proves the former pattern.

## 1. Harvest inventory (psvonline-portal → presby source rulings)

- Congregation directory/detail overview: **already exists** (public org tree + organization_profiles/service_times).
- **Membership statistics (annual + trend): BOTH-UNIONED — the crux** (§2).
- Viability score/redevelopment notes, buildings/insurance: **presbytery-owned** for managed AND unmanaged alike — the presbytery's own judgment, never the congregation's record. Q1 dissolves here.
- Staff/appointments/credentials: **already shipped** (Increment 2); never a downward read (ministers hold membership at the presbytery, D1).
- People directory + CSV export: presbytery-owned, reuses Increment 2 data; export is UI-only.
- Committees: **already covered** by shipped groups/group_memberships — Increment 1 unaffected.
- Dashboard (viability map, stat cards), reports (trend/per-capita/viability/buildings/vacant-pulpits): pure consumers. **Vacant pulpits is answerable today** from `appointments` alone (no open installed/designated-pastor row = vacant).
- Per-capita: presbytery-owned rate/ledger; `ending_active` comes from the unioned statistics read — **no live roll read needed even for managed congregations** (psvonline's own column is commented "snapshot at calculation time").
- CSV/Church360/PC(USA)-stats import: writes ONLY into the presbytery-owned statistics table, never a managed congregation's tenant tables; superseded by publication like any presbytery-entered row.
- AI assistant: out of scope (needs its own tier-aware permission story). Ideas/roles/release-notes admin: superseded by presby's own platform shell — do not build.

## 2. The Annual Statistics Fork

**2a. Unmanaged:** presbytery-owned `congregation_statistics` keyed (organizationId=presbytery, aboutOrgId=congregation, year), entered or imported — structurally the `appointments` pattern, D1-clean, D9's own "stewarded by its parent council" precedent. No new mechanism.

**2b. Managed — publication up, the only invariant-compliant answer:**
- **Trigger:** the congregation's own clerk/session, annually (the real PC(USA) SASR workflow; D3's session-ratifies/clerk-submits pattern). A congregation-side verb — the first this program adds.
- **Contents:** aggregates only, confirmed against schema-design §13's SASR field list (counts, gains/losses by kind, age/gender/racial-ethnic breakdowns, financials, attendance). **No named person rows, no named officers.** The publish path must be an explicit column allow-list — `sasr_reports.payload` is jsonb, and wholesale-copying it is the smuggling vector (named risk).
- **Where it lands — three shapes for the architect:** (1) a bespoke two-sided table shaped like transfer_certificates/person_links (issuing writes, issuing+receiving read — §17's rare-and-named exception pattern); (2) a SECURITY DEFINER `presby_publish_sasr_snapshot()` called inside the congregation's context, independently re-verifying parentId (F26 discipline), inserting a normal presbytery-owned row; (3) a platform-mediated copy — **name-and-decline** (getPlatformDb is forbidden in (org); more moving parts, no benefit). Recommendation: (1) or (2).
- **Immutability:** freeze on submit (roll_actions precedent; `sasr_reports.status='submitted'` exists unused). **Corrections:** republish-supersedes via `supersedesPublicationId`, never in-place (the void pattern) — also an adversarial property: a congregation cannot quietly rewrite a year the presbytery already billed against.

**2c. Per-capita derives from the publication's `ending_active` × rate — closing what looked like a second downward-read need.**

## 3. Reconciliation — union with provenance

Read-time coalesce of presbytery-entered rows (unmanaged) and publications (managed); **provenance is a first-class displayed column** (`presbytery_entered | published_by_congregation | imported`) — "Presbytery estimate" vs "Congregation reported," never conflated (attribution integrity is adversarial territory too). Publication wins the coalesce for the same (congregation, year) but the presbytery row is never deleted — pre-management history stands, and a divergence between estimate and self-report stays visible as signal. Unmanaged→managed transition falls out of the coalesce with no special logic.

## 4. Q1 RULING — Increment 3 unblocks now

Increment 3 becomes "presbytery-owned congregation-oversight records (viability + buildings/insurance)" — no publication dependency, no cross-org RLS, no architect downward-access ruling. The one residual genuine downward read (clerk verifying a managed congregation's roll during an administrative commission) is **already modeled** (`administrative_commissions` + the resolver's commission arm) — the invariant's own time-boxed, minuted exception; its create-UI is a future increment, not a blocker. **Q1 closes as resolved-by-reframing.**

## 5. Upward generalization

Use organization-agnostic column names (issuingOrgId/receivingOrgId, never congregationId/presbyteryId) so the identical publication mechanism serves presbytery→synod (per-capita flows all the way up) without redesign.

## User Verbs

Presbytery clerk: enter/update viability + buildings/insurance; enter/import statistics (unmanaged); view published statistics (managed, read-only); set per-capita rate, mark paid; view the provenance-labeled rollup dashboard; bulk import (deferred). **Congregation clerk (the new side): publish the annual statistical snapshot; view publication history; correct by republishing.**

## Permissions & Flags (candidates)

`congregation_oversight.manage/view` (tier ~1 — presbytery's own opinion), `statistics.manage` (tier 1-2), **`statistics.publish` — a genuinely new permission SHAPE: bound at the congregation, effect felt at the presbytery — flag for the architect**, `per_capita.manage/view` (tier 2), `presbytery_reports.view`. Flags per increment: `org_portal.congregation_oversight`, `.congregation_statistics`, `.statistical_publication`, `.presbytery_dashboard` (seeded off).

## Gaps & Adversarial Pass

Audit publication and oversight writes (financial stakes, cross-boundary effect) even beyond Rule-7's letter; empty states ("No data on file" ≠ "Not yet published this year"); publish-failure microcopy; dense tables use the accepted scroll pattern; **billing-timing lag** (current-year vs arrears) is a real Phase 3 decision. Adversarial: column allow-list on publish (never trust the jsonb); provenance mislabeling as attribution-integrity risk; the second-org-id URL pattern re-validated server-side (the Increment-2 finding); SECURITY DEFINER parentId re-verification (confused deputy); server-side range validation at the trust boundary; freeze-and-supersede as manipulation protection.

## Public-Site Note

Presbytery public URL = login link (operator directive). One cheap check for architect/tech-lead: what does `(public)/site/<slug>` render today for a never-provisioned org — if it 404s, "just a login link" needs one trivial UI-only fallback page (org name + sign-in), no schema.

## Out of Scope (confirm)

AI assistant (own permission story first); bulk import (lowest priority); tenant audit reader (deferred platform-wide); viability map pins (rendering polish over data already placed).

## Open Questions (operator)

1. AI assistant — near-term roadmap or fully parked? 2. Import format priority (generic CSV vs PC(USA)-stats format)? 3. Viability map visual — v1 or later polish? 4. **Per-capita billing timing — current-year ending count or prior-year (arrears)?** 5. Can publication (4a) ship dark against fixtures to unblock the dashboard (4b), ahead of real congregation onboarding?

## Proposed Increments (dependency-ordered)

- 1 Committees & commissions — independent, UI-mostly (existing groups).
- **3 Congregation oversight (viability/buildings/insurance) — SHIPPED 2026-08-27, SHIP WITH NOTES.** `docs/work-log/2026-08-27-presbytery-oversight-statistics.md`.
- **3b Congregation statistics (unmanaged + provenance coalesce) — SHIPPED 2026-08-27, same work-log, same SHIP WITH NOTES verdict.** Known gap: new_worshiping_community congregations excluded from oversight/statistics/per-capita — tracked in docs/TODO.md.
- **4a Annual statistical publication — SCHEMA/MECHANISM SHIPPED 2026-08-27** (`presby_publish_sasr_snapshot()` + `presby_list_own_congregation_publications()`, same migration 0038). **Congregation-side UI remains** — server action + audit (api-developer) then publish form + history (ux-developer), ships dark behind `org_portal.statistical_publication` (seeded off). Work-log: `docs/work-log/2026-08-27-statistical-publication.md`.
- 4b Presbytery dashboard/rollups — union of 3b+4a with provenance + per-capita schema; can stage against 3b alone first.
- 5 Imports & reports — vacant-pulpits needs zero new schema; imports lowest priority.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |

**Handoff:** architect (Phase 2) — rule on: (1) the publication mechanism shape; (2) whether `statistics.publish`'s cross-org-effect shape needs anything new in the permission model; (3) the public-site fallback check. Increments 1/3/3b can proceed independent of those rulings.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Ruling 1 — Publication mechanism: SECURITY DEFINER function (shape b); bespoke two-sided RLS declined

`presby_publish_sasr_snapshot()`, called inside the congregation's own `withOrgContext()`, inserting a **normal presbytery-owned row under the standard tenant_isolation policy**. Shape (a) declined: §17 names person_links/transfer_certificates as a deliberately-closed set of two-org reads, and DECISION-112 already declined a third bespoke policy for this very program; a bespoke-policied table would also force every presbytery-side consumer to special-case it, where a normal row composes free with the dashboard union/per-capita/exports. Shape (c) platform-mediated copy: ratified as name-and-declined.

- **Confused-deputy invariant (F26): the presbytery target is DERIVED, never asserted.** The function takes no caller-supplied target org — it re-resolves `organizations.parentId` + `organizationType='presbytery'` internally. Generalizes upward for free: the same function called from a presbytery's context walks one more link to the synod.
- **The parameter list IS the allow-list.** Each SASR aggregate is an individual typed named parameter (per §13's field table); `sasr_reports.payload` jsonb is never accepted or forwarded — a field with no parameter slot cannot smuggle through, stronger than any runtime key-stripping. The calling server action extracts fields from the congregation's approved sasr_reports row; the function never reads it.
- **Column naming:** organizationId (owner=presbytery) / aboutOrgId (subject=congregation) — matching the program's sibling tables, NOT issuing/receiving (that would introduce a second incompatible convention).
- **Freeze + supersession ratified:** trigger rejects UPDATE on published rows (roll_actions precedent); corrections via `supersedesPublicationId` (AnyPgColumn self-FK idiom per events.parentEventId). Read-time coalesce ratified: publication wins display precedence per (aboutOrgId, year), presbytery-entered rows never deleted, provenance (`presbytery_entered | published_by_congregation | imported`) first-class and displayed.
- **Audit:** the calling action records the audit event in the same tx — atomic for free.
- **Phase 3 to weigh:** ONE `congregation_statistics` table with a provenance column (freeze applying only to published rows) vs two tables coalesced — the single table is the shape that falls out most cheaply; Phase 3's call.
- Ships with test-rls.sql assertions proving a congregation cannot spoof/widen its publication target, exercised against two real seeded orgs (congregation + its actual parent), and the established SECURITY DEFINER migration-comment discipline.

## Ruling 2 — `statistics.publish`: ordinary tenant permission; nothing new in the model

The permission answers "may this person publish, at this congregation" via the existing resolver; the mechanism answers "where the write lands." The two never merge (the authz.ts separation applied one layer up). **Default binding: the congregation's own `stated_clerk`** per DECISION-078's constitutional-duty test (SASR submission is the clerk's register-keeping job, the same office roll.propose sits on) — never conflated with the presbytery-scoped `presbytery_stated_clerk` template. Adjacent note for Phase 3: run the same test on the presbytery-side keys (`presbytery_stated_clerk` is the defensible fit for statistics/oversight entry, not `executive_presbyter`, per DECISION-112's own reasoning).

## Ruling 3 — Public site: confirmed 404 today; narrow type-scoped fallback (option ii)

`getPublishedSite()` not_found → unconditional `notFound()` (enumeration-safe collapse, by design). That property protects a CONGREGATION's platformStatus; a presbytery/synod/GA's existence is already public via the org tree (bare select grant, publicOrgSummary's own comment). Ruling: on the miss branch, one extra `publicOrgSummary(slug)` call — if the org exists AND organizationType ∈ {presbytery, synod, general_assembly}, render a minimal fallback (org name + sign-in link to /o/<slug>); congregations keep the untouched 404 collapse. No schema, no new function, brand-scope legal as-is. Ships standalone (Polish-class) or alongside 4b — no ordering dependency.

## Placement & invariants

- **New domain file `src/lib/db/domain/presbytery.ts`** (DECISION-120 proposed) — "the presbytery's operational relationship to its member congregations" — not an extension of reporting.ts (single-purpose SASR source doc) or officers.ts ("who serves" shapes). One-directional imports only.
- Increments 3/3b: no caveats beyond the appointments pattern — no person columns needed (aggregate/administrative data), aboutOrgId plain FK per §17's structural exception. If a future "recorded by" person column appears: composite FK to the presbytery's own memberships, never bare people(id).
- Permissions vs Flags: publish action checks both `statistics.publish` and `org_portal.statistical_publication`, never merged.
- No new npm dependencies for the mechanism/CRUD increments.

## Implementer sketch (tech-lead finalizes)

database-admin first (presbytery.ts schema + function migration + freeze trigger + test-rls assertions); Increments 3/3b full-stack-developer; Increment 4a split api-developer (the server action wiring the SECURITY DEFINER call + audit — first-of-its-kind flow deserves the dedicated half) then ux-developer (publish confirmation UI + presbytery-side read-only history); 4b ux-heavy once 3b/4a land.

## Proposed decisions (tech-lead logs at Phase 3)

DECISION-118 (publication mechanism as ruled), DECISION-119 (statistics.publish shape + stated_clerk binding), DECISION-120 (presbytery.ts domain file), DECISION-121 (public-site type-scoped fallback).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |

**Handoff:** tech-lead (Phase 3) — design Increments 3/3b (immediate) and 4a/4b; log DECISION-118-121; resolve: one-table-vs-two for statistics, and 4a's implementer split.

---

## Phase 2 Addendum — Viability-map dependency (architect, 2026-08-27)

**Approved with conditions.**

1. **`leaflet` directly (BSD-2-Clause, ^pin + lockfile), NOT `react-leaflet`** — react-leaflet@5 is licensed **Hippocratic-2.1** (verified against the npm registry), an ethical-use license outside the repo's accepted classes; dispositive, not a style call. One small `'use client'` wrapper component with a ref + useEffect; `@types/leaflet` as an ordinary devDependency.
2. **Tiles: keyed free-tier provider (MapTiler recommended)** — raw OSM tile servers violate their usage policy the day a second presbytery onboards. One named `img-src` host added to next.config's CSP (the frame-src named-host-exception precedent); the key is a public domain-restricted `NEXT_PUBLIC_*` value (Turnstile-site-key shape, no secret plumbing). Bare OSM tiles allowed as a dev-only convenience path within the policy's low-volume carve-out. connect-src unaffected (raster tiles load via <img>).
3. **Degradation:** the map renders a plain list/table fallback (name, viability badge, oversight link) when Leaflet's tileerror events cross a small threshold — the offline-manse case is JS-alive/network-dead, so noscript is the wrong trigger. Same data as the pins; a rendering branch, not a second path.
4. **Scope containment (Phase 4 deliverable, gates Phase 5):** `next/dynamic(..., { ssr: false })` from insights/page.tsx's presbytery branch; leaflet CSS imported inside map.tsx only, never globals.css; a `check:deps-drift`-style tripwire failing the build if leaflet/react-leaflet is imported anywhere outside `insights/map.tsx` (+ its test), and failing outright if react-leaflet ever appears in package.json.

Logged as **DECISION-122**. The rest of Increment 4b proceeds independently; the map slice folds these conditions into its design before an implementer is named. Operator action eventually needed at 4b time: provision a MapTiler free-tier key (domain-restricted, public).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 addendum — map dependency | architect | Complete | Approved with conditions | 2026-08-27 |

---

## Operator Answers (2026-08-27, recorded by the orchestrator)

1. **Per-capita billing basis: researched at the operator's request.** Real PC(USA) practice is arrears on a two-year lag — the GA invoices presbyteries for billing year N on congregations' active membership as of December 31 of year N-2 (the N-1 statistical reports aren't compiled until mid-N); presbyteries bill congregations on the same basis. **Design: the per-capita rate table carries an explicit presbytery-set basisYear per billing year, defaulting to N-2** — faithful to the dominant practice without hardcoding local variation. (Sources: pcusa.org per-capita page; Great Rivers Presbytery per-capita FAQ; Presbytery of Cincinnati.)
2. **Publication ships dark: YES** — build 4a against seeded fixtures, flag off, unblocking 4b's end-to-end flow in dev.
3. **Viability map: IN V1 of the dashboard** (operator overrode the defer recommendation). Phase 3 must name the rendering approach — if it requires a new npm dependency (a map library), that is a Phase 2 addendum question for the architect BEFORE implementation, per the dependency rule; a dependency-free approach (static SVG/tile embed) should be weighed first.
4. **Imports: deferred entirely** — hand-entry covers the near term; formats chosen when a real presbytery brings real spreadsheets.
5. AI assistant: remains fully out of scope (operator did not elevate it).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Four increments turn the architect's Phase 2 rulings into a buildable shape. **Increment 3** gives a presbytery a place to record its own opinion of a member congregation (viability, redevelopment notes, buildings/insurance) — presbytery-owned, no cross-org read, unblocked since Phase 1's Q1 reframing. **Increment 3b** is the same pattern applied to statistics for congregations the presbytery must estimate for (unmanaged/imported). **Increment 4a** is the first cross-org write in the platform: a managed congregation's own clerk publishes an annual aggregate snapshot upward through a `SECURITY DEFINER` function that derives its own target (no caller-supplied org id, anywhere), landing as an ordinary presbytery-owned row. **Increment 4b** reads all of it back — a provenance-labeled rollup, per-capita computation, vacant-pulpits, and a viability map whose pin-rendering approach is named below but gated on an architect dependency addendum before implementation. One new table family (`src/lib/db/domain/presbytery.ts`, DECISION-120), one new SECURITY DEFINER function pair, one genuinely new permission shape (`statistics.publish`, bound at the congregation, effective at the presbytery), and three of four flags reuse the product-IA scaffold's existing placeholder flags rather than minting duplicates.

## Permissions & Flags

**Permission keys** (new rows in the `permissions` catalog, migration-seeded like `credentials.manage`):

| Key | Module | Tier | Default binding | Rationale |
|---|---|---|---|---|
| `congregation_oversight.manage` | `presbytery` | 1 | **none** — fixture-only grant to `presbytery_stated_clerk` for dev reachability, commented as a convenience, not a production default | Ran DECISION-078's test honestly and it does NOT pass the way `credentials.manage`/`demographics.manage` did: viability assessment/buildings-insurance judgment is Committee-on-Ministry-adjacent oversight, not the clerk's register-keeping duty. Follows `groups.manage`/`events.manage`'s precedent (DECISION-110/115) — no PC(USA) office is *the* constitutional keeper of "our opinion of this congregation," so nothing gets bound by default rather than accreting a fourth unjustified permission onto `presbytery_stated_clerk`. |
| `statistics.manage` | `presbytery` | 2 | `presbytery_stated_clerk` | Passes DECISION-078's test directly — entering/importing/correcting a congregation's statistical record is the same SASR-compilation duty `demographics.manage` already binds to `stated_clerk` for (DECISION-108), one level up the hierarchy. Tier 2, not 1: the aggregate carries financial totals (receipts/expenditures), and "financial" is tier 2 by the schema's own definition regardless of aggregation level — a stricter read than `congregation_oversight.manage`'s tier 1, deliberately. |
| `per_capita.manage` | `presbytery` | 2 | `presbytery_stated_clerk` | Same test, same office — per-capita rate-setting and billing derives directly from the statistical record the clerk already compiles; tier 2 (financial), matching Phase 1's own candidate. |
| `statistics.publish` | `presbytery` (module named for the mechanism's home, not the acting org — matches `credentials.manage`'s module convention) | 2 | **the congregation's own `stated_clerk`** (architect Ruling 2) | SASR submission is the clerk's constitutional register-keeping duty (G-3.0304) at the congregation, same test, same office, one level *down* from the other three keys in this table — never conflated with `presbytery_stated_clerk`. |

No split into `.view` variants for any of the four — Phase 1 floated it, Phase 3 declines: nobody with `.manage` needs a narrower read-only sibling in this design, and none of the four tables has a UI surface where a would-be viewer holds a different permission than the editor. Revisit if a future increment wants a read-only presbytery reports viewer role.

**Flags** — reconciled against the product-IA scaffold (`docs/work-log/2026-08-27-product-ia-scaffold.md`, DECISION-117), which already ships three placeholder routes with flags seeded ON for dev-only roadmap visibility. **Do not mint new flags for areas the scaffold already owns:**

| Flag | Owning route | Increment | New or existing |
|---|---|---|---|
| `org_portal.oversight` | `/o/<slug>/admin/oversight` | 3 | **Existing** — reused verbatim. The stub's `ComingSoon` body is replaced by the real page behind the SAME flag; flag-off and not-available branches are untouched. |
| `org_portal.reports` | `/o/<slug>/admin/reports` | 3b (+ 4a's presbytery-side rate/record entry) | **Existing** — reused. The tile's own description ("Per-capita/SASR rollup... for a presbytery") already names exactly this surface. |
| `org_portal.insights` | `/o/<slug>/admin/insights` | 4b | **Existing** — reused. Universal tile, but this increment only builds the `presbytery` branch; every other org type keeps rendering `ComingSoon` unchanged (nothing in Phase 1 names congregation-level insights content yet). |
| `org_portal.statistical_publication` | new `/o/<slug>/admin/statistics` | 4a (congregation-side) | **New.** No existing stub covers a congregation-scoped route — the three scaffold placeholders are all presbytery-only or universal-with-presbytery-only content. Seeded OFF; ships dark per Operator Answer 2. |

**Seeding correction (do at Increment 3's migration, not deferred):** `org_portal.oversight`/`org_portal.reports`/`org_portal.insights` are seeded ON today *only* because presby has no real congregation or presbytery onboarded and the operator wanted the full roadmap visible in dev (the scaffold's own loud comment in `scripts/seed.ts`). They stop being placeholder-visibility flags the moment real code sits behind them. Per the operator's explicit instruction this pass: **flip all three to seeded OFF**, following the same convention every other real feature uses, and flip them ON manually in the dev database (the same manual step already used for `credentials`) so dev testing isn't blocked. This is a one-line change per flag in `scripts/seed.ts`'s existing rows — not a new flag, not a rename.

Every gated action/page checks both questions, never merged (DECISION-003): the flag ("is this behavior on"), and the tenant permission ("may this person do this here").

## API Contract

All of `presbytery.ts`'s write paths follow the `credentials.ts`/`actions.ts` split already established for Increment 2 (`admin/credentials/actions.ts`): a thin `"use server"` file does auth-in-the-action-body (`resolveOrgContext` → `organizationId`/`personId`, never client-supplied) plus the audit write; a plain module (`src/lib/presbytery.ts`) holds the actual permission check, validation, and Drizzle calls, returning a `{ kind: "ok" | "forbidden" | "invalid_target" | "invalid_input", ... }` discriminated result.

**Increment 3 — Congregation oversight**
- `getCongregationOversightList(organizationId): Promise<OversightRow[]>` — every child congregation of this presbytery joined against its (possibly absent) `congregation_oversight` row. Read directly from the page, not through an action (matches `officers`/`credentials` read-path convention).
- `setCongregationOversightAction(slug, aboutOrgId, input: SetOversightInput): Promise<ActionResult<{ id: string }>>` — upsert on `(organizationId, aboutOrgId)`. Checks `congregation_oversight.manage` + `org_portal.oversight`. Validates `aboutOrgId` is an actual child (`parent_id = organizationId AND organization_type = 'congregation'`) of the acting presbytery before writing — the same server-side re-validation discipline `recordAppointment`'s `servingOrgId` check already established for a second-org-id-in-the-URL pattern.

**Increment 3b — Congregation statistics (presbytery-entered) + per-capita**
- `getCongregationStatisticsRollup(organizationId, year): Promise<StatisticsRollupRow[]>` — the provenance-labeled coalesce read (see Data Model). Shared by 3b's own list view and 4b's dashboard.
- `setCongregationStatisticsAction(slug, aboutOrgId, year, input: SasrAggregateInput): Promise<ActionResult<{ id: string }>>` — upsert on `(organizationId, aboutOrgId, year, provenance='presbytery_entered')`. Checks `statistics.manage` + `org_portal.reports`.
- `setPerCapitaRateAction(slug, billingYear, input: { basisYear?: number; ratePerMember: string }): Promise<ActionResult<{ id: string }>>` — upsert on `(organizationId, billingYear)`; `basisYear` defaults `billingYear - 2` server-side if omitted. Checks `per_capita.manage` + `org_portal.reports`.
- `generatePerCapitaRecordsAction(slug, billingYear): Promise<ActionResult<{ created: number; skipped: string[] }>>` — for every child congregation, reads the rollup at `basisYear`, snapshots `endingActiveBasis`/`rateApplied`/`amountOwed` into a new `per_capita_records` row (skips — names, doesn't fail — any congregation with no statistics on file for that basis year). Checks `per_capita.manage` + `org_portal.reports`.
- `recordPerCapitaPaymentAction(slug, recordId, input: { paidAmount: string; paidAt: string }): Promise<ActionResult<{ id: string }>>` — updates `paidStatus`/`paidAmount`/`paidAt` on an existing record (mutable — this is a ledger-lite payment status, not append-only). Checks `per_capita.manage` + `org_portal.reports`.

**Increment 4a — Statistical publication (congregation-side)**
- SQL: `presby_publish_sasr_snapshot(p_report_year int, p_minute_reference text, <every SASR aggregate as its own named typed parameter — see Data Model>) returns uuid` — `SECURITY DEFINER`, called from inside the *congregation's own* `withOrgContext()`. Takes **no organization id parameter of any kind** — reads `presby_current_org()` to learn who is publishing, so there is nothing in the signature a caller could spoof.
- SQL: `presby_list_own_congregation_publications(p_year int default null) returns setof congregation_statistics` — `SECURITY DEFINER`, the read counterpart. Filters internally to `about_org_id = presby_current_org() AND provenance = 'published_by_congregation'` — a congregation reading rows that live in its parent presbytery's tenant space, the same "narrow controlled read, no bespoke RLS policy" shape as `presby_match_person()`. Not named by the architect's Phase 2 ruling explicitly, but the same mechanism family it already approved (a SECURITY DEFINER function, not a second bespoke cross-org RLS policy) — needed because Phase 1 asks for "publication history" and there is otherwise no way for the publisher to read its own published row back.
- `publishStatisticsAction(slug, input: PublishSnapshotInput): Promise<ActionResult<{ publicationId: string }>>` — checks `statistics.publish` + `org_portal.statistical_publication`, calls `presby_publish_sasr_snapshot()` inside `withOrgContext(personId, congregationOrgId, ...)`, writes `STATISTICS_PUBLISHED` audit at the congregation's own org context.
- `getOwnPublicationHistory(slug): Promise<PublicationRow[]>` — calls `presby_list_own_congregation_publications()`, read directly from the page.

**Increment 4b — Dashboard**
- `getPresbyteryDashboard(organizationId, year): Promise<DashboardData>` — composes `getCongregationStatisticsRollup()`, a vacant-pulpits query against `appointments`, and `per_capita_records` for the year. Read directly from the page.
- Map slice (gated, see Data Model / Edge Cases): `getCongregationMapPoints(organizationId): Promise<MapPoint[]>` reads `congregation_oversight.latitude/longitude` where non-null.

**Public-site fallback**
- No new action. `getPublishedSite()`'s existing `not_found` branch gains one extra call to the existing `publicOrgSummary(slug)` on the miss path only.

## Data Model

**One `congregation_statistics` table, not two — resolving the architect's open question.** A `provenance` column, not a parallel table, per the architect's own lean: every consumer (3b's list, 4a's read-back, 4b's rollup, per-capita's basis-year lookup) needs the SAME (about-org, year) keyspace regardless of who wrote the row, and a two-table design would force every one of those four call sites to `UNION`/coalesce across two tables instead of one. The freeze constraint the architect worried about (immutability applies to published rows only, not entered ones) is expressible as a **partial** unique index plus a trigger predicate keyed on the same column — it does not need a second table to be enforced correctly.

```
congregation_oversight
  id                  uuid pk
  organization_id     uuid not null references organizations (presbytery — the owner)
  about_org_id        uuid not null references organizations (congregation — the subject;
                      PLAIN fk, not composite — organizations is the one cross-tenant-
                      readable structural table, schema-design §17)
  viability_score     smallint            -- 1-3, CHECK (viability_score between 1 and 3)
  redevelopment_notes text
  buildings_notes     text                -- kept as free text in v1, not a structured
                      buildings/insurance schema — psvonline's shape is richer than any
                      requirement Phase 1 named; a structured schema is a future increment
                      if a real presbytery asks for one
  insurance_carrier   text
  insurance_expires_on date
  latitude            numeric             -- MANUALLY entered by the presbytery clerk; see
  longitude           numeric             -- the map rendering note below for why this lives
                                          -- HERE and not on organization_profiles
  updated_by          uuid not null references users(id)
  updated_at          timestamptz not null default now()
  -- ONE mutable row per congregation, like organization_profiles — no history table.
  -- audit_events already captures "who changed the viability score and when"; a
  -- dedicated history table is added only if a future increment names an actual
  -- restore-previous requirement (same bar organization_brand_history cleared).
  unique (organization_id, about_org_id)
  unique (id, organization_id)
  index (organization_id, about_org_id)
  FORCE ROW LEVEL SECURITY, standard tenant_isolation policy

congregation_statistics
  id                       uuid pk
  organization_id          uuid not null references organizations (presbytery — the owner,
                           for EVERY provenance including published rows — the publish
                           function inserts here, not at the congregation)
  about_org_id             uuid not null references organizations (congregation; plain fk)
  year                     integer not null
  provenance               text not null   -- 'presbytery_entered' | 'published_by_congregation'
                                            -- | 'imported' — CHECK constraint, not an app-only
                                            -- convention (mislabeling is a named adversarial risk)
  supersedes_publication_id uuid references congregation_statistics(id)
                           -- only meaningful for provenance='published_by_congregation';
                           -- self-fk, AnyPgColumn idiom (events.parentEventId precedent)
  published_at             timestamptz     -- set only for published rows
  entered_by               uuid references users(id)  -- null for published rows (the
                           -- presbytery didn't write it) and for imports with no human actor
  -- Gains (SASR §13). 17-and-under / 18-and-over split matches the schema-design field
  -- table exactly; "certificate"/"other" are the report's own remaining gain lines.
  gains_professions_under18 integer, gains_professions_18plus integer,
  gains_certificate integer, gains_other integer,
  -- Losses
  losses_certificate integer, losses_deaths integer, losses_other integer,
  -- Ending rolls
  ending_active integer, ending_baptized integer, ending_affiliate integer,
  ending_other_participants integer,
  -- Gender (2024 SASR categories)
  gender_woman integer, gender_man integer, gender_nonbinary integer,
  -- Age brackets, incl. the schema's own "unknown" bucket (F-adjacent: age
  -- distribution must not silently under-report members with no birthdate)
  age_17_under integer, age_18_25 integer, age_26_40 integer, age_41_55 integer,
  age_56_70 integer, age_71_over integer, age_unknown integer,
  -- Racial-ethnic, 9 SASR categories. LEAN CALL: aggregate against ACTIVE MEMBERSHIP
  -- ONLY in v1 — the full SASR also cross-tabs this by elder/deacon, which no
  -- consumer in this design (3b's list, 4b's dashboard, per-capita) needs, and which
  -- would triple the column count for zero near-term benefit. Revisit if a
  -- presbytery asks for the officer breakdown.
  race_asian integer, race_african integer, race_african_american integer,
  race_black integer, race_hispanic integer, race_middle_eastern integer,
  race_native_american integer, race_white integer, race_other integer,
  -- Disabilities (aggregate; a congregation without per-person tracking enabled
  -- reports these as aggregate counts per schema-design §11's own note)
  disability_hearing integer, disability_mobility integer, disability_sight integer,
  disability_other integer,
  -- Officers. LEAN CALL, same reasoning as race: TOTAL counts only, no gender
  -- cross-tab in v1 (no consumer needs it yet).
  officers_ruling_elder_count integer, officers_deacon_count integer,
  -- Baptisms, youth
  baptisms_children integer, baptisms_adults integer,
  youth_4_under integer, youth_k_5 integer, youth_6_8 integer, youth_9_12 integer,
  -- Worship / giving-unit counts
  avg_weekly_worship_attendance integer, potential_giving_units integer,
  -- Financial (14 SASR lines + budgeted income/expense, all numeric(12,2))
  receipts_contributions numeric, receipts_capital_building_funds numeric,
  receipts_investment_endowment_income numeric, receipts_bequests numeric,
  receipts_other_income numeric, receipts_subsidy_or_aid numeric,
  exp_local_program numeric, exp_local_mission numeric, exp_capital numeric,
  exp_investment numeric, exp_per_capita_apportionment numeric,
  exp_validated_mission_pcusa numeric, exp_ga_theological_education_fund numeric,
  exp_other_mission numeric,
  budgeted_income numeric, budgeted_expense numeric,

  created_at timestamptz not null default now()
  unique (id, organization_id)
  -- Partial unique index: mutable provenances upsert cleanly; published rows are
  -- NEVER unique-constrained on (about_org_id, year) because republishing inserts
  -- a brand-new frozen row chained by supersedes_publication_id, not an UPDATE.
  unique index congregation_statistics_entered_unique_idx
    on (organization_id, about_org_id, year, provenance)
    where provenance in ('presbytery_entered', 'imported')
  index (organization_id, about_org_id, year)
  CHECK (provenance in ('presbytery_entered','published_by_congregation','imported'))
  CHECK every integer column >= 0 (boundary validation belt-and-suspenders — the
    SECURITY DEFINER function is the primary gate, see below)
  FORCE ROW LEVEL SECURITY, standard tenant_isolation policy
  TRIGGER presby_reject_published_statistics_write(): BEFORE UPDATE OR DELETE
    WHEN (OLD.provenance = 'published_by_congregation') → RAISE EXCEPTION.
    Corrections are a new INSERT with supersedes_publication_id set, never an
    UPDATE — the roll_actions/void precedent, applied to a column instead of a
    second table.

per_capita_rates
  id                uuid pk
  organization_id   uuid not null references organizations (presbytery)
  billing_year      integer not null
  basis_year        integer not null    -- explicit, presbytery-set; defaults to
                                        -- billing_year - 2 at the ACTION layer
                                        -- (Operator Answer 1), not a generated column —
                                        -- a presbytery may legitimately override it
  rate_per_member   numeric not null    -- ONE combined rate, not three GA/synod/
                                        -- presbytery components. LEAN CALL: no
                                        -- consumer in this design needs the
                                        -- component breakdown, and real presbyteries
                                        -- commonly bill congregations one blended
                                        -- number even though it internally funds
                                        -- three levels. Revisit when a presbytery→
                                        -- synod remittance workflow is actually built
                                        -- (Phase 1 §5's upward-generalization note).
  updated_by        uuid not null references users(id)
  updated_at        timestamptz not null default now()
  unique (organization_id, billing_year)
  unique (id, organization_id)
  FORCE ROW LEVEL SECURITY, standard tenant_isolation policy

per_capita_records
  id                  uuid pk
  organization_id     uuid not null references organizations (presbytery)
  about_org_id        uuid not null references organizations (congregation; plain fk)
  billing_year        integer not null
  basis_year          integer not null      -- copied from the rate row at generation
                                            -- time, for the same "don't retroactively
                                            -- drift" reason as the two snapshot
                                            -- columns below
  ending_active_basis integer not null      -- SNAPSHOT of the rollup read at
                                            -- generation time (psvonline's own
                                            -- comment: "snapshot at calculation
                                            -- time," carried forward deliberately)
  rate_applied        numeric not null      -- SNAPSHOT of per_capita_rates at
                                            -- generation time
  amount_owed         numeric not null      -- STORED, not a generated column —
                                            -- ending_active_basis * rate_applied,
                                            -- computed once and frozen so a later
                                            -- rate correction or restatement cannot
                                            -- silently move a bill already issued
  paid_status         text not null default 'unpaid'   -- unpaid | partial | paid
  paid_amount         numeric
  paid_at             timestamptz
  updated_by          uuid references users(id)
  updated_at          timestamptz not null default now()
  unique (organization_id, about_org_id, billing_year)
  unique (id, organization_id)
  FORCE ROW LEVEL SECURITY, standard tenant_isolation policy
```

**Why `latitude`/`longitude` live on `congregation_oversight`, not `organization_profiles`.** Phase 1's functionality inventory said organizations "already carry" mappable coordinates — **verified false**: `organization_profiles.address` (`src/lib/db/domain/sites.ts`) is a single free-text line with no lat/lng column at all, and `addresses.latitude/longitude` (`people.ts`) is a person/household address column, structurally unreachable from an org-level map. Geocoding-as-a-service is out of scope (a new external dependency and a real sub-problem Phase 1 never asked for). The lean path: two manually-entered nullable columns on the table the presbytery *already* edits for every member congregation, managed or not — `organization_profiles` is congregation-editable and simply does not exist for the majority-unmanaged case D9 describes, so it cannot be the map's data source without also solving "who fills this in for a church with no session on the platform." `congregation_oversight` has no such gap.

## Component / Page Plan

**Increment 3** — `/o/<slug>/admin/oversight/page.tsx` **replaces** its `ComingSoon` body with the real list (one row per child congregation, viability badge, buildings/insurance summary) → click-through to a detail/edit form (new `oversight/[aboutOrgId]/page.tsx` + `edit-form.tsx`). Same flag (`org_portal.oversight`), same auth/flag/org-type-check three-step the stub already runs — only the final branch changes. New: `src/lib/presbytery.ts` (oversight half), `oversight/[aboutOrgId]/actions.ts`, `oversight/[aboutOrgId]/edit-form.tsx`.

**Increment 3b** — `/o/<slug>/admin/reports/page.tsx` **replaces** its `ComingSoon` body with two sections: "Congregation Statistics" (provenance-labeled table, entry form for `presbytery_entered` rows) and "Per-Capita" (rate-setting form, "Generate this year's records" action, a payment-status table). Same flag (`org_portal.reports`). New: `presbytery.ts` (statistics + per-capita halves), `reports/statistics-form.tsx`, `reports/per-capita-panel.tsx`, `reports/actions.ts`.

**Public-site fallback** (folded into this increment's PR — see classification below) — one new branch in the existing `getPublishedSite()`/`(public)/site/[slug]` miss path, one new component `PresbyteryFallback` (org name + sign-in link). No new route.

**Increment 4a** — server half (api-developer): the SQL function pair, `src/lib/presbytery.ts`'s publish/read functions, `statistics.publish` catalog row, `STATISTICS_PUBLISHED` audit key. Client half (ux-developer): new tile in `tiles.ts` (`key: "statistics"`, `orgTypeScope: ["congregation"]`, `domain: "reports"`, `category: "administer"` — mirrors `reports`' own domain/category reasoning, congregation-side compliance filing, not day-to-day ministry), new page `/o/<slug>/admin/statistics/page.tsx` (own route — not folded into `admin/members`, deliberately: it reads a different data family and writes cross-org, the same "distinct enough for its own page" call `credentials` got over folding into `officers`), `publish-form.tsx` (manual entry of the same aggregate fields, attestation checkbox, see Edge Cases), `publication-history.tsx`.

**Increment 4b** — `/o/<slug>/admin/insights/page.tsx` **replaces** its `ComingSoon` body, but ONLY on the `organizationType === "presbytery"` branch — every other org type keeps rendering `ComingSoon` unchanged this increment. New: `insights/dashboard.tsx` (stat cards: congregation count, ending-active total, vacant pulpits, per-capita billed/paid), `insights/statistics-table.tsx` (provenance-labeled rollup), `insights/map.tsx` (gated — see Edge Cases, do not build until the dependency addendum is resolved).

**Files modified across the program:** `src/lib/org-portal/tiles.ts` (new `statistics` tile only — the other three tiles already exist and need no edit beyond what's described above), `scripts/seed.ts` (flip 3 existing flags to seeded-off + add `org_portal.statistical_publication` seeded-off + the 4 new permission-catalog/role-binding rows go in the migration, not here), `docs/product/functionality-map.md`, `docs/TODO.md` (at each ship, per Rule 10/14).

## Implementation Order

1. **Schema (database-admin), one migration:** `src/lib/db/domain/presbytery.ts` (all four tables) → `congregation_oversight` + `congregation_statistics` + `per_capita_rates` + `per_capita_records`, FORCE RLS + standard policy on all four, the partial unique index, `presby_reject_published_statistics_write()` trigger (dormant until 4a — nothing writes `provenance='published_by_congregation'` yet, but shipping it now means 4a needs no schema migration of its own beyond the function), the three permission-catalog rows (`congregation_oversight.manage`, `statistics.manage`, `per_capita.manage`) + `presbytery_stated_clerk` bindings for the latter two, `test-rls.sql` additions against the seeded `northern-reach`/`alder-creek` pair.
2. Flip `org_portal.oversight`/`.reports`/`.insights` to seeded-off in `scripts/seed.ts`; add `org_portal.statistical_publication` seeded-off.
3. Increments 3 + 3b (full-stack-developer), one PR, including the public-site fallback (Polish, folded in — see below).
4. Increment 4a: `statistics.publish` catalog row + the two SQL functions + `test-rls.sql` two-real-orgs assertions (api-developer) → server action + audit → tile + page + form + history UI (ux-developer).
5. Increment 4b (ux-heavy; full-stack or ux-developer + tech-lead check-in on the map gate): rollup dashboard first (no dependency), map slice only after the architect's addendum lands.
6. Audit events, functionality-map/TODO updates, release notes at each increment's own SHIP IT (Rule 10/13/14).

## Edge Cases & Risks

- **Empty states.** "No data on file" (nothing entered, presbytery or congregation) must read differently from "not yet published this year" (a `presbytery_entered` row exists but no `published_by_congregation` row for this year) — the rollup read must surface provenance even when there's exactly one row, not just when reconciling two.
- **Year boundary / missing basis-year data.** `generatePerCapitaRecordsAction` will hit congregations with no statistics on file for `basisYear` (a newly managed congregation, a lapsed unmanaged one). Rule: **skip and name**, never silently bill zero and never fail the whole batch for one missing congregation.
- **Republish-after-billing.** A congregation may republish year N's statistics after the presbytery has already generated `per_capita_records` for a later billing year against the old snapshot. `amount_owed`/`ending_active_basis`/`rate_applied` are frozen at generation time by design (adversarial: a late correction cannot retroactively rewrite an issued bill) — a genuine correction to an already-billed record is a **manual** presbytery action (regenerate that one record), never automatic. Name this in the UI copy near the republish button so it isn't read as a silent bug.
- **Confused-deputy / column allow-list.** Every SASR aggregate is validated for non-negative values and a sane upper bound (integer counts; financial columns bounded generously, e.g. < $100M) inside `presby_publish_sasr_snapshot()` itself — the function is the trust boundary, not the calling action, per F26 discipline (an action-layer-only check would not survive a future second caller).
- **No `sasr_reports` dependency in v1 — named explicitly.** The architect's Ruling 1 describes the calling action extracting fields from "the congregation's approved `sasr_reports` row." **No UI or module reads/writes `sasr_reports` anywhere in this codebase today** (verified: no `src/lib/sasr.ts`, no admin route), and its own financial-line source (the ledger) is unbuilt. Building the full SASR-compilation screen as a prerequisite would balloon this increment far past "statistical publication." Ruling: **the publish form is a direct manual-entry form** for the same aggregate fields `congregation_statistics` carries — it does not read, and is not gated on, `sasr_reports`. This is an honest description of how every real clerk does it today (by hand); a future increment that builds the actual SASR-compilation projection can wire it to prefill this same form without changing the publish mechanism. Tracked in `docs/TODO.md` as a named future reconciliation, not a defect of this design.
- **Attestation, not a native dialog.** "I confirm the session has approved these figures for publication to `<presbytery name>`" is a required checkbox on the publish form (shadcn, not `confirm()`), gating the submit button — the honest shape of the real workflow (D3: session ratifies, clerk submits) without inventing a meetings/minutes dependency this program doesn't need.
- **The viability map — dependency gate, do not implement without it.** A dependency-free rendering was weighed first per Operator Answer 3 and rejected as impractical for an arbitrary multi-congregation pin map: an inline SVG US/region map cannot generalize to arbitrary geography (confirmed), and a static-tile `<img>` approach cannot place more than one marker without either a paid/keyed static-map API (not actually dependency-free — it trades an npm package for an external service contract) or hand-stitching raw XYZ tiles client-side, which is fragile and not a real v1. **Recommendation: `leaflet` (and its React binding if one is used) is the right-sized dependency** — small, self-hosted, no CDN needed, and it is the map slice *only*; the rest of 4b (stat cards, rollup table, vacant pulpits, per-capita) ships independently with zero new dependencies. **Per the dependency rule, this is an architect Phase 2 addendum, and implementation of the map slice must not begin until that addendum is approved.** The addendum should also settle a tile provider — raw OpenStreetMap tiles disallow production use at any real scale per their own usage policy, so a provider (MapTiler/Stadia/similar free tier) needs picking at addendum time, not assumed here. Whichever host is chosen must be added to `next.config.ts`'s `img-src` (currently `'self' data: https://lh3.googleusercontent.com`) — the CSP is Report-Only today so this would not break anything immediately, but it must be added before the header is ever promoted to enforced, named here so that future promotion doesn't quietly break the map.
- **Two-real-orgs e2e/RLS discipline (Increment 4a).** Every assertion proving the publish path is confused-deputy-safe runs against the seeded `northern-reach` (presbytery) / `alder-creek` (congregation, managed) pair, never a single synthetic org — mirrors the discipline `credentials.ts`'s own tests already established for `servingOrgId`. Required tests: publishing from `alder-creek`'s context lands the row under `northern-reach`, never under `alder-creek` itself or any other org; a congregation with `parent_id` pointing at a non-presbytery org type is rejected; a congregation with no `parent_id` at all is rejected; `presby_list_own_congregation_publications()` run from a THIRD seeded congregation never returns `alder-creek`'s rows.
- **The existing-spec blast radius.** Flipping `org_portal.oversight`/`.reports`/`.insights` to seeded-off will change what any existing e2e spec asserts about those three routes rendering `ComingSoon`/`PlaceholderFlagOff` in the default seeded state — grep `*.test.ts` under `admin/oversight`, `admin/reports`, `admin/insights` before flipping and update the seeded-state assumption in the same commit, not as a surprise loop-back (per the retrospective 2026-07-11 finding this exact class of miss).

## Public-Site Fallback (DECISION-121) — classification

**Polish-class**, folded into Increment 3's PR rather than its own work-log: no schema, no new dependency, no new permission, a single new branch in an existing function plus one small presentational component. Spec: on `getPublishedSite()`'s `not_found` branch, call the existing `publicOrgSummary(slug)`; if it resolves AND `organizationType ∈ {presbytery, synod, general_assembly}`, render `PresbyteryFallback` (org name + a sign-in link to `/o/<slug>`); if it resolves and the type is `congregation`, or if it does not resolve at all, fall through to the existing unconditional `notFound()` — congregations' enumeration-safe collapse is untouched. No brand-scope violation (renders no brand tokens).

## Sequencing

1. **database-admin** — `presbytery.ts` schema + migration (all four tables, RLS, trigger, permission catalog rows, `test-rls.sql` additions). Work-log: `2026-08-27-presbytery-oversight-statistics` (covers Increments 3+3b's Phase 4-6, since they share this single schema commit and implementer).
2. **full-stack-developer** — Increments 3 + 3b UI/actions + the public-site fallback, same work-log as above.
3. **api-developer** then **ux-developer** — Increment 4a. Work-log: `2026-08-27-statistical-publication`.
4. **ux-developer** (full-stack acceptable if the map slice is deferred past this increment's own ship) — Increment 4b. Work-log: `2026-08-27-presbytery-dashboard`.

Each per-increment work-log holds that increment's own Phases 4-6, per this program file's metadata note; this file remains the Phase 1-3 record for all of them.

## Implementer

**database-admin** first (schema), then **full-stack-developer** (Increments 3/3b + public-site fallback), then **api-developer → ux-developer** split (Increment 4a — the architect's suggested split, adopted: this is the first cross-org write in the platform and deserves a dedicated server-side half rather than folding into one full-stack pass), then **ux-developer** (Increment 4b, ux-heavy per the architect's own characterization).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named per increment | 2026-08-27 |

**Handoff:** database-admin — build `src/lib/db/domain/presbytery.ts` + its migration (Implementation Order step 1) first; full-stack-developer picks up Increments 3/3b once that schema commit lands. Loop-back note for whoever implements Increment 4b's map slice: **stop at the dependency addendum** — do not add `leaflet` (or any map library) to `package.json` without an architect Phase 2 addendum approving it and naming a tile provider, per the Edge Cases entry above.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
