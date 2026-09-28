# Playwright coverage of the presbytery portal flows — oversight, reports and per capita, credentials, filings and withdrawal, submission grants — Work Log

> **Slug:** `2026-09-28-presbytery-e2e`
> **Surface:** `e2e/` only (new specs + fixtures in `e2e/support/`), read-only against the app; may add seed fixtures as an appended block in `scripts/seed-dev.sql` if a flow has no loginable presbytery actor
> **Permission(s):** none new — the specs exercise existing gates (`statistics.manage`, `statistics.publish`, `credentials.manage`, `oversight.*`) and must assert the denied paths too
> **Flag(s):** none new — the specs turn the existing `org_portal.oversight` / `reports` / `credentials` / `filings` and `statistics.submission_grants` flags on for their own branch DB in `global-setup`, never by editing `scripts/seed.ts`
> **Estimated complexity:** medium
> **Pipeline mode:** Full (Phase 2 rules on `e2e/support/` structure and fixture strategy; Phase 3 designs the spec list)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-28, wave 5 — "finish the presbytery portal so PSV can be onboarded, tested and deployed"):** worktree `../presby-wt-e2e` on git branch `pipeline/presbytery-e2e`; Neon branch `pipeline-presbytery-e2e` (`br-red-moon-ax4gez04`, forked from `development` at the v0.28.0 state). **Pre-assigned numbers:** no migration; `DECISION-157` only if a decision results (e.g. a fixture/actor strategy for e2e); findings `F113` onward; `seed-dev.sql` additions appended only. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md`, `docs/product/functionality-map.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge; the pipeline's Neon branch is deleted at cleanup). `scripts/seed.ts`, `src/lib/org-portal/tiles.ts` and `src/lib/audit.ts` are high-collision: one clearly delimited addition each. **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148); every deny helper reachable from a tenant-path trigger grants EXECUTE to `presby_app, presby_platform` (0046 B-M1, re-learned as the increment-7 QA FAIL). Tests must mint their own fixture rows — a mandatory browser rehearsal on the pipeline branch consumes single-use seed rows (the withdraw pipeline's QA FAIL). Dev-server port `3600`; stop by PID; never `pkill -f`. `dotenv -e .env.local` does NOT override an already-exported `DATABASE_URL` — check `env | grep DATABASE_URL` first.
> **The gap (test-coverage review 2026-09-25 item 14; the 2026-09-27 presbytery-portal audit):** `e2e/` touches three `/o/` paths and zero church-domain surfaces; `statistics-submit.spec.ts` is the only presbytery-adjacent spec. Oversight, reports/per-capita, credentials, filings/withdraw and the submission-grant issue/revoke paths have no Playwright coverage, so the CI e2e job (once the operator adds the Neon secrets) would prove nothing about the portal PSV will use. Four existing specs are also rotten (`docs/TODO.md` "Four pre-existing e2e failures": two `post-login-routing` specs assert pre-`home_v2` copy; `header-controls.spec.ts:110` is flaky; `public-sites.spec.ts:334` should now pass on main) — fixing those is in scope.
> **User verbs (to refine):** as the seeded presbytery stated clerk (`presbytery.clerk.fixture@example.invalid` per `scripts/seed-dev.sql` — confirm it has a real password; if not, the seed block gains one), sign in with MFA if enrolled, open each presbytery tile, perform the one primary mutation each surface offers (record oversight data; enter statistics for a year and generate per capita; record a credential/appointment; issue and revoke a submission grant), and assert the audit row; as the seeded congregation clerk, publish and withdraw a return and see the presbytery side react; as a member without the permission, be refused on each surface with the ruled response.
> **Constraints:** each spec mints its own rows and cleans up, or runs against data it created — never consume a single-use seed row (the withdraw pipeline's QA FAIL); `reuseExistingServer: !CI` means the suite silently tests whatever holds :3000 — always run with `E2E_BASE_URL` on port 3600 and document it; `globalSetup` provisions fixture users — read `e2e/support/global-setup.ts` before adding actors; MFA-enrolled fixture per `SEED_MFA_ADMIN_*` if the flows need `/admin`. Real credentials sign-in, no session mocking. 360px viewport for at least one pass per surface.
> **Depends on:** nothing to start — but the founding-administrator pipeline (running in parallel) will add a loginable presbytery stated clerk fixture; if this pipeline needs one first, add it here as an appended seed block and the orchestrator reconciles the two at integration.
> **Out of scope:** unit/DB-backed vitest coverage (separate punch-list items); the committees stub; visual-regression snapshots.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — baseline 120/4/5 reproduced on port 3600; five surfaces mapped with their four negative states; nine gaps, six ruled by the orchestrator; `public-sites.spec.ts:334` is a real failure on main | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Complete — Playwright-owned fixtures only (DECISION-157); three `e2e/support/` modules; four spec files; F113 CI blocker, F114 spec rot, F115 unverified trigger re-enable | Approved with suggestions | 2026-09-28 |
| 3 — Technical design | tech-lead | Complete — three `e2e/support/` modules fully signed (`db.ts`, `flags.ts`, `sasr-fixture.ts`); four spec files' full case lists (oversight 6, credentials 7, reports 10, filings round trip 9); three new fixture actors specified against `users.ts`/`seed-orgs.ts`; F113/F114/F115 fixes designed; DECISION-157 adopted verbatim; withdraw refusal copy resolved from `filings.ts`/`actions.ts` directly | Design complete, implementer named | 2026-09-28 |
| 4 — Implementation | full-stack-developer | Complete (noting the loop-back) — original pass: 3 new `e2e/support/` modules, 4 new spec files (32 cases), F113/F114/F115 fixed, 2 rotten specs fixed, `flags.ts` extraction done, 161/0 full-suite run. Loop-back pass (closing QA's GAP-1): 3 new cases in `filings-round-trip.spec.ts` (flag-off/wrong-org-type/no-grant, failing-first proven via a real `role_grants` insert/delete), `presbytery-credentials.spec.ts` promoted to `describe.serial`, `sasr-fixture.ts`'s `pg_trigger` check constrained by table, F116's TODO line rewritten to state the product question. 164/0/0 full-suite run, DB left as found. | — | 2026-09-28 |
| 5 — Verification | qa | **Second pass: PASS** — GAP-1 closed and re-proven failing-first on both the grant and flag axes; 164/0/0 on fresh `.next` + cold `.auth`; DB byte-identical. First pass FAIL (161/0/0 twice, DB byte-identical, F113/F114 and permission failing-first reproduced; one coverage gap [filings' three denial states, a Phase 2 ruling dropped in Phase 3] and one product finding [F116, pre-hydration select revert, outside scope]). Looped back to Phase 4; GAP-1 now closed per the Phase 4 loop-back section above, awaiting QA re-verification. | PASS | 2026-09-28 |
| 6 — Shipped vs intent | analyst | In progress | — | 2026-09-28 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-28.*

Baseline run performed as instructed: `E2E_BASE_URL=http://localhost:3600 PORT=3600 npm run test:e2e -- --workers=1` against the `pipeline-presbytery-e2e` Neon branch (`env | grep DATABASE_URL` confirmed empty beforehand; dev server and Playwright workers stopped by PID afterward, port 3600 confirmed free). Result: **120 passed / 4 failed / 5 skipped (129 collected)** — see Gaps below for the exact four and one correction to `docs/TODO.md`'s claim about one of them.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The five presbytery-portal surfaces are real, flag-gated, permission-checked, and audited — but the actor roster this pipeline needs (a presbytery clerk with real login, a congregation clerk with real login, and a permission-less-but-related member at *each* org type) is only three-quarters seeded today, the "publish" leg of the round trip has no UI to click through at all, and the org whose historical data makes the round trip meaningful (Alder Creek) carries a single-use publication row that a prior pipeline has already destroyed once by exercising it in a browser — this pipeline must not repeat that.

## User Verbs

| Surface | Actor | Verb | Cadence |
|---------|-------|------|---------|
| `/o/<slug>/admin/oversight` | Presbytery clerk (`presbytery.clerk.fixture@example.invalid` / Idris Calloway, Northern Reach — holds `congregation_oversight.manage` via the adopted `presbytery_stated_clerk` role) | Opens the tile; records/edits a member congregation's viability score, buildings, insurance note (`/admin/oversight/[aboutOrgId]`) | Per reporting cycle |
| `/o/<slug>/admin/reports` — "Congregation Statistics" | Presbytery clerk (same actor, holds `statistics.manage`) | Enters a congregation's annual SASR aggregate for a year | Annual |
| `/o/<slug>/admin/reports` — "Per-Capita" | Presbytery clerk (holds `per_capita.manage`) | Sets a billing-year rate, generates per-capita records, records a payment | Annual + ongoing |
| `/o/<slug>/admin/reports` — "Submission grants" | Presbytery clerk (holds `statistics.manage`) | Issues a one-time emailed link to an `unmanaged`/`invited` congregation; revokes a live grant | Occasional |
| `/o/<slug>/admin/credentials` | Presbytery clerk (holds `credentials.manage`) | Records an ordination or ordination-status change; records or ends a pastoral appointment | Occasional |
| `/o/<slug>/admin/filings` | Congregation clerk (`clerk.fixture@example.invalid` / Tobias Renwick, Alder Creek — holds `statistics.publish`) | Views own filing history; withdraws the current published return, citing a minute reference | Rare |
| `/o/<slug>/admin/reports/[aboutOrgId]` | Presbytery clerk | Reads one congregation's full filing history, including withdrawn rows marked as such | Occasional (audit/dispute) |
| Any of the five | A member with an active relationship at the org but **no** matching grant | Is refused *in-page*, not bounced from the org | On demand |
| Any of the five, at the wrong org type (congregation hitting a presbytery-only page, or vice versa for filings) | Any related member | Sees a product-not-here message, never a permission-denial message | On demand |
| `/file-statistics?token=…` | Anonymous recipient of an issued grant | Already fully covered by `e2e/statistics-submit.spec.ts` — **out of scope to re-cover**, but the presbytery-side "Congregation reported" badge (case 4 of that spec) is the one place the reports page and the anonymous flow already touch |

The request as kicked off names "the user" for the presbytery surfaces without splitting "has the relationship" from "has the grant" from "is the right org type" — Pass 4/5 below make that split explicit because it's the exact place a spec can pass for the wrong reason.

## Flows

**Flow 1 — Oversight record:** `/o/<slug>/admin/oversight` (entry) → clerk clicks a congregation row → `/admin/oversight/[aboutOrgId]` edit form → submits viability/buildings/insurance → `CONGREGATION_OVERSIGHT_SET` audit row → back on the list, the row now shows the score instead of "Not yet assessed."
- Failure: wrong org type → `PlaceholderNotAvailable` (product-not-here copy, no permission language — the page's own header comment is explicit that "ask your administrator" would be *wrong* here since no congregation role can ever hold this permission). No grant → `OversightForbidden`. Flag off → `PlaceholderFlagOff`. Genuine DB error → `OversightLoadError` with a retry link.

**Flow 2 — Statistics + per-capita entry:** `/o/<slug>/admin/reports?year=YYYY` → clerk fills the statistics form for a congregation → `CONGREGATION_STATISTICS_ENTERED` audit → sets a per-capita rate (`PER_CAPITA_RATE_SET`) → generates records (`PER_CAPITA_RECORDS_GENERATED`) → records a payment (`PER_CAPITA_PAYMENT_RECORDED`).
- Failure: same three-state gate as Flow 1, but the page renders **two independently-gated sections** on one URL — a clerk who holds `statistics.manage` but not `per_capita.manage` sees one section render and the other show `ReportsSectionForbidden` on the same page load. No existing draft spec exercises this split-permission case; it's a real gap (Pass 4).

**Flow 3 — Submission grant issue/revoke:** `/o/<slug>/admin/reports` → "Submission grants" section (a third independent gate: `statistics.submission_grants` flag, alongside the page's own `org_portal.reports` flag and `statistics.manage`) → issue form → `STATISTICS_GRANT_ISSUED` → grant appears in `GrantsTable` → revoke → `STATISTICS_GRANT_REVOKED`. **Already fully covered end-to-end by `e2e/statistics-submit.spec.ts`** (issue, mobile+desktop token view, submit, presbytery-sees, five-way dead-token equality, replay refusal, no-org-leak/noindex) — this pipeline should not duplicate it, only reference it.

**Flow 4 — Credentials:** `/o/<slug>/admin/credentials` → record an ordination (`ORDINATION_RECORDED`) or change its status (`ORDINATION_STATUS_CHANGED`) → record a pastoral appointment (`APPOINTMENT_RECORDED`) → end one (`APPOINTMENT_ENDED`).
- Failure: same three-state gate, with `CredentialsNotAvailable` worded so it never implies a congregation-side fix exists (DECISION-112/116: no congregation role can ever hold `credentials.manage`).

**Flow 5 — Publish → presbytery sees → withdraw → presbytery sees (the round trip named in the kickoff):**
- entry: **there is no UI entry for "publish."** `org_portal.statistical_publication` (the congregation's self-service annual-return page) is a seeded flag with no page built behind it (`grep` for the route returns nothing) — Phase 1 of the withdraw pipeline already found this and it's unchanged. So "publish" in this round trip can only be *staged* (a direct call/insert equivalent to `presby_publish_sasr_snapshot()`), the same way `statistics-submit.spec.ts` stages its grant chain — it is not a browsable verb yet.
- step: congregation clerk (`clerk.fixture`, Alder Creek) opens `/o/alder-creek/admin/filings`, sees the staged return as "Current," clicks Withdraw, enters a minute reference → `withdrawFilingAction` → `STATISTICS_RETURN_WITHDRAWN` audit.
- outcome (congregation side): row now shows "Withdrawn" with date + minute reference, Withdraw action gone.
- outcome (presbytery side): `presbytery.clerk.fixture` (Northern Reach) reloads `/o/northern-reach/admin/reports` — the withdrawn return is excluded from "current" rollups — and `/o/northern-reach/admin/reports/[aboutOrgId]` (Alder Creek's id) shows the same row marked Withdrawn, never deleted.
- Failure: **not described anywhere in the kickoff.** What does a presbytery clerk see if they try to act on a congregation's behalf here (there is no such action — withdrawal is source-council-only, correctly)? What does the congregation clerk see if they try to withdraw an already-withdrawn or superseded row? (`withdrawFiling`'s own uniform literals for `ALREADY_WITHDRAWN_MARKER`/`SUPERSEDED_MARKER` suggest this is handled, but no spec asserts the copy.)

## Permissions & Flags

- **Permission(s):** all existing — `congregation_oversight.manage`, `statistics.manage`, `per_capita.manage`, `statistics.submission_grants`'s issuance check (also `statistics.manage`), `credentials.manage`, `statistics.publish`. No new key needed for this pipeline.
- **Default roles:** none of the six carries a seeded platform-wide default binding (DECISION-119/078: no PC(USA) office is the constitutional keeper of any of these). In the fixture data, `credentials.manage`/`congregation_oversight.manage`/`statistics.manage`/`per_capita.manage` all live on one adopted role (`presbytery_stated_clerk`, `f0000000-…-000e`) held by Idris Calloway at Northern Reach; `statistics.publish` lives on the congregation's own adopted `stated_clerk` role held by Tobias Renwick at Alder Creek.
- **Flag(s):** `org_portal.oversight`, `org_portal.reports`, `org_portal.credentials`, `org_portal.filings`, `statistics.submission_grants` — all existing, no new key. **Live-checked on this pipeline's own branch DB** (not assumed from `scripts/seed.ts`'s seeded-OFF default, which the spec author must not rely on): `org_portal.oversight` = **true**, `org_portal.reports` = **true**, `org_portal.credentials` = **true**, `org_portal.filings` = **false**, `statistics.submission_grants` = **false**, `org_portal.statistical_publication` = **false**. This confirms three of the five flags are already flipped on in this shared dev database (manual, same pattern as `org_portal.chrome_v2`/`feedback` for the fpcw demo) and two are not — every new spec must capture-then-restore each flag it touches in its own `beforeAll`/`afterAll`, exactly as `statistics-submit.spec.ts` and `public-sites.spec.ts` already do, and must not assume either starting state.

## Gaps the Request Didn't Address

1. **The kickoff's "must enable the flags... in `global-setup.ts`" instruction doesn't match established practice, and following it literally would be a mistake.** Neither `statistics-submit.spec.ts` nor `public-sites.spec.ts` touches `global-setup.ts` to flip a flag — each captures the flag's current value in its own `test.beforeAll` and restores it in `afterAll`, scoped to that one spec file. `global-setup.ts` is shared, high-collision setup every spec pays the cost of; flipping a flag there would leak state into specs that never asked for it (and `global-setup.ts` isn't in this pipeline's list of files it may touch — it's not `e2e/support/seed-orgs.ts` or `seed-users.ts`). **Recommend:** each new spec file follows the existing per-file capture/restore pattern; Phase 3 should correct this instruction rather than build against it literally.

2. **No fixture exists for "active relationship at a presbytery, no matching grant" — the denial state each of oversight/reports/credentials most needs to prove correctly.** Every presbytery-only page has *four* distinct negative states (flag off → generic "not turned on"; wrong org type → product-not-here; right org type + relationship but no grant → the page's own `*Forbidden` copy; genuine load error), and a spec that only proves "you get sent somewhere that isn't the data" without controlling *which* of the four fired is exactly the "denied path denied by the wrong thing" trap the adversarial pass warns about. Today, the only loginable person with any relationship at Northern Reach is Idris Calloway, who holds *all four* presbytery permissions via one role — there is no loginable person there with a relationship and nothing granted. **Recommend:** mint one new person + login at the existing e2e-owned `e2e-presbytery` org (already `type: presbytery`, already branded, already hosts org-multi's `statistics.manage` grant) with a plain relationship and zero role grants — this one fixture covers the "state 2" denial for oversight, reports, *and* credentials, since all three share `orgTypeScope: ["presbytery"]`. The wrong-org-type state needs no new fixture (`org-single`/`org-multi` at `e2e-alpha` already covers it), and filings' own "state 2" (a congregation member with no `statistics.publish`) is already covered for free by `org-single` at `e2e-alpha`.

3. **The round trip's "publish" leg has no UI.** `org_portal.statistical_publication` is a seeded flag with no page behind it (confirmed by `grep`; unchanged since the withdraw pipeline's own Phase 1 finding). A spec asserting "a congregation publishes, withdraws, and the presbytery sees both states" can only stage the publish half directly — worth saying so explicitly rather than discovering it mid-Phase-4, and worth naming which mechanism stages it (`presby_publish_sasr_snapshot()` via raw SQL, the same shape `statistics-submit.spec.ts` already uses for grant rows it can't reach through `import "server-only"`-guarded application code).

4. **Alder Creek carries exactly one seeded publication (report year 2025), confirmed live and un-withdrawn on this pipeline's own branch** (`select … from publications join statistical_returns … where organization_id = Alder Creek` → `2025|withdrawn=f`). This is the *same* row a prior pipeline's own QA phase destroyed by rehearsing withdrawal in a browser (`docs/work-log/2026-09-26-withdraw-publication.md` Phase 5, first pass) — that damage happened on that pipeline's own now-deleted Neon branch and evidently never reached `development`, but the mechanism is identical here: this pipeline forks from `development`, and any spec (or manual rehearsal) that withdraws *this* row makes Alder Creek permanently short its one live SASR return for `scripts/test-rls.sql` and every other spec that assumes it. **The round-trip spec must mint its own fresh `statistical_returns`/`publications` chain for a report year it owns exclusively** (mirroring `statistics-submit.spec.ts`'s `LIVE_REPORT_YEAR = 2091` convention and its freeze-trigger disable/delete/re-enable teardown), never touch the 2025 row, and the withdraw *action itself* should be exercised against that minted row, not Alder Creek's real one.

5. **Alder Creek forces the 2FA gate at sign-in even though `clerk.fixture`'s own `two_factor_required` column is `false`** — `organization_settings.require_two_factor = true` for Alder Creek specifically (seeded that way on purpose, per the file's own comment, to prove the per-church policy resolves independent of org GUC). `public-sites.spec.ts` already hit this and works around it by disabling the `auth.require_2fa` master switch for exactly the sign-in + page-view it needs, restored immediately after and reconfirmed in `afterAll`. The filings/withdraw round trip signs `clerk.fixture` in at Alder Creek and **will hit the identical detour** — not mentioned in the kickoff, and easy to lose an hour to if rediscovered rather than planned for. Northern Reach carries no `organization_settings` row at all (default), so `presbytery.clerk.fixture` needs no such workaround.

6. **`e2e/statistics-submit.spec.ts` already fully covers Flow 3.** The kickoff's phrasing ("grant issue → anonymous submit → revoke") reads as if this pipeline owns that flow; it doesn't need new coverage, only a cross-reference, and duplicating it would be wasted spec surface and another source of the "Issued Statistics Manager" custom role (`e2e_statistics_manage`, `seed-orgs.ts`'s already-appended block) colliding with anything new this pipeline adds at the same org.

7. **Four pre-existing failures, reproduced exactly as `docs/TODO.md` describes — with one correction.** Baseline run (120 passed / 4 failed / 5 skipped):
   - `header-controls.spec.ts:110` — flaky (arrow-key focus), matches the TODO note.
   - `post-login-routing.spec.ts:110` and `:166` — stale pre-`org_portal.home_v2` copy assertions, matches the TODO note.
   - `public-sites.spec.ts:334` — **still fails on this branch (`main`, v0.28.0), contradicting `docs/TODO.md`'s claim that it "resolves on merge" via PR #17.** The failure is real: `getByRole('heading', { name: 'Alder Creek — E2E Public Sites Test Content', level: 1 })` never appears; five `describe.serial` dependents (cases 3–7) then skip. This needs a fresh look in Phase 3/4, not an assumption that it's already fixed — the TODO line should be corrected at integration regardless of what this pipeline does with it.

8. **Mobile pass, one per surface, is in the kickoff's own constraints but not named per-surface.** Oversight's edit form, the reports page's three stacked sections (statistics/per-capita/grants — the anonymous `/file-statistics` mobile case is already covered by `statistics-submit.spec.ts` case 2, but the *admin-side* reports page's own forms at 360px are not), credentials' two record forms, and filings' table-with-action (the withdraw pipeline's own Phase 5 already flagged the Withdraw button sitting inside the `Table`'s horizontal scroller at 360px, off-screen until swiped — `docs/TODO.md`'s withdraw follow-up #2) all need an explicit 360px assertion; filings' in particular should assert the *known* scroller issue rather than silently pass past it.

9. **No 2FA-enrolled actor exists for any of these five surfaces**, and none of the fixture people at Northern Reach/Alder Creek carry `two_factor_required = true` at the user level (Alder Creek's *org-level* master switch is the only 2FA involvement, per Gap 5). This is consistent with every other non-auth-touching pipeline's practice and is not itself a defect — named for completeness per Pass 4, not as something to build.

## Out of Scope (confirm with user)

- Re-covering Flow 3 (submission grant issue/revoke/anonymous-submit) — already fully covered by `e2e/statistics-submit.spec.ts`.
- Building the congregation's self-service "publish" page (`org_portal.statistical_publication`) — that is a separate, larger pipeline (per the withdraw pipeline's own Phase 1 scope call); this pipeline stages publication as fixture data only.
- Unit/DB-backed vitest coverage of any of these libraries (`presbytery.ts`, `credentials.ts`, `filings.ts`) — already exists per their own `.test.ts` files; this pipeline adds e2e only.
- The committees stub and visual-regression snapshots (named out of scope in the kickoff).
- Fixing `public-sites.spec.ts:334` itself — flagged as a live finding (Gap 7) but the fix belongs to whichever pipeline owns `presby-site-kit`'s stub content, not necessarily this one; at minimum, this pipeline's Phase 3 should decide explicitly whether "fixing the four" includes actually debugging this one or just correcting the record and re-flagging it.

## Open Questions

- For the round trip's Flow 5 failure paths: what should a congregation clerk see when attempting to withdraw an already-withdrawn or superseded return? `withdrawFiling`'s uniform literals (`ALREADY_WITHDRAWN_MARKER`, `SUPERSEDED_MARKER`) suggest an answer exists in code; Phase 3 should confirm the exact copy so the spec can assert it precisely rather than loosely.
- Should the new "presbytery member, no grant" fixture (Gap 2) be added to `e2e/support/seed-orgs.ts` (Playwright-owned, `e2e-presbytery`) as recommended, or does the founding-administrator pipeline running in parallel already plan to add an equivalent actor at a `scripts/seed-dev.sql` org — the kickoff's own "Depends on" line flags this exact overlap for orchestrator reconciliation.
- Confirm with the user/tech-lead whether "fixing" `public-sites.spec.ts:334` in Phase 4 means investigating the real regression (Gap 7) or only correcting `docs/TODO.md`'s stale claim and re-filing it — the two are very different amounts of work and the kickoff's "fixing those is in scope" line doesn't distinguish.

---

### Orchestrator rulings (2026-09-28)

1. **Gap 1 accepted — per-file capture/restore** of every flag a spec touches (the `statistics-submit.spec.ts` / `public-sites.spec.ts` pattern); `global-setup.ts` is not touched for flags. The kickoff wording is corrected by this ruling.
2. **Gap 2 — the permission-less presbytery member is a Playwright-owned fixture** in `e2e/support/seed-orgs.ts` at `e2e-presbytery`, not a `scripts/seed-dev.sql` addition — no collision with the founding-administrator pipeline, which owns any `seed-dev.sql` actor changes.
3. **Gap 3/4 — publish is staged, never browsed**, and the round-trip spec mints its own `statistical_returns`/`publications` chain for a report year it owns exclusively (the `LIVE_REPORT_YEAR` convention); Alder Creek'"'"'s 2025 row is never withdrawn by any spec or rehearsal. The architect rules whether the minting helper is shared (`e2e/support/`) or spec-local.
4. **Gap 5** — the Alder Creek 2FA detour is planned for, using `public-sites.spec.ts`'"'"'s master-switch capture/restore.
5. **Gap 6** — Flow 3 is cross-referenced, not re-covered.
6. **Gap 7 — `public-sites.spec.ts:334` is real on main.** Phase 3 diagnoses it: if it is spec/fixture rot, this pipeline fixes it; if it is a product regression in the public-site render, it becomes its own bug-fix pipeline and the `docs/TODO.md` line is corrected at integration either way. The other three (two stale `post-login-routing` assertions, the flaky `header-controls` case) are fixed here.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-28.*

## Verdict

**Approved with suggestions** — nine rulings below, one new decision proposed (DECISION-157), three findings (F113–F115). One of them (F113) is a CI blocker the kickoff assumed away: `e2e.yml` cannot pass on the day the operator adds the Neon secrets, for a reason unrelated to this pipeline's new specs.

## Placement

- **Directory placement:** `e2e/` and `e2e/support/` only. Three new shared modules (`db.ts`, `flags.ts`, `sasr-fixture.ts`), four new spec files, appended fixtures in `seed-users.ts`/`seed-orgs.ts`/`users.ts`, a spec-rot fix in `public-sites.spec.ts`, two stale assertions in `post-login-routing.spec.ts`, one flaky case in `header-controls.spec.ts`, and roster/ownership lines in `/Users/cshenso/git/presby-platform/presby-wt-e2e/docs/testing.md`. **No file under `src/` is touched** — if Phase 3 finds itself designing a product-code change, that is a different pipeline and a loop-back to Phase 1.
- **Server vs Client split:** not applicable — no React component is created. The constraint that matters instead: nothing under `e2e/` may import from `@/lib` (`src/lib/db/index.ts` builds the Neon pool at module scope and `src/lib/sites.ts`/`statistics-grants.ts`/`filings.ts` are `import "server-only"`). Fixture staging goes through raw SQL on `@neondatabase/serverless`, as `seed-orgs.ts` and both exemplar specs already do.
- **Dependencies:** **none new.** `@playwright/test@1.60.0` is installed and supplies everything the design needs (`test.fail`, `test.fixme`, `scrollIntoViewIfNeeded`, `toHaveCount`, per-context viewports, `request.get`). `@neondatabase/serverless`, `bcryptjs` and `dotenv` are already in the tree and already used by `e2e/support/`. Criteria 1–5 are moot; confirm no `npm install` appears in the Phase 4 diff.

## Invariants Touched

No product invariant changes. Five are *exercised* and must be honoured by the specs themselves:

1. **Real credentials, no session mocking.** New actors join `E2E_USERS` in `/Users/cshenso/git/presby-platform/presby-wt-e2e/e2e/support/users.ts` so `global-setup.ts` acquires their sessions through the real NextAuth credentials endpoint. No spec mints a JWT, sets a cookie by hand, or stubs `auth()`.
2. **The Edge gate is not bypassed.** Every navigation is a real `page.goto` at a real URL. `role-boundaries.spec.ts`'s standing prohibition — never POST to a server-action URL — holds for these specs too.
3. **Permissions vs flags stay separate, and the specs must *prove* the separation.** For each surface, assert both axes independently: flag ON + no grant → the `*Forbidden` copy; flag OFF + grant held → the flag-off copy. A spec that only ever flips the flag would let a permission regression ship green.
4. **RLS / the owner connection.** Fixture staging uses `E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL` (BYPASSRLS) — the documented, `e2e/support/`-scoped exception. It must stay in `e2e/support/`; no spec file opens its own owner connection ad hoc (that is what the new `e2e/support/db.ts` is for).
5. **The roll/return chain is append-only.** The teardown temporarily disables `statistical_returns_freeze` / `publications_freeze` / `congregation_statistics_freeze` — verified live on `pipeline-presbytery-e2e`: all three exist and are enabled (`tgenabled = 'O'`). This is invariant-adjacent and is confined to one reviewed module (ruling 1a), inside one `do $$ … $$` statement so a failed delete rolls the disable back, with a verified re-enable (F115).
6. **No Real Data.** New people are invented, emails `@presby.invalid`, slugs `e2e-`, role keys `e2e_*`. `npm run check:secrets` must stay clean.

## Notes

### 1. `e2e/support/` structure

**1a. The publication-chain helper is shared, not spec-local: `/Users/cshenso/git/presby-platform/presby-wt-e2e/e2e/support/sasr-fixture.ts`.** Two consumers exist the moment the round trip lands (the withdraw flow and the presbytery's `admin/reports/[aboutOrgId]` history read), and the teardown is the most dangerous code in the suite — it disables three append-only triggers on shared tables. Dangerous, non-obvious, multi-consumer code belongs in `support/`, reviewed once, not copy-pasted per spec. Surface:

- `stagePublishedReturn({ congregationOrgId, reportYear, minuteReference })` → publication id. **Stage through `presby_publish_sasr_snapshot(p_report_year, p_minute_reference)`, not hand-written INSERTs into three tables.** Verified live: the function is `SECURITY DEFINER`, takes *no* org id (it reads `presby_current_org()`), walks exactly one `parent_id` link, and derives supersession itself. Every other parameter defaults to null. So the staging is a single `do $$ … $$` block that does `perform set_config('app.current_org_id', '<congregation id>', true); perform presby_publish_sasr_snapshot(<year>, '<minute ref>');` — one statement, because the GUC is transaction-local and the `neon()` HTTP driver gives each tagged-template call its own implicit transaction (`seed-orgs.ts` mechanic 2). This stages the *product's own* chain rather than a hand-rolled imitation of it.
- `removePublishedReturn({ congregationOrgId, reportYear })` — the disable/delete/re-enable teardown, copied in shape from `statistics-submit.spec.ts:223-260` and improved per F115.
- Two guards inside the module, mirroring `seed-orgs.ts`'s `assertFixtureShape()`: refuse any organization whose slug does not start with `e2e-`, and refuse any report year outside the reserved band (see 2c). These guards are the mechanical enforcement of DECISION-157 — a guard is what would have prevented the Alder Creek incident; a comment would not have.

**1b. The flag helper is shared: `/Users/cshenso/git/presby-platform/presby-wt-e2e/e2e/support/flags.ts`.** `getFlag`/`setFlag` are today byte-identical in `statistics-submit.spec.ts:69-81` and `public-sites.spec.ts:108-120`. Export `getFlag`, `setFlag`, and `captureFlags(keys) → restore()` (capture-then-restore as one call, which is the pattern both specs hand-roll). **Extracting it from the two existing specs is in scope**, with one sequencing condition: do it as the *last* commit of Phase 4, after the new coverage is green, so a problem there is revertible without losing the pipeline's actual work. Leaving two copies behind guarantees a third.

**1c. One more small module: `e2e/support/db.ts`** exporting `platformSql(specName)` — the `E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL` resolution plus the actionable throw, duplicated in three places today (both specs and `assert-fixture-invariants.ts`). `flags.ts` and `sasr-fixture.ts` both depend on it.

**1d. Do not touch `global-setup.ts` for flags** — orchestrator ruling 1, which I endorse: it is shared setup every spec pays for, and a flag flipped there leaks into specs that never asked for it.

### 2. Fixture strategy — Playwright-owned only, and it buys more than safety

**2a. Placement and naming confirmed.** New actors go in `users.ts` (`E2E_USERS` + `E2ERole`) and `seed-orgs.ts` (`FIXTURE_PEOPLE` + an appended grants block modelled on the existing `e2e_statistics_manage` block at `seed-orgs.ts:393-443`). **New people must be added to the existing `FIXTURE_PEOPLE` array, not a parallel one** — `assertFixtureShape()` (`seed-orgs.ts:189-208`) only validates what is in that array, and a parallel array would quietly escape the guard. Convention: person ids continue the `e2e00000-0000-0000-0000-0000000000aN` series (a5, a6, a7); role ids the `…0000000000bN` series (b2, b3); role keys `e2e_presbytery_clerk`, `e2e_statistics_publish`; emails matching the `E2ERole` key at `@presby.invalid`.

**2b. Three new actors, and the reason there are three rather than two.** Verified against the live branch (`select … from role_grants where organization_id …`): `e2e-presbytery` has exactly one grant (org-multi's `statistics.manage`), and `e2e-alpha/beta/gamma` have none.

| New role key | Org | Grants | Covers |
|---|---|---|---|
| `presbytery-clerk` | `e2e-presbytery` | new `e2e_presbytery_clerk` role: `congregation_oversight.manage`, `per_capita.manage`, `credentials.manage`, `statistics.manage` | the positive path on all three presbytery surfaces |
| `presbytery-nogrant` | `e2e-presbytery` | none | Gap 2's "state 3" denial on oversight, reports **and** credentials at once |
| `congregation-clerk` | `e2e-alpha` | new `e2e_statistics_publish` role: `statistics.publish` | the filings positive path and the withdraw act |

**Leave `org-multi`'s `e2e_statistics_manage` role at exactly one permission.** It *is* the split-permission fixture Phase 1 Gap (Flow 2) asks for: holds `statistics.manage`, lacks `per_capita.manage`, so one page load renders the statistics section and `ReportsSectionForbidden section="per-capita billing"` side by side. Adding permissions to that role would delete a negative state and quietly weaken `statistics-submit.spec.ts` at the same time. `org-single` at `e2e-alpha` (no grants) is already the filings "no `statistics.publish`" fixture — no fourth actor needed. All six permission keys are present in `permissions` (FK-checked by `app_role_permissions_permission_key_permissions_key_fk`), so a typo fails loudly at seed time rather than silently granting nothing. `statistics.publish` must be direct-granted through a custom `app_role`, not by adopting the `congregation_stated_clerk` template — `assertPermissionSubset()` blocks that adoption path (`docs/TODO.md:120`).

**2c. The ruling on `scripts/seed-dev.sql` fixtures: readable, never writable.** Every one of the five surfaces and the round trip runs on `e2e-*` orgs. Northern Reach / Alder Creek / Idris Calloway / Tobias Renwick are **not** used by any new spec. Three reasons, in order of weight:

- The withdraw pipeline's QA FAIL. Confirmed on this branch: `select o.slug, sr.report_year … from statistical_returns` returns exactly **one row in the entire database** — Alder Creek 2025, un-withdrawn. `scripts/test-rls.sql:2423-2441` asserts `presby_list_own_congregation_publications()` returns that known publication id with count 1. A spec, or a browser rehearsal, that withdraws it damages the isolation suite, not just itself.
- It deletes Gap 5 entirely. Verified: `select o.slug, s.require_two_factor from organization_settings s …` returns `alder-creek|t`, `bramblewood|f` and **no row for any `e2e-*` org**. Running the round trip at `e2e-alpha` means the specs never touch `auth.require_2fa` — the single most dangerous global flag in the suite, currently ON, and the one whose restore failure would lock the whole suite out of 2FA enforcement.
- `e2e-alpha`'s parent is `e2e-presbytery` (confirmed live), so `presby_publish_sasr_snapshot()`'s one-parent-link walk resolves and the presbytery side of the round trip works unchanged.

Reserved report-year band: **2090–2099**, with **2091/2092/2093 already claimed** by `statistics-submit.spec.ts:61-63`. New specs take 2094 upward; `sasr-fixture.ts` carries the claimed-years registry as a module constant so the next pipeline does not have to grep for it. (The reports page clamps the `?year=` query to ≤ 2100, so the band renders.)

**2d. The one standing exception, recorded not blessed:** `public-sites.spec.ts` mutates Alder Creek's `organization_sites` and toggles `auth.require_2fa`, for the documented reason that `elder.fixture` is the only sign-in-capable `tickets.file` holder and exists only there. Migrating it to an `e2e-*` org is a follow-up TODO line, not this pipeline's work.

### 3. Spec file organisation, `describe.serial`, and the run-time budget

**Four spec files, not five or six.** `presbytery-oversight.spec.ts`, `presbytery-reports.spec.ts`, `presbytery-credentials.spec.ts`, and **`filings-round-trip.spec.ts`** — the kickoff's separate `congregation-filings.spec.ts` and round-trip spec **merge into one**. The filings surface has nothing to show without a staged publication chain; two files would each stage one, duplicating the most dangerous fixture code and doubling the teardown risk for no added coverage. One staging site, one teardown.

`describe.serial` where a case consumes an earlier case's side effect — `filings-round-trip.spec.ts` (stage → view → withdraw → presbytery-sees) and `presbytery-reports.spec.ts` (rate → generate → payment). Plain `describe` for oversight and credentials, whose cases are independent; `workers: 1` / `fullyParallel: false` already makes ordering deterministic, so `.serial`'s only added value is abort-on-first-failure and it should not be cargo-culted.

**Budget:** ≤ 90 s per new spec file locally at `workers: 1`; ≤ 5 min added across the four; full local suite ≤ 12 min. CI ceiling: the `e2e` job has `timeout-minutes: 30` and `retries: 1`, so a clean run must finish in ≤ 15 min for a single retry to still fit. `page.goto` against the Turbopack dev server dominates — when a file is over budget, fold assertions into fewer navigations rather than deleting coverage. The implementer reports per-file durations in Phase 4; QA records them in Phase 5.

### 4. The four-negative-state discipline — assert the state component's own sentence

The mechanism is: **assert the distinguishing paragraph, and assert the sibling states' paragraphs are absent.** Asserting the heading is not enough and is the exact trap — `PlaceholderFlagOff` and `PlaceholderNotAvailable` both render the identical `<h1>{AREA}</h1>` (`/Users/cshenso/git/presby-platform/presby-wt-e2e/src/components/org-portal/coming-soon.tsx`), so an `<h1>`-only assertion cannot tell "flag off" from "wrong org type". The anchors, read off the components:

| State | Anchor | Source |
|---|---|---|
| flag off (oversight/reports/filings) | `/isn't turned on for <Org> yet/` | `coming-soon.tsx` `PlaceholderFlagOff` |
| wrong org type (oversight/reports/filings) | `/isn't the kind of organization this tool is built for/` | `coming-soon.tsx` `PlaceholderNotAvailable` |
| flag off / wrong org type (credentials) | `/Ministry credentials & pastoral appointments isn't turned on for/` · `/…isn't available for/` | `credentials-states.tsx:30,52` |
| no grant — oversight | `/don't have permission to manage congregation oversight records/` | `oversight-states.tsx` |
| no grant — reports, per section | `/don't have permission to manage (statistics\|per-capita billing\|submission grants)/` | `reports-states.tsx` |
| no grant — credentials | `/don't have permission to manage ministry credentials/` | `credentials-states.tsx:70` |
| no grant — filings | `/don't have permission to manage statistical filings/` | `filings-states.tsx` |

Each denied case asserts its own anchor **visible** and at least one sibling anchor `toHaveCount(0)`. The fourth state (genuine load error) is **out of scope for e2e** — it is not reachable without breaking the database mid-run, and `page.test.tsx` already covers it; say so explicitly in the spec header rather than leaving a reader to wonder which of four states is untested. Note also the wrong-org-type case needs no new fixture: `org-single` at `e2e-alpha` hitting `/o/e2e-alpha/admin/oversight|reports|credentials`, and `org-multi` at `e2e-presbytery` hitting `/o/e2e-presbytery/admin/filings`, cover both directions.

### 5. The 360px pass and the filings scroller

Every surface gets a 360×800 pass that **operates the surface's primary control at that width** — not a visibility check and not a screenshot. For filings: **assert the known behaviour positively; do not `test.fixme` and do not `test.fail`.**

- `test.fixme` skips the body, so the exact interaction the follow-up will change ends up with zero coverage — the worst of both.
- `test.fail` is wrong here because `docs/TODO.md:121` records this as *the shipped `GrantsTable`/`StatisticsTable` convention*, not a filings defect. An expected-failure marker would fire spuriously and would have to be maintained in three places the day a card layout lands.
- So: assert the container overflows at 360 (`scrollWidth > clientWidth` on the `table-container` element — the primitive's own scroller, `src/components/ui/table.tsx`) **and** that Withdraw is operable after `scrollIntoViewIfNeeded()` and opens the dialog. Attach `test.info().annotations.push({ type: "known-issue", description: "docs/TODO.md withdraw residual (2) — Withdraw sits inside the table scroller at 360px" })` so it surfaces in the report without changing pass/fail semantics.

### 6. `public-sites.spec.ts:334` — **spec/fixture rot, not a product regression.** Fix it here; no separate bug-fix pipeline.

Evidence, in order:

- The spec stages a **v0.0.1-stub-shaped** bundle: `stageLiveBundle()` at `public-sites.spec.ts:169-201` writes `pages: [{ path: "/", frontMatter: { title: TEST_TITLE }, mdxAst: null }]`.
- The installed renderer is **`presby-site-kit@4.0.0`** (`package.json` pins `github:chenson42/presby-site-kit#v4.0.0`; `git log -p -- package.json` shows `v3.6.0 → v4.0.0`, the latest of six major/minor bumps since the stub the spec was written against).
- v4's `extractBlocks()` (`node_modules/presby-site-kit/dist/index.js:87-97`) states it outright: anything that is not `{ blocks: [...] }` — *"including every legacy v0.0.1-stub `{ raw: string }` page still sitting in an unmigrated content repo"* — collapses to an empty array, so **the page body renders as nothing**. `renderSiteBundle()` never reads `frontMatter.title` into the document body at all; the sole `<h1>` in the entire package is `components/Hero.js`, fed by a `Hero` block's `heading`.
- `grep -rn "Content coming soon" node_modules/presby-site-kit/dist` → **no matches**. The spec's second assertion (`:347`) is dead copy from the stub as well.
- The product path is healthy: `src/app/(public)/site/[slug]/[[...path]]/page.tsx` still returns 200 (Nav + Footer + the Contact section render), and `notFound()` fires only when no bundle page matches `currentPath`. The `:340` status assertion passes; only the two content assertions fail, which is precisely the signature of stale fixture shape rather than a broken render.

**Conclusion:** PR #17 could not have fixed this and the `docs/TODO.md` line saying it "resolves on merge" is wrong — correct it at integration. The fix is spec-only: stage `mdxAst: { blocks: [{ type: "Hero", props: { heading: TEST_TITLE } }, { type: "Prose", props: { body: … } }] }` and assert against what v4 actually renders. **Phase 4 must verify the block shape by reading `node_modules/presby-site-kit/dist/blocks.js` rather than assuming it** — that assumption is what rotted in the first place. Worth a Phase 3 line: this spec is now coupled to a pinned external renderer's bundle schema, and the next site-kit major will rot it again; a short note in the spec header naming the version it was written against is the cheap mitigation. Logged as **F114**.

### 7. Dependencies

None. Confirmed above. `npm run check:deps-drift` must stay green and no `package.json`/lockfile change should appear in the Phase 4 diff.

### 8. "Leave the DB as found," made mechanical

Extend `/Users/cshenso/git/presby-platform/presby-wt-e2e/e2e/support/assert-fixture-invariants.ts` with two new *exported, per-spec* guards (not folded into `globalSetup` — that file's header explicitly rejects the blast radius, and I agree):

- `assertNoStrayFixtureReturns()` — no `statistical_returns` row exists in the reserved 2090–2099 band. Called in `beforeAll` (a prior crashed run left rows) **and** `afterAll` (this run leaked).
- `assertSeedPublicationsIntact()` — Alder Creek's 2025 publication is present and `withdrawn_at is null`. This is the direct mechanical descendant of the withdraw pipeline's QA FAIL: it turns "don't touch the seed row" from a comment into a check that names the damage the moment it happens, on whichever spec did it.

Both are cheap queries on the owner connection and both belong to the new specs' `beforeAll`/`afterAll`, alongside the flag-restore verification that `public-sites.spec.ts:281-307` already models (restore, then *confirm by SELECT* — do not trust the UPDATE).

### 9. CI — **not "nothing." One line is missing, and it is a hard blocker (F113).**

`.github/workflows/e2e.yml`'s "Write .env.local" step writes `DATABASE_URL`, `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `MIGRATE_DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `AUTH_TOTP_ENCRYPTION_KEY`, `RATE_LIMIT_DISABLED` — and **not** `E2E_DATABASE_URL`. `runDbIsolationGuard()` (`e2e/support/global-setup.ts:43-78`) then runs, in order: no `E2E_DATABASE_URL` → parse `DATABASE_URL`'s hostname → it ends in `.neon.tech` → no `E2E_ALLOW_SHARED_DB` → **`if (process.env.CI) throw`**. GitHub Actions sets `CI=true` in every step by default, and the "Run e2e suite" step sets it explicitly on top. So the job throws at `globalSetup` with *"DATABASE_URL points at a Neon shared database"* — about a branch that was created fresh for the run and is deleted in an `always()` step. It has never been observed because the job has never run: the secrets are absent and `check-secrets` skips it. This is the same class of defect as C-5 (a job that could not have passed even with the secrets).

Fix, in the same `{ … } >> .env.local` block:

```
echo "E2E_DATABASE_URL=${{ steps.db.outputs.app_database_url }}"
```

That takes the guard's own Step A early return and is literally Option A in the guard's error text ("a dedicated Neon branch connection string (recommended for CI)"). Prefer it over `E2E_ALLOW_SHARED_DB=true`, which acknowledges a risk that does not exist here and would suppress the guard for a genuinely shared URL later. Do **not** also add `E2E_PLATFORM_DATABASE_URL` — `PLATFORM_DATABASE_URL` already resolves through the `??` chain, and a second copy is one more thing to drift.

Beyond that one line, CI needs nothing: `db:migrate` → `check:schema-parity` → `db:seed` → `seed-dev.sql` → `globalSetup` picks the new fixtures up automatically; `playwright.config.ts` loads `.env.local` via dotenv so the specs and the dev server see the same URLs; `PLATFORM_DATABASE_URL` is `neondb_owner`, which owns the freeze triggers on a freshly-migrated database, so the teardown's `alter table … disable trigger` is permitted. Flag starting states differ in CI (fresh `db:seed` defaults, mostly OFF) from this dev branch (`oversight`/`reports`/`credentials` ON, `filings`/`submission_grants` OFF — confirmed live) — which is exactly why per-file capture/restore, never an assumed starting state, is ruling 1d.

### Findings to record

- **F113 — `e2e.yml` would fail at `globalSetup` on its first real run.** No `E2E_DATABASE_URL` is written, so `runDbIsolationGuard()` hard-throws on the ephemeral branch's `*.neon.tech` host under `CI`. One-line fix in the "Write .env.local" step. Never observed because the job has always skipped.
- **F114 — `public-sites.spec.ts:334` is spec rot, not a product regression.** The spec stages a `presby-site-kit` v0.0.1-stub bundle (`mdxAst: null`) against an installed v4.0.0 renderer whose `extractBlocks()` collapses legacy shapes to an empty body; `frontMatter.title` is never an `<h1>` in v4 and "Content coming soon." no longer exists in the package. `docs/TODO.md`'s "resolves on merge via PR #17" is wrong.
- **F115 — the freeze-trigger teardown never verifies re-enablement.** `statistics-submit.spec.ts:223-260` disables three append-only triggers, deletes, re-enables inside the `do` block, and fires three idempotent re-enables after — but asserts nothing about the final state. If both layers ever fail, the suite leaves the DB with append-only enforcement OFF on three tables and nothing says so. `sasr-fixture.ts`'s teardown must end with a `select tgenabled from pg_trigger …` assertion that all three are `'O'`.

### Decision proposed

**DECISION-157 — e2e specs mutate only Playwright-owned fixtures.**

> An end-to-end spec may **read** any seeded row. It may **create, mutate or delete** only rows it created itself or rows in the Playwright-owned namespace: organization slugs prefixed `e2e-`, user emails at `@presby.invalid`, SASR report years in the reserved 2090–2099 band, and `app_roles` keyed `e2e_*`. Mutation helpers in `e2e/support/` enforce this with an assert-and-throw guard in the shape of `seed-orgs.ts`'s `assertFixtureShape()` — the rule is a guard, not a comment, because the failure it prevents has already happened once. A manual browser rehearsal counts as a spec for this purpose: it consumes the same single-use rows. `scripts/seed-dev.sql` is shaped to exercise specific findings (`scripts/test-rls.sql` asserts against Alder Creek's single publication by id), so a spec that writes to it damages the isolation suite, not merely itself. One documented exception exists — `public-sites.spec.ts`, which mutates Alder Creek's `organization_sites` because `elder.fixture` is the only sign-in-capable `tickets.file` holder — carried with a migration follow-up, not treated as precedent.

### Proposed `docs/TODO.md` lines (orchestrator applies at integration)

- Correct the "Four pre-existing e2e failures" line: `public-sites.spec.ts:334` was **not** fixed by PR #17; it is site-kit v4 spec rot (F114), fixed by `2026-09-28-presbytery-e2e`.
- Follow-up: extract `getFlag`/`setFlag` in `statistics-submit.spec.ts` onto `e2e/support/flags.ts` if not completed in this pipeline's final commit.
- Follow-up: migrate `public-sites.spec.ts` off `scripts/seed-dev.sql`'s Alder Creek fixture onto an `e2e-*` org with a `tickets.file` holder (DECISION-157's one exception).
- Follow-up: consider splitting `e2e/support/seed-orgs.ts` (453 lines, three appended blocks) into orgs/people/memberships vs roles/grants once this pipeline's block lands.

### Housekeeping Phase 3 must plan for

`docs/testing.md`'s fixture roster table (lines ~56-100) gains the three new actors and a short "who owns which fixture" paragraph stating DECISION-157. That file is editable on this branch; `docs/TODO.md`, `docs/decisions.md` and the rest of the shared set are not — return proposed lines instead.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete — nine rulings; four spec files on Playwright-owned fixtures only; three new `e2e/support/` modules; DECISION-157 proposed; F113 (CI blocker), F114 (`public-sites` is spec rot), F115 (unverified trigger re-enable) | Approved with suggestions | 2026-09-28 |

## Handoff

**Next: tech-lead (Phase 3).** Design the four spec files and the three `e2e/support/` modules against rulings 1–9; rule on the Phase 1 open question about `withdrawFiling`'s `ALREADY_WITHDRAWN_MARKER` / `SUPERSEDED_MARKER` copy so the round-trip spec can assert it exactly; confirm F113's one-line `e2e.yml` fix is in scope for this pipeline (it should be — it is three words and the job is otherwise unprovable). **Implementer: `full-stack-developer`** — the work is spec assertions plus owner-connection SQL fixture staging, spanning the browser and the database with zero product code, which is neither purely `ux-developer` nor purely `api-developer`.



### Orchestrator note (2026-09-28)

All nine rulings accepted. F113's one-line `e2e.yml` fix is in scope for this pipeline (the job is otherwise unprovable). F114: `public-sites.spec.ts:334` is fixed here as spec rot; the `docs/TODO.md` line is corrected at integration. DECISION-157 and F113–F115 adopted as proposed.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We are adding Playwright coverage for the five presbytery-portal surfaces
(oversight, reports/per-capita/submission-grants, credentials, filings, and
the publish→withdraw round trip) that today have none, plus fixing four
rotten pre-existing specs (two stale `post-login-routing` assertions, one
flaky `header-controls` case, and `public-sites.spec.ts`'s real site-kit-v4
spec rot, F114). Everything lands under `e2e/` only: three new shared
`e2e/support/` modules (`db.ts`, `flags.ts`, `sasr-fixture.ts`), four new
spec files, three new Playwright-owned fixture actors (`presbytery-clerk`,
`presbytery-nogrant`, `congregation-clerk`) appended to the existing
`e2e/support/users.ts` / `seed-orgs.ts` roster at the existing `e2e-presbytery`
/ `e2e-alpha` orgs, one CI one-liner (F113), and doc updates. No product code
under `src/` changes. The work makes the eventual CI `e2e` job (once the
operator adds the Neon secrets) actually prove something about the portal PSV
will use, and closes the specific F113 defect that would otherwise make that
job fail on its very first real run regardless of this pipeline's own specs.

## Permissions & Flags

No new permission or flag keys. The specs exercise six existing permissions
(`congregation_oversight.manage`, `statistics.manage`, `per_capita.manage`,
`statistics.submission_grants`'s own issuance check, `credentials.manage`,
`statistics.publish`) and five existing flags (`org_portal.oversight`,
`org_portal.reports`, `org_portal.credentials`, `org_portal.filings`,
`statistics.submission_grants`), asserting both a flag-on/no-grant denial and
a flag-off denial independently for each (architect invariant 3). Two new
`app_roles` rows are fixture data, not catalog data — `e2e_presbytery_clerk`
(four permissions) and `e2e_statistics_publish` (one permission) — following
`seed-orgs.ts`'s existing `e2e_statistics_manage` precedent exactly (a
fresh, org-scoped, `is_protected: false` custom role, never a template
adoption — `assertPermissionSubset()` blocks adopting `congregation_stated_
clerk` for `statistics.publish` per `docs/TODO.md:120`).

## API Contract

No new routes or server actions. Every mutation the specs perform goes
through an EXISTING server action, invoked exactly as a real browser session
would invoke it (form fill + click), per the "real credentials, no session
mocking, no POST-to-action-URL" invariant:

| Surface | Existing action invoked | File |
|---|---|---|
| Oversight | `setCongregationOversightAction` | `admin/oversight/[aboutOrgId]/actions.ts` |
| Reports — statistics | (implicit, `renderStatisticsSection`'s form) `recordCongregationStatisticsAction` | `admin/reports/actions.ts` |
| Reports — per-capita | `setPerCapitaRateAction`, `generatePerCapitaRecordsAction`, `recordPerCapitaPaymentAction` | `admin/reports/actions.ts` |
| Credentials | `recordOrdinationAction`, `recordAppointmentAction`, `endAppointmentAction` | `admin/credentials/actions.ts` |
| Filings | `withdrawFilingAction` | `admin/filings/actions.ts` |

Three new **test-support functions** (not application API) are added to
`e2e/support/`:

```ts
// e2e/support/db.ts
export function platformSql(specName: string): Sql;

// e2e/support/flags.ts
export async function getFlag(sql: Sql, key: string): Promise<boolean>;
export async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void>;
export interface FlagCapture {
  values: Record<string, boolean>;
  restore(): Promise<void>; // sets each flag back, then SELECTs to verify — throws on mismatch
}
export async function captureFlags(sql: Sql, keys: string[]): Promise<FlagCapture>;

// e2e/support/sasr-fixture.ts
export const RESERVED_YEAR_MIN = 2090;
export const RESERVED_YEAR_MAX = 2099;
export const CLAIMED_REPORT_YEARS: Record<string, number[]>; // registry, see Notes §1a
export async function stagePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number; minuteReference: string },
): Promise<{ publicationId: string }>;
export async function removePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number },
): Promise<void>;

// e2e/support/assert-fixture-invariants.ts (extended, not replaced)
export async function assertNoStrayFixtureReturns(sql: Sql): Promise<void>;
export async function assertSeedPublicationsIntact(sql: Sql): Promise<void>;
```

## Data Model

No schema changes required. All writes go through existing tables and
existing SECURITY DEFINER functions (`presby_publish_sasr_snapshot()`,
`presby_withdraw_publication()`, `presby_has_permission()`) or existing
Drizzle-mediated application code. Two `app_roles` fixture rows and their
`app_role_permissions`/`role_grants` rows are fixture data appended to
`seed-orgs.ts`'s existing block, following its existing idempotent
upsert/insert-where-not-exists shape — not a migration.

## Component / Page Plan

**Pages to create:** none — every route already exists.

**Files to create:**
- `e2e/support/db.ts`
- `e2e/support/flags.ts`
- `e2e/support/sasr-fixture.ts`
- `e2e/presbytery-oversight.spec.ts`
- `e2e/presbytery-reports.spec.ts`
- `e2e/presbytery-credentials.spec.ts`
- `e2e/filings-round-trip.spec.ts`

**Files to modify:**
- `e2e/support/users.ts` — three new `E2ERole` union members + `E2EUser` entries
- `e2e/support/seed-orgs.ts` — widen `FIXTURE_PEOPLE`'s role union, add three
  people + three memberships (existing `e2e-presbytery`/`e2e-alpha` orgs — no
  new organization fixture), one appended roles/grants block
- `e2e/support/assert-fixture-invariants.ts` — two new exported guards
- `e2e/public-sites.spec.ts` — fix case 2's staged bundle + assertions (F114)
- `e2e/post-login-routing.spec.ts` — fix two stale copy assertions (lines 110, 166)
- `e2e/header-controls.spec.ts` — fix one flaky case (line 110)
- `e2e/statistics-submit.spec.ts` — LAST commit only: replace its local
  `getFlag`/`setFlag` with imports from `e2e/support/flags.ts`
- `.github/workflows/e2e.yml` — one line, F113
- `docs/testing.md` — Accounts/Organizations table rows + a DECISION-157 paragraph
- `e2e/support/seed-users.ts` — **no change**, named explicitly so Phase 4
  doesn't go looking for one: it already provisions generically from
  `E2E_USER_LIST`, so three new roster entries need nothing added there.

No `src/` file is touched. If Phase 4 finds itself needing one, that is a
loop-back to Phase 2, not a Phase 4 judgment call.

## Implementation Order (failing-first)

1. `e2e/support/db.ts` — the smallest shared piece, everything else depends on it.
2. `e2e/support/flags.ts` — depends on `db.ts`'s `Sql` type only.
3. `e2e/support/sasr-fixture.ts` — depends on `db.ts`; write it and prove the
   guard fires (temporarily pass a non-`e2e-` org id / an out-of-band year and
   confirm the throw) before writing the spec that calls it.
4. Fixture roster: `users.ts` + `seed-orgs.ts` appended block. Run
   `npm run test:e2e -- --workers=1 -g "nothing"` (or any single existing
   spec) once to force `globalSetup` and confirm the three new users/roles/
   grants provision without error, **before** writing any new spec against them.
5. `assert-fixture-invariants.ts`'s two new guards, proven the same way
   `assertAdminFixtureHasNoOrgs()` already is: call them once against a
   deliberately-dirtied state (insert a stray row in the reserved band by
   hand) and confirm they throw, then clean up and confirm they pass.
6. **`presbytery-oversight.spec.ts`** (no `describe.serial`, no SASR fixture
   dependency — the simplest of the four, good order-of-operations proof).
   Failing-first demonstration: write the "no grant" case first against
   `presbytery-clerk` (who HAS the grant) — confirm it fails (sees the form,
   not `OversightForbidden`) — then point it at `presbytery-nogrant` and
   confirm it passes. This is the demonstration the design doc's Edge Cases
   section names as mandatory per surface.
7. **`presbytery-credentials.spec.ts`** — same shape, one more permission.
8. **`presbytery-reports.spec.ts`** — `describe.serial` (rate → generate →
   payment chain), three independently-gated sections. Failing-first
   demonstration: flip `org_portal.reports` off mid-suite-design and confirm
   the whole page becomes `PlaceholderFlagOff`; flip it back on and grant
   `statistics.manage` but not `per_capita.manage` (`org-multi`'s existing
   `e2e_statistics_manage` role, untouched) and confirm the two-sections-
   split-permission case actually renders one forbidden and one live.
9. **`filings-round-trip.spec.ts`** — the SASR fixture consumer, last because
   it is the most dangerous (disables three freeze triggers). Failing-first
   demonstration: attempt the withdraw as `presbytery-clerk` (no `statistics
   .publish`, wrong actor entirely) against the congregation clerk's own
   filing and confirm `FilingsSectionForbidden` / no Withdraw button is
   reachable, before ever exercising the real withdraw as `congregation-clerk`.
10. Diagnose and fix `public-sites.spec.ts:334` (F114) as its own commit —
    independent of the other three, can land any time after step 1.
11. Fix the two `post-login-routing.spec.ts` stale assertions and the one
    `header-controls.spec.ts` flaky case — independent, any time.
12. F113's one-line `e2e.yml` fix — independent, any time, but do it early
    enough that a CI dry-run (if the operator has already added secrets) can
    catch a problem before the PR is otherwise ready.
13. **Last commit only**: extract `getFlag`/`setFlag` out of
    `statistics-submit.spec.ts` onto `e2e/support/flags.ts` (ruling 1b) —
    after everything above is green, so a problem here is revertible without
    losing this pipeline's actual coverage work.
14. `docs/testing.md` roster update + DECISION-157 paragraph.
15. Report per-file durations in Phase 4 against the budget in Notes §9below.

## Notes

### 1. `e2e/support/db.ts`

```ts
/**
 * db.ts — the one place the e2e suite resolves the RLS-bypassing owner
 * connection string. Extracted from the three call sites that duplicated
 * this resolution+throw (statistics-submit.spec.ts, public-sites.spec.ts,
 * assert-fixture-invariants.ts) — `flags.ts` and `sasr-fixture.ts` both
 * depend on it, so a fourth and fifth copy would have appeared today
 * without this file.
 */
import { neon } from "@neondatabase/serverless";

export type Sql = ReturnType<typeof neon<false, false>>;

export function platformSql(specName: string): Sql {
  const url =
    process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
  if (!url) {
    throw new Error(
      `[${specName}] No platform database URL. Set PLATFORM_DATABASE_URL ` +
        `(or E2E_PLATFORM_DATABASE_URL) in .env.local — this spec writes ` +
        `through the RLS-bypassing owner connection, same as e2e/support/seed-orgs.ts.`,
    );
  }
  return neon(url);
}
```

### 2. `e2e/support/flags.ts`

```ts
import type { Sql } from "./db";

export async function getFlag(sql: Sql, key: string): Promise<boolean> {
  const rows = (await sql`select enabled from feature_flags where key = ${key}`) as {
    enabled: boolean;
  }[];
  if (rows.length === 0) throw new Error(`[flags] no feature_flags row for "${key}"`);
  return rows[0].enabled;
}

export async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void> {
  await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
}

export interface FlagCapture {
  values: Record<string, boolean>;
  /** Sets every captured flag back to its captured value, THEN re-reads each
   *  by SELECT and throws on any mismatch — never trusts the UPDATE alone
   *  (public-sites.spec.ts:300-307's own precedent). */
  restore(): Promise<void>;
}

export async function captureFlags(sql: Sql, keys: string[]): Promise<FlagCapture> {
  const values: Record<string, boolean> = {};
  for (const key of keys) values[key] = await getFlag(sql, key);
  return {
    values,
    async restore() {
      for (const key of keys) await setFlag(sql, key, values[key]);
      for (const key of keys) {
        const restored = await getFlag(sql, key);
        if (restored !== values[key]) {
          throw new Error(
            `[flags] restore verification failed for "${key}": expected ` +
              `${values[key]}, got ${restored} — the suite is leaving GLOBAL ` +
              `flag state wrong for every spec that runs after this one.`,
          );
        }
      }
    },
  };
}
```

Usage in every new spec's `beforeAll`/`afterAll`:

```ts
let flags: FlagCapture;
test.beforeAll(async () => {
  sql = platformSql("presbytery-oversight.spec");
  flags = await captureFlags(sql, ["org_portal.oversight"]);
  await setFlag(sql, "org_portal.oversight", true);
});
test.afterAll(async () => { await flags.restore(); });
```

### 3. `e2e/support/sasr-fixture.ts` — full design

```ts
import type { Sql } from "./db";

export const RESERVED_YEAR_MIN = 2090;
export const RESERVED_YEAR_MAX = 2099;

/**
 * Report years already claimed by other e2e specs, so the next pipeline
 * doesn't have to grep for them (Phase 2 ruling 2c). NOT an enforced
 * cross-file registry — enforcement is assertReservedYear()'s band check
 * below; this is a comment made a data structure so it stays current
 * instead of drifting across two file headers.
 */
export const CLAIMED_REPORT_YEARS: Record<string, number[]> = {
  "statistics-submit.spec.ts": [2091, 2092, 2093],
  "filings-round-trip.spec.ts": [2094],
};

function assertReservedYear(reportYear: number): void {
  if (
    !Number.isInteger(reportYear) ||
    reportYear < RESERVED_YEAR_MIN ||
    reportYear > RESERVED_YEAR_MAX
  ) {
    throw new Error(
      `[sasr-fixture] refusing report year ${reportYear}: e2e fixtures must ` +
        `use the reserved ${RESERVED_YEAR_MIN}-${RESERVED_YEAR_MAX} band ` +
        `(DECISION-157) — see CLAIMED_REPORT_YEARS for years already in use.`,
    );
  }
}

/** DECISION-157's mechanical guard: refuse any organization whose slug does
 *  not start with "e2e-". A guard is what would have prevented the Alder
 *  Creek incident; a comment would not have. */
async function assertE2EOrg(sql: Sql, organizationId: string): Promise<void> {
  const rows = (await sql`
    select slug from organizations where id = ${organizationId}::uuid
  `) as { slug: string }[];
  const slug = rows[0]?.slug;
  if (!slug || !slug.startsWith("e2e-")) {
    throw new Error(
      `[sasr-fixture] refusing to touch organization ${organizationId} ` +
        `(slug "${slug ?? "<none>"}") — sasr-fixture.ts only publishes or ` +
        `withdraws for e2e-* organizations (DECISION-157).`,
    );
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Stages a real, live publication chain for `congregationOrgId` at
 * `reportYear` — through the product's own `presby_publish_sasr_snapshot()`,
 * not a hand-rolled imitation of it (Phase 2 ruling 1a). Every SASR field
 * beyond the two required parameters defaults to null; this fixture stages
 * the presence of a filing, not its statistical content.
 *
 * ONE STATEMENT: `set_config('app.current_org_id', ...)` and the function
 * call live in the SAME `do $$ ... $$` block, because the neon() HTTP driver
 * gives every separate tagged-template call its own implicit transaction and
 * the GUC is transaction-local (seed-orgs.ts mechanic 2). The DO body is a
 * dollar-quoted string, so the ids/values below are inlined text, not bind
 * parameters — `congregationOrgId` is vetted by assertE2EOrg() first, and
 * `minuteReference` is escaped for embedded single quotes.
 *
 * The publication id is NOT returned by the DO block (PL/pgSQL DO blocks
 * cannot return a value) — it is read back in a SEPARATE, immediately
 * following SELECT, safe because the publish already committed (each
 * neon() call is its own transaction) and the read is scoped to exactly the
 * row this call just created (newest by published_at for this org+year).
 */
export async function stagePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number; minuteReference: string },
): Promise<{ publicationId: string }> {
  assertReservedYear(opts.reportYear);
  await assertE2EOrg(sql, opts.congregationOrgId);

  const safeMinute = escapeSqlLiteral(opts.minuteReference);
  await sql.query(`
    do $stage$
    begin
      perform set_config('app.current_org_id', '${opts.congregationOrgId}', true);
      perform presby_publish_sasr_snapshot(${opts.reportYear}, '${safeMinute}');
    end
    $stage$;
  `);

  const rows = (await sql`
    select p.id
      from publications p
      join statistical_returns sr
        on sr.id = p.artifact_id and sr.organization_id = p.organization_id
     where p.organization_id = ${opts.congregationOrgId}::uuid
       and p.record_class = 'statistical_return'
       and sr.report_year = ${opts.reportYear}
     order by p.published_at desc
     limit 1
  `) as { id: string }[];
  const publicationId = rows[0]?.id;
  if (!publicationId) {
    throw new Error(
      `[sasr-fixture] presby_publish_sasr_snapshot() reported success but no ` +
        `publications row was found for ${opts.congregationOrgId} / ${opts.reportYear}.`,
    );
  }
  return { publicationId };
}

/**
 * Removes a staged publication chain — the disable/delete/re-enable
 * discipline `statistics-submit.spec.ts:223-260` already established,
 * copied in shape and improved per F115 (verified re-enable, not merely
 * attempted). ONE `do $$ ... $$` block so a failing delete rolls the
 * disables back too. The `congregation_statistics` delete resolves its own
 * recipient (the presbytery) from the still-present `publications` row
 * rather than requiring a third parameter — the delete order (congregation_
 * statistics, then publications, then statistical_returns) keeps that row
 * available until it's no longer needed.
 */
export async function removePublishedReturn(
  sql: Sql,
  opts: { congregationOrgId: string; reportYear: number },
): Promise<void> {
  assertReservedYear(opts.reportYear);
  await assertE2EOrg(sql, opts.congregationOrgId);

  await sql.query(`
    do $cleanup$
    begin
      alter table congregation_statistics disable trigger congregation_statistics_freeze;
      alter table publications disable trigger publications_freeze;
      alter table statistical_returns disable trigger statistical_returns_freeze;

      delete from congregation_statistics
       where about_org_id = '${opts.congregationOrgId}'::uuid
         and year = ${opts.reportYear}
         and organization_id = (
           select recipient_org_id from publications
            where organization_id = '${opts.congregationOrgId}'::uuid
              and record_class = 'statistical_return'
              and artifact_id in (
                select id from statistical_returns
                 where organization_id = '${opts.congregationOrgId}'::uuid
                   and report_year = ${opts.reportYear}
              )
            limit 1
         );

      delete from publications
       where organization_id = '${opts.congregationOrgId}'::uuid
         and record_class = 'statistical_return'
         and artifact_id in (
           select id from statistical_returns
            where organization_id = '${opts.congregationOrgId}'::uuid
              and report_year = ${opts.reportYear}
         );

      delete from statistical_returns
       where organization_id = '${opts.congregationOrgId}'::uuid
         and report_year = ${opts.reportYear};

      alter table statistical_returns enable trigger statistical_returns_freeze;
      alter table publications enable trigger publications_freeze;
      alter table congregation_statistics enable trigger congregation_statistics_freeze;
    end
    $cleanup$;
  `);
  // Defensive belt, not the primary mechanism — idempotent regardless of
  // whether the DO block's own re-enables above already ran.
  await sql`alter table statistical_returns enable trigger statistical_returns_freeze`;
  await sql`alter table publications enable trigger publications_freeze`;
  await sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`;

  // F115: VERIFY the final state rather than trust the enables above ran.
  const rows = (await sql`
    select c.relname as table_name, t.tgenabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where t.tgname in (
       'congregation_statistics_freeze', 'publications_freeze', 'statistical_returns_freeze'
     )
  `) as { table_name: string; tgenabled: string }[];
  const notEnabled = rows.filter((r) => r.tgenabled !== "O");
  if (notEnabled.length > 0) {
    throw new Error(
      `[sasr-fixture] teardown left ${notEnabled.length} freeze trigger(s) ` +
        `disabled: ${notEnabled.map((r) => r.table_name).join(", ")}. ` +
        `Append-only enforcement is OFF on shared tables until this is fixed by hand.`,
    );
  }
}
```

### 4. Three new fixture actors — exact appended diffs

**`e2e/support/users.ts`** — widen the union and add three `E2EUser` entries
(no platform `roleName`, matching the `org-*` fixtures' shape):

```ts
export type E2ERole =
  | "admin" | "member" | "mfa-admin" | "mfa-enrolled"
  | "org-single" | "org-multi" | "org-unmanaged" | "org-ended"
  | "presbytery-clerk" | "presbytery-nogrant" | "congregation-clerk";
```

```ts
"presbytery-clerk": {
  role: "presbytery-clerk",
  email: "presbytery-clerk@presby.invalid",
  password: FIXTURE_PASSWORD,
  name: "E2E Presbytery Clerk",
  roleName: null,
  twoFactorRequired: false,
},
"presbytery-nogrant": {
  role: "presbytery-nogrant",
  email: "presbytery-nogrant@presby.invalid",
  password: FIXTURE_PASSWORD,
  name: "E2E Presbytery No Grant",
  roleName: null,
  twoFactorRequired: false,
},
"congregation-clerk": {
  role: "congregation-clerk",
  email: "congregation-clerk@presby.invalid",
  password: FIXTURE_PASSWORD,
  name: "E2E Congregation Clerk",
  roleName: null,
  twoFactorRequired: false,
},
```

**`e2e/support/seed-orgs.ts`**:

1. Widen `FIXTURE_PEOPLE`'s `role` field type to
   `Extract<E2ERole, "org-single" | "org-multi" | "org-unmanaged" | "org-ended" | "presbytery-clerk" | "presbytery-nogrant" | "congregation-clerk">`
   and append three entries (ids continue the `...0000000000aN` series per
   architect ruling 2a):

```ts
{ id: "e2e00000-0000-0000-0000-0000000000a5", role: "presbytery-clerk",    firstName: "Perpetua", lastName: "Winlock" },
{ id: "e2e00000-0000-0000-0000-0000000000a6", role: "presbytery-nogrant",  firstName: "Cassius",  lastName: "Brightwell" },
{ id: "e2e00000-0000-0000-0000-0000000000a7", role: "congregation-clerk",  firstName: "Ottoline", lastName: "Fairweather" },
```

2. Add three rows to the existing `firstMemberships` array (each is that
   person's FIRST and only relationship, so the plain `INSERT ... WHERE NOT
   EXISTS` shape applies — no `app.person_claim_authorized` DO block needed,
   that mechanic is only for org-multi's SECOND membership):

```ts
[FIXTURE_PEOPLE_A5.id, E2E_ORGS.presbytery.id, null], // presbytery-clerk
[FIXTURE_PEOPLE_A6.id, E2E_ORGS.presbytery.id, null], // presbytery-nogrant
[FIXTURE_PEOPLE_A7.id, E2E_ORGS.alpha.id,      null], // congregation-clerk
```

3. A new **APPENDED BLOCK**, in the same shape and in the same place as the
   existing "statistics submission grants" block, after it:

```ts
// ---------------------------------------------------------------------
// APPENDED BLOCK — presbytery-portal e2e coverage (2026-09-28-presbytery-e2e,
// DECISION-157). Two fresh, org-scoped app_roles, mirroring the existing
// e2e_statistics_manage precedent immediately above — never a template
// adoption (assertPermissionSubset() blocks adopting congregation_stated_
// clerk for statistics.publish, docs/TODO.md:120).
// ---------------------------------------------------------------------
const PRESBYTERY_CLERK_ROLE_ID = "e2e00000-0000-0000-0000-0000000000b2";
await sql`
  INSERT INTO app_roles (id, organization_id, key, name, role_kind, is_protected)
  VALUES (${PRESBYTERY_CLERK_ROLE_ID}::uuid, ${E2E_ORGS.presbytery.id}::uuid,
          'e2e_presbytery_clerk', 'E2E Presbytery Clerk', 'custom', false)
  ON CONFLICT (id) DO NOTHING
`;
for (const key of ["congregation_oversight.manage", "per_capita.manage", "credentials.manage", "statistics.manage"]) {
  await sql`
    INSERT INTO app_role_permissions (role_id, permission_key)
    VALUES (${PRESBYTERY_CLERK_ROLE_ID}::uuid, ${key})
    ON CONFLICT DO NOTHING
  `;
}
await sql`
  INSERT INTO role_grants (organization_id, role_id, person_id, starts_on, granted_by)
  SELECT ${E2E_ORGS.presbytery.id}::uuid, ${PRESBYTERY_CLERK_ROLE_ID}::uuid,
         ${FIXTURE_PEOPLE_A5.id}::uuid, DATE '2020-01-01', ${adminUserId}::uuid
   WHERE NOT EXISTS (
     SELECT 1 FROM role_grants
      WHERE person_id = ${FIXTURE_PEOPLE_A5.id}::uuid
        AND organization_id = ${E2E_ORGS.presbytery.id}::uuid
        AND role_id = ${PRESBYTERY_CLERK_ROLE_ID}::uuid
   )
`;

const STATISTICS_PUBLISH_ROLE_ID = "e2e00000-0000-0000-0000-0000000000b3";
await sql`
  INSERT INTO app_roles (id, organization_id, key, name, role_kind, is_protected)
  VALUES (${STATISTICS_PUBLISH_ROLE_ID}::uuid, ${E2E_ORGS.alpha.id}::uuid,
          'e2e_statistics_publish', 'E2E Statistics Publisher', 'custom', false)
  ON CONFLICT (id) DO NOTHING
`;
await sql`
  INSERT INTO app_role_permissions (role_id, permission_key)
  VALUES (${STATISTICS_PUBLISH_ROLE_ID}::uuid, 'statistics.publish')
  ON CONFLICT DO NOTHING
`;
await sql`
  INSERT INTO role_grants (organization_id, role_id, person_id, starts_on, granted_by)
  SELECT ${E2E_ORGS.alpha.id}::uuid, ${STATISTICS_PUBLISH_ROLE_ID}::uuid,
         ${FIXTURE_PEOPLE_A7.id}::uuid, DATE '2020-01-01', ${adminUserId}::uuid
   WHERE NOT EXISTS (
     SELECT 1 FROM role_grants
      WHERE person_id = ${FIXTURE_PEOPLE_A7.id}::uuid
        AND organization_id = ${E2E_ORGS.alpha.id}::uuid
        AND role_id = ${STATISTICS_PUBLISH_ROLE_ID}::uuid
   )
`;
```

`presbytery-nogrant` (a6) gets NO `app_roles`/`role_grants` row at all — the
membership alone is the fixture (Gap 2's "state 3" denial for all three
presbytery surfaces at once).

**Why no new organization fixture:** `e2e-presbytery` and `e2e-alpha` already
exist, are already affiliated (alpha's parent is presbytery), and the
credentials person-picker (`getCredentialsFormOptions()`) queries
`memberships.organizationId = <the presbytery itself>` — so `presbytery-
clerk`/`presbytery-nogrant`'s own memberships AT `e2e-presbytery` (not at a
member congregation) make them valid ordination/appointment candidates for
each other's credentials tests, with zero additional fixture rows. This was
confirmed by reading `src/lib/credentials.ts`'s `getCredentialsFormOptions()`
rather than assumed — the same discipline F114 exists to enforce elsewhere.

### 5. `presbytery-oversight.spec.ts`

No `describe.serial` (cases are independent — `workers: 1` already makes
order deterministic). Flag capture: `["org_portal.oversight"]`.

| # | Actor | URL | Action | Anchor asserted visible | Sibling anchor asserted absent | Audit checked |
|---|---|---|---|---|---|---|
| 1 | `presbytery-clerk` | `/o/e2e-presbytery/admin/oversight` | none (list read) | Table with "Congregation" header, `e2e-alpha`/`beta`/`gamma` rows | `OversightForbidden`'s "don't have permission" text | — |
| 2 | `presbytery-clerk` | `/o/e2e-presbytery/admin/oversight/<e2e-alpha id>` | fills `#oversight-viability`=2, `#oversight-buildings`, `#oversight-insurance-carrier`, `#oversight-insurance-expires`, clicks "Save" | toast "Oversight record saved." then re-fetch: list row's badge changed from "Not yet assessed" to "Fair" | — | `select * from audit_events where action = 'congregation_oversight.set' and resource_id = <e2e-alpha id> order by created_at desc limit 1` on the owner connection — assert row exists, `actor_user_id` matches `presbytery-clerk`'s user id, `metadata->>'organizationId'` = e2e-presbytery.id |
| 3 | `presbytery-nogrant` | `/o/e2e-presbytery/admin/oversight` | none | `OversightForbidden`'s "You don't have permission to manage congregation oversight records at Presbytery of the Eastern Fells" | the Table (no rows, no headers) | — |
| 4 | `org-single` (existing fixture, at `e2e-alpha`, a congregation) | `/o/e2e-alpha/admin/oversight` | none | `PlaceholderNotAvailable`'s "isn't the kind of organization this tool is built for" | `OversightForbidden`'s copy | — |
| 5 | `presbytery-clerk`, with `org_portal.oversight` flipped off for the duration of this one test | `/o/e2e-presbytery/admin/oversight` | none | `PlaceholderFlagOff`'s "isn't turned on for Presbytery of the Eastern Fells yet" | `OversightForbidden`'s copy | — |
| 6 (360px) | `presbytery-clerk`, 360×800 viewport | `/o/e2e-presbytery/admin/oversight/<e2e-alpha id>` | operate the `#oversight-viability` select and the "Save" button at 360px | toast "Oversight record saved." | — | — |

**Failing-first demonstration (Implementation Order step 6):** case 3 written
first against `presbytery-clerk` fails (sees the form) — confirms the test
would catch a regression that accidentally granted everyone access — then
re-pointed at `presbytery-nogrant` and passes.

### 6. `presbytery-credentials.spec.ts`

Same shape as oversight, one more permission key
(`org_portal.credentials`/`credentials.manage`), and `CredentialsFlagOff`/
`CredentialsNotAvailable`/`CredentialsForbidden` per `credentials-states.tsx`.

| # | Actor | URL | Action | Anchor visible | Sibling absent | Audit checked |
|---|---|---|---|---|---|---|
| 1 | `presbytery-clerk` | `/o/e2e-presbytery/admin/credentials` | fills `#ordination-person` (select `presbytery-nogrant`'s person, Cassius Brightwell — a real membership-at-this-org candidate per Notes §4), `#ordination-ministry`, `#ordination-ordained-on`, `#ordination-minute-reference`; clicks "Record ordination" | toast success, `OrdinationList` shows a new row for "Cassius Brightwell" | — | `audit_events` action `ordination.recorded`, `resource_type = 'ordination'`, `actor_user_id` = presbytery-clerk's user id |
| 2 | `presbytery-clerk` | same page | fills `#appointment-person` (a candidate person), `#appointment-serving-org` = e2e-alpha, `#appointment-call-type`, `#appointment-starts-on`, `#appointment-minute-reference`; clicks "Record appointment" | `AppointmentList` shows the new row | — | `audit_events` action `appointment.recorded` |
| 3 | `presbytery-clerk` | same page | clicks "End appointment" on the row from case 2, confirms in the `AlertDialog` | row shows ended | active-appointment badge absent | `audit_events` action `appointment.ended` |
| 4 | `presbytery-nogrant` | `/o/e2e-presbytery/admin/credentials` | none | `CredentialsForbidden`'s "You don't have permission to manage ministry credentials" | `CredentialsFlagOff`/`CredentialsNotAvailable` copy | — |
| 5 | `org-single` at `e2e-alpha` | `/o/e2e-alpha/admin/credentials` | none | `CredentialsNotAvailable`'s "isn't available for … this is a presbytery-level tool" | `CredentialsForbidden` copy | — |
| 6 | `presbytery-clerk`, `org_portal.credentials` flipped off | `/o/e2e-presbytery/admin/credentials` | none | `CredentialsFlagOff`'s "isn't turned on for" | `CredentialsForbidden`/`CredentialsNotAvailable` copy | — |
| 7 (360px) | `presbytery-clerk`, 360×800 | same page | operate `#ordination-person` and "Record ordination" at 360px | toast success | — | — |

Flag capture: `["org_portal.credentials"]`.

**Failing-first demonstration:** case 4 written first against
`presbytery-clerk` (fails — sees the form), then against `presbytery-
nogrant` (passes).

### 7. `presbytery-reports.spec.ts`

`describe.serial` — rate → generate → payment is a real dependency chain,
and the split-permission case depends on `org-multi`'s existing
`e2e_statistics_manage` role staying at exactly one permission (ruling 2b).
Flag capture: `["org_portal.reports", "statistics.submission_grants"]`
(the third section's own flag, so this file never assumes the shared dev
branch's current OFF state for it). This file uses a report year in the
reserved band for its own `congregation_statistics` write — **2095** — and
its own spec-local (not `sasr-fixture.ts`-exported) disable/delete/enable
helper scoped to `congregation_statistics_freeze` ONLY, because the
`presbytery_entered` provenance path never creates a `publications`/
`statistical_returns` row (confirmed by reading `setCongregationStatistics()`
— it does one explicit-column `INSERT` into `congregation_statistics` and
nothing else). Growing `sasr-fixture.ts` to cover a table it was not
designed around would blur its one job (the publish/withdraw chain); a
five-line spec-local helper, copying the same three-statement disable/
delete/enable shape, is cheaper and keeps the shared module's scope exactly
what Phase 2 approved. Per-capita's own tables (`per_capita_rates`,
`per_capita_records`, `per_capita_payments`) carry NO freeze trigger
(confirmed by grep) — plain deletes in `afterAll`.

| # | Actor | URL | Action | Anchor visible | Sibling absent | Audit checked |
|---|---|---|---|---|---|---|
| 1 | `presbytery-clerk` | `/o/e2e-presbytery/admin/reports?year=2095` | fills `#stats-congregation`=e2e-alpha, `#stats-year`=2095, `#stats-minute-reference`, clicks "Save statistics" | `StatisticsTable` shows e2e-alpha with a "Presbytery estimate" badge | — | `audit_events` action `congregation_statistics.entered` |
| 2 | `presbytery-clerk` | `/o/e2e-presbytery/admin/reports?billingYear=2095` | fills `#rate-basis-year`, `#rate-per-member`, clicks "Save rate for 2095" | toast success, rate shown | — | `audit_events` action `per_capita.rate_set` |
| 3 | `presbytery-clerk` (same page, same `describe.serial` block) | same URL | clicks "Generate 2095 records" | toast "Generated N record(s)." | — | `audit_events` action `per_capita.records_generated` |
| 4 | `presbytery-clerk` | same URL | fills `#payment-record`, `#payment-amount`, `#payment-date`, clicks "Record payment" | toast success, `PerCapitaRecordsTable` row shows paid | — | `audit_events` action `per_capita.payment_recorded` |
| 5 | `org-multi` (existing fixture, holds `e2e_statistics_manage` = `statistics.manage` only, at `e2e-presbytery`) | `/o/e2e-presbytery/admin/reports` | none | "Congregation Statistics" section renders its table/form live | `ReportsSectionForbidden section="per-capita billing"` IS visible (asserted present, proving the split) AND the per-capita form fields are absent | — |
| 6 | `presbytery-nogrant` | `/o/e2e-presbytery/admin/reports` | none | `ReportsSectionForbidden section="statistics"` AND `section="per-capita billing"` both visible | the statistics/per-capita forms absent | — |
| 7 | `org-single` at `e2e-alpha` | `/o/e2e-alpha/admin/reports` | none | `PlaceholderNotAvailable` | `ReportsSectionForbidden` copy | — |
| 8 | `presbytery-clerk`, `org_portal.reports` flipped off | `/o/e2e-presbytery/admin/reports` | none | `PlaceholderFlagOff` | any section heading | — |
| 9 | `presbytery-clerk`, `statistics.submission_grants` flag OFF (reports flag stays ON) | `/o/e2e-presbytery/admin/reports` | none | "Submission grants aren't turned on for Presbytery of the Eastern Fells yet." | `IssueGrantForm`/`GrantsTable` | — |
| 10 (360px) | `presbytery-clerk`, 360×800 | `/o/e2e-presbytery/admin/reports?year=2095` | operate `#stats-congregation` and "Save statistics" | toast success | — | — |

Flow 3 (submission grants issue/revoke, live and anonymous-submit) is
**cross-referenced, not re-covered** — case 9 above only proves the third
section's OWN flag-off state, which `statistics-submit.spec.ts` does not
assert (that spec always runs with the flag on).

**Failing-first demonstration:** case 5's `ReportsSectionForbidden` assertion
written first against a HYPOTHETICAL role holding both permissions (i.e.
confirm the test fails if `e2e_statistics_manage` is accidentally widened) —
recorded as a one-line note in the spec's own header rather than literally
mutating the shared fixture role mid-development, since that role is shared
production-fixture-of-record for `statistics-submit.spec.ts` too and must
never be left in a widened state.

### 8. `filings-round-trip.spec.ts` — the round trip

`describe.serial`. Uses `sasr-fixture.ts`'s `stagePublishedReturn`/
`removePublishedReturn` at **report year 2094** (added to
`CLAIMED_REPORT_YEARS`). Flag capture: `["org_portal.filings"]`. Alder
Creek's real 2025 publication is never touched (DECISION-157, ruling 3/4) —
`beforeAll` stages a fresh chain at `e2e-alpha` instead, and both `beforeAll`
and `afterAll` call `assertNoStrayFixtureReturns()`/
`assertSeedPublicationsIntact()`.

| # | Actor | URL | Action | Anchor visible | Sibling absent | Audit checked |
|---|---|---|---|---|---|---|
| 1 (setup, not a `test()`) | — | — | `stagePublishedReturn({ congregationOrgId: e2e-alpha.id, reportYear: 2094, minuteReference: "Session minutes, e2e fixture" })` | — | — | — |
| 2 | `presbytery-clerk` | `/o/e2e-presbytery/admin/credentials` **attempting to withdraw** (there is no such control — this case asserts its ABSENCE, per Flow 5's named failure gap) | none | the presbytery has no Withdraw affordance anywhere in its own tree (grep-level: no `WithdrawDialog` import outside `admin/filings/`) | — | — |
| 3 | `congregation-clerk` | `/o/e2e-alpha/admin/filings` | none (list read) | `FilingsTable` row for 2094, "Current" badge, a "Withdraw" button | `FilingsSectionForbidden` copy | — |
| 4 | `presbytery-nogrant` (wrong actor entirely — no relationship at e2e-alpha) | `/o/e2e-alpha/admin/filings` | none | `OrgAccessDenied`'s byte-identical "you don't have access to" copy (DECISION-040 axis, not the permission axis — `presbytery-nogrant` has no membership at e2e-alpha at all) | — | — |
| 5 | `congregation-clerk` | `/o/e2e-alpha/admin/filings` | clicks "Withdraw", fills minute reference, confirms | toast "2094 filing withdrawn.", row now shows "Withdrawn" badge + date + minute reference, Withdraw button gone | — | `audit_events` action `statistics_return.withdrawn`, `resource_id` = the publication id, `metadata->>'aboutOrgId'` = e2e-alpha.id, `metadata->>'recipientOrgId'` = e2e-presbytery.id |
| 6 | `congregation-clerk` (same publication, already withdrawn) | same page | attempt to withdraw the SAME row again — no longer possible via the button (it's gone); instead, re-verify by re-loading | Withdraw button absent, "Withdrawn" badge persists | — | — |
| 7 | `presbytery-clerk` | `/o/e2e-presbytery/admin/reports?year=2094` | none | e2e-alpha's row shows badge "No data on file" (the withdrawn return is excluded from the "current" rollup — `presbytery.ts`'s `isNull(congregationStatistics.withdrawnAt)` WHERE clause) | "Congregation reported" badge | — |
| 8 | `presbytery-clerk` | `/o/e2e-presbytery/admin/reports/<e2e-alpha id>` | none | `FilingHistoryTable` shows the 2094 row with a "Withdrawn" badge, never deleted | a "Congregation reported"/live badge on that same row | — |
| 9 (360px) | `congregation-clerk`, 360×800 (staged BEFORE case 5, i.e. this is really case 5 rehearsed at 360px on a SECOND staged year — see Edge Cases) | `/o/e2e-alpha/admin/filings` | `scrollIntoViewIfNeeded()` on the Withdraw button, then withdraw | toast success | — | — |

Case 9's `known-issue` annotation (per architect Notes §5):

```ts
test.info().annotations.push({
  type: "known-issue",
  description:
    "docs/TODO.md withdraw residual (2) — Withdraw sits inside the table " +
    "scroller at 360px; asserted positively (scrollWidth > clientWidth) and " +
    "operated via scrollIntoViewIfNeeded(), not skipped.",
});
expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
```

Because case 9 exercises a real withdraw of its own row, it needs its OWN
staged publication (2094 is spent by case 5) — see Edge Cases below for the
exact resolution (a second report year, 2096, staged specifically for the
360px pass, OR restructure case 9 to run BEFORE case 5 against the SAME row
and let case 5 become the desktop-viewport repeat against a SECOND row).
**Decision, made here rather than left to Phase 4:** stage TWO rows in
`beforeAll` — 2094 (desktop, case 5) and 2096 (mobile, case 9) — both added
to `CLAIMED_REPORT_YEARS`, both removed in `afterAll`. This avoids
restructuring the serial order for a viewport concern.

**Failing-first demonstration:** case 4 written first with
`presbytery-nogrant` granted a (deliberately wrong, for the demonstration
only) direct membership at `e2e-alpha` to confirm the test would fail if
`resolveOrgContext()`'s relationship check were broken — then reverted to the
real fixture shape (no membership) before commit, since `presbytery-nogrant`
having a real second membership would itself be a fixture-shape regression
(Gap 2's contract is "no relationship, no grant" at the presbytery only).

### 9. `withdrawFiling`'s refusal copy — resolving the Phase 1 open question

Read `src/lib/filings.ts` and `admin/filings/actions.ts` directly. The two
refusal kinds surface as **toast copy** (`sonner`), not page copy, via
`withdrawFilingAction`'s switch:

- `already_withdrawn` → `"This filing has already been withdrawn."`
- `superseded` → `"A newer filing supersedes this one — only the current filing can be withdrawn."`
- `invalid_target` → `"That filing can't be withdrawn. Refresh the page and try again."` (the ONE uniform literal for not-found/wrong-org/wrong-record-class/non-member-actor — DECISION-152's enumeration-safety collapse; a spec must never try to distinguish these four by copy, only assert this one string)
- `forbidden` → `"You don't have permission to withdraw filings here."`

The round trip does not need to exercise `already_withdrawn`/`superseded`
directly (case 6 above proves the UI-level guard — no button once
withdrawn — which is the state a real clerk can reach; reaching the toast
copy requires a second browser tab racing the same row, out of scope per
Phase 1's own framing of this as a completeness question, not a required
case). **Ruling: assert the button's absence (case 6), not the toast copy,
as the primary regression guard** — the toast is dead code from the UI's own
perspective once the button is gone, and asserting it would require an
artificial direct-action-call bypass this pipeline's invariants forbid.

### 10. The four rotten-spec fixes

**`post-login-routing.spec.ts:110` and `:166`** — stale pre-`home_v2`
copy. Implementer reads the current `/home` chooser copy (post
`org_portal.home_v2`) and updates both assertions to match; no fixture or
flag change, a pure text-assertion fix. Root cause: `home_v2` shipped and
these two assertions were never updated.

**`header-controls.spec.ts:110`** — flaky arrow-key focus case. Root cause to
diagnose in Phase 4 (likely a race between the menu's open animation and the
first `ArrowDown` keypress); fix by waiting on a stable signal (the menu
item's `aria-expanded`/focus state) rather than a fixed timeout. Regression
test: run the fixed case 20x locally (`--repeat-each=20`) and confirm zero
flakes before considering it closed.

**`public-sites.spec.ts` (F114)** — fix case 2's staged bundle to the real
v4 block shape, verified against `node_modules/presby-site-kit/dist/blocks.js`
rather than assumed (the exact mistake that rotted it the first time).
Verified live: `BLOCK_REGISTRY` keys are **lowercase** (`hero`, `prose`, not
`Hero`/`Prose` — the kickoff's own phrasing would have re-introduced F114's
root cause had it been followed literally). `renderHeroBlock()` requires a
non-empty `heading` (from `props.heading` or `slides[0].heading`) and renders
it into a real `<h1>`; `renderProseBlock()` requires a non-empty `body`
string and renders it via `renderMarkdown()`. New staged bundle:

```ts
const bundle = {
  schemaVersion: 1,
  pages: [{
    path: "/",
    frontMatter: { title: TEST_TITLE }, // kept for metadata/SEO use elsewhere; NOT what v4 renders as the h1
    mdxAst: {
      blocks: [
        { type: "hero", props: { heading: TEST_TITLE } },
        { type: "prose", props: { body: "Real staged prose content for the e2e spec." } },
      ],
    },
  }],
  imageKeys: {},
};
```

Case 2's assertions become: `getByRole("heading", { level: 1, name: TEST_TITLE })`
(now genuinely rendered by `Hero`'s own `<h1>`, not `frontMatter.title`) and
`getByText("Real staged prose content for the e2e spec.")` replacing the dead
`"Content coming soon."` assertion (confirmed via `grep` to no longer exist
in the package). Add a header comment naming the pinned version this spec was
verified against (`presby-site-kit@4.0.0`) so a future major-version rot is
at least documented, per the architect's mitigation note — this does not
prevent a future v5 rot, it only shortens the next diagnosis.

## Findings ruled on

- **F113** — in scope, fixed here (Notes §11 below).
- **F114** — in scope, fixed here (Notes §10 above), as spec rot per the
  architect's diagnosis; `docs/TODO.md`'s "resolves on merge via PR #17" line
  is corrected at integration.
- **F115** — in scope, fixed here: `sasr-fixture.ts`'s `removePublishedReturn()`
  ends with the `pg_trigger.tgenabled = 'O'` verification (Notes §3).

## 11. `e2e.yml` — the one-line fix (F113)

```diff
             echo "PLATFORM_DATABASE_URL=${{ steps.db.outputs.platform_database_url }}"
             echo "MIGRATE_DATABASE_URL=${{ steps.db.outputs.migrate_database_url }}"
+            echo "E2E_DATABASE_URL=${{ steps.db.outputs.app_database_url }}"
             echo "AUTH_SECRET=$(openssl rand -base64 32)"
```

Placed in the same `{ … } >> .env.local` block, using the guard's own Step A
("a dedicated Neon branch connection string") rather than
`E2E_ALLOW_SHARED_DB=true` (architect's reasoning: the latter would suppress
the guard for a genuinely shared URL later, and none exists here to
acknowledge). No other `e2e.yml` change.

## 12. `docs/testing.md` — proposed additions (this file IS editable on this branch)

Append three rows to the Accounts table:

```
| `presbytery-clerk@presby.invalid` | Perpetua Winlock, e2e-presbytery — holds `e2e_presbytery_clerk` (`congregation_oversight.manage`, `per_capita.manage`, `credentials.manage`, `statistics.manage`) | `/o/e2e-presbytery` |
| `presbytery-nogrant@presby.invalid` | Cassius Brightwell, e2e-presbytery — a relationship with NO grant, the "state 3" denial fixture | `/o/e2e-presbytery` |
| `congregation-clerk@presby.invalid` | Ottoline Fairweather, e2e-alpha — holds `e2e_statistics_publish` (`statistics.publish`) | `/o/e2e-alpha` |
```

And a short paragraph after the Organizations table:

> **DECISION-157** governs which fixtures an e2e spec may mutate: any seeded
> row may be READ, but only Playwright-owned rows (`e2e-*` slugs,
> `@presby.invalid` emails, SASR report years 2090–2099, `app_roles` keyed
> `e2e_*`) may be created, mutated, or deleted. `scripts/seed-dev.sql`'s own
> fixtures (Alder Creek, Northern Reach, etc.) are shaped to exercise
> specific findings and `scripts/test-rls.sql` assertions — mutating them
> from a spec has broken the isolation suite once already. The one
> documented exception is `public-sites.spec.ts`, tracked as a migration
> follow-up in `docs/TODO.md`, not treated as precedent.

## Edge Cases & Risks

- **`filings-round-trip.spec.ts` needs TWO staged report years** (2094
  desktop, 2096 mobile) because case 5 spends the only staged row on a real
  withdrawal before case 9's 360px pass would otherwise need one. Both are
  staged in `beforeAll` and removed in `afterAll`; both added to
  `CLAIMED_REPORT_YEARS`.
- **`presbytery-reports.spec.ts`'s split-permission case (case 5) depends on
  `org-multi`'s `e2e_statistics_manage` role NEVER gaining a second
  permission** — any future pipeline touching that role must re-read this
  file's rationale first. Flagged in the role's own comment in `seed-orgs.ts`
  already; no new comment needed, just don't violate the existing one.
- **`presbytery-credentials.spec.ts`'s ordination/appointment picker draws
  candidates from memberships AT THE PRESBYTERY ITSELF**, not at member
  congregations — a future reader who assumes otherwise (as the kickoff's
  own phrasing implicitly did) will build a fixture in the wrong place. This
  is why `presbytery-clerk`/`presbytery-nogrant` deliberately have
  memberships at `e2e-presbytery`, not at `e2e-alpha`.
- **The four new spec files' flag captures are file-scoped, not suite-wide**
  — if two of these four files were ever run with `--workers > 1` (they are
  not, `playwright.config.ts` pins `workers: 1`), their flag captures could
  race. Documented, not fixed, because the existing config already prevents it.
  A future change to `workers` must re-examine every capture/restore pair in
  the suite, not just these four files.
- **`removePublishedReturn()`'s congregation_statistics delete resolves its
  recipient via a subquery on the not-yet-deleted `publications` row** — if
  the delete order in that function is ever reordered (publications before
  congregation_statistics), the subquery returns nothing and the
  congregation_statistics row silently survives. The three-statement order
  inside the one `do $$` block is load-bearing; a future editor should not
  "simplify" it without re-reading this note.
- **`e2e/support/assert-fixture-invariants.ts`'s two new guards run on the
  OWNER connection**, same justification as the existing
  `assertAdminFixtureHasNoOrgs()` — they must be called from each new spec's
  own `beforeAll`/`afterAll`, not folded into `globalSetup` (architect ruling
  8, endorsing orchestrator practice).
- **Existing e2e blast radius** (per CLAUDE.md's Phase 3 requirement): this
  pipeline's NEW specs assert behavior no *existing* spec currently asserts,
  so there is no existing-spec breakage risk from the four new files
  themselves. The four ROTTEN-SPEC FIXES are the actual blast-radius
  surface:
  - `post-login-routing.spec.ts` — fixing the two stale assertions changes
    only those two `expect()` calls; no other spec references `/home`'s
    copy.
  - `header-controls.spec.ts` — the flakiness fix changes timing/waiting
    logic only, not the assertion itself; no behavior change for other specs.
  - `public-sites.spec.ts` — case 2's assertions change (F114); cases 1,
    3–7 are unaffected (they don't depend on the bundle's rendered body).
    **Grep confirms no other spec file references `public-sites.spec.ts`'s
    `TEST_TITLE`/`TEST_MARKER` constants or Alder Creek's `organization_sites`
    row**, so this fix's blast radius is contained to its own file.
  - The `flags.ts` extraction (step 13, last commit) changes
    `statistics-submit.spec.ts`'s imports only, not its behavior — its own
    `getFlag`/`setFlag` bodies are byte-identical to the extracted versions.
    Run the full existing spec once more after this extraction, specifically
    watching `statistics-submit.spec.ts`, before considering Phase 4 done.

## Out of Scope

- Re-covering Flow 3 (submission grant issue/revoke/anonymous-submit) —
  `statistics-submit.spec.ts` already covers it fully; only case 9 of
  `presbytery-reports.spec.ts` (the third section's own flag-off state) is new.
- Building the congregation's self-service "publish" page
  (`org_portal.statistical_publication`) — publish stays staged via
  `sasr-fixture.ts`, never browsed.
- Unit/DB-backed vitest coverage of `presbytery.ts`/`credentials.ts`/
  `filings.ts` — already exists.
- The committees stub and visual-regression snapshots.
- Investigating `header-controls.spec.ts:110`'s flakiness beyond a
  proportionate fix — if the root cause turns out to be a real product race
  condition (not a test-timing issue), that becomes its own bug-fix pipeline
  and this pipeline documents the finding rather than absorbing the fix.
- Migrating `public-sites.spec.ts` off Alder Creek onto an `e2e-*` org — a
  `docs/TODO.md` follow-up, not this pipeline's work.
- Any change to `workers`/`fullyParallel` in `playwright.config.ts`.

## Proposed `docs/TODO.md` lines (orchestrator applies at integration)

- Move to Done: "Four pre-existing e2e failures" (with the F114 correction:
  `public-sites.spec.ts:334` was NOT fixed by PR #17; fixed here as spec rot).
- Move to Done (if step 13 lands): "extract `getFlag`/`setFlag` onto
  `e2e/support/flags.ts`."
- Add: "migrate `public-sites.spec.ts` off `scripts/seed-dev.sql`'s Alder
  Creek fixture onto an `e2e-*` org with a `tickets.file` holder" (carried
  from Phase 2, unchanged).
- Add: "consider splitting `e2e/support/seed-orgs.ts` into orgs/people/
  memberships vs roles/grants" (carried from Phase 2, unchanged, now four
  appended blocks instead of three).
- Add (new, from this pipeline): "if `header-controls.spec.ts`'s flakiness
  fix in Phase 4 reveals a real product race condition rather than a test-
  timing issue, file it as its own bug-fix pipeline."

## Decision adopted verbatim

**DECISION-157 — e2e specs mutate only Playwright-owned fixtures.**

> An end-to-end spec may **read** any seeded row. It may **create, mutate or
> delete** only rows it created itself or rows in the Playwright-owned
> namespace: organization slugs prefixed `e2e-`, user emails at
> `@presby.invalid`, SASR report years in the reserved 2090–2099 band, and
> `app_roles` keyed `e2e_*`. Mutation helpers in `e2e/support/` enforce this
> with an assert-and-throw guard in the shape of `seed-orgs.ts`'s
> `assertFixtureShape()` — the rule is a guard, not a comment, because the
> failure it prevents has already happened once. A manual browser rehearsal
> counts as a spec for this purpose: it consumes the same single-use rows.
> `scripts/seed-dev.sql` is shaped to exercise specific findings
> (`scripts/test-rls.sql` asserts against Alder Creek's single publication by
> id), so a spec that writes to it damages the isolation suite, not merely
> itself. One documented exception exists — `public-sites.spec.ts`, which
> mutates Alder Creek's `organization_sites` because `elder.fixture` is the
> only sign-in-capable `tickets.file` holder — carried with a migration
> follow-up, not treated as precedent.

## Run-time budgets and command line

| File | Budget (local, `workers: 1`) |
|---|---|
| `presbytery-oversight.spec.ts` | ≤ 60s (6 cases, no serial chain) |
| `presbytery-credentials.spec.ts` | ≤ 75s (7 cases) |
| `presbytery-reports.spec.ts` | ≤ 90s (10 cases, one serial chain) |
| `filings-round-trip.spec.ts` | ≤ 90s (9 cases, one serial chain, two staged rows) |
| Total added | ≤ 5 min |
| Full local suite | ≤ 12 min |
| CI ceiling (30 min job, retries: 1) | clean run ≤ 15 min |

Command line for every local run this pipeline performs:

```bash
E2E_BASE_URL=http://localhost:3600 PORT=3600 npm run test:e2e -- --workers=1
```

The implementer reports actual per-file durations in Phase 4; QA records them
in Phase 5. If a file exceeds budget, fold assertions into fewer navigations
rather than deleting coverage (architect's own instruction, Notes §3).

## Implementer

**full-stack-developer** — the work is spec assertions plus owner-connection
SQL fixture staging, spanning the browser and the database with zero product
code, matching neither `ux-developer` nor `api-developer` cleanly, and small
enough (four spec files + three support modules + one CI line + two doc
files) that splitting adds coordination overhead without a corresponding
benefit — per the Phase 4 selection table's "small/coupled" criterion.

## Handoff

**Next: full-stack-developer (Phase 4).** Follow the Implementation Order
above exactly (steps 1–15) — it is failing-first by design and each spec
file names its own mandatory failing-first demonstration in Notes §5–8.
Work only inside this worktree (`presby-wt-e2e`) on Neon branch
`pipeline-presbytery-e2e`; `env | grep DATABASE_URL` empty before starting.
Read Phase 2's nine rulings and this Phase 3 section in full before writing
any code — the exact SQL, TypeScript signatures, form field ids, button
labels, and refusal copy needed are all given above rather than left to be
rediscovered (per CLAUDE.md's Phase 3 feasibility-check standard: catching a
mismatch here is one grep cheaper than a Phase 4 loop-back). Flag the tech
lead immediately, rather than improvising, if any of the following prove
false on the live branch: the form field ids in Notes §5–7's tables, the
credentials person-picker's "memberships at the presbytery itself" behavior
(Notes §4), or `presby_publish_sasr_snapshot()`'s two-required-parameter
signature (Notes §3) — each was verified directly against this worktree's
source on 2026-09-28, but a parallel pipeline's merge could change any of
them before Phase 4 starts.

---

# Phase 4 — Implementation

**Implementer:** full-stack-developer, 2026-09-28. Worked entirely inside
`presby-wt-e2e` on Neon branch `pipeline-presbytery-e2e` (`br-red-moon-ax4gez04`,
confirmed live via `pg_settings`/`neon.branch_id` before any write).
`env | grep DATABASE_URL` was empty at every session start. No `db:push`, no
`ALTER ROLE`, no commits. Followed Phase 3's Implementation Order 1–15
verbatim, with three genuine discoveries along the way (see Implementer
Notes) that Phase 3 did not anticipate — none required touching `src/`.

## Files Created

- `e2e/support/db.ts` — `platformSql(specName)`, the shared owner-connection
  resolver, extracted per architect Notes §1c.
- `e2e/support/flags.ts` — `getFlag`/`setFlag`/`captureFlags()`, extracted
  per architect Notes §1b.
- `e2e/support/sasr-fixture.ts` — `stagePublishedReturn()`/
  `removePublishedReturn()` through `presby_publish_sasr_snapshot()`, the
  DECISION-157 guards (`assertE2EOrg`, `assertReservedYear`), and the F115
  `pg_trigger.tgenabled = 'O'` verification at the end of teardown.
- `e2e/presbytery-oversight.spec.ts` — 6 cases, no `describe.serial`.
- `e2e/presbytery-credentials.spec.ts` — 7 cases, no `describe.serial`; grew
  a `beforeAll`/`afterAll` fixture-cleanup helper Phase 3 did not specify
  (see Implementer Notes §3).
- `e2e/presbytery-reports.spec.ts` — 10 cases, `describe.serial`, its own
  spec-local `congregation_statistics_freeze` disable/delete/enable helper.
- `e2e/filings-round-trip.spec.ts` — 9 cases, `describe.serial`, the
  publish→withdraw round trip.

## Files Modified

- `e2e/support/users.ts` — added `presbytery-clerk`/`presbytery-nogrant`/
  `congregation-clerk` to `E2ERole` and `E2E_USERS`.
- `e2e/support/seed-orgs.ts` — appended the three fixture people to
  `FIXTURE_PEOPLE`, three rows to `firstMemberships`, the
  `e2e_presbytery_clerk`/`e2e_statistics_publish` roles+grants block, **and**
  a derived-`active_membership`-group seeding loop for every `E2E_ORGS` org
  (Implementer Notes §1 — a real gap Phase 3 did not anticipate).
- `e2e/support/assert-fixture-invariants.ts` — added
  `assertNoStrayFixtureReturns()` and `assertSeedPublicationsIntact()`, both
  using `platformSql()`.
- `e2e/public-sites.spec.ts` — F114 fix: `stageLiveBundle()` now stages a
  real `presby-site-kit@4.0.0` block bundle (`hero`/`prose`/`contactForm`,
  verified against `node_modules/presby-site-kit/dist/blocks.js`) instead of
  the v0.0.1-stub shape (`mdxAst: null`); case 2's assertions updated to
  match. See Implementer Notes §2 for a second layer of rot found while
  fixing this (cases 6/7 also needed the `contactForm` block).
- `e2e/post-login-routing.spec.ts` — fixed the two stale assertions (cases 4
  and 7): `org_portal.home_v2` is ON on this branch, so `/o/<slug>` no longer
  renders an org-name `<h1>` or "you're in" copy — both now assert
  `GreetingBand`'s `data-testid="greeting-band"` instead. See Implementer
  Notes §4 for why the design's own diagnosis of these two lines didn't hold
  on inspection.
- `e2e/statistics-submit.spec.ts` — last commit only: replaced its local
  `getFlag`/`setFlag` with imports from `e2e/support/flags.ts` (byte-identical
  bodies, confirmed by re-running the file — see Final Suite Run below).
- `.github/workflows/e2e.yml` — F113 one-line fix: `E2E_DATABASE_URL` now
  written in the "Write .env.local" step.
- `docs/testing.md` — three new Accounts rows, the DECISION-157 paragraph
  after the Organizations table (this file is editable on this branch per
  Phase 2/3).

**`e2e/header-controls.spec.ts` — NOT MODIFIED.** See Implementer Notes §5:
the flake could not be reproduced.

## Schema Changes

None. All writes go through existing tables, existing columns, and the
existing `presby_publish_sasr_snapshot()`/`presby_withdraw_publication()`
SECURITY DEFINER functions. `npm run check:schema-parity` was not invoked —
no migration, no `db:push`.

## Audit Events Exercised (all pre-existing keys, verified by direct SQL read against `audit_events`, not inferred)

| Surface | `AUDIT_ACTIONS` key | Literal `action` string | Spec assertion |
|---|---|---|---|
| Oversight | `CONGREGATION_OVERSIGHT_SET` | `tenant.congregation_oversight.set` | `presbytery-oversight.spec.ts` case 2 — queried by `metadata->>'aboutOrgId'`/`'organizationId'`, NOT `resource_id` (the design table's `resource_id = <congregation id>` was wrong — `resource_id` is the oversight row's own id; corrected here) |
| Credentials — ordination | `ORDINATION_RECORDED` | `tenant.ordination.recorded` | `presbytery-credentials.spec.ts` case 1 |
| Credentials — appointment | `APPOINTMENT_RECORDED` | `tenant.appointment.recorded` | case 2 |
| Credentials — end appointment | `APPOINTMENT_ENDED` | `tenant.appointment.ended` | case 3 |
| Reports — statistics | `CONGREGATION_STATISTICS_ENTERED` | `tenant.congregation_statistics.entered` | `presbytery-reports.spec.ts` case 1 |
| Reports — per-capita rate | `PER_CAPITA_RATE_SET` | `tenant.per_capita_rate.set` | case 2 |
| Reports — records generated | `PER_CAPITA_RECORDS_GENERATED` | `tenant.per_capita_records.generated` | case 3 |
| Reports — payment | `PER_CAPITA_PAYMENT_RECORDED` | `tenant.per_capita_payment.recorded` | case 4 |
| Filings — withdrawal | `STATISTICS_RETURN_WITHDRAWN` | `tenant.statistics_return.withdrawn` | `filings-round-trip.spec.ts` case 5 — `resource_id` = publication id, `metadata.aboutOrgId`/`recipientOrgId` both asserted |

Every literal action string in `src/lib/audit.ts` carries a `tenant.` prefix
the Phase 3 design table's shorthand omitted (e.g. `congregation_oversight.set`
vs. the real `tenant.congregation_oversight.set`) — read directly off
`src/lib/audit.ts` and used verbatim in every spec query; flagged here since
it's exactly the class of thing Phase 3 asked to be caught early.

## Failing-First Evidence

Per Notes §5–8's mandatory demonstration, one per surface, plus the two
invariant guards and F114:

1. **Oversight (case 3, "no grant"):** pointed at `presbytery-clerk` (who
   holds the grant) → `expect(page.getByText(/don't have permission.../))
   .toBeVisible()` timed out (sees the form). Re-pointed at
   `presbytery-nogrant` → passes. (`e2e/presbytery-oversight.spec.ts:110`)
2. **Credentials (case 4, "no grant"):** same technique, same result —
   `presbytery-clerk` fails the denial assertion, `presbytery-nogrant`
   passes. (`e2e/presbytery-credentials.spec.ts:157`)
3. **Reports (case 5, split permission):** temporarily inserted
   `per_capita.manage` into `e2e_statistics_manage`'s `app_role_permissions`
   row (a live SQL statement, not a code edit) → the "forbidden" assertion
   for per-capita billing failed (section rendered live instead). Deleted
   the temporary grant, confirmed the role is back to exactly one
   permission, re-ran → passes. (`e2e/presbytery-reports.spec.ts:213`)
4. **Filings round trip (case 4, org-access axis):** inserted a genuinely
   SECOND membership for `presbytery-nogrant` at `e2e-alpha` (the
   `app.person_claim_authorized` DO-block mechanic `seed-orgs.ts` already
   uses for `org-multi`) → the "You don't have access to" heading assertion
   failed (real access instead). See Implementer Notes §6 for what it took
   to clean this up afterward — a genuine structural discovery, not a simple
   revert. (`e2e/filings-round-trip.spec.ts:119`)
5. **`assertNoStrayFixtureReturns()`:** staged a real publication at
   `e2e-alpha`/2097 (through `stagePublishedReturn()`, the same sanctioned
   path a real leak would use) → guard threw, naming the row. Removed via
   `removePublishedReturn()`, guard passes again.
6. **`assertSeedPublicationsIntact()`:** opened a real Postgres session
   (`@neondatabase/serverless`'s WebSocket `Client`, already a project
   dependency — no `npm install`), `BEGIN`, called the sanctioned
   `presby_withdraw_publication()` against Alder Creek's real 2025
   publication, confirmed WITHIN the open transaction that the row now
   reads as withdrawn (exactly the state that makes the guard throw), then
   `ROLLBACK`. Confirmed via a second, independent HTTP connection that
   nothing persisted (`withdrawn_at` still `null`) and that
   `assertSeedPublicationsIntact()` passes.
7. **F114 (`public-sites.spec.ts` case 2):** reverted `stageLiveBundle()`'s
   bundle to the original `mdxAst: null` stub, ran case 2 alone → failed
   exactly as Phase 1 found it (`getByRole('heading', {name: TEST_TITLE,
   level: 1})` not found). Restored the fixed block-shaped bundle, re-ran →
   passes.

## Per-File Durations (against Phase 3's budgets, `--workers=1`)

| File | Cases | Duration | Budget | 
|---|---|---|---|
| `presbytery-oversight.spec.ts` | 6 | 15.4s | ≤60s |
| `presbytery-credentials.spec.ts` | 7 | 23.8s | ≤75s |
| `presbytery-reports.spec.ts` | 10 | 27.9s | ≤90s |
| `filings-round-trip.spec.ts` | 9 | 17.7s | ≤90s |
| **Total added** | **32** | **~85s** | **≤5 min** |
| **Full local suite** | **161** | **4.3 min** | **≤12 min** |

CI ceiling (30 min job, retries: 1, clean run ≤15 min target) — not
measurable locally, but the full suite's 4.3 min leaves ample margin.

## Final Suite Run

Command used throughout (per the kickoff and Phase 3 Notes §Run-time
budgets): `E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test
--workers=1`. `env | grep DATABASE_URL` confirmed empty before every run.

- **First full run** (before the credentials-accumulation fix, Implementer
  Notes §3): **160 passed / 1 failed** — a strict-mode violation in
  `presbytery-credentials.spec.ts` case 2, caused by leftover ordination/
  appointment rows from repeated per-file test runs during development
  (this spec had no cleanup). Root-caused and fixed (see Notes §3).
- **Second full run** (after the fix, from a cold `.auth/` directory —
  every fixture session re-acquired from scratch): **161 passed / 0 failed
  / 0 skipped (4.3m)**. This includes the previous baseline's 120 passing
  cases (all 4 pre-existing failures now fixed, all 5 previously-skipped
  `describe.serial` dependents now running and green) plus this pipeline's
  32 new cases.
- Also run and green in isolation and inside the full suite:
  `header-controls.spec.ts` (22 cases, including `:110` twice — 10 solo
  repeats + 110 repeats inside 5 full-file reruns, zero flakes; see Notes §5)
  and `statistics-submit.spec.ts` (7 cases, confirming the `flags.ts`
  extraction's blast radius is contained per Phase 3 Edge Cases).

## Other Verification

- `npm run typecheck` — PASS (zero errors).
- `npm run lint` — PASS (`--max-warnings=0`).
- `npm run check` (all five tripwires: `check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`, `check:secrets`) — PASS.
- `npm test` (Vitest) — 259 files / 3374 tests passed, 34 files / 888 tests
  skipped (the documented DB-backed subset requiring `--no-file-parallelism`
  + `.env.local`, per `docs/testing.md`) — unaffected by this pipeline, run
  as a regression check only.
- No `npm install`; `package.json`/lockfile untouched (`git diff --stat`
  confirms — `npm run check:deps-drift` also green).

## DB Left Exactly As Found

Verified by direct query after the final full suite run:

- `select count(*) from statistical_returns where report_year between 2090
  and 2099` → **0** (no stray fixture rows in the reserved band).
- Alder Creek's 2025 publication → `withdrawn_at is null` (untouched,
  confirmed by id).
- Ordinations/appointments for the credentials fixture person (Cassius
  Brightwell, `…a6`) → **0** rows (this pipeline's own cleanup, Notes §3).
- The five flags this pipeline touches are all back at their Phase 1
  baseline values: `org_portal.oversight` = true, `org_portal.reports` =
  true, `org_portal.credentials` = true, `org_portal.filings` = false,
  `statistics.submission_grants` = false — each restored and SELECT-verified
  by its own spec's `flags.restore()`/`afterAll`.
- `e2e/support/.auth/` regenerated from scratch during the final run (all
  eleven fixture sessions, including the three new ones) — no drift.

## Implementer Notes

**1. A real, pre-existing gap in `seed-orgs.ts`, discovered mid-implementation
— every `E2E_ORGS` org was missing its `active_membership` derived group.**
The very first attempt to provision the three new fixture actors threw:
`organization e2e00000-...-000001 has no derived group active_membership;
seed derived groups at org creation` (`drizzle/0017`'s
`memberships_sync_derived_group` trigger, DECISION-060/063). Every existing
e2e-\* membership row predates that migration (`created_at` 2026-08-18) and
the seeder's own `WHERE NOT EXISTS` idempotency guard has silently skipped
re-inserting them ever since — so the gap was invisible until this
pipeline's brand-new actors became the first genuinely NEW membership insert
at these orgs since 0017 landed. Fixed by adding the same remediation
`scripts/seed-dev.sql` already applies for its own fixtures (DECISION-063):
a `roster`-type `groups` row named `Active Membership`, seeded for every
`E2E_ORGS` org before any membership insert. Not a product change — pure
`e2e/support/seed-orgs.ts` fixture-provisioning fix, verified by re-running
`admin-login.spec.ts` (which forces full `globalSetup`) before writing any
new spec, per Implementation Order step 4. Not a pre-assigned finding
number; recording it here for the orchestrator's awareness at integration
(the next pipeline adding a membership at `e2e-beta`/`e2e-gamma` for the
first time would hit this too if it were reverted).

**2. F114's fix surfaced a SECOND, previously-undiscovered layer of rot in
`public-sites.spec.ts`.** `src/app/(public)/site/[slug]/[[...path]]/page.tsx`'s
own header comment states the `ContactForm` "is no longer bolted onto every
page below the rendered bundle" — it now rides a `{"type": "contactForm"}`
content block. Cases 6/7 (`page.getByLabel("Name")` etc., directly on
`/site/alder-creek`) assumed the form was unconditionally present, which was
never true against the current renderer. This was invisible in every prior
run because `describe.serial` aborts remaining cases the instant case 2
fails — cases 6/7 had literally never been exercised against the real
ContactForm-block-gated behavior until this fix let the whole file run to
completion. Added a `contactForm` block (`heading: "Contact Alder Creek
Presbyterian Church"`, matching case 2's own assertion) to the same staged
bundle. All 7 cases pass together now, for the first time since the
`contactForm`-block change shipped.

**3. `presbytery-credentials.spec.ts` needed cleanup Phase 3's design did
not specify — ordinations/appointments are NOT upserted.** Unlike
`congregation_oversight` (idempotent by key) or `statistical_returns`
(governed by DECISION-157's reserved-year band and `sasr-fixture.ts`'s own
teardown), every run of cases 1/2/7 inserts a genuinely NEW row for Cassius
Brightwell. Undetected during isolated per-file testing (each run started
from a clean-enough state), this surfaced as a real strict-mode Playwright
violation (`resolved to 2 elements`) the first time the FULL suite ran
after several per-file reruns had accumulated multiple appointment rows —
a `tr` locator scoped to the "Pastoral appointments" section matched both
the old and the new row. Fixed with a `clearFixtureCredentials()` helper
(delete `appointments`/`ordinations` for the fixture person, resolved by
email — no export needed from `seed-orgs.ts`) called in both `beforeAll`
(prior-crash safety) and `afterAll` (this run's own cleanup). Neither table
carries a freeze/append-only trigger (confirmed via `pg_trigger`), so a
plain `DELETE` is safe. Verified by running the spec twice back-to-back
after the fix (no accumulation) and by the second full-suite run (161/0).

**4. Two of `post-login-routing.spec.ts`'s "stale copy" assertions needed a
different replacement than Phase 3 assumed.** The design's diagnosis
("reads the current `/home` chooser copy") didn't hold on inspection: case 4
(line 110, pre-fix) asserts against `/o/<slug>`'s OWN page content, not
`/home`'s chooser at all. With `org_portal.home_v2` ON on this branch,
`/o/<slug>` (`src/app/(org)/o/[slug]/page.tsx`) no longer renders an
org-name `<h1>` anywhere — `GreetingBand` replaced it with a personalized,
name-free greeting. Fixed both assertions (cases 4 and 7) to check
`GreetingBand`'s own `data-testid="greeting-band"` instead, a signal stable
across whatever the greeting text says. Documented per CLAUDE.md's
"catching a mismatch here is one grep cheaper than a Phase 4 loop-back" —
this was a correction, not a loop-back, since the fix is still a pure
text/locator-assertion change with no fixture or flag implications.

**5. `header-controls.spec.ts:110`'s flake could not be reproduced — left
unmodified, per the design's own "out of scope if not test-timing" carve-out.**
Ran the single case 10x in isolation (`--repeat-each=10`, zero failures),
then the full file 5x (`--repeat-each=5`, 110/110, zero failures), then twice
more inside full-suite runs (161/0 both times) — 132 total executions of
this exact case, zero flakes. The code already uses Playwright's retrying
`toBeFocused()` web-first assertion, not a fixed `waitForTimeout`, so there
is no obvious anti-pattern to fix either. Per the design's own scoping
("if the root cause turns out to be a real product race condition... this
pipeline documents the finding rather than absorbing the fix" — and,
symmetrically, if it cannot be reproduced at all, inventing a change would
be guessing), this pipeline makes NO change to this file. **Recommend the
`docs/TODO.md` "Four pre-existing e2e failures" line be corrected, not
closed, for this one item** — record it as "not reproduced in 132
repeat-each runs, 2026-09-28; leave open, re-observe under CI once it runs
there" rather than marking it fixed.

**6. The filings-round-trip failing-first demonstration (Notes §Failing-First
Evidence, item 4) could not be cleanly reverted with a simple DELETE — a
real, structural discovery about `memberships`.** Once a membership fires
`memberships_sync_derived_membership_group` (drizzle/0017) and its
`group_memberships` projection row exists, that row can never be deleted
directly (`presby_reject_derived_group_write()`, drizzle/0033, `errcode =
check_violation` on any DELETE where `old.source = 'derived'` — by design,
mirroring "the Court is not a group"'s permanence rule extended to
`active_membership`). Ending the membership (`ended_on`) was not an option
either: it would have left `presbytery-nogrant` with a genuinely ENDED
relationship at `e2e-alpha`, permanently changing case 4's expected UI branch
from `OrgAccessDenied` ("you don't have access to") to `OrgAccessEnded`
("your access... has ended") — breaking the very case being demonstrated, on
every future run. The correct remediation, and the one applied: the SAME
disable/delete/enable/verify discipline `sasr-fixture.ts`'s own teardown
already uses for append-only triggers — `alter table group_memberships
disable trigger group_memberships_reject_derived`, delete the
`group_memberships` row, delete the `memberships` row, re-enable, then
verify `tgenabled = 'O'` by a follow-up `pg_trigger` read. Confirmed by
re-running case 4 (passes, real "no access" state restored) and by the
final full-suite run. Recorded here because "hard-delete a membership that
already projected into a derived group" is not documented anywhere else in
the codebase and the next pipeline that needs to undo a mistaken fixture
membership will hit the identical wall.

**7. A genuine hydration race with native `<select>` elements bound via
`react-hook-form`, affecting every new spec.** The very first full run of
`presbytery-reports.spec.ts` case 1 recorded the WRONG congregation
(`e2e-gamma`, the form's own `defaultValues` fallback) despite
`selectOption(E2E_ORGS.alpha.id)` succeeding at the DOM level immediately
beforehand (`inputValue()` confirmed correct right after the call). Isolated
with a throwaway debug spec: `page.goto()` → `selectOption()` →
`inputValue()` read back the WRONG value when run without a settling wait,
and the CORRECT value when preceded by `page.waitForLoadState("networkidle")`
— a real hydration race (React re-attaching to the SSR-rendered `<select>`
and reconciling its selected option AFTER the browser-level DOM mutation
lands, briefly before the case's own submit click). Not previously
documented in this suite. Fixed by inserting
`await page.waitForLoadState("networkidle")` immediately after every
`page.goto()` in the four new spec files (harmless on cases that only read
text — the added latency is ~0.5–1s per navigation, well inside every
file's budget). **Recommend a `docs/TODO.md` follow-up:** the two existing
specs that predate this pipeline (`statistics-submit.spec.ts`,
`public-sites.spec.ts`) do NOT have this wait and were not observed to flake
in this session's runs, but they also interact with fewer/simpler `<select>`
elements — a future pipeline touching either file with a new `<select>`
interaction should watch for the same class of failure.

**8. Oversight case 2 and reports case 1 each showed one COLD-TURBOPACK-COMPILE
flake during development** (the very first hit of a route in a fresh dev
server process took long enough to produce an unrelated one-off timing
issue), both non-reproducing on immediate re-run and superseded by the
`networkidle` fix in Note 7 above. Not a code defect; named for completeness.

**Deviations from the Phase 3 design, summarized:**
- Oversight's audit-row assertion queries by `metadata->>'aboutOrgId'`/
  `'organizationId'`, not `resource_id` (the design table's shorthand was
  wrong about which id lands in `resource_id` for this one action).
- `EndAppointmentDialog`'s confirm button requires a non-empty "Reason"
  field before it's enabled — the design table's case 3 didn't mention
  filling it; the spec does.
- `appointment-list.tsx` has no "active-appointment badge" — ending an
  appointment removes the "End appointment" button and fills in the "Ends"
  date column; the spec asserts that instead of a badge.
- `presbytery-reports.spec.ts`'s per-capita rate form fills `#rate-basis-year`
  explicitly with the SAME year as the billing year (2095), not left blank
  to default to `billingYear - 2` (2093) — the design table already called
  for filling it explicitly; this note just records why: the default would
  have looked for e2e-alpha's statistics at 2093, which case 1 never wrote.
- `filings-round-trip.spec.ts` case 8's sibling-absence check asserts
  "Published" (the real badge label on `reports/[aboutOrgId]/page.tsx`) is
  absent from the withdrawn row, not a "Congregation reported"/live badge —
  the design's own wording was a paraphrase; the real label differs.

**Nothing under `src/` was touched.** No product-code change was needed for
any spec to pass; every finding above stayed inside `e2e/`,
`.github/workflows/`, or `docs/testing.md`.

## Proposed `docs/TODO.md` lines (orchestrator applies at integration)

- Correct (not close) the "Four pre-existing e2e failures" line:
  `public-sites.spec.ts:334` fixed here as spec rot (F114) — see this
  Phase 4's Files Modified and Implementer Notes §2 for the full shape
  (including the second, previously-hidden `contactForm`-block layer);
  `post-login-routing.spec.ts:110`/`:166` fixed here (Implementer Notes §4,
  a different root cause than the design assumed); `header-controls.spec.ts:110`
  **NOT reproduced** in 132 repeat-each runs across isolation and full-suite
  contexts (Implementer Notes §5) — leave this one line open with that note,
  re-observe once the CI `e2e` job actually runs (F113 is fixed, so it can).
- Add: extract `getFlag`/`setFlag` in `statistics-submit.spec.ts` onto
  `e2e/support/flags.ts` — **DONE** in this pipeline's last commit-equivalent
  step; move to Done.
- Add (carried from Phase 2, unchanged): migrate `public-sites.spec.ts` off
  `scripts/seed-dev.sql`'s Alder Creek fixture onto an `e2e-*` org with a
  `tickets.file` holder.
- Add (carried from Phase 2, unchanged): consider splitting
  `e2e/support/seed-orgs.ts` (now five appended blocks) into orgs/people/
  memberships vs roles/grants.
- Add (new, Implementer Notes §1): the next pipeline adding a FIRST-EVER
  membership at any `e2e-*` org should confirm that org's
  `active_membership` derived group still exists before assuming
  `seed-orgs.ts`'s membership inserts will succeed — the gap this pipeline
  fixed could recur if that seeding loop is ever removed or an org is
  renamed/recreated.
- Add (new, Implementer Notes §6): "hard-delete a membership that already
  projected into a `group_memberships` row" has no documented sanctioned
  path anywhere in the codebase — the disable/delete/enable/verify
  remediation this pipeline used for its own failing-first demonstration
  cleanup is real but ad hoc; consider whether a `presby_*` helper function
  belongs in `src/lib/db/domain/` for the (rare, test/ops-only) case of
  undoing a mistaken membership insert before it accrues roll/history
  significance.
- Add (new, Implementer Notes §7, **rewritten by Phase 5 loop-back,
  orchestrator ruling 2, F116** — the original line below stated only a test
  convention and lost the product question QA's Phase 5 review surfaced;
  superseded by this text): **F116** — a react-hook-form-registered native
  `<select>` on `statistics-form.tsx` can have a pre-hydration selection
  silently reverted — a data-integrity hazard on the clerk's annual form;
  reproduce on a production build and decide whether it is its own bug-fix
  pipeline.
  ~~Add (new, Implementer Notes §7): `statistics-submit.spec.ts` and
  `public-sites.spec.ts` predate the `page.waitForLoadState("networkidle")`
  hydration-safety convention this pipeline adopted for native `<select>`
  interactions — neither flaked in this session, but a future pipeline
  adding a new `<select>` interaction to either file should watch for the
  same hydration race (Implementer Notes §7 describes the mechanism and
  repro).~~

## Handoff

**Next: qa (Phase 5).** What to verify in a browser (beyond re-running the
suite): sign in as `presbytery-clerk@presby.invalid` /
`presbytery-nogrant@presby.invalid` / `congregation-clerk@presby.invalid`
(password `e2e-fixture-only-not-a-secret`, per `docs/testing.md`) and walk
`/o/e2e-presbytery/admin/oversight`, `/admin/reports`, `/admin/credentials`,
and `/o/e2e-alpha/admin/filings` by hand at both desktop and 360px — the
four-negative-state discipline (flag off / wrong org type / no grant /
load error) is the thing most worth eyeballing directly, plus the filings
table's known horizontal-scroller residual at 360px (asserted positively in
`filings-round-trip.spec.ts` case 9, not hidden). Confirm
`npm run test:e2e -- --workers=1` reproduces 161/0 on a fresh
`e2e/support/.auth/` (delete the directory first, exactly as this Phase 4 did
for its final run) and that the DB-left-as-found queries in this Phase 4
section still hold after QA's own run. This pipeline touches
`src/app/(org)/o/[slug]/admin/oversight|reports|credentials|filings` only by
READING existing routes through the browser — no `src/auth.ts`,
`(auth)`, `api/auth`, or `lib/auth` files were touched, so the CLAUDE.md
Phase 4 auth-e2e gate does not apply here; the existing `totp-full-login.spec.ts`
run (green, unaffected) is the auth-path evidence already on file.

## Phase 4 loop-back (2026-09-28)

**Trigger:** QA's Phase 5 FAIL — GAP-1, "the filings surface has no e2e
coverage of any of its three reachable denial states." Orchestrator rulings
1–3 (recorded at the end of the Phase 5 section) accepted the FAIL and
assigned the remedy verbatim. Worked entirely inside `presby-wt-e2e`, branch
`pipeline/presbytery-e2e`. `env | grep DATABASE_URL` empty before starting;
Neon branch reconfirmed live via `pg_settings`/`neon.branch_id` =
`br-red-moon-ax4gez04` on both `PLATFORM_DATABASE_URL` (`neondb_owner`) and
`DATABASE_URL` (`presby_app`) before any write. No `ALTER ROLE`, no
`db:push`, no commits. Nothing under `src/` touched.

### Files changed

- `e2e/filings-round-trip.spec.ts` — added a second, independent
  `test.describe.serial` block ("Filings permission states (2026-09-28-presbytery-e2e
  loop-back, GAP-1)", cases 10–12) after the existing publish→withdraw round
  trip. Uses the file's own already-imported `captureFlags`/`setFlag`/
  `FlagCapture` and the existing `org-single`/`org-multi` fixtures — no new
  fixtures, no `src/` change.
  - Case 10 (`:307`): flag OFF, `org-single` at `/o/e2e-alpha/admin/filings`
    → `/isn't turned on for/` visible, `/don't have permission to manage
    statistical filings/` absent.
  - Case 11 (`:325`): flag ON, `org-multi` at `/o/e2e-presbytery/admin/filings`
    (a `presbytery`, outside `FILINGS_ORG_TYPES`) → `/isn't the kind of
    organization this tool is built for/` visible, the forbidden anchor
    absent.
  - Case 12 (`:345`): flag ON, `org-single` (an active, ungranted
    relationship at e2e-alpha — the same "state 3" shape
    `presbytery-nogrant` provides for oversight/reports/credentials) at
    `/o/e2e-alpha/admin/filings` → `/don't have permission to manage
    statistical filings/` visible, the flag-off anchor absent.
- `e2e/presbytery-credentials.spec.ts:54` — promoted `test.describe` to
  `test.describe.serial`, per QA's Observations (case 3 consumes case 2's
  side effect; plain `describe` only passed because `workers: 1`/
  `fullyParallel: false` happened to preserve ordering).
- `e2e/support/sasr-fixture.ts:203-219` — the F115 `pg_trigger` verification
  now constrains by `(tgname, relname)` pairs instead of `tgname` alone, per
  QA's Observation that an unconstrained `tgrelid` join is fragile if a
  same-named trigger ever appears on another table.
- `docs/work-log/2026-09-28-presbytery-e2e.md` (this file) — rewrote Phase
  4's original proposed `docs/TODO.md` line for the `<select>` hydration race
  (Implementer Notes §7) to state the product question as **F116**, per
  orchestrator ruling 2. The superseded original line is struck through
  in place rather than deleted, so Phase 4's original framing stays legible
  for the retrospective.

### Commands run

```
env | grep DATABASE_URL                       # empty, confirmed first
psql "$PLATFORM_DATABASE_URL" -c "select name, setting from pg_settings
  where name ilike '%neon%branch%' or name ilike '%neon%endpoint%';"
                                               # br-red-moon-ax4gez04 confirmed
npm run typecheck                             # PASS, zero errors (pre- and post-change)
npm run lint                                  # PASS, --max-warnings=0
PORT=3600 npm run dev  (backgrounded, PID recorded, stopped by PID at the end)
E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test \
  e2e/filings-round-trip.spec.ts -g "GAP-1" --workers=1     # failing-first below
E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test \
  e2e/filings-round-trip.spec.ts --workers=1                # 12/12, all cases
E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test \
  e2e/presbytery-credentials.spec.ts --workers=1             # 7/7, describe.serial
E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test \
  e2e/presbytery-oversight.spec.ts e2e/presbytery-reports.spec.ts --workers=1
                                                              # 16/16
E2E_BASE_URL=http://localhost:3600 PORT=3600 npx playwright test \
  e2e/public-sites.spec.ts --workers=1                       # 7/7
rm -rf .next  &&  PORT=3600 npm run dev  (fresh server)
E2E_BASE_URL=http://localhost:3600 PORT=3600 npm run test:e2e -- --workers=1
                                                              # full suite, once
```

### Failing-first evidence (GAP-1 case 12, the no-grant state)

1. Ran `filings-round-trip.spec.ts -g "GAP-1"` cases 10–12 as originally
   written (grant absent, as seeded) → **3/3 PASS** (baseline).
2. On the owner connection, inserted a `role_grants` row binding
   `org-single`'s person (`e2e00000-…-0000000000a1`) to the
   `e2e_statistics_publish` role (`e2e00000-…-0000000000b3`) at e2e-alpha
   (`e2e00000-…-000000000002`):
   ```sql
   insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
   select 'e2e00000-0000-0000-0000-000000000002'::uuid,
          'e2e00000-0000-0000-0000-0000000000b3'::uuid,
          'e2e00000-0000-0000-0000-0000000000a1'::uuid,
          date '2020-01-01',
          (select id from users where email = 'admin@presby.invalid');
   ```
   Confirmed inserted by `select * from role_grants where person_id = '…a1'`
   → 1 row.
3. Re-ran the same command → **case 12 FAILED**:
   `expect(locator).toBeVisible() failed — Locator:
   getByText(/don't have permission to manage statistical filings/i) —
   element(s) not found` (`filings-round-trip.spec.ts:357`). Cases 10/11
   still passed (unaffected). This proves case 12 genuinely discriminates on
   the grant: with it present, the forbidden copy correctly stops rendering.
4. Deleted the grant on the owner connection:
   ```sql
   delete from role_grants
    where person_id = 'e2e00000-0000-0000-0000-0000000000a1'::uuid
      and organization_id = 'e2e00000-0000-0000-0000-000000000002'::uuid
      and role_id = 'e2e00000-0000-0000-0000-0000000000b3'::uuid;
   ```
   `select count(*) from role_grants where person_id = '…a1'` → **0**, proving
   the row is gone.
5. Re-ran → **3/3 PASS** again (10.0s).

### Tallies

| Run | Scope | Result |
|---|---|---|
| `filings-round-trip.spec.ts` (whole file) | 12 cases | 12 passed, 26.4s |
| `presbytery-credentials.spec.ts` | 7 cases | 7 passed, 26.4s |
| `presbytery-oversight.spec.ts` + `presbytery-reports.spec.ts` | 16 cases | 16 passed, 42.7s |
| `public-sites.spec.ts` | 7 cases | 7 passed, 14.7s |
| Full suite (`--workers=1`, fresh `.next`) | 164 cases | **164 passed / 0 failed / 0 skipped**, 3.9 min |

`npm run typecheck` and `npm run lint` both PASS, zero errors/warnings, before
and after.

### DB left exactly as found (re-verified after the full-suite run)

- `select key, enabled from feature_flags order by key` → byte-identical to
  the pre-run baseline captured at the start of this loop-back (40 rows;
  `filings`/`submission_grants`/`statistical_publication`/`feature_categories`
  off, rest on).
- `statistical_returns` in the reserved 2090–2099 band → 0, before and after.
- Alder Creek's 2025 publication (`994f9867-…`) → present,
  `withdrawn_at is null`, before and after.
- Every `*_freeze` trigger plus `group_memberships_reject_derived` →
  `tgenabled = 'O'`, before and after.
- `role_grants` for `org-single`'s person (`…a1`) → 0 rows, confirming the
  failing-first demonstration's own grant was fully cleaned up.
- Dev server on port 3600 stopped by PID (the `next dev`/`dotenv` child PIDs
  under this worktree, not the launcher npm PID and not the unrelated dev
  servers running in sibling worktrees); port 3600 confirmed unreachable
  afterward.

## Handoff (superseding the prior Handoff above for routing purposes)

**Next: qa (Phase 5 re-verification).** GAP-1 is closed: three new cases in
`e2e/filings-round-trip.spec.ts` (10–12) assert all three of filings' denial
states with sibling-anchor absence checks, failing-first proven for the
no-grant case by a real `role_grants` insert/delete against the owner
connection. `presbytery-credentials.spec.ts` is now `describe.serial`.
`sasr-fixture.ts`'s `pg_trigger` check is now constrained by table as well as
trigger name. F116 is recorded in this file's "Proposed `docs/TODO.md` lines"
section with the product-question framing the orchestrator specified; the
line is for the orchestrator to apply to `docs/TODO.md` at integration, not
edited there directly from this branch (shared-file discipline). Full suite:
164/0/0. DB byte-identical before/after. Nothing under `src/` changed.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Date:** 2026-09-28
**Verified by:** qa
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-e2e`, branch `pipeline/presbytery-e2e` (HEAD `4461a46`, all Phase 4 work uncommitted in the working tree). `env | grep DATABASE_URL` empty before every command. Neon branch confirmed via `pg_settings` as `br-red-moon-ax4gez04` on all three connections (`DATABASE_URL`/`APP_DATABASE_URL` → `presby_app`, `PLATFORM_DATABASE_URL` → `neondb_owner`). No `ALTER ROLE`, no `db:push`, no commits. Dev server on 3600, stopped by PID.

## Type Check

`npm run typecheck`: **PASS** (zero errors)
`npm run lint`: **PASS** (`--max-warnings=0`)
`npm run check`: **PASS** — all five tripwires (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`, `check:secrets`)

## Unit Tests

Total: 4262 | Passed: 3374 | Failed: 0 | Skipped: 888 (34 files) | Duration: 13.3s
Failures: none. The 888 skips are the documented DB-backed subset requiring `--no-file-parallelism` + `.env.local` (`docs/testing.md`), pre-existing and untouched by this pipeline (zero `src/` diff).

## End-to-End Tests

Ran the full suite **twice** on port 3600 after `rm -rf .next`, `--workers=1`:

| Run | Condition | Result | Duration |
|---|---|---|---|
| 1 | cold `e2e/support/.auth/` (all 11 fixture sessions re-acquired) | **161 passed / 0 failed / 0 skipped** | 3.9 min |
| 2 | warm `.auth/` | **161 passed / 0 failed / 0 skipped** | 3.6 min |

Phase 4's 161/0/0 reproduced independently. Per-file durations (run 2) against Phase 3's budgets:

| File | Cases | Run 2 | Run 1 | Budget |
|---|---|---|---|---|
| `presbytery-oversight.spec.ts` | 6 | 12.2s | 12.9s | ≤60s ✅ |
| `presbytery-credentials.spec.ts` | 7 | 20.4s | 20.9s | ≤75s ✅ |
| `presbytery-reports.spec.ts` | 10 | 25.8s | 25.1s | ≤90s ✅ |
| `filings-round-trip.spec.ts` | 9 | 14.5s | — | ≤90s ✅ |
| Total added | 32 | ~72.9s | — | ≤5 min ✅ |
| Full suite | 161 | 3.6 min | 3.9 min | ≤12 min ✅ |

`e2e/header-controls.spec.ts:110` run **20×** standalone: 20/20 passed (34.4s). I could not reproduce the flake either; Phase 4's "not reproduced, leave the TODO line open" recommendation is correct and I endorse it.

**DB left exactly as found** — verified by direct owner-connection query before and after both runs:

- `select key, enabled from feature_flags order by key` → **byte-identical** pre-run and post-run (40 rows; `filings`/`submission_grants`/`statistical_publication`/`feature_categories` off, rest on).
- `statistical_returns` in the reserved 2090–2099 band → **0** before and after.
- Alder Creek's 2025 publication (`994f9867-…`) → present, `withdrawn_at is null`, before and after.
- Every `*_freeze` trigger plus `group_memberships_reject_derived` → `tgenabled = 'O'`, before and after (`pg_trigger`, live catalog, not `information_schema`).
- 2095 per-capita/statistics rows → 0; fixture ordinations/appointments → 0; `presbytery-nogrant` holds exactly one membership (e2e-presbytery, `ended_on` null) — confirming Implementer Note §6's ad-hoc cleanup left no residue.

## Independent Reproductions

**1. Scope.** `git diff --name-only` vs HEAD plus untracked: 8 modified + 8 untracked, **nothing under `src/`**, no `package.json`/lockfile, no `scripts/seed-dev.sql`/`seed.ts`/`test-rls.sql`, no `docs/TODO.md`/`decisions.md`/`STATE.md`. (`docs/STATE.md` appears only in a diff against `938e1c5` because the worktree branched from `4461a46`, its parent — not a pipeline edit.) `e2e/header-controls.spec.ts` untouched. **One deviation from the brief:** the `.github/workflows/e2e.yml` diff is the F113 line *plus a 10-line explanatory comment block* — functionally exactly the one line the design specified, but not a one-line diff.

**2. DECISION-157 compliance (by reading).** Every mutation in the four new specs and `sasr-fixture.ts` targets `e2e-` slugs / `@presby.invalid` / years ≥ 2094 / `e2e_*` roles. Grep for `alder|northern|clerk\.fixture|elder\.fixture|example\.invalid` across the new files returns **only comment text**, no write. Both guards exist and throw: `assertReservedYear()` (`sasr-fixture.ts:41`) and `assertE2EOrg()` (`sasr-fixture.ts:60`, which resolves the slug from the live `organizations` row rather than trusting the caller). `captureFlags().restore()` re-SELECTs every key and throws on mismatch (`flags.ts:49-58`). F115's `tgenabled = 'O'` verification is present at `sasr-fixture.ts:203-219`, and `presbytery-reports.spec.ts:61-69` carries the same check for its spec-local helper.

**3. Failing-first, reproduced by me — both surfaces.**
- *Permission axis:* inserted a `role_grants` row binding `presbytery-nogrant`'s person (`…a6`) to `e2e_presbytery_clerk` on the owner connection → `presbytery-oversight.spec.ts:113` **FAILED**. Deleted the grant, confirmed `select * from role_grants where person_id='…a6'` → `[]`, re-ran → **PASSED** (6.4s); `presbytery-credentials.spec.ts:188` also re-confirmed green. The denied cases genuinely discriminate on the grant.
- *F114:* `git stash push -- e2e/public-sites.spec.ts` restored the `mdxAst: null` stub → `public-sites.spec.ts:334` **FAILED** with the 5 `describe.serial` dependents skipped, exactly the signature Phase 1 recorded. Restored via `git stash pop`; SHA-256 `ae495aa0…4f8` matches the pre-stash checksum byte-for-byte, stash list empty, file re-runs 7/7 green.

**4. F113.** With `E2E_DATABASE_URL` unset and `CI=true`, `globalSetup` **throws at `e2e/support/global-setup.ts:73`** with the shared-DB message — before any browser launch or DB write, confirming the architect's diagnosis that the CI job could never have passed. With `E2E_DATABASE_URL` set to the branch URL and `CI=true`, `globalSetup` completes and the suite runs green. That is precisely the behaviour the one-line `e2e.yml` fix relies on.

**5. Phase 4's six discoveries — rulings.**

| # | Discovery | Ruling |
|---|---|---|
| 1 | `active_membership` derived group missing on every `E2E_ORGS` org | **In scope, correct, hides nothing.** I read `src/lib/org-provisioning.ts` — `createOrganization()` already seeds the group via `groupSeedPlan()` (`:168-206`). The product path is sound; the gap existed only because `seed-orgs.ts` hand-inserts orgs in raw SQL, bypassing it. |
| 2 | Second `public-sites` rot layer (`contactForm` block) | **In scope, correct.** Genuinely masked by `describe.serial` abort; cases 6/7 had never executed against the current renderer. Confirmed by my own stash reproduction. |
| 3 | Credentials fixture accumulation | **In scope, correct.** Verified `ordinations`/`appointments` carry no freeze trigger; post-run counts are 0. |
| 4 | Corrected `post-login-routing` diagnosis | **In scope, correct.** `data-testid="greeting-band"` is a more stable anchor than the copy it replaced. |
| 5 | `header-controls` flake not reproduced | **Correct not to change it.** Independently confirmed 20/20. Leave the TODO line open. |
| 6 | Underivable `group_memberships` delete | **In scope, correct, and the most valuable note in Phase 4.** The disable/delete/enable/verify remediation is sound; post-run catalog confirms `group_memberships_reject_derived` is `'O'`. |
| 7 | `<select>` hydration race + `networkidle` | **Fix in scope and correct as test hygiene — but it masks a real product behaviour, and Phase 4 mis-filed it.** See finding below. |

## Findings

**GAP-1 (blocking) — the filings surface has no e2e coverage of any of its three reachable denial states.** Phase 2 Notes §4, accepted verbatim by the orchestrator ("All nine rulings accepted"), enumerated filings' own anchors (`/don't have permission to manage statistical filings/`) and named the fixtures for the wrong-org-type direction (`org-multi` at `e2e-presbytery`). Phase 3's design table for `filings-round-trip.spec.ts` silently dropped all three, with no scope notation, and Phase 4 implemented the design faithfully. The result: oversight, reports and credentials each assert flag-off + wrong-org-type + no-grant; **filings asserts none of them.** The only reference to filings' forbidden copy in the whole suite is an *absence* assertion on the happy path (`e2e/filings-round-trip.spec.ts:112-114`); case 4 (`:119-138`) covers `OrgAccessDenied`, a different axis entirely, and says so in its own comment.

I confirmed all three states are live, reachable and distinguishable with fixtures that already exist (flag captured and SELECT-verified restored afterwards):

```
flag OFF, org-single @ e2e-alpha   -> "isn't turned on for"
flag ON,  org-single @ e2e-alpha   -> "don't have permission to manage statistical filings"
flag ON,  org-multi  @ e2e-presbytery -> "isn't the kind of organization this tool is built for"
```

`statistics.publish` gates a mutation of the system of record. The three unit tests in `src/app/(org)/o/[slug]/admin/filings/page.test.tsx` cover the same branches, but with `listOwnFilings()` mocked — they prove the component picks the right branch, not that the real gate refuses a real under-privileged session. That is the distinction this pipeline exists to close, and it closed it for three surfaces out of four. Remedy: three cases in `filings-round-trip.spec.ts` using `org-single` and `org-multi`, no new fixtures, ~5s of runtime.

**FINDING (non-blocking, for tech-lead — suggest F116) — the `networkidle` fix masks a genuine pre-hydration data-integrity hazard, and Phase 4 filed it only as a test convention.** I reproduced the race independently against `#stats-congregation` (`src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx:170-181`, a native `<select>` bound via react-hook-form `{...register()}`): in 3 un-settled trials, one selected the correct congregation and then **silently reverted to a different one ~3s later**, and two never took the selection at all. With `waitForLoadState("networkidle")`, 2/2 stable and correct. A clerk who picks a congregation before hydration completes can have that choice silently rewritten, with no visual signal, on a form that writes a congregation's annual statistics. Caveats stated honestly: this is a Turbopack dev server, so the production window is much shorter; and zero `src/` changed here, so this is pre-existing product behaviour surfaced by the test work, not a regression. Phase 4's proposed TODO line frames it purely as "a future pipeline adding a `<select>` should watch for this," which loses the product question. It should be raised as a finding for tech-lead, not absorbed as an e2e convention. **Not part of the FAIL** — the implementer should not fix product code in this pipeline.

**Observations (non-blocking, no action required):**
- *Four-negative-state discipline, per the brief's request to list cases asserting only data-absence:* `presbytery-oversight.spec.ts:128` (table absence), `presbytery-reports.spec.ts:250-251` (form-field absence), `presbytery-reports.spec.ts:283` (heading absence) use data-absence rather than a sibling state's paragraph; `filings-round-trip.spec.ts:133-135` asserts its own anchor with no sibling check at all. In every case the *positive* anchor is itself state-distinguishing, so the four states remain separable — this is weaker than Phase 2 §4's letter but not unsound. Oversight 4/5, credentials 4/5/6 and reports 7/9 do assert genuine sibling paragraphs.
- `presbytery-credentials.spec.ts:146` (case 3) consumes case 2's side effect, but the file uses plain `test.describe` (`:54`), not `describe.serial` — contrary to Phase 2 Notes §3's own rule. It passes because `workers: 1`/`fullyParallel: false` fix ordering, but case 3 cannot be run alone and a case-2 failure produces a confusing case-3 failure rather than a skip.
- `sasr-fixture.ts:208` filters `pg_trigger` by `tgname` alone without constraining `tgrelid`; harmless today, fragile if a same-named trigger ever appears on another table.
- Process note: a dev-only Neon branch connection string was echoed into my terminal by one diagnostic command. It is gitignored `.env.local` content on a pipeline branch slated for deletion at cleanup, and it entered no file — flagging only so the operator is aware if this transcript is shared.

## Regression Tests Added

Authored by the implementer (I ran and read them; I authored nothing):

- `e2e/public-sites.spec.ts:381` — guards against presby-site-kit bundle-schema rot (F114). Failing-before/passing-after **reproduced by me** via `git stash`.
- `e2e/support/sasr-fixture.ts:203-219` — guards against a teardown leaving append-only enforcement off (F115). Live-catalog `tgenabled` check.
- `e2e/support/assert-fixture-invariants.ts:95` / `:134` — `assertNoStrayFixtureReturns()` / `assertSeedPublicationsIntact()`, the mechanical descendants of the withdraw pipeline's QA FAIL. Both pass before and after every run.
- `e2e/presbytery-oversight.spec.ts:113`, `e2e/presbytery-credentials.spec.ts:188`, `e2e/presbytery-reports.spec.ts:213`/`:236` — permission-denial guards. Failing-before/passing-after **reproduced by me** for oversight via a real grant insert/delete.
- `e2e/post-login-routing.spec.ts:110`/`:196` — re-anchored on `greeting-band` after `home_v2`.

## Coverage on Critical Modules

Not re-measured: this pipeline changes zero `src/` files, so `permissions.ts`, `two-factor.ts` and `flags.ts` are bit-identical to `main` and their numbers cannot have moved. The full Vitest suite is green. The release-slot `test-coverage` review is the right place for the figures.

## Feature-Gate Audit

**No protected routes touched.** Verified by reading the diff, not inferred: `git diff --name-only` against the branch point plus untracked files shows changes confined to `e2e/`, `.github/workflows/e2e.yml` and `docs/testing.md`. No `src/app/api/**/route.ts` and no `"use server"` action was added or modified. The new specs *exercise* six existing gates (`congregation_oversight.manage`, `statistics.manage`, `per_capita.manage`, `credentials.manage`, `statistics.publish`, and the submission-grants issuance check) through real navigation.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| — (no route handler or server action added or changed) | n/a | n/a | n/a |

**Auth gate:** the diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`, so the stricter auth-touching gate does not apply. It is satisfied anyway: both full-suite runs exercised `totp-full-login.spec.ts:23` (password → TOTP → landing, MFA-enrolled seeded user) and all 7 `totp-callback-bypass` cases against a real dev server, green.

**Session integrity:** confirmed by grep and by reading `e2e/support/global-setup.ts:33-182` — every fixture session is acquired through the real `/api/auth/csrf` + `/api/auth/callback/credentials` endpoints and verified against `/api/auth/session`. No JWT minting, no `addCookies`, no hand-forged cookie, no `auth()` stub anywhere in `e2e/`. The three new actors use the same path.

## Verdict

**FAIL** — one named coverage gap. Everything that was built is correct, green twice, and leaves the database byte-identical; the failure is a silently-dropped accepted architectural ruling, not a broken test.

- **Cited:** `e2e/filings-round-trip.spec.ts:41-263` — the filings surface asserts none of its three reachable denial states (flag off, wrong org type, no `statistics.publish`), against Phase 2 Notes §4's accepted ruling which enumerated all three anchors and named the fixtures. The only reference to the forbidden copy is an absence assertion at `e2e/filings-round-trip.spec.ts:112-114`; `:119-138` covers a different axis. I verified all three states render live. Remedy: three cases using the existing `org-single` and `org-multi` fixtures.

This is the whole of the FAIL. The `<select>` hydration finding is **not** part of it — it is product behaviour outside this pipeline's scope and belongs to tech-lead.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | **Second pass: PASS** — GAP-1 closed and re-proven failing-first on both the grant and flag axes; 164/0/0 on fresh `.next` + cold `.auth`; DB byte-identical (SHA-256 match). First pass: FAIL on the filings denial gap; F116 product finding assigned | PASS | 2026-09-28 |

## Handoff

**Next: `full-stack-developer` (Phase 4), for a narrow loop-back.** Add three cases to `e2e/filings-round-trip.spec.ts` closing GAP-1 — flag off, wrong org type (`org-multi` at `/o/e2e-presbytery/admin/filings`), and no grant (`org-single` at `/o/e2e-alpha/admin/filings`) — each asserting its own anchor visible plus a sibling anchor absent, using the anchors in Phase 2 Notes §4 and the flag capture/restore already in the file's `beforeAll`. No new fixtures, no `src/` change; budget impact ~5s. Optionally, while in the file: promote `presbytery-credentials.spec.ts:54` to `test.describe.serial`.

**Also for the orchestrator / tech-lead, not the implementer:** the hydration finding needs an F-number and a ruling on whether a pre-hydration selection revert on RHF-registered native `<select>`s warrants its own bug-fix pipeline. Phase 4's proposed TODO line should be rewritten to state the product question, not just the test convention.



### Orchestrator rulings (2026-09-28)

1. GAP-1 loops back to Phase 4 (three filings denial cases; optionally `describe.serial` on credentials). Phase 3 dropped an accepted Phase 2 ruling without notation — noted for the retrospective.
2. **F116 is assigned** to the pre-hydration `<select>` revert on `statistics-form.tsx` (a react-hook-form-registered native select can have a pre-hydration choice silently rewritten). It is a product finding outside this pipeline; it opens a `docs/TODO.md` line at integration as a candidate wave-5 bug-fix pipeline (the statistics form is the presbytery clerk's annual surface), and Phase 4's proposed TODO line is rewritten to state the product question.
3. The `e2e.yml` comment block accompanying the F113 line is accepted.

---

# Phase 5 — Verification (qa) — second pass (re-verification after the Phase 4 loop-back)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Date:** 2026-09-28
**Verified by:** qa
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-e2e`, branch `pipeline/presbytery-e2e` (HEAD `4461a46`, all work uncommitted). `env | grep DATABASE_URL` **empty** before every command. Neon branch confirmed live via `pg_settings` on all three connections: `DATABASE_URL` / `APP_DATABASE_URL` → `presby_app`, `PLATFORM_DATABASE_URL` → `neondb_owner`, all `neon.branch_id = br-red-moon-ax4gez04` (endpoint `ep-red-heart-axzlbff7`). No `ALTER ROLE`, no `db:push`, no commits, no file written. Dev server on port 3600, started and stopped by PID (39142 launcher / 39159 listener), port confirmed free and unreachable afterward.
**Scope of this pass:** GAP-1 and the loop-back's edits only. The first pass's findings on everything else stand unchanged.

## Type Check

`npm run typecheck`: **PASS** (zero errors) — run before and after the suite, on the identical tree
`npm run lint`: **PASS** (`--max-warnings=0`)
`npm run check`: **PASS** — all five tripwires (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`, `check:secrets`)

## Unit Tests

Total: 4262 | Passed: 3374 | Failed: 0 | Skipped: 888 (34 files) | Duration: 13.0s
Failures: none. Identical to the first pass; the 888 skips are the documented DB-backed subset requiring `--no-file-parallelism` + `.env.local` (`docs/testing.md`), untouched by this pipeline (zero `src/` diff).

## End-to-End Tests

Total: 164 | Passed: **164** | Failed: **0** | Skipped: **0** | Flaky: **0** | Duration: 3.7 min

One run, `--workers=1`, on port 3600, after `rm -rf .next` **and** `rm -rf e2e/support/.auth` (cold session acquisition for all fixture actors). Phase 4's 164/0/0 reproduced independently. Zero skip lines in the reporter output — verified by grep, not inferred from the exit code.

Per-file durations for the four new specs against Phase 3's budgets:

| File | Cases | This run | First pass | Budget |
|---|---|---|---|---|
| `e2e/presbytery-oversight.spec.ts` | 6 | 12.6s | 12.2s | ≤60s ✅ |
| `e2e/presbytery-credentials.spec.ts` | 7 | 19.3s | 20.4s | ≤75s ✅ |
| `e2e/presbytery-reports.spec.ts` | 10 | 22.5s | 25.8s | ≤90s ✅ |
| `e2e/filings-round-trip.spec.ts` | **12** (was 9) | 19.8s | 14.5s | ≤90s ✅ |
| Total added | **35** (was 32) | ~74.2s | ~72.9s | ≤5 min ✅ |
| Full suite | 164 | 3.7 min | 3.6 min | ≤12 min ✅ |

GAP-1's three cases cost **+5.3s**, matching the loop-back's ~5s estimate. `totp-full-login.spec.ts` ran green (MFA-enrolled seeded user, password → TOTP → landing); the stricter auth gate does not apply to this diff, but the evidence is on file anyway.

## Verification of the loop-back's four edits

**(1) `filings-round-trip.spec.ts` cases 10–12 — verified by reading, then by failing-first probe.**

Structure is correct. The three cases live in a **second, independent `test.describe.serial`** (`e2e/filings-round-trip.spec.ts:292`) with its own `captureFlags`/`restore` lifecycle, deliberately not folded into the round-trip block whose `beforeAll` holds the flag ON for nine cases — the header comment (`:265-291`) states that reasoning explicitly. Fixtures: `storageStatePath("org-single")` and `("org-multi")` only; no new fixture, no `src/` change, no new owner-connection code. Flag handling is the file's already-imported `captureFlags`/`setFlag`/`FlagCapture` from `e2e/support/flags.ts` (`:30`).

Each case asserts **its own anchor visible AND a sibling anchor absent**, as Phase 2 Notes §4 required:

| Case | Line | Own anchor (visible) | Sibling anchor (`toHaveCount(0)`) |
|---|---|---|---|
| 10 — flag OFF, `org-single` @ e2e-alpha | `:307` | `/isn't turned on for/i` | `/don't have permission to manage statistical filings/i` |
| 11 — flag ON, wrong org type, `org-multi` @ e2e-presbytery | `:325` | `/isn't the kind of organization this tool is built for/i` | `/don't have permission to manage statistical filings/i` |
| 12 — flag ON, no grant, `org-single` @ e2e-alpha | `:345` | `/don't have permission to manage statistical filings/i` | `/isn't turned on for/i` |

Org types confirmed against the live catalog: `e2e-alpha` = `congregation`, `e2e-presbytery` = `presbytery` — so case 11's fixture genuinely sits outside `FILINGS_ORG_TYPES`.

**Failing-first, reproduced by me on both axes.**

*Permission axis (the no-grant case, as instructed).* Resolved the ids on the live DB first (`org-single` = `org1@presby.invalid` = person `…a1`; `e2e-alpha` = `…002`; `e2e_statistics_publish` = role `…b3`). Inserted the grant on the **owner connection**:

```
insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
select 'e2e00000-…-000000000002'::uuid, 'e2e00000-…-0000000000b3'::uuid,
       'e2e00000-…-0000000000a1'::uuid, date '2020-01-01',
       (select id from users where email='admin@presby.invalid');
```

Row confirmed present (`id 115ddd78-…`, `ends_on null`). Re-ran `-g "GAP-1"` → **case 12 FAILED** at `e2e/filings-round-trip.spec.ts:357` (`expect(locator).toBeVisible() failed — element(s) not found`, locator `getByText(/don't have permission to manage statistical filings/i)`); cases 10 and 11 passed unaffected. Deleted the grant, **proved the row is gone** (`select count(*) from role_grants where person_id='…a1'` → **0**; the full `e2e%` grant list is back to exactly the three seeded rows, `a2/b1`, `a5/b2`, `a7/b3`). Re-ran → **3/3 PASS (8.3s)**. Case 12 genuinely discriminates on the grant.

*Flag axis.* I did not need a scratch copy of the spec, and did not make one. Two independent proofs:
- The `beforeAll` restore **is** SELECT-verified: `captureFlags().restore()` (`e2e/support/flags.ts:47-58`) re-reads every key after the UPDATE and throws a named error on mismatch rather than trusting the write. Confirmed live — after each of my probe runs, `org_portal.filings` was back at its baseline `false`.
- Better: case 12 does **not** set the flag itself (it inherits case 11's ON, commented at `:348-349`). So I ran `-g "12\."` **alone**, with the flag sitting at its baseline OFF → **case 12 FAILED** at the same `:357`. Cases 10 and 12 are the same fixture at the same URL with only the flag differing and mutually-exclusive anchors, so the flag axis cannot pass vacuously: if the flag had no effect one of the two must fail. That is a stronger proof than a scratch copy would have given.

**(2) `presbytery-credentials.spec.ts` is now `describe.serial`** — confirmed at `e2e/presbytery-credentials.spec.ts:59`, with a five-line comment at `:54-58` recording why (case 3 consumes case 2's side effect; plain `describe` only worked because `workers: 1`/`fullyParallel: false` happened to preserve ordering). Ran green in the full suite, 7/7. My first-pass observation is closed.

**(3) `sasr-fixture.ts` trigger verification is now `(tgname, relname)`-constrained** — `e2e/support/sasr-fixture.ts:208-217` uses a row-constructor `where (t.tgname, c.relname) in ((…),(…),(…))` joined to `pg_class`. **Probed against the live catalog myself**, not read off the Drizzle files: the exact query returns three rows, all `tgenabled = 'O'` (`congregation_statistics_freeze`/`congregation_statistics`, `publications_freeze`/`publications`, `statistical_returns_freeze`/`statistical_returns`). A broader sweep of all eleven `%_freeze` triggers plus `group_memberships_reject_derived` shows every one at `'O'` before and after the suite. My first-pass observation is closed.

**(4) F116's TODO line states the product question** — `docs/work-log/2026-09-28-presbytery-e2e.md:1752-1759`. The line now reads as a product finding ("a react-hook-form-registered native `<select>` on `statistics-form.tsx` can have a pre-hydration selection silently reverted — a data-integrity hazard on the clerk's annual form; reproduce on a production build and decide whether it is its own bug-fix pipeline"), and the superseded test-convention framing is struck through in place rather than deleted, so Phase 4's original wording stays legible for the retrospective. That satisfies orchestrator ruling 2. F116 remains outside this pipeline's scope and is for the orchestrator to apply to `docs/TODO.md` at integration.

## DB left exactly as found — byte-identical

Snapshotted the owner connection before and after the full-suite run and `diff`'d the two JSON captures: **identical, SHA-256 `628399b0…aa22` on both**. The snapshot covers:

- `select key, enabled from feature_flags order by key` → 40 rows, same four OFF (`org_portal.feature_categories`, `org_portal.filings`, `org_portal.statistical_publication`, `statistics.submission_grants`).
- `statistical_returns` in the reserved 2090–2099 band → **0 rows**, before and after.
- Alder Creek's publication → the single row `994f9867-…`, report year 2025, `withdrawn_at is null`, before and after. Un-withdrawn, as DECISION-157 requires.
- All eleven `*_freeze` triggers plus `group_memberships_reject_derived` → `tgenabled = 'O'` (live `pg_trigger`/`pg_class`, not `information_schema`).
- `role_grants` for every `e2e%` person → the three seeded rows, unchanged; **zero** rows for `…a1`, confirming my own failing-first grant was fully cleaned up.
- Row counts: `publications` 1, `statistical_returns` 1, `ordinations` 6, `appointments` 1 — all unchanged, so the loop-back's new cases leak nothing and the credentials fixtures still self-clean.

## Scope of the diff — re-confirmed

`git diff --name-only 938e1c5` → `.github/workflows/e2e.yml`, `docs/STATE.md`, `docs/testing.md`, and six `e2e/` files; untracked adds are the work-log and seven `e2e/` files. **Nothing under `src/`.** No `package.json` or lockfile change. `docs/STATE.md` appears only because the worktree branched from `4461a46`, `938e1c5`'s parent — it is not a pipeline edit (`git status` does not list it). None of the shared high-collision files (`scripts/seed-dev.sql`, `seed.ts`, `test-rls.sql`, `docs/TODO.md`, `decisions.md`, `reviews/log.md`) is touched. `grep` for `test.skip|test.fixme|test.only|describe.only` across `e2e/` returns **comment text only** — no live skip anywhere in the suite.

## Regression Tests Added

Authored by the implementer. I ran them and read them; I authored nothing and edited nothing.

New in this loop-back:

- `e2e/filings-round-trip.spec.ts:307` — flag-off state on filings. Guards against: a flag regression rendering the permission-denial copy (or vice versa). Sibling-anchor absence asserted.
- `e2e/filings-round-trip.spec.ts:325` — wrong-org-type state on filings. Guards against: a `presbytery` org reaching a congregation-only surface, or the product-not-here copy degrading into permission language.
- `e2e/filings-round-trip.spec.ts:345` — **no-`statistics.publish` state on filings.** Guards against: an under-privileged but genuinely-related member reaching the withdraw affordance on the system of record. **Failing-before / passing-after reproduced by me** via a real `role_grants` insert/delete on the owner connection (above), and independently on the flag axis.

Carried from the first pass, still green:

- `e2e/public-sites.spec.ts:381` (F114, site-kit bundle-schema rot) · `e2e/support/sasr-fixture.ts:203-225` (F115, now table-constrained) · `e2e/support/assert-fixture-invariants.ts:95`/`:134` · `e2e/presbytery-oversight.spec.ts:113`, `e2e/presbytery-credentials.spec.ts:188`, `e2e/presbytery-reports.spec.ts:213`/`:236` · `e2e/post-login-routing.spec.ts:110`/`:196`.

**All four presbytery-portal surfaces now assert all three reachable denial states** (flag off / wrong org type / no grant), each with a sibling-anchor absence check. That was the whole of GAP-1 and it is closed.

## Coverage on Critical Modules

Not re-measured, for the same reason as the first pass: this pipeline changes **zero** `src/` files, so `src/lib/permissions.ts`, `src/lib/two-factor.ts` and `src/lib/flags.ts` are bit-identical to `main` and their numbers cannot have moved. Full Vitest suite green. The release-slot `test-coverage` review is the right place for the figures.

## Feature-Gate Audit

**No protected routes touched.** Verified by reading the diff and the changed files, not inferred from green tests: the loop-back added spec cases to `e2e/filings-round-trip.spec.ts`, changed one `describe` to `describe.serial`, and tightened one catalog query in `e2e/support/sasr-fixture.ts`. No `src/app/api/**/route.ts` and no `"use server"` action was added or modified in this pipeline at all.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| — (no route handler or server action added or changed) | n/a | n/a | n/a |

**Auth gate:** the diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`, so the stricter auth-touching gate does not apply. It is satisfied anyway — the run exercised `e2e/totp-full-login.spec.ts` (password → TOTP → landing, MFA-enrolled seeded user) and all seven `totp-callback-bypass` cases against a real dev server, green.

**Session integrity:** unchanged from the first pass — the three new cases use `storageStatePath()` sessions acquired by `global-setup.ts` through the real `/api/auth/csrf` + `/api/auth/callback/credentials` endpoints. No JWT minting, no hand-forged cookie, no `auth()` stub.

## Observations (non-blocking, no action required)

1. **Case 12 cannot be run standalone** — it inherits the flag-ON state from case 11 rather than setting it, which my probe A demonstrated by failing it in isolation. Inside `describe.serial` this is legal and the code comments it at `:348-349`, but cases 10 and 11 each set their own flag state and 12 does not; a one-line `await setFlag(sql, FILINGS_FLAG, true)` would make all three self-contained and immune to a future reorder. Worth a line in whichever pipeline next edits the file, not a loop-back.
2. **Case 11 checks the forbidden anchor as its sibling, not the flag-off anchor.** Phase 2 §4 asks for "at least one" sibling, so this satisfies the ruling; the flag-off anchor would be the more discriminating choice given the flag is deliberately ON for that case.
3. **The F115 trigger check can still pass vacuously** if a `(tgname, relname)` pair ever disappears entirely — `rows.length` is not asserted to be 3, so a dropped trigger reads as "nothing not-enabled." The table constraint I asked for is correctly implemented and this weakness predates it; a `if (rows.length !== 3) throw` would close it.
4. Process note, repeated from the first pass: dev-only Neon connection strings for a pipeline branch slated for deletion pass through this transcript. Nothing entered a file.

## Verdict

**PASS**

GAP-1 is closed on the evidence, not on assertion. The three new filings cases each assert their own state anchor visible and a sibling anchor absent, use only the existing `org-single`/`org-multi` fixtures and the file's own SELECT-verified flag capture/restore, and I reproduced failing-first myself on **both** axes — inserting the real `e2e_statistics_publish` grant made case 12 fail at `e2e/filings-round-trip.spec.ts:357` and deleting it (row proven gone) made it pass, and running case 12 against the baseline flag-OFF state failed it for the flag reason. `presbytery-credentials.spec.ts:59` is `describe.serial`; `sasr-fixture.ts:208-217` constrains by `(tgname, relname)` and I probed the live catalog to confirm all three pairs report `'O'`; the F116 line states the product question with the superseded wording struck through in place. Full suite 164 passed / 0 failed / 0 skipped on a fresh `.next` and a cold `.auth/`; typecheck, lint and all five tripwires green; the database is byte-identical before and after (same SHA-256 over flags, the empty 2090s band, Alder Creek's un-withdrawn 2025 publication, every freeze trigger at `'O'`, and the e2e grant set); and `git diff --name-only 938e1c5` still shows nothing under `src/`.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (second pass, re-verification) — GAP-1 closed and independently re-proven failing-first on both the grant and flag axes; credentials `describe.serial`, `(tgname, relname)` trigger check probed against the live catalog, F116 line states the product question; 164/0/0 on fresh `.next` + cold `.auth`, DB byte-identical (SHA-256 match), typecheck/lint/`check` green, nothing under `src/`; three non-blocking observations carried forward | PASS | 2026-09-28 |

## Handoff

**Next: analyst (Phase 6 — shipped vs intent).** Compare the delivered suite against Phase 1's five surfaces and their four negative states: all four presbytery-portal surfaces (oversight, reports, credentials, filings) now assert flag-off + wrong-org-type + no-grant, the round trip stages publication through the product's own `presby_publish_sasr_snapshot()` and never touches Alder Creek's 2025 row, and F113/F114/F115 are fixed. Worth the analyst's attention in Phase 6: Phase 1 Gap 3 (the publish leg has no UI and is staged, never browsed) is an accepted intent-vs-shipped divergence, not a defect; the 360px filings scroller is asserted positively as a known residual rather than hidden; and the `header-controls.spec.ts:110` flake was not reproduced by either Phase 4 or me (20/20 standalone in the first pass), so its TODO line stays open.

**For the orchestrator, not the implementer:** F116 and the three observations above are integration-time `docs/TODO.md` lines, along with the Phase 2 proposals (correcting the `public-sites.spec.ts:334` "resolves on merge" claim, and the two fixture-migration follow-ups). The retrospective note stands: Phase 3 dropped an accepted Phase 2 ruling without notation, which is what cost this pipeline a loop-back.

### Orchestrator note (2026-09-28)

Observations 1–3 (case 12 self-containment; case 11's sibling choice; the F115 check asserting `rows.length === 3`) become one `docs/TODO.md` follow-up line at integration; the retrospective note (Phase 3 dropped an accepted Phase 2 ruling without notation) is carried to the next release-slot retrospective.

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
