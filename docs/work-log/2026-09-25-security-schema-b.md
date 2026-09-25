# Security review §B — schema and data fixes (app_role_permissions RLS, the drift-function leak, the auth-shell grant model, and the punch-list) — Work Log

> **Slug:** `2026-09-25-security-schema-b`
> **Surface:** database layer (RLS policies, grants, functions, FKs, a delete guard, the isolation suite) **plus** — amended at Phase 2 — `src/app/api/cron/maintenance/route.ts` (reconcile call relocated to the platform connection), `src/lib/groups.ts` (three `getPlatformDb()` escapes return to `tx`), `scripts/seed.ts` (catalog writes move to `platformDb`), `src/lib/db/index.ts:12`, and five `src/lib/db/domain/*.ts` files (composite FKs). No page, form, route group or `FEATURES.*` change.
> **Permission(s):** none — no application permission changes; the auth-shell grant model is written down as a migration
> **Flag(s):** not needed
> **Estimated complexity:** medium–large (many small, independent items; the tech-lead may order them into batches)
> **Pipeline mode:** Bug-fix variant (each item is a measured defect against a stated invariant; Phase 2 runs because two items change the grant/policy shape)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-25):** worktree `../presby-wt-security` on git branch `pipeline/security-schema-b`; Neon branch `pipeline-security-schema-b` (`br-cold-smoke-axe1xlzz`, forked from `development` at the v0.25.2 state — `drizzle/0043`–`0047` applied, 15 fixture orgs); the worktree's `.env.local` points every connection at that branch. **Pre-assigned numbers:** migration `drizzle/0048_presby_security_b.sql`; `DECISION-146`; findings `F70` onward (renumbered 2026-09-25: F60–F64 went to the lifecycle pipeline's third external round, `docs/schema-design-2.md` §2h), folded into `docs/schema-design-2.md` as a new lettered subsection at integration. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` may be edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry) so integration merges are mechanical; `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration. Integration is one PR at a time through `/merge-pr`, with `test-rls.sql` re-run on the merged `development` branch before the next lands. Dev-server port for this pipeline: `3200`; Playwright `outputDir` under the worktree.
> **Scope (the defects, each with its source):** (1) **B-H2** `app_role_permissions` has no RLS and full tenant DML — 43 cross-tenant binding rows readable and writable as `presby_app`; policy through `role_id → app_roles`, revoke what is not needed (`docs/reviews/2026-09-25-security.md` §B). (2) **Test-coverage C-4** `presby_roll_cache_drift()` (`drizzle/0012_presby_roll_read.sql:273-286`) is `SECURITY DEFINER`, unfiltered, no `SET search_path`, `EXECUTE` to PUBLIC and `presby_app` — live-probed returning other organizations' `memberships` rows to the tenant connection; scope to `presby_current_org()` or revoke and move the daily-reconcile caller to the platform connection; then make `scripts/test-rls.sql:414-418`'s `= 0` assertion baseline-relative (`docs/reviews/2026-09-25-test-coverage.md` C-4). (3) **B-H3** the auth-shell grant model — `presby_app` holds `arwd` on `users`, `accounts`, `sessions`, `user_totp*`, `password_reset_tokens`, `audit_events`, `permissions` and 14 more, and nothing in `drizzle/` grants it, so a rebuilt database fails at first sign-in; write it down as a migration (what the NextAuth adapter and `recordAudit()` need; SELECT-only elsewhere) and pin it in `test-rls.sql`. (4) **B-M3** six single-column tenant→tenant FKs → composite (worst: `roll_actions.voids_action_id`, `publications.supersedes_id`). (5) **B-M4** `group_types` policy is NULL-false so platform templates are invisible and two call sites escape to `getPlatformDb()` — `app_roles_select` models the fix. (6) **B-L1** 1,282 orphan `group_types` rows and no `unique (organization_id, key)`. (7) **Code review N-6** `people` has no owner-path `BEFORE DELETE` guard — `presby_guard_people_delete()` mirroring the organizations one (`drizzle/0044`). (8) **Test-coverage C-3** a catch-all `FORCE ROW LEVEL SECURITY` assertion in `test-rls.sql` over `pg_class` with an explicit allow-list (`organization_identifiers`, `sasr_form_versions`), replacing the 13 hand-enumerated sites — 21 of ~50 tenant tables are asserted today and no tier-3 table is; plus the missing assertion class "every `SECURITY DEFINER` function granted to `presby_app` respects `presby_current_org()`" and `SET search_path` on the 28 of 35 DEFINER functions lacking it. (10) **External review round three, F60 (routed here 2026-09-25):** every `SECURITY DEFINER` function in the *released* migrations (0001–0042) must carry `SET search_path = public, pg_temp` — `pg_temp` explicitly last, so a caller able to create temporary objects cannot shadow unqualified relations the definer references — as a new migration (this widens B-M2 from "the 28 without `SET search_path`" to "every DEFINER function, `public, pg_temp`"); and `test-rls.sql` must assert that `presby_app`, `presby_platform` and PUBLIC hold no CREATE privilege on schema `public`. The pipeline's own functions in 0043–0047 are corrected in place by the lifecycle pipeline's eleventh loop-back, concurrently. (9) Housekeeping: `drizzle/meta/_journal.json` missing 0026/0027/0028; `docs/schema-design-2.md` §17's "two bespoke policies" stale in both directions (three live; `person_links` deleted); `src/lib/db/index.ts:12`'s comment names the wrong role. **Out of scope:** the security review's §A application half (shipped v0.24.2); `ADMIN_ROLE`'s wildcard (known, bounded); CI wiring (its own pipeline).
> **Key invariants in play:** Isolation Is a Database Property (F1 FORCE; `presby_app` NOBYPASSRLS; F26 DEFINER for cross-org reads — and its converse, a DEFINER function that reads a FORCE table must itself filter by `presby_current_org()` or be unreachable from the tenant role); Composite Tenant Keys (F2); Never Hard-Delete a Person / Organizations are permanent (D10); F44 "a grant never binds `getPlatformDb()`, only a trigger does"; DECISION-135 function-mediated cross-org access.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (bug-fix brief; all nine items reproduced live on the pipeline branch) | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Complete — five binding conditions; DECISION-146 drafted (third connection deferred); pg_temp shadowing proven live; four scope facts corrected by measurement | Approved with suggestions | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-25 |
| 4 — Implementation | database-admin | **Complete** (second pass — QA G1/G2 closed; leaked rows removed) | Built as designed, four named deviations; QA's two test-hygiene gaps fixed, no migration change | 2026-09-25 |
| 5 — Verification | qa | **Pending re-verification** | FAIL (first pass) — returned for G1/G2 | 2026-09-25 |
| 6 — Shipped vs intent | analyst | In progress | — | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Bug-fix variant; recorded verbatim by the orchestrator, 2026-09-25.*

**Verified against:** worktree `presby-wt-security`, git branch `pipeline/security-schema-b`, Neon branch `pipeline-security-schema-b` (`ep-small-scene-axn12k76`, PostgreSQL 18.6, 15 fixture orgs — the same seed-dev.sql fixture set as `development`, confirmed by matching org slugs). All probes below ran in rolled-back transactions on `$APP_DATABASE_URL` (`presby_app`) or as plain reads on `$MIGRATE_DATABASE_URL` (`neondb_owner`); nothing was committed. This branch was forked from `development` (copy-on-write), not rebuilt from `drizzle/*.sql` — noted where that distinction matters below.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

Every one of the nine scope items is real and independently reproducible on this pipeline's own branch — including a live, demonstrated cross-tenant **write** (B-H2) that I executed and rolled back — but two of the nine scope descriptions understate or mis-locate the mechanism (C-4's stated "daily-reconcile caller" is a different function than the leaking one; B-M4's "two call sites" is actually four), and Phase 3 has one real architectural fork to rule on (whether fixing C-4 changes what `test-rls.sql`'s global drift check can see under the `presby_app`-only invariant) before batching begins.

## User Verbs

Not applicable in the usual sense — no page, form, or API surface changes. The "users" here are database connections and the tools that run against them:

| Surface | Verb | Cadence |
|---------|------|---------|
| `presby_app` (every tenant request) | reads/writes tables and calls `SECURITY DEFINER` functions inside `withOrgContext()` | per request |
| `neondb_owner` via `getPlatformDb()` | bypasses RLS and every grant (ownership) for platform-admin pages and two documented `group_types`/template escapes | per platform-admin read |
| `scripts/test-rls.sql` (as `presby_app`, per CLAUDE.md invariant) | asserts the isolation model end to end | every verification run |
| `src/app/api/cron/maintenance/route.ts` (as `presby_app`, via `db`) | daily reconcile | once/day |

## Flows

**Flow 1 — B-H2, `app_role_permissions` cross-tenant write:** Entry: any tenant-context query on `presby_app` (today: none in shipped code — no server action writes this table with a caller-supplied `role_id`; the exposure is a raw-SQL/future-caller risk, not an active exploit path) → `role_id` UUID for another org's role → `INSERT`/`UPDATE`/`DELETE` on `app_role_permissions` succeeds because the table carries no policy at all → a congregation's role gains or loses a permission binding its own session never voted on, and the row I inserted for a `role_id` the session **could not even see via `app_roles`** still landed. Failure path: none exists today — that is the finding. **Live reproduction:** as `presby_app`, org context = Alder Creek: `app_roles` correctly filtered to 15 rows; `app_role_permissions` returned all 71, unfiltered; 43 of 71 pointed at `role_id`s invisible to this session; I picked one, confirmed `SELECT * FROM app_roles WHERE id = :that_id` returned 0 rows under RLS, then inserted a binding for it — `INSERT 0 1`, rolled back. Numbers (15 / 71 / 43) match the security review's `development`-branch probe exactly.

**Flow 2 — C-4, `presby_roll_cache_drift()` cross-tenant read:** Entry: any `presby_app` caller (today: only `scripts/test-rls.sql:417`; no application code calls this function — see Gaps) → `SELECT * FROM presby_roll_cache_drift()` with any org context → the function is `SECURITY DEFINER`, has no `presby_current_org()` predicate and no `SET search_path`, and `EXECUTE` is granted to `PUBLIC` in addition to `presby_app` (`proacl = {=X/neondb_owner,…}`, confirmed on this branch). Every organization's drifted rows would return to a tenant connection. **Live reproduction:** definition and grant confirmed byte-identical to `drizzle/0012_presby_roll_read.sql:273-286`. I could not reproduce a non-empty leaked row on *this* branch (0 rows under Alder Creek context) because this fork's `memberships.current_roll` cache happens to be in sync right now — a data-state fact, not a mechanism difference; the mechanism is identical to what the test-coverage review demonstrated with actual leaked rows on `development`. I did not fabricate drift data to force a visible leak because that would have required a cross-connection commit.

**Flow 3 — B-H3, auth-shell grant model unreproducible from `drizzle/`:** Entry: a database rebuilt from `drizzle/*.sql` alone → NextAuth's `DrizzleAdapter(db, …)` (`src/auth.ts:79`) issues `INSERT`/`UPDATE` against `users`, `accounts`, `sessions` on the `presby_app` connection at first sign-in → fails, because no migration grants `presby_app` anything beyond `SELECT` on `permissions` (`drizzle/0009:351`) and nothing at all on the other 21 tables. **Live reproduction, with a caveat:** the live grant shape is identical on this branch — all 22 auth-shell tables carry `presby_app=arwd`, and no `drizzle/*.sql` grants any of it. **But** this branch was forked, not replayed from empty — so my reproduction confirms the grant shape *persists across a fork*, not that a from-scratch `db:migrate` actually fails at first sign-in. Flag for Phase 3/4: run `db:migrate` against an empty database and try a sign-in before asserting the grant migration is "a no-op against the running database by construction."

## Permissions & Flags

None. No `FEATURES.*` key is touched by any of the nine items; B-H3's item 3 (moving the NextAuth adapter to a third connection) is explicitly deferred as its own Phase 2 architecture question. Flags: not needed.

## Gaps the Request Didn't Address

1. **C-4's scope description names the wrong caller.** No application code calls `presby_roll_cache_drift()` at all. The daily-reconcile cron (`src/app/api/cron/maintenance/route.ts:73`) calls `presby_reconcile_current_roll()` — which fixes drift rather than reporting it, is also `SECURITY DEFINER` and unfiltered, and is correctly unfiltered by design (F26 — a daily sweep across every org in one call is the point); it is separately flagged only for its `PUBLIC EXECUTE` grant (B-L3). The only real caller of the drift function is `scripts/test-rls.sql:417`'s own assertion. There is no live application caller to "move" — the only design question is whether `test-rls.sql`'s *global* drift check (which needs to see every org, and runs as `presby_app` per CLAUDE.md's "MUST run as `presby_app`") can still be expressed once the function carries an org predicate. Phase 3 must rule on this explicitly.

2. **B-M4's "two production call sites" is actually four.** `getPlatformDb()` reads of `group_types` at `src/lib/groups.ts:282` (`groupTypeNamesByIds`), `:500`, and `:586`, plus `src/lib/org-provisioning.ts:286`. All four collapse to the same fix once the policy is split (all can move to `tx`).

3. **B-H1 (creation-guard layer) is correctly excluded** — all five named guard triggers are present on this branch (forked after `933ec2e`). Nobody should re-open it here.

4. **B-M1, B-M2, B-L2, B-L3, B-L4, B-L5, B-L6, B-I1–I6 are named in the security review but absent from the nine-item scope block.** Recommendation: absorb B-L3, B-L4, B-L6 (mechanical, same files — B-L6's missing FK indexes belong in the same migration as B-M3); explicitly defer B-M1, B-M2, B-L2, B-L5 and the B-I items to `docs/TODO.md` with names.

5. **B-H3's "no-op against the running database" claim is unverified against a truly empty database** — see Flow 3. Recommend a from-scratch `db:migrate` + sign-in smoke as Phase 4 acceptance criteria.

6. **Readers of `app_role_permissions`:** none in `src/` beyond `presby_effective_permissions()` itself, which does its own `presby_current_org()` check first. The new policy's shape must preserve the global-row case (a role with `organization_id IS NULL` needs its bindings visible too — the review's proposed `app_role_permissions_select` handles this via `OR organization_id IS NULL` on the `app_roles` subquery); confirm before it ships.

## Adversarial Pass

- Redirect targets, state-machine shortcuts, input boundaries: n/a for schema-only work; "can a tenant write `app_role_permissions` without proving membership in the target org" **is** B-H2 and is confirmed exploitable.
- **Enumeration leaks:** B-L2 (`presby_membership_is_active()`) is an enumeration oracle — out of this pipeline's scope; its absence should be a conscious choice (Gap 4).
- **Same class as B-H2 and C-4 — sweep of the 20 non-trigger `DEFINER` functions on this branch:** all either carry `search_path=public` or an explicit `presby_current_org()` first-statement check, or are the documented function-mediated cross-org exceptions (DECISION-135). **Confirmed no-`search_path`, matching B-M2 exactly:** `presby_effective_permissions`, `presby_link_person`, `presby_match_person`, `presby_reconcile_current_roll`, `presby_roll_cache_drift`. **Nuance:** on this branch `presby_apply_affiliation_to_org_tree`, `presby_transfer_affiliation` and `presby_set_organization_identifier` **do** show `search_path=public`, where the security review's snapshot listed some among the "28 WITHOUT" — branch-state drift from hardening round two landing mid-review; B-M2's exact split should be re-measured against whichever branch Phase 4 targets. `presby_link_person`/`presby_match_person` read `people`/`memberships` with no `search_path` and are *intentionally* not org-scoped (DECISION-135 matching); no shipped caller other than `presby_match_person`. Same class as B-L2/B-L3, correctly out of scope, should be named in TODO rather than rediscovered.
- **Other single-column tenant FKs:** independently re-ran the `pg_constraint` query and got the identical six (`events.parent_event_id`, `groups.group_type_id`, `person_milestones.roll_action_id`, `publications.supersedes_id`, `role_grants.role_id`, `roll_actions.voids_action_id`). High confidence the list is exhaustive.

## Out of Scope (confirm with user)

The security review's §A application half (shipped v0.24.2); `ADMIN_ROLE`'s wildcard; CI wiring; B-H1 (already resolved on this branch); B-M1, B-M2, B-L2, B-L5 and the B-I items (Gap 4 — recommend "defer to TODO" vs "fold in" be ruled before Phase 2).

## Open Questions

1. Fold B-L3, B-L4, B-L6 into `drizzle/0048` alongside the nine scoped items? (Recommendation: fold in.)
2. For C-4: once `presby_roll_cache_drift()` carries a `presby_current_org()` predicate, should `test-rls.sql`'s global drift check become (a) a loop over each fixture org under `presby_app`, or (b) a single unfiltered call once via the owner connection as a narrow documented exception to "test-rls.sql MUST run as presby_app"? A real design fork for tech-lead.
3. Should the from-scratch `db:migrate` + sign-in smoke (Gap 5) be a Phase 4 acceptance criterion for the B-H3 grant migration?

## Batching Recommendation for Phase 3

1. **B-H3 first** — every other item's `test-rls.sql` section runs as `presby_app`, and B-H3 is the one item that could change what `presby_app` is allowed to do.
2. **B-H2 and B-M4 together** — both "split a policy on the `app_roles_select` model" fixes with the same `USING (… OR organization_id IS NULL)` shape.
3. **C-4** — gate on Open Question 2; the fix is one `WHERE` clause, the test redesign is not mechanical.
4. **B-M3 (+ B-L6's indexes if folded in)** — independent; touches different tables.
5. **N-6 (people delete guard)** — fully independent, smallest; `people` has zero triggers today; `organizations` has three (`organizations_guard_insert`, `organizations_guard_reparent`, `organizations_guard_delete`) — the model to mirror.
6. **B-L1 (group_types de-dup)** — after B-M4, since B-M4's policy fix is what makes the duplicates visible through `tx`.
7. **Housekeeping (item 9, + B-L3/B-L4 if folded in)** — any time.

C-3 (the catch-all FORCE assertion) is orthogonal — a test-authoring task; the allow-list (`organization_identifiers`, `sasr_form_versions`) confirmed against the live catalog as the only two tenant-shaped tables without FORCE on this branch.

## Decision-Worthy Items

- **B-H3 step 3** (whether the NextAuth adapter should move off the tenant connection to a third, auth-scoped role) — an architecture question; should get a decision entry whether acted on or deferred (the reasoning: the tenant connection holds the whole platform shell, which is why the `ADMIN_ROLE` wildcard's bound is weaker than it reads, B-I4).
- **The C-4 test-redesign fork** — worth its own decision line once ruled, since it narrows or formally exempts one invariant statement in CLAUDE.md.

### Orchestrator rulings on the open questions (2026-09-25)

1. **Fold in B-L3, B-L4, B-L6.** Same files, one line each. B-M1, B-M2, B-L2, B-L5 and B-I1–I6 are deferred by name; the orchestrator adds the TODO line at integration.
2. **Tech-lead rules** at Phase 3, after the architect's read.
3. **Yes** — the from-scratch `db:migrate` + first-sign-in smoke is a Phase 4 acceptance criterion for the B-H3 grant migration.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-25 |

**Handoff:** to **architect** for Phase 2. Two items change the grant/policy shape (B-H2, B-H3); the architect should rule specifically on B-H3 step 3's deferred architecture question (third connection for the auth shell) and on whether the batching order above is acceptable, and should carry forward Gap 1 (C-4's actual caller) and Open Question 2 (the `test-rls.sql` fork) into what it hands to tech-lead.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-25.*

*Read-only. Every catalog claim below was measured on this pipeline's own Neon branch (`pipeline-security-schema-b`, PostgreSQL 18.6, `neondb_owner` via `$MIGRATE_DATABASE_URL` for reads, `presby_app` via `$APP_DATABASE_URL` in rolled-back transactions for probes). Nothing was written; no file was edited.*

## Verdict

**Approved with suggestions.** The nine-item scope plus B-L3/B-L4/B-L6 plus F70 is the right shape, lands in the right places, and needs no new dependency, no new route group and no new top-level module. Three of the rulings below are **binding conditions**, not suggestions, and are marked `[C]` — each one is a case where the scope as written would either not build, silently break shipped behaviour, or install a control that a later routine action strips back off.

I did not send this to Phase 1. The feature shape is correct; what follows is placement, invariant compliance and four measured corrections to scope facts.

---

## 1. B-H3 step 3 — the third connection: **defer**, and write the grant model on the two roles we have

### What I measured

Every platform-shell writer in the codebase runs on `db` (= `presby_app`), not just the adapter:

| Table | Writers (all on `db`) |
|---|---|
| `users`, `accounts`, `sessions`, `verification_tokens` | `DrizzleAdapter` (`src/auth.ts:79`), plus `users` UPDATE in `src/app/(account)/account/actions.ts`, `src/app/(admin)/admin/users/actions.ts`, `src/app/(admin)/admin/users/[id]/actions.ts`, `src/app/(password-reset)/actions.ts`, `src/auth.ts` |
| `user_totp`, `user_totp_recovery_codes`, `user_totp_pending_enrollments` | `src/app/(account)/account/2fa/actions.ts`, `src/app/(auth)/totp/actions.ts`, `src/app/(admin)/admin/users/[id]/actions.ts`, `src/lib/totp-pending.ts` |
| `password_reset_tokens`, `email_verification_tokens` | `src/app/(password-reset)/actions.ts`, `src/app/(account)/account/actions.ts` |
| `audit_events` | `src/lib/audit.ts`, `src/lib/email/queue.ts`, `src/lib/rate-limit.ts` — **INSERT only, everywhere, no UPDATE or DELETE anywhere in `src/`** |
| `user_roles`, `whats_new_entries`, `email_queue`, `feature_flags` | the `(admin)` actions + `src/auth.ts` |

So an **adapter-scoped** third role would relocate `users`/`accounts`/`sessions`/`verification_tokens` — the four *least* sensitive tables in the set — and leave the TOTP secrets, the reset tokens and the audit log exactly where they are, because those are written by ordinary server actions, not by the adapter. The split that would actually shrink blast radius is *platform-shell DML* vs *tenant DML*, and that is a refactor of ~13 modules behind one accessor, not a connection swap.

Second measurement, and it is the decisive one: **`presby_platform` is `rolcanlogin = f`.** `getPlatformDb()` connects as `neondb_owner` (verified on all three URLs in this worktree's `.env.local`). A role was created, granted `arwd` across 83 tables, and never once connected — and the grant matrix, `src/lib/db/index.ts:12` and `scripts/seed.ts:43` have all described the system incorrectly ever since. Adding a third role without simultaneously adding a third connection string to Vercel, CI, every developer `.env.local` and the Playwright harness repeats that exact mistake at higher stakes. `src/lib/db/index.ts` also states "TWO connections, deliberately" as the boundary that survives application bugs; a third is a change to a stated architecture and has to be principled, not additive.

No Edge implication either way — `src/proxy.ts` reaches no database and `src/auth.ts` is Node-only.

### Proposed DECISION-146

> **DECISION-146 — The NextAuth adapter and `recordAudit()` stay on `presby_app`; the platform shell gets a written least-privilege grant model instead of a third connection. (2026-09-25, architect, Phase 2 of `2026-09-25-security-schema-b`.)**
>
> The 2026-09-25 security review (B-H3 step 3) asked whether the NextAuth adapter should move to a third, auth-scoped role so the tenant connection never holds the credential tables. Deferred, for three measured reasons.
>
> **One — the adapter is not where the sensitive tables are written.** `DrizzleAdapter` touches `users`, `accounts`, `sessions`, `verification_tokens`. The TOTP secrets, recovery codes, pending enrollments, password-reset tokens, email-verification tokens and `audit_events` are written by ordinary server actions in `(account)`, `(auth)`, `(admin)` and `(password-reset)`, all on `db`. An adapter-scoped role moves the four least sensitive tables and changes nothing about the rest. The split with real value is *platform-shell DML* vs *tenant DML*, and its prerequisite is routing all platform-shell DML through one module — a refactor of roughly thirteen files that must precede, not accompany, any new role.
>
> **Two — `presby_platform` is the cautionary precedent.** It is `rolcanlogin = f` on the live catalog and has never carried a connection; `getPlatformDb()` connects as `neondb_owner`. Eighty-three tables of grants to a role nothing can authenticate as, plus two source comments that name the wrong role, are the cost of creating a role without creating the connection that uses it.
>
> **Three — `src/lib/db/index.ts` documents "two connections, deliberately" as the isolation boundary.** A third is a change to that architecture. It is worth making once the shell refactor exists, and not before.
>
> **What ships instead, in `drizzle/0048_presby_security_b.sql`:** the live `presby_app` grant shape written down table by table so the security posture is reproducible from `drizzle/` (B-H3(a) — today it is not, and a database built from the migration history fails at first sign-in), narrowed to least privilege in the same file. Revisit when the platform-shell accessor exists; tracked in `docs/TODO.md`.

### The grant model `drizzle/0048` should write (B-H3, measured per table)

- **Full `select, insert, update, delete`** — `users`, `accounts`, `sessions`, `verification_tokens` (the adapter implements `deleteUser`, `unlinkAccount`, `deleteSession` and `useVerificationToken`; do not trim these on a guess about the session strategy), and `user_totp`, `user_totp_recovery_codes`, `user_totp_pending_enrollments`, `password_reset_tokens`, `email_verification_tokens`, `user_roles`, `whats_new_entries`, `email_queue`, `feedback`, `feedback_prompt_state` — each has a measured INSERT/UPDATE/DELETE call site on `db`.
- **`select, insert` only** — `audit_events`. **Revoke `update, delete`.** Measured: inserts only, in all three writers. Append-only is an invariant; make the grant state it.
- **`select, update`** — `feature_flags`. Not SELECT-only: `src/app/(admin)/admin/flags/actions.ts` UPDATEs it on `db`.
- **`select` only** — `permissions`, `features`, `role_features`, `roles`, `migration_seeds`, and restate the already-correct `organizations`, `organization_identifiers`, `organization_successions`, `sasr_form_versions`. **`[C]` See the `scripts/seed.ts` blocker in §5 before writing this revoke** — as scoped it breaks `npm run db:seed`.
- Restate `grant usage on schema public` and the sequence grants (0009:37–45, F25) so the file is a self-sufficient statement of the posture rather than a delta against an untraced history.
- The file must be idempotent and must be **no-op-or-narrowing** against a live database. Never a widening.

---

## 2. Invariant compliance, fix by fix

### (a) `app_role_permissions` policy — **Approved**, with four things Phase 3 must carry

1. Keep `OR r.organization_id IS NULL` on the SELECT arm. It is belt-and-braces today (the subquery reads `app_roles` under `app_roles_select`, which already admits globals) and load-bearing the day `app_roles_select` narrows. Comment it as such.
2. **Adding FORCE will not break `presby_effective_permissions()`** — verified, not assumed: it is `SECURITY DEFINER` owned by `neondb_owner`, and `neondb_owner` is `rolbypassrls = t`, so FORCE-on-owner does not reach it. It keeps doing its own `presby_current_org()` check first, which stays the real control.
3. **The review's "no shipped server action writes this table" is wrong — there are five writers.** `src/lib/role-definitions.ts:524`, `:631` (DELETE), `:640`, `:842` run on `tx` = `presby_app` and **will** be bound by the new policies; `src/lib/org-provisioning.ts:407` runs on a `getPlatformDb()` transaction and will not. Phase 4 must land the DELETE arm with the own-org case or `setRolePermissions` silently stops clearing bindings; Phase 5 must exercise all four `role-definitions.ts` paths, not just the policy assertion.
4. The policy binds `presby_app` and never `neondb_owner` (F44). B-H2 is a *write* finding and the owner path stays open. The migration comment must not imply the write path is now closed on every connection — that is the sentence class B-H1 proved false. Closing the owner path is a trigger, out of scope; name it in TODO.

### (b) The drift function — **org predicate is the wrong fork; revoke and relocate** `[C]`

The scope block's "scope to `presby_current_org()` **or** revoke and move the caller" reads as two equivalent options. It isn't one.

- `presby_roll_cache_drift()` is an operator health check by its own comment ("Zero is the only acceptable answer outside a reconcile") with **no application caller**. Adding an org predicate keeps a cross-org DEFINER reader on the tenant role's attack surface in order to serve exactly one test assertion.
- Its sibling in the same file is worse and the analyst's Gap 1 found it: **`presby_reconcile_current_roll()` is a parameterless cross-org *writer* of `memberships.current_roll`, granted to `presby_app` and to PUBLIC, and it is live-called** — `src/app/api/cron/maintenance/route.ts:73`, on `db`, with no org context. Treating the reader as a finding while calling the writer "correctly unfiltered by design (F26)" is incoherent. F26 sanctions DEFINER for a *trigger* that must see across orgs inside a guarded operation. DECISION-135's sanctioned cross-org function shape derives its actor from `presby_current_org()` and checks standing first (`presby_transfer_affiliation()`, `presby_publish_sasr_snapshot()`). `presby_reconcile_current_roll()` does neither. It is a cross-org write primitive sitting on the tenant connection.

**Ruling:** `revoke all on function … from public, presby_app` on **both** functions, and move the cron's reconcile call to the platform connection. The route is `src/app/api/cron/...`, not `src/app/(org)/`, so the `(org)` contract is untouched and no `getPlatformDb()` ban is crossed. Least-privilege shape: keep the three token DELETEs on `db` and take `getPlatformDb()` only for the `presby_reconcile_current_roll()` statement. Tech-lead may instead move the whole handler to one connection, but must then say so explicitly and accept that the three token DELETEs widen from `presby_app` to owner.

This is inside C-4's stated second option, so it is in scope — but it means this pipeline is no longer database-only. See §4.

### (c) The `test-rls.sql` fork — the architectural constraint `[C]`

**`scripts/test-rls.sql` is a single-connection artifact and must stay one.** Its first seven lines are the contract, and `presby_app` is `pg_has_role('presby_app','neondb_owner','MEMBER') = f` — it cannot `set role` to the owner. So "one unfiltered call via the owner connection" is not implementable inside the file at all; it would require a second `psql` invocation and would place BYPASSRLS-vacuous assertions inside the one file whose entire premise (F1) is that a vacuous assertion proves nothing. **Do not fork the suite's connection, and do not carve a documented exception into CLAUDE.md's "MUST run as `presby_app`."**

Under (b), the fork dissolves: `scripts/test-rls.sql:414-418` is **deleted** and replaced with the assertion that actually belongs in an isolation suite — that `presby_app` holds no EXECUTE on `presby_roll_cache_drift()` or `presby_reconcile_current_roll()`, and neither does PUBLIC. The `= 0` cache-health check is a *data* claim, not an isolation claim; if it is still wanted, it moves to an owner-connection operational script, or leans on the reconcile cron's existing `rollCacheRolledForward` payload. **Tech-lead picks that mechanism; it may not land in `test-rls.sql`.**

### (d) `people` delete guard (N-6) — **Approved in shape, but it is the largest mechanical item here, not the smallest**

Measured: `people` is `presby_app = arw` (0009:376 already clawed DELETE back), `neondb_owner` full, **zero triggers**. So the guard is purely an owner-path control — `organizations`' exact case, F44's exact reasoning.

- **Yes, `people` needs a fixture exemption.** It has **no `deletable_until` column**, and **45 call sites across 23 unit-test files** do `platform.delete(people)` on the owner connection (`src/lib/roll.test.ts`, `people.test.ts`, `directory.test.ts`, `groups.test.ts`, `role-definitions.test.ts`, …). All 45 break the day the guard lands. Phase 1's "fully independent, smallest" ranking is wrong by a wide margin; re-rank it so Phase 4 doesn't schedule it as a closer.
- **Use the same mechanism as `organizations`** — a `deletable_until timestamptz` column with the identical `old.deletable_until is null or old.deletable_until <= now()` predicate — not a transaction-local GUC arm. A GUC any owner-connection caller can set is a weaker control than a persisted per-row claim stamped at creation, and consistency with D10 / `drizzle/0044` is worth a column.
- **No cascade pre-arming block.** Measured: `people`'s six `ON DELETE CASCADE` children (`addresses`, `contact_methods`, `memberships`, `person_identifiers`, `person_relationships`, `transfer_certificates`) carry no BEFORE DELETE trigger — `memberships`' three are BEFORE INSERT / BEFORE UPDATE / AFTER INSERT-OR-UPDATE (`tgtype` 7 / 19 / 21). Unlike `presby_guard_organizations_delete`, the `people` guard needs **no** `set_config` lines. Say so in the function comment, or the next reader copies the organizations body wholesale and arms two GUCs for nothing.
- The exception message must say **merge, don't delete** (`merged_into_id`, a chain that *is* followed), not "record a lifecycle event." The two invariants differ exactly there.

### (e) The composite FKs — **five, not six, and not four**

| FK | Ruling |
|---|---|
| `events.parent_event_id` | Composite. `events_id_org_key` exists, referencing `organization_id` NOT NULL. Mechanical. |
| `person_milestones.roll_action_id` | Composite. `roll_actions_id_org_key` exists. Mechanical. |
| `publications.supersedes_id` | Composite. `publications_id_org_key` exists. Mechanical. |
| `roll_actions.voids_action_id` | Composite. The highest-value one — *The Roll Is the System of Record*. Mechanical. |
| **`role_grants.role_id → app_roles`** | **Composite — the review called this a design decision; it isn't.** `src/lib/role-definitions.ts:771-850` *adopts* a template by **cloning** it into a new org-scoped `app_roles` row; a template is never granted directly. Live: 15 `role_grants`, **0** referencing a global role, **0** cross-org. With `role_grants.organization_id` NOT NULL and default MATCH SIMPLE, the composite FK admits every legal row **and enforces clone-not-grant at the database** — it converts a code convention into a database property, which is the whole point of the invariant. Requires adding `unique (id, organization_id)` to `app_roles` first (measured absent — only `app_roles_org_key (organization_id, key)` exists). |
| **`groups.group_type_id → group_types`** | **Cannot be composite. Do not attempt it.** `src/lib/groups.ts:33-37` (DECISION-110 ruling 1): *"`groups.group_type_id` ALWAYS RESOLVES TO THE PLATFORM-WIDE TEMPLATE ROW — no per-org custom group types."* Live: **1563 of 1563** `group_types` rows have `organization_id IS NULL`. Under MATCH SIMPLE a composite FK from a NOT NULL `groups.organization_id` to a NULL parent org matches nothing — the constraint would reject **every row in the table**. And the F2 hazard it would close (a group in org B pointing at org A's type) cannot exist, because no org-owned type exists by design. Exclude it, and record *why* in the migration so the next F2 sweep does not reopen it. |

*Root-cause observation (suggestion, not a gate):* `group_types` is classified as a tenant table — it is in `0009`'s `tenant_tables` loop with FORCE RLS and a nullable `organization_id` — while DECISION-110 makes it a global catalog. That one misclassification is the common cause of B-M4, B-L1 **and** this FK question. The policy split treats the symptom correctly and is the right in-scope fix; reclassifying `group_types` to the `permissions` shape belongs in `docs/TODO.md`.

### (f) `group_types` policy split and the call sites — **three sites, not four**

- `src/lib/groups.ts:282`, `:500`, `:586` are genuine escapes caused by the NULL-false predicate; all three collapse to `tx` once the SELECT arm admits globals, and the explanatory comments at `:53-65`, `:227`, `:271`, `:486`, `:584` plus the module-header paragraph delete with them.
- **`src/lib/org-provisioning.ts:286` is not a `group_types` escape.** Measured: `getPlatformDb()` is that module's single connection for the *entire* provisioning transaction — `:286` onward inserts `organizations`, `app_roles`, `app_role_permissions` and `groups` on the same `tx` — and it has to be, because provisioning creates the org, so no org context can exist yet. The analyst's "actually four" corrects the review in the right direction but overshoots by one. Leave it; touching it means moving the whole provisioning transaction, which is not this pipeline.
- Mirror `drizzle/0032:89-106` exactly (drop `tenant_isolation`, four named policies, SELECT admits `organization_id is null`, I/U/D do not), following `drizzle/0028`'s idempotent single-table-override pattern — **never** edit 0009's shared loop.
- **B-L1's unique constraint needs a shape decision, and the obvious one is wrong.** Because every row is global, plain `unique (organization_id, key)` constrains nothing (NULLs are distinct — `drizzle/0032`'s own header already says so). It must be `nulls not distinct` (PG 18 here, available) or a partial unique index on `(key) where organization_id is null` paired with the plain composite. Tech-lead picks and states which, in the migration.

---

## 3. F70 / `SET search_path` — accepted, **and B-M2's reason for rating it MEDIUM is false. I measured it.**

B-M2 rates the DEFINER `search_path` gap not-exploitable because `presby_app` holds no `CREATE` on schema `public` and none on the database. Both are true on this branch (`has_schema_privilege('presby_app','public','CREATE') = f`, `has_database_privilege(…,'CREATE') = f`). But **`has_database_privilege('presby_app', current_database(), 'TEMP')` returns `t`** — `TEMP` is granted to `PUBLIC` by default in PostgreSQL and nothing in `drizzle/` revokes it. And when `pg_temp` is not named in `search_path`, PostgreSQL searches it **first**, ahead of everything including `pg_catalog`. So `SET search_path = public` — the clause seven functions already carry and which this project treats as *the* mitigation — mitigates nothing against a temp-schema shadow.

Live probe, as `presby_app` on `$APP_DATABASE_URL`, entire transaction rolled back:

```
begin;
create temp table people (id uuid);
insert into people values ('00000000-0000-0000-0000-0000000000ff');
set local search_path = public;
select count(*) from people;                              -->  1          (the decoy)
select n.nspname ... where c.oid = 'people'::regclass;    -->  pg_temp_115
select presby_two_factor_required('00000000-...-000000000000');
   ERROR:  column p.user_id does not exist
   CONTEXT:  SQL function "presby_two_factor_required" statement 1
rollback;
```

`presby_two_factor_required` carries `SET search_path = public` and **still** resolved `people` to the caller's temp schema. It errored only because my decoy lacked the columns; a decoy with the right shape makes a `SECURITY DEFINER` predicate return an attacker-chosen answer — and that function is the 2FA enforcement predicate, so the attacker-chosen answer is *"this user does not need 2FA."*

Reachability is still gated behind a SQL-execution foothold, and Section A's injection checklist passed. But the point of the DEFINER `search_path` convention is precisely that one SQL foothold must not also be a privilege escalation. **F70 is not hardening; it closes a live gap that B-M2's stated reasoning declared closed.** Its `public, pg_temp` form, `pg_temp` explicitly last, is correct.

**On the requested assertion:** "assert `presby_app`, `presby_platform` and PUBLIC hold no `CREATE` on schema `public`" is necessary but **insufficient on its own** — it is the exact measurement that produced B-M2's wrong conclusion. Add it, and pair it with (i) the `TEMP` privilege asserted as a known-true fact so the next reader doesn't re-derive safety from the CREATE check alone, and (ii) a direct assertion on `pg_proc.proconfig` that every `prosecdef` function in `public` carries `pg_temp` last. Whether to also `revoke temporary on database … from public` is tech-lead's call — it is blunt on Neon, and the `pg_temp`-last clause is the primary control, the revoke secondary at best.

**Mechanism: `ALTER FUNCTION … SET search_path = public, pg_temp` is the right choice** — it keeps bodies out of 0048 and is idempotent — **with two binding conditions** `[C]`. `CREATE OR REPLACE FUNCTION` **resets `proconfig`** when the replacement carries no `SET` clause, and this project's own drift remediation is to re-apply whole migration files in order (B-H1's fix #1 does exactly that, twice). Re-applying `0009`/`0010`/`0012`/`0013`/`0014`/`0015`/`0020`/`0021`/`0024`/`0028`/`0041`/`0042` would silently strip every clause 0048 installed. Therefore: **(1)** 0048 carries a header statement that it must be re-applied *last* after any earlier file is re-run, and **(2)** `test-rls.sql` asserts the clause on `pg_proc.proconfig`, so the next suite run catches the strip. "Part of the file ran, the corrected part did not" is exactly how B-H1 happened; an `ALTER` without a standing assertion is that trap rebuilt.

**Scope — 14 functions defined in 0001–0042** (mapped by grepping `function <name>` across `drizzle/*.sql`):

- *No clause today (7):* `presby_effective_permissions` (0010), `presby_guard_membership_insert` (0009), `presby_link_person` (0009), `presby_match_person` (0009), `presby_reconcile_current_roll` (0012), `presby_roll_cache_drift` (0012), `presby_sync_current_roll` (0012).
- *`search_path=public`, widen to `public, pg_temp` (7):* `presby_membership_is_active` (0015), `presby_person_unclaimed_or_own_org` (0028), `presby_public_committee_roster` (0042), `presby_public_staff_roster` (0041/0042), `presby_published_site` (0020/0021/0024), `presby_two_factor_required` (0013), `presby_user_organizations` (0014).
- *Excluded, owned by the concurrent lifecycle correction:* `presby_freeze_used_field_spec` (0046) and the nineteen 0043–0047 functions.
- Two gotchas: `presby_published_site` and `presby_public_staff_roster` are each defined in more than one migration — read the exact signature from `pg_proc`, not from the newest-looking file. And `presby_current_org()` is **not** DEFINER (`prosecdef = f`); don't let a name-based sweep pull it in.

---

## 4. Placement

**Dependencies:** none. No new npm package is needed or implied; nothing here is evaluated against the dependency criteria.

**Server vs Client split:** not applicable — no component, no page, no `'use client'`, no route group touched. No brand-scope, no `check:audit` surface.

**Directory placement:**

- **One migration, `drizzle/0048_presby_security_b.sql`. Not two.** `0049` is already pre-assigned: the concurrent `../presby-wt-grants` worktree (branch `pipeline/submission-grants`) names `drizzle/0049_presby_submission_grants.sql` in its own Rule 16 kickoff. Claiming a second number unilaterally is precisely the collision Rule 16 exists to prevent. Section the file by finding; make it whole-file idempotent; prove two consecutive clean runs.
- **`scripts/test-rls.sql`** — one delimited section appended at the end, per the kickoff discipline. Note the file's "RLS suite complete" banner sits at ~line 404 with sections already appended after it; the end is ~line 4871, not the banner.
- **`src/lib/db/domain/*.ts` — yes, five files change:** `events.ts:74`, `roll.ts:89`, `publication.ts:130`, `person-ext.ts:111`, `authz.ts:173` (`role_grants.role_id`) plus a new `unique("app_roles_id_org_key")` in `authz.ts`. Use the idiom already present at `roll.ts:113-118` (`unique(...).on(...)` + `foreignKey({ columns, foreignColumns, name })`). **`src/lib/db/domain/index.ts` does *not* change** — no new table, no new export — which removes one shared-file collision with the 0049 pipeline. Confirm that stays true at Phase 4.
- **`drizzle/meta/_journal.json` — the one item that cannot follow "append at the END."** `[C]` B-L4's three missing entries are `idx` 26/27/28 and the journal is idx-ordered (current entries run to idx 47); appending them after 47 produces an array whose order contradicts its own indices. **Ruling:** 0048's own entry appends at the end as normal; the three back-fill entries are handed to the **orchestrator to apply at integration**, alongside the 0049 pipeline's entry. Do not edit the middle of a shared file on a parallel branch.
- **Application files touched:** `src/lib/groups.ts` (three escapes + header paragraph), `src/app/api/cron/maintenance/route.ts` (reconcile relocation), `scripts/seed.ts` (catalog writes → `platformDb`, see §5), `src/lib/db/index.ts:12` and `scripts/seed.ts:43` (the wrong-role comments).
- **The work-log's `Surface:` line — "none — database layer only" — is now false.** Amend it to name `src/app/api/cron/maintenance/route.ts`, `src/lib/groups.ts`, `scripts/seed.ts`, `src/lib/db/index.ts` and the five `src/lib/db/domain/*.ts` files. This matters for QA's scoping, not just tidiness.

### The catch-all FORCE assertion (C-3) — **invert the predicate, and keep the list in `test-rls.sql`**

A catch-all keyed on *"has an `organization_id` column"* is the **same predicate** as `drizzle/0009`'s `tenant_tables` array — and that predicate is exactly what missed `app_role_permissions`, the one table in this pipeline with a demonstrated cross-tenant write. An assertion built on it would have passed green all year while the hole was open.

**The assertion must be: every table in schema `public` carries `relforcerowsecurity`, except those on an explicit allow-list** — so the 51st table fails closed whether or not it carries an `organization_id`.

Measured on this branch: 83 tables, 58 FORCE, 25 not (26 today, minus `app_role_permissions` once B-H2 lands). Eight of the 58 are FORCE with **no** `organization_id` — `people`, `addresses`, `contact_methods`, `person_identifiers`, `person_relationships`, `administrative_commissions`, `org_delegations`, `transfer_certificates` — so the column predicate is blind in both directions.

- **Where it lives:** in `scripts/test-rls.sql`, as a literal SQL array inside the new appended section, one trailing comment per entry giving the reason. **Not** a `.mjs` tripwire and **not** a second file: the `check:*` tripwires are greps over source text, and this claim is only true of the *live catalog*. Anywhere but the suite that runs as `presby_app` against a real database, it becomes an assertion that passes with or without the mechanism under test — B-H1's exact failure mode.
- **Bonus:** the allow-list is the same ~25 names as B-H3's grant model. Write the list once and cross-reference it from both sections of 0048.
- **The scope block's allow-list is wrong.** `sasr_form_versions` has **no `organization_id` column** (measured) — it is a global catalog and was never a candidate under the column predicate. `organization_identifiers` is the only tenant-shaped exemption, and it is deliberate and documented in its own table comment.

---

## 5. Batching — accept Phase 1's order with three amendments

1. **B-H3 first — keep it, and take this measured blocker with it.** `[C]` `scripts/seed.ts:40` is `const sql = neon(process.env.DATABASE_URL)` — i.e. **`npm run db:seed` runs on `presby_app`** — and `seedRoles()` and its siblings INSERT into `roles`, `features`, `role_features` and `permissions` on that connection. B-H3's punch-list item 2 (`revoke insert, update, delete on permissions, features, role_features, roles from presby_app`) therefore **breaks `db:seed`**, which is itself half of the orchestrator's own Phase 4 acceptance criterion (from-scratch `db:migrate` + first sign-in). The revoke and the seeder change are **one atomic unit**: move those catalog writes to the existing `platformDb` handle in the same file — the precedent and the explanatory comment are already sitting at `scripts/seed.ts:43-52`. While there, that comment says "presby_platform role"; it is `neondb_owner`. **Widen B-I3's housekeeping to cover `scripts/seed.ts:43` as well as `src/lib/db/index.ts:12`.**
2. **Promote F70 to position 2.** It is `ALTER FUNCTION` only, touches no table, has no data dependency, and it is the item whose premise the rest of the review got wrong. Running it early also means every function later batches create or edit inherits the convention rather than retrofitting it.
3. **Fold C-4 into B-L3's batch and re-title it** ("revoke the two roll DEFINER functions from PUBLIC and `presby_app`; relocate the reconcile caller"). Under §2(b) they are one statement pair plus one application edit, and Open Question 2 no longer gates anything.

Otherwise: **B-H2 + B-M4 together** (same `app_roles_select` shape) stays right; **B-M3 + B-L6** stays right; **B-L1 after B-M4** stays right. Two re-rankings:

- **N-6 is not the smallest item** — 45 teardown call sites in 23 files (§2(d)). Schedule it accordingly.
- **C-3 is not orthogonal.** It must land **after** B-H2, or `app_role_permissions` needs a temporary allow-list entry that someone will forget to remove.

---

## Invariants Touched

| Invariant | How this work relates |
|---|---|
| **Isolation Is a Database Property** (F1) | Strengthened. B-H2 closes a demonstrated cross-tenant write; C-3's inverted catch-all makes FORCE a property of the schema rather than of a hand-maintained list; §2(b) removes a cross-org DEFINER read *and* write primitive from the tenant role. No relaxation anywhere. |
| **F26 and its converse** | Clarified, not changed. F26 sanctions DEFINER for a trigger that must see across orgs inside a guarded operation; it does not sanction a parameterless cross-org writer granted to `presby_app`. §2(b) applies the converse the work-log already names. |
| **DECISION-135 — cross-council access is function-mediated** | Reinforced. The sanctioned shape derives its actor from `presby_current_org()` and checks standing first; the two roll functions do neither and are removed from the tenant surface rather than retrofitted into the shape. |
| **F44 — a grant never binds the owner connection** | Central, and honoured twice: the `people` guard is a *trigger* precisely because a revoke cannot reach `neondb_owner`; and `app_role_permissions`' new policy is explicitly documented as binding `presby_app` only. |
| **Composite Tenant Keys (F2)** | Extended to five FKs, with one principled, documented exclusion (`groups.group_type_id`, DECISION-110 ruling 1). `role_grants.role_id` converts a code convention into a database property. |
| **Never Hard-Delete a Person** | Moves from `paper` toward `trigger` on the owner path — with the exemption column that keeps 45 fixture teardowns working. |
| **Permissions vs Flags** | Untouched. No `FEATURES.*` key, no flag, no change to the split. |
| **The Edge Gate Cannot Reach the Database** | Untouched. `src/proxy.ts` is not in scope and gains no import. |
| **The `(org)` contract** | Untouched, and improved at the margin: three `getPlatformDb()` reads leave an org-scoped read path in `src/lib/groups.ts`. The cron relocation adds a `getPlatformDb()` use in `src/app/api/cron/`, which is outside the forbidden subtree. |
| **`docs/schema-design-2.md` §17's "two bespoke policies"** | Doc-only correction (B-L5). Note the scope block says §17 of `schema-design-2.md`; the review quotes `schema-design.md` §17. Phase 3 should confirm which file before editing. |

---

## Notes for Phase 3

1. The five `[C]` items are binding: the `scripts/seed.ts` blocker (§5.1), the `test-rls.sql` single-connection constraint (§2(c)), the `groups.group_type_id` exclusion (§2(e)), the two `ALTER FUNCTION` conditions (§3), and the `_journal.json` mid-file exception (§4). Everything else is a suggestion you may overrule with reasons in the design doc.
2. Four scope facts corrected by measurement, all of which change the Phase 3 file list: **five** composite FKs not six; **three** `getPlatformDb()` escapes not four; **14** functions in the F70 sweep with the 0043–0047 set excluded; and the allow-list is **one** tenant-shaped table, not two.
3. Cross-pipeline: `../presby-wt-grants` (`pipeline/submission-grants`, `drizzle/0049`) will add new `SECURITY DEFINER` functions. Once 0048's `proconfig` assertion is on `development`, those functions must ship with `SET search_path = public, pg_temp` or that pipeline's `test-rls.sql` run fails at integration. Worth a heads-up from the orchestrator before 0049 reaches Phase 4, not after.
4. Proposed `docs/TODO.md` lines for the orchestrator to apply at integration: reclassify `group_types` as a global catalog (root cause of B-M4 / B-L1 / the FK question); close the owner path on `app_role_permissions` with a trigger; the platform-shell DML accessor refactor that DECISION-146 names as the prerequisite for a third connection; and the already-agreed deferrals B-M1, B-M2 (residual), B-L2, B-L5, B-I1–I6.
5. Proposed decision entry: **DECISION-146** as drafted in §1 (architectural — I own it). The C-4 test-redesign fork does **not** need its own decision line now: §2(b)/§2(c) dissolve the fork rather than narrowing a CLAUDE.md invariant, so there is nothing to record beyond the migration's own comment.

**Handoff:** to **tech-lead** for Phase 3. The open mechanism choices left deliberately to you: the `group_types` unique-constraint form (`nulls not distinct` vs partial index); where the cache-health `= 0` data claim lands once it leaves `test-rls.sql`; whether the maintenance cron takes two connections or moves wholesale; and whether to pair the `pg_temp`-last clause with a `revoke temporary … from public`.



### Orchestrator notes (2026-09-25)

- The §3 live probe (temp-table shadowing of `people` inside `presby_two_factor_required()` despite `SET search_path = public`) is forwarded to the lifecycle pipeline's eleventh loop-back (F60, main tree) so its in-place fix of 0043–0047 and this pipeline's 0048 share one `proconfig` assertion shape: "every `prosecdef` function in `public` carries a `search_path` ending in `pg_temp`", with a dated allow-list on whichever side lands first.
- `_journal.json` idx 26/27/28 back-fill: orchestrator applies at integration, as ruled.
- The work-log `Surface:` line is amended per §4 in the same edit as this record.

---


# Phase 3 — Technical Design (tech-lead)

*Every catalog/grant/policy/constraint claim below was measured directly against `pipeline-security-schema-b` (`MIGRATE_DATABASE_URL` = `neondb_owner`, read-only queries; nothing written) on 2026-09-25, not inferred from Phase 2's prose. Where a measurement corrects or sharpens Phase 2, that is called out inline.*

## Summary

`drizzle/0048_presby_security_b.sql` closes nine measured defects in the isolation/grant model (an unpoliced tenant-write table, a cross-org DEFINER read+write pair reachable from the tenant role, an undocumented and overly-broad `presby_app` grant shape, a search-path-based `SECURITY DEFINER` bypass proven live via temp-table shadowing, an invisible-by-construction global catalog, 1,557 duplicate rows in that catalog, five single-column tenant→tenant FKs, and a permanent-record table with no owner-path delete guard) plus a hardened, catalog-driven FORCE-RLS assertion — all in one migration, so the posture is reproducible from `drizzle/` alone rather than depending on undocumented live grants. Five small application edits ride along because they are the direct, mechanical consequence of the schema/grant changes: two `scripts/seed.ts` catalog-write blockers (not one — Phase 2 named `permissions`/`features`/`role_features`/`roles`; measurement below adds `feature_flags`), three `getPlatformDb()` escapes in `src/lib/groups.ts` that the `group_types` policy fix removes, and one connection swap in the maintenance cron. No page, route group, permission, or flag changes.

## Permissions & Flags

None. No `FEATURES.*` key is added, removed, or rebound. No flag is added or toggled. (Confirms Phase 1/Phase 2.)

## API Contract

No HTTP routes and no new server actions. The public surface that changes is SQL function grants/signatures and two TypeScript module-internal call sites:

- `presby_reconcile_current_roll() returns integer` — signature unchanged; `EXECUTE` revoked from `PUBLIC` and `presby_app`, so its only remaining caller is the owner connection.
- `presby_roll_cache_drift() returns table(...)` — signature unchanged; same revoke. No remaining caller in application code (ops-only, via `neondb_owner`, ad hoc).
- `presby_guard_people_delete() returns trigger` — new, `SECURITY DEFINER`, `SET search_path = public, pg_temp` at creation (so it is never a 15th non-compliant function on day one).
- Fourteen existing `SECURITY DEFINER` functions gain or widen `SET search_path` — see §3 below. No argument list changes on any of them.
- `src/app/api/cron/maintenance/route.ts`'s `GET` handler — unchanged request/response shape; internally, the `presby_reconcile_current_roll()` call moves from `db` to `getPlatformDb()`.
- `src/lib/groups.ts`'s exported function signatures (`listGroups`, `getGroupFormOptions`, `createGroup`, …) — unchanged; three internal `getPlatformDb()` reads become `tx` reads.

## Data Model

`drizzle/0048_presby_security_b.sql`, one file, sectioned in the order below (rationale: Phase 2's binding amendments are "F70 second" and "fold C-4 into B-L3," both satisfied; everything else is my ordering, chosen to keep same-table work — `group_types`' policy split and its de-dup — adjacent, and to put the FORCE catch-all, which depends on B-H2 already having landed, in `test-rls.sql` rather than fight over migration-internal position):

1. Header/preamble
2. B-H3 — grant model
3. F70 — `SET search_path` on 14 functions + `TEMP` revoke
4. B-H2 — `app_role_permissions` RLS + four policies
5. B-M4 + B-L1 — `group_types` policy split, then de-dup + `NULLS NOT DISTINCT` constraint
6. C-4 + B-L3 — revoke both roll functions from `PUBLIC`/`presby_app`
7. B-M3 + B-L6 — five composite FKs + three missing indexes
8. N-6 — `people` delete guard + `deletable_until`
9. Housekeeping — journal note, comment-fix pointers (the actual `.ts` comment edits are application-file changes, listed under Files to Modify)

Full DDL by section:

### 1. Header (file-level, no DDL)

```sql
-- drizzle/0048_presby_security_b.sql
--
-- Security review round B (docs/reviews/2026-09-25-security.md §B,
-- docs/reviews/2026-09-25-test-coverage.md C-3/C-4, external review F70).
-- Whole-file idempotent; safe to re-run.
--
-- *** MUST BE THE LAST FILE RE-APPLIED IF ANY EARLIER drizzle/*.sql FILE IS
-- *** RE-RUN AS PART OF DRIFT REMEDIATION (B-H1's own remediation shape).
-- *** `CREATE OR REPLACE FUNCTION` RESETS `proconfig` WHEN THE REPLACEMENT
-- *** CARRIES NO `SET` CLAUSE OF ITS OWN. Section 3 below `ALTER FUNCTION`s
-- *** twelve functions defined in 0009/0010/0012/0013/0014/0015/0020/0021/
-- *** 0024/0028/0041/0042; re-running any of those files after this one
-- *** would silently strip the search_path clause this file installs.
-- *** scripts/test-rls.sql's proconfig assertion (added alongside this file)
-- *** is what catches that if it happens anyway.
```

### 2. B-H3 — the grant model

The 25-name allow-list below is shared with §9's FORCE catch-all in `scripts/test-rls.sql` — write it once as a SQL array both sections can reference via a `do $$` block, or duplicate the literal list with a comment cross-referencing the other location (implementer's call; a `do $$` shared list is cleaner but the two files are different psql invocations, so in practice this will be two literal arrays kept in sync by comment, not one variable).

```sql
-- Restated from 0009 (idempotent no-ops against a live database; the point
-- is that the file is self-sufficient, not a delta against undocumented
-- history):
grant usage on schema public to presby_app, presby_platform;
grant usage, select on all sequences in schema public to presby_app, presby_platform;

-- Full CRUD. Measured: every one of these 14 has an INSERT/UPDATE/DELETE
-- call site on `db` today (src/auth.ts's DrizzleAdapter; src/app/(account)/,
-- src/app/(auth)/totp/, src/app/(admin)/admin/users/, src/app/
-- (password-reset)/; src/lib/totp-pending.ts; src/lib/rate-limit.ts writes
-- nothing here but audit_events is handled separately below).
grant select, insert, update, delete on
  users, accounts, sessions, verification_tokens,
  user_totp, user_totp_recovery_codes, user_totp_pending_enrollments,
  password_reset_tokens, email_verification_tokens,
  user_roles, whats_new_entries, email_queue, feedback, feedback_prompt_state
to presby_app;

-- Append-only. Measured: src/lib/audit.ts, src/lib/email/queue.ts,
-- src/lib/rate-limit.ts INSERT only, never UPDATE or DELETE.
grant select, insert on audit_events to presby_app;
revoke update, delete on audit_events from presby_app;

-- Not select-only: src/app/(admin)/admin/flags/actions.ts UPDATEs it on db.
-- No INSERT grant: the only INSERT into feature_flags anywhere is
-- scripts/seed.ts's seedFlags(), which moves to platformDb below (§5.1 of
-- Phase 2 named four catalog tables needing this move; feature_flags is a
-- fifth this design adds — measured, not in Phase 2's list).
grant select, update on feature_flags to presby_app;
revoke insert, delete on feature_flags from presby_app;

-- Global catalogs, code- or migration-seeded, never tenant-writable.
-- scripts/seed.ts's seedRoles/seedFeatures/bindAdminFeatures/
-- bindSupportOperatorFeatures move to platformDb (§5.1) so this revoke does
-- not break `npm run db:seed`.
grant select on permissions, features, role_features, roles, migration_seeds to presby_app;
revoke insert, update, delete on permissions, features, role_features, roles, migration_seeds from presby_app;

-- Org tree: public information, restated for completeness (already correct
-- live; F44 — presby_app never gets more than select here regardless).
grant select on organizations, organization_identifiers, organization_successions to presby_app;
-- sasr_form_versions carries no organization_id at all — global catalog,
-- never a tenant table under any predicate.
grant select on sasr_form_versions to presby_app;
```

No `revoke all ... from presby_app` reset-to-zero step: measured, every grant above already matches the live shape exactly (the "drift" B-H3 describes is that none of it is *written down*, not that it is wrong) — restating each grant is a true no-op, and the file stays reproducible from empty without a wide-then-narrow two-step that would itself need to be proven safe against tables this list does not name.

### 3. F70 — `SET search_path` on the fourteen 0001–0042 `SECURITY DEFINER` functions

Exact signatures read from `pg_proc` on this branch (not guessed from the newest-looking migration file):

```sql
alter function presby_effective_permissions(p_person_id uuid, p_organization_id uuid, p_as_of date) set search_path = public, pg_temp;
alter function presby_guard_membership_insert() set search_path = public, pg_temp;
alter function presby_link_person(p_reason text, p_evidence text, p_person_id uuid, p_acting_user_id uuid) set search_path = public, pg_temp;
alter function presby_match_person(p_last_name text, p_first_name text, p_date_of_birth date, p_identifiers jsonb) set search_path = public, pg_temp;
alter function presby_reconcile_current_roll() set search_path = public, pg_temp;
alter function presby_roll_cache_drift() set search_path = public, pg_temp;
alter function presby_sync_current_roll() set search_path = public, pg_temp;
alter function presby_membership_is_active(p_person_id uuid, p_organization_id uuid) set search_path = public, pg_temp;
alter function presby_person_unclaimed_or_own_org(p_person_id uuid) set search_path = public, pg_temp;
alter function presby_public_committee_roster(p_slug text, p_committee text, p_has_priority boolean) set search_path = public, pg_temp;
alter function presby_public_staff_roster(p_slug text, p_kind text, p_has_priority boolean) set search_path = public, pg_temp;
alter function presby_published_site(p_slug text) set search_path = public, pg_temp;
alter function presby_two_factor_required(p_user_id uuid) set search_path = public, pg_temp;
alter function presby_user_organizations(p_user_id uuid) set search_path = public, pg_temp;

-- Belt and braces (§F70's live probe): no legitimate application use of
-- temp tables by presby_app exists anywhere in src/ (the one CREATE
-- TEMPORARY TABLE in drizzle/ is inside 0047, run by the migration owner,
-- never by presby_app). Closes the mechanism at the privilege layer too,
-- not just the search_path layer.
do $$ begin
  execute format('revoke temporary on database %I from public', current_database());
end $$;
```

`presby_current_org()` is confirmed `prosecdef = f` and correctly excluded — it is not a `SECURITY DEFINER` function and carries no privilege to escalate.

### 4. B-H2 — `app_role_permissions`

Measured: `relrowsecurity = f`, `relforcerowsecurity = f` today — no policy exists at all, not merely a missing `FORCE`.

```sql
alter table app_role_permissions enable row level security;
alter table app_role_permissions force row level security;

drop policy if exists app_role_permissions_select on app_role_permissions;
drop policy if exists app_role_permissions_insert on app_role_permissions;
drop policy if exists app_role_permissions_update on app_role_permissions;
drop policy if exists app_role_permissions_delete on app_role_permissions;

-- OR r.organization_id IS NULL kept per Phase 2 review note 1: belt-and-
-- braces today (app_roles_select already admits globals), load-bearing the
-- day a template's own bindings become readable through this path rather
-- than only through presby_effective_permissions()'s DEFINER bypass.
create policy app_role_permissions_select on app_role_permissions for select
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and (r.organization_id = presby_current_org() or r.organization_id is null)
  ));

create policy app_role_permissions_insert on app_role_permissions for insert
  with check (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

-- No live UPDATE caller (measured: role-definitions.ts uses INSERT/DELETE
-- only) but defined for consistency with every other RLS table's four-
-- policy shape; UPDATE stays revoked below so the policy is inert until a
-- future caller and review deliberately grants it.
create policy app_role_permissions_update on app_role_permissions for update
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ))
  with check (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

create policy app_role_permissions_delete on app_role_permissions for delete
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

-- Restated (already live — this is the B-H3 drift this table shares):
grant select, insert, delete on app_role_permissions to presby_app;
revoke update on app_role_permissions from presby_app;
```

This binds `presby_app` only (F44) — the owner write path stays open; the migration's own comment says so explicitly per Phase 2 review note 4, and closing it is a trigger, named in the TODO proposal below, not built here.

### 5. B-M4 + B-L1 — `group_types`

Policy split first (mirrors `drizzle/0032`'s exact pattern, `drizzle/0028`'s idempotent single-table-override style — never touching 0009's shared loop):

```sql
drop policy if exists tenant_isolation on group_types;
drop policy if exists group_types_select on group_types;
drop policy if exists group_types_insert on group_types;
drop policy if exists group_types_update on group_types;
drop policy if exists group_types_delete on group_types;

create policy group_types_select on group_types for select
  using (organization_id = presby_current_org() or organization_id is null);
create policy group_types_insert on group_types for insert
  with check (organization_id = presby_current_org());
create policy group_types_update on group_types for update
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
create policy group_types_delete on group_types for delete
  using (organization_id = presby_current_org());
-- grant unchanged — already select, insert, update, delete to presby_app
-- from the 0009 loop; a policy split needs no new grant.
```

De-dup, then the constraint. Measured: 1,563 rows, 100% `organization_id IS NULL`, 6 distinct keys, 1,557 duplicates; casing drift too (`roster`/`Roster`, `court`/`Court`, `committee`/`Committee`) with no `created_at` column to order by. Canonical-row choice is deliberately data-driven (smallest `id` survives; `groups.group_type_id` is repointed to it first), and the survivor's `name` is then forced to match `scripts/seed.ts`'s current catalog value regardless of which row won the id race — not left to chance:

```sql
-- Repoint every managed group to one canonical row per key before any row
-- is removed.
with canonical as (
  select key, min(id) as canonical_id
    from group_types
   where organization_id is null
   group by key
)
update groups g
   set group_type_id = c.canonical_id
  from group_types gt
  join canonical c on c.key = gt.key
 where g.group_type_id = gt.id
   and gt.organization_id is null
   and gt.id <> c.canonical_id;

delete from group_types gt
 using (
   select key, min(id) as canonical_id
     from group_types
    where organization_id is null
    group by key
 ) c
 where gt.organization_id is null
   and gt.key = c.key
   and gt.id <> c.canonical_id;

-- Normalize the name of whichever row survived to match the live catalog
-- (scripts/seed.ts's seedGroupTypes()) — do not leave the casing lottery's
-- outcome as the permanent display name.
update group_types set name = case key
  when 'court' then 'Court'
  when 'roster' then 'Roster'
  when 'committee' then 'Committee'
  when 'small_group' then 'Small Group'
  when 'choir' then 'Choir'
  when 'team' then 'Team'
  else name
end
where organization_id is null;

drop index if exists group_types_org_idx;
alter table group_types add constraint group_types_org_key
  unique nulls not distinct (organization_id, key);
```

Verified zero live `groups` rows reference a row this DELETE removes except through the repoint above (measured: exactly one distinct `group_type_id` is referenced per key today, and it is already the seed-fixture row — the repoint UPDATE is a no-op on this branch and a real safety net on any branch where it isn't).

`groups.group_type_id` itself stays a **plain, single-column FK** — Phase 2's ruling, reconfirmed: 1,563/1,563 (now 6/6 post-dedup) `group_types` rows have `organization_id IS NULL`, so a composite FK under MATCH SIMPLE would reject every row in the table. Do not touch this FK.

### 6. C-4 + B-L3 — revoke both roll functions

```sql
revoke all on function presby_reconcile_current_roll() from public, presby_app;
revoke all on function presby_roll_cache_drift() from public, presby_app;
```

Neither function's `EXECUTE` was ever explicitly revoked from `PUBLIC` in `drizzle/0012` — `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default, which is the actual mechanism behind "granted to PUBLIC" (not a separate explicit grant statement to find and delete). `neondb_owner` is unaffected — an owner's privileges on its own objects survive a `revoke ... from public, presby_app` that does not name the owner.

### 7. B-M3 + B-L6 — five composite FKs + three missing indexes

All five verified zero-violation against live data before writing this (a real `pg_constraint`-would-reject-the-ADD check, not an assumption):

```sql
alter table events drop constraint events_parent_event_id_fkey;
alter table events add constraint events_parent_fk
  foreign key (parent_event_id, organization_id) references events (id, organization_id);

alter table person_milestones drop constraint person_milestones_roll_action_id_roll_actions_id_fk;
alter table person_milestones add constraint person_milestones_roll_action_fk
  foreign key (roll_action_id, organization_id) references roll_actions (id, organization_id);
create index person_milestones_roll_action_idx on person_milestones (roll_action_id);

alter table publications drop constraint publications_supersedes_id_fkey;
alter table publications add constraint publications_supersedes_fk
  foreign key (supersedes_id, organization_id) references publications (id, organization_id);

alter table roll_actions drop constraint roll_actions_voids_action_id_roll_actions_id_fk;
alter table roll_actions add constraint roll_actions_voids_fk
  foreign key (voids_action_id, organization_id) references roll_actions (id, organization_id);
create index roll_actions_voids_idx on roll_actions (voids_action_id);

alter table app_roles add constraint app_roles_id_org_key unique (id, organization_id);

alter table role_grants drop constraint role_grants_role_id_app_roles_id_fk;
alter table role_grants add constraint role_grants_role_fk
  foreign key (role_id, organization_id) references app_roles (id, organization_id) on delete cascade;
create index role_grants_role_idx on role_grants (role_id);
```

`events.parent_event_id` and `publications.supersedes_id` needed no new index (`events_org_parent_idx` and `publications_supersedes_idx`/`publications_supersedes_once_idx` already cover the access pattern, both measured live). `person_milestones.roll_action_id`, `roll_actions.voids_action_id`, and `role_grants.role_id` had none at all (measured) — this is B-L6.

`role_grants_role_fk`'s `on delete cascade` reproduces the single-column FK's existing cascade behavior exactly (`role_grants.role_id -> app_roles.id ON DELETE CASCADE` today) — not a behavior change, a shape change. This is the first composite `foreignKey()` in the codebase to chain `.onDelete()`; `ForeignKeyBuilder.onDelete()` is a standard, typed Drizzle API (verified against `node_modules/drizzle-orm/pg-core/foreign-keys.d.ts`), just unprecedented here.

**Feasibility note (self-referencing composite FKs):** `roll_actions.voids_action_id -> roll_actions` and `publications.supersedes_id -> publications` are self-referential composites. Verified against `node_modules/drizzle-orm/pg-core/table.js`: the third `pgTable()` argument (the `(t) => [...]` array) is stored as `table[ExtraConfigBuilder]` and is **not invoked until after the module finishes loading** — unlike `.references()` on a column, which is evaluated as part of the same synchronous `pgTable()` call and therefore needs the `(): AnyPgColumn => x.id` lazy-thunk idiom this codebase already uses for the single-column version. A composite `foreignKey({ foreignColumns: [rollActions.id, rollActions.organizationId], ... })` inside the `(t) => [...]` array needs **no thunk** — plain column references are correct, matching the non-self-referential composites (`person_milestones_person_fk`, `role_grants_person_fk`) already in the codebase. Confirmed by the fact that `roll.ts` already has one self-referencing single-column FK (`voidsActionId`) sitting in the same file as a non-self composite (`roll_actions_person_fk`) with no special handling beyond the single-column thunk — the mechanism generalizes.

### 8. N-6 — `people` delete guard

Mirrors `presby_guard_organizations_delete()` (`drizzle/0044`) with **no cascade pre-arming** — measured, `people`'s six `ON DELETE CASCADE` children (`addresses`, `contact_methods`, `memberships`, `person_identifiers`, `person_relationships`, `transfer_certificates`) carry no `BEFORE DELETE` trigger of their own, unlike `organizations`' two guarded children. Comment says so explicitly, so the next reader does not copy the two `set_config` lines wholesale:

```sql
alter table people add column if not exists deletable_until timestamptz;
comment on column people.deletable_until is
  'Test-fixture deletion window, and NOTHING else — the people-table twin of organizations.deletable_until (drizzle/0044). presby_guard_people_delete() permits a DELETE only while this is non-null and in the future. Production person rows never carry a value here; a person who leaves is a roll action (transfer/death/removal), never a deleted row — merged_into_id is the one other legitimate reason a row disappears from view, and that is a merge, not a delete.';

create or replace function presby_guard_people_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.deletable_until is null or old.deletable_until <= now() then
    raise exception
      'people: a person record is never hard-deleted; record a merge instead (merged_into_id)'
      using errcode = 'insufficient_privilege';
  end if;
  -- Unlike presby_guard_organizations_delete(): NO set_config calls here.
  -- people's six ON DELETE CASCADE children carry no BEFORE DELETE guard of
  -- their own (measured 2026-09-25) — there is nothing to pre-authorize.
  return old;
end $$;

drop trigger if exists people_guard_delete on people;
create trigger people_guard_delete
  before delete on people
  for each row execute function presby_guard_people_delete();
```

`people` is already `presby_app = arw` (DELETE clawed back in `0009:376`) — this guard is purely an owner-path control, `organizations`' exact case, F44's exact reasoning.

### 9. Housekeeping

- `drizzle/meta/_journal.json`: this pipeline appends its **own** entry (`idx: 48, tag: "0048_presby_security_b"`) at the end of the array in the normal course of things — `48 > 47` so this is an ordinary append, not the mid-array insert the 26/27/28 backfill needs. The 26/27/28 backfill itself stays the orchestrator's job at integration (Phase 2 §4, binding).
- `docs/schema-design.md`/`docs/schema-design-2.md` "two bespoke policies" correction (B-L5): grepped both files — neither contains that literal phrase today; the closest anchor is `docs/schema-design.md`'s section 17 (referenced by `publication.ts`'s own header comment, "F2's structural exception"). Flagging the exact wording fix as a TODO line rather than guessing at prose to replace; out of this design's core mechanism and out of my write scope regardless (I do not edit `docs/` files).

## Component / Page Plan

Not applicable — no pages, no components. Files to modify (full list, all outside this design doc's own write scope; handed to the Phase 4 implementer):

**Schema / migration:**
- `drizzle/0048_presby_security_b.sql` — new, full content per Data Model above.
- `src/lib/db/domain/events.ts` — add `foreignKey` to the pg-core import; drop `AnyPgColumn` (now unused once `parentEventId`'s `.references()` is removed — leaving it in trips `@typescript-eslint/no-unused-vars` under `npm run lint`); change `parentEventId: uuid("parent_event_id").references((): AnyPgColumn => events.id)` to a plain `uuid("parent_event_id")`; add `foreignKey({ columns: [t.parentEventId, t.organizationId], foreignColumns: [events.id, events.organizationId], name: "events_parent_fk" })` to the `(t) => [...]` array.
- `src/lib/db/domain/person-ext.ts` — change `rollActionId: uuid("roll_action_id").references(() => rollActions.id)` to plain `uuid("roll_action_id")`; add `foreignKey({ columns: [t.rollActionId, t.organizationId], foreignColumns: [rollActions.id, rollActions.organizationId], name: "person_milestones_roll_action_fk" })` and `index("person_milestones_roll_action_idx").on(t.rollActionId)` to the array (`foreignKey` already imported).
- `src/lib/db/domain/publication.ts` — change `supersedesId: uuid("supersedes_id").references((): AnyPgColumn => publications.id)` to plain `uuid("supersedes_id")`; drop the now-unused `AnyPgColumn` import; add `foreignKey({ columns: [t.supersedesId, t.organizationId], foreignColumns: [publications.id, publications.organizationId], name: "publications_supersedes_fk" })` to the array.
- `src/lib/db/domain/roll.ts` — change `voidsActionId: uuid("voids_action_id").references((): AnyPgColumn => rollActions.id)` to plain `uuid("voids_action_id")`; drop the now-unused `AnyPgColumn` import; add `foreignKey({ columns: [t.voidsActionId, t.organizationId], foreignColumns: [rollActions.id, rollActions.organizationId], name: "roll_actions_voids_fk" })` and `index("roll_actions_voids_idx").on(t.voidsActionId)` to the array.
- `src/lib/db/domain/authz.ts` — add `unique("app_roles_id_org_key").on(t.id, t.organizationId)` to `appRoles`'s array; change `roleGrants.roleId`'s column def from `.references(() => appRoles.id, { onDelete: "cascade" })` to a plain `.notNull()` `uuid("role_id")`; add `foreignKey({ columns: [t.roleId, t.organizationId], foreignColumns: [appRoles.id, appRoles.organizationId], name: "role_grants_role_fk" }).onDelete("cascade")` and `index("role_grants_role_idx").on(t.roleId)` to `roleGrants`'s array.
- `src/lib/db/domain/groups.ts` — add `.nullsNotDistinct()` chain and rename to `unique("group_types_org_key")` on `groupTypes`'s existing `(organizationId, key)` constraint entry; remove the now-redundant `index("group_types_org_idx")` entry (dropped in the migration).
- `src/lib/db/domain/people.ts` — add `deletableUntil: timestamp("deletable_until", { withTimezone: true })` to `people`'s column list, matching `organizations.deletableUntil`'s exact type.

**Grant/seed:**
- `scripts/seed.ts` — move `seedRoles()`, `seedFeatures()`, `seedFlags()`, `bindAdminFeatures()`, `bindSupportOperatorFeatures()`'s catalog writes from `db` to the file's existing `platformDb` handle (five functions, not the four Phase 2 named — measured: `seedFlags()`'s `INSERT ... onConflictDoNothing()` into `feature_flags` is a sixth live write this revoke would break, matching the class of bug Phase 2's own §5.1 blocker exists to catch, one measurement further). Correct the `:43-52` comment's "presby_platform role" to name `neondb_owner` (see `src/lib/db/index.ts` below — same fix, same wording).
- `src/lib/db/index.ts` — correct line 12's `platformDb  presby_platform.` to state the actual connecting role: `platformDb  neondb_owner (via PLATFORM_DATABASE_URL).` plus a one-line note that `presby_platform` exists in the catalog but is `rolcanlogin = false` and nothing connects as it (DECISION-146).

**Application (mechanical follow-ons of the grant/policy fix, not new logic):**
- `src/lib/groups.ts` — `groupTypeNamesByIds()` (~line 271), `getGroupFormOptions()` (~line 486), `createGroup()`'s re-validation (~line 584): each `getPlatformDb()...from(groupTypes)` read becomes `tx...from(groupTypes)` now that `group_types_select` admits `organization_id is null`. Delete the module-header paragraph ("READING `group_types` PLATFORM-TEMPLATE ROWS REQUIRES `getPlatformDb()`...") and its three inline call-site comments explaining the same now-obsolete constraint. `src/lib/org-provisioning.ts:286` is **not** touched — confirmed (Phase 2) it is the single connection for the whole org-creation transaction, not a `group_types`-specific escape.
- `src/app/api/cron/maintenance/route.ts` — import `getPlatformDb` alongside `db`; the three token `DELETE`s stay on `db` (measured: least-privilege shape per Phase 2 — narrowing the three-connection option was rejected because it would widen those DELETEs from `presby_app` to owner for no reason); only the `select presby_reconcile_current_roll() as fixed` statement moves to `getPlatformDb()`.

**Test fixtures (N-6's actual size):**
- 23 test files, 32 measured `insert(people)` fixture call sites (Phase 2's "45 call sites" figure counts related insert+delete+cascade references across the same files; 32 is the precise set of edit points). Each file's person-fixture factory gains `deletableUntil: fixtureDeletableUntil()` on every `platform.insert(people).values({...})`, reusing the **existing, already-generic** helper at `src/lib/db/fixture-deletable.ts` — it returns a bare `Date`, with no organization-specific typing, despite its doc comment currently describing only the organizations use. **Ruling: reuse the same helper, don't write a second one.** The helper's doc comment gets a one-line addition noting it is now used for both `organizations.deletableUntil` and `people.deletableUntil` fixture stamps. Files: `src/app/(org)/o/[slug]/admin/staff/actions.test.ts`, `src/lib/people.test.ts`, `src/lib/events.test.ts`, `src/lib/groups.test.ts`, `src/lib/roll.test.ts`, `src/lib/role-grants.test.ts`, `src/lib/directory.test.ts`, `src/lib/people-update.test.ts`, `src/lib/role-definitions.test.ts`, `src/lib/org-features.test.ts`, `src/lib/tenant-branding.test.ts`, `src/lib/officers.test.ts`, `src/lib/tickets.test.ts`, `src/lib/children.test.ts`, `src/lib/person-sensitive.test.ts`, `src/lib/presbytery.test.ts`, `src/lib/staff.test.ts`, `src/lib/org-feature-categories.test.ts`, `src/lib/sites.test.ts`, `src/lib/credentials.test.ts`, `src/lib/brand/read-org-brand.test.ts`, `src/lib/org-portal/find-person.test.ts`, `src/lib/org-portal/home-data.test.ts`. **This is stamped at fixture INSERT time, not at teardown** — same rationale as the organizations precedent (Ruling 7.3, `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`): every existing `platform.delete(people)` teardown line keeps working untouched, with zero new disable/enable-trigger blocks. **No different signal is used** — the guard does not exempt on a GUC, a session variable, or a table comment; it is the identical `deletable_until` timestamp mechanism, full stop.

**`scripts/test-rls.sql`** — one section appended at the end (current EOF ~line 4871), covering (b) below.

## Implementation Order

1. `src/lib/db/domain/*.ts` (5 files) — FK/index/unique declarations, so the migration's DDL and the schema-as-declared agree before either is applied.
2. `drizzle/0048_presby_security_b.sql` — apply via `db:migrate` on the pipeline's Neon branch; append the journal entry.
3. `scripts/seed.ts` — the six-function connection swap (one atomic unit with the migration's catalog-table revokes; a migration-only commit would leave `db:seed` broken).
4. `scripts/test-rls.sql` — the appended section (below), plus the deletion of the one now-broken `presby_roll_cache_drift()` call (see Edge Cases & Risks — this is a necessary, narrow, single-location exception to the "append only at the end" file discipline).
5. `src/lib/groups.ts` + `src/app/api/cron/maintenance/route.ts` — the two application follow-ons, last, because they depend on the final grant/policy shape being locked, not on anything upstream depending on them.
6. Test-fixture edits (23 files) — can run in parallel with 4–5; independent of both.
7. `src/lib/db/index.ts` comment fix — any time; zero runtime effect.
8. Acceptance criteria (below) — run after all of the above.

No `FEATURE_CATALOG` entry, no UI, no release-notes-worthy user-visible behavior (Rule 13 does not apply — this is internal hardening, not member-visible).

## (b) `scripts/test-rls.sql` appended section

Modeled on the existing `assert_eq(actual, expected, label)` helper already used throughout the file (e.g. the B-M2 `search_path=public` count assertion around the current EOF). New assertions, by name:

1. **`presby_app`/`presby_platform`/`PUBLIC` hold no `CREATE` on schema `public` or the database** (the exact measurement that produced B-M2's wrong "not exploitable" conclusion — asserted here so it can never again be read as sufficient on its own):
   ```sql
   select assert_eq(
     (select count(*) from (values
        (has_schema_privilege('presby_app','public','CREATE')),
        (has_database_privilege('presby_app', current_database(), 'CREATE')),
        (has_schema_privilege('presby_platform','public','CREATE')),
        (has_database_privilege('presby_platform', current_database(), 'CREATE')),
        (has_schema_privilege('public','public','CREATE')),
        (has_database_privilege('public', current_database(), 'CREATE'))
      ) as t(v) where v),
     0, 'F70: presby_app, presby_platform, and PUBLIC hold no CREATE on schema public or the database');
   ```
2. **The `TEMP` fact, asserted as known-true, not as a safety property** (so the next reader does not re-derive "safe" from assertion 1 alone):
   ```sql
   select assert_eq(
     has_database_privilege('presby_app', current_database(), 'TEMP'),
     true, 'F70: presby_app inherits PUBLIC default TEMP — search_path pg_temp-last is the control, not the absence of TEMP, unless the revoke below is also in place');
   ```
   (Left as a documented known-true fact, not flipped to `false`, because whether the `revoke temporary ... from public` in §3 actually lands is asserted separately, next.)
3. **The revoke landed:**
   ```sql
   select assert_eq(
     has_database_privilege('presby_app', current_database(), 'TEMP'),
     false, 'F70: TEMPORARY revoked from PUBLIC on this database — presby_app can no longer CREATE TEMP TABLE at all');
   ```
   (Supersedes assertion 2's premise once the revoke ships — the two are written as two separate, individually-readable claims rather than one, so a future partial rollback of the revoke fails loudly at the right assertion.)
4. **`proconfig` on every `prosecdef` function in `public`, dated allow-list:**
   ```sql
   select assert_eq(
     (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and p.proname not in (
           -- Allow-listed until the concurrent lifecycle-pipeline round lands
           -- 'public, pg_temp' in place on main (F60, dated 2026-09-25) —
           -- see docs/reviews/log.md for when this list should shrink to
           -- empty and this comment should be deleted.
           'presby_apply_affiliation_to_org_tree','presby_apply_affiliation_row',
           'presby_apply_lifecycle_event','presby_assert_council_authority',
           'presby_check_about_org_affiliated','presby_check_affiliation_authority',
           'presby_check_lifecycle_authority','presby_check_publication_supersession',
           'presby_check_return_about_org','presby_check_succession_event',
           'presby_freeze_used_field_spec','presby_guard_organizations_delete',
           'presby_guard_organizations_insert','presby_guard_organizations_reparent',
           'presby_list_own_congregation_publications',
           'presby_list_published_returns_to_me','presby_org_affiliated',
           'presby_publish_sasr_snapshot','presby_set_organization_identifier',
           'presby_transfer_affiliation'
         )
         and not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[])))),
     0, 'F70: every SECURITY DEFINER function in public (outside the dated 0043-0047 allow-list) pins search_path = public, pg_temp');
   ```
   **Ruling on the dated-allow-list question:** allow-listed, not asserted, for now. The orchestrator's note (end of Phase 2) already routes the live pg_temp-shadowing probe to the lifecycle pipeline's eleventh loop-back so 0043–0047's functions get `public, pg_temp` in place, concurrently, on `main`. Asserting them here today would make this suite fail on `development` the moment it merges, before that concurrent work lands — a false failure this design should not manufacture. The list is the same 19 named in the existing B-M2 assertion plus `presby_guard_organizations_insert`/`_reparent`/`_delete` (DEFINER, no search_path measured on those three either, on this branch) and `presby_freeze_used_field_spec` — 20 by count on this branch's measurement; exact membership must be re-verified by the Phase 4 implementer against whatever `development` looks like when this migration is actually applied, since the lifecycle pipeline is moving concurrently (Rule 16 risk, named explicitly).
5. **Grant-shape assertions, one per B-H3 table-class** (full arwd class, audit_events, feature_flags, catalog class, org-tree class) — same `has_table_privilege(...)` idiom already used elsewhere in the file for grant assertions; not reproduced in full here since the pattern is mechanical once the allow-list from §(a) exists as a literal array in this file too.
6. **The FORCE catch-all (C-3), inverted predicate:**
   ```sql
   select assert_eq(
     (select count(*) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity
         and c.relname not in (
           'users','accounts','sessions','verification_tokens',
           'user_totp','user_totp_recovery_codes','user_totp_pending_enrollments',
           'password_reset_tokens','email_verification_tokens',
           'user_roles','whats_new_entries','email_queue','feedback','feedback_prompt_state',
           'audit_events','feature_flags',
           'permissions','features','role_features','roles','migration_seeds',
           'organizations','organization_successions','organization_identifiers','sasr_form_versions'
         )),
     0, 'C-3: every table in schema public carries FORCE ROW LEVEL SECURITY except the 25 named platform-shell/global-catalog/org-tree tables');
   ```
   The 13 existing hand-enumerated per-table FORCE assertions elsewhere in the file are **not deleted** — Rule 16's append-only discipline for this shared file forbids scattering edits across it during a parallel pipeline, and the old assertions remain true (just now redundant). This is a **named deviation from Phase 2's literal "replacing the 13 hand-enumerated sites"** — the new catch-all supersedes them in coverage; physically removing the old ones is deferred to a TODO line for a later, non-parallel housekeeping pass.
7. **Deletion of `:414-418`:** the `select assert_eq((select count(*) from presby_roll_cache_drift()), 0, 'roll: cache agrees with replay');` block (inside "-- 10. The roll read path," which sits *before* the file's current EOF, not at it) is removed. This is the one place this design deliberately overrides the Rule 16 "append only at the end" default: leaving the call in place is not cosmetically stale, it is a **hard break** — `presby_app` loses `EXECUTE` on that function in §6 above, so the call raises `permission denied for function presby_roll_cache_drift`, and `\set ON_ERROR_STOP on` means every assertion after it in the file never runs. This was pre-authorized at kickoff (the original nine-item scope, item 2) before Rule 16's general file discipline was written down, so it is treated as a standing, named exception at one known location, not a new deviation — flagged here explicitly for the orchestrator's attention at integration merge, and the implementer should keep the diff to exactly those lines to keep the merge mechanical.

**Where the `= 0` cache-health data claim goes instead:** nowhere new. `src/app/api/cron/maintenance/route.ts`'s existing `rollCacheRolledForward` field (already computed, already logged via `console.log("[cron/maintenance]", ...)`, already returned in the JSON response) is the ops signal — a persistently non-zero count across multiple days' cron runs is the same fact the `= 0` assertion used to check once per suite run. Writing a new owner-connection operational script duplicates a signal that already exists and would need its own maintenance; minimum-complexity choice. An on-call engineer can still run `select * from presby_roll_cache_drift()` as `neondb_owner` ad hoc — nothing revokes the owner's own implicit privilege on its own function.

## Edge Cases & Risks

- **The `test-rls.sql:414-418` deletion is a required, narrow exception to the append-only shared-file discipline** (named above, Implementation Order step 4) — flagged twice in this document on purpose, because it is the one place this design cannot honor Rule 16's default and still ship a suite that runs at all.
- **The F70 `proconfig` allow-list is a moving target** — the lifecycle pipeline is correcting 0043–0047 concurrently on `main`. Whoever applies this migration to `development` must re-measure the allow-list against whatever has already merged, not copy this document's list blindly (named explicitly in §(b).4).
- **`group_types` de-dup touches 1,557 rows on `development`'s real data (not just this branch's fork)** — the repoint-then-delete SQL is written to be safe under duplication patterns other than this branch's own (at-most-one-referenced-row-per-key), but the implementer should re-run the same measurement queries this design used (`group by key`, `count(distinct group_type_id)` per key from `groups`) against `development` before applying, in case its duplication shape differs.
- **Composite FK additions were verified zero-violation against live data** (all five, via a direct join-and-count query mirroring what `ALTER TABLE ... ADD CONSTRAINT` itself checks) — re-run before applying to any other environment; a violation there is a data-integrity problem this migration would then correctly refuse to mask, not a migration bug.
- **`role_grants_role_fk`'s `ON DELETE CASCADE`** reproduces existing behavior exactly; do not "improve" it to `RESTRICT` in the same commit — that is a separate, already-tracked TODO item (`drizzle/0032`'s own header comment names it) and changing it here would conflate two unrelated risk decisions in one diff.
- **`scripts/seed.ts`'s six-function connection swap is a single atomic unit with the migration's catalog revokes** — landing the revoke without the seed fix breaks `npm run db:seed` on the very next fresh-install attempt; landing the seed fix without the revoke ships no security improvement. Phase 5 must run `db:seed` against a freshly migrated database as part of verification, not just typecheck the diff.
- **`presby_guard_people_delete()` has no cascade pre-arming, unlike its `organizations` sibling** — if a future pipeline adds a `BEFORE DELETE` guard to one of `people`'s six cascade children, this function will need the same two `set_config` lines `presby_guard_organizations_delete()` carries. Named in the function's own comment so that future pipeline finds it there, not by re-deriving the gap.

## Acceptance Criteria

1. **`drizzle/0048_presby_security_b.sql` is whole-file idempotent.** Two consecutive `psql -f drizzle/0048_presby_security_b.sql` runs against the same database produce no error on the second run, and the resulting catalog state (grants, policies, `relforcerowsecurity`, `proconfig`, constraints) is byte-identical after both runs. No step may be widening on a re-run — every `grant`/`create policy`/`alter function ... set` is either idempotent by nature or preceded by a `drop ... if exists`.
2. **`scripts/test-rls.sql` goes from 412 passing assertions to some larger N** (the exact count depends on how many individual `select assert_eq(...)` calls the implementer writes for §(b).5's grant-shape class — expect roughly 412 + 10–15). Every assertion says `pass`; none is skipped.
3. **From-scratch smoke** (Phase 1's Gap 5 / orchestrator ruling 3), concrete steps since there is no empty parent branch to fork from:
   a. Provision a **new, empty database** on the pipeline's existing Neon branch (`pipeline-security-schema-b`) — a second database within the same branch/project, not a new branch (Neon supports multiple databases per branch; this gives a genuinely empty catalog, including zero cluster-level role pre-existence assumptions beyond what `create role ... if not exists` already tolerates).
   b. Point a scratch env file at that database's connection strings (same host/credentials, different database name) for all four of `DATABASE_URL`/`MIGRATE_DATABASE_URL`/`APP_DATABASE_URL`/`PLATFORM_DATABASE_URL`.
   c. `npm run db:migrate` (via `dotenv -e <scratch-env> -- drizzle-kit migrate`) — applies `drizzle/0001`...`0048` in journal order.
   d. `npm run db:seed` (same scratch env, with `INITIAL_ADMIN_EMAILS`/`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` set to `example.invalid`-shaped placeholder values per the No Real Data invariant) — must complete with no permission-denied error (this is the direct test of the B-H3 grant model + the seed.ts connection swap together).
   e. Start the dev server on port 3200 against the scratch env; sign in as the seeded local admin via the credentials form (`auth.local_login` is seeded on); confirm a redirect through `/launch` to `/admin` (platform admin, zero organizations — matches the Post-Login Landing matrix's `0 enterable / no canAccessAdmin.. wait — the seeded local admin has no org membership and `ADMIN_ROLE`, so `/admin` is correct per the matrix's "0 enterable, yes canAccessAdmin, no isPlatformAdmin -> /admin" row). This is the literal "first sign-in" B-H3's own scope language names.
4. **DB-backed vitest, run serially** (`--no-file-parallelism`, per `docs/testing.md`) for `role-definitions.test.ts`, `groups.test.ts`, `people.test.ts`, `roll.test.ts` — all four pass, including every teardown call site (the `deletable_until` stamping must not merely avoid errors, it must actually allow the DELETE to succeed within the fixture's 2-hour window).
5. **The `presby_two_factor_required` shadowing probe is re-run and refused.** The exact live probe from Phase 2 §3 (`create temp table people (id uuid); insert ...; set local search_path = public; select presby_two_factor_required(...)`) must now fail differently: with `search_path = public, pg_temp` in place, an unqualified `people` reference inside the function still resolves to `pg_temp`'s `people` **unless** the function's own `SET search_path` is honored over the caller's transaction-local `SET LOCAL search_path` — which it is, because a function's own `SET` clause establishes the search path for the *duration of the function call*, overriding whatever the caller set. Re-running the exact probe after this migration should show the function resolving `people` to the real `public.people` table regardless of the caller's temp table, i.e. the decoy is no longer visible to the function body at all. QA must capture the exact output, not just "no error."

## Implementer

**database-admin**, sole implementer for the whole pipeline (Architect's menu named this as one valid option; chosen over splitting to api-developer because the two application edits — `groups.ts`'s three-line reverts and the cron route's one-line connection swap — are the direct, low-risk, mechanical consequence of the grant/policy shape database-admin just wrote, and re-explaining that shape to a second agent for two trivial edits is pure handoff overhead with no compensating benefit). Execution order: domain-file FK/index/unique declarations → `drizzle/0048` → `scripts/seed.ts` → `scripts/test-rls.sql` → `src/lib/groups.ts` + `src/app/api/cron/maintenance/route.ts` → the 23 test-fixture files → `src/lib/db/index.ts` comment fix, per Implementation Order above.

## Proposed `docs/decisions.md` entry (orchestrator applies at integration)

Adopt Phase 2's DECISION-146 draft verbatim (§1 of Phase 2, reproduced above in this work-log) — no edits needed; the "What ships instead" paragraph already correctly names `drizzle/0048_presby_security_b.sql`.

## Proposed `docs/TODO.md` lines (orchestrator applies at integration)

- Reclassify `group_types` as a global catalog table (root cause of B-M4, B-L1, and the `groups.group_type_id` FK question) — move it out of `0009`'s `tenant_tables` loop shape entirely in a future migration.
- Close the `app_role_permissions` owner-write path with a trigger (F44 — a grant can never reach `neondb_owner`; B-H2's policy binds `presby_app` only).
- The platform-shell DML accessor refactor DECISION-146 names as the prerequisite for ever adding a third (auth-scoped) database connection.
- Physically remove the 13 hand-enumerated per-table FORCE assertions in `scripts/test-rls.sql` now superseded by the C-3 catch-all — deferred here because Rule 16 forbids scattering that edit across the file during this parallel pipeline.
- Fix the "two bespoke policies" stale count in `docs/schema-design.md` §17 (exact wording TBD — the literal phrase was not found by grep in either schema-design doc; needs a human read, not a mechanical replace).
- Already-agreed deferrals carried from Phase 2: B-M1, B-M2 residual (once the lifecycle pipeline's F60 correction lands, re-verify the `proconfig` allow-list in `scripts/test-rls.sql` shrinks to empty and delete the dated comment), B-L2 (`presby_membership_is_active()` enumeration oracle), B-L5 (see above), B-I1–I6.
- `role_grants_role_fk`'s `ON DELETE CASCADE` — `drizzle/0032`'s own header already names `restrict` as the eventual fix; still not this pipeline.

## Handoff

To **database-admin** for Phase 4, per the Implementer and Implementation Order sections above. Files touched are listed in full under Component / Page Plan. The five `[C]` binding conditions from Phase 2 are honored: the `scripts/seed.ts` blocker is now a six-function fix (§5.1's four plus `feature_flags`, measured); the `test-rls.sql` single-connection constraint is honored (no owner-connection fork; C-4's mechanism is revoke-and-relocate, not a policy re-scope); the `groups.group_type_id` exclusion is preserved and re-confirmed against post-dedup data; both `ALTER FUNCTION` conditions are met (re-apply-last header, `proconfig` assertion); the `_journal.json` mid-file exception stays orchestrator-only. One additional named exception beyond Phase 2's five: `test-rls.sql:414-418`'s deletion, a required, single-location, pre-authorized (at kickoff) departure from the append-only default.

## Ratification after Phase 4 (tech-lead)

*Independently verified against the actual diff and the live pipeline branch — `git diff --stat`, `git show HEAD:...` for baselines, `psql "$MIGRATE_DATABASE_URL"` for catalog facts — not accepted from either the coordinator's summary or database-admin's own write-up alone. Where a claim below is stated as confirmed, I re-derived it myself; I did not find a single instance where database-admin's write-up overstated what the diff actually does.*

**D1 (TEMP revoke dropped, deferred with a TODO) — ratified, and it corrects a real defect in my own Phase 3 design.** I re-checked my own investigation: my Phase 3 "no legitimate temp-table use by `presby_app`" claim came from a grep whose own exclusion filter (`grep -vi "test-rls\|pg_temp_"`) stripped every matching line's filename, silently discarding every real hit in `scripts/test-rls.sql` — including line 1292's pre-existing `create temporary table t20_fresh_person`, present since before this pipeline started (confirmed via `git show HEAD:scripts/test-rls.sql`). The revoke I specified would have broken a real, load-bearing, already-shipped regression test (section 20a, the F21 "insert-permissive, read-restrictive" fix). Database-admin's fix is correct: drop the revoke, ship the `pg_temp`-last clause alone as the primary control (exactly Phase 2 §3's own stated priority), and defer with a named prerequisite (removing the suite's own temp table, itself a non-parallel housekeeping act under Rule 16). Nothing to add.

**D2 (assertions 2/3 contradicted; assertion 2 shipped) — ratified**, and it is the direct, correct consequence of D1: my Phase 3 §(b) wrote two assertions assuming the revoke would land in the same file; once it doesn't, asserting `TEMP = false` would be asserting a falsehood. Shipping assertion 2 alone, as a documented known-true fact with a forward pointer to when it flips, is exactly right — confirmed by reading `scripts/test-rls.sql` §36.2 directly.

**D4 (self-referencing composite FKs use `t.id`/`t.organizationId`, not the table binding, to avoid TS7022) — ratified**, and it is a second real gap in my Phase 3 feasibility check. I verified the *runtime* timing correctly (`pgTable()`'s third-argument callback is stored, not invoked, until after module load — confirmed by reading `node_modules/drizzle-orm/pg-core/table.js`), and that answer is still true. What I missed is that TypeScript's static inference doesn't know that — writing `foreignColumns: [events.id, events.organizationId]` inside `events`' own config array makes the compiler try to resolve `events`'s type from an expression that mentions `events`, which is exactly TS7022/TS7024. `t.id`/`t.organizationId` are the identical columns without the circular type reference. I confirmed this was applied consistently across **all three** self-referencing composites (`events.parent_event_id`, `roll_actions.voids_action_id`, `publications.supersedes_id` — read all three diffs directly), not just the subset the coordinator's message named. Two feasibility misses in one design is worth naming plainly rather than downplaying: **my Phase 3 "Feasibility note" on self-referencing composite FKs was runtime-correct and TypeScript-wrong**, and Phase 4 is the layer that's supposed to catch exactly this class of gap before it reaches QA — which it did.

**Sixth seed blocker (five test call sites upserting `feature_flags` on the tenant handle) — ratified.** Confirmed via `git diff`: `src/app/api/sites/ingest/route.test.ts` (1 site) and `src/lib/sites.test.ts` (4 sites), all `insert(featureFlags)...onConflictDoUpdate`, all moved from `db` to `getPlatformDb()`. This is a class of gap my Phase 3 design didn't look for at all — I checked application code under `src/app/` and `src/lib/` for `feature_flags` writers, but not test files exercising the same tables on the tenant connection. Correctly scoped fix; nothing broader needed (I re-ran the same `grep -rn "featureFlags" --include="*.test.ts" | grep -i "insert\|upsert"` search myself and it returns exactly these five sites, now all on `platform`/`getPlatformDb()`).

**`groups.test.ts`'s `findOrCreateGroupType()` fixed to read-first — ratified, and it corrects a factual claim in my own Phase 3 design that I need to strike.** I wrote, in the migration's dedup section text, that the 1,557 duplicate `group_types` rows were "historical drift... not reproduced by any live code path measured 2026-09-25." That was wrong, and database-admin's own investigation (an `insert(...).onConflictDoNothing()` against a table with no unique constraint at all, so the conflict clause never fires) found the actual, still-active generator: every run of `groups.test.ts` was minting a fresh lowercase-named global template row. Had this not been fixed, my dedup migration would have been a one-time cosmetic fix that started re-accumulating duplicates on the next CI run. **Correction for the record:** strike "not reproduced by any live code path measured 2026-09-25" from this design's Data Model §5 prose above — it is factually superseded by database-admin's finding. The fix itself (read-first, write the seed catalog's own display name) is minimal and correct.

**Stamp-at-teardown for the two production-code-creates-the-person sites — ratified.** Confirmed via diff: `src/lib/people.test.ts` (sweeping `createPerson()`'s own "new identity" rows by surname) and `src/app/(org)/o/[slug]/admin/staff/actions.test.ts` (a person created by `createStaffPersonAction()`). This is the correct resolution of a real gap in my Phase 3 instruction — I specified "stamp at insert, uniformly, across 23 files" without accounting for the two places where the row is created by production code the test only *calls*, not by the test's own fixture factory. The fix preserves my design's actual invariant (same column, same `fixtureDeletableUntil()` helper, no GUC, no session-variable exemption) — it only moves *when* the stamp is written, via an `UPDATE ... SET deletable_until = ...` immediately before the `DELETE`, and only at the two sites where there is no other point to stamp it. Production code itself never sets the column at either site (confirmed by reading both). No further sites need this treatment — I independently re-ran the `insert(people)`/`update(people)` search across all `*.test.ts` files and found no third site.

**B-L4 (`db:migrate` from empty applies 45/46 and exits 1 silently) — ruling, as requested:**

1. **The `_journal.json` idx 26/27/28 back-fill is a release blocker for this pipeline's integration, not deferred housekeeping, and it must land WITH `drizzle/0048` at the same integration step — not before it as unrelated cleanup, and not after it as a follow-up.** This reverses my own Phase 3 classification (I filed it under "Housekeeping," item 9, alongside doc-wording fixes) and Phase 1's identical classification before mine. Database-admin's from-scratch run is the reason the reclassification is correct, not a judgment call: a database built via `drizzle-kit migrate` from empty silently ends up with **one** RLS policy on `people` where it should have **four**, because 0026–0028 (including `0028_presby_people_write_rls_fix.sql`) are never applied at all — the journal-driven runner has no way to know they exist. That is not a cosmetic audit-trail gap; it is the literal mechanism by which "the security posture is reproducible from `drizzle/`" — B-H3's own stated premise, and the reason this pipeline exists — fails to hold. The Rule 16 constraint that the mid-file back-fill is orchestrator-only, applied at integration, stays exactly as Phase 2 ruled; what changes is the *timing*: it is a co-requisite of this migration landing, not a separately-scheduled cleanup that can trail behind it by even one release. I recommend the orchestrator treat `/merge-pr` for this pipeline as blocked on the back-fill being staged in the same integration action, and that QA's Phase 5 from-scratch verification (if it re-runs one) use the filename-order replay path (`for f in drizzle/*.sql; do psql -f "$f"; done`, database-admin's own confirmed-clean second attempt) rather than `db:migrate`, until the back-fill lands.
2. **Yes, the silent exit-1 deserves its own TODO line, independent of the specific 26/27/28 gap.** A migration runner that exits non-zero with no message on stdout or stderr is a hazard that will recur the next time any journal entry goes missing or drifts, and nothing today would catch a repeat except another agent happening to run a from-scratch smoke test. I propose two TODO lines, not one: (a) a `check:*`-style tripwire — cheap, mechanical, exactly this project's existing pattern — that asserts `drizzle/meta/_journal.json`'s `idx` values are a complete, gapless, ascending sequence matching every `drizzle/00XX_*.sql` file present in the directory, which would have caught B-L4 the day it was introduced rather than requiring this pipeline's acceptance criterion to stumble onto it; (b) a narrower note that `drizzle-kit migrate`'s silent-exit-1 behavior itself is worth a short wrapper or an upstream issue, since even with (a) in place a *different* class of `drizzle-kit` failure could still fail silently.

**Pass-count confirmation, against my Phase 3 acceptance criteria:**

- **`scripts/test-rls.sql`: 412 → 456, confirmed.** My own static grep (`grep -c "select assert_eq(\|raise notice 'pass"`) gives 413/458 on the current file versus HEAD — a rough proxy that over-counts by one in each direction due to an imprecise pattern, not a real discrepancy. Database-admin's number comes from an actual `psql -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql` run against `presby_app` with an explicit `pass`-notice count and `exit=0` (P3), which is the authoritative measurement — a live suite run beats a static grep, and I have no basis to doubt it. The arithmetic (412 baseline − 1 deleted at `:414-418` + 45 new = 456) is internally consistent and matches Acceptance Criterion 2's "roughly 412 + 10–15" only in direction, not magnitude — I under-estimated how many individual assertions §36.4's per-table-class grant checks alone would need; 45 new assertions across ten subsections (36.1–36.10) is a reasonable, not-inflated count for the ground actually covered. No concern.
- **`aclexplode`: zero added / 20 removed, confirmed independently before I read database-admin's own count.** From my Phase 3 grant-model spec alone: `audit_events` (revoke `UPDATE`,`DELETE` = 2) + `feature_flags` (revoke `INSERT`,`DELETE` = 2) + the five catalog tables `permissions`/`features`/`role_features`/`roles`/`migration_seeds` (revoke `INSERT`,`UPDATE`,`DELETE` each = 15) + `app_role_permissions` (revoke `UPDATE` = 1) = **20**, matching database-admin's P2 table entry for entry. Zero additions is the correct outcome of a design built entirely from restating already-live grants (no `grant` statement in §2 targets a table/privilege pair `presby_app` didn't already hold) — this is the acceptance criterion's "no-op-or-narrowing, never a widening" proven mechanically, not asserted.

**Three findings beyond the coordinator's checklist, surfaced because ratification means reading the diff, not just the summary of it:**

1. **My own text in this document's Data Model §5 contains the now-superseded "not reproduced by any live code path" claim** about the `group_types` duplicates (addressed above) — flagged here for whoever reads this work-log top-to-bottom rather than silently leaving two contradictory claims about the same fact in one document.
2. **The old `events.ts` comment this pipeline removed cited "same class as `groupMemberships.officerTermId` (DECISION-060)."** I checked: DECISION-060 (`docs/decisions.md`) is about the tenant-permission-catalog baseline-grant problem, and `groupMemberships.officerTermId`'s own header comment (`src/lib/db/domain/groups.ts:118-123`) says that column has **no foreign key at all** — a different and more severe gap than `events.parent_event_id`'s prior *plain, single-column* FK, and one this pipeline's B-M3 scope never named. **Do not read this pipeline's fix as having implicitly resolved or informed DECISION-060's still-open gap** — it hasn't; `officerTermId` references a different table entirely (`officer_terms`, not itself), so the self-referencing-FK circularity fix that unblocked `events`/`roll_actions`/`publications` may not even be the relevant obstacle there. Recommend the orchestrator add this as its own, separate TODO line (not folded into any of the five already proposed) so a future reader doesn't assume it was covered.
3. **DECISION-113 (`2026-08-26-events-model`, Phase 2) explicitly ruled `parent_event_id` a plain, non-composite FK "per the architect's Phase 2 ruling that a composite self-FK is not expressible here without circularity."** This pipeline's Phase 2 (architect) and Phase 4 (database-admin) together demonstrate that premise was incomplete — expressible, with the `t.id` idiom. This is a legitimate, quiet reversal of a previously-recorded architectural decision, and CLAUDE.md's Workflow Rule 4 ("document decisions") argues for a short cross-reference rather than leaving DECISION-113 to read as still-current on this one point. **Proposed addition to the orchestrator's decisions.md batch:** a brief correction note appended under DECISION-113 (not a renumbered decision — the technical premise changed, not the architectural choice of one-flat-table-with-self-FK, which stands) reading approximately: *"Correction, 2026-09-25 (`2026-09-25-security-schema-b`, Phase 4): `parent_event_id`'s 'not expressible without circularity' premise was TypeScript-inference-shaped, not a real Drizzle limitation — a self-referencing composite FK is expressible via the table's own `t` binding in its `(t) => [...]` config array, which never triggers TS7022 the way naming the table itself does. `parent_event_id` is now composite (`events_parent_fk`, `drizzle/0048`). This does not reopen `groupMemberships.officerTermId` (DECISION-060), which references a different table and has no FK at all today, not merely a non-composite one."*

**One documentation-hygiene note, non-blocking:** the work-log's canonical Phase 4 slot (the template section directly below this Handoff) is still the unfilled template — database-admin's actual Phase 4 write-up lives further down the file, after the Phase 5/6 placeholders, under its own `# Phase 4 — Implementation (database-admin)` heading. CLAUDE.md is explicit that "the template's per-phase sections are the canonical handoff format — nobody invents a parallel one." The content itself is thorough and I have no substantive complaint about it, but the file's phase ordering should be repaired (the real Phase 4 content moved into the reserved slot, the stray duplicate heading and empty placeholder removed) before this work-log is treated as a clean handoff artifact for whoever reads it after QA. Flagging for the orchestrator to fix at the next housekeeping touch of this file — not a gate on QA proceeding, since QA works from the actual content regardless of where it sits.

**Overall ratification: every technical ruling the coordinator asked me to confirm (D1, D2, D4, the sixth seed blocker, the `group_types` root-cause fix, the two stamp-at-teardown sites, and both halves of the B-L4 ruling) is correct, independently verified against the live diff and branch, and consistent with this design's stated invariants. Two of the four "Deviations" are corrections of gaps in my own Phase 3 feasibility check (D1's grep filter, D4's TypeScript-vs-runtime distinction) — named plainly above rather than absorbed silently. No loop-back to Phase 3 is warranted; nothing here changes the design's shape, only its literal SQL, which Phase 4 exists to get right.**

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25
**Verified by:** qa (read-only; no repo file written)
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-security`, git branch `pipeline/security-schema-b`, Neon branch `pipeline-security-schema-b` (`ep-small-scene-axn12k76`, PostgreSQL 18.6, 15 fixture orgs). Every catalog claim below was measured on the live connection named — `presby_app` via `$APP_DATABASE_URL`, `neondb_owner` via `$MIGRATE_DATABASE_URL`/`$PLATFORM_DATABASE_URL` — not read from `src/lib/db/domain/` and not taken from Phase 4's report. Destructive probes ran in rolled-back transactions; the five failing-first experiments mutated the catalog and were restored, verified byte-identical against a pre-experiment dump.

## Type Check

`npm run typecheck`: **PASS** (exit 0)
`npm run check` (all five tripwires): **PASS** (exit 0 — audit, sql-date, deps-drift, brand-scope, secrets)
`npm run lint`: 7 errors / 190 warnings, all in `portal-nav-links.tsx`, `branding-form.tsx`, `children/page.tsx`, `children-roster-list.test.tsx` — four files this pipeline does not touch. Pre-existing; Phase 4's claim confirmed.

## Unit Tests

| Mode | Result |
|---|---|
| `npm run test` (no `.env.local`) | **exit 0** — 246 files passed, 29 skipped (275); 3,241 passed, 777 skipped (4,018) |
| `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` (all files, serial) | **1 file failed / 274 passed (275); 3 failed / 4,015 passed (4,018); 0 skipped**; 354.79 s |

The two modes together leave **zero genuinely skipped specs**: the 29 files `npm test` skips are the DB-backed ones, and all 29 ran green in the serial mode.

Failures: `src/lib/rate-limit.test.ts:241`, `:256`, `:279` — `expected true to be false` / `expected +0 to be 10000`. Cause is `RATE_LIMIT_DISABLED=true` in `.env.local` short-circuiting `checkRateLimit()` at `src/lib/rate-limit.ts:190`; the same three pass under `npm test`. Environment artifact of the serial mode, not a code failure, not attributable to this diff. This is the "rate-limit trio" the brief predicted.

**SQL isolation suite** — `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql`: **exit 0, 456 `pass`, 0 `FAIL`** (from the 412 baseline; 412 − 1 deleted + 45 new = 456). Re-run green after all five failing-first experiments.

**Coverage on critical modules** (targets met): `src/lib/permissions.ts` **100%** stmts / 100% branch · `src/lib/flags.ts` **100%** (combined 9/9 stmts, 4/4 branch) · `src/lib/two-factor.ts` **91.3%** stmts / **100%** branch / 90.5% lines (uncovered 35–39). Untouched by this diff.

## End-to-End Tests

Playwright suite: **not run — not required.** The diff touches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`, so the stricter auth gate does not apply by path. The one grant class that abuts the auth shell (`user_totp*`, `password_reset_tokens`, `sessions`, `accounts`, `users`) is **restated, never narrowed** — confirmed by ACL diff (below), zero privileges removed on any of them.

Notwithstanding, a **real-server login was exercised end to end** as part of the from-scratch acceptance criterion, against a dev server on port 3200 pointed at a freshly built database:

```
POST /api/auth/callback/credentials  -> 302  Location: /launch
GET  /api/auth/session               -> seeded admin, 11 features
GET  /launch                         -> 307  Location: /admin
GET  /admin                          -> 200
GET  /admin/users                    -> 200
GET  /home                           -> 200
```

I confirmed the app really used the scratch database, not the pipeline branch: `qa-admin@example.invalid` exists in `qa0048b` (1 row) and not in `neondb` (0 rows). Server stopped by PID; scratch databases dropped.

## Schema/RLS Audit

*(Mandatory on a schema-touching change. Verified against `pg_class`, `pg_policies`, `aclexplode`, `pg_proc.proconfig`, `pg_trigger`, `pg_constraint` on the connection in question — not `information_schema`, not the Drizzle table files. Each claimed protection was probed, and the layer that actually refuses is named.)*

| # | Claim | Verified how | Refusing layer | Result |
|---|---|---|---|---|
| B-H2 | `app_role_permissions` RLS | `relrowsecurity=t`, `relforcerowsecurity=t`; 4 policies with the exact `role_id → app_roles` reach | — | **pass** |
| B-H2 | own-org + global only | As `presby_app`, Alder Creek ctx: 15 `app_roles`, **28** bindings = 23 own-org + 5 global. Owner sees 71 = 23 + 5 + **43 foreign**, all 43 hidden. Phase 1's 15/71/43 reproduced exactly | `app_role_permissions_select` | **pass** |
| B-H2 | Phase 1's cross-org INSERT now refused | Same ctx, foreign `role_id f0000000-…-03` invisible in `app_roles` (0 rows); `insert … values (that_id,'directory.view')` → `ERROR: new row violates row-level security policy for table "app_role_permissions"` | **RLS policy** `app_role_permissions_insert` (WITH CHECK). `presby_app` still *holds* INSERT — the policy, not the grant, is what refuses | **pass** |
| B-H2 | UPDATE closed | `update app_role_permissions …` → `ERROR: permission denied for table app_role_permissions` | **the grant** (revoked), before any policy | **pass** |
| B-H2 | four write paths still work | `role-definitions.test.ts` DB-backed: **47/47 pass**, covering `createRole`, `setRolePermissions` (insert + delete arms), `adoptTemplate` clone | — | **pass** |
| F70 | 14 named functions pinned | `pg_proc.proconfig` = `search_path=public, pg_temp` on all 14, plus the new `presby_guard_people_delete` = **15** | — | **pass** |
| F70 | catalog-wide | 36 `prosecdef` in `public`: **15 pinned, 21 at `search_path=public`**. All 21 map to 0043–0047 (see integration fact below) | — | **pass, with named integration fact** |
| F70 | the decoy no longer flips the answer | As `presby_app`, rolled back: shape-correct `create temp table people (id, user_id, merged_into_id)` → caller resolves `people` to `pg_temp_47` (0 rows), `presby_two_factor_required('e0000000-…-f2')` returns **`t`**; honest answer outside the decoy is also `t` | the function's own `SET search_path` clause, evaluated for the duration of the call | **pass** |
| B-H3 | grant model vs Phase 3's table | `aclexplode` on all 25 tables: 14 × `SELECT,INSERT,UPDATE,DELETE`; `audit_events` = **SELECT,INSERT**; `feature_flags` = **SELECT,UPDATE**; `permissions`/`features`/`role_features`/`roles`/`migration_seeds` = **SELECT**; `organizations`/`organization_identifiers`/`organization_successions`/`sasr_form_versions` = **SELECT**. Exact match, no extras | — | **pass** |
| B-H3 | `seed.ts` writes catalogs on `platformDb` | Read `scripts/seed.ts:42-70`, `:78-102`, `:743`, `:811-826` — all five writers on `platformDb`; `npm run db:seed` **exit 0** | — | **pass** |
| C-4/B-L3 | roll functions owner-only | `proacl` = `neondb_owner:EXECUTE` and nothing else on both. At the call as `presby_app`: `ERROR: permission denied for function presby_roll_cache_drift` / `… presby_reconcile_current_roll`. Owner still runs both | **the EXECUTE grant** (revoke of the `CREATE FUNCTION` default to PUBLIC) | **pass** |
| C-4 | cron caller relocated | Read `src/app/api/cron/maintenance/route.ts` — reconcile on `getPlatformDb()` (`:91-93`), three token DELETEs on `db` (`:34-60`) | — | **pass** |
| C-4 | `test-rls.sql:414-418` replaced | `git diff -U0` = exactly two hunks (`@@ -415,4 +415,4 @@`, `@@ -4871,0 +4872,614 @@`); `:414-418` is a 4-line pointer comment; EXECUTE assertions live at `:5297-5303` + a call-level `do $$` probe | — | **pass** |
| B-M3 | five composite FKs | `pg_get_constraintdef` on all five: two columns each end; `role_grants_role_fk` carries `ON DELETE CASCADE`; the five single-column originals are **gone** (count 0); `app_roles_id_org_key UNIQUE (id, organization_id)` present; B-L6's three indexes present | — | **pass** |
| B-M3 | zero violations | Join-and-count mirroring `ADD CONSTRAINT` on all five tables: **0, 0, 0, 0, 0** | — | **pass** |
| B-M3 | `groups.group_type_id` excluded | Still `FOREIGN KEY (group_type_id) REFERENCES group_types(id)`, single-column, with the DELIBERATELY-EXCLUDED rationale in `drizzle/0048` §7 | — | **pass** |
| B-M4 | four policies, SELECT admits globals | `group_types_select` qual = `(organization_id = presby_current_org()) OR (organization_id IS NULL)`; I/U/D own-org only; `tenant_isolation` gone. As `presby_app` under Alder ctx: **6 templates visible** | — | **pass** |
| B-M4 | no `getPlatformDb()` in `groups.ts` | `grep` — two hits, both inside explanatory comments (`:54`, `:60`); no import, no call | — | **pass** |
| B-L1 | unique shape + duplicates gone | `group_types_org_key UNIQUE NULLS NOT DISTINCT (organization_id, key)`, `pg_index.indnullsnotdistinct = true`; `group_types_org_idx` dropped; **6 rows, 1 per key**, names `Court/Roster/Committee/Small Group/Choir/Team`, 0 org-owned | — | **pass** |
| B-L1 | the generator is fixed | Read `src/lib/groups.test.ts:170-189` (read-first, writes the catalog name). Ran the file **twice**: `group_types` 6 → 6 → 6; 45/45 both runs | — | **pass** |
| N-6 | column + trigger | `people.deletable_until timestamptz`; `people_guard_delete BEFORE DELETE … FOR EACH ROW`, `tgenabled='O'`; `presby_app` on `people` = `INSERT,SELECT,UPDATE` (no DELETE) | — | **pass** |
| N-6 | owner-path DELETE of an unstamped person | As `neondb_owner`: `ERROR: people: a person record is never hard-deleted; record a merge instead (merged_into_id)` | **the trigger** — a grant cannot reach `neondb_owner` (F44) | **pass** |
| N-6 | valid window deletes / expired refused | Valid: `DELETE 1`. Expired (`now() - 1 minute`): same exception | the trigger | **pass** |
| C-3 | inverted FORCE catch-all | Live: 83 tables, **58 FORCE, 25 not**. Set-difference against the suite's 25-name allow-list: `live_not_in_allow: (none)`, `allow_not_live: (none)` | — | **pass** |
| C-3 | `sasr_form_versions` | Confirmed **no `organization_id` column** (0). It is on the list as a *global catalog*, not as a tenant-shaped exemption — which is Phase 2 §4's correction, correctly applied and documented in both `drizzle/0048` §2 and the suite comment | — | **pass** |

**Idempotency and no-op-or-narrowing (item 10).**
Double-apply on the pipeline branch: both runs **exit 0**; a 2,094-line catalog dump (table ACLs, function ACLs, policies with `qual`/`with_check`, `relrowsecurity`/`relforcerowsecurity`, `proconfig`, every constraint, every index, non-internal triggers, all `group_types` rows, row counts, database/schema privileges) taken three times — **dump0 ≡ dump1 ≡ dump2, byte-identical**. DML on re-run: `UPDATE 0`, `DELETE 0`, `UPDATE 0`.

For the narrowing claim I did not rely on the double-apply (which can only show zero-delta). I built a **clean `0000`–`0047` replay into an empty database**, reconstructed the pre-0048 *live* wide shape (`grant select,insert,update,delete` on the 22 tables Phase 1 measured as `arwd`), snapshotted `aclexplode`, then applied 0048:

- **privileges ADDED: 0** (empty)
- **privileges REMOVED: 20**, exactly Phase 4's P2 list — `app_role_permissions|UPDATE`, `audit_events|{UPDATE,DELETE}`, `feature_flags|{INSERT,DELETE}`, and `{INSERT,UPDATE,DELETE}` × `permissions, features, role_features, roles, migration_seeds`
- function ACLs removed: `presby_reconcile_current_roll()` and `presby_roll_cache_drift()`, each from both `PUBLIC` and `presby_app`

**From-scratch procedure (item 4), re-run independently.**
1. `drizzle-kit migrate` into an empty database: **exit 1 with no message on either stream, 45 of 46 journal entries applied.** `_journal.json` has 46 entries, idx 0–48, **missing 26, 27, 28**. Applying the 46th by hand gives the real error, character-for-character as Phase 4 reported:
   `psql:drizzle/0048_presby_security_b.sql:139: ERROR:  function presby_person_unclaimed_or_own_org(uuid) does not exist`
   and the resulting database has **1** policy on `people` where the pipeline branch has 4. B-L4 reproduced, not taken on report.
2. Fresh empty database, all **49** `drizzle/*.sql` replayed in filename order via `psql -v ON_ERROR_STOP=1`: **all applied, exit 0, including 0048.** Posture measured on it and identical to Phase 4's figures: 83 tables / 58 FORCE · 36 `prosecdef` / 15 pinned · 56/56 full-CRUD grants on the fourteen shell tables · **0** of 15 catalog-write grants · `people_guard_delete` installed · 4 `people` policies.
3. `db:seed` against it: clean, including `created local admin` and `bound local admin to admin role` — both write `users`/`user_roles` on the `presby_app` connection, the direct joint test of the B-H3 grant model and the `seed.ts` swap.
4. Sign-in smoke: the transcript above. Scratch databases `qa0048`, `qa0048b`, `qa0047` all dropped; `neondb` untouched.

**Failing-first (item 12) — five mechanisms reproduced myself**, each broken, suite re-run, restored:

| Mechanism removed | Suite | Failure cited |
|---|---|---|
| `app_role_permissions_insert` dropped | exit 3, **427** pass | `scripts/test-rls.sql:5149` — `FAIL B-H2: the four-policy split is in place … expected 4, got 3` |
| B-H2 defect exactly as it shipped (`no force` + `disable`) | exit 3, **424** pass | `scripts/test-rls.sql:5103` — `FAIL C-3: … expected 0, got 1`. **And the defect itself reproduced:** as `presby_app` under Alder ctx, `app_role_permissions` returned all **71** rows and the cross-org `INSERT` returned `INSERT 0 1` |
| `roll_actions_voids_fk` reverted to single-column | exit 3, **442** pass | `scripts/test-rls.sql:5346` — `FAIL B-M3: all five tenant->tenant FKs are COMPOSITE … expected 5, got 4` |
| `people_guard_delete` disabled | exit 3, **449** pass | `scripts/test-rls.sql:5426` — `FAIL N-6: people carries an ENABLED people_guard_delete trigger … expected 1, got 0`. Owner-path DELETE of an unstamped person then returned `DELETE 1` |
| `presby_two_factor_required` re-pinned to `search_path = public` | exit 3, **413** pass | `scripts/test-rls.sql:4967` — `FAIL F70: … expected 0, got 1`. **The security claim itself reproduced:** under the shape-correct temp decoy the DEFINER returned **`f`** for a user who genuinely requires 2FA — "this user does not need 2FA" — where the shipped clause returns `t` |
| everything restored | **exit 0, 456 pass, 0 FAIL**; full catalog dump byte-identical to the pre-experiment baseline | — |

Phase 4's cited lines and pass counts match mine exactly in all five.

## Regression Tests Added

*(Authored by the implementer; I verified each exists, is named for what it protects, and actually fails when its mechanism is removed.)*

- `src/lib/role-definitions.test.ts:1172` — *"a tenant sees only its own roles' bindings and the global templates' — regression for B-H2 cross-tenant app_role_permissions read"*
- `src/lib/role-definitions.test.ts:1187` — *"a tenant cannot bind a permission to another organization's role — regression for B-H2 cross-tenant app_role_permissions write"*
- `src/lib/role-definitions.test.ts:1235` — the load-bearing `or organization_id is null` template arm. **Verified failing-first:** dropping that arm turns 4 of 47 tests red, including this one, *and* turns `scripts/test-rls.sql:1949` red. The arm is genuinely protected on both sides.
- `src/lib/role-definitions.test.ts:1251` — *"— regression for B-M3 role_grants.role_id composite FK"*
- `src/lib/people.test.ts:907,933,962` — the N-6 guard trio (unstamped refused / valid-window permitted / expired-window refused / `presby_app` holds no DELETE). Behavioural, not catalog-shaped.
- `src/lib/roll.test.ts`, `src/lib/groups.test.ts` — B-M3 and B-L1/B-M4 regressions.
- `src/app/api/cron/maintenance/route.test.ts` — *"runs the roll-cache reconcile on the PLATFORM connection, and the three token DELETEs on the tenant one — regression for C-4"*, plus the converse assertion that the platform handle is not a shortcut for the whole handler. Two handles in the mock, per-statement attribution asserted.
- `scripts/test-rls.sql` section 36, subsections 36.1–36.10 (614 appended lines, +45 assertions).

## Feature-Gate Audit

*(Verified by reading route and action bodies, not inferred from green tests. `git status` + a `"use server"` scan across every changed non-test file: exactly one protected-surface file is touched; no server action body changed.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /api/cron/maintenance` (`src/app/api/cron/maintenance/route.ts`) | no — **correct**, not a user surface | no — **correct** | n/a |

The cron route's gate is a shared-secret bearer check, read at `:14-25`: **503** when `CRON_SECRET` is unset (fails closed and surfaces in the Vercel dashboard rather than silently no-oping), **401** on a mismatched `Authorization: Bearer`. Both checks precede every database statement, including the new `getPlatformDb()` call. The relocation does not weaken the gate: the RLS-bypassing handle is reached only after the bearer check, and its single statement is the parameterless `presby_reconcile_current_roll()` — no caller-supplied input reaches it. The route lives in `src/app/api/cron/`, not `src/app/(org)/`, so the `(org)` contract's `getPlatformDb()` ban is not crossed.

No other `src/app/api/**/route.ts` and no `"use server"` action was added or changed. `npm run check:audit` passes; no `AUDIT_ACTIONS` key is added or referenced (correct — no mutation in an `actions.ts` changes).

## Verdict

**FAIL** — two named gaps, both in test hygiene. **Nothing in `drizzle/0048_presby_security_b.sql` needs to change**; all ten mechanisms are correctly implemented and independently verified above. The loop-back is narrow.

**G1 — `scripts/test-rls.sql:5455-5457` is an assertion that cannot fail.**

```sql
select assert_eq(
  (select count(*) from people where deletable_until is not null),
  0, 'N-6: no person row carries a deletion window right now — the fixture stamp is per-suite and transient');
```

The suite runs as `presby_app`, and this block establishes no org context. `people` is FORCE-RLS, so `select count(*) from people` returns **0 of 678 rows** on this connection — measured. The assertion reports `pass` whether or not a leak exists, and **it reported `pass` in the green 456 run while three leaked stamped rows were sitting in the table.** This is the vacuous-assertion class the architect ruled against in Phase 2 §4 ("an assertion that passes with or without the mechanism under test — B-H1's exact failure mode") and the same shape as the "no self-agreeing DB mocks" rule: the check agrees with itself. It is also the *only* routine guard on the operational cost of N-6.

Fix direction (implementer's call): the claim is an owner-path claim and cannot honestly be made from `presby_app`. Either move it to a DB-backed vitest assertion on `getPlatformDb()`, or express it here as something `presby_app` can actually see. Do not leave a count that is structurally pinned to zero.

**G2 — `src/lib/tickets.test.ts:250` leaks one `people` row per run, and N-6 makes the leak permanent.**

`const outsidePerson = await person("Marisol", "Enweazu")` is a block-local `const`; the `afterAll` teardown at `:298-305` deletes only `filerPerson, plainMemberPerson, lapsedSubmitterPerson, noMembershipPerson`. `outsidePerson` is never deleted. Isolated and confirmed: running `role-grants.test.ts` left the stamped count at 2; running `tickets.test.ts` took it to 3. Three leaked rows are in the pipeline database now (`b1d633de…`, `77ed97de…`, `d9a3cac9…`).

The leak itself predates this pipeline — `git show HEAD:src/lib/tickets.test.ts:246` has the same untorn-down fixture. What this pipeline changes is the consequence, and the change is real: the implementer added `deletableUntil: fixtureDeletableUntil()` to this file's `person()` factory (the diff's only hunk in it), so each leaked row now carries a **two-hour** window (`src/lib/db/fixture-deletable.ts:39`). Once that window expires the row is undeletable on *every* connection — `presby_app` has no DELETE grant, and the owner path hits `presby_guard_people_delete()`. I proved the expired-window refusal directly. Before N-6 an orphaned fixture person was harmless clutter; after it, it is permanent. And G1 is precisely why the suite will never say so.

**Time-sensitive note for the orchestrator:** the three leaked rows' windows were still open at the time of writing (latest expiry ≈ 21:25 UTC 2026-09-25). While open they can be removed with a plain owner-connection `delete from people where deletable_until is not null`. I deliberately did not run it — it would destroy the reproduction the implementer needs, and a mutation is not mine to make. After expiry they are permanent.

**Not a gap, recorded so Phase 6 does not re-litigate it:** I suspected `scripts/test-rls.sql:5193`'s template-arm assertion was self-satisfying (both sides RLS-filtered identically, so `0 = 0` would pass with the arm dropped). I tested it rather than asserting it. Dropping the `or organization_id is null` arm turns the suite red at `:1949` and turns four `role-definitions.test.ts` tests red, including the one named for that arm. The mechanism is properly covered; `:5193` is redundant, not vacuous. No action needed.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — full live-catalog audit, from-scratch rebuild, five failing-first reproductions; two test-hygiene gaps named | **FAIL** | 2026-09-25 |

---

## Notes for Phase 6

Carry these forward; they are facts, not open questions.

1. **Integration fact — the 24 pipeline functions get `pg_temp` from `main`.** 36 `prosecdef` functions live in `public`: 15 pinned to `search_path=public, pg_temp` (F70's 14 plus the new `presby_guard_people_delete`), **21 still at `search_path=public`**. I mapped all 21 to their defining migrations: every one is from `0043`–`0047`. `main` already carries **24** `public, pg_temp` occurrences across those five files (`0043`:1, `0044`:16, `0045`:1, `0046`:2, `0047`:4), all of which are **0** in this worktree's copies — this branch forked before the lifecycle pipeline's eleventh loop-back landed. This is an expected integration artifact, **not a defect on this branch**, and the suite's dated allow-list at `scripts/test-rls.sql:5011-5031` is correctly sized at 21 (Phase 4's deviation D3, which added `presby_affiliation_parent_as_of` over Phase 3's 20, is confirmed correct). The allow-list should shrink to empty at integration, and the explanatory paragraph deleted.

2. **Integration fact — the journal back-fill is orchestrator-applied and is a blocker, not housekeeping.** I reproduced it: `drizzle-kit migrate` on an empty database exits 1 silently at 45 of 46 entries, because `_journal.json` is missing idx 26/27/28. The resulting database has 1 `people` policy instead of 4, and 0048 §3 is merely the first statement to notice. Phase 4's reclassification is correct — B-H3's premise ("the posture is reproducible from `drizzle/`") is unmet until the back-fill lands, and it must land **in the same integration** as `drizzle/0048`, not after. The migration *content* replays from empty perfectly via `psql` in filename order (49/49, exit 0), so this is a runner/journal defect, not a DDL defect.

3. **Behavioural change worth calling out at Phase 6:** `role_grants_role_fk` makes "adopt a template by cloning, never by granting it directly" a database property. A global template role can no longer be granted. Zero live rows violate it (measured), and `role-definitions.ts` already clones, but it is a genuine narrowing of what the database will accept.

4. **`presby_platform` still holds `SELECT,INSERT,UPDATE,DELETE` on `app_role_permissions`** (and broadly elsewhere) while being `rolcanlogin = false`. Harmless today, and DECISION-146 already defers the question, but Phase 4's own TODO line asking whether to drop the role or give it a login is the right call and should not be lost.

5. **Deviations D1–D4 all verified as described.** D1: the `revoke temporary … from public` is absent, with the measurement in the migration comment; `scripts/test-rls.sql:1292`'s `create temporary table t20_fresh_person` as `presby_app` is the blocker, and the suite asserts `TEMP = true` as a known-true fact (36.2) rather than shipping D2's contradictory pair. D2: only assertion 2 ships; assertions 2 and 3 as designed were mutually unsatisfiable and dropping 3 was correct. D3: 21 names confirmed against the live catalog. D4: `foreignColumns: [t.id, t.organizationId]` compiles clean and emits identical constraints — verified in `pg_constraint`, and `npm run typecheck` is green.

6. **No user-visible behaviour changed.** Workflow Rule 13 (what's-new) does not apply; Rule 14 (functionality map) likely does not either — this is internal hardening.

---

## Handoff

**To `database-admin` (Phase 4), scoped narrowly.** Two edits, no migration change:

- `scripts/test-rls.sql:5455-5457` — the fixture-leak canary cannot fire from `presby_app`; re-home or re-express it (G1).
- `src/lib/tickets.test.ts:250` — add `outsidePerson` to the `afterAll` teardown list at `:298-305` (G2).

Re-run on return: `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql` (expect exit 0), `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/tickets.test.ts` **twice**, checking `select count(*) from people where deletable_until is not null` on the owner connection before and after — it must not grow. Everything else in this report is verified and does not need re-running.

Nothing outside those two files is in question. On their return I expect PASS, and the next agent after that is `analyst` for Phase 6.



---

## Re-verification after the second pass (2026-09-25, qa) — recorded verbatim by the orchestrator

Narrow re-check of G1 and G2 only, per my own handoff. Everything verified in the first pass was re-confirmed as unchanged rather than re-audited.

## Scope containment

`drizzle/0048_presby_security_b.sql` md5 = **`9527609174bddee8eac13221a12ead16`** — matches the hash of the file I audited. Byte-identical; no migration change.

Exactly four files moved in the second pass (mtimes 15:32–15:35, after my audit window): `scripts/test-rls.sql`, `src/lib/db/fixture-deletable.ts`, `src/lib/db/fixture-deletable.test.ts` (new), `src/lib/tickets.test.ts`. Every other file in the diff — the seven `src/lib/db/domain/*.ts`, `scripts/seed.ts`, `src/lib/groups.ts`, `src/lib/db/index.ts`, `src/app/api/cron/maintenance/route.ts`, `drizzle/meta/_journal.json` — carries a pre-audit mtime. The full catalog dump (2,094 lines: ACLs, policies, RLS flags, `proconfig`, constraints, indexes, triggers, privileges) is **identical to my first-pass audited baseline**. The second pass touched no DDL and no database state. `git diff -U0 scripts/test-rls.sql` is still **two hunks** (`@@ -415,4 +415,4 @@`, `@@ -4871,0 +4872,632 @@`) — the new hunk is inside the appended block, so the integration merge stays mechanical.

## G1 — the vacuous canary

**Removed and correctly re-homed.** `scripts/test-rls.sql:5453-5472` is now a comment that reproduces the broken `assert_eq` verbatim, states why it could not fail, and points at the new home. Keeping it as a comment rather than a silent deletion is the right call — the next person writing an N-6 assertion reaches for exactly that shape.

**The replacement is a real detector, proven on my own plant.** I inserted a leak-shaped row on the owner connection, outside the test's tracking — `11110000-…-0000e9 QaLeak Probe`, a genuine 2-hour stamp aged 30 minutes (`deletable_until = now() + 90 min`) — and the canary went red:

```
× no leaked stamped people row is outstanding — regression for the tickets.test.ts fixture leak (G2)
1 leaked fixture person row(s) are outstanding. Once the window closes they are PERMANENT
on every connection (presby_app has no DELETE grant; the owner path hits
presby_guard_people_delete()). Remove them NOW, on the owner connection:
  delete from people where deletable_until is not null and deletable_until > now();
Then find the suite whose afterAll does not tear its fixture down.
  11110000-0000-4000-8000-0000000000e9 QaLeak Probe (window closes in 90m, …)
Tests  1 failed | 4 passed (5)
```

It names the row, prints the recovery command, and tells you what to go fix. Planted row removed; **5/5 green** again. This is the property the SQL version never had, and unlike the first pass I did not have to take the implementer's word for it — the detector failed on a row I planted, not on one the test planted for itself.

The inverse vacuity is also closed: the paired spec plants a *fresh* stamp and asserts it is **not** flagged, so this cannot degrade into a detector that flags everything. And the `organizations` half is covered by the same helper, which keeps the two guards from drifting.

**Judgment on the 20-minute blind spot: acceptable, with the residual stated.** I probed the boundary myself rather than reading the constant — three rows at aged-0 / aged-19 min / aged-21 min:

```
Fresh     -> invisible (blind spot)
Age19min  -> invisible (blind spot)
Age21min  -> FLAGGED
```

Exactly as documented. The reasoning holds in both directions:

- **No false positives.** The cutoff is 20 minutes; the longest full serial run I measured is 5 m 55 s (354.79 s, first pass) and 6 m 5 s (365 s, this pass). A live fixture cannot be 20 minutes old, so the canary will not fire on an in-flight suite. That matters more than it sounds — a canary that cries wolf gets deleted.
- **The blind spot is bounded and disclosed.** A leak is detectable from T+20 min to T+2 h — a **100-minute** window — and invisible only to a re-run started within 20 minutes of the run that caused it. The limitation is written in `fixture-deletable.ts` where the constant lives, not buried in the test.
- **There is an exact backstop.** The separate "no stamped people row has an EXPIRED window" spec is heuristic-free and fires forever after. So a leak that escapes the 100-minute window is still *reported* — just too late to fix, and the message says so. You always learn; you may learn too late.
- **The alternative is disproportionate.** Threading a run id through `fixtureDeletableUntil()`'s bare `Date` return touches 30-odd call sites, i.e. exactly the churn the stamp-at-insert design (Ruling 7.3) exists to avoid.

Residual risk, for the record so Phase 6 is not surprised by it: a single isolated run — a lone CI job, or a developer who runs once and stops — whose leak is never followed by another run inside 100 minutes will go permanent unnoticed until some later run trips the expired-window spec. That is a real, narrow hole, correctly traded against a 30-site refactor, and it is named in the code rather than discovered later. I would not ask for more here.

## G2 — the `tickets.test.ts` leak

**Fixed, and fixed better than I asked for.** I requested `outsidePerson` be added to the teardown list; the implementer instead converted the file to the tracked-array pattern — `person()` pushes into `trackedPeopleIds` at insert, teardown iterates the array. That is the right call and I was wrong to specify the minimum: the root cause is that a *hand-maintained list* went stale against a block-local `const`, so adding one more name leaves the next fixture free to repeat it. Tracking at insert closes the class, not the instance. Both the array and the teardown carry a comment recording what went wrong.

Owner-connection counts, measured by me around two runs:

| | stamped `people` rows |
|---|---|
| before | **0** |
| after run 1 (21/21 pass) | **0** |
| after run 2 (21/21 pass) | **0** |

The three rows I flagged are gone: the specific ids `b1d633de-…`, `77ed97de-…`, `d9a3cac9-…` return **0** on the owner connection, total stamped `people` is **0**, stamped `organizations` is **0**, and rows with an already-expired window is **0** — nothing was lost to the deadline.

## Re-run results

| Check | Result |
|---|---|
| `psql "$APP_DATABASE_URL" … -f scripts/test-rls.sql` | **exit 0, 455 `pass`, 0 `FAIL`** (run twice) |
| `vitest run --no-file-parallelism src/lib/db/fixture-deletable.test.ts` | **5/5 pass**; red on my planted leak, green after removal |
| `vitest run --no-file-parallelism src/lib/tickets.test.ts` ×2 | 21/21 both; stamped count 0 → 0 → 0 |
| Full DB-backed serial, **all 276 files** | 275 passed / 1 failed; 4,020 passed / 3 failed / **0 skipped**; 365 s. Stamped `people` **0 before, 0 after**; stamped `organizations` 0 |
| `npm run test` | **exit 0** — 246 passed, 30 skipped (276); 3,241 passed, 782 skipped |
| `npm run typecheck` | exit 0 |
| `npm run check` | exit 0 (all five tripwires) |
| `npx eslint` on the three touched/new files | exit 0 |

The only red remains `src/lib/rate-limit.test.ts:241,256,279` — the `RATE_LIMIT_DISABLED=true` artifact of the serial mode, green under `npm test`. Unchanged, pre-existing, unrelated.

**455, not 456, is correct and is the point:** 412 baseline − 1 (`:414-418`'s drift call) − 1 (G1's vacuous count) + 45 new. The suite is one assertion smaller and strictly more truthful.

**One fact that is now measured rather than reasoned:** stamped-row count is 0 after a full serial run of all 276 files, so `tickets.test.ts` was the *only* leaker. In the first pass that was an inference from reading teardowns; it is now an observation.

## Verdict

**PASS.**

Both gaps are closed, and neither was closed by weakening the check. The canary can fail — I made it fail on a row of my own planting, which is the bar the first version missed. The leak is gone at the class level, not the instance level. `drizzle/0048` is byte-identical to the file whose ten mechanisms I verified against the live catalog, and the database state is unchanged from that audit, so nothing in the first pass needs re-litigating.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — re-verified after database-admin's second pass; G1 and G2 closed, scope containment confirmed by hash and catalog diff | **PASS** | 2026-09-25 |

## Handoff

To **`analyst` for Phase 6**. The Notes for Phase 6 in my first-pass section stand unchanged — in particular the two integration facts (the 21 unpinned `0043`–`0047` DEFINER functions get `pg_temp` from `main`; the `_journal.json` idx 26/27/28 back-fill is an orchestrator-applied **blocker**, not housekeeping, and must land in the same integration as `drizzle/0048`). Add one line to the integration TODO proposal: the 20-minute staleness grace in `src/lib/db/fixture-deletable.ts` is a deliberate, documented blind spot; if fixture leaks recur, the fix is a run id threaded through `fixtureDeletableUntil()`, not a smaller constant.



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

---

# Phase 4 — Implementation (database-admin)

*Every number below was measured on this pipeline's own Neon branch
(`pipeline-security-schema-b`, PostgreSQL 18.6) during this phase, not carried
forward from Phase 2/3's prose. Where a Phase 3 instruction did not survive
contact with the database, it is named as a deviation with the measurement that
killed it rather than quietly worked around.*

## Migration mode

**Hand-written**, per `.claude/agents/database-admin.md`'s "Presby Domain
Schema" and `docs/TODO.md`'s standing note that `npm run db:generate` has been
broken repo-wide since the `0009`–`0012` snapshot-chain collision. Drizzle Kit
emits none of what this migration is made of — RLS policies, `FORCE ROW LEVEL
SECURITY`, `ALTER FUNCTION … SET search_path`, a `SECURITY DEFINER` trigger
function, `UNIQUE … NULLS NOT DISTINCT`, and eleven `revoke` statements.

- **File:** `drizzle/0048_presby_security_b.sql` (nine sections, in Phase 3's
  stated order).
- **Applied with:** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f
  drizzle/0048_presby_security_b.sql` against the `development`-forked Neon
  branch `pipeline-security-schema-b`, on the direct (unpooled) `neondb_owner`
  endpoint. Never against `$APP_DATABASE_URL`.
- **`drizzle/meta/_journal.json`:** one appended entry,
  `{ "idx": 48, "tag": "0048_presby_security_b" }` — a 7-line pure append at
  the end of the array, no mid-file edit. The B-L4 back-fill of idx 26/27/28
  is **not** in this diff; it stays the orchestrator's job at integration
  (Phase 2 §4, binding). **Read the from-scratch result below before treating
  that back-fill as cosmetic — it is not.**

## Files modified

**Schema / migration (2)**

| File | Change |
|---|---|
| `drizzle/0048_presby_security_b.sql` | New. Nine sections; full DDL below. |
| `drizzle/meta/_journal.json` | Appended idx 48. |

**Drizzle declarations, mirroring the migration (7)**

| File | Change |
|---|---|
| `src/lib/db/domain/events.ts` | `parentEventId` loses `.references()`; new `events_parent_fk` composite in the `(t) => [...]` array; `AnyPgColumn` import dropped, `foreignKey` added. |
| `src/lib/db/domain/roll.ts` | Same shape for `voidsActionId` → `roll_actions_voids_fk`, plus `roll_actions_voids_idx`; `AnyPgColumn` dropped. |
| `src/lib/db/domain/publication.ts` | Same for `supersedesId` → `publications_supersedes_fk`; `AnyPgColumn` dropped. |
| `src/lib/db/domain/person-ext.ts` | Same for `rollActionId` → `person_milestones_roll_action_fk`, plus `person_milestones_roll_action_idx`. |
| `src/lib/db/domain/authz.ts` | `appRoles` gains `unique("app_roles_id_org_key")`; `roleGrants.roleId` loses `.references()`; new `role_grants_role_fk` composite with `.onDelete("cascade")`, plus `role_grants_role_idx`. |
| `src/lib/db/domain/groups.ts` | `index("group_types_org_idx")` replaced by `unique("group_types_org_key").nullsNotDistinct()`. |
| `src/lib/db/domain/people.ts` | New `deletableUntil: timestamp("deletable_until", { withTimezone: true })`, with a comment pointing at the trigger Drizzle cannot express. |

`src/lib/db/domain/index.ts` is **unchanged** — no new table, no new export.
The architect's Phase 2 §4 prediction held, so this pipeline has one fewer
shared-file collision with `pipeline/submission-grants` than feared.

**Grant / seed (3)**

| File | Change |
|---|---|
| `scripts/seed.ts` | Five catalog writers moved from `db` to `platformDb` as one unit with §2's revokes: `seedRoles`, `seedFeatures`, `seedFlags`, `bindAdminFeatures`, `bindSupportOperatorFeatures` (including the two `db.query.roles.findFirst` reads those last two lead with). The `:43` comment's "presby_platform role" corrected to `neondb_owner`, and the `PLATFORM_DATABASE_URL` guard message widened past `seedGroupTypes()`. |
| `src/lib/db/index.ts` | Line 12's `platformDb  presby_platform.` corrected to `neondb_owner (via PLATFORM_DATABASE_URL)`, with the F44 consequence spelled out (DECISION-146). |
| `scripts/test-rls.sql` | See "Shared-file discipline" below. |

**Application follow-ons (3)**

| File | Change |
|---|---|
| `src/lib/groups.ts` | Three `getPlatformDb()` reads → `tx`; `groupTypeNamesByIds` takes `tx: OrgTx`; the `getPlatformDb` import is gone entirely; the module-header paragraph and four inline call-site comments replaced with the B-M4 explanation. |
| `src/app/api/cron/maintenance/route.ts` | Imports `getPlatformDb`; only the `presby_reconcile_current_roll()` statement moves; the three token DELETEs stay on `db`. |
| `src/lib/db/fixture-deletable.ts` | Doc comment widened to cover both `organizations.deletableUntil` and `people.deletableUntil`, and to name the two legitimate teardown-stamp sites. |

**Tests (24 files)** — see "Tests are mine" below.

## Schema changes

Nine sections, applied in Phase 3's order (B-H3 first, F70 second, C-3's
catch-all in `test-rls.sql` rather than the migration).

1. **B-H3 — the grant model, written down and narrowed.** 22 platform-shell
   tables' grants restated so the posture is reproducible from `drizzle/`
   alone, plus eleven revokes. Before this file, *nothing in `drizzle/`*
   granted `presby_app` anything on `users`/`accounts`/`sessions`/the TOTP
   tables, so a database rebuilt from the migration history failed at first
   sign-in — and four table classes were also wider than any call site needs.
2. **F70 — `SET search_path = public, pg_temp`** on the fourteen `SECURITY
   DEFINER` functions defined in 0001–0042. Signatures read from `pg_proc`,
   not from the migration files (`presby_published_site` and
   `presby_public_staff_roster` are each defined in more than one). The 21
   functions from 0043–0047 are excluded as the lifecycle pipeline's
   concurrent work and carried as a dated allow-list in the suite.
3. **B-H2 — `app_role_permissions`** gains `ENABLE` + `FORCE ROW LEVEL
   SECURITY` and four policies reaching through `role_id → app_roles`;
   `UPDATE` revoked from `presby_app`.
4. **B-M4 + B-L1 — `group_types`.** `tenant_isolation` replaced by the
   four-policy split (SELECT admits `organization_id is null`, I/U/D do not).
   1,557 duplicate rows repointed-then-deleted, surviving names normalized to
   the seed catalog, and `unique nulls not distinct (organization_id, key)`
   added. `group_types_org_idx` dropped.
5. **C-4 + B-L3 —** `revoke all on function` from `public, presby_app` on both
   `presby_roll_cache_drift()` and `presby_reconcile_current_roll()`.
6. **B-M3 + B-L6 — five composite FKs** (`events_parent_fk`,
   `person_milestones_roll_action_fk`, `publications_supersedes_fk`,
   `roll_actions_voids_fk`, `role_grants_role_fk`), the new
   `app_roles_id_org_key` anchor they need, and three FK indexes
   (`person_milestones_roll_action_idx`, `roll_actions_voids_idx`,
   `role_grants_role_idx`). `groups.group_type_id` deliberately excluded, with
   the reason in the migration so a future F2 sweep does not reopen it.
7. **N-6 — `people.deletable_until`** plus `presby_guard_people_delete()` and
   the `people_guard_delete` BEFORE DELETE trigger.

**Audit events:** n/a. No `AUDIT_ACTIONS` key is added, removed, or referenced;
no mutation in an `actions.ts` changes. `npm run check:audit` passes.

## Deviations from the Phase 3 design (four, each with the measurement)

**D1 — `revoke temporary on database … from public` is NOT in the migration.**
Phase 3 §3 specified it as belt-and-braces on top of the `pg_temp`-last clause.
Measured on this branch: it breaks the isolation suite itself.
`scripts/test-rls.sql:1292` does `create temporary table t20_fresh_person as
select gen_random_uuid() as id` **as `presby_app`**, and under the revoke that
raises `ERROR: permission denied to create temporary tables in database
"neondb"` — with `\set ON_ERROR_STOP on`, every assertion after line 1292 never
runs. Proven live (revoke → probe → restore), and that is exactly the
"part of the file ran, the corrected part did not" failure mode B-H1 was.
Removing the suite's temp table is a mid-file edit to a shared file during a
parallel pipeline (Rule 16), and the architect's own Phase 2 §3 ruling is that
the `pg_temp`-last clause is the **primary** control and the revoke "secondary
at best". Deferred; proposed TODO line below. The migration carries the
measurement in a comment so the next reader does not re-add it blind.

**D2 — Phase 3 §(b)'s `test-rls.sql` assertions 2 and 3 are mutually
contradictory; assertion 3 is dropped.** Assertion 2 asserts
`has_database_privilege('presby_app', …, 'TEMP') = true` and assertion 3
asserts the identical expression `= false`. They cannot both pass. With D1,
assertion 2 is the true one and is shipped as a documented known-true fact with
a comment saying what would have to change for it to flip.

**D3 — the F70 dated allow-list is 21 names, not Phase 3's 20.** Measured:
`presby_affiliation_parent_as_of` is `prosecdef = t`, is defined in
0044/0045/0047, and was absent from Phase 3 §(b).4's list. Phase 3 itself told
the implementer to re-verify membership against the live catalog rather than
copy the list; this is that re-verification. The 21 shipped names are exactly
the list the file's own existing B-M2 assertion already uses, so the two agree.
35 `prosecdef` functions total = 14 (F70's sweep) + 21 (allow-listed).

**D4 — the self-referencing composite FKs reference `t`, not the table.**
Phase 3's feasibility note said no lazy thunk is needed because the
`(t) => [...]` array is not invoked until after module load. That is true **at
runtime** and false **for TypeScript**: writing `foreignColumns: [events.id,
events.organizationId]` inside `events`' own config array makes the table's
inferred type depend on itself — `TS7022: 'events' implicitly has type 'any'
because it … is referenced directly or indirectly in its own initializer`, plus
a `TS7024` on the callback, on all three of `events`/`rollActions`/
`publications` (measured, `npm run typecheck`). Using `t.id, t.organizationId`
— the same columns, the same table reference — compiles clean and emits the
identical constraint. Verified by reading the built table config back at
runtime through `getTableConfig()`: all five FKs report two columns on each
end, `role_grants_role_fk` reports `onDelete=cascade`, and
`group_types_org_key` reports `nullsNotDistinct=true`.

**Additions Phase 3 did not name (three, all measured, none optional):**

- **A sixth seed blocker, in a test.** `src/app/api/sites/ingest/route.test.ts`
  and four sites in `src/lib/sites.test.ts` upsert `feature_flags` on the
  **tenant** `db` handle. `onConflictDoUpdate` needs `INSERT`, so §2's revoke
  breaks them. All five moved to `getPlatformDb()`.
- **Production-created people have no fixture insert to stamp.** Phase 3's
  32-call-site count is right for fixture rows, but `src/lib/people.test.ts`
  sweeps four surnames' worth of rows that `createPerson()` created, and
  `src/app/(org)/o/[slug]/admin/staff/actions.test.ts` tracks a person
  `createStaffPersonAction()` created. Production code must never stamp
  `deletable_until`. Those two teardowns open the window explicitly, against
  the same predicate the DELETE uses, with the reasoning inline. Every other
  teardown call site is untouched, exactly as Ruling 7.3 requires.
- **The `group_types` duplicate generator was a test fixture, and it is fixed.**
  `src/lib/groups.test.ts`'s `findOrCreateGroupType()` led with
  `insert(...).onConflictDoNothing()` against a table that had **no unique
  constraint**, so the conflict clause never fired and every run of that file
  inserted a fresh lowercase-named platform template. That is where the 118
  `court` / 220 `roster` / 51 `committee` rows came from. It now reads first
  and writes the catalog display name. Two assertions that expected the
  casing-lottery value (`"court"`, `"roster"`) now expect `"Court"`/`"Roster"`.

## Proofs

**P1 — whole-file idempotency, and it is a whole-file proof, not a partial
re-apply.** `psql -v ON_ERROR_STOP=1 -f drizzle/0048_presby_security_b.sql`
twice in a row, both `exit=0`. A 2,900-line catalog + row-state dump
(table ACLs, function ACLs, `pg_policies` with `qual`/`with_check`,
`relrowsecurity`/`relforcerowsecurity`, `proconfig`, every constraint
definition, every index definition, non-internal triggers, row counts, and
every `group_types` row) taken after each run **diffs byte-identical**. DML
row counts: first-ever application reported `DELETE 1557`, `UPDATE 14`,
`UPDATE 2`; every subsequent run reports `DELETE 0`, `UPDATE 0`, `UPDATE 0`.

> One idempotency bug was found this way and fixed: dropping
> `app_roles_id_org_key` before dropping the dependent `role_grants_role_fk`
> raises *"cannot drop constraint … because other objects depend on it"* on the
> second run. Section 7 now drops the dependent FK first and says why.

**P2 — no-op-or-narrowing, proved with a before/after `aclexplode` dump.**
Baseline captured before the first application (1,269 grant rows across
83 tables), re-captured after. `comm -13` (privileges **added**): **empty**.
`comm -23` (privileges **removed**): **20**, and exactly the intended set —

```
app_role_permissions|presby_app|UPDATE      features|presby_app|{INSERT,UPDATE,DELETE}
audit_events|presby_app|{UPDATE,DELETE}     migration_seeds|presby_app|{INSERT,UPDATE,DELETE}
feature_flags|presby_app|{INSERT,DELETE}    permissions|presby_app|{INSERT,UPDATE,DELETE}
                                            role_features|presby_app|{INSERT,UPDATE,DELETE}
                                            roles|presby_app|{INSERT,UPDATE,DELETE}
```

Plus the two function ACLs, which now read `neondb_owner:EXECUTE` and nothing
else for both `presby_roll_cache_drift()` and `presby_reconcile_current_roll()`.

**P3 — `scripts/test-rls.sql`: 412 → 456 passing, exit 0, as `presby_app`.**
`psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql`,
`exit=0`, 456 `pass` notices, zero `FAIL`. Arithmetic: 412 baseline − 1 deleted
(`:414-418`'s drift call) + 45 new = 456.

**P4 — the `presby_two_factor_required` temp-table shadowing probe, re-run as
`presby_app` and now unaffected — with the failing-first half done explicitly.**
Phase 2's probe errored on a shape-mismatched decoy, which proved shadowing but
not the *answer flip*. Re-run with a **shape-correct** decoy
(`create temp table people (id uuid, user_id uuid, merged_into_id uuid)`, zero
rows) against a user who genuinely requires 2FA
(`e0000000-…-f2`), entire transaction rolled back:

```
-- with the PRE-F70 clause (alter function … set search_path = public):
honest_answer=true
UNDER_SHADOW_pre_F70=false        <-- the attacker-chosen answer: "no 2FA needed"

-- with the shipped clause (… = public, pg_temp):
caller_resolves_people_to=pg_temp_453   <-- the caller still sees its decoy
definer_answer_under_shadow=true        <-- the definer does not
```

The decoy is still resolved by the *caller*; the DEFINER body is not fooled.
This also confirms B-M2's stated reason for rating F70 non-exploitable was
wrong, exactly as Phase 2 §3 argued.

**P5 — failing-first, per mechanism, run against the whole suite so the
citation is a real assertion at a real line.** Each mechanism was dropped or
disabled, the suite re-run as `presby_app`, the failure recorded, the mechanism
restored, and the suite confirmed green again (456/0) at the end.

| # | Mechanism removed | Suite result | Failure cited |
|---|---|---|---|
| FF-1 | `app_role_permissions` RLS disabled (`no force` + `disable`) | exit 3, 424 pass | `test-rls.sql:5103` — `FAIL C-3: every table in schema public carries FORCE ROW LEVEL SECURITY except the 25 named … — expected 0, got 1` (the inverted catch-all caught it before the B-H2 section even ran) |
| FF-1b | only `app_role_permissions_insert` dropped | exit 3, 427 pass | `test-rls.sql:5149` — `FAIL B-H2: the four-policy split is in place, not a single tenant_isolation catch-all — expected 4, got 3` |
| FF-1d | the B-H2 defect exactly as it shipped (no RLS at all), write probe only | — | `FAIL B-H2: cross-tenant INSERT into app_role_permissions SUCCEEDED` |
| FF-2 | `grant execute on presby_roll_cache_drift() to presby_app` | exit 3, 439 pass | `test-rls.sql:5303` — `FAIL C-4/B-L3: neither presby_app nor PUBLIC holds EXECUTE … — expected 0, got 1` |
| FF-3 | `grant execute on presby_reconcile_current_roll() to public` | exit 3, 439 pass | `test-rls.sql:5303` — same assertion, `expected 0, got 2` |
| FF-4 | `roll_actions_voids_fk` reverted to the single-column FK | exit 3, 442 pass | `test-rls.sql:5346` — `FAIL B-M3: all five tenant->tenant FKs are COMPOSITE — expected 5, got 4` |
| FF-5 | `people_guard_delete` trigger dropped | exit 3, 449 pass | `test-rls.sql:5426` — `FAIL N-6: people carries an ENABLED people_guard_delete trigger — expected 1, got 0` |
| FF-6 | `presby_two_factor_required` re-pinned to `search_path = public` | exit 3, 413 pass | `test-rls.sql:4967` — `FAIL F70: every SECURITY DEFINER function … pins search_path = public, pg_temp — expected 0, got 1` |
| FF-7 | `group_types_org_key` dropped | exit 3, 437 pass | `test-rls.sql:5263` — `FAIL B-L1: group_types_org_key is UNIQUE NULLS NOT DISTINCT — expected 1, got 0` |
| FF-8 | `grant insert on roles to presby_app` | exit 3, 422 pass | `test-rls.sql:5055` — `FAIL B-H3: presby_app cannot write ANY global catalog — expected 0, got 1` |
| — | everything restored | **exit 0, 456 pass, 0 FAIL** | — |

**P6 — the mechanisms proven directly as well, on the owner connection**
(because some of them are owner-path controls the suite cannot exercise):
the composite `events_parent_fk` refuses a cross-org parent and the
single-column form accepts it; `role_grants_role_fk` refuses a direct grant of
the global `committee_chair` template; `presby_guard_people_delete()` refuses
an unstamped DELETE and an expired-stamp DELETE and permits a live-stamped one;
`presby_app` is refused `EXECUTE` on both roll functions at the call site while
`neondb_owner` still runs both.

## From-scratch build (acceptance criterion 3) — run, and it found something

Run exactly as Phase 3 specified: a **new, empty database** on this pipeline's
own Neon branch (`scratch0048` / `scratch0048b`), a scratch env file pointing
all five connection strings at it, `drizzle-kit migrate`, `db:seed` with
`example.invalid` placeholder credentials, and a real first sign-in against a
dev server on port 3200. Both scratch databases and the scratch env file were
dropped afterwards; `neondb` (the pipeline branch) is untouched, 15 fixture
orgs intact.

**Result — honestly, as instructed: `npm run db:migrate` DOES NOT produce a
working database from empty, and the cause is B-L4, this pipeline's own
"housekeeping" item.**

`drizzle-kit migrate` applied 45 of the journal's 46 entries, then exited `1`
**with no error message on either stream** (the known-broken runner
`docs/TODO.md` already describes). Applying the 46th by hand gave the real
error:

```
psql:drizzle/0048_presby_security_b.sql:139:
  ERROR:  function presby_person_unclaimed_or_own_org(uuid) does not exist
```

That function is created in `drizzle/0028_presby_people_write_rls_fix.sql` —
one of the **three migrations missing from `_journal.json`** (idx 26/27/28,
B-L4). `drizzle-kit migrate` reads the journal, so it never applied 0026, 0027
or 0028 at all. The scratch database ended with **1** policy on `people` where
the pipeline branch has **4**: the entire people-write RLS fix, the org
feature toggles and the member-management layer were silently absent, and
0048's F70 section was simply the first statement to notice.

**This reclassifies B-L4.** Phase 1 and Phase 3 both list the missing journal
entries under "housekeeping". They are not housekeeping: they are the reason
the migration history cannot rebuild the database, and B-H3's whole premise —
"the security posture must be reproducible from `drizzle/`" — is not satisfied
until the back-fill lands. The back-fill remains the orchestrator's edit at
integration (Phase 2 §4 is binding and this branch did not touch the middle of
that shared file), but it should land **with** this migration, not after it.

**Second attempt, and the one that passes:** a fresh empty database with every
`drizzle/*.sql` replayed in **filename order** via
`psql -v ON_ERROR_STOP=1 -f` — the documented apply path for this repo —
**all 49 files applied cleanly, exit 0, including 0048.** So the migration
*content* replays from empty correctly; only the journal-driven runner does not.

From-scratch posture, measured on that database and identical to the pipeline
branch: 83 tables / 58 FORCE; 15 `prosecdef` functions pinned to
`search_path = public, pg_temp`; 56 of 56 full-CRUD grants present on the
fourteen platform-shell tables; **0** of 15 catalog-write grants present;
`people_guard_delete` installed.

- `db:seed` against it: clean, including `created local admin` and
  `bound local admin to admin role` — both of which write `users` and
  `user_roles` **on the `presby_app` connection**, which is the direct test of
  the B-H3 grant model plus the `scripts/seed.ts` swap together.
- First sign-in: `POST /api/auth/callback/credentials` → `302` to `/launch`;
  `/api/auth/session` returns the seeded admin with 11 features; `GET /launch`
  → **`307` to `/admin`**; `GET /admin` → `200`; `GET /admin/users` → `200`.
  That is the Post-Login Landing matrix's "0 enterable / `canAccessAdmin` yes /
  `isPlatformAdmin` no → `/admin`" row, and it is the literal "first sign-in"
  B-H3's scope language names. Before this migration that path did not exist in
  `drizzle/` at all.

## Tests are mine (QA runs them)

**`scripts/test-rls.sql` — section 36**, one delimited block appended at the
end (614 lines), plus the one pre-authorized mid-file edit. `git diff -U0`
reports exactly two hunks: `@@ -415,4 +415,4 @@` and `@@ -4871,0 +4872,614 @@`.
The `:414-418` `presby_roll_cache_drift()` assertion is replaced in place by a
4-line comment of the same length saying where the claim went — the diff is
line-for-line mechanical for the integration merge. Subsections:

| § | Covers |
|---|---|
| 36.1 | no `CREATE` on schema `public` or the database for `presby_app`, `presby_platform`, `PUBLIC` |
| 36.2 | `TEMP` asserted as a known-true fact, with the D1 reasoning |
| 36.3 | `proconfig` = `public, pg_temp` on every `prosecdef` outside the dated allow-list; **and** that the fourteen altered functions still carry it (a bare "0 non-compliant" would also pass if they had all been dropped — this is the assertion that catches 0048's own drift-remediation trap); `presby_current_org()` stays INVOKER |
| 36.4 | B-H3, one assertion per table class: full-CRUD 14×4, `audit_events` append-only both ways, `feature_flags` update-but-not-create, catalogs SELECT-only both ways, org tree SELECT-only |
| 36.5 | C-3's **inverted** FORCE catch-all with the literal 25-name allow-list, plus a second assertion that the allow-list itself has not gone stale |
| 36.6 | B-H2: enabled+forced, four policies, grant shape, no foreign binding visible, the template arm still readable, and the cross-tenant INSERT refused |
| 36.7 | B-M4 four-policy split, `tenant_isolation` gone, six templates visible, one row per key, `indnullsnotdistinct`, and a tenant refused when minting a platform template |
| 36.8 | C-4/B-L3 both functions, both roles, asserted at the catalog **and** at the call |
| 36.9 | B-M3 five composites, five originals gone, the `app_roles_id_org_key` anchor, `confdeltype='c'`, B-L6's three indexes, and the `groups.group_type_id` exclusion asserted so a future sweep does not "fix" it |
| 36.10 | N-6 trigger present/enabled/`BEFORE DELETE FOR EACH ROW`, the guard function's own `pg_temp` pin, the column's type, no production row carrying a window, and `presby_app` still holding no `DELETE` |

**Vitest.** New regression tests, each named for what it protects:

- `src/lib/people.test.ts` — *"refuses to hard-delete an unstamped person on
  the platform connection — regression for N-6 people delete guard"*, plus the
  live/expired-window pair and the grant-layer assertion.
- `src/lib/role-definitions.test.ts` — *"— regression for B-H2 cross-tenant
  app_role_permissions read"*, *"— regression for B-H2 cross-tenant
  app_role_permissions write"*, the load-bearing template-arm test, and
  *"— regression for B-M3 role_grants.role_id composite FK"*.
- `src/lib/roll.test.ts` — *"— regression for B-M3
  roll_actions.voids_action_id"*, plus the same-org positive case.
- `src/lib/groups.test.ts` — *"— regression for B-L1 group_types duplicates"*,
  *"— regression for B-M4"* (the form-options read now goes through `tx`), and
  the tenant-cannot-mint-a-template test.
- `src/app/api/cron/maintenance/route.test.ts` — *"— regression for C-4
  presby_reconcile_current_roll grant"*: the mock is now **two** handles, and
  the test asserts three statements on `db`, one on `getPlatformDb()`, and
  which statement is on which.

> A shared `rejectionChain()` helper appears in two suites because Drizzle
> wraps every driver error in `Failed query: …`; matching the outer message
> would assert nothing more than "something went wrong", so the assertions walk
> the `cause` chain for the constraint name or `row-level security policy`.

**Fixture stamping.** 32 `platform.insert(people).values({...})` call sites
across 23 files gained `deletableUntil: fixtureDeletableUntil()` **at insert**,
reusing the existing helper. Not one existing `platform.delete(people)`
teardown line was wrapped in a disable/enable pair. The two exceptions (rows
production code created) are described under Deviations.

**Results, all on this branch:**

| Check | Result |
|---|---|
| `scripts/test-rls.sql` as `presby_app` | **exit 0, 456 pass, 0 FAIL** (from 412) |
| DB-backed serial — `role-definitions`, `groups`, `people`, `roll`, `presbytery`, `org-provisioning` | **6 files, 182 tests, all pass** |
| DB-backed serial — the other 19 files touching `people`/`feature_flags` (staff actions, sites ingest, read-org-brand, children, credentials, directory, events, officers, org-feature-categories, org-features, find-person, home-data, people-update, person-sensitive, role-grants, sites, staff, tenant-branding, tickets) | **19 files, 490 tests, all pass** |
| `npm test` | **246 files passed, 29 skipped; 3,241 tests passed, 777 skipped, 0 failed** |
| `npm run typecheck` | **clean** |
| `npm run check` | **all five tripwires pass** |
| `npm run lint` | 7 errors / 190 warnings, **all pre-existing and none in a file this pipeline touched** (`portal-nav-links.tsx`, `branding-form.tsx`, `children/page.tsx`, `children-roster-list.test.tsx`) |
| `npm run db:seed` on the pipeline branch, post-revoke | clean |

## Shared-file discipline (Rule 16)

| File | Shape of this branch's edit |
|---|---|
| `scripts/test-rls.sql` | One delimited block at EOF (`BEGIN/END APPENDED SECTION` banners) + the one pre-authorized 4-line in-place replacement at `:415`. Two hunks total. |
| `drizzle/meta/_journal.json` | Pure 7-line append. **No idx 26/27/28 insert.** |
| `src/lib/db/domain/index.ts` | **Untouched.** |
| `scripts/seed-dev.sql` | **Untouched** — no fixture shape changed. |
| `e2e/support/seed-orgs.ts` | **Untouched.** |
| `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `CLAUDE.md` | **Untouched**, as instructed. Proposed lines below. |

## Proposed lines for the orchestrator to apply at integration

`docs/decisions.md` — DECISION-146 exactly as the architect drafted it in
Phase 2 §1; no edits needed.

`docs/TODO.md` — in addition to Phase 2 §4's four and Phase 1's agreed
deferrals (B-M1, B-M2 residual, B-L2, B-L5, B-I1–I6):

- **`_journal.json` idx 26/27/28 back-fill is a from-scratch BLOCKER, not
  housekeeping** — apply it in the same integration as `drizzle/0048`. Without
  it `drizzle-kit migrate` silently skips 0026/0027/0028 and the resulting
  database has one `people` policy instead of four. Measured this phase.
- **`revoke temporary on database … from public`** — deferred from 0048 (D1).
  Prerequisite: remove or replace `scripts/test-rls.sql:1292`'s
  `create temporary table t20_fresh_person`, which only a non-parallel
  housekeeping pass should touch.
- **Delete the 13 hand-enumerated per-table FORCE assertions** now superseded
  by §36.5's catch-all — deferred for the same shared-file reason (Phase 3
  named this deviation; it stands).
- **Shrink the F70 dated allow-list to empty** once the lifecycle pipeline's
  eleventh loop-back lands `public, pg_temp` on the 21 functions from
  0043–0047, and delete the paragraph in §36.3 that explains it.
- **`scripts/test-rls.sql` still runs `db:migrate`-unverified assertions about
  `presby_platform`** — that role is `rolcanlogin = false` and nothing connects
  as it; the DECISION-146 follow-up (a platform-shell DML accessor, then
  possibly a third connection) should decide whether to drop the role or give
  it a login.

**Cross-pipeline heads-up, restated because it now has teeth:**
`pipeline/submission-grants` (`drizzle/0049`) adds new `SECURITY DEFINER`
functions. Once §36.3 is on `development`, any new DEFINER function without
`SET search_path = public, pg_temp` fails that assertion at integration. It is
a one-line clause per function, but it has to be written before the merge, not
after.

## Handoff

**To `qa` for Phase 5.**

**New tables:** none. **New columns:** `people.deletable_until timestamptz`
(nullable; test fixtures only).

**New/changed relationships available to the next implementer:**

- `events.(parent_event_id, organization_id) → events(id, organization_id)`
- `person_milestones.(roll_action_id, organization_id) → roll_actions(id, organization_id)`
- `publications.(supersedes_id, organization_id) → publications(id, organization_id)`
- `roll_actions.(voids_action_id, organization_id) → roll_actions(id, organization_id)`
- `role_grants.(role_id, organization_id) → app_roles(id, organization_id) ON DELETE CASCADE`
  — **behavioural change worth knowing: a global template role can no longer be
  granted directly; adoption must clone.**
- `app_roles` now has `unique (id, organization_id)`; `group_types` now has
  `unique nulls not distinct (organization_id, key)` and exactly six rows.
- `app_role_permissions` is now RLS-filtered on the tenant connection — a read
  of a template's bindings works, a write against another org's role does not.
- `group_types` platform templates are now readable through `withOrgContext()`;
  **do not add a new `getPlatformDb()` escape to read them.**
- `presby_roll_cache_drift()` and `presby_reconcile_current_roll()` are
  **owner-only**. Any future caller must be on `getPlatformDb()`.

**Local apply command** (against your own Neon branch, owner/direct endpoint):

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0048_presby_security_b.sql
npm run db:seed          # required: the catalog writers moved connections
```

`npm run db:migrate` is **not** a working substitute on an empty database until
the `_journal.json` 26/27/28 back-fill lands — see the from-scratch section.
`scripts/seed-dev.sql` did not change and does not need re-running.

**`test-rls.sql` sections touched:** section 36 added (new); section 10's
`:414-418` replaced.

**Run the suite with:**

```bash
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql
# expect: exit 0, 456 "pass" notices, zero FAIL
```

**Next agent after QA:** `analyst` for Phase 6. No `api-developer` handoff is
needed — the two application follow-ons this pipeline owed are already in the
diff.

---

# Phase 4, second pass (QA G1/G2)

*2026-09-25, database-admin. QA's FAIL is accepted in full and both gaps were
real. **No change to `drizzle/0048_presby_security_b.sql`** — every mechanism
stood up to QA's independent audit, and nothing in this pass touches the
migration, `_journal.json`, or any `src/lib/db/domain/*.ts` file.*

## 0. Leaked-row cleanup (done first, before any edit)

The three leaked stamped `people` rows QA identified were removed on the owner
connection with roughly 80 minutes of window left on the earliest of them.
Inventory taken immediately before the delete, `now() = 2026-09-25 19:30:18 UTC`:

| id | name | `deletable_until` | still deletable? |
|---|---|---|---|
| `b1d633de-a899-4a16-9826-b8a67a9b8efc` | Marisol Enweazu | `2026-09-25 20:51:57.489+00` | yes |
| `77ed97de-4781-4320-91f7-4ffffd088c5b` | Marisol Enweazu | `2026-09-25 21:12:32.972+00` | yes |
| `d9a3cac9-4c34-4084-a960-21adc38ba95e` | Marisol Enweazu | `2026-09-25 21:22:54.477+00` | yes |

```
delete from people where deletable_until is not null and deletable_until > now();
-- DELETE 3
```

**Count: 3 deleted. `select count(*) from people where deletable_until is not
null` is now 0**, on the owner connection, and stayed 0 through every run
below. All three were `Marisol Enweazu` — `src/lib/tickets.test.ts`'s
`outsidePerson`, exactly as QA diagnosed, one per run across three runs.
`organizations` had no leaked stamped rows (measured: 0).

## 1. G1 — the canary that could not fail

QA is right, and the assertion I shipped is the precise failure class this
project's own F1 exists to name: it ran as `presby_app`, set no org context,
and counted rows in a `FORCE ROW LEVEL SECURITY` table, so it was pinned to 0
and reported `pass` in a green 456-assertion run with three leaked rows in the
table. I wrote a self-agreeing check while writing a section whose whole
subject is self-agreeing checks.

**`scripts/test-rls.sql`** — the three-line `assert_eq` is deleted and replaced
in place by a comment that reproduces the broken assertion verbatim, states why
it cannot fail, and points at its new home. It is a comment rather than a
silent deletion because the next person to write an N-6 assertion will reach
for exactly that shape.

The claim cannot be made from `presby_app` at all, with or without an org
context: a leak can sit in any org, or — for a person with no membership row —
in none, and `people`'s SELECT policy hides it either way. It is an owner-path
claim.

**New: `src/lib/db/fixture-deletable.test.ts`**, DB-backed, reading through
`getPlatformDb()`. Five specs:

| Spec | What it does |
|---|---|
| "the canary itself can fail: a stamped people row that has outlived its suite is detected" | Plants a row one minute past the staleness cutoff, asserts the detector finds it; then plants a **fresh** stamp and asserts the detector does **not** flag it (otherwise the canary would fail every run on its own in-flight fixtures). |
| "no leaked stamped people row is outstanding — regression for the tickets.test.ts fixture leak (G2)" | The real canary. Failure message names each row and prints the owner-connection `delete` that recovers it. |
| "no stamped people row has an EXPIRED window" | Exact, no heuristic. Strictly worse than a leak: past saving without dropping the trigger. |
| "the canary covers organizations too, and can fail there as well" | Same plant-and-detect, for `organizations.deletable_until` (D10 / `drizzle/0044`). |
| "no leaked stamped organization row is outstanding" | The `organizations` canary. |

**The staleness predicate, and its honest limitation.**
`src/lib/db/fixture-deletable.ts` gains `STALE_FIXTURE_STAMP_GRACE_MS`
(20 minutes) and `staleFixtureStampCutoff()`: a row is leaked when its
`deletable_until` is at or before `now() + 2h − 20min`, i.e. it was stamped
more than twenty minutes ago and has outlived whatever suite created it. The
longest measured full DB-backed serial run is about six minutes (QA measured
354 s for all files; my 26-file run was 242 s), so a live fixture cannot trip
it and there is no false-positive window. **The limitation, stated rather than
buried: a leak is invisible to a re-run started within twenty minutes of the
run that caused it.** That is the price of not threading a run id through
`fixtureDeletableUntil()`'s bare `Date` return and its 30-odd call sites, and
it is acceptable only because the failure being guarded takes *two hours* to
become irreversible — every later run in the session catches it. The constant
and its reasoning are in the helper, not in the test.

**Failing-first for G1** — a row shaped exactly like the three real leaks
(`now() + 95 minutes`) planted by hand outside the test's own tracking:

```
FAIL  src/lib/db/fixture-deletable.test.ts > … > no leaked stamped people row is outstanding
AssertionError:
1 leaked fixture person row(s) are outstanding. Once the window closes they are PERMANENT
on every connection (presby_app has no DELETE grant; the owner path hits
presby_guard_people_delete()). Remove them NOW, on the owner connection:
  delete from people where deletable_until is not null and deletable_until > now();
Then find the suite whose afterAll does not tear its fixture down.
  11110000-0000-0000-0000-0000000000aa Marisol EnweazuLeakProbe (window closes in 95m, …)
  ❯ src/lib/db/fixture-deletable.test.ts:199:9
```

Planted row removed; suite green again (5/5). This is the property the SQL
version never had: it is demonstrated to fail on the exact condition it claims
to detect, and the demonstration is a permanent spec rather than a one-off
manual check.

## 2. G2 — `src/lib/tickets.test.ts` leaked one person per run

Fixed, and fixed one level up from QA's minimum. QA asked for `outsidePerson`
to be added to the `afterAll` list. I converted the file to the tracked-array
pattern its siblings already use instead: `person()` pushes every id into
`trackedPeopleIds` at insert, and the teardown iterates that array rather than
a hand-written list of the four ids the file happens to hold in `let`s.

The reason is the failure mode itself. `outsidePerson` was missed because it is
a block-local `const` inside `beforeAll` and therefore invisible to a list
written in the describe scope — a hand-maintained list is exactly the thing
that went stale, and re-writing it with one more name leaves the next fixture
free to do the same. Tracking at insert closes the class. Both the array
declaration and the teardown carry a comment saying what went wrong and why the
shape changed.

**Failing-first for G2** — the old hand-written list restored, one run, then
the fix restored:

| Teardown | stamped rows before | after |
|---|---|---|
| old hand-written list of four ids | 0 | **1** (`985e01a1-…`, Marisol Enweazu) |
| `trackedPeopleIds` (shipped) | 0 | **0** |

The leaked probe row was removed while its window was open.

## 3. Re-run results

| Check | Result |
|---|---|
| `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql` | **exit 0, 455 `pass`, 0 `FAIL`** |
| `vitest run --no-file-parallelism src/lib/tickets.test.ts`, run 1 | 21/21 pass — stamped count **0 → 0** |
| `vitest run --no-file-parallelism src/lib/tickets.test.ts`, run 2 | 21/21 pass — stamped count **0 → 0** |
| `vitest run --no-file-parallelism src/lib/db/fixture-deletable.test.ts` | **5/5 pass** (the new canary) |
| Full DB-backed serial set, **26 files** (the 25 from the first pass plus the new canary) | **677/677 pass**; stamped count **0 before, 0 after** |
| `npm test` | 246 files passed, 30 skipped; **3,241 passed, 782 skipped, 0 failed** |
| `npm run typecheck` | clean |
| `npm run check` | all five tripwires pass |
| `npx eslint` on the three touched/new files | clean (exit 0) |

**The pass count is 455, not 456, and that is the point.** 412 baseline − 1
deleted (`:414-418`'s drift call) − 1 deleted (G1's vacuous count) + 45 new =
455. The suite got one assertion smaller and strictly more truthful: the
removed one could not fail, and its replacement is proven to.

**Stamped-row count across the whole DB-backed suite is 0 after a full serial
run** — so `tickets.test.ts` was the only leaker, now established by
measurement rather than by reading teardowns.

## 4. Files changed in this pass (4)

| File | Change |
|---|---|
| `scripts/test-rls.sql` | The vacuous `assert_eq` at §36.10 replaced in place by an explanatory comment. Still one appended block at EOF plus the pre-authorized `:415` edit — this is a third hunk, inside the appended block, so the integration merge is unaffected. |
| `src/lib/db/fixture-deletable.test.ts` | **New.** The canary, on `getPlatformDb()`, with its own can-it-fail proof. |
| `src/lib/db/fixture-deletable.ts` | Exports `FIXTURE_TEARDOWN_WINDOW_MS`; adds `STALE_FIXTURE_STAMP_GRACE_MS` and `staleFixtureStampCutoff()` with the reasoning and the stated blind spot. No behaviour change to `fixtureDeletableUntil()`. |
| `src/lib/tickets.test.ts` | `trackedPeopleIds` array; `person()` tracks at insert; teardown iterates it. |

Nothing else in the diff moved. `drizzle/0048_presby_security_b.sql`,
`drizzle/meta/_journal.json`, the seven `src/lib/db/domain/*.ts` files,
`scripts/seed.ts`, `src/lib/groups.ts`, `src/lib/db/index.ts` and
`src/app/api/cron/maintenance/route.ts` are byte-identical to what QA audited.

## 5. One addition to the integration TODO proposal

- **The `deletable_until` fixture-leak canary is only as good as its cadence.**
  `src/lib/db/fixture-deletable.test.ts` is a DB-backed spec, so it is skipped
  by a plain `npm test` and only runs in the `--no-file-parallelism` mode with
  `.env.local` present. Worth naming in the CI-wiring pipeline (already
  deferred) so it runs on a schedule rather than only when someone remembers —
  a leak has a two-hour fuse and CI is the natural thing to notice it. Until
  then, `docs/testing.md`'s "Running the DB-backed suites" is where a human
  finds it.

## 6. Handoff

**Back to `qa` for Phase 5 re-verification**, scoped to the two gaps. Nothing
outside the four files above changed, and QA's own note says the rest does not
need re-running.

```bash
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/test-rls.sql
# expect: exit 0, 455 pass (was 456; the vacuous N-6 count is gone), 0 FAIL

npx dotenv -e .env.local -- npx vitest run --no-file-parallelism \
  src/lib/db/fixture-deletable.test.ts src/lib/tickets.test.ts
# expect: 26 tests pass; and on the owner connection, before and after,
#   select count(*) from people where deletable_until is not null;  -- 0
```

To reproduce the G1 canary's failing-first without editing anything:

```sql
-- owner connection
insert into people (id, first_name, last_name, deletable_until)
values ('11110000-0000-0000-0000-0000000000aa','Canary','LeakProbe', now() + interval '95 minutes');
-- run the canary: it fails, naming that id
delete from people where id = '11110000-0000-0000-0000-0000000000aa';
```

No commits were made in this pass.
