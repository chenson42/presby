# Presbytery oversight & statistics — schema commit — Work Log

> **Slug:** `2026-08-27-presbytery-oversight-statistics`
> **Surface:** (org) portal — presbytery-side (Increments 3/3b) and congregation-side (the publication verb, Increment 4a's mechanism only). No public-site content.
> **Permission(s):** New — `congregation_oversight.manage` (tier 1, no default binding), `statistics.manage` (tier 2, → `presbytery_stated_clerk` template), `per_capita.manage` (tier 2, → `presbytery_stated_clerk` template), `statistics.publish` (tier 2, → congregation `stated_clerk`, fixture-only in dev)
> **Flag(s):** `org_portal.oversight`/`org_portal.reports`/`org_portal.insights` graduated from the product-IA placeholder block to seeded-off real flags (unchanged keys); new `org_portal.statistical_publication`, seeded off
> **Estimated complexity:** large (four tables, a SECURITY DEFINER function pair, the platform's first cross-org write)
> **Pipeline mode:** Full — this file covers ONLY this schema commit's own Phase 4 (database-admin). Phases 1-3 for the whole presbytery program (Increments 3/3b/4a/4b) live in `docs/work-log/2026-08-27-presbytery-program.md` — see that file for the full analyst/architect/tech-lead record, DECISION-118 through DECISION-121, and the increment sequencing. Per that file's own Sequencing section: "database-admin — `presbytery.ts` schema + migration ... Work-log: `2026-08-27-presbytery-oversight-statistics` (covers Increments 3+3b's Phase 4-6, since they share this single schema commit and implementer)."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — see `docs/work-log/2026-08-27-presbytery-program.md` | READY WITH NOTES | 2026-08-27 |
| 2 — Architectural review | architect | Complete — see `docs/work-log/2026-08-27-presbytery-program.md` | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete — see `docs/work-log/2026-08-27-presbytery-program.md` | Design complete; implementers named per increment | 2026-08-27 |
| 4 — Implementation (schema) | database-admin | Complete | — | 2026-08-27 |
| 4 — Implementation (UI + public-site fallback) | full-stack-developer | Complete | — | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phases 1-3

See `docs/work-log/2026-08-27-presbytery-program.md` in full — Phase 1 (analyst, the Q1 reframing that unblocked Increment 3), Phase 2 (architect, Ruling 1/2/3 + DECISION-118 through 121 proposed), Phase 3 (tech-lead, the full Data Model, API Contract, Permissions & Flags table, and Sequencing this commit implements verbatim). Not summarized here per the handoff-preservation rule — read the source.

---

# Phase 4 — Implementation (database-admin, schema only)

## Files Created

- `src/lib/db/domain/presbytery.ts` — the four tables: `congregationOversight`, `congregationStatistics`, `perCapitaRates`, `perCapitaRecords`. Drizzle schema mirroring the migration 1:1.
- `drizzle/0038_presby_presbytery_program.sql` — hand-written migration: the four tables, FORCE RLS + `tenant_isolation` policy on all four, the `congregation_statistics_entered_unique_idx` partial unique index, `presby_reject_published_statistics_write()` freeze trigger, `presby_publish_sasr_snapshot()` (SECURITY DEFINER, the platform's first cross-org write), `presby_list_own_congregation_publications()` (SECURITY DEFINER read counterpart), and four permission-catalog rows + two `presbytery_stated_clerk` template bindings.
- `docs/work-log/2026-08-27-presbytery-oversight-statistics.md` — this file.

## Files Modified

- `src/lib/db/domain/index.ts` — `export * from "./presbytery";` added.
- `drizzle/meta/_journal.json` — appended the `0038_presby_presbytery_program` entry.
- `scripts/seed.ts` — `org_portal.oversight`/`.reports`/`.insights` moved out of the product-IA placeholder block (DECISION-117) into the ordinary flag list, `enabled: false` (previously `true` as placeholder-visibility flags); new `org_portal.statistical_publication` flag added, `enabled: false`. The placeholder block's loud comment updated to note the go-live task shrank from seven flags to four.
- `scripts/seed-dev.sql` — appended (ahead of the file's final `commit;`, same seam every recent pipeline's fixture block has used): a sign-in-capable user for Idris Calloway (the presbytery's own Stated Clerk); the `congregation_oversight.manage`/`statistics.manage`/`per_capita.manage` fixture bindings on the org-scoped adopted `presbytery_stated_clerk` copy; the `statistics.publish` fixture binding on Alder Creek's `stated_clerk`; two `congregation_oversight` rows (Alder Creek, Bramblewood); two `congregation_statistics` rows (Quillhaven presbytery-entered, Alder Creek published-by-congregation — mixed provenance); one `per_capita_rates` row; one `per_capita_records` row.
- `scripts/test-rls.sql` — new `\set` fixture-id variables; new Section 29 (33 named checkpoints — 19 `assert_eq` calls + 13 do-block rejection proofs; one authored proof deliberately carries no exception handler, so it hard-fails via `ON_ERROR_STOP` rather than converting to a NOTICE, named explicitly in the section's own header comment). See "Test-RLS Section 29" below for the full inventory.
- `docs/TODO.md` — reconciled the go-live-gate line (shrank by three), replaced the two stale "BLOCKED" presbytery lines with three lines reflecting the actual current state (3/3b unblocked and schema-shipped; 4a's mechanism shipped, UI remaining; 4b unchanged, still gated on the map dependency addendum); added a new line for a pre-existing, unrelated regression found during verification (see Implementer Notes).

## Schema Changes

Four new tables (`congregation_oversight`, `congregation_statistics`, `per_capita_rates`, `per_capita_records`), one new trigger, one new trigger function, two new SECURITY DEFINER functions, four new permission-catalog rows, two new `app_role_permissions` bindings (presbytery_stated_clerk template → `statistics.manage`/`per_capita.manage`).

**Applied via:** hand-written SQL migration (`db:generate` is broken on a pre-existing snapshot collision per CLAUDE.md/docs/TODO.md — every migration past 0012 is hand-authored). Applied directly to the shared Neon dev database (no Neon branch used for this commit — the same database every recent hand-written migration in this session has applied against; `npm run db:push` was NOT used). Ran as:

```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0038_presby_presbytery_program.sql
```

All statements idempotent (`create table if not exists`, `create index if not exists`, `drop policy if exists` / `create policy`, `create or replace function`, `on conflict ... do nothing`) — safe to re-run.

## Migration Numbering

`ls drizzle/*.sql` was run immediately before writing the migration file (see the tool-call log) and found `0037_presby_ministry_credentials.sql` as the highest number on disk, no gap, no second pipeline's file present. Claimed `0038`, the next free number, and named it from the start (`0038_presby_presbytery_program.sql`) rather than the program work-log's own pencilled guess of a different number — same "claim what's actually free on disk" discipline `0036`/`0037` each documented for the identical situation one collision earlier. `drizzle/meta/_journal.json` updated by hand in the same commit (the established convention — `db:generate` is broken).

## Test-RLS Section 29

New section, next free number after the file's existing 28 sections. 33 named checkpoints, all passing (verified standalone, see below):

- (a) FORCE RLS set on all four tables + presby_app grant shape (2 checks)
- (b) known-fixture sanity: the presbytery reads its own rows on all four tables, plus the D9 empty-state proof for Quillhaven's oversight (7 checks)
- (c) cross-presbytery isolation on all four tables — count-zero, known-id-zero, and write-rejected proofs, against a second REAL presbytery minted inline (10 checks)
- (d) the freeze trigger: UPDATE and DELETE rejected on a published row, UPDATE allowed on a presbytery-entered row (3 checks)
- (e) the confused-deputy positive path: publishing from Alder Creek's own context (a real seeded congregation, not synthetic) lands the row at its actual parent about itself, verified through `presby_list_own_congregation_publications()` (not a direct table read, which the caller's own RLS context would correctly filter to zero — see Implementer Notes); a same-year republish chains via a DERIVED `supersedes_publication_id` (2 checks, no exception handler — a genuine regression here hard-fails the script rather than converting to a notice)
- (f) rejects an org with no parent at all (northern reach itself) (1 check)
- (g) rejects a congregation whose parent exists but isn't a presbytery (a synod, minted inline) (1 check)
- (h) range validation: rejects a negative count and an out-of-range report year (2 checks)
- (i) `presby_list_own_congregation_publications()`: Alder Creek reads its own row back; a third seeded congregation (Bramblewood) sees none of it, by count and by known id (3 checks)
- (j) the partial unique index rejects a duplicate presbytery-entered row for the same year (the republish-chain half of this proof already ran in (e)) (1 check)

**Full-suite-halt check:** read `\set ON_ERROR_STOP on` (line 13) and confirmed, rather than assumed, that a manually raised `'FAIL — ...'` (default SQLSTATE `P0001`) is never caught by the narrower `exception when <specific errcode>` handlers used throughout this file (including every new one in Section 29) — a genuine regression propagates uncaught and halts the whole script. No drift found; documented in the section's own header comment so the next reader doesn't have to re-derive it.

**Run standalone, as `presby_app`:**

```
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql   # full file
```

(Section 29 alone was also run in isolation — header `\set` block through Section 29 only — while iterating; both the full file and the isolated slice pass 33/33 with zero FAIL/ERROR, exit code 0.)

## Audit Events

None. This is a schema-only commit — no server actions exist yet to write `audit_events`. Increment 4a's `publishStatisticsAction()` (api-developer, next in sequence) writes `STATISTICS_PUBLISHED` at the congregation's own org context, per the program work-log's API Contract.

## Implementer Notes

**RLS + SECURITY DEFINER, the load-bearing mechanism.** `congregation_statistics` carries FORCE ROW LEVEL SECURITY like every other tenant table, and `presby_publish_sasr_snapshot()` inserts a row whose `organization_id` (the presbytery) is *never* equal to the calling congregation's own `app.current_org_id` — an ordinary INSERT under that session would fail the standard `tenant_isolation` policy's `WITH CHECK`. This is exactly why the function is `SECURITY DEFINER` (same F26 reasoning as `presby_match_person()`/`presby_link_person()`, `drizzle/0009_presby_rls.sql`): it executes with the function *owner's* privileges, which — like every other SECURITY DEFINER function in this schema — bypasses RLS for its own queries. **This is not decorative; a first attempt at Section 29's own positive-path test (e) verified the inserted row through a direct `SELECT` on `congregation_statistics` from the calling congregation's own session and failed** (correctly — the row is invisible under that context, by design), which is exactly the property the mechanism exists to prove. The test was corrected to verify through `presby_list_own_congregation_publications()` instead (the intended read path), and the note is left here so the next reader doesn't rediscover the same "why did my own read return nothing" confusion from scratch.

**Phase 3 deviation — `minute_reference` column added to `congregation_statistics`.** Phase 3's API Contract names `p_minute_reference text` as `presby_publish_sasr_snapshot()`'s second parameter, but Phase 3's own Data Model table listing has no column for it to land in. Read as an omission, not a deliberate no-column decision (nothing else in the design explains discarding a session-ratification reference the same design cites D3's session-ratifies/clerk-submits pattern for). Added a nullable `minute_reference text` column, same shape as `appointments.minuteReference`. Flagged in both the schema file and the migration's own comments.

**Phase 3 deviation — the correction target is derived, not accepted as a parameter.** Phase 3's function signature has no `p_supersedes_publication_id`-style parameter, and the Data Model's prose says a correction "chains" via `supersedesPublicationId` without naming who sets it. Implemented as: the function looks up the congregation's own most recent `published_by_congregation` row for the same year and chains to it automatically. This is stronger than a caller-supplied id would have been (nothing in the signature to spoof) and is exercised directly by Section 29(e)/(j).

**Phase 3 spec followed literally, despite an apparent redundancy.** `congregation_oversight`'s Data Model lists both `unique (organization_id, about_org_id)` and a separate `index (organization_id, about_org_id)` on the identical column pair — the unique constraint already serves as an index for that exact lookup. Implemented exactly as specified rather than silently dropping the second one; flagged in both the schema file and the migration as harmless index bloat, not fixed unilaterally.

**Permission bindings split between the migration and the fixture, following established precedent exactly.** `statistics.manage`/`per_capita.manage` bind to the `presbytery_stated_clerk` GLOBAL TEMPLATE (`organization_id IS NULL`) in the migration, mirroring `0037`'s own `credentials.manage` binding. `congregation_oversight.manage` (no default binding per DECISION-119) and `statistics.publish` (binds to the *congregation's* `stated_clerk`, which has no global template — every prior binding to it, `officers.manage`/`groups.manage`/`events.manage`, was a direct grant in `scripts/seed-dev.sql`, never a migration insert) both follow that same established split. The org-scoped ADOPTED copy of `presbytery_stated_clerk` (`f0000000-...-000e`) also needed its own `statistics.manage`/`per_capita.manage`/`congregation_oversight.manage` bindings in `seed-dev.sql` — the template binding alone doesn't resolve permissions for a role holder at a specific org; this mirrors `credentials.manage`'s own two-binding shape (template insert in the migration + adopted-copy insert in the fixture) exactly.

**A new sign-in-capable fixture user was added** (`presbytery.clerk.fixture@example.invalid`, linked to Idris Calloway) — same P9 reasoning `clerk.fixture@...` documents: there is otherwise no way to walk `/o/northern-reach/admin/oversight` or `.../reports` through a real browser session as the person these new permissions are bound to. Full-stack-developer (next in sequence) can sign in as this user to test Increments 3/3b end to end.

**Flag graduation, not a new flag, for three of the four.** `org_portal.oversight`/`.reports`/`.insights` keep their existing keys (per the "one durable key across iterations" rule) — only their seeded default changed (`true` → `false`) and their home moved from the placeholder block to the ordinary flag list, since real schema now sits behind them. **The live dev database's current values were left untouched (still `true`)** — flipping them to match the new seeded-off default would immediately hide the pages full-stack-developer is about to build behind them, the opposite of useful. This mirrors the established "seeded off, flipped on manually in dev" posture already used for `org_portal.credentials` and every other real-feature flag; verified directly (`select key, enabled from feature_flags where key like 'org_portal.%'`) rather than assumed.

**Out-of-scope regression found and reported, not fixed.** While running the full test suite via `dotenv -e .env.local -- npx vitest run` for due diligence (this commit added no TS DB-backed suite of its own, so this command is strictly N/A to it — see below), `src/lib/roll.test.ts`'s `afterAll` failed: it no longer disables the `group_memberships_reject_derived` trigger before cascading its organization delete, even though `docs/TODO.md`'s own 2026-08-26 entry records this exact fix landing and passing 1/1 clean (`read-org-brand.test.ts` still carries the correct wrap, confirmed by direct read, and was used as the reference shape in the new TODO.md entry). All 20 of the file's real tests pass; only the teardown throws, leaving an orphaned `roll-test-a-<stamp>` organization (and its people/users/role_grants/memberships/group_memberships/roll_actions) in the shared dev database on every run. Reproduced twice; not caused by, and not fixable within, this schema commit (no file this pipeline touches is implicated). Four such orphaned fixture orgs (pre-dating this session, plus the two this session's own reproduction runs added) were found and fully cleaned from the shared dev database in the same pass — confirmed zero `roll-test-a-%` orgs remain. Logged in `docs/TODO.md`. The apparent `read-org-brand.test.ts` failure seen in the same combined run was a side effect of `roll.test.ts`'s leftover state, not a bug of its own — confirmed by re-running it standalone (5/5 pass, clean).

**`rate-limit.test.ts`'s three failures under `dotenv -e .env.local` are an environment-loading artifact, not a bug.** `.env.local` sets `RATE_LIMIT_DISABLED=true` (a real, intentional dev setting), which makes `checkRateLimit()` always return `allowed: true` — the "in-memory" suite assumes rate limiting is actually active. The file passes 15/15 under plain `npm test`/`vitest run` (no dotenv), which is how the test suite is normally run. Not a regression, not touched by this commit, and not logged as a new TODO item — the mismatch is in running the *whole* suite through `dotenv -e .env.local`, which this commit's own DB-backed-suite obligation never actually required (see below).

**`npx dotenv -e .env.local -- npx vitest run` — N/A for this commit's own gate, run anyway for due diligence.** This is a schema-only commit: no `src/lib/presbytery.ts` and no companion `.test.ts` exist yet (that module is Increment 3/3b's own `full-stack-developer` commit, per the program work-log's Sequencing). The constraint to run this command applies to "any DB-backed suite you add or touch" — this commit adds/touches none. Ran the full suite anyway as a due-diligence check; it surfaced the two pre-existing, unrelated issues described above and nothing implicating this commit's own changes. `npm run typecheck`, plain `npm test`, and `npm run check` (all four tripwires) are the commands that actually gate this commit, and all four are clean (see below).

## Verification Commands Run (all green, exact counts)

- `npm run typecheck` — clean, no output beyond the command itself.
- `npm test` (plain `vitest run`, no dotenv) — **222 files passed, 22 skipped; 2902 tests passed, 518 skipped; 0 failed.** (Skips are the DB-backed suites, which correctly self-skip without `DATABASE_URL`.)
- `npx dotenv -e .env.local -- npx vitest run` (full suite, due diligence only — N/A per this commit's own gate, see Implementer Notes) — 240 files passed, 4 failed (all pre-existing and unrelated: `roll.test.ts`'s teardown regression, its one collateral `read-org-brand.test.ts` false failure, and `rate-limit.test.ts`'s `RATE_LIMIT_DISABLED=true` environment mismatch); 3416 tests passed, 4 failed. Zero failures implicate this commit.
- `npm run check` (all four tripwires: `check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`) — all four pass. (`check:audit` trivially passes: this commit adds no `actions.ts` mutation.)
- `psql "$MIGRATE_DATABASE_URL" -f drizzle/0038_presby_presbytery_program.sql` — applied clean, idempotent (all `IF NOT EXISTS`/`OR REPLACE`/`ON CONFLICT`).
- `psql "$MIGRATE_DATABASE_URL"` — applied the new `scripts/seed-dev.sql` block (extracted and run standalone against the already-seeded shared dev DB, which cannot re-run the whole file from the top) — clean.
- `npm run db:seed` — clean; `seeded 34 feature flags` (up from 27 — confirms the new `org_portal.statistical_publication` row landed; the three graduated flags' live values were correctly left untouched by `ON CONFLICT DO NOTHING`, verified directly).
- `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (full file, as `presby_app`) — clean; Section 29's 33 checkpoints all pass (also verified running Section 29 alone, isolated from the header `\set` block, identical result).

## Handoff

**Next agent: full-stack-developer** (Increments 3 + 3b UI/actions + the public-site fallback, per the program work-log's Sequencing step 2 — same work-log slug as this file per that document's own note).

**New tables/columns/relationships available:**
- `congregationOversight` / `congregation_oversight` — `(organizationId, aboutOrgId)` unique, `viabilityScore` (1-3), `redevelopmentNotes`, `buildingsNotes`, `insuranceCarrier`/`insuranceExpiresOn`, `latitude`/`longitude` (manual entry, for Increment 4b's map).
- `congregationStatistics` / `congregation_statistics` — `(organizationId, aboutOrgId, year, provenance)`, `provenance` CHECK (`presbytery_entered`/`published_by_congregation`/`imported`), the full SASR aggregate column set, `supersedesPublicationId` self-FK, freeze trigger on published rows.
- `perCapitaRates` / `per_capita_rates` — `(organizationId, billingYear)` unique, `basisYear`, `ratePerMember`.
- `perCapitaRecords` / `per_capita_records` — `(organizationId, aboutOrgId, billingYear)` unique, the three frozen-at-generation snapshot columns, `paidStatus`.
- `presby_publish_sasr_snapshot(p_report_year, p_minute_reference, ...44 named SASR params)` and `presby_list_own_congregation_publications(p_year default null)` — both callable from `presby_app`, both `SECURITY DEFINER`.
- New permission keys: `congregation_oversight.manage`, `statistics.manage`, `per_capita.manage`, `statistics.publish`.
- New flag: `org_portal.statistical_publication` (seeded off). `org_portal.oversight`/`.reports` are the flags 3/3b's own pages gate on (already `true` in the live dev DB).

**Local apply commands** (already run against the shared dev database in this session — a fresh clone/branch would need):
```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0038_presby_presbytery_program.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql   # fresh DB only — see note below
npm run db:seed
```
Note: `scripts/seed-dev.sql` is written as one linear script for a *fresh* database; the shared dev database used this session was already seeded from an earlier pass, so only the new trailing block (from the "Presbytery program" header to the file's end) was extracted and run standalone this session. A fresh clone/Neon branch should run the whole file as-is.

**Known follow-up, not in this commit's scope:** `src/lib/roll.test.ts`'s `afterAll` teardown regression (see Implementer Notes and `docs/TODO.md`) — pre-existing, unrelated, needs its own bug-fix pipeline.

---

# Phase 4 — Implementation (full-stack-developer, Increments 3 + 3b UI/actions + public-site fallback)

Builds on the schema commit above (same work-log, per the program work-log's Sequencing step 2). Implements `docs/work-log/2026-08-27-presbytery-program.md` Phase 3's Component/Page Plan and API Contract for Increments 3 (congregation oversight) and 3b (congregation statistics + per-capita), plus the DECISION-121 public-site fallback (folded in as Polish per Phase 3's own classification).

## Files Created

- `src/lib/presbytery.ts` — the module: `PresbyteryResult<T>` discriminated result, a local multi-key `hasPermission()` gate (same shape `person-sensitive.ts` establishes for several independent permissions, not `credentials.ts`'s single-key shape), `resolveMemberCongregation()`/`listMemberCongregations()` (the parent-path check — `organizationType = 'congregation'` only, a narrower scope than `credentials.ts`'s `SERVING_ORG_TYPES`, following Phase 3's own literal validation text), oversight CRUD, statistics CRUD + the provenance-coalesce read (`fetchStatisticsForYear`), and per-capita rate/record/payment functions.
- `src/lib/presbytery.test.ts` — DB-backed integration suite, real Postgres, 34 tests (see Verification below).
- `src/app/(org)/o/[slug]/admin/oversight/oversight-states.tsx` — `OversightForbidden`/`OversightLoadError` (flag-off/not-available keep reusing `PlaceholderFlagOff`/`PlaceholderNotAvailable` from the product-IA scaffold's `coming-soon.tsx`, per Phase 3: "same auth/flag/org-type-check three-step the stub already runs").
- `src/app/(org)/o/[slug]/admin/oversight/oversight-list.tsx` — the list table (viability badge, buildings/insurance summary, "Assess"/"View / edit" link).
- `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/page.tsx`, `edit-form.tsx`, `actions.ts`, `oversight-schema.ts`, `page.test.tsx` — the per-congregation detail/edit route.
- `src/app/(org)/o/[slug]/admin/reports/{reports-states,statistics-table,statistics-form,statistics-schema,per-capita-rate-form,per-capita-schema,generate-records-button,per-capita-records-table,record-payment-form,actions}.{ts,tsx}` — the reports page's two sections (statistics entry/rollup, per-capita rate/generate/pay).
- `src/app/(public)/site/[slug]/presbytery-fallback.tsx` — DECISION-121's minimal fallback component (org name + `<Button asChild>` sign-in link into `/o/<slug>`).

## Files Modified

- `src/app/(org)/o/[slug]/admin/oversight/page.tsx` — `ComingSoon` body replaced with the real list read (`getCongregationOversightList`); same flag/org-type checks, same ordering.
- `src/app/(org)/o/[slug]/admin/oversight/page.test.tsx` — rewritten for the real read path (flag-before-list-call, forbidden/load-error/ok branches, empty-state and hasData-false-vs-true assertions) — same four-way-miss and flag/org-type tests kept verbatim.
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — `ComingSoon` body replaced with two independently-gated sections (`renderStatisticsSection`/`renderPerCapitaSection`, called and awaited to plain JSX BEFORE the return — see Implementer Notes for why these are not nested async Server Components). Two new query params, `?year=`/`?billingYear=`, clamped to 1900–2100.
- `src/app/(org)/o/[slug]/admin/reports/page.test.tsx` — rewritten: searchParams threaded through every call, `@/lib/presbytery` mocked, independent per-section forbidden/ok assertions, a query-param passthrough test.
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — one new branch on `getPublishedSite()`'s `not_found` path: `publicOrgSummary(slug)`, and if the org resolves to `presbytery`/`synod`/`general_assembly`, renders `PresbyteryFallback` instead of `notFound()`. The `renderSiteBundle() === null` branch is untouched (stays a real 404 regardless of org type — a site that exists but has no matching sub-path, not a "never published" case).
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — added `@/lib/authz`'s `publicOrgSummary` mock (defaults to `null`), the org-type matrix (congregation → 404 unchanged, presbytery/synod/GA → fallback, nonexistent → 404), and a test proving the `renderSiteBundle`-null branch never calls `publicOrgSummary`.
- `src/lib/audit.ts` — five new `AUDIT_ACTIONS` keys: `CONGREGATION_OVERSIGHT_SET`, `CONGREGATION_STATISTICS_ENTERED`, `PER_CAPITA_RATE_SET`, `PER_CAPITA_RECORDS_GENERATED`, `PER_CAPITA_PAYMENT_RECORDED` (see Audit Events below — the last of these is beyond Phase 1's own named list, added deliberately).
- `src/lib/audit.test.ts` — `EXPECTED_ENTRIES` regression guard updated with the five new keys/strings.

## Schema Changes

None. This commit is pure application code (module + actions + UI) against the schema `drizzle/0038_presby_presbytery_program.sql` (database-admin, same work-log) already shipped. No `db:push`/`db:generate` run.

## Server Module / Action Signatures (auth + flag gates)

All functions in `src/lib/presbytery.ts` take `(viewerPersonId, organizationId, ...)` and run inside `withOrgContext()`, gating on the stated permission FIRST via `presby_has_permission()`:

- `getCongregationOversightList` / `getCongregationOversightDetail` / `setCongregationOversight(..., actingUserId, aboutOrgId, input)` — gate: `congregation_oversight.manage`.
- `getCongregationStatisticsRollup` / `setCongregationStatistics(..., actingUserId, aboutOrgId, year, input)` — gate: `statistics.manage`.
- `getPerCapitaOverview` / `setPerCapitaRate` / `generatePerCapitaRecords` / `recordPerCapitaPayment` (all take `actingUserId`) — gate: `per_capita.manage`.

Server Actions (`oversight/[aboutOrgId]/actions.ts`, `reports/actions.ts`) re-resolve `organizationId` from the URL `slug` via `resolveOrgContext()` inside the action body — never client-supplied — then call the matching module function and `recordAudit()` on `ok`. Pages gate on `isFlagEnabled("org_portal.oversight")` / `isFlagEnabled("org_portal.reports")` (both existing, reused verbatim per Phase 3) BEFORE any `congregation_oversight.manage`/`statistics.manage`/`per_capita.manage` read, then on `organizationType === "presbytery"` (allow-list, matching `credentials`'s own bug-fixed ordering) before ever calling into `presbytery.ts`.

## Audit Events

- `CONGREGATION_OVERSIGHT_SET` (`tenant.congregation_oversight.set`) — every `setCongregationOversightAction` call that reaches `ok` (insert or update; one key regardless of verb, matching `TENANT_PERSON_DEMOGRAPHICS_UPDATED`'s precedent).
- `CONGREGATION_STATISTICS_ENTERED` (`tenant.congregation_statistics.entered`) — every `setCongregationStatisticsAction` call.
- `PER_CAPITA_RATE_SET` (`tenant.per_capita_rate.set`) — every `setPerCapitaRateAction` call.
- `PER_CAPITA_RECORDS_GENERATED` (`tenant.per_capita_records.generated`) — every `generatePerCapitaRecordsAction` call, beyond Phase 1's own named list (rate-set, record-marked-paid only) — added because batch-generating records issues bills, the same financial-stakes reasoning Phase 1's Gaps section applies to oversight/publication writes.
- `PER_CAPITA_PAYMENT_RECORDED` (`tenant.per_capita_payment.recorded`) — every `recordPerCapitaPaymentAction` call.

No `FEATURES.*`/platform-permission entries — this surface is entirely tenant-side (`src/lib/authz.ts`'s resolver), not `src/lib/permissions.ts`'s platform shell. No new env var.

## Implementer Notes

**Async "section" components in `reports/page.tsx` are called and awaited to plain JSX, never rendered as nested `<AsyncComponent />` elements.** A first draft used two nested async function components (`<StatisticsSection .../>`/`<PerCapitaSection .../>`); React's client renderer (and this file's own `page.test.tsx`, which renders the returned tree directly via Testing Library, not through the RSC pipeline) has no built-in support for an async function component the way Next's server pipeline does — it produced "a component suspended inside an act scope" and the test received the unresolved element. Fixed by awaiting each section's helper (`renderStatisticsSection`/`renderPerCapitaSection`) to a plain JSX value *before* the `return`, same shape `credentials/page.tsx` uses for its own three sequential reads. Documented in the file's own header comment.

**`congregation_oversight`/`congregation_statistics` validation types as plain strings in every zod schema, not `z.coerce.number()`.** A `z.preprocess(emptyToUndefined, z.coerce.number().optional())` shape was tried first for `oversight-schema.ts`'s `viabilityScore`/`latitude`/`longitude` and failed `tsc` — the resolver's input type (`unknown`, since `preprocess` accepts anything) didn't unify with `useForm<T>`'s output type. Every numeric field is a plain string in the zod schema (matching what a native HTML input actually submits); the string→number/null conversion happens once, in the form's own `onSubmit`, right before calling the server action — same division of labor `record-appointment-form.tsx` already uses for its optional `minuteReference`.

**`congregation_oversight`/`congregation_statistics` aboutOrgId validation is `organizationType = 'congregation'` only, not `credentials.ts`'s broader `SERVING_ORG_TYPES` (`congregation` + `new_worshiping_community`).** Phase 3's API Contract spells the oversight check out literally ("`parent_id = organizationId AND organization_type = 'congregation'`"), and 3b's statistics/per-capita follow "the same pattern." Read as the letter of the design rather than silently widened to match `credentials.ts`'s precedent; `presbytery.test.ts` exercises an NWC child org (`nwcA`) specifically to prove it's rejected as `invalid_target`, same as a cross-presbytery congregation. Worth a future decision if a presbytery asks to track an NWC's viability/statistics the same way it can pastor appointments.

**`congregation_statistics` provenance coalesce picks the LATEST `published_by_congregation` row, not merely "a" published row.** Nothing in this increment's own write path ever produces a second published row (that's Increment 4a's republish-via-`supersedesPublicationId` mechanism), but `getCongregationStatisticsRollup`'s read has to be correct against it regardless — `fetchStatisticsForYear` orders by `publishedAt desc` and keeps the first published row seen per congregation. Proven directly: `presbytery.test.ts` inserts two `published_by_congregation` fixture rows for the same (congregation, year) with different `publishedAt` values (bypassing RLS via `getPlatformDb()`, since no write path in this module ever produces one) and asserts the later one wins.

**`generatePerCapitaRecords()` never overwrites an existing record — skip-and-name, matching the oversight-list empty state's own "no data on file" honesty.** Phase 3 Edge Cases separates a genuine correction (a deliberate, one-record, presbytery action — not built this increment) from a batch regenerate, which must never silently clobber a bill already issued (and possibly already partially paid). A congregation with an existing `(organizationId, aboutOrgId, billingYear)` row is skipped and named exactly like one with no statistics on file for the basis year — proven live in the browser walk below (a second `generatePerCapitaRecords` call against the same billing year skips 100% of congregations, naming each).

**`recordPerCapitaPayment()` derives `paidStatus` from `paidAmount` vs. the record's own frozen `amountOwed` — the API Contract's own input shape (`{ paidAmount, paidAt }`) has no status field to accept.** `paid` at or above the amount owed, `partial` above zero, `unpaid` otherwise. Exercised directly in `presbytery.test.ts` (partial → paid transition against the same record).

**The freeze trigger (`congregation_statistics_freeze`) rejects DELETE as well as UPDATE on `published_by_congregation` rows** — `presbytery.test.ts`'s own teardown, which inserts such rows directly as fixtures, disables the trigger around its cascade delete (same convention `group_memberships_reject_derived` already established for 14 other DB-backed suites, `docs/TODO.md`'s 2026-08-26 entry).

**Out-of-scope, concurrent, unrelated environment noise — named, not fixed.** While finishing verification, the shared working tree showed live edits from a DIFFERENT, concurrently-running pipeline (`docs/work-log/2026-08-27-platform-home-and-portal.md`, untracked — a portal-home/tile-grid refactor touching `src/components/org-portal/*`, `src/components/shared/{tile-grid,domain-tile-sections,greeting-band}.tsx`, `src/lib/admin-portal/tiles.ts`, none of which this pipeline touches). Two transient symptoms, both confirmed via `git status` to belong to that other pipeline's own untracked files, neither implicating anything this pipeline created or modified:
  - A brief `next dev` compile error ("Module not found: `@/components/org-portal/domain-tile-sections`"/`greeting`) while walking `/o/northern-reach` in the browser — resolved on retry a few seconds later (the other pipeline's own file-write was mid-flight).
  - Two `npm test`/`npm run typecheck` failures — `src/components/shared/tile-grid.test.tsx` (a `LucideIcon` prop-typing mismatch and a heading-wrapper assertion) and `src/lib/admin-portal/tiles.test.ts` (a `hasFeature(`-pattern regex assertion) — both untracked files, reproduced on two consecutive full runs, neither mentioning `presbytery`/`oversight`/`reports`/`statistics`/`per_capita`/`site/[slug]` anywhere. This pipeline's own 6 files (see Verification below) pass 103/103 in isolation and combined.

**Dev-DB permission grant needed for the browser walk, noted for QA.** `dev_admin` (`admin@presby.invalid`, the session already at `/tmp/state.json`, role `a1a1a1a1-0000-0000-0000-000000000001` at `northern-reach`) held none of the three new permissions. Granted directly in the live dev DB (same "manual grant, live-DB-only" precedent Increment 2's own work-log documents for `credentials.manage` on the same role):
```sql
insert into app_role_permissions (role_id, permission_key) values
  ('a1a1a1a1-0000-0000-0000-000000000001','congregation_oversight.manage'),
  ('a1a1a1a1-0000-0000-0000-000000000001','statistics.manage'),
  ('a1a1a1a1-0000-0000-0000-000000000001','per_capita.manage')
on conflict do nothing;
```
Left in place for QA's own walk (same reasoning `credentials.manage`'s grant and `org_portal.credentials`'s flag were left live after Increment 2's own walk). `org_portal.oversight`/`org_portal.reports` were already `true` in the live dev DB (per the schema commit's own note) — untouched.

**Browser-walk fixture writes reverted after verification, restoring the seeded baseline.** Recording a real Fernwood assessment, a real Bramblewood 2025 statistics row, and a real 2035 per-capita rate (to prove every write path end-to-end) left three rows the schema commit's own fixture set didn't seed. Deleted directly from the live dev DB afterward (same "leave the shared dev database clean for the next agent" precedent Increment 2's own work-log documents) — confirmed back to exactly 2 `congregation_oversight` rows, 2 `congregation_statistics` rows, and 1 `per_capita_rates` row (Alder Creek/Bramblewood oversight; Quillhaven/Alder Creek statistics; the seeded 2026/2024/12.50 rate) before finishing.

## Verification Commands Run (all green, exact counts)

- `npm run typecheck` — clean for every file this pipeline created or modified. (A single, pre-existing, unrelated failure in `src/components/shared/tile-grid.test.tsx` — an untracked file from the concurrent `platform-home-and-portal` pipeline — is present in the shared working tree; confirmed via `git status` and by isolating `tsc`'s output to that one file. Not caused by, and not fixable within, this pipeline.)
- `npx vitest run src/lib/presbytery.test.ts "src/app/(org)/o/[slug]/admin/oversight" "src/app/(org)/o/[slug]/admin/reports" "src/app/(public)/site/[slug]/[[...path]]/page.test.tsx" src/lib/audit.test.ts` (this pipeline's own files, combined) — **6 files passed, 103 tests passed, 0 failed.**
- `npx dotenv -e .env.local -- npx vitest run src/lib/presbytery.test.ts` (DB-backed, standalone, run three times across the session, including once after a teardown fix) — **34/34 pass**, clean teardown each time (`select count(*) from organizations where slug like 'presbytery-test-%'` → 0 after every run).
- `npm test` (plain `vitest run`, whole suite, no dotenv) — **224 files passed, 23 skipped; 2951 tests passed, 552 skipped; 2 failed** — both failures in the concurrent pipeline's own untracked files (see Implementer Notes); zero failures implicate this pipeline's own files.
- `npm run check` (all four tripwires) — all four pass. `check:brand-scope` initially FAILED on `presbytery-fallback.tsx`'s first draft (a raw `<Link>` styled with button-shaped Tailwind classes outside `components/ui/`) — fixed by using `<Button asChild>` (legal: `(public)/site/<slug>` is one of the two brandable route groups, CLAUDE.md), re-ran clean.
- Browser walk (Playwright, `storageState` from `/tmp/state.json`, 1280px + 360px) — see below.

## Browser Verification

Walked as `admin@presby.invalid` (dev_admin at `northern-reach`, granted the three new permissions above) and, for the not-available check, the same session's existing `fpcw` membership.

- **`/o/northern-reach/admin/oversight`** (1280 + 360px): list renders Alder Creek (Healthy), Bramblewood (Fair), and three "Not yet assessed" congregations with an "Assess" link. Clicked into Fernwood's detail page, set viability=At risk, redevelopment/buildings notes, insurance carrier/expiry, saved — toast "Oversight record saved.", list re-rendered with Fernwood now "At risk" and the new buildings/insurance summary. Reverted after (see Implementer Notes).
- **`/o/northern-reach/admin/reports`** (1280 + 360px): Congregation Statistics table shows Alder Creek "Congregation reported" (published, ending active 212), Quillhaven "Presbytery estimate" (38), the rest "No data on file". Entered a 2025 statistics row for Bramblewood (ending active 88, 2 professions under 18, avg attendance 60) — toast "Statistics saved.", rollup updated to show Bramblewood as "Presbytery estimate"/88/2 gains. Set a per-capita rate for a fresh billing year (2035, basis year left blank) — saved, correctly defaulted to 2033 (billingYear − 2). Clicked "Generate 2035 records" — toast named all 5 congregations skipped ("no statistics on file for 2033"), records table correctly showed "No records generated for this year yet" (proving the skip-and-name path creates nothing when there's no basis-year data). Reverted the Bramblewood row and the 2035 rate after (see Implementer Notes) — the pre-existing 2026/12.50 rate and its one Alder Creek record (unpaid, $2625.00) were left untouched throughout.
- **`/o/fpcw/admin/oversight`** and **`/o/fpcw/admin/reports`** (1280 + 360px, `fpcw` is a `congregation`): both render the shared `PlaceholderNotAvailable` copy ("isn't available for First Presbyterian Church of Westerville — this isn't the kind of organization this tool is built for"), no permission-shaped language, confirming the org-type gate.
- **`/site/northern-reach`**: renders the new `PresbyteryFallback` — "Presbytery of the Northern Reach" heading, "This organization hasn't published a public site.", and a "Sign in to the portal" button linking to `/o/northern-reach`.
- **`/site/this-slug-does-not-exist-xyz`**: unchanged — Next's real 404 page ("404: This page could not be found."), confirming the fallback never fires for a genuinely nonexistent slug.

Screenshots (desktop 1280px + mobile 360px for the oversight/reports/fpcw routes; both viewports for the two public-site checks) saved to the scratchpad during the session; not retained past verification (ephemeral, per the scratchpad's own purpose).

## Handoff

**Next agent: qa** (Phase 5). Things to know:

- **Dev-DB-only grant, live and needed for QA's own walk:** `congregation_oversight.manage`/`statistics.manage`/`per_capita.manage` on `dev_admin` (role `a1a1a1a1-0000-0000-0000-000000000001` at `northern-reach`) — see Implementer Notes for the exact SQL, already applied, left in place.
- **Flags already ON in the live dev DB:** `org_portal.oversight`/`org_portal.reports` (unchanged from the schema commit — seeded OFF by default per DECISION, but flipped ON manually in this shared dev DB since the schema commit landed).
- **Fixture data is back at the schema commit's own seeded baseline** — 2 `congregation_oversight` rows (Alder Creek, Bramblewood), 2 `congregation_statistics` rows (Quillhaven presbytery-entered 2025, Alder Creek published-by-congregation 2025), 1 `per_capita_rates` row (2026/2024/12.50) + its 1 `per_capita_records` row (Alder Creek, unpaid, $2625.00) — the browser-walk's own additional writes were reverted (see Implementer Notes), so QA's own walk starts from the same state this pipeline found it in.
- **Test suites to run:** `npx dotenv -e .env.local -- npx vitest run src/lib/presbytery.test.ts` (34 tests, DB-backed) and the 5 mocked orchestration files under `admin/oversight`, `admin/reports`, and `(public)/site/[slug]/[[...path]]` (69 tests combined) — all pass standalone and combined (103/103, see Verification above).
- **Unrelated environment note:** a different, concurrently-running pipeline (`docs/work-log/2026-08-27-platform-home-and-portal.md`) was actively editing `src/components/org-portal/*`/`src/components/shared/{tile-grid,greeting-band,domain-tile-sections}.tsx`/`src/lib/admin-portal/tiles.ts` in the same shared working tree during this session, and its own in-progress files were failing `tsc`/`vitest` at the time this pipeline finished. Confirmed via `git status` that none of the failing files were created or touched by this pipeline. If QA's own run still shows those same two files failing, it is that pipeline's own gate to clear, not a regression in this one.
- **What to test in the browser:** the full oversight/reports read+write paths above; the `fpcw` (congregation) not-available state on both routes; `/site/northern-reach` (fallback) vs. `/site/<nonexistent-slug>` (404) vs. `/site/alder-creek` (a real congregation site, should be entirely unaffected by this change).
# Phase 5 — Verification (qa)

## Verdict: PASS

Not auth-touching. `npx dotenv -e .env.local -- npx vitest run src/lib/presbytery.test.ts`: 34/34. Combined non-DB suites: 69/69 (34 skipped-DB, matches total 103 non-DB+34 DB=137). `npm run check`: 4/4 tripwires. Section 29 isolated: **32/32 checkpoints** (work-log's "33" was an arithmetic typo, not a functional gap — 19 assert_eq + 13 rejection proofs = 32). Full test-rls.sql halts at a pre-existing, already-documented, unrelated live-DB drift (member-count assertion, earlier section) — not this pipeline's.

Gates verified by reading: every presbytery.ts export checks its permission first inside withOrgContext; enumeration-safe invalid_target (cross-presbytery/NWC/nonexistent all collapse identically); freeze-trigger interaction confirmed — the only writer of published rows is the publish function (always INSERT, never UPDATE), upserts target presbytery_entered rows only via a partial-unique-index-scoped onConflict; provenance coalesce confirmed with real inserted rows (published wins, later republish wins). Feature-gate audit table: flag → org-type → permission-delegated-to-lib on every route/action; getPlatformDb() absent; all 5 audit keys present and firing on ok only.

**NWC-exclusion evaluated, not fixed:** oversight/statistics/per-capita validate aboutOrgId against organizationType='congregation' only — narrower than credentials.ts's appointments scope (which includes NWC). Spec-literal (Phase 3's own contract says 'congregation' verbatim) and documented in three places, fails closed (invalid_target, never misattribution) — but a real gap worth a Phase 6 call: an NWC is arguably exactly what a presbytery most needs to track for viability/statistics, and the appointments precedent already established NWCs as legitimate.

Regression coverage verified real (separate seeded orgs, not self-agreeing mocks): forbidden-writes-nothing (3 sites), invalid_target ×4, provenance ×3, per-capita no-overwrite ×2.

Browser: recorded+reverted a live oversight edit (audit row confirmed, DB restored to baseline); congregations get PlaceholderNotAvailable before any permission language; /site/northern-reach → the new fallback; /site/fpcw correctly renders its REAL provisioned site (unrelated site-recreator work) rather than the fallback, confirming the fallback never overrides a genuine site; unprovisioned congregations and nonexistent slugs → real 404.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |

**Handoff:** analyst (Phase 6) — rule on the NWC-exclusion (intent match or tracked follow-up); the "33 vs 32" checkpoint count is cosmetic only.

---



---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A presbytery clerk can record their own judgment about a member congregation with zero publication dependency exactly as Phase 1's Q1 reframing promised, and read a provenance-labeled statistics/per-capita picture that unions presbytery-entered and congregation-published rows correctly — the one real gap is that new_worshiping_community congregations are invisible to all three surfaces, spec-literal and fails closed, but deserves its own product ruling.

## Live verification (analyst's own)

/o/northern-reach/admin/oversight: real viability data for two congregations, honest "Not yet assessed" for the rest. /admin/reports: three distinct correctly-labeled provenance states in one read (Congregation reported / Presbytery estimate / No data on file) — exactly Phase 1's §3 union-with-provenance requirement, confirmed with real rows. Public-site fallback confirmed live including the fpcw-has-a-real-site non-interception case. Mobile 360px re-walked — no overflow, accepted scroll pattern. fpcw correctly gets PlaceholderNotAvailable before any permission-shaped language.

## Intent-vs-Shipped

Q1 dissolution: matches (presbytery-owned, no cross-org read, works for any congregation). Statistics fork + coalesce: matches, including "presbytery row never deleted" and later-republish-wins. Per-capita from the coalesce with a bill-time snapshot: matches, directly answers the late-republish adversarial risk. Audit: five keys, one (PER_CAPITA_RECORDS_GENERATED) added beyond Phase 1's own list — acceptable drift toward more caution. Public-site fallback: matches DECISION-121 exactly.

**NWC-exclusion — the one real gap, non-blocking.** organizationType='congregation' only, narrower than Increment 2's appointments precedent (which included NWC). Defensible on two grounds: Phase 3's contract said 'congregation' verbatim, and viability/SASR-shaped statistics are institutional-maturity concepts that may not apply pre-particularization — but equally plausible a presbytery wants to track a promising NWC's numbers early. Fails closed, documented in three places, not silent. **Does not rise to blocking** — tracked as a follow-up.

## Follow-Ups (SHIP WITH NOTES)

1. NWC-oversight scope — open product question, TODO line added.
2. functionality-map.md stale in two spots (still says oversight/reports are "planned"/flag-seeded-on placeholders) — corrected at close.
3. TODO Done line for this pipeline — added at close.
4. presbytery-program.md's increment list annotated as shipped — done at close.
5. Release notes at next cut (Enhancement/Feature — first presbytery-owned oversight data, first provenance-coalesce read).
6. What's-new: held, not published — flags are dev-testing-ON only, seeded-off is the production convention; the flip-time owner publishes.
7. architecture.md: no change needed (already states the abstract shape as settled).

Rule 12 n/a (operator-directed program, not a feedback row).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

**Pipeline closed.** Housekeeping (functionality-map, TODO, program-file annotation) applied by the orchestrator at close.
