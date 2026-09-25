# The e2e suite is red on main — greeting copy and post-login destination (commit `7e4f21a`) — Work Log

> **Slug:** `2026-09-25-e2e-red-on-main`
> **Surface:** e2e specs (`e2e/*.spec.ts`), possibly `src/components/shared/greeting-band.tsx`, `src/app/launch/destination.ts` and its test, and CLAUDE.md's Post-Login Landing table (documentation review is rewriting that section concurrently — coordinate at integration).
> **Permission(s):** none. **Flag(s):** not needed.
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant. Phase 2 skipped unless Phase 1 finds the destination change is a routing regression rather than a stale spec (then it touches the Post-Login Landing invariant and the architect rules). `fix:` commit(s) with `Caught-By: agent-review`, `Discovered-In: post-merge`, `Work-Log: 2026-09-25-e2e-red-on-main`. Parallel-pipeline rules (Rule 16): no schema, no `scripts/`, no shared docs.
> **Source:** QA Phase 5 of `docs/work-log/2026-09-25-security-review-highs.md`, Finding 3 — verified by a clean counterfactual (all of that pipeline's files reverted to HEAD → the same 8 specs fail). Full suite on a real dev server: 97 passed / 16 failed / 7 did not run. The CI e2e workflow (`e2e.yml`) runs on an ephemeral Neon branch; nobody has been reading its result.
> **Bugs:** (1) commit `7e4f21a` replaced `/admin`'s `<h1>Welcome, …</h1>` with `<GreetingBand>` (`src/components/shared/greeting-band.tsx:50-52` renders a time-of-day greeting for a named user, "Welcome." only when unnamed), so `getByRole('heading', { name: /welcome/i })` can never match — `e2e/totp-full-login.spec.ts:61`, `e2e/totp-callback-bypass.spec.ts:79,130,147`. (2) the same commit changed `destination.ts`'s chooser branch `/orgs` → `/home` (DECISION-124), so a platform admin with no congregations lands on `/home`; `e2e/post-login-routing.spec.ts:53`, `e2e/admin-login.spec.ts:7`, `e2e/member-home.spec.ts:29` still expect `/admin` — and CLAUDE.md's Post-Login Landing table still says `/admin` too, so the question of which is right is a Phase 1 question. (3) Unverified, possibly environment-dependent: `color-scheme.spec.ts:68`, `header-controls.spec.ts:131,426`, `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334`, `branded-signin.spec.ts:285`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (bug-fix brief) | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Skipped — bug-fix variant: the scoped fix is spec assertions, a `data-testid` on one component, and a unit test encoding the Post-Login Landing table; no invariant, schema or structural change (analyst's Phase 1 recommendation, orchestrator notation) | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete (brief) | — | 2026-09-25 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS — 38/40 on an isolated clone; the 2 reds are the operator's `home_v2 = true`, proven | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Bug-fix brief, recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

One of the three claimed bugs is real and needs a spec fix (the greeting copy); the second ("`/admin` vs `/home`") is **not actually a bug or a product-intent question at all** — `destination.ts`, its unit tests, and the in-progress CLAUDE.md edit already agree and are correct — the failures are caused by a polluted shared dev database; and five of the seven "possibly environmental" specs are also environment drift, not code defects, with one live, previously-unflagged accessibility regression discovered along the way.

## Bugs Confirmed

### Bug 1 — Greeting copy (`GreetingBand`) — REAL regression, spec is stale

Commit `7e4f21a` replaced `/admin`'s `<h1>Welcome, {name}.</h1>` with `<GreetingBand>` (`src/components/shared/greeting-band.tsx:50-52`), which renders `"{timeOfDayGreeting}, {name}."` for a named user and only falls back to `"Welcome."` when `displayName` is null. Reproduced live: `getByRole("heading", { name: /welcome/i })` never matches on `/admin` (`admin-login.spec.ts:7`, `member-home.spec.ts:29`) or on the TOTP-verified landing (`totp-full-login.spec.ts:61`, `totp-callback-bypass.spec.ts:79,130,147`, `branded-signin.spec.ts:285`).

**This is the intended product behavior**, not a regression to revert — the component's header comment documents the time-aware greeting deliberately (DECISION-125). **The fix is in the specs**: replace the literal `/welcome/i` assertion with something that doesn't depend on time-of-day copy — recommend a `data-testid="greeting-band"` on `GreetingBand`'s `<h1>` rather than a bare `getByRole("heading", {level:1})` (fragile against future h1s). Zero change to the copy logic.

### Bug 2 — `/admin` vs `/home` — NOT a code bug, NOT a documentation ambiguity. Root cause: polluted shared dev database.

`destination.ts` read in full; `destination.test.ts` passes. DECISION-124 changed exactly one literal: the chooser branch `/orgs` → `/home`. **Row 4 — "0 orgs, canAccessAdmin, not platform admin → `/admin`" — is unchanged** and asserted by a passing unit test. The working-tree edit to CLAUDE.md's Post-Login Landing table correctly reflects this (HEAD's `/orgs` row was stale). **Keep the working tree's version.**

Reproducing `post-login-routing.spec.ts` test 1 / `admin-login.spec.ts:7` / `member-home.spec.ts:29` against the real dev server confirmed `admin@presby.invalid` lands on `/home`, and a direct DB query traced it: `presby_user_organizations(<admin user id>)` returns one row — `fpcw`, managed, active. The e2e `admin` fixture is documented (`e2e/support/users.ts`) and asserted in three specs as carrying **zero** organizations. On this shared Neon dev database that account has a real membership at `fpcw` — a person row "Admin Fixture", created 2026-08-24, **absent from every committed seed script** — left behind by agents signing in as `admin@presby.invalid` for manual "Verify in a Browser" checks of `fpcw` admin pages. With that extra org the fixture legitimately hits **Row 5** (1 org + `canAccessAdmin` → chooser), whose destination *did* change to `/home`. **The fix is not to `destination.ts`, not to CLAUDE.md, and not a product decision — it is e2e/dev-database hygiene.**

### The other two `post-login-routing.spec.ts` failures — same class, different flag

Tests 4 and 7 fail because `org_portal.home_v2` is `enabled: true` on the shared dev DB, while its committed seed default is `false` (`scripts/seed.ts:155-166`) and `docs/TODO.md:133` states an e2e spec must exist before either flag flips ON in any real environment. No such spec exists. At the committed default `/o/<slug>` renders `OrgPortalStub` (`org-states.tsx:170`), exactly what these tests assert.

## The Seven Possibly-Environmental Specs — run once each against a real dev server

| Spec | Classification | Evidence |
|---|---|---|
| `color-scheme.spec.ts:68` (dark bg `rgb(15,23,41)` expected, `rgb(6,18,35)` received) | **Stale spec** | `hsl(215 71% 8%)` (`globals.css:97`, from `660bf24` brand guidelines v1.0) converts exactly to `rgb(6,18,35)`. One-line fix, unrelated to `7e4f21a`. |
| `header-controls.spec.ts:131` (truncation locator times out) | **Real code defect, out of scope** | `org-switcher.tsx:130` renders `<span className={compact ? "sr-only" : "truncate"}>` — in compact mode the span is `sr-only`, so the element genuinely doesn't exist. |
| `header-controls.spec.ts:426` (touch target 32px < 44px) | **Real, previously unflagged accessibility regression** | `global-nav.tsx:154` sets `compact={!!orgMark}`, true for every org, not viewport-conditioned; the compact trigger shows only the icon and `SWITCHER_TRIGGER_CLASS` has `min-h-11` but no min-width, so the button collapses to ~32px on **every** org portal page. Predates `7e4f21a` (2026-08-25 portal-chrome work). Separate follow-up. |
| `public-sites.spec.ts:334` | **Inconclusive — probable shared-DB race/staleness** | Test 1 confirmed the staged bundle key and `live` status; test 2 got a 200 but the staged title never rendered. Confirm on a dedicated Neon branch before calling it code. |
| `timezone-safe-dates.spec.ts:36` | **Environment — database bloat** | `/admin/users` paginates `desc(created_at)` — **106 users, page 1 of 5** — and the fixture is not among the 21 newest. `FormattedDate`/`<time>` rendering is proven in this run (`post-login-routing` test 11 passed). |
| `timezone-safe-dates.spec.ts:71` | **Same root cause** | Reproduced in isolation after confirming server health. |
| `branded-signin.spec.ts:285` | **Same as Bug 1** | DOM snapshot: `heading "Good morning, E2E MFA Enrolled Admin." [level=1]`. |

Net: of 15 failures examined, **3 are genuine code-level findings** (greeting copy → spec change; org-switcher compact/touch-target defect — real, pre-existing, out of scope; the inconclusive public-sites case). Everything else is shared-dev-database drift.

## Why Nobody Noticed

`gh run list --workflow=e2e.yml --limit 5` shows five consecutive **"completed success"** runs of 6–10 seconds each — impossible for a real Playwright run. `gh run view` confirms the `playwright on neon branch` job never runs (`-`), because `NEON_API_KEY` is not configured as a repository secret; the `check-secrets` job annotates *"NEON_API_KEY not configured — e2e skipped"* and the workflow still reports green. **The e2e CI job has never executed once in this repository's visible history.** A green checkmark on every push to `main` is actively misleading.

**Recommendation — for the operator, not an implementer:** configure `NEON_API_KEY`/`NEON_PROJECT_ID` as repo secrets so the already-built ephemeral-branch e2e job runs — against a fresh branch (`db:push` + `db:seed`), which is exactly the clean environment this investigation shows is a precondition for the suite meaning anything.

**Should `/pre-push` gate on e2e?** No — not as a local re-run against the shared dev database; that produces false failures unrelated to the commit. Make the CI job real; then `/pre-push` could add a soft advisory checking the last e2e run on `main`.

## Gaps the Request Didn't Address

1. **E2E/dev-database hygiene has no owner or process.** The `admin` fixture's zero-orgs invariant and `org_portal.home_v2`'s off-by-default invariant are both violated on the shared dev DB with no cleanup mechanism. `globalSetup` already prints the right advice (dedicated Neon branch, DECISION-019); recommend following it, and/or having `globalSetup` assert-and-fail if an e2e-owned user carries an unexpected membership.
2. **The org-switcher touch-target defect** is real and un-tracked — its own `docs/TODO.md` line.
3. **`public-sites.spec.ts:334`** needs a run on an isolated branch before classification.
4. **`docs/testing.md`** has P0-era leftovers ("Nothing is inside an organization yet").

## Out of Scope (confirm with user)

Fixing the org-switcher defect (separate work-log); resolving `public-sites.spec.ts:334`; configuring `NEON_API_KEY`/`NEON_PROJECT_ID` (operator, Neon console); cleaning the shared dev database (the stray `fpcw` membership on `admin@presby.invalid`; `org_portal.home_v2` back to seed default; pruning accumulated fixture users) — read-only here, recommended as a narrow data-hygiene action.

## Regression Tests Required (Phase 4)

1. Update the six `/welcome/i` assertions (`totp-full-login.spec.ts:61`; `totp-callback-bypass.spec.ts:79,130,147`; `branded-signin.spec.ts:323`; `admin-login`/`member-home` as applicable) to a stable `data-testid`.
2. A unit test (extension of `destination.test.ts`) encoding CLAUDE.md's Post-Login Landing table row-for-row against `computeDestination()`.
3. No change to `destination.ts`, `destination.test.ts`, or CLAUDE.md's working-tree edit — they are correct.
4. A `beforeAll` sanity check in the specs coupled to the `admin` fixture's zero-org invariant so future contamination fails loudly at the point of drift.

## Open Questions

- Spin the org-switcher touch-target defect into its own bug-fix work-log now (recommended — a live accessibility violation on every org page) or track later?
- Authorize a one-time cleanup of the shared dev database (remove the stray membership; reset `org_portal.home_v2`) as part of Phase 4? Recommend yes, narrowly scoped — it is the direct cause of 3 of the 8 originally reported failures. Note: `org_portal.home_v2` was deliberately turned ON in dev for the fpcw demo (`docs/STATE.md`, 2026-08-25), so resetting it changes the operator's demo — operator decision.

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

*Bug-fix variant, brief. Root cause and fix shape per bug; no architectural change (Phase 2 skip stands).*

## Root Cause (per bug)

1. **Greeting copy (`GreetingBand`).** Not a code defect — DECISION-125's time-of-day greeting is intended product behavior (`src/components/shared/greeting-band.tsx:35-49`, header comment). The bug is in six specs still asserting the literal string `/admin`'s old `<h1>Welcome, {name}.</h1>` used to render. Root cause: **stale spec**, fixed in the spec, zero change to `greeting.ts`/`GreetingBand`'s copy logic.
2. **`/admin` vs `/home` (and the two `home_v2` failures).** Not a code bug and not a documentation ambiguity — `destination.ts`, `destination.test.ts`, and CLAUDE.md's Post-Login Landing table (`CLAUDE.md:606-612`, confirmed on disk: row 5 reads `/home`, matching DECISION-124) already agree. Root cause: **shared-dev-database drift** — the `admin` fixture (documented and asserted elsewhere as carrying zero organizations) has acquired a real `fpcw` membership on this Neon branch, and `org_portal.home_v2` is `true` on the same branch against a `false` seed default. Both are environment contamination, not something `git diff` can fix. This pipeline's job is to make that drift loud instead of silent, not to chase it out of `destination.ts`.

## Summary

Six e2e specs assert a greeting heading string that intended product behavior (DECISION-125) no longer renders; one spec asserts a color value that predates the current brand ramp. Both are stale-spec bugs, not regressions. Separately, three specs are coupled to an unenforced invariant (the `admin` e2e fixture holds zero organizations) that a polluted shared dev database has silently violated, producing routing-test failures whose real cause (a stray membership row) is invisible from the test output. This pipeline: (a) gives `GreetingBand` a stable `data-testid` and rewrites the affected assertions to a name-agnostic content check instead of a time-of-day-dependent string; (b) corrects the one stale color constant; (c) adds a table-driven unit test that encodes CLAUDE.md's Post-Login Landing matrix row-for-row against `computeDestination()`, so the doc and the function cannot silently diverge again; (d) adds a `beforeAll` fixture-invariant guard to the three specs coupled to the `admin` fixture's zero-org assumption, so contamination fails loudly with a named cause instead of a confusing pathname mismatch. It makes no change to `destination.ts`, to CLAUDE.md, or to any production routing/copy logic.

## Permissions & Flags

- Permission key(s): not needed — no new user-facing capability.
- Default role bindings: n/a.
- Feature flag(s): not needed. (`org_portal.home_v2`'s drift is diagnosed, not toggled, by this pipeline — see Out of Scope.)

## API Contract

No routes or server actions. This is a test-and-one-attribute change; no new or modified server-action signatures.

## Data Model

No schema changes required. No `ALTER`/`DROP`, no new CHECK/trigger/FK — this feasibility checklist is not applicable to this pipeline.

## Component / Page Plan

**Files to modify (all in scope, none in the parallel pipelines' excluded set):**

- `src/components/shared/greeting-band.tsx` — add `data-testid="greeting-band"` to the `<h1>` (lines ~45-49). Purely additive attribute; no class, markup, or copy change. `GreetingBand` backs two route trees (`/o/<slug>` and `/admin`) per its own header comment, so this fixes both call sites' specs in one place.
- `e2e/totp-full-login.spec.ts` (`:60`) — rewrite the `/welcome/i` heading assertion.
- `e2e/totp-callback-bypass.spec.ts` (`:59, 78, 129, 146` as of this design's read; **rebase before editing** — a concurrent security-fix loop-back is adding Tests 5-7 to this file and line numbers will have shifted. Touch only the `/welcome/i` assertions; do not touch anything else in this file, including the new Tests 5-7).
- `e2e/branded-signin.spec.ts` (`:322`) — rewrite.
- `e2e/admin-login.spec.ts` (`:31`) — rewrite. (Confirmed live: this file, not `member-home.spec.ts`, carries the seventh `/welcome/i` assertion the Phase 1 brief attributed to `member-home.spec.ts:29`; `member-home.spec.ts` has no greeting-text assertion at all — its failures are the destination-matrix bug, not the greeting bug, and need no spec edit, only the DB cleanup that is out of scope here.)
- `e2e/color-scheme.spec.ts` (`DARK_BACKGROUND` constant, `:36`, feeding the assertion at `:68`) — `rgb(15, 23, 41)` / `hsl(222 47% 11%)` → `rgb(6, 18, 35)` / `hsl(215 71% 8%)` (`src/app/globals.css:97`, current `.dark { --background: ... }`). One-line constant fix; `globals.css` itself is untouched (and is in the excluded-files set for this pipeline regardless).
- `src/app/launch/destination.test.ts` — additive `describe` block (see below). No existing `it()` changes.
- `e2e/support/assert-fixture-invariants.ts` **(new file)** — one exported async function, `assertAdminFixtureHasNoOrgs(): Promise<void>`, following the connection pattern already established in `e2e/support/seed-orgs.ts` (`neon(process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL)` — the owner connection `globalSetup` already uses to write fixtures, since counting `memberships` rows for a fixture user needs to see across the RLS the tenant connection would otherwise filter). Queries membership count for `admin@presby.invalid` and throws (not warns, not skips — matching `global-setup.ts`'s own "nothing here is conditional" philosophy) with a message naming the drift, e.g. `` `e2e fixture invariant violated: admin@presby.invalid carries ${n} organization membership(s); this fixture is asserted elsewhere to carry zero. See docs/TODO.md's shared-dev-database-hygiene entry.` ``.
- `e2e/post-login-routing.spec.ts`, `e2e/admin-login.spec.ts`, `e2e/member-home.spec.ts` — each gets a `test.beforeAll(assertAdminFixtureHasNoOrgs)` (import from the new support file). These three are exactly the specs the Phase 1 brief traced the `admin`-fixture contamination through.

No pages or components are created. No page files change.

## Implementation Order

1. `GreetingBand`: add the `data-testid`. Zero behavior change — verify with `npm test` (component has no existing unit test; a smoke render is optional, not required, since the attribute has no logic).
2. Rewrite the seven `/welcome/i` assertions (see file list above) to `page.getByTestId("greeting-band")` plus a name-agnostic content check — e.g. `await expect(page.getByTestId("greeting-band")).toContainText(fixtureDisplayName)` — rather than a bare `getByRole("heading", { level: 1 })`, which the Phase 1 brief correctly flags as fragile against a future second `<h1>`. Rebase `totp-callback-bypass.spec.ts` against its current state immediately before editing it.
3. Fix `color-scheme.spec.ts`'s `DARK_BACKGROUND` constant and its stale `hsl` comment.
4. Add `e2e/support/assert-fixture-invariants.ts` and wire the `beforeAll` guard into the three coupled specs.
5. Extend `destination.test.ts` with a `describe("computeDestination — CLAUDE.md's Post-Login Landing table", ...)` block: a table-driven case list, one row per line of `CLAUDE.md:606-612` verbatim (any/any/any → sanitized `?next=`; 1/no/no → `/o/<slug>`; 0/no/no → `/no-organization`; 0/yes/no → `/admin`; everything else → `/home`), each `it()` citing the CLAUDE.md row in its title so a future edit to either side shows up as a named failure, not a silent gap. This is additive; every existing `it()` in the file is untouched.
6. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check` locally.
7. Hand to QA (see Verification below) for the running-server pass.

## Edge Cases & Risks

- **Concurrent-pipeline collision on `e2e/totp-callback-bypass.spec.ts`.** A security-fix loop-back is adding Tests 5-7 to this same file. Scope discipline: touch only the four `/welcome/i` lines; rebase immediately before editing so the diff is minimal and reviewable against whatever that pipeline lands first.
- **`admin`-fixture guard will still fail on the current shared dev DB.** Adding `assertAdminFixtureHasNoOrgs()` does not clean the database — the one-time cleanup (removing the stray `fpcw` membership) is an operator decision, explicitly out of scope (Phase 1). Until that cleanup happens, `post-login-routing.spec.ts` test 1, `admin-login.spec.ts`, and `member-home.spec.ts` test 2 will **continue to fail**, but with a clear, named cause instead of a pathname mismatch that reads like a routing regression. QA must not treat this as a Phase 4/5 failure of this pipeline — see Verification.
- **`org_portal.home_v2` drift is out of this pipeline's remit.** `post-login-routing.spec.ts` tests 4 and 7 assert the committed-default (flag-OFF) `/o/<slug>` rendering; they will keep failing on this shared branch while the flag is ON for the fpcw demo. Recommendation: **do not make these two specs flag-aware.** They are the committed-default contract test that `docs/TODO.md`'s existing "no e2e spec exists yet, no flip before one does" rule depends on; making them read the flag and branch their assertions would let the flag flip ON in a real environment without ever proving anything failed. The correct fix is resetting the shared DB's flag value or running e2e on an isolated branch (both already tracked as operator/TODO items, not implementer work).
- **Whether the broader `globalSetup`-level "any e2e-owned user with an unexpected membership" assertion belongs in this pipeline:** **No — leave it to `docs/TODO.md`'s existing shared-dev-database-hygiene entry.** That version is a generalized invariant across the whole fixture roster (not just `admin`), it changes `global-setup.ts` (a file every spec depends on, raising the blast radius past a bug-fix-variant's scope), and Phase 1 already scoped the concrete ask to the three specs actually broken today. Scope creep here risks a new failure mode (a false-positive `globalSetup` throw blocking an unrelated spec run) without Phase 2 architectural review of what "unexpected" means for every fixture. This pipeline's narrower per-spec guard is the right size for a bug-fix variant; the general case stays a tracked backlog item.
- **e2e blast radius (existing specs whose asserted behavior this change touches):** `e2e/totp-full-login.spec.ts`, `e2e/totp-callback-bypass.spec.ts`, `e2e/branded-signin.spec.ts`, `e2e/admin-login.spec.ts`, `e2e/color-scheme.spec.ts`, `e2e/post-login-routing.spec.ts`, `e2e/member-home.spec.ts`, and `src/app/launch/destination.test.ts` — every one is a file this pipeline edits directly, so the "which existing specs does this change alter the meaning of" question is answered by the file list above; no spec outside that list asserts on `GreetingBand`'s rendered text, the dark background color, or `computeDestination()`'s output, confirmed by `grep -rn "welcome\|Welcome" e2e/` and `grep -rn "DARK_BACKGROUND\|computeDestination" e2e/ src/app/launch/`.

## Out of Scope (confirmed carried from Phase 1)

- The org-switcher touch-target/truncation defects (`header-controls.spec.ts:131,426`) — real, pre-existing, unrelated to this bug — own future work-log.
- `public-sites.spec.ts:334` — inconclusive pending a run on an isolated Neon branch.
- `timezone-safe-dates.spec.ts:36,71` — database bloat (106 accumulated fixture users), not a code defect; no spec change proposed.
- Configuring `NEON_API_KEY`/`NEON_PROJECT_ID` so the CI e2e job actually executes — operator, Neon console.
- Cleaning the shared dev database (removing `admin@presby.invalid`'s stray `fpcw` membership; resetting `org_portal.home_v2`; pruning fixture-user bloat) — operator decision, tracked in `docs/TODO.md`.
- The generalized `globalSetup` "any unexpected membership" assertion — tracked in `docs/TODO.md`'s existing entry, not this pipeline (see Edge Cases above).
- Any change to `src/lib/auth/`, `src/lib/brand/`, `src/app/globals.css`, the three brand layouts, `drizzle/`, `scripts/`, or `src/lib/db/domain/` — reserved for parallel pipelines per the orchestrator's instruction; nothing in this design touches them.
- `destination.ts` and CLAUDE.md's Post-Login Landing table — confirmed correct as-is; no edit proposed.

## Verification (for QA, Phase 5)

**Run on a real dev server, on a free port** (3001/3002 are held by other agents' QA sessions — use `PORT=3003` with a matching `E2E_BASE_URL=http://localhost:3003`, or any other free port):

- `src/app/launch/destination.test.ts` (unit, via `npm test`) — including the new CLAUDE.md-table-driven block.
- `e2e/totp-full-login.spec.ts`, `e2e/totp-callback-bypass.spec.ts`, `e2e/branded-signin.spec.ts`, `e2e/admin-login.spec.ts` (`getByTestId("greeting-band")` assertions) — expect PASS.
- `e2e/color-scheme.spec.ts` — expect PASS after the constant fix.
- `e2e/post-login-routing.spec.ts`, `e2e/member-home.spec.ts` — expect the new `beforeAll` guard to **throw with a named-drift message**, not silently pass or silently fail as a pathname mismatch, **as long as the shared dev DB's stray `fpcw` membership on `admin@presby.invalid` has not been cleaned**. This is the expected, correct outcome of this pipeline on the current environment — QA should confirm the failure message names the drift, not chase the pathname assertion further.
- `e2e/post-login-routing.spec.ts` tests 4 and 7 will **still fail** for the unrelated, already-dispositioned `org_portal.home_v2`-drift reason (see Edge Cases) — QA should not re-litigate these; they are not this pipeline's regression to fix.
- Do not re-run or re-classify: `header-controls.spec.ts:131,426`, `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334` — already dispositioned in Phase 1 as out of scope.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run check` — all must pass.

## Commits

One `fix:` commit (Mixed-commit rule: everything here serves the single "e2e suite is red on main" fix — a stale-spec correction, a stable test hook, and a regression guard, not a new feature):

```
fix(e2e): stabilize greeting and add fixture-drift guards for the red suite

Caught-By: agent-review
Discovered-In: post-merge
Work-Log: 2026-09-25-e2e-red-on-main
```

`Caught-By: agent-review` — no CI job would have caught this without judgment; the e2e workflow has never actually executed (Phase 1, "Why Nobody Noticed"), and diagnosing stale-spec vs. real-regression vs. database-drift required an agent reading `GreetingBand`'s DECISION-125 comment, `destination.ts`, and live DB state, not a mechanical check.

## Release Notes

**Recommend no `docs/release-notes/vX.Y.md` entry.** Nothing member-visible changes: a `data-testid` attribute is invisible in the DOM's rendered output, and every other change is test-only. Rule 13 (what's-new advisory) and the release-notes skill both key off member-visible behavior, which this pipeline has none of.

## Implementer

**full-stack-developer** — small, spans one production file (a single additive attribute, no logic), several `e2e/*.spec.ts` files, one new `e2e/support/` helper, and one unit-test extension; splitting across api-developer/ux-developer would add handoff overhead disproportionate to the work.

---

# Phase 4 — Implementation

**Date:** 2026-09-25
**Implementer:** full-stack-developer

## Files Created

- `e2e/support/assert-fixture-invariants.ts` — one exported async function, `assertAdminFixtureHasNoOrgs()`, using the owner connection (`E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL`) to count `admin@presby.invalid`'s organization memberships (joining `memberships` → `people` → `users`, filtering `people.merged_into_id is null`, mirroring `presby_user_organizations()`'s own security predicate) and throw — never warn or skip — naming the drift when the count is nonzero.

## Files Modified

- `src/components/shared/greeting-band.tsx` — added `data-testid="greeting-band"` to the `<h1>`. Purely additive; zero change to the time-of-day copy logic (DECISION-125 stands).
- `e2e/admin-login.spec.ts` — rewrote the `/welcome/i` heading assertion to `page.getByTestId("greeting-band")).toContainText(ADMIN.name)`; added `test.beforeAll(assertAdminFixtureHasNoOrgs)` to the describe block.
- `e2e/branded-signin.spec.ts` — rewrote the one `/welcome/i` assertion (case 2, the MFA-enrolled callback) the same way, against `USER.name` (`"E2E MFA Enrolled Admin"`).
- `e2e/totp-full-login.spec.ts` — rewrote the one `/welcome/i` assertion the same way, against `USER.name`.
- `e2e/totp-callback-bypass.spec.ts` — rewrote exactly the four `/welcome/i` assertions named in the design (lines 59, 78, 129, 146 as read at design time): the negative case (test 1, mid-challenge) became `page.getByTestId("greeting-band")).not.toBeVisible()`; the three positive cases became `toContainText` against the appropriate fixture's `.name`. Rebased against the security-fix pipeline's Tests 5–7 immediately before editing (confirmed via `grep -n "welcome/i"` that no line numbers had shifted); touched nothing else in the file — verified by `git diff` showing only these four hunks.
- `e2e/color-scheme.spec.ts` — `DARK_BACKGROUND` constant corrected from `rgb(15, 23, 41)` (stale `hsl(222 47% 11%)`) to `rgb(6, 18, 35)` (current `hsl(215 71% 8%)`, `globals.css:97`). Verified the conversion by hand (HSL→RGB) before editing.
- `e2e/post-login-routing.spec.ts` — added `test.beforeAll(assertAdminFixtureHasNoOrgs)` at file top level (the file has no single wrapping `describe`, so a top-level `beforeAll` is the correct scope for "once per file").
- `e2e/member-home.spec.ts` — added `test.beforeAll(assertAdminFixtureHasNoOrgs)` inside the describe block.
- `src/app/launch/destination.test.ts` — added a new `describe("computeDestination — CLAUDE.md's Post-Login Landing table (CLAUDE.md:606-612)", ...)` block, five `it()`s, one per row of the table (verbatim, cited in each title): row 1 (any/any/any → sanitized `?next=`), row 2 (1/no/no → `/o/<slug>`), row 3 (0/no/no → `/no-organization`), row 4 (0/yes/no → `/admin`), row 5 (everything else → `/home`, table-driven over six representative combinations: 2+ orgs alone, 1 org + canAccessAdmin, 1 org + isPlatformAdmin, 0 orgs + isPlatformAdmin only, 0 orgs + both predicates, 2+ orgs + both predicates). Every existing `it()` in the file is unchanged — confirmed 18 pre-existing + 5 new = 23 passing.
- `docs/work-log/2026-09-25-e2e-red-on-main.md` — this Phase 4 section, Per-Phase Status.

## Schema Changes

None. No `ALTER`/`DROP`/`CREATE` in this pipeline's committable diff.

**Separately (not a schema change — data hygiene on the shared `development` Neon branch, operator-authorized 2026-09-25, executed against `MIGRATE_DATABASE_URL` via the WebSocket `Pool`, listed-then-deleted, inside explicit transactions):**

1. **Stray membership removal.** `admin@presby.invalid`'s person row ("Admin Fixture", `id=089501ee-b841-4fc5-b11f-941785a5f3a3`, created 2026-08-24, present in no committed seed) carried one `fpcw` membership plus two rows derived from it. All three referencing rows were listed before deletion (printed in-run) and removed in one transaction:
   - `ALTER TABLE group_memberships DISABLE TRIGGER group_memberships_reject_derived` (the row's `source = 'derived'` — `officer_term_id` was null, `group_role = 'member'`, so it was the plain active-membership projection, not a court seat)
   - `DELETE FROM group_memberships WHERE id = 'e1853f94-b1aa-4446-9eea-494f3ab397eb'` — 1 row
   - `ALTER TABLE group_memberships ENABLE TRIGGER group_memberships_reject_derived`
   - `DELETE FROM role_grants WHERE id = 'f0369129-4e08-46f3-b8b6-f6a2add91fbc'` — 1 row (its own `grant_reason` column read verbatim: `"dev-seed: give admin@presby.invalid full portal-admin access at fpcw for local testing"`, confirming it as exactly the kind of manual-verification leftover Phase 1 described)
   - `DELETE FROM memberships WHERE id = '2e577827-59dd-426f-8b53-7ee584dc3fff'` — 1 row (no `memberships_guard_end` conflict: that trigger only fires on `UPDATE OF ended_on`, not `DELETE`)
   - `DELETE FROM people WHERE id = '089501ee-b841-4fc5-b11f-941785a5f3a3'` — 1 row (confirmed first: 0 `roll_actions`, 0 rows in every other `person_id`-bearing table checked: `addresses`, `appointments`, `background_checks`, `congregation_feedback`, `consents`, `contact_methods`, `follow_ups`, `officer_terms`, `ordinations`, `person_demographics`, `person_disabilities`, `person_identifiers`, `person_medical`, `person_milestones`, `person_notes`, `person_privacy`, `person_relationships`, `person_tags`, `person_talents`, `staff_positions`)
   - `COMMIT`
   - Verified after commit: `SELECT * FROM presby_user_organizations('84a285f6-c58c-4d44-8f65-fe3fc8f4999f'::uuid)` → `0` rows.
2. **Fixture-user pruning.** Candidate pattern: `email ~ '^[a-z0-9-]+-test-[a-z0-9-]*[0-9]{10,}@example\.invalid$'` (every vitest fixture in the codebase follows `<suite>-test-...-${Date.now()}@example.invalid`, confirmed by grepping every `*.test.ts` email literal before writing the pattern — 13-digit `Date.now()` stamps, `@example.invalid` domain only). `users` before: 106. Candidates matched: 81. Sample (first 3): `people-test-1787695305163@example.invalid`, `people-test-1787695591372@example.invalid`, `people-test-1787695637011@example.invalid`; sample (last 3): `role-grants-test-granter-1790347967894@example.invalid`, `person-sensitive-test-1790347967185@example.invalid`, `staff-actions-test-1790347981716@example.invalid` — timestamps span 2026-08-25 through 2026-09-25, i.e. one month of accumulated Vitest runs against the shared branch. `DELETE FROM users WHERE email ~ '<pattern>' RETURNING id, email` inside one transaction — 81 rows, relying on the schema's own cascades (`accounts`, `sessions`, `user_totp*`, `password_reset_tokens` — `ON DELETE CASCADE`; `people.user_id` — `ON DELETE SET NULL`, and none of the 81 candidates had a `people` row of their own that survived, since none appeared in the membership-inspection query). `users` after: **25** — exactly the 8 `e2e/support/users.ts` fixtures + 9 `scripts/seed-dev.sql` `users`-table fixtures + 8 pre-existing, ambiguous, non-pattern-matching rows (`dev@example.invalid` and seven `e2e-*@example.invalid` rows from an earlier, since-renamed e2e-fixture-naming convention) left alone per the "leave anything ambiguous" instruction. `COMMIT`.
3. Left untouched, as instructed: `org_portal.home_v2` (still `true` on this branch — deliberate fpcw-demo state, operator decision, tracked `docs/TODO.md:112`) and every feature flag.

No Drizzle migration, `db:push`, or `db:generate` involved in either step — both are `DELETE` statements against existing rows on an already-migrated schema, run once, not committed as code.

## Audit Events

None. No security-sensitive mutation in the shipped code diff (a `data-testid` attribute, spec assertions, and a unit test are not mutations). The two out-of-band data-hygiene deletions were run directly against the database via the owner connection, outside the application's own mutation path, so `recordAudit()` does not apply — there is no in-app actor or session to attribute them to; they are recorded here instead, per the operator's own instruction to "record the exact statements and row counts."

## Implementer Notes

- **Failing-first, confirmed.** Before the `data-testid` landed, `getByRole("heading", { name: /welcome/i })` could not match `GreetingBand`'s time-of-day copy — this was Phase 1's own live reproduction and is unchanged by anything in this diff; the four `totp-callback-bypass.spec.ts` assertions, the `admin-login.spec.ts` assertion, the `branded-signin.spec.ts` assertion, and the `totp-full-login.spec.ts` assertion all read this way pre-fix. After the `data-testid` landed and the specs were rewritten, all seven now pass (see the Phase 5 handoff run below) — a real failing-then-passing transition for the greeting bug, not merely a design claim.
- **`assertAdminFixtureHasNoOrgs()` needed two schema corrections against the design's sketch.** The design's connection-pattern note (`e2e/support/seed-orgs.ts`) was right, but `memberships` has no `user_id` column — the join has to go `memberships.person_id → people.id → people.user_id → users.id`. Added `people.merged_into_id IS NULL` to mirror `presby_user_organizations()`'s own security predicate (drizzle/0014), since a merged-away duplicate person row should not count as a live membership either. Confirmed against a live run: the guard evaluated cleanly (no throw) once the stray membership was removed, and none of the three coupled specs' `beforeAll` fired a false positive.
- **Data-hygiene order of operations was non-obvious and is recorded here for the next person who has to do this again.** `group_memberships` is `FORCE`-guarded against direct writes when `source = 'derived'` (`presby_reject_derived_group_write()`, drizzle/0033) — a plain `DELETE` was rejected until the trigger was disabled for exactly the one statement, then re-enabled inside the same transaction, matching the operator's own instruction. `memberships_guard_end` turned out not to apply at all (it is keyed to `UPDATE OF ended_on`, not `DELETE`) — worth confirming before assuming it needs the same disable/enable treatment on a future cleanup. `role_grants_needs_membership`/`officer_terms_needs_membership` are `INSERT`/`UPDATE`-only for the same reason. `group_memberships.membership_id` carries a real FK to `memberships(id, organization_id)` with no `ON DELETE` action, so `group_memberships` had to go first or the `memberships` delete would have thrown a foreign-key violation.
- **`post-login-routing.spec.ts` tests 4 and 7 still fail, exactly as Phase 3 predicted.** Both assert the committed-default (`org_portal.home_v2` OFF) rendering; the flag is deliberately `true` on this shared branch for the fpcw demo (`docs/STATE.md`, 2026-08-25; tracked `docs/TODO.md:112`). Not this pipeline's regression — no spec change proposed, per the design's explicit instruction not to make these two specs flag-aware.
- **One unrelated, concurrent-pipeline test failure observed and left alone.** A full `npm test` run showed `src/components/shared/global-nav.test.tsx:288` failing (`expect(trigger.className).toContain("min-w-11")`) — this file is mid-edit by a different, concurrently-running pipeline (`docs/work-log/2026-09-25-org-switcher-touch-target.md`, which appeared in `git status` as untracked during this session and is exactly the accessibility defect Phase 1 of *this* work-log flagged as out-of-scope future work). Not a file this pipeline touches; not caused by anything in this diff. Confirmed via `git status --porcelain` that `global-nav.tsx`/`global-nav.test.tsx` are not in this pipeline's file list.
- **The Next.js dev-server lock (Rule 16) was hit and respected.** `PORT=3002 npx playwright test ...` initially refused to start (`Another next dev server is already running`, PID 69729 on 3001, `.next/dev/lock`) — did not kill it; polled with a bounded until-loop (~4 minutes total) until the lock cleared naturally, then ran the full verification suite once against a fresh server.

### Running-server verification (this session, not QA's — recorded here for QA's convenience; QA should re-run independently per its own read-only mandate)

`PORT=3002 E2E_BASE_URL=http://localhost:3002 npx playwright test e2e/admin-login.spec.ts e2e/totp-full-login.spec.ts e2e/totp-callback-bypass.spec.ts e2e/branded-signin.spec.ts e2e/member-home.spec.ts e2e/post-login-routing.spec.ts e2e/color-scheme.spec.ts`

**38 passed, 2 failed, 40 total** (1.3 minutes):

| Spec | Result |
|---|---|
| `e2e/admin-login.spec.ts` (all 4) | PASS |
| `e2e/branded-signin.spec.ts` (all 4) | PASS |
| `e2e/color-scheme.spec.ts` (all 4) | PASS |
| `e2e/member-home.spec.ts` (all 8) | PASS |
| `e2e/post-login-routing.spec.ts` tests 1, 2, 3, 5, 6, 8, 9, 10, 11, 12 | PASS |
| `e2e/post-login-routing.spec.ts` test 4 ("a deep link to an organization survives the sign-in round trip") | **FAIL — expected**, `org_portal.home_v2` drift, dispositioned above, not this pipeline's regression |
| `e2e/post-login-routing.spec.ts` test 7 ("two organizations get the chooser, with no membership language") | **FAIL — expected**, same cause |
| `e2e/totp-callback-bypass.spec.ts` (all 7, including the security pipeline's Tests 5-7) | PASS |
| `e2e/totp-full-login.spec.ts` | PASS |

Also, separately: `npm run typecheck` — PASS. `npx eslint` on every file this pipeline touched — 0 errors, 0 warnings. `npm test` (full suite) — 3239 passed / 1 failed (the unrelated concurrent `global-nav.test.tsx`, see above) / 760 skipped; `src/app/launch/destination.test.ts` alone: 23/23 passed. `npm run check` — all five tripwires passed, run twice (before and after the data-hygiene step, since it touches the database, not the codebase).

## Handoff to QA

- **Browser-check nothing new is needed** — no page or component changed visually; the only production-code change is an invisible `data-testid` attribute. QA's job is the suites, not a visual check.
- **Re-run the exact command above** on a fresh port (check `lsof` first; the same dev-server lock discipline applies) and confirm the same 38/2 split, with the 2 failures being tests 4 and 7 of `post-login-routing.spec.ts` and no others.
- **Do not re-litigate** `header-controls.spec.ts:131,426`, `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334` — out of scope, dispositioned in Phase 1.
- **`docs/TODO.md`** already carries the shared-dev-database-hygiene entry (`docs/TODO.md:112`) this pipeline partially executed (the membership and user-bloat halves); it should be updated to reflect that those two sub-items are now done, leaving only the isolated-Neon-branch recommendation and `public-sites.spec.ts:334` open. **That edit is explicitly out of this pipeline's file scope** (Rule 16 excludes `docs/TODO.md`) — flagging for the orchestrator/analyst to make in Phase 6, not doing it here.
- Next: **qa**, Phase 5.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25 · **Verified by:** qa

All runs performed against an **isolated APFS clone of the repo outside the project tree**, serving its own dev server on port 3005 (port 3000 held by another pipeline's `next dev`; neither killed nor reused). The project working tree was not modified (`git diff --numstat` before/after identical).

## Type Check

`npm run typecheck`: **PASS**.

## Unit Tests

Total 4000 | Passed **3240** | Failed 0 | Skipped 760 | 11.7s. `src/app/launch/destination.test.ts`: **23/23** (18 + 5 new). The concurrent `global-nav.test.tsx` failure the implementer saw has cleared (the org-switcher pipeline landed its fix). The 760 skips are the DB-gated suites — `npm test` does not load `.env.local` — pre-existing; a standing item for the test-coverage review.

## End-to-End Tests

Real dev server (`E2E_BASE_URL=http://localhost:3005`), `globalSetup` provisioning all 8 fixture users incl. the MFA-enrolled admin. **Total 40 | Passed 38 | Failed 2.**

| Spec | Result |
|---|---|
| `totp-callback-bypass.spec.ts` (7) | **PASS** incl. the security pipeline's Tests 5–7 |
| `totp-full-login.spec.ts` (1) | **PASS** — full password → TOTP → `/admin` path |
| `admin-login` (4), `branded-signin` (4), `color-scheme` (4), `member-home` (8) | **PASS** |
| `post-login-routing` tests 1,2,3,5,6,8,9,10,11,12 | **PASS** |
| `post-login-routing.spec.ts:110` test 4, `:166` test 7 | **FAIL — predicted, environmental** |

**The two reds fail for the predicted reason, proven:** `feature_flags` → `org_portal.home_v2 enabled = true`, `updated_at 2026-08-25` (a month old); the failure's DOM snapshot shows the flag-ON portal, not `OrgPortalStub`; `src/app/(org)/o/[slug]/page.tsx:130-147` branches on the flag and only the OFF branch renders the `<h1>{name}</h1>` / "You're in." markup those tests assert. Test 4's routing half succeeded. Not this pipeline's regression; persists until the operator resets the flag or e2e moves to an isolated branch. **Callers should not read this PASS as "the e2e suite on main is green"** — it is green except for these two.

Not re-run per Phase 3: `header-controls.spec.ts:131,426` (own pipeline), `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334`.

## Regression Tests Added (verified; failing-first confirmed independently)

- **Greeting hook:** `greeting-band.tsx` reverted to `git show HEAD:` in the scratch copy → **6 failed / 8 passed**, every failure `getByTestId('greeting-band')` not found at `admin-login.spec.ts:39`, `branded-signin.spec.ts:324`, `totp-callback-bypass.spec.ts:78,:132,:152`, `totp-full-login.spec.ts:62`; restored → **16/16**.
- `src/app/launch/destination.test.ts:201-256` — the CLAUDE.md Post-Login Landing table, **proven load-bearing by two implementation mutations**: `destination.ts:136` `/home`→`/orgs` ⇒ row 5 fails; `:123` `/admin`→`/home` ⇒ row 4 fails. `CLAUDE.md:606-612` on disk is exactly that table, five rows 1:1.
- `e2e/support/assert-fixture-invariants.ts:42` + `beforeAll` at `admin-login.spec.ts:11`, `member-home.spec.ts:16`, `post-login-routing.spec.ts:30` — **proven to fire** with the real, unmodified function against a fixture that genuinely holds memberships (a rolled-back transaction is not observable by the function's own connection — method deviation stated): named message with the org list and the pointer to the TODO entry; resolves cleanly for `admin@presby.invalid`. Wiring verified by reading the three files.
- `e2e/color-scheme.spec.ts:36` — `rgb(6, 18, 35)` matches `globals.css:97`.
- Coverage weakness, non-blocking: `totp-callback-bypass.spec.ts:58`'s `not.toBeVisible()` passes vacuously if the hook is deleted; anchored by three positive assertions in the same file.

## Data-Hygiene Audit (owner connection)

| Claim | Result |
|---|---|
| `presby_user_organizations(<admin fixture>)` | **0 rows** ✓ |
| `count(*) from users` | **25** ✓ (8 e2e + 9 seed-dev + 8 legacy) |
| no `people` row "Admin Fixture" / no `people.user_id = <admin fixture>` | ✓ removed, not retained |
| orphan `memberships`/`role_grants`/`group_memberships`/`accounts`/`sessions` | **0** on a null-aware check (a naïve `LEFT JOIN … IS NULL` reports 4 + 9 bogus orphans — nullable-column artifacts) |
| `org_portal.home_v2` | unchanged, `true`, 2026-08-25 |

## Coverage on Critical Modules

`permissions.ts` 100% · `two-factor.ts` 91.3% / 100% branch · `flags.ts` 100% · `destination.ts` 100%/100%.

## Tripwires & Lint

`npm run check` 5/5 PASS · eslint on all 10 touched files 0/0.

## Feature-Gate Audit

**No protected routes touched.** The only production change is a `data-testid` on an existing `<h1>` in a presentational component. Schema/RLS: no schema change; the data-hygiene `DELETE`s verified above against the live catalog.

## Verdict

**PASS.** The auth-stricter gate is satisfied on its own terms — both TOTP specs ran on a real server with the MFA-enrolled fixture; nothing deferred. Two residual reds are independently proven environmental (the operator's deliberate `org_portal.home_v2 = true`) and out of scope per Phase 3; they do not gate this verdict but the suite is not yet fully green on `main`.

## Notes for Phase 6

1. Rule 10: `docs/TODO.md`'s shared-dev-database-hygiene line — two sub-items (stray membership, 81-row bloat) are now done.
2. The suite is not green on `main` until `home_v2` is reset or e2e moves to an isolated branch — a tracked line.
3. The CI e2e job has never executed (`NEON_API_KEY`) — operator work.
4. `npm test` skips 760 DB-backed tests — test-coverage review.

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |

---

# Phase 6 — Shipped vs Intent (analyst)

*Bug-fix variant; recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

Both bugs Phase 1 actually confirmed — the stale `/welcome/i` literal against `GreetingBand`'s intended time-of-day copy, and the false "`/admin` vs `/home`" alarm that was really a polluted shared dev DB — are fixed and independently re-proven failing-then-passing by QA on an isolated clone; the fix stayed exactly in its authorized lane (test files, one additive `data-testid`, the two data-hygiene `DELETE`s the operator explicitly authorized), and the suite's remaining two reds are correctly attributed to a pre-existing, already-tracked, out-of-scope flag drift.

## What's Working

- **The `data-testid="greeting-band"` hook is the right shape**: it decouples the seven assertions from `timeOfDayGreeting()`'s copy rather than reverting DECISION-125. Six of seven are `toContainText(fixture.name)` — real, content-anchored — and QA proved them failing-first (6 failed / 8 passed → 16/16).
- **Bug 2 correctly closed as not-a-bug**, well-evidenced (routing code, its test and CLAUDE.md agreed; a live DB query found the stray membership). `assert-fixture-invariants.ts`'s thrown message redirects the next reader away from `computeDestination()` toward the data problem; QA proved it fires and resolves cleanly post-cleanup.
- **`destination.test.ts:201-271` pins CLAUDE.md's table to the code row for row**, proven load-bearing by mutation.
- **The authorized data hygiene was executed exactly as authorized and no further** (stray membership + two derived rows; 81 users by a verified regex; `org_portal.home_v2` untouched), independently confirmed by QA's audit.
- **Scope discipline held under a real collision** on `totp-callback-bypass.spec.ts`: only the four named lines touched; all seven tests pass.

## Intent-vs-Shipped Diff

- Greeting copy → a stable hook, zero copy change, one-line diff: **matches**.
- `/admin` vs `/home` → no routing/doc edit, a loud guard at three call sites: **matches**.
- "Six" assertions in Phase 1 vs seven shipped: **acceptable drift** — seven is right (Phase 3 recounted; `member-home.spec.ts` has none).
- `totp-callback-bypass.spec.ts:58`'s `not.toBeVisible()` cannot distinguish "correctly absent" from "hook deleted": **acceptable drift**, a one-line hook-shape follow-up, anchored by three positive assertions in the same file.
- `docs/TODO.md` reconciliation flagged by Phase 4 (Rule 16) is owed in the ship commit (Rule 10).

## Edge Cases

Empty state, failure microcopy, permission gate, mobile: n/a (test files plus one invisible attribute; no new UI, no mutation). Audit event: n/a to the code diff; the two owner-connection `DELETE`s have no in-app actor and are fully recorded in Phase 4 with statements and counts — the right substitute.

## Follow-Ups

1. `docs/TODO.md`: mark the stray-membership removal and the 81-row pruning done on the pollution line (leave the isolated-branch recommendation and `public-sites.spec.ts:334` open); on the "e2e suite is RED on main" line mark the greeting-copy and destination-table portions shipped and note that `post-login-routing.spec.ts` tests 4 and 7 stay red until `org_portal.home_v2` is reset or e2e runs on an isolated branch; add the `:58` hook-shape gap.
2. The two `post-login-routing` reds — operator decisions, tracked.
3. `NEON_API_KEY`/`NEON_PROJECT_ID` — operator action, tracked.
4. `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334` — unclassified pending an isolated-branch run, tracked.
5. Org-switcher — its own pipeline.

## Rules 12/13

No feedback row. No what's-new (nothing member-visible). **No release-notes entry** (test-only; one invisible attribute).

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

### Orchestrator closure (2026-09-25)

One `fix(e2e):` commit with `Caught-By: agent-review`, `Discovered-In: post-merge`, `Work-Log: 2026-09-25-e2e-red-on-main`; TODO reconciled per follow-up 1 in the same commit; no release-notes entry, no version bump.
