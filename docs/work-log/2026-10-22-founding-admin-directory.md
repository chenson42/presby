# Founding administrator cannot reach Add person on the Members page — Work Log

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
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |
| Inc 2 · 1 — Functional refinement | analyst | Complete; operator rulings Q1–Q3, Q6 recorded | READY WITH NOTES | 2026-10-22 |
| Inc 2 · 2 — Architectural review | architect | Complete. R1–R18; invites split to Increment 2b (R19–R26); migrations 0062/0063/0064; DECISION-202–208; F179–F191 | Approved with suggestions | 2026-10-22 |
| Inc 2 · 3 — Technical design | tech-lead | In progress | — | — |
| Inc 2b · 1 — Phase 1 addendum (sign-in invites) | analyst | In progress | — | — |

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

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

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
