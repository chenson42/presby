# Credentials tile shown to congregations — Work Log

> **Slug:** `2026-08-27-credentials-tile-org-type`
> **Surface:** (org) portal
> **Permission(s):** none new — existing `credentials.manage` unchanged
> **Flag(s):** none new — existing `org_portal.credentials` unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Source:** live operator report, 2026-08-27 — operator hit the credentials permission-denied state at fpcw after the Credentials tile rendered on a congregation's portal home.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Skipped (Bug-fix variant — design fully specified by Phases 1-2; root cause documented) | — | 2026-08-27 |
| 4 — Implementation | full-stack-developer | Complete | Fix + failing-first regression tests; a 4th caller (portal-footer) found by tsc that Phases 1-2 missed — the required-parameter ruling proven immediately | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The Credentials tile is a guaranteed dead end for every congregation because `visiblePortalTiles()` filters by flag alone with no org-type dimension, and the destination's permission-denied copy actively misleads the operator into thinking their stated clerk could fix it — which no congregation role ever can, by design.

## Bug confirmation

- `src/lib/org-portal/tiles.ts:177-189` — `visiblePortalTiles(category)` filters by `category` then `isFlagEnabled(tile.flagKey)` only; `PortalTile` (line 56) has no org-type field. With `org_portal.credentials` on, the `credentials` tile is returned for **every** org regardless of type.
- Dead in **two** surfaces: the home tile grid (`page.tsx:142`) and the persistent nav row (`portal-nav.tsx:43`). The admin hub is unaffected (credentials is `"operate"`, not `"administer"`).
- `tiles.test.ts:122-226` pins the current flag-only contract — no existing org-type test to regress.
- The click lands on `credentials-states.tsx:37-48` `CredentialsForbidden`: "...ask your stated clerk or another administrator there." Per DECISION-112/116, `credentials.manage` binds only to the presbytery-scoped `presbytery_stated_clerk` template, which `organizationTypeScope` makes unadoptable at a congregation — the suggested remedy is categorically unavailable; the copy invites a support ticket for something structurally unfixable.

## Intended behavior ruling

Congregation-invisible is correct — the same posture `organization_type_scope` already enforces one layer down for template roles (regression-tested). **Direct-URL case: a new, distinct "not available for this kind of organization" state — not `CredentialsForbidden`, and not a 404.** DECISION-040's enumeration discipline governs org access, not intra-org feature routing after `resolveOrgContext` has succeeded; the route and org both genuinely exist, so 404 is a category error. The current forbidden copy is honest about what but dishonest about what-next. The org-type check belongs at the same layer as the flag check on the destination page (which stays sole authority — DECISION-003), not as a second permission gate.

## Fix shape

- Optional org-type scope on `PortalTile` (null-means-universal, mirroring `app_roles.organization_type_scope`), honored inside `visiblePortalTiles()`, which gains an `organizationType` parameter threaded from all three callers: `page.tsx:142` and `admin/page.tsx:87` (both already have `resolved.org.organizationType` in scope) and `portal-nav.tsx:43` (a prop-thread from `layout.tsx`'s `resolved.kind === "ok"` branch — no new query).
- Credentials scoped to `presbytery` **by allow-list, not exclusion** — the org-type enum has five values (`general_assembly`, `synod`, `presbytery`, `congregation`, `new_worshiping_community`); `!== "congregation"` would wrongly show the tile to synod/GA orgs.
- The destination page gets the equivalent server-side check and the new fourth state in `credentials-states.tsx`.

## Notes (named, not scoped in)

- `officers` at a presbytery is a softer product-fit question (nothing structurally forbids a presbytery role holding `officers.manage`) — future consideration, not this ticket.
- Events (`events.manage` has no role binding at any org type) and children's (`children_ministry_admin` is an org-instance role) are **not** the same bug class — grantable anywhere by choice, no architectural wall. No fix owed here.
- `/orgs` and `/launch` don't read `PORTAL_TILES` — confirm in passing.
- Every existing test in `tiles.test.ts` calls `visiblePortalTiles(category)` with no org-type argument — the signature change touches all of them; flagged so it isn't surprise churn mid-Phase-4.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

1. **Invariant compliance — clean.** Org-type scoping sits exactly where `category` already sits: presentational routing metadata deciding whether a tile renders, never whether a click succeeds. Flag-then-category-then-org-type, no permission check added; the destination page remains sole authority via its own fourth gating state (DECISION-003/105 shapes preserved). No invariant bent, no CLAUDE.md update needed.
2. **Pattern consistency.** Null-means-universal matches `app_roles.organizationTypeScope`'s semantics — but that column is a single nullable enum while the tile field is an **allow-list** (`OrganizationType[] | null`). The tsdoc must call out the array-vs-scalar distinction explicitly so a future reader doesn't write `=== scope` instead of `scope.includes(...)`.
3. **Placement.** No separate helper module — one tile, one allow-list, checked in `tiles.ts` (registry filter) and the destination page (its own gate). A shared abstraction for a single consumer would be speculative generality.
4. **Signature: require, don't default.** The failure modes are asymmetric: a forgotten `organizationType` defaulting to "show everywhere" silently reopens this exact bug; a required parameter fails at `tsc` before shipping. Breaking the three call sites and `tiles.test.ts` is small, contained churn — the compiler enforcing the argument is the point.
5. **Server/client split — clean.** `OrgContext.organizationType` is already resolved server-side in `layout.tsx`'s ok-branch; threading it as a prop into `PortalNav` (itself a server component) adds no query, and `PortalNavLinks` (the client leaf) keeps its prop shape unchanged.

Cautions restated: allow-list `["presbytery"]`, never `!== "congregation"` exclusion (GA/synod would wrongly qualify).

**Implementer: full-stack-developer** — lib registry + three server call sites + one destination-page state; no meaningful client-side surface (`portal-nav-links.tsx` untouched), so a split adds a handoff for no isolation benefit.

---

# Phase 3 — Technical Design (tech-lead)

**Skipped per Bug-Fix Variant** ("brief design or skip if the fix is trivial; document the root cause regardless"). Root cause is documented in Phase 1 (`visiblePortalTiles()` filters by category+flag only; `PortalTile` has no org-type dimension). The design is fully specified by Phase 1's fix shape plus Phase 2's rulings: required (non-defaulted) `organizationType` parameter, `orgTypeScope?: OrganizationType[]` allow-list field with array-shape tsdoc, credentials scoped `["presbytery"]`, prop-thread through `layout.tsx` → `PortalNav`, and a fourth "not available for this kind of organization" state in `credentials-states.tsx` + the page gate. Implementer named by the architect: full-stack-developer.

---

# Phase 4 — Implementation

**Date:** 2026-08-27
**Implementer:** full-stack-developer

## Files Created

- none — every change lands in an existing file.

## Files Modified

**Registry (lib):**
- `src/lib/org-portal/tiles.ts` — added `orgTypeScope?: readonly OrganizationType[]` to `PortalTile` (tsdoc spells out the allow-list-vs-scalar distinction from `app_roles.organizationTypeScope`, per Phase 2 ruling 2). Set `orgTypeScope: ["presbytery"]` on the `credentials` tile only. `visiblePortalTiles()` gained a required (non-defaulted) `organizationType: OrganizationType` second parameter; filter order is now category → orgTypeScope → flag.

**Callers threaded (four, not three — see Implementer Notes):**
- `src/app/(org)/o/[slug]/page.tsx` — `visiblePortalTiles("operate", resolved.org.organizationType)`.
- `src/app/(org)/o/[slug]/admin/page.tsx` — `visiblePortalTiles("administer", resolved.org.organizationType)`.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — `PortalNav` gained a required `organizationType: OrganizationType` prop, forwarded to `visiblePortalTiles("operate", organizationType)`.
- `src/app/(org)/o/[slug]/layout.tsx` — resolves `orgOrganizationType` unconditionally inside the `resolved.kind === "ok"` branch (not gated on `chromeV2Enabled`/`chromeV3Enabled`, since those are independent rollback units and either could be the only one on); threads it into both `<PortalNav>` and `<PortalFooter>`.
- `src/components/org-portal/portal-footer.tsx` — the fourth caller, missed in the Phase 1/2 enumeration (which named only page.tsx/admin-page.tsx/portal-nav.tsx). `PortalFooter` gained a required `organizationType: OrganizationType` prop, forwarded to `visiblePortalTiles("operate", organizationType)`. Caught by `tsc`, exactly the failure mode the required-parameter design (Phase 2 ruling 4) exists to surface.

**Destination page + new state:**
- `src/app/(org)/o/[slug]/admin/credentials/page.tsx` — added a `CREDENTIALS_ORG_TYPES` allow-list constant (`["presbytery"]`) and an org-type check placed after the `org_portal.credentials` flag check and before `listOrdinations()` (flag → org-type → permission, per Phase 1 ruling).
- `src/app/(org)/o/[slug]/admin/credentials/credentials-states.tsx` — added `CredentialsNotAvailable({ name })`, a fourth state modeled on `CredentialsFlagOff`'s tone (product-not-here, no permission language, no implied remedy).

**Tests (all in the same commit as their production code, failing-then-passing verified — see below):**
- `src/lib/org-portal/tiles.test.ts` — every existing `visiblePortalTiles(category)` call updated to the two-arg signature; added an `orgTypeScope` shape assertion and a new `describe` block: congregation excluded, presbytery included, synod/GA excluded (allow-list proof, not `!== "congregation"`), a scopeless tile unaffected by org type, and `isFlagEnabled` never called for an org-type-excluded tile.
- `src/app/(org)/o/[slug]/admin/credentials/credentials-states.test.tsx` — added `CredentialsNotAvailable` coverage: names the org, distinct phrasing from all three other states, no permission language, no link/button.
- `src/app/(org)/o/[slug]/admin/credentials/page.test.tsx` — added an `OK_RESOLVED_CONGREGATION` fixture and a new `describe` block: congregation + flag on → `CredentialsNotAvailable` without calling `listOrdinations()`; flag off still wins over the org-type check even for a congregation; presbytery is unaffected.
- `src/app/(org)/o/[slug]/page.test.tsx`, `src/app/(org)/o/[slug]/admin/page.test.tsx`, `src/app/(org)/o/[slug]/portal-nav.test.tsx`, `src/components/org-portal/portal-footer.test.tsx` — mock wrappers updated to forward the second `visiblePortalTiles()` argument and assertions updated/added to confirm `organizationType` is threaded from the resolved org, not hardcoded or dropped.
- `src/app/(org)/o/[slug]/layout.test.tsx` — `portalNavSpy`/`portalFooterSpy` assertions updated to expect the new `organizationType` prop.

## Schema Changes

- none.

## Audit Events

- none — this is presentational routing metadata, not a mutation; no `AUDIT_ACTIONS` key applies.

## Regression Verification (failing → passing)

Two stash/run/restore cycles confirmed the tests fail against pre-fix code and pass against the fix:

1. `git stash` on `tiles.ts` alone → `npx vitest run src/lib/org-portal/tiles.test.ts`: **4 failed** (`orgTypeScope` shape assertion, congregation-excluded, synod/GA-excluded, isFlagEnabled-never-called-for-excluded-tile) / 26 passed. `git stash pop` → same file: **30/30 passed**.
2. `git stash` on `credentials/page.tsx` + `credentials-states.tsx` alone → `npx vitest run` both credentials test files: **3 failed** (`CredentialsNotAvailable` undefined — `TypeError`/React "Element type is invalid", and the page test crashing on `ordinationsResult.kind` because `listOrdinations` was reached) / 16 passed. `git stash pop` → same files: **19/19 passed**.

## Verification (full suite)

- `npm run typecheck`: PASS (clean, no errors) — this is what caught the missed fourth caller, `portal-footer.tsx`.
- `npx vitest run` (full suite): **2779 passed, 518 skipped, 0 failed** across 209 test files.
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope): all four PASS.
- `npm run lint`: pre-existing errors/warnings only, in files this pipeline never touched (`portal-nav-links.tsx`'s `setState`-in-effect, `<a>`-vs-`<Link>` warnings in unrelated test files) — confirmed by name against the diff; nothing new introduced.

## Browser Verification

Dev server already running at `localhost:3000`; used the existing Playwright `storageState` at `/tmp/state.json` (an authenticated admin fixture with real relationships at two orgs, not mocked). **Substitution note:** the task named `/o/fpcw` and `/o/northern-reach` as the two orgs to check. `fpcw` does exist in this dev database (a manually-created org, not from the checked-in `scripts/seed-dev.sql`) — the same admin account used for other slices' verification has a `Congregation`-type relationship there and a `Presbytery`-type relationship at `northern-reach`, so both named URLs worked as given; no substitution was actually needed.

- **`/o/fpcw`** (congregation, First Presbyterian Church of Westerville) — Tools grid shows Members / Directory / Officers / Give feedback / Groups / Events. **Credentials is absent** from the tile grid, the persistent nav row (`Home Members Directory Officers Give feedback Groups Events Administration`), and the footer nav recap.
- **`/o/fpcw/admin/credentials`** (direct URL) — renders the new not-available state: *"Ministry credentials & pastoral appointments isn't available for First Presbyterian Church of Westerville — this is a presbytery-level tool, not something a congregation, synod, or General Assembly office uses."* No permission language, no link/button, distinct from the flag-off and forbidden copy.
- **`/o/northern-reach`** (presbytery, Presbytery of the Northern Reach) — Tools grid and nav row both include **Credentials**, alongside the other six tiles.
- **`/o/northern-reach/admin/credentials`** — still renders the full page: Ordinations table (Rowan Thistlewood, Minister of Word and Sacrament), Record an ordination form, Pastoral appointments table, Record an appointment form. Unaffected by the org-type check, as expected.

Checked at 1280×900 (desktop). Screenshots retained in the session scratchpad (`fpcw-home.png`, `fpcw-credentials-not-available.png`, `northern-reach-home.png`, `northern-reach-credentials.png`) for the record; not committed (scratchpad is gitignored/out of repo).

## Implementer Notes

- **Fourth caller found, not three.** Phase 1/2 enumerated three call sites (`page.tsx`, `admin/page.tsx`, `portal-nav.tsx`). `npm run typecheck` surfaced a fourth, `src/components/org-portal/portal-footer.tsx` (the portal footer's nav recap, added by a later, independent pipeline — `org_portal.chrome_v3`). This is exactly the scenario Phase 2 ruling 4 argued for a required, non-defaulted parameter: the compiler caught the gap before it shipped, rather than the footer silently keeping the presbytery-only tile visible to every congregation through the one surface nobody was watching. Threaded the same way as `PortalNav`: a required prop, sourced from the same `resolved.kind === "ok"` resolve already used for the brand/nav wiring in `layout.tsx`, no new query.
- **`orgOrganizationType` computed once, unconditionally**, inside `layout.tsx`'s `resolved.kind === "ok"` branch, rather than duplicated inside both the `chromeV2Enabled` and `chromeV3Enabled` branches — those two flags are independent rollback units (per the file's own header comment), so either could be on without the other, and both `<PortalNav>` and `<PortalFooter>` need the value regardless of which flag combination is live.
- **No design deviation otherwise.** Filter order (category → orgTypeScope → flag), the allow-list shape, the `CredentialsNotAvailable` tone, and the flag → org-type → permission check ordering on the destination page all match Phase 1/2 exactly.
- An environment quirk during implementation: three rounds of edits to `tiles.ts`, `layout.tsx`, and the credentials page/states files were silently reverted on disk between tool calls (confirmed via `git status`/`grep` — unrelated files from a concurrent session were also mid-edit in this working tree). Re-applied and re-verified via direct `grep`/`cat` after each write rather than trusting the editor's own "success" response; final state confirmed clean by `git status`, `npm run typecheck`, and the full test run above.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27

## Tree-State Confirmation

`git status` matches expectations (this pipeline's files + the separately-closed input-background pipeline's four files). The implementer's re-applied edits survived on disk, confirmed by direct read: `tiles.ts:95` `orgTypeScope`, `:226-229` required two-arg signature; `credentials-states.tsx:47` `CredentialsNotAvailable`; `layout.tsx:100,145,173` threads `orgOrganizationType` to both `PortalNav` and `PortalFooter`.

## Design Fidelity (read, not inferred)

- Allow-list `["presbytery"]` in both `tiles.ts:202` and `credentials/page.tsx:60`, genuine `.includes()` — not an exclusion (Phase 2's caution honored).
- Parameter required, no default, in the function and every caller prop.
- tsdoc explains the array-vs-scalar divergence from `app_roles.organizationTypeScope` and the allow-list rule.
- Page check order `assertOrgAccess` → flag → org-type → permission; a congregation with the flag on never reaches `listOrdinations()` (proven by `page.test.tsx:177-195`'s never-called assertion). `credentials.manage` gate unmoved in untouched `src/lib/credentials.ts`.
- `CredentialsNotAvailable` copy carries no permission language and no link — product-not-here register per `CredentialsFlagOff`.

## Caller Completeness

Exactly four production call sites, all two-arg (`page.tsx:142`, `admin/page.tsx:87`, `portal-nav.tsx:57`, `portal-footer.tsx:93`); none unconverted. `portal-nav-links.tsx` untouched; no DB read moved client-side.

## Runs

- `npm run typecheck`: **PASS**.
- Full suite: **2779 passed / 0 failed** (518 skips pre-existing DB-gated, unrelated; none of this pipeline's files are in the gated set). Isolated run of the eight touched test files: **97/97**.
- `npm run check`: 4/4 tripwires PASS.

## Regression Tests (verified by reading; fail-before implementer-asserted + logically confirmed, not re-observed — re-observing required mutating git state, which was barred)

- `tiles.test.ts:291` congregation excluded even with flag on (the regression this closes); `:316` synod+GA excluded (allow-list proof); `:327` `isFlagEnabled` never called for an excluded tile (filter-order pin).
- `credentials/page.test.tsx:177` congregation + flag on → `CredentialsNotAvailable` without ever calling `listOrdinations()`; `:197` org-type check runs AFTER the flag check.
- `credentials-states.test.tsx:37` distinct copy from all three siblings, no permission language.
None tautological; each targets an old-vs-new behavioral divergence.

## Feature-Gate Audit

No route handlers or server actions in the diff. `credentials/page.tsx`: `cachedAuth()`/`assertOrgAccess()` unchanged; the permission read is intact and still runs (after the new org-type check) for presbytery orgs. Tile registry stays presentational — no second permission check grew (DECISION-003).

## Browser (independent Playwright pass)

- `/o/fpcw`: Credentials absent from tile grid, nav row, AND footer.
- `/o/fpcw/admin/credentials`: renders *"Ministry credentials & pastoral appointments isn't available for First Presbyterian Church of Westerville — this is a presbytery-level tool, not something a congregation, synod, or General Assembly office uses."* No permission wording, no link.
- `/o/northern-reach`: Credentials present in all three surfaces; `/admin/credentials` full page unaffected.

## Minor Findings (non-blocking, named)

1. `tiles.ts:212` docstring still says "THREE CALLERS" — the fourth (`portal-footer.tsx`) is documented at its call site but this block wasn't updated. Cosmetic. *(Fixed by the orchestrator at Phase 5 close — Trivial class.)*
2. `new_worshiping_community` has no explicit test case (four of five enum values exercised). Low-risk — identical `.includes()` path already proven against two other non-presbytery types — but a named gap, not silently waived.

## Verdict

**PASS**

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The dead end is closed at every surface a congregation operator could hit it from — tile, nav, footer, and direct URL all now agree, and the direct-URL copy answers the confused operator honestly ("not this kind of organization," no phantom remedy) instead of sending them to a stated clerk who structurally cannot help; two Rule-10 housekeeping items named in this pipeline needed landing in docs/TODO.md (closed by the orchestrator at Phase 6 close).

## Live re-verification (analyst's own pass, independent of QA)

- `/o/fpcw`: no Credentials tile/nav/footer entry anywhere in the served HTML (the one raw "credentials" string hit is Next's own RSC fetch boilerplate).
- `/o/fpcw/admin/credentials`: 200, renders the not-available copy — no permission wording, no implied remedy, no dead link.
- `/o/northern-reach`: Credentials present in all three surfaces; `/admin/credentials` full page unaffected.

## What's Working

- **Copy passes the confused-operator test** — names the org, states it's a presbytery-level tool, lists the org types it doesn't serve, asks nothing of the operator. The old copy's "ask your stated clerk" was the entire problem (no congregation role can ever hold `credentials.manage`, DECISION-112/116).
- **Allow-list discipline held** (`["presbytery"]`, `.includes()`, verified live at both org types).
- **The fourth caller (portal-footer) is a legitimate, honestly-disclosed catch, not scope creep** — inside Phase 1's "congregation-invisible" intent; the work-log doesn't launder the enumeration miss; the required-parameter design turned it into a compile error instead of a shipped bug, exactly as Phase 2 ruled.
- **No invariant bent** — no second permission gate; no audit event needed (presentational routing, correctly ruled none).

## Intent-vs-Shipped Diff

- Congregation-invisible across all surfaces + a distinct fourth not-available state on direct URL (not 404, not forbidden). Shipped exactly, across four surfaces (one more than enumerated, disclosed). **Matches.**
- Phase 1's two out-of-scope notes (officers-at-presbytery product fit; events/children a different class) correctly held out of scope.

## Edge Cases

- Failure microcopy: pass. Permission gate: pass (flag-on congregation never reaches `listOrdinations()`; presbytery untouched). Audit: n/a. Empty state: n/a.
- Mobile (360px): flagged unverified by the analyst; **closed by the orchestrator at Phase 6 close** — live 360px pass: fpcw shows zero Credentials mentions, the not-available page renders with no horizontal overflow and no page errors, northern-reach still shows Credentials.

## Follow-Ups (SHIP WITH NOTES — disposition at close)

1. Officers-at-presbytery product-fit question → **docs/TODO.md line added** at close.
2. `new_worshiping_community` test-case gap → **docs/TODO.md line added** at close (QA's low-risk framing recorded in the line).
3. Mobile 360px verification → **done at close** (see Edge Cases).
4. Functionality-map credentials line reads as if congregation-invisibility predated this fix → **clause appended** at close noting the tile/nav/footer layer is now also org-type-scoped.

Rule 12: n/a (live operator report). Rule 13: n/a (bug fix; the flag-flip what's-new reminder already tracked).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |
