# Public directory primitives (staff, officers, committees) — Work Log

> **Slug:** `2026-08-28-public-directory-primitives`
> **Surface:** public (`(public)/site/[slug]`) + admin (`/o/<slug>/admin/staff`, `/admin/officers`, `/admin/groups`)
> **Permission(s):** `staff.manage`/`officers.manage` (existing, reused); a new committee-side permission is likely needed — Phase 1 to determine (candidate: reuse `groups.manage`, or a narrower key if the constitutional-duty test argues against reuse)
> **Flag(s):** extends `sites.public_staff_directory` and/or introduces a sibling flag for committees — Phase 1/3 to determine exact shape
> **Estimated complexity:** medium-large — cross-repo (presby + presby-site-kit), schema extension to `groups`/`group_memberships`, and an API/component-surface redesign of an already-shipped feature
> **Pipeline mode:** Full
> **Source — operator, live feedback, 2026-08-28:** "for the staff and officers and committtees i expected that you would build components that i can use on public sites so i can extract headshots and names and groups in a very custom manner. for example, i'd use it on fpcw in the leadership page and the committtee pages." Two follow-up clarifying questions were answered directly by the operator (see below) rather than left to Phase 1 to guess.

**Operator's own scope decisions, already made — Phase 1 works within these, does not re-litigate them:**
1. **API shape:** raw filterable data + small composable building-block components, NOT one fixed all-or-nothing canned render. `getPublicStaffRoster()` should grow filter parameters (kind, department, office/role); `presby-site-kit` should gain a small single-person primitive component (headshot + name + role), not just the existing monolithic `<StaffList>` full-roster grid — so a content author composes custom per-page layouts (e.g. a curated "leadership" page showing a specific hand-picked arrangement, distinct from a generic "everybody" directory).
2. **Committees are in scope for this same pipeline**, full six-phase treatment — not deferred. Committee membership lives in the pre-existing `groups`/`group_memberships` tables (`docs/work-log/2026-08-26-groups-admin.md`, DECISION-110), a completely different table than `staff_positions`/`officer_terms`, untouched by the shipped staff-directory pipeline. Needs the same pattern extended from scratch: an opt-in public-listing bit, a new/extended `SECURITY DEFINER` read function, and `liveSlots`-compatible data exposure.

**What must carry forward unchanged from the shipped feature** (`docs/work-log/2026-08-27-public-staff-directory.md`, SHIP WITH NOTES) — this pipeline reworks the API/component SHAPE, not the safety model, which already works and was independently verified at Phase 5/6:
- Opt-in per-row public listing, never default-visible.
- **No per-person public route, ever** — enumeration safety by construction. This is the single most safety-critical ruling from the shipped feature and must not be weakened by a more "flexible" API — filter parameters narrow a set, they must never become (or be combinable into) a per-person lookup.
- Field-scope enforcement (name/role/title/department/photo only, never contact fields), independently enforced at both the SQL projection and the render-mapping layer.
- `SECURITY DEFINER` anonymous reads, `recordAudit()` on every toggle direction.
- The `liveSlots` generic injection mechanism in `presby-site-kit` v3.5.0 — reused and extended, not replaced.

**Explicitly out of scope for this pipeline** (do not touch): the live, in-flight visual-alignment bug on the fpcw committees page (`prose`-block CSS narrowing/centering committee descriptions) — a `site-recreator` agent is fixing that separately right now, unrelated to this feature's data/API shape. Photo upload for `people.photo_key` remains unwired (tracked in `docs/TODO.md` as a priority follow-up) — this pipeline's components should degrade gracefully with no photo, matching the shipped `StaffList` precedent, unless Phase 1 finds a reason to reconsider.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-28 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Flexible filtering is safe by construction only if the filter parameters never leave the trusted content-authoring path and never become a visitor-queryable runtime input — that's the one ruling this review has to nail down precisely, not hedge; everything else here (committee opt-in granularity, permission reuse, migration shape, extend-vs-replace) is a smaller, cleanly precedented decision once the shipped staff-directory feature's own reasoning is applied consistently.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`staff.manage`) | Toggle "list publicly" on a `staff_positions` row (unchanged from shipped feature) | Occasional |
| Admin (`officers.manage`) | Toggle "list publicly" on an `officer_terms` row (unchanged) | Occasional |
| Admin (`groups.manage`) | Toggle "list publicly" on a `group_memberships` row belonging to a `managed` group only — never a `derived` one | Occasional, clustered around annual committee assignments |
| A fifth actor CLAUDE.md's four-surface taxonomy doesn't name — a person with git commit access to the org's separate, per-tenant site-content repo, ingested via OIDC-authenticated CI, entirely outside presby's own auth/session/permission system | Places a `{"type":"liveSlot", "props":{"slot": "...", "filter": {...}}}` marker into an org's MDX, choosing kind/department/office/group and (if built) an explicit ordering | On demand, low frequency — this is the entire mechanism by which "flexible filtering" becomes real, and it needs to be named explicitly rather than folded into "admin" |
| Anonymous visitor | Browses `/site/<slug>` and sees whatever subset of currently-public rows the content author's marker selects | On demand |

This request, like the shipped feature's, names no surface for the filtering verb — "I'd use it on fpcw" describes an outcome, not who does the filtering or when. Resolving that is the single most load-bearing move in this review: the filtering actor is **not** an authenticated presby user at all. That distinction is what makes Ruling 1 (enumeration safety) answerable rather than merely asserted.

## Flows

**Flow 1 — Admin toggles a staff/officer row's public listing (unchanged from the shipped feature, Flows 1/3 there).** No change to this flow's shape. One open addition (see Ruling 1/2): whether the toggle also captures an optional display-priority value.

**Flow 2 — Admin (`groups.manage`) opts a specific `group_memberships` row into the public committee listing:** entry: `admin/groups/[groupId]` roster row → "List publicly" → `AlertDialog` (never `confirm()`) stating name/role/photo become visible to anyone including search engines, cannot be fully retracted once cached elsewhere (identical copy pattern to the shipped feature) → confirm → server action re-loads the row scoped to `groups.membership_source = 'managed'` — **`invalid_target` if the group is derived, exactly mirroring `endGroupMembership`'s existing discipline** — sets `public_listed`/`public_listed_by`/`public_listed_at` → `recordAudit()` → outcome: "Public" badge.
- Failure: permission denied (control absent + server-side 403, defense in depth, matching precedent). Attempted against a derived group's membership row (typed id, not reachable through UI) → `invalid_target`, same non-distinguishing collapse `groups.ts` already uses for every other mutation against a derived row. DB error → toast, not a stack trace.
- **This is the one guard this pipeline must not skip:** Session/Diaconate members are explicitly covered by the officer-directory pipeline (`officer_terms`), not by committees. A `group_memberships` row for a derived group must never become independently publicly-listable through this new mutation — that would open a second, less-audited publication path for the same person's officer status. `groups.ts`'s existing two-layer discipline (query-layer filter + re-load-scoped-before-mutate, backed by the `groups_reject_derived_edit`/widened-DELETE-branch triggers from DECISION-110) is the right model to extend, not re-derive.

**Flow 3 — A trusted content author places a filtered live-data marker in an org's MDX** (the flow the request actually asked for): entry: the org's separate, CI-ingested content repo → author writes `{"type":"liveSlot","props":{"slot":"<name>","filter":{...}}}` at whatever point on whatever page they choose → CI ingests via the existing OIDC-authenticated `POST /api/sites/ingest` path (unchanged) → on next render, the marker resolves to whatever the filter currently matches.
- Failure: a typo'd department/office string, or a filter matching zero currently-public rows, resolves to **silence** — no error surfaces anywhere in this pipeline, to the content author or anyone else, because there is no admin-facing validation of content-repo MDX at ingest time (true of the mechanism today, not new to this pipeline). Named as a gap below, not solved by this pipeline.

**Flow 4 — Anonymous visitor views a rendered page with one or more filtered directory slots:** entry: `/site/<slug>` nav or direct URL → sees zero, one, or many independently-filtered sections (e.g., a 2-person hand-curated leadership block, a department-filtered pastoral-staff grid, a per-committee roster on the committees page).
- Failure: same shape as the shipped feature's Flow 2 — no per-person miss case exists to distinguish, because there is still no per-person route. The only failure mode is a section rendering empty or the whole page erroring; per-slot fault isolation (each filtered section degrades independently, matching the shipped feature's own resolved bug-fix addendum where the entire function body was wrapped in try/catch) must be the default from the start here, not rediscovered as a Phase 6 bug-fix a second time.

## Permissions & Flags

- **Permission(s):** No new key for staff/officers (unchanged). For committees: **reuse `groups.manage`, no new permission** — see Ruling 4.
- **Default roles:** unchanged for staff/officers. `groups.manage` keeps its existing fixture-only, no-auto-bind posture (DECISION-110 ruling 2).
- **Flag(s):** `sites.public_staff_directory` (existing) continues to gate the staff/officer union. **New `sites.public_committee_directory`** (or equivalent `sites.*`-namespace key), seeded off, gates the committee union independently.
- **The filter mechanism itself needs no flag** — it's an authoring capability gated by content-repo commit access (out of band already), not a platform rollout switch.

## Ruling on the Six Named Questions

**1. Can a `liveSlot` filter resolve to exactly one person deterministically — is that a problem?**

Yes, it can, and **no, it is not a problem — conditional on one redline that must be stated as an explicit invariant, not an implicit assumption.** The shipped feature's enumeration-safety ruling is about what an **anonymous visitor at request time** can probe. A filter baked into a marker by the content author identified in the User Verbs table is resolved server-side, once, at render time, against parameters the author supplied when they authored the page — the visitor never supplies or sees the filter, only the rendered output. That is categorically different from a per-person route: it's the same operation as a content author literally typing that one person's name into the MDX today, just made live instead of a frozen snapshot. **The redline: the filter mechanism must never become a runtime, visitor-facing input** — no `/api/public/staff?department=X`-shaped HTTP endpoint fetchable from a browser, no query-string passthrough, no client-side filter control. `getPublicStaffRoster`-shaped functions stay server-only, called with author-baked parameters resolved inside the RSC render. If Phase 3/4 ever add a visitor-facing "search this directory" control that passes a typed value to a live server function, that recreates the per-person-route problem and needs its own trip back through this pipeline — forbidden for v1, not merely undiscussed.

Secondary finding: `PublicStaffRosterEntry`/`presby_public_staff_roster()` **doesn't currently expose an `id` field at all** (confirmed by reading `src/lib/sites.ts:1299-1315`) — so an explicit "pin these specific rows, in this order" filter mechanism can't be built against the current projection without deliberately widening the `SECURITY DEFINER` function's column list, which the shipped feature's own Phase 2 explicitly flagged as requiring its own pass through this pipeline. This pipeline **is** that pass, if id-based pinning is wanted — see Ruling 2 for an alternative that avoids needing it at all.

**2. What does the presby-site-kit primitive actually look like, and does `liveSlots` need per-marker filter parameters?**

Two things, not one:

- **A new small `PersonCard` component** (single person: headshot/name/role), genuinely separate from `StaffList`. Live callers feeding `PersonCard` from `getPublicStaffRoster`/the committees equivalent must carry forward the exact same field-scope enforcement `PublicStaffDirectory` already does at the mapping layer (phone/email never set) — `StaffPerson`'s existing interface **does** carry optional `phone`/`email` for the hand-authored `staffList` block type's different trust tier, so a shared primitive needs its live-bound callers to be independently disciplined about which fields they pass.
- **A genuine mechanism gap in the current `liveSlots: Record<string, ReactElement>` contract (v3.5.0):** it supports exactly one pre-rendered element per fixed slot NAME per page, built once in `page.tsx` before `renderSiteBundle()` runs. The operator's own example — a leadership page AND separate committee pages, each wanting a *different* filtered subset — requires a way for the SAME slot type to render differently per marker instance, driven by that marker's own `props`. Recommend Phase 2 design this as: `page.tsx` (or a new helper) walks the ingested bundle's AST *before* constructing the `liveSlots` map, discovers every `liveSlot` marker's `(slot, filter)` pair on that page, and resolves each into its own already-rendered element keyed by whatever string the author chose for `slot`. This needs `presby-site-kit` to export a small bundle-introspection helper (e.g. `extractLiveSlotRequests(bundle): Array<{slot: string; props: Record<string, unknown>}>`) — a modest, additive, minor version bump, not a redesign of the existing contract.
- **Recommend an alternative to author-embedded ordering that avoids the id-exposure problem entirely:** add an optional numeric `publicDisplayOrder`/priority field alongside `public_listed` on `staff_positions`/`officer_terms`/`group_memberships`, set by the same admin who already consents to the listing, rather than an id list embedded in the less-trusted, less-audited content repo. A "leadership" marker then reads `{"filter": {"kind": "staff", "hasPriority": true}, "sort": "priority"}` — achieving hand-picked, ordered curation entirely through the admin surface this pipeline already audits, never putting a personId into MDX at all. Strong recommendation, not a mandate — Phase 2/3's call.

**3. Committees — per-group or per-membership opt-in?**

**Per-membership (`group_memberships.public_listed`), matching the staff/officer precedent's own reasoning exactly, and rejecting a `groups.public_listed` bit.** A `groups.public_listed` bit would reproduce the identical shape the staff/officer feature explicitly rejected one level up: flip it once, and every current AND future committee member is implicitly public with no individual act of consent — default-visible dressed as opt-in. `group_memberships` already carries the time-bounded span (`starts_on`/`ends_on`) the shipped feature's schema-placement reasoning wanted the bit piggybacked on. **No separate group-level bit is needed even for "does this committee's section render at all"** — a committee section renders only if it has ≥1 currently-public-listed member; committees with zero simply don't produce a section. A richer future case — describing a committee's existence/purpose publicly *without* naming any member — is a real, different feature and is **explicitly out of scope for v1**.

Confirmed by direct read of `src/lib/db/domain/groups.ts` and `src/lib/groups.ts`: derived groups are already excluded from every `groups.ts` export via `membership_source = 'managed'` query-layer filtering, and this pipeline's committee mutation must extend that exact discipline (Flow 2's guard), not build a parallel check.

**4. Permission for the committee-side toggle — new key or reuse `groups.manage`?**

**Reuse `groups.manage`. No new permission key.** Publicly listing a committee member is a further decision about a `group_memberships` row `groups.manage` *already fully governs* — not a new category of authority, the same reasoning DECISION-078's constitutional-duty framing supports. What **does** carry forward from the shipped feature's Phase 2 ruling is the audit requirement: this mutation is a *disclosure* fact, not an *access* fact, so DECISION-129's access-change test doesn't cover it — but Rule 7's spirit does, for the identical blast-radius reason named for staff/officers. New `AUDIT_ACTIONS` pair required: `GROUP_MEMBERSHIP_LISTED_PUBLICLY`/`GROUP_MEMBERSHIP_UNLISTED_PUBLICLY`.

**5. Migration path for the shipped fpcw committees page content.**

**Explicitly out of scope for this pipeline.** This pipeline ships the primitives that make a live-bound committees page *possible*. It does **not** touch `site-fpcw`'s existing hand-authored committee content, and does not migrate that specific page to use the new marker. That is a `site-recreator`-owned content-authoring task, to be done later.

**6. `getPublicStaffRoster()` — replace or extend?**

**Extend, with an optional second parameter — not a breaking replacement.** The current zero-arg call shape is the correct, complete answer for a genuine "everyone currently on staff" full-roster page, and remains valid. Recommend: `getPublicStaffRoster(slug: string, filter?: PublicStaffRosterFilter): Promise<PublicStaffRosterEntry[]>`, existing zero-arg call sites unchanged. The `SECURITY DEFINER` SQL function should follow the identical discipline: new optional, defaulted parameters on `presby_public_staff_roster()` (or a sibling function for committees), not a second function duplicating the union query. Cannot verify from inside this repo whether any org's separate, per-tenant content repo already contains a dormant `staffDirectory` marker — flagged as an unverifiable assumption for Phase 3/4, not something closeable by direct read.

## Gaps the Request Didn't Address

- **The content-author trust tier is unnamed in CLAUDE.md's own actor taxonomy** (anonymous / no-role / member / admin) — Ruling 1's entire enumeration-safety argument rests on this actor being out-of-band and pre-authorized via git+CI, not a presby session. Recommend Phase 2 document this explicitly as a fifth, distinct trust boundary.
- **Free-text filter matching.** `staff_positions.department` and `.position` are free text (confirmed: no enum, `position` is lower-cased/trimmed at write time but `department` isn't shown doing the same). A content author's filter value must match whatever an admin actually typed — recommend the same trim/lowercase normalization already used for `position` be applied consistently on both the write side and the filter-match side.
- **Silent filter-typo failure** (Flow 3) — a content author who mistypes a department/office string gets an empty section with zero error surfaced anywhere, indefinitely. Not this pipeline's job to build content-repo validation, but worth naming.
- **Mobile for `PersonCard`.** Net-new component, needs its own 360px pass.
- **2FA gate:** unchanged — admin controls remain inside the already-2FA-enforced `(org)` tree; public reads remain intentionally unauthenticated.
- **Empty state for a specific filtered slot that legitimately has zero current matches** (e.g., a vacant office, a newly-formed committee with no public members yet) is a genuinely different UX question from the shipped feature's whole-page empty state. Flagged, not resolved — Phase 3's call.

## Out of Scope (confirm with user)

- Migrating `site-fpcw`'s existing committees-page content to the new mechanism (Ruling 5).
- A group-level ("is this committee's existence/description public regardless of members") visibility axis (Ruling 3).
- Any visitor-facing search/filter control on the public site — the filter mechanism stays author-baked, server-resolved only (Ruling 1's redline).
- Explicit id-list pinning, if Phase 2/3 adopts the admin-set-ordering-field alternative instead (Ruling 2) — deferred, not ruled out permanently.

## Open Questions

1. Does the operator want the admin-set ordering field (Ruling 2's recommendation) or an explicit id-list-in-the-marker mechanism for hand-picked arrangements like the leadership page? This materially changes whether the `SECURITY DEFINER` function's column list needs widening with an `id`.
2. Is a `sites.public_committee_directory` flag (separate from `sites.public_staff_directory`) the right composition, or does the operator want committees folded under the existing flag?
3. Should the bundle-introspection mechanism (Ruling 2) be built now, or does Phase 2 prefer a narrower v1 (one filter parameter set per fixed slot name, deferring true per-marker-instance variability) given the added `presby-site-kit` surface area?

**Handoff:** architect (Phase 2). Carry forward, unresolved and load-bearing: the no-runtime-queryable-filter redline (Ruling 1) as a hard architectural constraint, not a suggestion; the `liveSlots` multi-instance-per-page mechanism gap (Ruling 2) as a real design problem needing its own named solution; the per-membership (not per-group) opt-in ruling (Ruling 3) and the derived-group guard it depends on; the `groups.manage` reuse + new audit-key pair (Ruling 4); the fpcw-content-migration exclusion (Ruling 5); and the extend-not-replace ruling on `getPublicStaffRoster()`/`presby_public_staff_roster()` (Ruling 6). **Single riskiest open question for Phase 2/3:** the `liveSlots` multi-instance-per-page mechanism (Ruling 2) — if underspecified the way the original staff-directory request underspecified live-data injection entirely, Phase 3/4 will discover it mid-implementation instead of at design time.

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

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
