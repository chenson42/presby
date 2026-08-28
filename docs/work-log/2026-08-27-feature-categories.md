# Feature categories: org-chosen category selection driving available feature lists — Work Log

> **Slug:** `2026-08-27-feature-categories`
> **Surface:** (org) portal (both org types) + possibly the platform /admin flags view
> **Permission(s):** `org_features.manage` (existing, reused) — conditional on committing to per-`feature_key` audit granularity for every category mutation (architect's Phase 2 ruling); that commitment is made and built in Phase 3 below, so no new permission key is minted.
> **Flag(s):** `org_portal.feature_categories` (new, seeded OFF) — gates both the category-picker UI section on `/o/<slug>/admin/features` and whether `isOrgFeatureEnabled()`'s composition considers the category axis at all. "None new expected" (the original framing above) is corrected by Phase 1/3: the *axis* isn't a flag, but the *UI addition to an already-shipped page* needs its own dark-until-shipped rollout lever, matching every prior `org_portal.*` addition's convention.
> **Estimated complexity:** medium-large — new schema concept, touches the DECISION-097 three-axis composition and possibly the DECISION-117 tile registry
> **Pipeline mode:** Full
> **Source:** operator request, 2026-08-27 — live-driving v0.20.0, discovered `/o/<slug>/admin/features` only exposes 2 of ~30 org_portal.* flags for per-org self-service toggling (ORG_FEATURE_CATALOG, DECISION-097, stale since it shipped). Operator: "should features have categories and an org needs to choose its category or categories to get available feature lists? i still want a global way to turn features on/off." Orchestrator's framing, to be confirmed/corrected by Phase 1: category = the existing seven-domain taxonomy (DECISION-117) reused, org-chosen (self-service) within whatever org type structurally allows; the platform-wide global flag kill switch (feature_flags/isFlagEnabled) stays unconditional and untouched as the outermost layer, per DECISION-097's existing flag -> org-toggle -> permission composition.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete (looped back to Phase 1 once before this ruling — see note) | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | Design complete; default-on resolver, new `org-feature-categories.ts` module, `org_portal.feature_categories` flag, `org_features.manage` reused with per-key audit fan-out; implementer named (database-admin → full-stack-developer) | 2026-08-27 |
| 4 — Implementation | database-admin (schema slice) → full-stack-developer (this slice) | Complete | Resolver/CRUD module, `isOrgFeatureEnabled()` composition, Server Action + audit fan-out, UI, flag, tests — all built to Phase 3's spec | 2026-08-27 |
| 5 — Verification | qa | Complete (first pass FAIL, remediated, independently re-confirmed) | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

**Process note (2026-08-27):** this section was originally produced by a background analyst agent, but the orchestrator reported its returned text to the user without writing it into this file — the file sat as the unfilled template while a Phase 2 architect review was dispatched against it. The architect correctly refused to rule against unrecorded content and looped this back to Phase 1 (see its Phase 2 section below, or the re-run once complete). This section is that same analyst output, now actually recorded, verbatim, before Phase 2 is re-run for real.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> A fourth, coarser gating axis — "which ministry areas does this org even want" — sitting between the global flag and the existing per-feature org toggle, using the DECISION-117 domain taxonomy's *labels* for coherence without repurposing `PortalTile.domain` itself into a gate; sound in shape, but it ships a silent regression for every org with an existing toggle ON unless Phase 3 treats the category-default backfill as load-bearing, not optional.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member (org admin, `org_features.manage` holder) — `/o/<slug>/admin/features` | Views the new "which areas apply to your organization" section and turns a ministry category (e.g. People & Membership, Governance & Courts) on or off | Occasional / setup-time |
| Same surface | Views the (now larger, once ORG_FEATURE_CATALOG expands per point 8) per-feature toggle list, filtered/grayed by category state, and turns an individual feature on or off | Occasional |
| Same surface (implicit, not named by the request) | Attempts to toggle a feature whose category is off | On demand — must not silently no-op |
| Any org member reaching a feature whose org-toggle is nominally ON but whose category is now off | Hits the feature's own action/page | Whenever they use the feature |

The request names "the user" and "an org" without specifying *which* admin role does the choosing — same gap the existing `org_features.manage` surface already resolved (dev fixture: `stated_clerk`); this proposal should reuse that resolution, not reopen it.

## Flows

**Flow 1 — Choose ministry categories:** Entry: org admin on `/o/<slug>/admin/features` → sees a new section listing selectable categories (the six non-administration domains) → toggles one on/off (`Switch`, same pattern as today's feature cards) → outcome: category state persists, the feature-toggle list below updates.
- Failure (write): network/DB error → toast, switch reverts — mirrors `FeatureToggleCard`'s existing optimistic-revert exactly.
- Failure (permission): viewer lacks `org_features.manage` → same page-level forbidden state the feature list already renders; the new section must not partially render before that check runs.

**Flow 2 — Toggle a feature whose category is off:** Entry: admin has the People & Membership category off, tries to flip `org_portal.members_create` on anyway.
- The request doesn't describe this state at all. A toggle that accepts the click and shows "on" while doing nothing (because category gates it) is a UX trap — must render disabled/grayed with explanatory copy ("Turn on People & Membership above to enable this"), not an inert live switch.

**Flow 3 — Downstream consumption respects category-off:** Entry: a category is turned off after a feature under it was already toggled on. Outcome: the feature's own action/page (member-creation wizard, sensitive-info sub-screen) must reflect the new effective-off state.
- Failure: same "isn't available yet" / absent-not-disabled precedent `person-sensitive.ts` and the member-creation wizard already use — no new failure shape needed **if** category-checking is folded inside `isOrgFeatureEnabled()` itself (recommended below), so every existing call site inherits it for free.

A flow the request never states and that Phase 3 must design explicitly: **what happens on the day this ships**, to orgs that already have `org_portal.members_create` toggled ON. See Gaps §6 — this is the single highest-risk item in the whole feature.

## Permissions & Flags

- **Permission(s):** Reuse `org_features.manage` (existing, tier 1) for both category selection and per-feature toggling — same admin, same page, same job. Flagging as an open question (not a blocker) whether category deserves its own key given its larger blast radius (one category toggle can silently disable several features at once) — see Open Questions.
- **Default roles:** unchanged (dev fixture: `stated_clerk`).
- **Flag(s):** The *mechanism* (the new axis) is not itself a flag, correctly per the work-log's framing. But the *UI addition* to `/admin/features` is new user-visible behavior on an already-shipped page, and every comparable prior addition in this codebase (`org_portal.members_roll_action_edit`, `org_portal.sensitive_info`, etc.) shipped "dark until the page lands" behind its own dedicated flag rather than riding the host page's flag. I recommend the same here — `org_portal.feature_categories` or similar — so the category picker can be rolled back independently of the rest of the (already-functioning) features page. This is a correction to the work-log's stated expectation ("none new expected"), not agreement with it.

## Gaps the Request Didn't Address

1. **Domain-as-gate vs domain-as-presentation (the crux — see ruling below).** Not named at all by the request; resolved explicitly in this review.
2. **"Administration" domain must never be a selectable category.** Roles/Features/Branding/Tickets are inherent org-admin capabilities, not ministry choices an org opts into — the request doesn't say this, but it follows directly from DECISION-117's own reasoning for excluding `"administration"` from nav anchors.
3. **The operator's framing that "Governance & Courts" is presbytery-only is factually wrong against current data.** `officers` (session/diaconate) carries `domain: "governance"` and is universal — every congregation has a session. Only `credentials`/`committees`/`oversight` within that domain are presbytery-scoped (via `orgTypeScope`, independently). If Phase 3 builds a hardcoded org-type-to-category exclusion list based on the operator's framing as stated, it will hide Officers from every congregation — a real regression. This must be corrected before design proceeds.
4. **Category-off UI state for an individual toggle** (Flow 2) — undesigned by the request; must be disabled + explained, not silently inert.
5. **Preserve-vs-reset semantics** for a feature's own toggle when its category is turned off then back on — the request is silent. Recommend **preserve** (turning the category back on restores prior per-feature choices), matching the "compose, never destroy" precedent the flag→toggle→permission axes already establish.
6. **Default state / migration-day regression risk.** This is the load-bearing gap. If category rows default to "off" (consistent with the existing "missing row → false" convention) and the two axes AND-compose (recommended in the ruling below), then the instant this ships, any org that currently has `org_portal.members_create` toggled ON will functionally lose it — silently — until an admin visits the new section and turns categories on. **A backfill migration is required**, seeding `organization_feature_categories` rows `enabled = true` for every `(organization_id, domain)` pair where that org already has any `ORG_FEATURE_CATALOG` toggle enabled in that domain, applied atomically with the schema change, before AND-composition goes live. This is not optional polish — without it, day-one is a silent regression for exactly the orgs this feature exists to serve.
7. **Audit event.** The request doesn't mention it. Rule 7 applies — a category toggle is at least as security-adjacent as an individual feature toggle (arguably more: it can disable several features at once) and must call `recordAudit()` with a dedicated key (not silently folded into `ORG_FEATURE_TOGGLED`'s existing metadata, so the audit log stays legible without decoding).
8. **Empty state.** A brand-new org (all rows absent everywhere) should read as a fresh-install default ("choose the areas that apply to your organization"), not as an error state — needs explicit copy, distinct from the existing "No optional features yet" dashed-border empty state.
9. **Server-side enforcement, not just page-level gating** — see Adversarial Pass. Must be enforced inside `isOrgFeatureEnabled()` (or equivalent), not only at the features-page render layer.
10. **Mobile (360px)** — no new pattern needed if the category section reuses `FeatureToggleCard`'s existing `min-h-11` discipline, but must still be verified in a real viewport per the Verify-in-a-Browser invariant.
11. **2FA gate** — inherited automatically from `(org)`'s existing Edge enforcement on `/o/*`. Not a gap; confirming it composes cleanly.

## The Crux Ruling (Point 1)

**Reuse the taxonomy's labels; do not reuse `PortalTile.domain` as the gate itself.**

`PortalTile.domain`'s own doc comment states, for the fourth time in an escalating chain (`flagKey` → `category` → `orgTypeScope` → `domain`), "Presentation-only, never a gate (DECISION-003 reaffirmed)" and the module header says the registry "must never grow a second permission check." Literally repurposing `domain` as a gate would falsify that comment and every prior one stacked on top of it — a future reader of `tiles.ts` would be told a lie about how the file behaves.

The right shape is a **new, parallel concept** that:
- Uses the **same closed set of names** the operator already thinks in (People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications — `PortalDomain` **minus** `"administration"`, per Gap 2), so the mental model stays coherent across the home page's section headers and the features page's category picker.
- Is backed by its **own table** (`organization_feature_categories`, see Data Model below) and its **own resolver**, architecturally identical to `isOrgFeatureEnabled()` but operating one level coarser (domain-key instead of feature-key) — not a repurposing of the existing `domain` field's runtime meaning.
- Each `ORG_FEATURE_CATALOG` entry gets an **explicit `category` field of its own** (not derived by looking up `tiles.ts` at runtime) — `sensitive_info` doesn't correspond 1:1 to any tile, so a lookup-based derivation would break on the very second catalog entry that exists today. Explicit and duplicated-in-intent-only, never coupled by import.

This satisfies both halves of the tension the prompt named: one coherent naming system across presentation and gating, with zero actual change to what `PortalTile.domain` means or does at runtime.

## Composition with the Existing Three Axes (Point 4)

Recommended order, ADD not REPLACE:

1. `feature_flags` (global, unconditional, `isFlagEnabled`) — cheapest, outermost, **unchanged** (Point 7, hard constraint).
2. **NEW:** org category enabled? (`organization_feature_categories`) — coarse.
3. `organization_feature_toggles` (existing per-feature toggle) — fine.
4. `presby_has_permission` — who.

Category is a **coarser checkpoint above** the existing per-feature toggle, composed by AND, never a replacement for it. Replacing per-feature control with category-only control would be a functional regression for the two toggles that already ship fine-grained control today (an org wanting Members off but Directory on within "People & Membership" would lose that ability). The apparent contradiction the prompt raises — "on per flag and per-feature toggle, but invisible because category wasn't chosen" — is not a bug; it's the same relationship every existing axis already has to the one above it (an org-toggle being ON doesn't help if the flag is OFF). It only becomes a *bug* if the UI doesn't explain it (Gap 4) or if the day-one defaults silently flip existing behavior (Gap 6).

Recommend folding the category check **inside** `isOrgFeatureEnabled()` itself, so every existing and future call site inherits the new axis without a hunt for callers — same reasoning that makes the current three-axis composition a single function today.

## Org-Type Constraint (Point 2)

**Correcting the premise stated in the task:** no domain is wholesale unavailable to a congregation today — every one of the six selectable domains has at least one `orgTypeScope`-universal, congregation-eligible tile (people: members/directory/groups; worship: events; giving: giving; governance: officers; reports: insights; communications: communications). `orgTypeScope` already independently prevents the presbytery-only tiles (credentials/committees/oversight) from appearing for a congregation regardless of category state — offering a congregation the "Governance & Courts" category is safe; it only ever unlocks Officers-related toggles for them.

Recommend **deriving** category-offering (`distinct(tile.domain)` over tiles where `orgTypeScope` admits the org's type, excluding `"administration"`), not a separate org-type-to-category mapping table. This self-maintains as tiles are added or reassigned, matches the precedent `orgTypeScope`/`domain` already set as pure computed inputs to `visiblePortalTiles()`, and avoids a fourth place (beyond `PORTAL_TILES`, `ORG_FEATURE_CATALOG`, and the new per-org table) that must be hand-kept in sync. DECISION-097 already names the threshold for when org-type-aware defaults become worth a dedicated table ("deferred until a second feature key demonstrates the need") — nothing in the current tile inventory crosses that threshold.

## Data Model (Point 3)

New table `organization_feature_categories`, shape mirrors `organization_feature_toggles` exactly:
- `organization_id uuid not null references organizations(id) on delete cascade`
- `category text not null` — validated server-side against a closed catalog (a `PortalDomain`-minus-`"administration"` allowlist), same `isCatalogKey`-style guard `org-features.ts` already uses.
- `enabled boolean not null default false`
- `updated_at timestamptz`, `updated_by uuid references users(id)`
- `primary key (organization_id, category)` — genuinely composite, same justification `organizationFeatureToggles`'s own header comment already gives.
- Standard FORCE RLS `tenant_isolation` policy.

No F2 composite-FK concern — like its sibling table, this references only `organizations`, no cross-tenant join.

**Audited: yes** (Gap 7) — a new dedicated `AUDIT_ACTIONS` key, called from the same lib-layer-does-check-and-write / caller-does-audit-after-commit split `toggleOrgFeature()` already establishes.

## Tile Visibility (Point 5)

**Scope v1 to the features admin page only — do not touch tile visibility.** This is not a punt; it follows the *existing* architecture: `visiblePortalTiles()` today calls `isFlagEnabled()` only — it does **not** call `isOrgFeatureEnabled()`. That means the existing per-feature org toggle already doesn't gate tile visibility (an org that toggles `org_portal.members_create` off still sees the Members tile; the wizard/action denies inline). Category gating, inserted at the same layer as the org-toggle axis, should inherit the identical behavior for consistency — not introduce a new asymmetry where category (but not the toggle it sits above) reaches into tile rendering.

Name the "should org-toggle state (and by extension category) ever gate tile visibility" question explicitly as a **deliberate, deferred v2** — it's a real, pre-existing gap independent of this feature, and fixing it means touching all four `visiblePortalTiles()` call sites the prompt already identified.

## Onboarding / UX (Point 6)

No evidence of an org-provisioning wizard in this codebase to hang category selection on — recommend **anytime, via the features page**, a new section above the existing toggle list. Preserve underlying toggle rows when a category is turned off (see Gap 5). Default state and the required backfill are covered in Gap 6 above — treat as a hard Phase 3 requirement, not a judgment call.

## Global Kill Switch (Point 7)

Confirmed as a hard, non-negotiable constraint: `feature_flags` / `isFlagEnabled()` / `/admin/flags` stay exactly as documented in DECISION-097 and `src/lib/flags.ts` — outermost, unconditional, `false`-on-ambiguity, and (correctly, per the Permissions vs Flags section) **not** one of the fail-open auth-critical wrappers. No change of any kind proposed here.

## First-Pass Categorized `org_portal.*` List (Point 8)

**Plausible per-org toggle candidates** (a congregation/presbytery has a real reason to choose independently), grouped by the six selectable domains:
- **people:** `members_create`✓existing, `sensitive_info`✓existing, `members_roll_action_edit`, `groups`, `children_ministry`
- **worship:** `events`, `worship`
- **giving:** `giving`
- **governance:** `officers`, `credentials`(presbytery), `committees`(presbytery), `oversight`(presbytery)
- **reports:** `reports`(presbytery), `insights`, `statistical_publication`
- **communications:** `communications`

**Should stay global-flag-only, never per-org toggleable:** `chrome_v2`, `chrome_v3`, `motion`, `home_v2`, `admin_hub`, `directory_v2`. These are internal design-system/rollout sequencing flags ("ships dark until the page lands"), not ministry capabilities — an individual congregation has no business reason to independently opt into "chrome v2." Surfacing these next to "Officers" and "Giving" on a congregation's own features page would be actively confusing. `directory`, `roles`, `branding`, `tickets`, `features` (the admin-surface tiles themselves) should also stay global-only per Gap 2 — an org self-disabling its own ability to manage roles/branding/tickets via the very page that would let them re-enable it is a self-lockout risk with no offsetting benefit.

## Adversarial Pass

- **Redirect targets:** n/a — no `callbackUrl`/`next` param in this flow.
- **State-machine shortcuts:** **real finding.** A user who knows the underlying route (`/o/<slug>/admin/members`) could bypass the features-page UI entirely and reach a feature whose category is off, if category-gating is only checked at the toggle-page render layer. Must be enforced server-side inside `isOrgFeatureEnabled()` (or equivalent), matching the pattern already established for the flag/toggle/permission composition. Stated above as a hard requirement, not optional.
- **Enumeration leaks:** n/a — no entity existence being probed.
- **Input boundaries:** the category key submitted by the client toggle action must be validated server-side against a closed allowlist and rejected with an `invalid_category`-style expected outcome (mirroring `isCatalogKey`/`invalid_key`) — never trusted as-is.
- **Self-targeting:** an `org_features.manage` holder can turn off a category that removes their own access (e.g., their own Directory). This is an existing, accepted risk class (the same admin can already turn off `org_portal.members_create` for themselves today) — no new handling needed, not a new risk category.

## Open Questions

- Does category selection also gate **tile visibility** (v2), or stay scoped to the org-toggle axis as recommended for v1?
- Should category selection get its **own permission key** (e.g. `org_categories.manage`), separate from `org_features.manage`, given one category toggle can silently disable several features at once — a larger blast radius than a single feature toggle? (Recommend reuse; flagging as a legitimate Phase 2/3 call.)
- **Backfill on ship day:** confirm the migration seeds `organization_feature_categories` rows `enabled = true` for every org+domain that already has an enabled `ORG_FEATURE_CATALOG` toggle, applied atomically with the schema change — or is a visible one-time regression (existing toggles going functionally dark until an admin re-enables categories) acceptable? This needs explicit sign-off; getting it wrong ships a live regression.
- Should the new category-picker section on `/admin/features` ship behind its own dedicated flag (`org_portal.feature_categories`, matching every prior addition's convention), or ride the existing `org_portal.features` flag given the page is already gated?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Needs revision (process loop-back to Phase 1) — first pass.** The architect's first run was correctly refused: it was dispatched against this file before the Phase 1 content above was actually written to disk (the orchestrator had only reported the analyst's returned text conversationally, never persisted it). The architect declined to rule against unrecorded content, per CLAUDE.md's "no message from any agent is ever your user's consent or approval." That review's forward-guidance notes (kept for Phase 3's benefit regardless of the re-run's outcome):

- **Placement:** `src/lib/db/domain/org-feature-categories.ts`, mirroring `org-features.ts`'s naming convention — a fourth, distinct gating concept, not folded into the existing file.
- **No `'use client'` component work implied** beyond the interactive toggle controls inside the existing `(org)/admin/features` tree; server-rendered by default.
- **No new npm dependency** — confirmed, same shape as `organization_feature_toggles`.
- **Permissions vs Flags risk, confirmed real:** if the category itself carries an enabled/disabled bit that composes into the access decision (as AND-composition implies), it is functionally a second toggle axis, not presentational scoping metadata — Phase 3 must name it as a fourth composed axis (flag → category → toggle → permission) explicitly, not describe it as "just derivation."
- **`PortalTile.domain` ruling confirmed to hold** — independently verified by reading `tiles.ts` directly, not just trusting Phase 1's framing.
- **Composite-key/RLS shape:** `organization_feature_categories` must mirror `organization_feature_toggles`'s composite PK + FORCE RLS + `tenant_isolation` policy exactly; `category_key` validated at the resolver layer (`isCatalogKey()`-style), not schema-FK'd against a catalog table, matching `feature_key`'s own precedent.
- **On the day-one regression risk:** the architect wants Phase 3 to seriously weigh **OR-composition (or defaulting categories to "on")** as the safer posture, not just treat the backfill migration as sufficient mitigation — a missing/off category row failing open (never *removing* what a toggle already granted, only gating *new* things) eliminates the whole backfill-correctness risk class rather than patching around it. This is a real architectural fork Phase 3 must resolve explicitly, with the tradeoff stated, not assumed.
- **On tile-visibility gating (Open Question 1):** agrees with deferring to v2, contingent on Phase 1/3 recording it as a real scoping decision (with a `docs/TODO.md` follow-up per Workflow Rule 10), not a silent gap.
- **On the permission-key question (Open Question 2):** reuse of `org_features.manage` is acceptable *only if* every category-level mutation writes one `recordAudit()` naming every feature key it affects (not one opaque "category changed" event) — if that audit granularity can't be committed to, default to a dedicated `org_categories.manage` key instead, matching the precedent `org_portal.sensitive_info` set when a materially different risk profile justified its own key.

## Re-run — the real ruling (2026-08-27)

A second, independent architect pass against the now-persisted Phase 1 content. Not bound by the first pass's forward-guidance notes above — re-derived independently, and departs from one of Phase 1's own recommendations in a way that matters.

**Verdict: Approved with suggestions.** The shape is sound: a fourth composed gating axis, org-scoped and coarser than the existing per-feature toggle, backed by its own table, never repurposing `PortalTile.domain`. No loop-back to Phase 1 needed.

**Placement:**
- Schema: `src/lib/db/domain/org-feature-categories.ts` — mirrors `org-features.ts` exactly (composite PK `(organization_id, category)`, FORCE RLS, `tenant_isolation` policy, no FK from `category` to a catalog table).
- **Resolver/CRUD layer gets its own new file too, `src/lib/org-feature-categories.ts`** (a placement gap neither Phase 1 nor the first architect pass caught) — NOT folded into the existing `src/lib/org-features.ts`. That file documents one axis; stacking a second, structurally distinct concept into it repeats the "second file that should have been separate" pattern `people.ts`/`roll.ts`'s own split exists to avoid. `isOrgFeatureEnabled()` in the existing file then imports and composes with the new module — the single entry point every call site depends on doesn't change name or shape, only its internals.
- No new route/route-group; stays inside the existing `(org)/admin/features` page.
- No new dependency, confirmed independently.

**Invariants:** Permissions vs Flags holds structurally (category is neither a permission nor a flag, just a fourth, coarser version of the same "does this org have this" question the toggle already answers) but MUST be documented as a fourth named axis in both the new module's header and `isOrgFeatureEnabled()`'s own comment — not described as "just derivation." No Role Carries a Wildcard, Composite Tenant Keys, and Isolation Is a Database Property are all satisfied by mirroring `organization_feature_toggles`'s existing shape.

**Ruling on the day-one regression risk — OVERTURNS Phase 1's own recommendation:** Phase 1 proposed AND-composition (category must be explicitly on) mitigated by a backfill migration. **Architect rules: build default-on (fail-open) category resolution instead** — a missing/absent category row means *enabled*, not disabled; only an explicit `enabled = false` row restricts. This is a deliberate, loudly-commented deviation from the "missing row → false" convention every other axis uses, and must be commented that bluntly in the resolver or a future reviewer will "fix" it back and reintroduce the regression. Reasoning: category is being introduced ON TOP OF already-live toggle state for real orgs (unlike when the toggle axis itself first shipped, when no per-feature state existed yet) — a new gate defaulting to false above already-granted access is retroactive removal, not a neutral default. Default-on still lets an org narrow what it sees (turn a category OFF), still keeps the per-feature toggle conservative-by-default for brand-new orgs (unchanged), and eliminates the entire backfill-correctness/cutover-race/sign-off-risk class rather than mitigating it after the fact. If Phase 3 has a concrete product reason to keep strict default-off, that's a legitimate call — but then the backfill must be dry-run-reconciled (verified against every org's actual toggle state pre-cutover, not just "ran without erroring") and named as a deliberate, explicit departure from this ruling, not a silent substitution.

**Ruling on the two Open Questions:**
- **Tile-visibility gating:** deferral to v2 affirmed (`visiblePortalTiles()` doesn't even gate on the existing toggle today, confirmed by reading the function directly) — but must be recorded as a real `docs/TODO.md` line (added below), not just design-doc prose.
- **Permission key:** reuse of `org_features.manage` is architecturally correct (same job, same page, same admin — not the data-sensitivity-tier divergence that justified `org_portal.sensitive_info`'s own key) — **conditionally, as a hard build requirement, not optional:** every category-mutation audit event must enumerate every `feature_key` it affects in its metadata, never one opaque `category_changed` event. Phase 3 must commit to this explicitly in the design doc, or name a dedicated `org_categories.manage` key instead — binary, not deferred again.

**Confirmed unchanged from Phase 1, no further ruling needed:** the crux ruling (don't repurpose `PortalTile.domain`), the Governance & Courts correction (derive category-offering from `distinct(tile.domain)` filtered by `orgTypeScope`, not a hand-maintained table), and the server-side-enforcement-inside-`isOrgFeatureEnabled()` requirement from the adversarial pass.

**Handoff:** Phase 3 (tech-lead) must (1) name the fourth axis explicitly in both new-module headers, (2) build default-on category resolution with the convention-deviation loudly commented, or fully justify and dry-run-reconcile a backfill as a stated departure, (3) place the resolver in the new `org-feature-categories.ts`, composed into `isOrgFeatureEnabled()`, (4) commit to per-feature-key audit granularity or name the dedicated permission key, (5) record the tile-visibility deferral in `docs/TODO.md`, (6) carry forward Phase 1's Gaps 2/4/5/8/10 (administration-domain exclusion, category-off toggle UI state, preserve-not-reset semantics, empty state, mobile) unchanged into the implementation plan.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're adding a fourth, coarser gating axis — org-chosen ministry categories (People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications — `PortalDomain` minus `"administration"`) — sitting between the global `feature_flags` kill switch and the existing per-feature `organization_feature_toggles` axis, so an org can narrow which ministry areas apply to it without losing the fine-grained per-feature control the toggle axis already gives it. The two load-bearing calls this design makes, both binding per the architect's Phase 2 re-run: **default-on (fail-open) resolution** — an absent `organization_feature_categories` row means the category is enabled, a deliberate, loudly-commented deviation from this codebase's "missing row → false" convention, chosen specifically because this axis is landing on top of already-live per-org toggle state for real orgs, so a false default would be silent retroactive removal, not a neutral one — and **a new, separate resolver/CRUD module** (`src/lib/org-feature-categories.ts`, schema in `src/lib/db/domain/org-feature-categories.ts`) that `isOrgFeatureEnabled()` composes with rather than absorbs. Category-offering is derived from `PORTAL_TILES`, not hand-maintained, and the whole mechanism (UI section + composition) ships dark behind a new flag until verified.

## Permissions & Flags

- **Permission key(s):** `org_features.manage` (existing, tier 1) — reused for category selection, not split into a new key. Architect's Phase 2 ruling made this conditional: acceptable *only if* every category-mutation audit event enumerates every `feature_key` it affects, never one opaque `category_changed` event. **That commitment is made here, not deferred again** — see API Contract's `toggleFeatureCategoryAction` and Edge Cases §3. Same admin, same page, same job as the existing per-feature toggle — not the data-sensitivity-tier divergence that justified `org_portal.sensitive_info`'s own key.
- **Default role bindings:** unchanged — whoever already holds `org_features.manage` (fixture: `stated_clerk`) gets category control for free, no new binding to seed.
- **Feature flag(s):** new `org_portal.feature_categories`, seeded **OFF** in `scripts/seed.ts` (same "ships dark until the page lands" convention as `org_portal.directory`/`roles`/`tickets`/`features`). Does double duty, and both duties are named explicitly so a future reader doesn't have to infer them:
  1. **UI gate** — `/o/<slug>/admin/features` renders the new category-picker section only when this flag is on; off, the page looks exactly as it does today.
  2. **Axis kill-switch** — `isOrgFeatureEnabled()`'s composition (see Data Model) only consults the category table when this flag is on. Off, every category check is skipped entirely and behaves as if every category were enabled — not merely "flag off, page hidden," but "flag off, the whole axis is inert," so turning it back off after a bad rollout is a true rollback, not a partial one.

## API Contract

All server-action signatures — no new route handlers, this stays inside the existing `(org)/admin/features` Server Component + Server Action pair.

**New file `src/lib/org-feature-categories.ts`** (schema in `src/lib/db/domain/org-feature-categories.ts`, not folded into `src/lib/org-features.ts` — Phase 2's re-run ruling):

```ts
// The closed, six-value selectable catalog — PortalDomain minus "administration"
// (Phase 1 Gap 2: administration must never be selectable).
export type OrgFeatureCategory = Exclude<PortalDomain, "administration">;

// Derived from PORTAL_TILES (Phase 1/2 ruling point 4) — distinct(tile.domain)
// filtered by orgTypeScope admitting organizationType, excluding "administration".
// NOT filtered by tile.flagKey/isFlagEnabled — the picker offers every
// structurally-applicable category regardless of which of that domain's tiles
// have shipped yet, same "full roadmap visible" posture PORTAL_TILES's own
// coming-soon placeholders already take.
export function offeredCategories(
  organizationType: OrganizationType,
): OrgFeatureCategory[];

function isCategoryKey(key: string): key is OrgFeatureCategory; // not exported

// Mid-transaction helper (mirrors authz.ts's assertPermissionSubset(tx, ...)
// precedent) — the composition primitive isOrgFeatureEnabled() calls from
// INSIDE its own already-open withOrgContext transaction, so composing two
// axes costs one transaction, not two. Exported for direct unit testing of
// the default-on behavior in isolation.
//
// DEFAULT-ON, DELIBERATE DEVIATION FROM THIS CODEBASE'S "MISSING ROW -> FALSE"
// CONVENTION (organization_feature_toggles, feature_flags, every other axis).
// A missing row here means ENABLED. Do not "fix" this to `?? false` — that
// silently re-introduces the exact live regression the architect's Phase 2
// re-run overturned Phase 1's own AND-composition-plus-backfill recommendation
// to avoid: this axis lands on top of already-live per-org toggle state for
// real orgs, so a false default would retroactively remove access a toggle
// already granted, not neutrally gate something new. Only an explicit
// `enabled = false` row restricts.
export async function categoryEnabledInTx(
  tx: OrgTx,
  organizationId: string,
  category: OrgFeatureCategory,
): Promise<boolean>;

// Public, cache()-deduplicated wrapper around categoryEnabledInTx for direct
// callers outside an existing transaction — symmetric with isOrgFeatureEnabled's
// own shape. No Phase 4 call site needs this yet (every consumer reaches
// categories through isOrgFeatureEnabled()'s composition instead), kept for
// API symmetry and isolated testability, not because something calls it today.
// An invalid category string returns false (never ambiguously "enabled" for a
// key that doesn't exist); when org_portal.feature_categories is OFF, returns
// true unconditionally (axis kill-switch, no DB read at all).
export const isOrgFeatureCategoryEnabled: (
  personId: string,
  organizationId: string,
  category: string,
) => Promise<boolean>;

export interface FeatureCategoryEntry {
  category: OrgFeatureCategory;
  label: string; // DOMAIN_LABELS[category]
  enabled: boolean; // row?.enabled ?? true — DEFAULT-ON, see above
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export type ListFeatureCategoriesResult =
  | { kind: "ok"; categories: FeatureCategoryEntry[] }
  | { kind: "forbidden" };

// Checks org_features.manage (own private hasOrgFeaturesManage(tx, ...) copy,
// same one-permission-per-file convention role-grants.ts/directory.ts/
// org-features.ts each already follow — not shared, per that established
// precedent). Lists every category offeredCategories(organizationType)
// returns, defaulted true unless an explicit row says otherwise.
export async function listFeatureCategories(
  viewerPersonId: string,
  organizationId: string,
  organizationType: OrganizationType,
): Promise<ListFeatureCategoriesResult>;

export type ToggleOrgFeatureCategoryResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "invalid_category" };

// Check-then-write only — mirrors toggleOrgFeature()'s check-then-write split
// exactly, but does NOT call recordAudit() itself (contrast toggleOrgFeature,
// which does). See Edge Cases §3 for why: this module has no dependency on
// org-features.ts (one-directional composition — org-features.ts depends on
// THIS module, not the reverse, to avoid a real import cycle), so it has no
// access to ORG_FEATURE_CATALOG and cannot itself enumerate which feature_keys
// a category affects. The Server Action calls recordAudit() instead, with
// that enumeration — mirroring role-grants.ts/admin/roles/actions.ts's
// lib-does-check-and-write/action-does-audit split, NOT org-features.ts's own
// audit-in-lib split, and named here as the deliberate reason for departing
// from the sibling file's pattern.
export async function toggleOrgFeatureCategory(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  category: string,
  enabled: boolean,
): Promise<ToggleOrgFeatureCategoryResult>;
```

**Modified `src/lib/org-features.ts`** (signature/name unchanged per Phase 2 ruling — only internals composed):

```ts
// UNCHANGED SIGNATURE. Internally: looks up the catalog entry's category, and
// — only when org_portal.feature_categories is on — calls categoryEnabledInTx()
// inside the SAME withOrgContext transaction before falling through to the
// existing organization_feature_toggles read. A category-off result
// short-circuits to false without a second round trip.
export const isOrgFeatureEnabled: (
  personId: string,
  organizationId: string,
  key: string,
) => Promise<boolean>;

export const ORG_FEATURE_CATALOG: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  category: OrgFeatureCategory; // NEW field, both existing entries -> "people"
}>;

export interface FeatureToggleEntry {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
  category: OrgFeatureCategory; // NEW
  categoryLabel: string; // NEW — DOMAIN_LABELS[category]
  categoryEnabled: boolean; // NEW — true when org_portal.feature_categories is
                            // off (axis inert) or when the category resolves
                            // enabled; false only when the flag is on AND an
                            // explicit off row exists
}
```

**New Server Action, `src/app/(org)/o/[slug]/admin/features/actions.ts`** (added alongside the existing `toggleFeatureAction`):

```ts
export async function toggleFeatureCategoryAction(
  slug: string,
  input: { category: string; enabled: boolean },
): Promise<ActionResult>;
```

Same plumbing shape as `toggleFeatureAction` — `auth()`, re-run `resolveOrgContext()`, never trust `organizationId` from the client — but this one **does** call `recordAudit()` itself, after `toggleOrgFeatureCategory()` returns `{ kind: "ok" }`, with:

```ts
await recordAudit({
  action: AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED,
  resourceType: "organization_feature_category",
  resourceId: input.category,
  metadata: {
    organizationId: resolved.org.organizationId,
    category: input.category,
    enabled: input.enabled,
    affectedFeatureKeys: ORG_FEATURE_CATALOG.filter(
      (entry) => entry.category === input.category,
    ).map((entry) => entry.key),
  },
});
```

`affectedFeatureKeys` may legitimately be `[]` for a category with no catalog entries yet (five of the six categories today — `ORG_FEATURE_CATALOG` is stale at 2 entries, already a tracked `docs/TODO.md` item, not this pipeline's job to grow). An empty array is an accurate audit statement ("this category mutation affected zero individually-toggleable features today"), not a bug.

## Data Model

New table `organization_feature_categories`, schema in `src/lib/db/domain/org-feature-categories.ts`, migration `drizzle/0039_presby_org_feature_categories.sql`:

```ts
import { pgTable, uuid, text, boolean, timestamp, index, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * The fourth gating axis (docs/work-log/2026-08-27-feature-categories.md,
 * Phase 3) — coarser than organization_feature_toggles, composed by
 * src/lib/org-feature-categories.ts and read into isOrgFeatureEnabled()'s
 * composition in src/lib/org-features.ts. Shape mirrors
 * organization_feature_toggles deliberately (composite PK, FORCE RLS,
 * tenant_isolation) — same table family, one level coarser.
 *
 * DEFAULT-ON: a missing row means the category is ENABLED. This is a
 * deliberate, stated deviation from organization_feature_toggles' own
 * "missing row -> false" convention — see src/lib/org-feature-categories.ts's
 * categoryEnabledInTx() for the full reasoning. Do not "fix" this table or
 * its resolver back to default-false without re-reading that comment; doing
 * so silently reintroduces a real regression for every org with existing
 * per-feature toggle state.
 *
 * CHECK CONSTRAINT, unlike feature_key (schema-layer-open, resolver-validated
 * only): category is a genuinely closed, six-value business taxonomy
 * (PortalDomain minus "administration"), not an open catalog mirroring
 * external flag-key strings. A CHECK is defense-in-depth specifically against
 * Phase 1 Gap 2 ("administration" must never become a selectable category) —
 * worth the schema-layer constraint here in a way it wasn't worth for
 * feature_key's intentionally open catalog.
 */
export const organizationFeatureCategories = pgTable(
  "organization_feature_categories",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    // Default true reinforces, but does not substitute for, the resolver's
    // own missing-row-> true convention: every write always sets this
    // explicitly (toggleOrgFeatureCategory), so this default is never
    // actually exercised by application code today — it exists so a row
    // inserted by some future path without an explicit value still lands on
    // the same semantic the missing-row convention implies, not the opposite.
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.category] }),
    index("organization_feature_categories_org_idx").on(t.organizationId),
    check(
      "organization_feature_categories_category_check",
      sql`${t.category} in ('people','worship','giving','governance','reports','communications')`,
    ),
  ],
);
```

Migration sketch (database-admin builds the real file; hand-written per CLAUDE.md's "db:generate is broken on a pre-existing snapshot collision" note):

```sql
create table if not exists organization_feature_categories (
  organization_id uuid not null references organizations(id) on delete cascade,
  category        text not null
    check (category in ('people','worship','giving','governance','reports','communications')),
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  primary key (organization_id, category)
);

create index if not exists organization_feature_categories_org_idx
  on organization_feature_categories (organization_id);

alter table organization_feature_categories enable row level security;
alter table organization_feature_categories force  row level security;
drop policy if exists tenant_isolation on organization_feature_categories;
create policy tenant_isolation on organization_feature_categories
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on organization_feature_categories
  to presby_app, presby_platform;
```

No F2 composite-FK concern (references only `organizations`, same as its sibling table). No new `permissions` catalog row — `org_features.manage` already exists (`drizzle/0026_presby_org_feature_toggles.sql`) and is reused. The new flag row (`org_portal.feature_categories`) is seeded from `scripts/seed.ts`, not this migration — matching `org_portal.features`'s own precedent (flags live in TS seed data, not SQL).

## Component / Page Plan

- **Pages to create:** none — extends the existing `/o/<slug>/admin/features` page.
- **Components to create:**
  - `src/app/(org)/o/[slug]/admin/features/feature-categories-list.tsx` — new client component, `FeatureCategoriesList({ slug, categories }: { slug: string; categories: FeatureCategoryEntry[] })`. Structurally identical to `features-list.tsx`'s existing `FeaturesList`/`FeatureToggleCard` (Card/CardContent, `min-h-11` row, optimistic revert-on-error, toast, `sr-only` state label) — same component, one level coarser, not a new visual pattern. Section intro copy: "Choose which ministry areas apply to your organization. All are on by default — turn any off if it doesn't apply to your congregation." (resolves Phase 1 Gap 8: this is fresh-install-friendly copy, not error copy, and — because of the default-on ruling — there is no actual empty/zero-state to design for: `offeredCategories()` is never empty for any of the five organization types, since every domain has at least one `orgTypeScope`-universal tile, confirmed in Phase 1's Org-Type Constraint finding).
- **Files to modify:**
  - `src/lib/db/domain/org-feature-categories.ts` — new schema file (see Data Model).
  - `src/lib/org-feature-categories.ts` — new resolver/CRUD module (see API Contract).
  - `src/lib/org-features.ts` — add `category` to both existing `ORG_FEATURE_CATALOG` entries (`org_portal.members_create` → `"people"`, `org_portal.sensitive_info` → `"people"`); compose `categoryEnabledInTx()` into `isOrgFeatureEnabled()`; extend `FeatureToggleEntry`; populate the three new fields in `listFeatureToggles()`.
  - `src/lib/audit.ts` — add `ORG_FEATURE_CATEGORY_TOGGLED: "tenant.org_feature_category.toggled"` to `AUDIT_ACTIONS`.
  - `src/app/(org)/o/[slug]/admin/features/page.tsx` — check `org_portal.feature_categories` before calling `listFeatureCategories()`; if forbidden, render the existing `FeaturesForbidden` state (reused, no new component) before ever calling `listFeatureToggles()`; on success, render `<FeatureCategoriesList>` above `<FeaturesList>`. `organizationType` (already on `resolved.org`, no new resolver call) threads through to `listFeatureCategories()`.
  - `src/app/(org)/o/[slug]/admin/features/actions.ts` — add `toggleFeatureCategoryAction()`.
  - `src/app/(org)/o/[slug]/admin/features/features-list.tsx` — `FeatureToggleCard` renders the `Switch` disabled (still shows the underlying nominal `toggle.enabled` state — Gap 5, preserve don't reset) with added copy "Turn on {categoryLabel} above to enable this." when `!toggle.categoryEnabled` (Gap 4).
  - `scripts/seed.ts` — new `org_portal.feature_categories` flag row, `enabled: false`.
  - `scripts/test-rls.sql` — new section mirroring the existing `organization_feature_toggles`/`org_features.manage` section: FORCE RLS cross-tenant isolation, default-on-row-absent behavior, explicit-off restriction, CHECK constraint rejection of `"administration"`.
  - `docs/decisions.md` — DECISION-130 (this phase's implementation calls: flag semantics, the audit-split departure forced by the one-directional import, the CHECK-constraint departure from `feature_key`'s precedent).

## Implementation Order

1. Schema — `organizationFeatureCategories` (`src/lib/db/domain/org-feature-categories.ts`) → `npm run db:push` on a Neon branch → hand-written `drizzle/0039_presby_org_feature_categories.sql` (FORCE RLS, CHECK, grants) as the committed source of truth.
2. `scripts/seed.ts` — `org_portal.feature_categories` flag row, seeded OFF.
3. `AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED` in `src/lib/audit.ts`.
4. Resolver/CRUD — `src/lib/org-feature-categories.ts` (`OrgFeatureCategory`, `offeredCategories()`, `isCategoryKey()`, `categoryEnabledInTx()` with the default-on behavior and its loud comment, `isOrgFeatureCategoryEnabled()`, `listFeatureCategories()`, `toggleOrgFeatureCategory()`).
5. `src/lib/org-features.ts` — catalog `category` field, `isOrgFeatureEnabled()` composition, `FeatureToggleEntry` extension, `listFeatureToggles()` population.
6. `src/app/(org)/o/[slug]/admin/features/actions.ts` — `toggleFeatureCategoryAction()`, including the `recordAudit()` call with the full `affectedFeatureKeys` enumeration.
7. UI — `page.tsx` (flag check, `listFeatureCategories()` call, render order), new `feature-categories-list.tsx`, `features-list.tsx`'s disabled+explained state.
8. Tests, written by the implementer (Phase 4 gate): unit coverage in a new `org-feature-categories.test.ts` (default-on when row absent, explicit-off restricts, `isCategoryKey` rejects `"administration"` and garbage strings, `offeredCategories()` per organization type including presbytery-only tiles); a composition test added to the existing `org-features.test.ts` (category off → `isOrgFeatureEnabled()` false even when the toggle itself is on; flag off → category ignored, prior behavior unchanged); `actions.test.ts` and `features-list.test.tsx`/`features-states.test.tsx`/`page.test.tsx` extended for the new section, the disabled-card state, and mobile (`min-h-11`) verification; `scripts/test-rls.sql` new section.
9. `docs/decisions.md` DECISION-130 — written this phase (see below), not deferred to Phase 4.

Release notes, `docs/TODO.md` reconciliation, and `docs/product/functionality-map.md` are Phase 6 ownership (Rules 10/14), not this phase — the tile-visibility deferral (Gap/Open Question, ruling #6) is already recorded in `docs/TODO.md` by the orchestrator; no further action needed there this phase.

## Edge Cases & Risks

1. **Default-on convention deviation (ruling #1).** The single highest-risk item in this design if a future reader "fixes" the resolver back to `?? false` without reading the comment. Mitigated by: the loud comment on both the schema file and `categoryEnabledInTx()` itself, and a dedicated Phase 4 unit test asserting the default-on behavior explicitly by name (not just incidentally passing).
2. **Circular-import avoidance forces the audit-emission split (ruling #3).** `org-feature-categories.ts` must not import `ORG_FEATURE_CATALOG` from `org-features.ts` — `org-features.ts` already imports `categoryEnabledInTx` the other direction, and a two-way dependency between those files is a real cycle, not a style nit. Consequence: `toggleOrgFeatureCategory()` does not call `recordAudit()` itself, unlike its sibling `toggleOrgFeature()` — the Server Action does, where both modules are importable without a cycle. This also happens to satisfy `npm run check:audit` cleanly (it scans `src/app/**/actions.ts` bodies for an `AUDIT_ACTIONS` reference), the same way `org-features.ts`'s own header comment already had to justify its opposite choice for `toggleOrgFeature()`.
3. **`ORG_FEATURE_CATALOG` staleness (pre-existing, tracked separately in `docs/TODO.md`).** Only the `"people"` category has any catalog entries today. Turning any of the other five categories off has zero observable effect on today's `FeaturesList` — this is accurate, not a bug, but QA should not expect visible per-feature consequences for Worship/Giving/Governance/Reports/Communications until that catalog grows. Named so Phase 5 doesn't file it as a regression.
4. **`offeredCategories()` inherits `visiblePortalTiles()`'s existing org-type-scoping behavior verbatim**, including the fact that a tile with no `orgTypeScope` is a candidate for every organization type (synod/GA included) — a synod admin will see "Governance & Courts" as offered even though session/officer structures are congregation-specific in practice. This is a pre-existing property of the tile registry, not something this design introduces or is scoped to fix (Phase 1's own Org-Type Constraint ruling deliberately avoided building a new mapping for exactly this reason).
5. **Preserve-not-reset (Gap 5) is satisfied by construction, not by special-case code.** `organization_feature_categories` and `organization_feature_toggles` are independent tables with no cascading write between them — toggling a category off/on never touches a feature's own toggle row. Worth stating explicitly so a future refactor doesn't "helpfully" add a reset-on-disable behavior.
6. **Redundant permission check, accepted.** `page.tsx` calls `listFeatureCategories()` and (if that succeeds) `listFeatureToggles()`, each independently re-checking `org_features.manage` inside its own transaction — a second `presby_has_permission()` round trip for the same answer. This matches this codebase's existing belt-and-suspenders posture (every list/toggle function re-checks despite the page-level gate already having run) rather than being DRY-optimized into one combined query; not a bug, a deliberate minor cost.
7. **No backfill migration required.** The default-on ruling closes this entire risk class rather than mitigating it — there is no day-one regression for any org with existing per-feature toggle state, so there is nothing to reconcile or dry-run before cutover.
8. **Server-side enforcement (ruling #5, Phase 1's adversarial-pass finding) is satisfied for every existing call site for free**, because the composition lives inside `isOrgFeatureEnabled()` itself: `admin/members/page.tsx`, `admin/members/new/page.tsx`, `admin/members/[id]/edit/page.tsx`, `admin/members/[id]/edit/sensitive/page.tsx`, and `admin/members/pending/page.tsx` all already call `isOrgFeatureEnabled()` before rendering — no call site needs to be touched to inherit the new axis.
9. **Mobile (360px), Gap 10.** `FeatureCategoriesList`/`FeatureCategoryCard` reuses `FeatureToggleCard`'s existing `min-h-11` row and `min-h-11 min-w-11` switch-label wrapper verbatim — no new touch-target pattern to verify, but Phase 5/6 must still confirm in a real 360px viewport per the Verify-in-a-Browser invariant (a passing build is not evidence).

## Implementer

**database-admin**, then **full-stack-developer** — not a three-way api/ux split, for the same reason DECISION-116 (`2026-08-26-presbytery-functionality`) named for a comparably-sized feature: one permission gate reused (no new key to design), one small resolver/CRUD module that mirrors an existing sibling file closely enough that there's little judgment left to divide, and a UI addition that is one new card component plus a conditional branch in an already-existing card — no client/server complexity that doesn't already fold cleanly into the `ListFeatureCategoriesResult`/`ToggleOrgFeatureCategoryResult` variant shapes this design specifies. A three-way split here would hand two small, tightly coupled halves (the composition inside `isOrgFeatureEnabled()`, and the UI that reads its output) across two agents for no coordination benefit — the same test DECISION-116 applied. database-admin goes first only because the table and its RLS policy are a hard prerequisite for everything else; full-stack-developer then owns the resolver module, the `org-features.ts` composition, the Server Action, and the UI as one coherent pass.

---

# Phase 4 — Implementation

## database-admin slice

**Date:** 2026-08-27
**Scope:** schema + migration only, per Phase 3's implementer split (database-admin → full-stack-developer). The resolver/CRUD module (`src/lib/org-feature-categories.ts`), `org-features.ts` composition, `AUDIT_ACTIONS` entry, Server Action, seed flag row, and UI are the next slice's (full-stack-developer's) — not built here.

### Files Created

- `src/lib/db/domain/org-feature-categories.ts` — the `organizationFeatureCategories` Drizzle table exactly per Phase 3's Data Model: composite PK `(organization_id, category)`, `enabled boolean not null default(true)` (default-on, DECISION-130), `updated_at`/`updated_by`, `organization_feature_categories_org_idx` on `organization_id`, and a schema-layer `check()` constraint restricting `category` to the closed six-value set (`'people','worship','giving','governance','reports','communications'`) — the deliberate departure from `organization_feature_toggles.feature_key`'s unconstrained precedent, per DECISION-130. Header comment states the default-on deviation loudly, matching Phase 3's instruction not to let a future reader "fix" it back to default-false.
- `drizzle/0040_presby_org_feature_categories.sql` — hand-authored migration (per CLAUDE.md, `db:generate`/`db:migrate` are both documented-broken in this repo, `docs/TODO.md`): `create table if not exists`, the CHECK constraint, the org index, `enable`/`force row level security`, `drop policy if exists` + `create policy tenant_isolation` (standard `organization_id = presby_current_org()` shape, matching `drizzle/0026_presby_org_feature_toggles.sql`'s), and `grant select, insert, update, delete` to `presby_app, presby_platform`. No permission-catalog insert — `org_features.manage` already exists (`drizzle/0026`) and is reused unchanged per DECISION-130/Phase 3, no new key minted. No `app_roles`/`role_grants` seeding, matching 0026's own precedent (org-scoped role tables have no production seeding surface in a migration). The new `org_portal.feature_categories` flag row is explicitly *not* seeded here — it's TS seed data, `scripts/seed.ts`, the next slice's job.

### Files Modified

- `src/lib/db/domain/index.ts` — added `export * from "./org-feature-categories";` to the domain barrel, alongside the existing `org-features` export, so the table is visible through `src/lib/db/schema.ts`'s `export * from "./domain"` re-export (drizzle.config.ts points at `schema.ts`).

### Schema Changes

- New table: `organization_feature_categories` (`organization_id uuid`, `category text` [CHECK-constrained], `enabled boolean default true`, `updated_at timestamptz`, `updated_by uuid`). Composite PK `(organization_id, category)`. FORCE ROW LEVEL SECURITY with a standard `tenant_isolation` policy. No new columns on any existing table. No new `permissions` catalog row (reuses `org_features.manage`).
- **Applied via:** hand-authored migration, `psql "$MIGRATE_DATABASE_URL" -f drizzle/0040_presby_org_feature_categories.sql`, run directly against the live Neon dev database (not a branch — this repo's documented mechanism per `docs/testing.md`/CLAUDE.md, since `db:push`/`db:generate`/`db:migrate` are all either lossy-only or broken here). **Not `db:push`** — this ships, so the versioned SQL migration is the source of truth per the house convention, matching every migration since `0013`.
- **Migration numbering note:** highest migration on disk at claim time was `0038`; the concurrently in-flight `2026-08-27-staff-and-personnel` pipeline's own work-log had already named `drizzle/0039_presby_staff_and_personnel.sql` as its next sequential file (guidance text, not yet materialized on disk at the time I checked, and confirmed still absent immediately before I applied mine). To avoid the exact numbering collision `docs/TODO.md`'s in-flight log already records happening once before (`0031`, 2026-08-26), I claimed `0040` instead of `0039`. `0039_presby_staff_and_personnel.sql` materialized on disk mid-task (that pipeline's own database-admin slice running concurrently, confirmed by its barrel-export addition — `export * from "./staff";` — appearing in `src/lib/db/domain/index.ts` alongside mine); I initially registered my `drizzle/meta/_journal.json` entry as `idx: 39` before that file appeared, then bumped it to `idx: 40` once `0039` existed on disk, to leave `idx: 39` free for that pipeline's own journal entry and avoid an idx collision on top of the filename near-miss. The journal's own idx sequence already has a pre-existing gap at 26–28, unrelated to this pipeline, so idx and filename-prefix are not strictly 1:1 in this repo regardless — but matching them where possible keeps the file readable.

### Audit Events

- None written by this slice — no mutation code exists yet at the schema/migration layer. `AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED` is the next slice's addition (`src/lib/audit.ts`), called from the Server Action per DECISION-130's audit-split ruling, not from the lib layer.

### Implementer Notes

- **Verification performed** (live, against the dev database, via `psql`):
  1. Table exists with the expected columns, PK, FK, and CHECK constraint (`\d organization_feature_categories`).
  2. `relrowsecurity` and `relforcerowsecurity` both `t` on `pg_class`; the `tenant_isolation` policy is present in `pg_policies` with the expected `USING`/`WITH CHECK` clauses.
  3. CHECK constraint verified live: `insert ... category = 'administration'` raises `check constraint "organization_feature_categories_category_check"` violated — confirms Phase 1 Gap 2 (administration must never be selectable) is enforced at the schema layer, not just by convention.
  4. RLS enforcement verified live as `presby_app` (the app's actual runtime role, via `DATABASE_URL`, not the migration-owner role): unset `app.current_org_id` GUC → table reads as empty; GUC set to a fixture org → sees only that org's row; GUC set to a different org → a known cross-org `(organization_id, category)` lookup returns zero rows; and an explicit cross-org write attempt (GUC set to org B, `INSERT` naming org A's `organization_id`) raises `insufficient_privilege`, confirming the `WITH CHECK` clause rejects it, not just the `USING` clause filtering reads.
  5. All test fixture rows were deleted after verification (`delete from organization_feature_categories ...`) — the dev database is left with zero rows in the new table, no stray data.
- **No backfill migration** — per the architect's Phase 2 re-run ruling (overturning Phase 1's own AND-composition-plus-backfill recommendation) and DECISION-130, this axis is default-on by construction (both the column default and, more importantly, the resolver's missing-row semantics the next slice builds), so there is no day-one regression class to backfill against. Confirmed nothing in this slice's scope needed a data migration beyond the table itself.
- **Did not touch:** `src/lib/org-features.ts` (existing), `src/lib/org-feature-categories.ts` (resolver/CRUD — does not exist yet, next slice's job), `src/app/(org)/o/[slug]/admin/features/actions.ts`, any UI, `scripts/seed.ts`, `scripts/test-rls.sql` — all explicitly out of scope for this slice per the task boundary and Phase 3's implementer split.
- `npm run typecheck` — PASS (clean, no errors) after the schema file and barrel-export addition.

### Handoff to full-stack-developer

New table available: `organizationFeatureCategories` (Drizzle export from `src/lib/db/domain/org-feature-categories.ts`, re-exported through `src/lib/db/schema.ts`). Shape: `(organizationId, category, enabled, updatedAt, updatedBy)`, composite PK, default-on (`enabled` defaults `true`; **the resolver you build must independently implement missing-row-means-enabled — the column default alone does not cover an absent row**, per DECISION-130 and Phase 3's `categoryEnabledInTx()` spec). `category` is schema-CHECK-constrained to the six-value set — your resolver-layer `isCategoryKey()` guard should still exist as defense-in-depth (Phase 3 spec), but the database itself will now also reject `"administration"` or any garbage string outright, which you can exercise in a unit test by expecting the underlying insert/update to throw rather than silently accept.

To apply locally: `psql "$MIGRATE_DATABASE_URL" -f drizzle/0040_presby_org_feature_categories.sql` (already applied to the shared dev database as of this slice — no re-apply needed unless working against a fresh branch/environment). No seed change was made in this slice, so `npm run db:seed` is not required by this slice alone, but you will need it after adding the `org_portal.feature_categories` flag row to `scripts/seed.ts`.

Next: **full-stack-developer** — resolver/CRUD module, `org-features.ts` composition, `AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED`, Server Action, seed flag row, UI, and the full Phase 4 test suite named in Phase 3's Implementation Order steps 4–9 (including `scripts/test-rls.sql`'s new section, which this slice deliberately left untouched).

---

## full-stack-developer slice

**Date:** 2026-08-27
**Scope:** resolver/CRUD module, `org-features.ts` composition, `AUDIT_ACTIONS` entry, Server Action, UI, seed flag, and the full test suite (Phase 3 Implementation Order steps 4–9) — the second and final Phase 4 slice, built against the database-admin slice's already-applied schema and its handoff notes above.

### Files Created

- `src/lib/org-feature-categories.ts` — the resolver/CRUD module, built exactly to Phase 3's API Contract:
  - `OrgFeatureCategory` (`Exclude<PortalDomain, "administration">`) and a private `isCategoryKey()` guard (defense-in-depth alongside the schema CHECK constraint).
  - `offeredCategories(organizationType)` — pure, synchronous, derived from `PORTAL_TILES` (`distinct(tile.domain)` filtered by `orgTypeScope`, excluding `"administration"`), never a hand-maintained mapping. Deliberately NOT filtered by `flagKey`/`isFlagEnabled()`.
  - `categoryEnabledInTx(tx, organizationId, category)` — the DEFAULT-ON resolver, loudly commented as a deliberate deviation from this codebase's "missing row → false" convention (matching the register `org-features.ts`/`flags.ts` use for their own load-bearing comments). Does NOT itself consult the `org_portal.feature_categories` flag — that is the caller's job (see below).
  - `isOrgFeatureCategoryEnabled(personId, organizationId, category)` — public, `cache()`-wrapped, standalone convenience wrapper. Invalid category → `false`; flag off → `true` unconditionally, no DB read.
  - `listFeatureCategories(viewerPersonId, organizationId, organizationType)` → `ListFeatureCategoriesResult` — gated on `org_features.manage` (own private `hasOrgFeaturesManage()` copy, one-permission-per-file convention).
  - `toggleOrgFeatureCategory(actorPersonId, organizationId, actorUserId, category, enabled)` → `ToggleOrgFeatureCategoryResult` (`ok | forbidden | invalid_category`) — check-then-write only, **no `recordAudit()` call** (DECISION-130's forced audit split — this module cannot import `ORG_FEATURE_CATALOG` from `org-features.ts` without creating a real import cycle, since `org-features.ts` already imports `categoryEnabledInTx` the other way).
- `src/app/(org)/o/[slug]/admin/features/feature-categories-list.tsx` — new client component, `FeatureCategoriesList({ slug, categories })`, structurally identical to `features-list.tsx`'s own `FeaturesList`/`FeatureToggleCard` (Card/CardContent, `min-h-11` row, optimistic revert-on-error, toast, `sr-only` state label). Section intro copy is fresh-install-friendly ("All are on by default — turn any off if it doesn't apply to your congregation"), distinct from `FeaturesList`'s own "No optional features yet" empty state (Phase 1 Gap 8) — there is in fact no empty state to design for here, since `offeredCategories()` is never empty for any organization type.
- `src/app/(org)/o/[slug]/admin/features/feature-categories-list.test.tsx` — client-component tests: fresh-install copy, optimistic toggle + rollback-on-error, multi-category rendering.
- `src/lib/org-feature-categories.test.ts` — Postgres-backed integration suite (same harness as `org-features.test.ts`: `hasDb` skip-guard, dynamic imports in `beforeAll`, self-contained fixture create/teardown). Covers `offeredCategories()` (also placed here, not a separate mocked file — see the file's own header for why: any import of this module, even for a DB-free function, drags in `@/lib/db/schema` via the schema file's `../schema` import for `users`, and importing that chain in isolation without `@/lib/db` "priming" the module graph first reproduces a **pre-existing, already-shipped** circular-import fragility — confirmed by reproducing the identical crash importing the sibling `org-features.ts` schema file the same way, not something this pipeline's schema file introduces), `categoryEnabledInTx()`'s default-on behavior, an explicit off/on row, `toggleOrgFeatureCategory()`'s forbidden/invalid_category/CHECK-constraint-defense-in-depth/idempotent-upsert paths, cross-org isolation, `listFeatureCategories()`'s forbidden/default-on-listing paths, and `isOrgFeatureCategoryEnabled()`'s invalid-category path. Run for real: `dotenv -e .env.local -- vitest run src/lib/org-feature-categories.test.ts` — **actually run against the shared dev database this slice** (not just typechecked): all tests pass (see Implementer Notes).

### Files Modified

- `src/lib/org-features.ts` — the fourth-axis composition (DECISION-130), documented as a named axis in the file's own header per the architect's Phase 2 instruction (not described as "just derivation"):
  - `ORG_FEATURE_CATALOG` — both existing entries (`org_portal.members_create`, `org_portal.sensitive_info`) gain `category: "people"`.
  - `isOrgFeatureEnabled()` — signature unchanged. Internally: looks up the catalog entry's category, reads `org_portal.feature_categories` once (outside the transaction), then — only when that flag is on — calls `categoryEnabledInTx()` inside the SAME `withOrgContext` transaction as the existing toggle read, short-circuiting to `false` on a category-off result without the second round trip.
  - `FeatureToggleEntry` — three new fields: `category`, `categoryLabel`, `categoryEnabled` (`true` when the flag is off — axis inert — or the category resolves enabled; `false` only when the flag is on AND an explicit off row exists).
  - `listFeatureToggles()` — populates the three new fields per catalog entry, caching one `categoryEnabledInTx()` call per DISTINCT category (not one per catalog entry) for the duration of the call.
- `src/lib/audit.ts` — new `AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED: "tenant.org_feature_category.toggled"`, documented as written from the Server Action (not the lib layer), a deliberate divergence from `ORG_FEATURE_TOGGLED`'s own audit-in-lib split.
- `src/lib/audit.test.ts` — added the new key to the exhaustive `AUDIT_ACTIONS` regression-guard map (the file fails at `tsc` if any entry is missing).
- `src/app/(org)/o/[slug]/admin/features/actions.ts` — new `toggleFeatureCategoryAction(slug, { category, enabled })`: `auth()`, re-run `resolveOrgContext()`, calls `toggleOrgFeatureCategory()`, and — unlike its sibling `toggleFeatureAction` — **does** call `recordAudit()` itself after a successful write, computing `affectedFeatureKeys` by filtering `ORG_FEATURE_CATALOG` (importable here with no cycle) by the mutated category. `category` is validated server-side against the closed allowlist by `toggleOrgFeatureCategory()` itself (`invalid_category` result), mirroring `isCatalogKey()`'s existing pattern for `feature_key`.
- `src/app/(org)/o/[slug]/admin/features/actions.test.ts` — extended: `ORG_FEATURE_CATALOG` and `@/lib/audit` are now mocked in this file (previously `@/lib/audit` was deliberately unmocked, to prove `toggleFeatureAction` never imports it — that proof is now done by asserting `mockRecordAudit` was never called, since the mock must exist for the new action's own tests); full identity-resolution and result-mapping coverage for `toggleFeatureCategoryAction`, including the `affectedFeatureKeys` enumeration (both real entries, and the empty-array case for a category — e.g. `worship` — with zero catalog entries today).
- `src/app/(org)/o/[slug]/admin/features/page.tsx` — checks `org_portal.feature_categories` (a second, independent flag from `org_portal.features`) after the existing flag/permission gate; when on, calls `listFeatureCategories()` **before** `listFeatureToggles()`, rendering `FeaturesForbidden` immediately on a forbidden result without ever reaching the toggle list (Phase 1 Flow 1's "must not partially render before that check runs"); renders `<FeatureCategoriesList>` above `<FeaturesList>` when categories were fetched.
- `src/app/(org)/o/[slug]/admin/features/page.test.tsx` — added a `mockFlags({ features, categories })` helper so the two independent flags can be controlled separately (every pre-existing test defaults `categories: false`, preserving its original, narrower intent unchanged); new tests for the category-flag-off/on paths, call ordering (categories before toggles), and the forbidden short-circuit.
- `src/app/(org)/o/[slug]/admin/features/features-list.tsx` — `FeatureToggleCard` now renders **disabled + explained**, not silently inert, when `!toggle.categoryEnabled` (Phase 1 Gap 4): dimmed card, "Turn on {categoryLabel} above to enable this." copy, `disabled` on the `Switch`, and the same explanation folded into the `sr-only` accessible label. The switch still shows the toggle's own nominal `enabled` state underneath — preserve-not-reset (Gap 5) is satisfied by construction (the category table and the toggle table are independent, never cross-written), not by special-case code.
- `src/app/(org)/o/[slug]/admin/features/features-list.test.tsx` — `TOGGLE` fixture extended with the three new fields; new tests for the disabled+explained state, the click-is-a-no-op behavior, preserve-not-reset, and the category-on baseline (no explanatory copy, switch not disabled).
- `scripts/seed.ts` — new `org_portal.feature_categories` flag row, seeded **OFF**, placed alongside the other real (non-placeholder-block) `org_portal.*` flags, documented as dual-purpose (UI gate + axis kill-switch) per DECISION-130.
- `scripts/test-rls.sql` — new **§30** (highest existing section was §29): FORCE-RLS tenant isolation (own-row read, cross-org read returns zero, cross-org write rejected), the CHECK constraint rejecting `'administration'` and an arbitrary garbage value (defense-in-depth underneath the resolver's own `isCategoryKey()` guard), FORCE RLS presence, and the `presby_app` grant shape — mirroring §19's own `organization_feature_toggles` proof. **Actually run against the shared dev database** (not just written): all assertions pass (see Implementer Notes for the two bugs found and fixed while doing so).
- `src/lib/org-features.test.ts` — extended with a fourth-axis composition suite inside the existing `hasDb`-gated block: `isOrgFeatureEnabled()` under (flag off + category off row → no effect, axis inert), (flag on + category off → `false` despite the toggle being on), (flag on + row absent → falls through to the toggle, default-on unchanged behavior), (flag on + category on explicitly → still respects the toggle's own off state); `listFeatureToggles()`'s `categoryEnabled` field under flag off/on. New `setCategoryAxisFlag()`/`setCategoryRow()` helpers, with `afterEach` restoring the flag to its seeded-OFF default so this suite never leaks state into a shared dev database across runs.
- `docs/decisions.md` — DECISION-130 was already written by tech-lead in Phase 3; not modified by this slice.

### Schema Changes

None — see database-admin slice above. This slice added zero new columns, tables, or migrations; it consumes `organizationFeatureCategories` exactly as handed off.

### Audit Events

- `AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED` (`tenant.org_feature_category.toggled`), written from `toggleFeatureCategoryAction()` (`src/app/(org)/o/[slug]/admin/features/actions.ts`), never from the lib layer (DECISION-130's forced split). `resourceType: "organization_feature_category"`, `resourceId: <category>`, `metadata: { organizationId, category, enabled, affectedFeatureKeys }` — `affectedFeatureKeys` names every `ORG_FEATURE_CATALOG` entry under the mutated category (currently both entries for `"people"`, `[]` for the other five categories — an accurate statement, not a bug, per Phase 3's Edge Cases §3).

### Feature Gates

- **Permission:** `org_features.manage` (existing, tier 1, reused unchanged) — checked inside `listFeatureCategories()` and `toggleOrgFeatureCategory()`, same as the existing per-feature toggle functions.
- **Flag:** `org_portal.feature_categories` (new, seeded OFF in `scripts/seed.ts`). Dual purpose, both named explicitly in the seed comment and in code: (1) UI gate for the category-picker section on `/o/<slug>/admin/features`; (2) axis kill-switch — `isOrgFeatureEnabled()`'s composition only consults the category table when this flag is on; off, every category resolves enabled with no DB read, a true rollback of the mechanism.
- Run `npm run db:seed` to pick up the new flag row in a local/dev database that predates this slice.

### Implementer Notes

- **Server-side enforcement confirmed, not just page-render gating** (Phase 1's adversarial-pass requirement): the composition lives inside `isOrgFeatureEnabled()` itself, so every existing call site (`admin/members/page.tsx`, `admin/members/new/page.tsx`, `admin/members/[id]/edit/page.tsx`, `admin/members/[id]/edit/sensitive/page.tsx`, `admin/members/pending/page.tsx`) inherits the new axis with zero changes at the call site — verified by reading `org-features.ts`'s only export surface, not by re-auditing every call site individually (none needed touching).
- **Two bugs found and fixed while actually running `scripts/test-rls.sql`'s new section against the dev database** (not just eyeballing the SQL):
  1. psql's `:VAR` substitution does not descend into a `do $$ ... $$` PL/pgSQL body — every exception-proof block elsewhere in this file already uses a literal UUID string inside such a block rather than a psql variable, and my first draft of the CHECK-constraint proofs used `:ALDER` inside one, which fails with a raw SQL syntax error at the server (psql passes the literal `:ALDER` text through unsubstituted). Fixed by using the literal org id string, matching the file's own established convention.
  2. A `--` comment INSIDE a `do $$ ... $$` body that itself contains the two-character sequence `$$` (I had written "a $$-quoted PL/pgSQL body" in an explanatory comment) prematurely closes the dollar-quoted string at the database parser level — dollar-quote termination is not comment-aware. Fixed by moving the explanatory comment outside the `do $$` block, before it.
  Both fixes are now load-bearing precedent comments in the new section itself, not just fixed silently.
- **The `offeredCategories()`-needs-its-own-DB-free-test-file idea was tried and abandoned.** A first pass split it into a separate file mocking `@/lib/authz`/`@/lib/flags` at the module boundary (the `org-portal/tiles.test.ts` pattern) so it could run with no `DATABASE_URL`. This reproduced a **pre-existing** circular-import fragility: `src/lib/db/domain/org-feature-categories.ts` (like its already-shipped sibling `src/lib/db/domain/org-features.ts`) imports `../schema` for `users`, and `db/schema.ts` ends with `export * from "./domain"`, re-entering the domain barrel mid-evaluation when the ENTRY point into the module graph is a domain file rather than `@/lib/db` itself. Confirmed live: importing either schema file (mine or the pre-existing `org-features.ts` one) as the first import in an isolated file throws `organizationType is not a function` from `db/domain/authz.ts`, regardless of any of my own mocks. This is out of this pipeline's scope to fix (it is a property of the existing schema module graph, not something either schema file does wrong on its own), so `offeredCategories()`'s tests were folded into the existing `hasDb`-gated integration suite instead, matching `org-features.ts`'s own precedent of having zero DB-free test coverage for any of its exports.
- **`npm run typecheck`: PASS** (clean, zero errors).
- **`npm test -- --run`: PASS** — 2997 passed, 0 failed, 600 skipped (600 includes every DB-gated integration `it` across the whole suite, not just this feature's — `npm test` does not set `DATABASE_URL`).
- **`dotenv -e .env.local -- vitest run src/lib/org-feature-categories.test.ts src/lib/org-features.test.ts`: PASS** — 30 passed, 0 failed, against the real shared dev database (both this feature's own integration suite and the extended fourth-axis composition suite in `org-features.test.ts`).
- **`npm run check` (all four tripwires): PASS** — audit-coverage, sql-date, deps-drift, brand-scope all clean.
- **`scripts/test-rls.sql` §30: run for real against the shared dev database** (`psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f <header + §30 extract>`) — all assertions pass. The FULL file was also attempted end-to-end and aborts at a **pre-existing, already-documented** failure in §4 (a membership-count drift the file's own comment already names as a known, unreconciled artifact of a prior session's live-DB-only pollution — "Flagged, not reconciled, per that same walk's own explicit instruction not to touch this file for that drift"), unrelated to this feature; confirmed by reading that section's own comment rather than assuming, and re-verified §30 in isolation (extracting just the `\set` header plus §30's own body into a standalone script) to prove this feature's own section is unaffected by and does not depend on the unrelated failure ahead of it.
- **Browser verification: NOT performed.** I do not have a way to drive a real browser/visual check from this environment for this task. What I verified instead, and what still needs a real 360px browser pass before Phase 5 signs off: `min-h-11`/`min-w-11` touch-target classes are present verbatim on the new component (copied from `FeatureToggleCard`, not reinvented), and the jsdom-rendered DOM tree (visible in the test failure diffs while iterating) shows the expected structure (Card → CardContent → flex row → label/Switch), but neither of those is evidence of correct rendering on a real 360px viewport, spacing, or the dimmed/disabled visual treatment reading correctly at a glance. Flagging this explicitly per CLAUDE.md's Verify-in-a-Browser invariant rather than claiming a check I could not perform.
- **Concurrency note:** this working tree is shared with at least one other concurrently in-flight pipeline (`2026-08-27-staff-and-personnel`) during this slice. At one point mid-session `scripts/test-rls.sql`'s own diff and the repository's `HEAD`/stash state were observed to change transiently between two consecutive read-only `git` commands, consistent with a concurrent process's own git activity in the same working directory rather than any action taken by this slice. All of this slice's files were re-verified intact (via `git diff --stat`) immediately afterward before proceeding, and no destructive git command (reset, checkout, stash pop of a non-own stash) was run against the shared tree at any point in this slice.

### Handoff to qa (Phase 5)

**What to test in the browser** (this slice could not do this itself — see above):
1. Seed `org_portal.feature_categories` to `true` (either via `scripts/seed.ts` + `npm run db:seed`, or a direct `feature_flags` row update) and load `/o/<slug>/admin/features` as a holder of `org_features.manage` (dev fixture: `stated_clerk`, Tobias Renwick at Alder Creek). Confirm the new "Ministry areas" section renders above the existing feature list, all six categories show as ON by default, and toggling one off then back on works (optimistic switch, toast, no page reload needed after `router.refresh()`).
2. Turn "People & Membership" off, confirm "Add & approve members" (and "Tiered sensitive information") render dimmed/disabled with "Turn on People & Membership above to enable this." copy, and that clicking the disabled switch does nothing.
3. Turn it back on, confirm the per-feature toggle's own prior on/off state is exactly as it was before (preserve-not-reset).
4. At 360px viewport: confirm both the category cards and the now-sometimes-disabled feature cards keep readable spacing and a ≥44px effective tap target, per CLAUDE.md's Verify-in-a-Browser invariant.
5. With `org_portal.feature_categories` OFF, confirm the features page looks and behaves exactly as it did before this pipeline (no category section, no per-feature disabled state) — the flag's "true rollback" property.
6. Confirm a member without `org_features.manage` still gets the existing `FeaturesForbidden` state with the category flag on (no partial render of the category section first).

**Everything else** (resolver logic, composition, audit event shape, RLS/CHECK isolation, Server Action mapping, component unit behavior) has been proven by the automated suites listed under Implementer Notes above, including two suites actually run against the real dev database, not merely typechecked.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS**

## Unit Tests

Full suite (`npm test -- --run`): Total: 3597 | Passed: 2997 | Failed: 0 | Skipped: 600 | Duration: 10.64s. The 600 skipped are the pre-existing repo-wide `hasDb`-guard pattern (no `DATABASE_URL` set for the plain `npm test` run), independently confirmed not a hidden-skip problem by re-running with `DATABASE_URL` set below.

DB-backed suites specific to this feature (`dotenv -e .env.local -- npx vitest run src/lib/org-feature-categories.test.ts src/lib/org-features.test.ts`, run twice incl. `--reporter=verbose`): Total: 30 | Passed: 30 | Failed: 0. Confirmed by name, not count alone: `categoryEnabledInTx: DEFAULT-ON — true on a missing row`, `an explicit enabled=false row restricts`, `toggleOrgFeatureCategory: invalid_category on 'administration' ... and on garbage`, `the CHECK constraint independently rejects 'administration'`, cross-org isolation, and the fourth-axis composition suite (4 tests) added to `org-features.test.ts`.

Non-DB feature-touched suites (`actions.test.ts`, `features-list.test.tsx`, `page.test.tsx`, `feature-categories-list.test.tsx`): Total: 54 | Passed: 54 | Failed: 0.

Coverage (v8, scoped): `src/lib/org-feature-categories.ts` 90.69% stmts / 85.71% branch / 92.85% funcs (uncovered: 187–191, `isOrgFeatureCategoryEnabled()`'s cache-wrapper flag-consultation branch — no Phase 4 call site exercises it yet); `src/lib/org-features.ts` 100% stmts / 90% branch / 100% funcs.

## End-to-End Tests

Not auth-touching — the stricter e2e gate doesn't apply. No Playwright spec exists for this feature — that gap stands, tracked as a follow-up below.

**Real-browser verification performed 2026-08-27 (orchestrator, closing the gap QA correctly flagged as outstanding).** Neither the implementer nor QA had browser-driving capability in their environments; the orchestrator does (Playwright via `playwright-core`, already a devDependency, same recipe used earlier in this session for the brand-kit work). Method: temporarily granted `org_features.manage` to the `org-single` e2e fixture (`org1@presby.invalid`) at its own org (`e2e-alpha`), temporarily flipped `org_portal.feature_categories` on globally, drove the real `/o/e2e-alpha/admin/features` page with the cached e2e `storageState` (no login/2FA flow needed), then fully reverted every change (deleted the temporary role/grant/toggle/category rows, flipped the flag back off) — verified clean afterward via direct query.

Confirmed live, against all six of the implementer's named manual-check items:
1. **Ministry-areas section renders** at desktop (1280px) and mobile (375px) — six category cards, each a `min-h-11` row, matching `FeatureToggleCard`'s existing pattern.
2. **DEFAULT-ON confirmed live, not just unit-tested**: with zero `organization_feature_categories` rows for this org, all six categories rendered ON on first load — the single most consequential design decision in this feature, seen actually working against a real request, not just the resolver's own unit test.
3. **Disabled+dimmed feature-card state renders correctly**, with the exact copy specified ("Turn on People & Membership above to enable this."), `opacity-70` on the card, switch genuinely `disabled` (confirmed via `getAttribute("disabled")`, not just visually) — reflected correctly both immediately after the same-session toggle (once `router.refresh()`'s async round-trip completes, confirmed resolving within 500ms on a warm route — an initial 1-second-wait check on a cold route briefly read stale, which is ordinary `router.refresh()` latency, not a defect; ruled out by polling rather than assumed) and after a full page reload.
4. **Preserve-not-reset confirmed live**: turned a feature toggle ON, turned its category OFF (toggle visually disabled but state preserved underneath), turned the category back ON — the feature toggle returned to ON with no code path "restoring" it, exactly as `organization_feature_toggles` never being touched while the category is off predicts.
5. **Audit/persistence visible in the UI itself**: "Last changed 8/27/2026, 5:21:55 PM by org1@presby.invalid" rendered correctly on both the category card and the feature card, matching the real `role_grants`/audit-metadata write.
6. **360px mobile layout**: clean, no overflow, touch targets read as adequately sized in the screenshot.

Not verified live (would require a second fixture without the permission, or a fixture at a different org): the forbidden-without-permission and flag-off-true-rollback cases — these are covered by the DB-backed unit/integration tests already run in Phase 5 above (`toggleOrgFeatureCategory` permission check, the fourth-axis composition's flag-off test), which is adequate coverage for a server-side authorization/composition guarantee; a browser check would only be re-confirming the same code path, not adding new evidence, unlike the five items above which specifically exercise CSS/rendering/timing that no unit test can see.

## Regression Tests Added

New-feature work, not a bug-fix — no prior-bug regression to authenticate. Three load-bearing design decisions are covered by dedicated, named tests (verified by reading the test files): the DEFAULT-ON resolver behavior (guards against a future "fix" reverting to `?? false`, which would silently reintroduce the day-one regression the architect's ruling exists to prevent), the `'administration'`-never-selectable guard at both resolver and schema (CHECK constraint) layers, and the fourth-axis composition (guards against the axis failing to compose, or composing when its flag is off).

## Coverage on Critical Modules

Not applicable — this feature doesn't touch `src/lib/permissions.ts`, `src/lib/two-factor.ts`, or `src/lib/flags.ts` (calls the existing `isFlagEnabled()` unchanged). Coverage on the two modules it does introduce/modify is under Unit Tests above.

## Lint

`npm run lint`: **FAIL.** One defect introduced by this feature: `src/app/(org)/o/[slug]/admin/features/page.tsx:119` — `react-hooks/error-boundaries` ERROR, "Avoid constructing JSX within try/catch." Confirmed by diffing against `HEAD`'s prior version of the file: the pre-feature version never constructed JSX inside its `try` block; this feature's new categories-forbidden branch does. Not just style — if `<FeaturesForbidden>` itself threw, the surrounding `catch` would mis-attribute it to `FeaturesLoadError`, masking a genuine forbidden-render defect as a generic load failure. Seven additional lint errors + ~170 warnings exist but are confirmed pre-existing (byte-identical to `HEAD` in `git diff --stat`, already tracked in `docs/TODO.md`'s Papercuts) — not this feature's, not this verdict's blocker.

## Tripwires

`npm run check` (all four): **PASS**.

## Build

`npm run build`: **PASS**, no new warnings attributable to this feature.

## DB-Backed Isolation Suite (`scripts/test-rls.sql`)

§30 standalone (extracted, run as the real `presby_app` runtime role): **PASS — 10/10 assertions** (FORCE-RLS tenant isolation, the CHECK constraint rejecting `'administration'` and garbage, grants).

Full-file run: does **not reach §30** — aborts at line 165, **section 3** (the implementer's own report mis-cited this as "§4"; independently re-read and corrected here). Root cause confirmed via the file's own comment at lines 153–164: a live-data discrepancy in the shared dev database (an untracked `memberships` row added directly, outside `scripts/seed-dev.sql`, during an unrelated earlier session's presbytery-portal walk) — predates this feature and the concurrently-run staff-and-personnel pipeline, and is **not** resolved by either pipeline's migrations landing (it's data drift, not a schema-state issue). No `docs/TODO.md` line currently tracks it; added below.

## Feature-Gate Audit

This feature's authorization is the tenant-scoped `presby_has_permission()`/`org_features.manage` mechanism (`src/lib/authz.ts`), not the platform-tier `hasFeature()`/`FEATURES.*` catalog — correctly so, per CLAUDE.md (`src/lib/permissions.ts` is platform-admin-shell-only, frozen). Verified by reading each route/action/lib-function body directly.

| Route or action | `auth()`/session present? | Permission check present & correct? | Category validated server-side before write? | Audit metadata enumerates every affected `feature_key`? |
|---|---|---|---|---|
| `toggleFeatureCategoryAction` (`.../admin/features/actions.ts:77`) | Yes — `auth()` + `resolveOrgContext()` re-run, never trusts client `organizationId` | Yes — `presby_has_permission(..., 'org_features.manage')` via `hasOrgFeaturesManage()` before any write | Yes — `isCategoryKey()` guard first, returns `invalid_category` before `withOrgContext`; independently backed by the live-verified schema CHECK | Yes, confirmed at the exact call site (`actions.ts:111–123`): `affectedFeatureKeys: ORG_FEATURE_CATALOG.filter(entry => entry.category === input.category).map(entry => entry.key)` — a real filter, not a static/opaque value |
| `listFeatureCategories()` (`org-feature-categories.ts:224`) | N/A (lib fn, called post-page-auth) | Yes — `hasOrgFeaturesManage()` first, `{ kind: "forbidden" }` before any read | N/A (read) | N/A |
| `/o/<slug>/admin/features` page | Yes — `cachedAuth()` + `assertOrgAccess()` | Yes — `org_portal.features` flag then `org_portal.feature_categories` flag independently, forbidden short-circuits before `listFeatureToggles()` (Phase 1 Flow 1's "must not partially render before the check runs," satisfied) | N/A | N/A |

No protected route/action omits a check. The lint defect above is an error-handling structure bug, not a missing gate — the checks themselves are present, ordered correctly, and unconditional.

## Verdict (first pass)

**FAIL.** Citing `src/app/(org)/o/[slug]/admin/features/page.tsx:119` (lint error, confirmed introduced by this feature, confirmed to fail `npm run lint`'s exit code). Also outstanding before a PASS is possible: real-browser/360px verification, not yet performed by anyone. Non-blocking but corrected for the record: `scripts/test-rls.sql`'s full-file abort is section 3 (not 4 as first reported), pre-existing data drift unrelated to this feature.

## Remediation (2026-08-27, orchestrator)

Both blocking items closed directly rather than looping back to a fresh full-stack-developer dispatch, since each was small and already fully diagnosed:

1. **Lint defect fixed** — `page.tsx`'s categories-forbidden branch no longer constructs JSX inside the `try` block; it now sets `togglesResult = { kind: "forbidden" }` and lets the existing post-`try` `togglesResult.kind === "forbidden"` check (already there for the toggles-forbidden case) handle rendering, unifying both forbidden paths through one already-correct code path. `npm run typecheck` clean, `npx eslint` on the file clean, `npm run lint` back to the same 7 pre-existing errors (confirmed by count, not just spot-check), the 5 feature-touched test files re-run clean (42/42).
2. **Real-browser verification performed** — see the End-to-End Tests section above for the full method and findings. All six of the implementer's named manual-check items confirmed live; one apparent bug (disabled state not immediately reflecting after a same-session category toggle) was investigated via polling rather than reported on a single observation, and ruled out as ordinary `router.refresh()` latency (resolves within 500ms on a warm route), not a defect.

## Verdict

**PASS**, pending independent re-confirmation. The remediation above was performed by the orchestrator, not by a fresh implementer/qa pair — per this project's own pipeline discipline (an agent should not certify its own fix), a final independent qa pass is dispatched to confirm the lint fix and review the browser-verification evidence before this Phase formally closes. See the addendum below.

## Independent Re-Confirmation (2026-08-27, second qa pass)

A fresh qa agent, independent of the orchestrator's remediation, re-verified both claims rather than accepting them:

- **Lint**: confirmed by direct code read (the categories-forbidden branch no longer builds JSX inside `try`) and by independently running `npm run lint` — exactly 7 errors, cross-checked line-by-line against `docs/TODO.md`'s pre-existing-error record, zero attributable to this feature.
- **Browser-verification account**: assessed critically rather than rubber-stamped. Confirmed the DB was left genuinely clean (`org_portal.feature_categories` flag = false, zero `organization_feature_categories` rows — checked directly, not assumed) and judged the write-up specific and falsifiable (real DOM attribute checks, a real rendered timestamp, an investigated-not-assumed false alarm on `router.refresh()` timing) rather than hand-wavy — while independently noting the one honest weak point (the mobile-viewport claim has no attached artifact a future reader could check).
- **Full regression sweep re-run independently**: typecheck, full suite (3066 passed / 600 skipped / 0 failed — higher than the first pass's count because other concurrent pipelines in this shared tree landed more tests in the meantime), the 42 feature-scoped tests (including the new categories-forbidden-short-circuit regression test, read directly), the 30 DB-backed feature tests, all four tripwires, and the production build — all clean.
- **Feature-Gate Audit re-confirmed** by direct re-read of `actions.ts`/`org-feature-categories.ts` (unchanged by the lint fix, confirmed rather than assumed from the diff description).

**Final Verdict: PASS.**

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The fourth gating axis shipped exactly as the architect's Phase 2 re-run demanded — genuinely default-on, loudly and correctly commented, verified live in a real browser, not just unit-tested — and every Phase 1 gap (administration-exclusion, category-off UI treatment, preserve-not-reset, empty state, audit granularity, server-side enforcement) landed intact; what's missing is not in the code but in the ship-time paperwork trail (no TODO.md line tracking the missing e2e spec, no release-notes/functionality-map entry yet), which is real but doesn't reach the mechanism itself.

## What's Working

- **Default-on resolution is real, not a description overtaken by a quieter implementation.** `categoryEnabledInTx()` returns `row?.enabled ?? true`, loudly commented against a future "fix" back to `?? false` — the architect's overturn of Phase 1's own AND-composition-plus-backfill recommendation, correctly implemented.
- **The flag is a true kill switch**, not UI-only — `isOrgFeatureEnabled()` never calls `categoryEnabledInTx()` at all when `org_portal.feature_categories` is off.
- **Category-off UI state and preserve-not-reset both hold**, confirmed by direct code read and live browser verification (toggle on, category off, category on — feature toggle returns to its prior state, no restoring code path).
- **Audit granularity commitment honored** — `affectedFeatureKeys` is a real filter over the live catalog, not an opaque event; the empty-array case for a catalog-less category is an accurate statement, not a bug.
- **Server-side enforcement holds for free** via composition inside `isOrgFeatureEnabled()` — every existing call site inherits the gate without being touched.
- **The two-slice implementer split (database-admin → full-stack-developer) held up** — no evidence of corners cut; two real `test-rls.sql` bugs were caught and fixed by actually running it against Postgres.

## Intent-vs-Shipped Diff

- Phase 1 said: AND-composition + mandatory backfill for the day-one regression risk. Shipped: default-on resolution, no backfill needed (architect's Phase 2 overturn). Verdict: **acceptable, deliberate drift** — the risk class is eliminated by construction, not mitigated after the fact.
- Phase 1 said: category-off toggle must render disabled + explained. Shipped: exactly that. Verdict: **matches**.
- Two of six manual-check items (flag-off-true-rollback, forbidden-without-permission) were never separately browser-verified — QA's second pass and this review both independently confirm both are exercised by real-Postgres integration tests against the actual function under test, not mocks. Verdict: **acceptable, not a gap** — a browser check would exercise the identical server code through one more layer of indirection with no incremental evidence, unlike the mobile/timing items, which genuinely needed a rendered DOM and got one.
- Gap 8 (empty state): shipped a sharper resolution than Phase 1 anticipated — no actual empty state exists to design for (six categories are never empty for any org type).
- Mobile (360px): browser-verified live at 375px, but with no attached artifact (screenshot) a future reader could independently check. Verdict: **acceptable for ship, thin evidence** — not blocking.
- Architect's binding requirement (tile-visibility deferral as a real TODO.md line): **confirmed present** (`docs/TODO.md`), worded accurately.
- DECISION-130: **confirmed present and accurate** against what was actually shipped.
- "No e2e spec, tracked as a follow-up" (Phase 5's own account): **not actually present in `docs/TODO.md`** at Phase 6 review time — a real process gap, closed by the orchestrator in the same housekeeping cluster as this Phase 6 (see Follow-Ups).
- Functionality-map.md: **not yet updated** — neither this feature nor the pre-existing `/admin/features` page it extends has a bullet. Closed by the orchestrator below.
- Release notes: this codebase's own convention (v0.11/v0.14/v0.15/v0.17/v0.18) is that dark-shipped, seeded-OFF flags DO get a release-notes entry at ship time, not deferred until the flag flips on (that deferral is Rule 13's what's-new convention, member-facing, inapplicable here). Not yet written — flagged for the next `/release-notes` cut.

## Edge Cases

- Empty state: **pass** (no empty state exists to fail; intro copy reads fresh-install-friendly)
- Failure microcopy: **pass** (optimistic revert + toast, mirrors `FeatureToggleCard`)
- Permission gate: **pass** (holder side live-and-DB-confirmed; non-holder side DB-confirmed only, judged adequate)
- Audit event: **pass** (full `affectedFeatureKeys` enumeration, live-confirmed persistence/display)
- Mobile (360px): **pass, thin evidence** (genuinely browser-verified, no saved artifact)

## Follow-Ups (SHIP WITH NOTES)

1. Add a `docs/TODO.md` line naming the missing Playwright e2e coverage for the category picker, matching the `org_portal.home_v2`/`directory_v2` precedent — spec must exist before the flag flips ON for any real org. **Done in the same commit as this Phase 6 close.**
2. Add a `functionality-map.md` bullet for the category-picker addition (and the pre-existing `/admin/features` page it extends, which had none). **Done in the same commit.**
3. Write the `docs/release-notes/` entry for this feature in the next `/release-notes` cut, in this codebase's established dark-shipped-flag style.
4. Attach/re-take a saved screenshot artifact for the 360px mobile verification next time this surface is touched, so the claim is independently checkable.

No functional defect, permission gap, or audit gap was found in the shipped code. All four follow-ups are documentation/process reconciliation, per Workflow Rules 10/14 and this repo's own e2e-before-flag-flip convention — none touch the resolver, schema, or UI, and none block a dark ship today.

**Rule 12 (feedback marking):** not applicable — operator request, not member feedback. **Rule 13 (what's-new):** correctly not applicable — invisible until the flag flips on.
