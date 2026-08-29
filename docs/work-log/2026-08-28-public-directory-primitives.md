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
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-28 |
| 3 — Technical design | tech-lead | Complete | design complete | 2026-08-28 |
| 4 — Implementation | database-admin (step 1) / api-developer (steps 2–4) / ux-developer (steps 5–6) | Complete — all 6 steps done (schema; admin mutations; public read; presby-site-kit v4.0.0; render components + liveSlots wiring; admin UI) | — | 2026-08-28 |
| 5 — Verification | qa | Complete | PASS | 2026-08-28 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-28 |

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

**Approved with suggestions.** The feature shape holds. The one structural change to Phase 1's own recommendation is on the `liveSlots` mechanism — Phase 1 flagged it as the single riskiest open question and asked for a real evaluation rather than a rubber stamp; the architect ruled for the alternative Phase 1 itself named, not Phase 1's own recommendation.

## Ruling on the `liveSlots` mechanism (the consequential one)

**Reject the bundle-introspection pre-walk (`extractLiveSlotRequests`). Adopt: `liveSlots` values become resolver functions, `(filter: Record<string, unknown>) => ReactElement | null`, resolved lazily by `renderLiveSlotBlock` at the point each marker is encountered — not pre-walked and pre-rendered by `page.tsx`.**

Confirmed by reading `presby-site-kit@v3.6.0`'s actual code:

- `mdxAst` is already normalized to a flat `{ blocks: ContentBlock[] }` array before any renderer sees it — there is no tree to walk; a bundle-introspection pass would just be a second pass over the same flat array `renderSiteBundle()` already iterates.
- Under the pre-walk design, the map is still keyed by a single string per Phase 1's own contract (`Record<string, ReactElement>`). Two markers with the same `slot` name and different `filter` values can't both live at that one key — Phase 1's own writeup never actually names the key scheme that makes two same-named markers distinguishable at lookup time. Either a filter-derived key (which the marker itself would then have to independently reproduce — an awkward two-place computation that must never drift) or an occurrence-index key (which requires the pre-walk's traversal order and `renderSiteBundle`'s own render-time traversal order to match exactly, forever, across two different call sites) — both are exactly the kind of implicit cross-pass coupling that produces a future F-numbered finding.
- The resolver-function design has none of this. Every other block renderer in `blocks.tsx` already receives `(props, ctx)` and renders directly from that block's own `props` — `liveSlot` was the one outlier that used `props` only to do a name lookup instead of feeding `props` into the render call. Making the map's value a function brings `liveSlot` in line with every sibling renderer's own pattern: `ctx.liveSlots[props.slot](props.filter)` is resolved exactly where the marker is, using exactly that marker's own props, with zero pre-pass, zero key-collision problem, and zero ordering coupling.
- Verifiably RSC-safe, not merely "probably fine": `renderSiteBundle()` runs synchronously inside `page.tsx`'s own server-component render (no client boundary between them), so passing and invoking a plain closure through `ctx.liveSlots` never crosses a Server→Client serialization boundary. It would only be illegal if a function were passed as a prop into a Client Component (e.g. `Nav`) — `liveSlot` markers render into the page body, not into `Nav`.
- Net effect on `presby-site-kit`'s public surface: `RenderSiteBundleInput.liveSlots?: Record<string, ReactElement>` → `Record<string, (filter: Record<string, unknown>) => ReactElement | null>`, and `renderLiveSlotBlock` calls the function instead of dereferencing the map directly. This is a **smaller** diff than the pre-walk (no new exported helper, no `page.tsx` pre-pass, no second traversal), and a strict superset of the current single-instance behavior — a slot with no `filter` in its props just calls the resolver with `{}`.
- **Honest cost: this is a breaking change** to the `liveSlots` field's type (element → function), unlike the additive `v3.4.0 → v3.5.0` bump. Exactly one production consumer (`presby`'s own `page.tsx`), owned by this same pipeline, so the blast radius is fully contained — but version and changelog it as breaking (recommend `v3.6.0 → v4.0.0`), and name the tag-cut as its own sequenced Implementation Order step, exactly as the shipped feature named `v3.5.0`'s cut.

**Dependency question: no new npm dependency, either mechanism.** `ContentBlock[]` is already a flat, typed array — neither the rejected pre-walk nor the adopted resolver-function design needs an MDX/AST library.

## Ruling on Ruling 1's redline (enforceability)

Confirmed enforceable, and cleaner under the resolver-function design than the pre-walk would have been: a resolver closure built in `page.tsx` (e.g. `staffDirectory: (filter) => <PublicStaffDirectory slug={slug} filter={filter} />`) can only close over values `page.tsx` itself has in scope — `slug` and other route-static values. It is structurally incapable of closing over `request`/`searchParams`/cookies unless someone deliberately threads one in.

**How Phase 4 verifies it — two concrete, checkable things:**
1. **No new public route.** Phase 3's design must not introduce any route handler or a public page's own `searchParams` read that forwards a department/office/kind/group value from the request into `getPublicStaffRoster`/the committee equivalent. Review checklist: grep the diff for `searchParams` anywhere between `(public)/site/[slug]` and the public-read call sites — any hit is a redline violation.
2. **Closure provenance.** Every resolver function assembled for `liveSlots` in `page.tsx` may only close over `slug` (and other URL-path-derived values) — never `request`, `headers()`, or `cookies()`. A one-line code-review check on `page.tsx`'s own `liveSlots` object literal, not a runtime assertion.

## Ruling on Open Question 1 (`publicDisplayOrder` vs id-list)

**Ruled: `publicDisplayOrder`/priority column, admin-set. No id-list-in-marker, ever, for v1** — not merely deferred, ruled out: widening the anonymous `SECURITY DEFINER` function's projection to include a raw `id` is the one column addition that changes what that function *is* — from "a set of currently-public rows" to "a set of currently-public rows, addressable." Every other field on that projection (name, role, department, photo) is inert; `id` is the one column that turns a UNION into a lookup table, and it would sit in a git-committed, lower-trust content repo forever once used once. An integer priority column has none of that shape.

Concretely: `public_display_order integer` (nullable), alongside `public_listed`/`public_listed_by`/`public_listed_at`, on `staff_positions`, `officer_terms`, **and** `group_memberships` (extends to committees too, per the per-membership ruling). The `SECURITY DEFINER` function(s) project it and order by `coalesce(public_display_order, 2147483647), display_name` — an org that never sets it gets exactly today's alphabetical behavior for free; one that does gets hand-curated ordering entirely through the already-audited admin surface. A marker's `filter` can then say `{"hasPriority": true}, "sort": "priority"` without ever carrying a personId.

## Ruling on Open Question 2 (`sites.public_committee_directory` flag)

**Ruled: new, separate flag — not folded into `sites.public_staff_directory`.** The shipped feature deliberately unified staff+officers under one flag because they render as one union ("who serves here"). Committees are a structurally different read (per-committee rosters off `group_memberships`, with their own new `SECURITY DEFINER` surface) and a different rollout concern — an org may reasonably want the staff/officer roster live before or independent of committee rosters going public. Seeded off, `sites.*` namespace, checked bare — not an auth path, fail-closed-to-empty during a DB blip is correct.

## Confirming Phase 1's remaining rulings

- **Per-membership opt-in on `group_memberships`, not per-group** — confirmed by direct read of `src/lib/db/domain/groups.ts` and `src/lib/groups.ts`. The `membership_source = 'managed'` query-layer filter plus the re-load-scoped-before-mutate pattern (`endGroupMembership`) is real, already shipped, and is exactly the model the new `setGroupMembershipPublicListed()` must extend.
- **Reuse `groups.manage`, no new permission** — confirmed. New `AUDIT_ACTIONS` pair (`GROUP_MEMBERSHIP_LISTED_PUBLICLY`/`GROUP_MEMBERSHIP_UNLISTED_PUBLICLY`) required.
- **Extend, don't replace, `getPublicStaffRoster()`** — confirmed. `getPublicStaffRoster(slug, filter?)`, zero-arg call sites unchanged; the committee read is a **sibling** function (`getPublicCommitteeRoster` or similar), not a widening of the staff/officer union — committees are a different table shape and deserve their own `SECURITY DEFINER` function.
- **fpcw content migration out of scope** — confirmed, `site-recreator`'s job, later.

## Placement

- **Schema**: `src/lib/db/domain/groups.ts` gains `publicListed`/`publicListedBy`/`publicListedAt`/`publicDisplayOrder` on `groupMemberships`; `src/lib/db/domain/staff.ts`/`officers.ts` each gain `publicDisplayOrder` alongside the three columns they already shipped in `0041`. New migration (next number after `0041`), hand-written per convention.
- **Admin mutation**: new `setGroupMembershipPublicListed()` in `src/lib/groups.ts`, same pattern as its `endGroupMembership` neighbor.
- **Public read**: `src/lib/sites.ts` stays the one file that owns the anonymous/`SECURITY DEFINER`/collapse-every-miss-identically discipline. `getPublicStaffRoster()` grows an optional filter parameter; a new `getPublicCommitteeRoster(slug, filter?)` is added alongside it — not a new file.
- **`presby-site-kit`**: `RenderSiteBundleInput.liveSlots` value type changes from `ReactElement` to a resolver function (breaking, versioned accordingly); a new small `PersonCard` component and export, co-located with `StaffList`.
- **Server vs Client split**: no `'use client'` anywhere in this feature's own new code — `PersonCard`, the committee render component, and the resolver closures are all server-only.
- **Dependencies**: none, either repo.

## Invariants Touched

- **Isolation Is a Database Property / `SECURITY DEFINER` (F26)**: the committee read is a new anonymous, FORCE-RLS-bypassing function in the same shape as `presby_public_staff_roster()` — narrow projection, own grant, no widening of an existing function to cover a second table.
- **Composite Tenant Keys (F2)**: respected — `group_memberships` already carries composite FKs; no new cross-table reference introduced.
- **Permissions vs Flags (DECISION-003)**: correctly split — `groups.manage` is who may flip the bit, `sites.public_committee_directory` is whether the surface exists at all.
- **No Real Data**: migration/fixtures synthetic only — Phase 4 concern.
- **Brand scope (DECISION-047)**: no violation — renders inside `(public)/site/<slug>`, already brandable.
- **Enumeration safety**: not weakened. The redline above is the concrete mechanism that keeps it that way; Phase 3 must not treat "flexible filtering" as license to add a query-string-driven read path.

## Notes

1. Version the `presby-site-kit` tag as breaking (recommend `v4.0.0`) and name the tag-cut as its own sequenced Implementation Order step — nothing in the render-component step can be written against the real type until the tag exists.
2. `publicDisplayOrder` needs its own index consideration alongside the existing `public_listed`-scoped partial indexes on all three tables now carrying it.
3. The committee `SECURITY DEFINER` function needs the same `organizations.status = 'active' and organization_sites.status = 'live'` defense-in-depth duplication `presby_public_staff_roster()` uses — it runs anonymously too.
4. `PersonCard`'s field-scope discipline (name/role/photo only, never phone/email) must be independently enforced at the mapping layer wherever a live-bound caller feeds it — don't let a shared primitive's optional fields become a footgun for a live caller.
5. Silent filter-typo failure and per-slot fault isolation (Phase 1 Flow 3/4) are real gaps Phase 3 should design for from the start — the shipped feature had to close per-slot fault isolation as a same-day Phase 6 bug-fix; don't repeat that miss here now that it's precedented.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

This pipeline turns the shipped, flat, opt-in "who serves here" staff/officer
directory into a genuinely filterable, composable set of public-directory
primitives, and adds a parallel, from-scratch committee-directory surface off
`groups`/`group_memberships`. Concretely: `getPublicStaffRoster(slug, filter?)`
grows a real filter (kind/hasPriority in SQL, department/office in TS, for
reasons argued below); a new sibling `getPublicCommitteeRoster(slug, filter?)`
unions currently-public `group_memberships` rows, grouped by the group's own
`name` (never its `id`); a new admin-set `publicDisplayOrder` column lands on
all three "publicly listable" tables (`staff_positions`, `officer_terms`,
`group_memberships`) so a content author can request a hand-curated, ordered
subset (`{"hasPriority": true}`) without ever putting a personId in the
lower-trust content repo; and `presby-site-kit`'s `liveSlots` mechanism
becomes resolver functions (`(filter) => ReactElement | null`, DECISION-132),
a breaking `v4.0.0` cut, so the SAME slot name can render a different
filtered subset per marker instance. A new `PersonCard` primitive ships
alongside `StaffList` in site-kit — not a StaffList-of-one, a genuinely
separate component with no contact-field props at all, purpose-built for the
one job `StaffList`'s flat markup structurally cannot do: rendering a grouped,
per-committee section. Everything from the shipped feature that Phase 1/2
carried forward unchanged stays unchanged: opt-in only, no per-person route
ever, field-scope enforced at two layers, `SECURITY DEFINER` anonymous reads,
`recordAudit()` on every listing-visibility toggle.

## Permissions & Flags

- **Permission key(s):** none new. `staff.manage` and `officers.manage`
  continue to gate their own tables' toggles (unchanged signatures — see API
  Contract). **`groups.manage`** (existing, DECISION-110) gates the new
  `setGroupMembershipPublicListed()`/`setGroupMembershipPublicDisplayOrder()`
  — Phase 1/2's ruling confirmed: publicly listing a committee member is a
  further decision about a `group_memberships` row `groups.manage` already
  fully governs, not a new category of authority.
- **Default role bindings:** unchanged. Whoever already holds
  `staff.manage`/`officers.manage`/`groups.manage` today keeps exactly that;
  this pipeline adds no new capability to any role, only new fields those
  existing capabilities can write.
- **Feature flag(s):**
  - `sites.public_staff_directory` (existing, unchanged key) continues to
    gate `getPublicStaffRoster()` — the filter widening does not touch this
    flag's meaning or its checked-bare, fail-closed-to-empty posture.
  - **New `sites.public_committee_directory`**, seeded **off**, `sites.*`
    namespace, checked bare in `getPublicCommitteeRoster()` (no DECISION-026
    wrapper — not an auth path). Deliberately **separate** from
    `sites.public_staff_directory`, per Phase 2's ruling: committees are a
    structurally different read (a new `SECURITY DEFINER` function over a
    different table) and a different rollout concern — an org may want the
    staff/officer roster live before or independent of committee rosters.
  - Composition unchanged from the shipped precedent (DECISION-003): the
    flag(s) gate whether the public read/render exists **at all**; the
    permissions gate **who inside an org** may flip an individual row's bit.
    Neither substitutes for the other.
  - The filter mechanism itself needs **no flag** — per Phase 1 Ruling 1,
    it's an authoring capability gated by content-repo commit access
    (out-of-band already), not a platform rollout switch.

## Design Decisions Made Concrete

### 1. The filter shape, and where each field is matched (SQL vs. TypeScript)

Two sibling filter types, both plain, JSON-shaped objects — this is
deliberate: they are what a `liveSlot` marker's `props.filter` looks like on
the wire, in a lower-trust, hand-authored content repo, so every field is
optional and defensively narrowed, never assumed present or well-typed.

```ts
// src/lib/sites.ts
export interface PublicStaffRosterFilter {
  /** Restrict to just `staff_positions` rows ("staff") or just
   * `officer_terms` rows ("officer"). Omit for the full flat union — today's
   * default, unchanged behavior. */
  kind?: "staff" | "officer";
  /** `staff_positions.department`, case-insensitive/trim matched. A row
   * with no department (or an officer row, which has none) never matches a
   * non-empty value. */
  department?: string;
  /** `officer_terms.office`'s raw enum value OR its `OFFICE_LABELS` display
   * string, case-insensitive/trim matched against EITHER — see the TS-layer
   * reasoning below for why this can't be a SQL parameter. A staff row
   * never matches. */
  office?: string;
  /** Only rows an admin has given an explicit `publicDisplayOrder` — the
   * "hand-picked leadership" case. No separate `sort` key exists (see
   * below) — ordering is always `coalesce(publicDisplayOrder, MAX),
   * displayName`, so this filter alone yields a curated, ordered subset. */
  hasPriority?: boolean;
}

// src/lib/sites.ts
export interface PublicCommitteeRosterFilter {
  /** `groups.name`, case-insensitive/trim matched. Omit to get every
   * currently-public committee in one flat list, each row tagged with its
   * own `groupName` — see Design Decision 2 for why this is the same
   * mechanism that serves both "one committee's page" and "all committees
   * on one page." */
  committee?: string;
  hasPriority?: boolean;
}
```

**No `sort` field, deliberately — a simplification of Phase 1's own
speculative `{"sort": "priority"}` shape.** Both `SECURITY DEFINER`
functions' `ORDER BY` is unconditionally `coalesce(public_display_order,
2147483647), display_name` (DECISION-132's own phrasing) — an org that never
sets priority gets alphabetical for free, and `hasPriority: true` alone
already narrows to *and* orders the curated subset, since the same clause is
priority-first when priority is set. A separate `sort` key would let a
marker request `sort: "priority"` with `hasPriority` unset, which has no
coherent meaning (priority-order a set where most rows have no priority
value) — removing the key removes the invalid state instead of validating
against it.

**Where matching happens, and why it's split, not uniform — a real design
call, not an oversight:**

- **`kind` and `hasPriority` are SQL parameters** on the widened
  `presby_public_staff_roster()` (see Data Model) — both are exact
  predicates against real, indexed-adjacent columns (`kind` is synthesized
  by the UNION itself; `public_display_order is not null` is cheap), and
  `hasPriority` must interact with the SQL `ORDER BY` to be useful at all
  (a curated leadership marker with 40 people to sift through in JS after
  the fact would defeat the point of doing it in the database).
- **`department` and `office` are matched in TypeScript**, inside
  `getPublicStaffRoster()`, on the rows the SQL layer already returned —
  **not** a stylistic split, forced by DECISION-131's own ruling: office
  *labels* live in exactly one place, `OFFICE_LABELS` (TypeScript), and the
  SQL function deliberately does not duplicate that map as a `CASE`. An
  `office` filter needs to match an author-typed string against *either* the
  raw enum (`clerk_of_session`) or the display label (`Clerk of Session`) —
  doing that match in SQL would require either teaching the function the
  label map (reopening DECISION-131) or restricting authors to the raw enum
  spelling (a worse authoring experience with no compensating benefit). Once
  `office` has to live in TS, `department` moves there too for symmetry
  rather than splitting free-text matching across two layers by field —
  one normalization function (`normalizeFilterText`, trim + lowercase, per
  Phase 1's own Gap recommendation), one call site, applied identically to
  both. Filtering after ordering does not disturb the order — filtering
  removes rows, it doesn't reorder the survivors.
- A staff row is automatically excluded by a non-empty `office` filter (its
  `department` is compared against `office`'s needle and never matches,
  since the two fields are never the same string) and an officer row is
  automatically excluded by a non-empty `department` filter (officer rows
  always have `department: null`) — no explicit `kind`-narrowing logic is
  needed for either case; it falls out of the field values themselves.

### 2. The committee `SECURITY DEFINER` function's projection and grouping

**One function, `presby_public_committee_roster(slug, committee?,
hasPriority?)`, returning a flat, `group_name`-tagged list — not a
per-group-only read, and never `group_id`.** This is the concrete answer to
"per-committee page or all-committees page": both are the *same* call
shape, and the choice is made entirely by whether the marker's `filter`
narrows to one `committee` name or omits it:

- **A per-committee page** (Phase 1's own driving example — "i'd use it ...
  on the committtee pages"): the marker's `filter` is `{"committee":
  "Missions Committee"}`. `presby_public_committee_roster()` returns only
  that committee's currently-public members, already ordered; the render
  component (`PublicCommitteeDirectory`, see Component Plan) renders one
  section with no heading needed (the page itself is already "the Missions
  Committee page").
- **An all-committees page**: the marker's `filter` is `{}`. The function
  returns every currently-public committee's rows in one flat array, each
  row carrying its own `groupName`. `PublicCommitteeDirectory` groups
  sequentially by `groupName` (a single pass — the SQL's own `ORDER BY
  group_name, ...` already clusters same-name rows contiguously, so no
  re-sort is needed) and renders one `<section>` with an `<h2>{groupName}
  </h2>` heading per group, each containing that committee's `PersonCard`s.

**`group_name` (text), never `group_id`, per the explicit constraint that no
id is ever exposed in the anonymous projection** — this is not merely "the
same rule as staff/officer" ported over unexamined; `groups.name` has no
`unique` constraint at the org level (only an `index`, not a uniqueness
guard — confirmed by direct read of `src/lib/db/domain/groups.ts`), so two
managed committees could in principle share a name. Accepted as a named edge
case (see Edge Cases), not fixed here: a name collision is an admin
data-quality question, not a security or enumeration one — no more
revealing than two staff rows sharing an identical `department` string,
which the shipped feature already accepts without incident.

**Function body** (new migration — see Data Model for the full DDL):

```sql
create or replace function presby_public_committee_roster(
  p_slug text,
  p_committee text default null,
  p_has_priority boolean default null
)
returns table (
  group_name   text,
  group_role   text,   -- 'chair' | 'leader' | 'member' — GROUP_ROLES verbatim
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.ends_on is null
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;
```

`g.membership_source = 'managed'` is defense-in-depth, not redundant belt:
even though `setGroupMembershipPublicListed()` (below) refuses to touch a
derived group's row, this clause means a derived Session/Diaconate roster
row could *never* surface here even under a future application-layer bug —
the same two-layer discipline `groups.ts`'s own header already documents for
every other derived-group guard in this codebase. `committee`/`hasPriority`
matched exactly like staff/officer's `department`/`hasPriority` — but here
**both stay in SQL**, unlike `office`: `group_role`'s three values
(`chair`/`leader`/`member`) are a fixed, closed enum with no separate
label-mapping table anywhere (`GROUP_ROLES` in `src/lib/groups.ts` is
already the raw wire value), so there is no DECISION-131-shaped reason to
push `committee`-name matching into TypeScript.

`group_role` is exposed in the projection (the analogous field to
staff/officer's "role/title") — within the existing field-scope ruling
(name/role/title/department/photo only, never contact fields).

### 3. `PersonCard` — a genuinely separate component, not `StaffList` of one

**Separate, for a structural reason, not a stylistic one.** `StaffList`
renders `<section data-block="staff-list"><ul>{people.map(...=><li>)}</ul>
</section>` — every person is a `<li>`, which is only valid HTML inside a
`<ul>`. `PublicCommitteeDirectory` needs to render **multiple grouped
sections**, each with its own heading, and `StaffList` has no mechanism to
subdivide its one flat `<ul>` into headed groups — extracting `StaffList`'s
`<li>` markup out from under its `<ul>` wrapper to use standalone would
produce invalid HTML at every call site. `PersonCard` is the atomic unit
`PublicCommitteeDirectory` composes per group; it is not a workaround for a
`StaffList` limitation Phase 4 should instead fix, because `StaffList`'s
single-flat-list shape is *correct* for its own callers (the full staff
union, the hand-authored `staffList` block) — grouping was never its job.

```tsx
// presby-site-kit/src/components/PersonCard.tsx — co-located with
// StaffList.tsx, exported from index.tsx alongside it.
export interface PersonCardProps {
  name: string;
  title?: string;
  photoUrl?: string;
  headingClassName?: string;
  className?: string;
}

export function PersonCard({
  name,
  title,
  photoUrl,
  headingClassName,
  className,
}: PersonCardProps): ReactElement {
  return (
    <div data-block="person-card" className={className}>
      {photoUrl ? <img src={photoUrl} alt={name} /> : null}
      <h3 className={headingClassName}>{name}</h3>
      {title ? <p data-slot="title">{title}</p> : null}
    </div>
  );
}
```

**Deliberately no `phone`/`email` props at all — a structural fix, not a
documented caveat.** Phase 2 Note 4 flagged that `StaffPerson`'s optional
`phone`/`email` fields (needed for the hand-authored `staffList` block's own
different trust tier) are a footgun a shared primitive's live callers must
independently avoid setting. `PersonCard` is a **new** component with no
hand-authored-block use in this pass — there is no reason to carry
`StaffPerson`'s contact fields onto it at all, so the field-scope discipline
is enforced by the type itself: a live caller has no `phone`/`email` prop to
accidentally populate, full stop, not "and please remember not to."

**No shared internal fragment with `StaffList`, and that's the right call,
not an oversight.** The overlap between the two components' actual markup —
a conditional `<img>`, an `<h3>{name}</h3>`, an optional `<p data-slot=
"title">` — is roughly six lines. Extracting a third internal helper to
de-duplicate it would need to handle two different container contracts
(`<li>` inside `StaffList`'s `<ul>` vs. a standalone `<div>` for `PersonCard`)
and two different prop shapes (`StaffPerson`'s `phone`/`email` vs.
`PersonCard`'s deliberate absence of them) — the abstraction would carry
more branching than the six lines it saves, and would recouple two
components whose future evolution paths are meant to stay independent (one
serves hand-authored content at a looser trust tier, one serves exclusively
live, filtered, admin-consented data). Accepted duplication, named
explicitly rather than left for a future reader to "fix."

`PersonCard` is exported as a **plain component only** — no new
`personCard` block type is added to `BLOCK_REGISTRY` in this pass (that
would be a hand-authored-content use case Phase 1/2 never scoped; naming it
here as an explicit non-addition, not a silent gap).

### 4. Migration numbering

`ls drizzle/*.sql` (immediately before writing this section) shows
`0041_presby_public_staff_directory.sql` as the highest file on disk;
`drizzle/meta/_journal.json`'s last entry is `idx: 41`. `docs/TODO.md`'s In
Flight section names no concurrent pipeline claiming `0042`. This pipeline
claims **`drizzle/0042_presby_public_directory_primitives.sql`** —
database-admin must re-run this same check immediately before applying,
per the 0039/0040 near-collision precedent already logged in
`docs/TODO.md`.

## API Contract

**Admin mutations — staff/officer (existing functions, widened; no new
exports for the toggle itself):**

`setStaffPositionPublicListed()`/`setOfficerTermPublicListed()`'s own
signatures are **unchanged** (Phase 1/2 named no reason to touch them — the
new `publicDisplayOrder` column is set by its own single-purpose sibling
mutation, not folded into the toggle's input, for the reason given next).

```ts
// src/lib/staff.ts — NEW export, sibling to setStaffPositionPublicListed
export async function setStaffPositionPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { positionId: string; publicDisplayOrder: number | null },
): Promise<StaffResult<{ positionId: string; publicDisplayOrder: number | null }>>
```

```ts
// src/lib/officers.ts — NEW export, sibling to setOfficerTermPublicListed
export async function setOfficerTermPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { termId: string; publicDisplayOrder: number | null },
): Promise<OfficersResult<{ termId: string; publicDisplayOrder: number | null }>>
```

**Why a separate mutation, not an optional field folded into
`setXPublicListed()`'s existing `input`:** every `set*`/`start*`/`end*`
function in this codebase already does exactly one thing (`endStaffPosition`
is not `startStaffPosition` with an optional end-date field). Folding
`publicDisplayOrder` into the toggle's input would also introduce a
real ambiguity `endGroupMembership`-style single-purpose functions never
have to resolve: is an *omitted* `publicDisplayOrder` key "leave it
unchanged" or "clear it"? A JS object can't cleanly distinguish "key absent"
from "key present with `undefined`" across a server-action `FormData`
boundary, and getting it wrong silently clears an admin's prior curation the
next time they merely toggle listing on/off for an unrelated reason. A
dedicated mutation with a required (non-optional) `publicDisplayOrder:
number | null` input has no such ambiguity — `null` always means "clear it,"
a number always means "set it," and there is no third state to
misinterpret.

**Order of operations, both new functions** (mirrors `setXPublicListed`'s
own 4-step shape minus the audit — see below for why no audit here):
1. `hasStaffManage`/`hasOfficersManage` gate — `forbidden` otherwise.
2. Row lookup scoped to `(id, organizationId)` — `invalid_target` if missing
   or cross-org.
3. Validate `publicDisplayOrder` is `null` or a non-negative integer ≤
   2147483647 (the `int4` bound the `coalesce(..., 2147483647)` sentinel in
   both `ORDER BY` clauses depends on never being a legitimate value) —
   `invalid_input` otherwise.
4. Update `publicDisplayOrder` only. **No `recordAudit()` call** — seebelow.

**Why display-order is NOT a Rule-7-audited mutation, unlike the toggle
itself:** the toggle (`setXPublicListed`) is audited because it is a
*disclosure* fact — it changes WHO is visible to the entire internet
(Phase 2's own ruling on the shipped feature). Setting a display-order
integer among people who are **already** public-listed changes nothing
about who is visible or reachable — it is purely a presentation-order fact,
the same "content configuration, not an identity/access/security-control
change" shape DECISION-113 already used to exempt `events.manage` mutations
from Rule 7. Named explicitly here so a future reader doesn't "fix" the
asymmetry between this pair and their `publicListed` siblings.

```ts
// src/lib/groups.ts — NEW exports, matching endGroupMembership's own
// re-load-scoped-before-mutate, reject-derived pattern exactly.
export async function setGroupMembershipPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { groupMembershipId: string; publicListed: boolean },
): Promise<GroupsResult<{ groupMembershipId: string; publicListed: boolean }>>

export async function setGroupMembershipPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { groupMembershipId: string; publicDisplayOrder: number | null },
): Promise<GroupsResult<{ groupMembershipId: string; publicDisplayOrder: number | null }>>
```

`setGroupMembershipPublicListed()` order of operations, identical shape to
`setStaffPositionPublicListed()`/`endGroupMembership()`'s own discipline:
1. `hasGroupsManage` gate — `forbidden` otherwise.
2. Row lookup scoped to `(id, organizationId, source = 'managed')` —
   **`invalid_target` if missing OR the row belongs to a derived group** —
   this is the load-bearing guard Phase 1 Flow 2 named: a derived
   Session/Diaconate `group_memberships` row must never become
   independently publicly-listable through this mutation, exactly mirroring
   `endGroupMembership`'s own re-load-scoped-before-mutate check.
3. Update `publicListed`, `publicListedBy = actingUserId`,
   `publicListedAt = now()` **on every call, in both directions** —
   matching `setStaffPositionPublicListed`'s own departure from
   `recordedBy`'s set-once-at-creation precedent (DECISION-131): turning
   the bit off is itself an attributable, timestamped act.
4. `recordAudit()` — `AUDIT_ACTIONS.GROUP_MEMBERSHIP_LISTED_PUBLICLY` /
   `GROUP_MEMBERSHIP_UNLISTED_PUBLICLY` — called from **inside
   `groups.ts`**, not from `actions.ts`, matching the exact "lib-does-audit"
   placement `setStaffPositionPublicListed`/`setOfficerTermPublicListed`
   already established for this same shape of mutation. This is the FIRST
   audited call in `groups.ts` (every other export in that file is
   unaudited per DECISION-110/Phase 2's own posture) — named explicitly so
   a future reader doesn't "fix" the apparent inconsistency with
   `createGroup`/`addGroupMember`/`endGroupMembership`'s own silence.

`setGroupMembershipPublicDisplayOrder()` mirrors
`setStaffPositionPublicDisplayOrder()` exactly (same derived-group
`invalid_target` guard as step 2 above, same bounds validation, no audit).

New `AUDIT_ACTIONS` keys (`src/lib/audit.ts`):

```ts
GROUP_MEMBERSHIP_LISTED_PUBLICLY: "group_membership.listed_publicly",
GROUP_MEMBERSHIP_UNLISTED_PUBLICLY: "group_membership.unlisted_publicly",
```

**Existing roster reads widen in place** (additive fields, no new query):
`StaffPositionEntry`/`OfficerRosterEntry` each gain `publicDisplayOrder:
number | null`; `GroupRosterEntry` (`src/lib/groups.ts`) gains
`publicListed: boolean` and `publicDisplayOrder: number | null`, threaded
into `getGroup()`'s existing roster query.

**Public read — `src/lib/sites.ts`, widening `getPublicStaffRoster()` and
adding `getPublicCommitteeRoster()`, both documented as the file's next
"COMMIT N ADDITION" per its header convention:**

```ts
export interface PublicStaffRosterFilter {
  kind?: "staff" | "officer";
  department?: string;
  office?: string;
  hasPriority?: boolean;
}

// SIGNATURE CHANGE from the shipped feature: gains an optional second
// parameter. Every existing zero-arg call site (there are none outside
// this file today) is unaffected — `filter` defaults to "no filter,"
// today's exact behavior.
export async function getPublicStaffRoster(
  slug: string,
  filter?: PublicStaffRosterFilter,
): Promise<PublicStaffRosterEntry[]>
```

Body (entire function stays one `try { … } catch { return []; }`, unchanged
posture): `if (!isFlagEnabled("sites.public_staff_directory")) return [];`
then `db.execute(sql`select * from presby_public_staff_roster(${slug},
${filter?.kind ?? null}, ${filter?.hasPriority ?? null})`)`, then — **new
step** — filter the returned rows by `department`/`office` in TypeScript
(normalized trim+lowercase, `office` matched against both the raw
`role_raw` value and its `OFFICE_LABELS` label) **before** mapping to
`PublicStaffRosterEntry` and returning. `PublicStaffRosterEntry`'s own shape
is **unchanged** — this pipeline adds no new output field (display order is
an internal curation input, never surfaced to an anonymous visitor).

```ts
export interface PublicCommitteeRosterFilter {
  committee?: string;
  hasPriority?: boolean;
}

export interface PublicCommitteeRosterEntry {
  groupName: string;
  groupRole: "chair" | "leader" | "member";
  displayName: string;
  photoKey: string | null;
}

export async function getPublicCommitteeRoster(
  slug: string,
  filter?: PublicCommitteeRosterFilter,
): Promise<PublicCommitteeRosterEntry[]>
```

Body, same shape as `getPublicStaffRoster` (one `try`/`catch`, flag-check
first, `sites.public_committee_directory` this time): `db.execute(sql`select
* from presby_public_committee_roster(${slug}, ${filter?.committee ?? null},
${filter?.hasPriority ?? null})`)`, mapped row-by-row with no further
TypeScript-layer filtering needed (per Design Decision 1, `committee` stays
a SQL parameter — no label-mapping constraint applies to it).

**SQL functions** — see Design Decisions 1/2 above for the full bodies of
`presby_public_staff_roster()` (widened) and `presby_public_committee_roster()`
(new); the complete DDL is in Data Model below.

**`presby-site-kit` v4.0.0 (breaking, separate repo):**

```ts
// src/index.tsx — RenderSiteBundleInput, BREAKING TYPE CHANGE
liveSlots?: Record<string, (filter: Record<string, unknown>) => ReactElement | null>;
```

```ts
// src/blocks.tsx — BlockRenderContext gains the same type change;
// renderLiveSlotBlock calls the resolver instead of dereferencing an
// element directly.
function renderLiveSlotBlock(
  props: unknown,
  ctx: BlockRenderContext,
): ReactElement | null {
  if (!isRecord(props) || typeof props.slot !== "string") return null;
  const resolver = ctx.liveSlots?.[props.slot];
  if (!resolver) return null;
  return resolver(isRecord(props.filter) ? props.filter : {});
}
```

`{"type":"liveSlot","props":{"slot":"staffDirectory"}}` — the exact marker
already live in any content repo today, with no `filter` key at all — is
unaffected: `isRecord(props.filter)` is `false`, the resolver is called with
`{}`, and every filter field inside `PublicStaffDirectory` stays unset,
reproducing today's exact behavior. **No content-repo migration is required
by this change.**

```tsx
// src/components/PersonCard.tsx — new, exported from index.tsx alongside
// StaffList. See Design Decision 3 for the full component and its
// deliberate absence of phone/email props.
export function PersonCard(props: PersonCardProps): ReactElement { ... }
```

**presby's own render components** (co-located with the existing
`(public)/site/[slug]/staff-directory.tsx`):

```tsx
// src/app/(public)/site/[slug]/staff-directory.tsx — MODIFIED
export function PublicStaffDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
}): Promise<ReactElement>
```

`filter` is narrowed via a small, local `parseStaffRosterFilter(raw):
PublicStaffRosterFilter` (checks each key's `typeof`, silently drops
anything malformed — the same defensive-narrowing posture
`extractBlocks`/`isRecord` already use one layer down in site-kit) before
being passed to `getPublicStaffRoster(slug, parsed)`. Render mechanism is
**unchanged** — still `<StaffList people={...} />` from `presby-site-kit`,
now built from the filtered roster instead of the full one.

```tsx
// src/app/(public)/site/[slug]/committee-directory.tsx — NEW, same
// conventions as staff-directory.tsx (async server component, no
// "use client").
export function PublicCommitteeDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
}): Promise<ReactElement>
```

Body: `parseCommitteeRosterFilter(filter)` → `getPublicCommitteeRoster(slug,
parsed)` → group the flat, already-`groupName`-clustered array by
`groupName` in one sequential pass (see Design Decision 2) → for each group,
`<section><h2>{groupName}</h2><div className="...">{members.map(m =>
<PersonCard key={...} name={m.displayName}
title={GROUP_ROLE_LABELS[m.groupRole]} photoUrl={m.photoKey ? `/site/
${slug}/assets/${m.photoKey}` : undefined} />)}</div></section>` — never
`phone`/`email` (no such prop exists on `PersonCard` to set). Empty result
→ `<p>No committees have been listed here yet.</p>`, matching
`PublicStaffDirectory`'s own explicit-empty-branch precedent (never a
silent `null`). `GROUP_ROLE_LABELS` (`{chair: "Chair", leader: "Leader",
member: "Member"}` — `member` renders as no subtitle at all, matching
`StaffPerson.title`'s own "optional, omit the redundant common case" prior
art) is a small local map in this file, not exported — `group_role`'s three
values are a closed, stable set with no cross-file reuse need today.

**`page.tsx` wiring:**

```ts
liveSlots: {
  staffDirectory: (filter) => <PublicStaffDirectory slug={slug} filter={filter} />,
  committeeDirectory: (filter) => <PublicCommitteeDirectory slug={slug} filter={filter} />,
},
```

Both closures close over **only** `slug` — the redline-enforcement check
(Design Decisions / Edge Cases below).

## Data Model

```ts
// src/lib/db/domain/staff.ts — staffPositions, added alongside publicListed
publicDisplayOrder: integer("public_display_order"),
```

```ts
// src/lib/db/domain/officers.ts — officerTerms, same
publicDisplayOrder: integer("public_display_order"),
```

```ts
// src/lib/db/domain/groups.ts — groupMemberships, FOUR new columns
// (this table carries none of the three "publicly listable" columns yet)
publicListed: boolean("public_listed").notNull().default(false),
publicListedBy: uuid("public_listed_by").references(() => users.id),
publicListedAt: timestamp("public_listed_at", { withTimezone: true }),
publicDisplayOrder: integer("public_display_order"),
```

`groups.ts`'s domain file needs a new `boolean`/`timestamp`/`integer` import
addition and a new import of `users` from `./auth` (or wherever `users` is
defined) — it imports neither today.

**Migration `drizzle/0042_presby_public_directory_primitives.sql`**
(hand-written, per house convention):

```sql
alter table staff_positions
  add column if not exists public_display_order integer;

alter table officer_terms
  add column if not exists public_display_order integer;

alter table group_memberships
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz,
  add column if not exists public_display_order integer;

-- Backs presby_public_committee_roster()'s WHERE clause, matching
-- staff_positions_public_listed_idx / officer_terms_public_listed_idx's
-- own shape exactly.
create index if not exists group_memberships_public_listed_idx
  on group_memberships (organization_id)
  where public_listed and ends_on is null;

-- Widen presby_public_staff_roster() with p_kind/p_has_priority. Adding
-- parameters changes the function's arity — CREATE OR REPLACE cannot
-- reuse the existing single-argument overload in place (Postgres treats a
-- different parameter list as a distinct function identity even when the
-- new trailing parameters carry DEFAULTs); a bare CREATE OR REPLACE here
-- would create a SECOND, overloaded function, and a 1-argument call
-- becomes ambiguous between the two. The old signature must be dropped
-- first.
drop function if exists presby_public_staff_roster(text);

create or replace function presby_public_staff_roster(
  p_slug text,
  p_kind text default null,
  p_has_priority boolean default null
)
returns table (
  kind         text,
  role_raw     text,
  department   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.kind, u.role_raw, u.department, u.display_name, u.photo_key
    from (
      select 'staff' as kind, sp.position as role_raw, sp.department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             p.photo_key, sp.public_display_order
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
             p.photo_key, ot.public_display_order
        from officer_terms ot
        join organizations o on o.id = ot.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = ot.person_id
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and ot.public_listed
         and ot.ends_on is null
    ) u
   where (p_kind is null or u.kind = p_kind)
     and (p_has_priority is not true or u.public_display_order is not null)
   order by coalesce(u.public_display_order, 2147483647), u.display_name;
$$;

comment on function presby_public_staff_roster(text, text, boolean) is
  'Widened (docs/work-log/2026-08-28-public-directory-primitives.md) with optional p_kind/p_has_priority filter parameters -- department/office matching stays in TypeScript (getPublicStaffRoster()), never duplicated here, because office LABELS live in exactly one place (OFFICE_LABELS, DECISION-131) and this function must not grow a second copy. Ordering is always coalesce(public_display_order, 2147483647), display_name so an org that never curates gets alphabetical for free.';

revoke all on function presby_public_staff_roster(text, text, boolean) from public;
grant execute on function presby_public_staff_roster(text, text, boolean) to presby_app;

-- presby_public_committee_roster(text, text, boolean) -- NEW, anonymous,
-- unauthenticated read backing (public)/site/[slug]'s committeeDirectory
-- liveSlot. Mirrors presby_public_staff_roster()'s SECURITY DEFINER/grant
-- shape; a SEPARATE function from the staff/officer union, not a widening
-- of it (Phase 2's own ruling -- committees are a structurally different
-- read over a different table). g.name is the ONLY grouping identifier
-- ever projected -- g.id is never selected, matching the "no id in the
-- anonymous projection" rule the staff/officer function already
-- established for person ids.
create or replace function presby_public_committee_roster(
  p_slug text,
  p_committee text default null,
  p_has_priority boolean default null
)
returns table (
  group_name   text,
  group_role   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.ends_on is null
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;

comment on function presby_public_committee_roster(text, text, boolean) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] committeeDirectory liveSlot (docs/work-log/2026-08-28-public-directory-primitives.md). g.membership_source = ''managed'' is defense-in-depth: a derived Session/Diaconate group_memberships row can never surface here even under a future application-layer bug, mirroring groups.ts''s own two-layer discipline. group_name is the only grouping identifier ever projected -- group_id is never selected.';

revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;
```

**No new RLS policy.** `staff_positions`/`officer_terms` are unchanged by
this pipeline's RLS surface (only a new nullable column). `group_memberships`
already carries `FORCE ROW LEVEL SECURITY` + `tenant_isolation` from
migration `0009`'s `tenant_tables` loop (confirmed by direct read — it is
already in that array) — four new columns on an already-force-RLS'd table
need nothing further, and both `SECURITY DEFINER` functions bypass RLS the
same way `presby_public_staff_roster()` already does. **No index widening
on the existing two `*_public_listed_idx` partial indexes** — Phase 2 Note 2
flagged this as needing "its own index consideration"; considered and
**ruled unnecessary**: `public_display_order` is used only in `ORDER BY`
over a set already narrowed by the partial index's own `WHERE` predicate to
one org's currently-open, currently-listed rows — a congregation's public
roster is dozens of rows, not thousands, so sorting the filtered set needs
no covering index.

## Component / Page Plan

- **Pages to create:** none — both surfaces are `liveSlots` inside the
  existing `(public)/site/[slug]/[[...path]]/page.tsx` render, matching the
  shipped precedent.
- **Components to create:**
  - `src/app/(public)/site/[slug]/committee-directory.tsx` —
    `PublicCommitteeDirectory({ slug, filter })`, new, per API Contract.
  - `presby-site-kit/src/components/PersonCard.tsx` — new, per Design
    Decision 3.
- **Files to modify:**
  - `src/app/(public)/site/[slug]/staff-directory.tsx` — `filter` prop
    added, `PublicStaffDirectory`'s signature changes (see API Contract).
  - `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — `liveSlots`
    entries become resolver-function closures; add `committeeDirectory`.
  - `src/lib/db/domain/staff.ts`, `officers.ts`, `groups.ts` — new columns.
  - `src/lib/staff.ts`, `officers.ts` — new
    `setXPublicDisplayOrder()` exports; `StaffPositionEntry`/
    `OfficerRosterEntry` gain `publicDisplayOrder`.
  - `src/lib/groups.ts` — new `setGroupMembershipPublicListed()`/
    `setGroupMembershipPublicDisplayOrder()` exports; `GroupRosterEntry`
    gains `publicListed`/`publicDisplayOrder`.
  - `src/lib/sites.ts` — `getPublicStaffRoster()` widened,
    `getPublicCommitteeRoster()` added, both filter types.
  - `src/lib/audit.ts` — the two new `GROUP_MEMBERSHIP_*_PUBLICLY` keys.
  - `src/app/(org)/o/[slug]/admin/staff/actions.ts`,
    `.../admin/officers/actions.ts` — new
    `set*PublicDisplayOrderAction()` server actions (thin wrappers, no
    `recordAudit()` — matches the mutation's own no-audit ruling).
  - `src/app/(org)/o/[slug]/admin/groups/[groupId]/actions.ts` (or
    wherever the groups admin roster's existing actions live) — new
    `setGroupMembershipPublicListedAction()`/
    `setGroupMembershipPublicDisplayOrderAction()`.
  - Groups admin roster page/component — a "List publicly" `Switch` +
    `AlertDialog` control per roster row (same copy/interaction pattern as
    the shipped `PublicListingToggle`, a THIRD near-identical copy per this
    codebase's existing per-domain-file convention for these small
    structurally-similar dialogs — not shared, matching
    `end-position-dialog.tsx`/`end-term-dialog.tsx`'s own precedent), plus
    a small numeric "Display order" input, on all three admin surfaces
    (staff, officers, groups).
  - `presby-site-kit/src/index.tsx`, `src/blocks.tsx`, `package.json`
    (version bump to `4.0.0`) — the `liveSlots` resolver-function change,
    `PersonCard` export, in the sibling repo.
  - `presby/package.json` — bump the pinned tag to `#v4.0.0`.
- **Server vs. client split:** no `'use client'` anywhere in this feature's
  own new render code (`PublicCommitteeDirectory`, `PersonCard`, the
  resolver closures) — all server-only, matching the shipped precedent. The
  admin-side toggle/order controls are client components, following the
  existing `PublicListingToggle` pattern.

## Implementation Order

Cross-repo, six sequenced steps (one more than the shipped precedent's four
— the committee side is genuinely new, not an extension, and warrants its
own schema+read pass rather than being folded into steps 1–2):

1. **Schema** (`database-admin`, in `presby`): `drizzle/0042_presby_public_directory_primitives.sql` — the `publicDisplayOrder` columns on `staff_positions`/`officer_terms`, the four new columns on `group_memberships`, the new partial index, the `drop`+`create or replace` on `presby_public_staff_roster()`, and the new `presby_public_committee_roster()`. Re-check `ls drizzle/*.sql` and `docs/TODO.md`'s In Flight section for a `0042` collision immediately before applying (Design Decision 4). Confirm `scripts/test-rls.sql`'s `group_memberships`/`staff_positions`/`officer_terms` sections (or a pollution-immune isolation proof, per the shipped precedent's own step-1 workaround if the shared dev DB has drifted again) still pass after the `ALTER TABLE`s.
2. **Admin mutations** (`api-developer`, in `presby`): `setStaffPositionPublicDisplayOrder`/`setOfficerTermPublicDisplayOrder`/`setGroupMembershipPublicListed`/`setGroupMembershipPublicDisplayOrder`, the two new `AUDIT_ACTIONS` keys, the new server actions, `StaffPositionEntry`/`OfficerRosterEntry`/`GroupRosterEntry` field widenings. Depends on step 1's columns existing.
3. **Public read** (`api-developer`, in `presby`): `getPublicStaffRoster()`'s filter widening, `getPublicCommitteeRoster()`, the `sites.public_committee_directory` flag row in `scripts/seed.ts`. Depends on step 1's SQL functions existing; independent of step 2 (a public read of an already-toggled row needs no new mutation to exist).
4. **`presby-site-kit` v4.0.0** (`api-developer`, in the sibling `presby-site-kit` repo — its own commit, its own tag, sequenced explicitly): the `liveSlots` resolver-function breaking change, `PersonCard`, `package.json` bump to `4.0.0`, tag `v4.0.0`, `feat!:` commit message per this repo's own established `v2.0.0`/`v3.0.0` breaking-change convention (confirmed by direct `git log`/`git tag` inspection — this is a genuine major-version bump under real semver, not a special pre-1.0 signal; the package is already past `v1.0.0` and has cut two prior breaking majors this same way). Independent of steps 2/3 — can proceed in parallel once step 1 exists conceptually (it doesn't touch `presby`'s schema at all). **Nothing in step 5/6 can be written against a real `liveSlots` resolver type until this tag exists on the sibling remote and `presby`'s pinned dependency is bumped and reinstalled** — verify the installed `dist/index.d.ts` actually changed (per the shipped precedent's own hard-won lesson: a bare `npm install` after editing `package.json` did not re-resolve the git ref last time).
5. **Render components + wiring** (`ux-developer`, in `presby`): `committee-directory.tsx`, the `filter` prop addition to `staff-directory.tsx`, the `page.tsx` `liveSlots` conversion to resolver closures (both `staffDirectory` and the new `committeeDirectory`). Depends on step 4's tag being installed and step 3's read functions existing.
6. **Admin UI** (`ux-developer`, in `presby`): the "Display order" numeric input alongside the existing `PublicListingToggle` on `admin/staff`/`admin/officers`, and the new `PublicListingToggle`-shaped control (plus display-order input) on the groups admin roster page. Depends on step 2's actions existing. Can run in parallel with step 5 (they touch disjoint files) but is listed after it here because both were assigned to the same implementer in sequence.
7. Release notes entry (tech-lead, at Phase 6 SHIP IT) + `docs/product/functionality-map.md` update + `docs/TODO.md` reconciliation, per Rules 10/13/14.

## Edge Cases & Risks

- **Two managed committees sharing the same `groups.name` at one org** —
  accepted, named in Design Decision 2: they merge under one heading on an
  all-committees page. Not a security issue (no `id` is ever exposed either
  way); an admin data-quality question, out of this pipeline's scope to
  prevent.
- **`presby_public_staff_roster()`'s drop-then-recreate is a real Postgres
  gotcha, not a formality** — if database-admin instead attempts a bare
  `create or replace function` with the widened parameter list, Postgres
  creates a SECOND, overloaded function rather than replacing the first,
  and every existing 1-argument call becomes ambiguous ("function is not
  unique") — a production-breaking defect that would not surface until the
  very first anonymous page view after deploy. Named explicitly in the
  migration's own SQL comment (see Data Model) so this isn't rediscovered
  the hard way.
- **Silent filter-typo failure, unchanged from the shipped feature's own
  named-not-solved gap** — a content author who mistypes `department`/
  `office`/`committee` gets an empty section with no error surfaced
  anywhere. Not this pipeline's job to build content-repo validation
  (Phase 1's own ruling, reconfirmed).
- **Per-slot fault isolation must extend to `committeeDirectory`, not just
  `staffDirectory`** — the shipped feature had to close this as a same-day
  Phase 6 bug-fix for the ORIGINAL slot; `getPublicCommitteeRoster()` must
  ship with the identical whole-body `try { … } catch { return []; }`
  wrapper from day one, not rediscovered a second time (Phase 1/2 both
  named this explicitly).
- **`PersonCard`'s mobile pass is net-new** — no existing CSS covers its
  shape; a 360px check is required before Phase 5, same as the shipped
  feature's own `PublicListingToggle` column required one.
- **`check:audit` tripwire blindness, already known, extends to the new
  `groups.ts` mutation** — the shipped feature's own Phase 4 finding
  (the tripwire only walks `actions.ts` files and only matches a literal
  `db.insert/update/delete` inside them) applies identically here:
  `setGroupMembershipPublicListed()`'s `recordAudit()` call lives inside
  `groups.ts`, invisible to `npm run check:audit`. The only real proof of
  coverage is `groups.test.ts`'s own `mockRecordAudit` assertions — name
  this in that file's own doc comment, don't rely on a green tripwire run.

## e2e Blast Radius (existing specs this change alters, not just new coverage needed)

- **Any existing Playwright/RTL spec asserting on
  `PublicStaffDirectory`/`staff-directory.tsx`'s current props or on
  `page.tsx`'s `liveSlots` object shape** — `staffDirectory`'s prop
  signature changes from `{ slug }` to `{ slug, filter }`, and `page.tsx`'s
  `liveSlots` values change from JSX elements to closures. The shipped
  feature's own `[[...path]]/page.test.tsx` asserts `renderSiteBundle()`
  receives "a truthy `liveSlots.staffDirectory` element" — that assertion
  is now checking a *function*, not an *element*, and must be updated, not
  merely left passing by coincidence (a truthy-function check would
  accidentally still pass, masking that the shape actually changed —
  QA should confirm the test asserts on the resolved *output* of calling
  the closure, not merely its truthiness).
- **Any spec asserting on `admin/staff`/`admin/officers` roster row DOM
  structure/column count** — adding a "Display order" input is the same
  class of DOM-shape change the shipped feature's own `PublicListingToggle`
  column already caused once this session; re-check `hidden sm:table-cell`
  placement doesn't regress at 390px/360px for either table (the shipped
  feature's own real-browser-verified fix for this exact failure mode).
- **`presby-site-kit`'s own test suite for `renderLiveSlotBlock`/
  `BLOCK_REGISTRY`'s `liveSlot` entry** — any existing site-kit test
  passing a plain `ReactElement` as a `liveSlots` value will fail to
  typecheck and fail at runtime (calling an element as a function) under
  v4.0.0 — this is the intended breaking change, but the sibling repo's own
  existing `liveSlot` tests must be updated in the SAME commit that cuts
  the tag, not left red.
- **No existing spec should assert on `PublicStaffRosterEntry`'s output
  shape changing** — it doesn't; only the input (`filter`) changes.

## Out of Scope (confirmed, carried from Phase 1/2, not re-litigated)

- Migrating `site-fpcw`'s existing committees-page content to the new
  mechanism (Phase 1 Ruling 5) — `site-recreator`'s job, later.
- A group-level ("is this committee's existence public regardless of
  members") visibility axis (Phase 1 Ruling 3).
- Any visitor-facing search/filter control on the public site — the filter
  mechanism stays author-baked, server-resolved only (the redline).
- A `personCard` hand-authored block type (Design Decision 3) — a future,
  separately-scoped addition if ever requested.
- Photo upload for `people.photo_key` — still unwired, tracked in
  `docs/TODO.md`, unchanged by this pipeline.

## Implementer

Six sequenced steps across two repos: **database-admin** (step 1, schema +
both SQL functions), **api-developer** (steps 2–3, admin mutations then
public read, in `presby`, plus step 4, the `presby-site-kit` v4.0.0 cut in
the sibling repo), **ux-developer** (steps 5–6, render components/wiring
then admin UI). Matches the shipped precedent's own implementer-per-shape
split (schema / server-logic-and-cross-repo-cut / client) rather than
inventing a new one — the added committee-side work is more of the same
shape (a new SQL function, a new lib module's mutations, a new render
component), not a different kind of work warranting a different split.

---

# Phase 4 — Implementation

**Status: Complete — all 6 of 6 steps done.** This section records all six
Implementation Order steps (step 1 — schema, database-admin, this repo;
step 2 — admin mutations, api-developer, this repo; step 3 — public read,
api-developer, this repo; step 4 — `presby-site-kit` v4.0.0, api-developer,
sibling repo; step 5 — render components + `liveSlots` wiring,
ux-developer, this repo; step 6 — admin UI, ux-developer, this repo).
Ready to advance to Phase 5 (qa).

## Step 1 — Schema (database-admin, this repo)

**Date:** 2026-08-28

### Files Created

- `drizzle/0042_presby_public_directory_primitives.sql` — hand-written
  migration: `public_display_order integer` (nullable) on `staff_positions`
  and `officer_terms`; four new columns (`public_listed`,
  `public_listed_by`, `public_listed_at`, `public_display_order`) on
  `group_memberships`; a new partial index
  `group_memberships_public_listed_idx` (mirrors the two existing
  `*_public_listed_idx` indexes from `0041`); `drop function if exists
  presby_public_staff_roster(text)` followed by `create or replace
  function presby_public_staff_roster(p_slug, p_kind default null,
  p_has_priority default null)` (widened, arity-changed — the drop is
  required, a bare `create or replace` would have created a second,
  overloaded function per Phase 3's own flagged gotcha); a new
  `presby_public_committee_roster(p_slug, p_committee default null,
  p_has_priority default null)` `SECURITY DEFINER` function, returning
  `group_name`/`group_role`/`display_name`/`photo_key` (never `group_id`),
  with the same `organizations.status = 'active' and
  organization_sites.status = 'live'` defense-in-depth and
  `g.membership_source = 'managed'` derived-group exclusion Phase 3
  specified.

### Files Modified

- `src/lib/db/domain/staff.ts` — `integer` import added; `staffPositions`
  gains `publicDisplayOrder: integer("public_display_order")` (nullable),
  alongside the three `publicListed*` columns shipped in `0041`.
- `src/lib/db/domain/officers.ts` — `officerTerms` gains the same
  `publicDisplayOrder` column (file already imported `integer` for
  `classYear`).
- `src/lib/db/domain/groups.ts` — `integer` import added; new `users`
  import from `../schema` (file previously imported neither). `groupMemberships`
  gains all four new columns: `publicListed` (`boolean`, not null, default
  false), `publicListedBy` (`uuid`, references `users.id`),
  `publicListedAt` (`timestamp` with timezone), `publicDisplayOrder`
  (nullable `integer`) — this table previously carried none of the three
  "publicly listable" columns.
- `drizzle/meta/_journal.json` — new entry registered at `idx: 42`, tag
  `0042_presby_public_directory_primitives`.

### Migration numbering

Re-checked `ls drizzle/*.sql` and `drizzle/meta/_journal.json` (idx 41 was
the prior high-water mark) and `docs/TODO.md`'s In Flight section (no
`0042` mention anywhere) both before writing the file and again
immediately before applying it — `0042` was free both times, no
near-collision this round.

### Schema changes / migration mode

- **Migration mode: `db:generate` is broken repo-wide** (documented
  precedent, `drizzle/0041`'s own header) on the `drizzle/meta/0008-0012`
  snapshot collision — every migration past `0012` is hand-authored SQL,
  manually registered in `_journal.json`, matching house style. This
  pipeline follows the same convention, **not** `npm run db:push`.
- **Applied via direct `psql` against the shared Neon dev database**
  (`MIGRATE_DATABASE_URL`, the `neondb_owner` role), matching the actual
  house convention every migration since `0013` has used (confirmed
  against `0038`–`0041`'s own Phase 4 notes) rather than a Neon-branch
  `db:push`:

  ```
  psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0042_presby_public_directory_primitives.sql
  ```

  Applied cleanly, no errors — `ALTER TABLE` ×3, `CREATE INDEX`, `DROP
  FUNCTION`, `CREATE FUNCTION` ×2, `COMMENT`/`REVOKE`/`GRANT` ×2. All
  statements idempotent (`if not exists` throughout, `create or replace
  function`).

### Verification performed

1. **Old 1-argument call shape still works, confirmed against the live dev
   DB (not merely assumed):** `select * from presby_public_staff_roster('fpcw')`
   returns correctly after the widening. `\df presby_public_staff_roster`
   confirms exactly **one** function exists on disk post-migration (arity
   `(text, text default null, boolean default null)`) — no orphaned
   1-argument overload, so no "function is not unique" ambiguity was
   introduced. A transaction-scoped, rolled-back data proof (synthetic
   `Testonly Alphaperson`/`Testonly Betaperson` people at `fpcw`, no
   fixture pollution left behind) confirmed: the 1-arg call returns both
   unfiltered staff rows exactly as it did before `0042`; the 3-arg call
   (`'staff', true`) correctly narrows to only the `public_display_order`-set
   row; `presby_public_committee_roster('fpcw')` returns both committee
   members unfiltered; `presby_public_committee_roster('fpcw', 'test
   missions committee', true)` correctly narrows to the chair only.
2. **`scripts/test-rls.sql` full suite: could not complete as a full run**
   — aborts (`ON_ERROR_STOP=1`) at its existing `memberships` count
   assertion (`expected 9, got 10`), due to the **already-documented,
   pre-existing leaked "Testy Verifyington" memberships row at Alder
   Creek** (`docs/TODO.md` Next Up, logged 2026-08-27 by the prior
   pipeline; confirmed by direct read that row's `created_at` predates
   `0042` by a day and it carries no `officer_terms`/`staff_positions`
   row, so it cannot be this migration's own leak). Ran the suite twice —
   once as `neondb_owner` (fails immediately with RLS trivially bypassed
   by table ownership, wrong role — corrected), then as `presby_app`
   (`APP_DATABASE_URL`, the correct role per CLAUDE.md — fails at the
   pre-existing pollution point, unrelated to this change).
3. **Pollution-immune isolation proof run instead, per the shipped
   `2026-08-27-public-staff-directory.md` precedent's own workaround for
   an identically-drifted shared dev DB.** All transaction-scoped, rolled
   back, as `presby_app`:
   - `pg_class.relforcerowsecurity` confirmed still `true` for
     `staff_positions`, `officer_terms`, `group_memberships` post-`ALTER
     TABLE` (FORCE RLS unaffected by adding nullable columns).
   - **Write-side tenant isolation, all three tables, new columns
     included in the attempted write:** with GUC set to Bramblewood,
     attempting to insert a `group_memberships` row (with `public_listed`/
     `public_display_order` set) naming Alder Creek's `organization_id`
     and a real Alder Creek `group_id`/`person_id` → rejected
     (`insufficient_privilege`). Identical proof repeated for
     `staff_positions.public_display_order` and
     `officer_terms.public_display_order` — both rejected the same way.
     Matches the exact pattern `test-rls.sql`'s own staff_positions
     write-side section (lines 2607–2624) already established.
   - **F2 composite-key discipline confirmed intact on
     `group_memberships`:** an insert naming a real Alder Creek group but
     a person with no matching `(person_id, organization_id)` row in
     `memberships` → rejected (`foreign_key_violation`,
     `group_memberships_person_fk`). None of the four new columns
     participate in either composite FK, so this was expected to be
     unaffected — confirmed, not merely assumed.
4. **`npm run typecheck`** — PASS, no output, no errors. Confirms the
   three domain-file schema edits (new `integer` imports, new `users`
   import in `groups.ts`, four new columns) compile clean against every
   existing caller of `staffPositions`/`officerTerms`/`groupMemberships`.

### Schema Changes (summary)

- `staff_positions.public_display_order` (nullable `integer`) — new.
- `officer_terms.public_display_order` (nullable `integer`) — new.
- `group_memberships.public_listed` (`boolean`, not null, default false),
  `.public_listed_by` (`uuid`, references `users.id`), `.public_listed_at`
  (`timestamptz`), `.public_display_order` (nullable `integer`) — all new;
  this table carried none of the "publicly listable" shape before.
- New index: `group_memberships_public_listed_idx` (partial, `where
  public_listed and ends_on is null`).
- `presby_public_staff_roster()` widened from `(text)` to `(text, text
  default null, boolean default null)` via drop+recreate (arity change).
- `presby_public_committee_roster(text, text default null, boolean
  default null)` — new `SECURITY DEFINER` function.
- Applied via: **hand-written migration + direct `psql`** (`db:generate`
  is repo-wide broken past `0012`; `db:push` is not this repo's actual
  convention for shipped migrations — see above).

### Audit Events

- None written by this step. Step 1 is schema-only — no application-layer
  mutation exists yet to call `recordAudit()`. Phase 3's design specifies
  the audited mutation (`setGroupMembershipPublicListed()`, new
  `AUDIT_ACTIONS.GROUP_MEMBERSHIP_LISTED_PUBLICLY`/
  `GROUP_MEMBERSHIP_UNLISTED_PUBLICLY`) lands in **step 2**
  (api-developer), not here.

### Implementer Notes

- No divergence from the Phase 3 Data Model spec — the migration SQL,
  column definitions, and function bodies were transcribed verbatim from
  Phase 3's own DDL, per the task's instruction not to redesign.
- The drop-then-recreate on `presby_public_staff_roster()` was applied
  exactly as flagged (Phase 3 Edge Cases / Design Decision 4) — verified,
  not merely trusted, via `\df` showing a single surviving overload and a
  live 1-arg call returning correct data post-migration.
- The full `scripts/test-rls.sql` run could not complete due to
  pre-existing dev-DB drift unrelated to this migration (see above); this
  is the same category of shared-dev-DB pollution `docs/TODO.md` already
  tracks as an open, unresolved pattern (three independent leaks logged
  across three different days now, including this one's discovery that
  the same leaked row still hasn't been cleaned up since 2026-08-27). Not
  cleaned up here, per the same reasoning the prior pipeline used — fixing
  a different pipeline's test teardown is out of scope for a schema-only
  commit. Flagging again below in the handoff for whichever agent next
  works `docs/TODO.md`.
- `groups.ts` needed a genuinely new `users` import (staff.ts/officers.ts
  already had it) — no circular-import issue: `staff.ts`/`officers.ts`
  already establish `import { users } from "../schema"` as a safe,
  precedented pattern from a `domain/*.ts` submodule, and `typecheck`
  confirms `groups.ts` following the identical pattern is equally safe.

### Handoff — next implementer (api-developer, steps 2–3)

- **New columns live and confirmed on the dev DB:**
  `staffPositions.publicDisplayOrder`, `officerTerms.publicDisplayOrder`
  (both nullable `integer`), and all four new
  `groupMemberships.publicListed`/`.publicListedBy`/`.publicListedAt`/
  `.publicDisplayOrder` columns.
- **`presby_public_staff_roster()`** is live, widened, and callable as
  `presby_app` with either the old 1-arg shape or the new 3-arg
  `(slug, kind, hasPriority)` shape — confirmed working both ways against
  the shared dev DB.
- **`presby_public_committee_roster(slug, committee?, hasPriority?)`** is
  live, new, and callable as `presby_app` — confirmed working with and
  without filters against the shared dev DB.
- **To pick this up locally:** `npm run db:push` is **not** needed against
  the shared dev DB (already applied there via direct `psql`, as above)
  — pulling `main` after this commits is sufficient for anyone else
  pointed at the same shared dev DB. A fresh branch/environment needs
  either `npm run db:push` (dev-only, lossy) or applying
  `drizzle/0042_presby_public_directory_primitives.sql` directly. No seed
  change was made in this step (`npm run db:seed` not required by step 1
  alone) — step 3's new `sites.public_committee_directory` flag row still
  needs adding to `scripts/seed.ts`, per Phase 3's Implementation Order.
- Step 2's own admin mutations (`setStaffPositionPublicDisplayOrder`,
  `setOfficerTermPublicDisplayOrder`, `setGroupMembershipPublicListed`,
  `setGroupMembershipPublicDisplayOrder`) can now be written against real
  columns; step 3's `getPublicStaffRoster()`/`getPublicCommitteeRoster()`
  can be written against real, tested SQL functions. Neither step 2 nor
  step 3 needs to touch this migration file again.
- Steps 2, 3, 5, 6 remain **Pending** (step 4 is independently complete —
  see below). This work-log's Phase 4 is not complete until all six steps
  land; do not advance to Phase 5 (qa) until then.

## Step 4 — `presby-site-kit` v4.0.0 (api-developer, sibling repo `presby-site-kit`)

**Repo:** `~/git/presby-platform/presby-site-kit` (NOT this repo — no `presby`
files touched by this step, per Implementation Order step 4's own note that
`presby/package.json`'s pin bump is step 5/6's job, sequenced after this tag
exists).

### Files Created

- `presby-site-kit/src/components/PersonCard.tsx` — new `PersonCard`
  component + `PersonCardProps`, per Phase 3 Design Decision 3. Genuinely
  separate from `StaffList` (no shared internal fragment, per the documented
  tradeoff): standalone `<div data-block="person-card">`, not an `<li>`. No
  `phone`/`email` props exist on the type at all — a structural fix, not
  caller discipline. Props: `name: string`, `title?: string`,
  `photoUrl?: string`, `headingClassName?: string`, `className?: string`
  (exact match to Phase 3's code block).
- `presby-site-kit/test/components/PersonCard.test.tsx` — new, matching
  `StaffList.test.tsx`'s per-component convention: name/title/photo render,
  omission-without-dropping-the-person, no-contact-field-surface check,
  `headingClassName`/`className` application, and container-contract
  (`<div>`, not `<li>`) assertions.

### Files Modified

- `presby-site-kit/src/index.tsx` — `RenderSiteBundleInput.liveSlots` type
  changed from `Record<string, ReactElement>` to
  `Record<string, (filter: Record<string, unknown>) => ReactElement | null>`
  (BREAKING, DECISION-132). `PersonCard`/`PersonCardProps` exported
  alongside `StaffList`.
- `presby-site-kit/src/blocks.tsx` — `BlockRenderContext.liveSlots` type
  changed to match; `renderLiveSlotBlock` now calls the resolver with
  `isRecord(props.filter) ? props.filter : {}` instead of dereferencing the
  map directly:
  ```ts
  function renderLiveSlotBlock(props: unknown, ctx: BlockRenderContext): ReactElement | null {
    if (!isRecord(props) || typeof props.slot !== "string") return null;
    const resolver = ctx.liveSlots?.[props.slot];
    if (!resolver) return null;
    return resolver(isRecord(props.filter) ? props.filter : {});
  }
  ```
  (`isRecord` already existed in `src/utils.ts`, reused as-is — no new
  helper needed.)
- `presby-site-kit/test/blocks.test.tsx` — the three existing `liveSlot`
  tests that passed a raw `<div>` `ReactElement` as a `liveSlots` value were
  updated to pass resolver functions (`() => <div .../>`), per the e2e/test
  blast-radius section. Added three new tests: resolver receives `{}` when
  no `filter` prop is present, resolver receives the marker's own `filter`
  object verbatim, and a non-record `filter` value falls back to `{}` rather
  than being passed through — plus one confirming a resolver returning
  `null` renders `null`, not a throw.
- `presby-site-kit/package.json` — version bumped `3.6.0` → `4.0.0`;
  description's component list gained `PersonCard`.

### Schema Changes

None — this step touches no `presby` schema (Implementation Order step 4 is
explicitly independent of `presby`'s own DB work).

### Audit Events

None — no security-sensitive mutation in this step; `presby-site-kit` is a
pure rendering library with no DB access at all.

### Version-bump convention (verified, not assumed)

Confirmed by direct `git log`/`git tag -l` inspection before cutting: every
prior **major** bump (`v1.0.0`, `v2.0.0`, `v3.0.0`) used the commit-message
prefix **`feat!:`** with a `BREAKING: ...` paragraph in the body (e.g.
`863c378 feat!: v2.0.0 -- real sub-page navigation via Nav chrome`), and was
an **annotated** git tag (`git cat-file -t v2.0.0` → `tag`, not `commit`) —
unlike minor bumps (`v3.6.0`, `v3.5.0`, etc.), which are plain `feat:`/`fix:`
commits with **lightweight** tags (`git cat-file -t v3.6.0` → `commit`). This
confirms the Phase 3 design doc's claim about the `feat!:` convention and
adds the previously-unstated annotated-vs-lightweight-tag distinction, which
this step's `v4.0.0` tag matches (`git tag -a v4.0.0 -m "..."`).

Commit: `8ca982a feat!: v4.0.0 -- liveSlots values become resolver
functions`, pushed to `origin/main`. Tag `v4.0.0` (annotated, points at
`8ca982a`) pushed to `origin`. Confirmed live via `git ls-remote --tags
origin`.

### Verification run (this repo's own commands)

- `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`): PASS, no
  errors.
- `npm run test` (vitest): PASS — 20 test files, 164 tests, 0 failures
  (includes the new `PersonCard.test.tsx` and the updated `blocks.test.tsx`
  `liveSlot` cases).
- `npm run build` (`tsc` + stylesheet copy): PASS. Confirmed
  `dist/index.d.ts` actually reflects the new type
  (`liveSlots?: Record<string, (filter: Record<string, unknown>) =>
  ReactElement | null>;`) and the new `PersonCard` export, per the shipped
  precedent's own hard-won "a bare install doesn't re-resolve the git ref"
  lesson named in Implementation Order step 4 — this check matters most for
  step 5's consumer, not this step itself, but confirming the build actually
  emits the right `.d.ts` here removes one failure mode before that
  consumer even starts.

### Implementer Notes

- Matched Phase 3's design code block for `renderLiveSlotBlock` and
  `PersonCardProps` verbatim rather than reinterpreting — no redesign.
- `isRecord` already existed in `src/utils.ts` and needed no change; the
  filter-narrowing line reuses it exactly as `blocks.tsx`'s other renderers
  do one layer up.
- `PersonCard`'s export line in `src/index.tsx` was placed immediately
  before `StaffList`'s own export block (co-located, matching the file's
  existing alphabetical-by-component grouping) rather than immediately after
  `Nav`, which would have split `Nav`'s own `{Nav}` / `{groupEntries}` /
  `{NavProps}` export trio across two components.
- Did **not** touch `presby/package.json`'s pinned tag — that is
  Implementation Order step 5/6's own job, sequenced after this tag exists
  on the remote (now true). Next implementer (whoever picks up steps 5–6,
  ux-developer per the plan) must bump the pin to `#v4.0.0` and reinstall,
  then verify the installed `node_modules/presby-site-kit/dist/index.d.ts`
  actually changed before writing any code against the new resolver-function
  `liveSlots` type — a bare `npm install` after only editing `package.json`
  did not re-resolve the git ref last time (named explicitly in Phase 3).
- **Handoff:** the next agent to touch this pipeline is whichever
  implementer picks up steps 2–3 (api-developer, `presby`-side admin
  mutations + public read, independent of this step) and/or step 1
  (database-admin, schema) if not already done; step 5 (ux-developer,
  `presby`-side render components + `page.tsx` wiring) is blocked on this
  step's tag (now unblocked) and on step 3's read functions existing.

## Step 2 — Admin mutations (api-developer, this repo)

**Date:** 2026-08-28

### Files Modified

- `src/lib/staff.ts` — added `setStaffPositionPublicDisplayOrder(
  viewerPersonId, organizationId, input: { positionId, publicDisplayOrder })`
  per Phase 3's exact 3-parameter signature (no `actingUserId` — this
  mutation carries no `publicDisplayOrderBy`/`At` companion columns, unlike
  `publicListed`). Order of operations per Phase 3: `hasStaffManage` gate →
  `(id, organizationId)`-scoped lookup → `publicDisplayOrder` bounds
  validation (`null` or a non-negative integer ≤ 2147483647, else
  `invalid_input`) → update, **no `recordAudit()` call** (presentation-order
  only, not a disclosure fact — DECISION-113's reasoning, named explicitly in
  the function's own doc comment so a future reader doesn't "fix" the
  asymmetry with its `publicListed` sibling). `StaffPositionEntry` widened
  with `publicDisplayOrder: number | null`, threaded into `listStaffRoster()`'s
  existing select (additive field, same query).
- `src/lib/officers.ts` — same shape: `setOfficerTermPublicDisplayOrder(
  viewerPersonId, organizationId, input: { termId, publicDisplayOrder })`,
  gated by `hasOfficersManage`, identical 4-step order minus the audit call.
  `OfficerRosterEntry` widened with `publicDisplayOrder`, threaded into
  `listOfficerRoster()`'s existing raw-SQL roster query (`ot.public_display_
  order as public_display_order`).
- `src/lib/groups.ts` — added `AUDIT_ACTIONS`/`recordAudit` import (the
  FIRST audited call this module has ever had — flagged at length in the
  file's own header, matching `staff.ts`'s/`officers.ts`'s identical
  divergence for their `setXPublicListed()` siblings). New exports:
  `setGroupMembershipPublicListed(viewerPersonId, organizationId,
  actingUserId, input: { groupMembershipId, publicListed })` — 4-parameter
  shape (matching `setStaffPositionPublicListed`'s own shape, since this one
  DOES track `publicListedBy`/`publicListedAt` and DOES call `recordAudit()`)
  — and `setGroupMembershipPublicDisplayOrder(viewerPersonId, organizationId,
  input: { groupMembershipId, publicDisplayOrder })` — 3-parameter shape, no
  audit. Both re-load the row scoped to `(id, organizationId, source =
  'managed')` before mutating — `invalid_target` if missing OR the row
  belongs to a derived group, exactly mirroring `endGroupMembership`'s own
  discipline (Phase 1 Flow 2's load-bearing guard: a Session/Diaconate row
  must never become independently publicly-listable through this mutation).
  `GroupRosterEntry` widened with `publicListed`/`publicDisplayOrder`,
  threaded into `getGroup()`'s existing raw-SQL roster query.
- `src/lib/audit.ts` — added `GROUP_MEMBERSHIP_LISTED_PUBLICLY`/
  `GROUP_MEMBERSHIP_UNLISTED_PUBLICLY` (values `group_membership.
  listed_publicly`/`unlisted_publicly`), with a doc comment naming the
  `admin/groups/actions.ts`-divergence reasoning inline, matching
  `STAFF_POSITION_LISTED_PUBLICLY`'s own comment block's shape.
- `src/lib/audit.test.ts` — added the two new keys to `EXPECTED_ENTRIES`
  (the drift-regression fixture); `EXPECTED_COUNT` is derived, no separate
  count edit needed.
- `src/app/(org)/o/[slug]/admin/staff/actions.ts` — added
  `setStaffPositionPublicDisplayOrderAction(slug, input)`, thin wrapper, no
  `recordAudit()` call (matches the mutation's own no-audit ruling).
- `src/app/(org)/o/[slug]/admin/officers/actions.ts` — added
  `setOfficerTermPublicDisplayOrderAction(slug, input)`, same shape.
- `src/app/(org)/o/[slug]/admin/groups/actions.ts` — `resolveActingIdentity()`
  widened to also resolve `userId` (a `users.id`, from `session.user.id`) —
  needed as `setGroupMembershipPublicListed`'s `actingUserId` parameter,
  matching `admin/staff/actions.ts`'s/`admin/officers/actions.ts`'s own
  identical shape; every pre-existing caller in this file ignores the new
  field, so this is additive, not breaking. Added
  `setGroupMembershipPublicListedAction(slug, input: SetGroupMembership
  PublicListedInput & { groupId })` and
  `setGroupMembershipPublicDisplayOrderAction(slug, input: SetGroupMembership
  PublicDisplayOrderInput & { groupId })` — the `groupId` extra field is
  caller-supplied (the group detail page, which already fetched `getGroup()`)
  purely for `revalidatePath`, mirroring `endGroupMembershipAction`'s
  identical shape. Neither new action calls `recordAudit()` itself — a
  deliberate divergence from this file's own "actions.ts calls
  recordAudit()" convention for its other four mutations, named explicitly
  in the file's own header comment.

### API Contract Delivered

```ts
// src/lib/staff.ts
export async function setStaffPositionPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { positionId: string; publicDisplayOrder: number | null },
): Promise<StaffResult<{ positionId: string; publicDisplayOrder: number | null }>>
```

```ts
// src/lib/officers.ts
export async function setOfficerTermPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { termId: string; publicDisplayOrder: number | null },
): Promise<OfficersResult<{ termId: string; publicDisplayOrder: number | null }>>
```

```ts
// src/lib/groups.ts
export async function setGroupMembershipPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { groupMembershipId: string; publicListed: boolean },
): Promise<GroupsResult<{ groupMembershipId: string; publicListed: boolean }>>

export async function setGroupMembershipPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: { groupMembershipId: string; publicDisplayOrder: number | null },
): Promise<GroupsResult<{ groupMembershipId: string; publicDisplayOrder: number | null }>>
```

Server actions (all `'use server'`, re-resolving `organizationId`/`personId`
via each file's own `resolveActingIdentity()` — never client-supplied):

```ts
// src/app/(org)/o/[slug]/admin/staff/actions.ts
export async function setStaffPositionPublicDisplayOrderAction(
  slug: string,
  input: { positionId: string; publicDisplayOrder: number | null },
): Promise<ActionResult<{ positionId: string; publicDisplayOrder: number | null }>>
```

```ts
// src/app/(org)/o/[slug]/admin/officers/actions.ts
export async function setOfficerTermPublicDisplayOrderAction(
  slug: string,
  input: { termId: string; publicDisplayOrder: number | null },
): Promise<ActionResult<{ termId: string; publicDisplayOrder: number | null }>>
```

```ts
// src/app/(org)/o/[slug]/admin/groups/actions.ts
export async function setGroupMembershipPublicListedAction(
  slug: string,
  input: { groupMembershipId: string; publicListed: boolean; groupId: string },
): Promise<ActionResult<{ groupMembershipId: string; publicListed: boolean }>>

export async function setGroupMembershipPublicDisplayOrderAction(
  slug: string,
  input: { groupMembershipId: string; publicDisplayOrder: number | null; groupId: string },
): Promise<ActionResult<{ groupMembershipId: string; publicDisplayOrder: number | null }>>
```

**Auth/permission gate per entry point:**

| Entry point | Permission |
|---|---|
| `setStaffPositionPublicDisplayOrder()`/`Action` | `staff.manage` |
| `setOfficerTermPublicDisplayOrder()`/`Action` | `officers.manage` |
| `setGroupMembershipPublicListed()`/`Action` | `groups.manage` |
| `setGroupMembershipPublicDisplayOrder()`/`Action` | `groups.manage` |

### Audit Events

`GROUP_MEMBERSHIP_LISTED_PUBLICLY`/`GROUP_MEMBERSHIP_UNLISTED_PUBLICLY`,
called from inside `src/lib/groups.ts`'s `setGroupMembershipPublicListed()`
(never from `actions.ts`), metadata `{ organizationId, publicListed }`,
resource type `group_membership`, resource id the group-membership id. Fires
on every call in both directions. **None** of the three `*PublicDisplayOrder`
mutations call `recordAudit()` at all, per Phase 3's own explicit ruling
(presentation-order only, not a disclosure fact).

**`check:audit` tripwire-coverage finding — confirmed, matches the shipped
precedent exactly, extended to `groups.ts`:** `npm run check:audit` passes
(`node scripts/check-audit-coverage.mjs` reports "Audit-coverage check
passed"), but this is **not evidence of coverage** for
`setGroupMembershipPublicListed()`'s `recordAudit()` call — the script only
walks `src/app/**/actions.ts` files looking for a literal
`db.insert|update|delete` in that same file; the actual `tx.update(
groupMemberships, ...)` and `recordAudit()` calls both live in `src/lib/
groups.ts`, a file the script never visits, and `admin/groups/actions.ts`'s
own wrapper calls no `db.*` method directly either. The only real proof of
coverage is `groups.test.ts`'s own `mockRecordAudit` assertions (both
directions, confirmed passing against the real dev database — see
Verification below), documented in `groups.ts`'s own doc comment so a future
reader doesn't mistake the green tripwire run for coverage of this call
site.

### Tests Written

All run against the real dev database (`dotenv -e .env.local -- vitest run
...`), following each target file's own established harness:

- `src/lib/staff.test.ts` — new `describe("setStaffPositionPublicDisplayOrder")`:
  `invalid_target` (missing id, cross-org id), `forbidden` (nothing written),
  `invalid_input` for negative/non-integer/beyond-int4-bound values, and a
  happy path that sets a value then clears it back to `null` with an
  explicit `null` — asserting `recordAudit` is **never** called on any branch.
- `src/lib/officers.test.ts` — identical shape,
  `describe("setOfficerTermPublicDisplayOrder")`. Uses a dedicated,
  unused-elsewhere office/date range (`clerk_of_session`, `2030-xx-xx`) to
  avoid the `officer_terms_no_overlap` exclusion constraint colliding with
  `targetPerson`'s many OTHER terms across this file's other describe
  blocks — ends each term immediately after use.
- `src/lib/groups.test.ts` — new `vi.mock("@/lib/audit", ...)` at the file's
  own top level (the first time this file has ever needed one — `setGroup
  MembershipPublicListed()` is the first audited call `groups.ts` has ever
  had). New assertions in the existing "permission gate" describe block
  (`forbidden`, no audit); two new tests in the existing "derived-group
  guard" describe block proving BOTH new mutations refuse a `source =
  'derived'` row (`invalid_target`, no audit, nothing written) — the
  load-bearing guard Phase 1 Flow 2 named; new
  `describe("setGroupMembershipPublicListed")` (`invalid_target` for
  missing/cross-org ids, ON-then-OFF happy path asserting
  `publicListed`/`publicListedBy`/`publicListedAt` and both
  `recordAudit` calls) and `describe("setGroupMembershipPublicDisplayOrder")`
  (bounds validation, set/clear, never audited). Three tests carry an
  explicit `it(name, fn, 15000|20000)` timeout — each makes 8–10 sequential
  real-Postgres round trips per test, comfortably under the default 5000ms
  in isolation but observed to exceed it under this repo's own documented
  shared-dev-DB contention when many DB-backed suites run back-to-back
  (verified: re-running the affected files in isolation is consistently
  fast and green — see Verification below).
- `src/app/(org)/o/[slug]/admin/staff/actions.test.ts` — extended the
  file's existing REAL-Postgres harness with a new
  `describe("setStaffPositionPublicDisplayOrderAction")`: `forbidden`,
  `invalid_target`, `invalid_input` surfaced verbatim, and a set-then-clear
  happy path against a real position.
- `src/app/(org)/o/[slug]/admin/officers/actions.test.ts` — extended the
  file's existing MOCKED harness with
  `describe("setOfficerTermPublicDisplayOrderAction — OfficersResult →
  ActionResult mapping")`: identity/argument-passing (no `actingUserId`
  argument — this mutation takes none), `forbidden`/`invalid_target`/
  `invalid_input`/`ok` mapping, and an explicit assertion that `recordAudit`
  is called **zero** times on the `ok` path.
- `src/app/(org)/o/[slug]/admin/groups/actions.test.ts` — extended the
  file's existing MOCKED harness with
  `describe("setGroupMembershipPublicListedAction — ...")` (asserts
  `actingUserId` IS passed through, unlike its `PublicDisplayOrder` sibling)
  and `describe("setGroupMembershipPublicDisplayOrderAction — ...")`
  — both assert `recordAudit` is called **zero** times from the action
  itself, the DIVERGENCE from this file's other four actions.

### Verification Performed

1. **`npm run typecheck`** — PASS, clean.
2. **Targeted test files, real dev database, run individually** (each
   passes cleanly and quickly in isolation — the authoritative verification
   evidence, per the note above about shared-dev-DB contention under
   concurrent multi-file runs):
   - `src/lib/staff.test.ts`: 33/33 passed.
   - `src/lib/officers.test.ts`: 33/33 passed.
   - `src/lib/groups.test.ts`: 42/42 passed.
   - `src/lib/audit.test.ts`: 15/15 passed (no DB needed).
   - `admin/staff/actions.test.ts` (real DB): 9/9 passed.
   - `admin/officers/actions.test.ts` + `admin/groups/actions.test.ts`
     (mocked, no DB): 53/53 passed.
3. **`npm test`** (full suite, no `.env.local`, matches CI): 240 files
   passed, 26 skipped (DB-gated), 3122 passed, 655 skipped, 0 failed.
4. **`npm run check`** (all four tripwires) — all pass. `check:audit`'s
   pass is explicitly NOT relied on as coverage evidence for the
   `groups.ts` mutation — see the Audit Events section above.
5. **Multi-file concurrent DB runs are genuinely flaky on this shared dev
   database — confirmed, not assumed, and not a defect in this step's own
   code.** Running all eight DB-backed files together (default parallelism)
   intermittently produced: (a) a `group_memberships_reject_derived`-trigger
   race during org-cascade teardown (two files' own `ALTER TABLE ... DISABLE
   TRIGGER`/`ENABLE TRIGGER` windows overlapping on the SAME shared table —
   a pre-existing hazard of every file's own per-file disable/enable
   convention, not new here), and (b) on a later run, widespread `Hook timed
   out`/`Test timed out` failures on tests and hooks this step never
   touched (e.g. `officers.test.ts`'s own pre-existing top-level `afterAll`,
   `sites.test.ts`'s own pre-existing `beforeAll`, and a pre-existing
   `listGroups` throw test) — confirming general Neon connection/latency
   contention from many concurrent DB-heavy suites, not a regression this
   step introduced. Re-running every affected file in isolation afterward
   was consistently fast and 100% green (see item 2). Not logged as a new
   `docs/TODO.md` line — this is the same category of shared-dev-DB
   contention already tracked there from prior pipelines, not a new
   instance worth a separate entry.

### Implementer Notes

- Followed the Phase 3 API Contract's exact function signatures, including
  the 3-parameter (no `actingUserId`) shape for all three
  `*PublicDisplayOrder` mutations and the 4-parameter shape for
  `setGroupMembershipPublicListed` — confirmed by re-reading Phase 3's own
  code blocks rather than the task's own paraphrase, which had implied a
  4-parameter shape for `setStaffPositionPublicDisplayOrder`; the work-log's
  actual API Contract section is unambiguous and was followed literally.
- `groups.ts`'s two new mutations reuse the SAME `MAX_PUBLIC_DISPLAY_ORDER`
  bound and `Number.isInteger`/range validation shape `staff.ts`/`officers.ts`
  each define independently (a small, duplicated constant per file, matching
  this codebase's own per-domain-file convention rather than introducing a
  shared cross-file utility for six lines of logic).
- No divergence from Phase 3's derived-group guard shape:
  `setGroupMembershipPublicListed`/`setGroupMembershipPublicDisplayOrder`
  both re-load scoped to `source = 'managed'`, matching `endGroupMembership`'s
  own discipline exactly, confirmed by a dedicated regression test inserting
  a real `source = 'derived'` row directly (bypassing the application layer
  entirely, the same "prove the read-side filter" technique
  `groups.test.ts`'s own pre-existing derived-group-guard suite uses).
- **Next implementer (api-developer, step 3, this same repo):** nothing in
  this step blocks step 3 — `getPublicStaffRoster()`/`getPublicCommitteeRoster()`
  can be written against real, tested `presby_public_staff_roster()`/
  `presby_public_committee_roster()` SQL functions (already live per step 1)
  independent of this step's own admin-mutation work.

## Step 3 — Public read (api-developer, this repo)

**Date:** 2026-08-28

### Files Modified

- `src/lib/sites.ts` — this file's own "COMMIT 6 ADDITION" (per its header
  convention). `getPublicStaffRoster()` widened with an optional second
  `filter?: PublicStaffRosterFilter` parameter (`kind`/`department`/
  `office`/`hasPriority`) — existing zero-arg call sites unaffected
  (confirmed by a dedicated regression test). `filter.kind`/`filter.
  hasPriority` are passed as SQL parameters to the widened
  `presby_public_staff_roster(text, text, boolean)`; `filter.department`/
  `filter.office` are matched in TypeScript, AFTER the SQL read, via the new
  shared `normalizeFilterText()` helper (trim + lowercase) — per Phase 3's
  own DECISION-131-forced split (office LABELS live in exactly one place,
  `OFFICE_LABELS`, and the SQL function must not grow a second copy as a
  `CASE`). Confirmed the function's existing whole-body `try { … } catch {
  return []; }` wrapper (the shipped precedent's own same-day Phase 6
  bug-fix) was ALREADY present before this step touched the file — not
  re-added, just preserved and re-verified intact after the filter
  widening. Added `getPublicCommitteeRoster(slug, filter?:
  PublicCommitteeRosterFilter): Promise<PublicCommitteeRosterEntry[]>` — a
  SIBLING function, not a widening of the staff/officer union, reading
  through the new `presby_public_committee_roster()`. Its entire body is
  ALSO one `try { … } catch { return []; }` **from day one** — the exact gap
  Phase 1/2/3 all flagged the shipped precedent had to close as a same-day
  bug-fix, not repeated here.
- `scripts/seed.ts` — added the `sites.public_committee_directory` flag row
  (seeded `false`), placed immediately after `sites.public_staff_directory`'s
  own entry, matching that entry's comment style and the `sites.*` namespace
  ruling from Phase 3.

### API Contract Delivered

```ts
// src/lib/sites.ts
export interface PublicStaffRosterFilter {
  kind?: "staff" | "officer";
  department?: string;
  office?: string;
  hasPriority?: boolean;
}

// SIGNATURE CHANGE: gains an optional second parameter. Every existing
// zero-arg call site is unaffected — filter defaults to "no filter,"
// today's exact behavior.
export async function getPublicStaffRoster(
  slug: string,
  filter?: PublicStaffRosterFilter,
): Promise<PublicStaffRosterEntry[]>
```

```ts
// src/lib/sites.ts — NEW
export interface PublicCommitteeRosterFilter {
  committee?: string;
  hasPriority?: boolean;
}

export interface PublicCommitteeRosterEntry {
  groupName: string;
  groupRole: "chair" | "leader" | "member";
  displayName: string;
  photoKey: string | null;
}

export async function getPublicCommitteeRoster(
  slug: string,
  filter?: PublicCommitteeRosterFilter,
): Promise<PublicCommitteeRosterEntry[]>
```

**Auth/gate:** both functions are anonymous — no `auth()`, no permission.
`getPublicStaffRoster()` gated by `sites.public_staff_directory` (unchanged
key/posture); `getPublicCommitteeRoster()` gated by the NEW
`sites.public_committee_directory` (separate flag, seeded off, per Phase
2/3's explicit ruling that committees are a different rollout concern).
Both checked bare — not an auth path, fail-closed-to-empty during a DB blip
or flag-off is correct.

### Audit Events

None — anonymous reads write no audit event, unchanged posture from the
shipped precedent's own `getPublicStaffRoster()`.

### Tests Written

`src/lib/sites.test.ts`, real dev database, extending the existing
`describe("getPublicStaffRoster")` fixture (added one more fixture row —
`priorityOfficerPersonId`, `publicDisplayOrder: 1` — for the `hasPriority`
filter test) and adding a new `describe("getPublicCommitteeRoster")` with
its own self-contained fixture (two managed committees, a derived "Session"
group inserted directly with `public_listed: true` to prove the SQL
function's own `g.membership_source = 'managed'` defense-in-depth clause —
not merely that the application layer refuses to write one):

- `filter.kind` narrows to just staff or just officer rows.
- `filter.hasPriority` narrows to only rows with an explicit
  `publicDisplayOrder`, and orders them first.
- `filter.department` is case-insensitive/trim matched, never matches an
  officer row, and a non-matching value returns `[]`.
- `filter.office` matches EITHER the raw enum value OR its `OFFICE_LABELS`
  display string, case-insensitive/trim, and never matches a staff row
  (including a staff row whose OWN department string happens to equal the
  office needle).
- The zero-arg call site is unaffected by the widening.
- `getPublicCommitteeRoster`: flag off → `[]`; flag on, no filter → every
  currently-public committee's rows in one flat list, each tagged with its
  own `groupName`, excluding the not-opted-in row AND the derived Session
  row (inserted with `public_listed: true` directly, proving the SQL-layer
  guard); ordering within one committee is
  `coalesce(public_display_order, MAX), display_name`; `filter.committee`
  narrows to one committee, case-insensitive/trim; `filter.hasPriority`
  narrows to the one curated row; a suspended org's rows never surface; a
  nonexistent slug returns `[]`; **a transient DB error degrades to `[]`
  rather than throwing** — the fail-closed wrapper confirmed present from
  day one, not a same-day bug-fix.

### Verification Performed

1. **`npm run typecheck`** — PASS, clean.
2. **`src/lib/sites.test.ts`, real dev database, run in isolation:**
   77/77 passed.
3. **`npm test`** (full suite): included in the 3122-passed total reported
   under Step 2's own Verification section above (both steps' test changes
   were verified together in the same final full-suite run).
4. **`npm run check`** — all four tripwires pass (no audited mutation in
   this step at all, so no tripwire-blindness finding applies here).

### Fail-closed-wrapper confirmation (explicit, per this pipeline's own
named risk)

Both public-read functions' ENTIRE bodies are one `try { … } catch { return
[]; }`, confirmed by direct re-read of the current file, not assumed:

- `getPublicStaffRoster()` — the wrapper was **already present** before this
  step (the shipped precedent's own same-day Phase 6 bug-fix addendum had
  already landed it); this step's filter-widening code was added entirely
  INSIDE the existing `try` block, and the wrapper's presence was
  independently re-verified (not just trusted from the doc comment) via a
  dedicated "a transient DB error degrades to `[]`" test that still passes
  after the widening.
- `getPublicCommitteeRoster()` — wrapped from the FIRST line of its
  implementation, never shipped without it — verified by the identical
  transient-DB-error test in its own describe block.

### Implementer Notes

- `department`/`office` filter matching required a new shared
  `normalizeFilterText()` helper (trim + lowercase) in `src/lib/sites.ts`'s
  own "Shared helpers" section — reuses the exact normalization
  `staff_positions.position_key` already applies at write time, applied here
  at the filter-match side instead, per Phase 3's own instruction that one
  normalization function should serve both fields rather than splitting
  free-text matching across two layers by field.
- No divergence from Phase 3's SQL-parameter-passing shape: `sql` tagged
  templates pass `filter?.kind ?? null`/`filter?.hasPriority ?? null`/
  `filter?.committee ?? null` directly as bind parameters — Drizzle's `sql`
  helper handles the `string | null`/`boolean | null` typing without a cast.
- **Next implementer (ux-developer, step 5):** `getPublicStaffRoster()`'s
  filter widening and `getPublicCommitteeRoster()` are both live and tested
  against real SQL functions. Nothing in this step touched `page.tsx`, the
  `liveSlots` wiring, or either render component (`staff-directory.tsx`,
  the new `committee-directory.tsx`) — those remain step 5's own scope,
  now unblocked (step 4's `presby-site-kit` v4.0.0 tag is confirmed live
  and installable, per Step 4's own section above).

## Step 5 — Render components + wiring (ux-developer, this repo)

**Date:** 2026-08-28

### `presby-site-kit` v4.0.0 install (step 5's own step 1, per the task)

Bumped `package.json`'s `presby-site-kit` pin from `#v3.6.0` to `#v4.0.0`.
**A bare `npm install` after that edit did NOT re-resolve the git ref** —
`package-lock.json`'s `node_modules/presby-site-kit.resolved` came back
pinned to commit `a7cd226` (the `v3.6.0` tag's own commit, confirmed via
`git ls-remote --tags`), not `8ca982a` (`v4.0.0`'s dereferenced commit) —
reproducing the exact stale-git-dependency-cache failure the shipped
precedent's own Phase 4 step 4 flagged verbatim. Fixed by `rm -rf
node_modules/presby-site-kit && npm cache clean --force && npm install
presby-site-kit@github:chenson42/presby-site-kit#v4.0.0` — this time
`package-lock.json` resolved to `8ca982a` correctly. Verified, not assumed:
`node_modules/presby-site-kit/package.json` reports `"version": "4.0.0"`,
and `node_modules/presby-site-kit/dist/index.d.ts` contains both
`liveSlots?: Record<string, (filter: Record<string, unknown>) =>
ReactElement | null>;` and `export { PersonCard } from
"./components/PersonCard";` before any code in this step was written
against them.

### Files Modified

- `package.json` — `presby-site-kit` pin `#v3.6.0` → `#v4.0.0`.
- `package-lock.json` — re-resolved lockfile entry (commit `8ca982a`).
- `src/app/(public)/site/[slug]/staff-directory.tsx` — `PublicStaffDirectory`
  gains a required `filter: Record<string, unknown>` prop, narrowed through
  a new local `parseStaffRosterFilter()` (checks each key's exact
  `typeof`/value, silently drops anything malformed) before being passed to
  the now-widened `getPublicStaffRoster(slug, filter)`. Render mechanism is
  UNCHANGED — still `<StaffList people={...} />`, per Phase 3's own ruling
  that `PersonCard` is for the committee grid's grouped-sections case, not a
  `StaffList` replacement.
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — `liveSlots` object
  literal converted from `{ staffDirectory: <PublicStaffDirectory
  slug={slug} /> }` (a pre-built element) to
  `{ staffDirectory: (filter) => <PublicStaffDirectory slug={slug}
  filter={filter} />, committeeDirectory: (filter) =>
  <PublicCommitteeDirectory slug={slug} filter={filter} /> }` (resolver
  closures). **Redline check performed by direct grep, per Phase 2's own
  instruction**: `grep -n "searchParams\|headers()\|cookies()"` across this
  file, `staff-directory.tsx`, `committee-directory.tsx`, and `src/lib/
  sites.ts` returns exactly one hit — the code comment describing the
  redline itself, not a violation. Both closures close over `slug` only.

### Files Created

- `src/app/(public)/site/[slug]/committee-directory.tsx` —
  `PublicCommitteeDirectory({ slug, filter })`, per Phase 3's API Contract.
  Calls `getPublicCommitteeRoster(slug, parseCommitteeRosterFilter(filter))`,
  groups the flat, already-`group_name`-clustered result into one
  `<section><h2>{groupName}</h2>...</section>` per committee in a single
  sequential bucketing pass (never a re-sort), and renders each member via
  `presby-site-kit`'s `PersonCard`. **One divergence from Phase 3's own
  Design Decision 2 prose, noted explicitly, not silently**: Design Decision
  2's narrative said a single-committee filter result "renders one section
  with no heading needed"; the API Contract's own literal code block
  (`<section><h2>{groupName}</h2>...`) renders the heading unconditionally,
  for every group, including a single-committee result. Followed the
  literal code block — one render path for both cases (no special-cased
  headless branch), verified in a real browser (see below) that a redundant
  heading on a single-committee page reads fine, not as a defect.
  Explicit empty-state branch ("No committees have been listed here yet.")
  — never a silent delegation to something that returns `null`. `PersonCard`
  is styled entirely through its own `className`/`headingClassName` props
  (a `PERSON_CARD_CLASSNAME` constant using the same `repeat(auto-fit,
  minmax(15rem,1fr))` card-grid treatment `presby-site-kit`'s own stylesheet
  already applies to `StaffList`/`FeatureGrid`/etc.) — `PersonCard` ships
  with **no CSS of its own** in v4.0.0, confirmed by grep against
  `node_modules/presby-site-kit/dist/styles.css` (zero `[data-block="person-
  card"]` rules), so this component's own mobile pass had nothing existing
  to inherit and had to be verified from scratch (see Real-Browser
  Verification below).
- `src/app/(public)/site/[slug]/committee-directory.test.tsx` — new,
  matching `staff-directory.test.tsx`'s own conventions: empty-state branch
  (including a filter narrowing to zero rows); grouping (both the
  all-committees case and a single-committee filter result, confirmed to
  render through the identical code path); `groupRole` → subtitle mapping
  (chair/leader get one, member gets none); `photoUrl` construction and
  graceful no-photo degradation; field-scope (no `mailto:`/phone anywhere);
  `parseCommitteeRosterFilter()`'s own narrowing (well-formed passthrough,
  malformed-value drop, empty-object no-op).

### API Contract Delivered

Matches Phase 3's own code blocks verbatim — no signature drift:

```ts
// src/app/(public)/site/[slug]/staff-directory.tsx
export async function PublicStaffDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
})
```

```ts
// src/app/(public)/site/[slug]/committee-directory.tsx — NEW
export async function PublicCommitteeDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
})
```

### Tests Written / Updated

- `src/app/(public)/site/[slug]/staff-directory.test.tsx` — existing tests
  updated to pass `filter: {}` (the prop is now required); three new tests
  for `parseStaffRosterFilter()` (well-formed passthrough, malformed-value
  drop, empty-object no-op) and one new test confirming a filter that
  narrows to zero rows still renders the explicit empty-state branch, not a
  different one.
- `src/app/(public)/site/[slug]/committee-directory.test.tsx` — new, per
  above.
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — the existing
  assertion that `renderSiteBundle()` receives "a truthy
  `liveSlots.staffDirectory` element" is now checking a FUNCTION, not an
  element. Per the task's own explicit instruction, this was NOT left as a
  truthy-function check (which would pass even if the resolver ignored its
  `filter` argument or closed over the wrong `slug`) — rewritten to call
  each resolver with a specific `filter` object and assert on the RESOLVED
  OUTPUT's `type` (`=== PublicStaffDirectory` / `=== PublicCommitteeDirectory`,
  by reference) and `props` (`{ slug: "alder-creek", filter: <the exact
  object passed in> }`, by deep equality). Rendering the resolved element
  directly via RTL was considered and rejected: `renderSiteBundle`/
  `presby-site-kit` are mocked at this file's own module boundary (so
  `PersonCard`/`StaffList` are `undefined` inside this test's module graph),
  and `PublicStaffDirectory`/`PublicCommitteeDirectory` are real async
  Server Components RTL's plain `render()` cannot resolve outside Next's own
  RSC pipeline — the `.type`/`.props` identity check proves the closure
  built the right element with the right data without needing to execute
  either component's body, which is exactly what this assertion needs to
  prove and no more. Added one more test confirming a marker with no
  `filter` key resolves to `{}` (backward compatibility, no content-repo
  migration required) and one confirming `liveSlots` exposes exactly
  `staffDirectory`/`committeeDirectory`, nothing else.

### Verification Performed

1. **`npm run typecheck`** — PASS, clean.
2. **Targeted test files**: `staff-directory.test.tsx` (13/13),
   `committee-directory.test.tsx` (13/13), `[[...path]]/page.test.tsx`
   (19/19) — all passing, run together: 45/45.
3. **`npm test`** (full suite): 245 files passed, 26 skipped (DB-gated),
   3175 passed, 655 skipped, 0 failed.
4. **`npm run build`** — clean production build, `/site/[slug]/[[...path]]`
   present as a dynamic (`ƒ`) route, unchanged classification.
5. **`npm run check`** — all four tripwires pass.
6. **`npm run lint`** — same pre-existing errors/warnings this session's
   other steps already documented (`portal-nav-links.tsx`,
   `admin/roles/*` — both unrelated to this pipeline); confirmed by grep
   that zero lint findings land in any file this step touched.

### Real-Browser Verification (Workflow Rule: "Verify in a Browser")

**Done — Playwright driven directly via a throwaway Node script through the
Bash tool**, mirroring the shipped precedent's own "capture original state →
mutate directly via `neon()` against `PLATFORM_DATABASE_URL` → screenshot →
restore → confirm by direct query" discipline
(`e2e/public-sites.spec.ts`'s own `stageLiveBundle()` pattern). The script
was NOT committed (scratch-only, lived in the session's scratchpad
directory). A dev server was already running on port 3000 (confirmed to be
this repo's own `next-server`, not a stray process) — reused rather than
started fresh, since Turbopack hot-reloads picked up every file this step
touched automatically.

**Fixtures staged** (all at Alder Creek, all reverted): Marisol Windham's
`staff_positions` row (Church Secretary) and Tobias Renwick's `officer_terms`
row (Clerk of Session, `public_display_order = 1`) and Priya Balakrishnan's
`officer_terms` row (Treasurer) set `public_listed = true`; two new
`group_memberships` rows in the EXISTING, previously-empty managed "Property
Committee" group (Priya as chair/priority-1, Marisol as member); one
temporary new managed group "Missions Committee" with Tobias as leader; a
live content bundle (`organization_sites.status = 'live'`, a new
`blob_assets` row) with five pages exercising every filter shape: `/staff`
(`{"slot":"staffDirectory"}`, no filter — backward compatibility),
`/leadership` (`{"slot":"staffDirectory","filter":{"kind":"officer",
"hasPriority":true}}` — the curated case), `/committees`
(`{"slot":"committeeDirectory"}` — all committees), `/committees/missions`
(`{"slot":"committeeDirectory","filter":{"committee":"Missions
Committee"}}` — one committee). `sites.public_staff_directory`/
`sites.public_committee_directory` were already `true` in the shared dev
database (pre-existing state, unchanged by this verification).

**What was exercised, for real, in a real browser, at 1280px desktop, 390px,
and 360px:**

1. `/site/alder-creek/staff` (no filter) — rendered all three currently-
   public people (Tobias Renwick/Clerk of Session, Marisol Windham/Church
   Secretary, Priya Balakrishnan/Treasurer) via the real, unmodified
   `StaffList` component — confirms the shipped feature's own
   `staffDirectory` marker with no filter still renders correctly, byte-for-
   byte the same mechanism as before this pipeline.
2. `/site/alder-creek/leadership` (`{kind: "officer", hasPriority: true}`)
   — narrowed to exactly Tobias Renwick, proving the SQL-parameter filter
   path end-to-end (opt-in bit + priority → `presby_public_staff_roster()`
   → `getPublicStaffRoster()` → `parseStaffRosterFilter()` →
   `PublicStaffDirectory` → the resolver closure → `StaffList`).
3. `/site/alder-creek/committees` (no filter) — two `<h2>` sections
   ("Missions Committee", "Property Committee"), each with real `PersonCard`
   renders: Tobias under Missions (title "Leader"), Priya under Property
   (title "Chair"), Marisol under Property with NO subtitle at all
   (confirms the `member` → no-title mapping). No photo on any card (no
   `photo_key` in this fixture) — degraded gracefully, no broken `<img>`.
4. `/site/alder-creek/committees/missions` (`{committee: "Missions
   Committee"}`) — narrowed to exactly the Missions Committee section,
   Property Committee's members entirely absent.
5. **`PersonCard`'s own mobile pass, net-new, explicitly required** — at
   360px and 390px, the auto-fit card grid collapsed to a single column,
   each card's border/padding/centered layout intact, no overflow or text
   clipping, name and role both fully legible. No existing CSS covered this
   shape before this verification; confirmed clean from scratch.
6. **Admin UI — `admin/staff`, `admin/officers`, `admin/groups/<Property
   Committee id>`**, signed in as `elder.fixture@example.invalid`
   (Marguerite Ashcombe), after temporarily granting her `stated_clerk`
   (`officers.manage` + `groups.manage`) and `personnel_admin`
   (`staff.manage`) via real `role_grants` inserts (she held neither
   before — confirmed by direct query), and temporarily disabling
   `auth.require_2fa` (Alder Creek's own `organization_settings.
   require_two_factor = true` forces even a `two_factor_required: false`
   user through the 2FA gate — the identical, already-documented workaround
   `e2e/public-sites.spec.ts`'s own header explains).
   - **Desktop (1280px)**: `admin/staff`'s new "Display order" column
     renders correctly alongside the existing "Public listing" column,
     showing an empty (em-dash-placeholder) input for Marisol's row.
     `admin/officers` shows "1" in Tobias's row (matching the staged
     priority) and empty inputs for the other rows, both "Public" badges
     present on the two staged-public rows. `admin/groups/<Property
     Committee>` — the entirely NEW "Public listing"/"Display order"
     columns on a page that had neither before this pipeline — shows
     Priya's row with "Public" + "1", Marisol's row with "Public" + empty,
     both existing "End membership" actions unaffected.
   - **Mobile (390px, 360px), RE-VERIFIED per the task's own instruction**:
     on `admin/staff` and `admin/officers`, the layout is IDENTICAL to
     before this pipeline's own column addition — Position/Office, Person,
     Since, Ends, and "End position"/"End term" all reach the same visible
     frame as the shipped precedent's own real-browser-verified baseline,
     because both `Public listing` AND the new `Display order` column are
     hidden below `sm:`. On `admin/groups/<Property Committee>` — the
     newest of the three surfaces — Person/Ends/"End membership" are FULLY
     visible with no clipping at all at either width (even cleaner than the
     staff/officers pages' own pre-existing, unrelated "End..." partial-clip,
     since this page's always-visible column set is narrower to begin
     with), confirming the new columns joining the below-`sm:` set caused
     zero regression on a page that had never carried this control before.
7. **Every mutation reverted and confirmed reverted by direct query**,
   before this step ended: both temporary `role_grants` rows (deleted by
   their own specific ids, not by an aggregate-count assumption — Marguerite
   Ashcombe carries two OTHER, pre-existing, unrelated role grants at Alder
   Creek dated 2026-08-20/2026-08-26 that this verification correctly never
   touched); the temporary "Missions Committee" group and both new
   `group_memberships` rows (0 remaining, by exact id and by the
   Property Committee's own membership count); `staff_positions.
   public_listed`/`officer_terms.public_listed` for all three touched rows
   (confirmed back to `false`, `public_display_order` back to `null`);
   `organization_sites.status`/`content_bundle_key` (restored to the
   captured pre-existing `provisioning` status and this org's own
   pre-existing, unrelated leftover bundle key from an earlier session —
   untouched, not this step's data to clean up); the staged `blob_assets`
   row (deleted, confirmed 0 remaining); `auth.require_2fa` (restored to
   its captured original `true`). The first restore attempt's own
   assertion script had a bug (asserted an aggregate `role_grants` count of
   `0` for Marguerite, not realizing she already carried two unrelated
   grants) — caught immediately by the assertion itself failing loudly
   rather than silently passing, fixed to assert on the specific temporary
   grant ids instead, then re-verified clean. The dev server was left
   running (pre-existing, reused, not started by this step).

**Not done, named as such**: no new committed `e2e/*.spec.ts` file, same
judgment call the shipped precedent's own Phase 4 made and QA accepted —
real-DB unit/component coverage plus a documented, screenshot-backed
real-browser walkthrough substantively covers the same claims a new spec
would, and this feature touches no auth path (so CLAUDE.md's mandatory-e2e
clause doesn't apply). Screenshots (21 total: 4 public pages × 3 viewports,
3 admin pages × 3 viewports) live in the session's scratchpad, not
committed.

## Step 6 — Admin UI (ux-developer, this repo)

**Date:** 2026-08-28

### Files Created

- `src/app/(org)/o/[slug]/admin/staff/display-order-input.tsx` — a plain
  numeric `Input`, deliberately no `AlertDialog` (setting this only
  reorders people already public, per Phase 3's no-audit ruling — not a
  disclosure fact). Commits on blur or Enter, not per keystroke; an empty
  field commits `null` (not `0` or a validation error); a no-op blur (value
  unchanged) never calls the server action at all; client-side bounds
  validation (non-negative integer) rejects with `toast.error` and reverts
  the field without ever reaching the network.
- `src/app/(org)/o/[slug]/admin/staff/display-order-input.test.tsx` — new.
- `src/app/(org)/o/[slug]/admin/officers/display-order-input.tsx` — the
  `officer_terms` twin, duplicated rather than shared, matching
  `admin/staff`/`admin/officers`'s own existing `public-listing-toggle.tsx`
  per-domain-file convention.
- `src/app/(org)/o/[slug]/admin/officers/display-order-input.test.tsx` —
  new.
- `src/app/(org)/o/[slug]/admin/groups/display-order-input.tsx` — the
  `group_memberships` twin (`groupId` + `groupMembershipId` shape, matching
  `setGroupMembershipPublicDisplayOrderAction`'s own signature).
- `src/app/(org)/o/[slug]/admin/groups/display-order-input.test.tsx` — new.
- `src/app/(org)/o/[slug]/admin/groups/public-listing-toggle.tsx` — the
  NET-NEW `group_memberships` twin of `admin/staff`/`admin/officers`'s
  existing `PublicListingToggle` (`Switch` + `AlertDialog`, both directions
  confirmed, controlled by `pendingValue` so the switch's visible state
  never flips ahead of the mutation succeeding, `min-h-11 min-w-11`
  touch-target wrap). **Copied, not shared — a deliberate choice, not a
  missed opportunity**: Phase 3's own Component/Page Plan explicitly ruled
  this "a THIRD near-identical copy per this codebase's existing
  per-domain-file convention for these small structurally-similar dialogs
  ... not shared, matching `end-position-dialog.tsx`/`end-term-dialog.tsx`'s
  own precedent" — followed literally rather than re-litigated. A shared
  `groupId`+`membershipId`-shaped variant was considered (per the task's own
  prompt to check) and rejected for the identical reason Phase 3 gave for
  not sharing `PersonCard`/`StaffList` internals: the three call sites'
  prop shapes already diverge (`positionId`/`position` vs. `termId`/
  `officeLabel` vs. `groupMembershipId`/`groupId`/`groupName`), and this
  control additionally needs the `groupId` field its two siblings don't
  carry (for `revalidatePath`) — a shared component would need a prop
  union or a generic `Record<string, unknown>` bag, more indirection than
  the ~90 lines of duplication it would save, and would recouple three
  controls whose underlying mutations (`setStaffPositionPublicListed`/
  `setOfficerTermPublicListed`/`setGroupMembershipPublicListed`) are
  already three separate, independently-evolving functions.
- `src/app/(org)/o/[slug]/admin/groups/public-listing-toggle.test.tsx` —
  new, mirroring `admin/staff/public-listing-toggle.test.tsx`'s own
  coverage exactly (initial render, stage-without-flipping, cancel, confirm
  ON/OFF, denied result — including the derived-group `invalid_target`
  collapse the underlying mutation returns).

### Files Modified

- `src/app/(org)/o/[slug]/admin/staff/staff-roster.tsx` — new "Display
  order" column (`hidden sm:table-cell`, joining "Public listing" in that
  set), rendering `<DisplayOrderInput>` per row. Header comment extended
  with the re-verified 390px/360px finding (see Step 5's Real-Browser
  Verification above — no regression, both new columns stay below `sm:`).
- `src/app/(org)/o/[slug]/admin/officers/officer-roster.tsx` — same shape.
- `src/app/(org)/o/[slug]/admin/groups/[groupId]/page.tsx` — TWO new
  columns on a roster table that had NEITHER control before this pipeline:
  "Public listing" (`<PublicListingToggle>`) and "Display order"
  (`<DisplayOrderInput>`), both `hidden sm:table-cell`. **No derived-group
  guard needed in this component itself** — `getGroup()` (`src/lib/
  groups.ts`) already scopes its own query to `membership_source =
  'managed'`, so this page can never render a derived group's roster at
  all; the control renders unconditionally on every row here, with
  `setGroupMembershipPublicListed()`'s own re-load-scoped-to-`managed`
  check remaining the actual defense-in-depth layer (confirmed by direct
  read of `getGroup()`'s query, not assumed from the mutation's own
  header comment).

### Schema Changes

None — this step is pure render/UI, consuming columns/mutations/actions
step 1/2 already shipped.

### Audit Events

None newly wired by this step — `DisplayOrderInput`'s three variants call
`set*PublicDisplayOrderAction()`, which (per step 2) call no
`recordAudit()`. `PublicListingToggle` (groups) calls
`setGroupMembershipPublicListedAction()`, whose underlying
`setGroupMembershipPublicListed()` (step 2) already calls
`recordAudit()` — this step wires the CLIENT side of an already-audited
mutation, introduces no new audit surface.

### Tests Written

- Six new component test files (three `DisplayOrderInput` variants, one new
  `PublicListingToggle` variant), all listed under Files Created above.
  Every `DisplayOrderInput` variant's suite covers: initial render
  (blank when `null`, numeric when set), no-op blur (zero server calls),
  committing a change (parsed integer, `null` on empty, Enter same as
  blur — real `.focus()` called before `keyDown`, since jsdom's own
  `.blur()` is a no-op on an element that was never truly focused, a
  jsdom-harness detail rather than a UI bug), client-side validation
  (negative/non-integer rejected before the network, field reverted), and a
  denied server result (toast + revert). The groups `PublicListingToggle`
  suite mirrors `admin/staff`'s own file exactly, adapted to
  `groupId`/`groupMembershipId`/`groupName`, plus one test confirming a
  denied result surfaces the derived-group `invalid_target` collapse
  correctly.
- Existing `staff-roster.test.tsx`/`officer-roster.test.tsx`/
  `admin/groups/[groupId]/page.test.tsx` needed NO changes — none of them
  asserted on exact column count or exhaustive row content in a way the
  two new columns broke (confirmed by running them, not by inspection
  alone — all passed unmodified).

### Verification Performed

1. **`npm run typecheck`** — PASS, clean.
2. **Targeted test files** (6 new + 5 touched-but-unmodified roster/page
   tests): 87/87 passed.
3. **`npm test`** (full suite): 245 files passed, 26 skipped (DB-gated),
   3175 passed, 655 skipped, 0 failed — the same final count reported under
   Step 5's own Verification section (both steps' test changes verified
   together in the same final full-suite run).
4. **`npm run build`** — clean.
5. **`npm run check`** — all four tripwires pass.
6. **Real-browser verification** — see Step 5's own "Real-Browser
   Verification" section above; both steps' UI were exercised together in
   the same browser session (staff/officers Display-order columns, and the
   entirely new groups Public-listing/Display-order columns, all at
   1280px/390px/360px, both directions of the groups toggle including
   Cancel).

### Implementer Notes

- No native browser dialogs anywhere in this step's own new code — every
  confirmation surface is a shadcn `AlertDialog` (`PublicListingToggle`,
  groups) or a plain `Input` needing no confirmation at all
  (`DisplayOrderInput`, all three variants).
- No divergence from Phase 3's ruling that the groups toggle be a THIRD
  independent copy rather than a shared component — see Files Created
  above for the reasoning, re-derived from first principles rather than
  taken on faith from the design doc's own instruction.

### Handoff — next agent (qa, Phase 5)

All six Implementation Order steps are now complete. What a reviewer
should click through in the browser (no fixture setup required to see the
SHAPE of the UI, though the public pages will show empty states without
staged data): `/o/alder-creek/admin/staff` and `/admin/officers` for the
new "Display order" column; `/o/alder-creek/admin/groups/<any managed
group>` for the entirely new "Public listing"/"Display order" columns;
`/site/alder-creek` for the unfiltered `staffDirectory` marker (if the
org's content repo has one) — a filtered or committee-directory render
requires either a real content-repo marker with a `filter` key or the
same kind of throwaway DB staging this step's own verification used.

**New copy strings for a fork's branding pass**: "No committees have been
listed here yet." (committee-directory.tsx's empty state, parallel to the
shipped feature's "No one has been listed here yet."); "List {personName}
publicly on {groupName}'s roster?" / "Stop listing {personName} publicly on
{groupName}'s roster?" and their two description paragraphs
(public-listing-toggle.tsx, groups) — copied from the staff/officers
dialogs with "as {position/office}" replaced by "on {groupName}'s roster"
since a committee membership's "role" (chair/leader/member) reads
awkwardly in the same "as X" slot an office/position title fills; "Display
order must be a whole number, 0 or greater." (all three
`DisplayOrderInput` variants' client-side validation error). None of this
copy is organization-name-branded beyond what the existing staff/officers
dialogs already carry.

**UX tradeoffs**: "Display order" is `hidden sm:table-cell` on all three
surfaces, for the identical reason "Public listing" already is — an
admin on a phone cannot see or set a person's curation order without a
wider viewport, matching this feature's own cadence (occasional,
desk-adjacent, "per hire"/"per election"/"per committee assignment," never
a look-up-on-the-go action). Commit-on-blur (rather than a Save button) was
chosen over the alternative of a dedicated per-row "Save" action, matching
this codebase's own "commit at the natural pause point" convention
elsewhere — the tradeoff is that a value typed and then abandoned (tabbing
away without intending to change anything, but having changed the text)
commits anyway; judged acceptable since the field's own bounds validation
and the mutation's own idempotent "set this specific row to this specific
value" semantics make an accidental commit low-consequence and easily
corrected by typing the old value back.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-28
**Verified by:** qa

All checks below were re-run fresh by qa against the live tree, the sibling
`presby-site-kit` repo, and the real dev database — not inferred from any
implementer's own claims.

## Type Check

`npm run typecheck`: **PASS**, clean, zero errors.

## Unit Tests

`npm test` (full suite, no `.env.local`, matches CI): 245 files passed, 26
skipped (DB-gated), 3175 passed, 655 skipped, 0 failed. Matches the
implementer's own step 5/6 numbers exactly.

DB-backed suites re-run live against the real dev database, in isolation:
- `src/lib/sites.test.ts` + `src/lib/staff.test.ts` + `src/lib/officers.test.ts`
  + `src/lib/groups.test.ts` + `src/lib/audit.test.ts`: 200/200 passed.
- `admin/staff/actions.test.ts` + `admin/officers/actions.test.ts` +
  `admin/groups/actions.test.ts`: 62/62 passed.

Sibling repo (`presby-site-kit`, tree clean, already tagged/pushed `v4.0.0`):
`npm run typecheck` PASS; `npm run test` 20 files / 164 tests passed; `npm run
build` PASS.

## End-to-End Tests

No new committed Playwright spec, matching the shipped precedent's own
accepted judgment call — confirmed by direct grep that none of the existing
e2e specs referencing adjacent surfaces touch `staffDirectory`/`liveSlots`/
`admin/staff`/`admin/officers`/`admin/groups` DOM at all, so no existing spec
is at risk. This feature does not touch `src/auth.ts`, `src/app/(auth)/`,
`src/app/api/auth/`, or `src/lib/auth/` (confirmed by grep, zero matches), so
the stricter auth-touching e2e gate does not apply.

## Regression Tests Added

- `src/lib/groups.test.ts` (~966-1034) — `setGroupMembershipPublicListed`
  ON-then-OFF against a real Postgres row, asserting `mockRecordAudit` fires
  the correct `AUDIT_ACTIONS` key on both directions.
- `src/lib/groups.test.ts` — two tests proving both new mutations refuse a
  `source = 'derived'` row with `invalid_target`.
- `src/lib/sites.test.ts` — `getPublicCommitteeRoster`: a transient DB error
  degrades to `[]` rather than throwing, from day one (not a same-day
  bug-fix this time — built in from the start).
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — rewritten from
  a truthy-function check to asserting the resolver's *resolved output*
  (`.type`/`.props`), guarding against a resolver silently ignoring its
  `filter` argument.
- `presby-site-kit/test/blocks.test.tsx` — resolver receives `{}` when no
  `filter` prop is present; a non-record `filter` falls back to `{}`.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (not touched; confirmed current)
- `src/lib/two-factor.ts`: 91.3% statements / 100% branches (not touched; confirmed current)
- `src/lib/flags.ts`: 100% (not touched; confirmed current)

## Independent Verification (beyond the standard checklist)

1. **Postgres function-overload gotcha — confirmed by direct `pg_proc`
   query.** Exactly ONE `presby_public_staff_roster` and ONE
   `presby_public_committee_roster` exist — no orphaned overload. The old
   1-argument call shape executes without ambiguity error.
2. **Fail-closed wrappers — confirmed by direct read.** Both
   `getPublicStaffRoster()` and `getPublicCommitteeRoster()` in
   `src/lib/sites.ts` have their entire bodies wrapped in one
   `try { … } catch { return []; }` from the first line, not merely a
   doc-comment claim.
3. **No-runtime-queryable-filter redline — confirmed by direct read of
   `page.tsx`.** No `searchParams` anywhere in the file or in
   `staff-directory.tsx`/`committee-directory.tsx`/`sites.ts`. The
   `liveSlots` resolver closures close over `slug` only — no `params`,
   `request`, `headers()`, or `cookies()` in scope inside either closure.
4. **Enumeration safety — confirmed.** No per-person route introduced
   anywhere in the diff. `PublicCommitteeRosterEntry`/`PublicStaffRosterEntry`
   carry no `id`/`groupId` field at all — only `groupName`/`displayName`/
   `groupRole`/`photoKey`.
5. **`PersonCard` field-scope — confirmed by direct read of
   `presby-site-kit/src/components/PersonCard.tsx`.** No `phone`/`email`
   field at all (structural absence, not caller discipline). Presby's own
   mapping code never sets such fields either.
6. **`check:audit` blind spot — confirmed real, extended to `groups.ts`.**
   `setGroupMembershipPublicListed()`'s mutation and `recordAudit()` call
   both live in `src/lib/groups.ts`, invisible to the tripwire. Real coverage
   is `groups.test.ts`'s own `mockRecordAudit` assertions, read directly:
   both directions assert the exact `AUDIT_ACTIONS` string values with
   correct `resourceType`/`resourceId`/`metadata`.
7. **Derived-group rejection — confirmed by direct read.** Both new
   mutations re-load the row scoped to `(id, organizationId, source =
   'managed')` before mutating, returning `invalid_target` on miss or
   derived — line-for-line the same guard shape as `endGroupMembership`.
8. **`presby-site-kit@4.0.0` pin durability — confirmed under a genuinely
   fresh, isolated `npm ci`** (a new scratch directory, not the warm local
   cache): resolves `presby-site-kit@4.0.0` at commit `8ca982a`, and the
   installed `dist/index.d.ts` contains both the resolver-function
   `liveSlots` type and `export { PersonCard }`.
9. **Backward compatibility — confirmed by code + test.** `page.test.tsx`
   calls the `staffDirectory` resolver with `{}` and asserts `filter: {}`
   reaches `PublicStaffDirectory` — reproducing the shipped feature's exact
   unfiltered behavior with no content-repo migration required.
10. **Mobile DOM-shape — confirmed by direct source review.** "Public
    listing" and "Display order" carry `hidden sm:table-cell` consistently
    across `staff-roster.tsx`, `officer-roster.tsx`, and the new columns on
    `admin/groups/[groupId]/page.tsx` — matching the exact remediation shape
    the shipped precedent already had to fix once. (Source review, not a
    fresh Playwright capture this session — the implementer's own documented
    360/390px real-browser walkthrough is the live-render evidence.)
11. **Auth-touching scope — confirmed false**, zero matches on a grep for
    every auth-path file against the full diff.
12. **Grants — confirmed live on the dev DB.** `presby_app` holds execute on
    both functions; `public` does not.
13. **Flag seeding — confirmed.** Both `sites.public_staff_directory` and
    `sites.public_committee_directory` seed `enabled: false`. (The shared dev
    DB currently has both flipped `true` — pre-existing dev-environment
    state from prior verification sessions, unrelated to the seed default,
    not a code defect.)

## Feature-Gate Audit

*(Verified by reading route/action bodies directly, not by inferring from green tests.)*

| Route or action | `auth()` present? | Permission/flag check present? | Correct key? |
|---|---|---|---|
| `setStaffPositionPublicDisplayOrder()`/Action | via `withOrgContext()`/`resolveActingIdentity()` | yes — `hasStaffManage` (`staff.manage`) | yes |
| `setOfficerTermPublicDisplayOrder()`/Action | same | yes — `hasOfficersManage` (`officers.manage`) | yes |
| `setGroupMembershipPublicListed()`/Action | same | yes — `hasGroupsManage` (`groups.manage`), plus derived-group re-load guard | yes |
| `setGroupMembershipPublicDisplayOrder()`/Action | same | yes — `hasGroupsManage` (`groups.manage`), plus derived-group re-load guard | yes |
| `getPublicStaffRoster()` | anonymous by design | yes — `isFlagEnabled("sites.public_staff_directory")`, fail-closed to `[]` | yes |
| `getPublicCommitteeRoster()` | anonymous by design | yes — `isFlagEnabled("sites.public_committee_directory")`, fail-closed to `[]` (separate flag) | yes |
| `presby_public_staff_roster(text,text,boolean)` SQL fn | N/A (anonymous) | fixed projection + `revoke all from public`/`grant execute to presby_app`, confirmed live | yes |
| `presby_public_committee_roster(text,text,boolean)` SQL fn | N/A (anonymous) | same, plus `membership_source = 'managed'` defense-in-depth | yes |

No route or action wrongly returns data or accepts a mutation from an under-privileged caller; no gate missing or misnamed.

## Verdict

**PASS**

All required checks are green, freshly re-run against the live tree, the
real dev database, and the sibling repo. Every named risk was independently
confirmed by direct code/DB/`pg_proc` inspection: the function-overload
gotcha did not recur; both public-read functions are fail-closed from the
first line; the no-runtime-queryable-filter redline holds structurally; no
per-person route or raw id/group_id was introduced; `PersonCard` enforces
field-scope structurally; the `check:audit` blind spot is correctly
compensated by direct `mockRecordAudit` assertions; the derived-group guard
matches `endGroupMembership`'s precedent exactly; and the
`presby-site-kit@4.0.0` pin resolves cleanly under a genuinely fresh,
isolated `npm ci`. This diff does not touch any auth-path file.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The operator's own two named examples — a hand-picked, ordered "leadership" page and separate per-committee pages — are concretely buildable today from the shipped `filter`/`publicDisplayOrder`/`liveSlots`-resolver/`PersonCard` API, verified by direct construction against the real source (not just QA's account), with the safety-critical redlines (no runtime-queryable filter, no id in the anonymous projection, structural field-scope on `PersonCard`) independently re-confirmed by direct reads of `page.tsx`, `sites.ts`, `groups.ts`, and the sibling `presby-site-kit` repo's `blocks.tsx`.

## What's Working

- **Both operator examples are real, not theoretical.** Constructed both concretely from the shipped API: a **leadership page** via `{"type":"liveSlot","props":{"slot":"staffDirectory","filter":{"hasPriority":true}}}`, fed by an admin toggling `public_listed`/`publicDisplayOrder` on specific staff/officer rows; and **committee pages** via `{"slot":"committeeDirectory"}` (all committees) or `{"slot":"committeeDirectory","filter":{"committee":"Missions Committee"}}` (one committee), fed by the same toggle pattern on `group_memberships` rows. The implementer's own Phase 4 real-browser walkthrough staged exactly these page shapes and screenshotted them at desktop/390px/360px — not merely a paper design.
- **The `liveSlots` resolver-function mechanism (Phase 2's correction of Phase 1's own recommendation) is real, independently confirmed** by reading `presby-site-kit`'s actual `renderLiveSlotBlock` — the map's value is called with the marker's own `filter`, exactly as designed, with none of the rejected pre-walk design's key-collision problem.
- **The no-runtime-queryable-filter redline holds structurally**, independently re-confirmed: `page.tsx`'s `liveSlots` resolver closures close over `slug` only; no `searchParams`/`headers()`/`cookies()` anywhere on the path.
- **No id/group_id ever leaves the anonymous projection** and **`PersonCard`'s field-scope is structural** (no `phone`/`email` prop exists to misuse) — both confirmed by direct source read, not inferred.
- **The derived-group guard and the fail-closed-from-day-one wrappers are real**, confirmed by direct read — the latter closes a gap proactively that the shipped precedent only closed reactively as a same-day bug-fix.
- **The `publicDisplayOrder` vs id-list ruling delivers on the operator's ask** for both named cases without ever putting a person id in the lower-trust content repo — a real, reasoned tradeoff, not a weaker capability in disguise (see the one genuine limitation noted below).
- **The fpcw-content-migration exclusion is the right stopping point** — this pipeline ships primitives only; `site-fpcw`'s own content is untouched, correctly left to a separate `site-recreator` task.

## Intent-vs-Shipped Diff

- Phase 1 said: the filtering actor is a fifth, out-of-band trust tier (git+CI content author), not a presby session. Shipped: exactly this, confirmed. **Matches.**
- Phase 1 recommended a bundle-introspection pre-walk; Phase 2 correctly overruled it in favor of resolver functions. Shipped: resolver functions, confirmed real. **Matches Phase 2's (better) design, not Phase 1's own recommendation — correctly so.**
- Phase 1 ruled per-membership opt-in with a derived-group guard, reuse `groups.manage`, a new audited mutation. Shipped: exactly this, confirmed by direct code read. **Matches.**
- Phase 1 flagged the fpcw migration as out of scope. Shipped: correctly not touched. **Matches.**
- Phase 1 flagged silent filter-typo failure and per-slot fault isolation as named-not-solved gaps. Shipped: per-slot fault isolation was built in from day one for `getPublicCommitteeRoster()` — a genuine improvement over the prior pipeline's own record, which had to close this reactively. Silent filter-typo failure remains named-not-solved, as agreed. **Matches, with one gap closed proactively.**
- **One real, worth-naming drift:** `publicDisplayOrder` is a single global per-row order value, not a per-marker pin. It fully serves both named examples (disjoint data sets), but can't express the same person appearing in two independently-ordered curated arrangements without a redesign. Reasoned through explicitly by Phase 2/3, not discovered here — **acceptable drift, tracked as a follow-up, not a regression.**

## Edge Cases

- Empty state: **pass** — both directory components render an explicit sentence, never a silent blank, confirmed by direct read.
- Failure microcopy: **pass** — a transient DB error degrades to the same empty-state render; confirmed via the `try`/`catch` wrapper, matching the shipped precedent's lesson from the start this time.
- Permission gate: **pass** — `staff.manage`/`officers.manage`/`groups.manage` all independently confirmed, plus the derived-group guard.
- Audit event: **pass** — `GROUP_MEMBERSHIP_LISTED_PUBLICLY`/`UNLISTED_PUBLICLY` fires on both directions; the `*PublicDisplayOrder` mutations correctly do NOT audit (a presentation-order fact, not a disclosure fact — a reasoned, non-arbitrary distinction).
- Mobile (360px): **pass** — confirmed via direct source read (`hidden sm:table-cell` placement) plus the implementer's documented real-browser walkthrough.

## Follow-Ups (SHIP WITH NOTES)

1. No committed Playwright e2e spec covers the `committeeDirectory` click-through flow, extending the identical already-tracked gap for `staffDirectory`. Safe today only because `sites.public_committee_directory` ships seeded off.
2. `publicDisplayOrder`'s single-global-order limitation should be named explicitly for whoever picks up a future request needing the same person curated into two independently-ordered arrangements — not a defect, a scoped-out capability.
3. Photo upload for `people.photo_key` remains unwired; this pipeline extends its relevance to `PersonCard`/committee rosters too (degrades gracefully, confirmed live) — worth amending the existing TODO entry so it doesn't read as staff/officer-only.

No feedback row to mark (direct live operator instruction, not an in-app submission). What's-new advisory: optional, not required — this is admin/content-authoring infrastructure, not member-visible portal behavior.
