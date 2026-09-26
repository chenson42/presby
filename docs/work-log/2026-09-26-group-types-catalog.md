# `group_types` is a global catalog, not a tenant table — reclassify it (root cause of B-M4, B-L1 and the `groups.group_type_id` FK exclusion) — Work Log

> **Slug:** `2026-09-26-group-types-catalog`
> **Surface:** database layer (`group_types`'s RLS shape, grants, the `tenant_tables` loop membership, the Drizzle table) and the readers in `src/lib/groups.ts`; no page or route change
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small–medium
> **Pipeline mode:** Bug-fix variant (Phase 2 runs — the table changes classification)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26, wave 4):** worktree `../presby-wt-gt` on git branch `pipeline/group-types`; Neon branch `pipeline-group-types` (`br-wispy-pond-axchf1oz`, forked from `development` at the v0.26.2 state — 0043–0050 applied). **Pre-assigned numbers:** migration `drizzle/0051_presby_group_types_catalog.sql`; `DECISION-151`; findings `F84` onward. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge). **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148). Dev-server port `3500`; stop by PID; never `pkill -f`.
> **The bug (`docs/work-log/2026-09-25-security-schema-b.md` Phase 2 §2(e)/(f) and Phase 6 follow-up 1):** `group_types` sits in `drizzle/0009`'s `tenant_tables` loop — FORCE RLS with a `tenant_isolation` policy and a nullable `organization_id` — while DECISION-110 ruling 1 makes it a **global catalog**: `groups.group_type_id` "ALWAYS RESOLVES TO THE PLATFORM-WIDE TEMPLATE ROW — no per-org custom group types", and 6 of 6 live rows have `organization_id IS NULL` (1,557 duplicates were a test fixture's doing, removed by 0048). That one misclassification produced B-M4 (templates invisible under the NULL-false policy, three `getPlatformDb()` escapes), B-L1 (no unique key), the four-policy split 0048 installed as a symptom fix, and the deliberate exclusion of `groups.group_type_id` from the composite-FK sweep.
> **The fix:** reclassify to the `permissions`/`app_roles`-template shape — rule at Phase 2/3 whether `organization_id` is dropped entirely (a pure catalog: no RLS, `presby_app` SELECT-only, writes only through `db:seed` on the platform connection) or kept nullable for a future per-org type with the template arm preserved; either way the `tenant_isolation`/four-policy shape goes, `groups.group_type_id` stays a plain FK by design (documented in the migration and in `check:schema-parity`'s allowlist if the TS model differs), `0048`'s `group_types_org_key` unique survives or becomes `unique (key)`, the Drizzle table in `src/lib/db/domain/groups.ts` matches, `docs/schema-design.md` §17 / `schema-design-2.md`'s table classification reads correctly, and `scripts/test-rls.sql`'s C-3 allow-list gains `group_types` with its reason. Migration fix-forward (0009/0048 are released), idempotent, from-empty clean.
> **Out of scope:** the other security §B follow-ups (owner-path trigger on `app_role_permissions`; the platform-shell DML accessor; the 13 hand-enumerated FORCE assertions; `presby_platform` login-or-drop).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — shape (a) pure catalog recommended; live finding: a tenant can insert an org-scoped `group_types` row today | READY FOR DESIGN | 2026-09-26 |
| 2 — Architectural review | architect | Complete — shape (a) ruled; pre-flight raise guard; three in-place `test-rls.sql` + six `seed-dev.sql` edits authorized as a delimited exception; F84–F86 proposed | Approved with suggestions | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — `drizzle/0051` statement list, TS model edit, all in-place fixture/suite sites enumerated, new §43, F84-F86/DECISION-151 adopted, one feasibility-check correction (`org-provisioning.test.ts:97`, a 25th sweep file Phase 1/2 missed) | Design complete, implementer named | 2026-09-26 |
| 4 — Implementation | database-admin | Complete — `drizzle/0051` hand-applied and proven whole-file idempotent; three failing-first proofs recorded; from-empty recipe green; 526 RLS assertions, 4149 unit tests, 5 e2e | Phase 4 complete | 2026-09-26 |
| 5 — Verification | qa | Complete — live-catalog audit; all three failing-first proofs reproduced on a scratch DB; from-empty rehearsal 526; shared-file hunks all authorized; two doc-only findings (fixed by the orchestrator before Phase 6); four pre-existing e2e failures diagnosed | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | In progress | — | 2026-09-26 |

---

# Phase 1 — Functional Refinement (analyst) — Bug-fix variant, brief

*Recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> `group_types` is wearing tenant-table clothes over a body that has never had a legitimate tenant row — six global rows, every application read already filters `organization_id IS NULL` by hand, and the live INSERT policy currently lets any tenant mint a real org-scoped row that no legitimate feature will ever look up; reclassify it to the pure-catalog shape (`permissions`'s shape, not `app_roles`'s), which is exactly what DECISION-110 ruling 1 and every doc comment in `src/lib/groups.ts` already say the table is.

## Bug-fix confirmation (in place of the five-pass review)

This is schema reclassification with no user-visible verb, flow, or permission surface — no page or route changes (per the work-log's own Surface line). The brief bug-fix variant applies. What I confirmed, live, on `pipeline-group-types`:

- **Row shape:** 6/6 rows, 100% `organization_id IS NULL`, 6 distinct keys (`court`, `roster`, `committee`, `small_group`, `choir`, `team`). Matches `scripts/seed.ts`'s `seedGroupTypes()` catalog exactly and matches `scripts/test-rls.sql:5740-5741`'s own assertion.
- **Live RLS shape:** `relrowsecurity = t`, `relforcerowsecurity = t`, four policies (`group_types_select/insert/update/delete`), matching `drizzle/0048` section 5 verbatim — the "app_roles_select model" `drizzle/0032:95-106` established for a table that, unlike `group_types`, has a genuine per-org custom-row feature.
- **Grants:** `presby_app` holds full `INSERT/SELECT/UPDATE/DELETE`, unchanged by 0048 ("grant unchanged" is accurate — verified via `aclexplode(relacl)`).
- **FKs:** one outbound (`group_types.organization_id -> organizations.id ON DELETE CASCADE` — vestigial regardless, since organizations are never hard-deleted per invariant), one inbound (`groups.group_type_id -> group_types.id`, plain, non-composite, deliberately excluded from the F2 composite sweep by `drizzle/0048` section 7's own comment). No other table anywhere in the schema references `group_types` or carries a `group_type_id`-shaped column.
- **No SQL function reads `group_types` at all** (`grep` across `drizzle/*.sql` outside 0008/0009/0048 returns nothing) — `presby_effective_permissions()` and the derived-group trigger machinery (`presby_sync_derived_group()`, `presby_reject_derived_group_write()`) only ever touch `groups`/`group_memberships`. The FK on `groups.group_type_id` is the only thing that needs to keep resolving; nothing else in the database has an opinion about `group_types`' shape.
- **Application readers (`src/lib/groups.ts`):** every read that touches `group_types` filters `isNull(groupTypes.organizationId)` explicitly in the query itself (lines 496, 581) — never relying on the RLS policy's NULL-admitting arm alone. The module's own doc comment (lines 33-38) states outright: "`groups.group_type_id` ALWAYS RESOLVES TO THE PLATFORM-WIDE TEMPLATE ROW... no per-org custom group types." The application has already fully committed to the global-catalog reading; only the schema hasn't caught up.
- **The only writer** is `scripts/seed.ts`'s `seedGroupTypes()`, already on `platformDb` (bypasses RLS) for the stated reason that the tenant connection can't see or insert a NULL-org row under the *old* single-policy shape. That rationale is now stale text describing a problem the table shouldn't have in the first place — see Gaps below.

**DECISION-110 ruling 1 is unambiguous about intended behavior and directly answers the Phase 2 question named in the kickoff:** the org-scoped `committee` duplicate found in `scripts/seed-dev.sql` was ruled **fixture drift, not a per-org-custom-types feature**, explicitly to avoid reopening "the exact tenant-extensibility door D8 exists to keep closed." `group_types` is called out as "a fixed 5-key taxonomy by design" (now six). There is no requirements signal, past or present, for a real per-org custom group type. This is the decisive fact for Phase 2/3: `app_roles`' four-policy split exists *because* `app_roles` has a genuine, shipped per-org-custom-row feature (role administration); `group_types` has never had one and is affirmatively ruled to never get one. The two tables only look alike because they share a symptom (a nullable `organization_id` template row), not a shape.

## Candidate shapes — which the codebase argues for

**(a) Drop `organization_id` entirely — pure catalog, `permissions`'s shape.** This is what DECISION-110 ruling 1, `src/lib/groups.ts`'s own doc comment, and 100% of live/seeded data all argue for. Costs:
- **C-3 allow-list** (`scripts/test-rls.sql` §39.5) and its paired list in `drizzle/0048` section 2 (B-H3 grant model — the file's own comment says "kept in sync," and it's already shipped, so the addition is fix-forward in the new `drizzle/0051`, not an in-place edit): `group_types` joins the 25-name exemption as a 26th "global catalog" entry, and `scripts/test-rls.sql`'s existing §39.7 block (the four-policy-split assertions) gets replaced, not extended, with a `permissions`-style "no RLS, SELECT-only" assertion — appended per the shared-file discipline, not edited in place.
- **`check:schema-parity`:** no new allowlist entry needed. The TS table (`src/lib/db/domain/groups.ts`) and the DDL move together in the same commit — `organizationId` and its FK to `organizations` disappear from both sides at once, so nothing drifts. `groups.group_type_id`'s FK stays a plain, non-composite reference on both sides, same as it is today.
- **`groups.group_type_id`'s FK:** the "DELIBERATELY EXCLUDED... cannot be composite" comment in `drizzle/0048` section 7 stops being an accepted exception to a rule and becomes simply inapplicable — there's no `organization_id` column left to be composite against, matching `app_role_permissions.permission_key -> permissions.key`'s existing plain-FK precedent exactly.
- **Test-fixture cost, real but mechanical:** roughly two dozen `src/lib/*.test.ts` files each carry their own local `findOrCreateGroupType`/insert-of-`groupTypes` helper passing `organizationId: null` explicitly (confirmed by grep: `groups.test.ts`, `officers.test.ts`, `directory.test.ts`, `sites.test.ts`, `role-definitions.test.ts`, and ~18 more). Every one needs that field removed once the column is gone. This is `tsc`-discoverable by construction (a stale `organizationId: null` against a dropped column is a compile error, not a silent skip), so it's a sizing/scope note for Phase 3, not a hidden risk.
- **`scripts/seed.ts`'s header comment** (lines 55-59, 826-830) currently explains the `platformDb` choice as "group_types is a FORCE-RLS tenant table... `db` would see ZERO rows... and fail the INSERT with a real RLS violation." That rationale becomes stale under shape (a) and should be corrected to match the `permissions`/`roles`/`features` seeding pattern's actual reason (presby_app is revoked from writing any global catalog, full stop) rather than describing a tenant-table shape the table no longer has.

**(b) Keep `organization_id` nullable, `app_roles`-style template arm.** This is the shape already shipped in `drizzle/0048` as the symptom fix, and it costs nothing further to *leave alone* — but it does not close the gap this bug-fix exists to close. See the adversarial finding below: it is the same shape live on this branch right now, and it is exploitable right now.

**Ruling for Phase 2's consideration: (a).** Nothing in the codebase's own decisions argues for keeping a live per-org write surface on a table that has been explicitly ruled to have no legitimate per-org row, now or in any anticipated future increment.

## Gaps the Request Didn't Address

- **`scripts/seed.ts`'s stale rationale comment** for why `seedGroupTypes()` runs on `platformDb` (lines 55-59) will need correcting to reflect the new shape, not just the mechanical column drop — noted above, worth naming explicitly in Phase 3's design so it isn't missed as "just delete the column."
- **`docs/schema-design.md` §17's "two bespoke policies" text is stale** (confirmed: no `group_types` classification appears anywhere in `docs/schema-design.md` at all — it predates the table's own review). `docs/TODO.md` line 112 item (5) already separately tracks this as "fix `docs/schema-design.md` §17's stale 'two bespoke policies' (three live; `person_links` deleted) by a human read" — that is a *different*, already-tracked drift (about `person_links`/global-person-table policies, not about `group_types`), so this pipeline should not conflate the two or attempt to fix item (5) as a side effect. Recommend Phase 3 add one short, correct paragraph classifying `group_types` in `docs/schema-design.md` (or `schema-design-2.md`, per its own newer-document convention) rather than leaving the table entirely undocumented there, distinct from closing the pre-existing person_links drift.
- **The Drizzle table's own comment is also stale and mildly misleading:** `src/lib/db/domain/groups.ts:32` reads `// null = platform-wide template seeded per organization type` — there is no `organization_type_scope` axis on `group_types` (unlike `app_roles`, which genuinely has one and genuinely uses it), and nothing seeds "per organization type." Under shape (a) this comment is deleted along with the column; worth Phase 3 confirming it doesn't get carried forward by accident.

## Out of Scope (confirm with user)

- The other twelve numbered Security §B follow-ups this table's misclassification was bundled with (`docs/TODO.md` line 112, items 2–13) — explicitly named out of scope in the kickoff block and unaffected by this pipeline.
- `docs/schema-design.md` §17's pre-existing `person_links`/global-person-table stale-text item (`docs/TODO.md` line 112 item 5) — a different, already-tracked drift; not to be silently folded into this pipeline's documentation fix.

## Adversarial Pass

- **Redirect targets / state-machine shortcuts / enumeration leaks / input boundaries / self-targeting:** not applicable — no route, form, or session-facing surface exists or is being added. This confirms the "no page or route change" line in the work-log's Surface block.
- **Does dropping RLS on a table referenced by `groups` create any cross-tenant read?** No. Confirmed by direct catalog read: `group_types` carries exactly `id`, `organization_id` (being dropped), `key`, `name` — no tenant-identifying or tenant-owned data of any kind. It is read-only reference data (six labels: Court, Roster, Committee, Small Group, Choir, Team), identical in kind to `permissions`, which already sits outside RLS entirely on `presby_app` SELECT-only. Removing RLS removes zero disclosure risk because there is nothing to disclose — this mirrors the exact reasoning `drizzle/0009_presby_rls.sql:90-93` already gives for `organizations` being outside the standard tenant policy.
- **A live, previously-unflagged write-surface finding, confirmed by a rolled-back probe on this branch:** under the *currently shipped* `drizzle/0048` four-policy split, `presby_app` can insert a real, non-NULL-`organization_id` `group_types` row for its own org today:
  ```sql
  insert into group_types (organization_id, key, name)
  values (current_setting('app.current_org_id')::uuid, 'shadow_committee', 'Shadow Committee')
  returning id;  -- succeeds under a live Alder-Creek-equivalent org context
  ```
  This is exactly the write DECISION-110 ruling 1 says should never be possible ("no per-org custom group types... a fixed... taxonomy by design"). It is not exploitable into a cross-tenant read (the row is invisible to every other org, and `createGroup()` in `src/lib/groups.ts:575-583` only ever resolves `group_type_id` against `organization_id IS NULL` rows filtered to the four manageable keys, so the smuggled row is inert) — but it is unaudited, uncapped, admin-invisible junk-data insertion with no product justification, and it silently consumes a slot in the `group_types_org_key` unique index. **This is the decisive argument against shape (b):** an `app_roles`-style template arm would keep the INSERT policy `with check (organization_id = presby_current_org())` — i.e., exactly the capability just demonstrated — because that capability is *correct* for `app_roles` (that's the actual custom-role feature) and *wrong* for `group_types` (which has no such feature, by ruling). Only shape (a)'s SELECT-only grant closes this. Flagging as a genuine finding of this Phase 1 pass, for Phase 3 to confirm the design closes it (revoke INSERT/UPDATE/DELETE from `presby_app` on `group_types` entirely).

## Open Questions

- None requiring the user before Phase 2 — DECISION-110 already answers the shape question. Phase 2/3 should simply confirm the number-flow for the fix-forward migration (0051, pre-assigned) and the exact `docs/TODO.md`/`docs/decisions.md` lines this pipeline proposes at integration, per the shared-file discipline in the kickoff block.

---

**Handoff:** Advancing to **architect** for Phase 2. The architect should rule definitively on shape (a) vs (b) (this review recommends (a) with the evidence above), confirm the `drizzle/0009` `tenant_tables` array edit and the parallel C-3/B-H3 list additions are the correct placement (not a new file pattern), and size the ~24-file test-fixture edit for Phase 3/4 planning. No new subdirectories, no new npm dependencies, no server/client split — this is DDL, one Drizzle table file, one `src/lib/groups.ts`/`scripts/seed.ts` comment correction, and a mechanical multi-file test-fixture edit.



---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## Verdict

**Approved with suggestions.** Shape (a) — the pure-catalog `permissions` shape — is ruled. The suggestions below are binding on Phase 3 in four places (§39.5/§39.7/`seed-dev.sql` cannot be append-only; the migration needs a pre-flight guard; the `permission denied` vs `row-level security` test-expectation flip; the constraint rename), and advisory elsewhere.

## Placement

- **Directory placement:** no new directory, no new module, no new dependency. Everything lands in paths the layout already names — `drizzle/0051_presby_group_types_catalog.sql` (hand-written DDL, per the `drizzle/00XX_presby_*.sql` line in Project Layout), `src/lib/db/domain/groups.ts` (the presby schema, one file per module), `src/lib/groups.ts` + `src/lib/org-provisioning.ts` + `scripts/seed.ts` (readers/writer), `scripts/seed-dev.sql`, `scripts/test-rls.sql`, and ~24 co-located `*.test.ts` fixtures.
- **`src/lib/db/domain/index.ts` needs no edit** — no table is added or removed, only a column. One shared-file collision the kickoff anticipated does not arise.
- **Server vs Client split:** not applicable. No component, page, route handler or server action changes; no `'use client'` anywhere in the diff. `src/lib/groups.ts` and `src/lib/org-provisioning.ts` are server-only modules already.
- **Dependencies:** none added, none needed. The five dependency criteria are not reached.

### Ruling 1 — shape (a), and the target is `permissions`'s **live** shape, not a described one

Phase 1's evidence is strong and I confirmed every load-bearing premise against the catalog on `pipeline-group-types` rather than off `drizzle/` (F38 discipline):

- `group_types`: `relrowsecurity = t`, `relforcerowsecurity = t`, the four 0048 policies exactly as written, `presby_app` holding `SELECT/INSERT/UPDATE/DELETE`, 6 rows / 0 org-scoped / 6 distinct keys, `group_types_org_key UNIQUE NULLS NOT DISTINCT (organization_id, key)`, one outbound FK to `organizations` (`ON DELETE CASCADE`), one inbound plain FK `groups_group_type_id_group_types_id_fk`, and **no trigger at all** (`pg_trigger`: only `groups_reject_derived_edit`, on `groups`).
- `permissions` (and `features`, `roles`, `sasr_form_versions`): `relrowsecurity = f`, `relforcerowsecurity = f`, `presby_app` → `SELECT` only, `presby_platform` → retains its 0009 blanket CRUD, `neondb_owner` → everything by ownership.

So the destination is not a design invention; it is a shape four tables already hold on this database. **Phase 3 states the target as that catalog tuple**, and Phase 5 asserts it that way: `relrowsecurity = f` **and** `relforcerowsecurity = f`, zero policies, `presby_app` = `SELECT` only, `presby_platform` unchanged.

Two things make (b) unacceptable rather than merely weaker, and both are structural rather than stylistic:

1. Phase 1's adversarial finding is real and I reproduced the mechanism from the policy text: `group_types_insert WITH CHECK (organization_id = presby_current_org())` grants every tenant an un-audited, un-capped write on a table DECISION-110 ruling 1 declares has no per-org row. Under (b) that capability is not a bug to be patched — it *is* the shape. Under (a) it is closed by the grant, which is the strongest available mechanism (a grant binds `presby_app` even with no policy engine in play).
2. (b) keeps a nullable tenant discriminator on a table where **Composite Tenant Keys** can never be honored. That is why `drizzle/0048` §7 had to write a paragraph excluding `groups.group_type_id` from the F2 sweep. An invariant that needs a standing named exception on one table is a misclassification, not an exception. Under (a) the exception becomes *inapplicable* — the same footing as `app_role_permissions.permission_key -> permissions.key` — and the F2 sweep has nothing to reopen.

### Ruling 2 — `drizzle/0051`: placement, content, and what it must **not** touch

**0009's `tenant_tables` array is not edited.** It is released, and `drizzle/0048:258` already states the rule in this repo's own words ("NEVER edit 0009's shared tenant_tables loop"). 0051 undoes the loop's effect for this one table in 0048's idempotent single-table-override style. A from-scratch replay is 0009 (enable + force + `tenant_isolation` + CRUD grant) → 0048 (four policies) → 0051 (drop, disable, revoke) → the same terminal state, which is exactly the property DECISION-150's from-empty rehearsal checks. 0051's header documents that the 0009 membership is now historical.

Required content, in order:

1. **A pre-flight guard, and it must `raise`, not skip.** Phase 1 demonstrated that any tenant can mint a non-NULL-`organization_id` row *today*; `development` or a contributor's branch may carry one, and 0043–0050 have been applied to shipped environments. Dropping the column would silently promote a smuggled org-scoped row to global — and if two orgs minted the same key, the new `unique (key)` add fails mid-migration with a confusing error instead of a diagnosable one. So: `do $$ begin if exists (select 1 from group_types where organization_id is not null) then raise exception '...'; end if; end $$;` with a message naming the remediation (inspect the rows, repoint any `groups.group_type_id` referencing them, delete). This is data integrity the migration correctly refuses to mask — the same posture 0048 §7 took on its five composite FKs.
2. Drop the four policies + `tenant_isolation`, all `if exists`.
3. `alter table group_types no force row level security;` **and** `alter table group_types disable row level security;` — both, so the catalog tuple matches `permissions` exactly. `no force` alone satisfies the C-3 catch-all but leaves a half-state nothing else in the schema has.
4. `alter table group_types drop constraint if exists group_types_org_key;` then `alter table group_types drop column if exists organization_id;` (the column drop takes the FK with it — no separate `drop constraint` for `group_types_organization_id_organizations_id_fk`, and 0051's comment should say so rather than leaving a reader wondering where it went).
5. `drop constraint if exists` + `add constraint group_types_key_key unique (key);` — plain `unique`, **no** `NULLS NOT DISTINCT`: `key` is `NOT NULL`, so the clause would be noise, and its presence would misleadingly imply a nullable column. The name `group_types_key_key` is both PostgreSQL's own default for this constraint and consistent with the `<table>_<cols>_key` house pattern; keeping the name `group_types_org_key` would make the constraint lie about its own columns.
6. `revoke insert, update, delete on group_types from presby_app;` and `grant select on group_types to presby_app;`. **Do not touch `presby_platform`** — it retains the 0009 blanket grant on every global catalog (verified live on `permissions`); narrowing it here would be an unrelated second decision smuggled into one diff, and `presby_platform` is separately tracked for login-or-drop (Security §B follow-up 7).
7. A header caveat mirroring 0048's: 0051 must be re-applied **after** 0048 in any drift-remediation replay. 0051 defines no functions, so it does not itself re-enter 0048's `proconfig`-stripping hazard.

Whole-file idempotent, no statement widening a privilege on re-run — same contract 0048 states.

### Ruling 3 — the TS model, and `check:schema-parity` gains no allowlist entry

Correct, and for the reason Phase 1 gave: both sides move in one commit. `src/lib/db/domain/groups.ts` drops `organizationId` (and with it the `organizations` import if nothing else in the file uses it — it does, `groups.organizationId`, so the import stays), drops the stale `// null = platform-wide template seeded per organization type` comment outright (Phase 1 is right that there is no such axis), and replaces the `unique("group_types_org_key").on(t.organizationId, t.key).nullsNotDistinct()` block with `unique("group_types_key_key").on(t.key)` carrying a short comment that points at DECISION-151 rather than re-narrating B-L1.

`scripts/check-schema-parity.ts`'s `ALLOWLIST` compares tables, columns, nullability and FK signatures; it does not compare unique constraints, RLS or grants. Nothing in this diff produces a difference for it to allow. **Phase 3 should state explicitly that adding an entry here would be wrong** — the file's own header says "pending" entries are a bug report, and an "architectural" entry for a difference that does not exist would be worse than no allowlist.

`npm run docs:erd` regenerates the mermaid block in `docs/schema-design.md` from the Drizzle model (`scripts/generate-erd.ts:11`), so the `organizations |o--o{ group_types : "organization_id"` edge at `docs/schema-design.md:192` disappears automatically. Run the script; do not hand-edit the diagram.

### Ruling 4 — the C-3 list, and where the append-only discipline has to bend (the one place I am overruling Phase 1)

Phase 1 wrote that §39.7 gets "replaced, not extended… appended per the shared-file discipline, not edited in place." Those two halves contradict each other, and the append-only reading is not survivable here. `scripts/test-rls.sql` is **executable**, run with `ON_ERROR_STOP=1`. Three existing sites reference state that ceases to exist:

- **`scripts/test-rls.sql:5583-5598` and `:5607-5613` — the C-3 catch-all.** The first assertion counts public tables lacking `FORCE` that are not on the 25-name list and asserts `0`. The moment `group_types` loses `FORCE`, that count is `1` and C-3 **fails**. The second assertion asserts all 25 listed names still lack `FORCE`. Both arrays must gain `'group_types'`, the expected constant at `:5618` goes `25 → 26`, and the two message strings at `:5600`/`:5618` go "25 named" → "26 named". There is no append that avoids this: the assertion is computed live, not textual.
- **`scripts/test-rls.sql:5718-5772` — §39.7.** `count(*) from group_types where organization_id is null` against a dropped column is not a failed assertion, it is a SQL error that aborts the entire suite. §39.7 must be **replaced in place** with a short stub recording what B-M4/B-L1 were and pointing forward to the new section.
- **`scripts/test-rls.sql:620-623`** — a `(select id from group_types where organization_id is null and key = 'committee')` subselect inside an unrelated shipped block. Same abort. Drop the `organization_id is null and` clause; the surrounding comment at `:618-621` explaining the `on conflict (organization_id, key)` yield and the NULL-admitting SELECT arm needs a one-line correction in the same edit.

**Ruling:** in-place edits are authorized at exactly those three sites and nowhere else in `test-rls.sql`. Every *new positive* assertion — no RLS (`relrowsecurity = f` and `relforcerowsecurity = f`), zero policies, `presby_app` SELECT-only with `INSERT/UPDATE/DELETE` all false, `unique (key)` present, one row per key, the `organization_id` column genuinely gone from `information_schema.columns`, and a `do $$` block proving a tenant INSERT now raises `insufficient_privilege` — goes in the new appended section at the end of the file. The orchestrator needs to know about the three in-place sites at integration, because §39.5's list is precisely the kind of shared text a parallel pipeline could also be touching; they are small and mechanically describable (two array literals, two constants, one section body, one subselect predicate), which is what makes the exception safe.

Two adjacent items, both optional and both cheap:
- §39.4(d)'s global-catalog SELECT-only assertion (`scripts/test-rls.sql:5544`, five tables) does **not** break, so it is not on the mandatory list. Adding `group_types` as a sixth there would be more truthful than asserting it only in the new section; Phase 3 may take it or leave it, but must not take it silently.
- §39.9's exclusion assertion at `:5876-5882` (`groups.group_type_id` stays a plain FK) still **passes and should stay** — it is the guard against a future F2 sweep "fixing" it. Its comment at `:5828-5832` (the MATCH SIMPLE argument) becomes stale; the assertion's reason is now simpler and stronger (*there is no org axis on the parent at all*). Update the comment, keep the assertion.

**`drizzle/0048` §2's paired 25-name list and §5/§7's commentary are shipped text and are not edited.** 0051's header carries the correction and says which comments it supersedes, including the "kept in sync" pact — which now means: *the two lists are 26, and the 0048 copy is historical.*

### Ruling 5 — `scripts/seed-dev.sql` also cannot be append-only, and Phase 1 missed this one

`scripts/seed-dev.sql:174` ends the `group_types` insert with `on conflict (organization_id, key) do nothing;`. An `ON CONFLICT` **inference clause** naming a dropped column is a parse-time error — and the file is one transaction, so the failure is not partial fixture loss but total fixture loss, the exact failure mode F83 already documented for this same statement. Required in-place edits:

- `:168` — drop `organization_id` from the column list and the three value tuples.
- `:174` — inference target becomes `(key)`.
- `:150-167` — the comment block explaining NULLS NOT DISTINCT and the fallback ids: corrected, not deleted (the fixed-id fallback rationale survives verbatim; only the constraint changes).
- Ten `(select id from group_types where organization_id is null and key = '…')` subselects at `:178, 180, 182, 185, 194, 196, 198, 200, 669, 798` — drop the `organization_id is null and` predicate. These would not error, but leaving them would leave the file asserting a column that no longer exists.
- `:657` and `:669`'s comment about the org-scoped `committee` duplicate (DECISION-110's fixture drift) can now say the door is shut at the database, not just by convention.

This is the same delimited-exception treatment as `test-rls.sql`: unavoidable, mechanical, and the orchestrator is told.

### Ruling 6 — the ~24 fixture files stay **mechanical**. No shared helper.

Three reasons, in order of weight:

1. The test-coverage review's item 11 teardown helper is a **different, separately tracked pipeline**. Introducing a shared `group_types` fixture helper here would land a new shared module in the exact files that pipeline will restructure, and pre-empt its design from inside an unrelated bug-fix. The kickoff already scoped it out; I am confirming that scoping.
2. The edit is a pure deletion of one property per site — `organizationId: null,` — verified `tsc`-discoverable by construction. I counted **30 occurrences across 24 test files** (`grep -rn "organizationId: null" src --include="*.test.ts"`), of which one — `src/app/(statistics-submit)/actions.test.ts:342` — is **unrelated** (it is an audit-metadata assertion, not a `group_types` insert) and must be left alone. That is the only trap in the sweep and Phase 3 should name it so a regex pass does not eat it.
3. A helper would have to touch all 24 files anyway to adopt it, producing a larger diff plus a new abstraction, for the same outcome.

I verified the sweep is otherwise safe: **every one of those inserts already runs on `platform`/`getPlatformDb()` (neondb_owner)**, not on `db`, so the `presby_app` revoke breaks nothing in the suite; and every one uses a bare `.onConflictDoNothing()` with no inference target, which stays valid under `unique (key)`.

**Three tests in `src/lib/groups.test.ts` are not mechanical and Phase 3 must design them individually:**

- `:1257` (B-L1 duplicate rejection) — still valid and still wanted under `unique (key)`; drop the field, and update the regex `/group_types_org_key|duplicate key/` to the new constraint name. Note it currently passes via the `duplicate key` alternative regardless, so a stale regex would **not** fail — this one needs a deliberate edit, not a test run, to catch.
- `:1272` (B-M4, templates readable through the RLS-enforced connection) — keep, unchanged in body. Its *reason* changes from "the SELECT policy admits NULL" to "there is no policy to admit anything"; update the comment so the test does not document a mechanism that no longer exists.
- `:1286` ("a tenant cannot mint a platform-wide group type") — **this is the load-bearing one.** It asserts `expect(chain).toMatch(/row-level security/)`. Under (a) the rejection is a grant denial, not a policy denial. The test must assert `/permission denied/` and its comment must say the guarantee got *stronger* (a revoke binds unconditionally; a policy binds only while the policy exists). Phase 3 should also widen it: today it only tries `organizationId: null`; under (a) the honest regression is "a tenant cannot write `group_types` **at all**" — INSERT, UPDATE and DELETE each rejected. That is the test that closes Phase 1's adversarial finding, and it is the single most important artifact of this pipeline.

### Ruling 7 — the three application/seed readers

- `src/lib/groups.ts:496` and `:581` — drop the `isNull(groupTypes.organizationId)` filter. Both stay on `tx` (RLS-enforced connection); the `SELECT` grant survives the revoke, so the B-M4 un-escape holds. `:581`'s companion filter on `MANAGEABLE_GROUP_TYPE_KEYS` is the one that actually matters and stays. The module doc comment at `:33-38` is now *literally* true rather than aspirational — say so in one clause.
- **`src/lib/org-provisioning.ts:292-294` — a third reader Phase 1 did not name.** `platformDb.select(...).from(groupTypes).where(isNull(groupTypes.organizationId))`, resolving the `court`/`roster` templates at org creation. The filter goes. Keep it on `platformDb` — it sits inside a platform-connection provisioning transaction and moving it would be an unrelated change — but verify the `provisioning_incomplete` fall-through at `:296-298` still behaves (it will: the query returns the same six rows, just without a redundant predicate).
- `scripts/seed.ts` — `seedGroupTypes()` **stays on `platformDb`**, and the reason changes from "FORCE-RLS tenant table, `db` sees zero rows and the INSERT violates RLS" to "`presby_app` is SELECT-only on every global catalog, same as `roles`/`features`/`role_features`." Correct the header comment at `:55-59` (reason 1 collapses into reason 2 — the two-reason structure becomes a one-reason structure) and the inline comment at `:826-830`, and drop `organizationId: null` from the insert at `:838` and the `isNull()` from the find at `:834`. Phase 1 flagged this; I am confirming it is a comment *rewrite*, not a comment deletion — that header is the file's explanation of why a whole class of writes lives on the owner connection.

## Invariants Touched

- **Extensibility Goes Through Support (D8).** This is the invariant the change *serves*, and it is the strongest argument for (a). D8 says tags are the only tenant-extensible attribute and a new need is a support ticket. Today the database contradicts that for `group_types`: a tenant can mint its own type. After 0051 the schema states D8 for this table rather than merely permitting it — the `/developer` classification for this corner moves from `paper` toward `database`. **No CLAUDE.md change is required**; the invariant's text already says exactly this and the schema is catching up to it.
- **Composite Tenant Keys (F2).** Becomes **not applicable** to `group_types`, rather than remaining a documented exception. `groups.group_type_id` stays a plain, single-column FK — now for the same trivial reason `app_role_permissions.permission_key -> permissions.key` is plain, not because of a MATCH SIMPLE argument about NULL parents. The §39.9 assertion that guards the exclusion is kept.
- **Isolation Is a Database Property.** Nothing to disclose, confirmed by catalog read, not by inference: the table's entire surface after the drop is `id`, `key`, `name` — six labels (Court, Roster, Committee, Small Group, Choir, Team). No tenant-identifying column, no tenant-owned data, no trigger, no function reading it, no other table referencing it. Removing RLS removes zero disclosure risk. The **write** surface narrows (a revoke is stricter than a policy), so the net movement is toward isolation, not away. `presby_app` stays `NOBYPASSRLS`; nothing about the connection model changes.
- **Permissions vs Flags.** Untouched — no permission key, no flag, no `hasFeature()` call site in the diff.
- **The Court Is Not a Group.** Untouched, and worth stating because `court` is a `group_types` key: the derived-roster machinery (`presby_sync_derived_group()`, `presby_reject_derived_group_write()`, the `groups_reject_derived_edit` trigger) reads `groups`/`group_memberships`/`officer_terms` and never `group_types`. I confirmed this against `pg_trigger` and `pg_proc`, not just grep. The one thing that must keep resolving is the `groups.group_type_id` FK, and it does.
- **The Edge Gate Cannot Reach the Database.** Not touched — `src/proxy.ts` is not in the diff.

## Notes

**Phase 3 must honor, in this order:**

1. The pre-flight `raise` guard in 0051 (Ruling 2, item 1). Without it, a shipped environment carrying a smuggled row loses it silently or fails the migration opaquely.
2. The three in-place `test-rls.sql` sites and the six in-place `seed-dev.sql` sites (Rulings 4 and 5). These are the only authorized deviations from the kickoff's append-only discipline, and the Phase 3 design must list them explicitly so the orchestrator sees them at integration.
3. `src/lib/groups.test.ts:1286`'s expectation flip from `/row-level security/` to `/permission denied/`, widened to all three DML verbs (Ruling 6). This is the regression test for Phase 1's adversarial finding.
4. `src/app/(statistics-submit)/actions.test.ts:342` is **not** part of the sweep.

**Sequencing note for Phase 4/5.** The revoke and the seed/test edits are one atomic unit, exactly as 0048 §2 says of its own catalog revokes: applying 0051 without the `seed-dev.sql` fix breaks `npm run db:seed`'s downstream fixture load with total fixture loss. Rehearse in this order on `pipeline-group-types`: apply 0051 → `npm run check:schema-parity` → `npm run db:seed` → `psql -f scripts/seed-dev.sql` → `psql -f scripts/test-rls.sql` **as `presby_app`** → `npm run typecheck` → the DB-backed vitest subset with `--no-file-parallelism`. Then the DECISION-150 from-empty recipe end to end, since this pipeline changes replay semantics for a table three migrations touch.

**Not auth-touching.** `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/` are untouched, so the mandatory e2e/MFA gate does not apply and QA's `PASS` does not require it.

**Docs (item 6) — returned, not written.** `docs/schema-design.md` is *not* on the kickoff's do-not-edit list (only `schema-design-2.md` is), so the implementer may edit it on-branch: run `npm run docs:erd` to drop the `organizations |o--o{ group_types` edge at `:192`, correct the DDL snippet at `:943` (remove the `organization_id` line and its `-- null = platform template` comment, add `unique (key)`), and insert this paragraph immediately after that snippet in §9:

> **`group_types` is a global catalog, not a tenant table.** It carries no `organization_id`, no RLS, and `presby_app` holds `SELECT` only — the same shape as `permissions`, `features`, `roles` and `sasr_form_versions`. DECISION-110 ruling 1 settled that `groups.group_type_id` always resolves to a platform-wide row and that per-org custom group types are the tenant-extensibility door D8 exists to keep closed; DECISION-151 made that a property of the database rather than a convention the application upheld by filtering `organization_id IS NULL` at every call site. The table spent 0009–0050 misclassified into 0009's `tenant_tables` loop, which is the common root of B-M4 (the whole catalog invisible to the tenant connection under a NULL-false policy, forcing three `getPlatformDb()` escapes), B-L1 (1,557 accumulated duplicates behind a unique index that constrained nothing), and 0048 §7's standing exclusion of `groups.group_type_id` from the composite-FK sweep. That FK stays plain and single-column — not as an accepted F2 exception, but because there is no longer an org axis on the parent for a composite key to reference, exactly like `app_role_permissions.permission_key -> permissions.key`. Writes are seed-only, on the owner connection (`scripts/seed.ts`'s `seedGroupTypes()`).

`docs/schema-design-2.md` is forbidden on-branch; the orchestrator applies the findings at integration. I propose three, numbered from the pre-assigned F84:

- **F84 — a tenant could mint a `group_types` row, and the four-policy split is what let it.** Reproduced live on `pipeline-group-types` (rolled back): under `drizzle/0048` §5, `group_types_insert WITH CHECK (organization_id = presby_current_org())` accepts an org-scoped row from `presby_app`. Inert by luck rather than by design — `createGroup()` only resolves against `organization_id IS NULL` rows in four manageable keys — but un-audited, uncapped, admin-invisible junk-data insertion on a table ruled to have no per-org row. The general lesson: **when a symptom fix copies a shape from a sibling table, it copies that sibling's capabilities too.** `app_roles`' template-arm split is right for `app_roles` because custom roles are a shipped feature; the same four policies on `group_types` grant a capability no feature wants. Closed by `drizzle/0051` with a revoke, which binds unconditionally where a policy binds only while it exists.
- **F85 — a dropped column has readers that no compiler sees.** `scripts/seed-dev.sql:174`'s `on conflict (organization_id, key)` inference clause and `scripts/test-rls.sql:5583-5613`'s C-3 catch-all arrays both reference `group_types.organization_id` from SQL text. The first is a parse error inside a single-transaction fixture file — total fixture loss, the same failure mode F83 recorded for this same statement; the second is a live-computed assertion that flips from pass to fail the instant `FORCE` is dropped. Neither is visible to `tsc`, and the TypeScript fixture sweep (30 sites, 24 files) that *is* `tsc`-visible is the harmless half. **A column drop's real blast radius is the SQL that names it as a string.**
- **F86 — an append-only shared-file discipline does not compose with an executable shared file.** Workflow Rule 16's convention (append a delimited block at the end) works for `test-rls.sql` when a pipeline *adds* assertions. It cannot work when a pipeline *invalidates* existing ones: an appended correction does not stop `ON_ERROR_STOP=1` from aborting at the stale site. The workable rule, and the one this pipeline used: **in-place edits are confined to the sites that would break, each enumerated by line in the Phase 2/3 sections so integration can see them; everything new still appends.**

**Proposed `DECISION-151` (architectural — table classification and grant model; orchestrator to record):**

> **DECISION-151: `group_types` is reclassified from tenant table to global catalog — `organization_id` and its FK dropped, RLS removed entirely, `presby_app` narrowed to `SELECT`, `unique (key)` replacing `unique nulls not distinct (organization_id, key)`; `groups.group_type_id` stays a plain FK because there is no longer an org axis to be composite against. (2026-09-26, architect, Phase 2 of `docs/work-log/2026-09-26-group-types-catalog.md`.)**
>
> Shape (a) over shape (b), ruled against the live catalog on `pipeline-group-types` rather than off `drizzle/`'s text. `group_types` has sat in `drizzle/0009`'s `tenant_tables` loop since the first schema commit — `FORCE ROW LEVEL SECURITY`, a nullable `organization_id`, full CRUD to `presby_app` — while DECISION-110 ruling 1 declared it a platform-wide taxonomy and D8 declared per-org extensibility closed. Six of six live rows are global; every application read already filtered `organization_id IS NULL` by hand at three call sites (`src/lib/groups.ts:496`, `:581`, `src/lib/org-provisioning.ts:294`); the only writer is `seedGroupTypes()` on the owner connection. That single misclassification is the demonstrated common cause of B-M4, B-L1, `drizzle/0048` §5's four-policy split, and §7's standing exclusion of `groups.group_type_id` from the F2 composite sweep — four symptoms, one root. **The decisive argument against keeping 0048's template-arm shape is that it is not neutral:** its `INSERT ... WITH CHECK (organization_id = presby_current_org())` arm lets any tenant mint a real org-scoped group type today (reproduced and rolled back, F84) — the exact write DECISION-110 forbids. That capability is *correct* for `app_roles`, which has a shipped custom-role feature, and *wrong* for `group_types`, which has been affirmatively ruled never to get one; the two tables share a symptom, not a shape. **The target is not a described shape but a tuple four tables already hold on this database** (`permissions`, `features`, `roles`, `sasr_form_versions`): `relrowsecurity = f`, `relforcerowsecurity = f`, zero policies, `presby_app` `SELECT`-only, `presby_platform` unchanged, owner by ownership. `drizzle/0051` fixes forward in 0048's idempotent single-table-override style and **does not edit 0009's shared `tenant_tables` array** — a from-scratch replay passes through the tenant shape and out the other side to the same terminal state, which the DECISION-150 from-empty rehearsal verifies. It opens with a guard that **raises** if any non-NULL `organization_id` row exists, rather than silently promoting a smuggled row to global. The `groups.group_type_id` plain FK is retained and its guarding assertion in `scripts/test-rls.sql` §39.9 is kept, but its justification is replaced: not "a composite FK would reject every row under MATCH SIMPLE," simply "the parent has no org axis" — the same footing as `app_role_permissions.permission_key -> permissions.key`. Two consequences are recorded as first-class costs rather than incidentals: the C-3 inverted-FORCE allow-list in `scripts/test-rls.sql` §39.5 and its paired list in `drizzle/0048` §2 go from 25 names to 26 (the suite's copy edited in place because it is an executable assertion, 0048's left as shipped text and superseded by 0051's header), and `scripts/seed-dev.sql`'s `ON CONFLICT (organization_id, key)` inference clause must be corrected in the same commit or the whole single-transaction fixture file fails to parse (F85). The revoke and the seed edits are one atomic unit, the same pairing DECISION-146's catalog revokes required.

**Handoff:** advancing to **tech-lead** for Phase 3. The design doc needs: `drizzle/0051`'s statement list with the pre-flight guard and the replay-order header; the exact in-place edit sites in `scripts/test-rls.sql` (`:620-623`, `:5583-5598`, `:5600`, `:5607-5613`, `:5618`, `:5718-5772`) and `scripts/seed-dev.sql` (`:150-174`, and the ten subselects at `:178-200`, `:669`, `:798`); the new appended `test-rls.sql` section's assertion list; the three non-mechanical `src/lib/groups.test.ts` edits at `:1257`, `:1272`, `:1286`; the 30-site / 24-file mechanical sweep with `src/app/(statistics-submit)/actions.test.ts:342` explicitly excluded; the `scripts/seed.ts` header-comment rewrite; and the rehearsal order above. Named implementer: **database-admin** — the diff is DDL, one Drizzle table, SQL fixtures, and mechanical test-fixture edits, with no route, component or API surface.



### Orchestrator note (2026-09-26)

The in-place edits to `scripts/test-rls.sql` (three sites) and `scripts/seed-dev.sql` (six sites) are authorized as the F86 exception — enumerated by line in Phase 3 so integration expects them.

---

# Phase 3 — Technical Design (tech-lead)

*Recorded 2026-09-26.*

## Summary

`group_types` has sat in `drizzle/0009`'s `tenant_tables` loop since the first schema commit even though DECISION-110 ruling 1 declared it a fixed, platform-wide taxonomy with no per-org row — that single misclassification is the root cause of B-M4 (the catalog invisible to `presby_app`, forcing three `getPlatformDb()` escapes), B-L1 (1,557 duplicate rows behind a unique index that constrained nothing), `drizzle/0048`'s four-policy symptom fix, and its own standing exclusion of `groups.group_type_id` from the F2 composite-FK sweep. Phase 1 additionally reproduced a live, unflagged write hole: under the currently shipped four-policy split, any tenant can INSERT a real org-scoped `group_types` row today (F84) — exactly the write DECISION-110 forbids. **Fix shape:** reclassify `group_types` to the `permissions`/`features`/`roles`/`sasr_form_versions` global-catalog tuple — drop `organization_id` and its FK entirely, remove RLS (`no force` + `disable`), replace the nullable composite unique with `unique (key)`, and narrow `presby_app` to `SELECT`-only. `drizzle/0051` fixes forward in 0048's idempotent single-table-override style; 0009's shared `tenant_tables` array is never touched. This is Phase 2 Ruling 1's shape (a), adopted here without change — the target is a tuple four tables already hold on this database, not a design invention.

## Feasibility check (against the live tree, `pipeline-group-types`)

Before naming the implementer, I re-verified every load-bearing premise directly against this branch rather than trusting Phase 1/2's transcribed numbers, per the tech-lead's standing duty. Two corrections, both cheap here and expensive as a Phase 4 loop-back:

1. **DDL is valid, no parameter-order issue.** `drizzle/0051` is pure DDL/DML — no new function signature — so the "defaults trail every required parameter" check does not apply.
2. **The `ALTER`/`DROP` blast radius is fully enumerated.** `grep -n "group_types" drizzle/*.sql` outside 0008/0009/0048 returns nothing; `pg_proc` has no function body referencing `group_types` at all (confirmed live: `presby_effective_permissions()`, `presby_sync_derived_group()`, `presby_reject_derived_group_write()` only touch `groups`/`group_memberships`/`officer_terms`). No `SECURITY DEFINER` body holds an invisible dependency on the dropped column — the Postgres blind spot CLAUDE.md names does not apply here because there is no reader to hide.
3. **No new CHECK or trigger** is introduced by this migration, so there is nothing to read against `scripts/seed-dev.sql` or a fixture file for that reason. (`scripts/seed-dev.sql` still needs edits, but for a different reason — see below — not a CHECK-vs-fixture conflict.)
4. **No new FK** is introduced. The one FK this migration touches (`group_types.organization_id -> organizations.id`) is being *removed*, and `groups.group_type_id -> group_types.id` correctly stays a plain, single-column FK because — after this migration — there is no org axis on the parent at all to be composite against. This is not a Key Invariant violation of Composite Tenant Keys; it is the invariant becoming inapplicable, which is Phase 2 Ruling 1's point 2 and I confirm it holds.
5. **Correction to Phase 1/2's test-fixture count.** Both phases stated "30 occurrences across 24 test files." Re-running the exact grep on this branch:
   ```
   grep -rn "organizationId: null" src --include="*.test.ts" | wc -l   →  31 (not 30), same 24 files
   grep -rn "isNull(groupTypes.organizationId)" src --include="*.test.ts"  →  2 sites:
     src/lib/groups.test.ts:174           (inside the same findOrCreateGroupType() helper as :180 — same file, already in scope)
     src/lib/org-provisioning.test.ts:97  (a 25th file, named by neither Phase 1 nor Phase 2)
   ```
   `org-provisioning.test.ts:97` mirrors `org-provisioning.ts:292-294`'s own reader exactly (it is that test file's precondition check for `createOrganization()`'s court/roster templates) and has no `organizationId: null` literal to catch it in Phase 1's grep — it is a `.where(isNull(groupTypes.organizationId))` filter, which becomes a compile error the instant the column is dropped (`groupTypes.organizationId` stops existing as a property), same as its production counterpart. This is exactly the class of gap Phase 2's F85 warns about ("a dropped column has readers no compiler sees") — except this one *is* `tsc`-visible, which is precisely why catching it now (one grep) is cheaper than a loop-back from a red typecheck in Phase 4. **Corrected total, composition detailed below, same order of magnitude — 30 mechanical sites across 24 files, with `org-provisioning.test.ts` now one of the 24 and `src/app/(statistics-submit)/actions.test.ts` excluded as before.**

No other feasibility defect found. Design proceeds; **implementer: database-admin** (named at the end, per template).

## Permissions & Flags

Not needed. No permission key, no `hasFeature()` call site, no flag — confirmed unchanged from Phase 1/2. `FEATURES` catalog untouched.

## API Contract

No routes, no server actions. This is DDL + one Drizzle table definition + SQL fixture/test edits. No request/response shape changes anywhere in the diff.

## Data Model

### `drizzle/0051_presby_group_types_catalog.sql` — statement list, in order

```sql
-- drizzle/0051_presby_group_types_catalog.sql
--
-- DECISION-151 / F84-F86 (docs/work-log/2026-09-26-group-types-catalog.md).
-- Reclassifies group_types from a drizzle/0009 tenant_tables member to a
-- global catalog — the permissions/features/roles/sasr_form_versions shape.
-- Fixes forward in drizzle/0048's idempotent single-table-override style.
-- 0009's shared tenant_tables array is NOT edited (drizzle/0048:258's own
-- rule) — a from-scratch replay is 0009 (enable+force+tenant_isolation) ->
-- 0048 (four-policy split) -> 0051 (drop, disable, revoke), landing on the
-- same terminal state DECISION-150's from-empty rehearsal checks.
--
-- *** MUST BE REPLAYED AFTER 0048 in any drift-remediation re-run, same
-- *** ordering rule 0048 itself states at its own header. 0051 defines no
-- *** function, so it does not reopen 0048's proconfig-stripping hazard.
-- ***
-- *** SUPERSEDES: 0048 section 2's paired 25-name C-3 allow-list text (now
-- *** 26 — group_types joins it; the "kept in sync" pact from section 2's
-- *** own comment now means scripts/test-rls.sql's copy is 26, 0048's is
-- *** historical); section 5's four-policy split (dropped below); section
-- *** 7's "DELIBERATELY EXCLUDED... cannot be composite" comment on
-- *** groups.group_type_id (now simply inapplicable — no org axis on the
-- *** parent to be composite against, same footing as
-- *** app_role_permissions.permission_key -> permissions.key).
--
-- Whole-file idempotent; no statement widens a privilege on re-run.

-- 1. Pre-flight guard. Phase 1 demonstrated a tenant can mint a non-NULL
--    organization_id row TODAY under the shipped 0048 policies; a shipped
--    environment or a contributor's branch may carry one. Dropping the
--    column would silently promote a smuggled row to global, and if two
--    orgs independently minted the same key, the unique (key) add below
--    would fail mid-migration with a confusing constraint-violation error
--    instead of a diagnosable one. Refuse instead of masking.
do $$
declare
  smuggled_count int;
begin
  select count(*) into smuggled_count from group_types where organization_id is not null;
  if smuggled_count > 0 then
    raise exception 'drizzle/0051: % org-scoped group_types row(s) found (organization_id is not null). '
      'DECISION-110 ruling 1 permits no per-org group type. Before re-running this migration: '
      'inspect these rows, repoint any groups.group_type_id referencing them to the matching '
      'platform-wide (organization_id is null) row by key, then delete the org-scoped row(s).',
      smuggled_count;
  end if;
end $$;

-- 2. Drop the four 0048 policies and the original tenant_isolation policy,
--    all if exists (0009 created tenant_isolation; 0048 replaced it).
drop policy if exists tenant_isolation on group_types;
drop policy if exists group_types_select on group_types;
drop policy if exists group_types_insert on group_types;
drop policy if exists group_types_update on group_types;
drop policy if exists group_types_delete on group_types;

-- 3. Remove RLS entirely — both statements, so the catalog tuple matches
--    permissions/features/roles/sasr_form_versions exactly. `no force`
--    alone would satisfy the C-3 catch-all but leave a half-state nothing
--    else in the schema has.
alter table group_types no force row level security;
alter table group_types disable row level security;

-- 4. Drop the old composite unique, then the column. The column drop takes
--    its own FK (group_types_organization_id_organizations_id_fk) with it —
--    no separate `drop constraint` for that FK is needed or issued.
alter table group_types drop constraint if exists group_types_org_key;
alter table group_types drop column if exists organization_id;

-- 5. The new key-only uniqueness. Plain `unique`, no NULLS NOT DISTINCT:
--    `key` is NOT NULL, so the clause would be noise and would misleadingly
--    imply a nullable column. `group_types_key_key` is both Postgres's own
--    default name for this constraint and the house `<table>_<cols>_key`
--    pattern (cf. app_role_permissions_pk, blob_assets_org_hash_key) —
--    keeping the old name would make the constraint lie about its columns.
alter table group_types drop constraint if exists group_types_key_key;
alter table group_types add constraint group_types_key_key unique (key);

-- 6. Narrow presby_app to SELECT-only, matching every other global catalog.
--    presby_platform is untouched — it retains 0009's blanket CRUD grant on
--    every table (verified live on `permissions`); narrowing it here would
--    smuggle an unrelated second decision into this diff (that role's
--    login-or-drop question is Security §B follow-up 7, tracked separately).
revoke insert, update, delete on group_types from presby_app;
grant select on group_types to presby_app;
```

### `src/lib/db/domain/groups.ts` — TS model edit

- Delete the stale doc comment `// null = platform-wide template seeded per organization type` (line 32) — there is no `organization_type_scope` axis on `group_types`, unlike `app_roles`.
- Delete the `organizationId` column definition and its `.references(() => organizations.id, { onDelete: "cascade" })`.
- Replace:
  ```ts
  unique("group_types_org_key")
    .on(t.organizationId, t.key)
    .nullsNotDistinct(),
  ```
  with:
  ```ts
  // DECISION-151: group_types is a global catalog (no organization_id) —
  // the constraint enforces one row per key, full stop. See
  // docs/schema-design.md §9 for the classification writeup.
  unique("group_types_key_key").on(t.key),
  ```
- The `organizations` import stays (`groups.organizationId` in the same file still uses it).
- `check:schema-parity` gains **no** allowlist entry — both sides move in one commit and the script does not compare unique constraints, RLS or grants. Do not add one; the file's own header says a "pending" entry is a bug report, and an entry for a difference that no longer exists would be worse than none.

## Component / Page Plan

No pages, no components, no route handlers. Files touched, exhaustively:

**Migration / schema**
- `drizzle/0051_presby_group_types_catalog.sql` — new (statement list above)
- `drizzle/meta/_journal.json` — append idx 51 (`tag: "0051_presby_group_types_catalog"`, `version: "7"`, `breakpoints: true`, sequential `when`)
- `src/lib/db/domain/groups.ts` — TS model edit above

**Application readers (Ruling 7, unchanged from Phase 2, re-verified live)**
- `src/lib/groups.ts:496` — drop `isNull(groupTypes.organizationId)` from the `and(...)` in the `getGroupFormOptions()`-path query; keep the `inArray(groupTypes.key, MANAGEABLE_GROUP_TYPE_KEYS)` filter, which is the one that still matters. Stays on `tx`.
- `src/lib/groups.ts:581` — drop the same filter from the `and(eq(groupTypes.id, input.groupTypeId), isNull(groupTypes.organizationId))` in `createGroup()`'s validation read; keep `eq(groupTypes.id, ...)`. Stays on `tx`.
- `src/lib/groups.ts:33-38` doc comment — the "ALWAYS RESOLVES TO THE PLATFORM-WIDE TEMPLATE ROW... no per-org custom group types" text is now literally true, not aspirational; add one clause saying so.
- `src/lib/org-provisioning.ts:292-294` — drop `.where(isNull(groupTypes.organizationId))` from the `templateRows` select. Stays on `platformDb` (this sits inside a platform-connection provisioning transaction; moving it is an unrelated change and out of scope). Re-verify the `provisioning_incomplete` fall-through at `:296-298` still fires correctly — it will, since the query returns the same six rows minus a now-redundant predicate.

**Seed writer**
- `scripts/seed.ts`:
  - Header comment `:55-59` (reason 1, inside the "EVERY GLOBAL-CATALOG WRITE..." block starting `:52`) — rewrite reason 1 to collapse into reason 2's shape: `group_types` runs on the owner connection for the *same* reason `roles`/`features`/`role_features`/`feature_flags`/`migration_seeds` do (`drizzle/0048`'s revoke, now joined by `drizzle/0051`'s) — not because it is a FORCE-RLS tenant table whose INSERT arm rejects a NULL org id. The two-reason structure becomes one reason with `group_types` added to the enumerated list.
  - `seedGroupTypes()`'s own doc comment (the `/** ... */` block ending at the line immediately above `async function seedGroupTypes()`, i.e. the "Both the read and the write use platformDb" inline comment at `:826-830`) — same rewrite: not "a FORCE-RLS tenant table... would fail the INSERT with a real RLS violation," but "`presby_app` is SELECT-only on `group_types` (`drizzle/0051`), same as every other global catalog."
  - `:834` — drop `isNull(groupTypes.organizationId)` from the `existing` lookup's `and(...)`, leaving `eq(groupTypes.key, g.key)`.
  - `:838` — drop `organizationId: null,` from the insert `.values({...})`.

**SQL fixture / suite — in-place edits (F86 exception, five sites, all named here for integration)**
- `scripts/test-rls.sql:620-623` — drop the `organization_id is null and` predicate from the `(select id from group_types where organization_id is null and key = 'committee')` subselect inside the shipped Alder-Creek block; correct the one-line comment immediately above it (`:614-619` area) that explains the NULL-admitting SELECT arm — it now simply reads the platform-wide row by key.
- `scripts/test-rls.sql:5583-5598` and `:5607-5613`, constants at `:5600`/`:5618` — the C-3 catch-all. Both `array[...]` literals gain `'group_types'`; both `25`s become `26`; both message strings ("25 named...") become "26 named...".
- `scripts/test-rls.sql:5718-5772` — §39.7 replaced with a short stub: what B-M4/B-L1 were, and a forward pointer to the new §43 (below). The live `count(*) from group_types where organization_id is null` assertions and the `do $$ ... insufficient_privilege` block in the current §39.7 are **not** kept verbatim here — they are superseded by §43's broader (SELECT/INSERT/UPDATE/DELETE) assertions, so nothing is lost, only relocated and widened.
- `scripts/test-rls.sql:5544` (§39.4(d), optional in Phase 2, **taken** here — cheap and more truthful than leaving `group_types` asserted only in §43): both `array[...]` literals gain `'group_types'`, both `5`s become `6`, and the comment "scripts/seed.ts's five catalog writers" becomes "six."
- `scripts/test-rls.sql:5828-5832` (§39.9 comment, optional in Phase 2, **taken** here): replace the "MATCH SIMPLE... would reject every row" argument with "the parent has no org axis at all" — same footing as `app_role_permissions.permission_key -> permissions.key`. The assertion itself at `:5876-5882` is **unchanged** and stays (it guards against a future F2 sweep "fixing" the exclusion).

**SQL fixture — in-place edits, `scripts/seed-dev.sql` (F86 exception, six sites)**
- `:150-167` — comment block: correct "NULLS NOT DISTINCT is why two `organization_id is null` rows sharing a key collide" to "the `unique (key)` constraint is why two rows sharing a key collide" — the fixed-id fallback rationale (ids win only when `seed-dev.sql` runs before `db:seed`, resolution by key either way) survives verbatim.
- `:168` — drop `organization_id` from the column list `(id, organization_id, key, name)` and drop the `null,` from each of the three value tuples.
- `:174` — `on conflict (organization_id, key) do nothing;` becomes `on conflict (key) do nothing;`.
- Ten subselects, drop `organization_id is null and`: `:178, 180, 182, 185, 194, 196, 198, 200` (the F16 derived-groups block) and `:669, 798` (the administrative-commission block and the two late-created orgs' active-membership groups).
- `:657-663`'s comment about the org-scoped `committee` duplicate (DECISION-110 fixture drift) — one line added: the door is now shut at the database (`drizzle/0051`'s grant narrowing), not merely by seed-time convention.

**New appended section — `scripts/test-rls.sql` §43** (all genuinely new assertions; append-only, no conflict with parallel pipelines' own appended sections)

```sql
-- ---------------------------------------------------------------------------
-- 43. DECISION-151 / F84-F86 — group_types reclassified to a global catalog.
--     Supersedes the RLS-shape half of what old section 39.7 asserted (now a
--     stub pointing here); this section is the one that actually checks the
--     post-drizzle/0051 shape.
-- ---------------------------------------------------------------------------
begin;
  -- No RLS at all — both flags, matching permissions/features/roles/
  -- sasr_form_versions exactly, not a half-state.
  select assert_eq(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'group_types'
        and not c.relrowsecurity and not c.relforcerowsecurity),
    1, 'DECISION-151: group_types has RLS disabled AND not forced');

  -- Zero policies of any name.
  select assert_eq(
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_types'),
    0, 'DECISION-151: group_types carries no RLS policy at all');

  -- presby_app: SELECT yes, INSERT/UPDATE/DELETE all no.
  select assert_eq(
    (select count(*) from unnest(array['SELECT']) priv
      where has_table_privilege('presby_app', 'group_types', priv)),
    1, 'DECISION-151: presby_app can read group_types');
  select assert_eq(
    (select count(*) from unnest(array['INSERT','UPDATE','DELETE']) priv
      where has_table_privilege('presby_app', 'group_types', priv)),
    0, 'DECISION-151: presby_app cannot write group_types at all — closes F84');

  -- unique (key), single column, plain (no NULLS NOT DISTINCT clause needed
  -- or present — key is NOT NULL).
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where t.relname = 'group_types' and c.conname = 'group_types_key_key'
        and c.contype = 'u' and array_length(c.conkey, 1) = 1),
    1, 'DECISION-151: group_types_key_key is a single-column UNIQUE on key');

  -- organization_id is genuinely gone, not just hidden by a view or filter.
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'group_types'
        and column_name = 'organization_id'),
    0, 'DECISION-151: group_types.organization_id column is dropped');

  -- One row per key (fixture-count-agnostic — six today, but this asserts
  -- the invariant, not a specific count that would drift under Rule 16).
  select assert_eq(
    (select count(*) from group_types),
    (select count(distinct key) from group_types),
    'DECISION-151: exactly one group_types row per key');
commit;

-- The revoke binds unconditionally — no policy engine in play, so this
-- proves the write is closed regardless of app.current_org_id.
do $$ begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  begin
    insert into group_types (key, name) values ('smuggled', 'Smuggled');
    raise exception 'FAIL DECISION-151: a tenant inserted into group_types';
  exception when insufficient_privilege then
    raise notice 'pass  DECISION-151: presby_app cannot INSERT group_types (F84 closed)';
  end;
  begin
    update group_types set name = 'x' where key = 'court';
    raise exception 'FAIL DECISION-151: a tenant updated group_types';
  exception when insufficient_privilege then
    raise notice 'pass  DECISION-151: presby_app cannot UPDATE group_types';
  end;
  begin
    delete from group_types where key = 'court';
    raise exception 'FAIL DECISION-151: a tenant deleted from group_types';
  exception when insufficient_privilege then
    raise notice 'pass  DECISION-151: presby_app cannot DELETE from group_types';
  end;
end $$;
```

**`src/lib/groups.test.ts` — three non-mechanical edits (Ruling 6)**
- `:1257-1269` (B-L1 duplicate rejection) — drop `organizationId: null,` from the `.values(...)` at `:1267`; update `expect(chain).toMatch(/group_types_org_key|duplicate key/)` at `:1269` to `expect(chain).toMatch(/group_types_key_key|duplicate key/)`. Note (Phase 2's flag, confirmed): the old regex would not have failed on a stale name because of the `duplicate key` alternative — this needs the deliberate edit, a test run alone would not catch a missed rename.
- `:1272-1284` (B-M4 template read) — body unchanged; correct the comment: "the SELECT policy admits NULL" becomes "there is no policy — and no RLS at all — to admit anything; every row is simply visible."
- `:1286-1299` (the load-bearing regression for F84) — this is the one artifact this whole pipeline exists to produce. Redesign in full:
  ```ts
  it("a tenant cannot write group_types at all — INSERT, UPDATE, DELETE each rejected (DECISION-151, regression for F84)", async () => {
    // Under the old four-policy split (drizzle/0048), group_types_insert's
    // WITH CHECK (organization_id = presby_current_org()) let any tenant
    // mint a real org-scoped row — reproduced live in Phase 1, F84. That
    // capability is correct for app_roles (a shipped custom-role feature)
    // and wrong for group_types (no per-org row exists, by DECISION-110
    // ruling 1). The fix is a revoke, not a policy, so it binds
    // unconditionally rather than only while a policy exists to enforce it.
    const insertChain = await rejectionChain(
      withOrgContext(clerkPerson, orgA, async (tx) =>
        tx.insert(groupTypes).values({
          key: `smuggled-${Date.now()}`,
          name: "Smuggled",
        }),
      ),
    );
    expect(insertChain).toMatch(/permission denied/);

    const [anyType] = await getPlatformDb()
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .limit(1);

    const updateChain = await rejectionChain(
      withOrgContext(clerkPerson, orgA, async (tx) =>
        tx.update(groupTypes).set({ name: "Hijacked" }).where(eq(groupTypes.id, anyType!.id)),
      ),
    );
    expect(updateChain).toMatch(/permission denied/);

    const deleteChain = await rejectionChain(
      withOrgContext(clerkPerson, orgA, async (tx) =>
        tx.delete(groupTypes).where(eq(groupTypes.id, anyType!.id)),
      ),
    );
    expect(deleteChain).toMatch(/permission denied/);
  });
  ```
  (`eq` must already be imported in this file for other assertions; verify before relying on it. `getPlatformDb` is already imported — used two tests above.)

**Mechanical sweep — corrected composition (feasibility check above), 30 sites across 24 files**
- 28 sites: delete the single property `organizationId: null,` from a `.values({...})` insert. 24 files minus `groups.test.ts`'s two already covered above and minus the one excluded file below, i.e. spread across `sites.test.ts` (3), `role-definitions.test.ts` (3), `directory.test.ts` (2), `groups.test.ts` (1, at `:180`, inside `findOrCreateGroupType()` — distinct from the two non-mechanical tests above), and eighteen more at one site each (`tickets.test.ts`, `tenant-branding.test.ts`, `staff.test.ts`, `roll.test.ts`, `role-grants.test.ts`, `presbytery.test.ts`, `person-sensitive.test.ts`, `people.test.ts`, `people-update.test.ts`, `org-portal/home-data.test.ts`, `org-portal/find-person.test.ts`, `org-features.test.ts`, `org-feature-categories.test.ts`, `officers.test.ts`, `events.test.ts`, `credentials.test.ts`, `children.test.ts`, `brand/read-org-brand.test.ts`, and `(org)/o/[slug]/admin/staff/actions.test.ts`).
- 2 sites: drop an `isNull(groupTypes.organizationId)` filter — `groups.test.ts:174` (same file/helper as the site above) and **`src/lib/org-provisioning.test.ts:97`** (the file this feasibility check surfaced; mirrors `org-provisioning.ts:292-294`'s own edit).
- **Excluded, by name, zero edit:** `src/app/(statistics-submit)/actions.test.ts:342` — an audit-metadata assertion (`metadata: { organizationId: null, ... }`), unrelated to `group_types`.
- Confirmed safe class-wide (Phase 2, re-verified): every one of these inserts runs on `platform`/`getPlatformDb()` (owner connection), so the `presby_app` revoke breaks none of them; every one uses a bare `.onConflictDoNothing()` with no inference target, which stays valid under `unique (key)`.
- No shared helper. Ruling 6's three reasons stand unchanged: the test-coverage review's item-11 teardown helper is a separately tracked pipeline and this is not the place to pre-empt its design; the edit is a mechanical, `tsc`-discoverable deletion; a helper would touch all 24 files anyway for the same outcome.

**Docs (on-branch, per kickoff — `docs/schema-design.md` is not on the do-not-edit list)**
- Run `npm run docs:erd` — drops the `organizations |o--o{ group_types : "organization_id"` mermaid edge at `docs/schema-design.md:192` automatically. Do not hand-edit the diagram.
- `docs/schema-design.md:943-947` — correct the `create table group_types (...)` DDL snippet: remove the `organization_id uuid references organizations(id), -- null = platform template` line, add `unique (key)`.
- Insert, immediately after that corrected snippet in §9, the paragraph Phase 2 drafted verbatim (adopted as-is — see Notes below).

**Journal**
- `drizzle/meta/_journal.json` — append idx 51 at the end, per the shared-file discipline (delimited, one entry).

## Implementation Order

1. Feasibility corrections applied to the plan (done above — no code yet).
2. `drizzle/0051_presby_group_types_catalog.sql` — write, apply to `pipeline-group-types` via `psql "$MIGRATE_DATABASE_URL"` (this is unreleased DDL on a dedicated branch — hand-apply is correct per the `drizzle/` line in Project Layout; `db:generate`/`db:push` are not the path for hand-written migrations).
3. `npm run check:schema-parity` — must report clean (no allowlist entry expected or added).
4. `src/lib/db/domain/groups.ts` — TS model edit (same commit as step 2/3 conceptually, since both sides move together).
5. `npm run typecheck` — this is the gate that catches every mechanical sweep site and the two `isNull()` filter sites (`groups.test.ts:174`, `org-provisioning.test.ts:97`) as compile errors. Do this **before** hand-fixing each file one at a time, to get the whole worklist from one `tsc` run rather than iterating file-by-file.
6. Application readers: `src/lib/groups.ts:496,581`, `src/lib/org-provisioning.ts:292-294`.
7. `scripts/seed.ts`: header comment, `seedGroupTypes()`'s doc comment, `:834`, `:838`.
8. `npm run db:seed` against `pipeline-group-types` — must succeed (this is the atomic-unit check Phase 2's Ruling 5 and the DECISION-151 draft both call out: the revoke and the seed fix land together or `db:seed` fails on its first `group_types` statement).
9. `scripts/seed-dev.sql` — the six in-place sites (comment, column list, `on conflict`, ten subselects, DECISION-110 note).
10. `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` against `pipeline-group-types` — must succeed with `-v ON_ERROR_STOP=1` (plain `psql -f` exits 0 even on a rolled-back transaction; do not trust a silent green run).
11. `scripts/test-rls.sql` — the five in-place sites (`:620-623`, `:5544`, `:5583-5618`, `:5718-5772` stub, `:5828-5832` comment) plus the new appended §43.
12. `psql -f scripts/test-rls.sql` **as `presby_app`**, `-v ON_ERROR_STOP=1` — must pass in full, including the new §43 block and the untouched §39.9 exclusion assertion.
13. `src/lib/groups.test.ts` — the three non-mechanical edits, `:1257`/`:1272`/`:1286` (the last one full-rewrite, given above).
14. The 30-site mechanical sweep across the remaining 23 files (24 minus `groups.test.ts`, already done in step 13; minus `actions.test.ts`, excluded).
15. `npm run typecheck` again — zero errors expected; this is the actual gate, step 5's run was diagnostic.
16. DB-backed vitest subset, `--no-file-parallelism` (per `docs/testing.md`), serial as required.
17. `npm run docs:erd` + the `docs/schema-design.md` §9 snippet + paragraph edit.
18. `drizzle/meta/_journal.json` — append idx 51.
19. Full rehearsal, both directions:
    - **Drift-remediation replay** (this branch already has 0043-0050 applied): confirm 0051 applied cleanly after 0048, re-run `check:schema-parity`.
    - **From-empty recipe end to end** (`docs/testing.md`'s "Getting a database with fixtures in it," DECISION-150's standing acceptance criterion, since this pipeline changes replay semantics for a table three migrations touch): `npm run db:migrate` (51/51 clean) → `npm run check:schema-parity` → `npm run db:seed` → `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` → `psql -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql` → `psql -f scripts/test-rls.sql` as `presby_app` → `npm run dev` smoke.
    - Expected counts at each stage: `db:seed` reports "seeded 6 platform-wide group_types" (unchanged copy, still six defs); `seed-dev.sql` lands its full fixture (no `on conflict` abort, the F83 failure mode this exact statement previously caused); `test-rls.sql`'s final "suite complete" banner runs the full ~4,460+ lines including the new §43 with no red line.

## Failing-first (regression discipline, per CLAUDE.md's bug-fix variant and Rule about testing the threat property, not the fix's shape)

- **The pre-flight guard**, tested by planting an org-scoped row on `pipeline-group-types` before applying 0051 (`insert into group_types (organization_id, key, name) values ('<any live org id>', 'shadow_committee', 'x')` under a superuser/owner connection, or reproduce Phase 1's exact tenant-context INSERT under the still-live 0048 policies) and confirming 0051's pre-flight `do $$` block raises with the named remediation message, **not** a generic constraint-violation further down the file. Roll the planted row back before proceeding.
- **`groups.test.ts:1286`'s rewrite** — confirm it fails (or rather, does not compile / does not exist to test the right thing) against the *current* shipped shape before the fix: run it against `pipeline-group-types` pre-0051 and observe the INSERT actually succeeds (the old `/row-level security/` expectation was passing for the wrong reason — the RLS policy rejected the smuggled row only because of the `organizationId: null` value chosen, not because tenant writes were closed). Then apply 0051 and confirm all three assertions (`INSERT`/`UPDATE`/`DELETE`) fail-then-pass in the `/permission denied/` direction.
- **The C-3 catch-all** (`:5600`/`:5618`) — confirm it goes red (count `1` instead of `0`, `25` instead of `26`) if you apply 0051's RLS-removal statements without editing the two arrays, then goes green once the arrays are updated. This is the mechanical proof that the "in-place, not append-only" ruling (F86) is load-bearing, not stylistic.

## Edge Cases & Risks

- **A smuggled row on a shipped or shared branch.** Covered by the pre-flight guard (item 1 of the statement list) — this is the highest-value edge case in the whole design, since a silent promotion-to-global or an opaque unique-violation mid-migration are both worse than a named `raise exception`.
- **`db:seed` / `seed-dev.sql` ordering.** The revoke (0051) and the seed-script/fixture fixes are one atomic unit (Phase 2 Ruling 5, DECISION-151 draft, `drizzle/0048` §2's own precedent for its own catalog revokes). Applying 0051 without the paired `seed.ts`/`seed-dev.sql` edits breaks `npm run db:seed` on its first statement and `seed-dev.sql` at parse time (`on conflict (organization_id, key)` naming a dropped column) — total fixture loss, not partial, because the file is one transaction. Implementation Order steps 6-10 sequence this correctly; do not apply 0051 alone and leave the seed fix for "later in the same PR."
- **`test-rls.sql`'s `ON_ERROR_STOP=1` execution model.** The three (now five, with the two optional-but-taken sites) in-place edits are not optional-for-later — the suite aborts entirely at the first stale reference, so a partial edit (e.g., fixing the C-3 arrays but not §39.7's stub) fails the *entire* suite, not just the new section. Apply all five in-place sites and the new §43 in the same commit.
- **`org-provisioning.test.ts:97`** — the feasibility-check catch. If skipped, this surfaces as a `tsc` error at Implementation Order step 5/15 (`Property 'organizationId' does not exist on type ...`), not silently — but naming it here means the implementer's worklist is complete on the first pass rather than discovered mid-sweep.
- **`groups.test.ts:1286`'s `anyType` lookup** — the UPDATE/DELETE assertions in the redesigned test need *some* existing `group_types` row to target. Reading it via `getPlatformDb()` (already imported in the file) rather than hardcoding a key keeps the test independent of exactly which six keys exist.
- **e2e blast radius (CLAUDE.md's explicit Phase 3 requirement).** One existing e2e spec touches this change's surface: **`e2e/admin-organizations-create.spec.ts`** exercises `createOrganization()` end to end, which calls `org-provisioning.ts:292-294`'s modified `group_types` reader to resolve the `court`/`roster` templates before creating the derived Session/Board of Deacons/Active Membership groups the spec asserts on (`groupRows` query at the spec's own lines ~101-112). The assertion itself (`["Active Membership","Board of Deacons","Session"]`) does not change — the reader returns the same six rows with a now-redundant predicate removed — so this is a **verification target for Phase 5, not an expected-diff spec**: QA should run it and confirm it still passes, not treat a pass as a given. No other e2e spec references `group`, `group_types`, or `createGroup`/`createOrganization` in a way the grep surfaced (`grep -rln "group" e2e` returns only this spec, `e2e/support/routes.ts` — a route constant, unrelated — and `account-page.spec.ts` — a false-positive on the word "groups" in a route-group comment).
- **`presby_platform`'s blanket grant.** Confirmed unchanged and correctly so (Phase 2 Ruling 2 item 6) — narrowing it is Security §B follow-up 7 (`presby_platform` login-or-drop), a separate, already-tracked pipeline. Touching it here would be an unrelated second decision smuggled into this diff.
- **Not auth-touching.** `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/` are untouched — the mandatory e2e/MFA gate does not apply, and QA's `PASS` does not require it (confirmed, matches Phase 2's Notes).

## Out of Scope (confirm with user)

- The other twelve numbered Security §B follow-ups (`docs/TODO.md`'s combined bullet, items 2-13) — explicitly named out of scope in the kickoff and unaffected here.
- `docs/schema-design.md` §17's pre-existing `person_links`/global-person-table stale-text item (`docs/TODO.md` line 112 item 5) — a different, already-tracked drift; this pipeline's §9 paragraph addition does not touch §17.
- The test-coverage review's item-11 shared teardown/fixture helper — a separately tracked pipeline; the mechanical sweep here stays per-file by design (Ruling 6).
- Any narrowing of `presby_platform`'s grant model (Security §B follow-up 7, `presby_platform` login-or-drop).
- Any change to `groups`, `group_memberships`, `officer_terms`, or the derived-roster trigger machinery — confirmed untouched (Phase 2's Court Is Not a Group section; re-verified live against `pg_trigger`/`pg_proc` in the feasibility check above).

## Proposed decisions / findings (adopted, orchestrator applies at integration)

- **DECISION-151** — adopted as drafted by the architect in Phase 2, verbatim, no changes. Reproduced there in full; not re-quoted here to avoid drift between two copies of the same text before integration.
- **F84, F85, F86** — adopted as proposed in Phase 2, verbatim, for `docs/schema-design-2.md`'s next lettered review-round subsection (that file stays untouched on-branch per the kickoff; the orchestrator folds these in at integration).
- **`docs/TODO.md`** — proposed edit at integration: remove item (1) ("reclassify `group_types` as a global catalog table...") from the combined "Security §B follow-ups" bullet's item list, and add a `[x]` Done line: `**group_types reclassified to a global catalog** — DECISION-151, F84-F86; root cause of B-M4/B-L1 and the groups.group_type_id FK exclusion closed at the database (drizzle/0051). — docs/work-log/2026-09-26-group-types-catalog.md`. Items 2-13 of that bullet stay as open, renumbered if the orchestrator wants a clean list (cosmetic, not required).

## Implementer

**database-admin** — the diff is DDL (one migration), one Drizzle table definition, SQL fixture edits (`scripts/seed-dev.sql`, `scripts/test-rls.sql`), and mechanical/semi-mechanical test-file edits. No route, component, server action, or API surface anywhere in the diff — confirmed by this design and by Phase 2's placement section.

---

# Phase 4 — Implementation

*Recorded 2026-09-26 by database-admin. Worktree `../presby-wt-gt`, git branch
`pipeline/group-types`, Neon branch `pipeline-group-types` — identity confirmed
before any DDL, not assumed from the filename:*

```
select name, setting from pg_settings where name like 'neon.%';
  neon.branch_id    | br-wispy-pond-axchf1oz     <- matches the kickoff block
  neon.endpoint_id  | ep-dark-fire-ax9ysu8z
  neon.project_id   | polished-snow-90038485
```

*(Worth stating because the sibling worktree `../presby` points at
`ep-lingering-meadow-axnarpsq` = `development`. The two `.env.local` files were
diffed side by side before the first `psql`.)*

## Files Created

- `drizzle/0051_presby_group_types_catalog.sql` — the fix-forward migration.
  Phase 3's statement list, in order, with one correction (see Implementer
  Notes #1).

## Files Modified

**Schema / model**
- `src/lib/db/domain/groups.ts` — `groupTypes` drops `organizationId` and its
  `organizations` FK; the stale `// null = platform-wide template seeded per
  organization type` comment is deleted; `unique("group_types_org_key").on(t.organizationId, t.key).nullsNotDistinct()`
  becomes `unique("group_types_key_key").on(t.key)` with a DECISION-151 comment.
  The `organizations` import stays (`groups.organizationId` still uses it).
  `key`'s trailing comment gains the sixth key, `roster`.

**Application readers**
- `src/lib/groups.ts` — `:496` and `:581` drop `isNull(groupTypes.organizationId)`
  (both collapse a two-arm `and(...)` to a single predicate); the module doc
  comment at `:33-38` now says the "ALWAYS RESOLVES TO THE PLATFORM-WIDE
  TEMPLATE ROW" sentence is literally true rather than aspirational.
- `src/lib/org-provisioning.ts:292-294` — drops `.where(isNull(...))` from the
  `templateRows` select; stays on `platformDb`; comment records why there is no
  filter left. `provisioning_incomplete` fall-through re-verified by e2e (below).

**Seed writer**
- `scripts/seed.ts` — the "EVERY GLOBAL-CATALOG WRITE IN THIS FILE RUNS HERE"
  header block rewritten from a two-reason structure to a one-reason structure
  with `group_types` folded into the enumerated list (and a short note saying
  what the block used to claim and why that was the bug);
  `seedGroupTypes()`'s inline comment rewritten the same way; `:834` drops the
  `isNull()`; `:838` drops `organizationId: null`.

**SQL fixture / suite — the F86 in-place exception**
- `scripts/test-rls.sql`, five in-place sites (all authorized by Phase 2 Ruling
  4 / Phase 3, none beyond them) plus one appended section:
  - `:620-623` — subselect predicate dropped, surrounding comment corrected.
  - `:5540-5551` (§39.4(d)) — both arrays gain `'group_types'`, `5` → `6`,
    "five catalog writers" → "six".
  - `:5575-5618` (§39.5, the C-3 catch-all) — both array literals gain
    `'group_types'`, both `25`s → `26`, both message strings → "26 named",
    and the "same 25 names as drizzle/0048 §2; keep the two in sync" note
    rewritten to record the supersession.
  - §39.7 — replaced with a stub recording what B-M4/B-L1 were and pointing
    forward to §43 (3,291 chars removed; nothing lost, only relocated/widened).
  - §39.9 comment — MATCH SIMPLE argument replaced with "the parent has no org
    axis at all"; **the assertion itself is unchanged and still passes.**
  - **New §43 appended at the very end of the file**, inside a
    `BEGIN/END APPENDED SECTION — pipeline/group-types` delimiter.
- `scripts/seed-dev.sql`, six in-place sites:
  - `:150-167` comment block corrected (fixed-id fallback rationale survives).
  - `:168` column list and three value tuples drop `organization_id`.
  - `:174` inference target `(organization_id, key)` → `(key)`.
  - **Eleven** subselects, not ten — see Implementer Notes #2.
  - `:657-663` DECISION-110 fixture-drift comment gains "the door is now shut
    at the database".

**Test sweep (mechanical)** — 24 `*.test.ts` files, listed in the Tests section
below.

**Docs**
- `docs/schema-design.md` — `npm run docs:erd` (drops the
  `organizations |o--o{ group_types : "organization_id"` edge); §9's
  `create table group_types` snippet corrected (`organization_id` line removed,
  `unique (key)` added, `roster` added to the key comment); Phase 2's paragraph
  inserted verbatim after the snippet.

**Deliberately NOT touched** (orchestrator, at integration, Rule 16):
`drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`,
`docs/decisions.md`, `docs/STATE.md`, `docs/schema-design-2.md`,
`docs/reviews/log.md`, `CLAUDE.md` — all verified clean with
`git status --porcelain` at the end of the phase.

Also deliberately untouched, and verified so:
`src/app/(statistics-submit)/actions.test.ts:342` (audit-metadata assertion,
not a `group_types` insert).

## Schema Changes

`group_types`, from a `drizzle/0009` `tenant_tables` member to a global catalog:

| | before | after |
|---|---|---|
| columns | `id, organization_id, key, name` | `id, key, name` |
| `relrowsecurity` / `relforcerowsecurity` | `t` / `t` | `f` / `f` |
| policies | 4 (`group_types_{select,insert,update,delete}`) | 0 |
| unique | `group_types_org_key UNIQUE NULLS NOT DISTINCT (organization_id, key)` | `group_types_key_key UNIQUE (key)` |
| `presby_app` | `SELECT, INSERT, UPDATE, DELETE` | `SELECT` |
| `presby_platform` | blanket CRUD | blanket CRUD (untouched, by design) |
| outbound FK | `organization_id -> organizations(id)` | none (dropped with the column) |
| inbound FK | `groups.group_type_id` plain | `groups.group_type_id` plain (unchanged) |
| rows | 6 / 6 distinct keys | 6 / 6 distinct keys |

**Migration mode: hand-written.** `drizzle/0051_presby_group_types_catalog.sql`,
applied with
`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0051_presby_group_types_catalog.sql`
as `neondb_owner` on the direct (non-pooled) endpoint. Not `db:push` (forbidden
by the kickoff, and lossy), not `db:generate` (Drizzle Kit emits no policy,
grant, revoke or `do $$` guard — the whole substance of this file). The
`_journal.json` entry for idx 51 is the orchestrator's to add at integration;
nothing on disk was modified for the rehearsal (see Implementer Notes #4).

## Audit Events

None. No mutation path changed — this is DDL, a Drizzle model, seed/fixture SQL
and tests. `npm run check:audit` passes.

## Commands run

| # | Command | Result |
|---|---|---|
| 1 | `psql -v ON_ERROR_STOP=1 -f drizzle/0051_…sql` (smuggled row planted) | **exit 3, raises** — failing-first #1 |
| 2 | `psql -v ON_ERROR_STOP=1 -f drizzle/0051_…sql` (row removed) | exit 0 |
| 3 | same file, **re-applied whole** | **exit 0**, row count 6 → 6 — idempotency proof |
| 4 | `npm run check:schema-parity` | `64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing` — no new allowlist entry |
| 5 | `npm run typecheck` (diagnostic, pre-sweep) | 31 error sites, enumerated below |
| 6 | `npm run typecheck` (gate, post-sweep) | exit 0 |
| 7 | `npm run lint` | exit 0 |
| 8 | `npm run db:seed` | exit 0, `seeded 6 platform-wide group_types` |
| 9 | `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` | see Implementer Notes #3 (run for real in the from-empty rehearsal) |
| 10 | `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` | **exit 0, 526 assertions pass, zero ERROR/FAIL**, §43's 12 all green |
| 11 | `npm run test:db` | **287 files, 4149 tests, 0 failed**, 412s |
| 12 | `npm run check` (all five tripwires) | exit 0 |
| 13 | `npm run build` | exit 0 |
| 14 | `npx tsx scripts/generate-erd.ts` | `refreshed 10 diagrams from 84 tables` |
| 15 | `npx playwright test e2e/admin-organizations-create.spec.ts` | **5 passed** |
| 16 | from-empty recipe, `docs/testing.md` | **all stages green** — see below |

Note on 14: `npm run docs:erd` is **not** wrapped in `dotenv` in `package.json`,
so it dies on `src/lib/db/index.ts:81` unless the env is already loaded. Ran it
as `npx dotenv -e .env.local -- npx tsx scripts/generate-erd.ts`. Flagging as a
tiny pre-existing papercut, not fixed here (out of scope, no work-log).

## Failing-first evidence

### 1. The pre-flight `raise` guard (Phase 3 statement 1)

Planted a real org-scoped row on the branch as owner:

```sql
insert into group_types (organization_id, key, name)
values ('e2e00000-0000-0000-0000-000000000001', 'shadow_committee', 'Shadow Committee');
-- INSERT 0 1 ; select count(*) ... where organization_id is not null -> 1
```

Applying the whole migration then gives, **at the first statement**:

```
psql:drizzle/0051_presby_group_types_catalog.sql:58: ERROR:  drizzle/0051: 1 org-scoped
  group_types row(s) found (organization_id is not null). DECISION-110 ruling 1 permits no
  per-org group type. Before re-running this migration: inspect these rows, repoint any
  groups.group_type_id referencing them to the matching platform-wide (organization_id is
  null) row by key, then delete the org-scoped row(s).
CONTEXT:  PL/pgSQL function inline_code_block line 14 at RAISE
EXIT=3
```

and — the half that matters — **nothing after it ran**: `relrowsecurity`/
`relforcerowsecurity` still `t`/`t` and all four 0048 policies still present.
So the guard is a refusal, not a warning, and it is diagnosable rather than the
opaque mid-file unique violation Phase 2 Ruling 2 was worried about.
`delete from group_types where organization_id is not null;` (DELETE 1) →
re-apply → exit 0.

### 2. `groups.test.ts`'s F84 regression, run against the pre-0051 database

The rewritten test was run **before** the migration was applied:

```
FAIL  src/lib/groups.test.ts > … > a tenant cannot write group_types at all —
      INSERT, UPDATE, DELETE each rejected (DECISION-151, regression for F84)
AssertionError: expected 'Failed query: insert into "group_type…' to match /permission denied/
+ Received: "… | new row violates row-level security policy for table \"group_types\""
 ❯ src/lib/groups.test.ts:1310:27
```

This is exactly Phase 3's point made concrete: pre-0051 the rejection is
`/row-level security/` and it fires only because of the *value* the old test
happened to choose (`organizationId: null` fails the INSERT policy's
`WITH CHECK`), not because tenant writes were closed. After applying 0051 the
same test passes (`1 passed | 44 skipped`), and it now covers UPDATE and DELETE
too, which the old test never tried and which were both genuinely open.

### 3. The C-3 catch-all, run as `presby_app` after 0051 and before the array edit

The whole suite cannot demonstrate this, because with `ON_ERROR_STOP=1` it
aborts earlier at `:620`'s dropped-column subselect — itself a clean
demonstration of F86. So §39.5 was extracted verbatim and run standalone:

```
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f c3-before.sql
ERROR:  FAIL C-3: every table in schema public carries FORCE ROW LEVEL SECURITY except the
        25 named platform-shell / global-catalog / org-tree tables — expected 0, got 1
```

After adding `'group_types'` to both arrays and moving both constants to 26:

```
NOTICE:  pass  C-3: every table in schema public carries FORCE ROW LEVEL SECURITY except
         the 26 named … (0)
NOTICE:  pass  C-3: every one of the 26 allow-listed names still exists and still lacks
         FORCE — the allow-list has not gone stale (26)
```

### 4. §43 itself, proven load-bearing (the standing test-rls rule)

Broke the exact mechanism the new section asserts — re-granted the privilege
0051 revokes — and confirmed the section goes red, then restored it:

```
grant insert on group_types to presby_app;
  ERROR:  FAIL DECISION-151: presby_app cannot write group_types at all — closes F84
          — expected 0, got 1        (scripts/test-rls.sql:6601)
revoke insert on group_types from presby_app;
  -> 12/12 assertions pass again
```

## The from-empty rehearsal (DECISION-150 acceptance criterion)

Run on a **fresh database inside the same Neon branch** (`create database
gt_fromempty`), so nothing about the branch's own `neondb` could mask a replay
defect. Committed `drizzle/meta/_journal.json` untouched throughout: the journal
carries 1–50, so `db:migrate` applied those and 0051 was hand-applied on top
(the sanctioned option in the task's own wording).

```
### 0. drop/create gt_fromempty (truly empty)
### 1. drizzle-kit migrate            -> migrations applied successfully; ledger rows = 51
       pre-0051 group_types shape     -> relrowsecurity/force = t/t, 4 policies,
                                         columns id,organization_id,key,name
       ^ i.e. the replay really does pass THROUGH the tenant shape (0009 -> 0048)
         and out the other side, which is the property Phase 2 Ruling 2 claimed.
### 1b. psql -f drizzle/0051_…sql     -> exit 0; f/f, 0 policies, id,key,name,
                                         group_types_key_key
### 2. check:schema-parity            -> 64 tables, 5 allowlisted, 0 failing
### 3. db:seed                        -> roles=3, group_types=6
### 4. seed-dev.sql (ON_ERROR_STOP=1) -> exit 0
### 5. install-test-helpers.sql       -> exit 0
### 6. fixture counts                 -> orgs=10 people=16 groups=11 group_types=6
### 7. test-rls.sql as presby_app     -> exit 0, 526 assertions pass, zero ERROR/FAIL
```

Step 4 is the one that would have caught F85: `on conflict (key) do nothing`
parses and the single-transaction fixture lands in full. Step 7's 526 matches
the count on the branch's own `neondb` exactly, so the two databases agree.

`gt_fromempty` was dropped afterwards; the branch is back to a single `neondb`.

## Tests

**Rewritten / non-mechanical (3, all in `src/lib/groups.test.ts`)**
- `:1257` — *"a second row for an existing key is rejected — regression for B-L1
  group_types duplicates"*. Field dropped; regex `/group_types_org_key|duplicate key/`
  → `/group_types_key_key|duplicate key/`. Phase 2's warning was right and is worth
  repeating for QA: the `duplicate key` alternative means a **stale regex would
  still have passed**, so this edit is not test-run-discoverable.
- `:1272` — *"reads platform-template group types through the RLS-enforced
  connection… regression for B-M4"*. Body unchanged (deliberately); comment
  rewritten from "the SELECT policy admits NULL" to "there is no policy, and no
  RLS at all, to admit anything."
- `:1286` → **`src/lib/groups.test.ts:1297` — "a tenant cannot write group_types
  at all — INSERT, UPDATE, DELETE each rejected (DECISION-151, regression for
  F84)"**. The artifact this pipeline exists to produce. Asserts
  `/permission denied/` on all three verbs; `anyType` is read via
  `getPlatformDb()` rather than a hardcoded key. Failing-first evidence above.

**New SQL assertions** — `scripts/test-rls.sql` §43, 12 assertions: both RLS
flags false, zero policies, `presby_app` SELECT-yes / INSERT-UPDATE-DELETE-no,
`group_types_key_key` single-column unique, `organization_id` gone from
`information_schema.columns`, one row per key, all six rows visible to
`presby_app` (B-M4 restated on the new shape), `groups.group_type_id` still
single-column, and a `do $$` block proving INSERT/UPDATE/DELETE each raise
`insufficient_privilege` regardless of `app.current_org_id`.

**Mechanical sweep — 24 `*.test.ts` files.** `tsc` was used as the worklist
generator rather than grep (Implementation Order step 5), which is also what
makes the exclusion mechanical rather than a promise: `src/app/(statistics-submit)/actions.test.ts:342`
never appears in the error list, because it is not a `groupTypes` insert.

`src/app/(org)/o/[slug]/admin/staff/actions.test.ts`, `src/lib/brand/read-org-brand.test.ts`,
`children.test.ts`, `credentials.test.ts`, `directory.test.ts` (2), `events.test.ts`,
`groups.test.ts` (2 mechanical + 3 above), `officers.test.ts`,
`org-feature-categories.test.ts`, `org-features.test.ts`,
`org-portal/find-person.test.ts`, `org-portal/home-data.test.ts`,
`org-provisioning.test.ts`, `people-update.test.ts`, `people.test.ts`,
`person-sensitive.test.ts`, `presbytery.test.ts`, `role-definitions.test.ts`,
`role-grants.test.ts`, `roll.test.ts`, `sites.test.ts` (3), `staff.test.ts`,
`tenant-branding.test.ts`, `tickets.test.ts`.

**e2e** — `e2e/admin-organizations-create.spec.ts`, 5/5 passed against a real
dev server on port 3500 (port 3000 was already held by a sibling worktree
pointing at a different Neon branch, so reusing it would have silently tested
the wrong database — started my own and stopped it by PID afterwards). This is
the spec that exercises the modified `org-provisioning.ts:292-294` reader end to
end and asserts the three derived groups still materialize. Not an
expected-diff spec; a pass was the required outcome, not a given.

## Implementer Notes

1. **One correction to Phase 3's statement list, and it is required for the
   idempotency proof.** As designed, the pre-flight guard's body was a bare
   `select count(*) into smuggled_count from group_types where organization_id
   is not null;`. On the **second** whole-file apply the column no longer
   exists, and plpgsql raises `column "organization_id" does not exist` when it
   prepares that statement — the file would not have been whole-file idempotent,
   which is the property the hand-written-migration rule demands be *proved*, not
   asserted. Wrapped the check in an `information_schema.columns` existence test
   and made the count itself dynamic (`execute … into`). Both applies now exit 0
   and the row count is unchanged (6 → 6). Everything else in the file is Phase
   3's text verbatim.

2. **`scripts/seed-dev.sql` has eleven `organization_id is null` subselects, not
   ten.** Phase 3 enumerated `:178, 180, 182, 185, 194, 196, 198, 200, 669, 798`;
   `grep -n "group_types" scripts/seed-dev.sql` also finds one at `:800` (the
   second of the two late-created orgs' Active Membership groups). Fixed all
   eleven. This would not have been a silent miss — it is inside the
   single-transaction file and would have aborted the whole fixture — but it is
   exactly F85's shape and is worth recording as such.

3. **`seed-dev.sql` is not idempotent, and that is pre-existing, not this
   diff's doing.** Re-running it against the branch's already-seeded `neondb`
   fails at `:78` with `duplicate key … organizations_id_key`. It is a
   from-empty fixture by construction, and the documented recipe runs it
   against a fresh database. So the real proof of the `on conflict (key)` edit
   is the from-empty rehearsal (stage 4, exit 0), not a re-run on `neondb`. The
   new inference clause was additionally parse-checked in isolation against
   `neondb` (`insert … on conflict (key) do nothing;` → `INSERT 0 0`, exit 0).

4. **Nothing on disk was modified to make the rehearsal work.** No scratch
   `_journal.json`, no `drizzle.__drizzle_migrations` row for idx 51 —
   `db:migrate` ran the committed 1–50 and 0051 went on by `psql`, which is the
   documented hand-written-migration path anyway. `git status --porcelain` on
   the six shared/forbidden files is empty.

5. **A harness trap worth naming, since QA may repeat the rehearsal.**
   `dotenv-cli` does **not** override variables already present in the
   environment. My first from-empty attempt had sourced `.env.local` into the
   same shell, so `npm run db:seed` silently wrote to `neondb` instead of
   `gt_fromempty` — and `seedGroupTypes()` prints `seeded ${defs.length}`
   **unconditionally**, so the log said "seeded 6 platform-wide group_types"
   while zero rows landed in the target database. Caught it by checking
   `select count(*) from roles` in the scratch DB (0, not 3) rather than
   trusting the log line. The rehearsal was redone from a freshly recreated
   database under `env -u DATABASE_URL -u … bash`, and that clean run is the
   one reported above. The misleading log line is a genuine (small) defect in
   `scripts/seed.ts`; **not** fixed here — it is outside this pipeline's scope
   and deserves its own line in `docs/TODO.md`, which I am proposing to the
   orchestrator rather than writing.

6. **`npm run docs:erd` produced incidental churn beyond this pipeline's edge.**
   Besides dropping `organizations |o--o{ group_types : "organization_id"`, the
   regenerated diagrams reorder three edges and relabel two
   (`groups |o--o{ administrative_commissions : "group_id"` →
   `"group_id, parent_org_id"`, likewise `org_delegations`). That is
   pre-existing drift from an earlier composite-FK migration whose ERD was
   never regenerated — surfaced by, not caused by, this change. Kept, because
   the regenerated form is the accurate one and Phase 2 Ruling 3 says to run
   the script and not hand-edit the diagram.

7. **`check:schema-parity` gained no allowlist entry, as Phase 3 required
   explicitly.** Both sides moved in one commit and the script does not compare
   unique constraints, RLS or grants, so there is no difference for it to
   allow. Verified on both the branch database and the from-empty one.

8. **`presby_platform` untouched**, deliberately (Phase 2 Ruling 2 item 6) — it
   still holds 0009's blanket CRUD on `group_types`, same as on `permissions`.
   Confirmed by `aclexplode(relacl)` after the double apply. Narrowing it is
   Security §B follow-up 7.

9. **`neondb_owner` reminder for the record (F44).** The revoke does not bind
   the owner connection, and `getPlatformDb()` is that connection. That is
   intended here — `seedGroupTypes()` is the sanctioned writer and runs there.
   There is no owner-path trigger on `group_types` and none is called for: the
   table holds six labels, no tenant data, and the invariant being defended
   (D8, no tenant-minted group types) is about `presby_app`, which the grant
   does bind.

## Handoff

**Next agent: qa (Phase 5).**

- **Local apply:** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0051_presby_group_types_catalog.sql`,
  then `npm run db:seed`. The migration is **already applied** to
  `pipeline-group-types`' `neondb`, and it is idempotent, so re-running is safe
  and is the cheapest way to confirm that claim independently.
  `drizzle/meta/_journal.json` has **no** idx-51 entry yet by design — the
  orchestrator adds it at integration, so `npm run db:migrate` will not pick
  0051 up.
- **New/changed schema available to the next implementer:** `group_types` is now
  `(id, key, name)` with `unique (key)`, no RLS, readable by `presby_app` and
  writable only on the owner connection. Any future reader can drop its
  `organization_id IS NULL` filter; any future *writer* must go through
  `getPlatformDb()` or a seed. `groups.group_type_id` is unchanged and stays a
  plain single-column FK — **do not** "fix" it in a future composite-FK sweep;
  `scripts/test-rls.sql` §39.9 guards that and its comment now explains why.
- **`test-rls.sql` sections added/touched:** §43 added (appended, delimited);
  §39.4(d), §39.5, §39.7 (stubbed), §39.9 (comment only) and the `:620` fixture
  subselect edited in place. Run it as `presby_app`
  (`psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql`) —
  running it as the owner proves nothing. Expected: **exit 0, 526 passing
  assertions, zero ERROR/FAIL.**
- **Seed changed:** both `scripts/seed.ts` and `scripts/seed-dev.sql`. `db:seed`
  is safe to re-run; `seed-dev.sql` is from-empty only (Implementer Note 3).
- **Suggested QA focus:** (a) re-run the suites; (b) re-do the whole-file
  double-apply and confirm exit 0 twice; (c) confirm `groups.test.ts`'s F84
  regression genuinely fails if you re-grant INSERT to `presby_app` — that is
  the one assertion the whole pipeline turns on; (d) confirm the six
  shared/forbidden files are still clean.
- **For the orchestrator at integration:** `_journal.json` needs
  `{ "idx": 51, "version": "7", "when": <sequential>, "tag": "0051_presby_group_types_catalog", "breakpoints": true }`;
  DECISION-151 and F84–F86 are adopted as drafted in Phase 2; plus one new
  proposed `docs/TODO.md` line from Implementer Note 5 —
  *`scripts/seed.ts`'s `seedGroupTypes()` logs `seeded ${defs.length}`
  unconditionally, so the count is printed even when nothing was written; make
  it report rows actually inserted.*
- **Not auth-touching** — no `src/auth.ts`, `src/app/(auth)/`,
  `src/app/api/auth/` or `src/lib/auth/` in the diff, so the mandatory
  e2e/MFA gate does not apply to Phase 5's `PASS`.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa (read-only; authored no tests, edited no files — `git status --porcelain` is byte-identical to session start: 31 modified + 2 untracked)

**Environment identity confirmed before any write.** `env | grep DATABASE_URL` → empty (no stray exports). `pg_settings`: `neon.branch_id = br-wispy-pond-axchf1oz`, `neon.endpoint_id = ep-dark-fire-ax9ysu8z`, `neon.project_id = polished-snow-90038485` — the `pipeline-group-types` branch, **not** `development` (`ep-lingering-meadow-axnarpsq`). No `ALTER ROLE`, no `db:push`. All break/restore probes ran on a scratch database (`qa_gt_fromempty`), created and dropped inside the same branch; the pipeline branch's `neondb` was never mutated.

## Type Check

`npm run typecheck`: **PASS** (exit 0)
`npm run lint`: **PASS** (exit 0)
`npm run check` (all five tripwires — audit, sql-date, deps-drift, brand-scope, secrets): **PASS** (exit 0)
`npm run check:schema-parity`: **PASS** — `64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing`, on the pipeline DB **and** independently on a from-empty database. No new allowlist entry, confirming Phase 3's explicit requirement and Implementer Note 7.

## Unit Tests

`npm run test:db` — Total: **4149** | Passed: **4149** | Failed: **0** | Skipped: **0** | Files: 287 | Duration: 449s
Failures: none.

`scripts/test-rls.sql` as `presby_app` (`ON_ERROR_STOP=1`) — **526 passing assertions, exit 0, zero ERROR/FAIL**, reproduced three times: on the pipeline DB, on the from-empty scratch DB (counts agree exactly), and again on the pipeline DB *after* the e2e fixtures landed (order-independence).

## End-to-End Tests

Total: 129 | Passed: **120** | Failed: 4 | Did not run: 5 | Duration: 2.8m

**The spec Phase 3 named as the Phase 5 verification target passed: `e2e/admin-organizations-create.spec.ts` — 5/5**, exercising the modified `src/lib/org-provisioning.ts:292-294` reader end to end and asserting the three derived groups still materialize.

I ran the full suite anyway. **None of the 4 failures is attributable to this diff** — each is diagnosed, not assumed:

| Failure | Diagnosis | Attributable? |
|---|---|---|
| `e2e/post-login-routing.spec.ts:110` and `:166` | Both assert the **legacy** org-portal copy (`/you're in/i`, an org-name `<h1>`). `src/app/(org)/o/[slug]/page.test.tsx:173` shows that copy renders only when `org_portal.home_v2` is **off**; that flag is `enabled=true` on this DB, so the v2 greeting page renders instead ("Good afternoon, Tobias." in the captured snapshot — the page works, the spec is stale). The string is byte-identical at the merge-base. | **No** — stale specs, pre-existing |
| `e2e/public-sites.spec.ts:334` + the **5 "did not run"** | `:214` is a `test.describe.serial`, so the 5 are downstream of this one failure, not skips. Main's `07801a2 fix(sites): every anonymous read on the public-site path fails closed…` (PR #17, DECISION-154) rewrote `src/lib/sites.ts` (+225 lines) and the render page. **This branch does not contain that commit**; the spec file is identical between base and main. Resolves on merging main. | **No** — fix already on main |
| `e2e/header-controls.spec.ts:110` | Passed on re-run (32 passed / 2 failed). | **No** — flaky |

**Harness trap worth recording:** port 3000 was held by a `next-server` from an entirely different repo (`/Users/cshenso/git/westervillelions`). `playwright.config.ts` sets `reuseExistingServer: !CI`, so a default run would have silently tested the wrong application. I started my own dev server on **3500** in this worktree, drove it with `E2E_BASE_URL`, and stopped it by PID.

## Regression Tests Added

*(Authored by the implementer; verified by me. Regression discipline confirmed by independent reproduction, not by reading Phase 4's transcript.)*

- **`src/lib/groups.test.ts:1289` — "a tenant cannot write group_types at all — INSERT, UPDATE, DELETE each rejected (DECISION-151, regression for F84)"** — guards against: any tenant-writable path to `group_types`. **Failing-first independently reproduced.** On the scratch DB with `grant insert on group_types to presby_app` restored, the test fails at `src/lib/groups.test.ts:1247` (`AssertionError: expected null not to be null` — the INSERT *succeeded*). After `revoke insert, update, delete`, verified by `aclexplode` to be `presby_app:SELECT` only, the whole file passes **45/45, 0 skipped**. The test asserts `/permission denied/` on all three verbs, as designed.
- **`scripts/test-rls.sql` §43 (12 assertions, lines 6569–6676)** — guards against: regression of the whole catalog tuple. **Proven load-bearing.** With INSERT re-granted, §43 goes red at exactly the grant assertion: `ERROR: FAIL DECISION-151: presby_app cannot write group_types at all — closes F84 — expected 0, got 1` (`scripts/test-rls.sql:6601`). Note the break is caught **earlier** by `scripts/test-rls.sql:5554` (§39.4(d) B-H3) under `ON_ERROR_STOP=1` — the implementer took Phase 2's *optional* suggestion, so two independent assertions now cover it.
- **`scripts/test-rls.sql:5583-5624` — the C-3 catch-all.** Verified by reading, per Phase 3's own warning that a run alone cannot catch it: `'group_types'` is present in **both** array literals, both constants are **26**, both message strings read "26 named", and the allow-list contains exactly **26** names.
- **`src/lib/groups.test.ts:1256`** (B-L1) — regex correctly updated to `/group_types_key_key|duplicate key/`. Phase 2/3 were right that a stale name would still have passed via the `duplicate key` alternative; confirmed by reading, not by the green run.
- **The `drizzle/0051` pre-flight guard** — see Schema/RLS Audit below.

## Coverage on Critical Modules

Untouched by this diff; re-measured anyway. All three meet target.

- `src/lib/permissions.ts`: **100%** stmts / 100% branch / 100% funcs (target 100%) ✓
- `src/lib/two-factor.ts`: **91.3%** stmts / 100% branch / 90% funcs (target 90%+) ✓
- `src/lib/flags.ts`: **100%** stmts / 100% branch / 100% funcs (target 100%) ✓

## Feature-Gate Audit

**No protected routes touched.** Verified by reading the diff's file list, not inferred: `git diff --name-only <merge-base>` contains **zero** `route.ts`, **zero** `actions.ts`, and **zero** files carrying `"use server"`. The non-test source files changed are exactly: `src/lib/db/domain/groups.ts`, `src/lib/groups.ts`, `src/lib/org-provisioning.ts`, `scripts/seed.ts`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `docs/schema-design.md`.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| *(none — no protected route or server action added or changed)* | n/a | n/a | n/a |

**Auth gate: not auth-touching.** `git diff --name-only <merge-base>` matches none of `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`. The mandatory running-server MFA e2e gate does not apply (and the e2e suite ran against a real dev server regardless).

**Authorization read by hand, not inferred from green tests:** `createGroup()`'s load-bearing validation survives the filter removal — `src/lib/groups.ts:580-584` still rejects any `groupTypeId` whose key is outside `MANAGEABLE_GROUP_TYPE_KEYS`, so a client cannot smuggle a `court`/`roster` id now that `isNull(organizationId)` is gone. `getGroupFormOptions()` keeps its `inArray(...MANAGEABLE_GROUP_TYPE_KEYS)` filter. `org-provisioning.ts`'s `provisioning_incomplete` fall-through is intact.

## Schema / RLS Audit

*(Mandatory on a schema-touching change. Verified against the **live catalog** — `pg_class`, `pg_policies`, `aclexplode(relacl)`, `pg_trigger`, `pg_constraint` — never `information_schema` grants and never the Drizzle table file.)*

| Claim | Live-catalog result | Verdict |
|---|---|---|
| `relrowsecurity` / `relforcerowsecurity` both false | `f` / `f` | ✓ |
| Zero rows in `pg_policies` | `0` | ✓ |
| Columns exactly `id, key, name`; no `organization_id` | `id, key, name` (ordinals 1, 3, 4 — position 2 vacated by the drop) | ✓ |
| `group_types_key_key unique (key)` | `UNIQUE (key)`, single column, no `NULLS NOT DISTINCT` | ✓ |
| `presby_app` SELECT only, no I/U/D | `presby_app:SELECT` and nothing else | ✓ |
| `presby_platform` unchanged from main's intent | `SELECT,INSERT,UPDATE,DELETE` — i.e. `drizzle/0009:44`'s blanket grant. `git show main:drizzle/0048_presby_security_b.sql` issues no grant/revoke against `presby_platform` on this table, and `drizzle/0051` names it only in a comment (`:91-94`) | ✓ unchanged |
| Triggers | none (`pg_trigger`, non-internal: 0 rows) | ✓ |
| Rows | 6 total / 6 distinct keys | ✓ |
| Inbound FK | `groups_group_type_id_group_types_id_fk` — plain, single-column, intact | ✓ |

**Tuple parity against the reference catalogs**, read in one query: `group_types` now matches `permissions`, `features` and `roles` **exactly** on `(relrowsecurity, relforcerowsecurity, policy count, presby_* grants)`. Not a described shape — an identical one.

**Which layer actually refuses the write.** The refusing layer is the **grant**, not a policy and not a trigger. There is no policy left to refuse anything and no trigger on the table at all; `revoke insert, update, delete … from presby_app` is the whole mechanism. Probed as `presby_app` on the connection that matters: INSERT, UPDATE and DELETE each raise `insufficient_privilege` regardless of `app.current_org_id` (§43's `do $$` block, three green notices). The claim is verified, and it is verified against the right layer.

**Failing-first, reproduced by me on a fresh database — not replayed from Phase 4's transcript:**

1. **From-empty replay passes *through* the tenant shape.** `create database qa_gt_fromempty` → `db:migrate` applied the committed 1–50 (journal untouched) → the catalog showed `t`/`t`, the four `0048` policies, columns `id, organization_id, key, name`, and full CRUD to `presby_app`. Phase 2 Ruling 2's replay claim is true, not asserted.
2. **The pre-flight guard is a refusal, not a warning.** With an org-scoped row planted (`organization_id` = a real org), applying `drizzle/0051` gave `EXIT=3` at the **first** statement with the named remediation message — and, the half that matters, **nothing after it ran**: `t`/`t` still, four policies still, `organization_id` still present, `presby_app` still holding full CRUD. Row removed → apply → exit 0.
3. **Whole-file idempotency.** Applied the file **three** times: exit 0, 0, 0; terminal shape stable; row count unchanged. Implementer Note 1's correction (the guard wrapped in an `information_schema.columns` existence test with a dynamic `execute`) is necessary and sufficient — without it the second apply would raise `column "organization_id" does not exist`.
4. **Full DECISION-150 from-empty rehearsal, clean database, green end to end:** `db:migrate` (1–50) → `0051` → `check:schema-parity` (0 failing) → `db:seed` → `seed-dev.sql` (`ON_ERROR_STOP=1`, reached `COMMIT`) → `install-test-helpers.sql` → **`test-rls.sql` as `presby_app`: 526 passes, exit 0**. Fixture counts `orgs=10 people=16 groups=11 group_types=6`, matching Phase 4 exactly. **I verified the seed by row count (`roles=3`), not by the log line** — Implementer Note 5's trap avoided. Scratch database dropped afterwards; `pg_database` is back to `neondb` alone.

**Incidental invariant confirmation:** my attempt to clean up a scratch `organizations` row was refused by `presby_guard_organizations_delete()` on the **owner** connection — the D10 "Organizations are permanent" owner-path guard working as designed.

## Shared-File Discipline Audit

**Important topology note for the orchestrator:** `git diff main` is **misleading on this branch**. `HEAD` (82d6b54) *is* the merge-base; `main` has advanced by PR #17 (four commits). A naive `git diff main -- docs/STATE.md docs/TODO.md docs/decisions.md` shows changes that are **main's additions**, not this branch's edits. Audited against the merge-base instead.

**Forbidden files — `git diff --stat <merge-base>` is empty for all of them:** `drizzle/meta/_journal.json` (still ends at idx 50, as designed), `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/schema-design-2.md`, `CLAUDE.md`. `git status --porcelain` for the three docs files is empty. **DECISION-151 is unclaimed on main** (main carries 150 and 154).

**`scripts/seed-dev.sql` — every hunk authorized:**

| Hunk (old lines) | Content | Authorization |
|---|---|---|
| `155,7` | NULLS-NOT-DISTINCT comment block corrected | Ph3 site 1 (`:150-167`) |
| `168,3` | column list + three value tuples drop `organization_id` | Ph3 site 2 |
| `173,2` | `on conflict (organization_id, key)` → `(key)` | Ph3 site 3 |
| `178`, `180`, `182`, `185`, `194`, `196`, `198`, `200` | subselect predicate dropped ×8 | Ph3 site 4 |
| `666,0 → +669,5` | DECISION-110 fixture-drift comment, pure addition | Ph3 site 6 (`:657-663`) |
| `669`, `798`, `800` | subselect predicate dropped ×3 | Ph3 site 4 + Implementer Note 2 (the 11th, at `:800`) |

**`scripts/test-rls.sql` — every hunk authorized, nine hunks, no unauthorized in-place edit:**

| Hunk (old lines) | Content | Authorization |
|---|---|---|
| `613,15` | `:620` subselect predicate dropped + comment corrected | Ph3 site 1 |
| `5538,15` | §39.4(d): both arrays gain `'group_types'`, `5`→`6` | Ph3 site 4 (optional, taken) |
| `5573,8` · `5589,7` · `5597,7` · `5609,13` | §39.5 C-3: both arrays, both constants → 26, both messages | Ph3 site 2 |
| `5715,62 → 27` | §39.7 replaced with a stub pointing to §43 | Ph3 site 3 |
| `5825,11` | §39.9 — **comment-only**; verified the assertion body is untouched context | Ph3 site 5 (optional, taken) |
| `6587,3 → +114` | §43, **pure addition (0 removals)** at EOF inside `BEGIN/END APPENDED SECTION — pipeline/group-types`, after the prior pipeline's END marker | append-only, correct |

**`src/app/(statistics-submit)/actions.test.ts:342` confirmed excluded** — still reads `organizationId: null` inside an audit-`metadata` assertion, and the file does not appear in the diff at all.

## Sweep Audit

`grep -rn "organizationId: null" src scripts` → 3 hits, all justified:
- `src/app/(statistics-submit)/actions.test.ts:342` — audit metadata, deliberately excluded ✓
- `src/lib/role-definitions.test.ts:348` and `:692` — **`appRoles` inserts, not `groupTypes`**. `app_roles` legitimately retains its nullable `organization_id` template arm (with `organizationTypeScope`), which is the whole distinction Phase 1/2 drew between the two tables ✓

`grep -rnE "group_types[^;]*organization_id|groupTypes\.organizationId" src scripts e2e` → 9 hits. Seven are correct explanatory prose or the §43 assertions that *prove the column is gone*. **Two are stale** — see Finding 1.

## Findings

**1. [Blocking the merge, not the phase — documentation] `scripts/seed.ts:772-810`, the `seedGroupTypes()` docstring, was not rewritten, and this diff made one of its statements false.**

Phase 2 Ruling 7 and Phase 3 both named "the `/** ... */` block ending at the line immediately above `async function seedGroupTypes()`" as a required rewrite. The implementer correctly rewrote the **file header block** (`:52-71`, now a clean one-reason structure citing `drizzle/0051`) and the **inline comment inside the function body** (`:828-832`, correctly: "`presby_app` is SELECT-only on group_types (drizzle/0051, DECISION-151)"). Phase 3's own "i.e." clause conflated the two, so the miss is understandable — but the docstring above the function still carries three stale statements:

- `scripts/seed.ts:773` — "Platform-wide `group_types` templates (`organization_id IS NULL`)" — the column no longer exists.
- `scripts/seed.ts:790-799` — narrates `group_types_org_key unique nulls not distinct (organization_id, key)` as the current constraint; it is now `group_types_key_key unique (key)`.
- `scripts/seed.ts:802` — **actively false, and made false by this diff**: "`scripts/seed-dev.sql`'s own `group_types` insert uses `on conflict (organization_id, key) do nothing` against this exact constraint." This same commit changed that clause to `on conflict (key)`.

No behavior is affected and no verification above depends on how this is worded. But this is a comment-lies-about-the-schema defect in the seed writer, in the pipeline whose entire thesis is that such text must not drift — and a future reader following `:802` would write the wrong inference clause. It is a comment-only edit requiring no re-verification. Recommend the orchestrator route it to **database-admin** before the PR merges.

**2. [Minor] `scripts/test-rls.sql:5576`** — prose still reads "except the named 25"; the sentence two lines below correctly says "It is 26 since drizzle/0051". Both assertion constants and both message strings are correctly 26. Cosmetic; fold into Finding 1's edit if convenient.

**3. [Pre-existing, not this diff] Four e2e specs are rotten or waiting on main** — diagnosed in the End-to-End section. Two `post-login-routing.spec.ts` specs assert pre-`org_portal.home_v2` copy against a DB where that flag is on; `public-sites.spec.ts:334` (and its 5 serial dependents) needs main's `07801a2`. CI has not been catching these because the e2e job skips until the Neon secrets exist. Worth a `docs/TODO.md` line of their own — they are not this pipeline's to fix, but they are real.

**4. [Integration] The branch is four commits behind main** (PR #17 merged mid-flight). Merge main before integration; that also clears Finding 3's third item. Per Workflow Rule 16, integration stays serialized and `scripts/test-rls.sql` is re-run on the merged branch.

**5. [Confirmed, for Phase 6 / `docs/TODO.md`] The implementer's proposed TODO line is real and I reproduced its shape.** `scripts/seed.ts:841` is `console.log(\`seeded ${defs.length} platform-wide group_types\`)` — printed unconditionally from the array length, never from rows actually written. This is exactly what made Implementer Note 5's misdirected-seed trap invisible, and it is why I verified my own from-empty seed by `select count(*) from roles` rather than by the log line. Proposed line, adopted and recommended verbatim: *`scripts/seed.ts`'s `seedGroupTypes()` logs `seeded ${defs.length}` unconditionally, so the count is printed even when nothing was written; make it report rows actually inserted.* Out of scope here; deserves its own entry.

**6. [Observation, no action] `drizzle/0051` is not wrapped in an explicit transaction.** This is safe as written and I verified it rather than assuming: the only statement capable of failing is the pre-flight guard, and it is first; everything after it is `drop … if exists` / `no force` / `disable` / `drop constraint if exists` / `drop column if exists` / `revoke` / `grant`. Triple-apply confirms convergence. Worth knowing if a future statement is ever appended to this file *after* the guard.

**7. [Minor, immaterial] Phase 3's fixture-site attribution was slightly off** — `role-definitions.test.ts` had **one** `groupTypes` site, not three (the other two are `appRoles`). Immaterial, because the implementer correctly used `tsc` as the worklist generator rather than grep, which is also what makes the `actions.test.ts:342` exclusion mechanical rather than a promise.

## Verdict

**PASS**

Every required check is green, and every load-bearing claim was verified against the live catalog on the connection that matters rather than against the migration text or Phase 4's transcript: the catalog tuple, the grant model (`aclexplode`, both roles), the absence of policies and triggers, the refusing layer named correctly as the **grant**, the pre-flight guard's failing-first refusal with RLS left intact, whole-file idempotency across three applies, the F84 regression failing-then-passing on a re-granted/revoked scratch database with the restore proven by `aclexplode`, §43's redness at the grant assertion, the C-3 arrays at 26, the full DECISION-150 from-empty rehearsal at 526/exit 0, and the shared-file discipline hunk by hunk. Unit suite 4149/4149 with zero skips; RLS suite 526 on two independent databases and again after e2e fixtures landed. No protected routes touched; not auth-touching, so the stricter e2e/MFA gate does not apply — though the e2e suite ran against a real dev server anyway, with the target spec 5/5 and all four failures individually diagnosed as pre-existing or flaky.

Findings 1 and 2 are documentation-only and change no behavior, so they do not gate this phase — but Finding 1 leaves a statement in `scripts/seed.ts:802` that this very commit falsified, and I recommend it be corrected before the PR merges rather than deferred to Phase 6.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — live-catalog audit, all three failing-first proofs independently reproduced on a scratch DB, full from-empty rehearsal (526), shared-file hunks all authorized; 2 doc-only findings, 4 pre-existing e2e failures diagnosed | PASS | 2026-09-26 |

## Handoff

**Next agent: analyst (Phase 6).**

- Confirm the bug no longer manifests: a tenant can no longer mint a `group_types` row — closed by a grant, which binds unconditionally where the old policy bound only while it existed.
- **Carry Finding 1 into Phase 6** and decide whether it ships as a pre-merge fix (my recommendation) or a `SHIP WITH NOTES` follow-up. It is a comment-only edit in `scripts/seed.ts:772-810`, most precisely `:802`.
- **Finding 5** — the `seedGroupTypes()` logging defect — is confirmed real and needs a `docs/TODO.md` line at integration (orchestrator).
- **Finding 3** — the four rotten/blocked e2e specs — is not this pipeline's to fix but should get its own TODO line; CI's e2e job has been skipping, which is why they rotted unnoticed.
- **Finding 4** — merge main (four commits ahead) before integration; re-run `scripts/test-rls.sql` on the merged branch per Rule 16.
- Orchestrator integration items are unchanged from Phase 4's handoff: `_journal.json` idx 51, DECISION-151, F84–F86, the `docs/TODO.md` reconciliation.



---

### Orchestrator note (2026-09-26, after Phase 5)

QA Findings 1 and 2 (comment-only) fixed by the orchestrator before Phase 6, Trivial class: `scripts/seed.ts`'s `seedGroupTypes()` docstring rewritten to describe the 0051 catalog shape (`unique (key)`, `presby_app` SELECT-only, `seed-dev.sql`'s `on conflict (key)`); `scripts/test-rls.sql` §39.5 prose "except the named 25" → 26. Typecheck clean. Finding 5 (the unconditional `seeded N` log) and Finding 3 (four pre-existing e2e failures) become `docs/TODO.md` lines at integration.

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
