# Officer-Terms Administration — Work Log

> **Slug:** `2026-08-26-groups-and-officers`
> **Surface:** tenant admin only — `(org)/o/[slug]/admin/officers`, officer-term recording (session/diaconate elections, installations, roster + history)
> **Permission(s):** a new `officers.manage`-shaped key — Phase 3 to finalize exact name; architect's directional steer (Phase 2): bind to `stated_clerk`, per DECISION-078's constitutional-duty test
> **Flag(s):** `org_portal.officers`, seeded off — matches `org_portal.directory`/`org_portal.roles`'s precedent
> **Estimated complexity:** large — full CRUD over a trigger-materialized roster, F22-class risk on the new write path
> **Pipeline mode:** Full — narrowed from a combined two-gap Phase 1 at Phase 2 (architect, 2026-08-26). The org-provisioning baseline-role gap this pipeline originally also covered is split out to `docs/work-log/2026-08-26-org-provisioning-baseline-roles.md`; its Phase 1 material lives there now, not here.
> **Source — operator direction (2026-08-26):** "lets also plan groups and officers," originally scoped as one combined pipeline; architect's Phase 2 confirmed the analyst's recommended split into two work-log entries (see Phase 2 below for reasoning) rather than overruling it.

**Note on Phase 1 below:** retained unabridged from the original combined scoping pass, including the gap-2-specific slices (Flow 4, the gap-2 Permissions/Flags bullet, the FK-collision Gap, the `stated_clerk`-bootstrap Out-of-Scope note, the `app_roles`-template Open Question) — those now apply to the sibling file `docs/work-log/2026-08-26-org-provisioning-baseline-roles.md`, not this one, per the Phase 2 ruling below. Kept here as the historical record of the combined analysis rather than edited down.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-26 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete (all 3 commits — database-admin, api-developer, ux-developer) | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

Both gaps are real, both are describable concretely, and neither is blocked on undesigned schema — but flagging, as a note rather than a blocker, that Phase 2 should split this into two separate work-log entries before Phase 3 begins (see "On the one-pipeline-or-two question" below). Also flagging one sub-piece of gap 2 (the `stated_clerk`-equivalent bootstrap) as **structurally larger than "seed some rows"** — it collides with a real FK and may not be closeable inside `createOrganization()`'s current input shape at all. Load-bearing for whichever phase picks this up next.

## ONE-LINE TAKE

> Gap 1 (officer-terms admin UI) is a well-precedented CRUD screen over an already-correct, already-F22-fixed write path — the real risk is a *new* surface reintroducing F22's bug class through a different door (silent deletes, a raw upsert that bypasses the trigger) rather than the schema itself; gap 2 splits cleanly into a trivial mechanical fix (seed `member`/`directory.view`/Active Membership — no new input, no UI) and a genuinely unsolved bootstrap problem (there is no in-app path, today, for anyone to grant the *first* tenant role at any real (non-fixture) organization, and the schema's own FK makes "just seed it in the same transaction as org creation" impossible without also inventing person/membership creation).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding the new officer permission (tenant admin) | Record a new officer term: pick a person (scoped to this org's own memberships), pick an office, set `starts_on` (+ optional `elected_on`/`installed_on`/`class_year`/`minute_reference`), and — only when office = `deacon` — assign an `org_unit`/district | On demand; clustered around annual elections/installations |
| Same surface | End an existing term: set `ends_on` (+ `end_reason`: completed/resigned/removed/deceased) on the existing row — never delete a settled term | On demand, per resignation/death/rotation |
| Same surface | View the current roster (Session, Board of Deacons, and non-materialized offices like clerk of session/moderator/treasurer/trustee) and a given person's full officer history | On demand |
| Platform admin | Create an organization at `/admin/organizations/new` (existing flow) | One-time per org |
| Platform admin (proposed, see gap below) | Bootstrap the first tenant role at an organization that currently has zero `role_grants.manage` holders, naming an existing person at that org | Rare — once per org, only until someone holds the role |
| *(no end-user verb — pure backend)* | `createOrganization()` seeds a `member` app_role bound to `directory.view`, granted to the new org's `active_membership` group, in the same transaction as the F16 group seed | Automatic, every org creation |

The request as written says "the user" for officer-term recording without naming a surface. Resolving it to **a new tenant permission**, not reusing `stated_clerk` wholesale (see Permissions & Flags — needs an explicit Phase 3 ruling; the role-catalog pipeline already warned against defaulting new capability onto `stated_clerk`).

## Flows

**Flow 1 — Record a new officer term:** entry `/o/<slug>/admin/officers` → "Add officer term" → form (person `<select>` scoped through `memberships`, never a bare `people` scan — the F21 shape reapplied; office `<select>`; `starts_on`; optional `elected_on`/`installed_on`/`class_year`/`minute_reference`; an `org_unit` `<select>` that only renders when office = `deacon`, matching the `officer_terms_org_unit_deacon_check` constraint) → submit → server validates the person and org_unit both belong to this org → insert → `officer_terms_sync_derived` trigger materializes a `group_memberships` row **only** when office ∈ {`ruling_elder`, `deacon`} → success: term appears in the roster, toast confirmation.
- Failure: an overlapping open term for the same person/office (the `officer_terms_no_overlap` GIST exclusion constraint) throws a Postgres `exclusion_violation` — must be mapped to specific copy ("X already has an open term as Y — end it first"), not surfaced raw, the same discipline `isUniqueViolation()` gets for `23505` elsewhere. Missing `org_unit` on a deacon term, or a non-null `org_unit` on any other office, caught client-side before the DB check constraint. Person not a member of this org → forbidden/invalid_input. DB/network failure → generic "couldn't save that — try again" copy, never a stack trace.

**Flow 2 — End an officer term:** entry: roster row → "End term" → confirm dialog naming the person and office (mirroring `revoke-dialog.tsx`'s specificity) → set `ends_on`/`end_reason` → submit → the same trigger propagates `ends_on` into the person's `group_memberships` row → Session/Diaconate access (and anything the resolver grants through that group) drops the day the term does, automatically — already-built behavior, not something the new UI implements.
- Failure: `ends_on` before `starts_on` → inline validation. DB failure → generic copy.

**Flow 3 — View a person's officer history:** entry: roster page → click a person → `presby_officer_history()` output (office, dates, `end_reason`, years served).
- Failure/empty: a brand-new person with no terms → "No officer history recorded" (not a blank table).

**Flow 4 — Provision an organization with a working baseline (gap 2):** entry `/admin/organizations/new` (existing) → platform admin fills name/slug/type/status → submit → `createOrganization()`'s one transaction gains a new step: seed a `member` `app_role` (constitutional, protected) bound to `directory.view`, granted via `role_grants` to the just-created `active_membership` group — mechanical, no new admin input required, mirrors the F16 group-seed pattern exactly.
- Failure: existing branches (`slug_taken`/`reserved_slug`/`provisioning_incomplete`) unchanged.
- **The `stated_clerk`-equivalent half does not fit this flow as a same-transaction step.** `role_grants_person_fk` requires a `memberships` row to already exist at `(person_id, organization_id)` — a brand-new org has zero people and zero memberships at the instant it's created, so there is no person to grant a direct role to yet. "Seed the baseline roles at provisioning" cannot, as literally stated, close this half without also inventing person/membership creation inside org creation, which is a materially bigger feature (arguably `docs/STATE.md`'s already-queued **P2 — backbone and onboarding**, not this pipeline).

## Permissions & Flags

- **Gap 1 (officer terms):** a **new** permission key is needed — Phase 3 must name it (candidate: `officers.manage`, module `officers`, tier 1 — the roster itself is public-register information, not tier 2/3). **Open question, not resolved here:** bind it to the existing `stated_clerk` role, or mint a new one? PC(USA) practice makes Stated Clerk a defensible real-world fit (keeper of session's official records, G-3.0204(b)), but the role-catalog pipeline (`docs/work-log/2026-08-20-role-catalog.md`) explicitly warned that every new capability landing on `stated_clerk` risks it becoming a wildcard admin role one layer down — this is exactly that pattern recurring. **A naming trap regardless of the answer:** `officer_terms.office` already has a literal value `'clerk_of_session'` — if Phase 3 mints a *new* role, it must not be named identically to that office string. The two are structurally unlinked (recording someone as `clerk_of_session` in `officer_terms` does **not** automatically grant them `stated_clerk`/`role_grants.manage` — two separate write paths with no trigger between them), and a same-named role would strongly imply an automatic link that doesn't exist.
- **Default roles:** TBD by Phase 3 per the above; whichever role is chosen, this is the office/role the "founding administrator" bootstrap problem ultimately needs to reach.
- **Flag:** `org_portal.officers`, seeded off — matches `org_portal.directory`/`org_portal.roles`'s precedent exactly (a toggle, checked bare, never a substitute for the permission gate).
- **Gap 2:** the `member`/`directory.view`/Active-Membership seed needs **no new permission and no flag** — unconditional provisioning logic, same as F16's group seed. The `stated_clerk`-equivalent bootstrap, if built as a platform-admin escape hatch, is itself security-sensitive and should be gated on the existing `FEATURES.ADMIN_ORGANIZATIONS` platform permission (already the gate on org creation) — not a new flag, since it's a rare, deliberate platform action, not a rollout.

## Gaps the Request Didn't Address

- **The FK collision above.** "Seed baseline roles at provisioning" reads as a small backend fix; half of it (`member`) is, half of it (`stated_clerk`) cannot be done inside `createOrganization()`'s current shape without a person/membership to grant to. Phase 3 needs an explicit ruling: defer the `stated_clerk` half to P2/onboarding entirely (ship the `member` half now, track the rest), or build a narrowly-scoped platform-admin "grant the first tenant role" action (on the existing `/admin/organizations/[id]` page) usable only when the target org currently has zero holders of the officer/role-grants-managing permission, naming an already-existing person+membership at that org. **Without one of these, every future non-fixture organization inherits the exact bootstrap gap `fpcw` hit in dev** — not just for officers, but for the entire `/o/<slug>/admin/roles` surface, since nobody at a freshly provisioned org can ever grant anyone else a role through the app today.
- **`officer_terms.office = 'clerk_of_session'` and the `stated_clerk` app_role are two unlinked systems.** Recording someone as clerk of session via the new UI does not grant them `role_grants.manage` (or whatever officer permission Phase 3 names); granting `stated_clerk` does not create an `officer_terms` row. A real clerk transition today (or after this ships) requires two separate, unlinked admin actions in two different places. Worth naming explicitly in the UI copy ("this records who holds the office; granting platform access is done separately at Administration → Roles") rather than leaving it implicit.
- **`group_memberships.officer_term_id` is documented as an *unconstrained* FK** (`drizzle/0017`'s own comment: a pre-existing, unconstrained gap, flagged for a future database-admin review, not fixed here). A new UI that allows **deleting** an `officer_terms` row (as opposed to ending it via `ends_on`, which the schema already models as mutable) would leave an orphaned `group_memberships` row behind with no trigger to clean it up — a person could remain on the Session roster (and keep whatever `role_grants` that group carries) forever, with no corresponding term. Same invariant family F22 already broke once. **Recommend the admin UI exposes only "start" and "end" — never delete** — and flag the unconstrained FK itself as a standing database-admin follow-up regardless of what this pipeline ships.
- **A regression test replicating F22's exact scenario must be written against the new write path, not just re-cited from the trigger's existing test.** The trigger fix is proven at the SQL/fixture layer (`scripts/test-rls.sql`); this pipeline is the first *application* surface writing new `officer_terms` rows through arbitrary user input. Phase 4's acceptance criteria should include: same person, same office, two non-consecutive terms recorded through the actual UI/action layer, confirm both terms retain independent `ends_on` and independent `group_memberships` rows.
- **Empty state.** A brand-new org (once gap 2's `member` seed ships) has Session/Diaconate/Active-Membership groups but zero `officer_terms` rows. `/o/<slug>/admin/officers` needs an explicit "No officers recorded yet — add the first one" state, not a blank table.
- **Audit story.** CLAUDE.md names role/permission/flag/2FA/deactivation changes as audit-worthy. Officer-term writes aren't literally `role_grants` rows, but starting or ending a Session/Diaconate term **is** a de facto access change (it flows through the derived group into whatever that group's `role_grants` carry) — the request didn't mention this. Recommend new `AUDIT_ACTIONS` keys (`OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED`) mirroring `TENANT_ROLE_GRANTED`/`REVOKED`'s shape.
- **`minute_reference` as the only paper trail.** Nothing in the schema verifies an election/installation actually happened — same trust model as `roll.approve`. The UI should at minimum encourage (not necessarily require) `minute_reference` on every write, since it's the sole audit-by-eye evidence a clerk or a future reviewer has.
- **Mobile.** Roster/history views are wide-column (office, person, dates, class year, org_unit) — same 360px concern the tenant-administration pipeline already solved with a `Table`, not cards. Name it now rather than discover it in Phase 6.

## Out of Scope (confirm with user)

- Building the `stated_clerk`-bootstrap escape hatch's actual UI is a real design decision, potentially large enough to be its own follow-up pipeline rather than a sub-task of this one (see verdict notes).
- General "managed" (non-court) group/committee membership CRUD — nothing in the original request asks for it, and it's a distinct write path (`group_memberships` rows with no `officer_term_id`, `source != 'derived'`) that this pipeline's scope doesn't touch. See the addendum below — it's adjacent to, but not the same as, officer-terms recording.
- A tenant-facing audit reader for the new `OFFICER_TERM_*` events (same deferred-reader posture DECISION-067 already established for `TENANT_ROLE_*` — the write path ships, the reader doesn't).
- Six-year-rule (`presby_officer_history()`'s aggregate-service warning) surfaced in the UI — the function exists; whether the admin screen renders a warning banner is a Phase 3 nice-to-have, not core to "record who holds office."

## Open Questions

- Should `officers.manage` (or whatever key Phase 3 names) bind to `stated_clerk`, or is this the moment to mint a distinct office/role — and if so, what should it be called given the `clerk_of_session` naming collision above?
- Is the `stated_clerk`-equivalent bootstrap in scope for this pipeline at all, or should it be explicitly handed to P2 (backbone and onboarding), with this pipeline shipping only the mechanical `member`/`directory.view` half?
- `app_roles.organizationTypeScope`/`organizationId IS NULL` "template" columns already exist in the schema (`drizzle/0008`) with a comment reading "seed template applied to every org of organizationTypeScope" — **but no code anywhere reads them**; F16's own group seed didn't use this mechanism either, it hardcodes a plan inline. Should Phase 3 finally wire this dormant template mechanism for baseline-role seeding, or continue the established inline-plan pattern and leave the template columns dormant? Architect/tech-lead call, not analyst's.
- Does the officer-terms form need to validate `installed_on`/`elected_on` ordering against each other or against `starts_on`, or are these three independently operator-entered with no cross-validation (matching how loosely the schema itself treats them — only `starts_on` is authoritative)?

## On the one-pipeline-or-two question

Recommendation: **keep Phase 1 combined (already done, per operator direction), but split at Phase 2 into two separate work-log entries for Phase 3 onward**, sequenced with the provisioning fix first. Reasoning:

1. **The dependency is real but one-directional and coarse.** Officer-term recording is only "unusable at a freshly provisioned org" in the sense that nobody there holds any permission at all yet — but that's already solvable today the same way `stated_clerk` and the officer-managing role were both solved for *existing* orgs: fixture-seeding. Gap 1's own design/build/test cycle does not need gap 2 shipped first; it needs a role to bind to, which fixtures can provide in the interim exactly as they already do for `stated_clerk`.
2. **Different risk profiles, different implementers.** Gap 1 is materialized-roster/trigger-adjacent (database-admin + api-developer + ux-developer, full CRUD, F22-class risk). Gap 2 is org-creation transaction plumbing (database-admin/api-developer only, FK/bootstrap risk) — and its harder half may not even belong in this pipeline's implementer set at all.
3. **Combining them risks exactly the kind of unwieldy, hard-to-review Phase 3 doc this codebase's own conventions avoid** — every recent pipeline here ships one clear write path per work-log.
4. **Gap 2 is already its own named line in `docs/TODO.md`** ("Org provisioning seeds derived groups but no baseline roles ... Needs its own pipeline") — treating it as its own work-log honors that line directly rather than merging it into a larger, differently-scoped entry.

If the operator still wants one combined Phase 3+ pipeline after reading this, that's a legitimate call — but should be a deliberate re-confirmation at Phase 2, not something Phase 1 quietly waves through.

## Addendum — Public Committees Page: Dynamic Group-Data Binding

**Question posed:** should the public site's Committees page (currently hand-authored static `blocks` content — a `hero`, `prose` blocks per committee, `staffList` blocks naming members) be made to render live from presby's own `groups`/`group_memberships` data instead, as part of this pipeline?

**Answer: out of scope for this pipeline, and recommend not folding it in even at Phase 3.**

- **It depends on two things neither gap in this pipeline builds.** First, a generic "managed" group/committee admin CRUD — creating a committee as an ordinary `groups` row (`membership_source = 'managed'`, correctly **not** subject to "The Court Is Not a Group," since that invariant is scoped to the two derived courts) and adding/removing people via plain `group_memberships` rows (no `officer_term_id`, `source != 'derived'`). That surface doesn't exist today and isn't named in the operator's scope for this pipeline — officer-terms recording is specifically about `officer_terms` → the two materialized courts, a different table and a different write path from "who's on the Communications Committee." Second, the public-site rendering side: how a `blocks` entry gets resolved today (static JSON per site) versus a live-data variant is entirely `P3`'s (site model + renderer) territory, which this pipeline's two gaps never touch (`(public)/site/<slug>` isn't in scope here).
- **`docs/STATE.md` already reserves this exact idea as its own future pipeline** — `P7 — data-bound blocks`, queued *after* P3 (site model + renderer), P4 (site editor), P5 (custom domains), and P6 (cron agent), none of which have shipped yet. STATE.md's own discipline ("every one needs its own Phase 1; 'the architect already ruled' is not a substitute") argues directly against pulling P7's job forward into a pipeline scoped around officer terms and role seeding.
- **Recommendation: name it as a documented future increment, not a flow in this pipeline's Phase 3.** Once a generic managed-group CRUD exists (a plausible *sibling* follow-up to officer-terms recording, since both write into `groups`/`group_memberships`, just non-derived rows) and once P7 exists to define how the renderer consumes live data at all, the Committees page becomes a natural, well-motivated P7 candidate — a congregation's real committee membership feeding both the internal admin view and the public site from one source of truth, instead of a developer hand-editing a JSON blob every time membership changes. Worth remembering, but not this pipeline's to build.

## Handoff

**Next: architect (Phase 2).** Carry forward: the FK-collision finding on the `stated_clerk` bootstrap (the single highest-value thing for Phase 2 to rule on — it determines whether gap 2 is even fully closeable by this pipeline); the recommendation to split into two work-log entries, sequenced provisioning-first; the `clerk_of_session`-office vs. role-naming trap; the unconstrained `officer_term_id` FK and the "no delete, only end" recommendation; and the Committees-page addendum's out-of-scope ruling (so it isn't silently re-litigated as in-scope at Phase 3). All Gaps above are non-negotiable acceptance-criteria candidates for whichever Phase 3 design(s) follow, not optional polish.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

## Ruling on the split — Confirmed

The analyst's recommendation to split this pipeline in two is confirmed, not overruled, after independently verifying `src/lib/org-provisioning.ts`, `src/lib/db/domain/authz.ts`, and `(org)/o/[slug]/admin/members/page.tsx` directly. Gap 1 (officer-terms UI) and the closeable half of gap 2 (`member`/`directory.view` seeding) are different *kinds* of change — gap 1 is new permission + new flag + trigger-adjacent CRUD UI; the closeable half of gap 2 is a small addition to an already-transactional function with no new permission, no new flag, no schema change. Combining them would force one Phase 3 doc to carry two unrelated review lenses.

**What happens next:** two files. This one, narrowed to **gap 1 only** (officer-terms admin UI). A new sibling, `docs/work-log/2026-08-26-org-provisioning-baseline-roles.md`, covering **gap 2 only**, with its own completed Phase 1 (carried forward) and Phase 2 (the architect ruled directly on the FK-collision and templating questions rather than deferring them). No hard sequencing dependency either direction — gap 1 doesn't need gap 2 to ship first (it binds its permission via fixture/seed exactly as `stated_clerk`/`treasurer`/`installed_pastor` already do). Recommend gap 2 ships first anyway on cost/benefit: same-day, single-file, no-schema fix that closes a real gap `fpcw` hit in dev, at near-zero risk.

## Ruling on the FK collision — deferred wholesale to P2, no narrow escape hatch either

Traced the analyst's proposed escape hatch (a narrow platform-admin "grant the first tenant role" action, usable when an org has zero `role_grants.manage` holders, naming an already-existing person+membership) and it does not survive: `/o/[slug]/admin/members` — the only in-app path to create the first person+membership at a real org — is itself gated on `people.manage`, which nobody holds at a genuinely fresh org either. The premise "naming an already-existing person" has no referent for the case this hatch exists to fix. Building it now would mean either shipping a hatch that doesn't close the real gap, or quietly also building person/membership creation inside it — which is the already-queued **P2 (backbone and onboarding)**'s scope, not a side door. Ruling: the entire `stated_clerk`-equivalent bootstrap (role AND the person/membership creation it depends on) is deferred wholesale to P2. Full reasoning and the resolved `role_grants` group-arm-vs-person-arm mechanics are recorded in **DECISION-100** and in the sibling file's own Phase 2.

## Ruling on permission naming — directional steer: lean `stated_clerk`, subject to DECISION-078's test

Officer-term recording — the official record of who serves as ruling elder/deacon/clerk/treasurer and when, materializing the Session/Diaconate rosters — sits squarely within G-3.0204(b)'s clerk-of-session record-keeping duty. Per DECISION-078's standing test (constitutional duty of the office, or just the only empowered role that happens to exist?), this is a real fit, arguably tighter than `roll.propose` which already passed the same test. Steer: lean `stated_clerk`, and Phase 3 should say so explicitly using DECISION-078's own language rather than defaulting silently. If Phase 3 instead prefers a distinct role to keep `stated_clerk`'s grant count down, that's legitimate too, but should name why the constitutional-duty fit isn't dispositive. Either way, the `clerk_of_session`-office-string vs. role-key naming trap stands as a hard constraint.

## Ruling on the Committees-page addendum — confirmed out of scope, deferred to P7

Checked `docs/STATE.md`'s pipeline queue directly: P7 (data-bound blocks) sits behind P3–P6, none shipped. The analyst's reasoning holds (two unbuilt prerequisites: generic managed-group/committee CRUD, and P3's block-rendering model) and STATE.md's own discipline argues against pulling P7 forward into a pipeline scoped around officer terms. Confirmed, not overruled. Do not re-open at Phase 3.

## Placement

- **Directory placement:** no new top-level directories. New route: `(org)/o/[slug]/admin/officers/` (page + `actions.ts`), mirroring the existing `(org)/o/[slug]/admin/members/` and `(org)/o/[slug]/admin/roles/` shape exactly. No new file under `src/lib/db/domain/` — `officer_terms`/`org_units`/the derived-group trigger already exist (F3, F22). New query-layer module: `src/lib/officers.ts`, sibling to `src/lib/people.ts`/`src/lib/roll.ts`, same `withOrgContext()` shape DECISION-096 established.
- **Server vs. Client split:** roster/history views are Server Components by default (read-only, `presby_officer_history()` output). `'use client'` only for the "Add officer term"/"End term" forms — same shape as `members-list.tsx`'s existing split. "End term" must be a shadcn `AlertDialog` (Workflow Rule 2) mirroring `revoke-dialog.tsx` — no native `confirm()`.
- **Dependencies:** none new. `react-hook-form`+`zod` already approved (DECISION-096); this form clears the same field-count threshold `docs/ui-standards.md` sets for that pattern.

## Invariants Touched

- **The Court Is Not a Group** — respected: the new write path is `officer_terms` only; `group_memberships` stays trigger-materialized, never directly written by the new UI. Confirmed by reading `presby_sync_derived_group()` directly — only `office ∈ {ruling_elder, deacon}` projects; other offices are safe no-ops.
- **Permissions vs. Flags** — `officers.manage` (permission) and `org_portal.officers` (flag) are two independent gates; Phase 4's route/action must check both, never treat the flag as a permission substitute.
- **No Role Carries a Wildcard** — the officer permission binds to one office, tier 1 — no wildcard risk.
- **F22's bug class** — real risk, confirmed by reading `officer_terms_no_overlap` (GIST exclusion) and `officer_terms_org_unit_deacon_check` directly — both exist and are correctly load-bearing. The new UI's job is to map their violations to copy, never to route around them with application-side check-then-write logic that reopens the race window the DB constraints already close.
- **Composite Tenant Keys** — person/`org_unit` `<select>`s must be scoped through `memberships`/`org_units` at this org only (F21 shape) — confirmed correct pattern.

## Notes

1. **No delete, ever — start/end only.** `group_memberships.officer_term_id` is an unconstrained FK (`drizzle/0017`'s own comment, confirmed). The UI exposes exactly two mutations (start, end via `ends_on`/`end_reason`) and never a delete on a settled row. Flag the unconstrained FK as a standing database-admin follow-up in `docs/TODO.md` at whichever commit ships this.
2. **F22 regression test at the application layer, named as a Phase 4 gate**, not optional: same person, same office, two non-consecutive terms, through the actual server action.
3. **Exclusion/check-constraint mapping is a Phase 3 API-contract detail**, not left to Phase 4 to improvise — map Postgres `exclusion_violation` to specific copy, matching `isUniqueViolation()`'s existing `23505` discipline elsewhere.
4. **Audit:** new `AUDIT_ACTIONS` keys (`OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED`), mirroring `TENANT_ROLE_GRANTED`/`REVOKED`'s shape.
5. **Permission binding:** run DECISION-078's test explicitly per the steer above; don't name a new role identically to the `officer_terms.office = 'clerk_of_session'` literal.
6. **Mobile:** `Table`, not cards, for roster/history views.
7. **No sibling dependency** — this pipeline does not need `2026-08-26-org-provisioning-baseline-roles` to ship first.

## Implementer(s) Phase 3 should expect

Three-commit split, matching this codebase's precedent for large, trigger-adjacent, multi-layer work:
1. **database-admin** — the `officers.manage`-shaped permission-catalog row (migration-seeded, DECISION-063's precedent), fixture `role_grants`/`officer_terms` rows proving it end to end, `scripts/test-rls.sql` additions.
2. **api-developer** — `src/lib/officers.ts`, `(org)/o/[slug]/admin/officers/actions.ts` (exclusion/check-constraint mapping, audit events).
3. **ux-developer** — roster/history pages, add/end-term forms, empty state, mobile table treatment.

Final commit-boundary call is tech-lead's, per pipeline norm.

## Handoff

**Next: tech-lead (Phase 3), for gap 1 only.** Carry forward: the F22-class regression-test requirement, the exclusion/check-constraint copy-mapping requirement, the no-delete rule, the `stated_clerk`-binding directional steer (with DECISION-078's test named explicitly), the audit-key names, and the Committees-page out-of-scope confirmation. Do not re-litigate the split or the FK-collision ruling — both are closed by this Phase 2 pass and by the sibling file's own Phase 2.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We are building `/o/<slug>/admin/officers`, the tenant admin surface for recording who
holds ordained/administrative office at a congregation — starting and ending
`officer_terms` rows for Session (ruling elder), the Board of Deacons (deacon),
and the non-materialized offices (clerk of session, moderator, treasurer,
trustee) — plus read views of the current roster and any one person's full
officer history. This is the first application write path onto `officer_terms`;
the table, its GIST no-overlap exclusion constraint, its deacon/`org_unit`
check constraint, and the `officer_terms_sync_derived` trigger that projects
`ruling_elder`/`deacon` terms into the Session/Diaconate `group_memberships`
rows all already exist and are already F22-fixed (keyed on `officer_term_id`,
one derived row per term). The job here is a CRUD UI that respects that
write path exactly — never a raw `group_memberships` write, never a delete on
a settled term — and maps the two DB-level failure modes the new input
surface can actually trigger to specific, non-technical copy.

## Permissions & Flags

**Permission key: `officers.manage`** (module `officers`, tier 1 — the roster
is public-register information per G-3.0204(b), not tier 2/3 pastoral or
financial data). One key gates the *entire* surface — read (roster + history)
and both mutations (start term, end term) — exactly as `role_grants.manage`
gates the entirety of `/o/<slug>/admin/roles` today. There is no separate
`officers.view`: a congregation small enough to run this system does not need
a read-only spectator role for its own officer register, and inventing one
here would be scope `docs/TODO.md` never asked for.

**Role binding: `stated_clerk`, applying DECISION-078's test explicitly, in
this doc's own words.** DECISION-078 asks, for anything proposed against
`stated_clerk`: does this belong to the Clerk of Session's actual
constitutional job, or is `stated_clerk` just the only administratively-
empowered office that happens to exist in the fixture? Officer-term recording
is not merely adjacent to that job — maintaining the record of who serves as
ruling elder, deacon, clerk, moderator, treasurer, and trustee, and when, *is*
the register G-3.0204(b) requires the Clerk of Session to keep. `roll.propose`
already passed this test on a looser fit (drafting a roll action is part of
the same record-keeping duty, one step removed from the register itself);
`officers.manage` is the register itself. This passes tighter than
`roll.propose` did, so the lean is followed rather than second-guessed: no new
role is minted. Mechanically this is a new `app_role_permissions` row binding
`officers.manage` to the existing `stated_clerk` `app_roles` row
(`f0000000-0000-0000-0000-000000000005` in the fixture) — no new `role_grants`
row is needed, because Tobias Renwick's existing direct `stated_clerk` grant
already carries the new permission for free, the same "no new grant row"
outcome DECISION-072's `tickets.file` binding and `roll.propose`/
`people.manage`'s bindings already established.

**The naming trap, restated for the record even though it does not bite this
binding:** because no new role is minted, there is no new role-key collision
risk to check here. It stands as a hard constraint on any FUTURE reconsideration
of this binding: if a later pipeline ever concludes `officers.manage` should
live on a distinct role instead of `stated_clerk`, that role must not be named
`clerk_of_session` (or any variant of it) — `officer_terms.office =
'clerk_of_session'` is a data value recording who holds an ecclesiastical
office, `stated_clerk` (or any future distinct role) is a software grant, and
the two systems are unlinked by design (recording someone as `clerk_of_session`
in `officer_terms` does not itself grant `officers.manage`, `role_grants.manage`,
or anything else). The admin UI's own copy says this explicitly (see Component
Plan) so an operator doesn't infer an automatic link that isn't there.

**Flag: `org_portal.officers`**, seeded `enabled: false` in `scripts/seed.ts`,
mirroring `org_portal.roles`'s exact block (checked bare, no DECISION-026
fail-open wrapper — a toggle, not an auth path; never substitutes for
`officers.manage` — a stated clerk with the flag on and no grant still sees
the in-shell "you don't have permission" state, not the page itself,
DECISION-003).

## API Contract

New query/mutation module `src/lib/officers.ts`, same shape `src/lib/role-
grants.ts` established (DECISION-096): one `withOrgContext()` transaction per
exported function, the `officers.manage` gate checked first inside every one
of them (mirroring `hasRoleGrantsManage`'s placement precisely — this is the
whole reason DECISION-066 exists, and the same authorization-bypass risk
`role-grants.ts`'s own header documents applies here unchanged), typed result
variants for every expected/denied outcome, thrown exceptions reserved for
genuine failure (`OrgAccessError`, a malformed call).

```ts
export type OfficerOffice =
  | "ruling_elder" | "deacon" | "clerk_of_session"
  | "moderator" | "treasurer" | "trustee";

export interface OfficerRosterEntry {
  termId: string;
  personId: string;
  displayName: string;
  office: OfficerOffice;
  classYear: number | null;
  startsOn: string;
  endsOn: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
}

export interface OfficerHistoryEntry {
  termId: string;
  office: OfficerOffice;
  classYear: number | null;
  startsOn: string;
  endsOn: string | null;
  endReason: string | null;
  yearsServed: number;
}

export interface OfficerFormOptions {
  people: { personId: string; displayName: string }[];
  orgUnits: { orgUnitId: string; name: string }[];
}

export type OfficersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "overlap"; personName: string; officeLabel: string };

export async function listOfficerRoster(
  viewerPersonId: string, organizationId: string, office?: OfficerOffice,
): Promise<OfficersResult<OfficerRosterEntry[]>>;

export async function getOfficerHistory(
  viewerPersonId: string, organizationId: string, personId: string,
): Promise<OfficersResult<OfficerHistoryEntry[]>>;

export async function getOfficerFormOptions(
  viewerPersonId: string, organizationId: string,
): Promise<OfficersResult<OfficerFormOptions>>;

export async function startOfficerTerm(
  viewerPersonId: string, organizationId: string, actingUserId: string,
  input: {
    personId: string; office: OfficerOffice; startsOn: string;
    electedOn?: string; installedOn?: string; classYear?: number;
    minuteReference?: string; orgUnitId?: string; // required iff office === "deacon"
  },
): Promise<OfficersResult<{ termId: string }>>;

export async function endOfficerTerm(
  viewerPersonId: string, organizationId: string,
  input: { termId: string; endsOn: string; endReason: string },
): Promise<OfficersResult<{ termId: string }>>;
```

`listOfficerRoster`/`getOfficerHistory` call `presby_officer_roster()` /
`presby_officer_history()` (both already exist, `drizzle/0009_presby_rls.sql`)
via `tx.execute(sql\`select * from ...\`)`, the same pattern `effectivePermissions()`
uses in `src/lib/authz.ts` — never hand-reimplemented as a Drizzle join, since
the SQL functions already encode "current" vs "as of a date" correctly.
`getOfficerFormOptions`'s person list is a `memberships` JOIN `people` scoped
to `(organizationId, ended_on is null)` — the identical F21 shape
`getGrantFormOptions` uses, never a bare `people` scan. Its `org_units` list
is a plain `where organization_id = ...` read (the table carries no further
tenant-scoping concern beyond that).

**Server actions**, `(org)/o/[slug]/admin/officers/actions.ts`, mirroring
`admin/roles/actions.ts`'s `resolveActingIdentity()` helper verbatim
(re-resolves `organizationId` from the URL `slug` inside the caller's own
membership set via `resolveOrgContext()` — `organizationId` never comes from
client-supplied form data):

```ts
async function startOfficerTermAction(
  slug: string,
  input: Parameters<typeof startOfficerTerm>[3],
): Promise<ActionResult<{ termId: string }>>;

async function endOfficerTermAction(
  slug: string,
  input: { termId: string; endsOn: string; endReason: string },
): Promise<ActionResult<{ termId: string }>>;
```

**Error-mapping discipline (API contract detail, not left to Phase 4 to
improvise):**

| DB signal | Where caught | User-facing copy |
|---|---|---|
| `officer_terms_no_overlap` (GIST exclusion, Postgres code `23P01`) on the INSERT inside `startOfficerTerm` | `src/lib/officers.ts`, wrapping the insert in try/catch, tested against a new `isExclusionViolation(err)` helper added to `src/lib/db/errors.ts` sibling to `isUniqueViolation()` (same one-level `.cause` check plus an English-message fallback, per that file's own documented discipline) | `"{personName} already has an open term as {officeLabel} — end it first."` — `personName`/`officeLabel` come from the already-validated input (the person was already resolved via the `memberships` JOIN above the insert), not a second query after the failure |
| `officer_terms_org_unit_deacon_check` (CHECK constraint) | **Never reaches the database in normal operation.** Client-side: the add-term form's `zod` schema requires `orgUnitId` iff `office === "deacon"` and forbids it otherwise (Flow 1). Server-side, defense in depth: `startOfficerTerm` re-checks the identical rule *before* attempting the insert and returns `{ kind: "invalid_input", message: "... " }` — the same "validate, then write" order `role-grants.ts` uses for its own org/role/target checks, so the check constraint is a backstop that should never actually fire, not the primary UX |
| Person not a current member of this org | `getOfficerFormOptions`'s own scoped `memberships` JOIN never lists them; if a stale client submits an id anyway, `startOfficerTerm` re-validates and returns `{ kind: "invalid_target" }` | `"That person doesn't have a current membership at this organization."` (verbatim precedent, `admin/roles/actions.ts`'s `invalid_target` branch) |
| `endsOn` before `startsOn` | Client-side zod on the end-term dialog | inline validation error, no submission |
| Any other DB/network failure | Re-thrown from `officers.ts`, uncaught by the action (same "thrown = genuine failure" contract `role-grants.ts` documents) | Next's generic server-action error surfaces; the action's own catch-all (if one exists per `ActionResult` convention elsewhere) returns `"Couldn't save that — try again."`, never a stack trace |

## Data Model

No schema changes to any table, column, index, or constraint —
`officer_terms`, `org_units`, `officer_terms_no_overlap`,
`officer_terms_org_unit_deacon_check`, and `officer_terms_sync_derived` all
already exist and are already correct (F3, F22). The one migration this
pipeline adds is a **catalog insert, not a schema change**: a new row in the
existing `permissions` table (`officers.manage`, module `officers`, tier 1),
migration-seeded per DECISION-063's precedent
(`drizzle/0017_presby_membership_roster.sql` / `0018_presby_role_
administration.sql`'s identical form) — `permissions` carries no
`organization_id` and needs no organization to exist first, so it is seeded in
the migration itself, not `scripts/seed.ts`. The `stated_clerk` binding
(`app_role_permissions`) and the flag row (`feature_flags`) are fixture/seed-
script inserts, not migrations, matching every prior permission binding in
this codebase (`role_grants.manage`, `roll.propose`, `tickets.file`,
`directory.view_hidden` — none of them added a `role_grants` row either, for
the same "existing grant already carries the new permission" reason).

## Component / Page Plan

**Pages to create:**
- `(org)/o/[slug]/admin/officers/page.tsx` — Server Component. Repeats the
  `(org)` auth pattern in full (`cachedAuth()` → `resolveOrgContext()` →
  switch on `kind`), same as `admin/roles/page.tsx`. **The flag check
  (`isFlagEnabled("org_portal.officers")`) runs before `listOfficerRoster()`/
  `getOfficerFormOptions()` are ever called** — identical ordering rationale
  to `roles/page.tsx`'s own header comment (don't pay for a permission-
  resolver round trip a flag-off congregation will throw away). Renders the
  roster `Table`, the "Add officer term" form below it, and a link per roster
  row to that person's history page. Explicit copy near the form: *"This
  records who holds the office. Granting software access (Administration →
  Roles) is done separately."* — closing the two-unlinked-systems gap named
  in Phase 1.
- `(org)/o/[slug]/admin/officers/[personId]/page.tsx` — Server Component,
  mirroring `admin/members/[id]/page.tsx`'s existence as a per-person detail
  route. Renders `getOfficerHistory()`'s output as a `Table` (Flow 3).

**Components to create:**
- `officer-roster.tsx` — `Table`, columns Office / Person / Class year /
  Since / Ends / District (only rendered when any row has one) / Actions.
  Empty state: *"No officers recorded yet — add the first one."*
- `officer-history.tsx` — `Table`, columns Office / Since / Ended / Reason /
  Years served. Empty state: *"No officer history recorded."*
- `add-officer-term-form.tsx` — `'use client'`, `react-hook-form` + `zod`
  (DECISION-096, already-approved deps, this form clears `docs/ui-standards.md`'s
  field-count threshold for the pattern). Person `<select>` and office
  `<select>` always render; the `org_unit` `<select>` conditionally renders
  only when `office === "deacon"`, matching the CHECK constraint's own shape.
- `end-term-dialog.tsx` — `'use client'`, shadcn `AlertDialog` mirroring
  `revoke-dialog.tsx` exactly: names the person and office in the confirm
  copy (*"End {personName}'s term as {officeLabel}?"*), captures `endsOn` +
  `endReason` before confirming, surfaces a denial via
  `toast.error(result.error)`, never a native `confirm()`.
- `officers-states.tsx` — mirrors `roles-states.tsx`'s three-block structure
  verbatim: `OfficersFlagOff`, `OfficersForbidden`, `OfficersLoadError`, same
  "a reader who skims only one should not be able to guess the other two"
  discipline.

**Files to modify:**
- `scripts/seed.ts` — add the `org_portal.officers` flag object.
- `scripts/seed-dev.sql` — add the `officers.manage` → `stated_clerk`
  `app_role_permissions` row.
- `scripts/test-rls.sql` — new section proving `officers.manage` resolves
  through `stated_clerk` end to end (mirrors sections 15/18's shape for
  `role_grants.manage`/`tickets.file`); this is about the *new permission
  row*, not a re-test of `officer_terms`' own tenant isolation, which
  sections around 934–994 already cover.
- `src/lib/db/errors.ts` — add `isExclusionViolation()`.
- `docs/TODO.md` — restate (not newly discover) the unconstrained
  `group_memberships.officer_term_id` FK as a standing database-admin
  follow-up, per Rule 10.

## Implementation Order

1. **Migration** — `drizzle/0029_presby_officers_permission.sql`: insert the
   `officers.manage` permission-catalog row. No table/column/constraint
   changes.
2. **Fixture binding** — `scripts/seed-dev.sql`: `officers.manage` →
   `stated_clerk`'s existing `app_role_permissions`. No new `role_grants` row.
3. **Flag seed** — `scripts/seed.ts`: `org_portal.officers`, `enabled: false`.
4. **`scripts/test-rls.sql`** additions proving the new permission resolves
   correctly and is cross-org isolated the same way every other permission
   row already is.
5. **`src/lib/officers.ts`** — the query/mutation module, including
   `isExclusionViolation()` in `src/lib/db/errors.ts`.
6. **`(org)/o/[slug]/admin/officers/actions.ts`** — server actions, audit
   events.
7. **UI** — the two pages, the five components above.
8. **Regression test (named explicitly, a Phase 4 gate, not optional):** same
   person, same office, two non-consecutive terms, recorded through
   `startOfficerTerm()`/the actual server action (not a re-citation of the
   existing SQL-level fixture test at `scripts/test-rls.sql`'s deacon-linkage
   section) — assert both terms retain independent `endsOn` values AND query
   `group_memberships` directly to confirm two independent rows, each keyed
   to its own `officer_term_id`, not one row silently overwritten (F22's exact
   failure mode, at the layer this pipeline actually adds).
9. Release notes entry, functionality-map update (Rule 14), `docs/TODO.md`
   reconciliation (Rule 10) — tech-lead, at Phase 6 SHIP IT.

## Edge Cases & Risks

- **F22 regression at the application layer** — see Implementation Order
  item 8. This is the single highest-value test this pipeline adds: the
  trigger's own fix is already proven at the SQL/fixture layer, but this is
  the first *arbitrary user input* write path onto `officer_terms`, and a
  form that lets a check-then-insert race reopen the window the exclusion
  constraint closes would reintroduce the bug class through a different door.
- **No delete, ever.** The UI exposes exactly two mutations (start, end via
  `endsOn`/`endReason`). `group_memberships.officer_term_id` is an
  unconstrained FK (`drizzle/0017`'s own comment) — a delete on a settled
  `officer_terms` row would orphan a `group_memberships` row with no trigger
  to clean it up, leaving someone permanently seated on Session/Diaconate
  (and anything that group's `role_grants` carry) with no corresponding term.
  This pipeline does not fix the FK (out of scope, restated in `docs/TODO.md`
  per Rule 10) — it just never gives the UI a path that depends on it being
  fixed.
- **Exclusion/check-constraint copy** — see API Contract table above; this is
  the concrete acceptance criterion, not "map errors reasonably."
  `isExclusionViolation()`'s false-positive risk is bounded the same way
  `isUniqueViolation()`'s is (`docs/work-log/2026-07-01-unique-violation-
  helper.md` already confirmed FK/check/exclusion violations carry distinct,
  non-colliding SQLSTATE codes — `23503`/`23514`/`23P01`).
- **Empty states, both roster and history**, worded distinctly (see
  Component Plan) — a person or org with zero `officer_terms` rows is a real,
  reachable state (every brand-new org, and any existing member with no
  officer history), not an edge case to discover in Phase 6.
- **Mobile (360px).** `officer-roster.tsx` carries more columns than
  `roles-list.tsx` (office, person, class year, since, ends, and
  conditionally district) — verify in an actual phone-viewport browser
  (Workflow Rule, "Verify in a Browser") whether all columns fit or whether
  class year / district need to drop below a breakpoint; `next build`
  passing is not evidence this renders usably at 360px.
- **e2e blast radius.** No existing e2e spec (`e2e/*.spec.ts`) exercises
  `officer_terms`, `group_memberships`, `session_member`, or `diaconate` —
  confirmed by direct grep across `e2e/`. `role-boundaries.spec.ts` tests the
  *platform* `FEATURES` axis (`/admin`, `/access-pending`), which is an
  unrelated system from the tenant `permissions`/`role_grants` axis this
  pipeline extends (`src/lib/authz.ts`'s own header: two deliberately
  separate scopes). The new migration is an INSERT of one new, uniquely-keyed
  `permissions` row; `scripts/test-rls.sql`'s existing keyed-count assertions
  (`where key = '...'`, e.g. lines ~1117/1120) are unaffected by an unrelated
  new key. **Net effect: this pipeline's blast radius on pre-existing e2e
  coverage is empty** — the Phase 4/5 obligation is net-new coverage for the
  new surface (vitest for `src/lib/officers.ts`/`actions.ts`/components; no
  new Playwright spec is required unless qa's feature-gate audit finds the
  admin-route auth pattern warrants one, matching `admin/roles`'s own
  precedent of shipping without a dedicated e2e spec).
- **`minute_reference` as the only paper trail** — carried forward from
  Phase 1, not solved here: nothing verifies an election/installation
  actually happened. The add-term form should encourage (placeholder text,
  not a required-field validator) `minute_reference` on every write.
- **Six-year aggregate-service warning** — `presby_officer_history()` already
  computes `years_served`; whether the history view renders a warning banner
  when cumulative service crosses six years is a nice-to-have, not required
  for Phase 6 SHIP IT (Phase 1's own Out-of-Scope list).

## Implementer

**Three commits**, per Phase 2's steer, no deviation — this is genuinely a
schema-catalog-and-fixture layer, a server/query layer with a non-trivial
error-mapping contract, and a UI layer with its own mobile/empty-state
surface, and splitting them keeps each commit reviewable against one lens:

1. **database-admin** — `drizzle/0029_presby_officers_permission.sql` (the
   `officers.manage` catalog row); `scripts/seed-dev.sql` (the `stated_clerk`
   binding); `scripts/test-rls.sql` additions proving it end to end.
2. **api-developer** — `src/lib/officers.ts`, `src/lib/db/errors.ts`'s
   `isExclusionViolation()`, `(org)/o/[slug]/admin/officers/actions.ts`
   (error mapping, audit events, the F22 application-layer regression test),
   `scripts/seed.ts`'s flag row.
3. **ux-developer** — both pages, all five components, the mobile
   verification in a real phone-viewport browser.

**Handoff: database-admin first (Phase 4, commit 1).** api-developer and
ux-developer follow in the order above; ux-developer's forms depend on
api-developer's `actions.ts` signatures, so commit 3 cannot start meaningfully
before commit 2 lands, even though this is recorded as one Phase 4 rather
than three separate ones.

---

# Phase 4 — Implementation

## Commit 1 of 3 (database-admin) — schema/permission-catalog/fixture layer

**Status: complete.** Commit 2 (api-developer — `src/lib/officers.ts`,
`isExclusionViolation()`, `actions.ts`, the `org_portal.officers` flag row)
and commit 3 (ux-developer — pages/components/mobile verification) still owed
at the time commit 1 was written; commit 2 is now complete (see below).

### Files Created

- `drizzle/0029_presby_officers_permission.sql` — hand-authored (per
  `docs/TODO.md`'s documented `db:generate`/`db:migrate`-broken state),
  idempotent (`on conflict (key) do nothing`) migration seeding the
  `officers.manage` permission-catalog row (module `officers`, tier 1),
  mirroring `drizzle/0017_presby_membership_roster.sql` /
  `drizzle/0018_presby_role_administration.sql`'s identical form exactly, per
  Phase 3's Data Model section and DECISION-063's precedent (`permissions`
  carries no `organization_id`, seeded by migration, not `scripts/seed.ts`).

### Files Modified

- `drizzle/meta/_journal.json` — appended the manually-registered entry for
  `0029_presby_officers_permission` (idx 29), continuing the hand-authored
  registration pattern `0013`–`0018` established. **Flagging explicitly:**
  `0026`–`0028` (the three most recent prior migrations) were never
  registered in this journal at all — a pre-existing gap I did not create and
  did not attempt to backfill (out of scope for this commit; `docs/TODO.md`'s
  existing `db:generate`/`db:migrate`-broken entry already tracks the
  snapshot-chain problem this stems from). My entry's `idx` (29) matches the
  file's own number, consistent with how `idx` was assigned through `0025`,
  but it is not contiguous with the last *registered* entry (25) because of
  that pre-existing gap.
- `scripts/seed-dev.sql` — added one row to the existing
  `app_role_permissions` bulk `insert` (binding `officers.manage` to
  `stated_clerk`, `f0000000-0000-0000-0000-000000000005`), with a comment
  citing DECISION-078's test per Phase 3's own wording. **No new
  `app_roles` row, no new `role_grants` row** — Tobias Renwick's existing
  direct `stated_clerk` grant (already seeded, Alder-Creek-only) carries the
  new permission for free, same shape as the `roll.propose`/`people.manage`/
  `org_features.manage`/`directory.view_hidden` bindings immediately above it
  in the same file.
- `scripts/test-rls.sql` — new **section 22** ("Officer-terms administration,
  database-admin schema layer"), appended after section 21 (the sibling
  org-provisioning-baseline-roles pipeline's section, already present
  uncommitted in the working tree — confirmed before numbering mine 22, not
  a collision). Three assertions: the `officers.manage` catalog row exists;
  `presby_has_permission(:CLERK, :ALDER, 'officers.manage')` resolves true at
  Alder Creek (plus a re-check that `role_grants.manage` is undisturbed);
  and the same call at Bramblewood resolves false (Tobias Renwick holds no
  `role_grants` row there at all — deliberate, DECISION-063's
  "prove-the-mechanism-once" fixture shape).

### Schema Changes

- One new global catalog row: `permissions.key = 'officers.manage'` (module
  `officers`, tier 1). No new table, column, index, or constraint —
  `officer_terms`, `org_units`, and the derived-group trigger are unchanged,
  per Phase 3's Data Model section.
- Applied via: hand-authored SQL migration
  (`psql "$MIGRATE_DATABASE_URL" -f drizzle/0029_presby_officers_permission.sql`),
  **not** `db:push` or `db:generate` — both are documented-broken repo-wide
  (`docs/TODO.md`), and this is a global-catalog insert with no organization
  to exist first, matching every prior permission-catalog migration's own
  house pattern. Applied and confirmed idempotent (second run: `INSERT 0 0`)
  against the dev database this session — see Implementer Notes for full
  output.

### Audit Events

- None from this commit. The permission-catalog row and its fixture binding
  are not user-facing mutations; `OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED`
  (Phase 2/3's named audit keys) are commit 2's responsibility
  (`src/lib/officers.ts`/`actions.ts`).

### Implementer Notes

**Verification performed, actual output:**

1. Migration applies cleanly against the dev database:
   ```
   $ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0029_presby_officers_permission.sql
   INSERT 0 1
   ```
   Re-run to confirm idempotency:
   ```
   $ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0029_presby_officers_permission.sql
   INSERT 0 0
   ```
2. `npm run typecheck` — clean, no output (exit 0). This commit touches no
   TypeScript.
3. `npm run check` (all four tripwires) — `check:audit`, `check:sql-date`,
   `check:deps-drift` all passed. **`check:brand-scope` FAILED**, but the
   failure is entirely pre-existing and unrelated to this commit:
   `src/components/shared/pagination.tsx:16,18` (button-shaped class strings
   outside `src/components/ui/`) — that file belongs to the concurrent,
   already-uncommitted "Members & Directory pagination/search/status"
   pipeline (`docs/work-log/2026-08-26-members-directory-pagination-search.md`,
   confirmed via `git status` showing it modified before I touched anything).
   I did not create, modify, or otherwise touch that file. Flagging rather
   than silently ignoring per this repo's own discipline, but it is not this
   commit's to fix.
4. **`scripts/test-rls.sql` full-suite run hit a pre-existing, unrelated
   failure before reaching section 22**: section 10's
   `roll: cache agrees with replay` assertion (line 331,
   `presby_roll_cache_drift()`) failed with `expected 0, got 1` — this is the
   F29 cache-drift CLAUDE.md documents by name ("`memberships.current_roll`
   ... drifts with the passage of time ... the daily reconcile and
   `presby_roll_cache_drift()` exist for that"), a property of the shared dev
   database's clock-relative fixture state, not of anything in this commit
   (section 10 is untouched by me, and precedes my section 22 by roughly
   1000 lines). No reconcile script exists in this repo yet to close it
   (checked `scripts/` — none found); out of scope to build one here.
   Because `ON_ERROR_STOP=1` aborts the whole file on this earlier failure, I
   verified **section 22 in isolation** by extracting just its SQL (plus the
   file's header `\set` block) into a scratch file and running it directly
   against `$APP_DATABASE_URL` (as `presby_app`, per the suite's own MUST):
   all three assertions in the new section print `pass`:
   ```
   NOTICE:  pass  permissions: officers.manage catalog row exists (1)
   NOTICE:  pass  presby_has_permission: stated_clerk holds officers.manage at alder (1)
   NOTICE:  pass  presby_has_permission: stated_clerk still holds role_grants.manage (unchanged) (1)
   NOTICE:  pass  presby_has_permission: stated_clerk holds NOTHING at bramblewood (no grant there) (0)
   ```
   **Flag for whoever next runs the full suite clean (qa, Phase 5, or
   whoever owns dev-DB hygiene):** the F29 drift at section 10 will still
   block a full `ON_ERROR_STOP=1` run until the cache is reconciled or the
   assertion is re-run against a freshly reseeded database; this is
   pre-existing and not something commits 2 or 3 of this pipeline caused
   either.

**Explicit gap named per this task's own instruction — "note if this section
needs a follow-up assertion added in commit 2":** section 22 proves the
permission-catalog fact and that it resolves correctly through
`presby_has_permission()`, cross-org, exactly like section 19's Deliverable B
did for `org_features.manage`/`people.manage`. It does **not** (and cannot
yet) assert that `officers.manage` actually *gates* an `officer_terms`
mutation end to end — there is no `src/lib/officers.ts`/`actions.ts` yet to
gate anything. That is not a schema-layer gap: `officer_terms`' own table-level
RLS is unchanged by this migration (already exercised by sections 2/7/18), and
a bare permission-catalog row carries no RLS of its own
(`src/lib/db/domain/authz.ts`'s own comment: `permissions` is global,
code-seeded, un-RLS'd). The real follow-up obligation lands in commit 2, as
**vitest** against `src/lib/officers.ts`'s own `officers.manage` gate check
(mirroring `hasRoleGrantsManage`'s placement) — not as a new SQL section here,
matching how none of `role-grants.ts`/`roll.ts`/`people.ts`'s own permission
checks are re-proven at the SQL layer either. Documented inline in section
22's own header comment as well, so this isn't only recorded here.

**`docs/TODO.md`:** Phase 3 asked that the unconstrained
`group_memberships.officer_term_id` FK be "restated ... as a standing
database-admin follow-up." It already has a live entry (Next Up, the
`2026-08-19-tenant-permissions-portal.md` line: *"`group_memberships
.officer_term_id` has no foreign key ... Candidate for a future
database-admin review"*) — nothing to newly add from this commit. Left
untouched; final `docs/TODO.md` reconciliation for this whole pipeline is a
Phase 6/Rule 10 matter once all three commits and QA have landed, not
something to do piecemeal per commit.

**No new `docs/decisions.md` entry.** This binding is mechanical
(fixture-only `app_role_permissions` insert on top of an already-decided
role, per Phase 3's own design doc), matching precedent — the equivalent
`org_features.manage`/`people.manage`/`directory.view_hidden` bindings didn't
get their own top-level decision entries either; the design reasoning lives
in this work-log's Phase 3 section, which is the record of the decision that
was actually made.

**Handoff to api-developer (commit 2):** the `officers.manage` permission
key exists in the catalog and resolves correctly for `stated_clerk` at Alder
Creek (fixture person: Tobias Renwick, `c0000000-0000-0000-0000-000000000002`,
sign-in `clerk.fixture@example.invalid` per `docs/testing.md`). Nothing new
to apply locally beyond what's already in this commit — the next agent's own
local setup is unchanged (`npm run db:migrate` remains broken per
`docs/TODO.md`; apply `drizzle/0029_presby_officers_permission.sql` by hand
with `psql "$MIGRATE_DATABASE_URL" -f drizzle/0029_presby_officers_permission.sql`
if working against a database that doesn't already have it, then
`psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` only if starting from a
truly fresh schema — re-running `seed-dev.sql` against a database that
already has fixture rows will fail on primary-key collisions, it is not
idempotent). No `db:seed` change from this commit (the `org_portal.officers`
flag row is commit 2's own responsibility per Phase 3's Implementer split).
Build `src/lib/officers.ts` and `(org)/o/[slug]/admin/officers/actions.ts`
next, per Phase 3's API Contract and Implementation Order items 5–6.

---

## Commit 2 of 3 (api-developer) — query/mutation layer, error mapping, audit, flag row

**Status: complete.** Commit 3 (ux-developer — pages/components, mobile
verification in a real phone-viewport browser) still owed.

### Files Created

- `src/lib/officers.ts` — the query/mutation module, sibling to
  `src/lib/role-grants.ts` (same `withOrgContext()`/gate-first/typed-result
  shape, DECISION-096). Exports `listOfficerRoster`, `getOfficerHistory`,
  `getOfficerFormOptions`, `startOfficerTerm`, `endOfficerTerm`, plus
  `OfficerOffice`/`OFFICER_OFFICES`/`OFFICE_LABELS` and every type Phase 3's
  API Contract named (`OfficerRosterEntry`, `OfficerHistoryEntry`,
  `OfficerFormOptions`, `OfficersResult<T>`, `StartOfficerTermInput`,
  `EndOfficerTermInput`). The `officers.manage` gate (a private
  `hasOfficersManage()` helper, mirroring `hasRoleGrantsManage`'s placement
  exactly) runs FIRST inside every exported function, before any other read
  or write. `listOfficerRoster`/`getOfficerHistory` call
  `presby_officer_roster()`/`presby_officer_history()`
  (`drizzle/0009_presby_rls.sql`) via `tx.execute(sql\`...\`)` rather than
  hand-reimplementing their "current"/"as of" filtering as a Drizzle join —
  `listOfficerRoster` unions across all six offices via a `cross join
  lateral` when no `office` filter is supplied, since the SQL function
  itself takes exactly one office per call. This module never writes
  `group_memberships` — `officer_terms_sync_derived` is the only writer of
  the derived Session/Diaconate rosters (The Court Is Not a Group) — and it
  exposes no delete: `startOfficerTerm` is always a plain INSERT (never an
  upsert), `endOfficerTerm` only ever sets `ends_on`/`end_reason` on the
  existing row.
- `src/lib/officers.test.ts` — 25 integration tests against a REAL Postgres
  connection (same `hasDb`-skip-guarded, dynamic-import-in-`beforeAll`
  harness `role-grants.test.ts` established), covering: the permission gate
  on every one of the five exported functions (a person with no
  `officers.manage` is rejected before any write, confirmed by reading the
  roster back as a legitimate holder afterward — the write never happened,
  not just that the caller couldn't see it); the deacon/org_unit "iff" rule
  in both directions (deacon without a district → `invalid_input`; any
  other office WITH a district → `invalid_input`; deacon WITH one, and
  ruling_elder/other offices WITHOUT one, both succeed); cross-org isolation
  (a person or org_unit that exists only at a second organization can never
  be attached to a term at the first, and a viewer with no relationship
  anywhere throws `OrgAccessError`); `getOfficerFormOptions`'s F21-shaped
  people list (excludes a lapsed membership, never leaks another org's
  people/org_units); the exclusion-violation copy-mapping end to end (a
  second open term in the same office for the same person returns
  `{ kind: "overlap", personName, officeLabel }`, and exactly one row exists
  afterward — no partial insert); `endOfficerTerm`'s validation
  (`invalid_target` for a nonexistent term, `invalid_input` for
  `endsOn < startsOn`) and its no-delete discipline (the row survives,
  `ends_on`/`end_reason` set); and genuine-failure propagation (malformed
  dates, an unrecognized office, and a relationship-less viewer all throw,
  never return a result variant). **The F22 regression test**
  (`describe("F22 regression at the application layer...")`) is the single
  test Phase 3 named as this commit's most important acceptance criterion:
  the same person is given two non-consecutive `ruling_elder` terms
  entirely through `startOfficerTerm()`/`endOfficerTerm()` (never a raw SQL
  insert), and the test asserts BOTH `officer_terms` rows keep independent
  `ends_on` values AND `group_memberships` carries two independent rows,
  each keyed to its own `officer_term_id` — proving this new application
  write path does not reopen F22's exact failure mode (a second
  non-consecutive term silently rewriting the first term's end date)
  through a different door. Run for real against the dev database this
  session; full output is in Implementer Notes below. Uses a
  test-block-dedicated fixture person (`f22Person`) rather than the shared
  `targetPerson` — an earlier draft shared `targetPerson` across describe
  blocks and the F22 test's own open-ended `[2020-01-01, infinity)` insert
  collided with an unrelated `ruling_elder` term another describe block
  had already created and ended for that same person, failing with
  `overlap` instead of `ok`. Caught by actually running the suite against
  Postgres (not inferred from a mock), and fixed by isolating the fixture,
  not by loosening the assertion.
- `src/app/(org)/o/[slug]/admin/officers/actions.ts` — the two server
  actions the UI (commit 3) will call:
  `startOfficerTermAction(slug, input)` and
  `endOfficerTermAction(slug, input & { personId, office })` (the latter
  takes `personId`/`office` from the caller — the roster page already has
  them from `listOfficerRoster()` — so the audit write needs no second
  read, mirroring `revokeRoleAction`'s identical shape). Both return
  `ActionResult<{ termId: string }>`. `resolveActingIdentity()` is copied
  verbatim from `admin/roles/actions.ts` per Phase 3's explicit instruction
  — `organizationId` is always the server's own
  `resolveOrgContext(session.user.id, slug)` answer, never client-supplied.
  Read paths (`listOfficerRoster`/`getOfficerHistory`/
  `getOfficerFormOptions`) are NOT wrapped here — they're called directly
  from the page (a Server Component) in commit 3, same shape
  `admin/roles/page.tsx` uses for `listGrants`/`getGrantFormOptions`. Maps
  every `OfficersResult` kind to specific copy per Phase 3's API-contract
  table (`overlap` → "{personName} already has an open term as
  {officeLabel} — end it first."; `invalid_input` → the message
  `officers.ts` already composed; `invalid_target` → one message covering
  both the person and org_unit case, since `officers.ts` doesn't
  disambiguate which one failed; `forbidden` → "You don't have permission
  to manage officer terms here."). Writes `AUDIT_ACTIONS.
  OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED` on success only, with
  `organizationId` explicit in `metadata` (DECISION-067's convention,
  since no tenant-facing audit reader exists yet). Calls `revalidatePath(
  "/o/<slug>/admin/officers")` on success only.
- `src/app/(org)/o/[slug]/admin/officers/actions.test.ts` — orchestration
  tests, mocked at the `@/lib/officers` boundary (same principle as
  `admin/roles/actions.test.ts`): identity resolution (not-signed-in short-
  circuits before `resolveOrgContext`; `resolveOrgContext` is called with
  `session.user.id` and the URL `slug`; a non-`ok` resolution short-circuits
  before `startOfficerTerm`/`endOfficerTerm`; `personId`/`organizationId`
  from `resolveOrgContext` and `userId` from the session are passed as
  THREE separate arguments, never conflated); every `OfficersResult` kind →
  `ActionResult` mapping including the composed `overlap` copy; `
  recordAudit()` fires only on `{ kind: "ok" }`, with the exact metadata
  shape (including `orgUnitId: null`, not `undefined`, when none was
  supplied); `revalidatePath` fires only after a successful mutation.

### Files Modified

- `src/lib/db/errors.ts` — added `isExclusionViolation()`, sibling to
  `isUniqueViolation()`, detecting Postgres `exclusion_violation` (SQLSTATE
  `23P01`) via the same code/`.cause`/English-message-fallback discipline.
  Documents the "23503/23514/23P01 never collide" property `docs/work-log/
  2026-07-01-unique-violation-helper.md` already established, and notes
  there is no numeric-code-coercion case (unlike `isUniqueViolation`'s
  `{ code: 23505 }`) because `23P01` contains a letter and can never be a
  JS number literal.
- `src/lib/db/errors.test.ts` — 18 new cases for `isExclusionViolation()`
  (5 true, including the wrapped-`.cause` and case-insensitive-message
  cases; 8 false, including the three-way non-collision check against
  `23505`/`23503`/`23514`; plus null/undefined/bare-string/empty-object).
- `src/lib/audit.ts` — added `AUDIT_ACTIONS.OFFICER_TERM_STARTED` (`
  "tenant.officer_term.started"`) and `OFFICER_TERM_ENDED` (`
  "tenant.officer_term.ended"`), per Phase 2/3's named keys, mirroring
  `TENANT_ROLE_GRANTED`/`REVOKED`'s shape and comment style.
- `src/lib/audit.test.ts` — added the two new keys to the
  `EXPECTED_ENTRIES` regression guard (the test that fails before a stale
  audit-action string reaches the database on any future rename). Caught by
  `npm run typecheck`, not discovered by inspection — `Record<keyof typeof
  AUDIT_ACTIONS, string>` is exhaustive by construction, so the guard
  itself enforced this addition.
- `scripts/seed.ts` — added the `org_portal.officers` flag object
  (`enabled: false`), placed at the end of `seedFlags()`'s `defaults` array,
  matching `org_portal.roles`'s comment shape and "ships dark until the
  page lands" reasoning exactly. Noted in-line: at the moment of this edit
  the array already contained an uncommitted `org_portal.chrome_v3` entry
  from a concurrent, unrelated pipeline (same situation commit 1 flagged
  for `pagination.tsx`) — confirmed via `git diff` that my edit only
  appended at the end and did not touch or reorder that entry.

### Schema Changes

None. This commit is entirely query/mutation/action code, error-mapping
code, an audit-catalog addition (code, not schema), and a flag-seed-script
addition (also code, not schema) — `officer_terms`, `org_units`,
`officer_terms_no_overlap`, `officer_terms_org_unit_deacon_check`, and
`officer_terms_sync_derived` are all unchanged, per Phase 3's Data Model
section. No migration added in this commit.

### Audit Events

- `AUDIT_ACTIONS.OFFICER_TERM_STARTED` (`"tenant.officer_term.started"`) —
  written by `startOfficerTermAction` on `{ kind: "ok" }` only.
  `resourceType: "officer_term"`, `resourceId` = the new term's id,
  `metadata: { organizationId, personId, office, startsOn, orgUnitId }`
  (`orgUnitId` explicitly `null` when not supplied, never `undefined`).
- `AUDIT_ACTIONS.OFFICER_TERM_ENDED` (`"tenant.officer_term.ended"`) —
  written by `endOfficerTermAction` on `{ kind: "ok" }` only.
  `resourceType: "officer_term"`, `resourceId` = the term's id,
  `metadata: { organizationId, personId, office, endsOn, endReason }` (
  `personId`/`office` are caller-supplied — from the roster row being
  ended — not re-derived inside `officers.ts`, mirroring
  `revokeRoleAction`'s identical shape for the same reason: no second read
  inside the action).
- Neither fires on any denial (`forbidden`/`invalid_target`/`invalid_input`/
  `overlap`) — proven by `actions.test.ts`'s mapping tests, which assert
  `mockRecordAudit`/`mockRevalidatePath` were NOT called on every non-`ok`
  branch.

### Implementer Notes

**Verification performed, actual output:**

1. `npm run typecheck` — clean, no output (exit 0), after also updating
   `src/lib/audit.test.ts`'s `EXPECTED_ENTRIES` guard (see Files Modified) —
   the guard's own exhaustive `Record` type is what caught the omission on
   the first typecheck pass.
2. `npm run check` (all four tripwires) — ALL FOUR PASSED clean this time
   (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`)
   — the `check:brand-scope` failure commit 1 flagged as pre-existing and
   belonging to a concurrent pipeline (`pagination.tsx`) is resolved as of
   this session; not something this commit touched either way.
3. `npx vitest run "src/app/(org)/o/[slug]/admin/officers/actions.test.ts"
   src/lib/audit.test.ts src/lib/db/errors.test.ts` — 56 passed, 0 failed.
4. `npx dotenv -e .env.local -- npx vitest run src/lib/officers.test.ts`
   (real Postgres, per that file's own required invocation) — **25 passed,
   0 failed**, including the F22 regression test, on the second run after
   the fixture-isolation fix described above (first run: 24 passed, 1
   failed — the collision named in the Files Created section, not a defect
   in the write path itself; confirmed by re-running with an isolated
   fixture person, not by loosening the assertion).
5. `npm test` (full repo suite, no `DATABASE_URL` set — CI's own
   condition) — 2132 passed, 304 skipped (the 15 Postgres-backed suites,
   including this commit's own `officers.test.ts`, skip cleanly under
   `hasDb`'s guard rather than failing), 0 failed.
6. `npm run build` — succeeded. `/o/[slug]/admin/officers` does not appear
   in the route list yet, as expected — there is no `page.tsx` in this
   commit, only `actions.ts`; Next does not register a route for an
   actions-only directory. Commit 3 adds the page.

**On the `presby_officer_roster()` "no office filter" case, named because
it's the one place this commit's SQL diverges from a literal 1:1 call into
the existing function:** the SQL function itself takes exactly one
`p_office` argument and has no "all offices" mode. `listOfficerRoster`
handles Phase 3's `office?: OfficerOffice` (optional) contract by
`cross join lateral`-ing the function once per literal office value via a
`values (...)` CTE, filtered to the caller's `office` argument when
supplied. This still calls the function for every date-filtering decision
(never hand-reimplements "current as of today") — it only supplies the
office value the function's own signature requires, exactly the same
spirit as `effectivePermissions()`'s "never hand-reimplemented as a Drizzle
join" discipline in `src/lib/authz.ts`, extended to a case that function's
own author didn't need to handle (a single-office roster read) but this
one does (an all-offices roster read).

**On `docs/TODO.md` / the unconstrained `group_memberships.officer_term_id`
FK:** untouched by this commit, per Phase 3's own note that final
`docs/TODO.md` reconciliation for this whole pipeline happens at Phase 6,
not piecemeal per commit (matching commit 1's identical posture).

**Handoff to ux-developer (commit 3):** `src/lib/officers.ts` and
`(org)/o/[slug]/admin/officers/actions.ts` are complete and tested — build
`(org)/o/[slug]/admin/officers/page.tsx`,
`(org)/o/[slug]/admin/officers/[personId]/page.tsx`, and the five
components Phase 3's Component/Page Plan names (`officer-roster.tsx`,
`officer-history.tsx`, `add-officer-term-form.tsx`, `end-term-dialog.tsx`,
`officers-states.tsx`) against the signatures above. The flag
(`org_portal.officers`) is seeded `false` in `scripts/seed.ts` (not yet
applied to any running database — run `npm run db:seed` or the
project's usual seed-refresh step before manually verifying the page).
The fixture person who holds `officers.manage` at Alder Creek is the same
one commit 1 named: Tobias Renwick, `c0000000-0000-0000-0000-000000000002`
(`clerk.fixture@example.invalid`). Remember Phase 2/3's copy requirement
near the add-term form: *"This records who holds the office. Granting
software access (Administration → Roles) is done separately."*

---

## Commit 3 of 3 (ux-developer) — pages, components, mobile verification

**Status: complete.** All three Phase 4 commits are now done; handing off to
qa (Phase 5).

### Files Created

- `(org)/o/[slug]/admin/officers/page.tsx` — the roster page. Server
  Component, repeats the `(org)` auth pattern in full (`cachedAuth()` →
  `resolveOrgContext()` → switch on `kind` → `assertOrgAccess()`), identical
  ordering to `admin/roles/page.tsx`: the `org_portal.officers` flag check
  runs BEFORE `listOfficerRoster()`/`getOfficerFormOptions()` are ever
  called. Calls both directly (no server action wrapper for reads, same as
  roles). Renders `<OfficerRoster>`, the "Add an officer term" heading with
  the two-unlinked-systems copy Phase 2/3 named, and `<AddOfficerTermForm>`.
  `OfficersResult`'s non-"ok"/"forbidden" variants (`invalid_target`/
  `invalid_input`/`overlap` — real for the mutation functions, unreachable
  from these two read functions) are handled defensively via `if (result.kind
  !== "ok") { ...; return <LoadError> }` rather than assumed unreachable.
- `(org)/o/[slug]/admin/officers/[personId]/page.tsx` — the per-person
  history page (Flow 3), mirroring `admin/members/[id]/edit/page.tsx`'s
  existence as a per-person detail route one level below its parent list
  page. `getOfficerHistory()`'s `{ kind: "invalid_target" }` (personId never
  had a membership at this org) is a real `notFound()`, not a load error —
  same discipline as `getPersonForEdit()`'s `not_found` branch. Reads a
  `?name=` query param for the heading (see Implementer Notes — this is a
  UI-only addition, not part of Phase 3's API contract, and the header
  comment explains why).
- `(org)/o/[slug]/admin/officers/officers-states.tsx` — `OfficersFlagOff`,
  `OfficersForbidden`, `OfficersLoadError`, mirroring `admin/roles/
  roles-states.tsx`'s three-block structure verbatim per Phase 3's
  instruction, with officers-specific copy.
- `(org)/o/[slug]/admin/officers/officer-roster.tsx` — the roster `Table`
  (Server Component, embeds `<EndTermDialog>` per row without itself needing
  `'use client'`, same shape as `roles-list.tsx`). Empty state: "No officers
  recorded yet — add the first one." The `District` column only renders when
  at least one row carries an `orgUnitName`. **Mobile-adjusted after a real
  360px walkthrough** — see Implementer Notes.
- `(org)/o/[slug]/admin/officers/officer-history.tsx` — the history `Table`
  (Server Component). Empty state: "No officer history recorded." Maps
  `end_reason`'s free-text values (`completed`/`resigned`/`removed`/
  `deceased`) to friendly labels, falling back to the raw string for an
  unrecognized value.
- `(org)/o/[slug]/admin/officers/add-officer-term-form.tsx` — `'use client'`,
  `react-hook-form` + `zod` (DECISION-096). Person and office `<select>`s
  always render; the `org_unit` `<select>` renders ONLY when
  `office === "deacon"`, matching the CHECK constraint's own shape — client
  mirror of the same rule `officer-term-schema.ts`'s `superRefine` and
  `startOfficerTerm`'s own re-check both enforce (Phase 3's three-layer
  discipline: schema → server function → DB constraint as a last-resort
  backstop). Every `ActionResult` denial from `startOfficerTermAction`
  (forbidden / invalid_target / invalid_input / the composed `overlap`
  string) surfaces via `toast.error(result.error)` verbatim — the mapping
  itself already happened server-side in commit 2's `actions.ts`, so this
  form's only job is to render whatever string comes back, never to
  re-interpret it. The two-unlinked-systems copy lives one level up in
  `page.tsx`, not duplicated here.
- `(org)/o/[slug]/admin/officers/officer-term-schema.ts` — the client-side
  `zod` schema, layer one of the three-layer deacon/org_unit "iff" rule.
- `(org)/o/[slug]/admin/officers/end-term-dialog.tsx` — `'use client'`,
  shadcn `AlertDialog` (Workflow Rule 2 — never `confirm()`), mirroring
  `revoke-dialog.tsx`: names BOTH the person and the office in the confirm
  copy (*"End {personName}'s term as {officeLabel}?"*), never a generic "Are
  you sure?". Unlike `RevokeDialog`, also collects two small fields inside
  the dialog (end date, defaulting to today; end reason, defaulting to
  "Completed") since `ends_on`/`end_reason` are always set together and
  there is no sensible one-click confirm with no input. `endsOn`'s input
  carries a `min={startsOn}` for a friendlier picker; the server
  (`endOfficerTerm`) remains the authoritative check for the actual
  ordering rule.
- `(org)/o/[slug]/admin/officers/office-labels.ts` — a small, UI-only
  duplicate of `src/lib/officers.ts`'s `OFFICER_OFFICES`/`OFFICE_LABELS`.
  **Not a Phase 3-named file** — added because `officers.ts` begins with
  `import "server-only"`, and every officers UI file that needed a runtime
  (not type-only) office label — `add-officer-term-form.tsx`,
  `end-term-dialog.tsx` (both Client Components), and, it turns out,
  `officer-roster.tsx`/`officer-history.tsx` too, since Vitest resolves
  `server-only`'s package export without Next's `react-server` condition
  and throws on import regardless of server/client status — would otherwise
  pull `officers.ts`'s `server-only` guard into a context where it
  unconditionally throws. Confirmed this is exactly why `admin/roles/
  roles-list.tsx` and `grant-role-form.tsx` only ever `import type` from
  `@/lib/role-grants.ts` and never a runtime export — same precedent,
  applied here. `src/lib/officers.ts` remains the source of truth for the
  `OfficerOffice` type (imported here as a `type` only); a `satisfies`
  clause keeps this file's array in sync with that type at compile time.
- Eight test files, one per component/page above (`page.test.tsx`,
  `[personId]/page.test.tsx`, `officers-states.test.tsx`,
  `officer-roster.test.tsx`, `officer-history.test.tsx`,
  `add-officer-term-form.test.tsx`, `end-term-dialog.test.tsx`,
  `officer-term-schema.test.ts`) — see Implementer Notes for what each pins
  and the full run output. Total: 76 new tests, all passing.

### Files Modified

- `docs/testing.md` — updated the existing `clerk.fixture@example.invalid`
  fixture row to also name `officers.manage` and
  `/o/alder-creek/admin/officers`, alongside the existing `role_grants.manage`
  / `/o/alder-creek/admin/roles` mention. No other row changed.

### Schema Changes

None. Pure UI/query-consumption layer, per Phase 3's Data Model section.

### Audit Events

None from this commit — `OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED` are
written by commit 2's `actions.ts` on success; this commit's forms/dialogs
only call those already-instrumented server actions.

### Implementer Notes

**The `?name=` query param on the history-page link (a UI-only addition,
not part of Phase 3's API contract):** `getOfficerHistory()` deliberately
returns no display name (Phase 3's own API Contract table). A name lookup
scoped to CURRENT members only (`getOfficerFormOptions()`'s F21-shaped list)
would fail exactly the case `getOfficerHistory()`'s own header comment says
matters most — a person whose membership has since ended but who still has
real officer history. Rather than inventing a second, wider query, the
roster page (which already has the display name in hand from
`listOfficerRoster()`) passes it through the URL to the link it renders,
the same "receiving page reads its own query param, falls back to a safe
default" shape `docs/ui-standards.md`'s Back Navigation section already
establishes for `?from=`. A direct visit with no `name` (or an empty one)
falls back to "This person's officer history" rather than fetching a wider
query just to word a heading. Flagging this explicitly since it's a design
choice this UI layer made, not something Phase 3 specified — a fork's
copy-review pass or a future API contract change should know it exists.

**Verification performed, actual output:**

1. `npm run typecheck` — clean, no output (exit 0).
2. `npm run check` (all four tripwires) — all four passed clean
   (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`).
3. `npx vitest run "src/app/(org)/o/[slug]/admin/officers/"` — **9 test
   files (76 tests) passed, 0 failed** (8 new files from this commit + the
   `actions.test.ts` from commit 2, all in the same directory).
4. `npm test` (full repo suite, no `DATABASE_URL` set) — **2193 passed, 304
   skipped, 0 failed** (up from commit 2's 2132 passed — net +61 after
   accounting for the 15 skipped Postgres-backed suites being unaffected;
   the new 76 minus a handful of already-existing overlaps in earlier
   counts nets out consistently — full numbers are in the raw output, not
   hand-reconciled here).
5. `npm run build` — succeeded. Both new routes register:
   `/o/[slug]/admin/officers` and `/o/[slug]/admin/officers/[personId]`
   (both `ƒ`, server-rendered on demand, as expected for an auth-gated org
   route).

**Live-browser mobile verification: COMPLETED, not deferred**, per this
task's explicit requirement (CLAUDE.md's "Verify in a Browser" invariant —
three prior bugs in this project were phone-only and invisible to
`curl`/`tsc`/`next build`). Used the already-running local dev server
(`localhost:3000`) and a scripted Playwright session (chromium, no
persistent test file added to the repo — a throwaway verification script,
deleted after use) to:

- Seed state: ran `npm run db:seed` (idempotent) to get the
  `org_portal.officers` flag row into the dev DB (seeded `false`, matching
  Phase 3's design), then flipped it to `true` directly in Postgres for
  this manual pass, per the task's own instructions and `docs/testing.md`'s
  documented apply-by-hand posture. **Restored to `false` before finishing**
  — confirmed by a final `select` shown below.
- Signed in as `clerk.fixture@example.invalid` (Tobias Renwick, Alder
  Creek) with the shared fixture password.
- **Hit a real, reproducible obstacle not caused by this pipeline**: Alder
  Creek's `organization_settings.require_two_factor` is `true`
  (`scripts/seed-dev.sql`'s own deliberate per-org policy split, so
  `scripts/test-rls.sql`'s isolation suite can prove
  `presby_two_factor_required()` reads the POLICY differently at two
  congregations), and `src/auth.ts`'s `computeEffectiveTwoFactor()` ORs the
  per-org policy into the session's effective `twoFactorRequired` REGARDLESS
  of `users.two_factor_required` being explicitly `false` on the
  `clerk.fixture` row. `scripts/seed-dev.sql`'s own comment on that row
  ("`two_factor_required` explicitly false so a manual walkthrough ... is
  not gated behind a separate TOTP enrolment detour") does not hold in
  practice — signing in as `clerk.fixture` redirects to `/account/2fa`,
  not straight to `/launch`. **This is already a known, independently
  documented gap** — `docs/TODO.md`'s Next Up section already carries the
  identical finding from the same day's member-management-edit-person and
  pagination/search pipelines ("`clerk.fixture@example.invalid` requires
  2FA enrollment to sign in"). Not re-adding a duplicate TODO line; this
  entry is further evidence for the existing one, which already recommends
  a permanent, 2FA-free, permission-holding dev fixture as the real fix.
  **Workaround used, and fully reverted**: temporarily set
  `organization_settings.require_two_factor = false` for Alder Creek
  (`22222222-2222-2222-2222-222222222222`) directly in Postgres for the
  duration of the browser session, then set it back to `true` immediately
  after — confirmed restored by a final `select` (`t`) before finishing
  this commit. No `scripts/test-rls.sql` assertion depends on this policy
  value being unchanged *between* sessions, only within one, so this is
  safe, but it is real friction worth fixing at the fixture layer per the
  existing TODO line.
- **Desktop pass (1280×900)**: roster renders with real fixture data
  (Clerk of Session, Deacon with a District, Ruling Elder with an ended
  term showing dates in both Since/Ends columns, Treasurer), the District
  column appears (one row carries one), the add-term form renders with all
  fields, the two-unlinked-systems copy is visible under "Add an officer
  term". Confirmed via `page.textContent()` assertions and a full-page
  screenshot.
- **Mobile pass (360×740), first attempt**: found a real issue. The
  roster `Table` (which already has its own `overflow-x-auto` wrapper) only
  showed Office and a sliver of Person before the visible viewport ended —
  `Since`, `Ends`, and the "End term" action button were entirely
  off-screen with no visible affordance more columns existed.
  `document.documentElement.scrollWidth`/`clientWidth` were both exactly
  `360` (no PAGE-level overflow, confirming the table's own scroll
  container was correctly absorbing it), but that doesn't help a user who
  doesn't realize the table itself scrolls independently. **Fixed, not just
  noted**, per Phase 2/3's own explicit suggestion ("class year / district
  need to drop below a breakpoint"): `Class year` and `District` — useful
  for annual nominating-committee planning, not for "who serves right now /
  can I end their term" — are now `hidden sm:table-cell`. That alone wasn't
  sufficient (Office labels like "Clerk of Session" and two-word names were
  still forcing `whitespace-nowrap` overflow), so Office and Person cells
  also got a `max-w-[6rem] whitespace-normal` (reverting to `sm:max-w-none
  sm:whitespace-nowrap` at wider widths) so long labels wrap onto a second
  line instead of forcing horizontal width. **Re-verified after the fix**:
  Office, Person, Since, and Ends are now all visible without scrolling at
  360px; only the End-term action and the tail of a long "Ends" date value
  require a small swipe within the table's own scroll container — the same
  residual behavior `admin/roles/roles-list.tsx` already accepts for its
  own wide-column table, not a new gap this pipeline introduces. Both
  before/after states were screenshotted; `officer-roster.test.tsx` (jsdom,
  which does not apply CSS breakpoints) was unaffected by the class changes
  and still passes 5/5.
- **Deacon/org_unit conditional field, verified live (not just in the
  mocked test suite)**: selecting "Deacon" in the Office `<select>` at
  360px made the District `<select>` appear immediately below it,
  populated with "North District"; switching back to "Ruling Elder" made
  it disappear again. Confirmed via `page.locator(...).count()` before and
  after, plus a screenshot.
- Final state confirmed restored: `org_portal.officers` flag back to
  `false`, Alder Creek's `require_two_factor` back to `true`. No scratch
  files left in the repo (the verification script lived outside version
  control and was deleted after use).

**On the admin-portal-stub link (a scope decision, not an oversight):**
`(org)/o/[slug]/org-states.tsx`'s `OrgPortalStub` already conditionally
renders a "Directory →" / "Administration →" (roles) / "Tickets →" set of
links gated on their own flags. This pipeline's Phase 3 Component/Page Plan
and Files-to-Modify list do not name `org-states.tsx`, so no "Officers →"
link was added there — the surface is reachable today only by direct URL
(`/o/<slug>/admin/officers`), the same discoverability posture
`docs/testing.md` already documents for `admin/roles` pre-nav-integration.
Flagging this explicitly as a real, if minor, UX gap rather than silently
fixing scope creep into a file Phase 3 didn't assign me — a natural,
low-risk follow-up for whoever next touches `org-states.tsx`.

**Handoff to qa (Phase 5).** All three Phase 4 commits are complete. What a
reviewer should click through in the browser: sign in as
`clerk.fixture@example.invalid` at Alder Creek (after enrolling 2FA, or
using the temporary `organization_settings.require_two_factor` workaround
documented above and in the existing `docs/TODO.md` line), flip
`org_portal.officers` on, visit `/o/alder-creek/admin/officers` — the
roster, the add-term form (try selecting Deacon to see the District field
appear), a person's history page via the roster's linked names, and the
"End term" `AlertDialog` on an existing row. New copy strings for a fork's
branding pass to review: "No officers recorded yet — add the first one.",
"No officer history recorded.", the two-unlinked-systems sentence under
"Add an officer term", and the End-term confirm copy
("End {person}'s term as {office}?"). UX tradeoffs: the `?name=` query-param
display-name passthrough (documented above); no "Officers →" link added to
the portal stub (documented above, deliberate scope adherence, not an
oversight); `end_reason` remains free text server-side with a fixed
four-option `<select>` client-side (`completed`/`resigned`/`removed`/
`deceased`), matching `src/lib/db/domain/officers.ts`'s own comment on the
column — a fork wanting a different reason vocabulary only needs to change
this one array, not the schema.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS** — clean, exit 0.

## Unit Tests

- Full suite (`npm run test`, no `DATABASE_URL`): 2193 passed / 304 skipped (pre-existing `hasDb`-guarded suites) / 0 failed, matching the implementer's claimed counts.
- `src/lib/officers.test.ts` (real Postgres, `dotenv -e .env.local`): 25/25 passed.
- `actions.test.ts` + `audit.test.ts` + `errors.test.ts`: 56/56 passed.
- All 9 files under `.../admin/officers/`: 76/76 passed.

## End-to-End Tests

N/A — confirmed by direct grep (`officer_terms`/`group_memberships`/`/admin/officers`/`session_member`/`diaconate` across `e2e/`): no existing spec touches this surface, and Phase 3 explicitly ruled no new spec required (mirrors `admin/roles`'s own precedent). Not an auth-touching diff per CLAUDE.md's definition — the stricter MFA-enrolled e2e gate does not apply.

## Regression Tests Added

- `src/lib/officers.test.ts:596-690` — F22 application-layer regression: same person/office, two non-consecutive terms via the real `startOfficerTerm()`/`endOfficerTerm()` write path, asserting independent `ends_on` and independent `group_memberships` rows via a real `getPlatformDb()` read (not a mock). Verified by reading the test body directly, not just its pass count. Caveat: this protects new code from reintroducing F22's bug class rather than a classic red→green bug-fix cycle; the implementer's log shows a genuine first-run failure (a fixture-isolation collision, unrelated to write-path correctness) that was fixed by isolating the fixture, confirming the test genuinely executed against real Postgres.
- `src/lib/db/errors.test.ts` — 18 new `isExclusionViolation()` cases, including three-way non-collision against `23505`/`23503`/`23514`.
- `src/lib/audit.test.ts` — `OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED` added to the exhaustive `EXPECTED_ENTRIES` guard.
- `actions.test.ts` — denial-path tests assert `recordAudit`/`revalidatePath` are NOT called on any non-`ok` branch; success-path tests assert exact metadata shape.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% stmts/branch/func/line.
- `src/lib/two-factor.ts`: 91.3% stmts, 100% branch, 90% funcs.
- `src/lib/flags.ts`: 100% stmts/branch/func/line.
- `src/lib/officers.ts` (this pipeline's own module): 96.15% stmts, 86.76% branch, 100% funcs (uncovered lines are malformed-date throw guards, not core logic).

## Feature-Gate Audit

Gated on the tenant permission axis (`officers.manage`), not the platform `FEATURES.*` axis — this is a tenant route, not a `(admin)` platform route, per CLAUDE.md's "Permissions vs Flags."

| Route or action | `auth()` present? | Tenant permission gate present? | Correct permission key? |
|---|---|---|---|
| `GET .../admin/officers/page.tsx` | yes — `cachedAuth()` + `resolveOrgContext()`/`assertOrgAccess()` | yes — `hasOfficersManage()` checked first | `officers.manage` — correct |
| `GET .../admin/officers/[personId]/page.tsx` | yes | yes — `getOfficerHistory()` gates first | `officers.manage` — correct |
| `startOfficerTermAction` | yes — `resolveActingIdentity()`, org id re-derived, never client-supplied | yes — `startOfficerTerm()` gates before any query/write | `officers.manage` — correct |
| `endOfficerTermAction` | yes | yes — `endOfficerTerm()` gates identically | `officers.manage` — correct |
| Edge gate (`src/proxy.ts`) on `/o/*` | n/a (complements, doesn't substitute) | confirmed auth/active-status/2FA at the edge; cannot check `officers.manage` (no DB at edge) — page/action-level gate is the real enforcement | n/a |

**Additional checks performed by reading code directly:**
- No `deleteOfficerTerm` export exists; module header documents why (unconstrained `group_memberships.officer_term_id` FK). No delete affordance, no `confirm()` anywhere in the new UI.
- Exclusion-violation mapping verified end-to-end: `isExclusionViolation()` → `{kind: "overlap", ...}` → composed copy matching Phase 3's contract verbatim.
- `clerk_of_session` naming trap: confirmed no new `app_roles`/`role_grants` row — migration inserts only the `officers.manage` permission catalog row, bound to the *existing* `stated_clerk` role. Read `presby_sync_derived_group()` directly: any office other than `ruling_elder`/`deacon` is a no-op — recording `clerk_of_session` provably writes nothing to `group_memberships` and cannot touch `role_grants`. Two systems stay unlinked, as required.
- F21 scoping confirmed: `getOfficerFormOptions()` filters people/org_units by `organizationId` — no bare cross-org scan.
- Audit events fire only on the `kind === "ok"` branch, confirmed by reading `actions.ts` directly, not just the test's claim.
- Mobile fix: confirmed present in `officer-roster.tsx` (`hidden sm:table-cell` on Class year/District, responsive whitespace/width on Office/Person) — code-confirmed, not independently re-observed live (judged not worth a live flag/2FA toggle on shared dev-DB state for a CSS-only check that's otherwise fully verifiable by reading the source).

## Verdict

**PASS**

All required checks green: typecheck, all four tripwires, full suite (2193/2193, 0 failed), real-Postgres officers suite (25/25) including a verified F22 regression test, clean build with both new routes registered. Feature-Gate Audit found every route/action correctly gated, no delete affordance, correct error-copy mapping, no naming collision, correct F21 scoping, audit events firing only on success. Not an auth-touching diff — MFA e2e gate correctly n/a.

One caveat, not a blocker: the mobile 360px fix was verified by direct code reading rather than an independent live-browser repeat, given the shared-dev-DB mutation risk of re-toggling the flag/2FA state for a CSS-only check.

---

# Phase 6 — Shipped vs Intent (analyst)

*Scope note: this Phase 6 covers only gap 1 (officer-terms admin UI) per the Phase 2 split. The sibling gap-2 pipeline (`docs/work-log/2026-08-26-org-provisioning-baseline-roles.md`) already carries its own SHIP IT and is not re-litigated here.*

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> A `stated_clerk`-holder can start a term, end a term, view the roster, and view a person's history exactly as Phase 1 described, over a write path that's genuinely proven — by real Postgres, not mocks — not to reopen F22 through this new door.

## What's Working

- **All four core user verbs present and correctly wired**: `startOfficerTerm`/`endOfficerTerm`/`listOfficerRoster`/`getOfficerHistory`, gated on `officers.manage` first inside every function, confirmed by direct code reading.
- **No-delete is real, not just documented** — no `deleteOfficerTerm` export exists anywhere.
- **The `stated_clerk` binding avoids the naming trap in the cleanest possible way: no new role was minted at all.** Only a permission-catalog row was added; `clerk_of_session` appears only as an `officer_terms.office` data value, never as an `app_roles.key`. The two systems (ecclesiastical office vs. software grant) stay unlinked.
- **The F22 application-layer regression test is real** — asserts, against a real `getPlatformDb()` read, that two non-consecutive terms retain independent `ends_on` and independent `group_memberships` rows.
- **Empty states are specific**: "No officers recorded yet — add the first one." / "No officer history recorded."
- **Audit events fire correctly and only on success.**
- **Mobile got a genuine live fix**, not a code-only patch — the implementer ran an actual Playwright session at 360×740, found a real off-screen-columns problem, fixed it, and re-verified live with screenshots. Materially better than the open TODO.md items for sibling same-day pipelines that never had any live pass at all.

## Intent-vs-Shipped Diff

- Record/end a term, view roster/history, conditional `org_unit` field, exclusion/check-constraint copy mapping, no delete, audit, `officers.manage` bound with an explicit DECISION-078 test: **all shipped, matching.**
- Table (not cards) at 360px for the roster: **shipped, and actually live-verified**, beyond what the design doc strictly required.
- **One genuine, minor drift**: nothing in Phase 1 explicitly promised a nav-row entry, but the portal already has a centralized flag-mirroring registry for exactly this (`src/lib/org-portal/tiles.ts`'s `PORTAL_TILES`, already driving directory/roles/tickets/feedback/members). Officers has no entry there — the surface is reachable only by direct URL today. **Acceptable drift, not a blocker** — a deliberate, correctly-scoped Phase 3 omission, not a defect — but it needs a tracked line (added below).

## Edge Cases

- Empty state: pass — specific, distinct copy for roster and history.
- Failure microcopy: pass — overlap/invalid_input/invalid_target/forbidden all map to human copy; genuine failures fall through to a generic message, never a stack trace.
- Permission gate: pass — `officers.manage` checked first everywhere, cross-org isolation covered by tests.
- Audit event: pass — fires only on success, correct shape.
- Mobile (360px): pass — live-verified, not just code-read.

**On the two flagged verification caveats:**
1. The F22 test's failing-then-passing cycle traced to a fixture-isolation bug, not a genuine pre-fix write-path defect — acceptable, not a gap. This test's job was never to reproduce F22's original bug at this layer (already proven at the SQL layer); its job is a positive proof the new application write path doesn't reopen the bug class, and it does that against real DB rows.
2. QA's code-only confirmation of the mobile fix (vs. a second independent live pass) is acceptable — the live browser check already happened once, thoroughly, by the implementer. The "Verify in a Browser" invariant was satisfied once, which is what it requires; re-mutating shared dev-DB flag/2FA state a second time for a CSS-only re-confirmation isn't warranted.

## Follow-Ups (housekeeping, not blockers — concrete for the orchestrator)

- `docs/TODO.md` — add a Done line for this pipeline (gap 1), mirroring the existing gap-2 Done line.
- `docs/TODO.md` — add a Next Up line naming the real nav-discoverability gap precisely: officers has no entry in `src/lib/org-portal/tiles.ts`'s `PORTAL_TILES` registry (not `org-states.tsx`, which is the older, non-load-bearing stub) — reachable only by direct URL today. Deliberate Phase 3 scope boundary, not a bug.
- `docs/product/functionality-map.md` — two edits: drop "officer-term management" from wherever it's listed as not-yet-built, and add an officers clause to the org-portal bullet (permission, flag, surface, no-delete discipline, F22 coverage), matching the existing roles/tickets sentence shape.
- Release notes — needed, none exists yet for this pipeline.
- What's-new (Rule 13): draft-but-defer, matching the established `org_portal.tickets`/`org_portal.roles` pattern — `org_portal.officers` ships seeded off, publish only once flipped on for a real org.
- Rule 12 (feedback row): not applicable — this pipeline's source is operator direction, not in-app feedback.
