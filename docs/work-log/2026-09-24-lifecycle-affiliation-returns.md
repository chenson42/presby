# Organization lifecycle, council affiliation, statistical returns and publication (D10 / D19 / D20 / D21) — Work Log

> **Slug:** `2026-09-24-lifecycle-affiliation-returns`
> **Surface:** schema — `src/lib/db/domain/`, hand-written `drizzle/00XX_presby_*.sql` (DDL, CHECK/EXCLUDE constraints, triggers, SECURITY DEFINER functions, RLS policies), `scripts/test-rls.sql`, `scripts/seed-dev.sql`. No new UI. The one existing UI consumer — the org portal's statistics page calling `presby_publish_sasr_snapshot()` and `presby_list_own_congregation_publications()` — must keep working unchanged.
> **Permission(s):** no new catalog keys for the DDL itself; the write paths for lifecycle events and affiliations are future pipelines. Existing `statistics.manage` / `statistics.publish`-shaped gating on the rewritten publish function is preserved.
> **Flag(s):** not needed (schema only; nothing member-visible changes)
> **Estimated complexity:** large
> **Pipeline mode:** Full. Phase 4 lands as ordered migration increments per `docs/schema-design-2.md` §2b's migration order (1→7), each with its own `test-rls.sql` section; tech-lead's Phase 3 decides whether increments 6–7 split into their own work-logs.
> **Design authority:** `docs/schema-design-2.md` — read **§2b first**, then §2a, then §3, §5, §6, §9. The round-3 review (`docs/reviews/2026-09-24-schema-design-round-3.md`) holds the before/after argument. `docs/schema-design.md` conventions (§3), F1/F2/F26/F29 and §17's two-named-cross-org-policies rule apply unchanged. Book of Order is a design authority (§0a): G-3.0301(c) for the lifecycle vocabulary, G-3.0107 for the reviewing council.
> **Scope:** D10 (lifecycle events + successions, `lifecycle_status` cache, drop `organizations.status`, delete guard), D24 (`organization_identifiers`, move `pcusa_pin`), D19/D26 (council-owned `organization_affiliations`, derived `parent_id`/`path`, `btree_gist`), R3.14 (`presby_org_affiliated()` + about-org trigger on the five built tables), D12/D25 (`sasr_form_versions` with enforcing trigger, `statistical_returns`), D20/F36 (`publications`, `congregation_statistics` retrofit with backfill, rewritten publish function), D16 (`statistics_submission_grants` — DDL only, no endpoint), D14/F37 (`organization_name_history`), D13 (`import_batches`/`import_rows`). **Out:** D22 person-merge provenance, D23 care grants, any UI, the grant's unauthenticated endpoint, the PSV import itself.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-24 |
| 3 — Technical design | tech-lead | Complete, amended after batch A, amended again after batches B and C, amended a third time after Phase 5 Finding 1, amended a fourth time after an external post-merge review, ratified a fifth time after the resulting hardening pass, amended a sixth time after a second-round external post-merge review, ratified a seventh time after the resulting round-two hardening build, ruled an eighth time on QA's re-verification FAIL, ruled a tenth and final time on F59 and QA's Finding 1 after the ninth pass | Design complete, increments 1–5 specified; five Phase 4 deviations ruled on after batch A (4 accepted, 1 fixed before batch B — see "Amendment after batch A"); thirteen further items ruled on after batches B and C, none requiring a Phase 4 loop-back — see "Amendment after batches B and C"; QA's Finding 1 (`organization_successions` was policy-mediated, not function-mediated, contra Phase 2 Ruling 1) confirmed and routed to database-admin — see "Amendment after Phase 5" below; an external reviewer's five findings against the exported table shapes (F47–F52) ruled on and routed to database-admin as a migration correction in place — see "Amendment after external implementation review" below; two loop-back candidates and nine deviations from that pass ratified — one CHECK (`organization_affiliations_recorded_has_from`) refused against fixture/test evidence, one CHECK shape (`statistical_returns_provenance_shape`'s attestation exclusion) confirmed Ruling-A4-consistent, no further Phase 4 change required — see "Ratification after the hardening pass" below; a second-round external review's five items (two blockers, two informational, one confirmation) ruled on as F54–F58, generalizing F44/F49's "creation guarded as strongly as mutation" rule to `organization_lifecycle_events`/`organization_successions`, the return→publication→projection chain, the withdrawal pair, and `organization_identifiers` — see "Amendment after external review, round 2" below; database-admin's round-two build ratified as built with one factual correction (the seed's arming site), the `publications` withdrawal literal's one-message-per-reason discipline confirmed, the Finding 1 follow-on revoke ratified as Ruling-1-consistent with its grant-coupling recorded, B-M1/B-M2 ratified as built, and Finding 4a's guard predicate left unchanged pending its own scoped decision — no further Phase 4 change required — see "Ratification after hardening round two" below; QA's re-verification FAIL on two design claims (QA-1 the lifecycle marker is transaction-scoped not event-scoped; QA-2 the tenant can arm the withdrawal marker and write `congregation_statistics.withdrawn_at` alone) ruled: QA-1 partially accepted (id-scoped marker, per-declared-act binding) with full cross-transaction closure declined and named as an accepted, owner-connection-bounded residual (F44 precedent) rather than built; QA-2 accepted in full via column-level privilege narrowing on `congregation_statistics` (`withdrawn_at`, `publication_id`), which also closes the previously-accepted F55/item-7 INSERT-side residual for free; QA-3 accepted (citation fix). Routed to database-admin as the ninth Phase 4 pass — see "Ruling on QA-1/QA-2 after hardening round two" below; **tenth and final ruling:** F59 (the ninth pass's one deviation — the `INSERT` half of the QA-2 fix, built, measured incompatible with Drizzle's insert builder, and removed) accepted as built, with the closing instrument named definitively (a raw column-list SQL insert in `src/lib/presbytery.ts`, over a `SECURITY DEFINER` function) and tracked in `docs/TODO.md`, not built; QA's Finding 1 precision gaps (wrong FK credited, bound overstated) corrected in place in `drizzle/0047` §10 and `docs/schema-design-2.md` F59 — comments/docs only, no DDL or application change, no Phase 4/5 re-loop — see "Ruling on F59 and QA Finding 1 after the ninth pass" below. **This is the last correction on `drizzle/0043`–`0047`.** | 2026-09-25 |
| 4 — Implementation | database-admin | Complete, re-opened three times (Phase 5 Finding 1; external implementation review; the round-2 creation-guard hardening) — **the round-2 loop-back is now COMPLETE (2026-09-25): F54–F58 / DECISION-141 built as a correction in place to `drizzle/0043`–`0047`, plus the security review's B-M1 and B-M2 and the follow-on revoke of `presby_app`'s unused INSERT on `organization_lifecycle_events`. test-rls 402/exit 0 (baseline 384), DB-backed vitest 142 passed, 9 failing-first proofs, whole-file double-apply idempotence proven. See "Loop-back after external review, round 2 — COMPLETE"** — **re-opened a fourth time and now COMPLETE PENDING QA (ninth pass, 2026-09-25): QA-1/QA-2 corrections built in place in `drizzle/0044` and `drizzle/0047`. test-rls 402 → 412/exit 0, DB-backed vitest 142 → 147 passed (lifecycle 38 → 43), whole-file double-apply idempotence re-proven, two failing-first proofs watched. ONE DEVIATION: the INSERT half of Ruling 2 was built, measured to break `setCongregationStatistics()`, and removed — recorded as F59 and owed back to Phase 3. See "Ninth pass — QA-1/QA-2 corrections"** | Six passes green. All three batches green. Increments 1–2 + fixture sweep + `createOrganization()` (batch A); Ruling A5's correction to `drizzle/0044` + increment 3 (`drizzle/0045`, the about-org enforcing trigger) (batch B); increments 4–5 (`drizzle/0046`, `drizzle/0047`), the `congregation_statistics` retrofit and backfill, the rewritten publish function, `presby_list_published_returns_to_me()` and the `sasr_reports` drop (batch C). Then the Finding 1 loop-back, then the external-review hardening pass (F47–F53 / DECISION-140) as a correction in place to `drizzle/0043`–`0047`: six of the seven items built, `organization_affiliations_recorded_has_from` refused as contradicting F41's asserted fixture. test-rls 384/exit 0, DB-backed vitest 119 passed, 33 failing-first proofs. Five loop-back candidates for tech-lead, none blocking. Round 2 (2026-09-25) added the two lifecycle guards + the event-side cardinality trigger, the three publication-chain guards, the withdrawal conjunct on both halves, the identifiers INSERT widening, the fixture sweep across `test-rls.sql`/`lifecycle.test.ts`/`publication.test.ts`/`org-identifiers.test.ts`/`presbytery.test.ts`/`seed-dev.sql`, B-M1/B-M2, and — accepted mid-task by the orchestrator, ratification owed from tech-lead — the revoke of presby_app's unused INSERT on `organization_lifecycle_events` with the two helper grants it unlocked; one residual named for Phase 3 (the same marker-vs-privilege gap on `congregation_statistics`, which the live tenant write path keeps open). Ninth pass (2026-09-25, QA-1/QA-2): the lifecycle marker now carries the event id and the guard binds `new.id`/`new.event_id` to it (per-declared-act, with the cross-transaction re-arm named as an accepted F44-class residual); `congregation_statistics` gains a catalog-generated column-level UPDATE grant excluding `withdrawn_at`/`publication_id`, closing the defect QA measured; the symmetric INSERT narrowing is NOT built (F59 — Postgres requires INSERT privilege on every column in the target list, including `DEFAULT`-valued ones, and Drizzle's insert builder emits them all), so the item-7 INSERT residual stands | 2026-09-25 |
| 5 — Verification | qa | **Re-verified after the ninth pass — all checks green and every QA-1/QA-2/QA-3 claim independently re-measured on the live catalog.** `test-rls.sql` 412/exit 0 as `presby_app` (6 runs); five DB-backed vitest files 147/147 serial, 0 skipped (`lifecycle` 43, `presbytery` 34); `npm run typecheck` PASS; `npm run check` all five tripwires PASS; `drizzle/0044`+`0047` re-applied whole with identical row counts. Both failing-first proofs performed by QA, not accepted on report: boolean-marker regression → 3 red at `lifecycle.test.ts:900,983,1049` and `test-rls.sql` exit 3 at `:4710`; column-revoke revert → `test-rls.sql` exit 3 at `:2147` with QA's original defect (`UPDATE 1` on `withdrawn_at`, armed) reproduced exactly. F59 reproduced independently (one-column INSERT revoke → `presbytery.test.ts` 5 red, `permission denied for table congregation_statistics`) — the deviation is real. Four advisory findings, none verdict-changing: (1) F59's residual is reachable and its stated bound credits the wrong of the two composite FKs and does not constrain the fabricated row's year or values — carry to Phase 6; (2) two transient reds traced to a concurrent pipeline writing the shared `development` Neon branch (Finding 5, live); (3) `npm test` skips all 765 DB-backed assertions, so CI covers none of this work; (4) §10's INSERT restatement leaves stale `attacl` entries. Feature-Gate Audit: no protected routes touched. Not auth-touching, so the stricter e2e gate does not apply. Earlier rows: round-two re-verification FAIL escalated QA-1/QA-2/QA-3 to Phase 3 (2026-09-25); hardening-pass and Finding-1 re-verifications PASS (2026-09-24). | **PASS** | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES — follow-ups tracked in docs/TODO.md; CLAUDE.md, architecture.md, functionality map updated in the ship commit | 2026-09-24 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-24. One orchestrator addendum at the end (production count, verified).*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Four sound, twice-reviewed decisions (D10/D19/D20/D21+D25) get their table shapes here, but the shapes still assume write-authorization and read-through mechanisms — cross-tenant redistricting writes, publication-artifact read-back, and org-table grants — that the built system does not actually have yet, and the round-3 review didn't check any of them against the live grant model.

## User Verbs

This pipeline ships no UI (work-log Surface line), so there are no new verbs today. What matters is which *existing* verbs this schema must not break, and which *future* verbs it silently forecloses or leaves unbuilt. Read against the actual code, not the design doc's aspiration:

| Surface | Verb | Cadence | Status today |
|---------|------|---------|---------|
| Presbytery stated clerk (`/o/<slug>/admin/reports`, `setCongregationStatisticsAction`, `src/app/(org)/o/[slug]/admin/reports/actions.ts:52`) | Enter/correct `presbytery_entered`/`imported` statistics for a member congregation | on demand | **Live today.** Must keep working through the `congregation_statistics` retrofit. |
| Presbytery stated clerk | Set/apply per-capita rates and records | on demand | **Live today**, reads `congregation_statistics` via the same table — unaffected by the `publications` split as long as the rollup/basis-year queries still see the same `(about_org_id, year)` keyspace (R3.4(a)'s whole argument). |
| Congregation clerk of session | Publish an SASR snapshot to the presbytery | — | **Not live.** `presby_publish_sasr_snapshot()` and `presby_list_own_congregation_publications()` have **zero application callers** — I grepped `src/app` and `src/lib` and found the functions referenced only in `src/lib/presbytery.test.ts` (comments) and the migration itself. The work-log's Surface line claim ("the org portal's statistics page calling `presby_publish_sasr_snapshot()`... must keep working unchanged") is **not currently true** — there is no shipped consumer to protect. Treat the signature-stability requirement as protecting a *named future pipeline* (Increment 4a), not a live user, which lowers the blast radius of a mid-flight signature change but does not remove the obligation. |
| Platform operator | Provision a congregation under a presbytery | one-time per org | **No write path exists.** `createOrganization()` (`src/lib/org-provisioning.ts:159-288`) always inserts `parentId: null`/root orgs. The one real parent/child relationship in production (`fpcw` under `presbytery-of-scioto-valley`, per `docs/STATE.md`'s 2026-08-31 handoff) and every hierarchical fixture in `scripts/seed-dev.sql` (e.g. line 30-40) were established by a **raw SQL `parent_id` value on INSERT**, never through the app. D19 locks this exact pattern down (`parent_id` becomes trigger-derived, direct `UPDATE` rejected) without providing a replacement write path — see Gaps below. |
| Presbytery stated clerk / synod stated clerk | Record a lifecycle event, an affiliation, run an import | — | **Future pipelines**, correctly out of scope here — but the schema is what will make or break them, which is the point of the five-pass review even with no UI. |
| PSV importer script | Resolve a quarantined row, possibly minting a historical org | — | **Future pipeline** (explicitly out of scope: "the PSV import itself"). The *table* for this ships now; the *write path* it will need does not exist and isn't grant-compatible with today's tenant role — see Gaps #6. |

## Flows

**Flow 1 — Congregation publishes its annual statistics (future pipeline, schema built now):** entry (a not-yet-built "Publish" button on `/o/<slug>/admin/reports` for a `congregation`-type org, or a form calling a not-yet-built action) → clerk reviews the projection → clerk attests and submits → `presby_publish_sasr_snapshot()` (rewritten) writes `statistical_returns` → `publications` → `congregation_statistics` in one transaction → outcome: presbytery sees a new row via `presby_list_own_congregation_publications()`-equivalent, congregation sees confirmation.
- Failure: report year out of range, a count out of bounds, no parent org, parent not a presbytery — all four already raise named `plpgsql` exceptions in the current function and should map to human copy exactly as `setCongregationStatisticsAction` does today (`"That congregation doesn't belong to this presbytery."` style). Not this pipeline's job to write that copy, but the exception vocabulary is being redesigned now and future Phase 3/4 work needs it stable.
- **New failure mode this retrofit introduces and the design doesn't name:** once the recipient reads back through `publications.artifact_id → statistical_returns`, does the *read* succeed? `statistical_returns` is owned (`organization_id`) by the submitting congregation for `provenance = 'submitted'`. Ordinary `tenant_isolation` RLS on that table means the **presbytery cannot `SELECT` it directly** — only the submitting congregation's own context can. §5 never specifies a read mechanism for the recipient side of a publication once the artifact moves off `congregation_statistics`. This is a functional gap, not a hypothetical: the presbytery's `presby_list_own_congregation_publications()`-equivalent function returns `congregation_statistics` rows fine (that stays a presbytery-owned typed keyspace per R3.4(a)), but any future feature that needs the *original submitted payload* (audit, dispute resolution, "show me exactly what was attested") has no read path named. **Needs a SECURITY DEFINER function analogous to the existing pair, filtering `publications.recipient_org_id = presby_current_org()` and joining to the artifact server-side**, or an explicit statement that recipients only ever see the `congregation_statistics` projection and never the raw artifact.

**Flow 2 — Synod redistricts a presbytery's congregation (D19's own headline scenario):** entry: synod stated clerk records a redistricting → step: close the congregation's existing affiliation to Presbytery A, open a new one to Presbytery B → outcome: `parent_id`/`path` flip, future publications route to B, archive queries for years before the change still resolve to A.
- **Failure this flow cannot currently take, at all.** The existing open affiliation row (`organization_id` = Presbytery A) is owned by Presbytery A's own tenant context under the design's stated mechanism ("council-owned rows... FORCE RLS, ordinary tenant policy," R3.7). Ordinary `tenant_isolation` RLS is `organization_id = presby_current_org()` on both read *and write*. **The synod's session context is never Presbytery A**, so the synod cannot `UPDATE` (close) Presbytery A's row to make room for the new one — and it cannot `INSERT` the new row as if it were Presbytery A either, for the same reason. The exclusion constraint (correctly, defensively) also blocks Presbytery B from unilaterally inserting an overlapping open range naming itself while A's is still open. **Net effect: the schema as specified structurally cannot execute the one scenario D19 was written to enable**, unless a SECURITY DEFINER function (the `presby_publish_sasr_snapshot()` shape, but for affiliation transfer) is added — closing the old row and opening the new one atomically, on behalf of whichever council legitimately holds authority. This belongs in Phase 3's design, not deferred silently; it is core to D19, not a nice-to-have.

**Flow 3 — Presbytery records a congregation's dissolution:** entry: presbytery clerk records `event = dissolved`, `subject_org_id = <congregation>` → the trigger sets the lifecycle cache and closes the open affiliation → outcome: `lifecycle_status = dissolved`, slug frozen forever, archive still resolves.
- Failure not addressed: nothing in the design constrains `organization_id <> subject_org_id`. A presbytery could record `subject_org_id = itself` (self-dissolution with no synod act at all), which is the self-targeting case Pass 5 exists to catch — G-3.0301(c) is about the presbytery acting on *congregations*, and a presbytery cannot constitutionally dissolve itself. Needs a `CHECK (organization_id <> subject_org_id)` at minimum, and ideally a type-hierarchy check mirroring the one already named for affiliations (presbytery → congregation/NWC, synod → presbytery, GA → synod) applied to lifecycle events too.
- Also unaddressed: `organization_successions` names no cardinality enforcement per event type beyond `predecessor <> successor`. Nothing stops a `divided` event from having zero successor rows, or a `merged` event with one predecessor and one successor (indistinguishable from a bad `dismissed`). This is D10's whole reason for having a topology table instead of a status column — the topology needs its own trigger-checked shape, not prose.

## Permissions & Flags

- **Permission(s):** none new for the DDL itself, confirmed by the work-log. Existing `statistics.manage` (0038, `presbytery.ts`) and `statistics.publish` (seeded fixture-only, per 0038's header comment) stay as the gates on the rewritten publish function's *caller*, but the function itself remains the trust boundary (F26) regardless of the catalog key — correctly unaffected by this pipeline.
- **Default roles:** unchanged — `presbytery_stated_clerk` template binds `statistics.manage`/`per_capita.manage`; `stated_clerk` (congregation) binds `statistics.publish` per fixture only, no production role-auto-provisioning path yet (0038's own header note). Worth flagging for Phase 3: this pipeline is the natural point to also seed `lifecycle.record`/`affiliation.record`-shaped permission keys for the presbytery/synod, even with no UI yet, so a later pipeline isn't retrofitting a catalog entry onto tables that already exist unlabeled. Not doing so isn't wrong, but it's a decision, not a non-decision — name it.
- **Flag(s):** correctly "not needed" — nothing member-visible changes. Agreed.

## Gaps the Request Didn't Address

- **Production-data premise is unverified and probably wrong.** The work-log states `congregation_statistics` "has real published rows in production (FPCW under Presbytery of Scioto Valley)." `docs/STATE.md`'s 2026-08-31 session handoff says production currently holds exactly two organizations (`fpcw`, `presbytery-of-scioto-valley`) and that **nobody can sign into production at all** (Google OAuth unconfigured). Combined with the finding above that `presby_publish_sasr_snapshot()` has never been called from application code, there is almost certainly **zero rows with `provenance = 'published_by_congregation'` in the live production database today.** Resolution: before database-admin writes the backfill, run `select count(*) from congregation_statistics where provenance = 'published_by_congregation'` against the actual `production` branch (`polished-snow-90038485`) and record the number in the work-log — don't let the migration's safety story rest on an assumption that turned out checkable in five minutes. This doesn't lower the bar for the backfill's correctness (the *next* pipeline that ships the publish UI will produce real rows fast), it just means the transactional-verification step described below has almost nothing to lose today and everything to prove for next month.
- **No write path exists for the redistricting scenario D19 is designed around** (Flow 2 above). This needs a named SECURITY DEFINER mechanism in Phase 3's design, analogous to `presby_publish_sasr_snapshot()`'s shape, or the affiliation table's ownership model needs to change (e.g., affiliation rows owned by a neutral registrar concept rather than "whichever council is acting" — but that reopens R3.7's own reasoning). Not resolvable by Phase 1; must be resolved by Phase 3, before Phase 4 writes the trigger.
- **`organizations` grants `presby_app` `SELECT` only** (`drizzle/0009_presby_rls.sql:93` — confirmed no `INSERT`/`UPDATE`/`DELETE` grant exists anywhere in `drizzle/`). Two consequences the design doesn't name:
  1. The affiliation trigger that maintains `parent_id`/`path` (§3, correctly specified as `SECURITY DEFINER`) is not just satisfying F26's cross-org-read reasoning — it is *structurally required* because the calling role (`presby_app`, a presbytery's own tenant context) has no grant to write `organizations` at all, cross-org or same-org. Worth stating explicitly so Phase 3/4 doesn't skip `SECURITY DEFINER` on the **lifecycle-status cache trigger** under the mistaken belief that "it's not cross-org, so it doesn't need it" — it does, for the same grant reason.
  2. D13's own stated goal ("resolution can create a `dissolved` organization," §2a) has **no write path at all** under the current grant model — a presbytery's own tenant connection cannot `INSERT` into `organizations` under any circumstance today. This is out of scope for *this* pipeline (the PSV import execution is explicitly excluded), but the staging tables being built now imply a capability that will need its own `SECURITY DEFINER` "create historical org" function in whatever future pipeline executes import resolution. Flag now so it isn't rediscovered as a surprise later.
- **Test-fixture regression risk from the about-org trigger (R3.14, migration step 3).** Several already-shipped test files create organizations with `parent_id` set directly on `INSERT` — `scripts/seed-dev.sql:30-40`, `scripts/test-rls.sql`'s inline "Presbytery of the Western Basin" fixture (~line 2153), and `presbytery.test.ts`'s `presbyteryB`/`congOutsideB` fixtures. R3.6's stated guard is a `BEFORE UPDATE OF parent_id` trigger — it says nothing about `INSERT`, so these direct inserts will still succeed at the DB level, but they will **not** create a corresponding `organization_affiliations` row. Once step 3 lands `presby_org_affiliated()` and its enforcing trigger on the five existing about-org tables (`congregation_oversight`, `congregation_statistics`, `per_capita_rates`, `per_capita_records`, and whichever officer/credentials table already uses the pattern), every one of these ad hoc fixtures will start failing an about-org check that used to pass on `parent_id` alone. This is a concrete, multi-file regression, not a hypothetical — Phase 3 needs to name the fixture-migration work as part of the implementation order (rewrite every direct-`parent_id` fixture insert to also insert the matching affiliation row), not leave it for QA to discover as a surprise pile of red tests.
- **`sasr_reports`' fate (§10 Q8).** Recommend **drop**, contrary to keeping it as a working draft. Grepped for consumers: zero. `src/lib/dev-docs.ts` only reads the schema for the `/developer` reference page; no route, action, or test reads or writes `sasrReports`. Its current shape (`status: draft | session_approved | submitted`, mutable `payload`) is already stale under D25 even if kept, and "keep a real table around with no consumer and a known-wrong shape" is exactly the "second source of truth" pattern this document warns against elsewhere (R3.2). If a future pipeline wants a working-draft UI, it can design one against the *current* rules rather than inherit an unused, pre-round-2 shape. This is explicitly punted to Phase 3 by the design doc ("Decide in the DDL pipeline's Phase 3") — recording my recommendation as input, not overriding it.
- **The fixture-deletion exemption (§10 Q7).** Recommend **against** `platform_status = 'fixture'` — it would mix a *test-lifecycle* concern into the column that exists to answer D9's tenant-participation axis (`managed`/`unmanaged`/`invited`), which is precisely the orthogonal-axes discipline this whole document argues for elsewhere. Recommend a dedicated `deletable_until timestamptz` column instead, set only by test-provisioning helpers, checked by the `BEFORE DELETE` guard (`deletable_until is not null and deletable_until > now()`, so a stale marker doesn't grant permanent deletability). Note for the record: this doesn't fix the *other* open bug it's tangled with (`docs/TODO.md`'s unreliable-teardown / no-per-test-isolation item) — that's a test-infrastructure fix, tracked separately, and this pipeline should not silently absorb it.
- **`relationship_type` has no value for a `new_worshiping_community`'s affiliation**, even though §3's own prose says "parent type must fit child type (congregation and NWC → presbytery...)". The enum lists `member_congregation | member_presbytery | member_synod` only. Either NWCs affiliate under `member_congregation` (state that explicitly — it reads oddly given `organization_type` treats them as distinct) or add `member_nwc`. Small, but the kind of thing that becomes a silent CHECK-constraint gap if left implicit.
- **`btree_gist` is not actually a new-extension risk** — worth correcting the round-3 review's framing rather than treating it as an open risk. `create extension if not exists btree_gist;` already ships in `drizzle/0009_presby_rls.sql:471` (the `officer_terms` exclusion constraint) and is re-issued idempotently in `drizzle/0039_presby_staff_and_personnel.sql:120`. It is proven twice on this exact Neon setup, including under `MIGRATE_DATABASE_URL` in production-path migrations. The genuine historical extension-adoption slip the review cites (`path` designed as `ltree`, built as `text`) is a different extension and a different failure (nobody ever ran the migration, not that Neon rejected it) — don't let that precedent inflate `btree_gist`'s actual risk, which is near zero.
- **Book of Order vocabulary — I could not independently verify.** I have no web access in this role; the architect agent does. Forward G-3.0301(c)/G-3.0107's citations for a real verification pass in Phase 2 rather than taking round 3's self-reported "verified 2026-09-24" at face value a second time.

## Out of Scope (confirm with user)

- D22 (person-merge provenance), D23 (care grants), any UI, the D16 grant's unauthenticated endpoint, the PSV import execution itself — all correctly named in the work-log's Scope line. Confirmed consistent with what's actually buildable this pipeline (e.g., D13's staging tables can ship with no write path for import execution, since that's a separate future pipeline; the "create historical org" gap above is a note for *that* future pipeline, not a blocker here).
- Rewiring `scripts/seed-dev.sql` to stop setting `parent_id` directly and instead seed through `organization_affiliations` — this is *in scope* per the work-log's Surface line, but I want it named explicitly as its own implementation-order line item (not folded silently into "step 2's backfill"), because it's a different kind of edit (rewriting ~10+ organization-fixture blocks across `seed-dev.sql` and several `*.test.ts` files) than a one-shot production backfill.

## Open Questions

- Who besides the presbytery has write access to `organization_lifecycle_events`/`organization_affiliations` for a **synod-owned** act (redistricting, or a synod dissolving a presbytery)? Same question, one level up — does a `general_assembly`-type org ever act on a `synod`? The design's prose says "presbytery, synod, or GA" can be the acting council but only ever illustrates the presbytery-on-congregation case.
- Does the platform operator need an interim, explicitly-logged escape hatch (through `getPlatformDb()`, bypassing tenant RLS entirely, the way `createOrganization()` already does) to seed a NEW org's initial affiliation until a real write path exists — or is "no new hierarchical org can be provisioned until a follow-up pipeline ships the write path" an acceptable, stated consequence of this pipeline? I'd rather this be a deliberate answer than a discovered one.
- Confirm with the operator: should the production-published-rows count (see Gaps) be checked *before* Phase 2 proceeds, given it changes how cautiously database-admin needs to treat the backfill?

## Orchestrator addendum (2026-09-24, verified against the `production` branch `br-wild-band-ax96gv09`)

The analyst's suspicion is confirmed by query, not assumption:

| Table | Production rows |
|---|---|
| `congregation_statistics` (any provenance) | 0 |
| `sasr_reports` | 0 |
| `organizations` | 2 — one presbytery (root), one congregation under it |

So the `congregation_statistics` retrofit and the `sasr_reports` drop have nothing to lose in production today. The backfill still has to be correct and proven on the `development` branch (`br-super-dawn-axfi55p6`, where the seed and the DB-backed suite create published rows), because the next publish-UI pipeline will produce real rows quickly. The Surface line's "must keep working unchanged" now reads as protecting the two live consumers the analyst identified (`setCongregationStatisticsAction` and the per-capita reads) and the *future* publish caller's contract, not a live publish path. `btree_gist` confirmed installed at 1.8 on the development branch and created by `drizzle/0009`.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-24. The four `docs/decisions.md` entries the architect proposed (DECISION-135–138) are recorded in that file.*

## Verdict

**Approved with suggestions** — with eleven rulings below that are **binding on Phase 3**, not advisory. The feature shape is right, so this does not loop back to Phase 1; where the design authority (`docs/schema-design-2.md` §2b/§5) is wrong, I rule the resolution here and tech-lead corrects the document in Phase 3 (CLAUDE.md Phase 2 loop-back clause: "otherwise the architect documents the resolution and advances").

Four of the rulings exist because I read the **live database**, not just `drizzle/`. The most important finding in this review is that the grant model this design's central mechanism rests on does not currently hold in the database, and the analyst's Gap #3 — which read the migration — has it exactly backwards.

---

### Ruling 1 (a) — The redistricting write path: a DEFINER function, council ownership retained, and the affiliation table's DML revoked

**Mechanism: `presby_transfer_affiliation()`, the `presby_publish_sasr_snapshot()` shape. Not a registrar. Not a bespoke policy.**

D26's council ownership is correct and stays: `reason`, `minute_reference` and `notes` on an affiliation row are genuinely the acting council's records, and a "registrar" owner would either need a synthetic tenant (a fourth axis) or make the minute text world-readable on a table with a public grant — the exact hazard `docs/work-log/2026-08-19-brand-foundation.md:360` names for putting tenant data on `organizations`.

But council ownership means **every** cross-council touch of an affiliation goes through a function. The design already concedes this twice for reads (`presby_org_affiliated()` DEFINER; the "public projection view of (subject, parent, from, to)"). It has to concede it for writes too. So, as a rule rather than case-by-case:

> **Cross-council access to the three-axis tables is function-mediated, never policy-mediated.**

Concretely, for `organization_affiliations`:

- **Revoke `insert, update, delete` from `presby_app`.** `select` only, plus the public projection view. The DEFINER function becomes the *only* write path. This is not belt-and-braces — see Ruling 4.
- `presby_transfer_affiliation(p_subject_org_id, p_new_parent_org_id, p_relationship_type, p_effective_on, p_reason, p_minute_reference)`. **It accepts no acting-council id**, in the strengthened confused-deputy form `drizzle/0038_presby_presbytery_program.sql:376-380` already established: the actor is `presby_current_org()`, already membership-verified by `withOrgContext()` before the function is reachable.
- **Standing is verified from the affiliation history itself**, not from `organizations.path`/`parent_id` — those are the derived cache this same transaction is about to rewrite, so reading them as the authority is circular. The actor must be the current parent, the incoming parent, or a council above both in the affiliation graph as of `p_effective_on`. For a true redistricting (two different parents), the actor must be the **common superior** — which is the polity rule, not a modeling convenience: G-3.0403(c) gives the synod the act, and G-3.0502(e) gives the GA the approval.
- Close and open **in one function body**, then rebuild the subtree (Ruling 2's single function). Uniform error text on every rejection — see Ruling 4.

**Who owns the closed row, and who reads it.** Ownership is **provenance and never changes**. A closed row keeps the `organization_id` of the council that recorded it; re-owning it to the closing synod would rewrite who acted in 1994. The close is therefore a DEFINER write into *another council's* tenant space — which has a direct precedent: `presby_publish_sasr_snapshot()` already writes a presbytery-owned row from a congregation's context (`drizzle/0038:396-404` explains why `SECURITY DEFINER` is load-bearing for exactly that). To keep the closing act attributable, the row carries **`closed_by_org_id`, `closed_by`, `closed_on`, `closed_minute_reference`** (nullable, written only by the function). The row then reads: *Presbytery A recorded this affiliation; the Synod closed it on 2027-01-01 per minute X.* Without those four columns the close is an unattributable mutation of an otherwise provenanced record, which is the thing D10 and D19 both exist to prevent.

Archive attribution reads closed rows regardless of owner via `presby_org_affiliated(subject, council, as_of)` plus a companion `presby_affiliation_parent_as_of(subject, as_of)` — both DEFINER, both bounded to the public-projection columns.

**Does this add a third named cross-org RLS policy under §17? No.** Nothing here is a policy. It is the existing "controlled read/write through a DEFINER function" idiom — `presby_match_person()`, `presby_membership_is_active()`, `presby_user_organizations()`, `presby_publish_sasr_snapshot()`, `presby_list_own_congregation_publications()`. §17's two-named-policies rule (`person_links`, `transfer_certificates`) is untouched, and DECISION-112's refusal of a third stands.

### Ruling 2 (b) — The `organizations` grant model: the premise is currently false in the database

The analyst wrote (Gap #3): "`organizations` grants `presby_app` `SELECT` only (`drizzle/0009_presby_rls.sql:93` — confirmed no `INSERT`/`UPDATE`/`DELETE` grant exists anywhere in `drizzle/`)." The first half is right about the repo. **The database says otherwise.** Queried against the development branch:

```
presby_app|DELETE
presby_app|INSERT
presby_app|SELECT
presby_app|UPDATE
```

`organizations` has `relrowsecurity = f` and `relforcerowsecurity = f` and **no triggers at all**. So today the tenant connection can insert, reparent, restatus or delete *any* organization row, with no RLS and no trigger in the way. No application path does it — every write goes through `getPlatformDb()` — but the database-level guarantee this entire design leans on does not exist.

**Mechanism of the drift:** `drizzle/0009:93`'s `grant select on organizations to presby_app` is *additive*; it never revoked anything. A blanket `grant ... on all tables ... to presby_app` (needed and correct for the platform tables — `src/auth.ts:79` runs the NextAuth Drizzle adapter on the `db`/`presby_app` connection, so `users`/`sessions` genuinely require DML) swept `organizations` in with them. Only `people` was ever explicitly clawed back (`drizzle/0009:376`, the sole table-level revoke in the whole `drizzle/` tree).

**Rulings:**

1. **Confirmed, but you must *make* it true, not assume it.** The migration for increment 2 issues `revoke insert, update, delete on organizations from presby_app;` and `scripts/test-rls.sql` asserts the grant shape directly — the same proof shape section 29 already uses for the four presbytery tables (`scripts/test-rls.sql:2118-2126`). Until that revoke lands, "the trigger must be DEFINER for grant reasons" is a statement about a migration file, not about the database.
2. **After the revoke, yes — every trigger that writes `parent_id`, `path` or `lifecycle_status` must be `SECURITY DEFINER` for grant reasons, independently of F26.** State that in the migration comment. DECISION-121's own warning applies in reverse here: *"the migration comment says so, or the next reader adds DEFINER as cargo cult"* — here the risk is the opposite, a reader omitting DEFINER on the lifecycle-status trigger because "it isn't cross-org."
3. **One DEFINER function, not derivation logic inside each trigger.** `presby_apply_affiliation_to_org_tree(p_subject_org_id, p_as_of)` owns `parent_id`, `path`, and the recursive subtree path rebuild; the affiliation trigger and the lifecycle trigger both call it. Tested once, in one `test-rls.sql` section. The subtree rebuild is the single most likely thing in this pipeline to be subtly wrong (`deriveOrgPath` handles roots only today), and it must not exist in two copies. The `BEFORE UPDATE OF parent_id, path` guard on `organizations` checks a GUC that function sets with `set_config(..., true)` (transaction-local — a session-scoped GUC here would leave the guard disarmed for the next request on a pooled connection, the same hazard `src/lib/db/index.ts` documents for `app.current_org_id`).

### Ruling 3 (c) — Provisioning, backfill, and direct `INSERT ... parent_id`

**Provisioning: extend `createOrganization()` now; the presbytery-callable DEFINER function is a named follow-up.** `src/lib/org-provisioning.ts:159-288` is already the single write path for `organizations` — it owns the reserved-slug check, the TOCTOU retry, path derivation, group seeding and baseline roles — and it runs on `getPlatformDb()`, which the Ruling-2 revoke does not touch. Add optional `parentOrganizationId` / `relationshipType` / `effectiveFrom`, and insert the `organizations` row **and** its initial affiliation row in the same `platformDb.transaction()`. The affiliation row's owner (`organization_id`) is the parent council; `recorded_by` carries the platform operator's user id, so "the presbytery organized it, the operator recorded it" is legible and not a lie. This closes the analyst's second Open Question with a deliberate answer: hierarchical orgs remain provisionable on day one.

A presbytery-callable `presby_organize_congregation()` is **deferred**, named, and belongs to the pipeline that ships the lifecycle UI — which is also the pipeline D13's import resolution needs it for (the analyst's Gaps #3.2). Build it once, there, not twice.

**Backfill `effective_from`: unbounded below, flagged.** This is the ruling I most want Phase 3 not to skip. Backfilling the one production relationship (and every dev fixture) with `effective_from = now()` or `created_at` asserts that FPCW joined Scioto Valley on the migration date — and then `presby_org_affiliated(subject, council, as_of => 1987)` answers **false** for every row of the 41-year PSV archive, i.e. the about-org trigger from increment 3 blocks the import that increment 7 exists to enable. Ruling: **`effective_from` is nullable, and null means unbounded-below ("predates our records")**; `daterange(null, effective_to, '[)')` is unbounded-below and the EXCLUDE constraint still guarantees at most one such row per `(subject, relationship_type)`. Add `authority = 'backfill'` (or an `is_inferred boolean`) plus a CHECK that `minute_reference` may be null **only** when the row is a backfill — so an inferred relationship can never be mistaken for a minuted act. When the import later discovers a real 1995 transfer, splitting the unbounded row is an ordinary affiliation change.

**Direct `INSERT ... parent_id`: reject. Do not auto-create.** Auto-creating an affiliation row on insert would have to invent three facts it cannot know — the owning council, the effective date, and the authority — and would silently mint minute-less affiliation rows. That is D19's "second source of truth" arriving through the back door, and it makes `parent_id` a write target again, which is invariant 3 of D19.

The analyst's "multi-file regression risk" is real but much smaller than framed, and the reason is the refinement that makes this ruling cheap: **reject on `INSERT` only when `parent_id is not null` and the affiliation-trigger GUC is absent.** Root-org inserts stay legal. I enumerated the actual blast radius:

- `scripts/seed-dev.sql:30` — one block, three of four rows carry `parent_id`.
- `scripts/test-rls.sql:1997`, `:2155`, `:2322` — three inline org inserts; `:2322` is the only one with `parent_id` (the synod/orphan-chapel fixture), and **all three additionally break on Ruling 2's revoke** because the suite runs as `presby_app` (`scripts/test-rls.sql:1`). They must move to the owner connection or gain a seeded affiliation. Note the comment at `:1992-1995` — *"organizations carries no RLS of its own … so this insert is legal"* — is legal today only because of the drift.
- `src/lib/credentials.test.ts:128` and `src/lib/presbytery.test.ts:122` — the two hierarchical test helpers.
- The ~20 other `platform.insert(organizations)` fixtures (`src/lib/groups.test.ts:132` and siblings) create **root** orgs and are unaffected.

Five files. Name them as an explicit implementation-order line item in Phase 3, as the analyst asks.

### Ruling 4 (new — F40) — An EXCLUDE constraint on a FORCE-RLS table is a cross-tenant existence oracle

Nobody has named this and it changes the grant decision in Ruling 1 from hygiene to necessity. Unique and exclusion constraints are enforced against **all** rows, not the RLS-visible subset. So if `presby_app` keeps ordinary tenant DML on `organization_affiliations`, Presbytery B can probe `insert (subject => <any org id>, parent => itself, from => …)` and learn from the constraint-violation error whether that organization currently has an open affiliation *anywhere* — a row B cannot see. That is DECISION-047's enumeration-oracle class, arriving through a constraint instead of a page.

Revoking DML (Ruling 1) closes it: the DEFINER function is the only writer, it checks standing first, and it raises **one uniform message** for every rejection rather than letting a constraint error surface. Phase 3 must specify that error text, and `test-rls.sql` must prove the probe returns the same message (and, per DECISION-040's byte-identical discipline, does not vary by whether the subject exists).

### Ruling 5 (d) — Recipient read-back ships in this pipeline, and the retrofit is narrower than R3.4(a) says

**Yes, it ships — increment 5, existing controlled-read idiom.** `presby_list_published_returns_to_me(p_about_org_id uuid default null, p_year integer default null)`: `SECURITY DEFINER`, `stable`, filtering internally on `publications.recipient_org_id = presby_current_org() and withdrawn_at is null`, joining to `statistical_returns`. Exactly `presby_list_own_congregation_publications()`'s shape (`drizzle/0038:665-690`), mirrored to the other side. Without it D20's "a recipient council reads the artifact published to it" is unenforceable in the permissive direction — the recipient simply cannot read — and Phase 6 would be judging a publication mechanism with one half absent.

The polity backs filtering on **the publication, not on live affiliation**: G-3.0107 says a council's records "become the property of the next higher council" when it ceases to exist. A presbytery must still read a dissolved congregation's returns *after* dissolution, which a read gated on a current affiliation would not permit.

**Now the part R3.4(a) gets wrong.** §5 says move `supersedes_publication_id`, `published_at` **and `minute_reference`** off `congregation_statistics` to `publications`. Two of those three break shipped code:

- **`minute_reference` must stay.** `src/lib/presbytery.ts:637` writes it on `provenance = 'presbytery_entered'` rows (`:664`), and `src/app/(org)/o/[slug]/admin/reports/statistics-schema.ts:22` makes it a **required** form field on the live presbytery-entry surface. A `presbytery_entered` row has no publication to hold it. These are two different minutes by two different councils — the presbytery's minute for its own entry, and the congregation's session minute authorizing publication. Keep `congregation_statistics.minute_reference`; give `publications` its own. Collapsing them is the one-column-two-facts error the design refuses everywhere else.
- **`published_at` must stay, as a frozen projection copy.** `src/lib/presbytery.ts:522` orders on it and `:533-539` uses it to pick the current row per congregation. Moving it into `publications` puts it in a table the **presbytery cannot read** — `publications.organization_id` is the source congregation — so the shipped rollup and the per-capita basis-year lookup would each have to become a DEFINER join. The projection is *allowed* to carry the event's facts; that is what a projection is. Drift is structurally impossible here, unlike F29's `current_roll`: both rows are written by one DEFINER function in one transaction and neither is ever updated (the `congregation_statistics_freeze` trigger, `drizzle/0038:286-296`, already guarantees the second half). Add a `test-rls.sql` assertion that every published row's `published_at` equals its publication's.
- **`supersedes_publication_id` moves** — grep finds no reader outside a comment (`src/lib/presbytery.ts:55`). The chain is genuinely a publication concern.

So the retrofit is: `+ publication_id`, `− supersedes_publication_id`, keep `published_at`, keep `minute_reference`. Note also that `presby_list_own_congregation_publications()` returns `setof congregation_statistics`; its row type follows the table, so no drop/recreate is needed at the database, but any TypeScript reader of the dropped column breaks at compile time (which is the desired failure mode).

### Ruling 6 (e) — `sasr_reports`: drop

Agreed with the analyst, and with one more data point: **zero rows on the development branch** as well as production. Zero consumers (`src/lib/dev-docs.ts` reads it only as schema). Its shape is stale under D25 — `status: draft | session_approved | submitted` and a mutable `payload` with `$onUpdate` (`src/lib/db/domain/reporting.ts:47,54,60`). Drop it in increment 5; remove it from `drizzle/0009`'s `tenant_tables` array (`:72`) and from the domain module.

**Say out loud what drops with it:** the congregation has no staging surface between "compute the projection" and "attest and freeze." That is a real need and it returns as a **design question owned by the publish-UI pipeline**, to be answered against D25's rules rather than inherited from a pre-round-2 shape. Record it in `docs/TODO.md` in the same commit (Workflow Rule 10) so it is a tracked absence, not a silent one.

### Ruling 7 (f) — The deletion guard: `deletable_until`, and the revoke is not a no-op

Agreed with the analyst against `platform_status = 'fixture'` — D9's axis is tenant participation, and polluting it would change the meaning of every `platform_status` query in `presby_user_organizations()` and the chooser. `deletable_until timestamptz`, guard predicate `deletable_until is not null and deletable_until > now()`.

Three additions:

1. **`revoke delete on organizations from presby_app` is required and is not defensive decoration** — the live grant includes DELETE (Ruling 2). It is folded into the same revoke.
2. **The guard runs for the owner connection.** `PLATFORM_DATABASE_URL` connects as `neondb_owner`, which is `BYPASSRLS` — but RLS bypass does not bypass triggers, so a `BEFORE DELETE` trigger fires on the `getPlatformDb()` path. That is the path that matters (2026-08-31's 58-org cascade). It remains defeatable by `alter table … disable trigger`, deliberately and as an owner-only act.
3. **Set `deletable_until` at fixture *insert*, not at teardown.** `docs/TODO.md:293-295` records 15+ DB-backed test files that already wrap `platform.delete(organizations)` in disable/enable pairs, and the pattern has regressed twice. If the new guard forces a 16th disable into every one of those blocks, it will regress a third time. Have the fixtures' `makeOrg()` helpers stamp `deletableUntil` once, on insert, and the existing teardowns keep working untouched.

### Ruling 8 (g) — Lifecycle constraints, and they are stronger than `organization_id <> subject_org_id`

- **Not a CHECK — a trigger, and a stricter rule.** `organization_id <> subject_org_id` is necessary but weak. The real rule is that the **acting council is exactly one level above the subject**: presbytery → congregation/NWC (G-3.0301a), synod → presbytery (G-3.0403c), GA → synod (G-3.0502d). Both types live on `organizations`, so a CHECK cannot see them; it is a trigger, and it is the same trigger that enforces D19's parent-type-fits-child-type rule (one function, `presby_assert_council_authority(actor, subject)`, called from both tables).
- **GA approval is not a second event.** G-3.0502(e) makes the GA the *approver* of synod acts on presbyteries, not the actor. Model it as a nullable `concurrence_reference` on the event/affiliation row; do not widen the actor rule to admit the GA as an actor on a presbytery. Strict now; relax with evidence.
- **Succession cardinality is a `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`**, and the design must say so — `merged` needs ≥2 predecessor rows, which cannot be true at the moment the first row is inserted, so an immediate trigger makes the legal case unwritable. Rules: `merged` → ≥2 predecessors, exactly 1 successor; `divided` → exactly 1 predecessor, ≥2 successors; `dissolved`/`dismissed`/`organized`/`received` → 0 succession rows. Plus cheap row-level CHECKs: `predecessor <> successor`; `external_body` required for `received`/`dismissed` and null otherwise. A trigger asserts each named org is the event's subject or one of its counterparts.
- **`relationship_type` gains `member_nwc`.** The polity is decisive: G-3.0301(b) enumerates "fellowship groups, new church developments, and other non-congregational entities meeting within its bounds" **separately** from congregations. An NWC is constitutionally not a congregation, `organization_type` already distinguishes them, and overloading `member_congregation` would make "how many congregations does this presbytery have" — a live question for per-capita and for G-3.0301's commissioner-parity plan — return the wrong number.

### Ruling 9 (h) — Placement

- **`src/lib/db/domain/lifecycle.ts`** — `organization_lifecycle_events`, `organization_successions`, `organization_affiliations`. Council-owned acts; one file.
- **`src/lib/db/domain/publication.ts`** — `publications` alone. Its own module, deliberately: D20 defines it as generic over `record_class`, and it is the schema expression of the platform's second invariant ("access flows up by publication"). Parking it in a statistics module guarantees that the day a second record class lands, either the table moves file (churn in `/developer` and every import) or the module name lies. Small modules have precedent (`assets.ts` 91 lines, `events.ts` 104).
- **`src/lib/db/domain/returns.ts`** — `sasr_form_versions`, `statistical_returns`, `statistics_submission_grants`. This replaces `reporting.ts`, which contains nothing but `sasrReports` and empties out under Ruling 6; delete `reporting.ts` and its line in `src/lib/db/domain/index.ts`.
- **`organization_identifiers` and `organization_name_history` go in `org.ts`**, not a new module — both are organization *identity* (public, uncouncil-owned), sitting beside `organizations`/`organizationSettings`, mirroring how `person_identifiers` sits in `people.ts`. `org.ts` is 265 lines; this keeps it under 350.
- **`import_batches` / `import_rows` → `src/lib/db/domain/imports.ts`**, created in increment 7, not pre-created empty.
- Do not extend `presbytery.ts` (413 lines, already the largest domain module).
- **Migrations: `drizzle/0043`–`0049`, one file per §2b increment** (last existing is `0042_presby_public_directory_primitives.sql`). One file per increment, not fewer: each needs its own `test-rls.sql` section and its own revert story, and increments 5–7 are individually large. Suggested names: `0043_presby_org_identifiers`, `0044_presby_org_lifecycle`, `0045_presby_about_org_affiliation`, `0046_presby_statistical_returns`, `0047_presby_publications`, `0048_presby_submission_grants`, `0049_presby_name_history_import`.
- **Dependencies: none.** Evaluated against all five criteria and nothing new is needed. `btree_gist` is not an npm dependency and not a new extension — `drizzle/0009_presby_rls.sql:471` already creates it for `officer_terms_no_overlap`, `drizzle/0039:120` re-issues it idempotently, and the orchestrator confirmed 1.8 installed on the development branch. The analyst is right to deflate the round-3 review's framing here. `npm run check:deps-drift` stays green by construction.

### Ruling 10 (i) — Book of Order verification: two citations in the design authority are wrong, and `divided` is not congregation vocabulary

Verified against the full text of the 2023–2025 Book of Order (extracted from the [Shenango Presbytery printable edition](https://shenpres.org/wp-content/uploads/sites/81/2019/11/Book-of-Order-2023-2025-printable.pdf)), not a search-result paraphrase:

1. **The lifecycle vocabulary is G-3.0301(a), not (c).** Verbatim: *"provide that the Word of God may be truly preached and heard. This responsibility shall include **organizing, receiving, merging, dismissing, and dissolving congregations in consultation with their members**; overseeing congregations without pastors; …"* `docs/schema-design-2.md` §0a, §2 (D10) and §3 all cite **(c)**, and round 3 cross-checked it as "correct" — so the wrong subsection has now been verified twice. G-3.0301(c) is a different list entirely (*"ordaining, receiving, dismissing, installing, removing, and disciplining its members who are ministers of the Word and Sacrament"*) — and it contains something this pipeline actually needs: *"taking jurisdiction over the members of dissolved congregations and granting transfers of their membership to other congregations."* That is the polity basis for what happens to a dissolved congregation's roll, and it should be cited in §3's dissolution note. **Fix every G-3.0301(c) citation to G-3.0301(a).**
2. **G-3.0107 is *Records*, not the reviewing-council rule.** Verbatim: *"Each council shall keep a full and accurate record of its proceedings. … When a council ceases to exist, its records shall become the property of the next higher council within whose bounds the lower council was prior to its cessation."* The annual/biennial review is **G-3.0108(a), Administrative Review**. So R3.4's "the report goes to the presbytery of current membership (it is the reviewing council, G-3.0107)" should cite **G-3.0108(a)**. G-3.0107 remains a *better* citation for a different thing — the post-dissolution ownership of a congregation's records, which is precisely Ruling 5's argument for filtering the recipient read on the publication rather than on a live affiliation. Use both, correctly.
3. **`divided` is not in the congregational vocabulary.** "Dividing" appears in chapter three only for **presbyteries** (G-3.0403(c): *"organizing new presbyteries, dividing, uniting, or otherwise combining presbyteries or portions of presbyteries previously existing"*) and for **synods** (G-3.0502(d)). It is absent from G-3.0301(a).

   **Ruling: keep `divided`, with a stated divergence per §0a — and note that it is not really a divergence at all, it is a scope correction.** Congregations do divide in fact, and the existing argument (a single `merged_into_org_id` cannot express 1→N) stands. But the enum is not congregation-only: `merged` and `divided` applied to a *presbytery* are synod acts under G-3.0403(c), and to a *synod* are GA acts under G-3.0502(d) — which is exactly what Ruling 8's one-level-above trigger encodes. So §3 records: *"`divided` is our addition for congregations (G-3.0301(a) does not name it); for presbyteries and synods it is verbatim polity, G-3.0403(c) and G-3.0502(d)."* That single sentence converts an unexplained extra enum value into a documented, polity-grounded one.
4. **"New worshiping community" does not appear in the Book of Order** — the nearest constitutional language is G-3.0301(b)'s "new church developments … and other non-congregational entities." This is our vocabulary, and it supports Ruling 8's `member_nwc`.

### Ruling 11 (pre-ruling for increment 6) — Where the grant-submission endpoint lives

Increment 6 ships DDL only, which is fine, but the route-group question must be settled **before** someone places the endpoint, because the wrong placement is expensive to unwind and it is a brand-scope question as well as an auth one:

- The token-consuming submission page is a **public, token-consuming flow** — structurally `(password-reset)` and `(email-verify)`, not `(org)`. It gets its own route group (e.g. `(statistics-submit)`), the proxy does not require auth for it, and enumeration-safe responses apply.
- **It renders in the platform palette, not the congregation's brand** (DECISION-047). A branded submission page confirms to anyone holding a guessed or expired token that the named organization is a configured tenant. Logo-as-content on a neutral plate remains legal once the token has been verified.
- It is **not** an `api/admin/*` handler and carries no `FEATURES.*` gate — the token is the credential. That makes it the first write path in the platform with no `session`, which is why §6 is right that it needs its own security review, and why `check:audit`'s expectations for it must be settled in that pipeline rather than assumed.

---

## Placement

- **Directory placement:** `src/lib/db/domain/lifecycle.ts` (new), `src/lib/db/domain/publication.ts` (new), `src/lib/db/domain/returns.ts` (new, replaces `reporting.ts`), `src/lib/db/domain/imports.ts` (new, increment 7 only); `organization_identifiers` and `organization_name_history` extend `src/lib/db/domain/org.ts`; `src/lib/db/domain/reporting.ts` deleted with `sasr_reports`. Hand-written migrations `drizzle/0043_presby_*.sql` … `0049_presby_*.sql`, one per §2b increment. `src/lib/org-provisioning.ts` extended (Ruling 3). `scripts/seed-dev.sql` and `scripts/test-rls.sql` modified per Ruling 3's five-file sweep. No change under `src/app/`. Full ruling above (Ruling 9).
- **Server vs Client split:** not applicable — this pipeline ships no React. `'use client'` count: zero. No server actions and no route handlers are added, so there is no new `auth()` + `hasFeature()` surface for QA's feature-gate audit ("no protected routes touched"). The one live consumer that must keep working, `setCongregationStatisticsAction` (`src/app/(org)/o/[slug]/admin/reports/actions.ts:52`), is unchanged by Ruling 5's narrowed retrofit — which is a deliberate outcome of that ruling, not a coincidence.
- **Dependencies:** **none.** No new npm package is proposed and none is needed; evaluated against all five criteria and stopped at criterion 1 (already solved). `btree_gist` is a Postgres extension already installed and already used (`drizzle/0009:471`), not a dependency event. `npm run check:deps-drift` unaffected.

## Invariants Touched

- **Isolation Is a Database Property** — *respected, and materially strengthened.* Every new tenant table is `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy. Every cross-council path is a `SECURITY DEFINER` function with no caller-supplied council id (Ruling 1), never a policy — §17's two-named-policies rule is untouched and DECISION-112's refusal of a third stands. **This invariant is currently violated at the database for `organizations`** (Ruling 2 / F38): `presby_app` holds INSERT/UPDATE/DELETE on an un-RLS'd, un-triggered table. Increment 2 closes it with a revoke plus a `test-rls.sql` grant-shape assertion. F40 (constraint-as-oracle, Ruling 4) is a second, previously unnamed leak in the same family, closed by the same revoke.
- **Two Hierarchies Intersect Nowhere** — *respected, and this is the invariant the synod-acts-on-presbytery write path stresses hardest.* `presby_transfer_affiliation()` derives its actor from `presby_current_org()` and verifies standing from the **ecclesiastical** graph (the affiliation history), never from a platform claim. No platform predicate — `is_platform_admin`, `canAccessAdmin`, any `FEATURES.*` key — appears anywhere in the authority check. The synod's power over a presbytery comes from G-3.0403(c), and the function's one-level-above rule (Ruling 8) is that polity expressed as code. The testable companion form §2a promotes — *no platform role can acquire ecclesiastical authority merely by its position on the platform* — holds: a platform admin calling this function with no org context gets `presby_current_org() is null` and a raise, exactly as `drizzle/0038:485` already does.
- **Composite Tenant Keys (F2)** — *respected.* Every new tenant table declares `unique (id, organization_id)`; `publications.artifact_id` is composite to `statistical_returns (id, organization_id)`; `statistics_submission_grants.return_id` likewise. `subject_org_id`, `parent_org_id` and `about_org_id` are **plain** FKs to `organizations` and are correctly *not* tenant FKs — the structural exception §17 grants and `congregationOversight.aboutOrgId` already uses (`src/lib/db/domain/presbytery.ts:81`). Phase 3 must keep that distinction explicit in the column comments, because it is the one place a reader could "fix" a plain FK into a composite one and break the about-org pattern.
- **Never Hard-Delete a Person → an `organizations` twin** — *new, and it is a genuine extension of a CLAUDE.md invariant.* `delete` revoked from `presby_app`; a `BEFORE DELETE` guard on the owner path with a `deletable_until` fixture exemption (Ruling 7). The stated difference from the person rule is load-bearing and belongs in the same paragraph: **a person merge is followed, a congregation merge is not** — following `organization_successions` would attribute a predecessor's 1987 return to the successor, the mis-attribution D19 exists to prevent.
- **The Edge Gate Cannot Reach the Database** — *untouched.* Nothing in this pipeline is importable from `src/proxy.ts`; no new claim is projected into the session; all new authority checks are in-database by construction.
- **Extensibility Goes Through Support (D8)** — *respected, narrowly.* `statistical_returns.payload jsonb` is the single exception §9.5 permits, and it is only an exception if `sasr_form_versions.field_spec` is **trigger-enforced** (keys ⊆ spec, types, bounds). If that trigger ships as documentation, DECISION-118's allow-list property is lost and `payload` becomes the custom-fields escape hatch D8 refused. Treat the trigger as a gate on increment 4, not a nice-to-have.
- **Permissions vs Flags** — *respected;* no catalog key and no flag are added by the DDL. On the analyst's prompt to seed `lifecycle.record` / `affiliation.record` now: **do not.** A permission key with no enforcement point is a claim the catalog cannot keep, and DECISION-078's binding test cannot be run against a UI that does not exist. The correct record of the decision is a `docs/TODO.md` line, which Phase 3 should add. Name it as a decision, as the analyst asks — it is one.

**Does anything here require a `CLAUDE.md` change?** Yes, exactly one, at Phase 6 and not before:

> Under **Key Invariants → Never Hard-Delete a Person**, append: *"Organizations are permanent too. `delete` is revoked on `organizations` and a `BEFORE DELETE` guard covers the owner path; a congregation that closes is recorded as a lifecycle event, never removed. The one difference from the person rule: a person merge is followed (`merged_into_id` is a chain), a congregation merge is **not** — a predecessor's history stays attributed to the predecessor."*

Nothing else changes. The route-group rules, the `(org)` contract, Post-Login Landing, the brandable-group list and the Stack section are all untouched — Ruling 11's future route group is a note for that pipeline, not an edit today. Separately (not CLAUDE.md): `src/lib/dev-docs.ts`'s hand-maintained `INVARIANTS` array (`:317-370`) needs new entries for organization permanence, affiliation-derived `parent_id`, and publication-as-event, each with the right `"database" | "trigger" | "documented"` marker — that array is the `/developer` page's honesty mechanism and a new invariant absent from it is a paper invariant by default. And `docs/architecture.md` does warrant one paragraph at Phase 6 under Workflow Rule 15: the three-axis organization model plus publication-as-event is a new subsystem and a changed data flow, which is exactly the narrow case the rule admits.

## Notes

Phase 3 must honor, as a checklist:

1. **Rulings 1–11 are binding**, not suggestions. Three of them correct the design authority, so Phase 3 edits `docs/schema-design-2.md` (§0a/§2/§3 citations per Ruling 10; §5's column-move per Ruling 5; §3's affiliation column list per Ruling 1) rather than building from the text as written.
2. **Four new findings for the findings log** (F34–F37 are taken; these continue the sequence):
   - **F38** — `presby_app` holds INSERT/UPDATE/DELETE on `organizations` in the live database, contradicting `drizzle/0009:93`; the grant model this design rests on must be asserted by migration and proven by `test-rls.sql`, not assumed from the repo. Cause: `0009:93` is additive and a blanket platform-table grant swept `organizations` in; `people` (`0009:376`) is the only table ever explicitly clawed back.
   - **F39** — R3.4(a)'s retrofit removes `minute_reference` (written by `src/lib/presbytery.ts:637` on `presbytery_entered` rows, required by `statistics-schema.ts:22`) and `published_at` (ordered on at `src/lib/presbytery.ts:522`, used for provenance coalescing at `:533-539`) into a table the presbytery cannot read.
   - **F40** — a unique/EXCLUDE constraint on a FORCE-RLS table is a cross-tenant existence oracle; closed by making the DEFINER function the only writer.
   - **F41** — an affiliation backfill with a bounded `effective_from` makes `presby_org_affiliated(as_of => <report year>)` false for the entire 41-year archive, blocking the import the about-org trigger is meant to protect; the lower bound must be unbounded and flagged.
3. **Increment 3 is the riskiest step, and the reason is a coupling nobody has named.** `src/lib/presbytery.ts:143,169` and `src/lib/credentials.ts:522,710` answer "is X my member congregation?" with `organizations.parentId = organizationId`. After increment 3, the *trigger* answers the same question with `presby_org_affiliated()`. If those two disagree for even one row, the presbytery's own UI offers a congregation the database then refuses — a defect that surfaces as a user-facing error on a shipped page, not as a failing test. Phase 3 must state that `parent_id` remains the current-affiliation cache with a single derivation path (Ruling 2.3), and increment 2's backfill must be proven complete (`select count(*) from organizations where parent_id is not null` equals the count of open affiliation rows) **before** increment 3's trigger is created. That assertion belongs in the migration, not in a checklist.
4. **Increment ordering and work-log splitting.** 1→5 are tightly coupled and should stay in this work-log. 6 (submission grants) and 7 (name history + D13 staging) are separable; 6 in particular should be its own work-log because §6 is right that it wants its own security pass, and Ruling 11 already gives it a Phase 2 head start.
5. **The `test-rls.sql` sections this pipeline owes:** grant shape on `organizations` (F38), the affiliation write-path probe returning a uniform message (F40), the delete guard rejecting a seeded org and permitting a `deletable_until`-stamped one, `presby_org_affiliated()` answering correctly across a closed range (the 1990 case), the recipient read-back returning only publications addressed to the caller, and the `published_at` projection/publication equality check (F39). QA should expect these by name.
6. **Phase 1's unresolved items I am closing:** the production-row count is resolved by the orchestrator addendum (0/0/2, verified) — Phase 2 does not need it re-run. The analyst's two Open Questions are answered by Ruling 8 (who may act at each level, with citations) and Ruling 3 (yes, `createOrganization()` gets the write path now; no escape hatch and no stated foreclosure). The third question — whether to check production before proceeding — is moot.
7. **Not in scope and deliberately not ruled on:** D22, D23, any UI, the grant endpoint's implementation, the PSV import execution. Ruling 11 pre-places the endpoint but does not design it. `presby_organize_congregation()` and the "create historical org" DEFINER function are named as one function to be built once, in the lifecycle-UI pipeline, not two discovered separately.

**Handoff:** to **tech-lead** (Phase 3). The design authority is `docs/schema-design-2.md` §2b **as amended by Rulings 1, 5 and 10** — three of its statements are wrong and Phase 3 owns correcting the document, not just working around it. Phase 3 should name the implementer per increment (increments 1–5 read as **database-admin**; increment 6 wants its own work-log and its own security pass), decide the increment-to-work-log split the metadata block leaves open, and record F38–F41 in the findings log.

Sources for the polity verification: [PC(USA) Book of Order 2023–2025, full text](https://shenpres.org/wp-content/uploads/sites/81/2019/11/Book-of-Order-2023-2025-printable.pdf) (G-3.0107, G-3.0108(a), G-3.0301(a)/(b)/(c), G-3.0403(c), G-3.0502(d)/(e), read directly rather than via summary); [PC(USA), Organizing a Congregation](https://pcusa.org/sites/default/files/2026-01/Organizing_a_Congregation_Jan2026.pdf); [Presbytery of Cincinnati, Guidelines for Dissolving a Congregation](https://presbyteryofcincinnati.org/wp-content/uploads/2020/10/Dissolving-a-Congregation-Guidelines-for-the-AC-2018.pdf).

---

# Phase 3 — Technical Design (tech-lead)

*Design authority: `docs/schema-design-2.md` §2b/§3/§5, corrected in place per Phase 2
Rulings 1, 5 and 10 (the document corrections are done as part of this Phase — see
the diff to `docs/schema-design-2.md` and `docs/TODO.md`, both committed alongside
this work-log entry). This section specifies increments 1–5 only (0043–0047);
increments 6–7 (0048 submission grants, 0049 name history + D13 staging) are
confirmed as their own future work-logs per Phase 2 Notes item 4 — increment 6
because it needs its own security review (an unauthenticated write endpoint), and
increment 7 because it is separable and D13's import execution is out of scope
here regardless. **This work-log's Phase 4–6 cover increments 1–5 only.***

## Summary

We are giving `organizations` the three things the polity already has and the
schema does not: a permanent, minuted lifecycle (organized/received/merged/
divided/dismissed/dissolved, replacing an editable status column), a THIRD axis
of council affiliation with history (so "which presbytery received a 1990
return" and "which presbytery receives a 2026 one" go through the same
function), and a real publication mechanism for the SASR that a recipient
council can actually read back. The trigger for this pipeline is F30/F31 (roughly
half of PSV's 41-year statistical archive failed to import because `organizations`
has no memory of a church that closed, merged, or moved presbyteries) and F36
(publication is *already* half-built in `congregation_statistics`/
`presby_publish_sasr_snapshot()`, and this pipeline finishes it rather than
building a second, competing mechanism). Phase 2 found that the database
contradicts the design's own premise in two places (F38: `presby_app` already
holds full DML on `organizations`; F40: an EXCLUDE constraint on a FORCE-RLS
table is a cross-tenant existence oracle) and that two of round 3's own column
moves would have broken shipped code (F39) — this Phase corrects all of that in
the design authority and turns eleven binding architectural rulings into
buildable DDL, trigger, and function specifications. Nothing here is
member-visible; the one live UI consumer (`setCongregationStatisticsAction`) is
unchanged, and the one existing-but-uncalled function
(`presby_publish_sasr_snapshot()`) is rewritten behind its existing signature.

## Permissions & Flags

**No new `FEATURES` key, no new flag.** This pipeline ships DDL, triggers and
`SECURITY DEFINER` functions only — there is no route, server action, or React
component for a permission to gate or a flag to stage. The existing
`statistics.manage` / `statistics.publish` catalog keys keep gating
`setCongregationStatisticsAction` and (once a caller exists) `presby_publish_
sasr_snapshot()`'s application-layer entry point unchanged; the function itself
remains the trust boundary regardless of the catalog key (F26), which is
correct and unaffected by this pipeline.

**Deliberately not seeding `lifecycle.record` / `affiliation.record` yet**
(Phase 2's explicit ruling, confirmed here). A permission key with no
enforcement point is a claim the catalog cannot keep, and DECISION-078's
binding test — "does this key bind to a real constitutional office or role" —
cannot be meaningfully run against a UI that does not exist. `docs/TODO.md`
carries this as a named, deliberate deferral (not a silent gap) for the future
lifecycle/affiliation-recording UI pipeline, where `presby_transfer_
affiliation()` and lifecycle-event recording get a real caller and the
catalog entry can be tested against it honestly.

## API Contract

This pipeline's "API" is entirely SQL — hand-written DDL, triggers, and
`SECURITY DEFINER` functions in `drizzle/0043`–`0047`. No route handler, no
server action. One TypeScript extension (`createOrganization()`) is included
because Ruling 3 puts the hierarchical-provisioning write path in this
pipeline, not a deferred one.

### The uniform rejection message (Ruling 4 / F40)

Every rejection from the affiliation write path — missing org context, no
current affiliation found for the subject, standing check failed, parent-type
mismatch, malformed `relationship_type` — raises the **same literal string**
and the same errcode, regardless of cause, so a probing caller cannot
distinguish "you're not authorized" from "that organization has no open
affiliation" from "that id doesn't exist." This is DECISION-040's byte-identical
discipline applied to a function instead of a page:

```
'organization_affiliations: this change is not permitted'
```
`errcode = 'insufficient_privilege'`

Implemented as one small helper, `presby_deny_affiliation_change()` (raises the
string above and returns nothing — plpgsql functions that only ever raise can
be declared `returns void`), called from every rejection branch in
`presby_transfer_affiliation()` and from `presby_assert_council_authority()`'s
failure path, so the string exists in exactly one place in the codebase and
cannot drift between call sites. `scripts/test-rls.sql` must prove: (a) an
unauthorized actor's attempted transfer, (b) a transfer naming a nonexistent
subject org, and (c) a transfer where the subject has no open affiliation, all
raise the identical string — and, so far as a SQL-level test can show it, at
comparable cost (no early-exit fast path that only some of the three take).

### `presby_assert_council_authority(p_actor_org_id uuid, p_subject_org_id uuid) returns void`

`language plpgsql security definer`. Called from a `BEFORE INSERT` trigger on
both `organization_lifecycle_events` and `organization_affiliations` — one
function, not two copies (Ruling 8). Reads `organizations.organization_type`
for both ids (a public column, no elevated grant needed for the read itself;
`security definer` here is for consistency with the idiom and because it is
invoked from within other `security definer` contexts, not because the read
requires it). Validation: the acting council must be **exactly one level
above** the subject —

| Actor type | Subject type |
|---|---|
| `presbytery` | `congregation` or `new_worshiping_community` |
| `synod` | `presbytery` |
| `general_assembly` | `synod` |

Any other pairing (including `actor_org_id = subject_org_id`, and including a
`synod` acting on a `congregation` directly) raises via `presby_deny_
affiliation_change()`-equivalent text scoped to lifecycle
(`'organization_lifecycle_events: this change is not permitted'` — the
lifecycle table gets its own literal, since it is a different table and Ruling
4's oracle concern is specific to `organization_affiliations`'s EXCLUDE
constraint; the lifecycle table has no such constraint, so its own error text
may be slightly more specific without reopening F40, but must still be
`errcode = 'insufficient_privilege'` and must not vary with whether the subject
exists). No grant to `public`; `grant execute` to `presby_app`.

### `presby_apply_affiliation_to_org_tree(p_subject_org_id uuid, p_as_of date default current_date) returns void`

`language plpgsql security definer, volatile`. **The one place `parent_id` and
`path` derivation happens** (Ruling 2.3) — called by the affiliation `AFTER
INSERT/UPDATE` trigger and by the lifecycle event trigger's close path. Owned
by the migration's owning role (same as every other `SECURITY DEFINER`
function here), so it runs with `BYPASSRLS` regardless of `organizations`'
or `organization_affiliations`' `FORCE ROW LEVEL SECURITY` — the same mechanism
`presby_publish_sasr_snapshot()` already documents (`drizzle/0038:396-404`).
Algorithm:

1. `perform set_config('presby.affiliation_trigger_active', 'true', true)` —
   transaction-local (F26/Ruling 2.3's own callout: a session-scoped GUC here
   would leave the guard disarmed for the next request on the pooled
   connection, same hazard `src/lib/db/index.ts` documents for
   `app.current_org_id`). This is the GUC the `organizations` `BEFORE UPDATE OF
   parent_id, path` guard checks.
2. Look up the subject's current open affiliation row (`effective_to is null`)
   → `v_new_parent_org_id` (may be null — a top-level org, or a subject whose
   affiliation was just closed with no successor yet, e.g. `dissolved` with no
   receiving council).
3. Capture the subject's current `path` as `v_old_path` before any write.
4. If `v_new_parent_org_id` is null: `parent_id = null`, `path` = the subject's
   own root-derived label (same `deriveOrgPath()`-shaped rule
   `org-provisioning.ts` already uses for roots — do not reimplement the label
   rule a second time; call out to it or reproduce its exact transform).
   Otherwise: `parent_id = v_new_parent_org_id`, `path = <parent's path> || '.'
   || <subject's own label>`.
5. Rebuild every descendant whose `path` starts with `v_old_path || '.'`,
   replacing that prefix with the new path — one `UPDATE ... WHERE path LIKE
   v_old_path || '.%'` touching the whole subtree in one statement, not a
   per-row loop.
6. Return. No row-level return value; callers read `organizations` afterward if
   they need the new path.

No grant to `public`; `grant execute` to `presby_app` (it is only ever invoked
from inside other `SECURITY DEFINER` triggers/functions, but the grant is
symmetrical with every other function here, matching the codebase's existing
practice of granting `execute` even to internally-called functions).

### `presby_transfer_affiliation(p_subject_org_id uuid, p_new_parent_org_id uuid, p_relationship_type text, p_effective_on date, p_reason text default null, p_minute_reference text, p_concurrence_reference text default null) returns uuid`

`language plpgsql security definer, volatile`. Returns the id of the newly
opened `organization_affiliations` row. **Accepts no acting-council id** — the
actor is `presby_current_org()`, already membership-verified by
`withOrgContext()` (the confused-deputy form `drizzle/0038:376-380`
establishes). Algorithm:

1. `v_actor := presby_current_org()`. If null, deny (no org context — same
   check `presby_publish_sasr_snapshot()` already does).
2. Look up the subject's current open affiliation row → `v_current_parent_id`,
   `v_current_row_id`. If none exists, deny (uniform message — does not reveal
   whether the subject org exists at all).
3. **Standing check, read from the affiliation history, never from
   `organizations.parent_id`/`path`** (those are the derived cache this same
   transaction is about to rewrite — reading them as authority is circular):
   - If `p_new_parent_org_id = v_current_parent_id` (a correction, not a
     jurisdictional transfer — e.g. fixing `relationship_type` or reopening a
     backfilled row with a real minute): `v_actor` must equal
     `v_current_parent_id`.
   - Else (a true transfer between two different parents — D19's headline
     scenario): `v_actor` must be the **common superior** of both —
     `presby_affiliation_parent_as_of(v_current_parent_id, p_effective_on) =
     v_actor` **and** `presby_affiliation_parent_as_of(p_new_parent_org_id,
     p_effective_on) = v_actor`. This is what makes a synod (not either
     presbytery) the only actor who can redistrict a congregation between two
     presbyteries (G-3.0403(c)), and a GA the only actor who can do the
     equivalent between synods (G-3.0502(d)), with `p_concurrence_reference`
     recording GA concurrence on a synod-level act (G-3.0502(e)) as data, never
     as a second actor (Ruling 8).
   - Any failure denies with the uniform message.
4. Call `presby_assert_council_authority(v_actor, p_subject_org_id)` — the
   parent-type-fits-child-type check, shared with the lifecycle table.
5. In one transaction: `UPDATE organization_affiliations SET effective_to =
   p_effective_on, closed_by_org_id = v_actor, closed_by =
   <acting user id, if resolvable from session context; else null>, closed_on =
   now(), closed_minute_reference = p_minute_reference WHERE id =
   v_current_row_id` (ownership/`organization_id` untouched — provenance never
   changes); `INSERT INTO organization_affiliations (organization_id,
   subject_org_id, parent_org_id, relationship_type, effective_from,
   effective_to, authority, reason, minute_reference, concurrence_reference,
   recorded_by, recorded_at) VALUES (v_actor, p_subject_org_id,
   p_new_parent_org_id, p_relationship_type, p_effective_on, null, 'recorded',
   p_reason, p_minute_reference, p_concurrence_reference, ..., now())
   RETURNING id`.
6. Call `presby_apply_affiliation_to_org_tree(p_subject_org_id, p_effective_on)`.
7. Return the new row's id.

No grant to `public`; `grant execute` to `presby_app`.

### `presby_org_affiliated(p_subject_org_id uuid, p_council_org_id uuid, p_as_of date) returns boolean`

`language sql stable security definer` (existing name from R3.14, now
DDL-specified). `select exists (select 1 from organization_affiliations where
subject_org_id = p_subject_org_id and organization_id = p_council_org_id ...
-- wait: this must walk the AFFILIATION CHAIN (parent_org_id), not
organization_id (the recording council), since "is X affiliated with council
Y" means Y is somewhere in X's ancestry as of that date, not that Y recorded
the row)`. Concretely: true iff there exists an affiliation row for
`subject_org_id` whose `daterange(effective_from, effective_to, '[)')` contains
`p_as_of` and whose `parent_org_id = p_council_org_id`, **or** (recursively)
whose `parent_org_id`'s own affiliation as of `p_as_of` resolves up to
`p_council_org_id` — needed for a synod-level `about_org_id` check three levels
down. Sequenced into **increment 2 (0044)**, not increment 3, alongside
`organization_affiliations` itself and `presby_affiliation_parent_as_of()` (a
deliberate small sequencing deviation from §2b's literal increment-3 placement
— see Implementation Order below for the reasoning). Increment 3 (0045) then
only adds the *enforcing trigger* on the five existing about-org tables, which
calls this already-shipped function. No grant to `public`; `grant execute` to
`presby_app`.

### `presby_affiliation_parent_as_of(p_subject_org_id uuid, p_as_of date) returns uuid`

`language sql stable security definer`. New (Ruling 1's companion function).
`select parent_org_id from organization_affiliations where subject_org_id =
p_subject_org_id and daterange(effective_from, effective_to, '[)') @> p_as_of
limit 1` (the EXCLUDE constraint guarantees at most one matching row). Returns
null if none. Bounded to the public-projection columns only (no `reason`/
`minute_reference`/`notes` leak). Ships in increment 2 (0044) — it is
`presby_transfer_affiliation()`'s own standing-check dependency, so it cannot
ship later than the function that calls it.

### `presby_publish_sasr_snapshot(...)` — REWRITTEN, same name and same allow-list parameter shape

`language plpgsql security definer, volatile`. Same ~60-parameter allow-list as
today (`drizzle/0038:409-465`) — **no parameter added, none removed**; Phase
1's stability requirement is honored even though there is no live caller yet.
Behavioral rewrite, in one transaction:

1. `v_org := presby_current_org()`. Null → deny with the existing text
   (`'presby_publish_sasr_snapshot: no org context'`, unchanged).
2. **Recipient resolution changes**: `v_recipient := presby_affiliation_
   parent_as_of(v_org, current_date)` — **never `organizations.parent_id`**.
   Null → raise `'presby_publish_sasr_snapshot: organization % has no current
   affiliation to publish to', v_org` (text updated from "no parent
   organization" to "no current affiliation," reflecting the mechanism change;
   `invalid_parameter_value` errcode unchanged, so any future caller's
   error-code-based handling is unaffected even though the message string
   moves).
3. `select organization_type into v_recipient_type from organizations where id
   = v_recipient`; must be `'presbytery'`, else raise (existing text pattern
   unchanged: `'presby_publish_sasr_snapshot: parent of % is not a presbytery
   (found %)'`, substituting "recipient" for "parent" in the copy).
4. Year-range and value-bound validation: **unchanged**, same `v_count_max`/
   `v_money_max` checks as today.
5. `INSERT INTO statistical_returns (organization_id, about_org_id, report_year,
   form_version_key, provenance, payload, reconciled, attested_by_name,
   attested_role, attested_at, created_at) VALUES (v_org, v_org, p_report_year,
   <resolve current form_version_key for p_report_year from
   sasr_form_versions>, 'submitted', <jsonb_build_object over every p_* param>,
   true, ..., ..., now(), now()) RETURNING id INTO v_return_id`. **Open item for
   Phase 4** (named, not silently resolved): `reconciled` is recorded `true`
   unconditionally for a congregation-submitted publish in this design — the
   client-side review of `presby_sasr_projection()` *is* the reconciliation
   step D11 describes for `provenance = 'submitted'`; this function does not
   re-derive the roll balance equation internally. If a future pass wants the
   function itself to enforce D11's arithmetic (not just record that the rule
   applies), that is a v2 addition to this same function, not a blocker to
   this pipeline.
6. Derive `v_supersedes_id` the same way today's function derives
   `supersedes_publication_id` (most recent existing `publications` row for
   `organization_id = v_org` whose artifact's `report_year = p_report_year`),
   `INSERT INTO publications (organization_id, recipient_org_id, record_class,
   artifact_id, published_at, supersedes_id, authorized_by, minute_reference,
   withdrawn_at) VALUES (v_org, v_recipient, 'statistical_return',
   v_return_id, now(), v_supersedes_id, <acting user id>, p_minute_reference,
   null) RETURNING id INTO v_publication_id`.
7. `INSERT INTO congregation_statistics (organization_id, about_org_id, year,
   provenance, publication_id, published_at, minute_reference, entered_by, ...
   every typed SASR column from the p_* parameters ...) VALUES (v_recipient,
   v_org, p_report_year, 'published_by_congregation', v_publication_id, now(),
   p_minute_reference, null, ...)` — column list otherwise identical to today's
   `INSERT` (`drizzle/0038:582-620`), with `publication_id` replacing
   `supersedes_publication_id` and `published_at`/`minute_reference` populated
   as **copies** of the values just written to `publications` (F39's
   non-drift argument: one function, one transaction, an immutable freeze
   trigger already guarantees the projection is never independently updated).
8. `RETURN v_return_id` — **changed from today's `RETURN v_id`** (the
   `congregation_statistics.id`), because the artifact the function now
   fundamentally produces is the `statistical_returns` row; the caller can
   reach the publication and projection rows through
   `presby_list_own_congregation_publications()` as before. Named explicitly
   as a return-value change since it is the one part of the "signature stays
   stable" promise that does not hold byte-for-byte — Phase 1 confirmed there
   is no live caller to break, so this is a deliberate, low-cost improvement
   rather than a silent one.

`revoke all ... from public; grant execute ... to presby_app` — unchanged
pattern, same explicit parameter-type list as today's grant statement.

### `presby_list_published_returns_to_me(p_about_org_id uuid default null, p_year integer default null) returns table (publication_id uuid, published_at timestamptz, minute_reference text, about_org_id uuid, report_year integer, form_version_key text, payload jsonb, attested_by_name text, attested_role text, attested_at timestamptz, return_id uuid, withdrawn_at timestamptz)`

`language sql stable security definer` — new, ships in increment 5 (0047)
alongside `publications` (Ruling 5). Body: joins `publications p` to
`statistical_returns r` on `p.artifact_id = r.id and p.organization_id =
r.organization_id` (the composite FK), filters `p.recipient_org_id =
presby_current_org()` internally (never a caller-supplied org id — same
confused-deputy discipline as every function above), optionally narrows by
`r.about_org_id = p_about_org_id` and `r.report_year = p_year` when supplied,
orders `report_year desc, published_at desc`. **Does not filter on
`withdrawn_at is null`** in the base query — it is returned as a column so a
caller can distinguish "never published" from "published then withdrawn" (the
UI decision of what to do with a withdrawn row belongs to the future
publish-UI pipeline, not this one). Mirrors `presby_list_own_congregation_
publications()`'s shape (`drizzle/0038:665-690`) to the recipient side. No
grant to `public`; `grant execute` to `presby_app`.

### The `sasr_form_versions.field_spec` enforcement trigger

`presby_enforce_sasr_field_spec()`, `language plpgsql`, **`security invoker`**
(a deliberate departure from the DEFINER default elsewhere in this design — no
cross-org read is needed: the trigger reads `NEW.payload` and the matching
`sasr_form_versions` row, a platform-wide reference table with no RLS at all,
so the invoking role's own privileges suffice). `BEFORE INSERT ON
statistical_returns FOR EACH ROW`. Algorithm: look up `field_spec` for
`NEW.form_version_key`; for every key in `NEW.payload`, assert it exists in
`field_spec.fields`; for every field present, assert its JSON type matches
`field_spec.fields[key].type` and, for numeric fields, that the value is
between `field_spec.fields[key].min` and `.max` (defaulting to `0`/a generous
ceiling when unspecified, mirroring `presby_publish_sasr_snapshot()`'s own
`v_count_max`/`v_money_max` constants). A key present in `NEW.payload` but
absent from `field_spec.fields` raises — this is the D8 gate (§9.5): without
it, `payload jsonb` is a custom-fields escape hatch, not a controlled archive
format.

### The lifecycle event trigger

Two trigger functions on `organization_lifecycle_events`, both `security
definer` (F38: writing `organizations.lifecycle_status`/`lifecycle_as_of`
requires it independently of F26, since `presby_app` no longer has UPDATE on
`organizations` after increment 2's revoke):

- `presby_check_lifecycle_authority()` — `BEFORE INSERT`, calls
  `presby_assert_council_authority(NEW.organization_id, NEW.subject_org_id)`.
- `presby_apply_lifecycle_event()` — `AFTER INSERT`: sets
  `organizations.lifecycle_status = NEW.event` (mapped through the
  event→status vocabulary in §3: `organized`/`received` → `active`;
  everything else maps to itself) and `lifecycle_as_of = NEW.effective_on` on
  `NEW.subject_org_id`; when `NEW.event in ('dissolved', 'merged', 'divided',
  'dismissed')`, closes the subject's current open affiliation row
  (`effective_to = NEW.effective_on`, `closed_by_org_id = NEW.organization_id`,
  `closed_by = NEW.recorded_by`, `closed_on = now()`, `closed_minute_reference
  = NEW.minute_reference`) and calls `presby_apply_affiliation_to_org_tree
  (NEW.subject_org_id, NEW.effective_on)`. `received` does **not** close an
  affiliation (there was none inside this system to close) — a `received`
  event's organizing act is expected to be followed by
  `presby_transfer_affiliation()` or `createOrganization()`'s own affiliation
  insert to open one, out of this trigger's scope.

### The succession cardinality constraint trigger

`presby_check_succession_cardinality()`, `CONSTRAINT TRIGGER ... AFTER INSERT
OR DELETE ON organization_successions DEFERRABLE INITIALLY DEFERRED FOR EACH
ROW`, `security invoker` (reads only `organization_successions` and the
parent `organization_lifecycle_events` row, both already visible under
ordinary tenant RLS to the recording council). At commit, for the event named
by `NEW.event_id` (or `OLD.event_id` on delete): count predecessor and
successor rows and assert, per `event`: `merged` → predecessors ≥ 2, successors
= 1; `divided` → predecessors = 1, successors ≥ 2; `dissolved`/`dismissed`/
`organized`/`received` → 0 rows of either kind. Row-level `CHECK (predecessor_
org_id <> successor_org_id)` lives on the table itself, not this trigger.
`DEFERRABLE INITIALLY DEFERRED` is required, not optional — a `merged` event's
first predecessor row cannot satisfy "≥2 predecessors" at the instant it is
inserted.

### The `organizations` guards

Three trigger functions, all `security definer` (F38 — writing/rejecting
writes to `organizations` needs it independently of cross-org reasoning, now
that `presby_app`'s grant is revoked in the same increment):

- `presby_guard_organizations_insert()` — `BEFORE INSERT ... FOR EACH ROW WHEN
  (NEW.parent_id IS NOT NULL)`. Rejects unless
  `current_setting('presby.affiliation_trigger_active', true) = 'true'` (the
  transaction-local GUC `presby_apply_affiliation_to_org_tree()` sets).
  `createOrganization()`'s extension (below) satisfies this by always inserting
  the `organizations` row with `parent_id = null` first and letting the
  affiliation insert's own trigger set `parent_id` via the normal derivation
  path — it never sets `parent_id` directly, so it never needs to fake the
  GUC. Root-org inserts (`parent_id is null`) are never touched by this guard.
- `presby_guard_organizations_reparent()` — `BEFORE UPDATE OF parent_id, path
  ON organizations FOR EACH ROW`. Same GUC check as above; rejects any direct
  `UPDATE` of either column outside `presby_apply_affiliation_to_org_tree()`'s
  own write.
- `presby_guard_organizations_delete()` — `BEFORE DELETE ON organizations FOR
  EACH ROW`. Rejects unless `OLD.deletable_until is not null and OLD.
  deletable_until > now()`. Fires on **both** connections — `presby_app`
  (already has no DELETE grant after the revoke, so this is defense in depth
  there) and, load-bearingly, the `presby_platform`/owner path
  (`getPlatformDb()`), because `BYPASSRLS` exempts a role from RLS policies but
  **not** from triggers. This is the path that matters: the 2026-08-31 58-org
  cascade went through `getPlatformDb()`.

### `createOrganization()` extension (`src/lib/org-provisioning.ts`)

```ts
export type CreateOrganizationInput = {
  name: string;
  slug: string;
  organizationType: OrganizationType;
  platformStatus: PlatformStatus;
  // NEW, all optional — omitted entirely for a root org (synod/GA/independent
  // presbytery), exactly as today.
  parentOrganizationId?: string;
  relationshipType?: RelationshipType; // "member_congregation" | "member_presbytery"
                                        // | "member_synod" | "member_nwc"
  effectiveFrom?: Date;                // omitted => the affiliation row's
                                        // effective_from is null (unbounded-
                                        // below is WRONG for a brand-new org —
                                        // see note below; this path uses
                                        // effectiveFrom ?? new Date())
  minuteReference?: string;            // omitted => authority = 'backfill'
                                        // on the affiliation row (matches the
                                        // CHECK: minute_reference may be null
                                        // only when authority = 'backfill')
  recordedByUserId: string;            // the platform operator's own id —
                                        // required when parentOrganizationId
                                        // is set, ignored for a root org
};
```

Behavior, inside the existing `platformDb.transaction()` (no new transaction
boundary — Ruling 3 is explicit that this must be one commit, not two):
after the existing `organizations` insert (unchanged — `parentId` is never set
directly on this insert, satisfying `presby_guard_organizations_insert()`
trivially since `presby_platform` is a different role from the guard's
`presby_app`-focused concern, but the discipline is kept uniform anyway) and
the existing group/role seeding, when `input.parentOrganizationId` is present:
`INSERT INTO organization_affiliations (organization_id, subject_org_id,
parent_org_id, relationship_type, effective_from, effective_to, authority,
minute_reference, recorded_by, recorded_at) VALUES
(input.parentOrganizationId, orgRow.id, input.parentOrganizationId,
input.relationshipType, input.effectiveFrom ?? new Date(), null,
input.minuteReference ? 'recorded' : 'backfill', input.minuteReference ??
null, input.recordedByUserId, now())`, then call `presby_apply_affiliation_
to_org_tree(orgRow.id, effectiveFrom)` (via a raw `tx.execute(sql...)` call,
the same pattern `withOrgContext()` already uses for `presby_membership_
is_active()`) so the new org's `parent_id`/`path` are set through the one
real derivation path rather than reproduced inline — `deriveOrgPath()` stays
exactly as it is today (roots only) and is **not** extended to handle a parent
prefix; that logic lives in the SQL function now, permanently, per Ruling 2.3.
Requires `presby_platform` to hold `INSERT` on `organization_affiliations`
(a narrow, deliberate grant alongside the `presby_app` revoke — `presby_
platform` already bypasses RLS by design and is "platform admin pages only,
rare and obvious in review," so this does not reopen F40's oracle concern).
`presby_organize_congregation()` — a presbytery-callable equivalent that does
not require the platform operator — is **deferred** to the future
lifecycle-UI pipeline (Ruling 3), tracked in `docs/TODO.md`.

## Data Model

Full DDL-level shape, increments 1–5 (`drizzle/0043`–`0047`). Column lists
below are complete; exact SQL text is Phase 4's job.

### Increment 1 — `drizzle/0043_presby_org_identifiers.sql`

```sql
create table organization_identifiers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),  -- PLAIN FK,
                     -- by design, same as congregationOversight.aboutOrgId —
                     -- organization_identifiers is not itself tenant-owned
                     -- (it has no organization_id-as-tenant column; the FK
                     -- above IS the "which org" column, not a tenant scope)
  kind              text not null,      -- pcusa_pin | psvonline_congregation_id
                                         -- | church360 | legacy_import
  value_normalized  text not null,
  is_verified       boolean not null default false,
  source            text,
  created_at        timestamptz not null default now()
);
create unique index organization_identifiers_kind_value_verified_idx
  on organization_identifiers (kind, value_normalized) where is_verified;
create index organization_identifiers_org_idx on organization_identifiers (organization_id);
-- No RLS: organization_identifiers is identity data about a public org tree
-- entry, same visibility class as organizations itself (schema-design.md §17).
grant select, insert, update, delete on organization_identifiers to presby_app;

-- Move pcusa_pin off organization_settings (tenant-scoped; the importer runs
-- as the presbytery and cannot read a congregation's own settings row).
insert into organization_identifiers (organization_id, kind, value_normalized, is_verified)
  select organization_id, 'pcusa_pin', pcusa_pin, true
    from organization_settings where pcusa_pin is not null;
alter table organization_settings drop column pcusa_pin;

-- F35: drop the unused pre-provisioning status column.
alter table organizations drop column status;
```

### Increment 2 — `drizzle/0044_presby_org_lifecycle.sql`

```sql
create extension if not exists btree_gist;  -- idempotent; already installed
                                             -- (drizzle/0009:471, 0039:120)

alter table organizations
  add column lifecycle_status text not null default 'active',
  add column lifecycle_as_of date,
  add column deletable_until timestamptz;
alter table organizations add constraint organizations_lifecycle_status_allowed
  check (lifecycle_status in ('active','merged','divided','dismissed','dissolved'));

create table organization_lifecycle_events (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id),  -- acting council
  subject_org_id         uuid not null references organizations(id),
  event                  text not null,   -- organized|received|merged|divided
                                           -- |dismissed|dissolved
  effective_on           date not null,
  minute_reference       text not null,
  concurrence_reference  text,            -- nullable; GA concurrence on a
                                           -- synod act (G-3.0502(e))
  external_body          text,            -- required for received/dismissed
  recorded_by            uuid not null references users(id),
  recorded_at            timestamptz not null default now(),
  notes                  text,
  constraint organization_lifecycle_events_id_org_key unique (id, organization_id),
  constraint organization_lifecycle_events_event_allowed
    check (event in ('organized','received','merged','divided','dismissed','dissolved')),
  constraint organization_lifecycle_events_not_self check (organization_id <> subject_org_id),
  constraint organization_lifecycle_events_external_body_shape
    check ((event in ('received','dismissed')) = (external_body is not null))
);
create index organization_lifecycle_events_org_idx on organization_lifecycle_events (organization_id);
create index organization_lifecycle_events_subject_idx on organization_lifecycle_events (subject_org_id);
alter table organization_lifecycle_events enable row level security;
alter table organization_lifecycle_events force row level security;
create policy tenant_isolation on organization_lifecycle_events
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
grant select, insert, update, delete on organization_lifecycle_events to presby_app;
-- update/delete are revoked below once the freeze convention is confirmed in
-- Phase 4 (this table's "approved event is immutable" story mirrors
-- roll_actions; whether it needs its own freeze trigger or relies on "nobody
-- ever updates a historical event" convention is a Phase 4 implementation
-- call, named here as open rather than silently assumed).

create table organization_successions (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references organization_lifecycle_events(id),
  predecessor_org_id uuid not null references organizations(id),
  successor_org_id   uuid not null references organizations(id),
  constraint organization_successions_not_self check (predecessor_org_id <> successor_org_id)
);
-- No RLS of its own, and none is added: SELECT stays open on every
-- connection because the topology is public (the org tree already
-- publishes it). CORRECTED 2026-09-24 (Phase 3 amendment after Phase 5
-- Finding 1 — see that section below): the sentence that stood here through
-- three prior revisions of this Data Model — "visibility follows the parent
-- event_id's tenant policy via a join" — was never true for WRITES, only
-- (accidentally) for a manual SELECT that happens to join. INSERT/UPDATE/
-- DELETE are function-mediated per Phase 2 Ruling 1, exactly like
-- `organization_affiliations`: `presby_app` and `presby_platform` are
-- revoked to SELECT-only (plus INSERT for `presby_platform`, mirroring the
-- sibling tables' grant shape), and a `BEFORE INSERT` trigger,
-- `SECURITY DEFINER` (F26 — it must see the event across
-- `organization_lifecycle_events`' own RLS), asserts the named `event_id`
-- exists and, when a tenant context is set, belongs to
-- `presby_current_org()`. No `organization_id` column is added to this
-- table — the table has no owner of its own separate from the event it
-- belongs to, and duplicating one here would be a second, driftable
-- statement of a fact the parent event already states once.
grant select on organization_successions to presby_app;
grant select, insert on organization_successions to presby_platform;
-- (The future presby_record_lifecycle_event() DEFINER function, owed to the
-- lifecycle-UI pipeline, is the only tenant-side writer — it runs as table
-- owner and is not constrained by presby_app's grant at all.)
-- CONSTRAINT TRIGGER presby_check_succession_cardinality, DEFERRABLE INITIALLY
-- DEFERRED, AFTER INSERT OR DELETE ON organization_successions FOR EACH ROW.

create table organization_affiliations (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations(id),  -- recording council
  subject_org_id           uuid not null references organizations(id),
  parent_org_id            uuid not null references organizations(id),
  relationship_type        text not null,  -- member_congregation|member_presbytery
                                            -- |member_synod|member_nwc
  effective_from           date,           -- NULLABLE: null = unbounded-below
  effective_to             date,           -- null = current/open
  authority                text not null default 'recorded',  -- recorded|backfill
  reason                   text,
  minute_reference         text,
  concurrence_reference    text,
  recorded_by              uuid references users(id),
  recorded_at              timestamptz not null default now(),
  closed_by_org_id         uuid references organizations(id),
  closed_by                uuid references users(id),
  closed_on                date,
  closed_minute_reference  text,
  constraint organization_affiliations_id_org_key unique (id, organization_id),
  constraint organization_affiliations_relationship_type_allowed
    check (relationship_type in ('member_congregation','member_presbytery','member_synod','member_nwc')),
  constraint organization_affiliations_authority_allowed check (authority in ('recorded','backfill')),
  constraint organization_affiliations_backfill_minute_shape
    check (authority = 'backfill' or minute_reference is not null),
  constraint organization_affiliations_no_overlap
    exclude using gist (
      subject_org_id with =,
      relationship_type with =,
      daterange(effective_from, effective_to, '[)') with &&
    )
);
create index organization_affiliations_org_idx on organization_affiliations (organization_id);
create index organization_affiliations_subject_idx on organization_affiliations (subject_org_id);
create index organization_affiliations_parent_idx on organization_affiliations (parent_org_id);
alter table organization_affiliations enable row level security;
alter table organization_affiliations force row level security;
create policy tenant_isolation on organization_affiliations
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
-- Ruling 1/F40 — the load-bearing revoke:
revoke insert, update, delete on organization_affiliations from presby_app;
grant select on organization_affiliations to presby_app;
grant insert on organization_affiliations to presby_platform;  -- createOrganization() only

create view organization_affiliations_public as
  select subject_org_id, parent_org_id, relationship_type, effective_from, effective_to
    from organization_affiliations;
grant select on organization_affiliations_public to presby_app;

-- F38/Ruling 2/7 — make the grant model true, not assumed:
revoke insert, update, delete on organizations from presby_app;

-- Trigger wiring (bodies specified above under API Contract):
--   organization_lifecycle_events: BEFORE INSERT presby_check_lifecycle_authority,
--     AFTER INSERT presby_apply_lifecycle_event
--   organization_affiliations: BEFORE INSERT presby_assert_council_authority-calling
--     trigger, AFTER INSERT OR UPDATE presby_apply_affiliation_to_org_tree-calling
--     trigger
--   organizations: BEFORE INSERT presby_guard_organizations_insert,
--     BEFORE UPDATE OF parent_id, path presby_guard_organizations_reparent,
--     BEFORE DELETE presby_guard_organizations_delete

-- Backfill: one lifecycle event ('organized', authority is implicit — lifecycle
-- events have no authority column, only affiliations do) is NOT created for
-- existing orgs (there is no real "organized" minute to invent); only the
-- AFFILIATION backfill runs, per org with a non-null parent_id today:
insert into organization_affiliations
  (organization_id, subject_org_id, parent_org_id, relationship_type,
   effective_from, effective_to, authority, minute_reference, recorded_at)
  select parent_id, id, parent_id,
         case organization_type
           when 'congregation' then 'member_congregation'
           when 'new_worshiping_community' then 'member_nwc'
           when 'presbytery' then 'member_presbytery'
           when 'synod' then 'member_synod'
         end,
         null, null, 'backfill', null, now()
    from organizations where parent_id is not null;

-- COMPLETENESS ASSERTION (Phase 2 Notes item 3) — must run inside this same
-- migration, before increment 3's about-org trigger is created in the NEXT
-- migration file:
do $$
declare v_orgs_with_parent integer; v_open_affiliations integer;
begin
  select count(*) into v_orgs_with_parent from organizations where parent_id is not null;
  select count(*) into v_open_affiliations from organization_affiliations where effective_to is null;
  if v_orgs_with_parent <> v_open_affiliations then
    raise exception 'affiliation backfill incomplete: % orgs have parent_id set but % open affiliation rows exist',
      v_orgs_with_parent, v_open_affiliations;
  end if;
end $$;
```

### Increment 3 — `drizzle/0045_presby_about_org_affiliation.sql`

Ships **only** the enforcing trigger (Phase 3's sequencing decision, above):
`presby_org_affiliated()` and `presby_affiliation_parent_as_of()` are already
live from increment 2. This migration adds `presby_check_about_org_affiliated()`
(`BEFORE INSERT OR UPDATE`, `security definer`, calls `presby_org_affiliated
(NEW.about_org_id, NEW.organization_id, <NEW.year for congregation_statistics
and per_capita_records; now() for congregation_oversight and per_capita_rates>)`
and raises if false) on the five tables the about-org pattern already names:
`congregation_oversight`, `congregation_statistics`, `per_capita_rates`,
`per_capita_records`, and the fifth table confirmed at Phase 4 time by grepping
`about_org_id` across `src/lib/db/domain/` (Phase 2's own text names four
explicitly and "whichever officer/credentials table already uses the pattern"
as the fifth — database-admin must re-grep at implementation time rather than
guess a name here).

### Increment 4 — `drizzle/0046_presby_statistical_returns.sql`

```sql
create table sasr_form_versions (
  key                  text primary key,
  label                text not null,
  effective_first_year integer not null,
  effective_last_year  integer,   -- null = still in effect
  field_spec           jsonb not null
);
-- No RLS: platform-wide reference data, same class as permissions/feature_flags.
grant select on sasr_form_versions to presby_app;

-- Seed: '2024' gets a FULL field_spec, one entry per presby_publish_sasr_
-- snapshot() parameter (the ~60 fields already typed on congregation_
-- statistics today) — type integer|numeric, min 0, max matching v_count_max/
-- v_money_max, sasr_line, comparable_to left empty pending a real cross-
-- generation mapping pass. '1984'/'2014'/'2022' are seeded as PLACEHOLDER rows
-- (key, label, effective_first_year/effective_last_year only, field_spec =
-- '{"fields": {}}') — explicitly flagged as needing a full field-mapping pass
-- (per-tab column orders, F31/F32) before increment 7's D13 import can write
-- payload rows against them. A placeholder field_spec means NO payload keys
-- validate against it yet, which is the correct fail-closed default until
-- that mapping exists — it must not silently accept an arbitrary payload.
insert into sasr_form_versions (key, label, effective_first_year, effective_last_year, field_spec) values
  ('2024', 'SASR 2024 revision', 2024, null, '{"fields": { ... 60 entries ... }}'),
  ('2022', 'SASR 2022 revision (placeholder — field mapping pending)', 2022, 2023, '{"fields": {}}'),
  ('2014', 'SASR 2014 revision (placeholder — field mapping pending)', 2014, 2021, '{"fields": {}}'),
  ('1984', 'SASR 1984 revision (placeholder — field mapping pending)', 1984, 2013, '{"fields": {}}');

create table statistical_returns (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id),  -- PLAIN FK to
                     -- organizations, not a composite tenant FK — organizations
                     -- itself carries no organization_id to be composite against;
                     -- it is the one table F2's composite-key rule doesn't apply
                     -- to (schema-design.md §17), same as every other
                     -- about-org-pattern reference in this design
  about_org_id       uuid not null references organizations(id),  -- PLAIN FK, may
                     -- reference a dissolved org (D10) — the concrete reason D10
                     -- exists
  report_year        integer not null,
  form_version_key   text not null references sasr_form_versions(key),
  provenance         text not null,   -- submitted | imported
  payload            jsonb not null,
  reconciled         boolean not null,
  attested_by_name   text,
  attested_role      text,
  attested_at        timestamptz,
  source_ref         text,
  staging_row_id     uuid,   -- → import_rows(id), FK added in increment 7
                              -- when that table exists; nullable placeholder
                              -- column here, not a forward-reference FK
  created_at         timestamptz not null default now(),
  constraint statistical_returns_id_org_key unique (id, organization_id),
  constraint statistical_returns_provenance_allowed check (provenance in ('submitted','imported'))
);
create index statistical_returns_org_about_year_idx on statistical_returns (organization_id, about_org_id, report_year);
alter table statistical_returns enable row level security;
alter table statistical_returns force row level security;
create policy tenant_isolation on statistical_returns
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
-- update/delete stay revoked (IMMUTABLE, append-only, D25's own invariant —
-- no correction path other than a new row, matching roll_actions/publications).
grant select, insert on statistical_returns to presby_app;

-- BEFORE INSERT presby_enforce_sasr_field_spec() (security invoker)
-- BEFORE INSERT presby_check_about_org_affiliated-equivalent for imported rows
--   only (R3.14): presby_org_affiliated(about_org_id, organization_id, report_year)
--   when provenance = 'imported'; submitted rows are exempt (about_org_id =
--   organization_id = the submitting congregation itself, trivially true).
```

### Increment 5 — `drizzle/0047_presby_publications.sql`

```sql
create table publications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),  -- source council
  recipient_org_id  uuid not null references organizations(id),
  record_class      text not null default 'statistical_return',
  artifact_id       uuid not null,
  published_at      timestamptz not null default now(),
  supersedes_id     uuid references publications(id),
  authorized_by     uuid references users(id),
  minute_reference  text,
  withdrawn_at      timestamptz,
  constraint publications_id_org_key unique (id, organization_id),
  foreign key (artifact_id, organization_id) references statistical_returns (id, organization_id)
  -- composite FK, F2-compliant: artifact_id alone would let a publication
  -- claim an artifact recorded under a DIFFERENT organization_id
);
create index publications_recipient_idx on publications (recipient_org_id);
alter table publications enable row level security;
alter table publications force row level security;
create policy tenant_isolation on publications
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
-- update/delete revoked (IMMUTABLE; withdrawal is the withdrawn_at column, not a delete).
grant select, insert on publications to presby_app;

-- The congregation_statistics retrofit (F36/F39, narrowed per Ruling 5):
alter table congregation_statistics add column publication_id uuid;
alter table congregation_statistics add constraint congregation_statistics_publication_fk
  foreign key (publication_id, organization_id) references publications (id, organization_id);
alter table congregation_statistics add constraint congregation_statistics_publication_shape
  check ((provenance = 'published_by_congregation') = (publication_id is not null));

-- BACKFILL one publications row per existing published_by_congregation row,
-- BEFORE dropping supersedes_publication_id:
insert into publications (organization_id, recipient_org_id, record_class, artifact_id,
                           published_at, supersedes_id, minute_reference)
  select cs.about_org_id, cs.organization_id, 'statistical_return',
         -- artifact_id: no pre-existing statistical_returns row to point to for
         -- these legacy published rows (statistical_returns is new in
         -- increment 4) — Phase 4 must mint one statistical_returns row per
         -- backfilled publication (provenance = 'submitted', reconciled = true,
         -- payload reconstructed from the congregation_statistics row's own
         -- typed columns) so artifact_id has a real target; named here as a
         -- two-step backfill (mint returns row, then publications row), not a
         -- one-step INSERT ... SELECT.
         <minted statistical_returns.id>,
         cs.published_at, null /* supersedes chain rebuilt from
           supersedes_publication_id below, in a second pass */, cs.minute_reference
    from congregation_statistics cs where cs.provenance = 'published_by_congregation';
update congregation_statistics set publication_id = <matching new publications.id>
  where provenance = 'published_by_congregation';
-- Second pass: rewrite publications.supersedes_id from the OLD
-- supersedes_publication_id chain (congregation_statistics.id → publications.id
-- via the mapping built above) before the column is dropped.
alter table congregation_statistics drop column supersedes_publication_id;
-- published_at and minute_reference STAY on congregation_statistics (Ruling 5/F39).

-- Rewrite presby_publish_sasr_snapshot() per the API Contract above (CREATE OR
-- REPLACE FUNCTION, same name/signature).
-- Add presby_list_published_returns_to_me() per the API Contract above.

-- sasr_reports drop (Ruling 6):
drop table sasr_reports;
-- and remove 'sasr_reports' from drizzle/0009's tenant_tables array is not
-- retroactively editable (0009 already ran) — this migration's own DROP TABLE
-- is sufficient; the array literal in 0009.sql is a historical record of what
-- THAT migration did, not re-executed. src/lib/db/domain/reporting.ts is
-- deleted at the TypeScript layer (Component/Page Plan below).
```

## Component / Page Plan

No pages, no components — this pipeline ships no React (`'use client'` count:
zero, confirmed in Phase 2). Files to create/modify/delete:

- **Create** `src/lib/db/domain/lifecycle.ts` — `organizationLifecycleEvents`,
  `organizationSuccessions`, `organizationAffiliations` (Drizzle schema
  objects matching the DDL above).
- **Create** `src/lib/db/domain/publication.ts` — `publications` alone
  (Ruling 9 — its own module).
- **Create** `src/lib/db/domain/returns.ts` — `sasrFormVersions`,
  `statisticalReturns` (`statisticsSubmissionGrants` added later, increment 6,
  its own work-log).
- **Delete** `src/lib/db/domain/reporting.ts` (contains only `sasrReports`,
  dropped in increment 5).
- **Modify** `src/lib/db/domain/org.ts` — add `organizationIdentifiers` (not a
  new module, per Ruling 9); extend `organizations` with `lifecycleStatus`,
  `lifecycleAsOf`, `deletableUntil`; drop `status`; drop `pcusaPin` off
  `organizationSettings`.
- **Modify** `src/lib/db/domain/presbytery.ts` — `congregationStatistics`:
  add `publicationId`, drop `supersedesPublicationId`; keep `publishedAt`/
  `minuteReference` (F39).
- **Modify** `src/lib/db/domain/index.ts` — drop `export * from "./reporting"`,
  add the three new module exports.
- **Create** `drizzle/0043_presby_org_identifiers.sql` … `0047_presby_
  publications.sql`, and their `drizzle/meta/_journal.json` entries (idx 43–47,
  re-`ls drizzle/` immediately before each commit per the 0039/0040 near-
  collision precedent — `docs/TODO.md` In Flight).
- **Modify** `src/lib/org-provisioning.ts` — `createOrganization()` extension
  per the API Contract above.
- **Modify** `src/lib/org-provisioning.test.ts` (or create, if none exists for
  the new optional fields) — a test asserting a parented `createOrganization()`
  call produces both the `organizations` row and its `organization_affiliations`
  row in one commit, and that a failure in either half rolls back both.
- **Modify** `scripts/test-rls.sql` — new sections, named below.
- **Modify** `scripts/seed-dev.sql` — rewrite the hierarchical fixture block
  (line 30) to seed through `organization_affiliations` instead of a direct
  `parent_id` value, per Ruling 3's five-file sweep.
- **Modify** `src/lib/credentials.test.ts:128`, `src/lib/presbytery.test.ts:122`
  — their `makeOrg()`/`makeCongregation()` helpers gain an affiliation insert
  alongside every parented org insert, and a `deletableUntil` stamp on every
  fixture insert (Ruling 7.3).
- **Modify** `src/lib/dev-docs.ts` — three new `INVARIANTS` entries: "Organizations
  are permanent too" (`enforcement: "database"`, mirroring the person-permanence
  entry's shape), "`parent_id`/`path` are derived from council affiliation, never
  written directly" (`enforcement: "trigger"`), "Publication is an event, not a
  data-entry screen" (`enforcement: "database"`, extending the existing SASR
  invariant's language to the new publish→publication→projection chain).
- **Modify** `docs/schema-design-2.md` — done in this Phase (see the top note
  and the diff already committed alongside Phase 1/2's own record).

## Implementation Order

1. **Increment 1 (0043, `database-admin`).** `organization_identifiers`, move
   `pcusa_pin`, drop `organizations.status` (F35). Lowest risk, no trigger
   dependencies, no grant changes.
2. **Increment 2 (0044, `database-admin`).** Lifecycle events + successions +
   affiliations + all three `organizations` guards + the F38 revoke + backfill,
   in that order **within one migration file**, ending with the completeness
   assertion (Phase 2 Notes item 3) — `select count(*) from organizations
   where parent_id is not null` must equal the count of open affiliation rows
   **before the migration commits**, not as a follow-up check. This is the
   riskiest increment (Phase 2's own assessment) precisely because of the
   `presbytery.ts`/`credentials.ts` `parent_id`-vs-`presby_org_affiliated()`
   coupling named in Edge Cases below.
3. **The five-file fixture sweep, as its own commit-worthy line item (Ruling
   3), not folded into increment 2's migration commit.** `scripts/seed-
   dev.sql:30`, `scripts/test-rls.sql:1997`/`:2155`/`:2322`,
   `src/lib/credentials.test.ts:128`, `src/lib/presbytery.test.ts:122` — every
   direct `parent_id` insert either moves to seed through the new affiliation
   write path or (for the three `test-rls.sql` inline fixtures, which run as
   `presby_app` and therefore also lose their `organizations` INSERT grant per
   F38's revoke) moves to the owner connection. Do this **after** increment 2
   lands and **before** increment 3, since increment 3's about-org trigger is
   what actually breaks these fixtures at runtime.
4. **The `deletable_until`-at-insert change to every `makeOrg()`/fixture
   helper**, same commit as item 3 (same files, same review pass) — stamp
   `deletableUntil` on every `platform.insert(organizations)` call site that
   currently relies on a disable/enable-trigger teardown, so the ~15 existing
   teardown blocks (`docs/TODO.md`) need no changes.
5. **Increment 3 (0045, `database-admin`).** The about-org enforcing trigger
   on the five existing tables — only after item 3's sweep is verified green,
   per the Phase 2-mandated ordering.
6. **Increment 4 (0046, `database-admin`).** `sasr_form_versions` (seeded),
   `statistical_returns`, the field-spec trigger.
7. **Increment 5 (0047, `database-admin` for the DDL; `api-developer` for the
   rewritten `presby_publish_sasr_snapshot()`'s TypeScript call-site
   verification, since no application code calls it today — a smoke test, not
   a UI).** `publications`, the `congregation_statistics` retrofit and its
   two-pass backfill, the rewritten publish function, `presby_list_published_
   returns_to_me()`, the `sasr_reports` drop and its domain-module deletion.
8. **`createOrganization()`'s TypeScript extension and its test**, done by
   `database-admin` immediately after increment 2 lands (the affiliation table
   it depends on), rather than deferred to the end — this is a small,
   self-contained slice and there is no reason for a second implementer to
   re-load context on `org-provisioning.ts` for it. See Implementer below for
   the full reasoning on keeping this in one hand.
9. **`test-rls.sql` sections QA should expect, by name** (Phase 2 Notes item
   5) — one section per bullet, matching the numbering convention already in
   the file: grant shape on `organizations` (F38, the four-privilege assertion
   style of section 29's own proof, now asserting `SELECT` only); the
   affiliation write-path probe returning the uniform message across all three
   causes (F40); the delete guard rejecting a plain seeded org and permitting
   a `deletable_until`-stamped one, on **both** the `presby_app` and owner
   connections; `presby_org_affiliated()` answering correctly across a closed
   historical range (the round-3 "1990 case"); the recipient read-back
   (`presby_list_published_returns_to_me()`) returning only publications
   addressed to the caller and nothing for a sibling presbytery; the
   `published_at`/`minute_reference` projection-equals-publication assertion
   (F39); the succession-cardinality deferred-constraint proof (a `merged`
   event with one predecessor fails at commit, not at the first `INSERT`);
   the backfill-completeness assertion re-run as a standalone proof (not just
   trusted from the migration's own `DO` block).
10. **Release notes / `docs/TODO.md` reconciliation** at Phase 6 — no member-
    visible behavior changes, so no `whats_new_entries` row (Workflow Rule 13
    correctly does not apply); `docs/TODO.md`'s "design D10/D19/D20/D21 as one
    unit" line moves to Done, and the four Phase 2/3-introduced follow-ups
    (working-draft surface, deferred permission keys, deferred
    `presby_organize_congregation()`, and this increment split) are already
    recorded (this Phase's TODO edit, above).

## Edge Cases & Risks

- **The `presbytery.ts`/`credentials.ts` `parent_id` coupling is the single
  highest-risk item in this pipeline (Phase 2 Notes item 3).**
  `resolveMemberCongregation()`/`listMemberCongregations()`
  (`src/lib/presbytery.ts:143,169`) and the two `SERVING_ORG_TYPES` queries in
  `src/lib/credentials.ts:522,710` all answer "is X my member congregation"
  from `organizations.parentId = organizationId` directly, today. After
  increment 2's backfill and increment 3's trigger, the about-org enforcement
  answers the same underlying question from `presby_org_affiliated()`. These
  two answers are the SAME by construction as long as `parent_id` stays a pure
  cache of the current affiliation (Ruling 2.3) — but if the backfill is
  wrong for even one row, a presbytery's own UI (`resolveMemberCongregation`)
  would offer a congregation that the about-org trigger then refuses, which
  surfaces as a confusing user-facing error on a shipped page, not a failing
  test. The completeness assertion in step 2 above is the mitigation; it is
  not a substitute for actually reading `resolveMemberCongregation`'s query
  once increment 3 lands and confirming it still agrees with
  `presby_org_affiliated()` on every seeded fixture.
- **Pooled-connection GUC leakage.** Every transaction-local
  `set_config(..., true)` in this design (`presby.affiliation_trigger_active`,
  the existing `app.current_org_id`) must use the three-argument form with
  `is_local = true`; a session-scoped GUC on a pooled `neon-serverless`
  connection would leave a guard disarmed (or an org context set) for the
  *next* unrelated request. This is not new risk this pipeline introduces, but
  it is new *surface area* — a second GUC — and Phase 4 must not copy-paste the
  `set_config` call without the third argument.
- **Dissolved-org affiliation close vs. archive attribution.** A `dissolved`
  event closes the subject's open affiliation (§3), but `presby_org_affiliated
  (subject, council, as_of)` must still answer `true` for `as_of` dates
  *before* the closure — the EXCLUDE constraint and the closed row's own
  `effective_to` make this correct by construction (the daterange still
  contains a historical `as_of`), but it is exactly the kind of "obviously
  correct" claim that needs a `test-rls.sql` assertion rather than
  code-reading confidence, per item 9 above.
- **A `merged` event whose successor is a brand-new organization.** D10's
  `organization_successions` can name a `successor_org_id` that does not exist
  yet at the moment the presbytery wants to record the merger (the new,
  combined congregation is itself being organized by the same act). This
  pipeline does **not** solve the ordering problem (create the successor org
  first, then the lifecycle event referencing it, is the only sequence the FK
  allows) — it is named here as a real UX friction for the future lifecycle-UI
  pipeline, not a schema defect: the FK correctly requires the successor to
  exist, so the UI will need to walk the operator through "name the new
  congregation first."
- **Republish after supersession.** `presby_publish_sasr_snapshot()`'s
  supersession chain (`publications.supersedes_id`) is unit-testable in
  isolation but has no live caller to catch an integration mistake — Phase 4's
  test must construct two sequential publishes for the same
  `(organization_id, report_year)` and assert the chain, the `congregation_
  statistics` freeze trigger's rejection of a direct `UPDATE`, and that
  `presby_list_own_congregation_publications()` (unchanged) still returns the
  current row first.
- **Withdrawn publications and the projection row.** `publications.
  withdrawn_at` is a column, not a delete (D20) — but `congregation_statistics`
  has no `withdrawn_at` of its own; a withdrawn publication's projection row
  stays in the presbytery's typed keyspace unless a future function explicitly
  reacts to withdrawal. Named as an accepted gap for this pipeline: withdrawal
  is out of scope for *acting on* the projection, only for marking the
  publication event itself.
- **`effective_from` null semantics inside the EXCLUDE range type.**
  `daterange(null, effective_to, '[)')` treats a null lower bound as
  unbounded-below by Postgres's own `daterange` semantics — this is standard
  behavior, not a custom interpretation, but Phase 4's test suite must prove it
  explicitly (insert a backfilled unbounded row, then attempt a second
  affiliation for the same subject/relationship_type with any `effective_from`
  before the first row's `effective_to`, and confirm the EXCLUDE constraint
  still fires).
- **The revoke breaks three existing `test-rls.sql` inserts.** `scripts/
  test-rls.sql:1997`, `:2155`, `:2322` all run as `presby_app` (`:1`) and
  insert directly into `organizations` — every one of them fails the moment
  increment 2's revoke lands, independent of whether they also set `parent_id`.
  This is a superset of the fixture-sweep problem named above and must be
  fixed in the same pass, not discovered separately by QA.
- **Drizzle Kit emits none of this.** Every migration in this pipeline is
  hand-written SQL (RLS, triggers, `SECURITY DEFINER` functions, an EXCLUDE
  constraint) — `npm run db:generate` must not be run against these files, and
  `drizzle/meta/_journal.json`'s `idx`/filename agreement must be checked by
  hand for each of the five new entries, per the 0039/0040 near-collision
  precedent already logged in `docs/TODO.md`'s In Flight section (re-`ls
  drizzle/` immediately before each commit, not once at the start of the
  pipeline).

## Implementer

**`database-admin`** for all five increments (0043–0047) and the `test-rls.sql`
sections, per Phase 2's own read of the scope. The `createOrganization()`
TypeScript extension and the five-file fixture sweep are genuinely small,
server-side-only slices (no client component, no route handler) — rather than
hand them to `api-developer`/`full-stack-developer` and force a second
implementer to re-load context on `org-provisioning.ts`, `presbytery.ts`,
`credentials.ts` and the fixture files that `database-admin` is already deep
in from increment 2 onward, **`database-admin` does the TypeScript slice too**,
in the order given above (increment 1 → increment 2 → fixture sweep +
`deletable_until` stamping → increment 3 → increment 4 → increment 5 →
`createOrganization()` extension and its test). This is a deliberate, narrow
widening of `database-admin`'s usual "schema only" scope (CLAUDE.md's
implementer-selection table), justified the same way `full-stack-developer` is
justified for a small coupled feature: splitting here adds handoff overhead
without adding safety, since every file touched outside `drizzle/` in this
pipeline is a `.ts` schema/fixture file, not UI or a route handler. If Phase 4
turns up TypeScript work broader than that (a genuine new server action, for
instance), it escalates to `api-developer` rather than being absorbed here —
named as the boundary so this decision doesn't quietly expand.

---

## Amendment after batch A (2026-09-24, tech-lead)

Batch A's Implementer Notes named five deviations from the design above and
asked for a ruling on each, plus two incidental findings. Per CLAUDE.md, a
design defect returns to Phase 3 rather than being silently reconciled at
Phase 4 — this section is that return. Rulings below; `docs/schema-design-2.md`
§2b/§3, and `docs/decisions.md` DECISION-135/139, are amended in the same
commit to match. Nothing here re-opens Phase 2 — every ruling either accepts
the built shape as the (corrected) design authority, or names a small,
already-scoped fix for `database-admin` to make before batch B, not a
re-design.

### Ruling A1 — `organizations.status`: kept, not dropped (deviation 1 / F35)

**Accepted as reported, and it is the correct call.** The Data Model's own
text ("the unused pre-provisioning status column") was wrong — five shipped
`SECURITY DEFINER` functions (`presby_published_site()` and its `0024`/`0041`/
`0042` siblings) gate an *anonymous public read* on `o.status = 'active'`, and
Postgres tracks no column dependency inside a function body, so the drop as
specified would have shipped clean and failed every public site at request
time. **`status`'s restated meaning, going forward:** a platform-level
public-site enablement switch — a narrow fourth axis alongside
`platform_status` (tenant participation), `lifecycle_status` (polity fact,
this pipeline) and affiliation (council, this pipeline). No write path sets it
to anything but its `'active'` default today; it is the hook a future
platform-admin "suspend this org's public site" action would write through
`getPlatformDb()`, not built here. **Ruled against folding it into
`lifecycle_status`**, which was the design doc's other stated option: a
dissolved congregation's public historical site (a memorial page) is a
legitimate future feature, and tying site visibility to a polity lifecycle
event would foreclose it before anyone asked for it. The column name and the
five functions' literal text stay as `status` — renaming it is a cosmetic
follow-on with its own (small) blast radius, not a design defect, and is not
required. `docs/schema-design-2.md` §2b (F35's row) and §3 (the `organizations`
block) are amended in this commit to state this rather than "DROPPED."

### Ruling A2 — `presby_transfer_affiliation()` parameter order (deviation 2)

**Accepted; the built order is now the design authority.** Phase 3's Data
Model specified `p_reason text default null` immediately before
`p_minute_reference text` with no default — not valid SQL (Postgres requires
every parameter after the first defaulted one to also carry a default).
`p_minute_reference` moves ahead of `p_reason` in the signature
(`p_subject_org_id, p_new_parent_org_id, p_relationship_type, p_effective_on,
p_minute_reference, p_reason default null, p_concurrence_reference default
null`); it is required in practice regardless of position, since the row it
writes carries `authority = 'recorded'` and the backfill-shape CHECK then
demands a minute. DECISION-139 amended in place (dated correction appended,
history not rewritten) to record the corrected signature.

### Ruling A3 — `presby_assert_council_authority()`'s `p_context` and the parent-fits-child/actor-fits-subject split (deviation 3)

**Accepted, and this is the most consequential correction in the batch —
correctly identified as such by the implementer.** Two independent defects in
Phase 3's original specification, both load-bearing:

1. Phase 3 had `presby_transfer_affiliation()` call
   `presby_assert_council_authority(v_actor, subject)` — actor against
   subject, under the flat one-level-above rule. In a true redistricting
   (D19's headline scenario) the actor is the **synod** and the subject is a
   **congregation** — two levels apart by design, since the synod's authority
   runs through its common-superior relationship to *both presbyteries*, not
   through a direct one-level relationship to the congregation. Calling the
   function this way would reject the exact transfer Ruling 1 exists to
   enable — a design defect that would have made D19 unbuildable, not a
   cosmetic mismatch.
2. Phase 3 had the function always raise the *lifecycle* table's rejection
   literal. Called from the affiliation path, that would make a rejection's
   *cause* distinguishable by which literal it raised (lifecycle text vs. the
   affiliation table's own), defeating F40's uniform-message rule at the
   moment it matters most — a probing caller could learn "this failed the
   authority check" vs. "this failed for some other reason" by string alone.

**Ruling: the built resolution is correct and is adopted as the design going
forward.** On an **affiliation** row, the one-level-above rule checked by
`presby_assert_council_authority()` is between `parent_org_id` and
`subject_org_id` (parent-fits-child) — called as
`presby_assert_council_authority(p_new_parent_org_id, p_subject_org_id,
'organization_affiliations')`. The **actor's** standing (is this org the
common superior of both parents, or the current parent for a same-parent
correction) is a separate check inside `presby_transfer_affiliation()` itself,
against the affiliation history, never against `organizations.parent_id`. On
a **lifecycle event**, the acting council genuinely *is* the one-level-above
body, so that call passes `organization_id` and needs no third argument
override — `p_context` defaults to `'organization_affiliations'` and the
lifecycle trigger passes `'organization_lifecycle_events'` explicitly. Both
DECISION-135 and DECISION-139 are amended in place with dated correction
notes (history not rewritten) recording this as the decisions' corrected text.
Verified independently against G-3.0403(c)/G-3.0502(d)/G-3.0502(e) — the
built algorithm is the polity, not merely a workable simplification of it.

### Ruling A4 — No acting-user context; `closed_by`/`recorded_by` null (deviation 4)

**Accepted for this pipeline. Deferred, not required for batch B/C.** There is
no `app.current_user_id` GUC in this platform today — only `app.
current_org_id` — and there is no application caller of
`presby_transfer_affiliation()` yet (the lifecycle/affiliation-recording UI is
its own future pipeline). Inventing a caller-supplied user-id parameter would
be exactly the identity claim this function's whole confused-deputy shape
refuses (the same reasoning that keeps it from accepting a caller-supplied
acting-org id). Correct to leave `closed_by`/`recorded_by` null rather than
paper over the gap. **This is a real, platform-wide need** (every
`SECURITY DEFINER` function that wants to attribute an act to a person, not
just this one) and belongs to whichever future pipeline builds the
`app.current_user_id` GUC set by `withOrgContext()` the same way
`app.current_org_id` already is — recorded as a `docs/TODO.md` line in this
commit, not silently dropped.

### Ruling A5 — `organization_lifecycle_events` append-only-by-grant, and a related finding on `organization_affiliations` (deviation 5)

**Rejected as insufficient on the owner connection, for a reason this same
migration already establishes elsewhere. Fix required before batch B
proceeds, not deferred.** The append-only-by-grant approach is correct and
sufficient *for `presby_app`* — no UPDATE/DELETE grant is stronger than a
convention, and the comparison to `roll_actions`'s trigger-based freeze isn't
apples-to-apples for that connection alone. But the built migration also
grants `presby_platform` — the `getPlatformDb()` connection, which already
bypasses RLS by design — **full `select, insert, update, delete`** on
`organization_lifecycle_events`, and the same full grant (`select, insert,
update, delete`) on `organization_affiliations`, when Phase 3's Ruling 3 only
ever required `insert` on the affiliation table for `createOrganization()`'s
own write. A `SECURITY DEFINER` function runs with its *owner's* privileges
regardless of what its caller is granted, so `presby_transfer_affiliation()`
needed none of that extra grant to do its own internal UPDATE — the widening
bought the implementation nothing and reopens, on the one connection that
already has the most reach, exactly the "a raw mutation bypasses the
function's authority check, the uniform-message discipline, and the
provenance rule" hole DECISION-135's function-mediation rule exists to close.
This is the same class of hazard `presby_guard_organizations_delete()`
already names in this very migration ("`BYPASSRLS` exempts a role from RLS
policies, never from triggers... This is the path that matters" — the
2026-08-31 58-org cascade went through `getPlatformDb()`, not a tenant
connection).

**Required, before batch B (increment 3) begins, as a correction to the still-
uncommitted `drizzle/0044`** (idempotent and re-appliable per the implementer's
own verification — this is completing increment 2 correctly, not opening a
new increment):

1. Narrow `presby_platform`'s grant to `select, insert` on both
   `organization_lifecycle_events` and `organization_affiliations` (dropping
   `update, delete` from both).
2. Add `presby_freeze_lifecycle_event()`, a `BEFORE UPDATE OR DELETE ON
   organization_lifecycle_events` trigger mirroring
   `presby_freeze_approved_roll_action()`'s shape, firing on **both**
   connections (the owner path is the one that matters, per the reasoning
   above) — belt-and-braces over the grant, not a replacement for it, matching
   the standard already set for `roll_actions_freeze` and
   `presby_guard_organizations_delete()` in the same file.
3. A parallel freeze trigger on `organization_affiliations` is **not**
   required — `presby_transfer_affiliation()` itself performs the row's only
   legitimate UPDATE (closing a row) as part of its own transaction, and a
   trigger firing on every UPDATE would need to distinguish "the DEFINER
   function's own write" from "a raw mutation," which is exactly what the
   narrowed grant in (1) already prevents without that complexity — the grant
   removal is sufficient once `presby_platform` can no longer UPDATE at all.
4. New `scripts/test-rls.sql` assertions: the owner connection cannot
   `UPDATE`/`DELETE` an `organization_lifecycle_events` row without first
   disabling the trigger (mirroring the existing `organizations` delete-guard
   proof shape), and `presby_platform` no longer holds `UPDATE`/`DELETE` on
   either table (the grant-shape assertion style section 29 and section 32
   already use).

`organization_successions`' existing grant (`select, insert, delete` to both
`presby_app` and `presby_platform`, matching) is **not** touched by this
ruling — the deferred cardinality trigger's own DELETE-on-correction case
already requires that grant symmetrically, it carries no minute/authority
text, and the implementer flagged the `presby_app`/`presby_platform`
inconsistency there deliberately rather than by oversight.

### Incidental finding — `isUniqueViolation()` dead-code fix

**Belongs in this pipeline's own commit as a separate `fix:` commit, not
folded into the `feat:` commit, and does not need its own work-log.** This is
a real, pre-existing bug (the TOCTOU-race `catch` branch in
`createOrganization()`'s slug-taken path had never fired, because Drizzle
wraps the driver error and the original SQLSTATE lands on `.cause`, one level
below where `err.code` was being read), found incidentally while building the
`invalid_parent` mapping in the same function. CLAUDE.md's mixed-commit rule
("one commit, one prefix... there is no compound prefix") applies regardless
of how the fix was discovered — split it into its own `fix:` commit with
`Caught-By: agent-review` (an agent had to read `pgErrorCode()`'s cause-chain
handling to notice this; no non-mandatory or mandatory automated check would
have caught it), `Discovered-In: Phase-4`, and a `Work-Log:
2026-09-24-lifecycle-affiliation-returns` trailer (this pipeline's slug — a
one-function fix inside a file this pipeline is already deep in does not
warrant a second work-log entry under the Classification table's Trivial/
Polish carve-outs). The code change itself is accepted as-is; no further
design input needed.

### Incidental finding — real PII in `organization_profiles` on the shared `development` branch

**Not a code or schema defect, and not this pipeline's fix to make — flagged
for the operator, with a `docs/TODO.md` line added in this commit** (see
"No acting-user context" ruling's sibling entry above). This is very likely
the *same underlying row* the 2026-08-30 secrets-tripwire audit already found
and explicitly decided not to touch ("the underlying dev-database row is
unaffected and not itself public," `docs/TODO.md` line 264) — this batch
rediscovers it, still present, during unrelated fixture cleanup. The No Real
Data invariant is scoped to the repository by its own text ("This repository
is public...") and holds on the letter; `check:secrets` correctly does not
fire on a database row. But a real congregation's real address and phone
number sitting in a database several agents and sessions can query is a live
operational fact worth a name in the backlog rather than a second silent
pass-through. The implementer was right not to delete it unilaterally (it may
be deliberate scaffolding for the public-site work) — the TODO line asks for
an explicit operator decision (scrub it, or record on the record that it is a
deliberate, bounded exception), not a database edit from this review.

### What batch B and batch C must now do differently

- **Batch B (increment 3, the about-org trigger) does not start until Ruling
  A5's fix lands** — narrow the two grants, add the freeze trigger, add the
  `test-rls.sql` assertions. This is a correction to the already-written
  (and still uncommitted) `0044`, not a new migration number.
- Batch B otherwise proceeds exactly as Implementation Order item 5 and the
  Phase 4 Handoff section specify: `presby_org_affiliated()` and
  `presby_affiliation_parent_as_of()` are already live from increment 2;
  increment 3 (`0045`) adds only the enforcing trigger on the five about-org
  tables, re-grepping for the fifth (`src/lib/db/domain/officers.ts:243`'s
  `appointments.servingOrgId` per the Phase 4 Handoff note is the strong
  candidate, not yet confirmed). Re-read `resolveMemberCongregation()`
  (`src/lib/presbytery.ts:143`) and `src/lib/credentials.ts:522,710` against
  `presby_org_affiliated()` on every seeded fixture before wiring the trigger,
  exactly as Phase 3's Edge Cases already ask.
- **Batch C (increments 4–5)** needs no change to its own scope from this
  amendment. `presby_publish_sasr_snapshot()`'s rewrite in increment 5 must
  use `presby_affiliation_parent_as_of()` exactly as specified — that function
  shipped correctly in batch A and this amendment does not touch its
  contract. The API Contract's exact signatures for
  `presby_assert_council_authority()` (now three parameters, `p_context`
  defaulted) and `presby_transfer_affiliation()` (reordered, per Ruling A2)
  are corrected in place above; no other function signature in the Phase 3
  API Contract changes.
- **`createOrganization()`'s TypeScript extension is unaffected** by any of
  the five rulings — it already only ever performs an `INSERT` on
  `organization_affiliations`, which is exactly the grant Ruling A5 narrows
  `presby_platform` down *to*, not away from.

---

## Amendment after batches B and C (2026-09-24, tech-lead)

Batch B's Implementer Notes named five spec defects/deviations plus one loop-back
candidate; batch C named four spec defects, one orchestrator-directed spec
addition (delivered, not a deviation), and three loop-back candidates. Per
CLAUDE.md this is the second Phase 3 return in this pipeline. **Ruling on all
thirteen items below: none requires a Phase 4 loop-back.** Every item either
confirms the built shape as correct (and corrects the design authority to match,
same discipline as "Amendment after batch A"), or is accepted as a deliberate,
named gap with a `docs/TODO.md` line for the pipeline that owns closing it. QA
may proceed on the current tree. `docs/schema-design-2.md` §2b/§5/§9/§2d and
`docs/decisions.md` DECISION-135/136/137 are amended in the same commit as this
section (dated correction notes appended, history not rewritten, matching the
convention "Amendment after batch A" established for DECISION-139).

### Ruling B1 — `per_capita_rates` never carried the about-org pattern; four tables, not five (batch B finding 1)

**Confirmed. The "five" figure was wrong from round 3 forward, and `per_capita_rates` was never meant to gain an `about_org_id`.** Its shape (`organization_id, billing_year, basis_year, rate_per_member, updated_by, updated_at`) is one row *set by* a presbytery *for itself* per billing year — a rate schedule, not a record about any particular congregation. The "five" count traces to Phase 1's Gaps section (analyst, "four explicit plus one" naming `per_capita_rates` as one of the four explicit ones) and was carried forward uncorrected through Phase 2's Ruling 3/§3 text and into `docs/schema-design-2.md` §9.1/R3.14 without anyone checking it against the live schema — a documentation drift, not a design reversal. **The correct enumeration, now recorded as the design authority:** `congregation_oversight`, `congregation_statistics`, `per_capita_records` (all `about_org_id`), and `appointments` (`serving_org_id`). `docs/schema-design-2.md` §9.1, the R3.14 table row, and the §2b migration-order line are corrected in this commit (see the new §2d below). `scripts/test-rls.sql` 33(a)'s assertion of `per_capita_rates.about_org_id`'s absence stays as a permanent regression guard, not a temporary note.

### Ruling B2 — the about-org `as_of` instant is the row's whole year, tested at both endpoints; the gap is accepted (batch B finding 2)

**Confirmed as built, and recorded as the design's stated semantics rather than left as a batch-local note.** `presby_check_about_org_affiliated()` accepts a row if the about-org was affiliated at **either** January 1 or December 31 of the row's year. This is a deliberate under-approximation of "was affiliated at some point during the year," chosen because the alternative (a true range-overlap test against the recursive ancestry walk) is materially more machinery for a case — an affiliation that both opens and closes inside one calendar year — that has not occurred in this platform's history and is not expected to. **Accepted gap, stated plainly:** such a year's row would be refused by both the old and the new council. If it ever matters in practice, the fix is a range-overlap test in `presby_org_affiliated()` itself, not a schema change. Recorded in `docs/schema-design-2.md` §2d.

### Ruling B3 — `getPlatformDb()` connects as `neondb_owner`; no grant constrains it, only triggers — a standing fact for every future design (batch B finding 3)

**Confirmed, and elevated from a batch-local observation to a standing design fact.** `PLATFORM_DATABASE_URL` authenticates as `neondb_owner`, a member of both `presby_platform` and `presby_app` who holds every privilege on every table by **ownership**, independent of any `grant`/`revoke` statement. This does not weaken any ruling already made — Ruling A5's grant-narrowing and F38's revoke are still correct and still worth doing, both as the statement that binds the day a real, non-owner `presby_platform` login role exists, and as documentation of intent that the next reader should not undo — but it means **every claim in this pipeline of the shape "X cannot happen because the grant forbids it" is false on the `getPlatformDb()` connection today, and the only real backstop there is a trigger** (`presby_guard_organizations_delete()`, `presby_freeze_lifecycle_event()`, `publications_freeze`, and their siblings). Every future design in this codebase that reasons about `getPlatformDb()`'s reach must reason from the trigger layer, not the grant layer. Recorded in `docs/schema-design-2.md` §2d and appended to DECISION-135/136 (below) since both rest on exactly this mechanism. Not a `CLAUDE.md` change from this pipeline — Key Invariants edits are the documentation review's business, and a `docs/TODO.md` line below asks for it to be considered there.

### Ruling B4 — `drizzle/0009:44`'s blanket grant to `presby_platform` is F38's unremoved root cause (batch B finding 4)

**Confirmed; accepted as a named, standing risk rather than fixed in this pipeline.** `grant select, insert, update, delete on all tables in schema public to presby_platform` (`drizzle/0009:44`) is the same additive mechanism that produced F38 on `organizations`, and it now touches **five** tables whose grants this pipeline narrowed by hand: `organizations`, `organization_affiliations`, `organization_lifecycle_events`, `statistical_returns`, `publications`. A bare re-application of `0009` after any of `0044`/`0047` in an out-of-order replay would re-widen all five; a replay from zero is unaffected because migration order preserves the narrowing, and `scripts/test-rls.sql`'s grant-shape assertions would catch a live re-widening regardless. Fixing `0009` itself (a scoped grant instead of a blanket one, or a documented convention that new tables get an explicit narrow grant rather than inheriting the blanket one) is out of scope for a schema-shape pipeline and belongs to the security review. `docs/TODO.md` line added below.

### Ruling B5 — `organization_successions` still grants `presby_platform` UPDATE (batch B finding 5)

**Confirmed; not touched, deliberately, and flagged rather than silently carried forward a second time.** Ruling A5 scoped its narrowing to `organization_lifecycle_events` and `organization_affiliations` only; `organization_successions` keeps `select, insert, update, delete` to both `presby_app` and `presby_platform` from Phase 3's original Data Model, and the `update` grant has no corresponding legitimate write path today (the table's only writes are inserts alongside a lifecycle event, and deletes under the deferred cardinality trigger — no code path updates a succession row). This is a smaller version of the same class of gap Ruling A5 closed on the other two tables. Not fixed here because it is not blocking and reopening `0044` a third time for a table batch B did not otherwise touch risks scope creep in a pipeline that is otherwise done; `docs/TODO.md` line added below for the security review to close deliberately (narrow the grant, or state why `update` is wanted).

### Ruling B6 — a council can be refused a historical row for a present-day member congregation; no year guard or error mapping exists yet (batch B finding 11)

**Confirmed as correct, intended trigger behavior (R3.14/F30/F31's whole point), and explicitly not a defect.** `setCongregationStatisticsAction` lets a presbytery clerk pick any year for any current member congregation; after increment 3, a year before that congregation's affiliation to the presbytery opened is refused at the database. This is the mechanism working as designed — a presbytery should not be able to record statistics for a year during which a different presbytery had jurisdiction — but the shipped form has no year guard and no mapping from the resulting `insufficient_privilege` error to human copy, so a live clerk hitting this today would see a raw database error. `docs/TODO.md` line added below for whichever pipeline next touches `/o/<slug>/admin/reports`.

### Ruling C1 — the `congregation_statistics` retrofit FK: `(publication_id, about_org_id)`, not `(publication_id, organization_id)` (batch C spec defect 1)

**Confirmed correct, and the Phase 3 Data Model above is wrong on this one point** (the original text under Increment 5 reads `foreign key (publication_id, organization_id) references publications (id, organization_id)`). `congregation_statistics.organization_id` is the **recipient presbytery**; `publications.organization_id` is the **source congregation** — different organizations by construction, per DECISION-120 meeting D20. The FK as originally specified would have rejected the first row it was meant to protect. The column that actually equals `publications.organization_id` is `congregation_statistics.about_org_id`, so `foreign key (publication_id, about_org_id) references publications (id, organization_id)` is the corrected, adopted shape — it **preserves** F2's guarantee (a projection cannot claim a publication recorded by a different congregation) rather than weakening it. Corrected in `docs/schema-design-2.md` §2d; DECISION-137 gets a dated correction note below. Not a loop-back — the design's intent was unambiguous and only the column name in the original spec was wrong, and the built migration already has it right.

### Ruling C2 — the increment-3/increment-5 as-of collision: accepted for now, open polity question named, TODO for publish-UI copy (batch C finding 14)

**Accepted as the current behavior; the open polity question is real and is not resolved by this ruling.** Two independently correct rules collide for one narrow case: `congregation_statistics_about_org` (increment 3) validates the projection against the affiliation **as of the report year** (the F30/F31 archival-attribution rule — "which presbytery received a 1990 return"), while `publications.recipient_org_id` (increment 5/D19) is resolved **as of `published_at`**, i.e. the presbytery of *current* membership, because G-3.0108(a) makes it the reviewing council. For a congregation redistricted between the report year and the filing date, those are two different presbyteries, and a self-publish for that report year is refused with a named `invalid_parameter_value` — correct behavior (it fails loudly and before any row is written, not silently or after a partial write), but the underlying question — should such a return be self-published to the current presbytery at all, or is it necessarily the former presbytery's business to enter — is a genuine polity question this ruling does not have the standing to close. I do not have web access in this role to verify the deciding citation (only the architect does, per the Agent Roster). **Ruling: accept the current refusal as safe and correct pending that verification; do not widen the about-org check speculatively.** Recorded as an open question in `docs/schema-design-2.md` §2d for the architect's next pass over this area, and a `docs/TODO.md` line is added below for the publish-UI pipeline's error-mapping copy regardless of which way the polity question resolves — the named error exists either way and needs human-readable text.

### Ruling C3 — `statistical_returns_submitted_is_self` does not block the future D16 grant flow (batch C spec defect/deviation 7)

**Confirmed compatible; no design change needed.** The CHECK (`provenance = 'submitted' ⟹ organization_id = about_org_id`) is a strengthening beyond Phase 3's prose, added because nothing previously enforced that a submitted return's owner and subject are the same body. `docs/schema-design-2.md` §5's own D16 row (R3.10) already establishes that a grant-submitted return is "a `statistical_returns` row (`provenance = 'submitted'`)" written by an authorized person **on behalf of the congregation named in the grant** — the row's `organization_id` and `about_org_id` are both that congregation, exactly the shape self-publish already produces. The CHECK does not need to see *who* authorized the write (the grant token, the session, or the congregation's own login), only that the row is self-consistent — so it constrains nothing D16 needs. Increment 6's own security review should re-confirm this against its actual write path when it is designed, but no `ALTER` is anticipated.

### Ruling C4 — the publish function's form version is hard-coded `'2024'`; correct, and the import pipeline's obligation is stated (batch C deviation 6)

**Confirmed as the correct reading, over the Phase 3 API Contract's own "resolve current `form_version_key` for `p_report_year`" text, which is corrected to match.** `presby_publish_sasr_snapshot()`'s ~62-parameter allow-list **is** the 2024 field set (increment 4's own `DO`-block proves the 1:1 correspondence); recording a payload gathered through those parameters under any other generation's `form_version_key` would misrepresent which form was actually filled out, regardless of what `p_report_year` says. Resolving by year would additionally make every pre-2024 report year unpublishable through this function today, since `'1984'`/`'2014'`/`'2022'` are deliberate fail-closed placeholder specs. **What this means for the future D13 import pipeline, stated explicitly so it isn't rediscovered:** import writes to `statistical_returns` directly (`provenance = 'imported'`), never through `presby_publish_sasr_snapshot()`, and it cannot write a historical-generation payload until the corresponding `sasr_form_versions` placeholder is replaced with a real `field_spec` — filling in `'1984'`/`'2014'`/`'2022'` is a data edit against `sasr_form_versions`, owed to increment 7, not a schema change. `docs/schema-design-2.md` §2d records this.

### Ruling C5 — withdrawal provenance is part of D20 (batch C spec addition from the orchestrator)

**Recorded as part of D20's shape, not as a separate decision.** `publications.withdrawn_by`/`withdrawn_minute_reference`, the one-transition freeze on `publications_freeze`, and the `publications_withdrawal_shape` CHECK are exactly the D26/DECISION-135 provenance discipline ("a close is never an unattributable mutation of a provenanced record") applied to withdrawal, and `docs/schema-design-2.md` §2a already anticipated this in its post-round-2 chain note before batch C built it. Two edits in this commit close the loop: the D20 table row in §2 is updated to list `withdrawn_by`/`withdrawn_minute_reference` alongside `withdrawn_at` (it previously named only `withdrawn_at`), and DECISION-135 gets a dated correction note recording that the future `presby_withdraw_publication()` function is confirmed as this decision's writer, in the same confused-deputy shape as `presby_transfer_affiliation()`, not a new mechanism.

### Ruling C6 — `sasr_reports`' removal from `drizzle/0009`'s `tenant_tables` array: consequence confirmed as stated (batch C spec defect 3)

**Confirmed; the stated consequence is accurate and no further action is needed.** Phase 3's Data Model already documented that `0009`'s array is a historical record of what that migration did, not re-executed, so it is correctly left untouched; `0047`'s `drop table if exists sasr_reports` is sufficient for a replay from zero. The one live consequence — re-applying `0009` **alone and out of order** after `0047` would fail on the missing table — is the same additive-replay hazard named in Ruling B4 and is covered by the same `docs/TODO.md` line, not a second one.

### Ruling C7 — `congregation_statistics` and its `0038` siblings are absent from `dev-docs.ts`'s `MODULES` map (batch C finding 15)

**Confirmed as a real, pre-existing gap from the 0038 pipeline, not introduced here, and not this pipeline's fix to make** (regrouping four already-shipped tables on `/developer` is a different, small, self-contained change, not part of this schema pipeline's scope). `docs/TODO.md` line added below, naming it for the documentation review or a small dedicated fix, whichever comes first.

## Amendment after Phase 5 (2026-09-24, tech-lead)

QA's Phase 5 Finding 1 is the third Phase 3 loop-back on this pipeline, and the
only one triggered from Phase 5 rather than Phase 4. It reports a demonstrated
repro, not a suspicion: as Northern Reach, QA inserted a lifecycle event; under
Alder Creek's tenant context (a congregation with standing over nothing),
`select count(*) from organization_lifecycle_events where id = <that event>`
returned 0, and the very next `insert into organization_successions (event_id,
…)` naming that same invisible event succeeded. `organization_successions`
carried `presby_app` grants of `SELECT, INSERT, DELETE`, no RLS, and no
`organization_id` — and Phase 3's own Data Model (the "Increment 2" section
above) justified that shape with "visibility follows the parent `event_id`'s
tenant policy via a join." **That sentence was wrong, on the same axis Phase 2
Ruling 1 exists to close:** a join can express what a SELECT happens to
return; it cannot express what an INSERT or DELETE is allowed to write, and
this table's writes obeyed no policy at all. This is a genuine Phase 3 design
defect, not a Phase 4 deviation from a correct design — Ruling 1's rule
("cross-council access to the three-axis tables is function-mediated, never
policy-mediated") was stated for exactly this class of table and was not
applied to this one member of the class. The corrected sentence is now in
place in the Increment 2 Data Model above, and is reproduced without the
"via a join" claim in `docs/schema-design-2.md` §3 and §2d (both amended in
this commit).

**Ruling: database-admin's fix, as routed by the orchestrator, is confirmed
without change.** In `drizzle/0044` (same migration file and number, per this
pipeline's own convention of correcting an uncommitted-to-the-ledger increment
in place rather than opening a new one — see "Amendment after batch A"'s
identical treatment of Ruling A5):

1. `insert, update, delete` on `organization_successions` revoked from
   `presby_app`; `SELECT` stays, ungated by RLS, because the topology itself
   is public — the org tree already publishes which congregation became
   which (D10) — so this is a confidentiality non-issue and only ever was an
   integrity one, matching Finding 1's own read.
2. `presby_platform` narrowed to `select, insert` (dropping `update` and
   `delete`), closing Ruling B5's still-open TODO item in the same stroke
   rather than leaving two separate follow-ups for the same table's grant
   shape — see the `docs/TODO.md` reconciliation in this commit.
3. A `BEFORE INSERT` trigger, `SECURITY DEFINER` (F26: it must read across
   `organization_lifecycle_events`' own tenant policy to see the row at all,
   the identical reasoning that makes `presby_assert_council_authority()` and
   every other cross-table checker in this migration DEFINER), asserting the
   named `event_id` exists and, when `app.current_org_id` is set, that its
   `organization_id` equals `presby_current_org()`.
4. The grant shape pinned by a new `scripts/test-rls.sql` assertion in the
   32-series, alongside 32(b)/(c)/(m) and 34(a) — Finding 1 named this
   table's assertion as the one gap in that coverage, and it is now closed
   rather than carried forward a third time.
5. The future `presby_record_lifecycle_event()` DEFINER function (the
   lifecycle-UI pipeline) becomes the sole tenant-side writer — it runs as
   table owner and needs no grant to `presby_app` at all, so the revoke in
   (1) costs that future function nothing.

**On the orchestrator's alternative (`organization_id` + FORCE RLS): considered
and rejected, for a reason specific to this table.** `organization_lifecycle_
events` and `organization_affiliations` both have a natural recording council
of their own — the acting presbytery, the recording council — distinct from
the body the row is about, which is exactly what their `organization_id`
column states. `organization_successions` has no such second party: it names
only a predecessor and a successor organization, both of which are the
*subject* of the parent event, never the actor. Adding `organization_id` here
would not record a fact the table is short of — it would duplicate the parent
event's `organization_id`, and every future writer (the DEFINER function, any
correction path) would owe a second column to keep in sync with the first, a
new place for the two to drift apart with no compensating gain: FORCE RLS on a
derived, copy-of-the-parent column enforces nothing a `SECURITY DEFINER`
`BEFORE INSERT` check against the real parent doesn't already enforce more
simply and with one fewer fact to maintain. The chosen fix keeps a single
derivation of ownership (the event), which is the same principle
`organizations.parent_id`/`path` already rest on in this same migration
(derived caches of one upstream fact, never a second copy a trigger has to
reconcile).

One point flagged as a minor call, not a required change: `presby_assert_
council_authority()` and the two `presby_deny_*_change()` helpers raise a
single uniform literal per table (F40/DECISION-040's enumeration-oracle
discipline), because `subject_org_id`/`parent_org_id` are drawn from a small,
practically-enumerable set of known organization ids. `event_id` is a random
UUID with no comparably small guessable domain, so the new trigger
distinguishing "no such event" (the existing FK violation) from "that event is
not yours" (the new check) does not reopen F40's oracle in practice — a
tenant that does not already possess a specific event id has no practical way
to probe for one. Database-admin may use one message or two; either is
acceptable, and this pipeline does not require the uniform-message treatment
here the way it did for the affiliation table's EXCLUDE constraint.

QA's targeted re-verification is scoped to: the two grant revocations, the new
trigger (positive case — same-org event; negative case — cross-org event,
reproducing Finding 1's exact repro and confirming it now fails; and the
absent-tenant-context case, which the trigger's own conditional must still
permit for `presby_platform`'s eventual bootstrap-style writes), and the new
`test-rls.sql` assertion actually failing if the grant is manually widened
back (a regression-guard smoke, not just a positive-path check). No other
part of Phase 5's PASS is reopened.

---

## Amendment after external implementation review (2026-09-24, tech-lead) — fourth Phase 3 loop-back

**Context.** `drizzle/0043`–`0047` are on `main` (`36a2bb8`, `1a5201e`) but
applied only to the `development` Neon branch — nothing has reached
production, and deploys do not auto-migrate — so this is a **migration
correction in place**, same files, same numbers, per this work-log's own
precedent (Ruling A5.1, F46). An external reviewer read the exported table
shapes (tables, constraints, grants, RLS, trigger placement — function bodies
were collapsed in the export and could not be verified) against the five
migrations and returned five findings. The orchestrator verified every claim
against the actual working tree before routing this loop-back; all five are
confirmed real. This is a **constraint-and-authority hardening pass** — no
new entity, no reopening of round 2's shape — with one load-bearing
correction to the review's own diagnosis: **grant-narrowing alone does not
close any of these holes.** `docs/schema-design-2.md` §2d's F44 / this
work-log's Ruling B3 already established, for this exact pipeline, that
`PLATFORM_DATABASE_URL` authenticates as `neondb_owner`, which owns every
table and bypasses every `grant`/`revoke` outright — a fact the reviewer's
own prose brushes past for `organization_identifiers` and `organization_
affiliations` (treating "revoke the grant" as sufficient) while correctly
naming it for `organization_affiliations`' owner-path UPDATE risk. Every
ruling below that closes a real hole does so with a **trigger**, using the
grant narrowing as the belt for the day a real, non-owner `presby_platform`
login exists (Ruling B3's stated intent), never as the buckle.

Findings are logged as F47–F52 in `docs/schema-design-2.md` §2f. Each ruling
below names its mechanism, the deviation (if any) from the reviewer's literal
text, and the tests owed. `docs/decisions.md` gets one new umbrella entry,
DECISION-140, plus dated correction notes on DECISION-135 and DECISION-137.

### Ruling 1 — `organization_identifiers` (F47): SELECT-only by grant, UPDATE/DELETE-closed by trigger

Confirmed. `presby_app` currently holds `select, insert, update, delete` with
no RLS (`drizzle/0043:76`) — a tenant connection can rewrite or erase another
organization's identifier row, including flipping `is_verified`, the column
that controls global uniqueness.

**Mechanism, not just a grant edit** (per the F44 note above — the real
attacker-relevant path here is the *owner* connection, which no revoke
touches):

1. `revoke insert, update, delete on organization_identifiers from presby_app; grant select on organization_identifiers to presby_app;`. `presby_platform` keeps its existing `select, insert, update, delete` grant, unchanged — same accepted-risk class as every other `presby_platform` DML grant in this pipeline (`organization_affiliations`, `organization_successions`): documentation of intent for the day a real non-owner `presby_platform` login exists, inert today because nothing authenticates as that role directly.
2. New function `presby_set_organization_identifier(p_organization_id uuid, p_kind text, p_value_normalized text, p_is_verified boolean default false, p_source text default null) returns uuid`, `language plpgsql security definer`. Actor is `presby_current_org()`. Standing: `v_actor = p_organization_id` (an org may write its own identifiers) `or presby_org_affiliated(p_organization_id, v_actor, current_date)` (a council over the subject may write/verify a member's identifier — the onboarding case). Anything else raises a new, table-specific literal via a new helper `presby_deny_identifier_change()` — its own literal, not a shared one, following DECISION-139's "one literal per table" discipline (this table carries no EXCLUDE constraint, so F40's specific oracle risk does not transfer, but a shared string would still let a reader assume the two tables' rejection surfaces are interchangeable when they are not). `is_verified` is settable only through this path — no separate mechanism needed since the function is the sole sanctioned writer.
3. `BEFORE UPDATE OR DELETE` guard trigger `organization_identifiers_guard`, firing on **every** connection (mirrors `organizations_guard_reparent`'s shape exactly): reject unless `current_setting('presby.identifier_trigger_active', true) = 'true'`. **New GUC, not a reuse of `presby.affiliation_trigger_active`** — unrelated subsystem, unrelated table; reusing it would make one flag mean two unrelated "am I in a sanctioned path" claims across two tables that share no transaction in practice, which is a worse false economy than the affiliation/organizations reuse below (same function, same transaction, same actual claim). `presby_set_organization_identifier()` sets it at entry, transaction-local.
4. Scope, deliberately narrower than the reviewer's prose: the guard covers UPDATE and DELETE only, the two operations the review's own example names ("change or delete Congregation B's OGA PIN"). INSERT is left ungated beyond the grant narrowing — a colliding `is_verified = true` INSERT is already refused by the existing partial unique index, and an INSERT of a false unverified claim *about* another org is the same bounded, rare, reviewed `presby_platform`-only risk class already accepted elsewhere in this pipeline. Engineering a bootstrap-vs-tenant distinction into an INSERT guard (so `createOrganization()`'s legitimate self-insert survives) is more machinery than today's problem needs; named as an accepted residual in `docs/TODO.md` rather than solved here.

**Tests owed** (`test-rls.sql`, new subsection under 34): grant-shape assertion (`presby_app` = SELECT only); a repro that a raw owner-connection UPDATE and DELETE **succeed today** (failing-first — run before the trigger exists to prove the hole), then fail after; `presby_set_organization_identifier()` authorization matrix (self org succeeds, an affiliated superior council succeeds, an unrelated org is uniformly denied). **Vitest**: `organization_identifiers` has never had a dedicated test file (confirmed — no `.test.ts` anywhere references it) despite shipping in `drizzle/0043`; this ruling is the first code that will exercise it, so database-admin creates `src/lib/db/domain/org-identifiers.test.ts`, not a describe block bolted onto an unrelated file.

### Ruling 2 — `organization_successions` (F48): add the UNIQUE, confirm the rest holds

Confirmed real (the missing UNIQUE) and confirmed already-closed on the other two points, verified by reading the actual trigger bodies, not just the comments:

1. `alter table organization_successions add constraint organization_successions_edge_unique unique (event_id, predecessor_org_id, successor_org_id);` — trivial DDL add to `drizzle/0044` in place.
2. The cardinality function (`presby_check_succession_cardinality()`, `drizzle/0044:944-978`) already counts `count(distinct predecessor_org_id), count(distinct successor_org_id)` — a duplicate edge cannot inflate the count, so the reviewer's stated concern ("a duplicate edge could satisfy a >= 2 predecessors rule without representing two predecessors") does not reach this implementation. The UNIQUE constraint is still correct to add — it is data integrity in its own right, independent of whether cardinality happens to be immune — but it is not closing a live cardinality-gaming bug.
3. **No UPDATE arm needed on the cardinality trigger.** `presby_freeze_succession()` (`drizzle/0044:1017-1026`) already rejects every UPDATE, on every connection, before the cardinality trigger could ever see one — adding a dead UPDATE arm to an AFTER trigger that can never fire would be noise, not hardening. Ruled: no change.

**Tests owed**: one `test-rls.sql` assertion — inserting the same `(event_id, predecessor_org_id, successor_org_id)` triple twice is rejected by the new UNIQUE (a straight constraint-violation proof, no new trigger to exercise).

### Ruling 3 — `organization_affiliations` (F49): four CHECKs, and a guard trigger the table was the one exception to

Confirmed on both counts. The CHECKs the reviewer names are real gaps in the
row shape; the missing UPDATE/DELETE guard is real and is the table `drizzle/
0044`'s own comment explicitly argued didn't need one ("No freeze trigger
here... the grant alone is the right instrument for THIS table") — an
argument F44/Ruling B3 (discovered in the *same* migration, later in the same
pipeline) already disproves for every other table. This table simply hadn't
been revisited against its own pipeline's own later finding.

**1. Four CHECK constraints**, added to `drizzle/0044` in place:

- `organization_affiliations_recorded_has_from check (authority <> 'recorded' or effective_from is not null)` — every `'recorded'` row `presby_transfer_affiliation()` writes already supplies `effective_from`; only `'backfill'` rows are null (F41).
- `organization_affiliations_range_order check (effective_to is null or effective_from is null or effective_to > effective_from)` — closes the empty-range loophole the EXCLUDE constraint's `daterange()` construction does not catch (a same-day open/close produces a valid *empty* range, which overlaps nothing and so violates no EXCLUDE constraint).
- `organization_affiliations_closed_shape check ((effective_to is null and closed_by_org_id is null and closed_on is null and closed_minute_reference is null) or (effective_to is not null and closed_by_org_id is not null and closed_on is not null and closed_minute_reference is not null))`. **Deviation from the reviewer's literal text**: they wrote "all four `closed_*` provenance fields" — but `closed_by` is deliberately, permanently null on every close (Ruling A4: no `app.current_user_id` GUC exists), so a CHECK requiring `closed_by is not null` would reject every legitimate close `presby_transfer_affiliation()` performs today. `closed_by` is excluded from this CHECK on purpose; noted here so the deviation isn't silently absorbed.
- `organization_affiliations_not_self check (subject_org_id <> parent_org_id)`.

**2. The guard trigger**, closing the gap the reviewer calls out directly ("someone using `getPlatformDb()` can still rewrite 1994 affiliation history directly"):

- `BEFORE UPDATE` arm: reject unless `current_setting('presby.affiliation_trigger_active', true) = 'true'`. **Reuse the existing GUC**, moved earlier — `presby_transfer_affiliation()` currently sets it only immediately before calling `presby_apply_affiliation_to_org_tree()` (`drizzle/0044:575`); move the `set_config` call to the top of the function, before its own `UPDATE ... SET effective_to = ...` close. One GUC, one meaning ("this transaction is running the sanctioned transfer path"), now covering both of its consumers (the `organizations` reparent guard and this new one) — unlike Ruling 1's identifier guard, this *is* the same function, same transaction, same claim, so reuse is the minimum-complexity answer, not a false economy. Update the GUC's `comment on` / inline documentation to say so.
- `BEFORE DELETE` arm: **cannot simply mirror `organization_successions`' unconditional freeze** — `subject_org_id` is `ON DELETE CASCADE` *specifically* so a `deletable_until`-stamped test fixture's teardown can cascade-delete its affiliation rows (`drizzle/0044`'s own comment on the FK swap says so). An unconditional DELETE freeze would break that teardown path the day this trigger ships. Fix: the DELETE arm checks the *same* GUC, and `presby_guard_organizations_delete()` (the `organizations` table's own delete guard, which already validates `OLD.deletable_until` before permitting the parent delete) additionally does `perform set_config('presby.affiliation_trigger_active', 'true', true)` right after that validation, before returning `old`. The cascade delete that Postgres fires immediately afterward, in the same transaction, is then pre-authorized — no changes needed to any of the 15+ existing test-teardown call sites, the exact design goal `fixture-deletable.ts` already states for the `organizations` guard itself.

**Tests owed**: four CHECK-violation proofs (one per constraint above); a
failing-first proof that a raw owner-connection UPDATE and a raw owner-
connection DELETE **succeed today** and are rejected after; a regression
proof that `presby_transfer_affiliation()`'s legitimate close still succeeds
end-to-end (the GUC now gates something new inside it); a regression proof
that a `deletable_until`-stamped fixture org's DELETE still cascades cleanly
— this is the test that would have caught a naive "always reject DELETE"
implementation, and the reviewer's own suggestion ("mirror the events
freeze") would have failed it.

### Ruling 4 — `statistical_returns` (F50): a provenance-shape CHECK, and INSERT becomes function-mediated

Confirmed. `submitted, reconciled = false, attested_* = null` and `imported,
reconciled = true` are both legal rows today; nothing but `presby_publish_
sasr_snapshot()`'s own discipline (not the schema) keeps a submitted row
attested.

1. `constraint statistical_returns_provenance_shape check ((provenance = 'submitted' and reconciled and attested_by_name is not null and attested_role is not null and attested_at is not null) or (provenance = 'imported' and not reconciled))`.
2. **Dependency database-admin must not miss**: `drizzle/0047`'s own backfill (section 4) inserts `provenance = 'submitted', reconciled = true, attested_at = r.published_at` but leaves `attested_by_name`/`attested_role` NULL — this CHECK, added as written, rejects that backfill outright. Fix the backfill's INSERT in the same migration to supply synthetic placeholder values for both columns (matching the synthetic `source_ref` text two lines below it in the same INSERT list, e.g. `'backfill: reconstructed (drizzle/0047)'` / `'backfill'`), and add this CHECK **after** the backfill runs — same ordering discipline `drizzle/0047` already uses for the `congregation_statistics_publication_fk`.
3. `revoke insert on statistical_returns from presby_app, presby_platform;` (both currently hold it, `drizzle/0046:341-342`). The submitted path is `presby_publish_sasr_snapshot()` (already SECURITY DEFINER, unaffected by the revoke); the imported path has no application writer yet (D13's import function is future work) — until it ships, the only imported-row writer is the migration-time backfill running as owner, which is correct and is the state today.

**Tests owed**: three CHECK-violation proofs (submitted+unreconciled, submitted+missing-attestation, imported+reconciled); a grant-shape assertion that INSERT is revoked from both roles; a regression proof that `presby_publish_sasr_snapshot()` still succeeds (DEFINER, unaffected); a migration-apply smoke confirming the corrected backfill still satisfies the new CHECK (production has zero rows today, so this is a shape proof, not a data-count proof).

### Ruling 5 — `publications` (F51): revoke INSERT, fix the CHECK bug, chain supersession, prove both projection ends

Confirmed on all four points, including the reviewer's flagged CHECK bug.

1. `revoke insert on publications from presby_app, presby_platform;` — function-mediated via `presby_publish_sasr_snapshot()` only (DECISION-135's principle, now applied to this table too — the backfill is unaffected, it runs as owner during migration).
2. **The CHECK bug, confirmed exactly as reported.** `publications_withdrawal_shape` (`drizzle/0047:161-163` and its idempotent twin at `:176-180`) reads `check (withdrawn_at is not null or (withdrawn_by is null and withdrawn_minute_reference is null))` — true when `withdrawn_at` is set and the other two are anything, including both null. Replace both occurrences (the inline `create table` constraint and the `do $$ ... end $$` idempotent add — the latter needs its own `drop constraint if exists` first, since the name is unchanged but the definition is not) with: `check ((withdrawn_at is null and withdrawn_by is null and withdrawn_minute_reference is null) or (withdrawn_at is not null and withdrawn_by is not null and withdrawn_minute_reference is not null))`. Because CHECK constraints bind the table owner (unlike RLS policies and unlike plain grants — F44 does not apply to CHECKs), this alone closes the hole regardless of connection; tightening `presby_freeze_publication()`'s transition message to also name the missing pair is optional polish, not required.
3. **Supersession as a chain.** New `BEFORE INSERT` trigger `presby_check_publication_supersession()`, `security definer` (not for cross-tenant convenience but because an *invoker*-mode version would silently see zero rows for a forged `supersedes_id` pointing at another org's publication — the exact F26 shape this pipeline has hit twice already — and skip the check instead of rejecting it). When `NEW.supersedes_id is not null`: look up the predecessor's `organization_id, recipient_org_id, record_class, artifact_id`; reject (one uniform literal, cause-blind — F40 discipline) if the predecessor does not exist, or if `organization_id`, `recipient_org_id`, or `record_class` differ from `NEW`'s; for `record_class = 'statistical_return'`, additionally join both artifacts to `statistical_returns.report_year` and reject on a mismatch. `create unique index publications_supersedes_once_idx on publications (supersedes_id) where supersedes_id is not null;` forbids two publications naming the same predecessor (forks).
4. **The projection's recipient end.** `alter table publications add constraint publications_id_recipient_key unique (id, recipient_org_id);` and `alter table congregation_statistics add constraint congregation_statistics_publication_recipient_fk foreign key (publication_id, organization_id) references publications (id, recipient_org_id);`, added alongside the existing `(publication_id, about_org_id) -> publications (id, organization_id)` FK. The two FKs share `publication_id` and pin to the same single `publications` row (`id` is a primary key), so together they force `about_org_id = publications.organization_id` **and** `organization_id = publications.recipient_org_id` on the same row — closing the "Presbytery B pointing at a publication whose real recipient is Presbytery A" hole. Add after the backfill, same ordering discipline as the existing FK; the backfill's own INSERT already sets `congregation_statistics.organization_id` to the correct recipient (`r.organization_id`, unchanged by this migration), so no backfill fixup is needed — the new FK should hold immediately.

**Tests owed**: a failing-first CHECK proof (`withdrawn_at` set, other two null — passes today, must fail after); a grant-shape assertion (INSERT revoked from both roles); supersession-trigger proofs for each of the four mismatch axes (org, recipient, record class, report year) plus a positive same-org/same-year republish still chaining; a fork-prevention proof (a second publication naming an already-superseded predecessor is rejected); a composite-FK proof that a `congregation_statistics` row cannot be inserted or updated with a `publication_id` whose `recipient_org_id` differs from the row's own `organization_id`.

### Ruling 6 — Withdrawal semantics (F52): Option A, decided now

**Option A** (the recipient retains the received artifact as historical
record, marked withdrawn, excluded from current calculations) — per this
design's whole permanence philosophy (roll actions are voided, not deleted;
publications are withdrawn, not deleted; a person is merged, never erased)
and per G-3.0107's "a ceased council's records become the property of the
next higher council," which reads oddly next to a mechanism that makes a
withdrawn return simply vanish from the recipient's read.

Concretely, reversing the inconsistency the reviewer found (the read path
was doing B while the projection was doing A):

1. `presby_list_published_returns_to_me()`: **remove** the `and p.withdrawn_at is null` filter batch C shipped (`drizzle/0047:1123`) — this was itself a deviation from Phase 3's original API Contract, made for a reason that no longer holds once the projection also carries the triple (below). Return withdrawn rows; `withdrawn_at` is already in the result shape for the caller to filter on.
2. `alter table congregation_statistics add column if not exists withdrawn_at timestamptz;`. Widen `presby_reject_published_statistics_write()` (`drizzle/0038`, cannot be edited there since 0038 is already released — the widened `create or replace function` and the `add column` ship as new statements in `drizzle/0047`, which is still unreleased) to permit exactly one transition, mirroring `presby_freeze_publication()`'s shape: allow when `old.withdrawn_at is null and new.withdrawn_at is not null and (to_jsonb(old) - 'withdrawn_at') = (to_jsonb(new) - 'withdrawn_at')` (the same by-subtraction comparison the backfill already uses, rather than hand-enumerating ~60 columns); reject every other UPDATE and DELETE on a published row exactly as today.
3. The future `presby_withdraw_publication()` (still deferred to the publish-UI pipeline, not built in this hardening pass — named in `docs/TODO.md` already) sets `publications.withdrawn_at/by/minute_reference` and `congregation_statistics.withdrawn_at` together, in one transaction; both freeze triggers permit exactly that pair of transitions.
4. Any future rollup/per-capita consumer of `congregation_statistics` for "current" totals must filter `withdrawn_at is null` — named as an obligation on whichever pipeline builds those consumers (none exist yet), added to `docs/TODO.md` now so it is not rediscovered later.

**Tests owed**: a regression proof that `presby_list_published_returns_to_me()` now *returns* a withdrawn row (this is failing-first relative to the currently-shipped behavior, which filters it out); a proof that the `congregation_statistics` guard permits exactly the withdrawn_at null→set transition and rejects any simultaneous change to another column; a proof rejecting a second withdrawal attempt (already-withdrawn re-set) on the projection, mirroring `publications_freeze`'s own "withdrawal is itself an act" rule.

### Ruling 7 — `sasr_form_versions.field_spec` immutability (F53): ruled now, not deferred

Ruled now — cheap (one trigger), and it closes exactly the hole the reviewer
names ("preserve the 1987 payload forever while silently changing the
definition through which the system interprets it"), consistent with this
migration's own pattern of freezing content once something relies on it.

`create or replace function presby_freeze_used_field_spec() returns trigger language plpgsql security definer as $$ ... $$` — **security definer is load-bearing here, not incidental**: the check must see `statistical_returns` rows across every tenant, not just the caller's own (the same F26 shape as every other cross-tenant checker in this migration set — an invoker-mode version would silently see zero referencing rows under RLS and let the edit through, for exactly the tenant whose historical row it should have protected). `BEFORE UPDATE ON sasr_form_versions FOR EACH ROW WHEN (old.field_spec IS DISTINCT FROM new.field_spec)`: reject if `exists (select 1 from statistical_returns where form_version_key = old.key)`. Placeholder rows (`'1984'`/`'2014'`/`'2022'`, per `docs/TODO.md`'s existing line) remain freely editable until the first return is filed against them — no conflict with `scripts/db:seed`'s `ON CONFLICT ... DO UPDATE` upsert pattern, since nothing references those keys yet.

**Tests owed**: a proof that the trigger rejects a `field_spec` edit once *any* tenant's `statistical_returns` row references the key — specifically proving the DEFINER is load-bearing by attempting the edit under a *different* tenant's context than the one holding the referencing row (an invoker-mode version would pass this test incorrectly); a regression proof that a still-unused placeholder row's `field_spec` remains editable.

### Ruling 8 — nothing else found; one point of disagreement with the review's framing, stated

No additional defects found beyond the eight points above and their named
sub-points. One disagreement with the review's own diagnosis, not its
findings: the review treats "revoke the grant" as the fix for both
`organization_identifiers` and (implicitly, by not raising it) would have
treated a grant-only fix as sufficient anywhere else in this batch too — F44/
Ruling B3, discovered earlier in this same pipeline, says that is never
sufficient against `getPlatformDb()`. Every ruling above that closes a real
hole does so with a trigger; the grant edits are the belt, not the buckle.

### Commit framing

One `fix(schema):` commit, migration-correction shape (same files, same
numbers — `drizzle/0043`–`0047` — per this work-log's own established
precedent). Trailers: `Caught-By: human-review` (an external reviewer, not
CI, not an agent's own judgment call to run a non-mandatory check) and
`Discovered-In: post-merge` — the two commits (`36a2bb8`, `1a5201e`) are
local and unpushed at the moment of this review, but the orchestrator pushes
the current state to `main` before this correction lands (deploys do not
auto-migrate, so "on `main`" and "in production" are different facts here),
so the finding is post-merge relative to the commits it corrects, not
mid-pipeline. `Work-Log: 2026-09-24-lifecycle-affiliation-returns`.

**Implementer: database-admin.** Schema-only (new CHECKs, one UNIQUE, one
partial unique index, five new/widened trigger functions, four grant edits,
one new DEFINER function, one backfill correction) — no route handler, server
action, or UI surface is touched by any of the eight rulings above.

## Ratification after the hardening pass (2026-09-24, tech-lead) — fifth Phase 3 loop-back

database-admin's "Loop-back after external implementation review" reports two
loop-back candidates and nine deliberate deviations from this amendment's own
spec. Ruled on each below. QA is re-verifying the built tree concurrently with
this ratification; nothing here requires touching it.

### Loop-back candidate 1 — `organization_affiliations_recorded_has_from`: refused, not built

The implementer's counter-evidence is conclusive and the premise this
amendment's Ruling 3 stated was false: `scripts/seed-dev.sql:105-109`
(Quillhaven's minuted pre-1995 affiliation, `authority = 'recorded'`, a real
Southern Fields minute reference, `effective_from` null, reason "Predates our
records"), `scripts/test-rls.sql:2972-2977` (asserting, under an explicit F41
comment, that `presby_org_affiliated(quillhaven, southern-fields,
'1899-01-01')` is TRUE — only true while that row's lower bound is
unbounded), and `src/lib/db/domain/lifecycle.test.ts:126-146` (the same shape
again, as the redistricting fixture) all depend on a **minuted** act being
allowed a null `effective_from`. F41's rule — "null means unbounded below,
predates our records" — was written with no dependency on `authority`, and a
council minuting the *closing* of a relationship whose beginning nobody can
date is not a hypothetical; it is exactly Quillhaven's fixture and, per F30,
the general shape of the 41-year PSV archive this whole pipeline exists to
serve.

**Ruled: drop the CHECK from the design.** The recommended alternative —
redefine it to apply only to `authority = 'backfill'`'s complement — would
add a distinction the data does not support (a minuted act can legitimately
have an unknown start) for no invariant gained. The invariant that actually
matters here — a null `minute_reference` appears only on a `'backfill'` row —
already exists, is untouched by this ruling, and is the correct home for
"provenance completeness" on this table. The absence stays pinned by
`scripts/test-rls.sql`'s new assertion (constraint name → 0 rows) rather than
silently dropped, so a future reader sees a decision, not a gap. `docs/schema-
design-2.md` §2f F49 amended in place to record three-of-four built and the
fourth refused; DECISION-140 gains a dated correction.

### Loop-back candidate 2 — `statistical_returns_provenance_shape` excludes `attested_by_name`/`attested_role`: accepted

Accepted as the Ruling-A4-consistent shape, for the same reason Ruling 3
already excluded `closed_by` from `organization_affiliations_closed_shape`:
`presby_publish_sasr_snapshot()` is the only live writer of a `submitted` row
and has no acting-user context to draw an attester name from, and accepting
one as a caller-supplied parameter would be exactly the identity claim the
function's confused-deputy shape refuses to trust. `attested_at` carries the
attestation half of the shape and is correctly still required. The completion
— populating both text columns once a real `app.current_user_id` GUC exists —
is folded into the existing `docs/TODO.md` line for that GUC rather than
opened as a second, separate item; it is the same underlying gap surfacing on
a second table. `docs/schema-design-2.md` §2f F50 amended in place;
DECISION-140 gains a dated correction.

### Deviations 2–9 — all accepted

1. *(Deviation 1 is loop-back candidate 2 above; not repeated here.)*
2. **`presby_apply_lifecycle_event()` also arms `presby.affiliation_
   trigger_active` in its close branch.** Accepted — necessary, not optional:
   without it every dissolution/merger/division/dismissal would be refused by
   the new guard the moment it tries to close the subject's open affiliation,
   since Ruling 3 named only `presby_transfer_affiliation()` as a sanctioned
   writer. Correctly scoped to the branch that closes something, not armed
   unconditionally at the top of the function.
3. **`presby_guard_organizations_delete()` also arms `presby.identifier_
   trigger_active`.** Accepted — same mechanism, same justification as
   deviation 2: `organization_identifiers.organization_id` cascades on
   organization delete exactly like `organization_affiliations.subject_
   org_id` does, so the fixture-teardown path Ruling 3 protects for one table
   needed the identical one-line protection for the other.
4. **`presby_transfer_affiliation()`'s close-date guard tightened `>` to
   `>=`.** Accepted — required by the new `_range_order` CHECK, which the
   original `>` would have let violate at the boundary (`daterange(d, d,
   '[)')`, valid and empty, invisible to the EXCLUDE constraint but refused
   by the new CHECK); tightening it keeps F40's one-literal-per-table
   discipline intact by catching the case in the function rather than letting
   it surface as a raw `check_violation`.
5. **`scripts/seed-dev.sql`'s Quillhaven close moved inline (INSERT carries
   `closed_*`, the trailing `UPDATE` deleted).** Accepted — the new guard
   trigger correctly refuses the seed's old two-step write on the owner
   connection, and the row as it stood also violated `_closed_shape`; folding
   the close into the INSERT is the only way to seed a legitimately-closed
   historical row under the hardened schema. Arity re-verified by the
   implementer against a scratch table copy.
6. **`drizzle/0046`'s 2024-field-spec self-assertion gained `withdrawn_at`
   to its bookkeeping-column exclusion list.** Accepted — a straightforward
   consequence of F52 adding a column to `congregation_statistics` after
   `0046`'s own DO-block was written; the two lists (this one and `0047`'s
   payload-subtraction list) must stay in step by construction, and both now
   say so in comments. Caught correctly by the idempotence re-apply pass
   rather than missed.
7. **Thirteen `test-rls.sql` probes moved to `publication.test.ts`
   (owner-connection tests).** Accepted — F50/F51's INSERT revokes mean a
   tenant connection can no longer reach the CHECK/trigger those probes exist
   to exercise; leaving them under `presby_app` would have tested the grant,
   not the mechanism. Moving them to the owner connection is the same split
   this migration's own header already uses for UPDATE/DELETE probes, applied
   consistently rather than invented fresh.
8. **F53's field-spec freeze trigger made `WHEN`-conditional (no-op on a
   byte-identical re-apply) instead of changing the seed.** Accepted, and
   preferred to the alternative considered and rejected (skipping `field_spec`
   in the seed's upsert for referenced keys): the chosen shape keeps
   `scripts/db:seed` converging unconditionally today, and turns a *genuine*
   future divergence into a loud trigger failure rather than a silently
   stale spec the day the first 2024 return is filed.
9. **`publications_withdrawal_shape`'s correction made an unconditional
   `drop constraint if exists` + `add`, not the file's usual idempotent
   presence-check pattern.** Accepted — correctly reasoned: the correction
   keeps the constraint's name and changes its definition, so a presence
   check would have left the broken (pre-F51) predicate in place on every
   database, including `development`, that had already run the earlier form.
   Worth remembering as a general rule the next time a named constraint's
   *definition* needs correcting in place, not just its presence.

### Finding — `getCongregationStatisticsRollup()` is a live, currently-inert `withdrawn_at` consumer

Correctly caught: the fourth loop-back's Ruling 6 and `docs/schema-design-
2.md` §2f F52 both said "no such consumer exists yet." `getCongregationStat
isticsRollup()` in `src/lib/presbytery.ts` already exists and does not filter
`withdrawn_at is null`. It is a no-op today — nothing can set the column
outside the one permitted freeze-trigger transition, and nothing calls that
transition yet — so no behavior changes and nothing ships broken.

**Ruled: the future `presby_withdraw_publication()` pipeline owns the
filter, added in the same change that gives the column its first writer** —
recommended, not landed now. It is the first pipeline that can make
`withdrawn_at` non-null at all, so it is also the first point at which an
unfiltered rollup can actually be wrong; adding the filter today changes zero
observable behavior and would be scope creep into a hardening pass explicitly
bounded to schema-only correction-in-place. `docs/schema-design-2.md` §2f F52
and the corresponding `docs/TODO.md` line both corrected to name
`getCongregationStatisticsRollup()` directly rather than a hypothetical
future consumer, so the obligation cannot be lost twice.

### Disposition

No further Phase 4 change is required. The tree as built by database-admin's
"Loop-back after external implementation review" stands as ratified, with
the two documentation corrections above (§2f F49/F50, DECISION-140) recording
where the built shape differs from this amendment's own original spec — both
differences are the implementer correctly refusing/adapting a spec item
against evidence already in the tree, not a defect introduced during
implementation. Proceeds to Phase 5 re-verification.

**Commit:** one `fix(schema):` — `Caught-By: human-review`,
`Discovered-In: post-merge`, `Work-Log:
2026-09-24-lifecycle-affiliation-returns` — covering the fourth loop-back's
hardening pass exactly as database-admin built it (no code changes accompany
this ratification). `docs/TODO.md`'s In Flight line for this loop-back moves
to Done in the same commit. Release notes: `docs/release-notes/v0.24.1.md`
(Fix).

---

# Phase 4 — Implementation

> **BATCHES A AND B COMPLETE. BATCH C IS NOT STARTED.** The section
> immediately below is batch A as written at the time; batch B's own block is
> appended at the end of this Phase 4 section ("Batch B", below), and it is
> the current state of `drizzle/0044` where the two disagree.
>
> This section covers Implementation Order items **1, 2, 3, 4 and 8** only:
> increment 1 (`drizzle/0043`), increment 2 (`drizzle/0044`), the fixture
> sweep, the `deletable_until`-at-insert change, and the `createOrganization()`
> TypeScript extension with its tests. **Batch B = increment 3 (`0045`, the
> about-org enforcing trigger). Batch C = increments 4–5 (`0046`/`0047`).**
> Neither has been begun; no `0045`–`0047` file exists and no
> `publication.ts`/`returns.ts` module has been created. `reporting.ts` and
> `sasr_reports` are untouched — their removal is batch C.
>
> **Loop-back resolved below (tech-lead, "Amendment after batch A," inserted
> above this Phase 4 section).** Four of the five reported deviations are
> accepted as the corrected design. The fifth (Ruling A5) is **rejected as
> insufficient on the `getPlatformDb()` connection** and requires a small,
> already-scoped correction to the still-uncommitted `drizzle/0044` —
> narrowing `presby_platform`'s grant on `organization_lifecycle_events` and
> `organization_affiliations` to `select, insert`, and adding a
> `presby_freeze_lifecycle_event()` trigger — **before batch B (increment 3)
> begins.**

## Files Created

- `drizzle/0043_presby_org_identifiers.sql` — increment 1. `organization_identifiers` (D24) + the `pcusa_pin` move off `organization_settings`. **Does NOT drop `organizations.status`** — see Implementer Notes, loop-back item 1.
- `drizzle/0044_presby_org_lifecycle.sql` — increment 2, all of it in one file in Phase 3's order: the three `organizations` columns, `organization_lifecycle_events`, `organization_successions`, `organization_affiliations` + its public projection view, the affiliation backfill, the six functions, the eight triggers, the F38/F40 revokes, and the backfill-completeness `DO` block that ends the file.
- `src/lib/db/domain/lifecycle.ts` — the three new tables in Drizzle (DECISION-138), plus the `RelationshipType` union. Its header enumerates every constraint that exists only in `0044` (the GIST EXCLUDE, the SELECT-only grant, the append-only grant shape, the authority trigger, the deferred cardinality trigger) so absence in Drizzle is not read as permission.
- `src/lib/db/fixture-deletable.ts` — `fixtureDeletableUntil()`, the one place a test fixture opens its teardown window. Sits next to `errors.ts`, not under `domain/` (it is not schema).

## Files Modified

- `drizzle/meta/_journal.json` — idx 43 and 44 added together in one edit, with tags matching the filenames exactly. `ls drizzle/` was re-run immediately before writing `0043`; `0042` was the highest number on disk and there was no second pipeline's file present.
- `src/lib/db/domain/org.ts` — `organizations` gains `lifecycleStatus`, `lifecycleAsOf`, `deletableUntil`; `organizationSettings` loses `pcusaPin`; new `organizationIdentifiers` table (Ruling 9: in `org.ts`, not a new module). `status` **kept**, with a comment saying why.
- `src/lib/db/domain/index.ts` — exports `./lifecycle`.
- `src/lib/org-provisioning.ts` — `createOrganization()` gains `parentOrganizationId` / `relationshipType` / `effectiveFrom` / `minuteReference` / `recordedByUserId`; a new `invalid_parent` result; `toDateString()`; and a fix to `pgErrorCode()` (see Implementer Notes, finding 3).
- `src/app/(admin)/admin/organizations/new/actions.ts` — parses the optional parent fields (no form control ships here), maps `invalid_parent` to one non-enumerating message, and extends the EXISTING `AUDIT_ACTIONS.ORG_CREATED` payload with `parentOrganizationId`/`relationshipType`. No new audit key.
- `scripts/seed-dev.sql` — both `organizations` blocks now insert ROOTS and establish the hierarchy through `organization_affiliations`; four new fixture councils (Southern Fields, Western Basin, Coastal Plain synod, Tidewater presbytery); Quillhaven gains a **closed historical affiliation** to the Southern Fields (unbounded-below → 1995-01-01) and an open one to the Northern Reach, which is the fixture the 1990 case is proven against.
- `scripts/test-rls.sql` — new **section 32** (13 blocks, 36 assertions); the three inline `insert into organizations` fixtures at the old `:1997`/`:2155`/`:2322` replaced by the seeded councils; the `:2322` "Orphan Chapel" fixture replaced by a presbytery-under-a-synod (see Implementer Notes, deviation 4).
- `e2e/support/seed-orgs.ts` — a SIXTH file in the sweep that Phase 2/3 did not name (Implementer Notes, finding 2).
- `src/lib/credentials.test.ts`, `src/lib/presbytery.test.ts` — parented fixtures go in as roots plus an affiliation row.
- `src/lib/roll.test.ts` — one pre-existing teardown gap fixed (Implementer Notes, finding 4).
- `e2e/admin-organizations-create.spec.ts` — its `deleteOrgBySlug()` teardown stamps `deletable_until` before deleting. A SEVENTH file the sweep had to reach: the org under test comes out of the real `/admin/organizations/new` flow, so no fixture helper could stamp it at insert.
- `src/lib/org-provisioning.test.ts` — 8 new tests, an `expectDbError()` helper, reverse-order teardown, `deletableUntil` at teardown for orgs that `createOrganization()` made.
- 25 DB-backed test files — `deletableUntil: fixtureDeletableUntil()` stamped on every `platform.insert(organizations)` fixture (32 call sites). **No new disable/enable-trigger block was added anywhere for the delete guard** (Ruling 7.3).
- `src/lib/dev-docs.ts` — two new `INVARIANTS` entries (organization permanence; `parent_id`/`path` derived), three `BESPOKE_POLICIES` notes, and the four new tables added to `MODULES`. The third invariant Phase 3 lists ("publication is an event") belongs to batch C.
- `docs/schema-design.md` — regenerated by `npm run docs:erd`: a new "K. Lifecycle and affiliation" diagram, `organization_identifiers` in section A, and two pre-existing drift lines (`officer_terms.public_listed_by`, `group_memberships.public_listed_by`) the refresh picked up.

## Schema Changes

**Applied with `psql "$MIGRATE_DATABASE_URL" -f …` against the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, 59 orgs at start — verified NOT production, which holds 2). Production was never touched.**

**Migration mode: `db:generate`-equivalent — hand-written versioned SQL in `drizzle/`, not `db:push`.** Drizzle Kit emits none of this (RLS, FORCE RLS, a GIST EXCLUDE, eight triggers, six `SECURITY DEFINER` functions, four revokes, a data backfill, a `DO`-block assertion), so `npm run db:generate` was never run — as Phase 3's Edge Cases require. Both files are idempotent and were re-applied cleanly three times during development.

**`npm run db:migrate` was NOT the apply command, and cannot be on this branch.** `drizzle.__drizzle_migrations` on `development` records only the first **10** migrations — `docs/testing.md` states this outright ("`db:migrate` is not the local apply command on this branch — it would try to re-run 0010"). Running it would replay 0010–0044. The files are written to be `db:migrate`-safe for staging/production, where the ledger is intact.

Tables added: `organization_identifiers`, `organization_lifecycle_events`, `organization_successions`, `organization_affiliations`. View added: `organization_affiliations_public`. Columns added: `organizations.lifecycle_status`, `organizations.lifecycle_as_of`, `organizations.deletable_until`. Column dropped: `organization_settings.pcusa_pin`. Functions added: `presby_deny_affiliation_change()`, `presby_deny_lifecycle_change()`, `presby_assert_council_authority()`, `presby_affiliation_parent_as_of()`, `presby_org_affiliated()`, `presby_apply_affiliation_to_org_tree()`, `presby_transfer_affiliation()`, plus six trigger functions. Grants changed: `insert, update, delete` **revoked** on `organizations` and on `organization_affiliations` from `presby_app`.

Backfill result on `development`: **8 parented orgs → 8 open affiliation rows**, assertion passed inside the migration.

## Audit Events

No new `AUDIT_ACTIONS` key, and `npm run check:audit` passes. DDL writes no audit rows. The one application mutation this batch touches, `createOrganizationAction`, keeps writing `AUDIT_ACTIONS.ORG_CREATED` and its metadata now carries `parentOrganizationId` and `relationshipType` (null for a root org) — the same security-sensitive mutation with one more fact about it, not a second key.

## Implementer Notes

### Loop-back candidates for Phase 3 (not silently reconciled)

1. **`alter table organizations drop column status` (F35) is NOT buildable as specified and was not done.** Phase 3's Data Model calls it "the unused pre-provisioning status column." It is not unused: five shipped `SECURITY DEFINER` functions gate an **anonymous public read** on `o.status = 'active'` — `drizzle/0020:160`, `0021:233`, `0024:62` (`presby_published_site()`), `0041:70,83` and `0042:83,96,146`. Postgres records no column dependency inside a function body, so the DROP would have **succeeded** and every public site would have started failing at request time, not at migration time. The column's real successor is `organizations.lifecycle_status`, so removing it is a rewrite of five anonymous-read functions with their own blast radius — a scoped change, not a one-liner. Recorded in `drizzle/0043`'s header.
2. **`presby_transfer_affiliation()`'s Phase 3 signature is not valid SQL.** It places `p_reason text default null` before `p_minute_reference text` with no default; Postgres rejects that outright. `p_minute_reference` moved ahead of `p_reason`. It is required anyway — the row it writes is `authority = 'recorded'`, and the backfill-shape CHECK then demands a minute.
3. **Phase 3's `presby_assert_council_authority()` contract makes D19's headline scenario unbuildable, and this is the most consequential correction in the batch.** Step 4 of `presby_transfer_affiliation()` is specified as `presby_assert_council_authority(v_actor, subject)` with the one-level-above rule. In a redistricting the actor is the **synod** and the subject a **congregation** — two levels apart — so the rule rejects the exact transfer Ruling 1 exists to enable. Resolution, implemented and commented in `0044`: on an **affiliation** row the one-level rule is about `parent_org_id` vs `subject_org_id` (parent-fits-child); the **actor's** standing is the separate common-superior check the function already performs. On a **lifecycle event** the acting council genuinely is the one-level-above body, so there the call passes `organization_id`. The function also gained a `p_context` parameter, because Phase 3 has it always raise the *lifecycle* literal — which, called from the affiliation path, would have made one rejection cause distinguishable from the others and defeated F40's whole point.
4. **There is no acting-USER context in this platform.** Phase 3's algorithm writes `closed_by = <acting user id, if resolvable from session context>`. There is no `app.current_user_id` GUC — only `app.current_org_id` — so `closed_by` and the new row's `recorded_by` are **null** for a function-mediated transfer. Accepting a user id as a parameter would be a caller-supplied identity claim, which is what this function's whole shape refuses. Named as a gap for the lifecycle-UI pipeline; there is no caller today.
5. **`organization_lifecycle_events`' freeze question, which Phase 3 left explicitly open, is resolved as APPEND-ONLY BY GRANT** — `presby_app` holds `select, insert` and nothing else. A freeze trigger would be belt-and-braces over an absent grant; the absent grant is stronger, cheaper, and `test-rls.sql` asserts it. `organization_successions` keeps the `delete` grant Phase 3 specified (the deferred cardinality trigger fires on DELETE, which implies it), and that inconsistency is deliberate and flagged.

### Findings not in Phase 1/2/3

6. **The fixture sweep is a SIX-file sweep, not five.** `e2e/support/seed-orgs.ts` writes `parent_id` on three fixture orgs (`:249`) and — worse — its upsert had `path = EXCLUDED.path` and `parent_id = EXCLUDED.parent_id` in the `ON CONFLICT DO UPDATE` SET list. `UPDATE OF path` fires on the column being in the SET list, not on the value changing, so **every re-seed** would have tripped the reparent guard. Rewritten to insert roots and open an affiliation with a `WHERE NOT EXISTS` guard; verified idempotent by running `seedE2EOrgs()` twice against `development` (both runs clean, paths derived correctly).
7. **`isUniqueViolation()` in `org-provisioning.ts` has never worked.** It read `err.code` off the top-level object, but Drizzle wraps the driver error in its own `Error: Failed query: …` and hangs the original on `.cause`, so the SQLSTATE is a level down. The slug-taken path looked healthy only because the pre-check `SELECT` catches the common case — the `catch` that exists *for the TOCTOU race* was dead code. Found while building the `invalid_parent` mapping (which has the same shape); `pgErrorCode()` now walks the cause chain and both paths are live. This is a real pre-existing bug fixed in passing, not a new behavior.
8. **`src/lib/roll.test.ts`'s teardown has a pre-existing gap that only shows when the file runs alone.** Deleting its fixture org cascades into `group_memberships`, where derived rows exist (its `active_membership` group plus `0017`'s sync trigger), and `presby_reject_derived_group_write()` refuses. The file only ever looked green because sibling files run in parallel and one of them happens to have that same **global** trigger disabled at the moment the cascade runs — `docs/TODO.md`'s "unreliable teardown / no per-test isolation" item, seen from the inside. Fixed with the disable/enable pair the file already uses for `roll_actions_freeze`. **This is not the 16th delete-guard disable block Ruling 7.3 forbids** — it is for a different trigger, and the delete guard itself is satisfied by `deletableUntil` at insert.
9. **The `organization_affiliations_public` view deliberately reaches past tenant isolation.** A plain (non-`security_invoker`) view runs with its owner's privileges. That is the intent — who belongs to which council is public, the same call `organizations` itself makes — but it means the **column list is the enforcement point**. `reason`, `minute_reference`, `concurrence_reference` and the `closed_*` attribution are absent and must stay absent; `test-rls.sql` asserts their absence by name so a future widening trips a test.

### Deviations taken deliberately

10. **The backfill runs BEFORE the authority trigger is created**, not after. A backfill states what the database already believes, and historical data must not be refused by a rule written today (on `development` every parented org is a congregation under a presbytery, so it would have passed — but that is luck, not design).
11. **`organization_affiliations.subject_org_id` gained `ON DELETE CASCADE`,** alone among the table's four organization FKs. Without it every hierarchical fixture teardown fails on the FK instead of cleaning up. `organization_id` and `parent_org_id` stay RESTRICT on purpose: a council that still owns or parents live records should refuse to disappear loudly. **Consequence for future fixture authors: delete children before parents.**
12. **`test-rls.sql`'s three inline org inserts moved to `scripts/seed-dev.sql`, which IS "the owner connection the suite already uses for setup"** (`psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql`, per `docs/testing.md`). The suite itself is a single `presby_app` connection and cannot switch roles. The old `:2322` "Orphan Chapel" fixture — a congregation whose parent was a synod — is now **unwritable by design**, since a synod may receive presbyteries only (G-3.0403(c)); it is replaced by the Tidewater presbytery under the Coastal Plain synod, which exercises the identical `presby_publish_sasr_snapshot()` rejection branch with a shape the polity allows.
13. **`createOrganization()` does not call `presby_apply_affiliation_to_org_tree()` explicitly**, as Phase 3's API Contract spells out. The affiliation INSERT's own AFTER trigger already calls it — it is the single derivation path — so an explicit second call would be a redundant invocation of the same function in the same transaction.
14. **The delete guard's "permitting a `deletable_until`-stamped org" half cannot be proven on the `presby_app` connection**, because after the revoke that role has no DELETE grant at all. `test-rls.sql` proves the `presby_app` half (every delete refused); the **owner** half — refused with no stamp, refused with a STALE stamp, permitted with a live one — is proven in `src/lib/org-provisioning.test.ts`, which runs on `PLATFORM_DATABASE_URL`. Same split for the backfill-completeness assertion: `test-rls.sql` proves the tenant-scoped half (it cannot count another council's rows through RLS), `org-provisioning.test.ts` re-proves the global one.

### Development-branch fixture drift cleaned to make the suite runnable

The `development` branch carried pre-existing debris that made `scripts/test-rls.sql` fail at sections 2, 3, 10, 13 and 17 **before any of this batch's code was involved**. Removed, and recorded here rather than quietly:

- a stray person "Testy Verifyington" + membership at Alder Creek (created 2026-08-27, not in any seed file);
- "Admin Fixture" (`admin@presby.invalid`)'s membership, `dev_admin` role grant and derived group membership at the Northern Reach — `docs/testing.md` says that account has **no** congregation;
- a `personnel_admin` role grant to Desmond Okonkwo at Alder Creek (2026-08-27, not in `seed-dev.sql`);
- an `organization_profiles` row + two `organization_service_times` for Alder Creek (the suite asserts zero);
- one `presby_roll_cache_drift()` row at `fpcw` (reconciled to null, which is what the daily reconcile exists to do);
- **48 leftover `*-<13-digit-timestamp>` test organizations** from prior DB-backed runs whose teardowns failed.

> **⚠️ SEPARATE, AND NOT MINE TO FIX: `organization_profiles` on the `development` branch holds a REAL street address and phone number for `fpcw`** (`41 W. College Avenue, Westerville, Ohio 43081` / a real 614 number), written 2026-08-24. It is not in the repository, so `npm run check:secrets` is silent on it and the No Real Data invariant's letter holds — but real congregation contact data is sitting in a shared dev database. Flagging for the operator; I did not delete it, because it may be deliberate for the public-site work.

**Follow-on item (2026-09-25, orchestrator-accepted from this block's own
Finding 1) — `presby_app` loses INSERT on `organization_lifecycle_events`.**
`revoke insert` in `drizzle/0044` section 2; SELECT stays; `presby_platform` is
unchanged (`select, insert`). The grant predated F54: INSERT here is now
function-mediated, the future `presby_record_lifecycle_event()` is SECURITY
DEFINER and gains nothing from a tenant grant, and no application path inserts
today. The two lifecycle tables now carry the identical shape — SELECT for
`presby_app`, `select, insert` for `presby_platform` — which is what Phase 2
Ruling 1 asked for and what `organization_successions` has had since Phase 5
Finding 1.

**That unlocked two of B-M1's three deliberate keeps**, and each caller was
re-enumerated before revoking rather than inferred from the table change:
`presby_deny_lifecycle_change()` (callers: `presby_assert_council_authority()`
and `presby_check_succession_event()`, both DEFINER; `presby_guard_lifecycle_
write()`, INVOKER but now unreachable — `presby_app` holds SELECT on both
tables it fires on) and `presby_lifecycle_event_cardinality_check(uuid)`
(callers: the two INVOKER cardinality trigger functions, on the same two
tables). Both revoked from `presby_app`. **`presby_deny_publication_write()` is
now the only keep**, because `presby_guard_publication_write()` is genuinely
reachable — `congregation_statistics` is the one table in this family
`presby_app` still writes. `presby_deny_lifecycle_change()` gains a
`presby_platform` grant it never had: that role still holds INSERT on both
lifecycle tables, so a real non-owner platform login would reach the INVOKER
guard and must be able to raise the table's own literal rather than a privilege
error. **The coupling is written into `0044` at both revoke sites**: re-grant
INSERT to `presby_app` on either lifecycle table and both function grants must
return in the same migration, or the uniform literal (DECISION-139/F40)
degrades to `permission denied for function` and the deferred cardinality check
fails with the wrong error.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS**, clean |
| `npm test` (CI shape, no `.env.local`) | **246 files passed, 26 skipped; 3206 tests passed, 663 skipped, 0 failed** |
| `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (DB-backed) | **271 of 272 files passed; 3866 passed / 3 failed** — the 3 are `src/lib/rate-limit.test.ts`, which fail **only** because `.env.local` sets `RATE_LIMIT_DISABLED=true` for the e2e suite. Unrelated to this batch and green under `npm test`. |
| `npx dotenv -e .env.local -- npx vitest run` (default parallel) | Flaky: 4–7 suite-level **teardown** failures per run, always `presby_reject_derived_group_write()` on a `group_memberships` cascade, always a different set of files. This is `docs/TODO.md`'s known parallel `alter table … disable trigger` race — one file disables a **global** trigger while another's teardown depends on it. No assertion fails; only `afterAll` hooks. **QA should run the DB-backed suites with `--no-file-parallelism`.** |
| `npm run check` (all five tripwires) | **PASS** — audit-coverage, sql-date, deps-drift, brand-scope, secrets/PII |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`) | **exit 0, 277 assertions pass**, 36 of them new in section 32 |
| `npm run lint` | 7 errors, 190 warnings — **all pre-existing**, all in React components untouched by this batch (`portal-nav-links.tsx`, `branding-form.tsx`, `children-roster-list.test.tsx`, …). No file this batch touched appears in the output. |
| `seedE2EOrgs()` | Run twice against `development`: clean both times, paths derived to `e2e_presbytery.e2e_alpha` etc. |

**Order matters when reproducing:** a parallel `vitest run` leaves orphan test organizations behind (the flake above), and `test-rls.sql` then fails on `presby_roll_cache_drift()` counting them. Run the DB suites serially, or purge `slug ~ '-[0-9]{13}$'` organizations before running `test-rls.sql`.

### Handoff

**New tables and columns available to the next implementer (batch B, increment 3 — `0045`, the about-org enforcing trigger):**

- `presby_org_affiliated(p_subject_org_id uuid, p_council_org_id uuid, p_as_of date) returns boolean` — **already live**, walks the affiliation chain recursively (depth-capped at 8), `stable security definer`, `execute` granted to `presby_app`. Increment 3 only has to create the trigger that calls it. Per Phase 3's Data Model the five tables are `congregation_oversight`, `congregation_statistics`, `per_capita_rates`, `per_capita_records` — **re-grep `about_org_id` across `src/lib/db/domain/` for the fifth**, which Phase 2 named only as "whichever officer/credentials table already uses the pattern". (For what it is worth: `src/lib/db/domain/officers.ts:243` references the pattern in a comment on `appointments.servingOrgId`.)
- `presby_affiliation_parent_as_of(p_subject_org_id uuid, p_as_of date) returns uuid` — the companion read; this is what increment 5's rewritten `presby_publish_sasr_snapshot()` must use instead of `organizations.parent_id`.
- `organizations.lifecycle_status` / `lifecycle_as_of` / `deletable_until`; `organization_identifiers`; `organization_lifecycle_events`; `organization_successions`; `organization_affiliations` + `organization_affiliations_public`.
- **The coupling Phase 2 flagged as the pipeline's riskiest is now provable, not assumed:** `parent_id` equals the open affiliation's `parent_org_id` for every row on `development` (asserted in the migration, in `test-rls.sql` section 32(h)/(i), and globally in `org-provisioning.test.ts`). Before wiring increment 3's trigger, re-read `resolveMemberCongregation()` (`src/lib/presbytery.ts:143`) and `src/lib/credentials.ts:522,710` and confirm they still agree with `presby_org_affiliated()` on every seeded fixture — Phase 3 asks for that by hand, and the assertion is a mitigation, not a substitute.
- **The Quillhaven fixture is now the redistricting case**: in the Southern Fields (unbounded-below → 1995-01-01), in the Northern Reach since. Increment 3's trigger must be tested against a `congregation_statistics`/`per_capita_records` row for Quillhaven in a pre-1995 year — it should resolve to the Southern Fields and be REFUSED for the Northern Reach.

**Local apply command:**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0043_presby_org_identifiers.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0044_presby_org_lifecycle.sql
# On a database whose drizzle ledger is intact (staging/production), `npm run
# db:migrate` is correct and both files are safe under it. It is NOT correct on
# the development branch — see Schema Changes above.
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql   # fresh databases only; the seed changed
# `npm run db:seed` is unchanged — no new permission key, no new role, no new flag.
```

**Next agent:** back to **`database-admin`** for batch B (increment 3, `0045`) — it is schema-only and depends on nothing outside `drizzle/` plus a `test-rls.sql` section. `api-developer` becomes the right implementer at batch C's increment 5, where the rewritten `presby_publish_sasr_snapshot()` needs a TypeScript call-site smoke test (Phase 3 Implementation Order item 7).

---

## Batch B — Ruling A5's correction + increment 3 (2026-09-24, database-admin)

> **BATCH B COMPLETE. BATCH C (increments 4–5, `0046`/`0047`) IS NOT STARTED.**
> No `0046`/`0047` file exists; no `publication.ts`/`returns.ts` module has
> been created; `reporting.ts` and `sasr_reports` are untouched.
>
> Two jobs, in the order the amendment requires: **(1)** the Ruling A5 fix to
> the still-uncommitted `drizzle/0044` — same file, same migration number —
> and **(2)** Implementation Order item 5, increment 3
> (`drizzle/0045_presby_about_org_affiliation.sql`).

### Files Created

- `drizzle/0045_presby_about_org_affiliation.sql` — increment 3. The about-org
  enforcing trigger (R3.14) on **four** shipped tables (not five — see
  Implementer Notes, spec defect 1), plus `presby_check_about_org_affiliated()`
  and `presby_deny_about_org_write()`. Opens with the backfill-completeness
  proof re-run standalone (Phase 2 Notes item 3) and a second pre-flight that
  refuses to create the trigger over any pre-existing violating row.
- `src/lib/db/domain/lifecycle.test.ts` — 9 DB-backed tests on the **owner**
  connection (`PLATFORM_DATABASE_URL` / `neondb_owner`), which is the only
  place the freeze trigger and the global coupling assertion can be proven.
  Both were watched failing before the fix and passing after (see
  Verification).

### Files Modified

- `drizzle/0044_presby_org_lifecycle.sql` — **Ruling A5's fix, in place.**
  `presby_platform` narrowed to `select, insert` on both
  `organization_lifecycle_events` and `organization_affiliations` (it held
  full DML); `presby_freeze_lifecycle_event()` added as a `BEFORE UPDATE OR
  DELETE` row trigger on `organization_lifecycle_events`, mirroring
  `presby_freeze_approved_roll_action()` (`drizzle/0009:358-373`) down to the
  errcode. The header's numbered contents list gains item 9 recording the
  correction and why it is a change to this file rather than a new number;
  the table's own grant block and table comment carry DECISION-135's dated
  correction reasoning in full (a grant binds the two application roles, not
  the owner; `BYPASSRLS` exempts a role from policies, never from triggers).
  No freeze twin on `organization_affiliations`, per Ruling A5.3, with the
  reason stated at both sites.
- `drizzle/meta/_journal.json` — idx 45, tag `0045_presby_about_org_affiliation`,
  filename agreement checked by `ls drizzle/` immediately before writing the
  file (0044 was the highest on disk) and `docs/TODO.md`'s In Flight list
  re-read for a concurrent schema pipeline (none).
- `src/lib/db/domain/lifecycle.ts` — the module header's
  "not expressible in Drizzle" enumeration now states the corrected grant
  shape for both roles, the freeze trigger, and the deliberate absence of a
  freeze on `organization_affiliations`. (Nothing in the correction is
  Drizzle-expressible — grants and triggers have no builder — so the header
  is the whole mirror.)
- `scripts/test-rls.sql` — section 32 gains block **(m)** (the A5 correction:
  grant shape via `pg_class.relacl`, the freeze trigger's catalog shape, the
  deliberate absence of an affiliation freeze, and both tenant-side verbs
  refused); new **section 33** for increment 3 (7 blocks). 297 assertions
  total, up from batch A's 277.
- `src/lib/dev-docs.ts` — one new `INVARIANTS` entry ("A record ABOUT another
  organization must be affiliated with it", `trigger`), naming both the
  as_of rule and the lifecycle-event freeze. Without it the new enforcement
  would be a paper invariant on `/developer` by default.

### Schema Changes

**Applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f …` against
the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, 15 organizations
— verified NOT production, which holds 2). Production was never touched.**

**Migration mode: `db:generate`-equivalent — hand-written versioned SQL in
`drizzle/`, not `db:push`.** Drizzle Kit emits none of this (four triggers, two
functions, two `DO`-block assertions, four column comments), so
`npm run db:generate` was never run. **`npm run db:migrate` was NOT the apply
command and cannot be on this branch** — `drizzle.__drizzle_migrations` on
`development` records only the first 10 migrations (`docs/testing.md`), so it
would replay 0010–0045. Both files are written to be `db:migrate`-safe where
the ledger is intact.

- No tables, columns or indexes added or dropped.
- Functions added: `presby_freeze_lifecycle_event()` (0044),
  `presby_check_about_org_affiliated()`, `presby_deny_about_org_write()` (0045).
- Triggers added: `organization_lifecycle_events_freeze` (0044);
  `congregation_oversight_about_org`, `congregation_statistics_about_org`,
  `per_capita_records_about_org`, `appointments_about_org` (0045).
- Grants changed: `update, delete` **revoked** from `presby_platform` on
  `organization_lifecycle_events` and `organization_affiliations`.
- Comments added on `congregation_oversight.about_org_id`,
  `congregation_statistics.about_org_id`, `per_capita_records.about_org_id`,
  `appointments.serving_org_id`.

**Idempotency, proven not asserted:** both whole files were re-applied end to
end after the change (`exit=0`, no errors), and `scripts/test-rls.sql` re-run
clean afterwards. `0044`'s backfill assertion printed *"affiliation backfill
complete: 9 parented orgs, 9 open affiliation rows"* on every run.

**The completeness proof Phase 2 Notes item 3 requires, run standalone before
the trigger was created:** `9 parented orgs = 9 open affiliation rows`
(batch A recorded 8; the ninth is an `e2e/support/seed-orgs.ts` fixture org
seeded since). The second pre-flight — zero pre-existing violating rows across
all four guarded tables — also passed, so the trigger was not created over
data it would refuse.

### Audit Events

No new `AUDIT_ACTIONS` key; `npm run check:audit` passes. DDL writes no audit
rows and this batch touches no server action.

### Implementer Notes

#### Spec defects found (not silently reconciled)

1. **`per_capita_rates` is named as one of increment 3's five tables and
   cannot carry the trigger: it has no about-org column at all.** Its shape is
   `(id, organization_id, billing_year, basis_year, rate_per_member,
   updated_by, updated_at)` — one row per presbytery per billing year, not a
   row *about* a congregation (verified against both
   `src/lib/db/domain/presbytery.ts:343` and the live `information_schema`).
   There is nothing to check. Phase 3's Data Model inherited the name from
   Phase 2's own four-explicit-plus-one list. `scripts/test-rls.sql` section
   33(a) asserts the absence of `per_capita_rates.about_org_id` **by name**, so
   the gap reads as a finding rather than an oversight if the column is ever
   added. **The fifth table that does carry the pattern is `appointments`
   (`serving_org_id`)** — Phase 2 named it only as "whichever officer/
   credentials table already uses the pattern" and required a re-grep at
   implementation time; `grep -rn "aboutOrgId\|servingOrgId"
   src/lib/db/domain/` returns exactly `congregation_oversight`,
   `congregation_statistics`, `per_capita_records` and
   `appointments.servingOrgId`, confirming batch A's Handoff guess.
2. **"as_of = the row's year" is not a date, and the choice of instant is
   load-bearing.** Resolved as the WHOLE year: the row is accepted if the
   about-org was affiliated at either endpoint (Jan 1 **or** Dec 31). A single
   instant refuses two foreseeable legitimate rows — a congregation dissolved
   in June whose final-year return is filed afterwards (Dec 31 fails), and a
   congregation received in June whose first-year return is filed for that
   same year (Jan 1 fails, and this is the one that would bite the shipped
   presbytery-entry UI today). **Accepted gap, named in the migration:** an
   affiliation that both opens and closes inside one calendar year is not
   detected by an endpoint test, so that year's row is refused; a true
   range-overlap test against a recursive ancestry walk is more machinery than
   that case is worth.
3. **Ruling A5's premise that "`presby_platform` is the `getPlatformDb()`
   connection" is not literally true on this database, which makes the freeze
   trigger the *only* real enforcement.** `PLATFORM_DATABASE_URL` connects as
   `neondb_owner` (verified: `select current_user`), which is a **member** of
   `presby_platform` and `presby_app` and holds every privilege on every table
   by ownership regardless. So narrowing `presby_platform`'s grant changes no
   runtime behaviour today — it is a correct, defence-in-depth statement that
   binds the day a real `presby_platform` login role exists (or anyone issues
   `set role presby_platform`), and `scripts/test-rls.sql` now pins it. The
   behavioural protection on the owner path is entirely the trigger, exactly
   as the ruling's own second argument says. Worth knowing before batch C
   reasons about any other grant as if it constrained `getPlatformDb()`.
4. **`drizzle/0009:44`'s `grant select, insert, update, delete on all tables in
   schema public to presby_platform` is the same additive mechanism that
   produced F38** — it will re-widen both tables if `0009` is ever re-applied
   *after* `0044`. Migration order makes that a non-issue in a replay from
   zero, and the `test-rls.sql` grant-shape assertions would catch it. Named
   because F38's root cause has not been removed, only worked around
   table-by-table (`people` in 0009, `organizations`/`organization_affiliations`
   in 0044, these two now).
5. **Ruling A5's parenthetical describes `organization_successions`' grant as
   "`select, insert, delete` to both `presby_app` and `presby_platform`,
   matching".** It is not matching: `presby_platform` also holds `UPDATE`
   (`drizzle/0044`'s section 3). The ruling says the table is not touched by
   it, so it is **not** touched here — recorded so batch C or the security
   review can decide deliberately rather than rediscover it.

#### Deviations taken deliberately

6. **The UPDATE arm only re-checks when the keys move.** A `BEFORE INSERT OR
   UPDATE` trigger that re-checked every UPDATE would refuse an ordinary
   `per_capita_records` payment posting (`paid_status`/`paid_amount`) on a bill
   issued to a congregation since redistricted — punishing routine bookkeeping
   for a fact about the past. The trigger returns early on an UPDATE that
   leaves both the about-org column and the year column untouched;
   re-**pointing** a row, or moving its year, is re-checked in full. Both
   halves asserted in `test-rls.sql` 33(f).
7. **`appointments` uses `current_date`, not `starts_on`.** Phase 3 says
   "current_date for the rest" and that is also the choice that keeps the
   trigger in exact agreement with `src/lib/credentials.ts:522,710`, which
   validate `serving_org_id` with `parentId = organizationId` (a present-tense
   question). Using `starts_on` would have refused a back-dated appointment at
   a congregation acquired since — a disagreement between a shipped page and
   the database, which is precisely what Phase 2 Notes item 3 exists to
   prevent.
8. **The about-org rejection message is descriptive, not opaque**, unlike
   `presby_deny_affiliation_change()`'s F40 string. It is uniform **across
   causes** (nonexistent org / never affiliated / affiliation closed are one
   message with one errcode — asserted byte-identical in `test-rls.sql`
   33(e)), which is what F40 asks. It is not opaque across tables or dates
   because there is no oracle here to close: `organizations` (including
   `parent_id`) and `organization_affiliations_public` are readable by any
   tenant connection with no org context at all, so a council can already
   answer "is this organization affiliated with me" by `SELECT`. Naming the
   table and the as_of gives the future statistics/lifecycle UI something to
   map to human copy, as `setCongregationStatisticsAction` already does.
9. **A second pre-flight `DO` block was added to `0045` beyond the one Phase 2
   requires**: a trigger does not validate rows that already exist, so any
   pre-existing violation would sit in the database permanently, invisible
   until someone tried to correct the row. It raises if any row in the four
   guarded tables would fail the rule. Clean on `development` (0 rows).
10. **The freeze trigger's owner-path proof lives in a vitest file, not in
    `scripts/test-rls.sql`.** The suite runs as `presby_app`, which after the
    grant narrowing cannot reach `UPDATE`/`DELETE` at all — its rejection
    arrives from the permission check *before* the trigger ever fires, so the
    trigger is unprovable from that connection. `test-rls.sql` therefore
    asserts the trigger's catalog shape (present, enabled, row-level, BEFORE,
    armed on UPDATE **and** DELETE) plus both tenant-side refusals, and
    `src/lib/db/domain/lifecycle.test.ts` proves the behaviour on
    `PLATFORM_DATABASE_URL`. Identical split to batch A's deviation 14 for the
    delete guard.

#### Findings for the next implementer and for QA

11. **A council can be refused a HISTORICAL row for one of its present-day
    member congregations, and this is by design (F30/F31) — but no UI knows
    it yet.** `setCongregationStatisticsAction` lets a presbytery clerk pick
    any year for any current member congregation; after `0045`, a year before
    the congregation's affiliation to that presbytery opened is refused at the
    database with `insufficient_privilege` and no mapped human copy. On the
    seeded fixture this is reachable today: the Northern Reach may not record
    Quillhaven's 1990 statistics (the Southern Fields may). Both directions
    are asserted in `src/lib/db/domain/lifecycle.test.ts` so the divergence is
    a recorded fact rather than a production surprise. **This is not a schema
    defect and not a loop-back** — the trigger is doing exactly what R3.14
    specifies — but the statistics UI needs either a year guard or an error
    mapping, and that belongs to whichever pipeline next touches
    `/o/<slug>/admin/reports`. Recommend a `docs/TODO.md` line at Phase 6
    (this batch does not touch `docs/TODO.md`, per its instructions).
12. **The coupling Phase 2 called the riskiest item is now proven in three
    places, at both scopes.** `test-rls.sql` 33(g) proves the tenant-visible
    slice; `src/lib/db/domain/lifecycle.test.ts` proves the global form
    (every parented organization in the database answers `presby_org_affiliated
    (id, parent_id, current_date) = true`, every open affiliation's
    `parent_org_id` equals its subject's cached `parent_id`, and the two counts
    match); `0045`'s own `DO` block re-proves completeness before creating the
    trigger. All three green on `development`.

#### Loop-back candidates for Phase 3

**None from this batch.** Spec defects 1 and 2 above were resolved inside the
increment's own scope (a table that structurally cannot carry the trigger, and
an underspecified instant) and are recorded here rather than returned, because
neither changes the design's shape — but tech-lead should confirm defect 1's
resolution (four tables, not five) if `per_capita_rates` was meant to gain an
`about_org_id`, which would be a different design question than this increment.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS**, clean |
| `npm test` (CI shape, no `.env.local`) | **246 files passed, 27 skipped; 3206 tests passed, 672 skipped, 0 failed** |
| `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (DB-backed) | **272 of 273 files passed; 3875 passed / 3 failed** — the 3 are `src/lib/rate-limit.test.ts`, failing only because `.env.local` sets `RATE_LIMIT_DISABLED=true` for the e2e suite. Unrelated to this batch, green under `npm test`, and identical to batch A's result. |
| `npx dotenv -e .env.local -- npx vitest run src/lib/db/domain/lifecycle.test.ts` | **9 passed** |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`) | **exit 0, 297 assertions pass** — 20 new (4 in section 32(m) plus 2 behavioural, 14 in section 33) |
| `npm run check` (all five tripwires) | **PASS** — audit-coverage, sql-date, deps-drift, brand-scope, secrets/PII |
| Re-apply `0044` then `0045` end to end | **exit 0 both**, no errors; `test-rls.sql` re-run clean (297) afterwards — idempotency proven by execution, not by reading |

**Failing-first, as the bug-fix discipline requires.** Both new protections
were watched failing before they existed and passing after:

- freeze trigger dropped + `update, delete` re-granted to `presby_platform` →
  `lifecycle.test.ts` **3 failed / 6 passed**; `0044` re-applied → **9 passed**.
- `congregation_statistics_about_org` dropped → `lifecycle.test.ts` **2 failed
  / 7 passed**; `0045` re-applied → **9 passed**.

`presby_transfer_affiliation()` was verified **by execution, not by reasoning**
(the amendment asks for exactly this): after the grant narrowing it still
closes a row and opens its successor from a `presby_app` connection — proven
once directly in `psql` and once as a test
(`lifecycle.test.ts` → "still lets `presby_transfer_affiliation()` close an
affiliation row after the grant narrowing"). It works because the function is
`SECURITY DEFINER` and runs with its owner's privileges, not the caller's.

`npm run lint` was not re-run: batch A recorded 7 errors / 190 warnings, all
pre-existing in React components, and no file this batch touched appears in
that output.

### Handoff

**Available to the next implementer (batch C, increments 4–5 —
`0046_presby_statistical_returns.sql` and `0047_presby_publications.sql`):**

- Everything batch A handed off, unchanged, **plus** the corrected grant shape:
  `presby_platform` has `select, insert` only on `organization_lifecycle_events`
  and `organization_affiliations`. If batch C needs `getPlatformDb()` to mutate
  either table, that is a design question for tech-lead, not a grant to widen
  back.
- **`organization_lifecycle_events` rows are now immutable on every
  connection.** Any fixture that inserts one must unwind it with a rolled-back
  transaction (see `src/lib/db/domain/lifecycle.test.ts`'s `inRollback()`
  helper) or the row is permanent — and it will then block its organization's
  teardown, because the event's `organization_id`/`subject_org_id` FKs are
  RESTRICT.
- **Four tables now enforce the about-org relationship at write time:**
  `congregation_oversight`, `congregation_statistics`, `per_capita_records`
  (about_org_id) and `appointments` (serving_org_id). Increment 5's rewritten
  `presby_publish_sasr_snapshot()` writes a `congregation_statistics` row for
  the **recipient presbytery** about the **publishing congregation**, so it
  passes through `congregation_statistics_about_org` — the congregation must be
  affiliated with the recipient as of the report year. That is the same
  question `presby_affiliation_parent_as_of()` already answers for the same
  row, so the two must be given the **same** year, or a publication will be
  routed to a parent the trigger then refuses. Worth an explicit test in batch
  C.
- Any new fixture writing one of those four tables must seed an
  `organization_affiliations` row whose range covers the record's year.
  `src/lib/presbytery.test.ts` and `src/lib/credentials.test.ts` use
  `effective_from = '2000-01-01'`, which covers every year those files use.

**Local apply command:**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0044_presby_org_lifecycle.sql   # re-apply: it changed
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0045_presby_about_org_affiliation.sql
# On a database whose drizzle ledger is intact (staging/production), `npm run
# db:migrate` is correct and all three files are safe under it. It is NOT
# correct on the development branch — see Schema Changes above.
# scripts/seed-dev.sql is UNCHANGED by batch B; re-seed only on a fresh database.
# `npm run db:seed` is unchanged — no new permission key, no new role, no new flag.
```

**Next agent:** **`database-admin`** for batch C's increment 4 (`0046`,
`sasr_form_versions` + `statistical_returns` + the field-spec trigger), then
increment 5 (`0047`), with **`api-developer`** taking increment 5's rewritten
`presby_publish_sasr_snapshot()` TypeScript call-site smoke test (Phase 3
Implementation Order item 7).

---

## Batch C — increments 4 and 5 (2026-09-24, database-admin)

> **BATCH C COMPLETE. PHASE 4 IS COMPLETE.** Increments 1–5 (`drizzle/0043`
> through `0047`) are all applied and proven on the `development` branch, the
> `sasr_reports` drop and `reporting.ts` deletion have landed, and
> `src/lib/db/domain/` now carries `returns.ts` and `publication.ts`.
> Increments 6 (submission grants) and 7 (name history + D13 staging) remain
> their own future work-logs, as Phase 3's header states.
>
> Two jobs, in Implementation Order's own sequence: **(6)** increment 4
> (`drizzle/0046` — `sasr_form_versions`, `statistical_returns`, the
> field-spec gate) and **(7)** increment 5 (`drizzle/0047` — `publications`,
> the `congregation_statistics` retrofit and its two-pass backfill, the
> rewritten `presby_publish_sasr_snapshot()`,
> `presby_list_published_returns_to_me()`, and the `sasr_reports` drop), plus
> item 9's remaining `test-rls.sql` sections.
>
> **One spec addition arrived mid-batch from the orchestrator** (external
> design review, 2026-09-24): withdrawal carries provenance. It is built,
> tested and recorded below under "Spec addition from the orchestrator" — it
> is not a deviation.

### Files Created

- `drizzle/0046_presby_statistical_returns.sql` (553 lines) — increment 4.
  `sasr_form_versions` (no RLS, GiST-excluded year ranges, four generations
  seeded), `statistical_returns` (FORCE RLS, composite `(id,
  organization_id)`, append-only by grant on both roles),
  `presby_freeze_statistical_return()`, `presby_enforce_sasr_field_spec()` —
  the D8 gate — and `presby_check_return_about_org()` for imported rows. Ends
  section 2 with a `DO`-block assertion that the 2024 `field_spec` is exactly
  1:1 with `congregation_statistics`'s typed SASR columns.
- `drizzle/0047_presby_publications.sql` (1,159 lines) — increment 5.
  `publications` + `publications_freeze`, the `congregation_statistics`
  retrofit, the two-pass backfill and its completeness assertions, the
  rewritten `presby_publish_sasr_snapshot()`,
  `presby_list_published_returns_to_me()`, the drop/recreate of
  `presby_list_own_congregation_publications()` around the column drop, and
  `drop table if exists sasr_reports`.
- `src/lib/db/domain/returns.ts` (204 lines) — `sasrFormVersions`,
  `statisticalReturns` (DECISION-138). `statisticsSubmissionGrants` is
  deliberately **absent**: it is increment 6, its own work-log and its own
  security pass, and the module header says so.
- `src/lib/db/domain/publication.ts` (172 lines) — `publications` alone, its
  own module per Ruling 9.
- `src/lib/db/domain/publication.test.ts` (652 lines) — 15 DB-backed tests.
  The publish path through `withOrgContext()` on the RLS-enforced `db`
  connection, the recipient read-back through the same, the shipped
  `getCongregationStatisticsRollup()` reader, and the owner-connection half
  (`PLATFORM_DATABASE_URL`) that `scripts/test-rls.sql` structurally cannot
  reach.

### Files Modified

- `drizzle/meta/_journal.json` — idx 46 and 47, tags matching the filenames
  exactly. `ls drizzle/` was re-run immediately before writing each file
  (`0045` then `0046` were the highest on disk) and `docs/TODO.md`'s In Flight
  list was re-read for a concurrent schema pipeline (none).
- `src/lib/db/domain/presbytery.ts` — `congregationStatistics` gains
  `publicationId`, the composite FK and the shape CHECK; loses
  `supersedesPublicationId` (and with it the `AnyPgColumn` import). `publishedAt`
  and `minuteReference` KEPT, each with the F39 argument in its own doc
  comment so a future reader does not re-attempt round 3's move.
- `src/lib/db/domain/index.ts` — `./reporting` out; `./returns` and
  `./publication` in.
- `src/lib/db/domain/reporting.ts` — **deleted** (see below).
- `src/lib/dev-docs.ts` — `sasr_reports` removed from `MODULES`;
  `sasr_form_versions`/`statistical_returns`/`publications` added under
  "J. Reporting"; three new `BESPOKE_POLICIES` notes; and the third
  `INVARIANTS` entry Phase 2 named — **"Publication is an event, not a
  data-entry screen"**, marked `database`. (Marker rationale: every clause of
  that entry is enforced by a constraint, a trigger or a DEFINER function —
  the not-null-when-published CHECK, the composite FK, three freeze triggers,
  and the two functions' internal filters. Nothing in it is `documented`.)
- `src/lib/presbytery.ts` — two stale comments only (`:55`, `:613`) now name
  `publications.supersedesId` instead of the dropped column. No behaviour
  change; this is the module Ruling 5 exists to protect and it needed none.
- `src/lib/presbytery.test.ts` — a `makePublication()` fixture helper, and
  teardown for the two new tables. See deviation 9.
- `scripts/seed-dev.sql` — the `sasr_reports` fixture block removed with the
  table; Alder Creek's published row is now three rows (artifact, event,
  projection) with fixed ids `a8000000-…-0001` / `a9000000-…-0001`.
- `scripts/test-rls.sql` — new **section 34** (57 assertions); section 29(e)
  rewritten for the new return value and the moved chain; 29(f)/(g)/(j)'s
  comments corrected from `parent_id` to the affiliation mechanism. **357
  assertions total, up from batch B's 297.**
- `docs/schema-design.md` — regenerated by `npm run docs:erd`: section J's
  diagram now shows `publications`/`statistical_returns`/`sasr_form_versions`
  instead of `sasr_reports`, and `organization_identifiers` and the
  "K. Lifecycle and affiliation" diagram from batches A/B are refreshed with
  it.

### Files Deleted

- `src/lib/db/domain/reporting.ts` — it contained only `sasrReports` and
  empties out under Ruling 6 / DECISION-137. Every reference is gone
  (`grep -rn "sasrReports\|sasr_reports" src scripts e2e` returns only
  `drizzle/`'s own historical migrations).

### Schema Changes

**Applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f …` against
the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, 15
organizations — verified NOT production, which holds 2). Production was never
touched.**

**Migration mode: `db:generate`-equivalent — hand-written versioned SQL in
`drizzle/`, not `db:push`.** Drizzle Kit emits none of it (RLS, FORCE RLS, two
GiST/exclusion constructs, six triggers, five functions, a seeded reference
table, a two-pass data backfill and four `DO`-block assertions), so
`npm run db:generate` was never run — as Phase 3's Edge Cases require.

**`npm run db:migrate` was NOT the apply command and cannot be on this
branch** — `drizzle.__drizzle_migrations` on `development` records only the
first 10 migrations (`docs/testing.md`), so it would replay 0010–0047. Both
files are written to be `db:migrate`-safe where the ledger is intact.

- **Tables added:** `sasr_form_versions`, `statistical_returns`,
  `publications`. **Table dropped:** `sasr_reports`.
- **Columns added:** `congregation_statistics.publication_id`;
  `publications.withdrawn_by` / `publications.withdrawn_minute_reference` (the
  orchestrator's spec addition). **Column dropped:**
  `congregation_statistics.supersedes_publication_id`.
- **Constraints added:** `sasr_form_versions_no_overlap` (GiST EXCLUDE over
  `int4range`), `sasr_form_versions_year_order`,
  `sasr_form_versions_field_spec_shape`, `statistical_returns_id_org_key`,
  `statistical_returns_provenance_allowed`,
  `statistical_returns_report_year_range`,
  `statistical_returns_submitted_is_self`, `publications_id_org_key`,
  `publications_artifact_fk` (composite), `publications_record_class_allowed`,
  `publications_not_self_superseding`, `publications_withdrawal_shape`,
  `congregation_statistics_publication_fk` (composite),
  `congregation_statistics_publication_shape`.
- **Functions added:** `presby_freeze_statistical_return()`,
  `presby_enforce_sasr_field_spec()`, `presby_check_return_about_org()`,
  `presby_freeze_publication()`, `presby_list_published_returns_to_me()`.
  **Rewritten:** `presby_publish_sasr_snapshot()` (same name, same 62-parameter
  allow-list). **Dropped and recreated unchanged:**
  `presby_list_own_congregation_publications()` (its `setof
  congregation_statistics` return type follows the table, and the column drop
  is cleaner around an explicit drop than left to type re-derivation).
- **Triggers added:** `statistical_returns_freeze`,
  `statistical_returns_field_spec`, `statistical_returns_about_org`,
  `publications_freeze`.
- **Grants:** `select, insert` to `presby_app` and `presby_platform` on
  `statistical_returns` and `publications`, with `update, delete` explicitly
  revoked from both on both; `select` only on `sasr_form_versions`.

**Backfill result on `development`:** *"publications backfill complete: 1
projection row(s) stamped, 0 supersession link(s) rebuilt, 1 published row(s)
now carry a publication (0 unstamped)"*, followed by *"publications
completeness proven: 1 published projection row(s), all stamped, all agreeing
with their publication on congregation/recipient/published_at/
minute_reference"*. Production holds **zero** rows of any provenance in
`congregation_statistics` (orchestrator addendum, verified), so the backfill
had nothing to do there — but it is written and proven for the publish-UI
pipeline that will produce real rows.

**Idempotency, proven by execution not by reading:** both whole files
re-applied end to end (`exit=0`), three times each across the batch including
after the orchestrator's amendment. On re-run `0046` re-prints its 60-field
assertion and `0047` prints *"publications backfill: supersedes_publication_id
is already gone — this migration has run before; nothing to mint"* followed by
the completeness proof, which runs on EVERY application rather than only on
the pass that minted something.

### Audit Events

No new `AUDIT_ACTIONS` key; `npm run check:audit` passes. DDL writes no audit
rows and this batch touches no server action, no route handler and no React.

### Implementer Notes

#### Spec addition from the orchestrator (external design review, 2026-09-24)

**Withdrawal carries provenance, and the transition is enforced.** Delivered
in full, and it is the right call: `organization_affiliations` already records
`closed_by_org_id` / `closed_by` / `closed_on` / `closed_minute_reference`
precisely so a close is never an unattributable mutation of a provenanced
record (DECISION-135, Ruling 1), and a publication withdrawn with only a bare
timestamp would have been exactly that. Built:

- `publications.withdrawn_by uuid references users(id)` and
  `publications.withdrawn_minute_reference text`, both nullable, both added in
  the `CREATE TABLE` **and** as idempotent `ALTER … ADD COLUMN IF NOT EXISTS`
  (a `create table if not exists` is a no-op on a database that already ran an
  earlier form of the file — the same pattern `0044` uses for the
  `organizations` columns).
- `publications_freeze` now permits **exactly one transition**: a row whose
  three withdrawal columns are all null may have them set, `withdrawn_at`
  required, with no other column moving in that statement. Every other UPDATE
  and every DELETE raise `check_violation` in
  `presby_freeze_lifecycle_event()`'s message shape. A withdrawal is not
  reversible, re-datable or re-minutable.
- `publications_withdrawal_shape` CHECK: attribution cannot exist without the
  act. The trigger governs the transition; the CHECK governs the resulting
  row, including for the owner's own writes.
- `update` stays **revoked** from `presby_app`. The intended writer is named
  in both the migration header and the Drizzle module header: a future
  `presby_withdraw_publication()` SECURITY DEFINER function in the publish-UI
  pipeline, in `presby_transfer_affiliation()`'s confused-deputy shape. Not
  built here, so withdrawal is an owner-only act today.
- `presby_list_published_returns_to_me()` returns all three withdrawal
  columns; the base filter stays `withdrawn_at is null`. Adding columns
  changes the return type, which `CREATE OR REPLACE` cannot do, so the
  function is dropped first — safe, it ships in the same migration and has no
  application caller.

**One redirection, and it is the pipeline's standing split rather than a
choice.** The instruction asks for the three-step sequence (set once succeeds;
a second UPDATE touching another column raises; DELETE raises) as a
`test-rls.sql` assertion. That suite is a single `presby_app` connection by
construction — its own first line says "MUST be run as presby_app, never as
the owner" — and `presby_app` holds no UPDATE on `publications` at all, so its
rejection arrives from the permission check before the trigger can fire and
the transition is unperformable there. `test-rls.sql` section 34 therefore
asserts the *structure* (the three columns exist, the shape CHECK exists, the
trigger is enabled/row-level/BEFORE/armed on UPDATE and DELETE, the read-back
signature carries the triple via `pg_proc.proargnames`, and every tenant-side
verb is refused), and the exact three-step *behaviour* is
`src/lib/db/domain/publication.test.ts` → "permits the ONE transition — the
three withdrawal columns set together, once — and refuses every later touch",
on `PLATFORM_DATABASE_URL`. This is the identical split batch A's deviation 14
and batch B's deviation 10 already record for the delete guard and the
lifecycle freeze.

#### Spec defects found (not silently reconciled)

1. **Phase 3's retrofit foreign key is unbuildable as written, and would have
   rejected every row it was meant to protect.** The Data Model specifies

   ```sql
   foreign key (publication_id, organization_id) references publications (id, organization_id)
   ```

   `congregation_statistics.organization_id` is the **recipient presbytery**;
   `publications.organization_id` is the **source congregation**. They are
   different organizations by construction — that asymmetry is the whole point
   of DECISION-120 ("organization_id is the presbytery for EVERY provenance")
   meeting D20 ("OWNER: the source council"). The constraint as specified
   would fail on the first published row. **Resolution, built and commented at
   both the SQL and Drizzle sites:** the column that equals
   `publications.organization_id` is `congregation_statistics.about_org_id`,
   so the FK is `(publication_id, about_org_id) → publications (id,
   organization_id)`. This *preserves* the F2 property the composite exists
   for — a projection cannot claim a publication recorded by a different
   congregation — rather than weakening it to a plain FK. Not a loop-back:
   the design's intent is unambiguous and only the column name was wrong.

2. **`withdrawn_at` filtering: §5/Ruling 5 and the Phase 3 API Contract say
   opposite things.** `docs/schema-design-2.md` §5 and Phase 2 Ruling 5 both
   specify "filters internally on `recipient_org_id = presby_current_org()`
   **and `withdrawn_at is null`**"; the Phase 3 API Contract's prose says
   "**Does not** filter on `withdrawn_at is null` in the base query — it is
   returned as a column." Resolved per the orchestrator's instruction and the
   design authority: the filter is applied, and the withdrawal columns are
   nevertheless retained in the return signature so that surfacing withdrawn
   rows later is a WHERE-clause change rather than a signature change every
   caller has to follow. **Stated consequence, in the migration rather than
   left for a reader to find:** under the filter as written those columns are
   always null.

3. **`sasr_reports` and `drizzle/0009`'s `tenant_tables` array: §5 and Phase 3
   disagree.** §5 says "Removed from `drizzle/0009`'s `tenant_tables` array
   (`:72`)"; Phase 3's Data Model says the array "is not retroactively
   editable (0009 already ran) — this migration's own DROP TABLE is
   sufficient." Followed Phase 3 (the later authority, and the instruction's
   own default). 0009 is untouched; `0047` does `drop table if exists
   sasr_reports`. **Consequence stated in the migration header:** a replay
   from zero is fine (0009 runs before 0047), but re-applying 0009 *alone and
   out of order* after this migration would fail on the missing table — the
   same additive-replay hazard batch B recorded as finding 4.

4. **`jsonb_build_object` cannot take 120 arguments.** `FUNC_MAX_ARGS` is 100,
   and 60 payload fields are 120 arguments. The publish function builds the
   payload in three chunks of 20 pairs concatenated with `||`. Named because
   the grouping has no meaning and a future reader must not look for one.

5. **`per_capita_rates`, batch B's spec defect 1, is unchanged and not
   revisited.** Still no `about_org_id`; still asserted absent by name in
   section 33(a).

#### Deviations taken deliberately

6. **The form version is `'2024'` unconditionally, not resolved from
   `p_report_year`.** Phase 3's API Contract step 5 says "resolve current
   `form_version_key` for `p_report_year` from `sasr_form_versions`"; the
   orchestrator's instruction says "under form version '2024'". Built as
   `'2024'`, and the reasoning is in the migration header: this function's
   typed parameter list **is** the 2024 field set (0046 asserts the 1:1
   correspondence), so recording a payload gathered through these parameters
   under any other generation would be the lie, whatever the report year says.
   Year-resolution would additionally make every pre-2024 report year
   unpublishable today, since 1984/2014/2022 are deliberate empty
   placeholders — a regression against 0038's 1900–2100 window in a function
   with no caller. Publishing is a current act on today's form; the path for
   genuinely older generations is `provenance = 'imported'` through D13.

7. **`statistical_returns_submitted_is_self` is a strengthening beyond the
   Phase 3 Data Model.** §5 states the rule in prose ("OWNER: the congregation
   for submitted … `about_org_id`: the congregation"), so for a submitted
   return the owner and the subject are the same body by definition, but
   nothing enforced it. Without the CHECK a congregation could file — and then
   publish — a return **about a different congregation**, one layer below the
   confused-deputy guard `presby_publish_sasr_snapshot()` provides. Flagged
   rather than slipped in because it is the one constraint here that could
   constrain increment 6: D16's grant-submitted return is owned by the
   congregation and about itself, so it fits, but if that increment finds
   otherwise this is a one-line `ALTER`.

8. **`sasr_form_versions_no_overlap` added.** §5 says "ranges may not overlap"
   and names no mechanism. A GiST EXCLUDE over
   `int4range(effective_first_year, coalesce(effective_last_year, 9999), '[]')`
   is the mechanism; without it "which spec validates a 2015 payload" is
   ambiguous. No extension needed — `int4range && int4range` is native GiST,
   and `btree_gist` (already installed) is not involved.

9. **`src/lib/presbytery.test.ts`'s published-row fixtures broke on the new
   shape CHECK and are rebuilt, not worked around.** Three
   `platform.insert(congregationStatistics)` calls with
   `provenance = 'published_by_congregation'` and no publication now violate
   `congregation_statistics_publication_shape`. A `makePublication()` helper
   mints the artifact and the event each projection projects; teardown deletes
   both, children first, with their freeze triggers disabled. **Deliberately
   NOT rewritten to call `presby_publish_sasr_snapshot()`**: those two tests
   exercise the coalesce ordering and need a *chosen* `published_at`, which
   the function correctly refuses to accept. Two new disable/enable pairs
   appear in that teardown — they are for the two new freeze triggers, not a
   16th delete-guard block (Ruling 7.3 is untouched), and without them the
   organizations cascade would hit the same triggers and fail anyway.

10. **`test-rls.sql` section 29(e) is rewritten rather than deleted.** It read
    the dropped `supersedes_publication_id` and matched the function's old
    return value (the projection id). What it exists to prove — the
    confused-deputy shape — is unchanged and stays there, joined through the
    publication now; the republish-chain half moved to section 34(h), where
    the chain lives. Sections 29(f)/(g) keep their errcodes and gain corrected
    text (the recipient comes from the affiliation history, not `parent_id`).

11. **Two functions are dropped and recreated rather than replaced.**
    `presby_list_own_congregation_publications()` returns `setof
    congregation_statistics`, so its return type is the table's row type and
    the column drop is cleaner around an explicit drop than left to
    re-derivation; its body is byte-identical. `presby_list_published_
    returns_to_me()` is dropped because the orchestrator's amendment changes
    its return type, which `CREATE OR REPLACE` cannot do.

12. **`authorized_by`, `attested_by_name`, `attested_role` and `withdrawn_by`
    are written null by every path in this batch.** Ruling A4 unchanged: there
    is no `app.current_user_id` GUC, and accepting a user id or an attester
    name as a parameter would be the caller-supplied identity claim this
    function's shape refuses. `attested_at` IS written (it is a fact about the
    transaction, not a claim about a person), and the session minute IS
    recorded — on the publication, where it belongs.

13. **The seeded ids and the backfilled ids differ, deliberately, and every
    test is id-agnostic.** A freshly-seeded database gets Alder Creek's
    artifact and publication at the fixed ids `a8000000-…-0001` /
    `a9000000-…-0001`; a database migrated through `0047` gets randomly-minted
    ones from the backfill. Rather than reconcile the `development` branch to
    the seed (which would mean disabling two freeze triggers to delete
    provenanced rows), section 34 and `publication.test.ts` derive the
    publication from `congregation_statistics.publication_id` and never pin an
    id. Both shapes pass. Consistent with batches A/B's handoff: re-seed only
    on a fresh database.

#### Findings for the next implementer and for QA

14. **THE INCREMENT-3/INCREMENT-5 COLLISION IS REAL, IS NOW SURFACED, AND IS
    THE ONE THING TECH-LEAD SHOULD RULE ON.** Batch B's handoff predicted it
    ("the two must be given the SAME year, or a publication will be routed to
    a parent the trigger then refuses"). It is not a bug in either increment —
    it is two correct rules meeting:

    - `drizzle/0045`'s `congregation_statistics_about_org` checks the
      projection against the affiliation **as of the report year** (that is
      what makes a 1990 return resolve to the council that received it, F30/F31);
    - D19/§5 resolves the publication's recipient **as of `published_at`** —
      the presbytery of *current* membership, because G-3.0108(a) makes it the
      reviewing council.

    For a congregation redistricted between the report year and the filing
    date those are different councils, and the projection insert is refused.
    **What I built:** the publish function asks the same question first, with
    the same year-endpoint semantics, and raises a named
    `invalid_parameter_value` a UI can map to human copy — instead of letting
    an opaque `insufficient_privilege` about-org message surface *after* two
    rows are already written in the transaction. **What I did NOT build:** any
    widening of 0045's rule, because batch B's finding 11 records the refusal
    as deliberate. **The open question for Phase 3:** a congregation that moved
    presbyteries in January genuinely cannot file its prior-year return through
    this function at all today. The honest options are (a) accept it and let
    the receiving presbytery record the row as `presbytery_entered`/`imported`
    (which the about-org trigger also refuses for that council…), (b) let the
    projection's about-org check accept affiliation at the report year **or**
    at the publication's recipient-as-of-today, or (c) route late filings to
    the *former* council. Asserted in both directions in `test-rls.sql`
    34(i) and in `publication.test.ts`. **Loop-back candidate, not blocking:**
    no shipped surface reaches this path, and the fixture proves the ordinary
    case works.

15. **`congregation_statistics` and its three `0038` siblings are absent from
    `src/lib/dev-docs.ts`'s `MODULES` map, so they render under "platform" on
    `/developer` and appear in NO ERD diagram** (`grep -n
    "congregation_statistics" docs/schema-design.md` returns nothing, even
    after `npm run docs:erd`). Pre-existing since the 0038 pipeline, not
    introduced here, and not fixed here because regrouping four shipped tables
    on the `/developer` page is a different change than this increment.
    Recommend a line for the documentation review. It is why the new
    `publication_id` FK does not show up in section J's refreshed diagram even
    though `publications → statistical_returns` does.

16. **The `0009` blanket-grant hazard now touches five tables.** Batch B's
    finding 4 named it; `statistical_returns` and `publications` join
    `organizations`, `organization_affiliations` and
    `organization_lifecycle_events` as tables whose narrowed grant would be
    re-widened by a bare re-application of `drizzle/0009:44`. Section 34(a)'s
    grant-shape assertion is what catches it. F38's root cause is still
    worked around table-by-table rather than removed.

17. **Nothing in this batch reaches an application surface.** No route
    handler, no server action, no React, no `FEATURES` key, no flag. The one
    shipped reader in the blast radius, `getCongregationStatisticsRollup()`,
    is asserted unchanged in `publication.test.ts` — which is the concrete
    payoff of Ruling 5's refusal to move `published_at` and
    `minute_reference`.

#### Loop-back candidates for Phase 3

- **The increment-3/increment-5 as-of collision** (finding 14). The only one
  that is a genuine design question rather than a corrected typo.
- **`statistical_returns_submitted_is_self`** (deviation 7) — confirm the
  strengthening is wanted before increment 6 designs the grant flow against
  it.
- **The form-version policy** (deviation 6) — confirm `'2024'`-always is the
  intended reading of "the parameter list is the allow-list", since the Phase 3
  API Contract's own text says resolve-by-year.

None blocks Phase 5.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS**, clean |
| `npm test` (CI shape, DB env unset) | **246 files passed, 28 skipped; 3206 tests passed, 687 skipped, 0 failed** |
| `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (DB-backed) | **273 of 274 files passed; 3890 passed / 3 failed** — the 3 are `src/lib/rate-limit.test.ts`, failing only because `.env.local` sets `RATE_LIMIT_DISABLED=true` for the e2e suite. Unrelated, green under `npm test`, and identical to batches A and B. |
| `… vitest run src/lib/db/domain/publication.test.ts` | **15 passed** |
| `… vitest run src/lib/presbytery.test.ts` | **34 passed** (was failing 2 before the fixture rebuild — see deviation 9) |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`) | **exit 0, 357 assertions pass** — 60 new (57 in section 34, 3 replacing section 29(e)'s moved assertions) |
| `npm run check` (all five tripwires) | **PASS** — audit-coverage, sql-date, deps-drift, brand-scope, secrets/PII |
| `npm run docs:erd` | *"docs/schema-design.md: refreshed 10 diagrams from 83 tables"* (needs `dotenv -e .env.local --`; it imports `@/lib/db`) |
| `npx eslint` on every file this batch touched | **clean**, 0 errors 0 warnings |
| Re-apply `0046` then `0047` end to end | **exit 0 both**, repeatedly, including after the orchestrator's amendment; `test-rls.sql` re-run clean (357) afterwards — idempotency proven by execution, not by reading |

**Failing-first, as the discipline requires.** Every new protection was watched
failing before it existed and passing after:

- `statistical_returns_field_spec`, `statistical_returns_freeze` and
  `publications_freeze` all dropped → `publication.test.ts` **6 failed /
  8 passed**; `0046` and `0047` re-applied → **14 passed** (pre-amendment run).
- `publications_freeze` alone dropped after the orchestrator's amendment →
  **4 failed / 11 passed**; `0047` re-applied → **15 passed**.
- `src/lib/presbytery.test.ts`'s two coalesce tests failed on
  `congregation_statistics_publication_shape` before the fixture rebuild and
  pass after — a real regression the retrofit caused, caught and fixed inside
  the batch rather than handed to QA.

**Migration output, verbatim, first application:**

```
NOTICE:  sasr_form_versions: the 2024 field_spec covers every typed SASR column congregation_statistics carries (60 fields)
NOTICE:  publications backfill complete: 1 projection row(s) stamped, 0 supersession link(s) rebuilt, 1 published row(s) now carry a publication (0 unstamped)
NOTICE:  publications completeness proven: 1 published projection row(s), all stamped, all agreeing with their publication on congregation/recipient/published_at/minute_reference
```

**and on re-application:**

```
NOTICE:  sasr_form_versions: the 2024 field_spec covers every typed SASR column congregation_statistics carries (60 fields)
NOTICE:  publications backfill: supersedes_publication_id is already gone — this migration has run before; nothing to mint
NOTICE:  publications completeness proven: 1 published projection row(s), all stamped, all agreeing with their publication on congregation/recipient/published_at/minute_reference
```

`npm run lint` across the whole repo was not re-run: batch A recorded 7 errors
and 190 warnings, all pre-existing in React components, and no file this batch
touched appears in that output (verified by linting each of them directly).

### Handoff

**Available to the next implementer:**

- `sasr_form_versions` — four generations seeded. `'2024'` carries the
  complete 60-field spec; `'1984'`/`'2014'`/`'2022'` are **fail-closed
  placeholders** whose empty spec accepts no payload key at all. Filling them
  in is a data edit against this table and is owed to increment 7's D13 import.
- `statistical_returns` — immutable, append-only, FORCE RLS, owned by the
  congregation for `submitted` and by the presbytery for `imported`. Any
  payload is gated by the named generation's `field_spec`; any *imported* row
  is gated by the affiliation history as of the report year.
- `publications` — immutable except for a single, attributed withdrawal.
  `recipient_org_id` is fixed at write time from
  `presby_affiliation_parent_as_of()`.
- `presby_publish_sasr_snapshot(...)` — same name, same allow-list parameter
  list, **returns the `statistical_returns` id now** (it returned the
  `congregation_statistics` id before). Writes three rows in one transaction.
  Raises `invalid_parameter_value` for: no current affiliation, a current
  council that is not a presbytery, a report year outside 1900–2100, any value
  out of range, and a report year predating the congregation's affiliation to
  its current council (finding 14).
- `presby_list_published_returns_to_me(p_about_org_id, p_year)` — the
  recipient's read, `stable security definer`, no council parameter, filtered
  on `recipient_org_id = presby_current_org() and withdrawn_at is null`.
  Returns 14 columns including the whole withdrawal triple.
- `presby_list_own_congregation_publications(p_year)` — unchanged contract;
  its rows now carry `publication_id` instead of `supersedes_publication_id`.
- **A publish-UI pipeline is now fully unblocked on the database side, and it
  owes three things this pipeline names but does not build:**
  `presby_withdraw_publication()` (the SECURITY DEFINER writer for the
  withdrawal triple), the congregation's working-draft surface that
  `sasr_reports` used to nominally serve, and an error mapping for
  `presby_publish_sasr_snapshot()`'s five rejection branches.
- **Any fixture writing a `published_by_congregation` row must now mint an
  artifact and a publication first** — see `makePublication()` in
  `src/lib/presbytery.test.ts` for the shape — and must unwind all three
  (children first, freeze triggers disabled) or use a rolled-back transaction.

**Local apply command:**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0046_presby_statistical_returns.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0047_presby_publications.sql
# On a database whose drizzle ledger is intact (staging/production), `npm run
# db:migrate` is correct and all five files are safe under it. It is NOT
# correct on the development branch — see Schema Changes above.
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql   # fresh databases only; the seed CHANGED
# `npm run db:seed` is unchanged — no new permission key, no new role, no new flag.
npx dotenv -e .env.local -- npm run docs:erd           # already run; re-run only if the schema moves
```

**Next agent:** **`qa`** (Phase 5). Run the DB-backed suites with
`--no-file-parallelism` (the 3 `rate-limit.test.ts` failures under
`.env.local` are expected and unrelated), and `scripts/test-rls.sql` as
`presby_app` — sections **34** (returns and publication) and **33** (about-org)
are the new ones, and section **29** was edited. No auth-touching surface, no
route handler and no React in any of the three batches, so the Phase 4 gate's
running-server e2e login smoke does not apply here.


## Loop-back after Phase 5 (2026-09-24, database-admin) — recorded verbatim by the orchestrator

**Scope:** QA Phase 5 Finding 1 only — `organization_successions` had no RLS, no `organization_id`, and granted `presby_app` `SELECT, INSERT, DELETE`, so a council could insert (and delete) succession rows naming a lifecycle event it could not read. Phase 2 Ruling 1's rule ("cross-council access to the three-axis tables is function-mediated, never policy-mediated") is now applied to that table. Nothing else in the pipeline was touched. Design ruling: Phase 3 "Amendment after Phase 5"; `docs/schema-design-2.md` §2e (F46); DECISION-135 third correction.

**Migration mode:** a change to the existing, unreleased `drizzle/0044_presby_org_lifecycle.sql` (same file, same number, idempotent — the Ruling A5 precedent), applied with `psql "$MIGRATE_DATABASE_URL"` on the `development` branch. `_journal.json` unchanged.

### Files Modified

- `drizzle/0044_presby_org_lifecycle.sql` — grants (section 3), `presby_check_succession_event()` + trigger `organization_successions_event_scope` (13b), `presby_freeze_succession()` + trigger `organization_successions_freeze` (13c), header item 10, table comment.
- `src/lib/db/domain/lifecycle.ts` — comments only; table shape unchanged.
- `src/lib/db/domain/lifecycle.test.ts` — +7 tests (grant shape, two event-scope probes with byte-identical uniform message via the innermost `.cause`, two freeze probes, the two cardinality proofs relocated from `test-rls.sql` 32(j)).
- `scripts/test-rls.sql` — 32(j) rewritten: grant shape for both roles (via `aclexplode` for the platform role), live INSERT/DELETE refusal probes, structural assertions for all three triggers; the cardinality *behaviour* moved to `lifecycle.test.ts` because a SELECT-only role cannot exercise it (comment in the file says so).
- `src/lib/dev-docs.ts` — one sentence at `:156` corrected (it repeated the disproved "visible through a join" claim on `/developer`).

### Schema Changes

1. Grants: `presby_app` → `SELECT` only; `presby_platform` → `SELECT, INSERT` (UPDATE/DELETE revoked). SELECT stays because topology is public.
2. `presby_check_succession_event()`, `BEFORE INSERT`, **SECURITY DEFINER** (reads the FORCE-RLS events table — F26): the named `event_id` must exist and, when `presby_current_org()` is set, belong to it; both rejections raise the uniform lifecycle message (DECISION-139). Deliberately does not refuse a null context (migration backfills and platform provisioning set no GUC); the absent grant and the freeze bound that path.
3. `presby_freeze_succession()`, `BEFORE UPDATE OR DELETE`, fires on the owner path. DELETE is not needed by any legal flow: the cardinality trigger is deferred, so an in-progress `merged` is legal until commit and a mistake is unwound by ROLLBACK; the events table's own freeze already makes the `on delete cascade` unreachable.
4. The future `presby_record_lifecycle_event()` (one family with `presby_organize_congregation()`) is the only tenant-side writer; the migration says not to re-grant INSERT as a shortcut. The event-scope trigger is what holds that DEFINER function to its own council even though, as owner, no grant will.

### Verification (run by the implementer)

- Failing-first before apply: `lifecycle.test.ts` → 5 failed / 11 passed, the grant-shape diff printing the defect (`presby_app.DELETE/INSERT`, `presby_platform.DELETE/UPDATE`).
- Apply 0044 whole → exit 0; re-apply → exit 0, zero errors (backfill notice unchanged: 9 = 9).
- Per-trigger failing-first: drop `organization_successions_event_scope` → `lifecycle.test.ts` 2 failed / 14 passed and `test-rls.sql` exit 3 at `:3128`; drop `organization_successions_freeze` → 2 failed / 14 passed; both restored by whole-file re-apply.
- Final: `test-rls.sql` as `presby_app` → **exit 0, 363 assertions** (357 + 9 − 3 moved); `lifecycle.test.ts` + `org-provisioning.test.ts` + `publication.test.ts` serial → 47 passed; `npm run typecheck` clean; `npm run check` all five pass; eslint on touched files clean; `npm test` CI shape 3206 passed / 694 skipped (all 7 new tests are DB-backed).
- Live catalog after re-apply: grants `presby_app.SELECT`, `presby_platform.INSERT`, `presby_platform.SELECT`; triggers `organization_successions_cardinality` (deferred), `_event_scope`, `_freeze`, all enabled.


## Loop-back after external implementation review (2026-09-24, database-admin)

**Scope:** the constraint-and-authority hardening pass ruled in Phase 3's
"Amendment after external implementation review" (F47–F53,
`docs/schema-design-2.md` §2f, DECISION-140). Seven items, all schema: no route
handler, server action or UI surface is touched.

**Migration mode: correction in place, same files, same numbers** —
`drizzle/0043`, `0044`, `0046`, `0047` (0045 was re-applied unchanged for
ordering). These four are on `main` but have never reached production (deploys
do not migrate; production holds 2 organizations and 0 statistics rows), so this
is the precedent Ruling A5.1 / F46 established and this work-log has now used
five times. `drizzle/meta/_journal.json` is **unchanged** — no new file.
Applied on the `development` Neon branch with
`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f` per file, in order 0043 →
0047, then all five re-applied whole twice to prove idempotence.

### Files Modified

- `drizzle/0043_presby_org_identifiers.sql` — grant narrowed to `SELECT` for `presby_app`; new sections 3 (`presby_deny_identifier_change()`, `presby_set_organization_identifier()`) and 4 (`presby_guard_organization_identifiers()` + trigger `organization_identifiers_guard`); table comment.
- `drizzle/0044_presby_org_lifecycle.sql` — `organization_successions_edge_unique`; three `organization_affiliations` CHECKs; `presby_guard_organization_affiliations()` + trigger `organization_affiliations_guard`; the `set_config` moved to the top of `presby_transfer_affiliation()` and its close-date guard tightened `>` → `>=`; `presby_apply_lifecycle_event()` arms the same GUC in its close branch; `presby_guard_organizations_delete()` arms both GUCs after validating `deletable_until`; three superseded comments rewritten (section 12's A5.3 note, section 15's "grant alone" note, the table comment).
- `drizzle/0046_presby_statistical_returns.sql` — `INSERT` revoked from both roles; new section 7 (`presby_freeze_used_field_spec()` + trigger `sasr_form_versions_field_spec_freeze`) and section 8 (a comment recording why the provenance CHECK lives in 0047); `withdrawn_at` added to the 2024-field-spec self-assertion's bookkeeping-column list.
- `drizzle/0047_presby_publications.sql` — `publications_withdrawal_shape` corrected in both places; `INSERT` revoked from both roles; `presby_check_publication_supersession()` + trigger `publications_supersession`; backfill attestation placeholders, `attested_at` coalesce, `withdrawn_at` added to the payload-subtraction list, a convergence UPDATE for rows the earlier build already minted; `statistical_returns_provenance_shape`, `publications_supersedes_once_idx`, `publications_id_recipient_key`, `congregation_statistics_publication_recipient_fk`; new section 5b (`congregation_statistics.withdrawn_at` + the widened `presby_reject_published_statistics_write()`); the `withdrawn_at is null` filter removed from `presby_list_published_returns_to_me()`; three comments rewritten.
- `src/lib/db/domain/org.ts` — `organizationIdentifiers` doc block: the whole write-authority model, stated because none of it is Drizzle-expressible.
- `src/lib/db/domain/lifecycle.ts` — `organizationSuccessions` gains `unique(...edge_unique)`; `organizationAffiliations` gains the three `check(...)`s and a note on the guard trigger.
- `src/lib/db/domain/returns.ts` — `statisticalReturns` gains `statistical_returns_provenance_shape`; `sasrFormVersions` gains a note on the field-spec freeze.
- `src/lib/db/domain/publication.ts` — `publications_withdrawal_shape` corrected; `unique(publications_id_recipient_key)`; `uniqueIndex(publications_supersedes_once_idx).where(...)`; module header and `withdrawnAt` doc updated to Option A.
- `src/lib/db/domain/presbytery.ts` — `congregationStatistics` gains `withdrawnAt` and the second composite FK.
- `scripts/seed-dev.sql` — Quillhaven's closed historical row carries its close attribution INLINE; the trailing `update organization_affiliations` is deleted (the guard would refuse it, and the closed-shape CHECK would refuse the row it repaired).
- `scripts/test-rls.sql` — section 32 gains blocks (n) and (o) and four behavioural blocks; 32(m)'s A5.3 assertion rewritten; section 34(a)'s grant assertion tightened; 34(f)/(g) rewritten (see Implementer Notes — thirteen probes moved to `publication.test.ts`).
- `src/lib/db/domain/lifecycle.test.ts` — fixture close attribution; +9 tests (F48, five F49 shape probes, three F49 guard probes including the cascade regression).
- `src/lib/db/domain/publication.test.ts` — the withdrawal test reversed to Option A; +21 tests (the thirteen moved probes, F50 ×4, F51 ×6, F53 ×3, the projection-mark transition).

### Files Created

- `src/lib/db/domain/org-identifiers.test.ts` — 9 tests. The table had no test file of any kind before this pass.

### Schema Changes

**1. `organization_identifiers` (F47, `drizzle/0043`).** `presby_app` → `SELECT`
only; `presby_platform` keeps its DML unchanged (documented intent, inert
today). `presby_set_organization_identifier(p_organization_id, p_kind,
p_value_normalized, p_is_verified default false, p_source default null)
returns uuid`, `SECURITY DEFINER`: actor is `presby_current_org()`, permitted
when the actor IS the subject or holds `presby_org_affiliated()` standing over
it, upserting on `(organization_id, kind, value_normalized)`. Rejections raise
one table-specific literal via the new `presby_deny_identifier_change()`.
`organization_identifiers_guard`, `BEFORE UPDATE OR DELETE`, keyed on the NEW
transaction-local GUC `presby.identifier_trigger_active`. INSERT left ungated
beyond the grant, as ruled. `createOrganization()` and `scripts/seed-dev.sql`
were checked and write no identifier rows, so neither needed the GUC.

**2. `organization_successions` (F48, `0044`).** `UNIQUE (event_id,
predecessor_org_id, successor_org_id)`, added as an idempotent named-constraint
add. Nothing else, as ruled.

**3. `organization_affiliations` (F49, `0044`).** Three of the four CHECKs —
`_range_order`, `_closed_shape` (excluding `closed_by`, per the ruling's own
deviation), `_not_self`. The fourth is **not built**; see Implementer Notes.
`organization_affiliations_guard`, `BEFORE UPDATE OR DELETE`, reusing
`presby.affiliation_trigger_active`, which is now armed by **three** sanctioned
writers: `presby_transfer_affiliation()` at its entry, `presby_apply_lifecycle_
event()` in its close branch, and `presby_guard_organizations_delete()` after
validating `deletable_until` (which also arms the identifier GUC, so the
fixture-teardown cascade reaches both tables). The backfill rows (`authority =
'backfill'`, null `effective_from`, null `effective_to`, no close attribution)
satisfy all three CHECKs, proven by re-applying 0044 against the populated
`development` branch.

**4. `statistical_returns` (F50, `0046`/`0047`).** `INSERT` revoked from both
roles (`0046`). `statistical_returns_provenance_shape` added in `0047`, after
the backfill. The `0047` backfill now supplies `attested_by_name = 'backfill:
reconstructed (drizzle/0047)'`, `attested_role = 'backfill'` and
`attested_at = coalesce(r.published_at, r.created_at, now())`, plus a
convergence UPDATE (inside the same triggers-disabled transaction, with
`statistical_returns_freeze` added to the disable list) for rows the earlier
build already minted on `development`.

**5. `publications` (F51, `0047`).** `publications_withdrawal_shape` replaced
with the symmetric predicate in both places — the idempotent twin is now an
unconditional `drop constraint if exists` + `add`, because the correction keeps
the name and changes the definition, so a presence check would leave the broken
predicate in place forever. `INSERT` revoked from both roles.
`presby_check_publication_supersession()`, `SECURITY DEFINER`, `BEFORE INSERT`,
one uniform cause-blind literal, checking `organization_id`,
`recipient_org_id`, `record_class` and — for `statistical_return` — the two
artifacts' `report_year`. `publications_supersedes_once_idx` (partial unique).
`publications_id_recipient_key` and
`congregation_statistics_publication_recipient_fk`, both after the backfill,
which satisfies them with no fixup.

**6. Withdrawal, Option A (F52, `0047`).** The `withdrawn_at is null` filter
removed from `presby_list_published_returns_to_me()`.
`congregation_statistics.withdrawn_at` added (after the backfill, and named in
the backfill's payload-subtraction list). `presby_reject_published_statistics_
write()` widened by exactly one permitted transition — `withdrawn_at` null →
not-null with `(to_jsonb(old) - 'withdrawn_at') = (to_jsonb(new) -
'withdrawn_at')` — via `create or replace` in `0047`, since `0038` is released.
No withdraw function; the comments say so and say the future
`presby_withdraw_publication()` sets both in one transaction.
`src/lib/presbytery.ts` is **unchanged** — see Implementer Notes.

**7. `sasr_form_versions.field_spec` (F53, `0046`).**
`presby_freeze_used_field_spec()`, `SECURITY DEFINER` (load-bearing: the
referencing table is FORCE RLS, so an invoker-mode check sees zero rows for any
tenant but the caller's — the F26 shape, and the test proves it by attempting
the edit under a *different* tenant's context), `BEFORE UPDATE ... WHEN
(old.field_spec IS DISTINCT FROM new.field_spec)`. **The seed needed no change:**
the WHEN clause makes a byte-identical re-apply a no-op, so `on conflict … do
update` still converges for referenced and unreferenced keys alike. Making the
seed skip `field_spec` for referenced keys was the alternative and was
rejected — it would have silently stopped converging the 2024 spec the day the
first 2024 return was filed, where this way a genuine divergence is a loud
failure.

### Audit Events

None. No application mutation path is added; every new mechanism is a database
constraint, trigger or DEFINER function.

### Implementer Notes

#### Spec item NOT built — loop-back candidate for Phase 3

**`organization_affiliations_recorded_has_from` (F49's fourth CHECK) is not
added.** Its stated premise — "every `'recorded'` row
`presby_transfer_affiliation()` writes already supplies `effective_from`; only
`'backfill'` rows are null (F41)" — is false in this repository, in three
places that were all written deliberately:

- `scripts/seed-dev.sql:105-109` — Quillhaven's pre-1995 row: `authority =
  'recorded'`, a real Southern Fields minute, `effective_from` NULL, reason
  "Predates our records".
- `scripts/test-rls.sql:2972-2977` — asserts, under an explicit F41 comment,
  that `presby_org_affiliated(quillhaven, southern-fields, '1899-01-01')` is
  TRUE. That is only true while that row's lower bound is unbounded.
- `src/lib/db/domain/lifecycle.test.ts:126-146` — the same shape again, as the
  redistricting fixture.

Adding the CHECK forces those rows to `authority = 'backfill'`, which
`drizzle/0044`'s own comment defines as "nobody claims a minute for it" —
relabelling a minuted act as an inference in order to satisfy a constraint
about provenance completeness. F41 ("null means unbounded below, predates our
records") and this CHECK ("a minuted act must state its start") are in genuine
tension; only Phase 3 can decide which yields, and deciding it here would have
meant editing an F41 assertion this pipeline's own QA proved. The other three
CHECKs are unaffected and ship. A `test-rls.sql` assertion now **pins the
absence** (`conname = '…_recorded_has_from'` → 0) with a comment, so it reads
as a decision rather than a missed line, and a companion assertion pins that
the contradicting fixture row really exists.

#### Deviations from the spec, taken deliberately

1. **`statistical_returns_provenance_shape` excludes `attested_by_name` and
   `attested_role`.** F50's literal predicate requires both non-null on a
   submitted row. `presby_publish_sasr_snapshot()` — unchanged by this
   loop-back, and the only live writer of a submitted row — writes both as
   NULL on purpose (Ruling A4: no `app.current_user_id` GUC, and accepting an
   attester name as a parameter is the caller-supplied identity claim its whole
   shape refuses). The CHECK as worded makes publishing impossible; the ruling
   spotted the problem for the backfill and not for the live path. This is
   exactly the deviation Ruling 3 already made for `closed_by` on the same
   grounds, so it is applied consistently: `attested_at` carries the
   attestation half, and the CHECK still closes the three shapes that had no
   owner (submitted-unreconciled, submitted-with-no-attestation-instant,
   imported-reconciled). Writing synthetic placeholders into the live function
   was considered and rejected — the backfill's placeholders are honest because
   the rows ARE reconstructions; a live publish writing "backfill" into
   `attested_by_name` would fabricate an attestation into a permanent,
   immutable record that a UI would then display. **Tightening the two text
   columns is blocked on the acting-user GUC** — a second loop-back candidate,
   the same one `closed_by` already is.
2. **`presby_apply_lifecycle_event()` also arms
   `presby.affiliation_trigger_active`.** Ruling 3 named
   `presby_transfer_affiliation()` as the only writer that needed the flag. It
   is not: `presby_apply_lifecycle_event()` (`0044` section 12) closes the
   subject's open affiliation on `dissolved`/`merged`/`divided`/`dismissed`.
   Without this, every dissolution would have been rejected by the new guard —
   caught by `test-rls.sql:3207` on the first run after the guard shipped, not
   by reading. Armed inside the branch, not at the top of the function, so an
   event that closes nothing leaves the guard armed for nothing.
3. **`presby_guard_organizations_delete()` arms the identifier GUC too**, not
   just the affiliation one. `organization_identifiers.organization_id` is
   `ON DELETE CASCADE`, so the fixture teardown that Ruling 3 protects for
   affiliations would have broken identically for identifiers the moment
   `org-identifiers.test.ts` created a row against a fixture org. Same
   mechanism, same justification, one line.
4. **`presby_transfer_affiliation()`'s close-date guard tightened from `>` to
   `>=`.** With `_range_order` in force, a close falling ON the row's own
   opening produces `daterange(d, d, '[)')` — valid, empty, invisible to the
   EXCLUDE constraint, and now refused by the CHECK. Untightened, the function
   would have reached the UPDATE and returned a raw `check_violation` naming
   the constraint, which distinguishes one rejection cause from the others and
   is precisely what F40's one-literal-per-table rule exists to prevent.
5. **`scripts/seed-dev.sql`'s Quillhaven close moved inline.** The seed closed
   that row with a trailing `UPDATE`, which the new guard refuses on the owner
   connection the seed runs as — and the row as INSERTed (closed, no
   attribution) violates `_closed_shape` anyway. Both fixed by carrying the
   three `closed_*` values in the INSERT and deleting the UPDATE. Arity
   verified against a `create temp table … (like organization_affiliations)`
   copy: 5 rows in.
6. **`drizzle/0046`'s 2024-field-spec self-assertion gained `withdrawn_at`.**
   That DO block treats every `congregation_statistics` column that is not
   identity/provenance/publication bookkeeping as a SASR aggregate, so F52's
   new column made a **re-apply of 0046 after 0047** fail
   (`missing [withdrawn_at]`). Caught by the idempotence pass, not by reading.
   The same list appears in `0047`'s payload subtraction; the two must stay in
   step, and both now say so.
7. **Thirteen `test-rls.sql` probes moved to `publication.test.ts`.** F50/F51
   revoke `INSERT` on `statistical_returns` and `publications` from
   `presby_app`, so section 34(f)/(g)'s field-spec gate, placeholder
   fail-closed, submitted-is-self and imported-about-org probes would all have
   been refused by the permission check before the trigger or CHECK under test
   could fire — passing for the wrong reason at best, failing at worst. They
   moved verbatim to the owner connection, which is the split this section's
   own header already recorded for UPDATE and DELETE. What stays in
   `test-rls.sql` is the half only a tenant connection can show: that
   `presby_app` genuinely cannot write either table, plus a positive control
   that `presby_publish_sasr_snapshot()` still can.

#### Findings not in the spec

- **`src/lib/presbytery.ts` is deliberately unchanged, and the spec's premise
  there is slightly off.** F52 item 4 says the rollup/per-capita
  `withdrawn_at is null` obligation lands on "whichever pipeline builds those
  consumers (none exist yet)". One does exist —
  `getCongregationStatisticsRollup()` in `src/lib/presbytery.ts`. It is a no-op
  today (nothing can set `congregation_statistics.withdrawn_at`: there is no
  withdraw function, and the only permitted transition is the one the future
  `presby_withdraw_publication()` will perform), so not filtering changes no
  behaviour now — but the filter obligation attaches to that function, not only
  to a future one. Left unchanged per the instruction not to widen scope beyond
  the spec, and named here so the TODO line the tech-lead recorded can be
  pointed at the real consumer.
- **`publications_withdrawal_shape`'s idempotent twin had to become an
  unconditional drop/add.** The `if not exists (… conname …)` guard the file
  used would have left the broken predicate in place on every database that had
  already run the earlier form — which is every database this migration has
  touched. Worth noting as a general hazard of correcting a constraint in place
  under an unchanged name.
- **The `attested_at`-from-nullable-`published_at` hole was already
  unreachable.** While building the fresh-apply simulation I planted a
  published projection row with `published_at = NULL` and the migration's own
  F39 completeness assertion rejected it first, before the new CHECK could.
  The `coalesce` is still correct defensive coding; it is not load-bearing.
- **Dropping `congregation_statistics.withdrawn_at` breaks `test-rls.sql`
  earlier than its own F52 assertion**, at the widened freeze trigger
  (`record "old" has no field "withdrawn_at"`). The column and the widened
  trigger ship together, so the failing-first proof for that pair is the
  earlier error rather than the assertion's own message. Recorded so the
  difference is not read as a gap.
- **`src/lib/rate-limit.test.ts` fails 3 of 15 when vitest is run with
  `dotenv -e .env.local`, and does so on a clean tree** (verified with
  `git stash`). Pre-existing, unrelated to this loop-back, invisible to
  `npm test` (which does not load `.env.local`). Not fixed here; named so QA
  does not attribute it to this work.

### Verification

| Check | Result |
|---|---|
| Apply `0043 → 0047` in order on `development` (`psql -v ON_ERROR_STOP=1 -f`) | all five exit 0 |
| Re-apply all five whole, twice | all five exit 0 both passes, zero errors |
| Fresh-apply order proof (0046 before 0047) | simulated in a rolled-back transaction: pre-0047 shape restored, a second published projection minted, `0047`'s backfill block run verbatim, then all four post-backfill constraints added — backfill "2 projection row(s) stamped", completeness assertion passed, all three reconstructed returns satisfy `statistical_returns_provenance_shape`, both composite FKs hold. A scratch Neon branch was not reachable (`neonctl` requires interactive browser auth; no Neon MCP tool available in this agent's grant), so this is the strongest feasible substitute |
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` as `presby_app` | **exit 0, 384 assertions pass** (363 → 384: +32 new, −11 moved to `publication.test.ts`) |
| Failing-first, `test-rls.sql` | 15 mechanisms dropped, then restored one at a time; **15 distinct first-failures recorded**, one per mechanism (affiliation guard, identifier grant, identifier guard, succession UNIQUE, the three affiliation CHECKs, the two INSERT revokes, the provenance CHECK, the recipient key, the recipient FK, the supersedes index, the supersession trigger, the field-spec freeze) |
| Failing-first, F52 read filter | the `withdrawn_at is null` filter re-added → `F52 Option A: the recipient read-back no longer filters on withdrawn_at` fails |
| Failing-first, vitest | same 15 mechanisms dropped → **18 tests failed / 51 passed** across the three DB-backed files, each failing on the mechanism it names |
| `vitest run --no-file-parallelism` on `lifecycle.test.ts`, `publication.test.ts`, `org-identifiers.test.ts`, `presbytery.test.ts`, `org-provisioning.test.ts` | **119 passed** (was 47 + 25 + 47 before; +30 new tests) |
| `npm run typecheck` | clean |
| `npm run check` | all five tripwires pass |
| `npm test` (CI shape, no `.env.local`) | **3206 passed / 732 skipped**, 0 failed |
| `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (whole suite) | 3935 passed / 3 failed — the 3 are `src/lib/rate-limit.test.ts`, pre-existing on a clean tree (see Findings) |
| `npm run build` | succeeds |
| `scripts/seed-dev.sql` affiliation INSERT arity | validated against a `like organization_affiliations` temp table: `INSERT 0 5` |

### Handoff

**Next agent: qa (Phase 5 re-verification).** Nothing is owed to
`api-developer` or `ux-developer` by this pass — it adds no application
surface.

**New database objects available to a future implementer:**

- `presby_set_organization_identifier(uuid, text, text, boolean, text)
  returns uuid` — the only tenant-side writer for `organization_identifiers`.
  Takes no council id; the actor is `presby_current_org()`. Upserts on
  `(organization_id, kind, value_normalized)`; the only path that may set
  `is_verified`. Granted to `presby_app`.
- `congregation_statistics.withdrawn_at timestamptz` — Option A's
  projection-side mark. Settable through exactly one transition on the existing
  freeze trigger. **Every consumer computing CURRENT totals must filter
  `withdrawn_at is null`**, including `getCongregationStatisticsRollup()` in
  `src/lib/presbytery.ts`, which does not today.
- `presby_list_published_returns_to_me()` now returns withdrawn publications
  too, with `withdrawn_at`/`withdrawn_by`/`withdrawn_minute_reference`. Its
  signature is unchanged; only the WHERE clause moved. A caller that wants
  "current" filters itself.
- `publications` gains `UNIQUE (id, recipient_org_id)`;
  `congregation_statistics` gains a second composite FK to it. A projection row
  now has to agree with its publication on BOTH ends.
- `statistical_returns` and `publications` are `SELECT`-only for both
  application roles. Any future writer is a `SECURITY DEFINER` function, not a
  grant.
- Two transaction-local GUCs are now load-bearing:
  `presby.affiliation_trigger_active` (armed by
  `presby_transfer_affiliation()`, `presby_apply_lifecycle_event()`'s close
  branch, and `presby_guard_organizations_delete()`) and
  `presby.identifier_trigger_active` (armed by
  `presby_set_organization_identifier()` and
  `presby_guard_organizations_delete()`). **Any new function that legitimately
  UPDATEs or DELETEs `organization_affiliations` or `organization_identifiers`
  must arm the matching flag with `set_config(..., true)`, or its own write
  will be refused.**

**Local apply:**

```bash
# development branch (drizzle's ledger is not authoritative there — the five
# files are corrections in place, so re-run them rather than db:migrate):
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0043_presby_org_identifiers.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0044_presby_org_lifecycle.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0045_presby_about_org_affiliation.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0046_presby_statistical_returns.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0047_presby_publications.sql

# staging/production, where the ledger IS intact and none of 0043-0047 has run:
npm run db:migrate
```

`npm run db:seed` is unchanged — no new permission key, no new role, no new
flag. `scripts/seed-dev.sql` DID change (the Quillhaven close moved inline), so
a database seeded before 2026-09-24 keeps working as-is; only a **fresh** seed
needs the new file.

---

## Loop-back after external review, round 2 (2026-09-25, database-admin) — COMPLETE

Built in one pass on 2026-09-25, resuming from the two stopped sessions whose
notes this block replaces (their call-site inventory is kept verbatim at the
end, because the sweep it describes is the bulk of the diff and a reader
checking the sweep for completeness needs the list). Everything in Phase 3's
"Amendment after external review, round 2" (F54–F58 / DECISION-141) is
implemented, plus the two orchestrator additions from the 2026-09-25 security
review (§B, **B-M1** and **B-M2**). Migration correction IN PLACE — same five
files, same numbers, `drizzle/meta/_journal.json` untouched.

### Files Modified

- `drizzle/0043_presby_org_identifiers.sql` — the identifiers guard widened to
  `BEFORE INSERT OR UPDATE OR DELETE` (F58); its comment block rewritten (the
  old one argued at length for the narrower scope); `presby_deny_identifier_
  change()`'s `presby_app` grant revoked (B-M1); `set search_path = public` on
  its one SECURITY DEFINER function (B-M2).
- `drizzle/0044_presby_org_lifecycle.sql` — section 12a (new): the lifecycle
  creation guard; section 13a2 (new): its successions half; section 13b
  rewritten: the cardinality body extracted into
  `presby_lifecycle_event_cardinality_check()`; section 13b2 (new): the
  event-side deferred cardinality trigger (F54). Plus B-M1 (now FIVE revokes
  and no keep on this file, and `presby_apply_affiliation_to_org_tree()`'s
  arming moved after its validation), B-M2 (13 DEFINER functions), and the
  follow-on grant item below: **section 2's `grant select, insert on
  organization_lifecycle_events to presby_app` narrowed to `select`**.
- `drizzle/0045_presby_about_org_affiliation.sql` — B-M1/B-M2 only (two
  revokes, one DEFINER function). This file carries no F54–F58 change.
- `drizzle/0046_presby_statistical_returns.sql` — section 4b (new):
  `presby_deny_publication_write()`, `presby_guard_publication_write()` and
  `statistical_returns_guard` (F55). Plus B-M1 (one revoke, one deliberate
  keep) and B-M2 (two DEFINER functions).
- `drizzle/0047_presby_publications.sql` — section 2a (new) `publications_
  guard`; section 3b (new) `congregation_statistics_publication_guard`, WHEN-
  scoped; the backfill `DO` block arms the chain GUC; `presby_publish_sasr_
  snapshot()` arms it before its three inserts (F55); the withdrawal conjunct
  added to `presby_freeze_publication()` and `presby_reject_published_
  statistics_write()` (F56). Plus B-M2 (four DEFINER functions).
- `scripts/seed-dev.sql` — one `set_config` line before the publication-chain
  fixtures (`:1374`/`:1386`/`:1399`), inside the file's single transaction.
- `scripts/test-rls.sql` — new section 35 (F54–F58 and B-M1/B-M2); section
  32(j)'s successions trigger count 3 → 4; section 32(n)'s identifier `tgtype`
  assertion gains `& 4`; section 32(c)'s lifecycle grant assertion narrowed
  from `select + insert` to `SELECT`; **section 32(k) rewritten** — its
  authority/CHECK/dissolution probes moved to the owner connection (they
  inserted as `presby_app`, which the grant now refuses) and replaced by the
  grant-shape assertions plus a behavioural "presby_app cannot INSERT at all";
  section 35(a)/(b)'s lifecycle probes likewise replaced by a pointer to the
  owner-connection file, since they too inserted as `presby_app`.
- `src/lib/db/domain/lifecycle.test.ts` — `armLifecycleWrite()` /
  `disarmLifecycleWrite()`, a sixth fixture organization (`congF`), 10 existing
  probes swept, one new `describe` of 7 probes for F54, and a second new
  `describe` of 5 carrying what moved off `test-rls.sql` 32(k) — self-target,
  presbytery-on-presbytery, the external-body CHECK (with its accepting
  counterpart), the whole dissolution path, and the new grant shape
  (**38 tests, was 23**).
- `src/lib/db/domain/publication.test.ts` — `armPublicationWrite()` /
  `armWithdrawalWrite()`, 16 existing probes swept, three withdrawal sites
  armed, the `:980` shape probe split in two, one new `describe` of 6 probes
  (43 tests, was 33).
- `src/lib/db/domain/org-identifiers.test.ts` — the F58 assertion inverted, the
  collision case split out, a catalog probe added; `seedAlderIdentifier()` arms
  and then DISARMS (11 tests, was 9).
- `src/lib/presbytery.test.ts` — **adopted from the stopped 2026-09-25
  session, not re-derived**: `armedPublicationWrite()` wraps the two
  `published_by_congregation` fixtures and `makePublication()` in one
  transaction. Verified green here (34 tests).
- `src/lib/db/domain/lifecycle.ts`, `publication.ts`, `returns.ts`,
  `presbytery.ts`, `org.ts` — mirror comments for every mechanism Drizzle's
  table builder cannot express, each naming the migration section that
  enforces it.

### Schema Changes

**Item 1 — the lifecycle aggregate (F54, `drizzle/0044`).**
New GUC `presby.lifecycle_write_active`; `presby_guard_lifecycle_write()`
(INVOKER — it reads a GUC and no table) executed by two new BEFORE INSERT
triggers, `organization_lifecycle_events_guard` and
`organization_successions_guard`, both raising the EXISTING
`presby_deny_lifecycle_change()` literal. Cardinality: the counting/raising
body moved verbatim into `presby_lifecycle_event_cardinality_check(uuid)`;
`presby_check_succession_cardinality()` is now a thin wrapper; new
`presby_check_lifecycle_event_cardinality()` runs it from a new `AFTER INSERT
… DEFERRABLE INITIALLY DEFERRED` constraint trigger
`organization_lifecycle_events_cardinality`. `presby_check_succession_event()`'s
null-actor branch untouched, per the ruling. Nothing arms the GUC — both
tables' INSERT is closed until `presby_record_lifecycle_event()` ships.

**Item 2 — return → publication → projection (F55, `0046`/`0047`).**
New GUC `presby.publication_write_active`; `presby_deny_publication_write()`
and `presby_guard_publication_write()` defined once in `0046` section 4b and
shared by three BEFORE INSERT triggers: `statistical_returns_guard`,
`publications_guard`, and `congregation_statistics_publication_guard` **`WHEN
(new.provenance = 'published_by_congregation')`**. Armed in three places:
`presby_publish_sasr_snapshot()` (after every validation, before its first
insert), `0047`'s backfill `DO` block (after its re-run guard, before PASS 1),
and `scripts/seed-dev.sql`.

**Item 3 — the withdrawal pair (F56, `0047`).**
New GUC `presby.withdrawal_write_active`, armed by nothing. Added as a required
conjunct to the one permitted transition in both `presby_freeze_publication()`
and `presby_reject_published_statistics_write()`.

**Item 4 — identifiers INSERT (F58, `0043`).**
`organization_identifiers_guard` widened to `BEFORE INSERT OR UPDATE OR
DELETE`; guard function body unchanged. Arming confirmed by reading, not
assumed: `presby_set_organization_identifier()` arms at entry before both
branches; `0043`'s own `pcusa_pin` backfill runs before the trigger is created
and is column-guarded on re-apply; `presby_guard_organizations_delete()`
(`0044`) already arms the GUC for the fixture delete-cascade path;
`createOrganization()` and `scripts/seed-dev.sql` write no identifier row.

**Orchestrator addition B-M1 — trigger-only/internal execute grants.**
`presby_apply_affiliation_to_org_tree()` now arms
`presby.affiliation_trigger_active` immediately before its first UPDATE rather
than as its opening statement, so a rejected call no longer leaves an armed
marker behind for the rest of the caller's transaction. `execute` revoked from
`presby_app` (and `public`) on seven helpers: `presby_deny_identifier_change`,
`presby_deny_affiliation_change`, `presby_assert_council_authority`,
`presby_apply_affiliation_to_org_tree`, `presby_deny_about_org_write`,
`presby_check_about_org_affiliated`, `presby_check_return_about_org` (the last
two also from `presby_platform`). **Three deliberate keeps**, each checked
individually rather than by category: `presby_deny_lifecycle_change` and
`presby_deny_publication_write` are raised from SECURITY INVOKER guard
functions on paths `presby_app` can actually fire (its INSERT grant on
`organization_lifecycle_events`; the `published_by_congregation` branch of
`congregation_statistics`), so revoking would replace each table's uniform
rejection literal with `permission denied for function …`; and
`presby_lifecycle_event_cardinality_check`, which the deferred check runs as
`presby_app`. The seven application-callable functions are untouched.

**Orchestrator addition B-M2 — `set search_path = public`** on all 21 SECURITY
DEFINER functions in `0043`–`0047`, in the precedent form (`drizzle/0013:56`).
The three new guards are deliberately INVOKER and are excluded. `presby_app`
holds no CREATE on `public`, so this is standard hardening, not a live fix, and
the test asserts it because the pin is invisible in the function body.

### Verification

**Migration apply and idempotence** (`development` branch, owner, direct
endpoint). `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f` over
`0043 → 0044 → 0045 → 0046 → 0047`, then the **whole five files again**, all
ten applies `exit=0`. Row counts for the nine tables these files touch captured
before, between and after: **identical across all three snapshots**
(`organizations 30, organization_affiliations 10, organization_identifiers 0,
organization_lifecycle_events 0, organization_successions 0,
statistical_returns 1, publications 1, congregation_statistics 2,
sasr_form_versions 4`). Not a partial re-apply of the changed statements — the
whole file, twice.

**The follow-on grant item was re-proven on its own**, after the fact:
`drizzle/0044` applied whole, twice more (`exit=0` both times), with the four
tables it touches counted before, between and after — **identical**
(`organizations 15, organization_affiliations 10,
organization_lifecycle_events 0, organization_successions 0`; `organizations`
is 15 rather than the 30 above because the 15 orphaned fixture rows in Finding
4 were removed between the two measurements). Live grant shape re-read from
`pg_class.relacl` afterwards: `presby_app` SELECT on both lifecycle tables,
`presby_platform` SELECT+INSERT on both.

**`scripts/test-rls.sql` as `presby_app`** (`psql "$APP_DATABASE_URL" -f`):
**402 passes, exit 0**, against the session's measured baseline of **384**.
It peaked at 410 before the follow-on grant item: narrowing
`organization_lifecycle_events` to SELECT moved eight behavioural probes out of
this suite (32(k)'s four and 35(a)/(b)'s four — every one of them inserted as
`presby_app`, which the grant now refuses) and replaced them with five sharper
grant-shape assertions here plus five owner-connection tests in
`lifecycle.test.ts`. Net −8 here, +5 there, and each assertion now proves the
layer it names.

**DB-backed vitest, `--no-file-parallelism`**: 5 files, **142 passed, 0
failed** — `lifecycle.test.ts` 38, `publication.test.ts` 43,
`org-identifiers.test.ts` 11, `presbytery.test.ts` 34,
`org-provisioning.test.ts` 16.

**`npm run typecheck`** clean · **`npm run check`** all five tripwires pass ·
**`npm test`** 3222 passed / 755 skipped (246 files passed, 29 skipped) ·
**`npm run build`** exit 0, compiled successfully.

**The seed, proven in a rolled-back transaction rather than re-run.**
`docs/testing.md` applies `scripts/seed-dev.sql` with
`psql "$MIGRATE_DATABASE_URL" -f`, and the file is NOT re-runnable on an
already-seeded branch (fixed ids, plain inserts, one transaction) — batch B's
handoff says the same. So the changed block was extracted verbatim, its three
fixed ids remapped to `…0009` to avoid a PK collision, and run twice inside
`begin … rollback`: **armed → `INSERT 0 1` ×3, rolled back; unarmed → refused
with `publication chain: this row may only be written by a sanctioned
publication function`**. That is both the proof the added line works and the
proof it was necessary.

### Failing-first proofs (every new mechanism, each restored afterwards)

| Mechanism | How it was disabled | The failure, cited |
|---|---|---|
| `organization_lifecycle_events_guard` + `organization_successions_guard` (F54) | `drop trigger` both | `lifecycle.test.ts` 6 failed / 27 passed; `test-rls.sql` §35(a) `ERROR: FAIL — a lifecycle event was recorded outside any sanctioned lifecycle write`; §32(j) `expected 4, got 3` |
| `organization_lifecycle_events_cardinality` (F54) | `drop trigger` (guards restored first) | §35(b) `ERROR: FAIL — a merged lifecycle event committed with zero succession rows` |
| the three chain guards (F55) | `drop trigger` all three | `publication.test.ts` 4 failed / 39 passed |
| `congregation_statistics_publication_guard` (F55) | `drop trigger` alone | §35(c) `ERROR: FAIL — a published_by_congregation projection was fabricated outside presby_publish_sasr_snapshot()` |
| the withdrawal conjuncts (F56) | both functions replaced with their pre-conjunct bodies | `publication.test.ts` 2 failed / 41 passed; §35(d) `ERROR: FAIL — half of a withdrawal pair was recorded with no sanctioned withdrawal writer` |
| `organization_identifiers_guard`'s INSERT arm (F58) | trigger re-created as `before update or delete` | `org-identifiers.test.ts` 2 failed / 9 passed; `test-rls.sql:3367` `expected 1, got 0` |
| the lifecycle INSERT revoke (follow-on) | `grant insert on organization_lifecycle_events to presby_app` | `test-rls.sql:2791` `FAIL organization_lifecycle_events: and no INSERT, UPDATE or DELETE … expected 0, got 1` |
| B-M1 | `grant execute … to presby_app` on one revoked helper | §35(e) `expected 0, got 1` |
| B-M2 | `alter function presby_org_affiliated … reset search_path` | §35(e) `expected 21, got 20` |

### Named tests for the reviewer's three repros

- **"third predecessor after a valid merge"** — `lifecycle.test.ts` › "refuses
  a THIRD predecessor added to an already-valid merge — the reviewer's exact
  repro, which cardinality cannot see", with its positive control "and it is
  the GUARD refusing that third predecessor, not cardinality".
- **zero-succession merge rejected at commit** — `lifecycle.test.ts` › "rejects
  a merged event committed with ZERO succession rows, at commit" and "rejects a
  divided event with zero succession rows too, and leaves the no-edge event
  types alone"; `test-rls.sql` §35(b).
- **"false submitted artifact", raw owner INSERT at each of the three tables** —
  `publication.test.ts` › "refuses a fabricated statistical_returns row…",
  "refuses a fabricated publications row…", "refuses a fabricated
  published_by_congregation projection…", with the live-path regression
  "leaves the LIVE tenant path alone: a presbytery_entered projection inserts
  with no marker at all (the WHEN clause)".

### Implementer Notes

**Two of the items above are ORCHESTRATOR ADDITIONS made mid-task, not part of
Phase 3's round-2 amendment**: **B-M1** (trigger-only/internal execute grants,
plus `presby_apply_affiliation_to_org_tree()`'s arming order) and **B-M2**
(`set search_path = public` on the DEFINER set), both from
`docs/reviews/2026-09-25-security.md` §B and both scoped to
`drizzle/0043`–`0047`, i.e. this pipeline's files. They are recorded here so a
reader comparing the diff against DECISION-141 does not read them as
unrequested scope. Everything else in this block traces to F54–F58.

**Spec defect 1 — Ruling 3's rejection literal was under-specified; the choice
made, and why.** `presby_freeze_publication()` raises three DISTINCT messages,
each interpolated with `old.id`, so there is no single "publications" literal
to reuse and a helper could not interpolate the id without becoming a
parameterised helper with one caller. **Decision: a new, specific in-function
literal** (`publications %: a withdrawal is an authorized act and may only be
recorded by the sanctioned withdrawal function…`, errcode
`insufficient_privilege`), keeping this function's existing one-message-per-
refused-reason discipline. F40's uniform-literal rule does not apply: it exists
to stop a cross-tenant existence oracle on a table with an EXCLUDE constraint,
and every branch here is reachable only by a caller who already names the row.
The `congregation_statistics` half reuses its single existing literal, exactly
as the ruling directs — so there is one literal per table per reason, and the
two halves of the pair deliberately differ.

**Spec defect 2 — Phase 3's facts block is wrong about the seed.** "`scripts/
seed-dev.sql` inserts no row into either table" is true of the two lifecycle
tables and FALSE of the publication chain: the seed writes
`statistical_returns`, `publications` and a `published_by_congregation`
`congregation_statistics` row. Without the added arming line a fresh
`seed-dev.sql` fails outright — measured, not reasoned (see the negative
control above). The stopped session had already caught this; it is restated
here because the ruling's zero-regression argument rests on that sentence.

**Spec defect 3 — `publication.test.ts:980` would have false-passed.** Its
assertion regex (`/a withdrawal must set withdrawn_at|publications_withdrawal_
shape|withdrawn_by/`) is loose enough to match the NEW unarmed-writer
rejection, so after F56 it would have kept passing while proving a different
mechanism. Split in two: the shape half now ARMS the withdrawal marker and
matches `publications_withdrawal_shape` alone; a new probe proves the guard
with a perfectly well-shaped triple.

**Deviation 1 — one grant added that the spec did not mention, and it is
required.** `presby_lifecycle_event_cardinality_check(uuid)` needs `execute` to
`presby_app`: both callers are SECURITY INVOKER trigger functions, so the
shared body runs as whoever fired the trigger, and `presby_app` DOES hold
INSERT on `organization_lifecycle_events`. Caught by a failing run (`ERROR:
permission denied for function presby_lifecycle_event_cardinality_check` at
`test-rls.sql` §35(b)), not by reasoning. It is the named exception inside
B-M1.

**Deviation 2 — `test-rls.sql`'s armed positive control for
`congregation_statistics` reads the publication id from the projection instead
of hard-coding the seed's.** A hard-coded `a9000000-…-0001` failed on
`congregation_statistics_publication_fk`: this branch was seeded BEFORE
`drizzle/0047`, so its publication is the one the backfill minted, with a
random id. Corrected to `select publication_id from congregation_statistics
where id = :STAT_ALDER_PUBLISHED`, which is id-agnostic across both database
shapes — the same convention `publication.test.ts`'s header already states. An
intermediate comment claiming the FK could not resolve under RLS was WRONG and
has been removed: referential-integrity checks bypass row security by design,
and the failure was a nonexistent id.

**Deviation 3 — §35(c)'s rejection probe catches `foreign_key_violation`
explicitly and FAILS on it.** Without that arm, dropping the guard produced an
FK error rather than a named failure, and the failing-first output did not say
which mechanism had gone. It now reads `FAIL — congregation_statistics_
publication_guard did not fire; the composite FK refused the row instead`.

**Deviation 4 — the "third predecessor" repro runs in ONE transaction with a
disarm in the middle**, not across two transactions. A committed lifecycle
event is permanent (that is the property under test) and would block the
fixture organizations' teardown, so "a later, separate, unsanctioned write" is
expressed as arm → write the lawful act → `set constraints all immediate` →
DISARM → attempt the extra edge. A sixth fixture organization (`congF`) was
added because `organization_successions_not_self` and
`organization_successions_edge_unique` between them rule out reusing any of the
existing five for a third predecessor — and a probe that also trips the unique
index would not prove the guard.

**Deviation 5 — `seedAlderIdentifier()` disarms after inserting.** The GUC is
transaction-local, so arming it for the fixture insert also pre-authorised the
UPDATE and DELETE the two probes below it exist to see refused; both failed on
the first run of the sweep. Same hazard anywhere a fixture and its probe share
a transaction.

**Finding 1 — a GUC is a marker, not a privilege, and `presby_app` can set
one. RAISED HERE, THEN ACCEPTED BY THE ORCHESTRATOR AND BUILT IN THIS SAME
BLOCK** (see the follow-on grant item under Schema Changes; tech-lead
ratification follows).** Every guard in this family reads a
transaction-local GUC that any role may `set_config`. On the two tables where
`presby_app` holds DML — `organization_lifecycle_events` (INSERT) and
`congregation_statistics` (INSERT/UPDATE) — a tenant connection could arm the
marker itself and write. That is NOT the hole these guards close: the reviewer's
threat model, and F44's, is the `getPlatformDb()`/`neondb_owner` path, where no
grant binds and the trigger is the only mechanism. On the tenant path the real
gate remains the grant, the RLS policy and the authority trigger. The residual named was: **`presby_app` held an INSERT grant on
`organization_lifecycle_events` that no application code used**, and revoking
it would close the tenant half at no cost (and let B-M1 revoke
`presby_deny_lifecycle_change`'s grant too). **That revoke is now made** —
accepted as consistent with Phase 2 Ruling 1 — so the marker is unreachable
from a tenant connection on both lifecycle tables. It is NOT closed on
`congregation_statistics`, and cannot be: the live tenant path writes that
table, so a tenant could still arm `presby.publication_write_active` and insert
a `published_by_congregation` row. The FK to `publications` is what bounds that
today (a fabricated projection needs a real publication, which the same
connection cannot mint), and it is the one place in this family where "a GUC is
a marker, not a privilege" still has teeth. Named for Phase 3; not fixed here,
because closing it means revoking a grant the shipped
`setCongregationStatisticsAction` path depends on.

**Finding 2 — trigger firing order is alphabetical, and it decides what a test
proves.** On `organization_lifecycle_events`, `…_authority` < `…_cardinality` <
`…_guard`; on `organization_successions`, `…_event_scope` < `…_guard`; on
`congregation_statistics`, `…_about_org` < `…_freeze` < `…_publication_guard`;
on `statistical_returns`, `…_about_org` < `…_field_spec` < `…_guard`. A BEFORE
trigger also runs ahead of the table's CHECK constraints. That is why the
fixture sweep is not cosmetic: unarmed, §32(k)'s third probe would have been
refused by the guard instead of by
`organization_lifecycle_events_external_body_shape`, and the first two would
have passed for the wrong reason (both layers raise `insufficient_privilege`).

**Finding 3 — an EXECUTE grant on a trigger function is checked at CREATE
TRIGGER time, not at fire time.** B-M1's revokes on
`presby_check_about_org_affiliated()` and `presby_check_return_about_org()`
therefore do not touch the live tenant write path, which is proven rather than
argued: `test-rls.sql` sections 29 and 33 insert `congregation_statistics` as
`presby_app` eight times and are unchanged and green.

**Finding 4 — the shared `development` branch had 15 orphaned fixture
organizations, and they are now gone.** A parallel run (`groups-test-*`,
`officers-test-*`, `tickets-test-*`, `credentials-test-*`, `people-test-*`,
`person-sensitive-test-*`, `role-definitions-test-*`, `staff-actions-test-*`,
`tenant-branding-test-*`) died between files at 14:03–14:05 UTC, leaving its
organizations behind; `presby_roll_cache_drift()` then returned 25 and
`test-rls.sql:418` failed for a reason unrelated to this pipeline. They were
deleted (the documented `group_memberships_reject_derived` disable/enable
teardown convention) once the branch had been idle for five minutes.
**This mattered more than a stale fixture usually does: `deletable_until` was
about two hours out, and after that the deletion guard refuses — orphans from a
crashed run become permanently undeletable rows on a shared branch.** An
earlier `presbytery.test.ts` teardown failure in this session
(`group_memberships: … is a derived-group membership row`) was the same
collision seen from the other side; it did not reproduce in two subsequent
runs, alone or combined.

**Finding 4a, stated as one line for the backlog: a fixture organization
orphaned by a crashed test run becomes PERMANENTLY UNDELETABLE once its
`deletable_until` passes** — `presby_guard_organizations_delete()` refuses the
delete on every connection, including the owner's, so the only remaining
removal path is disabling a global trigger by hand. A shared branch therefore
accumulates undeletable synthetic organizations at the rate its suites crash.
Worth either a sweeper (delete `deletable_until`-stamped rows still inside
their window, run at suite start) or a widened guard predicate; not this
pipeline's to decide.

**Finding 5 — two pipelines must not share one Neon branch.** Inherited from
the stopped session and confirmed here: every one of these migrations does
`drop trigger if exists …; create trigger …`, so a whole-file re-apply opens a
sub-second window in which another agent's suite sees no trigger. Combined with
Finding 4, the conclusion is a branch-per-pipeline one, not a schema one.

**Adopted from the stopped 2026-09-25 session** (per the orchestrator): its
`src/lib/presbytery.test.ts` change, and its two corrections — the cardinality
helper KEEPS its grant, and the three GUC-only guards are deliberately INVOKER
and need no `search_path`. Its `publication.test.ts` edits were reverted by its
own author; this session's version is the one in the tree and typechecks
clean.

### Handoff

**New/changed database surface available to the next implementer:**

- Three transaction-local GUCs, all `set_config(…, true)`:
  `presby.lifecycle_write_active`, `presby.publication_write_active`,
  `presby.withdrawal_write_active`. Any new writer of
  `organization_lifecycle_events`, `organization_successions`,
  `statistical_returns`, `publications` or a `published_by_congregation`
  `congregation_statistics` row MUST arm the relevant one, inside the same
  transaction, or the write is refused on every connection.
- `presby_record_lifecycle_event()` (lifecycle-UI pipeline) arms
  `presby.lifecycle_write_active` at entry and writes the event and its
  succession rows in ONE transaction; the deferred cardinality check now fires
  from both ends, so a `merged`/`divided` event with no edges is refused at
  commit.
- `presby_withdraw_publication()` (publish-UI pipeline) arms
  `presby.withdrawal_write_active` once and performs BOTH `UPDATE`s —
  `publications`' withdrawal triple and `congregation_statistics.withdrawn_at`
  — in one transaction. Neither half is reachable alone.
- D13's import function arms `presby.publication_write_active`, not a new GUC.
- **`presby_app` now holds SELECT and nothing else on BOTH lifecycle tables.**
  Any future tenant-facing lifecycle write goes through a SECURITY DEFINER
  function (which runs as the owner and needs no tenant grant) — do not
  re-grant INSERT to give a pipeline a shortcut. If a ruling ever does,
  `presby_deny_lifecycle_change()` and `presby_lifecycle_event_cardinality_
  check(uuid)` must regain their `presby_app` EXECUTE grants in the same
  migration; both revoke sites in `drizzle/0044` say so inline.
- No new table, no new column, no new FK. No application-code change is
  required by this loop-back: nothing in `src/` writes any of these tables
  today.

**Local apply:**

```bash
# development (drizzle's ledger is not authoritative there — these five files
# are corrections in place, so re-run them rather than db:migrate):
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0043_presby_org_identifiers.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0044_presby_org_lifecycle.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0045_presby_about_org_affiliation.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0046_presby_statistical_returns.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0047_presby_publications.sql

# staging/production, where the ledger IS intact and none of 0043-0047 has run:
npm run db:migrate

# scripts/seed-dev.sql CHANGED (one set_config line). It is not re-runnable on
# an already-seeded database; apply it only to a fresh one:
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql
# npm run db:seed is unchanged — no new permission key, role or flag.

psql "$APP_DATABASE_URL" -f scripts/test-rls.sql   # expect 402 passes, exit 0
```

**`scripts/test-rls.sql` sections added or touched:** new **35** (a–e: the
F55 chain guard behaviourally plus its WHEN-scope regression, F56 withdrawal,
and the catalog for every mechanism including B-M1/B-M2; (a)/(b) are now a
pointer to the owner-connection proofs); amended **32(c)** (lifecycle grant
select+insert → SELECT), **32(j)** (successions trigger count 3 → 4),
**32(k)** (rewritten: grant-shape assertions and the "cannot INSERT at all"
probe, with its trigger/CHECK/dissolution behaviour moved to
`src/lib/db/domain/lifecycle.test.ts`), **32(n)** (identifier `tgtype` gains
INSERT).

**Next agent: qa** (Phase 5 re-verification). Everything is applied to the
`development` branch as described; nothing is committed.

### Call-site inventory (kept from the stopped sessions — this is the sweep's work list, and the record of which sites deliberately stay UNARMED)

**Lifecycle direct-INSERT call sites (must arm `presby.lifecycle_write_active`):**

- `scripts/test-rls.sql` — 5 sites: `:3096` (successions, expects
  `insufficient_privilege` from the *grant*, so it must stay unarmed and needs
  no change), `:3157`, `:3174`, `:3186` (the section 32(k) authority/CHECK
  probes — `:3186` expects `check_violation` from
  `organization_lifecycle_events_external_body_shape`, which a `BEFORE INSERT`
  guard would pre-empt, so this one **must** be armed), `:3202` (the
  dissolution path, must be armed).
- `src/lib/db/domain/lifecycle.test.ts` — 10 `organizationLifecycleEvents`
  inserts (lines 258, 283, 380, 414, 461, 500, 537, 570, 635) plus 9
  `organizationSuccessions` inserts (lines 399, 429, 445, 476, 481, 517, 549,
  582, 647, 658), across the `presby_freeze_lifecycle_event`,
  `organization_successions write path` and
  `organization_successions_edge_unique` describes. Cleanest shape: arm once at
  the top of each `inRollback()` body that writes either table.

**Publication-chain direct-INSERT call sites (must arm
`presby.publication_write_active`):**

- `src/lib/db/domain/publication.test.ts` — `statistical_returns`: lines 727,
  749, 765, 781, 797, 813, 827, 837 (field-spec block), 860, 878, 891
  (imported/about-org block), 913, 929, 945 (provenance-shape block);
  `publications`: lines 1001, 1058, 1082, 1094, 1107, 1158, 1189;
  `congregation_statistics` with `provenance = 'published_by_congregation'`:
  line 1199. One `armPublicationWrite(tx)` helper called at the top of each
  `inOwnerRollback()` body is the least invasive shape.
- **`scripts/seed-dev.sql` — a spec defect worth flagging.** Phase 3's facts
  block says the seed "inserts no row into either table", which is true of the
  two *lifecycle* tables but **false of the publication chain**: the seed
  writes `statistical_returns` (`:1374`), `publications` (`:1386`) and a
  `published_by_congregation` `congregation_statistics` row (`:1399`) as
  explicit fixed-id inserts. All three land inside the file's single
  `begin;`(`:25`)/`commit;`(`:1516`) transaction, so one
  `select set_config('presby.publication_write_active', 'true', true);` before
  `:1374` covers them; without it a fresh `seed-dev.sql` fails outright.
- `scripts/test-rls.sql` `:4154`/`:4165` insert into `statistical_returns` /
  `publications` as `presby_app` expecting `insufficient_privilege` from the
  revoked grant — the grant fires before the trigger, so these stay unarmed and
  unchanged.
- Every `congregation_statistics` insert in `scripts/test-rls.sql` (`:2197`,
  `:2398`, `:3630`, `:3673`, `:3685`, `:3738`, `:3748`, `:3758`) uses
  `presbytery_entered` or `imported`, and `setCongregationStatistics()`
  (`src/lib/presbytery.ts:663`, `targetWhere` pinned to those two provenances)
  writes nothing else — so the `WHEN (new.provenance =
  'published_by_congregation')` clause leaves the whole live tenant path
  untouched, and these are the regression proof, already in the suite.

**Withdrawal-transition call sites (must arm `presby.withdrawal_write_active`):**

- `src/lib/db/domain/publication.test.ts` lines 487 (the permitted triple), 595
  (Option A read-back) and 672 (the projection's `withdrawn_at`). Line 980's
  probe expects a rejection and must stay unarmed — but note its assertion
  regex (`/a withdrawal must set withdrawn_at|publications_withdrawal_shape|withdrawn_by/`)
  will then be matching the *new* unarmed-writer rejection rather than the
  shape CHECK, which is a false pass the next session must split into two
  probes.

**Identifier call sites (must arm `presby.identifier_trigger_active`):**

- `src/lib/db/domain/org-identifiers.test.ts` — `seedAlderIdentifier()`
  (`:127`, used by three tests) and the raw INSERT at `:183`. The test at
  `:177` ("is armed on UPDATE and DELETE only — INSERT is deliberately left to
  the grant and the partial unique index") is the F58 assertion that **inverts**
  and must be rewritten as the failing-first INSERT-rejection proof.
- `scripts/test-rls.sql` `:3342`–`:3347` asserts the guard trigger's `tgtype`
  bits as `ROW|BEFORE|DELETE|UPDATE` (`&1,&2,&8,&16`); widening to INSERT means
  adding `(t.tgtype & 4) = 4` and correcting the assertion text.
- `drizzle/0043`'s own `pcusa_pin` backfill (section 2) is column-existence
  guarded and runs before section 4 creates the trigger, so it needs no arming
  on a fresh apply and is skipped entirely on re-apply — confirmed by reading
  the guard, not assumed.

**Two implementation notes established by reading, worth keeping:**

1. **Trigger firing order is alphabetical by name.** On
   `organization_lifecycle_events`, `…_authority` sorts before `…_guard`, so
   `presby_assert_council_authority()` still rejects a bad actor/subject pair
   first; on `organization_successions`, `…_event_scope` sorts before
   `…_guard`. Both orders are compatible with the rulings, but the reviewer's
   "third predecessor after a valid merge" repro therefore needs a
   *legitimately-scoped* event so that `event_scope` passes and the GUC guard
   is provably what rejects.
2. **`presby_freeze_publication()` has no single reusable "immutable" literal.**
   Ruling 3 says the unarmed withdrawal falls through to "the function's
   existing exception vocabulary", but that function raises three distinct
   messages and the applicable one (`a publication is immutable; the only
   permitted UPDATE is a single withdrawal …`) is interpolated with `old.id`,
   so reusing it before `return new` means either duplicating the literal
   inside the one function body or introducing a helper. The
   `congregation_statistics` half has no such problem — its permitted-transition
   `IF` simply gains the conjunct and falls through to the single existing
   `raise`.

*(The inventory's closing "next agent" line is superseded: the sweep it
describes was completed on 2026-09-25 by the block above, which is the single
authoritative account of this loop-back.)*

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-24. Orchestrator disposition of Finding 1 follows at the end.*

**Date:** 2026-09-24
**Verified by:** qa

Every result below was produced by running the command myself on this machine against the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, `neondb`). Nothing is copied from the Phase 4 blocks; where my number matches the implementer's, I say so, and where my run differed I say that too.

## Type Check

`npm run typecheck`: **PASS** (`tsc --noEmit`, exit 0, no output).

`npm run build`: **PASS** (exit 0, full route manifest emitted). Run separately because a schema pipeline that drops a column can typecheck clean and fail at build-time route collection.

`npm run check` (all five tripwires): **PASS** — audit-coverage, `sql<Date>` guard, deps-drift, brand-scope, secrets/PII, each printing its own "passed" line, exit 0.

`npx eslint --max-warnings=0` over all **41** touched `.ts`/`.tsx` files (list derived from `git status --porcelain`, `reporting.ts` excluded as deleted): **clean, exit 0, zero errors and zero warnings.** This confirms the Phase 4 claim that none of the tree-wide pre-existing lint errors is in a file this pipeline touched — I verified it by linting the touched set directly rather than by diffing a whole-repo run.

## Unit Tests

**Run 1 — `npm test` (CI shape, no `.env.local`):**
Test Files 246 passed | 28 skipped (274) · Tests 3206 passed | 687 skipped (3893) · 0 failed · 11.75s · exit 0.

**Run 2 — `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (DB-backed):**
Test Files 273 passed | 1 failed (274) · Tests **3890 passed | 3 failed** (3893) · **0 skipped** · 382.51s · exit 1.

The two runs reconcile exactly: the 28 files / 687 tests that skip in the CI shape are the DB-backed suites, and all 274 files / 3893 tests execute under run 2 with **zero skips**. There is no spec in this repo that skips in both shapes, so the "a skipped spec is not a passing spec" rule is satisfied rather than waived.

**The 3 failures, and their cause established by experiment, not by accepting the note:**

- `src/lib/rate-limit.test.ts:241` — "blocks the (max+1)th request and returns retryAfterSeconds > 0"
- `src/lib/rate-limit.test.ts:256` — "resets after the window elapses (allows again after time advance)"
- `src/lib/rate-limit.test.ts:279` — "FIFO-evicts the oldest key when the map exceeds 10,000 entries"

Reading `src/lib/rate-limit.test.ts:195` (`describe("checkRateLimit (in-memory)")`), that block never stubs `RATE_LIMIT_DISABLED`, while the block at `:59` stubs it *on* and unstubs in `afterEach`. `src/lib/rate-limit.ts:190` short-circuits to `{ allowed: true }` whenever `process.env.RATE_LIMIT_DISABLED === "true"`, and `.env.local:25` sets exactly that (required by the Playwright `globalSetup`). Proof by execution: `npx dotenv -e .env.local -- env RATE_LIMIT_DISABLED=false npx vitest run src/lib/rate-limit.test.ts` → **15 passed (15)**, same env file, one variable flipped. The file is not in this pipeline's diff. **Cause confirmed; not attributable to this pipeline.** It is a genuine (pre-existing) test-hermeticity defect and I name it as a finding below rather than let it keep training readers to read a red suite as green.

**Targeted DB-backed files, run individually:**

| File | Result |
|---|---|
| `src/lib/db/domain/lifecycle.test.ts` | 9 passed |
| `src/lib/db/domain/publication.test.ts` | 15 passed |
| `src/lib/presbytery.test.ts` | ran green inside run 2 |
| `src/lib/org-provisioning.test.ts` | ran green inside run 2 |

**`psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` (as `presby_app`, confirmed by `select current_user` → `presby_app`):**
**exit 0, 357 assertions pass** (`grep -c 'NOTICE:  pass'` = 357). This matches the implementer's claimed 357 exactly.

> **First attempt failed and the reason matters.** The initial run aborted at `scripts/test-rls.sql:418` — `FAIL roll: cache agrees with replay — expected 0, got 4`. Cause: **8 orphan fixture organizations** matching `slug ~ '-[0-9]{13}$'`, all created 18:49:17–18:49:36 UTC, i.e. **before** my DB-backed run started (18:57:25 UTC). Three of them (`role-grants-test-{b,c,d}-1790275757010`) were the sole source of all four `presby_roll_cache_drift()` rows. They are debris from an earlier run, not from mine — **my serial run left zero orphans**, which independently confirms that `--no-file-parallelism` is the correct instruction and that the flake is a parallelism artifact. I purged them on the owner connection exactly as the Phase 4 runbook prescribes (`delete from organizations where slug ~ '-[0-9]{13}$'`, with `group_memberships_reject_derived` and `memberships_guard_end` disabled and re-enabled in the same transaction) and re-ran. Disclosed because it is a state change I made to the shared `development` branch. Incidentally it is also live evidence that `presby_guard_organizations_delete()` permits a `deletable_until`-stamped org on the owner path: all 8 carried a live stamp and the delete succeeded with the guard armed.

## End-to-End Tests

**Not applicable, and I am stating that explicitly rather than deferring it.**

`git status --porcelain` filtered against `^src/auth\.ts$|^src/app/\(auth\)/|^src/app/api/auth/|^src/lib/auth/` returns **no matches**. No file under any auth surface is added, modified or deleted. The stricter auth gate (running-server e2e with an MFA-enrolled seeded user, deferred-advisory PASS forbidden) therefore **does not apply to this diff**, and no `BLOCKED` arises from its absence.

`e2e/admin-organizations-create.spec.ts` and `e2e/support/seed-orgs.ts` are modified, but only in their fixture teardown/seed paths (a `deletable_until` stamp, and re-seeding through `organization_affiliations` instead of a direct `parent_id`). The Playwright suite was not run: it is not a required check for a non-auth-touching diff, and its `globalSetup` provisions users against the same shared `development` branch whose fixture state I had just purged and re-proved. Naming that as a deliberate, bounded omission, not a deferral of a required check.

## Regression Tests Added

*(Authored by the implementer; my job was to confirm each named item exists, run it, and cite it. Every `test-rls.sql` section Phase 2 Notes item 5 and Phase 3 Implementation Order item 9 name by name is present.)*

| Named requirement | Where it lives | Observed |
|---|---|---|
| Grant shape on `organizations` (F38) | `scripts/test-rls.sql:2744` — 32(b), asserts exactly **one** privilege and that it is `SELECT` | pass |
| Affiliation write-path probe: uniform message across causes, byte-identical whether the subject exists | `scripts/test-rls.sql:2867` — 32(f). Three causes in one `do` block (unauthorized actor; **nonexistent** subject uuid; real subject with no open affiliation), compared for identical `sqlerrm` *and* identical `sqlstate`; plus the no-org-context floor at `:2929` | pass |
| Delete guard on **both** connections | tenant half `scripts/test-rls.sql:2787` — 32(d); owner half `src/lib/org-provisioning.test.ts:612` ("refuses to DELETE an organization that carries no `deletable_until`, and permits one that does — on the owner connection") | pass |
| `presby_org_affiliated()` across a closed historical range (the 1990 case) | `scripts/test-rls.sql:2943` — 32(g), against the Quillhaven / Southern Fields → Northern Reach fixture | pass |
| Recipient read-back returns nothing for a sibling presbytery | `scripts/test-rls.sql:3643` — 34(c); behavioural twin `src/lib/db/domain/publication.test.ts:362` ("takes no council id: naming another council's congregation and year from the wrong context still returns nothing") | pass |
| `published_at` / `minute_reference` projection equals publication (F39) | `scripts/test-rls.sql:3710` — 34(d); plus `src/lib/db/domain/publication.test.ts:383` proving `getCongregationStatisticsRollup()` still reads `published_at` | pass |
| Succession cardinality deferred to commit | `scripts/test-rls.sql:3032` — 32(j); notice at `:3062` reads "a merged event with ONE predecessor fails at constraint-check time, not at the first INSERT" | pass |
| Backfill completeness re-run standalone | `scripts/test-rls.sql:3015` — 32(i) (tenant-scoped half); `src/lib/org-provisioning.test.ts:707` (global half); `drizzle/0045:108` `DO` block re-proves it before creating the trigger — I watched it print *"backfill completeness re-proven: 9 parented orgs, 9 open affiliation rows"* | pass |
| `field_spec` violations | `scripts/test-rls.sql:3794` — 34(f); `src/lib/db/domain/publication.test.ts:619`, `:635` | pass |
| Imported return outside the affiliation range | `scripts/test-rls.sql:3893` — 34(g) | pass |
| Republish supersession, old projection row frozen | `scripts/test-rls.sql:3933` — 34(h); immutability from the tenant side `:3741` — 34(e); `src/lib/db/domain/publication.test.ts:268` | pass |
| Withdrawn publication excluded from the recipient read; the one permitted withdrawal transition; every other UPDATE/DELETE raises | structure in `scripts/test-rls.sql:3603`–`:3623` (all three columns, the `publications_withdrawal_shape` CHECK, the trigger's catalog shape, the read-back signature via `pg_proc.proargnames`) and `:3741`–`:3765` (both tenant verbs refused); behaviour in `src/lib/db/domain/publication.test.ts:472` ("permits the ONE transition… and refuses every later touch"), `:441`, `:454`, `:429`, and `:546` ("removes the publication from the recipient's read-back while leaving the projection row exactly where it is") | pass |

**The Phase 2 coupling warning — found, run, cited.** `src/lib/presbytery.ts` and `src/lib/credentials.ts` answer "is X my member congregation?" with `parentId`; the increment-3 trigger answers with `presby_org_affiliated()`. The DB-backed proof is `src/lib/db/domain/lifecycle.test.ts:397` ("agrees for every parented organization: the shipped UI's `parent_id` answer and the trigger's affiliation answer cannot differ today") and `:411` ("keeps `parent_id` a pure cache: every open affiliation's `parent_org_id` is its subject's `parent_id`, and the two counts match"), both on `PLATFORM_DATABASE_URL` so they see the whole database rather than one tenant's slice. Tenant-visible slice at `scripts/test-rls.sql:3471` — 33(g). All three green in my runs.

**Failing-first, reproduced by me — two of the implementer's proofs, not taken on trust:**

1. `drop trigger congregation_statistics_about_org on congregation_statistics;` → `vitest run src/lib/db/domain/lifecycle.test.ts` → **2 failed / 7 passed**. Re-applied `drizzle/0045_presby_about_org_affiliation.sql` end to end (exit 0) → **9 passed**. Matches the batch-B claim exactly.
2. `drop trigger publications_freeze on publications;` → `vitest run src/lib/db/domain/publication.test.ts` → **4 failed / 11 passed**. Re-applied `drizzle/0047_presby_publications.sql` end to end (exit 0) → **15 passed**. Matches the batch-C claim exactly.

**Idempotency, proven by execution.** All five migrations re-applied whole-file with `-v ON_ERROR_STOP=1`: `0043` exit 0, `0044` exit 0 (*"affiliation backfill complete: 9 parented orgs, 9 open affiliation rows"*), `0045` exit 0, `0046` exit 0 (*"the 2024 field_spec covers every typed SASR column congregation_statistics carries (60 fields)"*), `0047` exit 0 (*"supersedes_publication_id is already gone — this migration has run before; nothing to mint"* followed by the completeness proof). `scripts/test-rls.sql` re-run afterwards: **exit 0, 357 assertions**. **The `development` branch is left in the fully-applied, green state** — 18 user triggers present and enabled across `organizations`, the three lifecycle tables, the four about-org tables, `statistical_returns` and `publications`.

**Migration hygiene.** `drizzle/meta/_journal.json` gains idx 43–47 with tags `0043_presby_org_identifiers`, `0044_presby_org_lifecycle`, `0045_presby_about_org_affiliation`, `0046_presby_statistical_returns`, `0047_presby_publications` — each tag byte-matches a file in `ls drizzle/*.sql`, no gaps, no duplicates, monotonic `when`. Verified by diff and directory listing.

**Isolation invariants, read from the live catalog rather than from the migration text:**

| Table | `relrowsecurity` / `relforcerowsecurity` | `tenant_isolation` policy |
|---|---|---|
| `organization_lifecycle_events` | t / t | yes (ALL) |
| `organization_affiliations` | t / t | yes (ALL) |
| `statistical_returns` | t / t | yes (ALL) |
| `publications` | t / t | yes (ALL) |
| `organization_identifiers` | f / f | none — **sanctioned** public org-identity data |
| `sasr_form_versions` | f / f | none — **sanctioned** platform reference data |
| `organization_successions` | f / f | none — **a third exception, not on the sanctioned list; see Findings** |
| `organization_affiliations_public` (view) | n/a | column list is the enforcement point: `subject_org_id, parent_org_id, relationship_type, effective_from, effective_to` — `reason`, `minute_reference`, `concurrence_reference` and the `closed_*` attribution are all absent, as Ruling 1 requires |

**Grants, from `information_schema.role_table_grants`:**

| Table | `presby_app` | `presby_platform` |
|---|---|---|
| `organizations` | **SELECT only** (F38 closed) | SELECT, INSERT, UPDATE, DELETE |
| `organization_affiliations` | **SELECT only** | SELECT, INSERT (Ruling A5's narrowing held) |
| `organization_lifecycle_events` | SELECT, INSERT | SELECT, INSERT |
| `publications` | SELECT, INSERT | SELECT, INSERT |
| `statistical_returns` | SELECT, INSERT | SELECT, INSERT |
| `sasr_form_versions` | SELECT | SELECT |
| `organization_successions` | SELECT, INSERT, DELETE | SELECT, INSERT, **UPDATE**, DELETE |

Every requirement in the brief holds: `SELECT` only on `organizations`; no INSERT/UPDATE/DELETE on `organization_affiliations`; no UPDATE/DELETE on `publications`, `statistical_returns` or `organization_lifecycle_events` for either role. The `presby_platform` UPDATE on `organization_successions` is batch B's finding 5, recorded there as deliberately untouched.

**Cross-council functions — bodies read, not inferred.** All seven are `prosecdef = t`: `presby_transfer_affiliation` (actor is `v_actor := presby_current_org()` at line 2 of the body; **no acting-council parameter**; standing read from the affiliation history via `presby_affiliation_parent_as_of()`, never from `organizations.parent_id`; the close preserves `organization_id` as provenance), `presby_apply_affiliation_to_org_tree` (`set_config('presby.affiliation_trigger_active','true', true)` — **three-argument, transaction-local**, as the pooled-connection risk item demands; also carries an ancestry-cycle guard beyond spec), `presby_assert_council_authority`, `presby_org_affiliated`, `presby_affiliation_parent_as_of` (both bounded to public-projection facts), `presby_publish_sasr_snapshot` (recipient from `presby_affiliation_parent_as_of(v_org, current_date)`, never `parent_id`; re-asks the about-org question at both year endpoints before writing), `presby_list_published_returns_to_me` (filters `p.recipient_org_id = presby_current_org() and p.withdrawn_at is null` internally; **no council parameter**). The three `organizations` guards check the GUC; the delete guard checks `old.deletable_until is null or old.deletable_until <= now()`.

## Coverage on Critical Modules

Measured with `vitest run --coverage` scoped to the three modules.

- `src/lib/permissions.ts`: **100%** (target 100% — met)
- `src/lib/two-factor.ts`: **91.3% statements / 100% branch / 90% functions**, uncovered `35-39` (target 90%+ — met)
- `src/lib/flags.ts`: **100%** (target 100% — met)

Combined: Statements 92.72% (51/55), Branches 100% (13/13), Functions 91.66% (11/12). None of the three is touched by this pipeline; reported because the standing targets apply at every verification.

## Feature-Gate Audit

*(Verified by reading the route/action bodies, not by inferring from green tests.)*

**No route handlers were added or changed** — `git status --porcelain` filtered on `route\.ts$` returns nothing. `src/app/api/sites/ingest/route.test.ts` is modified, but it is a spec file (a `deletableUntil` fixture stamp), not a handler.

**One `"use server"` file is in the diff**, and Phase 2's "no protected routes touched" line understates it, so I audited it rather than accepting the line:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `createOrganizationAction` — `src/app/(admin)/admin/organizations/new/actions.ts:87` | **yes** (`:90`, with `if (!session?.user) return { ok: false, error: "Unauthorized." }` at `:91`) | **yes** (`:92`) | **yes** — `FEATURES.ADMIN_ORGANIZATIONS` (`"admin.organizations"`, `src/lib/permissions.ts:20`), the correct key for the platform-admin organization-create surface |
| `setCongregationStatisticsAction` — `src/app/(org)/o/[slug]/admin/reports/actions.ts:52` | n/a | n/a | **unchanged** — the file is absent from `git status`/`git diff --name-only` entirely, confirming Ruling 5's narrowed retrofit protected it as intended |

The gate on `createOrganizationAction` is **pre-existing and untouched** by this diff (the diff adds optional parent-field parsing *after* the gate, at `:131`, plus an `invalid_parent` result mapping and two extra audit-metadata fields). The added parent parsing is inside the gated body, validates the parent id against a UUID regex and the relationship against a closed union before it reaches `createOrganization()`, and the `invalid_parent` copy is deliberately one non-enumerating string for "no such organization" and "that pairing is not permitted" alike — consistent with DECISION-040. No new gate was required and none is missing.

**Phase 4 gate items:** no `console.log` in any touched production path (grepped `org-provisioning.ts`, `presbytery.ts`, `dev-docs.ts`, all of `src/lib/db/domain/`, the action, `fixture-deletable.ts`); no `alert`/`confirm`/`prompt` anywhere in the diff; zero `"use client"` files added (no React ships); `npm run check:audit` reports zero violations; and the security-sensitive mutation keeps its existing key with a widened payload — `recordAudit(AUDIT_ACTIONS.ORG_CREATED, { … parentOrganizationId: input.parentOrganizationId ?? null, relationshipType: input.relationshipType ?? null })` at `src/app/(admin)/admin/organizations/new/actions.ts:210`. **Confirmed: the payload carries the parent.** No new `AUDIT_ACTIONS` key was minted, which is right — this is the same mutation with one more fact about it.

## Verdict

**PASS**

Every required check is green and was run by me: typecheck, build, all five tripwires, lint on the touched set, the CI-shape unit suite, the DB-backed suite serially, `scripts/test-rls.sql` as `presby_app` at 357/357 exit 0, and two of the implementer's failing-first proofs reproduced independently. Every `test-rls.sql` section Phase 2 Notes item 5 and Phase 3 item 9 name by name exists and passes; none is missing, so there is no named-coverage FAIL. The auth-stricter gate does not apply — no auth surface is touched, verified by path filter, and I say so explicitly rather than deferring it. The `development` branch is left fully applied and green.

### Findings recorded (none blocking this verdict)

1. **`organization_successions` has no RLS, no `organization_id`, and grants `presby_app` `SELECT, INSERT, DELETE` — a cross-council write path that is not function-mediated.** This is the one substantive thing I found. Phase 2 Ruling 1 sets the rule "cross-council access to the three-axis tables is function-mediated, never policy-mediated," and Phase 3's Data Model justifies the exception with "visibility follows the parent `event_id`'s tenant policy via a join." **That justification is factually wrong, and I demonstrated it** in a rolled-back transaction: as Northern Reach I inserted a lifecycle event; switching `app.current_org_id` to Alder Creek (a congregation with standing over nothing), `select count(*) from organization_lifecycle_events where id = <that event>` returned **0** — and the very next `insert into organization_successions (event_id, …)` naming that same invisible event **succeeded**. A council can write (and `DELETE`) succession rows against an event it cannot even read; the deferred cardinality trigger constrains shape, not ownership. No data and no write path exist today (both tables are empty, there is no UI and no DEFINER writer), and the *confidentiality* exposure is limited to topology that the org tree already publishes — the integrity hole on `DELETE` is the sharper half. **This is the design Phase 3 specified, not a Phase 4 deviation**, so the loop-back target is tech-lead/Phase 3, not the implementer — which is why it is a named finding rather than a FAIL. It must be settled before any pipeline gives the table a write path (the lifecycle-UI pipeline, or increments 6–7). Relatedly, it is the one new table whose grant/RLS posture is **not** pinned by a `test-rls.sql` assertion, unlike 32(b)/(c)/(m) and 34(a) — so a future widening would trip nothing. That assertion is owed.
2. **`src/lib/rate-limit.test.ts` is not hermetic.** Three tests (`:241`, `:256`, `:279`) read ambient `RATE_LIMIT_DISABLED`, so the DB-backed suite is red by default on any machine configured for e2e. Pre-existing, untouched by this pipeline, and cheap to fix (`vi.stubEnv("RATE_LIMIT_DISABLED", "")` in that block's `beforeEach`, mirroring the block at `:59`). Worth a `docs/TODO.md` line: a suite that is expected to be red teaches readers to skim past red.
3. **Orphan-fixture contamination makes `scripts/test-rls.sql` non-deterministic.** Eight `-<13-digit-timestamp>` organizations from a prior run failed section 10 before I purged them. My `--no-file-parallelism` run left **zero** orphans, which is good evidence the serial instruction is sufficient — but the suite has no self-cleaning step and no guard that says "the database is dirty" rather than "the roll cache is broken." Already tracked in `docs/TODO.md`'s unreliable-teardown item; this run is one more data point.
4. **Three open loop-back candidates from batch C remain open and unresolved**, correctly marked non-blocking by the implementer and unchanged by my verification: the increment-3/increment-5 as-of collision (a congregation redistricted in January cannot file its prior-year return through `presby_publish_sasr_snapshot()`; asserted in both directions at `scripts/test-rls.sql` 34(i) and `publication.test.ts:295`), `statistical_returns_submitted_is_self`, and the `'2024'`-always form-version policy. Phase 6 should confirm these are acceptable drift from Phase 1's description rather than let them lapse.
5. **State change I made to the shared `development` branch, disclosed:** deleted the 8 orphan fixture organizations above; dropped and re-created `congregation_statistics_about_org` and `publications_freeze` via whole-file re-application of `0045` and `0047`; re-applied `0043`, `0044` and `0046` as well. Final state verified: 18 triggers present and enabled, all grants as tabulated, `test-rls.sql` 357/357 exit 0.

*(Orchestrator note: Finding 4's three items were ruled on by the tech-lead's "Amendment after batches B and C" — rulings C2, C3, C4 — while this verification ran; all three are accepted behaviour with TODO lines, none a defect.)*

### Orchestrator disposition of Finding 1 (2026-09-24)

Not shipped as a note. The finding is a direct violation of Phase 2 Ruling 1's rule on a three-axis table, it has a demonstrated repro, and the fix is small: apply Ruling 1 to `organization_successions` in `drizzle/0044` (revoke tenant DML so the future DEFINER writer is the only write path, narrow the platform role, pin the posture with a `test-rls.sql` assertion). Routed as a Phase 3 → Phase 4 loop-back with a targeted QA re-verification, recorded below as "Phase 4 — loop-back after Phase 5". Phase 5's PASS stands for everything else.


## Re-verification after the Finding 1 loop-back (2026-09-24, qa) — recorded verbatim by the orchestrator

**Date:** 2026-09-24
**Verified by:** qa
**Scope:** the Finding 1 fix only, exactly as bounded by Phase 3 "Amendment after Phase 5". Nothing else in the earlier PASS is reopened. Every number below came from a command I ran on this machine against the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, `neondb`); where it matches the implementer's, I say so.

*(Terminology note: there is no git branch named `development` — the whole pipeline is still uncommitted on `main`. "`development` branch" here means the Neon database branch, as in my first Phase 5 section.)*

### 1. The original repro, re-run — it now fails, and at the layer claimed

**Layer 1, the grant (tenant connection, `presby_app`, `APP_DATABASE_URL`).** Same script shape as my original: as Northern Reach (`111…`) I recorded a `divided` lifecycle event; switched `app.current_org_id` to Alder Creek (`222…`, standing over nothing); confirmed `select count(*) from organization_lifecycle_events where id = <that event>` → **0**; then attempted the same INSERT that succeeded in my first run. Whole thing inside a rolled-back transaction.

```
ORIGINAL REPRO step 2: Alder Creek can see 0 row(s) of that event (expect 0)
ORIGINAL REPRO step 3: REFUSED  sqlstate=42501 (insufficient_privilege)
                       message=permission denied for table organization_successions
ORIGINAL REPRO step 4: DELETE REFUSED  sqlstate=42501
                       message=permission denied for table organization_successions
```

The refusing layer is the **grant**, not the trigger — `42501 insufficient_privilege`, Postgres' own text, no uniform lifecycle literal. That is exactly what the implementer's notes claim and not a word more: `drizzle/0044_presby_org_lifecycle.sql:906-910` ("the missing INSERT grant fires FIRST, as `permission denied for table organization_successions`, and this trigger is never reached from `presby_app` at all") and `scripts/test-rls.sql:3087-3091`. The DELETE half of the finding — the sharper half — is closed by the same layer.

**Layer 2, the trigger (owner connection, `neondb_owner`, `MIGRATE_DATABASE_URL`).** The privilege level the future `presby_record_lifecycle_event()` DEFINER writer will run at. Owner is `rolbypassrls = t` and did see the event under a foreign GUC, so the case is genuinely expressible:

```
OWNER step 3 (foreign event):     sqlstate=42501 message=organization_lifecycle_events: this change is not permitted
OWNER step 4 (nonexistent event): sqlstate=42501 message=organization_lifecycle_events: this change is not permitted
OWNER step 5 BYTE-IDENTITY: equal=t  len=59/59  md5=807d574c… / 807d574c…
OWNER step 6: same-council succession row accepted
OWNER step 7 (delete): sqlstate=23514 message=organization_successions <id>: a succession row is the content of a minuted act and is immutable; record a correcting act instead
OWNER step 8 (update): sqlstate=23514 … same literal
```

Byte-identity is a property I measured (length and md5 of `SQLERRM`), not one I inferred from a regex. The positive same-council write is accepted, so the fix does not close the legal path. DELETE and UPDATE both raise on the owner path. Post-rollback: 0 rows in `organization_successions` and 0 in `organization_lifecycle_events` — my probes left nothing durable.

I also ran the case the Phase 3 amendment put in scope but no test covers (see Finding 6): with `app.current_org_id` cleared, an INSERT naming a **real** event is permitted (the documented migration/provisioning path) while a **nonexistent** event is still refused with the uniform literal — the `is not null` conditional behaves as designed and existence is checked unconditionally.

### 2. Live catalog

| Check | Expected | Observed |
|---|---|---|
| `presby_app` grants on `organization_successions` | `SELECT` only | `SELECT` only |
| `presby_platform` grants | `SELECT`, `INSERT` | `SELECT`, `INSERT` (no UPDATE, no DELETE) |
| Triggers present + enabled (`tgenabled='O'`) | 3 | `_cardinality` (deferrable ✓, initdeferred ✓), `_event_scope`, `_freeze` |
| `presby_check_succession_event` | `prosecdef` | `t` |
| RLS on the table | off by design (topology is public) | `relrowsecurity=f`, `relforcerowsecurity=f` |

Read from `pg_class`/`aclexplode` and `pg_trigger` on the owner connection, i.e. the real catalog, not `information_schema` (which only shows grants involving the current role). The Drizzle table in `src/lib/db/domain/lifecycle.ts:176-199` matches the SQL column-for-column, and both agree there is no `organization_id` — no self-agreeing mock in the loop.

### 3. Suites

| Command | Result |
|---|---|
| `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` | **exit 0, 363 `pass` notices, 0 `ERROR`** — matches the implementer |
| `dotenv -e .env.local -- vitest run --no-file-parallelism` on `lifecycle.test.ts` + `org-provisioning.test.ts` + `publication.test.ts` | **3 files, 47 passed / 0 failed**, 15.1 s — matches |
| `npm run typecheck` | clean |
| `npm run check` | all five tripwires pass (audit, sql-date, deps-drift, brand-scope, secrets) |
| `npm test` (CI shape, no `DATABASE_URL`) | **3206 passed / 694 skipped**, 246 files passed / 28 skipped, exit 0 — matches |
| `eslint` on the three touched TS files | clean |

On the skips: the 694 are the DB-backed files that `describe.skipIf(!hasDb)` turns off when `DATABASE_URL` is unset, and every one of the 7 new tests is in that set. I did not accept them as passing — I ran them for real under `dotenv`, which is where the 47 came from. That is the same disposition as my first Phase 5 section, and it is why I ran both shapes rather than one.

The eight Finding-1 assertions all fired green, by name: `scripts/test-rls.sql:3064`, `:3069`, `:3078`, `:3084`, `:3103`, `:3111`, `:3128`, `:3131`, `:3138`.

### 4. The cardinality behaviour moved, it did not drop

Both halves are present on the owner connection in `src/lib/db/domain/lifecycle.test.ts`:

- `:449` — *"accepts succession rows from the council that owns the event, and the legal `divided` shape passes the deferred cardinality check"* (two rows, then `set constraints all immediate`, then a count of 2).
- `:488` — *"lets the FIRST predecessor of a `merged` event insert cleanly and fails only at constraint-check time — deferred, not immediate"* (asserts the row lands, then that `set constraints all immediate` raises `found 1 / 1`).

`scripts/test-rls.sql:3141-3149` is the comment that says where they went and why: *"THE CARDINALITY BEHAVIOUR ITSELF MOVED, and here is why, so a reader does not think it was dropped… no amount of rewriting makes a SELECT-only role insert."* So the relocation is discoverable from the place the coverage used to live, which is the thing that usually goes missing when tests move.

### 5. The posture is pinned, and I proved the pin rather than reading it

`scripts/test-rls.sql:3061-3064` — *"Finding 1: presby_app holds exactly ONE privilege on organization_successions"*. I demonstrated it fires by granting INSERT back inside a transaction and calling the assertion directly:

```
after a hypothetical re-grant, presby_app privilege count = 2 (assertion at test-rls.sql:3061 expects 1)
assertion FIRED as designed: FAIL Finding 1: presby_app holds exactly ONE privilege on
  organization_successions — expected 1, got 2
```

Rolled back; the grant shape afterwards is `presby_app.SELECT / presby_platform.INSERT / presby_platform.SELECT`. A re-grant would additionally trip `:3069` (the one privilege is SELECT), the live INSERT probe at `:3092-3103`, and the equality assertion in `src/lib/db/domain/lifecycle.test.ts:590-608`. Four named assertions, two suites, both a catalog form and a behavioural form.

### 6. Failing-first, reproduced by me

1. `drop trigger organization_successions_event_scope on organization_successions;` → 2 triggers left.
2. `lifecycle.test.ts` → **2 failed / 14 passed**, and the two failures are precisely the Finding 1 regression tests: `src/lib/db/domain/lifecycle.test.ts:368` (*"refuses a succession row naming a lifecycle event the current org does not own — the write QA reproduced, now rejected"*) and `:399` (*"raises the BYTE-IDENTICAL uniform literal…"*), both `AssertionError: expected undefined to be defined` — i.e. the INSERT silently succeeded again. Matches the implementer's reported 2/14.
3. `test-rls.sql` in that same state → **exit 3**, `ERROR: FAIL organization_successions: all three triggers are present and enabled … expected 3, got 2` at `scripts/test-rls.sql:3128`. Also matches.
4. `psql "$MIGRATE_DATABASE_URL" -f drizzle/0044_presby_org_lifecycle.sql` whole → exit 0, no errors, backfill notice unchanged (`9 parented orgs, 9 open affiliation rows`).
5. Re-run → **47 passed**; `test-rls.sql` → **exit 0, 363**.

So the regression test was watched failing before the guard and passing after it, by me, not taken on report. The branch is left fully applied and green, catalog re-confirmed: three triggers enabled, `prosecdef=t` on the event-scope function, grants as tabulated, **0** orphan `-<13-digit>` fixture organizations, 0 rows in both lifecycle tables.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| — | — | — | — |

**No protected routes touched.** Verified by listing every file in `src/`, `e2e/`, `scripts/`, `drizzle/` modified in the loop-back window: exactly the five the implementer declared — `drizzle/0044_presby_org_lifecycle.sql`, `scripts/test-rls.sql`, `src/lib/db/domain/lifecycle.ts`, `src/lib/db/domain/lifecycle.test.ts`, `src/lib/dev-docs.ts`. No `route.ts`, no `"use server"` action, no auth surface — the stricter auth gate does not apply, and I say so rather than deferring it. The `dev-docs.ts` change is the one-sentence correction claimed: the `organization_successions` entry no longer repeats the disproved "visible through a join" claim and now states the grant-plus-trigger shape.

### Nothing unexpected in the tree

The working tree is byte-for-byte the same file set as at the start of this re-verification (56 `git status` entries, same list), `package.json` unchanged against `HEAD`. Mtimes confirm the loop-back's five source files were written 15:20–15:23 and the three docs (`decisions.md`, `schema-design-2.md`, `TODO.md`) alongside them, with the work-log last at 15:31; nothing else in the repo has moved since 14:21, which predates the loop-back. The claim "nothing else in the pipeline was touched" holds.

### New finding (non-blocking, named so it is not lost)

6. **The event-scope trigger's permissive branch has no test.** `presby_check_succession_event()`'s `if v_actor is not null` guard (`drizzle/0044_presby_org_lifecycle.sql:913-931`) is the deliberate exception to this migration's own convention — every other DEFINER checker refuses a null context outright; this one must permit it for migration backfills and platform provisioning. I verified live that it behaves correctly (null context: a real event is accepted, a nonexistent one is still refused with the uniform literal), but every test sets `app.current_org_id`: `src/lib/db/domain/lifecycle.test.ts` has seven `set_config` calls and no null-context probe, and `scripts/test-rls.sql` 32(j) structurally cannot have one. A later "make this consistent with the other triggers" refactor that deletes the guard would go green in both suites. I am not calling this a FAIL — the *restrictive*, security-bearing branches are covered, the uncovered branch is permissive, has no caller today, and would fail loudly at development time in the future pipeline that first needs it — but it is a real gap, it was named in the Phase 3 amendment's own re-verification scope, and it should be one `docs/TODO.md` line owed to the lifecycle-UI pipeline, which is the first code that will depend on it.

Minor, no action: `presby_freeze_succession()` embeds `old.id` in its message. That is not an enumeration oracle — the caller already holds the id it just named — and it matches `presby_freeze_lifecycle_event()`'s shape from section 12, which the earlier PASS already covered.

### Verdict

**PASS.**

The fix is correct, it is the fix Phase 3 ruled for, and it is pinned. My original repro is refused at the grant on the tenant path and at the trigger on the owner path, with a byte-identical literal I measured; DELETE and UPDATE are refused on every connection including the owner; the legal same-council write still works; the grant shape is what both the design and the assertions say; the relocated cardinality coverage is present and signposted from where it used to live; a re-grant of INSERT trips a named assertion I watched fire; and the regression tests were watched failing before the guard and passing after it, by me. Every suite the Phase 4 loop-back block claims was re-run by me and reproduced its number exactly: `test-rls.sql` 363/exit 0, the DB-backed trio 47, typecheck clean, all five tripwires, `npm test` 3206/694. Finding 1 is closed. Finding 6 is a coverage note for a follow-up TODO line, not a blocker. The `development` branch is left fully applied and green.


## Re-verification after the hardening pass (2026-09-24, qa) — recorded verbatim by the orchestrator

**Date:** 2026-09-24
**Verified by:** qa (independent re-run; nothing in this section is taken from the implementer's report on trust)

Scope: the constraint-and-authority hardening pass (F47–F53 / DECISION-140) specified in Phase 3's "Amendment after external implementation review", built in Phase 4's "Loop-back after external implementation review", and ratified in Phase 3's "Ratification after the hardening pass". Every check below was executed by me on the `development` Neon branch (`ep-lingering-meadow-axnarpsq`, `neondb`), migrations applied with `psql "$MIGRATE_DATABASE_URL"` per the work-log's own local-apply block. No file was written by this phase.

### 1. The reviewer's holes, probed directly

Every probe ran inside a `begin; … rollback;` except where a committed fixture was unavoidable (noted). Each is stated with the layer that actually refused, because "refused" and "refused by the mechanism the ruling built" are different facts.

**(a) `organization_identifiers` (F47).** One identifier row (Alder Creek, `oga_pin`, `source='qa-probe'`) had to be *committed* for a real tenant connection to see it at all; purged afterwards (see §5).

| Probe | Connection | Result | Refusing layer |
|---|---|---|---|
| UPDATE Alder Creek's row as Bramblewood | `presby_app` | `permission denied for table organization_identifiers` | **grant** (SELECT-only); no RLS on the table, so the grant binds and the statement never reaches the trigger |
| DELETE the same row as Bramblewood | `presby_app` | same `permission denied` | grant |
| `presby_set_organization_identifier()` as an unrelated org | `presby_app` | `organization_identifiers: this change is not permitted` | function standing check |
| same function, actor **is** the subject | `presby_app` | succeeded, `is_verified` flipped to `t` | positive control |
| same function, actor = Northern Reach (affiliated superior) | `presby_app` | succeeded, `source='council'` | positive control |
| raw UPDATE, no GUC | `neondb_owner` (`rolbypassrls = t`) | refused | **`presby_guard_organization_identifiers()`** |
| raw DELETE, no GUC | owner | refused | same trigger |
| raw UPDATE with `presby.identifier_trigger_active` armed by hand | owner | `UPDATE 1` | proves the GUC is the discriminator |

**(b) `organization_successions` (F48).** Duplicate `(event_id, predecessor_org_id, successor_org_id)` → `duplicate key value violates unique constraint "organization_successions_edge_unique"`.

**(c) `organization_affiliations` (F49).** Owner raw UPDATE and DELETE without the GUC → refused by `presby_guard_organization_affiliations()`; with the GUC armed → `UPDATE 1`. `_range_order`: `effective_from = effective_to` → CHECK violation (the empty-daterange case the GIST EXCLUDE cannot see). `_closed_shape`, both arms → refused by name. `_not_self`: refused earlier by `presby_assert_council_authority()`; with that trigger disabled in-transaction → `violates check constraint "organization_affiliations_not_self"` — defence in depth, not a gap. `_recorded_has_from`: 0 rows in `pg_constraint`, as ruled.

**(d) `statistical_returns` (F50).** `submitted`+`reconciled=false`, `submitted`+`attested_at is null`, `imported`+`reconciled=true` → all refused by `statistical_returns_provenance_shape`. Positive control with both text attestation columns null → accepted (the ratified deviation). Tenant INSERT on `statistical_returns` and on `publications` → `permission denied`.

**(e) `publications` (F51).** `withdrawn_at` set with the other two null → `violates check constraint "publications_withdrawal_shape"` (the symmetric predicate is live). Supersession refused on all four axes (different recipient, different report year, different publishing org, forged `supersedes_id`) with one byte-identical literal. Same org/recipient/year → chained. Fork → `duplicate key … "publications_supersedes_once_idx"`. Projection whose `organization_id` is not the publication's recipient: caught first by the about-org trigger; with it disabled in-transaction → `violates foreign key constraint "congregation_statistics_publication_recipient_fk"`. Both ends of the projection bind.

**(f) Withdrawal, Option A (F52).** Full triple set on the owner path in a rolled-back transaction; `presby_list_published_returns_to_me()` under the recipient's context returned the row **with `withdrawn_at` non-null** (1 before, 1 after). `congregation_statistics.withdrawn_at` on the tenant connection: null→set alone → `UPDATE 1`; second withdrawal, bundled change, other-column UPDATE, DELETE, set→null → all refused by `presby_reject_published_statistics_write()`. Exactly one permitted transition, by exhaustion.

**(g) `sasr_form_versions.field_spec` (F53).** Edit on referenced `2024` → refused by `presby_freeze_used_field_spec()`; on unreferenced `1984` → permitted; non-`field_spec` UPDATE on `2024` → permitted; byte-identical re-write → permitted; the migration's own `on conflict … do update` converged on re-apply.

### 2. Live catalog

| Table | `presby_app` | `presby_platform` |
|---|---|---|
| `organization_identifiers` | SELECT | SELECT, INSERT, UPDATE, DELETE (documented intent; nothing authenticates as that role) |
| `statistical_returns` | SELECT | SELECT |
| `publications` | SELECT | SELECT |
| `organization_affiliations` | SELECT | SELECT, INSERT |
| `organization_successions` | SELECT | SELECT, INSERT |

Triggers present and enabled: `organization_identifiers_guard`, `organization_affiliations_guard`, `publications_supersession`, `sasr_form_versions_field_spec_freeze` (WHEN `old.field_spec IS DISTINCT FROM new.field_spec`), plus the pre-existing `organizations_guard_delete`/`_reparent`, `publications_freeze`, `statistical_returns_freeze`. `prosecdef = t` on all ten DEFINER functions the spec names; the three GUC-only guards are correctly `f` (they read no table).

### 3. Suites, run by me

| Check | Result |
|---|---|
| `scripts/test-rls.sql` as `presby_app` | **exit 0, 384 pass, 0 ERROR/FAIL** |
| five DB-backed files, `--no-file-parallelism` | **119 passed, 0 failed** |
| `npm run typecheck` | PASS |
| `npm run check` | PASS, all five |
| `npm test` (CI shape) | **3206 passed / 732 skipped / 0 failed** |
| whole suite under `.env.local` | 3935 passed / 3 failed (`rate-limit.test.ts`, pre-existing env cause, confirmed untouched) |
| `npm run build` | exit 0 |

### 4. Idempotence and order

`0043 → 0047` re-applied whole in order with `ON_ERROR_STOP`: all five exit 0, zero errors; `test-rls.sql` 384 after. Repeated after the §5 sabotage with the same result. The 0046-after-0047 self-assertion passes (`the 2024 field_spec covers every typed SASR column … (60 fields)`); 0047's completeness assertion passes; its backfill reports nothing to mint.

### 5. Failing-first, reproduced by me

**CHECK.** Dropped `publications_withdrawal_shape` and restored the original broken predicate: the `withdrawn_at`-only row was **accepted**, and `src/lib/db/domain/publication.test.ts:976` **failed**. **Trigger.** Dropped `organization_affiliations_guard`: an owner-connection UPDATE of Quillhaven's 1994 row **succeeded** — the reviewer's exact scenario — and `scripts/test-rls.sql:3310` failed (exit 3) with `src/lib/db/domain/lifecycle.test.ts:776`. Both restored by re-applying all five migrations; 384 / 119 green again. One orphan purged (the committed probe identifier row); final counts match the pre-probe state; branch left fully applied and green.

### 6. The refused CHECK and the attestation deviation — pinned, factually grounded

`scripts/test-rls.sql:3481-3484` asserts `organization_affiliations_recorded_has_from` is absent; `:3486-3491` asserts exactly one `authority = 'recorded'` row with null `effective_from` exists, so the two cannot drift apart; `drizzle/0044:442` carries the note. The Quillhaven row in the live database: `authority = 'recorded'`, `effective_from = NULL`, `minute_reference = 'Southern Fields stated meeting, 1901-04-02, item 1'` — a minuted act with an undatable start is real, so the refusal is correct. The attestation deviation is documented at `src/lib/db/domain/returns.ts:217-232`, matches the live predicate, and is pinned behaviourally by `src/lib/db/domain/publication.test.ts:955` (re-tightening the CHECK turns it red).

### 7. Fixture-teardown path

Org with a future `deletable_until`, carrying an affiliation and an identifier → `DELETE 1`, both cascades clean (the delete guard arms both GUCs). Org without → `organizations: an organization is permanent; record a lifecycle event instead of deleting it`. Stale `deletable_until` → same refusal.

### Regression tests verified

`src/lib/db/domain/org-identifiers.test.ts` (new, 9); `lifecycle.test.ts` +9 incl. `:800` (the cascade test a naive always-reject DELETE fails); `publication.test.ts` +21 incl. the thirteen probes relocated from `test-rls.sql` because the INSERT revokes fire first; `test-rls.sql` 363 → 384. No self-agreeing mocks.

### Feature-gate audit

**No protected routes touched** — `git diff --name-only` shows zero entries under `src/app/`; no auth surface touched; the stricter auth gate does not apply. No audit events owed (no application mutation path added).

### Advisories (non-blocking)

1. One unreproduced full-suite flake on the first whole-suite run (a fourth failing test not captured; two subsequent runs showed only the three `rate-limit` env failures; the five relevant DB-backed files passed 119/119 three times) — most likely the shared-branch contention already tracked in `docs/TODO.md`.
2. The tree changed beyond the implementer's list during verification (`package.json` 0.24.1, release notes, TODO, decisions, schema-design-2, the work-log's ratification section) — housekeeping only; `check`, `typecheck` and `build` re-run afterwards, all green.
3. `_not_self` and the recipient FK sit behind stricter triggers, so a silent drop of either would be caught only by the catalog assertions (`test-rls.sql:4197-4210`), which exist.
4. `organization_identifiers` INSERT remains ungated beyond the grant, deliberately, pinned at `org-identifiers.test.ts:170` and tracked in `docs/TODO.md`.

### Verdict

**PASS.** Every hole the external reviewer named is closed by the mechanism the ruling specified, proven on the connection where it actually matters — including the four cases where a grant edit alone would have been inert against `neondb_owner`. Both loop-back candidates are ratified and pinned. Both failing-first proofs reproduced from scratch. Migrations idempotent and order-correct in both directions. Branch left fully applied, green, free of orphan fixtures.


## Re-verification after hardening round two (2026-09-25, qa) — recorded verbatim by the orchestrator

**Scope:** F54–F58 / DECISION-141, security-review B-M1 and B-M2, and the follow-on revoke of `presby_app`'s INSERT on `organization_lifecycle_events`, as built in `drizzle/0043`–`0047`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, and the five DB-backed spec files. Owner `neondb_owner` via `$MIGRATE_DATABASE_URL`, tenant `presby_app` via `$APP_DATABASE_URL`, all probes in `begin … rollback`. No files written; Playwright not run (other pipelines held `src/app/`, `src/lib/auth/`, `e2e/`).

### Suites

| Run | Result |
|---|---|
| Five DB-backed files, `--no-file-parallelism` | **142 passed / 0 failed** (lifecycle 38, publication 43, org-identifiers 11, presbytery 34, org-provisioning 16) |
| `npm test` | 246 passed / 29 skipped files; **3235 / 760 / 0 failed** |
| `scripts/test-rls.sql` as `presby_app` | **402 passes, exit 0** — three times (before re-apply, after whole-file double-apply, after both failing-first restores) |
| `npm run check` | all five pass |
| `npm run build` | exit 0 |
| `npm run typecheck` | PASS |

Two full-suite runs *with* `.env.local` produced flapping failures (5 then 8 files, different sets); re-running all seven flapping DB-backed files serially → **229 passed / 0 failed** — parallel-execution collisions on the shared branch (implementer Finding 5). Out of scope but real: `src/lib/rate-limit.test.ts` fails 3/15 whenever `RATE_LIMIT_DISABLED=true` is in the environment (already in `docs/TODO.md`).

### Live-catalog audit — all four sub-claims confirmed exactly

`presby_app` holds **SELECT and nothing else** on both lifecycle tables; `presby_platform` SELECT+INSERT. `has_function_privilege('presby_app', …)` **false** for all nine revoked helpers and **true** only for `presby_deny_publication_write()`; `public` holds none. All **21** named DEFINER functions: `prosecdef = t` with `search_path=public`; the three GUC-only guards INVOKER with null `proconfig`. `organization_identifiers_guard.tgtype = 31` (BEFORE ROW INSERT+UPDATE+DELETE).

### The reviewer's three repros, owner connection

| Probe | Result | Refusing layer |
|---|---|---|
| (a) third predecessor D→C into a settled `merged` A+B→C, marker **disarmed** | refused | `organization_successions_guard` → `presby_guard_lifecycle_write()` → `presby_deny_lifecycle_change()` |
| (a′) same insert with the marker **re-armed** after the act settled | **SUCCEEDS** — 3 predecessors / 1 successor, deferred check clean | nothing — **Finding QA-1** |
| (b) `merged` with zero succession rows, armed | refused at deferred-check time | `organization_lifecycle_events_cardinality` → *"needs at least 2 predecessors and exactly 1 successor (found 0 / 0)"*; `divided` likewise; `dissolved` passes clean |
| (c) raw owner INSERT into `statistical_returns` (`submitted`, reconciled, attested_at), unarmed | refused | `statistical_returns_guard`; armed positive control inserts |
| (c) raw owner INSERT into `publications`, unarmed | refused | `publications_guard` |
| (c) `published_by_congregation` `congregation_statistics`, unarmed | refused | `congregation_statistics_publication_guard` — not the FK |
| (c) `presbytery_entered` row on the **tenant** connection, no marker | `INSERT 0 1` | the `WHEN` clause; the live path is intact |

Tenant grant probes on the four INSERT-revoked tables: `permission denied for table …` even with the marker armed — the tenant cannot arm its way past a grant.

### Withdrawal pair

Owner: both transitions refused unarmed (`presby_freeze_publication()` line 83 / `presby_reject_published_statistics_write()` line 30), accepted armed; partial-column withdrawal still refused by the earlier branch. Tenant: `publications` grant-closed. **`congregation_statistics` is not — Finding QA-2.**

### Identifiers

Raw owner INSERT unarmed → refused by `organization_identifiers_guard`; armed → inserts. `presby_set_organization_identifier()` works end to end from an org context (INSERT branch mints; UPDATE branch flips `is_verified` f→t). UPDATE/DELETE still refused unarmed.

### Seed

`scripts/seed-dev.sql`'s publication-chain block, extracted verbatim (ids/year remapped), in rolled-back transactions: with its own `set_config` line (`:1385`) → `INSERT 0 1` ×3; without → refused at the first insert with the publication-chain literal. Necessary and sufficient.

### Idempotence

All five files re-applied whole in order → five `exit=0`; row counts across nine tables identical; `test-rls.sql` 402 after.

### Failing-first, performed by me

1. `drop trigger organization_lifecycle_events_cardinality` → `lifecycle.test.ts:896` fails (*"rejects a merged event committed with ZERO succession rows, at commit"*); `0044` re-applied → 38/38.
2. `grant insert on organization_lifecycle_events to presby_app` → `test-rls.sql:2791` fails (`expected 0, got 1`, exit 3, 241 passes); `0044` re-applied → 402 / exit 0.

I can confirm two of the implementer's nine failing-first proofs; I cannot confirm the other seven were watched failing.

### Findings

**QA-1 — the lifecycle marker is transaction-scoped but not event-scoped; a committed act's topology is not immutable to an armed writer.** `drizzle/0044:1338` claims the guard "stops the reviewer's exact repro: a later, separate INSERT of a third predecessor edge into an already-valid, already-committed `merged` event." Measured: only for an *unarmed* writer. Once the marker is set, `organization_successions_guard` passes, the event-scope null-actor branch passes by design, and cardinality is satisfied — the third edge inserts cleanly. No live exposure today (nothing arms it; `presby_app` is SELECT-only). **The exposure arrives with `presby_record_lifecycle_event()`**, which is specified to arm the marker at entry and whose author will believe committed topology is protected. Cheap fix: make the marker carry the event id (`set_config('presby.lifecycle_write_active', <event_id>, true)`) and have `presby_guard_lifecycle_write()` compare `new.event_id`/`new.id` against it — "this row belongs to the act this transaction is recording." A Phase 3 ruling.

**QA-2 — F56's asserted property is false on the tenant connection, and the suite asserts it while a probe 190 lines earlier disproves it.** `drizzle/0047:323` says the withdrawal transition "is unreachable on every connection until the writer ships"; `scripts/test-rls.sql:4728`/`:4737` assert the same. Measured as `presby_app` with the recipient's context: `set_config('presby.withdrawal_write_active','true',true)` then `update congregation_statistics set withdrawn_at = now() where id = …` → **`UPDATE 1`**. `presby_app` holds UPDATE on `congregation_statistics` (the live `setCongregationStatisticsAction` needs it) and a GUC is a marker, not a privilege. `scripts/test-rls.sql:4540-4549` performs exactly this and asserts success as future-plumbing proof; `:4737` then asserts the opposite. Unlike the INSERT half, **the withdrawal half has no FK backstop**: a recipient presbytery with SQL access can mark a congregation's published projection withdrawn, unpaired from its publication — the state F56 exists to prevent. One operation wider than the accepted residual, and documented as closed.

**QA-3 (minor)** — `drizzle/0047:325` cites "scripts/test-rls.sql section 39"; there is no section 39 (the probes are 35(d), `:4517-4552`).

### Regression Tests

Present and behaviourally correct for the built mechanisms (`lifecycle.test.ts:759, :811, :883/:903`; `publication.test.ts` fabricated-artifact probes and the `WHEN`-scope regression; `org-identifiers.test.ts` F58; the `:980` split). **Named gap:** no test exercises an armed later insert into a settled event, and none records that the tenant path can arm the withdrawal marker.

### Feature-Gate Audit

**No protected routes touched.** No route/action in the diff; the five domain-module changes are comment-only (verified by filtering the diff to non-comment lines).

### Branch housekeeping

20 orphaned fixture organizations left by my own full-suite runs (all in-window) purged with the documented disable/enable wrap; branch at 15 orgs, zero roll-cache drift, grants/triggers/pins verified intact; `test-rls.sql` 402 / exit 0 as the last measurement. Working tree byte-identical to session start.

### Verdict

**FAIL — escalated to tech-lead (Phase 3), not to the implementer.** Every required check is green and independently reproduced; the implementer built what was ruled. Two security properties ship asserted as fact that the database does not have (QA-1 at `drizzle/0044:1338`; QA-2 at `drizzle/0047:323`, `test-rls.sql:4728`/`:4737`), one disproved by measurement on the tenant connection. The remedy may be as small as correcting the claim text plus TODO lines, or scoping the lifecycle marker to its event id; it should not be settled by the agent that wrote the comments. Phase 6 cannot start from this verdict.

---




# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-24. Housekeeping disposition of the follow-ups at the end.*

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The two structural gaps Phase 1 found unbuildable — redistricting with no write path, and a recipient council that could never read what was published to it — are now real, function-mediated, polity-checked mechanisms with the exact tests Phase 1 asked for, and a Phase-5-caught defect in the third table of the same family (`organization_successions`) was corrected and re-verified rather than shipped quietly; the two open items are a housekeeping debt (CLAUDE.md/`docs/architecture.md` edits promised at this exact phase, not yet made) and one small, cheap, real drift (a platform-operator write path that exists at the function layer with no control in the one form that could drive it).

## What's Working

- **Flow 1 (publish → read-back).** `presby_publish_sasr_snapshot()` (`drizzle/0047_presby_publications.sql:644-1005`, read in full) writes `statistical_returns` → `publications` → `congregation_statistics` in one transaction, exactly as Phase 1 asked. The recipient is derived from `presby_affiliation_parent_as_of(v_org, current_date)` (`:732`), never `organizations.parent_id` — the mechanism change Phase 1's Flow 1 gap demanded. `published_at`/`minute_reference` are written as the *same instant* (`v_now`, `:966-971`) into both `publications` and `congregation_statistics`, closing F39 by construction rather than by convention. The read-back gap I named in Phase 1 ("any future feature that needs the original submitted payload has no read path named") is closed by `presby_list_published_returns_to_me()` (`:1092-1127`), which filters `recipient_org_id = presby_current_org()` internally, takes no caller-supplied council id, and is proven in QA's Phase 5 table to return nothing for a sibling presbytery (`test-rls.sql:3643`, `publication.test.ts:362`).
- **Flow 2 (redistricting).** `presby_transfer_affiliation()` (`drizzle/0044_presby_org_lifecycle.sql:653-749`) is exactly the write path I said the schema as specified could not execute. I read the body: standing is checked from the affiliation history via `presby_affiliation_parent_as_of()` (`:707-711`), never from the cache it is about to rewrite; a same-parent correction requires the current parent (`:697-699`); a true transfer requires the common superior of both old and new parent (`:700-712`), which is what makes a synod — not either presbytery — the only actor who can redistrict a congregation between them. `presby_assert_council_authority()` is called against the *parent*, not the actor (`:717-718`), which is Ruling A3's corrected split, verified against G-3.0403(c)/G-3.0502(d) independently in Phase 2 and adopted as design authority in Phase 3. This is not a paper mechanism; QA ran `test-rls.sql` 32-series and the DB-backed suite against it.
- **Flow 3 (dissolution).** Both failure modes I named in Phase 1 are enforced, and by the mechanisms I asked for. Self-targeting: `organization_lifecycle_events_not_self` CHECK (`lifecycle.ts:120-123`, `organizationId <> subjectOrgId`) plus the stronger one-level-above trigger (`presby_assert_council_authority`), so a presbytery cannot record any lifecycle event naming itself as subject and cannot act on a body it is not immediately above. Succession cardinality: `presby_check_succession_cardinality()`, a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` (`drizzle/0044:944-986`), so a `merged` event's first predecessor row is legal until commit — QA reproduced the failing-then-passing case explicitly (`test-rls.sql:3032`, notice text "a merged event with ONE predecessor fails at constraint-check time, not at the first INSERT").
- **The self-correcting loop-back on `organization_successions` is itself evidence the pipeline works as designed, not a mark against it.** Phase 5 QA demonstrated a live cross-council write/delete against a table Phase 3's own Data Model justified with a claim ("visibility follows the parent event_id's tenant policy via a join") that was true for reads and false for every write. This is precisely the class of defect Phase 2 Ruling 1 exists to catch, and it was caught — by QA, with a rolled-back repro, not asserted from reading code — routed back through Phase 3, fixed in the same migration number, and re-verified with a byte-identical measured literal (`sqlerrm`/`sqlstate` match, md5-compared) and a demonstrated-firing regression assertion. I read the current state (`lifecycle.ts:158-197`, `drizzle/0044`'s grant table) and it matches what QA's re-verification reports: `presby_app` SELECT-only, `presby_platform` select+insert, a `SECURITY DEFINER BEFORE INSERT` event-scope trigger, a freeze trigger on both connections. `docs/TODO.md:59` records this resolution correctly, closing the earlier, narrower Ruling B5 line.
- **Grant-model corrections (F38, Ruling 2/7) are made true, not assumed**, exactly as Phase 2 demanded. QA read the live catalog (not the migration text) and confirmed `organizations` is SELECT-only for `presby_app`, with the revoke pinned by a `test-rls.sql` assertion QA also proved fires on a hypothetical re-grant (Phase 5's live-fire demonstration at `test-rls.sql:3081-3089` for `organization_successions`, and 32(b) for `organizations`).
- **The Book of Order corrections (Ruling 10) all landed in the design doc**, verified by grep: G-3.0301(a) (not c) for the lifecycle vocabulary, G-3.0108(a) (not G-3.0107) for the reviewing council, with G-3.0107 correctly retained for the post-dissolution records-ownership argument that backs Ruling 5's read-on-publication-not-live-affiliation design. `member_nwc` shipped in the enum and the CHECK (`drizzle/0044:317`).
- **`/developer`'s honesty mechanism was actually updated**, not just promised. `src/lib/dev-docs.ts:385,389,401-403` carries the three new invariant entries Phase 2/3 named (organization permanence, derived `parent_id`/`path`, publication-as-event), each with correct enforcement markers, and the `organization_successions` doc comment was corrected in the Phase 5 loop-back to drop the disproved "visible through a join" claim — QA confirmed this is the one-sentence fix, not a rewrite that also touched something else.

## Intent-vs-Shipped Diff

- Phase 1 said: the schema as specified structurally cannot execute D19's headline redistricting scenario. Shipped: `presby_transfer_affiliation()`, function-mediated, common-superior standing check, one-level-above authority check on the parent. Verdict: **matches** — this is the gap closed, not routed around.
- Phase 1 said: no read mechanism exists for a recipient council to read back the original submitted artifact once it moves off `congregation_statistics`. Shipped: `presby_list_published_returns_to_me()`, same DEFINER shape as its sibling, filtered internally on the caller. Verdict: **matches**.
- Phase 1 said (Gap #3): `organizations` grants `presby_app` SELECT only, confirmed against `drizzle/`. Phase 2 found the live database said otherwise (full DML) — the opposite of what I reported, traced to an additive blanket grant. Shipped: the grant is now made true by an explicit revoke, pinned by `test-rls.sql`. Verdict: **matches the corrected premise** — my Phase 1 read of the repo was accurate; the architect's Phase 2 correction of the live database was the fact that mattered, and the fix landed.
- Phase 1 said: the fixture regression from the about-org trigger touches "several already-shipped test files." Shipped: five files enumerated precisely by the architect (Ruling 3), swept in their own commit-worthy line item before increment 3, per Implementation Order item 3. Verdict: **matches, and more precisely scoped than my own estimate**.
- Phase 1 recommended dropping `sasr_reports` (zero consumers, stale shape). Shipped: dropped in increment 5, with the working-draft need it nominally served recorded as an owed design question for the publish-UI pipeline (`docs/TODO.md:53`). Verdict: **matches**.
- Phase 1 recommended `deletable_until` over `platform_status = 'fixture'`. Shipped: exactly that, stamped at insert (not teardown), guarding both connections. Verdict: **matches**.
- Phase 1 flagged the missing `member_nwc` enum value. Shipped: added, with the correct Book of Order backing (G-3.0301(b)). Verdict: **matches**.
- Phase 1 flagged `btree_gist` as a non-issue, correcting round 3's framing. Confirmed unchanged, idempotent re-creation. Verdict: **matches**.
- Phase 1's Open Question ("does the platform operator need an interim escape hatch to provision a hierarchical org, or is that an accepted foreclosure?") was answered deliberately by Phase 2 Ruling 3: extend `createOrganization()` now, so "hierarchical orgs remain provisionable on day one." Shipped: `createOrganization()` genuinely accepts `parentOrganizationId`/`relationshipType`/etc. and writes both rows in one transaction (`org-provisioning.ts:269-357`) — the *function* delivers Ruling 3's promise. But I read `create-organization-form.tsx` in full and it has no field for a parent organization or a relationship type at all; `actions.ts:136-156` reads `parentOrganizationId`/`relationshipType` from `formData` defensively, but nothing in the rendered page ever populates that key. **Verdict: acceptable drift, not a regression, but not fully "matches" either** — the write path Ruling 3 promised is real at the API layer and inert at the one UI surface that could drive it, so a platform operator using `/admin/organizations/new` today still cannot provision a hierarchical org through the product, only through a direct call. This is cheap to close (the server-side plumbing is already done) and belongs in `docs/TODO.md` as a named follow-up — see below. This is exactly the kind of thing Workflow Rule 15/14 doesn't cover, and it needs its own line, not a silent absorption into "no new UI, correctly out of scope" (the *pipeline's* scope excludes UI; Ruling 3's specific promise did not, and the promise is only half kept).
- The increment-3/increment-5 as-of collision (C2), `statistical_returns_submitted_is_self` (C3), the `'2024'`-hard-coded form version (C4), and withdrawal provenance added mid-flight (C5): all four were explicitly ruled on by the tech-lead as accepted behavior, verified in code (`presby_publish_sasr_snapshot():826-838` for C2's collision check; the `statistical_returns` CHECK for C3; `v_form_version constant text := '2024'` at `:714` for C4; `publications_freeze`/`withdrawn_by`/`withdrawn_minute_reference` for C5), and each carries a `docs/TODO.md` line for the pipeline that needs to act on it (error-mapping copy, a real field-mapping pass, etc.). Verdict: **acceptable drift**, correctly named and tracked, not silently absorbed.
- `organizations.status` kept rather than dropped (A1): reversed from the Data Model's original text for a real reason (five shipped `SECURITY DEFINER` functions gate public reads on it; Postgres tracks no function-body column dependency, so the drop would have shipped clean and broken every public site at request time). Verdict: **matches the corrected design** — this is exactly the kind of implementer-caught defect the pipeline exists to catch before it reaches production, and the corrected meaning (a fourth, narrow axis: public-site enablement) is documented in the same commit.
- `minute_reference`/`published_at` kept on `congregation_statistics` (Ruling 5) rather than moved per round 3's original text: verified in the DDL and the function body (`congregation_statistics` insert at `:969-993` still carries both, populated as copies of the same transaction's values). Verdict: **matches** — this is the correction of a design authority error Phase 2 caught before it broke `src/lib/presbytery.ts`'s live rollup query, not a drift from intent.

## Edge Cases

- Empty state: **not applicable** — no UI ships. The one visible-surface consequence (a new congregation with no lifecycle events, no affiliation history before the backfill) is exercised correctly by the completeness assertion (`drizzle/0044`'s `DO` block, re-verified standalone by QA at `test-rls.sql:3015` and `org-provisioning.test.ts:707`).
- Failure microcopy: **pass, at the DB layer, which is the layer this pipeline owns.** The uniform rejection message (`'organization_affiliations: this change is not permitted'`, `errcode = 'insufficient_privilege'`) is proven byte-identical across three distinct causes (unauthorized actor, nonexistent subject, no open affiliation) — QA measured this with length and md5 comparison, not a regex guess (`test-rls.sql:2867`, and again in the Finding-1 re-verification at `:3033` for the lifecycle table's own literal). The **human-readable** translation of these errors on an actual form (`setCongregationStatisticsAction`'s year-guard gap, Ruling B6; the publish-UI's five rejection branches, Ruling C2) is correctly named as owed to the pipelines that build those forms, not this one — both are in `docs/TODO.md` (lines 60, 61).
- Permission gate: **pass.** The one live consumer this pipeline is not allowed to break, `setCongregationStatisticsAction`, is absent from the diff entirely (QA confirmed by `git status`/`git diff --name-only`), which is Ruling 5's narrowed retrofit working exactly as intended. The one `"use server"` file actually in the diff, `createOrganizationAction`, keeps its pre-existing `auth()` + `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)` gate untouched; QA read the gate, not just its presence (`actions.ts:87-92`).
- Audit event: **pass.** `recordAudit(AUDIT_ACTIONS.ORG_CREATED, { ..., parentOrganizationId, relationshipType })` — the existing security-sensitive-mutation key, widened with the new facts, no new key minted (correct: this is the same mutation, not a new one). I read this at `actions.ts:210` and confirm the payload carries the parent.
- Mobile (360px): **not applicable.** No React ships in this pipeline (`'use client'` count: zero, confirmed by both the architect and QA independently).

## Follow-Ups (if SHIP WITH NOTES)

Already tracked in `docs/TODO.md` (verified present, not re-adding):
- Congregation working-draft surface deferred from `sasr_reports`' drop (`TODO.md:53`)
- `lifecycle.record`/`affiliation.record` permission keys, deliberately unseeded (`TODO.md:54`)
- `presby_organize_congregation()` + `presby_record_lifecycle_event()`, one function family, owed to the lifecycle-UI pipeline (`TODO.md:55`)
- `app.current_user_id` GUC, platform-wide need surfaced here (`TODO.md:56`)
- Real PII in `organization_profiles` on the shared dev branch, operator decision owed (`TODO.md:57`)
- `drizzle/0009:44`'s blanket `presby_platform` grant as F38's unremoved root cause, now touching five tables (`TODO.md:58`)
- `setCongregationStatisticsAction`'s missing year guard/error mapping for the about-org refusal (`TODO.md:60`)
- Publish-UI's owed error mapping, including the as-of collision (`TODO.md:61`)
- `congregation_statistics` and its `0038` siblings absent from `dev-docs.ts`'s `MODULES` map (`TODO.md:62`)
- `sasr_form_versions`'s three placeholder generations needing a real field-mapping pass before D13 import (`TODO.md:63`)
- CLAUDE.md note on `getPlatformDb()`/`neondb_owner` owning every privilege regardless of grant (`TODO.md:64`)
- `src/lib/rate-limit.test.ts`'s non-hermetic suite (QA Finding 2), already folded into the existing `TODO.md:198` line

**Not yet tracked — owed at this phase, per the architect's own Phase 2 scheduling and QA's Phase 5 findings:**

1. **The `CLAUDE.md` Key Invariants edit the architect explicitly scheduled for "Phase 6 and not before"** (Phase 2, "Does anything here require a CLAUDE.md change? Yes, exactly one") — the "Organizations are permanent too" paragraph under Never Hard-Delete a Person. I checked: it is not in `CLAUDE.md` today. This is not optional housekeeping the architect left open-ended; it was a ruling with a named trigger condition (this phase), and that condition has now arrived.
2. **The `docs/architecture.md` paragraph** the architect named as warranted under Workflow Rule 15 (a genuinely new subsystem — the three-axis organization model plus publication-as-event) — also not yet present. Same disposition: scheduled for this phase, not made.
3. **The functionality-map update (Workflow Rule 14)** — this pipeline changes no member-visible surface, but it does change the shape of `createOrganization()` and the organization model underneath every existing surface the map describes (org provisioning, presbytery oversight/statistics). Worth a one-line check against `docs/product/functionality-map.md` at housekeeping time even if the answer is "no line needs to change" — I did not find one already updated for this pipeline.
4. **The admin-organization-create form has no field for `parentOrganizationId`/`relationshipType`**, even though the server action and `createOrganization()` fully support it (see Intent-vs-Shipped Diff above). This is real, cheap-to-close drift from Ruling 3's stated goal ("hierarchical orgs remain provisionable on day one") — the plumbing exists, the control does not, so no platform operator can actually use it today without a raw call. Recommend a small, separate Polish/Feature-class follow-up to add the field (parent-org combobox + relationship-type select, conditionally shown) rather than treating the current state as done.
5. **QA's Finding 6** (the event-scope trigger's permissive null-context branch has no test) — real, named by QA as owed to the lifecycle-UI pipeline specifically, not generically. Should get its own `docs/TODO.md` line now rather than being left to memory, since it will be the first code that depends on that branch.
6. **Feedback-row / what's-new advisory (Workflow Rules 12/13):** confirmed not applicable. Nothing in the metadata block, Phase 1, or any later phase traces this pipeline to an in-app feedback row, and no member-visible behavior ships (schema/DDL only, zero `'use client'` files, the one live UI consumer unchanged). No `feedback` row to mark `done`; no `whats_new_entries` entry warranted.

None of these six rise to NEEDS REWORK — the shipped mechanism is correct, tested, and matches Phase 1's intent everywhere it mattered functionally. Items 1–3 are process debt against explicit prior rulings that named this exact phase as their trigger; item 4 is real but small and does not block the schema this pipeline exists to ship; item 5 is a coverage note, not a defect.

### Orchestrator housekeeping disposition (2026-09-24)

Items 1–3 actioned directly in the ship commit: `CLAUDE.md` (organizations-are-permanent paragraph under Never Hard-Delete; the testable sentence "no platform role acquires ecclesiastical authority merely by its position on the platform" under Two Hierarchies, promoted per the post-round-2 external note), `docs/architecture.md` (idea 4 extended with the three-axis model and publication-as-event), `docs/product/functionality-map.md` (schema and presbytery-statistics lines). Items 4 and 5 added to `docs/TODO.md`; the pipeline's own line moved to Done. Item 6 confirmed: no feedback row, no what's-new entry. Release notes v0.24.0.

### Orchestrator closure of the hardening loop-back (2026-09-24)

The external implementation review (F47–F53) was handled as a Phase 3 → 4 → 5 loop-back on the already-shipped, unreleased migrations: ruled (Phase 3 "Amendment after external implementation review" and "Ratification after the hardening pass"), built in place (Phase 4 "Loop-back after external implementation review"), and independently re-verified (Phase 5 addendum above, PASS). Shipped-vs-intent recheck for this loop-back, done by the orchestrator against the Phase 5 evidence rather than a fresh analyst pass because no user-visible surface changed: the two ratified deviations are stated accurately in the v0.24.1 release-notes entry (an affiliation may predate our records; the automated publish path names no attester yet), every other reviewer item is closed by the mechanism the ruling specified, and the residuals (identifiers INSERT ungated beyond the grant; the rollup's future withdrawn-row filter; the null-context branch test) are in `docs/TODO.md`. Committed as `fix(schema)` with `Caught-By: human-review`, `Discovered-In: post-merge`. The pipeline's verdict remains SHIP WITH NOTES.

---

# Phase 3 — Technical Design (tech-lead), continued

## Amendment after external review, round 2 (2026-09-24, tech-lead) — sixth Phase 3 loop-back

**Context.** `drizzle/0043`–`0047` are on `main` (`422d894`, being pushed) but still applied only to the `development` Neon branch — production has never run these five files, and the fourth/fifth loop-backs' `fix(schema)` correction (F47–F53, DECISION-140) is the same kind of migration-correction-in-place this loop-back is: same files, same numbers. The same external reviewer read the regenerated export after that correction and returned round two: two remaining database-contract blockers, two items deliberately left on the loop-back list (not blocking), and a withdrawal-decision confirmation. The reviewer's own closing sentence states a rule this pipeline already applied once, at F44/F49, generalized to a case that finding never reached: **"if an immutable record represents an authorized act, creation must be guarded as strongly as mutation."** F44 taught this pipeline that a grant edit binds nobody on the `getPlatformDb()` connection; F49 applied a GUC-gated guard trigger to `organization_affiliations`' *mutation* surface. What round two finds is that three tables' *creation* surface — `organization_lifecycle_events`/`organization_successions` as a pair, and the `statistical_returns` → `publications` → `congregation_statistics` chain — never got the equivalent treatment, because at the time each was hardened, "grant to SELECT/INSERT + a shape CHECK" looked sufficient for INSERT the way it never looked sufficient for UPDATE/DELETE. It wasn't a different judgment; it was an incomplete application of a rule already adopted. Findings are logged as **F54–F58** in `docs/schema-design-2.md` §2g. `docs/decisions.md` gets one new entry, **DECISION-141**.

**A verified fact worth stating before the rulings, because it changes the risk shape of items 1 and 2 to "correct the plumbing," not "brace for a live regression": nothing in this codebase writes to `organization_lifecycle_events`, `organization_successions`, `statistical_returns`, or `publications` from application code today** (confirmed by search: no non-test, non-`dev-docs.ts` reference to the first two tables anywhere in `src/`; the third and fourth are written only from inside `presby_publish_sasr_snapshot()` and `drizzle/0047`'s own backfill). `createOrganization()` writes only the initial `organization_affiliations` row, not a lifecycle event — confirmed, no code path in `src/lib/org-provisioning.ts` touches either table. `scripts/seed-dev.sql` inserts no row into either table. The only live writers of these four tables' rows are: the two SQL migrations' own backfills (statistical_returns/publications only), the `.test.ts` fixtures exercising the tables directly on the owner connection, and `presby_publish_sasr_snapshot()`. Every guard added below is therefore *zero-regression against any real caller* — the cost is entirely in updating direct-INSERT test fixtures to arm the new GUCs, which is real and is called out explicitly in the punch list, not a live application risk.

Also verified, per the facts block: `presby_publish_sasr_snapshot()` sets **no GUC at all today** — it is a `SECURITY DEFINER` function whose only current protection is that it runs as owner, with no transaction-local marker distinguishing its writes from any other owner-connection write. `presby.affiliation_trigger_active` is unrelated and untouched by it.

### Ruling 1 — `organization_lifecycle_events` + `organization_successions` are one immutable aggregate; INSERT is guarded, and cardinality is checked from both directions (F54)

Confirmed on both points, and the reviewer's own example targets `organization_successions` specifically (a later, unguarded `INSERT` of a third predecessor into an *already-valid* merge, which changes the act's meaning without violating cardinality) while the *second* hole — a `merged`/`divided` event committed with **zero** succession rows because the cardinality trigger only lives on `organization_successions` — is a `organization_lifecycle_events`-side gap the same finding covers.

**Mechanism, one aggregate, one sanctioned entry:**

1. **New GUC, `presby.lifecycle_write_active`**, transaction-local (`is_local => true`, same discipline as every other GUC in this pipeline). Armed exactly one place today: the future `presby_record_lifecycle_event()` (named in `docs/TODO.md` already) arms it at entry, before it inserts the event row and its succession rows in the same transaction. Nothing arms it yet, which means **both tables' INSERT is effectively closed until that function ships** — the reviewer's own fallback suggestion ("seriously consider making successions read-only outside migrations"), achieved as a side effect of gating the whole aggregate rather than as a separate rule, and with the plumbing already correct for the day the function lands (no second migration needed).
2. **New function `presby_guard_lifecycle_write()`**, `BEFORE INSERT`, reused across both tables (not two copies): checks `coalesce(current_setting('presby.lifecycle_write_active', true), '') = 'true'`; on failure, calls `presby_deny_lifecycle_change()` — the **existing** literal, reused rather than minted fresh. This is the affiliation/organizations reuse pattern (DECISION-139/140), not the identifier no-reuse pattern: the claim is identical ("this write is part of a sanctioned lifecycle act") across both tables, in the same transaction, for the same future writer — reuse is the minimum-complexity answer.
3. `create trigger organization_lifecycle_events_guard before insert on organization_lifecycle_events for each row execute function presby_guard_lifecycle_write();` and the equivalent `organization_successions_guard`, alongside the existing `organization_successions_event_scope` (unchanged — see the disposition on its permissive branch below) and the existing `organization_lifecycle_events_authority` (unchanged — the type-relationship check remains a second, independent layer, not replaced by the GUC).
4. **`createOrganization()` needs no change** — verified above, it never writes either table. **The backfills need no change** — verified above, neither `0044` nor any other migration inserts a fixture row into either table.
5. **Deferred `CONSTRAINT TRIGGER` on `organization_lifecycle_events` INSERT, closing the "zero-succession merge" hole directly.** Rather than duplicate `presby_check_succession_cardinality()`'s counting/raising logic in a second copy (drift risk — the two would have to be kept in step by hand forever), extract the shared logic into `presby_lifecycle_event_cardinality_check(p_event_id uuid) returns void`, `language plpgsql` (no `SECURITY DEFINER` needed — it is called from two `SECURITY INVOKER`-caller-adjacent triggers that already run in the writer's own transaction against a table the writer just touched, not across a foreign tenant's RLS), containing the existing count/raise body verbatim, parameterized on `p_event_id` instead of reading `new`/`old`. `presby_check_succession_cardinality()` becomes a thin wrapper (`v_event_id := coalesce(new.event_id, old.event_id); if v_event_id is not null then perform presby_lifecycle_event_cardinality_check(v_event_id); end if; return null;` — the "event gone" no-op move *into* the shared function, so both callers get it for free). New `presby_check_lifecycle_event_cardinality()`, `AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED` on `organization_lifecycle_events`, body `perform presby_lifecycle_event_cardinality_check(new.id); return null;`. Both triggers validate the same aggregate from opposite ends; in the ordinary case where both fire in one transaction they agree, and either one alone is sufficient to close a zero-child merge/division.
6. **The null-context permissive branch in `presby_check_succession_event()` is kept, not removed.** It is not moot: once the GUC guard is the actual gate, that branch stops being "the thing that lets an untethered owner-path insert through" and becomes what it always should have been — an actor-context integrity check for the writer that *does* get past the GUC (the future `presby_record_lifecycle_event()`, or a migration backfill that arms the GUC without an `app.current_org_id` context, which is a real shape: nothing sets org context outside a request). Removing it would require the branch to reject a null-actor insert outright, which breaks the only migration-time write shape this design has ever anticipated for these tables. No change to this function.

**A residual named, not fixed, because it is outside this finding's scope**: `presby_assert_council_authority()`'s type check (presbytery-over-congregation, synod-over-presbytery, etc.) validates organization-*type* compatibility between `new.organization_id` and `new.subject_org_id`, not that the two are actually affiliated via `presby_org_affiliated()` — so, RLS aside, any presbytery-typed org could satisfy the authority check for any congregation-typed org, correct type pairing regardless of real jurisdiction. `presby_set_organization_identifier()` already gets this right (`presby_org_affiliated()` is the actual standing check, not a type comparison). Folded into the existing `docs/TODO.md` line for `presby_record_lifecycle_event()`, which is the function that should close it, mirroring the identifier function's own shape — not solved in this hardening pass, which is schema-guard-only.

**Tests owed** (`test-rls.sql`, new subsection; `src/lib/db/domain/lifecycle.test.ts`): a grant-shape assertion is not the mechanism here (grants are unchanged) — instead, a failing-first proof that a raw owner-connection `INSERT` into each of the two tables, with the GUC unarmed, is rejected via the uniform lifecycle literal; a proof that arming `presby.lifecycle_write_active` (simulating the future sanctioned writer) permits a well-formed insert to both tables in one transaction, so the day `presby_record_lifecycle_event()` ships its plumbing is already proven correct; the reviewer's exact repro — commit a valid `merged` (A+B→C), then attempt a later, separate `INSERT` of a third predecessor row referencing the same event — proven rejected by the GUC guard (not by cardinality, which would still pass); a `merged`/`divided` event committed with the GUC armed but zero succession rows, proven rejected at commit by the new deferred constraint trigger on `organization_lifecycle_events`; a proof that `presby_check_succession_cardinality()`'s refactor is behavior-preserving (the existing cardinality assertions in `test-rls.sql` §32(j)-adjacent and `lifecycle.test.ts` must still pass unmodified in their pass/fail outcome, only their fixture setup changes to arm the new GUC first). **Every existing direct-INSERT call site into either table across `test-rls.sql` and `lifecycle.test.ts` (confirmed: 5 in the former, 15+ in the latter) must arm `presby.lifecycle_write_active` before its insert, or it will now fail for the wrong reason** (guard rejection, not whatever the test exists to prove) — this is the single largest line-count item in the Phase 4 punch list below, not new design surface.

### Ruling 2 — the return → publication → projection chain gets one sanctioned-write GUC, and `presby_publish_sasr_snapshot()` sets it today (F55)

Confirmed: `statistical_returns` and `publications` have `INSERT` revoked from both application roles (F50/F51), but revoking a grant does not bind `neondb_owner` (F44) and neither table has a `BEFORE INSERT` guard reading a sanctioned-write marker — the CHECK constraints prove *shape*, never *provenance*. A raw owner-connection `INSERT` satisfying `statistical_returns_provenance_shape` and the composite FKs is indistinguishable, at the database, from `presby_publish_sasr_snapshot()`'s own write.

**One GUC for the whole atomic operation**, not three: `presby.publication_write_active`. Per this pipeline's own reuse rule — same claim ("this row is part of one sanctioned publish operation"), and (for the submitted path) the same function, the same transaction — splitting it per table would be the identifier-table's no-reuse case misapplied to a case that is actually the affiliation-table's reuse case. **Imported returns share the same GUC, not a second `presby.import_write_active`.** D13's import function is future work and its exact shape is unknown, but whatever it turns out to be, the claim the guard exists to prove is identical regardless of `provenance` — "a sanctioned function wrote this, not a raw connection" — and a guard that OR's two GUCs together to mean the same thing is complexity with no additional protection. When the import function ships, it arms `presby.publication_write_active` too.

1. **New function `presby_guard_publication_write()`**, `BEFORE INSERT`, unconditional on `statistical_returns` and `publications`, `WHEN (NEW.provenance = 'published_by_congregation')`-scoped on `congregation_statistics` — **this is exactly how the guard distinguishes the live `presbytery_entered`/`imported` tenant-DML path from the sanctioned path it must not touch**: those two provenances are written by `setCongregationStatisticsAction` today, through ordinary tenant `INSERT` under RLS, and the `WHEN` clause means the new trigger is never even invoked for those rows — zero grant change, zero behavior change, on `congregation_statistics`. Checks `coalesce(current_setting('presby.publication_write_active', true), '') = 'true'`; on failure, raises via **new** helper `presby_deny_publication_write()` — one literal shared across all three call sites, following the same "one aggregate, one claim" reuse reasoning as Ruling 1, since the reviewer's own framing is that this is genuinely one atomic operation across three tables, not three unrelated ones.
2. `create trigger statistical_returns_guard before insert on statistical_returns ...`; `create trigger publications_guard before insert on publications ...` (alongside the existing `publications_freeze` and `presby_check_publication_supersession()` triggers, unaffected); `create trigger congregation_statistics_publication_guard before insert on congregation_statistics for each row when (new.provenance = 'published_by_congregation') execute function presby_guard_publication_write();`.
3. **`presby_publish_sasr_snapshot()` arms the GUC once**, immediately after its existing validation block (org context, report year, form version) and before its first `insert into statistical_returns` — one `perform set_config('presby.publication_write_active', 'true', true);` line, covering all three of its own inserts in the same transaction.
4. **`drizzle/0047`'s backfill `DO $$` block arms the same GUC**, once, before its `PASS 1` loop's two inserts (`statistical_returns`, `publications` — its `congregation_statistics` write is an `UPDATE` of `publication_id` on a pre-existing row, never an `INSERT`, so it is never in the new trigger's `WHEN`-scoped path and needs no arming for that table). Same-migration correction-in-place, same convention as every other in-place fix this file has already taken.

**Tests owed**: a failing-first proof that a raw owner-connection `INSERT` into `statistical_returns` and into `publications`, satisfying every existing CHECK/FK, is rejected with the GUC unarmed; a `WHEN`-scope proof that a raw `presbytery_entered`/`imported` `congregation_statistics` `INSERT` **still succeeds unmodified** (this is the regression proof that the live action keeps working, and the one the reviewer's own suggested fix would have broken if applied table-wide without the `WHEN` clause); a proof that a raw owner-connection `INSERT` into `congregation_statistics` with `provenance = 'published_by_congregation'` **is** rejected with the GUC unarmed (this is the reviewer's exact "false artifact" repro: same org for `organization_id`/`about_org_id`, `provenance = 'submitted'`, `reconciled = true`, plausible attestation — now stopped one step earlier, at the projection insert, in addition to at `statistical_returns`/`publications` themselves); a regression proof that `presby_publish_sasr_snapshot()` still succeeds end-to-end with the new guards live (it arms its own GUC, so this proves the arming call is correctly placed, not just present); a migration-apply smoke that the corrected backfill `DO` block still completes under the new guards (production carries zero rows in either table today, so this is a shape proof).

### Ruling 3 — the withdrawal pair is rejected on both tables until `presby_withdraw_publication()` exists (F56)

Confirmed, and ruled the reviewer's stated preference exactly: **until the pairing function exists, neither table's one permitted transition is reachable, on any connection.** `presby_freeze_publication()` and `presby_reject_published_statistics_write()` each already correctly permit exactly one transition and reject everything else about it (double withdrawal, partial-column withdrawal) — the gap is that each permits its own half *independently*, so a raw owner connection can withdraw one side of the pair and leave the other historical projection un-withdrawn, silently disagreeing with the publication it projects.

1. **New GUC, `presby.withdrawal_write_active`** — a **new**, not reused, GUC: the future `presby_withdraw_publication()` is a distinct function running in a distinct transaction, at a distinct point in time from `presby_publish_sasr_snapshot()`, so this is the identifier-table's no-reuse case (unrelated transaction, no claim to piggyback on), not the affiliation-table's reuse case.
2. `presby_reject_published_statistics_write()`'s one permitted `IF` branch gains one additional required conjunct: `and coalesce(current_setting('presby.withdrawal_write_active', true), '') = 'true'`. Falling through hits the function's existing `raise exception` unchanged — the message ("published rows are immutable... the only permitted UPDATE is a single withdrawal") is slightly imprecise about *why* today (no sanctioned writer exists yet, not "withdrawal is categorically forbidden"), but reusing it is consistent with this pipeline's existing practice of a stable per-table literal and is not worth a second message for a state that is itself temporary.
3. `presby_freeze_publication()`'s final permitted-transition check (currently: reject if `new.withdrawn_at is null`, else `return new`) gains the same conjunct, checked immediately before that `return new`: fail closed with the function's existing exception vocabulary if `presby.withdrawal_write_active` is not `'true'`.
4. **Nothing arms this GUC today** — by design. When `presby_withdraw_publication()` ships (publish-UI pipeline, already in `docs/TODO.md`), it arms `presby.withdrawal_write_active` once and performs both tables' `UPDATE` in the same transaction, which is exactly the "both freeze triggers permit exactly that pair of transitions" design F52 already committed to — this ruling only removes the ability to perform *half* of that pair before the function exists.

**Tests owed**: a failing-first proof that a raw owner-connection `UPDATE` performing the one previously-permitted `congregation_statistics` transition (`withdrawn_at` null → set, nothing else) now fails with the GUC unarmed; the equivalent proof for `publications`' withdrawal triple; a proof that arming `presby.withdrawal_write_active` manually (simulating the future function) permits each transition individually, so the guard is proven not to have also broken the shape the future function depends on; no "legitimate path still works" regression proof is owed beyond that, since no legitimate caller of either transition exists yet.

### Ruling 4 — attestation identity and `recorded_by`: documentation precision, no new mechanism (F57)

Ruled as asked: a documentation correction to D21/F50's text, not a schema change. Today the database can prove a `submitted` `statistical_returns` row was attested **at a time** (`attested_at`) but not **by whom** — `attested_by_name`/`attested_role` are excluded from the provenance-shape CHECK (F50, ratified) precisely because `presby_publish_sasr_snapshot()` has no acting-user identity to draw one from, and accepting a caller-supplied name would be the exact confused-deputy identity claim this pipeline's functions already refuse elsewhere. D21's "frozen attested submission" language is corrected to say so explicitly: attestation is *timestamped*, not yet *attributed*, and stays that way until `app.current_user_id` exists. Separately, `organization_lifecycle_events.recorded_by` is `NOT NULL` today while the only value any caller can supply is a caller-provided UUID — there is no trusted-context source for it yet, the same gap by a different name. **Both fold into the single existing `docs/TODO.md` line for the `app.current_user_id` GUC** (the line already carries the `statistical_returns` half, per the fifth loop-back's ratification of F50); this ruling adds the explicit instruction that the *future* `presby_record_lifecycle_event()` must take `recorded_by` from that trusted GUC once it exists, never as a parameter — the same rule already stated for `presby_transfer_affiliation()`'s `closed_by`/`recorded_by` and now stated once more so the third occurrence of the identical gap doesn't get treated as a fresh discovery.

### Ruling 5 — `organization_identifiers` INSERT closes now, for consistency, not because it was independently urgent (F58)

The reviewer explicitly calls this non-blocking; ruled to close it anyway, per the orchestrator's read of the reviewer's own closing rule applied uniformly, and because the cost here is essentially zero: `presby_set_organization_identifier()` already arms `presby.identifier_trigger_active` **at entry**, before either its `INSERT` or its `UPDATE` branch (`drizzle/0043:213`) — extending the existing guard trigger's operation list from `BEFORE UPDATE OR DELETE` to `BEFORE INSERT OR UPDATE OR DELETE` requires no change to `presby_guard_organization_identifiers()`'s body (its `tg_op = 'DELETE'` branch already falls through correctly for `INSERT`, returning `new`) and no change to the sole sanctioned writer. Verified zero live callers outside it: `createOrganization()` never touches `organization_identifiers`, `scripts/seed-dev.sql` inserts no row into it, and `drizzle/0043`'s own `pcusa_pin` backfill (`DO $$` block, section 2) runs and completes **before** the guard trigger is even created later in the same file (section 4) — migration ordering, not a GUC, protects that one-time move. The trigger's own comment block, which currently argues at length for narrower scope ("Engineering a bootstrap-vs-tenant distinction into an INSERT guard is more machinery than today's problem needs"), is corrected in place to record that the distinction turned out to need no machinery at all once the sanctioned writer already armed the GUC unconditionally.

**Tests owed**: a failing-first proof that a raw owner-connection `INSERT` (with a non-colliding `value_normalized`, so only the guard — not the existing unique index — is what would otherwise let it through) is rejected with the GUC unarmed; a regression proof that `presby_set_organization_identifier()`'s own `INSERT` branch (a brand-new `(organization_id, kind, value_normalized)` triple, not the `UPDATE` branch) still succeeds.

### Ruling 6 — nothing else found

Beyond the residual named under Ruling 1 (the authority check's type-only standing, folded into the existing `presby_record_lifecycle_event()` TODO line) and the two items the reviewer itself left as informational rather than blocking (both ruled on above, in Rulings 4 and 5), no further gap surfaced in this pass. The reviewer's closing rule — creation guarded as strongly as mutation — is now applied to every table in this pipeline that represents an authorized act: `organizations` (F38/DECISION-136), `organization_affiliations` (F49), `organization_lifecycle_events`/`organization_successions` (F54, this loop-back), `statistical_returns`/`publications`/`congregation_statistics`'s published branch (F55, this loop-back), the withdrawal pair (F56, this loop-back), and `organization_identifiers` (F58, this loop-back). `sasr_form_versions` is deliberately not on this list: its `INSERT` is seed/reference-data provisioning, not the recording of a minuted act, and F53 already closed its only authorized-act-shaped surface (redefining a spec once relied upon).

### Commit framing

One `fix(schema):` commit, migration-correction-in-place shape (same files, same numbers — `drizzle/0043`–`0047`), matching the convention F46 and F47–F53 both already established for this pipeline. Trailers: `Caught-By: human-review`, `Discovered-In: post-merge`, `Work-Log: 2026-09-24-lifecycle-affiliation-returns`. `docs/TODO.md`'s reconciliation (open items 54/55/108/109 reworded to match this ruling; item 108 — the identifiers INSERT residual — retitled from "accepted residual" to "ruled closed, awaiting Phase 4"; a new In Flight line tracks this loop-back) lands in this ruling's commit; item 108's actual flip to Done, and this loop-back's In Flight line closing, are database-admin's to make in the Phase 4 commit that builds it, per Workflow Rule 10's "same commit as the work." Release notes: `docs/release-notes/v0.24.2.md` (Fix) — draft below.

**Implementer: database-admin.** Schema-only (two new GUCs plus one reused, five new/widened trigger functions across four tables, one refactor extracting shared cardinality logic, two `set_config` calls added inside existing `SECURITY DEFINER` functions, one migration-comment correction) — no route handler, server action, or UI surface is touched by any of the six rulings above. The bulk of the implementation cost is **test-fixture updates**, not new schema surface: every existing direct-INSERT test call site into `organization_lifecycle_events`/`organization_successions` (both `test-rls.sql` and `lifecycle.test.ts`) must arm `presby.lifecycle_write_active` before its insert, or it fails for the wrong reason once the new guard ships.

## Per-Phase Status (sixth loop-back)

Phase 3 row: **amended a sixth time**, ruling F54–F58 (round-two external post-merge review) and routing to database-admin as a migration correction in place to `drizzle/0043`–`0047`. Design complete; no architectural or functional re-opening — every ruling above is schema-guard mechanism, consistent with the placement and invariants Phase 2 already approved.

## Ratification after hardening round two (2026-09-25, tech-lead) — seventh Phase 3 loop-back

Read against "Loop-back after external review, round 2 (2026-09-25, database-admin) — COMPLETE" above (its Implementer Notes, the three spec-item resolutions, the "Follow-on item" call-site inventory, and Findings 1–5 including 4a) and this section's own sixth-loop-back rulings. QA is verifying concurrently; this ratification does not touch code. Findings logged as a correction to F55 in `docs/schema-design-2.md` §2g ("Ratification after hardening round two"); `docs/decisions.md` DECISION-141 gains the matching correction paragraph.

**1 — the seed arming, corrected.** Accepted. The facts block behind Ruling 2 and DECISION-141 said "`scripts/seed-dev.sql` inserts no row into either table," true only of the two lifecycle tables and false of the publication chain: the seed writes `statistical_returns` (`:1374`), `publications` (`:1386`) and a `published_by_congregation` `congregation_statistics` row (`:1399`), all inside its one transaction, and now arms `presby.publication_write_active` once before them. This was a Phase 3 spec defect (an unverified claim about an existing fixture file, exactly the class of thing "grep before naming the implementer" exists to catch), caught instead by the implementer running the seed in a rolled-back transaction. No Phase 4 change follows — the arming line built is correct — but the design record is corrected so a future reader doesn't inherit the wrong fact. `presby.publication_write_active` is armed at **three** sites, not two: `presby_publish_sasr_snapshot()`, `drizzle/0047`'s backfill, and the seed. Canonical list (all three GUCs, all arming sites) recorded in `docs/schema-design-2.md` §2g.

**2 — the `publications` withdrawal literal.** Accepted: a new in-function literal, not a shared helper. Ruling 3 left the exact wording open ("the function's existing exception vocabulary"), and `presby_freeze_publication()` cannot share a single reusable "publications" string across its five distinct rejection branches (DELETE-refused, immutable-field-changed, already-withdrawn, malformed-withdrawal-triple, and now the sanctioned-writer conjunct) without turning the helper into a parameterized wrapper used by exactly one caller — more machinery for no reuse. F40's uniform-literal rule does not apply here and was never meant to: it guards a caller who does not already hold the row (an EXCLUDE constraint or a creation-guard probed with an *identifying tuple*) from learning existence via distinguishable errors; every branch of `presby_freeze_publication()` fires on `UPDATE … WHERE id = old.id`, so the caller already named the row before the function ran. **The rule for `publications` as it now stands: one literal per distinct refused reason on this function, not one literal for the whole table** — the table's mutation surface has always used that discipline (four literals before this ruling, five after), and F56's new literal is the fifth instance of an existing pattern, not an exception to it. `congregation_statistics`' withdrawal half keeps its single existing literal, exactly as Ruling 3 directed, because that function only ever had one rejection branch to begin with — the two halves differing in literal count was never itself the deviation; only the specific wording of the new one was open, and it's now closed.

**3 — `publication.test.ts:980` split.** Accepted. Its original assertion regex was loose enough to match the *new* unarmed-writer rejection after F56 shipped, which would have kept the test green while it silently stopped proving the shape CHECK it was written for — a false-pass, not a false-fail, and the more dangerous direction for a regression suite to fail in. Splitting it into the shape probe (now armed, matching `publications_withdrawal_shape` alone) and a new well-shaped-but-unarmed probe (matching the guard's literal) is the correct fix and needs no further change.

**4 — the follow-on revoke and its coupling.** Accepted as Ruling-1-consistent: Finding 1 named a real residual (a GUC any role can `set_config`, on a table where `presby_app` held both the arming path and an unused INSERT grant), and revoking that unused grant closes it at zero cost to any real caller — nothing in `src/` writes `organization_lifecycle_events` today, confirmed in this same loop-back's own facts block. The consequent revoke of `presby_deny_lifecycle_change()`'s and `presby_lifecycle_event_cardinality_check()`'s `presby_app` EXECUTE grants follows necessarily (neither function remains reachable by `presby_app` once the INSERT they guard is gone) and is likewise ratified. **Yes, the coupling is recorded where the next implementer will see it, at two independent locations**: inline at both revoke sites in `drizzle/0044` (per the Handoff section above, "both revoke sites in `drizzle/0044` say so inline"), and in this work-log's own Handoff section, which states the rule in prose ("If a ruling ever does, `presby_deny_lifecycle_change()` and `presby_lifecycle_event_cardinality_check(uuid)` must regain their `presby_app` EXECUTE grants in the same migration"). A third copy is now in `docs/schema-design-2.md` §2g and `docs/decisions.md` DECISION-141's correction paragraph, so the coupling survives even a reader who never opens `drizzle/0044` itself.

**5 — B-M1's final shape.** Ratified as built: nine revokes (1 in `0043`, 5 in `0044` after the follow-on flips its two prior keeps to revokes, 2 in `0045`, 1 in `0046`), one deliberate keep (`presby_deny_publication_write()` in `0046`, reachable by `presby_app` because that role still holds live INSERT on `congregation_statistics` for the two non-published provenances), and `presby_apply_affiliation_to_org_tree()` arming `presby.affiliation_trigger_active` immediately before its first `UPDATE` rather than as its opening statement — a strict improvement (a rejected call no longer leaves the marker armed for the rest of the caller's transaction) that needed no separate ruling to authorize.

**6 — B-M2.** Ratified as built: `set search_path = public` on all 21 `SECURITY DEFINER` functions across `drizzle/0043`–`0047`, in the precedent form already established at `drizzle/0013:56`; the three new guard functions (`presby_guard_lifecycle_write()`, `presby_guard_publication_write()`, and the identifier guard's existing body) are correctly excluded as `SECURITY INVOKER` — they read a GUC and no table, so there is no privilege-escalation surface for a hijacked `search_path` to exploit.

**7 — Finding 1's residual on `congregation_statistics`.** Accepted, not fixed, exactly as Ruling 2 anticipated: the `WHEN (new.provenance = 'published_by_congregation')` clause is the deliberate boundary between the sanctioned-publish path and the live tenant path `setCongregationStatisticsAction` uses, and `presby_app`'s continuing INSERT grant on that table (for `presbytery_entered`/`imported`) means the marker-is-not-a-privilege gap Finding 1 named cannot be closed on this one table without also closing a shipped, member-facing write path — out of scope for this ratification. The FK to `publications` is named as the real (if narrower) backstop today, consistent with Finding 2's own framing.

**8 — Finding 4a, guard predicate: not changed now, for a stated reason, not silently deferred.** The `docs/TODO.md` line (added by the round-two implementer) stays open; the guard predicate in `presby_guard_organizations_delete()` is untouched. Ruled: this pipeline's declared scope is the four rulings above (F54–F58) plus the security review's two orchestrator additions — none of them touches the organization-deletion guard, and widening or narrowing a delete-refusal predicate that exists to make a *time-boxed* fixture exemption non-permanent is a security-relevant change to a Key-Invariant-adjacent trigger, not a rider to bolt onto an unrelated ratification. It also isn't obviously a schema fix at all: Finding 5 (two pipelines sharing one Neon branch produces the crash-orphan pattern in the first place) points at an operational cause, which argues for the branch-per-pipeline option over a guard-predicate change — but choosing among the sweeper, the wider predicate, and branch-per-pipeline is itself a decision with tradeoffs against the same invariant (permanent records are permanent; the fixture exemption is the one deliberate, narrow exception), and deserves its own scoped pass rather than an amendment tacked onto this one's coattails.

**Nothing above requires a Phase 4 change.** Every item is either a documentation/design-record correction (1, 2 partially — the literal itself was already built correctly), a confirmation of what was built (2's rule statement, 3, 5, 6), a ratification of a decision already made and built mid-task (4, 7), or an explicit, reasoned deferral (8). Phase 4 remains complete as reported; the next step is QA's Phase 5 re-verification of the round-two build, already in progress.

## Per-Phase Status (seventh loop-back)

Phase 3 row: **ratified a seventh time**, confirming database-admin's round-two build (F54–F58, B-M1, B-M2, and the Finding 1 follow-on revoke) with one factual correction (the seed's third arming site) and no Phase 4 loop-back. Design complete and unchanged in substance; `docs/schema-design-2.md` §2g and `docs/decisions.md` DECISION-141 both amended in place to match. Next: qa (Phase 5 re-verification, concurrent).

## Ruling on QA-1/QA-2 after hardening round two (2026-09-25, tech-lead) — eighth Phase 3 loop-back

QA's re-verification of the round-two build (recorded above, "Re-verification after hardening round two") returned every suite green but escalated two **design claims** — not implementation defects — to Phase 3: QA-1 against `drizzle/0044:1338`'s claim about `presby.lifecycle_write_active`; QA-2 against `drizzle/0047:323-326` and `scripts/test-rls.sql:4728`/`:4737`'s claim about the withdrawal pair's tenant-side reach; QA-3, a citation typo. Read against `drizzle/0044` §12a/13a2, `drizzle/0047` §3b/§6, `scripts/test-rls.sql` §35(d), `src/lib/db/domain/lifecycle.test.ts`'s `armLifecycleWrite`/`disarmLifecycleWrite` fixtures, and `src/lib/presbytery.ts`'s `setCongregationStatistics()`. This is the last correction round on `drizzle/0043`–`0047`: no further design defect is expected after database-admin's ninth pass.

### Ruling 1 (QA-1) — the lifecycle marker binds to the declared act, not to "any act, globally"; full cross-transaction closure is declined and named as an accepted residual

**Confirmed as a real defect in the claim, not in the mechanism's live exposure.** `drizzle/0044:1338`'s comment says the GUC-gated guard "is the trigger that stops the reviewer's exact repro: a later, separate INSERT of a third predecessor edge into an already-valid, already-committed `merged` event." That is false as built: `presby_guard_lifecycle_write()` (`drizzle/0044:1144`) checks only `coalesce(current_setting('presby.lifecycle_write_active', true), '') <> 'true'` — a boolean, transaction-local, self-armable sentinel carrying no reference to *which* act it authorizes. Any later, separate transaction that re-arms the same sentinel and inserts a third `organization_successions` row against an already-committed event id passes every existing check: the guard (armed), the event-scope trigger (`presby_check_succession_event()`, the event exists and — on a context-less connection — the actor comparison is skipped by design), and cardinality (3 ≥ 2 is still valid). **No live exposure today**, confirmed independently: `presby_app` holds `SELECT` only on both tables as of the 2026-09-25 narrowing (`drizzle/0044:235`, `test-rls.sql` §35(a)), so the only connection that can ever reach this guard is an owner-level one (`neondb_owner` via `PLATFORM_DATABASE_URL`/migrations, or the future `presby_record_lifecycle_event()` running `SECURITY DEFINER` as that owner). The defect is that the comment overclaims a guarantee the mechanism doesn't provide, which the future writer's author would otherwise inherit as settled fact.

**Accepted: bind the marker to the specific event id.** `presby.lifecycle_write_active` stops carrying a boolean and instead carries the `organization_lifecycle_events.id` (as text) the current transaction is recording. `presby_guard_lifecycle_write()` is rewritten to branch on `tg_table_name`: on `organization_lifecycle_events`, require `new.id::text = <armed value>`; on `organization_successions`, require `new.event_id::text = <armed value>`. Both branches raise through the **existing** `presby_deny_lifecycle_change()` literal — no new message, preserving F40's one-claim-one-literal discipline (DECISION-139/141) — the failure is still "this change is not permitted," regardless of which of the three sub-reasons (unarmed, wrong table, wrong id) produced it. This is a real, contained improvement: it converts "some sanctioned act is in progress" into "this specific row belongs to the act now being recorded," which is what `presby_record_lifecycle_event()`'s own contract (generate one fresh id, insert the event and its successions in one transaction, never accept a caller-supplied id for an existing act) will always satisfy by construction, and it is now machine-testable (Ruling 4 below).

**Declined: closing the case where a later transaction re-arms the marker to a pre-existing event's own id.** This is the literal shape of QA's repro and id-binding alone does not refuse it — the id isn't secret (`presby_app` holds `SELECT` on both tables; an owner connection can read anything), so an actor who deliberately arms the marker to the *target's own* id satisfies the new check trivially. Closing that fully requires the guard to additionally prove the referenced event row was created **in the current transaction** (there is no other way to distinguish "being assembled right now" from "already settled" without persistent per-event state) — in Postgres terms, a same-transaction check against the row's `xmin`/`pg_current_xact_id()`, which would require converting `presby_guard_lifecycle_write()` from `SECURITY INVOKER` (correct today, per its own comment: it reads no table) to `SECURITY DEFINER` reading `organization_lifecycle_events` under F26's exact discipline (an invoker read of a FORCE-RLS table on the context-less path it exists to protect returns zero rows for exactly the case it guards). That is a structural change to a function this file explicitly documents as deliberately `INVOKER` (`drizzle/0044:1078-1082`, `test-rls.sql:4714-4721`, B-M2's "three GUC-only guards stay INVOKER" catalog assertion), unprecedented anywhere in this schema (no `xmin`/`pg_current_xact_id()` idiom exists today — checked by grep), and — the reason it is declined rather than merely deferred for cost — **it does not close the actual threat model**. Every guard in this migration family is already, by this document's own standing rule (F44), only a proof-of-sanctioned-path for a *cooperating* owner-level connection: a truly adversarial one can `alter table ... disable trigger` and bypass the guard outright, exactly the escape hatch `drizzle/0047:554` uses deliberately for its own backfill. Same-transaction binding raises the bar against an accidental/buggy re-open (which id-binding already forecloses, since the honest writer never has occasion to arm a pre-existing id) but adds no real barrier against a deliberate one. Building `SECURITY DEFINER` machinery and a new Postgres idiom, in the declared last correction round, to close a gap that (a) has no live exposure, (b) can only ever be reached by an owner-level actor, and (c) that actor could defeat by DDL regardless, is a worse trade than naming the residual precisely.

**Residual, named for the record (not the same as QA-1's ask, and said so plainly):** a raw owner-level connection (or a future `presby_record_lifecycle_event()` called with a bug that supplies a stale id, which its contract as designed will never do) can still re-arm `presby.lifecycle_write_active` to an already-committed event's id and append a further `organization_successions` row to it. This is the same accepted-residual class F44 already names throughout this pipeline (grants and triggers bind cooperating connections, not the table owner) and is folded into the existing `docs/TODO.md` line for `presby_record_lifecycle_event()` — closing it for real, if it's ever judged worth the cost, is a schema change (a persistent "settled" marker or transaction-boundary check) for that function's own scoped design pass, not a bolt-on here.

**No `'*'` wildcard for migration/backfill context.** A future backfill inserting multiple historical lifecycle events in one transaction re-arms the GUC to each event's own id immediately before that event's own insert (and its successions), exactly mirroring the runtime writer's contract — one mechanism, no special case, consistent with this file's own "one GUC, one claim" discipline (DECISION-139/141). No migration or fixture writes either table today (confirmed unchanged since Ruling 1's zero-regression check), so this costs nothing live.

### Ruling 2 (QA-2) — column-level privilege narrowing on `congregation_statistics`, refining QA's proposed shape and closing an adjacent, previously-accepted residual for free

**Confirmed, and worse than the comment stated.** `drizzle/0047:323-326` claims the withdrawal transition "is unreachable on every connection until the writer ships." False for `presby_app` specifically: `drizzle/0038:280` granted `presby_app` `select, insert, update, delete` on the whole `congregation_statistics` table, and that grant was never narrowed by F55/F56 — both of which added a GUC-gated *trigger*, and a GUC is `set_config`-able by any role with no privilege check at all. `presby_app`, holding a bare `UPDATE` grant, can arm `presby.withdrawal_write_active` itself and successfully `UPDATE congregation_statistics SET withdrawn_at = now() WHERE id = …` on a row it owns under RLS — exactly what `test-rls.sql:4540-4549` performs and asserts as *success*, three sections after `:4728`/`:4737` assert the opposite for "nothing in the database." The claim conflated "nothing **arms** it" with "nothing **can**," and `presby_app` needs no help arming a GUC.

**Accepted, QA's mechanism adopted with one refinement.** QA's candidate — revoke `UPDATE` on the table, grant it back on every column except `withdrawn_at`/`publication_id` — is correct and is adopted **as proposed, on both `INSERT` and `UPDATE`**, not narrowed further to only `setCongregationStatistics()`'s live column list. This is a deliberate choice, not an oversight: `setCongregationStatistics()`'s `values` object (`src/lib/presbytery.ts:640-660`) touches only 18 of the table's ~90 non-key columns, and every SASR demographic/financial column (`gender_*`, `age_*`, `race_*`, `disability_*`, `youth_*`, `receipts_*`, `exp_*`, `budgeted_*`) is already grantable today and untouched by the live write path — narrowing the grant to exactly what's used today would silently foreclose columns that are schema-complete v1 fields with no application code yet, a materially larger and unrelated scope question (v1 SASR field coverage, D13's import function) that deserves its own pass, not a rider on this ruling (Ruling 8's own precedent, seventh loop-back: "deserves its own scoped pass rather than an amendment tacked onto this one's coattails"). Excluding only the two columns QA identified is the minimum change that closes the actual finding without touching anything else.

**Applied to `INSERT` as well as `UPDATE`, closing a second, previously-accepted residual for free.** The seventh loop-back's ratification (Finding 1's residual, item 7) accepted that `presby_app`'s `INSERT` grant on `congregation_statistics` lets it self-arm `presby.publication_write_active` (F55) and attempt a fabricated `published_by_congregation` row, and declined to close it because doing so "cannot be closed... without also closing a shipped, member-facing write path" — true of `provenance` and the columns the live `presbytery_entered`/`imported` path needs, but **not** true of `publication_id`, which the live path never sets on `INSERT` either. Revoking `INSERT` on `publication_id` from `presby_app` (alongside `withdrawn_at`, symmetric and costless) means a fabricated `published_by_congregation` row is refused two ways: supply `publication_id` explicitly → permission denied for the column before any trigger runs; omit it → `congregation_statistics_publication_shape`'s CHECK (`drizzle/0047:787-789`, `(provenance = 'published_by_congregation') = (publication_id is not null)`) refuses the null. This makes `congregation_statistics`'s exposure on this branch structurally identical to its two sibling tables in the F55 chain (`statistical_returns`, `publications`), which already hold no `INSERT` grant for `presby_app` at all. Item 7's residual is therefore **closed**, not merely narrowed, as a consequence of this ruling — `docs/schema-design-2.md` §2g is corrected accordingly rather than left to say "accepted, out of scope."

**`presby_platform` is untouched**, per the F47 precedent already established for this exact role ("`presby_platform` keeps its DML grant, same accepted-risk class as its grants elsewhere in this pipeline") — narrowing it is not part of this ruling and is not implied by it.

**Mechanical note for database-admin, not a design question:** Postgres column-level privileges are additive on top of a table-level grant, never subtractive — `revoke insert (publication_id) on … from presby_app` while the table-level `INSERT` grant still stands does **not** remove the privilege. The correct sequence is `revoke insert, update on congregation_statistics from presby_app;` followed by `grant insert (<all columns except withdrawn_at, publication_id>), update (<same list>) on congregation_statistics to presby_app;`. Generate the column list from the catalog (`information_schema.columns`) rather than hand-transcribing ~90 names.

### Ruling 3 (QA-3) — citation fix

`drizzle/0047:325` cites "scripts/test-rls.sql section 39"; the probes are in section 35(d) (`test-rls.sql:4382` onward). Corrected in place as part of the Ruling 2 comment rewrite (the same lines are being edited for Ruling 2's substance).

### Ruling 4 — coverage

Both of QA's named gaps are real and neither is satisfied by an existing test:

- **QA-1's gap.** `lifecycle.test.ts:759` ("refuses a THIRD predecessor added to an already-valid merge — the reviewer's exact repro") is, on inspection, **not** the reviewer's repro: it disarms the marker (`disarmLifecycleWrite`) and inserts within the *same, uncommitted* transaction, which its own comment admits is a stand-in ("a committed lifecycle event is permanent and would block the fixture teardown"). It proves "unarmed is refused," a property Ruling 1's id-binding doesn't change. Required, in the achievable form Ruling 1 actually builds: (a) a test that, within one legitimately armed transaction recording event X, an `organization_successions` insert declaring a **different** `event_id` (Y — an existing committed fixture event, or any other value) is refused, proving the binding is per-declared-act; (b) a test that arming to id X and inserting into `organization_lifecycle_events` with a **different** explicit `id` value is refused (the events-table branch, not just the successions-table one); (c) every existing `armLifecycleWrite`/`disarmLifecycleWrite` call site (24, by grep) updated to the id-carrying contract — the helper takes the event id being written, and every events-table insert in the suite supplies that id explicitly (client-generated, e.g. via a UUID helper) rather than relying on the column default, since the guard now compares against a known value armed *before* the insert. **Not required, and named as accepted per Ruling 1's decline:** a test proving refusal of an armed re-open of an event committed in a genuinely separate, prior transaction — that property is not built, so a test for it would either fail correctly (documenting the residual) or require the same fixture-teardown workaround this exact test already flags as unavailable to this suite. If database-admin judges the residual worth documenting as a red (expected-fail, skipped) test rather than prose alone, that is an implementer's call, not a Phase 3 requirement.
- **QA-2's gap.** Required: (a) `has_column_privilege('presby_app', 'congregation_statistics', 'withdrawn_at', 'UPDATE')` and `('publication_id', 'INSERT')` both assert `false`; a positive control column (e.g. `minute_reference`) asserts `true` for both, proving the narrowing is real and correctly scoped, not over-broad. (b) `test-rls.sql`'s existing `:4500-4517` armed-success test for the *identical projection write* (F55, `presby.publication_write_active`, a `published_by_congregation` row with every live column set) is unaffected by this ruling and must still pass unchanged — it doesn't touch `withdrawn_at`/`publication_id`. (c) The `:4540-4549` block (armed withdrawal `UPDATE` "succeeds" as `presby_app`) must be **replaced**, not left in place: after this ruling it fails at the grant layer regardless of arming, which is the point — rewrite it to assert `permission denied for column withdrawn_at` (or equivalent) even with the GUC armed, proving the column grant — not the trigger — is now the real gate for this connection. (d) `:4524-4535` (unarmed `UPDATE` refused) changes character too: the failure now occurs at the grant layer before the trigger ever runs, so its `exception when check_violation` handler will not catch the new error; update it to expect the privilege error, and add a comment noting the trigger's `check_violation` branch is proven separately, on the owner connection, in `src/lib/db/domain/publication.test.ts` (which already exercises the armed-transition-succeeds case correctly there, per its existing test at `publication.test.ts:688-750` — that test needs **no change**, since owner-level `UPDATE` was never grant-gated and remains the connection the future `presby_withdraw_publication()` will use). (e) A parallel pair of assertions for the `INSERT`/`publication_id` closure: `presby_app` cannot `INSERT` a `published_by_congregation` row (permission denied when `publication_id` is supplied; check-violation on `congregation_statistics_publication_shape` when it's omitted), replacing/superseding the seventh loop-back's "accepted, out of scope" framing for item 7.

**Nothing above requires a Phase 2 or Phase 1 loop-back** — both rulings stay inside Phase 3/4: Ruling 1 is a trigger-body and comment correction plus fixture updates; Ruling 2 is a grant-narrowing plus fixture updates; neither changes an API contract, a permission/flag, or the shipped `setCongregationStatistics()`/`presby_publish_sasr_snapshot()` behavior.

### Punch list for database-admin (ninth Phase 4 pass)

1. `drizzle/0044:1144-1156` (`presby_guard_lifecycle_write()`): rewrite to compare `new.id`/`new.event_id` against the armed value per Ruling 1; keep raising via `presby_deny_lifecycle_change()`. Correct the `drizzle/0044:1090-1131` (§12a) and `:1333-1343` (§13a2) comment blocks to state the actual guarantee and the named residual (Ruling 1), not the overclaim.
2. `src/lib/db/domain/lifecycle.test.ts`: update `armLifecycleWrite`/`disarmLifecycleWrite` (`:259-280`) to the id-carrying contract; update all 24 call sites (grep `armLifecycleWrite(` for the current list) so every `organization_lifecycle_events` insert supplies an explicit, client-generated `id` armed immediately before it; rewrite `:759` and `:811`'s pair per Ruling 4's (a)/(b); the `:850` positive-control test keeps its shape, armed to its own event's id instead of `'true'`.
3. `drizzle/0047:308-344` (`presby_freeze_publication()`) and the `withdrawn_at` column comment (`:895-896`): no trigger-body change (the conjunct is correct and unaffected), but correct the "unreachable on every connection" claim per Ruling 2 and fix "section 39" → "section 35(d)" (Ruling 3).
4. `drizzle/0047`: add the `revoke`/`grant (column list)` pair from Ruling 2 for `congregation_statistics` `INSERT`/`UPDATE`, appended in place (0047 has not shipped to production — confirm before appending, per this pipeline's established migration-correction-in-place convention).
5. `scripts/test-rls.sql` §35(d) (`:4500-4563`): replace `:4540-4549` and update `:4524-4535` per Ruling 4's (c)/(d); add the `has_column_privilege` assertions from Ruling 4's (a) and (e).
6. `docs/TODO.md`: fold Ruling 1's named residual into the existing `presby_record_lifecycle_event()` line (do not add a new line — Rule 10 housekeeping happens at ship time, not mid-pipeline; this note is for database-admin's awareness, not an instruction to edit `docs/TODO.md` now).
7. Re-run `test-rls.sql` and the DB-backed vitest suite; confirm `setCongregationStatistics()`'s live path (`presbytery.test.ts`) is unaffected by the column-grant narrowing.

# Phase 4 — Implementation (database-admin), continued

## Ninth pass — QA-1/QA-2 corrections (2026-09-25, database-admin)

Built against the punch list in "Ruling on QA-1/QA-2 after hardening round
two". **Migration mode: hand-written SQL, corrected in place** in
`drizzle/0044_presby_org_lifecycle.sql` and
`drizzle/0047_presby_publications.sql` — confirmed unreleased to production
first (`docs/STATE.md` → Durable facts: "Production has not been migrated past
migration `0047`"; and the 2026-09-24 entry: applied and proven on the
`development` Neon branch, "not yet applied to `production`"). No new migration
file, so **no new `drizzle/meta/_journal.json` entry is owed** — the existing
`0044`/`0047` entries are unchanged and still agree with the filenames on disk.
(Noted in passing, not touched: `_journal.json` has three pre-existing gaps at
`idx` 26–28, unrelated to this pipeline.)

### Item 1 — `presby_guard_lifecycle_write()` binds to the declared act (QA-1)

`drizzle/0044` §12a. The marker stops carrying the boolean `'true'` and carries
the `organization_lifecycle_events.id` as text. The guard reads it through
`nullif(…, '')` (so unset and blank take one branch), branches on
`tg_table_name`, and requires `new.id::text` (events) / `new.event_id::text`
(successions) to equal the armed value; a third table attaching this guard
without extending the branch is refused rather than passed. All three
sub-reasons — unarmed, wrong table, wrong id — still raise through the existing
`presby_deny_lifecycle_change()` literal, so F40's one-claim-one-literal
discipline is intact.

No `'*'` wildcard: the §12a comment states the backfill contract explicitly (a
migration inserting several historical events re-arms per event id, immediately
before that event's own insert).

**Comments corrected, not just the code.** §12a gained a "WHAT THIS DOES AND
DOES NOT GUARANTEE" block stating the guarantee (the arming transaction
declares which act it is recording; no row belonging to another act is
accepted) and the accepted residual in the same breath (a later transaction
re-arming to a settled event's *own* id is **not** refused — F44 class,
owner-connection-bounded, `docs/TODO.md`'s `presby_record_lifecycle_event()`
line). §13a2's "this is the trigger that stops the reviewer's exact repro" is
replaced with the refused/not-refused pair. The same correction landed in
`src/lib/db/domain/lifecycle.ts` (module header and the
`organizationSuccessions` doc comment).

### Item 2 — `lifecycle.test.ts` on the id-carrying contract

`armLifecycleWrite(tx, eventId)`; `newEventId()` (a `node:crypto`
`randomUUID()`) mints the id client-side, since the marker cannot name a value
the database has not produced yet; every events-table insert now supplies `id`
explicitly. All 24 call sites updated. Two are not mechanical and say so
inline:

- the byte-identity probe's "missing event" half is armed to `NO_SUCH_EVENT`
  **itself**, so the guard passes and `presby_check_succession_event()` is
  still the layer doing the refusing — arming to anything else would silently
  turn that probe into a second test of the guard;
- `disarmLifecycleWrite()` now writes `''` rather than `'false'`, matching the
  `nullif` read.

Rewritten/added per Ruling 4(a)/(b):

| Test | Proves |
|---|---|
| "refuses a THIRD predecessor … once the marker is dropped — the **UNARMED half** of the reviewer's repro" | retitled honestly; it proves "unarmed is refused", and its comment now says plainly that this is *not* the reviewer's repro |
| "refuses a succession row whose `event_id` names a DIFFERENT act than the one this transaction declared" | the binding, isolated: act Y is written through its own arming so it **exists and is in scope** (otherwise `..._event_scope`, which sorts first, would refuse and the probe would measure the wrong trigger); the edge against Y is then refused while the transaction declares X. Positive control in its own transaction — a rejected statement aborts the enclosing one |
| "refuses a lifecycle event whose OWN id is not the id the transaction armed" | the events-table branch; authority sorts first and passes, so the guard is the only remaining objector |
| "accepts the event whose id the transaction DID arm" | matching-id positive control |
| "reads the marker through `nullif`, so a BLANK marker is unarmed" | the empty-string edge |
| "binds the guard to `new.id` / `new.event_id` in the deployed function body" | the structural half of QA-1, on the owner connection |

**No red/skipped test for the residual**, and the describe block says why: this
file cannot commit a lifecycle event (a committed one is permanent and blocks
fixture teardown), so any such test would be a stand-in that reads as if it
proved the residual — the exact mistake being corrected. Prose is the honest
instrument here.

`lifecycle.test.ts`: **38 → 43 tests**, all passing.

### Item 3 — `drizzle/0047` claim and citation corrections (QA-2, QA-3)

§3b's "unreachable on every connection until the writer ships" is replaced by a
per-connection table: `publications` is grant-closed (`presby_app` holds no
UPDATE); `congregation_statistics` is closed by the column grant in the new
§10; the trigger conjunct is the **owner-side** layer, which is the one a grant
cannot bind (F44). "section 39" → "section 35(d)". The `withdrawn_at` column
comment, `src/lib/db/domain/presbytery.ts`'s `withdrawnAt` doc comment, and
`publication.test.ts`'s `armWithdrawalWrite()` header carried the same
overclaim and are corrected with it.

### Item 4 — column-level privileges on `congregation_statistics` — **UPDATE built, INSERT measured and NOT built (F59)**

`drizzle/0047` §10, a `DO` block that reads `information_schema.columns`,
excludes exactly `withdrawn_at` and `publication_id`, and issues
`revoke update … ; grant update (<69 generated columns>) …`. Idempotent by
construction (the table-level revoke drops the column-level grants with it, so
the pair is a full restatement). `presby_platform` untouched. The block also
restates `grant insert` at table level — a no-op on a clean replay, and the
repair path for a branch that ran the interim INSERT-narrowing build.

**The INSERT half of Ruling 2 is not buildable and was removed after being
built and measured.** Two facts, both measured on `development` rather than
reasoned from docs:

1. Postgres requires column-level `INSERT` privilege on **every column in the
   INSERT target list, including one whose value is the `DEFAULT` keyword**.
   Probe: `grant insert (a, b) on t`, then as the grantee
   `insert into t (a, b, c) values (1, 2, default)` → `permission denied for
   table t`; `insert into t (a, b) values (1, 2)` succeeds.
2. drizzle-orm 0.45's `buildInsertQuery` (pg-core dialect) emits **every**
   column of the table in the target list, filling unspecified ones with
   `default`. There is no supported way to omit one.

So a column-level `INSERT` revoke on *any* column of this table breaks
`setCongregationStatistics()` (`src/lib/presbytery.ts:663`) — the shipped,
member-facing write path the ruling explicitly required to keep working. I
built the INSERT half first and ran the proof the punch list asked for:
`src/lib/presbytery.test.ts` went **5 failed / 29 passed**, two of them
`permission denied for table congregation_statistics` on exactly that upsert
(the other three cascading from the missing statistics rows). With the INSERT
half removed: **34/34**. The code reading confirms the same conclusion from the
other side — `setCongregationStatistics()`'s `values` object and its
`onConflictDoUpdate` `set` both name 19 columns and neither excluded column is
among them; the breakage is entirely the builder's implicit target list, which
the UPDATE path does not have.

**Consequence, routed back to Phase 3 rather than absorbed:** the seventh
loop-back's item-7 `INSERT` residual **stands** rather than closing. It is
bounded as it already was by `congregation_statistics_publication_shape` and
the composite FK to `publications(id, organization_id)`, which together force
any fabricated `published_by_congregation` row to name a real publication
already addressed to the inserting council. The measured-UPDATE defect QA
actually reproduced is fully closed. If the INSERT residual is judged worth
closing, the instrument is moving that one write off Drizzle's insert builder
onto raw parameterised SQL — an api-developer change in `src/lib/presbytery.ts`,
not a migration. Recorded as **F59** in `docs/schema-design-2.md` with the
general rule: *a column-level `INSERT` narrowing is only available on a table
no tenant-connection Drizzle `insert()` targets; column-level `UPDATE` has no
such constraint.*

### Item 5 — `scripts/test-rls.sql`

§35(d) rewritten: the unarmed probe expects `insufficient_privilege` and names
`check_violation` as an explicit FAIL ("the column grant did not refuse; the
trigger did"); the armed block — which used to perform QA's exact write and
assert it **succeeded** — now asserts it is refused; five `has_column_privilege`
assertions (both excluded columns false on UPDATE, `minute_reference` and
`ending_active` true as positive controls), plus a `relacl` assertion that the
table-level UPDATE is gone and a `pg_attribute.attacl` assertion that the
column grants are really there. A sixth assertion records the INSERT residual
as *deliberate* (`publication_id` INSERT = true) with a pointer to §10, so the
absence is not read as an oversight. §35(e) gained the QA-1 structural pair
(the body references `tg_table_name`/`new.id::text`/`new.event_id::text`; it no
longer contains `<> 'true'`). One pre-existing assertion had to move with the
grant: §29's "4 tables × 4 privileges = 16" is now 15, with a companion
assertion naming exactly which entry is missing.

`scripts/test-rls.sql`: **402 → 412 passes**, exit 0.

### Item 6 — verification

| Check | Result |
|---|---|
| `drizzle/0044` + `0047` applied whole, in order, **twice** | 4 × `exit=0`; row counts across nine tables **identical** to the pre-apply baseline after both runs |
| `scripts/test-rls.sql` as `presby_app` | **412 passes, exit 0** (three times: after the build, after the double re-apply, after both failing-first restores) |
| DB-backed vitest, `--no-file-parallelism` (lifecycle, publication, org-identifiers, presbytery, org-provisioning) | **147 passed / 0 failed** across 5 files (was 142; lifecycle 38 → 43) |
| `npm run typecheck` | PASS |
| `npm run check` | all five tripwires pass |
| `npm test` | 3239 passed / 765 skipped; **1 failed**, `src/components/shared/global-nav.test.tsx:288` (`min-w-11`) — a concurrent pipeline's in-flight edit (`docs/work-log/2026-09-25-org-switcher-touch-target.md`, untracked at session start), outside this pass's files and not caused by it |

**Failing-first, both new guards, watched:**

1. *Boolean-marker regression.* Replaced the deployed
   `presby_guard_lifecycle_write()` with a version that still requires a
   non-empty marker but stops **comparing** it (isolating the binding from the
   arming): `lifecycle.test.ts` → **3 failed / 40 passed** — "refuses a
   succession row whose `event_id` names a DIFFERENT act…", "refuses a
   lifecycle event whose OWN id is not the id the transaction armed", and the
   structural probe (`expected 'CREATE OR REPLACE FUNCTION public.pre…' to
   contain 'new.id::text'`). `test-rls.sql` → exit 3 at `:4710`
   (`FAIL QA-1: presby_guard_lifecycle_write() binds each row to the act the
   transaction DECLARED … expected 1, got 0`), 396 passes. Also ran the cruder
   full revert to the original boolean body: 20 failures, since every fixture's
   UUID arming is then rejected outright. `drizzle/0044` re-applied → 43/43 and
   412/exit 0.
2. *Column revoke reverted.* `grant update on congregation_statistics to
   presby_app;` → `test-rls.sql` exit 3 at `:2147`
   (`expected 15, got 16`). Since the suite aborts there, I ran §35(d)'s own
   probes directly against the reverted grant: the unarmed probe hit the new
   `FAIL — the column grant did not refuse; the trigger did` branch; **the
   armed probe reproduced QA's original finding exactly** (`FAIL — presby_app
   armed presby.withdrawal_write_active and wrote withdrawn_at; a GUC is being
   treated as a privilege`); `has_column_privilege(… 'withdrawn_at','UPDATE')`
   → `expected 0, got 1`. `drizzle/0047` re-applied → 412/exit 0.

### Files touched

`drizzle/0044_presby_org_lifecycle.sql` · `drizzle/0047_presby_publications.sql`
· `scripts/test-rls.sql` · `src/lib/db/domain/lifecycle.ts` ·
`src/lib/db/domain/lifecycle.test.ts` · `src/lib/db/domain/presbytery.ts` ·
`src/lib/db/domain/publication.test.ts` · `docs/schema-design-2.md` (F59, the
GUC table, F54/F56 corrections) · `docs/decisions.md` (DECISION-141 build note;
DECISION-142's "pending the operator's confirmation" → "confirmed by the
operator 2026-09-25", a one-line doc fix riding with this commit at the
orchestrator's request).

Not touched: `scripts/seed-dev.sql` (it arms only
`presby.publication_write_active` and writes neither lifecycle table — verified
by grep, so the id-carrying marker costs it nothing), `e2e/`,
`src/lib/presbytery.ts`, `docs/TODO.md`, release notes.

**Local apply (unchanged shape, re-run the two corrected files):**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0044_presby_org_lifecycle.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0047_presby_publications.sql
psql "$APP_DATABASE_URL" -f scripts/test-rls.sql   # expect 412 passes, exit 0
# scripts/seed-dev.sql and npm run db:seed are UNCHANGED by this pass.
```

**Handoff — next agent: qa** (Phase 5 re-verification). Nothing new is
available to an implementer: no new table, column, FK or function signature.
What changed for a future writer is a **contract**: any code that inserts into
`organization_lifecycle_events` or `organization_successions` must
`set_config('presby.lifecycle_write_active', <event id>::text, true)` with the
id of the event it is recording, before the insert, and supply that id
explicitly — `presby_record_lifecycle_event()`'s design must mint the id first
and arm it, not rely on the column default. And `presby_app` can no longer
UPDATE `congregation_statistics.withdrawn_at` or `.publication_id` at all; the
future `presby_withdraw_publication()` must be `SECURITY DEFINER`.

**Owed to Phase 3:** the F59 deviation above (the INSERT half of Ruling 2,
built, measured, removed) is the one place this pass did not do what the ruling
said. Everything else is as ruled.

---

## Per-Phase Status (eighth loop-back)

Phase 3 row: **ruled an eighth time** on QA's Phase 5 re-verification FAIL. QA-1 partially accepted (marker bound to the declared event id; full cross-transaction closure declined and named as an accepted, owner-connection-bounded residual per F44, folded into the existing `docs/TODO.md` line rather than built); QA-2 accepted in full via column-level `INSERT`/`UPDATE` privilege narrowing on `congregation_statistics` (`withdrawn_at`, `publication_id`), which also closes the seventh loop-back's item-7 residual; QA-3 accepted as a citation fix. `docs/schema-design-2.md` §2g and `docs/decisions.md` DECISION-141 both amended in place. No Phase 1/2 loop-back. Next: database-admin (ninth Phase 4 pass, punch list above), then qa (next Phase 5 re-verification).

# Phase 5 — Verification (qa), continued

## Re-verification after the ninth pass (2026-09-25, qa) — recorded verbatim by the orchestrator

**Date:** 2026-09-25
**Verified by:** qa
**Scope:** narrow re-verification of the ninth Phase 4 pass (QA-1 / QA-2 / QA-3 corrections) against the Phase 3 ruling "Ruling on QA-1/QA-2 after hardening round two". Everything below was re-measured by me on the `development` Neon branch (`br-super-dawn-axfi55p6`), in rolled-back transactions on the owner connection unless stated, not read off the implementer's report.

### Type Check

`npm run typecheck`: **PASS**
`npm run check` (five tripwires): **PASS** — audit-coverage, sql-date, deps-drift, brand-scope, secrets/PII all green.

### Unit Tests

| Suite | Result |
|---|---|
| `scripts/test-rls.sql` as `presby_app` | **412 passes, exit 0** — reproduced 6× across the session (baseline, post-double-apply, post-restore ×4) |
| Five DB-backed vitest files, `--no-file-parallelism` (`lifecycle`, `publication`, `org-identifiers`, `presbytery`, `org-provisioning`) | **147 passed / 0 failed / 0 skipped** (`lifecycle` 43, `presbytery` 34) |
| `npm run test` (full unit suite) | 3240 passed / 0 failed / **765 skipped** (29 files) — see Finding 3 |
| `drizzle/0044` + `0047` re-applied whole, in order | exit 0 both; row counts across eight tables **identical** before and after (`orgs=15 aff=10 lce=0 succ=0 ident=0 sr=1 pub=1 cs=2`); `test-rls.sql` still 412/exit 0 |

Failures: none attributable to this pass. Two transient reds observed and diagnosed — Finding 2.

### Schema/RLS Audit — live-catalog probes

Verified against `pg_class.relacl` (via `aclexplode`), `pg_attribute.attacl`, `has_column_privilege()`, `pg_get_functiondef()`, and `\d`'s trigger/constraint list on the actual connections — not `information_schema` grants, not the Drizzle table files.

#### 1. QA-1 — the lifecycle marker binds to the declared act. **Closed as ruled.**

Owner connection (`neondb_owner`), all rolled back. Fixtures: presbytery `northern-reach`, congregations `alder-creek` / `bramblewood` / `fernwood` / `marrowbone`.

| Probe | Result | Refusing layer, named |
|---|---|---|
| Arm X → insert event X → insert two edges for X → `set constraints all immediate` | **accepted**, 2 edges | — (positive control) |
| Arm X → insert an edge for a different, already-complete act Y | **refused**, `organization_lifecycle_events: this change is not permitted` | `presby_guard_lifecycle_write()` **line 26** — the id-mismatch branch, via `presby_deny_lifecycle_change()` |
| Arm X → insert an events row whose `id` ≠ X | **refused**, same literal | same, **line 26** |
| Unarmed events insert | **refused**, same literal | same, **line 9** — the unarmed branch |
| Unarmed successions insert (event exists, in scope) | **refused**, same literal | same, **line 9** |

The uniform literal holds across all three sub-reasons — F40's one-claim-one-literal discipline is intact and a prober cannot tell unarmed from wrong-id from wrong-table.

**The accepted residual is exactly what the comments say, and not more.** Re-arming to act Y's *own* id and appending a third edge → **accepted** (edges 2 → 3). Read against `drizzle/0044:1202-1232`: the function body reads `current_setting(...)` and `new` only — no table read, no `xmin`/`pg_current_xact_id()`, no transaction-age notion — so the same-transaction re-arm I measured and the cross-transaction re-arm `drizzle/0044:1145-1160` names are the same code path. **Stated honestly:** I could not commit act Y to make the re-arm *literally* cross-transaction — `presby_freeze_lifecycle_event()` makes a committed event permanent on every connection including the owner's, so the probe would have left an undeletable fixture and moved `organizations.lifecycle_status`. The residual is confirmed reachable and confirmed no wider than §12a/§13a2 describe; the cross-transaction framing is inference from the function body, which I read, not from a commit.

Comment corrections verified in place: `drizzle/0044:1131-1160` (the GUARANTEED / NOT GUARANTEED pair), `drizzle/0044:1414-1438` (§13a2's REFUSED / NOT REFUSED pair, replacing "stops the reviewer's exact repro"), and the mirrors in `src/lib/db/domain/lifecycle.ts:67-71,205-207`.

#### 2. QA-2 — the UPDATE half. **Closed at the grant layer.**

`presby_app` connection, recipient's org context (`northern-reach`), against the real projection row `a4000000-…-0002`:

| Probe | Result |
|---|---|
| Arm `presby.withdrawal_write_active` → `update … set withdrawn_at = now()` | **`ERROR: permission denied for table congregation_statistics`** |
| Same, unarmed | **`permission denied`** — same error, arming buys nothing |
| `update … set publication_id = null` | **`permission denied`** |
| Positive control: `update … set ending_active = 39, minute_reference = '…'` | **`UPDATE 1`** |

`has_column_privilege('presby_app', 'congregation_statistics', …)`: `withdrawn_at`/UPDATE = **false**, `publication_id`/UPDATE = **false**, `minute_reference`/UPDATE = **true**, `ending_active`/UPDATE = **true**.

Table-level ACL on `congregation_statistics` for `presby_app`: **`DELETE, INSERT, SELECT`** — no table-level UPDATE. `presby_platform` retains `DELETE, INSERT, SELECT, UPDATE`, untouched per the F47 precedent.

**The §10 column list is catalog-generated and exact.** `information_schema.columns` reports **71** columns; **69** carry a column-level UPDATE grant in `pg_attribute.attacl`; the set difference is **exactly** `{publication_id, withdrawn_at}`. `drizzle/0047:1743-1779`'s `DO` block reads the catalog rather than hand-transcribing, and refuses an empty grant.

**The live path is unaffected.** `src/lib/presbytery.ts:672-680` — `onConflictDoUpdate`'s `set: values` names 19 columns, neither excluded one among them. `src/lib/presbytery.test.ts`: **34/34**, confirmed 6× independently.

#### 3. QA-3 — citation. **Closed.**

No `"section 39"` remains anywhere in `drizzle/`, `scripts/` or `src/`. `drizzle/0047:349` and `:1737` both cite `scripts/test-rls.sql` section 35(d). The only surviving mention is `docs/schema-design-2.md:1140`, which describes the typo being fixed.

#### 4. Test-suite assertions verified as written, not inferred from green

- `scripts/test-rls.sql:4560-4577` — the unarmed probe expects `insufficient_privilege` and raises an explicit **FAIL** on `check_violation` ("the column grant did not refuse; the trigger did"). This is the layer-naming discipline done right.
- `scripts/test-rls.sql:4584-4595` — the armed block QA originally cited was **replaced**, not supplemented; it now asserts refusal.
- `scripts/test-rls.sql:4607,4611,4618,4622,4631,4641` — five `has_column_privilege` assertions plus a `relacl` and a `pg_attribute.attacl` assertion.
- `scripts/test-rls.sql:4662` — records the INSERT residual as deliberate, pointing at §10.
- `scripts/test-rls.sql:4710,4715` — §35(e)'s QA-1 structural pair.
- `scripts/test-rls.sql:2147,2153` — §29's 16 → 15 with the companion "which entry is missing" assertion.
- `src/lib/db/domain/lifecycle.test.ts:272-287` — `armLifecycleWrite(tx, eventId)` carries the id; `disarmLifecycleWrite()` writes `''`, matching the `nullif` read.

### Regression / Failing-First Verification

I performed both failing-first proofs myself rather than accepting the implementer's report.

**(a) Boolean-marker regression** — replaced the deployed `presby_guard_lifecycle_write()` with a body that still requires a non-empty marker but stops *comparing* it (isolating binding from arming):

- `lifecycle.test.ts` → **3 failed / 40 passed**: `lifecycle.test.ts:900`, `lifecycle.test.ts:983`, `lifecycle.test.ts:1049`.
- `test-rls.sql` → **exit 3 at `scripts/test-rls.sql:4710`**, 396 passes.
- My own behavioral probes independently flipped: the wrong-`event_id` edge and the wrong-`id` event both went from refused to **accepted**. The binding is load-bearing behaviorally, not only textually.
- `drizzle/0044` re-applied whole → **43/43**, `test-rls.sql` 412/exit 0, probes refuse again.

**(b) Column revoke reverted** — `grant update on congregation_statistics to presby_app;`:

- `test-rls.sql` → **exit 3 at `scripts/test-rls.sql:2147`** (`expected 15, got 16`), 182 passes.
- Running §35(d)'s probes directly against the reverted grant **reproduced QA's original finding exactly**: the armed withdrawal `UPDATE` returned **`UPDATE 1`**, and the unarmed one was refused by the *trigger* (`published rows are immutable…`, `check_violation`) rather than the grant — precisely the state the new FAIL branch at `scripts/test-rls.sql:4573` exists to name.
- `drizzle/0047` re-applied whole → 412/exit 0, `withdrawn_at` left `NULL` on both rows.

**(c) F59 reproduced independently.** I narrowed `INSERT` by exactly **one** column the live path never names (`race_asian`) and ran `presbytery.test.ts`: **5 failed / 29 passed**, with `permission denied for table congregation_statistics` — the implementer's exact numbers and error. The deviation is real and correctly measured; Drizzle's insert builder emits every column in the target list, and Postgres requires the privilege on each named column including `DEFAULT`-valued ones. Restored with an explicit `revoke insert` followed by a whole-file `0047` re-apply; final ACL verified as 69 column-level UPDATE, **0** column-level INSERT, table-level `DELETE, INSERT, SELECT`.

### Findings — advisory, none verdict-changing

**Finding 1 — the F59 INSERT residual is reachable, and its stated bound is narrower than a reader will take it.** Probed as `presby_app` with the recipient council's context: self-arm `presby.publication_write_active`, then insert a `published_by_congregation` row naming the real publication `994f9867-…`. Results:

- bogus `publication_id` → refused by `congregation_statistics_publication_fk`;
- null `publication_id` → refused by `congregation_statistics_publication_shape`;
- unarmed → refused by `presby_guard_publication_write()`;
- from the *publishing congregation's* context → refused (about-org affiliation);
- **a real publication addressed to this council → `INSERT 0 1`.** Reachable, as F59 says.

Two precision gaps in how that residual is described, both worth a line the next time `drizzle/0047` §10 (`:1693-1705`) or `docs/schema-design-2.md:1106` is touched:

1. **The named instrument is the wrong one of two.** Both cite "the composite FK to `publications(id, organization_id)`" — that is `congregation_statistics_publication_fk (publication_id, about_org_id)`, which forces the row to name a publication *the subject congregation published*. The constraint that actually produces the stated bound — "already addressed to the inserting council" — is the second one, `congregation_statistics_publication_recipient_fk (publication_id, organization_id) → publications(id, recipient_org_id)`. The claim is true; the layer credited for it isn't the one doing the work.
2. **The bound constrains *which publication* is named, not the row's content.** My fabricated row carried **year 2024** against a publication whose `statistical_returns.report_year` is **2025**, with `ending_active = 99999` and a minute reference of my choosing, and it inserted. `congregation_statistics_entered_unique_idx` is partial (`presbytery_entered`/`imported` only), so it does not even collide with the genuine projection, and `congregation_statistics_freeze` then makes the fabrication immutable. In plain terms: a recipient council can manufacture a permanent "the congregation published this" record for a year the congregation never published. That is a wider consequence than "must name a real publication," which is how §10 and F59 currently read.

This does not change the verdict — the residual is already accepted, already routed to Phase 3, and the named instrument (moving the write off Drizzle's insert builder) is unchanged. It sharpens *what* Phase 3 is accepting.

**Finding 2 — two transient reds, both traced to a concurrent pipeline on the shared Neon branch; neither attributable to this pass.** One `test-rls.sql` run exited 3 at `scripts/test-rls.sql:418` (`roll: cache agrees with replay — expected 0, got 3`) and one `presbytery.test.ts` run reported 3 failed / 31 passed. Diagnosis: `presby_roll_cache_drift()` returned rows for organization `97998907-…`, which is not in the 15-org fixture set; `organizations` was observed moving **17 → 15 within one second**, with foreign fixture slugs `officers-test-a/b-…` and `org-features-test-a/b-…` appearing and vanishing. Another worktree is running vitest against the same branch. With the branch quiet, `test-rls.sql` returned 412/exit 0 three consecutive times and `presbytery.test.ts` 34/34 seven times. This is the already-tracked Finding 5 ("two pipelines must not share one Neon branch") reproducing live, not a defect in the ninth pass — but it means any single green run on this branch is weaker evidence than it looks, and I record the repetition counts above for that reason.

**Finding 3 — `npm test` runs zero of the 147 assertions that cover this pass.** 29 files / 765 tests are `describe.skipIf(!hasDb)`-gated on `DATABASE_URL` + `PLATFORM_DATABASE_URL`, which `npm run test` does not set; my first attempt at the five DB-backed files reported "4 skipped (4), 131 skipped" until I loaded `.env.local`. This is a documented standing condition (`src/lib/db/domain/lifecycle.test.ts:25`), not introduced here, and the invocation in the implementer's handoff block is correct. Recording it because a skipped spec is not a passing spec: **CI green covers none of the lifecycle-guard or column-grant work in this pipeline.** Whoever owns CI for these migrations should know that the only thing exercising them is a human running `dotenv -e .env.local -- vitest`.

**Finding 4 — §10's INSERT restatement is not the "full restatement" its UPDATE sibling is.** `drizzle/0047:1767-1774` offers the bare `grant insert` as the repair path for a branch that ran the interim INSERT-narrowing build. Measured: after a column-level INSERT narrowing, re-applying `0047` whole restores table-level INSERT but leaves **70 stale per-column INSERT entries** in `pg_attribute.attacl`. Effective privilege is correct (table-level covers every column), nothing in the suite or the app notices, and no assertion would catch it — cosmetic, and I cleaned it up with an explicit `revoke insert` before the final re-apply. Worth one line in §10 if the file is touched again; not worth a loop-back.

### End-to-End Tests

Not run, and not required. This pass touches `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` and `src/lib/auth/` **not at all** — the stricter auth gate does not apply. It also changes no rendered surface. `e2e/header-controls.spec.ts`, modified in the working tree, belongs to the concurrent `2026-09-25-org-switcher-touch-target` pipeline; attributed, not judged.

### Coverage on Critical Modules

Not re-measured, and deliberately: this pass touches no pure-TS module. `src/lib/permissions.ts`, `src/lib/two-factor.ts` and `src/lib/flags.ts` are unchanged since the last full coverage run and are not in this pipeline's diff.

### Feature-Gate Audit

**No protected routes touched.** Verified by reading the diff rather than inferring: the ninth pass's files are `drizzle/0044`, `drizzle/0047`, `scripts/test-rls.sql`, `src/lib/db/domain/{lifecycle,presbytery,publication}.ts` (table definitions and doc comments only), three test files, and docs. No `src/app/**/route.ts`, no `actions.ts`, no `"use server"` body added or changed. The single `src/app/` entry in the working tree, `src/app/globals.css`, belongs to the concurrent `2026-09-25-platform-radius` pipeline.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| *(none — no protected routes touched)* | n/a | n/a | n/a |

### Verdict

**PASS**

All three of my prior findings are closed as ruled, verified independently against the live catalog and by watching both guards fail first and pass after:

- **QA-1** — the marker is event-id-bound; the wrong-id, wrong-table and unarmed cases all refuse through the one uniform literal, and the accepted residual is reachable exactly as far as `drizzle/0044:1145-1160` says and no farther.
- **QA-2** — the tenant path is closed at the **grant** layer, not the trigger: `presby_app` holds no table-level UPDATE, 69 of 71 columns column-granted, arming the GUC buys nothing.
- **QA-3** — citation corrected.

The **F59 deviation is honestly stated and correctly measured** — I reproduced it from scratch (5 red, `permission denied for table congregation_statistics`, from revoking a single unrelated column) and it is a genuine Postgres/Drizzle incompatibility, not an implementer shortcut. Findings 1–4 are advisory: Finding 1 sharpens what Phase 3 is accepting on the INSERT residual and is the only one I would want carried into Phase 6's read; Findings 2–4 are environment and documentation hygiene.

### Handoff

**Next agent: analyst (Phase 6 — Shipped vs Intent).** Two things worth carrying into that read: Finding 1 (what the accepted INSERT residual actually permits, which is wider than "must name a real publication" reads), and the fact that the ninth pass's *only* deviation from the Phase 3 ruling — F59 — is owed back to Phase 3 and was ruled on nowhere yet.

I wrote no project file. Probe scripts and suite output live in the session scratchpad; the only database mutations were the two deliberate failing-first reverts and the F59 reproduction, each restored by a whole-file re-apply and each verified back to the intended ACL (`DELETE, INSERT, SELECT` table-level, 69 column-level UPDATE, 0 column-level INSERT) with `withdrawn_at` NULL on both projection rows.

---

# Phase 3 — Technical Design (tech-lead), continued → Ruling on F59 and QA Finding 1 after the ninth pass

**Date:** 2026-09-25
**Scope:** the two items QA's re-verification of the ninth Phase 4 pass owed back to Phase 3 — ruling on the F59 deviation, and correcting the two precision gaps QA's Finding 1 identified in how that deviation's accepted residual is described. Nothing else in the ninth pass's PASS is reopened. This is the **tenth and final correction round on `drizzle/0043`–`0047`** — no further design defect is expected on these migrations.

## 1 — F59: accepted as built

`database-admin`'s ninth pass built the `INSERT` half of the eighth loop-back's ruling (column-level `INSERT` narrowing on `congregation_statistics`, symmetric with the `UPDATE` half), measured it break the shipped `setCongregationStatistics()` upsert (`src/lib/presbytery.test.ts` 5 red, `permission denied for table congregation_statistics`, from Postgres's requirement that a column-level `INSERT` grantee hold the privilege on *every* column in the target list — including `DEFAULT`-valued ones — combined with drizzle-orm 0.45's insert builder always emitting the full column list), and removed it. This is not a shortcut: it is a genuine Postgres/Drizzle incompatibility, correctly measured, and QA independently reproduced the identical failure from a one-column revoke. **Ruled: accepted as built.** The `UPDATE` half — the half QA's original re-verification actually measured as a live defect — is fully closed at the grant layer. The `INSERT` half is not buildable without breaking the live write path the ruling required to keep working, and forcing it through would trade a real, working member-facing feature for a residual that remains bounded (see below) and has no live exploit path today.

**The closing instrument, named definitively rather than left as "if judged worth it, pick one":** move `setCongregationStatistics()`'s write off Drizzle's insert builder onto an explicit column-list raw SQL insert — naming only the columns it actually sets, never `publication_id` or `withdrawn_at` — in `src/lib/presbytery.ts`. This is an api-developer change, not a migration; the migration side (the column-level grant excluding those two columns) is already correct and needs no further edit once the call site stops using Drizzle's `insert()`/`onConflictDoUpdate()` builder for this table. **Chosen over a `SECURITY DEFINER` function** for three reasons: (1) it is the only tenant-connection Drizzle `insert()` target on this table today — `presby_publish_sasr_snapshot()` already runs `DEFINER` and is grant-exempt per F44, and `scripts/seed-dev.sql` writes raw SQL — so fixing this one call site alone would fully satisfy F59's general rule ("a column-level `INSERT` narrowing is only available on a table no tenant-connection Drizzle `insert()` targets") with nothing else to change; (2) `setCongregationStatistics()` is a same-connection, non-cross-tenant write (a council entering or correcting its own `presbytery_entered` statistics) — it has no confused-deputy shape and doesn't need the standing-check surface a `DEFINER` function exists to provide, so introducing one would be exactly the scope creep F44/DECISION-138's own restraint already warns against for writes that don't need it; (3) it is the smaller, more mechanical diff — one query rewritten to name its own column list, versus authoring and testing a new authority-check surface for no additional protection. Not built here; tracked as one `docs/TODO.md` line (see below) for whichever pipeline next touches this write path.

## 2 — QA Finding 1: both precision gaps corrected in place

QA's re-verification measured that the accepted `INSERT` residual is reachable exactly as described in its *reach* (a real publication addressed to the recipient council, self-armed, inserts), but found the write-up wrong or incomplete in two ways. Both are now corrected, not just acknowledged:

1. **Wrong FK credited.** `drizzle/0047` §10 and `docs/schema-design-2.md` F59 both named "the composite FK to `publications(id, organization_id)`" as the instrument bounding the residual to publications already addressed to the inserting council. That FK is actually `congregation_statistics_publication_fk (publication_id, about_org_id) → publications (id, organization_id)`, which constrains the row's *source* congregation, not which council may insert. The FK that does the work the text credited is the other one, `congregation_statistics_publication_recipient_fk (publication_id, organization_id) → publications (id, recipient_org_id)` (added at `drizzle/0047` §5, F51/DECISION-140). Both `drizzle/0047` §10's comment and `docs/schema-design-2.md`'s F59 blockquote now name the correct constraint.
2. **Bound overstated.** Both texts read as if "must name a real publication already addressed to the inserting council" bounded the fabricated row generally. QA demonstrated it does not: a row for report year 2024 inserted cleanly against a real 2025 publication, carrying an arbitrary `ending_active` and `minute_reference`, with no collision (`congregation_statistics_entered_unique_idx` is partial to `presbytery_entered`/`imported`) and was then made permanent by `congregation_statistics_freeze`. Both texts now state the residual honestly: a recipient council on the tenant connection, self-arming `presby.publication_write_active`, can manufacture a permanent projection row for a year the congregation never published, bounded only to *which publication* is named, not the row's content.

Also added, per QA Finding 4: one line in `drizzle/0047` §10 noting that a whole-file re-apply after an interim column-level `INSERT` narrowing leaves stale per-column `INSERT` entries in `pg_attribute.attacl` (effective privilege is correct either way; a `revoke insert` immediately before the restating `grant insert` would clear them if a future edit to this section makes that matter).

## Files touched

`drizzle/0047_presby_publications.sql` (§10 comment: FK correction, honest residual bound, F59 general-rule reference, and the Finding-4 stale-`attacl` note — no DDL change), `docs/schema-design-2.md` (F59 blockquote: same FK correction and honest bound, plus the ruling itself recorded inline), `docs/decisions.md` (a dated correction appended to DECISION-141, not a new decision), `docs/TODO.md` (one line under Next Up naming the closing instrument for whoever next touches `setCongregationStatistics()`).

Not touched: `scripts/`, `src/`, any other docs. No DDL changed, no application code changed — nothing here alters `drizzle/0044`–`0047`'s applied behavior, so no Phase 4 rebuild and no Phase 5 re-verification follow from this ruling. The ninth pass's `PASS` stands.

## Handoff

**No further agent required for this correction.** The pipeline's Phase 6 `SHIP WITH NOTES` (recorded earlier in this work-log) already covers the shipped behavior; this ruling closes the one item QA named as owed to Phase 3 and reconciles `docs/TODO.md` per Workflow Rule 10 in the same pass. Ready for the orchestrator to fold into the ship commit alongside the rest of the ninth-pass corrections, pending the user's review and explicit approval to commit.

---

## Per-Phase Status (tenth loop-back)

Phase 3 row: **ruled a tenth and final time**, on QA's Phase 5 re-verification Finding 1 and the F59 deviation it flagged as owed. F59 **accepted as built** (`UPDATE` half closes the measured QA-2 defect; `INSERT` half is not buildable without breaking `setCongregationStatistics()`); the closing instrument named definitively (raw column-list SQL insert in `src/lib/presbytery.ts`, over a `SECURITY DEFINER` function, for the reasons above) and tracked in `docs/TODO.md`, not built. QA Finding 1's two precision gaps (wrong FK credited; bound overstated) corrected in place in `drizzle/0047` §10 and `docs/schema-design-2.md` F59; Finding 4's stale-`attacl` note added to §10. `docs/decisions.md` DECISION-141 carries a dated correction note. No Phase 1/2/4/5 loop-back — comments and docs only, no behavior change. **This is the last correction on `drizzle/0043`–`0047`.** Next: none — the pipeline's Phase 6 verdict (SHIP WITH NOTES) stands; awaiting the user's commit approval.

---
