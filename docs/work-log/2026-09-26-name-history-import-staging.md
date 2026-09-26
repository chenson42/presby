# Increment 7 — organization name history with city (D14/F37) and the D13 import quarantine (`import_batches` / `import_rows`) — Work Log

> **Slug:** `2026-09-26-name-history-import-staging`
> **Surface:** schema first (two new table families in `src/lib/db/domain/`); the presbytery-side import surface is a LATER pipeline — this one ships DDL, the Drizzle tables, the seed/test-rls sections, and the matching function; rule at Phase 1/3 whether any UI ships here (recommendation: none)
> **Permission(s):** none new for DDL; the future import UI will need `statistics.manage` or its own key — analyst to note
> **Flag(s):** not needed for DDL
> **Estimated complexity:** medium–large
> **Pipeline mode:** Full
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26, wave 4):** worktree `../presby-wt-nh` on git branch `pipeline/name-history`; Neon branch `pipeline-name-history` (`br-shiny-cherry-ax6egkta`, forked from `development` at the v0.26.2 state). **Pre-assigned numbers:** migration `drizzle/0053_presby_name_history_import_staging.sql`; `DECISION-153`; findings `F100` onward. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge). **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148). Dev-server port `3700`; stop by PID; never `pkill -f`.
> **Design authority:** `docs/schema-design-2.md` — D13 (import quarantine is first-class: unresolved rows land in a durable staging table with the raw payload, a reason and a resolution workflow, never an error log; resolution can create a `dissolved` organization, D10), D14 (organizations carry dated, TYPED name aliases used for import matching and for rendering a historical report under the name in force that year), F37 (`organization_name_history` gains `name_type` — canonical | former_name | historical_name | abbreviation | legacy_import_name — plus `city`, `state`; index `(lower(name), lower(city))`; "a name AT A PLACE is the matching unit", F33), R3.16 (staging shape: `import_batches` — source, worksheet, form version, **column map** since F32's positional arrays only decode per tab — and `import_rows` — raw row, original name, city, candidates considered, resolution kind, resolver, rationale, resulting return; presbytery-owned, FORCE RLS), the sketch at §3 (~:1681) and the `statistical_returns` provenance columns `source_ref, staging_row_id` (imported provenance, D13) at §5 (~:1848), §2b's migration order item (7), and `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` Phase 2 Ruling 9 (`src/lib/db/domain/imports.ts` new, `organization_name_history` extends `org.ts`) and Phase 3's note that `presby_organize_congregation()` (presbytery-callable org creation, needed by D13's resolution) is deferred to the lifecycle-UI pipeline — rule whether increment 7 needs it now or stages rows without it.
> **Scope for this increment:** the two table families with their RLS/grants/guards (name history is written by whom? — a council act like affiliation, or the congregation's own record? analyst rules; import staging is presbytery-owned), a `presby_match_organization(name, city, year)` SECURITY DEFINER matcher returning candidates with `name_type` and provenance (the F33 key), the backfill of a `canonical` row per existing organization (from `organizations.name` + the profile's city where one exists), seed-dev fixtures (a renamed congregation with a `former_name`; one staged batch with an unresolved row), `test-rls.sql` §42 appended, DB-backed tests. **No import UI and no import executor** here — those are the next pipeline; say so in Phase 1. The `imported` provenance write path into `statistical_returns` (source_ref/staging_row_id) is designed here and built only as far as the columns and the guard's acceptance of the provenance value.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — two premises corrected (no structured city; the chain writer cannot serve imports); name-history writes recommended as council acts | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Complete — six binding rulings; three kickoff overrides accepted; F100–F103 proposed | Approved with suggestions | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — full DDL plan for `drizzle/0053`, matcher signature, TS model, parity allowlist, proposed `test-rls.sql` §42 / `seed-dev.sql` fixtures, F104 added | Design complete — implementer named | 2026-09-26 |
| 4 — Implementation | database-admin | **Complete (after one Phase 5 loop-back, 2026-09-26)** — first pass: `drizzle/0053` hand-written and applied; three tables, one view, two functions, two freeze triggers, three additive `statistical_returns` constraints; F104 addendum honoured; two new findings raised. Loop-back pass: FAIL-1 fixed in place (`0053:452`, `:750` — the two `grant execute` lines with the 0046 B-M1 rationale), FAIL-2 fixed (six §42 handlers now match the rejection literal, proved failing-first both ways), plus one `imports.test.ts` grant regression closing the batch-side residual. Whole-file re-apply idempotent ×2 (exit 0, no row-count change); suite 584/exit 0; `test:db` 4178; from-empty rehearsal re-run and dropped | Complete | 2026-09-26 |
| 5 — Verification | qa | **Second pass: PASS** — both first-pass findings closed; failing-first reproduced by QA under a revoked grant and a gutted guard body; 584 / 4178; from-empty clean. First pass: first pass: FAIL — two deny helpers missing `grant execute` (tenant path emitted `permission denied for function …` instead of the designed literal, the 0046 B-M1 hazard reintroduced); six §42 handlers passed against a no-op guard. Everything else verified clean incl. from-empty 584. Looped back to Phase 4; both defects fixed 2026-09-26 (see Phase 4 loop-back). Expect **584** suite assertions and **4178** `test:db` tests on re-run. | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.27.0 | SHIP WITH NOTES | 2026-09-26 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> This increment lays the two schema families a real import needs — dated, typed, city-qualified names for matching and an unresolved-row quarantine with raw payload and rationale — but it ships zero user-visible surface, and two of its load-bearing assumptions (a structured city to backfill from, and a "chain writer" the import can call as its third caller) don't hold against what's actually built.

## User Verbs

**This increment ships no UI, no route handler, and no server action.** Per the work-log's own scope line, the import UI and the executor are explicitly the next pipeline. The only "verbs" this increment performs are operator/migration-time, not end-user:

| Surface | Verb | Cadence |
|---------|------|---------|
| database-admin (Phase 4, not an app user) | Applies the migration (DDL + backfill + seed rows) | One-time, this pipeline |
| database-admin | Runs `presby_match_organization(name, city, year)` from `psql`/a test to prove it returns ranked candidates | Dev/test only |

No row in the table above belongs to Anonymous visitor, newly-authenticated user, authenticated member, or admin — correctly, since nothing here is reachable through `src/app/`. State this explicitly to whoever reads this work-log next: **if a reviewer goes looking for a page or an `actions.ts` file in this pipeline, that is not a gap in Phase 4 — there isn't one, by design.**

### The future flow this increment stages (not built here — sketched so Phase 2/3 don't over- or under-design the schema against it)

| Surface | Verb | Cadence |
|---------|------|---------|
| Presbytery admin (`(org)`, gated by `statistics.manage` — see Permissions below) | Uploads a year's spreadsheet | Per import batch, roughly annual per presbytery |
| Presbytery admin | Reviews a list of rows the matcher couldn't resolve automatically, each with its candidate list | Per batch, until the queue is empty |
| Presbytery admin | Resolves a row: picks a candidate (alias to an existing org), or creates a new dissolved organization or, if truly ambiguous, leaves it quarantined with a rationale | Per row |
| Presbytery admin (self-service, future) | Records a `former_name`/`historical_name` for a congregation directly, outside an import | Occasional |

## Flows

**Flow 1 — Migration + backfill (this increment's only real "flow," and it has no human in it):** entry: `psql "$MIGRATE_DATABASE_URL" -f drizzle/0053_....sql` → step: create `organization_name_history`, `import_batches`, `import_rows`, the matcher function, grants, RLS → step: backfill one `canonical` row per existing organization from `organizations.name` (+ city, where derivable — see Gap #1) → step: seed-dev fixtures (a renamed congregation with a `former_name` row, one staged batch with one unresolved row) → outcome: schema is in place for the next pipeline; `npm run check:schema-parity` and the from-empty recipe pass.
- **Failure:** not addressed in the kickoff and worth one sentence in Phase 3 — if the backfill assertion fails partway (e.g., an org whose name doesn't survive `NOT NULL`/format checks), does the whole migration roll back (a single transaction, matching D10's own "backfill-completeness assertion that must hold before the migration commits" precedent in `drizzle/0044`), or does it leave a partial `organization_name_history`? Recommend: same discipline as `0044` — one transaction, an assertion at the end, or it doesn't commit.

**Flow 2 — Future: presbytery clerk imports a year's spreadsheet (sketched, not built; entry/outcome only, so the next pipeline's Phase 1 doesn't start from zero):** entry: `/o/<presbytery-slug>/admin/...` (route TBD, gated by `statistics.manage`) → step: upload → step: system parses per the batch's recorded column map, calls `presby_match_organization(name, city, year)` per row → step: high-confidence matches auto-resolve, everything else lands in `import_rows` with its candidate list → step: clerk resolves each row → outcome: a `statistical_returns` row with `provenance = 'imported'`.
- **Failure:** not addressed yet (correctly deferred) — but flag now: what does the clerk see if the uploaded file has the wrong worksheet name, no header row, or a column map that doesn't match any known form generation? "Unhandled exception" is not an acceptable failure microcopy for a presbytery volunteer uploading a 1987 spreadsheet.

## Permissions & Flags

- **Permission(s):** none new for this increment's DDL (correct — there is no enforcement point to bind one to, and a permission key with no code path checking it is a claim the catalog can't keep, per this same pipeline lineage's own prior ruling on `lifecycle.record`/`affiliation.record`).
- **For the future import UI: reuse `statistics.manage`, don't mint a new key.** It already exists (`src/lib/presbytery.ts:83`, `src/lib/statistics-grants.ts:55`) and already gates every other presbytery-side statistics-writing action (`setCongregationStatisticsAction`, grant issuance/revocation). An import that creates `statistical_returns` rows is squarely "manage this presbytery's statistics" — a second key would fragment one capability into two without a reason. If the executor pipeline later decides import specifically (because it can create organizations, per D13's third disposition) deserves a narrower key than manual entry, that's a decision for that pipeline's own Phase 1/2, not this one.
- **Default roles:** whatever already holds `statistics.manage` today — no change needed.
- **Flag(s):** not needed for DDL. Recommend the future import UI ship behind a flag anyway (e.g. `imports.name_history_staging`) given F32's 48%-failure history — a rollback path matters more here than on most features, because a bad import run touches historical data that's expensive to hand-correct. Note it for the next pipeline; don't build it here.

## Gaps the Request Didn't Address

1. **`organization_profiles` has no structured city column — the D14 backfill premise as written doesn't hold.** I checked live: `organization_profiles.address` (`src/lib/db/domain/sites.ts:183`) is a single free-text line ("Phase 1 Q4 — no structured/geocoded shape"), and only 1 of 15 seeded orgs has a profile row at all (`41 W. College Avenue, Westerville, Ohio 43081`). There is no `addresses` row for organizations either — that table is `person_id`-scoped only (`src/lib/db/domain/people.ts:325`). So "backfill `canonical` from `organizations.name` + the profile's city where one exists" cannot be a mechanical column read; it would require parsing free text (fragile — see the sample above, city is the second comma-segment, not always). **Recommend:** backfill `canonical.city` as `null` for every org except where a human wants to hand-populate it later, and say so explicitly in the migration comment rather than attempting a text-parse heuristic that will be wrong often enough to poison the matcher on day one (F33's whole point is that city is what disambiguates — a wrong parsed city is worse than a missing one). This is a Phase 3 decision, but it needs to be made deliberately, not discovered in QA.
2. **The "import will be the chain writer's third caller" premise in the kickoff is factually wrong against what's built, and Phase 3 of the next pipeline needs to know that now, not discover it mid-design.** I read `presby_write_return_publication_chain()` (`drizzle/0049_presby_submission_grants.sql:438-608`) in full: it hard-codes `provenance = 'submitted'` on the `statistical_returns` insert, requires the recipient to be a presbytery, and unconditionally writes a `publications` row and a `congregation_statistics` row with `provenance = 'published_by_congregation'`. None of that fits an import: an imported return's `organization_id` *is* the presbytery already (no congregation-to-presbytery publish event needed — the presbytery already owns both sides), and `statistical_returns_provenance_shape` (`drizzle/0046:316`) already requires `provenance = 'imported' and not reconciled`, which the chain writer never produces. Good news, and worth stating plainly: **`imported` already passes every guard that exists today** — `staging_row_id`/`source_ref` are already columns (`drizzle/0046:307-312`), `staging_row_id` is deliberately a bare uuid awaiting `import_rows(id)`'s FK, and `congregation_statistics.provenance` already has an `'imported'` slot (`drizzle/0038:205`) sitting unused. What's missing is a *sibling* writer (not a fourth caller of the existing one) — something like `presby_import_return()` — that inserts directly into `statistical_returns`/`congregation_statistics` with no `publications` row at all. Flag this now so the next pipeline's Phase 3 doesn't try to force-fit the existing function.
3. **Who writes `organization_name_history` — I'm ruling, as asked.** Recommend the D26 about-org-act shape, not a self-service congregation write, for all five `name_type`s in this increment:
   - Mirror `organization_lifecycle_events` / `organization_affiliations` exactly: `organization_id` = the acting council (tenant scope, FORCE RLS), `subject_org_id` = the organization the name describes (plain FK, the section-17 exception). This makes a future writer a natural sibling of `presby_transfer_affiliation()`/`presby_apply_lifecycle_event()` rather than a new invented mechanism.
   - **Why not "the congregation writes its own `canonical`/`abbreviation`," as the kickoff's phrasing suggests as one option:** I checked — there is no live write path for `organizations.name` at all today. `presby_app` has held only `SELECT` on `organizations` since the lifecycle pipeline's revoke, and `grep -rn "update(organizations)" src` finds zero application call sites (only test-harness `getPlatformDb()` writes, in `org-provisioning.test.ts`). A congregation cannot rename itself in the shipped product right now. Recommending a congregation-editable name-history table when the thing it's a history *of* has no edit path is exactly the "permission with no enforcement point" anti-pattern this same pipeline lineage already ruled against once (`lifecycle.record`/`affiliation.record`). Recommend: `canonical` is system-backfilled only in this increment (no live INSERT grant to `presby_app` at all, matching `organizations`' own current state), and a real write mechanism — congregation or council — is deferred alongside `presby_organize_congregation()` to the lifecycle-UI pipeline, tracked in `docs/TODO.md`.
   - This leaves `former_name`/`historical_name`/`legacy_import_name` as presbytery-authored, which matches the actual driver of this whole pipeline (D13's import problem, not a congregation's desire to edit its own history).
4. **The overlap/uniqueness rule needs a mechanism, not just a rule.** The design authority states "two canonical names cannot overlap in time; `legacy_import_name` may repeat" but doesn't say how. Recommend the same `daterange` + `btree_gist` EXCLUDE idiom `organization_affiliations` already uses (extension already installed, no new dependency), scoped to `name_type = 'canonical'` per `subject_org_id`. Whether `former_name` needs the same discipline against `canonical` (so "what was this org called on this date" has exactly one answer) is genuinely underspecified by the design authority — the §3 sketch shows one flat column list with no discussion of whether a rename closes the old canonical row and opens a former_name row, or just moves the canonical row's `effective_to`. Open Question #1 below.
5. **`organization_identifiers.kind = 'legacy_import'` (D24) and `organization_name_history.name_type = 'legacy_import_name'` (D14) are two different things with confusingly similar names.** The first is an ID mapping (e.g., PSVOnline's internal congregation id) added in the lifecycle pipeline; the second is a dirty name *string* kept only so an importer has somewhere to put a matching string without implying it was ever official. Worth a one-line cross-reference comment in each migration so a future reader doesn't conflate them or "helpfully" merge the two mechanisms.
6. **Audit story — not addressed, and this pipeline's own design-authority precedent says it should be.** The lifecycle-pipeline notes state plainly: "Lifecycle and affiliation are council acts, written by the presbytery ... through `withOrgContext()`, with an audit row" (`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`, Notes section). A council recording a `former_name`/`historical_name` for a congregation, or resolving a quarantined import row (which can create a new organization per D13's third disposition), is the same class of governance-sensitive act. This increment ships no write path, so there's no `recordAudit()` call to check today — but say so explicitly rather than silently, and the future pipeline's Phase 4 gate (Workflow Rule 7) must not skip it.
7. **Empty state.** A brand-new install has zero `import_batches` rows and zero `organization_name_history` rows beyond the `canonical` backfill. That's fine for schema-only DDL, but say it plainly for Phase 5/6: `test-rls.sql`'s new section and the seed fixture are the only proof this shape works at all before the next pipeline builds anything that renders it.
8. **No Real Data, concretely, for the seed fixture.** The kickoff asks for "one staged batch with an unresolved row." The `raw_payload jsonb` on that fixture row must be synthesized (Alder-Creek-style invented names, `example.invalid` addresses), not a lightly-edited copy of a real presbytery's spreadsheet row for "realism" — the pre-commit secrets scan won't catch a real person's name or a real congregation's financial figures, only credential-shaped strings.

## Out of Scope (confirm with user)

- **The import UI** (upload page, quarantine review/resolution screens) — explicitly the next pipeline, per the kickoff.
- **The import executor** (the code that actually reads a spreadsheet, walks worksheets, calls the matcher per row, and writes `import_rows`) — explicitly the next pipeline.
- **`presby_organize_congregation()`** — already ruled deferred to the lifecycle-UI pipeline (`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md:170`). This increment cannot build D13's third resolution disposition ("create new dissolved organization") end-to-end; it can only leave room for the `resolution_kind` enum to name it.
- **The actual `imported`-provenance writer function** (`presby_import_return()` or equivalent, per Gap #2) — this increment only proves the columns and CHECK already accept the value; it does not write the function.
- **D22 (person-merge matching) and D23 (care-ministry grants)** — unrelated axes, correctly not touched here.
- **Geocoding or address-parsing for `organization_profiles`** — per Gap #1, out of scope; `city` backfills null where it can't be read structurally.

## Open Questions

1. **Does a rename create a new `canonical` row and close the old one, or does the old canonical name additionally get recorded as a `former_name` row?** The design authority doesn't say, and it changes what "the name in force that year" query looks like. Needs a ruling before the EXCLUDE constraint (Gap #4) can be written correctly.
2. **Should `former_name`/`historical_name`/`legacy_import_name` rows require a `minute_reference`, mirroring `organization_lifecycle_events.minute_reference not null`?** A presbytery asserting "this church used to be called X" is a minuted fact in the same sense a dissolution is, but the kickoff's sketch doesn't carry a minute-reference column at all. If the answer is "no, it's lower-stakes than a lifecycle event," say so on purpose rather than by omission.
3. **What does `report_year` mean for a `legacy_import_name` when the same row is used to match multiple years of a spreadsheet import?** F33's key is `(name, city, year)`, but `organization_name_history` carries `effective_from`/`effective_to`, not a single `report_year`. Confirm the matcher's `year` parameter is meant to test `year between effective_from and effective_to` (with null = unbounded), not an exact match — worth stating in Phase 3 since it's the one place F33's stated key and F37's stored shape could silently diverge.

## Adversarial Pass

- **The matcher as a cross-council enumeration oracle — real, and sharper than the standard case.** Every other cross-council read in this codebase (`presby_org_affiliated`, `presby_list_published_returns_to_me`) is scoped to a caller's *own* affiliation history. `presby_match_organization()` is different by necessity — a legacy name must be searchable across the *entire* org tree, because a congregation could have changed presbyteries since the year in question (D19's whole point). That means a presbytery clerk doing an ordinary import can now surface a candidate row that names an organization they have no affiliation with at all. **The candidate rows must never carry `platform_status`.** The org tree itself is public (DECISION-040), so name/city/type/organization_id are fine to return; whether that organization is `managed`/`unmanaged`/`invited` is D9's tenant axis and is exactly the fact DECISION-047 says a branded 403 must not leak by a different mechanism — this function must not leak it by this one. Recommend `presby_match_organization()`'s return columns be enumerated explicitly (not `select *`) and reviewed line-by-line in Phase 4/5 for this specifically.
- **A `legacy_import_name` colliding with a live congregation's canonical name in a different presbytery — partially mitigated already, worth naming so it isn't re-discovered as a surprise.** If a clerk mis-resolves a quarantined row to an unrelated same-named congregation elsewhere, the existing `statistical_returns` trigger (`presby_org_affiliated(about_org_id, organization_id, report_year)`, required for `imported` rows) already blocks it *unless* that unrelated org happens to have been affiliated with the importing presbytery at some point in its 41-year history — a real but narrow residual risk, and one `import_rows.candidates`/`rationale` (D13's own audit trail) is built to make reviewable after the fact. This is a legitimate defense-in-depth story, not a full mitigation: the matcher itself should still visibly label each candidate's *current* affiliation and lifecycle status when the future resolution UI is built, so a clerk isn't choosing blind between two same-named churches. Flagging now because the schema (does `presby_match_organization()`'s return row carry enough for that label?) is decided in *this* pipeline, even though the UI that renders it isn't.
- **Redirect targets:** not applicable — no route, no `callbackUrl`.
- **State-machine shortcuts:** not applicable to this increment (no state machine ships); for the future flow, "can a clerk resolve a row twice, or resolve a row that's already been superseded by a later batch," is worth a note for that pipeline's own Phase 1.
- **Input boundaries:** `presby_match_organization(name, city, year)` needs server-side bounds now even absent a UI, since it will eventually take arbitrary spreadsheet-derived strings — empty string, a name with embedded newlines (F32 already found multi-line money values in the wild), non-Latin characters (a manse's Korean-language congregation name, plausible in a real presbytery). Recommend the function normalize/trim defensively rather than assume a well-formed caller, since its only caller today is a test harness but its real caller will be untrusted spreadsheet content one hop removed.
- **Self-targeting:** not applicable — no admin-on-self action exists here.
- **Empty-string / overlong `name`/`city` on `organization_name_history` itself:** the kickoff doesn't mention a length bound. `organizations.name` has none either (`text not null`, no CHECK), so this is consistent with existing practice, but worth a length sanity bound given this table specifically exists to absorb messy spreadsheet input (recommend a generous CHECK, e.g. 1–255 chars, matching `statistics_submission_grants_name_shape`'s precedent rather than leaving it unbounded).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Handoff:** to **architect** (Phase 2). Read this section's Gaps #1–#3 before ruling on placement — #2 in particular means the design authority's own "an import will be its third caller" language (repeated in the kickoff prompt) should not survive into Phase 3 unamended. Gap #3's ruling (name-history writes are council-acts, no live `organization_name_history` INSERT grant to `presby_app` in this increment) is a recommendation, not a decision — architect/tech-lead should affirm or override it explicitly rather than let it pass by default.



### Orchestrator notes (2026-09-26)

- The kickoff's "an import will be the chain writer's third caller" is superseded by Gap 2: an `imported` return needs a SIBLING writer (`presby_import_return()`, no `publications` row), designed but not built here.
- Gap 1: `canonical.city` backfills `null` — no text-parse heuristic.
- Gap 3 (name-history writes are council acts; no live INSERT grant to `presby_app` this increment) is a recommendation for the architect to affirm or override explicitly.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## Verdict

**Approved with suggestions.**

The two table families, the matcher, and the deferral of both writers are the right shape. Phase 1's Gap 3 is **affirmed and strengthened** — not on "there is no write path today" (a contingent fact) but on F40 (a structural one). Six rulings below change the design as the kickoff stated it; four are overrides Phase 3 must not silently drop. Nothing here sends the feature back to Phase 1.

## Placement

- **Directory placement:**
  - `organization_name_history` → `/Users/cshenso/git/presby-platform/presby-wt-nh/src/lib/db/domain/org.ts`. **Ruling 9 of the lifecycle pipeline affirmed, on a reason, not by default.** The near miss is `lifecycle.ts` (same council-act idiom, same `daterange`/EXCLUDE, same function-mediation rule), but the closer sibling is `organizationIdentifiers` (`org.ts:195`): identifiers and names are both alternate keys for the same body, both council-written, both exist for import matching. Gap 5's conflation risk (`organization_identifiers.kind = 'legacy_import'` vs `name_type = 'legacy_import_name'`) is *reduced* by co-location — the cross-reference comment sits forty lines away instead of in another file. `lifecycle.ts` stays the home of the three-axis *event* tables.
  - `import_batches` / `import_rows` → new `/Users/cshenso/git/presby-platform/presby-wt-nh/src/lib/db/domain/imports.ts`. Approved. `src/lib/db/domain/index.ts` gains exactly one appended line, `export * from "./imports";`, at the END of the list (Workflow Rule 16 shared-file discipline).
  - **Module-graph direction is one-way: `imports.ts` → { `org.ts`, `returns.ts`, `../schema` }, never the reverse.** This has a mechanical consequence Phase 3 must plan for — see Ruling 6.
  - **Pre-ruling for the executor pipeline:** the code that *calls* the matcher belongs in `src/lib/imports/`, not in `src/lib/db/domain/`. `domain/` is table definitions only.
- **Server vs Client split:** **not applicable, and that is a finding, not an omission.** This increment ships no page, no route handler, no `actions.ts`, no component. A reviewer who goes looking for a `'use client'` boundary in Phase 4 has misread the scope. `check:audit` and `check:brand-scope` have nothing to bite on; both are vacuously green and that is the correct result.
- **Dependencies: none new. Confirmed against the live branch, not the migration text.** `select extname from pg_extension` on `pipeline-name-history` returns exactly `btree_gist, plpgsql`. `btree_gist` is installed, so the EXCLUDE idiom costs nothing.
  - **Explicitly refused for this increment: `pg_trgm`, `unaccent`, `fuzzystrmatch`.** None is installed. A Postgres extension is a dependency under the evaluation criteria (it is a deployment-surface change on Neon, and `unaccent`'s function is not `IMMUTABLE`, so it cannot appear in a generated column or an index expression without a wrapper). If Phase 3 wants similarity ranking rather than banded equality, that is a **loop-back to Phase 2**, not a Phase 3 call. Ruling 4 gives a matcher that does not need one.

## Invariants Touched

| Invariant | Disposition |
|---|---|
| **Isolation Is a Database Property** | Three new tables, all `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy on `organization_id = presby_current_org()`. `organization_name_history` gets **no** INSERT/UPDATE/DELETE grant to `presby_app` (Ruling 1); the two staging tables keep ordinary tenant DML minus DELETE (Ruling 5). Verified live that `presby_app` is `rolbypassrls = f` and `neondb_owner`/`presby_platform` are `t` — the public projection view (Ruling 2) rests on that second fact, exactly as `organization_affiliations_public` already does. |
| **Two Hierarchies Intersect Nowhere** | Respected, and the RLS shape does **not** decide the cross-council authority question the kickoff asked me to settle. See Ruling 8 — the policy decides *whose records you read*; *whom you may record about* is function-mediated and deferred with the writer. No platform predicate appears anywhere in this increment. |
| **Composite Tenant Keys** | `import_rows → import_batches` composite; `import_rows.resulting_return_id → statistical_returns(id, organization_id)` composite; `statistical_returns.staging_row_id → import_rows(id, organization_id)` composite (Ruling 6). Plain FKs to `organizations` (`subject_org_id`, `resolved_org_id`) by the §17 structural exception, which `organization_lifecycle_events` (`0044:129-130`) and `statistical_returns.about_org_id` (`0046:286`) already state in their own comments. All three new tables declare `unique (id, organization_id)`. |
| **The Roll Is the System of Record** | Untouched. |
| **No Real Data** | The seed fixture's `raw_payload` is the exposure. See Ruling 10. |
| **Permissions vs Flags** | No new permission key, no flag. Correct: there is no enforcement point this increment. The analyst's "reuse `statistics.manage`, don't mint a key" is a *next-pipeline* ruling and I concur; it is not binding on Phase 3 here because Phase 3 here has nothing to bind it to. |
| **The Edge Gate Cannot Reach the Database** | Untouched — nothing enters `src/proxy.ts`. |
| **The Brand Is a Cascade Override** | Untouched. |
| **Never Hard-Delete** | Extended, deliberately: `import_rows` refuses DELETE on every connection (Ruling 5c). D13's "quarantine, never an error log" is meaningless if the quarantine is droppable. |

No `CLAUDE.md` change is required by anything in this increment.

## Notes

*Ten rulings. 1, 2, 4, 5c, 6 and 7 are binding on Phase 3; where I have overridden the kickoff or the design authority I say so in the ruling's first sentence.*

---

### Ruling 1 — The EXCLUDE constraint puts `organization_name_history` under the function-mediation rule by force. Gap 3 is affirmed on that ground.

Phase 1 recommended "no live INSERT grant to `presby_app`" because no write path for `organizations.name` exists today. That reasoning is true but contingent — it evaporates the moment the lifecycle-UI pipeline ships one. The durable reason is **F40**:

> A unique or exclusion constraint is enforced against **all** rows, not the RLS-visible subset.

The EXCLUDE is keyed on `subject_org_id`, and **organization ids are public** (DECISION-040, `organizations` has `relrowsecurity = f` and `presby_app` holds `SELECT` — verified live). So with ordinary tenant DML, any presbytery could `insert (subject_org_id => <any org id>, name_type => 'canonical', range => 1985–1995)` and learn from the constraint-violation error whether *some council it cannot see* has recorded a canonical name for that body in that window. That is DECISION-047's enumeration-oracle class arriving through a constraint, identically to `organization_affiliations`.

**Therefore:** `organization_name_history` joins the three-axis family under Phase 2 Ruling 1 of `docs/schema-design-2.md` §2c. `revoke insert, update, delete ... from presby_app`; `grant select`. `presby_platform` gets `select, insert` (the 0044 narrowing, Ruling A5). The future writer is a `SECURITY DEFINER` sibling of `presby_transfer_affiliation()` — working name `presby_record_org_name()` — deferred to the lifecycle-UI pipeline alongside `presby_organize_congregation()`, and it must use the single-literal-rejection discipline (`presby_deny_affiliation_change()`'s pattern) so no rejection cause is distinguishable from another.

**The contrast is the load-bearing half of this ruling.** The staging tables get the *opposite* call (Ruling 5) because the test is **"is the probe's key learnable from public data?"** — not "is the table tenant-scoped." `subject_org_id` is public; a batch uuid is not. Phase 3 must not generalize either ruling into "all new tenant tables are DEFINER-only" or "F40 only applies to the three-axis tables."

### Ruling 2 — Override: the matcher is a `STABLE` invoker function over a bounded public view, not a `SECURITY DEFINER` function over the base table.

The kickoff specifies `SECURITY DEFINER` with `search_path = public, pg_temp`. I am overriding that, for the reason DECISION-121 already warns about in reverse: DEFINER is a privilege grant, and a structural guarantee beats a reviewed column list.

Ship, mirroring `organization_affiliations_public` (`drizzle/0044:520-528`) exactly:

```
create or replace view organization_name_history_public as
  select subject_org_id, name_type, name, city, state,
         name_normalized, city_normalized, effective_from, effective_to
    from organization_name_history;
grant select on organization_name_history_public to presby_app, presby_platform;
```

A plain (non-`security_invoker`) view runs with its owner's privileges, and `neondb_owner` is `rolbypassrls = t` (verified live) — so it sees past the base table's tenant policy, which is the point and is the same call 0044 already made. `organization_id` (the recording council), `minute_reference`, `notes`, `authority` and `recorded_by` are **absent from the projection and must stay absent**; widening the column list is a policy change, not a convenience. That comment belongs verbatim on this view too.

`presby_match_organization()` then reads the view plus `organizations`, is `language sql stable`, carries `set search_path = public, pg_temp` anyway (harmless, consistent with DECISION-148 even though it is not a DEFINER), and **physically cannot leak the council's minute or notes because its substrate does not contain them.** Execute granted to `presby_app` and `presby_platform`.

If Phase 3 finds it needs a base-table-only column to rank, the function becomes DEFINER and the explicit column list becomes the review artifact — but say so in the design doc rather than switching quietly.

*Operational fact worth one comment line:* the view's cross-tenant visibility depends on its owner holding `BYPASSRLS`. If ownership ever moves to a non-bypassing role, the view returns zero rows silently — F26's failure mode. A DEFINER function would fail identically, so this is not an argument against the view; it is an argument for the comment.

### Ruling 3 — Open Question 1: a rename closes the canonical row and opens a new one. The old name is **not** duplicated as a `former_name`.

Duplicating it would give "what was this body called in 1987?" two rows with different types and force a preference order into every caller — the second-source-of-truth pattern this design refuses everywhere else. One rule, one row, one answer, enforced by the constraint:

```
constraint organization_name_history_canonical_no_overlap
  exclude using gist (
    subject_org_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (name_type = 'canonical')
```

Partial, `'[)'`, matching `organization_affiliations_no_overlap`. Plus a `range_order` CHECK mirroring `organization_affiliations_range_order`. The other four types may overlap each other and the canonical succession freely — they are *assertions about* the body, not the succession itself.

This forces the type vocabulary to mean something, which Gap 5 asked for:

| `name_type` | Means | Dated? |
|---|---|---|
| `canonical` | The name officially borne, for this interval. Exactly one per instant. | Always, by EXCLUDE |
| `former_name` | We assert this was an official name, but cannot reconstruct its canonical interval | Fuzzy/unbounded allowed |
| `historical_name` | A name the body was known by that was never official | Optional |
| `abbreviation` | A short form | Usually unbounded |
| `legacy_import_name` | A dirty matching string from a source document. **Carries no claim that it was ever used.** | Usually unbounded |

### Ruling 4 — Open Question 3: the year **ranks**, it does not filter. And the index must be on what the matcher actually compares.

Confirming the analyst's reading and going one step further. `p_year` participates in ranking, never in a `WHERE`. F30's lesson is that half a 41-year archive failed on reference resolution; a matcher that *hides* the right candidate because someone mis-recorded an `effective_to` reproduces that failure with a clean conscience. Overlap semantics, not containment (a mid-year rename means both names were in force during the reporting year — the same both-endpoints logic `presby_org_affiliated` already uses at `0049:493`), and null endpoints are unbounded. `p_year is null` → the year band simply does not fire.

**Return columns, enumerated (this list is the review artifact):**

`organization_id`, `matched_name`, `name_type`, `city`, `state`, `organization_type`, `lifecycle_status`, `current_parent_id`, `current_parent_name`, `effective_from`, `effective_to`, `rank integer`, `confidence text` — banded `exact | high | medium | low` via `(array[...])[min(rank)]`, the `presby_match_person()` idiom (`0009:302-305`), not a float score. No false precision.

**Never returned: `platform_status`. Also never returned: `slug`, `deletable_until`, `status`.** `lifecycle_status` and `current_parent_*` are returned *deliberately* — they are the labels the adversarial pass says a clerk needs to avoid choosing blind between two same-named churches, and they are already public-tree facts. `slug` is omitted on the minimal-disclosure principle: a candidate list has no use for it.

Bounded `limit 20`, no `offset` — no pagination means no enumeration crawl.

**Input handling:** normalize `lower(btrim(regexp_replace(input, '\s+', ' ', 'g')))` and strip trailing punctuation; an empty or null normalized name returns **zero rows, never an exception**. The caller is a loop over a spreadsheet; raising kills the batch, and D13's rule is quarantine-never-drop. A zero-candidate row is a legitimate `unresolved` outcome.

**F101 — the F37 index as literally written cannot serve this matcher.** `(lower(name), lower(city))` does not match a predicate that also collapses whitespace and strips punctuation, so the planner would seq-scan and, worse, the *comparison* would differ from the *index*. Ship `name_normalized` / `city_normalized` as `generated always as (...) stored` columns (all functions used are `IMMUTABLE`; `unaccent` is not and is therefore excluded) with a plain btree on the pair, plus `(subject_org_id, name_type, effective_from)` for the name-in-force lookup. This supersedes F37's literal expression while honoring its intent, and Phase 3 should record it as such.

### Ruling 5 — The staging tables keep ordinary tenant DML; the consequential write stays where it already is.

The kickoff asks DEFINER-only or tenant DML. **Tenant DML**, for three reasons:

a. **F40 does not fire.** Nothing in either table carries a constraint keyed on a publicly-learnable identifier. `unique (batch_id, row_index)` is keyed on a random uuid a non-owner cannot guess; `resolved_org_id` gets **no** unique or EXCLUDE (Phase 3: do not add one — that would manufacture the oracle).
b. **The function-mediation rule is scoped to the three-axis governance tables.** A quarantine worktable is not a minuted council record; putting the whole review loop behind DEFINER functions buys no authority and costs the executor pipeline a function per verb.
c. **The authority boundary is already in the right place and does not move.** `presby_app` holds `SELECT` only on `statistical_returns` (verified live), and four triggers fire there (`_about_org`, `_field_spec`, `_freeze`, `_guard`). Resolving a staging row is cheap; *minting a return* is not, and that stays DEFINER-only behind the `presby.publication_write_active` GUC.

So: `grant select, insert, update on import_batches, import_rows to presby_app`. **No DELETE on either** — D13's durable quarantine is a grant fact, not a convention.

**5c — freeze/immutability, one trigger per table, fired on every connection (the owner path is the one that matters, F44):**

- `import_batches`: `raw`-ish provenance columns (`source`, `worksheet`, `form_version_key`, `column_map`, `row_count`, `created_by`) immutable after insert; DELETE refused.
- `import_rows`: DELETE always refused. UPDATE permitted **only** when `old.resolution_kind = 'unresolved'` and the frozen set — `batch_id`, `organization_id`, `row_index`, `raw_payload`, `original_name`, `original_city`, `report_year`, `candidates` — is unchanged. `candidates` is frozen deliberately: it is the snapshot of *what the clerk saw*, and a later, better matcher must not rewrite the audit trail.
- **Set-once has no correction path, and that is chosen, not overlooked.** A mis-resolution cannot be edited once `resulting_return_id` points at an immutable `statistical_returns` row. Loosening later is cheap; tightening after the executor ships is not. The revision mechanism (an append-only `import_row_revisions` child, or a `presby_revise_import_row()` DEFINER function) is an explicit open item **owned by the executor pipeline's Phase 1** — name it in `docs/TODO.md` at integration; do not guess it here.

**Counts are not cached.** `row_count` (a fact about the source file, immutable) stays. `resolved_count` / `unresolved_count` do **not** — they are derivable from `import_rows` and would drift, which is `memberships.current_roll`'s F29 lesson arriving in a new table. This overrides the kickoff's "counts" plural.

**`resolution_kind`: `text` + CHECK, not a `pgEnum`.** Every domain value added since `0044` (`event`, `relationship_type`, `authority`, `provenance`) is text+CHECK; this list will grow when `presby_organize_congregation()` lands, and a CHECK swap in a migration beats `ALTER TYPE` ordering. Values: `unresolved` (the `not null default`, so quarantine is a named state and never a null), `matched_existing`, `matched_alias`, `created_dissolved`, `duplicate`, `rejected`. **`created_dissolved` is nameable but unreachable this increment** — `presby_organize_congregation()` is deferred — and Phase 3 should say so in the column comment so a future reader does not hunt for the writer. Shape CHECK in the `statistical_returns_provenance_shape` idiom: `resolved_org_id` required for the three matched/created kinds and null for `unresolved`/`rejected`; `rationale` required for `rejected` and `duplicate`; the `resolved_*` trio null exactly when `unresolved`.

### Ruling 6 — `statistical_returns.staging_row_id` gains a **composite** FK, `import_rows.resulting_return_id` **stays**, and the two are different facts.

The kickoff asks whether the composite works here given the grants case. It does, and it is required: an imported return's `organization_id` **is** the presbytery, and the import row's is too, so `(staging_row_id, organization_id) references import_rows (id, organization_id)` pins both sides to one tenant. This matters beyond tidiness — **RI checks bypass row security by design**, so a plain FK to a FORCE-RLS table is a cross-tenant existence oracle in F40's family; the composite confines the probe to the prober's own org. (Today it is unreachable anyway — `presby_app` has no INSERT on `statistical_returns` — but the constraint should be right on its own terms, not by accident of a grant.) `MATCH SIMPLE` means a `submitted` row's null `staging_row_id` skips the check entirely; no special-casing needed.

**F102 — I nearly ruled `resulting_return_id` out as a redundant second pointer, and it is not.** Two distinct facts:

- `statistical_returns.staging_row_id` — *this artifact was created from that staging row.* Provenance of the artifact. At most one row can claim creation.
- `import_rows.resulting_return_id` — *this staging row's disposition points at that return*, which may be one it created **or** a pre-existing return it was found to duplicate.

They coincide for `matched_*`/`created_dissolved` and **diverge for `duplicate`** — and R3.8 puts deduplication squarely in D13's staging workflow, so `duplicate` is a first-class disposition, not an edge case. Keep both, comment the distinction on both columns, and **do not assert they agree**. A future reviewer will otherwise "simplify" one away and silently break dedup.

Consequences Phase 3 must plan for:

1. **The pair is an FK cycle.** Both columns are nullable, so the write order inside the one DEFINER transaction is: insert `import_rows` (return null) → insert `statistical_returns` → update `import_rows.resulting_return_id`. No `DEFERRABLE` needed. **The Ruling 5c freeze trigger must permit exactly that one update**, or the writer deadlocks against its own guard on day one of the next pipeline.
2. **`check:schema-parity` needs an allowlist row.** `imports.ts` imports `returns.ts`; declaring `stagingRowId`'s composite FK in `returns.ts` would create the domain graph's second module cycle, exactly the `blob_assets` case that `scripts/check-schema-parity.ts:91-155` already documents. So the FK is **DDL-only** and needs an `extra_fk`, `category: "architectural"` entry with the exact signature `(staging_row_id,organization_id) -> import_rows(id,organization_id)`, pointing at the 0053 line and at a `returns.ts` docstring — the `statistics_submission_grants` STAMP row is the template. **No `pending` row, no `docs/TODO.md` line**: there is nothing to close.
3. **Suggested, additive, and not required:** `0046`'s `statistical_returns_provenance_shape` does not constrain `staging_row_id`/`source_ref` to imported rows — verified live, a `submitted` row can carry both. Since 0053 is already touching this table, add `check (provenance = 'imported' or (staging_row_id is null and source_ref is null))` as a new constraint in 0053 (additive; `0046` is shipped and is not edited).

### Ruling 7 — Backfill discipline, and the question 0044 answers that the kickoff did not ask.

`0044`'s discipline exactly: one file, one transaction, a `DO` block assertion that must hold before commit, idempotent statements, backfill guarded with `where not exists` so re-application converges.

**Assert two things, not one:** `count(organizations) = count(canonical backfill rows)`, **and** every organization has exactly one *open* canonical row (`effective_to is null`). The second is what the matcher's "name in force today" path actually depends on.

**`organization_id` on a backfilled canonical row = the subject org itself**, `authority = 'backfill'`, `minute_reference` null, `city` null (Gap 1 affirmed — no text-parse heuristic; a wrong parsed city is worse than a missing one when city is the disambiguator). 0044's affiliation backfill used `o.parent_id`, which is unavailable here because parentless orgs still need a canonical name and the assertion counts *all* organizations. Self-attribution is also the truthful reading: a body's own current name is its own record, and nobody minuted it. **Therefore no `not_self` CHECK on this table** — unlike `organization_lifecycle_events`, where `organization_id <> subject_org_id` is polity. `organization_id = subject_org_id` is the canonical-self case; `<>` is the about-org case.

`city` and `state` on `canonical`: `city` nullable (the backfill makes that unavoidable); Phase 3 should **not** add a "canonical requires city" CHECK, however tempting F33 makes it.

**Length CHECKs**, following `statistics_submission_grants_name_shape` (`0049:141-142`): `char_length(btrim(name)) between 1 and 255`; `city` `between 1 and 120` when non-null; `state` `<= 64` when non-null, **explicitly not a validated code set** (historical and non-US forms exist — say so in the column comment so nobody "fixes" it to `char(2)`).

**Parity/from-scratch (DECISION-150):** the three new tables must appear in the TS domain model and be exported, or `check:schema-parity` fails on table presence. EXCLUDE constraints, CHECKs, indexes and generated-column expressions are outside the comparator's scope (it compares table presence, column presence, nullability, FK shape) — so the only allowlist entry needed is Ruling 6.2's. Phase 4 also regenerates `/developer`'s ERD (`npm run docs:erd`).

### Ruling 8 — Open Question 2 and the Two Hierarchies question, together.

**`minute_reference` stays nullable on the column, and `authority` carries the weight** — the `organization_affiliations` idiom, whose comment already states the principle: *"a minute-less row can only ever be an inferred one, so an inferred relationship can never be mistaken for a minuted act."*

`authority text not null default 'recorded' check (authority in ('recorded', 'backfill'))`, plus:

```
check (
  name_type not in ('canonical', 'former_name')
  or authority = 'backfill'
  or minute_reference is not null
)
```

So: a **claim of officiality** (`canonical`, `former_name`) recorded as an act requires a minute; a backfill row is honestly marked minute-less; and the three matching aids (`historical_name`, `abbreviation`, `legacy_import_name`) require nothing. This gives Ruling 3's vocabulary teeth: *if you cannot cite a minute, the type you want is `historical_name` or `legacy_import_name`, not `former_name`.* Requiring a minute on the matching aids would either block the import this pipeline exists to enable or produce invented minute strings — 0044's "minting minute-less rows" failure, inverted.

**Two Hierarchies — the kickoff asks me to decide the write shape now because the RLS shape decides it. It does not, and that is the ruling.** `tenant_isolation` on `organization_id` says only *a council reads and writes its own records*. Whether a presbytery may record a name **about** a body it does not currently parent is an authority question, and under Ruling 1 authority is function-mediated — decided by `presby_record_org_name()` / `presby_resolve_import_row()`, neither of which ships here. The deferral is safe **because there is no INSERT grant**; if Phase 3 were to grant one, this question would become urgent in the same breath.

Two constraints on that future function, recorded now so the next pipeline does not re-derive them:

1. **Its standing test must be affiliation-as-of, never current-parent.** An importing presbytery legitimately records `legacy_import_name` rows for congregations that have since moved or dissolved. A `presby_assert_council_authority()`-style current-parent check refuses exactly the historical case the import exists for — F41's lesson, one table over.
2. **There is no general-purpose "record any name about any org" verb.** Name-recording during an import is a *consequence of resolving a staging row* and should be reachable only through the resolution function, which already has the batch's subject set in hand.

### Ruling 9 — The sibling writer: signature and contract only, not built. Confirming Gap 2 against the source.

I read `presby_write_return_publication_chain()` (`drizzle/0049:438-608`). Phase 1's reading is correct and the kickoff's "an import will be its third caller" is superseded: the function hard-codes `'submitted'` at `:513`, requires a presbytery recipient (`:477-483`), derives `supersedes_id`, and unconditionally writes a `publications` row and a `published_by_congregation` projection. An imported return has no publication event — the presbytery owns both sides. **It cannot be a caller; it needs a sibling.**

`presby_import_return()` is designed here as signature + contract and **built in the executor pipeline**. Contract, fixed now:

- `SECURITY DEFINER`, `set search_path = public, pg_temp` (DECISION-148).
- Inserts `statistical_returns` with `provenance = 'imported'`, `reconciled = false`, `about_org_id` ≠ `organization_id` permitted, `staging_row_id` set.
- Writes **no** `publications` row — the artifact only, plus (optionally, on a separate ruling) the `congregation_statistics` projection, whose `'imported'` slot already exists unused at `drizzle/0038:205`.
- **Arms `presby.publication_write_active`, not a new GUC** — `0046`'s own comment already commits to this ("It is also deliberately NOT split by provenance"). Honor it.
- Re-checks `presby_org_affiliated(about_org_id, organization_id, report_year)` at both year endpoints before arming anything, the `0049:492-498` pattern, so the trigger's rejection is unreachable by construction rather than by convention.
- **When it ships it becomes a second arming site**, which `scripts/test-rls.sql` §35 currently pins as unique for the publish chain. Nothing changes this increment; the next pipeline must update that pin rather than discover it in QA.

**Audit obligation, deferred and named:** every write path deferred above is a governance-sensitive act under Workflow Rule 7 — a council recording a former name, a clerk resolving a quarantined row, a resolution that creates an organization. `check:audit` scans `actions.ts` files and there are none here, so it is vacuously green; that is **not** evidence the obligation was met. The executor pipeline's Phase 4 gate mints the `AUDIT_ACTIONS` keys (shape: `import.batch.create`, `import.row.resolve`, `org.name.record`) and its Phase 5 must check them.

### Ruling 10 — Two concrete hazards for Phase 4/5.

- **No Real Data in `raw_payload`.** Gap 8 affirmed and sharpened: `check:secrets-pii` hard-fails only on credential shapes; a real congregation's name and a real 1987 membership count are **soft findings at best and probably silent**. The fixture row must be invented end to end in the `scripts/seed-dev.sql` house style, and the `column_map` must be an invented header set — a real presbytery's column headers are themselves identifying. QA should read the fixture, not trust the tripwire.
- **`check:sql-date` is dormant now and fires next pipeline.** The matcher returns `effective_from`/`effective_to` from a function, and the Neon driver returns computed date expressions as **strings** — there is no column OID to map against. No TypeScript reads them this increment, so nothing trips today; the executor pipeline's TS caller will. Worth one line in the matcher's own comment.

### New findings proposed for `docs/schema-design-2.md` (orchestrator applies at integration; F100 onward per the kickoff)

- **F100** — `organizations.platform_status` is already readable on the tenant connection: `organizations` has `relrowsecurity = f`, `presby_app` holds table-level `SELECT`, and `pg_attribute.attacl` is null on every column (verified live). So `presby_match_organization()`'s "never return `platform_status`" rule is a **surface** rule — it prevents a cross-council candidate list from *rendering* D9's tenant axis to a clerk — not a leak closure. The raw-grant reachability is pre-existing, is relied on in at least one deliberate place (`src/app/(org)/o/[slug]/admin/credentials/record-appointment-form.tsx:176` shows it for *affiliated* serving-org options), and is a separate hardening question (a column-level revoke plus a projection view). **Do not widen; do not attempt to close it in this increment.** `docs/TODO.md` line at integration.
- **F101** — F37's literal index `(lower(name), lower(city))` cannot serve a matcher that normalizes whitespace and punctuation: the index expression and the comparison would differ. Superseded by generated `name_normalized`/`city_normalized` stored columns with a btree on the pair (Ruling 4).
- **F102** — `import_rows.resulting_return_id` and `statistical_returns.staging_row_id` are two different facts, not a redundant pair; the `duplicate` disposition is what distinguishes them. Keep both, comment both, assert no agreement, and mind the FK cycle's write order and the freeze trigger's one permitted update (Ruling 6).
- **F103** — F40 generalized into a test rather than a table list: *a unique or EXCLUDE constraint on a FORCE-RLS table is an enumeration oracle exactly when its key is learnable from public data.* `organization_name_history` keys on the public `subject_org_id` → DML revoked, function-mediated (Ruling 1). `import_rows` keys on a random batch uuid → ordinary tenant DML (Ruling 5). Both rulings follow from one test; neither generalizes to "all new tenant tables."

---

## Proposed DECISION-153

> **DECISION-153 — `organization_name_history` is function-mediated; the import quarantine is not. (2026-09-26, architect Phase 2, `docs/work-log/2026-09-26-name-history-import-staging.md`)**
>
> Increment 7 adds three tenant tables and one matcher, and they divide on one test rather than on their subject matter.
>
> **`organization_name_history`** (in `src/lib/db/domain/org.ts`, beside `organization_identifiers`) is a council-act table in the D26 about-org shape: `organization_id` = the acting council, `subject_org_id` = the body named, plain FK by the §17 structural exception, `FORCE ROW LEVEL SECURITY` with `tenant_isolation`. Its partial EXCLUDE — `(subject_org_id, daterange(effective_from, effective_to, '[)'))` where `name_type = 'canonical'` — is keyed on a **publicly learnable** identifier, so F40 applies: with ordinary tenant DML the constraint is a cross-council existence oracle. `insert/update/delete` is therefore revoked from `presby_app`, the table joins §2c Ruling 1's function-mediation family, and the only writer this increment is the migration's own backfill (`authority = 'backfill'`, `organization_id = subject_org_id`, `city = null` — no address text-parsing, Phase 1 Gap 1). `presby_record_org_name()` is deferred to the lifecycle-UI pipeline with `presby_organize_congregation()`, and its standing test must be affiliation-as-of, never current-parent (F41's lesson one table over).
>
> **`import_batches` / `import_rows`** (new `src/lib/db/domain/imports.ts`; `index.ts` gains one appended export) are presbytery-owned, `FORCE RLS`, and keep ordinary tenant DML minus DELETE. The same test acquits them: their constraint keys are random uuids, unlearnable by a non-owner. The quarantine is durable (no DELETE on any connection), `raw_payload` and `candidates` are immutable after insert, and resolution is set-once. The consequential write — minting a `statistical_returns` row — stays where it already is: `presby_app` holds `SELECT` only there, behind the `presby.publication_write_active` GUC.
>
> **One rule, not two tables:** *a unique or EXCLUDE constraint on a FORCE-RLS table is an enumeration oracle exactly when its key is learnable from public data* (F103). Neither ruling generalizes beyond that test.
>
> **`presby_match_organization(name, city, year)`** is a `STABLE` **invoker** function over a new `organization_name_history_public` view (mirroring `organization_affiliations_public`), not a `SECURITY DEFINER` function over the base table: the projection physically excludes `organization_id`, `minute_reference`, `notes` and `authority`, making minimal disclosure structural rather than reviewed. Its return columns are enumerated and bounded at 20 rows; it returns `lifecycle_status` and the current parent so a clerk is not choosing blind between two same-named churches, and it **never returns `platform_status`** (DECISION-047) — a surface rule, since the raw grant already exposes that column on the tenant connection (F100). The year **ranks and never filters** (F30's failure mode), confidence is banded like `presby_match_person()`, and no similarity extension is installed or permitted without a fresh Phase 2 (`pg_trgm`/`unaccent`/`fuzzystrmatch` are all absent from the live branch; `btree_gist` is present and is the only extension this work needs).
>
> **A rename closes the canonical row and opens a new one**; the old name is not duplicated as a `former_name`, so "the name in force in year Y" has exactly one answer. A claim of officiality (`canonical`, `former_name`) requires a minute reference unless `authority = 'backfill'`; the three matching aids require none — requiring one would either block the import or invent minutes.
>
> **`statistical_returns.staging_row_id` gains its composite FK** to `import_rows(id, organization_id)` — composite because an imported return's `organization_id` *is* the presbytery, and because RI checks bypass RLS, so a plain FK would be an oracle of F40's family. `import_rows.resulting_return_id` is kept alongside it: the two record different facts and diverge on the `duplicate` disposition (F102). The pair is an FK cycle written in one transaction; the reverse FK is DDL-only (declaring it in `returns.ts` would cycle the domain module graph) and takes an `architectural` allowlist row in `scripts/check-schema-parity.ts`.
>
> **`presby_import_return()`** is specified and **not built**: `SECURITY DEFINER`, `search_path = public, pg_temp`, artifact-only with no `publications` row, arming the existing `presby.publication_write_active` GUC rather than a second one. `presby_write_return_publication_chain()` cannot serve it — it hard-codes `provenance = 'submitted'` (`drizzle/0049:513`). The audit obligation travels with the writers, not with this increment.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Done | Approved with suggestions | 2026-09-26 |

**Handoff:** to **tech-lead** (Phase 3). Rulings 1, 2, 4, 5c and 6 are binding and three of them override the kickoff as written — the matcher is invoker-over-view rather than `SECURITY DEFINER` (Ruling 2), the year ranks rather than filters and the F37 index changes shape with it (Ruling 4/F101), and the staging tables keep tenant DML while the name-history table does not (Rulings 1 and 5, one test, F103). Ruling 6.1's write order and freeze-trigger interaction, and Ruling 6.2's `check:schema-parity` allowlist row, are the two items most likely to be discovered in Phase 4 if they are not in the design doc. Carry Phase 1's Gaps 1–8, the three now-closed open questions, and the adversarial pass forward verbatim — Gap 2's correction in particular must not reappear as "the chain writer's third caller" in the Phase 3 API contract.



### Orchestrator note (2026-09-26)

Rulings 1, 2, 4, 5c, 6 and 7 are binding on Phase 3. Three override the kickoff as written and are accepted: the matcher is a STABLE invoker over `organization_name_history_public` (Ruling 2); the year ranks, never filters, and F37's index becomes generated normalized columns (Ruling 4 / F101); name-history DML is revoked from `presby_app` while the staging tables keep tenant DML minus DELETE (Rulings 1 and 5, F103). F100–F103 and DECISION-153 are adopted as proposed; the orchestrator records them at integration.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

This increment ships two schema families and one read-only matcher — nothing
that renders. `organization_name_history` (D14/F37) gives every organization
dated, typed, city-qualified names, so a future import can ask "who was called
this, where, in what year" and so a future report can render a congregation
under the name it held that year. `import_batches`/`import_rows` (D13) give a
future importer a durable quarantine — raw payload, candidates considered,
resolution kind, rationale, resulting return — so an unresolved spreadsheet row
is a reviewable record, never a dropped one. `presby_match_organization()` is
the one piece of behavior this increment actually exercises: a bounded,
minimal-disclosure candidate search over the name-history projection. Per
Phase 2 Ruling 1/F103, the two table families take opposite DML treatment on
the same test — `organization_name_history`'s EXCLUDE is keyed on a *publicly
learnable* id (`subject_org_id`), so it is function-mediated (no live INSERT
grant, this increment's only writer is the migration's own backfill); the
staging tables key on random uuids, so they keep ordinary tenant DML minus
DELETE. The import UI, the executor, and the two writer functions
(`presby_import_return()`, `presby_record_org_name()`) are named, contracted,
and explicitly **not** built here — that is the next pipeline's Phase 4, not
this one's.

## Permissions & Flags

- Permission key(s): **none new.** There is no enforcement point in this
  increment (Phase 1 Gap/Phase 2 concurrence) — DDL, a matcher with no caller
  but a test harness, and a migration-time backfill. `presby_app` gains no new
  grant that a permission key would gate.
- Default role bindings: n/a.
- Feature flag(s): **not needed.** (The future import UI should ship behind
  one — Phase 1's suggestion, `imports.name_history_staging` — but that flag
  belongs to the pipeline that builds the UI, not to this one.)

## API Contract

No route, no server action. One SQL function ships behavior; two more are
specified and deliberately not built (see "Deferred Writers" below).

### `presby_match_organization(p_name text, p_city text default null, p_year integer default null)`

```sql
returns table (
  organization_id      uuid,
  matched_name         text,
  name_type            text,
  city                 text,
  state                text,
  organization_type    text,
  lifecycle_status     text,
  current_parent_id    uuid,
  current_parent_name  text,
  effective_from       date,
  effective_to         date,
  rank                 integer,
  confidence           text
)
language sql stable security invoker
set search_path = public, pg_temp
```

- **Parameter order is valid SQL on its own terms, independent of the
  feasibility check below:** `p_name` (required, no default) precedes
  `p_city` and `p_year` (both `default null`) — defaults trail every required
  parameter.
- **Invoker, over `organization_name_history_public` + `organizations`**
  (Ruling 2 override) — never `SECURITY DEFINER` over the base table. The
  view physically excludes `organization_id` (recording council),
  `minute_reference`, `notes`, `authority`; minimal disclosure is structural,
  not a reviewed column list.
- **Never returns:** `platform_status`, `slug`, `deletable_until`, `status`
  (Ruling 4, the adversarial pass). `organization_type`/`lifecycle_status` are
  read directly off `organizations` (public, `relrowsecurity = f`) and cast to
  `text` so the return contract carries no custom enum type.
- **Input normalization** goes through one new immutable helper,
  `presby_normalize_org_match_text(text) returns text`, called both here and
  by the two generated columns below — one expression, one place, so F101
  cannot recur as "the index says one thing and the comparison says another."
  Defined as:

  ```sql
  create or replace function presby_normalize_org_match_text(p_text text)
  returns text
  language sql immutable
  set search_path = public, pg_temp
  as $$
    select lower(
      regexp_replace(
        regexp_replace(btrim(p_text), '\s+', ' ', 'g'),
        '[.,;:]+$', ''
      )
    );
  $$;
  ```

  Not `SECURITY DEFINER` (touches no table; DECISION-148 doesn't require the
  pin here, but it carries `search_path` anyway, matching Ruling 2's "harmless,
  consistent" treatment of the matcher itself). `grant execute ... to
  presby_app, presby_platform` — required because the matcher (invoker) calls
  it under the caller's own privileges, and the generated columns evaluate it
  under whichever role performs the write.
- **An empty or null normalized name returns zero rows, never an exception**
  (a raised error kills the caller's whole batch loop; a zero-candidate row is
  a legitimate `unresolved` outcome).
- **The year ranks; it never filters** (Open Question 3 / Ruling 4). Overlap
  semantics via `daterange(effective_from, effective_to, '[)') &&
  daterange(make_date(p_year,1,1), make_date(p_year+1,1,1), '[)')` — Postgres's
  native null-unbounded behavior on `daterange(null, null, '[)')` already gives
  "an unbounded-both-ends row always overlaps," so no special-casing is
  needed. `p_year is null` → the year predicate is skipped entirely (every row
  is `year-agnostic`, folded into the same rank as a year match).
- **Ranking, per candidate row** (not collapsed per organization — each
  matching `organization_name_history` row is its own candidate, because
  `matched_name`/`name_type`/`effective_from`/`effective_to` are facts about
  *that row*, not the organization as a whole; collapsing would have to pick
  one row's dates to report and silently drop the others):

  | Name match | City corroborated or unknown | Year overlaps or unbounded | Rank | Confidence |
  |---|---|---|---|---|
  | exact (normalized) | yes | yes | 1 | `exact` |
  | exact (normalized) | yes | no | 2 | `high` |
  | exact (normalized) | no (both known, disagree) | yes | 3 | `medium` |
  | exact (normalized) | no (both known, disagree) | no | 4 | `low` |

  "City corroborated or unknown" = `p_city is null or h.city_normalized is
  null or h.city_normalized = v_city_norm` — F33's key is "a name AT A PLACE,"
  but a genuinely unknown city on either side must not silently exclude a
  real match (Phase 1 Gap 1: most backfilled `canonical` rows have `city =
  null`). A known disagreement is downranked, never dropped — D13's
  quarantine-never-drop rule applies to candidate generation too, and the
  adversarial pass wants a clerk to be able to recognize "this is probably the
  right church, historically misrecorded city" rather than have it silently
  vanish.
- **Bounded `limit 20`, no `offset`, `order by rank, effective_from nulls
  last`.**
- **`check:sql-date` is dormant this increment, not closed.** The function
  returns `effective_from`/`effective_to` from a function call, and the Neon
  driver returns computed date expressions as **strings**, not `Date` — there
  is no column OID to map against (see `scripts/check-sql-date.mjs`'s own
  header). No TypeScript reads this function's output in this increment (its
  only caller is a `vitest` harness against the raw connection); the executor
  pipeline's first TypeScript caller must treat `effective_from`/`effective_to`
  as strings and annotate accordingly, not assume a `Date`.
- `revoke all ... from public; grant execute ... to presby_app, presby_platform;`
  on both `presby_match_organization` and `presby_normalize_org_match_text`.

### Deferred: `presby_import_return()` and `presby_record_org_name()`

Signature and contract only — see "Deferred Writers," below the Data Model.
Neither is called by anything this increment ships.

## Data Model

Three new tables, one new view, one new immutable helper function, one new
`STABLE` matcher function, and one additive change to an existing table — all
in `drizzle/0053_presby_name_history_import_staging.sql`, **one transaction**,
idempotent (`create table if not exists`, `add constraint` guarded by `do $$
if not exists ... $$`, matching `0044`'s own discipline), ending in the
backfill-completeness `DO` block. **Nothing in this migration is `SECURITY
DEFINER`** (Ruling 2 override applies transitively: the matcher is invoker,
the normalization helper touches no table, and the two freeze triggers below
only ever compare `OLD`/`NEW` of their own row — no cross-table RLS-protected
read, so none of them need to run as owner). DECISION-148's `search_path` pin
is therefore **inapplicable by absence**, not skipped — stated explicitly so
a reviewer doesn't go looking for a definer function this migration doesn't
have.

### Migration section order

1. `create extension if not exists btree_gist;` — idempotent; already
   installed on `pipeline-name-history` (verified by Phase 2), named here
   anyway per `0044`'s own precedent (extensions have slipped before).
2. `presby_normalize_org_match_text()` — must exist before the generated
   columns below reference it.
3. `organization_name_history` (table, CHECKs, EXCLUDE, indexes, RLS, grants,
   comment).
4. `organization_name_history_public` (view, grant).
5. Backfill — one open `canonical` row per existing organization.
6. `import_batches` (table, CHECKs, indexes, RLS, grants, freeze trigger).
7. `import_rows` (table, CHECKs, composite FK to `import_batches`, indexes,
   RLS, grants, freeze trigger).
8. `statistical_returns` additive changes — the composite FK on
   `staging_row_id`, the additive provenance CHECK.
9. `presby_match_organization()` (matcher, grants).
10. **Backfill-completeness assertion** (`DO` block, two counts) — the last
    statement before commit.

### 1. `organization_name_history` (new — `src/lib/db/domain/org.ts`, beside `organizationIdentifiers`)

```sql
create table if not exists organization_name_history (
  id uuid primary key default gen_random_uuid(),
  -- The ACTING council. Tenant scope for tenant_isolation. Self (= subject)
  -- for the backfill; a future presbytery act for everything else.
  organization_id uuid not null references organizations(id),
  -- The body the name describes. Plain FK, about-org pattern (organization
  -- ids are public — sec 17's structural exception — same shape
  -- organizationIdentifiers.organizationId and
  -- organizationLifecycleEvents.subjectOrgId already take).
  subject_org_id uuid not null references organizations(id),
  -- canonical | former_name | historical_name | abbreviation | legacy_import_name
  name_type text not null,
  name text not null,
  city text,
  state text,
  -- GENERATED, not hand-set — see presby_normalize_org_match_text() above.
  -- F101: must be the SAME expression the matcher applies to its inputs, or
  -- the index and the comparison silently diverge again.
  name_normalized text generated always as
    (presby_normalize_org_match_text(name)) stored,
  city_normalized text generated always as
    (presby_normalize_org_match_text(city)) stored,
  effective_from date,
  effective_to date,
  -- recorded | backfill. A minute-less row can only ever be an inferred one.
  authority text not null default 'recorded',
  minute_reference text,
  notes text,
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  constraint organization_name_history_id_org_key unique (id, organization_id),
  constraint organization_name_history_name_type_allowed
    check (name_type in ('canonical','former_name','historical_name',
                          'abbreviation','legacy_import_name')),
  constraint organization_name_history_authority_allowed
    check (authority in ('recorded','backfill')),
  -- Ruling 8: a CLAIM OF OFFICIALITY requires a minute unless it is honestly
  -- marked as an inference. The three matching aids require nothing — that
  -- would either block the import this pipeline exists to enable, or invent
  -- minutes.
  constraint organization_name_history_minute_shape
    check (name_type not in ('canonical','former_name')
           or authority = 'backfill'
           or minute_reference is not null),
  -- A single row's own interval must be well-formed (organization_affiliations_
  -- range_order's empty-range lesson, applied here too — an empty range is
  -- valid and would slip past the EXCLUDE below, which only fires WHERE
  -- name_type = 'canonical').
  constraint organization_name_history_range_order
    check (effective_to is null or effective_from is null
           or effective_to > effective_from),
  -- Length sanity, following statistics_submission_grants_name_shape
  -- (0049:141-142). This table specifically exists to absorb messy spreadsheet
  -- input, so an upper bound matters more here than on organizations.name
  -- (which has none).
  constraint organization_name_history_name_shape
    check (char_length(btrim(name)) between 1 and 255),
  constraint organization_name_history_city_shape
    check (city is null or char_length(btrim(city)) between 1 and 120),
  -- NOT a validated code set — historical and non-US forms exist. Do not
  -- "fix" this to char(2).
  constraint organization_name_history_state_shape
    check (state is null or char_length(btrim(state)) <= 64),
  -- Ruling 3: a rename closes the canonical row and opens a new one; the old
  -- name is never duplicated as a former_name. Partial — only 'canonical'
  -- rows are mutually exclusive in time; the other four types are assertions
  -- ABOUT the body and may overlap each other and the canonical succession
  -- freely.
  constraint organization_name_history_canonical_no_overlap
    exclude using gist (
      subject_org_id with =,
      daterange(effective_from, effective_to, '[)') with &&
    ) where (name_type = 'canonical')
  -- Ruling 7: deliberately NO not_self CHECK. organization_id = subject_org_id
  -- is the canonical-self case (the backfill, and any future congregation
  -- self-attestation); <> is the about-org case (a presbytery recording a
  -- former/historical/legacy name). Unlike organization_lifecycle_events,
  -- self-reference is a legitimate, expected shape here, not a polity
  -- violation.
);

create index if not exists organization_name_history_normalized_idx
  on organization_name_history (name_normalized, city_normalized);
create index if not exists organization_name_history_subject_type_idx
  on organization_name_history (subject_org_id, name_type, effective_from);

alter table organization_name_history enable row level security;
alter table organization_name_history force row level security;

drop policy if exists tenant_isolation on organization_name_history;
create policy tenant_isolation on organization_name_history
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Ruling 1 / F103: the EXCLUDE is keyed on subject_org_id, which is PUBLIC
-- (organizations has no RLS and presby_app holds SELECT on it). With
-- ordinary tenant DML, any presbytery could probe an insert naming any org id
-- and learn from the constraint-violation error whether SOME council it
-- cannot see has already recorded a canonical name for that body in that
-- window — the enumeration-oracle class arriving through a constraint. So:
-- DML is function-mediated, not policy-mediated. This increment's ONLY
-- writer is the migration's own backfill, below, running as the owner (no
-- grant binds it, F44) — there is deliberately no owner-path guard trigger
-- here yet, because there is no live writer for the trigger to distinguish
-- from an unsanctioned one. The future presby_record_org_name() (deferred,
-- see "Deferred Writers") is what earns one, the same day it earns the GUC
-- pattern organization_affiliations_guard already established.
revoke insert, update, delete on organization_name_history from presby_app;
grant select on organization_name_history to presby_app;
-- The 0044 narrowing (Ruling A5): presby_platform gets select+insert, no
-- update/delete — mirrors organization_affiliations exactly, for the same
-- reason (a future platform-provisioning path may need to seed a canonical
-- row the same way createOrganization() seeds an affiliation row).
grant select, insert on organization_name_history to presby_platform;

comment on table organization_name_history is
  'Dated, typed, city-qualified names for an organization (D14/F37). A name AT A PLACE is the matching unit (F33). presby_app holds SELECT only: organization_name_history_canonical_no_overlap keys on the PUBLIC subject_org_id, so an EXCLUDE constraint on this table is a cross-tenant existence oracle under ordinary tenant DML (F40/F103) exactly as it is on organization_affiliations. The future presby_record_org_name() SECURITY DEFINER function is the sole tenant-side writer; this increment''s only writer is the migration backfill.';
```

### 2. `organization_name_history_public` (view — DDL-only, no Drizzle/TS counterpart, matching the codebase's existing practice of never declaring `organization_affiliations_public` in TypeScript either)

```sql
create or replace view organization_name_history_public as
  select subject_org_id, name_type, name, city, state,
         name_normalized, city_normalized, effective_from, effective_to
    from organization_name_history;
grant select on organization_name_history_public to presby_app, presby_platform;

comment on view organization_name_history_public is
  'Ruling 2: a PLAIN (non-security_invoker) view, running with its owner''s privileges — the same call organization_affiliations_public already makes — so it sees past the base table''s tenant policy. organization_id (the recording council), minute_reference, notes and authority are ABSENT and must stay absent; widening this column list is a policy change, not a convenience. Operational note: this view''s cross-tenant visibility depends on its owner holding BYPASSRLS. If ownership ever moves to a non-bypassing role, the view returns zero rows silently (F26''s failure mode) — not a reason not to use a view, a reason to notice if it ever breaks.';
```

### 3. Backfill — one open `canonical` row per existing organization

```sql
insert into organization_name_history
  (organization_id, subject_org_id, name_type, name, city, state,
   effective_from, effective_to, authority, minute_reference, recorded_at)
select o.id, o.id, 'canonical', o.name, null, null,
       null, null, 'backfill', null, now()
  from organizations o
 where not exists (
   select 1 from organization_name_history h
    where h.subject_org_id = o.id and h.name_type = 'canonical'
      and h.effective_to is null
 );
```

- **`organization_id = subject_org_id` (self)** — Ruling 7: a body's own
  current name is its own record; nobody minuted it, and self-attribution is
  the truthful reading. `0044`'s affiliation backfill used `o.parent_id`,
  which is unavailable here because a parentless organization (a synod, the
  GA) still needs a canonical name row and the completeness assertion counts
  *every* organization.
- **`city = null`, always, on the backfill row** (Phase 1 Gap 1, reaffirmed):
  no text-parsing of `organization_profiles.address`. A wrong parsed city is
  worse than a missing one when city is the disambiguator (F33).
- **No `not_self` CHECK** blocks this (Ruling 7) — confirmed by construction,
  not by exception.

### 4. `import_batches` (new — `src/lib/db/domain/imports.ts`)

```sql
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  -- The presbytery running the import. Tenant scope.
  organization_id uuid not null references organizations(id),
  -- Invented in fixtures/tests (No Real Data) — a free-text label for where
  -- the rows came from, e.g. 'legacy binder scan'.
  source text not null,
  -- The worksheet/tab this batch decoded, per F32 (positional arrays only
  -- decode per tab — there is no single universal column order).
  worksheet text not null,
  -- REQUIRED, not nullable: column_map's target keys are THIS generation's
  -- field_spec (sasr_form_versions.field_spec) — without a form version there
  -- is nothing for the map to map INTO. A genuinely pre-1984 batch needs its
  -- own seeded sasr_form_versions row, not a null here.
  form_version_key text not null references sasr_form_versions(key),
  -- {"source column header": "target field key", ...}
  column_map jsonb not null,
  -- A fact about the SOURCE FILE, immutable. NOT resolved_count/
  -- unresolved_count (Ruling 5 — those are DERIVABLE from import_rows and
  -- would drift, memberships.current_roll's F29 lesson arriving in a new
  -- table).
  row_count integer not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint import_batches_id_org_key unique (id, organization_id),
  constraint import_batches_source_shape
    check (char_length(btrim(source)) between 1 and 120),
  constraint import_batches_worksheet_shape
    check (char_length(btrim(worksheet)) between 1 and 120),
  constraint import_batches_row_count_nonneg check (row_count >= 0)
);

alter table import_batches enable row level security;
alter table import_batches force row level security;

drop policy if exists tenant_isolation on import_batches;
create policy tenant_isolation on import_batches
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Ruling 5: ordinary tenant DML, minus DELETE. F40/F103 does NOT fire here —
-- nothing on this table is keyed on a publicly learnable identifier; a batch
-- id is a random uuid a non-owner cannot guess.
revoke delete on import_batches from presby_app, presby_platform;
grant select, insert, update on import_batches to presby_app;
-- No known present-day reason for the platform-shell connection to WRITE a
-- presbytery's import batch; select only, for /developer-style debugging.
grant select on import_batches to presby_platform;

comment on table import_batches is
  'One row per uploaded spreadsheet/worksheet, presbytery-owned (D13). Provenance columns are immutable after insert (import_batches_freeze); DELETE is refused on every connection including the owner.';
```

- **Freeze trigger** (Ruling 5c) — the provenance columns
  (`organization_id`, `source`, `worksheet`, `form_version_key`,
  `column_map`, `row_count`, `created_by`) never change after insert; DELETE
  is refused on **every** connection, owner included (F44: the grant revoke
  above binds `presby_app`/`presby_platform`, not `neondb_owner`).

  ```sql
  create or replace function presby_deny_import_batch_change()
  returns void language plpgsql as $$
  begin
    raise exception 'import_batches: this change is not permitted'
      using errcode = 'insufficient_privilege';
  end $$;

  create or replace function presby_freeze_import_batch()
  returns trigger language plpgsql as $$
  begin
    if TG_OP = 'DELETE' then
      perform presby_deny_import_batch_change();
      return old;
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.source is distinct from old.source
       or new.worksheet is distinct from old.worksheet
       or new.form_version_key is distinct from old.form_version_key
       or new.column_map is distinct from old.column_map
       or new.row_count is distinct from old.row_count
       or new.created_by is distinct from old.created_by
    then
      perform presby_deny_import_batch_change();
    end if;
    return new;
  end $$;

  drop trigger if exists import_batches_freeze on import_batches;
  create trigger import_batches_freeze
    before update or delete on import_batches
    for each row execute function presby_freeze_import_batch();
  ```

  Not `SECURITY DEFINER` — it only ever compares `OLD`/`NEW` of its own row,
  no cross-table RLS-protected read.

### 5. `import_rows` (new — `src/lib/db/domain/imports.ts`)

```sql
create table if not exists import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null references organizations(id),
  row_index integer not null,
  raw_payload jsonb not null,
  original_name text,
  original_city text,
  report_year integer not null,
  -- Snapshot of what the matcher returned AT RESOLUTION TIME. Frozen
  -- deliberately (Ruling 5c) — a later, better matcher must not rewrite the
  -- audit trail of what a clerk actually saw.
  candidates jsonb not null default '[]'::jsonb,
  -- unresolved | matched_existing | matched_alias | created_dissolved |
  -- duplicate | rejected
  resolution_kind text not null default 'unresolved',
  -- Plain FK — organizations is public, sec 17 structural exception. NO
  -- unique/EXCLUDE on this column (Ruling 5a) — that would manufacture the
  -- oracle Ruling 1 refuses one table over.
  resolved_org_id uuid references organizations(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  rationale text,
  -- PLAIN FK, deliberately NOT composite — see F104 below. A 'duplicate'
  -- disposition may point at a SUBMITTED return owned by the congregation,
  -- not the importing presbytery; a composite FK against this row's own
  -- organization_id would refuse exactly the case D13's dedup exists to
  -- catch.
  resulting_return_id uuid references statistical_returns(id),
  created_at timestamptz not null default now(),
  constraint import_rows_id_org_key unique (id, organization_id),
  constraint import_rows_batch_row_key unique (batch_id, row_index),
  foreign key (batch_id, organization_id)
    references import_batches (id, organization_id),
  constraint import_rows_resolution_kind_allowed
    check (resolution_kind in ('unresolved','matched_existing','matched_alias',
                                'created_dissolved','duplicate','rejected')),
  constraint import_rows_row_index_nonneg check (row_index >= 0),
  constraint import_rows_report_year_range
    check (report_year between 1900 and 2100),
  -- Shape CHECK, statistical_returns_provenance_shape idiom.
  constraint import_rows_resolution_shape check (
    (resolution_kind = 'unresolved'
       and resolved_org_id is null and resolved_by is null
       and resolved_at is null and resulting_return_id is null
       and rationale is null)
    or (resolution_kind in ('matched_existing','matched_alias','created_dissolved')
       and resolved_org_id is not null and resolved_by is not null
       and resolved_at is not null)
    or (resolution_kind = 'duplicate'
       and resolved_org_id is not null and resolved_by is not null
       and resolved_at is not null and rationale is not null)
    or (resolution_kind = 'rejected'
       and resolved_org_id is null and resolved_by is not null
       and resolved_at is not null and rationale is not null
       and resulting_return_id is null)
  )
);

create index if not exists import_rows_batch_idx on import_rows (batch_id);
create index if not exists import_rows_org_status_idx
  on import_rows (organization_id, resolution_kind);

alter table import_rows enable row level security;
alter table import_rows force row level security;

drop policy if exists tenant_isolation on import_rows;
create policy tenant_isolation on import_rows
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

revoke delete on import_rows from presby_app, presby_platform;
grant select, insert, update on import_rows to presby_app;
grant select on import_rows to presby_platform;

comment on table import_rows is
  'D13 quarantine: one row per source spreadsheet row, presbytery-owned. raw_payload and candidates are immutable after insert (import_rows_freeze); resolution is SET-ONCE per row (old.resolution_kind must be unresolved to resolve; resulting_return_id may then be stamped exactly once more). DELETE is refused on every connection. created_dissolved is nameable but UNREACHABLE this increment — presby_organize_congregation() is deferred to the lifecycle-UI pipeline.';
```

**F104 (new, tech-lead Phase 3) — `resulting_return_id` is a plain FK, not
composite, and this is the §17 structural exception, not an oversight of
Ruling 6.** Ruling 6 requires `statistical_returns.staging_row_id`'s FK to
`import_rows` be composite because an imported return's `organization_id`
*is* the presbytery — the two sides always share a tenant. The reverse
relationship does not share that property: `import_rows.resulting_return_id`
can legitimately name a **`submitted`** return the congregation itself
already filed (F102's `duplicate` disposition — a presbytery imports a row
for a congregation that had already self-filed through its own portal). That
return's `organization_id` is the congregation, not the importing presbytery,
so a composite FK pinned to `import_rows.organization_id` would reject the
exact row D13's deduplication exists to record. `resulting_return_id` joins
`about_org_id` and `subject_org_id` as a plain, deliberately non-composite
reference under the same structural exception (`docs/schema-design.md` sec
17) — logged for `docs/schema-design-2.md` at integration.

**Freeze/resolution trigger** (Ruling 5c + Ruling 6.1's write-order
consequence, spelled out precisely — this is the part most likely to be
rediscovered the hard way in Phase 4 if it is not exact here):

```sql
create or replace function presby_deny_import_row_change()
returns void language plpgsql as $$
begin
  raise exception 'import_rows: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

create or replace function presby_freeze_import_row()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    perform presby_deny_import_row_change();
    return old;
  end if;

  -- The frozen set never changes on ANY update, regardless of path.
  if new.batch_id is distinct from old.batch_id
     or new.organization_id is distinct from old.organization_id
     or new.row_index is distinct from old.row_index
     or new.raw_payload is distinct from old.raw_payload
     or new.original_name is distinct from old.original_name
     or new.original_city is distinct from old.original_city
     or new.report_year is distinct from old.report_year
     or new.candidates is distinct from old.candidates
  then
    perform presby_deny_import_row_change();
  end if;

  if old.resolution_kind <> 'unresolved' then
    -- PATH B — THE STAMP (Ruling 6.1). An already-resolved row may have
    -- resulting_return_id set from null, and NOTHING else, exactly once.
    if old.resulting_return_id is null
       and new.resulting_return_id is not null
       and new.resolution_kind = old.resolution_kind
       and new.resolved_org_id is not distinct from old.resolved_org_id
       and new.resolved_by is not distinct from old.resolved_by
       and new.resolved_at is not distinct from old.resolved_at
       and new.rationale is not distinct from old.rationale
    then
      return new;
    end if;
    -- Includes a second attempt to change resulting_return_id once set.
    perform presby_deny_import_row_change();
  end if;

  -- PATH A — THE RESOLVE. old.resolution_kind = 'unresolved': may set
  -- resolution_kind/resolved_org_id/resolved_by/resolved_at/rationale
  -- together (the shape CHECK validates the resulting combination), but
  -- NEVER resulting_return_id in this same step — that is Path B's job,
  -- always a separate statement/transaction (Ruling 6 consequence 1: insert
  -- import_rows [return null] -> insert statistical_returns -> update
  -- import_rows.resulting_return_id).
  if new.resulting_return_id is not null then
    perform presby_deny_import_row_change();
  end if;

  return new;
end $$;

drop trigger if exists import_rows_freeze on import_rows;
create trigger import_rows_freeze
  before update or delete on import_rows
  for each row execute function presby_freeze_import_row();
```

Not `SECURITY DEFINER` — same reasoning as the batch freeze trigger.

### 6. `statistical_returns` — additive changes only (0046 is shipped; not edited)

```sql
alter table statistical_returns
  add constraint statistical_returns_staging_row_fk
  foreign key (staging_row_id, organization_id)
  references import_rows (id, organization_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'statistical_returns_import_provenance_shape'
  ) then
    alter table statistical_returns
      add constraint statistical_returns_import_provenance_shape
      check (provenance = 'imported'
             or (staging_row_id is null and source_ref is null));
  end if;
end $$;
```

- **Composite, and required — Ruling 6.** `MATCH SIMPLE` (Postgres's default)
  means a `submitted` row's null `staging_row_id` skips the check entirely; no
  special-casing needed. An imported return's `organization_id` *is* the
  presbytery, and RI checks bypass row security by design, so a plain FK to a
  FORCE-RLS table would be a cross-tenant existence oracle in F40's family —
  the composite confines the probe to the prober's own org. Unreachable today
  regardless (`presby_app` has no INSERT on `statistical_returns`), but the
  constraint is correct on its own terms, not by accident of a grant.
- **`import_rows.resulting_return_id` is kept alongside it and is NOT
  asserted to agree** (F102): the two record different facts (*this artifact
  was created from that row* vs. *this row's disposition points at that
  return, possibly one it did not create*) and diverge on `duplicate`. Do not
  "simplify" one away.
- **This is a second module-graph cycle if declared in `returns.ts`** — same
  shape as the `blob_assets` case (`assets.ts:63-78`). `imports.ts` already
  imports `returns.ts` (for `statisticalReturns`, on the `resultingReturnId`
  FK above); declaring the reverse FK in `returns.ts` would make `returns.ts`
  import `imports.ts` too, cycling the graph. **DDL-only**, `scripts/check-
  schema-parity.ts` allowlist row required (below).
- **The additive CHECK's grouping is intentional, not exhaustive of every
  provenance fact:** it only says "imported provenance columns imply imported
  provenance," which is the direction that matters for correctness — a
  `submitted` row can never smuggle staging provenance onto itself. It does
  *not* require an `imported` row to carry both columns (an `imported` row
  minted before `import_rows` existed — none do, but the CHECK should not
  assume otherwise going forward) — matching `0046`'s own restraint on
  `statistical_returns_provenance_shape`.

### 7. `presby_match_organization()` and its helper — see API Contract, above.

## TypeScript Domain Model

- **`src/lib/db/domain/org.ts`** gains `organizationNameHistory` (`pgTable`,
  as above, using `.generatedAlwaysAs(sql\`presby_normalize_org_match_text(name)\`,
  { mode: "stored" })` / `...(city)...` for the two normalized columns) plus
  the `NameType` TS union, mirroring `RelationshipType`'s export shape at the
  bottom of `lifecycle.ts`. Placed beside `organizationIdentifiers` per Phase
  2's placement ruling (identifiers and names are both alternate keys for the
  same body, both council-written, both exist for import matching — Gap 5's
  conflation risk is reduced by co-location, and the cross-reference comment
  between `kind = 'legacy_import'` and `name_type = 'legacy_import_name'`
  belongs on both tables, forty lines apart, not in two files).
- **`src/lib/db/domain/imports.ts`** (new) exports `importBatches`,
  `importRows`, and a `ResolutionKind` TS union. Imports `organizations` from
  `./org`, `statisticalReturns` from `./returns`, `users` from `../schema` —
  one-way, per Phase 2's module-graph ruling (`imports.ts` → `{org.ts,
  returns.ts, ../schema}`, never the reverse). The module header states, in
  the house style, everything not expressible in Drizzle: the EXCLUDE (not
  applicable here, but the freeze triggers, the two-path resolution
  discipline, the plain vs. composite FK distinction on `resolved_org_id` vs.
  the deliberately-absent unique, and F104's reasoning on
  `resultingReturnId`).
- **`src/lib/db/domain/index.ts`** gains exactly one appended line, at the end
  of the export list (Workflow Rule 16 shared-file discipline — the kickoff's
  own instruction for this branch: implementer appends this directly, as one
  delimited line, not the orchestrator):

  ```ts
  export * from "./imports";
  ```

- **`src/lib/db/domain/returns.ts`** — no column or table change (the
  `stagingRowId` column already exists, per `0046`). Its docstring at the
  `stagingRowId` field comment is **updated in place** (proposed text, for
  the implementer to paste in):

  > `stagingRowId`: *D13 import provenance. Composite FK to
  > `import_rows(id, organization_id)`, enforced DDL-only in
  > `drizzle/0053_presby_name_history_import_staging.sql` — declaring it here
  > would create a second `returns.ts` ↔ `imports.ts` module cycle (the
  > `blob_assets` shape, `assets.ts:63-78`). `statistical_returns_import_
  > provenance_shape` (same migration) requires this column to be null on
  > every `submitted` row.*

- **`scripts/check-schema-parity.ts`** — one new `ALLOWLIST` entry, `category:
  "architectural"`, template-matched to the `statistics_submission_grants`
  STAMP row already in the file:

  ```ts
  {
    table: "statistical_returns",
    kind: "extra_fk",
    fk: "(staging_row_id,organization_id) -> import_rows(id,organization_id)",
    category: "architectural",
    reason:
      "DDL-only composite FK (drizzle/0053_presby_name_history_import_staging.sql); declaring it in returns.ts would create a returns.ts <-> imports.ts module cycle — imports.ts already imports returns.ts for statisticalReturns.",
    since: "2026-09-26",
  },
  ```

  **No `pending` row, no `docs/TODO.md` line** (Ruling 6.2) — there is nothing
  to close; this is the permanent, correct shape.

## Component / Page Plan

**Not applicable, and that is the correct result, not an omission** (Phase 2
concurs). No page, no route handler, no `actions.ts`, no component, no
`'use client'` boundary. `check:audit` and `check:brand-scope` are vacuously
green. A reviewer who goes looking for one in Phase 4 has misread the scope.

## Shared-File Appends — Proposed

Per the kickoff's shared-file discipline for this branch, `database-admin`
appends the following directly (each as one clearly delimited block at the
end of its file). `drizzle/meta/_journal.json` is the one exception — its new
entry (`idx: 53`) is added by the **orchestrator at integration**, not by the
implementer, because migrations `0051`/`0052` are pre-assigned to other
concurrent pipelines not yet merged to `main`; this branch's own journal will
apply `0053` directly after `0050` for its own rehearsal, and the orchestrator
resequences the three journal entries in whatever order the three PRs
actually land.

### `scripts/test-rls.sql` §42 (proposed assertion list)

Following §32/§34/§40's own structure (`begin;`/`commit;` blocks,
`assert_eq()`, one comment block per numbered item citing the finding/ruling
it proves):

1. **Grant shape.** `organization_name_history`: `presby_app` holds `SELECT`
   only (no INSERT/UPDATE/DELETE); `presby_platform` holds `select, insert`
   only. `import_batches`/`import_rows`: `presby_app` holds `select, insert,
   update`, **no** `delete`; `presby_platform` holds `select` only, no
   `insert`/`update`/`delete`. (Catalog query against
   `information_schema.role_table_grants`, the `0044`/`0049` idiom.)
2. **FORCE RLS + policy present** on all three new tables (`pg_class.
   relforcerowsecurity` and `pg_policies`, the standard per-table pair every
   prior section runs).
3. **The canonical EXCLUDE rejects an overlapping canonical for the same
   subject**, run as owner (the only connection that can write the table this
   increment): insert a second open canonical row for an existing subject →
   `exclusion_violation`. **Positive control:** a `former_name` row for the
   same subject, overlapping the same interval, is accepted — the EXCLUDE's
   `where (name_type = 'canonical')` partial clause is doing the work, not an
   accidental table-wide uniqueness.
4. **The minute-shape CHECK.** A `canonical`/`former_name` row with
   `authority = 'recorded'` and `minute_reference` null → `check_violation`.
   The same row with `authority = 'backfill'` → accepted. A
   `legacy_import_name` row with no minute and `authority = 'recorded'` →
   accepted (the three matching aids require nothing).
5. **`organization_name_history_public` excludes exactly the four columns**
   named in Ruling 2 — `select count(*) from information_schema.columns
   where table_name = 'organization_name_history_public' and column_name in
   ('organization_id','minute_reference','notes','authority')` = 0, alongside
   a positive count of the nine columns that ARE present = 9.
6. **The matcher never returns `platform_status`.** `select
   count(*) from information_schema.routines ... ` is the wrong tool for a
   `returns table (...)` shape; assert instead by calling
   `presby_match_organization('Alder Creek Presbyterian Church')` and
   checking the returned column set via `\d` — or, more mechanically,
   assert the function's `pg_proc.proargnames`/return-type OID does not
   include a `platform_status`-shaped column. (Implementer's call on the
   cheapest reliable form; the property is what matters, and F100 makes clear
   the base-table grant reachability is a SEPARATE, already-accepted residual
   this function's own column list must not reproduce.)
7. **Cross-tenant match works.** As Alder Creek (`app.current_org_id` =
   Alder Creek), call `presby_match_organization('Bramblewood Presbyterian
   Church')` and confirm Bramblewood's row is returned — proving the view's
   owner-privilege visibility crosses the tenant boundary the base table's
   RLS would otherwise enforce (this is the whole point of Ruling 2's view
   shape, and the one thing a unit test against the base table alone cannot
   prove).
8. **Freeze triggers, run as owner (F44 — the connection that matters):**
   - `import_batches`: `DELETE` → `insufficient_privilege`. `UPDATE` changing
     `source` → `insufficient_privilege`. A no-op `UPDATE` (e.g. re-writing
     `created_at` to itself) → accepted, since no tracked column actually
     changed.
   - `import_rows`: `DELETE` → `insufficient_privilege`, **even as owner**.
     `UPDATE` changing `raw_payload` → `insufficient_privilege`. Resolving an
     `unresolved` row (Path A: set `resolution_kind`/`resolved_org_id`/
     `resolved_by`/`resolved_at` together) → accepted. **Then**, on that now-
     resolved row, setting `resulting_return_id` alone (Path B) → accepted.
     **Then**, attempting to change `resulting_return_id` a second time (or
     any other column) on that same row → `insufficient_privilege`. A direct
     Path-B-shaped update attempted on a row that is STILL `unresolved` (i.e.
     skipping Path A) → `insufficient_privilege` (the `old.resolution_kind <>
     'unresolved'` guard on Path B's branch refuses it).
9. **Backfill: exactly one open `canonical` row per organization,** run once
   against the freshly migrated (pre-`seed-dev.sql`) database: `select
   count(*) from organizations` equals `select count(*) from
   organization_name_history where name_type = 'canonical' and effective_to
   is null`, and every backfilled row has `authority = 'backfill'`, `city is
   null`, `organization_id = subject_org_id`.
10. **`statistical_returns_import_provenance_shape`** rejects a `submitted`
    row carrying a non-null `staging_row_id` or `source_ref`, run as owner
    (the only connection that can write `statistical_returns` at all today).
11. **The composite FK on `staging_row_id`** rejects a `staging_row_id` that
    names a real `import_rows.id` belonging to a **different** organization
    than the `statistical_returns` row's own `organization_id` (`foreign_
    key_violation`), and accepts one that matches.

Marked, per §35's own convention, which of the above are reachable from
`presby_app` at all (items 3, 4, 8, 9, 10, 11 require the owner connection,
since `presby_app` holds no write path onto `organization_name_history` or
`statistical_returns`; items 1, 2, 5, 6, 7 are reachable and proven from the
tenant connection).

### `scripts/seed-dev.sql` (proposed fixture — appended; invented names throughout, No Real Data)

**A renamed congregation, demonstrating Ruling 3 correctly (canonical closes
and reopens; the old name is NOT duplicated as a `former_name`):**

- Bramblewood Presbyterian Church (`33333333-...-0003`, Northern Reach) — the
  migration's backfill already gave it one open `canonical` row (`name =
  'Bramblewood Presbyterian Church'`, `authority = 'backfill'`,
  `effective_from = null`). Seed-dev, running as owner (no trigger blocks the
  owner path on this table this increment), **narrows** that row's
  `effective_from` to `'1988-06-01'` and **inserts** a closed predecessor:
  `name = 'Mill Creek Presbyterian Church'`, `name_type = 'canonical'`,
  `authority = 'recorded'`, `minute_reference = 'Northern Reach stated
  meeting, 1988-06-01, item 3'`, `effective_from = null` (predates our
  records), `effective_to = '1988-06-01'`. Proves the EXCLUDE accepts two
  adjacent, non-overlapping canonical rows for the same subject.

**A `former_name` row, demonstrating the type distinctly from `canonical`
(unbounded, no exclusivity):**

- Quillhaven Presbyterian Church (`44444444-...-0004`) — `name_type =
  'former_name'`, `name = 'Quill Run Presbyterian Church'`, `effective_from =
  null`, `effective_to = null` (genuinely unreconstructable interval — Ruling
  3's own definition of the type), `authority = 'recorded'`,
  `minute_reference = 'Southern Fields stated meeting, 1901-04-02, item 1'`
  (reusing Quillhaven's own existing origin minute from the affiliation
  fixture, `scripts/seed-dev.sql:119` — continuity, not coincidence).

**One staged batch with one genuinely unresolved row (zero candidates — the
legitimate empty-match outcome Ruling 4 names):**

- `import_batches`: `organization_id` = Northern Reach, `source =
  'synthetic legacy binder scan'`, `worksheet = 'Statistical Summary'`,
  `form_version_key = '1984'`, `column_map = '{"Congregation Name":
  "original_name", "City": "original_city", "Active Members": "ending_
  active"}'::jsonb`, `row_count = 1`, `created_by = null`.
- `import_rows`: the one row in that batch, `row_index = 0`, `raw_payload =
  '{"Congregation Name": "Mount Amity Chapel", "City": "Unincorporated",
  "Active Members": "41"}'::jsonb`, `original_name = 'Mount Amity Chapel'`,
  `original_city = 'Unincorporated'`, `report_year = 1987`, `candidates =
  '[]'::jsonb` (calling `presby_match_organization('Mount Amity Chapel',
  'Unincorporated', 1987)` against this fixture set genuinely returns zero
  rows — no seeded organization has ever been called anything like it),
  `resolution_kind` left at its `'unresolved'` default.

## Implementation Order

1. **Apply `drizzle/0053_...sql`** on `pipeline-name-history`
   (`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0053_...sql`
   or `npm run db:migrate` against a from-empty database) — the transaction
   commits only if the backfill-completeness assertion holds.
2. **`npm run check:schema-parity`** — confirms the three new tables, their
   columns/nullability, and the one `extra_fk` allowlist entry are exactly
   what the live catalog shows.
3. **`npm run db:seed`** — unaffected by this migration; run for parity with
   the documented recipe.
4. **`psql ... -f scripts/seed-dev.sql`** (with `-v ON_ERROR_STOP=1`) — the
   renamed-congregation and staged-batch fixtures above.
5. **`psql ... -f scripts/install-test-helpers.sql`** then **`psql ... -f
   scripts/test-rls.sql`** — §42 must pass alongside every prior section
   (re-running the whole suite, not just the new section, is what proves
   nothing upstream regressed).
6. **`npm run typecheck`.**
7. **DB-backed vitest subset, serial** (`--no-file-parallelism`, per
   `docs/testing.md`) — a new `src/lib/db/domain/imports.test.ts` exercising
   the freeze triggers' two paths directly against `PLATFORM_DATABASE_URL`
   (the connection the triggers exist for, F44 — the same pattern
   `lifecycle.test.ts`/`publication.test.ts` already use), plus the matcher's
   ranking bands and its empty-input zero-rows behavior.
8. **`npm run docs:erd`** — regenerates `/developer`'s ER diagrams to include
   the three new tables.
9. **The from-empty recipe** (`docs/testing.md`): a second, genuinely
   from-scratch database (fresh `CREATE DATABASE` or an ephemeral branch) run
   through `db:migrate` → `check:schema-parity` → `db:seed` → `seed-dev.sql`
   → `test-rls.sql`, proving `0053` reproduces cleanly on top of whatever
   `0051`/`0052` land as, not just on this branch's already-migrated dev
   database (DECISION-150).

**Expected counts** (fresh migration, before `seed-dev.sql`): `count(organizations)
= count(organization_name_history where name_type = 'canonical' and
effective_to is null)` — 15 on the current seed shape; `count(import_batches)
= count(import_rows) = 0`. **After `seed-dev.sql`:** Bramblewood carries 2
canonical rows (1 closed, 1 open) instead of 1; Quillhaven carries 1
`former_name` row in addition to its 1 canonical; `import_batches` = 1;
`import_rows` = 1, `resolution_kind = 'unresolved'`.

**Failing-first cases** (each must fail before the corresponding mechanism
exists, and pass after, per the regression-test discipline):

- Second open canonical row for the same `subject_org_id` → `exclusion_violation`.
- `insert into organization_name_history ...` as `presby_app` → `insufficient_privilege` (grant).
- `delete from import_rows` as owner → `insufficient_privilege` (trigger, not grant).
- `update import_rows set raw_payload = ...` → `insufficient_privilege`.
- A second `update import_rows set resulting_return_id = ...` on an already-stamped row → `insufficient_privilege`.
- `insert into statistical_returns (..., provenance, staging_row_id, source_ref) values (..., 'submitted', <not null>, ...)` → `check_violation` (the new additive CHECK).
- `insert into statistical_returns (..., staging_row_id, organization_id) values (..., <real import_rows.id belonging to a different org>, ...)` → `foreign_key_violation`.
- `presby_match_organization('')` / `presby_match_organization(null)` → zero rows, no exception.

## Deferred Writers — Contract Only, Not Built

Confirming Phase 1 Gap 2 / Phase 2 Ruling 9 against the source one more time:
`presby_write_return_publication_chain()` (`drizzle/0049:438-608`) hard-codes
`provenance = 'submitted'` at line 513, requires a presbytery recipient, and
unconditionally writes a `publications` row plus a `published_by_congregation`
projection. An imported return has no publication event to write — the
presbytery already owns both sides. It cannot be a third caller; it needs a
sibling.

### `presby_import_return(p_about_org_id uuid, p_organization_id uuid, p_report_year integer, p_form_version text, p_payload jsonb, p_staging_row_id uuid, p_source_ref text default null)` — **signature only, not built**

- `SECURITY DEFINER`, `set search_path = public, pg_temp` (DECISION-148 —
  this is the first function in this pipeline that legitimately needs it).
- Inserts `statistical_returns` with `provenance = 'imported'`, `reconciled =
  false`, `staging_row_id = p_staging_row_id`, `about_org_id` may differ from
  `organization_id`.
- Writes **no** `publications` row — artifact only. Optionally (a separate
  ruling for the executor pipeline, not this one) the `congregation_
  statistics` projection, whose `'imported'` slot already exists unused at
  `drizzle/0038:205`.
- **Arms `presby.publication_write_active`**, the existing GUC — not a second
  one (`0046`'s own comment: "deliberately NOT split by provenance").
- Re-checks `presby_org_affiliated(p_about_org_id, p_organization_id,
  make_date(p_report_year, 1, 1)) or ...(..., 12, 31))` before arming
  anything, the `0049:492-498` pattern — so the trigger's own rejection is
  unreachable by construction.
- **Becomes a second arming site** the moment it ships — `scripts/test-
  rls.sql` §35 currently pins the publish chain as the *unique* arming site;
  the executor pipeline must update that pin, not discover the failure in
  QA.
- Owned by: the executor pipeline.

### `presby_record_org_name(p_subject_org_id uuid, p_name_type text, p_name text, p_city text, p_state text, p_effective_from date, p_effective_to date, p_minute_reference text default null)` — **signature only, not built**

- `SECURITY DEFINER`, `set search_path = public, pg_temp`.
- **Standing test must be affiliation-as-of, never current-parent** (Ruling
  8.1 — F41's lesson one table over: an importing presbytery legitimately
  records `legacy_import_name` rows for congregations that have since moved
  or dissolved; a current-parent check would refuse exactly the historical
  case the import exists for).
- **No general-purpose "record any name about any org" verb** (Ruling 8.2) —
  reachable only through the future import-row resolution function, which
  already has the batch's subject set in hand.
- For `name_type = 'canonical'`: closes the currently-open canonical row
  (`effective_to = p_effective_from`) and opens the new one in the same
  transaction — Ruling 3's discipline, enforced by the function, not
  discoverable as a bare INSERT.
- Uses `presby_deny_organization_name_history_change()`'s single-literal-
  rejection discipline (the `presby_deny_affiliation_change()` pattern) so no
  rejection cause is distinguishable from another.
- Owned by: the lifecycle-UI pipeline, alongside `presby_organize_
  congregation()` — build both once, there, not twice.

**Audit obligation, deferred and named** (Ruling 9's own note, carried
forward): a council recording a former name, a clerk resolving a quarantined
row, a resolution that creates an organization, are all governance-sensitive
acts under Workflow Rule 7. `check:audit` is vacuously green this increment —
that is not evidence the obligation was met, only that there is no
`actions.ts` file yet for it to scan. The executor pipeline's Phase 4 gate
mints the `AUDIT_ACTIONS` keys (`import.batch.create`, `import.row.resolve`,
`org.name.record`) and its Phase 5 must verify them.

### `docs/TODO.md` lines proposed at integration

- `[ ] F100 — organizations.platform_status is readable on the tenant
  connection (relrowsecurity = f, presby_app holds table-level SELECT).
  Hardening question (column-level revoke + projection view), not this
  pipeline's to close.`
- `[ ] Executor pipeline: presby_import_return() and presby_record_org_name()
  — build per docs/work-log/2026-09-26-name-history-import-staging.md Phase
  3's "Deferred Writers" contracts. Owns the AUDIT_ACTIONS keys, the §35
  arming-site pin update, and (for presby_record_org_name()) the revision
  mechanism for a mis-resolved import_rows row (Ruling 5c's "no correction
  path, chosen deliberately").`
- `[ ] presby_organize_congregation() — still deferred to the lifecycle-UI
  pipeline (confirmed again this increment; D13's "create new dissolved
  organization" disposition, resolution_kind = 'created_dissolved', is
  nameable in the schema but unreachable until this ships).`

## Edge Cases & Risks

- **A `duplicate`-disposition `import_rows` row can point, via
  `resulting_return_id`, at a `statistical_returns` row the importing
  presbytery cannot itself `SELECT`** (a `submitted` return owned by the
  congregation). This is *correct* under `tenant_isolation` — the presbytery
  is not automatically entitled to read the congregation's own filing — but
  it means a naive join from the future resolution UI will silently return
  nothing for that one reference. The executor pipeline needs a read-path
  decision here (a small `SECURITY DEFINER` summary reader, in the
  `presby_list_published_returns_to_me()` family, or accept the row is
  reference-only and unrenderable from the presbytery's own context). Named
  now because F104's FK shape is what makes the scenario reachable at all;
  not a blocker for this increment, since nothing renders yet.
- **`organizations.name` cannot itself change** (`presby_app` holds no DML on
  `organizations` at all, per F38's revoke). `organization_name_history`'s
  `canonical` row is therefore the only place a rename is ever recorded; a
  future reader must not expect `organizations.name` to track the live
  canonical name automatically — there is no trigger that copies one into the
  other, and adding one is a separate design question this increment does not
  answer.
- **A malformed or hostile spreadsheet cell lands in `raw_payload`/
  `original_name` untouched.** `presby_match_organization()` normalizes
  defensively (empty input → zero rows, never an exception), but `raw_payload`
  itself is stored as-is, jsonb, with no shape validation — that is the point
  of a quarantine table, and the executor pipeline's own ingest step is where
  a malformed worksheet (wrong tab name, no header row, embedded newlines —
  F32's own finding) gets a human-readable failure, not this schema.
- **The backfill runs before `presby_organize_congregation()` exists**, so
  every organization in the system today gets a `canonical` row with `city =
  null`. A future presbytery hand-entering historical city data for its own
  congregations has no UI to do so this increment (no writer ships) — the
  data model supports it; nothing calls it yet.
- **No Real Data, concretely** (Ruling 10, reaffirmed): the seed fixture's
  `column_map` and `raw_payload` are invented end-to-end, following
  `scripts/seed-dev.sql`'s existing invented-congregation house style
  (Bramblewood/Quillhaven/Northern Reach, already established fixtures). A
  real presbytery's spreadsheet column headers are themselves identifying and
  must never be lightly-edited into a fixture "for realism" — `check:secrets`
  (`scripts/check-secrets-pii.mjs`) hard-fails only on credential shapes, not
  on a real congregation's name or a real 1987 membership count, so this is a
  human review obligation on the implementer and QA, not a tripwire that
  would catch a slip.
- **`check:sql-date` is dormant, not closed** (restated from the API
  Contract): the matcher's `effective_from`/`effective_to` come back from the
  Neon driver as strings, with no column OID to map against. Nothing in this
  increment's TypeScript reads them; the executor pipeline's first caller
  must not assume `Date`.

## Out of Scope (confirmed, carried forward from Phase 1/2)

- The import UI (upload, quarantine review/resolution screens).
- The import executor (spreadsheet ingest, per-row matcher calls, `import_rows` writes).
- `presby_organize_congregation()`.
- `presby_import_return()` and `presby_record_org_name()` as running code — contract only, above.
- The `AUDIT_ACTIONS` keys for any of the above.
- Geocoding or address-parsing for `organization_profiles` — `city` stays `null` on every backfilled row.
- D22 (person-merge matching) and D23 (care-ministry grants) — unrelated axes.

## Findings & Decisions Adopted (this increment's Phase 2 output, plus one Phase 3 addition)

Adopted verbatim from Phase 2, for the orchestrator to fold into
`docs/schema-design-2.md` at integration, alongside **F104** above:

> **F100** — `organizations.platform_status` is already readable on the
> tenant connection (`relrowsecurity = f`, `presby_app` holds table-level
> `SELECT`, no column-level ACL). `presby_match_organization()`'s "never
> return `platform_status`" rule is a surface rule, not a leak closure. Do
> not widen; do not attempt to close it here.
>
> **F101** — F37's literal index `(lower(name), lower(city))` cannot serve a
> matcher that normalizes whitespace and punctuation; superseded by generated
> `name_normalized`/`city_normalized` stored columns computed by one shared
> immutable helper, `presby_normalize_org_match_text()`.
>
> **F102** — `import_rows.resulting_return_id` and
> `statistical_returns.staging_row_id` are two different facts, not a
> redundant pair; `duplicate` is what distinguishes them. Keep both, comment
> both, never assert agreement.
>
> **F103** — a unique/EXCLUDE constraint on a FORCE-RLS table is an
> enumeration oracle exactly when its key is learnable from public data.
> `organization_name_history` keys on public `subject_org_id` (function-
> mediated); `import_rows` keys on a random batch uuid (ordinary tenant DML).
> Neither ruling generalizes to "all new tenant tables."
>
> **F104 (new, tech-lead Phase 3)** — `import_rows.resulting_return_id` is a
> plain FK to `statistical_returns(id)`, deliberately not composite, under
> the §17 structural exception: a `duplicate` disposition may legitimately
> point at a `submitted` return owned by the congregation rather than the
> importing presbytery, and a composite FK pinned to `import_rows.
> organization_id` would refuse exactly the row D13's deduplication exists to
> record. Contrast with `statistical_returns.staging_row_id`'s composite FK
> (Ruling 6), which is correct precisely because that relationship's two
> sides always share one tenant.

**DECISION-153**, adopted verbatim from Phase 2 (full text in this work-log's
Phase 2 section, "Proposed DECISION-153") — the one-test rule
(`organization_name_history` function-mediated / import staging ordinary
tenant DML, on F103's learnable-key test), the invoker-over-view matcher
shape, the rename-closes-canonical rule, the composite `staging_row_id` FK,
and `presby_import_return()`'s specified-not-built status.

## Implementer

**database-admin.** Schema, DDL, RLS, grants, triggers, the matcher and its
helper function, the TypeScript domain-model additions, the
`check-schema-parity` allowlist row, and the DB-backed regression tests for
the two freeze triggers and the matcher's ranking/empty-input behavior. No
route, no action, no component — nothing in this increment calls for
api-developer, ux-developer, or full-stack-developer.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Done | Design complete — implementer named (database-admin) | 2026-09-26 |

**Handoff:** to **database-admin** (Phase 4), on this worktree
(`presby-wt-nh`) / branch (`pipeline/name-history`) / Neon branch
(`pipeline-name-history`) only. Build `drizzle/0053_presby_name_history_
import_staging.sql` exactly per the Data Model section above — the migration
section order (1–10) is the file's own outline. Two things most likely to be
rediscovered the hard way if not read carefully first: **Ruling 6.1's write
order and the `import_rows_freeze` trigger's two-path logic** (Path A resolves
without touching `resulting_return_id`; Path B stamps `resulting_return_id`
alone on an already-resolved row; nothing else is ever legal) — spelled out
verbatim in the Data Model section's trigger body, do not re-derive it — and
**F104's plain (non-composite) FK on `resulting_return_id`**, which is a
deliberate structural exception, not an inconsistency with Ruling 6's
composite `staging_row_id` FK one column over. Append the `index.ts` export
line, the `test-rls.sql` §42 section, and the `seed-dev.sql` fixture block
directly on this branch, each as one delimited block at its file's end, per
the kickoff's shared-file discipline — but leave `drizzle/meta/_journal.json`
to the orchestrator at integration (numbers `0051`/`0052` belong to other
in-flight pipelines). Write the failing-first regression tests named in
Implementation Order before declaring Phase 4 complete; QA's Phase 5 will
check for them by name.

---

# Phase 4 — Implementation

**Date:** 2026-09-26 · **Implementer:** database-admin
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-nh` · **Branch:** `pipeline/name-history`
**Neon branch:** `pipeline-name-history` (`br-shiny-cherry-ax6egkta` — confirmed live via
`select setting from pg_settings where name = 'neon.branch_id'`, not inferred from the host string)

## Files Created

- `drizzle/0053_presby_name_history_import_staging.sql` — the whole increment's DDL. Ten sections in
  Phase 3's own order: `btree_gist`, `presby_normalize_org_match_text()`, `organization_name_history`
  (+ CHECKs, the partial GiST EXCLUDE, two generated columns, three indexes, FORCE RLS,
  `tenant_isolation`, the grant narrowing, table/column comments), `organization_name_history_public`
  (+ both verbatim comments), the canonical backfill, `import_batches` (+ freeze trigger),
  `import_rows` (+ the two-path freeze trigger), the three additive `statistical_returns`
  constraints, `presby_match_organization()`, and the backfill-completeness assertion.
- `src/lib/db/domain/imports.ts` — `importBatches`, `importRows`, the `ResolutionKind` union, and a
  module header recording every mechanism Drizzle cannot express (the grants, both freeze triggers,
  the two permitted update paths, the set-once rule, and F104's FK reasoning).
- `src/lib/db/domain/imports.test.ts` — 28 owner-connection tests (`PLATFORM_DATABASE_URL`), the
  `lifecycle.test.ts` / `publication.test.ts` split. Everything runs inside a transaction that always
  rolls back, which matters more here than usual: an `import_rows` row committed by accident **could
  not be cleaned up**, because DELETE is refused on every connection.

## Files Modified

- `src/lib/db/domain/org.ts` — `organizationNameHistory` + the `NameType` union, placed beside
  `organizationIdentifiers` per Phase 2's placement ruling; and one paragraph added to
  `organizationIdentifiers`' header carrying the `legacy_import` / `legacy_import_name`
  cross-reference (Phase 1 Gap 5), so the warning sits forty lines from the thing it warns about.
- `src/lib/db/domain/returns.ts` — the `stagingRowId` docstring rewritten per Phase 3; the new
  `statistical_returns_id_about_year_key` unique declared (F104 addendum ruling 5 — `db:push`
  protection, not a parity requirement); and **`sourceRef`'s docstring corrected** — see Finding 1.
- `scripts/check-schema-parity.ts` — one `architectural` allowlist row. **The signature is
  `(organization_id,staging_row_id) -> import_rows(organization_id,id)`, not Phase 3's literal
  `(staging_row_id,organization_id) -> import_rows(id,organization_id)`**: `fkSignature()` sorts the
  pairs by local column name (`scripts/check-schema-parity.ts:182-192`), so Phase 3's text would
  never have matched. One row, not two — `import_rows.resulting_return_id` is declared in
  `imports.ts` and needs no exemption (addendum ruling 5).
- `scripts/seed-dev.sql` — one delimited block appended at the end of the existing transaction
  (the increment-6 precedent), with four parts: **(0)** a canonical baseline for the organizations
  this file itself creates (see Finding 2), **(1)** Bramblewood's 1988 rename as a closed
  predecessor + a narrowed open row, **(2)** Quillhaven's unbounded `former_name`, **(3)** one staged
  batch with one genuinely unresolved row. Invented names, invented city, invented column headers.
- `scripts/test-rls.sql` — §42 appended at the end (12 lettered blocks, **64 assertions**).
- `src/lib/dev-docs.ts` — three `MODULES` entries and three `BESPOKE_POLICIES` notes, so the new
  tables actually appear in `/developer` and the ERD. Without this they fell through to
  `"platform (from starter)"` and `npm run docs:erd` produced no mention of them at all, which is
  not what Phase 3's step 8 asks for. (`statistics_submission_grants` had the same gap from
  increment 6; it is registered here too, one line.)
- `docs/schema-design.md` — regenerated by `npm run docs:erd` (11 diagrams, 87 tables). The diff also
  carries unrelated pre-existing churn — FK-label ordering and two composite-FK labels from
  `drizzle/0050` — that had simply never been regenerated.

**Deliberately NOT modified** (Workflow Rule 16, per the orchestrator's instruction):
`src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `docs/TODO.md`, `docs/decisions.md`,
`docs/STATE.md`, `docs/schema-design-2.md`.

## Schema Changes

**Three new tables** — `organization_name_history` (in `org.ts`), `import_batches` and `import_rows`
(in the new `imports.ts`). All three: `unique (id, organization_id)`, `FORCE ROW LEVEL SECURITY`,
one `tenant_isolation` policy on `presby_current_org()`.

**One new view** — `organization_name_history_public` (nine columns; `organization_id`,
`minute_reference`, `notes`, `authority` and `recorded_by` absent and asserted absent).

**Two new functions, neither `SECURITY DEFINER`** — `presby_normalize_org_match_text(text)`
(IMMUTABLE) and `presby_match_organization(text, text, integer)` (STABLE, INVOKER). Plus four
trigger/deny helpers, also all invoker. §42(f) pins `prosecdef = false` on all six, so a future edit
that makes one DEFINER fails the suite and forces the `search_path` question to be asked.

**Three additive `statistical_returns` constraints** — `statistical_returns_staging_row_fk`
(composite), `statistical_returns_id_about_year_key` (the F104 target-side unique), and
`statistical_returns_import_provenance_shape` (narrowed — Finding 1).

**Backfill** — one open `canonical` row per organization existing at migration time (15 on this
branch), `authority = 'backfill'`, `organization_id = subject_org_id`, `city = null`.

**Migration mode: HAND-WRITTEN.** Not `db:push` (forbidden on this branch, and it emits none of RLS,
triggers, EXCLUDEs, views, generated columns backed by a user-defined function, or revokes) and not
`db:generate` (broken repo-wide since the `0009`–`0012` snapshot-chain collision).

**Local apply command:**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f drizzle/0053_presby_name_history_import_staging.sql
npm run db:seed                                                   # unchanged, run for recipe parity
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql
```

`-1` rather than an embedded `begin;`/`commit;`: no other hand-written presby migration carries them,
because `drizzle-kit migrate` sends a breakpoint-free file as one statement inside *its own*
transaction and an embedded `commit;` would close that out from under the runner. Phase 3's
one-transaction requirement (the section-9 assertion must be able to abort the whole file) is
supplied by the flag on the psql path and by the runner on the `db:migrate` path. This is not
theoretical — the very first apply attempt aborted on Finding 1's CHECK and left nothing behind.

**Whole-file idempotency, proven rather than asserted:** the complete file applied twice in
succession, `exit 0` both times, `NOTICE: name-history backfill complete: 15 organizations, 15 open
canonical rows, one each` both times, and row counts unchanged across the pair —
`organization_name_history` 15 → 15, `import_batches` 0 → 0, `import_rows` 0 → 0, `organizations`
15 → 15. Not a partial re-apply of the changed statements.

**`drizzle/meta/_journal.json`: NOT written** (orchestrator instruction; `0051`/`0052` belong to other
in-flight pipelines). The entry the orchestrator must add at integration, renumbered to whatever
`0053` actually lands as:

```json
{ "idx": 53, "version": "7", "when": <epoch-ms>, "tag": "0053_presby_name_history_import_staging", "breakpoints": true }
```

## Audit Events

**None, and that is correct rather than an omission.** This increment ships no route, no server
action and no `actions.ts` file, so `npm run check:audit` has nothing to scan and is *vacuously*
green — which is not evidence the obligation was met (Phase 2 Ruling 9). The audit obligation travels
with the deferred writers: the executor pipeline's Phase 4 mints `import.batch.create`,
`import.row.resolve` and `org.name.record`, and its Phase 5 must check them.

## Implementer Notes

### The F104 addendum, and where it overrides Phase 3

I built everything else first and wrote the `resulting_return_id` constraint last, as instructed. The
addendum arrived before that step and is implemented in full. **Where Phase 3's `import_rows` DDL
block (~line 878) and its F104 paragraph differ from the addendum, the addendum wins**, specifically:

- The FK is `(resulting_return_id, resolved_org_id, report_year) -> statistical_returns (id,
  about_org_id, report_year)`, **not** Phase 3's bare `references statistical_returns(id)`.
- `statistical_returns_id_about_year_key` is added additively and idempotently in 0053 §6a — *before*
  the `import_rows` FK, since the FK references it. Phase 3's section order put all
  `statistical_returns` changes in §7; §7's header now says why the unique moved and where it went.
- The `§17 structural exception` framing is gone from every comment about this column. §17 still
  correctly describes `resolved_org_id` and `subject_org_id` (plain refs to the non-RLS
  `organizations`), and those comments are unchanged.
- No CHECK, no trigger, no DEFINER helper for the column, and `presby_freeze_import_row()` never
  queries `statistical_returns` — the F26 trap is called out by name in the DDL comment so it is not
  re-introduced by reflex.
- Path B is unchanged. The FK fires on the same UPDATE and needs no new path.
- Both the FK and the unique are declared in TypeScript (`imports.ts` / `returns.ts`). **No new
  parity allowlist row beyond Ruling 6.2's.**
- §42(j) carries the assertion pair the addendum asked for, plus two more the argument implies.

The MATCH SIMPLE / shape-CHECK interaction is spelled out in three places (the DDL comment, the
column comment, the `imports.ts` docstring) because it is the part a later reviewer re-derives: the FK
is skipped when any of its three columns is null; `report_year` is always non-null; every branch
permitting a non-null pointer requires `resolved_org_id` non-null; `unresolved`/`rejected` force the
pointer null. So the FK is enforced **exactly** when the pointer exists, and weakening either
constraint re-opens the other's hole. §42(j)'s last two probes assert both directions of that.

### Finding 1 — Ruling 6.3's CHECK, as literally worded, cannot be applied to any database with history

**Proposed as a new finding (F105, subject to the orchestrator's numbering).**

Ruling 6.3 specified `check (provenance = 'imported' or (staging_row_id is null and source_ref is
null))`. The first apply of `0053` **aborted** on it:

```
ERROR:  check constraint "statistical_returns_import_provenance_shape" of relation
        "statistical_returns" is violated by some row
```

The offending row is `drizzle/0047:683-691`'s backfill product: a **`submitted`** return carrying
`source_ref = 'backfill: reconstructed from congregation_statistics <id> (drizzle/0047)'`. That value
is not incidental — `drizzle/0047:789-799` **matches on it** to repair the row idempotently. And the
row cannot be corrected even in principle: `statistical_returns_freeze` refuses UPDATE and DELETE on
every connection, owner included.

So `source_ref` is a **general free-text provenance note**, not a D13-only column. What made it look
like one is `returns.ts:210`'s one-line docstring, `/** D13 import provenance. */`, which I have
corrected in place with the 0047 evidence. The CHECK ships narrowed to
`check (provenance = 'imported' or staging_row_id is null)` — `staging_row_id` *is* D13-only, is the
column the composite FK pins, and has never been written on a submitted row.

Two things worth carrying forward from this:

1. **It would have passed on a genuinely from-empty database.** `0047`'s backfill has no
   `congregation_statistics` rows to reconstruct there, so the violating row never exists. The
   from-empty rehearsal DECISION-150 requires is necessary and **not sufficient**; this one was caught
   only because the first apply ran against a database with history.
2. `imports.test.ts` carries a named regression for it — *"still permits a submitted return carrying
   a source_ref — drizzle/0047's backfill writes one, and that row can never be edited"* — so a future
   tightening has to argue with a test rather than with a comment.

### Finding 2 — the backfill is a point-in-time act, and Ruling 7's invariant decays the moment it commits

**Proposed as a new finding (F106, subject to the orchestrator's numbering). Found by the from-empty
rehearsal and by nothing else.**

`0053`'s backfill covers every organization that exists **when the migration runs**. On the from-empty
recipe that is **zero** organizations: `db:migrate` → `0053` → `db:seed` → `seed-dev.sql`, and every
seeded congregation is created *after* the backfill. The measured first run produced a fixture
database in which `presby_match_organization()` could not find a single seeded church, Bramblewood
had a closed canonical row with no open successor, and §42's own coverage assertion failed.

The general form is not closable in this increment and must not be read as closed: **any organization
created after `0053` — by `createOrganization()`, by a test fixture, by a future
`presby_organize_congregation()` — arrives with no canonical row**, because Phase 2 Ruling 1
deliberately ships no writer. What I did, and deliberately did not do:

- **Did:** `scripts/seed-dev.sql` section (0) mints the canonical baseline for the organizations
  *that file* creates, byte-for-byte the migration's own backfill shape (self-attributed,
  `authority = 'backfill'`, `city` null, `where not exists`). The block says out loud that it covers
  the seed's own organizations and nothing else.
- **Did:** split the invariant into the two claims it actually is, in both `test-rls.sql` §42(k) and
  `imports.test.ts`. **Always true:** no organization carries more than one open canonical row — the
  EXCLUDE makes a second one unwritable, so a failure there means the EXCLUDE is gone. **Coverage,
  weaker and worded as weaker:** one open canonical row per organization *on a freshly seeded
  database*. The migration's own section-9 assertion is unchanged and stays the strong one, because
  at migration time the strong claim is true and is exactly what should block a commit.
- **Did NOT:** add an `AFTER INSERT` trigger on `organizations` minting the canonical row. It would
  keep the invariant true forever and is a faithful extension of the backfill's semantics — but it is
  a new write path on a table Phase 2 Ruling 1 explicitly reserved to a future
  `presby_record_org_name()`, and it interacts with `organizations_guard_insert`. That is a Phase 2/3
  call, not a Phase 4 one. **Recommended for the lifecycle-UI pipeline's scope**, alongside the
  writer it belongs with.

### Other decisions and small divergences

- **Drizzle's pg `generatedAlwaysAs()` takes no `{ mode: "stored" }`** (that is the MySQL signature);
  pg only supports stored, so the option is simply absent. Phase 3's snippet would not have compiled.
- **`presby_match_organization()`'s body aliases every intermediate column away from an OUT-parameter
  name** (`row_name`, `row_city`, `row_rank`, …). In a SQL-language function the declared return
  columns are visible as identifiers, so an unqualified `city` or `rank` is ambiguous. The return
  column list itself is exactly Phase 3's thirteen, in order.
- **The year band uses `CASE`, not `OR`**, so `make_date()` is never evaluated on an out-of-range
  `p_year` arriving from a spreadsheet cell (`p_year < 1 or p_year > 9998` folds into "no year
  constraint"). Phase 3's `OR` form would raise on a junk year — precisely the batch-killing behaviour
  Ruling 4 forbids one line above.
- Added three CHECKs Phase 3 did not name, all cheap and all in the file's existing idiom:
  `import_batches_column_map_shape`, `import_rows_raw_payload_shape`, `import_rows_candidates_shape`
  (`jsonb_typeof(...) = 'object'` / `'array'`). `candidates` defaults to `'[]'` and the shape CHECK is
  what keeps that meaningful.
- Added `organization_name_history_org_idx` on the policy's own predicate column, and
  `import_batches_org_idx`.
- The `legacy_import` cross-reference comment is on **both** tables, as Gap 5 asked: a
  `comment on column organization_identifiers.kind` is issued from `0053` (additive and idempotent —
  `drizzle/0043` itself is untouched), and the matching paragraph is in `org.ts`.

### Failing-first evidence

Every mechanism was proven **failing-first**: the mechanism removed, the probe re-run, the specific
failure observed, the mechanism restored, the probe green again. Scripts are in the session
scratchpad; outputs reproduced here.

| Mechanism | Without it | With it |
|---|---|---|
| `organization_name_history_canonical_no_overlap` | constraint dropped in a rolled-back tx → the overlapping canonical **inserted**, `open_canonical_rows_for_alder = 2` | `exclusion_violation`. **Positive control:** a `former_name` over the *same* interval for the *same* subject is accepted, so the partial `WHERE` is doing the work and not an accidental table-wide uniqueness |
| `organization_name_history_minute_shape` | CHECK dropped → a `recorded` `former_name` with no minute **went in** | `check_violation`; `authority = 'backfill'` accepted; `legacy_import_name` with no minute accepted |
| `import_rows_freeze` (DELETE, **owner** connection) | trigger dropped → `DELETE 1`, `rows_left = 0`. The revoke did not stop it — F44 made concrete | `insufficient_privilege` |
| `import_rows_freeze` (frozen column) | trigger dropped → `raw_payload` **rewritten** | `insufficient_privilege` |
| `import_batches_freeze` | same, for `source` and DELETE | `insufficient_privilege` on both |
| the matcher's empty-input contract | a validating plpgsql variant installed in a rolled-back tx → raised `presby_match_organization: a name is required`, i.e. one bad spreadsheet cell aborts the whole batch | `''`, `null` and `'   '` each return **0 rows, no exception** |
| the section-9 backfill assertion | EXCLUDE dropped + a second open canonical planted in a scratch tx → the `DO` block **raised**: `name-history backfill incomplete: 15 organizations but 16 open canonical rows`; rolled back | passes, `15 = 15` |
| the two freeze triggers, **through the vitest suite** | `alter table … disable trigger` on both, then `vitest run src/lib/db/domain/imports.test.ts` → **7 failed / 20 passed**, each failure naming its expected literal | triggers re-enabled (`tgenabled = 'O'` on both, verified) → **28 passed** |

### Verification run (in Phase 3's own order)

| Step | Result |
|---|---|
| `psql -1 -f drizzle/0053_…sql` (owner, direct endpoint) | exit 0; backfill notice `15 organizations, 15 open canonical rows, one each` |
| whole-file re-apply | exit 0, no errors, identical counts (idempotency proof above) |
| `npm run check:schema-parity` | `67 domain tables compared — 6 differences, 6 allowlisted (0 of them unclosed drift), 0 failing` (with the `index.ts` export line present) |
| `npm run db:seed` | `done.` |
| `psql -f scripts/seed-dev.sql` (fixture block) | applied, and re-applied as a no-op (`UPDATE 0`, `INSERT 0 0` ×3) |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` | **exit 0 — 584 assertions: 520 pre-existing + 64 in §42** |
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run test:db` (full suite, serial) | **288 files, 4176 tests, all passed** (4177 after the §42/backfill assertion split) |
| `npm run check` (all five tripwires) | all passed, including `check:secrets` over the new fixture |
| `npm run docs:erd` | `11 diagrams from 87 tables`; the three new tables now appear |

### From-empty rehearsal (DECISION-150's acceptance criterion)

A genuinely fresh database, `nh_from_empty`, created inside the **same** Neon branch. `presby_app`
reached it by swapping the database name in the existing URL — **no `ALTER ROLE presby_app …
PASSWORD` was run**, per the constraint; roles are cluster-wide, so the existing credential works.
Confirmed at the door: `presby_app | nh_from_empty | f`.

| Step | Result |
|---|---|
| `npm run db:migrate` | `migrations applied successfully`; `drizzle.__drizzle_migrations` = **51** rows, no hand intervention |
| `psql -1 -f drizzle/0053_…sql` | exit 0; `0 organizations, 0 open canonical rows` (correct — nothing exists yet) |
| `npm run check:schema-parity` | 67 tables, 6 allowlisted, **0 failing** |
| `npm run db:seed` → `seed-dev.sql` | `INSERT 0 10` canonical baseline, `UPDATE 1` Bramblewood narrowing, fixtures in |
| `install-test-helpers.sql` → `test-rls.sql` as `presby_app` | **exit 0 — 584 assertions (520 + 64)** |
| `npm run test:db` against it | **288 files, 4177 tests, all passed** |

The scratch database was dropped afterwards; `pg_database` on the branch is back to
`neondb / postgres / template0 / template1`. The committed `drizzle/meta/_journal.json` was never
touched — `0053` was applied by `psql` on both databases.

**Two defects were found only by this rehearsal, both now fixed:** Finding 2 above, and §42's
hard-coded `statistical_returns` uuid. The second is §35(c)'s lesson repeating: the Alder Creek 2025
return is `a8000000-…-0001` on a seeded database and whatever `drizzle/0047`'s backfill minted on a
migrated one. §42 now resolves it through `presby_list_published_returns_to_me()` into a
transaction-local GUC, which is both portable *and* the honest reachability story — that function is
how a presbytery legitimately comes to hold a congregation-owned return's id at all.

### What §42 proves, and what it deliberately cannot

64 assertions in twelve lettered blocks. Reachable from `presby_app` and proven there: the grant shape
on all three tables from both roles' side; FORCE RLS and the policy; the refused name-history INSERT
and the refused staging DELETEs; the view's exact column list and its non-`security_invoker` shape;
the matcher's return columns, volatility, bound, and the `prosecdef = false` pin across all six new
functions; **cross-tenant matching** (from Alder Creek's context the base table shows only Alder
Creek's own row and nothing about Bramblewood — and the matcher still finds Bramblewood's former
name, which is the one thing no unit test against a base table can show); all four ranking bands plus
the empty/null/whitespace contract; **both freeze-trigger UPDATE paths behaviourally** (Ruling 5 kept
tenant DML, so unlike §35's tables these are genuinely reachable here); the F104 FK's accept-and-refuse
pairs; and the backfill's two claims.

Not reachable from `presby_app`, and stated as such in §42's own header rather than left to be
noticed: the DELETE arm of both freeze triggers (the missing grant fires first), the name-history
EXCLUDE and CHECKs (SELECT-only), and everything on `statistical_returns` (SELECT-only).
`imports.test.ts` carries all of those on the owner connection, which is the connection they exist
for; §42(l) pins their catalog shape so a dropped trigger or constraint still fails this suite.

### Handoff

**Next agent: qa (Phase 5).** Nothing is committed.

**New tables and relationships available to the next implementer:**

- `organization_name_history` — `organizationId` (acting council, tenant scope, **may equal**
  `subjectOrgId`), `subjectOrgId`, `nameType` (`NameType` union), `name`, `city`, `state`, generated
  `nameNormalized`/`cityNormalized`, `effectiveFrom`/`effectiveTo` (null = unbounded), `authority`,
  `minuteReference`, `notes`, `recordedBy`, `recordedAt`. **Read-only from `presby_app`**; the only
  writer that exists is the migration backfill.
- `organization_name_history_public` — the nine-column cross-tenant projection. DDL-only, no Drizzle
  counterpart (matching `organization_affiliations_public`).
- `import_batches` → `import_rows` (composite `(batch_id, organization_id)`). Ordinary tenant DML
  minus DELETE; resolution is set-once via the two-path trigger.
- `import_rows.resultingReturnId` → `statistical_returns (id, about_org_id, report_year)`;
  `statistical_returns.stagingRowId` → `import_rows (id, organization_id)` (DDL-only). Two different
  facts, never asserted to agree.
- `presby_match_organization(p_name, p_city, p_year)` — execute granted to `presby_app` and
  `presby_platform`. Returns ≤20 candidate rows; `effectiveFrom`/`effectiveTo` come back from the Neon
  driver as **strings**, not `Date` (`check:sql-date` is dormant here and fires on the executor
  pipeline's first TypeScript caller).

**Local apply:** see "Schema Changes" above, plus `psql "$MIGRATE_DATABASE_URL" -f
scripts/install-test-helpers.sql` and `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` to verify.

**`test-rls.sql` sections:** §42 added (new, 64 assertions, appended at the end). No existing section
was edited.

**For the orchestrator, at integration (I did not write any of these):**

1. `src/lib/db/domain/index.ts` — append exactly this line at the end of the export list:

   ```ts
   export * from "./imports";
   ```

   I added it temporarily to run `npm run typecheck` and `npm run check:schema-parity` (which needs
   the export to see the two new tables at all) and **reverted it**; `git status` shows `index.ts`
   unmodified. Parity currently reports 65 tables without it and 67 with it, 0 failing either way.
2. `drizzle/meta/_journal.json` — the entry above, renumbered to whatever `0053` lands as.
3. `docs/schema-design-2.md` — F100–F103 as Phase 2 proposed; **F104 in the addendum's superseding
   text**, not Phase 3's; plus Findings 1 and 2 above as the next two numbers.
4. `docs/decisions.md` — DECISION-153, with ruling 2 of the addendum in place of "plain FK".
5. `docs/TODO.md` — Phase 3's three proposed lines, plus two from this phase:
   - *"An organization created after `drizzle/0053` gets no `canonical` name-history row — the
     backfill is a point-in-time act and this increment ships no writer (Finding 2). Decide in the
     lifecycle-UI pipeline whether `presby_record_org_name()` is accompanied by an `AFTER INSERT`
     trigger on `organizations`."*
   - *"Executor pipeline: `import_rows.resulting_return_id` may name a return the importing
     presbytery cannot `SELECT`. Resolve it through `presby_list_published_returns_to_me()`, never a
     direct join and never a DEFINER fetch by uuid (F104's accepted residual)."*

### Phase 4 loop-back (2026-09-26)

**Trigger:** Phase 5 FAIL — FAIL-1 (`drizzle/0053_…sql:436` / `:718`, the two deny helpers missing
their `grant execute`) and FAIL-2 (six §42 handlers that pass against a no-op guard). No design
change; Phase 3 was not reopened.

**Worktree / branch, re-confirmed at the top of this pass:** `/Users/cshenso/git/presby-platform/presby-wt-nh`
· `pipeline/name-history` · Neon branch **`br-shiny-cherry-ax6egkta`**, read from
`select setting from pg_settings where name = 'neon.branch_id'` on all three connections
(`MIGRATE_DATABASE_URL` → `neondb_owner`, `APP_DATABASE_URL` → `presby_app`,
`PLATFORM_DATABASE_URL` → `neondb_owner`), not inferred from the host string. `env | grep DATABASE_URL`
was empty before `.env.local` was sourced. No `ALTER ROLE`. No `db:push`. Nothing committed.

**Migration mode:** hand-written SQL, **corrected in place** — same file, same number
(`drizzle/0053_presby_name_history_import_staging.sql`), because 0053 is unreleased (it exists only
on this branch and is absent from `drizzle/meta/_journal.json`, which the orchestrator still owns).
Per Project Layout's `drizzle/` rule and the same practice 0046 §B used.

#### Files and lines changed in this pass

| File | Change |
|---|---|
| `drizzle/0053_presby_name_history_import_staging.sql:436-452` | B-M1 comment block + `grant execute on function presby_deny_import_batch_change() to presby_app, presby_platform;` immediately after the existing `revoke all … from public` |
| `drizzle/0053_presby_name_history_import_staging.sql:734-750` | the same pair for `presby_deny_import_row_change()` |
| `scripts/test-rls.sql:6903-6912` (§42(i) header) and `:7007` (§42(i2) header) | why the six refusals pin the message and not just the SQLSTATE, and why (d) deliberately does not |
| `scripts/test-rls.sql:6933`, `:6948`, `:6964`, `:6996`, `:7058`, `:7073` | a six-line `if sqlerrm not like 'import_rows: %' then raise exception 'FAIL — …' end if;` guard inserted at the head of each of the six `exception when insufficient_privilege` handlers QA named (those handlers were at `:6921`, `:6930`, `:6940`, `:6966`, `:7021`, `:7030` before this pass; they are now at `:6932`, `:6947`, `:6963`, `:6995`, `:7057`, `:7072`) |
| `src/lib/db/domain/imports.test.ts:163-198` | one new owner-connection regression test pinning the EXECUTE grant itself, for **both** helpers (see "the batch-side residual" below) |

The `scripts/test-rls.sql` edits are entirely inside this pipeline's own appended §42 block:
`git diff 82d6b54 -- scripts/test-rls.sql` is still **one hunk, `@@ -6587,3 +6587,719 @@`, zero
removed lines**. `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `docs/TODO.md`,
`docs/decisions.md`, `docs/STATE.md`, `docs/schema-design-2.md`: untouched (`git status --porcelain`
over the six is empty). No file was added or removed relative to the Phase 4 handoff state.

#### Fix 1 — the grants, and the pre-fix state on the wire

Pre-fix catalog (`select proname, array_to_string(proacl,',') from pg_proc …`):

```
presby_deny_import_batch_change|neondb_owner=X/neondb_owner
presby_deny_import_row_change  |neondb_owner=X/neondb_owner
presby_deny_publication_write  |neondb_owner=X/…,presby_app=X/…,presby_platform=X/…   <- 0046's B-M1
```

Pre-fix, on the **tenant** connection (`$APP_DATABASE_URL`, `presby_app`, in a rolled-back
transaction with `app.current_org_id` set to the Northern Reach):

```
NOTICE:  PRE-FIX import_rows     sqlstate=42501  sqlerrm=permission denied for function presby_deny_import_row_change
NOTICE:  PRE-FIX import_batches  sqlstate=42501  sqlerrm=permission denied for function presby_deny_import_batch_change
```

Post-fix, identical probe, same connection:

```
NOTICE:  POST-FIX import_rows     sqlstate=42501  sqlerrm=import_rows: this change is not permitted
NOTICE:  POST-FIX import_batches  sqlstate=42501  sqlerrm=import_batches: this change is not permitted
```

Both helpers now read `…,presby_app=X/neondb_owner,presby_platform=X/neondb_owner`.

**Idempotent whole-file re-apply, proved not asserted.** The *entire* file was applied twice in
succession against the branch DB (`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f
drizzle/0053_presby_name_history_import_staging.sql`): **exit 0 both times**, zero `ERROR` lines in
either log, the only notices being nine `relation … already exists, skipping`, one `extension …
already exists, skipping`, and the backfill's own `NOTICE: name-history backfill complete: 15
organizations, 15 open canonical rows, one each` on both runs. Row counts before, between and after
were identical: `onh=17 batches=1 rows=1 orgs=15 sr=1`. (A third and fourth whole-file apply
followed later in this pass, as the restore step of the failing-first work — same result.)

#### Fix 2 — failing-first, recorded

The suite aborts at its first failure (`\set ON_ERROR_STOP on`), which would hide five of the six.
For the failing-first runs only, a scratch copy of the suite was used with that one line changed to
`\set ON_ERROR_STOP off` + `\set ON_ERROR_ROLLBACK on` (psql's per-statement implicit savepoint), so
every assertion runs and each failure is attributable. The assertions themselves are byte-identical
to the committed file. Baseline on that copy, healthy DB: **584 passes, 0 errors, exit 0** — the
harness is faithful.

**(A) The exact FAIL-1 regression — grant revoked, guard body intact.**
`revoke execute on function presby_deny_import_row_change() from presby_app, presby_platform;`

- With the **pre-fix** §42 handlers (a scratch copy of the current file with the six new guards
  stripped): **584 passes, exit 0.** This is FAIL-2 stated as a measurement — the old assertions are
  green against the defect they were labelled as proving.
- With the **shipped** §42 handlers, same database state: **578 passes**, and exactly six failures,
  all six of QA's sites, each reading

  ```
  ERROR:  FAIL — refused, but NOT by presby_freeze_import_row's own literal
          (got: permission denied for function presby_deny_import_row_change).
          presby_deny_import_row_change() has lost its EXECUTE grant — see
          drizzle/0053_presby_name_history_import_staging.sql B-M1.
  ```

  The canonical suite (unmodified `scripts/test-rls.sql`, `ON_ERROR_STOP=1`) in the same state:
  **exit 3**, aborting at `scripts/test-rls.sql:6940`.

**(B) The instructed probe — guard body gutted to a no-op, grant present.**
`create or replace function presby_deny_import_row_change() … begin return; end` (+ grant).
**578 passes** — none of the six report `pass`:

| Site (shipped file) | Failure |
|---|---|
| `:6940` raw_payload | `ERROR: FAIL — a frozen column was rewritten from the tenant connection` |
| `:6955` candidates | `ERROR: FAIL — the candidates snapshot was rewritten` |
| `:6971` Path-B on unresolved | `ERROR: new row … violates check constraint "import_rows_resolution_shape"` (escapes the `insufficient_privilege` handler entirely → abort) |
| `:7003` report_year | `ERROR: FAIL — report_year was changed after insert` |
| `:7065` second stamp | `ERROR: … violates foreign key constraint "import_rows_resulting_return_fk"` (same — escapes the handler) |
| `:7080` rationale | `ERROR: FAIL — a resolved row's rationale was edited` |

Counted mechanically across the three runs, the six target `pass` strings appear **6 / 0 / 0** times
(baseline / A / B).

**Restore.** The real body and both grants were restored by re-applying the whole migration file
(exit 0), catalog re-checked (`md5(prosrc)` + `proacl` on both helpers), and the canonical suite
re-run as `presby_app`: **584 passes, exit 0.**

#### The batch-side residual, and why one test was added beyond the two fixes

QA's six sites are all `import_rows`. §42 has **no** tenant-connection freeze assertion for
`import_batches` at all — (d) is a grant-layer DELETE refusal by design — so strengthening the six
leaves `presby_deny_import_batch_change()`'s grant with no automated guard of any kind. Rather than
add a seventh §42 assertion (which would move the suite's count off 584 and off QA's re-verification
baseline), the grant is pinned where it costs nothing: one owner-connection catalog test in
`imports.test.ts` asserting EXECUTE for `presby_app` **and** `presby_platform` on **both** helpers.
No design change, no new mechanism.

Failing-first for it, recorded: with
`revoke execute on function presby_deny_import_batch_change() from presby_app, presby_platform;`
the test fails at `src/lib/db/domain/imports.test.ts:192` with the two `presby_deny_import_batch_change/*`
entries missing from `Received`; grant restored → 29/29 pass.

#### Verification run

| Command | Result |
|---|---|
| `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0053_presby_name_history_import_staging.sql` ×2 | exit 0, exit 0; no ERROR; row counts unchanged |
| `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` | **exit 0, 584 passes** |
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npm run check` (five tripwires) | pass |
| `npm run test:db -- src/lib/db/domain/imports.test.ts` | **29 passed** (28 + the new grant regression) |
| `npm run test:db` (full, serial) | **288 files, 4178 passed, 0 failed** (4177 + the new one), 397 s |

#### From-empty rehearsal, re-run on the corrected file (DECISION-150)

Scratch database `nh_fix_fresh` created inside the same Neon branch (`create database`; branch id
re-confirmed as `br-shiny-cherry-ax6egkta` from inside it; `presby_app` reached it by database-name
swap, **no `ALTER ROLE`**).

| Step | Result |
|---|---|
| `npm run db:migrate` (committed journal, 51 entries) | applied; `drizzle.__drizzle_migrations` = 51; 84 public tables |
| `psql -f drizzle/0053_…sql` | exit 0; `NOTICE: name-history backfill complete: 0 organizations, 0 open canonical rows, one each`; 87 tables |
| whole-file re-apply (2nd) | exit 0, no ERROR, identical notices |
| both deny helpers' `proacl` on the from-empty DB | `presby_app=X`, `presby_platform=X` present — the grant ships in the file, not just on the mutated branch DB |
| `npm run db:seed` → `scripts/seed-dev.sql` | exit 0; **orgs=10, open_canonical=10, nh_total=12, batches=1, rows=1** — identical to QA's first-pass rehearsal |
| `install-test-helpers.sql` → `test-rls.sql` as `presby_app` | **exit 0, 584 passes** |
| tenant-path literal probe on the from-empty DB | `import_rows: this change is not permitted` / `import_batches: this change is not permitted`, both 42501 |
| `drop database nh_fix_fresh` | dropped; `pg_database` back to `neondb, postgres, template0, template1` |

#### Handoff (loop-back)

**Next agent: qa (Phase 5, second pass).** Nothing is committed. Nothing in the design, the API
contract, the table shapes, the grants on the tables, the triggers, or the seed fixture changed —
only the two function-level `grant execute` statements, six test handlers, their two header
comments, and one added test.

- **Local apply:** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f
  drizzle/0053_presby_name_history_import_staging.sql` (idempotent; safe to re-run on a branch that
  already has the pre-fix 0053 — the two `grant execute`s are the only new effect). Seeds unchanged,
  so `npm run db:seed` / `scripts/seed-dev.sql` are only needed on a from-empty database.
- **`test-rls.sql` sections touched:** §42 only — headers (i)/(i2) and the six handlers inside it.
  No new assertion, so the expected count is still **584**.
- **Suggested re-verification:** the owner/tenant refusal-message pair on both tables;
  `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (584, exit 0); `npm run test:db` (**4178** now,
  not 4177); and, if you want the regression re-proved independently,
  `revoke execute on function presby_deny_import_row_change() from presby_app, presby_platform;` →
  suite exits 3 at `:6940` → re-apply the migration file to restore.
- **Unchanged from the first pass, still the orchestrator's at integration:** the `index.ts` export
  line, the `_journal.json` entry, F100–F104 + the two Phase 4 findings in `docs/schema-design-2.md`,
  DECISION-153, and the `docs/TODO.md` lines.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-nh` · branch `pipeline/name-history`
**Neon branch:** `br-shiny-cherry-ax6egkta` — confirmed on all three connections via `select setting from pg_settings where name='neon.branch_id'`, not inferred from the host string. `env | grep DATABASE_URL` was empty before any connection was opened. No `ALTER ROLE`, no `db:push`.

**A note on method, since this role may not write files.** Three checks (`check:schema-parity`, `typecheck`, `docs:erd`) need the `src/lib/db/domain/index.ts` export line the implementer deliberately reverted. Rather than add and revert it in the reviewed worktree, I ran those three against a tar copy of the worktree in the session scratchpad (`node_modules` symlinked, the export line appended **there**). `git status --porcelain` on the reviewed worktree is byte-identical to the implementer's handoff state at every point in this phase, and `docs/schema-design.md` was never written by me.

## Type Check

`npm run typecheck`: **PASS** (committed state, exit 0). Also PASS in the scratch copy with `export * from "./imports";` present.
`npm run lint` (`--max-warnings=0`): **PASS**.
`npm run check` (all five tripwires — audit, sql-date, deps-drift, brand-scope, secrets): **PASS**, including `check:secrets` over the new seed fixture.

## Unit Tests

`npm run test:db` (serial, `--no-file-parallelism`, branch DB): **288 files, 4177 tests, 4177 passed, 0 failed, 0 skipped.** 375s. Matches the Phase 4 expectation exactly.

`src/lib/db/domain/imports.test.ts` alone: **28 passed, 0 skipped**, 4.7s. The file is gated `describe.skipIf(!hasDb)` (`imports.test.ts:70`) — it genuinely executed here; it will skip in CI until the Neon secrets exist, which is the pre-existing tracked condition, not this pipeline's.

`scripts/test-rls.sql` as `presby_app`, branch DB: **exit 0, 584 assertions** (520 pre-existing + 64 in §42).

## End-to-End Tests

**Not applicable, and not deferred.** The diff touches no route, no server action, no `src/app/` file, no component — confirmed by `git diff --name-only 82d6b54` plus the untracked list. No auth file (`src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`) appears in the diff, so the stricter auth gate does not engage.

## Schema/RLS Audit (live catalog, branch `br-shiny-cherry-ax6egkta`)

Verified against `pg_class`, `pg_policies`, `aclexplode(relacl)`, `aclexplode(proacl)`, `pg_constraint`, `pg_proc`, `pg_trigger`, `pg_attribute` — not `information_schema`, not the Drizzle files.

| Claim | Live result |
|---|---|
| Three tables `FORCE ROW LEVEL SECURITY` + one `tenant_isolation` policy each | `relforcerowsecurity = t` ×3; policy `ALL`, qual and with_check both `organization_id = presby_current_org()` ✓ |
| `organization_name_history` grants | `presby_app` = SELECT only; `presby_platform` = INSERT,SELECT ✓ |
| `organization_name_history_public` | exactly the nine ruled columns; `organization_id`, `minute_reference`, `notes`, `authority`, `recorded_by` **absent**; grants to `presby_app` + `presby_platform`; owner `neondb_owner`, `rolbypassrls = t`; `reloptions` null → **not** `security_invoker` ✓ |
| Partial GiST EXCLUDE | `EXCLUDE USING gist (subject_org_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (name_type = 'canonical')` ✓ |
| Generated columns | `name_normalized`/`city_normalized`, `attgenerated = 's'` (stored), expression `presby_normalize_org_match_text(...)` ✓ |
| Indexes | btree `(name_normalized, city_normalized)` and `(subject_org_id, name_type, effective_from)` ✓ |
| Minute CHECK + length CHECKs; **no `not_self` CHECK** | all present; no `organization_id <> subject_org_id` constraint exists ✓ |
| `import_batches`/`import_rows` grants | `presby_app` = INSERT,SELECT,UPDATE, **no DELETE**; `presby_platform` = SELECT ✓ |
| `resolution_kind` | `text` + CHECK with exactly the six values, `default 'unresolved'` ✓ |
| Shape CHECK; **no unique on `resolved_org_id`**; `unique (batch_id, row_index)`; `unique (id, organization_id)` ×3 | all confirmed ✓ |
| Freeze triggers | both `BEFORE DELETE OR UPDATE FOR EACH ROW`, `tgenabled = 'O'`; both fire on the owner connection (proved behaviourally below) ✓ |
| `statistical_returns` additions | `statistical_returns_staging_row_fk` = `(staging_row_id, organization_id) -> import_rows(id, organization_id)`; `statistical_returns_id_about_year_key` = `UNIQUE (id, about_org_id, report_year)`; narrowed `statistical_returns_import_provenance_shape` = `CHECK (provenance = 'imported' OR staging_row_id IS NULL)` ✓ |
| **F104 FK** | `FOREIGN KEY (resulting_return_id, resolved_org_id, report_year) REFERENCES statistical_returns(id, about_org_id, report_year)` — not `(id, organization_id)`, not plain ✓ |
| `prosecdef = false` on every 0053 function | all six (`presby_normalize_org_match_text`, `presby_match_organization`, the two freeze functions, the two deny helpers) ✓ |
| Matcher | `provolatile = 's'` (STABLE), `prosecdef = f`, `proconfig = {search_path=public, pg_temp}`, EXECUTE to `presby_app` + `presby_platform`; return columns are exactly Ruling 4's thirteen in order, and **no** `platform_status`, `slug`, `deletable_until`, `status` ✓ |

### Failing-first / behavioural probes, reproduced by me

All in rollback transactions on the branch DB, or on a scratch database inside the branch (created, used, dropped — `pg_database` verified back to `neondb, postgres, template0, template1`).

| Probe | Result | Which layer actually refused |
|---|---|---|
| Overlapping canonical for one subject | `exclusion_violation` | the partial EXCLUDE |
| `former_name` over the *same* subject and interval | **accepted** | — (positive control: the partial `WHERE` is doing the work, not table-wide uniqueness) |
| `canonical`/`former_name`, `authority='recorded'`, null minute | `check_violation` on `..._minute_shape` | the CHECK |
| Same row with `authority='backfill'`; and `legacy_import_name` with no minute | both **accepted** | — |
| `DELETE FROM import_rows` / `import_batches` as **owner** | `ERROR: import_rows/import_batches: this change is not permitted`, SQLSTATE **42501** | the freeze trigger body (grant does not bind `neondb_owner`, F44) |
| `UPDATE` of `raw_payload` / `source` as owner | same literal | the freeze trigger body |
| Path-B stamp on a **still-unresolved** row | refused | `presby_freeze_import_row` line 44 |
| Path A resolve → Path B stamp (NR-owned row → Alder-Creek-owned `submitted` return) | **both accepted** | — (this is F104 case (b); `(id, organization_id)` would have refused it) |
| Second stamp on the same row | refused | `presby_freeze_import_row` line 35 |
| F104 refuse — mismatched `about_org_id` | `foreign_key_violation` on `import_rows_resulting_return_fk` | the FK |
| F104 refuse — mismatched `report_year` | `foreign_key_violation` on the same FK | the FK |
| Narrowed provenance CHECK — `submitted` + `staging_row_id` | `check_violation` | the CHECK — **but only once `presby.publication_write_active` is set to `'true'`**; without it `presby_guard_publication_write` refuses first on every connection, owner included |
| **Finding 1 regression** — `submitted` + `source_ref`, no `staging_row_id` | **accepted** | — (the `drizzle/0047` backfill row stays writable; the un-narrowed CHECK would have been unappliable) |
| Composite staging FK, isolated (about-org check passing, staging row owned by a different org) | `foreign_key_violation` on `statistical_returns_staging_row_fk` | **the FK**, isolated — my first attempt was refused by `presby_check_return_about_org` instead, so I re-shaped the probe until the FK was demonstrably the refusing layer |
| Matcher on `''`, `null`, `'   '` | 0 rows each, no exception | — |
| Matcher with junk year `99999` | 1 row, no exception | the `CASE` year band (Phase 3's `OR` form would have raised) |
| **Cross-tenant visibility** from Alder Creek's context as `presby_app` | base table `organization_name_history` = **1 row** (its own); `organization_name_history_public` = **17 rows**; matcher returns Bramblewood's closed canonical and Quillhaven's `former_name` | RLS filters the base table; the view's `BYPASSRLS` owner is what crosses the boundary |
| Matcher ranking | rank 1 `exact` / 2 `high` / 3 `medium` / 4 `low` across the four Ruling-4 band combinations; `'  mill   creek   presbyterian   church.  '` → rank 1 (normalization parity with the generated column); `limit 20` present | — |
| **Backfill assertion** — EXCLUDE dropped, second open canonical planted, §9 `DO` block re-run | `ERROR: name-history backfill incomplete: 15 organizations but 16 open canonical rows`; baseline run gives the completeness NOTICE | the assertion |
| **Phase 4 failing-first, re-run by me:** deny-helper body gutted to a no-op on the **owner** path, then `UPDATE raw_payload` | **the frozen column was rewritten** | confirms the trigger body — not a grant — is what guards the owner path |

### Enumeration safety (F103 test) — every unique/EXCLUDE on the three tables

| Constraint | Key | Publicly learnable? | `presby_app` DML? | Verdict |
|---|---|---|---|---|
| `organization_name_history_pkey` / `_id_org_key` | `id` (`gen_random_uuid()`) | no | no (SELECT only) | safe |
| `organization_name_history_canonical_no_overlap` | **`subject_org_id`** (public org tree) + daterange | **yes** | **no — revoked** | safe *because* DML is revoked; F103 honoured exactly as ruled |
| `import_batches_pkey` / `_id_org_key` | `id` (random uuid) | no | yes | safe |
| `import_rows_pkey` / `_id_org_key` | `id` (random uuid) | no | yes | safe |
| `import_rows_batch_row_key` | `batch_id` (random uuid) + `row_index` | no; and the composite `(batch_id, organization_id) -> import_batches` FK plus the policy's `WITH CHECK` confine `batch_id` to the prober's own org | yes | safe |
| `statistical_returns_id_about_year_key` | `id` is the PK, so a collision implies a PK collision already reported | no | no INSERT on the table | safe |

One DML-reachable constraint keys into a FORCE-RLS table: `import_rows_resulting_return_fk`, reachable from `presby_app` via the Path-A/Path-B updates. Its key includes `resulting_return_id`, a `gen_random_uuid()` on no public surface, so it is not an *enumeration* oracle; it does confirm the about-org and year of a return uuid the caller already holds. That is precisely the residual the Phase 2 addendum named ("the control point is the read"), and it is already queued as a `docs/TODO.md` line for the executor pipeline. **Nothing in 0053 gives `presby_app` a constraint keyed on a publicly learnable id with DML.**

### From-empty rehearsal (DECISION-150), on scratch DB `nh_qa_fresh` inside the branch

| Step | Result |
|---|---|
| `create database nh_qa_fresh` | same branch id, 0 public tables at the door; `presby_app` reached it by database-name swap, **no `ALTER ROLE`** |
| `npm run db:migrate` (committed journal, 51 entries, last `0050_presby_schema_parity`) | applied successfully; `drizzle.__drizzle_migrations` = 51 |
| `psql -1 -f drizzle/0053_…sql` | exit 0; `NOTICE: name-history backfill complete: 0 organizations, 0 open canonical rows, one each` |
| whole-file re-apply | exit 0, idempotent (only `already exists, skipping` notices) |
| `check:schema-parity` (export line present in the scratch copy) | **67 tables, 6 differences, 6 allowlisted, 0 failing** |
| `npm run db:seed` → `seed-dev.sql` | applied; **orgs=10, open_canonical=10, nh_total=12, batches=1, rows=1** — Finding 2's section (0) baseline demonstrably working |
| `install-test-helpers.sql` → `test-rls.sql` as `presby_app` | **exit 0, 584 assertions** |
| `drop database nh_qa_fresh` | dropped; `pg_database` back to the four baseline entries |
| committed `drizzle/meta/_journal.json` | untouched throughout (`git status --porcelain` empty for it) |

Branch DB parity, committed state: **65 tables, 6 allowlisted, 0 failing**. With the export line (scratch copy): **67, 0 failing**. `npm run docs:erd` in the scratch copy: `11 diagrams from 87 tables`, output byte-identical to the checked-in `docs/schema-design.md` — idempotent, no further diff.

### Shared-file discipline

`drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/schema-design-2.md`: **all untouched vs `82d6b54`.** `git status` shows `index.ts` unmodified, confirming the implementer reverted their temporary export line.

`git diff 82d6b54 -- scripts/test-rls.sql scripts/seed-dev.sql`: **one hunk each, both at EOF, zero removed lines** (`@@ -6587,3 +6587,671 @@` and `@@ -1612,4 +1612,148 @@`). Pure appends; **no in-place hunk**.

`scripts/check-schema-parity.ts`: exactly one new `ALLOWLIST` row, `category: "architectural"`. Its signature is `(organization_id,staging_row_id) -> import_rows(organization_id,id)` rather than Phase 3's literal text — the implementer's correction is right and I confirmed it empirically: the comparator emitted that exact sorted string and matched the row.

`src/lib/dev-docs.ts`: three new `MODULES` entries (`organization_name_history` → "A. Organizations"; `import_batches`/`import_rows` → new "L. Import staging") plus three `BESPOKE_POLICIES` notes. A fourth `MODULES` line registers `statistics_submission_grants` — an increment-6 gap-fill, disclosed in Phase 4's notes; out of scope but one line and harmless.

`src/lib/db/domain/returns.ts`: the `sourceRef` docstring correction is present and carries the `drizzle/0047:683-691` / `:789-799` evidence; `stagingRowId`'s docstring rewritten per Phase 3; `statistical_returns_id_about_year_key` declared.

### No Real Data

Read the `scripts/seed-dev.sql` appended block (`:1613-1760`) and the §42 fixture strings in full. Names (Mill Creek, Bramblewood, Quillhaven, Quill Run, Mount Amity Chapel, Probe Chapel, Probe Presbyterian Church), cities (Cranesport, Quillhaven, Unincorporated, Nowhere Junction, Anywhere At All), the invented column-header set (`Congregation Name` / `City` / `Active Members`), the figure (`41`), and the minute references are all invented in the existing house style. No emails in the block. No plausible real congregation or presbytery name, no real spreadsheet header set. **Pass.** (Carried forward, not this pipeline's: the live dev DB contains a `First Presbyterian Church of Westerville` organization — it is absent from `seed-dev.sql` at `82d6b54` and absent from this diff, so the backfill's canonical row for it is a runtime artifact of a pre-existing row, already tracked.)

## Regression Tests Added

Written by the implementer; verified present, executing, and asserting the right thing:

- `src/lib/db/domain/imports.test.ts:687` — *"still permits a submitted return carrying a source_ref — drizzle/0047's backfill writes one, and that row can never be edited"* — guards Finding 1. I re-proved it independently against the live catalog.
- `imports.test.ts:163,186,199,222,257` — freeze-trigger DELETE/UPDATE refusals on the owner path, asserting the **exact literals** `/import_rows: this change is not permitted/` and `/import_batches: this change is not permitted/`. These are the assertions that genuinely pin the trigger body.
- `imports.test.ts:302,336,359` — the two permitted update paths and set-once.
- `imports.test.ts:379,397,415,438,475` — the EXCLUDE, its partial-`WHERE` positive control, adjacency, the minute CHECK, and the empty-range loophole.
- `imports.test.ts:503,528,549,568` — Finding 2's honest invariant split (always-true vs coverage-on-a-seeded-DB) and F101's generated-column parity.
- `imports.test.ts:615,635,655` — the composite staging FK both directions and the narrowed CHECK.
- `imports.test.ts:711,723,739,751,764,781` — the matcher's empty-input contract, year-ranks-not-filters, normalization parity, the never-returned columns, and cross-council visibility.
- `scripts/test-rls.sql` §42 — 64 assertions in twelve lettered blocks.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: untouched by this diff — no change to coverage.
- `src/lib/two-factor.ts`: untouched.
- `src/lib/flags.ts`: untouched.

`git diff --name-only 82d6b54` confirms none of the three appears. No coverage run was performed against them; this pipeline is DDL plus two domain modules, and its coverage story is the schema-mechanism table above.

## Feature-Gate Audit

**No protected routes touched.** The diff adds and modifies no `src/app/**/route.ts`, no `"use server"` action, no `src/app/` file of any kind (verified by `git diff --name-only 82d6b54` plus the untracked list, and by grepping the four changed/new TS files for `"use server"` — none). `npm run check:audit` is vacuously green, which is not evidence the audit obligation was met — it travels with the deferred writers, as Phase 2 Ruling 9 and Phase 4 both state.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| *(none — no route or action in this diff)* | n/a | n/a | n/a |

## Findings

### FAIL-1 — the two deny helpers are missing their `grant execute`, so on the tenant connection the freeze triggers are enforced by a function ACL rather than by their own guard logic

`drizzle/0053_presby_name_history_import_staging.sql:436` and `:718` each do `revoke all on function presby_deny_…_change() from public;` and **stop there**. Neither grants EXECUTE to `presby_app`.

`presby_freeze_import_row()` / `presby_freeze_import_batch()` are SECURITY INVOKER and, uniquely among 0053's triggers, **reachable from `presby_app`** — that is the entire point of Ruling 5's "ordinary tenant DML minus DELETE." So when a tenant-connection UPDATE trips the freeze, the inner `perform presby_deny_import_row_change()` is evaluated with the caller's own privileges and fails the permission check before the body runs:

```
ERROR:  permission denied for function presby_deny_import_row_change
```

instead of the designed single literal `import_rows: this change is not permitted`.

**Proved on a scratch database, four steps:**

1. As `presby_app`, `UPDATE import_rows SET raw_payload = …` → `permission denied for function presby_deny_import_row_change`.
2. Committed a **no-op body** for `presby_deny_import_row_change()`. Same UPDATE as `presby_app` → **still** `permission denied for function …`. The guard's logic is not what is refusing.
3. Applied the 0046 remedy (`grant execute … to presby_app`) with the body still gutted → **the frozen column was rewritten.** `WRITE SUCCEEDED: {"t": 1}`.
4. Restored the real body, kept the grant → `ERROR: import_rows: this change is not permitted`, as designed.

**This is a documented in-repo hazard, reintroduced.** `drizzle/0046_presby_statistical_returns.sql:469-476` carries a security-review finding (B-M1, sec B, 2026-09-25) written about precisely this, and then does the right thing:

> `-- presby_guard_publication_write() is SECURITY INVOKER, and on`
> `-- congregation_statistics it is reachable by presby_app … Revoking EXECUTE`
> `-- would turn the guard's uniform literal into 'permission denied for function`
> `-- presby_deny_publication_write' on the tenant path.`
> `revoke all on function presby_deny_publication_write() from public;`
> `grant execute on function presby_deny_publication_write() to presby_app, presby_platform;`

I checked every other guard in the catalog: every prior tenant-reachable one (`presby_guard_membership_end/_insert`, `presby_guard_people_delete`, `presby_freeze_approved_roll_action`, `presby_freeze_statistics_submission_grant`) raises **inline** with no helper, so no ACL is exposed; the one that does factor the raise into a helper on a tenant-reachable table (`presby_guard_publication_write` on `congregation_statistics`) grants EXECUTE. 0053 is the only case that factors the raise out *and* omits the grant.

**What this is not:** it is not a security hole. The write is still refused, with the same SQLSTATE 42501, and every freeze cause on the tenant path yields one uniform message, so the single-literal discipline's *indistinguishability* purpose is satisfied by accident. The trigger bodies are genuinely covered — by `imports.test.ts` on the owner connection, asserting the exact literals.

**What it is:** shipped DDL that emits an internal catalog identifier to the tenant connection where the design specified a deliberate literal, on the only two tables this feature's own ruling made tenant-writable — and the connection the executor pipeline's UI will build against.

**Fix:** one line after each revoke.

```sql
grant execute on function presby_deny_import_batch_change() to presby_app, presby_platform;
grant execute on function presby_deny_import_row_change()   to presby_app, presby_platform;
```

0053 is unreleased, so this corrects in place, same file and number (`drizzle/` rule, Project Layout).

### FAIL-2 — six §42 assertions cannot fail, and are labelled as proving the thing they do not prove

Consequence of FAIL-1, but a separate gap the fix above does not close on its own. These six tenant-connection assertions catch bare `insufficient_privilege`, which both the guard's `RAISE … using errcode = 'insufficient_privilege'` **and** the missing-EXECUTE permission error produce:

- `scripts/test-rls.sql:6921` — `raw_payload` frozen
- `scripts/test-rls.sql:6930` — `candidates` frozen
- `scripts/test-rls.sql:6940` — Path-B stamp on a still-unresolved row refused
- `scripts/test-rls.sql:6966` — `report_year` frozen
- `scripts/test-rls.sql:7021` — second stamp refused
- `scripts/test-rls.sql:7030` — a resolved row's `rationale` frozen

Step 2 above demonstrates they pass against a **no-op guard**. Phase 4's summary claim that §42 proves "both freeze-trigger UPDATE paths behaviourally" is half right: the *permitted* paths (Path A, Path B) are genuinely exercised on the tenant connection and I re-confirmed them; the *refused* paths are not. **Named gap: no tenant-connection assertion pins the rejection literal.** Adding `and sqlerrm like 'import_rows: %'` (or a `when others` handler matching the message) to those six handlers makes them fail if the grant is ever dropped again — which is exactly the regression FAIL-1 shows can recur. §42(c)/(d) at `:6717`, `:6729`, `:6736` are **correct as written** and need no change: those are grant-layer refusals and the block's own comment says so.

Everything else in this increment verified clean.

## Verdict

**FAIL**

- `drizzle/0053_presby_name_history_import_staging.sql:436` — missing `grant execute on function presby_deny_import_batch_change() to presby_app, presby_platform;`
- `drizzle/0053_presby_name_history_import_staging.sql:718` — missing `grant execute on function presby_deny_import_row_change() to presby_app, presby_platform;`
- `scripts/test-rls.sql:6921`, `:6930`, `:6940`, `:6966`, `:7021`, `:7030` — assertions that pass against a no-op guard; no tenant-connection assertion pins the rejection literal

Precedent and rationale: `drizzle/0046_presby_statistical_returns.sql:469-476`.

Nothing else blocks. Every other ruling — Rulings 1–10, the F104 addendum's six Batch A rulings, Findings 1 and 2 — is implemented and independently verified against the live catalog and by behavioural probe. The from-empty rehearsal reproduces (584 assertions, 67 tables, 0 failing). No design problem is implicated, so this does not escalate to Phase 3.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — live-catalog audit, 11 failing-first probes reproduced, from-empty rehearsal on a scratch DB (dropped), shared-file discipline and No Real Data clean; one DDL defect and one coverage gap found | **FAIL** | 2026-09-26 |

**Handoff:** to **database-admin** (Phase 4). Two `grant execute` lines in `drizzle/0053_…sql` (correct in place — the migration is unreleased), then re-apply and re-run `scripts/test-rls.sql`; and strengthen the six §42 handlers named above to match on the literal so the grant cannot silently go missing again. Both fixes are small and neither touches the design. When they land, the failing-first evidence to re-run is step 2 above — gut the deny helper's body on a scratch DB and confirm the six §42 assertions now **fail**, before restoring it and watching them pass. Re-verification after that should be quick: `test-rls.sql` (expect 584), `npm run test:db` (expect 4177), and the owner/tenant refusal-message pair.



### Orchestrator note (2026-09-26)

FAIL loops back to the database-admin (Phase 4) for the two `grant execute` lines and the six §42 handlers; no design change, so Phase 3 is not reopened. QA re-verification follows as a second Phase 5 pass, recorded below the first.

---

# Phase 5 — Verification (qa) — **second pass** (re-verification after the 2026-09-26 Phase 4 loop-back)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-nh` · branch `pipeline/name-history`
**Neon branch:** `br-shiny-cherry-ax6egkta` — read from `select setting from pg_settings where name='neon.branch_id'` on all four connections (`MIGRATE_DATABASE_URL`/`PLATFORM_DATABASE_URL` → `neondb_owner`, `APP_DATABASE_URL`/`DATABASE_URL` → `presby_app`), not inferred from the host string. `env | grep -c DATABASE_URL` = **0** before `.env.local` was sourced. No `ALTER ROLE`, no `db:push`, nothing committed, no repo file written.

**Scope of this pass:** the two FAIL findings only (FAIL-1 grants, FAIL-2 no-op-provable assertions) plus the regression evidence, the shared-file discipline, and the full green-suite re-run. The rest of the increment was verified clean on the first pass and was not re-audited — corroborated by mtimes: only `drizzle/0053_…sql` (16:46), `scripts/test-rls.sql` (16:48) and `src/lib/db/domain/imports.test.ts` (17:00) moved after the first pass; the other seven changed/new files are all ≤ 16:01.

## Type Check

`npm run typecheck`: **PASS** (exit 0). `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check` (audit, sql-date, deps-drift, brand-scope, secrets): **PASS**.

## Unit Tests

`npm run test:db` (serial, `--no-file-parallelism`, branch DB): **288 files, 4178 tests, 4178 passed, 0 failed, 0 skipped**, 489.5 s. Exactly the 4177 + 1 the loop-back predicted.
`npm run test:db -- src/lib/db/domain/imports.test.ts`: **29 passed**.
`scripts/test-rls.sql` as `presby_app`, `-v ON_ERROR_STOP=1`: **exit 0, 584 `pass` notices, zero `ERROR` lines**.

## End-to-End Tests

Not run — **not applicable**. The diff touches no `src/app/**`, no `src/auth.ts`, no `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/` (`git diff --name-only 82d6b54` + the four untracked files). The stricter auth gate is not engaged.

## Schema/RLS Audit (live catalog, branch `br-shiny-cherry-ax6egkta`)

**1. Function ACLs — `aclexplode(proacl)`, on the owner connection (FAIL-1's fix).**

| Function | `presby_app` | `presby_platform` | `PUBLIC` | `prosecdef` |
|---|---|---|---|---|
| `presby_deny_import_batch_change()` | EXECUTE | EXECUTE | **none** | f (INVOKER) |
| `presby_deny_import_row_change()` | EXECUTE | EXECUTE | **none** | f (INVOKER) |

Raw: `{neondb_owner=X/neondb_owner,presby_app=X/neondb_owner,presby_platform=X/neondb_owner}` on both. The trigger functions themselves (`presby_freeze_import_row/_batch`) remain owner-only, which is correct — trigger EXECUTE is checked at `CREATE TRIGGER`, not at fire time. **FAIL-1 is closed.**

**2. Tenant-path probes as `presby_app`, in a rolled-back transaction, with `app.current_org_id` set to the Northern Reach — and the refusing layer named for each.**

| Probe | Result | Which layer actually refuses |
|---|---|---|
| `UPDATE import_rows SET raw_payload` (frozen col) | `42501` · **`import_rows: this change is not permitted`** | the `import_rows_freeze` **trigger**, through the now-granted `presby_deny_import_row_change()` |
| `UPDATE import_batches SET worksheet` | `42501` · **`import_batches: this change is not permitted`** | the `import_batches_freeze` **trigger**, through `presby_deny_import_batch_change()` |
| `DELETE FROM import_batches` | `42501` · `permission denied for table import_batches` | the **table grant** (`presby_app` holds SELECT/INSERT/UPDATE only), *not* the trigger — it refuses before the trigger can fire |
| Path A (five-column resolve) | **succeeds**, 1 row, `resulting_return_id` still null | permitted, as designed |
| Path B (stamp alone, id via `presby_list_published_returns_to_me()`) | **succeeds**, 1 row | permitted, as designed |

The task's expectation that the tenant `DELETE` on `import_batches` raises the trigger literal is **not** what the database does, and should not: on `presby_app` the missing DELETE grant wins. That is `§42(d)`'s documented posture ("durable by grant on this connection and by trigger on the owner's"), and the grant-layer half is pinned in the catalog by `scripts/test-rls.sql:6663-6666` (`DELETE` grant count = 0 on both staging tables), so `(d)`'s bare `insufficient_privilege` catch cannot silently change layers. On the **owner** connection (`neondb_owner`, which no grant binds — F44) I probed both deletes and got the trigger literals: `import_batches: this change is not permitted` / `import_rows: this change is not permitted`. Both layers verified, each on the connection where it is the one that matters. Not a finding.

**3. Table posture re-confirmed:** `import_batches` and `import_rows` both `relrowsecurity = t`, `relforcerowsecurity = t`; `presby_platform` holds SELECT only on each.

## Failing-first, reproduced independently by me

On scratch database **`nh_qa2`**, created inside the same Neon branch (branch id re-confirmed from inside it on both roles), built from empty: `db:migrate` (51 journal entries, 84 tables) → `psql -f drizzle/0053_…sql` (exit 0, 87 tables) → `db:seed` + `scripts/seed-dev.sql` → `install-test-helpers.sql`.

The suite aborts at first failure, so for the failing runs I used a copy in the session scratchpad with line 13 changed to `\set ON_ERROR_STOP off` + `\set ON_ERROR_ROLLBACK on`; `diff` of the two files ignoring that line is **empty** — the assertions are byte-identical to the repo's. Baseline on that copy, healthy DB: **584 passes, 0 errors** (harness faithful).

| Run | State | Result |
|---|---|---|
| Baseline | grant present, real body | **584** passes; the six target `pass` strings appear **6×** |
| **(a)** `revoke execute on function presby_deny_import_row_change() from presby_app;` | grant gone, body intact | **578** passes, **exactly six** failures, one per site — `scripts/test-rls.sql:6940`, `:6955`, `:6971`, `:7003`, `:7065`, `:7080` — each reading `FAIL — refused, but NOT by presby_freeze_import_row's own literal (got: permission denied for function presby_deny_import_row_change)`. Six target `pass` strings: **0×**. Canonical suite (`ON_ERROR_STOP=1`) in the same state: **exit 3**, aborting at `scripts/test-rls.sql:6940` |
| **(b)** grant restored, body replaced with `begin return; end` | no-op guard | **578** passes; all six sites fail — four with the assertion's own `FAIL — …` message, two (`:6971`, `:7065`) escaping to the `import_rows_resolution_shape` CHECK and the `import_rows_resulting_return_fk` FK. Six target `pass` strings: **0×** |
| **Restore** | whole-file `psql -f drizzle/0053_…sql` | exit 0; both helpers' `proacl` and `md5(prosrc)` back to the shipped values; canonical suite **584 passes, exit 0** |

**FAIL-2 is closed:** the six assertions now fail both when the grant disappears *and* when the guard body is gutted. They could do neither before.

**Batch-side regression, also reproduced:** with `revoke execute on function presby_deny_import_batch_change() from presby_app, presby_platform;` the new spec fails at **`src/lib/db/domain/imports.test.ts:192`** (`Received` is missing both `presby_deny_import_batch_change/*` entries); grant restored by whole-file re-apply → **29/29**. It is a live-`aclexplode` catalog assertion on the owner connection, not a mock — the right shape for a grant claim.

Scratch database **dropped** (`pg_database` back to `neondb, postgres, template0, template1`).

## From-empty rehearsal (DECISION-150), on the corrected file

Captured on `nh_qa2` before any of the mutation experiments above:

| Step | Result |
|---|---|
| `npm run db:migrate` (committed journal) | 51 migrations, 84 public tables |
| `psql -f drizzle/0053_…sql` | exit 0, zero `ERROR`, 87 tables |
| whole-file re-apply (2nd) | exit 0, zero `ERROR`, still 87 tables — **idempotent** |
| both deny helpers' `proacl` on the fresh DB | `presby_app=X`, `presby_platform=X` — **the grants ship in the file alone**, not just on the mutated branch DB |
| `db:seed` → `scripts/seed-dev.sql` | exit 0; orgs=10, open_canonical=10, nh_total=12, batches=1, rows=1 — identical to both prior rehearsals |
| `test-rls.sql` as `presby_app` | **exit 0, 584 passes** |
| tenant literal probe on the fresh DB | `import_rows: …` / `import_batches: …` on UPDATE, grant-layer refusal on batch DELETE — same as the branch DB |

Branch DB, separately: whole-file re-apply **×2**, exit 0 both times, zero `ERROR`, row counts unchanged before and after (`onh=17 batches=1 rows=1 orgs=15 sr=1`).

## Shared-file discipline

- `git diff 82d6b54 -- scripts/test-rls.sql`: **one hunk, `@@ -6587,3 +6587,719 @@`, zero removed lines.** Confirmed by direct count of `^-` lines = 0. All six new guards (`scripts/test-rls.sql:6936`, `:6951`, `:6967`, `:6999`, `:7061`, `:7076`) sit inside this pipeline's own appended §42; the three §42(c)/(d) handlers at `:6717`, `:6729`, `:6736` are untouched, correctly.
- `drizzle/0053_…sql`: the only change vs the first-pass state is the two B-M1 blocks. Verified by arithmetic, not assertion — the batch `revoke` moved `436 → 451` (+15) and the row `revoke` moved `718 → 749` (+31 = 16 + 15), which is exactly two insertions of a 15-line comment plus one `grant execute` line and **nothing else added or removed anywhere above line 749**. The file's only other function grants (`presby_normalize_org_match_text`, `presby_match_organization`) are unchanged.
- Forbidden/shared files: `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/schema-design-2.md` — all **untouched** (`git status --porcelain` over the six is empty). The working tree at the end of this pass is byte-identical to the implementer's handoff state.

## Regression Tests Added

*(Authored by the implementer in the loop-back; verified failing-then-passing by me, above.)*

- `src/lib/db/domain/imports.test.ts:177-198` — "keeps EXECUTE on both deny helpers for presby_app and presby_platform — regression for the deny helpers' missing EXECUTE grant". Guards against: FAIL-1 recurring on the batch helper, which §42 has no tenant-path assertion for. Confirmed failing at `:192` with the grant revoked.
- `scripts/test-rls.sql:6936`, `:6951`, `:6967`, `:6999`, `:7061`, `:7076` — literal-pinning guards inside the six §42 `insufficient_privilege` handlers. Guard against: FAIL-1 recurring on the row helper *and* a gutted guard body. Confirmed failing under both conditions.

## Coverage on Critical Modules

Unchanged from the first pass — this increment adds no code to `src/lib/permissions.ts`, `src/lib/two-factor.ts` or `src/lib/flags.ts`, and the three loop-back edits are DDL and test files. The schema-side coverage is the 584-assertion RLS suite and the 29 owner-connection catalog/behaviour tests in `imports.test.ts`, both now capable of failing for the reasons they claim.

## Feature-Gate Audit

**No protected routes touched.** The loop-back changed three files — `drizzle/0053_presby_name_history_import_staging.sql`, `scripts/test-rls.sql`, `src/lib/db/domain/imports.test.ts` — none under `src/app/`, none containing `"use server"`. The full-increment finding from the first pass stands: no `route.ts`, no server action, no `src/app/` file of any kind. `npm run check:audit` is vacuously green; the audit obligation travels with the deferred writers (Phase 2 Ruling 9).

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| *(none — no route or action in this diff)* | n/a | n/a | n/a |

## Findings

Both first-pass findings are closed, each verified on the live catalog and by behavioural probe rather than by a green test:

- **FAIL-1 — closed.** `drizzle/0053_…sql:452` and `:750` now grant EXECUTE to `presby_app, presby_platform`; the catalog agrees on the branch DB and on a from-empty DB built from the file alone; the tenant path returns the designed literal on both tables' UPDATE arm.
- **FAIL-2 — closed.** The six assertions fail under a revoked grant (six failures, exactly the six sites) and under a no-op guard body (same six sites), and pass only against the real body with the grant present. Reproduced by me end to end, not read from the implementer's log.

One observation, no action: the B-M1 comment blocks are 15 lines each and largely duplicated between the two helpers. That is consistent with 0046's precedent and is the reason the hazard is now discoverable at the point of the revoke; not a finding.

## Verdict

**PASS**

Every required check green: `typecheck`, `lint`, `check` (five tripwires), `test:db` 4178/4178 with zero skips, `test-rls.sql` 584/exit 0 on the branch DB and on a from-empty scratch DB, whole-file 0053 idempotent (four applies total across two databases, exit 0 every time), live-catalog ACL probe on both deny helpers, tenant- and owner-path refusal probes with the refusing layer named for each, and both regression mechanisms independently watched failing before passing. Shared-file discipline and the untouched-forbidden-files rule hold. No e2e is required — the diff is schema and tests only.

The orchestrator's integration items are unchanged and still outstanding: the `index.ts` export line, the `_journal.json` entry, F100–F104 plus the two Phase 4 findings in `docs/schema-design-2.md`, DECISION-153, and the `docs/TODO.md` lines.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (second pass) | qa | Complete — both FAIL findings independently re-verified closed: live `aclexplode` on both deny helpers, tenant/owner refusal probes with the refusing layer named, failing-first reproduced by QA under both a revoked grant and a gutted guard body, from-empty rehearsal on a scratch DB (dropped), full suites green | **PASS** | 2026-09-26 |

**Handoff:** to **analyst** (Phase 6 — Shipped vs Intent). Nothing is committed; the worktree is in the implementer's handoff state. Worth carrying into Phase 6: this increment ships **no writer** for `organization_name_history` (backfill only, Finding 2) and **no UI**, so "shipped vs intent" is a comparison against Phase 1's *staging* promise, not against an import experience; and the two `docs/TODO.md` follow-ups Phase 4 proposed (post-0053 organizations get no canonical row; `resulting_return_id` reachability through `presby_list_published_returns_to_me()`) are the natural SHIP-WITH-NOTES candidates.

---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

*For `/Users/cshenso/git/presby-platform/presby-wt-nh/docs/work-log/2026-09-26-name-history-import-staging.md`. Read Phases 1–5 in full (2,646 lines), including the Phase 2 addendum (F104) and both Phase 5 passes. Spot-checked the live catalog directly on Neon branch `br-shiny-cherry-ax6egkta` (confirmed via `pg_settings.neon.branch_id` on the owner connection, matching the worktree's assignment) rather than trusting the write-up alone.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> This increment promised the schema and matcher for a future import pipeline — no writer, no UI — and that is exactly, precisely what shipped: I re-derived every load-bearing claim (FORCE RLS, grants, the view's column list, the matcher's return columns, both freeze triggers, the F104 composite FK, the narrowed provenance CHECK) against the live catalog myself and every one matched the write-up to the letter; the only reason this isn't a bare SHIP IT is a handful of correctly-named-but-not-yet-tracked follow-ups, one of which (a Phase 2 ruling's own TODO instruction) fell out of Phase 4's compiled integration list and needs to be put back before this closes.

## What's Working

- **The staging promise, not an import experience, is the right yardstick, and it's met.** Phase 1's Flow 1 table (migration → backfill → seed fixtures → `check:schema-parity` passes) is the only user-facing "flow" this increment has, and it ran clean twice on the branch DB and twice more on independent from-empty scratch databases (Phase 4's rehearsal, QA's first-pass rehearsal, QA's second-pass rehearsal) — DECISION-150's bar, met three separate times by three different operators.
- **Gap 1 (no structured city → `canonical.city = null`) honoured, and I checked it isn't just true by construction.** Live query: 0 open canonical rows have a non-null city; the one canonical row that does (Bramblewood, `Cranesport`) is a *closed* predecessor row from the seed fixture's deliberate rename scenario (`authority = 'recorded'`, `effective_to = 1988-06-01`), not a backfill artifact — the automated backfill's 15 open rows are all `authority = 'backfill'`, `city = null`, matching Ruling 7 exactly.
- **Gap 2 (chain writer cannot serve imports) honoured and not re-introduced.** `presby_import_return()` is specified as a contract only (Ruling 9) and nothing in the diff calls `presby_write_return_publication_chain()`; the additive `statistical_returns` constraints (staging FK, id/about/year unique, narrowed provenance CHECK) exist purely to make room for the future sibling, and I confirmed the narrowed CHECK live: `CHECK ((provenance = 'imported' OR staging_row_id IS NULL))` — exactly Finding 1/F105's text, not Ruling 6.3's original (unappliable) form.
- **Gap 3 (no `presby_app` INSERT on name history) honoured.** Live `aclexplode`: `organization_name_history` grants `presby_app` **SELECT only**; `presby_platform` gets INSERT+SELECT (the 0044 narrowing). No DML path exists for the table this increment ships besides the migration's own backfill.
- **The three open questions are closed and the closures are live, not just documented:** Ruling 3 (rename closes-and-opens, never duplicates) — the `organization_name_history_canonical_no_overlap` partial GiST EXCLUDE is present verbatim on the live catalog; Ruling 4 (year ranks, never filters) — the matcher's 13-column return signature matches Ruling 4's list exactly, in order, live; Ruling 8 (minute-vs-authority) — `organization_name_history_minute_shape`'s live definition matches the design.
- **F105 (narrowed CHECK) still expresses Ruling 6.3's intent, not just its letter.** The point of 6.3 was "an imported artifact's staging pointer is exclusive to imported provenance"; `source_ref` turning out to be a general free-text column (proven against `drizzle/0047`'s live, permanently-frozen backfill row) doesn't weaken that — `staging_row_id` still carries the exclusivity, and `imports.test.ts` pins the `drizzle/0047` row as a named regression so a future tightening has to argue with a test, not a comment.
- **F106's honest invariant split is real, not just claimed.** The migration's own section-9 assertion (strong: every org has exactly one open canonical row, asserted at migration time) is unchanged; `seed-dev.sql`'s section (0) is explicitly the weaker, seed-scoped claim; `test-rls.sql` §42(k) and `imports.test.ts` assert the two separately. This is the right way to admit a decaying invariant rather than pretend it still holds everywhere.
- **The QA second-pass B-M1 grant fix is closed and independently reproduced, not just re-asserted.** I didn't just read QA's claim — I ran the ACL query myself: both `presby_deny_import_batch_change()` and `presby_deny_import_row_change()` show `presby_app=X`, `presby_platform=X` in `proacl` on the live branch DB right now.
- **The adversarial pass's sharpest finding (the matcher as a cross-council enumeration oracle) is honoured with margin.** Live `pg_get_function_result` on `presby_match_organization` shows exactly the 13 ruled columns — no `platform_status`, `slug`, `deletable_until`, `status` — and the view's column list (`information_schema.columns`) shows exactly the 9 ruled columns, with `organization_id`, `minute_reference`, `notes`, `authority`, `recorded_by` structurally absent (not filtered, absent), which is the stronger of the two designs the architect considered.
- **F103's generalized test holds on inspection of every constraint on the three tables**, not just the two it was invented for — QA's own table (work-log:2193-2204) is right, and I did not find a constraint QA missed.

## Intent-vs-Shipped Diff

- Phase 1 said: no UI, no route, no server action, no `actions.ts` — "if a reviewer goes looking for a page ... that is not a gap." Shipped: `git diff 82d6b54 --stat` touches exactly `docs/schema-design.md`, `scripts/check-schema-parity.ts`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `src/lib/db/domain/{org,returns}.ts`, `src/lib/dev-docs.ts`, plus new `drizzle/0053_…sql`, `src/lib/db/domain/imports.{ts,test.ts}`, and the work-log. Zero `src/app/**`. **Verdict: matches, exactly.**
- Phase 1 said: name-history writes are council acts, recommend no live INSERT grant this increment (a recommendation, explicitly not binding by default). Phase 2 **strengthened** this to a structural rule (F40/F103) rather than accepting it as contingent. Shipped: matches Phase 2's stronger version, live-verified. **Verdict: matches (and correctly hardened between Phase 1 and Phase 2, which is the pipeline working as intended, not drift).**
- Phase 1 said (Gap 4): the overlap rule needs a mechanism. Phase 2/3 supplied the partial GiST EXCLUDE. Shipped: present, live, and QA proved it fires with a positive control (a `former_name` over the identical interval is accepted — the partial `WHERE` is doing the work). **Verdict: matches.**
- Phase 1's kickoff said "an import will be the chain writer's third caller." Phase 1's own Gap 2 corrected this before Phase 2 even started, and every subsequent phase carried the correction forward without regression — I checked `presby_write_return_publication_chain()` is untouched by this diff. **Verdict: matches the corrected intent, not the stale kickoff text — the right outcome.**
- Phase 2 Ruling 6 proposed a plain FK for `resulting_return_id`; the Phase 2 addendum (F104) overrode it mid-Phase-4 to the about-org composite. Shipped: the live FK is `(resulting_return_id, resolved_org_id, report_year) -> statistical_returns(id, about_org_id, report_year)` — I ran `pg_get_constraintdef` and it matches the addendum's binding text character-for-character, not the superseded Phase 3 text. **Verdict: matches the corrected ruling.**
- Phase 5 (first pass) found two real defects (FAIL-1 grants, FAIL-2 unfalsifiable assertions) against Phase 3's own design (the B-M1 idiom `drizzle/0046` already established). Shipped, after loop-back: both closed, and QA's second pass independently reproduced the closure with its own failing-first probes rather than trusting the implementer's log. **Verdict: matches, after one correctly-executed loop-back — the pipeline mechanism worked as designed.**

## Edge Cases

- **Empty state:** pass. The from-empty rehearsal is this increment's actual "empty state" test (there is no page to render an empty state on), and it ran clean three independent times across two implementers and one QA pass, on three different scratch databases, all subsequently dropped.
- **Failure microcopy:** pass, in the only form applicable — the tenant-connection refusal literal (`import_rows: this change is not permitted` / `import_batches: this change is not permitted`) is the "microcopy" a future UI's error handling will surface, and I reproduced both live on the tenant connection myself. No route exists yet to render it to an end user, so the full UI-failure-microcopy question (Phase 1's Flow 2 failure note — bad worksheet name, no header row) is correctly still open for the executor pipeline, not silently dropped.
- **Permission gate:** not applicable — no enforcement point exists in this increment (Phase 1/2/3 concur, and I found no code path that should have one and doesn't). The one live gate that does exist — the RLS/grant boundary — I verified directly rather than trusting the write-up.
- **Audit event:** not applicable, correctly deferred with the writers (Ruling 9), and `check:audit` is vacuously green for the right reason (no `actions.ts` file exists), not because a mutation slipped past the tripwire.
- **Mobile (360px):** not applicable — no rendered surface.

## Follow-Ups (SHIP WITH NOTES)

The orchestrator's three drafted lines (F100 hardening, the executor-pipeline resolution note, `presby_organize_congregation()`/F106) correctly cover Phase 4's own two named integration items plus F100. **They do not cover everything a binding ruling in this work-log asked to be tracked** — Ruling 5c (Phase 2) explicitly says of the `import_rows` revision mechanism: *"an explicit open item owned by the executor pipeline's Phase 1 — name it in `docs/TODO.md` at integration; do not guess it here."* That line is absent from Phase 4's "For the orchestrator, at integration" list (work-log:1920-1927) and from both QA passes' scope. It should not be lost between here and the merge. Four lines total, ready to paste:

- `- [ ] F100 — organizations.platform_status is already readable on the tenant connection via a raw table-level grant (relrowsecurity = f, presby_app holds SELECT); presby_match_organization()'s exclusion of it is a surface rule, not a leak closure. Scope a column-level revoke + projection view as its own hardening pipeline. Do not widen the raw grant meanwhile. — docs/work-log/2026-09-26-name-history-import-staging.md`
- `- [ ] Executor pipeline: import_rows.resulting_return_id may name a statistical_returns row the importing presbytery cannot SELECT directly (the duplicate disposition, F104's accepted residual). Resolve it only through presby_list_published_returns_to_me() — never a direct join, never a DEFINER fetch by uuid. — docs/work-log/2026-09-26-name-history-import-staging.md`
- `- [ ] F106 — an organization created after drizzle/0053 (createOrganization(), a test fixture, or a future presby_organize_congregation()) gets no canonical name-history row; the backfill is a point-in-time act and this increment ships no writer. Decide in the lifecycle-UI pipeline whether presby_record_org_name() ships with an AFTER INSERT trigger on organizations. — docs/work-log/2026-09-26-name-history-import-staging.md`
- `- [ ] Import-executor pipeline's Phase 1 must name the import_rows revision mechanism (an append-only import_row_revisions child, or a presby_revise_import_row() DEFINER function) — resolution is set-once by design (Ruling 5c) with no correction path once resulting_return_id is stamped, and Phase 2 explicitly deferred naming the fix-up mechanism to that pipeline's own Phase 1. — docs/work-log/2026-09-26-name-history-import-staging.md`

The `dev-docs.ts` `statistics_submission_grants` gap-fill is **already closed within this diff** (Phase 4 registered it as a one-line, disclosed, harmless bonus fix) — it needs no TODO line, it needs nothing further.

**Workflow Rule 12 (feedback row):** not applicable — this pipeline has no `Source:` block and did not originate from an in-app feedback row.

**Workflow Rule 13 (what's-new advisory):** No. No member-visible behavior shipped — no UI exists to advertise.

**Workflow Rule 14 (functionality map):** Yes, required at integration, and I checked the current text — `docs/product/functionality-map.md:15`'s "presby: schema" bullet (63 domain tables) does not yet mention name history, import staging, or the matcher. Suggested addition, appended to the existing bullet before its migration citation: *"; dated, typed, city-qualified organization name history (D14/F37, function-mediated — no live `presby_app` INSERT) with a cross-council matching function (`presby_match_organization()`); a presbytery-owned import quarantine (`import_batches`/`import_rows`, D13) staged for a future spreadsheet importer, ordinary tenant DML minus DELETE, no writer yet."* — then extend the migration citation to `drizzle/0043`–`0047`, `0053` and add this work-log's link.

**Workflow Rule 15 (architecture.md):** No, and I looked for a reason to disagree before agreeing. The candidate case would be "D13's staging model is a new subsystem shape," but it isn't one at the architecture-document's level of abstraction: section 4/5 already state the isolation-vs-authorization split and the function-mediation pattern this increment is a straightforward *instance* of (F103's test is a sharpened restatement of an already-documented invariant, not a new one), and the document's own section 3 ("the domain model in five ideas") doesn't itemize individual table families at this grain — it didn't get an entry for `organization_lifecycle_events`/`organization_affiliations` either. No writer, no route, no changed data flow, no changed runtime shape. Resisting the update is the correct call here, consistent with Rule 15's own instruction not to move the document with every pipeline.

## Release Note Draft (v0.28.0, schema-only, for a non-engineer)

> ### The database can now remember a congregation's past names, and hold an unmatched spreadsheet row for review instead of dropping it
>
> **Background:** A presbytery's historical records use whatever name a congregation was known by at the time — churches merge, rename, and are recorded under handwritten variants in decades-old paper reports. Matching those old records to today's congregations by name alone is unreliable, and past attempts to import that kind of data have simply thrown away anything that didn't match cleanly. This release lays the groundwork to do both properly, but changes nothing anyone will see yet.
>
> **Changes:**
> - The database can now store more than one name for a congregation over time — its current name, any former official names, and looser historical or handwritten variants — each dated and optionally tied to a city, so a name from 1965 can be told apart from a same-named church founded later elsewhere.
> - A new lookup can search across all of a presbytery's history — not just the current name list — to suggest which congregation an old record probably refers to, ranked by how confident the match is.
> - The database gained a place to hold a spreadsheet row that can't be matched automatically: the original data, what was tried, and why it's unresolved, kept permanently rather than silently skipped.
> - Nothing is reachable from any screen yet — no upload page, no review screen, and no way for a presbytery or congregation to record a name change themselves. This release is the storage and the matching logic only; the page that uses them ships in a later release.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — Phase 1's staging promise (schema + matcher, no writer, no UI) verified against the shipped diff and against the live catalog directly (FORCE RLS, grants, view columns, matcher return columns, the F104 FK, the narrowed provenance CHECK, the canonical backfill's null-city discipline, all independently re-queried, not read from the write-up); all eight Phase 1 gaps and three open questions confirmed closed and live; one Phase 2 ruling's TODO instruction (Ruling 5c's revision-mechanism line) found missing from Phase 4's compiled integration list and added here | **SHIP WITH NOTES** | 2026-09-26 |

**Handoff:** to the **orchestrator**, for integration. Ready-to-apply items, none blocking: (1) the four `docs/TODO.md` lines above (three as drafted, one added — the Ruling 5c revision-mechanism line); (2) `docs/schema-design-2.md` gets F100–F106 (F104's text superseded per the addendum, not Phase 3's original); (3) `docs/decisions.md` DECISION-153 carries the addendum's ruling 2 language ("about-org composite"), not "plain FK"; (4) `src/lib/db/domain/index.ts` gains the one export line; (5) `drizzle/meta/_journal.json` gains the `0053` entry at whatever index it lands; (6) `docs/product/functionality-map.md`'s "presby: schema" bullet, per the suggested text above. No further pipeline phase is owed — this closes as SHIP WITH NOTES pending the user's commit approval."}],"container":null,"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":2265,"cache_read_input_tokens":133649,"output_tokens":8317,"output_tokens_details":{"thinking_tokens":1877},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":2265},"inference_geo":"not_available","iterations":[{"input_tokens":2,"output_tokens":8317,"cache_read_input_tokens":133649,"cache_creation_input_tokens":2265,"cache_creation":{"ephemeral_5m_input_tokens":2265,"ephemeral_1h_input_tokens":0},"type":"message"}],"speed":"standard"},"diagnostics":null,"context_management":null},"apiBlockIndex":1,"requestId":"req_011CfSnJUUAtrd5SjX6E4mip","attributionAgent":"analyst","type":"assistant","uuid":"55a4b60e-a89a-4c73-8321-eb700cf57343","timestamp":"2026-09-26T21:45:56.396Z","effort":"high","perTurnEffort":null,"userType":"external","entrypoint":"cli","cwd":"/Users/cshenso/git/presby-platform/presby","sessionId":"b08e6db7-b5b1-4a1b-b94f-75e0928bed80","version":"2.1.273","gitBranch":"main","slug":"warm-honking-hartmanis"}

### Orchestrator closure (2026-09-26)

Shipped as v0.27.0 (`feat(schema):` `drizzle/0053`). DECISION-153 recorded with the F104 addendum amendment; F100–F106 folded into `docs/schema-design-2.md` §2l; `_journal.json` idx 53 and the `imports` export in `src/lib/db/domain/index.ts` appended; TODO reconciled; `development` migrated through 0053 and `test-rls.sql` re-run there.


---

## Phase 2 addendum — F104 (architect, 2026-09-26)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Verdict: Approved with revision.** F104's *diagnosis* is correct and its *rejection of `(id, organization_id)`* is binding. Its *prescription* — a bare plain FK under the §17 structural exception — is **not accepted**. The correct shape is a three-column composite on the **about-org axis**, which the tech-lead did not consider and which an existing shipped constraint already sets as precedent.

---

### 1. Is F104 correct on the functional facts? — **Yes, and the `duplicate` target must be the return, not the publication or the projection.**

Verified live on `pipeline-name-history` (`neondb_owner` catalog read):

- `statistical_returns`: `relrowsecurity = t`, `relforcerowsecurity = t`, `presby_app` holds **SELECT only**, `id default gen_random_uuid()`, and `statistical_returns_submitted_is_self` = `CHECK (provenance <> 'submitted' OR about_org_id = organization_id)`.
- `presby_list_published_returns_to_me()` (`drizzle/0047_presby_publications.sql:1569-1605`) is `SECURITY DEFINER` and **returns `r.id` as `return_id`** in its result set, to `presby_app`.

So the presbytery obtains a congregation-owned return's uuid through an authorized read, and the three cases are:

| Case | Target | Owner | Reachable? |
|---|---|---|---|
| (a) duplicate of an earlier **presbytery-owned `imported`** return | return | presbytery | yes, via RLS |
| (b) duplicate of a congregation's **`submitted`** return **published to this presbytery** | return | congregation | yes, via `return_id` from `presby_list_published_returns_to_me()` |
| (c) duplicate of a `submitted` return **never published** | — | congregation | **no** — the uuid is unobtainable |

Case (b) is real, reachable, and legitimately known. F104's premise holds.

**Publication as the referent: rejected.** `publications.organization_id` is the **source congregation**, not the recipient (`drizzle/0047:26-27, :513`), so an FK to `publications` is equally cross-tenant — it buys no compositeness — and `presby_app` cannot SELECT it from the presbytery's context at all (SELECT granted, RLS filters to the congregation). It is also the wrong fact: a publication is the delivery event; the thing duplicated is the filing.

**`congregation_statistics` projection as the referent: rejected,** on four counts. It is tenant-**mutable and tenant-deletable** (live: table-level `DELETE` to `presby_app`, plus column-level `INSERT`/`UPDATE` on every field) — a set-once, frozen-forever pointer must not name a row the tenant can rewrite. It is a lossy typed projection, not the attested artifact. It exists only on the published branch, so case (a) would need a different referent. And it would make one column polymorphic across dispositions, which is exactly what F102 warns a later reviewer will "simplify" away.

**Case (c) has a correct escape hatch already in the DDL** and Phase 3 should say so: the shape CHECK's `duplicate` branch does *not* require `resulting_return_id`, so `duplicate` + `rationale` + permanently-null pointer is a legal, meaningful state — "known duplicate, target not readable by us." No constraint below may be justified on the grounds that it would strand case (c); it doesn't.

### 2. Does a plain FK into a FORCE-RLS table create an oracle here? — **No, and the ruling below moots the question.**

F103's test extends to FK RI checks (RI bypasses row security, so the check reports existence regardless of tenancy), and it comes out clean: the probe key is `statistical_returns.id`, a `gen_random_uuid()` that appears on **no** public surface. Contrast `subject_org_id` in Ruling 1, which is in the public org tree. The only routes to a return uuid are (i) your own rows via RLS, (ii) `presby_list_published_returns_to_me()`, (iii) the `(statistics-submit)` token flow where the caller is the congregation — all authorized. There is no enumeration; confirming a uuid you already hold discloses nothing.

This does **not** contradict Ruling 6. Ruling 6 itself records that the `staging_row_id` plain-FK oracle "is unreachable anyway"; the composite there is right because both sides genuinely share a tenant and the tighter constraint is free *and true*. The same test applied here gives the other answer for a different reason, which I am promoting to a general rule:

> **A composite FK that is semantically false is not a security improvement — it is a correctness bug that silently refuses a legal write.** Where the two sides do not share a tenant, the question is never "composite or plain," it is *which column pair actually matches*.

### 3. Does `resulting_return_id` need a CHECK or trigger? — **No. It needs the right composite FK, which I am making binding. No trigger, no DEFINER helper, nothing deferred to the writer.**

The tech-lead reached "plain" by testing one candidate pair. Both candidates fail, and for opposite dispositions:

- `(id, organization_id)` — refuses case (b) (`duplicate` → congregation-owned `submitted`). F104's finding.
- `(resolved_org_id, …) -> statistical_returns(organization_id, …)` — refuses `matched_existing` / `matched_alias` / `created_dissolved`, where the minted return's `organization_id` is the **presbytery** while `resolved_org_id` is the congregation.

The referent's owning org varies by disposition, so no pair involving `organization_id` can work. The disposition-**independent** invariant is `statistical_returns.about_org_id = import_rows.resolved_org_id`: true for the minted-import cases by construction, and true for the `submitted` case by `statistical_returns_submitted_is_self`. That is a declarable FK once the target side carries a matching unique — and the codebase already has this exact idiom twice:

- `statistics_submission_grants (about_org_id, return_id) -> statistical_returns (organization_id, id)` (`drizzle/0049:161-162`; the parity allowlist's STAMP row)
- `congregation_statistics (publication_id, about_org_id) -> publications (id, organization_id)`, whose own comment states the principle: *"this table's `organization_id` is the RECIPIENT presbytery while the publication's is the SOURCE congregation — `about_org_id` is the column that matches."*

**Binding for Batch A.** In `drizzle/0053`, additively on the already-touched `statistical_returns` (idempotent-guarded, the 0047/0049 `do $$ … pg_constraint …$$` idiom):

```sql
alter table statistical_returns
  add constraint statistical_returns_id_about_year_key
  unique (id, about_org_id, report_year);
```

and on `import_rows`, replacing the plain `references statistical_returns(id)`:

```sql
foreign key (resulting_return_id, resolved_org_id, report_year)
  references statistical_returns (id, about_org_id, report_year)
```

Why this is correct and complete:

- **`MATCH SIMPLE`'s null hole is already closed by the shape CHECK.** The check is skipped if any column is null; `report_year` is `not null` always, and every branch of `import_rows_resolution_shape` that permits a non-null `resulting_return_id` (`matched_*`, `created_dissolved`, `duplicate`) also requires `resolved_org_id not null`, while `unresolved` and `rejected` force `resulting_return_id` null. So the FK is enforced **exactly** when the pointer exists. Say this in the DDL comment — it is the kind of reasoning a later reviewer re-derives or breaks.
- **It also pins the year**, which no trigger was going to do cheaply and which a frozen, set-once pointer can never be corrected for. Loosening later is an `alter table drop constraint`; tightening after the executor ships is not (Ruling 5c's own asymmetry).
- **The new unique is not an oracle** under F103's test: `id` is the PK, so any `(id, about_org_id, report_year)` collision implies an `id` collision the PK already reports, and `presby_app` holds no INSERT on the table at all.
- **It is enforced on the owner path too**, without a trigger — which matters because F44 says the owner path is the one that matters.

**Explicitly forbidden alternative, and this is the part most likely to be built by reflex:** do **not** implement this as a validation query inside `presby_freeze_import_row()`. That function runs with invoker rights as `presby_app`, and `statistical_returns` is FORCE-RLS filtered to the presbytery's own rows — so its `select` would return **zero rows for exactly case (b)**, refusing the one write the whole ruling exists to permit. That is F26 verbatim, and it would pass every same-tenant test. If a future need does require a cross-org read in that trigger, it goes through a `SECURITY DEFINER` helper with `set search_path = public, pg_temp` (DECISION-148) — but no such need exists now, and none should be added in Batch A.

**Also correct F104's framing:** this is **not** a `docs/schema-design.md` §17 structural exception. §17's exception is for plain references to `organizations` — a non-RLS, publicly-readable, non-tenant table (`relrowsecurity = f`, verified live) — which is why `about_org_id`, `subject_org_id` and `resolved_org_id` take it. Invoking §17 for a reference into a FORCE-RLS tenant table would establish, by precedent, that any cross-tenant reference may go bare. It may not. The rule is the one in §2 above.

**Accepted residual, named not deferred:** the FK constrains *which congregation and year* the pointer may name; it does not constrain *whether the presbytery was authorized to learn that return exists*. A presbytery holding a uuid out of band could stamp an accurate pointer to an unpublished filing. This grants no read and is arguably a true record, so no constraint is warranted. The control point is the **read**: the executor pipeline's UI must resolve `resulting_return_id` through `presby_list_published_returns_to_me()` (or the tenant's own RLS-filtered select), **never** a direct join and never a DEFINER fetch by uuid. That belongs in the executor pipeline's Phase 1 alongside Ruling 5c's revision mechanism — one `docs/TODO.md` line at integration, not a Batch A change.

### 4. Does `check:schema-parity` need anything? — **One thing to do, one thing not to do.**

- **Declare the composite in `src/lib/db/domain/imports.ts`**, via drizzle's `foreignKey({ columns: […], foreignColumns: […] })`. `imports.ts → returns.ts` is the permitted one-way direction (Phase 2 module-graph ruling, work-log:154), so there is no cycle and no reason for it to be DDL-only. Both sides then emit `(report_year,resolved_org_id,resulting_return_id) -> statistical_returns(report_year,about_org_id,id)` — `fkSignature()` sorts pairs by local column name (`scripts/check-schema-parity.ts:182-192`) — and the comparator is silent.
- **Do not add an allowlist row for this column.** Ruling 6.2's `extra_fk` row for the reverse, DDL-only `(staging_row_id,organization_id) -> import_rows(id,organization_id)` remains the *only* new entry this pipeline earns. An unnecessary FK allowlist row is the failure mode the comparator's own comment at `scripts/check-schema-parity.ts:378-384` warns about.
- **Declare `unique (id, about_org_id, report_year)` in `returns.ts` as well.** The comparator ignores uniques (Ruling 7), so this is not a parity requirement — it is `db:push` protection: an undeclared constraint on a table drizzle *does* model is a drop candidate the first time someone runs the dev-only push. No cross-module reference is involved, so `returns.ts` still imports nothing from `imports.ts`.
- If Batch A ships `resulting_return_id` as a bare uuid column with no TS-side FK, parity fails `missing_fk`. That is the comparator working; fix the model, not the allowlist.

### Rulings binding on Batch A (database-admin)

1. `resulting_return_id` is **not** `(id, organization_id)` composite — F104's rejection stands.
2. It is **not** a bare plain FK either. It is `(resulting_return_id, resolved_org_id, report_year) -> statistical_returns (id, about_org_id, report_year)`, with `statistical_returns_id_about_year_key` added additively and idempotently in `0053`.
3. No CHECK, no trigger, no DEFINER helper for this column. Do not query `statistical_returns` from `presby_freeze_import_row()` (F26).
4. Freeze-trigger Path B (Ruling 6.1's stamp) is unchanged by this ruling — the FK fires on the same UPDATE and needs no new path.
5. Declare the FK in `imports.ts` and the unique in `returns.ts`; add no new parity allowlist row beyond Ruling 6.2's.
6. Column and constraint comments must state the about-org rationale and the `MATCH SIMPLE` / shape-CHECK interaction explicitly.

### Finding to record (orchestrator, at integration)

Supersede the tech-lead's F104 text with:

> **F104** — `import_rows.resulting_return_id` cannot take a composite FK on `organization_id` in **either** direction: `(id, organization_id)` refuses the `duplicate` disposition (F102 — the target is a congregation-owned `submitted` return, reachable because `presby_list_published_returns_to_me()` returns `return_id`), and `(resolved_org_id) -> organization_id` refuses `matched_*`/`created_dissolved` (the minted return is presbytery-owned). The referent's owning org varies by disposition; the disposition-independent invariant is `about_org_id = resolved_org_id`, guaranteed by construction for imported returns and by `statistical_returns_submitted_is_self` for submitted ones. The constraint is therefore `(resulting_return_id, resolved_org_id, report_year) -> statistical_returns (id, about_org_id, report_year)` against a new PK-implied unique — the `statistics_submission_grants` (`0049:161-162`) and `congregation_statistics → publications` idiom, "`about_org_id` is the column that matches." This is **not** a §17 structural exception; §17 covers plain references to the non-RLS `organizations` table only. General rule: *a composite FK that is semantically false is not a security improvement but a correctness bug*; where the sides do not share a tenant, ask which pair actually matches, not composite-versus-plain. `MATCH SIMPLE`'s null skip is closed by `import_rows_resolution_shape`, which forces `resolved_org_id not null` on every branch permitting a non-null pointer. No validating trigger: an invoker-rights read of FORCE-RLS `statistical_returns` from `presby_freeze_import_row()` would return zero rows for exactly the cross-tenant `duplicate` case (F26). Accepted residual: the FK constrains which congregation and year may be named, not whether the presbytery was authorized to learn the return exists — the control is the executor pipeline's *read*, which must go through `presby_list_published_returns_to_me()`.

No new `DECISION-NNN` proposed; `DECISION-153` as already drafted absorbs this, and its text should be amended to carry ruling 2 above rather than "plain FK."

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review (addendum, F104) | architect | Complete — F104 diagnosis upheld, prescription revised to the about-org composite; six Batch A rulings; no new allowlist row; F104 text superseded | Approved with revision | 2026-09-26 |

---

**Handoff:** to **tech-lead** (Phase 3) for a one-paragraph amendment to the `import_rows` DDL block (~work-log line 878), the `0053` additive-constraint list, the `imports.ts`/`returns.ts` model notes, and the `DECISION-153` draft — then straight to the **database-admin** already building Batch A. Rulings 2 and 3 are the ones that change code already in progress; ruling 3's F26 prohibition is the one most likely to be re-introduced by reflex if it is not in the design doc verbatim.



### Orchestrator note (2026-09-26)

Addendum accepted as binding on Batch A; relayed directly to the database-admin already building (the tech-lead amendment round-trip is folded into the implementer notes — Phase 3's `import_rows` DDL block at ~line 878 and its F104 paragraph are superseded by this addendum where they differ). F104's text above supersedes the Phase 3 version at integration; DECISION-153 carries ruling 2.

---
