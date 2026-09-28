# Statistics form year guard and error mapping — a presbytery clerk never sees raw Postgres text on the reports page or the publish path — Work Log

> **Slug:** `2026-09-28-statistics-error-mapping`
> **Surface:** `(org)/o/[slug]/admin/reports` (the presbytery's statistics entry form, `setCongregationStatisticsAction`) and the congregation-side publish path (`presby_publish_sasr_snapshot()`'s callers in `src/lib/presbytery.ts` / the statistics-submit flow); no schema change expected
> **Permission(s):** existing `statistics.manage` / `statistics.publish` cover this
> **Flag(s):** not needed (existing `org_portal.reports` / `statistics.submission_grants` gate the surfaces)
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-28, wave 5 — "finish the presbytery portal so PSV can be onboarded, tested and deployed"):** worktree `../presby-wt-errmap` on git branch `pipeline/statistics-error-mapping`; Neon branch `pipeline-statistics-error-mapping` (`br-lingering-salad-ax56g25z`, forked from `development` at the v0.28.0 state). **Pre-assigned numbers:** no migration expected (if one becomes necessary, STOP and ask — `0054` is reserved for the founding-administrator pipeline); `DECISION-156` only if a decision results; findings `F110` onward; no `test-rls.sql` section unless a DB behaviour is pinned (then §45). **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md`, `docs/product/functionality-map.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge; the pipeline's Neon branch is deleted at cleanup). `scripts/seed.ts`, `src/lib/org-portal/tiles.ts` and `src/lib/audit.ts` are high-collision: one clearly delimited addition each. **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148); every deny helper reachable from a tenant-path trigger grants EXECUTE to `presby_app, presby_platform` (0046 B-M1, re-learned as the increment-7 QA FAIL). Tests must mint their own fixture rows — a mandatory browser rehearsal on the pipeline branch consumes single-use seed rows (the withdraw pipeline's QA FAIL). Dev-server port `3500`; stop by PID; never `pkill -f`. `dotenv -e .env.local` does NOT override an already-exported `DATABASE_URL` — check `env | grep DATABASE_URL` first.
> **The bugs (`docs/TODO.md`, two open lines):** (1) `setCongregationStatisticsAction` (`/o/<slug>/admin/reports`) has no year guard or error mapping for the about-org trigger's historical-row refusal — a presbytery clerk can pick any year for any current member congregation, but a year before that congregation's affiliation to the presbytery is refused by `congregation_statistics_about_org` and the clerk sees the raw refusal. (2) `presby_publish_sasr_snapshot()` has five rejection branches (`drizzle/0047`/`0049`), including a report year predating the congregation's affiliation to its current presbytery, and its callers map none of them to English — the same surface the withdraw pipeline just gave a proper `ActionResult` copy table (`docs/work-log/2026-09-26-withdraw-publication.md` Phase 3 "Refusal copy" — reuse that shape and its SQLSTATE-mapping idiom in `src/lib/filings.ts`).
> **The fix:** for (1) compute the affiliation window per congregation (`presby_org_affiliated()` / `organization_affiliations` as-of, the `drizzle/0049:492-498` pattern) and both constrain the year picker AND map the trigger's refusal to a plain sentence when it still fires; for (2) enumerate the five branches by their literal/SQLSTATE, map each to user copy, and prove each mapping with a failing-first test against the real function on the branch DB. Uniform-literal refusals (F40 class) must stay uniform on the wire — the mapping is on the caller's side only and must not reveal more than the literal does.
> **Constraints:** touches `src/lib/presbytery.ts`, which the sibling e2e pipeline reads but does not edit, and which the founding-administrator pipeline does not touch; keep the diff confined to the two surfaces. No `console.log`; `check:audit` unaffected (no new mutation). Verify in a browser at 360px on the reports page with a pre-affiliation year.
> **Out of scope:** the congregation-side working-draft surface (DECISION-137); `sasr_form_versions` field specs; the presbytery dashboard.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — both bugs reproduced on the branch DB; bug 2 rescoped to the two live callers (orchestrator ruling); year picker: constrain AND map | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Skipped — no invariant, schema, dependency or route touched under the option-(a) rescope (Phase 1 Skip Notation; bug-fix variant) | — | 2026-09-28 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-28 |
| 4 — Implementation | full-stack-developer | **Complete** — second loop-back closed (see "Phase 4 loop-back (2026-09-28)" subsection at the end of Phase 4): named coverage gap 1 closed via an exported `fetchAffiliationWindows()` + two new fixtures (`congDeparted`, `congRejoined`); teardown made leak-proof via `try/finally` (a literal people-before-organizations reorder was investigated and rejected — it would trip a different, non-cascading FK, DECISION-060); two cosmetic staleness fixes in `statistics-grants.test.ts` | Failing-first proven for all 3 Phase-4 test files AND this loop-back's arithmetic (RED: `expected 2020 to be 2019`; GREEN restored); typecheck/lint/check/`test:db`(4275/4275)/`test`(3378 passed, 897 skipped) all pass; `fixture-deletable.test.ts` re-run standalone at the very end, 5/5; zero stamped `people` rows at every checkpoint | 2026-09-28 |
| 5 — Verification | qa | **Second pass: PASS** — `test:db` 4275/0, canary clean after the suite, gap 1 closed with failing-first reproduced (`expected 2020 to be 2019`), live-trigger boundary re-probed both sides. First pass FAIL (diff sound: failing-first reproduced ×3, trigger literal/SQLSTATE and boundary math verified live on both sides, view posture confirmed, anonymous path byte-identical, both divergences ruled correct, 360px rehearsal passed; `test:db` red on three leaked fixture rows from the crashed RED run, cleared by the orchestrator within the window, + one named coverage gap). Looped back to Phase 4; awaiting re-verification of the loop-back above. | PASS | 2026-09-28 |
| 6 — Shipped vs intent | analyst | In progress | — | 2026-09-28 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Work-log:** `docs/work-log/2026-09-28-statistics-error-mapping.md`
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-errmap` (branch `pipeline/statistics-error-mapping`, Neon branch `pipeline-statistics-error-mapping`)

Both reported bugs are real and reproduced below against the branch DB in rolled-back transactions. One material scope problem was found in the kickoff's framing of bug #2 that Phase 2/3 need to rule on before implementation starts.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> A presbytery clerk who picks a year before a congregation's affiliation gets a raw Postgres exception instead of a sentence, and the fix for the second bug can only be built for the callers that actually exist today — `presby_publish_sasr_snapshot()` itself has zero application callers, so "map its five rejection branches to English" is presently an edit to dead code, not a user-facing fix.

## Reproduction (rolled back, `presby_app`, branch `pipeline-statistics-error-mapping`)

**Bug 1 — `congregation_statistics_about_org` trigger, no guard/mapping.** Fixture: Marrowbone Presbyterian Church (`66666666-…`) affiliated to Presbytery of the Northern Reach (`11111111-…`) from `2024-06-11`. Inserting a `presbytery_entered` row for report year 2020 (the exact 23-column statement `setCongregationStatistics` runs) produces:

```
ERROR:  congregation_statistics: the organization this record is about was not affiliated with this council as of 2020
SQLSTATE 42501 (insufficient_privilege)
CONTEXT: presby_deny_about_org_write(text,text) ← presby_check_about_org_affiliated()
```

`src/lib/presbytery.ts`'s `setCongregationStatistics` (lines 802–847) wraps this `tx.execute()` in **no try/catch**. The exception propagates out of `withOrgContext()`, out of the exported function, and out of `setCongregationStatisticsAction` uncaught — which is a contract violation, not just missing polish: `src/types/actions.ts`'s own doc comment says expected failures (bad input, permission denied, conflict) must return `{ ok: false, error }`, and only "truly unexpected errors (DB unavailable, etc.)" may throw. A clerk picking a pre-affiliation year is an expected, routine failure, not a DB outage. On the client, `statistics-form.tsx`'s `onSubmit` has no try/catch around `await setCongregationStatisticsAction(...)`, so the rejected promise also skips `setSubmitting(false)` — the button stays stuck on "Saving…" in addition to whatever Next.js's default unhandled-server-action-error surface shows.

**Bug 2 — `presby_publish_sasr_snapshot()`'s five rejection branches**, called directly (no TS caller exists — see Gaps below) as the affected congregation (`44444444-…`, Quillhaven, which moved from Presbytery of the Southern Fields to Presbytery of the Northern Reach on `1995-01-01`):

| # | Trigger | SQLSTATE | Literal | F40-class? |
|---|---|---|---|---|
| 1 | no `app.current_org_id` set | `42501` insufficient_privilege | `presby_publish_sasr_snapshot: no org context` | practically unreachable via any real caller (always set by `withOrgContext`) |
| 2 | org has no current affiliation at all | `22023` invalid_parameter_value | `presby_publish_sasr_snapshot: organization <id> has no current affiliation to publish to` | no |
| 3 | `p_report_year` out of 1900–2100 | `22023` invalid_parameter_value | `presby_write_return_publication_chain: report year 1500 out of range` | no |
| 4 | a SASR field out of bounds | `22023` invalid_parameter_value | `presby_publish_sasr_snapshot: a value is out of the allowed range` | no |
| 5 | report year predates affiliation to the *current* council (redistricting) | `22023` invalid_parameter_value | `presby_write_return_publication_chain: <org> was not affiliated with <recipient> during <year> — a return for a year before this congregation joined this council cannot be published to it; it belongs to the council that received it, through the import path` | no |

All five share one SQLSTATE (`22023`) but are lexically distinguishable by message text — the same discipline `src/lib/filings.ts`'s `ALREADY_WITHDRAWN_MARKER`/`SUPERSEDED_MARKER` substring-matching already establishes for `presby_withdraw_publication()`. **None of these five is F40-class** (the uniform-literal, enumeration-safe oracle) — they're all reached by an *authenticated, already-tenant-scoped* caller reporting on its own org, so distinguishing them on the wire leaks nothing the caller doesn't already know about itself. That is a materially different posture from `presby_submit_granted_return()`'s *anonymous, token-based* caller, which correctly collapses everything (including this same redistricting branch, reached transitively through the shared `presby_write_return_publication_chain()`) into one generic `{ kind: "invalid" }` / `{ kind: "invalid_input" }` pair in `src/lib/statistics-grants.ts:642-684` — that fold **is** F40-class-correct and must not be loosened.

`presby_org_affiliated(subject, council, as_of date)` is confirmed callable from the tenant connection: `drizzle/0044:747` grants `EXECUTE` to `presby_app`. It's SQL/`stable`/`security definer`, so a year-picker window computation in `setCongregationStatistics`/`getCongregationStatisticsRollup` can call it directly (or `presby_affiliation_parent_as_of`) without a new migration.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member (presbytery clerk, `statistics.manage`) — `/o/<slug>/admin/reports` | Picks a congregation and a year, enters SASR aggregate fields, submits | Annual, per congregation |
| Authenticated member (presbytery clerk) | Reads the year-guard rejection (today: nothing readable — an uncaught exception) | On the rare occasion a clerk enters a redistricted congregation's pre-affiliation year |
| Authenticated member (congregation-side clerk) — **no surface exists yet** | Would self-publish a SASR return for their own congregation (Increment 4a) | N/A — not built |
| Anonymous credential-holder (a name + a one-time emailed link, no session) — `/file-statistics` | Files a SASR return using a presbytery-issued grant; on a redistricted congregation, would hit the year-window rejection folded into the generic "check the highlighted fields" copy | Rare — a congregation that changed presbyteries between the report year and the filing date |

## Flows

**Flow 1 — Presbytery clerk enters a pre-affiliation year:** entry `/o/<slug>/admin/reports` → picks congregation + year in `StatisticsForm` → submits → `setCongregationStatisticsAction` → `setCongregationStatistics` inserts → DB trigger refuses.
- **Success:** row saved, toast "Statistics saved.", audit `CONGREGATION_STATISTICS_ENTERED`.
- **Failure (today):** uncaught exception; no `{ ok: false, error }` ever reaches the client; button likely sticks on "Saving…"; Next.js's default unhandled-server-action surface is whatever the nearest `error.tsx` renders (verified there is no route-level `error.tsx` under this admin tree at the time of this review — **confirm in Phase 3/4**, since that changes whether the user sees a generic message or a blank/broken page). This is the flow the fix targets.

**Flow 2 — Congregation self-publishes its own SASR return (Increment 4a):** **entry point does not exist.** `presby_publish_sasr_snapshot()` has zero callers anywhere in `src/` (confirmed by grep — every hit is a comment or doc string). `docs/TODO.md` line 195 tracks this explicitly as "Remaining: api-developer (server action + audit) then ux-developer (publish form + history UI)." The kickoff's Surface line ("the congregation-side publish path … `presby_publish_sasr_snapshot()`'s callers in `src/lib/presbytery.ts`") describes callers that don't exist.

**Flow 3 — Anonymous grant-holder submits a return for a redistricted congregation:** entry `/file-statistics?token=…` → fills 60-field form → `submitGrantedReturnAction` → `submitStatisticsGrant` → `presby_submit_granted_return` → `presby_write_return_publication_chain` refuses on the affiliation-window check (SQLSTATE `22023`).
- **Success:** redirect to `/file-statistics/submitted`.
- **Failure (today):** already mapped, generically, to "Some entries could not be saved — check the highlighted fields and try again." This is honest-enough and enumeration-safe but *misleading* — nothing about the submitted fields is wrong; the congregation's year is simply outside its current presbytery's affiliation window, and no amount of re-editing the form fixes that. This is a real (if softer) instance of bug #2 and, unlike Flow 2, has a live caller today.

## Permissions & Flags

- **Permission(s):** none new. `statistics.manage` (reports form) and `statistics.submission_grants`/token possession (grant path) already gate both surfaces — confirmed by reading `src/lib/presbytery.ts` and `src/lib/statistics-grants.ts`.
- **Default roles:** unchanged (`statistics.manage` binds to `presbytery_stated_clerk`, per `presbytery.ts`'s header).
- **Flag(s):** none new. `org_portal.reports` and `statistics.submission_grants` already gate the two live surfaces.

## Gaps the Request Didn't Address

1. **Scope mismatch in the kickoff for bug #2.** The kickoff names `presby_publish_sasr_snapshot()`'s "callers in `src/lib/presbytery.ts`" — there are none. The only live caller of the *shared chain* that can hit these branches is the anonymous grant path (`statistics-grants.ts`), which already generically maps the failure. Building a proper per-branch `ActionResult` mapping "the way the withdraw pipeline did" presumes an authenticated action file to edit that does not exist. **Phase 2/3 must rule explicitly** on one of: (a) rescope bug #2 to *only* the reachable grant-submission caller — giving the redistricting branch its own honest microcopy within the existing generic-fold architecture (a small, real, bug-fix-sized change), or (b) build Increment 4a's self-publish action + form first (already tracked as its own line item, TODO.md:195) — which is Feature-class work, not a bug fix, and needs its own Phase 1/2 pass, not this one. Recommend (a) for this pipeline; defer (b).
2. **No route-level `error.tsx` confirmed under `/o/[slug]/admin/reports`** (or its ancestors) — worth a one-line check in Phase 4 so the "what does an uncaught throw render as, today" baseline is known before/after the fix.
3. **Year-picker UX:** should the year `<Input>` on `StatisticsForm` be *constrained* to the affiliation window (disabling/flagging out-of-window years before submit), *mapped* only on refusal, or both? The trigger's own header notes the window is computed per-congregation from `organization_affiliations`, so a per-congregation client-side constraint needs the window shipped down with each congregation row (a small read-path addition to `getCongregationStatisticsRollup`/`listMemberCongregations`). Recommend **both**: constrain (better UX, catches the mistake before submit) **and** map (defense in depth — the DB is the source of truth, not the client, per CLAUDE.md's server-side-validation invariant; a client-only constraint alone would leave the uncaught-exception path reachable by anyone calling the action directly).
4. **Redistricted-congregation copy, Book of Order question.** `docs/TODO.md` line 60 flags that whether a redistricted congregation's stale-year return should route to the *current* presbytery at all is an open polity question pending an architect pass with a Book of Order citation. This pipeline's copy for that branch should say the mechanical fact plainly ("this year's return belongs to the presbytery you were part of at the time — contact them, or use the import path") without asserting a polity conclusion the pipeline hasn't confirmed.
5. **Failure-state copy tone.** The reports page already has `ReportsSectionForbidden`/`ReportsSectionLoadError` components for read-side failures (`reports-states.tsx`) — the write-side rejection copy should match that voice, not just avoid being raw SQL.

## Out of Scope (confirmed with kickoff)

- Increment 4a's self-publish UI/action (recommend deferring per Gap 1 above — it is out of "bug-fix" scope even though the kickoff's Surface line implies it exists).
- `sasr_form_versions` field specs, the congregation-side working-draft surface (DECISION-137), the presbytery dashboard — all already named out of scope by the kickoff.
- Any change to `presby_write_return_publication_chain()`'s or the trigger's SQL — this is a caller-side mapping/guard exercise; the DB refusals themselves are "working as designed" per `docs/TODO.md` line 59's own framing (R3.14/F30/F31).

## Open Questions

- Confirm with tech-lead: bug #2 rescoped to the grant-submission caller only (recommendation above), or does the operator want Increment 4a pulled forward into this pipeline (in which case reclassify as Feature, not bug-fix, and restart at Phase 1 for that portion)?
- Does the year-picker constraint need to account for a congregation with **no** affiliation row at all reachable today (e.g., a freshly seeded fixture with a null `effective_from`, "recorded" pre-history) — should the picker degrade to "unconstrained" rather than accidentally disabling every year for such a row?

## Adversarial Pass

- **Redirect targets:** N/A — no `callbackUrl`/`next`/`redirect` parameter anywhere in either flow.
- **State-machine shortcuts:** Yes, relevant — a clerk (or a script) can call `setCongregationStatisticsAction`/`submitGrantedReturnAction` directly, bypassing any client-side year-picker constraint Phase 3 adds. **The fix must be server-side** (the DB trigger already is; the *mapping* must be in `setCongregationStatistics`/`submitStatisticsGrant`, not only in the form) — confirmed this is already the codebase's own stated discipline (`statistics-schema.ts`'s own comment: "every check here is re-enforced server-side").
- **Enumeration leaks:** Checked carefully because this is the sharpest edge of the whole pipeline. (a) Bug #1's trigger message names the table and the as-of year — already reasoned safe in the migration's own comment (`organizations`/affiliation are publicly readable, and the caller already passed the parent-path check, so it's not learning anything new about a *different* org). (b) Bug #2's five branches, reached from an **authenticated same-tenant** caller (if/when Increment 4a exists) — also safe to give distinct copy, same reasoning. (c) Bug #2's branches reached from the **anonymous grant-submission** caller — must **stay** uniform; do not let a "reuse the withdraw pipeline's copy-table idiom" instinct leak the redistricting branch's specific message to an unauthenticated caller who has only proven token possession, not organizational identity. This is the one place a careless implementation of "give bug #2 real copy" would reopen an F40-class oracle the codebase has already closed once (`docs/schema-design-2.md`'s F40 finding). **Flag explicitly for tech-lead:** any new copy for the redistricting branch on the grant-submission path must stay inside the existing generic `GENERIC_FIELDS_ERROR` bucket, or be proven equally uniform some other way — never a distinct string keyed to "your congregation moved presbyteries."
- **Input boundaries:** Year format/range already validated both client (`/^\d{4}$/`) and server (`YEAR_MIN`/`YEAR_MAX`, `Number.isInteger`) in `setCongregationStatistics`. No change needed there.
- **Self-targeting:** N/A — no admin-acting-on-own-account scenario in either flow.

## Skip Notation

**Phase 2 (architect) can be skipped for the rescoped work** (Gap 1, option (a)): computing an affiliation window via an already-`presby_app`-grantable function, adding a try/catch + SQLSTATE mapping in `src/lib/presbytery.ts` and a marker-based mapping addition in `src/lib/statistics-grants.ts`, and a year-picker UI constraint touch no invariant, no schema, no new dependency, no new route. **If tech-lead instead pulls Increment 4a's self-publish action/UI into this pipeline, Phase 2 must run** — that adds a new server action, a new caller of a `SECURITY DEFINER` function, and (per the architect's route-group rules) a placement/permission-wiring decision this Phase 1 review did not evaluate.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Pending (may be skipped — see Skip Notation) | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Handoff:** → architect (Phase 2), or directly to tech-lead (Phase 3) if the operator/tech-lead confirms the Phase 2 skip per the notation above. Tech-lead's first job is to rule on Gap 1 (rescope bug #2 to the grant-submission caller vs. pull Increment 4a forward) before writing the design doc — that ruling determines the implementer list and whether this stays bug-fix-classified.



### Orchestrator rulings (2026-09-28)

1. **Gap 1 → option (a).** Bug 2 is rescoped to the callers that exist: `setCongregationStatistics` (the reports form) and the anonymous grant-submission path in `src/lib/statistics-grants.ts`. Increment 4a (the congregation self-publish action + form) stays its own future Feature pipeline (`docs/TODO.md` line ~195); this pipeline stays bug-fix class. The kickoff Surface line is corrected accordingly.
2. **The anonymous path stays uniform on the wire** — the redistricting branch gets honest copy only inside the existing generic bucket (or an equally uniform shape proven so); never a distinct "your congregation moved presbyteries" string to a token-only caller.
3. **Gap 3 → both**: constrain the year picker to the affiliation window per congregation AND map the trigger refusal server-side to an `ActionResult`; the mapping is the authority, the constraint is UX. A congregation with no computable window degrades to unconstrained.
4. **Phase 2 skipped** — no invariant, schema, dependency or route is touched under option (a) (analyst Skip Notation). Straight to Phase 3.

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

*Bug-fix variant. Phase 2 skipped per the analyst's Skip Notation and orchestrator ruling 4 (no invariant, schema, dependency or route is touched). This section rules on the two orchestrator-deferred questions (Gap 3's "which read," Gap 5's "leave or broaden `GENERIC_FIELDS_ERROR`") and is otherwise a caller-side mapping/guard exercise — no DB write changes.*

## Summary

Two related defects on the presbytery-statistics surface let a well-formed, in-permission request collide with the about-org affiliation history and produce either an uncaught exception (the reports form, `setCongregationStatistics`) or an honest-but-misleading generic message (the anonymous grant-submission path, `submitStatisticsGrant`). Neither is a database defect — `congregation_statistics_about_org` and `presby_write_return_publication_chain`'s report-year check are both "working as designed" (`docs/TODO.md`'s own framing, R3.14/F30/F31) — this is entirely a caller-side gap: `setCongregationStatistics` never catches the trigger's refusal, so it propagates past `src/types/actions.ts`'s own "expected failures must return `{ ok: false, error }`" contract, and the client's `onSubmit` never resets `submitting` on that (or any) rejection, wedging the Save button on "Saving…". We fix both by (a) shipping each congregation's affiliation window down with the rows the reports page already loads, so the year `<input>` can be constrained before submit; (b) catching the trigger's specific refusal server-side and returning a typed, in-contract failure with plain-English copy naming the mechanical fact only; (c) wrapping the form's submit handler in try/finally so `submitting` always clears; and (d) on the one live anonymous caller that can also hit this class of refusal (the redistricting branch of `presby_write_return_publication_chain`, reached through the grant-submission path), broadening the existing uniform generic-fields message rather than adding a distinct string — preserving the F40-class enumeration-safety this codebase has already established for that caller.

## Root Cause

**Bug 1 — `setCongregationStatistics` (`src/lib/presbytery.ts:757-847`).** The 23-column `INSERT … ON CONFLICT` runs through a bare `tx.execute(sql…)` with no try/catch. When `congregation_statistics_about_org` (drizzle/0045, `presby_check_about_org_affiliated()`) refuses a pre-affiliation year, it raises SQLSTATE `42501` with the literal `` `%: the organization this record is about was not affiliated with this council as of %` `` (table name, as-of year). That exception propagates out of the `withOrgContext()` callback, out of `setCongregationStatistics`, and out of `setCongregationStatisticsAction` uncaught. `src/types/actions.ts`'s own doc comment reserves throwing for "truly unexpected errors (DB unavailable, etc.)"; a clerk picking a pre-affiliation year for a real, in-permission congregation is an expected, routine failure and must return `{ ok: false, error }` instead. **On the client**, `statistics-form.tsx`'s `onSubmit` does:

```
setSubmitting(true);
const result = await setCongregationStatisticsAction(...);
setSubmitting(false);
if (result.ok) { ... } else { ... }
```

`setSubmitting(false)` is the line *after* the `await`, so when the action's promise rejects (as it does today for this case), execution never reaches it — `submitting` stays `true` and the Save button is stuck on "Saving…" for the rest of the component's life, independent of whatever the browser shows for the unhandled rejection itself (see the `error.tsx` baseline finding below).

**Bug 2 — `presby_write_return_publication_chain()`'s five rejection branches (`drizzle/0049:487-498` etc.), rescoped per orchestrator ruling 1 to the one live caller: `submitStatisticsGrant` (`src/lib/statistics-grants.ts`).** `presby_publish_sasr_snapshot()` itself has zero application callers (Increment 4a, deferred, `docs/TODO.md:195`), so there is no code to map for four of the five branches — they are unreachable through any caller that exists today. The fifth branch — a report year predating the congregation's affiliation to its *current* presbytery (the redistricting case) — **is** reachable, transitively, through the shared chain writer, from the anonymous grant-submission path. Today it is already caught (`statistics-grants.ts`'s `22023 || 23514` arm) and folded into the same generic message every other field-shaped failure in that bucket gets: `"Some entries could not be saved — check the highlighted fields and try again."` This is enumeration-safe (uniform across causes, so a token-holder learns nothing about which case fired) but actively misleading for this specific cause — no amount of re-editing the 60-field form fixes a year that is simply outside the presbytery's own affiliation window for that congregation.

## Design

### (a) Per-congregation affiliation window, shipped with the rows the reports page already loads

**Read path touched:** `getCongregationStatisticsRollup()` (`src/lib/presbytery.ts:614-635`), the function that already backs `StatisticsTable` and feeds `StatisticsForm`'s `congregations` prop via `page.tsx`'s `.map()` (`src/app/(org)/o/[slug]/admin/reports/page.tsx:217-224`). `listMemberCongregations()` is untouched — its 3 other callers (`getCongregationOversightList`, the per-capita path, the submission-grants issuable-congregations path) have no use for a statistics-specific window and stay out of this diff.

**The exact query — `organization_affiliations_public`, not `presby_org_affiliated()` per candidate year, and not the base `organization_affiliations` table.** Three options were on the table; the choice matters more than it looks:

- **Rejected: calling `presby_org_affiliated(subject, council, as_of)` once per candidate year.** We need a *window* (min/max eligible year), not a single yes/no for one year. Finding a boundary this way means bisecting or scanning across up to 200 years (`YEAR_MIN`..`YEAR_MAX`) per congregation — needless round trips for a value one aggregate query already answers.
- **Rejected: querying the base `organization_affiliations` table directly.** Its `tenant_isolation` RLS policy (drizzle/0044:505-508) filters on `organization_id = presby_current_org()` — and `organization_id` on that table is the **recording** council, not the parent and not the subject (per the table's own header comment, "provenance, never changes"). A presbytery querying this table under its own `withOrgContext()` session would see only the affiliation rows *it itself* recorded — silently and correctly by RLS's own rules, but *wrong* for this purpose: a congregation's affiliation row can have been recorded by a different council (a synod, or the congregation's prior presbytery at close time) and would vanish from the presbytery's own read, silently *under*-constraining the picker for exactly the congregations this feature exists to protect. This is precisely the kind of quiet RLS gotcha CLAUDE.md's Isolation invariant warns about, just on the read side instead of the write side.
- **Chosen: `organization_affiliations_public`** (drizzle/0044:525-528), the `subject_org_id, parent_org_id, relationship_type, effective_from, effective_to` projection view, deliberately not `security_invoker` (runs as owner, bypassing the base table's tenant policy) and already granted `SELECT` to `presby_app` — built for exactly this "who belongs to which council, publicly, minus the private why" read. One query, one scalar bind, correct regardless of who recorded the row:

  ```sql
  select subject_org_id, effective_from, effective_to
    from organization_affiliations_public
   where parent_org_id = ${organizationId}::uuid
  ```

  Filtered only on `parent_org_id` (not also on `subject_org_id in (...)`, to avoid an unproven array-bind shape in this codebase's raw-SQL idiom — every existing `tx.execute(sql…)` call here binds scalars only) — one query returns every span this presbytery has ever been the affiliation-parent for, across every subject, which is bounded by a presbytery's roster size (dozens, not thousands). Group in TypeScript by `subject_org_id`; congregations with no row simply have no map entry.

**Window math — the day-before-`effective_to` rule.** The trigger checks *both endpoints* of the calendar year (`presby_org_affiliated(..., make_date(year,1,1)) OR presby_org_affiliated(..., make_date(year,12,31))`, drizzle/0044:711-716, reused verbatim at drizzle/0049:487-491). That means: `minYear = year(effective_from)` (Dec 31 of that year is always ≥ `effective_from`, so the OR always passes for the start year, whatever day mid-year it lands on — confirmed against the Phase 1 Marrowbone fixture, `effective_from = 2024-06-11` → year 2024 accepted). `maxYear = year(effective_to − 1 day)`, **not** `year(effective_to)` — the range is half-open (`[effective_from, effective_to)`), so a departure exactly on January 1 excludes that whole year, and subtracting one day before taking the year is what reproduces the OR-of-both-endpoints check exactly rather than being off by one in that single edge case. A null `effective_from` (still-affiliated-since-forever / backfill) makes `minYear` unbounded (`null`); a null `effective_to` (currently affiliated, no end) makes `maxYear` unbounded (`null`). Reduce **across every span for a subject**, taking the global min of bounded `minYear`s and global max of bounded `maxYear`s, with any unbounded span forcing that side to `null`.

**Accepted imprecision, named out loud:** a congregation with **two disjoint affiliation spans** to the same presbytery (left, then rejoined) gets a window that is the *envelope* of both spans, including the gap year(s) in between — the picker will not visibly disable a gap year. This is intentional, not an oversight: per orchestrator ruling 3, "the mapping is the authority, the constraint is UX" — (c) below still refuses a gap-year submission with the correct plain-English message. Building exact multi-span eligibility into the picker is more complexity than this bug-fix-class change buys; revisit only if a redistricted-and-returned congregation actually surfaces this in practice.

**Type changes:** `StatisticsRollupRow` (`src/lib/presbytery.ts:519-527`) gains two fields: `affiliationMinYear: number | null`, `affiliationMaxYear: number | null`. `toRollupRow()` takes the computed per-congregation window as a fourth argument. `page.tsx:220-223`'s `.map()` passes both fields through into `StatisticsForm`'s `congregations` prop (its inline type at `statistics-form.tsx:110-114` gains the same two fields).

### (b) `StatisticsForm` — constrain, don't just validate format

- The Year `<Input type="number">` (`statistics-form.tsx:187-196`) gets `min`/`max` HTML attributes sourced from the *currently selected* congregation's window (read via `useWatch({ control: form.control, name: "aboutOrgId" })`, looked up against the `congregations` prop) — native browser spinner/range affordance, omitted (no `min`/`max` attr) when either bound is `null`.
- Inline copy under the field, shown only when at least one bound is known, in the same voice as `reports-states.tsx` (plain, short, no jargon): e.g. *"Marrowbone Presbyterian Church was affiliated with this presbytery starting in 2024 — enter that year or later."* / *"…affiliated with this presbytery through 2019 — enter that year or earlier."* / *"…affiliated from 2015 through 2019."* depending on which bounds are set.
- `onSubmit` gains a pre-flight check, **before** calling the server action: if the selected congregation's window is known and the entered year falls outside it, call `form.setError("year", { message: "<same copy, phrased as an error>" })` and `return` without calling `setCongregationStatisticsAction`. This is UX only — `statistics-schema.ts`'s own header already states the house rule ("every check here is re-enforced server-side"), and (c) below is what actually enforces it. A caller that bypasses the client entirely (the Phase 1 adversarial pass's own concern) still gets the correct refusal from (c).
- `onSubmit`'s existing `setSubmitting(true)` / `await` / `setSubmitting(false)` sequence is wrapped in `try { ... } finally { setSubmitting(false); }` — the one-line fix for the stuck-button bug, independent of and in addition to (c) removing the throw at its source. Both are needed: (c) stops *this* cause of an uncaught rejection; the `finally` stops *any* cause (a genuinely unexpected thrown error, e.g. `OrgAccessError` if a relationship disappears mid-session, DECISION-class `(org)/o/[slug]/error.tsx`'s own reason for existing) from leaving the button wedged.

### (c) `setCongregationStatistics` — catch, map, return in-contract

Add a module-private `pgErrorInfo(err)` helper to `src/lib/presbytery.ts`, identical in shape to `src/lib/filings.ts:127-151` and `src/lib/statistics-grants.ts:91-107` (walks the `.cause` chain Drizzle/the neon driver hangs off a thrown error; returns `{ code, message }`). This is the third copy of this exact function in the codebase — per-module duplication is this codebase's own established convention for it (both existing copies say so explicitly), not an oversight to consolidate here.

Wrap the `tx.execute(sql\`insert into congregation_statistics ...\`)` call in `setCongregationStatistics` (`presbytery.ts:824-846`) in try/catch:

```
try {
  const result = await tx.execute(sql`insert into congregation_statistics (...) ...`);
  const row = (result as unknown as { rows?: Array<{ id?: string }> }).rows?.[0];
  return { kind: "ok", data: { id: row!.id! } };
} catch (err) {
  const { code, message } = pgErrorInfo(err);
  if (code === "42501" && message.includes(NOT_AFFILIATED_MARKER)) {
    return {
      kind: "invalid_input",
      message: `${cong.name} wasn't affiliated with this presbytery in ${year} — check the year and try again.`,
    };
  }
  throw err; // anything unmapped: a bug signal, src/types/actions.ts's "truly unexpected" arm
}
```

`NOT_AFFILIATED_MARKER = "was not affiliated with this council as of"` — a safe substring of `presby_deny_about_org_write()`'s literal (drizzle/0045:155-162), matched with `.includes()` because the message is parameterized (table name, as-of year), never asserted verbatim — the exact idiom `filings.ts`'s `ALREADY_WITHDRAWN_MARKER`/`SUPERSEDED_MARKER` already establishes.

**Design decision: reuse the existing `invalid_input` variant, do not add a new `PresbyteryResult` kind.** `PresbyteryResult<T>` is shared across 11 exported functions in this file, and `src/app/(org)/o/[slug]/admin/reports/actions.ts` has 6 separate `switch (result.kind)` statements over it, none with a `default`/exhaustiveness check — meaning a new shared variant would require adding a no-op case to the other 5 action functions' switches purely to keep TypeScript's narrowing of `result.data` sound after the switch, a collateral-diff cost for a case that can only ever fire from this one function. `invalid_input`'s existing contract (`{ kind: "invalid_input"; message: string }`) is already exactly "well-formed input, refused for a reason the caller states in `message`" — the *format*-invalid year check three lines above this insert uses the identical kind for a different reason, and `setCongregationStatisticsAction`'s existing `case "invalid_input": return { ok: false, error: result.message }` (actions.ts:89-90) already forwards it verbatim. **Net result: zero changes needed to `actions.ts` for this bug.** Message copy states the mechanical fact only (congregation, year, "wasn't affiliated") — no polity claim about who *should* have filed it, per Phase 1 Gap 4; unlike bug 2's redistricting branch, "the import path" is not mentioned here because no import UI exists yet for a clerk to use (D13's executor is unbuilt, `docs/TODO.md:117`) — pointing to it would be misleading.

Any other SQLSTATE (or a `42501` whose message doesn't match — structurally shouldn't happen, since this INSERT can only trip its own trigger, but matched defensively the same way `filings.ts` does) rethrows, preserving the "truly unexpected" contract.

### (d) The anonymous grant path — widen the uniform bucket, do not create a second string

**Ruling on Phase 1's flagged open question:** broaden the wording of the shared generic-fields message uniformly; do **not** give the redistricting branch a distinct string. There is no existing `GENERIC_FIELDS_ERROR` constant today — it's an inline literal in `statistics-grants.ts`'s `22023 || 23514` catch arm (~line 658-660). Introduce one (named, `export`ed only so the regression test in (below) can assert byte-identity without duplicating the string):

```
export const GENERIC_FIELDS_ERROR =
  "Some entries could not be saved — check the highlighted fields and the report year, then try again.";
```

This is the **same one string**, returned unconditionally for every cause that arm already catches (a bad SASR field value, the F80 collision guard, *and* the redistricting report-year check) — nothing about *which* cause fired is newly revealed, so the F40-class enumeration-safety property is unchanged: a token-holder still cannot distinguish "your field was out of range" from "your congregation's year predates this presbytery's affiliation to it" from the message alone. The only change is that the shared copy now names "the report year" as one of the things worth checking, which is honest for the redistricting cause and harmless (an extra, ignorable clause) for every other cause already in the bucket. This satisfies "give the redistricting branch honest copy ONLY if it can stay inside the uniform bucket" — it stays inside by construction, because it is edited in the one place, not added as a new conditional branch.

### (e) `error.tsx` baseline (Phase 1 Gap 2) — confirmed, no change needed

`(org)/o/[slug]/error.tsx` exists as an ancestor route boundary and is not touched by this pipeline. It does **not** apply to today's Bug 1 failure mode, and understanding why matters for not mis-scoping a "fix" at it: `error.tsx` boundaries catch exceptions thrown during **Server Component render/streaming**. `setCongregationStatisticsAction` is a Server Action invoked from a Client Component via a plain `await` inside `onSubmit` (not a `<form action={...}>` prop) — when it throws server-side, the client-side call is an RPC whose returned promise **rejects**; that rejection is not a render-phase exception and does not route through the nearest `error.tsx`. Today's actual behavior: in production, the rejection is entirely unhandled (no `catch` anywhere in `onSubmit`) — no user-visible message appears at all, and the stuck "Saving…" button *is* the whole symptom; in development, Next's dev overlay surfaces the raw thrown message (the raw Postgres text Phase 1 reproduced). (c) and (b)'s `finally` together remove the throw for this expected case entirely, so neither path is exercised going forward. `error.tsx` remains the correct, unmodified backstop for a genuinely unexpected failure (e.g. `OrgAccessError` firing mid-session), which must keep throwing per `src/types/actions.ts`'s own contract.

## API Contract

No new routes or actions. Signatures unchanged; only return-value semantics and one interface widen:

- `setCongregationStatistics(viewerPersonId, organizationId, actingUserId, aboutOrgId, year, input): Promise<PresbyteryResult<{ id: string }>>` — no longer throws for the about-org refusal; returns `{ kind: "invalid_input", message: string }` for it (same shape already used for other input refusals in this function).
- `getCongregationStatisticsRollup(viewerPersonId, organizationId, year): Promise<PresbyteryResult<StatisticsRollupRow[]>>` — unchanged signature; `StatisticsRollupRow` gains `affiliationMinYear: number | null`, `affiliationMaxYear: number | null`.
- `setCongregationStatisticsAction(slug, aboutOrgId, year, input): Promise<ActionResult<{ id: string }>>` (`actions.ts`) — **no code change**; its existing `invalid_input` arm already forwards the new message.
- `submitStatisticsGrant(...)` in `src/lib/statistics-grants.ts` — no signature change; `GENERIC_FIELDS_ERROR` becomes a named, exported constant with broadened wording, still returned as `{ kind: "invalid_input", message: GENERIC_FIELDS_ERROR }`.
- New error strings (both end-user-visible, both plain sentences, no trailing punctuation beyond a period, matching `reports-states.tsx`'s voice):
  - `` `${congregationName} wasn't affiliated with this presbytery in ${year} — check the year and try again.` `` (bug 1, reports form)
  - `"Some entries could not be saved — check the highlighted fields and the report year, then try again."` (bug 2, grant-submission path — replaces the narrower existing literal)

## Data Model

No schema changes required. No migration. `organization_affiliations_public` (drizzle/0044) and the `presby_app` grant on it already exist and are unmodified.

## Component / Page Plan

Files to modify (no new pages or components):

- `src/lib/presbytery.ts` — add `pgErrorInfo()`, `NOT_AFFILIATED_MARKER`; wrap `setCongregationStatistics`'s insert in try/catch; add the affiliation-window query + reduction; extend `StatisticsRollupRow`/`toRollupRow`/`getCongregationStatisticsRollup`.
- `src/lib/statistics-grants.ts` — extract and export `GENERIC_FIELDS_ERROR`; broaden its wording; both existing call sites of the old inline literal switch to the constant.
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — thread `affiliationMinYear`/`affiliationMaxYear` through the `.map()` at line ~220-223 into `StatisticsForm`'s `congregations` prop.
- `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` — extend the `congregations` prop type; add the watched-congregation window lookup, `min`/`max` attrs + inline copy on the Year field, the pre-submit `form.setError` guard, and the `try/finally` around the action call.

Tests (implementer-authored, see below): `src/lib/presbytery.test.ts`, a new `src/app/(org)/o/[slug]/admin/reports/statistics-form.test.tsx`, `src/lib/statistics-grants.test.ts`.

## Tests Owed (failing-first against the live trigger/functions on the branch DB)

1. **`presbytery.test.ts`** — extend the `makeOrg()` fixture helper to accept an optional `effectiveFrom` (default unchanged, `"2000-01-01"`); add a congregation affiliated to `presbyteryA` only from `"2022-06-11"`. New assertions in the "congregation statistics" `describe`:
   - `setCongregationStatistics(...)` for report year 2015 on that congregation returns `{ kind: "invalid_input", message: <contains the congregation's name and "2015"> }` — **must fail today** (currently throws) and pass after (c).
   - Report year 2022 (the affiliation-start year) returns `{ kind: "ok" }` — pins the inclusive both-endpoints rule (minYear = year of `effective_from`, not `effective_from + 1`).
   - `getCongregationStatisticsRollup(...)` for that congregation returns `affiliationMinYear: 2022, affiliationMaxYear: null` — pins the read-path window and its open-ended-`effective_to` handling.
2. **New `statistics-form.test.tsx`** (mocks `setCongregationStatisticsAction` the same way `page.test.tsx:61` already does):
   - Given a congregation prop with `affiliationMinYear: 2022`, the Year `<input>` carries `min="2022"`, and entering `2015` then submitting shows an inline error and does **not** call the mocked action.
   - Mocking the action to reject: submitting sets the button to a "Saving…" state and, after the rejection settles, the button returns to its normal enabled state — **must fail today** (stays stuck) and pass once `onSubmit` wraps the call in `try/finally`.
3. **`statistics-grants.test.ts`** — add a fixture congregation affiliated to the issuing presbytery only from a later date (same pattern as #1); issue a live grant for a report year before that date (grant issuance itself only checks *current-day* affiliation, drizzle/0049:249, so issuance succeeds); call `submitStatisticsGrant` and assert `result.kind === "invalid_input" && result.message === GENERIC_FIELDS_ERROR`. Compare this **by reference/`toBe`, not `toContain`**, against the existing "payload key out of bounds" test's (`statistics-grants.test.ts:643`) resulting message — both must be byte-identical, proving the redistricting cause was folded into the bucket rather than given its own string.

## Implementation Order

1. `src/lib/presbytery.ts` — `pgErrorInfo()`, the affiliation-window query/reduction, `StatisticsRollupRow` extension, the try/catch in `setCongregationStatistics`.
2. `src/lib/presbytery.test.ts` — the new fixture + three assertions above (failing first against (1) absent, then passing).
3. `src/lib/statistics-grants.ts` — extract/export/broaden `GENERIC_FIELDS_ERROR`.
4. `src/lib/statistics-grants.test.ts` — the redistricting-branch byte-identity test.
5. `src/app/(org)/o/[slug]/admin/reports/page.tsx` — thread the two new fields through.
6. `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` — prop type, watched window, `min`/`max` + inline copy, pre-submit guard, `try/finally`.
7. New `statistics-form.test.tsx` — the two component-level assertions.
8. `npm run typecheck`; targeted vitest run per `docs/testing.md`'s DB-backed-subset recipe (`--no-file-parallelism`, `.env.local` pointed at `pipeline-statistics-error-mapping`).
9. Browser rehearsal at 360px on `/o/<slug>/admin/reports`, dev-server port 3500: select the newly-fixtured congregation (or a one-off dev-only row, per the withdraw pipeline's "tests mint their own fixtures, don't consume seed rows" lesson), enter a pre-affiliation year, confirm the inline guard fires and, bypassing it (e.g. via devtools or a direct low-level submit), confirm the server-mapped sentence renders as a toast and the button un-sticks.

No `FEATURE_CATALOG`/permission/flag step — none touched. No audit-event step — no new mutation; `setCongregationStatistics`'s existing `CONGREGATION_STATISTICS_ENTERED` audit write is unaffected (still only reached on `kind: "ok"`).

## Edge Cases & Risks

- **Redistricted congregation** (Phase 1's own Quillhaven fixture) — covered by test #3 above via the grant path; the reports-form path (bug 1) would show the same mapped sentence if a presbytery ever entered `presbytery_entered` data for a year outside its own affiliation window, which is the case this whole design targets.
- **Congregation with two affiliation spans (left, rejoined)** — window is the min/max *envelope*, not the precise union; a gap year is not visibly disabled in the picker but is still correctly refused server-side. Named as an accepted simplification above, not fixed here.
- **Year exactly equal to the affiliation-start or -end year** — inclusive on both ends by the day-before-`effective_to` / plain-year-of-`effective_from` math; pinned by test #1's second assertion.
- **Congregation with no affiliation row at all reachable via `organization_affiliations_public`** (a freshly-seeded fixture, or one whose only recorded row predates the backfill and has both bounds null) — `affiliationMinYear`/`affiliationMaxYear` both `null`; the picker renders unconstrained (no `min`/`max` attrs, no inline copy), matching orchestrator ruling 3's "degrades to unconstrained."
- **A caller bypassing the client entirely** (direct `setCongregationStatisticsAction` call, e.g. a script) — (c) is the actual enforcement; (b) is UX only. Already the codebase's stated discipline (`statistics-schema.ts`'s header).
- **Mobile (360px)** — the Year field is a plain `<Input>` in the existing `sm:grid-cols-2` layout; the added inline copy is a short `<p>` under the field, same pattern `errors.year` already uses two lines below it — no new layout risk, but must be eyeballed per CLAUDE.md's "Verify in a Browser" invariant (Implementation Order step 9) since a two-line hint plus a validation error stacking under the same field is new.
- **Existing e2e/spec blast radius:** `page.test.tsx` renders `StatisticsForm` with a `congregations` array built from mocked rollup rows — adding two required-in-practice-but-optional-in-type fields to that shape should not break its existing assertions (additive fields, not renamed/removed ones), but the implementer must run it, not assume it. No other existing spec asserts on `StatisticsForm`'s year field, the "Saving…" button text, or `statistics-grants.ts`'s generic-fields message text verbatim beyond `statistics-grants.test.ts:643`'s own case (which this design's test #3 deliberately reuses for the byte-identity comparison rather than leaving to drift).

## `docs/TODO.md` (Rule 10 — orchestrator applies at integration; not edited on this branch)

Close both lines once shipped, replacing them in place with:

```
- [x] 2026-09-28 — **Statistics form year guard and error mapping** (`docs/work-log/2026-09-28-statistics-error-mapping.md`). `setCongregationStatistics` no longer throws for a pre-affiliation report year: the reports form now ships each congregation's affiliation window (from `organization_affiliations_public`) down with the rollup, constrains the year picker to it, and maps the about-org trigger's `42501` refusal to a plain sentence naming the congregation and year — closing the gap left by the lifecycle/affiliation pipeline's tech-lead amendment (Ruling B6). The anonymous grant-submission path's generic "check the highlighted fields" message (the one live caller of `presby_write_return_publication_chain`'s redistricting branch) is broadened to also name "the report year," staying inside the existing uniform bucket rather than adding a distinct string — `presby_publish_sasr_snapshot()`'s other four branches remain unmapped because it has no other live caller (Increment 4a, still open, tracked below).
```

(This supersedes both `docs/TODO.md:59` and `:60` — the latter only insofar as its *reachable* branch is now handled; `:60`'s four-branch/Increment-4a remainder is **not** closed by this pipeline and should be re-added, scoped to "the four branches with no live caller yet, owed once Increment 4a ships a self-publish action.")

## `docs/product/functionality-map.md` (Rule 14 — orchestrator applies at integration)

Line 25's clause "the statistics form has no year guard or error mapping for that refusal yet (`docs/TODO.md`)" is stale after this ships. Proposed replacement clause: "the statistics form constrains the year picker to each congregation's affiliation window and maps a residual about-org refusal to plain English (`docs/work-log/2026-09-28-statistics-error-mapping.md`)."

## `docs/decisions.md` — DECISION-156?

**Not proposed.** Every choice made above (reusing `invalid_input` rather than a new `PresbyteryResult` kind; reading `organization_affiliations_public` rather than the base table or a per-year function loop; the `pgErrorInfo()`/marker-substring idiom; broadening one shared literal rather than branching it) either extends a pattern the codebase already established twice (`filings.ts`, `statistics-grants.ts`) or is a narrow, single-call-site read-path choice fully explained by its own code comment and this work-log — none rises to "a new pattern a future implementer would otherwise have to rediscover or could plausibly get wrong the other way without a recorded ruling," which is the bar CLAUDE.md sets for logging one. If a future pipeline needs the *precise* multi-span eligibility this design deliberately declines to build, that would be the moment for a decision entry (or simply a TODO line) — not now.

## Implementer

**full-stack-developer.** The change spans one server module (`presbytery.ts`), one small server-side wording edit (`statistics-grants.ts`), and one client form (`statistics-form.tsx`) plus its page wiring — small and tightly coupled (the window computed server-side only has meaning paired with the form field it constrains), matching the Phase 4 selection table's "small/coupled" row rather than splitting across api-developer/ux-developer for a diff this size.

---

# Phase 4 — Implementation

**Implementer:** full-stack-developer
**Date:** 2026-09-28
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-errmap` (branch `pipeline/statistics-error-mapping`), Neon branch `pipeline-statistics-error-mapping` (`br-lingering-salad-ax56g25z`, confirmed via `select current_setting('neon.branch_id', true)` before any write — matched)

## Files Created

- `src/app/(org)/o/[slug]/admin/reports/statistics-form.test.tsx` — component tests for `<StatisticsForm>`: the `min` attribute sourced from the selected congregation's affiliation window, the pre-submit guard blocking an out-of-window year without calling the server action, an in-window year NOT being blocked, and the stuck-"Saving…"-button regression.

## Files Modified

- `src/lib/presbytery.ts` — (a) added `pgErrorInfo()` (module-private, same shape/idiom as `filings.ts`/`statistics-grants.ts`) and `NOT_AFFILIATED_MARKER`; (b) added `fetchAffiliationWindows()` (queries `organization_affiliations_public` filtered on `parent_org_id`, reduces every span for a subject to `{ minYear, maxYear }` per the day-before-`effective_to` rule, envelope over disjoint spans); (c) extended `StatisticsRollupRow` with `affiliationMinYear`/`affiliationMaxYear`, `toRollupRow()` takes the window as a 4th argument, `getCongregationStatisticsRollup()` fetches both the statistics-for-year map and the affiliation windows (`Promise.all`) and merges them; (d) wrapped `setCongregationStatistics()`'s raw-SQL insert in try/catch — a `42501` whose message includes `NOT_AFFILIATED_MARKER` now returns `{ kind: "invalid_input", message: "<Congregation> wasn't affiliated with this presbytery in <year> — check the year and try again." }` instead of throwing; anything else rethrows.
- `src/lib/statistics-grants.ts` — extracted and exported `GENERIC_FIELDS_ERROR`, broadened from `"Some entries could not be saved — check the highlighted fields and try again."` to `"Some entries could not be saved — check the highlighted fields and the report year, then try again."`; the one call site (the `22023 || 23514` catch arm in `submitStatisticsGrant`) now returns the constant instead of an inline literal. No branching added — the redistricting cause (drizzle/0049's report-year/affiliation check) stays folded into the same uniform bucket as every other cause that arm catches, preserving F40-class enumeration-safety for the anonymous grant-submission caller.
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — threads `affiliationMinYear`/`affiliationMaxYear` from the rollup row into `StatisticsForm`'s `congregations` prop (one `.map()` edit).
- `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` — `congregations` prop now typed `StatisticsFormCongregation[]` (adds the two window fields); added `affiliationWindowCopy()`/`affiliationWindowError()` helpers; the Year `<Input>` gets `min`/`max` sourced from the `useWatch`-selected congregation plus an inline hint paragraph (`reports-states.tsx` voice) shown when at least one bound is known; `onSubmit` gains a pre-flight guard that calls `form.setError("year", …)` and returns before invoking the server action when the entered year is outside the known window; the action call is wrapped in `try { … } catch (err) { … } finally { setSubmitting(false); }` (see Implementer Notes for the `catch` divergence); the `<form>` gained `noValidate` (see Implementer Notes — required for the guard to be reachable at all).
- `src/lib/presbytery.test.ts` — `makeOrg()` gained an optional `effectiveFrom` parameter (default unchanged, `"2000-01-01"`); new fixture `congLateAffiliation` (presbyteryA, affiliated only from `2022-06-11`), added to the `afterAll` teardown delete list (**had to be added before `presbyteryA`'s own delete** — an FK-violation teardown failure the first RED run surfaced and which is now fixed, see Implementer Notes); four new tests in the "congregation statistics" `describe`.
- `src/lib/statistics-grants.test.ts` — imported `organizations`/`organizationAffiliations`/`fixtureDeletableUntil`; new throwaway fixture congregation (`redistrictedCongId`, affiliated to Northern Reach only from `2020-01-01`, own grant `REDISTRICTED_GRANT_ID`/`REDISTRICTED_TOKEN` for report year `2010`, i.e. *before* that date — the redistricting shape); cleaned up in `afterAll` (deleting the organization cascades its own affiliation row and its own grant row, both `onDelete: "cascade"` on the relevant FK); one new test asserting the redistricting-branch failure is `invalid_input` with `message === GENERIC_FIELDS_ERROR` (`toBe`, not `toContain` — byte-identity, not substring).

## Schema Changes

None. No migration. Reads `organization_affiliations_public` (drizzle/0044), already `SELECT`-granted to `presby_app`; no DDL touched.

## Audit Events

None new. `setCongregationStatistics`'s existing `CONGREGATION_STATISTICS_ENTERED` audit write is unaffected — still only reached on `kind: "ok"`, unreached by the new `invalid_input` mapping. `check:audit` re-run clean (see Commands below).

## Feature Gates

No new permission or flag. `statistics.manage` (reports form) and the anonymous grant-submission path's existing gates (`statistics.submission_grants` flag + token possession) are unchanged; confirmed by reading both call sites — no new `hasFeature`/`isFlagEnabled` call was needed or added.

## Failing-First Evidence

Each of the three touched test files was run against the **pre-fix** source (via `git stash push -- <file>`, holding out only the implementation file — not the test file) to confirm RED, then against the **post-fix** source to confirm GREEN. All three used the live trigger/functions on the branch DB (`pipeline-statistics-error-mapping`), not mocks.

**1. `src/lib/presbytery.ts` / `presbytery.test.ts` (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery.test.ts`):**
- RED (pre-fix `presbytery.ts`, stashed): `3 failed | 1 passed | 44 skipped (48)`. The regression test **threw** an uncaught `error: congregation_statistics: the organization this record is about was not affiliated with this council as of 2015` (SQLSTATE `42501`) instead of returning `{ ok: false, kind: "invalid_input" }` — the exact bug. The two affiliation-window-read tests failed with `expected undefined to be 2022`/`2000` (the fields didn't exist yet). A teardown FK violation (`organizations_parent_id_organizations_id_fk`) also surfaced on this run — `congLateAffiliation` wasn't yet in the `afterAll` delete-before-`presbyteryA` list; fixed in the same commit, orphaned fixture rows cleaned up by hand via `psql` before re-running.
- GREEN (post-fix, stash popped): `48 passed (48)`.

**2. `src/lib/statistics-grants.ts` / `statistics-grants.test.ts` (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/statistics-grants.test.ts`):**
- RED (pre-fix `statistics-grants.ts`, stashed): `1 failed | 29 passed (30)`. `GENERIC_FIELDS_ERROR` was `undefined` (not yet exported) and the actual returned message was still the OLD narrower literal (`"...check the highlighted fields and try again."`) — confirming both that the byte-identity assertion is a real regression guard AND that the redistricting cause was *already* folded into the old uniform bucket pre-fix (the fold itself isn't new; only the broadened wording is).
- GREEN (post-fix, stash popped): `30 passed (30)`. (An earlier draft of this fixture had `REDISTRICTED_YEAR` *after* the affiliation start instead of before — the submission then legitimately succeeded (`kind: "ok"`), which surfaced as a teardown FK violation on `congregation_statistics`/`publications`/`statistical_returns` rows that shouldn't have existed; fixed by moving the report year before the affiliation start, matching the actual redistricting shape, and the stray committed rows were cleaned up by hand.)

**3. `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` / `statistics-form.test.tsx` (`npx vitest run "src/app/(org)/o/[slug]/admin/reports/statistics-form.test.tsx"`, no DB — mocked action):**
- RED (pre-fix `statistics-form.tsx` + `page.tsx`, both stashed): `3 failed | 1 passed (4)`, exit code 1. The `min`-attribute test failed (`expected null to be '2022'`), the inline-guard test failed (no such text ever renders, and the mocked action's call is never guarded), and the stuck-button test **timed out** waiting for the button to return to its enabled state — plus a genuine, unsuppressed **Unhandled Rejection** (`Error: simulated unexpected failure`), because the pre-fix `onSubmit` has no `finally` at all.
- GREEN (post-fix, stash popped): `4 passed (4)`, exit code 0, no unhandled-rejection noise.

## Commands Run (final, post-fix state)

- `npm run typecheck` — pass
- `npm run lint` — pass (`eslint --max-warnings=0`)
- `npm run check` (all 5 tripwires: audit-coverage, sql-date, deps-drift, brand-scope, secrets) — pass
- `npm run test:db` (`dotenv -e .env.local -- vitest run --no-file-parallelism`, the ~30-file DB-backed subset run alongside the full suite since it's one command) — **294 test files, 4271 tests, all passed**, exit code 0
- `npm test` (pure unit suite) — **260 test files passed, 34 skipped (DB-backed, no `.env.local` in this invocation), 3378 tests passed, 893 skipped**, exit code 0

## Browser Verification (360px, dev server port 3500)

Dev server started with `npm run dev -- -p 3500` (backgrounded, stopped by PID afterward — `kill 4621 4622 4623`, never `pkill`). Driven with Playwright (`chromium`, 360×800 viewport) since no interactive browser session is available to this agent; screenshots in the session scratchpad at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b08e6db7-b5b1-4a1b-b94f-75e0928bed80/scratchpad/screenshots/`:

- `01-signin.png` — sign-in page before auth.
- `03-reports-page-top.png` — signed in as `presbytery.clerk.fixture@example.invalid` (`e2e-fixture-only-not-a-secret`), full page at `/o/northern-reach/admin/reports`. Congregation defaults to Alder Creek Presbyterian Church, year 2025; inline hint reads *"Alder Creek Presbyterian Church was affiliated with this presbytery starting in 1962 — enter that year or later."*
- `04-quillhaven-selected.png` — Quillhaven Presbyterian Church selected (seeded fixture, affiliated to Northern Reach from 1995-01-01 per `scripts/seed-dev.sql`'s redistricting fixture — no new seed data needed for this check); Year input's `min` attribute confirmed `1995` via `getAttribute`; hint updates to name Quillhaven and 1995.
- `05-guard-error.png` — entered year `1990` for Quillhaven and clicked "Save statistics": inline red error *"Quillhaven Presbyterian Church wasn't affiliated with this presbytery until 1995 — enter 1995 or later."* renders in place of the hint; button returned to normal "Save statistics" (never called the server action — confirmed no network request fired for this click). Readable and correctly stacked at 360px; no layout overflow.
- `06-in-window-success.png` — same congregation, a throwaway report year (`2091`, owned by this manual check, never colliding with seed data) inside the window: submission succeeds, toast reads "Statistics saved.", and the paragraph under the Year field is the plain informational hint, not an error. The throwaway `congregation_statistics` row was deleted by hand afterward (`delete from congregation_statistics where organization_id='11111111-…' and about_org_id='44444444-…' and year=2091`).

**Server-side mapping "bypass via the action" check:** judged impractical to reproduce through raw HTTP against Next.js 16's Server Action wire protocol (the `Next-Action` header is a build-time content hash) within this verification's time box. The equivalent proof — a caller invoking `setCongregationStatistics()` directly for a pre-affiliation year, bypassing the client guard entirely — is exactly what `presbytery.test.ts`'s new regression test already does, and it is the actual production enforcement point (Phase 3 Design (b): "the mapping is the authority, the constraint is UX"). Recorded here as a deliberate scope call rather than a silent gap.

**Flag toggle:** none needed. `org_portal.reports` was already `enabled = true` on the branch DB (checked via `psql`, not flipped) — the reports page rendered without any flag change. `statistics.submission_grants` remains `false` (its default), unrelated to this fix's surfaces.

## Implementer Notes

1. **`noValidate` added to `<form>` — a divergence from the Phase 3 design doc, required for the guard to be reachable at all.** The design specified `min`/`max` HTML attributes on the Year `<Input>` "for the native browser spinner/range affordance." Discovered while writing the failing-first form test: with `min`/`max` set, a real browser (and jsdom, identically) runs HTML5 constraint validation on submit-button click *before* React ever sees the event — an out-of-window value silently cancels the `"submit"` event entirely, so `onSubmit` (and therefore the plain-English `setError` guard Design (b) also asks for) never runs. This isn't a jsdom quirk; it's spec'd browser behavior, confirmed by a debug script that logged `onSubmit` never firing for a `min`-violating value while firing normally for an in-range one. `noValidate` on the `<form>` disables that native interception while leaving `min`/`max` fully functional as spinner-arrow clamps (their other stated purpose) — the zod/RHF resolver and this guard become the sole, consistently reachable validation path, matching every other check in this form (`statistics-schema.ts`'s own "every check here is re-enforced server-side" header). No existing form in this codebase sets `min`/`max` **and** relies on a custom post-validation message on the same field (the SASR fields' `min={0}` has no such companion message), so this interaction hadn't previously been hit.
2. **`onSubmit` gained a `catch`, not just the design's `finally`.** Design (e) reasons — correctly — that this client-side action call is an RPC, not a render, so `error.tsx` cannot and does not catch its rejection, and states that a genuinely unexpected failure should "keep throwing" per `src/types/actions.ts`'s contract. In practice (confirmed empirically: attaching `.catch()` to the mocked promise itself did not prevent Node from reporting the *outer* promise — the one returned by calling the async `onSubmit`/React's discarded return from the `<form onSubmit>` handler — as an unhandled rejection), "keep throwing" from *this specific call site* is indistinguishable from *total silence*: no error boundary ever sees it, so the only visible effect was an invisible browser-console "Uncaught (in promise)" entry with **zero user-facing feedback**, which is worse than the stuck button it replaces, not better. Every other call site of this shape in the codebase (`add-officer-term-form.tsx`, etc.) shares the same no-catch pattern and the same latent gap — this pipeline's own bug-fix scope is `setCongregationStatistics`/`StatisticsForm` only, so the fix here is local: `catch (err) { console.error(...); toast.error("We couldn't save this right now. Try again in a moment.") }`, logged (not the raw SQL — Next.js Server Actions already redact the real server error into a generic digest-only message before it reaches the client in production, so nothing sensitive crosses this boundary) rather than left to vanish. `src/types/actions.ts`'s "truly unexpected errors… may throw" contract is about the *server* action function (`setCongregationStatistics`/`setCongregationStatisticsAction`), which is unaffected — it still throws for anything `(c)`'s catch doesn't map; this change is scoped to the *client* caller's own handling of that throw, one layer up. Recommend a documentation follow-up (not raised as a new bug) for `docs/ui-standards.md` or the design pattern the sibling forms share, since this is now the second form (after this one) that would benefit from the same catch — out of this pipeline's scope to retrofit every sibling form.
3. **Two teardown-ordering/fixture bugs were self-inflicted and self-caught** during the failing-first exercise, not shipped: `presbytery.test.ts`'s `afterAll` needed `congLateAffiliation` deleted before `presbyteryA` (an FK violation on the first RED run); `statistics-grants.test.ts`'s redistricting fixture needed its report year *before*, not after, the fixture's affiliation start date (an earlier draft had them backwards, causing the submission to legitimately succeed and leave rows a naive teardown then choked on). Both are fixed in the diff; no orphaned rows remain on the branch DB (`select count(*) from organizations where name like 'Fixture %'` re-checked clean for both fixtures' name patterns after each fix).
4. **No changes to `actions.ts`**, per the binding Phase 3 design's own "Design decision" call — the new `invalid_input` message reuses the existing variant and the existing `case "invalid_input": return { ok: false, error: result.message }` arm forwards it verbatim.
5. **The accepted envelope-not-union simplification** (a congregation with two disjoint affiliation spans gets a picker window that doesn't visibly disable the gap year) was not independently re-tested here beyond the design's own reasoning — no such fixture exists in `scripts/seed-dev.sql`, and building one was judged out of scope for a bug-fix-class pipeline per the design's own "Accepted imprecision, named out loud."

---

## Phase 4 loop-back (2026-09-28)

**Trigger:** Phase 5 QA FAIL — `npm run test:db` red on three leaked stamped `people` rows from the implementer's own crashed first RED run (Implementer Note 3), cleared by the orchestrator on the pipeline's own Neon branch before the `deletable_until` window closed; plus one named coverage gap (gap 1: no test pinned the closed-upper-bound "day-before-`effective_to`" arithmetic or the multi-span envelope reduction in `fetchAffiliationWindows()`, since every existing fixture had `effectiveTo: null`); plus two cosmetic staleness items in `statistics-grants.test.ts`. No design flaw — the loop-back is to Phase 4 only, per QA's own verdict.

**Worktree/branch confirmed before any write:** `presby-wt-errmap`, `pipeline/statistics-error-mapping`; `env | grep DATABASE_URL` empty; `.env.local` → `select current_setting('neon.branch_id', true)` = `br-lingering-salad-ax56g25z`, matching the kickoff. `select count(*) from people where deletable_until is not null` = **0** before starting (the orchestrator's remediation already ran).

### 1. Closing the named coverage gap

**A genuine architectural finding surfaced before any fixture was built, and it changed the design of this fix.** `getCongregationStatisticsRollup()` can never report a bounded, non-null `affiliationMaxYear` for any row it actually returns — proven, not assumed, three ways:

- `listMemberCongregations()` (`src/lib/presbytery.ts:216-233`) only returns a congregation whose `organizations.parentId === organizationId` — i.e. one with a CURRENTLY OPEN (`effective_to is null`) affiliation span to that exact presbytery, since `parent_id` is a cache `presby_apply_affiliation_to_org_tree()` (drizzle/0044) derives solely from whichever row has `effective_to is null`.
- `fetchAffiliationWindows()`'s own reduction rule ("any unbounded span forces that side to null") therefore ALWAYS forces `maxYear: null` for a subject the rollup can even see — an open span to that presbytery is required for visibility, and an open span by definition has no `effective_to` to compute a bound from.
- **Verified empirically against the live seed data**, not just reasoned: Quillhaven's real, seeded closed span to Presbytery of the Southern Fields (`effective_to: 1995-01-01`) is exactly the "bounded past affiliation" shape — and `select id, name from organizations where parent_id = '<southern-fields-id>' and organization_type = 'congregation'` returns **zero rows**. Southern Fields' own `getCongregationStatisticsRollup()` would never list Quillhaven at all, confirming QA's own Phase 5 finding (which used a raw live probe, not the rollup, for the identical reason) generalizes to every subject, not just Quillhaven.

This means the loop-back's literal ask — pin `affiliationMaxYear = year(effective_to − 1 day)` **from `getCongregationStatisticsRollup`** — describes a value that function can never produce for anything in its own output. Rather than write an assertion that cannot be satisfied, or silently substitute a different, weaker claim, the closed-upper-bound arithmetic is pinned at its real source:

- **`fetchAffiliationWindows()` exported** from `src/lib/presbytery.ts` (previously module-private) specifically for direct testability, with a header-comment addition explaining the above (`src/lib/presbytery.ts:277` area, doc comment above the function plus the `export` keyword). No behavior change — additive visibility only.
- **Two new fixture organizations** in `src/lib/presbytery.test.ts`'s `beforeAll` (right after `congLateAffiliation`, since `makeOrg()` only ever writes one open span and these need hand-built `organizationAffiliations` rows):
  - **`congDeparted`** — TWO CLOSED spans to `presbyteryA`: `[2005-01-01, 2010-01-01)` and `[2015-01-01, 2020-01-01)`, each satisfying `organization_affiliations_closed_shape` (drizzle/0044) with `closedByOrgId`/`closedOn`/`closedMinuteReference` set (`closedBy`, the acting user, deliberately left null — no `app.current_user_id` GUC exists, matching `presby_transfer_affiliation()`'s own convention). No open span at all, so it is invisible to `listMemberCongregations()`/the rollup by construction — reachable only via the exported `fetchAffiliationWindows()`.
  - **`congRejoined`** — a "left and rejoined" congregation: CLOSED `[2010-01-01, 2015-01-01)` then OPEN `[2020-01-01, null)`, both to `presbyteryA`. The open second span makes it a CURRENT member (`parentId = presbyteryA`), so it IS reachable via `resolveMemberCongregation()`/`setCongregationStatistics()` and the rollup — exercising the real, live about-org trigger's HISTORY-based check (not the cache) at the boundary of the CLOSED first span.
  - Both added to the `afterAll` org-delete block, positioned before `presbyteryA`/`presbyteryB` (same reason `congLateAffiliation` already is there: `organization_affiliations.parent_org_id` has no cascade, only `subject_org_id` does — deleting the subject clears its own rows first, drizzle/0044's own comment).
- **Four new tests** in the `congregation statistics` describe (`src/lib/presbytery.test.ts:1250` area onward):
  1. `setCongregationStatistics` for `congRejoined`, year 2015 (exactly `congRejoined`'s first span's `effective_to` year — the gap before rejoining) → `invalid_input`, naming the congregation and "2015".
  2. `setCongregationStatistics` for `congRejoined`, year 2014 (the year before) → `ok` — pins the exclusive-upper-bound rule via the REAL trigger, independent of the JS window.
  3. `getCongregationStatisticsRollup` for `congRejoined` → `affiliationMinYear: 2010, affiliationMaxYear: null` — documents, rather than fights, the envelope-forced-null behavior; the comment explains this null is exactly why the congregation is visible in the rollup at all.
  4. `fetchAffiliationWindows(tx, presbyteryA)` (called directly via `withOrgContext(clerkPerson, presbyteryA, ...)`, both newly imported into the test file) for `congDeparted` → `{ minYear: 2005, maxYear: 2019 }` — `2019 = year(2020-01-01 − 1 day)`, taken from the LATER of the two closed spans, not the earlier one (`2009`) — this is the assertion that actually exercises both the closed-upper-bound arithmetic and the multi-span envelope reduction QA asked for.

**Failing-first, recorded exactly as asked: temporarily broke the `− 1 day` arithmetic and watched it fail.**

```
sed -i 's/new Date(`${row.effective_to}T00:00:00Z`).getTime() - 24 \* 60 \* 60 \* 1000,/new Date(`${row.effective_to}T00:00:00Z`).getTime(),/' src/lib/presbytery.ts
npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery.test.ts -t "fetchAffiliationWindows computes congDeparted"
```

RED: `AssertionError: expected 2020 to be 2019` (`presbytery.test.ts:1321`) — with the day-subtraction removed, `maxYear` came back as `year(effective_to)` directly (`2020`) instead of `year(effective_to − 1 day)` (`2019`), exactly the bug this arithmetic exists to prevent. Restored from a pre-edit backup copy (not `git checkout`, since the file already had the loop-back's `export` change staged); re-ran the same targeted test — GREEN (`52 passed`) — then the full file — GREEN (`52 passed`, up from 48: the 4 new tests).

### 2. Teardown robustness (people vs. organizations ordering)

**Investigated a literal reorder and rejected it — it would trade one FK violation for another, worse one.** The three shared fixture people (`clerkPerson`, `narrowPerson`) hold `memberships` rows at `presbyteryA`, which produce derived `group_memberships` ("Active Membership" roster) rows via `presby_sync_derived_membership_group()`. `group_memberships`' FK to `memberships` (`group_memberships_person_fk`/`group_memberships_membership_fk`, `src/lib/db/domain/groups.ts`) is a plain `foreignKey()` with **no** `onDelete` — i.e. `RESTRICT`, not `CASCADE` (DECISION-060's own named composite-FK gap). Deleting a person before its derived `group_memberships` row is cleared would raise a NEW FK violation on `memberships`, worse than the leak it would fix. The CURRENT order (organizations deleted first, which cascades `memberships` AND `group_memberships` together via `organizations.id` → both tables' `onDelete: cascade`) is the one arrangement that avoids this — confirmed by reading both schemas, not assumed.

**Fix actually applied: guarantee, not reorder.** The entire body of `afterAll` (from the `congregation_statistics_freeze` trigger disable through the final `group_memberships_reject_derived` re-enable) is now wrapped in one `try`, with the people/`users` cleanup moved into the matching `finally` — so it runs even if an earlier step throws (the exact failure mode QA's canary caught), without changing the dependency order among the organization-side deletes, which must stay as-is. Documented inline at the top of `afterAll` with the reasoning above, so a future reader doesn't "fix" this into the literal reorder and reintroduce the FK violation.

Verified directly: ran `presbytery.test.ts` alone (RED/GREEN cycles above, plus a clean full run) and the full `test:db` suite — in every run, `select count(*) from people where deletable_until is not null` returned `0` immediately afterward, including after the deliberate RED run (the assertion failure happens inside a `vitest` `it`, which does not abort `afterAll`).

### 3. Cosmetic fixes

- `src/lib/statistics-grants.test.ts:132`: `REDISTRICTED_TOKEN` renamed from `"test-grant-redistricted-2097"` to `"test-grant-redistricted-2010"`, matching `REDISTRICTED_YEAR = 2010`.
- `src/lib/statistics-grants.test.ts:737` (comment): `"REDISTRICTED_YEAR (2097)"` corrected to `"REDISTRICTED_YEAR (2010)"`.

### Commands run (final, post-loop-back state)

- `npm run typecheck` — **PASS**
- `npm run lint` (`eslint --max-warnings=0`) — **PASS**
- `npm run check` (audit-coverage · sql-date · deps-drift · brand-scope · secrets) — **PASS**, all five
- `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery.test.ts` (standalone) — **52 passed** (48 + 4 new), up from Phase 4's 48
- `npx dotenv -e .env.local -- vitest run --no-file-parallelism` (full DB-backed suite, `npm run test:db`'s command) — **294 test files, 4275 tests, all passed**, exit code 0 (4271 + 4 new; matches QA's 4271 baseline plus this loop-back's additions)
- `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/fixture-deletable.test.ts` run standalone **at the very end**, after the full suite (not relying on its position mid-alphabet ahead of `presbytery.test.ts`, which is exactly how QA's leak escaped Phase 4's own reported green) — **5 passed**, canary clean
- `npm test` (pure unit suite, no `.env.local`) — **260 files passed, 34 skipped; 3378 passed, 897 skipped (4275 total)** — 4 more skips than Phase 4's report (893→897), matching the 4 new DB-backed tests now present and correctly skipped without a DB connection
- `select count(*) from people where deletable_until is not null` on `br-lingering-salad-ax56g25z` — **0**, checked before starting, after the RED run, after the GREEN run, and after the full suite
- `git status --porcelain` — same six `M` + two `??` entries as Phase 4's original hand-off; no stray backup files left behind (the pre-edit copy used for the failing-first restore lived in the session scratchpad, never the worktree)

### Files touched by this loop-back

- `src/lib/presbytery.ts` — `fetchAffiliationWindows()` changed from module-private to `export`ed, with an added doc-comment paragraph explaining why it (not `getCongregationStatisticsRollup()`) is the only place a bounded `affiliationMaxYear` can be observed. No other production-code change.
- `src/lib/presbytery.test.ts` — new `fetchAffiliationWindows`/`withOrgContext` imports; two new fixture organizations (`congDeparted`, `congRejoined`) and their `organizationAffiliations` rows in `beforeAll`; both added to the `afterAll` org-delete ordering; `afterAll`'s people/`users` cleanup moved into a `finally` wrapping the whole body; four new tests in the `congregation statistics` describe.
- `src/lib/statistics-grants.test.ts` — `REDISTRICTED_TOKEN` and one comment corrected from the stale `2097` to the real `2010`.

### Per-Phase Status (this subsection's own row — superseding the Phase 4 row above)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | full-stack-developer | **Complete** (second loop-back closed: named coverage gap 1 closed via an exported `fetchAffiliationWindows()` + two new fixtures reachable/unreachable by design; teardown made leak-proof via `try/finally` rather than a literal (and unsafe) reorder; two cosmetic staleness items fixed) — typecheck/lint/check all pass; `presbytery.test.ts` 52/52; full `test:db` 4275/4275; `fixture-deletable.test.ts` re-run standalone at the end, 5/5; `npm test` 3378 passed/897 skipped; zero stamped `people` rows at every checkpoint | Failing-first proven (RED: `expected 2020 to be 2019`; GREEN restored) | 2026-09-28 |
| 5 — Verification | qa | **Re-verification pending** | — | — |

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Date:** 2026-09-28
**Verified by:** qa (read-only; authored no tests, edited no files)
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-errmap`, branch `pipeline/statistics-error-mapping`
**Connection:** `env | grep DATABASE_URL` empty before any run; `.env.local` → `select current_setting('neon.branch_id', true)` returned `br-lingering-salad-ax56g25z` as `presby_app` on `neondb` — matches the kickoff. No `ALTER ROLE`, no `db:push`.

## Phase 2 Skip — confirmed still valid

`git diff --name-only 4461a46` returns exactly six files: `src/lib/presbytery.ts`, `src/lib/presbytery.test.ts`, `src/lib/statistics-grants.ts`, `src/lib/statistics-grants.test.ts`, `src/app/(org)/o/[slug]/admin/reports/page.tsx`, `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` (plus two untracked: the work-log and `statistics-form.test.tsx`). No `drizzle/`, no `route.ts`, no `actions.ts`, no `package.json`/lockfile, no new subdirectory, no invariant file. The Phase 1 Skip Notation holds.

## Type Check

`npm run typecheck`: **PASS**
`npm run lint` (`eslint --max-warnings=0`): **PASS**
`npm run check` (audit-coverage · sql-date · deps-drift · brand-scope · secrets): **PASS**, all five.

## Unit Tests

`npm test` (pure, no `.env.local`): **Total 4271 | Passed 3378 | Skipped 893 | Failed 0 | 13.0s** — 260 files passed, 34 skipped. The 893 skips are the `describe.skipIf(!hasDb)` DB-backed suites, which `test:db` runs; not a silent skip.

`npm run test:db` (`--no-file-parallelism`, branch DB): **Total 4271 | Passed 4270 | Failed 1 | 392s**. Run twice; the same single failure both times, and it reproduces in isolation.

**Failure:**

- `src/lib/db/fixture-deletable.test.ts:199` — *"no leaked stamped people row is outstanding — regression for the tickets.test.ts fixture leak (G2)"* — `expected 3 to be +0`. Three leaked `people` rows carrying `deletable_until`, all created **2026-09-28 20:08:55 UTC**:
  - `3712e834-…` Perpetua Ashworth-Nkemelu
  - `b1f6c07f-…` Cassius Delacroix-Odum
  - `66bab425-…` Ondine Fairweather-Solheim

  All three names are `src/lib/presbytery.test.ts:306-328`'s own fixture people — this pipeline's touched test file. This is residue from the implementer's **first, crashed RED run** (Implementer Note 3: the `afterAll` FK violation on `organizations_parent_id_organizations_id_fk`, after which "orphaned fixture rows [were] cleaned up by hand via `psql`"). The hand cleanup removed the `organizations` rows but not the three `people` rows.

  The current test file does **not** leak: I ran `presbytery.test.ts` solo twice (RED and GREEN) and `test:db` in full twice, four executions creating these same three fixture people, and after all four only the 20:08:55 set remains. The teardown ordering fix works. This is one-off residue, not a live defect in the diff.

  **Why Phase 4 reported 4271/0 and I do not:** the canary is a point-in-time snapshot and `fixture-deletable.test.ts` sorts before `presbytery.test.ts`. A leak created *after* the canary file has already run is invisible to that run and only surfaces on the next one. The implementer's reported green was real for its own run and is not reproducible now.

  **Remediation is time-boxed.** The two-hour `deletable_until` window closes **2026-09-28 22:08:55 UTC**; after that `presby_guard_people_delete()` makes these rows permanent on both connections. The canary prints the command itself, to be run on the owner connection: `delete from people where deletable_until is not null and deletable_until > now();` I did not run it — a DB mutation from this role is a process violation.

## Failing-First Evidence — reproduced independently by me

One production file stashed at a time, test file held in place; `git stash pop` after each; tree verified byte-identical by SHA-256 at the end, `git stash list` empty.

| Held out | RED | GREEN | Matches Phase 4's report? |
|---|---|---|---|
| `src/lib/presbytery.ts` | **3 failed / 45 passed (48)** | 48 passed | Same three tests, same signatures. Phase 4 saw `3 failed / 1 passed / 44 skipped` because their run aborted on the teardown FK violation; mine tore down clean. |
| `src/lib/statistics-grants.ts` | **1 failed / 29 passed (30)** | 30 passed | Exact match |
| `src/app/(org)/…/statistics-form.tsx` | **3 failed / 1 passed (4)** + 2 unhandled rejections | 4 passed, no unhandled-rejection noise | Exact match |

RED signatures, verbatim:

- `src/lib/presbytery.test.ts:1072` — `Error: Failed query: … error: congregation_statistics: the organization this record is about was not affiliated with this council as of 2015`, `code: '42501'` — the action **threw** instead of returning. This is the bug.
- `src/lib/presbytery.test.ts:1100` / `:1108` — `expected undefined to be 2022` / `expected undefined to be 2000`.
- `src/lib/statistics-grants.test.ts:743` — `expected 'Some entries could not be saved — che…' to be undefined` (the constant was not yet exported). The `kind === "invalid_input"` half already passed pre-fix, which independently confirms the redistricting cause was **already** folded into the uniform bucket and the diff adds no new branch — only broadened wording plus a test that pins the fold.
- `statistics-form.test.tsx:64` — `expected null to be '2022'`; `:73` guard never renders; `:103` times out with the button wedged on "Saving…", plus a genuine unsuppressed `Unhandled Rejection: Error: simulated unexpected failure`.

All four regression tests carry the `— regression for statistics form year guard and error mapping` suffix.

## Live-DB Verification (rolled-back transactions, `presby_app`, Northern Reach context)

The trigger mapping, probed against the live catalog and the live function — not inferred from green tests.

- **Quillhaven / 1990 still raises the literal the code matches.** `insert into congregation_statistics … about_org_id=44444444-…, year=1990` under `set_config('app.current_org_id','11111111-…',true)`:
  `ERROR: 42501: congregation_statistics: the organization this record is about was not affiliated with this council as of 1990`
  `CONTEXT: presby_deny_about_org_write(text,text) ← presby_check_about_org_affiliated()`
  `NOT_AFFILIATED_MARKER` in `src/lib/presbytery.ts` is `"was not affiliated with this council as of"` — a genuine substring of the live literal, and the SQLSTATE genuinely `42501`. The marker the code matches is the real one.
- **Which layer actually refuses, by name.** Not RLS and not the grant: `pg_class` shows `congregation_statistics` `relrowsecurity=t, relforcerowsecurity=t` with one policy `tenant_isolation` (`organization_id = presby_current_org()`) — which *permits* this write, since the org matches. `aclexplode(relacl)` gives `presby_app` only `SELECT, DELETE` at table level; `aclexplode(attacl)` shows column-level `INSERT`/`UPDATE` on 69 columns — the grant also permits it. The refusing layer is the **trigger** `congregation_statistics_about_org` (`tgenabled='O'`) → `presby_check_about_org_affiliated()` → `presby_deny_about_org_write()`. The design doc credits the trigger correctly.
- **Boundary math confirmed against the live trigger, both sides.** Quillhaven/Northern Reach span `[1995-01-01, ∞)`: year **1995 accepted**, year **1994 refused** → `minYear = year(effective_from)` is right. Quillhaven/Southern Fields span `[null, 1995-01-01)`: year **1994 accepted**, year **1995 refused** → `maxYear = year(effective_to − 1 day)` is right, and the half-open/January-1 edge case the design calls out behaves exactly as described.
- **`organization_affiliations_public` posture matches the design's claim.** `relrowsecurity=f`, `reloptions` empty (no `security_invoker`) → executes as owner and bypasses the base table's recording-council policy; `SELECT` granted to `presby_app` and `presby_platform`. I read it as `presby_app` with **no** org context set and got both Quillhaven spans, including the one parented by Southern Fields — the exact case the design says a base-table read would silently miss. Design (a)'s rejection of the base table is correct and now verified, not assumed.
- **`setCongregationStatistics()` returns rather than throws** — `src/lib/presbytery.test.ts:1072` passes post-fix against this same live trigger.

## End-to-End / Browser Verification (mine, 360 × 800, port 3500)

`rm -rf .next && npm run dev -- -p 3500`; driven in real chromium; stopped by PID (`kill 15637`), port confirmed free. Screenshots in the session scratchpad at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b08e6db7-b5b1-4a1b-b94f-75e0928bed80/scratchpad/shots/` (`01-signin`, `02-reports-top`, `03-quillhaven-selected`, `04-guard-error`, `05-in-window-save`).

Signed in as `presbytery.clerk.fixture@example.invalid` → landed on `/launch` → `/o/northern-reach/admin/reports` rendered.

- Quillhaven selected: Year input `min="1995"`, `max` absent (open-ended) — matches the live affiliation span exactly. `form.noValidate === true`. Hint reads *"Quillhaven Presbyterian Church was affiliated with this presbytery starting in 1995 — enter that year or later."*
- Year **1990** → Save: inline destructive error *"Quillhaven Presbyterian Church wasn't affiliated with this presbytery until 1995 — enter 1995 or later."*, hint correctly replaced rather than stacked, button back to "Save statistics". **Zero** POSTs to the route in the dev log for that click — the client guard short-circuits as designed.
- Year **2093** (no fixture uses it; the existing Quillhaven rows are 2025 only) with Active members 42 → Save: toast **"Statistics saved."**, button un-wedged, exactly **1** POST for the whole session. Row written, and `audit_events` gained `tenant.congregation_statistics.entered` at 21:03:10 UTC — the audit write still fires only on `kind: "ok"`.
- **This row persists on the branch DB.** `congregation_statistics (11111111-…, 44444444-…, 2093, presbytery_entered)` is still there; I did not delete it (no mutations from this role). Acceptable on a pipeline branch that is deleted at cleanup — recorded here so it is not mistaken for seed data.
- 360px layout: the two-line guard error wraps cleanly under the Year field, no overflow, no clipping (`04-guard-error.png`).

## Rulings on the Two Phase 4 Divergences

**1. `noValidate` on the `<form>` (`statistics-form.tsx:277`) — CORRECT, and necessary.** I did not take the implementer's word for the browser behaviour: the failing-first RED run cannot demonstrate it, because pre-fix the form had neither `min` nor `noValidate`. I reproduced it directly in chromium on a minimal page — `<form><input type="number" min="2022" value="1990"><button type="submit">`:

```
novalidate=false -> submit handler fired 0 time(s)
novalidate=true  -> submit handler fired 1 time(s)
```

Native constraint validation does cancel the submit event before React sees it. Without `noValidate`, `min`/`max` would make the plain-English guard — the entire user-facing point of this pipeline — unreachable for exactly the case it exists to handle, replacing it with an unstyled native tooltip. The divergence is required by the design's own `min`/`max` instruction and is correctly documented in both the code comment and the work-log.

**2. The `catch` (`statistics-form.tsx:249-253`) — CORRECT.**
- It never shows the error to the user: the toast is a fixed literal, `"We couldn't save this right now. Try again in a moment."` No interpolation of `err`, no `err.message`, no SQLSTATE.
- House voice matches almost verbatim: `reports-states.tsx:36` reads *"We couldn't load this section right now. Try again in a moment."* Same surface, same cadence.
- **`console.error` on a production path — acceptable.** It is `console.error`, not `console.log` (Workflow Rule 2's target), and lint passes at `--max-warnings=0`. It is **client-side**, so the precedent to compare is not `statistics-grants.ts:702`'s server-side `{ code }`-only discipline — that one exists because Drizzle's `DrizzleQueryError.message` embeds the query and params, which on that path carried a credential hash. Here the value logged is the client's view of a Server Action rejection, which Next redacts to a digest in production. The in-repo client precedent is `src/app/(email-verify)/error.tsx:13`, which logs the whole error object the same way. Consistent, not a new looseness.
- Residual worth one sentence: it logs `err` whole rather than a narrowed field, which is one notch looser than the server-side precedent. Given the redaction boundary, not worth a change; noted so Phase 6 sees it was considered.

## Enumeration Safety (anonymous grant path)

No branch was introduced. Read, not inferred:

- `submitStatisticsGrant`'s catch has exactly two arms — `42501 && GRANT_NOT_USABLE` → `{ kind: "invalid" }` (pre-existing, unchanged), and `22023 || 23514` → `{ kind: "invalid_input", message: GENERIC_FIELDS_ERROR }` (`statistics-grants.ts:671-684`). The redistricting refusal is SQLSTATE `22023` and lands in the second arm alongside the SASR field-bounds failure and the F80 collision guard. The fall-through logs `{ code }` only and returns `{ kind: "invalid" }`.
- Grepping every `message:` literal reachable from that function turns up three strings total, and the two others (`"Enter the name of the person attesting…"`, `"Enter the role…"`) are pre-existing request-shape checks that fire before any DB call and reveal nothing about the congregation.
- The diff changes one literal in one place; the RED run proves the pre-fix code already returned `invalid_input` for the redistricting cause, so the *fold* is not new — only the wording, and the test that pins it. `src/lib/statistics-grants.test.ts:743` asserts `toBe(GENERIC_FIELDS_ERROR)` (byte-identity, not substring), which is the right assertion: it fails the moment anyone branches this string.

Verdict on point 3 of the brief: **the anonymous path's redistricting response is byte-identical to a field-bound failure.** Confirmed.

## Regression Tests Added (by the implementer; verified by me)

- `src/lib/presbytery.test.ts:1072` — pre-affiliation year returns `invalid_input` instead of throwing. Guards: Bug 1, the uncaught `42501`. RED reproduced.
- `src/lib/presbytery.test.ts:1088` — affiliation-**start** year is accepted. Guards: an off-by-one that would make the picker reject a legal year. (Independently confirmed against the live trigger: 1995 accepted, 1994 refused.)
- `src/lib/presbytery.test.ts:1100` / `:1108` — `getCongregationStatisticsRollup` reports `affiliationMinYear` 2022/2000 with `affiliationMaxYear: null`. Guards: the read path and the `organization_affiliations_public` column contract. Real typed reads against the live view — no self-agreeing mock.
- `src/lib/statistics-grants.test.ts:743` — redistricting refusal is byte-identical to the shared bucket. Guards: the F40-class oracle.
- `statistics-form.test.tsx:64/:73/:87/:103` — `min` attribute, guard blocks without calling the action, in-window year is not blocked, rejected call clears `submitting`. Guards: the stuck-"Saving…" button and the client constraint.

## Named Coverage Gaps

1. **No test pins `maxYear = year(effective_to − 1 day)`.** Every fixture in all three touched test files has `effective_to = null`, so the entire closed-upper-bound branch of `fetchAffiliationWindows()` — the subtlest arithmetic in the diff, with a deliberate half-open off-by-one — has zero automated coverage, as does the multi-span envelope reduction. I verified the math is *correct* by live probe (Southern Fields `[null, 1995-01-01)`: 1994 accepted, 1995 refused), so this is a missing guard, not a defect. A fixture with a bounded `effective_to` asserting `affiliationMaxYear` closes it. Name it in the loop-back.
2. `permissions.ts` / `flags.ts` coverage could not be measured — an ad-hoc `--coverage.include` override produced an empty table in this worktree (the project coverage config filters them). Both modules are untouched by this diff. `two-factor.ts` measured at **91.3% stmts / 100% branch / 90.5% lines** (target 90%+, met). Carry the measurement gap to the release-slot test-coverage review, not this pipeline.
3. Cosmetic: `src/lib/statistics-grants.test.ts:737` says "REDISTRICTED_YEAR (2097)" while `:130` sets it to `2010`, and `:132`'s token is named `test-grant-redistricted-2097`. Stale from the earlier draft the Implementer Notes describe. Harmless, but it will mislead the next reader of the one test whose whole point is precision.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: not measurable this run (see gap 2); untouched by this diff
- `src/lib/two-factor.ts`: 91.3% statements / 100% branch — meets target
- `src/lib/flags.ts`: not measurable this run (see gap 2); untouched by this diff

## Feature-Gate Audit

Verified by reading the route/action bodies, not by inferring from green tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| **No `src/app/api/**/route.ts` added or changed** | n/a | n/a | n/a — no protected routes touched |
| `setCongregationStatisticsAction` (`…/admin/reports/actions.ts:59`) — **file unchanged by this diff** | yes, via `resolveActingIdentity(slug)` | n/a — tenant axis, not platform | `hasPermission(tx, …, STATISTICS_MANAGE)` inside `setCongregationStatistics` (`presbytery.ts:914`), **unchanged** — the diff adds a try/catch strictly inside the already-gated `withOrgContext()` callback, below the `forbidden` and `invalid_target` returns |
| `submitStatisticsGrant` (`statistics-grants.ts`) | n/a — anonymous, token-bearing by design | n/a | `statistics.submission_grants` flag + `presby_submit_granted_return()`'s own `GRANT_NOT_USABLE` check, **unchanged**; diff touches one message literal only |

No new permission, no new flag, no `FEATURE_CATALOG` edit. `npm run check:audit` clean. No new mutation, so no new audit event is owed; the existing `CONGREGATION_STATISTICS_ENTERED` write is still reached only on `kind: "ok"` — confirmed live in the browser run (one row in `audit_events` for the successful save, none for the guard-blocked click).

One observation, not a finding: `fetchAffiliationWindows()` reads **direct** spans (`parent_org_id = organizationId`) while `presby_org_affiliated()` is **transitive** (recursive ancestry, depth 8). Not reachable through this surface — `listMemberCongregations()` (`presbytery.ts:216-233`) selects on `organizations.parentId`, so every selectable congregation has a direct span. Worth knowing if the picker is ever reused on a surface that lists indirect members.

## Auth Gate

Not auth-touching. The diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`. The stricter Phase 5 gate does not apply. (An e2e sign-in was exercised anyway as part of the browser rehearsal, and worked.)

## Shared-File Discipline

`git diff --name-only 4461a46` against the reserved list returns **nothing**: `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `drizzle/` (incl. `meta/_journal.json`), `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `src/lib/db/domain/index.ts`, `package.json`, `package-lock.json` — all untouched. Workflow Rule 16 honored; the Phase 3/4 proposed lines for `docs/TODO.md` and `docs/product/functionality-map.md` are correctly parked in the work-log for the orchestrator to apply at integration. No migration; `0054` remains free for the founding-administrator pipeline.

## Tree Integrity After Verification

SHA-256 of all seven touched/added files verified identical to the pre-verification baseline. `git status --porcelain` shows the same six `M` and two `??` entries as at hand-off. `git stash list` empty. I wrote no repo file and mutated no schema.

## Verdict

**FAIL**

The production diff is sound. Every behavioural claim in Phase 4 that I could check independently held up: all three failing-first exercises reproduced with the reported signatures, the trigger literal and SQLSTATE are the real ones, the window arithmetic is correct on both boundaries against the live trigger, the view's grant and non-`security_invoker` posture are what the design asserts, the anonymous path stays byte-identical, both divergences are correct (and the `noValidate` one is not merely defensible but necessary — I reproduced the native-validation cancellation in chromium), and the 360px browser run passed end to end including the audit write.

What fails is a required check: **`npm run test:db` is red**, twice, deterministically, at `src/lib/db/fixture-deletable.test.ts:199` — three leaked fixture `people` rows from `src/lib/presbytery.test.ts`'s own `beforeAll`, left by the implementer's crashed first RED run and missed by the hand cleanup that Implementer Note 3 reports as complete. Phase 4's "4271 tests, all passed" is not reproducible; the canary ran earlier in file order than the leak. This is precisely the escape that canary exists to catch, and precisely the lesson the kickoff itself carried forward from the withdraw pipeline. I will not clean it up: this role does not mutate, and a QA agent that fixes the thing it is judging is not a check.

Not BLOCKED — nothing prevented the check from running. It ran and went red.

**To clear:**

1. On the owner connection, before **22:08:55 UTC** (after which `presby_guard_people_delete()` makes the rows permanent): `delete from people where deletable_until is not null and deletable_until > now();`
2. Re-run `npm run test:db` and post the result. Expect 4271/0.
3. While in Phase 4, close named gap 1: a fixture with a bounded `effective_to` asserting `affiliationMaxYear`, so the day-before-`effective_to` branch and the envelope reduction stop being untested. (I confirmed the math live; nothing guards it.)
4. Optional, one line: fix the stale `2097` comment at `src/lib/statistics-grants.test.ts:737` and the token name at `:132`.

Nothing here reopens Phase 3. No design flaw surfaced; the loop-back is to Phase 4 only.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — typecheck/lint/check/`npm test` green; failing-first independently reproduced for all 3 touched test files; live-catalog + trigger probes confirm the mapping, the boundary math and the view posture; 360px browser rehearsal passed; both divergences ruled correct; enumeration safety verified byte-identical. `npm run test:db` red on a pre-existing fixture leak from Phase 4's crashed RED run | FAIL | 2026-09-28 |



### Orchestrator note (2026-09-28, 21:09 UTC)

Step 1 of the remediation was time-boxed to 22:08:55 UTC, so the orchestrator ran it on the pipeline branch (`br-lingering-salad-ax56g25z`, owner connection): `delete from people where deletable_until is not null and deletable_until > now()` → `DELETE 3`; zero stamped rows remain. The loop-back to Phase 4 covers gap 1 (a bounded-`effective_to` fixture asserting `affiliationMaxYear`), the cosmetic `2097` comment/token, and the `test:db` re-run.

---

# Phase 5 — Verification (qa) — second pass (re-verification after the Phase 4 loop-back)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Date:** 2026-09-28
**Verified by:** qa (read-only; authored no tests, edited no repo file — see Tree Integrity)
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-errmap`, branch `pipeline/statistics-error-mapping`
**Connection:** `env | grep DATABASE_URL` empty before any run; `.env.local` → `select current_setting('neon.branch_id', true)` = `br-lingering-salad-ax56g25z` as `presby_app` on `neondb` — matches the kickoff. No `ALTER ROLE`, no `db:push`, no persisted DB write (every probe below ran inside a rolled-back transaction).

**Scope of this pass:** the first-pass FAIL items (the `test:db` red on the leaked fixture rows; named coverage gap 1; the cosmetic `2097` staleness) and the loop-back's edits only. The first pass's independently verified findings — failing-first ×3, trigger literal/SQLSTATE, view posture, anonymous-path byte-identity, both divergences, the 360px browser rehearsal — are not re-litigated; nothing in the loop-back touches the production code they covered (the only production change is `fetchAffiliationWindows()` going from module-private to `export`, additive visibility, no behaviour change — confirmed by reading `src/lib/presbytery.ts:296`).

## Type Check

- `npm run typecheck`: **PASS**
- `npm run lint` (`eslint --max-warnings=0`): **PASS**
- `npm run check` (audit-coverage · sql-date · deps-drift · brand-scope · secrets): **PASS**, all five reported individually.

## Unit Tests

**`npm run test:db`** (`dotenv -e .env.local -- vitest run --no-file-parallelism`, full serial run):
**Test Files 294 passed (294) | Tests 4275 passed (4275) | Failed 0 | Skipped 0 | 434.4s.** Matches the expected 294 / 4275 / 0 exactly. Zero `↓` skip markers in the output — no spec was silently skipped.

**Canary, run standalone *after* the full suite** (not relying on its mid-alphabet position ahead of `presbytery.test.ts`, which is how the first-pass leak escaped):
`src/lib/db/fixture-deletable.test.ts` — **5 passed (5)**. Note the canary covers `organizations` as well as `people` (`:232`, `:256`), so both fixture classes are clean, not just people.

**Leak probe** (`select count(*) from people where deletable_until is not null`) on `br-lingering-salad-ax56g25z`:
- before any run: **0**
- after the full `test:db`: **0**
- after my deliberate RED run (below): **0**
- final: **0**
`select count(*) from organizations where name like 'Fixture %for presbytery.test.ts'` after the RED run: **0**.

**`npm test`** (pure suite, `DATABASE_URL` explicitly unset): **260 files passed | 34 skipped; 3378 passed | 897 skipped (4275)**, 0 failed. The 897 skips are the `describe.skipIf(!hasDb)` DB-backed suites that `test:db` ran green above — accounted for, not silent.

**`src/lib/presbytery.test.ts` standalone: 52 passed (52)** (48 + the loop-back's 4).

## End-to-End Tests

Not re-run this pass. Not auth-touching (the diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`), so the stricter gate does not apply; the first pass already completed a real-browser 360px rehearsal against a dev server on port 3500 including the audit write, and the loop-back changed no production behaviour that rehearsal covered.

## Named Gap 1 — closed, verified independently

**The fixtures and tests read as claimed.** `congDeparted` (`presbytery.test.ts:239-271`) carries two closed spans to `presbyteryA` — `[2005-01-01, 2010-01-01)` and `[2015-01-01, 2020-01-01)` — each satisfying `organization_affiliations_closed_shape` with `closedByOrgId`/`closedOn`/`closedMinuteReference` set. `congRejoined` (`:279-306`) carries a closed `[2010-01-01, 2015-01-01)` plus an open `[2020-01-01, …)`. Both are deleted before `presbyteryA`/`presbyteryB` in `afterAll` (`:654-655`), correctly, because `organization_affiliations.parent_org_id` does not cascade.

**The bounded arithmetic is asserted at its real source.** `presbytery.test.ts:1315-1322` calls the now-exported `fetchAffiliationWindows(tx, presbyteryA)` inside `withOrgContext(clerkPerson, presbyteryA, …)` and asserts `{ minYear: 2005, maxYear: 2019 }` — `2019 = year(2020-01-01 − 1 day)`, taken from the *later* of the two closed spans, not the earlier one's `2009`. That single assertion exercises both the day-before-`effective_to` rule and the multi-span envelope reduction — the two things the first pass named as unguarded.

**Failing-first reproduced by me, not taken on report.** I restored-by-construction: copied `src/lib/presbytery.ts` to the session scratchpad, installed a shell `trap … EXIT` to restore it unconditionally, then removed the `− 24 * 60 * 60 * 1000` term at `src/lib/presbytery.ts:323` and ran the single test.

```
AssertionError: expected 2020 to be 2019 // Object.is equality
 ❯ src/lib/presbytery.test.ts:1321:33
 Test Files  1 failed (1)
```

Byte-for-byte the signature the implementer reported. GREEN restored: `52 passed (52)`. Tree verified byte-identical afterwards by `shasum -a 256 -c` against the pre-verification baseline of all seven touched/added files — all seven `OK`; `git status --porcelain` unchanged (same six `M`, two `??`); `git stash list` empty.

**The live trigger's boundary, probed directly (rolled back), both sides of a real closed span.** Quillhaven → Southern Fields, span `[null, 1995-01-01)`; Quillhaven → Northern Reach, span `[1995-01-01, ∞)`; `insert into congregation_statistics (organization_id, about_org_id, year, provenance)` as `presby_app` under each council's `app.current_org_id`:

| Report year | as Southern Fields (`effective_to = 1995-01-01`) | as Northern Reach (`effective_from = 1995-01-01`) |
|---|---|---|
| 1993 | ACCEPTED | REFUSED `42501` |
| 1994 | ACCEPTED | REFUSED `42501` |
| **1995** | **REFUSED `42501`** | **ACCEPTED** |
| 1996 | REFUSED `42501` | ACCEPTED |

The trigger refuses the year **at** `effective_to` and accepts the year before it — `maxYear = year(effective_to − 1 day)` is the correct model — and accepts the year of `effective_from` — `minYear = year(effective_from)` is correct. The refusing layer is named correctly by the design: `congregation_statistics_about_org` → `presby_check_about_org_affiliated()` → `presby_deny_about_org_write()`, SQLSTATE `42501`, literal `congregation_statistics: the organization this record is about was not affiliated with this council …` (re-confirmed on the wire this pass). The suite's own live-trigger tests at `presbytery.test.ts:1270` (year 2015, at `congRejoined`'s span-1 `effective_to` → `invalid_input`) and `:1286` (2014 → `ok`) pin the same fact through the application path.

## Ruling — the implementer's architectural note

**Correct, and verified three independent ways rather than accepted on argument.**

1. `presby_apply_affiliation_to_org_tree()` (`drizzle/0044_presby_org_lifecycle.sql:773+`) selects `parent_org_id` from `organization_affiliations` `where effective_to is null` and writes it to `organizations.parent_id`; with no open row, `parent_id` is left null.
2. `listMemberCongregations()` (`src/lib/presbytery.ts:216-233`) filters on `organizations.parentId = organizationId`, so every row `getCongregationStatisticsRollup()` can return has an open span to that presbytery.
3. Live-catalog probe: `select … from organizations o where o.parent_id is not null and not exists (open span to o.parent_id in organization_affiliations_public)` returns **0 rows**; the DB's one closed span (Quillhaven → Southern Fields, `effective_to 1995-01-01`) belongs to a subject whose `parent_id` is Northern Reach — so Southern Fields' own rollup never lists it.

Given `fetchAffiliationWindows()`'s reduction rule ("any unbounded span forces that side to null"), an open span guarantees `maxYear: null`. So a bounded `affiliationMaxYear` genuinely cannot surface through the rollup, and **the exported helper is the right test seam.** The loop-back was right to pin the arithmetic there rather than write an assertion the rollup can never satisfy.

**Note (not a FAIL, per the brief): yes, this makes the form's upper-bound code dead in practice on this surface today.** Unreachable as long as the rollup is the only producer of `congregations`:
- `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx:319` — `max={selectedCongregation?.affiliationMaxYear ?? undefined}`, always `undefined`.
- `:89-91` and `:95-97` — `affiliationWindowCopy()`'s "from X through Y" and "through Y — enter that year or earlier" branches.
- `:111-113` — `affiliationWindowError()`'s `year > max` branch.

These have **zero test coverage** as well as zero reachability: `statistics-form.test.tsx` sets `affiliationMaxYear: null` on every fixture and its only `max` assertion is `expect(yearInput.hasAttribute("max")).toBe(false)` (`:70`). I am not calling this a coverage FAIL, because a test would guard nothing a user can reach. It is defensive code that becomes live the moment the picker is fed from anything other than `listMemberCongregations()` — which the first pass already flagged as plausible (`fetchAffiliationWindows()` reads *direct* spans while `presby_org_affiliated()` is transitive). Recommended follow-up for Phase 6 to book, not a blocker: either a one-line comment on `statistics-form.tsx:319` recording that the upper bound is unreachable through today's rollup and why, or a `statistics-form.test.tsx` case with a synthetic bounded `affiliationMaxYear` prop so the copy branches are at least pinned before someone makes them reachable.

## Ruling — the `afterAll` restructure

**People cleanup is in the `finally`, and no FK-ordering trap was introduced.** `src/lib/presbytery.test.ts:577` opens the `try`; `:663-668` is the `finally` deleting the three fixture people and the `users` row. The org-side delete order is unchanged and correct: `congDeparted`/`congRejoined` are removed before `presbyteryA` (`:654-655`) because `organization_affiliations.parent_org_id` does not cascade — only `subject_org_id` does. The rejected literal reorder (people before organizations) is correctly rejected, and I verified the catalog fact it turns on rather than the schema file: `memberships_person_id_people_id_fk` is `ON DELETE CASCADE` (`confdeltype='c'`) while both `group_memberships_membership_fk` and `group_memberships_person_fk` are **NO ACTION** (`confdeltype='a'`) — DECISION-060's non-cascading gap, exactly as claimed.

Two findings, both non-blocking:

1. **`src/lib/presbytery.test.ts:670-673` is a verbatim duplicate of the `finally` body**, left in place after the same code was added at `:663-668`. Harmless — idempotent deletes that match zero rows, and unreachable when the `try` throws — but it is dead code that contradicts the work-log's description of the cleanup as having been *moved* into the `finally`. Worth deleting so the next reader doesn't take it for a second, meaningful pass.
2. **The `finally` is weaker than the work-log's claim, and the claim should be softened.** The work-log says the cleanup "runs even if an earlier step throws." It is *attempted*; it will not always *succeed*. In the precise failure mode that produced the first-pass leak — a throw inside the organizations-delete block, leaving `presbyteryA` alive with the clerk/narrow `memberships` rows and their derived "Active Membership" `group_memberships` rows — the `finally`'s `delete from people` cascades into `memberships` and immediately trips the NO ACTION `group_memberships` FK, so it raises and the people rows leak anyway. The `finally` is real insurance against failures occurring *after* the orgs are gone; it is not insurance against the one that actually happened. What genuinely closed that hole is the delete-ordering fix (`congLateAffiliation`, then `congDeparted`/`congRejoined`, all before `presbyteryA`), and that is verified green across a full serial suite plus a deliberate RED run with zero leaked rows at every checkpoint. Recommend the work-log sentence read "attempted" rather than "runs", so a future reader doesn't rely on a guarantee that isn't there.

## Cosmetic fix (first-pass gap 3) — closed

`grep -n "2097" src/lib/statistics-grants.test.ts` returns nothing. `REDISTRICTED_TOKEN` is `"test-grant-redistricted-2010"` (`:132`) and the comment at `:737` reads `REDISTRICTED_YEAR (2010)`, both matching `REDISTRICTED_YEAR = 2010` (`:130`).

## Regression Tests Added (by the implementer; verified by me this pass)

- `src/lib/presbytery.test.ts:1315` — `fetchAffiliationWindows` returns `{minYear: 2005, maxYear: 2019}` for a two-closed-span subject. Guards: the day-before-`effective_to` arithmetic **and** the multi-span envelope reduction. RED reproduced independently (`expected 2020 to be 2019`).
- `src/lib/presbytery.test.ts:1270` — year at span-1's `effective_to` (2015) returns `invalid_input` naming the congregation and the year. Guards: the gap-year refusal, through the real live trigger. Carries the `— regression for statistics form year guard and error mapping` suffix.
- `src/lib/presbytery.test.ts:1286` — year 2014 returns `ok`. Guards: the exclusive-upper-bound rule against an off-by-one that would reject a legal year. Independently corroborated by the live probe table above.
- `src/lib/presbytery.test.ts:1298` — rollup reports `congRejoined` as `{min: 2010, max: null}`. Guards: documents the envelope-forced-null behaviour rather than fighting it.
- Carried forward from the first pass, all still green: `presbytery.test.ts:1072`/`:1088`/`:1100`/`:1108`, `statistics-grants.test.ts:743` (`toBe(GENERIC_FIELDS_ERROR)`, byte-identity — the F40-class oracle guard), `statistics-form.test.tsx:64`/`:73`/`:87`/`:103`.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: not measured this pass — untouched by this diff; the measurement gap the first pass named (an ad-hoc `--coverage.include` override yields an empty table in this worktree) is carried to the release-slot `test-coverage` review, not this pipeline.
- `src/lib/two-factor.ts`: 91.3% statements / 100% branch (measured first pass; target 90%+ met). Untouched by the loop-back.
- `src/lib/flags.ts`: not measured this pass — untouched by this diff; same carry-forward.

## Feature-Gate Audit

Unchanged from the first pass and re-confirmed by reading, not inferred: the loop-back's only production edit is an `export` keyword and a doc comment.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| **No `src/app/api/**/route.ts` added or changed** | n/a | n/a | n/a — no protected routes touched |
| `setCongregationStatisticsAction` (`…/admin/reports/actions.ts:59`) — **file unchanged by this diff** | yes, via `resolveActingIdentity(slug)` | n/a — tenant axis, not platform | `hasPermission(tx, …, STATISTICS_MANAGE)` inside `setCongregationStatistics` (`presbytery.ts`), unchanged |
| `submitStatisticsGrant` (`statistics-grants.ts`) | n/a — anonymous, token-bearing by design | n/a | `statistics.submission_grants` flag + `presby_submit_granted_return()`'s `GRANT_NOT_USABLE` check, unchanged |
| `fetchAffiliationWindows` (`presbytery.ts:296`) — newly **exported** | n/a — not an action or route | n/a | Callable only from server modules; its sole production caller is `getCongregationStatisticsRollup()` (`:787`), inside the already-permission-gated `withOrgContext()` callback. Exporting widens the module surface, not the trust boundary: it takes an `OrgTx` it cannot mint itself, so a caller must already hold an authorized org context. No new gate owed. |

`npm run check:audit` clean; no new mutation, so no new audit event is owed.

## Shared-File Discipline

`git diff --name-only 4461a46` returns exactly the same six files as at first-pass hand-off — `src/lib/presbytery.ts`, `src/lib/presbytery.test.ts`, `src/lib/statistics-grants.ts`, `src/lib/statistics-grants.test.ts`, `src/app/(org)/o/[slug]/admin/reports/page.tsx`, `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` — plus the two untracked (work-log, `statistics-form.test.tsx`). Grepping that list against the reserved set (`scripts/test-rls.sql`, `scripts/seed-dev.sql`, `drizzle/` incl. `meta/_journal.json`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/product/functionality-map.md`, `src/lib/db/domain/index.ts`, `package.json`, `package-lock.json`, `CLAUDE.md`) returns **nothing touched**. No migration; `0054` remains free. Workflow Rule 16 honored; the Phase 3/4 proposed lines for `docs/TODO.md` and the functionality map stay parked for the orchestrator at integration.

## Tree Integrity After Verification

`shasum -a 256 -c` against the pre-verification baseline: all seven touched/added files **OK**. `git status --porcelain` identical to hand-off. `git stash list` empty. No repo file written, no schema mutated, no DB row persisted — the one deliberate source edit (the `− 1 day` removal for the failing-first proof) was restored under a shell `EXIT` trap and hash-verified.

## Verdict

**PASS**

Every first-pass FAIL item is closed and independently re-verified. `npm run test:db` is green at 294 files / 4275 tests / 0 failed / 0 skipped; the canary run standalone *after* the suite is 5/5; stamped `people` is 0 at four separate checkpoints including after a deliberate RED run. Named gap 1 is genuinely closed, not papered over — the bounded `year(effective_to − 1 day)` arithmetic and the multi-span envelope are pinned by a real assertion against real rows, I reproduced its RED myself (`expected 2020 to be 2019`, `src/lib/presbytery.test.ts:1321`) and restored the tree byte-identical, and I confirmed against the live trigger on both sides of a real closed span that the model the code implements is the model the database enforces. The implementer's architectural note is correct on all three legs, including a live-catalog probe of the `parent_id`-vs-open-span claim. The teardown restructure introduces no FK-ordering trap and rests on catalog facts I checked rather than on the schema file. The cosmetic `2097` staleness is gone. Typecheck, lint, all five tripwires, and the pure suite are green; the diff scope is unchanged and no shared file is touched.

Three things Phase 6 should carry, none of them blocking:

1. The form's upper-bound path (`statistics-form.tsx:319`, `:89-91`, `:95-97`, `:111-113`) is dead in practice through today's rollup and untested — worth a comment or a synthetic-prop test before someone makes it reachable.
2. `src/lib/presbytery.test.ts:670-673` is a dead duplicate of the `finally` body and should be deleted.
3. The work-log's "the people cleanup runs even if an earlier step throws" overstates the guarantee — in the exact failure mode that caused the first-pass leak it will itself raise on the `memberships`→`group_memberships` NO ACTION FK. "Attempted" is the accurate word; the real fix was the delete ordering.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | **Complete (second pass)** — `test:db` 294 files / 4275 / 0, zero skips; canary standalone after the suite 5/5; stamped `people` 0 at every checkpoint; named gap 1 closed and its failing-first (`expected 2020 to be 2019`, `presbytery.test.ts:1321`) reproduced independently with the tree restored byte-identical; live-trigger boundary re-probed both sides (year at `effective_to` refused, year before accepted); implementer's architectural note ruled correct via three checks incl. a live-catalog probe — with the note that the form's `max` path is consequently dead in practice and untested; `afterAll` `finally` confirmed with no FK trap (two non-blocking notes); `2097` staleness gone; typecheck/lint/check/`npm test` green; diff scope and shared files unchanged | **PASS** | 2026-09-28 |

**Handoff:** → **analyst (Phase 6)**, shipped-vs-intent against the Phase 1 description. Give the analyst the three carried notes above; items 1 and 2 are candidate `SHIP WITH NOTES` follow-ups for `docs/TODO.md` (Workflow Rule 10), and item 3 is a one-word correction to the Phase 4 loop-back subsection the orchestrator can apply when recording this section.



### Orchestrator note (2026-09-28)

QA note 2 applied as a Trivial edit: the dead duplicate cleanup block after the `finally` in `src/lib/presbytery.test.ts` removed (typecheck clean). Note 3: the loop-back subsection's "runs even if an earlier step throws" is read as "is attempted"; the delete ordering is the real fix. Note 1 (the form's unreachable upper-bound path) goes to Phase 6 as a candidate follow-up.

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

