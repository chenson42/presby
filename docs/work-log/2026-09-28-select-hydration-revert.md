# F116 — a pre-hydration selection in the statistics form's native <select> can be silently reverted — Work Log

> **Slug:** `2026-09-28-select-hydration-revert`
> **Surface:** `(org)/o/[slug]/admin/reports` — `statistics-form.tsx`'s `#stats-congregation` native `<select>` registered via react-hook-form; possibly every RHF-registered native `<select>` in the codebase (analyst to inventory)
> **Permission(s):** none new
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Feature (reclassified from Bug-fix variant at Phase 2, 2026-10-05 — shared primitive + new e2e lane + new tripwire)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-28, wave 5 — "finish the presbytery portal so PSV can be onboarded, tested and deployed"):** worktree `../presby-wt-select` on git branch `pipeline/select-hydration`; Neon branch `pipeline-select-hydration` (`br-broad-haze-axdhzmif`, forked from `development` at the v0.28.2 state). **Pre-assigned numbers:** no migration; `DECISION-159` only if a decision results; findings `F121` onward. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md`, `docs/product/functionality-map.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge; the pipeline's Neon branch is deleted at cleanup). `scripts/seed.ts`, `src/lib/org-portal/tiles.ts` and `src/lib/audit.ts` are high-collision: one clearly delimited addition each. **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148); every deny helper reachable from a tenant-path trigger grants EXECUTE to `presby_app, presby_platform` (0046 B-M1, re-learned as the increment-7 QA FAIL). Tests must mint their own fixture rows — a mandatory browser rehearsal on the pipeline branch consumes single-use seed rows (the withdraw pipeline's QA FAIL). Dev-server port `3700`; stop by PID; never `pkill -f`. `dotenv -e .env.local` does NOT override an already-exported `DATABASE_URL` — check `env | grep DATABASE_URL` first.
> **The finding (F116, `docs/work-log/2026-09-28-presbytery-e2e.md` Phase 5 first pass, QA):** against the dev server, in three un-settled trials of the reports page, one selection of `#stats-congregation` took and then **silently reverted to a different congregation ~3 s later**, and two never took at all; with `waitForLoadState("networkidle")` the selection was stable. The e2e spec masks it with that wait. A clerk who picks a congregation before hydration completes can have that choice rewritten with no visual signal, on the form that writes a congregation's annual statistics — a data-integrity hazard if it reproduces on a production build. `docs/TODO.md` carries it as a candidate bug-fix.
> **Phase 1 must first decide whether the bug is real in production:** reproduce on `next build && next start` (port 3700) with throttled CPU/network in Playwright, not only on the Turbopack dev server (whose hydration window is far wider). If it does not reproduce on a production build under realistic throttling, the verdict is NOT YET with the evidence recorded and the TODO line corrected — do not build a fix for a dev-server artefact. If it does: identify the mechanism (RHF `register()` on an uncontrolled native `<select>` whose `defaultValue`/`reset()` lands after hydration; a `useEffect` resetting the form when `congregations` props arrive; the page's `?year=` re-render) and inventory every other RHF-registered native `<select>` that shares it.
> **Constraints:** no `src/lib` change expected; the fix is in the form component(s); the regression test must be a Playwright case that fails WITHOUT the fix on a production build (an interaction before hydration) — the e2e suite already runs against the dev server, so Phase 3 rules where that case lives and whether `webServer` needs a production-build mode.
> **Out of scope:** the year-guard work just shipped in `2026-09-28-statistics-error-mapping` (v0.28.1); any redesign of the reports page.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — REAL on a production build (10/10 under throttling); the wrong congregation's statistics are persisted with a success toast; mechanism: RHF uncontrolled `register()` on a native `<select>` reconciles `defaultValues` onto the DOM at hydration; 9+ other forms share the shape | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Complete — form-level `HydrationGate` (`useSyncExternalStore`) on all 18 RHF form roots; Controller conversion rejected (F121); regression in `e2e/hydration/` holding JS chunks via `page.route`, run in the default lane and a new `PW_PROD_BUILD=1` production-build lane; no new dependency; F121–F125; DECISION-159 proposed; **reclassified to Feature** | Approved with suggestions | 2026-10-05 |
| 3 — Technical design | tech-lead | Complete — all nine handoff items designed: `useHydrated` + `HydrationGate` (wrapping each of the 18 RHF roots from outside the `<form>`), 16 select class strings, `check-hydration-gate` tripwire, `PW_PROD_BUILD=1` lane on port 3800 with a four-layer "never a dev server" guard, `e2e/hydration/statistics-congregation.spec.ts` (held JS chunks, persisted-row assertion, negative control), unmasking of the `networkidle` lines, `e2e.yml` step, scratch-copy rehearsal (verified: builds clean in 16 s), doc edits. Verified against the live tree; one Phase 2 premise corrected (RHF 7.86.0 does not skip a DOM-disabled control) | Design complete | 2026-10-05 |
| 4 — Implementation | full-stack-developer | Complete — four slices: `HydrationGate` + `useHydrated` with unit tests (13) and the jsdom hydrate proof; gate on all 18 RHF roots + 16 select class strings + 3 SSR wiring tests; `check-hydration-gate` tripwire (six tripwires, flip-tested, 16 fixture tests); `PW_PROD_BUILD=1` lane (port 3800, four-layer guard, `test:e2e:prod`), `e2e/hydration/statistics-congregation.spec.ts` (3 tests, red without the gate in both lanes, green with it), `networkidle` masks removed from three presbytery specs, `e2e.yml` step, docs. Verified: typecheck, lint, check, `npm test` 3410 passed, DB suite 4307 passed, dev-lane hydration + presbytery specs 26 passed, production lane 3 passed, full e2e 167 passed / 0 failed / 0 skipped. Four small deviations (none changes a ruling) | Ready for qa | 2026-10-05 |
| 5 — Verification | qa | Complete — typecheck/lint/six tripwires (flip-tested); `npm test` 3410; DB suite 4307/0 skipped; full e2e 167/0/0; prod lane 3/3 with the negative control red at the first `toBeDisabled()`; lane guards proven; realism 0/10 reversions under CPU×4 + slow-3G (disabled ≈7.2 s, the JS download); 360px clean; no protected routes touched | PASS | 2026-10-05 |
| 6 — Shipped vs intent | analyst | Complete — F116 closed on all 18 roots with production proof; ≈7.2 s disabled window and blank-until-hydration edit forms accepted for go-live with follow-ups (F130, bundle/busy cue); audit intent-vs-outcome gap now tracked; what's-new: no; integrated as v0.30.0 | SHIP WITH NOTES | 2026-10-05 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Work-log:** `docs/work-log/2026-09-28-select-hydration-revert.md` (F116, bug-fix variant)
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-select` (branch `pipeline/select-hydration`, Neon branch `pipeline-select-hydration`) — no repository file was modified; all repro tooling lived in the session scratchpad and a git-untracked sibling build copy, both removed at the end of this session. `git status` in the worktree shows only the pre-existing untracked work-log file.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> F116 is real, reproduces on a genuine `next build && next start` production server under realistic (not contrived) mobile-network conditions, and is worse than QA's dev-server finding suggested — I drove it end-to-end and confirmed the server actually **persists a different, real congregation's annual statistics than the one the clerk clicked**, with a "Statistics saved." success toast and no error anywhere, and the same uncontrolled-`register()`-on-a-`<select>` shape recurs in at least nine other forms across the codebase (person pickers, org pickers, a household picker), several of which are equally or more consequential (misattributing a pastoral appointment or ordination to the wrong minister).

## Reproduction — what I actually did

Per the kickoff, "Phase 1 must first decide whether the bug is real in production" before any five-pass review is worth doing. I reproduced first, then wrote the review against confirmed evidence, not the kickoff's hypothesis.

**Setup.** `env | grep DATABASE_URL` was empty before starting. I seeded the existing, idempotent e2e fixtures (`e2e/support/seed-users.ts` / `seed-orgs.ts`, called directly via `tsx` from the scratchpad — read-only on the repo, write-only to the DB, the same idempotent pattern the e2e suite already uses) onto this pipeline's Neon branch, since it forked from `development` before the presbytery-e2e pipeline's fixtures existed there. This created `presbytery-clerk@presby.invalid` / `e2e-fixture-only-not-a-secret` (the kickoff's `presbytery.clerk.fixture@example.invalid` does not exist anywhere in the codebase — the real fixture is the one `e2e/support/users.ts` defines) and the `e2e-presbytery` / `e2e-alpha` / `e2e-beta` / `e2e-gamma` orgs. `org_portal.reports` was already enabled on this branch.

**Environment finding, not a code defect.** `next build` on this Next 16.3.6 + Turbopack setup intermittently fails with `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'` when `next.config.ts`'s deliberate `turbopack.root` (set one directory up, to `presby-platform/`, for the `presby-site-kit` npm-link case) sits inside a tree with sibling worktrees. This is the exact quirk `docs/work-log/2026-09-26-flags-fail-closed.md`'s Phase 4 Acceptance section already documented and worked around. I followed the same documented workaround: an external, git-untracked scratch copy (`~/git/presby-platform/scratch-select-build`, sibling to this worktree, rsync'd source + a hardlinked `node_modules` — never a symlink, which is what triggers the quirk), built there, ran `next start -p 3700` from there, and deleted the scratch copy when done. Worth a TODO note (below) — this cost two failed build attempts before a clean one, confirming it's flaky/order-dependent even with the documented fix, not something `rm -rf .next` alone resolves.

**Trial methodology.** A standalone Playwright script (scratchpad-only, not `@playwright/test`'s runner — no repo file touched) signed in as `presbytery-clerk@presby.invalid` via the real `/signin` UI form (no mocking), then on `/o/e2e-presbytery/admin/reports`: navigated with `waitUntil: "commit"` (not `"load"` or `"networkidle"`), located `#stats-congregation` as soon as it attached, and called `selectOption()` on the **second** option in DOM order as fast as possible — before hydration can plausibly be complete. It then polled `inputValue()` every 200ms for 5s.

| Server | Condition | Trials | Stable & correct | Reverted (took, then silently changed) | Never took (already wrong on first poll) |
|---|---|---|---|---|---|
| **Production** (`next build && next start`, port 3700) | No throttle | 10 | **10** | 0 | 0 |
| **Production** | CPU ×4 (CDP `Emulation.setCPUThrottlingRate`) + a slow-3G-like profile (500 kbps / 400 ms latency, CDP `Network.emulateNetworkConditions`) | 10 | 0 | **10** | 0 |
| **Dev** (`next dev -p 3700`, Turbopack) | No throttle | 10 | 0 | 0 | **10** |
| **Dev** | Throttled | not run — already saturated at 100% failure with zero throttling; adding throttle would only tell us it stays saturated | — | — | — |
| **Production** | Throttled, **no interaction at all** (sanity check) | 3 | n/a | n/a | 0 — the default value never changes on its own; the defect requires a pre-hydration click | |

Every reversion, on every trial, on every server, landed on **exactly** the form's `defaultValues.aboutOrgId` — `congregations[0]` after `listMemberCongregations()`'s `orderBy(organizations.name)` (`src/lib/presbytery.ts:229`), which for this fixture is "Halloway Presbyterian Church," never a third value, never a partially-applied state. It is a single, one-time, deterministic correction, not a flicker.

**The decisive check: does the wrong value actually get persisted, or does Submit re-read the screen?** I drove the race to completion: select "Thistledown" under throttle, wait for the observed revert to "Halloway," fill the numeric fields *without re-touching the select*, click "Save statistics." The UI showed a **"Statistics saved." toast — no error, no warning** — and the page's own statistics table re-rendered showing the new row attributed to **Halloway**. I confirmed directly against the database (via the owner connection, since `presby_app` is RLS-scoped and a naive read from that connection silently returns zero rows without `withOrgContext()` — not a bug, just why my first DB check came back empty):

```
about_org_id: e2e00000-0000-0000-0000-000000000004  -- Halloway (the default the UI silently reverted to)
organization_id: e2e00000-0000-0000-0000-000000000001
year: 2025
ending_active: 42
```

The clerk clicked Thistledown. The server wrote Halloway. There is no error, no confirmation step, and the `CONGREGATION_STATISTICS_ENTERED` audit row (`src/app/(org)/o/[slug]/admin/reports/actions.ts:94-99`) faithfully records `aboutOrgId: Halloway` — internally consistent with the wrong row, giving a forensic reviewer no way to see that the clerk's intent diverged from what was saved. I cleaned this fixture row up afterward using the same disable-trigger/delete/enable-trigger pattern `presbytery-reports.spec.ts` already uses for `congregation_statistics_freeze`, and confirmed the trigger reads `'O'` (enabled) and no residual row remains.

**Conclusion: this is not a test-timing artifact. It is a real, production-reachable data-integrity defect** on the exact form CLAUDE.md's "No Custom Fields... the ticket loop is load-bearing" and "The Roll Is the System of Record" ethos would call a Tier-1 concern if it were roll data — here it's a presbytery's own annual aggregate about a member congregation, silently misattributed.

## Mechanism

`StatisticsForm` (`statistics-form.tsx:151-291`) is a Client Component. `useForm({ defaultValues: defaultValues(congregations, year) })` computes `aboutOrgId: congregations[0].organizationId` once, at the form's first React render. The `<select id="stats-congregation" {...register("aboutOrgId")}>` (`:282-291`) is **uncontrolled** — no `value=`/`defaultValue=` prop on the `<select>` itself, RHF's `register()` manages it purely through its `ref` callback and a `change` listener.

Server-rendered HTML paints the select with the browser's natural default (first `<option>`, matching `congregations[0]`). If a user (or, on a slow phone, the still-loading browser itself racing a real tap) changes the select's value **before** the Client Component boundary hydrates, the live DOM now disagrees with what `register()`'s ref callback will compute as "the field's value" when it attaches. When hydration reaches this component and the ref callback runs, it performs a one-time reconciliation that writes RHF's own tracked `defaultValues.aboutOrgId` back onto the DOM element — silently overwriting whatever the user had already set, without going through the field's own `onChange` (so nothing re-renders to signal a change) and without any indication in the UI. This is a known category of pitfall with uncontrolled native `<select>`/`<input>` + SSR + a form library that reconciles DOM-to-state at mount, not novel to this codebase, but this is the first time this codebase has hit it. It explains every observed property: it needs a pre-hydration interaction (confirmed by the no-touch sanity trials), it always lands on exactly `defaultValues`, and it happens once, not repeatedly.

This is squarely a component-level fix (matches the kickoff's stated constraint) — most likely converting `aboutOrgId`'s `<select>` from RHF's uncontrolled `register()` pattern to a controlled pattern via `Controller` (an explicit `value=` prop bound to watched state, so the DOM can never silently diverge from what React believes is selected), or disabling the field until the component has definitively mounted client-side. I leave the exact mechanism choice to Phase 3 — naming it is as far as an analyst should go.

## Inventory — every other RHF-registered native `<select>` sharing the pattern

I grepped every `<select` in `src/` bound to `register(...)` (48 files touch `<select` at all; the ones below are the RHF-registered, non-test ones) and read the two most consequential ones directly to confirm the shape. **I did not independently browser-reproduce each of these** — that would be a Phase 4/5 regression-suite job — but the code shape (a data-driven `.map()` over a live list, no placeholder/blank first `<option>`, `{...register(fieldName)}` on the `<select>` itself) is identical to `statistics-form.tsx`'s.

**Confirmed identical shape by direct read — same severity class (a real record silently misattributed to a different real record):**
- `src/app/(org)/o/[slug]/admin/credentials/record-appointment-form.tsx:142` (`personId`) and `:172` (`servingOrgId`) — a pastoral appointment recorded against the wrong minister or the wrong serving organization.
- `src/app/(org)/o/[slug]/admin/credentials/record-ordination-form.tsx:119` (`personId`).
- `src/app/(org)/o/[slug]/admin/officers/add-officer-term-form.tsx:151` (`personId`), `:213` (`orgUnitId`).
- `src/app/(org)/o/[slug]/admin/groups/add-group-member-form.tsx:108` (`personId`), `new-group-form.tsx:100` (`groupTypeId`).
- `src/app/(org)/o/[slug]/admin/members/new/household-step.tsx:84` and `.../edit-person-form.tsx:208` (`household.householdId`) — wrong household linkage.
- `src/app/(org)/o/[slug]/admin/reports/record-payment-form.tsx:84` (`recordId`) — a payment recorded against the wrong per-capita record.
- `src/app/(org)/o/[slug]/admin/staff/add-staff-position-form.tsx:238` (`personId`).

**Same code pattern, lower plausible severity (small fixed enum; a wrong-but-plausible value is more likely to be visually caught, or the field's semantics make "any option" a defensible default) — grep-only, not read in depth:**
`add-officer-term-form.tsx` (`office`), `record-ordination-form.tsx` (`ministry`), `record-appointment-form.tsx` (`callType`), `extend-series-form.tsx`/`new-event-form.tsx` (`ordinal`, `dayOfWeek`), `roll-action-step.tsx`/`record-roll-action-form.tsx` (`rollAction.kind`/`kind`), `household-step.tsx`/`edit-person-form.tsx` (`household.mode`), `add-group-member-form.tsx` (`groupRole`), `statistics-submit-form.tsx` (`attestedRole`), `oversight/[aboutOrgId]/edit-form.tsx` (`viabilityScore`).

This is a scope question, not a scope decision — Phase 2/3 must rule on whether this pipeline fixes `statistics-form.tsx` alone (matching the kickoff's stated constraint and F116's original filing) or whether the breadth found here justifies a shared, reusable fix (e.g., a `<HydrationSafeSelect>` wrapper or a documented `Controller`-based convention) applied more broadly, with the remainder tracked as follow-up work. I recommend the architect not skip Phase 2 on that basis alone, even though this is classified as a bug-fix.

## User Verbs

| Surface | Actor | Verb | Cadence |
|---|---|---|---|
| `/o/<slug>/admin/reports` — "Congregation Statistics" | Presbytery clerk (`statistics.manage`) | Selects a congregation, enters a year's SASR aggregate, clicks "Save statistics" | Annual |

(Unchanged from the presbytery-e2e pipeline's Phase 1 — this is a bug-fix against an existing, already-reviewed verb, not a new one.)

## Flows

**Flow 1 — Record annual statistics (happy path, as designed):** clerk opens `/o/<slug>/admin/reports` → selects the congregation from `#stats-congregation` → enters the year and numeric fields → clicks "Save statistics" → toast "Statistics saved.", table refreshes with the new row.
- Failure (designed, unrelated to this bug): wrong-congregation-for-this-presbytery is refused server-side with "That congregation doesn't belong to this presbytery." Year outside the affiliation window is refused client-side with a specific message. Both are correct and unaffected by F116.
- **Failure (undesigned, this finding):** on a real phone on a slow connection, a clerk who selects the congregation in the first ~1–2 seconds after the page starts rendering can have that selection silently discarded and replaced with the alphabetically-first congregation, with **no failure state at all** — the flow completes with a success toast, on the wrong record. There is no failure path here because the system does not know a failure occurred.

## Permissions & Flags

- **Permission(s):** none new — `statistics.manage` already gates this surface; unaffected.
- **Flag(s):** none new — `org_portal.reports` already gates this surface; unaffected.

## Gaps the Request Didn't Address

- **No confirmation-of-selection at submit time.** Even with the hydration bug fixed, the form has no "you are about to save statistics for **Halloway Presbyterian Church**" moment before or after submit — the only feedback is a generic "Statistics saved." toast that doesn't name the congregation. This is a second, independent layer of defense worth Phase 3 considering alongside the root-cause fix (belt-and-suspenders: even a correctly-hydrated form is one misclick away from the same wrong-record outcome, just without the silent-revert mechanism).
- **The audit event doesn't capture user intent vs. outcome.** `CONGREGATION_STATISTICS_ENTERED` records only what was ultimately submitted (the wrong congregation, in the race case), so a post-hoc audit reviewer has no signal that anything went wrong. Not proposing a fix for this pipeline — naming it so it isn't lost.
- **Fix scope is undecided** (single-file vs. the nine-plus-file inventory above) — needs an explicit Phase 2/3 ruling, not a default.
- **The regression test's production-build requirement has no home yet.** `playwright.config.ts`'s `webServer.command` is hardcoded to `npm run dev`; there is no existing mechanism to run any spec against a `next build && next start` server. Phase 3 needs to specify this (a `PW_PROD_BUILD` toggle, a second webServer config, or an out-of-band script) and Phase 4 needs CDP throttling helpers (`page.context().newCDPSession()`), which don't exist anywhere in `e2e/support/` today.
- **The Turbopack/`node_modules` build flakiness** (`@vercel/turbopack-next` module-not-found, intermittent even with the documented hardlink workaround) isn't this bug's fault, but it will bite whoever runs Phase 4/5's acceptance build next, and should be flagged to deployment-engineer/tech-lead as its own small finding rather than rediscovered from scratch.

## Out of Scope (confirm with user)

- Fixing every form in the inventory above in this pipeline — recommend Phase 2/3 scope this pipeline to `statistics-form.tsx` (the one with proven, DB-confirmed impact) and open tracked follow-ups for the rest, per the existing `docs/TODO.md` F116 framing's spirit.
- A submit-time confirmation UI (named above as a gap, not assumed in scope).
- Any redesign of the reports page (per the kickoff's own stated exclusion).

## Open Questions

- Does tech-lead want a single shared primitive (e.g., a `Controller`-based hydration-safe select component) now, given the inventory, or a narrow fix to `statistics-form.tsx` with the rest tracked as follow-up TODO lines?
- Should the TODO line for this environment's Turbopack build flakiness be opened now (a candidate for deployment-engineer) or folded into this pipeline's own acceptance-build notes?

## Phase 2 note

Not skipped by me — that's the architect's call — but I recommend against a silent skip given the multi-file breadth this review surfaced; a "fix everywhere" vs. "fix one, track the rest" decision is structural enough to warrant an explicit ruling.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — reproduced on a genuine production build under realistic throttling (10/10), confirmed the wrong congregation's data is actually persisted (DB-verified, then cleaned up), named the RHF/uncontrolled-`<select>` hydration mechanism, and inventoried 9+ other forms sharing the same shape | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |



### Orchestrator note (2026-09-28)

F116 is confirmed real on a production build (10/10 reversions under CPU ×4 + slow-3G; the wrong congregation's statistics were persisted with a success toast and an internally consistent audit row). This is a **PSV go-live blocker** for the statistics form. Phase 2 runs (not skipped): the architect must rule the fix scope — `statistics-form.tsx` alone vs a shared `Controller`-based hydration-safe select applied to the nine-plus inventoried forms — and where a production-build Playwright regression lives. Reclassify to Feature if the shared primitive is chosen. Not dispatched yet: the operator paused the session.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-10-05. Read-only review in worktree `/Users/cshenso/git/presby-platform/presby-wt-select` on `pipeline/select-hydration`; no files written by the architect.*

## Verdict

**Approved with suggestions.** Bug-fix variant ends here: **reclassify to Feature.** The suggestions below are binding conditions for Phase 3.

The rulings, in short:
- The fix is a shared, form-level **"inoperable until hydrated"** primitive. It is not a `Controller` conversion.
- It goes on **all 18 react-hook-form (RHF) form roots** in this pipeline, not only `statistics-form.tsx`.
- A production-build Playwright lane is added. It is switched on by an environment variable in the existing `playwright.config.ts`, and it makes the pre-hydration interaction deterministic by holding back the JavaScript chunks. It does not rely on throttling.

### Ruling 1: mechanism

Each candidate was checked against the code that actually runs: React 19.2.6 as compiled into Next (`node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js`) and `react-hook-form` 7.86.0.

- **A `Controller`-controlled `<select>`: rejected. It does not close the window and makes the failure invisible (F121).**
  - When React hydrates a `<select>` (`prepareToHydrateHostInstance`, the `case "select":` branch), it only validates. It never calls `updateOptions` and never queues a change event.
  - Pre-hydration change events are replayed only if React's root listeners already exist. On slow-3G the selection happens before any JavaScript has run, so there is nothing to replay.
  - Result: the DOM keeps the clerk's choice ("Thistledown") while `field.value` stays at the default ("Halloway"). The screen shows the right congregation and Submit sends the wrong one.
  - The next commit of that select (the update path calls `updateOptions` whenever `value != null`) snaps the DOM back, at an arbitrary later moment.
  - So today's visible revert would become either no revert at all with a wrong save, or a revert that comes later and unpredictably.
- **`key`-remount: rejected.** Remounting after hydration resets to `defaultValues` on purpose. That is the same revert, done deliberately.
- **`shouldUnregister`: rejected.** It controls whether values survive unmount. It has no effect on reconciliation at mount.
- **`defaultValue` on the element instead of `defaultValues`: rejected.** It would adopt the DOM value only through an RHF internal (the `isUndefined(defaultValue)` branch of `updateValidAndValue`, `index.esm.mjs:2311-2316`). It needs a type workaround on every schema, and it protects selects only (see F122).
- **Disable until hydrated: chosen.** It closes the window by construction, whatever React or RHF do internally.
  - A wrapper component renders `<fieldset disabled={!hydrated} aria-busy={!hydrated}>` around the form's controls and Submit.
  - `hydrated` comes from `useSyncExternalStore(noopSubscribe, () => true, () => false)`.
  - During the server render and the hydration render it is `false`. RHF's ref callbacks run in the hydration commit, while every control is still disabled, so RHF's write-back has no user value to overwrite.
  - The next render enables the controls. On a client-side navigation `useSyncExternalStore` returns `true` straight away, so there is no disabled flash.
  - `useEffect(() => setHydrated(true))` is **not** acceptable: it would flash disabled for a frame on every client-side navigation.

**Accessibility and UX cost.**
- On a slow phone the whole form looks disabled for about 1–3 s and cannot be tabbed into until it enables. On an unthrottled production build this is imperceptible.
- A visible disabled control is honest. A silent revert onto a different real congregation is not. The cost is accepted.
- Conditions:
  - Dim the **controls only**. Never put opacity on the fieldset: it would dim the labels and hint text below the 7:1 body-text floor in `ui-standards.md`.
  - The `Input` and `Button` primitives already style `:disabled`, and a disabled ancestor fieldset makes them match it.
  - Native selects get `disabled:cursor-not-allowed disabled:opacity-50` appended to their `SELECT_CLASSES`, matching `Input`.
  - No spinner and no new copy.

### Ruling 2: scope

- **Form-level, all 18 RHF roots, now.** The defect belongs to RHF's mount reconciliation of every `register()`'d field, not to `<select>` (F122). The fix costs a two-line wrap per form plus the class addition on its selects, and the set is closed and enumerable.
- The 18 roots: `statistics-form`, `record-payment-form`, `per-capita-rate-form`, `record-appointment-form`, `record-ordination-form`, `add-officer-term-form`, `add-group-member-form`, `new-group-form`, `edit-group-form`, `new-event-form`, `edit-event-form`, `extend-series-form`, `edit-person-form`, `record-roll-action-form`, `member-wizard` (the gate goes here and covers `household-step` and `roll-action-step`), `oversight/[aboutOrgId]/edit-form`, `add-staff-position-form`, and `(statistics-submit)/file-statistics/statistics-submit-form`.
  - `statistics-submit-form` is the public, token-based filing flow and the surface most likely to be used on a phone.
- Deliberately not "fix one, track the rest". Those other forms write pastoral appointments, ordinations, officer terms, household links and per-capita payments onto the roll. They are reachable by the same race, and leaving them open would mean knowingly shipping PSV with them.
- Out of scope, tracked instead: native selects outside RHF (F124) and the `SELECT_CLASSES` consolidation (F125).

### Ruling 3: where the regression test lives

- **Spec home:** a new `e2e/hydration/` directory. Helpers stay in `e2e/support/`; there is no `e2e/helpers/` and none should be created.
- **The spec does not depend on build mode.** It runs in the default `chromium` project, so every `npm run test:e2e` run includes it. A second lane re-runs it against a production build.
- **Production lane:**
  - Switched on by `PW_PROD_BUILD=1` in the existing `playwright.config.ts`. This copies the `PW_VISUAL` precedent of an environment variable rather than argv, which works because workers inherit environment variables (the brand-foundation a2 lesson).
  - When set, `webServer` becomes `npm run build && npm run start -- --port <P>`, with `reuseExistingServer: false` always, a port other than 3000 (Phase 3 picks one; avoid 3100, which the visual-parity docs already use), a build-sized timeout, and `RATE_LIMIT_DISABLED: "true"`.
  - `projects` becomes a single `prod-build` project with `testMatch: /hydration\/.*\.spec\.ts$/`.
  - New script: `test:e2e:prod`.
  - A dev server must never be able to satisfy this lane. Phase 3 names the guard; never reusing the server on a dedicated port is the minimum.
  - Next 16 keeps dev output in `.next/dev` (present in this worktree), so the lane can run alongside a dev server in the same checkout. Phase 3 should confirm.
- **CI:** a step in the **existing** `e2e` job, after "Run e2e suite", gated on `if: ${{ !cancelled() }}`, on the same Neon branch. The specs create their own fixture rows, so a second provisioned branch buys nothing. Phase 3 confirms the 30-minute job timeout still fits the extra build.
- **Determinism:**
  - Hold every `/_next/static/**.js` script request behind a manual promise with `page.route`, then navigate with `waitUntil: "domcontentloaded"`. Next's scripts are `async` and do not block DOMContentLoaded.
  - Do not hold CSS: Turbopack serves CSS from `chunks/`, and a held render-blocking stylesheet breaks Playwright's visibility checks.
  - Before release, assert `#stats-congregation` and Submit are disabled. **Without the fix this assertion fails**, because the select is operable.
  - Release the scripts, then `await expect(select).toBeEnabled()`. Enablement is the hydration signal.
  - Select a non-default congregation, fill a field, submit, wait for the toast.
  - Then assert the **persisted** `about_org_id` with `platformSql`. A DOM check is not enough because F121's failure mode looks correct on screen.
  - Create the spec's own year/fixture data and clean up with the existing freeze-trigger pattern from `presbytery-reports.spec.ts`.
  - **Not allowed** as synchronization: throttling, `waitForTimeout`, or `networkidle`.
- **Throttling:** no CDP throttle helper is needed in the repo. QA's realism check (rerunning Phase 1's 10-trial CPU×4 + slow-3G scenario against the fixed production build, expecting 0/10 reversions and noting how long the form stays disabled) can live in the scratchpad, as Phase 1's did. If Phase 3 wants an opt-in, non-asserting realism spec, its helper goes in `e2e/support/cdp-throttle.ts`.
- **Existing spec:** `presbytery-reports.spec.ts` (`:114` and its siblings) replaces `waitForLoadState("networkidle")` with `expect(select).toBeEnabled()`. The mask comes off and the spec gets a real hydration signal.

## Placement

- **Directory placement:**
  - `src/components/shared/hydration-gate.tsx` exports `HydrationGate`. A hook `src/components/shared/use-hydrated.ts` follows the `use-unsaved-changes-guard.ts` precedent. Unit tests sit next to them.
  - Not `src/components/ui/`: these are not generated shadcn primitives.
  - No `src/lib` change, which honours the kickoff constraint.
  - Edits to the 18 form roots stay inside their route folders.
  - e2e: `e2e/hydration/*.spec.ts`, plus the `playwright.config.ts` switch, a `package.json` script and an `e2e.yml` step.
  - New check script `scripts/check-hydration-gate.mjs`, wired into `npm run check`. It fails when a non-test file calling `useForm(` has no `HydrationGate`. Without it, the 19th form regresses silently.
- **Server vs Client split:** the hook and the gate are `'use client'`. All 18 form roots are already client components. No server component, server action or route handler changes.
- **Dependencies:** **no new npm dependency.** `useSyncExternalStore` is React core, `react-hook-form` and `@playwright/test` are already present, and route interception is native to Playwright. No evaluation against the five criteria is needed.

## Invariants Touched

- **Verify in a Browser:** strengthened. This is a phone-only, network-dependent defect that `tsc`, unit tests and `next build` cannot see. The production lane plus QA's throttled realism check are how it is verified. Phase 5 must also check the disabled state at 360px.
- **The Brand Is a Cascade Override:** respected. The gate adds no colour and no token. Disabled styling comes from each primitive's existing `disabled:` variants plus Tailwind opacity and cursor utilities on native selects. `(org)` forms inherit the brand through the cascade, and `statistics-submit-form` stays in the platform palette. `check:brand-scope` is unaffected.
- **Permissions vs Flags:** not touched. There is no new `FEATURES.*` key and no flag, and `statistics.manage` and `org_portal.reports` are unchanged.
- **The Roll Is the System of Record and No Real Data:** the fix removes a route by which a wrong-but-valid reference gets written onto the roll (appointments, ordinations, officer terms, household links). Fixtures use only `e2e/support` synthetic rows.

## Notes

**Findings (F121 onward):**
- **F121.** A `Controller`-controlled native `<select>` does **not** close the pre-hydration window on React 19.2.
  - Hydrating a select only validates (`prepareToHydrateHostInstance`, `case "select":`); there is no `updateOptions` and no queued change event.
  - A selection made before React's listeners exist is never replayed, so the DOM and RHF state disagree. The screen shows the user's choice, Submit sends the default, and the next commit of that select reverts the DOM.
  - The same reasoning applies to any `value=`-controlled select.
- **F122.** The defect belongs to RHF's mount reconciliation of every registered field, not to selects.
  - `updateValidAndValue` calls `setFieldValue(name, defaultValues[name])` over the live DOM (`react-hook-form/dist/index.esm.mjs:2305-2317`).
  - Text and number inputs typed before hydration are visibly reset. On edit forms they go back to the stored value, so the user's edit is lost. On `statistics-form`'s optional number fields they go to `""` and are submitted as `undefined`.
  - Only a select falls back to a different valid value with no visible sign, which is why it is the worst case. This is why the gate is form-level.
- **F123.** A Submit before hydration does a native GET to the current URL. None of these forms sets `method` or `action`, and `register()` gives every field a `name`.
  - Every field value therefore ends up in the query string, browser history and server access logs. On `edit-person-form` that means names, emails and addresses.
  - The gate closes this for all 18 roots because Submit is disabled too.
- **F124.** Native `<select>`s outside RHF that are controlled by `useState` carry the same F121 divergence.
  - Text inputs heal themselves on the next keystroke; a select the user doesn't touch again does not.
  - It is harmless on filter or navigation selects and real on any that write data. Tracked for a triage audit, not fixed here.
- **F125.** `SELECT_CLASSES` is a hand-rolled control class string duplicated in 23 files and has no `disabled:` variants.
  - This conflicts with Component Rule 5 and C2.
  - Track a single native-select primitive, through `npm run ui:add -- native-select` if the registry offers one and it passes the wrapper's checks, otherwise in `src/components/shared/`. Only the `disabled:` addition happens in this pipeline.

**Phase 3 must also honour:**
- **Verify the gate against RHF's disabled handling.** RHF's `getFieldValue` returns `undefined` for a disabled DOM element. Prove with a vitest test that hydrates (`renderToString`, then `hydrateRoot`, in jsdom) that, once enabled, `handleSubmit` receives every value, and that the post-success `form.reset(...)` paths still work. The e2e test's persisted-row assertion covers this end to end for `statistics-form` only.
- **Fieldset styling:** reset the default fieldset styles (border, padding, `min-width`) so nothing shifts in layout. The gate fieldset must have no `<legend>`, because controls inside the first legend of a disabled fieldset are not disabled. `statistics-form`'s inner fieldsets inherit `disabled`, which is correct.
- **Existing unit tests:** client-side RTL renders take the client snapshot (`true`), so they should be unaffected. Phase 3 confirms.
- **QA's negative control:** QA runs the new spec on the parent commit, where it must fail at the pre-release disabled assertion, and on the fix, where it must pass.
- **Local production build:** the Turbopack `turbopack.root` / sibling-worktree font-module flake Phase 1 hit will hit Phase 4 and Phase 5 as well. Phase 3 must state the local rehearsal path (the hardlinked scratch copy documented in `2026-09-26-flags-fail-closed.md`). CI checkouts have no sibling worktrees.
- **CI is not the gate yet:** `e2e.yml` has never run because `NEON_API_KEY` is absent. The CI step is paper until it is added, so **the local production-lane run is the real Phase 5 gate.**
- **Analyst gaps, ruled out of scope:** a submit-time confirmation naming the congregation, and the audit row not recording intent versus outcome. They are tracked below; neither is in this pipeline.
- **Docs the implementer edits on this branch:**
  - `docs/ui-standards.md`: add the HydrationGate rule to Forms — State Patterns, and add the controlled-select hazard to "Native `<select>`".
  - `docs/testing.md`: how to run the production lane.
- `CLAUDE.md` is off-limits on this branch; the proposed line is below.

### Proposed DECISION-159 (orchestrator applies to `docs/decisions.md` at integration)

**DECISION-159: A react-hook-form form is inoperable until it hydrates, and pre-hydration behaviour is regression-tested in a production-build e2e lane that holds back the JavaScript chunks instead of racing a throttle.** (2026-10-05, architect Phase 2, `docs/work-log/2026-09-28-select-hydration-revert.md`.)

**What happens without this.** RHF's `register()` writes `defaultValues` over the live DOM when it attaches during hydration. So anything a user types or picks before hydration is overwritten. For a native `<select>`, that means silently falling back to a different valid record (F116: a congregation's annual statistics were saved against the wrong congregation, with a success toast).

**Rejected alternatives.**
- A controlled `<select>` (`Controller`) does not close the window. React 19.2 hydration keeps the user's DOM selection, does not fire a change event, and leaves the DOM out of step with state until a later commit reverts it (F121).
- `key`-remount reverts on purpose.
- `shouldUnregister` has no bearing on mount.
- An element-level `defaultValue` depends on an RHF internal and protects selects only (F122).

**The rule.** Every client form root that calls `useForm` wraps its controls and Submit in `<HydrationGate>` (`src/components/shared/`), which renders `<fieldset disabled aria-busy>` until `useSyncExternalStore` reports the client snapshot. That happens on the render after hydration, and immediately on a client-side navigation.

**What it costs.** On a slow connection the form is visibly disabled for a moment. That is accepted: a visible disabled control is honest, and a silent revert is not. Dimming applies to controls, never to labels.

**How it is enforced.** `npm run check` runs `check-hydration-gate.mjs`.

**The test lane.** Pre-hydration specs live in `e2e/hydration/`. They hold every `/_next/static/**.js` request with `page.route` until the test has asserted the pre-hydration state, then release it and use control enablement as the hydration signal. Throttling, timeouts and `networkidle` are never used as synchronization. The specs run in the default dev-server lane and again in a `PW_PROD_BUILD=1` lane (`next build && next start`, dedicated port, never a reused server), which CI runs as a step in the existing `e2e` job.

### Proposed `docs/TODO.md` lines (orchestrator applies at integration)

- Replace the F116 line at merge with: `- [x] **F116** — fixed by DECISION-159 (HydrationGate on all 18 RHF form roots + production-build hydration lane). — docs/work-log/2026-09-28-select-hydration-revert.md`
- `- [ ] **F124 — triage native <select>s outside react-hook-form that are controlled by useState** for the F121 DOM/state divergence (filters and navigation are harmless; any that write data get HydrationGate or are moved to RHF). — docs/work-log/2026-09-28-select-hydration-revert.md Phase 2`
- `- [ ] **F125 — consolidate the 23 duplicated SELECT_CLASSES strings into one native-select primitive** (npm run ui:add -- native-select if the registry offers it and it passes the wrapper, else src/components/shared/); Component Rule 5 / C2. — same work-log, Phase 2`
- `- [ ] **Turbopack build flake in a worktree** — next build intermittently fails with "Can't resolve '@vercel/turbopack-next/internal/font/google/font'" when turbopack.root spans sibling worktrees, even with the hardlink workaround; candidate for deployment-engineer. — same work-log, Phase 1`
- `- [ ] **Statistics save toast names the congregation** ("Statistics saved for <name>, <year>.") — a second line of defence against a wrong-record save (Phase 1 gap); polish candidate. — same work-log, Phase 1`
- Proposed `CLAUDE.md` addition under **Verify in a Browser**: "A form must not be operable before it hydrates — `HydrationGate` on every `useForm` root (DECISION-159); pre-hydration behaviour is tested by holding the JS chunks, never by racing a throttle."

### Handoff to tech-lead (Phase 3, full design: reclassified to Feature)

Phase 3 must design exactly the following:
1. **The primitive:** `use-hydrated.ts` (`useSyncExternalStore` with a no-op subscribe and snapshots `true` on the client, `false` on the server) and `hydration-gate.tsx`. The props it takes; `aria-busy`. The fieldset style reset, with no legend. Its unit tests: server render is disabled, hydration then enables, client render is enabled immediately, and an RHF form hydrated in jsdom submits complete values.
2. **Applying it to all 18 roots** (the list in Ruling 2), with `member-wizard` as the root for its steps. Append `disabled:cursor-not-allowed disabled:opacity-50` to each touched `SELECT_CLASSES`. Confirm the existing unit tests are unaffected.
3. **`scripts/check-hydration-gate.mjs`** and how it is wired into `npm run check`.
4. **The Playwright change:** the `PW_PROD_BUILD` branch of `playwright.config.ts` (port, build timeout, `reuseExistingServer: false`, the production-server guard, `testMatch`); `chromium` keeps running `e2e/hydration/`; the `test:e2e:prod` script; and how globalSetup and storageState behave against the production port.
5. **The spec:** `e2e/hydration/` statistics spec built as in Ruling 3. That covers holding the script chunks, the pre-release disabled assertion, release, waiting for enablement, then select, submit and the persisted-row assertion. It creates and cleans up its own fixture rows. It must be shown to fail on the parent commit.
6. **Removing the mask:** `networkidle` changed to `toBeEnabled()` in `presbytery-reports.spec.ts`.
7. **The `e2e.yml` step** (`if: ${{ !cancelled() }}`, timeout budget) and the **local production-build rehearsal path** that works around the Turbopack worktree flake.
8. **Doc edits** to `docs/ui-standards.md` and `docs/testing.md`.
9. **Choosing the implementer:** ux-developer, or full-stack-developer if the CI/config work should sit with the same hands.

## Per-Phase Status row

| 2 — Architectural review | architect | Complete — the fix is a form-level "inoperable until hydrated" `HydrationGate` (`useSyncExternalStore`) on all 18 RHF form roots; a Controller conversion is rejected (F121: React 19.2 hydration leaves the select's DOM and state out of step); the regression goes in `e2e/hydration/`, made deterministic by holding the JS chunks with `page.route`, and runs in the default lane and in a new `PW_PROD_BUILD=1` production-build lane (a step in the existing `e2e` job); no new dependency; findings F121–F125; proposes DECISION-159; **reclassified to Feature** | Approved with suggestions | 2026-10-05 |

### Orchestrator note (2026-10-05)

Phase 2 accepted as binding. The pipeline is **reclassified from Bug-fix to Feature** (shared primitive + a new e2e lane + a new tripwire). DECISION-159 and F121–F125 are adopted as drafted and applied at integration. Phase 3 (tech-lead) next, designing items 1–9 of the handoff. Shared-file discipline from the kickoff still applies: `package.json` scripts, `playwright.config.ts`, `.github/workflows/e2e.yml` and `scripts/check*` are this pipeline's to edit (no other open pipeline touches them); `CLAUDE.md`, `docs/TODO.md`, `docs/decisions.md` remain orchestrator-only.

---

# Phase 3 — Technical Design (tech-lead)

*Authored 2026-10-05 in worktree `/Users/cshenso/git/presby-platform/presby-wt-select` (branch `pipeline/select-hydration`, HEAD `b91bc95`). Only this work-log was edited. Everything below was checked against the live tree; the two behaviours the design leans on hardest (React 19.2 hydration of `useSyncExternalStore`, and RHF's handling of a disabled DOM control) were also run, in a throwaway vitest project in the session scratchpad with `node_modules` linked to this worktree. Nothing was written to the repo, no dev server was started, and the one production server started (port 3811, scratch copy, killed by PID) was only to read its HTML.*

## Summary

Make every react-hook-form (RHF) form in the app **inoperable until it has hydrated**, and prove it with a regression that cannot be raced. A new shared pair, `src/components/shared/use-hydrated.ts` (`useSyncExternalStore` with a no-op subscribe: `false` on the server and during the hydration render, `true` on the next render and immediately on any client-only render) and `src/components/shared/hydration-gate.tsx` (`<fieldset disabled aria-busy>` with the browser's default fieldset chrome reset, no `<legend>`), wraps **all 18 RHF form roots** from the outside. Their controls and Submit are `:disabled` in the server HTML from first paint, so a pick or keystroke made before the JavaScript has run is impossible, and RHF's mount-time `defaultValues` write-back (F116, F122) has nothing to overwrite; the native GET submit (F123) is blocked too. The 16 native-`<select>` class strings in the touched files gain `disabled:cursor-not-allowed disabled:opacity-50`. A tripwire (`scripts/check-hydration-gate.mjs`, wired into `npm run check`) stops the 19th form regressing. The regression test lives in `e2e/hydration/`, holds every `/_next/static/**.js` request behind a manual promise so the pre-hydration state is deterministic rather than a throttle race, asserts the **persisted** `about_org_id`, runs in the default `chromium` project and again in a new `PW_PROD_BUILD=1` lane (`next build && next start` on port 3800, never a reused server), and the lane gets one step in the existing `e2e` job. No schema, no route, no permission, no flag, no new dependency, no `src/lib` change. The implementer is **full-stack-developer**, in four ordered slices.

## Feasibility check — what I verified against the live tree

| Claim / question | Result |
|---|---|
| The 18 RHF roots exist; any missed? | **Exactly 18**, no more, no fewer. `grep -rl "useForm(" src` returns only 2 files because 16 of them call `useForm<Values>(`; the right pattern is `\buseForm\s*[<(]`. That gives 18 files (19 call sites: `add-staff-position-form.tsx` has two `useForm` instances on one `<form>`; `member-wizard.tsx` has one, shared with its steps). The other 7 files that import `react-hook-form` (`household-step`, `roll-action-step`, `identity-step`, `search-step`, `review-step`, `contact-address-step`, `wizard-field`) import **types only**. Every one of the 18 is rendered straight from a server-component `page.tsx`; none sits inside a dialog or mounts after a client fetch. |
| `useSyncExternalStore` + no-op subscribe in React 19.2.6 | Read `react-dom-client.production.js` (`mountSyncExternalStore`, ~L5848): while `isHydrating` it returns `getServerSnapshot()`; it then pushes a passive effect (`updateStoreInstance`) that, seeing the client snapshot differs, calls `forceStoreRerender` (SyncLane). On a non-hydrating mount it returns `getSnapshot()` directly. **Run, not just read:** a probe component renders `[false, true]` on `hydrateRoot` over `renderToString` output (text `"false"` → `"true"`, zero `console.error`), and `[true]` on a plain `render()`. The SSR HTML of a gated RHF form has all 7 test controls (select, text, number, checkbox, 2 radios, submit) matching `:disabled` in jsdom; after `hydrateRoot` + `act` the fieldset has no `disabled` and no `aria-busy`. |
| Does the ungated bug reproduce in jsdom? | **Yes.** SSR form, `select.value = "b"` before `hydrateRoot`, ends at `"a"`; a text input edited early (`"typed early"`) ends at its default (`"stored"`). That is F116 and F122 as a unit test, and it is the unit-lane negative control (see test 6 below). |
| RHF 7.86.0 and a disabled DOM control — **Phase 2's premise is wrong in detail** | `getFieldValue(_f)` (`react-hook-form/dist/index.esm.mjs:1916`) reads `ref.value` and **never looks at `ref.disabled`**. Only `getCheckboxValue` (:760) and `getRadioValue` (:786) skip *disabled options*. RHF's own "disabled field" semantics key off `_names.disabled`, filled only by `register(name, { disabled })` / `useForm({ disabled })`; `handleSubmit` deletes exactly those names from the values (:3191); `setFieldValue` honours `_f.disabled`, a flag a fieldset-disabled DOM element never sets. And `handleSubmit` builds its values from `_formValues`, not the DOM. So: values submit correctly once enabled, and the gate cannot make RHF drop a field. The one real residual hazard is a **checkbox/radio read while disabled at hydration**: `updateValidAndValue` (:2305) takes the `getFieldValue` branch (→ `false` / `null` for a disabled option) only when the field's default is `undefined` or the element has `defaultChecked`; with a defined default it takes `setFieldValue(name, default)`. I checked every checkbox and radio across the 18 roots: `isPublic`/`allowsCheckin`/`patternType` (new-event, edit-event, extend-series), `household.mode` (edit-person, and the wizard via `WIZARD_DEFAULT_VALUES.household.mode = "none"`) all have defined defaults and none uses `defaultChecked`. The unit test (below) proves it. Invariant recorded in the DECISION-159 amendment. |
| Playwright treats a fieldset-disabled control as disabled | `playwright-core` (1.60.0) `belongsToDisabledFieldSet`: `element.closest("FIELDSET[DISABLED]")`, **exempting only controls inside that fieldset's first `<legend>`** — which is exactly why the gate must have no legend. So `toBeDisabled()` / `toBeEnabled()` and every action's auto-wait-for-enabled see the gate. |
| Tailwind `disabled:` on controls under a disabled fieldset | The `disabled:` variant is `:disabled`, which matches form controls that inherit disabledness from an ancestor fieldset. `Input` (`disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`), `Textarea` and `Button` (`disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground`) already style it; native selects and raw checkbox/radio inputs do not (selects are the F125 gap). Labels and hint text are not form controls and are never dimmed. |
| `next start --port`, and dev/prod coexistence | `next start -p, --port <port>` (also `PORT`). `npm run start -- --port 3800` works. `next build` cleans `.next` with `recursiveDeleteSyncWithAsyncRetries(distDir, /^(cache|dev|lock|trace)/)` (`next/dist/build/index.js:624`), so **it preserves `.next/dev`**; the dev server (`.next/dev`) and the production lane (`.next`) coexist in one checkout. One side effect: `next build` rewrites the gitignored `next-env.d.ts` to import `./.next/types/…` and a later `next dev` rewrites it back — harmless, gitignored, noted so nobody chases the diff. |
| Production HTML fingerprint | A real production server's `/signin` HTML has 0 matches for `hmr-client` / `[turbopack]`, and its `<script src="/_next/static/chunks/<hash>.js" async="">` tags are `async` (so they do not block `DOMContentLoaded`, the premise of the hold-the-chunks technique). Dev chunk filenames include `[turbopack]_browser_dev_hmr-client_hmr-client_ts_*.js` (listed in `.next/dev/static/chunks/`), which is the guard's positive signal for "this is a dev server". |
| `.env.local`, `AUTH_URL`, cookies | `.env.local` has no `AUTH_URL` locally, but **CI's `.env.local` writes `AUTH_URL=http://localhost:3000`** (`e2e.yml`); Auth.js rewrites request origins to `AUTH_URL`, so the prod lane's server must be started with `AUTH_URL` = its own origin (done via `webServer.env`, which wins over `.env.local`). Session cookies are host-scoped, not port-scoped, and sessions are JWTs signed by the same `AUTH_SECRET`, so `e2e/support/.auth/*.json` acquired on :3000 is valid on :3800. `src/lib/rate-limit.ts` honours `RATE_LIMIT_DISABLED` regardless of `NODE_ENV`. |
| The local production-build rehearsal | **Re-ran the documented workaround and improved it.** rsync of the worktree (excluding `.git`, `.next`, `node_modules`, `.env.local`) to a scratch dir **outside `~/git/presby-platform/`** plus `cp -al node_modules` (hardlink, 17 s, 829 MB, no extra disk) → `npm run build` with CI's placeholder env: exit 0 in **16 s** wall, zero occurrences of "error", no font-module flake. The precedent (`2026-09-26-flags-fail-closed.md`) put the copy as a *sibling inside* `~/git/presby-platform/`, which is where the intermittent `@vercel/turbopack-next/internal/font/google/font` failure Phase 1 hit lives (the committed `turbopack.root` = the parent directory, so a sibling copy shares a root with every other worktree). Putting the copy under its own private parent avoids it. Same APFS volume as the home directory, so hardlinks work. Recipe in §7. |

## Discrepancies with Phase 2 (all small; none changes a ruling)

1. **RHF disabled handling** — see the table. Phase 2 said `getFieldValue` returns `undefined` for a disabled DOM element; at 7.86.0 it does not. The conclusion (values submit once enabled) is stronger than Phase 2 assumed, and the real hazard (checkbox/radio read while disabled) is narrower and is closed by the defined-defaults invariant plus a test.
2. **`grep "useForm("` undercounts** (2 hits). The count is still 18; the tripwire must use `\buseForm\s*[<(]`.
3. **The `networkidle` mask is in three specs, not one.** `presbytery-oversight.spec.ts` (7 lines) and `presbytery-credentials.spec.ts` (7 lines) mask hydration on the same forms exactly as `presbytery-reports.spec.ts` does (10 lines). §6 extends the unmasking to the interaction cases of all three; the orchestrator may strike the two extra specs without affecting the design.
4. **Gate placement.** Phase 2 said "around the form's controls and Submit"; I wrap the **`<form>` element from the outside** (and the root `<div>` of `member-wizard`, which has no `<form>` tag). Same coverage (a fieldset disables every descendant control, with or without form ownership), but the form's own `space-y-*`/`max-w-*` classes and the 13 tests that query inside the form are untouched. Two extra wins: no `space-y` sibling-selector breakage from inserting a wrapper child, and a Cancel/Back button inside the form is gated too (a flash on a slow phone, acceptable).
5. **CI traces collision (not in Phase 2).** A second `playwright test` invocation in the same job would wipe `test-results/` at start (Playwright cleans `outputDir`), destroying the first lane's traces exactly when the first lane failed. The prod step sets `PW_OUTPUT_DIR=test-results-prod` (the config already honours it) and the upload step lists both directories.
6. **Job budget.** The 30-minute `timeout-minutes` is raised to 40 and the new step gets its own 15 (§7). The job has never run (`NEON_API_KEY` absent), so this is a reasoned budget, not a measured one.

## Permissions & Flags

- Permission key(s): none. `statistics.manage`, `per_capita.manage`, `credentials.manage`, `congregation_oversight.manage`, `roles`/`officers`/`groups`/`events`/`staff` keys, and the public token flow are unchanged. No `FEATURES` key, no `FEATURE_CATALOG` entry, no seed binding.
- Feature flag(s): not needed. (`org_portal.reports` is only *read and toggled by the new spec as fixture setup*, via `captureFlags`/`setFlag`, exactly as `presbytery-reports.spec.ts` does.)

## API Contract

None. No route handler, no server action, no signature changes. Both new modules are `"use client"`; all 18 roots are already client components. No server component changes.

## Data Model

No schema changes required. No migration, no `drizzle/meta/_journal.json` entry, no `scripts/test-rls.sql` / `seed-dev.sql` / `src/lib/db/domain/index.ts` edit. The spec's fixture rows are `congregation_statistics` rows for `e2e-presbytery` in report year **2096** (inside DECISION-157's reserved 2090–2099 band; `presbytery-reports.spec.ts` owns 2095), created and removed by the spec through the owner connection.

## Component / Page Plan

### 1. The primitive (design item 1)

**`src/components/shared/use-hydrated.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false on the server and during the hydration render; true on the render
 * after hydration, and from the very first render of any client-only mount
 * (a client-side navigation, a dialog opening). DECISION-159.
 *
 * Deliberately NOT `useEffect(() => setHydrated(true), [])`: that renders
 * `false` first on EVERY mount, so a client-side navigation to a gated form
 * would flash disabled for a frame.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
```
`subscribe` is module-level so its identity is stable (a changing `subscribe` would re-subscribe each render).

**`src/components/shared/hydration-gate.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

export function HydrationGate({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const hydrated = useHydrated();
  return (
    <fieldset
      disabled={!hydrated}
      aria-busy={hydrated ? undefined : true}
      data-slot="hydration-gate"
      className={cn("m-0 min-w-0 border-0 p-0", className)}
    >
      {children}
    </fieldset>
  );
}
```
- **Props: exactly `children` and `className`.** No `disabled` override (a caller must never be able to un-gate), no `...rest`. `className` exists for the rare parent that needs the wrapper to carry a layout class; none of the 18 roots needs it today because the gate sits *outside* the form.
- **Reset classes:** `m-0 min-w-0 border-0 p-0`. Tailwind's preflight already zeroes margin/padding/border on `fieldset`, but not `min-inline-size: min-content` — `min-w-0` is the one that matters (without it a wide child can stop the fieldset shrinking at 360px). The other three are explicit so the gate survives a preflight change. **No `<legend>`, ever** (Playwright and browsers exempt controls inside a disabled fieldset's first legend). **No opacity on the fieldset** (it would dim labels and hint text below the 7:1 floor); dimming is the controls' own `disabled:` styles.
- **`aria-busy`** is `true` only while not hydrated and the attribute is absent afterwards (`aria-busy="false"` would be noise in the DOM). The unnamed `group` role of a legend-less fieldset is skipped by assistive tech; accepted. (`role="none"` is pointless: `aria-busy` is a global ARIA attribute, which defeats presentational role.)
- `data-slot="hydration-gate"` is the project's primitive-marker convention; QA and specs can use `fieldset[data-slot="hydration-gate"][aria-busy="true"]`.

**Unit tests** (jsdom pragma `// @vitest-environment jsdom`, precedent `formatted-date.test.tsx`). Two files next to the code.

*Hazard found while prototyping:* jsdom resolves `container.querySelector("#id")` through the document, so two containers holding the same id in one test file make the second lookup return `null`. Tests that SSR the same form twice must `document.body.innerHTML = ""` (and RTL `cleanup()`) in `afterEach`. Use `act` from `@testing-library/react` (sets `IS_REACT_ACT_ENVIRONMENT`).

`use-hydrated.test.tsx`
1. `renderToString` of a probe → `"false"`.
2. Client `render()` of a probe → the first render value is `true` (record every render into an array; assert `[true]`).
3. SSR HTML into a container, then `hydrateRoot` inside `act` → renders `[false, true]`, text ends `"true"`, and `console.error` was not called (no hydration mismatch).

`hydration-gate.test.tsx`
1. SSR markup: contains `<fieldset disabled=""` and `aria-busy="true"`, contains no `<legend`, carries `m-0 min-w-0 border-0 p-0`; a passed `className` is merged.
2. After `hydrateRoot` + `act`: the fieldset is not `disabled`, has no `aria-busy`, children rendered once, no `console.error`.
3. Client `render()` (no SSR): enabled immediately — `getByRole("button")` is enabled on the first synchronous assertion, no `act` flush needed.
4. **RHF integration** (a small harness form: `select`, `text`, `number`, `checkbox`, two `radio` on one name, a submit button; `useForm({ defaultValues: { cong: "a", note: "stored", n: "", pub: true, kind: "x" } })`):
   a. SSR HTML into a container: all 7 controls `matches(":disabled")`.
   b. `hydrateRoot` in `act`, then `requestSubmit()` with **no edits** → `handleSubmit`'s `onValid` receives exactly `{ cong: "a", note: "stored", n: "", pub: true, kind: "x" }`. This is the assertion that proves hydrating *while disabled* did not corrupt the checkbox/radio defaults (the one real RHF hazard above).
   c. `fireEvent.change` the select to `"b"`, `fireEvent.input` the text, `fireEvent.click` the second radio, then submit → `onValid` receives the edited values (every field, including the unedited checkbox and number).
   d. Post-success path: call the form's `reset({ ... new values ... })` (captured through a ref, as the real forms do after a successful action) → the DOM shows the new select/text/radio/checkbox values, and a second `requestSubmit()` sends them.
5. **Characterisation twin (the unit-lane negative control):** the *same* harness **without** the gate; SSR it, set `select.value = "b"` and the text input to `"typed early"` before `hydrateRoot`; after hydration they read `"a"` and `"stored"`. This is F116/F122 in jsdom. Comment it: "if this ever fails, React or RHF changed how mount reconciliation works — re-read DECISION-159 before deleting it".

**Three wiring tests in existing files** (each file already mocks `next/navigation` / the action): `statistics-form.test.tsx`, `statistics-submit-form.test.tsx` and `member-wizard.test.tsx` each gain one test: `renderToString(<TheForm {...props} />)` contains `<fieldset disabled=""` and `aria-busy="true"`. These prove the wiring on the F116 form, on the public phone-first form, and on the one root with no `<form>` tag. The other 15 roots are covered by the tripwire (presence) and Phase 5's browser pass (nesting).

### 2. Applying it to all 18 roots (design item 2)

Pattern for the 17 roots that have a `<form>` element (before → after; the form's own props/classes do not change):

```tsx
import { HydrationGate } from "@/components/shared/hydration-gate";
…
return (
  <HydrationGate>
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      …unchanged…
    </form>
  </HydrationGate>
);
```
`member-wizard.tsx`: wrap the root `<div className="space-y-6">` (it has no `<form>`; every step's inputs and its Back/Next/Add buttons live under that div). Early returns that render an empty state or an error *before* the main return (listed per row) stay **ungated** — no controls, nothing to protect, and no hook-order impact because `HydrationGate` is a child component that owns its own hook.

| # | Root (`src/app/…`) | Wrap | `<select>` class edit (add `disabled:cursor-not-allowed disabled:opacity-50`) |
|---|---|---|---|
| 1 | `(org)/o/[slug]/admin/reports/statistics-form.tsx` | the `<form noValidate className="max-w-2xl space-y-4">` (final return; the `congregations.length === 0` early return stays ungated) | `SELECT_CLASSES` (:21) |
| 2 | `…/reports/record-payment-form.tsx` | the `<form className="max-w-md space-y-4">` | `SELECT_CLASSES` (:20) |
| 3 | `…/reports/per-capita-rate-form.tsx` | the `<form className="max-w-md space-y-4">` | none (no select) |
| 4 | `…/credentials/record-appointment-form.tsx` | the `<form>` (final return; two early returns stay ungated); `UnsavedChangesDialog` stays inside the form | `SELECT_CLASSES` (:23; 3 selects) |
| 5 | `…/credentials/record-ordination-form.tsx` | the `<form>` (early return stays ungated) | `SELECT_CLASSES` (:23) |
| 6 | `…/officers/add-officer-term-form.tsx` | the `<form>` (early return stays ungated) | `SELECT_CLASSES` (:26; 3 selects) |
| 7 | `…/groups/add-group-member-form.tsx` | the `<form>` (early return stays ungated) | `SELECT_CLASSES` (:20) |
| 8 | `…/groups/new-group-form.tsx` | the `<form>` (early return stays ungated) | `SELECT_CLASSES` (:19) |
| 9 | `…/groups/edit-group-form.tsx` | the `<form>` | none |
| 10 | `…/events/new-event-form.tsx` | the `<form>` (checkboxes + radios inside) | `SELECT_CLASSES` (:26; 3 selects) |
| 11 | `…/events/edit-event-form.tsx` | the `<form>` (checkboxes inside) | none |
| 12 | `…/events/extend-series-form.tsx` | the `<form>` (radios inside) | `SELECT_CLASSES` (:25; 3 selects) |
| 13 | `…/members/[id]/edit/edit-person-form.tsx` | the `<form className="space-y-6">` (radios inside) | `SELECT_CLASSES` (:19) |
| 14 | `…/members/[id]/edit/record-roll-action-form.tsx` | **only the inner `<form>`** — not the heading / pending-actions `<div>` that wraps it (that text is not a control) | `SELECT_CLASSES` (:29) |
| 15 | `…/members/new/member-wizard.tsx` | the root `<div className="space-y-6">` — covers `search/confirm/identity/contact/household/rollAction/review` steps | in the **step files**, not the root: `household-step.tsx` `SELECT_CLASSES` (:10) and `roll-action-step.tsx` `SELECT_CLASSES` (:14) |
| 16 | `…/oversight/[aboutOrgId]/edit-form.tsx` | the `<form className="max-w-xl space-y-4">` (its two `Textarea`s already have `disabled:` variants) | `SELECT_CLASSES` (:18) |
| 17 | `…/staff/add-staff-position-form.tsx` | the single `<form>` — this covers **both** `useForm` instances (`form` and `personForm`), because the "add a new person" fallback renders inside that one element, never in a nested `<form>` (early return stays ungated) | `SELECT_CLASSES` (:25) |
| 18 | `(statistics-submit)/file-statistics/statistics-submit-form.tsx` | the `<form className="space-y-8 pb-24">`; the `sticky bottom-0` Submit bar stays inside it (a fieldset sets no overflow, so sticky is unaffected) | **no const** — the `#attested-role` select carries an inline class string (:220); append the same two utilities to that literal |

That is **15 `SELECT_CLASSES` constants + 1 inline string = 16 strings**. The 11 non-RHF files that also define `SELECT_CLASSES` (`file-ticket-form`, `grant-role-form`, `create-role-form`, `issue-grant-form`, `guardian-link-form`, `sensitive-info-form`, `change-status-dialog`, `end-term-dialog`, and the rest of the 23) are **not** touched — that is F125's consolidation, and an unlisted `disabled:` addition there would be dead styling (they are never inside a gate). The additions pass `check:brand-scope` C2 (the rule needs `rounded-*` AND `px-N` AND `font-medium|semibold`; the strings have no font-weight).

**Existing unit tests: unaffected, with one check.** Every colocated test renders through RTL `render()` (client snapshot `true`, proven above), so every control is enabled on the first render. 13 of the 18 roots have a colocated test (`statistics-form`, `statistics-submit-form`, `member-wizard`, `edit-person-form`, `record-roll-action-form`, `add-officer-term-form`, `new-group-form`, `add-group-member-form`, `edit-group-form`, `add-staff-position-form`, `extend-series-form`, `edit-event-form`, `new-event-form`); 5 have none (`record-appointment`, `record-ordination`, `per-capita-rate`, `record-payment`, `oversight edit-form`). I grepped all 13 for `firstChild`, `container.children`, snapshots, `renderToString`, `asFragment`, `closest(` and found only `record-roll-action-form.test.tsx:83` (`select.parentElement`, the select's own `relative` wrapper — inside the form, not the gate). Because the gate is *outside* the form, no parent chain a test can see changes. `file-statistics/page.test.tsx` inspects the returned element tree, not DOM. If `npm test` shows any red, the implementer records it as a Phase 4 deviation rather than patching around it.

### 3. The tripwire (design item 3) — `scripts/check-hydration-gate.mjs`

Written in the house style of `check-brand-scope.mjs` (pure exported `checkHydrationGate(files)` taking `Array<{ path, content }>` with POSIX repo-relative paths, so a fixture test needs no disk; a `walk()` over `src/` for the script entry; comment lines skipped).

**The rule (H1).** For every non-test `.ts`/`.tsx` under `src/` (exclude `*.test.ts`, `*.test.tsx`): if any **non-comment** line matches
```js
const CALL_RE = /(?<![A-Za-z0-9_$])useForm\s*[<(]/;
```
then the file must contain **both** a non-comment line matching `/from\s+["']@\/components\/shared\/hydration-gate["']/` **and** a non-comment line matching `/<HydrationGate[\s>]/`. Otherwise: violation `H1` at the first `useForm` call line, message pointing at `docs/ui-standards.md` → Forms — State Patterns and DECISION-159.
**H2.** A `.ts` (non-`.tsx`) file that calls `useForm` can never render the gate itself → violation unless exempted (closes the "move the call into a custom hook" bypass). Today there are none.

**Exemption syntax**, matching the house convention (`// sql-date-ok:`, `// ui-ok:`, `// audit-exempt:`): `// hydration-gate-ok: <reason>` on the **same line or the line directly above** the `useForm` call. A file passes if every call is exempted *or* the gate import and element are present. The reason is mandatory (`\S` after the colon). No file is exempt today; the exemption exists so a deliberately client-only, never-SSR'd form has an honest escape instead of a bypass.

What it can and cannot see: it is a **presence** tripwire — "not a proof; just a tripwire", like its siblings. It cannot tell that `<HydrationGate>` actually wraps the controls; that is covered by the three SSR wiring tests, code review and Phase 5's browser pass. `useFormState(` / `useFormStatus(` / `useFormContext(` do not match (the regex needs `<` or `(` right after `useForm`). A `typeof useForm<…>` type query (as in `edit-person-form.tsx:275`) matches, but that file has a real call anyway.

**`scripts/check-hydration-gate.test.mjs`** (vitest picks up `scripts/**/*.test.mjs`): fixtures — gated `useForm<V>(` file passes; ungated fails H1 naming the line; gate imported but no `<HydrationGate` element fails; import but element only in a comment fails; `useForm()` in a comment-only line passes; `// hydration-gate-ok: reason` same-line and line-above both pass; an exemption with no reason fails; `.test.tsx` file with `useForm` is ignored; `.ts` file with `useForm` fails H2; two `useForm` calls and one gate passes (`add-staff-position-form` shape); `useFormState(` / `useFormStatus(` not flagged.

**Wiring.**
- `package.json`: `"check:hydration-gate": "node scripts/check-hydration-gate.mjs"` and append `&& npm run check:hydration-gate` to the `check` script (it becomes six tripwires).
- `ci.yml` needs **no edit**: its "Tripwire checks" step runs `npm run check`.
- `.claude/skills/pre-push/SKILL.md`: add **Step 3f: Hydration-gate tripwire** after Step 3e (same shape as 3b/3c: command, one paragraph on what it checks and the `// hydration-gate-ok:` fix). Note the skill today lists only `check:audit`, `check:sql-date`, `check:secrets`; `check:deps-drift` and `check:brand-scope` are CI-only. That is existing drift, proposed below as a TODO, not fixed here.
- Landing order: **after** the 18 roots are wrapped (slice 3), so it lands green. The flip-test goes in the Phase 4 notes: delete one `<HydrationGate>` → `npm run check:hydration-gate` exits 1 naming that file; restore → exits 0.

### 4. `playwright.config.ts` — the `PW_PROD_BUILD=1` lane (design item 4)

```ts
const isProdBuildRun = process.env.PW_PROD_BUILD === "1";
const PROD_PORT = Number(process.env.PW_PROD_PORT ?? 3800);
const PROD_BASE_URL = `http://localhost:${PROD_PORT}`;

if (isProdBuildRun) {
  if (isVisualRun) throw new Error("PW_PROD_BUILD=1 and PW_VISUAL=1 are mutually exclusive.");
  if (process.env.E2E_BASE_URL)
    throw new Error(
      "PW_PROD_BUILD=1 starts and owns its own production server and base URL; unset E2E_BASE_URL " +
      "(an external — i.e. dev — server must never satisfy this lane).",
    );
  if (!Number.isInteger(PROD_PORT) || PROD_PORT < 1024 || PROD_PORT > 65535 || PROD_PORT === 3000)
    throw new Error(`PW_PROD_PORT must be an integer 1024-65535 other than 3000 (got "${process.env.PW_PROD_PORT}").`);
}
const baseURL = isProdBuildRun ? PROD_BASE_URL : (process.env.E2E_BASE_URL ?? "http://localhost:3000");
```
(Document next to it, in the same long-comment style as `isVisualRun`: environment variable, **not argv**, because workers reload this config and do not inherit the CLI's flags — the brand-foundation a2 lesson. The throws re-run harmlessly in each worker.)

- **Port: 3800**, override `PW_PROD_PORT`. Not 3000 (default dev), 3100 (visual-parity docs), 3400/3500/3700 (other pipelines' dev ports). The override exists so two worktrees can each run the lane; the guard rejects 3000.
- **`webServer`** (prod branch of a ternary; the existing dev object is unchanged):
  ```ts
  {
    command: `npm run build && npm run start -- --port ${PROD_PORT}`,
    url: `${PROD_BASE_URL}/api/auth/csrf`,   // always 200; the same endpoint globalSetup uses
    reuseExistingServer: false,               // ALWAYS, CI or not
    timeout: 600_000,                          // covers the build: ~16 s warm locally, allow a cold CI Turbopack build
    stdout: "pipe",                            // default is "ignore": a failing build must be visible in the reporter
    stderr: "pipe",
    env: {
      RATE_LIMIT_DISABLED: "true",
      AUTH_URL: PROD_BASE_URL,                 // overrides CI's AUTH_URL=http://localhost:3000 written to .env.local
    },
  }
  ```
  `npm run build` / `npm run start` load `.env.local` themselves (Next reads it in production mode); no `dotenv-cli` wrapper is needed. The Playwright process already ran `dotenv.config(.env.local)`, and `webServer` inherits `process.env`.
- **Guard that a dev server can never satisfy the lane** — four independent layers: (1) `reuseExistingServer: false` — Playwright aborts ("is already used") if anything at all is bound to the port; (2) the prod branch **ignores and rejects `E2E_BASE_URL`**, so a dev server on another port cannot be pointed at; (3) the lane's `baseURL` is the constant above; (4) **`assertProductionServer(baseURL)` in `e2e/support/global-setup.ts`**, called right after `assertRateLimiterDisabled()` only when `PW_PROD_BUILD === "1"`: `fetch(`${baseURL}/signin`)`, read the HTML, throw if it contains `/hmr-client|%5Bturbopack%5D|\[turbopack\]/i` or if it contains no `/_next/static/…\.js` script. Verified negative on a real production server (0 matches, scripts present and `async`). **Phase 4 verifies the positive side once**: point the same function at the dev server on 3700 and confirm it throws (dev chunk names contain `hmr-client`; if the dev HTML turns out not to contain it, pick another dev-only marker and record it — do not ship an unproven guard). Also change the sign-in failure hint in `signInAndSave` so it does not say "Is the dev server running…" when `PW_PROD_BUILD=1`.
- **`projects`:** prod mode → exactly one project, `{ name: "prod-build", use: { ...devices["Desktop Chrome"] }, testMatch: /hydration\/.*\.spec\.ts$/ }`. Default mode → unchanged (`chromium` with `testIgnore: /visual-parity\.spec\.ts$/`, plus `visual` when `PW_VISUAL=1`). `chromium` therefore **keeps running `e2e/hydration/`** with no config change — every `npm run test:e2e` includes it against the dev server.
- **`globalSetup` / storageState against the production port:** `globalSetup` is the same file; it reads `config.projects[0].use.baseURL`, which top-level `use.baseURL = baseURL` makes `http://localhost:3800` in the prod lane. It re-runs the idempotent fixture seeding (`seedE2EUsers`, `seedE2EOrgs`, `cleanupTestFeedback`) and reuses a `<12 h` `.auth/*.json` or signs in against the production server. Cached sessions from a dev run are valid (cookie host-scoped, same `AUTH_SECRET`); if the fixture roster ever changes, the existing "delete `e2e/support/.auth/`" rule applies to both lanes. `assertRateLimiterDisabled()` still reads `process.env.RATE_LIMIT_DISABLED` in the Playwright process (from `.env.local`), same as the dev lane — the `webServer.env` value covers the server child.
- **Script:** `"test:e2e:prod": "PW_PROD_BUILD=1 playwright test --project=prod-build"` (POSIX env prefix, as `visual:baseline`/`visual:check` do).
- `.gitignore`: add `/test-results-prod/` beside `/test-results/` (the CI step and local rehearsals can use `PW_OUTPUT_DIR=test-results-prod`).

### 5. The spec — `e2e/hydration/statistics-congregation.spec.ts` (design item 5)

**Shared fixture helper first** (DECISION-157: mutation helpers in `e2e/support/` carry an assert-and-throw guard, not a comment). Extract `removeCongregationStatistics` from `presbytery-reports.spec.ts` verbatim (the `do $cleanup$ … disable trigger … delete … enable trigger … $cleanup$` block **and** the tgenabled verification) into **`e2e/support/statistics-fixture.ts`**, adding the guard at the top: throw unless `organizationId` and `aboutOrgId` start with `e2e00000-` (the fixture UUID prefix in `seed-orgs.ts`) and `2090 <= year <= 2099`. `presbytery-reports.spec.ts` imports it (a pure move; the message text `[presbytery-reports.spec]` becomes `[statistics-fixture]`). Both specs now share one proven cleanup rather than a second copy.

**Test file.** `test.describe("Hydration — statistics form (DECISION-159, F116)")`, **not** `describe.serial` (the three tests are independent). `test.setTimeout(90_000)` (dev-lane first-compile of the reports route can take tens of seconds). `const YEAR = 2096`.

Setup/teardown:
- `beforeAll`: `sql = platformSql("hydration/statistics-congregation.spec")`; `flags = await captureFlags(sql, ["org_portal.reports"])`; `await setFlag(sql, "org_portal.reports", true)`.
- `beforeEach`: remove any `congregation_statistics` row for `(E2E_ORGS.presbytery.id, aboutOrg, 2096)` for **all three** `E2E_ORGS.alpha / beta / gamma` (cheap, and it makes a CI retry and a crashed prior run idempotent — and it also clears the *wrong-congregation* row a regression would write for the default, `gamma`).
- `afterAll`: same removal, then `await flags.restore()`.

Helper inside the spec:
```ts
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});   // the page may be gone by the time a late chunk is released
  });
  return release;
}
```
Every `.js` under `/_next/static/` is held (dev `?ts` query strings included); **CSS is not held** (a held render-blocking stylesheet breaks Playwright's visibility checks). Always `release()` in `finally` before `context.close()`.

**Test 1 — "a congregation picked before hydration is impossible; the one picked after is the one persisted"** (storageState `presbytery-clerk`, default viewport):
1. `context = browser.newContext({ storageState: storageStatePath("presbytery-clerk") })`, `page = context.newPage()`, `release = await holdScripts(page)`.
2. `await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${YEAR}`, { waitUntil: "domcontentloaded" })` (Next's scripts are `async` — verified — so this resolves with every chunk still held).
3. **Pre-release assertions** (these are the lines that fail on the parent commit):
   `const select = page.locator("#stats-congregation"); const submit = page.getByRole("button", { name: /^save statistics$/i });`
   `await expect(page.locator('fieldset[data-slot="hydration-gate"][aria-busy="true"]')).toHaveCount(1);`
   `await expect(select).toBeDisabled(); await expect(submit).toBeDisabled(); await expect(page.locator("#stats-endingActive")).toBeDisabled();`
   `await expect(select).not.toHaveValue(E2E_ORGS.alpha.id);` — fixture sanity: alpha (Wrenfield) must be a *non-default* option (the default is the alphabetically first, Halloway = gamma); if fixtures ever change this fails loudly instead of passing vacuously.
4. `release()`.
5. **Hydration signal:** `await expect(select).toBeEnabled({ timeout: 30_000 });` — enablement *is* the signal (no `networkidle`, no timeout, no throttle anywhere).
6. `await select.selectOption(E2E_ORGS.alpha.id); await expect(select).toHaveValue(E2E_ORGS.alpha.id);`
   `await page.locator("#stats-endingActive").fill("73"); await page.locator("#stats-minute-reference").fill("Hydration spec, e2e fixture");`
7. `await submit.click(); await expect(page.getByText(/statistics saved/i)).toBeVisible({ timeout: 10_000 });`
8. **Persisted-row assertion** (a DOM check is not enough — F121's failure mode looks right on screen):
   ```ts
   const rows = (await sql`
     select about_org_id, ending_active, minute_reference
       from congregation_statistics
      where organization_id = ${E2E_ORGS.presbytery.id}::uuid and year = ${YEAR}
   `) as { about_org_id: string; ending_active: number; minute_reference: string }[];
   expect(rows).toHaveLength(1);
   expect(rows[0].about_org_id).toBe(E2E_ORGS.alpha.id);   // the clicked one, NOT the default (gamma)
   expect(rows[0].ending_active).toBe(73);
   ```
9. `finally { release(); await context.close(); }`.

**Test 2 — "a Submit before hydration is inert" (F123):** same hold/goto. Assert `submit` is disabled; `await submit.click({ force: true })` (force is the point: it bypasses Playwright's own enabled check to prove the browser itself swallows the click); `const startUrl = page.url()`; `release()`; `await expect(select).toBeEnabled()`; `await expect(page).toHaveURL(startUrl)` — a native GET submit would have navigated to `…?aboutOrgId=…&year=…` (every field in the query string), and by the time the form re-enables that navigation would have settled. No rows are written, so no DB assertion.

**Test 3 — "[360px] the gate is visible and releases at mobile width":** `viewport: { width: 360, height: 800 }`, hold/goto, assert `select`, `submit` and `#stats-year` disabled, `release()`, `toBeEnabled()`, pick alpha and assert the value (no submit). This is the Phase 5 "disabled state at 360px" evidence in a repeatable form.

**Negative control (QA, Phase 5), recorded recipe.** Run against `b91bc95`'s `statistics-form.tsx` and the spec above: tests 1, 2, 3 fail at the **first pre-release `toBeDisabled()`** ("Expected: disabled, Received: enabled") because the ungated select is operable. In the prod lane, do it in the scratch copy (§7), never in the worktree: `git show b91bc95:"src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx" > "$SCRATCH/app/src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx"`, run `npm run test:e2e:prod` there → red; restore from the worktree copy → green. Also run the dev lane once (`E2E_BASE_URL=http://localhost:3700 npm run test:e2e -- e2e/hydration`) for the same red/green pair.

### 6. Removing the mask (design item 6)

Replace `await page.waitForLoadState("networkidle")` with a web-first enablement wait on the **first control the case touches**; delete it where no gated control is touched next (each such case already starts with an auto-waiting positive assertion — read and confirmed).

`e2e/presbytery-reports.spec.ts` (10 lines; afterwards `grep -c networkidle` must be 0):

| Line | Case | Replace with |
|---|---|---|
| 114 | 1. enters statistics | `await expect(page.locator("#stats-congregation")).toBeEnabled();` |
| 145 | 2. sets rate | `await expect(page.locator("#rate-basis-year")).toBeEnabled();` |
| 172 | 3. generates records | `await expect(page.locator("#rate-per-member")).toBeEnabled();` — `GenerateRecordsButton` is a plain `onClick` button, **not** an RHF root and not gated (before hydration it is enabled but its click is silently lost, a harmless-but-flaky class outside this pipeline), so it has no enablement signal of its own. The per-capita rate form sits in the same billing-year section of `page.tsx`, so its gate releasing is the nearest honest hydration signal; Phase 4 confirms both live in one hydration boundary and, if not, waits on a signal the button's own component provides — never `networkidle`. |
| 194 | 4. records payment | `await expect(page.locator("#payment-amount")).toBeEnabled();` |
| 223, 245, 261, 281, 302 | 5–9 (assert text/absence only) | delete — the next line is a web-first assertion |
| 326 | 10. [360px] entering statistics | `await expect(page.locator("#stats-congregation")).toBeEnabled();` |

Lines 281 and 302 are also mis-indented today; deleting them removes that.

Same treatment for the two sibling presbytery specs, **interaction cases only** (read-only/denied cases and the post-save list refresh at `oversight:81`, `credentials:156` — the latter precedes a non-RHF `change-status-dialog` — are left untouched; they do not touch a gated control, so they are not this defect's mask):
- `e2e/presbytery-oversight.spec.ts`: line 71 → `await expect(page.locator("#oversight-viability")).toBeEnabled();` (case 2); line 182 → same (case 6, 360px).
- `e2e/presbytery-credentials.spec.ts`: line 82 → `#ordination-person` (case 1); line 119 → `#appointment-person` (case 2); line 262 → `#ordination-person` (case 7, 360px).
`filings-round-trip.spec.ts` (11 `networkidle`s) is **not** touched: its flows are the non-RHF issue-grant/publish forms and the anonymous submit page, whose `getByLabel(...).fill` already auto-waits. Tracked as F126 below.

### 7. CI step and local rehearsal (design item 7)

**`.github/workflows/e2e.yml`** — after "Run e2e suite", before "Upload traces on failure":

```yaml
      # DECISION-159: the pre-hydration regression again, against a production
      # build (next build && next start, port 3800, never a reused server).
      # Same ephemeral Neon branch — the spec mints its own fixture rows, so a
      # second branch buys nothing. `!cancelled()`, not `always()`: still runs
      # when the dev-server lane above failed (the two lanes are independent
      # evidence), but a cancelled run (concurrency group) stops.
      - name: Run hydration specs against a production build
        if: ${{ !cancelled() }}
        timeout-minutes: 15
        run: npm run test:e2e:prod
        env:
          CI: "true"
          PW_OUTPUT_DIR: test-results-prod
```
and the upload step becomes `path: |` / `test-results/` / `test-results-prod/`. Job `timeout-minutes: 30` → `40`. Budget reasoning: the lane adds one production build (16 s warm on a laptop; allow ≤4 min cold on a runner), a server start, globalSetup's idempotent seeding (~tens of seconds) and three short tests — about 6 minutes at the outside — and the step's own 15 bounds a hung build so it cannot consume the job. **This is paper until `NEON_API_KEY` is added**: `e2e.yml` has never run, so revisit the numbers at its first real run. **The local production-lane run is the real Phase 5 gate.**

**Local production-build rehearsal (Phase 4 and Phase 5).** The dev lane needs no scratch copy:
```
# Start a dev server yourself on 3700 (never pkill -f; note the PID to stop it), then:
E2E_BASE_URL=http://localhost:3700 npm run test:e2e -- e2e/hydration
```
For the production lane, build in a **scratch copy outside `~/git/presby-platform/`** (workaround for the Turbopack worktree flake; the committed `turbopack.root` is the repo's parent directory, which in this tree also contains every sibling worktree). Step by step, from the worktree:
1. `env | grep -E '^(DATABASE_URL|PLATFORM_DATABASE_URL|APP_DATABASE_URL)='` must print nothing (an exported URL silently beats `.env.local`). `lsof -nP -iTCP:3800 -sTCP:LISTEN` must print nothing. Confirm `.env.local` has `RATE_LIMIT_DISABLED=true`.
2. `SCRATCH=/private/tmp/presby-select-prod; rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/app"` — own parent so `turbopack.root` (= its parent) contains only the copy.
3. `rsync -a --exclude .git --exclude .next --exclude node_modules --exclude test-results --exclude test-results-prod ./ "$SCRATCH/app/"` (this deliberately **keeps** `.env.local`; the lane needs the pipeline Neon branch's URLs; the copy lives outside any repo and is deleted in step 7).
4. `cp -al node_modules "$SCRATCH/app/node_modules"` — **hardlink, never a symlink** (a symlink either crosses `turbopack.root` and fails outright, or triggers the font-module error). ~17 s, ~829 MB, no extra disk. Must be the same filesystem (`/private/tmp` and `/Users` are both on the Data volume; verified).
5. `cd "$SCRATCH/app" && npm run test:e2e:prod 2>&1 | tee "$SCRATCH/lane.log"` — builds, starts on 3800, runs `e2e/hydration/` only, tears the server down. Add `PW_PROD_PORT=3810` if another worktree holds 3800.
6. Negative control (Phase 5): overwrite the scratch copy's `statistics-form.tsx` with `git show b91bc95:<path>` from the worktree, rerun step 5 → red at the pre-release `toBeDisabled()`; restore it → green.
7. `cd /; rm -rf "$SCRATCH"; lsof -nP -iTCP:3800 -sTCP:LISTEN` → nothing listening. Fallback if the build ever flakes anyway: `rm -rf "$SCRATCH/app/.next"` and retry (up to 3×); record each attempt in the work-log. Running the lane directly in the worktree (`npm run test:e2e:prod`) also works when no sibling worktree interferes, and coexists with a dev server (`.next/dev` is preserved by `next build`).

### 8. Doc edits on this branch (design item 8)

**`docs/ui-standards.md` — Forms — State Patterns.** Insert directly after the "**When to add `react-hook-form` + `zod`:**" paragraph:

> **Every `react-hook-form` form root is wrapped in `<HydrationGate>` (DECISION-159).** `register()` writes `defaultValues` over the live DOM when it attaches during hydration, so anything a user types or picks before the page's JavaScript has run is overwritten — and a native `<select>` falls back to a *different, valid* option with no visible sign (F116: a congregation's annual statistics were saved against the wrong congregation, with a success toast). `<HydrationGate>` (`src/components/shared/hydration-gate.tsx`) renders a `<fieldset disabled aria-busy>` around the form until the client has hydrated, so every control and Submit is inoperable for that moment (dimmed by the control's own `disabled:` styles — labels and hint text are never dimmed) and enabled the instant it ends. On a client-side navigation it is enabled from the first render, so there is no flash.
>
> ```tsx
> return (
>   <HydrationGate>
>     <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">…</form>
>   </HydrationGate>
> );
> ```
>
> Wrap the `<form>` element from the outside (or, for a flow with no `<form>` tag such as `member-wizard`, its root element). Never add a `<legend>` to the gate, and never put opacity on it. `npm run check:hydration-gate` fails any file that calls `useForm` without importing and rendering it; a deliberately client-only form carries `// hydration-gate-ok: <reason>` on or above the call. A new pre-hydration behaviour is tested by holding the page's JavaScript with `page.route` (see `docs/testing.md`), never by racing a throttle.

**`docs/ui-standards.md` — Select & Combobox Patterns → Native `<select>`.** (a) In the example `className`, append `disabled:cursor-not-allowed disabled:opacity-50`, and add one sentence after the code block: "The `disabled:` variants matter even on a select you never disable yourself: inside a `<HydrationGate>` the form is briefly `disabled`, and a native select otherwise renders no hint of it (`Input`, `Textarea` and `Button` already style it)." (b) Add this paragraph before "Always give it an associated `<label>`":

> **A `value=`-controlled native `<select>` does not fix a pre-hydration pick — it hides it.** React 19 hydration of a `<select>` only validates; it neither writes the DOM selection nor replays a change made before React's listeners existed. A `Controller`- or `useState`-controlled select therefore keeps the user's choice on screen while the state holds the default, Submit sends the default, and the next commit snaps the DOM back at an arbitrary later moment (F121). Do not "fix" a hydration bug by converting a registered select to a controlled one; put the form in `<HydrationGate>`. Controlled selects outside react-hook-form that *write data* carry the same divergence and are tracked in F124.

**`docs/ui-standards.md` — Pre-merge UX Audit Checklist.** Add: `- [ ] Every react-hook-form form root is inside <HydrationGate> (npm run check:hydration-gate passes); at 360px the form is disabled while the page's JavaScript is held and enabled once it is released`.

**`docs/testing.md`.** New section **"Pre-hydration specs and the production-build lane"** between "Running the DB-backed suites" and "Continuous integration":

> ## Pre-hydration specs and the production-build lane
>
> A form that is operable before it hydrates can lose what a user does to it (DECISION-159). Specs for that live in `e2e/hydration/` and are deterministic: they hold every `/_next/static/**.js` request with `page.route` behind a promise, `goto` with `waitUntil: "domcontentloaded"` (Next's scripts are `async`, so the page parses fully with no JavaScript), assert the pre-hydration state, release the scripts, and use **control enablement** (`toBeEnabled()`) as the hydration signal. Do not synchronize with throttling, `waitForTimeout`, or `networkidle` — they race, and `networkidle` is how this class of bug was masked for a month. Assert **persisted** state with `platformSql`, not just the DOM, and mint your own fixture rows (DECISION-157; the statistics spec uses report year 2096).
>
> These specs run in the normal `npm run test:e2e` (the `chromium` project, dev server) **and** in a second lane against a production build:
>
> ```bash
> npm run test:e2e:prod     # PW_PROD_BUILD=1: npm run build && npm run start -- --port 3800, hydration specs only
> ```
>
> The lane always starts its own server (`reuseExistingServer: false`, port 3800, `PW_PROD_PORT` to override), rejects `E2E_BASE_URL`, and `globalSetup` fails if the server on that port is not a production build. It coexists with a dev server in the same checkout (`next build` preserves `.next/dev`). **From a worktree** the build can fail intermittently with `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` (the committed `turbopack.root` is the repo's parent directory, shared with every sibling worktree); build in a scratch copy outside `~/git/presby-platform/` with a **hardlinked** `node_modules`: (followed by the §7 recipe, steps 1–7, as a fenced `bash` block with the same commands). A negative control is part of the job: revert the form under test to its pre-gate version in the scratch copy and the spec must go red at the pre-release `toBeDisabled()`.

and one sentence appended to "Continuous integration": "`e2e.yml` runs the production lane as a second step of the same job (`if: ${{ !cancelled() }}`, traces in `test-results-prod/`); like the rest of that job it is paper until `NEON_API_KEY` is added, so the local lane run is the gate until then."

### 9. Files

**Create:** `src/components/shared/use-hydrated.ts`, `use-hydrated.test.tsx`, `hydration-gate.tsx`, `hydration-gate.test.tsx`; `scripts/check-hydration-gate.mjs`, `scripts/check-hydration-gate.test.mjs`; `e2e/hydration/statistics-congregation.spec.ts`; `e2e/support/statistics-fixture.ts`.

**Modify:** the 18 roots in the table (+ `household-step.tsx`, `roll-action-step.tsx` for class strings only); `statistics-form.test.tsx`, `statistics-submit-form.test.tsx`, `member-wizard.test.tsx` (one wiring test each); `playwright.config.ts`; `e2e/support/global-setup.ts` (`assertProductionServer` + hint text); `e2e/presbytery-reports.spec.ts`, `e2e/presbytery-oversight.spec.ts`, `e2e/presbytery-credentials.spec.ts`; `package.json` (two scripts + `check`); `.github/workflows/e2e.yml`; `.gitignore` (one line); `.claude/skills/pre-push/SKILL.md` (Step 3f); `docs/ui-standards.md`; `docs/testing.md`.

**Off-limits on this branch (kickoff Rule 16):** `CLAUDE.md`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/product/functionality-map.md`, `docs/schema-design-2.md`; and `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/seed.ts`, `src/lib/org-portal/tiles.ts`, `src/lib/audit.ts` are not needed at all. `package.json` scripts, `playwright.config.ts`, `e2e.yml` and `scripts/check*` are this pipeline's (orchestrator note, 2026-10-05).

## Implementation Order

One implementer, four commit slices (commit grammar per the repo's `commit-msg` hook; each slice leaves the tree green):

1. **Primitive + unit tests.** `use-hydrated.ts`, `hydration-gate.tsx`, both test files. Gate: `npm test -- src/components/shared`, `npm run typecheck`.
2. **Apply to the 18 roots + 16 class strings + the 3 wiring tests.** Mechanical; do the roots in the table's order and run `npm test` after each directory. Gate: `npm run typecheck`, `npm test` (full), `npm run lint`, `npm run check` (five existing tripwires).
3. **Tripwire.** Script, fixture test, `package.json`, pre-push skill step 3f. Gate: `npm run check` (six), plus the recorded flip-test (remove one gate → red naming the file; restore → green).
4. **e2e lane, spec, mask removal, CI, docs.** `statistics-fixture.ts` extraction (re-run `presbytery-reports` to prove the move); `playwright.config.ts` prod branch; `global-setup.ts` guard (verify its positive side against a dev server); `package.json` script; the new spec; mask removals in the three specs; `.gitignore`; `e2e.yml`; docs. Gate: dev-lane `e2e/hydration` green on 3700; the three edited presbytery specs green; the production lane green via the scratch-copy recipe; **the negative-control red recorded** (QA repeats it in Phase 5).
5. Audit events: none (no mutation added). Release notes: after Phase 6 SHIP IT, one user-facing line ("Forms briefly appear dimmed while a page finishes loading, so nothing you type or pick can be lost") — tech-lead via `/release-notes`.

## Edge Cases & Risks

**E2E blast radius — existing specs that assert behaviour this changes**

| Spec | Touches | Effect | Action |
|---|---|---|---|
| `presbytery-reports.spec.ts` | statistics / per-capita / payment forms | Control interactions now auto-wait for the gate to release; the mask lines go | Edit (§6); re-run whole file |
| `presbytery-oversight.spec.ts` | `OversightEditForm` | same | Edit 2 lines; re-run |
| `presbytery-credentials.spec.ts` | `RecordOrdinationForm`, `RecordAppointmentForm` | same; the `end appointment` dialog (`change-status-dialog`, not RHF) is untouched | Edit 3 lines; re-run |
| `statistics-submit.spec.ts`, `filings-round-trip.spec.ts` | public `StatisticsSubmitForm` (`getByLabel(...).fill`, Submit `click`) | Actions auto-wait for enabled, so green and *less* racy; the mobile/desktop layout reads at `filings-round-trip:284/291` run after load — the gate adds no visual change once enabled | No edit; **Phase 5 must run both** |
| `visual-parity.spec.ts` (`PW_VISUAL=1`) | form routes, screenshots at `networkidle` | Hydrated ⇒ enabled ⇒ pixel-identical; baselines are gitignored and self-comparing | No edit; optional Phase 5 pass |
| Every other spec | no gated form | none (no `getByRole("group")`, `locator("fieldset")`, `toBeDisabled`/`toBeEnabled` or `fieldset` selector anywhere in `e2e/` — grepped) | none |
| New: `e2e/hydration/statistics-congregation.spec.ts` | `statistics-form` | runs in `chromium` (dev) **and** `prod-build` | Phase 5 runs both, plus the negative control |

**Unit-test blast radius:** expected zero (§2). The 3 wiring tests and the 2 new test files are additive.

**Edge cases**
- **Forms inside dialogs / forms that render only after a client fetch.** None of the 18 is either (all are rendered directly by a server-component `page.tsx`). By design the gate would still be right: a form that *mounts* on the client (dialog opening, post-fetch render) is not hydrating, so `useHydrated()` is `true` on its first render and it is enabled immediately — correct, because no server HTML exists for a user to have touched. A form SSR'd inside a streamed `<Suspense>` boundary is selectively hydrated: the gate's HTML is disabled from first paint and enables when *that boundary* hydrates.
- **`useActionState` / `<form action={serverAction}>` forms are NOT RHF and are explicitly out of scope** (`branding-form`, `contact-form` (public site), `create-organization-form`, `service-times-section`, `brand-form`, `profile-form`, `site-section`). They have no `useForm`, so the tripwire does not see them, and a pre-hydration submit of a Server-Action form is a *supported* progressive-enhancement path in Next, not this defect. Plain `useState` forms with native selects (`grant-role-form`, `issue-grant-form`, `create-role-form`, `file-ticket-form`, `guardian-link-form`, `sensitive-info-form`, `change-status-dialog`, `end-term-dialog`) carry the F124 divergence and are tracked there.
- **JavaScript never arrives** (blocked chunk, dead tunnel): the form stays disabled forever. Accepted — these forms need JavaScript to do anything, and a silently-enabled-but-dead form (the status quo) is worse; it matches the `allowedDevOrigins` comment in `next.config.ts` ("every submit button stays permanently disabled").
- **Hydration mismatch fallback:** if React falls back to client rendering, that render is non-hydrating, so the gate reads `true` and enables. Test 2 of `hydration-gate.test.tsx` asserts there is no mismatch warning in the normal path.
- **Checkbox/radio read while disabled** (RHF `getCheckboxValue`/`getRadioValue` skip disabled options): safe because every such field has a defined default and none uses `defaultChecked`. **Invariant (goes into the DECISION-159 amendment):** a checkbox/radio registered under a `HydrationGate` must have a defined default, or `useForm` must set one; unit test 4b is the guard.
- **Layout:** the gate is a block-level fieldset *around* the form; `min-w-0` prevents `min-content` sizing at 360px. Phase 5 checks the 18 routes at 360px for any shift, with particular attention to `statistics-submit-form`'s `sticky bottom-0` Submit bar and `member-wizard`'s step indicator spacing.
- **Cancel / Back buttons** inside the gate are disabled for the same moment as Submit; `<Link>`s are not form controls and stay clickable (navigation away from an unhydrated form loses nothing).
- **Browser form-state restoration on reload / back** into a gated form: not changed by design intent and **not verified**; low risk (the restored values would hit RHF's write-back today too). Phase 5 may note what a Chrome back-navigation shows.
- **Prod lane specifics.** Secure cookies: `(account)/account/2fa/actions.ts:33` sets `secure: NODE_ENV === "production"`; Chromium accepts Secure cookies on `http://localhost`, and the hydration specs never touch 2FA, but a future prod-lane spec that does should expect it. `next build` rewrites the gitignored `next-env.d.ts`. `.auth` is shared by both lanes. Two worktrees running the lane need distinct `PW_PROD_PORT`s.
- **Retries:** CI has `retries: 1`; the spec's `beforeEach` cleanup (all three congregations) makes a retry idempotent.
- **Risk — the dev-lane spec is the more fragile of the two** (Turbopack serves chunks lazily; first compile of the reports route is slow): hence `test.setTimeout(90_000)` and a 30 s enablement wait. If the dev lane proves flaky in Phase 5, the fallback is to narrow it with `testIgnore` in `chromium` and keep the production lane as the gate — a Phase 3 amendment, not an implementer improvisation.

## Out of Scope

Explicit non-goals, for the user to confirm:
- **F124** (triage native `<select>`s outside RHF that are `useState`-controlled) and **F125** (consolidate the 23 `SELECT_CLASSES` strings into one primitive). Only the `disabled:` addition on the 16 strings of gated files happens here.
- A submit-time confirmation naming the congregation, and the audit row recording intent vs outcome (Phase 1 gaps; polish TODO below).
- Converting any select to `Controller` (rejected, F121); `key`-remount; `shouldUnregister`; element-level `defaultValue`.
- Gating non-RHF forms (`useActionState` forms, `useState` forms) and plain `onClick` buttons such as `GenerateRecordsButton`, whose pre-hydration click is silently lost (no data written; the user clicks again) — see Edge Cases.
- A CDP throttle helper in `e2e/support/` (QA's realism check — Phase 1's 10-trial CPU×4 + slow-3G run against the fixed production build, expecting 0/10 reversions and noting how long the form stays disabled — lives in the scratchpad, like Phase 1's).
- Unmasking `filings-round-trip.spec.ts` (F126) and the read-only/denied `networkidle` cases in the oversight/credentials specs.
- Any new dependency, `src/lib` change, schema change, route, action, permission or flag.
- Fixing the `e2e.yml` job's never-run state (`NEON_API_KEY`).

## Implementer

**full-stack-developer.** The work is a small, tightly coupled, cross-cutting utility — a shared component pair, a mechanical two-line wrap in 18 client forms, and the config/CI/script/spec/doc plumbing that proves it — and splitting it between ux-developer (components) and anyone else (Playwright config, workflow, tripwire) would add handoff overhead with no server code. ux-developer would be the right hands for slice 2 alone, but slices 1, 3 and 4 are config and test infrastructure. Tests are the implementer's (QA only runs them). Implementer reads: `docs/ui-standards.md` (Forms, Native `<select>`), `docs/testing.md`, `scripts/check-brand-scope.mjs` + its test (tripwire template), `e2e/support/{db,flags,seed-orgs,global-setup}.ts`, `e2e/presbytery-reports.spec.ts` (fixture and cleanup template).

## Proposed at integration (orchestrator applies; nothing below was written to a shared file)

**Amendment to DECISION-159** (append to the architect's text; no new number is needed — these are its implementation specifics):

> **Implementation specifics (tech-lead, Phase 3, 2026-10-05).** (1) `HydrationGate` wraps the `<form>` element *from the outside* (the root element for a flow with no `<form>`, e.g. `member-wizard`), takes only `children` and `className`, and has no `<legend>` (controls in a disabled fieldset's first legend are not disabled). `useHydrated()` is the public hook for any non-RHF caller. (2) At react-hook-form 7.86.0 `getFieldValue` does not skip a DOM-disabled control — only `getCheckboxValue`/`getRadioValue` skip disabled *options* — and `handleSubmit` reads `_formValues`; the residual hazard is a checkbox/radio read while disabled at hydration. **Invariant: a checkbox or radio registered under a `HydrationGate` has a defined default and does not use `defaultChecked`.** Guarded by `hydration-gate.test.tsx`. (3) `npm run check:hydration-gate` fails any `.ts`/`.tsx` under `src/` calling `useForm` without importing and rendering the gate, and any `.ts` file calling it at all; the exemption is `// hydration-gate-ok: <reason>` on or above the call. (4) The production lane's port is 3800 (`PW_PROD_PORT`), it rejects `E2E_BASE_URL`, and `globalSetup` fingerprints the server as a production build; CI traces go to `test-results-prod/`.

**Carried forward from Phase 2, unchanged:** F121–F125; the `docs/TODO.md` lines (F116 replaced at merge; F124; F125; the Turbopack worktree build flake — now with the improved recipe: *a scratch copy outside `~/git/presby-platform/` builds clean in 16 s, *one clean build observed, which is consistent with — not proof of — the flake being specific to a copy that shares a `turbopack.root` with sibling worktrees*; the statistics-toast polish line); and the `CLAUDE.md` line under **Verify in a Browser**: "A form must not be operable before it hydrates — `HydrationGate` on every `useForm` root (DECISION-159); pre-hydration behaviour is tested by holding the JS chunks, never by racing a throttle."

**Added by tech-lead:**
- **`CLAUDE.md` → Common Commands:** add `npm run check:hydration-gate # Tripwire: every useForm root renders <HydrationGate> (DECISION-159)` and `npm run test:e2e:prod # Hydration specs against next build && next start on port 3800 (PW_PROD_BUILD=1)`; change "All five tripwires in sequence" to "All six".
- **`docs/product/functionality-map.md`:** in the **Design system** bullet add "shared `HydrationGate` + `useHydrated` (`src/components/shared/`, DECISION-159): every react-hook-form form root is inoperable until hydrated"; in the **Dev-loop tooling** bullet add "`check:hydration-gate`" to the tripwire list and "the `PW_PROD_BUILD=1` production-build e2e lane (`test:e2e:prod`, hydration specs only)". No new surface or user verb, so no portal/IA line.
- **Findings:** **F126** — `waitForLoadState("networkidle")` remains as a hydration mask in `e2e/filings-round-trip.spec.ts` (11 lines) and in the read-only/denied cases of `presbytery-oversight`/`presbytery-credentials`; convert opportunistically. **F127** — `.claude/skills/pre-push/SKILL.md` runs only 3 of the 5 (soon 6) tripwires (`check:deps-drift` and `check:brand-scope` are CI-only); replace the per-tripwire steps with `npm run check`.
- **`docs/TODO.md`:** `- [ ] **F126** — remove the remaining networkidle hydration masks (filings-round-trip ×11; read-only cases in presbytery-oversight/credentials). — docs/work-log/2026-09-28-select-hydration-revert.md Phase 3`; `- [ ] **F127** — pre-push skill runs 3 of 6 tripwires; replace with npm run check. — same work-log, Phase 3`; `- [ ] **e2e.yml budget** — revisit the 40-minute job / 15-minute prod-lane step budgets at the first real run (NEON_API_KEY has never been set). — same work-log, Phase 3`.

## Handoff

Next: **full-stack-developer (Phase 4)**, slices 1–4 above. Phase 5 (qa) must run, not cite: `npm run typecheck`, `npm test`, `npm run lint`, `npm run check` (six tripwires, with the flip-test re-done), the dev-lane `e2e/hydration` and the three edited presbytery specs plus `statistics-submit` and `filings-round-trip` on port 3700, the **production lane from the scratch copy** (§7), the **negative control in both lanes** (red at the pre-release `toBeDisabled()` on `b91bc95`'s `statistics-form.tsx`, green on the fix), the 360px disabled-then-enabled check on the 18 routes, and QA's throttled realism run (Phase 1's scenario, expecting 0/10 reversions, recording how long the form stays disabled).

---

# Phase 4 — Implementation

**Date:** 2026-10-05 | **Implementer:** full-stack-developer | **Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-select` (`pipeline/select-hydration`, base `b91bc95`). Nothing committed, pushed or stashed. No schema change, no `db:push`, no `src/lib` change, no new dependency. Environment confirmed before any DB command: `env | grep DATABASE_URL` empty; `.env.local` resolves to Neon branch `br-broad-haze-axdhzmif` (`select current_setting('neon.branch_id', true)`).

## Files Created

Slice 1 (primitive):
- `src/components/shared/use-hydrated.ts` — `useSyncExternalStore(subscribe, () => true, () => false)`, module-level `subscribe`.
- `src/components/shared/hydration-gate.tsx` — `<fieldset disabled={!hydrated} aria-busy data-slot="hydration-gate" className="m-0 min-w-0 border-0 p-0">`; props exactly `children` and `className`; no legend, no `disabled` override.
- `src/components/shared/use-hydrated.test.tsx` (3 tests), `src/components/shared/hydration-gate.test.tsx` (10 tests) — see Unit tests below.

Slice 3 (tripwire):
- `scripts/check-hydration-gate.mjs`, `scripts/check-hydration-gate.test.mjs` (16 fixture tests).

Slice 4 (lane, spec):
- `e2e/hydration/statistics-congregation.spec.ts` — three tests (see Deviations for one change).
- `e2e/support/statistics-fixture.ts` — `removeCongregationStatistics` extracted verbatim from `presbytery-reports.spec.ts`, plus the assert-and-throw guard (organization ids must be `e2e00000-` UUIDs, year within 2090-2099; message prefix `[statistics-fixture]`).

## Files Modified

Slice 2 (apply to the 18 roots; `<form>` wrapped from the outside, re-indent only: `git diff -w` shows exactly +3 lines per file, import, open, close):
- The 17 `<form>` roots: `record-appointment-form`, `record-ordination-form`, `edit-event-form`, `extend-series-form`, `new-event-form`, `add-group-member-form`, `edit-group-form`, `new-group-form`, `edit-person-form`, `record-roll-action-form` (inner `<form>` only), `add-officer-term-form`, `oversight/[aboutOrgId]/edit-form`, `per-capita-rate-form`, `record-payment-form`, `statistics-form`, `add-staff-position-form` (one wrap covers both `useForm` instances), `(statistics-submit)/file-statistics/statistics-submit-form`.
- `members/new/member-wizard.tsx` — root `<div className="space-y-6">` wrapped (no `<form>` tag).
- 16 select class strings gained ` disabled:cursor-not-allowed disabled:opacity-50`: 15 `SELECT_CLASSES` constants (13 in the roots, `household-step.tsx` and `roll-action-step.tsx` in the wizard) and the inline `#attested-role` string in `statistics-submit-form.tsx`. The non-RHF `SELECT_CLASSES` files were not touched (F125).
- Wiring tests, one each: `statistics-form.test.tsx`, `statistics-submit-form.test.tsx`, `member-wizard.test.tsx` (`renderToString` contains `<fieldset disabled=""` and `aria-busy="true"`).

Slice 3: `package.json` (`check:hydration-gate`; appended to `check`, now six tripwires), `.claude/skills/pre-push/SKILL.md` (Step 3f).

Slice 4: `playwright.config.ts` (`PW_PROD_BUILD` lane), `e2e/support/global-setup.ts` (`assertProductionServer`, exported; sign-in failure hint is lane-aware), `package.json` (`test:e2e:prod`), `.gitignore` (`/test-results-prod/`), `.github/workflows/e2e.yml` (prod step, `timeout-minutes` 30 to 40, upload both trace dirs), `e2e/presbytery-reports.spec.ts` (imports the shared helper; header comment updated; 10 `networkidle` lines removed, `grep -c networkidle` = 0), `e2e/presbytery-oversight.spec.ts` (lines 71 and 182 to `#oversight-viability` enabled), `e2e/presbytery-credentials.spec.ts` (lines 82, 119, 262 to `#ordination-person` / `#appointment-person` / `#ordination-person` enabled), `docs/ui-standards.md` (Forms rule, Native select `disabled:` sentence and the controlled-select hazard paragraph, checklist line; the example `className` gained the two utilities), `docs/testing.md` (new "Pre-hydration specs and the production-build lane" section with the scratch-copy recipe, one CI sentence).

## Schema Changes

- None. No migration, no `drizzle/meta/_journal.json` entry, no `scripts/test-rls.sql` / `seed-dev.sql` / `domain/index.ts` edit. `npm run db:push` was never run.
- Off-limits shared files untouched: `CLAUDE.md`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/product/functionality-map.md`, `docs/schema-design-2.md`.

## Audit Events

- None. No mutation was added (`check:audit` green).

## The tripwire — exact behaviour

`npm run check:hydration-gate` (`scripts/check-hydration-gate.mjs`; pure `checkHydrationGate(files)` exported). For every non-test `.ts`/`.tsx` under `src/`:
- **H1**: a non-comment line matching `(?<![A-Za-z0-9_$])useForm\s*[<(]` requires, in the same file, a non-comment line importing from `@/components/shared/hydration-gate` AND a non-comment `<HydrationGate` element; otherwise a violation at the first (each non-exempt) call line, naming the missing half.
- **H2**: a `.ts` (non-`.tsx`) file with a non-exempt `useForm` call always fails.
- **Exemption**: `// hydration-gate-ok: <reason>` on the same line or the line directly above the call; the reason is mandatory (an empty reason is itself a violation). A file passes if every call is exempt or the gate import and element are present. No file is exempt today.
- `useFormState` / `useFormStatus` / `useFormContext` and comment-only lines do not match; `*.test.ts(x)` are ignored.
- Flip-tests recorded: (1) a scratch `src/components/shared/zz-scratch-ungated.tsx` calling `useForm()` made it exit 1 with `[H1] src/components/shared/zz-scratch-ungated.tsx:2 ... lacks the import from @/components/shared/hydration-gate and a <HydrationGate> element`; deleted afterwards. (2) With `<HydrationGate>` swapped for `<div>` in `groups/edit-group-form.tsx` (import left in place) it exited 1 with `[H1] src/app/(org)/o/[slug]/admin/groups/edit-group-form.tsx:40`; restored from a backup, `Hydration-gate check passed.`, exit 0.

## The production lane — scripts and guards

- `npm run test:e2e:prod` = `PW_PROD_BUILD=1 playwright test --project=prod-build`. `PW_PROD_PORT` overrides the port (default 3800; 3000 and anything outside 1024-65535 throw).
- `webServer`: `npm run build && npm run start -- --port <P>`, `reuseExistingServer: false` always, `timeout: 600_000`, stdout/stderr piped, `env: { RATE_LIMIT_DISABLED: "true", AUTH_URL: <own origin> }`. One project, `prod-build`, `testMatch: /hydration\/.*\.spec\.ts$/`. Default mode is unchanged (`chromium` + optional `visual`) and `chromium` still runs `e2e/hydration/`.
- Guards (four layers): `reuseExistingServer: false`; the lane throws on `E2E_BASE_URL` (verified: `PW_PROD_BUILD=1 E2E_BASE_URL=http://localhost:3700 playwright test --list` throws "unset E2E_BASE_URL") and on `PW_VISUAL=1`; `baseURL` is a constant; `assertProductionServer(baseURL)` in `globalSetup` fingerprints `/signin`. **Positive side proven**: pointing `assertProductionServer` at the dev server on 3700 threw `PW_PROD_BUILD=1 but the server at http://localhost:3700 is a DEV server (its /signin HTML references the Turbopack HMR client)`; the dev HTML does contain `hmr-client_hmr-client_ts_*.js`, so the marker is real and was not changed.

## Commands run (all from the worktree unless noted) and results

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (no output) |
| `npm run lint` | PASS (`--max-warnings=0`; one `react-hooks/refs` error in my own test harness found and fixed on the way) |
| `npm run check` | PASS, six tripwires: audit-coverage, sql-date, deps-drift, brand-scope, secrets, hydration-gate |
| `npm test` | 263 files passed, 34 skipped (DB-backed, env-gated); **3410 tests passed, 897 skipped, 0 failed** (the earlier run after slices 1-2 showed 3394 passed; the +16 is the 16 tripwire fixture tests) |
| `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism` | **297 files passed, 4307 tests passed, 0 failed, 0 skipped** (Neon `pipeline-select-hydration`) |
| `npx vitest run src/components/shared/use-hydrated.test.tsx src/components/shared/hydration-gate.test.tsx` | 2 files, 13 tests passed |
| `npx vitest run scripts/check-hydration-gate.test.mjs` | 16 tests passed |
| Dev lane, `E2E_BASE_URL=http://localhost:3700 npx playwright test e2e/hydration` | 3 passed (10.1 s) |
| Dev lane, `e2e/hydration` + `presbytery-reports` + `presbytery-oversight` + `presbytery-credentials` | **26 passed**, 0 failed, 0 skipped (1.0 min) |
| Production lane, scratch copy, `npm run test:e2e:prod` (build 1st attempt, no flake) | **3 passed** (25.1 s); re-run after the negative control, 3 passed (15.3 s) |
| Full `E2E_BASE_URL=http://localhost:3700 npx playwright test` (dev server on 3700, `RATE_LIMIT_DISABLED=true`) | **167 passed, 0 failed, 0 skipped, 0 flaky** (3.5 min) |

Dev server: started `npx next dev --port 3700` backgrounded to `$SCRATCHPAD/dev3700.log` with a pidfile, stopped by PID; `lsof` on 3700 and 3800 afterwards empty. Scratch copy `/private/tmp/presby-select-prod` (rsync + `cp -al node_modules`, 16.8 s) was deleted when done.

## Unit tests — what they prove

`use-hydrated.test.tsx`: (1) server render is `false`; (2) a client-only `render()` renders `[true]` only; (3) `hydrateRoot` over server HTML renders `false` then `true`, with no `console.error` (no hydration mismatch).

`hydration-gate.test.tsx`: markup (disabled, `aria-busy="true"`, `data-slot`, reset classes, no `<legend`, `className` merged); enabled after `hydrateRoot` with no `aria-busy` and no mismatch; client-only render enabled immediately. RHF harness (select, text, number, checkbox, two radios, submit): (a) all 7 controls `:disabled` in the server HTML; (b) after hydration an untouched `requestSubmit()` delivers exactly the defaults, so the checkbox and radio defaults survive hydrating while disabled; (c) edited select/text/radio submit the complete edited values; (d) `form.reset({...})` after success repopulates the DOM and the next submit; (e) a client-only render of the gated form is operable immediately. Characterisation twin (the unit-lane negative control): the same harness WITHOUT the gate, SSR'd, with `select.value = "b"` and the text edited before `hydrateRoot`, ends at `"a"` and `"stored"` (F116/F122 in jsdom; the comment says to re-read DECISION-159 before deleting it).

## Failing-first evidence for the e2e regression

The new spec, with `statistics-form.tsx` reverted to `git show b91bc95:...` (and every other file as fixed):

Dev lane (reverted in the worktree for one run, restored from a backup; the fixed file's `HydrationGate` occurrences (3) were confirmed afterwards): 3 failed. Test 1, before I reordered the assertions, failed at the `fieldset[data-slot="hydration-gate"][aria-busy="true"]` count (`Expected: 1  Received: 0`); tests 2 and 3 failed at the first `toBeDisabled()` (`Expected: disabled  Received: enabled`).

Production lane (scratch copy only; `statistics-form.tsx` overwritten with the `b91bc95` version, then rebuilt and run):

```
  ✘  1 [prod-build] › e2e/hydration/statistics-congregation.spec.ts:85:7 › ... a congregation picked before hydration is impossible; the one picked after is the one persisted (6.4s)
  ✘  2 [prod-build] › e2e/hydration/statistics-congregation.spec.ts:144:7 › ... a Submit before hydration is inert (F123) (6.3s)
  ✘  3 [prod-build] › e2e/hydration/statistics-congregation.spec.ts:172:7 › ... [360px] the gate is visible and releases at mobile width (6.2s)
    Error: expect(locator).toBeDisabled() failed
    Expected: disabled
    Received: enabled
    (identical for all three tests)
```

Restoring the fixed file in the scratch copy: 3 passed. After the assertion reorder (see below) the dev lane was re-run green (26 passed above); the production lane's red/green pair was run on the final spec.

## Deviations from Phase 3 (none changes a ruling)

1. **`toHaveCount(1)` scoped to the select's gate.** Phase 3 asserted `fieldset[data-slot="hydration-gate"][aria-busy="true"]` has count 1. The reports page holds two gated forms before records exist (statistics and per-capita rate), so the unscoped count is 2 (first dev run: `Expected 1, Received 2`). The locator now uses `{ has: select }`, which keeps the intent (the select's own gate is busy). I also moved it after the three `toBeDisabled()` lines so that the first assertion to fail without the gate is the `toBeDisabled()` Phase 3 described.
2. **Phase 3's `presbytery-reports` line numbers were from before the helper extraction** (the extraction removes 29 lines); I applied the table by position and verified each context before editing. Results are identical to the table.
3. **Hydration test sequence.** In dev-mode jsdom React renders the hydration pass twice (`[false, false, true]` was observed), so `use-hydrated.test.tsx` asserts the sequence of distinct values is `[false, true]` and that the first render is `false`; Phase 3 wrote `[false, true]` literally. The semantics (false then true, never true first) are unchanged.
4. **`hydration-gate.test.tsx` uses `matches(":disabled")`** for "enabled" checks rather than `toBeEnabled()`: no jest-dom matchers are registered in this repo's vitest setup.

No other deviation. No existing unit test needed a change (Phase 3 predicted none; none failed).

## Implementer Notes

- **Server log noise in the production lane:** `Error: The destination stream closed early` (digest `1064821659`) appears in the `next start` output while the specs run. It is the server noticing the browser context closing while a response was still streaming (the held-chunk tests close the context mid-load by design); no test is affected. Phase 5 may want to confirm that reading; it never appeared in the dev lane.
- **`next build` rewrites the gitignored `next-env.d.ts`** (scratch copy only here) — not a repo change.
- **Realism run (optional, not done):** the Phase 1 throttling harness was not at hand, so no 10-trial CPU x4 + slow-3G run and no "how long the form stays disabled" measurement is recorded; that stays QA's Phase 5 job. The held-chunk spec shows the disabled-until-enabled sequence deterministically (about 1.3 s per test including page load, release and a select).
- **Checkbox/radio invariant** (a checkbox or radio registered under a gate has a defined default and no `defaultChecked`) is written into `docs/ui-standards.md`; the unit test (b) is its guard.
- **Phase 5 must still do the 360px visual pass on the 18 routes** (sticky Submit bar in `statistics-submit-form`, wizard step indicator); only the statistics form has a repeatable 360px spec.
- **State left behind:** worktree changes uncommitted (see `git status --short`); Neon branch `pipeline-select-hydration` carries only e2e fixture rows (`congregation_statistics` for 2096 removed by the spec, 2095 by `presbytery-reports`); `e2e/support/.auth/` has fresh sessions from the dev lane; `test-results/` and `test-results-prod/` are gitignored; no server listening on 3700 or 3800; scratch copy deleted; scratchpad holds the lane logs.

## Proposed for the orchestrator at integration (carried forward, nothing written to a shared file)

- **From Phase 2 (unchanged):** DECISION-159 text; F121-F125; the `docs/TODO.md` lines (replace the F116 line at merge; F124; F125; the Turbopack worktree build flake with the improved recipe; the statistics-toast polish line); the `CLAUDE.md` line under **Verify in a Browser**: "A form must not be operable before it hydrates — `HydrationGate` on every `useForm` root (DECISION-159); pre-hydration behaviour is tested by holding the JS chunks, never by racing a throttle."
- **From Phase 3 (unchanged):** the DECISION-159 amendment ("Implementation specifics", items 1-4, including the checkbox/radio invariant); `CLAUDE.md` Common Commands (`check:hydration-gate`, `test:e2e:prod`, "All six" tripwires); `docs/product/functionality-map.md` Design-system and Dev-loop tooling bullets; F126 (remaining `networkidle` masks); F127 (pre-push skill runs 3 of 6 tripwires); the TODO lines for F126, F127 and the `e2e.yml` budget revisit.
- **Added by full-stack-developer:**
  - The amendment's lane sentence can add: "the lane's `globalSetup` guard `assertProductionServer` fingerprints `/signin` for the Turbopack HMR client (proven against a dev server)".
  - **Finding F128** — in the production lane, `next start` logs `The destination stream closed early` when a held-chunk spec closes its context mid-stream; harmless, but worth a QA read and a possible `stderr` filter if it ever hides a real error. TODO line: `- [ ] **F128** — prod-lane server log shows "destination stream closed early" at context close (held-chunk specs); confirm harmless in Phase 5, consider filtering. — docs/work-log/2026-09-28-select-hydration-revert.md Phase 4`.
  - **Finding F129** — `GenerateRecordsButton` (a plain `onClick`) is enabled before hydration and its pre-hydration click is silently lost; `presbytery-reports` case 3 waits on the per-capita rate form's gate as the nearest honest signal (same page, same hydration pass; the case is green in both runs). Tracked with F124's triage. TODO line: `- [ ] **F129** — GenerateRecordsButton (and other plain onClick buttons) are operable before hydration and lose a pre-hydration click silently; fold into the F124 triage. — same work-log, Phase 4`.
  - Release-notes line after Phase 6 SHIP IT is unchanged from Phase 3.

## Handoff

Next: **qa (Phase 5)**. Run, do not cite: `npm run typecheck`, `npm run lint`, `npm run check` (redo the flip-test), `npm test`, the DB-backed suite, the dev-lane `e2e/hydration` and the three edited presbytery specs plus `statistics-submit` and `filings-round-trip` (already part of my full 167-test run, green), the production lane from a fresh scratch copy, the negative control in both lanes, the 360px pass on the 18 routes, and the throttled realism run (expect 0/10 reversions; record how long the form stays disabled).

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-05
**Verified by:** qa

*Recorded verbatim by the orchestrator, 2026-10-05.*

Everything below was run by QA in `/Users/cshenso/git/presby-platform/presby-wt-select` (branch `pipeline/select-hydration`, HEAD `b91bc95`, 43 uncommitted entries). Before any DB command `env | grep DATABASE_URL` was empty, and `.env.local` resolves to `br-broad-haze-axdhzmif` (checked with `select current_setting('neon.branch_id', true)`). `RATE_LIMIT_DISABLED=true` is present. There is no schema change, so `scripts/test-rls.sql` is not required and was not run.

## Type Check

`npm run typecheck`: **PASS** (exit 0, no output).
`npm run lint` (`--max-warnings=0`): **PASS**.
`npm run check`: **PASS, six tripwires.** In order: audit-coverage, sql-date, deps-drift, brand-scope, secrets, **hydration-gate** ("Hydration-gate check passed.").

**Tripwire proof:**
- A scratch file `src/zz-qa-ungated.tsx` calling `useForm<…>(` with no gate: `npm run check:hydration-gate` exited **1** with `[H1] src/zz-qa-ungated.tsx:4 … lacks the import from @/components/shared/hydration-gate and a <HydrationGate> element`.
- The exemption works: `// hydration-gate-ok: <reason>` on the line above → exit 0; the same comment on the same line → exit 0; `// hydration-gate-ok:` with no reason → exit 1, "needs a reason after the colon".
- After deleting the file, the real tree exits 0 and `git status --short` is identical to the starting snapshot.

## Unit Tests

| Suite | Files | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `npm test` | 263 passed, 34 skipped (DB-gated) | **3410** | 0 | 897 (the DB-gated tests, all run in the next row) | 14.0 s |
| `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism` | 297 passed | **4307** | 0 | **0** | 377 s |
| New and wiring tests, run on their own: `use-hydrated` (3), `hydration-gate` (10), `check-hydration-gate` (16), and the three wiring files | 6 | 64 | 0 | 0 | — |

Both totals match Phase 4 exactly. The DB-backed suite ran with zero skips.

**Blast radius:** the diffs to the three existing test files are additions only (one `renderToString` wiring test each, no `-` lines). No existing unit test in the 18 roots was changed, and all are green. Checked with `git diff -w --numstat`, each of the 18 roots is exactly +3 (import, open, close), plus a +1/−1 class-string line where it has a select. The step files `household-step.tsx` and `roll-action-step.tsx` have the class line only.

## End-to-End Tests

**Default lane** (dev server `next dev --port 3700`, backgrounded, stopped by PID):

| Run | Total | Passed | Failed | Skipped/Flaky | Duration |
|---|---|---|---|---|---|
| `e2e/hydration` + `presbytery-reports` + `presbytery-oversight` + `presbytery-credentials` | 26 | 26 | 0 | 0 / 0 | 58.9 s |
| **Full `npm run test:e2e`** (`E2E_BASE_URL=http://localhost:3700`) | **167** | **167** | 0 | **0 / 0** | 3.3 min |

The full run includes `statistics-submit` (7), `filings-round-trip` (12), `hydration/statistics-congregation` (3), `presbytery-reports` (10), `presbytery-oversight` (6) and `presbytery-credentials` (7). Phase 4's 167/0/0 is reproduced exactly. `grep -c networkidle` gives 0 in `presbytery-reports`. The 5 left in `presbytery-oversight` and 4 in `presbytery-credentials` are the read-only cases that are out of scope (F126).

**Production lane** (`PW_PROD_BUILD=1 npm run test:e2e:prod`), run from a fresh hardlinked scratch copy (`rsync` + `cp -al node_modules`, 17.9 s, same APFS Data volume) under the session scratchpad, outside `~/git/presby-platform/`, deleted afterwards. The build succeeded on the first attempt with no Turbopack font flake ("Compiled successfully in 4.3s").
- Fixed code: **3 passed, 0 failed, 0 skipped (24.7 s).**
- Re-run after the negative control: 3 passed (15.2 s).

**Lane guard, all four layers confirmed:**
- `PW_PROD_BUILD=1 E2E_BASE_URL=http://localhost:3700 playwright test --list` throws "…unset E2E_BASE_URL (an external, i.e. dev, server must never satisfy this lane)".
- `PW_VISUAL=1` throws "mutually exclusive".
- `PW_PROD_PORT=3000` throws.
- `assertProductionServer("http://localhost:3700")` against the live dev server throws "…is a DEV server (its /signin HTML references the Turbopack HMR client)".
- The prod server's `/signin` has 0 `hmr-client` matches.
- `reuseExistingServer: false` was read in the config; not exercised, because the lane needs nothing bound to 3800.

**Negative control, performed by QA in the prod lane.** In the scratch copy, `git show b91bc95:"src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx"` (0 `HydrationGate` occurrences) overwrote the file, then rebuild and run:
```
✘ 1 [prod-build] statistics-congregation.spec.ts:85:7  … picked before hydration is impossible …  (6.5s)
✘ 2 [prod-build] statistics-congregation.spec.ts:144:7 … a Submit before hydration is inert (F123) (6.3s)
✘ 3 [prod-build] statistics-congregation.spec.ts:172:7 … [360px] the gate is visible …            (6.3s)
Error: expect(locator).toBeDisabled() failed — Expected: disabled — Received: enabled
  > 100 | await expect(select).toBeDisabled();        (test 1)
  > 155 | await expect(submit).toBeDisabled();        (test 2)
  > 183 | await expect(select).toBeDisabled();        (test 3)
3 failed
```
Each test fails at its **first** pre-release `toBeDisabled()`. After restoring the worktree's file (`cmp` identical): **3 passed**.

The dev-lane red/green pair was not repeated by QA (it would mean overwriting a tracked file in the worktree). Phase 4 recorded it, and Phase 2 named the production lane as the real gate.

**Realism check (Phase 2 Ruling 3).** Phase 1's harness rebuilt as a scratch Playwright script against the fixed production build on 3800 (`next start` from the scratch copy): CDP `Emulation.setCPUThrottlingRate` ×4 plus `Network.emulateNetworkConditions` at 500 kbps / 400 ms latency; each trial navigates with `waitUntil:"commit"`, tries `selectOption(<non-default>)` the moment `#stats-congregation` attaches, then picks at the earliest moment the browser allows, polls the value every 200 ms for 5 s (Phase 1's revert probe), fills a field, submits, waits for the toast; the persisted row is checked by SQL, then removed with the guarded `removeCongregationStatistics` helper (Phase 1's disable-trigger/delete/enable pattern). Targets alternated alpha/beta; the default is gamma (Halloway); report year 2097.

| Trial | Target | Pre-hydration pick | Reverted? | Persisted congregation correct? | Disabled after DOMContentLoaded (ms) |
|---|---|---|---|---|---|
| 1 | e2e-alpha | refused (disabled) | no | yes (alpha) | 7174 |
| 2 | e2e-beta | refused | no | yes (beta) | 7202 |
| 3 | e2e-alpha | refused | no | yes | 7216 |
| 4 | e2e-beta | refused | no | yes | 7187 |
| 5 | e2e-alpha | refused | no | yes | 7190 |
| 6 | e2e-beta | refused | no | yes | 7184 |
| 7 | e2e-alpha | refused | no | yes | 7182 |
| 8 | e2e-beta | refused | no | yes | 7197 |
| 9 | e2e-alpha | refused | no | yes | 7199 |
| 10 | e2e-beta | refused | no | yes | 7191 |

**0/10 silent reversions and 0/10 wrong-congregation saves.** Phase 1 saw 10/10 reversions on the same profile. The select was `:disabled` the moment it attached in every trial. After the run: 0 residual `congregation_statistics` rows for 2096–2098, `congregation_statistics_freeze` reads `O`, and `org_portal.reports` is restored to its captured value.

Where the disabled time goes (3 runs per profile on the same page):

| Profile | Disabled after DOMContentLoaded |
|---|---|
| Unthrottled | 51–57 ms |
| CPU ×4 only | ~203 ms |
| Slow-3G only | ~7150 ms |
| Both | ~7180 ms |

The page loads 16 JS chunks, 248 KiB on the wire. The window is almost entirely the JS download.

**Verify in a Browser, 360px** (production build, chunks held with `page.route`, then released):

| Form | Gate pre → post | Gate opacity | Label/hint min effective opacity · min contrast | Controls dimmed pre | Select bbox pre/post | Submit bbox pre/post | Horizontal scroll |
|---|---|---|---|---|---|---|---|
| Reports `statistics-form` (branded `(org)`; `e2e-presbytery` has an `organization_brands` row) | disabled+busy → enabled, no aria-busy | 1 | 1.0 · 20.72:1 | 21/21 disabled; inputs/selects at 0.50 | identical | identical | none |
| Oversight `edit-form` (branded `(org)`) | same | 1 | 1.0 · 20.72:1 | 8/8 | identical | **y 963→965 (2 px)** | none |
| Public `statistics-submit-form` (platform palette, throwaway grant) | same | 1 | 1.0 · 8.01:1 | 63/63 | identical | identical; sticky Submit bar in viewport (top 676 / 800) | none |

Findings from the 360px pass:
- The disabled state dims **controls only**. Labels and hint text stay at full opacity, above the 7:1 floor. The `Button` primitive's disabled state is the `bg-muted` grey.
- **The 2 px shift on the oversight form is not caused by the gate.** It is the `field-sizing-content` textarea `#oversight-buildings` growing from 64 to 66 px when RHF writes its stored value at hydration. Toggling the gate's `disabled` after hydration moves nothing (submit y 965 → 965).
- **Pre-existing, made visible by the gate:** before hydration, the edit forms render **empty** controls (the oversight form's stored "3 — Healthy", buildings note and insurance carrier; the statistics form's Year). The values appear only when RHF writes `defaultValues` at hydration. This is F122's mechanism, not a regression. Before the fix those blank fields were *editable* and then overwritten; now they are visibly disabled. But on slow-3G a clerk sees a blank, dimmed edit form for about 7 s.
- No-JS sweep at 360px of the 3 presbytery routes (reports, credentials, oversight): 6 forms, every one inside a disabled, `aria-busy` gate with no `<legend>`, and 0 controls enabled before hydration.
- The congregation-side roots (members/groups/events/officers/staff) render no forms for the e2e fixture users on this branch, because their module flags/permissions are off. Those roots are covered by the tripwire, the member-wizard SSR wiring test and the full e2e run; not inspected in a browser.

**F128, reproduced and re-characterised.** `⨯ Error: The destination stream closed early.` (digest `2795983462`) appeared 3 times in each green prod-lane run, **0 times in the negative-control run**, and exactly 2 times per realism trial. Each of those trials had in-flight `?_rsc=` prefetch requests at context close (`…/reports?year=2097&_rsc=…` and `…/reports?billingYear=2025&_rsc=…`). The cause is Next's post-hydration RSC **link prefetch** streams being aborted when the browser context closes; it is not the context closing while chunks are held (in the negative-control run no JS ran and the line never appeared). **Harmless**: a real user navigating away mid-prefetch produces the same thing, and no response the test depends on is involved. Recommendations: correct F128's wording to "aborted post-hydration RSC prefetch at context close"; do **not** add a stderr filter, which could hide a real server error in the lane.

**Accessibility cost vs Ruling 1.** Ruling 1 estimated "about 1–3 s" disabled on a slow phone. On Phase 1's own profile it measures **about 7.2 s**, set by the 248 KiB JS download; CPU ×4 alone costs only about 0.2 s. The acceptance reasoning still holds: in the same 7.2 s window before the fix, the form *looked* operable and anything done in it was silently lost, which is how F116 wrote the wrong congregation. A visibly disabled control is the honest version of a window that already existed; the gate adds no time, only visibility. What does change is the cost sentence in DECISION-159: "a moment" should read "up to several seconds on a slow connection (≈7 s measured on 500 kbps / 400 ms)". With no spinner and no copy (per the ruling), the analyst should judge whether a blank-and-dimmed edit form for about 7 s needs a follow-up (a busy hint, or rendering stored values into the server HTML). Not a FAIL: Ruling 1 accepted the cost by its nature, not by its duration.

## Regression Tests Added

- `a congregation picked before hydration is impossible; the one picked after is the one persisted` — `e2e/hydration/statistics-congregation.spec.ts:85` — guards against F116. Fails at `:100` without the gate (confirmed in the prod lane). Asserts the **persisted** `about_org_id` (`:128-137`).
- `a Submit before hydration is inert (F123)` — `e2e/hydration/statistics-congregation.spec.ts:144` — guards against a native GET pre-hydration submit leaking fields into the URL. Red at `:155` without the gate.
- `[360px] the gate is visible and releases at mobile width` — `e2e/hydration/statistics-congregation.spec.ts:172`. Red at `:183` without the gate.
- `WITHOUT the gate a pre-hydration pick and edit are overwritten (F116/F122 in jsdom)` — `src/components/shared/hydration-gate.test.tsx:218` — the unit-lane characterisation twin.
- `submits the complete defaults, untouched, once enabled (checkbox/radio defaults survive)` — `hydration-gate.test.tsx:140` — guards the checkbox/radio invariant.
- The edited-values (`:157`) and `form.reset(...)` (`:181`) tests, and `every control is :disabled in the server HTML` (`:133`).
- `use-hydrated.test.tsx:29/34/40` — the server render is false, a client-only render is true, and hydration goes false→true with no mismatch.
- Three SSR wiring tests: `statistics-form.test.tsx`, `statistics-submit-form.test.tsx`, `member-wizard.test.tsx`.
- 16 fixture tests in `scripts/check-hydration-gate.test.mjs`. The tripwire's flip behaviour was re-proved live above.

Failing-first: confirmed independently by QA for the e2e regression in the production lane (red/green above).

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% statements / 100% branches
- `src/lib/two-factor.ts`: 91.3% statements (lines 35–39 uncovered; meets the 90% target)
- `src/lib/flags.ts`: 100%
- New: `src/components/shared/use-hydrated.ts` 100%, `src/components/shared/hydration-gate.tsx` 100%
- Overall `src/**` (include-all config): 53.59% statements. Unchanged by this diff, which adds no `src/lib` code.

## Feature-Gate Audit

The full diff (tracked and untracked) was read. No `route.ts`, `actions.ts`, `"use server"` body, `proxy.ts`, `src/lib/**`, `src/auth.ts`, `(auth)` or `api/` file was added or changed. The only `"use server"` string hits in changed files are in two test files, where the edits are additions only. Not auth-touching.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| **no protected routes touched** | n/a | n/a | n/a |

`check:brand-scope` passes. The only colour-related class edits are the `disabled:cursor-not-allowed disabled:opacity-50` additions. Every other `className` line in the diff is identical re-indentation. The gate adds no colour or token, and the `(org)` forms keep the brand (burgundy Save button) while the public form stays in the platform palette.

## Verdict

**PASS.** Every required check is green and QA ran each one: typecheck, lint, six tripwires; 3410 unit and 4307 DB-backed tests, 0 skips; 167/0/0 full e2e on the dev server; 3/3 production lane, with the negative control red at the first `toBeDisabled()` and green on restore; 0/10 reversions and 0/10 wrong saves under Phase 1's throttle; the 360px pass clean on gate-attributable shift and label contrast; no protected routes touched.

**Advisories for Phase 6** (none blocks):
1. The disabled window is about 7.2 s on Phase 1's profile, not "about 1–3 s". Correct the DECISION-159 cost sentence.
2. Edit forms render empty controls until hydration (pre-existing F122 behaviour, now visible as blank-and-dimmed). A follow-up candidate; the orchestrator assigns the number.
3. F128 is harmless, but its cause is aborted post-hydration RSC prefetches. Fix the wording and don't filter stderr.
4. The 2 px textarea growth on the oversight form at hydration comes from RHF's value write, not the gate.
5. The dev-lane negative control was not repeated (requires editing a tracked file). Phase 4 recorded it.

**Side effects on the pipeline Neon branch:** the throwaway grant issued for the public-form check was deleted along with its `email_queue` row (0 residual grants and emails); issuing it likely wrote one append-only `audit_events` row on the pipeline Neon branch, which is deleted at cleanup; both flags touched are restored to their captured values.

**Cleanup:** servers 3700 and 3800 stopped by PID, both ports free; `scratch/` and the scratch copy deleted; `git status --short` identical to Phase 4's 43 entries; tracked-diff hash (`561c4eb2…`) and untracked-content hash (`18718cc3…`) unchanged before and after; HEAD `b91bc95`; nothing committed, pushed or stashed.

### Per-Phase Status row

| 5 — Verification | qa | Complete — ran myself: typecheck/lint/six tripwires (hydration-gate flip-tested: ungated file exit 1, exemption both forms, empty reason exit 1); `npm test` 3410 passed / 0 failed; DB suite 4307 passed / 0 skipped; dev lane 26/26 and full e2e 167/0/0; production lane 3/3 from a hardlinked scratch copy, negative control red at the first `toBeDisabled()` (`:100`, `:155`, `:183`) on `b91bc95`'s form and green on restore; lane guards proven (E2E_BASE_URL, PW_VISUAL, port 3000, `assertProductionServer` vs dev server); realism 0/10 reversions, 10/10 correct persistence under CPU×4 + slow-3G, disabled ≈7.2 s after DOMContentLoaded (JS download); 360px controls-only dimming, labels ≥8:1, no gate-caused shift; no protected routes touched; F128 harmless (aborted RSC prefetch) | PASS | 2026-10-05 |

### Handoff

Next is **analyst (Phase 6)**. Weigh advisories 1 and 2 against Phase 1's intent: the disabled window is longer than Ruling 1 estimated, and edit forms are blank until hydration. Carry the F128 wording correction to the orchestrator.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-05
**Reviewed by:** analyst

*Recorded verbatim by the orchestrator, 2026-10-05. Read-only walk in worktree `/Users/cshenso/git/presby-platform/presby-wt-select`; the analyst read the work-log in full plus the code, config, tripwire and doc edits, wrote nothing, ran no server or database, and re-ran no tests (QA and Phase 4 results are cited from the work-log).*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The shipped change closes the F116 hole on all 18 form roots. A form can no longer be touched before it hydrates, and the real production proof went from 10 of 10 silent reversions to 0 of 10. The price is a form that looks visibly dead for about 7 s on a slow-3G phone, and an edit form that shows blank fields during that time. That is acceptable for PSV go-live, because the same window already existed and silently ate input. It needs two tracked follow-ups, not rework.

## What's Working

- **Phase 1's defect is closed by construction.** `HydrationGate` renders `<fieldset disabled aria-busy>` until `useSyncExternalStore` reports the client snapshot. RHF's write-back in the hydration commit therefore has no user value to overwrite. A pre-hydration Submit also cannot do a native GET (F123), which closes a PII-in-URL leak on `edit-person-form`. A client-side navigation sees `true` on the first render, so there is no flash.
- **The proof is real, and it is the hard kind.** The persisted `about_org_id` is asserted in the database, not just on screen, in a production-build lane (port 3800). Its guards cover `E2E_BASE_URL`, `PW_VISUAL`, port 3000, and `assertProductionServer` fingerprinting `/signin` for the Turbopack HMR client (proven against a dev server). QA's negative control, run on `b91bc95`'s form, goes red at the first `toBeDisabled()` in all three tests and green on restore. Phase 1's own 10-trial profile (CPU ×4, 500 kbps, 400 ms) now gives 0/10 reversions and 10/10 correct persistence. The unit-lane characterisation twin keeps the bug demonstrable in jsdom.
- **Scope matches Ruling 2.** Wrapping the `<form>` from the outside is a +3-line `git diff -w` per file. `statistics-form` and `member-wizard` show import, open and close and nothing else; `statistics-form`'s early-return paths all precede the wrapped `return`, so nothing renders ungated. Selects gained `disabled:cursor-not-allowed disabled:opacity-50`, and the gate itself has no opacity, so labels stay at full contrast (QA measured ≥8:1 at 360px).
- **The tripwire is sound and documented where the next developer looks.** `check-hydration-gate` has six flip-tested behaviours and 16 fixture tests, and runs inside `npm run check`. H1: a `useForm` call needs both the gate import and a `<HydrationGate` element. H2: a `.ts` file calling `useForm` fails, which closes the "move the call into a hook" bypass. The exemption `// hydration-gate-ok: <reason>` is documented in `docs/ui-standards.md` (Forms, State Patterns) and in the checklist line, and the tripwire's own error message points back to it. It checks presence, not that the gate actually wraps the controls; the header says so, and the SSR wiring tests plus review cover the rest.
- **Docs.** `docs/testing.md` has a copy-pasteable lane recipe, including the worktree Turbopack workaround. `docs/ui-standards.md` also records the F121 controlled-select hazard, so nobody "fixes" this with `Controller` later.
- **Work-log header has no Source block.** F116 came from QA of the presbytery-e2e pipeline, not a feedback-table row. **Rule 12 is not applicable.**

## Intent-vs-Shipped Diff

- Phase 1 said: a clerk's pre-hydration pick must not be silently rewritten on the statistics form. Shipped: that pick is impossible, because the control is disabled. **Matches.**
- Phase 1 said: nine-plus other forms share the shape. Shipped: all 18 RHF roots are gated and a tripwire guards the 19th. **Matches, and exceeds** (it includes text and number fields, F122).
- Phase 1 said: the regression test must fail without the fix on a production build and needs a home. Shipped: `e2e/hydration/` plus the `PW_PROD_BUILD=1` lane, red-without and green-with proven by QA. **Matches.**
- Phase 1 said: show how long a realistic phone is affected. Ruling 1 estimated "about 1–3 s". Shipped: **≈7.2 s** on Phase 1's own profile. **Acceptable drift, with a doc correction** (below). The window is set almost entirely by the JS download: 248 KiB over 16 chunks. CPU ×4 alone adds only ≈0.2 s, and unthrottled it is 51–57 ms.
- Phase 1 said: edit forms show stored values. Shipped: they still render **empty controls until hydration**, now visibly dimmed. **Acceptable drift for go-live, with a follow-up (F130).** This is F122's mechanism, and the forms behaved this way before the gate.
- Phase 1 gap, submit-time confirmation naming the congregation: ruled out of scope by Phase 2, and **tracked** by the proposed statistics-toast TODO line.
- Phase 1 gap, the audit row recording intent vs outcome: ruled out of scope. Phase 2 says "tracked below", but **no TODO line for it was proposed anywhere in Phases 2–4**, so it was untracked. Proposed below.
- Phase 1 gaps on the test home and the Turbopack flake: both addressed, in the lane and the testing doc recipe and in a proposed TODO line.

**What the clerk sees, second by second** (QA's measurements: 500 kbps / 400 ms, CPU ×4, cold cache). **0 s:** the server HTML paints. **First paint to ≈7 s:** the whole form is visible but dead — controls dimmed to 50%, the select shows a not-allowed cursor, the Save button shows its disabled grey; labels and hints stay crisp; taps do nothing; there is no spinner and no text, the only signal is the dimming. On the statistics form the Year field is empty and the select shows the first congregation. On an edit form (oversight, edit-person) the stored rating, notes and carrier are blank, which can read as "this record has no data" — not a data-loss risk, because Submit is disabled and nothing can be saved blank. **≈7.2 s:** the JS has arrived, the gate releases, the stored values appear, everything enables; the only layout shift is 2 px on the oversight Submit button, traced by QA to RHF's textarea value write, not the gate. **A clerk who taps early is no longer harmed.** Before the fix, the same 7 s looked fully operable; a tap in that window set a congregation, and about 7 s later it silently became another one, with a success toast.

**Is that acceptable for PSV go-live?** Yes. The gate adds no time; it makes an existing window honest. Slow-3G with cold cache is the pessimistic case; typical connections are sub-second, and Next chunks cache after the first visit (an inference, not measured by QA). A blank, dimmed edit form is a cosmetic and confidence cost; the old behaviour was silent record corruption. Rework now would delay the go-live blocker for a cosmetic cost. It does need follow-up, because "dead for 7 s with no sign of why" is poor craft for an annual-statistics clerk on a church-hall phone.

## Edge Cases

- **Empty state:** pass for go-live. An empty list is unaffected. Blank edit forms during hydration are the one new perception, tracked as F130.
- **Failure microcopy:** pass. The gate adds no copy and none was removed; the generic error toast, the `{ ok: false }` mappings and "Saving…" are untouched. The Phase 4 diff touched only wrapper lines, the select classes and tests.
- **Permission gate:** pass, not touched. No `route.ts`, action, `proxy.ts` or `src/lib` change (QA's feature-gate audit); `statistics.manage` and `org_portal.reports` unchanged; no flag.
- **Audit event:** not applicable. No mutation was added and `check:audit` is green. The intent-vs-outcome gap is a tracked follow-up, not a regression.
- **Mobile (360px):** pass on the three forms inspected (`statistics-form`, oversight `edit-form`, public `statistics-submit-form`): controls-only dim, no horizontal scroll, identical bounding boxes except the 2 px above, sticky Submit bar intact; a no-JS sweep of the three presbytery routes found 6 forms, all gated, 0 controls enabled. **Caveat:** the congregation-side roots (members, groups, events, officers, staff) were not browser-inspected because their flags and permissions are off for the fixture users; their cover is the tripwire, the `member-wizard` SSR wiring test and the full e2e run. Tracked.
- **Not verified:** browser form-state restoration on reload or back into a gated form. Phase 3 flagged it as low risk. Tracked with the item above.

## Follow-Ups (SHIP WITH NOTES)

All applied to `docs/TODO.md` at integration by the orchestrator:

- **F130 — edit forms render empty controls until hydration**, now visibly blank-and-dimmed for the whole window (≈7 s on slow-3G). Pre-existing F122 behaviour (RHF writes `defaultValues` at hydration); the gate makes it visible. Fix options for the architect: server-render stored values (element `defaultValue`/`defaultChecked`, which interacts with the F122 rejection and the checkbox/radio invariant) or a visible "Loading…" cue inside `HydrationGate`. Affects oversight edit-form, edit-person, edit-group, edit-event, per-capita-rate and the statistics Year.
- **Reduce the first-load JS on form routes, or add a visible busy cue.** The disabled window is ≈7.2 s on 500 kbps / 400 ms, set almost entirely by 248 KiB (16 chunks) of JS on `/o/<slug>/admin/reports`; unthrottled ≈55 ms. Audit bundle size and route splitting; decide whether ≈7 s without a cue is acceptable at PSV volumes; measure repeat visits too.
- **Audit row for statistics entry records intent vs outcome** (Phase 1 gap, ruled out of scope and previously untracked). `CONGREGATION_STATISTICS_ENTERED` records only the submitted `aboutOrgId`, so a divergent save is forensically invisible. Low priority now that the hydration cause is closed; revisit with the submit-time confirmation line.
- **Browser-check the congregation-side gated roots at 360px when their flags are on** (members/new wizard, groups, events, officers, staff), and confirm browser back/reload form-state restoration into a gated form.
- Carried forward unchanged from Phases 2–4: the F116 line replaced with `[x]`; F124; F125; F126; F127; F129; the Turbopack worktree flake; the `e2e.yml` budget revisit; the statistics-toast line.

## Red Flags (if NEEDS REWORK)

None. No phase reopens.

## DECISION-159 cost-sentence correction (QA advisory 1, accepted)

> On a slow connection the form is visibly disabled until the page's JavaScript has downloaded and run: about 0.05 s on an unthrottled production build, about 0.2 s under a 4× CPU slowdown, and about 7 s on a 500 kbps / 400 ms link, where the 248 KiB download dominates (QA, 2026-10-05). The gate adds no time of its own: that window already existed, but the form looked operable while it lasted and silently discarded what was entered. A visible disabled control is honest and a silent revert is not, so the cost is accepted, with no spinner or copy; revisit with F130.

Ruling 1's "about 1–3 s" (Phase 2, recorded verbatim above) reads "about 7 s on the Phase 1 profile" per QA's measurement; the recorded text is left as written and corrected here.

## F128 wording correction

> **F128** — prod-lane `next start` logs `The destination stream closed early` when post-hydration RSC link prefetches (`?_rsc=`) are aborted at browser-context close. QA reproduced it 3 times in each green run and 0 times in the negative-control run, where no JS ran. It is harmless: a real user navigating away mid-prefetch does the same. Do not add a stderr filter, which could hide a real server error in the lane.

## What's-new ruling (Rule 13): No

A bug fix to admin forms whose only perceptible effect is a brief dimmed-form state on slow connections; a `whats_new_entries` post would draw attention to a cost F130 and the bundle line may soon soften. If PSV onboarding wants a sentence, it belongs in the onboarding guide: "If a form looks greyed-out for a few seconds on a slow connection, it is still loading. It will switch on by itself, and nothing you do before then is lost or changed."

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — the F116 hole is closed on all 18 roots with real production proof (0/10 reversions, negative control red/green, tripwire for the 19th, exemption documented in `ui-standards.md`); the ≈7.2 s visible-disabled window and blank-until-hydration edit forms are accepted for go-live with two follow-ups (F130 and the bundle/busy-cue line); the audit intent-vs-outcome gap was untracked and now has a line; no feedback row (Rule 12 N/A); what's-new: no | SHIP WITH NOTES | 2026-10-05 |

## Plain-English summary for the release note

When a clerk picked a congregation on the statistics form very quickly on a slow phone connection, the page could quietly swap their choice for a different congregation a few seconds later. The statistics were then saved against the wrong congregation, with a normal "saved" message and nothing to show it had happened. We reproduced this on the real production build and fixed it on every form that works this way, 18 in all. Forms now stay switched off, greyed out, until the page has fully loaded, so nothing can be picked, typed or submitted too early, and a new automatic check stops future forms from being added without the same protection. On a slow connection you may notice a form looks greyed-out for a few seconds (about 7 seconds on a very slow link, effectively instant on a normal one), and forms for editing an existing record may show empty fields until it finishes. This is the page still loading and nothing is lost. We are tracking improvements to shorten that wait and show the saved values sooner.

### Orchestrator note (2026-10-05, closing the pipeline)

SHIP WITH NOTES accepted. Integrated as **v0.30.0**: feature commit, merge of `origin/main` (v0.29.0), then the housekeeping commit applying DECISION-159 (with the cost correction and the Phase 3 implementation specifics), `docs/schema-design-2.md` §2o (F116, F121–F130), the `docs/TODO.md` reconciliation, `CLAUDE.md` (Common Commands: six tripwires, `check:hydration-gate`, `test:e2e:prod`; the Verify-in-a-Browser rule), the functionality map, and `docs/release-notes/v0.30.md`. The pipeline's Neon branch is deleted at cleanup. **F131 (found at integration):** the merged tree failed `src/lib/founding-administrator.test.ts`'s "eight paths unchanged" check, a pipeline-branch discipline test that diffs the working tree against `main` — this pipeline legitimately wrapped the member/staff forms. Retired with an explanatory comment (the behavioural guard is `test-rls.sql` §44); recorded in §2o.

---

