# Withdraw a published statistical return — `presby_withdraw_publication()`, the read-side filter, and the presbytery/congregation UI — Work Log

> **Slug:** `2026-09-26-withdraw-publication`
> **Surface:** mixed — the congregation's own reports surface (withdraw what it published) and the presbytery reports page (see a withdrawn return as withdrawn); `src/lib/presbytery.ts` rollups
> **Permission(s):** analyst to name — likely `statistics.publish` (the congregation withdraws its own publication) with the presbytery never able to withdraw on the congregation's behalf; state it
> **Flag(s):** analyst to decide — the existing `org_portal.reports` flag may cover it
> **Estimated complexity:** large (raised at Phase 1 — the congregation reports page is built here)
> **Pipeline mode:** Full
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26, wave 4):** worktree `../presby-wt-withdraw` on git branch `pipeline/withdraw`; Neon branch `pipeline-withdraw` (`br-snowy-recipe-axcqdbx4`, forked from `development` at the v0.26.2 state). **Pre-assigned numbers:** migration `drizzle/0052_presby_withdraw_publication.sql`; `DECISION-152`; findings `F90` onward. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge). **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148). Dev-server port `3600`; stop by PID; never `pkill -f`.
> **Design authority:** `docs/schema-design-2.md` §2f F52 and §2g F56 (withdrawal is Option A — retain as a historical record, exclude by column; the withdrawal is an all-or-nothing PAIR: `publications.{withdrawn_at, withdrawn_by, withdrawn_minute_reference}` and the projection row's `congregation_statistics.withdrawn_at`, both behind the `presby.withdrawal_write_active` marker, **armed by nothing today** — neither table's one permitted transition is reachable on any connection until `presby_withdraw_publication()` arms it inside one SECURITY DEFINER function); `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` tech-lead fourth amendment Ruling 6 and fifth amendment; `docs/TODO.md`'s line on `getCongregationStatisticsRollup()` (`src/lib/presbytery.ts`) — the "current" totals must filter `withdrawn_at is null`, owned by THIS pipeline as the first thing that can make the column non-null; DECISION-141 (the GUC is a workflow marker, privilege is the authority boundary — `presby_app` holds no UPDATE on the withdrawal columns, so the tenant path is closed at the grant layer and only the DEFINER function can perform the pair); DECISION-135 (cross-council access is function-mediated; the actor is derived from `presby_current_org()`); `supersedes_id` (a corrected submission is a new publication; withdrawal retracts without replacing — rule how `fetchStatisticsForYear`'s latest-`published_at` coalesce treats a withdrawn latest row).
> **User verbs (to refine):** a congregation's clerk (`statistics.publish`) withdraws a return it published, citing a minute reference; the presbytery sees the return marked withdrawn (not deleted) with the date and reference, and its rollups exclude it; a later corrected submission supersedes normally; an `unmanaged` congregation's grant-submitted return can only be withdrawn by … (analyst: who? the presbytery on request? nobody until managed? — the D9 handover question again); audit events for the withdrawal on both sides; what the archival read (`presby_list_published_returns_to_me()`) returns for a withdrawn row.
> **Constraints:** the function derives the acting org from `presby_current_org()` and refuses if it is not the publication's source org; arms `presby.withdrawal_write_active` for exactly the pair and disarms; one uniform refusal literal (F40's one-claim-one-literal discipline); `search_path = public, pg_temp`; `test-rls.sql` §41 appended (the pair proven atomic — a failure after the first UPDATE leaves neither; the tenant path still refused at the grant; the archival read's treatment); `publication.test.ts`'s positive control at `:536` (manual arming on the owner connection) must be re-pointed at the real function.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — the congregation reports surface does not exist (built here by ruling); grant-submitted returns of unmanaged congregations cannot be withdrawn by anyone until managed | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Complete — placement `(org)/o/[slug]/admin/filings` + nested `reports/[aboutOrgId]`; flag `org_portal.filings`; function shape and refusal split ruled; kickoff ruling 2 corrected (0052 creates the congregation stated-clerk template, id `…0004`, no backfill) | Approved with suggestions | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — full DDL for `drizzle/0052` (helper + `presby_withdraw_publication()` + template role), all four Phase 2 handoff items answered (bootstrap = standing gap, deferred; route = `reports/[aboutOrgId]`; refusal copy table; length CHECK declined), new `src/lib/filings.ts` module, three-batch implementation order, F90 named (an existing `test-rls.sql` assertion's literal goes false the day this ships and must be corrected in place, not just appended around) | Design complete, implementers named | 2026-09-26 |
| 4 — Implementation | database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C) | **Complete (after one Phase 5 loop-back, 2026-09-26 — two test fixtures, no product-code change).** Loop-back: `scripts/test-rls.sql` §41(c) and §41(f) fixture picks made state-agnostic and one new §41(e) assertion added (suite is now 551, was 550); `publication.test.ts`'s `withdrawalFixture()` now mints its own publication chain per probe instead of consuming the single seeded one. Proven on two scratch databases inside `pipeline-withdraw` — failing-first reproduced (532/550 and 9 failed/36 passed on a committed-withdrawal fixture), green after (551 and 45/45), green on a pristine fixture too, and green on the pipeline branch DB QA had declared unrunnable. `typecheck`/`lint`/`check`/`test:db` (4214/0 on both scratch DBs). Batch A: hand-written `drizzle/0052`, applied twice idempotently to `pipeline-withdraw` and rehearsed from empty; `test-rls.sql` §41 added, §35 corrected in place for F90; `publication.test.ts` re-pointed at the real writer; one design defect corrected — `people` has no `organization_id`, proposed F91. Batch B: `src/lib/filings.ts` new; `fetchStatisticsForYear()` withdrawal filter; new `getCongregationFilingHistory()`; `withdrawFilingAction()`; `STATISTICS_RETURN_WITHDRAWN` audit key; `filings` tile + `org_portal.filings` flag seeded off; 45 new tests. Batch C: `admin/filings/{page.tsx, filings-states.tsx, withdraw-dialog.tsx, page.test.tsx}` (new), `admin/reports/[aboutOrgId]/{page.tsx, page.test.tsx}` (new), `statistics-table.tsx` `<Link>` + `slug` threading; 18 new tests; one real bug found and fixed via the mandatory browser rehearsal (a `server-only`-marked module imported from a client component); both flows walked end to end at 360px with screenshots and DB-level verification. `npm run test:db` — 291 files/4214 tests passing, 0 failed. | — | 2026-09-26 |
| 5 — Verification | qa | **Second pass: PASS** — both red checks cleared on the branch DB as-is (551 / 45) and on a pristine scratch DB before and after a QA-committed withdrawal; full DB suite 4214/0; new §41 assertion failing-first by hoisting the state check (541/551). First pass: **Re-verification pending** (Phase 4 loop-back delivered 2026-09-26; re-run the two previously-red checks — `scripts/test-rls.sql` now expects **551** assertions, `npm run test:db` 4214/0). First pass: FAIL (first pass) — product code verified correct on the live catalog, by behavioural probe, from-empty (550) and a real 360px browser walk; two required checks red on the delivered branch because §41(c) and `publication.test.ts`'s `withdrawalFixture()` consume the single seeded publication the browser rehearsal irreversibly withdrew. Looped back to Phase 4. | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.28.0 | SHIP WITH NOTES | 2026-09-26 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The database half of this feature (`presby_withdraw_publication()`, the pair's atomicity, the read-side filter) is precisely specified and ready to design against — but the request's stated surface, "the congregation's reports page," does not exist (deferred twice already, per `docs/TODO.md:114`), so Phase 3 needs an explicit scope call on whether this pipeline also builds the congregation's first-ever self-service statistics page or whether "withdraw" ships as backend-plus-presbytery-visibility only, with the button attached to a page a *later* pipeline still owes.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member of a `managed` congregation, holding `statistics.publish` (stated clerk, by seed convention) — **surface does not exist**: no page under `(org)/o/[slug]/` is reachable for an org of type `congregation` today; `/admin/reports` is hard-scoped `orgTypeScope: ["presbytery"]` (`src/lib/org-portal/tiles.ts:389`) and its own page component returns `PlaceholderNotAvailable` for any other org type (`src/app/(org)/o/[slug]/admin/reports/page.tsx:105-106`) | Views own filing history (`presby_list_own_congregation_publications()`, built since `drizzle/0038`, zero UI consumers — `docs/TODO.md:114` item 1) | On demand, around filing season |
| Same congregation surface | Withdraws a specific published return, entering a minute reference | Rare — this is a correction/retraction, not routine |
| Same congregation surface (later) | Re-publishes a corrected return for the same year | Same cadence as filing — **also has no UI**: `presby_publish_sasr_snapshot()` has zero application callers (`grep` finds it only in `src/lib/presbytery.ts`'s own doc comments, tests, and `dev-docs.ts`) |
| Presbytery admin/stated clerk holding `statistics.manage`, on `/o/<slug>/admin/reports` (exists) | Sees a member congregation's current-year rollup reflect a withdrawal (row excluded from "current," or visibly marked) | Per reporting cycle |
| Presbytery admin/stated clerk, on `/o/<slug>/admin/reports` (or a new sub-view — **doesn't exist today**) | Reads the full filing history for one congregation/year, including withdrawn rows, with who/when/why | Occasional — audit, dispute, per-capita basis-year investigation |
| An `unmanaged`/`invited` congregation's clerk, via the public grant-submission link (no account, no session) | **Cannot withdraw** — no verb exists or should exist for this actor at this platform_status; see Flow 3 |
| Presbytery clerk, acting on an `unmanaged`/`invited` congregation's grant-submitted return | **Recommend: no verb** — see Flow 3 and the D9 reasoning below |

The request's own kickoff block already used "the congregation's clerk" without naming which surface — Pass 1's own warning applies, and the answer turns out to be "a surface that isn't built," not merely an unnamed one.

## Flows

**Flow 1 — A managed congregation withdraws its own published return.**

Entry: (missing today) — a congregation-type `/admin/reports`-equivalent page listing the org's own publications for a chosen year, sourced from `presby_list_own_congregation_publications(year)`, with a "Withdraw" action next to the **current, non-superseded, non-withdrawn** row only.

- Step 1: clerk selects a publication and opens the withdraw control.
- Step 2: `AlertDialog` (native `confirm()` is forbidden — `docs/ui-standards.md:660`) states the act is permanent ("neither reversed, re-dated nor re-minuted" — `drizzle/0047:293`) and requires a minute reference (text, required, bounded — no existing DB-level length CHECK on `withdrawn_minute_reference`, so this is app-layer-only unless one is added; `presbytery.ts`'s own `MINUTE_REFERENCE_MAX = 500` is the precedent to reuse).
- Step 3: submit → `presby_withdraw_publication(p_publication_id, p_withdrawn_by, p_minute_reference)` runs inside `withOrgContext()`, verifies `organization_id = presby_current_org()`, arms `presby.withdrawal_write_active`, and updates `publications` and `congregation_statistics` together in one transaction.
- Outcome: row now reads "Withdrawn `<date>` · `<minute>`"; the action is gone/disabled on that row; `AUDIT_ACTIONS` gets a new key (e.g. `STATISTICS_RETURN_WITHDRAWN`) written from the `actions.ts` wrapper, matching the existing `STATISTICS_GRANT_ISSUED` call-site convention (`src/app/(org)/o/[slug]/admin/reports/actions.ts:340-349` — `recordAudit()` is called from the server action, not the lib function).
- Failure paths (none named in the request — Pass 2's flag):
  - Not the owning org / bad id → one uniform "not found" message (see Adversarial Pass — this must NOT distinguish "no such publication" from "belongs to another org," an F40-class oracle).
  - Already withdrawn → a friendly "already withdrawn" state, not the raw `check_violation` text (`already withdrawn at %; a withdrawal is itself an act…`, `drizzle/0047:292-295`) — the button should also be absent by then, but the server path is reachable directly.
  - Blank/overlong minute reference → inline validation, same pattern as every other minuted-act form in this codebase.
  - DB/network failure → generic failure toast (`docs/ui-standards.md`'s existing convention), never a stack trace.

**Flow 2 — The presbytery sees the return marked withdrawn.**

Entry: the existing `/o/<slug>/admin/reports` "Congregation Statistics" section (presbytery-only), backed by `getCongregationStatisticsRollup()` → `fetchStatisticsForYear()`.

- Today `fetchStatisticsForYear()` (`src/lib/presbytery.ts:511-548`) does **not** filter `withdrawn_at is null` — this is the exact obligation `docs/TODO.md:127` and Ruling 6 item 4 assign to this pipeline, and it is currently a no-op only because nothing can set the column yet. Once `presby_withdraw_publication()` ships, this function becomes live and wrong if unchanged: a withdrawn `published_by_congregation` row, being the latest by `publishedAt`, would still win the coalesce and display as "current."
- Resolution this pipeline owes, stated precisely (not in the request): a withdrawn `published_by_congregation` row must be treated as if it does not exist for the "current" pick — which means the coalesce must fall through to a live `presbytery_entered`/`imported` row for that congregation/year if one exists, or to "no data on file" if none does. The request never says which of those two outcomes is correct; I recommend the fallback (withdrawal ≠ "no filing ever existed," it's "this filing is retracted," and a presbytery-entered shadow record, if one was keyed in, is still real data) — but this is a product call tech-lead should confirm in Phase 3, not something the schema alone settles.
- Outcome: current-year totals no longer include the withdrawn return; per-capita basis-year lookups (same coalesce, `src/lib/presbytery.ts:522`) are affected identically — a withdrawn return can no longer be the basis for a per-capita bill going forward. **Not addressed by this request**: what happens to a per-capita bill *already generated* off a since-withdrawn return? `generatePerCapitaRecords`'s own doc comment (`presbytery.ts:72-79`) says it never overwrites an existing bill — so a stale per-capita record survives a withdrawal untouched. Flagging as a gap, not solving it here.
- **The archival read has no UI either.** `presby_list_published_returns_to_me()` already returns every publication (including withdrawn ones, full triple, no filter — confirmed by reading `drizzle/0047`'s live definition) to the presbytery side, but nothing in `src/app` calls it. "The presbytery sees withdrawn, marked" therefore requires *new* UI on the presbytery side too, not just a schema-side filter fix.

**Flow 3 — An `unmanaged`/`invited` congregation's grant-submitted return.**

Recommend: **nobody can withdraw it, full stop, until the congregation becomes `managed`.** Reasoning, not preference:

- D16's own stated consequence (`docs/schema-design-2.md:368`, restated at `:2005`): "a grant-submitted return for an `unmanaged` congregation is owned by the congregation, in a tenant nobody can enter; when it becomes `managed` it inherits its own filing history — D9's handover working as designed." Withdrawal is the same shape of act as any other write to that congregation's own record — the design already answered "who acts for a tenant nobody can enter" as "nobody, until it's a tenant someone can enter."
- The withdrawal triple is a minuted council act, attributed to the withdrawing council (`withdrawnBy`, `withdrawnMinuteReference` — the same council-authorization discipline as `publications.minuteReference`, `drizzle/0047:139-143`). The council that filed the return is the congregation's own session; a presbytery has no session that could authorize withdrawing *another council's* act without either (a) falsely attributing the withdrawal to a council that didn't take it, or (b) the design growing a second, structurally different "presbytery withdraws a publication addressed to itself" mechanism that doesn't exist and isn't scoped here.
- Two Hierarchies: "Access flows up by publication, never down by inheritance. The only downward paths are an administrative commission and a session-granted delegation, both time-boxed and minuted." No such commission or delegation exists in this design for statistics; inventing one is out of scope for a withdraw-feature pipeline.
- `presby_withdraw_publication()`'s own stated shape (this pipeline's Constraints block: "derives the acting org from `presby_current_org()` and refuses if it is not the publication's source org") makes this the *correct*, not merely convenient, outcome: an `unmanaged`/`invited` org never has a session, so `presby_current_org()` can never resolve to it, and the function is correctly unreachable for this case rather than insecurely reachable. This is a case the function's own design already closes; Phase 1's job is to say so explicitly rather than let it surface as a surprise "why can't I withdraw this" support ticket.
- If a presbytery discovers an error in a grant-submitted return, the existing (if UI-less) remedy is a `presbytery_entered` correction — a **new** row under the presbytery's own provenance and its own minute, not a mutation of the congregation's submitted artifact. That preserves the one-column-two-facts discipline (F39) this design already enforces between `publications.minuteReference` and `congregation_statistics.minuteReference`.

## Permissions & Flags

- **Permission:** reuse `statistics.publish` (existing, tier 2, module `presbytery`, bound to the congregation's `stated_clerk` per `scripts/seed-dev.sql`'s own convention — `drizzle/0038:725-727`). A new `statistics.withdraw` is not justified: publish and withdraw are the same real-world authority (the officer who may file a return is the officer who may retract it), and DECISION-078's sensitivity test would land it at the same tier for the same reason. Flagged as an **open question for the user**, not decided unilaterally, since the request text explicitly floated the split.
- **Default roles:** none via `app_role_permissions` today — `statistics.publish` currently has **zero** default bindings in the shipped migration (only `statistics.manage`/`per_capita.manage` are seeded there, `drizzle/0038:730-733`); the comment says it's "Bound to the CONGREGATION's stated_clerk in `scripts/seed-dev.sql`" — i.e. only in the dev fixture, not in a real deployed role template. **This is a pre-existing gap this pipeline inherits, not one it created** — confirm with tech-lead whether shipping a congregation-facing publish/withdraw UI without a real default-role binding is acceptable, or whether that binding is owed as part of this pipeline's implementation order.
- **Flag:** `org_portal.reports` cannot be reused as-is for a congregation surface — the tile carrying that flag key is hard-scoped `orgTypeScope: ["presbytery"]` (`src/lib/org-portal/tiles.ts:389`), and its page component's `REPORTS_ORG_TYPES` constant enforces the same restriction independently. A congregation-side page needs either a new flag key (my recommendation, for independent rollout — a presbytery could keep `org_portal.reports` on while a not-yet-ready congregation self-service surface stays off) or an explicit widening of the existing tile's org-type scope plus a second flag gate inside the page. This is a Phase 2/3 call; naming it is Phase 1's job.
- **Mechanism, confirmed correct, not something to re-litigate:** `presby_app`'s column-level grants already exclude `withdrawn_at`/`publication_id` on `congregation_statistics` and hold no `UPDATE` at all on `publications` (`drizzle/0047` §10, QA-2). The only reachable path for a tenant connection is a new `SECURITY DEFINER` function granted `EXECUTE` to `presby_app`, exactly `presby_publish_sasr_snapshot()`'s shape. The Constraints block's list of what the function must do (derive acting org, arm-then-disarm, refuse otherwise) matches this shape precisely.

## Gaps the Request Didn't Address

1. **The congregation-side reports/publish surface does not exist and has been deferred twice** (`docs/TODO.md:114` item 1). This request's premise — "where does the UI live — the congregation's reports page" — presupposes a page that has never been built. Either this pipeline builds a minimal one (a new tile, a new flag, a new page under a congregation `orgTypeScope`, at minimum a filing-history list + withdraw action), or the withdraw feature ships with no way for a real clerk to ever invoke it, which would make Phase 6 unshippable on its own terms. This changes the "medium complexity" estimate materially and architect/tech-lead need to know it going in.
2. **`withdrawnBy` has no source of truth.** `publications.withdrawnBy` is `NOT NULL`-in-effect (the withdrawal-shape CHECK requires all three columns or none), but no `app.current_user_id` GUC exists (`docs/TODO.md:55`, confirmed absent from `src/lib/authz.ts`'s `withOrgContext()`). The precedent already in this codebase is `setCongregationStatistics(viewerPersonId, organizationId, actingUserId, ...)` (`src/lib/presbytery.ts:618-621`) — `actingUserId` passed explicitly from the authenticated session at the TypeScript layer, never accepted from client input, never read from a GUC. Recommend the same shape for `presby_withdraw_publication()`'s TypeScript wrapper. Not building this cleanly is a real risk: a bare `p_withdrawn_by uuid` SQL parameter with no server-side binding to `session.user.id` would let one member of the same org misattribute a withdrawal to a colleague — a same-tenant integrity problem, smaller than a cross-tenant leak, but still worth a named test.
3. **Presbytery-side archival UI does not exist.** `presby_list_published_returns_to_me()` has zero application callers today. "The presbytery sees withdrawn, marked" needs new UI, not just the schema-side filter fix this pipeline already owns.
4. **Which publication may be withdrawn — current head only, or any historical one?** Nothing in `presby_freeze_publication()` restricts withdrawal to the chain's current (non-superseded) row; only "not already withdrawn" is checked. Withdrawing a superseded (non-current) publication would mark a historical row that no longer drives any display, producing a confusing archival state ("corrected, and also separately withdrawn"). Recommend the withdraw function (or its caller) refuse a publication that has something superseding it, with a distinct, honest message — this is a real design decision the request never made and the schema doesn't force either way.
5. **What happens to an already-generated per-capita record when its basis-year return is later withdrawn?** `generatePerCapitaRecords()` never overwrites an existing bill (Phase 3's own "republish-after-billing" rule) — a stale bill silently survives a withdrawal of the return it was based on. Named, not solved, here.
6. **No length bound on `withdrawn_minute_reference`** at the DB layer (matches `minuteReference`'s existing lack of one) — app-layer zod validation is the only gate; `MINUTE_REFERENCE_MAX = 500` is the existing convention to reuse.
7. **Default role binding for `statistics.publish` is real-deployment-absent** (item under Permissions above) — pre-existing, but this pipeline is the first to make the permission load-bearing for a second (destructive) action.

## Out of Scope (confirm with user)

- Building the full congregation self-service SASR *filing* flow (the publish form itself) — only the withdraw of an already-published return is asked for. If Gap 1 is resolved by building a minimal congregation reports page, it will necessarily expose *some* read surface (filing history) even without a publish form; confirm that's acceptable rather than confusing (a page that can only show history and withdraw, never file, for a congregation with zero returns on file yet).
- Any presbytery-initiated withdrawal mechanism for a return it received — ruled out in Flow 3, not merely deferred; building one is a separate, scoped design question if ever needed.
- Correcting a stale per-capita bill after a withdrawal (Gap 5).
- The platform-wide `app.current_user_id` GUC — Gap 2's recommendation avoids needing it by following the `setCongregationStatistics` precedent instead.

## Open Questions

- Does the user want this pipeline to also build the minimal congregation-side reports/filing-history page (Gap 1), or should "withdraw" ship as backend + presbytery-visibility only, with the button wired up by whichever future pipeline finally builds congregation self-service? This materially changes scope and should be answered before Phase 2.
- `statistics.publish` reused, or a new `statistics.withdraw`? (Permissions section — I recommend reuse, but the request explicitly raised the split.)
- When the presbytery's "current" rollup excludes a withdrawn return, should it fall back to a `presbytery_entered`/`imported` row for that congregation/year if one exists, or always show "no data on file" once the published return is gone? (Flow 2.)
- May a superseded (non-current) publication be withdrawn at all, or should the function refuse and say so? (Gap 4.)
- Is a new congregation-facing flag needed, or should the existing `org_portal.reports` tile's `orgTypeScope` widen to include congregations with a second internal gate? (Permissions & Flags.)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Pending | — | — |



### Orchestrator rulings on the open questions (2026-09-26)

1. **Build the minimal congregation-side reports page in this pipeline** — a filing-history list (`presby_list_own_congregation_publications()`, deferred twice already) with the Withdraw action; no publish form (the self-service filing form stays a later pipeline; the page states that plainly in its empty state). Complexity is now **large**, not medium.
2. **Reuse `statistics.publish`**; add its real default-role binding (the congregation `stated_clerk` template) in `drizzle/0052` — the tech-lead rules the mechanism. No `statistics.withdraw`.
3. **Rollup fallback:** a withdrawn published row is treated as absent for the "current" pick; the coalesce falls through to a live `presbytery_entered`/`imported` row if one exists, else "no data on file".
4. **Superseded publications cannot be withdrawn** — refuse with its own honest message; only the current head may be withdrawn.
5. **A new flag** for the congregation page (e.g. `org_portal.congregation_reports`, seeded off) rather than widening the presbytery tile's scope; the architect rules the tile/route shape.
6. **`withdrawnBy` is the session user id passed explicitly at the TypeScript layer** (`setCongregationStatistics()`'s precedent), never a client input, never a GUC.
7. **Presbytery-side archival view:** in scope as a minimal per-congregation history sub-view on the existing reports page (withdrawn rows marked with date and reference); the per-capita stale-bill gap (Gap 5) is a TODO line, not built here.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## Verdict

**Approved with suggestions** — the feature shape is right and Phase 3 can start. Two findings materially change what Phase 3 must design: the congregation `stated_clerk` **template role does not exist** (ruling 2 of the kickoff presumes it does), and the congregation's own filing history **needs no new SECURITY DEFINER function** (the tenant policy already answers). Both resolved below rather than looped back.

*Live-catalog verification (review step 5, Neon branch `pipeline-withdraw`, not read off `drizzle/`):* `publications` and `congregation_statistics` are both `relrowsecurity` + `relforcerowsecurity`; `presby_app`'s `relacl` on `publications` is `SELECT` only; on `congregation_statistics` it is table-level `SELECT`/`DELETE` plus column-level `INSERT`/`UPDATE` with **no** entry of either kind in `pg_attribute.attacl` for `withdrawn_at` or `publication_id`; `app_roles where organization_id is null` returns exactly three rows; `neondb_owner` is `rolbypassrls = true` and owns both tables and every DEFINER function; `congregation_statistics_freeze` is `BEFORE DELETE OR UPDATE … WHEN (old.provenance = 'published_by_congregation')`; `congregation_statistics_about_org` also fires `BEFORE UPDATE` but early-returns when neither `about_org_id` nor `year` moves.

## Placement

### 1a. The congregation surface — a separate route, not a mode of the presbytery page

**`src/app/(org)/o/[slug]/admin/filings/`** (new), *not* a branch inside `admin/reports/`.

- `admin/reports/page.tsx` is hard-scoped twice (`REPORTS_ORG_TYPES` at `:35` and the tile's `orgTypeScope: ["presbytery"]` at `src/lib/org-portal/tiles.ts:398`) and composes three presbytery sections across two independent permissions and two year params. A congregation mode means one component with two disjoint bodies, two flags, two permission axes and a `page.test.tsx` that forks at the top.
- The deeper reason is Two Hierarchies: one surface is the **source council acting on its own act**, the other is the **recipient reading what it received**. Different council, different authority axis. One file should not hold both — the codebase already separates at this granularity (`admin/oversight` vs `admin/reports`).
- Name it `filings`, not `reports`: `reports` already means a presbytery concept here, and at a congregation it will later mean the filing form plus other reports.
- Co-located, mirroring the `reports/` directory shape: `page.tsx`, `actions.ts`, `filings-states.tsx`, `withdraw-dialog.tsx`, `page.test.tsx`.

### 1b. Read source — a correction worth stating plainly

The congregation **owns** its `publications` and `statistical_returns` rows (`organization_id` = the congregation), `presby_app` holds `SELECT` on both, and the policy is `organization_id = presby_current_org()` (all three verified live). The filing-history read therefore **crosses no tenant boundary and needs no new DEFINER function**: a plain Drizzle join of `publications ⋈ statistical_returns` inside `withOrgContext()` yields id, `published_at`, `minute_reference`, `report_year`, `supersedes_id` and the whole withdrawal triple.

`presby_list_own_congregation_publications()` is the *projection* read — it reaches the presbytery's row, returns `setof congregation_statistics`, and so carries `withdrawn_at` but **not** `withdrawn_by`, `withdrawn_minute_reference` or `supersedes_id`. It cannot render the history the analyst describes without a return-type change.

**Ruling:** build the history off the tenant-policy read; **do not widen** `presby_list_own_congregation_publications()`; leave it in place as the congregation's "what did my presbytery receive" confirmation read. Adding DEFINER surface where a policy already answers is exactly what DECISION-112/135 is careful about. If Phase 3 wants receipt state on the page, call it as a second, unchanged read. Note in the TODO reconciliation whether that zero-consumer line (`docs/TODO.md:114` item 1) is actually closed, rather than leaving the line implying it was wired.

### 1c. Tile and flag

- Tile: `key: "filings"`, label "Statistical Filings", `href: (slug) => \`/o/${slug}/admin/filings\``, `category: "administer"`, `domain: "reports"`, **`orgTypeScope: ["congregation"]`** — approved. Deliberately not `new_worshiping_community`: the DB's about-org/affiliation checks and the analyst's scope are congregation-only. Flag NWCs as a known future question, don't widen silently.
- Flag: **`org_portal.filings`**, seeded **off**. The registry's convention is `org_portal.<tile key>`; keep flag suffix and tile key identical. (`org_portal.congregation_reports` from ruling 5 is acceptable only if the tile key changes to match — pick one.) `statistics.*` is the mechanism namespace (`statistics.submission_grants`), not the portal-surface namespace.
- The tile registry stays **flag-only** — no permission check ever (`tiles.ts`'s own standing rule, DECISION-003).
- `scripts/seed.ts` needs the row and `tiles.test.ts` pins a hard-coded snapshot of that seed list — they change together or the test is red.

### 1d. Presbytery-side history sub-view — a nested route, not a query param

**`src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx`**, following `admin/oversight/[aboutOrgId]` exactly. `?year=`/`?billingYear=` on the existing page are **filters over one list**; a per-congregation filing history is a **different resource** with a different read (`presby_list_published_returns_to_me(p_about_org_id, p_year)`) and its own empty state. A `?congregation=` param makes one component render two pages. The nested route gets its own auth/flag/org-type/permission preamble, its own `page.test.tsx`, and a `<Link>` from each row of `statistics-table.tsx`. (`reports/congregations/[aboutOrgId]` is equally approved if Phase 3 wants headroom under `reports/` for future static children; a query param is not.)

### 1e. Server vs client

Both pages are Server Components. The only `'use client'` is the withdraw confirm: shadcn `AlertDialog` + a required minute-reference `Input` + `Button` (Workflow Rule 2 — no `confirm()`). No new primitive is expected; no hand-rolled button/table/input class strings (Component Rule 5). If a primitive genuinely turns out to be missing, `npm run ui:add --` is the only path (DECISION-048).

### 1f. Dependencies

**None.** Everything is `drizzle-orm`, existing `src/components/ui/` primitives and `lucide-react`. No evaluation against the five criteria was needed.

## The function — `presby_withdraw_publication()`

Approved in the shape given, with these structural requirements:

1. **Signature/grants.** `presby_withdraw_publication(p_publication_id uuid, p_withdrawn_by uuid, p_minute_reference text) returns uuid`, `language plpgsql security definer`, `set search_path = public, pg_temp` (DECISION-148). `revoke all … from public`; `revoke execute … from presby_platform`; `grant execute … to presby_app` — the `presby_publish_sasr_snapshot()` grant shape at `drizzle/0049:892-904`.
2. **No org parameter.** `v_actor uuid := presby_current_org()`; refuse if null. The confused-deputy shape of `presby_transfer_affiliation()` (`drizzle/0044:873`) and the chain writer.
3. **Check ordering is load-bearing.** In this order, never merged into one predicate:
   1. `v_actor is null` → uniform refusal.
   2. Lookup by id; **not found** *or* `organization_id <> v_actor` *or* `record_class <> 'statistical_return'` → **one uniform literal**, via a new void helper `presby_deny_publication_withdrawal()` raising `'publications: this withdrawal is not permitted'` with `errcode = insufficient_privilege` — the exact `presby_deny_affiliation_change()` shape I read live. One helper, no id interpolation: grep-able, and it cannot drift into three near-identical strings.
   3. The `p_withdrawn_by` membership assertion (ruling 3 below) — **also the uniform literal**.
   4. Only then the **state** checks, each with its own honest message and `errcode = check_violation`: `already withdrawn at <ts>` and `superseded by a later publication`.
   - **Why the state messages may be distinct, stated as a rule rather than a preference:** F40's uniform-literal discipline exists to kill a cross-tenant *existence* oracle. `presby_freeze_publication()` already records the operative test in its own comment — "every branch of this function is reachable only by someone who already holds the row." By the time step 4 runs, the caller has proven `organization_id = presby_current_org()` and can read `withdrawn_at` and the supersession chain off `publications` under its own tenant policy. The distinct message discloses nothing the caller cannot already select. Steps 2 and 3 fail that test and stay uniform.
4. **Superseded test:** `exists (select 1 from publications where supersedes_id = p_publication_id)`. The chain writer only ever links to the most recent non-withdrawn publication for the year (`drizzle/0049:527-538`), so the chain is linear and a direct-child test is exact.
5. **Arming after validation.** `perform set_config('presby.withdrawal_write_active','true', true)` only once every check has passed (the chain writer's own rule: a call that will be refused arms nothing), disarmed immediately after the second UPDATE. Transaction-local, never session-scoped — pooled `neon-serverless`.
6. **One `v_now`** written to both halves, so the pair's timestamps are exactly equal (`drizzle/0049`'s F39-exactness precedent), not two `now()` calls.
7. **The pair.** `publications` (triple only — the freeze rejects any other column moving), then `update congregation_statistics set withdrawn_at = v_now where publication_id = p_publication_id and about_org_id = v_actor` (nothing else — the projection's freeze compares `to_jsonb(old) - 'withdrawn_at'`). **Assert the projection row count is exactly 1** via `get diagnostics`; 0 or >1 means the pair is already inconsistent and the withdrawal must abort, with its own literal, rather than half-apply.
8. **Why the second UPDATE works at all, and what it costs.** `congregation_statistics` is `FORCE ROW LEVEL SECURITY`, so ownership alone would not exempt the function — but `neondb_owner` carries `rolbypassrls = true` (measured). That is what lets a DEFINER function reach the recipient presbytery's row while the GUC names the congregation. The consequence Phase 3 must internalize: **RLS gives this function no safety net whatsoever**, so the `organization_id = v_actor` check and the `about_org_id = v_actor` scoping in the UPDATE are the *only* tenancy boundary. Neither is redundant; do not simplify either away.
9. **A trigger that will fire and must be tested, not assumed:** `congregation_statistics_about_org` runs `BEFORE UPDATE` on this row. I read the live body — it early-returns when neither `about_org_id` nor `year` moves, so a withdrawal after a redistricting is *not* refused. Pin it with a test anyway.
10. **Atomicity.** No transaction control in the function. plpgsql runs in the caller's transaction and `withOrgContext()` already opens one, so "one transaction by construction" holds and any raise rolls back both UPDATEs *and* the GUC. Do not add `commit`.
11. Re-point `src/lib/db/domain/publication.test.ts:536`'s manual-arming positive control at the real function, per the kickoff's Constraints.

## `withdrawnBy`

Approved: the session user id, bound server-side in the lib from the action's `auth()`-derived `identity.userId`, exactly `setCongregationStatistics(viewerPersonId, organizationId, actingUserId, …)`'s shape (`src/lib/presbytery.ts:618-621`). Never a form field, never a client argument.

**And yes — assert it in the function.** DECISION-141's principle is that the authority boundary is a database property, not a wrapper convention. `presby_transfer_affiliation()` refuses a caller-supplied user id outright and writes `closed_by = null`; the only reason this function cannot do the same is `publications_withdrawal_shape`, which requires all three columns. So accept the parameter and **bound** it:

```sql
exists (select 1 from people pe
         where pe.user_id = p_withdrawn_by
           and pe.organization_id = v_actor
           and presby_membership_is_active(pe.id, v_actor))
```

That turns an unbounded identity claim into a same-tenant, active-member claim. Misattribution to a colleague remains possible, but it is bounded and cross-checkable against the audit event's independently recorded actor. **Refusal goes in the uniform arm**, not a distinct one: `people` is tenant-scoped, and "that user is not a member here" is a person-existence oracle in miniature.

**Not adopted:** an in-function `presby_has_permission(…, 'statistics.publish')` check. The permission stays app-layer — one spelling of the key, consistent with `presby_publish_sasr_snapshot()` and all 17 tenant-mutation modules. The residual (any authenticated member of the source org could reach the function through a path that skips the wrapper's gate) is the one every DEFINER function here carries; name it in Phase 3's Edge Cases rather than leave it implicit, and let QA's feature-gate audit cover the wrapper.

## Read side

- **`fetchStatisticsForYear()`** — add `and withdrawn_at is null` to the **WHERE**, not to the coalesce branch. Only a `published_by_congregation` row can ever carry a non-null `withdrawn_at`, so a blanket filter drops exactly the withdrawn published rows and the existing published-beats-entered coalesce falls through to the live `presbytery_entered`/`imported` row, or to `hasData: false` — the orchestrator's ruling 3 in one line, no new branch. Keep the helper's contract "the current pick only"; **do not** teach it to also carry "a withdrawn return exists." Two facts in one map is the F39 error. The withdrawn history is the new sub-view's job.
- This propagates automatically to **`generatePerCapitaRecords()`** (same helper, `src/lib/presbytery.ts:938-942`): a withdrawn return stops being a basis for **new** bills, while an already-issued bill survives untouched. That is correct for this pipeline — a bill is a financial artifact, not a projection — and Gap 5 stays a TODO line.
- Update `fetchStatisticsForYear`'s own header **and** the module header's "STATISTICS PROVENANCE COALESCE" paragraph in the same edit; both currently state the coalesce rule with no withdrawal exception and become wrong the moment this ships.
- **`presby_list_published_returns_to_me()` and `presby_list_own_congregation_publications()` — unchanged, neither filtered nor widened.** Option A is already shipped in both and argued at length in `drizzle/0047`; re-litigating it here would half-flip F52 again. The presbytery sub-view does not filter — that is the point of the sub-view.

## Default-role binding for `statistics.publish` — correction to kickoff ruling 2

**There is no congregation `stated_clerk` template role.** Live, `app_roles where organization_id is null` holds exactly: `committee_chair` (`…0001`, scope null), `presbytery_stated_clerk` (`…0002`, scope `presbytery`), `personnel_admin` (`…0003`, scope null). The congregation `stated_clerk` that `scripts/seed-dev.sql:1329-1335` binds `statistics.publish` to is `f0000000-…-0005` — an **org-owned fixture role**, not a template.

So `drizzle/0052` cannot add a binding to a template that doesn't exist; it must **create it**, in `drizzle/0037:163-173`'s shape:

```sql
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000004', null, 'congregation',
        'congregation_stated_clerk', 'Stated Clerk', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000004', 'statistics.publish')
on conflict (role_id, permission_key) do nothing;
```

Fixed id `…0004` is the next in the shipped sequence — the orchestrator should treat it as **pre-assigned** alongside the migration number so a parallel pipeline cannot claim it. This is a new shipped constitutional template, which is the architectural addition DECISION-152 records.

**No backfill — template only, plus a TODO line.** Adoption produces an **org-owned copy** at adopt time via `listTemplateRoles`/`adoptTemplate` (`/admin/roles/new`); there are no clones of a template that never existed, and the org-authored `stated_clerk` roles that do exist were never derived from one. A migration reaching into live tenants' `app_role_permissions` to add a tier-2 permission would be the platform granting tenant authority without the tenant's own `roles.manage` act — the Two Hierarchies line. It is also the precedent already set: `credentials.manage` was bound to `…0002` in `0037` with no backfill for presbyteries that adopted earlier.

**Bootstrap gap Phase 3 must answer (pre-existing, not created here).** `assertPermissionSubset()` (`src/lib/authz.ts:197-232`) is a strict subset check against the actor's *effective* permissions with no wildcard exemption. A congregation where nobody holds `statistics.publish` therefore cannot adopt a template carrying it. The dev fixture direct-grants it, so local and e2e are fine; a real deployment is not. The flag shipping off buys time, but Phase 3 should name the intended bootstrap (platform-assisted grant, or the org's `role_admin` path) rather than ship a template nobody can adopt.

## Audit

Approved as proposed. **One event, from the congregation's action:**

- `STATISTICS_RETURN_WITHDRAWN: "tenant.statistics_return.withdrawn"` in `src/lib/audit.ts`, written from `admin/filings/actions.ts` — the `STATISTICS_GRANT_ISSUED` convention at `admin/reports/actions.ts:340-349` (lib does the SQL, `actions.ts` does the audit).
- `resourceType: "publications"`, `resourceId: <publicationId>`, metadata `{ organizationId: <source congregation>, recipientOrgId: <presbytery>, aboutOrgId, reportYear, publicationId }` — both org ids, as asked.
- **No separate presbytery-side event.** `audit_events` records *acts*; the presbytery performed none. The recipient's changed view is a consequence of one act, and a mirrored event would have to invent an actor. `STATISTICS_GRANT_SUBMITTED` already sets this precedent for a write that lands on both sides.
- `check:audit` note for Phase 4: the tripwire scans `src/app/**/actions.ts` for `db.`-receiver mutations, and this mutation is a `tx.execute()` in `src/lib/`. As with the grants pipeline, the audit write here is **review-verified, not tripwire-proven** — say so in Implementer Notes so nobody reads it as enforced.

## Invariants Touched

- **Two Hierarchies** — honored *structurally*, not by policy. The function derives its actor from `presby_current_org()` and refuses any publication whose `organization_id` differs, so no presbytery UI, present or future, can withdraw a return addressed to it. The `unmanaged`/`invited` case closes by construction: no session resolves to that org, so `presby_current_org()` never equals it. Flow 3's answer is the function's shape, not a rule someone must remember. The presbytery's remedy stays a `presbytery_entered` correction under its own provenance and its own minute (F39).
- **DECISION-141 (marker vs privilege)** — honored, and confirmed against the catalog rather than the migration text: `presby_app` has `SELECT` only on `publications`, and no `attacl` entry of any kind on `congregation_statistics.withdrawn_at` / `publication_id`. The GUC is a marker, the grant is the privilege, the DEFINER function is the only path. **`0052` must add no grant on those two columns** — a grant in the Phase 4 diff is the exact failure mode to catch.
- **F44 (owner residual)** — unchanged and still open by design: `neondb_owner` owns both tables, is `rolbypassrls`, and no grant binds it. The triggers are the owner-side backstop and both already carry the `presby.withdrawal_write_active` conjunct. `0052` adds the single sanctioned armer; `scripts/test-rls.sql` §41 must pin that it is the **only** site in the database that arms it — the shape §35 already uses for `presby.publication_write_active`.
- **The Roll / permanence** — untouched. No delete, no new table, withdrawal is a column, the projection row stays.
- **Composite tenant keys** — untouched; no new FK.
- **Enumeration safety** — n/a beyond the `(org)` contract. Both pages are authenticated and must reuse `resolveOrgContext()`'s four-way miss verbatim (do not invent a fifth response on the new nested route). The one new enumeration surface is `p_publication_id`, closed by the uniform literal above.
- **The Brand Is a Cascade Override** — `(org)` is brandable and both pages inherit `<BrandTokens>` from `(org)/o/[slug]/layout.tsx`. Neither may emit a second one (E1 allows exactly two emitters tree-wide) and neither needs to. `npm run check:brand-scope` stays green.
- **Permissions vs Flags** — `statistics.publish` (reused; no `statistics.withdraw`) is the permission; `org_portal.filings` is the flag; the tile is flag-only. The page asks both, in `reports/page.tsx`'s order: auth → `resolveOrgContext` → `assertOrgAccess` → flag → org type → permission.
- **The Edge Gate Cannot Reach the Database** — untouched; nothing new in `src/proxy.ts`.

## Notes (Phase 3 must honor)

1. Minute reference: reuse `MINUTE_REFERENCE_MAX = 500`, required and trimmed, zod at the action boundary. No DB length CHECK is added here (matching `minute_reference`'s own absence). If Phase 3 wants one, it goes on **both** columns in one migration — a one-sided bound is a new inconsistency.
2. Shared/high-collision files this branch will touch: `src/lib/org-portal/tiles.ts`, `scripts/seed.ts`, `src/lib/audit.ts`, `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`. The code review's R16 punch-list already proposes moving the first three to the integration-only list; until it lands, keep each edit to a single clearly-delimited append and expect a conflict at integration.
3. `tiles.test.ts` pins a hard-coded snapshot of the seeded flag list — new flag and snapshot change together.
4. Rules 10/14 at ship: `docs/TODO.md` (close item 3 of the submission-grants follow-ups; add the per-capita stale-bill line and the template-adoption line), `docs/product/functionality-map.md`, and `src/lib/dev-docs.ts` `MODULES`/`INVARIANTS` if the withdrawal mechanism warrants an entry. `docs/architecture.md` — **no change** (Rule 15; this is a feature on an existing subsystem).
5. Tests the implementer owes (QA verifies, never writes): byte-identical uniform literal for wrong-org vs absent-id vs non-member `p_withdrawn_by`; the two distinct state arms; pair atomicity (injected failure after the first UPDATE leaves neither); the tenant path still refused at the **grant** with the marker armed; the rollup falling through to `presbytery_entered`; `generatePerCapitaRecords` skipping a withdrawn basis year; withdrawal after a redistricting (note 9 above); the `publication.test.ts:536` re-point; `test-rls.sql` §41.
6. DECISION-150 applies: the migration must survive `npm run check:schema-parity` on a fresh database and the from-empty recipe, rehearsed locally.

## Proposed DECISION-152

**DECISION-152: Withdrawing a published statistical return is one SECURITY DEFINER council act (`presby_withdraw_publication()`) whose refusal vocabulary is split by what the caller has already proven — uniform for identity, honest for state; the congregation's filing surface is a new `(org)` route (`/o/<slug>/admin/filings`) rather than a second mode of the presbytery's reports page; and the source council reads its own publication history through the tenant policy, not through a new DEFINER function.** (2026-09-26, architect Phase 2, `docs/work-log/2026-09-26-withdraw-publication.md`.)

The function takes no organization id, derives the acting council from `presby_current_org()`, arms `presby.withdrawal_write_active` only after every validation, writes `publications`' withdrawal triple and the `congregation_statistics` projection's `withdrawn_at` with one shared timestamp, asserts the projection row count is exactly 1, and disarms — all inside the caller's transaction, so the pair is atomic by construction. `EXECUTE` is granted to `presby_app` alone; `presby_app` holds no privilege on either withdrawal column, so the function is the only path (DECISION-141 unchanged).

**The refusal split is the decision's substance.** Not-found, wrong-owning-org, wrong record class, and a `p_withdrawn_by` that is not an active member of the acting org all raise **one literal** through a new `presby_deny_publication_withdrawal()` helper (`insufficient_privilege`) — each of those would otherwise be a cross-tenant existence oracle, which is what F40's one-claim-one-literal rule exists to prevent. "Already withdrawn" and "superseded by a later publication" raise **distinct, honest messages** (`check_violation`), because by the time those branches are reachable the caller has proven it owns the row and can already read both facts off `publications` under its own tenant policy: the operative test is whether the message discloses something the caller could not otherwise select, and here it does not. The checks run in that order, never merged into one predicate.

`p_withdrawn_by` is bound server-side from the session (`setCongregationStatistics()`'s `actingUserId` precedent, never client input, no `app.current_user_id` GUC) **and** bounded in the database to an active member of the acting org — the platform cannot write `null` as `presby_transfer_affiliation()` does, because `publications_withdrawal_shape` requires all three columns, so the claim is constrained instead of refused.

Placement follows the councils, not the data: the congregation's `/o/<slug>/admin/filings` (new flag `org_portal.filings`, seeded off; tile `orgTypeScope: ["congregation"]`) is the source council acting on its own act, while the presbytery's per-congregation history is a nested route under its existing reports page — the recipient reading what it received. The congregation's own `publications` and `statistical_returns` rows are readable under `tenant_isolation`, so that history adds no DEFINER surface; `presby_list_own_congregation_publications()` and `presby_list_published_returns_to_me()` both keep returning withdrawn rows unchanged (Option A, F52). `fetchStatisticsForYear()` gains `withdrawn_at is null` in its WHERE, so a withdrawn return is absent for the "current" pick and for new per-capita generation, while an already-issued bill is untouched. `drizzle/0052` additionally **creates** the congregation `stated_clerk` template (`00000000-0000-0000-0000-000000000004`, scope `congregation`) carrying `statistics.publish` — it did not previously exist — with no backfill into existing tenants' roles, because a migration granting tenant authority without the tenant's own `roles.manage` act crosses the Two Hierarchies line.

---

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete — placement ruled (`(org)/o/[slug]/admin/filings` + nested `reports/[aboutOrgId]`, flag `org_portal.filings`); function shape, refusal split, `withdrawnBy` DB-bound assertion, read-side filter and audit ruled; kickoff ruling 2 corrected (no congregation `stated_clerk` template exists — `0052` creates it, id `…0004`, no backfill); no new dependencies | Approved with suggestions | 2026-09-26 |

## Handoff

→ **tech-lead (Phase 3).** Design against the eight rulings above. Four items need an explicit answer in the design doc that Phase 2 could not settle: (a) the **template-adoption bootstrap** — `assertPermissionSubset()` is a strict subset with no wildcard exemption, so no congregation can adopt a role carrying `statistics.publish` until someone there holds it; (b) whether the presbytery sub-view sits at `reports/[aboutOrgId]` or `reports/congregations/[aboutOrgId]`; (c) the exact refusal copy for each of the three arms (one uniform string, two honest ones) and the `ActionResult` mapping in the action; (d) whether a DB length CHECK on both minute-reference columns lands here or is declined. Implementer is likely `full-stack-developer` (one migration, one lib module, two pages) — but the migration is the risk surface, so splitting schema to `database-admin` is defensible.



### Orchestrator note (2026-09-26)

Two corrections to the kickoff rulings are accepted: (1) the flag is `org_portal.filings` (tile key `filings`), superseding the `org_portal.congregation_reports` placeholder in Phase 1 ruling 5; (2) no congregation `stated_clerk` template exists — `drizzle/0052` creates it. Template role id `00000000-0000-0000-0000-000000000004` is hereby **pre-assigned** to this pipeline under Workflow Rule 16. Phase 1 ruling 3 (withdrawn published row treated as absent, fallback to `presbytery_entered`/`imported`) is implemented as the `withdrawn_at is null` WHERE filter in `fetchStatisticsForYear()`, per the architect. DECISION-152 is adopted as proposed; the orchestrator records it at integration.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We are building `presby_withdraw_publication()` — one `SECURITY DEFINER` council act that retracts a published statistical return without deleting it — plus the first two pages of a congregation's own self-service filing surface (`/o/<slug>/admin/filings`: filing history + withdraw), a presbytery-side per-congregation filing-history sub-view (`/o/<slug>/admin/reports/[aboutOrgId]`), and the `withdrawn_at is null` correction to `fetchStatisticsForYear()` that makes a withdrawal actually disappear from "current" totals and future per-capita generation. This closes the two-year-old gap where `publications.withdrawn_at`/`congregation_statistics.withdrawn_at` exist in the schema (`drizzle/0047`) with no writer at all — every column, trigger, and grant needed for withdrawal has been built and tested since 2026-09-24, deliberately unreachable until this pipeline supplies the one sanctioned writer. It also closes, as a side effect of building the congregation's first page, the "zero UI consumers" gap on `presby_list_own_congregation_publications()` named in `docs/TODO.md:114`.

## Permissions & Flags

- **Permission:** `statistics.publish` (existing, tier 2, module `presbytery`) — reused verbatim, per orchestrator ruling 2 and architect confirmation. No `statistics.withdraw`.
- **Default role bindings:** `drizzle/0052` **creates** the congregation `stated_clerk` template role (`00000000-0000-0000-0000-000000000004`, `organization_type_scope = 'congregation'`, `role_kind = 'constitutional'`, `is_protected = true`), carrying `statistics.publish`, in `drizzle/0037:163-173`'s exact shape. No backfill into any existing tenant's `app_role_permissions` (Two Hierarchies — a migration cannot grant tenant authority the tenant's own `roles.manage` act didn't grant).
- **Feature flag:** `org_portal.filings` (new, seeded **off**) — gates the congregation's `/admin/filings` tile and page. The presbytery's nested history sub-view rides the existing `org_portal.reports` flag (it is a sub-route of the already-flagged `reports` tree, not a new tile).

## API Contract

All three exported functions live in a **new** `src/lib/filings.ts` — not `src/lib/presbytery.ts`. Reasoning (Two Hierarchies, restated for the API layer, not just routing): `presbytery.ts`'s own header calls itself "Presbytery-owned operational data," every exported function there gates on a presbytery-scoped permission (`statistics.manage`/`per_capita.manage`/`congregation_oversight.manage`), and every `resolveMemberCongregation()` parent-path check assumes the actor is the presbytery. The congregation withdrawing its own act is the other axis entirely — same shape (`withOrgContext`, a local `hasPermission()` helper, typed result variants) but a different owning council, so it gets its own file, matching the per-module-duplication convention `presbytery.ts`'s own header already documents for `person-sensitive.ts`/`credentials.ts`/`statistics-grants.ts`. `presbytery.ts` is touched only for the `fetchStatisticsForYear()` WHERE-filter edit (below) — that function stays presbytery-owned; withdrawal reading into it is what a *consumer* of the projection does, not a new capability of the congregation module.

```ts
// src/lib/filings.ts  (new)

export type FilingsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }          // statistics.publish absent
  | { kind: "invalid_target" }     // not found / not this org's / bad record class /
                                    // p_withdrawn_by not an active member here —
                                    // the DB's ONE uniform literal, collapsed to one kind
  | { kind: "invalid_input"; message: string }  // bad year / bad minute reference
  | { kind: "already_withdrawn" }
  | { kind: "superseded" };

export interface FilingRow {
  publicationId: string;
  reportYear: number;
  publishedAt: string;               // ISO
  minuteReference: string | null;
  supersedesId: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnMinuteReference: string | null;
}

/** publications ⋈ statistical_returns, filtered to this congregation's own
 *  rows under the TENANT POLICY — no DEFINER function (Phase 2 ruling 1b).
 *  organization_id on BOTH tables equals the source congregation, so
 *  presby_current_org() satisfies tenant_isolation directly. */
export async function listOwnFilings(
  viewerPersonId: string,
  organizationId: string,
  year?: number,
): Promise<FilingsResult<FilingRow[]>>;

/** presby_withdraw_publication(p_publication_id, p_withdrawn_by, p_minute_reference).
 *  withdrawnBy is bound server-side from the session
 *  (setCongregationStatistics()'s actingUserId precedent) — never a form field. */
export async function withdrawFiling(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  publicationId: string,
  minuteReference: string,
): Promise<FilingsResult<{ id: string }>>;
```

**Server actions** — `src/app/(org)/o/[slug]/admin/filings/actions.ts` (new), same shape as `admin/reports/actions.ts`'s `resolveActingIdentity()` + switch-on-`kind` convention:

```ts
"use server";
export async function withdrawFilingAction(
  slug: string,
  input: { publicationId: string; minuteReference: string },
): Promise<ActionResult<{ id: string }>>;
```

- `resolveActingIdentity(slug)` (auth + `resolveOrgContext`) → zod-validate `{ publicationId: z.string().uuid(), minuteReference: z.string().trim().min(1).max(500) }` → `withdrawFiling(personId, organizationId, userId, publicationId, minuteReference)` → map `kind` to copy (see Edge Cases → Refusal copy) → `recordAudit(...)` on `ok` → `revalidatePath(\`/o/${slug}/admin/filings\`)`.

No new route handlers (`/api/...`) — everything is a server action, matching every other `(org)` mutation in this tree.

## Data Model

**`drizzle/0052_presby_withdraw_publication.sql`** — function + role/permission seed only. No `ALTER TABLE`, no new column, no new index; every column and trigger this migration depends on shipped in `drizzle/0047`.

```sql
-- ---------------------------------------------------------------------------
-- 1. presby_deny_publication_withdrawal() — the ONE uniform literal
--    (F40 / DECISION-139's discipline, applied to the withdrawal path)
-- ---------------------------------------------------------------------------
-- Same shape as presby_deny_affiliation_change() (drizzle/0044): a void
-- helper, called from every identity-class refusal so the string cannot
-- drift between call sites. NOT reused for the two state-class refusals
-- (already-withdrawn, superseded) — see DECISION-152's own reasoning: by
-- the time those branches run, the caller has already proven it owns the
-- row (organization_id = presby_current_org() checked first) and can
-- already SELECT both facts under its own tenant policy, so naming them
-- discloses nothing an existence oracle could exploit.
create or replace function presby_deny_publication_withdrawal()
returns void language plpgsql as $$
begin
  raise exception 'publications: this withdrawal is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

revoke all on function presby_deny_publication_withdrawal() from public;
grant execute on function presby_deny_publication_withdrawal() to presby_app, presby_platform;
-- presby_app KEEPS execute (unlike presby_deny_affiliation_change(), which lost
-- it): presby_app holds SELECT on publications and could theoretically reach
-- this helper only via presby_withdraw_publication() itself (DEFINER, runs as
-- owner, grant-exempt) — so in practice presby_app never calls this function
-- directly. Granted anyway for the SAME reason presby_deny_publication_write()
-- keeps its grant (drizzle/0046): a real, non-owner presby_app login must be
-- able to raise the table's own literal, not "permission denied for function."

-- ---------------------------------------------------------------------------
-- 2. presby_withdraw_publication() — the sanctioned pair writer
-- ---------------------------------------------------------------------------
-- Confused-deputy shape, exact precedent presby_transfer_affiliation()
-- (drizzle/0044) and presby_write_return_publication_chain() (drizzle/0049)
-- both use: no organization id parameter, the actor is presby_current_org(),
-- already membership-verified by withOrgContext() before this function is
-- reachable.
create or replace function presby_withdraw_publication(
  p_publication_id uuid,
  p_withdrawn_by uuid,
  p_minute_reference text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor        uuid := presby_current_org();
  v_org          uuid;
  v_record_class text;
  v_withdrawn_at timestamptz;
  v_now          timestamptz := now();
  v_rows         integer;
begin
  -- Step 1 — no context, no standing.
  if v_actor is null then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 2 — lookup + ownership + record class, ALL in the uniform arm.
  -- Not found, wrong owning org, and wrong record class are indistinguishable
  -- to the caller by design (F40): each is "you may not withdraw this."
  select organization_id, record_class, withdrawn_at
    into v_org, v_record_class, v_withdrawn_at
    from publications
   where id = p_publication_id;

  if v_org is null
     or v_org is distinct from v_actor
     or v_record_class is distinct from 'statistical_return'
  then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 3 — p_withdrawn_by must be an ACTIVE MEMBER of the acting org.
  -- Also the uniform arm: "that person doesn't exist here" is a
  -- same-tenant person-existence oracle in miniature (DECISION-152).
  if not exists (
    select 1 from people pe
     where pe.user_id = p_withdrawn_by
       and pe.organization_id = v_actor
       and presby_membership_is_active(pe.id, v_actor)
  ) then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 4 — STATE checks, only now, each with its own honest message
  -- (check_violation) — the caller already proved it owns this row.
  if v_withdrawn_at is not null then
    raise exception
      'publications: this filing was already withdrawn at %', v_withdrawn_at
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from publications where supersedes_id = p_publication_id) then
    raise exception
      'publications: a later filing supersedes this one; only the current filing may be withdrawn'
      using errcode = 'check_violation';
  end if;

  -- Step 5 — arm, now that every check has passed. A call that will be
  -- refused arms nothing (the chain writer's own rule, drizzle/0049).
  perform set_config('presby.withdrawal_write_active', 'true', true);

  -- Step 6 — the pair, one v_now for both halves (F39-exactness).
  update publications
     set withdrawn_at = v_now,
         withdrawn_by = p_withdrawn_by,
         withdrawn_minute_reference = p_minute_reference
   where id = p_publication_id;

  update congregation_statistics
     set withdrawn_at = v_now
   where publication_id = p_publication_id
     and about_org_id = v_actor;
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    -- Not a user-facing state — the pair is already inconsistent (F39
    -- violated somewhere upstream). Thrown, not translated to a friendly
    -- FilingsResult kind (src/types/actions.ts's own "truly unexpected
    -- errors may throw" contract): this is a bug signal, not a state a
    -- congregation clerk caused.
    raise exception
      'publications: the withdrawal pair could not be applied consistently for % (% projection row(s) matched)',
      p_publication_id, v_rows
      using errcode = 'data_exception';
  end if;

  -- Step 7 — disarm explicitly (architect's Phase 2 structural requirement
  -- 5). Belt-and-suspenders: a transaction-local GUC already reverts at
  -- commit/rollback with no explicit action, exactly as
  -- presby_publish_sasr_snapshot() relies on today (drizzle/0047) — this
  -- function disarms anyway, as instructed, rather than relying on that.
  perform set_config('presby.withdrawal_write_active', 'false', true);

  return p_publication_id;
end $$;

revoke all on function presby_withdraw_publication(uuid, uuid, text) from public;
revoke execute on function presby_withdraw_publication(uuid, uuid, text) from presby_platform;
grant execute on function presby_withdraw_publication(uuid, uuid, text) to presby_app;
-- NO grant of any kind on publications.withdrawn_at/withdrawn_by/
-- withdrawn_minute_reference or congregation_statistics.withdrawn_at to any
-- role, here or anywhere else in this file (DECISION-141 unchanged) — this
-- function is the only path, by privilege, not by GUC.

comment on function presby_withdraw_publication(uuid, uuid, text) is
  'The sanctioned withdrawal writer named but not built in drizzle/0047 (F56/DECISION-141). Confused-deputy shape: no org parameter, actor = presby_current_org(). Refuses (one uniform literal) if not found, not this org''s, wrong record class, or p_withdrawn_by is not an active member here; refuses (distinct, honest check_violation messages) if already withdrawn or superseded. Arms presby.withdrawal_write_active only after every check passes, writes publications'' withdrawal triple and congregation_statistics.withdrawn_at with one shared timestamp, asserts exactly one projection row matched, disarms, returns the publication id. DECISION-152.';

-- ---------------------------------------------------------------------------
-- 3. Congregation stated_clerk TEMPLATE role (Two Hierarchies — no backfill)
-- ---------------------------------------------------------------------------
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000004', null, 'congregation',
        'congregation_stated_clerk', 'Stated Clerk', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000004', 'statistics.publish')
on conflict (role_id, permission_key) do nothing;
```

**Header comments the migration file must carry** (matching this codebase's own discipline of naming every deviation and every "why not the obvious alternative"): (1) why the identity/state refusal split exists and is safe (F40's existence-oracle test, applied and passed); (2) why there is no organization parameter (confused-deputy precedent, two citations); (3) why `p_withdrawn_by` is accepted and bounded rather than refused outright the way `presby_transfer_affiliation()` writes `closed_by = null` (the shape CHECK `publications_withdrawal_shape` requires all three columns — a `null` is not legal here); (4) why the disarm call is present even though it is not strictly required by transaction semantics (Phase 2's explicit instruction, stated as such); (5) why there is no backfill for the template role (Two Hierarchies, `personnel_admin`/DECISION-109's precedent of zero backfill for earlier adopters).

## The four Phase 2 handoff items, answered

**(a) Template-adoption bootstrap.** This is the **same standing "founding-administrator" gap** DECISION-100/101/106 already named and deferred for `stated_clerk`/`brand_admin`/`role_admin` — not a new gap this pipeline introduces, and not this pipeline's to close. `assertPermissionSubset()` is a strict subset check with no wildcard exemption (by design — DECISION-106's whole point), so a congregation where nobody currently holds `statistics.publish` cannot adopt `congregation_stated_clerk` until someone there already holds it. The dev fixture (`scripts/seed-dev.sql`) direct-grants it, matching `stated_clerk`/`brand_admin`/`personnel_admin`'s existing dev-fixture pattern, so local dev and e2e are unaffected. **`org_portal.filings` shipping seeded off is what buys the time** this gap has always bought for every prior template role — the queued P2 (backbone and onboarding) pipeline is where the founding-administrator bootstrap (this gap's only real fix) belongs, per `docs/STATE.md`. `docs/TODO.md` gets a new line in the same shape as its existing `brand_admin` line (`docs/TODO.md:168`), naming `statistics.publish`/`congregation_stated_clerk` as the newest instance.

**(b) Route choice — `reports/[aboutOrgId]`, not `reports/congregations/[aboutOrgId]`.** Consistency over headroom: `admin/oversight/[aboutOrgId]/page.tsx` is the direct precedent this design is explicitly modeled on (Phase 2's own words), and it does not nest under an intermediate segment. Introducing one here, with no second static child of `reports/` planned or requested, would be a novel shape for no present need. If `reports/` ever needs a second nested resource, that pipeline can introduce the intermediate segment then, against a real second case rather than a hypothetical one.

**(c) Refusal copy and `ActionResult` mapping.** See Edge Cases & Risks → Refusal copy table below — the DB literal, the `FilingsResult` kind, and the end-user string for each of the five outcomes.

**(d) Minute-reference length CHECK — declined.** No DB `CHECK` is added on `withdrawn_minute_reference` (or, symmetrically, on `minute_reference`) in this migration. Reasoning: (1) `0052` is scoped to a function + role/permission seed, per Phase 2's own structural requirements — adding a `CHECK` means a new `ALTER TABLE` on `publications`, a schema-surface expansion Phase 2 did not ask for and did not budget rehearsal time against; (2) `minute_reference` itself has carried no DB bound since `drizzle/0047` shipped, and bounding only the new column would be the exact "one-sided bound is a new inconsistency" Phase 2's Note 1 warned against; (3) the app-layer zod bound (`.max(500)`, matching `MINUTE_REFERENCE_MAX`) is the only enforcement either column has today and is proportionate to the actual risk (a form field, not an attacker-controlled boundary — the DEFINER function's caller is always an authenticated, permission-gated session). Revisit both columns together in one future migration if `minute_reference` itself is ever bounded.

## Component / Page Plan

**Pages to create:**
- `src/app/(org)/o/[slug]/admin/filings/page.tsx` — congregation filing history + withdraw. Auth pattern byte-identical to `admin/reports/page.tsx`/`admin/oversight/[aboutOrgId]/page.tsx`: `cachedAuth()` → `resolveOrgContext()` (four-way miss, `OrgAccessDenied`/`OrgAccessEnded`/`notFound()`) → `assertOrgAccess()` → `isFlagEnabled("org_portal.filings")` → `PlaceholderFlagOff` → org-type check (`["congregation"]`) → `PlaceholderNotAvailable` → `listOwnFilings()`. Empty state (zero filings ever) states plainly that the self-service publish form is a later pipeline (Phase 1's own required copy for Gap 1/Out-of-Scope), not a broken page.
- `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx` — presbytery per-congregation filing history. Same pattern as `admin/oversight/[aboutOrgId]/page.tsx` exactly: `resolveMemberCongregation`-equivalent 404 on an `aboutOrgId` that isn't a member congregation of this presbytery (via `presby_list_published_returns_to_me(p_about_org_id, p_year)` returning empty is NOT how "not a member" is detected — that call takes no ownership parameter and would just return zero rows for a bad id, same as a real member with no filings; the page instead resolves `aboutOrgId` through the same `listMemberCongregations`/parent-path pattern `presbytery.ts` already uses, so a foreign or bogus id 404s rather than rendering an empty list that reads as "no data yet").

**Components to create:**
- `src/app/(org)/o/[slug]/admin/filings/filings-states.tsx` — `FilingsSectionForbidden`, `FilingsLoadError` (mirrors `reports-states.tsx`/`oversight-states.tsx`).
- `src/app/(org)/o/[slug]/admin/filings/filings-table.tsx` — server-rendered list, one row per filing, "Withdraw" action on the current non-superseded non-withdrawn row only; a withdrawn row reads "Withdrawn `<date>` · `<minute>`" with the action gone. Empty state per `docs/ui-standards.md` (no bare gray sentence) — mirrors `GrantsTable`'s/`StatisticsTable`'s dashed-border empty-state block.
- `src/app/(org)/o/[slug]/admin/filings/withdraw-dialog.tsx` — `'use client'`. shadcn `AlertDialog` + required `Input` (minute reference) + `Label`, modeled **directly** on `admin/officers/end-term-dialog.tsx` (the one existing precedent for "AlertDialog with a required text field, not a one-click confirm"): trigger button, dialog states the act is permanent ("neither reversed, re-dated nor re-minuted"), `AlertDialogAction` disabled while the input is empty/over 500 chars or a submission is pending, `toast.error(result.error)` on failure (no thrown exception path), `router.refresh()` on success. No native `confirm()`.
- `src/app/(org)/o/[slug]/admin/filings/page.test.tsx` — forks on flag-off / wrong-org-type / no-permission / empty / non-empty, matching `admin/reports/page.test.tsx`'s shape.
- `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.test.tsx` — mirrors `admin/oversight/[aboutOrgId]/page.test.tsx`.

**Files to modify:**
- `src/lib/presbytery.ts` — `fetchStatisticsForYear()`: add `withdrawnAt: isNull(congregationStatistics.withdrawnAt)`-equivalent (`and(..., sql\`withdrawn_at is null\`)` or the Drizzle `isNull()` helper if the column is already in the domain schema — confirm at Phase 4) to the existing `WHERE`, not the coalesce branch. Update the function's own doc comment **and** the module header's "STATISTICS PROVENANCE COALESCE" paragraph in the same edit — both currently claim no withdrawal exception and become wrong the moment this ships.
- `src/lib/org-portal/tiles.ts` — append the `filings` tile (`orgTypeScope: ["congregation"]`, `flagKey: "org_portal.filings"`, `category: "administer"`, `domain: "reports"`) after the existing `reports` tile.
- `src/lib/org-portal/tiles.test.ts` — hard-coded seed-flag snapshot updated to include `"org_portal.filings"` in the same commit as the tile (the file's own header states this pairing is load-bearing).
- `scripts/seed.ts` — append the `org_portal.filings` flag row (seeded `false`), same shape/comment style as `org_portal.oversight`/`org_portal.reports`.
- `src/lib/audit.ts` — append `STATISTICS_RETURN_WITHDRAWN: "tenant.statistics_return.withdrawn"` to `AUDIT_ACTIONS`.
- `src/app/(org)/o/[slug]/admin/reports/statistics-table.tsx` — wrap the congregation-name cell in a `<Link href={\`/o/${slug}/admin/reports/${entry.organizationId}\`}>` (the row's `organizationId` field is already the congregation's own id — `toRollupRow()`'s naming, not the presbytery's). Requires threading `slug` into `StatisticsTable`'s props (currently only `entries`).
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — pass `slug` to `<StatisticsTable>`.
- `src/lib/db/domain/publication.test.ts:~636` (`"keeps the withdrawn publication in the recipient's read-back…"` and its sibling `"lets the projection row be MARKED withdrawn…"`) — re-point the manual two-`UPDATE`-under-`armWithdrawalWrite()` sequence at a single call to `select presby_withdraw_publication($1, $2, $3)` on the **owner** connection (kickoff Constraint / architect item 11). The test still runs on `PLATFORM_DATABASE_URL` (this is the one owner-connection proof this suite carries — `presby_app` cannot even reach the function's grant-closed columns to attempt the old manual sequence in the first place), but it now exercises the shipped function instead of a hand-rolled stand-in for it.

## Implementation Order

Three batches, sequential (schema before server before UI — nothing in Batch B or C can be written against a function that doesn't exist yet).

### Batch A — Schema (database-admin)
1. `drizzle/0052_presby_withdraw_publication.sql` (helper, function, template role + binding) — full header comments per the Data Model section above.
2. Rehearse the from-scratch recipe (DECISION-150): fresh DB → `db:migrate` through 0052 → `npm run check:schema-parity` → `scripts/seed.ts` → `scripts/seed-dev.sql` → `scripts/test-rls.sql` (full run) → `npm run typecheck`.
3. **In-place correction to `scripts/test-rls.sql` section 35** (not a new section — see F90 below): the existing assertion "F56: and NOTHING in the database arms it yet" (currently pinned at count `0`) becomes permanently false the moment `0052` ships. Update the assertion's expected value to `1` and its literal to name `presby_withdraw_publication` as the one arming site, in the same dated-comment style `drizzle/0047`'s own in-place corrections use (F51/F61 etc.) — this is a required correction to an existing assertion's *meaning*, not new coverage, and is therefore an explicit, narrow exception to the append-only shared-file discipline (the alternative — leaving a now-false assertion in the suite — is strictly worse).
4. Append `scripts/test-rls.sql` **section 41** (new) — see the assertion list under Edge Cases & Risks.
5. Append `scripts/seed.ts`'s `org_portal.filings` flag row and the `src/lib/db/domain/index.ts` export line, if `filings.ts`'s types need a domain-module export (see Data Model — likely none; `filings.ts` reads `congregationStatistics`/`publications`/`statisticalReturns`, all already exported from existing domain files, so this line may be unnecessary — confirm at Phase 4 and only touch the file if a genuine new export is needed).
6. `drizzle/meta/_journal.json` idx 52 entry (orchestrator, at integration, per Workflow Rule 16).

### Batch B — Server + read side (api-developer)
1. `src/lib/filings.ts` (new) — `listOwnFilings()`, `withdrawFiling()`, local `hasPermission()` helper, `MINUTE_REFERENCE_MAX = 500` local constant.
2. `src/lib/presbytery.ts` — `fetchStatisticsForYear()` WHERE-filter edit + both header-comment updates.
3. `src/app/(org)/o/[slug]/admin/filings/actions.ts` (new) — `withdrawFilingAction()`, zod schema, `resolveActingIdentity()`, refusal-copy mapping (below), `recordAudit()` call.
4. `src/lib/audit.ts` — `STATISTICS_RETURN_WITHDRAWN` key.
5. Unit tests: `src/lib/filings.test.ts` (new), `src/lib/presbytery.test.ts` additions for the withdrawn-row-excluded case in `fetchStatisticsForYear`/`generatePerCapitaRecords`, `src/app/(org)/o/[slug]/admin/filings/actions.test.ts` (new).

### Batch C — UI (ux-developer)
1. `src/lib/org-portal/tiles.ts` + `tiles.test.ts` (paired edit).
2. `admin/filings/page.tsx`, `filings-states.tsx`, `filings-table.tsx`, `withdraw-dialog.tsx`, `page.test.tsx`.
3. `admin/reports/[aboutOrgId]/page.tsx` + its `page.test.tsx`.
4. `admin/reports/statistics-table.tsx` `<Link>` + `page.tsx` prop threading.
5. Rehearsal: dev server on port 3600 against the `pipeline-withdraw` Neon branch, real browser at 360px — congregation clerk fixture person (needs a `role_grants` row against the new template's org-adopted copy, or a direct dev-fixture grant per the bootstrap answer above) walks the full Flow 1 (list → withdraw → dialog → confirm → row updates) and the presbytery fixture person walks Flow 2 (rollup excludes it, nested history page shows it marked).

### Cross-batch, assigned per Phase 2 Note 5's test list
| Test | Batch | Failing-first shape |
|---|---|---|
| Byte-identical uniform literal: wrong-org id, absent id, non-member `p_withdrawn_by` | A (`publication.test.ts`, owner connection) | Three separate calls, same caught message string, asserted equal to each other, not just individually non-empty |
| Two distinct state arms (already-withdrawn, superseded) | A | Call twice / call on a superseded row, assert the two messages differ from each other and from the uniform literal |
| Pair atomicity (injected failure after the first UPDATE leaves neither half written) | A | Wrap in a savepoint that raises after `update publications` but before `update congregation_statistics`; assert both rows unchanged post-rollback |
| Tenant path still refused at the grant with the marker armed | A (`test-rls.sql` §41, mirrors §35(d)) | `presby_app`, `set_config` the marker manually, attempt the raw UPDATE directly (not through the function) — `has_column_privilege` false |
| Rollup falls through to `presbytery_entered`/`imported` after withdrawal | B (`presbytery.test.ts`) | Seed both provenances for one congregation/year, withdraw the published one, assert the entered row now wins |
| `generatePerCapitaRecords` skips a withdrawn basis year | B | Withdraw the basis-year return, assert the congregation lands in `skipped`, not `created` |
| Withdrawal after a redistricting is NOT refused (Phase 2 item 9) | A | Move the congregation to a new presbytery after publication, then withdraw under the original recipient's context — `congregation_statistics_about_org`'s WHEN-guard early-return must hold |
| `publication.test.ts:~636` re-point | A | The two existing tests now call the real function instead of the manual pair |
| `test-rls.sql` §41 full list | A | See below |
| Withdraw dialog: empty/overlong minute reference blocks submit | C | Client-side disabled-state test, `page.test.tsx` |
| Feature-gate audit: `statistics.publish` checked inside `withdrawFiling()`, flag checked in `page.tsx`, both present | B + C | QA's Phase 5 job, not written here — named so nobody forgets to look |

## Edge Cases & Risks

**Refusal copy and `ActionResult` mapping** (answering handoff item (c)):

| `FilingsResult.kind` | DB literal (verbatim) | `errcode` | End-user copy in `actions.ts` |
|---|---|---|---|
| `forbidden` | *(no DB call reached — permission gate inside `withdrawFiling()` fails first)* | n/a | "You don't have permission to withdraw filings here." |
| `invalid_target` | `publications: this withdrawal is not permitted` | `insufficient_privilege` (`42501`) | "That filing can't be withdrawn. Refresh the page and try again." |
| `already_withdrawn` | `publications: this filing was already withdrawn at %s` | `check_violation` (`23514`) | "This filing has already been withdrawn." |
| `superseded` | `publications: a later filing supersedes this one; only the current filing may be withdrawn` | `check_violation` (`23514`) | "A newer filing supersedes this one — only the current filing can be withdrawn." |
| `invalid_input` | *(zod, never reaches the DB)* | n/a | zod's own message (bad/missing minute reference) |
| *(unmatched code — the row-count assertion, or anything else)* | *(thrown, not caught into a `FilingsResult`)* | `data_exception` or unrecognized | Surfaces as an unhandled server-action error (Next.js default), per `ActionResult`'s own "truly unexpected errors may throw" contract — this is a bug signal, not a user-facing state |

`withdrawFiling()` catches the DB error via the existing `pgErrorInfo(err)` helper (`src/lib/statistics-grants.ts`'s own precedent — extract `{ code, message }` without leaking Drizzle's parameter-bearing wrapper message into a log or a user-facing string) and pattern-matches `code` + a `message.includes(...)` substring check on the two `check_violation` cases to distinguish `already_withdrawn` from `superseded` (both share `23514`); the `insufficient_privilege` case needs no substring check since it is the only thing that raises that code from this function.

**F90 — a shipped test-rls.sql assertion's own literal becomes false the day the feature it anticipates ships**, and the pipeline that ships the feature is the one obligated to correct it in place rather than merely add new coverage alongside a now-wrong claim. Named because it is a real, non-obvious category (an assertion whose *passing* result today is a documented placeholder — "nothing arms it yet, deliberate" — rather than a permanent invariant) that a future GUC-marker feature could hit again; worth a line in `docs/schema-design-2.md` or the retrospective punch-list if it recurs.

**The residual named at Phase 2, restated for the record.** Any authenticated member of the source congregation, holding *any* permission, can reach `presby_withdraw_publication()` directly (e.g., via a raw `tx.execute`) if some other, unrelated code path ever exposed one — the permission gate (`statistics.publish`) lives in `withdrawFiling()`'s TypeScript wrapper, not inside the function itself, matching every other tenant-mutation module in this codebase (`presby_publish_sasr_snapshot()` included). This is not a gap this pipeline introduces or should close; it is the standard shape, and QA's feature-gate audit is what verifies the wrapper is the only caller in the shipped code.

**Gap 5 (per-capita stale bill), restated as a TODO, not solved here.** `generatePerCapitaRecords()` never overwrites an existing bill; a bill already issued off a since-withdrawn return survives untouched. `docs/TODO.md` gets a line.

**Empty state.** `admin/filings/page.tsx`'s zero-filings state must say, plainly, that filing a *new* return isn't built yet on this page — Phase 1's own required copy (Out of Scope) — not render a bare "no data" that reads as broken.

**e2e blast radius (CLAUDE.md → Phase 3 requirement).** Existing specs whose *asserted* behavior this change alters:
- Any Playwright/Vitest spec asserting `fetchStatisticsForYear()`'s or `getCongregationStatisticsRollup()`'s output shape for a congregation with a `published_by_congregation` row — none exist today with a **withdrawn** row in the fixture set (withdrawal was unreachable until now), so no existing assertion should flip; this is named as a risk to watch during Batch B's rehearsal, not a known break.
- `src/lib/db/domain/publication.test.ts`'s two owner-connection withdrawal tests (re-pointed, not merely extended — their *assertions* are unchanged, but the mechanism under test is; a reviewer diffing the test file should read this as "same claim, real writer" not "new claim").
- `scripts/test-rls.sql` section 35's arming-count assertion (F90 above) — this one **does** flip, by design, and is corrected in the same migration that causes the flip.
- No e2e spec under `e2e/` references `/admin/filings`, `/admin/reports/[aboutOrgId]`, or any withdrawal copy today (both routes are new), so no *existing* e2e spec's literal assertions break; the new e2e coverage (if any is added at Phase 4/5 — not mandated here, since this feature does not touch `src/auth.ts`/`(auth)`/`api/auth`/`lib/auth/`) is net-new, not a replacement for something removed.

## Implementer

**Batch A (schema): `database-admin`.** **Batch B (server + read side): `api-developer`.** **Batch C (UI): `ux-developer`.** Three implementers, sequential, not `full-stack-developer` — the migration is real risk surface (a new `SECURITY DEFINER` function touching two `FORCE ROW LEVEL SECURITY` tables and a privilege-boundary invariant DECISION-141 already had QA catch a live violation of once), the read-side edit changes an existing presbytery-facing rollup's contract, and the UI is two new pages plus one existing table's edit — each batch is independently substantial enough to warrant its own implementer and its own review surface, matching this pipeline's own "large" complexity estimate.

## DECISION-152 — adopted verbatim

Adopted exactly as the architect proposed it in Phase 2 (see that section above for the full text); no Phase 3 amendment was needed. Recorded here so the design doc is self-contained; the orchestrator applies it to `docs/decisions.md` at integration per Workflow Rule 16's shared-file discipline.

## F90 (new finding)

**F90 — a `test-rls.sql` assertion whose passing result is a documented placeholder ("nothing arms this GUC yet, deliberately") goes false the instant the anticipated writer ships, and the shipping pipeline must correct it in place, not merely add coverage alongside a now-false claim.** Concretely: section 35's `count(*) ... like '%set_config(''presby.withdrawal_write_active''%' = 0` assertion (drizzle/0047-era) is a statement about the database's *current* incompleteness, not a permanent invariant — `presby_withdraw_publication()` (`drizzle/0052`) makes it false by construction. Recorded as a category, not just a one-off fix, because any future "schema ships ahead of its writer" pattern (this codebase's own stated style for GUC-gated pairs) will reproduce it. See Implementation Order → Batch A step 3 for the specific correction.

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete — DDL for `drizzle/0052` (deny helper, `presby_withdraw_publication()`, congregation `stated_clerk` template + binding); all four Phase 2 handoff items answered; new `src/lib/filings.ts` module (not `presbytery.ts`); refusal-copy/`ActionResult` mapping table; three-batch implementation order with per-batch test assignment; F90 named and its `test-rls.sql` in-place correction specified; DECISION-152 adopted verbatim | Design complete, implementers named | 2026-09-26 |

## Handoff

→ **database-admin (Batch A)**, then **api-developer (Batch B)**, then **ux-developer (Batch C)**, strictly in that order — each batch depends on the previous one's artifacts existing (the function before the lib wrapper, the lib wrapper before the UI). Batch A owns the from-scratch rehearsal (DECISION-150) and the in-place `test-rls.sql` section 35 correction (F90) in addition to the new section 41. Batch B owns the `fetchStatisticsForYear()` contract change and must run `src/lib/presbytery.test.ts`'s existing suite to confirm no currently-passing assertion silently relied on a withdrawn row being counted (none should, per the e2e-blast-radius note above, but this is the batch that finds out for certain). Batch C's rehearsal step is a real browser at 360px against the `pipeline-withdraw` Neon branch's dev server (port 3600), walking both Flow 1 and Flow 2 end to end, per CLAUDE.md → Verify in a Browser.

---

# Phase 4 — Implementation

**Status: In progress. Batch A and Batch B complete; Batch C (ux-developer) next.**

---

## Batch A — Schema (database-admin, 2026-09-26)

### Files Created

- `drizzle/0052_presby_withdraw_publication.sql` — **hand-written** (Drizzle Kit emits no function, no grant, no revoke, no comment). Three sections: (1) `presby_deny_publication_withdrawal()`, the single uniform-literal helper; (2) `presby_withdraw_publication(uuid, uuid, text)`, the sanctioned pair writer; (3) the congregation `stated_clerk` template role `00000000-0000-0000-0000-000000000004` and its `statistics.publish` binding. No `ALTER TABLE`, no column, no index, **no grant of any kind on either table or on any withdrawal column**. Carries all five header "why" notes Phase 3 required.

### Files Modified

- `scripts/test-rls.sql`
  - **In-place correction (F90), lines 4948–4969** — the only non-append edit to a shared file on this branch, marked in the file with `-- F90 (2026-09-26-withdraw-publication): corrected in place` at **line 4948**. Section 35's arming-count assertion (expected `0`, "NOTHING in the database arms it yet") goes false the moment `0052` ships; it now expects `1` and names the writer. The old literal is quoted verbatim in the replacement comment so the correction is readable as a correction.
  - **New section 41, appended at the very end, lines 6617–7069** (the section body starts at 6617, the `END APPENDED SECTION — pipeline/withdraw` marker is at 7068). Eight lettered blocks, **30 assertions**.
- `src/lib/db/domain/publication.ts` — two stale comment blocks corrected: the module header's "There is NO withdrawal path AT ALL today" bullet now describes the shipped writer and cites `drizzle/0052`; `withdrawnBy`'s "Null on every row today" now states the accept-and-bound rule and why `closedBy = null` was unavailable. No table-shape change.
- `src/lib/db/domain/presbytery.ts` — `congregationStatistics.withdrawnAt`'s comment: "which NOTHING sets today" → the single-armer fact, plus the note that `0052` added no grant on the two narrowed columns and section 41 asserts the absence three ways. No table-shape change.
- `src/lib/db/domain/publication.test.ts` — the re-point (below) plus two new owner-connection tests.

**Deliberately NOT touched** (integration-only, Workflow Rule 16): `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`.

- `index.ts`: no new export is needed. `filings.ts` (Batch B) reads `publications`, `statisticalReturns` and `congregationStatistics`, all already exported; `0052` adds no table.
- `seed-dev.sql`: **no fixture was needed**, which is better than the fixture Phase 3 anticipated. Everything section 41 exercises is built inside a rolled-back transaction through the real publish path — `presby_app` holds `EXECUTE` on `presby_publish_sasr_snapshot()`, so a two-publication supersession chain for report year 2091 is constructed and withdrawn live, then rolled back. A hand-built seeded chain would have been a stand-in for that, would have added permanent rows to a fixture whose exact counts a dozen assertions pin, and (at report year 2024) would have silently changed the per-capita basis-year fixture.
- `_journal.json`: `{ "idx": 52, "version": "7", "tag": "0052_presby_withdraw_publication" }` is **owed at integration** — the orchestrator's line, per Phase 3 Batch A step 6.

### Schema Changes

- **Tables/columns: none.** Every column, trigger, CHECK and grant this migration depends on shipped in `drizzle/0047`.
- **Functions:** `presby_deny_publication_withdrawal() returns void` (INVOKER) and `presby_withdraw_publication(p_publication_id uuid, p_withdrawn_by uuid, p_minute_reference text) returns uuid` (`security definer`, `set search_path = public, pg_temp`).
- **Rows:** one `app_roles` template (`…0004`) + one `app_role_permissions` binding, both `on conflict … do nothing`, no backfill.
- **Applied via:** hand-written SQL, `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0052_presby_withdraw_publication.sql` against the `pipeline-withdraw` Neon branch (owner, direct/unpooled endpoint). **Not** `db:push` (forbidden by the kickoff and structurally incapable of emitting any of this) and **not** `db:generate` (the repo's generator has been broken since the 0009–0012 snapshot collision; hand-authored SQL + a hand-registered journal entry is the documented pattern).

### Audit Events

None written by Batch A — a SQL function cannot call `recordAudit()`. `STATISTICS_RETURN_WITHDRAWN` is Batch B's (`src/lib/audit.ts` + `admin/filings/actions.ts`). **Note for QA, per Phase 2:** `npm run check:audit` scans `src/app/**/actions.ts` for `db.`-receiver mutations, and this mutation is a `tx.execute()` in `src/lib/`, so the audit write here will be **review-verified, not tripwire-proven**.

---

## Implementer Notes — Batch A

### Deviation 1 (design defect, corrected): `people` has no `organization_id` column

Phase 2 and Phase 3 both specify step 3's membership assertion as:

```sql
exists (select 1 from people pe
         where pe.user_id = p_withdrawn_by
           and pe.organization_id = v_actor
           and presby_membership_is_active(pe.id, v_actor))
```

`people` has no `organization_id` column — a person is scoped to an organization by `memberships`, which is exactly what the table's own RLS policies test (`visible_via_membership_read`: `exists (select 1 from memberships m where m.person_id = people.id and m.organization_id = presby_current_org())`). Measured on the branch, not inferred. plpgsql does not resolve column references at `CREATE` time, so the design's spelling would have compiled cleanly, passed every catalog assertion, and failed at the **first real call** — on the single branch the whole check exists to close. Shipped as:

```sql
exists (select 1 from people pe
         where pe.user_id = p_withdrawn_by
           and presby_membership_is_active(pe.id, v_actor))
```

Semantics are unchanged: `presby_membership_is_active(person, org)` IS "a `memberships` row at this org with `ended_on is null`", so it carries the org-scoping half that `pe.organization_id` was meant to carry. The correction and its reasoning are a comment block in the migration at step 3. **Proposed as F91** (pre-assigned range "F90 onward") — *a design reviewed against `drizzle/`'s text can specify a column that does not exist, because plpgsql defers name resolution to first call; verify every predicate's columns against `information_schema`, not against the sibling function you are modelling on* — orchestrator to record in `docs/schema-design-2.md` at integration if it agrees.

### Deviation 2: the redistricting test needed two fixture rungs the seed does not have

Phase 2 item 9's redistricting test could not be written as "act as the receiving presbytery and transfer". `presby_transfer_affiliation()` requires, for a **true** transfer, that the actor be the common superior of *both* parents as of the date (G-3.0403(c)); `scripts/seed-dev.sql` leaves both the Northern Reach and the Western Basin as **roots** with no affiliation row of their own, so `presby_affiliation_parent_as_of()` returns null for both and the transfer is refused with the uniform literal. Measured: the first version of this test "passed the refusal" and proved nothing, which is why it is called out here. The test now builds the missing synod rung inside its own rollback (two `organization_affiliations` rows under the Synod of the Coastal Plain, armed with `presby.affiliation_trigger_active` exactly as `seed-dev.sql` arms `presby.publication_write_active` for its publication fixture) and performs the transfer **as the synod**. Nothing is committed.

### Deviation 3: none on the DDL itself

Sections 1–3 are Phase 3's DDL as written, apart from Deviation 1 and the added header/inline comments. Check order, refusal split, the single `v_now`, the `get diagnostics` assertion, the explicit disarm, the grant/revoke triple and the template-role seed are all verbatim.

### The grant diff QA asked for — `pg` before and after, identical

Captured as `relacl` + `attacl` for both `publications` and `congregation_statistics`, before applying `0052` and after applying it twice:

```
$ diff grants-before.txt grants-after.txt
GRANT DIFF: none (0 lines changed)      # 161 lines each
```

The material rows, unchanged: `publications` → `presby_app SELECT`, `presby_platform SELECT`, owner's eight. `congregation_statistics` → `presby_app SELECT, DELETE` (table level) plus its pre-existing column-level `INSERT`/`UPDATE` list. **`pg_attribute.attacl` carries no entry of any kind, for any role, on `publications.withdrawn_at` / `withdrawn_by` / `withdrawn_minute_reference` or `congregation_statistics.withdrawn_at` / `publication_id` — before or after.** Section 41(b) asserts that three ways (`has_column_privilege`, `relacl`, `attacl`) with a positive control on `minute_reference` so a blanket revoke cannot satisfy it.

### Commands and outputs

**Failing-first, before `0052` was applied:**

| Probe | Result |
|---|---|
| `psql "$APP_DATABASE_URL" -f <section 41 alone>` | **exit 3**, aborts at the first assertion: `ERROR: FAIL F56/DECISION-152: presby_withdraw_publication() exists, is SECURITY DEFINER, and pins search_path = public, pg_temp with pg_temp LAST (DECISION-148) — expected 1, got 0` |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (whole suite, with the F90 correction in place) | **exit 3** at `scripts/test-rls.sql:4969` — `FAIL F56/F90: exactly ONE function in the database arms presby.withdrawal_write_active … — expected 1, got 0`; 410 assertions had passed before the abort |
| `vitest run --no-file-parallelism src/lib/db/domain/publication.test.ts` | **exit 1** — `Tests 5 failed | 40 passed (45)`, every failure `Caused by: error: function presby_withdraw_publication(uuid, uuid, unknown) does not exist`. The five: the three re-pointed tests + the two new ones |

**Apply, twice, whole file (idempotency proven rather than asserted):**

```
$ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0052_presby_withdraw_publication.sql
CREATE FUNCTION / REVOKE / GRANT / CREATE FUNCTION / REVOKE / REVOKE / GRANT / COMMENT / INSERT 0 1 / INSERT 0 1
run1 exit=0
$ psql … -f drizzle/0052_presby_withdraw_publication.sql      # the WHOLE file again
CREATE FUNCTION / REVOKE / GRANT / CREATE FUNCTION / REVOKE / REVOKE / GRANT / COMMENT / INSERT 0 0 / INSERT 0 0
run2 exit=0
after run1: app_roles=23 | app_role_permissions=73
after run2: app_roles=23 | app_role_permissions=73
```

**Rehearsal on the `pipeline-withdraw` branch's own database, in the ordered sequence:**

| Command | Result |
|---|---|
| `npm run check:schema-parity` | exit 0 — `64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing` |
| `npm run db:seed` | exit 0 |
| `psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` | **exit 3 — expected and pre-existing**: `duplicate key … organizations_id_key`. `seed-dev.sql` is a from-empty fixture with no `on conflict` guards and has never been re-runnable against a seeded database; it is applied for real in the from-empty rehearsal below. Nothing in Batch A changed that file. |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`) | **exit 0 — 550 assertions**, i.e. the documented 520 + section 41's 30, with section 35's corrected assertion now passing at `1` |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `vitest run --no-file-parallelism` on `publication.test.ts`, `role-definitions.test.ts`, `admin/roles/new/page.test.tsx`, `presbytery.test.ts` | exit 0 — **136 passed (136)**. The last three are the at-risk set, not the touched set: a fourth template role is now live, and `listTemplateRoles()` returns it to any congregation. |
| `npm run check` | exit 0 — all five tripwires |

**The from-empty recipe (DECISION-150's acceptance criterion), on a fresh database inside the same Neon branch.** `create database withdraw_fromempty` on the owner/direct endpoint, four URLs re-pointed at it by name only — **no `ALTER ROLE presby_app … PASSWORD` was run**, per the kickoff and `docs/testing.md`'s own warning; `presby_app` is cluster-wide and its existing password reaches the new database unchanged.

| Step | Result |
|---|---|
| `npm run db:migrate` (0001 → 0050 from empty) | exit 0, `migrations applied successfully`, `drizzle.__drizzle_migrations` = **51 rows** |
| `psql -f drizzle/0052_…sql`, then again | exit 0, exit 0 — `0052` is applied by `psql` on purpose, so the committed `_journal.json` stays untouched for the orchestrator |
| `npm run check:schema-parity` | exit 0 — same 5 allowlisted differences, 0 failing |
| `npm run db:seed` | exit 0 |
| `psql -f scripts/seed-dev.sql` | exit 0, `COMMIT` |
| `psql -f scripts/install-test-helpers.sql` | exit 0 |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` as `presby_app` | **exit 0 — 550 assertions**, byte-for-byte the same count as the branch's own database |
| `drop database withdraw_fromempty` | done (two idle sessions terminated first); `pg_database` count 0, no residue on the branch |

**After the apply, on the branch's database:** `publication.test.ts` → **45 passed (45)**; section 41 alone → exit 0, 30 passes.

### `publication.test.ts` — the re-point, and what was added

Two shared helpers now sit beside `armWithdrawalWrite()`: `withdrawalFixture(tx)` (reads Alder Creek's live publication id — **id-agnostic**, seeded or backfilled — and a user id the function will *accept*) and `withdrawAsSourceCouncil(tx, …)` (sets the org GUC to Alder Creek and calls the real function). Note `select id from users limit 1`, what these tests used while the withdrawal was a hand-rolled UPDATE, is now correctly **refused** by step 3 — the fixture helper exists because the bound is real.

Three existing tests re-pointed (the kickoff cites `:536`, Phase 3 `~636`; the manual-arming positive control appears in all three, so all three moved — *same claim, real writer*):

- `permits the ONE transition — the three withdrawal columns set together, once — and refuses every later touch`
- `keeps the withdrawn publication in the recipient's read-back, carrying the whole withdrawal triple` — now switches context to Alder Creek for the act and back to the Northern Reach for the read-back, which is Option A in miniature
- `lets the projection row be MARKED withdrawn, exactly once, with nothing else on the row moving` — the negative probes still arm the marker **by hand** (their claim is that even an armed transaction may do nothing but the one transition); only the transition itself goes through the function

Two tests added, in a new describe block, for the two arms section 41 structurally cannot reach from `presby_app`:

- `refuses, and half-applies nothing, when the publication has no projection row` — a publication with no projection makes the function raise `data_exception` **after** `update publications` has run, which is the honest form of Phase 3's "injected failure after the first UPDATE leaves neither": the publication's `withdrawn_at` is `null` afterwards.
- `is NOT refused after a redistricting` — Phase 2 item 9, behaviourally (see Deviation 2); both halves written, timestamps still exactly equal.

### `scripts/test-rls.sql` section 41 — what it proves, 30 assertions

(a) catalog shape: the function exists, is DEFINER, pins `search_path = public, pg_temp`; the helper is INVOKER; **the arming site by name** plus "no other function arms it"; the explicit disarm; `presby_app` can execute, `presby_platform` and `PUBLIC` cannot. (b) the grant that must not have moved, three ways, with the `minute_reference` positive control. (c) **the uniform literal, four ways, compared to each other** — no context / absent id / another council's publication (concretely: the *recipient presbytery* attempting to withdraw the return addressed to it) / a non-member `p_withdrawn_by` — byte-identical and all `42501`. (d)+(e) a real two-publication chain published and withdrawn inside a rollback: the superseded refusal, the returned uuid, **the marker disarmed on return**, both halves withdrawn at *exactly* the same instant, the triple attributed, the projection retained and marked (Option A), the second-withdrawal refusal, and the two state messages proven distinct from each other *and* from the uniform literal. (f) the tenant path still closed at the **grant** with the marker armed by hand — `publications` half (section 35(d) owns the `congregation_statistics` half). (g) the template role: present, template-shaped, **visible to a tenant** (the whole block runs as `presby_app` under Alder Creek's context, so passing *is* the visibility proof), exactly one permission, four templates total, and the no-backfill count. (h) the redistricting case: why it is not fixturable from this connection, plus the catalog pin of the about-org trigger's UPDATE early-return.

### Residuals, named not closed

1. **The permission gate is app-layer.** Any authenticated member of the source congregation could reach `presby_withdraw_publication()` directly if some other code path ever exposed a raw `tx.execute`. `statistics.publish` is checked in Batch B's `withdrawFiling()`, matching all 17 tenant-mutation modules and `presby_publish_sasr_snapshot()`. QA's feature-gate audit is the check that the wrapper is the only caller.
2. **Misattribution within one congregation.** `p_withdrawn_by` is bounded to an active member of the acting council, not to the session's own user — the database cannot see the session. Cross-checkable against the audit event's independently recorded actor (Batch B).
3. **The founding-administrator gap** (DECISION-100/101/106) is unchanged: no congregation can adopt `congregation_stated_clerk` until someone there already holds `statistics.publish`. `org_portal.filings` shipping off buys the time; `docs/TODO.md` owes a line in the shape of its existing `brand_admin` one.
4. **F44 is unchanged and still open by design.** `neondb_owner` owns both tables and is `rolbypassrls`; the triggers are the owner-side backstop and both still carry the `presby.withdrawal_write_active` conjunct. `0052` supplies the single sanctioned armer and nothing else.

---

## API contract Batch B consumes

```sql
presby_withdraw_publication(
  p_publication_id   uuid,
  p_withdrawn_by     uuid,   -- bound server-side from the session; NEVER a form field
  p_minute_reference text
) returns uuid                -- p_publication_id, echoed back after both halves are written
```

- `language plpgsql security definer`, `set search_path = public, pg_temp`. `EXECUTE` granted to **`presby_app` only** — call it on the RLS-enforced `db` connection inside `withOrgContext()`, which is what sets the `app.current_org_id` the function derives its actor from. There is **no organization parameter**; do not add one to the wrapper's SQL.
- **No transaction control inside the function.** It runs in the caller's transaction, so the pair is atomic by construction. Do not wrap it in a savepoint that swallows a raise, and do not issue the two UPDATEs from TypeScript.
- On success it has written `publications.{withdrawn_at, withdrawn_by, withdrawn_minute_reference}` and the recipient's `congregation_statistics.withdrawn_at` with **one identical timestamp**, and has re-disarmed the marker.

**The three refusal strings, their SQLSTATEs, and the `FilingsResult` kind each maps to.** Match on `code` first; the two `23514` cases need a substring test to tell them apart (`pgErrorInfo(err)` is the existing extractor — `src/lib/statistics-grants.ts`'s precedent — and keeps Drizzle's parameter-bearing wrapper text out of logs).

| DB literal (verbatim) | SQLSTATE | Raised when | `FilingsResult.kind` |
|---|---|---|---|
| `publications: this withdrawal is not permitted` | `42501` `insufficient_privilege` | no org context **or** no such publication **or** it belongs to another council **or** `record_class <> 'statistical_return'` **or** `p_withdrawn_by` is not an active member of the acting council — five causes, one string, on purpose | `invalid_target` |
| `publications: this filing was already withdrawn at %` (`%` = the original `withdrawn_at`) | `23514` `check_violation` | `publications.withdrawn_at` is already set | `already_withdrawn` — match `message.includes("already withdrawn at")` |
| `publications: a later filing supersedes this one; only the current filing may be withdrawn` | `23514` `check_violation` | some publication names this one as `supersedes_id` | `superseded` — match `message.includes("supersedes this one")` |
| `publications: the withdrawal pair could not be applied consistently for % (% projection row(s) matched)` | `22000` `data_exception` | zero or many projection rows matched — the pair was already inconsistent | **do not map.** Let it throw (`src/types/actions.ts`'s "truly unexpected errors may throw"): it is a bug signal, not a state a clerk caused |

Do **not** build a fourth arm for "not found" or narrow the `42501` copy toward any one of its five causes — the single string is DECISION-152's substance and section 41(c) fails if the four probes stop being byte-identical.

**Also available to Batch B, unchanged by this migration:** `presby_list_own_congregation_publications(p_year integer default null)` returns `setof congregation_statistics` for `about_org_id = presby_current_org()` (it carries `withdrawn_at` but **not** `withdrawn_by`, `withdrawn_minute_reference` or `supersedes_id` — Phase 2 ruling 1b says build the filing history off the tenant-policy read of `publications ⋈ statistical_returns` instead, and do not widen this function). `presby_list_published_returns_to_me()` still returns withdrawn rows, unfiltered, by design (Option A).

**New template role:** `app_roles` `00000000-0000-0000-0000-000000000004`, `key = 'congregation_stated_clerk'`, `name = 'Stated Clerk'`, `organization_type_scope = 'congregation'`, `role_kind = 'constitutional'`, `is_protected = true`, carrying `statistics.publish`. Adoptable at `/admin/roles/new`; nothing was backfilled into any tenant.

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C) | **In progress — Batch A and Batch B complete** (see Batch A and Batch B sections below for full detail). Batch C (ux-developer) next | — | 2026-09-26 |

## Handoff → api-developer (Batch B)

Apply locally before starting: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0052_presby_withdraw_publication.sql` (owner, direct/unpooled endpoint; **already applied to the `pipeline-withdraw` branch** — the command is for a fresh database or another worktree). `npm run db:seed` and `scripts/seed-dev.sql` are unchanged by Batch A and need no re-run; `scripts/install-test-helpers.sql` only on a database that has never run the isolation suite. `npm run db:push` and `npm run db:generate` must not be run against this migration.

`scripts/test-rls.sql` sections touched: **41 added** (lines 6617–7069, 30 assertions) and **35 corrected in place** (F90, lines 4948–4969). Full suite as `presby_app`: 550 assertions, exit 0.

Batch B still owns: `src/lib/filings.ts`, the `fetchStatisticsForYear()` `withdrawn_at is null` WHERE filter plus both header-comment updates, `admin/filings/actions.ts`, the `STATISTICS_RETURN_WITHDRAWN` audit key, and the unit tests for all of it. The API contract above is the whole DB-side surface.

---

## Batch B — Server + read side (api-developer, 2026-09-26)

### Files Created

- `src/lib/filings.ts` — **new**, the congregation's own module (Two Hierarchies' other axis from `presbytery.ts`). Exports `listOwnFilings()` (a plain tenant-policy `publications ⋈ statistical_returns` join, no new DEFINER function, per Phase 2 ruling 1b) and `withdrawFiling()` (calls `presby_withdraw_publication()` inside `withOrgContext()`, maps its three refusal SQLSTATEs to `FilingsResult` kinds, reads back `recipientOrgId`/`reportYear` in the same transaction for the caller's audit write). `MINUTE_REFERENCE_MAX = 500` exported for reuse by the action's zod schema.
- `src/lib/filings.test.ts` — **new**, 12 tests, Postgres-backed (`describe.skipIf(!hasDb)`), builds its own throwaway publish/supersede fixtures for Alder Creek at report years 2071–2079 (never the seeded 2025 fixture), torn down in `afterAll` via the same disable-freeze-trigger/delete/re-enable convention `presbytery.test.ts`/`statistics-grants.test.ts` already use.
- `src/app/(org)/o/[slug]/admin/filings/actions.ts` — **new**, `withdrawFilingAction()`. Gate order: `auth()` → `resolveOrgContext()` → `assertOrgAccess()` → `isFlagEnabled("org_portal.filings")` → org-type (`congregation`) → zod (`publicationId: uuid`, `minuteReference: trim().min(1).max(500)`) → `withdrawFiling()` → `FilingsResult` → `ActionResult` copy mapping → `recordAudit()` → `revalidatePath()`.
- `src/app/(org)/o/[slug]/admin/filings/actions.test.ts` — **new**, 23 tests, mocked at the `@/lib/filings`/`@/lib/authz`/`@/lib/flags`/`@/lib/audit` boundary (statistics-grants' `actions.test.ts` precedent), pinning the gate order, the `withdrawnBy` server-side binding, the five-kind refusal-copy mapping, and the full audit-metadata shape.

### Files Modified

- `src/lib/presbytery.ts`:
  - `fetchStatisticsForYear()` gains `isNull(congregationStatistics.withdrawnAt)` in its WHERE (not the coalesce branch) — a withdrawn `published_by_congregation` row is excluded from the CANDIDATE set entirely, so it can never win even as the sole row on file. This propagates automatically to `generatePerCapitaRecords()` (same helper): a withdrawn return stops being a basis for a NEW bill; an already-issued bill survives untouched.
  - Both header rewrites done in the same edit: the module header's "STATISTICS PROVENANCE COALESCE" paragraph gained a new "WITHDRAWAL" paragraph; `fetchStatisticsForYear()`'s own doc comment states the WHERE-filter rule.
  - **New export `getCongregationFilingHistory()`** — a deliberate deviation from Phase 3's own statement that `presbytery.ts` would be "touched only for the WHERE-filter edit": Batch C's nested `/o/<slug>/admin/reports/[aboutOrgId]` sub-view (Phase 2 ruling 1d) needs a backing read, and `resolveMemberCongregation()`/`listMemberCongregations()` — the parent-path check every `aboutOrgId` must go through — are module-private helpers here, never exported (matching `getCongregationOversightDetail()`'s exact precedent for a per-congregation nested-route read). Calls the EXISTING `presby_list_published_returns_to_me(p_about_org_id, p_year)` (`drizzle/0047`, unchanged) via `tx.execute()` — no new DEFINER function. Gated on `statistics.manage` (the sibling read's permission), parent-path-checked, returns `{ congregationName, rows: PublishedFilingRow[] }` with withdrawn rows INCLUDED and marked (Option A). Raw `tx.execute()` results carry no column-OID type info — timestamptz columns come back as Postgres-text strings, not JS Dates (measured live, matches the `check:sql-date` tripwire's own finding) — so a new `toIsoOrNull()` helper re-parses them, unlike `toRollupRow()`'s free Date objects from a real Drizzle `.select()`.
- `src/lib/presbytery.test.ts` — `getCongregationFilingHistory` import wired into `beforeAll`; two new fixture helpers (`withdrawProjectionRow()`, `withdrawPublicationRow()`) added beside `armedPublicationWrite()`/`makePublication()`; **9 new tests**: 2 in "congregation statistics" (withdrawal excluded from the coalesce, falls through to `presbytery_entered`; withdrawal with no other data yields `hasData: false`), 1 in "per-capita" (a withdrawn basis-year return is skipped for a NEW billing year while an already-issued bill on an OLDER billing year survives untouched), 6 in a new `describe("getCongregationFilingHistory", …)` block (forbidden, invalid_target × 2 — wrong presbytery and non-congregation org type, returns unwithdrawn, returns withdrawn marked, empty year). All 44 tests in the file pass (35 pre-existing + 9 new).
- `src/lib/audit.ts` — `STATISTICS_RETURN_WITHDRAWN: "tenant.statistics_return.withdrawn"` appended to `AUDIT_ACTIONS`, with the metadata shape documented inline (`{ organizationId, recipientOrgId, aboutOrgId, reportYear, publicationId }`) and the same "no separate presbytery-side event" / `check:audit` review-verified-not-tripwire-proven notes Phase 2 specified.
- `src/lib/audit.test.ts` — `EXPECTED_ENTRIES` snapshot gained the new key (this test would otherwise fail on any `AUDIT_ACTIONS` addition, by design).
- `src/lib/org-portal/tiles.ts` — new `filings` tile appended after `reports` (`orgTypeScope: ["congregation"]`, `flagKey: "org_portal.filings"`, `category: "administer"`, `domain: "reports"`), per architect's Phase 2 ruling 1c.
- `src/lib/org-portal/tiles.test.ts` — updated in the same edit: `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS` gained the flag; the 18→19 tile-count assertion and the full-key-list snapshot updated; the `EXPECTED` table gained `filings`; the "presbytery-only tiles" test generalized to also cover a congregation-only tile; the three tests that compute an "administer at presbytery" expected set (`returns every administer tile…`, `preserves…order…`, `category is routing-only…`) were corrected to filter by `orgTypeScope` the same way `visiblePortalTiles()` itself does (they previously assumed every `administer`-category tile was presbytery-visible, which stopped being true the moment a congregation-only administer tile existed) — a real, findable defect in the EXISTING test's own assumption, not merely additive coverage; a new sibling test asserts the congregation-side view of the same "every administer tile in scope" property, including `filings` and excluding `reports`.
- `scripts/seed.ts` — `org_portal.filings` flag row appended after `org_portal.statistical_publication` (seeded `false`), and **applied for real** to the `pipeline-withdraw` Neon branch via `npm run db:seed` (verified live: `select key, enabled from feature_flags where key = 'org_portal.filings'` → `f`).

### Schema Changes

None. Batch B touches no migration, no table, no column — it consumes the Batch A contract exactly as handed off.

### Audit Events

`STATISTICS_RETURN_WITHDRAWN` is written from `withdrawFilingAction()` on the `ok` branch only (never on a refusal), with `resourceType: "publications"`, `resourceId: <publicationId>`, and metadata `{ organizationId, recipientOrgId, aboutOrgId, reportYear, publicationId }` — both organization ids, per Phase 2's ruling. `aboutOrgId` is `identity.organizationId` itself (never a second read — a congregation's own publication is always about itself); `recipientOrgId`/`reportYear` come from `withdrawFiling()`'s own read-back inside the same transaction (`revokeStatisticsGrant()`'s "no extra round trip" precedent). **`check:audit` note, as flagged by Phase 2:** the tripwire (`scripts/check-audit-coverage.mjs`) scans `src/app/**/actions.ts` for `db.`-receiver mutations; the actual mutation is a `tx.execute(...)` inside `src/lib/filings.ts`'s `withdrawFiling()`, called from the action. `npm run check` (all five tripwires, including `check:audit`) passed clean, but this audit write is **review-verified, not tripwire-proven** — recorded here explicitly so nobody reads the green tripwire as enforcement of this specific write.

---

## Implementer Notes — Batch B

### Deviation: `getCongregationFilingHistory()` lands in `presbytery.ts`, not a new file

Phase 3's API Contract states `presbytery.ts` "is touched only for the `fetchStatisticsForYear()` WHERE-filter edit… withdrawal reading into it is what a *consumer* of the projection does, not a new capability of the congregation module" — read narrowly, that sentence is about NOT putting congregation-side capability there, and it doesn't name a home for the presbytery's own nested-route read either. Phase 2's own ruling 1d says the sub-view is "the recipient reading what it received" — a PRESBYTERY capability, the opposite axis from `filings.ts` — and the orchestrator's task explicitly asked for this read "if Phase 3 puts it in Batch B." Given `resolveMemberCongregation()`/`listMemberCongregations()` (the parent-path check every `aboutOrgId` must go through, per this file's own header) are module-private and never exported, and `getCongregationOversightDetail()` is the exact existing precedent for a per-congregation nested-route read living in this file, `getCongregationFilingHistory()` was added here rather than invented a third home. Flagging this as a deviation from one sentence in Phase 3's design doc, not a silent addition — tech-lead/QA should confirm the placement reads as intended.

### Deviation: `withdrawFiling()`'s return type widened beyond Phase 3's stated `{ id: string }`

Phase 3's signature was `Promise<FilingsResult<{ id: string }>>`, but Phase 2's Audit Events ruling specifies metadata carrying `recipientOrgId` and `reportYear` — facts the bare `id` cannot supply without a second, separate query from `actions.ts`. Widened the success payload to `WithdrawnFiling { id, recipientOrgId, reportYear }`, populated via one follow-up `tx.select()` in the SAME transaction right after the successful call (self-scoped — the row just withdrawn is unambiguously this congregation's own) — the exact "fetched in this SAME pre-select — no extra round trip" precedent `revokeStatisticsGrant()` already established in `statistics-grants.ts`. `aboutOrgId` itself needed no read-back: for a congregation withdrawing its own publication it is always exactly `organizationId`, which the action already has.

### The `org_portal.filings`/`tiles.ts` deviation from Phase 3's batch assignment

Phase 3's Implementation Order put `tiles.ts`/`tiles.test.ts` in Batch C. The orchestrator's task directive for this session explicitly assigned the tile + flag (with the `tiles.test.ts` snapshot update "in the same edit") to Batch B instead — followed as instructed. Batch C therefore inherits a tile that already exists; it should not re-add it.

### Test-suite defect found and fixed while adding the `filings` tile (not merely additive)

Three pre-existing `tiles.test.ts` assertions computed their "every administer tile" expected set with a bare `category === "administer"` filter, silently assuming no `administer`-category tile would ever be scoped away from `organizationType: "presbytery"`. That assumption was accidentally true only because every administer tile happened to be either unscoped or presbytery-scoped — the moment a congregation-only administer tile (`filings`) existed, those three tests failed for the RIGHT reason (a real gap in the test's own filtering logic, not a registry bug). Corrected in place to mirror `visiblePortalTiles()`'s actual `(!orgTypeScope || orgTypeScope.includes(organizationType))` filter, plus a new sibling test asserting the congregation-side view of the same property. Worth a line in a future test-coverage review if this pattern (a test computing its own "expected" set via a simpler filter than the function under test actually uses) recurs elsewhere.

### `check:audit`'s scope, confirmed not just asserted

Ran `npm run check:audit` (`scripts/check-audit-coverage.mjs`) after adding the new key and after writing `actions.ts` — passed clean either way, confirming (not merely restating Phase 2's prediction) that the tripwire's `MUTATION_RE` does not fire on `withdrawFiling()`'s `tx.execute(...)` inside `src/lib/filings.ts`, because the tripwire scans `actions.ts` files. Documented above so a future reader of a green `check:audit` run doesn't mistake it for proof this specific write is covered.

### Failing-first evidence (two genuine bugs injected, caught, and reverted)

1. **`filings.ts`'s SQLSTATE mapping.** Temporarily changed the `code === "42501"` branch to a bogus code string, ran `filings.test.ts`: **3 of 12 tests failed** (`invalid_target` for a bad id; `invalid_target` for a non-member `p_withdrawn_by`; the three-refusal-kinds-distinct test), each failing with the real DB error `publications: this withdrawal is not permitted` surfacing unhandled instead of being mapped. Reverted; all 12 passed again.
2. **`actions.ts`'s `withdrawnBy` binding.** Temporarily changed the call site to `(input as any).withdrawnBy ?? identity.userId`, ran `actions.test.ts`: the dedicated regression test failed exactly as designed, asserting `mockWithdrawFiling` was called with `identity.userId` and receiving the attacker-supplied value instead. Reverted; all 23 passed again.

Both diffs were applied via a backup-copy/`sed`/restore cycle, confirmed via `git status`/`diff` to have left no residue, and re-verified green before moving on.

### Residuals, named not closed (unchanged from Batch A, still true)

Same four as Batch A's own list: the permission gate is app-layer only (QA's feature-gate audit is the check); `p_withdrawn_by` misattribution within one congregation is possible but bounded and audit-cross-checkable; the founding-administrator template-adoption gap is pre-existing and unaffected (`org_portal.filings` shipping off buys the same time it always has); F44 (owner residual) is unchanged.

### Commands and outputs

| Command | Result |
|---|---|
| `npm run typecheck` (run repeatedly through the session) | exit 0 throughout |
| `npm run lint` | exit 0 — 0 warnings |
| `npm run check` (all five tripwires) | exit 0 — `check:audit` passed with the note above; `check:sql-date` passed (no `sql<Date>` introduced; the one raw-string-timestamp read in `getCongregationFilingHistory()` uses a plain re-parse, not a `sql<Date>` tag) |
| `dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/filings.test.ts` | exit 0 — **12 passed (12)** |
| `dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery.test.ts` | exit 0 — **44 passed (44)** (35 pre-existing + 9 new) |
| `vitest run "src/app/(org)/o/[slug]/admin/filings/actions.test.ts"` | exit 0 — **23 passed (23)** |
| `vitest run src/lib/audit.test.ts` | exit 0 — **15 passed (15)** |
| `vitest run src/lib/org-portal/tiles.test.ts` | exit 0 — **43 passed (43)** |
| `vitest run` on the five `(org)/o/[slug]` portal-nav/layout/page/admin-page/footer files that consume `PORTAL_TILES` | exit 0 — **63 passed, 16 skipped** (the skip is a DB-gated file, unrelated) |
| `dotenv -e .env.local -- vitest run --no-file-parallelism` on `filings.test.ts` + `presbytery.test.ts` + `statistics-grants.test.ts` + `publication.test.ts` together | exit 0 — **130 passed (130)** |
| `npm test` (full suite, no `DATABASE_URL`) | exit 0 — **3340 passed, 856 skipped (4196 total)** |
| `npm run test:db` (full suite, `DATABASE_URL` loaded, `--no-file-parallelism`, ~30 DB-backed files plus every unit test in one run) | exit 0 — **289 test files passed, 4196 tests passed, 0 failed**, 375.37s |

The `npm run test:db` total (4196) matches `npm test`'s combined passed+skipped count (3340+856) exactly — confirming the DB-backed subset that was skipped without a live connection is the same subset that ran and passed with one, and that Batch B's edits caused zero regressions anywhere else in the suite.

---

## API contract Batch C consumes

```ts
// src/lib/filings.ts
export const MINUTE_REFERENCE_MAX = 500;

export type FilingsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "already_withdrawn" }
  | { kind: "superseded" };

export interface FilingRow {
  publicationId: string;
  reportYear: number;
  publishedAt: string;               // ISO
  minuteReference: string | null;
  supersedesId: string | null;
  withdrawnAt: string | null;        // ISO, or null
  withdrawnBy: string | null;
  withdrawnMinuteReference: string | null;
}

export async function listOwnFilings(
  viewerPersonId: string,
  organizationId: string,
  year?: number,
): Promise<FilingsResult<FilingRow[]>>;

export interface WithdrawnFiling {
  id: string;
  recipientOrgId: string;
  reportYear: number;
}

export async function withdrawFiling(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,      // bound server-side from the session, NEVER a client field
  publicationId: string,
  minuteReference: string,
): Promise<FilingsResult<WithdrawnFiling>>;
```

```ts
// src/lib/presbytery.ts (new export, unchanged existing ones)
export interface PublishedFilingRow {
  publicationId: string;
  reportYear: number;
  publishedAt: string;               // ISO
  minuteReference: string | null;
  attestedByName: string | null;
  attestedRole: string | null;
  withdrawnAt: string | null;        // ISO, or null — Option A, never filtered
  withdrawnBy: string | null;
  withdrawnMinuteReference: string | null;
}

export async function getCongregationFilingHistory(
  viewerPersonId: string,
  organizationId: string,
  aboutOrgId: string,
  year?: number,
): Promise<PresbyteryResult<{ congregationName: string; rows: PublishedFilingRow[] }>>;
// PresbyteryResult<T> = { kind: "ok"; data: T } | { kind: "forbidden" }
//                     | { kind: "invalid_target" } | { kind: "invalid_input"; message: string }
// invalid_target: aboutOrgId is not a member congregation of this presbytery
// (wrong presbytery OR wrong org type) — a real 404 on Batch C's nested page,
// same as admin/oversight/[aboutOrgId]/page.tsx's own invalid_target branch.
```

**Server action:**

```ts
// src/app/(org)/o/[slug]/admin/filings/actions.ts
"use server";
export async function withdrawFilingAction(
  slug: string,
  input: { publicationId: string; minuteReference: string },
): Promise<ActionResult<{ id: string }>>;
```

**`ActionResult` variants and the exact user-facing copy** (`ActionResult<T> = { ok: true; data?: T } | { ok: false; error: string }`):

| Situation | `ok` | `error` copy (verbatim) |
|---|---|---|
| Not signed in | false | "You must be signed in to do that." |
| Not a member of this org / access ended since page load | false | "You don't have access to that organization." |
| `org_portal.filings` flag off | false | "Statistical filings aren't turned on for this organization." |
| Org type is not `congregation` | false | "Statistical filings aren't available for this organization." |
| Bad `publicationId` (not a uuid) or blank/over-500-char `minuteReference` | false | zod's own message |
| `FilingsResult.kind === "forbidden"` (no `statistics.publish`) | false | "You don't have permission to withdraw filings here." |
| `FilingsResult.kind === "invalid_target"` | false | "That filing can't be withdrawn. Refresh the page and try again." |
| `FilingsResult.kind === "already_withdrawn"` | false | "This filing has already been withdrawn." |
| `FilingsResult.kind === "superseded"` | false | "A newer filing supersedes this one — only the current filing can be withdrawn." |
| Success | true | `data: { id: <publicationId> }` |

**Flag + tile, already seeded/registered (Batch C does not need to add these):** `org_portal.filings` (seeded `false`, live on `pipeline-withdraw`); `PORTAL_TILES` entry `key: "filings"`, `href: (slug) => \`/o/${slug}/admin/filings\``, `orgTypeScope: ["congregation"]`, `category: "administer"`, `domain: "reports"`.

**Page-preamble order Batch C's two pages must follow** (matching `admin/reports/page.tsx`/`admin/oversight/[aboutOrgId]/page.tsx` exactly): `cachedAuth()` → `resolveOrgContext()` (four-way miss) → `assertOrgAccess()` → `isFlagEnabled("org_portal.filings")` → `PlaceholderFlagOff` → org-type check → `PlaceholderNotAvailable` → the data read (`listOwnFilings()` for `/admin/filings`, `getCongregationFilingHistory()` for `/admin/reports/[aboutOrgId]`).

---

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C) | **In progress — Batch A and Batch B complete.** Batch B: `src/lib/filings.ts` (new), `presbytery.ts` withdrawal filter + `getCongregationFilingHistory()` (new export, deviation noted), `audit.ts` key, `admin/filings/actions.ts` (new), `filings` tile + `org_portal.filings` flag (seeded off, live on `pipeline-withdraw`), 45 new tests across 4 files (12 filings.test.ts + 9 presbytery.test.ts + 23 actions.test.ts + 1 tiles.test.ts), plus corrections to 6 existing tiles.test.ts assertions and 1 audit.test.ts snapshot entry. `npm run typecheck`/`lint`/`check` clean; `npm run test:db` — 289 files, 4196 tests, 0 failed. Two failing-first bugs injected/caught/reverted (SQLSTATE mapping, `withdrawnBy` binding). Batch C (ux-developer) next | — | 2026-09-26 |

## Handoff → ux-developer (Batch C)

Build no server logic — everything you need is the API contract above. Per Phase 3's Component/Page Plan and Phase 2's rulings:

1. `src/app/(org)/o/[slug]/admin/filings/page.tsx` + `filings-states.tsx` + `filings-table.tsx` + `withdraw-dialog.tsx` + `page.test.tsx` — the congregation's filing history + withdraw, calling `listOwnFilings()` (Server Component read) and `withdrawFilingAction()` (client `'use server'` call from `withdraw-dialog.tsx`, modeled on `admin/officers/end-term-dialog.tsx`'s `AlertDialog`-with-required-text-field shape). Empty state must say plainly that filing a new return isn't built yet on this page (Phase 1's required copy).
2. `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx` + `page.test.tsx` — the presbytery's per-congregation history, calling `getCongregationFilingHistory()`, modeled on `admin/oversight/[aboutOrgId]/page.tsx` exactly (its `invalid_target` branch is your 404).
3. `src/app/(org)/o/[slug]/admin/reports/statistics-table.tsx` — wrap the congregation-name cell in a `<Link href={\`/o/${slug}/admin/reports/${entry.organizationId}\`}>`; thread `slug` into `StatisticsTable`'s props from `reports/page.tsx`.
4. Real-browser rehearsal at 360px against the `pipeline-withdraw` Neon branch's dev server (port 3600), per CLAUDE.md → Verify in a Browser — walk Flow 1 (list → withdraw → dialog → confirm → row updates) and Flow 2 (rollup excludes it, nested history page shows it marked) end to end. The congregation clerk fixture is Tobias Renwick (`c0000000-0000-0000-0000-000000000002` / user `e0000000-0000-0000-0000-0000000000f3`, Alder Creek, holds `statistics.publish` via the org-owned `stated_clerk` role) — no new fixture role/grant needed, the template role `drizzle/0052` created has no adopted copy in the dev fixture and isn't required for this walkthrough.
5. Your own tests: `page.test.tsx` for both pages (flag-off / wrong-org-type / no-permission / empty / non-empty forks, matching `admin/reports/page.test.tsx`'s shape), and the withdraw dialog's own disabled-state test (empty/overlong minute reference blocks submit, per Phase 2 Note 5's test list).

**Not your job, already done:** the flag row, the tile, the audit key, the `ActionResult` copy mapping, the zod validation, the DB-side SQLSTATE→result mapping. Don't re-add the `filings` tile or the flag row — check `tiles.ts`/`scripts/seed.ts` before editing either.

---

## Batch C — UI (ux-developer, 2026-09-26)

### Files Created

- `src/app/(org)/o/[slug]/admin/filings/page.tsx` — the congregation's own filing history + withdraw. Preamble byte-order-identical to `admin/reports/page.tsx`: `cachedAuth()` → `resolveOrgContext()` (four-way miss) → `assertOrgAccess()` → `isFlagEnabled("org_portal.filings")` → `PlaceholderFlagOff` → org-type check (`["congregation"]`) → `PlaceholderNotAvailable` → `listOwnFilings()`. `OrgAccessError` re-thrown, any other thrown error renders `FilingsLoadError`. The filing-history table is a non-exported `FilingsTable()` helper defined in this same file (JSX computed, not a nested async component) — **deliberately not a separate `filings-table.tsx`**: the orchestrator's task directive for this batch named the exact file set (`page.tsx`, `filings-states.tsx`, `withdraw-dialog.tsx`, `page.test.tsx`), superseding Phase 3's own Component Plan, which had proposed a fifth file. Flagging this as a deviation from Phase 3's plan, not a silent simplification — the shape (page-specific composition, single call site, no reuse) matches `admin/reports/page.tsx`'s own `renderStatisticsSection()` helper precedent, so it is not a new pattern. A row is "current" (the only one carrying the Withdraw action) when nothing else in the list names it via `supersedesId` and it is not itself withdrawn. Empty state states plainly, per Phase 1's required copy, that filing a new return isn't built on this page yet.
- `src/app/(org)/o/[slug]/admin/filings/filings-states.tsx` — `FilingsSectionForbidden`, `FilingsLoadError`, modeled on `../reports/reports-states.tsx`/`../oversight/oversight-states.tsx`'s `Forbidden`/`LoadError` pair. One permission (`statistics.publish`), so `Forbidden` needs no section parameter (unlike `ReportsSectionForbidden`, which is parameterized across two independent permissions).
- `src/app/(org)/o/[slug]/admin/filings/withdraw-dialog.tsx` — the **only** `'use client'` file in this route (Phase 2 ruling 1e). shadcn `AlertDialog` + a required `Input` (minute reference) + `Label`, modeled directly on `../officers/end-term-dialog.tsx`'s "AlertDialog with a required text field" shape — no native `confirm()`. `AlertDialogAction` is disabled while the trimmed input is empty or over `MINUTE_REFERENCE_MAX` (500) characters, or a submission is pending. `toast.error(result.error)` on failure (the exact five-variant copy Batch B's `withdrawFilingAction` returns, surfaced verbatim), `toast.success(...)` + `router.refresh()` + dialog close on success.
- `src/app/(org)/o/[slug]/admin/filings/page.test.tsx` — 9 tests: unauthenticated redirect; flag-off checked before `listOwnFilings()`; wrong-org-type placeholder without a data read; `OrgAccessError` re-thrown; generic thrown error → load-error state; forbidden → `FilingsSectionForbidden`; the plain empty-state copy; current/withdrawn/superseded rows rendered honestly with exactly one Withdraw trigger per truly-current row; the dialog's disabled-until-minute-reference-present behavior, through to a real `withdrawFilingAction` call with the trimmed value.
- `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx` — the presbytery's per-congregation filing history (architect Phase 2 ruling 1d). Same preamble order, `REPORTS_ORG_TYPES: ["presbytery"]`, flag `org_portal.reports` (the existing tile's flag — this is a nested route, not a new tile, per Phase 3 Permissions & Flags). Reuses `../reports/reports-states.tsx`'s `ReportsSectionForbidden`/`ReportsSectionLoadError` verbatim rather than adding a new states file — the orchestrator's file-set directive for this batch did not list one, and these two exports already parameterize by `section`/`slug` cleanly for this one-permission (`statistics.manage`) use. `getCongregationFilingHistory()`'s `invalid_target` (the parent-path check) calls `notFound()` — a real 404, exactly `admin/oversight/[aboutOrgId]/page.tsx`'s identical branch. Withdrawn rows are included and marked (Option A) with date and minute reference, never filtered — the filtering belongs only to the parent list's "current" pick.
- `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.test.tsx` — 9 tests, mirroring `../../oversight/[aboutOrgId]/page.test.tsx`'s shape: unauthenticated redirect; flag checked before the data read; wrong-org-type placeholder without a data read; `OrgAccessError` re-thrown; generic error → load-error; forbidden → `ReportsSectionForbidden`; `invalid_target` → `notFound()`; the sub-view's own empty state; a withdrawn row included and marked (name, date, minute reference, attested-by).

### Files Modified

- `src/app/(org)/o/[slug]/admin/reports/statistics-table.tsx` — wrapped the congregation-name cell in a `<Link href={\`/o/${slug}/admin/reports/${entry.organizationId}\`}>`; `StatisticsTable` now takes a `slug` prop.
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — passes `slug` to `<StatisticsTable>`.

### Deviations / Implementer Notes

1. **File set narrowed from Phase 3's plan, per this batch's own orchestrator directive** (see `filings-table.tsx` note above) — the filing-history table lives inline in `page.tsx` as a non-exported helper instead of a fifth file. No `filings-table.tsx` exists.
2. **No new `reports-states`-equivalent file for the sub-view** — reused the existing `reports-states.tsx` exports (`section="filing history"`), rather than adding a states file the batch's file list didn't call for.
3. **A real bug found and fixed during the browser rehearsal, not merely at review**: `withdraw-dialog.tsx` originally imported `MINUTE_REFERENCE_MAX` from `@/lib/filings`, which is `import "server-only"`-marked. Any import from that module — even a plain numeric constant — poisons the entire client bundle; Next.js's dev server failed to compile *every* page in the app (including `/signin`) with `'server-only' cannot be imported from a Client Component module` the moment `withdraw-dialog.tsx` was reachable from the tree. `npm run typecheck`/`lint`/`vitest` (jsdom, mocked `@/lib/filings`) all stayed green throughout — none of them build the real Next.js module graph, so none could have caught this; only the real dev-server build surfaced it. Fixed by duplicating the constant by value in `withdraw-dialog.tsx` (`filings.ts`'s own header already documents this exact per-module-duplication convention for a single shared constant) with a comment naming why. **This is the CLAUDE.md "Verify in a Browser" invariant working exactly as designed** — `next build`/`tsc`/unit tests passing was not evidence the page worked.
4. **Table columns intentionally overflow at 360px, inside the shared `Table` primitive's own scrollable container** (`src/components/ui/table.tsx`'s documented scroll-fade-cue design) — this is the same accepted pattern `GrantsTable`/`StatisticsTable` already ship (four-plus visible columns at mobile, `hidden sm:table-cell` only for the least essential ones). The *page* never scrolls sideways; only the table's own bounded, cued container does. Considered hiding "Minute reference" at mobile via `hidden sm:table-cell` to eliminate the inner scroll entirely, and reverted — Phase 1's own required copy says minute references must be shown, and hiding the column at the narrowest breakpoint (rather than making it scrollable) would silently drop that requirement for exactly the viewport this batch was asked to verify.

### Browser Rehearsal (CLAUDE.md → Verify in a Browser)

Dev server: `rm -rf .next && npm run dev -- -p 3600` against the `pipeline-withdraw` Neon branch (`.env.local` in this worktree), stopped by PID (`kill $(cat /tmp/dev-3600.pid)`), never `pkill -f`. Playwright (already a devDependency) driven from a throwaway script under the gitignored `scratch/` directory, 360×800 viewport, real sign-in (no session mocking).

**Feature-flag state changed on the `pipeline-withdraw` branch DB only, via SQL on `feature_flags` (never `db:push`, never `ALTER ROLE`, never another branch):**

| Flag | Before | Changed to | Why | After rehearsal |
|---|---|---|---|---|
| `org_portal.filings` | `false` (Batch B's seed) | `true` | The tile/page is flag-gated and seeded off by design (Phase 3) — needs to be on to walk it | **Left `true`** on this branch for QA's Phase 5 use. A fresh `npm run db:seed` on this branch resets it to the shipped default (`false`) — expected, not a regression. |
| `auth.require_2fa` | `true` (pre-existing branch state, unrelated to this pipeline) | `false` | Both fixture users (`clerk.fixture@example.invalid`, `presbytery.clerk.fixture@example.invalid`) have `two_factor_required = false` at the row level, but the global `auth.require_2fa` flag was independently `true` on this branch and the Edge gate ORs the two — signing in redirected straight to `/account/2fa` enrollment before either page under test was ever reached. This flag is unrelated to anything Batch A/B/C shipped; it predates this pipeline's work on the branch. | **Reverted to `true`** immediately after the rehearsal — this pipeline does not touch `src/auth.ts`/`(auth)`/`lib/auth/`, so there is no reason for this auth-critical flag to end the session in a different state than it started. |

**Flow 1 — congregation clerk withdraws a filing** (signed in as `clerk.fixture@example.invalid`, Tobias Renwick, Alder Creek):
1. `/o/alder-creek/admin/filings` — one row, 2025 filing, "Current" badge, one "Withdraw" button. Screenshot: `01-filings-list.png`.
2. Click "Withdraw" → `AlertDialog` opens, confirm button disabled with an empty minute reference. Screenshot: `02-withdraw-dialog-empty.png`.
3. Typed a minute reference → confirm button enables. Screenshot: `03-withdraw-dialog-filled.png`.
4. Submitted → verified directly against the database (owner connection, bypassing RLS for the check only): `publications.withdrawn_at`/`withdrawn_minute_reference` set for the 2025 Alder Creek publication. Reloaded the page fresh: row now reads "Withdrawn · 9/26/2026 · Session minutes, 2026-09-26, item 4 (rehearsal)", Withdraw action gone. Screenshot: `04b-filings-after-withdraw-reloaded.png` (an earlier capture, `04-filings-after-withdraw.png`, caught Turbopack's own "Rendering…" overlay mid-refresh and is superseded by the reloaded one — kept both to show the timing artifact was cosmetic, not a functional failure).

**Flow 2 — the presbytery sees the withdrawal** (signed in as `presbytery.clerk.fixture@example.invalid`, Idris Calloway, Presbytery of the Northern Reach):
1. `/o/northern-reach/admin/reports` (default year 2025, the last calendar year) — Alder Creek's row now reads "No data on file," where it previously read "Congregation reported" (confirmed by comparing against Batch B's own rehearsal note and by re-checking the row at year 2026, which still showed "Congregation reported" before the withdrawal and correctly still does for that year, since only the 2025 publication was withdrawn). Screenshot: `05-presbytery-reports.png`.
2. Clicked the "Alder Creek Presbyterian Church" link (the new `<Link>` in `statistics-table.tsx`) → navigated to `/o/northern-reach/admin/reports/22222222-2222-2222-2222-222222222222`. Screenshot: `06-presbytery-filing-history.png`. The sub-view shows the 2025 filing marked "Withdrawn · 9/26/2026 · Session minutes, 2026-09-26, item 4 (rehearsal)" — Option A, included and marked, never filtered — exactly the row Flow 1 just withdrew.

Screenshots (session scratchpad, referenced above): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b08e6db7-b5b1-4a1b-b94f-75e0928bed80/scratchpad/shots/{01-filings-list,02-withdraw-dialog-empty,03-withdraw-dialog-filled,04-filings-after-withdraw,04b-filings-after-withdraw-reloaded,05-presbytery-reports,06-presbytery-filing-history}.png`.

### Commands and Outputs

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 — 0 warnings |
| `npm run check` (all five tripwires) | exit 0 |
| `vitest run --no-file-parallelism "src/app/(org)/o/[slug]/admin/filings/page.test.tsx"` | exit 0 — **9 passed (9)** |
| `vitest run --no-file-parallelism "src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.test.tsx"` | exit 0 — **9 passed (9)** |
| `vitest run --no-file-parallelism "src/app/(org)/o/[slug]/admin/reports/page.test.tsx"` (regression check on the `slug`-threading edit) | exit 0 — **12 passed (12)**, unchanged |
| `npm test` (full suite, no `DATABASE_URL`) | exit 0 — **3358 passed, 856 skipped (4214 total)** — 18 more passing than Batch B's own 3340 (the 9+9 new page tests) |
| `npm run test:db` (full suite, `DATABASE_URL` loaded, `--no-file-parallelism`) | exit 0 — **291 test files passed, 4214 tests passed, 0 failed**, 397.00s |

### Residuals, named not closed (unchanged from Batches A/B)

Same four as before: the permission gate is app-layer only (QA's feature-gate audit is the check); `p_withdrawn_by` misattribution within one congregation is possible but bounded and audit-cross-checkable; the founding-administrator template-adoption gap is pre-existing and unaffected; F44 (owner residual) is unchanged. No new residuals introduced by the UI layer.

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C) | **Complete.** Batch C: `admin/filings/{page.tsx, filings-states.tsx, withdraw-dialog.tsx, page.test.tsx}` (new), `admin/reports/[aboutOrgId]/{page.tsx, page.test.tsx}` (new), `statistics-table.tsx` `<Link>` + `slug` threading, `reports/page.tsx` prop update. 18 new tests (9+9), 0 regressions. One real bug found only by the mandatory browser rehearsal (a `server-only`-marked module imported from a client component, breaking the entire dev build) — fixed, verified, documented. Full Flow 1 and Flow 2 walked end to end at 360px against a real dev server; screenshots and DB-level verification both confirm the withdrawal round-trips correctly. `npm run typecheck`/`lint`/`check` clean; `npm test` — 3358 passed, 856 skipped; `npm run test:db` — 291 files, 4214 tests, 0 failed. | — | 2026-09-26 |

## Handoff → qa (Phase 5)

All three batches are complete. Feature-gate audit should confirm: `statistics.publish` is checked inside `withdrawFiling()` (`src/lib/filings.ts`), never in a route/page alone; `org_portal.filings` is checked in `admin/filings/page.tsx` and independently in `admin/filings/actions.ts` (defense-in-depth, per that file's own comment); `statistics.manage` is checked inside `getCongregationFilingHistory()`; the withdraw action's `withdrawnBy` is bound server-side from the session in `admin/filings/actions.ts` and never accepted from client input (regression-tested in Batch B's `actions.test.ts`). This pipeline does not touch `src/auth.ts`/`(auth)`/`api/auth`/`lib/auth/`, so the CLAUDE.md Phase 4 gate's mandatory MFA-enrolled e2e smoke does not apply — the browser rehearsal above used real sign-in against both fixture users with `auth.require_2fa` temporarily off on this branch only (reverted afterward), which is a UX verification step, not a substitute for that gate. `org_portal.filings` is currently `true` on the `pipeline-withdraw` branch DB (left on after the rehearsal, see the flag table above) — QA does not need to re-enable it, but should know a fresh seed would reset it to `false`.


---

## Phase 4 loop-back (2026-09-26) — the two test fixtures (database-admin)

Returned by QA's FAIL. **No product code was touched** — the two edits are in test
files this pipeline authored. Worktree `../presby-wt-withdraw`, Neon branch
`pipeline-withdraw` confirmed from the live catalog
(`pg_settings.neon.branch_id = br-snowy-recipe-axcqdbx4`); `env | grep DATABASE_URL`
empty at session start; no `ALTER ROLE`, no `db:push`, no `db:generate`, no
migration change (`drizzle/0052` is byte-identical to what Batch A shipped).

### Where the work was done

The pipeline branch database's only Alder Creek publication is irreversibly
withdrawn, so both fixes were developed and proven on **two scratch databases
inside the same branch**, built the documented way and dropped afterwards
(`pg_database` back to `neondb, postgres, template0, template1`):

| Scratch DB | Built by | Seeded publication |
|---|---|---|
| `wd_fix_fresh` | `create database` → `db:migrate` (51 rows in `drizzle.__drizzle_migrations`) → `psql -f drizzle/0052_presby_withdraw_publication.sql` → `db:seed` → `scripts/seed-dev.sql` → `scripts/install-test-helpers.sql` | **withdrawn and committed** by `presby_withdraw_publication()` as `presby_app` in Alder Creek's context (minute `Session minutes, 2026-09-26, item 4 (rehearsal)`), reproducing Batch C's rehearsal exactly |
| `wd_fix_pristine` | same recipe | live |

Connection strings were swapped **in the shell only** (`MIGRATE_/APP_/DATABASE_/PLATFORM_DATABASE_URL`
with the database name replaced); `.env.local` is untouched (`git diff` empty).

### Files and lines changed

**1. `scripts/test-rls.sql` — §41(c) fixture pick** (`scripts/test-rls.sql:6759-6778`,
inside the appended §41 block; the file still shows exactly the same **three** hunks
vs `82d6b54` — the F90 comment block, the one-line §35 assertion, the appended §41).
`and withdrawn_at is null` deleted from the pick, with a comment recording why a
withdrawn row serves: all four (c) probes refuse in the **identity** class, which
`drizzle/0052` checks strictly before any state check. The fixture-missing raise now
reads "has no publication to probe with".

**2. `scripts/test-rls.sql` — §41(f) fixture pick** (`scripts/test-rls.sql:7000-7011`).
The same latent defect, one assertion further on: (f)'s pick also carried
`and withdrawn_at is null`, which on a withdrawn database silently degenerated into
`where id = null` — a zero-row UPDATE that still passes today only because
`presby_app` holds no UPDATE grant at all. Made state-agnostic, with a null guard.

**3. `scripts/test-rls.sql` — §41(e), one new assertion** (`scripts/test-rls.sql:6966-6985`),
551 assertions now, up from 550. It pins the ordering that fix 1 depends on: on the
**already-withdrawn** publication (e) has just created, a non-member `p_withdrawn_by`
still receives the uniform identity literal at `42501`, never the honest state
message. Two things ride on it — F40's non-oracle property and §41(c)'s now
state-agnostic pick — and neither was pinned before.

**4. `src/lib/db/domain/publication.test.ts` — `withdrawalFixture()` rewritten**
(`src/lib/db/domain/publication.test.ts:226-280`; was `:201-224`). It no longer picks the seeded
publication. It mints a **fresh chain** — artifact, event, recipient projection —
through `presby_publish_sasr_snapshot()` inside the caller's own always-rolled-back
transaction, the shape `test-rls.sql` §41(d)/(e) already uses, and returns
`{ publicationId, userId, reportYear }`. The org context is saved and restored around
the publish (the publish is the source council's act; callers on the owner connection
may be in no context at all). A new `FIXTURE_YEAR = 2087` constant (`:67-84`) keeps the
fresh chain clear of `SEEDED_YEAR`, so no probe accidentally exercises supersession.
The user pick is split out as `withdrawerUserId()` (`:203-224`) for the one probe that
wants the withdrawer without a chain.

**5. `src/lib/db/domain/publication.test.ts` — the probes that named the seeded row
by predicate rather than by id.** Nine tests failed on a withdrawn fixture; four of
them through `withdrawalFixture()` (fixed by 4), five by targeting
`where recipient_org_id = <northern reach>` or by reading committed rollup state:

| Test (new line) | Change | Claim |
|---|---|---|
| `:534` "gives the recipient presbytery the as-reported artifact…" | now `inOrgRollback`, mints its own chain, reads `presby_list_published_returns_to_me(ALDER, reportYear)` | unchanged — and stronger: the artifact the presbytery cannot see was written in this very transaction |
| `:594` "keeps the shipped projection reader working… (F39)" | see the deviation below | F39 now asserted unconditionally; the rollup's behaviour asserted for the state the fixture is in |
| `:722` "refuses withdrawal attribution with no withdrawal…" | targets its own fresh publication by id, uses the fixture's withdrawer | unchanged |
| `:744` "permits the ONE transition… and refuses every later touch" | all four follow-up probes narrowed from `recipient_org_id` to `id = publicationId` | unchanged |
| `:816` "keeps the withdrawn publication in the recipient's read-back…" | mints first, every before/after count narrowed to its own chain | unchanged |
| `:902` "lets the projection row be MARKED withdrawn, exactly once…" | fixture only | unchanged |
| `:998` "refuses… when the publication has no projection row" | uses `withdrawerUserId()` — it builds its own projection-less publication and must not disarm its own marker | unchanged |
| `:1055` "is NOT refused after a redistricting…" | fixture only | unchanged |
| `:1604`, `:1637` the two `publications_withdrawal_shape` probes | mint a fresh publication and target it by id | unchanged — and now honest: an already-withdrawn row was being refused by an earlier branch of the trigger, so the CHECK under test was never reached |

### Deviation from the hand-back — `publication.test.ts:594` (the rollup reader)

QA's remedy (mint inside the test's own rollback) fixes eight of the nine. It cannot
fix this one, and the reason is structural: `getCongregationStatisticsRollup()` opens
its **own** transaction on the pooled connection (`withOrgContext()` → `db.transaction()`),
so it sees only **committed** rows — which here means `scripts/seed-dev.sql`'s single
Alder Creek projection. A durable fixture of our own is not available either: this file
writes nothing durable by design, a published row cannot be deleted on any connection
afterwards, and `scripts/test-rls.sql:4070/4073` pin the Alder Creek publication and
return counts at exactly one.

So the test was split rather than made conditional on luck:

* **Unconditional, both states:** F39 itself — the projection keeps its own
  `published_at` and `minute_reference`, **equal to the publication's** — asserted
  directly against the committed chain. This is new coverage; the old test only
  asserted the two were truthy, via the rollup.
* **State-appropriate:** the rollup's own documented behaviour for the state the
  fixture is in — every one of the original four assertions when the projection is
  live, and `hasData: false` / `provenance: null` when it is withdrawn (Option A: the
  recipient retains it, marked, and it is never a candidate for "current" —
  `src/lib/presbytery.ts:549`).

Both branches are also proven **unconditionally**, on self-provisioned fixtures that
never touch the seed, in `src/lib/presbytery.test.ts:952` and `:1010`. Nothing that was
proven before is unproven now; the arrangement is recorded here as an accepted residual
rather than hidden.

### Failing-first evidence

Recorded on `wd_fix_fresh` **after** the seeded publication was withdrawn and committed,
with the repo files in their pre-fix state:

| Check | Before the edits | After the edits |
|---|---|---|
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`) | **exit 3, 532 of 550** — abort at `scripts/test-rls.sql:6829`: `ERROR: FAIL — fixture: Alder Creek has no live publication to probe with` (QA's number, reproduced exactly) | **exit 0, 551** |
| `vitest run --no-file-parallelism src/lib/db/domain/publication.test.ts` | **9 failed / 36 passed (45)** — four `TypeError: Cannot read properties of undefined (reading 'id')` at `publication.test.ts:223` (`withdrawalFixture`), three regex mismatches where the trigger answered `already withdrawn at …` instead of the message under test, one `toMatchObject` on the withdrawal triple, one `expected null to be 'published_by_congregation'` | **45 passed (45)** |

And on the pristine database, so neither suite depends on the fixture being withdrawn
either: `test-rls.sql` **exit 0, 551**; `publication.test.ts` **45 passed (45)**.

**The new §41(e) assertion, proven failing-first by disabling its mechanism** (not by
assertion): `pg_get_functiondef()` of `presby_withdraw_publication()` was re-created on
the scratch database with the already-withdrawn state check moved **above** the
membership check, everything else identical.

* On `wd_fix_pristine`: **exit 3, 541 of 551**, abort at `scripts/test-rls.sql:6986` —
  `ERROR: FAIL — an already-withdrawn row answered a NON-MEMBER with its state
  ("publications: this filing was already withdrawn at …"), which tells a stranger the
  row exists and what has happened to it`. Restored from `drizzle/0052` → **exit 0, 551**.
* On `wd_fix_fresh` the same reordering aborts §41(c) itself at `:6839` with the raw
  state message — i.e. the reordering is exactly what would make the state-agnostic
  fixture pick unsound, and the suite refuses it rather than passing quietly.

### The whole-file re-apply, unchanged

`drizzle/0052_presby_withdraw_publication.sql` was applied in full to each scratch
database and is unchanged by this loop-back; the second application on `wd_fix_fresh`
during Batch A's rehearsal (`INSERT 0 1 / INSERT 0 1` then `INSERT 0 0 / INSERT 0 0`)
still stands. It was re-applied here twice more as the restore step of the failing-first
probe above, both times exit 0 with no row-count change. `drizzle/meta/_journal.json`
is untouched on this branch (idx 52 is still owed at integration, per Batch A step 6).

### Commands and outputs

```
psql "$MIGRATE_DATABASE_URL" -c "create database wd_fix_fresh"        # and wd_fix_pristine
MIGRATE_DATABASE_URL=<scratch> npm run db:migrate                     # 51 rows in drizzle.__drizzle_migrations
psql "<scratch owner>" -v ON_ERROR_STOP=1 -f drizzle/0052_presby_withdraw_publication.sql
npm run db:seed ; psql -f scripts/seed-dev.sql ; psql -f scripts/install-test-helpers.sql
psql "<scratch presby_app>" -f scripts/test-rls.sql                   # exit 0, 551 assertions (both DBs)
npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/db/domain/publication.test.ts
                                                                      # 45 passed (45) (both DBs)
npm run typecheck                                                     # exit 0
npm run lint                                                          # exit 0, 0 warnings
npm run check                                                         # all five tripwires pass
npm run test:db                                                       # 291 files, 4214 passed, 0 failed
                                                                      #   — run on BOTH scratch DBs (441.92s / 446.72s)
psql "$MIGRATE_DATABASE_URL" -c "drop database wd_fix_fresh" -c "drop database wd_fix_pristine"
```

**And on the pipeline branch database itself** — the one QA declared permanently unable
to run either check, still carrying its committed withdrawal, repaired in no way:
`psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` → **exit 0, 551 assertions**;
`publication.test.ts` → **45 passed (45)**. Both suites were read-only/rolled-back
there; `publications` on that branch still holds exactly one row, still withdrawn.

### For integration

* **After this fix a committed withdrawal on `development` cannot make either suite
  unrunnable.** Neither suite reads the seeded publication's withdrawal state any more:
  §41(c)/(f) pick whatever publication the fixture database holds, every
  `publication.test.ts` withdrawal probe mints and withdraws its own chain inside a
  rollback, and the one probe that must read committed state (`:594`) asserts the
  state-independent half unconditionally and the rollup's documented behaviour for
  either state. Workflow Rule 16's post-merge `test-rls.sql` re-run is therefore safe to
  perform after anyone exercises the feature.
* `scripts/test-rls.sql` §41 is now **31 assertions** (was 30); the suite total is
  **551** (was 550). QA's re-run should expect 551, not 550.
* Still owed at integration, unchanged: `drizzle/meta/_journal.json` idx 52, and the
  `docs/` lines every phase returned.
* Non-blocking notes QA raised are untouched and still open: `withdraw-dialog.tsx:33`'s
  duplicated `MINUTE_REFERENCE_MAX`, and the 360px inner-scroller placement of the
  Withdraw action (Phase 6's call).

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-withdraw`, branch `pipeline/withdraw`; Neon branch confirmed from the live catalog (`pg_settings.neon.branch_id = br-snowy-recipe-axcqdbx4` = `pipeline-withdraw`). `env | grep DATABASE_URL` empty at session start. No `ALTER ROLE`, no `db:push`, no `db:generate`. Two scratch databases created inside the branch (`qa_fromempty`, `qa_browser`) and both dropped; `pg_database` back to `neondb, postgres, template0, template1`. No repo file was written — `git status --short` is byte-identical to the pre-QA snapshot.

## Type Check

`npm run typecheck`: **PASS** (exit 0)
`npm run lint`: **PASS** (exit 0, 0 warnings)
`npm run check` (all five tripwires): **PASS** — audit, sql-date, deps-drift, brand-scope, secrets all green.
`npm run check:schema-parity`: **PASS** on both the branch DB and a from-empty DB — `64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing`.
`npm run build`: **PASS** — compiled successfully; `/o/[slug]/admin/filings` and `/o/[slug]/admin/reports/[aboutOrgId]` both registered as dynamic routes.

## Unit Tests

| Run | Result |
|---|---|
| `npm test` (no DB) | **3358 passed, 856 skipped (4214)**, 258 files passed / 33 skipped — matches Batch C's claim exactly. The 856 skips are the DB-gated subset, which `test:db` runs. |
| `npm run test:db` **on the branch DB as handed to me** | **FAIL — 9 failed \| 4205 passed (4214)**, 1 test file failed, 400.87s. The work-log claims 291/4214/0. |
| `scripts/test-rls.sql` as `presby_app` **on the branch DB** | **FAIL — exit 3 at 532 of 550 assertions**, aborts at `scripts/test-rls.sql:6829`: `FAIL — fixture: Alder Creek has no live publication to probe with`. |
| Same suite on a **from-empty** DB (0001→0050 + 0052 + seeds) | **PASS — exit 0, 550 assertions**, as `presby_app` (`rolbypassrls=false`, confirmed). |
| `publication.test.ts` on the **from-empty** DB | **PASS — 45 passed (45)**. |

### Failures (all one root cause), `file:line`

1. `scripts/test-rls.sql:6764` — §41(c)'s fixture pick is `… and record_class = 'statistical_return' and withdrawn_at is null`; raise at `scripts/test-rls.sql:6767`.
2. `src/lib/db/domain/publication.test.ts:209` — `withdrawalFixture()`'s identical `and withdrawn_at is null` pick, non-null-asserted at `src/lib/db/domain/publication.test.ts:223`.

Nine tests fail off (2), all in `src/lib/db/domain/publication.test.ts`:
`:533`, `:605`, `:624`, `:696`, `:779`, `:875`, `:929`, `:1478`, `:1506`.

**Root cause.** Both fixtures consume the *single* `published_by_congregation` publication that `scripts/seed-dev.sql` provides for Alder Creek, and both require it to be un-withdrawn. Batch C's browser rehearsal withdrew that row and committed it (`publications.withdrawn_minute_reference = 'Session minutes, 2026-09-26, item 4 (rehearsal)'`). A withdrawal is irreversible by design and a published row is frozen by trigger, so the state cannot be undone. Nor can it be worked around by adding a publication: `scripts/test-rls.sql:4070` and `:4073` pin *exactly one* Alder Creek publication and one statistical return. The branch database is therefore **permanently unable to run either required check**, and `scripts/seed-dev.sql` has no `on conflict` guards, so re-seeding is not a recovery path either. The only recovery is a fresh database.

This is not an environment nuisance — it is an order-dependent test defect in code this pipeline authored, and it violates the standing rule that tests carry no shared mutable state. The trigger is the *mandatory* process step: CLAUDE.md → "Verify in a Browser" requires the rehearsal that breaks it, so every developer who follows the documented process destroys their own ability to run the isolation suite, unrecoverably. It also breaks Workflow Rule 16's required post-merge step ("`scripts/test-rls.sql` is re-run against the merged `development` branch after each merge") the moment anyone exercises this feature on `development`.

**Remedy for (1), proven by me, not proposed.** Dropping `and withdrawn_at is null` from `scripts/test-rls.sql:6764` takes the branch DB from **exit 3 / 532** to **exit 0 / 550**. It is semantically correct, not a papering-over: all four of §41(c)'s arms refuse in the *identity* class, which runs strictly before the state checks. I confirmed that directly — probe A4 (right org, already-withdrawn publication, non-member `p_withdrawn_by`) returns the uniform literal at `42501`, never "already withdrawn". §41(c) never needed a live row. (I patched only a scratch copy in the session scratchpad; the repo file is untouched.)

**Remedy for (2), named not run.** Those tests do perform a real withdrawal, so they need a genuinely un-withdrawn row — the fix is the one §41(d)/(e) already uses and which I reproduced in my own probes: mint a fresh chain inside the test's own rollback via `presby_publish_sasr_snapshot()` instead of consuming the seeded row. I verified this is reachable from the owner connection these tests run on (probe D published a scratch-year chain as `neondb_owner`).

### Failing-first claims reproduced independently (2 of Batch A's, as asked)

Against `qa_fromempty` migrated 0001→0050 **without** 0052:

| Claim | Reproduced |
|---|---|
| §41 alone aborts at function-missing | yes — `ERROR: FAIL F56/DECISION-152: presby_withdraw_publication() exists, is SECURITY DEFINER, and pins search_path = public, pg_temp … — expected 1, got 0` |
| Full suite aborts at the F90-corrected §35 assertion | yes — `scripts/test-rls.sql:4969`, `expected 1, got 0` |
| `publication.test.ts` re-pointed tests fail without the function | yes — **5 failed \| 40 passed (45)**, every failure `function presby_withdraw_publication(uuid, uuid, unknown) does not exist` |
| …and pass after 0052 is applied | yes — **45 passed (45)** |

### From-empty rehearsal (DECISION-150)

`create database qa_fromempty` → `db:migrate` (51 rows in `drizzle.__drizzle_migrations`; this branch's journal is at idx 50, main's now at 51 — 0052 is unregistered and owed at integration) → `0052` applied by `psql` **twice** (`INSERT 0 1 / INSERT 0 1` then `INSERT 0 0 / INSERT 0 0`; idempotent) → `check:schema-parity` 0 failing → `db:seed` → `seed-dev.sql` (`COMMIT`) → `install-test-helpers.sql` → **`test-rls.sql` exit 0, 550 assertions as `presby_app`** → dropped, no residue.

## End-to-End Tests

`npm run test:e2e` — **not run, and not required.** No spec under `e2e/` references `/admin/filings`, `/admin/reports/[aboutOrgId]` or any withdrawal copy (both routes are new), so the suite would add no coverage of this feature; running its `globalSetup` would provision fixture users against the pipeline branch DB. In its place I performed the real-browser verification below, which is stronger evidence for these routes than the e2e suite could give. See Auth Gate for why the stricter MFA gate does not apply.

### Browser verification at 360px — performed by me, not inherited

The branch DB's only Alder Creek publication was already consumed, so rather than degrade it further I ran the walk against a pristine scratch DB (`qa_browser`: migrate → 0052 → `db:seed` → `seed-dev.sql`, flags `org_portal.filings=true`, `org_portal.reports=true`, `auth.require_2fa=false` — **on the scratch DB only**). `rm -rf .next`, dev server on port **3600**, stopped by PID (`96753`, port confirmed free), scratch DB dropped. Chromium 360×800 @2x, real credentials sign-in, no session mocking.

**Flow 1 — congregation clerk (`clerk.fixture@example.invalid`, Tobias Renwick, Alder Creek):**
- `/o/alder-creek/admin/filings` renders the 2025 filing, minute reference, `Current` badge, one Withdraw trigger. Page does not scroll sideways (`scrollWidth 360 == innerWidth 360`).
- Dialog is a shadcn `AlertDialog` — no native `confirm()` — carrying the permanence copy verbatim ("neither reversed, re-dated nor re-minuted"). Confirm is **disabled with an empty minute reference** and **still disabled with a whitespace-only one** (trim is real), enabled after a genuine reference.
- Submitted. Verified at the database: `publications.withdrawn_at/withdrawn_by/withdrawn_minute_reference` written, `withdrawn_by = e0000000-…-00f3` (the **session** user, not anything from the form), projection `congregation_statistics.withdrawn_at` **exactly equal** to the publication's (`timestamps_equal = t`).
- **Audit event written** — `tenant.statistics_return.withdrawn`, `resourceType publications`, `resourceId` the publication, metadata `{aboutOrgId, reportYear: 2025, publicationId, organizationId: 2222…, recipientOrgId: 1111…}` — both org ids, exactly as ruled.
- Reloaded: the row reads `Withdrawn · 9/26/2026 · <minute reference>`, Withdraw action gone (`withdraw triggers now: 0`).

**Flow 2 — presbytery clerk (`presbytery.clerk.fixture@example.invalid`, Northern Reach):**
- `/o/northern-reach/admin/reports?year=2025` — Alder Creek now reads **"No data on file"**; the read-side filter works end to end. No horizontal scroll.
- The new `<Link>` resolves to `/o/northern-reach/admin/reports/22222222-2222-2222-2222-222222222222`; the sub-view returns **HTTP 200** and shows the 2025 filing **marked withdrawn with date and minute reference** (Option A — included, never filtered). No horizontal scroll.
- **Four-way miss on the sub-view, probed:** a bogus `aboutOrgId` → **404**; the presbytery's own id (not a member congregation) → **404**; a real member congregation with no filings (Bramblewood) → **200 + empty state**. No fifth response string.

Tap targets: the dialog's confirm/cancel and the input render at 44px CSS. The 20px "Back to portal"/"Back to reports" links are byte-identical to the precedent page `admin/oversight/[aboutOrgId]` (measured side by side) — a pre-existing shipped convention, not introduced here.

Table columns overflow inside the shared `Table` primitive's own cued scroll container at 360px (Batch C Deviation 4). The *page* never scrolls sideways. Worth a Phase 6 note only: on the narrowest viewport the only row's primary action sits off-screen inside that inner scroller and needs a horizontal swipe to discover. Same pattern `GrantsTable`/`StatisticsTable` already ship; not a gate failure.

Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b08e6db7-b5b1-4a1b-b94f-75e0928bed80/scratchpad/shots-qa/{q1-filings-list,q2-dialog-empty,q3-dialog-filled,q4-after-withdraw,q5-presbytery-rollup,q6-subview}.png`

**On the `server-only` bug Batch C found:** it has no test, and that is **acceptable as a note, not a FAIL.** It is a build-time failure class and `npm run build` passes (run, above) with both routes emitted — `/pre-push` is the mechanical backstop. One genuine residual worth a line: `withdraw-dialog.tsx:33` duplicates `MINUTE_REFERENCE_MAX = 500` by value as a module-private `const`, so it can silently drift from `src/lib/filings.ts`'s exported 500 with nothing catching it. Unobservable to a test as written (the copy isn't exported). Note for the implementer, not a gate.

## Regression Tests Added

None by me — QA authors no tests. Verified as present and exercised:

- `src/lib/db/domain/publication.test.ts:624`, `:696`, `:779` — the three manual-arming positive controls re-pointed at the real writer (*same claim, real writer*). **Failing-first confirmed by me** against a pre-0052 database, passing after.
- `src/lib/db/domain/publication.test.ts:875` — pair aborts rather than half-applying when no projection row exists. Failing-first confirmed.
- `src/lib/db/domain/publication.test.ts:929` — withdrawal after a redistricting is not refused. Failing-first confirmed.
- `scripts/test-rls.sql` §41, 30 assertions — failing-first confirmed (aborts at assertion 1 without 0052).
- `scripts/test-rls.sql:4969` — the F90 in-place correction. Failing-first confirmed (`expected 1, got 0` pre-0052).
- `src/app/(org)/o/[slug]/admin/filings/actions.test.ts:204` — "withdrawnBy is bound server-side, never from input". Batch B reports injecting `(input as any).withdrawnBy ?? identity.userId` and watching it fail; I did not re-inject, but I verified the claim by reading `actions.ts:134-140` and by grepping the whole route directory — no `withdrawnBy`/`withdrawn_by` is read from form data anywhere.
- Batch B's other injected-bug claim (SQLSTATE mapping, 3 of 12 `filings.test.ts` failures) I did not re-inject; `filings.ts` is at 92.45% statement coverage and I independently confirmed all three DB literals and SQLSTATEs behaviourally.

**Coverage gap named (this is the FAIL):** there is no test, at any layer, asserting that the isolation suite and the DB-backed publication suite remain runnable after a withdrawal has been committed to the fixture database — i.e. no test that the suites are independent of the durable state the feature mutates. That gap is what let a green Phase 4 hand over a red branch.

## Coverage on Critical Modules

| Module | Stmts | Branch | Target | |
|---|---|---|---|---|
| `src/lib/permissions.ts` | **100%** | 100% | 100% | ✓ |
| `src/lib/two-factor.ts` | **91.3%** | 100% | 90%+ | ✓ |
| `src/lib/flags.ts` | **100%** | 100% | 100% | ✓ |
| `src/lib/filings.ts` (new) | 92.45% | 81.25% | 70%+ | ✓ |
| `src/app/(org)/o/[slug]/admin/filings/actions.ts` (new) | 97.36% | 90.9% | 70%+ | ✓ |
| `src/lib/presbytery.ts` | 90.47% | 86.91% | 70%+ | ✓ |

`src/lib/audit.ts` and `src/lib/org-portal/tiles.ts` read 0% in that scoped run only because their own spec files weren't in the selection; they pass separately (15 and 43 tests).

## Feature-Gate Audit

Verified by **reading the route and action bodies**, not inferred from green tests. This feature adds **no `src/app/api/**/route.ts`** — everything is server actions, confirmed by diff. The gate axis here is tenant (`hasPermission` / `statistics.*`) plus flags, not the platform `hasFeature`/`FEATURES.*` axis; the table below names what is actually present.

| Route or action | `auth()` present? | Gate present? | Correct key? |
|---|---|---|---|
| `src/app/(org)/o/[slug]/admin/filings/page.tsx` | yes — `cachedAuth()` `:57`, redirect to `/signin` with callbackUrl `:59` | yes — `resolveOrgContext` `:62` (four-way miss `:66/69/77`) → `assertOrgAccess` `:83` → `isFlagEnabled` `:85` → org-type `:90` → `listOwnFilings` `:96` | `org_portal.filings`; org type `["congregation"]`; permission `statistics.publish` enforced inside `listOwnFilings()` (`src/lib/filings.ts:181`) — ✓ ruled order exactly |
| `src/app/(org)/o/[slug]/admin/filings/actions.ts` → `withdrawFilingAction` | yes — `auth()` `:55` | yes — `resolveOrgContext` `:60` → `assertOrgAccess` `:71` → `isFlagEnabled` `:105` → org-type `:112` → zod `:119` → `withdrawFiling` `:134` | `org_portal.filings`; `statistics.publish` inside `withdrawFiling()` (`src/lib/filings.ts:271`) — ✓ defense-in-depth beyond the page |
| `src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx` | yes — `cachedAuth()` `:59` | yes — `resolveOrgContext` `:66` (four-way miss `:70/73/81`) → `assertOrgAccess` `:87` → `isFlagEnabled` `:89` → org-type `:94` → `getCongregationFilingHistory` `:100` | `org_portal.reports` (the ruled flag for a sub-route of the already-flagged reports tree); org type `["presbytery"]`; permission `statistics.manage` inside `getCongregationFilingHistory()`; `invalid_target` → `notFound()` `:117` — ✓ |

Also verified by reading: `getPlatformDb()` appears **nowhere** in the new `(org)` files or `src/lib/filings.ts` (the `(org)` contract); no `loading.tsx` on either new segment (both redirect or 404); `withdrawnBy`/`withdrawn_by` is never read from form data anywhere in the route directory — `withdraw-dialog.tsx:68-71` sends `{publicationId, minuteReference}` only; zod uses `MINUTE_REFERENCE_MAX`, `.trim().min(1).max(500)`, required; `recordAudit` at `actions.ts:167` with `STATISTICS_RETURN_WITHDRAWN` (`src/lib/audit.ts:328`) and both org ids; no `alert`/`confirm`/`prompt`; no `console.log`; `check:brand-scope` green with no second `<BrandTokens>` emitter.

**`check:audit` is green but does not prove this write** — the tripwire scans `src/app/**/actions.ts` for `db.`-receiver mutations and the mutation is a `tx.execute()` in `src/lib/filings.ts`. Confirmed by reading the tripwire's scope, as Phase 2 predicted. The audit write is review-verified **and** behaviourally verified (I watched the row land during the browser walk), not tripwire-proven.

## Schema/RLS Audit

Verified against the **live catalog** (`aclexplode`, `pg_attribute.attacl`, `pg_proc`, `pg_class`, `pg_trigger`), not `information_schema` and not `src/lib/db/domain/`.

| Claim | Verified |
|---|---|
| `presby_withdraw_publication(uuid,uuid,text)` is SECURITY DEFINER | `prosecdef = t` ✓ |
| pins `search_path = public, pg_temp` | `proconfig = {search_path=public, pg_temp}` ✓ |
| EXECUTE to `presby_app` only | `proacl = {neondb_owner=X/…, presby_app=X/…}`; `has_function_privilege('presby_platform', …) = f`; `('public', …) = f` ✓ |
| `presby_deny_publication_withdrawal()` exists, INVOKER | `prosecdef = f` ✓ (keeps its `presby_app, presby_platform` grant, as the DDL documents) |
| **No grant of any kind** on the withdrawal columns | `pg_attribute.attacl` is **NULL** on `publications.withdrawn_at/withdrawn_by/withdrawn_minute_reference` and `congregation_statistics.withdrawn_at/publication_id`; `has_column_privilege('presby_app', …, 'UPDATE') = f` on all five ✓ |
| `publications` grants unchanged | `relacl`: `presby_app SELECT`, `presby_platform SELECT` — no INSERT/UPDATE/DELETE ✓. `0052` contains zero `ALTER TABLE` and zero table/column grant (grep) ✓ |
| Template role `…0004` | present, `organization_type_scope = congregation`, `role_kind = constitutional`, `is_protected = t`, bound to `statistics.publish`; exactly four templates ✓ |
| No backfill | the only other holder of `statistics.publish` is the pre-existing org-owned dev-fixture role `f0000000-…-0005` ✓ |
| `feature_flags` has `org_portal.filings` | yes, `= true` on the branch (left on for QA as stated); `auth.require_2fa = true` (reverted as stated) ✓ — both left exactly as found |
| §35 "only arming site" pin | reads **1**, and exactly one function in the database arms `presby.withdrawal_write_active`: `presby_withdraw_publication` (SECURITY DEFINER) ✓ |

**Behavioural probes as `presby_app`, all in rollback transactions, on a real chain built through `presby_publish_sasr_snapshot()`:**

- **Uniform literal, four ways** — no org context / absent id / the *recipient presbytery* attempting to withdraw the return addressed to it / a non-member `p_withdrawn_by`: all four `publications: this withdrawal is not permitted`, **byte-identical** (single md5 `bc07539d…`), all SQLSTATE **42501**. The fourth probe used an already-withdrawn row and *still* returned the uniform literal — proving the membership check runs strictly before the state checks, which is the ordering DECISION-152 requires.
- **Honest state arms** — superseded: `publications: a later filing supersedes this one; only the current filing may be withdrawn` (**23514**); already-withdrawn: `publications: this filing was already withdrawn at <ts>` (**23514**). Distinct from each other and from the uniform literal.
- **The pair** — returned uuid equals the publication id; `publications` triple written with the passed clerk; projection `withdrawn_at` **exactly equal** to `publications.withdrawn_at` (one `v_now`); projection **retained and marked** (Option A); marker **disarmed on return**; the recipient's `presby_list_published_returns_to_me()` still returns the withdrawn row.

**Which layer actually refuses — probed, not assumed:**

- **Tenant path, marker hand-armed:** `presby_app` raw `UPDATE` on `publications` → `42501 permission denied for table publications`; on `congregation_statistics` → `42501 permission denied for table congregation_statistics`. **The GRANT refuses, not RLS and not the trigger** — DECISION-141 verified as stated. Positive control: `has_column_privilege('presby_app','congregation_statistics','minute_reference','UPDATE') = t`, so this is not a blanket revoke.
- **Owner path, marker unarmed:** `neondb_owner` raw `UPDATE` on `publications` → **the `publications_freeze` trigger** refuses at `42501` with its own literal ("a withdrawal is an authorized act and may only be recorded by the sanctioned withdrawal function…"); on the projection → **`congregation_statistics_freeze`** at `23514`. Named by layer because it is a *trigger*, not the grant or a policy.
- **Owner path, marker hand-armed:** the write **succeeds**. F44 is unchanged and still open by design, exactly as Batches A–C state.

## Auth Gate

`git diff --name-only 82d6b54` plus untracked files contains **no** `src/auth.ts`, no `src/app/(auth)/`, no `src/app/api/auth/`, no `src/lib/auth/` file. (`src/lib/auth/cached-auth` is imported by the new pages but not modified.) **The stricter MFA-enrolled e2e gate does not apply to this diff.** The browser walk above used real credentials sign-in for both fixture users and is recorded as UX/behavioural verification, not as a substitute for that gate.

## Shared-File Discipline (vs `82d6b54`)

| File | Result |
|---|---|
| `scripts/test-rls.sql` | exactly three hunks: `@@ -4947,0 +4948,16 @@` (the F90 comment block, carrying `-- F90 (2026-09-26-withdraw-publication): corrected in place` at `:4948`), `@@ -4953 +4969 @@` (the one-line assertion change), `@@ -6589,0 +6606,464 @@` (appended §41). **Nothing else.** ✓ |
| `scripts/seed-dev.sql` | UNTOUCHED ✓ |
| `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/schema-design-2.md`, `docs/reviews/log.md` | all UNTOUCHED ✓ |
| `src/lib/org-portal/tiles.ts` | one hunk, `+22/-0` ✓ |
| `scripts/seed.ts` | one hunk, `+16/-0` ✓ |
| `src/lib/audit.ts` | one hunk, `+16/-0` ✓ |

Integration note (not a defect): this branch's journal ends at idx 50; main has since merged idx 51 (`0051_presby_group_types`). `0052` is unregistered and owed at integration as idx 52, per Phase 3 Batch A step 6.

## Verdict

**FAIL**

The product code is right. I could not fault it: every catalog claim, every grant claim, every refusal literal, every SQLSTATE, the equal-timestamp pair, the arming/disarming window, the refusing layer at both connections, the read-side fallback, the audit write, the gate order in all three surfaces, and both user flows in a real 360px browser — all verified independently, and all correct. On a from-empty database every required check is green (550 assertions, 45/45, parity clean, build clean). **No change to any non-test file is needed.**

What fails is the test code this pipeline shipped. Two required checks are red on the branch as handed to me:

- `npm run test:db` — **9 failed / 4205 passed**, not the 4214/0 the work-log records.
- `scripts/test-rls.sql` — **exit 3 at 532/550**.

Both trace to `scripts/test-rls.sql:6764` and `src/lib/db/domain/publication.test.ts:209`, which consume a single-use seed fixture and require it to be un-withdrawn. The feature itself destroys that fixture irreversibly, the suite pins the fixture count at exactly one so it cannot be replenished, and the destroying act is the *mandatory* browser rehearsal. Batch C performed it; the branch database can no longer run either check and cannot be repaired. The same will happen to `development` after merge, breaking Workflow Rule 16's required post-merge re-run.

I am ruling this FAIL rather than a note because a required check being red is a FAIL by definition, because the defect is real rather than environmental (an order-dependent test with shared mutable state is a bug in the test), and because it is already realized rather than hypothetical. It is also cheap: one predicate deletion fixes half of it, and I have proven that fix takes the branch from 532 to 550.

### Hand-back

→ **database-admin (Batch A, Phase 4)** — owner of both files.

1. `scripts/test-rls.sql:6764` — delete `and withdrawn_at is null` from §41(c)'s fixture pick. Proven: 532 → **550, exit 0**. Safe because all four (c) arms are identity-class and refuse before any state check.
2. `src/lib/db/domain/publication.test.ts:201-224` — stop consuming the seeded row in `withdrawalFixture()`; mint a fresh publication inside the test's own rollback via `presby_publish_sasr_snapshot()`, the way §41(d)/(e) already does. Verified reachable from the owner connection these tests use.
3. Then re-run on a **fresh** database (the branch DB is unrecoverable — `neon branch reset`, or a scratch DB, or a new pipeline branch): `scripts/test-rls.sql` → 550/exit 0, and `npm run test:db` → 4214/0.
4. Add the coverage the gap names: something that fails if a committed withdrawal in the fixture database makes either suite unrunnable. Without it this recurs the next time a pipeline ships a destructive act against a single-use fixture.

Non-blocking notes for whoever picks it up: `withdraw-dialog.tsx:33`'s duplicated `MINUTE_REFERENCE_MAX` can drift from `src/lib/filings.ts`'s unobserved; and at 360px the only row's Withdraw action sits inside the table's inner scroller, off-screen until swiped (shipped convention, Phase 6's call).

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — product code verified correct against the live catalog, behavioural probes as `presby_app`, a from-empty rehearsal (550 assertions, exit 0) and a real 360px browser walk of both flows; typecheck/lint/all five tripwires/schema-parity/build green; feature-gate and schema/RLS audits pass; no auth-touching file in the diff, so the MFA e2e gate does not apply; shared-file discipline clean. **Two required checks red on the delivered branch** (`npm run test:db` 9 failed/4205 passed; `scripts/test-rls.sql` exit 3 at 532/550) from an order-dependent single-use test fixture the feature itself consumes irreversibly — `scripts/test-rls.sql:6764` and `src/lib/db/domain/publication.test.ts:209`. One remedy proven (532→550). No product-code change required. | **FAIL** | 2026-09-26 |

## Handoff

→ **database-admin (Phase 4, Batch A)**, with the two `file:line` citations and the proven remedy above. Not to tech-lead: the design is sound and no ruling needs revisiting — this is a test-fixture defect, not a design flaw. When it is fixed and both suites are green on a fresh database, this returns to **qa** for a re-run of the two red checks only; everything else in this report stands and need not be repeated.



### Orchestrator note (2026-09-26)

FAIL loops back to the database-admin (Phase 4) for the two test-fixture fixes; no product-code or design change, so Phase 3 is not reopened. The pipeline branch database is unrecoverable for the two suites (the seeded publication is irreversibly withdrawn); the loop-back verifies on a fresh scratch database inside the same branch, and QA re-runs the two red checks there. The remedy for item 4 of the hand-back is the fixes themselves: once neither suite depends on the seeded row being un-withdrawn, a committed withdrawal cannot make them unrunnable.

---

# Phase 5 — Verification (qa) — second pass (re-verification after the Phase 4 loop-back)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Scope:** the two red checks and the loop-back's edits only. Everything else in the first-pass Phase 5 section (feature-gate audit, schema/RLS audit, browser walk, coverage, auth gate, shared-file discipline) stands unchanged and is not repeated.
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-withdraw`, branch `pipeline/withdraw`. Neon branch confirmed from the live catalog — `pg_settings.neon.branch_id = br-snowy-recipe-axcqdbx4`, project `polished-snow-90038485`. `env | grep DATABASE_URL` empty at session start; connection strings sourced from `.env.local` into the shell only. No `ALTER ROLE`, no `db:push`, no `db:generate`. Two scratch databases created inside the branch (`qa2_pristine`, `qa2_reorder`) and both dropped — `pg_database` is back to `neondb, postgres, template0, template1`. No repo file was written by me (`git status --short` unchanged; `scripts/test-rls.sql` still 17:54:15, `publication.test.ts` still 17:41:48, `drizzle/0052` still 15:28:02, `.env.local` still 14:41:33).

## 1. Diff scope — the loop-back touched only the two test files

`git diff 82d6b54 --stat`: 13 tracked files, 1594 insertions / 122 deletions; untracked set unchanged (work-log, `drizzle/0052_presby_withdraw_publication.sql`, the two new route directories, `src/lib/filings.ts`, `src/lib/filings.test.ts`).

- `scripts/test-rls.sql` at `-U0` is still **exactly three hunks**: `@@ -4947,0 +4948,16 @@` (the F90 comment block), `@@ -4953 +4969 @@` (the one-line §35 assertion), `@@ -6589,0 +6606,503 @@` (the appended §41). Same anchors as the first pass; the third hunk grew from +464 to +503 lines (+39), which is the three documented §41 edits and nothing else structurally — no `and withdrawn_at is null` predicate survives anywhere in §41 (only the comment recording its removal, `scripts/test-rls.sql:6764`), and the one new variable is properly declared at `scripts/test-rls.sql:6853`.
- **Product files byte-identical to first-pass state**, by two independent handles. (a) Mtime: nothing under `src/`, `scripts/`, `drizzle/`, `e2e/` is newer than `2026-09-26 16:48:42` except `scripts/test-rls.sql` (17:54:15) and `src/lib/db/domain/publication.test.ts` (17:41:48); the whole Batch C UI set is 16:32–16:48, `drizzle/0052` is 15:28:02, `src/lib/filings.ts` 16:12:40, `presbytery.ts` 16:09:26, `tiles.ts` 16:15:42, `seed.ts` 16:18:22, `audit.ts` 16:10:21. (b) Content: every `file:line` citation the first pass made against product code still resolves to the same text — `src/lib/filings.ts:181` and `:271` (both `hasPermission(… STATISTICS_PUBLISH)`), `actions.ts:134-140` (the five-argument `withdrawFiling` call binding `identity.userId`), `actions.ts:167` (`recordAudit`), `presbytery.ts:549` (`isNull(congregationStatistics.withdrawnAt)`), `withdraw-dialog.tsx:33`. Diffstat magnitudes match the first pass exactly (`tiles.ts` 22, `seed.ts` 16, `audit.ts` 16).

**Result: conforms.** No product code moved in the loop-back.

## 2. The two previously-red checks, on the pipeline branch DB as-is

Run against the branch database still carrying Batch C's committed, irreversible withdrawal (`publications`: 1 row, 1 withdrawn, minute reference `Session minutes, 2026-09-26, item 4 (rehearsal)`) — repaired in no way.

| Check | Result |
|---|---|
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` as `presby_app` (`rolbypassrls = f`) | **exit 0, 551 assertions, 0 FAIL** (was exit 3 at 532/550) |
| `vitest run --no-file-parallelism src/lib/db/domain/publication.test.ts` | **45 passed (45), 0 skipped** (was 9 failed / 36 passed) |

Both suites left the branch unchanged: still one publication, still withdrawn, same minute reference.

## 3. Pristine scratch DB, then a withdrawal I committed myself

`create database qa2_pristine` → `drizzle-kit migrate` (**51 rows** in `drizzle.__drizzle_migrations`; this branch's journal ends at idx 50, so 0052 is still unregistered and owed at integration) → `psql -f drizzle/0052_presby_withdraw_publication.sql` → `scripts/seed.ts` → `scripts/seed-dev.sql` → `scripts/install-test-helpers.sql`. Fixture state: 1 publication, 0 withdrawn.

| State | `test-rls.sql` | `publication.test.ts` |
|---|---|---|
| pristine | exit 0, **551** | **45/45** |
| after I committed a withdrawal | exit 0, **551** | **45/45** |

The withdrawal was performed the product way, not by hand: as `presby_app`, `set_config('app.current_org_id', <Alder Creek>, true)`, `presby_withdraw_publication('a9000000-…-0001', 'e0000000-…-00f3', 'Session minutes, 2026-09-26, item 4 (qa second pass)')`, then `commit`. Verified afterwards: the publication triple written and `congregation_statistics.withdrawn_at` set on the paired projection row.

**Fixture independence is proven three ways** — on the branch DB someone else destroyed, on a pristine DB, and on a DB I destroyed myself with the shipped writer. The first pass's FAIL is fully cleared.

## 4. Failing-first for the new §41 assertion, reproduced by me

Target: `scripts/test-rls.sql:6966-6985` ("identity is checked before state, on a row that is already withdrawn").

Method: the mechanism, not the assertion. On a second pristine scratch DB (`qa2_reorder`, built by the same recipe), `presby_withdraw_publication()` was re-created from `drizzle/0052`'s own text with the Step 4 state block moved **above** the Step 3 membership block — token-for-token identical otherwise (verified programmatically: `sorted(tokens)` equal, executable order inverted).

| Function | `test-rls.sql` |
|---|---|
| as shipped (baseline) | exit 0, **551** |
| state check hoisted above membership check | **exit 3, 541 of 551**, abort at `scripts/test-rls.sql:6986` — `ERROR: FAIL — an already-withdrawn row answered a NON-MEMBER with its state ("publications: this filing was already withdrawn at 2026-09-26 22:18:39…"), which tells a stranger the row exists and what has happened to it` |
| restored by re-applying `drizzle/0052` | exit 0, **551** |

Watched red, watched green, mechanism-disabled rather than assertion-edited. The loop-back's claim is confirmed exactly (541/551, abort at `:6986`).

**§41(f) fix (`scripts/test-rls.sql:7000-7011`) — the pick resolves a row, not `id = null`.** Run as `presby_app` in Alder Creek's context, new pick vs old pick side by side:

| Fixture | new (state-agnostic) pick | old (`and withdrawn_at is null`) pick |
|---|---|---|
| pristine (`qa2_reorder`) | `a9000000-…-0001` | `a9000000-…-0001` |
| withdrawn (`qa2_pristine`) | `a9000000-…-0001` | **NULL** |
| branch DB (withdrawn) | `994f9867-b097-4268-a260-af29c7063ed3` | — |

The old predicate is exactly the silent `where id = null` the loop-back names; the new one resolves on every fixture state, and the null guard at `:7008` never fires. The latent defect is real and is closed.

## 5. Ruling on the `publication.test.ts:594` deviation

**Acceptable residual, not a coverage gap.** Reasoning, from reading all three sites:

- The **discriminator is ground truth, not the code under test.** The `if` at `publication.test.ts:659` branches on `seeded.withdrawn_at`, read directly from `congregation_statistics` on the platform connection (`:630-642`) — not on anything `getCongregationStatisticsRollup()` returns. So neither branch can self-agree: on a live fixture the test still fails if the reader reports `hasData: false`, and on a withdrawn one it still fails if the reader surfaces the withdrawn row as current. This is the opposite of a self-agreeing mock.
- **The unconditional half is net-new, stronger coverage.** F39 itself — projection `published_at`/`minute_reference` non-null *and equal to the publication's* (`:644-647`) — is now asserted directly against the committed chain. The pre-loop-back test only asserted the two were truthy, and only via the rollup.
- **Both conditional branches are proven unconditionally elsewhere**, on self-provisioned fixtures that never touch the seed: `src/lib/presbytery.test.ts:952` (withdrawn row excluded from the coalesce, rollup falls through to `presbytery_entered`, years 2061) and `:1010` (withdrawn row with nothing else on file → `hasData: false`, `provenance: null`, year 2062). Both mint their own publication + projection via `armedPublicationWrite`/`makePublication` and withdraw it in-test. Nothing that was proven before this loop-back is unproven now.
- The structural constraint is genuine and correctly diagnosed: `getCongregationStatisticsRollup()` opens its own transaction through `withOrgContext()`, so it can only see committed rows; the file writes nothing durable by design; a published row cannot be deleted on either connection; and `scripts/test-rls.sql:4070/4073` pin the Alder Creek publication and return counts at exactly one. There is no fixture this test could mint for itself.

Named residual (for the record, not a gate): on any one database only one of the two rollup branches executes *in this file*. The loss is redundancy against the seeded chain specifically, and it is covered unconditionally two tests over. Recorded as an accepted residual, exactly as the loop-back proposed.

## 6. Full-suite and static checks

| Check | Result |
|---|---|
| `vitest run --no-file-parallelism` (= `npm run test:db`) on the scratch DB **after** I committed the withdrawal | **291 files passed, 4214 passed, 0 failed, 0 skipped**, 427.96s — matches the claimed 4214/0, and on the harder fixture |
| `npm run typecheck` | **PASS** (exit 0) |
| `npm run lint` | **PASS** (exit 0, `--max-warnings=0`) |
| `npm run check` (five tripwires) | **PASS** — audit, sql-date, deps-drift, brand-scope, secrets all green |

No skipped specs anywhere: `publication.test.ts` 45/45, full DB suite 4214/4214.

## End-to-End Tests

Not run, not required — unchanged from the first pass. No spec under `e2e/` references `/admin/filings`, `/admin/reports/[aboutOrgId]` or any withdrawal copy. The first pass's 360px browser walk of both flows stands; nothing in the loop-back touches a rendered surface.

## Regression Tests Added

None by me — QA authors no tests. Verified as present, exercised and **failing-first confirmed by me** in this pass:

- `scripts/test-rls.sql:6966-6985` — "on an already-withdrawn publication a non-member still gets the uniform identity literal". Guards F40's non-oracle property *and* the soundness of §41(c)'s state-agnostic pick. Proven failing (541/551, abort at `:6986`) with the check order inverted, passing (551) restored. This is the one assertion the loop-back added, and it is the right one: it pins the exact invariant the two fixture fixes lean on.
- `scripts/test-rls.sql:6759-6778` (§41(c)) and `:7000-7011` (§41(f)) — state-agnostic fixture picks. Proven necessary: the old predicate returns NULL on a withdrawn fixture (abort for (c), silent zero-row UPDATE for (f)).
- `src/lib/db/domain/publication.test.ts:226-280` (`withdrawalFixture()`) and `:203-224` (`withdrawerUserId()`) — mint a fresh chain at `FIXTURE_YEAR = 2087` inside the caller's own rolled-back transaction. Proven by the pristine→withdrawn→still-45/45 sequence in check 3.

**The first pass's named coverage gap is now closed in the only form it can be:** the suites no longer read the seeded publication's withdrawal state at all, and I verified that behaviourally on a database I withdrew against myself, rather than accepting it as an argument.

## Feature-Gate Audit

No change — the loop-back touched no route, no `"use server"` action and no `src/lib/` product module (check 1). The first pass's table stands verbatim, and its three citations were re-resolved above to confirm the files did not move: `filings/page.tsx`, `filings/actions.ts` → `withdrawFilingAction`, `reports/[aboutOrgId]/page.tsx`, all gated (`org_portal.filings` / `org_portal.reports` flag + org-type + `statistics.publish` / `statistics.manage` inside the lib function). No `src/app/api/**/route.ts` in this feature.

## Schema/RLS Audit

No change — `drizzle/0052_presby_withdraw_publication.sql` is byte-identical (mtime 15:28:02, untouched since Batch A) and was re-applied whole to both scratch databases in this pass with no row-count change. The first pass's live-catalog verification stands. One incremental live-catalog fact added here: with the state check hoisted above the membership check the isolation suite refuses the build outright, so §41 now *pins* the DECISION-152 check ordering rather than merely describing it.

## Auth Gate

Unchanged: no `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/` file in the diff. The stricter MFA-enrolled e2e gate does not apply.

## Verdict

**PASS**

Both previously-red checks are green, and green for the right reason rather than on a friendlier database. `scripts/test-rls.sql` returns 551 at exit 0 and `publication.test.ts` returns 45/45 on the pipeline branch DB *as handed back, still carrying the irreversible withdrawal that made the first pass fail* — which is the fixture-independence proof, not a re-run on clean ground. I then reproduced it forward: pristine scratch DB green, and still green after I committed a withdrawal through `presby_withdraw_publication()` as `presby_app` myself. The full DB-backed suite is 4214/0/0-skipped on that same withdrawn scratch DB. The new §41 assertion is failing-first-proven by me, by disabling its mechanism (551 → 541, abort at `scripts/test-rls.sql:6986`) and restoring it (→ 551), not by trusting the report. The §41(f) latent defect is closed and I demonstrated the old pick returning NULL where the new one resolves. Typecheck, lint and all five tripwires pass. No product file moved — verified by mtime and by re-resolving every first-pass product-code citation.

The `publication.test.ts:594` split is an **accepted residual**: its branch discriminator is read from the raw column rather than from the reader under test, the F39 half is now asserted unconditionally and is stronger than what it replaced, and both conditional branches are proven unconditionally on self-provisioned fixtures at `src/lib/presbytery.test.ts:952` and `:1010`.

Still open, unchanged and non-blocking (Phase 6 / integration, not gates): `drizzle/meta/_journal.json` idx 52 and the `docs/` lines owed at integration; `withdraw-dialog.tsx:33`'s duplicated `MINUTE_REFERENCE_MAX = 500`, which can drift from `src/lib/filings.ts`'s exported constant unobserved; and the 360px inner-scroller placement of the Withdraw action.

## Per-Phase Status (row to record)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (second pass, after Phase 4 loop-back) | qa | Complete — both red checks cleared on the branch DB **as-is**, still carrying the committed withdrawal (`test-rls.sql` exit 0 / **551**; `publication.test.ts` **45/45**), and reproduced on a pristine scratch DB before and after a withdrawal I committed myself through `presby_withdraw_publication()` as `presby_app`. Full DB suite **291 files / 4214 passed / 0 failed / 0 skipped** on the withdrawn scratch DB; typecheck, lint and all five tripwires green. New §41 assertion (`scripts/test-rls.sql:6966-6985`) failing-first reproduced independently by hoisting the state check above the membership check (**exit 3, 541/551**, abort at `scripts/test-rls.sql:6986`) and restored from `drizzle/0052` (**551**); §41(f)'s pick (`:7000-7011`) shown to resolve on both fixtures where the old predicate returned NULL. Loop-back scope confirmed: only `scripts/test-rls.sql` (still exactly three hunks) and `src/lib/db/domain/publication.test.ts` changed — every product file byte-identical by mtime and by re-resolved `file:line` citations. `publication.test.ts:594` split ruled an **acceptable residual** (ground-truth discriminator; both branches proven unconditionally at `src/lib/presbytery.test.ts:952`/`:1010`). Both scratch DBs dropped; branch DB and repo unmodified. First pass's feature-gate audit, schema/RLS audit, browser walk, coverage and auth-gate findings stand. | **PASS** | 2026-09-26 |

## Handoff

→ **analyst (Phase 6 — Shipped vs Intent)**. Nothing is outstanding for an implementer. Carry into Phase 6: the three non-blocking notes above (journal idx 52 + `docs/` lines at integration; `withdraw-dialog.tsx:33`'s duplicated constant; the 360px inner-scroller placement of the Withdraw action), and the accepted residual at `src/lib/db/domain/publication.test.ts:594`. Workflow Rule 16's post-merge `scripts/test-rls.sql` re-run against `development` is now safe to perform even after someone exercises the feature — that is the property this loop-back bought, and it is verified, not asserted."}],"container":null,"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":804,"cache_read_input_tokens":106762,"output_tokens":6792,"output_tokens_details":{"thinking_tokens":0},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":804},"inference_geo":"not_available","iterations":[{"input_tokens":2,"output_tokens":6792,"cache_read_input_tokens":106762,"cache_creation_input_tokens":804,"cache_creation":{"ephemeral_5m_input_tokens":804,"ephemeral_1h_input_tokens":0},"type":"message"}],"speed":"standard"},"diagnostics":null,"context_management":null},"apiBlockIndex":0,"requestId":"req_011CfSqjDCSmKqdMpVkxNGug","attributionAgent":"qa","type":"assistant","uuid":"fa2ecd7d-b596-48a4-8de7-e3a5e960f4dd","timestamp":"2026-09-26T22:30:40.243Z","effort":"high","perTurnEffort":null,"userType":"external","entrypoint":"cli","cwd":"/Users/cshenso/git/presby-platform/presby","sessionId":"b08e6db7-b5b1-4a1b-b94f-75e0928bed80","version":"2.1.273","gitBranch":"main","slug":"warm-honking-hartmanis"}

---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Scope of this review:** worktree `/Users/cshenso/git/presby-platform/presby-wt-withdraw`, branch `pipeline/withdraw`, Neon branch `pipeline-withdraw` (`br-snowy-recipe-axcqdbx4`, confirmed live via `current_setting('neon.branch_id')`). Read-only throughout; no file written, no `ALTER ROLE`, no `db:push`/`db:generate`. Dev server started on port 3600 for a spot render, stopped by PID (9163) afterward — no lingering process.

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A congregation's stated clerk can now see its own filing history and permanently withdraw a published statistical return with a minute reference — the row survives as history, the presbytery's current-year totals correctly stop counting it and fall back to any live entered/imported row, and the presbytery can read the full withdrawn history per congregation — all exactly as Phase 1 asked, verified independently on the live catalog and in a real 360px browser twice; what ships alongside it is a short list of already-named, low-severity residuals (two cosmetic UI notes, one pre-existing bootstrap gap, one pre-existing billing gap, and one stale doc comment I found in this pass) that belong in `docs/TODO.md`, not in a loop-back.

## What's Working

- **Flow 1 (congregation withdraws its own return) is correct end to end.** `q1-filings-list.png`/`q2`/`q3` (QA's own screenshots, still on disk) show the `AlertDialog` (no native `confirm()`), the permanence copy verbatim, and the confirm button correctly disabled on an empty or whitespace-only minute reference. Verified at the database (both the branch DB and my own catalog read): `withdrawn_at`/`withdrawn_by`/`withdrawn_minute_reference` written on `publications`, `congregation_statistics.withdrawn_at` set on the same instant, `withdrawn_by = e0000000-…-00f3` — the **session** user, never a form field.
- **Flow 2 (presbytery sees the withdrawal) is correct end to end.** `q6-subview.png` shows the nested `/admin/reports/[aboutOrgId]` page rendering the 2025 filing "Withdrawn" with date and minute reference (Option A — included, marked, never filtered), and the rollup page independently confirmed to read "No data on file" for the same congregation/year once the return is withdrawn.
- **The database design is exactly what DECISION-152 describes, verified against the live catalog by me, not inferred from the work-log:**
  - `presby_withdraw_publication`: `prosecdef = t`, `proconfig = {"search_path=public, pg_temp"}`, `proacl = {neondb_owner=X/…, presby_app=X/…}` — no `presby_platform`, no `PUBLIC`.
  - `pg_attribute.attacl` is **NULL** on all five withdrawal-adjacent columns on both tables; `has_column_privilege('presby_app', …, 'UPDATE')` is **false** on both. `presby_app` has no privilege path to the pair outside the DEFINER function — DECISION-141 holds.
  - Template role `00000000-…-0004` exists, `organization_type_scope = congregation`, `role_kind = constitutional`, `is_protected = t`, bound to exactly `statistics.publish` — no other row touched, confirming "no backfill."
- **The uniform-literal / honest-state split holds up as a security property, not just a passing test.** QA's own probe (reproduced structurally by me reading the DDL and test-rls §41(c)/(e)) shows a non-member `p_withdrawn_by` gets the identity literal even against an *already-withdrawn* row — the membership check runs strictly before the state checks, which is the actual invariant DECISION-152 exists to name.
- **Fixture independence, the thing the Phase 4 loop-back was about, is real.** I did not need to re-litigate it: QA's second pass proved it three ways (branch DB as-withdrawn, a pristine scratch DB, and a scratch DB QA withdrew itself through the real function), and the mechanism (§41(c)/(f) state-agnostic picks, `withdrawalFixture()` minting its own chain) is sound on inspection.
- **The empty state matches Phase 1's required copy exactly**, not paraphrased: `page.tsx`'s `FilingsTable()` renders *"Filing a new statistical return isn't built on this page yet — this page shows the history of returns your presbytery has already received and lets you withdraw one if it was filed in error."* — this was Phase 1's Gap 1 / Out-of-Scope requirement, and it shipped verbatim rather than as a bare "no data" placeholder.

## Intent-vs-Shipped Diff

| Phase 1 / orchestrator ruling | Shipped | Verdict |
|---|---|---|
| A congregation stated clerk sees filing history and withdraws with a minute reference | `/o/<slug>/admin/filings`, `statistics.publish` gated, minute reference required/trimmed/max 500 | matches |
| The row stays as history, never deleted | `publications`/`congregation_statistics` retain the row; `publications_freeze`/`congregation_statistics_freeze` refuse any other mutation on every connection, verified live | matches |
| Presbytery's rollup treats the withdrawn return as absent and falls back | `fetchStatisticsForYear()` gained `isNull(congregationStatistics.withdrawnAt)` in its WHERE; `getCongregationStatisticsRollup()` and `generatePerCapitaRecords()` both consume it (confirmed by reading call sites, not assumed) | matches |
| Presbytery sees withdrawn history per congregation | `/o/<slug>/admin/reports/[aboutOrgId]`, Option A, rows never filtered | matches |
| A presbytery cannot withdraw a return addressed to it (uniform literal) | `presby_current_org() <> organization_id` folds into the same `42501` literal as not-found/wrong-record-class/non-member-withdrawer; test-rls §41(c) proves byte-identity across all four | matches |
| `withdrawnBy` is the session user | bound server-side in `actions.ts` from `identity.userId`, never a client field; DB-bounded to an active member of the acting org | matches |
| Audit event carries both org ids | `STATISTICS_RETURN_WITHDRAWN`, metadata `{organizationId, recipientOrgId, aboutOrgId, reportYear, publicationId}` — confirmed in QA's browser walk, row observed live | matches |
| Flag seeded off | `scripts/seed.ts` seeds `org_portal.filings = false`; branch DB currently reads `true` only because it was deliberately left on for QA/rehearsal use, and a fresh `db:seed` resets it | matches (verified: `select key, enabled … → org_portal.filings | t` on this branch, explained and expected) |
| Superseded publications cannot be withdrawn | distinct `check_violation` refusal, tested at both the DB and library layer | matches |
| An `unmanaged`/`invited` congregation's return cannot be withdrawn by anyone (Flow 3) | closed by construction — `presby_current_org()` never resolves to a session-less org — no code path exists to test, correctly | matches |

No regression and no acceptable-drift item rises to the level of a red flag. The one item worth naming as **acceptable drift, not matching verbatim**: Phase 3's Component Plan proposed a fifth file (`filings-table.tsx`); the orchestrator's own Batch C directive narrowed the file set and the table ships as an inline helper instead. This was disclosed as a deviation in the work-log, matches an existing precedent (`admin/reports/page.tsx`'s `renderStatisticsSection()`), and changes no user-visible behavior — acceptable.

## Edge Cases

- **Empty state:** pass — plain, honest copy naming the missing publish form (matches Phase 1's required copy verbatim, confirmed by reading `page.tsx`).
- **Failure microcopy:** pass — the five-arm `ActionResult` copy table is human language ("This filing has already been withdrawn," "A newer filing supersedes this one — only the current filing can be withdrawn"), no raw Postgres text reaches the client; confirmed by reading `actions.ts`'s copy mapping and QA's feature-gate read.
- **Permission gate:** pass — `statistics.publish` enforced inside `withdrawFiling()`/`listOwnFilings()`, `statistics.manage` inside `getCongregationFilingHistory()`, both confirmed live and by direct code read, not inferred from a green test. The standing residual (permission is app-layer, not DB-layer) is the same shape every one of the 17 other tenant-mutation modules carries — named, not novel to this feature.
- **Audit event:** pass — fires only on `ok`, carries both org ids, confirmed written live during the browser walk (not merely asserted by a mock).
- **Mobile (360px):** pass, with a note. The page itself does not scroll sideways at 360px (confirmed: `scrollWidth == innerWidth` per QA, and visually in `q1-filings-list.png`). But that same screenshot shows the **only action on the page** — the Withdraw button — cut off at the right edge, requiring a swipe inside the table's inner scroll container to discover. This is a shipped convention elsewhere (`GrantsTable`/`StatisticsTable`), so it is not a regression this feature introduced, but on *this specific page* the withdraw action is the page's entire reason for existing, which makes the friction more consequential here than on a page where the hidden column is supplementary. I'm siding with the user on this one: it's real friction, not a gate failure — see Follow-Ups.

## Rulings on carried notes

1. **`withdraw-dialog.tsx:33`'s duplicated `MINUTE_REFERENCE_MAX`.** Confirmed real and correctly reasoned (`filings.ts` is `server-only`-marked; any import poisons the client bundle — the Batch C bug that broke `/signin` proves this isn't theoretical). The duplication is a value, not a security boundary — the server's zod check is authoritative regardless of client drift. **TODO-worthy, not a blocker.**
2. **360px inner-scroller placement of Withdraw.** Real, as above. Same shipped pattern elsewhere, so this is a systemic small-viewport table-affordance question, not unique to this feature — I'd scope the follow-up to *all* three tables (`GrantsTable`, `StatisticsTable`, this one) rather than a one-off fix here, since fixing only this page while leaving the pattern elsewhere would just relocate the inconsistency Phase 2/3 already accepted.
3. **`publication.test.ts:594` accepted residual.** I concur with QA's ruling. The branch discriminator reads ground truth (`congregation_statistics.withdrawn_at` on the platform connection), not the reader under test, so neither branch can self-agree; the state-independent half (F39 exactness) is now asserted unconditionally and is *stronger* than what it replaced; and both conditional branches are proven unconditionally elsewhere (`presbytery.test.ts:952`/`:1010`). This is a genuine structural constraint (the rollup only sees committed rows; the seed fixture is un-replenishable by design), not a shortcut. **Accept as recorded, no further action.**
4. **Per-capita stale bill (Phase 1 Gap 5).** Correctly named, correctly not solved here — a bill is a financial artifact and `generatePerCapitaRecords()`'s own contract is to never retroactively move an issued bill. Confirmed by reading the call chain: `fetchStatisticsForYear()`'s withdrawal filter reaches `generatePerCapitaRecords()` at `presbytery.ts:1077`, so *new* generation correctly excludes a withdrawn basis year while an already-issued bill is untouched. **TODO-worthy, correctly deferred.**
5. **Template-adoption bootstrap (Phase 3 (a)).** Same standing DECISION-100/101/106 gap, not created by this pipeline, correctly bought time by shipping `org_portal.filings` off. **TODO-worthy, correctly deferred to the P2 backbone/onboarding pipeline per `docs/STATE.md`.**

**On the orchestrator's drafted TODO lines:** I was not able to locate a draft for these four items anywhere in this worktree (`docs/TODO.md` is on the do-not-edit list for this branch, and no draft appears in the work-log), so I can't confirm coverage directly — I'm providing ready-to-paste text instead so nothing is lost at integration:

- **Close** `docs/TODO.md:114` item (3) — `presby_withdraw_publication()` UI is no longer a follow-up, it shipped. Move to Done: *"presby_withdraw_publication() UI shipped (v0.28.0, `docs/work-log/2026-09-26-withdraw-publication.md`) — congregation filing history + withdraw at `/o/<slug>/admin/filings` (flag `org_portal.filings`, seeded off), presbytery per-congregation history at `/o/<slug>/admin/reports/[aboutOrgId]`, `fetchStatisticsForYear()` now filters `withdrawn_at is null`."*
- **Close** `docs/TODO.md:127` — the `getCongregationStatisticsRollup()` filter obligation is fulfilled (confirmed: it calls `fetchStatisticsForYear()` directly at `presbytery.ts:631`).
- **New line — per-capita stale bill:** *"`generatePerCapitaRecords()` never retracts an already-issued bill when its basis-year return is later withdrawn — a stale bill can survive a withdrawal untouched. Named at Phase 1 Gap 5 and Phase 3 of the withdraw-publication pipeline, not solved there; needs its own Phase 1 if a presbytery actually hits it. — `docs/work-log/2026-09-26-withdraw-publication.md` Phase 6."*
- **New line — template-adoption bootstrap:** *"Congregation `stated_clerk` template (`congregation_stated_clerk`, `00000000-…-0004`, carrying `statistics.publish`) has no founding-administrator bootstrap — same standing gap as `stated_clerk`/`brand_admin`/`role_admin` (DECISION-100/101/106); no real congregation can adopt it until someone there already holds the permission. `org_portal.filings` shipping off buys the same time it always has. Belongs to the queued P2 backbone/onboarding pipeline. — `docs/work-log/2026-09-26-withdraw-publication.md` Phase 3(a)/Phase 6."*
- **New line — two small UI residuals:** *"`withdraw-dialog.tsx:33` duplicates `MINUTE_REFERENCE_MAX` by value (the constant's source, `src/lib/filings.ts`, is `server-only` and can't be imported into a client component) — can silently drift from the exported 500 with nothing catching it. Separately, at 360px the sole row action on `/admin/filings` (and the equivalent columns on `GrantsTable`/`StatisticsTable`) sits inside the table's own scroll-cued container, off-screen until a horizontal swipe — worth a small mobile-affordance pass across all three tables together, not a one-off fix. — `docs/work-log/2026-09-26-withdraw-publication.md` Phase 5/6."*
- **New line — my own finding, `src/lib/dev-docs.ts:155`:** the `BESPOKE_POLICIES["publications"]` comment shown on `/admin/developer` still reads *"presby_app has no UPDATE grant, so there is no tenant-side withdrawal path yet"* — the grant claim is still true, but the conclusion is now false: `presby_withdraw_publication()` is exactly a tenant-side withdrawal path (a SECURITY DEFINER function granted to `presby_app`), the DECISION-141 marker-vs-privilege pattern this same file documents elsewhere. Phase 3 explicitly flagged this file as a candidate for an entry ("if the withdrawal mechanism warrants one") and it was missed. This is a one-sentence, doc-only, Trivial-class correction — recommend fixing it directly rather than carrying it as a TODO line, since it's user-facing (to any engineer reading `/developer`) and misleading in its current form.

## DECISION-152 check

Confirmed still describes what shipped. Batch A's Deviation 1 (F91) removed a non-existent `pe.organization_id = v_actor` predicate from the membership check because `people` has no such column — the semantics are unchanged (`presby_membership_is_active(person, org)` already carries the org-scoping), and I verified this live: the shipped function's membership check is exactly `presby_membership_is_active(pe.id, v_actor)` with no `organization_id` reference, and it still refuses a non-member with the uniform literal (verified: `has_column_privilege` probes and the byte-identical §41(c) literals). This is a corrected column reference, not a changed decision — DECISION-152's text needs no amendment.

## Rule 13 — what's-new advisory

The flag ships off (`org_portal.filings = false` in `scripts/seed.ts`), so no member sees this feature at merge time. Per Rule 13, no `whats_new_entries` row is owed **now** — advise: **owed at first enablement**, i.e. whichever future work turns `org_portal.filings` on for a real congregation/presbytery pair should be the one to publish the entry, not this ship.

## Rule 14 — functionality map

I could not find the orchestrator's draft sentence anywhere in this worktree (`docs/product/functionality-map.md` is presumably edited at integration only). Proposed addition to the existing **"presby: presbytery oversight & statistics"** bullet (`docs/product/functionality-map.md:25`), appended after the "Submission grants" sentence:

> **Withdraw a filing (0.28.0, DECISION-152):** a congregation's stated clerk (`statistics.publish`) views its own filing history and withdraws a published return with a minute reference at `/o/<slug>/admin/filings` (flag `org_portal.filings`, seeded off) — the row is retained, marked, never deleted, via the sanctioned `presby_withdraw_publication()` writer; a withdrawn return drops out of the presbytery's "current" rollup and new per-capita generation, falling back to any live `presbytery_entered`/`imported` row; the presbytery reads the full history, withdrawals included, at the nested `/o/<slug>/admin/reports/[aboutOrgId]`.

I'd confirm this against whatever the orchestrator drafted rather than paste both — happy to defer to theirs if materially similar.

## Rule 15 — architecture.md

Confirmed: **no change**. This is feature work on the existing statistics/publications subsystem (no new subsystem, no changed data flow shape, no changed deployment/runtime shape, no reversal of a settled architecture statement) — agrees with the orchestrator's "no" and with Phase 3 Note 4's own statement.

## Draft release note (v0.28.0, non-engineer audience)

> **Withdraw a filed statistical return.** A congregation's stated clerk can now see the history of the annual statistical reports it has filed with its presbytery, and — if a report was submitted before the session finished reviewing it, or contains an error the session has since caught — withdraw it, citing the session minute that authorized the withdrawal. The original filing is never deleted; it stays on record, clearly marked as withdrawn along with the date and the minute reference. Presbyteries will see a withdrawn report excluded from that congregation's current-year totals, and can review the complete filing history — including any withdrawals — for every member congregation. This feature is rolling out gradually and is not yet turned on for most congregations.

## Follow-Ups (SHIP WITH NOTES)

- Correct the stale `/admin/developer` comment at `src/lib/dev-docs.ts:155` ("no tenant-side withdrawal path yet") — Trivial-class, one sentence, recommend fixing directly rather than deferring.
- Reconcile `docs/TODO.md:114` item (3) and `docs/TODO.md:127` to Done, per the exact lines drafted above.
- Add the three new TODO lines drafted above (per-capita stale bill, template-adoption bootstrap, the two UI residuals).
- Publish a `whats_new_entries` row at first real enablement of `org_portal.filings`, not now.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — all Phase 1 verbs/flows confirmed shipped against the live catalog and two independent browser walks; DECISION-152 confirmed unchanged in substance (F91 was a column-reference fix only); one new finding (`src/lib/dev-docs.ts:155` stale doc comment) added to the note set; TODO-line text drafted for all five follow-ups since no visible draft existed in this worktree to bless | SHIP WITH NOTES | 2026-09-26 |

## Handoff

→ **Orchestrator**, to close the pipeline: apply the `docs/TODO.md` reconciliation (two closes, three new lines) and the functionality-map sentence at integration, per Workflow Rules 10/14; fix `src/lib/dev-docs.ts:155` as a Trivial doc correction (in this branch before merge, or as a same-day follow-up commit — either is fine, it's one sentence); no `whats_new_entries` row now (Rule 13 — owed at first enablement); `docs/architecture.md` unchanged (Rule 15). Nothing returns to an implementer — this closes the pipeline."}],"container":null,"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":2222,"cache_read_input_tokens":151095,"output_tokens":11503,"output_tokens_details":{"thinking_tokens":3941},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":2222},"inference_geo":"not_available","iterations":[{"input_tokens":2,"output_tokens":11503,"cache_read_input_tokens":151095,"cache_creation_input_tokens":2222,"cache_creation":{"ephemeral_5m_input_tokens":2222,"ephemeral_1h_input_tokens":0},"type":"message"}],"speed":"standard"},"diagnostics":null,"context_management":null},"apiBlockIndex":1,"requestId":"req_011CfSr7jBNB1qGgC5fJj1cq","attributionAgent":"analyst","type":"assistant","uuid":"43d8406f-ce8a-4c30-9ad0-b723e3198b7c","timestamp":"2026-09-26T22:36:29.196Z","effort":"high","perTurnEffort":null,"userType":"external","entrypoint":"cli","cwd":"/Users/cshenso/git/presby-platform/presby","sessionId":"b08e6db7-b5b1-4a1b-b94f-75e0928bed80","version":"2.1.273","gitBranch":"main","slug":"warm-honking-hartmanis"}

### Orchestrator closure (2026-09-26)

Shipped as v0.28.0 (`feat(statistics):` `drizzle/0052`). DECISION-152 recorded; F90–F91 folded into `docs/schema-design-2.md` §2k; `_journal.json` idx 52 appended; TODO reconciled (submission-grants follow-ups items 1 and 3 closed; per-capita stale bill and the template-adoption bootstrap tracked); functionality map updated; flag `org_portal.filings` seeded OFF — what's-new owed at first enablement (Rule 13); `development` migrated through 0052 and `test-rls.sql` re-run there. `test-rls.sql` section order in the file is now 43, 41 (appended blocks land in merge order; numbers are pre-assigned per Rule 16).
