# Founding administrator cannot reach Add person on the Members page — Work Log

> **Increment 2b numbers (re-assigned 2026-10-24):** migration 0065; DECISION-207/208 (reserved) plus DECISION-225–228; F186, F187, F192–F199 (reserved) plus F230–F236; worktree `presby-2b`, branch `pipeline/signin-invites`.
> **Slug:** `2026-10-22-founding-admin-directory`
> **Surface:** (org) — `/o/<slug>/admin/members`
> **Permission(s):** existing (`people.manage`, `directory.view`); the fix decides which gate is wrong
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Full — reclassified Bug-fix → Feature at Phase 1 (scope widened to F111 + participant enrolment by the operator)
> **Source:** operator, production, 2026-10-22: "i added myself as the admin for fpcw … however when i go into the fpcw portal i can't add members." The operator was the first real founding administrator, at their first test congregation, and accepted the invitation after the production test-data purge.
> **Reproduction (orchestrator, read-only prod queries):** the founding administrator holds `founding_administrator` (domains/groups/officers/org_features/people/role_grants/roles/staff manage, tickets.file) plus `congregation_stated_clerk` (statistics.publish), but **not `directory.view`**. `/o/<slug>/admin/members` loads its list through `getDirectory()`, which returns `forbidden` without `directory.view`, so the page renders `MembersForbidden` and the `people.manage`-gated "Add person" CTA never renders. This is the "KNOWN, NAMED Increment-1 coupling" in `admin/members/page.tsx`'s header comment. Before the purge it was masked by a dev-seed group grant (directory.view via Active Membership), and the founding administrator's own membership has no `current_roll`, so that grant would not reach them anyway (F111).
> **Pre-assigned numbers (Rule 16):** DECISION-197–201 · F172–F178 · migration 0061 · worktree `presby-fadir` · Neon branch `pipeline-founding-admin-directory` (`br-hidden-cake-axmde5m9`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (revised; reclassified to Feature) | READY WITH NOTES | 2026-10-22 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-22 |
| 3 — Technical design | tech-lead | Complete (design to R1-R14; S1-S6 ruled; route move designed as its own Batch M) | Design complete; implementers named | 2026-10-22 |
| 4 — Implementation | M full-stack-developer, A database-admin, B api-developer, C+D ux-developer (serial) | In progress: Batch M (route move) complete 2026-10-22; Batch A (0061) complete 2026-10-22; Batch B (server: lib, actions, audit) complete 2026-10-22; Batches C and D (UI, e2e, 360px pass) complete 2026-10-22 — Phase 4 Complete for Increment 1 | — | — |
| 5 — Verification | qa | Complete (run 1 FAIL on the stale integration patch only; run 2 PASS) | PASS | 2026-10-23 |
| 6 — Shipped vs intent | analyst | Complete (Increment 1); follow-ups 1–8 to TODO; release-note conditions A, B and wording fix C | SHIP WITH NOTES | 2026-10-23 |
| Inc 2 · 1 — Functional refinement | analyst | Complete; operator rulings Q1–Q3, Q6 recorded | READY WITH NOTES | 2026-10-22 |
| Inc 2 · 2 — Architectural review | architect | Complete. R1–R18; invites split to Increment 2b (R19–R26); migrations 0062/0063/0064; DECISION-202–208; F179–F191 | Approved with suggestions | 2026-10-22 |
| Inc 2 · 3 — Technical design | tech-lead | Complete (design to R1-R18; S1-S5 ruled; ten refinements named; DECISION-206 pending operator confirmation, pastor artifacts isolated). Batches A database-admin (0062, 0063), B api-developer, C+D ux-developer; Phase 4 waits for Increment 1 to merge | Design complete; implementers named | 2026-10-22 |
| Inc 2 · 4 — Implementation | A database-admin, B api-developer, C+D ux-developer (serial) | In progress: Batch A (0062 applied to the pipeline branch, twice; 0063 authored, rehearsed and reverted, for Batch B to apply) complete 2026-10-23; Batch B (server: library, actions, in-transaction audit; 0063 applied to the pipeline branch, twice, so the branch is in the lockdown state) complete 2026-10-23; Batches C and D (UI, e2e, hydration, 360px pass) complete 2026-10-23 — Phase 4 Complete for Increment 2 | — | — |
| Inc 2 · 5 — Verification | qa | Run 1 FAIL (2 copy defects) → ruling + fix 0e88167; Run 2 FAIL (bulk panel sentence) → fix 3dab58c; Run 3 (scoped) green: check 8/8, unit 7779/0, new pinning test fails on old dialog, community-approval 13/13 both widths after one Neon-drop re-run | PASS (run 3) | 2026-10-23 |
| Inc 2 · 6 — Shipped vs intent | analyst | Complete for Increment 2 (entry stays open for 2b and 3). Every Phase 1 verb works for the right person; two ruled drifts; can't-act states truthful with two copy nits; 11 follow-ups; 13 integration conditions incl. a manual bootstrap walk | SHIP WITH NOTES | 2026-10-23 |
| Inc 2b · 1 — Phase 1 addendum (sign-in invites) | analyst | Complete; operator rulings recorded (invite anyone recorded, incl. visitors; no disconnect; one at a time) | READY WITH NOTES | 2026-10-22 |
| Inc 2b · 2 — Architect addendum | architect | Complete. R27–R36; F192–F197 (G1 cites F177); defects F196/F197 in the shipped 0059 code to fix in 0064 | Approved with suggestions | 2026-10-22 |
| Inc 2b · 3 — Technical design | tech-lead | Complete, Phase 3a amendments folded in place (A1-A5, E1, S10, four F177 Option 3 conditions, staff-anchor note, A3 wording; DECISION-207/208, F186/F187 and the test plan updated; F177 Option 3 operator-confirmed). Design to R19-R36 and G1-G9; departures from R21/R23/R24 accepted by the architect with amendments. Batches A database-admin (0064), B api-developer, C+D ux-developer; Phase 4 waits for Increment 2's Phase 4 commits | Design complete, amendments folded in; implementers named | 2026-10-22 |
| Inc 2b · 3a — Architect review of design departures | architect | Complete. R23/R21 amended (A1–A5), R24 accepted with E1; F177 Option 3 endorsed; operator chose Option 3 | Approved with suggestions | 2026-10-22 |
| Inc 2b · 1b — Phase 1 addendum 2 (auto-connect, accept in place, reconciliation with v0.41–v0.42.2) | analyst | Complete; G10–G22; four operator questions with defaults; architect addendum needed (G10, G11, G13, G14, G15) | READY WITH NOTES | 2026-10-24 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator from the analyst's returned text (the analyst is read-only). The analyst returned twice: the first return (bug-fix scope), then a revision after the operator widened the scope mid-phase. Both are kept; the revision is authoritative.*

## Operator scope widening (2026-10-22, mid-Phase 1)

- "does the members page allow you to create community members. we have non members who participate and show up in the directory at our church" → F111 folded in.
- **Ruling (verbatim):** "i don't think you should need a role approve for participants".

## Revised return (authoritative)



This replaces my earlier return. The earlier findings are folded in, followed by the roll and approval analysis.

### VERDICT

**READY WITH NOTES, and reclassify: this is no longer a bug fix. Run it as a Feature, with Phase 2 mandatory.**

Why it is no longer a bug fix:
- It adds a new authority semantic: an approved-at-record roll action.
- It makes two permission bindings: `roll.propose` and `roll.approve`.
- It needs a data migration (0061 at minimum).
- It changes what flows into the filed statistics.
- It repairs a latent roll-cache defect that the participant path depends on.

Update the work-log's "Pipeline mode" line and note the reclassification in the Per-Phase Status table. No Phase 2 skip is available. The architect must rule on the four items listed under Handoff.

### ONE-LINE TAKE

> A new church's administrator needs to enter its real people, members and non-member participants, from the Members page. Today they cannot see the list, cannot enrol anyone, and nobody in the organization can ever approve a roll action. A participant enrolment should take effect on record, and member-roll actions should be proposed by the clerk and approved by the Session.

### The operator's immediate goal (unchanged)

The treasurer path works only through `/o/<slug>/admin/staff`, not through Members. Members is blocked by F111 and `roll.propose`. The Staff path needs these conditions:
- `org_portal.staff` must be ON.
- The email must be unique among active people at the organization.
- The staff person is created before any position is recorded.
- That person resolves in `resolveTreasurerPerson`, because it checks `ended_on is null` and ignores `current_roll`.

The new work does not block this path. Anyone entered through Staff stays out of Members and Directory (`engagement_status = 'staff'`). Entering real members through Members is the roll work below.

### Bug and root cause (condensed from the earlier return)

- **Symptom.** `getDirectory()` returns `forbidden` without `directory.view`, so `MembersForbidden` renders and "Add person" never draws (`members/page.tsx:137`).
- **The "no `current_roll` means the grant would not reach them" claim is wrong about the resolver.** Every membership, staff included, mirrors into the `active_membership` derived group (`drizzle/0017`, predicate `ended_on is null`). The baseline `member` role (`directory.view`, `events.view`) is bound to that group at provisioning (`org-provisioning.ts:250`). So an organization with the baseline role already grants `directory.view` to the founding administrator.
- **Likely real cause.** This organization has no org-owned `member` role (F133: created before DECISION-100, or by fixture). Needed: a read-only production check of whether the organization has the `member` role bound to its `active_membership` group, and whether the administrator has a live `group_memberships` row there.

### What the roll schema allows, and the ruling on participants

**Mechanics (read from migrations and `src/lib`, not the live catalog):**
- `roll_actions` has a freeze trigger, `BEFORE UPDATE OR DELETE` only (`0009`, fixed in `0028`). A pending row is mutable and deletable. An approved row is frozen and corrected only by a `void`.
- Nothing runs on insert and there is no CHECK on `approval_status`. I found no trigger or constraint in the migrations that forbids `approval_status = 'approved'` at insert, requires `approved_by`, or bars `approved_by = proposed_by`. `scripts/seed-dev.sql` inserts approved rows directly, so the path is exercised.
- The `AFTER INSERT OR UPDATE` trigger `presby_sync_current_roll` projects `current_roll` whenever the row is `approved`. A future-dated effective date waits for the daily reconcile (F29).
- Self-approval is allowed by design. `listPendingRollActions` shows a "you proposed this" flag and does not block it (`roll.ts:235`).
- So "who may approve" is not a database property today. It lives only in `decideRollAction()`, which checks `roll.approve`. This is a paper invariant. Phase 3 should confirm against the live catalog that no insert-time guard exists.

**SASR and directory:**
- `presby_roll_counts_as_of` counts `other_participant` through `presby_roll_as_of`. That function reads `resulting_roll` from approved, non-voided rows, and the count is included in Total Adherents.
- `presby_roll_changes` (gains and losses) covers the active roll only. `other_participant_enrolled` is in no gain line.
- So auto-approving this kind changes the participant count and Total Adherents, and no gain or loss line.
- The Directory already lists a person with `current_roll = 'other_participant'`, and any person with `engagement_status = 'regular'`. A person added through the wizard is listed today even while their action is pending. Approval changes only their status filter and their count in the SASR.

**Options weighed:**

| Option | Verdict | Why |
|--------|---------|-----|
| **A. Approve at insert for `other_participant_enrolled` only** | **Recommended** | Uses the existing mechanism: no new table, the sync trigger and replay work unchanged, the participant lands in the SASR count. |
| B. Participant record outside `roll_actions` | Reject | Forks the count from the system of record ("The Roll Is the System of Record"). The SASR would not see participants. |
| C. Hold the permission check in a SQL function | **Preferred way to build A** | Only one kind can skip approval, and the actor's permission is checked in the same transaction. This is how the project makes other authority checks (function-mediated). A bare TypeScript branch leaves it paper. |

**Conditions on A:**
- Only the kind `other_participant_enrolled` takes effect on record. Membership-roll kinds keep propose then approve. Whether `other_participant_removed` should also be immediate is an open question (below).
- The actor needs `roll.propose`, checked in the same transaction as the insert. I recommend no new permission key.
- **Audit.** An auto-approved row must write an `audit_events` row with a distinct action key, not the existing `tenant.roll_action.approved`. Otherwise "session approved" and "recorded without approval" look the same in the audit trail. A new `AUDIT_ACTIONS` key is needed. `check:audit` will require it.
- **No correction path (F175).** An approved row cannot be edited or denied, and the edit-time picker excludes `void`. A mistaken participant enrolment, whether the wrong person or the wrong date, would be permanent in the app. Ship decision for the operator: either include a void affordance for auto-approved participant rows, or ship without it and file a follow-up.
- **Effective date.** The row freezes immediately, so a date typo is permanent. The server should bound the date: not before the person's birth date, and not far in the future. The wizard only checks `YYYY-MM-DD` today (`people.ts:276`).
- **Self-approval.** `approved_by` equals `proposed_by` for these rows. That matches existing practice and needs no change.
- **Constitutional claim.** The "receiving members is a session act, other participants are not members" reasoning is the operator's. I record it as the ruling, not as something I verified against polity.

### A latent defect the participant path depends on (promote and fix in this pipeline)

`createPerson()` writes its `roll_actions` row with no `resulting_roll` and no `age_at_action` (`people.ts:464`, already filed at `docs/TODO.md:184`). `presby_sync_current_roll` then writes `current_roll = null` on approval. So a participant recorded through the wizard would be approved and still be counted nowhere. `roll.ts`'s `recordRollAction()` does set `resulting_roll`.

Same fix covers `age_at_action`: without it every profession-of-faith action reads as "18 and older" (`coalesce(age_at_action, 99)`).

This must be fixed first, or the participant ruling achieves nothing. Add a test that pins `current_roll` and the SASR count after recording a participant.

### Which role gets which permission

**Precedent.** DECISION-078 says `roll.propose` belongs to the Clerk of Session (register-keeping is the clerk's duty, "one accountable individual drafts"), and `roll.approve` belongs to the Session as a collective body. DECISION-155/F118 refused to put either in the founding-administrator bundle: `roll.propose` alone makes unapprovable pending actions, and both together would let one platform-designated person act as the Session.

**Recommendation:**

| Permission | Binding | Reason |
|------------|---------|--------|
| `roll.propose` | `congregation_stated_clerk` template. The founding administrator receives it through the clerk office role already granted at designation. Not in the bundle. | Passes the DECISION-078 test. Survives when the bootstrap role is dissolved. The subset ceiling is met because the clerk role itself holds it. |
| `directory.view` | Also on `congregation_stated_clerk` (the clerk keeps the register and must read it), as an alternative to adding it to the bundle | Same reasoning. An office-based grant outlives the dissolvable bootstrap bundle. |
| `roll.approve` | A new baseline `session_member` role for congregations, bound to the derived Session group, seeded at provisioning and backfilled for existing organizations. Not the clerk and not the founding administrator. | The Session decides collectively. Roster membership comes from `officer_terms`, which the founding administrator can enter with `officers.manage`. A template does not work here, because adopting it needs the adopter to already hold the key (F111 again). |

- **Wildcard rule.** No role carries both keys as a bundle. A clerk who is also a ruling elder holds both through two roles, as in real life. The wildcard rule is respected.
- **New decision for the architect.** Extending the baseline seed with a congregation-only role revisits the DECISION-100 note "do not add a conditional branch pre-emptively." That note anticipated this case. It needs an explicit ruling.
- **State to design for.** Until the Session roster is recorded, no one can approve membership-roll actions, and they queue. The wizard and Members page should say "Waiting for the Session to approve." The administrator currently cannot see the queue, because `/admin/members/pending` needs `roll.approve`.
- **Catalog rows may be missing (F174, unverified).** I found no migration that inserts `roll.propose` or `roll.approve` into the `permissions` table. They appear only in `scripts/seed-dev.sql:352`. If production lacks them, nothing can bind them. Migration 0061 must insert both (`on conflict do nothing`). Confirm by a read-only production query.
- **Backfill.** 0061 adds the new keys to the organization-owned copies of `congregation_stated_clerk`, on the `0057` pattern, since copies are made at designation and never topped up. It must target only `organization_id is not null` rows.

### User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (founding administrator / clerk) | Open Members and see the list or a limited state | on demand |
| Admin (clerk) | Add a member (propose) or a non-member participant (effective now) | on demand, heavily at set-up |
| Admin (Session member) | Approve or deny pending membership-roll actions | per session meeting |
| Admin (founding administrator) | Add a staff contact, then invite the treasurer | one-time |
| Platform admin | Send the treasurer invitation | one-time per church |

### Flows

**Flow 1, Members page.** Entry `/o/<slug>/admin/members`. With `directory.view`, the list or an empty state that mentions the Staff page. Without it but with `people.manage`, a limited state naming the missing permission. Without `people.manage`, the unchanged generic forbidden copy.
- Failure: database error shows `MembersLoadError`, unchanged.

**Flow 2, add a participant.** "Add person", pick "Enrolled as a participant". The person, membership and an already-approved roll action are written in one transaction. The person appears in Members and Directory with a correct status, and in the SASR count.
- Failure: no `roll.propose` shows "You don't have permission…" before the wizard starts, not at the end.

**Flow 3, add a member.** Same wizard, "Profession of faith". The action is proposed and waits. The success copy says it is waiting for the Session.
- Failure: the Session roster is empty, so it queues and says why.

**Flow 4, Session approves.** `/admin/members/pending`, unchanged except that real organizations now have approvers.

### Permissions and Flags

- **Permission(s):** existing keys only: `roll.propose`, `roll.approve`, `directory.view`, `people.manage`. No new `FEATURES.*` key and no new tenant permission.
- **Default roles:** as in the table above.
- **Flag(s):** none new. This follows the operator's earlier rule against new platform flags before go-live. Existing `org_portal.members_create` and its toggle stay as gates. Rollback is removing the added bindings (a data change).

### Gaps the Request Didn't Address

1. Production check (see Open Questions) before Phase 3.
2. `createPerson()` null `resulting_roll` and `age_at_action` (F173): fix in this pipeline.
3. Correction path for auto-approved rows (F175).
4. Effective-date bounds for rows that freeze on insert.
5. Distinct audit action key for auto-approval.
6. An org with an empty Session roster: wizard and Members copy for pending member actions, and the administrator's inability to see the queue.
7. The "Add person" button must not dead-end: gate it on `people.manage` and `roll.propose`, and for `people.manage` alone point to Staff when `org_portal.staff` is on.
8. The `/admin/members` empty state should say staff contacts live on the Staff page.
9. Other first-day walls (`branding.manage`, `events.manage`, `credentials.manage`): the earlier sweep stands. File them as follow-ups, not in this pipeline.
10. `other_participant_removed`: the edit-time picker excludes removal kinds because of F19 (no trigger ends memberships on removal). A participant removal would set the roll to null and leave the membership live. Decide whether to include it.

### Adversarial Pass (updated)

- **State-machine shortcut.** The wizard's server action currently rejects `kind: none` and accepts only the two wizard kinds. A client can still post any JSON, so the auto-approve decision must be made server-side from the kind alone, never from a client flag.
- **Escalation.** Only `other_participant_enrolled` may skip approval. A forged payload with a membership kind must be treated as proposed, never approved.
- **Self-targeting.** An actor enrolling themselves as a participant is harmless: the row is a participant, not a membership.
- **Enumeration.** Unchanged generic forbidden copy for non-`people.manage` callers.
- **Cross-tenant.** The new function must derive the organization from `presby_current_org()`, not a parameter.
- **Statistics.** An auto-approved participant flows into the filed participant count with no minute reference. The clerk's publish step is the review point. Say so in the decision.

### Out of Scope (confirm with user)

- A bulk import of real people (Track K).
- Removal and transfer kinds and the F19 trigger.
- Showing staff-kind people in Members or Directory.
- The other first-day permission walls.
- Any change to the treasurer invitation.

### Open Questions

1. **Production read-only check, now:** does the organization have the baseline `member` role bound to `active_membership`? Does the administrator have a `group_memberships` row there? Do `roll.propose` and `roll.approve` exist in the production `permissions` table? Is `org_portal.staff` ON? Count organizations lacking a `member` role.
2. **Operator:** should `other_participant_removed` also take effect on record, or keep approval?
3. **Operator:** include a void affordance for mistaken participant enrolments now, or ship without it and file a follow-up?
4. **Operator:** is it acceptable that member-roll proposals wait until the Session roster is entered? Or should the first elders be seeded another way?
5. **Operator:** `directory.view` through the clerk template, or also in the bundle?

### Proposed numbers (the orchestrator should reserve them under Rule 16)

- **DECISION-197:** the founding administrator's directory access, including the `member`-role root cause and the Members-page degrade.
- **DECISION-198:** participant enrolment takes effect on record. Mechanism, audit key, date bounds.
- **DECISION-199:** `roll.propose` and `directory.view` bind to the `congregation_stated_clerk` template, with backfill.
- **DECISION-200:** `roll.approve` through a congregation baseline Session role.
- **F172:** the Members wall and its mechanism (the `member` role gap).
- **F173:** `createPerson()` null `resulting_roll` and `age_at_action` (promoted from `docs/TODO.md:184`).
- **F174:** roll permission catalog rows possibly absent from migrations (unverified).
- **F175:** no correction path for auto-approved rows.
- **Migration 0061:** one migration, or two if the pipeline splits.

### Handoff

Next agent: **architect (Phase 2, mandatory)**. Rulings needed:
1. Approve-at-insert as a SQL function versus an application branch, and its audit key.
2. The congregation baseline `session_member` role as an extension of DECISION-100, versus an alternative.
3. `roll.propose` and `directory.view` on the clerk template rather than the bundle.
4. Whether to split into two increments. Increment 1 is the directory and Members-page fix, the `createPerson()` roll-cache fix, `roll.propose` on the clerk, and participant enrolment. Increment 2 is the Session baseline role and queue visibility. I recommend splitting, because the operator's immediate need is only Increment 1 and member-roll proposals would otherwise sit unapprovable.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (revised for scope widening; pipeline reclassified Bug-fix to Feature) | READY WITH NOTES | 2026-10-22 |

Files read (all under `/Users/cshenso/git/presby-platform/presby-fadir`):
- `src/lib/people.ts`
- `src/lib/roll.ts`
- `src/lib/roll-action-kinds.ts`
- `src/lib/directory.ts`
- `src/lib/org-provisioning.ts`
- `src/lib/db/domain/roll.ts`
- `src/app/(org)/o/[slug]/admin/members/new/actions.ts`
- `drizzle/0009_presby_rls.sql`
- `drizzle/0012_presby_roll_read.sql`
- `drizzle/0017_presby_membership_roster.sql`
- `drizzle/0027_presby_member_management.sql`
- `drizzle/0028_presby_people_write_rls_fix.sql`
- `drizzle/0052_presby_withdraw_publication.sql`
- `drizzle/0057_presby_org_domains.sql`
- `drizzle/0059_presby_account_invitations.sql`
- `scripts/seed-dev.sql`
- `docs/decisions.md` (DECISION-078, DECISION-155)
- `docs/TODO.md` (lines 184 and 193)

## First return (bug-fix scope, superseded)

## Phase 1 — Functional Refinement (analyst), bug-fix variant

The bug is real, but the work-log's stated mechanism is probably wrong. Fixing the bug as described will not let the operator add their treasurer from the Members page. I read only the worktree and ran no production queries.

### VERDICT

**READY WITH NOTES**

The notes are four findings that Phase 2 and 3 must carry:
- The treasurer path is blocked on Members.
- The root cause needs a production check first.
- The "Add person" button would dead-end for this role.
- Other first-day pages have the same wall.

### ONE-LINE TAKE

> A new church's founding administrator can be told "you may manage people" but cannot see, find or enrol anyone. The visible symptom is `directory.view`, but the deeper cause is a baseline grant that did not reach this organization, plus the known roll gap (F111).

### The operator's immediate path

**Blocker: `/o/<slug>/admin/members/new` does not work for this founding administrator, with any roll action.**

- **"none" is not offered.** The wizard schema offers only two kinds (`WIZARD_ROLL_ACTION_KINDS`, `member-wizard-schema.ts:61`).
- **"none" is rejected on the server.** `createPersonAction` returns "A roll action is required to add a new member" (`members/new/actions.ts:90`).
- **Any real roll action needs `roll.propose`.** `createPerson()` demands it (`people.ts:308`), and the bundle lacks it by design (F111/F118). The operator would see "You don't have permission to add members here."

**The path that should work today: `/o/<slug>/admin/staff`, then "Can't find them? Add a new person".**

- **Permissions.** `createStaffPersonAction` needs `staff.manage` and `people.manage`, and the bundle has both.
- **What it writes.** It pins `rollAction: { kind: "none" }` and takes an optional email. It creates a person, a `contact_methods` email row, and a `memberships` row with `engagement_status = 'staff'` and `ended_on` null.
- **The person is committed on its own.** Creation does not wait for a staff position to be recorded, so the operator can add the person and stop there.
- **`resolveTreasurerPerson` will then find the person** (`issue.ts:290`).
  - It matches `lower(btrim(cm.value))` against the normalized email.
  - It joins `memberships` on `person_id` and organization.
  - It treats `ended_on is null` as active.
  - It does not look at `current_roll` or `engagement_status`, so a staff-kind membership qualifies.

**Conditions for the Staff path to work (I cannot confirm any of these from the worktree):**
1. The `org_portal.staff` global flag is ON in production. `docs/TODO.md:192` says it ships seeded OFF, and the Staff page has no per-org toggle. If it is OFF the operator sees `StaffFlagOff`. The only fixes are a flag flip by the platform admin or SQL. I suggest the operator checks this first.
2. The email must be unique among active people at the organization. Two active people with the same normalized email give `ambiguous_person`. Do not reuse the operator's own address.
3. The remaining invitation gates are `giving.manage` holder count 0, both `treasurer` and `giving_recorder` templates present, and TOTP configured. These are likely fine but not verified.

**Not blockers, but the operator will notice:**
- After the person is added, they appear in neither Members nor Directory. `engagement_status = 'staff'` is excluded from the directory predicate on purpose (DECISION-129). The only place to see them is the Staff form's person dropdown.
- There is no way to reach the person's edit page, because the edit page is only reachable from the Members list.

### Is the bug real, and what is the cause

**The symptom is real.**
- `getDirectory()` returns `forbidden` when the caller lacks `directory.view` (`directory.ts:692`).
- The page then renders `MembersForbidden` before it computes `canCreate`, so "Add person" is never drawn (`members/page.tsx:137`).
- The header comment calls this a "KNOWN, NAMED Increment-1 coupling."

**The "no `current_roll` means the group grant would not reach them" claim is wrong about the resolver.**
- Every membership row, including a staff one, is mirrored into the org's `active_membership` derived group by trigger (`drizzle/0017`). The only predicate is `ended_on is null`.
- `createOrganization()` seeds a `member` role holding `directory.view` and `events.view`, granted to that group (`org-provisioning.ts:250`).
- `presby_accept_invitation` inserts a staff membership for the founding administrator.
- So an organization created through `createOrganization()` after DECISION-100 would already give the founding administrator `directory.view`. `current_roll` governs who appears in the list, not who may call it.

**The likely real cause is a missing baseline `member` role at this organization.**
- This is F133 (`docs/TODO.md:129`): organizations created before DECISION-100, or by fixture SQL, have no `member` role.
- That would also explain the missing `events.view`.
- I recommend one read-only production check before Phase 3. Does the organization have an org-owned `member` role bound to its `active_membership` group? Does the founding administrator's person have a live `group_memberships` row in that group? The answer decides the fix.

**The organization-wide grant should be the cause, not the bundle.** The founding administrator is meant to reach `directory.view` the same way every member does. Putting it only in the bundle would fix the administrator but leave every ordinary member of that organization without directory or calendar access.

### Weighing the candidate fixes

**(a) Add `directory.view` to the founding-administrator bundle: viable, but it treats a symptom if the cause is a missing member role.**
- **Tier rules.** `directory.view` is tier 1 and not a wildcard. The bundle already carries `people.manage`, which can edit any person, so no new data becomes readable. `directory.view_hidden` must stay out. This is consistent with "No Role Carries a Wildcard."
- **Side benefit.** Under the subset rule, the administrator could then adopt and grant templates that carry `directory.view`, such as `committee_chair`.
- **Edit points (three must change together):**
  1. `foundingAdministratorPlan()` in `src/lib/onboarding/founding-administrator.ts`.
  2. `presby_founding_administrator_permission_keys` in SQL. `0059` shipped in v0.37.0, so this needs a `create or replace` in the new migration `0061`, not an in-place edit.
  3. A backfill: `insert into app_role_permissions … where key = 'founding_administrator' and organization_id is not null on conflict do nothing`, copying `0057` section 2.
- **Why the backfill is required.** The `founding_administrator` role is reused and topped up only on re-designation. A role already created, including the operator's, is not touched without a migration.
- **Pinned artifacts.** The pinning test `invitations.db.test.ts:564` and the golden snapshot `designation-parity.golden.json` must be updated.
- **A residual to state.** A migration backfill re-adds a key that a `roles.manage` holder deliberately removed from that role. `0057` has the same residual.
- **Production impact.** Likely one role (the operator's test organization), but this should be measured, as `0057` did.

**(b) Make the Members page degrade for a `people.manage` holder without `directory.view`: worth doing, and not sufficient alone.**
- Without `directory.view` there is still no list, so the administrator still cannot find anyone to edit. A role with `people.manage` but not `directory.view` is incoherent for any custom role, so the page should degrade honestly.
- Render the header, the "Add person" button if the user can actually use it, and an explanatory state naming the missing permission instead of the generic "You don't have permission to do that."
- Keep `MembersForbidden` unchanged for callers without `people.manage`. The new state reveals nothing the caller could not already reach at `/new`.
- **If "Add person" shows to an administrator without `roll.propose`, the button leads to a dead end.** It would show an error toast after the whole wizard. Gate it on `people.manage` and `roll.propose`. For `people.manage` without `roll.propose`, show a line pointing to Staff instead (when `org_portal.staff` is on). This is a design ruling for Phase 3 and the operator, not an analyst decision.

**(d) Backfill the baseline `member` role and group grant for organizations that lack it: the root fix if the production check confirms it.**
- This closes F133 for ordinary members too.
- It is a data change with broader reach (every current member of each such organization gains `directory.view` and `events.view`), and DECISION-100 already says that is the intended default.
- It is not a flag, so it is consistent with the "no new platform flags" memory.

**Recommendation.** Do (b) in all cases. Do (d) if the check shows a missing `member` role. Use (a) only if the member role exists and the administrator still lacks `directory.view`, which would be a different bug. If the operator wants a belt-and-braces administrator regardless, (a) is cheap and safe, so (c) is defensible. Adding both (a) and (d) in one migration needs the architect to confirm it is one decision, not two.

### User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (org founding administrator) | Open Members; add a person with an email | one-time at set-up, then on demand |
| Admin (org founding administrator) | Open Staff; "Add a new person"; record a position | one-time, then on demand |
| Platform admin | Send the treasurer invitation from the platform page | one-time per church |
| Invited treasurer | Accept the invitation | one-time |

### Flows

**Flow 1, Members page (the bug).**
1. Entry: `/o/<slug>/admin/members`.
2. The page checks the flag and toggle, then `getDirectory()`.
3. Outcome today: `MembersForbidden`, with no way forward.
4. Desired: a limited state with a path that works.
- Failure: a database error shows `MembersLoadError`. That is fine and unchanged.

**Flow 2, add a person through Members.**
1. Entry: "Add person".
2. The wizard has search, identity, contact, household, roll action and review steps.
3. Submit fails for this role (see the blocker above).
- Failure: the toast says "You don't have permission to add members here." That is honest, but it arrives at the end of the wizard.

**Flow 3, add a person through Staff (the working path).**
1. Entry: `/admin/staff`, then "Add a new person" with a name and an email.
2. The person is committed with a staff-kind membership.
3. The treasurer invitation resolves them by email.
- Failure: if the flag is off, `StaffFlagOff`. If the email matches two active people, `ambiguous_person`.

### Permissions and Flags

- **Permission(s):** reuse `directory.view` (tier 1), `people.manage`, `roll.propose`. No new key.
- **Default roles:** founding administrator, via (a) if chosen. The baseline `member` role, via (d), already carries `directory.view`.
- **Flag(s):** not needed. Existing `org_portal.members_create` and `org_portal.staff` remain the gates. No new global flag.
- **Rollback.** For a migration backfill, rollback is a delete of the added row. It touches no grant or audit data.

### Gaps the Request Didn't Address

1. **F111 is the real wall for adding people.** Fixing the Members page only moves the dead end to the wizard submit. This should be named in the Phase 3 design and in `docs/TODO.md:193`.
2. **Same wall on other first-day pages.** The admin hub shows every tile regardless of permission (`visible-tiles.ts:31`: "no `*.view`/`*.manage` is consulted"), so a missing key gives a "forbidden" page behind a visible tile. Sweep results for the bundle (`people`, `roles`, `role_grants`, `groups`, `officers`, `org_features`, `tickets.file`, `staff`, `domains`) plus the clerk's `statistics.publish`:

   | Page | Gating permission | Founding administrator |
   |------|-------------------|------------------------|
   | Roles, Officers, Groups, Staff, Features, Domains | own `*.manage` | works (flags permitting) |
   | Members list | `directory.view` | wall |
   | Directory | `directory.view` | wall |
   | Members, Add person | `roll.propose` | wall (F111) |
   | Members, Pending | `roll.approve` | wall |
   | Branding | `branding.manage` | wall |
   | Events | `events.manage` | wall |
   | Credentials | `credentials.manage` | wall |
   | Giving admin | `giving.manage` | by design, via treasurer invitation |
   | Worship, Committees, Communications, Insights | not verified | unknown, likely placeholders |

   I did not trace every one of these to a confirmed gate. Phase 3 should file the confirmed ones as follow-ups and not widen this fix.
3. **Empty state after the fix.** Even with `directory.view`, the Members list will read "No members yet" on a fresh install, because staff-kind people are excluded. The empty state should say that staff contacts live on the Staff page.
4. **Home page quiet degrade.** The portal home hides find-a-person and the household card without `directory.view` (`home-data.ts:95`), with no copy. That is consistent and acceptable, but it is the same missing-key class.
5. **Edit page degrade.** `members/[id]/edit` is safe: `getHouseholds()` degrades to an empty list. It is also unreachable without the list.

### Adversarial Pass

- **Redirect targets:** none new.
- **State-machine shortcut:** `/members/new` is already directly reachable, and every check is server-side in `createPerson()`. The Members page change must not become the only gate, and it is not.
- **Enumeration:** the new limited state must show only for a `people.manage` holder. A caller without it must get the unchanged generic forbidden copy, byte-identical.
- **Input boundaries:** server-side in `createPerson()`. Not changed.
- **Self-targeting:** the administrator granting themselves new keys is bounded by the subset rule. No new self-grant path.
- **Backfill scope:** the migration must target only org-owned `founding_administrator` rows (`organization_id is not null`), not the template rows.
- **Audit:** the backfill is a permission change by migration with no actor, same as `0057`. No `audit_events` row is needed, but say so in the decision.

### Out of Scope (confirm with user)

- Fixing F111 (roll enrolment ceiling), a separate pipeline.
- Showing staff-kind people in Members or Directory.
- Adding `branding.manage`, `events.manage` or `credentials.manage` to the bundle.
- Gating admin hub tiles by permission.
- Any change to treasurer invitation logic. It works for this path.

### Open Questions

1. **For the operator, now:** is `org_portal.staff` ON in production? If not, flip it or the Staff path shows `StaffFlagOff`.
2. **Read-only production check (orchestrator or deployment-engineer):** does the founding administrator's organization have an org-owned `member` role holding `directory.view` and `events.view`, granted to its `active_membership` group? And does the administrator's person have a live `group_memberships` row in that group? This decides between (a), (d) and both. Count the production organizations lacking a `member` role for F133 at the same time.
3. **Operator ruling:** should "Add person" on Members be hidden for a `people.manage` holder without `roll.propose`, and replaced with a pointer to Staff?
4. **Operator ruling:** is it acceptable that the backfill re-adds `directory.view` to any `founding_administrator` role where someone removed it?

### Handoff

Next agent: **architect (Phase 2)**. Recommend a short review, not a skip. A migration (`0061`) that widens a bundle and possibly backfills baseline roles touches the permission model and the tier invariants. The architect should rule on (a) versus (d), the three-place bundle edit (TS, SQL, backfill), and whether the Members page change is in this bug fix or deferred. Numbers: DECISION-197, F172, migration 0061.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-22 |

Files read (all under `/Users/cshenso/git/presby-platform/presby-fadir`):
- `docs/work-log/2026-10-22-founding-admin-directory.md`
- `src/lib/onboarding/founding-administrator.ts`
- `src/lib/onboarding/issue.ts`
- `src/app/(org)/o/[slug]/admin/members/page.tsx`
- `src/app/(org)/o/[slug]/admin/members/new/page.tsx`
- `src/app/(org)/o/[slug]/admin/members/new/actions.ts`
- `src/app/(org)/o/[slug]/admin/staff/actions.ts`
- `src/app/(org)/o/[slug]/admin/staff/add-staff-position-form.tsx`
- `src/lib/people.ts`
- `src/lib/directory.ts`
- `src/lib/org-provisioning.ts`
- `drizzle/0017_presby_membership_roster.sql`
- `drizzle/0057_presby_org_domains.sql`
- `drizzle/0059_presby_account_invitations.sql`

## Orchestrator production checks (read-only, 2026-10-22, after the analyst returned)

- The first test congregation **has** an org-owned `member` role (`directory.view`, `events.view`), and the founding administrator **is** in its Active Membership group. Its group grant was the `dev-seed:`-reasoned row the orchestrator ended and then deleted in the morning's test-data purge — **the purge caused the immediate symptom** (orchestrator error: the baseline member grant was misread as test residue by its reason prefix). Restored on production with operator approval: one `role_grants` row, member role → Active Membership, starts 2026-10-22, reason citing DECISION-100 and the restore.
- The presbytery org has **no** `member` role (F133 still real there).
- `roll.propose`, `roll.approve`, `directory.view` **exist** in production `permissions` (F174: present in prod; whether a migration seeds them on a fresh install is still for Phase 2/3 to confirm).
- `org_portal.staff` is **ON** in production.

---

### Operator rulings on the Phase 1 open questions (2026-10-22)

- **Q2, `other_participant_removed`:** **"Yes, include now".** Removing a participant takes effect on record, with no approval, the same as enrolment. This brings F19 into scope for that kind: no trigger ends the membership on removal, and a removal would otherwise null the roll and leave the membership live. The architect must rule on how the membership ends.
- **Q3, correction path (F175):** **include an undo.** A void of a mistaken participant enrolment or removal, recorded and never deleted.
- **Increments:** **two steps.**
  - Increment 1, now: directory access and the Members-page degrade; the `createPerson()` fix for `resulting_roll` and `age_at_action` (F173); `roll.propose` on the clerk; participant enrol and remove taking effect on record; void.
  - Increment 2, next: a congregation baseline Session role carrying `roll.approve`, plus visibility of the pending queue. Member-roll proposals queue until then, and the copy says so.
- **Q5, `directory.view` via the clerk template or the bundle:** not put to the operator. The analyst's default is the clerk template. The immediate production symptom was fixed by restoring the baseline member grant (see the orchestrator checks above).

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator from the architect's returned text (read-only agent). Operator additions folded in mid-phase (visitors; participant/visitor→member paths; soft deletes; "Community"; staff-in-community), then the operator asked that the newest ideas be verified rather than taken as rulings — hence the verdicts table.*

**Orchestrator number assignment:** the two unnumbered findings below are **F177** ((a) active_membership admits visitors/staff anchors — close before member self-service sign-in) and **F178** ((b) match step says "another organization" for someone already here).



*Returned as text. The architect is read-only. Orchestrator: record this verbatim, including the proposals table.*

## Operator proposals: verdicts

| Proposal | Verdict | Reason and the shape adopted |
|---|---|---|
| **Visitors in Increment 1** | **Adopt, minimal form.** | The firm rulings already require visitor→participant and visitor→member paths, and those need a visitor record. The schema already has the fields: `engagement_status` defaults to `'visitor'`, and `first_visit_date` and `how_heard` sit on `memberships`. Polity is fine: a visitor is not a roll category, and engagement is the pastoral axis, which is never reported. Increment 1 includes a Visitor choice in Add person, an admin-only visitor list, and match-step "already here" detection. The `follow_ups` workflow UI goes to Increment 3. Visitors never appear in the member Directory. |
| **Staff are part of the Community** | **Partly right. Adopt "staff is a position", reject "community first".** | Staff *is* a position (`staff_positions`), so a staff badge or filter should come from a live position row, not from `engagement_status`. But "you are part of the community before you can be on staff" is false as a rule. Churches hire organists, sextons and outside bookkeepers who worship elsewhere or nowhere. DECISION-128/129 created the `'staff'` anchor so that no roll fact is invented for such a person. Forcing them into visitor, participant or regular would invent a *pastoral* fact for the same reason. Adopted shape: the admin Community list gets a **Staff filter derived from open `staff_positions` rows**, whatever the engagement. `engagement_status = 'staff'` stays as the anchor value, with no data migration. DECISION-129's exclusion from the Directory stands. The Staff page's create flow is unchanged in Increment 1. |
| **Rename Members → Community** | **Adopt the label. Defer the route move.** | In PC(USA) usage "member" means the roll categories (active, baptized, affiliate), and other participants are expressly not members. A section that holds visitors, participants, staff anchors and members is mislabelled as "Members". "Community" is acceptable. One small collision: "new worshiping community" is an org type. "People" is the neutral alternative and matches the existing `people` domain; that is the operator's call, and the default is "Community". The route `/admin/members` stays in Increment 1. Moving it touches 122 references in about 55 files, and mixing that into a diff that also carries migration 0061 and two SECURITY DEFINER functions would bury the security-relevant changes. File the move as its own Polish pipeline with a permanent redirect. |

## Verdict

**Approved with suggestions.** The required conditions R1–R14 are below. Phase 3 must design to them. The suggestions S1–S6 are Phase 3's call.

## Placement

- **Directory placement:**
  - `drizzle/0061_presby_participant_roll.sql`: one hand-written migration, idempotent in the 0057 style. 0060 belongs to the parallel pipeline and 0058 is reserved. `drizzle/meta/_journal.json`, `scripts/test-rls.sql` and `scripts/seed-dev.sql` are edited only at integration (Rule 16).
  - `src/lib/db/domain/roll.ts`: Drizzle mirror of any new CHECK constraints and indexes.
  - `src/lib/roll-action-kinds.ts` (plain shared module):
    - `ON_RECORD_ROLL_ACTION_KINDS = ['other_participant_enrolled','other_participant_removed']`, pinned equal to the SQL function's list by a test.
    - A pure `deriveRollFields(kind, dateOfBirth, effectiveDate)` that returns `resultingRoll` and `ageAtAction`. It replaces `roll.ts`'s private `ageAsOf`, so `createPerson()` and `recordRollAction()` share one derivation.
  - `src/lib/roll.ts`: `recordParticipantAction()`, `voidParticipantAction()`, and an `OrgTx`-level helper that `createPerson()` calls inside its existing transaction. Roll mutations live here, per the 2026-08-26 placement ruling.
  - `src/lib/people.ts`:
    - the `createPerson()` fix for F173;
    - a new visitor arm;
    - the participant kind routed through the roll helper;
    - `matchPerson()` annotates each candidate with `alreadyHere`, using an RLS-scoped `memberships` read in the org transaction.
  - **New `src/lib/community.ts`** (`server-only`): `listVisitors()`, `listStaff()` and `listFormerParticipants()`, each gated on `people.manage`. `directory.ts` never imports it. A source-scan test pins that `getDirectory()`'s predicate never admits `'visitor'` or `'staff'`. Keeping these in a separate file is how visitors stay out of the member Directory.
  - `src/lib/audit.ts`: two new keys (R8).
  - `src/app/(org)/o/[slug]/admin/members/**`: the page, the wizard, and new forms and actions under `[id]/edit/`.
  - `src/lib/org-portal/tiles.ts`: label and description only. The tile key `members` and the flag key `org_portal.members_create` keep their names.
- **Server vs client split:**
  - The list page stays a Server Component. The Members, Participants, Visitors and Staff filters are server-rendered links (searchParams), following the `directory-nav` button-group pattern.
  - The wizard is already client. It gains the Visitor choice and the first-visit and how-heard fields, and keeps its `HydrationGate`.
  - The new "Remove as participant" and "Undo last entry" forms are client components. They use the existing `alert-dialog.tsx` primitive (Rule 2) and need `HydrationGate` if they use `useForm` (`check:hydration-gate`).
  - Server actions are co-located in `[id]/edit/actions.ts` and reference `AUDIT_ACTIONS` (`check:audit`).
- **Dependencies:** none.

## Rulings on the questions asked

**1. Approve-at-insert happens in a SECURITY DEFINER function, not an application branch (DECISION-198).**
- **Live catalog (pipeline branch):**
  - `roll_actions` is FORCE RLS with the single permissive `tenant_isolation` policy.
  - `presby_app` holds full `INSERT/UPDATE/DELETE`.
  - There is no CHECK on `approval_status` (free text), no void-shape constraint, and no insert-time guard.
  - Triggers: `roll_actions_freeze` (`BEFORE UPDATE OR DELETE`) and `roll_actions_sync_current` (`AFTER INSERT OR UPDATE`).
  - So today any `presby_app` path can insert an approved row, and `decideRollAction()` is the only gate. That is a paper invariant.
- **R1. The functions:**
  - `presby_record_participant_action(p_person_id uuid, p_kind roll_action_kind, p_effective_date date, p_minute_reference text, p_recorded_by uuid)`
  - `presby_void_participant_action(p_roll_action_id uuid, p_reason text, p_recorded_by uuid)`
  - Both are `security definer`, `set search_path = public, pg_temp`, with `revoke all … from public` and `grant execute` to `presby_app` only.
- **R2. The org comes from `presby_current_org()`.** There is no org parameter (the confused-deputy rule in 0052 note 2). Null org raises.
- **R3. The actor is a bounded identity claim,** following 0052 note 3 and `presby_giving__actor_may_record`:
  - `p_recorded_by` is a `users.id`, bound server-side from the session, never from client input.
  - The function resolves the user's live, unmerged person, then requires `presby_membership_is_active(person, org)` and `presby_has_permission(person, org, 'roll.propose')`.
  - All of this happens inside the caller's `withOrgContext` transaction, so the permission check and the write cannot drift apart.
  - An identity refusal raises one uniform `insufficient_privilege` literal. State refusals come back as typed outcomes (the DECISION-188 style), so TypeScript maps them without parsing messages.
  - No `app.current_user_id` GUC is introduced. That stays the open item 0044/0047 already name.
- **R4. The kind decides.** Only kinds in `ON_RECORD_ROLL_ACTION_KINDS` are accepted, and anything else is refused. `createPerson()` and `recordRollAction()` call the function for `other_participant_enrolled` whichever surface the request came from. A forged membership kind still goes down the pending path.
- **R5. A restrictive insert policy,** `roll_actions_insert_pending_only … as restrictive for insert to presby_app with check (approval_status = 'pending')`.
  - With it, "approved at insert" is reachable only through the definer function (owner `neondb_owner`, `rolbypassrls = t`, confirmed live).
  - Known cost: `scripts/test-rls.sql` §20d (around line 1426) and `src/lib/roll.test.ts:545` insert approved rows as `presby_app`. Rewrite them as insert-pending-then-update. `test-rls.sql` is changed at integration.
  - The approval UPDATE path stays application-gated on `roll.approve`, as today. That is Increment 2's concern; see the notes at the end.
- **R6. Serialization.** Each function begins with `select … from memberships where person_id = $1 and organization_id = v_org for update`. That serializes enrol, remove and void for one person.

**2. Audit keys (DECISION-198).**
- **R8.** Two new `AUDIT_ACTIONS` keys:
  - `ROLL_ACTION_RECORDED: "tenant.roll_action.recorded"` for an enrolment or removal that takes effect on record. Metadata: `organizationId`, `rollActionId`, `kind`, `effectiveDate`, `membershipEnded`.
  - `ROLL_ACTION_VOIDED: "tenant.roll_action.voided"`. Metadata: `organizationId`, `voidRollActionId`, `voidsActionId`, `voidedKind`, `reason`, `membershipReopened`.
- Both are written with `insertAuditRow()` (`src/lib/audit-tx.ts`) **inside the same transaction**, not with `recordAudit()`, which opens its own connection and swallows failures. A constitutional record written without approval must not commit without its audit row.
- The existing `tenant.roll_action.approved` is never reused, so "the Session approved" and "recorded without approval" stay distinct.
- Metadata carries ids only, no names.

**3. F19 for `other_participant_removed`: the function ends the membership (DECISION-198).**
- **R9. Removal, in the same function and transaction:**
  - **Preconditions:**
    - the person's latest effective action is an `other_participant_enrolled`, so the replay as of today is `'other_participant'`;
    - `p_effective_date` is on or after that enrolment's date and on or before `current_date`;
    - the person has **no pending roll action** at the org (outcome `pending_action`);
    - the target is not the actor;
    - the person has no open `staff_positions` row (outcome `holds_position`; S5 explains why).
  - **Writes:**
    - insert the approved `roll_actions` row with `resulting_roll = null`;
    - `update memberships set ended_on = p_effective_date, ended_reason = '<fixed marker>'`.
  - `memberships_guard_end` (DECISION-039 direction 1, live and not definer) refuses when an officer term or a person-arm role grant is still open. The function catches that `check_violation` in a sub-block and returns `holds_position`. **It never auto-ends a term**, as the guard's own comment requires.
  - **Downstream effects, all verified by reading:**
    - `memberships_sync_derived_group` sets the derived `group_memberships.ends_on`, so the baseline `member` grant lapses by date;
    - `presby_membership_is_active` turns false, so `withOrgContext` refuses;
    - `resolveOrgContext` returns the named-and-dated `ended` response (DECISION-040);
    - `getDirectory()` drops the person (`ended_on is null`).
  - **Why removal is never future-dated:** `ended_on is null` is the sole "current" predicate (DECISION-065), so a future `ended_on` would end access today while the replay still said participant.
- **Participant → member must not go through removal.** The pending-action refusal, together with edit-page copy ("To receive this person as a member, record a profession of faith or another gain. No removal is needed."), keeps the two paths apart. A gain supersedes the participant roll by replay on the same membership row.

**4. Void mechanics (DECISION-198, F175).**
- **R10. What may be voided:** only the person's **latest effective action** (ordered by `effective_date desc, recorded_at desc` over `presby_effective_roll_actions`), only of an on-record kind, and only if it is not already voided.
- **The void row:**
  - `kind = 'void'`, `voids_action_id` set, approved at insert, `approved_by` and `proposed_by` set to the actor, `effective_date = current_date`, `resulting_roll = null`;
  - **`person_id` equal to the voided row's `person_id`.** The live `roll_actions_voids_fk` is only `(voids_action_id, organization_id)` and does not enforce this. A mismatch would make `presby_sync_current_roll` recompute the wrong person.
- **Replay is verified correct with no change:** `presby_effective_roll_actions` excludes `kind = 'void'` and any row referenced by an approved void, and both `presby_roll_as_of` and `presby_sync_current_roll` read only that view. The void insert fires `roll_actions_sync_current` (AFTER INSERT, approved), which recomputes `current_roll`. All on-record rows are dated on or before today, so `presby_roll_cache_drift()` stays at zero. Phase 4 asserts it.
- **Voiding a removal reopens the membership** (`ended_on = null, ended_reason = null`) only when `ended_on` equals the voided removal's date **and** `ended_reason` equals the removal's fixed marker. Otherwise the outcome is `membership_changed`. `memberships_guard_end` does not fire on a transition to null. The derived-group sync re-opens the group row.
- **Voiding an enrolment** returns the person to the prior replay state. It does not touch the membership. The person goes back to Visitors (if engagement is `'visitor'`) or to the listed, no-status shape (if `'regular'`).
- **A void needs an entry point after removal**, because the removed person leaves every live list. The success toast offers Undo, and the admin list offers a "Former participants" filter (`listFormerParticipants()`: `ended_reason` equals the marker).
- **The reason is required.** It is stored in the audit row, since `roll_actions` has no void-reason column and `denial_reason` must not be overloaded.

**5. Effective-date bounds (DECISION-198).**
- **R11. Both on-record kinds:**
  - not after `current_date`;
  - not before the person's date of birth (when known), and not before `1900-01-01` as a sanity floor;
  - on or after the person's latest effective action date, so the new row becomes the latest.
- **Enrolment also** requires the replay roll as of today to be null. Enrolling an active, baptized or affiliate member "as a participant" on record would be an active-roll loss with no Session action and no SASR loss line. It also requires a live membership, so it is refused on an ended one, and no pending action (the same shadowing reason as R9).
- **S1.** `recordRollAction()` should reject or warn on a *proposal* dated before the person's latest effective action. Otherwise the Session's eventual approval is shadowed by replay ordering.

**6. SASR impact (DECISION-198).**
- Enrolment raises `other_participant` and Total Adherents from its effective date. Removal lowers them. There is no gain or loss line, because `presby_roll_changes` counts the active roll only.
- `presby_roll_counts_as_of` replays *every* membership, ended ones included, so counts before a removal stay historically correct.
- **Filed returns are not altered.** `statistical_returns_freeze` and the publications immutability make a filed return a frozen snapshot of submitted values. A back-dated entry or a void can make the live replay disagree with a filed year. The only correction is a correcting return (`supersedes_id`).
- **R12.** The function returns `affects_filed_period boolean`: true when the effective date falls in a year with a submitted return. The UI warns ("This changes a year already filed. The filed return is not changed."). The clerk's publish step stays the review point, with no minute reference on these rows; DECISION-198 says so.
- **Participant → member (Increment 2 approval):** the gain becomes effective, `current_roll` moves to `active`, `presby_roll_changes` counts the gain (the 17/18 split needs F173's `age_at_action`), and the participant count drops with no loss line. That matches 0012's stated model. `memberships_one_active_roll_idx` will refuse the approval if the person is active elsewhere; that is the transfer path, not this one.

**7. No role carries a wildcard.**
- The clerk template becomes `statistics.publish`, `roll.propose` and `directory.view`: all specific, nothing from tier 3, no `roll.approve`.
- The founding-administrator bundle is **unchanged**. DECISION-155 and F118's refusal of `roll.*` in the bundle stands. The administrator holds `roll.propose` through the office role, which survives the bootstrap role being dissolved.
- Membership-roll kinds stay unapprovable until Increment 2, by design.

**8. Permission catalog and clerk binding (DECISION-199, F174).**
- **F174 confirmed:** no migration inserts `roll.propose` or `roll.approve` into `permissions`. Only `scripts/seed-dev.sql:352` does. Of the live branch's catalog, the only keys no migration seeds are those two and `ledger.approve`, which is out of scope and noted as a residual. A fresh install (migrations plus `npm run db:seed`) lacks them.
- **R13. Migration 0061:**
  - inserts both keys, tier 1, module `roll` (`on conflict do nothing`);
  - binds `roll.propose` and `directory.view` to the `congregation_stated_clerk` **template**. Both pass the DECISION-078 test: keeping the rolls is the clerk's constitutional duty, and so is reading them.
- **The backfill is narrowed:**
  - It targets org-owned `congregation_stated_clerk` copies **only at organizations that hold an org-owned `founding_administrator` role**, that is, copies the platform's designation minted or reconciled (`presby_apply_founding_administrator` reuses or inserts that key additively).
  - It does not touch copies a tenant adopted itself. 0052 note 5 refuses a migration that adds authority to a tenant-adopted role, because that would be the platform granting ecclesiastical authority. 0057 topped up a platform-minted role. This follows 0057 and respects 0052.
  - The discriminator is the role key, not a `grant_reason` text prefix (the purge's lesson).
  - The migration header records the measured production count, as a count with no slugs, taken read-only before deploy.
  - Residual: it re-adds a key a tenant removed from a designation-minted copy, the same residual as 0057.
- `directory.view` on the clerk is for organizations without a working baseline `member` grant (F133). It does not replace that grant.

**9. Migration 0061 shape.** One file, idempotent, unreleased until shipped (corrected in place until then), in this order:
1. permission catalog (R13);
2. template binding and the narrowed backfill (R13);
3. **F173 repair:** `update` **pending** rows with a null `resulting_roll` for a mapped kind, setting `resulting_roll` from the mapping and `age_at_action` from `people.date_of_birth`. Pending rows are mutable. Count approved rows that violate the mapping, and stop and report if there are any, because they cannot be updated and need a void and re-record;
4. the restrictive insert policy (R5);
5. both functions with grants (R1–R3);
6. comments.

No deletes anywhere (R14).

**10. Members page and the Add person gate (DECISION-197).**
- **The Add person button gates on `people.manage`, not `roll.propose`.** The Visitor entry needs only `people.manage`.
- In the wizard, the roll-bearing choices (Participant, and Member as a proposal) render only for `roll.propose` holders. The server re-checks in `createPerson()` and the definer function either way.
- This replaces the analyst's "point to Staff" fallback.
- **Degrade:** a `people.manage` holder without `directory.view` gets the header, Add person, the Visitors and Staff lists (those need `people.manage`, not `directory.view`), and a limited state naming the missing permission. A caller without `people.manage` gets `MembersForbidden`, unchanged and byte-identical.
- The production symptom (F172) was the purge deleting the baseline member grant, which the orchestrator has restored.

**11. Visitors (DECISION-200).**
- **Creation:**
  - `createPerson()` gains a `{ kind: "visitor", firstVisitDate?, howHeard? }` arm: engagement `'visitor'`, no roll row, `people.manage` only.
  - `createPersonAction` accepts it explicitly. It still rejects `"none"`, which stays the Staff anchor.
  - The arm rides the existing `org_portal.members_create` flag and toggle. No new flag (operator memory).
- **Visibility:**
  - Visitors are never in the member Directory. The existing predicate already excludes `'visitor'` with a null roll, so `directory.ts` does not change.
  - The admin list shows them through `listVisitors()`, defined as `engagement_status = 'visitor' and current_roll is null and ended_on is null`.
- **Paths, all on the same person and the same membership row:**
  - visitor→participant is an on-record enrolment;
  - visitor→member is a pending proposal;
  - participant→member is a pending proposal.
- **The roll function never writes `engagement_status`.** The pastoral axis stays separate from the roll. Lists derive from the roll first, so an enrolled visitor moves from Visitors to Participants with no engagement change, and voiding the enrolment moves them back. An engagement editor belongs with Increment 3's follow-ups.
- **The match step** must surface "already here" (visitor, participant, staff, or ended) and link to that person's edit page instead of creating a duplicate. Today a "same person?" match on someone already at this org reaches `memberships_guard_insert`, which counts memberships anywhere, and the wizard shows "That person already belongs to another organization." That message is wrong. "Already here" discloses nothing a `people.manage` holder could not already read at their own org.

**12. Staff (DECISION-200, continued).**
- `listStaff()` lists people with an open `staff_positions` row, whatever their engagement. It is admin-only and `people.manage`-gated.
- `engagement_status = 'staff'` is kept, with no migration. A future rename to something like "anchor only" is optional and not planned.
- DECISION-129's Directory exclusion **stands**. Its reason was privacy: an outside employee's anchor row must not publish their contact details in the congregational and public Directory. A staff member who is genuinely a congregant already appears through their roll or `'regular'` status.
- **Confirmed by reading:**
  - `resolveTreasurerPerson` ignores engagement (analyst, `issue.ts:290`);
  - `presby_accept_invitation`'s `'staff'` memberships for invitees are correct and unchanged, because a designee may have no congregational relationship;
  - engagement is never reported: `presby_roll_counts_as_of` reads the roll only.

**13. Naming and route (DECISION-201).**
- **Labels:** the admin tile, the page heading and the filters become "Community", with filters Members, Participants, Visitors and Staff. The Members filter is active, baptized and affiliate.
- The member-facing **Directory keeps its name**. S6 covers its inner "Members" tab.
- **Constitutional wording that stays:** roll-action kind labels, "member" in the sense of the active, baptized or affiliate rolls, all SASR text, "member of the Session", and "Waiting for the Session to approve".
- **The route stays `/o/<slug>/admin/members`.** A follow-up Polish pipeline moves it to `/admin/community`, with a permanent `next.config.ts` redirect for `/o/:slug/admin/members/:path*` (the `/orgs` precedent) and a sweep of the 122 references, including tests and `revalidatePath` strings. `src/proxy.ts` is unaffected because it matches `/o/*` generically.

**14. All deletes are soft (DECISION-198, operator ruling).**
- **R14.** Nothing in this pipeline hard-deletes:
  - removal sets `ended_on` and `ended_reason`;
  - a void is a new row;
  - the 0061 backfill and repair are inserts and updates;
  - any visitor clean-up (Increment 3) sets status or an end date.
- Existing hard-delete paths are filed as F176. Not fixed here.

## Invariants Touched

- **The Roll Is the System of Record:** respected. On-record rows and voids are appends. The freeze trigger is untouched. The cache is recomputed by the existing trigger. Drift stays at zero because nothing on-record is future-dated.
- **Isolation Is a Database Property, and F26:** the definer functions take the org from `presby_current_org()` and touch only that org's rows. `search_path` is pinned with `pg_temp` last (0048 B-M2).
- **Permissions vs Flags:** no new flag and no new `FEATURES.*` key. `roll.propose` and `people.manage` are tenant permissions. The existing `org_portal.members_create` (with its toggle) and `org_portal.members_roll_action_edit` stay as behaviour gates. Phase 3 must read-only check that `members_roll_action_edit` is ON in production: the removal, void and participant→member forms live behind it.
- **Two Hierarchies:** the backfill is limited to platform-minted copies (R13). No platform predicate enters any authority check.
- **No Role Carries a Wildcard:** respected (section 7).
- **Never hard-delete a person / soft deletes:** respected (R14).
- **The Brand Is a Cascade Override:** unaffected. The work stays inside `(org)`.
- **Verify in a Browser and HydrationGate:** apply to the wizard's new arm and the two edit-page forms.
- No CLAUDE.md change is needed. If the route moves later, its pipeline updates Project Layout prose only where needed.

## Decisions proposed (the orchestrator records them)

- **DECISION-197:** The Members page degrades for a `people.manage` holder without `directory.view`. Add person gates on `people.manage`, and the roll-bearing choices gate on `roll.propose`, re-checked on the server. Root cause on record: the purge deleted the baseline member grant (F172).
- **DECISION-198:**
  - Other-participant enrolment and removal take effect on record through `presby_record_participant_action()`, and voids go through `presby_void_participant_action()`. Both are SECURITY DEFINER, with the org from `presby_current_org()`, a bounded `users.id` actor claim, and `roll.propose` checked in the same transaction.
  - A restrictive insert policy confines approved-at-insert to these functions.
  - Removal ends the membership under `memberships_guard_end` and never auto-ends a term.
  - A void voids only the latest effective action and reopens the membership only on the removal's own marker.
  - Dates fall between the date of birth (or the 1900 floor) and today, and the new row is always the latest.
  - Audit keys `tenant.roll_action.recorded` and `tenant.roll_action.voided` are written in the same transaction.
  - Filed returns are never altered.
  - All deletes are soft.
- **DECISION-199:**
  - `roll.propose` and `roll.approve` enter the permission catalog by migration (F174).
  - `roll.propose` and `directory.view` bind to the `congregation_stated_clerk` template under DECISION-078.
  - The backfill is limited to copies at designated organizations (the 0057 precedent, 0052 note 5 respected).
- **DECISION-200:**
  - A visitor is a person with a live membership, engagement `'visitor'` and no roll row. It is created with `people.manage`, listed only by the admin-only `src/lib/community.ts`, and never in the Directory.
  - Staff is a position: the admin Staff filter comes from `staff_positions`, `'staff'` engagement is kept, and DECISION-129's exclusion stands.
  - The roll functions never write the pastoral axis.
- **DECISION-201:** The admin section is labelled "Community" (or "People", operator's choice). The route move is deferred to its own Polish pipeline with a permanent redirect. The Directory keeps its name. Constitutional "member" wording is kept where listed.
- **Increment 2's Session-role decision** (originally proposed as DECISION-200) gets a fresh number at Increment 2's kickoff.

## Findings

- **F172:** The Members wall. The immediate cause was the purge deleting the baseline member grant (restored). The structural cause is that the page had no degrade.
- **F173:** `createPerson()` writes no `resulting_roll` and no `age_at_action`. Fixed in TypeScript, and pending rows are repaired in 0061. S2 makes it a database property.
- **F174:** Confirmed. `roll.propose` and `roll.approve` are seeded by no migration. `ledger.approve` is also seed-only (out of scope, tracked).
- **F175:** No correction path for an approved row. Closed by R10.
- **F176:** Hard-delete paths in the people and membership area, filed and not fixed:
  - `updatePerson()` deletes the primary `contact_methods` and `addresses` rows when a field is blanked (`src/lib/people.ts:673` and `:706`);
  - `presby_app` holds `DELETE` on `memberships`, `roll_actions`, `households`, `addresses`, `contact_methods`, `follow_ups`, `person_notes` and `staff_positions`, and only `people` carries a delete guard (`people_guard_delete`);
  - pending `roll_actions` rows are deletable by design (0028, `test-rls.sql` §20d). Under the soft-delete rule, a mistaken proposal should be *denied*, not deleted;
  - the morning's purge deleted a `role_grants` row. Ending it with `ends_on` would have been both soft and recoverable;
  - test fixtures that delete people through the owner connection are a fixture exemption.
- **Two more, numbers requested from the orchestrator (Rule 16):**
  - **(a)** The `active_membership` derived group admits every live membership, visitors and staff anchors included. The baseline `member` role (`directory.view`, `events.view`) would reach a visitor who ever had a linked account. Today the only path that links a user to a person is invitation acceptance, so nothing is exposed now. It must be closed before any member self-service sign-in.
  - **(b)** The wizard's "same person?" match on someone already at this org shows "belongs to another organization". Fixed in Increment 1 by section 11.

## Suggestions (Phase 3's call)

- **S1:** A proposal-time date check against the person's latest effective action (section 5).
- **S2:** Add `roll_actions_resulting_roll_matches_kind` (a CHECK encoding `ROLL_ACTION_KIND_TO_ROLL`, with `opening_balance` exempt), `roll_actions_void_shape` (`(kind = 'void') = (voids_action_id is not null)`) and an `approval_status in ('pending','approved','denied')` CHECK. Make each `NOT VALID` if the measured rows violate it. This makes F173 hold for every future writer.
- **S3:** A partial unique index allowing one live void per action (`unique (voids_action_id) where kind = 'void' and approval_status <> 'denied'`).
- **S4:** Map an organization predating F16 (`presby_sync_derived_membership_group` raising `foreign_key_violation` on removal) to a typed `provisioning_incomplete` outcome.
- **S5:** Removal refuses an open `staff_positions` row. Staff positions have no needs-membership guard, so ending the membership would leave the position orphaned.
- **S6:** The member-facing Directory's inner "Members" tab lists participants and regulars too. Consider relabelling it "People". This is optional and the operator's call.

## Notes (Increment 2 must find these ready)

- `decideRollAction()` stays application-gated on `roll.approve`. Increment 2 should consider moving approval into a definer function and extending the restrictive policy to `UPDATE … approval_status = 'approved'`.
- Approval must refuse when the target membership has ended, and must refuse (or warn) when a later-dated effective action would shadow the approved row.
- `roll.propose` holders need a read-only view of the pending queue (a separate read on `roll.propose`). Today `/members/pending` needs `roll.approve`.
- The congregation Session baseline role revisits DECISION-100's "no conditional branch" note and needs its own decision.
- `memberships_one_active_roll_idx` will make an approval fail for someone active elsewhere. Map that to a typed result.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete (Increment 1 scope, with the operator's additions on visitors, staff, naming and soft deletes evaluated) | Approved with suggestions | 2026-10-22 |

## Handoff

Next agent: **tech-lead (Phase 3)**. Design to R1–R14. Rule on S1–S6. Measure the following read-only before any DDL:
- production count of designation-minted `congregation_stated_clerk` copies;
- approved `roll_actions` rows violating the kind-to-roll mapping;
- production state of `org_portal.members_roll_action_edit`;
- whether the `presby_platform` role is a live connection (R5 targets `presby_app` only).

Name the implementer. Given that the work spans the migration, two definer functions, three lib modules and the UI, the expected split is database-admin for 0061, then full-stack-developer or api-developer plus ux-developer.

Files read (all under `/Users/cshenso/git/presby-platform/presby-fadir`): `docs/work-log/2026-10-22-founding-admin-directory.md`, `src/lib/roll.ts`, `src/lib/roll-action-kinds.ts`, `src/lib/people.ts`, `src/lib/authz.ts`, `src/lib/audit.ts`, `src/lib/audit-tx.ts`, `src/lib/directory.ts`, `src/lib/role-definitions.ts`, `src/lib/org-portal/tiles.ts`, `src/lib/db/domain/roll.ts`, `src/lib/db/domain/people.ts`, `src/lib/db/domain/person-ext.ts`, `src/app/(org)/o/[slug]/admin/members/page.tsx`, `src/app/(org)/o/[slug]/admin/members/new/actions.ts`, `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx`, `src/app/(org)/o/[slug]/directory/directory-nav.tsx`, `drizzle/0009`, `0010`, `0012`, `0014`, `0015`, `0017`, `0028`, `0046`, `0047`, `0048`, `0052`, `0055`, `0057`, `0059`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `scripts/seed.ts`, `docs/decisions.md` (DECISION-078, 100, 128, 129, 155). Live catalog read on the pipeline branch: RLS and FORCE flags, `pg_policies`, `aclexplode` grants, `pg_trigger`, `pg_constraint`, the `permissions` contents, and the clerk and member role bindings. Nothing was written.

---

### Operator rulings on the Phase 2 proposal verdicts (2026-10-22)

- **Staff:** the operator **agrees** with the architect's verdict. Staff is a position, and the Community list gets a Staff filter derived from open `staff_positions` rows. "Community first" is **not** a rule. `engagement_status = 'staff'` stays as the anchor, and DECISION-129's directory exclusion stands.
- **Section name:** **"Community"**. The overlap with the "new worshiping community" org type was noted and accepted.
- **Route:** **"Move it now"**. The operator overrode the architect's recommendation to defer it, so `/o/<slug>/admin/members` moves to `/o/<slug>/admin/community` **in this pipeline**. Old paths get a permanent `next.config.ts` redirect (`/o/:slug/admin/members/:path*`, the `/orgs` precedent), and all ~122 references across ~55 files are swept. To keep the architect's reviewability concern addressed, Phase 3 should make the route move its **own batch and its own commit(s)**, mechanical and separate from the 0061/definer-function diff, so the security-relevant changes stay reviewable in isolation.

### Orchestrator production measurements for Phase 3 (read-only, 2026-10-22)

- Designation-minted `congregation_stated_clerk` copies: **1**. All org-owned clerk copies: 1.
- `roll_actions` rows in production: **0** (after the purge). The F173 repair and S2 CHECKs have no production rows to violate. Development may still have some, so measure there.
- `org_portal.members_roll_action_edit`: **ON**.
- `presby_platform` role: **cannot log in** (`rolcanlogin = false`), so it is not a live connection. R5 targeting `presby_app` only is sufficient.

---

# Phase 3 — Technical Design (tech-lead)

*Written 2026-10-22 by tech-lead against the live tree of the `presby-fadir` worktree and a read-only measurement of the pipeline Neon branch (`ep-jolly-boat-axklya0l`, owner connection, `default_transaction_read_only = on`; nothing was written). Designed to R1-R14. S1-S6 are ruled below. The operator's ruling "Move it now" is designed as its own mechanical batch (Batch M). The Rule 16 shared files are not touched; every edit to them is staged for the orchestrator (see Integration hand-offs).*

## Summary

Build **Community**: the admin people section, renamed and moved to `/o/<slug>/admin/community` (its own batch and commit, permanent redirect from `/admin/members`). It gains three directory-backed lists (Everyone, Members, Participants) and three admin-only lists (Visitors, Staff, Former participants); the founding administrator and the clerk reach it through `directory.view` and `roll.propose` on the `congregation_stated_clerk` template (migration 0061, backfill narrowed to designation-minted copies). The Add person wizard gains a **Connection** step (Visitor, Participant, Member), and its match step says "already here" instead of "belongs to another organization". Participant enrolment, removal and undo take effect on record through two `SECURITY DEFINER` functions that return typed outcomes, check the actor's `roll.propose` in the caller's own transaction, and are the only path that can insert an approved roll row (a restrictive insert policy on `presby_app`). Each such act writes its audit row in the same transaction. `createPerson()` stops writing a null `resulting_roll` (F173), and 0061 repairs and then constrains the column so the defect cannot come back. Member-roll proposals still queue for the Session (Increment 2). All deletes are soft.

## Rulings on S1-S6

| # | Ruling | Why, and the consequence |
|---|---|---|
| S1 | **Adopt as a warning, not a refusal**, on `recordRollAction()` proposals only. | A refusal would block legitimate history entry (recording a 2018 profession after a 2020 opening balance). The harm S1 names is real but narrower: an approval dated before the person's latest effective action does not change their current status. `recordRollAction()` returns `ok` with `shadowedBy: { kind, effectiveDate } | null`; the form shows an amber note after success. The on-record kinds are the opposite case and are **refused** (`date_before_latest_action`, R11). |
| S2 | **Adopt all three**, validated (not `NOT VALID`), in 0061: `roll_actions_resulting_roll_matches_kind`, `roll_actions_void_shape`, `roll_actions_approval_status_allowed`. | Measured on the branch: 0 violators of any of them, and 0 `roll_actions` rows in production. Four existing test inserts will violate the first CHECK and must be fixed in Batch A (see Measurements 10). Rollout order matters (Edge Cases 1). |
| S3 | **Adopt** `roll_actions_one_live_void_idx`: `unique (voids_action_id) where kind = 'void' and approval_status <> 'denied'`. | Measured: 0 duplicate live voids. It makes "already voided" a database property and serializes a double-click race to one winner. |
| S4 | **Adopt, widened.** `provisioning_incomplete` is returned by both functions, on enrolment and undo as well as removal. | The discriminator is not only the removal's `memberships` update: every approved insert fires `presby_sync_current_roll`, which updates `memberships`, which fires `memberships_sync_derived_group`, which raises `foreign_key_violation` when the organization has no `active_membership` group. Measured: 4 of 15 organizations on the branch lack that group. The handler matches the trigger's own message text and re-raises anything else. Not fixed here: `createPerson()`'s own membership insert has the identical pre-existing failure at such an organization (F16). |
| S5 | **Adopt.** Removal returns `holds_position` for an open `staff_positions` row (pre-checked), as well as for the `memberships_guard_end` refusal (caught). | `staff_positions` has no needs-membership guard; ending the membership would orphan the position. |
| S6 | **Decline in this pipeline; file a TODO; the operator may overrule at design review.** | The member-facing Directory keeps its name (DECISION-201). Name the inconsistency honestly: after this pipeline the admin "Members" filter means active, baptized and affiliate only, while the Directory's inner "Members" tab lists participants and regulars too. Relabelling it "People" is a one-string change (`directory-nav.tsx` plus its tests and `button-group.test.tsx` fixtures) that I recommend for the next polish pipeline. |

## Measurements (pipeline branch, read-only)

1. **`roll_actions` shape on the branch:** 29 rows. Approved 28 (24 `opening_balance`, 1 `baptized_member_enrolled`, 1 `other_participant_enrolled`, 1 `certificate_dismissed`, 1 `void`), pending 1 (`profession_of_faith`). Approved rows violating the kind-to-roll mapping (`opening_balance` exempt): **0**. Pending rows with a null `resulting_roll` for a mapped kind: **0**, so the F173 repair statement is a no-op here and in production (0 rows) and must be proven with fixtures. Void-shape violators: 0. Duplicate live voids: 0. A void whose `person_id` differs from its target's: 0. `approval_status` values present: `pending`, `approved` only. Future-dated approved rows: 0.
2. **Cache drift is not zero on the branch.** `presby_roll_cache_drift()` returns 4 rows (cached `active`, replay null) for fixture people `c0000000-...-00000000f0c1`, `...de01`, `...de02`, `...de03` at three organizations. Phase 2's "drift stays at zero" cannot be asserted globally; **Phase 4 asserts it per person** (no drift row for the person under test, before and after).
3. **Clerk copies:** 0 org-owned `congregation_stated_clerk` rows on the branch, so the backfill is a no-op in development and is tested with fixtures. Production: 1 (orchestrator measurement). The template (id `00000000-0000-0000-0000-000000000004`, constitutional, protected) carries only `statistics.publish`.
4. **Catalog:** `roll.propose`, `roll.approve` and `directory.view` exist on the branch (seeded by `scripts/seed-dev.sql`, which inserts them with `on conflict (key) do nothing`, so the 0061 insert and the seed do not collide). F174 stands for a fresh install.
5. **Policies, triggers, grants on `roll_actions`:** one permissive `tenant_isolation` policy (`{public}`, ALL), FORCE RLS, triggers `roll_actions_freeze` (BEFORE UPDATE OR DELETE) and `roll_actions_sync_current` (AFTER INSERT OR UPDATE), `presby_app` holds SELECT/INSERT/UPDATE/DELETE. `neondb_owner` is `rolbypassrls`; `presby_app` is NOBYPASSRLS and can log in; `presby_platform` cannot log in.
6. **Derived group:** 4 of 15 organizations have no `active_membership` group (S4 is reachable and testable on the branch).
7. **`memberships`:** has `first_visit_date`, `how_heard`, `ended_reason` (free text, no CHECK) and no CHECK constraints at all, so the only `check_violation` an `ended_on` update can raise is `memberships_guard_end`. `engagement_status` is free text defaulting to `'visitor'`. `birth_year_only` is `NOT NULL` on `people`.
8. **`people.user_id` is not unique.** The actor check therefore uses `exists`, and the self-target check compares user ids (`target.user_id is not distinct from p_recorded_by`).
9. **R5 casualty check (a correction to Phase 2).** `src/lib/roll.test.ts:539` inserts its approved row through `getPlatformDb()` (the owner), so it is **not** affected by the restrictive policy. The only `presby_app` insert of an approved roll row anywhere is `scripts/test-rls.sql` section 20d (line 1426), staged as a patch. `scripts/seed-dev.sql` runs as the owner.
10. **S2 casualties (fixtures, not seeds).** Four inserts in `src/lib/roll.test.ts` set no `resultingRoll` for a mapped kind and will violate `roll_actions_resulting_roll_matches_kind`: the one starting at `:279` (`other_participant_enrolled`, pending), `:297` (`restoration`, pending), `:516` (`other_participant_enrolled`, pending), `:539` (`other_participant_enrolled`, approved). Batch A fixes them. Every row in `scripts/seed-dev.sql` and every insert in `scripts/test-rls.sql` satisfies the mapping (read line by line).
11. **Filed periods.** A congregation's filed returns are `publications` (record_class `'statistical_return'`, `withdrawn_at is null`) joined to `statistical_returns` on `(artifact_id, organization_id)` for `report_year`. An enrolment dated D changes the ending participant count of every year-end on or after D, so the predicate is `report_year >= extract(year from <pivot date>)`. The pivot is the new row's date for a record and the voided row's date for an undo.
12. **e2e:** no existing spec references `admin/members` or the Members page. The `congregation-clerk` fixture holds `statistics.publish` only.
13. **Sweep size:** 131 occurrences of `admin/members` in 55 files under `src/`, `scripts/`, `e2e/` and `next.config.ts` (0 in `e2e/`, 0 in `src/proxy.ts` or `src/lib/auth`), plus 26 in `docs/` outside the work-logs. `src/proxy.ts` matches `/o/*` generically and is unaffected.
14. **`npm run check:audit`** only inspects `db.insert|update|delete|execute` inside `actions.ts`; the new actions call lib functions, so the tripwire passes vacuously. Audit coverage is therefore proven by tests (Test Plan 1.7), not by the tripwire.
15. **Time zone.** The roll sync trigger and `presby_roll_changes` use the database `current_date` (UTC). The functions use the same `current_date`, so a row can never be future-dated by the function's own clock and `presby_roll_cache_drift()` stays clean. Cost: an organization west of UTC can, in the evening, enter tomorrow's UTC date. Accepted (US-only product), noted in Edge Cases.

## Feasibility check against the live tree

- **Signatures are valid SQL.** Both functions take all parameters without defaults (a default on `p_minute_reference` would have to trail `p_recorded_by`, so it is always passed, as `null` when absent). `p_kind roll_action_kind` resolves against the existing enum; no enum value is added.
- **`ALTER`/`DROP`:** none against any column or table. Constraints and an index are added; one policy is added. Nothing a `SECURITY DEFINER` body references is dropped or retyped (`presby_effective_permissions`, `presby_apply_founding_administrator` and `presby_apply_treasurer` read `app_roles` and `app_role_permissions` rows only; the backfill adds rows).
- **New CHECKs read against fixtures:** `scripts/seed-dev.sql` (every roll row, lines 314-345, 1024, 1126, 1224), `scripts/test-rls.sql` (inserts at 270, 1417, 1426, all with `resulting_roll = 'active'` for `other_gain`), and the Vitest fixtures (four violate the mapping CHECK and are named above; none violates the void-shape CHECK or the status CHECK).
- **FKs:** no new FK and no new tenant table. The void row's `person_id` equal to its target's is enforced by the function, because `roll_actions_voids_fk` is only `(voids_action_id, organization_id)` (Phase 2 R10). Both columns that carry the tenant id (`roll_actions.organization_id`, `memberships.organization_id`) are named explicitly in every query.
- **Backfill discriminator:** the role key (`congregation_stated_clerk`) joined to an org-owned `founding_administrator` role at the same organization, never a `grant_reason` prefix.
- **Existing specs that break, found by grep and named below** (Test Plan 3). The one the design could not otherwise have predicted is the `people.user_id` linkage: `src/lib/people.test.ts`'s `grantingUserId` is not linked to `managerPerson`, so under R3's actor resolution every participant-kind call in that file needs the link added.

## Permissions & Flags

- **Permission keys:** no new key and no new `FEATURES.*` entry (`src/lib/permissions.ts` stays frozen). Tenant keys used, all tier 1: `people.manage` (Community page chrome, Add person, the Visitor connection, the three admin lists, badges, edit page), `roll.propose` (Participant and Member connections, remove, undo, `recordRollAction()`), `directory.view` (the Everyone, Members and Participants lists, through `getDirectory()`), `roll.approve` (unchanged: only the pending worklist and `decideRollAction()`).
- **Default role bindings:**
  - `congregation_stated_clerk` template gains `roll.propose` and `directory.view` (it becomes `statistics.publish`, `roll.propose`, `directory.view`). DECISION-078 test: keeping and reading the rolls is the clerk's constitutional duty.
  - Org-owned clerk copies at organizations holding an org-owned `founding_administrator` role are topped up (the 0057 precedent, 0052 note 5 respected). Production: 1 copy.
  - The founding-administrator bundle is **unchanged** (DECISION-155, F118). The administrator holds `roll.propose` through the clerk office role granted at designation, which survives the bundle being dissolved.
  - The baseline `member` role is unchanged. `roll.approve` is bound to nothing (Increment 2). No role carries both keys.
- **Feature flags:** none new (operator memory: no new platform flags before go-live). Existing gates: `org_portal.members_create` plus the matching `organization_feature_toggles` row gates the Community page, the wizard and the visitor arm (the route rename does not rename the key). `org_portal.members_roll_action_edit` gates every roll form on the edit page, including the new Remove and Undo controls (measured ON in production). `org_portal.staff` (ON in production) decides only whether the Staff empty state links to the Staff page.
- **Rollback:** the bindings are data (delete the two template rows and the backfilled copies' rows); the functions, CHECKs, index and policy are `drop`-able; the route move reverts by reverting Batch M.

## API Contract

### SQL: the two definer functions (Batch A)

Both: `language plpgsql security definer set search_path = public, pg_temp`, `revoke all ... from public`, `grant execute ... to presby_app` only. The organization is `presby_current_org()` (no organization parameter, R2); a null organization raises. Each returns **exactly one row** (`return next; return;`), so the caller always reads `rows[0]`; on a non-`ok` outcome the id columns are null and the booleans false.

```sql
create or replace function presby_record_participant_action(
  p_person_id uuid, p_kind roll_action_kind, p_effective_date date,
  p_minute_reference text, p_recorded_by uuid)
returns table (outcome text, roll_action_id uuid, membership_ended boolean, affects_filed_period boolean)

create or replace function presby_void_participant_action(
  p_roll_action_id uuid, p_reason text, p_recorded_by uuid)
returns table (outcome text, void_roll_action_id uuid, voided_action_id uuid,
               voided_kind text, membership_reopened boolean, affects_filed_period boolean)
```

Two helpers support them:

- `presby_deny_participant_action()` returns void and raises the one literal `'roll_actions: this participant action is not permitted'` with errcode `insufficient_privilege` (the 0052 shape: invoker, no `search_path` pin, execute granted to `presby_app` so a non-owner caller sees this literal and not a second "permission denied" string).
- `presby_participant__actor_may_propose(p_org uuid, p_user_id uuid) returns boolean` (stable, definer, pinned `search_path`; `revoke all ... from public`, no grant): `exists` a live (`merged_into_id is null`) person with `user_id = p_user_id` and `presby_membership_is_active(person, p_org)` and `presby_has_permission(person, p_org, 'roll.propose')`. Same body shape as `presby_giving__actor_may_record`.

**Identity refusals** (uniform literal via the helper): no organization context, null `p_recorded_by`, actor fails the helper. These are checked first and reveal nothing. **State refusals** are returned, never raised. Every function body checks in the order listed; the first failing check wins.

**Record function outcomes** (`ok` plus thirteen refusals; closed list, pinned to the TypeScript list by a source-scan test):

| Outcome | When |
|---|---|
| `ok` | Written. |
| `invalid_kind` | `p_kind` is not `other_participant_enrolled` or `other_participant_removed` (R4). |
| `date_out_of_range` | Date null, after `current_date`, before 1900-01-01, or (once the person is read) before the person's birth date. A year-only birth date floors at 1 January of that year. |
| `person_not_found` | No membership at this organization for `p_person_id`, or the person is merged. |
| `person_deceased` | `people.date_of_death` is set. |
| `membership_ended` | `memberships.ended_on` is set. |
| `pending_action` | Any pending `roll_actions` row for the person at this organization (R9, R11: it would shadow the new row). |
| `already_participant` | Enrolment, and the replay roll as of today is `other_participant`. |
| `on_member_roll` | Enrolment, and the replay roll as of today is `active`, `baptized` or `affiliate` (that would be a roll loss with no Session act and no SASR loss line). |
| `not_participant` | Removal, and the latest effective action is not an `other_participant_enrolled` dated on or before today, or the replay roll is not `other_participant`. |
| `date_before_latest_action` | Date earlier than the person's latest effective action (R11), so the new row would not become the latest. |
| `holds_position` | Removal, and an open `staff_positions` row exists (S5), or `memberships_guard_end` refused (an open officer term or person-arm role grant). It never ends a term (R9). |
| `self_target` | Removal, and the target's `user_id` equals `p_recorded_by`. |
| `provisioning_incomplete` | S4. |

Check order, enrolment: identity, kind, static date bounds (null, future, before 1900), person and membership lookup (this is the `select ... for update` that serializes the person, R6), `person_deceased`, `membership_ended`, `pending_action`, `already_participant`, `on_member_roll`, birth-date floor, `date_before_latest_action`, insert. Removal: identity, kind, static date bounds, lookup and lock, `self_target`, `person_deceased`, `membership_ended`, `pending_action`, `not_participant`, `date_before_latest_action`, staff-position pre-check, then the membership `update` in its own sub-block (`check_violation` becomes `holds_position`; the S4 `foreign_key_violation` becomes `provisioning_incomplete`; any other error re-raises), then the roll insert.

Inserted row (enrolment): `kind = 'other_participant_enrolled'`, `resulting_roll = 'other_participant'`, `age_at_action = date_part('year', age(p_effective_date, dob))::int` when a birth date exists else null, `approval_status = 'approved'`, `approved_by = proposed_by = p_recorded_by`, `approved_on = current_date`, `minute_reference = nullif(btrim(p_minute_reference), '')`, `recorded_at = clock_timestamp()`. **`recorded_at` is set explicitly to `clock_timestamp()`**: the column defaults to `now()`, which is constant inside a transaction, and replay breaks ties on `recorded_at`, so two rows written in one transaction (a test, or an enrol and a remove in one request) would otherwise order nondeterministically. Removal inserts `resulting_roll = null` and sets `memberships.ended_on = p_effective_date`, `ended_reason = 'other_participant_removed'` (the fixed marker, also exported to TypeScript and pinned equal).

`affects_filed_period`:

```sql
exists (select 1 from publications pb
          join statistical_returns sr on sr.id = pb.artifact_id and sr.organization_id = pb.organization_id
         where pb.organization_id = v_org and pb.record_class = 'statistical_return'
           and pb.withdrawn_at is null and sr.report_year >= extract(year from v_pivot)::int)
```

**Void function outcomes** (`ok` plus eight refusals):

| Outcome | When |
|---|---|
| `ok` | Written. |
| `reason_required` | `btrim(p_reason)` is empty. |
| `reason_too_long` | Over 500 characters after trimming. |
| `action_not_found` | No row with that id at this organization. |
| `not_on_record_kind` | The row is not approved, is itself a void, or its kind is not an on-record kind. |
| `already_voided` | An approved void already references it. |
| `not_latest_action` | It is not the person's latest effective action (R10). |
| `membership_changed` | A removal's reopen precondition failed: `ended_on` is not the removal's date or `ended_reason` is not the marker. |
| `provisioning_incomplete` | S4. |

Check order: identity, reason, lookup, kind, `already_voided`, lock the person's membership row, then **re-evaluate** `already_voided` and `not_latest_action` under the lock (a concurrent undo or record), the removal's reopen precondition, then reopen (when the target is a removal) and insert the void. Void row: `kind = 'void'`, `voids_action_id = target`, **`person_id = target.person_id`**, approved, `approved_by = proposed_by = p_recorded_by`, `approved_on = current_date`, `effective_date = current_date`, `resulting_roll = null`, `age_at_action = null`, `recorded_at = clock_timestamp()`. The reason is not stored on the row (no column; `denial_reason` is not overloaded); it goes in the audit row.

### Pure shared modules (no `server-only`)

- `src/lib/roll-action-kinds.ts` gains: `ON_RECORD_ROLL_ACTION_KINDS = ['other_participant_enrolled', 'other_participant_removed']` (a source-scan test pins it equal to the SQL's accepted list); `isOnRecordKind(kind)`; `PARTICIPANT_REMOVAL_ENDED_REASON = 'other_participant_removed'`; `deriveRollFields(kind, dateOfBirth, effectiveDate): { resultingRoll: string | null; ageAtAction: number | null }` (replaces `roll.ts`'s private `ageAsOf`; a DB parity test compares it to the SQL expression over sample dates including a 29 February birthday); `PARTICIPANT_RECORD_REFUSALS` and `PARTICIPANT_VOID_REFUSALS` (`as const` arrays, with their union types). `EDIT_TIME_ROLL_ACTION_KINDS` and `WIZARD_ROLL_ACTION_KINDS` are unchanged (removal is not an edit-picker kind).
- `src/lib/ymd.ts` (new, pure): `isRealYmd(s)` (shape plus calendar round-trip) and `todayUtcYmd()`. Used by the actions, the zod schemas and the lib's defensive throws.
- `src/lib/community-labels.ts` (new, pure): `COMMUNITY_VIEWS = ['all','members','participants','visitors','staff','former']`, `parseCommunityView(raw)` (unknown becomes `'all'`), `CONNECTION_LABELS`, and `deriveConnection(row)` returning `visitor | participant | member | staff | listed | former_participant | ended`, with precedence: ended (former participant when `ended_reason` equals the marker) first, then member rolls, then participant, then engagement `visitor`, then engagement `staff`, else `listed`. Shared by the page, the edit page, the badges and the wizard's already-here step.

### Library (Batch B, `api-developer`)

`src/lib/roll.ts` (roll mutations live here, per the 2026-08-26 placement ruling). Every function below is `withOrgContext`, permission first, typed results; every date and string is validated before it reaches the database.

```ts
export type RecordParticipantActionResult =
  | { kind: "ok"; rollActionId: string; membershipEnded: boolean; affectsFiledPeriod: boolean }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: ParticipantRecordRefusal };

export interface RecordParticipantActionInput {
  personId: string; kind: OnRecordRollActionKind;
  effectiveDate: string; /* 'YYYY-MM-DD' */ minuteReference?: string;
}
export interface ActingOptions { actingUserEmail?: string | null }

export async function recordParticipantAction(
  actingPersonId: string, organizationId: string, actingUserId: string,
  input: RecordParticipantActionInput, opts?: ActingOptions): Promise<RecordParticipantActionResult>;

/** Inside a caller's open tx (createPerson, recordRollAction). Writes the audit row in the same tx on ok. */
export async function recordParticipantActionInTx(
  tx: OrgTx, ctx: { organizationId: string; actingPersonId: string; actingUserId: string; actingUserEmail?: string | null },
  input: RecordParticipantActionInput): Promise<RecordParticipantActionResult>;

export type VoidParticipantActionResult =
  | { kind: "ok"; voidRollActionId: string; voidedActionId: string; voidedKind: OnRecordRollActionKind;
      membershipReopened: boolean; affectsFiledPeriod: boolean }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: ParticipantVoidRefusal };

export async function voidParticipantAction(
  actingPersonId: string, organizationId: string, actingUserId: string,
  input: { rollActionId: string; reason: string }, opts?: ActingOptions): Promise<VoidParticipantActionResult>;
```

Behavior: `roll.propose` is pre-checked in the tx (`forbidden`) and the function re-checks it; a `insufficient_privilege` (SQLSTATE 42501) raised by the function maps to `forbidden`. A non-`ok` outcome throws an internal abort so the caller's transaction rolls back (an early `return` from `db.transaction` commits, the `CreatePersonAbort` lesson). On `ok` the audit row is written with `insertAuditRow()` from `@/lib/audit-tx` in the same tx: `ROLL_ACTION_RECORDED` (metadata `organizationId`, `rollActionId`, `kind`, `effectiveDate`, `membershipEnded`) or `ROLL_ACTION_VOIDED` (metadata `organizationId`, `voidRollActionId`, `voidsActionId`, `voidedKind`, `reason`, `membershipReopened`); ids only, no names. A throw from the audit insert rolls the whole act back (tested). The residual, named: a caller that invoked the SQL function directly would skip the audit row, because the function does not write it (R8 puts the audit in TypeScript); no code outside `roll.ts` calls it, and a source-scan test pins that.

`recordRollAction()` (existing, edit-time) is changed: for `other_participant_enrolled` it calls `recordParticipantActionInTx`; for every other kind it inserts the pending row using `deriveRollFields` and, when the person's latest effective action is dated after `effectiveDate`, returns the S1 warning. Its result gains variants:

```ts
export type RecordRollActionResult =
  | { kind: "ok"; rollActionId: string; effect: "pending" | "recorded";
      affectsFiledPeriod: boolean; shadowedBy: { kind: RollActionKind; effectiveDate: string } | null }
  | { kind: "forbidden" } | { kind: "not_found" } | { kind: "invalid_kind" }
  | { kind: "refused"; reason: ParticipantRecordRefusal };
```

`src/lib/people.ts`:

- `CreatePersonInput.rollAction` gains `{ kind: "visitor"; firstVisitDate?: string; howHeard?: string }` (no roll row; `people.manage` only; membership `engagementStatus: "visitor"`, plus `first_visit_date` and `how_heard`). Both fields are validated (`isRealYmd`, not after today UTC, `howHeard` at most 200 characters, blanks become null) and a malformed value throws, matching the existing date contract; the action pre-validates so a user sees a message instead.
- `roll.propose` is required for `profession_of_faith` and `other_participant_enrolled`, not for `visitor` or `none`.
- Step 4 inserts the pending row with `deriveRollFields` (F173); for `other_participant_enrolled` it calls `recordParticipantActionInTx` after the membership insert. A refusal throws `CreatePersonAbort({ kind: "roll_refused", reason })`, so the person, contact rows, household and membership roll back together.
- `CreatePersonResult.ok` becomes `{ kind: "ok"; personId; rollActionId: string | null; effect: "none" | "pending" | "recorded"; affectsFiledPeriod: boolean }`, and the union gains `{ kind: "roll_refused"; reason: ParticipantRecordRefusal }`.
- `matchPerson()` annotates each candidate with `alreadyHere: { connection: Connection; endedOn: string | null } | null`, from one RLS-scoped `memberships` read inside the same transaction (`person_id = any(candidate ids)`, ended rows included, `ended_on` cast `::text`). Candidates already here sort first within the function's own order.

`src/lib/community.ts` (new, `server-only`; `directory.ts` never imports it, and a source-scan test pins both that and that `directory.ts`'s predicate text never contains `'visitor'` or `'staff'`). Every export is gated on `people.manage` and reads through `withOrgContext`; dates are cast `::text` (`check:sql-date`).

```ts
export interface CommunityRow {
  personId: string; displayName: string; email: string | null;
  firstVisitDate: string | null; positions: string[]; endedOn: string | null;
}
export type CommunityListResult =
  | { kind: "ok"; rows: CommunityRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
  | { kind: "forbidden" };
export interface CommunityListOptions { search?: string; page: number; pageSize: number }

listVisitors(viewerPersonId, organizationId, opts)          // engagement_status = 'visitor' and current_roll is null and ended_on is null
listStaff(viewerPersonId, organizationId, opts)             // an open staff_positions row (ends_on null or after today), any engagement, ended_on is null
listFormerParticipants(viewerPersonId, organizationId, opts) // ended_on is not null and ended_reason = the marker

export type CommunityBadge = "active" | "baptized" | "affiliate" | "participant" | "visitor" | "waiting";
getCommunityBadges(viewerPersonId, organizationId, personIds: string[]): Promise<Record<string, CommunityBadge>>
// one query; "waiting" = no current roll and a pending roll action exists; {} when the viewer lacks people.manage

export interface CommunityStatus {
  personId: string; connection: Connection; currentRoll: string | null; currentRollSince: string | null;
  endedOn: string | null; hasOpenStaffPosition: boolean; pendingCount: number;
  latestAction: { id: string; kind: RollActionKind; effectiveDate: string; onRecordKind: boolean } | null;
}
getCommunityStatus(viewerPersonId, organizationId, personId): Promise<{ kind: "ok"; status: CommunityStatus } | { kind: "forbidden" } | { kind: "not_found" }>
```

Same ordering as the directory (last name, first name, id), same page clamping, same substring search over first, last and preferred name and primary email (wildcard characters escaped as `getDirectory()` does). These lists do not apply `directory_hidden`: they are admin-only surfaces gated on `people.manage`, which can already open any person's edit page.

`src/lib/directory.ts` changes by exactly one option: `GetDirectoryOptions.rollStatuses?: readonly DirectoryStatus[]` (an `in (...)` over `current_roll`, used by the Members filter; `status` keeps its meaning). The privacy predicate is otherwise untouched.

`src/lib/audit.ts` gains `ROLL_ACTION_RECORDED: "tenant.roll_action.recorded"` and `ROLL_ACTION_VOIDED: "tenant.roll_action.voided"`.

### Server actions (Batch B), in `[id]/edit/actions.ts` and `new/actions.ts`

All follow the existing plumbing (`auth()`, `resolveOrgContext()` re-run in the body, `organizationId` never from the client, `ActionResult<T>`, `revalidatePath` on the new Community paths). The kind or flag that decides "takes effect on record" is never read from client input: the lib decides it from the kind alone.

```ts
removeParticipantAction(slug: string, input: { personId: string; effectiveDate: string; minuteReference?: string }):
  Promise<ActionResult<{ rollActionId: string; affectsFiledPeriod: boolean }>>
undoParticipantEntryAction(slug: string, input: { rollActionId: string; reason: string }):
  Promise<ActionResult<{ voidRollActionId: string; membershipReopened: boolean; affectsFiledPeriod: boolean }>>
recordRollActionAction(slug, input): Promise<ActionResult<{ rollActionId: string; effect: "pending" | "recorded";
  affectsFiledPeriod: boolean; shadowed: { kind: string; effectiveDate: string } | null }>>   // existing, extended
createPersonAction(slug, input): Promise<ActionResult<{ personId: string; rollActionId: string | null;
  effect: "none" | "pending" | "recorded"; affectsFiledPeriod: boolean }>>                    // existing, extended
```

`createPersonAction` keeps rejecting `kind: "none"` and now accepts `visitor` explicitly; the old guard that threw on a null `rollActionId` applies only to the roll-bearing kinds. Each action validates dates with `isRealYmd` and lengths (reason 1-500, minute reference at most 200, how-heard at most 200) before calling the lib, and maps every refusal through the one copy table (`participant-copy.ts`, below), so an unmapped code is a type error.

## Data Model

**Migration `drizzle/0061_presby_participant_roll.sql`**, hand-written, idempotent (every statement `if not exists`, `on conflict do nothing`, drop-then-add, or `create or replace`; applied twice end to end by the implementer, second run changes no row), unreleased until shipped (corrected in place until then). Header records the measured production clerk-copy count (1, a count with no slug) and the apply command:
`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0061_presby_participant_roll.sql`. 0060 belongs to the parallel pipeline and 0058 is reserved; the journal entry is added at integration. Order:

1. **Permission catalog.** `insert into permissions (key, module, description, sensitivity_tier) values ('roll.propose','roll','Propose a roll action',1), ('roll.approve','roll','Approve a roll action',1) on conflict (key) do nothing` (the seed's own texts).
2. **Clerk template binding.** `insert into app_role_permissions (role_id, permission_key) select r.id, k.key from app_roles r cross join (values ('roll.propose'), ('directory.view')) k(key) where r.organization_id is null and r.key = 'congregation_stated_clerk' on conflict do nothing`.
3. **Narrowed backfill.** The same insert for `r.organization_id is not null` copies whose organization also holds an org-owned `founding_administrator` role (`exists (select 1 from app_roles fa where fa.organization_id = r.organization_id and fa.key = 'founding_administrator')`). Residual: it re-adds a key a tenant removed from a designation-minted copy (the 0057 residual). `app_role_permissions_giving_guard` ignores non-giving keys.
4. **F173 repair and the approved-violator stop.** (a) Update **pending** rows whose `resulting_roll` is null for a mapped kind, setting `resulting_roll` from the mapping and, where `people.date_of_birth` is known and `age_at_action` is null, `age_at_action` from the effective date (pending rows are mutable; `roll_actions_freeze` allows it). (b) A `do $$` block counts approved rows (outside `opening_balance`) whose `resulting_roll` disagrees with the mapping and **raises** naming the count if it is above zero: such rows cannot be updated and need a void and a re-record by a human. Measured 0 on the branch and 0 rows in production.
5. **Constraints (S2, S3), drop-then-add so replay is clean:**

```sql
alter table roll_actions add constraint roll_actions_resulting_roll_matches_kind check (
  kind = 'opening_balance'
  or resulting_roll is not distinct from case kind
       when 'profession_of_faith' then 'active'   when 'reaffirmation' then 'active'
       when 'restoration' then 'active'           when 'certificate_received' then 'active'
       when 'other_gain' then 'active'            when 'baptized_member_enrolled' then 'baptized'
       when 'affiliate_received' then 'affiliate' when 'other_participant_enrolled' then 'other_participant'
       else null end);
alter table roll_actions add constraint roll_actions_void_shape check ((kind = 'void') = (voids_action_id is not null));
alter table roll_actions add constraint roll_actions_approval_status_allowed check (approval_status in ('pending','approved','denied'));
create unique index if not exists roll_actions_one_live_void_idx on roll_actions (voids_action_id)
  where kind = 'void' and approval_status <> 'denied';
```

6. **Restrictive insert policy (R5):** `drop policy if exists roll_actions_insert_pending_only on roll_actions; create policy roll_actions_insert_pending_only on roll_actions as restrictive for insert to presby_app with check (approval_status = 'pending');`. The owner and the definer functions (owner, `rolbypassrls`) are unaffected; the approval `UPDATE` path stays application-gated on `roll.approve` (Increment 2 owns closing it).
7. **Functions and grants:** the two helpers, then `presby_record_participant_action`, then `presby_void_participant_action`, each followed by `revoke all ... from public` and the grants above.
8. **Comments** on both functions, the policy, the three constraints, the index and the removal marker.

**Drizzle mirror** (`src/lib/db/domain/roll.ts`): `check()` for the three constraints and a partial `uniqueIndex` for S3. The policy and the functions are SQL-only, as `tenant_isolation` already is. Regenerate the `/developer` reference (`npm run docs:erd`). No new table, column or FK, so `check:schema-parity` is unaffected.

**Staged assets** (Rule 16: the shared files are edited only at integration):

- `scripts/participants/test-rls-61.sql`: a standalone suite that must run as `presby_app` (header modelled on `scripts/invitations/test-rls-59.sql`), integrated by one `\ir participants/test-rls-61.sql` line appended to `scripts/test-rls.sql`.
- `scripts/participants/test-rls.sql.integration.patch`: a unified diff against the current `scripts/test-rls.sql` for the existing assertions the migration changes, to be applied by the orchestrator (list in Test Plan 3).
- No `seed-dev.sql` edit is needed (DB tests build their own fixtures).
- `docs/schema-design.md`: a section for the 0061 functions and the Findings below, written in Batch A (not a Rule 16 file).

## Component / Page Plan

### Routes and files

The route becomes `/o/<slug>/admin/community`; the directory `src/app/(org)/o/[slug]/admin/members/` is `git mv`'d to `.../admin/community/` in Batch M. After Batch M every path below is under `src/app/(org)/o/[slug]/admin/community/` and is called `community/`.

**Pages (existing, modified):** `community/page.tsx` (list), `new/page.tsx`, `[id]/edit/page.tsx`. `pending/`, `children/`, `[id]/edit/sensitive/`, `[id]/edit/guardians/` move unchanged.

**Components to create:**

- `community-nav.tsx` (server): a `ButtonGroup` of real links, `aria-label="Community view"`, items Everyone, Members, Participants, then (when `people.manage`) Visitors, Staff, Former. `?view=` plus the current `search`. It scrolls horizontally at 360px (the `ButtonGroup` already does; verified in the browser).
- `community-search.tsx`: the GET form (search input, hidden `view`, Search button), extracted from `members-list.tsx`; the status `<select>` is retired (the nav replaces it).
- `community-rows-list.tsx`: cards for `CommunityRow` (Visitors, Staff, Former), each linking to the edit page; the detail line is "First visit {date}", the position titles, or "Removed {date}".
- `participant-copy.ts`: the exhaustive copy table (below), `Record<ParticipantRecordRefusal | ParticipantVoidRefusal | "forbidden", string>`, imported by the actions.
- `[id]/edit/connection-card.tsx` (server): the person's current connection in words, the latest on-record entry, and the participant-to-member note.
- `[id]/edit/participant-controls.tsx` (client): owns the dialogs and lets the removal toast open the undo dialog.
- `[id]/edit/remove-participant-dialog.tsx` and `[id]/edit/undo-entry-dialog.tsx` (client): `AlertDialog` (`src/components/ui/alert-dialog.tsx`, Rule 2), controlled state (no `useForm`, so `check:hydration-gate` does not apply), trigger disabled until `useHydrated()` (the `domains/remove-dialog.tsx` precedent), 44px targets.
- `new/connection-step.tsx` (`git mv` from `new/roll-action-step.tsx`): a native `<select>` (the existing house style; no new primitive) for Visitor, Participant, Member, a one-sentence description under it that follows the selection, then only the fields that choice needs.

**Files to modify:** `community/page.tsx`; `members-list.tsx` (cards and a badge, no search form, no status select); `members-states.tsx` (adds `MembersLimited`; the `members-` file names are kept to keep Batch M mechanical); `new/page.tsx` (passes `canProposeRoll`); `new/member-wizard.tsx`, `new/member-wizard-schema.ts` (a `relationship` enum `visitor | participant | member`, `rollAction` loses its `kind`, a `visit` group; the submit maps to `CreatePersonInput`), `new/review-step.tsx`, `new/confirm-step.tsx`, `new/actions.ts`; `[id]/edit/page.tsx`, `[id]/edit/record-roll-action-form.tsx` and its schema, `[id]/edit/actions.ts`; `src/lib/org-portal/tiles.ts` (label "Community", description "Add people, record participants and roll actions, and see visitors and staff."); `src/lib/org-features.ts` (the toggle's display `name` and `description`, key unchanged; check the catalog tests for the old name first); `src/lib/onboarding/founding-administrator.ts` (comment only: it says no template carries `roll.propose`); `scripts/seed.ts` (flag description text); `next.config.ts` (the redirect, Batch M).

### Page logic: `community/page.tsx`

1. Auth, `resolveOrgContext` (four-way miss), `assertOrgAccess`, then flag plus toggle (`MembersFlagOff`, heading "Community").
2. `view = parseCommunityView(searchParams.view)`; `canManage = hasPermission(people.manage)` (independent awaited call, as today).
3. **Directory-backed views** (`all`, `members` as `rollStatuses: ['active','baptized','affiliate']`, `participants` as `status: 'other_participant'`): `getDirectory()`. On `forbidden`: `canManage` gives `MembersLimited` plus the nav (Visitors, Staff, Former still work) and Add person; no `people.manage` gives `MembersForbidden` with the unchanged body copy and heading "Community", byte-identical in body to today's.
4. **Admin views** (`visitors`, `staff`, `former`): require `canManage`, else `MembersForbidden`. Read through `community.ts`.
5. With `canManage`, `getCommunityBadges()` for the rendered ids. `canStaffLink` (the Staff empty state) is `isFlagEnabled('org_portal.staff')` and `hasPermission(staff.manage)`.
6. Add person is gated on `people.manage` only (R10). The Children's roster button is unchanged.
7. A database error shows `MembersLoadError` (unchanged); `OrgAccessError` is rethrown.

`new/page.tsx` computes `canProposeRoll = hasPermission(roll.propose)` and passes it to the wizard; the wizard shows only Visitor when it is false. The server re-checks in `createPerson()` and the definer function regardless.

### Copy for every outcome

All strings are plain language, no jargon beyond the permission keys the house style already names. Organization names are not interpolated into the table (the actions have no name in scope); the page may add the name around it.

**Refusals** (`participant-copy.ts`):

| Code | Copy |
|---|---|
| `forbidden` | You don't have permission to record roll actions here. |
| `invalid_kind` | That action can't be recorded from this screen. |
| `date_out_of_range` | That date can't be used. Choose today or an earlier date that is after the person's birth date. |
| `person_not_found` | That person could not be found. |
| `person_deceased` | This person is recorded as deceased, so this can't be recorded for them. |
| `membership_ended` | This person's connection to this organization has ended, so this can't be recorded. |
| `pending_action` | This person has a roll action waiting for the Session. Wait for the Session to decide it, then try again. |
| `already_participant` | This person is already recorded as a participant. |
| `on_member_roll` | This person is on the member roll. Moving someone off the member roll is a Session decision and can't be recorded here. |
| `not_participant` | This person isn't a participant right now, so there is nothing to remove. |
| `date_before_latest_action` | That date is earlier than this person's most recent roll entry. Choose that date or a later one. |
| `holds_position` | This person still holds an office, a role or a staff position here. End that first, then try again. |
| `self_target` | You can't remove yourself as a participant. Ask another administrator. |
| `provisioning_incomplete` | This organization's membership setup isn't finished, so this can't be recorded yet. Send us a support ticket and we'll finish it. |
| `reason_required` | Say why you're undoing this entry. |
| `reason_too_long` | Keep the reason under 500 characters. |
| `action_not_found` | That entry could not be found. |
| `not_on_record_kind` | Only participant entries recorded without approval can be undone here. |
| `already_voided` | That entry was already undone. |
| `not_latest_action` | Only this person's most recent roll entry can be undone. Undo the later entry first. |
| `membership_changed` | This person's connection changed after the removal was recorded, so it can't be reopened here. Send us a support ticket. |

**Successes (toasts):**

- Wizard, Visitor: "Visitor added." Participant: "Participant added. They're counted from the date you chose." Member: "Person added. They'll appear as a member once the Session approves."
- Edit-page record form: recorded participant "Participant recorded. No approval is needed."; proposal "Roll action proposed. It's waiting for the Session to approve."
- Remove: "Removed as a participant. Undo is available from this page or under Former." with an action button "Undo" that opens the undo dialog.
- Undo of an enrolment: "Enrolment undone. They're no longer a participant." Undo of a removal: "Removal undone. They're back as a participant."
- Filed-period warning (any success that returns `affectsFiledPeriod`), a second `toast.warning`: "This changes a year that has already been filed. The filed return is not changed. If it needs correcting, file a correcting return."
- S1 warning on a proposal: "Proposed. Note: it's dated before this person's latest roll entry, so it won't change their current status when approved."

**Dialogs.** Remove: title "Remove as participant?"; body "This ends this person's connection to {name} from the date you choose. They leave the Directory and lose access if they have an account. You can undo it afterward."; fields "Effective date" (native date, default today, `max` today) and "Minute reference (optional)"; buttons "Keep" and "Remove". Undo: title "Undo this entry?"; body "This records a correction. The original entry stays in the record, marked undone, and the person goes back to how they were before it."; field "Reason (required, up to 500 characters)"; buttons "Keep it" and "Undo entry".

**Edit-page card text.** Participant: "To receive this person as a member, record a profession of faith or another gain below. No removal is needed." Pending: "Waiting for the Session to approve: {kind} effective {date}." The existing "already pending" amber notice stays.

**Wizard.** Step label "Connection". Heading "How is this person connected?" Select options: "Visitor", "Participant (takes effect now)", "Member: profession of faith (needs Session approval)". Descriptions: Visitor "Someone who has visited. Not on any roll, and not listed in the Directory."; Participant "Takes part in the life of the congregation but isn't a member. Counted as an other participant from the effective date. No approval is needed."; Member "Received by profession of faith. The Session must approve before they count as a member." Visitor fields: "First visit (optional)", "How did they hear about us? (optional)". Participant and Member fields: "Effective date", "Minute reference (optional)". Without `roll.propose` the select holds only Visitor, with the line "Participants and members are recorded by someone who can propose roll actions, such as the Clerk of Session." Review step notes: Member "This person's roll action will wait for the Session to approve before they appear as a member."; Participant "This takes effect immediately and is counted in the statistical report from the effective date."; Visitor "Visitors aren't listed in the Directory."

**Already here (match step).** "{Name} is already in this community." then one of: "They're a visitor." "They're a participant." "They're a member." "They're on staff." "They're listed here." "They're a former participant." "Their connection ended on {date}." Buttons "Open their record" (link to the edit page) and "No, this is someone new". When the candidate is already here the "Yes, this is {name}" button is not offered (it could only fail). The old "belongs to another organization" message now appears only for a person who really is elsewhere (F178).

**Pages.** Heading "Community". Limited state: "You can add and edit people at {name}, but browsing the full list needs directory access (the directory.view permission). Ask your stated clerk or another administrator to add it. Visitors and Staff above still work." Empty states: Everyone "No one yet. Add your first person to get started. Staff contacts appear under Staff once a position is recorded."; Members "No members yet. People appear here once the Session approves their roll action."; Participants "No participants yet. Add a person and choose Participant."; Visitors "No visitors yet. Add a visitor to keep track of who is coming."; Staff "No one holds a staff position yet." plus, when `canStaffLink`, "Staff positions are recorded on the Staff page." with a link; Former "No former participants." Badge labels: "Active member", "Baptized member", "Affiliate member", "Participant", "Visitor", "Waiting for the Session". The no-match and count lines keep today's wording with "people" for "members" where the view is not Members.

## Implementation Order and Batch Plan

Template order maps as: schema and catalog and binding (A, one migration) then library and actions (B) then UI (C) then audit events (B, in-transaction) then release notes (after SHIP IT). The route move is its own commit, placed **first** among the code batches: it is purely mechanical, lands green on its own, and lets Batches B and C write new files at their final paths instead of being swept twice. The security-relevant diff (A, B) therefore stays reviewable in isolation, and `git diff -M` shows Batch M as renames plus string edits only. Batches are serial, each committed by explicit path (never `git add -A`), none pushed. **Rule 16:** none of the shared files is edited by any batch; staged assets are listed under Data Model and in the hand-off.

| Batch | Scope | Implementer | Commit (prefix) | Gate |
|---|---|---|---|---|
| **M** | Route move, mechanical. `git mv` `admin/members` to `admin/community` (tests move with it); sweep the 131 references in 55 files (hrefs, `callbackUrl`, `revalidatePath`, `vi.mock` paths, comments, `scripts/seed.ts` descriptions, `scripts/check-giving-boundaries.test.mjs:165`); `tiles.ts` href only (the label stays "Members" until Batch C); `next.config.ts` redirect `{ source: "/o/:slug/admin/members/:path*", has: [platform host], destination: "/o/:slug/admin/community/:path*", permanent: true }` beside the `/orgs` one (platform-host scoped, F151: a custom host falls through to the proxy's neutral 404); add a source-scan test that `admin/members` survives only in the redirect and a short allowlist. No behavior, copy, heading or logic change. | `full-stack-developer` | `refactor(community): move /admin/members to /admin/community with a permanent redirect` | Typecheck, lint, full Vitest, `npm run check`, `next build`, redirect unit test, the grep gate, and a dev-server check that `/o/<slug>/admin/members/new?x=1` answers 308 to the new path with the query intact. |
| **A** | Migration 0061, Drizzle mirror, DB tests, staged SQL suite and patch, `docs/schema-design.md` section, fixture fixes (the four `roll.test.ts` inserts), golden regeneration. | `database-admin` | `feat(db): participant roll on record, roll permissions and clerk binding (0061)` | Apply 0061 twice to the pipeline branch (second run changes no row); apply the from-scratch recipe in `docs/testing.md` (migrations from empty, then `db:seed`) and confirm 0061 passes on a fresh database; DB-backed Vitest serially; `scripts/participants/test-rls-61.sql` as `presby_app`; `check:schema-parity`; typecheck. |
| **B** | Pure modules, `roll.ts`, `people.ts`, `community.ts`, `directory.ts` option, `audit.ts` keys, server actions, copy table, lib and action tests. | `api-developer` | `feat(roll): participant enrolment, removal and undo on record; visitors; F173` | Unit and DB tests, typecheck, `npm run check` (incl. `check:audit`), the audit-in-transaction rollback test, `createPerson()` F173 pin. |
| **C** | UI: Community page, nav, search, rows list, badges, states, wizard Connection step and already-here, edit-page card and dialogs, tile and toggle labels, component tests. | `ux-developer` | `feat(community): Community page, Connection step, remove and undo participant` | RTL tests, `check:hydration-gate`, typecheck, lint, build, and the 360px browser pass (Test Plan 5). |
| **D** | e2e: the new specs and fixture, the hydration spec, one added case in the custom-host lockdown spec; run the whole e2e suite. | `ux-developer` | `test(community): e2e for participants, visitors and the redirect` | Full `npm run test:e2e` green against a real dev server; `test:e2e:prod` for the hydration spec. |

A and M are file-disjoint and could run concurrently in two worktrees, but they share this worktree, so the plan is serial: M, A, B, C, D. After D: Phase 5 (qa), Phase 6 (analyst), then release notes (`/release-notes`, v0.38.0, tech-lead), the functionality-map line, the TODO reconciliation and the decisions, all by the orchestrator at integration. No `docs/architecture.md` change (Rule 15: nothing architectural).

**Deploy order (Edge Cases 1):** deploy the code first, then apply 0061. The reverse order breaks the old `createPerson()` against the new CHECK; the forward order only makes the participant paths fail loudly for the minutes between.

## Test Plan

### 1. The Phase 2 list, as tests (Batch A unless noted)

1. **Definer functions, owner-connection Vitest** (`src/lib/db/domain/participant-roll.db.test.ts`, serial): every outcome in both tables above, each with a fixture that produces exactly it; nothing is written on a refusal (row counts unchanged, including the sub-block rollback proof for `holds_position` and `provisioning_incomplete`, the latter using one of the branch's organizations that lack the derived group or a fixture organization with the group deleted).
2. **Identity refusals:** no organization GUC; null `p_recorded_by`; a user with no person; a person without `roll.propose`; an actor whose membership ended; a merged person; an actor from another organization. Each raises the one literal, and the message does not vary.
3. **Row shape and replay:** the inserted row's fields; `current_roll` and `current_roll_since` set; `presby_roll_as_of` returns `other_participant`; `presby_roll_counts_as_of` participant count and Total Adherents rise; `presby_roll_changes` gains no line; per-person `presby_roll_cache_drift()` clean (Measurement 2); removal ends the membership and `withOrgContext`, `resolveOrgContext` (`ended`) and `getDirectory()` each reflect it; the baseline `member` grant lapses by date.
4. **Void:** enrolment undone returns the prior state; removal undone reopens only on the marker (and `membership_changed` for a changed date, a changed reason, and an already-open membership); `not_latest_action`; the S3 index (second live void refused, a denied void does not block); `person_id` equals the target's; `affects_filed_period` true and false with a publication fixture, and a withdrawn publication does not count.
5. **R5:** as `presby_app`, an approved insert is refused (SQLSTATE 42501) and a pending insert succeeds; the owner path still inserts approved rows (fixtures).
6. **Concurrency:** two connections racing the same enrolment give one `ok` and one `already_participant`; two racing undos give one `ok` and one `already_voided` or `not_latest_action`.
7. **Audit (Batch B):** one `audit_events` row per `ok` with the exact metadata keys; a forced throw from `insertAuditRow` leaves no roll row, no membership change and no person row (for `createPerson()`); an `ok` never reuses `tenant.roll_action.approved`.
8. **Parity and source scans (Batches A and B):** `deriveRollFields` equals the SQL age for sample dates including 29 February; `ON_RECORD_ROLL_ACTION_KINDS`, the two outcome lists and the removal marker equal what `drizzle/0061` contains (scan for `p_kind not in`, `outcome := '...'`, the marker literal); only `roll.ts` names the two functions; `directory.ts` never imports `community.ts` and its predicate text never contains `'visitor'` or `'staff'`; a DB test proves visitors and staff-kind people are absent from `getDirectory()` and `findPersonMatches()`.
9. **Migration:** idempotence (apply twice); backfill (a clerk copy at an organization with a founding role gains both keys; a copy at an organization without one does not; the template gains both; no other role changes); the F173 repair against fixtures (a pending row with a null roll is repaired, an approved violator makes the stop-block raise); the three CHECKs and the index reject their violations.
10. **Forgery (Batch B):** `createPersonAction` with `profession_of_faith` stays pending whatever else the payload says; `kind: "none"` is rejected; an unknown kind is rejected; `recordRollActionAction` with a membership kind never takes effect on record; `roll.propose` and `people.manage` denials map to `forbidden`; every refusal code has copy (a runtime test over the arrays, plus the type-level exhaustiveness).
11. **Library behavior (Batch B):** `createPerson()` visitor arm (engagement `visitor`, no roll row, dates stored, no `roll.propose` needed); participant arm approved with `resulting_roll`; the member arm pending with `resulting_roll = 'active'` and an age (F173 pin); `matchPerson()` annotates `alreadyHere`; S1 `shadowedBy`; `community.ts` readers (predicates, search, pagination clamp, `forbidden` without `people.manage`, `{}` badges without it).

### 2. UI and page tests (Batch C, React Testing Library)

Community page states (flag off; `MembersForbidden` byte-identical body without `people.manage` and `directory.view`; `MembersLimited` with `people.manage` alone and Visitors still listing; Add person gated on `people.manage`; each view's empty state; badges; the nav hides Visitors, Staff and Former without `people.manage`); wizard (the select's options by `canProposeRoll`, the fields per choice, review notes, the already-here step offers the link and not the confirm button, `HydrationGate` still present); edit page (Connection card per connection; Remove visible only for a participant with the flag on and `roll.propose`; Undo visible only when the latest action is an on-record kind; the participant-to-member note); dialogs (required reason, date `max`, disabled until hydrated, the removal toast's Undo opens the undo dialog); `check:hydration-gate` passes.

### 3. Existing specs that will change (blast radius)

- **Batch M:** every colocated test under `admin/members/**` moves and has its path strings rewritten; `admin/page.test.tsx` (`:143`, `:259` expect the new href); `admin/groups/new/page.test.tsx` and `admin/officers/[personId]/page.test.tsx` (comment references only); `scripts/check-giving-boundaries.test.mjs:165` (a path example). **e2e: none** (Measurement 12).
- **Batch A:** `src/lib/roll.test.ts` (the four inserts); `src/lib/onboarding/designation-parity.golden.json` (the clerk office role's `permissions` becomes `directory.view`, `roll.propose`, `statistics.publish` in three scenarios; regenerated with `WRITE_DESIGNATION_GOLDEN=1` and the ruling recorded as DECISION-199) and `designation-parity.db.test.ts` (the scenario that pre-creates a clerk copy holding `directory.view` now also gains `roll.propose`); `src/lib/db/domain/invitations.db.test.ts` (check the `office_role_key` and permission assertions around `:735` after the golden change). **Staged patch to `scripts/test-rls.sql`:** section 20d (`:1426`, rewrite the approved insert as insert-pending-then-update, keeping the "approved delete is rejected" assertion); `:7876` (the template carries three permissions, not one); `:8039` (the fixture copy of the template has three rows); the 44a F118 assertions at `:8069-8071` (`staff.manage`, `roll.propose`, `roll.approve`: now 2, because the clerk office role carries `roll.propose`) and `:8094` (remove `roll.propose` from the "excluded by name" list); and the explanatory comment above them, because F118's "cannot touch the roll" is partly reversed (the administrator can propose; still cannot approve).
- **Batch B:** `src/lib/audit.test.ts` (the pinned catalog gains the two keys) and the `vi.mock("@/lib/audit")` in `src/lib/roll.test.ts` (its `AUDIT_ACTIONS` stub needs them); `src/lib/people.test.ts` (the `createPerson` `toEqual` result shapes at `:522` and the participant cases at `:659` and `:685`; `grantingUserId` must be linked to `managerPerson` through `people.user_id`; the pending-row assertion at `:597` gains `resultingRoll` and `ageAtAction`); `src/lib/roll.test.ts` (the participant case at `:756` now asserts an approved row; new describes); `src/lib/roll-action-kinds.test.ts`; `new/actions.test.ts`; `[id]/edit/actions.test.ts`; `src/lib/directory.test.ts` (a `rollStatuses` case).
- **Batch C:** `community/page.test.tsx` (was `members/page.test.tsx`), `members-list.test.tsx` (`:152` asserts the status options), `new/page.test.tsx`, `new/member-wizard.test.tsx`, `new/member-wizard-schema.test.ts`, `[id]/edit/page.test.tsx`, `[id]/edit/record-roll-action-form.test.tsx` and `record-roll-action-schema.test.ts`, `src/lib/org-portal/tiles.test.ts` (label), `org-feature-catalog.test.ts` (if it pins the toggle name).

### 4. e2e (Batch D)

No existing e2e spec asserts behavior this change alters. New: `e2e/community-participants.spec.ts` with `e2e/support/community-fixture.ts` (a new `e2e_community_clerk` role holding `people.manage`, `roll.propose` and `directory.view`, granted to the `congregation-clerk` fixture at the e2e organization, so no existing role is widened and no existing spec can break; the flags and the toggle on; spec-owned people cleaned up through the owner connection, the fixture exemption). It runs at desktop and at 360px: add a participant through the wizard, see them under Participants, remove, see them under Former, undo, see them back; add a visitor and find them under Visitors; the already-here step. `e2e/community-redirect.spec.ts`: an unauthenticated request to the old path answers 308 to the new path with the query string intact, and a signed-in request to `/o/<slug>/admin/members/new?x=1` lands on the new page. One added case in `e2e/custom-domains/lockdown.spec.ts`: on a custom host `/o/<slug>/admin/members` is the neutral 404 and is not redirected. `e2e/hydration/community-participant-dialogs.spec.ts`: with the page's JavaScript held, the Remove and Undo triggers are disabled (both lanes; `test:e2e:prod` runs it). The whole existing suite is then re-run as the regression lane because the shared fixture file is touched.

### 5. The 360px browser check (Batch C, repeated in D)

On the dev server in a real browser at 360 by 740 and again at 375, screenshots kept in the scratchpad and never committed: (1) Community list: header and Add person are reachable, the six-segment nav scrolls horizontally in one row (no lopsided stadium), the search form stacks, cards do not overflow, Edit is a 44px target, every empty state reads correctly; (2) the limited state as a user without `directory.view`; (3) wizard: the Connection select and its description fit, native date inputs open, review and already-here buttons are full width; (4) edit page: Connection card, both dialogs fit the viewport, the date input and reason textarea are usable, focus is trapped and returned, the toasts (including the filed-period warning and the removal toast's Undo) are legible; (5) pre-hydration: Remove and Undo triggers are disabled. A page that returns 200 is not evidence it works.

## Edge Cases & Risks

1. **Rollout window.** The S2 CHECK rejects an old `createPerson()` insert (null `resulting_roll` for a mapped kind). Deploy the code first, then apply 0061. In the other order every Add person fails until the deploy. The operator is the only production user; say so in the release hand-off.
2. **UTC date.** Dates are bounded by the database `current_date`. A US organization can, in the evening, enter tomorrow's UTC date; an organization east of UTC can be refused its own "today" for a few hours. Accepted; the date input's `max` is the browser's local today, so the common case never reaches the server refusal.
3. **Manual group memberships are not ended by a removal** (they are not derived). A removed participant keeps any manual group row; the Directory and access are gone regardless. Same F19 family; noted, not fixed.
4. **A linked account loses access at removal** (the membership ends). The dialog says so.
5. **Removal and household:** the membership keeps its `household_id`; a removed head leaves a household without a head. Out of scope.
6. **Enrolment is refused for anyone on a member roll** (`on_member_roll`) and removal for anyone not currently a participant, so the two paths cannot be used to move someone off the member roll. Participant to member goes through a proposal, which supersedes the participant roll by replay on the same membership row.
7. **No provenance restriction on undo.** A `roll.propose` holder can undo a participant enrolment that a Session approved before this pipeline, because the operator's ruling is that participants are not members and the authority that may record one on record may correct one. Recorded in DECISION-198.
8. **Orgs without a derived group** return `provisioning_incomplete` from the functions; `createPerson()` still fails earlier at its own membership insert there (pre-existing, F16).
9. **`presby_roll_cache_drift()` baseline is 4 on the branch**, so drift assertions are per person.
10. **Participant roll on non-congregation organizations** is permitted as today (not narrowed here).
11. **An enrolled visitor stays `engagement_status = 'visitor'`** (the functions never write the pastoral axis). Lists derive from the roll first, so they move between Visitors and Participants correctly, and undoing the enrolment moves them back; a person created through the wizard as a participant has engagement `regular`, so undoing their enrolment leaves them listed with no roll (Everyone only, badge-less). Documented in DECISION-200.
12. **A person added as a Member proposal appears under Everyone only** (engagement `regular`, no roll) with the "Waiting for the Session" badge until Increment 2 approves them. The Members filter stays empty until then, and its empty state says why.
13. **Stale tabs across the deploy:** a server action posted from an old client to `/admin/members/...` is a 308 and is followed with the same method; the action id, not the path, resolves it. Negligible; no mitigation.
14. **Feature-flag descriptions** in the `feature_flags` table keep the old path text until the next `db:seed`; cosmetic.
15. **Audit residual (paper):** the audit row is written by TypeScript in the same transaction (R8). A direct SQL call to the function would skip it; the source-scan test pins that nothing else calls it.

## Out of Scope (non-goals for the operator to confirm)

- Bulk import of real people (Track K); an engagement-status editor, the `follow_ups` workflow UI, and visitor archive or clean-up (Increment 3).
- Increment 2: the congregation Session baseline role carrying `roll.approve`, pending-queue visibility for `roll.propose` holders, moving approval into a definer function and extending the restrictive policy to `UPDATE`, shadow and ended-membership checks on approval, and the `memberships_one_active_roll_idx` outcome.
- Removal, transfer and loss kinds other than `other_participant_removed`, and the F19 trigger for them; reinstating an ended non-participant; ending manual group memberships on removal.
- Showing staff-kind anchors in the Directory (DECISION-129 stands) or in Everyone; a Staff filter beyond open `staff_positions` rows.
- The other first-day walls (`branding.manage`, `events.manage`, `credentials.manage`); gating admin hub tiles by permission.
- The hard-delete paths (F176); closing the `active_membership` derived group to visitors and staff (F177); `ledger.approve`'s seed-only status.
- S6: relabelling the Directory's inner "Members" tab (TODO).
- Org-local rather than UTC dates; narrowing the participant roll by organization type.

## Implementer

Named per batch: **`full-stack-developer`** (Batch M, the mechanical route move) then **`database-admin`** (Batch A, 0061 and its DB tests) then **`api-developer`** (Batch B, lib, actions, audit) then **`ux-developer`** (Batches C and D, UI, e2e and the 360px pass). The user-visible copy in the Copy section is part of the design: the operator should read it at design review, with S6, the deploy order and the "Everyone" and "Former" labels called out.

## Integration hand-offs (for the orchestrator; nothing below is edited in this pipeline)

- `drizzle/meta/_journal.json`: entry for `0061_presby_participant_roll` (0060 is the parallel pipeline's, 0058 is reserved).
- `scripts/test-rls.sql`: append `\ir participants/test-rls-61.sql`; apply `scripts/participants/test-rls.sql.integration.patch` (the edits listed in Test Plan 3); re-run against the merged `development` branch after the merge.
- `docs/decisions.md`: DECISION-197 to DECISION-201 (drafted below). `docs/schema-design-2.md`: F172 to F178 (drafted below), as a lettered review-round subsection in the 2g/2r style.
- `docs/TODO.md`: close line 184 (F173); rewrite line 193 (F111/F118: the clerk office role now carries `roll.propose`, the founding administrator can enrol participants and propose members, `roll.approve` still has no home and is Increment 2); add: (a) S6 Directory tab relabel; (b) the four development organizations without a derived `active_membership` group and the four fixture rows in `presby_roll_cache_drift()`; (c) the other first-day walls; (d) Increment 2 and Increment 3 with the Notes the architect listed; (e) F176 and F177 follow-ups; (f) the toggle display name if Batch C defers it.
- `docs/product/functionality-map.md`: update the Members line to Community (Rule 14), at ship, with the release notes (v0.38.0).
- `docs/STATE.md`: the Increment 2 pointer and the "participants take effect on record" decision.

## Drafted decisions (for `docs/decisions.md`; newest first at integration)

**DECISION-201 — The admin people section is "Community" and its route is `/o/<slug>/admin/community`, moved in the same pipeline as its own mechanical batch with a permanent, platform-host-scoped redirect.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (Phase 2 R-numbers, operator ruling "Move it now", Phase 3)

- **(a) Label.** The admin tile, the page heading and the filters (Everyone, Members, Participants, Visitors, Staff, Former) read "Community". The member-facing Directory keeps its name. Constitutional wording stays where it is exact: roll-action kind labels, "member" meaning the active, baptized or affiliate rolls, all statistical-report text, "member of the Session" and "Waiting for the Session to approve". The overlap with the "new worshiping community" organization type was noted and accepted by the operator. The tile key `members` and the flag key `org_portal.members_create` keep their names.
- **(b) Route.** The architect recommended deferring the move; the operator ruled to move it now. It ships as Batch M, first among the code batches, as renames plus string edits only (131 references in 55 files), with `/o/:slug/admin/members/:path*` redirecting permanently (`next.config.ts`, the `/orgs` precedent) and scoped to platform hosts (F151), so a custom host still answers its neutral 404. Putting it first keeps it out of the migration, function and library diffs, which stay reviewable in isolation; later batches write at the final paths.
- **(c) S6.** Relabelling the Directory's inner "Members" tab is declined here and filed. After this change "Members" means roll members in the admin section and "everyone listed" in the Directory; the TODO names it.

**DECISION-200 — Visitors and staff in Community: a visitor is a person with a live membership, engagement `visitor` and no roll row; lists are derived from the roll first; staff is a position.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory`

- A visitor is created through `createPerson()`'s `{ kind: "visitor" }` arm (`people.manage` only, `first_visit_date` and `how_heard` stored), rides `org_portal.members_create` and its toggle, and is never in the member Directory (its predicate already excludes a `visitor` with a null roll; a test pins that `directory.ts` never admits `'visitor'` or `'staff'`).
- The three admin lists (Visitors, Staff, Former participants) and the badges live in `src/lib/community.ts`, gated on `people.manage`, which `directory.ts` never imports. They do not apply `directory_hidden` (admin-only, and `people.manage` can already open any person's edit page).
- Staff is a position: the Staff filter is the set of live memberships with an open `staff_positions` row, whatever the engagement. `engagement_status = 'staff'` stays as the anchor value with no migration, and DECISION-129's Directory exclusion stands.
- The roll functions never write `engagement_status`. Visitor to participant, visitor to member and participant to member all happen on the same person and membership row; lists derive from the roll, so an enrolled visitor moves from Visitors to Participants and an undo moves them back. A person created as a participant keeps engagement `regular`.
- The wizard's match step reports "already here" (visitor, participant, member, staff, listed, former, ended) with a link to the person's edit page; the wrong "belongs to another organization" message is gone for someone already at this organization (F178).

**DECISION-199 — `roll.propose` and `roll.approve` enter the permission catalog by migration; `roll.propose` and `directory.view` bind to the `congregation_stated_clerk` template; the backfill is limited to designation-minted copies.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (DECISION-078, DECISION-155, F118, F174)

- Migration 0061 inserts both catalog keys (tier 1, module `roll`, `on conflict do nothing`); before it, only `scripts/seed-dev.sql` did, so a fresh install lacked them (F174; `ledger.approve` is also seed-only and out of scope).
- Both bindings pass DECISION-078's test: keeping the rolls is the clerk's constitutional duty, and so is reading them. `directory.view` on the clerk serves organizations without a working baseline `member` grant (F133); it does not replace that grant.
- The founding-administrator bundle is unchanged (DECISION-155). The administrator holds `roll.propose` through the clerk office role granted at designation, which survives the bundle being dissolved. **This amends F118's sentence that the founding administrator "cannot touch the roll":** the administrator can now enrol participants on record and propose members; `roll.approve` is carried by no role and member proposals queue until Increment 2.
- The backfill tops up org-owned clerk copies only at organizations that hold an org-owned `founding_administrator` role (copies designation minted or reconciled; the discriminator is the role key, never a reason text). It does not touch a copy a tenant adopted without a designation (0052 note 5: the platform does not grant ecclesiastical authority). Production count 1, recorded in the migration header as a count only. Residual, as 0057: it re-adds a key a tenant removed from a designation-minted copy. A migration backfill has no actor and writes no `audit_events` row. The design-parity golden snapshot is regenerated under this ruling.
- A new `roll.approve` home (a congregation Session baseline role) revisits DECISION-100's "no conditional branch" note and takes its own number at Increment 2's kickoff.

**DECISION-198 — Participant enrolment, removal and undo take effect on record through two `SECURITY DEFINER` functions with typed outcomes; a restrictive insert policy confines approved-at-insert to them; audit is written in the same transaction; all deletes are soft.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (R1-R14, S1-S5)

- **(a) Mechanism.** `presby_record_participant_action(...)` and `presby_void_participant_action(...)`: org from `presby_current_org()` (no parameter), `p_recorded_by` a `users.id` bound server-side and bounded (the user's live person must be an active member holding `roll.propose`, checked in the caller's transaction), `search_path = public, pg_temp`, execute to `presby_app` only. Identity refusals raise one literal; state refusals are returned as a closed outcome vocabulary (DECISION-188 style), so TypeScript never parses a message. The kind alone decides; a forged membership kind still goes down the pending path.
- **(b) Restrictive policy.** `roll_actions_insert_pending_only` allows `presby_app` to insert only `pending` rows, so the only way to insert an approved row is a definer function (or the owner, for fixtures). The approval `UPDATE` stays application-gated on `roll.approve`; closing it is Increment 2.
- **(c) Removal.** Same function and transaction: an `other_participant_removed` row (`resulting_roll` null) and `memberships.ended_on` set to the effective date with `ended_reason = 'other_participant_removed'`. Preconditions: the latest effective action is an enrolment, the replay roll is `other_participant`, no pending action, not the actor, no open staff position, and `memberships_guard_end` is respected: an open officer term or role grant returns `holds_position` and a term is never auto-ended. Never future-dated, because `ended_on is null` is the sole current predicate (DECISION-065).
- **(d) Undo.** A void row (a new approved row, `person_id` equal to its target's, effective today) of only the person's latest effective action and only of an on-record kind; voiding a removal reopens the membership only when `ended_on` and `ended_reason` still match the removal's own. A reason is required and lives in the audit row. One live void per action (S3). There is no provenance restriction: the authority to record a participant on record is the authority to correct one (participants are not members).
- **(e) Dates and ordering.** Not after `current_date` (the same UTC date the roll sync trigger uses, so nothing is ever future-dated and cache drift stays clean), not before 1900-01-01 or the birth date, and on or after the person's latest effective action. `recorded_at` is set to `clock_timestamp()` so replay ordering is strict inside one transaction. Enrolment also requires a live membership, no member roll and no pending action.
- **(f) Constraints (S2, S3).** Three validated CHECKs (`resulting_roll` matches the kind, void shape, approval status vocabulary) and the one-live-void index make F173's repair hold for every future writer. Rollout: deploy the code first, then apply 0061.
- **(g) Audit.** `tenant.roll_action.recorded` and `tenant.roll_action.voided`, written with `insertAuditRow()` in the same transaction (ids only), never `tenant.roll_action.approved`, so "the Session approved" and "recorded without approval" stay distinct. Residual: a direct SQL caller would skip it (paper, source-scan pinned).
- **(h) Filed returns.** Never altered. The functions return `affects_filed_period` (a live publication exists for a year on or after the pivot date) and the UI warns; the clerk's publish step stays the review point and these rows carry no minute reference. A correcting return is the only correction.
- **(i) Proposals (S1) and provisioning (S4).** A proposal dated before the person's latest effective action is allowed with a warning (it would not change current status); a missing derived group returns `provisioning_incomplete` from both functions.
- **(j) Soft deletes everywhere (operator ruling):** removal sets `ended_on` and `ended_reason`, a void is a new row, the backfill and repair insert and update, nothing in this pipeline hard-deletes.

**DECISION-197 — The Community page degrades honestly; Add person gates on `people.manage`; the roll-bearing choices gate on `roll.propose`, re-checked on the server.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (F172)

- Root cause on record: the first test congregation's founding administrator reached `directory.view` only through the baseline `member` role's grant to the `active_membership` group, and a test-data purge deleted that grant because its reason text carried a `dev-seed:` prefix (restored on production with operator approval, citing DECISION-100). The structural defect was that the page had no degrade.
- A `people.manage` holder without `directory.view` gets the header, Add person, the Visitors, Staff and Former lists (which need `people.manage`, not `directory.view`) and a limited state naming the missing permission. A caller without `people.manage` gets the unchanged generic forbidden body, byte-identical.
- Add person gates on `people.manage` (a Visitor needs nothing else). In the wizard the Participant and Member choices render only for `roll.propose` holders; `createPerson()` and the definer function re-check regardless. This replaces the analyst's "point to Staff" fallback.
- A discipline recorded for operators: a baseline grant must be recognised by its role and group, never by a `grant_reason` prefix, and ended with `ends_on` rather than deleted.

## Drafted findings (for `docs/schema-design-2.md`, a lettered subsection; same `### F### — title` form)

### F172 — a founding administrator could not open Members

**F172 — the Members page rendered the generic forbidden state for a `people.manage` holder without `directory.view`, and the "Add person" button never drew.** The immediate production cause was a purge deleting the baseline `member` grant (restored). **Closed:** the page degrades (DECISION-197) and the clerk template now carries `directory.view` (DECISION-199).

### F173 — `createPerson()` wrote no `resulting_roll` and no `age_at_action`

**F173 — a person created through the wizard got a roll action with a null `resulting_roll`,** so `presby_sync_current_roll` wrote `current_roll = null` on approval and every profession of faith read as "18 and older" (`coalesce(age_at_action, 99)`). Promoted from `docs/TODO.md:184`. **Closed** in TypeScript (`deriveRollFields`, shared with `recordRollAction()`), repaired in 0061 for pending rows, and made a database property by `roll_actions_resulting_roll_matches_kind`.

### F174 — `roll.propose` and `roll.approve` were seeded by no migration

**F174 — the two keys exist only in `scripts/seed-dev.sql`,** so a fresh install (migrations plus `db:seed`) lacked them and nothing could bind them. **Closed** by 0061's catalog insert. `ledger.approve` has the same gap and is out of scope.

### F175 — no correction path for an approved roll row

**F175 — an approved row is frozen and the edit-time picker excludes `void`,** so a mistaken participant entry would have been permanent in the app. **Closed** for the on-record kinds by `presby_void_participant_action()` (DECISION-198).

### F176 — hard-delete paths in the people and membership area

**F176 — several paths hard-delete:** `updatePerson()` deletes the primary `contact_methods` and `addresses` rows when a field is blanked (`src/lib/people.ts`); `presby_app` holds `DELETE` on `memberships`, `roll_actions`, `households`, `addresses`, `contact_methods`, `follow_ups`, `person_notes` and `staff_positions` while only `people` carries a delete guard; pending `roll_actions` rows are deletable by design (0028, `test-rls.sql` section 20d), though under the soft-delete rule a mistaken proposal should be denied; the morning's purge deleted a `role_grants` row that `ends_on` would have ended recoverably; test fixtures delete through the owner (a fixture exemption). **Filed, not fixed here.**

### F177 — the `active_membership` derived group admits visitors and staff anchors

**F177 — every live membership mirrors into the `active_membership` group,** so the baseline `member` role (`directory.view`, `events.view`) would reach a visitor or staff anchor who ever had a linked account. Today only invitation acceptance links a user to a person, so nothing is exposed. **Open: must be closed before any member self-service sign-in.**

### F178 — the wizard's match step named the wrong organization

**F178 — confirming a "same person?" match on someone already at this organization reached `memberships_guard_insert` and showed "That person already belongs to another organization."** **Closed:** `matchPerson()` annotates `alreadyHere` and the wizard offers a link to the person's record (DECISION-200).

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete (design to R1-R14; S1-S6 ruled; route move designed as its own Batch M) | Design complete; implementers named | 2026-10-22 |

## Handoff

Next: **Phase 4**, serial: **Batch M** (`full-stack-developer`), **Batch A** (`database-admin`), **Batch B** (`api-developer`), **Batch C and D** (`ux-developer`). The orchestrator records this section, the status row, and the integration hand-offs above. Operator design-review questions: confirm the copy, the "Everyone" and "Former" labels, S6 (decline), deploy-code-then-apply-0061, and that Visitors ride `org_portal.members_create`.

---

# Phase 4 — Implementation

## Phase 4 — Batch M (route move) — full-stack-developer, 2026-10-22

A pure move: `/o/<slug>/admin/members` becomes `/o/<slug>/admin/community`, with a permanent platform-host-scoped redirect for the old paths. No behaviour, copy, heading, logic, permission or schema change. The tile label stays "Members" (Batch C renames it). Committed as `refactor(community): ...`.

### Files created

- `src/lib/route-move-community.test.ts` — (1) the real `next.config.ts` `redirects()` carries `/o/:slug/admin/members/:path*` as permanent (308), to `/o/:slug/admin/community/:path*`, with the same platform-host `has` value as `/orgs` (F151); (2) a source scan: the old path string appears in no file under `src/`, `scripts/` or `e2e/` except a two-file allowlist (this test and `src/lib/giving/csp.test.ts`); (3) in `next.config.ts` it appears only on the redirect's `source` line; (4) the old route directory no longer exists.

### Files modified

- `next.config.ts` — the redirect entry beside `/orgs`, with a comment naming F151 and DECISION-201.
- `src/lib/giving/csp.test.ts` — the existing `/orgs` redirect test asserted `rest` was empty; it now asserts the one other redirect is the community move (whose own assertions live in the new test).
- The route directory, `git mv`'d: `src/app/(org)/o/[slug]/admin/members/` to `.../admin/community/` (56 files: 33 source, 23 colocated tests). Git sees them as renames plus string edits (`git diff -M`).
- String sweep `admin/members` to `admin/community` in: the moved files (hrefs, `callbackUrl`, `router.push`, `backHref`, `revalidatePath`, test expectations, header comments); `admin/page.test.tsx` (`:143`, `:259`); `admin/credentials/record-{ordination,appointment}-form.tsx` (hrefs); comment-only references in `admin/{groups,staff,officers}/**`; `src/lib/org-portal/tiles.ts` (href only); `src/lib/{roll,roll-action-kinds,people,credentials,audit,audit.test,org-features}.ts` and `src/lib/db/domain/people.ts` (comments); `scripts/seed.ts` (flag description text and comments; the descriptions are only written on a seed run); `scripts/check-giving-boundaries.test.mjs:165` (a path example).
- One reference the first sweep missed because it is URL-encoded: `admin%2Fmembers` in `community/page.test.tsx:299` (a `callbackUrl` expectation). Found by the unit suite, not by grep for `admin/members`.
- Not renamed, on purpose: the `members-states.tsx`, `members-list.tsx` and `member-wizard*` file names and component names (Phase 3 keeps them so Batch M stays mechanical); relative imports (`../members-states`) are unchanged because the files moved together; the `members` tile key and the `org_portal.members_create` flag key.

### Schema, audit, env

None. No migration, no `AUDIT_ACTIONS` key, no env var, no `FEATURES` entry, no permission change. No Rule 16 shared file was edited (`drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `src/lib/db/domain/index.ts`, `CLAUDE.md`).

### Gates run (in the `presby-fadir` worktree)

- `npm run typecheck`, `npm run lint` (`--max-warnings=0`), `npm run check` (all eight tripwires, exit 0): pass.
- `npm run test`: 492 files passed, 67 skipped (DB-backed, not run here), 0 failed; 7267 tests passed. Two failures surfaced along the way and were fixed in this batch: the URL-encoded `callbackUrl` (above) and `csp.test.ts`'s "no other redirect" assertion.
- `npm run build`: pass; the route table lists `/o/[slug]/admin/community/**` and nothing under `admin/members`.
- Grep gate: `grep -rn "admin/members"` outside `docs/` finds only the redirect (`next.config.ts:178`) and the four test files that assert it.
- Dev server, `curl` (platform host, no session): `/o/alder-creek/admin/members` answers `308 Permanent Redirect` to `/o/alder-creek/admin/community`; `/admin/members/new?x=1&y=2` to `/admin/community/new?x=1&y=2` (query intact); `/admin/members/p-1/edit/guardians` and `/admin/members/pending` redirect with the sub-path; `/orgs` still `308` to `/home`; the new path answers `307` to `/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fcommunity` for a signed-out caller. A request with a custom `Host` (`church-one.invalid`) for the old path answers `404`, not the redirect (F151).
- Browser (Playwright Chromium, 360 x 800, signed in as the seeded `clerk.fixture` at Alder Creek): the Community page loads at `/o/alder-creek/admin/community` with no page errors and no horizontal overflow (scrollWidth 360); "Add person" and every Edit link point at `/admin/community/...`; the admin hub tile points at `/admin/community`; an Edit page loads at the new path; the old path followed in the browser lands on `/admin/community/new?x=1`. The page rendered its list only after turning on `org_portal.members_create` for Alder Creek on the pipeline Neon branch; that toggle row was added for the check and deleted afterwards, so the branch is as it was.

### Implementer notes

- The page's `<h1>` still reads "Members" and its copy is unchanged; Batch C owns the label.
- Old `/admin/members` URLs are only redirected on platform hosts, by `redirects()`, which runs before the proxy. The proxy needed no change.
- The sign-in `callbackUrl` after the redirect drops the query string (`sanitizeCallbackUrl`), which is existing behaviour and not part of this batch.
- Documentation is not swept: work-logs, `docs/decisions.md`, `docs/schema-design-2.md` and the release notes record history under the old path and are left as written.

### For the orchestrator (not edited, per Rule 16)

- **CLAUDE.md:** no mention of the old route (searched `admin/members`, `/members`, `members/**`); nothing to change there.
- **`docs/TODO.md`:** 11 lines mention `admin/members`; review which are open items that now name a stale path (update at integration).
- **`docs/decisions.md`:** 5 mentions, all historical; DECISION-201 already records the move.
- **`docs/product/functionality-map.md`:** 3 mentions; update at ship time (Rule 14) when the label changes in Batch C.
- `docs/work-log/*` (about 25 older files) and `docs/release-notes/v0.17.md`, `v0.18.md` keep the old path as history.

### Handoff

Next: **Batch A** (`database-admin`, migration 0061). Batches B, C and D write at the final `community/` paths. Browser follow-up for QA: signed-out `curl -I` on `/o/<slug>/admin/members/new?x=1` shows `308` and the new `location`, and the Community page at 360px.

---

## Phase 4 — Batch A (migration 0061) — database-admin, 2026-10-22

Migration 0061, its Drizzle mirror, the DB tests, the staged section 61 suite and the `test-rls.sql` integration patch, built to Phase 3's Data Model in its stated order (catalog, clerk template binding, narrowed backfill, F173 repair and stop-block, CHECKs and index, restrictive insert policy, the two helpers and two definer functions, comments). Worked only in `presby-fadir` against Neon branch `pipeline-founding-admin-directory` (`ep-jolly-boat-axklya0l`). Committed as `feat(db): ...`.

### Migration mode

**Hand-written**: `drizzle/0061_presby_participant_roll.sql`, applied with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0061_presby_participant_roll.sql` (owner, direct endpoint). `db:generate` is broken repo-wide (snapshot collision, `docs/TODO.md`). **No `_journal.json` entry**: Rule 16, it is added at integration (`{ idx: 61, tag: "0061_presby_participant_roll" }`).

**Idempotence, whole file, three applies:** first apply exit 0 (`INSERT 0 0` catalog, already seeded by `seed-dev.sql`; `INSERT 0 2` template binding; `INSERT 0 0` backfill, no designation-minted clerk copy on the branch; `UPDATE 0` repair; stop-block passes). Second whole-file apply exit 0 with `INSERT 0 0 / 0 / 0`, `UPDATE 0`, and a before/after snapshot (row counts of `permissions`, `app_role_permissions`, `roll_actions`, `memberships`, plus md5 digests of the full `roll_actions` and `app_role_permissions` contents) **identical**. Third apply exit 0. It was re-applied a further five times as the restore step of the failing-first proofs below, each exit 0.

### Files created

- `drizzle/0061_presby_participant_roll.sql`: the migration. Header records the production clerk-copy count (1, a count only), the deploy order (code first, then 0061) and what the file deliberately does not do.
- `src/lib/db/domain/participant-roll.db.test.ts`: 42 tests, owner plus `presby_app` connections. Structure (definer, pinned `search_path`, ACLs, the restrictive policy, validated CHECKs, the index, catalog and template); the migration's own sections 3 and 4 re-executed against fixtures inside rolled-back transactions (the backfill touches only a designation-minted copy; sections 1 to 3 replay as no-ops; the F173 repair fills `resulting_roll` and `age_at_action` on pending rows and leaves loss kinds null; the stop-block raises on an approved violator); constraint parity with `ROLL_ACTION_KIND_TO_ROLL` for all 16 non-void kinds; R5; every identity refusal (no GUC, null actor, user without a person, no `roll.propose`, another org's holder, a merged person, an ended membership, the actor under another org's context) as the one literal with SQLSTATE 42501; every record and void outcome with a fixture producing exactly it, and "nothing written" proven by a per-person state snapshot (roll rows, membership end and reason, cache, engagement, derived group row); row shape and replay (SASR participant and Total Adherents +1, no `presby_roll_changes` line, per-person drift 0); removal reflected by `withOrgContext` (throws), `resolveOrgContext` (`ended`, dated) and `getDirectory` (dropped), and the derived group row lapsing; undo of an enrolment and of a removal; `affects_filed_period` true and false and withdrawn (rolled back, with a real `statistical_returns` plus `publications` fixture); two racing enrolments (one `ok`, one `already_participant`) and two racing undos; source scans of the outcome vocabularies, the kind list, the marker, no org parameter, and no `delete` in the file.
- `scripts/participants/test-rls-61.sql`: the staged section 61 suite, 34 assertions, must run as `presby_app` (header says so and asserts it). Structure; R5 behaviour (approved and denied inserts refused, pending allowed, F173's null-roll shape refused by the CHECK); identity refusals with the exact literal (no org, no `roll.propose`, null actor, the void function, another org's context); the sanctioned path end to end as the seed clerk (enrol, derived fields, cache, `already_participant`, `on_member_roll`, `invalid_kind`, `holds_position` without ending the membership or the grant, undo, the void's `person_id`, `already_voided`, the original frozen). Every writing block rolls back. Uses the existing Alder Creek seed (no seed change).
- `scripts/participants/test-rls.sql.integration.patch`: unified diff against today's `scripts/test-rls.sql` (`git apply --check` clean, 45 insertions, 10 deletions). It rewrites section 20d's approved insert as insert-pending-then-update (keeping "approved delete is rejected"); the clerk template count 1 to 3, plus two new assertions (holds `roll.propose` and `directory.view`, never `roll.approve`); the 44a office copy count 1 to 3; the 44a F118 split 1 to 2 (staff.manage and roll.propose, never roll.approve) with a new assertion that the bundle itself carries neither roll key; removes `roll.propose` from the "excluded by name" list, with the comments amended; and **appends the `\ir participants/test-rls-61.sql` line with a banner**, so one `git apply` does the whole integration.

### Files modified

- `src/lib/db/domain/roll.ts`: `check()` for the three constraints, the partial `uniqueIndex` for S3, and a comment naming what Drizzle cannot express (the restrictive policy, the two functions) with their migration sections.
- `src/lib/roll.test.ts`: the four fixture inserts Phase 3 measured (`:279`, `:297`, `:516`, `:539`) now carry the mapped `resultingRoll`.
- `src/lib/people.ts` and `src/lib/people.test.ts`: **deviation, see below.** `createPerson()` sets `resultingRoll: ROLL_ACTION_KIND_TO_ROLL[kind]` on its pending row; the pending-row assertion pins `resultingRoll: "active"`, named as the F173 regression.
- `src/lib/onboarding/designation-parity.golden.json`: regenerated with `WRITE_DESIGNATION_GOLDEN=1` under DECISION-199. The diff is exactly the three congregation clerk-office scenarios Phase 3 named (created person, existing person, F109 reuse; the last already held `directory.view` and gains `roll.propose`). Presbytery clerk and treasurer scenarios unchanged.
- `docs/schema-design.md`: new subsection "Participants on record" under Section D (not a Rule 16 file). `npm run docs:erd` regenerated with no diff (CHECKs and indexes are not drawn).

### Schema changes

- No new table, column or FK. New: three validated CHECKs and one partial unique index on `roll_actions`; policy `roll_actions_insert_pending_only` (restrictive, insert, `presby_app`); functions `presby_deny_participant_action()`, `presby_participant__actor_may_propose(uuid, uuid)` (owner-only), `presby_record_participant_action(...)`, `presby_void_participant_action(...)`; catalog rows `roll.propose`, `roll.approve`; template rows `congregation_stated_clerk` gets `roll.propose` and `directory.view`; a column comment on `memberships.ended_reason` naming the marker.
- `npm run check:schema-parity`: 85 tables, 0 failing (the 7 allowlisted differences are pre-existing).

### Audit events

None in Batch A. The functions deliberately write no audit row (R8): Batch B writes `ROLL_ACTION_RECORDED` and `ROLL_ACTION_VOIDED` with `insertAuditRow()` in the same transaction. The migration's backfill has no actor and writes none (DECISION-199).

### Gates

- **Apply twice, no-op:** above.
- **DB tests, serial** (`npx dotenv -e .env.local -- vitest run --no-file-parallelism ...`): `participant-roll.db.test.ts`, `roll.test.ts`, `people.test.ts`, `designation-parity.db.test.ts`, `invitations.db.test.ts`, `accept.db.test.ts`, `issue.db.test.ts`: **240 tests in 7 files.** 237 passed on the first pass. The 3 failures were all `Test timed out in 20000ms` in `invitations.db.test.ts` (`:1058`, `:1073`, `:1081`, the injector-trigger cases; no assertion failed), and that file passed 66/66 on re-run. The new file passed 42/42 on its first run and on the gate run.
- **Staged test-rls as `presby_app`:** `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/participants/test-rls-61.sql` exits 0 with 34 passes. The **patched full suite** (the patch applied to a scratch copy, with `ON_ERROR_STOP` turned off so every section runs) shows 1120 passes against 1083 before 0061, and **the same three failures as before 0061**. Those three are pre-existing drift on this branch, not caused by 0061: "presbytery: sees only its own members" (the known third membership at Northern Reach), "2fa policy: definer function sees the requirement with no org GUC set", and "DECISION-152: exactly ONE org-owned role holds statistics.publish" (got 2). Note for integration: **the unmodified `scripts/test-rls.sql` with `ON_ERROR_STOP` (its own `\set`, line 13) halts at line 217 on this branch before and after 0061**, so a whole-file green run needs a clean `development` seed.
- **typecheck, lint, `npm run check` (all eight tripwires), `npm run test`** (493 files passed, 68 skipped, 7268 tests): pass.

### Failing-first proofs (each broken on the branch, tested, then restored by re-applying 0061 and re-tested green)

| Mechanism | How it was broken | Failure observed | Restored |
|---|---|---|---|
| R5 restrictive policy | `drop policy roll_actions_insert_pending_only` | Vitest `participant-roll.db.test.ts:433` (`expected ['tenant_isolation'] to deeply equal [...]`) and `:643` (an approved insert as `presby_app` **succeeded**: `approved: expected undefined to be '42501'`); `test-rls-61.sql:59` (61a structure) and, with stop-on-error off, `:114` "FAIL 61b - presby_app inserted an APPROVED roll row directly" | 2/2 green, SQL exit 0 |
| Actor permission check | dropped `presby_has_permission(..., 'roll.propose')` from the actor helper | `:679` and `:716` "expected the uniform identity refusal: expected undefined to be defined" (the no-permission user recorded and voided); `test-rls-61.sql:171` "FAIL 61c - a member without roll.propose recorded a participant" | 3/3 green |
| Org from `presby_current_org()` | record function falls back to the target's own org when no GUC is set | `:676` (via `:255`) wrong literal; `test-rls-61.sql:157` "FAIL 61c - wrong literal: presby_effective_permissions: may only be called for the current org context". The existing `presby_effective_permissions` guard also fired; the exact-literal assertion is what catches the break | 3/3 green |
| Void `person_id` match | the void row takes the actor's person instead of the target's | `:970` "expected {...} to match object { kind: 'void', ... }"; `test-rls-61.sql:276` "FAIL 61d (R10): the void row carries the target's person_id" | 1/1 green |
| Date bounds | removed the future and pre-1900 bound and the birth-date floor | `:746` (via `:730`) "expected { outcome: 'ok' } to deeply equal { outcome: 'date_out_of_range' }" | 1/1 green |

### Deviations from Phase 3, and why

1. **`createPerson()` F173 bridge pulled forward from Batch B (minimal).** After 0061 the CHECK refuses `createPerson()`'s null `resulting_roll`, so two existing `people.test.ts` cases failed on the branch (measured, against production code, not a fixture). Batch A's gate requires green DB tests, so `createPerson()` now sets `resultingRoll` from the existing `ROLL_ACTION_KIND_TO_ROLL`, a one-line change, and `people.test.ts` pins it. **Batch B still owns the full F173 fix:** `deriveRollFields()`, `age_at_action`, the participant arm through `recordParticipantActionInTx`, and the other `people.test.ts` changes Phase 3 lists (`grantingUserId` linkage, result shapes). The bridge also makes the deploy-order risk in Edge Cases 1 smaller, because the code half of it now exists.
2. **The integration patch includes the `\ir` line** (with a banner in the 46/47/59 style) instead of leaving it as a separate instruction. Staged path `scripts/participants/`, as Phase 3 named it.
3. **`already_voided` also covers a live pending void.** The S3 index blocks a second live void, pending included, so the void function catches that `unique_violation` and returns `already_voided`, never a raw error. Phase 3's table described only an approved void.
4. **The restrictive policy refuses `denied` at insert too**, by construction (pending only), and the tests assert it.
5. **A column comment on `memberships.ended_reason`** carries the fixed marker (Phase 3's "comments on ... the removal marker").
6. **Not run: Phase 3's from-scratch recipe** (migrations from empty, then `db:seed`). It needs a second, empty database, and this batch was confined to the pipeline branch. The fresh-install half of F174 is covered by section 1's `on conflict do nothing` insert and the structure test. Phase 5 or the orchestrator should run it on a throwaway branch.
7. **Test teardown** deletes the `deletable_until`-stamped fixture organizations. Approved roll rows are frozen, so teardown disables `roll_actions_freeze` around that cascade, as `roll.test.ts` and `people.test.ts` already do (and `group_memberships_reject_derived`, as every DB suite does). No production path and no migration deletes anything (R14; a source scan pins that the migration has no `delete`). The `fixture-deletable` leak canary is why teardown cannot simply be skipped. Every other owner-side check runs in a transaction that is always rolled back.

### Environment notes

- My baseline run of `issue.db.test.ts` (before 0061) lost its connection and skipped its teardown, leaving 10 stamped organizations, 4 stamped people and 11 users. That broke an unrelated `test-rls.sql` coverage assertion ("Ruling 7 ... expected 25, got 15"). I removed them through the `deletable_until` path while they were still inside their window. That cascade also explains a `memberships` (-4) and `app_role_permissions` (-2) difference against my post-apply snapshot. `roll_actions` is byte-identical to the post-apply snapshot. After the last run no stamped organization or person remains on the branch.
- `presby_roll_cache_drift()` baseline on the branch is still the 4 fixture rows Phase 3 measured. All drift assertions are per person.

### Call shapes for Batch B (`src/lib/roll.ts`; nothing outside it may name these functions)

Inside the caller's `withOrgContext` transaction (the GUC is already set; do not pass an org):

```ts
const r = await tx.execute(sql`
  select * from presby_record_participant_action(
    ${personId}::uuid, ${kind}::roll_action_kind, ${effectiveDate}::date,
    ${minuteReference ?? null}::text, ${actingUserId}::uuid)`);
// exactly one row: { outcome: string; roll_action_id: string | null;
//                    membership_ended: boolean; affects_filed_period: boolean }

const v = await tx.execute(sql`
  select * from presby_void_participant_action(
    ${rollActionId}::uuid, ${reason}::text, ${actingUserId}::uuid)`);
// exactly one row: { outcome; void_roll_action_id; voided_action_id;
//                    voided_kind: 'other_participant_enrolled' | 'other_participant_removed' | null;
//                    membership_reopened: boolean; affects_filed_period: boolean }
```

- **Identity refusal** is raised: SQLSTATE `42501`, message exactly `roll_actions: this participant action is not permitted`. Map it to `{ kind: "forbidden" }`. It is checked before everything else, so a bad kind or blank reason from an unauthorized caller still raises.
- **Record outcomes** (pin `PARTICIPANT_RECORD_REFUSALS` to these; the DB test scans the SQL): `ok`, `invalid_kind`, `date_out_of_range`, `person_not_found`, `person_deceased`, `membership_ended`, `pending_action`, `already_participant`, `on_member_roll`, `not_participant`, `date_before_latest_action`, `holds_position`, `self_target`, `provisioning_incomplete`.
- **Void outcomes**: `ok`, `reason_required`, `reason_too_long`, `action_not_found`, `not_on_record_kind`, `already_voided`, `not_latest_action`, `membership_changed`, `provisioning_incomplete`.
- On a non-`ok` outcome the id columns are null, the booleans false, and **nothing was written**. The function's sub-blocks roll back their own partial writes. The caller must still throw to roll back its own transaction (the `CreatePersonAbort` lesson).
- **Marker:** `PARTICIPANT_REMOVAL_ENDED_REASON = 'other_participant_removed'`. **Kinds:** `ON_RECORD_ROLL_ACTION_KINDS = ['other_participant_enrolled', 'other_participant_removed']`.
- The function trims the minute reference (blank becomes null) and enforces no length; the action's 200-character cap is TypeScript's. It trims the reason only for its own empty and >500 checks and **does not store it**. Pass the trimmed reason to the audit metadata.
- `age_at_action` in SQL is `date_part('year', age(effective_date, date_of_birth))::int` on the stored `date_of_birth`, whether or not `birth_year_only` (the year-only flag affects only the date floor, 1 January). `deriveRollFields` must match this table, which the DB test pins: dob 2000-02-29 gives 24 on 2025-02-28, 25 on 2025-03-01, 23 on 2024-02-28, 24 on 2024-02-29; dob 2000-06-15 gives 25 on 2026-06-14 and 26 on 2026-06-15.
- Dates are bounded by the database `current_date` (UTC). `todayUtcYmd()` must agree.
- `presby_app` can still insert **pending** rows directly (`recordRollAction()`'s proposal path). Any approved insert from `presby_app` now fails with `42501` "new row violates row-level security policy". The approval `UPDATE` in `decideRollAction()` is unaffected.
- The `createPerson()` bridge (deviation 1) is the line to replace with `deriveRollFields()`.

### Handoff

Next: **Batch B** (`api-developer`). Local apply for anyone rebuilding the branch: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0061_presby_participant_roll.sql` (idempotent). No seed change. `test-rls` section 61 is added by the staged patch at integration (Rule 16). The orchestrator's integration list gains: the `_journal.json` entry; `git apply scripts/participants/test-rls.sql.integration.patch`, then re-run `scripts/test-rls.sql` as `presby_app` on merged `development`; the from-scratch fresh-install check (deviation 6).

---

## Phase 4 — Batch B (server: lib, actions, audit) — api-developer, 2026-10-22

The library, the audit rows and the server actions for participants on record, visitors, Community readers and the F173 fix, built to Phase 3's "Library" and "Server actions" sections and Batch A's call shapes. No schema, no UI, no `FEATURES` entry, no new flag. Committed as `feat(community): ...`.

### Files created

- `src/lib/ymd.ts` — `isRealYmd()` (shape plus calendar round trip: `2026-02-30` refused) and `todayUtcYmd()` (the database's `current_date`, UTC).
- `src/lib/is-uuid.ts` — `isUuid()`, so a malformed id is "not found" and never a Postgres cast error.
- `src/lib/community-labels.ts` — pure: `COMMUNITY_VIEWS`, `parseCommunityView()`, `Connection`, `CONNECTION_LABELS`, `deriveConnection()` (precedence: ended / former participant, member roll, participant roll, engagement visitor, engagement staff, listed), `alreadyHereSentence()` (the Phase 3 "already here" copy).
- `src/lib/community.ts` — `server-only`; `listVisitors`, `listStaff`, `listFormerParticipants`, `getCommunityBadges`, `getCommunityStatus`; every one gated on `people.manage`; read-only.
- `src/app/(org)/o/[slug]/admin/community/participant-copy.ts` — the one copy table (`PARTICIPANT_COPY: Record<refusal | "forbidden", string>`, plus `VALIDATION_COPY`, `SUCCESS_COPY`, `CREATE_COPY`).
- Tests: `src/lib/ymd.test.ts`, `src/lib/community-labels.test.ts`, `src/lib/participant-boundaries.test.ts` (source scans), `src/lib/community.db.test.ts`, `src/lib/roll-derive-parity.db.test.ts`, `.../community/participant-copy.test.ts`.

### Files modified

- `src/lib/roll-action-kinds.ts` — `ON_RECORD_ROLL_ACTION_KINDS` (pinned to the SQL's `p_kind not in (...)` by a source scan), `isOnRecordKind()`, `PARTICIPANT_REMOVAL_ENDED_REASON`, `PARTICIPANT_RECORD_REFUSALS` / `PARTICIPANT_VOID_REFUSALS` (each pinned to its function's `outcome := '...'` literals), and `deriveRollFields(kind, dob, effectiveDate)`, which replaces `roll.ts`'s private `ageAsOf`.
- `src/lib/roll.ts` — `recordParticipantActionInTx()`, `recordParticipantAction()`, `voidParticipantAction()`; `recordRollAction()` reworked (below). The only file that names the two definer functions.
- `src/lib/people.ts` — `createPerson()` (F173 fix, visitor arm, participant arm, `already_here`, `roll_refused`, new result shape, optional fifth `opts`); `matchPerson()` annotates `alreadyHere`.
- `src/lib/directory.ts` — exactly one new option, `rollStatuses`; the privacy predicate is otherwise untouched.
- `src/lib/audit.ts` — `ROLL_ACTION_RECORDED: "tenant.roll_action.recorded"`, `ROLL_ACTION_VOIDED: "tenant.roll_action.voided"`.
- `.../community/new/actions.ts`, `.../community/[id]/edit/actions.ts` — the actions below. `.../admin/staff/actions.ts` — two new `createPerson()` result variants handled so its switch stays exhaustive (it still pins `rollAction` to `none`).
- Tests changed: `audit.test.ts`, `roll-action-kinds.test.ts`, `roll.test.ts`, `people.test.ts`, `directory.test.ts`, both actions test files.

### Contract for Batches C and D

**Gate for every action:** `auth()` (401-equivalent copy "You must be signed in to do that."), `resolveOrgContext(session.user.id, slug)` re-run in the body (else "You don't have access to that organization."), `organizationId` and `personId` from the resolved context, never from the client. The permission is checked inside the lib's transaction. `ActionResult<T>` everywhere. The acting email goes to the audit row only.

| Action (file) | Permission checked in the lib | Success data | Revalidates |
|---|---|---|---|
| `createPersonAction(slug, input: CreatePersonInput)` (`new/actions.ts`) | `people.manage` always; `roll.propose` for `profession_of_faith` and `other_participant_enrolled` (not `visitor`) | `{ personId, rollActionId: string \| null, effect: "none" \| "pending" \| "recorded", affectsFiledPeriod }` | community, community/pending |
| `matchPersonAction(slug, input)` (`new/actions.ts`) | `people.manage` | `{ candidates: MatchCandidate[] }`, each with `alreadyHere: { connection, endedOn } \| null` | none |
| `removeParticipantAction(slug, { personId, effectiveDate, minuteReference? })` (`[id]/edit/actions.ts`) | `roll.propose` + the definer function's own check | `{ rollActionId, affectsFiledPeriod }` | community, the person's edit page, directory |
| `undoParticipantEntryAction(slug, { rollActionId, reason })` (`[id]/edit/actions.ts`) | `roll.propose` + the function's check | `{ voidRollActionId, membershipReopened, affectsFiledPeriod, undoneKind }` | community, edit pages, directory |
| `recordRollActionAction(slug, input: RecordRollActionInput)` (`[id]/edit/actions.ts`, extended) | `roll.propose` | `{ rollActionId, effect: "pending" \| "recorded", affectsFiledPeriod, shadowed: { kind, effectiveDate } \| null }` | community, pending, the person's edit page |

- The removal's kind is fixed inside `removeParticipantAction`; nothing in a payload chooses it. `createPersonAction` and `recordRollActionAction` rebuild `rollAction` / the input from known fields, so a stray property (an approval flag, an organization id) never reaches the lib. `createPersonAction` accepts exactly `profession_of_faith`, `other_participant_enrolled` and `visitor`; `none` and anything else is refused with "A connection is required to add a new person."
- Validation before the lib (a message, never a 500): real `YYYY-MM-DD` dates; a participant enrolment and a removal may not be dated after today (UTC), a proposal may be dated ahead (the Session decides it, F29); minute reference at most 200; how-heard at most 200; first visit not after today; reason 1 to 500 after trimming; ids must be UUIDs.
- **The client-side copy source for toasts is `participant-copy.ts`** (`PARTICIPANT_COPY`, `SUCCESS_COPY`, `CREATE_COPY`, `VALIDATION_COPY`); `SUCCESS_COPY.filedPeriodWarning` and `.shadowedProposal` are the two warning texts for `affectsFiledPeriod` and `shadowed`. Every refusal code has a string (a type error otherwise, and a runtime test over the arrays).
- `affectsFiledPeriod` and `shadowed` are returned on `ok`; the UI shows them as a second `toast.warning`.

**Library signatures** (all take `actingPersonId, organizationId, actingUserId`, then input, then `opts?: { actingUserEmail?: string \| null }`):

```ts
recordParticipantAction(..., { personId, kind: OnRecordRollActionKind, effectiveDate, minuteReference? }): Promise<
  { kind: "ok"; rollActionId; membershipEnded; affectsFiledPeriod } | { kind: "forbidden" } | { kind: "refused"; reason: ParticipantRecordRefusal }>
voidParticipantAction(..., { rollActionId, reason }): Promise<
  { kind: "ok"; voidRollActionId; voidedActionId; voidedKind; membershipReopened; affectsFiledPeriod } | { kind: "forbidden" } | { kind: "refused"; reason: ParticipantVoidRefusal }>
recordRollAction(..., input, opts?): ok | forbidden | not_found | invalid_kind | { kind: "refused"; reason }
createPerson(..., input, opts?): ok{personId, rollActionId|null, effect, affectsFiledPeriod} | forbidden | existing_member_elsewhere | already_here | invalid_household | { kind: "roll_refused"; reason }
matchPerson(...): candidates carry alreadyHere
getDirectory(personId, orgId, { rollStatuses?: readonly DirectoryStatus[], ... })
listVisitors / listStaff / listFormerParticipants(viewerPersonId, orgId, { search?, page, pageSize }): { kind: "ok"; rows: CommunityRow[]; pagination } | { kind: "forbidden" }
getCommunityBadges(viewerPersonId, orgId, personIds): Record<personId, "active"|"baptized"|"affiliate"|"participant"|"visitor"|"waiting">   // {} without people.manage
getCommunityStatus(viewerPersonId, orgId, personId): ok{status} | forbidden | not_found
```

`CommunityRow = { personId, displayName, email, firstVisitDate, positions: string[], endedOn }`. `CommunityStatus = { personId, connection, currentRoll, currentRollSince, endedOn, hasOpenStaffPosition, pendingCount, latestAction: { id, kind, effectiveDate, onRecordKind } \| null }`. `rollStatuses` for the Members view is `['active','baptized','affiliate']`; an empty set matches nothing.

**Data gating per DECISION-197 (the data half; the page composition is Batch C):** `getDirectory()` still returns `forbidden` without `directory.view`; the three admin lists, the badges and the status are gated on `people.manage` instead and never on `directory.view`. So for a `people.manage` holder without `directory.view`, the Directory-backed views (Everyone, Members, Participants) are `forbidden` while Visitors, Staff and Former return `ok` (a DB test pins both). A caller with neither gets `forbidden` from every reader and `{}` from badges. The page's `MembersLimited` / `MembersForbidden` choice is a one-line branch on those results.

### How a non-ok result is handled

Every non-`ok` outcome rolls the caller's whole transaction back (the `CreatePersonAbort` lesson: an early `return` from `db.transaction()` commits). `recordParticipantActionInTx()` returns the typed result; its callers (`recordParticipantAction`, `recordRollAction`, `createPerson`) each throw an internal abort and translate it back. A SQLSTATE 42501 whose message is the function's one literal maps to `forbidden`; any other error rethrows. A throw from `insertAuditRow` rolls the whole act back.

### Schema, audit, env

- **Schema:** none. **Env / `FEATURES` / flags:** none. No Rule 16 shared file edited (`drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `src/lib/db/domain/index.ts`, `CLAUDE.md`).
- **Audit events** (written by `src/lib/roll.ts` with `insertAuditRow(tx, ...)` in the SAME transaction as the roll row; ids only, no names):
  - `tenant.roll_action.recorded`, resource `roll_action` = the new roll action: `organizationId, rollActionId, kind, effectiveDate, membershipEnded`. Written for an enrolment or removal, whether through `createPerson()`, `recordRollAction()` or `recordParticipantAction()`.
  - `tenant.roll_action.voided`, resource = the void row: `organizationId, voidRollActionId, voidsActionId, voidedKind, reason, membershipReopened` (the trimmed reason; `roll_actions` has no void-reason column).
  - Never `tenant.roll_action.approved` (a test scans for it). A pending proposal and a visitor write no audit row (unchanged posture). `npm run check:audit` passes **vacuously** for these (the tripwire only reads `db.*` calls in `actions.ts`, Phase 3 Measurement 14), so coverage is proven by tests: exact metadata keys, one row per `ok`, the rollback on a forced audit failure for record, removal, void and `createPerson()`, and a source scan that the keys go through `insertAuditRow`, never `recordAudit`.

### Implementer notes and deviations from Phase 3

1. **`already_here` result added to `CreatePersonResult`** (not in Phase 3's union). A membership at THIS organization is visible through the org-scoped transaction, so `createPerson()` with `identity.mode === "existing"` now checks it before the insert and returns `{ kind: "already_here" }` (message "That person is already in this community. Open their record instead."). Without it, a client that posts the confirm for someone already here still reached `memberships_guard_insert` and got the old wrong "belongs to another organization" text (F178). The cross-org case is unchanged (still the catch-based `existing_member_elsewhere`; the RLS-blind pre-check comment in the code explains why that one cannot be a SELECT).
2. **`createPersonAction` copy for `kind: "none"`** is now "A connection is required to add a new person." (was "A roll action is required to add a new member."), since Visitor is a valid connection without a roll action.
3. **Participant enrolment dates are bounded in the action; proposals are not.** A proposal may be dated ahead (the Session decides it; the daily reconcile moves the cache when the date arrives, F29). This is deliberately not symmetrical with the on-record kinds.
4. **Search in `community.ts` escapes `\`, `%` and `_`** and uses `escape '\'`. Phase 3 said "as `getDirectory()` does", but `getDirectory()` does not escape (a `%` matches everything there). The new lists treat a search term literally; a test pins it. `getDirectory()` is untouched (pre-existing behaviour, not widened here).
5. **`rollStatuses` plus `status`** intersect (Phase 3 left the combination open); an empty array matches nothing; values outside `DIRECTORY_STATUSES` are dropped before the SQL.
6. **A proposal's minute reference is trimmed** (blank becomes null) and capped at 200 in the lib as well as the action.
7. **`recordRollAction()` and `createPerson()` take the actor's `users.id` as before**; for an on-record kind the definer function additionally requires that user's own person to hold `roll.propose`, so a fixture that calls `createPerson()` with a participant kind needs `people.user_id` linked to the acting person (`people.test.ts`'s `managerPerson` now is).
8. **`src/lib/people.ts` now imports `src/lib/roll.ts`** (for `recordParticipantActionInTx`); `roll.ts` does not import `people.ts`, so there is no cycle.
9. **The Community page (`page.tsx`), the wizard, the edit page and the tile label were not touched** (Batch C). The page still calls `getDirectory()` with `status`; Batch C wires `rollStatuses`, the admin lists and the limited state from the contract above.
10. **Test-only cleanup note.** The directory test's `rollStatuses` case inserts one membership into a fixture shared with the exact-count pagination tests; it ends that membership (`ended_on`, never a delete) in a `finally`, because a derived group row references it.

### Gates run (in the `presby-fadir` worktree, against Neon branch `pipeline-founding-admin-directory`)

- `npm run typecheck`, `npm run lint` (`--max-warnings=0`): pass. `npm run check`: all eight tripwires pass (`check:audit` vacuous, see above).
- `npm run test` (unit, DB suites skipped): 497 files passed, 70 skipped, 0 failed; 7412 tests passed.
- DB-backed, serial (`npx dotenv -e .env.local -- vitest run --no-file-parallelism ...`): `roll.test.ts` 47/47, `people.test.ts` 33/33 (from 25), `community.db.test.ts` 15/15, `directory.test.ts` 99/99, `roll-derive-parity.db.test.ts` 1/1, and in one run `staff.test.ts`, the staff actions test, `src/lib/org-portal/*`, `participant-roll.db.test.ts` (42) and `children.test.ts`: 20 files, 304/304. No slow-branch timeouts this session. After the runs: no stamped organization, no fixture person, no `tenant.roll_action.recorded|voided` audit row left on the branch.
- Failing-first, by breaking the code and watching the named tests fail, then restoring (the files diff clean against the backups): (a) `createPerson()` returning a refusal instead of throwing: `people.test.ts` "a refusal by the roll function ... rolls back" and "a future date ... rolls everything back" fail (the person committed; the orphan row was cleaned by hand through the stamp path, and the sweep list now covers every rolled-back variant); (b) swallowing the `insertAuditRow` failure: `roll.test.ts` "a failed audit insert rolls back ..." fails.

### Handoff

Next: **Batch C** (`ux-developer`): the Community page (wire `parseCommunityView`, `getDirectory({ rollStatuses })`, the three lists, `getCommunityBadges`, the limited state on `forbidden` plus `people.manage`), the wizard Connection step and the already-here step (`MatchCandidate.alreadyHere`, `alreadyHereSentence`), the edit page's Connection card (`getCommunityStatus`), the Remove and Undo dialogs, the labels, and the toasts from `participant-copy.ts`. Then Batch D (e2e). The orchestrator records this section and the status row; nothing in a Rule 16 file changed.

---

## Phase 4 — Batches C and D (UI, e2e, 360px pass) — ux-developer, 2026-10-22

The Community page, its six views, the DECISION-197 degrade, the wizard's Connection step and already-here step, the edit page's Connection card with the Remove and Undo dialogs, empty states, labels, the e2e specs and a real-browser pass at 360px and 1280px. Built to Phase 3's Component / Page Plan and copy table, consuming Batch B's contract unchanged. No schema, no new audit key, no flag, no `FEATURES` entry. Committed as `feat(community): ...`.

### Files created (all under `src/app/(org)/o/[slug]/admin/community/` unless noted)

- `community-nav.tsx` (+ test) — six real links in a `ButtonGroup` (`aria-label="Community view"`), Visitors / Staff / Former only for `people.manage`, search carried across views; exports `communityHref`.
- `community-search.tsx` — the GET search form, with the view as a hidden field. `community-empty-state.tsx` — one empty state per view, search-miss told apart. `community-rows-list.tsx` — cards for Visitors, Staff, Former. `community-badge.tsx` — the six badge labels on the `ui/Badge` primitive.
- `[id]/edit/connection-card.tsx` (server), `participant-controls.tsx` (owns both dialogs so the removal toast's Undo opens the undo dialog on the new removal id), `remove-participant-dialog.tsx`, `undo-entry-dialog.tsx` (both `AlertDialog`, controlled state, trigger disabled until `useHydrated()`), `participant-controls.test.tsx`.
- `new/connection-step.tsx` (`git mv` from `roll-action-step.tsx`).
- e2e: `e2e/support/community-fixture.ts`, `e2e/community-participants.spec.ts`, `e2e/community-redirect.spec.ts`, `e2e/hydration/community-participant-dialogs.spec.ts`.

### Files modified

- `page.tsx` (six views, degrade, badges, Staff link), `members-list.tsx`, `members-states.tsx` (adds `MembersLimited`; `MembersForbidden` body untouched), `new/page.tsx` (computes `canProposeRoll`), `new/member-wizard.tsx`, `new/member-wizard-schema.ts` (a `relationship` enum plus `visit` group; the roll kind is no longer a field), `new/review-step.tsx`, `new/confirm-step.tsx`, `[id]/edit/page.tsx`, `[id]/edit/record-roll-action-form.tsx` (toasts by effect, shadowed and filed warnings, new description).
- `src/lib/org-portal/tiles.ts` (label "Community", new description), `src/lib/org-features.ts` (the toggle's display name and description; key unchanged).
- `src/lib/route-move-community.test.ts` (allowlist gains the two e2e files that must name the old path), `e2e/custom-domains/lockdown.spec.ts` (three paths added to the neutral-404 matrix).
- Tests rewritten or extended: `members-list.test.tsx`, `page.test.tsx`, `new/page.test.tsx`, `new/member-wizard.test.tsx`, `new/member-wizard-schema.test.ts`, `[id]/edit/page.test.tsx`, `[id]/edit/record-roll-action-form.test.tsx`.

### Behaviour notes

- **Degrade:** `people.manage` without `directory.view` keeps the header, Add person, the nav and the three admin views, and `MembersLimited` names `directory.view`. No `people.manage` gets `MembersForbidden`, body byte-identical (pinned by an exact-string test), also for the three admin views.
- **Add person** gates on `people.manage` only. The wizard offers only Visitor without `roll.propose`, with the Clerk-of-Session line; the server still re-checks.
- **Wizard landing:** after submit it routes to the list that now holds the person (`?view=participants`, `?view=visitors`, or Everyone for a member proposal). Not in the design; a small kindness, easy to drop.
- **Already here:** `ConfirmStep` hides "Yes, this is ..." and offers "Open their record" (a link) plus "No, this is someone new".
- **Edit page:** Remove shows for a current participant, Undo when the latest effective entry is an on-record kind (so also for a former participant, to undo the removal); both need the roll-action edit flag and `roll.propose`. The Connection card shows without the flag.
- **No native dialogs.** The remove date input defaults to browser-local today with `max` the same; the server bounds by the database date regardless.
- The `members-` file names and component names are kept (Batch M's rule). The page component is now `CommunityPage`.

### Deviations from Phase 3

1. The status `<select>` is gone from the search form (as designed), so a `?status=` URL is ignored; no link to it remains.
2. Empty-state "Former" and "Staff" use the design's strings verbatim; the Staff page link renders only for `org_portal.staff` on and `staff.manage`.
3. `CommunityBadge` uses the `ui/Badge` primitive (variants `secondary`/`outline`, amber for "waiting") because `check:brand-scope` rejects a hand-built pill outside `components/ui`.
4. The Connection card sits below the Profile card (above Record a roll action), not above Profile; the design did not fix the order.
5. The `useForm`-free dialogs mean `check:hydration-gate` does not cover them; the new hydration spec is their guard.

### Browser verification (real Chromium against `next dev`, Neon branch `pipeline-founding-admin-directory`)

Screenshots kept in the scratchpad, never committed. A scratch script seeded one participant and one visitor on the owner connection and removed them afterward.
- **360 x 740 and 1280 x 800, signed in as the clerk fixture:** Community in all six views, the edit page, both dialogs, the wizard, and the limited state (360 only). `scrollWidth - clientWidth` was 0 on every page at both widths; zero page errors and zero console errors.
- **What I saw at 360:** the nav is one row inside a rounded tray and scrolls horizontally (the third segment is clipped at the edge, "Parti..."; that is the `ButtonGroup`'s documented behaviour, but there is no scroll affordance, so a first-time phone user may not guess the other three views exist). Search stacks, cards wrap long names, Edit is a 44px target, the badge sits under the email. The remove dialog fits the viewport with every control reachable and the date picker showing today. The limited state reads correctly. The wizard's already-here screen shows full-width "Open their record" and "No, this is someone new" buttons.
- **At 1280:** the six-segment tray sits on one row; the Visitors card shows "First visit 5/3/2026" and Edit.
- Pre-hydration: Remove and Undo are disabled before hydration (hydration spec, below).

### Gates

- `npm run typecheck`, `npm run lint`, all eight `npm run check` tripwires: pass. `npm run test`: 502 files, 7603 tests passed, 0 failed after the allowlist fix. `npm run build`: pass (built in the worktree; no font flake this time).
- e2e against a real dev server (port 3111, the `playwright.config.ts` fakes in its environment): `community-participants.spec.ts` 5/5 (participant lifecycle and visitor/already-here at both widths, and the degrade), `community-redirect.spec.ts` 3/3, `hydration/community-participant-dialogs.spec.ts` green. Also green: `custom-hosts` lockdown 30/30 (with the three new neutral-404 paths), and the new hydration spec in the production-build lane (`test:e2e:prod` from a hardlinked scratch copy, 1/1).
- **Full `--project=chromium` run (dev server): 280 passed, 14 failed, 83 did not run.** None touches Community. The seven `giving-*` failures are a database-connection drop in that window (`no user row for ...` at `giving-fixture.ts:96`, a Neon `execute` error), and the 83 not-run are their serial dependents; I did not re-run the giving suite (the memory notes a Stripe test account is still missing on this branch). `header-controls.spec.ts` (six org-switcher tests, 30 s timeouts in the full run) passed 36/36 when re-run with `member-calendar.spec.ts`. **One failure persisted: `member-calendar.spec.ts:273`** (event types page: "Event type added." toast shows but the new `E2E Choir` row never appears in the list within 5 s). It is the event-types page, which this batch does not touch; I did not bisect it against main, so QA should confirm whether it fails on `origin/main` too.

### New copy strings for a fork's branding pass

"Community" (tile, heading, nav); filter names Everyone, Members, Participants, Visitors, Staff, Former; badge labels; the wizard's Connection step, option text and descriptions; the limited-state sentence; every empty state; the remove and undo dialog copy; the edit-page Connection card text. All are the Phase 3 table verbatim except the card's "Latest entry ..." and "Participant since ..." lines, which are new.

### Handoff

Next: Phase 5 (qa). Click-through: sign in as a user holding `people.manage`, `roll.propose` and `directory.view` at a congregation with `org_portal.members_create` on; open Community; add a visitor, a participant and a member; remove and undo the participant from its edit page; search for an existing name in the wizard; then remove `directory.view` and reload. Orchestrator integration unchanged: do not commit `AGENTS.md` (the dev server regenerates it).

## Remaining Phase 4 template (Batches A to D fill this in)

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

## Run 1 (2026-10-23), recorded verbatim from qa's returned text

**Date:** 2026-10-23
**Verified by:** qa
**Code under test:** `origin/main...b899ec2`: 1a40061 (route move), b0acbb9 (0061), 7370280 (server), 12bc703 (UI and e2e). Worktree `presby-fadir`, Neon branch `pipeline-founding-admin-directory`. Not auth-touching (no change under `src/auth.ts`, `src/proxy.ts`, `(auth)/`, `api/auth/` or `lib/auth/`), so the stricter auth gate doesn't apply.

## Type Check

`npm run typecheck`: PASS. `npm run lint` (`--max-warnings=0`): PASS. `npm run check`: PASS, all eight tripwires (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports). `check:audit` passes trivially for the new actions, since they write through the lib (Phase 3 Measurement 14); the audit writes are verified below by reading and by e2e.

## Unit Tests

Total: 9761 | Passed: 7603 | Failed: 0 | Skipped: 2158 (72 files, all gated on a DB URL and run below) | Duration: 25.3 s

**DB-backed suite** (`npm run test:db`, serial, pipeline branch): 575 files, 565 passed, 10 failed (14 tests plus 2 unhandled errors), 6193 s.
- **Timeouts and dropped connections (not defects).** Every failure but the leak canary below was a 20 s test or 30 s hook timeout, or a "Connection terminated unexpectedly". Each failing file was re-run on its own:
  - passed with the default timeout: `events.test.ts` 53/53, `role-definitions.test.ts` 47/47, `giving/statements.db.test.ts` 24/24, `domains/service.db.test.ts` 101/101;
  - passed with `--testTimeout=120000`: `org-features.test.ts` 29/29, `giving/two-factor-agreement.test.ts` 3/3, `giving/connection.db.test.ts` 39/39, `calendar.test.ts` 142/142;
  - `db/domain/invitations.db.test.ts`: 66/66 tests pass; only the 30 s `afterAll` at `:219` timed out, and it left nothing behind.
- **`src/lib/db/fixture-deletable.test.ts:199` and `:224`: an environmental leak, not a code defect.**
  - Two stamped `people` rows named "Waiting ForSession" were created at 21:08 UTC on 2026-10-22 by `src/lib/directory.test.ts:1767` during an interrupted Phase 4 run, hours before this verification.
  - Their deletion window has expired, so they can no longer be deleted on this pipeline branch, and the canary will stay red there until the branch is deleted.
  - That test's teardown (`:1675`) is sound, and my full run added no stamped rows.
- **This pipeline's DB files all passed in the full run:** `participant-roll.db.test.ts`, `community.db.test.ts`, `roll-derive-parity.db.test.ts`, `roll.test.ts`, `people.test.ts`, `directory.test.ts`, `designation-parity.db.test.ts`.

**Isolation suite as `presby_app`** (confirmed `rolbypassrls = f`): `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/participants/test-rls-61.sql` exits 0 with 34 passes.

**Integration patch: FAIL.** `git apply --check scripts/participants/test-rls.sql.integration.patch` fails with `patch failed: scripts/test-rls.sql:8578`.
- The last hunk (patch file line 106, `@@ -8578,3 +8604,12 @@`) expects `\ir invitations/test-rls-59.sql` to be the file's last line.
- The origin/main merge at 1e97a81, after Batch A wrote the patch, appended the 0060 block. The file now ends at `scripts/test-rls.sql:8588` with `\ir designation-revoke/test-rls-60.sql`.
- Hunks 1–7 (section 20d, the 44a counts) still apply cleanly (checked with the last hunk removed). Section 60 asserts nothing 0061 changes.
- **Not completed:** a full patched `test-rls.sql` run on this branch. A network drop killed the first attempt, and I stopped the second myself after misreading elapsed time. Batch A's pre-merge patched run stands (1120 passes, three failures that already existed). The post-merge run on `development` (Rule 16) remains the gate.

**Live-catalog probes, as `presby_app` on the pipeline branch, each rolled back:**

| Probe | What refused it |
|---|---|
| P1: insert an approved roll row of valid shape | the restrictive policy `roll_actions_insert_pending_only` (42501, named in the error), as designed |
| P2: the same row as `pending` | allowed, which confirms P1 was refused by the policy and not a CHECK or trigger |
| P3: pending `profession_of_faith` with a null `resulting_roll` | the CHECK `roll_actions_resulting_roll_matches_kind` (F173 is now a database rule) |
| P4: call `presby_participant__actor_may_propose` | no execute grant ("permission denied for function") |
| P6: record function with an unknown user id | the function's identity check: the one uniform message |
| P7: void function with no org setting | the same uniform message |
| **P5: insert pending, then UPDATE to approved** | **nothing: it succeeds** |

P5 is the documented residual. The restrictive policy covers INSERT only, and the approval UPDATE is gated only in the application, on `roll.approve`. Phase 2 R5 and DECISION-198(b) assign closing it to Increment 2. A second note: `presby_platform` holds INSERT/UPDATE/DELETE on `roll_actions` and the restrictive policy doesn't cover it, but it can't log in (`rolcanlogin = f`), so it isn't a live path.

**Fresh install** (throwaway branch with an empty database; no connection details printed):
- **Migrations:** I copied `drizzle/` to the scratchpad and added the `0061_presby_participant_roll` journal entry that integration will add. `drizzle-kit migrate` then applied all 61 migrations (0000–0061, with 0058 reserved) to the empty database. **No migration failed.**
- **Parity and seed:** `check:schema-parity` compared 85 tables with 0 failing. `npm run db:seed` succeeded, with all four DB URLs overridden in the command environment only; 39 flags and 3 roles landed on the fresh database.
- **0061 catalog confirmed:**
  - `roll.propose` and `roll.approve` (tier 1, module `roll`) are present;
  - the clerk template holds `{directory.view, roll.propose, statistics.publish}`;
  - both definer functions are `prosecdef`, with `search_path=public, pg_temp`, owned by `neondb_owner`, and executable only by `presby_app`; the actor helper has no grant;
  - FORCE RLS is on; the restrictive policy, all three CHECKs (validated) and `roll_actions_one_live_void_idx` exist.
- **Idempotence:** re-applying 0061 by hand exited 0.
- **`presby_app` role:** it already existed on that branch's cluster, inherited from the parent branch. Migration 0009 creates it `if not exists` as `nobypassrls` with no LOGIN, so a truly new cluster gets the role from the migrations, but its login and password must be set separately (as the CI composite action does).
- `ledger.approve` is still missing on a fresh install (known, out of scope).
- Without the journal entry, `db:migrate` stops at 0060; that entry is already on the integration hand-off list.

## End-to-End Tests

Run from a hardlinked scratchpad copy; Playwright started its own dev server on port 3000 with the test fakes.

**Targeted set: 58 passed, 0 failed, 9.5 min.** (The first attempt was lost to the network outage; every failure in it was a `NeonDbError: fetch failed`.)
- `e2e/community-participants.spec.ts` 9/9: the participant lifecycle, the visitor and already-here step, the member proposal, and nav plus empty states, each at desktop and at 360 px; plus the degrade at 360 px.
- `e2e/community-redirect.spec.ts` 3/3: 308 with the query intact, bare and nested paths, and a signed-in bookmark landing on the new page.
- `e2e/hydration/community-participant-dialogs.spec.ts` 1/1.
- `e2e/custom-domains/lockdown.spec.ts` 30/30 (`custom-hosts` project), including the old and new paths as the neutral 404.
- `e2e/member-calendar.spec.ts` 15/15. **`:273` (the event types page) passes on HEAD.** The implementer's persistent failure didn't reproduce on the code under test, so it was environmental; with it green on HEAD, no origin/main run was needed.

**Giving suite, re-run once: 85 passed, 2 failed, 15 did not run (serial dependents).**
- Failures: `giving-connect.spec.ts:220` (after "take offline" the give page still reads "on", line 273) and `giving-statements.spec.ts:264` (no "Notice emailed", line 272). `giving-connect:220` failed the same way again on a second HEAD run.
- **Both specs also fail on origin/main** against the same database (`giving-connect:220` at line 247, `giving-statements` at line 184), so this is environmental and was there before this diff.
- Giving's only dependency on this diff is `@/lib/audit`, which gained two keys and changed nothing else.
- The implementer's seven connection-drop failures did not recur as such.

## Regression Tests Added

The original bug (a founding administrator without `directory.view` reaching Add person, the degrade state):
- `should keep the header, Add person and the nav, and name the missing permission` (`it("keeps the header, Add person and the nav, and names the missing permission")`): `src/app/(org)/o/[slug]/admin/community/page.test.tsx:244`.
- `without directory.view the page keeps Add person and Visitors and names the missing permission`: `e2e/community-participants.spec.ts:280` (real browser, 360 px, passed).
- **Would they have failed before the fix?** Not observed by running: Batch C recorded no failing-first run for these two. Confirmed by reading instead: origin/main's `admin/members/page.tsx` returns `MembersForbidden` whenever `getDirectory()` is forbidden (no Add person, generic copy), and both tests assert the opposite.
- **Naming:** neither carries the `— regression for …` suffix (only the describe names F172).

Other regressions, each with a test:

| Finding | Test |
|---|---|
| F173 | `src/lib/people.test.ts:648` (pinned with a comment), `:1333`; `participant-roll.db.test.ts:526` |
| F178 | `src/lib/people.test.ts:1406`; `community/new/actions.test.ts:189` |
| F174 | `participant-roll.db.test.ts:457` |
| R5 | `participant-roll.db.test.ts:429`, and test-rls-61 section 61b |

Batch A recorded failing-first proofs for R5, the actor permission check, the org-from-GUC rule, the void `person_id` and the date bounds. Batch B recorded them for the `createPerson()` rollback and the audit-insert rollback.

## Coverage on Critical Modules

| Module | Statements |
|---|---|
| `src/lib/permissions.ts` | 100% |
| `src/lib/flags.ts` | 100% |
| `src/lib/two-factor.ts` | 91.3% (lines 35–39) |
| New pure modules (`roll-action-kinds.ts`, `ymd.ts`, `is-uuid.ts`) | 100% |
| `community-labels.ts` | 100% statements, 96.6% branches |

All targets met.

## Feature-Gate Audit

No `src/app/api/**/route.ts` was added or changed. These are `(org)` tenant actions, so the gate is a tenant permission (`presby_has_permission` inside the lib's `withOrgContext` transaction), not `hasFeature(FEATURES.*)`. `organizationId` comes from `resolveOrgContext()`, never from the client.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `createPersonAction` (`community/new/actions.ts:168`) | yes (via `resolveActingIdentity`, `:67`) | n/a (tenant) | `people.manage` always; plus `roll.propose` for participant or member (`people.ts:440-450`); the definer function re-checks |
| `matchPersonAction` (`new/actions.ts:86`) | yes | n/a | `people.manage` (`people.ts:117`) |
| `recordRollActionAction` (`[id]/edit/actions.ts:89`) | yes | n/a | `roll.propose` (`roll.ts:764`); a participant enrolment goes through the definer function |
| `removeParticipantAction` (`[id]/edit/actions.ts:174`) | yes | n/a | `roll.propose` (`roll.ts:466`) and the function's actor check; the kind is fixed in the action |
| `undoParticipantEntryAction` (`[id]/edit/actions.ts:242`) | yes | n/a | `roll.propose` (`roll.ts:590`) and the function's actor check |
| `updatePersonAction` (moved, unchanged) | yes | n/a | `people.manage` (`people.ts:783`) |
| Page `community/page.tsx` | yes | n/a | flag plus toggle (`:116-126`); `people.manage` for Add person and the admin views; `directory.view` through `getDirectory()`; degrade at `:186-192` |
| Page `community/new/page.tsx` | yes | n/a | flag plus toggle; `canProposeRoll = roll.propose` (`:86`) |
| Page `community/[id]/edit/page.tsx` | yes | n/a | flag plus toggle; Remove and Undo only with `org_portal.members_roll_action_edit` and `roll.propose` (`:152`) |
| `community.ts` readers | n/a (lib) | n/a | `people.manage` on every export |

- **Audit:** `tenant.roll_action.recorded` (`roll.ts:510`) and `tenant.roll_action.voided` (`roll.ts:653`) are written with `insertAuditRow()` in the same transaction, never `tenant.roll_action.approved`. The persisted rows are asserted in e2e (`community-participants.spec.ts:116`, `:175`).
- **Flags:** honored at page level only; none of the actions checks `org_portal.members_create` or `members_roll_action_edit`. That matches origin/main and nearly every other `(org)` actions file (only `filings` differs). A flag never grants access, and every action is permission-gated.
- **Native dialogs:** none. The two `confirm()` hits are local handler names inside `AlertDialog` components.
- **`console.log`:** none in production paths.
- **Deletes:** none in production paths or in 0061 (a source-scan test pins the latter). Removal sets `ended_on`/`ended_reason`, and a void is a new row. The deletes in the diff are all fixture teardown in tests (the fixture exemption).

## Verdict

**FAIL.** One required check went red. It's a staged integration file, not product behavior:

1. **`scripts/participants/test-rls.sql.integration.patch:106`**: the final hunk no longer applies. `scripts/test-rls.sql` now ends at `:8588` with the section-60 `\ir` line merged from origin/main. Regenerate the patch against the current file so the section-61 banner and `\ir participants/test-rls-61.sql` come after section 60, then confirm `git apply --check` is clean. Hunks 1–7 need no change.

To fold into the same pass (not blocking on their own):

2. Add the `— regression for …` suffix to `page.test.tsx:244` and `e2e/community-participants.spec.ts:280`, for example "— regression for founding administrator cannot reach Add person (F172)".

Everything else passed:
- typecheck, lint, all eight tripwires and the unit suite;
- the DB suite: every failure was a timeout, a dropped connection, or the leak that predates my session, and each file passed on re-run;
- test-rls-61 as `presby_app`, the live probes, and the fresh install from empty;
- the targeted e2e (58/58) at desktop and 360 px;
- the feature-gate audit, the audit keys, soft deletes, and no dialogs or `console.log`.

The giving failures and `member-calendar.spec.ts:273` are not regressions from this diff.

**Pipeline-branch side effects, for the orchestrator** (the branch is throwaway):
- The two expired "Waiting ForSession" rows keep `fixture-deletable.test.ts` red there.
- My first e2e attempt died before its `afterAll`, so the prior flag state was lost. `org_portal.members_create`, `org_portal.members_roll_action_edit` and the e2e-alpha toggle are now on, and the `e2e_community_clerk` grant remains. Spec people were swept to 0.
- I terminated one `presby_app` session left idle in a transaction by my own interrupted test-rls run; it was a read-only assertion block.
- The fresh-install branch holds a migrated and seeded database and is left for you to delete.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (Increment 1) | FAIL: the integration patch's last hunk no longer applies after the origin/main merge; all code checks green | 2026-10-23 |

## Handoff

The next agent is **database-admin** (Batch A owner), to regenerate `scripts/participants/test-rls.sql.integration.patch` against the current `scripts/test-rls.sql`. Item 2 goes to whichever implementer owns those two test files (ux-developer). Re-verification is cheap: `git apply --check` on the patch plus a check of the renamed tests; nothing else needs to run again. No escalation to tech-lead: nothing here points to a design flaw.

Files referenced:
- /Users/cshenso/git/presby-platform/presby-fadir/scripts/participants/test-rls.sql.integration.patch
- /Users/cshenso/git/presby-platform/presby-fadir/scripts/test-rls.sql
- /Users/cshenso/git/presby-platform/presby-fadir/src/app/(org)/o/[slug]/admin/community/page.test.tsx
- /Users/cshenso/git/presby-platform/presby-fadir/e2e/community-participants.spec.ts
- /Users/cshenso/git/presby-platform/presby-fadir/src/lib/directory.test.ts

## Fix after run 1 (orchestrator, 2026-10-23)

- `scripts/participants/test-rls.sql.integration.patch` regenerated against the current `scripts/test-rls.sql` (hunks 1–7 unchanged; the section-61 banner and `\ir` now follow section 60). `git apply --check` is clean.
- The `— regression for founding administrator cannot reach Add person (F172)` suffix was added to `page.test.tsx:244` and `e2e/community-participants.spec.ts:280`. `page.test.tsx`: 32/32 pass.

---

## Run 2 (2026-10-23), recorded verbatim from qa's returned text

**Date:** 2026-10-23 · **HEAD:** 881d444 (`presby-fadir`) · **Verified by:** qa

**Scope check:** `git diff b899ec2 881d444 --stat` shows the work-log plus exactly three files: the integration patch, `page.test.tsx` and `e2e/community-participants.spec.ts`. No product code changed, so none of run 1's other results needed re-running.

### Item 1: the integration patch (blocking in run 1). Resolved.
- `git apply --check scripts/participants/test-rls.sql.integration.patch`: applies cleanly (45 insertions, 10 deletions).
- **The diff:**
  - The last hunk is now `@@ -8586,3 +8612,12 @@`, anchored on `\ir designation-revoke/test-rls-60.sql`. Its banner reads "as 46, 47, 59 and 60 above".
  - The 7873 hunk was regenerated with different context lines: the `roll.approve` = 0 assertion is the same, only placed differently within the hunk.
- **Equivalence check:** in scratch copies I applied run 1's hunks 1–7 plus a section-61 append after the 60 line, and separately the regenerated patch. The two resulting files are **byte-identical**. After patching, the file still includes section 60, and section 61 comes after it. Nothing was applied in the worktree.

### Item 2: the regression-test names. Resolved.
- `src/app/(org)/o/[slug]/admin/community/page.test.tsx:244` and `e2e/community-participants.spec.ts:280` now end in "— regression for founding administrator cannot reach Add person (F172)".
- `page.test.tsx` passes, 32/32.
- I didn't re-run the e2e because only its title changed. `playwright test --list` shows the new title at `:280:9`, and run 1 passed that test in a real browser.
- Unchanged from run 1: the failing-before-fix property was confirmed by reading origin/main's page, not by running the tests against the old code.

### Verdict

**PASS.** Both run-1 items are resolved, and everything run 1 verified still holds because no product code changed.

Notes the next phases should carry, unchanged from run 1:
- **Increment 2:** `presby_app` can still insert a pending row and UPDATE it to approved (R5 covers INSERT only).
- **Integration:**
  - add the `_journal.json` entry for 0061;
  - apply the patch;
  - re-run `scripts/test-rls.sql` as `presby_app` on merged `development`. That run is still the only full patched run since the origin/main merge: my run-1 attempt didn't finish.
- **Pipeline branch** (throwaway):
  - two expired fixture rows keep `fixture-deletable.test.ts` red there;
  - the members flags and the e2e-alpha toggle were left on;
  - the fresh-install branch is still there for the orchestrator to delete.

The worktree is clean and the scratch copies are removed.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (Increment 1, run 2) | PASS | 2026-10-23 |

**Handoff:** next is **analyst** (Phase 6, shipped vs intent).

---

# Phase 6 — Shipped vs Intent (analyst)

*Increment 1. Recorded verbatim by the orchestrator from the analyst's returned text.*

I read the Phase 1 revised return, the operator rulings, Phases 2 and 3, Phase 4 Batches M, A, B and C+D, and QA runs 1 and 2. I also read the shipped code: the Community page, nav, wizard, edit page, copy table, and the 0061 header and comments. I did not re-run any suite; I rely on QA's PASS (run 2, HEAD 881d444, no product code changed since run 1).

## VERDICT

**SHIP WITH NOTES.**

Every operator ruling and every Phase 1 verb is delivered. The four known items are ruled below, and none of them blocks. The notes fall into three groups:
- conditions on the release copy, which has not been written yet;
- one overclaiming sentence in `docs/schema-design.md`;
- tracked follow-ups.

## ONE-LINE TAKE

> A founding administrator or clerk can now open Community, add a visitor or participant on record and undo it, and propose a member. The member half cannot complete until Increment 2 gives someone `roll.approve`, so the release must say so.

## What's Working

- **The original bug is fixed at the user's level.** A `people.manage` holder without `directory.view` keeps the header, Add person, the nav and the Visitors, Staff and Former views. The limited state names the missing permission. Without `people.manage`, the forbidden body is unchanged and byte-identical.
  - Covered by `page.test.tsx:244` and the 360px e2e at `community-participants.spec.ts:280`.
  - 0061 also puts `directory.view` and `roll.propose` on the clerk template, so a designated administrator gains both through the office role.
- **Participants are on record.** Enrol and remove are function-mediated (`presby_record_participant_action`) and need no approval.
  - The kind alone decides, so a forged membership kind stays pending.
  - Dates are bounded, and filed returns are warned about but never changed.
  - Audit rows are written in the same transaction under `tenant.roll_action.recorded` and `.voided`, never `.approved`.
- **Undo is a void.** The void is a new row. Only the latest on-record entry can be undone. Voiding a removal reopens the membership only on the removal's own marker. A reason is required and goes into the audit row.
- **All deletes are soft.** Removal sets `ended_on` and `ended_reason`, and a void is a new row. A source scan pins that 0061 contains no delete. Test teardown is the only delete, which is the fixture exemption.
- **The visitor path exists.** The wizard offers Visitor with `people.manage` alone. Visitors are admin-only and never in the Directory. A source scan and a DB test pin that.
- **The match step now says "already here".** Duplicates are redirected to the person's record. This closes F178.
- **Reachability.**

  | Path | How the user gets there | Status |
  |---|---|---|
  | visitor → participant | Edit page, "Record a roll action", `other_participant_enrolled` | Takes effect now |
  | visitor → member | Edit page, a gain kind | Proposal only |
  | participant → member | Edit page, a gain kind; the Connection card says no removal is needed | Proposal only |

  The two member paths are proposals and complete only when Increment 2 ships approval.
- **Rename and move.** The section is "Community", with filters Everyone, Members, Participants, Visitors, Staff and Former.
  - `/admin/members/:path*` is a permanent (308) redirect to `/admin/community`.
  - The redirect is scoped to platform hosts (F151).
  - Query and sub-paths are preserved and a custom host still gets a neutral 404. All of this is browser- and e2e-verified.
  - The route move is its own mechanical batch and commit, as the operator asked, so the security diff stayed reviewable.
- **The Staff page stays.** It is unchanged apart from handling the two new `createPerson()` result variants. Community's Staff filter comes from open positions, as ruled, and the Directory exclusion stands (DECISION-129).

## Intent-vs-Shipped Diff

- **Participants on record with no approval.**
  - Phase 1 said: effective at record, with `roll.propose` checked in the same transaction.
  - Shipped: matches, and is stronger than Phase 1. A restrictive insert policy makes the function the only way to insert an approved row.
  - Verdict: matches.
- **Undo for a mistaken entry (F175).** Shipped as a void with a required reason. Verdict: matches.
- **Removal (the operator's Q2 "yes, include now").** Shipped: removal ends the membership, with `holds_position`, `self_target`, `pending_action` and `not_participant` refusals. Verdict: matches the Phase 2 rulings.
- **F173 (`createPerson()` wrote null roll fields).** Fixed in TypeScript, repaired in 0061, and enforced by a CHECK. Verdict: matches.
- **Founding administrator without `directory.view` reaches Add person.** Delivered. Add person gates on `people.manage` alone. Verdict: matches.
- **Phase 1's "fail before the wizard starts, not at the end."**
  - Phase 2 R10 replaced the Phase 1 point-to-Staff fallback with a button-level gate.
  - The `/new` page itself has no `people.manage` check, so a deep link walks the wizard and fails at the last step ("You don't have permission to add members here.").
  - Verdict: acceptable drift, filed as follow-up 7.
- **Phase 1 said: member proposals queue for the Session, and "the copy says so".**
  - Shipped: the copy says "needs Session approval", "Waiting for the Session to approve" and "once the Session approves".
  - It never says that approval is not yet possible, or that the proposer cannot see the queue, since `/pending` needs `roll.approve`.
  - Verdict: partial. It is honest as far as it goes, but a user would read it as approval being possible. The release copy must carry the gap (condition A).
- **Phase 1's "SASR participant count and gain/loss lines".** Participants raise the count and Total Adherents with no gain or loss line, as designed. Verdict: matches.

## Rulings on the four known items

1. **360px nav clipping: acceptable drift, filed as follow-up 1.**
   - Nothing overflows the page. Every view is reachable by swiping, and it is the shared `ButtonGroup` working as documented.
   - It is still weak for the people this increment is for:
     - Visitors, Staff and Former are the 4th to 6th segments, entirely off-screen at 360px.
     - After adding a visitor, the wizard lands on `?view=visitors`, so the active pill is off-screen.
     - The clipped third tab, "Parti…", is the only hint that anything follows.
   - Do not hold the ship for it. Fix by scrolling the active segment into view and adding an edge fade.
   - Consider the same for the Directory's own nav, which shares the component.
2. **F183, the stranded proposal: accept as a known residual, ship with a note, under two conditions.**
   - What happens: a Member proposal that nobody can approve or withdraw also blocks enrol and remove for that person, because of `pending_action`. The operator is the only production user and knows this.
   - Condition A: the release notes must say so plainly, in the same release as the Member option.
   - Condition B: Increment 2 (withdrawal, `roll.approve` home, queue visibility) is the next pipeline, not a someday item.
   - Filed as follow-up 2. If Increment 2 slips beyond the first real congregation's data entry, add one line under the wizard's Member option ("No one can approve yet.").
3. **P5, `presby_app` can insert pending and UPDATE it to approved: accept as a documented residual.**
   - It is recorded in R5, DECISION-198(b), the 0061 header and the policy comment. Increment 2's lockdown (the `UPDATE` clause, designed as 0063) closes it.
   - Its practical exposure is low, because nobody holds `roll.approve` and it needs an application bug to exploit.
   - The "database property" claim is true only of the insert half. See condition C and follow-up 3.
4. **Post-submit landing: acceptable drift, keep it.**
   - After submit it routes to `?view=participants`, `?view=visitors`, or Everyone for a member proposal. It sends the user to the list that now holds the new person.
   - One persona gap: a degraded user without `directory.view` who adds a participant or member lands on the limited state and cannot see who they just added. Landing on the person's own edit page would serve them better.
   - Filed as follow-up 5, low. In practice the clerk-template grant makes this rare.

## Reading the release-facing copy against the accepted residuals

The release notes, functionality-map line and what's-new entry are not drafted yet. I read everything that exists: in-app copy, the tile and toggle descriptions, the 0061 comments, `docs/schema-design.md` and the drafted decisions. That is the 0.25.2/F170 check.

- **Denies a residual (fix): `docs/schema-design.md`, "Participants on record".**
  - The first paragraph says "0061 makes it a database property". The sentence before it calls the old state "any `presby_app` path could" insert approved.
  - That is true only of the insert path. Pending-then-UPDATE to approved is still open, and the admission comes two bullets later.
  - Reword the opening to say 0061 closes the approved-at-insert half and that the approval `UPDATE` remains application-gated until Increment 2. This one wording fix is a condition (C).
- **In-app copy that is accurate but absolute.**
  - The remove dialog says "You can undo it afterward." Undo can refuse with `membership_changed`, `not_latest_action` or `provisioning_incomplete`. Prefer "You can usually undo it afterward."
  - The limited state says "Visitors and Staff above still work" and omits Former. Cosmetic.
- **Guardrails for the release notes (condition A).** They must not say or imply:
  - that Members can be approved yet, or that the Session approval queue is visible to the clerk (it is not);
  - that "everything is undoable" or "nothing is ever deleted". Undo covers participant entries only, and F176's hard-delete paths remain;
  - that approval, or participant audit, is database-enforced. Audit is written in TypeScript, so a direct SQL caller skips it, as DECISION-198(g) admits;
  - that visitors are fully walled off from member access. Visitors are never in the Directory, but they are in the `active_membership` derived group (F177), so a visitor who ever had a linked account would receive the baseline member grant. Today only invitation acceptance links an account, so nothing is exposed, but 2b makes that reachable and must close it first.
  - They should state: the code deploys first and 0061 is applied after; Community replaces Members; the old URL redirects; and the filed return is never altered.

## Edge Cases

- **Empty state: pass, with one note.**
  - Each of the six views has its own wording, and a search miss is told apart from a view that is genuinely empty.
  - "Everyone" excludes visitors and staff, because it is the Directory-backed list. After adding only a visitor, Everyone reads "No one yet. Add your first person to get started." That contradicts what the user just did. See follow-up 4.
- **Failure microcopy: pass.**
  - Every typed outcome has one human sentence, and the table is type-exhaustive.
  - A database failure shows "We couldn't load this right now."
  - The wizard's forbidden toast still says "add members", though it now also adds visitors. See follow-up 7.
- **Permission gate: pass.**
  - A caller without `people.manage` gets the unchanged forbidden body, and admin views are refused server-side.
  - Remove and Undo need the roll-action-edit flag plus `roll.propose`, and the definer function re-checks the actor.
  - `organizationId` comes from the resolved context, never from the client.
- **Audit event: pass.**
  - One row per on-record act, in the same transaction, with ids only.
  - A forced audit failure rolls back the whole act, and e2e asserts the persisted rows.
  - The two keys are pinned as distinct from `.approved`.
- **Mobile (360px): pass with the nav note.**
  - Zero horizontal overflow on every page and both dialogs.
  - 44px targets, and the pre-hydration controls are disabled (hydration spec).
  - The exception is the nav affordance in follow-up 1.
- **Adversarial pass: pass.**
  - Forged kinds stay pending, `kind: "none"` is refused, and malformed ids are "not found".
  - The target-is-actor check and cross-organization derivation are covered.
  - No redirect target is user-controlled; the redirect is a fixed same-origin rewrite.

## Follow-Ups

Each goes to `docs/TODO.md` in the integration commit (Rule 10).

1. **Community nav at 360px.**
   - Scroll the active segment into view and add a scroll affordance such as an edge fade.
   - Apply the same fix to the Directory nav, which shares `ButtonGroup`.
   - Do it before Increment 3 adds more segments.
2. **F183 and Increment 2.** The next pipeline, specifically:
   - withdrawal of a mistaken proposal;
   - the Session role carrying `roll.approve`;
   - queue visibility for `roll.propose` holders;
   - the F185 "Member only where a Session exists" rule.

   If it slips, add the one-line "No one can approve yet" to the wizard and the Connection card.
3. **Wording fixes.**
   - `docs/schema-design.md` opening paragraph, so it does not overclaim (condition C).
   - The remove dialog: "usually undo".
   - The `MembersLimited` line that omits Former.
   - Both are one-line copy changes.
4. **"Everyone" vs. visitors and staff.**
   - Either relabel it, or change the Everyone empty state and add a hint such as "Visitors and staff are listed separately."
   - This is the same family as the already-filed S6 relabel of the Directory's "Members" tab, so decide both labels together.
5. **Landing for a user without `directory.view`.** Route to the new person's edit page instead of a limited-state list.
6. **P5 and the Increment 2 lockdown.**
   - The approval `UPDATE` is still application-gated until Increment 2's lockdown migration, designed as 0063.
   - Track it explicitly so the restrictive policy is not mistaken for the whole control.
   - The F177 closure (the `active_membership` group admits visitors and staff anchors) belongs to 2b and must land before any sign-in invite to a visitor.
7. **Wizard deep-link gate and copy.**
   - `/community/new` renders the wizard for anyone in the org with the flag on, and the failure comes at the last step.
   - Gate the page on `people.manage`, per Phase 1 gap 7.
   - Change `CREATE_COPY.forbidden` to "add people".
8. **Integration chores (orchestrator).** These are already in the Phase 3 hand-off list; they must happen in the integration commit:
   - the `_journal.json` entry for 0061;
   - `git apply scripts/participants/test-rls.sql.integration.patch`, then a full `scripts/test-rls.sql` run as `presby_app` on merged `development`. That is the only full patched run still outstanding;
   - the TODO lines from Phase 3, including closing F173, rewriting the F111/F118 line, and the Increment 2 and 3 pointers;
   - the Rule 14 functionality-map line: Members becomes Community, including the old toggle name "Add & approve members" and the roughly three `admin/members` mentions;
   - decisions DECISION-197 to DECISION-201 and findings F172 to F178;
   - release notes v0.39.0 under conditions A and B.

## Workflow Rule 12 and 13

- **Rule 12:** the Source is an operator report, not an in-app feedback row, so there is no row to mark `done`.
- **Rule 13:** Community is admin-only tooling, so a what's-new entry is not required. Skip it, or write at most one line for administrators after Increment 2 lands.
- **Rule 15:** nothing architectural changed, so `docs/architecture.md` stays as is.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent (Increment 1) | analyst | Complete; follow-ups 1–8 to `docs/TODO.md` at integration; release-note conditions A and B and wording fix C required | SHIP WITH NOTES | 2026-10-23 |

## Handoff

Next is the **orchestrator**, then the operator. Order of work:
1. Apply the schema-design wording fix (C).
2. Write the release notes under conditions A and B.
3. Run the integration list (follow-up 8).
4. Reconcile the TODO.

The pipeline closes at integration. Increment 2 is the next pipeline; its Phase 4 starts only after Increment 1 merges. Increment 2 closes F183, P5 and F185. Increment 2b closes F177 and completes the visitor and participant sign-in path.

Files referenced, all under `/Users/cshenso/git/presby-platform/presby-fadir`:
- `docs/work-log/2026-10-22-founding-admin-directory.md`
- `docs/schema-design.md` (section "Participants on record")
- `drizzle/0061_presby_participant_roll.sql`
- `next.config.ts`
- `src/app/(org)/o/[slug]/admin/community/page.tsx`
- `src/app/(org)/o/[slug]/admin/community/community-nav.tsx`
- `src/app/(org)/o/[slug]/admin/community/community-empty-state.tsx`
- `src/app/(org)/o/[slug]/admin/community/participant-copy.ts`
- `src/app/(org)/o/[slug]/admin/community/new/connection-step.tsx`
- `src/app/(org)/o/[slug]/admin/community/new/page.tsx`
- `src/app/(org)/o/[slug]/admin/community/[id]/edit/connection-card.tsx`
- `src/components/shared/button-group.tsx`

---

## Integration (orchestrator, 2026-10-23)

- Commits `59e3845` (integration docs, journal entry 61, the applied test-rls patch) and `8289e6e` (0.39.0 release notes and version).
- Pre-push on `8289e6e`:
  - typecheck, lint, all eight tripwires and the unit suite (7603 passed) pass;
  - `npm run build` passes;
  - `npm audit` shows 3 high and 9 moderate advisories, all in dev or test tooling (WARN; TODO line added).
- Full patched `scripts/test-rls.sql` as `presby_app` on the pipeline branch halts at line 217 ("presbytery: sees only its own members", expected 2, got 3). That is the same documented fixture-count drift that halts it on `development`, so it is not caused by this diff. `scripts/participants/test-rls-61.sql` passes on its own (QA run 1, 34 passes). The Rule 16 post-merge run on `development` is still owed after 0061 is applied there.
- **Deploy order:** code first, then 0061 on production after a snapshot.

---

# Increment 2 — Session approval, pending queue, elder sign-in invites

> **Pre-assigned numbers (Rule 16):** DECISION-202–205 · F179–F185 · migration 0062 (provisional; re-checked at kickoff of Phase 4 against main).
> **Status:** Phase 1 complete (READY WITH NOTES, operator rulings recorded below); Phase 2 in progress. Increment 1 Phases 5–6 run in parallel; Increment 2 Phase 4 does not start until Increment 1 merges.

*Recorded verbatim by the orchestrator from the analyst's returned text (the analyst is read-only).*



I read the whole work-log, then the code in the `presby-fadir` working tree. That tree includes Batch B's uncommitted changes to `roll.ts`, `roll-action-kinds.ts` and `people.ts`. Increment 2 touches the same files, so see the sequencing note under Handoff. I read `decideRollAction()`, `listPendingRollActions()`, the pending page and actions, `startOfficerTerm()`, `org-provisioning.ts`'s baseline seed, `presby_sync_derived_group`, `presby_sync_current_roll`, the `memberships_guard_insert` trigger, `follow_ups`, and the dev seed's `session_member` fixture. I ran no database queries and wrote nothing.

### VERDICT

**READY WITH NOTES.** Phase 2 is mandatory. It must rule on the five architect items below, and the operator must answer the ten open questions, three of which change scope.

### ONE-LINE TAKE

> A congregation needs a Session that can actually approve what the clerk proposes. That means a baseline role, a queue everyone involved can see, and an approval that is checked in the database. Today the Session can't be reached, the queue has no link anywhere, and approving a proposal can double-count a member in the filed statistics.

### The central finding: the Session role is real, but there may be nobody who can use it

Three facts from the code and the TODO line up.

1. **The Session roster does not require a login.** `startOfficerTerm()` requires only a live membership, and the roster trigger fills the derived Session group from `ruling_elder` terms. So `officers.manage` can fill the Session with people who have no account.
2. **No path links a user to a person except platform invitations.** "Invitations Increment 2" (org-level invite to sign in) is unbuilt, and `docs/TODO.md:238` says so. A person recorded as an elder cannot sign in, so they cannot approve.
3. **The only person with `officers.manage` and a login at a new congregation is the founding administrator.** They also carry the clerk office, so they hold `roll.propose`. If they record themselves as a ruling elder, they become a Session approver. One platform-designated person would then hold both `roll.propose` and `roll.approve`, which is exactly what DECISION-155 and F118 refused to hand out in a bundle.

This is not a blocker, but Phase 2 and the operator must rule on it knowingly. It also means the empty-Session state has three distinct cases, not one (see Flow 7).

### Pass 1 — User verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin, clerk (`roll.propose`) | See every pending proposal at the congregation, read-only | on demand, daily at set-up |
| Admin, clerk | See what happened to a proposal (approved, denied, withdrawn) and why | after each Session meeting |
| Admin, clerk | Withdraw a proposal made in error | on demand |
| Admin, Session member (`roll.approve`) | Open the queue from Community or the admin hub | per Session meeting |
| Admin, Session member | Approve one proposal, or select several and approve with one minute reference | per Session meeting |
| Admin, Session member | Deny a proposal with a reason | per Session meeting |
| Admin, founding administrator (`officers.manage`) | Record elders, see whether the Session can act yet | one-time at set-up |
| Admin (`people.manage`) | See "waiting for the Session" on a person and on the Community list | on demand |
| Platform | Provisioning seeds the role. A migration backfills existing congregations | one-time |

No anonymous or no-role surface is touched. Every surface above is under `/o/<slug>/admin/community`.

### Pass 2 — Flows

**Flow 1, queue visibility for a proposer.**
Entry points are a "N waiting" link in the Community header and the pending page itself.
- **What exists today:** nothing links to `/admin/community/pending`. A repo-wide search finds no link, only `revalidatePath` calls.
- **What exists for proposers:** a per-person amber notice on the edit page (`getPendingRollActionsForPerson`). There is no organization-wide view.
- **New read gate:** `roll.approve` or `roll.propose`. A proposer gets a read-only list with no Approve or Deny buttons.
- **Decided history:** a "Recently decided" section, approved or denied, newest first, with the reason on a denial. Today a denied proposal vanishes from every screen.
- Failure: a database error shows the existing load-error state. A viewer with neither key gets the existing forbidden body, unchanged.

**Flow 2, approve (single and bulk).**
Entry is the pending page. The viewer picks "Approve", optionally enters a minute reference, and submits.
- **Single approval:** one row, one confirmation.
- **Bulk approval:** select rows, one minute reference, "Approve N". Each row is decided and audited individually in one request.
- **Success:** the row moves to Recently decided, and the person appears under Members. A warning appears if the effective date falls in a filed year.
- Failure: one typed refusal per row, in plain language (copy table below). A bulk run reports "N approved, M need attention" and lists the M with reasons. It never half-commits silently.

**Flow 3, deny.**
The reason is required, trimmed, and capped at 500 characters server-side. The row becomes `denied`, with the actor and date recorded on the row.
- Failure: the same refusals as approval (`already_decided`, `not_found`).

**Flow 4, withdraw a mistaken proposal.**
Entry is the queue row (proposer view) or the person's edit page. The clerk picks "Withdraw proposal" and gives a reason.
- Under the soft-delete ruling the row is never deleted.
- The proposer can withdraw. The person is released from the `pending_action` block that Increment 1 added.
- Failure: if the Session decided it first, the user sees "already decided". Withdrawing is allowed for the proposer or any `roll.propose` holder (Open Question 3).

**Flow 5, visitor to member.**
- The clerk adds a visitor, or opens an existing one.
- The clerk records "Received as a member" (profession of faith or another gain), which creates a pending row.
- The person shows "Waiting for the Session" under Everyone. They stay under Visitors until approval, because lists derive from the roll first.
- Approval sets `current_roll`, so the person moves to Members and leaves Visitors with no engagement write.
- Failure: a refusal (ended membership, deceased, already on that roll) leaves the row pending for the Session to deny.

**Flow 6, participant to member.**
This is the same as Flow 5 on the same membership row.
- Replay supersedes the participant roll with the active roll.
- The participant count drops, the gain is counted, and the 17/18 age split uses the `age_at_action` derived at proposal time.
- The person's Connection card changes from "Participant" to "Member", and the Remove-as-participant control disappears.
- A person who is a participant and has a pending member proposal cannot be removed (`pending_action`, Increment 1). That is correct, but see F183.

**Flow 7, the Session cannot act yet.** There are four distinct states, and the copy must tell them apart.

| State | What the queue shows | Who sees the link |
|---|---|---|
| (a) No Session body to approve (non-congregation org, or no Session group seeded) | "This organization has no Session to approve roll actions." No Member option offered | everyone |
| (b) Session roster empty | "Your Session roster is empty, so member proposals wait. Record your ruling elders under Officers." | link for `officers.manage` holders. Others: "Ask an administrator to record your elders." |
| (c) Elders recorded, none can sign in (or none has a term in effect today) | "N elders are recorded, but none has signed in to PresbyPortal yet, so no one can approve." Plus "term begins {date}" when future-dated | a pointer to invitations if org-level invites exist, otherwise a support ticket |
| (d) At least one approver exists | normal | n/a |

The counts come from the Session group's live rows today and whether each has a linked user. They are admin-only data at the viewer's own organization.

**Flow 8, provisioning and backfill.**
- A new congregation gets a `session_member` role (`roll.approve` only), bound to its derived Session group.
- Backfill for existing congregations:
  - It skips an organization that already has an org-owned role under that key, because the dev fixture already has one.
  - It touches only organizations that have a Session derived group.
  - It uses the role key as the discriminator, never a reason text (the purge lesson).

### Pass 3 — Permissions and flags

- **Permission keys:** no new key and no new `FEATURES.*`. `roll.approve` already exists, and 0061 seeds it into the catalog.
- **Read gate widens** to `roll.approve` or `roll.propose`.
- **Withdraw** gates on `roll.propose`.
- **Default roles:**
  - `session_member` holds `roll.approve` only. The dev fixture's role also carries `directory.view`, which is redundant, because every live membership already gets `directory.view` through the baseline `member` role.
  - No role carries both `roll.propose` and `roll.approve` as a bundle. A clerk who is also an elder holds both through two roles, as in real life. The wildcard invariant holds.
  - The founding-administrator bundle is unchanged.
- **Flags:** none new. This follows the operator's rule against new platform flags before go-live. The existing `org_portal.members_create` flag and toggle still gate the page.
- **A naming snag to record:** a congregation that turns the "create" toggle off also blocks its Session from the approval queue.
- **Rollback:** the role and its grant are data and can be ended with `ends_on`. The functions and policy are droppable.

### Pass 4 — Edge cases the request didn't mention

- **2FA gate.** `/o/*` already enforces it in the proxy. An approver who is 2FA-required but not enrolled is pushed to `/totp`. The org setting `require_two_factor` defaults to false, so a Session can approve the roll without 2FA at most congregations. Say so in the decision. Do not change it here.
- **Audit.** Approve and deny are security-sensitive. The current code writes their audit rows after commit through `recordAudit()`, which opens its own connection and swallows failures (F180). Increment 1 fixed this class for on-record acts with `insertAuditRow()` in the same transaction.
  - New key for withdrawal: `tenant.roll_action.withdrawn`.
  - Approve metadata should add `selfApproved`, `minuteReference` and `affectsFiledPeriod`.
  - A denied row records no actor today. Only `audit_events` knows who denied it.
- **Empty state, brand-new install.** The queue empty state must differ by viewer and by Flow 7 state. Today it reads "Nothing waiting for your approval. Roll actions proposed by admins will show up here." For a proposer with nothing pending, say "Nothing is waiting. Member proposals you make appear here until the Session decides them."
- **Failure microcopy.** Every approval refusal needs a human string. The proposed table follows.
- **Mobile at 360px.**
  - Bulk-select checkboxes need 44px targets.
  - The approve and deny dialogs must fit the viewport.
  - The sticky "Approve N" bar must not cover the last row.
  - Run the browser check Increment 1 specified.
- **Deploy ordering is the reverse of Increment 1.**
  - Moving approval into a function and tightening the UPDATE policy breaks the old code's `UPDATE` the moment the migration lands.
  - Code first breaks the new code until the function exists.
  - The cheapest safe sequence is a migration that only adds the role and the functions, then the code switch, then the restrictive UPDATE policy as a later section or follow-up. Production has 0 roll rows and one user, so any order is survivable. Phase 3 should still pick one on purpose.
- **Proposals and approvals dated in a filed year.** Increment 1 warns on on-record acts (`affects_filed_period`). Approving a back-dated gain changes past-year counts and gains the same way. The approval result needs the same warning.
- **Future-dated proposals.** Approval before the effective date leaves the cache until the daily reconcile (F29). The row should say "takes effect {date}".
- **Pending queue growth.** `listPendingRollActions()` has no limit or pagination. A new congregation entering its whole roll queues hundreds. Bulk approve and pagination are in scope, not polish (Open Question 4).
- **Names in the queue.** The queue shows names of people hidden from the Directory (`directory_hidden`) to approvers today. Approvers need identity to decide, and `roll.propose` holders typed the person in. State it in the decision.

### Pass 5 — Adversarial

- **Redirect targets.** None new. The actions take a slug, and `callbackUrl` handling is unchanged.
- **State-machine shortcuts.**
  - The approve action posts a client-supplied roll action id with no UUID validation (a malformed id gives a raw database error).
  - A client can call approve on a row the viewer never saw.
  - Today a `denied` row can be updated back to `approved` or deleted by `presby_app`. The freeze trigger covers only `approved` rows.
  - The tightened UPDATE policy plus a terminal rule for decided rows closes both.
- **Enumeration.** A row id from another organization must look identical to a missing id (`not_found`). The function derives the organization from `presby_current_org()` and takes no organization parameter, as in Increment 1 (R2).
- **Cross-tenant disclosure through a typed refusal.**
  - `memberships_one_active_roll_idx` fires only when a person is `active` at two organizations. Linked persons exist (ministers, transfer claims), so it is reachable but rare.
  - A refusal that says "active elsewhere" tells one congregation that a person is on another congregation's active roll. Use generic copy with a support-ticket path, never the other organization's name.
- **Input boundaries.**
  - The approve and deny actions I read pass the reason and minute reference through with no server-side length cap and no required reason (F184). The client dialog may require a reason, but the server does not.
  - Caps proposed: reason 1–500, minute reference at most 200, matching Increment 1.
- **Self-targeting.**
  - An approver may approve their own proposal or their own membership. This is permitted by design today and surfaced with a "You proposed this" badge. It is not blocked.
  - Blocking it would deadlock a one-person bootstrap.
  - Default: stamp it (`selfApproved: true` on the audit row, badge kept), as DECISION-183 stamps self-designation.
  - The self-constitution path is the same shape. `startOfficerTerm()` has no self-target check, so the founding administrator can record themselves as an elder and then approve their own proposals. Default: allow, stamp the audit row `selfRecorded`, and name the residual in the decision (F182).
- **Privilege escalation through `role_grants`.**
  - `role_grants.manage` plus the subset check means the founding administrator cannot grant `roll.approve` to themselves, because they do not hold it.
  - The `officers.manage` to Session group to `session_member` path is the real escalation route (F182).
  - Ruling needed on whether a `ruling_elder` term must carry a minute reference. Default: optional but prompted, since historical entry may lack one.
- **Duplicate proposals double-count a gain.**
  - Nothing stops two pending `profession_of_faith` rows for one person at proposal time.
  - `presby_roll_changes` counts gains from effective rows by `effective_date` and `age_at_action`, so approving both, or approving a gain for someone already active, inflates the SASR gain line.
  - Default: at approval, refuse a gain whose resulting roll already equals the person's replay roll as of the effective date (`already_on_roll`).
- **Loss kinds.** The edit-time picker offers only gain kinds, so no approvable loss kind is reachable today. Keep that allow-list as a pinned test when approval moves into a function.

### Increment 2 scope, ruled item by item

| Operator ruling | What Phase 1 says |
|---|---|
| Baseline Session role carrying `roll.approve`, seeded and backfilled | Needs its own decision (DECISION-202). It revisits DECISION-100's "do not add a conditional branch pre-emptively": `baselineRoleSeedPlan` becomes type-varying, and a congregation gets a second role bound to the `session` derived group. The decision should also record that the Session roster is constituted by `officers.manage`, not by the roll (F182). |
| Pending-queue visibility for `roll.propose` as well as approvers | In scope. It needs an entry point (F179), a read-only mode, and a decided-history view, because proposers currently never see denials. |
| Complete visitor to member and participant to member through approval | Mostly follows from approval working. The remaining pieces: the Connection card and the lists update on approval, the Remove control disappears, and the already-on-roll refusal keeps gains honest (F181). |
| Move approval into a definer function and extend the restrictive policy to UPDATE | Recommend yes. Today "who may approve" is a paper property enforced only in `decideRollAction()`. Increment 1 closed the same gap for approved-at-insert. The function also lets approval take the membership lock Increment 1 introduced, so it cannot race a removal. It writes the audit row in the same transaction (F180). |
| Approval refuses on an ended membership or a shadowing later action | Refuse for an ended membership and for a deceased person. For a later-dated effective action, warn rather than refuse, consistent with Phase 3's S1 ruling: a 2018 profession entered after a 2020 opening balance is legitimate history. Return `shadowed_by` as Increment 1's S1 does. |
| `memberships_one_active_roll_idx` mapped to a typed result | Yes, with generic copy and no other organization named (see Pass 5). |
| Empty-Session-roster copy | Four states, Flow 7. |
| Soft-delete rule, F176's pending-row DELETE | See F183 and Open Question 3. Recommend revoking `DELETE` on `roll_actions` from `presby_app`, and making `denied` and `withdrawn` rows terminal. |

**Proposed approval refusal copy (Phase 3 finalizes):**

| Code | Copy |
|---|---|
| `forbidden` | You don't have permission to approve or deny roll actions here. |
| `not_found` | That roll action could not be found. |
| `already_decided` | Someone already decided this one. Refresh to see the current status. |
| `membership_ended` | This person's connection to this congregation has ended, so this can't be approved. Deny it instead. |
| `person_deceased` | This person is recorded as deceased. Deny this action or correct the record first. |
| `already_on_roll` | This person is already on that roll as of the effective date. Approving would count them twice. Deny the duplicate. |
| `active_elsewhere` | This can't be approved right now. Send us a support ticket and we'll look into it. |
| `reason_required` | Say why you're denying this. |
| `reason_too_long` | Keep the reason under 500 characters. |
| `provisioning_incomplete` | This organization's membership setup isn't finished, so this can't be decided yet. Send us a support ticket. |

### Gaps the request didn't address (findings numbered from F179)

- **F179. The pending queue has no entry point, and only approvers can read it.** Nothing links to `/admin/community/pending`. A proposer sees one person's pending row at a time on the edit page and nothing organization-wide. A proposer also never learns that a proposal was denied, or why.
- **F180. Approval is application-gated, and its audit is written outside the transaction.**
  - `decideRollAction()` issues a plain `UPDATE` as `presby_app`, so any bug elsewhere could approve a row.
  - `approveRollAction()` and `denyRollAction()` write their audit rows afterward through `recordAudit()`, which swallows failures. A constitutional act can commit with no audit row.
  - A denied row records no actor, and `denied` rows are neither frozen nor delete-guarded.
- **F181. Approval has no state checks.**
  - It does not refuse an ended membership or a deceased person.
  - A duplicate gain, or a gain for someone already on that roll, is counted a second time in `presby_roll_changes`.
  - A cross-organization active-roll collision raises a raw unique violation.
  - A back-dated approval changes a filed year with no warning.
- **F182. The Session is constituted by `officers.manage`, and a rostered elder may be unable to sign in.**
  - The founding administrator can record themselves as an elder and approve their own proposals.
  - `startOfficerTerm()` has no self-target check, and the minute reference is optional.
  - Elders recorded with no account cannot approve, and the invitation path for them (Invitations Increment 2) is unbuilt.
  - Only `ruling_elder` maps to the Session group, so an installed pastor serving as moderator is not an approver. This is not checked against polity (Open Question 6).
- **F183. A mistaken proposal cannot be withdrawn, and with no approvers it blocks the person.**
  - Only `roll.approve` can deny, and nobody holds it yet at a new congregation.
  - Increment 1's `pending_action` refusal then blocks any on-record participant act for that person (enrol, remove).
  - **The first real congregation is in this state the moment Increment 1 ships.** Either ship Increment 2's withdrawal path with or soon after Increment 1, or warn in the Increment 1 release notes.
  - The pending-row DELETE (F176) remains reachable by any `presby_app` path until it is revoked.
- **F184. The approve and deny actions have no server-side input bounds.** No required reason, no length caps, and the roll action id is not validated as a UUID.
- **F185. Organizations with no Session can queue member proposals nobody can approve.** Only congregations get a Session derived group. A new worshiping community, presbytery, synod or general assembly has none. The wizard offers the Member choice by `roll.propose` alone.
  - Default: offer Member only where a Session exists. Participant-on-record is unaffected.

### Out of scope (confirm)

- The Invitations Increment 2 build (org-level "Invite to sign in", "No login yet" markers). It is a separate pipeline. Increment 2 surfaces the symptom (Flow 7, state c) but does not fix it.
- Email or push notification to approvers when proposals queue. Sessions check an agenda per meeting. File as a follow-up.
- Approving loss, transfer-out and removal kinds, and the F19 membership-ending trigger for them. The edit-time allow-list stays gain-only.
- Closing F177 (the `active_membership` group admitting visitors). It becomes urgent when member self-service sign-in starts, not now.
- Org-wide hard-delete cleanup (rest of F176): the `contact_methods` and `addresses` blanking paths and the other tables' `DELETE` grants stay filed. Only `roll_actions` is in scope here.
- Requiring 2FA for approvers (org setting `require_two_factor` stays as is).
- A minute-reference requirement on approval, and Session quorum or vote counts. Approval stays one authorized person's act, as DECISION-078 and DECISION-066 already settled.

### Open questions

1. **Self-constitution and self-approval (F182).** Allow and stamp the audit row, or block? *Default: allow and stamp. The founding administrator is often the clerk and an elder at a one-person start, and a block would deadlock the bootstrap.*
2. **Elders without logins.** Pull Invitations Increment 2 ahead of Increment 3, or accept that approval works only for people who already have an account? *Default: ship Increment 2 with the honest Flow 7 copy. The operator ordered all Community work first, so Invitations Increment 2 would come after Increment 3, and elders other than the founder cannot approve until then.*
3. **Withdrawal semantics.** The operator ruled "denied, never deleted". Should a withdrawn proposal be `denied` with a distinct audit key, or its own `withdrawn` status? *Default: a distinct `withdrawn` status plus audit key, because "the Session said no" and "the clerk fixed a typo" are different facts. If the operator prefers the literal ruling, `denied` plus the new audit key works, but the row still needs an actor column.*
4. **Bulk approval.** Include select-and-approve with one minute reference now? *Default: yes, capped (50 per submit). A congregation entering a real roll otherwise needs hundreds of single approvals.*
5. **Non-congregation organizations.** Hide the Member choice where there is no Session? *Default: yes. A new worshiping community has no Session, so who approves there is its own question.*
6. **The pastor.** Should an installed pastor or moderator be able to approve? Only ruling elders are in the derived Session group today. This is not verified against polity, so the question goes to the operator, not to an analyst assumption.
7. **Minute reference at approval.** Optional but prompted, or required? *Default: optional, so historical entries aren't blocked.*
8. **Proposer view scope.** All pending proposals at the congregation, or only the viewer's own? *Default: all. The clerk keeps the register.*
9. **Denial reasons.** Show them to roll proposers? A reason is free text that elders type about a person. *Default: yes, to `roll.propose` and `roll.approve` holders only.*
10. **Already-on-roll refusal.** Refuse at approval when the person is already on that roll as of the effective date? *Default: yes (F181).*

### Numbers

- **Decisions (proposed):**
  - DECISION-202: the congregation baseline `session_member` role carrying `roll.approve` (revisits DECISION-100), including who constitutes the Session.
  - DECISION-203: approval, denial and withdrawal through definer functions, with the restrictive UPDATE policy, same-transaction audit, and decided rows terminal.
  - DECISION-204: pending-queue visibility and decided history for `roll.propose` holders.
  - DECISION-205: the Session-roster bootstrap rules (self-recording stamp, approver-status copy, non-congregation org types).
- **Findings:** F179–F185 above.
- **Migration:** the orchestrator assigns it. Expect 0062, with 0060 on the parallel pipeline and 0058 reserved.

### Handoff to architect (Phase 2)

Rulings needed:
1. **Definer function versus application check for decide and withdraw.** Include the restrictive UPDATE policy, the one-live-decision rule, and whether `denied` and `withdrawn` rows join the freeze trigger. Also rule on a `denied_by` and `denied_on` pair, or a single actor column.
2. **The second baseline role.** How `baselineRoleSeedPlan` varies by organization type, whether backfill skips orgs with an existing `session_member`, and whether the role carries `roll.approve` only.
3. **The self-constitution residual (F182).** Is "allow and stamp" acceptable, or does the Two Hierarchies invariant demand a gate?
4. **Withdrawal status versus reusing `denied`.** This extends the vocabulary CHECK that 0061 added.
5. **The deploy sequence** for moving approval into a function.

**Sequencing.** Increment 2's Phases 1–3 can run now, because judgment agents never conflict. Phase 4 must wait until Increment 1's Phase 4 batches are committed. They rewrite `roll.ts` and `people.ts`, and Increment 2's migration depends on 0061's functions and policy. The Rule 16 shared files stay orchestrator-only.

Files read (all under `/Users/cshenso/git/presby-platform/presby-fadir`): `docs/work-log/2026-10-22-founding-admin-directory.md`, `docs/work-log/_template.md`, `src/lib/roll.ts`, `src/lib/roll-action-kinds.ts`, `src/lib/officers.ts`, `src/lib/org-provisioning.ts`, `src/lib/audit-tx.ts`, `src/lib/audit.ts`, `src/lib/role-grants.ts`, `src/lib/onboarding/founding-administrator.ts`, `src/lib/db/domain/person-ext.ts`, `src/lib/db/domain/roll.ts`, the community pending `page.tsx`, `actions.ts` and `pending-worklist.tsx`, the officers states file, `drizzle/0009`, `0012`, `0017`, `0028`, `scripts/seed-dev.sql`, `docs/decisions.md`, `docs/TODO.md`.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Increment 2 — 1 Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-22 |

---

## Increment 3 — scoping note (visitor follow-ups)

**Can it follow Increment 2 directly? Yes.**

It has no schema or function dependency on Increment 2. Follow-ups hang off `memberships`, not the roll. The one coupling is soft: an automatic "new member" follow-up when the Session approves. Leave that manual in the first cut so the approval function stays free of side effects.

It does not reuse Increment 1 or 2's tables, so it needs its own full pipeline, with Phase 1 and a Phase 2 run (new table, new permission). It also needs its own migration and its own numbers (DECISION-206 onward, F186 onward).

Two parallelism options for the orchestrator:
- **Serial.** Inc 2 finishes Phase 6, then Inc 3 starts. Simplest, and fits "finish Community first".
- **Overlapped.** Inc 3's Phases 1–3 run during Inc 2's Phase 4, since judgment agents never conflict. Inc 3's Phase 4 starts after Inc 2 commits. `roll.ts` is untouched by Inc 3, so the only collisions are the migration number and the shared files.

**Scope as the operator stated it:** the `follow_ups` table as the visitor-to-member funnel, a first-visit workflow, and an engagement editor changing visitor, regular, inactive and moved away.

**What Phase 1 for Increment 3 must resolve (from reading `follow_ups`, `memberships.engagement_status`, and Increment 1's lists):**

1. **The table is thin.**
   - It has `workflow`, `step`, `status`, `assigned_to_person_id`, `due_on`, `completed_at` and free-text `notes`.
   - It has no `created_by`, no `created_at`, no status vocabulary CHECK, and no `unique (id, organization_id)`.
   - `presby_app` holds `DELETE` on it (an F176 case), and a hard-deleted follow-up violates the soft-delete ruling.
   - Workflows must be a fixed catalog (no custom fields, D8). The table's own comment names four: `first_visit`, `new_member`, `inactive_outreach` and `care`. Step lists are code constants.
2. **Sensitivity.**
   - Free-text follow-up notes about a visitor are pastoral in practice (tier 3).
   - Either leave notes out of the first cut, or gate them behind a pastoral permission.
   - A new permission needs DECISION-078's binding test. Candidate: the Board of Deacons, whose mercy-and-visitation duty passed that test in an earlier decision. Phase 2 verifies, not the analyst.
3. **Assignees need a login to see "my follow-ups".** This is the same dependency as Increment 2's elders (Invitations Increment 2, unbuilt). An admin-managed list works without it.
4. **The engagement editor creates invisible people.**
   - Increment 1's Visitors list is `engagement_status = 'visitor' and current_roll is null and ended_on is null`.
   - A visitor changed to `inactive` or `moved_away` leaves that list and appears in no other view. The Directory predicate admits `regular` or any roll, not those two.
   - Under the soft-delete rule, "set status, never delete" is meaningless if the person disappears. The editor needs views for Inactive and Moved away, or a visible filter on Everyone.
   - `engagement_status` is free text with no CHECK, so a vocabulary constraint belongs in the migration.
5. **Engagement versus the roll.** Engagement is the pastoral axis and must stay separate. Ruling needed:
   - whether the editor refuses to change a person who is on a member roll;
   - whether "moved away" means anything for membership end. The soft-archive for a visitor is `ended_on` with a fixed reason marker, in the same pattern as Increment 1's removal, and needs a reopen path.
   - A member with engagement `visitor` is a display oddity after approval. Increment 1's `deriveConnection` handles it by roll-first precedence. The editor should not rewrite it silently.
6. **F177.** The `active_membership` group admits visitors. If follow-up volunteers or visitors ever sign in, the baseline member role reaches a visitor with an account. Increment 3 does not need to close F177, but its Phase 2 must restate the exposure.
7. **First-visit workflow trigger.** Start with a one-click "Start first-visit follow-up" on a new visitor. Auto-creation inside `createPerson()` is a hidden write and belongs in a later ruling, not the first cut.
8. **Funnel metrics.** `first_visit_date` and `how_heard` already exist from Increment 1. A visitor-to-participant-to-member view is derivable from `roll_actions` dates, but a count that crosses into the SASR must not. Engagement is never reported.

**Estimated size:** medium to large. One migration (follow-ups columns, CHECKs, delete guard, permission), one library, three pages, one new permission, and the biggest unknown is the sensitivity ruling in item 2.

**Operator questions Increment 3 will need answered:**
- Who assigns and works follow-ups: deacons, the clerk, any member with a role?
- Are free-text notes in the first cut?
- Should a visitor archive be in scope?
- Is a dedicated Inactive and Moved away view acceptable?

Increment 3 gets its own Phase 1 at kickoff. Numbers should be reserved at `/new-feature` kickoff per Rule 16, not now.
---

### Operator rulings on the Increment 2 open questions (2026-10-22)

- **Q1, self-constitution and self-approval (F182):** **allow and stamp.** The audit marks `selfRecorded` and `selfApproved`.
- **Q2, elders without logins:** **"Add invites into Community".** An org-level "invite this elder or member to sign in" path, the Invitations Increment 2 shape, moves INTO the Community work so a real Session can approve. Scope it as part of Increment 2, or as Increment 2b ahead of Increment 3.
- **Q3, withdrawal:** **its own `withdrawn` status**, with an actor and a distinct audit key. Never deleted.
- **Q6, the pastor:** the operator asked "what does the book of order say?" The orchestrator answered from the PC(USA) Book of Order: the session is composed of the ruling elders in active service together with all installed pastors and associate pastors (G-3.0201), and the pastor is its moderator. Receiving members is the session's act. Proposed default, pending operator confirmation: installed pastors and associate pastors count as Session approvers alongside ruling elders. **Caveat for Phase 2:** a teaching elder's membership is with the presbytery, not the congregation. The derived Session group is built from `ruling_elder` officer_terms and requires a congregation membership, so including installed pastors needs a data-model ruling (pastoral relationship/appointment records → session composition) and must not invent a congregation membership.
- **Q4, Q5, Q7–Q10:** not put to the operator. The analyst defaults stand: bulk approve capped at 50; Member is offered only where a Session exists; the minute reference is optional; proposers see all pending proposals; denial reasons are visible to roll.propose and roll.approve holders; refuse an approval that would put someone on a roll they are already on.

---

# Increment 2 — Phase 2: Architectural Review (architect)

*Returned as text. The architect is read-only, so the orchestrator records this verbatim.*

## Verdict

**Approved with suggestions.**

Increment 2 goes to Phase 3. It covers Session approval, the queue, withdrawal, and installed pastors and associate pastors as Session members. Phase 3 must design to R1–R18 below. The suggestions S1–S5 are Phase 3's call.

**Elder sign-in invites are split out as Increment 2b.** It has its own migration, its own decision numbers, and a short analyst Phase 1 addendum before its Phase 3. Phase 1 marked invites out of scope and never refined them. R19–R26 below set the architectural limits for 2b now, so its design does not need a second Phase 2 unless it departs from them.

The pastor ruling assumes the operator confirms the proposed default. If the operator declines, R10 drops cleanly: one CASE arm and three vocabulary values.

## Placement

- **Directory placement (Increment 2):**
  - `drizzle/0062_presby_session_approval.sql`. Additive only: columns, the status vocabulary, a terminal-state freeze, the `session_member` role and its backfill, the derived-Session mapping for pastors, the office vocabulary CHECK, and the three definer functions. Old code keeps working after it is applied.
  - `drizzle/0063_presby_roll_decide_lockdown.sql`. Removes `presby_app`'s UPDATE and DELETE on `roll_actions` and narrows the insert policy. It needs the new code to be deployed first (R16).
  - `src/lib/roll.ts`:
    - `approveRollAction`, `denyRollAction` and a new `withdrawRollAction` become thin callers of the definers.
    - `listPendingRollActions` widens its read gate.
    - New: `listRecentlyDecidedRollActions`, and the Flow 7 reader `getSessionApprovalState`. It sits in `roll.ts` because the queue is its only consumer.
    - This file stays the only one that names the decide and withdraw functions (source scan, as in Increment 1).
  - `src/lib/roll-action-kinds.ts`: `APPROVABLE_ROLL_ACTION_KINDS`, plus `ROLL_DECISION_REFUSALS` and `ROLL_WITHDRAW_REFUSALS`. Each is pinned to the SQL literals.
  - `src/lib/officers.ts`:
    - `OFFICER_OFFICES` gains `installed_pastor`, `co_pastor` and `associate_pastor`.
    - New `SESSION_OFFICES`, pinned to the trigger's CASE.
    - `selfRecorded` is added.
    - Session-office audit moves into the same transaction (R13).
  - `src/lib/org-provisioning.ts`: `baselineRoleSeedPlan` becomes type-varying, and `boundToDerivedFrom` widens to include `"session"`.
  - `src/lib/audit.ts`: `ROLL_ACTION_WITHDRAWN: "tenant.roll_action.withdrawn"`.
  - UI:
    - `src/app/(org)/o/[slug]/admin/community/pending/**`: read and decide modes, Recently decided, bulk approve, withdraw.
    - The Community header gets an "N waiting" link.
    - The Officers page gets the pastor offices and the Flow 7 copy.
  - No new top-level module and no new route group.
- **Directory placement (2b):**
  - `src/lib/onboarding/org-invite.ts`: the issue side on `presby_app` through `withOrgContext`. A source scan pins that it never imports `getPlatformDb()`. This is the deliberate opposite of `issue.ts`.
  - `accept.ts`, `status.ts` and `labels.ts` are extended.
  - A new template key goes in the email registry and in `credential-keys.ts`.
  - The "Invite to sign in" card goes under `community/[id]/edit/`.
  - Acceptance stays in `(invite)`, unchanged.
  - The migration is its own, 0064 (provisional).
- **Server vs Client split:**
  - The pending page and the Community header count stay Server Components.
  - `pending-worklist.tsx` is already a client component. It gains the bulk selection: 44px targets, a sticky "Approve N" bar that does not cover the last row, and dialogs that fit at 360px.
  - Approve, deny and withdraw use the generated `AlertDialog` primitive (Rule 2).
  - Any `useForm` root renders `<HydrationGate>` (`check:hydration-gate`). Any dialog without `useForm` gets a hydration spec, as Increment 1's dialogs did.
  - Server actions stay in the co-located `actions.ts`.
- **Dependencies:** none.

## Rulings

### 1. The five analyst items

**1a. Decide and withdraw go through SECURITY DEFINER functions (DECISION-203, F180).**

Live catalog on the pipeline branch:
- `roll_actions` is FORCE RLS.
- It has the permissive `tenant_isolation` policy plus 0061's restrictive pending-only insert policy.
- `presby_app` holds SELECT, INSERT, UPDATE and DELETE.
- The only application UPDATE anywhere is `decideRollAction()` (`roll.ts:135`).
- `presby_freeze_approved_roll_action` freezes `approved` rows only.

So "who may approve" is paper today.

- **R1. Two functions:**
  - `presby_decide_roll_action(p_roll_action_id uuid, p_decision text, p_minute_reference text, p_reason text, p_decided_by uuid)`, where `p_decision` is `approve` or `deny`.
  - `presby_withdraw_roll_action(p_roll_action_id uuid, p_reason text, p_withdrawn_by uuid)`.
  - Both use Increment 1's R1–R3 shape:
    - `security definer`, `set search_path = public, pg_temp`, revoke from public, execute to `presby_app` only;
    - the org comes from `presby_current_org()`, with no org parameter;
    - the actor is a `users.id` resolved to a live, unmerged person with an active membership who holds the key: `roll.approve` for decide, `roll.propose` for withdraw;
    - an identity refusal raises one uniform `insufficient_privilege` literal;
    - state refusals come back as typed outcomes, exactly one row per call.
  - Generalising Increment 1's actor helper into `presby_roll__actor_holds(org, user, key)` is acceptable.
- **R2. Lock order is membership, then roll action**, the same as Increment 1's R6:
  1. read the row to learn the person;
  2. `for update` the membership;
  3. re-read the roll action `for update`;
  4. re-check that it is pending.
- **R3. Approve checks, in order:**
  - identity;
  - `not_found` (another org's id looks the same);
  - `already_decided`;
  - `not_approvable_kind`: only kinds with a non-null mapped `resulting_roll` (the DECISION-107 rule). Loss kinds, `void` and `opening_balance` are refused, and a test pins the list;
  - `person_deceased`, `person_merged`;
  - `membership_ended`;
  - `holds_pastoral_office` (R12);
  - `already_on_roll` (R6);
  - the UPDATE in a sub-block:
    - a `unique_violation` on `memberships_one_active_roll_idx` becomes `active_elsewhere`, with generic copy that never names the other org;
    - the S4 `foreign_key_violation` becomes `provisioning_incomplete`;
    - anything else re-raises.
  - It returns `affects_filed_period` (0061's predicate), `shadowed_by_kind` and `shadowed_by_date` (a warning, never a refusal, per Increment 1's S1), `self_approved` and `self_target`.
  - It sets `approved_by` and `approved_on` as today, plus `decided_by` and `decided_at` (R5).
  - When supplied, the minute reference overwrites the proposer's, as today.
- **R4. Input bounds are enforced in the database too (closes F184):**
  - the reason for deny and withdraw is required and 1–500 characters after trimming;
  - the minute reference is at most 200;
  - TypeScript validates the UUID shape before the call, so a malformed id is `not_found`.
- **R5. Columns (additive, 0062):**
  - `decided_by uuid references users(id)` and `decided_at timestamptz`, set by the definers on every terminal transition;
  - `withdrawal_reason text`;
  - CHECKs:
    - `denial_reason is null or approval_status = 'denied'`;
    - `withdrawal_reason is null or approval_status = 'withdrawn'`;
    - a row with `approval_status in ('denied','withdrawn')` has `decided_at` and `decided_by`.
  - `approved_by` and `approved_on` are kept, because replay, seeds and tests read them. Existing approved rows are backfilled `decided_by = approved_by` and `decided_at = approved_on::timestamptz`. Production has 0 rows; the branch has 0 denied.
  - This settles the analyst's "one actor column or a pair" question: one generic pair for all terminal states, not `denied_by` plus `withdrawn_by`.
- **R6. The double-count guard (F181, Q10 default).** The rule is that **an approval must not leave two consecutive effective rows with the same `resulting_roll` where both are counted gain kinds**.
  - Refuse `already_on_roll` when the person's replay roll as of `effective_date`, excluding this row, already equals its `resulting_roll`.
  - Refuse it also when the *next* effective row after this one has the same `resulting_roll` and is a counted gain kind. `presby_roll_changes` counts every effective gain row, so a later duplicate would be counted again.
  - A following `opening_balance` is not counted, so it gives the shadow warning only. That keeps "a 2018 profession entered after a 2020 opening balance" legitimate.
  - Test both directions against `presby_roll_changes`.
- **R7. One pending action per person.** Add `roll_actions_one_pending_per_person` as a partial unique index on `(organization_id, person_id) where approval_status = 'pending'`. This closes the duplicate-pending half of F181 structurally, and withdrawal is now the remedy for a mistake.
  - Measured on the branch: 1 pending row, 0 duplicates. Production: 0 rows.
  - Proposals map the `unique_violation` to a typed `pending_exists` with copy that points at the existing proposal.
  - If Phase 3 finds a real multi-pending case the edit picker can reach, fall back to R6 alone and record why. Today the picker offers gain kinds only, so none is reachable.
- **R8. Decided rows are terminal.** In 0062, `presby_freeze_approved_roll_action` refuses UPDATE or DELETE when `old.approval_status in ('approved','denied','withdrawn')`. Approved rows keep their existing message. This binds the owner too.
  - Fixture teardown already disables this trigger.
  - `test-rls.sql` §20d and the assertions near lines 258, 275, 1421 and 1432 are patched at integration.

**1b. The second baseline role (DECISION-202).**

DECISION-100's comment anticipated this exact case: the function is "ready to branch the day a genuinely type-varying baseline role is proposed". Branching it is the planned extension, not a reversal.

- **R9.** `baselineRoleSeedPlan("congregation")` returns `member`, plus `session_member` with name "Session member", `roll.approve` **only**, constitutional, protected, bound to the `session` derived group. Every other org type is unchanged.
  - The dev fixture's extra `directory.view` on `session_member` is not copied. The baseline `member` grant already covers it, and the queue reads are gated on the roll keys, not `directory.view`.
- **0062 backfill**, idempotent, with the role key as the discriminator (never a reason text):
  - It covers congregations that have a `session` derived group and no org-owned `session_member`. It inserts the role, its single permission row, and a group-arm `role_grants` row in the same statement block.
  - It **skips** any organisation that already has an org-owned `session_member`, and never modifies it. That follows the respect for tenant-held roles in 0052's note 5.
  - **Missing court groups:** on the branch only 3 of 9 congregations have a `session` group, and `startOfficerTerm('ruling_elder')` raises a raw FK error at the rest. 0062 seeds the missing `session` and `diaconate` groups for congregations in the `groupSeedPlan` shape, then binds the role.
    - An empty derived group grants nothing until the congregation's own officer records fill it, so this is provisioning, not authority.
    - The header records the measured production counts before deploy, as counts with no slugs.
  - Non-congregations get nothing (F185, R15).

**1c. The self-constitution residual (F182, DECISION-205).**

The operator's "allow and stamp" is acceptable under Two Hierarchies. The authority comes from the congregation's own officer record, entered by a tenant permission (`officers.manage`). No platform predicate takes part in any check. The bootstrap would deadlock under a block.

The chain is still the one DECISION-155 refused to bundle: a platform designation leads to `officers.manage`, a self-recorded elder or pastor term, and then `roll.approve`. Name it the way DECISION-194 named its residual:
- **Paper**, detected by audit and not prevented: `invitation.accepted` (founding_administrator), then `officer_term.started` with `selfRecorded: true` on a Session office, then `tenant.roll_action.approved` with `selfApproved`.
- Proposed CLAUDE.md sentence for the operator to review in the diff (Two Hierarchies section): *"A founding administrator who records themselves as a ruling elder or installed pastor becomes a Session approver. This is permitted, stamped `selfRecorded` and `selfApproved`, and `paper`."*

**1d. `withdrawn` is its own status (operator Q3, DECISION-203).**

- 0062 drops and re-adds `roll_actions_approval_status_allowed` with `('pending','approved','denied','withdrawn')`. Do not reach back into 0061: by Increment 2's Phase 4 it will have merged and may have shipped.
- **The S3 index predicate must change.** `roll_actions_one_live_void_idx` is `where kind = 'void' and approval_status <> 'denied'`, so a withdrawn void would count as live. Re-create it in 0062 with `approval_status in ('pending','approved')`, and fix the Drizzle mirror at `src/lib/db/domain/roll.ts:167`.
- `presby_effective_roll_actions`, the reporting index and Increment 1's `pending_action` all key on `= 'approved'` or `= 'pending'`, so withdrawn rows drop out of replay and release the person with no further change. Verified against the live view definition.
- Withdraw needs `roll.propose`, and any holder may withdraw (the clerk keeps the register). Audit metadata stamps `selfProposed`.

**1e. The deploy sequence (R16).**

This is the reverse of Increment 1, on purpose:
1. **0062** (additive: old code stays compatible, because pending-to-denied and pending-to-approved still work and the new columns are nullable).
2. **Code**: the definers become the only decide path.
3. **0063**: `revoke update, delete on roll_actions from presby_app`, and narrow `roll_actions_insert_pending_only` to `approval_status = 'pending' and kind = any(<approvable kinds>)` (F191).

Revoking is stronger and simpler than a restrictive UPDATE policy, because no application path updates or deletes a roll row once `decideRollAction()` is gone. The repo-wide search found only `roll.ts:135`. If Phase 3 finds an edit-a-proposal need, the fallback is a restrictive UPDATE policy that keeps pending rows pending.

Production has 0 roll rows and one user, so the window is survivable either way. The point is to choose the order deliberately. Removing DELETE also closes the `roll_actions` part of F176.

### 2. Pastors as Session approvers (DECISION-206)

I checked the composition against a PC(USA) summary of the session article. G-3.0201 composes the session of ruling elders elected to active service plus "all installed pastors and associate pastors". G-3.0204 makes the session keep "registers of baptisms, installed pastors". The installed pastor moderates. Temporary relationships (stated supply, interim, temporary supply), parish associates, and a designated moderator during a vacancy are **not** in that composition and are not mapped.

**Which existing record carries "installed pastor of this congregation":**

| Record | Verdict | Why |
|---|---|---|
| `appointments` (presbytery-owned, `serving_org_id`) | **Not the source** | Its `organization_id` is the presbytery, forced by D1 and F2. Having a presbytery row write the congregation's Session roster would be authority flowing *down* by inheritance, which Two Hierarchies forbids. DECISION-112 deferred any congregation-side read of it to a publication mechanism. Most congregations' presbyteries will not be on the platform. It stays the presbytery's own record. Reconciling against a published appointment is a follow-up. |
| `staff_positions` | No | Personnel, and it grants nothing by design (schema-design §Staff, DECISION-128). |
| `role_grants` (`installed_pastor` role) | No | That role is a software permission set (`pastoral_notes.manage`, DECISION-108). Court composition must stay an officer fact, not a role fact (F3, The Court Is Not a Group). |
| **`officer_terms` at the congregation** | **The carrier** | Already the schema's intent (schema-design: "installed pastors from `officer_terms`"). It matches G-3.0204's register, which the session keeps. The live branch already holds one `installed_pastor` term, and it sits on a congregation membership with `current_roll` null. |

**No congregation membership is invented.** In this schema a `memberships` row is the person-to-organisation *link* (D1). Polity membership is the roll: `current_roll` and `roll_actions`. A pastor's link row carries no roll fact:
- no `roll_actions` row and a null `current_roll`;
- so no SASR count, because `presby_roll_counts_as_of` replays the roll only;
- and no Directory listing through the roll.

That is the same anchor shape DECISION-128 built for staff and `presby_accept_invitation` writes for designees (`engagement_status = 'staff'`). The pastor needs that link anyway to enter `/o/<slug>` at all: `withOrgContext` and `presby_has_permission` both require `presby_membership_is_active`.

- **R10. Data model (0062):**
  - `presby_sync_derived_group`'s CASE maps `ruling_elder`, `installed_pastor`, `co_pastor` and `associate_pastor` to `'session'`.
  - `moderator` stays unmapped: a moderator who is not a pastor has no vote.
  - Add `officer_terms_office_allowed`, a validated CHECK over the app vocabulary:
    - existing: `ruling_elder`, `deacon`, `clerk_of_session`, `moderator`, `treasurer`, `trustee`;
    - new: `installed_pastor`, `co_pastor`, `associate_pastor`.
  - The branch's distinct offices are all inside that set. Measure production before deploy.
  - Re-materialise existing pastor-office terms with a no-op touch, `update officer_terms set ends_on = ends_on where office in (...)`. That re-fires the AFTER UPDATE trigger, and no direct `group_memberships` write is needed.
  - This **is** "The Court Is Not a Group" applied correctly: the roster is still materialised from `officer_terms` by trigger, and today's mapping is the incomplete one.
- **R11. Pastor offices are congregation-only and recorded with `officers.manage`.**
  - The app refuses them at other org types with a typed outcome, because the trigger raises when the target group is missing.
  - The anchor must carry no roll. `startOfficerTerm` refuses a pastor office for a person with a non-null `current_roll` at the org (`on_member_roll`). A teaching elder's membership is with the presbytery.
  - The anchor is created through the existing staff-anchor path. Using Visitor or Participant is forbidden, because that would invent a pastoral or roll fact. A dedicated "Clergy" connection is optional future polish.
- **R12. The reverse guard.** The approve function refuses a member-roll gain for a person holding an open pastor-office term (`holds_pastoral_office`).
- **Consequence to state in DECISION-206:** any role a tenant has bound to its Session group now reaches installed pastors too, which is correct polity. On the branch the only such grant is the fixture `session_member`. Measure production.
- **Known limit, not fixed here:** if the pastor already exists on the platform at the presbytery, `memberships_guard_insert` refuses a congregation link ("link through presby_claim_person()"), and that function does not exist. The congregation gets the existing `existing_member_elsewhere` copy. The cross-org claim path is a follow-up, not Increment 2.
- **Migration fit:** all of R10 is `create or replace`, one CHECK and one touch statement. It belongs in **0062**, which already settles who constitutes the Session.

### 3. Elder sign-in invites: Increment 2b (DECISION-207, DECISION-208)

**Split it.**
- It is a different subsystem: onboarding, the credential table, the email queue and `(invite)`.
- It modifies the single acceptance function, which DECISION-183 made the security core of onboarding.
- Increment 1's reviewability concern applies with more force: the approval definers and an acceptance-path change should not share a diff.
- Increment 2 works without it for a one-person start (the founding administrator records themselves, R-1c), with honest copy for Flow 7 state (c).

2b runs after Increment 2's Phase 4 commits, ahead of Increment 3, and gets its own migration (0064, provisional).

- **R19. Reuse the credential.**
  - Same table, `account_invitations`, with a new `purpose = 'sign_in'` and `origin = 'org'`. The origin column exists for exactly this case.
  - `person_id` is required at insert, as for treasurer. No names are carried.
  - Add a partial unique index: one open `sign_in` row per `(organization_id, person_id)`. The existing `open_designation_uq` already leaves non-designation purposes out by its predicate.
  - It stays hashed, single-use and expiring. It is never a `FEATURES.*` key, a session claim or a resolver input (DECISION-147, DECISION-183).
  - Resend makes a new row (D-1).
- **R20. Issue through a definer.** `presby_app` holds no table privilege on `account_invitations`, so issue and revoke go through new definers, e.g. `presby_issue_sign_in_invitation(p_person_id, p_token_hash, p_expires_at, p_issued_by)`:
  - the org comes from `presby_current_org()`;
  - the actor is the bounded `users.id` claim;
  - the **address is read from the person's on-file primary email in SQL and never typed by the sender**;
  - refusals:
    - `already_signs_in` (the person's `user_id` is not null);
    - `person_merged`, `person_deceased`, `membership_ended`;
    - `no_email_on_file`;
    - `address_is_yours`: the on-file address equals the sender's own account email while the person is not the sender. Comparing to your own row is not an enumeration oracle.
  - Like `issue.ts`, it **never reads other `users` rows**, so the sender's screen cannot reveal whether an address has an account (DECISION-189). Account collisions surface only at acceptance.
  - The queue row is written in the same transaction (`presby_app` holds INSERT on `email_queue`) under a new template key: class `account`, platform sender, because org-class mail (DECISION-182) is unbuilt. It is listed in `credential-keys.ts` so the body is scrubbed after sending.
  - The link comes from `platformOrigin()` only. The DECISION-189 durable limits apply, but the per-org bucket is split by origin so tenant invites cannot use up the platform's designation sends.
- **R21. Who may send: you may bind a login only to a record whose authority you could have created yourself.**
  - **`people.manage`** is required for every invite. That key governs the person record and its contact data. No new key.
  - If the person holds an open Session or diaconate office term, the sender also needs **`officers.manage`**: the court's authority is constituted by officer records.
  - If the person holds person-arm `role_grants`, those grants' permissions must be a **subset** of the sender's, the same posture as DECISION-106 and `assertPermissionSubset`.
  - All three checks happen in the definer.
  - This lets the founding administrator invite elders, which is the purpose of 2b. It stops a `people.manage`-only holder from claiming an elder's or a treasurer's record.
  - **Residual, `paper`:** a sender with `people.manage` can rewrite an unlinked person's email to an accomplice's address and then invite. Detected by audit: the person update, then `invitation.created`, then `invitation.accepted`. Not prevented. State it in DECISION-207.
- **R22. Acceptance is a new `sign_in` branch in `presby_accept_invitation`.** One acceptance function, signature unchanged, and the FA and treasurer parity golden must stay byte-identical.
  - The person is taken from the token's row only. The invitee cannot pick a different person, because nothing they send names a person.
  - It reuses the treasurer branch's gates verbatim: `person_merged`, `membership_ended`, `person_linked_elsewhere` (the person already has a different user), and `person_elsewhere` or `ambiguous_person` (the accepting account is already linked to another live person, F110/F112).
  - It adds `person_deceased` to the blocked-reason CHECK.
  - On success it creates the account if needed and links `people.user_id`. **Nothing else is applied**: no role grant, no designation. Authority arrives only through the records the person already has.
  - Audit `invitation.accepted` with `purpose: 'sign_in'`. The session refresh after a signed-in accept (F167) applies.
- **R23. The user-to-person link becomes a database property (F186).** `people.user_id` is the identity binding: `presby_user_organizations` resolves user to person to memberships. Today `presby_app` can UPDATE it freely, through the `visible_via_membership_update` policy with no guard. 0064 adds `people_guard_user_link` (BEFORE UPDATE OF `user_id`). It refuses unless a definer-armed marker naming that person is set, the 0059 marker idiom, and it binds the owner too.
  - Phase 3 measures every current writer of `people.user_id`, including merges, before it lands.
- **R24. The email match must be trustworthy (F187).** `presby_app` still holds INSERT, UPDATE and DELETE on `users`. `users` has no RLS. This is the F38 blanket-grant residue named in 0044. Acceptance's identity control is `lower(users.email) = email_normalized`, and 2b makes the tenant connection an issuer for the first time.
  - Phase 3 measures `presby_app`-side writers of `users`.
  - 0064 revokes those privileges if none exist. The definers run as owner.
  - Otherwise it at least guards `users.email` with a trigger.
  - Check whether this is already tracked. If it is, cite the existing number instead of F187.
- **R25.** `(invite)` is unchanged: platform palette, exact `PUBLIC_PATHS`, no layout or loading boundary, never imports `getPlatformDb()`. No new flag. The send card rides the Community toggle (operator memory: no new platform flags before go-live).
- **R26.** On the Community list, the "Can't sign in yet" marker is admin-only (`people.manage`). Flow 7 state (c) links to the invite card once 2b ships.

### 4. Self-approval, withdrawal, database-enforced approval, statistics

- **R13. Stamps.**
  - Approve metadata: `organizationId`, `rollActionId`, `kind`, `effectiveDate`, `minuteReference`, `selfApproved` (proposer is the approver), `selfTarget` (the approver is the subject), `affectsFiledPeriod`, `shadowedBy`.
  - Deny metadata: `reason`.
  - Withdraw metadata: `reason`, `selfProposed`.
  - All three are written with `insertAuditRow()` in the **same transaction** (F180), using the keys `tenant.roll_action.approved`, `.denied` and the new `.withdrawn`. Ids only, no names.
  - Officer-term start and end for a **Session or diaconate office** also move to an in-transaction audit row with `selfRecorded` (the target person's `user_id` equals the actor). Such a term is now equivalent to granting `roll.approve`, and grants are audited in-transaction.
  - The "You proposed this" badge stays.
- **Database enforcement:** R1, plus 0063's revoke. After 0063, the only way any `presby_app` caller can move a row out of `pending` is a definer that checked the key in the same transaction.
- **R14. Filed statistics.**
  - A filed return is a frozen snapshot (`statistical_returns_freeze`, publication immutability), so approval never changes it.
  - The live risk is a back-dated approval making the next year's opening count disagree with the filed year. The function returns `affects_filed_period` and the UI warns, with the same copy as Increment 1.
  - R6 and R7 remove the double-count of gains.
  - Participant to member drops the participant count with no loss line, which matches 0012's model.
- **R15. Non-congregations (F185, Q5 default).** Offer the Member choice only where the org has a `session` derived group. The wizard and `recordRollAction()` refuse with `no_session` server-side. Participant-on-record is unaffected.
- **R17. Queue reads.**
  - `listPendingRollActions` gates on `roll.approve` or `roll.propose` and returns `mode: 'decide' | 'read'`.
  - Recently decided shows denial and withdrawal reasons to holders of those two keys only. They are free text about a person, so the lib filters; RLS cannot do it per column.
  - Names of `directory_hidden` people appear to these holders, by design. Record that in DECISION-204.
  - Known coupling, recorded: turning off the Community toggle (`org_portal.members_create`) also hides the approval queue.
- **R18. Bulk approve.**
  - At most 50 per submit.
  - **One transaction per row, sequential**, each its own definer call and audit row. The result is the per-row "N approved, M need attention".
  - No cross-row atomicity is claimed, and one long transaction must not hold 50 membership locks.

### 5. Sequencing and numbers

- **Increment 2:**
  - Phase 3 may start now.
  - Phase 4 waits for Increment 1 to merge: `roll.ts`, `roll-action-kinds.ts`, `people.ts`, `community/pending/**` and 0061's functions and CHECK.
  - 0062 is written against merged `main` and never edits 0061 in place.
  - Rule 16 shared files stay orchestrator-only: the journal, `test-rls.sql` (stage `scripts/session-approval/test-rls-62.sql` plus a patch for §20d and lines ~258/275/1421/1432), `seed-dev.sql` (the fixture `stated_clerk` and `session_member` drift, F190, is integration's call), TODO, decisions, STATE.
- **F183 still bites Increment 1.** The first real congregation can strand a mistaken member proposal, and with it any participant act for that person, until Increment 2 ships withdrawal. Put a warning line in the Increment 1 release notes, or keep the gap between the two short.
- **Migrations:** **0062** (additive), **0063** (lockdown, after the code deploy) and **0064** (2b). The orchestrator reserves all three and re-checks them against `main` at each Phase 4 kickoff.
- **Decisions:** DECISION-202–205 as the analyst proposed, plus **DECISION-206** (pastors) for Increment 2. 2b needs **DECISION-207** (the org-issued sign-in credential: purpose, issue definer, sender rule, acceptance branch) and **DECISION-208** (the user-to-person link and `users` writes are definer-only). Increment 3 therefore moves to DECISION-209 onward.
- **Findings:** F179–F185 (analyst) plus **F186–F191** below. Increment 3 moves to F192 onward.

## Invariants Touched

- **The Roll Is the System of Record:** respected.
  - Decisions are state transitions on pending rows. Decided rows become terminal (R8).
  - Replay is unchanged: withdrawn and denied rows never enter `presby_effective_roll_actions`.
  - Pastors carry no roll fact.
  - Gains cannot be double-counted (R6, R7).
- **The Court Is Not a Group:** strengthened.
  - The Session is still materialised from `officer_terms` by trigger, now with G-3.0201's full composition (R10).
  - Approval authority is a role bound to the derived group, so the resolver sees it (F3).
- **Two Hierarchies Intersect Nowhere:** respected.
  - `appointments` is deliberately **not** the source, so no downward write.
  - The backfill is constitutional baseline provisioning keyed by role key. It skips tenant-held `session_member` roles and grants authority only to whoever the congregation's own records constitute.
  - The self-constitution chain is a named `paper` residual with audit detection. A CLAUDE.md sentence is proposed for operator review.
- **Isolation Is a Database Property / F26:** every definer takes the org from `presby_current_org()`, pins `search_path` with `pg_temp` last, and touches only that org's rows. An id from another org is `not_found`.
- **Permissions vs Flags / credentials:**
  - No new `FEATURES.*` key, no new tenant permission and no new flag.
  - The 2b invitation is a third-mechanism credential that never maps into keys, claims or the resolver.
- **No Role Carries a Wildcard:**
  - `session_member` carries `roll.approve` only.
  - No template or baseline role holds both roll keys. A clerk who is also an elder holds them through two roles.
  - The fixture `stated_clerk` holding both is drift (F190), not a template.
- **Composite Tenant Keys:** no new tenant table. The 2b partial unique sits on the existing composite-keyed table.
- **Never hard-delete / all deletes are soft:** 0063 removes DELETE on `roll_actions`, and withdrawal replaces deletion.
- **The Brand Is a Cascade Override:** unaffected. Increment 2 is in `(org)`; 2b's acceptance stays in un-brandable `(invite)`.
- **Verify in a Browser / HydrationGate:** apply to the bulk worklist, the three dialogs, the Officers page changes and the 2b invite card, at 360px.

## Findings (new numbers requested)

- **F186:** `people.user_id`, the identity binding, can be updated by `presby_app` with no guard. Closed by R23 in 2b.
- **F187:** `presby_app` keeps INSERT, UPDATE and DELETE on `users`, which has no RLS (the F38 blanket-grant residue). It undermines the invitation email match. Closed by R24 in 2b. Use the existing number if this is already tracked.
- **F188:** G-3.0201's installed pastors and associate pastors are absent from the derived Session group. `installed_pastor` is used as an office in the seed but is missing from `OFFICER_OFFICES`, and `officer_terms.office` has no vocabulary CHECK. Closed by R10 and R11.
- **F189:** 6 of 9 congregations on the branch have no `session` derived group, so recording a ruling elder there raises a raw FK error. Closed by the 0062 group seed. Measure production.
- **F190:** fixture drift. The dev `stated_clerk` role holds both `roll.propose` and `roll.approve`, and the dev `session_member` holds `directory.view`. Neither is a template. Fix at integration or record it.
- **F191:** 0061's restrictive insert policy allows `presby_app` to insert a **pending** `void`, loss or `opening_balance` row. No definer will ever approve it, and it blocks the person through `pending_action`. With R7 it would also block every proposal. Closed by 0063's narrowed policy.

## Suggestions (Phase 3's call)

- **S1:** A BEFORE INSERT OR UPDATE trigger on `officer_terms` that refuses a pastor office for a person with a non-null `current_roll` at the org. This turns R11's app check into a database property.
- **S2:** Show "Self-recorded" on the Session roster row and "Self-approved" in Recently decided, matching DECISION-188's "Self-designated" marker.
- **S3:** A "Clergy" anchor connection in the wizard, instead of sending pastors through the staff anchor path.
- **S4:** Have the Flow 7 reader count Session members (elders plus pastors) and linked accounts in one query, and use "members of the Session" in the copy rather than "elders".
- **S5:** A follow-up to reconcile a congregation's pastor term against a *published* presbytery appointment, once DECISION-112's publication mechanism exists.

## Notes (Phase 3 must honour)

Measure these read-only before any DDL:
1. production congregations without a `session` or `diaconate` group;
2. production org-owned `session_member` roles;
3. role grants bound to Session groups;
4. distinct `officer_terms.office` values;
5. pending duplicates per person;
6. every writer of `people.user_id` and of `users` on the `presby_app` side (for 2b).

Pin these by test:
- `APPROVABLE_ROLL_ACTION_KINDS` against both the decide function and 0063's insert policy;
- `SESSION_OFFICES` against the trigger CASE;
- both refusal vocabularies against the SQL literals.

Run the from-scratch install check Increment 1 deferred, on a throwaway branch, before 0062 is applied.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 2 — Architectural review | architect | Complete. R1–R18 for Increment 2, including pastors as Session members. Invites split to Increment 2b with limits R19–R26. Migrations 0062, 0063 and 0064 requested; DECISION-202–208; F186–F191 | Approved with suggestions | 2026-10-22 |

## Handoff

Next agent: **tech-lead (Increment 2, Phase 3)**. Design to R1–R18, rule on S1–S5, and take the measurements listed under Notes first. The operator's confirmation of the pastor default (DECISION-206) should be on record before Phase 4; R10 is easy to remove if it is declined.

The orchestrator should also:
- reserve migrations 0062, 0063 and 0064, DECISION-206–208 and F186–F191, and move Increment 3 to DECISION-209 and F192 onward;
- open a short **analyst Phase 1 addendum for Increment 2b**: flows for issue, resend, revoke and accept, already-linked, wrong address and deceased, plus copy. 2b's Phase 3 then designs to R19–R26.

I wrote nothing. The only database access was read-only queries against the pipeline branch (`ep-jolly-boat-axklya0l`, with `default_transaction_read_only=on`). Nothing touched production or `development`.

Files and catalog read (all under `/Users/cshenso/git/presby-platform/presby-fadir`):
- `docs/work-log/2026-10-22-founding-admin-directory.md`
- `docs/work-log/_template.md`
- `docs/decisions.md` (DECISION-183 to 196)
- `docs/schema-design.md` (D1, §B, §E, Staff)
- `drizzle/0044_presby_org_lifecycle.sql`
- `drizzle/0059_presby_account_invitations.sql`
- `src/lib/roll.ts`
- `src/lib/roll-action-kinds.ts`
- `src/lib/officers.ts`
- `src/lib/credentials.ts`
- `src/lib/org-provisioning.ts`
- `src/lib/authz.ts`
- `src/lib/db/domain/officers.ts`
- `scripts/seed-dev.sql`
- Live catalog: `presby_sync_derived_group`, `presby_guard_membership_insert`, `presby_guard_position_needs_membership`, `presby_officer_roster`, `presby_roll_changes`, the `presby_effective_roll_actions` view, the `roll_actions` columns, constraints, partial indexes, policies and freeze trigger, the `officer_terms` constraints and triggers, `aclexplode` grants for `presby_app`, RLS flags, derived-group counts by org type, and role bindings.

Sources:
- [The Session and the New Form of Government (PC(USA))](https://pcusa.org/sites/default/files/nfog-session.pdf)


---

# Increment 2 — Phase 3: Technical Design (tech-lead)

*Written 2026-10-22 by tech-lead against the live tree of the `presby-fadir` worktree (which carries Increment 1's committed code; Phase 4 re-bases onto post-Increment-1 `main`) and a read-only measurement of the pipeline Neon branch (`ep-jolly-boat-axklya0l`, owner connection, `default_transaction_read_only = on`; nothing was written, nothing touched production or `development`). Designed to R1-R18; S1-S5 ruled below. Increment 2b (R19-R26) is not designed here. No Rule 16 shared file is edited; every edit to one is staged for the orchestrator (see Integration hand-offs). No implementation code is written.*

**Two facts on record at kickoff.** (1) DECISION-206 (installed and associate pastors count as Session members) is **pending operator confirmation**; every pastor-specific artifact is isolated so it drops cleanly (see "If DECISION-206 is declined"). (2) The from-scratch install check that Increment 1 deferred (Batch A deviation 6) **is being run by QA for Increment 1 now**; its result is an input to Batch A's gate here, and is not duplicated.

## Summary

Give a congregation a Session that can actually decide what the clerk proposes. Migration **0062** (additive) adds the decision columns, a `withdrawn` status, terminal-state freezing for decided rows, one pending proposal per person, a constitutional `session_member` role (`roll.approve` only) bound to every congregation's derived Session group (seeding the missing court groups first), installed pastors, co-pastors and associate pastors as Session members (the derived-group CASE, an office vocabulary CHECK, a no-roll guard), and three `SECURITY DEFINER` functions: `presby_decide_roll_action` (approve or deny), `presby_withdraw_roll_action`, plus their actor helper. The application's approve, deny and new withdraw paths become thin callers of those functions, each writing its audit row in the same transaction. Migration **0063** (lockdown, applied only after the code deploys) revokes `UPDATE` and `DELETE` on `roll_actions` from `presby_app` and narrows the insert policy to the seven approvable gain kinds. The pending page becomes a queue for everyone who proposes or approves (read-only mode for proposers), with bulk approve (50 per submit, one transaction per row), a "Recently decided" history with reasons, withdrawal, and honest copy for the five states in which the Session cannot yet act. The Community header gets an "N waiting" link; the Officers page learns the pastor offices and shows who recorded themselves. Sign-in invitations for elders are Increment 2b and are not built here.

## Rulings on S1-S5

| # | Ruling | Why, and the consequence |
|---|---|---|
| S1 | **Adopt, scoped to open terms.** `officer_terms_pastor_no_roll`, a `BEFORE INSERT OR UPDATE OF person_id, office` trigger (function `presby_guard_pastor_no_roll`, `SECURITY DEFINER`, pinned `search_path`, reads by `new.organization_id`, F26 discipline) refuses a pastor-office term that is **open** (`ends_on is null or ends_on > current_date`) for a person whose roll as of `greatest(current_date, starts_on)` is non-null (`presby_roll_as_of`) or whose `memberships.current_roll` is non-null. | R11's app check becomes a database property. Limited to open terms because `presby_guard_position_needs_membership` already states the rule that importing history for someone who has since joined is legitimate; not fired on `ends_on` updates so ending a term can never fail because the person later acquired a roll. TypeScript pre-checks and returns the typed `on_roll`; the trigger's `check_violation` is mapped to the same result as the race backstop. |
| S2 | **Adopt.** "Self-recorded" on Session-office roster rows and "Self-approved" in Recently decided. | Both are derived without a join to `audit_events`: roster `selfRecorded` = `officer_terms.recorded_by` equals the person's `user_id`; decided `selfDecided` = `proposed_by` equals `coalesce(decided_by, approved_by)`. Matches DECISION-188's "Self-designated" marker. |
| S3 | **Decline here; file a TODO.** No "Clergy" connection in the wizard. | It is a fourth Connection arm with an engagement value and an amendment to DECISION-200, for a record made once per congregation. The staff anchor path exists (Staff page, "Add a new person"; the anchor then appears in the Officers add-term list, which lists every current membership). The Officers page says so in words. Visitor and Participant remain wrong anchors for a pastor; the database cannot tell, so this is copy and documentation only. |
| S4 | **Adopt.** One query returns Session seats, accounts and approvers; copy says "members of the Session". | `getSessionApprovalState()` (below). Counts only, no names. |
| S5 | **Adopt as a TODO.** | Reconciling a congregation's pastor term against a published presbytery appointment waits for DECISION-112's publication mechanism. |

## Refinements to Phase 2's R-numbers (for the architect and operator to see)

Each is a feasibility finding or a gap, not a change of direction. Where a refinement departs from the architect's literal wording, it is marked **departs**.

1. **R5 backfill of `decided_by` and `decided_at` on approved rows is dropped (departs).** `presby_freeze_approved_roll_action` freezes approved rows, and a migration must not disable an append-only trigger to write metadata. Readers use `coalesce(decided_by, approved_by)` and `coalesce(decided_at, approved_on::timestamptz)`. The definer sets both columns on every new decision. Measured: all 28 approved rows on the branch have a null `approved_by` (seed rows), so a backfill would have had nothing to copy.
2. **R5's third CHECK moves from 0062 to 0063 (departs).** `roll_actions_terminal_decision_stamps` (denied and withdrawn rows carry `decided_by` and `decided_at`) would refuse the old code's deny `UPDATE` (it sets neither) in the window between 0062 and the code deploy, which breaks 0062's "old code keeps working" property. In 0063 it is safe, and 0063 stops with a counted error if a legacy denied row lacks the stamps (backfill by a human from the `tenant.roll_action.denied` audit rows). The other two R5 CHECKs stay in 0062 because old code satisfies them.
3. **`APPROVABLE_ROLL_ACTION_KINDS` is the seven gain kinds, excluding `other_participant_enrolled` (departs from R3's "non-null mapped" wording by one kind).** Participant enrolment is on-record only (Increment 1 R4: the kind alone decides). A pending participant row can no longer be inserted (0063 policy) and, if a legacy one exists, cannot be approved (`not_approvable_kind`) but **can** be denied or withdrawn: deny and withdraw accept any pending kind so junk is cleaned up softly. TypeScript derives the list as `EDIT_TIME_ROLL_ACTION_KINDS` minus `ON_RECORD_ROLL_ACTION_KINDS`, pinned to both SQL lists.
4. **Two outcomes added to the closed vocabulary:** `invalid_decision` (the function's own input guard) and `minute_reference_too_long` (R4 bounds the minute reference at 200 in the database too).
5. **R13: officer-term start and end audit moves in-transaction for every office, not only Session and diaconate ones.** One path per audit key. The end-term audit today reads `personId` and `office` from **client input** (`endOfficerTermAction`'s `input`); the lib now reads them from the row, so the audit metadata is no longer client-supplied. `selfRecorded` is stamped on both start and end.
6. **R6 is implemented as two checks** (replay-as-of equals the row's `resulting_roll`; the next effective row has the same `resulting_roll` and is a counted gain kind), with `COUNTED_GAIN_KINDS` = `profession_of_faith`, `reaffirmation`, `restoration`, `certificate_received`, `other_gain`, the five kinds `presby_roll_changes` counts. A source scan pins the list against that function's live definition.
7. **R12 covers approval only.** A pastor-office holder can still be enrolled as an *other participant* on record (Increment 1 path). That carries no member-roll effect and Session approval is about members; closing it means re-creating Increment 1's record function. **Accepted residual**, filed in the TODO hand-off, not a numbered finding.
8. **No admin-hub tile for the queue.** `visible-tiles.ts` shows tiles by flag and never by permission, so a second tile on the same toggle adds a forbidden page behind a visible tile for everyone without the keys. The entry point is the Community header link plus the person's edit page. (The analyst's verb list said "from Community or the admin hub".)
9. **`personId` is added to the approve, deny and withdraw audit metadata** (ids only) so the action can revalidate the person's edit page.
10. **Legacy `roll_actions_one_live_void_idx` predicate** changes to `approval_status in ('pending','approved')` (R1d), and the Drizzle mirror at `src/lib/db/domain/roll.ts` follows.

## Measurements

Pipeline branch, read-only, 2026-10-22, plus the orchestrator's production counts (not re-measured).

1. **Organizations (branch):** 24 (1 synod, 5 presbyteries, 18 congregations). 9 of the 18 congregations carry `deletable_until` (leftover test fixtures at measurement time). Of the 9 non-fixture congregations, **6 have no `session` derived group and 7 have no `diaconate` group** (F189 reproduced; Phase 2 said 6 of 9 lacked Session). Every organization has an `active_membership` group except 3 presbyteries and the synod.
2. **Production (orchestrator):** 1 congregation, 1 non-congregation; 0 congregations without a session or diaconate group; 0 org-owned `session_member` roles; 0 role grants bound to session or diaconate groups; 0 `officer_terms` (so the distinct office set is empty); 0 `roll_actions` (so 0 pending duplicates); 1 person linked to a user; 70 `users` rows. The 0062 header records these as counts with no slug.
3. **`roll_actions` (branch):** 29 rows. Approved 28 (24 `opening_balance`, 1 `baptized_member_enrolled`, 1 `other_participant_enrolled`, 1 `certificate_dismissed`, 1 `void`), pending 1 (`profession_of_faith`), denied 0. Pending duplicates per person 0. Rows with `denial_reason` outside a denied row 0. 0061 is applied on the branch (CHECKs, the S3 index and the restrictive insert policy are live).
4. **Roles (branch):** one org-owned `session_member` (Alder Creek fixture, `directory.view` + `roll.approve`), one org-owned `stated_clerk` holding **both** roll keys (F190 drift), and the clerk template (`directory.view`, `roll.propose`, `statistics.publish`; Increment 1's 0061). Role grants bound to groups: session 1, diaconate 1, active_membership 2. Production has none of the first two.
5. **`officer_terms` (branch):** `clerk_of_session` 2, `deacon` 5, `installed_pastor` 1, `ruling_elder` 3, `treasurer` 1: all inside the new vocabulary. The one pastor term sits on a congregation membership with `current_roll` null, `engagement_status` `regular`, at a congregation that has a Session group. `scripts/seed-dev.sql` and `scripts/test-rls.sql` insert only `ruling_elder`, `deacon`, `treasurer`, `trustee` and `installed_pastor`; `src/lib/officers.test.ts:765` uses `bishop` and throws before the database. No e2e file inserts an office.
6. **`presby_app` on `roll_actions`:** `SELECT`, `INSERT`, `UPDATE`, `DELETE` (to be reduced). **The only application writers:** `src/lib/roll.ts:135` (the decide `UPDATE`, to be removed), `src/lib/roll.ts:848` and `src/lib/people.ts:692` (pending inserts, which stay). The only database functions that write `roll_actions` are Increment 1's two definers (both owner, `rolbypassrls`). `e2e/support/community-fixture.ts` writes through the owner connection. This is the 0063 safety proof, and a source scan pins it.
7. **Triggers and policies:** `roll_actions_freeze` (BEFORE UPDATE OR DELETE, freezes `approved` only), `roll_actions_sync_current` (AFTER INSERT OR UPDATE; an `UPDATE` to `approved` fires it, so approval projects `current_roll`), policies `tenant_isolation` and the restrictive `roll_actions_insert_pending_only` (`approval_status = 'pending'`). `presby_sync_derived_group()` is **not** `SECURITY DEFINER` (invoker) and maps only `ruling_elder` and `deacon`; its error text for a missing group is `organization % has no derived group %`. `groups` has `unique (organization_id, derived_from)`, so the seed is idempotent with `on conflict`. `app_roles` has `unique (organization_id, key)`.
8. **`memberships_one_active_roll_idx`** is `unique (person_id) where current_roll = 'active' and ended_on is null`: global across organizations, raised inside `presby_sync_current_roll`'s `UPDATE` of `memberships`. Both the error's constraint name and the index name are the same string, so the definer can discriminate with `get stacked diagnostics ... constraint_name`.
9. **`presby_roll_changes` counts five gain kinds** (`profession_of_faith`, `reaffirmation`, `restoration` in the two profession lines; `certificate_received`; `other_gain`). It does not count `baptized_member_enrolled`, `affiliate_received` or `other_participant_enrolled`. `presby_roll_as_of` uses `effective_date <= as_of`, ordered by `effective_date desc, recorded_at desc`. `recorded_at` is not changed by a decision, so an approved proposal keeps its proposal-time place in replay order.
10. **FK and guard facts:** `officer_terms_needs_membership` (BEFORE UPDATE OF person_id, ends_on) only raises for a term still open past a membership end, so the migration's no-op touch of existing pastor terms is safe. `role_grants_needs_membership` ignores group-arm grants. `app_role_permissions_giving_guard` ignores non-giving keys. `users` has `is_active`; `people.user_id` is not unique.
11. **Existing fixtures read against the new constraints** (Feasibility below): `scripts/test-rls.sql` section 5 sets `denial_reason = 'editable'` on a **pending** row (line ~275), which the new `denial_reason` CHECK refuses. The one place a shipped fixture contradicts a new constraint.
12. **e2e:** no spec references the pending page. The one existing spec the design breaks is Increment 1's `e2e/community-participants.spec.ts:228` ("a member is a proposal that waits for the Session"): the e2e organization `alpha` has only an `active_membership` group, so R15 hides the Member choice there (Test Plan 3).
13. **`check:audit`** inspects only `db.*` calls inside `actions.ts`; the actions call lib functions, so the tripwire passes vacuously and audit coverage is proven by tests (Test Plan 1.8).

## Feasibility check against the live tree

- **Signatures are valid SQL.** No function takes a default, so no default-before-required problem. OUT column names are chosen not to collide with `roll_actions` columns (`action_kind`, `action_effective_date`, `subject_person_id`), and the bodies carry `#variable_conflict use_column` as 0061's do.
- **`ALTER`/`DROP`:** `roll_actions_approval_status_allowed` and `roll_actions_one_live_void_idx` are dropped and re-created; no `SECURITY DEFINER` body names either (`presby_void_participant_action` catches `unique_violation` generically, `presby_effective_roll_actions` keys on `= 'approved'`), so no caller breaks silently. `presby_freeze_approved_roll_action` and `presby_sync_derived_group` are `create or replace` with the same signature, language and security mode (the latter stays invoker). No column or table is dropped.
- **New CHECKs and triggers against fixtures:** `officer_terms_office_allowed` against `seed-dev.sql`, `test-rls.sql`, every Vitest fixture and the branch's rows: passes (Measurement 5). `roll_actions_denial_reason_only_when_denied` against the same: **fails one assertion** (Measurement 11), staged in the patch. `roll_actions_one_pending_per_person_idx` against the seed (one pending row) and test-rls: re-read `scripts/participants/test-rls-61.sql` section 61b for two pending inserts for one person inside a single transaction. The S1 trigger against the seed: Rowan Thistlewood's term is inserted with no roll, so it passes.
- **New FK:** one, `decided_by -> users(id)`, a single-column FK to a non-tenant table (the same shape as `approved_by` and `proposed_by`). No tenant table is added, and no composite tenant key is involved. Every query in the new functions names `organization_id` explicitly on `roll_actions`, `memberships`, `officer_terms` and `groups`.
- **Dependency inside a function body (0063):** `person_milestones.roll_action_id` references `roll_actions`. Referential-integrity checks run as the owner of the tables, not `presby_app`, so revoking `presby_app`'s `UPDATE` and `DELETE` does not break a milestone insert. Batch A proves it with a one-line DB test (a milestone insert as `presby_app` after 0063), since Postgres tracks no such dependency.
- **Seeding order inside 0062:** the Session group must exist before the pastor terms are touched (the replaced trigger function raises `foreign_key_violation` when its target group is missing), and the function must be replaced before the CHECK and the touch. The file's section order is fixed accordingly.
- **Migration ordering with 0061:** 0062 re-creates `roll_actions_approval_status_allowed`, which 0061 also drops and re-adds. Applying 0061 after 0062 would clobber the `withdrawn` vocabulary. Strict order `0061 < 0062 < 0063`; never reordered.
- **Seed side effect:** once pastors map to the Session group, Alder Creek's seeded installed pastor gets a derived Session row, and therefore (through the fixture `session_member` role) `roll.approve` and `directory.view` at Alder. The implementer greps `scripts/test-rls.sql` and Vitest for assertions about the Alder Session roster or Rowan's effective permission set (the `c0000000-0000-0000-0000-000000000006` id) and re-reads each.

## Permissions & Flags

- **Permission keys:** no new key, no new `FEATURES.*` entry (`src/lib/permissions.ts` stays frozen), no new tenant permission. Used, all tier 1: `roll.approve` (approve, deny, the decide mode of the queue), `roll.propose` (withdraw, the read mode of the queue, the "N waiting" link, proposals), `officers.manage` (record Session offices, the Flow 7 link to Officers), `people.manage` (person-record links in the queue).
- **Read gate widens** from `roll.approve` to `roll.approve` **or** `roll.propose` for `listPendingRollActions`, `listRecentlyDecidedRollActions`, `countPendingRollActions` and `getSessionApprovalState`. A viewer with neither gets the unchanged forbidden body.
- **Default bindings:** the baseline `session_member` role (`roll.approve` **only**) is seeded at congregation provisioning and backfilled by 0062; it is constitutional and protected, bound to the derived `session` group by group-arm `role_grants`. No role, template or baseline, carries both roll keys. A clerk who is also an elder holds both through two roles. The founding-administrator bundle and the clerk template are unchanged. The dev fixture `stated_clerk` carrying both keys is drift (F190), recorded and not fixed here.
- **Flags:** none new (operator memory: per-org toggles, no new platform flags before go-live). Existing `org_portal.members_create` plus its toggle still gates the pending page, so turning the Community toggle off also hides the queue (named in DECISION-204).
- **Rollback:** 0062's role and grant are data: end the grant with `ends_on`, never delete. The functions, trigger, indexes and CHECKs are droppable. 0063's rollback is `grant update, delete on roll_actions to presby_app` plus re-creating the 0061 policy text; the header of 0063 says a **code rollback alone does not undo 0063** (old deny and approve would fail on the privilege).

## API Contract

### SQL: 0062 (Batch A)

Both decision functions: `language plpgsql security definer set search_path = public, pg_temp`, `#variable_conflict use_column`, `revoke all ... from public`, `grant execute ... to presby_app` only. The organization is `presby_current_org()` (no parameter, R2 of Phase 2 Increment 1's shape); a null organization raises. Each returns **exactly one row** (`return next; return;`); on a non-`ok` outcome the id columns are null and the booleans false.

```sql
create or replace function presby_decide_roll_action(
  p_roll_action_id uuid, p_decision text, p_minute_reference text,
  p_reason text, p_decided_by uuid)
returns table (outcome text, roll_action_id uuid, subject_person_id uuid,
               action_kind text, action_effective_date date,
               affects_filed_period boolean,
               shadowed_by_kind text, shadowed_by_date date,
               self_approved boolean, self_target boolean)

create or replace function presby_withdraw_roll_action(
  p_roll_action_id uuid, p_reason text, p_withdrawn_by uuid)
returns table (outcome text, roll_action_id uuid, subject_person_id uuid,
               action_kind text, action_effective_date date, self_proposed boolean)
```

Helpers:

- `presby_deny_roll_decision()`: returns void, invoker, raises the one literal `'roll_actions: this roll decision is not permitted'` with errcode `insufficient_privilege` (the 0052 and 0061 shape; execute granted to `presby_app` so a non-owner caller never sees a second "permission denied" string). A different literal from 0061's, so an audit reader can tell an approval refusal from a participant refusal.
- `presby_roll__actor_holds(p_org uuid, p_user_id uuid, p_key text) returns boolean` (stable, definer, pinned `search_path`, no grant): `exists` a live (`merged_into_id is null`) person with `user_id = p_user_id`, `presby_membership_is_active(person, p_org)` and `presby_has_permission(person, p_org, p_key)`. The generalization Phase 2 allowed. 0061's `presby_participant__actor_may_propose` is left as is (never edit 0061).

**Identity refusals** (uniform literal, reveal nothing): no organization, null actor, actor fails the helper (`roll.approve` for decide, `roll.propose` for withdraw). **State refusals** are returned as typed outcomes. Checks run in the order listed; the first failing wins.

**Decide outcomes** (`ok` plus fourteen refusals; closed list pinned to TypeScript `ROLL_DECISION_REFUSALS` by a source scan):

| Outcome | When |
|---|---|
| `ok` | Written. |
| `invalid_decision` | `p_decision` is not `approve` or `deny`. |
| `reason_required` | Deny, and `btrim(p_reason)` is empty. |
| `reason_too_long` | Deny, over 500 characters after trimming. |
| `minute_reference_too_long` | Approve, over 200 characters after trimming (blank becomes null). |
| `not_found` | No row with that id at this organization (another organization's id is indistinguishable, because the function reads with `organization_id = v_org` explicitly; the definer bypasses RLS, so that predicate is the whole isolation). |
| `already_decided` | The row is not pending (re-checked under the lock). |
| `not_approvable_kind` | Approve, and the kind is not one of the seven approvable gain kinds. |
| `person_deceased` | Approve, `people.date_of_death` is set. |
| `person_merged` | Approve, `people.merged_into_id` is set. |
| `membership_ended` | Approve, `memberships.ended_on` is set. |
| `holds_pastoral_office` | Approve, an open pastor-office term exists (R12; `ends_on is null or ends_on > current_date`). |
| `already_on_roll` | Approve; R6 either direction (below). |
| `active_elsewhere` | Approve; `unique_violation` on `memberships_one_active_roll_idx`. Generic copy, never names the other organization. |
| `provisioning_incomplete` | Approve; `foreign_key_violation` whose message contains `has no derived group active_membership` (S4 of Increment 1); anything else re-raises. |

Deny applies only: identity, `invalid_decision`, the reason bounds, `not_found`, `already_decided`. A deny never checks the person's state, so a proposal for an ended or deceased person can always be denied.

**Lock order (R2):** read the roll row by `id` and `organization_id` to learn the person; `select ... from memberships where person_id = ... and organization_id = v_org for update`; re-read the roll row `for update`; re-check pending. Approve then: kind, deceased, merged, ended, pastoral office, R6 (a) the person's replay roll as of the row's `effective_date` (`presby_roll_as_of`, the row is pending so it is not in the view) is not distinct from its `resulting_roll`; (b) the next effective row after it (`(effective_date, recorded_at)` greater, ascending) has the same `resulting_roll` and a kind in `COUNTED_GAIN_KINDS`. Then the shadow calculation (the **latest** effective row sorting after it, the one the cache will project; a warning only), then the `UPDATE` in a sub-block (savepoint) that catches the two exceptions above.

Writes on approve: `approval_status = 'approved'`, `approved_by = p_decided_by`, `approved_on = current_date`, `decided_by = p_decided_by`, `decided_at = now()`, `minute_reference = coalesce(nullif(btrim(p_minute_reference), ''), minute_reference)` (a supplied reference overwrites the proposer's; omitted leaves it). On deny: `approval_status = 'denied'`, `denial_reason`, `decided_by`, `decided_at`. `self_approved` = `proposed_by` is not null and equals `p_decided_by`. `self_target` = the target person's `user_id` equals `p_decided_by`. `affects_filed_period` uses 0061's predicate with the row's `effective_date` as the pivot.

**Withdraw outcomes** (`ok` plus four refusals, pinned to `ROLL_WITHDRAW_REFUSALS`): `reason_required`, `reason_too_long` (1-500 after trimming), `not_found`, `already_decided`. Same lock order. Writes `approval_status = 'withdrawn'`, `withdrawal_reason`, `decided_by`, `decided_at`; `self_proposed` = `proposed_by` equals `p_withdrawn_by`. Withdraw has no state checks: a proposal for an ended or deceased person can be withdrawn.

**Other 0062 SQL objects:**

- `presby_freeze_approved_roll_action()` replaced: the existing `approved` branch and its message are unchanged (existing tests match the message); a new branch refuses `UPDATE` and `DELETE` when `old.approval_status in ('denied','withdrawn')` with errcode `check_violation` and a message naming "decided actions are immutable". A pending row's `DELETE` stays allowed for the owner (fixtures, cascade); `presby_app` loses it in 0063. This binds the owner too.
- `presby_sync_derived_group()` replaced with the CASE `'ruling_elder','installed_pastor','co_pastor','associate_pastor' -> 'session'`, `'deacon' -> 'diaconate'`. Still invoker. `moderator` stays unmapped.
- `presby_guard_pastor_no_roll()` and trigger `officer_terms_pastor_no_roll` (S1).

### SQL: 0063 (Batch A authors; Batch B applies for real)

- A stop-block: any `denied` or `withdrawn` row lacking `decided_by` or `decided_at` raises with the count (a human backfills from the audit rows; the migration never invents an actor).
- `roll_actions_terminal_decision_stamps` CHECK: `approval_status not in ('denied','withdrawn') or (decided_by is not null and decided_at is not null)`.
- `revoke update, delete on roll_actions from presby_app`.
- `roll_actions_insert_pending_only` re-created: `approval_status = 'pending' and kind in ('profession_of_faith','reaffirmation','restoration','certificate_received','other_gain','baptized_member_enrolled','affiliate_received')` (F191; pending void, loss, `opening_balance` and `other_participant_enrolled` rows can no longer be inserted by the application).

### Pure shared modules (no `server-only`)

- `src/lib/roll-action-kinds.ts` gains `APPROVABLE_ROLL_ACTION_KINDS`, `COUNTED_GAIN_KINDS`, `ROLL_DECISION_REFUSALS`, `ROLL_WITHDRAW_REFUSALS`, `PROPOSAL_REFUSALS = ['no_session','pending_exists']` and their union types, each pinned to the SQL literals.
- **New `src/lib/officer-offices.ts`** (pure): the single home of `OFFICER_OFFICES`, `OFFICE_LABELS`, `SESSION_OFFICES` (`ruling_elder`, `installed_pastor`, `co_pastor`, `associate_pastor`), `PASTOR_OFFICES` and `isSessionOffice()`. `officers.ts` and `admin/officers/office-labels.ts` both re-export from it, which removes the documented duplicate (the three new offices would otherwise be added in three places). The array order is presentational; the pastor offices follow `ruling_elder`.

### Library (Batch B, `api-developer`)

`src/lib/roll.ts` (roll mutations stay here; the only file that names the two new functions; a source scan pins it). Every function is one `withOrgContext` transaction, permission pre-checked first, typed results, UUID shape validated before the database (a malformed id is `not_found`), non-`ok` results abort the transaction by an internal throw (the `ParticipantAbort` lesson: an early return from `db.transaction()` commits). `isIdentityRefusal(err, literal)` takes the literal, so both families share it.

```ts
export interface DecisionOptions { actingUserEmail?: string | null }

export type ApproveRollActionResult =
  | { kind: "ok"; rollActionId: string; personId: string; rollKind: RollActionKind;
      effectiveDate: string; affectsFiledPeriod: boolean;
      shadowedBy: { kind: RollActionKind; effectiveDate: string } | null;
      selfApproved: boolean; selfTarget: boolean }
  | { kind: "forbidden" } | { kind: "refused"; reason: RollDecisionRefusal };
export type DenyRollActionResult =
  | { kind: "ok"; rollActionId: string; personId: string }
  | { kind: "forbidden" } | { kind: "refused"; reason: RollDecisionRefusal };
export type WithdrawRollActionResult =
  | { kind: "ok"; rollActionId: string; personId: string; selfProposed: boolean }
  | { kind: "forbidden" } | { kind: "refused"; reason: RollWithdrawRefusal };

approveRollAction(actingPersonId, organizationId, actingUserId, rollActionId, input: { minuteReference?: string }, opts?)
denyRollAction(actingPersonId, organizationId, actingUserId, rollActionId, input: { reason: string }, opts?)   // actingUserId is NEW
withdrawRollAction(actingPersonId, organizationId, actingUserId, rollActionId, input: { reason: string }, opts?)

export const BULK_APPROVE_MAX = 50;
export type ApproveRollActionsResult =
  | { kind: "ok"; results: Array<{ rollActionId: string; result: ApproveRollActionResult }>;
      approved: number; needAttention: number }
  | { kind: "forbidden" } | { kind: "too_many" } | { kind: "empty" };
approveRollActions(actingPersonId, organizationId, actingUserId, input: { rollActionIds: string[]; minuteReference?: string }, opts?)
```

- **Audit (R13), `insertAuditRow()` in the same transaction, never `recordAudit()`:** `ROLL_ACTION_APPROVED` metadata `organizationId, rollActionId, personId, kind, effectiveDate, minuteReference, selfApproved, selfTarget, affectsFiledPeriod, shadowedBy`; `ROLL_ACTION_DENIED` metadata `organizationId, rollActionId, personId, reason`; new `ROLL_ACTION_WITHDRAWN: "tenant.roll_action.withdrawn"` metadata `organizationId, rollActionId, personId, reason, selfProposed`. Ids only, no names (the reason is free text, as Increment 1's void reason is). A throw from the audit insert rolls the whole decision back (tested). `roll.ts` no longer imports `recordAudit`.
- **Bulk (R18):** at most 50 unique ids; sequential; **one transaction per row** (each a full `approveRollAction`), so no cross-row atomicity is claimed and no long transaction holds 50 membership locks. A `forbidden` on the first row stops the loop. Ordering cannot matter between rows because R7 allows one pending row per person.
- **Reads:**

```ts
export interface PendingRollAction {
  id: string; personId: string; personDisplayName: string; kind: RollActionKind;
  effectiveDate: string; minuteReference: string | null; proposedOn: string;
  proposedByIsViewer: boolean; membershipEnded: boolean; personDeceased: boolean;
}
export type ListPendingRollActionsResult =
  | { kind: "ok"; mode: "decide" | "read"; actions: PendingRollAction[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
      viewer: { canApprove: boolean; canPropose: boolean; canManagePeople: boolean } }
  | { kind: "forbidden" };
listPendingRollActions(viewerPersonId, organizationId, opts?: { page?: number; pageSize?: number })  // page size 50, the bulk cap

export interface DecidedRollAction {
  id: string; personId: string; personDisplayName: string; kind: RollActionKind;
  effectiveDate: string; status: "approved" | "denied" | "withdrawn";
  decidedOn: string; reason: string | null; minuteReference: string | null; selfDecided: boolean;
}
listRecentlyDecidedRollActions(viewerPersonId, organizationId, opts?: { limit?: number })  // default 25
countPendingRollActions(viewerPersonId, organizationId): Promise<{ kind: "ok"; count: number } | { kind: "forbidden" }>
```

`listRecentlyDecidedRollActions` returns approved rows only of the approvable kinds (so on-record participant rows, opening balances and voids never appear) plus every denied and withdrawn row, newest `coalesce(decided_at, approved_on::timestamptz)` first, dates cast `::text` (`check:sql-date`). Denial and withdrawal reasons are returned only because the whole function is gated on the two roll keys (the lib filters; RLS cannot do it per column). Names of `directory_hidden` people appear to these holders by design (DECISION-204).

```ts
export type SessionApprovalStateKind = "no_session" | "empty" | "no_sign_in" | "no_permission" | "ready";
export interface SessionApprovalState {
  kind: SessionApprovalStateKind;
  recorded: number;        // live Session seats (distinct persons, active membership, starts_on <= today, open)
  startingLater: number;   // seats starting after today
  nextStart: string | null;
  withAccount: number;     // of recorded: people.user_id is not null (never reads users)
  canApprove: number;      // of recorded with an account: presby_has_permission(roll.approve)
  viewer: { canApprove: boolean; canManageOfficers: boolean };
}
getSessionApprovalState(viewerPersonId, organizationId): Promise<{ kind: "ok"; state: SessionApprovalState } | { kind: "forbidden" }>
```

One SQL statement for the counts (S4), `count(distinct person_id)`, plus the viewer's two `presby_has_permission` calls in the same transaction. Derivation: no `session` group is `no_session`; `recorded = 0` and `startingLater = 0` is `empty`; `recorded = 0` with seats starting later, or `withAccount = 0`, is `no_sign_in`; `withAccount > 0` and `canApprove = 0` is `no_permission`; else `ready`. It counts Session seats only, so a viewer who can approve through some other role sees no banner (decide mode shows none except `no_session`).

- **Proposals (R7, R15):** `recordRollAction()` and `createPerson()` for a membership kind refuse `no_session` when the organization has no `session` derived group, and `pending_exists` when the person already has a pending row (a friendly pre-check plus a catch of `unique_violation` on `roll_actions_one_pending_per_person_idx` for the race). New result arm in both unions: `{ kind: "proposal_refused"; reason: ProposalRefusal }`. The participant-on-record path is unaffected.
- **`src/lib/officers.ts`:** `startOfficerTerm(viewer, org, actingUserId, input, opts?)` and `endOfficerTerm(viewer, org, actingUserId, input, opts?)` (the latter gains `actingUserId`) write `OFFICER_TERM_STARTED` / `OFFICER_TERM_ENDED` in the same transaction with `selfRecorded` (the target person's `user_id` equals the actor); the end audit reads `personId` and `office` from the row. `OfficersResult` gains `{ kind: "on_roll"; personName: string }` (a pastor office for a rolled person; S1's pre-check and trigger backstop) and `{ kind: "invalid_office_for_org"; officeLabel: string }` (a Session, pastor or diaconate office at an organization with no matching derived group, which today is a raw foreign-key error). `listOfficerRoster` adds `installed_pastor`, `co_pastor`, `associate_pastor` to its `all_offices` values list and returns `selfRecorded` for Session offices. Pastor offices are congregation-only.
- **`src/lib/org-provisioning.ts`:** `baselineRoleSeedPlan("congregation")` returns `member` plus `session_member` (name "Session member", `roll.approve` only, bound to `session`); `boundToDerivedFrom` widens to `"active_membership" | "session"`; every other type is unchanged. The DECISION-100 comment ("do not add a conditional branch pre-emptively") is rewritten to say the planned extension has now happened.

### Server actions (Batch B)

All follow the existing plumbing: `auth()` in the body, `resolveOrgContext()` re-run, `organizationId` and `personId` never from the client, `ActionResult<T>`, ids validated as UUIDs, reason 1-500 after trimming, minute reference at most 200, every refusal mapped through one copy table (a type error if a code lacks copy).

```ts
// community/pending/actions.ts
approveRollActionAction(slug, { rollActionId, minuteReference? }):
  ActionResult<{ rollActionId: string; effectiveDate: string; futureDated: boolean; affectsFiledPeriod: boolean;
                 shadowed: { kind: string; effectiveDate: string } | null; selfApproved: boolean }>
approveRollActionsAction(slug, { rollActionIds: string[]; minuteReference? }):
  ActionResult<{ approved: number; failed: Array<{ rollActionId: string; error: string }>;
                 affectsFiledPeriod: boolean; shadowedCount: number }>   // ok:true even on partial failure
denyRollActionAction(slug, { rollActionId, reason }): ActionResult<{ rollActionId: string }>
withdrawRollActionAction(slug, { rollActionId, reason }): ActionResult<{ rollActionId: string }>
```

`revalidatePath` on community, community/pending, directory, and (from the returned `personId`) the person's edit page. `endOfficerTermAction` drops the client-supplied `personId` and `office` from its input type (the call sites in `end-term-dialog.tsx` follow) and no longer calls `recordAudit`. `createPersonAction` and `recordRollActionAction` map `proposal_refused`.

## Data Model

**0062 `drizzle/0062_presby_session_approval.sql`**, hand-written, idempotent (every statement `if not exists`, `on conflict do nothing`, drop-then-add, `create or replace`, or a predicate that no longer matches once applied; applied twice end to end by the implementer, the second run changing no row), unreleased until shipped (corrected in place, never by editing 0061). The header records the production counts (Measurement 2, counts with no slug), the strict order `0061 < 0062 < 0063`, that the grant's `grant_reason` text is informational and must never be a discriminator (the 2026-10-22 purge), and the apply command `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0062_presby_session_approval.sql`. Sections, in this order:

1. **Preconditions (stop-blocks, counts only):** more than one pending row for any `(organization_id, person_id)`; any `officer_terms.office` outside the new vocabulary (the message lists distinct office strings, never a person).
2. **Columns:** `decided_by uuid` with FK `roll_actions_decided_by_users_id_fk`, `decided_at timestamptz`, `withdrawal_reason text`, all nullable. No backfill of approved rows (refinement 1).
3. **Vocabulary and reasons:** `roll_actions_approval_status_allowed` re-created with `('pending','approved','denied','withdrawn')`; `roll_actions_denial_reason_only_when_denied` (`denial_reason is null or approval_status = 'denied'`); `roll_actions_withdrawal_reason_only_when_withdrawn`; `roll_actions_one_live_void_idx` dropped and re-created `where kind = 'void' and approval_status in ('pending','approved')`.
4. **One pending per person (R7):** `create unique index if not exists roll_actions_one_pending_per_person_idx on roll_actions (organization_id, person_id) where approval_status = 'pending'`.
5. **Terminal rows (R8):** `presby_freeze_approved_roll_action()` replaced.
6. **Missing court groups (F189):** for every `organization_type = 'congregation'` organization, insert the missing `session` ("Session") and `diaconate` ("Board of Deacons") derived groups in the `groupSeedPlan` shape (court group type looked up by key, `membership_source = 'derived'`, `is_protected = true`, `on conflict (organization_id, derived_from) do nothing`). An empty derived group grants nothing until the congregation's own officer records fill it: provisioning, not authority.
7. **`session_member` backfill (DECISION-202):** one statement block: a CTE inserts, for each congregation that has a `session` group and **no org-owned `session_member`**, the role (`constitutional`, protected), its single `roll.approve` permission row, and a group-arm `role_grants` row to the Session group, all from the CTE's `returning` so a second run inserts nothing. It never modifies an existing org-owned `session_member` (0052 note 5). `grant_reason` is human text, `granted_by` null.
8. **Pastors (DECISION-206), one delimited block:** `presby_sync_derived_group()` replaced; `officer_terms_office_allowed` (nine values) added validated; the no-op touch `update officer_terms set ends_on = ends_on where office in ('installed_pastor','co_pastor','associate_pastor')` (re-fires the AFTER UPDATE trigger, so no direct `group_memberships` write); then `presby_guard_pastor_no_roll()` and its trigger (created after the touch).
9. **Functions and grants:** `presby_deny_roll_decision`, `presby_roll__actor_holds`, `presby_decide_roll_action`, `presby_withdraw_roll_action`, each followed by `revoke all ... from public` and the grants above.
10. **Comments** on every new object (the pinned source-scan strings live in the function bodies, not the comments).

**0063 `drizzle/0063_presby_roll_decide_lockdown.sql`**: as listed under the SQL contract. Header: apply only after the code that no longer updates or deletes `roll_actions` is deployed; the grep proof (Measurement 6); the rollback statements; a code rollback does not undo it.

**Drizzle mirror (`src/lib/db/domain/roll.ts`):** `decidedBy`, `decidedAt`, `withdrawalReason` columns; the status CHECK with `withdrawn`; the two reason CHECKs; the terminal-stamps CHECK (0063); the re-predicated void index; the new partial unique index. `src/lib/db/domain/officers.ts`: `check()` for `officer_terms_office_allowed`. Policies, functions and the trigger are SQL-only, as `tenant_isolation` already is. Regenerate the `/developer` reference (`npm run docs:erd`); `check:schema-parity` runs.

**Staged assets (Rule 16):** `scripts/session-approval/test-rls-62.sql` (standalone suite, must run as `presby_app`, header modelled on `scripts/participants/test-rls-61.sql`, integrated by `\ir session-approval/test-rls-62.sql`) and `scripts/session-approval/test-rls.sql.integration.patch` (a unified diff against **post-Increment-1** `scripts/test-rls.sql`, that is, with Increment 1's own patch already applied, so its line numbers will differ from the ones quoted here; the implementer anchors by content). No `seed-dev.sql` edit. `docs/schema-design.md` gets a section written in Batch A (not a Rule 16 file).

## Component / Page Plan

**Pages:** `community/pending/page.tsx` (rewritten), `community/page.tsx` (header link), `community/new/page.tsx`, `community/[id]/edit/page.tsx`, `admin/officers/page.tsx`.

**To create** (under `src/app/(org)/o/[slug]/admin/`):

- `community/pending/decision-copy.ts`: `DECISION_COPY` and `WITHDRAW_COPY` (`Record<refusal | "forbidden", string>`), plus the success and warning strings.
- `community/pending/session-state-banner.tsx` (server): the Flow 7 copy by state.
- `community/pending/recently-decided.tsx` (server): the history list.
- `community/pending/bulk-approve-dialog.tsx` (client): count, minute reference, per-row result panel.
- `community/withdraw-proposal-dialog.tsx` (client, shared by the queue and the edit page): `AlertDialog` (`src/components/ui/alert-dialog.tsx`, Rule 2), controlled state, no `useForm` (so `check:hydration-gate` does not apply and a hydration spec is the guard), trigger disabled until `useHydrated()`, 44px targets, reason required with a 500-character counter.
- `officers/session-note.tsx` (server): the Session explainer and the pastor helper text.
- `src/lib/officer-offices.ts` (pure, above).

**To modify:**

- `pending-worklist.tsx`: rows gain select checkboxes (decide mode only, 44px targets, disabled until hydrated), a "select all on this page" control, a sticky "Approve N" bar with bottom padding on the list so it never covers the last row, a Withdraw button per row for `roll.propose` holders, read mode (no Approve, Deny or checkboxes), badges "You proposed this", "Connection ended", "Recorded as deceased", and "Takes effect {date}" for future-dated rows. The existing Approve and Deny dialogs stay and gain the new copy and warnings.
- `pending/page.tsx`: widened gate (the lib decides), `?page=`, the three reads, the banner (read mode, or decide mode with state `no_session`), the list, Recently decided. Flag and toggle check unchanged.
- `community/page.tsx`: `countPendingRollActions`; a "Pending approvals" link (with "N waiting" when above zero) beside Add person for holders of either key.
- `[id]/edit/connection-card.tsx` and `page.tsx`: the pending notice gains a Withdraw button for `roll.propose` holders and, when the Session cannot act, a link "See why" to the queue. `record-roll-action-form.tsx`: copy for `pending_exists` and `no_session`.
- `new/page.tsx`, `new/connection-step.tsx`, `new/member-wizard.tsx`, `new/review-step.tsx`: the Member option shows only when `canProposeRoll` and the organization has a Session (`getSessionApprovalState`, called only when `canProposeRoll`); a note when it has none; the review note says the proposal waits when the Session cannot approve yet.
- `officers/officer-roster.tsx`: a "Self-recorded" marker on Session-office rows; the pastor offices in groups. `officers/add-officer-term-form.tsx`: the three offices, helper text when a pastor office is chosen, an inline note when the actor selects themselves for a Session office, the two new typed errors. `officers/page.tsx`: renders `SessionNote`. `officers/actions.ts`: audit removed, copy for the new results. `officers/office-labels.ts`: re-export.
- `src/lib/audit.ts` (the withdrawn key), `src/lib/org-provisioning.ts`, `src/lib/db/domain/roll.ts`, `src/lib/db/domain/officers.ts`, `src/lib/roll.ts`, `src/lib/officers.ts`, `src/lib/people.ts`, `src/lib/roll-action-kinds.ts`.

**Edit-page and Community stay consistent:** the "Waiting" badge and the Members filter are unchanged; approval moves a person to Members because `current_roll` is projected by the existing trigger and the lists derive from the roll first.

## Implementation Order and Batch Plan

Template order maps as: schema, catalog and bindings (A) then library and actions with in-transaction audit (B) then UI (C) then e2e (D) then release notes after SHIP IT. Batches are serial, each committed by explicit path (never `git add -A`), none pushed. **Rule 16:** no batch edits a shared file; staged assets are listed under Data Model and in the hand-offs.

| Batch | Scope | Implementer | Commit (prefix) | Gate |
|---|---|---|---|---|
| **A** | 0062 and 0063 files, Drizzle mirrors, `session-approval.db.test.ts`, `roll-decide-lockdown.db.test.ts`, the staged section 62 suite and integration patch, fixes to the Increment 1 assertions 0063 changes, `docs/schema-design.md` section, `npm run docs:erd`. | `database-admin` | `feat(db): session approval, withdrawal and the Session role (0062, 0063)` | Apply **0062** to the pipeline branch twice (second run changes no row; before and after snapshots of row counts and md5 digests of `roll_actions`, `app_roles`, `app_role_permissions`, `role_grants`, `groups`, `group_memberships`). Prove **0063** inside a rolled-back owner transaction (apply its text, assert privileges, policy text, the CHECK and the stop-block, roll back) so the branch stays at the 0062 state the legacy code can still run against. The from-scratch install check (migrations from empty, then `db:seed`, then `0062`, `0063`) on a throwaway Neon branch, folding in the result QA reports for Increment 1. DB-backed Vitest serially. `scripts/session-approval/test-rls-62.sql` as `presby_app`. `check:schema-parity`, typecheck. The legacy approve and deny tests in `roll.test.ts` are Batch B's and are named in the hand-off. |
| **B** | Pure modules, `roll.ts` (decide, deny, withdraw, bulk, readers, `no_session`, `pending_exists`), `officers.ts` (offices, in-transaction audit, typed refusals), `officer-offices.ts`, provisioning plan, audit key, server actions, copy tables, lib and action tests. | `api-developer` | `feat(roll): approve, deny and withdraw through the database; Session roster and pastor offices` | **Applies 0063 to the branch (twice) before running its DB gate**, so the rewritten freeze and delete tests run against the lockdown state. Unit and DB tests, typecheck, `npm run check` (`check:audit` passes vacuously, Measurement 13), the audit-in-transaction rollback tests, every source scan in Test Plan 1.9. |
| **C** | Pending page, worklist, bulk and withdraw dialogs, banner, history, Community header link, edit-page and wizard changes, Officers page, component tests. | `ux-developer` | `feat(community): pending queue, bulk approve, withdraw and Session notes` | RTL tests, `check:hydration-gate`, typecheck, lint, build, and the 360px browser pass (Test Plan 5). |
| **D** | e2e: fixture, approval spec, hydration spec, the one Increment 1 spec fixed; the whole suite re-run. | `ux-developer` | `test(community): e2e for approval, bulk, withdraw and read-only queue` | Full `npm run test:e2e` against a real dev server; `test:e2e:prod` for the hydration spec. |

A single implementer for A and B was considered and rejected: the migration, the definer functions and their tests are the security core and should be reviewable apart from the library.

**Phase 4 kickoff checklist (cannot start until Increment 1 merges to `main`):** rebase onto post-Increment-1 `main`; re-check 0062 and 0063 against `main` (0064 stays reserved for 2b); record the operator's answer on DECISION-206 (if declined, strip the pastor artifacts before Batch A); read QA's from-scratch result for Increment 1; re-derive every `test-rls.sql` anchor against the patched file.

**Deploy order (R16, deliberately the reverse of Increment 1):** `0062` first (old code keeps working: deny and approve updates still pass, the new columns are nullable, the new constraints are satisfied by old code, the only visible change is that a second pending proposal for one person fails), then the code, then `0063`. Wrong orders fail loudly: code before 0062 calls a missing function; 0063 before the code makes the old deny and approve fail on the privilege. **If Increment 1 and 2 ship in one release,** the order is code, then `0061` and `0062` back to back, then smoke, then `0063`; the minutes between the deploy and the migrations show the load-error state on the pending page only. Production has 0 roll rows and one user, so any order is survivable; the point is to choose one on purpose. The deployment-engineer's runbook carries this paragraph.

## Test Plan

### 1. Implementer-written tests

1. **`src/lib/db/domain/session-approval.db.test.ts`** (serial; owner plus `presby_app`): every decide outcome with a fixture producing exactly it, and "nothing written" proven by a per-row state snapshot (including `current_roll`, membership end, derived group); every withdraw outcome; `not_approvable_kind` and the legacy pending participant row through the owner path; the deny of any kind; identity refusals (no organization context, null actor, a person without `roll.approve`, a propose-only actor calling decide, a holder whose membership ended, a merged person, an actor from another organization) all raising the one literal with SQLSTATE 42501.
2. **R6 both directions against `presby_roll_changes`:** approving a second gain for someone already on the roll is refused and the gain count is unchanged; approving an earlier gain before a later counted one is refused; a following `opening_balance` gives only the shadow warning; the "2018 profession entered after a 2020 opening balance for a person not otherwise on the roll" case (replay as of 2018 is null) is allowed with the warning.
3. **State and replay:** approval projects `current_roll` and `current_roll_since`; `presby_roll_counts_as_of` moves; per-person `presby_roll_cache_drift()` is clean for a today-dated approval (the branch baseline is 4 fixture rows, so assert per person); a future-dated approval waits for the reconcile; participant to member drops the participant count with no loss line and counts the gain with the right age split; a withdrawn or denied row never enters `presby_effective_roll_actions`.
4. **`active_elsewhere`:** a person active at two organizations (the fixture disables `memberships_guard_insert` for its own owner-side insert, as other fixtures do) hits `memberships_one_active_roll_idx`; the outcome is typed, nothing is written, and the function's message names no other organization. `provisioning_incomplete` using a branch organization with no `active_membership` group.
5. **Terminal rows and the one-pending index:** as owner, `UPDATE` and `DELETE` of an approved, denied and withdrawn row raise `check_violation`; a pending `DELETE` still works for the owner; a second pending insert for one person is a `unique_violation`; a withdrawn row releases the person; the S3 index ignores a withdrawn void.
6. **Concurrency:** two connections racing the same approve give one `ok` and one `already_decided`; approve against deny; approve against withdraw; a bulk submit where another actor decides one row mid-run reports it as `already_decided` without disturbing the rest.
7. **Backfill and groups:** the `session_member` backfill creates the role, one permission row and one group-arm grant at a congregation with a Session group and no such role; skips (and does not alter) an existing org-owned `session_member`; skips non-congregations; seeds a missing `session` and `diaconate` group first; is a no-op on the second run. The roles that result hold exactly `{roll.approve}`; no template or baseline role holds both roll keys.
8. **Pastors:** the derived-group CASE; `SESSION_OFFICES` pinned to it; existing pastor terms re-materialised by the touch; a pastor in the Session group inherits the Session role; the vocabulary CHECK refuses `bishop`; the S1 trigger refuses an open pastor term for a rolled person, allows a closed historical term, does not fire on an end-date update; the roster `selfRecorded` flag.
9. **Audit and source scans:** one `audit_events` row per `ok` with the exact metadata keys; a forced throw from `insertAuditRow` leaves the roll row, the membership and the officer term unchanged (approve, deny, withdraw, start, end); an `ok` approval never reuses `tenant.roll_action.recorded`; the keys go through `insertAuditRow`, never `recordAudit`; **only `roll.ts` names `presby_decide_roll_action` and `presby_withdraw_roll_action`; no non-test file under `src/` matches `update(rollActions)`, `delete(rollActions)`, `update roll_actions` or `delete from roll_actions`** (the 0063 safety proof); `officers/actions.ts` calls no `recordAudit` for start or end; neither migration contains `delete from`.
10. **Pins (unit and source scan):** `APPROVABLE_ROLL_ACTION_KINDS` equals the decide function's list, 0063's insert-policy list and `EDIT_TIME_ROLL_ACTION_KINDS` minus `ON_RECORD_ROLL_ACTION_KINDS`; `COUNTED_GAIN_KINDS` equals both the function's list and the kinds `presby_roll_changes` counts (scan of the live definition); `ROLL_DECISION_REFUSALS` and `ROLL_WITHDRAW_REFUSALS` equal the SQL `outcome := '...'` literals; `SESSION_OFFICES` equals the trigger CASE in 0062; `OFFICER_OFFICES` equals the 0062 vocabulary CHECK and `listOfficerRoster`'s `all_offices` values list; the two `officer-offices` re-exports are the same arrays; every refusal code has copy (a runtime test over the arrays and the type-level exhaustiveness).
11. **`roll-decide-lockdown.db.test.ts`:** applies 0063's text in a rolled-back transaction (so it passes in both the 0062-only and the locked-down state): `presby_app` holds `SELECT` and `INSERT` but not `UPDATE` or `DELETE`; the policy is restrictive, for insert, to `presby_app`, and refuses a pending `void`, a loss kind, `opening_balance` and `other_participant_enrolled` while allowing a pending gain; `presby_app` cannot approve, deny or delete by plain SQL; the terminal-stamps CHECK; the stop-block raises on a denied row lacking stamps; a `person_milestones` insert referencing a roll action still works as `presby_app` (RI runs as the owner).
12. **Library and action behavior (Batch B):** forgery (a payload cannot choose the decision's kind or the approver; `proposal_refused` mapping; ids that are not UUIDs are `not_found`); bulk (50 cap, empty, duplicates deduplicated, partial failure, first-row `forbidden` stops); every action maps `forbidden` and every refusal; reasons and minute references bounded; `listPendingRollActions` modes and pagination, `listRecentlyDecidedRollActions` shows approvable-kind approvals plus denials and withdrawals with reasons and never the on-record rows, `countPendingRollActions`; `getSessionApprovalState` for each of the five states including a Session seat starting later and a seat held by someone with no account; `startOfficerTerm` pastor outcomes (`on_roll`, `invalid_office_for_org`) and `selfRecorded`; `createPerson()` and `recordRollAction()` for `no_session` and `pending_exists`.

### 2. Staged SQL suite: `scripts/session-approval/test-rls-62.sql` (as `presby_app`, Alder Creek fixture)

Structure and privileges (`UPDATE` and `DELETE` absent, `SELECT` and `INSERT` present, FORCE RLS, the narrowed policy text, the `officer_terms_office_allowed` CHECK); the restrictive policy behavior (approved, denied and withdrawn inserts refused with 42501; a pending void, loss kind and `other_participant_enrolled` refused; a pending gain allowed; a second pending for one person refused with 23505); plain `UPDATE` and `DELETE` of a pending row refused with 42501; identity refusals with the exact literal (no organization, a user without `roll.approve`, null actor, another organization's context, the withdraw function for a user without `roll.propose`); the sanctioned flow end to end as the seeded elder (the fixture `session_member` holder with a linked account): approve projects `current_roll`, a second approve is `already_decided`, deny stores its reason, the clerk's withdraw, a withdrawn row releases the person; `already_on_roll`; Rowan Thistlewood (the seeded installed pastor) appears in Alder's derived Session group; the S1 trigger refuses a pastor term for a rolled person inside a rolled-back block; `officer_terms_office_allowed` refuses `bishop`; no **template** role holds both roll keys. Every block that writes ends in rollback. What `presby_app` cannot reach (terminal-row freeze as owner, concurrency, `not_approvable_kind`, the backfill) is Vitest's.

### 3. Existing specs that will change (blast radius)

- **Batch A:** `src/lib/db/domain/participant-roll.db.test.ts` (the exact policy text assertion near `:429-436` and the pending `other_participant_enrolled` insert near `:630`: relax to a pattern that holds in both policy states, the exact text moves to the lockdown test; use a gain kind for the pending insert); `scripts/participants/test-rls-61.sql` (`:58` exact `with_check`, and `:124-125` a pending participant insert as `presby_app`, which 0063 refuses; re-read 61b for two pending rows per person). **Staged patch to `scripts/test-rls.sql`** (anchors by content, against the patched file): section 5's approved-row `UPDATE` (was `check_violation`, becomes `insufficient_privilege` for `presby_app`; the trigger layer is proven as owner in Vitest); section 5's "pending still editable" block (the `denial_reason = 'editable'` update violates the new CHECK and `presby_app` has no `UPDATE`: rewrite as "pending rows are not editable by `presby_app`"); section 20d (Increment 1's insert-pending-then-update cannot work after 0063; the pending `DELETE` and approved `DELETE` assertions become privilege assertions, 42501); a count line for the new `session_member` roles if any assertion counts org roles per congregation. Plus the `\ir session-approval/test-rls-62.sql` line.
- **Batch B:** `src/lib/roll.test.ts` (the approve and deny describes rewritten to the definers and in-transaction audit; the `vi.mock("@/lib/audit")` stub needs `ROLL_ACTION_DENIED` and `ROLL_ACTION_WITHDRAWN`; the freeze test at `:532` expects 42501 for `presby_app`; the pending-`DELETE` "Finding 2" test at `:579` expects 42501; teardown disables `roll_actions_freeze` for denied and withdrawn rows too; fixtures for membership-kind proposals add a derived `session` group because R15 refuses without one); `src/lib/people.test.ts` (member-kind `createPerson` cases need a Session group at the fixture organization; the F173 pin at `:597`); `src/lib/officers.test.ts` and `officers/actions.test.ts` (audit moved into the lib, `listOfficerRoster` offices, new typed results, the action no longer calls `recordAudit`); `officer-term-schema.test.ts`; `src/lib/org-provisioning.test.ts` (`:204-215` "same plan for every type", `:386-430` and `:512-521` role counts for congregations: now two roles); `src/lib/audit.test.ts` (pinned catalog gains the withdrawn key); `src/lib/roll-action-kinds.test.ts`; `src/lib/db/domain` fixtures that create a denied row (`roll.test.ts` only, measured).
- **Batch C:** `pending/page.test.tsx`, `pending-worklist.test.tsx`, `pending/actions.test.ts` (all rewritten); `community/page.test.tsx` (the header link); `new/page.test.tsx`, `new/connection-step` and `member-wizard` tests (a `memberAvailable` prop; Member hidden without a Session); `[id]/edit/page.test.tsx` and the connection-card test (Withdraw); `officer-roster.test.tsx`, `add-officer-term-form.test.tsx`, officers `page.test.tsx` (the new offices, labels, marker, note).
- **Batch D:** `e2e/community-participants.spec.ts:228` ("a member is a proposal that waits for the Session") breaks because alpha has no Session group; the fixture seeds one (below). It is fixed in this pipeline, not left to QA.

### 4. e2e (Batch D)

No existing spec asserts the pending page. Changes: `e2e/support/community-fixture.ts` ensures alpha has a `session` derived group (created on the owner connection if absent, removed at teardown only if the fixture created it, role grants referencing it removed first), adds an `e2e_session_approver` role (`roll.approve`) granted to the clerk fixture person by the person arm, and a `setRollApprove(sql, granted)` toggle like `setDirectoryView`; the fixture teardown disables `roll_actions_freeze` for terminal rows, as it does for approved ones. New `e2e/community-approval.spec.ts`, desktop and 360px: (1) propose a member through the wizard, see it in the queue with "You proposed this", approve it, see the person under Members; (2) two proposals approved together with one minute reference ("2 roll actions approved"); (3) deny with a reason and see it under Recently decided; (4) withdraw from the edit page and from the queue, then propose again; (5) read-only mode (`setRollApprove(false)`): no Approve, Deny or checkboxes, the "Waiting for the Session" copy and the empty-Session banner, with the "Ask an administrator" variant since the fixture role lacks `officers.manage`; (6) the Community header "N waiting" link; (7) at 360px the sticky bar does not cover the last row (bounding boxes). `e2e/hydration/community-approval-controls.spec.ts`: with the page's JavaScript held, the row checkboxes and the Approve, Deny, Withdraw and bulk triggers are disabled (both lanes; `test:e2e:prod` runs it). Whole suite re-run as the regression lane because the shared fixture file is touched. No existing spec asserts on `admin/officers`.

### 5. The 360px browser check (Batch C, repeated in D)

Real Chromium, 360 by 740 and 375, screenshots in the scratchpad and never committed: (1) the queue in decide mode: checkboxes are 44px targets, the sticky "Approve N" bar sits above the viewport bottom without covering the last row, the bulk dialog and the per-row Approve, Deny and Withdraw dialogs fit with every control reachable and focus trapped and returned; (2) read mode and each banner state, including the longest (`no_sign_in` with a future start date); (3) Recently decided with a long denial reason wrapping; (4) the Community header with the link; (5) the edit page's pending notice with Withdraw and its dialog; (6) the wizard with and without the Member option; (7) the Officers page with the pastor offices, the helper text and the self-recorded marker; (8) pre-hydration: triggers and checkboxes are disabled. A page that returns 200 is not evidence it works.

## Edge Cases & Risks

1. **Zero approvers at a new congregation.** After the backfill the production congregation has the role and an empty Session, so nobody can approve until a member of the Session with an account exists. At a one-person start the founding administrator records themselves under Officers (self-recorded, then self-approved, both stamped). This is the operator's ruling (allow and stamp) and is the single most important sentence for the operator hand-off.
2. **Elders with no account cannot approve** until Increment 2b ships invitations. The queue says so in plain words (Flow 7 state `no_sign_in`); the sentence is a single constant 2b replaces.
3. **Pastor already on the platform at the presbytery:** `memberships_guard_insert` refuses a congregation link and the congregation sees the existing "belongs to another organization" copy (known limit from Phase 2; the claim function does not exist).
4. **A tenant that already holds its own `session_member`** is skipped by the backfill and may lack `roll.approve`; state `no_permission` surfaces it, and the copy points to Roles or a support ticket.
5. **Self-approval and self-recording are permitted, stamped and `paper`** (DECISION-205): detected by audit (`invitation.accepted` for the founding administrator, then `tenant.officer_term.started` with `selfRecorded: true` on a Session office, then `tenant.roll_action.approved` with `selfApproved: true`), not prevented. Blocking would deadlock a one-person start.
6. **`already_on_roll` is deliberate and strict** (a reaffirmation for someone already on the roll is refused, because the SASR counts it as a gain). The copy says deny; if the pastoral need is real it is not a roll action.
7. **Bulk is not atomic.** A stale selection after another approver acts becomes per-row `already_decided`; the dialog lists what needs attention. One transaction per row keeps locks short.
8. **Future-dated approvals** leave `current_roll` until the daily reconcile (F29), so the row says "Takes effect {date}" and the approve toast repeats it; `presby_roll_cache_drift()` reports it on the day, as designed.
9. **Approval does not require 2FA** unless the organization's `require_two_factor` is on (default false); recorded in DECISION-205, not changed here.
10. **Names of `directory_hidden` people appear in the queue** to holders of the two roll keys, by design (approvers need identity; proposers typed the person in). DECISION-204.
11. **Turning the Community toggle off hides the queue** (the page rides `org_portal.members_create`). Named coupling.
12. **Roles bound to the Session group now reach installed pastors too** (correct polity). Measured: production has none before the backfill; the branch has the fixture role. DECISION-206.
13. **Alder's seeded pastor gains `roll.approve` and `directory.view` at Alder** through the fixture role (Feasibility); a fixture side effect to re-read in tests, not a production change.
14. **Rollout window (between 0062 and the code deploy):** a second pending proposal for one person fails with a raw error in the old code (the old edit page already warned about it). Accepted.
15. **A person with a waiting proposal cannot be removed as a participant** (Increment 1's `pending_action`); withdrawing or deciding the proposal releases them. The Increment 1 release note warns about this until Increment 2 ships (F183).
16. **Participant enrolment of a pastor-office holder is not refused** (refinement 7), a documented asymmetry with S1.
17. **Stale client calls across the deploy:** `approveRollActionAction` and `denyRollActionAction` keep their signatures; only the success payload grows.
18. **Time zone:** dates use the database `current_date` (UTC), as in Increment 1.

## Copy

All strings are plain language for a clerk or an elder. Organization names are added by the page, not the table.

**Approve and deny refusals (`DECISION_COPY`):**

| Code | Copy |
|---|---|
| `forbidden` | You don't have permission to approve or deny roll actions here. |
| `invalid_decision` | That action isn't recognised. Refresh the page and try again. |
| `reason_required` | Say why you're denying this. |
| `reason_too_long` | Keep the reason under 500 characters. |
| `minute_reference_too_long` | Keep the minute reference under 200 characters. |
| `not_found` | That roll action could not be found. |
| `already_decided` | Someone already decided this one. Refresh to see the current status. |
| `not_approvable_kind` | This kind of entry can't be approved here. Deny it, or ask the person who proposed it to withdraw it. |
| `person_deceased` | This person is recorded as deceased. Deny this action or correct the record first. |
| `person_merged` | This person's record was merged into another. Deny this action and propose it again on the current record. |
| `membership_ended` | This person's connection to this congregation has ended, so this can't be approved. Deny it instead. |
| `holds_pastoral_office` | This person is recorded as a pastor of this congregation. A pastor's membership is held by the presbytery, so they aren't received onto this congregation's roll. Deny this action. |
| `already_on_roll` | This person is already on that roll as of the effective date. Approving would count them twice. Deny the duplicate. |
| `active_elsewhere` | This can't be approved right now. Send us a support ticket and we'll look into it. |
| `provisioning_incomplete` | This organization's membership setup isn't finished, so this can't be decided yet. Send us a support ticket. |

**Withdraw refusals (`WITHDRAW_COPY`):** `forbidden` "You don't have permission to withdraw roll actions here."; `reason_required` "Say why you're withdrawing this."; `reason_too_long` "Keep the reason under 500 characters."; `not_found` "That roll action could not be found."; `already_decided` "The Session already decided this one, so it can't be withdrawn. Refresh to see what happened."

**Proposal refusals:** `no_session` "This organization has no Session to approve member roll actions, so a member can't be proposed here."; `pending_exists` "This person already has a roll action waiting for the Session. Withdraw it first if it was a mistake, then propose the new one."

**Successes and warnings (toasts):** approve "{name}'s roll action approved."; future-dated "{name}'s roll action approved. It takes effect on {date}."; bulk "{n} roll actions approved." and partial "{n} approved, {m} need attention."; deny "{name}'s roll action denied."; withdraw "Proposal withdrawn. {name} is no longer waiting for the Session."; shadowed "Approved. Note: this is dated before {name}'s latest roll entry, so it doesn't change their current status."; filed period (a second `toast.warning`, the Increment 1 string) "This changes a year that has already been filed. The filed return is not changed. If it needs correcting, file a correcting return."

**Queue page.** Heading "Pending approvals". Read-mode subtitle: "You can see what's waiting for the Session. Only members of the Session can approve." Sections "Waiting for the Session" and "Recently decided". Empty (decide mode): "Nothing waiting for your approval" / "Roll actions proposed by the clerk or other administrators will show up here." Empty (read mode): "Nothing is waiting" / "Member proposals you make appear here until the Session decides them." Recently decided empty: "Nothing decided yet." Row detail: "Proposed {date}"; "Takes effect {date}" when future-dated; decided lines "Approved {date}", "Denied {date}: {reason}", "Withdrawn {date}: {reason}"; badges "You proposed this", "Self-approved", "Connection ended", "Recorded as deceased". Buttons: "Approve", "Deny", "Withdraw", "Approve {n} selected", "Select all on this page". Bulk dialog: title "Approve {n} roll actions?"; body "Each one is approved and recorded separately. If one can't be approved, the others still are."; field "Minute reference (optional, applies to all)"; result panel "{m} need attention" with each name and reason. Withdraw dialog: title "Withdraw this proposal?"; body "This takes {name} out of the Session's queue. The proposal stays in the record, marked withdrawn, and you can propose again afterward."; field "Reason (required, up to 500 characters)"; buttons "Keep it" and "Withdraw".

**Flow 7 banner (Session cannot act yet).** Counts use "member of the Session" and "members of the Session".

| State | Title and copy |
|---|---|
| `no_session` | "No Session to approve". "This organization doesn't have a Session. Receiving members is a Session act, so member roll actions aren't offered here. Participants can still be recorded." |
| `empty`, viewer holds `officers.manage` | "Your Session roster is empty". "Member proposals wait until your Session can approve them. Record your ruling elders, installed pastors and associate pastors under Officers." (link "Open Officers") |
| `empty`, otherwise | "Your Session roster is empty". "Member proposals wait until your Session can approve them. Ask an administrator to record the members of the Session under Officers." |
| `no_sign_in` | "No one can approve yet". "{n} member(s) of the Session {is/are} recorded, but none has a PresbyPortal account yet, so no one can approve." plus, when every seat starts later, "The first term begins {date}." plus the swap-me line "Inviting someone to sign in isn't available here yet. Send us a support ticket and we'll help get them set up." (Increment 2b replaces only that last sentence with a link to the invite card.) |
| `no_permission` | "No one can approve yet". "Members of the Session are recorded and have accounts, but none of them has permission to approve roll actions. This usually means the Session member role was changed. Check Roles, or send us a support ticket." |
| `ready` | No banner. |

**Edit page.** Pending notice: "Waiting for the Session to approve: {kind} effective {date}." with "Withdraw proposal"; when the Session cannot act: "No one can approve yet. See why on the Pending approvals page." Existing participant note unchanged.

**Wizard.** Member option text unchanged; when the organization has no Session: "This organization has no Session, so members can't be proposed here. Participants and visitors can still be added."; review note for Member when the Session cannot act yet: "This person's roll action will wait. No one on your Session can approve yet." (otherwise the Increment 1 note).

**Community header.** Link "Pending approvals", suffix "{n} waiting" when above zero; accessible name "Pending approvals, {n} waiting".

**Officers page.** Session note: "Members of the Session decide who is received onto the roll. Recording a ruling elder, installed pastor, co-pastor or associate pastor here seats them on the Session. They can approve only once they have a PresbyPortal account." Pastor helper (when a pastor office is chosen): "A pastor's membership is held by the presbytery, so a pastor is recorded here without a roll membership. If they aren't in the list, add them from the Staff page first." Self note (the actor selects themselves for a Session office): "You're recording yourself as a member of the Session. That's allowed, and the record will show it as self-recorded." Roster marker "Self-recorded". Typed errors: `on_roll` "{name} is on this congregation's roll. A pastor's membership is held by the presbytery, so a pastor can't also be recorded on the roll here."; `invalid_office_for_org` "{office} isn't available for this kind of organization. Session and Board of Deacons offices belong to congregations." Office labels "Installed Pastor", "Co-Pastor", "Associate Pastor".

## If DECISION-206 is declined

The pastor artifacts, all in unreleased files so they strip in place: 0062 section 8 whole (CASE arms, the nine-value vocabulary becomes the six existing values, the touch, the S1 function and trigger); the `holds_pastoral_office` check and outcome in `presby_decide_roll_action`; in TypeScript `PASTOR_OFFICES`, the three offices in `OFFICER_OFFICES` and labels, `SESSION_OFFICES` reduced to `ruling_elder`, `holds_pastoral_office` in `ROLL_DECISION_REFUSALS` and its copy, the `on_roll` result and copy, the Officers helper text and the three `listOfficerRoster` values; the pastor tests (Test Plan 1.8, the pin lines) and DECISION-206's text. Nothing else depends on them.

## Out of Scope (non-goals for the operator to confirm)

- Increment 2b (sign-in invitations for elders, R19-R26), and with it F186 and F187, DECISION-207 and 208, migration 0064.
- Email or push to approvers when proposals queue; quorum, vote counts, a required minute reference at approval.
- Approving loss, transfer-out and removal kinds, and the F19 membership-ending trigger for them (the edit-time picker stays gain-only).
- F177 (the `active_membership` group admitting visitors), the rest of F176 (other tables' `DELETE` grants; only `roll_actions` is closed here), requiring 2FA for approvers.
- A "Clergy" wizard connection (S3), reconciling pastor terms against a published presby appointment (S5), refusing participant enrolment of a pastor-office holder.
- An admin-hub tile for the queue (refinement 8). Fixing fixture drift F190 in `seed-dev.sql`.

## Implementer

Named per batch: **`database-admin`** (Batch A, 0062 and 0063 and their DB tests), then **`api-developer`** (Batch B, library, actions, audit), then **`ux-developer`** (Batches C and D, UI, e2e and the 360px pass). Phase 4 starts only after Increment 1 merges to `main`. The Copy section is part of the design; the operator should read it at design review, with refinements 1-3, the deploy order, and the zero-approvers sentence called out.

## Release-note risk lines (for `/release-notes`, tech-lead)

- **Increment 1 (F183), required in its note:** "Known limit in this release: if you add a person as a member, that entry waits for your Session to approve it, and nobody at a new congregation can approve or withdraw it yet. Approval and withdrawal arrive in the next release. Until then, a person with a waiting entry can't be removed as a participant. Visitors and participants take effect straight away and are not affected. If you only need someone in your records for now, add them as a visitor or a participant."
- **Increment 2, the self-approval paper residual:** "Who can approve: the Session. A congregation's first administrator can record themselves as a ruling elder, installed pastor or associate pastor, and then approve member entries. We allow this on purpose, because a brand-new congregation with one administrator would otherwise be stuck. It isn't blocked; it is recorded. The officer record says 'self-recorded' and the approval says 'self-approved', so your Session can look back and confirm it. Approving a member does not ask for two-step sign-in unless your organization has turned that on."
- **Increment 2, honesty about elders:** "Members of the Session need a PresbyPortal account before they can approve. Inviting them to sign in is coming in a following release; until then the Pending approvals page tells you plainly when no one can approve yet."
- The note is written for a non-engineer and must not deny a residual the decision records admit (the 0.25.2 lesson).

## Integration hand-offs (for the orchestrator; nothing below is edited in this pipeline)

- `drizzle/meta/_journal.json`: entries for `0062_presby_session_approval` and `0063_presby_roll_decide_lockdown` (0064 stays reserved for 2b).
- `scripts/test-rls.sql`: append `\ir session-approval/test-rls-62.sql`; apply `scripts/session-approval/test-rls.sql.integration.patch` (generated against the post-Increment-1 file); re-run against merged `development` after the merge.
- `scripts/seed-dev.sql`: no edit required. F190 (the fixture `stated_clerk` holding both roll keys and the fixture `session_member` holding `directory.view`) is the orchestrator's integration call; changing it alters what section 61 and 62 can assume about Tobias Renwick, so the recommendation is to record it, not fix it.
- `docs/decisions.md`: DECISION-202 to DECISION-206 (drafted below). `docs/schema-design-2.md`: F179 to F185 and F188 to F191 as a lettered review-round subsection.
- `docs/TODO.md`: add the follow-ups (S3 Clergy connection, S5 appointment reconciliation, participant enrolment of a pastor-office holder, admin-hub tile, F190 fixture drift, the `no_sign_in` sentence for 2b, Increment 3); the Increment 2 line moves to Done at SHIP IT.
- `CLAUDE.md` (for the operator to review in the diff, Two Hierarchies section, as the architect proposed): *"A founding administrator who records themselves as a ruling elder or installed pastor becomes a Session approver. This is permitted, stamped `selfRecorded` and `selfApproved`, and `paper`."* This agent does not edit `CLAUDE.md`.
- `docs/product/functionality-map.md`: the Community line gains the pending queue, bulk approve, withdrawal and the Session role (Rule 14, at ship, with the release notes).
- `docs/architecture.md`: no change (Rule 15, nothing architectural).
- Deployment runbook: the deploy-order paragraph under Implementation Order.

## Drafted decisions (for `docs/decisions.md`; newest first at integration)

**DECISION-206 — Installed pastors, co-pastors and associate pastors are members of the Session, through `officer_terms` at the congregation. Pending operator confirmation.**

**Status:** Proposed (operator confirmation pending) · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (R10-R12, S1)

- The PC(USA) Book of Order composes the session of the ruling elders in active service together with all installed pastors and associate pastors (G-3.0201) and has the session keep the register of installed pastors (G-3.0204). Temporary relationships (stated supply, interim, temporary supply), parish associates and a designated moderator are not in that composition and are not mapped; `moderator` stays unmapped.
- The carrier is `officer_terms` at the congregation, and the roster stays materialised from it by trigger (The Court Is Not a Group). `appointments` is deliberately not the source: it is presbytery-owned, and a presbytery row writing a congregation's Session roster would be authority flowing down by inheritance. `staff_positions` grants nothing by design, and the `installed_pastor` role is a permission set, not court composition.
- No congregation membership is invented: the `memberships` row is the link, the roll is `current_roll` and `roll_actions`, and the pastor's link carries none, so no SASR count and no Directory listing. A database guard refuses an open pastor term for a person on the roll, and approval refuses a member-roll gain for a pastor-office holder.
- Any role a tenant has bound to its Session group now reaches installed pastors too, which is correct polity. Pastor offices are congregation-only and recorded with `officers.manage`. A pastor already on the platform at the presbytery cannot yet be linked (the claim function does not exist; a known limit).
- One pure `officer-offices.ts` is now the single home of the office vocabulary. If declined, the pastor artifacts strip in place (see Phase 3).

**DECISION-205 — The Session roster is constituted by `officers.manage`; self-recording and self-approval are permitted and stamped; the Session's inability to act is told in five states.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (F182, operator ruling Q1)

- The authority comes from the congregation's own officer record entered by a tenant permission; no platform predicate takes part in any check. A block would deadlock a one-person start, so the founding administrator may record themselves as a ruling elder or pastor and then approve their own proposals. Officer-term start and end are audited in the same transaction with `selfRecorded`; approval with `selfApproved` and `selfTarget`; the queue and roster show "Self-approved" and "Self-recorded".
- **Accepted residual, `paper`:** the chain platform designation, then `officers.manage`, then a self-recorded Session seat, then `roll.approve` is the one DECISION-155 refused to bundle. It is detected by audit and not prevented. Proposed CLAUDE.md sentence recorded under Integration hand-offs.
- Approval does not require two-step sign-in unless `require_two_factor` is on (default false). Not changed here.
- The queue distinguishes `no_session`, `empty`, `no_sign_in`, `no_permission` and `ready`. Member is offered only where a Session exists (F185). Elders without an account cannot approve until Increment 2b; the copy says so.

**DECISION-204 — The pending queue is visible to roll proposers and approvers; decided history shows reasons to the same holders; bulk approve is capped and per-row.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (F179, R17, R18)

- `roll.approve` or `roll.propose` reads the queue (decide mode for approvers, read mode for proposers) and a "Recently decided" history of approvals, denials and withdrawals. Denial and withdrawal reasons are free text about a person, so the library returns them only to holders of those two keys. Names of `directory_hidden` people appear to these holders by design: approvers need identity to decide and proposers typed the person in.
- Entry points are the Community header link and the person's edit page; no admin-hub tile (the hub is permission-blind). The queue rides `org_portal.members_create`, so turning the Community toggle off also hides it.
- Bulk approve is at most 50 per submit, one transaction per row, each its own definer call and audit row; the result is "N approved, M need attention" and no cross-row atomicity is claimed.

**DECISION-203 — Approve, deny and withdraw go through two `SECURITY DEFINER` functions; decided rows are terminal; `presby_app` loses `UPDATE` and `DELETE` on `roll_actions`; audit is written in the same transaction.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (R1-R8, R13, R16, F180, F181, F184, F191)

- `presby_decide_roll_action` and `presby_withdraw_roll_action`: org from `presby_current_org()`, a bounded `users.id` actor claim checked for `roll.approve` or `roll.propose` in the caller's own transaction, uniform identity literal, typed outcomes, exactly one row. Lock order membership then roll action.
- Approval refuses a non-approvable kind (the seven gain kinds; participant enrolment is on-record only), a deceased or merged person, an ended membership, a pastor-office holder, a gain that would put someone on a roll they are already on (checked in both directions so `presby_roll_changes` cannot double-count), and maps the global active-roll collision to `active_elsewhere` without naming the other organization. A later-dated effective row is a warning, never a refusal. One pending proposal per person (R7). Input bounds are enforced in the database too.
- A `withdrawn` status, distinct from `denied`, with `decided_by` and `decided_at` on every new decision. Denied, withdrawn and approved rows are terminal for the owner as well as the application. Approved rows predating this are not backfilled (the append-only trigger is not disabled by a migration); readers coalesce.
- 0062 is additive; 0063 revokes `UPDATE` and `DELETE` and narrows the insert policy to the approvable kinds; the order is 0062, code, 0063. The audit rows (`approved`, `denied`, new `withdrawn`) use `insertAuditRow` in the same transaction, replacing the after-commit `recordAudit` that swallowed failures. A filed return is never altered; `affects_filed_period` warns. Residual: a direct SQL caller of the functions would skip the audit row (paper, source-scan pinned).

**DECISION-202 — Every congregation gets a baseline `session_member` role carrying `roll.approve` only, bound to its derived Session group.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (R9; revisits DECISION-100)

- DECISION-100's comment anticipated this: the plan "is ready to branch the day a genuinely type-varying baseline role is proposed". `baselineRoleSeedPlan("congregation")` now also returns `session_member` (constitutional, protected), and `boundToDerivedFrom` widens to `session`. Other organization types are unchanged.
- 0062 backfills congregations that have a Session group and no org-owned `session_member` (the role key is the discriminator, never a reason text), never modifies an existing one, and first seeds the missing Session and Board of Deacons groups (an empty derived group grants nothing). The fixture's extra `directory.view` is not copied; the baseline `member` grant already covers it.
- No role carries both roll keys, as a bundle or a template. The roster is constituted by `officers.manage` (DECISION-205), not by the roll.

## Drafted findings (for `docs/schema-design-2.md`; same `### F### — title` form)

### F179 — the pending queue had no entry point and only approvers could read it
**F179 — nothing linked to `/admin/community/pending`, and a proposer never learned that a proposal was denied or why.** **Closed:** the Community header link, the widened read gate with a read-only mode, and the decided history (DECISION-204).

### F180 — approval was application-gated and its audit was written outside the transaction
**F180 — `decideRollAction()` issued a plain `UPDATE` as `presby_app`, its audit rows were written after commit through `recordAudit()`, and a denied row recorded no actor.** **Closed:** definer functions, `UPDATE` and `DELETE` revoked (0063), terminal rows frozen, in-transaction audit (DECISION-203).

### F181 — approval had no state checks
**F181 — approval did not refuse an ended membership or a deceased person, could count a duplicate gain twice in `presby_roll_changes`, raised a raw unique violation for a cross-organization active-roll collision, and gave no warning for a back-dated filed year.** **Closed:** typed refusals, the two-direction `already_on_roll` guard, one pending proposal per person, `active_elsewhere`, `affects_filed_period` (DECISION-203).

### F182 — the Session is constituted by `officers.manage`, and a rostered elder may be unable to sign in
**F182 — the founding administrator can record themselves as an elder and approve their own proposals, and an elder recorded with no account cannot approve.** **Open residual (paper):** permitted, stamped `selfRecorded` and `selfApproved`, detected by audit (DECISION-205). The no-account half is closed by Increment 2b and told honestly until then.

### F183 — a mistaken proposal could not be withdrawn and, with no approvers, blocked the person
**F183 — only `roll.approve` could deny, nobody held it at a new congregation, and Increment 1's `pending_action` refusal then blocked every on-record participant act for that person.** **Closed** by withdrawal and the Session role (DECISION-203, DECISION-202). Increment 1's release note carries the interim warning.

### F184 — approve and deny had no server-side input bounds
**F184 — no required reason, no length caps, and the roll action id was not validated as a UUID.** **Closed:** bounds in the database and the actions (reason 1 to 500, minute reference at most 200, UUID shape).

### F185 — organizations with no Session could queue proposals nobody can approve
**F185 — only congregations have a Session group, yet the wizard offered Member by `roll.propose` alone.** **Closed:** `no_session` server-side and the Member option shown only where a Session exists (DECISION-205).

### F188 — installed pastors and associate pastors were absent from the derived Session group
**F188 — G-3.0201's installed pastors and associate pastors were not mapped, `installed_pastor` was an office in the seed but missing from `OFFICER_OFFICES`, and `officer_terms.office` had no vocabulary CHECK.** **Closed** by DECISION-206 (pending confirmation): the CASE, the CHECK, the no-roll guard.

### F189 — most congregations had no Session or Board of Deacons group
**F189 — 6 of 9 non-fixture congregations on the branch lacked a `session` group (7 lacked `diaconate`), so recording a ruling elder there raised a raw foreign-key error.** **Closed:** 0062 seeds the missing groups and `startOfficerTerm` returns a typed result. Production measured 0.

### F190 — the dev fixture roles drift from the baseline shape
**F190 — the dev `stated_clerk` holds both `roll.propose` and `roll.approve`, and the dev `session_member` also holds `directory.view`; neither is a template or a baseline.** **Recorded, not fixed in this pipeline** (integration's call; the tests that need a propose-only actor build one).

### F191 — the 0061 insert policy let `presby_app` insert a pending void, loss or opening-balance row
**F191 — no definer will ever approve such a row, and with one pending row per person it would block every proposal for that person.** **Closed** by 0063's narrowed policy (the seven approvable kinds).

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 3 — Technical design | tech-lead | Complete (design to R1-R18; S1-S5 ruled; ten refinements named; DECISION-206 pending operator confirmation, pastor artifacts isolated) | Design complete; implementers named | 2026-10-22 |

## Handoff

Next: **Phase 4**, only after Increment 1 merges to `main`, serial: **Batch A** (`database-admin`, 0062 and 0063), **Batch B** (`api-developer`), **Batches C and D** (`ux-developer`). The orchestrator records this section and the status row, and the integration hand-offs above. Before Phase 4: the operator's answer on DECISION-206 on record; QA's from-scratch install result for Increment 1 in hand; the numbers re-checked against `main` (0062, 0063, DECISION-202 to 206, F179 to F185, F188 to F191; 0064, DECISION-207 and 208, F186 and F187 stay reserved for 2b). Operator design-review questions: confirm the copy (especially the five Session states and the honest `no_sign_in` sentence), refinements 1-3, the deploy order, S3 declined, and the zero-approvers bootstrap (the founding administrator records themselves as an elder).

---

# Increment 2b — Phase 1 addendum: sign-in invitations (analyst)

*Recorded verbatim by the orchestrator from the analyst's returned text.*

*Pipeline `2026-10-22-founding-admin-directory`. Analyst, read-only. Nothing was run against production or development.*

I read the Inc 2 Phase 1 and Phase 2 sections of the work-log (R19–R26), the 2026-10-21 invitations work-log, DECISION-147/183/184/186/188/189, `drizzle/0059`, `src/lib/onboarding/{accept,issue,labels,status,invitation-email}.ts`, the `(invite)` route group, the Community page and rows list, and the people and contact-method schema.

### VERDICT

**READY WITH NOTES.** The shape holds within R19–R26. I found 9 gaps (G1–G9 below). Most go into Phase 3 as inputs. G1, G2, G3 and G4 each add a rule to what the architect ruled, so I'd ask the architect for a short addendum on those (see Handoff).

### ONE-LINE TAKE

> The founding administrator picks a person they already recorded, confirms the email address on file, and sends a one-time link. The person chooses a password (or signs in with an account they already have) and is linked to their own record. Nothing else is granted. The risk to design against is the wrong mailbox: whoever controls the address on file becomes that person. Every rule below narrows that risk or makes it visible.

---

### Pass 1: User verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (`people.manage`; also `officers.manage` if the person holds a Session or diaconate term) | See on a person's edit page whether they can sign in, are invited, or can't yet | on demand |
| Admin | Confirm the address on file and "Send invitation" | once per person, mostly at set-up |
| Admin | "Send again" (new link, old link dies) | when it bounces or expires |
| Admin | "Cancel invitation" | rare |
| Admin | See the "Can't sign in yet" marker on Community rows and click through | at set-up |
| Admin (Flow 7 state c) | From the Session approval page, jump to each Session member's invite card | at set-up |
| Anonymous invitee, no account | Open the link, set name and password, submit | once |
| Anonymous invitee with an account | Open the link, sign in, confirm "Accepting as {name}", accept | once |
| Newly linked member | Sign in, land at `/o/<slug>` | daily thereafter |
| Platform admin | See org-sent counts and masked addresses, revoke all (existing Q9 default) | rare |

The members surface (`/o/<slug>/directory`, Calendar, and the Community Members list and Session queue where roles allow) is the first thing the invitee uses.

### Pass 2: Flow audit

**F1. Issue** (edit page → "Sign in" card)
1. The admin opens `/o/<slug>/admin/community/<id>/edit`. The card is gated on `people.manage` and sits under the existing Community toggle (R25, no new flag).
2. The card shows the full address on file and a confirm dialog: "Send an invitation to {Name} at {address}? They'll get an email with a link that works once and expires on {date}." It then shows the result, "Invitation sent to {address}. It expires {date}."
3. The address comes from the database, never from the sender (R20). I add one safeguard: the action passes the address the sender confirmed, and the definer refuses with `address_changed` if the on-file address differs by then. This closes a gap between viewing the dialog and sending.

Failure outcomes, in the sender's plain words (the exact refusal list the definer must return is under G3):

| Refusal | Copy |
|---|---|
| `already_signs_in` | "{Name} can already sign in. If they've forgotten their password, they can use 'Forgot password' on the sign-in page." |
| `no_email_on_file` | "{Name} has no email address on file. Add one, then come back." (the card says this up front, with no round trip, and links to the email field) |
| `several_emails_none_primary` | "{Name} has more than one email address. Mark the one to use as the main address, then send." |
| `address_invalid` | "The email address on file doesn't look right. Fix it, then send." |
| `address_is_yours` | "That's your own email address. Each person needs their own address to sign in." |
| `address_shared` | "Another person at your congregation already signs in with that address. Each person needs their own email address." |
| `membership_ended`, `person_merged`, `person_deceased` | one plain sentence each; the deceased copy is gentle: "This person's record can't be invited." |
| `not_eligible` (visitor, see Q1) | "Visitors can't be invited to sign in yet. Once they're received as members or added as participants, you can." |
| `needs_acknowledgement` (`do_not_contact`) | existing precedent: a warning with an "invite anyway" checkbox (this is a one-time account email, not marketing) |
| `already_pending` | "An invitation is already out. Send it again or cancel it." |
| `rate_limited` | the uniform existing sentence, "Too many invitations right now. Try again later." |
| `totp_unavailable`, `link_origin_unavailable`, database error | "We can't send invitations right now. Send us a support ticket." / the existing "We couldn't complete that just now" |

**F2. Resend** (creates a new row, D-1)
- The new row supersedes the old one first. Both partial unique indexes then hold, and the old link dies.
- The card says so: "Sending again turns off the earlier link."
- The new row re-reads the current on-file address. This is the fix for a typo: correct the address, then send again.
- Cooldown: "You sent this a moment ago. You can send it again in {n} minutes."
- Chain cap (5): "This has been sent several times. Ask {Name} to check their spam folder, or send us a support ticket."
- A bounce shows "The email to {address} bounced. Check the address on file, fix it, and send again" (reuses `DELIVERY_STATE_LABEL`).

**F3. Revoke**
- Confirm dialog: "Cancel this invitation? The link will stop working, and {Name} won't be able to sign in until you send a new one."
- Revoke is terminal, cancels a still-queued email, and refunds no limit (DECISION-189).
- Race: if the invitee clicks as the admin revokes, the invitee gets the uniform dead-link page. That is correct.
- Revoking an accepted invitation is not offered. See Q3 (disconnecting a login after accept).

**F4. Accept as a new account** (`/invite?token=`, anonymous)
- Shows the congregation, a plain description of what signing in means, the masked address and the expiry.
- Offers name, password and confirmation. The person is not named (G5).
- Success: `/invite/accepted`, then Sign in, then `/launch`.
- Expired: the dead-link page, with one bucket for expired, revoked, superseded and used links.
- Account already exists: "An account already exists for this address. Sign in to accept." (non-terminal, token stays live).
- Password sign-in is off: the existing sentence points to the other route.
- Database blip: "Your link is still good."

**F5. Accept while signed in**
- If the session email matches and 2FA is satisfied, the confirm state reads "Accepting as {Name} at {Congregation}. If that isn't you, don't accept."
- If the session email doesn't match, "You're signed in as another account. Sign out to accept."
- A signed-in user whose account is already linked to a different person here gets a terminal block. The copy needs a sign_in-specific variant (G6).
- This also catches the sender opening the link in their own browser: they see the mismatch state.

**F6. The person is already linked**
- At issue, the card shows "{Name} can sign in" and no send button.
- At accept (a rare race): the same account linked to the same person is a harmless no-op. A different account is blocked as `person_linked_elsewhere`.
- If another route links the person while a sign_in row is open, the card must hide the pending state (derive it from `people.user_id`). Default: leave the open row to expire.

**F7. Wrong or stale address on file** (the central risk, G1 and G2)
- Before send, the admin sees the full address and the person's name.
- If the address is corrected after the send, the old link must stop working. Today R22 doesn't re-check, so this is a gap (G2).
- If the typo lands in a real mailbox, that stranger becomes the person. The mitigations are the visible address, the confirm step, the pre-auth no-name rule (G5), and the paper residual R21 already names.
- If the wrong person accepts, the church has no way to undo it. See Q3.

**F8. Person deceased, merged, or membership ended**
- Refused at issue.
- If it happens after sending, acceptance returns `blocked` (R22, with `person_deceased` added to the CHECK list).
- Invitee copy must be neutral (G6). A family member opening a late spouse's mailbox must not be told "this record is marked deceased".
- The sender sees a coarse, honest status for own-org reasons.
- Cross-org reasons (`person_elsewhere`, `person_linked_elsewhere`) show the sender only "couldn't be completed, send us a ticket" (the F155 rule: no sender-visible signal may depend on another organization's rows).

**F9. No email on file**: described in F1. It is a pre-send state of the card, with a link to add the address.

**F10. The sender's own address**
- The person is the sender: `already_signs_in`.
- Another person's record carries the sender's own email: `address_is_yours`. This is a comparison against the sender's own row, so it isn't an enumeration oracle (R20). It also stops a second live person from landing on one account (F110/F112).

**F11. Expired**
- The status is derived. An open but expired row still blocks a new issue until superseded.
- The card must show "Expired {date}. Send a new one" and route the button to resend. Otherwise the admin gets `already_pending` and no way forward.

**F12. What the invitee sees after accepting**
`/invite/accepted`, then `/signin?callbackUrl=/launch`, then `computeDestination()`. With one enterable org and no admin access, that is `/o/<slug>`. From there:
- **Community tile** → `/admin/community`: the privacy-filtered Directory-backed Everyone and Members lists (`directory.view`, through the baseline `member` role on the `active_membership` group).
- **Directory** at `/o/<slug>/directory`: the same privacy-filtered Directory-backed records (`directory.view`).
- **Calendar** (`events.view`).
- **Session or pastor roles:** the "N waiting" link and pending page (`roll.approve`, through `session_member` on the derived Session group). Read-only for `roll.propose` holders.
- **Everything else is nothing:** no admin-only lists, no person edit pages, no tier 2 or 3 data, no giving. The invite grants no role and no designation.

For the Phase 6 walk I need a seeded baseline-member-only user. They must see no Visitors, Staff or Former list and no Add person.

### The "Can't sign in yet" marker (R26)

**Scope.** The marker appears only for a person who has a live link, an inert grant, and no login. That means an open officer term, an open staff position, or any role grant. It does not appear on every member. In a 400-person congregation, a marker on every row is noise, and it reads as an accusation.

The edit-page card is shown for every eligible person regardless.

**States.** Four states, and the first has no marker:
1. Signs in: no marker.
2. Invitation sent {date}: amber, links to the card.
3. Invitation expired, or email bounced: amber, "Send again".
4. Can't sign in yet: neutral, with "no email on file" appended when true.

**Rules.**
- Admin only (`people.manage`). It never renders in the Directory or in the Everyone list for a non-manager. A test must pin that.
- It derives from `people.user_id` and the invitation rows only. It never reads `users`, so it can't expose a deactivated account or an address's account status.
- It needs one batched query per page, not one per row.
- Plain language and a 44px tap target at 360px.
- Link to the card with `#sign-in`.

### Flow 7 hand-off (state c, plus a new c2)

- **State c2 (new):** "Invitations sent to {n} of the {m} members of the Session; waiting for them to accept." This keeps the page from saying "none can sign in" a minute after you sent them.
- **State c for a viewer with `people.manage` and `officers.manage`:** "{n} members of the Session can't approve yet because they haven't signed in." Below it, one row per person with their state (invitation sent, expired, no email on file) and an "Invite" link to their card.
- **State c for other viewers:** "Ask an administrator to invite your Session members to sign in." No names.
- Wording says "members of the Session" (S4), because pastors count.
- The counts and names are admin-only data at the viewer's own organization.

### Copy

The email stays from the platform domain (ruled 2026-10-21) and has no sender free text. I propose including the sender's name, taken from their own record and capped at 100 characters. An invitee who sees "a PresbyPortal administrator" alone will wonder if it's phishing.

**Email**
- Subject: `{Congregation} has invited you to sign in to PresbyPortal`
- Greeting: "Hello {first name},"
- Body: "{Sender name} at {Congregation} has set up a place for you on PresbyPortal, the website your congregation uses to keep its records and do its work. Accepting takes about a minute: you choose a password, and then you can sign in whenever you need to."
- Second line: "What you can see and do depends on your role at {Congregation}. Accepting doesn't change your role."
- Button: "Accept the invitation"
- Footnote: "The link works once and expires on {date}. If you already have a PresbyPortal account, sign in with this email address. If you weren't expecting this, you can ignore it. Nothing happens unless you accept."
- It drops the treasurer line "Nobody holds this role until you accept."

**On-page**
- Summary: "{Congregation} invited you to sign in. Signing in lets you see what {Congregation} shares with its people. What you can do depends on your role there."
- No name pre-fill (G5).

**Blocked, for the invitee (sign_in variants)**

| Reason | Copy |
|---|---|
| membership ended, deceased, merged | "This invitation can't be completed. Contact {Congregation}'s office." |
| ambiguous or already linked | "This email address is already connected to someone else's record at this congregation, for example a family member. Each person needs their own address. Contact the person who invited you." |

### Pass 3: Permissions and flags

- **Send, resend, revoke:** `people.manage`.
- **Plus `officers.manage`** when the person holds an open Session or diaconate term. The founding administrator holds both.
- **Subset check** on any person-arm role grants (R21). It must count grants and offices from every organization where the person has a membership, not only this one. See G7.
- **Flag and toggle:** none new. The card rides `org_portal.members_create` and its org toggle (R25, and the operator's no-new-flags rule). Rollback is the Community toggle (which hides the card) plus platform revoke-all.
- **Rollback caveat.** Already-sent tokens still accept, because acceptance is token-only. Revoke-all also kills pending treasurer and founding-administrator invites. A purpose filter on revoke-all is worth Phase 3's consideration.
- **Acceptance** is the credential only (DECISION-147). No `FEATURES.*` key is created.
- **2FA gate.** A new invitee with `twoFactorRequired` is pushed to `/totp` by the proxy as usual. The accept page copy already covers that. An existing 2FA-required account must be verified in-session to accept (G9 of the original work).
- **Audit.** `invitation.created`, `.resent`, `.revoked` and `.accepted` with `purpose: 'sign_in'` and `origin: 'org'`. All carry ids only (no address, token or name) and the tenant `organizationId` stamp (F18), written in the same transaction as the act. No `org.*.designated` row, because nothing is designated. `inviterIsInvitee` is false by construction.

### Pass 4: Gaps (each is an input for Phase 3 unless marked ARCH)

**G1. Eligibility and F177 collide.** The `active_membership` derived group admits visitors, so any person with a login would read the directory. That makes F177 live as soon as this ships. Default: refuse visitors (see Q1).

**G2. The invitation can outlive the address it was sent to. (ARCH)** R22 reuses the treasurer gates, which don't re-check that the invited address is still on file for that person. If the admin corrects a typo after sending, the typo's mailbox holder can still accept. Fix: the sign_in branch re-checks that `email_normalized` still matches an on-file email of that person, and returns `dead` (the uniform bucket) if it doesn't. No new blocked-reason vocabulary is needed, and nothing is revealed.

**G3. The issue refusal list must be exhaustive and mapped.** R20 names six refusals. The flows above need these as well: `person_elsewhere` (another live membership), `not_eligible`, `address_shared`, `address_invalid` (the table CHECK on `email_normalized` would otherwise surface as a database error), `several_emails_none_primary`, `address_changed`, `needs_acknowledgement`, `already_pending`, plus rate-limit, TOTP and origin refusals. A person who is a minor (date of birth under 18) is not offered an invite in 2b (default).

**G4. R19 index interaction. (ARCH)** The existing `account_invitations_open_address_uq` is on `(organization_id, purpose, email_normalized)` and applies to `sign_in` too. In a shared-household email case, a second person's invite would collide with the first as `already_pending`. That is the wrong message for a different person. Make sign_in's open-row uniqueness person-keyed only (R19's new index) and refuse a shared address up front (`address_shared`). Acceptance would anyway block a second person on one account.

**G5. Pre-auth disclosure of a member's name.** The anonymous accept form pre-fills first and last name from `person_display_name`, and the preview's non-treasurer branch also matches by address. For a sign_in invite, show nothing about the person before the invitee signs in. An email address is not proof of identity, and "Pat Example is on Example Church's records" is religious-affiliation data. Preview and accept must take the person from the token's row (as treasurer does), never by address match. R19's "no names are carried" means a new-account invitee types their own name. That is acceptable and avoids the leak.

**G6. Blocked-reason copy for sign_in.** The shared invitee copy is written for administrators and treasurers ("Your relationship with this congregation has ended"). For a congregant, use the neutral variants above. Sender-side copy maps own-org reasons honestly and cross-org reasons to a generic ticket line.

**G7. Cross-org reach through a shared person record.** `people`, `contact_methods` and `people.user_id` are global. A person with live memberships at two organizations would be linked at both by one invite. Default: refuse at issue when the person has any live membership elsewhere (`person_elsewhere`). The subset check must also cover grants and offices at the other organization.

**G8. The card needs a read path that the tenant connection doesn't have.** `presby_app` has no table privilege on `account_invitations`. The card and the marker need status, sent and expiry dates, and delivery state (Sent, Bounced, Failed). A definer reader is needed. It derives the org from `presby_current_org()`, requires `people.manage`, and returns a closed shape for that org's rows only: no token hash and no address beyond what the sender may see. It must not expose `email_queue` rows from other organizations.

**G9. Limits.** DECISION-189's per-org limit of 10 per 24 hours would block a Session and staff set-up in one afternoon. R20 splits the bucket by origin. Default numbers for the org origin: 30 per organization and 30 per inviter per 24 hours, with the per-recipient limit of 3 unchanged. The platform's designation sends keep their own numbers.

Smaller notes:
- The platform invitation list, `PURPOSE_LABEL`, `ROLE_PHRASE` and `roleSummary` are keyed by purpose, so a missing `sign_in` entry fails typecheck. The platform's org-sent view must show masked addresses and counts only (existing Q9).
- The Community tile text ("Add people, record participants and roll actions…") will mislead a signed-in member who is not an administrator. This is copy polish, not a blocker.
- The 90-day address redaction sweep is still unbuilt (S6, tracked). Don't claim it in any user-facing copy.

### Pass 5: Adversarial

- **Redirects.** None new. The hand-off cookie, `/launch` and the `callbackUrl` sanitizer are unchanged.
- **Person id from the client.** Validate as UUID. A person at another org and a missing person must both return `not_found`, and the membership check must come before any `already_signs_in` or `no_email` answer. Otherwise those refusals become an enumeration oracle.
- **State-machine shortcuts.**
  - Posting accept without the preview runs the same gates.
  - Hitting `/launch` or `/totp` before accepting does nothing.
  - The invitee cannot name a person (the person comes from the token's row only, R22).
- **Enumeration.**
  - The sender screen never reads `users` (DECISION-189). Account collisions surface only at acceptance.
  - The dead-link page is one bucket.
  - The marker and card derive from `people.user_id` and the invitation rows, not `users`.
- **Input boundaries (server-side).**
  - Address shape and 320-character cap are checked before the CHECK constraint can throw.
  - Names 1–100 characters, password 8–72 bytes (existing).
  - The sender's name in the email is capped and control-stripped.
- **Self-targeting.**
  - Own person: refused.
  - Own address on another person: refused.
  - Self-recording as an elder and then self-inviting is impossible, because the person is already linked.
- **Escalation.** The invite grants nothing. The subset and `officers.manage` rules in R21 prevent a `people.manage`-only holder from binding a login to an elder's, treasurer's or administrator's record. The paper residual stands: rewrite an unlinked person's email, then invite, detected by audit. I add one detection hint. The `person.updated` audit row for an email change should carry a flag when an open invitation exists. That is cheap if the update path already audits.
- **Forwarded link.** The residual is as in Increment 1: a forwardee with no account becomes that person. Single use, 7-day expiry, and the visible address are the mitigations.
- **Mail abuse.** There is no sender free text. Names are escaped.
- **Concurrency.** Resend and accept lock in the order org, invitation, user, person. The new definer must follow the same order.

### Operator questions that change scope (defaults in bold)

1. **Who can be invited?** **Anyone with a live connection except Visitors.** That means members, participants, staff and officers, because a login reads the directory (F177) and visitors haven't been received yet. Say if you want participants held back too.
2. **Bulk "invite everyone who can't sign in yet"?** **No. One at a time in 2b**, with the Flow 7 hand-off listing each Session member with a link. A Session is ten people or fewer. Bulk is a follow-up if needed.
3. **Can an administrator disconnect a login after it's accepted?** **No, not in 2b.** The only recoveries are ending the membership and a support ticket to the platform. The sender-side copy says so. This matters because a wrong-mailbox accept can't otherwise be undone by the church. Say if you want a "Disconnect sign-in" action now.
4. **Where does the marker and invite link appear beyond Community?** **Community list, the person edit page and the Session hand-off only.** The Officers roster and `/admin/staff` get the same marker as a follow-up.

### Defaults I'm applying without asking
- The sender's name appears in the email.
- No pre-fill of the invitee's name before sign-in.
- Under 18: not offered.
- Org-origin limits of 30 per organization and 30 per inviter per 24 hours.
- No auto sign-in after accept (already ruled).
- No notification to the sender when an invitation is accepted (the card and marker update).

### Out of scope (confirm)
Bulk or CSV invites, SMS, a free-text message, auto-send on hire or grant, a "My invitations" card, church-domain mail, Google claim wiring, the redaction sweep, disconnect-after-accept (Q3), and org-class mail (DECISION-182, unbuilt).

### Handoff

Next agent: **tech-lead (Increment 2b Phase 3)**. They design to R19–R26 plus G1–G9.

Ask the **architect** for a short addendum, rather than a full Phase 2, on three items that add to R19–R26:
- G2: the address re-check at acceptance (R22).
- G4: the person-keyed open-row index for sign_in (R19).
- G8: the definer read path for the card and marker.

Everything else is inside R19–R26.

Migration 0064, DECISION-207 and 208, and F186/F187 stand as reserved. Numbers for new findings (I suggest G1, G2, G4, G5, G7 and G8 become findings) come from the orchestrator.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2b · 1 — Phase 1 addendum (sign-in invites) | analyst | Complete | READY WITH NOTES | 2026-10-22 |

Files read, all under `/Users/cshenso/git/presby-platform/presby-fadir`:
- `docs/work-log/2026-10-22-founding-admin-directory.md`
- `docs/work-log/2026-10-21-invitations.md`
- `docs/decisions.md`
- `drizzle/0059_presby_account_invitations.sql`
- `src/lib/onboarding/accept.ts`
- `src/lib/onboarding/issue.ts`
- `src/lib/onboarding/labels.ts`
- `src/lib/onboarding/status.ts`
- `src/lib/onboarding/invitation-email.ts`
- `src/app/(invite)/actions.ts`
- `src/app/(invite)/invite/` (accepted page, summary, anonymous and confirm states)
- `src/app/(org)/o/[slug]/admin/community/page.tsx`
- `src/app/(org)/o/[slug]/admin/community/community-rows-list.tsx`
- `src/app/(org)/o/[slug]/admin/community/community-badge.tsx`
- `src/app/(org)/o/[slug]/admin/community/pending/page.tsx`
- `src/lib/org-portal/tiles.ts`
- `src/lib/db/domain/people.ts`

### Operator rulings on the Increment 2b and pastor questions (2026-10-22)

- **DECISION-206, pastors:** **"Yes, include them."** Installed pastors and associate pastors count as Session members and approvers (G-3.0201). R10 stands.
- **2b Q1, who can be invited:** the operator answered **"anyone but only people in the system can be invited."** Any person already recorded at the congregation may be invited. That includes visitors, which overrides the analyst's visitor exclusion and the `not_eligible` refusal for visitors. An invitation is never addressed to a typed-in email; it always targets an existing person record and its on-file address (R20). **Consequence for Phase 3:** a visitor with a login reaches the baseline `member` role through `active_membership` (F177). Phase 3 must state how F177 is handled now that it is reachable through 2b. The under-18 refusal was an analyst default, not an operator ruling; Phase 3 should keep it only with a stated reason, or drop it to honor "anyone".
- **2b Q3, disconnect after accept:** **not yet.** Recovery is ending the membership, or a support ticket.
- **2b Q2, bulk invite:** **one at a time.** The Flow 7 hand-off lists each Session member with an invite link.
- **2b Q4, marker placement:** not asked. The analyst default stands: the Community list, the person edit page, and the Session hand-off.

---

# Increment 2b — Phase 2 addendum (architect)

*Recorded verbatim by the orchestrator from the architect's returned text.*

## Verdict

**Approved with suggestions.**

2b keeps the shape set by R19–R26, so it does not need a second full Phase 2. This addendum adds rulings **R27–R36**. Phase 3 must design to them alongside R19–R26 and the analyst's G1–G9.

Reading the shipped 0059 code turned up two defects the analyst did not raise. Both must be fixed in 0064, before any `sign_in` row can exist:
- **F196:** acceptance and preview route by purpose, and an unrecognised purpose falls into another purpose's branch.
- **F197:** the resend guard requires the same address, which contradicts G2 and the analyst's "resend re-reads the address" flow.

Both fit inside the planned 0064 and touch no Increment 2 code, so the verdict is not Needs revision.

## Placement

- **Directory placement:**
  - **`src/lib/onboarding/org-invite.ts`** holds issue, resend, revoke and the G8 reader. It is server-only and runs on `db` through `withOrgContext`.
  - **`status.ts` stays pure and client-safe.** The database reader must not go there. The reader returns the raw queue fields that `deliveryState()` already takes, so the sender side and the platform side use one vocabulary.
  - **`boundaries.test.ts` gains a source scan** that pins three things about `org-invite.ts`:
    - it never imports `getPlatformDb()`;
    - it never runs `select … from users` (other than the sender's own row, for `address_is_yours`);
    - it never touches `email_queue` except the one insert.
  - **`(invite)` is unchanged as a route group (R25).** Only the preview and accept *functions* change.
  - **Migration 0064**, as reserved.
- **Server vs Client split:**
  - The edit page and the Community list stay Server Components. Each calls the reader once: the list makes one batched call per page, not one per row.
  - The "Sign in" card is a client component. It uses the generated `AlertDialog` for send, send again and cancel.
  - Any `useForm` root renders `<HydrationGate>`. A dialog with no form gets a hydration spec, as in Increment 1.
- **Dependencies:** none.

## Rulings

### G2: re-check the address at acceptance (F192). Accepted, extended

**R27.** The `sign_in` branch of `presby_accept_invitation` re-checks the address after the person row is locked. The check passes only if `email_normalized` is still an email contact method of `v_inv.person_id`, compared with `lower(btrim(cm.value))`, the same comparison 0059 already uses.
- **Lock the matching row `FOR SHARE`, not `FOR KEY SHARE`.** `FOR KEY SHARE` does not block a non-key UPDATE, so a concurrent edit of the address would slip past it. Under `FOR SHARE`, if the edit commits first, READ COMMITTED re-evaluates the WHERE clause, finds no match, and the result is `dead`.
- **Lock order** becomes org, invitation, users, person, contact method.
- **On a miss, return `dead` and write nothing.** That is the uniform DECISION-147 bucket: no new reason literal, no `blocked_at`, nothing revealed. The row stays open; a resend supersedes it and R33 lets the new row carry the corrected address.
- **Any on-file email of the person passes, not only the primary one.** Demoting an address from primary does not mean the person stopped owning it.
- **`presby_preview_invitation` applies the same check** and returns zero rows on a miss. Otherwise the preview page shows a live invitation and the accept step then answers `dead`.
- **Phase 3 measures write order:** whether the person-edit save writes `people` before `contact_methods`. If it writes `contact_methods` first, a concurrent accept can deadlock. Postgres aborts one side, and accept's existing `db_error` copy ("your link is still good") covers that, but the order should be known and recorded.

### G4: person-keyed uniqueness for open `sign_in` rows (F193). Accepted, with a copy amendment

**R28.** Changes in 0064:
- **Narrow the address index.** Drop and re-create `account_invitations_open_address_uq` **under the same name**, with the predicate `purpose <> 'sign_in' and <open>`:
  - Keeping the name means `issue.ts`'s mapping by constraint name is untouched, and the FA and treasurer parity golden stays byte-identical.
  - `<> 'sign_in'` is used rather than an allow-list on purpose. A future purpose is then covered by address uniqueness until someone deliberately opts it out.
  - 0059 is already in production (v0.37.0), so this is a forward fix, not an in-place edit.
- **Add the person index from R19.** `account_invitations_open_sign_in_person_uq` on `(organization_id, person_id) where purpose = 'sign_in' and <open>`.
- **Why narrowing is needed even with `address_shared`.** The case is a stale row:
  1. Person A was invited at address X.
  2. A's address was later corrected to Y.
  3. X was then added to person B.
  4. Inviting B passes `address_shared`, because X is no longer on A's record, but then collides with A's still-open row and reports the wrong `already_pending`.

  After R28 the two rows coexist. A's token dies under R27.

**R29. Definition of `address_shared`, checked in the issue definer.** The primary address is an email contact method of *another* live, unmerged person with a live membership at `presby_current_org()`.
- It reads `contact_methods`, `people` and `memberships` at this org only. These are rows the sender, holding `people.manage`, can already see, so it is not an oracle.
- **It never reads `users`** (DECISION-189).
- **Copy amendment:** the analyst's "already **signs in** with that address" implies a `users` read and claims something the check does not know. Use instead: *"Another person at your congregation has the same email address on file. Each person needs their own address to sign in."*
- **Measured on the branch:** 0 shared addresses among live members, and 0 people with more than one primary email.

### G8: a SECURITY DEFINER read path. Accepted, shape defined here

**R30.** The reader is `presby_sign_in_invitation_states(p_person_ids uuid[], p_actor_user_id uuid)`. It is a table function.

**Declaration:**
- `stable security definer`, `set search_path = public, pg_temp`;
- revoke from public, `presby_app` and `presby_platform`, then grant EXECUTE to `presby_app` only.

**Gate:**
- The org comes from `presby_current_org()`. If that is null, the function raises.
- The actor must be a live, unmerged person with an active membership at that org, holding `people.manage` through `presby_has_permission`. The bounded `users.id` claim comes from the session only.
- Anything else raises one uniform `insufficient_privilege` literal.
- `officers.manage` is not needed to *read*; R21 still requires it to *send*.

**Input:**
- 1 to 500 ids; an empty or oversized array raises.
- An id with no membership at the current org is **left out**, so it looks exactly like an id that does not exist.

**Output: one row per eligible person, and nothing more.**

| Column | Content |
|---|---|
| `person_id` | |
| `linked` | `people.user_id is not null`. The answer comes from `people` only, never from `users`. |
| `state` | `signs_in` · `pending` · `expired` · `blocked` · `revoked` · `none`. Taken from the person's open row, or else the newest non-superseded terminal row; `linked` takes precedence. |
| `sent_at`, `expires_at`, `resend_count`, `next_resend_at` | The cooldown, computed in SQL from the constant in R34. |
| `invited_address` | The full address, **only while `address_current` is true**: the address is still on that person's file, so the caller can already read it through `contact_methods`. Null otherwise, so the reader never surfaces an address that has left the record (for example a typo's stranger). |
| `address_current` | R27's predicate, evaluated without locking. It drives "the address changed, send again". |
| `outcome` | Only for `blocked`: `membership_ended`, `person_merged`, `person_deceased`, or **`needs_support`** for `person_elsewhere`, `person_linked_elsewhere` and `ambiguous_person`. Those three depend on other organisations' rows or on account state, so they are collapsed (the F155 rule and DECISION-189). |
| `queue_status`, `queue_delivered_at`, `queue_bounced_at`, `queue_complained_at` | The inputs `deliveryState()` takes, and nothing else from `email_queue`. |

**Never returned:**
- `token_hash`;
- `email_queue.to_email`, subject, bodies, `provider_message_id` or `failure_reason`;
- `created_by_user_id` (a `sent_by_you boolean` is acceptable if the UI wants it);
- the raw `blocked_reason`;
- any row from another org.

**Confirmed against the live catalog.** `email_queue` has no RLS and no `organization_id` column, and `presby_app` holds full DML on it. That is the known F152/F154 posture, and this reader adds no exposure:
- It joins only `q.id = i.email_queue_id`, from invitation rows already filtered to `i.organization_id = presby_current_org()`. That is F152's anchoring condition. It never joins by address.
- `presby_app` holds no privilege at all on `account_invitations`, so no tenant-side path can bypass this function to reach the table.

**Actions take a person, not an invitation id.** Resend and revoke take `p_person_id`. Under R28 there is at most one open `sign_in` row per (org, person), so the UI never handles an invitation id. One less id the client can tamper with.

### Brief rulings

**G7: cross-organisation reach (F195). Accepted, and widened.**
- **R31. Wider scope.** Refuse at issue when the person has **any** `memberships` row at another organisation, live *or ended*. An org-issued login then binds only a person whose entire history is with the issuing org.
  - Linking to a person with an ended membership elsewhere would show the account holder that person's dated history there (the four-way miss on a deep link). If the mailbox is wrong, a stranger learns it.
  - The cost is nil today: `memberships_guard_insert` refuses a second membership unless the `app.person_claim_authorized` claim is armed. Only `0009`, `seed-dev.sql` and the tests set it, and no `presby_claim_person()` exists.
  - The branch has 3 multi-membership people, all fixtures.
- **The cross-org subset check becomes moot.** With R31 in place, the analyst's request that R21's subset check also cover grants and offices at other orgs falls away: such a person is refused, and authority elsewhere requires an active membership elsewhere. Pin R31 with a test instead.
- **Acceptance re-checks the same predicate** and blocks as `person_elsewhere` if a membership elsewhere appeared after issue.
- **Sender-visible outcome: `needs_support`, not `person_elsewhere`.** The literal is shared with the R30 collapse ("This needs help from PresbyPortal support. Send us a ticket.").
  - **Accepted residual:** the signal still depends on another org's rows. It is bounded because, today, only the claim flag can create such a row, and no production code writes it.
  - When a claim path is built (the pastor case in Increment 2's known limit), revisit this ruling.

**G5: no name before sign-in (F194). Accepted, with one amendment.**
- **Preview:**
  - For `sign_in`, `presby_preview_invitation` takes the person **only from `v_inv.person_id`**. It never runs the address-match block that lets a non-treasurer row resolve a person by address (`0059:858–879`). The invitee name columns are null (R19: no names carried).
  - **Amendment:** return `person_display_name` **only when `session_matches` is true**: the signed-in account's email equals the invited address. That supports F5's "Accepting as {Name}". Anonymous preview gets null.
- **Accept:** the `sign_in` branch likewise never matches by address.
- **FA and treasurer** behaviour is unchanged (parity golden).

**G9: limits. Accepted, with the cross-org rule.**
- **R32.**
  - Org origin: 30 per organisation and 30 per inviter per 24 hours.
  - **Each origin counts only its own rows** for the organisation and inviter buckets.
  - `issue.ts`'s `overLimits()` (`issue.ts:336–357`) counts every row today and must gain `origin = 'platform'` in those two subqueries. Without that, tenant sends use up the platform's 10 designation sends, which defeats R20's split.
- **Per-recipient bucket:**
  - **For org origin, count `(organization_id, email_normalized, origin = 'org')`, 3 per 24 hours.** It is never counted across organisations: otherwise a `rate_limited` answer to a tenant sender would depend on whether another org (or the platform) emailed that address. That is the F155 rule.
  - The platform's per-recipient count stays global. Its sender is a platform admin, so there is no tenant oracle.
- **Where limits run:** inside the issue definer, under the organisation row lock. `presby_app` cannot count the table.
- **Where the numbers live:** in one TypeScript constant, mirrored as SQL literals and pinned by a test (the `APPROVABLE_ROLL_ACTION_KINDS` pattern).

### Further rulings that 0064 needs

**R33: resend lineage for `sign_in` follows the person, not the address (F197).**
- **The defect:** `presby_account_invitations_guard_insert` refuses a resend whose address differs from its parent's (`0059:297–303`). The analyst's F2 ("re-read the current on-file address; this is the fix for a typo") and R27 both require the address to be able to change.
- **The fix:** in 0064, `create or replace` the guard so that, for `purpose = 'sign_in'`, the lineage compares organisation, purpose, origin, `person_id` and `resend_count = parent + 1`, **not** the address. Every other purpose keeps the address comparison verbatim.
- **Why not start a fresh chain on an address change:** that would reset the 5-resend cap each time the address is toggled.

**R34: vocabulary and shape constraints in 0064 (drop-then-add, the 0048 idiom):**
- **Purpose and origin:**
  - `purpose_allowed` adds `'sign_in'`;
  - `origin_allowed` adds `'org'`;
  - a new CHECK `(purpose = 'sign_in') = (origin = 'org')` ties them, so neither can drift alone.
- **Names and person:**
  - `names_by_purpose` adds `purpose <> 'sign_in' or (both names null)`;
  - `sign_in` requires `person_id is not null` at insert, either by extending `treasurer_has_person` or with a twin CHECK;
  - the insert guard refuses a `sign_in` row without a person.
- **Blocked reasons:** `blocked_reason_allowed` adds `'person_deceased'`.
- **The issue definer:**
  - reads the primary address in SQL (R20);
  - takes the sender-confirmed address **only as an equality guard** (`address_changed`).
- **Email queue:**
  - TypeScript pre-generates the `email_queue` id, and the definer stores it.
  - TypeScript then inserts the queue row **with `to_email` set to the address the definer returned**, never the client-posted string, in the same transaction.
  - `email_queue_id` is a plain uuid with no FK (0056 precedent), so this order works.

**R35: purpose routing is explicit everywhere (F196).**
- **The defect.** Each of these treats "not treasurer" as founding administrator, or "not founding administrator" as treasurer:
  - preview `0059:855/858`;
  - accept step 4 `0059:1069/1112`;
  - the step 5 apply `0059:1242/1247`;
  - the step 6 output `0059:1360`;
  - `accept.ts:285`.

  A `sign_in` row would run `presby_apply_founding_administrator` or `presby_apply_treasurer` and write an `org.treasurer.designated` audit row. That is an authority-bearing grant from a credential that must grant nothing (R22).
- **The fix:**
  - Every branch names its purpose and ends in `else raise exception … using errcode = 'internal_error'` (SQL) or a `never` exhaustiveness throw (TypeScript).
  - `PURPOSE_LABEL`, `ROLE_PHRASE` and `roleSummary` are already keyed by purpose, so typecheck catches them; the SQL needs the explicit default.
- **The test:** an accepted `sign_in` writes no `role_grants` row and no `org.*.designated` audit row, and `people.user_id` is the only domain write.

**R36: R23's link guard covers every linking branch.** `people_guard_user_link`'s marker must be armed around the `update people set user_id` in the shared step 5. That step serves FA, treasurer and `sign_in` alike, so the FA and treasurer paths keep working once 0064 lands. Run the parity golden after 0064, not only before it.

### G1 and the numbers

**G1:** this is F177, now live, not a new defect. Cite **F177**. The issue definer refuses visitors as `not_eligible` (and anyone under 18 by `date_of_birth`, the analyst's default), so F177 cannot be reached through 2b. Whether eligibility is also re-checked at acceptance is Phase 3's call; issue time is enough for the default.

**Findings: F192–F197 as requested.**

| # | Source | Finding |
|---|---|---|
| **F192** | G2 | An org-issued sign-in credential outlives the address it was sent to. Closed by R27. |
| **F193** | G4 | `account_invitations_open_address_uq` gives the wrong `already_pending` for shared and stale addresses on a person-keyed purpose. Closed by R28 and R29. |
| **F194** | G5 | `presby_preview_invitation`'s non-treasurer branch resolves a person by address and shows their name before sign-in. Closed for `sign_in` by the G5 ruling; FA is unchanged. |
| **F195** | G7 | `people`, `contact_methods` and `people.user_id` are global, so one org's invite could bind a login that reaches another org. Closed by R31. |
| **F196** | architect | Purpose routing falls through in preview, accept and `accept.ts`. Closed by R35. |
| **F197** | architect | The resend-lineage guard requires an unchanged address, which contradicts address correction. Closed by R33. |

- **G8 gets no number.** Nothing is wrong today; it is a missing capability, specified by R30.
- Increment 3 starts at **F198**.
- **No new DECISION numbers.** R27–R36 belong in **DECISION-207** (the org-issued sign-in credential). R36 belongs in **DECISION-208**.

## Invariants Touched

- **Permissions vs Flags, and credentials:** respected. No new key and no new flag. The `sign_in` credential grants nothing, and R35 makes that a property of the code paths rather than an assumption. The reader is gated on `people.manage` (a permission). The card rides the Community toggle (R25).
- **Isolation Is a Database Property / F26:**
  - Every new definer takes the org from `presby_current_org()` and pins `search_path` with `pg_temp` last.
  - The reader anchors `email_queue` through this org's invitation rows (F152).
  - `presby_app` stays without any privilege on `account_invitations` (verified with `aclexplode`).
- **Two Hierarchies:** respected. No platform predicate is involved. R31 keeps an org's credential from reaching any other org's rows.
- **Composite Tenant Keys:** the new unique index includes `organization_id`, and `person_id` already has the composite FK to `memberships`.
- **No enumeration:**
  - The sender never sees `users` state (R29, R30) or other orgs' state (R31, R32, the `needs_support` collapse).
  - The invitee sees `dead` for every non-serving state, now including a changed address (R27).
- **Never Hard-Delete / all deletes are soft:** revoke and supersede only. The insert, update and delete guards are unchanged except R33's lineage arm.
- **The Brand Is a Cascade Override:** unaffected. `(invite)` stays platform-palette.
- **Verify in a Browser:** the card, its three dialogs and the marker, at 360px.

## Notes (Phase 3 must honour)

1. **0059 is in production.** Every change in 0064 is a forward fix: drop and re-add for CHECKs, drop and re-create the index under the same name, `create or replace` for functions. Run 0064 on a throwaway branch against the FA and treasurer parity golden **and** `scripts/test-rls.sql` before it reaches the pipeline branch.
2. **Pin by test:**
   - the issue refusal vocabulary (G3), including `address_changed`, `address_shared` and `needs_support`, against the SQL literals;
   - the R30 output columns (a closed column list);
   - the R32 constants;
   - that an accepted `sign_in` writes no grant (R35);
   - R27 in both directions (address still on file accepts; address changed returns `dead` and preview returns zero rows);
   - R31 with a fixture person who has a membership at two orgs.
3. **Measure before DDL:** every writer of `people.user_id` and of `users` on the `presby_app` side (carried from R23 and R24), plus the person-edit write order (R27).
4. **Suggestions (Phase 3's call):**
   - **S6.** Consolidate the near-identical actor helpers into one `presby__actor_holds(org, user, key)`. There are already three (`presby_giving__actor_holds`, `presby_participant__actor_may_propose`, and Increment 2's roll helper); 2b would add a fourth.
   - **S7.** A purpose filter on platform revoke-all (analyst's rollback caveat).
   - **S8.** An `openSignInInvitation: true` stamp on the `person.updated` audit row when an email changes while a `sign_in` row is open (analyst's detection hint, which strengthens R21's residual).
   - **S9.** An expression index on `contact_methods (lower(btrim(value))) where kind = 'email'`, if R27, R29 and the reader show up in query plans. The existing index is on `lower(value)` without the trim.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2b · 2 — Architect addendum | architect | Complete. G2, G4 and G8 ruled (R27–R30); G5, G7 and G9 accepted with amendments (R31, R32); two defects found in the 0059 code (R33, R35) plus R34 and R36; F192–F197 assigned (G1 cites F177; G8 unnumbered); no new DECISION numbers | Approved with suggestions | 2026-10-22 |

## Handoff

Next agent: **tech-lead (Increment 2b, Phase 3)**. Design to R19–R36 and G1–G9 as ruled above, and take the Note 3 measurements first. F196 and F197 must be closed in 0064 before any `sign_in` row can be inserted. The orchestrator records F192–F197 and confirms Increment 3 starts at F198 and DECISION-209.

I wrote nothing. The only database access was read-only (`default_transaction_read_only=on`) against the pipeline branch (`ep-jolly-boat-axklya0l`). It read:
- `aclexplode` grants for `presby_app` on six tables;
- RLS flags;
- `pg_policies` on `people` and `contact_methods`;
- `account_invitations` indexes;
- triggers on `people`, `contact_methods`, `memberships` and `users`;
- the `email_queue` columns;
- `presby_guard_membership_insert`;
- the actor helpers;
- counts of multi-membership people, shared addresses and multiple primary emails.

Nothing touched production or `development`.

Files read:
- `/Users/cshenso/git/presby-platform/presby-fadir/docs/work-log/2026-10-22-founding-admin-directory.md` (my Increment 2 Phase 2 section, R19–R26)
- `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/community-inc2b-phase1.md`
- `/Users/cshenso/git/presby-platform/presby-fadir/drizzle/0059_presby_account_invitations.sql`
- `/Users/cshenso/git/presby-platform/presby-fadir/src/lib/onboarding/accept.ts`
- `/Users/cshenso/git/presby-platform/presby-fadir/src/lib/onboarding/issue.ts`
- `/Users/cshenso/git/presby-platform/presby-fadir/src/lib/onboarding/status.ts`
- `/Users/cshenso/git/presby-platform/presby-fadir/docs/work-log/_template.md`
- `/Users/cshenso/git/presby-platform/presby-fadir/docs/decisions.md` and `/Users/cshenso/git/presby-platform/presby-fadir/docs/schema-design-2.md` (searched for the F152 and F154 email-queue posture)


---

# Increment 2b — Phase 3: Technical Design (tech-lead)

*Written 2026-10-22 by tech-lead against the live tree of the `presby-fadir` worktree and a read-only measurement of the pipeline Neon branch (`ep-jolly-boat-axklya0l`, owner connection, `default_transaction_read_only = on`; nothing was written, nothing touched production or `development`). Designed to R19-R36 and G1-G9 as ruled, with the operator's 2026-10-22 rulings honoured. Three places depart from the architect's wording (R21 widened, R23 narrowed, R24 replaced); each is marked **departs** and argued from a measurement. The architect reviewed all three in Phase 3a and accepted them with amendments (A1-A5, E1, S10), which are folded in place below; the operator's F177 ruling (Option 3, "Warn and confirm") is folded in too. See "Amendments folded (Phase 3a)". No Rule 16 shared file is edited; every edit to one is staged for the orchestrator. No implementation code is written; SQL here is contract (signatures, check order, vocabularies), not bodies.*

## Amendments folded (Phase 3a)

The architect's Phase 3a review (the addendum at the end of this file) accepted all three departures with amendments, and the operator ruled on F177 ("Warn and confirm", Option 3). Both are folded into this section in place: no new phase, no new migration, no new finding or decision number, and no change to batches, implementers, function signatures, the Copy section or the order of 0064's sections beyond what is listed. Each changed paragraph below names its amendment.

| ID | What changed | Where it now reads |
|---|---|---|
| A1 | The user-link guard refuses every role that is not the table owner (deny by default), not only `presby_app`. The owner is looked up as `pg_class.relowner` for `TG_RELID`, compared with the oid of `current_user`; no role name appears in the trigger. | Refinement 1; Measurement 1; 0064 section F186 and F187; Test Plan 1.3; DECISION-208; F186 |
| A2 | The owner path is covered by a source scan, not a marker: no non-test file under `src/` writes `userId` in a `people` insert or update, apart from the fixtures in `src/lib/testing/`. Recorded in DECISION-208 as the mitigation of the owner-path `paper` residual. | Refinement 1; Library > Boundaries; Test Plan 1.8; Edge Cases 18; DECISION-208 |
| A3 | Release-note honesty: the link claim is qualified with "from a congregation's side". | Release-note risk lines |
| A4 | The sender rule's set T is built directly from `role_grants` (person arm, and managed-group arm joined to `group_memberships`) with `ends_on is null or ends_on > current_date` on every row and **no `starts_on` bound**, so future-dated grants and memberships count. The sender's own set stays as of today. | Refinement 3; check 6; Test Plan 1.1; DECISION-207 |
| A5 | Derived groups are a closed list: `membership_source = 'derived' and derived_from in ('active_membership','session','diaconate')`. A new derived kind falls into T until it is classified (fails closed); pinned by test. The commission and delegation sources (resolver arms 3 and 4) are left to R31, which runs first. | Refinement 3; check 6; Test Plan 1.1; DECISION-207 |
| E1 | The re-created `presby_accept_invitation` maps `users_email_lower_uq` to `account_exists` in step 5, for every purpose, beside `users_email_unique`; pinned by the existing mapping-table source scan and a two-connection race test. | Preview and accept; Test Plan 1.4 and 3; DECISION-208 |
| S10 | F187 is recorded as **narrowed, not closed**, under its as-raised title: the case-variant is closed, the definer-mediated email change stays open (TODO). | Refinement 2; Drafted findings; Edge Cases 19; DECISION-208 |
| F177 | Option 3 is **operator-confirmed** ("Warn and confirm", 2026-10-22), and the architect's four conditions are design requirements: (1) the definer enforces `needs_acknowledgement`; (2) the audit row records `acknowledged` in the same transaction; (3) the visitor test is pinned equal to the Community Visitors list's test; (4) F177 stays open, with Option 1 plus a visitor baseline role as the first item of Increment 3's Phase 2. Staff anchors reading the directory is accepted on purpose. The release note keeps "narrower view in a later release". | F177 section; check 10; Test Plan 1.1 and 1.7; Edge Cases 4; DECISION-207; Release-note risk lines |
| Measurements | The branch measures 95 users and 95 distinct lowered emails (the first reading of 31 was low). Production measures 0 case-duplicate email groups (orchestrator, read-only, 2026-10-22), so `users_email_lower_uq` applies cleanly. No suite sets role `presby_platform` (grep), so A1 breaks no fixture beyond the `presby_app` ones already listed. | Measurements 1 and 2; Data Model header |
| Consequence recorded | A tenant role bound to the Session group reaches an invitee through a sender who holds `officers.manage` but not that role's keys. This is Increment 2's self-constitution residual seen from the other side, recorded rather than made a new rule. | Refinement 3; Edge Cases 20; DECISION-207 |

**Facts on record at kickoff.** (1) Increment 2 Phase 4 has not started in this tree, so 0062 and 0063 are not on the branch and Increment 2's files (`session-state-banner.tsx`, `getSessionApprovalState`, the pastor offices) are referenced by their Increment 2 design names. 2b depends on none of 0062/0063's SQL; it depends on their *files* (the Session banner and the edit page's connection card) for UI composition only. (2) DECISION-206 (pastors on the Session) is confirmed by the operator ("Yes, include them"). (3) Production measurement from the orchestrator: 1 person linked to a user, 70 `users` rows.

## Summary

Let a congregation's administrator invite a person already recorded at that congregation to sign in, one person at a time, from that person's own edit page. The invitation is addressed to the person's on-file primary email, never a typed address; the link works once and expires in 7 days; accepting connects a login to that person record and grants nothing, so the person can do exactly what their existing records already allow. Migration **0064** adds the `sign_in` purpose and `org` origin to `account_invitations`; closes two latent defects in the shipped 0059 code before any such row can exist (F196 purpose routing, F197 resend lineage); re-creates preview and accept with an explicit `sign_in` branch (address re-check, no pre-sign-in name, same account gates); adds four `SECURITY DEFINER` functions on `presby_app` (issue, resend, revoke, and a closed-shape state reader) plus a shared eligibility core; makes the user-to-person link a database property against every non-owner database role (F186); and adds a case-insensitive uniqueness on `users.email` (F187, replacing the revoke R24 proposed, which the measurements rule out; F187 is recorded as narrowed, not closed). The org-side library, three server actions, a "Sign in" card on the edit page, an admin-only "Can't sign in yet" marker on Community rows, the Session hand-off in Increment 2's banner, and a masked org-sent panel with a purpose-scoped revoke-all on the platform org page complete the feature. Visitors may be invited (operator ruling); F177 is handled by an explicit, audited acknowledgement at send (the operator's "Warn and confirm", Option 3, confirmed 2026-10-22; narrowing `active_membership` is deferred to Increment 3; see "F177: options and ruling").

## Operator rulings honoured

| Ruling | Design consequence |
|---|---|
| "Anyone but only people in the system can be invited." | The definer takes a `person_id`, never an address. Any person with a membership at the issuing organization is eligible, visitors included. Refusals exist only for states that make an invite meaningless or unsafe (ended, merged, deceased, already linked, cross-organization history, no usable address, authority the sender cannot bind). The analyst's visitor `not_eligible` refusal is **deleted** from the vocabulary. |
| No disconnect-after-accept in 2b. | No unlink action, no "Disconnect sign-in" copy. The card for a linked person says so plainly and points to support. The F186 trigger permits `non-null -> null` only for the owner and FK paths, so a later disconnect pipeline has a clean place to land. |
| One at a time; no bulk. | Every action takes one `personId`. The reader takes up to 500 ids only because the Community list renders a page of rows and the marker needs one batched read; it is not an action surface. The Session hand-off lists each seat with its own link. |
| Marker placement: Community list, person edit page, Session hand-off. | Three surfaces only. The Officers roster and the Staff page get nothing in 2b (TODO). |
| "Warn and confirm" on F177 (a visitor with a login reads the directory), Option 3, 2026-10-22. | The definer enforces `needs_acknowledgement` (reason `visitor`) until the sender confirms, and the audit row records `acknowledged` in the same transaction. Narrowing `active_membership` is deferred to Increment 3. See "F177: options and ruling". |
| Under 18: keep only with a stated reason. | **Dropped.** The analyst's reason was F177 (a login reads the directory), and that is not age-specific: youth members are already `directory.view` grantees by DECISION-065's own population, the same as every adult member. The realistic child case (a child sharing a parent's address) is already refused by `address_shared` (R29), and the case of a child with their own on-file address is the case "anyone" was ruled to allow. No acknowledgement either: an age acknowledgement would be a refusal wearing a checkbox. The decision records this as a stated non-gate (DECISION-207). |

## F177: options and ruling

`active_membership` mirrors **every** membership row into the group the baseline `member` role (`directory.view`, `events.view`) is bound to (measured: trigger `memberships_sync_derived_group`, no engagement or roll condition; 16 groups on the branch). DECISION-065 states this on purpose: "any current `memberships` row" is the grantee population, and "a first-time visitor with a live row can be granted the *ability* to browse the directory ... without themselves being *published in* it". With no way to link a login to a person that was an abstraction; 2b makes it a real person with a real login. What a visitor with a login then reads is the privacy-filtered member directory: names, and for each member the email, phone and address they have not hidden (DECISION-064 defaults: email, phone and address visible; birthday hidden), plus the calendar.

| Option | What it is | Cost | Effect for the invited visitor | Verdict |
|---|---|---|---|---|
| **1. Narrow `active_membership`** | `presby_sync_derived_membership_group()` stops writing a group row for engagement `visitor` with no roll, ends the existing ones, and re-includes on the update that gives a roll (approval) or changes engagement. | One more 0064 section (function replace, backfill by `ends_on`, never delete), about six DB tests, one e2e, an amendment of DECISION-065's grantee half. Roughly a third more in Batch A. The orchestrator must measure production visitors first (the branch has none; the Community Visitors list only just shipped). | A hollow login: signs in and sees nothing, not even the calendar, until received as participant or member. | Right end state, wrong increment. It reverses a recorded decision and only becomes useful together with a purpose-built visitor baseline (calendar only), which is a design of its own. |
| **2. Accept and record** | Do nothing in code; name the exposure in DECISION-207 and the release note. | Zero. | A visitor reads the member directory, and the sender is never told. | Too quiet. The person who sends the invitation is the only human in the loop and would not know. |
| **3. Accept, with an explicit audited acknowledgement at send (OPERATOR-CONFIRMED)** | The definer returns `needs_acknowledgement` with reason `visitor` until the sender confirms; the dialog says in plain words what a signed-in visitor can see; the audit row records `acknowledged: ['visitor']`. It is the existing `do_not_contact` precedent (a one-time consequence the sender must own), reusing one mechanism. | One reason code, one dialog paragraph, one audit field, two tests. No migration cost beyond the definer's check. | Works as the operator ruled; the congregation's administrator chooses it knowingly, per person, on the record. | **Confirmed by the operator, 2026-10-22 ("Warn and confirm"); endorsed by the architect (Phase 3a).** |
| 4. App-level special case in `getDirectory()` | Refuse the directory to a viewer who is a visitor with no roll. | Small. | Hollow, as option 1. | **Rejected.** A permission that the resolver grants and one function quietly withholds is exactly the "platform disagrees with itself" drift DECISION-065 warns about, and it is paper. |

**Ruling (operator, 2026-10-22: "Warn and confirm"; architect endorsed in Phase 3a): Option 3 is built in 2b. Operator-confirmed.** The acknowledgement is a **disclosure, not a control**: it reduces no exposure, and DECISION-207 and the release note say so plainly. Option 3 fits DECISION-065, which names visitors as grantees of the ability to browse the directory, so a visitor login reading tier-1, privacy-filtered directory data is inside the tier model; Option 1 reverses a recorded decision and needs a visitor baseline role designed alongside it, which is why it waits for Increment 3. The architect's four conditions are design requirements, not suggestions:

1. **The definer enforces `needs_acknowledgement`, not the UI.** It is check 10 of `presby_sign_in__check`: a call for a visitor with `p_acknowledged = false` returns the outcome with nothing written, whatever the client rendered.
2. **The audit row records `acknowledged` in the same transaction.** The value written is the `ack_reasons` the definer returned with `ok`, never the client's own flag (a client that ticks the box for a non-visitor records an empty list), written by `insertAuditRow` in the send transaction, so a forced throw rolls the whole send back (Test Plan 1.7).
3. **The visitor test equals the Community Visitors list's test**, pinned by a test that runs both predicates against the same fixture matrix (Test Plan 1.1).
4. **F177 stays open.** 2b cites it and does not close it. Option 1 plus a visitor baseline role (events only) is filed as the **first item of Increment 3's Phase 2** (TODO), which already owns visitor follow-ups.

Two notes for the record. **Staff anchors with no roll reading the directory is accepted on purpose**, not overlooked: F177 also covered them, and Option 3 asks for an acknowledgement for visitors only because a staff anchor's directory access is part of the job (DECISION-207). And **when Option 1 lands it takes directory access away from visitors who accepted under Option 3**; the release note's "narrower view in a later release" sentence sets that expectation and stays. The delta for Option 1 is the section "F177 Option 1: the Increment 3 delta, not built in 2b" near the end.

## Rulings on S6-S9

| # | Ruling | Why |
|---|---|---|
| S6 | **Adopt for new code only.** One new helper `presby__actor_person(p_org, p_user_id, p_key) returns uuid` (owner-only, no grant) returns the sender's live person id when that person is an active member holding the key. 2b's four definers use it. The existing helpers (`presby_giving__actor_may_record`, `presby_participant__actor_may_propose`, Increment 2's `presby_roll__actor_holds`) are **not** consolidated here. | 2b needs the sender's person id (for the subset check and the email's sender name), which the boolean helpers do not return. Consolidating means `create or replace` of two shipped migrations' helpers for no behavioural gain; TODO. |
| S7 | **Adopt.** `revokeAllOpenInvitations` gains a required `scope`: `designations` (platform-origin rows, today's button) or `org_sent` (org-origin rows). | The analyst's rollback caveat: the kill lever for a tenant abuse must not also cancel a pending treasurer or founding-administrator invitation, and the designation button must stop sweeping org rows (F198). |
| S8 | **Replace.** The `person.updated` audit row is written in the same transaction and stamps `emailChanged: boolean` (F199); no open-invitation flag. | The R21 residual's detection chain is `tenant.person.updated` -> `invitation.created` -> `invitation.accepted`, joined on `personId`, all of which are already ids in the rows. The stamp tells a reader which update to look at. Computing "an invitation is open" inside `updatePerson` would need the reader (and a `users.id` it does not have) for no extra signal. More important: that audit row is today written by `recordAudit()` after commit, which swallows failures, so the detection signal for a named paper residual can silently not exist. Moving it in-transaction is cheap and is F199. |
| S9 | **Adopt.** `contact_methods_email_norm_idx` on `(lower(btrim(value))) where kind = 'email'`. | R27, R29 and the reader all compare on `lower(btrim(value))`; the existing index is `lower(value)`, which Postgres will not use for that expression. Table is small today; the index is one line and removes a scan from `address_shared`. |

## Refinements to the architect's rulings (the departures are the point)

1. **R23 narrowed (departs; amended by A1 and A2): the link guard binds every role that is not the table owner, and has no marker.** Measured (Measurement 1): application code on `presby_app` never writes `people.user_id` (`people.ts:810` sets name columns only; `people.ts:467` inserts none); the only legitimate writer is `presby_accept_invitation`. The owner path writes it in about ten fixture sites (`seed-dev.sql` four statements, two of them in a Rule 16 file; `invitation-fixture.ts:124`, `giving-fixture.ts:243`, `people.test.ts:313`, `roll.test.ts:313/331`, `participant-roll.db.test.ts:159`, two e2e fixtures), and a marker would force every one to arm it. A marker also does nothing against `presby_app`: any `presby_app` statement can `set_config` the same GUC, so a marker-only guard is not a guard on the one connection the finding is about (the architect measured the same on the branch: `presby_app` holds UPDATE on `people`, including column-level UPDATE on `user_id`, and accepted the markerless shape). So `people_guard_user_link` (BEFORE INSERT OR UPDATE OF `user_id`) **refuses a link transition whenever `current_user` is not the owner of `people` (A1)**, and is not written as `current_user = 'presby_app'`. The catalog shows why: `presby_platform` also holds INSERT and UPDATE on `people`, including `user_id`; it is NOLOGIN today, but 0043, 0044 and 0059 all expect it to become a real login one day, and a rule that names one role leaves every other non-owner role, including any role added later, able to write the link. Deny by default costs the same, because fixtures, the FK `SET NULL` action (run as the table owner) and every definer already run as the owner. The owner is looked up, never named: `pg_class.relowner` for `TG_RELID`, compared with the oid of `current_user`. Inside `presby_accept_invitation` (SECURITY DEFINER, owner) `current_user` is the owner, so the shared step 5 needs no marker and R36 holds trivially. **Residual, `paper`:** the owner path (platform pages, fixtures) is not bound; measured, no platform code writes the column. **Mitigation (A2), at no fixture cost:** a source scan in `boundaries.test.ts` fails when any non-test file under `src/` writes `userId` in a `people` insert or update, apart from the fixtures in `src/lib/testing/`. A marker on the owner path would only ever catch mistakes, since the owner can disable the trigger anyway, so none will be built; DECISION-208 records the scan as the mitigation.
2. **R24 replaced (departs; accepted by the architect, with the required edit E1): no revoke, no non-forgeable trigger; a case-insensitive unique index instead.** Measured (Measurement 2): `presby_app` legitimately writes `users` on seven app paths (name, password change and reset, email change after verification, activation, lockout counters, 2FA requirement, last login) and the NextAuth adapter inserts and deletes, so "revoke if none exist" fails. A trigger on `users.email` cannot tell the legitimate verify-email update from a forged one: both are `presby_app` updates, and the verification table it would consult is itself writable by `presby_app`. The exploitable hole is narrower than "anyone can rewrite an email": acceptance needs the raw token, so rewriting your own email only helps an existing-account holder who holds a forwarded token, and `users_email_unique` already stops the rewrite colliding with the real owner's account **except by case** (it is case-sensitive; `Jane@x` and `jane@x` are different rows, and acceptance matches on `lower(email)`). `create unique index users_email_lower_uq on users (lower(email))` closes exactly that, with a stop-block in 0064 that counts case-duplicates and refuses to apply. The branch has 95 users and 95 distinct lowered emails (the architect's measurement; the first reading of 31 was low); production has 0 case-duplicate email groups (orchestrator, read-only, 2026-10-22), so the index applies cleanly there, and the stop-block still guards any other environment. **The index does more than the first draft claimed (architect):** the 0059 comment at `drizzle/0059_presby_account_invitations.sql:1056-1060` names a race that is open today (in new-account mode the `lower(email)` existence check is not a lock, and `users_email_unique` only stops exact-case collisions); the index closes it, and makes the identity match in acceptance step 3 deterministic. **Required edit E1:** the re-created `presby_accept_invitation` maps `unique_violation` by constraint name, and only `users_email_unique` maps to `account_exists`; after 0064 the race above raises `users_email_lower_uq`, which would be re-raised and surface as `db_error`. So step 5's arm names both constraints, for every purpose, inside the full re-creation (safe: the FA and treasurer parity golden does not exercise this race). **Behaviour change (recorded in DECISION-208):** a Google sign-in whose address is a case-variant of an existing account now fails at the adapter's insert instead of quietly creating a second account, which is the intended direction; the verify-email path already catches any 23505 by error code (`verify-email/[token]/page.tsx:96`), so nothing changes there. **F187 is recorded as narrowed, not closed (S10):** the case-variant is closed; the definer-mediated email change stays open and `paper`: an application bug on `presby_app` can still rewrite someone else's `users.email` to an unused address (an account-takeover vector independent of invitations, the F38 family). The real fix is moving email change into a definer that consumes its verification token, an account-area pipeline (TODO).
3. **R21 widened (extends; amended by A4 and A5).** The sender-authority rule is "bind a login only to a record whose authority you could have created yourself". R21 named person-arm grants and court offices. A person can also hold authority through a manual group's grant, and a derived court group is authority too. The rule is stated on **permissions**: let T be the set of permission keys the person holds through (i) person-arm `role_grants` rows, and (ii) `role_grants` rows of any group the person belongs to (via `group_memberships`) that is **not** a derived group. T must be a subset of the sender's own effective permissions **as of today** (`exceeds_your_access`): you may not lend authority you do not yet hold.
   - **Time window (A4).** T counts every row, grant and membership alike, with `ends_on is null or ends_on > current_date` and **no `starts_on` bound**, so a future-dated person grant, a future-dated managed-group grant and a future-dated managed-group membership all count. T is therefore built directly from `role_grants`, `group_memberships`, `groups` and `app_role_permissions`, not from `presby_effective_permissions(..., current_date)`, whose `starts_on <= p_as_of` filters would drop exactly those rows. (The branch has 0 such future-dated rows today, so this is about getting the shape right.) The sender's own set may use the resolver as of today.
   - **Which groups are derived (A5).** A closed list: `membership_source = 'derived' and derived_from in ('active_membership','session','diaconate')`. Any new derived kind therefore falls into T (fails closed) until someone classifies it; the list is pinned by test.
   - **Why the exclusions are sound.** `active_membership` is exactly right: the sender is an active member holding `people.manage`, so holds every permission granted through `active_membership` as well, and T minus that baseline loses nothing. `session` and `diaconate` are gated separately and earlier: a person holding any open or future seat in either requires the sender to hold `officers.manage` (`needs_officers_permission`, check 5), which matches Increment 2's self-constitution residual (an `officers.manage` holder can already create the officer term that gives that authority). **Known consequence, recorded in DECISION-207 rather than made a new rule:** a tenant role bound to the Session group reaches an invitee through a sender who holds `officers.manage` but not that role's keys.
   - **Commission and delegation (resolver arms 3 and 4) are not modelled.** They reach only people with a membership at another organization, and R31 (`needs_support`, check 4) refuses those before checks 5 and 6, so T need not model them; the R31 test covers it (Test Plan 1.1).

   This lets the founding administrator invite an elder (the purpose of 2b) and still refuses a `people.manage`-only holder, a treasurer, or a person on a manual finance group the sender cannot administer.
4. **The on-file address is the person's one primary email** (R20 said "on-file primary"; this fixes the edge cases). Exactly one primary email contact method: that is the address. None: `no_email_on_file`. More than one primary: `address_ambiguous` (the analyst's `several_emails_none_primary` described a case the edit form cannot produce, since typing an email into Profile creates the primary; the name is replaced and the analyst's copy kept). A single non-primary email is therefore "no address on file" for this purpose, matching what the edit form shows. Acceptance (R27) is deliberately wider: any email contact of the person still on file passes.
5. **R27 is two checks.** An unlocked currency check immediately after the invitation is re-validated, returning `dead` for every outcome (so a stale link cannot be told apart from a dead one by the honest non-terminal outcomes `account_exists` and `email_mismatch`), and the locked `FOR SHARE` re-check in the person-gate step as the race-proof authority. Both write nothing.
6. **R30's closed column list is kept.** The marker's "holds inert authority" test (an open officer term, an open staff position, or an open person-arm grant) is read in TypeScript from RLS-protected tables the people-manager can already read, in the same transaction, not added as a reader column.
7. **R34 twin CHECK, named `account_invitations_sign_in_has_person`**, rather than editing the misnamed `treasurer_has_person`. New template key `account_sign_in_invitation`.
8. **R32 refined for the platform side.** `overLimits()` counts `origin = 'platform'` in all three of its subqueries, including per-recipient (R32 said the platform's per-recipient count "stays global"; global across organizations is preserved, but a tenant's sends must not spend a platform designation's per-recipient budget either). Identical numbers today, since no org rows exist yet.
9. **`AcceptResult.blocked` carries `purpose`** so the invitee copy can differ by purpose (G6) without changing the shared reason vocabulary.

## Measurements

Pipeline branch, read-only, 2026-10-22. Production figures are the orchestrator's.

1. **Writers of `people.user_id`.** `presby_app` application code: none. Platform connection code: none. Definer: `presby_accept_invitation` only (0059 step 5: the `created_person` insert and the `linked_person` update). No people-merge writer exists (the only merges are `giving_donors`). Owner-side fixtures: `seed-dev.sql:731,759,828,1314`; `src/lib/testing/invitation-fixture.ts:124`; `src/lib/testing/giving-fixture.ts:243`; `src/lib/people.test.ts:313`; `src/lib/roll.test.ts:313,331`; `src/lib/db/domain/participant-roll.db.test.ts:159`; `e2e/support/domains-ui-fixture.ts:148`; `e2e/support/giving-fixture.ts:136`. **`presby_app`-side SQL suites that link persons:** `scripts/test-rls.sql` section 44 (inserts near `:8008`, `:8198`, `:8202`) and `scripts/giving/test-rls-46.sql` (updates at `:646, 955, 987, 1400, 1507, 1547, 1565, 1626, 1683`). These are the only fixtures the guard breaks: A1 widened it to every non-owner role, and a grep finds no suite that sets role `presby_platform` (it holds INSERT and UPDATE on `people`, including `user_id`, but is NOLOGIN), so nothing more breaks. `presby_app` holds table-level `INSERT, SELECT, UPDATE` on `people` (no column list); the only trigger on `people` is `people_guard_delete`; the update policy is tenancy-only. The FK `people.user_id -> users` is `ON DELETE SET NULL`, run as the table owner, so a user deletion is unaffected by a `current_user` guard.
2. **`presby_app` writers of `users`.** UPDATE: `(account)/account/actions.ts` (name, password), `(email-verify)/.../verify-email/[token]/page.tsx` (email, after a token), `(password-reset)/actions.ts` (password, lock counters), `(admin)/admin/users/actions.ts` and `[id]/actions.ts` (activation, lockout, 2FA requirement), `src/auth.ts` (lock counters, last login). INSERT and DELETE: the NextAuth `DrizzleAdapter`. `users` has no RLS; `presby_app` holds `SELECT, INSERT, UPDATE, DELETE`. Indexes: `users_email_unique` on `email` (case-sensitive). Branch: 95 users, 95 distinct `lower(email)` (architect, Phase 3a; the design's first reading of 31 was low). Production: 70 users in the earlier count and 0 case-duplicate email groups (orchestrator, read-only, 2026-10-22), so the index applies cleanly; the migration still stops on any.
3. **Person-edit write order.** `updatePerson()` writes `people`, then `contact_methods` (email, then phone, in-place `UPDATE` of the primary row or insert/delete), then `addresses`, then `memberships`. Acceptance locks organization, invitation, users, person, contact method. Both take the person row before any contact row, so no lock-order inversion: an edit that starts after accept holds the person lock waits on the person row before touching a contact row. An in-place `UPDATE` of the email value blocks on accept's `FOR SHARE` contact lock and, if the edit commits first, accept's READ COMMITTED re-check finds no match and answers `dead`.
4. **Who gets the baseline.** 16 `active_membership` groups; the only group-arm grant on them is the `member` role (`directory.view`, `events.view`). Memberships on the branch: 31 live regular with a roll, 19 live regular without, 2 ended, **0 visitors**. DECISION-064 privacy defaults: hide email, phone, address false; birthday true.
5. **People.** 748 people; 20 linked to a user; **69 unlinked people hold an open officer term, staff position or person-arm grant** (the marker's reach on this data); 9 under 18 by date of birth, 698 with no date of birth (so any age rule would have been a no-op for 93 percent of rows, another reason to drop it); 3 people with more than one membership (all fixtures).
6. **`account_invitations`.** Nine indexes; `account_invitations_open_address_uq` is named only in 0059, `invitations.ts`, the schema and DB tests, and `issue.ts` (its constraint-name mapping, kept by re-creating the index under the same name). `presby_revoke_designation_holder` (0060) reports open invitations filtered by `purpose = p_slot`, so org rows never leak into it. `presby_app` holds no privilege on the table.
7. **Platform-side purpose blindness (new, F198).** `listInvitationsForOrg`, `resendInvitation`, `revokeInvitation`, `revokeAllOpenInvitations` and `overLimits()` in `issue.ts` select by organization (and `overLimits` by nothing else), not by origin or purpose. Once org-origin rows exist the platform list would show full addresses of tenant-issued invitations (the platform view of org-sent mail is meant to be masked), the platform resend would render a founding-administrator email for a `sign_in` row, "revoke all" would sweep them, and tenant sends would spend the platform's 10 designation sends.
8. **Fixtures that contradict a new constraint.** `scripts/invitations/seed-dev-invitations.sql` rows are platform-origin founding-administrator and treasurer rows: they satisfy the purpose-origin tie and the names CHECK. Three of its rows are dated 2099, so every limit count must be bounded `created_at <= now()` (the 2099 hazard the platform count already handles). The only fixtures a new rule contradicts are the `presby_app` link writes in Measurement 1.
9. **e2e.** No spec asserts the edit page's card count, the Community markers, the `/invite` sign-in copy or the platform org page's org-sent panel (none exists). Existing specs that exercise code this change rewrites: see Test Plan 3.
10. **Email queue.** `email_queue` has no RLS and no org column; `presby_app` holds full DML on it (the F152/F154 posture, unchanged and not worsened: the reader joins only through this organization's own invitation rows). `insertQueueRowInTx` does not accept an id today.

## Feasibility check against the live tree

- **Signatures are valid SQL.** No new function takes a default parameter. `presby_preview_invitation(text, uuid default null)` keeps its shipped signature (the default is already the trailing parameter), so `create or replace` keeps its ACL. OUT column names are chosen not to collide with table columns (`invitation_expires_at`, `cancel_email_queue_id`, `recipient_first_name`), and bodies carry `#variable_conflict use_column` as 0059's do.
- **ALTER and DROP against dependents.** `account_invitations_open_address_uq` is dropped and re-created under the same name: no SECURITY DEFINER body names it (grep: 0059 comments only; `issue.ts` maps it by constraint name, preserved). The five CHECKs (`purpose_allowed`, `origin_allowed`, `names_by_purpose`, `blocked_reason_allowed`, plus two new) are drop-then-add (the 0048 idiom) and no function body names them; `presby_accept_invitation` writes `blocked_reason` values as literals, and `person_deceased` is added to the list before the function that writes it. `presby_preview_invitation` and `presby_accept_invitation` are `create or replace` with unchanged signatures and result columns. **The replacement bodies are derived from the LIVE definitions on the branch (`pg_get_functiondef`), not from the 0059 file**, because Increment 2 or a later fix may have replaced either; the implementer diffs the live text against 0059 first and records any difference. No column or table is dropped.
- **New CHECKs and triggers against fixtures.** The purpose-origin tie, the sign-in names CHECK and the sign-in person CHECK against `seed-dev-invitations.sql`, `invitation-fixture.ts`, every Vitest and e2e fixture and the branch's rows: pass (all platform-origin founding-administrator or treasurer rows). `users_email_lower_uq` against `seed-dev.sql` and the fixtures' emails: the branch has no case-duplicates, and the stop-block covers anywhere else. **`people_guard_user_link` contradicts the `presby_app` link writes in Measurement 1**, which are converted in Batch A (Test Plan 3), not left to QA. It does not touch any owner-side fixture, and because it binds by owner lookup rather than by role name it needs no change when a role is added. The trigger's owner test reads `pg_class.relowner` (readable by any role) and `current_user`'s oid, both valid inside an invoker trigger function; the FK `SET NULL` action runs as the table owner, so it passes. **A4's T query uses only columns confirmed in the live resolver (0010):** `role_grants.person_id, group_id, role_id, starts_on, ends_on`, `group_memberships.person_id, group_id, starts_on, ends_on`, `groups.membership_source, derived_from`. **E1's mapping arm** is an edit inside the full re-creation of `presby_accept_invitation`, on the same constraint-name `if` chain that already names `users_email_unique`.
- **New FKs.** None. The sign-in row uses the existing composite `(person_id, organization_id) -> memberships (person_id, organization_id)`, which carries the tenant on both sides, and the one new unique index leads with `organization_id`.
- **Dependency inside a function body.** The `FOR SHARE` lock on `contact_methods` and the unlocked currency read run as the owner inside the definers (`rolbypassrls`), so FORCE RLS on these tables does not filter them. The reader and issue core read `people`, `memberships`, `contact_methods`, `groups`, `group_memberships`, `officer_terms`, `role_grants`, `app_role_permissions`, `organizations` with an explicit `organization_id` (or the membership join) on every query; the definer bypasses RLS, so that predicate is the whole isolation, as in 0061.
- **Seeding order inside 0064.** CHECKs and the guard-insert function are replaced before any function that inserts a `sign_in` row exists; the `users` stop-block runs before the index; the preview and accept replacements come last.
- **Migration ordering.** `0059 < 0060 < 0061 < 0062 < 0063 < 0064`, never reordered. 0064 is additive for old code (FA and treasurer behaviour is byte-identical, the new CHECKs are satisfied by every existing row, the trigger refuses nothing old code does), so deploy order is 0064 first, then the code.

## Permissions & Flags

- **No new `FEATURES.*` key, no new tenant permission** (`src/lib/permissions.ts` stays frozen). Used, all existing: `people.manage` (every send, resend, cancel, read, marker and card); `officers.manage` (additionally, to invite a person holding a Session or Board of Deacons seat); the sender's own effective permissions (the subset test, R21).
- **The credential grants nothing.** It is the third mechanism (DECISION-147, DECISION-183): hashed, single-use, expiring, never mapped into `FEATURES.*`, a session claim or the resolver. Acceptance writes `people.user_id` and the matching email's `verified_at` and nothing else (R35, pinned by test).
- **Flags: none new** (operator memory: per-org toggles, no new platform flags before go-live). The card, the markers and the Session hand-off ride the existing `org_portal.members_create` flag and its organization toggle, exactly as the edit page and Community page already do. **Naming the coupling:** turning the Community toggle off hides the surfaces but does not stop a definer being called by a hand-crafted action POST; the page-and-action gate is the same paper control every Community mutation has, and the database-side kill levers are the platform's `org_sent` revoke-all (cancels every open org-sent invitation) and the limits.
- **Default role bindings:** none (nothing is seeded). A founding administrator (`people.manage`, `officers.manage`) can invite everyone the rules allow; a `people.manage`-only holder (the congregation's office administrator) can invite people who hold no authority beyond the baseline.
- **Rollback:** the Community toggle hides the surfaces; platform `org_sent` revoke-all kills open links; the functions, trigger and indexes are droppable. Already-sent links still accept (acceptance is token-only), which is why the revoke lever exists. **Forward-only caveat:** once any `sign_in` row exists the widened vocabulary CHECKs cannot be narrowed back (rows are never deleted), so a rollback leaves them in place, which is harmless.

## API Contract

### SQL: `drizzle/0064_presby_org_sign_in_invitations.sql` (Batch A)

Every new definer: `language plpgsql security definer set search_path = public, pg_temp`, `#variable_conflict use_column`, `revoke all ... from public, presby_app, presby_platform` then `grant execute ... to presby_app` for the four callable ones. The organization is always `presby_current_org()`; a null organization raises. The actor is a `users.id` bound server-side from the session (never from client input) and resolved by `presby__actor_person`. **Identity refusals raise one uniform literal** (`'account_invitations: this sign-in invitation action is not permitted'`, SQLSTATE `42501`, through a `presby_deny_sign_in_invitation()` raiser granted to `presby_app`, the 0052/0061 shape): no organization, a null actor, an actor who is not an active member holding `people.manage`. **State refusals are returned as typed outcomes**, exactly one row per call, id columns null and booleans false on a non-`ok` outcome.

Helpers (owner only, no grant):

- `presby__actor_person(p_org uuid, p_user_id uuid, p_key text) returns uuid` (stable, definer): the id of a live (`merged_into_id is null`) person with `user_id = p_user_id`, an active membership at `p_org` and `presby_has_permission(person, p_org, p_key)`; null otherwise. `people.user_id` is not unique, so it is `limit 1` over a deterministic order.
- `presby_sign_in__check(p_org uuid, p_sender_person uuid, p_sender_user uuid, p_person_id uuid, p_confirmed_address text, p_acknowledged boolean) returns table (outcome text, address text, recipient_first_name text, ack_reasons text[])`: the shared eligibility core issue and resend both call, so the two cannot drift. Check order, first failure wins (the order is the oracle defence: membership at this organization comes before any state answer):
  1. `not_found`: no membership of that person at this organization (another organization's person and a missing id are indistinguishable).
  2. `person_merged`, `person_deceased` (`date_of_death` set), `membership_ended`.
  3. `already_signs_in`: `people.user_id` is not null (this also covers the sender's own record).
  4. `needs_support`: the person has **any** membership at another organization, live or ended (R31), the one literal shared with the reader's collapse of `person_elsewhere`, `person_linked_elsewhere` and `ambiguous_person`.
  5. `needs_officers_permission`: an open or future seat in the organization's derived `session` or `diaconate` group (read from `group_memberships`, so whichever offices map there, Increment 2's pastors included, are covered) and the sender does not hold `officers.manage`.
  6. `exceeds_your_access`: refinement 3. T is built per A4 and A5 (every non-derived source, no `starts_on` bound, closed derived list) and compared with the sender's own effective permissions as of today. Check 4 runs first, so commission-only and delegation-only authority never reaches this check.
  7. Address: `no_email_on_file` (no primary email), `address_ambiguous` (more than one primary), `address_invalid` (the normalized address fails the table's shape CHECK or exceeds 320; this is the outcome the CHECK would otherwise surface as a database error), `address_changed` (`lower(btrim(p_confirmed_address))` differs from the resolved address).
  8. `address_is_yours`: the resolved address equals the sender's **own** `users.email` (lowercased) while the person is not the sender. The only `users` row the function reads is the sender's own; it never reads another user (DECISION-189).
  9. `address_shared` (R29): another live, unmerged person with a live membership at this organization has the address as any email contact method. Reads this organization's rows only and never `users`.
  10. `needs_acknowledgement` (condition 1: the database enforces this, not the UI): the reasons that apply are `do_not_contact` (the resolved address's contact row carries the flag; the existing precedent) and `visitor` (engagement `visitor` with no roll at this organization, the same predicate as the Community Visitors list, pinned equal by a test, condition 3). If any applies and `p_acknowledged` is false: this outcome with `ack_reasons`. When acknowledged, the reasons come back with `ok` so the audit row records exactly what the definer found (condition 2), in the sender's own transaction.
- `presby_deny_sign_in_invitation() returns void` (invoker raiser, as above).

Callable (granted to `presby_app`):

```sql
presby_issue_sign_in_invitation(
  p_person_id uuid, p_token_hash text, p_expires_at timestamptz, p_email_queue_id uuid,
  p_confirmed_address text, p_acknowledged boolean, p_issued_by uuid)
returns table (outcome text, invitation_id uuid, address text, recipient_first_name text,
               organization_name text, sender_name text, invitation_expires_at timestamptz,
               ack_reasons text[], existing_invitation_expired boolean)

presby_resend_sign_in_invitation(
  p_person_id uuid, p_token_hash text, p_expires_at timestamptz, p_email_queue_id uuid,
  p_confirmed_address text, p_acknowledged boolean, p_issued_by uuid)
returns table (outcome text, invitation_id uuid, cancel_email_queue_id uuid, address text,
               recipient_first_name text, organization_name text, sender_name text,
               invitation_expires_at timestamptz, ack_reasons text[], next_resend_at timestamptz)

presby_revoke_sign_in_invitation(p_person_id uuid, p_revoked_by uuid)
returns table (outcome text, invitation_id uuid, cancel_email_queue_id uuid)

presby_sign_in_invitation_states(p_person_ids uuid[], p_actor_user_id uuid)
returns table (person_id uuid, linked boolean, state text, sent_at timestamptz,
               expires_at timestamptz, resend_count integer, next_resend_at timestamptz,
               invited_address text, address_current boolean, outcome text,
               queue_status text, queue_delivered_at timestamptz,
               queue_bounced_at timestamptz, queue_complained_at timestamptz)
```

- **Issue** order: identity; `not_found` is inside the check; lock the organization row `for update` (the first writer in the lock order organization, invitation, users, person, contact method that accept uses); if the person has an **open** `sign_in` row, `already_pending` with `existing_invitation_expired` (the card then offers Send again; without this an expired open row would block with no way forward); `presby_sign_in__check`; the limits (below) as `rate_limited`; insert the row (`purpose 'sign_in'`, `origin 'org'`, `email_normalized` = the resolved address, both names null, `person_id`, `token_hash`, `created_by_user_id = p_issued_by`, `expires_at`, `email_queue_id = p_email_queue_id`); return `ok` with what TypeScript needs to render the email: the resolved address, the recipient's first name (`preferred_name` if present), the organization name, and the sender's display name from the sender's own person row. The audit row and the queue row are TypeScript's, in the same transaction.
- **Resend** order: identity; organization lock; the person's open row `for update` (none: `not_open`); `cooldown` (returns `next_resend_at` = `created_at + 5 minutes`); `chain_cap` (`resend_count >= 5`); `presby_sign_in__check`; limits; supersede the old row; insert the successor with `resent_from_id` and `resend_count + 1` (R33); return the superseded row's `email_queue_id` as `cancel_email_queue_id` so TypeScript cancels a still-queued email in the same transaction. The new row **re-reads the current address**, which is the fix for a typo.
- **Revoke** order: identity (`people.manage` only; cancelling is never an escalation); organization lock; the person's open row `for update` (none: `not_open`); set `revoked_at` and `revoked_by_user_id`; return `cancel_email_queue_id`. Revoke is terminal and refunds no limit (DECISION-189).
- **Limits (G9, R32), inside the organization lock, counting `origin = 'org'` rows only and bounded `created_at <= now()`** over a rolling 24 hours: 30 per organization, 30 per inviter, and 3 per `(organization, address)` (a tenant's per-recipient count never crosses organizations, the F155 rule). A resend counts as a send. The numbers live in one TypeScript constant and are mirrored as SQL literals, pinned by a test.
- **Reader (R30)**: gate is `presby__actor_person(org, user, 'people.manage')`; null raises the uniform literal. 1 to 500 ids, else it raises; an id with no membership at this organization is **omitted**, so it is indistinguishable from an id that does not exist. One row per eligible person. `linked` is `people.user_id is not null` (never from `users`) and takes precedence: `state = 'signs_in'`. Otherwise the state comes from the person's open row, else the newest non-superseded terminal row: `pending`, `expired` (open and past `expires_at`), `blocked`, `revoked`, or `none`. `invited_address` is returned **only while `address_current`** (the invited address is still one of the person's email contacts, evaluated without locking), so the reader never surfaces an address that has left the record. `outcome` is set only for `blocked`: `membership_ended`, `person_merged`, `person_deceased`, or `needs_support` (the collapse of the three cross-organization reasons). The four `queue_*` columns are the inputs `deliveryState()` already takes and nothing else from `email_queue`, reached only through `i.email_queue_id = q.id` from this organization's own rows. **Never returned:** `token_hash`, any `email_queue` address, subject, body, provider id or failure text, `created_by_user_id`, the raw `blocked_reason`, any other organization's row. A source scan on the migration pins the closed column list.

Closed vocabularies, pinned to the SQL `outcome := '...'` literals by a source-scan test (the `ROLL_DECISION_REFUSALS` pattern):

- **Issue and resend refusals** (`SIGN_IN_REFUSALS`): `not_found`, `already_signs_in`, `person_merged`, `person_deceased`, `membership_ended`, `needs_support`, `needs_officers_permission`, `exceeds_your_access`, `no_email_on_file`, `address_ambiguous`, `address_invalid`, `address_changed`, `address_is_yours`, `address_shared`, `needs_acknowledgement`, `already_pending`, `rate_limited`; resend adds `not_open`, `cooldown`, `chain_cap`.
- **Revoke outcomes:** `ok`, `not_open`.
- **Acknowledgement reasons:** `do_not_contact`, `visitor`.
- **Reader states:** `signs_in`, `pending`, `expired`, `blocked`, `revoked`, `none`; **reader outcomes:** `membership_ended`, `person_merged`, `person_deceased`, `needs_support`.

**Preview and accept (re-created in full from the live definitions; FA and treasurer paths byte-identical, proven by the parity golden):**

- **Purpose routing is explicit everywhere (R35, F196).** Every branch names its purpose and ends in `else raise exception ... using errcode = 'internal_error'`: preview's person-display block; accept step 4 (gates); the step-5 apply; the step-6 output. No branch treats "not X" as "Y".
- **Preview, `sign_in`:** the person is taken only from `v_inv.person_id`; the address-match block that resolves a person by address is never reached; the invitee name columns are null; `person_display_name` is returned **only when `session_matches` is true** (the G5 amendment), else null. The currency check (R27) returns zero rows on a miss.
- **Accept, `sign_in`:**
  - Step 2b, unlocked currency check immediately after the row is re-validated: the invited address must still be an email contact (`lower(btrim(value))`) of `v_inv.person_id`, else `dead`, nothing written, before any honest non-terminal outcome can be reached.
  - Step 3 is unchanged (account lookup, `account_exists`, `email_mismatch`, `account_inactive`).
  - Step 4: lock the person `for update`; the locked `FOR SHARE` currency re-check on the contact row (miss: `dead`, nothing written, R27's race authority); then the gates, reusing the treasurer branch's verbatim: `person_merged`, `person_deceased` (new reason), `membership_ended`, `person_elsewhere` (a membership at another organization appeared since issue, R31), `person_linked_elsewhere` (the person already has a different user), and for an existing account `ambiguous_person` or `person_elsewhere` (the account is already another live person's). The same account already linked to the same person is a harmless no-op (`person_mode = 'existing_person'`).
  - Step 5 apply: `update people set user_id` (when null) and the matching contact's `verified_at`, then the claim. **No role grant, no designation, no group or officer write.** The `people_guard_user_link` trigger does not bind the owner, so the shared step 5 needs no change for FA or treasurer (R36).
  - **Step 5 error mapping (E1).** The `unique_violation` handler maps by constraint name, never on the bare error class: `users_email_unique` **and `users_email_lower_uq`** both map to `account_exists`, for every purpose. Before 0064 only the first was named; after it, the new-account race the 0059 comment names (`0059:1056-1060`) raises the new index's name, which would otherwise be re-raised and surface as `db_error`. Pinned by the existing mapping-table source scan (`invitations.schema.test.ts`, which matches the handler text) and a two-connection race test. The FA and treasurer parity golden does not exercise this race, so the edit inside the full re-creation is safe.
- Step 6: `administration_role_key`, `office_role_key`, `permission_keys` and `treasurer_role_id` are null for `sign_in`.

**0064 section: guards and constraints** (all drop-then-add or `create or replace`, applied twice by the implementer):

- `account_invitations_guard_insert` replaced: for `purpose = 'sign_in'` the resend lineage compares organization, purpose, origin, `person_id` and `resend_count = parent + 1` and **not the address** (R33, F197); every other purpose keeps the address comparison verbatim; a `sign_in` row with no person is refused.
- `account_invitations_purpose_allowed` adds `sign_in`; `account_invitations_origin_allowed` adds `org`; new `account_invitations_purpose_origin_tie` `(purpose = 'sign_in') = (origin = 'org')`; `account_invitations_names_by_purpose` adds `purpose <> 'sign_in' or (both names null)`; new twin `account_invitations_sign_in_has_person`; `account_invitations_blocked_reason_allowed` adds `person_deceased`.
- `account_invitations_open_address_uq` dropped and re-created **under the same name** with `purpose <> 'sign_in' and <open>` (R28; `<>` rather than an allow-list so a future purpose is covered by address uniqueness until someone opts it out); new `account_invitations_open_sign_in_person_uq` on `(organization_id, person_id) where purpose = 'sign_in' and <open>`; new `account_invitations_person_created_ix` on `(person_id, created_at desc) where person_id is not null` for the reader.
- `contact_methods_email_norm_idx` (S9).

**0064 section: F186 and F187**

- `presby_guard_people_user_link()` (invoker, pinned `search_path`) and trigger `people_guard_user_link` BEFORE INSERT OR UPDATE OF `user_id` on `people`: raises `insufficient_privilege` (`'people: user_id is bound only by the invitation acceptance function'`) when **`current_user` is not the owner of `people`** (A1: the owner is `pg_class.relowner` for `TG_RELID`, compared with the oid of `current_user`; the function body names no role, in particular never `current_user = 'presby_app'`) and the row either inserts a non-null `user_id` or changes `user_id` at all. Everything else passes, including the FK `SET NULL` action and every owner path. There is no marker (R23 as amended; DECISION-208). The owner-path residual is mitigated by the A2 source scan, not by this trigger.
- Stop-block counting `lower(email)` duplicates in `users` (count only, never an address), then `users_email_lower_uq` on `(lower(email))`. (E1, the matching step-5 mapping, lives in the preview and accept section below.)

### Pure shared modules (no `server-only`)

- **New `src/lib/onboarding/sign-in-types.ts`:** `SIGN_IN_INVITATION_LIMITS` (`perOrganizationPer24h: 30`, `perInviterPer24h: 30`, `perAddressPer24h: 3`, `resendCooldownMinutes: 5`, `maxResendsPerChain: 5`, `expiryDays: 7`), `SIGN_IN_REFUSALS`, `SIGN_IN_REVOKE_OUTCOMES`, `SIGN_IN_ACK_REASONS`, `SIGN_IN_STATES`, `SIGN_IN_BLOCK_OUTCOMES`, the exhaustive-`never` helper and their union types. A test pins the limits to the SQL literals and `expiryDays` to `issue.ts`'s `INVITATION_EXPIRY_DAYS`.
- **New `src/lib/onboarding/sign-in-copy.ts`:** the sender-side copy tables (`SIGN_IN_REFUSAL_COPY: Record<refusal | 'forbidden' | 'totp_unavailable' | 'link_origin_unavailable' | 'db_error', string>`, card strings, marker strings, banner strings). A type error if a code lacks copy.
- **`labels.ts`:** `PURPOSE_LABEL` gains `sign_in`; the invitee blocked copy becomes `inviteeBlockedCopy(purpose, reason)` with the neutral sign-in variants (G6); `BLOCKED_REASON_OPERATOR_COPY` and `INVITEE_BLOCKED_COPY` gain `person_deceased` (typecheck-exhaustive over the reason list).
- **`src/lib/db/domain/invitations.ts` mirror:** purposes, origins and blocked reasons widened; the new CHECKs and indexes; the re-predicated `open_address_uq`. `src/lib/db/schema.ts`: `users_email_lower_uq` (expression index). The `contact_methods` expression index in its domain file. `check:schema-parity` runs; `npm run docs:erd` regenerates `/developer`.

### Library (Batch B, `api-developer`)

**`src/lib/onboarding/org-invite.ts`** (server-only; `db` through `withOrgContext` only). It is the only file that names the four definer functions. Every mutation is one `withOrgContext` transaction: permission pre-check first (`forbidden`), UUID shape before the database (a malformed id is `not_found`), non-`ok` results abort the transaction by an internal throw (the `ParticipantAbort` lesson: an early return from `db.transaction()` commits), and the identity literal's 42501 maps to `forbidden`.

```ts
export interface SignInContext {
  organizationId: string;
  actingPersonId: string;
  /** A users.id bound server-side from the session. Never client input. */
  actingUserId: string;
  actingUserEmail?: string | null;
}
export interface SignInSendInput { personId: string; confirmedAddress: string; acknowledged: boolean }

export type SignInSendResult =
  | { kind: "ok"; invitationId: string; expiresAt: Date; delivery: "sent" | "queued";
      address: string; acknowledged: SignInAckReason[] }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: SignInRefusal; ackReasons?: SignInAckReason[]; nextResendAt?: Date;
      existingExpired?: boolean }
  | { kind: "invalid_input"; field: "personId" | "confirmedAddress" }
  | { kind: "totp_unavailable" } | { kind: "link_origin_unavailable" } | { kind: "db_error" };

sendSignInInvitation(ctx, input): Promise<SignInSendResult>
resendSignInInvitation(ctx, input): Promise<SignInSendResult>      // same union
revokeSignInInvitation(ctx, { personId }): Promise<
  { kind: "ok" } | { kind: "forbidden" } | { kind: "refused"; reason: "not_open" | "not_found" } | { kind: "db_error" }>

getSignInCard(ctx, personId): Promise<{ kind: "ok"; card: SignInCardState } | { kind: "forbidden" }>
getSignInMarkers(ctx, personIds: string[]): Promise<Record<string, SignInMarker>>   // {} unless people.manage; never throws for chrome
listSessionSignInRows(ctx): Promise<{ kind: "ok"; rows: SessionSignInRow[] } | { kind: "forbidden" }>
```

- **Send sequence.** Before the transaction: validate `personId` (UUID) and `confirmedAddress` (`normalizeInvitationEmail`, else `invalid_input`); `platformOrigin()` null is `link_origin_unavailable`; `isTotpConfigured()` false is `totp_unavailable` (new accounts default to two-factor required; an unconfigured deployment would strand the invitee at the wall). Mint the token and hash (`mintInvitationToken`), the expiry (7 days), and `randomUUID()` for the queue row's id. In the transaction: call the issue definer; on `ok`, render with `renderInvitationEmail({ purpose: "sign_in", firstName: recipient_first_name, organizationName, senderName, token, expiresAt })` (the sender name is capped to 100 characters and control-stripped by the existing `cap()`); `insertQueueRowInTx` with **`to` = the address the definer returned**, never the client string, the new template key and the pre-generated id; write the audit row with `insertAuditRow` in the same transaction (a throw rolls the whole send back, tested). After commit: `attemptQueuedSend(queueId)`; failure is `delivery: "queued"`, never an error. For resend, additionally `cancelQueuedEmail(tx, cancel_email_queue_id)` in the transaction.
- **Audit (existing keys, no new key):** `INVITATION_CREATED` metadata `invitationId, organizationId, purpose: "sign_in", origin: "org", personId, expiresAt, acknowledged` (the array of `ack_reasons` the definer returned with `ok`, never the client's own flag, written in the same transaction as the invitation; ids and enums only); `INVITATION_RESENT` adds `supersededInvitationId, resendCount`; `INVITATION_REVOKED` `invitationId, organizationId, purpose, origin, personId, via: "single"`. Ids only: never the token, the hash, the address or a name. The actor is the sender's `users.id`. `audit.ts`'s comment block is updated (the "actor = the platform operator" line becomes "the platform operator, or the congregation's sender for origin `org`").
- **Reads.** `getSignInCard` returns the reader's row plus `deliveryState()` inputs, in one transaction, after `people.manage`. `getSignInMarkers` makes **one** reader call for the page's ids and **one** authority-probe query (open officer term, open staff position, open person-arm grant, and whether an email exists) over the same ids, in the same transaction, and derives each person's marker: shown when the state is `pending`, `expired` or `blocked`, or when the state is `none` or `revoked` and the person holds inert authority; never for `signs_in`. It returns `{}` (not an error) when the viewer lacks `people.manage`. `listSessionSignInRows` returns, for a viewer holding `people.manage` and `officers.manage`, the Session seats (open or future, derived `session` group) whose person has no login, each with the reader's state and the person id for the link; it returns `forbidden` otherwise. Dates are cast `::text` in any raw SQL (`check:sql-date`); reader timestamps are parsed defensively (`new Date(x as string | Date)`), as `previewInvitation` already does.
- **Boundaries (source scans in `boundaries.test.ts`):** `org-invite.ts` never imports `getPlatformDb`, never imports `./issue`, never contains `from users` or `join users` (the sender's own row is read in SQL), never references the `accountInvitations` table object or the text `from account_invitations`, touches `email_queue` only through `insertQueueRowInTx`, `cancelQueuedEmail` and `attemptQueuedSend`; and no other non-test file names the four function names. **A2:** one more scan over all of `src/`: no non-test file, other than the fixtures in `src/lib/testing/`, writes `userId` in a `people` insert or update (the mitigation for the owner-path residual of `people_guard_user_link`, DECISION-208).

**Other library changes (Batch B):**

- `src/lib/email/queue.ts`: `EnqueueEmailInput` and `insertQueueRowInTx` accept an optional `id` (backward compatible); `src/lib/email/credential-keys.ts` adds `account_sign_in_invitation`.
- `src/lib/onboarding/invitation-email.ts`: `ACCOUNT_SIGN_IN_TEMPLATE_KEY`; `renderInvitationEmail` takes `senderName` and renders per-purpose copy through one exhaustive switch (`never` default), so adding `sign_in` to `AccountInvitationPurpose` cannot fall into another purpose's text.
- `src/lib/onboarding/accept.ts`: the post-accept audit switch becomes exhaustive on purpose (`sign_in` writes `INVITATION_ACCEPTED` and, for a new account, `USER_CREATED_VIA_INVITATION`, and **no** `org.*.designated` row; an unknown purpose throws and rolls back, F196 TypeScript half); `blocked` carries `purpose`; `previewInvitation` is otherwise unchanged.
- `src/lib/onboarding/issue.ts` (platform connection, F198): `overLimits()` filters `origin = 'platform'` in all three subqueries; `resendInvitation` and `revokeInvitation` select only `origin = 'platform'` rows (an org row is `not_found` to a platform operator); `listInvitationsForOrg` returns platform-origin rows only; `revokeAllOpenInvitations` takes `scope: "designations" | "org_sent"`; new `summarizeOrgSentInvitations(organizationId)` returns counts by derived status and one row per non-superseded org-origin invitation with the address **masked in SQL** (first character of the local part, `***@`, the domain, as the preview does) and the status, never a full address or a person name.
- `src/lib/people.ts` (F199): `updatePerson` writes `PERSON_UPDATED` with `insertAuditRow(tx, ...)` in the same transaction (the action passes the acting user id and email) and stamps `emailChanged` (the primary email value differs from the one read inside the transaction); ids and booleans only.

### Server actions (Batch B)

In the existing `community/[id]/edit/actions.ts` (co-located "use server"): `auth()` in the body, `resolveOrgContext()` re-run, `organizationId`, `actingPersonId` and `actingUserId` never from the client, ids validated as UUIDs, every refusal mapped through the one copy table.

```ts
type SignInActionResult =
  | { ok: true; data: { address: string; expiresAt: string; delivery: "sent" | "queued" } }
  | { ok: false; error: string; needsAcknowledgement?: SignInAckReason[]; retryAfterMinutes?: number };

sendSignInInvitationAction(slug, { personId, confirmedAddress, acknowledged? }): Promise<SignInActionResult>
resendSignInInvitationAction(slug, { personId, confirmedAddress, acknowledged? }): Promise<SignInActionResult>
revokeSignInInvitationAction(slug, { personId }): Promise<ActionResult>
```

`revalidatePath` on the edit page and `/admin/community`. The platform org page's `revokeAllInvitationsAction` reads a required `scope` form field (`designations` | `org_sent`) and passes it through; a missing or unknown scope is refused.

## Data Model

**0064 `drizzle/0064_presby_org_sign_in_invitations.sql`**: hand-written, idempotent (every statement drop-then-add, `create or replace`, `if not exists`, or revoke-then-grant; applied twice end to end by the implementer, the second run changing no row), a forward fix on top of 0059 (shipped in v0.37.0; never an in-place edit of 0059). Header records: the measured counts with no slug (branch: 95 users, 95 distinct lowered; production: 70 users, 1 person linked, 0 case-duplicate email groups as of 2026-10-22; the stop-block's purpose), the strict order `0059 < 0060 < 0061 < 0062 < 0063 < 0064`, that F196 and F197 are **latent** defects of shipped code that cannot manifest before a `sign_in` row exists (which is why this is one `feat` migration and one commit, not a `fix` with trailers), the forward-only caveat, and the apply command `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0064_presby_org_sign_in_invitations.sql`. Sections, in this order:

1. **Preconditions (stop-blocks, counts only):** case-duplicate `lower(users.email)`; any `account_invitations` row whose `(purpose = 'sign_in') <> (origin = 'org')` (impossible today, and the check states the tie's precondition).
2. **Vocabulary and shape CHECKs:** purpose, origin, the tie, names, sign-in person, blocked reasons.
3. **Indexes:** the narrowed `open_address_uq`, `open_sign_in_person_uq`, `person_created_ix`, `contact_methods_email_norm_idx`, `users_email_lower_uq`.
4. **Insert guard** replaced (R33 and the sign-in person rule).
5. **F186** trigger function and trigger (every non-owner role refused, A1).
6. **Helpers:** `presby__actor_person`, `presby_deny_sign_in_invitation`, `presby_sign_in__check`.
7. **Callable functions:** issue, resend, revoke, reader; grants.
8. **Preview and accept** replaced (explicit routing, the `sign_in` branch, `person_deceased`, and E1's `users_email_lower_uq` mapping in step 5).
9. **Comments** on every new object (the pinned source-scan strings live in function bodies, not comments; the 0059 exception-mapping table comment is carried forward and extended).

**Drizzle mirror and staged assets (Rule 16):** `src/lib/db/domain/invitations.ts`, `src/lib/db/schema.ts` and the `contact_methods` domain file as above. `scripts/sign-in-invitations/test-rls-64.sql` (standalone suite as `presby_app`, header modelled on `scripts/invitations/test-rls-59.sql`, integrated by `\ir sign-in-invitations/test-rls-64.sql`), `scripts/sign-in-invitations/seed-dev-sign-in.sql` (rows with known tokens, appended at integration, the `seed-dev-invitations.sql` shape, 2099-dated where they must never expire) and `scripts/sign-in-invitations/test-rls.sql.integration.patch` (a unified diff against the **post-Increment-2** `scripts/test-rls.sql`, anchored by content, converting section 44's `presby_app` link writes). `scripts/giving/test-rls-46.sql` is **not** a Rule 16 file and is edited directly in Batch A. `docs/schema-design.md` gets a section in Batch A.

## Component / Page Plan

**To create** (under `src/app/(org)/o/[slug]/admin/community/` unless noted):

- `[id]/edit/sign-in-card.tsx` (client): the card, `id="sign-in"` for the marker's anchor. `AlertDialog` (`src/components/ui/alert-dialog.tsx`, Rule 2) for send, send again and cancel; controlled state, no `useForm` (so `check:hydration-gate` does not apply and a hydration spec is the guard); triggers disabled until `useHydrated()`; 44px targets; the acknowledgement checkbox lives in the send dialog.
- `sign-in-marker.tsx` (presentational, client-safe): the four marker states with icon and word, never colour alone, linking to `.../edit#sign-in`, 44px tap target.
- `pending/session-sign-in-rows.tsx` (server): the Session hand-off rows inside Increment 2's banner.
- `src/app/(admin)/admin/organizations/[id]/org-sent-invitations.tsx` (server): the masked panel and the second revoke control.
- `src/lib/onboarding/{sign-in-types,sign-in-copy,org-invite}.ts`, `drizzle/0064_...sql`, and the tests and staged SQL above.

**To modify:**

- `[id]/edit/page.tsx`: call `getSignInCard` after the existing reads (an independent awaited call, not folded into a shared `Promise.all`, the page's own discipline), pass the on-file primary email (already read by `getPersonForEdit`), `communityStatus.connection === "visitor"`, `canManageOfficers`, and render the card below the connection card. A reader failure renders the card's honest "We couldn't load this" state; it never blocks the page.
- `page.tsx`, `members-list.tsx`, `community-rows-list.tsx`: call `getSignInMarkers` once per page (only when `canManage`) and render `SignInMarker` beside the existing badge; the marker never renders when `canManage` is false and never in the member Directory (`/o/<slug>/directory` is untouched).
- Increment 2's `pending/session-state-banner.tsx` (and its `no_sign_in` copy constant): the support-ticket sentence is replaced. For a viewer with `people.manage` and `officers.manage`: `SessionSignInRows`; for others: "Ask an administrator to invite your Session members to sign in." (no names). Increment 2's `getSessionApprovalState` is unchanged.
- `(invite)/invite/invite-summary.tsx` (purpose copy through one exhaustive function), `anonymous-state.tsx` (never pre-fills a name for `sign_in`), `src/app/(invite)/actions.ts` (blocked copy by purpose), `confirm-state.tsx` unchanged.
- `(admin)/admin/organizations/[id]/page.tsx`, `revoke-all-invitations.tsx`, `actions.ts`: the org-sent panel and the `scope` prop.
- `src/lib/onboarding/{accept,issue,invitation-email,labels}.ts`, `src/lib/email/{queue,credential-keys}.ts`, `src/lib/people.ts`, `src/lib/audit.ts` (comment only), the Drizzle mirrors.

**Consistent surfaces:** the card, the marker and the banner all read the one reader, so a state can never differ between them. A person linked by any other route while a row is open shows `signs_in` everywhere (the reader's `linked` precedence); the open row is left to expire (F6).

## Implementation Order and Batch Plan

Template order maps as: schema (A), then library, actions and audit (B), then UI (C), then e2e (D), then release notes after SHIP IT. Batches are serial, each committed by explicit path (never `git add -A`), none pushed. **Rule 16:** no batch edits a shared file; the staged assets and edits are listed under Data Model and in the hand-offs.

| Batch | Scope | Implementer | Commit | Gate |
|---|---|---|---|---|
| **A** | 0064; the Drizzle mirrors; `sign-in-invitations.db.test.ts` and the pinned-vocabulary scans; the staged `test-rls-64.sql`, `seed-dev-sign-in.sql` and test-rls integration patch; direct edits to `scripts/giving/test-rls-46.sql`; updates to `invitations.schema.test.ts` and `invitations.db.test.ts`; `docs/schema-design.md` section; `npm run docs:erd`. | `database-admin` | `feat(db): org-issued sign-in invitations, the user-link guard and the address re-check (0064)` | **Rehearse on a throwaway child of the pipeline Neon branch first** (never production or `development`): apply 0064 twice (the second run changes no row; before and after snapshots of `account_invitations`, `people`, `users` counts and md5 digests), then run **the FA and treasurer parity golden** (`designation-parity.db.test.ts`, with `WRITE_DESIGNATION_GOLDEN` unset, so `designation-parity.golden.json` is byte-identical: `git diff --exit-code` on it is a gate), `invitations.db.test.ts`, `accept.db.test.ts`, `issue.db.test.ts`, `designation-holders.db.test.ts`, `scripts/invitations/test-rls-59.sql` and `scripts/designation-revoke/test-rls-60.sql` as `presby_app`, then `scripts/test-rls.sql` with the staged patch applied to a scratch copy. Only then apply to the pipeline branch (twice) and delete the throwaway. DB-backed Vitest serially. `check:schema-parity`, typecheck. |
| **B** | Pure modules, `org-invite.ts`, `queue.ts` id, `credential-keys.ts`, `invitation-email.ts`, `accept.ts` routing and `blocked.purpose`, `issue.ts` platform-side fixes, `people.ts` in-transaction audit with `emailChanged`, `labels.ts`, server actions, the platform `scope`, all lib and action tests, the boundary scans (including the A2 owner-path scan on `people.userId` writes). | `api-developer` | `feat(invitations): org-issued sign-in invitations, send, resend, cancel and accept` | Unit and DB tests, typecheck, `npm run check` (`check:audit` passes vacuously: the actions call lib functions, as in Increment 2), the in-transaction audit rollback tests, every source scan in Test Plan 1. **The parity golden re-run** after `accept.ts` changes. |
| **C** | Card, dialogs, markers, Session hand-off, `(invite)` sign-in copy, platform org-sent panel and revoke scope UI, copy tables wired, RTL tests. | `ux-developer` | `feat(community): sign-in card, can't-sign-in-yet markers and the Session hand-off` | RTL tests, `check:hydration-gate`, typecheck, lint, build, and the 360px browser pass (Test Plan 5). |
| **D** | e2e: fixtures, the sign-in spec, the hydration spec, the existing specs the change touches; whole suite re-run. | `ux-developer` | `test(community): e2e for sign-in invitations` | Full `npm run test:e2e` against a real dev server; `test:e2e:prod` for the hydration spec; and, although no path on the auth-touching list is edited, a **full-login smoke through an MFA-enrolled new account created by a `sign_in` acceptance** (the acceptance function is the one door a new login enters through, and module-resolution defects are invisible to unit tests). QA should treat a skipped e2e as `BLOCKED`, not `PASS`. |

A single implementer for A and B was considered and rejected: the migration, its definers and its tests are the security core and should be reviewable apart from the library.

**Phase 4 kickoff checklist (cannot start until Increment 2's Phase 4 commits):** rebase onto `main` with Increments 1 and 2; re-check 0064 and DECISION-207/208 against `main`; **diff the live `presby_preview_invitation` and `presby_accept_invitation` against 0059** and record any difference before copying them; F177 and the departures are settled and need no further asking (the operator confirmed Option 3, "Warn and confirm"; the architect accepted R21 widened, R23 narrowed and R24 replaced with A1-A5, E1 and S10, folded in above), so confirm only that the work-log still carries the Phase 3a addendum and the operator's ruling; re-derive every `test-rls.sql` anchor against the post-Increment-2 file; read Increment 2's final `session-state-banner.tsx` and `connection-card.tsx` before Batch C edits them.

**Deploy order:** `0064` first (old code keeps working: FA and treasurer are byte-identical, every existing row satisfies the new CHECKs, nothing old code does trips the new trigger), then the code. Code before 0064 would call missing functions. Production has one linked person and no `sign_in` rows, so any order is survivable; the point is to choose one on purpose. The deployment-engineer's runbook carries this paragraph.

## Test Plan

### 1. Implementer-written tests

1. **`src/lib/db/domain/sign-in-invitations.db.test.ts`** (serial; owner plus `presby_app`; throwaway organizations with `deletable_until`): every issue and resend outcome with a fixture producing exactly it, and **"nothing written" proven** by before and after snapshots of `account_invitations`, `email_queue` row ids, `people` and `contact_methods` (a refusal leaves every one unchanged); identity refusals (no organization, a null actor, a user whose person lacks `people.manage`, a merged person, a person whose membership ended, an actor from another organization) all raising the one literal with SQLSTATE 42501; `not_found` identical for a missing id and another organization's person; the R21 matrix (a person with a Session seat refused without `officers.manage` and allowed with it; a person holding a role the sender lacks refused; a manual-group grant refused; a future-dated person-arm grant refused; **A4:** a future-dated managed-group grant and a future-dated managed-group membership each refused, an ended grant or membership ignored, and the sender's own future-dated grant not counted toward their set; **A5:** derived-baseline authority ignored, a group with an unclassified `derived_from` value counted in T and refused (fails closed; built through the owner-side route the existing roll and officer fixtures use for a derived roster), and the closed list `('active_membership','session','diaconate')` pinned by a source scan on the migration plus a test that every `derived_from` value in a seeded organization is either on the list or on a named exception list, so a new derived kind fails the test until it is classified; **commission and delegation:** covered by the R31 refusal, a person whose only extra reach would be a commission or delegation has a membership elsewhere and is refused `needs_support` before check 6); R31 with a fixture person holding a membership at two organizations (live, and ended) refused as `needs_support`; R29 (`address_shared` true for another live member, false when the other person's membership ended, false across organizations); address rules (`no_email_on_file`, `address_ambiguous` with two primaries, `address_invalid` from a value failing the shape CHECK, `address_changed`, `address_is_yours` with the sender's own address on another person); a **visitor refused until acknowledged** and then allowed with `ack_reasons = {visitor}` (**condition 1:** the refusal comes from the definer with nothing written, whatever the caller rendered; **condition 3:** the definer's visitor predicate and the Community Visitors list's predicate are run against the same fixture matrix, visitor with a roll, visitor without, regular, ended, and agree on every row); `do_not_contact` likewise; **no under-18 refusal** (a person under 18 with an address of their own is invitable); `already_pending` for an open row including an expired one (`existing_invitation_expired`); the three limits against seeded rows (30 org, 30 inviter, 3 per address, each counting only `origin = 'org'` and only `created_at <= now()`, a 2099-dated fixture never counts); **platform sends are unaffected by 30 org rows and the reverse**; the two partial uniques; resend with a **changed address** succeeds (R33), a resend that changes organization, purpose, origin or person is refused by the guard, other purposes keep the address comparison; a `sign_in` insert with no person refused; `cooldown` and `chain_cap` with their `next_resend_at`; revoke terminal, refunds nothing.
2. **Acceptance, same file or `sign-in-accept.db.test.ts`:** R27 in **both directions** (address still on file accepts; address edited after send returns `dead` from accept **and zero rows from preview**; edited to a different case passes; an address demoted from primary but still on file passes; the same outcome for new-account and existing-account modes, so `account_exists` and `email_mismatch` are never reached for a stale link); a concurrent edit versus accept (two connections) gives `dead` or an accept, never a link to a stale address; R31 at accept (a membership elsewhere appearing after issue blocks `person_elsewhere`); the treasurer-gate set (`person_merged`, `person_deceased`, `membership_ended`, `person_linked_elsewhere`, `ambiguous_person`) each with a committed `blocked_at` and nothing else written; the same account linked to the same person is a no-op accept; **R35: an accepted `sign_in` writes no `role_grants`, `app_roles`, `app_role_permissions`, `group_memberships` or `officer_terms` row and no `org.*.designated` audit row; `people.user_id` and the matching contact's `verified_at` are the only domain writes**; an unknown purpose cannot be inserted (CHECK) and the function's explicit default raises (a forced test with the CHECK relaxed inside a rolled-back transaction); preview returns `person_display_name` null anonymously and when the session does not match, the name only when `session_matches` (G5), and the invitee name columns null always.
3. **F186:** as `presby_app`, `update people set user_id` and an `insert` with a non-null `user_id` raise 42501; **A1: the same writes raise 42501 as a second non-owner role**, `presby_platform` where the owner connection can `set local role` to it, otherwise a throwaway role created inside a rolled-back transaction and granted `insert, update` on `people` (proving deny by default, not a named role); an insert with a null `user_id` and an update that omits `user_id` pass; `presby_accept_invitation` links (the definer path); a **user deletion as `presby_app` still sets `people.user_id` null** (the FK action runs as the owner); every owner-side write passes (the guard does not bind the owner, asserted so the residual is on record); a source scan pins that the trigger function body reads `pg_class.relowner` and names no role literal.
4. **F187 and E1:** a case-variant duplicate email is refused by `users_email_lower_uq` (both orders); the stop-block raises with a count and no address when a case-duplicate exists (proven inside a rolled-back transaction on a scratch copy); acceptance's `lower(email)` lookup still resolves; **E1: a `unique_violation` on `users_email_lower_uq` in accept step 5 returns `account_exists` (non-terminal, nothing written, the token stays live) for every purpose**, proven by the existing mapping-table source scan extended to name both constraints and by a two-connection race (one connection holds an uncommitted insert of a case-variant address while a new-account accept for the same address runs, then commits); **the NextAuth adapter's insert of a case-variant address fails** (the recorded behaviour change, DECISION-208); the FA and treasurer parity golden stays byte-identical.
5. **Reader:** the output column list equals the closed list (a source scan on the migration and a runtime check on `pg_proc`); organization isolation (an id from another organization is absent from the result); the actor gate (a non-manager raises the literal); array bounds (empty and 501 raise); `invited_address` null once the address leaves the record; the three cross-organization reasons collapse to `needs_support`; no `to_email`, subject, body or `failure_reason` column exists; `linked` takes precedence over an open row.
6. **Pins (unit and source scan):** `SIGN_IN_REFUSALS`, `SIGN_IN_REVOKE_OUTCOMES`, the reader's states and outcomes against the SQL `outcome := '...'` literals; `SIGN_IN_INVITATION_LIMITS` against the SQL literals and `expiryDays` against `INVITATION_EXPIRY_DAYS`; every refusal has copy (runtime test over the arrays plus type-level exhaustiveness); `CREDENTIAL_TEMPLATE_KEYS` holds both template keys (`queue-credential.test.ts:117` is updated); `AccountInvitationPurpose` exhaustiveness in `PURPOSE_LABEL`, the email copy and the invite page (typecheck).
7. **Library and action behaviour (Batch B):** forgery (a payload cannot choose the person's address, the sender, the organization or the actor; a different `confirmedAddress` is `address_changed` and nothing is queued; the queued `to_email` equals the invitation's `email_normalized`); malformed ids are `not_found`; `totp_unavailable` and `link_origin_unavailable` before any write; **a forced throw from `insertAuditRow` leaves no invitation row, no queue row and no superseded row** (send, resend, revoke); **condition 2:** the audit row's `acknowledged` equals the reasons the definer returned (a visitor send records `['visitor']`, a non-visitor send records `[]`, and a client that passes `acknowledged: true` for a non-visitor still records `[]`); `cancelQueuedEmail` runs for a still-queued predecessor and the credential body is scrubbed; `delivery: "queued"` when the post-commit send fails; `getSignInMarkers` makes exactly one reader call and one probe query for a page (mock-counted), returns `{}` for a non-manager, and derives each marker state; `listSessionSignInRows` for a manager, a non-manager and a viewer with `people.manage` but not `officers.manage`; `updatePerson` writes its audit row in-transaction with `emailChanged` true only when the primary email changed (a throw rolls the update back).
8. **Source scans (`boundaries.test.ts` additions):** the five properties listed under Library > Boundaries, plus **the A2 owner-path scan** (no non-test file under `src/`, outside `src/lib/testing/`, writes `userId` in a `people` insert or update; a deliberately offending sample string proves the scan can fail); `(invite)` still never imports `getPlatformDb` or `issue.ts`; `issue.ts` is still imported only from `(admin)`; the hand-off cookie name is still referenced in the three files only; the migration contains no `delete from`.
9. **Platform side:** `listInvitationsForOrg` returns no org-origin row; platform `resendInvitation` and `revokeInvitation` return `not_found` for an org-origin id; `revokeAllOpenInvitations({ scope })` revokes only its scope's rows and refunds nothing; `summarizeOrgSentInvitations` masks every address and exposes no name; the action refuses a missing or unknown `scope`.

### 2. Staged SQL suite: `scripts/sign-in-invitations/test-rls-64.sql` (as `presby_app`)

Structure and privileges (`presby_app` holds no privilege on `account_invitations`, `EXECUTE` on exactly the four callable functions and on preview and accept, none on the helpers; the CHECK and index definitions; the trigger present and refusing `presby_app` link writes with the exact literal (the second-role case needs `create role`, which `presby_app` cannot do, so it is Vitest's)); the identity refusals with the exact literal (no organization context, a user without `people.manage`, null actor, another organization's context); the sanctioned flow end to end as the seeded founding administrator (issue to a seeded elder fixture, preview by token, accept as the seeded account, `people.user_id` linked, a second accept is `dead`); the reader's closed shape; a `sign_in` row visible to no other organization's context; limits refuse the 31st send; a pending row is invisible to a non-manager; every block that writes ends in rollback. What `presby_app` cannot reach (the owner-side guard behaviour, concurrency, the stop-block) is Vitest's.

### 3. Existing specs and fixtures that will change (blast radius)

- **Batch A:** `scripts/test-rls.sql` section 44 (the `presby_app` inserts that set `user_id` at about `:8008`, `:8198`, `:8202`; section 44(d)(iv) is the deliberate "two live people share one user" demonstration, whose fixture is rewritten to use seeded linked people or moved to the owner connection per the section 32(k) precedent) via the **staged patch**; `scripts/giving/test-rls-46.sql` at the nine lines in Measurement 1 (each block that needs a linked actor switches to a seeded linked person, or the assertion moves to Vitest; the implementer records which in Batch A's notes; **fallback if a block cannot be converted cheaply: the assertion moves to the owner connection and F186's `presby_app` guard still lands**); `src/lib/db/domain/invitations.schema.test.ts` (constraint and index lists, purposes, origins, blocked reasons); `src/lib/db/domain/invitations.db.test.ts` (the `open_address_uq` predicate assertion and the exception-mapping table pin, which now names `users_email_lower_uq` as well as `users_email_unique`: `invitations.schema.test.ts:164-167` matches the handler text and `invitations.db.test.ts:1107` is the `account_exists` case, both extended for E1); `scripts/invitations/test-rls-59.sql` (re-run; its preview and accept assertions must still hold byte for byte).
- **Batch B:** `src/lib/onboarding/accept.db.test.ts` and `issue.db.test.ts` (the per-origin limit counts; the `scope` argument; org rows invisible to the platform list); `src/app/(invite)/actions.test.ts` and `accept.ts` consumers (`blocked.purpose`); `src/lib/onboarding/invitation-email.test.ts` (the exhaustive copy switch); `src/lib/email/queue.test.ts` and `queue-credential.test.ts:117`; `src/lib/people.test.ts` and `people-update.test.ts` (the audit moves in-transaction; the `vi.mock("@/lib/audit")` stub must provide `insertAuditRow`); the edit `actions.test.ts`; `labels` tests.
- **Batch C:** `edit/page.test.tsx` (the card renders for a manager, never for a viewer without `people.manage`); `community/page.test.tsx`, `members-list.test.tsx` (markers; none for a non-manager); `(admin)/admin/organizations/[id]/page.test.tsx`, `revoke-all-invitations.test.tsx` and `actions.test.ts` (`scope`); `(invite)/invite/page.test.tsx` and the state tests (sign-in copy, no pre-fill); the Increment 2 banner test (the replaced sentence and the rows).
- **Batch D (e2e):** `e2e/invitation-new-account.spec.ts` and `e2e/invitation-existing-account.spec.ts` exercise the accept function and the shared invite page that this change rewrites; **no assertion should change**, and they are the regression lane for FA and treasurer behaviour after 0064 (re-run, not edited, unless the shared `InviteSummary` refactor moves a heading). `e2e/invitation-fixture-sweep.spec.ts` (the sweep must remove `sign_in` rows' organizations and the throwaway accounts a sign-in spec creates; extend the fixture's sweep list). `e2e/designation-revoke.spec.ts` and `e2e/admin-organizations*.spec.ts` (the platform org page gains a panel and a second revoke control; re-run). `e2e/community-participants.spec.ts` (the edit page gains a card; re-run, and fix any ambiguous locator by role and name). No existing spec asserts the pending page's Session banner text that Increment 2 introduces; the sign-in rows change only its last sentence.

### 4. e2e (Batch D)

`src/lib/testing/invitation-fixture.ts` and `e2e/support/invitation-fixture.ts` gain a `seedSignInInvitation({ organizationId, personId, address, token? })` helper that inserts an org-origin row with a known token on the owner connection (the existing known-token pattern), for the accept lanes. New `e2e/community-sign-in-invite.spec.ts`, desktop and 360px: (1) the founding administrator opens a person with an on-file address, sends from the card through the dialog, and the card shows the pending state with the address and expiry, and one `invitation.created` audit row exists; (2) Send again within the cooldown shows the cooldown sentence, after the clock is advanced (a fixture back-dates `created_at` on the owner connection) it succeeds and says the earlier link is off; (3) Cancel invitation and the dead link page for the old token; (4) a visitor shows the acknowledgement paragraph and the send is refused until the box is ticked; (5) a person with no email shows the no-address state with no send button; (6) editing the person's email after sending makes the old link the dead-link page (R27 end to end) and the card says the address changed; (7) a **new invitee accepts a seeded `sign_in` row, enrols MFA through the real `/totp` challenge, signs in, lands on `/o/<slug>` and sees the baseline only**: no Add person, no Visitors, Staff or Former lists, no admin tiles, and the Community list shows no marker to them (the baseline-member-only seeded user the analyst asked for in the Phase 6 walk); (8) an existing-account invitee accepts through "Sign in to accept"; (9) the Community list marker for an elder with no login, its link into the card, and its absence for a viewer without `people.manage`; (10) the Session hand-off: with Increment 2's `no_sign_in` banner, the rows and their Invite links, then c2 after one is sent. `e2e/hydration/community-sign-in-controls.spec.ts`: with the page's JavaScript held, the card's send, send again and cancel triggers and the acknowledgement checkbox are disabled (both lanes; `test:e2e:prod` runs it). The whole suite is re-run as the regression lane because the shared invitation fixture and the `(invite)` page are touched.

### 5. The 360px browser check (Batch C, repeated in D)

Real Chromium at 360 by 740 and 375, screenshots in the scratchpad and never committed: (1) the edit page with the card in each state (none, no address, pending, expired, bounced, address changed, blocked, signs-in, chain cap); (2) the send dialog with the address wrapping and with the visitor acknowledgement, every control reachable, focus trapped and returned; the send-again and cancel dialogs; (3) pre-hydration: triggers and the checkbox are disabled; (4) the Community list with markers on every view, long names and long addresses wrapping, tap targets at 44px; (5) the Session hand-off rows under the banner at 360px; (6) the `/invite` page for `sign_in` in the anonymous, mismatch, confirm and dead states; (7) the platform org page panel at 360px. A page that returns 200 is not evidence it works.

## Edge Cases & Risks

1. **The wrong mailbox is the central risk.** Whoever controls the on-file address becomes that person on accept. Mitigations, all in this design: the sender sees the full address and the person's name and confirms it (`address_changed` closes the view-to-send gap); the invitee sees nothing about the person before signing in (G5); the link works once and expires in 7 days; a corrected address kills the old link (R27); a shared household address is refused (R29). Residuals stay named: a forwarded link (a forwardee with no account becomes that person, as in Increment 1) and R21's rewrite-then-invite chain.
2. **R21's residual, `paper`:** a sender with `people.manage` can rewrite an unlinked person's email to an address an accomplice controls and then invite, **provided the person holds no authority the sender lacks** (the subset and officers rules close the high-value targets). Detected by audit, not prevented: `tenant.person.updated` with `emailChanged: true`, then `invitation.created`, then `invitation.accepted`, joined on the person id. F199 makes the first row reliable.
3. **No disconnect.** If the wrong person accepts, the church cannot undo it. Recoveries are ending the person's membership (which ends their access at this organization) or a support ticket; the card and the release note say so. Revoking after acceptance is not offered.
4. **F177 (visitors).** Handled by the operator-confirmed acknowledgement (Option 3, "Warn and confirm") and recorded; **not closed**: F177 stays open, with Option 1 plus a visitor baseline role as the first item of Increment 3's Phase 2. The acknowledgement is a disclosure, not a control: it reduces no exposure. It is per send, so resending to a visitor asks again, deliberately. **Staff anchors with no roll reading the directory is accepted on purpose** (it is part of their job), not overlooked. When Option 1 lands it will take directory access away from visitors who accepted under Option 3; the release note sets that expectation.
5. **A pastor already on the platform at the presbytery** has a membership elsewhere and is refused `needs_support` (R31). The pastor-claim path does not exist (Increment 2's known limit); revisit R31's `needs_support` when a claim path is built.
6. **Cross-organization signal, accepted residual (R31):** `needs_support` depends on another organization's rows. Bounded today because only `app.person_claim_authorized` can create such a row and no production code writes it.
7. **A two-tab race.** Two administrators sending to the same person: the second gets `already_pending` (the person-keyed unique index is the database form; the friendly read is the first path). A send racing a revoke: whichever takes the organization lock first wins; the loser sees the new state on refresh.
8. **Locks and deadlocks.** Issue, resend, revoke and accept all take the organization row first, then the invitation, then users, then person, then the contact row. A person edit takes person then contact; measured (Measurement 3), no inversion. A deadlock the database aborts surfaces as accept's existing `db_error` ("your link is still good").
9. **Account collisions surface only at acceptance** (`account_exists`, `email_mismatch`), never on the sender's screen, so the sender cannot learn whether an address has an account (DECISION-189).
10. **Expired open rows still block** a new send until Send again supersedes them; the card routes the button accordingly (analyst F11).
11. **Blocked invitations are terminal.** The card shows the honest own-organization reason or "couldn't be completed, send us a ticket" for the three cross-organization reasons, and offers no send button; a later send after the cause is fixed starts a fresh chain (a new open row; the per-address and per-organization limits still bind, so cap-by-cancel-and-resend is not a way around them).
12. **Dates.** Expiry is shown in the viewer's zone through `FormattedDate`; the email prints it in UTC with a fixed locale (the existing `formatExpiry`).
13. **The Community toggle off** hides the card, markers and hand-off; open links keep working until revoked or expired (named under Permissions & Flags).
14. **The 2FA gate.** A new invitee in an organization whose policy requires two-factor is pushed to `/totp` by the proxy after acceptance, as the treasurer is today; the accept page's existing copy covers it. An existing account that is two-factor-required must be verified in-session to accept (existing behaviour, unchanged).
15. **Marker scope.** On the branch's data the marker would show for 69 unlinked people with an open officer term, staff position or person-arm grant; it deliberately does not show for ordinary members (a marker on every row of a 400-person congregation is noise and reads as an accusation), and it always shows for a person with an invitation in flight.
16. **The 90-day address redaction sweep is still unbuilt (S6, tracked).** No copy anywhere claims it.
17. **Pre-existing, filed:** `updatePerson` deletes a primary contact row when a field is blanked (F176), so blanking an address mid-flight makes the link dead by R27, correctly.
18. **The owner path is not bound (A1, A2).** Paper residual: platform pages, fixtures and database administration run as the owner and can write `people.user_id`. Measured: no platform code does. Every non-owner role, `presby_platform` and any role added later included, is refused by the trigger; the A2 source scan fails the build if a non-test file under `src/` starts to write the column; no marker will be built (DECISION-208).
19. **F187 is narrowed, not closed (S10), and one sign-in behaviour changes.** The case-variant is closed and so is the new-account race the 0059 comment names. A Google sign-in whose address is a case-variant of an existing account now fails at the adapter's insert instead of creating a second account. The definer-mediated email change stays open and `paper` (TODO).
20. **A Session-bound tenant role reaches an invitee through an `officers.manage` sender.** A tenant role bound to the Session group is derived-group authority, gated by check 5 and not part of T, so a sender who holds `officers.manage` but not that role's keys can invite its holder. This is Increment 2's self-constitution residual seen from the other side (an `officers.manage` holder can already create the officer term); recorded in DECISION-207, not a new rule.

## Copy

Plain language for a clerk or an office administrator. Person names, addresses, congregation names and dates are inserted by the component, not the table. "Send us a support ticket" is the existing ticket link. The operator should read this at design review.

**The card** (heading "Sign in to PresbyPortal", `id="sign-in"`):

| State | Copy and controls |
|---|---|
| `signs_in` | "{Name} can sign in." Small text: "To change who signs in as this person, send us a support ticket." No button. |
| `none`, address on file | "Invite {Name} to sign in. We'll email {address} with a link that works once. Accepting lets them sign in as themselves. It doesn't change what they can do here." Button "Send invitation". |
| `none`, no address | "{Name} has no email address on file. Add one under Profile, then come back." (link to Profile). No button. |
| `pending` | "Invitation sent to {address} on {date}. It expires {date}." plus the delivery word ("Queued", "Sent", "Delivered"). Buttons "Send again" and "Cancel invitation". Under Send again: "Sending again turns off the earlier link." |
| cooldown | "You sent this a moment ago. You can send it again in {n} minutes." (Send again disabled) |
| `expired` | "The invitation to {address} expired on {date}." Button "Send a new one". |
| bounced or failed | "The email to {address} bounced. Check the address on file, fix it, and send again." Button "Send again". |
| address changed (`address_current` false) | "The address on file changed after this was sent, so the earlier link no longer works. Send again to reach {new address}." Button "Send again". |
| chain cap | "This has been sent several times. Ask {Name} to check their spam folder, or send us a support ticket." |
| `blocked`, `membership_ended` | "This invitation couldn't be completed because {Name}'s connection to {Congregation} has ended." No button. |
| `blocked`, `person_merged` | "This invitation couldn't be completed because {Name}'s record was merged into another one." No button. |
| `blocked`, `person_deceased` | "This person's record can't be invited." No button. |
| `blocked`, `needs_support` | "This invitation couldn't be completed. Send us a support ticket and we'll look into it." No button. |
| load failure | "We couldn't load this just now. Reload the page." (the page does not fail) |

**Send dialog:** title "Send an invitation to {Name}?" Body: "We'll email {address}. The link works once and expires on {date}. Only send it if that address belongs to {Name}: whoever opens the link becomes {Name} on PresbyPortal." Visitor acknowledgement (shown when the person is a visitor, and again if the server asks): "{Name} is recorded as a visitor. Anyone who signs in can see your member directory and your calendar, with each person's privacy settings applied. Only continue if you want {Name} to have that." Checkbox "I understand, send it anyway". `do_not_contact` acknowledgement (shown after the server asks): "{Name} asked not to be contacted at this address. This is a one-time account email, not marketing. Send it anyway?" Buttons "Cancel" and "Send invitation". Success toast: "Invitation sent to {address}. It expires {date}." Delayed: "Invitation saved. The email will go out shortly."

**Send again dialog:** title "Send this invitation again?" Body: "We'll email {address} a new link. The earlier link stops working." Buttons "Cancel", "Send again". **Cancel dialog:** title "Cancel this invitation?" Body: "The link will stop working, and {Name} won't be able to sign in until you send a new one." Buttons "Keep it", "Cancel invitation". Toasts: "Invitation sent again to {address}." and "Invitation cancelled."

**Sender refusals (`SIGN_IN_REFUSAL_COPY`):**

| Code | Copy |
|---|---|
| `forbidden` | You don't have permission to invite people to sign in here. |
| `not_found` | That person could not be found. |
| `already_signs_in` | {Name} can already sign in. If they've forgotten their password, they can use "Forgot password" on the sign-in page. |
| `person_merged` | This person's record was merged into another one, so it can't be invited. |
| `person_deceased` | This person's record can't be invited. |
| `membership_ended` | This person's connection to {Congregation} has ended, so they can't be invited. |
| `needs_support` | This needs help from PresbyPortal support. Send us a support ticket. |
| `needs_officers_permission` | {Name} holds a seat on the Session or the Board of Deacons. Only someone who can manage officers can invite them. |
| `exceeds_your_access` | {Name} holds access that you don't have yourself, so you can't invite them. Ask an administrator who does. |
| `no_email_on_file` | {Name} has no email address on file. Add one, then come back. |
| `address_ambiguous` | {Name} has more than one main email address on file. Keep one as the main address, then send. |
| `address_invalid` | The email address on file doesn't look right. Fix it, then send. |
| `address_changed` | The address on file changed while you were looking. Check it and send again. |
| `address_is_yours` | That's your own email address. Each person needs their own address to sign in. |
| `address_shared` | Another person at your congregation has the same email address on file. Each person needs their own address to sign in. |
| `needs_acknowledgement` | (not an error: shows the acknowledgement above) |
| `already_pending` | An invitation is already out. Send it again or cancel it. |
| `not_open` | There's no open invitation to change. Reload the page. |
| `cooldown` | You sent this a moment ago. You can send it again in {n} minutes. |
| `chain_cap` | This has been sent several times. Ask {Name} to check their spam folder, or send us a support ticket. |
| `rate_limited` | Too many invitations right now. Try again later. |
| `totp_unavailable`, `link_origin_unavailable` | We can't send invitations right now. Send us a support ticket. |
| `db_error` | We couldn't complete that just now. Try again. |

**Community marker** (admin only; icon and word; links to the card): "Invitation sent {date}" (amber); "Invitation expired. Send again" (amber); "Email bounced. Check the address" (amber); "Can't sign in yet" (neutral), with "No email on file" appended when true. Accessible name includes the person's name.

**Session hand-off** (inside Increment 2's banner, `no_sign_in` state; counts say "members of the Session"): viewer with `people.manage` and `officers.manage`: "{n} members of the Session can't approve yet because they haven't signed in." Then one row per seat: name, the state ("No email on file", "Not invited yet", "Invitation sent {date}", "Invitation expired", "Email bounced"), and a link "Invite" or "Open" to the person's card. When at least one invitation is out: "Invitations sent to {n} of the {m} members of the Session. Waiting for them to accept." Other viewers: "Ask an administrator to invite your Session members to sign in." (no names). This replaces Increment 2's "Inviting someone to sign in isn't available here yet. Send us a support ticket and we'll help get them set up."

**The invite page (`/invite`) for `sign_in`:** heading "You're invited" unchanged. Summary: "{Congregation} invited you to sign in. Signing in lets you see what {Congregation} shares with its people. What you can do depends on your role there." No name pre-fill. The confirm state keeps "Accepting as {Name} at {Congregation}. If that isn't you, don't accept." (the name comes only from the signed-in account's match, G5). **Blocked, for the invitee (neutral, G6):** `membership_ended`, `person_merged`, `person_deceased`: "This invitation can't be completed. Contact {Congregation}'s office." `ambiguous_person`, `person_linked_elsewhere`: "This email address is already connected to someone else's record at this congregation, for example a family member. Each person needs their own address. Contact the person who invited you." `person_elsewhere`: "This invitation can't be completed. Contact the person who invited you." The dead-link page is unchanged and uniform.

**The email:** subject "{Congregation} has invited you to sign in to PresbyPortal"; heading "You're invited to PresbyPortal"; greeting "Hello {first name},"; body "{Sender name} at {Congregation} has set up a place for you on PresbyPortal, the website your congregation uses to keep its records and do its work. Accepting takes about a minute: you choose a password, and then you can sign in whenever you need to."; second line "What you can see and do depends on your role at {Congregation}. Accepting doesn't change your role."; button "Accept the invitation"; footnote "The link works once and expires on {date}. If you already have a PresbyPortal account, sign in with this email address. If you weren't expecting this, you can ignore it. Nothing happens unless you accept." It drops the treasurer line "Nobody holds this role until you accept." The sender name is the sender's own record name, capped at 100 characters.

**Platform org page panel** ("Sign-in invitations sent by this organization"): "{open} open, {accepted} accepted, {expired} expired, {revoked} cancelled." A row per invitation with the masked address and the status; no names. Second control "Cancel all open sign-in invitations ({n})" with the confirm "This stops every open sign-in link this congregation has sent. People who already accepted keep their access. The congregation can send new ones." The existing button is relabelled "Cancel all open designation invitations ({n})" with its existing confirm unchanged.

## F177 Option 1 (narrow `active_membership`): the Increment 3 delta, not built in 2b

The operator chose Option 3 for 2b, so none of this is built here; it is recorded as the first item of Increment 3's Phase 2. When Option 1 lands: strip the `visitor` acknowledgement reason (definer check, `SIGN_IN_ACK_REASONS`, copy, dialog paragraph, tests, e2e lane 4). Add: one 0064 section replacing `presby_sync_derived_membership_group()` so a visitor with no roll gets no group row (and an existing one is ended, never deleted) and a later roll or engagement change re-includes them; a backfill by `ends_on` guarded by role-free predicates, never by a reason text; six DB tests (insert as visitor, visitor to member on approval, engagement change, ended membership, the baseline `member` grant reaching a staff anchor still, no change for members); DECISION-065's grantee half amended; the card note "A visitor can sign in but sees nothing until they are received." Nothing else changes.

## Out of Scope (non-goals for the operator to confirm)

- Bulk or CSV invitations; "invite everyone who can't sign in yet" (one at a time was ruled).
- **Disconnect after accept** (ruled out of 2b); an unlink or re-link action.
- SMS, a free-text message, auto-send on hire or grant, a "My invitations" card, church-domain mail (DECISION-182, unbuilt), Google claim wiring, the 90-day redaction sweep.
- Closing F177 (Option 1 and a visitor baseline role are the first item of Increment 3's Phase 2; F177 stays open), and the rest of the F38 residue on `users` (definer-izing email change; F187 is narrowed, not closed).
- Markers or invite links on the Officers roster and the Staff page (the Community list, the person edit page and the Session hand-off only).
- An age gate (dropped, with its reason recorded) and any acknowledgement for minors.
- Binding the owner connection to the user-link guard (named `paper` residual, mitigated by the A2 source scan; no marker will be built), consolidating the three older actor helpers, and the consolidation of `presby_roll__actor_holds`.
- A notification to the sender when an invitation is accepted (the card and marker update on the next read).

## Implementer

Named per batch: **`database-admin`** (Batch A, 0064 and its DB tests and the SQL suite conversions), then **`api-developer`** (Batch B, library, actions, platform-side fixes, in-transaction person audit), then **`ux-developer`** (Batches C and D, UI, e2e and the 360px pass). Phase 4 starts only after Increment 2's Phase 4 commits. The F177 ruling and the three departures are settled (operator and architect, Phase 3a; amendments folded in). The Copy section and the under-18 ruling remain the items the operator should read at design review.

## Release-note risk lines (for `/release-notes`, tech-lead)

Written for a non-engineer; the note must not deny a residual the decision records admit (the 0.25.2 lesson).

- **What this is:** "You can now invite a person you've already recorded to sign in. Open their record, check the email address on file, and send the invitation. We email that address a link that works once and expires in 7 days. Accepting connects a sign-in to that person's record and nothing else: they can do only what their role at your congregation already allows."
- **The address you send to is the person:** "Whoever opens the link becomes that person on PresbyPortal, so send it only to an address that belongs to them. We refuse an address that two people at your congregation share. If you change a person's email after sending, the earlier link stops working."
- **No take-back yet (named limit):** "You can cancel an invitation that hasn't been accepted, but once someone accepts you can't disconnect them yourself. If the wrong person accepts, end the person's connection to your congregation or send us a support ticket."
- **Visitors (F177, named):** "You can invite a visitor. A visitor who signs in can see your member directory and your calendar, with each person's privacy settings applied, the same as any member. We ask you to confirm before sending to a visitor, and we record that you did. The confirmation tells you what they will see; it does not limit it. We plan to give visitors a narrower view in a later release."
- **Who can invite whom:** "If a person holds a seat on the Session or the Board of Deacons, only someone who can manage officers can invite them. You can't invite someone who holds access you don't have yourself."
- **A residual we record but don't block:** "Someone who can edit a person's email can point an invitation at a different mailbox. We don't block that. Every edit and every invitation is recorded so it can be reviewed."
- **Limits:** "Each congregation can send up to 30 invitations a day, with at most 3 to the same address. People under 18 can be invited; a child who shares a parent's address needs their own address on file first."
- **Our staff side:** "PresbyPortal staff can see the masked addresses of the invitations a congregation sent and cancel all of its open sign-in invitations if something goes wrong."
- **Under the hood, for the record (no action needed):** a sign-in link can't be created for a person outside the congregation that sent it; the connection between a sign-in and a person can now be made from a congregation's side only by accepting an invitation (PresbyPortal's own database access is not bound by that rule; no platform code makes such a connection, and a code check watches for one); two accounts can no longer share an email address that differs only by capital letters, so a Google sign-in whose address differs only by capitals from an existing account is now refused instead of quietly creating a second account. Changing an existing account's email remains an application-level operation; moving it behind a stricter check is planned.

## Integration hand-offs (for the orchestrator; nothing below is edited in this pipeline)

- `drizzle/meta/_journal.json`: the entry for `0064_presby_org_sign_in_invitations`.
- `scripts/test-rls.sql`: append `\ir sign-in-invitations/test-rls-64.sql`; apply `scripts/sign-in-invitations/test-rls.sql.integration.patch` (generated against the post-Increment-2 file, anchored by content; converts section 44's `presby_app` link writes); re-run against merged `development` after the merge.
- `scripts/seed-dev.sql`: append `scripts/sign-in-invitations/seed-dev-sign-in.sql` after every organization, person and user it references exists (the `seed-dev-invitations.sql` shape). **Not required for the owner-binding departure:** no existing `seed-dev.sql` statement changes, because the guard binds only roles that are not the table owner and `seed-dev.sql` runs as the owner. (The architect accepted the markerless shape in Phase 3a, so there is no marker cost to carry.)
- `docs/decisions.md`: DECISION-207 and DECISION-208 (drafted below). `docs/schema-design-2.md`: F186, F187, F192 to F199 as a lettered review-round subsection (F177 stays open and is cited, not renumbered).
- `docs/TODO.md`: add the follow-ups: F177 Option 1 plus a visitor baseline role (the **first item of Increment 3's Phase 2**; F177 stays open, condition 4); move email change into a definer that consumes its verification token (the remainder of F187, which is recorded as narrowed, not closed); disconnect-after-accept; bulk invite; markers on the Officers roster and the Staff page; consolidate the older actor helpers into `presby__actor_person`; the Community tile text that misleads a signed-in non-administrator; revisit `needs_support` when a person-claim path exists; the Increment 2 `no_sign_in` sentence (replaced by 2b); the 2b line moves to Done at SHIP IT. **Increment 3 starts at F200 and DECISION-209.**
- `CLAUDE.md` (for the operator to review in the diff; this agent does not edit it). Two sentences proposed. Under **Permissions vs Flags**, after the credential paragraph: *"A congregation's sign-in invitation is the same mechanism: addressed to an existing person's on-file address, it binds a login to that person and grants nothing, so the person's authority is whatever their own records already confer (DECISION-207)."* Under **Two Hierarchies Intersect Nowhere**, after the DECISION-194 residual: *"A tenant administrator with `people.manage` can bind a login to an unlinked person by pointing an invitation at an address they control (edit the person's email, then invite). This is `paper`, detected by audit, and bounded: a person who holds authority the sender lacks cannot be invited (DECISION-207)."*
- `docs/product/functionality-map.md`: the Community line gains "invite a person to sign in, the Can't-sign-in-yet marker and the Session hand-off"; the platform organization page line gains the org-sent panel (Rule 14, at ship, with the release notes).
- `docs/architecture.md`: no change (Rule 15: a tenant-originated credential issued through definers is a new door into the existing onboarding subsystem, not a new subsystem; if the reviewer reads it as a changed data flow, one sentence under the onboarding section at Phase 6).
- Deployment runbook: the deploy-order paragraph under Implementation Order and Batch Plan; and the pre-deploy count of case-duplicate `lower(users.email)` in production (0 groups when the orchestrator measured on 2026-10-22; re-run just before deploy, because the migration stops on any).
- **Resolved (Phase 3a):** the architect accepted the three departures with amendments A1-A5, E1 and S10, all folded into this section; no loop-back to Phase 2.
- **Resolved:** the operator's F177 ruling ("Warn and confirm", Option 3, 2026-10-22). **Still for the operator to read, before Phase 4:** the Copy section, and the under-18 ruling (dropped, no acknowledgement); no ruling on either is recorded yet.

## Drafted decisions (for `docs/decisions.md`; newest first at integration)

**DECISION-208 — The link between a login and a person is a database property against every non-owner role; `users.email` is case-insensitively unique.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (Increment 2b; R23, R24, R36; F186, F187; departs from R23's owner binding and R24's revoke; amended in Phase 3a by A1, A2, E1 and S10)

- `people.user_id` is the identity binding: `presby_user_organizations` resolves a user to a person to memberships. `people_guard_user_link` (BEFORE INSERT OR UPDATE OF `user_id`) refuses any link transition when `current_user` is **not the owner of `people`** (A1; owner = `pg_class.relowner` for `TG_RELID`, compared with the oid of `current_user`; no role is named). Deny by default, because `presby_platform` also holds INSERT and UPDATE on `people`, including `user_id`, and is expected to become a login one day; naming `presby_app` alone would leave every other non-owner role, including roles added later, able to write the link. It costs nothing: fixtures, the FK `SET NULL` action and the definers all run as the owner. The only legitimate writer, `presby_accept_invitation`, is SECURITY DEFINER, so `current_user` inside it is the owner and the shared apply step needs no change (R36 holds). Measured: no application code on `presby_app` writes the column.
- **Why not a marker, and why not bind the owner:** a transaction-local marker is forgeable by any `presby_app` statement (the 0059 idiom works on `account_invitations` only because `presby_app` holds no privilege there; on `people` it holds UPDATE, including column-level UPDATE on `user_id`), so it adds nothing on the connection the finding is about, and binding the owner path would force about ten fixture sites (two in `seed-dev.sql`) to arm it for a path on which no platform code writes the column; a marker there would only ever catch mistakes, since the owner can disable the trigger anyway. **Accepted residual, `paper`:** the owner path is not bound. **Mitigation (A2):** a source scan in `boundaries.test.ts` fails when any non-test file under `src/`, other than the fixtures in `src/lib/testing/`, writes `userId` in a `people` insert or update. No marker will be built.
- **Why not revoke `users` privileges (R24):** `presby_app` legitimately writes `users` on seven app paths and through the NextAuth adapter, and a trigger on `users.email` cannot tell the verified email-change update from a forged one. The exploitable gap is a case-variant of an existing address (acceptance matches on `lower(email)`; `users_email_unique` is case-sensitive), closed by `users_email_lower_uq` with a stop-block on existing case-duplicates (production measured 0 groups, 2026-10-22). The same index closes the new-account race named in the 0059 comment (`0059:1056-1060`) and makes the acceptance identity match deterministic. **E1:** the re-created `presby_accept_invitation` maps `users_email_lower_uq` to `account_exists` in step 5, for all purposes, beside `users_email_unique`; without it the race would surface as `db_error`. **Behaviour change:** a Google sign-in whose address is a case-variant of an existing account now fails at the adapter's insert instead of quietly creating a second account (the verify-email path already catches any 23505 by error code). **F187 is narrowed, not closed (S10), and the residual is `paper`, filed:** an application bug on `presby_app` can still rewrite another user's email to an unused address (the F38 family, independent of invitations). The real fix moves email change into a definer that consumes its verification token, an account-area pipeline.
- Disconnecting a login after acceptance is a future decision; the guard permits `non-null -> null` only on owner and FK paths so that decision has a clean place to land.

**DECISION-207 — An org-issued sign-in credential: the `sign_in` purpose, four definer functions on `presby_app`, the sender rule, and an acceptance branch that grants nothing.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-founding-admin-directory` (Increment 2b; R19-R22, R25-R35, G1-G9; F192-F199; operator rulings 2026-10-22, including F177 Option 3, "Warn and confirm"; amended in Phase 3a by A4 and A5 and the four Option 3 conditions)

- **Credential.** Same table and mechanism as DECISION-183 (hashed, single-use, expiring, never a `FEATURES.*` key, session claim or resolver input), `purpose = 'sign_in'`, `origin = 'org'`, no names carried, a person required. It is addressed to an existing person's on-file primary email in SQL and never to a typed address; the sender's confirmed address is only an equality guard (`address_changed`). Resend is a new row (D-1) whose lineage follows the person, not the address (R33, F197), so a corrected address can be re-sent without resetting the five-resend cap.
- **Issue is on `presby_app` through definers**, the deliberate opposite of `issue.ts`: issue, resend, revoke and a closed-shape state reader derive the organization from `presby_current_org()` and the actor from a bounded `users.id` claim, raise one uniform literal on identity refusals and return typed outcomes otherwise. `presby_app` holds no privilege on `account_invitations`. The sender never reads other `users` rows (DECISION-189); account collisions surface only at acceptance.
- **Who can be invited, and the sender rule.** Any person with a membership at the issuing organization, **visitors included** (operator ruling); never a typed address. Refused: ended, merged, deceased, already linked, **any membership at another organization, live or ended** (R31, `needs_support`), no usable address, an address another live member shares (R29), the sender's own address on another person. **You may bind a login only to a record whose authority you could have created yourself:** `people.manage` for everyone; additionally `officers.manage` for anyone holding a Session or Board of Deacons seat; and the person's non-derived authority T must be a subset of the sender's own effective permissions as of today (`exceeds_your_access`). **A4:** T is built directly from `role_grants` (person arm, and managed-group arm joined to `group_memberships`), counting every row with `ends_on is null or ends_on > current_date` and **no `starts_on` bound**, so future-dated grants and memberships count; the sender's own set is as of today, because you may not lend authority you do not yet hold. **A5:** derived groups are a closed list, `membership_source = 'derived' and derived_from in ('active_membership','session','diaconate')`, so a new derived kind falls into T (fails closed) until it is classified; the list is pinned by test. The exclusions are sound: `active_membership` is every member's baseline and the sender, an active member, holds it; `session` and `diaconate` are gated by `officers.manage`, matching Increment 2's self-constitution residual. **Known consequence, recorded rather than made a rule:** a tenant role bound to the Session group reaches an invitee through a sender who holds `officers.manage` but not that role's keys. The commission and delegation sources reach only people with a membership at another organization, which R31 refuses first, so T does not model them. **No age gate:** its only stated reason was F177, which is not age-specific; the realistic child case (a shared parent address) is refused by `address_shared`. **Accepted residual, `paper`** (R21): a `people.manage` sender can rewrite an authority-free unlinked person's email and invite; detected by `tenant.person.updated` (with `emailChanged`, now in-transaction, F199), `invitation.created`, `invitation.accepted`.
- **F177 is handled by an operator-confirmed acknowledgement, and stays open.** A visitor with a login reads the member directory and calendar, privacy-filtered, through the baseline `active_membership` grant; DECISION-065 stands (it names visitors as grantees of the ability to browse the directory, so this is inside the tier model). The operator ruled "Warn and confirm" (Option 3, 2026-10-22) and the architect endorsed it on four conditions, all built: (1) the definer enforces `needs_acknowledgement` (reason `visitor`), not the UI; (2) the audit row records `acknowledged` in the same transaction, from the reasons the definer returned; (3) the visitor predicate is pinned equal to the Community Visitors list's by test; (4) F177 stays open. **The acknowledgement is a disclosure, not a control: it reduces no exposure.** **Staff anchors with no roll reading the directory is accepted on purpose** (it is part of their job), not overlooked; Option 3 asks for an acknowledgement for visitors only. Option 1 (narrow `active_membership`) plus a visitor baseline role is the first item of Increment 3's Phase 2; when it lands it takes directory access away from visitors who accepted under Option 3, which the release note's "narrower view in a later release" sentence anticipates.
- **Acceptance is one function with explicit purpose routing** (R35, F196): every branch names its purpose and ends in an `internal_error` default, so a `sign_in` row cannot run another purpose's apply. The `sign_in` branch takes the person only from the token's row; re-checks, unlocked and again `FOR SHARE`, that the invited address is still an email contact of that person (R27, F192), answering `dead` and writing nothing otherwise; refuses a membership at another organization (R31); reuses the treasurer gates verbatim plus `person_deceased`; writes `people.user_id` and the matching contact's `verified_at` and nothing else. Preview shows the person's name only when the signed-in account's address matches (G5, F194).
- **Limits** (G9, R32): per organization 30, per inviter 30, per `(organization, address)` 3, per 24 hours, counting only org-origin rows (the platform's 10, 20 and 3 count only platform rows; F198), bounded `created_at <= now()`, evaluated under the organization lock; cooldown 5 minutes; at most 5 resends per chain; 7-day expiry.
- **Structure.** `account_invitations_open_address_uq` is narrowed to `purpose <> 'sign_in'` under the same name (F193); `account_invitations_open_sign_in_person_uq` is person-keyed; the purpose-origin tie, names and person CHECKs bind the vocabulary; the email carries a new credential template key (scrubbed after send) and the sender's own name, rendered in one exhaustive function, link origin `platformOrigin()` only. `org-invite.ts` is the only file naming the definers, pinned by source scan. No new flag: the surfaces ride the Community toggle; the database-side kill lever is the platform's `org_sent` revoke-all.

## Drafted findings (for `docs/schema-design-2.md`; same `### F### — title` form)

### F186 — the user-to-person link could be written by the tenant connection
**F186 — `people.user_id`, the identity binding that `presby_user_organizations` resolves, was updatable (and insertable) by `presby_app` with no guard.** **Closed** against every role that is not the table owner by `people_guard_user_link` (DECISION-208; A1: deny by default, so `presby_platform` and any role added later are bound too). **Open residual (paper):** the owner path is not bound; no platform code writes the column, and a source scan in `boundaries.test.ts` fails if a non-test file under `src/` starts to (A2).

### F187 — `presby_app` keeps DML on `users`, which undermines the invitation email match
**F187 — `presby_app` keeps `INSERT, UPDATE, DELETE` on `users` (no RLS), which undermines the email match acceptance relies on: acceptance matches `lower(users.email)` while `users_email_unique` is case-sensitive, so a case-variant of an existing address could be written.** **Narrowed, not closed (S10):** the case-variant is closed by `users_email_lower_uq`, which also closes the new-account race named in the 0059 comment (DECISION-208; E1 maps the new constraint to `account_exists`). **Open (paper), TODO:** a `presby_app` application bug can still rewrite another user's email to an unused address; closing it means a definer-mediated email change that consumes its verification token.

### F192 — an org-issued credential outlived the address it was sent to
**F192 — nothing re-checked that the invited address was still on the person's file, so correcting a typo left the typo's mailbox able to accept.** **Closed** by the two-step R27 re-check (unlocked, then `FOR SHARE`) in accept and preview (DECISION-207).

### F193 — one open row per address gave the wrong answer on a person-keyed purpose
**F193 — `account_invitations_open_address_uq` reported `already_pending` for a shared or stale address.** **Closed:** narrowed to non-`sign_in` purposes, a person-keyed index added, `address_shared` refused up front (DECISION-207).

### F194 — the preview named a person before sign-in
**F194 — `presby_preview_invitation`'s non-treasurer branch resolved a person by address and showed their name to an anonymous visitor.** **Closed** for `sign_in`: the person comes from the token's row only and the name is returned only when the signed-in account matches. Founding-administrator behaviour is unchanged.

### F195 — a person row is global, so one organization's invite could bind a login that reaches another
**F195 — `people`, `contact_methods` and `people.user_id` are global.** **Closed** by refusing any person with a membership at another organization, live or ended, at issue and again at accept (DECISION-207). Residual: the sender-visible `needs_support` still depends on another organization's rows (bounded; no production writer of the claim flag).

### F196 — purpose routing fell through in preview and accept
**F196 — each of preview, accept step 4, the step-5 apply, the step-6 output and `accept.ts` treated "not treasurer" as founding administrator or the reverse, so a new purpose would have run an authority-bearing apply.** **Closed:** explicit routing with an `internal_error` default in SQL and an exhaustive `never` in TypeScript. Latent: it could not manifest before the `sign_in` purpose existed.

### F197 — the resend guard forbade correcting an address
**F197 — `presby_account_invitations_guard_insert` required a resend to keep its parent's address.** **Closed:** for `sign_in` the lineage follows organization, purpose, origin and person. Latent, as F196.

### F198 — the platform's invitation list, resend, revoke-all and limits ignored origin and purpose
**F198 — `issue.ts` read every invitation of an organization, so org-issued rows would have shown their full addresses to the platform, been resent with the wrong email, been swept by "revoke all", and spent the platform's per-organization and per-recipient limits.** **Closed:** platform paths select `origin = 'platform'`, `revokeAllOpenInvitations` takes a `scope`, and the org-sent view is masked and counts-only (DECISION-207).

### F199 — the detection signal for a named residual was written outside the transaction
**F199 — `updatePerson` wrote `tenant.person.updated` through `recordAudit()` after commit, which swallows failures, but that row is the first link in the audit chain that detects the rewrite-email-then-invite residual (R21).** **Closed:** written with `insertAuditRow` in the same transaction and stamped `emailChanged`.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2b · 3 — Technical design | tech-lead | Complete, Phase 3a amendments folded in place (A1-A5, E1, S10, the four F177 Option 3 conditions, the staff-anchor note and A3's release-note wording; DECISION-207 and 208, F186 and F187 and the test plan updated; F177 Option 3 operator-confirmed). Design to R19-R36 and G1-G9; Note 3 measured; departures from R21, R23 and R24 accepted by the architect with amendments; under-18 refusal dropped with reason; F198 and F199 added. Batches A database-admin (0064), B api-developer, C+D ux-developer; Phase 4 waits for Increment 2's Phase 4 commits | Design complete, amendments folded in; implementers named | 2026-10-22 |

## Handoff

Next: **Phase 4**, only after Increment 2's Phase 4 commits, serial: **Batch A** (`database-admin`, 0064, rehearsed on a throwaway Neon child branch with the FA and treasurer parity golden and `test-rls.sql` before the pipeline branch), **Batch B** (`api-developer`), **Batches C and D** (`ux-developer`). The orchestrator records this section and the status row and the integration hand-offs above, and confirms: migration 0064; DECISION-207 and 208; F186, F187, F192 to F199; **Increment 3 begins at F200 and DECISION-209**. The Phase 3a amendments are folded in (changelog at the top of this section); F177 Option 3 is operator-confirmed and the architect has seen and accepted the departures. Before Phase 4: the operator's read of the Copy; the production case-duplicate count (0 on 2026-10-22; re-run just before deploy); Increment 2's final banner and connection-card files in hand; the live preview and accept definitions diffed against 0059. Nothing else blocks Phase 4.

---

# Increment 2b — Phase 3a addendum: departures from R21, R23 and R24 (architect)

*Recorded verbatim by the orchestrator from the architect's returned text.*

## Verdict

**Approved with suggestions.** I accept all three departures, each with an amendment, so there is no loop-back to Phase 2. The tech-lead is right on the core point of R23. My marker ruling copied the 0059 idiom, and that idiom only works on `account_invitations` because `presby_app` holds no privilege on that table. On `people`, `presby_app` holds UPDATE, including column-level UPDATE on `user_id`. I measured that on the branch, so any `presby_app` statement could arm the marker itself. Phase 4 Batch A may start once the amendments below are written into the design. The tech-lead or the orchestrator can do that in place, with no new phase.

## Rulings

### R23: the user-link guard. Amended: refuse every non-owner role, not just `presby_app`

- **Accepted:** no marker. The guard binds the tenant connection, the owner path is left unbound, and R36 holds without any change, because the accept function is a definer and runs as the owner.
- **Amendment A1, the trigger condition:**
  - Refuse when `current_user` is **not the table owner**. Do not test `current_user = 'presby_app'`.
  - The catalog shows why. `presby_platform` also holds INSERT and UPDATE on `people`, including on `user_id`. It is NOLOGIN today, but 0043, 0044 and 0059 all expect it to become a real login one day.
  - Naming one role leaves every other non-owner role able to write the link, including any role added later. Deny-by-default costs the same: fixtures, the FK `SET NULL` action and the definers all run as owner.
  - Owner lookup: `pg_class.relowner` for `TG_RELID`, compared with `current_user`'s oid.
- **Amendment A2, a cheap check on the owner path:**
  - Binding the owner with a marker would only ever have caught mistakes, since the owner can disable the trigger anyway. So use a source scan instead, at no fixture cost.
  - Add it to `boundaries.test.ts`: no non-test file under `src/` writes `userId` in a `people` insert or update, apart from the testing fixtures.
  - Record it as the mitigation for the owner-path paper residual in DECISION-208.
- **Amendment A3, release-note honesty (the 0.25.2 lesson):** "the connection between a sign-in and a person can now be made only by accepting an invitation" claims more than the record admits, because the owner path is open. Suggested wording: *"…can now be made from a congregation's side only by accepting an invitation."*

### R24: users email uniqueness. Accepted: replace the revoke with `users_email_lower_uq`, plus one required edit

- **Why I accept it:** the seven `presby_app` writers and the adapter rule out the revoke. A trigger cannot tell a real email-change update from a forged one, because `presby_app` can write the verification table too.
- **The index helps more than the tech-lead claimed:**
  - The 0059 comment at `drizzle/0059_presby_account_invitations.sql:1056–1060` names a race that is open today. In new-account mode the `lower(email)` existence check is not a lock, and `users_email_unique` only stops exact-case collisions.
  - The new index closes that race.
  - It also makes the identity match in acceptance step 3 deterministic.
- **Branch measurement:** 95 users and 95 distinct lowered emails. That is higher than the design's 31, still with no duplicates.
- **Required edit E1, the step-5 error mapping:**
  - The re-created `presby_accept_invitation` maps `unique_violation` by constraint name, and only `users_email_unique` (line 1280) maps to `account_exists`.
  - After 0064, the race above raises `users_email_lower_uq`, which would be re-raised and surface as `db_error`.
  - Add `users_email_lower_uq` to that arm, for all purposes. Pin it with the existing source-scan or DB-test mapping table.
  - Doing this inside the full re-creation is safe. The FA and treasurer parity golden does not exercise this race.
- **Behaviour change to record in DECISION-208:** a Google sign-in whose address is a case-variant of an existing account now fails at the adapter's insert, instead of quietly creating a second account. That is the intended direction.
  - The verify-email path already catches any 23505 by error code (`verify-email/[token]/page.tsx:96`), so nothing changes there.
- **Suggestion S10, F187's status:** do not narrow the finding's title. F187 as raised was "`presby_app` keeps DML on `users`, which undermines the email match".
  - Record it as **narrowed**, not closed: the case-variant is closed and the definer-mediated email change stays open (TODO).
  - DECISION-208's drafted text is otherwise accurate.

### R21: the sender authority check. Amended: the widening is right, but apply the same time window to every source

- **Why the widening is right:** stating T in permissions over every source that is not a derived group fits "authority you could have created yourself" better than a list of sources.
- **The derived-group exclusions are sound:**
  - Excluding `active_membership` is exactly correct. The sender is an active member holding `people.manage`, so they hold every permission granted through `active_membership` as well. T minus that baseline loses nothing.
  - Excluding `session` and `diaconate` depends on `officers.manage`. That matches Increment 2's self-constitution residual: an `officers.manage` holder can already create the officer term that gives that authority.
  - Known consequence, to record in DECISION-207 rather than turn into a new rule: a tenant role bound to the Session group reaches an invitee through a sender who holds `officers.manage` but not that role's keys.
- **Amendment A4, the time window:**
  - The design counts future-dated **person** grants but computes the rest of T "as of today". If T is built from `presby_effective_permissions(…, current_date)`, it misses future-dated managed-group grants and future-dated managed-group memberships. The resolver's `starts_on <= p_as_of` filters them out.
  - Build T directly from `role_grants` (both the person arm and the managed-group arm) joined to `group_memberships` for managed groups, using `ends_on is null or ends_on > current_date` on every row and **no `starts_on` bound**.
  - The sender's own set stays as of today: you may not lend authority you do not yet hold.
  - The branch has 0 such future-dated rows today, so this is about getting the shape right.
- **Amendment A5, which groups count as derived:**
  - Identify derived groups by a closed list: `membership_source = 'derived' and derived_from in ('active_membership','session','diaconate')`.
  - Any new derived kind then falls into T (fails closed) until someone classifies it. Pin the list by test.
  - The commission and delegation sources (resolver arms 3 and 4) reach only people with a membership at another organisation. R31 (`needs_support`, check 4) refuses those before checks 5 and 6, so T need not model them. State this in the design and let the R31 test cover it.

## F177, Option 3: view

Option 3 is architecturally sound, and I prefer it to Option 1 for this increment.

- **It fits recorded decisions.** DECISION-065 names visitors as grantees of the ability to browse the directory, so a visitor login reading tier-1 directory data, privacy-filtered, is inside the tier model. Option 1 reverses a recorded decision and needs a visitor baseline role designed alongside it.
- **The acknowledgement is a disclosure, not a control.** It reduces no exposure, so DECISION-207 and the release note must say so plainly, which the draft does.
- **I accept it on four conditions:**
  1. The definer enforces `needs_acknowledgement`, not the UI (as designed).
  2. The audit row records `acknowledged` in the same transaction.
  3. The visitor test is pinned equal to the Community Visitors list's test.
  4. F177 stays **open**, with Option 1 plus a visitor baseline role as the first item of Increment 3's Phase 2.
- **Two notes for the record:**
  - F177 also covered staff anchors with no roll. Option 3 asks for an acknowledgement for visitors only. DECISION-207 should say that staff anchors reading the directory is accepted on purpose (it is part of their job), not overlooked.
  - When Option 1 lands it will take directory access away from visitors who accepted under Option 3. The release note's "narrower view in a later release" already sets that expectation; keep that sentence.

## Invariants touched

- **Isolation and the link as a database property:** stronger with A1, since every non-owner role is refused.
- **Permissions vs flags, and credentials:** unchanged. The credential still grants nothing.
- **Two hierarchies:** respected. R31 sits ahead of the authority checks.
- **No real data:** respected. Counts only.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2b · 3a — Architect review of design departures | architect | Complete. R23 amended (refuse any non-owner role; owner-path source scan; release-note wording); R24 accepted with E1 (map `users_email_lower_uq` to `account_exists` in step 5) and F187 recorded as narrowed (S10); R21 amended (no `starts_on` bound on any non-derived source; closed list of derived kinds; commission and delegation left to R31); F177 Option 3 endorsed on four conditions. No new numbers. | Approved with suggestions | 2026-10-22 |

## Handoff

Next agent: the **tech-lead** folds A1–A5 and E1 into the design and DECISION-207/208 in place, with no new phase. Then **Phase 4 Batch A (database-admin)**, after Increment 2's Phase 4 commits, as already sequenced. The operator's choice on F177 is still needed before Phase 4.

I wrote nothing. My only database access was read-only (`default_transaction_read_only=on`) against the pipeline branch `ep-jolly-boat-axklya0l`: roles and role memberships, owners, RLS flags, grants on `people` and `users`, column grants on `people.user_id`, triggers, the `users` indexes and the case-duplicate count, group sources, future-dated authority rows, and `presby_effective_permissions`. Nothing touched production or `development`.

Files read:
- `/Users/cshenso/git/presby-platform/presby-fadir/docs/work-log/2026-10-22-founding-admin-directory.md`
- `/Users/cshenso/git/presby-platform/presby-fadir/drizzle/0059_presby_account_invitations.sql`
- `/Users/cshenso/git/presby-platform/presby-fadir/drizzle/0061_presby_participant_roll.sql`
- `/Users/cshenso/git/presby-platform/presby-fadir/src/app/(email-verify)/account/verify-email/[token]/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-fadir/src/auth.ts`

### Operator ruling on F177 (2026-10-22)

- **"Warn and confirm."** Option 3: inviting a visitor needs an audited acknowledgement from the sender that the visitor will be able to see the directory. Narrowing `active_membership` is deferred to Increment 3. Production measurement (orchestrator, read-only, 2026-10-22): 0 case-duplicate email groups in `users`, so `users_email_lower_uq` applies cleanly.


---

# Increment 2 — Phase 4

## Batch A (migrations 0062, 0063) — database-admin, 2026-10-23

Worktree `presby-fadir`, branch `pipeline/session-approval`, Neon branch `pipeline-session-approval` (`ep-autumn-mountain-axe0l5il`). Built to Phase 3's Data Model and section order. DECISION-206 was confirmed by the operator, so the pastor artifacts (R10-R12, S1) are in.

### Migration mode

**Hand-written.** Apply: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0062_presby_session_approval.sql` (and the same for `0063_presby_roll_decide_lockdown.sql`, **only after Batch B's code is deployed**, per R16). No `_journal.json` edit (Rule 16). Integration adds `{ idx: 62, tag: "0062_presby_session_approval" }` and `{ idx: 63, tag: "0063_presby_roll_decide_lockdown" }`.

- **0062 is applied on the pipeline branch.**
  - The whole file was applied twice. Both runs exit 0.
  - First run: `INSERT 0 13` groups (6 Session plus 7 Board of Deacons, matching Measurement 1), `INSERT 0 8` session_member grants (9 congregations minus Alder's existing role), `UPDATE 1` (Rowan's pastor term re-materialised).
  - Second run: `INSERT 0 0`, `INSERT 0 0`, and the no-op touch `UPDATE 1`.
  - Row counts and md5 digests of `roll_actions`, `app_roles`, `app_role_permissions`, `role_grants`, `groups`, `group_memberships`, `officer_terms` and `memberships` are identical after run 1 and run 2.
  - The `roll_actions` digest moved only because the row text gained three null columns. A digest of the original 15 columns equals the pre-apply digest. No row carries the new columns.
  - It was re-applied twice more as the restore step of the failing-first proofs. Exit 0 each time.
- **0063 is NOT applied. The branch is at the 0062 state.**
  - `neonctl` here is authenticated to a different Neon account, so no child branch could be made. The owner also cannot `SET ROLE presby_app`.
  - So 0063 was applied for real twice (both exit 0, data snapshot unchanged), the lockdown-state runs and proofs below were done, and then it was reverted with exactly the rollback statements in 0063's header (plus `presby_platform`'s grants).
  - Verified afterwards: the ACL equals the baseline, the policy text is 0061's, and the terminal-stamps CHECK is absent.
  - Batch B applies 0063 before its DB gate, as designed.
- **Fresh install.** A throwaway empty database was created on the pipeline branch and then dropped. The recipe was QA's from Increment 1:
  - `drizzle/` copied to the scratchpad with the two journal entries added;
  - `drizzle-kit migrate`: 63 migrations (0000-0063, 0058 reserved), none failed;
  - every 0062/0063 object present (5 functions, 6 CHECKs, the trigger, both indexes, the narrowed policy, `presby_app` without UPDATE or DELETE);
  - `db:seed` exit 0 (39 flags, 6 roles);
  - `check:schema-parity` 0 failing;
  - 0062 and 0063 hand re-applied twice, exit 0.

### Files

- **Created:**
  - `drizzle/0062_presby_session_approval.sql`;
  - `drizzle/0063_presby_roll_decide_lockdown.sql`;
  - `src/lib/db/domain/session-approval.db.test.ts` (49 tests);
  - `src/lib/db/domain/roll-decide-lockdown.db.test.ts` (10 tests: 5 catalog tests that run in either state, 5 behavioural tests that run only when 0063 is applied);
  - `scripts/session-approval/test-rls-62.sql` (53 assertions, as `presby_app`, requires both migrations);
  - `scripts/session-approval/test-rls.sql.integration.patch` (against the current file with section 61; `git apply --check` clean, +54/-31). It rewrites section 5 and 20d for the lockdown state and appends `\ir session-approval/test-rls-62.sql` with a banner.
- **Modified:**
  - `src/lib/db/domain/roll.ts` and `officers.ts` (mirror: three columns, the `decided_by` FK, four CHECKs, both indexes, and NOT-EXPRESSIBLE notes for the policy, revoke, triggers and definers);
  - `src/lib/db/domain/participant-roll.db.test.ts` and `scripts/participants/test-rls-61.sql`. These are the Increment 1 assertions 0062/0063 change: policy text relaxed to the half that holds in both states, CHECK list scoped to 0061's three, void-index predicate updated, the section 4 replay drops the R7 index inside its rolled-back transaction, parity inserts roll back per savepoint, pending positive controls use a gain kind, and a denied fixture carries its stamps;
  - `docs/schema-design.md`: new subsection "Session approval and withdrawal", plus `docs:erd` (one new edge, `decided_by`).

### Deviations from Phase 3

1. **The S1 trigger also fires on `ends_on` and refuses re-opening a closed pastor term**, or moving an open one onto a rolled person. Phase 3 said `UPDATE OF person_id, office` only, which left re-opening as a bypass. Ending, shortening or extending an already-open term never fails, which keeps Phase 3's intent. It raises with `constraint = 'officer_terms_pastor_no_roll'`, so Batch B maps it without parsing messages.
2. **0063 also revokes UPDATE and DELETE from `presby_platform`.** It cannot log in and no path uses them; the grant documents intent. The rollback note says they need not be restored.
3. **Two extra stop-blocks in 0062:** the `court` group type is missing (section 6), and a pastor-office term sits at an organization with no Session group (section 8c, which would otherwise raise inside the touch). Both measured 0.
4. **The void-index re-predicate is guarded on its own definition** (drop only if the old predicate is present), so a re-apply does not churn the index.
5. **On deny, `self_approved` and `self_target` are false.** They are computed on approve only. The deny contract has no such fields.
6. **The backfilled grant's `starts_on` is `current_date`** (Phase 3 was silent).
7. **The tests carry SQL-literal lists** (outcomes, approvable kinds, counted kinds, Session, pastor and office lists) because `roll-action-kinds.ts` and `officer-offices.ts` are Batch B's. Batch B replaces them with imports.
8. **`roll.test.ts` is not touched; it is handed to Batch B** (below). In the 0062 state its `beforeAll` hits R7 (four pending rows for one subject), so its 47 tests skip.

### Gates

- **Full `scripts/test-rls.sql` as `presby_app`** (scratch copy, stop-on-error off):

  | Run | Passes | Failures |
  |---|---|---|
  | Baseline, before 0062 | 1138 | 4 pre-existing: presbytery members 3≠2; 2fa definer; DECISION-152 count; `46i` |
  | After 0062, unpatched | 1137 | The same 4, plus the one Phase 3 predicted: section 5's `denial_reason = 'editable'` on a pending row (line 276) |
  | Lockdown state, **patched** | 1192 | Only the same 4 pre-existing |
- **Standalone suites as `presby_app`:**
  - `test-rls-62.sql`: exit 0, 53 passes (lockdown state);
  - `test-rls-61.sql`: exit 0, 34 passes, in both the 0062 and lockdown states.
- **DB Vitest, serial.**
  - Final run (0062 state), the three Batch A files: 96 passed, 5 skipped (the behavioural half of the lockdown test).
  - Lockdown state: all three files green, 100 tests, including lockdown 10/10, after the two fixture-stamp fixes.
  - Blast radius (0062 state): `people`, `officers`, `community.db`, `org-provisioning`, `role-grants`, `role-definitions`, `directory`, `people-update`, `org-portal/home-data`, `org-portal/find-person`, `designation-parity.db`: 324 tests. The first run had 3 × 20 s timeouts in affiliation and org-delete cases. `org-provisioning` re-ran 31/31.
- **Other checks:**
  - `check:schema-parity`: 85 tables, 0 failing (7 pre-existing allowlisted);
  - `typecheck` and `lint` clean;
  - `npm run check` (all tripwires) passes;
  - `npm run test`: 504 files passed, 7604 tests.

### Failing-first proofs

Each mechanism was broken on the branch, then tested, then restored by re-applying the migration file, then re-tested green (section 62 exit 0 with 53 passes; Vitest 49/49 and 10/10).

| Mechanism | Broken by | Failure observed |
|---|---|---|
| (a) decide actor check (`roll.approve`) | identity clause replaced by `or false` | `session-approval.db.test.ts` "decide: no org context…" and "an elder whose membership has ended…" (`:341` / `:764`, "expected the uniform identity refusal"); `test-rls-62.sql` 62d line 277 errors: the function went on to approve for a user with no person (FK violation on `approved_by`) |
| (b) decide org predicate (step 1) | `and ra.organization_id = v_org` removed | "not_found…" `:418`: another org's row came back `already_on_roll` instead of `not_found` |
| (c) withdraw actor check (`roll.propose`) | identity clause replaced by `or false` | "withdraw: … an approve-only elder…" `:341` |
| (d) denied/withdrawn freeze | the 0062 freeze branch removed | "as the owner, UPDATE and DELETE of an approved, a denied and a withdrawn row…" (statement not rejected) |
| (e) one pending per person | index dropped | "R7 and R1d…" `:576`; "a second pending row…" (not rejected); 62a line 103; 62b line 211 "FAIL 62b - a second pending roll action for one person was accepted (R7)" |
| (f) S1 pastor guard | trigger dropped | structure `:592`; both S1 tests (not rejected); 62f line 437 "FAIL 62f - an open pastor term was recorded for a person on the roll (S1)" |
| (g) pastors in the Session CASE | three CASE arms removed | CASE test `:1259` ("installed_pastor: expected null to be 'session'"); touch `:1280`; inheritance `:1291`; DECISION-206 pastor-approves `:1053`; live-function pin `:1406` |
| (h) 0063 revoke | `grant update, delete … to presby_app` | 62a line 77 "FAIL 62a (R16, 0063): presby_app holds NEITHER UPDATE NOR DELETE…"; 62c line 227 "FAIL 62c - presby_app approved a roll action by plain UPDATE (F180)"; `roll-decide-lockdown.db.test.ts:299` and the plain-SQL test |
| (i) 0063 narrowed policy | 0061's pending-only policy restored | 62b line 165 "FAIL 62b - presby_app inserted a pending LOSS row (F191)"; the lockdown F191 test |

Proof (h) exposed a test defect, fixed before commit: the lockdown test's "is 0063 applied?" switch read the very privilege under test, so a re-grant would have skipped the behavioural half silently. It now reads 0063's own CHECK, and a live-catalog privilege assertion was added.

### Handoff to Batch B (api-developer)

- **Call shapes.** Inside the caller's `withOrgContext` transaction, with no org parameter:
  - `select * from presby_decide_roll_action($id::uuid, 'approve'|'deny', $minute::text, $reason::text, $actingUserId::uuid)` returns exactly one row `{ outcome, roll_action_id, subject_person_id, action_kind, action_effective_date, affects_filed_period, shadowed_by_kind, shadowed_by_date, self_approved, self_target }`;
  - `select * from presby_withdraw_roll_action($id::uuid, $reason::text, $actingUserId::uuid)` returns `{ outcome, roll_action_id, subject_person_id, action_kind, action_effective_date, self_proposed }`;
  - the identity refusal is SQLSTATE `42501` with message exactly `roll_actions: this roll decision is not permitted`;
  - on a non-`ok` outcome nothing was written, but the caller must still throw to roll back its own transaction.
- **Vocabularies:**
  - decide: `ok, invalid_decision, reason_required, reason_too_long, minute_reference_too_long, not_found, already_decided, not_approvable_kind, person_deceased, person_merged, membership_ended, holds_pastoral_office, already_on_roll, active_elsewhere, provisioning_incomplete`;
  - withdraw: `ok, reason_required, reason_too_long, not_found, already_decided`.
- **Errors to map:**
  - R7: `23505` with `constraint = 'roll_actions_one_pending_per_person_idx'` becomes `pending_exists`;
  - S1: `23514` with `constraint = 'officer_terms_pastor_no_roll'` becomes `on_roll`;
  - a Session or pastor office at a non-congregation: `23503` "organization % has no derived group session" becomes `invalid_office_for_org`.
- **`src/lib/roll.test.ts` needs rework for R7 and 0063:**
  - the `beforeAll` `pendingAction` ×4 for one subject (`:334-352`);
  - the Finding 2 test (`:579`, a further pending row for that subject; after 0063 the DELETE is 42501);
  - the FORGERY test (`:875`, several pending proposals for one subject through `recordRollAction`, which is now `pending_exists` after the first);
  - the two B-M3 pending voids for that subject (`:1052`, `:1092`);
  - plus everything Phase 3 already listed (approve/deny through the definers, the freeze at `:532` becomes 42501, teardown).
- **Swap the SQL-literal lists** at the top of `session-approval.db.test.ts` and `roll-decide-lockdown.db.test.ts` for the TypeScript constants.
- **Apply 0063 (twice) before your DB gate.** Then the lockdown test's behavioural half runs (10/10 expected).

### Integration hand-offs (orchestrator, Rule 16)

- `_journal.json`: the two entries above.
- `git apply scripts/session-approval/test-rls.sql.integration.patch`, then re-run `scripts/test-rls.sql` as `presby_app` on merged `development` **with both 0062 and 0063 applied**. The patched sections 5 and 20d and section 62a assume the lockdown state; the unpatched file fails section 5 on 0062 alone.
- No `seed-dev.sql` change. F190 is unchanged; section 62 never relies on Tobias lacking `roll.approve`.
- Re-measure production before deploy (0062 header): congregations without court groups, org-owned `session_member` roles, distinct offices, pending duplicates.

## Batch B (server: library, actions, audit) — api-developer, 2026-10-23

Worktree `presby-fadir`, branch `pipeline/session-approval`, Neon branch `pipeline-session-approval`. Built to Phase 3's API Contract and Batch A's hand-offs. No route handlers: every entry point is a server action or a library function.

### 0063 applied

0063 was applied to the pipeline branch **twice** before any DB gate (both runs exit clean, `roll_actions` rows and digest unchanged: 29 rows, `c89d89f0…`). The branch is now in the **lockdown state**: `presby_app` holds neither `UPDATE` nor `DELETE` on `roll_actions`, `roll_actions_terminal_decision_stamps` exists, and the insert policy admits only the seven approvable gain kinds. Every DB-backed result below ran in that state. Do not revert it: `roll.test.ts` and the three Batch A suites now assume it.

### Files

- **Created:**
  - `src/lib/officer-offices.ts`: the one home of `OFFICER_OFFICES`, `OFFICE_LABELS`, `SESSION_OFFICES`, `PASTOR_OFFICES`, `isSessionOffice()`, `isPastorOffice()` (pure).
  - `src/lib/session-approval-state.ts`: the five Flow 7 state kinds and the pure `deriveSessionApprovalKind()`.
  - `src/app/(org)/o/[slug]/admin/community/pending/decision-copy.ts`: `DECISION_COPY`, `WITHDRAW_COPY`, `BULK_COPY` (`Record<code, string>` over the closed vocabularies).
  - Tests: `src/lib/decide-boundaries.test.ts` (21, source scans), `src/lib/officer-offices.test.ts` (10), `src/lib/session-approval-state.test.ts` (7).
- **Rewritten or extended:**
  - `src/lib/roll.ts`: `approveRollAction`, `denyRollAction` (now takes `actingUserId`), new `withdrawRollAction`, `approveRollActions` (bulk), `listPendingRollActions` (decide and read modes, pagination), `listRecentlyDecidedRollActions`, `countPendingRollActions`, `getSessionApprovalState`, `organizationHasSession`; `recordRollAction` gains `proposal_refused`. No longer imports `recordAudit`.
  - `src/lib/roll-action-kinds.ts`: `APPROVABLE_ROLL_ACTION_KINDS`, `COUNTED_GAIN_KINDS`, `ROLL_DECISION_REFUSALS`, `ROLL_WITHDRAW_REFUSALS`, `PROPOSAL_REFUSALS`, `BULK_APPROVE_MAX`, `isApprovableKind()`.
  - `src/lib/officers.ts`: pastor offices, `invalid_office_for_org`, `on_roll`, in-transaction audit with `selfRecorded`, `listOfficerRoster` returns `selfRecorded`; `endOfficerTerm` gains `actingUserId`.
  - `src/lib/people.ts`: `createPerson` returns `proposal_refused` (`no_session`, `pending_exists`).
  - `src/lib/org-provisioning.ts`: type-varying `baselineRoleSeedPlan` (`session_member` for a congregation, `boundToDerivedFrom` widened).
  - `src/lib/audit.ts`: `ROLL_ACTION_WITHDRAWN: "tenant.roll_action.withdrawn"`.
  - `src/lib/db/errors.ts`: `pgErrorField`, `pgErrorMessages`, `isPgError` (map a specific constraint to a typed outcome, never parse a message).
  - Actions: `community/pending/actions.ts` (four actions), `officers/actions.ts` (audit removed, new results), `community/new/actions.ts` and `community/[id]/edit/actions.ts` (`proposal_refused`), `staff/actions.ts` (exhaustiveness), `community/participant-copy.ts` (`PROPOSAL_COPY`).
  - UI files touched only to keep the build green (Batch C owns their behaviour): `officers/office-labels.ts` (now a re-export), `officers/end-term-dialog.tsx` (no longer sends `personId`/`office`; the prop is kept, unused), and fixtures in `pending-worklist.test.tsx`, `officer-roster.test.tsx`, `end-term-dialog.test.tsx`.
  - Tests rewritten or extended: `roll.test.ts` (95), `officers.test.ts` (45), `people.test.ts` (36), `org-provisioning.test.ts`, `roll-action-kinds.test.ts` (36), `audit.test.ts`, `db/errors.test.ts` (36), `pending/actions.test.ts` (23), `officers/actions.test.ts`; `session-approval.db.test.ts` and `roll-decide-lockdown.db.test.ts` now import the TypeScript constants in place of Batch A's SQL-literal lists.

### Contract (what Batch C consumes)

All server actions: `auth()` in the body, `resolveOrgContext()` re-run, organization and acting person from the session, never the client; result is `ActionResult<T>`.

| Action (file `community/pending/actions.ts`) | Gate | Input | Data on `ok: true` |
|---|---|---|---|
| `approveRollActionAction(slug, { rollActionId, minuteReference? })` | `roll.approve` (lib pre-check, then the definer by `users.id`) | UUID-checked id; minute at most 200 | `{ rollActionId, effectiveDate, futureDated, affectsFiledPeriod, shadowed: {kind, effectiveDate} \| null, selfApproved }` |
| `approveRollActionsAction(slug, { rollActionIds, minuteReference? })` | `roll.approve` | 1 to 50 unique ids | `{ approved, failed: [{rollActionId, error}], affectsFiledPeriod, shadowedCount }`; `ok: true` even when `failed` is non-empty; `ok: false` only for empty, over 50, or forbidden |
| `denyRollActionAction(slug, { rollActionId, reason })` | `roll.approve` | reason 1 to 500 after trimming | `{ rollActionId }` |
| `withdrawRollActionAction(slug, { rollActionId, reason })` | `roll.propose` | reason 1 to 500 | `{ rollActionId }` |

Every refusal maps through `DECISION_COPY` / `WITHDRAW_COPY` / `BULK_COPY` (`decision-copy.ts`); `PROPOSAL_COPY` (`participant-copy.ts`) covers `no_session` and `pending_exists` for `createPersonAction` and `recordRollActionAction` (both gain a `proposal_refused` arm). `endOfficerTermAction(slug, { termId, endsOn, endReason })` no longer accepts `personId`/`office`. `startOfficerTermAction` returns copy for `on_roll` and `invalid_office_for_org`.

Library reads for the pages (all gated on `roll.approve` OR `roll.propose`, forbidden otherwise):

- `listPendingRollActions(viewer, org, { page?, pageSize? })` returns `{ kind: "ok", mode: "decide" | "read", actions, pagination: { page, pageSize, total, totalPages }, viewer: { canApprove, canPropose, canManagePeople } }`. **Page size is 50** (the bulk cap), so the existing page now shows only the first 50 until Batch C adds `?page=`. Each action adds `personId`, `minuteReference`, `proposedOn`, `membershipEnded`, `personDeceased`.
- `listRecentlyDecidedRollActions(viewer, org, { limit? })`, `countPendingRollActions(viewer, org)`, `getSessionApprovalState(viewer, org)` as in Phase 3 (counts only, no names).
- **The current `pending/page.tsx` does not switch on `mode` yet**, so a propose-only holder now loads the page and sees Approve and Deny buttons that return the forbidden copy. Batch C must render read mode.
- Officers: `listOfficerRoster` entries carry `selfRecorded`; `OfficersResult` gains `on_roll` and `invalid_office_for_org`; the vocabulary now has the three pastor offices.

### Deviations from Phase 3

1. **`deriveSessionApprovalKind` and the state type live in a new pure `session-approval-state.ts`**, re-exported from `roll.ts`, so the derivation is unit-tested without a database and client components can import it.
2. **`BULK_APPROVE_MAX` lives in `roll-action-kinds.ts`** (re-exported from `roll.ts`): a `"use server"` file cannot export a constant, and the dialog and `decision-copy.ts` need it.
3. **`decision-copy.ts` was created here, not in Batch C**, because the actions cannot map refusals without it. Success and warning toast strings are left to Batch C.
4. **Bulk with a mid-run `forbidden`** (a key revoked during the loop) marks the remaining rows `forbidden` rather than dropping them; a `forbidden` on the first row is the whole result.
5. **UUID shape is checked in `startOfficerTerm`, `endOfficerTerm` and the four actions** (a malformed id is `invalid_target` / `not_found`, never a cast error); `startOfficerTermAction` turns an unknown office into a message instead of the lib's throw. Not in Phase 3, in its spirit.
6. **Both layers carry the S1, F189 and R7 backstops**: a TypeScript pre-check and a mapping of the database's own refusal (`officer_terms_pastor_no_roll`, `has no derived group`, `roll_actions_one_pending_per_person_idx`), so a race returns the typed result. The two pre-checks are individually redundant with their backstops by design (the failing-first run removes both together).
7. **`createPerson`'s `pending_exists` is a backstop only**: a person new to the organization has no pending row and an existing member is `already_here`, so no test can reach it without a race; it is exercised only through `isPgError`'s unit tests and the identical path in `recordRollAction` (R7 race test).
8. **`listRecentlyDecidedRollActions`' `decidedOn` falls back to `recorded_at`** when a row has neither `decided_at` nor `approved_on` (a seed row), so it is always a date.
9. **A membership cannot end while an officer term is open** (`memberships_guard_end`), so "a Session seat held by someone whose membership ended" cannot exist; the state test covers an ended term instead.

### Gates

- `npm run typecheck`, `npm run lint` (max-warnings 0): clean. `npm run check` (all eight tripwires): pass. `check:audit` passes vacuously (the actions call no `db.*`), so audit coverage is proven by `roll.test.ts`, `officers.test.ts` and `decide-boundaries.test.ts`.
- `npm run test`: **507 files passed, 74 skipped; 7685 tests passed, 2283 skipped** (Batch A: 504 and 7604).
- DB-backed, serial, 0063 applied:

  | File | Result |
  |---|---|
  | `roll.test.ts` | 95 / 95 (the first full run had one `Connection terminated unexpectedly` on one test; the full re-run is clean) |
  | `officers.test.ts` | 45 / 45 |
  | `people.test.ts` | 36 / 36 |
  | `org-provisioning.test.ts` | 34 / 34 |
  | `session-approval.db.test.ts`, `roll-decide-lockdown.db.test.ts` (10 / 10, behavioural half included), `participant-roll.db.test.ts`, `roll-derive-parity.db.test.ts` | 102 / 102 |
  | Blast radius, 20 files (community.db, groups, staff, role-grants, role-definitions, home-data, find-person, people-update, founding-administrator, designation-parity, accept.db, designation-holders, treasurer-designation, presbytery, imports, lifecycle, sasr-fields, statistics-grants, filings, directory) | passed; the first batch run had 5 timeouts and WebSocket closes in `directory.test.ts` and `designation-parity.db.test.ts`; both re-ran green (directory 99 / 99 with `--testTimeout=180000 --hookTimeout=300000`, designation-parity 12 / 12). Remote-database latency, not a change in either file |

- `scripts/session-approval/test-rls-62.sql` as `presby_app`: exit 0, **53 passes, 0 failures**. `scripts/participants/test-rls-61.sql`: exit 0, **34 passes, 0 failures**.
- The roll.test.ts first full run had one `Connection terminated unexpectedly` on a single test; it passed on re-run.

### Failing-first evidence

Each mechanism was broken in the source, the focused tests were run, and the file was restored (verified: no mutation text remains). Harness: a script in the session scratchpad applying one edit, running the named test filter, restoring.

| # | Mechanism broken | Tests that failed |
|---|---|---|
| 1 | Audit failures swallowed for every in-transaction audit in `roll.ts` (the old `recordAudit` semantics, F180) | `roll.test.ts`: approve, deny, withdraw, bulk and participant "a failed audit insert rolls ... back" (6 tests) |
| 2 | Database identity refusal no longer mapped to `forbidden` | "FORGERY: a users.id that is not the acting person's is refused by the database" |
| 3 | Withdraw pre-checks `roll.approve` instead of `roll.propose` | `decide-boundaries.test.ts` "each decision pre-checks the right key" (the database still refuses by `users.id`, so only the scan can see this) |
| 4a | `recordRollAction` no longer refuses with no Session | "R15: an organization with no Session refuses a membership proposal" |
| 4b | `createPerson` no longer refuses with no Session | "an organization with no Session refuses a member proposal ... rolled back" |
| 5 | One pending per person: pre-check and unique-violation mapping both removed | three tests: sequential `pending_exists`, the race (one ok and one `pending_exists`), "releases the person" |
| 6 | `selfRecorded` hard-coded false | start-and-end stamp test, roster `selfRecorded` test |
| 7 | Pastor-on-roll: pre-check and trigger mapping both removed | both S1 tests (cache and replay cases) |
| 8 | `invalid_office_for_org`: pre-check and foreign-key mapping both removed | the typed-refusal test (raw FK error instead) |
| 9 | An application `UPDATE` of `roll_actions` added | `decide-boundaries.test.ts` "no non-test file under src/ matches update(rollActions)" (the 0063 safety proof) |
| 10 | Bulk cap removed | "deduplicates ids ... caps the request at 50" |
| 11 | Action stops validating the id shape | "a malformed id is not_found copy and the lib is never called" |
| 12 | Queue read gate narrowed back to `roll.approve` | "a roll.propose-only holder gets READ mode" |
| 13 | Decided-history gate removed | "forbidden without either roll key" |
| 14 | Propose-only viewer shown decide mode | "a roll.propose-only holder gets READ mode" |
| 15 | Bulk `forbidden` on the first row no longer ends the run | "forbidden on the first row is the whole result" |
| 16 | `no_permission` dropped from the derivation | `session-approval-state.test.ts` |
| 17 | End-term audit reads person and office from caller input | "the term's own people-and-office are the audit source" |
| 18 | `recordAudit` imported back into `roll.ts` | `decide-boundaries.test.ts` "no longer imports recordAudit" |

### Handoff to Batch C (ux-developer)

- Next: **ux-developer, Batch C** (pending page, worklist, bulk and withdraw dialogs, banner, history, Community header link, edit-page and wizard changes, Officers page). Read the Contract above; `decision-copy.ts` and `participant-copy.ts` hold the refusal strings, the Phase 3 Copy section holds the rest.
- The wizard and the edit page decide whether to offer Member with `getSessionApprovalState` (called only when `canProposeRoll`); `kind === "no_session"` hides it. The server refuses regardless.
- `EndTermDialog` still takes a `personId` prop it no longer uses; drop it when convenient.
- `e2e/community-participants.spec.ts:228` and the e2e fixtures still need a Session group at `alpha` (Batch D); `createOrganization` now also creates a `session_member` role for every congregation, which any e2e role-count assertion would see.
- Rule 16, unchanged by this batch: the journal entries, the `test-rls.sql` integration patch and the other shared files stay with the orchestrator (Batch A's hand-offs stand). `docs/TODO.md` follow-ups from Phase 3 are still the orchestrator's.

## Batches C and D (UI, e2e, hydration) — ux-developer, 2026-10-23

Worktree `presby-fadir`, branch `pipeline/session-approval`. Built to Phase 3's Component Plan and Copy (verbatim) and Batch B's contract. Neither migration touched; the branch stays in the lockdown state.

### What was built

- **Pending queue (`community/pending/`).**
  - `page.tsx` switches on `mode`. A propose-only holder gets read mode: no checkbox, Approve or Deny, the "Only members of the Session can approve" subtitle, Withdraw, and the Flow 7 banner in every state.
  - Decide mode shows the banner only for `no_session`.
  - `?page=` pages the queue 50 at a time through the shared `Pagination` (page 1 is the bare URL; garbage falls back to 1).
  - New files: `pending-row.tsx`, `approve-roll-action-dialog.tsx`, `deny-roll-action-dialog.tsx`, `bulk-approve-dialog.tsx`, `session-state-banner.tsx` (the five states; `NO_SIGN_IN_INVITE_LINE` is the one constant 2b replaces), `recently-decided.tsx`, `decision-toasts.tsx`, and `community/withdraw-proposal-dialog.tsx` (shared with the edit page).
  - All dialogs are AlertDialogs with plain action Buttons, so a typed refusal leaves the dialog open. Every trigger and checkbox is `disabled` until `useHydrated()`.
  - Selection excludes rows approval would refuse outright (ended, deceased, non-approvable kind). The sticky bar has safe-area padding and each row `scroll-mb-28`.
  - Toasts are in `decision-copy.ts` (`DECISION_SUCCESS_COPY`); the future-dated one renders its date through `<FormattedDate>`.
- **Community header.** "Pending approvals" link with a "N waiting" badge, accessible name "Pending approvals, N waiting". A failed count hides the count, never the page.
- **Officers.** `SessionNote`, the three pastor offices (grouped by vocabulary order in the roster), the pastor helper, the self-recording note (needs the new `viewerPersonId` prop), and the "Self-recorded" badge. The typed-error copy was already in Batch B's action.
- **Edit page and wizard.** `ConnectionCard` gains Withdraw proposal and the "No one can approve yet. See why..." link (the Session state is read only when a proposal is waiting). The wizard hides Member when `getSessionApprovalState` says `no_session`, shows the Phase 3 note, and the review step says the proposal will wait when the Session cannot approve yet.
- **Badges.** "Self-approved" (Recently decided, approvals only) and "Self-recorded" (S2), plus "You proposed this", "Connection ended", "Recorded as deceased" and "Takes effect {date}".

### Tests

- **Unit.** Rewritten `pending/page.test.tsx` and `pending-worklist.test.tsx`; new `session-state-banner.test.tsx` and `new/connection-step.test.tsx`; extended community, new, edit, officers page, roster and add-form tests. Full suite: 509 files, 7740 tests passed.
- **e2e.**
  - `e2e/community-approval.spec.ts`, 13 tests at 1280 and 360px, covering Phase 3 items 1-7 with persisted-row and audit assertions.
  - `e2e/hydration/community-approval-controls.spec.ts`: dev lane and `test:e2e:prod` both pass.
  - `e2e/support/community-fixture.ts` ensures alpha has a Session group (removed only if the fixture made it), adds `e2e_session_approver`, `setRollApprove`, `createProposalViaSql`, and sweeps decided rows and their audit.
  - Blast radius fixed: `community-participants.spec.ts` (the empty Session now gives the honest review note); the whole spec passes at both widths.
- **Negative controls.**
  - Approve trigger un-gated: the hydration spec fails at `toBeDisabled()`.
  - `scroll-mb-28` removed: the sticky-bar test fails (computed scroll margin 0 against a 97px bar). Chromium centres a focused off-screen element, so the geometry check alone cannot catch it; the margin assertion is what discriminates.
- Run from a hardlinked scratch copy outside `~/git/presby-platform`. Two early runs failed on Neon `fetch failed` network drops and a slow dev `router.refresh()` (5s default); the spec now uses a 30s expect timeout, and both widths passed on re-run.

### Gates

typecheck, lint and `npm run check` clean; unit suite green; real-browser pass at 360 and 1280 (queue decide and read, selected bar, bulk, deny, withdraw dialogs, header, edit notice, officers) with screenshots kept in the scratchpad, none committed.

### Hand-offs

- **Reviewer click-through** (alpha, clerk): propose a Member in the wizard, open Pending approvals, select two rows, bulk approve; deny with a long reason; withdraw from the edit page; drop to read mode.
- **Copy for a branding pass:** Phase 3 Copy verbatim, plus the approve dialog's description (unchanged from Increment 1) and the "N selected" bar label.
- **Tradeoffs:**
  - Withdraw shows for every `roll.propose` holder on every row, not only their own (Phase 3 wording).
  - The Flow 7 `no_sign_in` count uses `startingLater` when no seat is live yet.
  - Roster grouping is a client-side sort by vocabulary order.
  - Not changed: `record-roll-action-form.tsx` already surfaces `pending_exists` and `no_session` through the action's `error`; no code change needed.
- **Not run:** the whole e2e suite beyond the community, hydration and prod-lane specs; QA should run it, because the shared fixture file changed.
- **Next:** qa (Phase 5). Rule 16 files untouched; AGENTS.md was not regenerated in the worktree.

---

# Increment 2 — Phase 5: Verification (qa)

## Run 1 — FAIL

**Date:** 2026-10-23
**Verified by:** qa
**Worktree / branch:** `/Users/cshenso/git/presby-platform/presby-fadir`, `pipeline/session-approval` at c561ca1. Neon branch `pipeline-session-approval`, which stays in the lockdown state (0062 and 0063 applied; nothing reverted).

**Verdict: FAIL.** The code, the database protections and the tests all hold. The FAIL comes from the copy-truthfulness check you made required: two pieces of copy tell the clerk something untrue or misleading. Both are small, wording-level fixes. One sentence was specified word for word in Phase 3, so it goes to tech-lead first.

## Scope run

- **Ran in full:**
  - typecheck, lint, `npm run check`, the unit suite;
  - the whole DB-backed set (`npm run test:db`), serially;
  - `test-rls-61.sql` and `test-rls-62.sql` as `presby_app`;
  - `git apply --check` of the integration patch;
  - live-catalog probes;
  - a fresh install;
  - the targeted e2e set at desktop and 360px.
- **Not re-run:**
  - the full `scripts/test-rls.sql`. Batch A's patched run stands (1192 passes, 4 failures that already existed). The post-merge run on `development` is still the gate.
  - the e2e suite beyond the community specs, which the PR's CI covers;
  - the `test:e2e:prod` lane. Batches C and D report it green.
- **Officers e2e:** no spec exists. Phase 3 Test Plan 4 says none asserts on `admin/officers`, so none was run.

**Discarded run.** My first e2e run (27 tests, 26 passed, 1 failed at `community-participants.spec.ts:96` at 360px, a `page.goto` timeout) used port 3000, the port your heads-up names. I can't rule out that another QA's Playwright shared that server, so I discarded the whole run. It also overlapped my DB suite run. Every e2e number below is from the re-run on my own port, 3330.

## Type Check

`npm run typecheck`: **PASS**. Lint (`--max-warnings=0`): PASS. `npm run check`: all eight tripwires pass.

## Unit Tests

Total: 10023 | Passed: 7740 | Failed: 0 | Skipped: 2283 (the DB-gated tests, which skip without `.env.local`) | Files: 509 passed, 74 skipped | Duration: 24s

## DB-backed Tests (`npm run test:db`, serial, pipeline branch)

**Run 1 (full):** 583 files, 10023 tests. 9964 passed, 13 failed, 46 skipped. Duration 94 min.
- **11 of the 13 failures were timeouts or a dropped Neon connection.** Five were 20s test timeouts, one a 60s timeout, four were 30s hook timeouts, and one run hit `ENOSPC` on the machine's temp directory (the disk is at 100%).
- 45 of the 46 skips came from three giving suites whose `beforeAll` failed this way. The other skip is the intentional `skipIf` in `render-pdf.test.ts:152`.
- The diff touches only one of the failing files, `officers.test.ts`.

**Run 2 (the 10 failing files, alone):**
- `officers`, `presbytery`, `giving-ingest-health`, `platform-read`, `donors`, `funds` and `domains`: all green, no skips.
- `org-features.test.ts` and `giving/ingest/process.db.test.ts`: 30s hook timeouts again.

**Run 3 (those two files, one at a time, `--hookTimeout/--testTimeout=180000`):** `org-features` 29/29 and `process.db` 27/27. Remote latency, not a regression; the diff touches neither file.

**Still red: `src/lib/db/fixture-deletable.test.ts:199, :224, :271`.** This is the canary for leaked fixture rows, and it reports branch state, not a code defect:
- **23 rows with closed windows.** All closed before my first run started (latest close 22:05 UTC), so they predate this phase. Nine carry the `Inc2-<timestamp>` last name from `src/lib/officers.test.ts:1116`, so they leaked during Phase 4 runs. My two runs of `officers.test.ts` (one with a timed-out test) leaked nothing, so I can't reproduce a teardown defect. These rows are now permanent on this branch only; CI uses an ephemeral branch.
- **2 rows with open windows, caused by my run 1.** Two giving fixture people, left when `donors`/`funds` lost their `beforeAll` connection. **Their window closes 2026-10-24 01:39 UTC.** Before then, someone with write access should run, on the owner connection: `delete from people where deletable_until is not null and deletable_until > now();`. I am read-only and did not.

## Isolation suites as `presby_app` (`rolbypassrls = f` confirmed)

- `scripts/participants/test-rls-61.sql`: exit 0, 34 passes, 0 failures.
- `scripts/session-approval/test-rls-62.sql`: exit 0, 53 passes, 0 failures.
- `git apply --check scripts/session-approval/test-rls.sql.integration.patch` against the current `scripts/test-rls.sql`: **clean**. That file matches current `origin/main`.

## Live-catalog probes (pipeline branch)

- **Catalog**, read as `presby_app`:
  - `roll_actions` is FORCE RLS (and so are `officer_terms`, `groups`, `group_memberships`, `app_roles`, `role_grants`);
  - `aclexplode`: `presby_app` and `presby_platform` hold only `INSERT` and `SELECT`;
  - the policies are the RESTRICTIVE `roll_actions_insert_pending_only` with the seven gain kinds, plus `tenant_isolation`;
  - all six CHECKs are present, and `officer_terms_office_allowed` is validated;
  - both partial unique indexes are present;
  - the triggers are `roll_actions_freeze` and `officer_terms_pastor_no_roll` (BEFORE INSERT/UPDATE OF person_id, office, ends_on);
  - the two decision functions are `prosecdef` with `search_path=public, pg_temp` and execute granted to `presby_app`;
  - `presby_roll__actor_holds` and `presby_guard_pastor_no_roll` are executable by the owner only.
- **Behaviour:** every write probe ran inside `BEGIN … ROLLBACK`.

| # | Probe (as `presby_app` unless noted) | Result | Layer that refuses |
|---|---|---|---|
| 1 | UPDATE a pending row, UPDATE pending→approved (forged approval), DELETE pending, DELETE approved | 42501 "permission denied for table roll_actions" | **Grant** (0063 revoke) |
| 2 | INSERT a pending `void` (valid `voids_action_id`), pending loss, pending `opening_balance`, pending `other_participant_enrolled`, and approved, denied or withdrawn at insert | 42501, error names `roll_actions_insert_pending_only` | **Restrictive RLS policy** |
| 2+ | Positive control: a pending `profession_of_faith` | Accepted (so probe 2 was the policy, not a CHECK) | — |
| 2j | A pending row for another org while in this org's context | 42501, unnamed policy | `tenant_isolation` |
| 3 | UPDATE or DELETE of a just-approved, just-denied or just-withdrawn row | 42501 | **Grant.** The trigger is never reached on this connection |
| 3o | **Owner** (`neondb_owner`): UPDATE or DELETE of approved, denied and withdrawn rows, including denied→pending | 23514 "approved/decided actions are immutable" | **Trigger** `roll_actions_freeze`. This is the only layer on the owner path |
| 3s | Owner: insert a denied row with no stamps | 23514 | CHECK `roll_actions_terminal_decision_stamps` |
| 4 | A second pending row for one person | 23505 | **Unique index** `roll_actions_one_pending_per_person_idx` |
| 5 | Decide with no org context, a null actor, a `users.id` with no person; withdraw as an approve-only elder; decide (approve and deny) as a **propose-only** actor (built inside the rolled-back transaction) | 42501, the uniform literal `roll_actions: this roll decision is not permitted` | **Definer identity check** (`presby_roll__actor_holds`) |
| 5 | `presby_app` calls `presby_roll__actor_holds` directly | "permission denied for function" | Function grant |
| 5 | Another org's roll-action id from this org | `not_found` | Definer's explicit org predicate |
| 5 | Sanctioned path: the seated elder approves, then approves again | `ok`, then `current_roll` projected to `active` and `decided_by`/`approved_by` stamped; second call `already_decided` | — |
| 5 | Deny: blank reason, 501 characters, decision `maybe`, then a valid deny | `reason_required`, `reason_too_long`, `invalid_decision`, `ok` (reason and stamps stored) | Definer (R4 bounds) |
| 5 | Withdraw as the propose-only actor, then again | `ok` (`withdrawn`, reason and stamps), then `already_decided` | — |
| 6 | Seeded installed pastor | Derived Session row from the term, `current_roll` null, 0 roll rows, replay null, holds `roll.approve` (and not `roll.propose`), not counted in `presby_roll_counts_as_of` | Trigger `presby_sync_derived_group` (seating) |
| 7 | Open pastor-office term for someone on the baptized or active roll; re-open a closed term; move an open term onto a person with a roll | 23514, constraint `officer_terms_pastor_no_roll` | **Trigger** S1 |
| 7 | A closed historical pastor term; ending the pastor's open term | Allowed | — |
| 7 | Office `bishop` | 23514 | CHECK `officer_terms_office_allowed` |
| 7 | Approve a gain for the pastor | `holds_pastoral_office`, row stays pending | Definer (R12) |
| 8a | R6 direction a: a reaffirmation in 2024 for someone active since 2020 | `already_on_roll`; `presby_roll_changes` unchanged | Definer |
| 8b | R6 direction b: approve a later profession (ok), then an earlier reaffirmation before it | `already_on_roll`; the profession gain count stays at 1 | Definer |
| 8c | Control: a 2018 profession before a 2020 `opening_balance` | `ok`, shadowed by `opening_balance` 2020-01-01; counted once | — |

Every protection the design credits refuses at the layer it names, with one clarification: on `presby_app`, decided rows are frozen by the **grant**, which refuses first. The freeze **trigger** is what binds the owner connection, and both were probed.

## Fresh install

- I created a throwaway database inside the pipeline branch and applied `drizzle/` from a scratch copy, adding the two journal entries that integration will add.
- **Migrations:** `drizzle-kit migrate` applied all 63 migrations (0000–0063, with 0058 reserved). None failed.
- **Catalog:** every 0062/0063 object is present: 5 functions, 6 constraints (validated), both indexes, the trigger, the narrowed policy, FORCE RLS, and `presby_app` with only INSERT and SELECT.
- **Parity:** `check:schema-parity` compared 85 tables, 0 failing (7 differences, all allowlisted).
- **Seed:** `db:seed` exited 0 (39 flags, 6 group types, 3 roles).
- **Cleanup:** the database was dropped (`with (force)`), and none remains.

## End-to-End Tests (scratch copy outside `~/git/presby-platform`, own dev server on :3330, pipeline branch)

Total: 27 | Passed: 27 | Failed: 0 | Skipped: 0 | Duration: 9.4 min
- `community-approval.spec.ts`: 13/13 (items 1–6 at desktop and 360px, plus the sticky-bar check at 360px).
- `community-participants.spec.ts`: 9/9, including the 360px lifecycle test that timed out in the discarded run.
- `community-redirect.spec.ts`: 3/3.
- `hydration/community-approval-controls.spec.ts`: 1/1.
- `hydration/community-participant-dialogs.spec.ts`: 1/1.

## Regression Tests Added (implementer-written; verified present and green)

- `session-approval.db.test.ts`:
  - `:593` (freeze on the owner path), `:627` (R7), `:705` and `:725` (identity refusals), `:876`, `:890` and `:899` (R6 both directions, plus the opening-balance control);
  - `:1039` and `:1275` (pastor seated and inheriting the Session role), `:1297` and `:1331` (S1), `:1156` (backfill), `:1368`–`:1408` (vocabulary pins).
- `roll-decide-lockdown.db.test.ts`: `:216`, `:294`, `:307` and `:325` (the 0063 privileges and policy, behavioural half included).
- `src/lib/decide-boundaries.test.ts`: source scans (only `roll.ts` names the definers; no `update(rollActions)`; the right key is pre-checked).
- `e2e/community-approval.spec.ts` and `e2e/hydration/community-approval-controls.spec.ts`.
- **Failing-first:** I can't independently confirm that every test failed before its fix; Batches A and B list their proofs. I re-ran two negative controls in my scratch copy (never the worktree, which stays clean):
  - pre-checking `roll.approve` instead of `roll.propose` made `decide-boundaries.test.ts` "each decision pre-checks the right key" fail. My substitution also hit the two other `roll.propose` pre-checks in `roll.ts`, not only withdraw. The original passed 21/21 after restore.
  - suppressing the read-mode banner made `pending/page.test.tsx` "read mode … the banner show" fail. The original passed 12/12 after restore.

## Coverage on Critical Modules

Not re-measured. The diff doesn't touch `permissions.ts`, `two-factor.ts` or `flags.ts`.

## Feature-Gate Audit

Verified by reading the action bodies. The diff adds or changes no `route.ts` and doesn't touch `src/proxy.ts`. These are tenant actions, so the gate is a tenant permission through `presby_has_permission`, not `FEATURES.*`.

| Action | `auth()` present? | Permission gate | Key |
|---|---|---|---|
| `approveRollActionAction` (`community/pending/actions.ts`) | yes (in the body), `resolveOrgContext` re-run | lib pre-check, then the definer re-checks by the session's `users.id` | `roll.approve` (n/a for FEATURES) |
| `approveRollActionsAction` | yes | the same, per row; capped at 50 | `roll.approve` |
| `denyRollActionAction` | yes | the same | `roll.approve` |
| `withdrawRollActionAction` | yes | lib pre-check plus definer | `roll.propose` |
| `startOfficerTermAction` / `endOfficerTermAction` (`officers/actions.ts`) | yes | `hasOfficersManage` in the lib | `officers.manage` |
| `createPersonAction` / `recordRollActionAction` | yes | unchanged; adds only the `proposal_refused` mapping | `roll.propose` |
| `staff/actions.ts` | n/a | exhaustiveness change only | — |

- **In-transaction audit:** approve, deny, withdraw and officer start and end use `insertAuditRow(tx, …)` inside the same `withOrgContext` transaction. `roll.ts` no longer imports `recordAudit`, and `officers/actions.ts` calls none for start or end.
- **Stamps:**
  - `selfApproved` and `selfTarget` on approve (`roll.ts:360-371`);
  - `selfProposed` on withdraw (`:570`);
  - `selfRecorded` on start and end (`officers.ts:700-707`, `:804-811`). The end metadata is read from the term row, not client input.
- **No names in the metadata:** ids, kind, dates and booleans only. The free-text `reason`, `minuteReference` and `endReason` are free text by design (Phase 3).
- **Read mode:** a propose-only holder gets `mode: "read"` (`roll.ts:802`). The page hides checkboxes, Approve and Deny (`pending-row.tsx:49`, `:115`; `pending-worklist.tsx:88`, `:123`) and shows the subtitle and banner. E2E test 5/11 confirms it at both widths.
- **Observation (existing pattern, not a regression):** the actions don't re-check the `org_portal.members_create` flag or toggle; only the pages do. That matches Increment 1's Community actions.

## Copy truthfulness — FAIL (2 findings)

1. **The Flow 7 `no_sign_in` banner can state something false.**
   - `src/lib/session-approval-state.ts:45` returns `no_sign_in` whenever `recorded === 0`, that is, whenever every seat starts later.
   - `withAccount` counts only live seats (`src/lib/roll.ts:1059-1061`).
   - The banner (`community/pending/session-state-banner.tsx:79-98`) then says "{n} member(s) of the Session {is/are} recorded, but none has a PresbyPortal account yet", plus the support-ticket line.
   - If those future-dated seat holders do have accounts, the sentence is false and sends the clerk to file a support ticket for nothing. The real reason is "the first term begins {date}". This is realistic: elders elected in the autumn with terms from January, or a founding administrator recording themselves with a future start.
   - The wording is Phase 3's verbatim copy, so this goes to **tech-lead** for a copy ruling. A suggested shape: when `recorded === 0`, a "terms haven't started yet" variant that drops the claim about accounts.
   - Missing test: no test covers future seats held by people who have accounts.
2. **Increment 1's `pending_action` copy is now misleading.**
   - `community/participant-copy.ts:37-38` still says "This person has a roll action waiting for the Session. **Wait for the Session to decide it**, then try again."
   - Increment 2 makes withdrawal the fix for F183, and at a congregation where nobody can approve, waiting never resolves. The new `PROPOSAL_COPY.pending_exists` already points at Withdraw, so the two disagree.
   - Phase 3's Copy section didn't revisit this string. Ruling: tech-lead; fix: implementer.

Nothing else claims approval works when no Session can act:
- the review step switches to "No one on your Session can approve yet" (`new/review-step.tsx:120`);
- the edit page shows "No one can approve yet. See why…";
- the `empty`, `no_permission` and `no_session` banners are accurate;
- "Member" is hidden where no Session exists, and the server refuses it regardless.

## Hand-offs and notes (not FAIL reasons)

- **The branch no longer merges cleanly with `main`.** `git merge-tree` reports a conflict in `e2e/support/community-fixture.ts`, against PR #43 (`e4190b4`, `createStaffAnchorViaSql`).
  - That helper and this branch's `createProposalViaSql` both mint ids as `SQL_PERSON_PREFIX + (200 + n)`, and both use `on conflict do nothing` / `where not exists`. Overlapping `n` values would silently reuse a staff-anchor person as a proposal subject.
  - Whoever resolves the conflict should give them separate ranges and re-run `community-participants` and `community-approval`. CI can't run on the PR until the conflict is resolved.
- **The 2 open-window leaked fixture rows** (see DB-backed Tests) must be swept before 01:39 UTC on 2026-10-24.
- **Credentials appeared in my tool output.** While setting up the fresh install, a verification `echo` printed the pipeline branch's dev-only connection strings into this agent transcript. Nothing was written to the repo, a log, or this section. If the transcript is shared, rotate the `pipeline-session-approval` role passwords.
- **Disk:** the volume is at 100% (about 6.6 GiB free). One DB suite hit `ENOSPC`. My scratch copy has been removed.

## Verdict

**FAIL.** Every required test check is green or has a reproduced environmental cause, as detailed above. The required copy-truthfulness check fails on findings 1 and 2. Since finding 1 is Phase 3's own copy, it goes to tech-lead for a ruling first, then to the implementer.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 5 — Verification | qa | Complete. Typecheck, lint, check and unit green. `test:db` 9964/10023 in run 1; the 13 failures were timeouts that passed on re-run, apart from the fixture-leak canary (branch state, 23 rows predating this phase). Sections 61/62 at 34/53 passes. Patch applies. All live probes refuse at the expected layer. Fresh install 0000–0063 plus seed clean. E2E 27/27 on :3330 (the port-3000 run was discarded). Gate audit clean. Copy: 2 defects | **FAIL** (copy truthfulness: `session-state-banner.tsx:79-98` with `session-approval-state.ts:45`; `participant-copy.ts:37-38`) | 2026-10-23 |

## Handoff

Next agent: **tech-lead (Phase 3 copy ruling)** on finding 1, and on whether `pending_action` should point at Withdraw. Then **ux-developer (Phase 4, Batch C)** to change both strings and add a test covering future-dated seat holders who have accounts. After that, a short Phase 5 re-check: unit tests, the banner test, `community-approval` e2e.

The orchestrator should also:
- sweep the two open-window fixture rows before 01:39 UTC;
- resolve the `community-fixture.ts` conflict with `main` and separate the id ranges;
- decide whether the credential exposure in this transcript warrants rotation.

## Increment 2 — Phase 3 amendment: copy ruling after QA run 1 (tech-lead)

Rules on the two "Copy truthfulness" findings in Run 1 (FAIL). Both are copy and state-model defects; no schema, SQL, permission, flag, route or audit change. Implementer: **ux-developer** (Batch C), with a one-line derivation change in `src/lib/session-approval-state.ts` (pure, no SQL change: `roll.ts` already returns `startingLater` and `nextStart`). Then QA's short re-check.

### Finding 1: the `no_sign_in` banner claimed something it did not know

**Root cause.** `deriveSessionApprovalKind()` returned `no_sign_in` for `recorded === 0 || withAccount === 0`. `withAccount` counts live seats only, so a roster whose every seat starts later reached `no_sign_in` with `withAccount = 0` by construction, not by fact. The banner then said "none has a PresbyPortal account yet" about people whose accounts the query never looked at.

**Ruling: a sixth state, `terms_not_started`, that carries the earliest start date and makes no claim about accounts. `no_sign_in` is shown only when it is true.** Not a flag on `no_sign_in`: the two states have different causes, different next steps and (in 2b) different hand-offs, and a state that says nothing it cannot know is simpler to keep honest than a branch inside one that does.

State model (Phase 3's five states become six; DECISION-205's list is amended, not reversed):

| Condition (checked in this order) | Kind |
|---|---|
| no `session` group | `no_session` |
| `recorded = 0` and `startingLater = 0` | `empty` |
| `recorded = 0` (so `startingLater > 0`) | **`terms_not_started`** (new) |
| `withAccount = 0` (so `recorded > 0`) | `no_sign_in` |
| `canApprove = 0` | `no_permission` |
| else | `ready` |

Consequences, so the implementer does not have to infer them:
- **`no_sign_in` now means exactly: at least one seat is in effect today and none of the people in effect today has an account.** Its `recorded` count is the count of seats in effect, which is the thing the sentence is about. The `startingLater` addition to the count and the "The first term begins" clause leave this branch (they are dead there once `recorded > 0`).
- `terms_not_started` is the only state that shows a date. It takes the earliest start from `nextStart` (the SQL already returns `min(starts_on)` over seats not yet in effect; with `recorded = 0` that is the first term). It does not look at, and must not mention, accounts, invitations, support tickets or an invite. Accounts of future-dated holders are not computed and no new count is added.
- A mixed roster (some seats in effect with accounts, some not yet started) is unchanged: `ready` or `no_permission` by the live seats, as before. A mixed roster with live seats all without accounts is `no_sign_in`, and the sentence is true of those live seats.
- Everything that treats the Session as "can't act" must include the new kind:
  - `src/app/(org)/o/[slug]/admin/community/new/page.tsx:107`: add `"terms_not_started"` to the `sessionWaits` list (the wizard review note "This person's roll action will wait. No one on your Session can approve yet." is true in this state, and unchanged).
  - the edit page uses `kind !== "ready"` (`[id]/edit/page.tsx:195`) and its notice "No one can approve yet. See why on the Pending approvals page." is true here; no change.
  - `SessionApprovalStateKind` in `src/lib/session-approval-state.ts` and its re-export in `roll.ts` gain the member.
  - Update the doc comments that say "five states" (`session-approval-state.ts` header, `session-state-banner.tsx` header) to six.
- **Increment 2b is unaffected and must stay anchored to `no_sign_in`.** The 2b "Session hand-off" (rows, "Invite" links, "Invitations sent to {n} of the {m} members of the Session") appears only in `no_sign_in`. In `terms_not_started` there is nothing to invite for yet and no claim to correct; 2b must not add the hand-off there. If 2b's e2e (10) seeds a future-dated seat to reach the banner, it must seed an in-effect seat instead.

**Verbatim copy, `terms_not_started`** (title and the two paragraphs, in a `<p>` each, counts use "member of the Session" and "members of the Session"; the date is the existing `<FormattedDate mode="date">`; no link, no button):

- Title: `No one can approve yet`
- Paragraph 1, more than one person, date known:
  `{n} members of the Session are recorded, but their terms haven't begun. The first term begins {date}, and no member of the Session can approve before then.`
- Paragraph 1, exactly one person, date known:
  `1 member of the Session is recorded, but their term hasn't begun. The term begins {date}, and no member of the Session can approve before then.`
- Paragraph 1, date null (defensive; the SQL cannot produce it with `startingLater > 0`), plural:
  `{n} members of the Session are recorded, but their terms haven't begun, so no member of the Session can approve yet.`
- Paragraph 1, date null, singular:
  `1 member of the Session is recorded, but their term hasn't begun, so no member of the Session can approve yet.`
- Paragraph 2 (all variants):
  `To approve, a member of the Session also needs a PresbyPortal account.`

**Why this wording passes the read-against-residuals check.**
- It states only what the query knows: seats are recorded, none is in effect, the earliest start date. It denies no residual: it does not say the people have no account (they may), does not say they have one, and does not promise that they will be able to approve on the date (an account, or the Session role, may still be missing; paragraph 2 says so in general terms, as a fact about approving, not a promise or a to-do for anyone).
- "No member of the Session can approve" rather than "no one": the banner counts Session seats only, and a custom role could in principle carry `roll.approve`. The existing `no_sign_in` and `no_permission` sentences keep their wording (not in the findings, same family of claim, left unchanged to avoid churn; the implementer must not edit them).
- It promises nothing the product cannot keep: no "an administrator will...", no "we will...", no invitation, no support ticket. A support ticket here would be the exact false direction the finding named.
- Read mode: this banner renders only to a viewer who cannot approve (`mode: "read"`), so the copy offers the viewer no action at all. Decide mode shows no banner except `no_session`, which is unchanged. The no-Session case never reaches this state (checked first).
- Dates: the term start is an effective date, rendered by `FormattedDate` like every other date; the sentence is true on the day shown and the state clears itself at the next read after the start date (a seat is "in effect" when `starts_on <= current_date`).

**`no_sign_in` copy is unchanged and is now only true-by-construction.** The strings stay exactly as shipped:
`{n} members of the Session are recorded, but none has a PresbyPortal account yet, so no one can approve.` / `1 member of the Session is recorded, but none has a PresbyPortal account yet, so no one can approve.` followed by the `NO_SIGN_IN_INVITE_LINE` constant (2b's swap point). Removed from the branch: the `startingLater` term in the count and the `The first term begins {date}.` clause. `no_sign_in` renders no date.

### Finding 2: `pending_action` and withdrawal

**Root cause.** The Increment 1 string told the viewer the only way forward was to wait. After Increment 2 there are two ways out (the Session decides it, or someone withdraws it), and at a congregation where nobody can approve, waiting never resolves. The new `PROPOSAL_COPY.pending_exists` already says "Withdraw it first".

**Ruling: replace the string. It names both exits, says where withdrawal happens and who can do it, and does not promise the viewer can.** The refusal is shown to anyone who can record participant actions, who may or may not hold `roll.propose`, so "Withdraw it" as an instruction would promise an action some viewers cannot take. The Pending approvals page is readable by `roll.approve` or `roll.propose` holders, and withdrawal is gated on `roll.propose` (`withdrawRollAction()`), so the sentence names that standing. The string is also true when nobody can approve (it does not say the Session will decide) and for both enrolment and removal (it says "this", not "this enrolment").

`PARTICIPANT_COPY.pending_action`, verbatim:

`This person has a roll action waiting for the Session, so this can't be recorded yet. Try again once the Session has decided it or it has been withdrawn. Withdrawing is done from Pending approvals, by someone who can propose roll actions.`

It contains no underscore, `presby_`, `roll_actions` or SQLSTATE text (the copy test's tripwire). `PROPOSAL_COPY.pending_exists` is unchanged: its "Withdraw it first if it was a mistake" is addressed to a person who is proposing, who holds `roll.propose` by definition, so it promises nothing the viewer cannot do.

**Release-note line to carry forward (for `/release-notes`, tech-lead):** Increment 1's required limit ("a person with a waiting entry can't be removed as a participant") is retired by Increment 2's withdrawal; the Increment 2 note should say a waiting entry can now be withdrawn from Pending approvals by someone who can propose roll actions, and must not say the Session will always be able to decide it.

### Tests the implementer must add or change (Batch C)

1. `src/lib/session-approval-state.test.ts`:
   - replace the case at `:32-33`: `counts({ recorded: 0, startingLater: 2 })` is **`terms_not_started`**, not `no_sign_in`;
   - **future-dated seat holders who have accounts must not reach `no_sign_in`**: `counts({ recorded: 0, startingLater: 1, withAccount: 0 })` and `counts({ recorded: 0, startingLater: 1, withAccount: 1, canApprove: 1 })` both give `terms_not_started` (the second is the case the account-holder shape produces if the SQL ever counted future seats; the derivation must not depend on it);
   - `counts({ recorded: 4, withAccount: 0 })` is `no_sign_in`; `counts({ recorded: 1, startingLater: 1, withAccount: 1, canApprove: 1 })` stays `ready` (existing `:55`);
   - order: `no_session` beats `terms_not_started`; `empty` is only `recorded = 0 and startingLater = 0`.
2. `src/lib/roll.test.ts:1774` (the walk): the step at `:1792-1800` becomes `terms_not_started` with `nextStart`; add a step where the future-dated holder has `user_id` set (an account) and the kind is still `terms_not_started`; the step at `:1804-1814` (a seat in effect, no account) stays `no_sign_in`. Counts only, no names, as before.
3. `src/app/(org)/o/[slug]/admin/community/pending/session-state-banner.test.tsx`:
   - `terms_not_started`: the four paragraph-1 variants and paragraph 2 asserted verbatim (plural with date, singular with date, plural and singular with `nextStart: null`), the whole text for one of them;
   - for `terms_not_started`: `not.toContain("none has a PresbyPortal account")`, `not.toContain(NO_SIGN_IN_INVITE_LINE)`, `not.toMatch(/support ticket/i)`, no link, no button;
   - `no_sign_in`: remove the `recorded: 0, startingLater: 2` assertions at `:86-92`; assert `no_sign_in` with `startingLater: 2, nextStart: "2027-01-10"` still renders no "first term begins" and counts only `recorded`.
4. `src/app/(org)/o/[slug]/admin/community/participant-copy.test.ts:49`: assert the exact new `pending_action` string, `toMatch(/withdrawn/)`, and `not.toMatch(/Wait for the Session/)` so the Increment 1 wording cannot return.
5. `src/app/(org)/o/[slug]/admin/community/new/page.test.tsx` (or `connection-step.test.tsx`, wherever `sessionWaits` is asserted): a `terms_not_started` state sets `sessionWaits` true (the review note shows "This person's roll action will wait. No one on your Session can approve yet.").
6. Edit page test (`[id]/edit/page.test.tsx:750` area): a `terms_not_started` state shows the "No one can approve yet" notice (it is `kind !== "ready"`; one case pins that no kind is skipped).

**E2E blast radius.** None of the existing specs asserts a changed string: `e2e/community-approval.spec.ts:260` matches `/no one can approve yet/i`, which every non-ready banner title and the edit notice still contain, and `:312-314` asserts the `empty` banner, unchanged. No e2e spec asserts `Wait for the Session`. No new e2e is required; the 360px pass (Batch D) should look at the longest new variant (plural with a date) once.

### Out of scope (non-goals)

Computing the accounts of future-dated holders; an "invite early" action in `terms_not_started`; changing the `no_permission`, `empty` or live `no_sign_in` strings; reconciling "no one can approve" against roles other than the Session role (the banner counts Session seats only, as DECISION-205 states); any SQL change.

### Handoff

Next: **ux-developer** (Batch C) for the two strings, the sixth state and the tests above, then QA's short re-check (unit tests, banner test, `community-approval` e2e), per Run 1's hand-off. The orchestrator records the DECISION-205 amendment (six states) and the Per-Phase Status row.

## Increment 2 — Batch C copy fix pass (ux-developer)

Implements the Phase 3 copy ruling after QA run 1. Copy, state-model and test changes only; no SQL, permission, flag, route or audit change.

**Merge with `origin/main`** (merge commit 60f5343). One conflict, `e2e/support/community-fixture.ts`, against PR #43's `createStaffAnchorViaSql`. Both helpers are kept, with disjoint fixture person-id ranges (`SQL_PERSON_PREFIX + n`), documented in a comment above them:

| Range | Helper |
|---|---|
| `100 + n` | `createParticipantViaSql` (unchanged) |
| `200 + n` | `createStaffAnchorViaSql` (main's, unchanged) |
| `300 + n` | `createProposalViaSql` (moved from 200; callers pass n under 100) |

**Changed**
- `src/lib/session-approval-state.ts`: sixth kind `terms_not_started` (checked after `empty`, before `no_sign_in`); header and doc comment say six.
- `.../community/pending/session-state-banner.tsx`: the four `terms_not_started` variants and paragraph 2 verbatim, no link or button; `no_sign_in` trimmed to count `recorded` only with no date clause.
- `.../community/new/page.tsx`: `sessionWaits` includes `terms_not_started`. No other exhaustive switch needed a change (the edit page uses `kind !== "ready"`).
- `.../community/participant-copy.ts`: `pending_action` verbatim.
- Tests (all six from the ruling): `session-approval-state.test.ts`, `roll.test.ts` walk (future-dated holder without and with an account, both `terms_not_started`; the in-effect no-account seat stays `no_sign_in`), `session-state-banner.test.tsx`, `participant-copy.test.ts`, `new/page.test.tsx` (`sessionWaits` per kind), `[id]/edit/page.test.tsx` (`terms_not_started` notice).
- `e2e/community-participants.spec.ts:270`: the staff-anchor spec (PR #43) asserted a heading named "Community" exactly, which since PR #44's footer site map matches two headings (strict-mode violation, desktop and 360px). Added `level: 1`. This is a main-side interaction between two merged PRs, fixed here because it blocked the run.

**Results**
- `npm run typecheck`, `npm run lint` (max-warnings 0): clean. `npm run check`: all eight pass.
- `npm test`: 511 files passed, 74 skipped; 7778 passed, 2286 skipped (DB-gated), 0 failed.
- `src/lib/roll.test.ts` (DB-backed, `--no-file-parallelism`): 95/95 with `--testTimeout/--hookTimeout=180000`. At the default timeouts two untouched `voidParticipantAction` tests failed with dropped Neon connections (the latency QA recorded); rerunning with long timeouts passed all.
- E2E from a scratch copy in `/private/tmp`, own server on :3350: `community-approval` 13/13 (desktop and 360px), `community-participants` 10/10, `community-redirect` 3/3, `hydration/community-approval-controls` 1/1, `hydration/community-participant-dialogs` 1/1. Two intermediate runs lost individual tests to `NeonDbError: fetch failed` from the Playwright process; those tests passed on rerun. Not run: `test:e2e:prod` lane.
- Not examined: the plural-with-date `terms_not_started` banner at 360px by eye (no e2e seeds that state); Batch D should look at it once.

---

# Increment 2 — Phase 5: Verification (qa), run 2

## Run 2: FAIL

**Date:** 2026-10-23
**Verified by:** qa
**Worktree / branch:** `/Users/cshenso/git/presby-platform/presby-fadir`, `pipeline/session-approval` at 0e88167 (confirmed). Neon branch `pipeline-session-approval` only. No connection string or env value was printed in this run.

**Verdict: FAIL, for one copy defect.** Both Run 1 findings are fixed exactly as tech-lead ruled. Every test is green once the Neon drops are re-run. The fixture merge is sound. The fail comes from the re-scan you asked for: the bulk-approve result panel tells an approver to "withdraw" a roll action, and the default approver role can't withdraw.

### Scope run

- **Ran in full:** typecheck, lint, `npm run check` (all eight), the unit suite.
- **Ran, targeted:**
  - `npm run test:db` on `src/lib/roll.test.ts` and `src/lib/session-approval-state.test.ts`. The fix touched no other DB test.
  - e2e on my own server (:3360) from a scratch copy in `/private/tmp`: `community-approval`, `community-participants` (whole file), `community-redirect`, and the two `hydration/community-*` specs.
  - A throwaway `terms_not_started` spec, in the scratch copy only.
  - A negative control of the fix, also in the scratch copy.
- **The `e2e/support/` scope trigger:** the diff touches `e2e/support/community-fixture.ts`, which normally calls for the full chromium suite. Only the four community and hydration specs import that file, and all four ran. The PR's CI covers the rest.
- **Not re-run (Run 1 stands):** the whole DB-backed set, `test-rls-61/62` and the integration patch, live-catalog probes, fresh install, and the `test:e2e:prod` lane. The fix commit touches no SQL, action, route, migration or `src/lib/db/` file.

### Type Check

- `npm run typecheck`: **PASS**
- `npm run lint` (`--max-warnings=0`): PASS
- `npm run check`: all eight tripwires pass (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports).

### Unit Tests

Total: 10064 | Passed: 7778 | Failed: 0 | Skipped: 2286 (the DB-gated tests, which skip without `.env.local`) | Files: 511 passed, 74 skipped | Duration: 26s

**DB-backed (`npm run test:db`, serial, 180s timeouts):** `roll.test.ts` and `session-approval-state.test.ts` passed 104/104 on the first try in 278s. No connection dropped, so nothing needed a re-run.

### End-to-End Tests

Scratch copy in `/private/tmp`, own dev server on :3360, `--project=chromium`.

**Run A (all five specs):** 17 passed, 3 failed, 9 did not run.
- All three failures were Neon `fetch failed`:
  - `community-participants.spec.ts:171`: "removal undone" never appeared, then the `afterAll` sweep at `community-fixture.ts:302` failed with `NeonDbError: fetch failed`.
  - `community-participants.spec.ts:185`: the `beforeAll` sweep at `:81` hit the same error, so the rest of the file did not run.
  - `community-redirect.spec.ts:42`: Auth.js `JWTSessionError` (a failed `users` query) sent the browser to `/signin`.
- `community-approval` 13/13 and both hydration specs (1/1 each) passed.

**Run B (the two failing files, re-run once):** 14/14 in 4.0 min. `community-participants` passed 11/11 at desktop and 360px, including the staff-anchor test at `:256` with the `level: 1` change. `community-redirect` passed 3/3.

**Combined:** 30/30 green, which is 28 distinct tests plus the throwaway below.
- `community-approval` 13/13 and `community-participants` 11/11, each at both widths.
- `community-redirect` 3/3. It only checks HTTP redirects, so a 360px pass would prove nothing extra.
- Hydration 1/1 + 1/1.

**Throwaway `terms_not_started` check** (scratch only, now deleted):
- **Setup:** two fixture elders (first name `E2ECommunity`, `deletable_until` = now + 2h) with future `ruling_elder` terms starting 2027-01-10 and 2027-03-01, one SQL proposal, and the clerk in read mode.
- **Rendered text at 360px:**
  - "No one can approve yet"
  - "2 members of the Session are recorded, but their terms haven't begun. The first term begins 1/10/2027, and no member of the Session can approve before then."
  - "To approve, a member of the Session also needs a PresbyPortal account."
- **Checks:** no link, no button, no "support ticket", no "none has an account". Page overflow was 0, no child element overflowed, and the banner box ended at x = 336 of 360.
- **Also checked at 320px and desktop:** same result. The date shows as the ISO `2027-01-10` before hydration and as `1/10/2027` after. That is `FormattedDate`'s designed server-then-client swap.
- **Screenshots:** they read correctly and the banner wraps cleanly.
  - `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/shots/tns-banner-360.png`
  - `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/shots/tns-page-360.png`
  - `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/shots/tns-banner-320.png`
- **Dev overlay "1 Issue":** I captured the console. It is React's server-side "empty buffer / ArrayBuffer.prototype.detached" warning, which appears because this machine runs Node v20.20.2 and `.nvmrc` pins 22. It is not a hydration error and not part of this change.

### Regression Tests Added

All six ruled tests exist and pass. I verified them by reading and running them.

1. `src/lib/session-approval-state.test.ts` — guards against future-dated seats reaching `no_sign_in`, and pins the state order.
   - `:32`: all seats start later gives `terms_not_started`.
   - `:38`: future holders give `terms_not_started` with and without accounts, including `withAccount: 1, canApprove: 1`.
   - `:49`: `no_session` beats `terms_not_started`; `empty` only when both counts are 0.
   - `:57` and `:74` (existing): `recorded: 4, withAccount: 0` gives `no_sign_in`; the mixed roster stays `ready`.
2. `src/lib/roll.test.ts:1774` (DB walk) — guards against the derivation depending on whether future holders have accounts.
   - A future seat without an account gives `terms_not_started`.
   - A second future holder *with* `user_id` still gives `terms_not_started`, with `startingLater: 2` and `nextStart` the earliest date.
   - A seat in effect with no account stays `no_sign_in`.
   - The old version of this test asserted `no_sign_in` for an account-holding future seat; it encoded the bug.
3. `pending/session-state-banner.test.tsx` — guards against `terms_not_started` drifting from the ruled copy or claiming anything about accounts, and against the date clause returning to `no_sign_in`.
   - `:97`, `:112`, `:125`: the four paragraph-1 variants and paragraph 2, verbatim (whole text at `:97`).
   - `:149`: no account claim, no invite line, no support ticket, no link, no button.
   - `:67`: `no_sign_in` with `startingLater: 2` renders no date clause and counts `recorded` only.
4. `community/participant-copy.test.ts:48` — guards against the Increment 1 "wait" wording returning. It asserts the exact new `pending_action` string, matches `/withdrawn/`, and asserts the string does not contain `Wait for the Session`.
5. `community/new/page.test.tsx:206` — guards against a can't-act kind being left out of `sessionWaits`. It checks every kind, `terms_not_started` included.
6. `community/[id]/edit/page.test.tsx:756` — guards against any non-ready kind skipping the can't-approve notice on the edit page.

**Failing-first, my own negative control in the scratch copy:**
- I put the 60f5343 (pre-fix) versions of the four changed source files back and kept the new tests: `session-approval-state.ts`, `session-state-banner.tsx`, `new/page.tsx` and `participant-copy.ts`.
- **8 tests failed**: `:32`, `:38`, `participant-copy :48`, `new/page :206`, and banner `:97`, `:112`, `:125`, `:149`.
- After restoring (byte-identical to the worktree, checked with `cmp`), all passed.
- `edit/page :756`, the order test `:49` and banner `:67` also pass on the pre-fix code. That is expected: they pin behaviour the fix didn't need to change.
- I did not negative-control the DB walk at `roll.test.ts:1774`.

**Copy truthfulness (the Run 1 findings)**

The implemented strings match the ruling verbatim:

| Variant | Implementation |
|---|---|
| Plural with date | `session-state-banner.tsx:84-94` |
| Singular with date ("The term begins") | `:84-94` |
| Plural, no date | `:96-99` |
| Singular, no date | `:96-99` |
| Paragraph 2 | `:101` |
| Trimmed `no_sign_in` (counts `recorded` only, no date clause, invite-line constant unchanged) | `:105-117` |
| New `pending_action` | `participant-copy.ts:37-38`, exact match |

- The state derivation (`session-approval-state.ts:46-51`) checks `terms_not_started` right after `empty` and before `no_sign_in`.
- `no_sign_in` is now reached only when `recorded > 0`, meaning a seat is in effect and none of those in-effect holders has an account. `withAccount` counts live seats only (`roll.ts:1066-1068`), and the derivation never looks at the accounts of future holders.
- `sessionWaits` includes the new kind (`new/page.tsx:107`). The edit page uses `kind !== "ready"`, so it needs no change.
- The banner renders only in read mode, or for `no_session` (`pending/page.tsx:157-158`).

**Re-scan: one new defect (the fail reason)**

`src/app/(org)/o/[slug]/admin/community/pending/bulk-approve-dialog.tsx:115-116`:

> These were not approved. Open each one to approve, deny or withdraw it.

- **Who sees it:** the panel exists only in decide mode, so only `roll.approve` holders see it.
- **Why they can't withdraw:** the baseline `session_member` role carries `roll.approve` only (`drizzle/0062_presby_session_approval.sql:282`). The Withdraw button renders only for `viewer.canPropose` (`pending-row.tsx:121`). The definer refuses a withdraw without `roll.propose` (`0062:753`; Run 1 probe 5).
- **Effect:** a seated elder with the default role is told to withdraw something with no Withdraw button anywhere, the same pattern the Finding 2 ruling rejected. "Open each one" is also inaccurate: queue rows have inline buttons and nothing to open.
- **Origin:** this isn't Phase 3 copy. The Phase 3 bulk result panel (work-log `:3256`) is "{m} need attention" plus each name and reason, with no instruction sentence.
- **Missing test:** no test pins this string.

**Re-scan: nothing else promises an action the viewer can't take.**
- `DECISION_COPY` lines `:39`–`:53` offer Deny, which an approver can do, or a support ticket.
- `PROPOSAL_COPY.pending_exists` is addressed to a proposer, which the ruling accepts.
- `self_target` and `empty` say "Ask an administrator".

### Coverage on Critical Modules

Not re-measured. The change doesn't touch `permissions.ts`, `two-factor.ts` or `flags.ts`.

### Feature-Gate Audit

**Unchanged from Run 1.** The fix commit 0e88167 adds or changes no `route.ts`, no `"use server"` action and no `src/proxy.ts`. Its source changes are one page's `sessionWaits` list, two copy files, the banner and the pure state derivation. Merge 60f5343 brings in only code that is already on `main` (PRs #43–#45).

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| No route or action changed since Run 1 (Run 1 table stands) | n/a | n/a | n/a |

**Merge review (`git diff c561ca1 0e88167 -- e2e/support/community-fixture.ts`)**

- **Id ranges are disjoint:**

  | Range | Helper | Line | Current callers' `n` |
  |---|---|---|---|
  | `100 + n` | `createParticipantViaSql` | `:204` | 1 |
  | `200 + n` | `createStaffAnchorViaSql` | `:244` | 1, 2 |
  | `300 + n` | `createProposalViaSql` | `:274` | 1–8, 11–18, 30–35, 90 |

  So the ids in use are 101, 201–202 and 301–390. No current caller overlaps another range.
- `sweepCommunityPeople` matches on first name, not on id range, so it covers all three ranges.
- Role ids `…0001` and `…0002` live in `app_roles`, a different table.
- **Caveat:** "n under 100" is only a comment. No runtime check stops a future caller passing `n ≥ 100`. Hand-off below.
- **`level: 1` at `community-participants.spec.ts:270` is sound.**
  - The page's own heading is `<h1>Community</h1>` (`community/page.tsx:60, :223`). The footer's column heading is an `<h2>` (`portal-footer.tsx:139`).
  - Scoping to level 1 asserts the thing the test means ("we're on the Community page") and is strictly narrower than before.
  - `main`'s CI E2E at 4cdd5ab was green, so the duplicate heading probably depends on data or flags rather than showing everywhere. Either way the scoped assertion is correct. I couldn't retrieve the CI log to confirm.
  - Pre-existing weakness, not from this pipeline: the flag-off and forbidden pages also render an h1 "Community", so the `toHaveCount(0)` that follows could pass without the list rendering. The Staff-view half of the test proves access.

### Verdict

**FAIL.** Run 1's two copy findings are fixed exactly as ruled, and all six ruled tests exist, pass, and (except the pins) fail against the pre-fix code. Typecheck, lint, check, unit, the DB files and the targeted e2e (after one Neon-drop re-run) are green. The merge is sound. The required copy-truthfulness re-scan found one string that promises an action the viewer can't take: `bulk-approve-dialog.tsx:115-116`.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 5 — Verification (run 2) | qa | Complete. Scoped re-run at 0e88167. Typecheck, lint, check 8/8 and unit 7778/0 green. DB `roll` + `session-approval-state` 104/104. E2E on :3360: 17/20 in run A (3 Neon `fetch failed`, 9 not run), then a re-run of those files 14/14; 28/28 distinct tests green. Throwaway `terms_not_started` banner verified at 360/320/desktop by screenshot, no overflow. Negative control: 8 new tests red on pre-fix code. Fixture ranges disjoint; `level: 1` sound. Run 1 copy findings fixed verbatim. Gate audit unchanged. New copy defect found | **FAIL** (copy truthfulness: `bulk-approve-dialog.tsx:115-116` tells a `roll.approve`-only viewer to withdraw) | 2026-10-23 |

### Handoff

**Next agent: ux-developer (Phase 4, Batch C)** to fix `bulk-approve-dialog.tsx:115-116` and add a test that pins the result-panel copy.
- The simplest fix that matches Phase 3 is to delete the sentence. Phase 3 specifies only the title and the list of names and reasons.
- Any replacement wording needs a tech-lead copy ruling first. If "withdraw" is kept, it must render only when `viewer.canPropose` is true, which means passing it into the dialog.
- After that, a short Phase 5 re-check: unit tests and `community-approval` e2e.

**For the orchestrator (not fail reasons):**
1. **Global flags.** `org_portal.members_create` and `org_portal.members_roll_action_edit` are both ON on the pipeline branch after my run. The seed default is OFF.
   - My pre-run baseline didn't capture flags, so I can't prove they were ON before.
   - In run A, one `afterAll` teardown died on a Neon drop before it restored the flags. The fixtures that ran afterwards restore whatever value they found when they started.
   - Every other fixture artifact is clean: no alpha toggle row, no alpha Session group, and no fixture roles, grants or permissions.
   - Please confirm the intended flag state on this branch.
2. **Residue: none.**
   - 0 `E2ECommunity` people and 0 `e2ce1000-` people.
   - 0 rows of each kind keyed to fixture persons: memberships, officer terms, group memberships, roll actions.
   - 0 people with `deletable_until` set, so the 25 leaked rows Run 1 reported are also gone.
   - `roll_actions_freeze` and `group_memberships_reject_derived` are both enabled.
   - `/private/tmp/qa-session-approval-run2` is deleted, nothing listens on :3360, and the worktree is clean at 0e88167.
3. **Follow-up for `docs/TODO.md` (tech-lead to triage, outside this fix):** `roll.ts:781` computes `proposed_on` as `(recorded_at at time zone 'UTC')::date` and renders it as a calendar date. A US-evening proposal shows tomorrow's date; I saw "Proposed 10/24/2026" at 19:02 PDT on 10/23.
4. **Hardening suggestion:** have `createProposalViaSql` and its siblings throw on `n < 0 || n >= 100`, so the disjoint ranges are enforced rather than only written in a comment.
5. **`no_permission` banner ("Check Roles, or send us a support ticket"):**
   - The Roles page needs `roles.manage`, which a read-mode proposer may lack.
   - Left as is because tech-lead's ruling explicitly kept this string and the support ticket is something the viewer can do. Worth revisiting in 2b.
6. **DECISION-205 six-state amendment** isn't in `docs/decisions.md` yet. That file is a Rule 16 integration file, so it's yours at integration.
7. **Local Node** is v20.20.2 against `.nvmrc` 22. That causes the dev overlay's React "empty buffer" warning.

### Increment 2 — Batch C bulk-panel fix

Fixes the Phase 5 run 2 FAIL (ux-developer, Phase 4).
- `bulk-approve-dialog.tsx`: deleted the "Open each one to approve, deny or withdraw it." sentence from the partial-result panel; no replacement wording. The result view now sets `aria-describedby` undefined so Radix does not warn [orchestrator correction after QA run 3: Radix 1.1.23 does not warn; the line is a no-op, kept to avoid a re-test] about a missing description.
- `pending-worklist.test.tsx`: new test pins the panel (title, per-row name and reason; no "withdraw", no "Open each one").
- `e2e/support/community-fixture.ts`: `createParticipantViaSql`, `createStaffAnchorViaSql` and `createProposalViaSql` now throw unless `n` is an integer in 0..99, enforcing the disjoint ranges.
- Next agent: qa (scoped re-check).

---

# Increment 2 — Phase 5: Verification (qa), run 3

## Run 3: PASS

**Date:** 2026-10-23
**Verified by:** qa
**Worktree / branch:** `/Users/cshenso/git/presby-platform/presby-fadir`, `pipeline/session-approval` at 3dab58c (confirmed). The worktree was clean before and after. Neon branch `pipeline-session-approval` only. No connection string or env value was printed.

**Verdict: PASS.** The run 2 defect is gone and nothing replaces it. A new test pins the panel, and that test fails when the old sentence is put back. The copy has no remaining promise an approve-only viewer can't keep. Every required check is green; one Neon connection drop passed on its single re-run.

### Scope run

- **Ran in full:** typecheck, lint, `npm run check` (all eight), the unit suite.
- **Ran, targeted:** each on my own dev server on :3380, from a scratch copy in `/private/tmp`:
  - `e2e/community-approval.spec.ts` at desktop and 360px
  - `e2e/hydration/community-approval-controls.spec.ts`
  - `e2e/community-participants.spec.ts` at desktop (the fixture-guard check)
- **Negative control** of the new test, in the scratch copy.
- **The `e2e/support/` scope trigger:** the diff touches `community-fixture.ts`. The only change there is a range assertion on `n`. All 12 call sites, in four specs, pass in-range values by reading. Literal or computed values: 1, 1–8, 11–18, `30 + i` for `i < 6`, and 90. Three of those four specs ran this round, and run 2 already ran `hydration/community-participant-dialogs.spec.ts`. The PR's CI covers the rest.
- **Not re-run (runs 1 and 2 stand):** the DB-backed suites, `test-rls-61/62`, live-catalog probes, `community-redirect`, the participants spec at 360px, and the `test:e2e:prod` lane. 3dab58c touches no SQL, action, route, migration, `src/lib/db/` or `src/proxy.ts` file.

### Diff review (`git diff 0e88167 3dab58c`)

- **Files touched:** exactly four.
  - `bulk-approve-dialog.tsx` (+4/-5)
  - `pending-worklist.test.tsx` (+26)
  - `e2e/support/community-fixture.ts` (+10)
  - the work-log
- **The sentence:** the whole `AlertDialogDescription` ("These were not approved. Open each one to approve, deny or withdraw it.") is deleted. Nothing replaces it. `AlertDialogDescription` is still imported because the confirm view uses it (`:138-141`), and lint is clean.
- **The `aria-describedby` change is correct but has no effect.** On the installed `@radix-ui/react-dialog` 1.1.23, `DialogContentImpl` sets `aria-describedby` only when a `Description` is mounted (`context.descriptionPresent`). `WarningProvider` is a no-op, so this version never warns about a missing description. I checked it in the scratch copy:

  | Dialog version | `aria-describedby` | Title labels the dialog | `console.warn` / `console.error` |
  |---|---|---|---|
  | HEAD | none | yes | none |
  | Override deleted | none | yes | none |

  So there is no dangling id and no Radix warning either way. The line is redundant, and the work-log's reason for it ("so Radix does not warn") doesn't apply to this version. It does no harm. It isn't a fail reason.
- **Fixture guard:** `assertFixtureIndex(n)` throws unless `n` is an integer in 0..99. It is called first in `createParticipantViaSql`, `createStaffAnchorViaSql` and `createProposalViaSql`. This puts the run 2 hardening suggestion into code.

### Type Check

- `npm run typecheck`: **PASS**
- `npm run lint` (`--max-warnings=0`): PASS
- `npm run check`: all eight tripwires passed:
  - Audit-coverage
  - `sql<Date>` guard
  - Dependency-drift
  - Brand-scope
  - Secrets & PII
  - Hydration-gate
  - Giving-boundaries
  - Proxy-imports

### Unit Tests

Total: 10065 | Passed: 7779 | Failed: 0 | Skipped: 2286 | Files: 511 passed, 74 skipped | Duration: 25.6s

- The 2286 skipped are the same DB-gated set as run 2, which skip by design under `npm run test`.
- Passed is 7779 against run 2's 7778. The extra one is the new test.

### End-to-End Tests

Scratch copy `/private/tmp/qa-session-approval-run3`, own dev server on :3380 (`PORT=3380`, `E2E_BASE_URL=http://localhost:3380`), `--project=chromium`.

- **Run A: `community-approval` + the hydration spec.** 13 passed, 1 failed.
  - **The failure:** `community-approval.spec.ts:318` at 360px ("the Community header shows the waiting count…"). The org page rendered its "We couldn't open this organization" error boundary. The server log shows `Error: Connection terminated unexpectedly` and `Failed query: begin`, which is a Neon connection drop.
  - Every other test passed: all 6 at desktop, 5 of 6 at 360px, the sticky-bar test at `:342`, and the hydration spec at `:66`.
- **Run B: `community-approval.spec.ts` re-run once.** 13/13 passed in 3.6 min, with no connection errors in the log.
- **Run C: `community-participants.spec.ts` at desktop** (`--grep-invert 360px`). 6/6 passed, with no guard throw and no connection errors.
  - This includes the staff-anchor regression at `:256` and the degrade test at `:305`.
- **Combined:** `community-approval` 13/13 at both widths, the hydration spec 1/1, and `community-participants` 6/6 at desktop.

### Regression Tests Added

`pending-worklist.test.tsx:264`, "the partial-result panel is the title plus each name and reason, with no instruction sentence". It exists and passes.

What it asserts:
- The title is "1 approved, 1 need attention".
- The `bulk-attention` list's text is exactly the name and reason.
- The dialog text matches neither `/withdraw/i` nor `/open each one/i`.

**Negative control, in the scratch copy only:**
1. I put back the 0e88167 dialog, which has the old sentence. The new test **failed** at `:286`, with dialog text "…These were not approved. Open each one to approve, deny or withdraw it.…". The other 24 tests passed.
2. I replaced the sentence with a neutral "These were not approved." The test **passed**. So the test catches the old sentence and any wording with "withdraw" or "open each one". It does not catch every possible replacement description, because only the list is pinned exactly, not the whole dialog. That's acceptable for this defect. A follow-up below suggests tightening it.
3. I restored the scratch files. `diff -rq` against the worktree came back clean, and then I deleted the scratch copy.

### Copy truthfulness: final re-scan of the bulk dialog

**All approved** (`failed.length === 0`). The dialog closes (`:81-83`) and only toasts appear (`decision-toasts.tsx:37-50`):
- `bulkApproved`: "N roll action(s) approved."
- Possibly `bulkShadowed`, which is informational.
- Possibly `filedPeriod`, which says "If it needs correcting, file a correcting return." This is conditional and is ruled Phase 3 copy. Filing a return is not a roll-action control.

None of these offers a withdraw or edit action.

**Some need attention.** The dialog shows the title "{a} approved, {m} need attention", one list item per failure ("{name}: {reason}") and a Close button. If `approved > 0`, the `bulkPartial` toast also appears. The per-row reasons come only from `DECISION_COPY` (`actions.ts:195-197`):
- **`forbidden`:** a statement. It offers no action.
- **`already_decided`:** "Refresh", which anyone can do.
- **`not_approvable_kind`:** "Deny it, or ask the person who proposed it to withdraw it." The approver can do both: deny, or ask someone else. This is Phase 3 copy (work-log `:3241`).
- **`person_deceased`:** "Deny this action or correct the record first." Deny is open to the approver. This is Phase 3 copy (`:3242`).
- **`person_merged`, `membership_ended`, `holds_pastoral_office`, `already_on_roll`:** each tells the approver to deny.
- **`active_elsewhere`, `provisioning_incomplete`:** a support ticket.

**Result:** nothing in either result shape promises an action a `roll.approve`-only viewer can't take.

### Coverage on Critical Modules

Not re-measured. The change doesn't touch `permissions.ts`, `two-factor.ts` or `flags.ts`.

### Feature-Gate Audit

**Unchanged from run 1.** 3dab58c adds or changes no `route.ts`, no `"use server"` action and no `src/proxy.ts`. It changes one client component, one test, one e2e fixture and the work-log.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| No route or action changed since run 1 (run 1 table stands) | n/a | n/a | n/a |

### Verdict

**PASS.** The run 2 fail reason (`bulk-approve-dialog.tsx:115-116`) is gone and nothing replaces it. The new pinning test fails when that sentence is put back. Typecheck, lint, all eight tripwires and the unit suite (7779/0) are green. The targeted e2e is green at desktop and 360px after one Neon-drop re-run, and the fixture guard breaks nothing.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 5 — Verification (run 3) | qa | Complete. Scoped re-check at 3dab58c. Diff is the dialog, its test, the fixture guard and the work-log. The sentence is gone with no replacement; the `aria-describedby` override is correct but redundant on Radix 1.1.23 (no dangling id, no warning, with or without it). Typecheck, lint, check 8/8, unit 7779/0. New test `pending-worklist.test.tsx:264` fails on the old dialog. E2E on :3380: `community-approval` 12/13 + hydration 1/1 in run A (1 Neon `Connection terminated`), re-run 13/13; `community-participants` desktop 6/6. Copy re-scan clean in both result shapes. Gate audit unchanged | **PASS** | 2026-10-23 |

### Handoff

**Next agent: analyst (Phase 6, Increment 2).**

**For the orchestrator (not fail reasons):**

1. **Redundant line (optional cleanup):** `bulk-approve-dialog.tsx:108`. The `aria-describedby: undefined` spread does nothing on `@radix-ui/react-dialog` 1.1.23, and its stated reason ("so Radix does not warn") doesn't hold. Keeping it does no harm. If kept, the work-log's reason should be corrected.
2. **Test-tightening suggestion:** `pending-worklist.test.tsx:264` could assert the dialog's whole `textContent` rather than keyword negatives. As written, a neutral replacement `AlertDialogDescription` would pass.
3. **Global flags:** `org_portal.members_create` and `org_portal.members_roll_action_edit` are both still ON on the pipeline branch. That matches what run 2 found. My fixtures restore the value they find, so this run didn't change them. Please confirm the intended state (the seed default is OFF).
4. **Residue:**
   - My run left none of its own: 0 `E2ECommunity` people and 0 `e2ce1000-` people.
   - `roll_actions_freeze` and `group_memberships_reject_derived` are both enabled.
   - The scratch copy `/private/tmp/qa-session-approval-run3` is deleted, nothing is listening on :3380, and the worktree is clean at 3dab58c.
5. **Expired fixture rows from other runs:** there are 25 people with `deletable_until` set, all expired. Their first names are DB-suite fixtures such as `Pastor-installed_pastor`, `Replayed` and `Bclerka`. They were created between 19:09 and 23:39 UTC on 10/23, before this run started (02:25 UTC 10/24), so they aren't from this run.
   - Run 2 reported 0 such rows. Run 2 ran at about 02:00 UTC 10/24, after these rows already existed, so its count was probably taken on a connection that RLS filters.
   - Worth one sweep before integration.
6. **Local Node:** still v20.20.2 against `.nvmrc` 22. Unchanged from run 2.

---

# Increment 2 — Phase 6: Shipped vs Intent (analyst)

*Returned as text. The analyst is read-only, so the orchestrator records this verbatim. I wrote nothing.*

I read the Increment 2 Phase 1, the Phase 2 rulings, the Phase 3 design and its copy ruling, the Phase 4 batches, and QA runs 1–3. I also read the shipped code at HEAD `02905aa` in `/Users/cshenso/git/presby-platform/presby-fadir`:
- `src/lib/roll.ts` (decide, deny, withdraw, bulk, queue reads, Session state)
- `src/lib/session-approval-state.ts`
- `src/lib/officers.ts` (pastor and Session path)
- `community/pending/*` and `community/page.tsx`
- `drizzle/0062` and `0063` (header, 0063 in full)

I did not run the app, a browser or the database. Where I say a flow works, I mean the code, the tests and QA's recorded evidence agree.

## VERDICT

**SHIP WITH NOTES.**

This closes Increment 2 only. The work-log entry stays open for Increment 2b and Increment 3. No Phase 1 verb is missing and nothing regressed. Every note below is a follow-up or an integration condition. One of the conditions is a manual walk of the first-congregation bootstrap, because no single test covers it end to end.

## ONE-LINE TAKE

> A congregation's Session can now approve, deny and bulk-approve what the clerk proposes, and the clerk can see the queue and withdraw a mistake. The database enforces who may decide, each outcome writes its audit row in the same transaction, and every "can't act yet" state says only what the system actually knows. Elders other than the founding administrator still cannot approve until 2b gives them a way to sign in, and the product says so.

## What's Working

- **The F183 trap is gone.** A mistaken member proposal can be withdrawn from the queue row or the person's edit page. The person is released from Increment 1's `pending_action` block, and the row stays in the record as `withdrawn`.
- **A new congregation can bootstrap.**
  - The `session_member` role (`roll.approve` only) is seeded at provisioning and backfilled by 0062.
  - The founding administrator can record themselves under Officers. The page says this is allowed and shows a "Self-recorded" marker. The approval is stamped `selfApproved`.
  - This is the operator's Q1 ruling, and it is stamped rather than blocked.
- **Each verb is gated on the right key, at both layers.**
  - The queue read needs `roll.approve` or `roll.propose`. Decide mode needs `roll.approve`. Withdraw needs `roll.propose`.
  - The library pre-checks, and the definer re-checks by the session's `users.id`.
  - QA's live probes saw `presby_app` refused at the grant, the restrictive policy, the unique index and the definer identity check. The owner path is refused only by the freeze trigger.
- **The Session state is honest, because QA run 1 forced a sixth state.**
  - `terms_not_started` (`session-approval-state.ts:46-51`) now sits before `no_sign_in`.
  - `no_sign_in` is reached only when `recorded > 0`, that is, when a seat is in effect.
  - The banner for the new state says nothing about accounts and offers no action.
- **Approval refuses what would corrupt the roll.** It refuses an ended connection, a deceased or merged person, a pastor-office holder, and a gain that would count someone twice (checked in both directions). A collision with another congregation's active roll becomes `active_elsewhere`, with copy that names no other organization. A back-dated approval warns about the filed year and never touches the filed return.
- **The audit trail is in the transaction.** Approve, deny, withdraw, and officer-term start and end all use `insertAuditRow` in the same transaction. A denied row now records who and when.
- **The copy re-scan ended clean.** Both QA copy defects were fixed. The bulk panel is now the title plus each name and reason, with no instruction sentence.

## Intent-vs-Shipped Diff

**Phase 1 verbs**

| Phase 1 verb | Shipped | Verdict |
|---|---|---|
| Clerk sees every pending proposal, read-only | Read mode for a propose-only holder. No checkboxes, Approve or Deny. Banner in every state. | matches |
| Clerk sees what happened and why | "Recently decided" shows approved, denied and withdrawn, with reasons, gated on the two roll keys. | matches |
| Clerk withdraws a mistaken proposal | Withdraw is on queue rows and the edit page, gated `roll.propose`, with a required 1–500 character reason. | matches |
| Session member opens the queue "from Community or the admin hub" | Community header link "Pending approvals" with a count, plus the edit-page notice. The hub tile was declined (Phase 3 refinement 8: the hub is permission-blind). | acceptable drift |
| Approve one or several with one minute reference | Single approve and bulk (max 50, one transaction per row, "N approved, M need attention"). | matches |
| Deny with a reason | Reason required and capped server-side. | matches |
| Founding administrator records elders and sees whether the Session can act | Officers page with the Session note, pastor offices and self-recorded marker. The "can't act yet" state is on the queue banner, which shows to a viewer who cannot approve. | matches |
| `people.manage` sees "waiting for the Session" | Unchanged from Increment 1, plus the edit-page notice. | matches |
| Provisioning seeds the role, a migration backfills | Done in 0062, and `baselineRoleSeedPlan` is type-varying. | matches |
| Operator Q2: "add invites into Community" so a real Session can approve | Split to 2b by the architect. Not delivered in this increment. | acceptable drift, owed |

**Operator rulings**

| Ruling | Shipped | Verdict |
|---|---|---|
| Q3: own `withdrawn` status | Shipped with a distinct audit key and `decided_by` / `decided_at`. | matches |
| Q6: installed pastors count | In by DECISION-206 (the Batch A note records the operator's confirmation). Seated through `officer_terms`, with no invented roll membership. The S1 trigger refuses a pastor term for a rolled person. Approval refuses `holds_pastoral_office`. | matches |

**Can't-act states (truthfulness)**

| Viewer and state | What they see | Truthful? |
|---|---|---|
| Read mode (propose-only) | No Approve, Deny or checkboxes. Subtitle: "Only members of the Session can approve." The banner says why nothing is moving. | Yes. The subtitle simplifies, because a custom role could carry `roll.approve`; a holder of such a role gets decide mode. |
| No Session (non-congregation) | "No Session to approve". The Member option is hidden in the wizard, and the server refuses with `no_session`. | Yes |
| Empty roster | A link to Officers if the viewer holds `officers.manage`, otherwise "Ask an administrator". | Yes |
| Terms not started | "{n} members of the Session are recorded, but their terms haven't begun. The first term begins {date}…", with no account claim and no action. | Yes. QA saw it render at 360, 320 and desktop. |
| No sign-in | "none has a PresbyPortal account yet", plus the support-ticket line. | Yes, true by construction. The support-ticket line is a placeholder for 2b. |
| No permission | "Members of the Session are recorded and have accounts, but none of them has permission…" | **Mostly.** In a mixed roster (QA's own fixture: 2 seated, 1 with an account) "have accounts" is overbroad. The "Check Roles" pointer can send a viewer to a page they may be forbidden from. Rare, because it needs a tenant-edited role. Follow-up 2. |
| Withdraw refused as `already_decided` | "The Session already decided this one…" | **Slightly false** when another clerk withdrew it first. Follow-up 2. |
| Terms not started, or queue empty | The queue's own empty-state copy differs by mode, and the Session-state banner is separate. | Yes |
| Community toggle off | "Member management isn't turned on for {name} yet." | Yes, but an elder gets no hint the queue exists. Named coupling (DECISION-204). |
| Approver's membership ended | Whole-page "ended" state. | Yes |
| Self-target approval | The audit row is stamped `selfTarget`. The UI shows "You proposed this" only for proposals. | Acceptable. The Phase 1 default was audit-stamped and detected. Follow-up 8. |

## Edge Cases

- Empty state: **pass.** The queue, Recently decided and the banners all differ by viewer and state.
- Failure microcopy: **pass**, with the two nits above. The typed refusals are human, and `active_elsewhere` and `provisioning_incomplete` leak nothing.
- Permission gate: **pass.** Verified at the library and definer layers, on read, decide and withdraw.
- Audit event: **pass.**
  - In-transaction and stamped (`selfApproved`, `selfTarget`, `selfProposed`, `selfRecorded`).
  - Tests prove a failed audit insert rolls the decision back.
  - Residual, `paper`: a direct SQL caller of the definers would skip the audit row. A source scan pins that only `roll.ts` names them.
- Mobile (360px): **pass** on QA's evidence. `community-approval` ran 13/13 at both widths, including the sticky-bar geometry and 44px targets, and the `terms_not_started` banner was screenshotted at 360 and 320.

**One gap I could not close by reading.** Phase 3 called the zero-approvers bootstrap "the single most important sentence". The shipped tests cover its links separately:
- provisioning creates the role and group;
- `startOfficerTerm` writes a Session seat;
- a seated person inherits `roll.approve`;
- `test-rls-62` runs the seated-elder approval.

The e2e approver, however, is a fixture role granted by the person arm, not the Session group path. Nothing walks the real chain in one pass. That chain is: a founding administrator records themselves, the page flips to decide mode, and they approve their own proposal. Ship condition 10 covers it.

## QA's non-blocking notes, classified

| Note | Class | Disposition |
|---|---|---|
| UTC `proposed_on` shows tomorrow on a US evening (`roll.ts:781`) | Follow-up, not blocker | Phase 3 edge case 18 accepted UTC, consistent with Increment 1. The same cast feeds `decidedOn` (`roll.ts:893-894`), and `todayUtcYmd()` feeds the "Takes effect" badge. In a minute-keeping context a wrong date erodes trust. It goes in the release note as a known limit and into the TODO. |
| Redundant `aria-describedby` at `bulk-approve-dialog.tsx:108`, and a wrong work-log reason | Cosmetic | Leave the code unchanged after QA's PASS. The orchestrator adds a one-line correction beside the work-log reason ("Radix 1.1.23 does not warn; the line is a no-op"). Delete the line the next time the file is touched. |
| Test-tightening at `pending-worklist.test.tsx:264` | Follow-up, low | A neutral replacement description would pass. The real control is the design-time copy review. Tighten to a whole-text assertion when the file is next touched. |
| `no_permission` banner points at Roles, which a proposer may lack | Follow-up | Same family as the bulk-panel defect, softened by the support-ticket alternative. It is rare: production has no tenant-held `session_member`, and the state needs a tenant-edited role. Fix with the 2b banner pass (follow-up 2). |
| DECISION-205 six-state amendment not in `decisions.md` | **Ship condition** | The record would otherwise say "five states", and so would the TODO line. See condition 3. |
| The 2b handoffs | Follow-up | See follow-up 4. They are binding constraints on 2b. |

## Follow-Ups (SHIP WITH NOTES), TODO-ready

1. `- [ ] **System-stamped dates use UTC (Community Increment 2).** "Proposed {date}" and a decision's date are cast to UTC (roll.ts:781, :893-894), and "Takes effect" and Session seat-in-effect use UTC today, so a US-evening proposal shows tomorrow's date. Pass timestamps and render in the viewer's zone through FormattedDate, or give organizations a time zone. Stated as a known limit in the 0.41.0 note. — docs/work-log/2026-10-22-founding-admin-directory.md Increment 2 Phase 6`
2. `- [ ] **Session-state and withdraw copy pass (do with 2b).** (a) no_permission: "have accounts" is false for a mixed roster (some live seats without accounts), and "Check Roles" can point a viewer at a page they cannot open; suggest "Ask an administrator to check the Session member role, or send us a support ticket", counting accounts truthfully. (b) WITHDRAW_COPY.already_decided says "The Session already decided" when another clerk withdrew it first; suggest "This one was already decided or withdrawn." — Increment 2 Phase 6`
3. `- [ ] **Tidy after QA run 3.** Delete the redundant aria-describedby spread at bulk-approve-dialog.tsx:108 on the next touch of that file; tighten pending-worklist.test.tsx:264 to assert the dialog's whole text. — Increment 2 Phase 5 run 3`
4. `- [ ] **2b binding constraints from Increment 2.** (a) Replace only NO_SIGN_IN_INVITE_LINE in session-state-banner.tsx. (b) The Session hand-off appears only in no_sign_in, never in terms_not_started; 2b's e2e must seed a seat in effect. (c) Add the admin-only "Can't sign in yet" marker (R26) to the Session roster rows next to "Self-recorded". (d) Fold in the auto-connect line (TODO:137) and the /no-organization wording. (e) Check that the remedy shown to a read-mode viewer (a link to the invite card) is one the viewer can use; the invite needs people.manage. — Increment 2 Phase 6`
5. `- [ ] **Pastor and Session follow-ups (DECISION-206, S3, S5).** (a) A pastor already on the platform through the presbytery cannot be linked to a congregation (presby_claim_person() does not exist), so the congregation sees "belongs to another organization". (b) A "Clergy" anchor connection in the wizard (S3) instead of the staff-anchor path. (c) Reconcile a congregation's pastor term against a published presbytery appointment once DECISION-112's publication exists (S5). (d) Participant enrolment of a pastor-office holder is not refused (Phase 3 refinement 7). — Increment 2 Phase 6`
6. `- [ ] **Queue entry point for Session members.** An elder with only roll.approve reaches the queue through Admin hub, Community, Pending approvals (the hub shows no permission-based tile, Phase 3 refinement 8). Watch the first real elders; revisit with the next hub revision or add a permission-aware tile. — Increment 2 Phase 6`
7. `- [ ] **Detect the self-recorded Session chain.** DECISION-205's residual (a founding administrator records themselves on the Session, then approves) is "detected by audit", but nothing reads it. Add an audit filter or saved query for officer_term.started with selfRecorded:true on a Session office followed by roll_action.approved with selfApproved:true, and the DECISION-194 revoke-then-self-designate chain. — Increment 2 Phase 6`
8. `- [ ] **Self-target cue.** An approver approving their own membership (selfTarget) gets no on-screen cue, only the audit stamp. Consider a "This is you" badge in decide mode. — Increment 2 Phase 6`
9. `- [ ] **Notify proposers and approvers.** A proposer learns of a denial only by opening Pending approvals, and a Session learns of waiting proposals only by looking. Out of Phase 1 scope; a digest or email is the follow-up. — Increment 2 Phase 6`
10. `- [ ] **F190 fixture drift.** The dev stated_clerk holds both roll keys and the dev session_member also holds directory.view; neither is a template. Recorded, not fixed. — Increment 2 Phase 3`
11. `- [ ] **End-to-end bootstrap test.** Add one e2e that walks a new congregation: the founding administrator records themselves as a ruling elder under Officers, Pending approvals flips to decide mode, they approve their own proposal, and the audit row carries selfRecorded and selfApproved. Natural home: 2b's e2e 10. — Increment 2 Phase 6`

**Red Flags:** none.

## Release-note lines (non-engineer; suggested version 0.41.0)

**Feature: your Session can approve new members, and a mistaken entry can be withdrawn**

**Value:** The last release let you propose a member, but nobody could approve one. Now your Session can, a clerk can see what is waiting and what happened to it, and a mistaken entry can be withdrawn instead of getting stuck.

- **Who can approve.** Every congregation now has a "Session member" role. It goes to the people your congregation records on its Session under Officers: ruling elders, installed pastors, co-pastors and associate pastors. Existing congregations get the role, plus empty Session and Board of Deacons lists if they had none. Nobody gains anything until your congregation records its own people.
- **Session members need a PresbyPortal account to approve.** Recording someone under Officers does not create one. Inviting elders to sign in is coming in a following release. Until then, the Pending approvals page says plainly when no one can approve yet and why.
- **Starting out with one administrator.** A congregation's first administrator can record themselves as a ruling elder or pastor and then approve member entries. We allow this on purpose, because a brand-new congregation would otherwise be stuck. It is recorded, not blocked: the officer record reads "self-recorded" and the approval reads "self-approved", so your Session can look back and confirm it. Approving a member does not ask for two-step sign-in unless your organization has turned that on.
- **Pending approvals.** Open it from Community. People who can propose roll actions see everything waiting, read-only, and what became of each entry afterward: approved, denied with the reason, or withdrawn. Session members can approve, deny with a reason, or approve up to 50 at once with one minute reference.
- **Approving several at once is not all-or-nothing.** Each is approved and recorded separately. If one can't be approved, the others still are, and the list says which and why.
- **Withdraw a mistaken entry.** Someone who can propose roll actions can withdraw a waiting entry, with a reason, from Pending approvals or the person's page. It stays in the record, marked withdrawn, and is never deleted. This replaces the 0.39.0 limit: a waiting entry no longer blocks enrolling or removing that person once it is decided or withdrawn. If no one on your Session can approve yet, a waiting entry still waits, and withdrawing is the way out.
- **What approval will refuse.**
  - A person whose connection has ended, or who is recorded as deceased or merged.
  - A pastor of the congregation, because a pastor's membership is held by the presbytery.
  - Someone already on that roll as of the date, because they would be counted twice.
  - A second waiting entry for the same person.
  - A person who is active at another congregation. This shows only as "can't be approved right now, send us a ticket", and never names that congregation.
  - Denying is always possible.
- **Filed years are never changed.** If an approval is dated in a year you have already filed, you are warned and the filed return stays as it was.
- **The Member choice appears only where there is a Session.** Presbyteries and other organizations can still record participants.
- **Everything is recorded.** Each approval, denial, withdrawal, and each officer term started or ended is written to the audit log in the same step as the change, so a decision made through PresbyPortal cannot be saved without its record. Approved, denied and withdrawn entries can no longer be changed or deleted by the application, and the database refuses it.

**Known limits.**
- Dates the system stamps itself ("Proposed", decision dates) follow UTC, so on a US evening they can show the next day. Dates you type are not changed.
- People hidden from the Directory still appear by name in Pending approvals to those who can propose or approve roll actions, because they need to know whom they are deciding on.
- A pastor who is already in PresbyPortal through their presbytery cannot yet be linked to a congregation to sit on its Session.
- Turning off the Community switch also hides Pending approvals.
- PresbyPortal staff gain no access to a congregation's roll from working for the platform. A staff member could be invited as a congregation's administrator and then record themselves on its Session, as anyone could. Every step is recorded in the audit log, and the platform does not block it.
- Platform maintenance that works directly in the database is stopped by a database rule, not by a removed permission.

**Technical:** migrations `0062_presby_session_approval` and `0063_presby_roll_decide_lockdown`. `presby_decide_roll_action()` and `presby_withdraw_roll_action()` are the only decide path. `presby_app` loses UPDATE and DELETE on `roll_actions`, which closes P5 and the `roll_actions` part of F176. Decided rows are frozen by `roll_actions_freeze`, which binds the owner connection by trigger only. DECISION-202–206 and findings F179–F185 and F188–F191 are recorded. F183 and F185 are closed. F182 stays open as a named `paper` residual.

**Do not write** (each contradicts the record):
- "Only the Session can approve", or "no one can approve their own entries".
- "No one can ever change a decided entry."
- "Nothing is ever deleted." F176 stays open for other tables, so limit the claim to roll entries and the application.
- "Elders can now approve" without the account caveat.
- "The Session will decide it." The Finding 2 ruling forbids promising it.
- "Visitors are walled off." F177 stays open.
- "Approval needs two-step sign-in."
- "Bulk approval is all-or-nothing."

**Operator runbook note (not for the member-facing note).**
- **Order:** snapshot production, apply `0062`, deploy the code, apply `0063`.
  - Code before 0062 calls a missing function.
  - 0063 before the code makes the old deny and approve fail on the privilege.
  - A code rollback alone does not undo 0063. Use the rollback statements in its header.
- **Pre-flight, because the 2026-10-22 counts predate real use.** Increment 1 has been live since 2026-10-23 and the operator is testing in production. Re-measure:
  - more than one pending proposal per person (0062 stop-block);
  - officer offices outside the nine-value vocabulary (0062 stop-block);
  - congregations without court groups;
  - org-owned `session_member` roles;
  - denied or withdrawn rows lacking `decided_by` or `decided_at` (0063 stop-block).
- **A duplicate-pending case has no in-app remedy.** The stop-block message says "withdraw or deny the extras", but neither exists in production before this release, and no one holds `roll.approve`. If the pre-flight finds a duplicate, stop. Resolve it on the owner connection as a minuted act, and expect to stamp `decided_by` and `decided_at` by hand before 0063, because no audit row will exist to backfill from.
- **After 0062, the first congregation has the role and an empty Session.** Nobody can approve until its administrator records themselves under Officers. Existing waiting proposals then become approvable.

## Ship conditions the orchestrator owes at integration

All are Rule 16 shared files, so they are yours and not the branch's.

1. **`drizzle/meta/_journal.json`:** add idx 62 `0062_presby_session_approval` and idx 63 `0063_presby_roll_decide_lockdown`. Each `when` must exceed idx 61's `1787187173186`. Leave 58 reserved and 64 reserved for 2b.
2. **`scripts/test-rls.sql`:**
   - Re-check at integration that `git apply scripts/session-approval/test-rls.sql.integration.patch` is still clean. It was clean against `main` at `4cdd5ab`, and parallel pipelines may have moved the file.
   - Then run the full file as `presby_app` on merged `development`, with both 0062 and 0063 applied.
   - Expect only the four pre-existing failures: presbytery members 3≠2, the 2fa definer, the DECISION-152 count, and `46i`. Confirm they are tracked.
   - Section 62 should show 53 passes and section 61 should show 34.
3. **`docs/decisions.md`:** insert DECISION-202–206 newest-first, above DECISION-222.
   - **Amend DECISION-205 to six states.** Change the heading from "told in five states". Add `terms_not_started`, and define `no_sign_in` as "a seat in effect and none of the people in effect has an account".
   - **Change DECISION-206's status** from "Proposed (operator confirmation pending)" to Resolved, per the Batch A record.
   - **Correct DECISION-206's S1 sentence.** The guard also fires on `ends_on` to block re-opening a closed pastor term (Batch A deviation 1).
   - **State the owner-path residual in DECISION-203:** the freeze is trigger-only on the owner connection. Also record that 0063 revokes from `presby_platform` as well.
4. **`docs/schema-design-2.md`:** add F179–F185 and F188–F191 as a lettered subsection.
   - F182 stays open as a `paper` residual. F190 is recorded, not fixed.
   - Verify these numbers are free at merge. F186, F187 and F192–F199 stay reserved for 2b.
5. **`CLAUDE.md` Two Hierarchies sentence**, for the operator to read in the diff.
   - It is not in the worktree yet.
   - Use the shipped wording: ruling elder, installed pastor, co-pastor or associate pastor; stamped `selfRecorded` and `selfApproved`; `paper`.
   - Batch D noted `AGENTS.md` was not regenerated. Regenerate it if `CLAUDE.md` changes.
6. **`docs/product/functionality-map.md` (Rule 14).** Rewrite the Community bullet (line 70) and the sentence at line 18.
   - Remove "which nobody can yet approve (Increment 2)", "the approval `UPDATE` stays application-gated until Increment 2", and "no role can give yet (F183…)".
   - Add: the queue, bulk approve, withdrawal, the `session_member` role, pastors as Session members, the pastor offices on Officers, the six states, and the account requirement until 2b.
   - Update the Index line too.
7. **`docs/TODO.md` (Rule 10).**
   - Move the Increment 2 line (263) to Done with the ship date, leaving 2b and 3 open.
   - Change "five states" to six.
   - Close F183 (264) and P5 (265).
   - Amend line 220: "no new congregation can approve a member" becomes false once a Session is seated.
   - Keep F177 open, and keep F176 open for the other tables.
   - Add follow-ups 1–11 above.
8. **Release notes and version.** Use `docs/release-notes/v0.41.md` and bump to 0.41.0 through `/release-notes`. Use the lines above, which already carry the "Do not write" guardrails. Link `v0.40.md` forward.
9. **`docs/architecture.md` (Rule 15):** no change. Nothing here is architectural. I agree with Phase 3.
10. **Manual walk before release.** On `development`, at 360px:
    - an administrator at a congregation with a Session group records themselves as a ruling elder starting today;
    - Pending approvals flips to decide mode;
    - they approve their own proposal;
    - the audit row carries `selfRecorded` and `selfApproved`.

    Then repeat the read-mode view with a propose-only clerk. Record the result in the work-log. Nothing tests this whole chain end to end (follow-up 11 adds the e2e).
11. **Work-log housekeeping.**
    - Add the correction beside the `aria-describedby` reason.
    - Record the per-phase row below, keeping the pipeline open for 2b and 3.
    - Pipeline-branch cleanup: rotate the `pipeline-session-approval` role passwords, since QA's run 1 printed dev-only connection strings into a transcript. Confirm or reset the two global flags (`org_portal.members_create`, `org_portal.members_roll_action_edit`) on that branch if it is kept, and sweep the 25 expired fixture rows. All three are moot if the branch is deleted at cleanup under the standing authorization.
12. **Rule 12:** not applicable. The source was the operator, with no feedback row.
13. **Rule 13 (what's-new advisory):** hold any what's-new entry until 2b ships.
    - An entry saying Session members can now approve would be false for any elder without an account.
    - If one is published sooner, it must carry the account caveat.
    - This is admin tooling for clerks and Sessions, so the entry is not required.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2 · 6 — Shipped vs intent | analyst | Complete for Increment 2 (the work-log stays open for 2b and 3). Every Phase 1 verb works for the right person. Two drifts, both ruled: no admin-hub tile, and invites deferred to 2b. All can't-act states tell the truth, with two small copy nits. Eleven follow-ups for TODO, thirteen integration conditions (the manual bootstrap walk is the one that needs a person), release lines drafted against the accepted residuals. | **SHIP WITH NOTES** | 2026-10-23 |

## Handoff

Next agent: **orchestrator.** Record this section, then run integration conditions 1–11 through `/merge-pr`. Condition 10, the manual bootstrap walk, needs you or the operator in a browser. Nothing commits or pushes without the operator's say-so.

After that:
- **deployment-engineer** carries the runbook note.
- **Increment 2b** starts from follow-up 4's constraints.
- The operator reads the `CLAUDE.md` sentence and the release note in the diff.

---

## Increment 2 — Integration

Integration for Increment 2 (acting for the orchestrator, 2026-10-23), carrying out Phase 6's ship conditions on `pipeline/session-approval`. The pipeline stays open for Increments 2b and 3.

- **Merge:** `git fetch origin && git merge origin/main` was "Already up to date" (HEAD d2601bb on top of `main` 4cdd5ab). No conflicts.
- **Condition 1, journal:** idx 62 `0062_presby_session_approval` and idx 63 `0063_presby_roll_decide_lockdown` added to `drizzle/meta/_journal.json`, `when` 1787273573186 and 1787359973186 (idx 61 is 1787187173186; one day apart, the journal's existing spacing). 58 and 64 stay reserved.
- **Condition 2, `scripts/test-rls.sql`:** `git apply --check` was clean, then `scripts/session-approval/test-rls.sql.integration.patch` applied (the section 5, 20d and later roll_actions assertions move to `insufficient_privilege`; `\ir session-approval/test-rls-62.sql` appended). No staged `seed-dev.sql` patch exists for this increment (F190 is recorded, not fixed), and `scripts/participants/` holds only the already-integrated `test-rls-61.sql`. **Not run:** the full file as `presby_app` on merged `development`; no DB-mutating command was run here.
- **Condition 3, `docs/decisions.md`:** DECISION-202–206 inserted above DECISION-222. DECISION-205 is "six states" with `terms_not_started` and the `no_sign_in` definition; DECISION-206 is Resolved with the S1 `ends_on` correction; DECISION-203 records the owner-path trigger-only residual and the `presby_platform` revoke.
- **Condition 4, `docs/schema-design-2.md`:** new section 2v (F179–F185, F188–F191). F182 is an open `paper` residual, F190 is recorded not fixed, F186, F187 and F192–F199 are untouched. The F175 and P5 lines in 2u gained a pointer to 2v.
- **Condition 5, `CLAUDE.md`:** one sentence added at the end of Two Hierarchies (shipped wording, ruling elder, installed pastor, co-pastor or associate pastor; `selfRecorded` and `selfApproved`; `paper`; cites DECISION-205). `AGENTS.md` is a static portability shim that quotes none of `CLAUDE.md`, so there is nothing to regenerate.
- **Condition 6, functionality map:** the Community bullet and the org-portal sentence rewritten; the Index authorization and roll lines updated; version stamp 0.41.0.
- **Condition 7, `docs/TODO.md`:** Increment 2 moved to Done (2026-10-23); the Increments 2b and 3 line kept open; F183 and P5 removed from open (closed in the Done line); the F111/F118 line amended; F177 and F176 kept open; follow-ups 1–11 added, plus the manual bootstrap walk (condition 10), a what's-new hold line (condition 13) and the pipeline-branch cleanup (condition 11).
- **Condition 8, release:** `docs/release-notes/v0.41.md` (0.41.0), `v0.40.md` linked forward, `package.json` and the two top-level `package-lock.json` fields bumped to 0.41.0. The operator runbook is `docs/deployment.md` → "Session approval (Community Increment 2)", following the 0057 and 0059 precedent. `docs/STATE.md` has a new RESUME block.
- **Condition 11, aria-describedby correction:** verified present at the QA run 3 Batch C note ("orchestrator correction after QA run 3: Radix 1.1.23 does not warn; the line is a no-op, kept to avoid a re-test"). The per-phase row for Phase 6 is already recorded.
- **Conditions 9 and 12:** no `architecture.md` change; Rule 12 not applicable.
- **Verification:** `npm run typecheck`, `npm run lint` (max-warnings 0), `npm run check` (all tripwires) clean; `npm test` 7779 passed, 2286 skipped (DB-backed), 0 failed. No test reads the journal or the docs.
- **Still owed, needs a person or a database:** condition 2's full `test-rls.sql` run on merged `development` (expect four pre-existing failures; section 62 = 53, section 61 = 34), condition 10's manual bootstrap walk at 360px, and condition 11's branch cleanup (role passwords, two global flags, 25 expired fixture rows). Nothing is pushed.

---

# Increment 2 — Manual bootstrap walk (ship condition 10)

*Run by a general-purpose agent for the orchestrator on Neon branch `pipeline-session-approval`, 360x740, synthetic data; returned text recorded verbatim. Screenshots kept in the session scratchpad, not the repo.*

The founding-administrator bootstrap works end to end and every step passed: read mode, self-recording as an elder, the flip to decide mode, self-approval, both audit rows, and the clerk's read-only view. I changed no repo file, and the database is back to its prior state. It ran on Neon branch `pipeline-session-approval` (0062 and 0063 confirmed present), with a dev server on port 3390, Chromium at 360x740, and synthetic data only.

**Setup.** The founder is a new user `e2e-walk-founder@presby.invalid`, person "E2EWalk Founder", with a staff membership at e2e-alpha. Their roles came from the real `presby_apply_founding_administrator()`, which created the Founding Administrator and Stated Clerk roles at alpha. Their effective permissions included `people.manage`, `officers.manage` and `roll.propose`, but not `roll.approve`. The clerk (Ottoline) used the community fixture with `setRollApprove(false)`, so she was propose-only. alpha already had a Session group (empty roster) and a `session_member` role. The flags and toggle were all already on, so nothing had to be flipped.

| Step | Result | What I observed |
|---|---|---|
| 1. Landing | PASS | `/launch` sent the founder straight to `/o/e2e-alpha`. |
| 2. Propose and read mode | PASS | Proposed "E2ECommunity WalkProposal" through the wizard as "Member: profession of faith (needs Session approval)". The review step said "This person's roll action will wait. No one on your Session can approve yet." On Pending approvals: 0 Approve, 0 Deny, 0 checkboxes, 1 Withdraw, no horizontal overflow. |
| 3. Officers | PASS, with a lag | Recorded themselves as Ruling Elder from 10/23/2026. Self note and toast appeared, and the roster showed "Ruling Elder **Self-recorded** · E2EWalk Founder · 10/23/2026". |
| 4. Decide and approve | PASS, with a lag | Same page, now with no banner, plus "Select all on this page", a checkbox, Approve, Deny and Withdraw. The dialog fit the screen. After a reload the row sat under Recently decided with "Self-approved". The database shows approved, the minute reference saved, decided by the proposer, roll now active. |
| 5. Audit | PASS | Both rows found (below). |
| 6. Propose-only clerk | PASS | Read mode, 0 Approve/Deny/checkboxes, Withdraw only on her own proposal. She was refused the Officers page. |

Exact text for each step:
- **Step 2 subtitle:** "You can see what's waiting for the Session. Only members of the Session can approve."
- **Step 2 banner:** "Your Session roster is empty — Member proposals wait until your Session can approve them. Record your ruling elders, installed pastors and associate pastors under Officers. Open Officers" ("Open Officers" is a link).
- **Step 3 self note:** "You're recording yourself as a member of the Session. That's allowed, and the record will show it as self-recorded."
- **Step 3 toast:** "Officer term recorded."
- **Step 3 Session note:** "Members of the Session decide who is received onto the roll. Recording a ruling elder, installed pastor, co-pastor or associate pastor here seats them on the Session. They can approve only once they have a PresbyPortal account."
- **Step 4 dialog:** "Approve E2ECommunity WalkProposal's roll action? This records profession of faith on the roll, effective 10/23/2026. Minute reference (optional)". I entered "E2EWalk Session minutes 2026-10-23".
- **Step 4 toast:** "E2ECommunity WalkProposal's roll action approved."
- **Step 6:** she saw the same subtitle and no banner, since the Session was no longer empty at that point. Her Officers refusal read: "You don't have permission to manage officer terms at Wrenfield Presbyterian Church. If you think this is a mistake, ask your stated clerk or another administrator there."

**Audit metadata (step 5), ids removed:**
- `tenant.officer_term.started`: `{"office":"ruling_elder","startsOn":"2026-10-23","orgUnitId":null,"selfRecorded":true}`
- `tenant.roll_action.approved`: `{"kind":"profession_of_faith","selfTarget":false,"shadowedBy":null,"selfApproved":true,"effectiveDate":"2026-10-23","minuteReference":"E2EWalk Session minutes 2026-10-23","affectsFiledPeriod":false}`

The wizard wrote no audit row when it created the person and proposal. A comment in `community/new/actions.ts` says that is deliberate.

**Things that would confuse a real clerk at 360px:**
1. **Dates show tomorrow in the evening (a real bug).** "Proposed 10/24/2026" and "Approved 10/24/2026" appeared while it was still 10/23 at 8pm in Pacific time. `src/lib/roll.ts:781` takes the date in UTC (`(ra.recorded_at at time zone 'UTC')::date`). The decided date looks like it comes from the same kind of conversion. A US clerk working in the evening sees the proposal dated the day after its effective date.
2. **The Officers page contradicts itself.** The form says "recording someone here does not, by itself, change what they can do in the app". The note right above it says recording an elder seats them on the Session so they can approve.
3. **The officer roster is cut off at 360px.** The table scrolls sideways inside its box, so "End term" is off screen. The "Self-recorded" badge runs into the wrapped name "E2EWalk Founder".
4. **The screen doesn't update after saving.** After both "Add officer term" and "Approve", the roster and queue still looked unchanged 2.5–3 seconds after the success toast; a reload showed the change. The refresh calls are in the code, and the spec itself allows 30 seconds for this on a dev server, so it may be dev-only. I can't rule out that users see it.
5. **Minor:** the clerk is told only Session members can approve, but nothing says who is on the Session. Her Officers refusal says to "ask your stated clerk", though she is effectively the clerk. The Next.js dev "N" badge overlaps content in the screenshots, but that is dev-only.

**Cleanup and residue: none.** I ended and removed the officer term, removed the fixture people with `sweepCommunityPeople` (through `removeCommunityFixture`, which also restored the flags and toggle by SELECT and removed the approver role), and removed the founder's grants, the two founding roles, the founder's membership, person and user. A final check matched the prior state exactly: alpha has its original 3 roles, an empty Session roster, 0 officer terms, 0 roll actions, 0 walk audit rows, 0 founding-admin holders, flags and toggle on as before, and no disabled triggers. The dev server is stopped and `/private/tmp/inc2-walk` and my helper scripts are deleted. One thing to know: `git status` in presby-fadir showed `drizzle/meta/_journal.json` and `scripts/test-rls.sql` modified at the start and clean at the end. I never touched that worktree, so something else changed it during the walk.

## Orchestrator disposition (2026-10-23)

- **Fixed before ship:** finding 2 (the Officers form hint contradicted the Session note). New hint, pinned by `officers/page.test.tsx`: "This records who holds the office. Apart from seating the Session (see above), recording someone here does not change what they can do in the app. Other access is granted under Administration → Roles." The Staff page keeps its hint, which stays true there.
- **Already tracked:** finding 1 (UTC dates) is Phase 6 follow-up 1.
- **New TODO lines:** finding 3 (officer roster at 360px: End term off-screen inside a sideways-scrolling table, the Self-recorded badge collides with a wrapped name); finding 4 (roster and queue lag a reload after a success toast on the dev server; confirm on production); finding 5 (the propose-only clerk is not told who sits on the Session; the Officers refusal tells a clerk to "ask your stated clerk").

---

# Increment 2b — Phase 1 addendum 2: auto-connect, accept in place, and reconciliation with v0.41–v0.42.2 (analyst)

*Returned as text for the orchestrator to record verbatim. I wrote nothing and ran nothing against any database or browser. Everything below comes from reading the work-log, the code in `/Users/cshenso/git/presby-platform/presby-2b` (HEAD `5f333eb`, v0.42.2) and the installed Auth.js source. No real names or addresses appear.*

### VERDICT

**READY WITH NOTES.**

The shape holds: the 2b invitation design stands, and both operator additions fit around it. But two things must go to the **architect for a short Phase 2 addendum** before the tech-lead redesigns:

- **Auto-connect (A) contradicts a recorded invariant.** DECISION-216, a sentence in CLAUDE.md and `scan.test.ts` section 3 all say a contact email authenticates nothing, and that auth paths never touch `contact_methods`.
- **Accept in place (B) is a token-less acceptance path.** That changes the credential model of DECISION-147/183.

Both depend on "verified" meaning something reliable, and today it does not. Four operator questions follow, each with a default that points in the safe direction.

### ONE-LINE TAKE

> When someone signs in with an address they have really proven, and exactly one eligible, authority-free person at a congregation carries that address, we link the sign-in to that person (no membership created, no role conferred). If instead an invitation is open for that address, `/no-organization` offers to accept it right there. Everything with authority, every visitor and every ambiguous match stays on the explicit invitation path.

### Premise checks (facts that change the request)

1. **There is no local self-registration.** `src/auth.ts` credentials sign-in needs an existing `users` row with a password, and the only thing that creates one is invitation acceptance (`email_verified = now()`, `0059:1203` and `0064:812`) or a seed.
   - "Or just registered" can only mean a first Google sign-in, which the Auth.js adapter turns into a `users` row.
   - A "verified local registration" does not exist. I assume no registration form is expected; it would be its own pipeline.
2. **`users.email_verified` is not a reliable fact today.**
   - Auth.js creates OAuth users with `emailVerified: null` (`handle-login.js:260`), so Google users have it null.
   - The app never reads Google's `profile.email_verified` claim. `evaluateSignIn` (`sign-in-gate.ts`) checks only "has an email" and `isActive`.
   - The verify-email flow (`verify-email/[token]/page.tsx`) changes `users.email` and leaves `email_verified` untouched. After an email change the stamp therefore refers to the old address.
   - Only invitation-created accounts carry a meaningful stamp.
   - So the premise "an address they've proven" has to be built, not read.
3. **Linking is not authority-neutral.**
   - `presby_user_organizations` and the permission resolver both reach a person's grants through `people.user_id`.
   - Binding a login therefore activates every inert grant on that record: Session seat, person-arm role, managed-group grant.
   - "Auto-connect must not confer a role" is only true if the eligible set is restricted. The operator's "only connection" intent needs a precondition, not just a promise.
4. **Where I read the operator's production symptom.** I read "designated treasurer and the invite accepted" as the designation having been sent. A person who had really accepted is linked at accept, because the treasurer path uses `linked_person`, and would not reach `/no-organization`.
   - If they had truly accepted and still landed there, that is a separate defect. The likeliest cause is an organization that is not `managed`, so the user lands in the "being set up" state.
   - The orchestrator should confirm which with the operator.

### Pass 1: User verbs

| Surface | Verb | Cadence |
|---|---|---|
| Newly authenticated user, not connected | Signs in with Google or a password. Nothing else: the connection happens to them. | each sign-in |
| Same user, zero congregations | Opens `/no-organization` and reads which of four states applies | on demand |
| Same | Clicks **Accept the invitation** on a card for an invitation addressed to their signed-in address | once per invitation |
| Same | Clicks **Continue to verification** (2FA) and returns | when 2FA is required |
| Same | Clicks **Check again** after their congregation edits a record | on demand |
| Same | Clicks **Sign in with a different account** (the wrong Google account is the commonest failure) | rare |
| Admin (`people.manage`) | Types or edits a person's address (existing) and now learns from the card whether that person connects by signing in or only by invitation | on demand |
| Admin | Sees "Connected on {date}" on the card and marker after a sign-in | on demand |
| Platform admin | Unchanged: org-sent masked panel, revoke-all by scope | rare |

Surface assignment: A acts on the newly authenticated user (no roles yet), B lives on `/no-organization`, and the admin verbs are on the existing Community edit page.

### Pass 2: Flow audit

**FA1. Google sign-in, first time, address on exactly one eligible record**
- Entry: `/signin` → Google → the adapter creates the `users` row → the `jwt()` first-sign-in branch.
- Steps: stamp proof from Google's `email_verified === true` → call the connect definer → it links, and TS writes the audit row in the same transaction → `jwt()` continues. Because it recomputes `twoFactorRequired` after the link, the cookie is correct.
- Outcome: `/launch` → `/o/<slug>` (or `/home` if more than one org). The user is connected and sees baseline access only.
- Failure: any decline, DB error or exception is swallowed. Sign-in proceeds exactly as today, the user reaches `/no-organization`, and nothing is logged with an address in it.

**FA2. Password sign-in** is the same, with proof = `users.email_verified is not null`, bound to the current address (G10).

**FA3. Declines.** Every decline looks identical to the user (state N0 below) and writes no audit row. The ordered checks are in "The decline table" below.

**FA4. Check again.** A Server Action on `/no-organization` runs the same definer, calls `unstable_update({user:{}})` and redirects to `/launch`.
- It must be an action, not a write during render. A Server Component cannot re-issue the cookie, so the proxy's 2FA wall would read a stale `twoFactorRequired` claim.
- Nothing changed → the page stays, with "Nothing new yet."

**FB1. Accept in place**
- Entry: `/no-organization`, zero enterable orgs, at least one open invitation addressed to the proven address.
- Steps: card per invitation (congregation named, role phrase, "you'll be connected as {Name}") → Accept → definer → `/launch?next=/o/<slug>` (the existing redirect).
- Failures:
  - Blocked: neutral copy by purpose, from `inviteeBlockedCopy`.
  - Dead (raced, expired, revoked): the existing uniform dead-link sentence.
  - 2FA required and unverified: flow FB2.
  - DB error: "Your invitation is still good. Try again."

**FB2. 2FA parity (G9).** A session with `twoFactorRequired && !twoFactorVerified` gets a card that says to finish verification, with a button to `/totp?callbackUrl=/no-organization`.
- This matters because a new Google account defaults to `two_factor_required = true` and is unenrolled, and nothing else walks it to enrolment (the proxy gates only `/admin` and `/o/*`).
- Accept must route through `/totp` exactly as `/invite` does.

**FB3. Several invitations** (different orgs or purposes): one card each, each with its own button, ordered by sent date. Accepting one redirects into that org.

**FB4. No-op after auto-connect.** A `sign_in` invitation that is still open after the person was connected another way is accepted as the harmless same-account/same-person no-op.
- With A this becomes common, so that page must read as success, never "blocked".
- The open row is left to expire (the F6 default). The card derives "can sign in" from `people.user_id`.

**FB5. Precedence (my default, G17).** If any open invitation exists for the address, A does not run, and B takes over.
- The invitation is the explicit, sender-gated, audited path, and it connects and grants in one act.
- This also fixes the operator's treasurer case with no `/launch` change: the designee lands on `/no-organization` and sees the Accept card, not a half-connected baseline user with no hint that a role is waiting.

### The decline table (ordered; all declines silent and identical to the user)

Preconditions: the session user id comes from the server, never from the client. Run after authentication, never inside `authorize()` or `evaluateSignIn`.

1. `users.is_active` is true. A deactivated account declines. The proxy bounces it before `/launch` anyway, but the definer re-checks.
2. The address is proven for the account's current address (G10).
3. The user is not already linked to a live person anywhere.
   - If they are, there is nothing to do. This is also what protects a shared-household address: the spouse who already signs in is already linked.
4. No open invitation addressed to this address exists, so FB5 applies.
5. The candidate set C is the unmerged, not-deceased persons holding this address as an active email who have a live membership at some organization (R29's predicate, plus deceased excluded). `|C| = 1` or decline. Zero is no match; two or more is ambiguous, including a match at two organizations.
   - Matching is exact on `lower(btrim)`. No fuzzy matching and no dot or plus folding (G3 stands).
   - Any active address of the person counts, not only the primary. This is consistent with R27.
6. That person's `user_id` is null. If linked to another account, decline.
7. R31: the person has no membership at any other organization, live or ended.
8. The membership is live and the organization is `managed`.
9. F177: not a visitor with no roll. This is the Community Visitors predicate, pinned equal by the same test as 2b condition 3.
10. Authority-free (G11): no open or future Session or diaconate seat, and R21's set T (person-arm grants plus non-derived managed-group grants, built per A4 and A5) is empty. Staff anchors and staff positions are eligible, accepted on purpose as in F177.
11. Under lock in the R27 order (users, person, contact `FOR SHARE`), re-check 3 to 10, then write `people.user_id` and stamp the matched contact's `verified_at`.
    - Writes nothing else: no membership, role grant, group or officer row.
    - Returns the organization id and person id so TypeScript writes the audit row in the same transaction.

### Pass 3: Permissions and flags

- **No new `FEATURES.*` key.** Connection is not a permission; it authorizes nothing the person's existing records do not already allow, and the decline table keeps it to the baseline.
- **Credential model.**
  - A uses no credential: it is an identity binding gated by proof plus eligibility.
  - B accepts an invitation by proof of the addressed mailbox instead of the emailed token. That is a new mode of the credential (G15, Q2).
  - Neither maps into `FEATURES.*`, a session claim or the resolver.
- **Flags.** No new platform flag, per the operator's standing rule. Connections cannot be undone in 2b (disconnect-after-accept is still deferred). A per-organization toggle, "Let people connect themselves by signing in", default on, is the only compliant way to stop new ones at one congregation. I recommend it as a Phase 3 input.
- **2FA and the connection.** I recommend A does not wait for 2FA. A fresh unenrolled account has no gated route to enrol from, so requiring a verified challenge before connecting would strand it. The proxy gates the destination as always. This differs from existing-account accept, which requires in-session 2FA, and it is safe only because A connects authority-free people.
- **Audit (Workflow Rule 7).** Identity binding is security-sensitive. New key `tenant.person.sign_in_connected`, written with `insertAuditRow` in the connecting transaction.
  - Metadata: `organizationId`, `personId`, `via` (`sign_in` or `check_again`), `proof` (`google` or `account`), `contactMethodId`. No address, name or token.
  - Actor is the user themselves.
  - The accept-in-place audit rows are the existing `invitation.accepted` family with `via: 'signed_in_address'` stamped.
  - Declines write nothing. The `check:audit` tripwire covers `actions.ts`, so the Check-again action must reference an `AUDIT_ACTIONS` key.
- **Deactivated accounts.** Refused by the definer (check 1) and bounced by the proxy.

### Pass 4: Gaps the request didn't address

**G10. "Verified" must be built (ARCH).** Required property: proof is a database fact bound to the address currently on the account.
- Suggested mechanism for the architect:
  - Stamp `users.email_verified` from Google's `email_verified === true` in the `jwt()` first-sign-in branch, where `account` and `profile` are available.
  - Also stamp it at verify-email completion, keep it at invitation accept, and add a `BEFORE UPDATE OF email` trigger that clears the stamp unless it is re-stamped in the same statement.
  - The definer then checks the column. That makes A and B independent of the open F187 residual (an application bug rewriting `users.email`).
- Related and independent of the mechanism: reject (or treat as unproven) a Google sign-in whose claim is not true (Q3).
- No backfill. Existing Google users re-stamp at their next sign-in.
- This touches `src/auth.ts`, so the Phase 4 gate applies: a running-server e2e of the full login, including an MFA-enrolled user, before QA.

**G11. Authority-free precondition (ARCH, Q1).** R21's sender ceiling cannot apply because there is no sender. An address is typeable by anyone with `people.manage`, so without the precondition a `people.manage`-only holder could put an accomplice's Google address on an elder's record and bind that elder's Session authority with no invitation, no limit, no confirm dialog and no `invitation.created` row. That is the exact bypass R21 and R31 exist to close. The decline table, step 10, closes it.

**G12. F177 (visitors).** Option 3's acknowledgement is made by a sender at send time. Auto-connect has no sender, so a visitor connecting by sign-in would read the directory with nobody warned. Exclude visitors (Q1). They remain invitable with the acknowledgement.

**G13. DECISION-216 / CLAUDE.md / `scan.test.ts` section 3 (ARCH).**
- A makes a contact email identify a person for a verified sign-in. It authenticates nothing: Google or the verified account proves the address. But DECISION-216's wording and the CLAUDE.md sentence need an amendment: "a contact email never authenticates; it may identify a person for a verified sign-in only inside the connect definer."
- The scan forbids auth files from naming `contact_methods`, `presby_person_email` or `getPersonEmail`. The connect call must live outside `src/lib/auth` and `(auth)` (for example `src/lib/onboarding/`), called from `auth.ts` as an opaque function. Naming no contact table keeps the letter of the scan, so the amendment keeps the spirit.

**G14. A second writer of `people.user_id`.** The connect definer is SECURITY DEFINER, so it runs as the owner and `people_guard_user_link` passes it. But DECISION-208's text ("the only legitimate writer is `presby_accept_invitation`"), the F186 text and the 2b release line must name it. The A2 source scan (no non-test `src/` file writes `userId` on `people`) is unchanged and still holds.

**G15. B is token-less acceptance (ARCH, Q2).**
- The raw token is never stored (hash only), so "accept in place" cannot call `presby_accept_invitation(token, …)`. It needs a mode that proves the invited address by signed-in proof instead.
- The token adds little on top of a strongly proven session, because existing-account accept already requires the session email to equal the invited address. The token mainly signals intent, and the click supplies that. It carries the whole proof burden only under weak proof, which is exactly today's Google handling.
- So B is safe only with G10. FA and treasurer grant authority, so this is not a formality.
- The cleanest mechanism is one more mode of the same accept function (invitation id plus the verified session identity), so every gate, branch and audit row is shared and the parity golden extends rather than forks.
- The architect should also consider the "resend-and-consume" alternative (mint a fresh token server-side and consume it). I do not recommend it: it fights the resend cooldown and chain cap, and platform resend is an operator action.

**G16. B must keep G9.** See FB2. The `/totp?callbackUrl=/no-organization` hop must be allowed by `sanitizeCallbackUrl` (it is a same-origin path).

**G17. Open invitation versus auto-connect, and stranded rows.** Default FB5. Residual, not solved here: a connected member who is later designated treasurer still accepts through the emailed link, because `/no-organization` is not shown to them. A `/home` card is a follow-up that needs a new row in the `computeDestination` matrix and the CLAUDE.md Post-Login Landing table.

**G18. Candidate resolution rules** (decline table 3 and 5 to 8). Include a DB test matrix of at least: shared address, shared with a deceased or ended person, person linked to another account, two organizations, ended address, unmanaged organization, merged person, a user already linked, an address differing only in case.

**G19. Catch-up and cookie claims.** See FA4. The sign-in hook is correct because the claims are recomputed after the link in the same `jwt()` run.

**G20. Sender-side signals.**
- (a) A new, low-grade observation: an administrator who adds an address to a record can see the person become "can sign in" after that address's owner signs in. It reveals that an account for the address exists. DECISION-189 forbids reading `users` on the sender screen; this is a derived signal, not a read, and is inherent to the feature. Record it as an accepted residual and keep the reader's `linked` derived from `people` only.
- (b) The R21 residual widens: a `people.manage`-only admin can bind an accomplice to an authority-free, non-visitor member by typing an address. The baseline is what a `people.manage` holder can already give by recording a participant and inviting them under 2b. It loses the rate limit, the confirm dialog and the `invitation.created` row. Detection chain: `tenant.person_email.added` or `primary_changed`, then `tenant.person.sign_in_connected`, joined on `personId`. This stays `paper`, detected by audit.
- (c) **Deploy-day effect.** At release, every existing unlinked user whose proven address matches exactly one eligible person connects at their next sign-in, a one-time wave. Measure first (counts only) and say so in the release note.

**G21. The 2b surfaces' copy would now lie.** The reconciliation table lists them. The main ones are "Can't sign in yet", "none has a PresbyPortal account yet" and "accepts it from the email".

**G22. Test and fixture blast radius.**
- `src/app/no-organization/page.test.tsx` pins the heading and two sentences.
- `e2e/post-login-routing.spec.ts:73-83` and `e2e/member-home.spec.ts:90` pin the heading and "ask your church administrator".
- Seeded unlinked users (the e2e `member`) land on `/no-organization` by design. If any seeded user's email also sits on a seeded eligible person, A would connect them and break those specs. Run a read-only join before Phase 4.
- `scan.test.ts` section 3 and `email-audience.test.ts` also change.

**Reconciliation: what in the 2b design is now stale**

| 2b design says | Now | What must change |
|---|---|---|
| Migration 0064, `test-rls-64.sql`, seed and patch names | 0064 is person emails (live, v0.42.0) | **0065**; `test-rls-65.sql`; header chain `…0063 < 0064 < 0065`; diff live preview and accept against **0064's bodies**, not 0059. 0064 already re-created both, and the parity golden stays the gate. |
| Primary address "read in SQL" and `address_ambiguous` for more than one primary | One active primary is a database property; `presby_person_email(person,'credential')` is the authority | Issue and resend call the reader; no row means `no_email_on_file`; **drop `address_ambiguous`** from `SIGN_IN_REFUSALS`, the copy table, the pins and the tests. |
| R27, `address_current`, R29 `address_shared`, reader predicates | `contact_methods` has `ended_at` | Every predicate gains `ended_at is null`; "any on-file email" means any active email. |
| S9 `contact_methods_email_norm_idx` in 0064/0065 | The global lookup index shipped in 0064 (ER17) | Remove it from 2b's migration; A's definer reuses the existing index. |
| F199 and in-transaction `updatePerson` audit with `emailChanged` (Batch B) | Shipped in 0.42.0 | Delete from Batch B and Test Plan 7. The R21 detection chain now starts at `tenant.person_email.added`, `.ended` or `.primary_changed`. |
| `EMAIL_AUDIENCE` and `credential-keys.ts` gain the sign-in key | Registry exists and requires a sender for every entry | Add `account_sign_in_invitation: person:credential` in the same batch as the sender, not before. |
| The card shows the "on-file primary email" from `getPersonForEdit` | A list of emails | The card shows the credential address from the reader. The "Also on file for {Name}" note (ER23b, pinned equal to R29) now carries the A ambiguity predicate in the same equality pin. |
| DECISION-208: "the only legitimate writer is `presby_accept_invitation`" | A adds a writer | Amend DECISION-208 and F186; the A2 scan is unchanged. |
| A3 release line "a connection … from a congregation's side only by accepting an invitation" | False once A ships | Rewrite: "…by accepting an invitation, or by signing in with a verified address on exactly one eligible record." |
| Edge case 9: "the sender cannot learn whether an address has an account" | G20 (a) | Qualify it and record the residual. |
| F6: leave an open row to expire | Common after A | Keep, and make the no-op accept page read as success (FB4). |
| Officers roster and Staff get no marker in 2b (Q4 default) | Inc 2 Phase 6 follow-up 4(c): add the R26 marker to the **Session roster rows** on Officers, beside "Self-recorded" | Add it. Staff page stays a follow-up. |
| Banner: "none has a PresbyPortal account yet", `NO_SIGN_IN_INVITE_LINE` placeholder (`session-state-banner.tsx:11`; the test pins the exact text at `:165`) | The state means `people.user_id` is null, i.e. not connected. A Google user with an authority-bearing record is not connected. | Replace only the constant (follow-up 4a), and reword "has an account" to "has connected a sign-in". Do follow-up 2 here: `no_permission` ("have accounts", the Roles pointer) and `WITHDRAW_COPY.already_decided`. Hand-off only in `no_sign_in`, never `terms_not_started`; e2e seeds a seat in effect (4b). Check the remedy shown to a read-mode viewer is usable (4e). The same "needs a PresbyPortal account" wording sits in the `terms_not_started` banner and the Officers Session note. |
| Marker "Can't sign in yet" | A Google user can sign in but is unconnected | "Not connected yet". |
| `invitation-copy.ts`: `InvitationCopyPurpose` lacks `sign_in`; `acceptanceSentence` says "accepts it from the email" | B lets them accept at the site | Add `sign_in`; drop "from the email". Goldens: `designation-holder-copy.golden.test.ts` and `invitation-copy.test.ts`. Tenant senders see the full person name, unlike the platform's first-name-only rule. |
| "Facts on record at kickoff": Increment 2 Phase 4 not started, referenced by design names | Inc 2 is live (0062/0063, `session-approval-state.ts`) | Drop the rebase item; read the real `session-state-banner.tsx` and `connection-card.tsx`. |
| Counts (users 95/70, 69 marker, etc.) | Production has had real use since 2026-10-22 | Re-measure the 0065 stop-blocks (`users_email_lower_uq` case-duplicates) and the marker reach before deploy. |
| Numbers: DECISION-207/208, F186/F187, F192–F199 | 207/208 still unused in `decisions.md`; F210–F217 (emails) and F225–F229 (zod) are taken | Keep the reserved ones. The orchestrator assigns new DECISION and F numbers for G10, G11, G13, G15 and G20. |
| Release lines on visitors and the "Under the hood" paragraph | A and B add claims | Add the guardrails below. |

**Release-note "do not write"**
- "Signing in connects you automatically", without the limits (not visitors, not people who hold a role, not shared addresses, not people in two congregations).
- "No one can be connected without an invitation."
- "Accepting an invitation always needs the email."

### Pass 5: Adversarial

- **Redirects.** `Check again` and the Accept action take no client redirect target. The post-accept `next` is built from the definer's slug as today. The `/totp` callback uses a fixed same-origin path.
- **Identity from the client.** The user id comes from `auth()` only. The B action takes an invitation id (UUID-validated) for selection. The definer re-derives the address from `users.email` by the session's id and requires it to equal the row's `email_normalized`. A wrong or foreign id returns the uniform dead bucket, so it is not an existence oracle.
- **State-machine shortcuts.**
  - Deep-linking `/o/<slug>` does not skip A, because it runs at sign-in, not at `/launch`.
  - `/launch` and `/totp` before accept do nothing.
  - Posting the B action without the page runs the same gates.
- **Enumeration (DECISION-040/189).**
  - A runs only after the holder authenticated their own address, and all declines are identical (N0).
  - Naming a congregation is allowed only for an open invitation addressed to that proven address (the same fact their email states) and for a successful connection.
  - Dead, expired and revoked rows reveal nothing (the one-bucket rule stays).
  - The access-denied page at `/o/<slug>` is untouched and stays byte-identical.
  - The sender screen never reads `users`.
- **Input boundaries.** No user text reaches the definers. Case differences are handled by `lower(btrim)`. Homograph or IDN addresses match only exactly.
- **Self-targeting.**
  - A user already linked to a person cannot be connected to a second (decline 3).
  - An administrator who adds their own Google address to a different person gets nothing if they already have a person link.
  - A platform admin connects only as any person does, to an authority-free record, with baseline access. This is consistent with DECISION-183, and the audit row lets a reviewer see it.
- **Races.**
  - Two tabs signing in: the second sees linked-to-same and no-ops, with one audit row.
  - A connect racing an address edit: `FOR SHARE` plus the READ COMMITTED re-check gives `dead` or connect, never a link to a stale address.
  - A connect racing an accept: the same lock order (users, person, contact).
- **Wrong mailbox.** A fires only on the holder's own deliberate sign-in. That is stronger evidence than clicking an emailed link, and a stranger who never uses PresbyPortal never connects. The residual is a deliberate attacker (G20 b), bounded to the authority-free baseline.
- **Unverified Google claim.** With `allowDangerousEmailAccountLinking: true`, an unverified claim can already sign in as an existing local account. With A and B it would also connect, or accept authority, so Q3 closes it.
- **Irreversibility.** There is no disconnect in 2b. A mistaken connection is recoverable only by ending the membership or a support ticket (Q4).

### Copy for `/no-organization`, by state

The existing "pending (being set up)", "not a tenant" and "ended" blocks are unchanged and sit above these where they apply.

**N0, nothing connected and no open invitation.** Keep the heading "You're not connected to a congregation yet". The e2e and the `/no-organization` test pin its words.
- Body: "You're signed in as {address}. We couldn't connect this sign-in to a congregation's records."
- Second line: "Congregations connect people by the email address on their record. If yours has added you, it needs the exact address you signed in with."
- H2 replaces "Ask your church administrator": **"Ask your congregation's office"**. Body: "Ask them to check that {address} is on your record, or to send you an invitation. Then check again."
- Buttons: **Check again**; link "Sign in with a different account".
- Invitation line: "If you were invited, the invitation appears here when it was sent to this address. If it was sent to a different address or has expired, ask the person who invited you to send it again."
- Do not claim "no record has your address". A decline can occur for a match we chose not to connect.

**N1, one open invitation.** The heading is "You're invited to {Congregation}".
- `sign_in`: "{Congregation} invited you to sign in. Accepting connects this sign-in to your record there as {Name}. What you can do depends on your role at {Congregation}."
- FA and treasurer: reuse the existing `labels.ts` role phrases (for example "…invited you to set it up as its founding administrator"), plus "Accepting gives you that role."
- Button: **Accept the invitation**. Several invitations: "You have {n} invitations" and one card each.

**N2, two-factor needed.** "Your account uses two-step sign-in. Finish verification, then accept the invitation." Button **Continue to verification**.

**N3, blocked at accept.** The existing neutral invitee copy by purpose: "This invitation can't be completed. Contact {Congregation}'s office." and the shared-address variant.

**N4, dead (raced).** The existing `INVITATION_DEAD_LINK_COPY`.

**N5, a read failure.** The page does not fail: "We couldn't check for invitations just now. Reload the page."

**After Check again, nothing new.** "Nothing new yet."

**Admin card additions (Community edit page)**
- Eligible: "If {Name} signs in with {address}, they are connected automatically. You can still send an invitation."
- Visitor: "{Name} is a visitor, so signing in won't connect them by itself. Send an invitation if you want them to have access."
- Holds a role, or other: "{Name} can only be connected by invitation."
- After a connection: "Connected through sign-in on {date}."
- Two people sharing an address: extend the existing note to "Neither of you can be connected by signing in while this address is shared."

### Operator questions (each with a default; the pipeline can advance on the defaults)

1. **Who connects automatically?**
   - You asked that sign-in alone connect a person. I recommend that **visitors, people who hold a role or a Session or diaconate seat, anyone whose address is shared by two people, and anyone at two congregations are not connected automatically.** They use an invitation.
   - Reasons: a connection activates whatever the record already carries, with no sender to apply the "you can't lend authority you don't hold" rule. Without that rule, a clerk who can only edit people could hand Session authority to anyone who controls an address. Visitors would reach the member directory with nobody warned.
   - Alternatives: (a) connect those people too and accept the audit-only risk; (b) connect elders but not visitors. The Session hand-off from Increment 2 already gives elders a one-click invitation path.
2. **May `/no-organization` accept a founding-administrator or treasurer invitation without the emailed link?**
   - I recommend yes, but only once the sign-in proof in G10 lands in the same increment, with 2FA enforced and the audit stamped.
   - Fallback if you or the architect want the link to stay the only credential for authority-bearing invitations: Accept in place for `sign_in` invitations only, and an "Email me the link again" button for the other two.
3. **Reject a Google sign-in whose address Google reports as unverified?**
   - Today it is allowed, and with account-linking-by-email it can sign in as an existing account. I recommend refusing (fail closed). It is a rare case with a one-line "Google couldn't confirm that email" message on `/signin`.
4. **Disconnect after accept (your 2b ruling: "not yet").**
   - That ruling assumed a sender confirmed each connection. A connection by sign-in has no sender. I recommend keeping disconnect out of 2b but making it the first follow-up, because the connected population is authority-free and each connection needs the holder's own deliberate sign-in.
   - If you would rather ship disconnect with 2b, say so: it needs a definer, because the F186 trigger forbids clearing the link.

### Defaults applied without asking

- Match any active address of the person (not only the primary), exact on `lower(btrim)`.
- Connect only to `managed` organizations with a live membership.
- Open invitation takes precedence over auto-connect (FB5).
- Connect at sign-in (the `jwt()` first-sign-in branch, best-effort, errors swallowed) plus a **Check again** Server Action as the catch-up. No write during render.
- A does not wait for 2FA. B does (G9).
- Declines are silent and unaudited. Only connections are audited.
- No email is sent on connect. `verified_at` is stamped on the matched contact, as accept does.
- A per-organization on/off toggle is recommended as a Phase 3 input, in place of any new platform flag.
- No age gate (2b ruling stands). The shared-address refusal covers the child case.

### Out of scope (confirm)

- A registration form or any password self-signup.
- Disconnect or re-link (Q4).
- A `/home` card for a connected member's later designation (G17).
- Notifying the administrator or the person on connect (the card and the audit row update).
- Bulk connect, and any change to the DECISION-040 access-denied page.
- Markers on the Staff page.

### Measurements to take before the tech-lead (read-only, counts only, no addresses)

- On production and the pipeline branch: unlinked active users whose proven address matches exactly one eligible person, i.e. the deploy-day connection count (G20 c).
- Google-created users with a null `email_verified`.
- People holding an address shared with another live person.
- Seeded or e2e users whose email would auto-connect (G22).
- The current `users_email_lower_uq` precondition and the contact-method counts for the 0065 stop-blocks.

### Handoff

Next agent: **architect**, a short Phase 2 addendum (not a full review), on these:
- G13: the DECISION-216 and CLAUDE.md wording, and the scan-test boundary.
- G15: the token-less accept mode and the credential model.
- G10: the proof mechanism, including the `users.email_verified` guard trigger and the Google-claim stamping. This touches `src/auth.ts`, so the full-login e2e gate applies.
- G14: the second writer of `people.user_id` and the DECISION-208 text.
- G11: confirm the authority-free precondition and the shared eligibility core, so issue, resend and connect cannot drift.
- Whether the per-organization toggle is warranted.

Then the **tech-lead** folds the addendum and the reconciliation table into a single Phase 3 amendment. The orchestrator assigns the new DECISION and F numbers, confirms 0065, and puts the operator questions above to the operator. The orchestrator also asks the operator which reading of "the invite accepted" is right (premise check 4).

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| Inc 2b · 1 — Phase 1 addendum 2 (auto-connect, accept in place, reconciliation with v0.41–v0.42.2) | analyst | Complete. Gaps G10–G22 raised; no local self-registration exists and `email_verified` is unreliable; connection is not authority-neutral (restricted to authority-free, non-visitor, single-match persons); the contact-email invariant and the credential model need an architect addendum; a stale-design reconciliation table supplied; four operator questions with defaults; `/no-organization` copy for each state. | READY WITH NOTES | 2026-10-24 |

---

## Increment 2b — operator rulings on the Phase 1 addendum 2 questions (2026-10-24)

- **Q1, who auto-connects: "Also elders, not visitors"** (the operator chose against the analyst's default). Auto-connect also binds people who hold a role or a Session/diaconate seat. Visitors still need an invitation; shared addresses, two-congregation people, ended or merged records and already-linked records still decline. Accepted residual: a `people.manage` holder who types an address onto an authority-bearing record can bind that authority to whoever controls the address, with no sender ceiling, rate limit or confirm step; detected by audit (`tenant.person_email.*` then `tenant.person.sign_in_connected`), not prevented. `paper`. The architect addendum must address it (e.g. require 2FA before connecting an authority-bearing record, and stamp the audit row with what the record carried).
- **Q2, accept-in-place for founding administrator and treasurer: yes**, once address proof (G10) lands in the same increment, with two-step sign-in enforced and the acceptance audited as accepted on site.
- **Q3 (reject an unverified Google address) and Q4 (disconnect stays out of 2b, first follow-up):** not asked separately; the analyst's defaults stand.
- **Premise check 4 (the treasurer case), confirmed 2026-10-25: the invitation was accepted.** The analyst's other branch ("not `managed`") does not hold either. A read-only production check by the orchestrator (structural columns only, no names or addresses) found: the treasurer invitation (origin `platform`) accepted 2026-10-23 22:21 UTC; its person linked to the accepting account; account active; congregation `managed`; `presby_user_organizations` returns one open membership there; one grant on the person. The account existed before the invitation (password reset and TOTP enrolment earlier that day), and its audit trail shows `totp.verify_succeeded` at 22:16, then `invitation.accepted` and `org.treasurer.designated` at 22:21. The symptom was therefore the ~5-minute window in which a signed-in account had no connection and `/no-organization` gave no hint that a designation was waiting: the FB accept-in-place card's case, not a separate defect. No new finding.
