# Hold the create-organization form until it has hydrated (F275) — Work Log

> **Slug:** `2026-10-25-org-create-hydration-gate`
> **Surface:** (admin) /admin/organizations/new
> **Permission(s):** none (existing ADMIN_ORGANIZATIONS)
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Numbers (pre-assigned 2026-10-25):** F275 (assigned by platform-admin-redesign Phase 2); no migration; no DECISION; dev port 3550; Neon branch `pipeline-org-create-hydration`. Worktree `presby-orgform`, branch `pipeline/create-org-hydration`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped (bug confirmed from code by platform-admin-redesign Phase 1 G8, Phase 2 F275 and Inc1 Phase 3 bug-fix note; also TODO.md:185) | — | 2026-10-25 |
| 2 — Architectural review | architect | Skipped — no invariant touched; one component wrapped in the existing HydrationGate (DECISION-159) | — | 2026-10-25 |
| 3 — Technical design | tech-lead | Brief: the Inc1 Phase 3 bug-fix note (below) is the design | — | 2026-10-25 |
| 4 — Implementation | ux-developer | Complete | — | 2026-10-25 |
| 5 — Verification | qa | Complete; regression fails pre-fix (unit + prod-lane), passes after; 31/31 dev e2e; 360px | PASS | 2026-10-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-10-25 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

[READY FOR DESIGN | READY WITH NOTES | NEEDS REWORK | NOT YET]

## ONE-LINE TAKE

> [The feature in one honest sentence.]

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| [admin / member / anonymous] | [verb] | [on demand / per session / one-time] |

## Flows

**Flow 1 — [name]:** [entry → step → step → outcome]
- Failure: [what the user sees if a step goes wrong]

**Flow 2 — [name]:** [...]

## Permissions & Flags

- **Permission(s):** [new `FEATURES.KEY`, or existing key reused]
- **Default roles:** [list]
- **Flag(s):** [new key + rollout plan, or "not needed"]

## Gaps the Request Didn't Address

- [Gap, why it matters, suggested resolution]

## Out of Scope (confirm with user)

- [Thing the request implies but isn't in scope]

## Open Questions

- [Question for the user]

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

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| [gap or ruling] | [section, or deferred + who accepted] |

## Edge Cases & Risks

- [Thing that could fail or that needs special handling; each claim cites the test that pins it or says "unverified"]

## Copy

- [Every user-facing string, checked against the accepted residuals: copy may not deny a residual the record admits]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

## Files Created

- `e2e/hydration/create-organization-form.spec.ts` — prod-lane held-chunks case for /admin/organizations/new (specs each carry their own `holdScripts`; no shared helper exists, so followed that convention)

## Files Modified

- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — `<form>` wrapped in `<HydrationGate>`; nothing else
- `src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx` — `useHydrated` mocked; two gate tests

## Schema Changes

none

## Audit Events

none

## Implementer Notes

Failing-first: with the form unchanged, both new tests failed (`expected null not to be null`; `Cannot read properties of null (reading 'disabled')` — no gate fieldset). With the fix, 47/47 in the directory pass. Test names carry `regression for F275`. The repo has no jest-dom, so disabled state is asserted with `.matches(":disabled")` (jsdom resolves fieldset disablement).

Gates: typecheck, lint, `npm run check` (0 violations), `npm test` (553 files passed, 8592 tests passed, 2442 skipped), `npm run build` all pass. `PW_PROD_PORT=3551 npm run test:e2e:prod -- e2e/hydration/create-organization-form.spec.ts`: 1 passed. `e2e/admin-organizations*.spec.ts` on :3550 (Playwright-started dev server, stopped): 31 passed.

Strings added or changed: none

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa

**Run scope.** Typecheck, lint, `npm run check`, the plain unit suite and `npm run build` were run in full. The new prod-lane spec ran at :3551 against the fixed build and against a pre-fix build. Both `e2e/admin-organizations*.spec.ts` files ran on a Playwright-started dev server at :3550, and I did my own 360px look at /admin/organizations/new.
- **Not re-run:** the DB-backed suites (`npm run test:db`), the full chromium e2e suite, the rest of the prod lane and `test-rls.sql`. The diff touches no migration, `authz.ts`, `src/lib/db/`, shared fixture, layout, `proxy.ts`, `auth.ts`, `e2e/support/` or shared component. The PR's CI covers those.
- **Flag reset:** before the e2e runs I reset global flags on `pipeline-org-create-hydration` with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`. It set 39 seeded flags, 3 rows changed, and 10 flags are on afterwards.
- **Database checks:** the worktree's database hosts differ from the main checkout's. I compared hashes and printed no values. Disk has 569 GiB free.

## Type Check

`npm run typecheck`: PASS
`npm run lint`: PASS (`--max-warnings=0`)
`npm run check`: PASS, all eight tripwires pass with zero violations
`npm run build`: PASS (`ƒ /admin/organizations/new` built)

## Unit Tests

Total: 11034 | Passed: 8592 | Failed: 0 | Skipped: 2442 (77 files) | Duration: 29.0s
- The 77 skipped files are the env-gated DB-backed set that plain `npm test` does not run (`docs/testing.md` → "Running the DB-backed suites"). None is in the diff.
- The touched directory (`src/app/(admin)/admin/organizations/new/`) ran verbosely: 47/47 passed, 0 skipped.

## End-to-End Tests

**Prod lane, fixed build.** `PW_PROD_PORT=3551 npm run test:e2e:prod -- e2e/hydration/create-organization-form.spec.ts`
Total: 1 | Passed: 1 | Failed: 0 | Duration: 11.3s

**Prod lane, pre-fix build.** This used a `git archive` copy in the scratchpad with the form taken from `4b635aa`, at :3551.
Total: 1 | Passed: 0 | Failed: 1
- It fails at `e2e/hydration/create-organization-form.spec.ts:37`: the gate fieldset is not found.
- **Property probe.** That first failure is structural (the element is missing). So in the scratch copy only, I deleted the two gate-locator lines and re-ran. The pre-fix build then fails at `:38`: `#organizationType` is "Received: enabled" while the JS chunks are held.
- So the spec catches the real fault (the controls can be used before hydration), not just a missing `<fieldset>`.

**Dev lane, :3550.** `e2e/admin-organizations-create.spec.ts` and `e2e/admin-organizations.spec.ts`
Total: 31 | Passed: 31 | Failed: 0 | Skipped: 0 | Duration: 1.0m
- This includes the existing 360px specs (`admin-organizations-create.spec.ts:239`, `admin-organizations.spec.ts:197`, `:886`, `:1093`).
- Playwright started and stopped the server itself, and :3550 was free afterwards.

**360px look at /admin/organizations/new** (production build, admin storage state, JS held and then released).
- **Before hydration:** the controls and submit button are dimmed and the labels keep full contrast, as DECISION-159 prescribes. The fieldset has no border, padding, margin, opacity or `<legend>`.
- **After hydration:** `scrollWidth` 360 equals `clientWidth` 360, and no form element passes the viewport. The submit button is 44px tall. Picking Presbytery reaches the select.
- Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/360-prehydration.png`, `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/360-hydrated.png`.

## Regression Tests Added

- `holds the whole form inoperable until it has hydrated` — `src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx:286`
  - Guards against: the type select and Create button being usable before hydration (F275).
  - Watched failing on the pre-fix form ("expected null not to be null") and passing with the fix.
- `is operable once hydrated` — same file, `:299`
  - Guards against: a gate that never releases.
  - Watched failing on the pre-fix form ("Cannot read properties of null (reading 'disabled')") and passing with the fix.
- `the form is disabled until hydration, then accepts a type pick` — `e2e/hydration/create-organization-form.spec.ts:30`
  - Guards against: the same fault, on a real production build with JS held.
  - Watched failing on the pre-fix build, on both the structural and the property assertion (above), and passing with the fix.
- Both unit tests carry the `regression for F275` suffix.

## Coverage on Critical Modules

Not measured this run. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`.

## Feature-Gate Audit

No protected routes touched. The diff changes one client component (`create-organization-form.tsx`), its test, and an e2e spec. `page.tsx` and `actions.ts` under `new/` are unchanged, and their existing authorization tests pass (`actions.test.ts`: unauthenticated rejected, missing `admin.organizations` rejected). The dev-lane spec `:57` confirms a member is redirected away from `/admin/organizations/new`.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| none added or changed | n/a | n/a | n/a |

## Copy Truthfulness

No strings changed. The only non-test source lines the diff adds are the `HydrationGate` import and the opening and closing `<HydrationGate>` tags (`git diff -U0 origin/main...HEAD` over `.tsx` and `*-copy.ts`). It adds no release-note line or email template. This matches Phase 4's "Strings added or changed: none".

- [x] Every added or changed string is in the design's Copy table (none added)
- [x] The query behind each claim was opened (no claims added)
- [x] Each instruction was traced to its role (no instructions added)
- [x] Older strings about the same subject were checked; none is made false

**Observations (none block the verdict):**
1. **The branch is one merge behind origin/main.** PR #53 (`3af650a`, F231: `src/auth.ts`, `src/lib/auth/sign-in-gate.ts`) landed after the branch point. It does not overlap the touched files, and the form file is identical on main and at `4b635aa`. Merge main before opening the PR so CI tests the merged result.
2. **The spec picks the gate with `.last()`** (`e2e/hydration/create-organization-form.spec.ts:36`). If the admin chrome later renders another `HydrationGate` after the form, that line would bind the wrong fieldset. The `#organizationType` and button assertions on lines 38–39 stand on their own, and the probe above shows they catch the fault.
3. **The unit test checks the type select and submit button only.** It does not check the parent select or the hidden inputs. They sit in the same disabled fieldset, so they are covered by the same fact.
4. **The `<form>` was not re-indented** inside `<HydrationGate>` (`create-organization-form.tsx:102–276`). This is cosmetic: no formatter is configured and lint passes.
5. **The wider class of bug stays open.** `check:hydration-gate` still does not see `useState`-controlled forms. That is tracked at `docs/TODO.md:186` (F124) and `:321`. `docs/TODO.md:185` is this fix's own line and moves to Done at integration (Rule 10).
6. **Truncated option at 360px (pre-existing).** The closed native parent select shows "None — this will be a root organiz…". This diff does not change it.

## Verdict

**PASS**

Not auth-touching: the diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/`.

---

**Per-Phase Status row**

| 5 — Verification | qa | Complete | PASS | 2026-10-25 |

**Handoff:** analyst, Phase 6 (Shipped vs Intent, bug-fix variant): confirm a pick made before hydration can no longer be silently dropped on /admin/organizations/new. Before integration, the orchestrator merges `origin/main` into `pipeline/create-org-hydration` (observation 1) and moves `docs/TODO.md:185` to Done.

Files:
- `/Users/cshenso/git/presby-platform/presby-orgform/src/app/(admin)/admin/organizations/new/create-organization-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-orgform/src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx`
- `/Users/cshenso/git/presby-platform/presby-orgform/e2e/hydration/create-organization-form.spec.ts`
- `/Users/cshenso/git/presby-platform/presby-orgform/docs/work-log/2026-10-25-org-create-hydration-gate.md`

---

# Phase 6 — Shipped vs Intent (analyst)

**Slug:** `2026-10-25-org-create-hydration-gate` (F275, bug-fix variant)
**Date:** 2026-10-25
**Reviewed:** worktree `/Users/cshenso/git/presby-platform/presby-orgform`, HEAD `311427e` plus the uncommitted QA PASS work-log update. I read the diff, the unit and prod-lane tests, QA's Phase 5 including observations 1–6, and the TODO and release-note files.

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> A type or parent picked on `/admin/organizations/new` before the page has hydrated can no longer be silently overwritten, because the whole form is now disabled until React owns it. Nothing else about the form changed.

## What's Working

- **The root cause is closed at the right place.** The form is not a `useForm` root. It controls the type and parent selects and two hidden inputs with `useState`, so `check:hydration-gate` never saw it. Before the fix, the first client render overwrote a pre-hydration pick, and a wrong type or missing parent was permanent because there is no reparent control.
- **The fix is the three-line diff the design promised.** `47d2882` adds the `HydrationGate` import and the opening and closing tags around the `<form>`. `HydrationGate` renders `<fieldset disabled aria-busy>` until hydrated. Name, slug, both selects, the hidden inputs and the submit button all sit inside it, so nothing is operable before React owns the form. This is stronger than the TODO line's "disable submit until hydrated".
- **The regression tests catch the real fault, not just a missing element.** Phase 5 proves it three ways:
  - Both unit tests fail on the pre-fix form and pass after.
  - The prod-lane spec (`e2e/hydration/create-organization-form.spec.ts`, JS chunks held) fails on a pre-fix build.
  - QA's property probe, with the gate locator removed, still fails on `#organizationType` being enabled while the chunks are held.
- **Post-hydration behaviour is preserved.**
  - The 31 existing `admin-organizations*` e2e specs pass on a dev server. They cover create, validation, the parent picker and member redirect.
  - The 47 unit tests in the directory pass, including the earlier-failure cases such as a parent-list load failure still submitting.
  - After release, the spec picks Presbytery and the parent select appears.
- **No copy changed.** QA diffed `.tsx` and `*-copy.ts` and found only the import and tags. Phase 4 also records "Strings added or changed: none".
- **No new permission, flag, route, action or audit surface.** `page.tsx` and `actions.ts` are untouched, and their authorization tests still pass.

## Intent-vs-Shipped Diff

- **Intent (Inc1 Phase 3 bug-fix note, S2):** wrap the `<form>` in `<HydrationGate>`, with no other change. Shipped: exactly that. Verdict: **matches**.
- **Intent:** a failing-first component test with `useHydrated` mocked, and a prod-lane held-chunks case if a helper exists. Shipped: both. No shared `holdScripts` helper exists, so the spec carries its own, the convention of its sibling specs. Verdict: **matches**.
- **Intent (TODO:185):** "disable submit until hydrated, with the shared `useHydrated()`." Shipped: the whole form is held through the shared `HydrationGate`, which uses `useHydrated`. Verdict: **acceptable drift, stronger than asked**. It also closes a pre-hydration text entry that would otherwise be overwritten.
- **Intent:** the commit carries `Caught-By: agent-review`, `Discovered-In: Phase-5` and the `Work-Log` trailer. Shipped: yes. Verdict: **matches**.

## Edge Cases

- **Empty state:** not applicable. The form has no list state; the only data-dependent part is the parent list.
- **Failure microcopy:** pass, and unchanged. The "We couldn't load the list of presbyteries — try again." path still submits, and its unit test is green.
- **Permission gate:** pass. Nothing changed, and the member-redirect spec at `admin-organizations-create.spec.ts:57` is green.
- **Audit event:** not applicable. The change touches no mutation, and `ORG_CREATED` is untouched.
- **Mobile (360px):** pass. QA checked at 360px: no horizontal overflow, the submit button is 44px tall, and the pre-hydration state is dimmed controls with full-contrast labels and no visual shift. The truncated closed parent select ("None — this will be a root organiz…") is pre-existing and unchanged (observation 6).
- **Founding-administrator walk:** not required. The change does not alter how an account connects to an organization, how a role is granted, or what a new account can reach.
- **Accepted residual:** if the page's scripts never load, the form stays greyed. This is the intended DECISION-159 trade, and the release note says so.

## Follow-Ups

None blocking. Housekeeping at integration (Rule 10):

1. **Merge `origin/main` into `pipeline/create-org-hydration` before the PR** (QA observation 1). `main` has moved to `3af650a` (0.42.4), so the `v0.42.md` table and entry insert must be rebased onto that. The 0.42.5 entry goes above 0.42.4.
2. **The Increment 3 pipeline (`2026-10-25-platform-admin-redesign-inc3`) lists the create-form `HydrationGate` in its scope and carries F275.** When this ships, Increment 3 drops the gate and keeps only the permanence line and the type panel. The Increment 1 ruling S2 already said so.
3. **Open and unchanged, as you directed:**
   - TODO:186 (the F124 triage of `useState`-controlled selects outside react-hook-form, including F129).
   - TODO:321 (`check:hydration-gate` as a generic every-client-form rule, DECISION-192).
4. **Optional, Rule 14.** The functionality-map create-form bullet (Organizations, "**create** (`/admin/organizations/new` …") may take one clause: "whole form held by `HydrationGate` until hydrated (v0.42.5, F275)". The index needs no change.
5. **Rule 13: no what's-new entry.** It is a bug fix with no new member-visible behaviour, and the audience is platform admins.
6. **QA observation 2** (the spec's `.last()` gate locator, lines 36–39) and **observation 4** (the `<form>` was not re-indented) are cosmetic. They do not warrant a tracked line.

## Drafts for the orchestrator

### Release note — `docs/release-notes/v0.42.md`

Add this table row above the 0.42.4 row:

```
| [0.42.5](#0.42.5) | 2026-10-25 | Fix | The new-organization form waits until the page is ready |
```

Add this entry above the `0.42.4` anchor:

```
<a name="0.42.5"></a>
## 0.42.5 — 2026-10-25

**Fix: the new-organization form waits until the page is ready.**

**Value:** When a platform administrator opened the new-organization page and chose an organization type or a parent council very quickly, the page could finish loading a moment later and reset that choice without saying so. The form now stays greyed out until the page is ready, so a choice you make is the choice that is saved.

#### What's New

- **The form is greyed out for a moment when the page opens.** Once the page is ready, which is normally almost immediately, the form turns on and works as before.
- **Nothing else looks or reads differently.** The fields, labels, messages and the "Create organization" button are the same.
- **Nothing you have already created is affected.** If you are unsure an existing organization was created with the right type or parent, open it from the organizations list to check.
- **If the form stays greyed out,** reload the page. If it still does, please tell us with the feedback button.
```

### TODO edits — `docs/TODO.md`

- **Remove** the open line at ~:185, starting `- [ ] **Org create form: a parent picked before hydration silently becomes a root-org create (F124 class).**`.
- **Add** at the top of Done, in the commit that lands the work:

```
- [x] 2026-10-25 — **The new-organization form is held until the page has hydrated (`2026-10-25-org-create-hydration-gate`, F275, v0.42.5; no migration).** A type or parent picked on `/admin/organizations/new` before hydration was dropped and could create a root or wrong-type organization with no in-product repair. `create-organization-form.tsx` is now wrapped in `HydrationGate` (DECISION-159). Regression tests: two unit cases, plus a held-chunks prod-lane spec that fails on the pre-fix build. QA PASS, Phase 6 SHIP IT. Still open: the wider F124 class (the line after the removed one) and the generic `check:hydration-gate` rule (:321). — `docs/work-log/2026-10-25-org-create-hydration-gate.md`
```

- **Keep open and unchanged:** the F124 triage line (:186) and the `check:hydration-gate` generic-rule line (:321).
- **Rule 12:** no feedback row to mark, because the bug came from agent review (Phase 5 observation) and not from in-app feedback.

### `docs/schema-design-2.md` entry

**No separate entry from this branch.** Reasons:

- F275 was not minted here. The platform-admin-redesign Phase 2 assigned it to its G8, which has two halves: the missing `HydrationGate` and the paper-only type/slug permanence.
- This fix closes only the first half. Permanence stays open for Increment 3.
- Nothing from that series (F274–F281) is in `schema-design-2.md` yet. In the `presby-padmin` worktree the grep for F274/F275 returns nothing.
- Writing a standalone section here would collide with, or duplicate, the parent's F274–F281 section when the parent integrates.

Hand the parent's integration this closure sentence to fold into its F275 row. It follows the 2y/2z house pattern of "not a schema round, recorded here because this file is where the F-series lives":

> **F275 (low likelihood, permanent consequence) — the create-organization form was operable before hydration, and type/slug permanence is `paper`.** (a) The type and parent selects and hidden fields are `useState`-controlled outside react-hook-form, so `check:hydration-gate` could not see them and a pre-hydration pick was overwritten. **Closed by** `2026-10-25-org-create-hydration-gate` (v0.42.5): the form is wrapped in `HydrationGate`. The wider class stays open at F124 and `check:hydration-gate`'s scope. (b) Nothing in the database prevents `organization_type` or `slug` being rewritten after creation (`e2e/designation-revoke.spec.ts:307` rewrites the type). **Open**, Increment 3, migration 0070 only if S3 is adopted.

If the orchestrator would rather not wait, an equivalent one-line pointer in `docs/STATE.md` at integration serves. In both cases the parent log's planned slug `2026-10-25-create-org-hydration` differs from the actual `2026-10-25-org-create-hydration-gate`, so use the actual slug.

---

**Per-Phase Status row**

| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-10-25 |

**Handoff:** orchestrator.

1. Record this section in `docs/work-log/2026-10-25-org-create-hydration-gate.md` (Phase 6 replaces the placeholder; update the status row from Pending).
2. Merge `origin/main` into `pipeline/create-org-hydration`.
3. Apply the release note, the TODO move and the optional functionality-map clause in the same commit. Remember the version bump to 0.42.5 per `/release-notes`, and the 0.42.4-then-0.42.5 ordering in `v0.42.md`.
4. Pass the F275 closure sentence to the platform-admin-redesign parent log, and tell Increment 3 that the create-form gate has shipped.
5. Then `/pre-push`, with commit and push as separate calls and with your approval for each.

Files:
- `/Users/cshenso/git/presby-platform/presby-orgform/docs/work-log/2026-10-25-org-create-hydration-gate.md`
- `/Users/cshenso/git/presby-platform/presby-orgform/docs/TODO.md`
- `/Users/cshenso/git/presby-platform/presby-orgform/docs/release-notes/v0.42.md`
- `/Users/cshenso/git/presby-platform/presby-orgform/docs/product/functionality-map.md`
- `/Users/cshenso/git/presby-platform/presby-orgform/src/app/(admin)/admin/organizations/new/create-organization-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-orgform/e2e/hydration/create-organization-form.spec.ts`

