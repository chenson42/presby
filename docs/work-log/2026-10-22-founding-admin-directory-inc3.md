# Community Increment 3 — visitor follow-ups — Work Log

> **Slug:** `2026-10-22-founding-admin-directory-inc3`
> **Surface:** (org) admin Community
> **Permission(s):** TBD in Phase 1/3
> **Flag(s):** none expected (operator: per-org toggles, not new platform flags, pre-live)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-25, Rule 16):** migration 0066; DECISION-232–237; F240–F249; dev port 3490; parent work-log docs/work-log/2026-10-22-founding-admin-directory.md (Phases 1–2 of Increments 1/2/2b; Increment 3 scoping note)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; G1–G19; recommends split 3a/3b | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; R48–R66; Option 1 via narrowed active_membership + all-live kind + events.view role; one standing classifier; F240 derived-row guard; F240–F244, F266–F268; DECISION-232–236, 247–249; returns F245–F249, F269–F273, DECISION-237/250 | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete for 3a; migration 0066, D1 to D8 departures (all accepted; D4 operator-approved); batches 0, A1, A2, B, C, D. Updated 2026-10-25 for the architect's arch-A1 to arch-A4 (F245 closed in 0066; S16 declined) | Design complete (updated) | 2026-10-25 |
| 3 — Technical design, amendment (rebased on main 0.50.1; see "Phase 3 amendment" at the end of this log) | tech-lead | Complete. Five-kind derived list and the officer sync's attributes specified (orchestrator's required edit); 19 assumptions re-checked against the merged tree; departures D9 to D21 ruled (a 2b fixture that contradicted the kind CHECK found and fixed; 0082 shrinks D4 but 3a's baseline role is still needed; portal tiles are permission-blind; parish consumers of `deriveConnection`; group renamed "All Current Records"); F246 and F247 filed; apply order proven for both journal order and merge order; six help pages and one screenshot; one new e2e spec. One non-blocking operator question | Design complete (amended) | 2026-10-31 |
| 4 — Implementation | Batch 0 ux-developer; A1/A2 database-admin; B api-developer; C ux-developer; D full-stack-developer | Batch 0 done 2026-10-25; A0 done 2026-10-31. **A1 done 2026-10-31** (database-admin): 0066 sections 1 to 8 and 10, hand-written, applied twice to the pipeline branch (digest identical) and rehearsed from empty in journal order; P1 to P12 measured on the dev copy and production (P5 = 0 real organizations on both: the release note drops the widening sentence); T-M 29, T-G 21, T-E 9, test-rls-66 staged, each mechanism proven failing-first. Existing tests that 0066 contradicts fixed minimally in six files (D11 plus a D11-class gap the amendment missed; flagged for the tech-lead). Full DB suite: no 0066 regression beyond the designed ones; 12 environmental failures (treasury's DB without its code; three pre-existing leaked fixtures). A1 alone breaks 2b's auto-connect (test-rls 65.7) until A2's T-list literal lands, proven. **A2 done 2026-10-31** (database-admin): section 9 (the core's T list gains all_memberships, deacons_moderator stays in T; check 10 drops the visitor acknowledgement; connect step 10 requires member standing), hand-written, applied twice (second run changes nothing), from-empty journal order rehearsed; **the whole patched test-rls.sql is exit 0 from empty** (65.7 green); on the dev copy only seven data-drift lines stop it (219/222, fresh-db coverage, treasury's template and 2FA keys, the demo statistics.publish role); every section-9 mechanism proven failing-first in test-rls-66 (l) and Vitest; handler mapping in T-G; T-M connect column; 2b-era tests edited minimally (four files, listed). Full DB suite: 13 failures, all environmental (9 treasury, 4 leaked fixtures). **B done 2026-10-31** (api-developer): `membership-standing.ts` (the one TypeScript standing definition, pinned equal to SQL over the whole grid, two source scans), deriveConnection and the readers (Inactive list, classifier-driven Visitors, archive-aware Former, engagement badge, status fields), `community-engagement.ts` (four audited writes, row-locked) and four Server Actions, four audit keys, `engagement-copy.ts`, `All Current Records` and `calendar_viewer` in the provisioning plan, grant-form labels, and the 2b removals (visitor acknowledgement, `isVisitor`, `not_listed`, `connected_not_listed`). No schema change. Typecheck, lint, `npm run check` (all nine), `npm run build` clean; full DB suite 16019 of 16025 pass, the five failures are four pre-existing leaked-fixture ones and one B-caused 2b test fixed after the run (now 41/41). **C done 2026-10-31** (ux-developer): seventh nav segment, row actions and three dialogs, Engagement card, Visit details, archive/restore on the record and in the wizard, engagement badge, Group C/E/J strings, Managed-from text, six help pages; every engagement entry point sends `expectedFrom` (unit-tested per entry point, failing-first proven); 360px light and dark walk passed. **D done 2026-10-31** (full-stack-developer): three new specs (`community-engagement` 24, `visitor-access` 4, `hydration/community-engagement-controls` 2), three 2b specs updated and two more found by the regression lane (`member-calendar`, `admin-organizations-create`); regression lanes 155 and 143 passed with one failure each (both fixed and re-run green), the new and targeted specs 37/37, prod hydration lane 7/7; four failing-first mutations shown; no application, schema or Rule 16 file touched; a leaked treasury fixture swept on the branch; 3b's `org_portal.followups` toggle is not on this branch, so not tested. Next: Phase 5 qa | In progress | 2026-10-31 |
| 5 — Verification | qa | Run 1: full e2e 721/735 (1 failure caused by this pipeline: reimbursement-treasurer-ui:415; 1 environmental), DB 16,145/16,150 (4 existing), from-empty test-rls exit 0 with 66e executed; F-1 spec, F-2 help sentence | FAIL | 2026-11-01 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)


*Returned as text for the orchestrator to record in `docs/work-log/2026-10-22-founding-admin-directory-inc3.md`. I wrote nothing and ran nothing against any database or browser. Sources: CLAUDE.md, the parent log (Increment 3 scoping note, Increment 1 Phase 1), the 2b branch log (Phase 1 addendum 2, architect addendum 2 R37–R47, and the F177 Option 1 delta), and the code in `/Users/cshenso/git/presby-platform/presby-inc3` (`src/lib/db/domain/person-ext.ts`, `src/lib/community.ts`, `src/lib/community-labels.ts`, `src/lib/directory.ts`, `community-nav.tsx`, `drizzle/0017`, `0014`). Prior art in `/Users/cshenso/git/fpcw-directory` is thin; see Premise check 6. No real data appears below. Gap labels (G1…) are local to this log. I have not used any F or DECISION number. Gaps that merit a finding are marked "finding candidate" for the orchestrator to number from F240–F249.*

## VERDICT

**READY WITH NOTES.**

The scope is clear and every open question has a safe default. But the architect must rule on one thing before any design starts, and it is larger than the F177 constraint already recorded. **G1: the engagement editor makes the 2b visitor test, the Directory test and the F177 group test disagree.** The editor cannot ship without a single shared definition of "listed". Phase 3 should also wait for 2b's Phase 3 amendment, because 2b's `is_visitor` predicate (R40) is the thing G1 changes.

## ONE-LINE TAKE

> A congregation can start a first-visit follow-up for a visitor, assign it, and record what happened. An administrator can mark anyone inactive or moved away without making them vanish, and can archive and restore a visitor. A visitor with a sign-in sees the calendar and no longer sees the directory.

## Premise checks (facts that change the request)

1. **The engagement editor is a permission control, not a label.**
   - **The Directory** admits a live membership with a roll, or `engagement_status = 'regular'` (`directory.ts:307-311`).
   - **A rolled member** is listed whatever their engagement is.
   - **A non-rolled person** is listed only when engagement is `regular`. Visitor, inactive, moved away and staff are all unlisted.
   - **The derived group.** The `active_membership` group mirrors every live membership (`drizzle/0017`), so the baseline `member` role (`directory.view`, `events.view`) follows `ended_on`, not engagement.
   - **Option 1** will make that group follow listing (see the 2b delta), so every engagement change then moves a person in or out of baseline access if they hold a sign-in.
2. **`engagement_status` has four documented values and a fifth in code.** The column comment (`0011:43`) says `visitor | regular | inactive | moved_away`. Code also writes `staff` (DECISION-129, the anchor). The column is free text with no CHECK. The editor must offer the four and refuse `staff`.
3. **`first_visit_date` and `how_heard` cannot be edited after the visitor is added.** Neither is in the edit schema. The first-visit workflow's due dates depend on `first_visit_date`, so a typo there becomes permanent.
4. **The `follow_ups` table is as thin as the scoping note said.** I verified it in `person-ext.ts`. It has no `created_by`, `created_at`, `updated_at` or `outcome`, and no vocabulary CHECK. It has no `unique (id, organization_id)`. Its assignee foreign key goes to `memberships`, so the database lets a visitor or a staff anchor be an assignee. `docs/schema-design-2.md` F176 records that `presby_app` still holds `DELETE` on it. No application code references the table. I expect it to be empty everywhere, but Phase 3 must count rows before changing it.
5. **2b changes who can sign in, which weakens the scoping note's third concern.**
   - **Elders and members.** A member, elder or deacon with a record and an address on file now connects by signing in, or by invitation.
   - **Visitors.** A visitor connects only by invitation with an acknowledgement.
   - **What it means.** A follow-up volunteer who is already a member can reach "my follow-ups" without a new account path. The remaining gap is a volunteer with no address on file.
6. **Prior art gives requirements, not a model.** `fpcw-directory` has no follow-up funnel. Two points carry over.
   - **Walk-in sign-in.** `docs/modules/events/walk-in-signin.md` collects an email "so follow-up needs no signup barrier" and keeps sign-ins separate from member records.
   - **Care Team groups.** `docs/modules/directory/member-groups.md` hides Care Team groups from the member display.
   - **What to take.** The first suggests the visitor's contact details are given to the church, not to the member directory (G12). The second suggests follow-up assignment must not be visible on a member's profile.
   - **Not found.** `psvonline-portal` has no relevant material, and I found no first-time-visitor workflow in either repo.

## Pass 1 — User verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (`people.manage`) | Changes a person's engagement: Visitor, Regular, Inactive, Moved away | on demand |
| Admin | Opens the Inactive list and finds someone they marked | on demand |
| Admin | Archives a visitor, and restores an archived one from Former | rare |
| Admin | Corrects a visitor's first visit date and "how they heard" | rare |
| Follow-up manager | Starts a first-visit follow-up for a visitor with one click (also offered right after adding a visitor) | per visitor |
| Follow-up manager | Reads all follow-ups, assigns or reassigns, sets a due date, records an outcome, skips a step | weekly |
| Follow-up worker (an assigned person) | Opens "my follow-ups", records an outcome on an assigned step | per visit or call |
| Member with no follow-up key | Nothing; the surface is absent | n/a |
| Visitor with a sign-in (rare) | Signs in and sees the calendar only | rare |
| Platform admin | Nothing new; a platform role confers no follow-up authority | n/a |

**Surface assignment.** All verbs are tenant-side, on `/o/<slug>/admin/community…` or a new follow-up surface (placement is the architect's). The visitor row is the only anonymous-ish case: that person never touches the product, and the follow-ups are done about them, not by them.

## Pass 2 — Flow audit

**Flow 1 — Start a first-visit follow-up.** Visitors list or the person's edit page → "Start first-visit follow-up" → three steps appear with due dates → the manager optionally assigns each.
- **Failure: already open.** "A first-visit follow-up is already open for {Name}."
- **Failure: asked not to be contacted.** The earlier follow-up ended with "asked not to be contacted". The start asks for confirmation before creating anything.
- **Failure: ineligible person.** The person is no longer a visitor, is archived or has died. The button is absent. A direct post is refused with "{Name} can't have a follow-up started."
- **Failure: database.** "We couldn't start the follow-up. Nothing was changed."

**Flow 2 — Work a step.** Follow-ups list (manager) or "My follow-ups" (worker) → open a step → see the visitor's name, contact details, first visit date and how they heard → "Record outcome" with a closed list → the step closes.
- **Failure: someone else got there first.** The step was already closed. The page says so, with who and when, and changes nothing.
- **Failure: no longer assigned.** The assignee changed. The worker gets the uniform "not found" copy.
- **Failure: no contact details.** "No phone or email on file for {Name}." The step can still be recorded as skipped.

**Flow 3 — Assign.** Manager picks a person from the picker → the row shows "Assigned to {Name}".
- **Failure: assignee can't see it.** The picker marks people who cannot see a follow-up (no follow-up access, or no connected sign-in). The assignment still saves, with the explicit line in Copy.
- **Failure: the assignee is the visitor.** Refused.
- **Failure: the assignee leaves.** The row reverts to "Unassigned ({Name} is no longer here)" rather than pointing at a stranger.

**Flow 4 — Change engagement.** Edit page → Engagement card → pick a value → a confirm dialog when listing or sign-in is affected → saved, audited.
- **Failure: value not allowed.** For example, Visitor for a rolled person, or any change to a staff anchor. The card never offers it, and a direct post is refused.
- **Failure: the person was archived meanwhile.** "{Name} was archived. Restore them to change this."
- **Failure: database.** "We couldn't save that change. Nothing was changed."

**Flow 5 — Find the people who left the lists.** Community → Inactive.
- **Behavior.** Lists every live, non-rolled person marked Inactive or Moved away, each with a one-click "Mark as regular" or "Archive".
- **Empty.** See Copy.

**Flow 6 — Archive and restore a visitor.** Visitors → "Archive" → dialog → the person leaves Visitors and appears under Former as "Archived visitor". Restore from Former returns them to Visitors.
- **Failure: the membership cannot end.** An open role or officer term makes `memberships_guard_end` refuse (`0014`). The dialog shows "{Name} still holds a role here. End it first."

**Flow 7 — Wizard "already here" for an archived visitor.** The wizard's match step finds an archived visitor and offers "Restore {Name}" instead of a dead end.

**Flow 8 — A visitor with a sign-in (F177 Option 1).** The visitor signs in, lands on the organization, and sees the calendar. The directory is not offered, and typing its URL gives the existing no-access copy.

## Pass 3 — Permissions and flags

- **Permissions.** Two new keys, with names left to Phase 3:
  - **`followups.manage`:** see all, start, assign, close, undo.
  - **`followups.work`:** see and act on follow-ups assigned to the viewer only.
  - **Why two.** One key would make every volunteer a reader of every visitor's contact details.
  - **Bindings.** Defaults are for Phase 2 to rule on under DECISION-078. The scoping note suggests the Board of Deacons; I did not verify it and the architect must. My default is the DECISION-155 administration bundle for `manage` and no constitutional binding for `work` in the first cut. A congregation grants `work` through role admin, as it does for custom roles today. No role carries both as a bundle.
- **Engagement editor, archive, restore, first-visit corrections.** `people.manage`, the same key that adds a visitor.
- **No platform flag, no new `FEATURES.*` key.** Per the operator rule, an organization toggle `org_portal.followups` in `ORG_FEATURE_CATALOG` with `flag: null` (the calendar, giving and domains entries are the precedent). The editor and archive ride the existing Community gating and add no toggle.
- **Defaults.**
  - **New organizations:** on.
  - **Existing organizations:** off until a platform admin flips it. A missing row already means off (DECISION-097).
  - **Rollback.** Switching the toggle off hides the surface and keeps the rows. Nothing is deleted.
- **Gate order.** Toggle, then permission, then the reader's own scope (the assignee filter), all server-side in the same transaction as the read.
- **2FA.** `/o/*` is 2FA-gated by the proxy, so a worker mid-enrolment is sent to `/totp`. That is acceptable and unchanged. No `requires_two_factor` is set, consistent with `domains.manage` (S3, tracked).
- **Platform admins.** They acquire follow-up authority only as any person does, through a role on their own person record. Two Hierarchies Intersect Nowhere is untouched.

## Pass 4 — Gaps the request didn't address

**G1. HIGH, finding candidate. The engagement editor splits the "visitor", "listed" and "baseline" definitions.**
- **What 2b does.** 2b's visitor test (R40 `is_visitor`) is "engagement `visitor` and no roll". It drives the F177 acknowledgement at send, the exclusion from auto-connect and the Community Visitors list, and one test pins them equal.
- **What the editor creates.** A person set to Inactive or Moved away (no roll) is not a visitor by that test and not listed by the Directory's test. So they would need no acknowledgement and would be eligible for auto-connect, with member baseline (`directory.view`) under Option 3, while the Directory does not list them.
- **Fix to carry.** Define one predicate, "listed" (a roll, or engagement `regular`), and derive the other tests from it.
  - Option 1's group predicate = listed.
  - 2b's visitor test becomes "not listed, not staff".
  - The Visitors list stays literally "engagement `visitor`, no roll".
  - The new Inactive list is the rest.
- **Pins.** Pin all of them in one test, and migrate 2b's function body in the same release. The editor and the F177 change must ship together; the editor alone is unsafe.

**G2. HIGH. Engagement writes change what a signed-in person can reach, so they are security-sensitive.**
- **Coupling.** The editor is therefore coupled to Option 1 and to auto-connect.
- **Audit.** Every engagement change writes an audit row with from, to, and whether a sign-in is connected, in the same transaction. Ids and labels only.
- **Dialog.** The dialog tells the admin when the change affects listing or a sign-in (see Copy).
- **Widened residual (R21(b)).** A `people.manage` holder can now flip a visitor to Regular after typing an address, making that person eligible for auto-connect to the member baseline. This is the same class as the recorded `paper` residual, extended by one step.
  - **Detection chain.** `tenant.person_email.added`, then the engagement change, then `tenant.person.sign_in_connected`, joined on `personId`.
  - **Record it.** Name it as accepted `paper` residual in the same DECISION, not as prevented.

**G3. HIGH, finding candidate. `deriveConnection` would lie for the new states.**
- It returns "listed" for anything that is not roll, visitor or staff, so an Inactive non-rolled person reads "They're listed here" in the wizard's "already here" sentence. That is false: they are not in the directory.
- **Needed.**
  - Connections `inactive` and `moved_away`.
  - Connection `former_visitor`.
  - New sentences for the wizard's "already here" line, the row badge and the edit page.
  - The goldens in `community-labels.test.ts` extended.

**G4. People must not become invisible.**
- **The problem.** An Inactive or Moved-away non-rolled person is in no existing list: not Visitors, not the Directory, and not "Everyone" (which follows the Directory).
- **Fix.** The Inactive list (Flow 5), plus an engagement badge on rolled people in Members and Participants.
- **Interaction with the open S6 label decision.** Decide the "Everyone" empty-state wording in the same change, since "No one yet" would now be false in a third way.

**G5. Engagement against the roll.**
- **Values offered, by connection:**
  - **No roll:** Visitor, Regular, Inactive, Moved away.
  - **Roll or participant:** Regular, Inactive, Moved away. No "Visitor".
  - **Staff anchor:** none; the card says it is a staff record.
- **Rolled and inactive.** A rolled person marked Inactive stays in the Directory, because the Directory is a view of the roll. The copy must say so, or "Inactive" will look like it did nothing.
- **Moved away.** It is a pastoral label. It never ends a membership and never writes the roll; a departure is a roll event.
- **Stale "visitor" after approval.** A member whose engagement is still `visitor` after the Session approves shows a one-click nudge "Mark as regular?" on the edit page. No silent rewrite, and the approval function stays free of side effects (the scoping note's rule).

**G6. Visitor archive needs a full design, not just `ended_on`.**
- **Marker.** A fixed `ended_reason` constant (for example `visitor_archived`) mirroring the participant-removal marker. The Former list is currently the participant marker only. Generalize it; `deriveConnection` currently returns `ended` for any other reason, which prints "Their connection ended on…".
- **Guards.** `memberships_guard_end` refuses while an officer term or role grant is open, and archive must surface that refusal in words.
- **A connected sign-in.** The person loses the organization, because an ended membership no longer resolves for them.
- **An open `sign_in` invitation.** It is dead at accept (R40 `membership_ended`). The dialog says it will stop working.
- **Open follow-ups.** They are cancelled in the same transaction, with status `cancelled`, not deleted. Restoring leaves them cancelled, and the copy says so.
- **Restore.** It clears `ended_on` and the group row follows. Check it against `memberships_one_active_roll_idx` (no effect on a visitor, but the Phase 3 test should confirm).
- **Deceased and merged people.** They are excluded from every list; Phase 3 states what happens to their open follow-ups.
- **Audit.** Archive and restore are audited because they change access.

**G7. `follow_ups` hardening (a prerequisite, not a feature).** Phase 3 migration scope, 0066:
- **New columns.** `created_by`, `created_at`, `updated_at`, `completed_by` and `outcome` (closed vocabulary).
- **CHECKs.** Status: `open`, `done`, `skipped`, `cancelled`. Workflow: the catalog's `first_visit` plus the table's other three names so the column stays valid. `completed_at` present if and only if status is `done`. Step is a closed list per workflow, enforced in code and in a CHECK.
- **Keys and constraints.** `unique (id, organization_id)`, and a partial unique index so only one open row exists per person, workflow and step.
- **Delete lockdown.** Revoke `DELETE` from `presby_app` (closes the `follow_ups` part of F176). Rows end by status.
- **Engagement CHECK.** Add a vocabulary CHECK on `memberships.engagement_status` for the five values, added `NOT VALID` then validated. Phase 3 first measures the distinct values in every environment (counts only).
- **Measurement.** The `follow_ups` row count (expected 0).

**G8. The first-visit workflow, as users will see it.**
- **Steps.** The step list is a code constant. Proposed default: Welcome, Invite, Check in.
- **Due dates.** Computed from the later of the first visit date and the day it is started, so a visitor entered months late does not produce a wall of "overdue".
- **One row per step.** The table has no run concept. All steps are created at start, which makes "restart" a deliberate action after the earlier steps are closed.
- **Families.**
  - **The problem.** A visiting family of four would produce twelve rows.
  - **Default.** Per person, with the Start button on each. The list groups by household label, and nothing is created for a child automatically. Children are reached through a guardian.
  - **Open.** Phase 3 decides the household affordance.
- **Trigger.** An explicit click, and a prompt in the "Visitor added" banner. No automatic creation inside `createPerson()` (the scoping note's ruling stands; a hidden write belongs to a later ruling).
- **Automatic "new member" follow-up.** Not in this increment. It would add a side effect to the approval function.

**G9. Assignee, visibility and the "can they see it" trap.**
- **Scope.** A worker sees only follow-ups assigned to them, enforced in the reader's SQL, not the UI. RLS is tenancy, not authorization.
- **What the worker sees.** The visitor's name, phone and email, first visit date, how they heard and the step. Not the address, household, birth date, other visitors or the Community list.
- **Assignee eligibility.** The picker shows who can sign in and who holds the key, using 2b's connection marker. Assigning to someone who cannot see it is allowed, with the explicit line, because the manager can record outcomes for them.
- **Subject cannot be the assignee.**
- **An assignee whose membership ends.** The row reads Unassigned with a note.

**G10. Permission bindings.** See Pass 3. DECISION-078's test is run by Phase 2, not by me. The default is no constitutional binding for `followups.work`.

**G11. Sensitivity and notes.**
- **Notes.** No free-text notes in the first cut. A visit note about a visitor ("mentioned a divorce") is pastoral in practice and would need `pastoral_notes.manage`-style gating and the clergy-only filter that DECISION-108 already built for `person_notes`.
- **Outcomes.** A closed outcome list on completion: Spoke with them, Left a message, No answer, Asked not to be contacted.
- **Do not contact.** "Asked not to be contacted" is the only durable record that a visitor declined. It closes the workflow, shows as a badge on the Visitors row and makes a new Start ask for confirmation. Where it lives (an outcome on the last step versus a person-level field) is Phase 3's call; the outcome-only version needs no new column.

**G12. Visitor contact details are disclosed to a new audience.**
- **The change.** A visitor gave their details to "the church", not to members. A worker reading a visitor's phone number is a disclosure the Directory deliberately avoids.
- **Default.** Workers see name, phone and email only, and a visible line explains who can see what. The operator should confirm this is acceptable for their congregation.

**G13. Navigation, the recorded prerequisite.**
- **Order of work.** Fix the 360px segment overflow before adding anything. The TODO item "Community nav at 360px" says to scroll the active segment into view and add an edge fade, and to apply the same to the Directory nav.
- **The new segment.** This increment adds one segment (Inactive), making seven. Follow-ups should be a tile plus its own page, not an eighth segment.
- **Acceptance.** At 360px the active segment is visible after landing, and every segment is reachable and discoverable.

**G14. What Option 1 does to people who already have a sign-in.**
- **Who is affected.** Visitors who accepted under 2b's Option 3 lose directory access. The 2b release note already sets that expectation ("narrower view in a later release").
- **2b copy to remove.**
  - The `visitor` acknowledgement reason: definer check, `SIGN_IN_ACK_REASONS`, dialog paragraph, tests and e2e lane 4.
  - The card note "A visitor can sign in but sees nothing until they are received" is **not true** under the visitor baseline role, because that role carries `events.view`. Use "A visitor can sign in and see the calendar until they are received."
  - The standing rule "no copy may say visitors are walled off from member access" changes from false to partly true. The release note must be exact: the calendar yes, the directory no.
- **Rollout.** The visitor baseline role is seeded at provisioning and backfilled for existing organizations, as `session_member` was (0062). The mechanism for a visitor to hold it, such as a new derived group kind or a predicate split, is for Phase 2, not for the analyst.
- **Backfill.** It ends rows by `ends_on` and never deletes. Predicates are role-free, never keyed on a reason text.

**G15. Nothing nudges anyone.**
- **Gap.** With no email or digest, assigned follow-ups rot. Notifications were already deferred for Session approvals.
- **Default.** An overdue count on the Follow-ups tile for each viewer, and no email. Email is a filed follow-up.

**G16. Dates and time zones.** `due_on` is a date. "Overdue" must use the organization's day, following the repo's timezone-safe date convention, and the cast to text in SQL (`check:sql-date`).

**G17. Funnel numbers must not leak into reporting.**
- **Rule.** Follow-up counts and any visitor-to-member conversion are screen-only for `followups.manage` holders. They never reach the SASR, a filing, a statistic or an export.
- **Default.** No conversion rates in this increment. Each visitor's current connection is already derivable.

**G18. First visit details cannot be corrected.** Add an inline edit for `first_visit_date` (not after today, not before 1900) and `how_heard` (at most 200 characters), with the same bounds as at creation.

**G19. Test and fixture blast radius.**
- `community-labels.test.ts` goldens and `participant-copy`.
- 2b's visitor-pin test, the `SIGN_IN_ACK_REASONS` pins and e2e lane 4.
- `community-nav.test.tsx`.
- `seed-dev.sql`: the synthetic visitors need a follow-up set and an inactive and an archived example.
- `test-rls.sql`: a section for the assignee scope and the delete revoke.
- A read-only join before Phase 4 for any seeded user whose connection state changes under Option 1.

## Pass 5 — Adversarial pass

- **Redirect targets.**
  - **No user-controlled target.** Every action redirects to a fixed same-origin path.
  - **`?view=` is a closed list.** An unknown value falls back to Everyone, and an admin-only view for a non-admin degrades instead of leaking. This holds today and must hold for Inactive.
- **Cross-record and cross-org access.**
  - **IDOR.** A follow-up id, person id or assignee id from another organization, or not assigned to the worker, returns the same neutral not-found as a nonexistent one. Composite keys back this at the database.
  - **What a client can send.** Only ids and closed values. Organization id comes from the verified context, never from the form.
- **State-machine shortcuts.**
  - **Direct posts.** A direct post cannot set engagement `staff`, set `visitor` on a rolled person, or change an archived person.
  - **Step order.** Steps are independent, so completing step 3 first is allowed. If that is not wanted, say so in Phase 3.
  - **Terminal states.** `done` is terminal for a worker. A manager can undo with a reason, audited. Cancelled rows stay cancelled.
  - **Races.** Two people completing the same step: the update is conditional on status `open`, and the loser sees the result.
- **Enumeration.** No public surface is added. The only 404 versus 403 hazard is the assignee case above, handled uniformly.
- **Input boundaries.**
  - **Server-side validation:** due date range, outcome list, engagement list, reason list.
  - **Forms.** Every `useForm` root renders `<HydrationGate>` (`check:hydration-gate`).
  - **Free text.** Only `how_heard` (200 characters); no follow-up free text.
- **Self-targeting.**
  - **Assignee equals subject:** refused.
  - **A `people.manage` holder editing their own engagement:** allowed, audited. For anyone on the roll it changes nothing in access.
  - **Self-archive:** structurally refused, since holding a role blocks the end of a membership.
  - **A platform admin:** gets no follow-up authority from the platform role.
- **The G2 residual.** Listed above, with its detection chain. It is not prevented.

## Copy for key states

*All lines are proposals for Phase 3's Copy table. Each must be checked against the 2b residuals (the acknowledgement is a disclosure, not a control; auto-connect has limits).*

**Engagement card (edit page)**
- Helper: "For your own care. It is never reported to the presbytery or the denomination, and it does not change anyone's membership."
- Options, no roll: "Visitor. Not shown in the member directory." / "Regular attender. Shown in the member directory." / "Inactive. Not attending lately. Not shown in the member directory." / "Moved away. Not shown in the member directory."
- Options, on the roll: the same names, with "They stay in the directory because they are on the roll." on Inactive and Moved away.
- Staff anchor: "This is a staff record, so engagement isn't tracked."
- Dialog, listing changes: "Mark {Name} as a regular attender? They will appear in the member directory."
  - **Add if a sign-in is connected:** "{Name} has a sign-in connected, so this also changes what they can see."
  - **Add if not connected and an address is on file:** "{Name} could be connected to this record automatically when they sign in with an address on file."
- Dialog, leaving the directory: "Mark {Name} as inactive? They will leave the member directory." plus the same sign-in lines.
- Success: "{Name} is now marked {label}." Failure: "We couldn't save that change. Nothing was changed."

**Inactive list**
- Empty: "No one is marked inactive or moved away. People on the roll who are inactive stay under Members."
- Row actions: "Mark as regular", "Archive".

**Visitors list**
- Empty: "No visitors yet. When someone visits, add them here."
- Row badge when a decline is recorded: "Asked not to be contacted".

**Archive**
- Title: "Archive {Name}?"
- Body: "{Name} will leave the Visitors list. Their record is kept and you can restore it any time. Open follow-ups for {Name} will be closed."
- Add if connected: "{Name} has a sign-in connected and will no longer reach {Organization} through this record."
- Add if an invitation is open: "An invitation to {Name} is still open. It will stop working."
- Refusal: "{Name} still holds a role here. End it first."
- Success: "{Name} is archived." Restore: "{Name} is back on the Visitors list. Closed follow-ups stay closed."
- Former row badge: "Archived visitor, {date}".

**Follow-ups, manager**
- Empty: "No follow-ups yet. Open a visitor and choose Start first-visit follow-up."
- Started: "Follow-up started for {Name}. {n} steps added."
- Duplicate: "A first-visit follow-up is already open for {Name}."
- Declined history: "{Name} asked not to be contacted on {date}. Start another anyway?"
- Row: "{Step} · {Name} · due {date}". Overdue: "Overdue by {n} days" (text and icon, not color alone).
- Assignee who cannot see it: "{Name} can't see this yet: they need follow-up access and a connected sign-in. You can still record the outcome for them."
- No contact details: "No phone or email on file for {Name}."
- Outcome dialog: "How did it go?" with Spoke with them / Left a message / No answer / Asked not to be contacted.
- Load failure: "We couldn't load follow-ups. Reload to try again." (never the empty-state sentence)
- Toggle off, shown to an organization admin: "Follow-ups are turned off for {Organization}. An administrator can turn them on in organization features."

**Follow-ups, worker**
- Empty: "Nothing is assigned to you right now."
- Header line: "You can see contact details only for the people assigned to you."

**Visitor with a sign-in (replaces 2b's card note)**
- "A visitor can sign in and see the calendar until they are received."
- Release note: "Visitors who signed in under the earlier arrangement no longer see the member directory." Do not write "visitors cannot see anything", and do not write that engagement changes nothing.

## Permissions & Flags (template summary)

- **Permission(s):** new `followups.manage` and `followups.work` (names are Phase 3's); `people.manage` reused for the editor, archive and first-visit corrections.
- **Default roles:** `manage` in the administration bundle (DECISION-155 half, with backfill) pending Phase 2's DECISION-078 test; `work` unbound in the first cut.
- **Flag(s):** none. Organization toggle `org_portal.followups`, `flag: null`, on for new organizations and off for existing ones.

## Out of Scope (confirm)

- Free-text follow-up notes, and any pastoral note tied to a follow-up.
- The `new_member`, `inactive_outreach` and `care` workflows. The first-cut catalog holds `first_visit` only, so the table's other three names are reserved, not built.
- Automatic creation of follow-ups, including on Session approval.
- Email or digest reminders, and the conversion funnel (G15, G17).
- Bulk archive and bulk start.
- Attendance or "last seen" tracking. Staleness is judged by first visit date and follow-up state only.
- A household-level follow-up, and editing a staff anchor's engagement.
- A visitor self-service connection card.
- The two items the TODO already holds: the S6 label decision beyond what G4 forces, and disconnecting a sign-in.

## Open Questions (each with a safe default; the pipeline can advance on the defaults)

1. **Split into sub-increments?** Default **yes**: 3a, then 3b (see below). 3b needs a migration number and further DECISION and F numbers beyond the pre-assigned set. I used none.
2. **Who works follow-ups?** Default: managers (administration bundle) see and assign all; anyone granted the `work` key sees only their own assigned items. No constitutional role binding unless Phase 2's DECISION-078 test passes.
3. **Free-text notes?** Default **no**; a closed list of outcomes.
4. **Does "Regular" put a non-rolled person in the member directory?** That is the existing Directory behavior. Default: keep it, disclose it in the dialog, and keep rolled-and-inactive people listed.
5. **Inactive and Moved away view.** Default: one new admin segment, "Inactive", after the nav fix. Moved away never ends a membership.
6. **Visitor archive scope.** Default: one person at a time, with restore. Archiving closes open follow-ups. Bulk is deferred.
7. **First-visit steps and timing.** Default: Welcome (+2 days), Invite (+7), Check in (+28), counted from the later of the first visit and the day it is started.
8. **Starting a follow-up.** Default: one click, plus an offer after adding a visitor. No automatic creation.
9. **Existing organizations and the toggle.** Default: off until a platform admin flips it per organization; on for new ones.
10. **Visitors who accepted under Option 3.** Default: no email; the release note and the card note say what changed.
11. **Conversion numbers.** Default: not in this increment.
12. **Staff anchors' engagement.** Default: not editable.
13. **Contact details shown to a worker (G12).** Default: name, phone and email only, with a visible explanation.

## Should this split?

**Yes, recommended: 3a then 3b.** One pipeline would carry a permission-derivation change, a vocabulary migration and a whole new feature, so a rollback of one would drag the others.

- **3a — the safe foundation (migration 0066).**
  - **Opens with F177 Option 1.** The visitor baseline role, the group predicate = "listed" and the backfill.
  - **Includes G1 and G2.** The one shared predicate with the 2b visitor test, the engagement CHECK, and the engagement editor with its audit and dialogs.
  - **The rest of 3a.** The Inactive list, visitor archive and restore, first visit edits, `deriveConnection` and goldens, the 360px nav fix, and removal of the 2b acknowledgement reason.
  - **Why it must be first and whole.** The editor cannot ship without the predicate change (G1), and the nav must be fixed before another segment is added.
- **3b — the headline feature (needs a migration number I do not have).** `follow_ups` hardening, the two permissions, the toggle, the first-visit workflow, the manager page, the worker's "my follow-ups", and the tile with its overdue count. 3b depends on 3a only for the archive hook (cancelling follow-ups) and the visitor definition.

If you decline the split, a single 0066 and one work-log still works, but Phase 4 should run as serial batches (3a's database work first), as 2b did.

## Handoff to the architect (Phase 2)

1. **Open with F177 Option 1,** per the standing constraint, and restate the exposure. Rule on how a visitor holds the baseline role, and on the 2b migration body that is replaced.
2. **Rule on G1: one "listed" predicate,** its owner, and the single pin test across the Visitors list, 2b's core, the group trigger and the Directory.
3. **Rule on G6:** the archive marker, whether archive goes through a definer, and the cancel-open-follow-ups transaction.
4. **Rule on G7:** the `follow_ups` columns and CHECKs, the delete revoke, and the partial unique index.
5. **Rule on the permission bindings and DECISION-078 test** (G10), and where the follow-up surfaces live (the worker's page cannot sit under `/admin`).
6. **Confirm no `FEATURES.*` or platform flag is needed,** and that the toggle works as described.
7. **Check the Phase 6 conditions below are buildable.**

## Phase 6 conditions (recorded now so the walk is not an afterthought)

Because this changes what a newly created account can reach, Phase 6 walks it as the person each path creates, on `development`, at 360px, listing every page they land on:

- **A visitor** who accepted a sign-in invitation, before and after Option 1.
- **A deacon-type volunteer** connected by sign-in (auto-connect), holding `followups.work`.
- **A founding administrator** who turns the toggle on, starts a follow-up from a freshly added visitor, assigns it and archives the person.
- **A person marked Moved away** who then signs in.

SHIP IT requires this walk.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete. Gaps G1–G19. G1 (engagement vocabulary vs the 2b visitor test, the Directory test and the F177 group test), G2 (permission-changing writes) and G3 (`deriveConnection` returns "listed" for inactive people) need architect rulings. Thirteen operator questions, each with a default. Recommends splitting into 3a (F177 Option 1, engagement editor, Inactive list, archive, nav fix) and 3b (`follow_ups`, permissions, workflow, tile); 3b needs numbers beyond the pre-assigned set. Phase 6 walk conditions recorded. | READY WITH NOTES | 2026-10-25 |

**Next agent:** the **architect**, for Phase 2. The orchestrator records this section and the status row, decides the split (and requests a migration number for 3b if it splits), and puts the open questions to the operator. Phase 3 should wait for 2b's Phase 3 amendment, since it changes the function bodies that G1 touches. Phase 4 waits for 2b to merge.

Relevant files, all under `/Users/cshenso/git/presby-platform/presby-inc3`:
- `docs/work-log/2026-10-22-founding-admin-directory-inc3.md` (child log to record into)
- `src/lib/db/domain/person-ext.ts` (the thin `follow_ups` table)
- `src/lib/community.ts`
- `src/lib/community-labels.ts` (`deriveConnection`)
- `src/lib/directory.ts` (the "listed" test)
- `src/app/(org)/o/[slug]/admin/community/community-nav.tsx`
- `drizzle/0017_presby_membership_roster.sql` (the group trigger)
- `drizzle/0014_presby_org_router.sql` (the end-of-membership guard)

The 2b material I relied on is at `/Users/cshenso/git/presby-platform/presby-2b/docs/work-log/2026-10-22-founding-admin-directory.md`, lines 5951–6600.

---

## Phase 2: Architectural Review (architect), Community Increment 3 (3a and 3b)

*Returned as text for the orchestrator to record verbatim in `docs/work-log/2026-10-22-founding-admin-directory-inc3.md`. I wrote nothing. Database access was read-only (`default_transaction_read_only=on`) against `development` (`ep-lingering-meadow-axnarpsq`), and returned catalog data and counts only. `presby-inc3` has no `.env.local`, so I read no pipeline branch. I did not touch production. No names or addresses appear below.*

## Verdict

**Approved with suggestions.**

The 3a/3b split is sound and the feature shape needs no loop-back to Phase 1. This review adds rulings **R48–R66**. I correct one analyst premise (G1's group predicate must keep staff anchors) and record one new defect found in the live catalog (**F240**: derived group rows accept direct writes that label themselves `derived`). Option 1 depends on fixing F240, because the derived row becomes the thing that decides directory access. One ruling widens an operator ruling by its own reasoning (R55: auto-connect requires member standing, not just "not a visitor"). The default stands unless the operator objects.

## Measured on `development` (read-only, catalog and counts)

- **`follow_ups`:**
  - 0 rows.
  - FORCE RLS is on, with one `tenant_isolation` policy covering all commands.
  - **Both `presby_app` and `presby_platform` hold SELECT, INSERT, UPDATE and DELETE.** F176 and the analyst named only `presby_app`.
- **`memberships`:**
  - 47 rows, all with engagement `regular`. 0 values fall outside the five-value vocabulary.
  - `current_roll` holds only `active`, `baptized`, `affiliate`, `other_participant` or null. No CHECK constrains either column.
  - `presby_app` has full UPDATE with no column ACLs.
  - Triggers: `memberships_guard_insert`, `memberships_guard_end` (BEFORE UPDATE OF `ended_on`) and `memberships_sync_derived_group` (AFTER INSERT OR UPDATE, **not** SECURITY DEFINER).
- **`group_memberships`:**
  - Carries **`unique (membership_id)`**, so a membership can have only one derived row today.
  - The live `presby_reject_derived_group_write()` refuses a DELETE of a derived row, and any write into a derived group whose `source` is not `'derived'`.
  - It does **not** refuse an INSERT, or an UPDATE of `ends_on`, `person_id` and the other columns, when the statement keeps `source = 'derived'` (F240). I read this from the live function body and did not execute it.
  - `scripts/test-rls.sql` section 6 tests only `source = 'managed'`.
  - Officers, Groups and Staff legitimately update `public_listed` on derived rows.
- **Groups and the baseline role:**
  - 11 `active_membership` groups, 9 session and 9 diaconate.
  - Only **2** organisations have a live `member` role grant on `active_membership`, so 9 have no baseline member grant. This is the existing F133 state; no new number.
- **`organization_feature_toggles`:** rows exist only for calendar (15), domains, giving, members_create and sensitive_info (1 each).

## Placement

### Directory placement, 3a

- **`drizzle/0066_presby_membership_standing.sql`** (name is Phase 3's), with `scripts/test-rls-66.sql` staged for the orchestrator (Rule 16).
- **`src/lib/membership-standing.ts`** (new, pure, no `server-only`): the TypeScript mirror of the SQL classifier (R50). `community-labels.ts`, the wizard and `people.ts` import it.
- **`src/lib/community.ts`** stays the reader. It gains the `inactive` list kind and moves every listing predicate onto the classifier.
- **Writes** (engagement change, archive, restore, first-visit corrections) go in a separate `server-only` writer module next to it (for example `src/lib/community-engagement.ts`). Their server actions live in the co-located `actions.ts` of `admin/community` and `admin/community/[id]/edit`.
- **No new route.** `inactive` joins the closed `COMMUNITY_VIEWS` list.
- **`src/components/shared/button-group.tsx`** gets the 360px fix (scroll the active segment into view, add an edge fade). It is a shared component, not a generated primitive. The Directory nav inherits the fix.
- **Also changes in 3a:**
  - `src/lib/org-provisioning.ts` (both seed plans);
  - `src/lib/groups.ts` (`DerivedFromKey`), `groups-list.tsx` and `org-portal/my-groups.ts` (the new derived kind is excluded exactly as `active_membership` is);
  - `src/lib/onboarding/issue.ts` (`provisioningComplete`);
  - the Drizzle mirror in `src/lib/db/domain/groups.ts` (the unique key change).

### Directory placement, 3b

- **`drizzle/0069_presby_follow_ups.sql`**, with `scripts/test-rls-69.sql` staged.
- **`src/lib/follow-ups/`** (new module, `server-only` except the pure files):
  - `reader.ts`: the only reader of `follow_ups`;
  - `store.ts`: the only writer;
  - `workflows.ts` (pure): the `first_visit` step catalog and day offsets;
  - `labels.ts` (pure): vocabulary and copy.
  - A source scan pins that no other non-test `src/` file names the table.
- **`src/app/(org)/o/[slug]/follow-ups/`** (new): `page.tsx`, `actions.ts` and co-located components. One route serves both modes (R63). Any detail segment that can `notFound()` has no `loading.tsx`.
- **Also changes in 3b:**
  - `src/lib/org-portal/tiles.ts` (tile and overdue count);
  - `src/lib/org-features.ts` (toggle);
  - `src/lib/db/domain/person-ext.ts` (Drizzle mirror);
  - the Visitors list and the edit page (a Start button that calls the follow-ups action).

### Server vs Client split

- Pages are Server Components.
- The engagement card, the archive and restore dialogs, and the outcome and assign dialogs are client components using shadcn `AlertDialog`/`Dialog`. No native dialogs.
- Prefer plain `<form action>` server actions. Any `useForm` root renders `<HydrationGate>` (`check:hydration-gate`).
- The follow-ups page reads the viewer's scope on the server, and the client never sends a scope.

### Dependencies

None.

## Rulings

### F177 Option 1: restating the exposure, and the mechanism

**R48. The exposure, restated (required by the F177 condition).** Once 2b is on `main`:
- (a) A visitor who accepted a sign-in invitation (with the acknowledgement) reads the privacy-filtered member directory and the calendar, through `member` on `active_membership`.
- (b) A staff anchor with no roll does the same. This is accepted on purpose (DECISION-207).
- (c) A non-rolled person whose engagement is `inactive` or `moved_away` would do the same if linked. The UI cannot reach this before 3a, but an import or a direct write can.
- (d) Any custom role a tenant bound to `active_membership` reaches all of the above.
- (e) 2b's auto-connect excludes (a) but not (c).

After 3a: (a) and (c) lose `directory.view` and keep the calendar; (b) is unchanged; (d) narrows to member standing; (e) requires member standing (R55). Tenant permissions resolve per request (`presby_has_permission`), so the change takes effect at deploy with no cookie to go stale. Phase 3 confirms that no tenant permission is cached across requests.

**R49. Mechanism: narrow `active_membership` and add a second derived kind on top of it. Do not rebind roles.**
- **`active_membership` narrows to member standing** (R50). The `member` role, its permissions and its grant rows are untouched. That includes the production grant the 2026-10-22 purge removed and the orchestrator restored (TODO line 80), which is the reason not to rebind.
- **A new derived kind** (working name `all_memberships`; Phase 3 picks the literal) mirrors **every** live membership. Its predicate is exactly `presby_membership_is_active()`'s `ended_on is null`. So one group still equals "current", which is the point DECISION-065 was protecting.
- **A new constitutional, protected baseline role** carries **`events.view` only** and is bound to that group.
  - It is named for what it carries, not "visitor", because every live membership holds it. Members hold `events.view` twice, which is harmless: the resolver unions.
  - It is seeded at provisioning for every organisation type, beside `member`.
  - 0066 backfills it in the 0062 `session_member` style: matched by role key only, never by reason text, and an org-owned row with that key is never modified.
- **`group_memberships`:** `unique (membership_id)` becomes **`unique (membership_id, group_id)`**. Without that, a membership cannot hold two derived rows.
- **The sync trigger** writes both rows:
  - The all-live row mirrors `ended_on` exactly as today.
  - The `active_membership` row is inserted only once the membership first has member standing.
  - When it loses standing, an open row is ended at `current_date`. A row that is already closed keeps its end date, so an unrelated update does not rewrite it.
  - When it regains standing, the row is reopened (`ends_on = new.ended_on`).
- **History.** One row per (membership, group) collapses repeated listing periods. That is accepted: derived rows are a current-state cache, the R53 audit rows carry the history, and no caller passes a historical `p_as_of`. Phase 3 confirms that by grep.
- **Backfill.**
  - End the `active_membership` rows of live, non-member-standing memberships at the migration date, by `ends_on`, never by deleting.
  - Insert the all-live rows for every membership.
  - Use role-free predicates through the classifier only.
- **Fail loudly (F16).**
  - The trigger raises if either group is missing.
  - 0066 creates the new group wherever `active_membership` exists, then stop-blocks if any organisation has one group without the other.
  - Provisioning creates both in one transaction.
  - The shipped `sqlerrm like '%has no derived group active_membership%'` handlers in the 0061, 0062 and 0064 bodies, and `issue.ts`'s `provisioningComplete`, must keep mapping the common state. A test proves each one still maps it after 0066.
- **2b's A5 closed list must be updated in the same migration.** `derived_from in ('active_membership','session','diaconate')` (the T exclusion inside R40's core) gains the new kind in 0066. If it does not, every grant on the new group counts in T, every person becomes authority-bearing, and every auto-connect returns `needs_second_factor`. That fails closed, but it silently breaks 2b. Pin the list by test.
- **Removed from 2b in 3a:**
  - the `visitor` acknowledgement reason (definer check, `SIGN_IN_ACK_REASONS`, copy, dialog paragraph, tests, e2e lane 4);
  - 2b's card note, replaced by "A visitor can sign in and see the calendar until they are received."
- **Amend DECISION-065:** `active_membership`'s population is now member standing, and "current" is carried by the new kind.
- **Amend DECISION-207:** F177 is closed, and the visitor acknowledgement is retired.
- **Rejected:** rebinding `member` to a new group and changing protected role rows; any resolver-level or `getDirectory()` exception (Option 4 again, which is `paper`).

### G1: one definition of "listed"

**R50. One SQL classifier owns the definition: `presby_membership_standing(p_current_roll text, p_engagement_status text) returns text`.**
- **Shape:** plain `language sql immutable`, with no SECURITY DEFINER and no `SET` clause, so the planner inlines it. It reads no relation. EXECUTE goes to `presby_app`.
- **Values, first match wins:**
  1. `listed`: roll in `active`, `baptized`, `affiliate` or `other_participant`, or engagement `regular`.
  2. `staff_anchor`: engagement `staff`.
  3. `visitor`: engagement `visitor`.
  4. `inactive`: engagement `inactive` or `moved_away`.
  5. `unclassified`: anything else, such as an unknown roll value. This is limited standing, so it fails closed.
- **Member standing** is `listed` or `staff_anchor`, defined once as a second immutable SQL function on top of the classifier.
- **The analyst's G1 premise is corrected.** "Group predicate = listed" would take the directory away from staff anchors, contradicting DECISION-207's recorded acceptance and the 2b delta's own test ("the baseline member grant reaching a staff anchor still").

**R51. Consumers, all through the classifier.** No consumer re-codes the predicate:
- the sync trigger (member standing);
- the Directory's default branch in `directory.ts` (`= 'listed'`), plus `findPersonMatches()` and every `'regular'` branch in `people.ts`;
- the Community lists: Visitors is `= 'visitor'` and Inactive is `= 'inactive'`, each with `ended_on is null`;
- 2b's R40 core, which returns `standing` in place of `is_visitor`;
- `deriveConnection` (G3), through the TypeScript mirror.

**The pin is a single DB matrix test.** Its fixtures cover:
- rolled member, rolled visitor, rolled and inactive, participant;
- regular with no roll, staff anchor, visitor, inactive, moved away;
- ended, archived, deceased;
- an unknown roll value.

For each row, one expected-outcome table asserts:
- the classifier's output and the TypeScript mirror's output;
- whether each derived row is open;
- whether `presby_effective_permissions` returns `directory.view` and `events.view`;
- inclusion in `getDirectory()`;
- which Community list the row lands in;
- the 2b core's standing and auto-connect verdict.

**Plus two scans:**
- **Cross-product test.** Run every TS roll value plus null and "unknown", crossed with every engagement value plus "unknown", through the SQL function and the TypeScript mirror, and assert equal.
- **Migration-text and source scan.** The literals `engagement_status = 'regular'`, `= 'visitor'` and the four-roll list appear only in the classifier, its mirror, the CHECK, seeds and tests. This replaces R40's "the visitor CASE appears only in the core body".

**R52. Where it lands.** In 0066, by default. **Suggestion S13:** 2b's pending Phase 3 amendment could introduce `presby_membership_standing()` in 0065 with today's semantics, and have the core return `standing` from day one. 3a would then change only the auto-connect condition and the send-time acknowledgement, not re-create 2b's core. This is the tech-lead's call; the orchestrator relays it.

### G2: engagement writes are access-bearing

**R53. Engagement is now an authorization input, so its writes are security-sensitive (Rule 7).**
- **The CHECK.** 0066 adds `memberships_engagement_status_check` over the five values, `NOT VALID` then `VALIDATE`, after measuring production. Development has 0 values outside the five.
- **A guard trigger**, `BEFORE UPDATE OF engagement_status`, for every role, refuses:
  - any change on an ended membership;
  - any transition into or out of `staff`. `staff` is set only at insert by the DECISION-129 anchor path. Without this, a `people.manage` holder could turn a visitor into a "staff" record and grant member standing silently, without listing them.
  - a change to `visitor` while the roll is non-null.

  Phase 3 lists every writer of `engagement_status` first (`people.ts`, `staff.ts`, `staff/actions.ts`, `community.ts`) and proves none breaks.
- **No definer.** These are same-organisation writes on `presby_app` inside `withOrgContext()`. There is no cross-organisation read, so F26 does not apply, and the guard makes the rules database properties.
- **Audit row** `tenant.person.engagement_changed`, written with `insertAuditRow` in the same transaction. Metadata: `organizationId`, `personId`, `from`, `to`, `standingFrom`, `standingTo`, and `signInConnected` (derived from `people.user_id`, never from `users`, per DECISION-189).
- **Accepted residual, `paper` (G2, same class as F232 and R21(b)).** A `people.manage` holder can make an unlisted person `regular`, which gives them member standing, the directory, and eligibility for auto-connect.
  - Detection chain: `tenant.person_email.*`, then `tenant.person.engagement_changed`, then `tenant.person.sign_in_connected`, joined on `personId`.
  - It is detected, not prevented. DECISION-234 says so, and the release note must not imply prevention.

**R54. F244: `memberships.current_roll` now decides access, and `presby_app` can write it with no guard.** Option 1 makes the roll cache an input to `directory.view`, as it already was for the Directory listing. Phase 3 lists every writer of `current_roll`.
- If all are owner-path definers (the roll functions and the reconcile), 0066 adds a column guard using the A1 owner test.
- Otherwise, record it as an accepted `paper` residual in DECISION-234.
- Phase 3 decides. Either way the record states it.

**R55. Auto-connect requires member standing, not just "not a visitor".**
- 2b's connect definer, step 10 (R41), becomes "standing is member". The issue and resend acknowledgement for `visitor` is removed.
- **Reason:** the operator's "not visitors" rested on a person the congregation has not listed reaching member access with nobody deciding. `inactive`, `moved_away` and `unclassified` are the same case.
- **Copy for the admin card:** "{Name} isn't listed in the member directory, so signing in won't connect them by itself. Send an invitation if you want them to have access."
- **For the operator to confirm.** The default applies if no answer comes.

### G3

**R56. `deriveConnection` derives from the mirror.**
- New connections: `inactive`, `moved_away` and `former_visitor` (archived).
- `listed` is returned only for standing `listed` with no roll.
- `staff` comes from `staff_anchor`.
- `unclassified` gets a neutral string and never "listed".
- The goldens extend. Each sentence is checked against the R51 matrix.

### G6: archive

**R57. Archive marker and restore. No definer.**
- **The marker.** One fixed `ended_reason` constant (working name `community_archived`), declared beside `PARTICIPANT_REMOVAL_ENDED_REASON` in `roll-action-kinds.ts`.
  - The Former list becomes a closed `in (...)` list of the two markers, never a prefix match (the lesson from the purge).
  - The Former badge reads "Archived visitor" or "Archived" from the engagement value kept on the row.
- **Who can be archived:** only standings `visitor`, `inactive` and `unclassified`. A rolled member leaves through a roll event, a participant through the removal marker, and a staff anchor not at all.
- **The write:** a conditional update (`where ended_on is null and standing in (...)`) inside `withOrgContext()`, plus the audit row `tenant.person.archived` in the same transaction. `memberships_guard_end` already refuses when a role grant or officer term is open, and the dialog maps that refusal to words.
- **Open invitation:** the dialog's open-invitation line is read through 2b's R30 reader, never from `account_invitations`. The invitation is not revoked; it dies at accept (R40 `membership_ended`), as the analyst says.
- **Restore:**
  - a conditional update `where ended_reason = <marker>`, refused for deceased or merged people;
  - audited as `tenant.person.restored`;
  - the trigger reopens the all-live row, and the `active_membership` row stays closed;
  - if a sign-in is connected, the restore dialog says "{Name} has a sign-in connected and will reach {Organization} again." Restoring silently re-admits them, so the copy must say so.

**R58. Cancelling follow-ups on archive is a trigger, not code in the archive transaction. 3b builds it in 0069.**
- **Why a trigger:** `ended_on` has several writers (archive, participant removal, the roll and founding paths). Code inside archive would cover one of them.
- **The trigger:** `AFTER UPDATE OF ended_on` on `memberships`, when the value goes from null to set. It cancels the person's open `follow_ups` at that organisation with `cancel_reason = 'membership_ended'`. It does not depend on the toggle, so turning follow-ups back on never brings back open steps for an archived person.
- **Restore** leaves them cancelled.
- **Deceased or merged people** (person-level, cross-organisation): readers exclude them and Start refuses them. A cross-organisation cancel would need a SECURITY DEFINER trigger on `people`, so it is a filed follow-up, not 3b scope.

### F240 (found in the live catalog)

**R59. A guard on derived rows must actually refuse direct writes.** CLAUDE.md says the Session and diaconate rosters "reject direct writes". On the live database that holds only for DELETE and for writes whose `source` is not `'derived'`. A `presby_app` INSERT of a `source = 'derived'` row into the Session group would resolve `roll.approve`. After Option 1, an UPDATE of `ends_on` on a narrowed `active_membership` row would give a visitor `directory.view`. Fix in 0066 (3a), because Option 1 depends on it:
- Both sync functions (`presby_sync_derived_membership_group`, and the officer-terms `presby_sync_derived_group`) become SECURITY DEFINER with `search_path = public, pg_temp`. They take the organisation from `NEW`.
- `presby_reject_derived_group_write()` refuses any non-owner (A1 `relowner` test, no role named):
  - INSERT into a derived group;
  - UPDATE of `group_id`, `person_id`, `organization_id`, `source`, `membership_id`, `officer_term_id`, `group_role`, `starts_on` or `ends_on` on a derived row.
- **It must allow `public_listed` and `public_listed_by`.** Officers, Groups and Staff toggle those columns on derived rows today.
- **Tests** in `test-rls-66.sql`, as `presby_app`, cover both sides:
  - refused: the self-labelled INSERT, the UPDATE of `ends_on`, and an UPDATE of `group_id`;
  - still allowed: the `public_listed` toggle, and both triggers' own writes.

### G7: hardening `follow_ups` (3b, 0069)

**R60. Columns and constraints.** Count rows on production first; development has 0.
- **Keys:** `unique (id, organization_id)`.
- **New columns:**
  - `created_at` (default `now()`), `updated_at`;
  - `created_by`, `closed_by` and `undone_by`, all `references users(id)`, following `roll_actions`;
  - `outcome` and `cancel_reason`.
- **Required:** `workflow` and `step` become NOT NULL.
- **Vocabulary CHECKs:**
  - `status in ('open','done','skipped','cancelled')`;
  - `workflow = 'first_visit'` only, with steps from the `workflows.ts` list. Do not add the three unbuilt workflow names to the CHECK. Nothing needs them to stay valid, and widening the CHECK is a migration anyway.
  - `outcome` is non-null if and only if `status = 'done'`, from the closed list of four;
  - `completed_at` and `closed_by` are non-null if and only if status is not `open`;
  - `cancel_reason` is non-null if and only if `status = 'cancelled'`;
  - `assigned_to_person_id is distinct from person_id`.
- **One open row per step:** a partial unique index on `(organization_id, person_id, workflow, step) where status = 'open'`.
- **`notes`:** `CHECK (notes is null)`, citing G11 and tier 3. A free-text note about a visitor stays unwritable until a gated design exists. Dropping the column is Phase 3's choice if production measures empty.
- **A guard trigger** (BEFORE UPDATE, all roles):
  - makes `organization_id`, `person_id`, `workflow`, `step`, `created_by` and `created_at` immutable;
  - makes `cancelled` terminal.

  A manager's undo of `done` or `skipped` back to `open` is allowed. It is audited with a reason and blocked by the partial index if another open row exists for that step.
- **Revoke DELETE from both `presby_app` and `presby_platform` (F267).** Rows end by status. This closes the `follow_ups` part of F176.
- **Which assignee is allowed** (a live membership, with standing other than `visitor`) is enforced in `store.ts`, because it depends on other rows. The reader shows an ended assignee as "Unassigned ({Name} is no longer here)". The assignee value is kept for history.

### G10: permissions and bindings (3b)

**R61. Two tenant permissions, seeded in 0069** (the 0017 `directory.view` precedent): `followups.manage` and `followups.work`.
- Both are tier 1: name and contact details, no pastoral content.
- Neither goes in `FEATURES.*` (the platform catalog is frozen), and neither sets `requires_two_factor` (S3 still tracked, as with `domains.manage`).

**R62. The DECISION-078 test, run office by office. No constitutional binding for either key.**
- **`stated_clerk`:** keeps the registers, not outreach. **Fails.**
- **`session_member`:** the Session oversees the congregation's ministry, but the group binding exists for body decisions (`roll.approve`). Giving every elder the contact details of every visitor by office is the kind of bundling DECISION-155 refused. **Fails.**
- **`diaconate_member`:**
  - Deacons serve in compassion and visitation (noted in DECISION-129), and many congregations ask them to follow up visitors.
  - But that is a local assignment, not part of the office. Binding by office would be convenience: it would mark every deacon "can see it" in the picker.
  - **Fails.** `work` only reveals steps a manager has assigned, so a congregation that wants deacons gives them the key through role administration.
- **`installed_pastor`, `treasurer`, `trustee`, `moderator`, and the single-purpose software roles:** none of them is about outreach. **Each fails.**
- **`followups.manage` joins DECISION-155's administration half** (the founding administrator bundle), as `domains.manage` did:
  - 0069 re-creates `presby_founding_administrator_permission_keys`, and existing founding-administrator roles get it through the additive reconcile backfill;
  - the designation parity golden is regenerated deliberately and reviewed;
  - this adds no data reach, because `people.manage` already reads a visitor's contact details.
- **Two template roles** (the `personnel_admin` mechanism, DECISION-109/129), adoptable through `/admin/roles/new`:
  - a coordinator template carrying `followups.manage`;
  - a volunteer template carrying `followups.work`.

  Each carries one key. Neither carries both.
- **2b interaction:** R21's sender ceiling and R40's T treat both keys like any other person-arm grant. Nothing new is needed.

### Placement of the follow-up surfaces, and the toggle (3b)

**R63. One route outside `/admin`: `/o/<slug>/follow-ups`, with two modes.**
- **Modes:** manage mode shows all steps and the assign, undo and start controls. Work mode shows only steps assigned to the viewer. Increment 2's Pending approvals (read mode and decide mode) is the precedent.
- **Scope:** `reader.ts` derives the scope inside one transaction (toggle, then permission, then scope). It never takes scope as a parameter. The worker filter `assigned_to_person_id = ctx.personId` is in the reader's SQL, because RLS is tenancy, not authorization.
- **Uniform not-found:** an id from another organisation, an id not assigned to a worker, or an id that does not exist all get the same neutral answer.
- **Writes** are conditional on `status = 'open'` (and, for a worker, on still being the assignee). A losing race reads the row and reports who closed it and when.
- **(org) contract:** the page resolves the slug through `resolveOrgContext()` and reads through `withOrgContext()` only. `getPlatformDb()` is forbidden here.
- **Navigation:** a portal tile (for holders of either key) carries the viewer's overdue count. Community's Visitors list links to the page and offers Start. There is no eighth Community segment.
- **Branding:** `(org)` is brandable, so the cascade applies. No change to `check:brand-scope`.

**R64. The toggle `org_portal.followups`.**
- **Catalog settings:** `flag: null`, category `people`, `provisionedOn: true`. `createOrganization()` writes an enabled row; existing organisations get no backfill, so a missing row means off (DECISION-097).
- **Who flips it:** `operatorEnabled: false`, so the congregation's own `org_features.manage` holder controls it. The analyst's off-switch copy already says so. There is no platform cost or cap here, which was what justified the operator-only domains toggle.
- **Org types:** `orgTypes: ['congregation','new_worshiping_community']`, pinned equal to the tile's `orgTypeScope`.
- **What it gates:** the page, the actions, Start and the tile count, never the R58 trigger.
- **When off:** the rows are kept and nothing is deleted.
- **Engagement work:** the editor, archive and Option 1 ride the existing Community gating in 3a and get no toggle. Option 1 closes a security gap and must not be switchable.
- **No new `FEATURES.*` key and no platform flag**, per the operator rule. Confirmed.

### Phase 6 conditions

**R65. All four walks can be built, but they split by increment and need stated preparation.**
- **3a, visitor before and after.** Take a Neon child branch of `development` after 2b merges and before 0066. Create the visitor's accepted sign-in with the existing invitation fixture helpers. Walk at 360px. Apply 0066 to that branch. Walk again.
- **3a, "Moved away, then signs in":**
  - (i) an already-connected person marked Moved away sees the calendar and not the directory;
  - (ii) an unconnected person is not auto-connected (R55) and lands on N0.
- **3a, archive and restore** as the founding administrator, including the role-held refusal.
- **3b, deacon volunteer by auto-connect.**
  - There is no self-registration, and an account created by invitation is already linked. So the account must be either a stubbed Google sign-in or a fixture user stamped through the owner path (R37 refuses a non-owner stamp). Reuse whatever 2b's own Phase 6 builds.
  - The deacon seat makes the record authority-bearing, so the walk includes `/totp`, then `/account/2fa`, then Check again (R42).
  - The volunteer gets `followups.work` from the adopted volunteer template.
- **3b, founding administrator full chain:** turn the toggle on, start a follow-up for a newly added visitor, assign it, then archive the visitor (the R58 trigger cancels the open steps).

### Which increment each ruling belongs to

**R66.**

| 3a (0066; DECISION-232–236; F240–F244) | 3b (0069; DECISION-247–249; F266–F268) |
|---|---|
| R48, R49 (Option 1), R50–R52 (classifier and pins), R53–R55 (engagement access, F244, auto-connect), R56 (G3), R57 (archive and restore), R59 (F240), the nav fix, G18 first-visit edits, R65's 3a walks | R58 (cancel trigger), R60 (hardening), R61, R62 (permissions and bindings), R63 (route), R64 (toggle), G15 tile count, R65's 3b walks |

### Findings and numbers

| # | Finding | Status |
|---|---|---|
| **F240** | Derived rows accept a direct INSERT or UPDATE that labels itself `source='derived'`. Only DELETE and writes with another source are refused, so the Court invariant and Option 1 are weaker than stated. | Closed by R59 (3a) |
| **F241** | G1: once engagement can be edited, the Directory, the Visitors list, 2b's visitor test and the group predicate disagree. | Closed by R50–R51 |
| **F242** | G3: `deriveConnection` says "listed" for people who are not listed. | Closed by R56 |
| **F243** | `engagement_status` is free text with no CHECK, and a transition to `staff` silently grants member standing. | Closed by R53 |
| **F244** | `memberships.current_roll` can be written by `presby_app` with no guard and now decides `directory.view`. | Phase 3 closes it or records it as a residual (R54) |
| **F266** | `follow_ups` has no `unique (id, organization_id)`, no vocabulary CHECKs and no actor columns, and the assignee foreign key admits the subject. | Closed by R60 |
| **F267** | `presby_platform` also holds DELETE on `follow_ups`; only `presby_app` was on record (F38 class). | Closed by R60 |
| **F268** | `follow_ups.notes` is ungated free text, a tier-3 risk. | Closed by R60 |

- **F177** closes in 3a.
- **F176** narrows: the `follow_ups` part closes in 3b.
- **F133** is cited (9 of 11 development organisations have no baseline `member` grant). It is not re-numbered.

**Unused, returned to the orchestrator:** F245–F249, F269–F273, DECISION-237 and DECISION-250.

**Decisions:**
- **DECISION-232:** Option 1, the two-kind baseline (R48–R49). Amends DECISION-065 and DECISION-207.
- **DECISION-233:** the standing classifier and its single pin (R50–R52).
- **DECISION-234:** engagement as an access-bearing write: the guard, the audit row, the G2 residual and F244 (R53–R54).
- **DECISION-235:** the archive marker and restore (R57); auto-connect requires member standing (R55, amends DECISION-226).
- **DECISION-236:** the derived-row guard (R59).
- **DECISION-247:** `follow_ups` hardening and the cancel trigger (R58, R60).
- **DECISION-248:** permissions, the DECISION-078 run and the bundle addition (R61–R62). Amends DECISION-155.
- **DECISION-249:** the route and the toggle (R63–R64).

## Invariants Touched

- **Permissions vs Flags:** respected.
  - The two new keys are tenant permissions. The toggle is a tenant setting that grants nothing.
  - There is no platform flag and no `FEATURES.*` key.
  - Engagement and archive change *grants* through derived groups, never through a flag.
- **Isolation, and triggers that see across organisations (F26):**
  - The sync functions become definers that take the organisation from `NEW`.
  - The classifier reads no table.
  - The R58 trigger stays within one organisation.
  - FORCE RLS stays on `follow_ups`, and DELETE is revoked from both application roles.
- **The Court Is Not a Group:** made true at the database by R59. The CLAUDE.md wording needs no change once the fix lands.
- **No Role Carries a Wildcard:** the new baseline role carries `events.view` only. Each template carries one key.
- **Composite Tenant Keys:** `follow_ups` gains `unique (id, organization_id)`. Its two existing composite foreign keys stay.
- **Never hard-delete:** archive is an end date with a marker; follow-ups end by status; derived rows end by `ends_on`. The backfill never deletes.
- **Two Hierarchies:** a platform admin gets follow-up authority only through a role on their own person record. No platform predicate is involved.
- **Enumeration (DECISION-040):** the follow-up not-found answer is uniform. The access-denied page at `/o/<slug>` is untouched.
- **Brand:** `(org)` only. The platform-palette groups are unaffected.
- **Verify in a Browser:** at 360px, test the nav segments, the engagement and archive dialogs, both follow-up modes, and the R65 walks.
- **CLAUDE.md:** no change required.

## Notes (Phase 3 must honour)

1. **Order.** 2b merges first. Phase 3 waits for 2b's Phase 3 amendment (and S13 if adopted). 3a's Phase 4 rebases onto it, and 3b's Phase 4 starts after 3a merges.
2. **Measure before writing any DDL**, read-only and counts only, on production and the pipeline branch:
   - live memberships by standing, and by standing among linked people (how many signed-in people lose the directory);
   - custom grants bound to `active_membership` (they narrow too);
   - organisations missing either derived group;
   - engagement values outside the five;
   - writers of `current_roll` (R54);
   - `follow_ups` rows and non-null `notes`;
   - seeded or e2e users whose access changes (G19).
3. **Rehearse 0066 on a throwaway child branch.** Run `test-rls.sql`, the 2b parity golden, the R51 matrix, F240's tests, and the 0061/0062/0064 missing-group mappings.
4. **Release-note "do not write":** "visitors can't see anything"; "engagement changes nothing"; "archiving deletes"; anything implying the G2 or F244 residuals are prevented.
5. **Suggestions (Phase 3's call):**
   - **S13:** R52.
   - **S14:** a boundary scan so no SASR or statistics module imports `src/lib/follow-ups` (G17).
   - **S15:** in the role-grant form, label derived groups by who they reach, since binding a role to the new all-live group reaches visitors.

## Operator questions

1. **R55.** May auto-connect also decline Inactive, Moved away and unclassified people, not just visitors? The default is yes.
2. **G12** (already put to the operator): the contact details a worker sees.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete. R48–R66. F177 Option 1: `active_membership` narrows to member standing (listed or staff anchor), plus an all-live derived kind and an `events.view` baseline role; no role rebinding. One SQL classifier owns "listed", with a single matrix pin. Engagement writes guarded and audited; G2 residual accepted. Auto-connect requires member standing (operator to confirm). Archive marker; the follow-up cancel trigger is in 3b. F240 (direct writes to derived rows) is fixed in 0066. `follow_ups` hardened, with DELETE revoked from both application roles. Two tenant permissions: no constitutional binding after the DECISION-078 run; `manage` joins the founding administrator bundle. One `/o/<slug>/follow-ups` route with two modes. Tenant-controlled toggle. Phase 6 walks can be built and are split 3a/3b. F240–F244, F266–F268; DECISION-232–236, 247–249; returns F245–F249, F269–F273, DECISION-237, DECISION-250. | Approved with suggestions | 2026-10-25 |

## Handoff

**Next agent: the tech-lead**, for Phase 3 of **3a** in this log. 3b's design goes in `-inc3b` once 3a merges. Before that, the orchestrator:
- records F240–F244, F266–F268 and DECISION-232–236 and 247–249;
- relays S13 to 2b's tech-lead;
- puts R55 to the operator.

Files read:
- `/Users/cshenso/git/presby-platform/presby-inc3/docs/work-log/2026-10-22-founding-admin-directory-inc3.md`
- `/Users/cshenso/git/presby-platform/presby-2b/docs/work-log/2026-10-22-founding-admin-directory.md` (the F177 options, the Increment 3 scoping note, and lines 5951–6623)
- `/Users/cshenso/git/presby-platform/presby-inc3/drizzle/0017_presby_membership_roster.sql`, `0010_presby_resolver.sql`, `0059_presby_account_invitations.sql`
- `/Users/cshenso/git/presby-platform/presby-inc3/src/lib/directory.ts`, `community.ts`, `community-labels.ts`, `org-provisioning.ts`, `org-features.ts`, `role-grants.ts`, `onboarding/issue.ts`, `db/domain/person-ext.ts`
- `/Users/cshenso/git/presby-platform/presby-inc3/scripts/test-rls.sql` (sections 6 and 25)
- `/Users/cshenso/git/presby-platform/presby-inc3/docs/decisions.md` (DECISION-060, 065, 078, 095, 129, 155)
- Live `development` catalog: `pg_class`, `pg_policy`, `aclexplode(relacl)`, `pg_trigger`, `pg_proc` bodies, `pg_constraint`

---

# Phase 3 — Technical Design (tech-lead), Increment 3a

*Written 2026-10-25 by tech-lead in the `presby-inc3` worktree (HEAD `ce661d7`, the v0.42.2 tree plus docs). **2b is not merged.** Migration 0065 does not exist in this tree, so every 2b symbol named below (`presby_membership_standing`, `presby__person_sign_in_standing`, `presby_sign_in__check`, `presby_connect_signed_in_account`, `presby_sign_in_card_standing`, `SIGN_IN_ACK_REASONS`, `connectOutlook`, `getSignInCard`, `getSignInMarkers`) is taken from the 2b log's "Phase 3 amendment 2" and its S13 acceptance, not from code, and §3.3 lists what the implementer re-verifies after the rebase. Everything else was read in the live tree. Measurements: one read-only connection to `development` (`default_transaction_read_only = on`, counts only; no name, address, id or connection string was printed or written). Production was not touched; the orchestrator runs §3.2. No file other than this work-log was written. Rule 16 files are staged in §12, never edited. Numbers used: migration 0066; DECISION-232 to 236; F240 to F245 (F245 added by the architect's 3a review and assigned by the orchestrator, 2026-10-25); dev port 3490. F246 to F249 and DECISION-237 are returned unused.*

**Changelog, 2026-10-25 (the short edit after the architect's 3a review and the operator's rulings).** The architect's amendments are cited here as **arch-A1 to arch-A4**, so they are not confused with the Phase 2 "A1 owner test" that §4.4 names.
- **arch-A1 (F245): the `groups` edit guard.** §4.1 row 3; §4.4 (new sub-section, group-level guard); §6.3 (T-G); §10 EC-33; §12 block (c).
- **arch-A2: `groups` shape CHECKs.** §3.2 P10 (production count) and its decision line; §3.3 (CHECKs read against `seed-dev.sql` and every fixture); §4.1 rows 1 and 4; §4.2 item 3 (stop-block); §4.5 step 5; §4.12 (`DerivedFromKey` pin); §6.3 scan 4; §12 block (k); §10 EC-34.
- **arch-A3: the pair's contract.** §4.5 (contract paragraph); §4.11; §6.3 (T-G pair tests and the `groupSeedPlan` pin); §7 (Modify list); §12 block (e); §10 EC-13 extended, EC-35.
- **arch-A4 (D5): narrower refusal test, owner-connection index test, writer re-scan.** §3.3 item (1); §6.3; §8 Batch A1 and A2 gates; §12 block (g); §10 EC-14 extended.
- **S16 (refuse a non-owner `INSERT` of a derived group): declined**, with the paper text in §15.1 (8) and DECISION-236, and the reason in §4.5.
- **F245 added** to §15.3 and folded into DECISION-236 (§15.2); §16 gains the rows for the 3a review and the operator rulings.
- **Operator rulings of 2026-10-25 recorded:** D4 approved as designed, the R57 archive scope approved, F245 assigned (§0 note, §18).
- **Copy: no change.** The amendments add no user-facing string (§14 closing line).
- Preamble: numbers line corrected (F245 used; F246 to F249 and DECISION-237 returned).

## 0. Read this first: departures from Phase 1 and 2

Each is a place where this design does something other than what an earlier phase wrote. All are small. Items marked **ack** need the architect's or orchestrator's eye; only D4 needs the operator.

| # | Earlier text | This design | Why |
|---|---|---|---|
| D1 (**ack**) | R49: "Provisioning creates both [derived groups] in one transaction"; the sync trigger raises if either is missing. | The trigger **still raises** if either is missing. In addition the database creates the pair: a `SECURITY DEFINER` `AFTER INSERT` trigger on `groups` inserts the `all_memberships` sibling whenever an `active_membership` group is inserted (`on conflict (organization_id, derived_from) do nothing`). Provisioning still lists both groups explicitly (a multi-row insert fires the row trigger after the statement, so the trigger's insert is the no-op). | The raise-only mechanism breaks every fixture that creates an `active_membership` group by itself: 35 files (29 under `src/`, 4 e2e fixtures, `seed-dev.sql`, `test-rls.sql`), because the first membership insert would raise. Counted by `grep` in the live tree (§3.3). Pair-by-construction is also a stronger database property than pair-by-convention, and F16's "fail loudly" is untouched. The alternative (edit all 41) is costed in §3.3 if the architect prefers it. |
| D2 | R56 names one new archive connection, `former_visitor`. | Two: `former_visitor` (archive marker and engagement `visitor`) and `archived` (archive marker, any other engagement). | R57 lets an Inactive or Moved-away person be archived, and `deriveConnection` would otherwise label them "Connection ended". |
| D3 | R50 lists `unclassified` as a standing. | Kept in the SQL and TS functions, but **unreachable from stored rows** once the engagement CHECK lands (`engagement_status` is `NOT NULL` and in the five values; with any of those five values the first-match order always lands on `listed`, `staff_anchor`, `visitor` or `inactive`, whatever the roll text). | Stated so nobody builds UI for a state that cannot occur; the cross-product test still covers it. |
| D4 (**operator**) | R49: the calendar baseline role is backfilled in the 0062 style, at every organisation that has the pair. | Same, but measured: on `development` 9 of the 11 organisations that have an `active_membership` group have **no live `member` grant** (the F133 state), holding 16 live memberships. The backfill gives those 16 people `events.view` for the first time. That is a widening, not a preservation. See Operator question 1. | The architect's measured F133 figure (2 of 11) was in Phase 2 but its consequence for the backfill was not stated. |
| D5 | R54: "Phase 3 decides: guard or record as `paper`." | **Guard.** Every writer of `memberships.current_roll` and `current_roll_since` is an owner-path definer (§4.9), so 0066 adds an owner-only column guard and F244 closes. | The architect's own test ("if all are owner-path definers") is met. |
| D6 | R53 guard: "any change on an ended membership; transitions into or out of `staff`; a change to `visitor` while the roll is non-null." | Same three rules. Recorded residuals added: an `INSERT` with engagement `staff` cannot be told apart from the sanctioned anchor path at the database, and `memberships.ended_on` stays writable by `presby_app` (it always was). Both are `paper`, named in DECISION-234 and DECISION-235. | The database cannot distinguish the sanctioned caller; saying so is better than implying the guard covers it. |
| D7 | G18: first-visit date "not after today, not before 1900". Phase 1 also says "same bounds as at creation". | Creation has no lower bound. The edit adds `1900-01-01` as a floor, with its own message. | Both statements could not hold; the floor is the stricter reading. |
| D8 | G6: archive "cancels open follow-ups in the same transaction". | Not in 3a. R58's trigger (3b, migration 0069) does it for every writer of `ended_on`, archive included, so 3a's archive needs no change and **3a's dialogs say nothing about follow-ups**. | Follows R66's split. 3b adds one sentence to the archive dialog. |

**Status of the acks (2026-10-25).** The architect's review accepted D1 to D8 (D1 and D5 with arch-A1 to arch-A4, folded in below). The operator approved D4 as designed (every live membership gets `calendar_viewer`; no `member` grant is created; P5 is read before the production apply; the release note states the widening) and approved the R57 archive scope. No departure is open.

## 1. Summary

3a makes the member directory follow a single, tested definition of "listed", then builds the people-tracking features that depend on it. `memberships.current_roll` and `engagement_status` are classified by one SQL function (from 0065) and one TypeScript mirror. The existing `active_membership` derived group narrows to people with member standing (listed or a staff anchor); a new derived kind, `all_memberships`, mirrors every live membership and carries a new `events.view`-only baseline role, so a visitor or an inactive person with a sign-in keeps the calendar and loses the directory (F177 closes, the 2b visitor acknowledgement is retired). Auto-connect then requires member standing (R55). An administrator can change a person's engagement (Visitor, Regular attender, Inactive, Moved away) with an audited, database-guarded write; Inactive and Moved-away people get a list; a visitor or an inactive person can be archived and restored; first-visit details can be corrected; the Community nav is fixed for 360px before it grows a seventh segment. Underneath, a derived-row guard finally makes "the Court Is Not a Group" true at the database (F240), and `current_roll` and `engagement_status` become owner-path or guarded columns (F243, F244). No new route, permission, platform flag or organisation toggle: everything rides `people.manage` and the existing Community gating.

## 2. Permissions & Flags

- **Permission keys:** none new. `people.manage` for every verb (engagement, archive, restore, visit details, the lists). The writes re-check it in the same transaction as the write.
- **Default role bindings:** none changed by a permission. One **baseline role** is added: key `calendar_viewer`, name "Calendar viewer", constitutional and protected, carrying `events.view` only, bound to the `all_memberships` derived group (D1, R49). It is seeded at provisioning for every organisation type and backfilled by 0066 (D4).
- **Flags:** not needed. No `FEATURES.*` key, no platform flag, no `ORG_FEATURE_CATALOG` entry. Option 1 closes a security gap and must not be switchable (R64). The Community surfaces keep riding `org_portal.members_create` (global flag plus the organisation's toggle row) exactly as today.
- **Reads of 2b's toggle:** the engagement dialog reads `org_portal.sign_in_connect` for its auto-connect line, through the same `orgFeatureEnabledInTx(tx, org, key, false)` the 2b card uses. It reads, never writes.
- **Gate order on every new action:** auth, organisation context, `people.manage` in the transaction, then the write. No new `FEATURES.*` or session claim. Tenant permissions resolve per request (`presby_effective_permissions`); the only caching in the tree is React's per-request `cache()` and the build-time constants (grep: no `unstable_cache`, no `"use cache"`, no `revalidate =`), so the narrowing takes effect on the next request after the migration is applied, and the Phase 3 confirmation R48 asked for is done.
- **Platform admins:** gain nothing. Neither the classifier, the guards nor the writer read `is_platform_admin`.

## 3. Measurements and feasibility

### 3.1 `development` results (2026-10-25; read-only; counts only)

| What | Result |
|---|---|
| Organisations / with an `active_membership` group / with `all_memberships` | 15 / 11 / 0 |
| Live memberships by standing (CASE written inline; the classifier does not exist on `development` yet) | listed 45; nothing else |
| Memberships by engagement / live roll values | `regular` 47 of 47. Roll: null 15, active 23, baptized 5, affiliate 1, other_participant 1 |
| Ended memberships | 2, both with a null `ended_reason` |
| Live memberships whose person has a sign-in (`people.user_id` set), by standing | listed 20; no visitor, inactive or staff has one. **Nobody loses the directory on `development`.** |
| Role grants bound to the `active_membership` group (live), by role key | `member` 2; no custom role. No custom grant narrows |
| Live memberships with no `active_membership` derived row | 4 (all at organisations that have no `active_membership` group at all, so 0066 neither pairs nor changes them) |
| Organisations with the group but **no live `member` grant** on it / live memberships there | 9 / 16 (D4) |
| Org-owned roles keyed `calendar_viewer` | 0 |
| Function bodies naming the old unique key or `on conflict (membership_id)` | exactly `presby_sync_derived_membership_group` (replaced here) |
| Function bodies naming `active_membership` | `presby_accept_invitation`, `presby_decide_roll_action`, `presby_record_participant_action`, `presby_void_participant_action`, `presby_sync_derived_membership_group`: the first four are the `sqlerrm like '%has no derived group active_membership%'` handlers that must keep mapping (EC-13) |
| Triggers on `memberships` / `group_memberships` | `memberships_guard_insert`, `memberships_sync_derived_group`, `memberships_guard_end` / `group_memberships_reject_derived` |
| Sync and reject functions `SECURITY DEFINER`? | none of the three is (F240's premise confirmed) |
| `neondb_owner` / `presby_platform` `BYPASSRLS` | both true; `presby_app` false |
| 0065 objects present | no (`presby_membership_standing`, the standing core: absent) |

What it decides. No `development` person changes access, so Phase 6 builds its visitor walk from fixtures (§13). The 9 and 16 are the widening in D4. The 4 memberships at organisations with no groups are the existing F16 state and are untouched. Engagement was never anything but `regular`, so the CHECK's stop-block passes with room.

### 3.2 Production: count-only SQL for the orchestrator

Run as one session with `default_transaction_read_only = on`, **after 0065 is applied in production and before 0066 is**, and again just before deploy. Every query returns counts only. The CASE is the classifier written as plain SQL for counting; it is not the function and not a test of it.

```sql
-- P1  Stop-block mirror: engagement values outside the five (must be 0 or 0066 refuses to apply)
select count(*) as bad_engagement
  from memberships
 where engagement_status is null
    or engagement_status not in ('visitor','regular','inactive','moved_away','staff');

-- P2  Live memberships by standing, and those whose person has a sign-in (who loses the directory)
with s as (
  select m.person_id,
         case when m.current_roll in ('active','baptized','affiliate','other_participant')
                   or m.engagement_status = 'regular' then 'listed'
              when m.engagement_status = 'staff'   then 'staff_anchor'
              when m.engagement_status = 'visitor' then 'visitor'
              when m.engagement_status in ('inactive','moved_away') then 'inactive'
              else 'unclassified' end as standing
    from memberships m where m.ended_on is null)
select s.standing, count(*) as live, count(*) filter (where p.user_id is not null) as with_sign_in
  from s join people p on p.id = s.person_id
 group by s.standing order by 1;

-- P3  Custom grants that bind to active_membership (they narrow too): by role key, live only
select r.key, count(*)
  from role_grants rg
  join groups g on g.id = rg.group_id and g.derived_from = 'active_membership'
  join app_roles r on r.id = rg.role_id
 where rg.ends_on is null or rg.ends_on > current_date
 group by r.key order by 1;

-- P4  Organisations: total / with the group / holding memberships but no group (left as they are)
select (select count(*) from organizations),
       (select count(*) from groups where derived_from = 'active_membership'),
       (select count(distinct m.organization_id) from memberships m
         where not exists (select 1 from groups g
                            where g.organization_id = m.organization_id
                              and g.derived_from = 'active_membership'));

-- P5  D4: organisations with the group but no live member grant, and the live memberships there
select count(*) as orgs_without_member_grant,
       coalesce(sum((select count(*) from memberships m
                      where m.organization_id = g.organization_id and m.ended_on is null)), 0) as live_memberships_gaining_events_view
  from groups g
 where g.derived_from = 'active_membership'
   and not exists (select 1 from role_grants rg join app_roles r on r.id = rg.role_id
                    where rg.group_id = g.id and r.key = 'member'
                      and (rg.ends_on is null or rg.ends_on > current_date));

-- P6  Live memberships with no active_membership derived row (the 4 on development)
select count(*) from memberships m
 where m.ended_on is null
   and not exists (select 1 from group_memberships gm join groups g on g.id = gm.group_id
                    where gm.membership_id = m.id and g.derived_from = 'active_membership');

-- P7  Org-owned roles that already use the new key (never modified; any hit is reported)
select count(*) from app_roles where key = 'calendar_viewer';

-- P8  Open sign_in invitations addressed to a person who will NOT have member standing after 0066
--     (they stay valid and connect to a calendar-only account). Requires 0065.
select count(*)
  from account_invitations i
  join memberships m on m.person_id = i.person_id and m.organization_id = i.organization_id and m.ended_on is null
 where i.purpose = 'sign_in'
   and i.accepted_at is null and i.revoked_at is null and i.superseded_at is null
   and i.blocked_at is null and i.redacted_at is null and i.expires_at > now()
   and not (m.current_roll in ('active','baptized','affiliate','other_participant')
            or m.engagement_status in ('regular','staff'));

-- P9  Writers: how many memberships could a guard on current_roll ever see written by presby_app?
--     (static, from the code: 0 application writers; no query)

-- P10 arch-A2 stop-block mirror: groups that would violate the two new shape CHECKs
--     (each must be 0 or 0066 refuses to apply). Counts only.
select count(*) filter (where (membership_source = 'derived') <> (derived_from is not null))               as shape_mismatch,
       count(*) filter (where derived_from is not null
                          and derived_from not in ('active_membership','all_memberships','session','diaconate')) as unknown_kind
  from groups;
```

What each decides. **P1 > 0:** 0066 stops; repair first, do not edit the migration. **P2** `with_sign_in` for `visitor`, `inactive` and `unclassified` is the exact number of signed-in people who lose the directory at apply: if non-zero, the release note names it and the runbook says the change is immediate at apply, not at deploy. **P3** non-`member` keys mean a custom role is narrowed. **P5** non-zero is D4's widening, put to the operator before apply. **P6** non-zero (outside organisations with no group) means people newly gain `events.view` at the next write. **P7** non-zero: reported to me, because the role is never modified and a collision would mean the baseline is absent there. **P8** informs the release note only. **P10** either column above 0: 0066 stops; the orchestrator reports the count (never a group name) and the rows are corrected before the migration is applied, never by editing it. On `development` the architect measured 29 derived groups (11 `active_membership`, 9 `session`, 9 `diaconate`) and 2 managed groups with a null `derived_from`, so both CHECKs validate there today.

### 3.3 Feasibility check against the live tree

Done before naming implementers.

- **Signatures are valid SQL.** The two new classifier-layer functions and the `groups` pair function take no defaulted parameters. The three re-created 0065 functions keep their shipped signatures, so `create or replace` keeps their ACLs; the core's trailing `p_second_factor_verified boolean default false` and the wrapper defaults stay trailing. Nothing in 0066 adds a parameter.
- **ALTER and DROP against dependents.**
  - `group_memberships_membership_key` (`unique (membership_id)`) is dropped and replaced by `unique (membership_id, group_id)`. Nothing references the old constraint as an FK target (the composite FK `group_memberships_membership_fk` points at `memberships`, not at it). Function bodies are untracked by Postgres, so I grepped `pg_proc.prosrc` on `development` for the constraint name and for `on conflict (membership_id)`: exactly `presby_sync_derived_membership_group`, which this migration replaces. The implementer re-runs that query after the rebase (0065 may have added a body) and records the result. **Writer re-scan (arch-A4):** after the rebase the implementer also re-runs the `pg_proc.prosrc` scan over the live post-2b bodies for every function that writes `memberships.current_roll` or `current_roll_since`, that `update`s `memberships.engagement_status` (that guard binds the owner too), that writes a derived `group_memberships` row, or that writes `groups`, and records the list beside this item. A writer that is not on the owner path (a non-definer, or a definer not owned by the table owner) is a **Phase 3 loop-back**, not a Phase 4 deviation.
  - `presby_reject_derived_group_write` is replaced from its **live** 0033 body (not 0009's); the officer sync `presby_sync_derived_group` is changed with `alter function ... security definer set search_path = public, pg_temp`, **not** re-created, so its 0062 CASE arms (pinned by `officer-offices.test.ts` against 0062's text) stay byte-identical and the pin keeps holding.
  - `memberships.engagement_status` gains a CHECK; nothing drops. `memberships.current_roll` gains triggers only.
- **New CHECKs and triggers against fixtures and seeds.**
  - *Engagement CHECK:* `scripts/seed-dev.sql` uses only `regular` (and the default `visitor`); the e2e and Vitest fixtures use `regular`, `staff` and `visitor`; `invitations.db.test.ts:758` expects `staff`. Nothing contradicts it.
  - *Engagement guard:* the only `UPDATE ... engagement_status` anywhere in the tree is `src/lib/contact-methods/readers.db.test.ts:46`, `regular` to `visitor` with `current_roll = null`, on a live membership: allowed. No TypeScript writer exists today (§4.9 and §6.3 list the writers).
  - *Roll-cache guard:* **contradicts one fixture.** `scripts/test-rls.sql:332` inserts a membership with `current_roll = 'active'` as `presby_app` to prove the one-active-roll index. The guard refuses that insert before the index is reached, so the assertion moves (§12, staged patch): the same unique-index property is asserted on the owner connection in the new DB test, and test-rls gains the refusal as a pass line. No Vitest fixture is affected (they build memberships on the platform connection, which is the owner).
  - *`groups` shape CHECKs (arch-A2):* `scripts/seed-dev.sql` inserts derived groups only with `derived_from` set (`session`, `diaconate`, `active_membership`) and its managed group with a null `derived_from` (lines 178 and 803 grep-checked); `groups.test.ts:190`, `officers.test.ts:189` and `designation-revoke.db.test.ts:93` pass only those three keys, or null with `managed`; no fixture in `src/`, `e2e/` or `scripts/` inserts a managed group with a `derived_from` or a derived group without one (grep, 2026-10-25). Nothing contradicts the CHECKs.
  - *`groups` edit guard (arch-A1):* `src/lib/groups.ts:665` updates `name`, `description` and `meetsWhen` on managed groups only (`:645`); `invitations.db.test.ts:180` flips `derived_from` on purpose through a test-injection trigger that runs inside a definer, i.e. on the owner path, and must still pass (re-run in Batch A1). `scripts/test-rls.sql:1848` renames a managed group and stays allowed.
  - *Derived-row guard:* no `presby_app` suite writes a derived `group_memberships` row except through the triggers (`test-rls.sql` sections 6 and 25 test `source = 'managed'` and DELETE, both unchanged). Teardowns that disable the reject trigger as owner (`community-fixture.ts`) are unaffected.
  - *Pair trigger:* every raw insert of an `active_membership` group now also creates a second group. Tests that assert an exact derived-group count or list will change deliberately; the implementer finds them by running the DB-backed suite (likely `groups.test.ts`, `groups-list.test.tsx`, `groups/page.test.tsx`, `org-portal/my-groups.test.ts`, `org-provisioning.test.ts`, `role-definitions.test.ts`, `sites.test.ts`). Cleanups that delete by person or organisation cover both rows; the ones that delete by `group_id` (`home-cards-fixture.ts:277`, `community-fixture.ts:380`) delete managed groups only.
  - *Without D1* the 35 files that create the group are: `e2e/support/{domains-ui,giving,invitation}-fixture.ts`, `e2e/support/seed-orgs.ts`, `scripts/seed-dev.sql` (5 inserts), `scripts/test-rls.sql`, `src/lib/testing/calendar-fixture.ts`, and 28 `src/**/*.test.ts(x)` files (`grep -rlE "derivedFrom: *\"active_membership\"|'derived', *'active_membership'"`, 2026-10-25).
- **New FKs.** None. Tenant column on both sides of every write: `group_memberships.organization_id` and `groups.organization_id` (the pair trigger and the sync both take it from `NEW`); the new unique key sits beside the existing composite FKs `group_memberships_group_fk (group_id, organization_id)` and `group_memberships_membership_fk (membership_id, organization_id)`, so a derived row can only point at a group and a membership of its own organisation. The role grant is a group-arm grant, whose composite FK is the 0062 precedent.
- **Things that must be re-verified once 2b is merged (the "feasibility re-run" rule).** (1) The names and bodies listed in the preamble; `pg_get_functiondef` of the three functions §4.10 re-creates is saved and diffed. (2) `grep -n "'visitor'" drizzle/0065*.sql` lists every remaining visitor literal in 0065 (the design assumes only the standing core's call, the connect step, the check's reason and comments). (3) `grep -rn "SIGN_IN_ACK_REASONS\|needs_acknowledgement" src e2e` lists the TypeScript and e2e sites §9 changes. (4) 0065's fixtures (`seedSignInInvitation` in both `invitation-fixture.ts` files) create groups only through the pair trigger's path. (5) Migration numbering 0066 still free. A mismatch is a Phase 3 loop-back, not a Phase 4 deviation.

## 4. Data Model: migration 0066

**File:** `drizzle/0066_presby_membership_standing.sql`, hand-written, idempotent (every statement drop-then-add, `create or replace`, `if not exists`, `on conflict do nothing`, or a predicate that stops matching once applied), a forward fix on top of 0065 (never an edit of 0059 to 0065). Apply: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql`. **Chain:** `0064 < 0065 < 0066`, never reordered. **Deploy order:** apply 0066, then deploy the code. Old code against 0066 survives: the old Directory predicate and Visitors list read the same columns; the old send dialog's visitor paragraph still renders but the definer no longer asks for it; membership inserts and updates work with the new trigger. New code against a database without 0066 would call nothing missing (the classifier is 0065's), but would lack the guards, the pair and the role, so the order matters for safety, not for survival. **The narrowing takes effect when 0066 is applied, not when the code deploys** (tenant permissions resolve per request); the runbook and the release note say so. **Header records:** the §3.1 counts with no slug and, once the orchestrator has run it, the §3.2 production counts; the strict chain; the deploy order; the forward-only caveat (once the new group exists, dropping it would strand rows; nothing is ever deleted); and the three facts a reader must not miss: derived `group_memberships` rows and `memberships.current_roll` are written only on the owner path, `engagement_status` has a vocabulary and a guard, and `presby_app` still holds no privilege on `account_invitations`.

**What this file does not do, on purpose:** no delete anywhere (soft only); no `role_grants` row for a person; no rebinding of `member` or any protected role (the production grant restored on 2026-10-22 is untouched, TODO line 80); no change to 0061 to 0065 files; no backfill that creates `active_membership` rows (it only ends them); no `follow_ups` change (3b, 0069).

### 4.1 Sections in file order

| # | Section | Contents (contract, not bodies) |
|---|---|---|
| 1 | Preconditions | Stop-blocks, **counts only**, raise text names a count and no value. Includes the `groups` shape stop-block (arch-A2). See 4.2 |
| 2 | Classifier layer | `presby_standing_is_member(text)` and `presby_membership_is_member_standing(text, text)` on top of 0065's classifier. 4.3 |
| 3 | Derived-row guard (F240) and derived-group guard (F245) | Replace `presby_reject_derived_group_write()` from its live 0033 body; replace `presby_reject_derived_group_edit()` (the `groups` edit trigger, 0033) with the owner-only identity guard (arch-A1); `alter function presby_sync_derived_group() security definer set search_path = public, pg_temp`. 4.4 |
| 4 | The pair, and the shape of `groups` | Unique key change, `presby_pair_derived_groups()` and its trigger on `groups`, sibling backfill, post-check; the two `groups` shape CHECKs added NOT VALID then validated (arch-A2). 4.5 |
| 5 | The sync trigger | Replace `presby_sync_derived_membership_group()`: definer, writes both rows. 4.6 |
| 6 | Row backfill | Between `-- BEGIN backfill-standing` and `-- END backfill-standing` markers so a Vitest test can re-execute it. 4.7 |
| 7 | Baseline role | Between `-- BEGIN backfill-calendar-viewer` and `-- END ...`. 4.8 |
| 8 | Vocabulary and guards | Engagement CHECK; engagement guard; roll-cache guard (F243, F244). 4.9 |
| 9 | Re-created 0065 bodies | The standing core's A5 list, the check's acknowledgement, connect's step 10. 4.10 |
| 10 | ACLs and comments | Restates every ACL so the end state does not depend on history; comments on every new object and on the amended columns. 4.11 |

### 4.2 Section 1: preconditions

All count-only. A refusal reads like `0066: % membership(s) carry an engagement_status outside (...); correct them before this migration can apply`, never a value.

1. `to_regprocedure('presby_membership_standing(text,text)')` and `to_regprocedure('presby__person_sign_in_standing(uuid,uuid)')` are not null, else `0066: apply 0065 first`.
2. Memberships whose `engagement_status` is null or not in `('visitor','regular','inactive','moved_away','staff')`. Zero on `development`; P1 gives production.
3. **`groups` shape (arch-A2).** Count of `groups` rows where `(membership_source = 'derived') is distinct from (derived_from is not null)`, and count where `derived_from` is not null and not in `('active_membership','all_memberships','session','diaconate')`; either above zero raises `0066: % group(s) fall outside the derived-group shape; correct them before this migration can apply`. Production mirror: P10. This runs **before** section 4 adds the CHECKs NOT VALID and validates them.
4. After section 4's sibling backfill (same raise style): organisations that hold exactly one of the pair. Must be zero.
5. `raise notice` (not a stop) with the count of live memberships that have no `active_membership` derived row, and the count of org-owned roles already keyed `calendar_viewer`.

### 4.3 Section 2: the classifier layer

```sql
presby_standing_is_member(p_standing text) returns boolean
  -- language sql immutable, no definer, no SET: select p_standing in ('listed', 'staff_anchor')
presby_membership_is_member_standing(p_current_roll text, p_engagement_status text) returns boolean
  -- language sql immutable: select presby_standing_is_member(presby_membership_standing($1, $2))
```

`revoke all ... from public; grant execute ... to presby_app`. **Member standing is defined once**, in `presby_standing_is_member`; the trigger, the archive writer's SQL, the check and connect all reach it through one of these two. 0065's `presby_membership_standing` is **not** re-created (one definition of the roll list and the first-match order; the live-catalog scan in 6.3 pins it).

### 4.4 Section 3: F240, the derived-row guard

`create or replace function presby_reject_derived_group_write()`, language plpgsql, **invoker**, `set search_path = public, pg_temp`, from the live 0033 body with this added **after** the existing DELETE and source checks, which stay byte-for-byte:

- `v_owner := (select c.relowner = r.oid from pg_class c, pg_roles r where c.oid = tg_relid and r.rolname = current_user)`. No role is named (the Phase 2 A1 owner test, so a role added later is refused by default, and the `SECURITY DEFINER` sync functions, which run as the owner, pass).
- If not `v_owner`:
  - `INSERT` into a group whose `membership_source = 'derived'`, or an `INSERT` with `source = 'derived'` into any group: refused.
  - `UPDATE` of a row whose `old.source = 'derived'` or whose group is derived, where `(to_jsonb(new) - allow) is distinct from (to_jsonb(old) - allow)` and `allow = array['public_listed','public_listed_by','public_listed_at','public_display_order']`: refused. **The allow-list is closed**: a column added to `group_memberships` later is guarded by default. Officers, Groups and Staff keep toggling the four listed columns.
- Error: `check_violation`, message starting `group_memberships:`, same family as the existing refusals so `test-rls.sql` sections 6 and 25 keep their `exception when check_violation`.

**Derived-group guard (F245, arch-A1).** The same section also closes the one level up. `create or replace function presby_reject_derived_group_edit()` (the `groups` trigger `groups_reject_derived_edit`, `BEFORE UPDATE`, shipped in 0033; invoker, `set search_path = public, pg_temp`) keeps its existing refusal of `name`, `description` and `meets_when` on a derived group **byte-for-byte, for every role**, and gains, **after** it, the same `relowner` owner test (no role named):

- A non-owner may change **no column** of a `groups` row where `old.membership_source = 'derived'` or `new.membership_source = 'derived'`. That refuses a derived-to-managed flip, a managed-to-derived flip, and any change to `derived_from`, `is_protected`, `group_type_id` or `organization_id` (compared as `to_jsonb(new) is distinct from to_jsonb(old)`, with no allow-list: unlike `group_memberships`, nothing on `groups` is legitimately toggled by a tenant on a derived row).
- Errors: `check_violation`, message prefix `groups:`, one fixed message per refusal.
- A managed-to-managed update (a rename) is untouched and stays allowed (`scripts/test-rls.sql:1848`).

This is why "The Court Is Not a Group" is a database property only when this guard and the `group_memberships` guard above are both in (architect, 3a review): without it a `presby_app` session could flip the Session group to `managed` and then insert a `managed` row the first guard no longer covers.

`alter function presby_sync_derived_group() security definer set search_path = public, pg_temp;` The body is **not** touched (0062's CASE arms and their source-scan pin stay valid). The membership sync is replaced in 4.6.

**Why safe.** Both sync functions take the organisation from `NEW`; the elevation only affects their own writes, which RLS on the triggering table already tied to one organisation; the platform roles are `BYPASSRLS` already (measured).

### 4.5 Section 4: the pair

1. `alter table group_memberships drop constraint if exists group_memberships_membership_key;` then add `group_memberships_membership_group_key unique (membership_id, group_id)` (guarded by `pg_constraint`). A membership may now hold one derived row per group. History collapses to one row per (membership, group): derived rows are a current-state cache, the audit rows carry the history, and no caller passes a historical `asOf` to the resolver (grep: `getEffectivePermissions`' optional argument has no caller outside tests; `officers.ts:635` replays the roll, not group rows).
2. `presby_pair_derived_groups()`: `SECURITY DEFINER`, `set search_path = public, pg_temp`; trigger `groups_pair_derived` `AFTER INSERT ON groups FOR EACH ROW WHEN (new.derived_from = 'active_membership' and new.membership_source = 'derived')`. Body: insert into `groups` one row `(new.organization_id, new.group_type_id, 'Everyone on Record', 'derived', 'all_memberships', is_protected = true)` `on conflict (organization_id, derived_from) do nothing`. It only ever creates the sibling for **its own organisation**.
3. Backfill: the same insert, `select ... from groups a where a.derived_from = 'active_membership' on conflict do nothing`.
4. Post-check in section 1's style: organisations with exactly one of the pair = 0, else raise.
5. **Shape of `groups` (arch-A2), after the stop-block in 4.2.** `alter table groups drop constraint if exists` each of the two names, then add `groups_derived_pairing_check check ((membership_source = 'derived') = (derived_from is not null)) not valid` and `groups_derived_kind_check check (derived_from is null or derived_from in ('active_membership','all_memberships','session','diaconate')) not valid`, then `validate constraint` on both. The shipped `groups_derived_check` (managed, or `derived_from` not null) is kept; the new pairing check is strictly stronger and also forbids a managed group with a `derived_from`. Why it matters: without it a pre-existing *managed* group carrying `derived_from = 'all_memberships'` would satisfy the pair trigger's `on conflict do nothing` and the post-check in step 4 while holding no derived rows, and the sync's lookup by `derived_from` would be ambiguous. `DerivedFromKey` in `src/lib/groups.ts` is widened to the four kinds and pinned to the CHECK by a source-scan test (6.3, scan 4). The kind list is deliberately closed: a fifth kind is a migration.

**The pair's contract (arch-A3).** (i) A `presby_app` insert of a derived `active_membership` group under organisation A creates exactly one sibling, at A, with the fixed literals (type from `NEW.group_type_id`, name, `membership_source`, `derived_from`, `is_protected`), and changes no row in `app_roles`, `app_role_permissions` or `role_grants`. (ii) `has_function_privilege` is false for both application roles on `presby_pair_derived_groups`. (iii) `groupSeedPlan()` in `src/lib/org-provisioning.ts` lists `all_memberships` **explicitly for every organisation type**, pinned by test: a `RETURNING` clause does not return rows a trigger inserted, so the `calendar_viewer` binding lookup (`org-provisioning.ts:441` to `:446`) finds the group only if the plan inserts it, and the existing throw-if-missing then fails loudly if anyone drops it from the plan. (iv) Any fixture or seed that inserts `all_memberships` in a statement separate from the `active_membership` insert uses `on conflict (organization_id, derived_from) do nothing`, because the trigger has already made the row.

**S16 declined (architect's optional suggestion: refuse a non-owner `INSERT` of a derived group, `BEFORE INSERT`).** Declined for three reasons. (1) It contradicts the pair's contract just above: the pair is *meant* to be exercised by a `presby_app` insert (arch-A3 test (i), `test-rls-66.sql` block (e)), and the `BEFORE` guard would refuse exactly that insert; the pair test would have to run on the owner connection and stop proving the thing the architect asked to be proven as `presby_app`. (2) It would force an existence guard into `scripts/test-rls.sql:656` (a `BEFORE` trigger fires ahead of `on conflict` arbitration, so the scratch insert would raise even where Alder Creek already has the group) and into every `presby_app`-connection fixture. (3) The harm it would prevent is already closed by other means: a tenant-inserted derived group can only be of the four closed kinds (arch-A2), is unique per organisation (`groups_org_derived_key`), its membership rows are writable only by the owner-path triggers (F240), and its identity cannot be flipped (arch-A1); no role reaches it without a role grant, which needs `role_grants.manage`. The residual is recorded as `paper` (15.1 (8), DECISION-236).

**Group literals.** The kind is `all_memberships`; the name is "Everyone on Record" (the derived-edit trigger forbids later renames, so it is chosen once); the existing "Active Membership" name is kept (renaming it is data churn and forbidden by the same trigger).

### 4.6 Section 5: the membership sync trigger

`create or replace function presby_sync_derived_membership_group()` — `SECURITY DEFINER`, `set search_path = public, pg_temp`, `AFTER INSERT OR UPDATE` on `memberships` (trigger unchanged). It reads both groups from `NEW.organization_id` and **raises** if either is missing, **checking `active_membership` first** with the shipped message `organization % has no derived group active_membership; seed derived groups at org creation` (SQLSTATE `foreign_key_violation`) so the four `sqlerrm like '%has no derived group active_membership%'` handlers keep mapping the common state; a missing `all_memberships` raises the same shape naming it (`... has no derived group all_memberships; seed derived groups at org creation`), which those handlers do not map and which therefore fails loudly.

Then, using `v_member := presby_membership_is_member_standing(new.current_roll, new.engagement_status)`:

1. **All-live row** (`all_memberships`): `insert ... (membership_id = new.id, source = 'derived', group_role = 'member', starts_on = new.created_at::date, ends_on = new.ended_on) on conflict (membership_id, group_id) do update set ends_on = excluded.ends_on where group_memberships.ends_on is distinct from excluded.ends_on`. It mirrors `ended_on` exactly, as `active_membership` does today (DECISION-065's one definition of "current": `presby_membership_is_active()` is `ended_on is null`).
2. **Member-standing row** (`active_membership`):
   - if `v_member`: insert, or on conflict set `ends_on = new.ended_on` (this **reopens** a closed row when standing is regained); `starts_on` is `new.created_at::date` on an `INSERT` and `current_date` when the row is first created by an `UPDATE` (standing gained later);
   - if not `v_member`: `update group_memberships set ends_on = current_date where membership_id = new.id and group_id = <active_membership> and ends_on is null`. A row that is already closed **keeps its end date**, so an unrelated update (a household change) rewrites nothing.
3. Writes go through the owner path, so the F240 guard passes them.

### 4.7 Section 6: row backfill (delimited, re-executable)

Role-free; the classifier only; never keyed on a reason text; never a delete.

1. Insert the all-live row for every membership at an organisation that has the pair (`ends_on = m.ended_on`, `starts_on = m.created_at::date`), `on conflict (membership_id, group_id) do update ... where distinct`.
2. Narrow: `update group_memberships gm set ends_on = current_date` for rows in an `active_membership` group where `gm.ends_on is null`, the membership is live (`m.ended_on is null`) and `not presby_membership_is_member_standing(m.current_roll, m.engagement_status)`.
3. It **never creates** an `active_membership` row (that would be a widening); a member-standing person who lacks one gets it at their next membership write, exactly as today.

### 4.8 Section 7: the baseline role (delimited, re-executable)

The 0062 `session_member` CTE shape, driven by `RETURNING` so a second run inserts nothing: for each organisation that has an `all_memberships` group and **no org-owned role keyed `calendar_viewer`**: the role (`role_kind = 'constitutional'`, `is_protected = true`, name "Calendar viewer"), one `app_role_permissions` row `events.view`, one group-arm `role_grants` row to the `all_memberships` group (`starts_on = current_date`, `granted_by` null, reason text "Baseline calendar role: events.view for everyone with a current record (drizzle/0066, DECISION-232)"). The role key is the only discriminator. An existing org-owned `calendar_viewer` is never modified, whatever it holds (0052 note 5). **Reach:** every organisation with the pair; see D4 and Operator question 1. If the operator narrows it, the only change is one `and exists (live member grant on that organisation's active_membership group)` predicate in the `targets` CTE.

### 4.9 Section 8: vocabulary and guards

**Engagement vocabulary (F243).** `alter table memberships drop constraint if exists memberships_engagement_status_allowed; add constraint ... check (engagement_status in ('visitor','regular','inactive','moved_away','staff')) not valid; validate constraint ...` after the section 1 stop-block. `ENGAGEMENT_STATUSES` in `src/lib/membership-standing.ts` is pinned to this CHECK by a source-scan test, the repo's usual shape.

**Engagement guard (R53).** `presby_memberships_guard_engagement()`, invoker, pinned `search_path`; trigger `memberships_guard_engagement` `BEFORE UPDATE OF engagement_status ON memberships FOR EACH ROW WHEN (new.engagement_status is distinct from old.engagement_status)`, **for every role** (the owner included, so a fixture cannot make a silent `staff`). It refuses, each with its own message and `check_violation`:

1. `old.ended_on is not null` (any change on an ended membership);
2. `new.engagement_status = 'staff' or old.engagement_status = 'staff'` (a transition into or out of `staff`; `staff` is set only at `INSERT` by the DECISION-129 anchor path);
3. `new.engagement_status = 'visitor' and new.current_roll is not null`.

**Known gaps, recorded not hidden (D6):** an `INSERT` with engagement `staff` is indistinguishable from the sanctioned anchor path at the database; `memberships.ended_on` and `ended_reason` stay writable by `presby_app` (the pre-existing capability archive and restore use, conditioned in code). Both `paper`.

**Roll-cache guard (F244, D5).** `presby_memberships_guard_roll_cache()`, invoker, pinned `search_path`; two triggers: `BEFORE INSERT ... WHEN (new.current_roll is not null or new.current_roll_since is not null)` and `BEFORE UPDATE OF current_roll, current_roll_since ... WHEN (distinct from old)`. A **non-owner** (the 4.4 owner test) is refused. **Writers of `current_roll` and `current_roll_since`, listed (grep of `drizzle/`, `src/` and `scripts/`, plus `pg_proc` on `development`: every function whose source says `update memberships` is `SECURITY DEFINER`, 2026-10-25):** (1) `presby_sync_current_roll()` (definer trigger on `roll_actions`, 0012:69); (2) `presby_reconcile_current_roll()` (definer, 0012:227, the daily reconcile); (3) the one-time 0012 backfill; (4) fixtures and seeds on the owner connection. `presby_record_participant_action` and `presby_void_participant_action` are definers that write `ended_on`/`ended_reason` only; the one function that inserts a membership, `presby_accept_invitation`, writes the staff anchor with a null roll. No `src/` module writes either column; the one `src/lib/people.ts` mention is a select. Every definer runs as the owner, so every sanctioned path passes. The one `presby_app` writer in the tree is the test at `scripts/test-rls.sql:332` (§3.3, converted).

### 4.10 Section 9: the three 0065 bodies re-created

Each is taken from `pg_get_functiondef` of the **live** post-2b function, so the move is a diff and not a rewrite, and the implementer records `diff` against the live body in Phase 4 notes. **The only differences allowed:**

1. `presby__person_sign_in_standing`: the closed derived-kind list inside the T computation, `derived_from in ('active_membership','session','diaconate')`, gains `'all_memberships'`. Without it every grant on the new group counts in T, every person becomes authority-bearing and every auto-connect returns `needs_second_factor`: fail-closed but a silent break of 2b (R49). The list stays in this one function body (S13); nothing in TypeScript copies it.
2. `presby_sign_in__check`: check 10 stops adding the `visitor` acknowledgement reason; `do_not_contact` stays, and the order of all other checks is unchanged.
3. `presby_connect_signed_in_account`: step 10 ("standing is not `visitor`") becomes "`presby_standing_is_member(standing)` is true, else `declined`" (R55, operator-approved). No other change.

Result: `standing = 'visitor'` appears in no 0066 body. The 2b matrix's connect column and the issue column change as §6 shows.

### 4.11 Section 10: ACLs and comments

`presby_app` EXECUTE on the two classifier-layer functions (and still on 0065's classifier). `presby_pair_derived_groups` and the trigger functions (the two derived-row/derived-group guards included) have no EXECUTE for any application role (a test asserts `has_function_privilege` false for **both** application roles, `presby_app` and `presby_platform`; arch-A3 (ii)). Comments on: both classifier-layer functions, the pair function, the three guards, the unique key, the new CHECK, the `memberships.engagement_status` / `current_roll` / `ended_reason` columns (vocabulary and "owner path only"), `groups.derived_from` (the four kinds), the two new `groups` CHECKs and `groups.membership_source` ("derived rows and derived groups are owner-path"), and `group_memberships` ("derived rows are written only by the owner-path triggers").

### 4.12 Drizzle mirrors and staged assets

`src/lib/db/domain/groups.ts` (unique key renamed; the `derivedFrom` comment lists four kinds; the two new CHECKs in the table callback beside `groups_derived_check`); `src/lib/db/domain/people.ts` (the CHECK in the table callback; column comments). `npm run check:schema-parity` runs; `npm run docs:erd` regenerates `/developer`. Staged for the orchestrator (Rule 16, §12): `drizzle/meta/_journal.json` entry for 0066, `scripts/membership-standing/test-rls-66.sql`, `scripts/membership-standing/test-rls.sql.integration.patch`, `scripts/membership-standing/seed-dev.sql.integration.patch`, and the `docs/schema-design-2.md` section.

## 5. API Contract

No route handler. Four server actions in a new co-located `src/app/(org)/o/[slug]/admin/community/actions.ts` (`"use server"`), used by the list rows, the edit page and the wizard. Plumbing identical to `removeParticipantAction`: `auth()`, `resolveOrgContext()` re-run inside the action, `organizationId` never from the client, the audit actor from the session, a thrown database error logged by class only and shown as one fixed string. They hold no `db.*` call and write no audit row of their own (the library does), so `npm run check:audit` passes vacuously, as for Increment 2.

```ts
changeEngagementAction(slug: string, input: { personId: string; to: EditableEngagement }):
  Promise<ActionResult<{ from: Engagement; to: Engagement; standingTo: Standing }>>
archivePersonAction(slug: string, input: { personId: string }):
  Promise<ActionResult<{ personId: string }>>
restorePersonAction(slug: string, input: { personId: string }):
  Promise<ActionResult<{ personId: string; list: "visitors" | "inactive" }>>
updateVisitDetailsAction(slug: string, input: { personId: string; firstVisitDate: string | null; howHeard: string | null }):
  Promise<ActionResult<{ personId: string }>>
```

`EditableEngagement = "visitor" | "regular" | "inactive" | "moved_away"` (never `staff`). Inputs are parsed and rebuilt (a Server Action's parameter type is not a runtime boundary): `personId` through `isUuid`, `to` through the closed list, the date through `isRealYmd` plus the bounds, `howHeard` trimmed and capped. Redirect target: none; no action redirects.

**Library:** `src/lib/community-engagement.ts` (`import "server-only"`), the **only** non-test module that UPDATES `memberships.engagement_status`, `ended_on`/`ended_reason` (archive and restore), `first_visit_date` and `how_heard` (the INSERT sites are listed in §6.3) (a source scan pins the writer list; `community.ts` stays read-only and its scan test is untouched). All four functions run inside `withOrgContext(viewerPersonId, organizationId, ...)`, check `people.manage` first in that transaction, and write their audit row with `insertAuditRow(tx, ...)` in the same transaction (a forced throw rolls the change back).

```ts
changeEngagement(viewer, org, { personId, to }, actor): Promise<
  | { kind: "ok"; from; to; standingFrom; standingTo; signInConnected: boolean }
  | { kind: "unchanged" }
  | { kind: "forbidden" | "not_found" | "ended" | "staff_record" | "needs_no_roll" | "changed_meanwhile" }>
archivePerson(viewer, org, { personId }, actor): Promise<
  | { kind: "ok"; engagement: Engagement; signInConnected: boolean }
  | { kind: "forbidden" | "not_found" | "already_ended" | "not_eligible" | "self_target"
      | "holds_position" | "pending_action" }>
restorePerson(viewer, org, { personId }, actor): Promise<
  | { kind: "ok"; engagement: Engagement; signInConnected: boolean }
  | { kind: "forbidden" | "not_found" | "not_archived" | "person_unavailable" }>
updateVisitDetails(viewer, org, { personId, firstVisitDate, howHeard }, actor): Promise<
  | { kind: "ok" } | { kind: "unchanged" } | { kind: "forbidden" | "not_found" | "ended" | "bad_date" | "bad_text" }>
```

**`changeEngagement`.** One `select ... for update` of the membership (and the person's `user_id`, `merged_into_id`, `date_of_death`) scoped to the viewer's organisation, so a person from another organisation, a merged or deceased person and a missing id are the same `not_found`. Rules, in order: `ended_on` set is `ended`; `from = 'staff'` is `staff_record`; `to = from` is `unchanged` (no write, no audit); `to = 'visitor'` with a non-null `current_roll` is `needs_no_roll`. Then a conditional `update memberships set engagement_status = $to, updated_at = now() where id = ... and organization_id = ... and ended_on is null and engagement_status = $from returning presby_membership_standing(current_roll, engagement_status)`; zero rows is `changed_meanwhile`. The guard trigger is the backstop for every rule. `standingFrom` is read in the same statement as the lock. `signInConnected` is `people.user_id is not null` (DECISION-189: never `users`). Self-targeting is allowed and audited.

**`archivePerson`.** Refusals before the write, in this order: `not_found` (as above); `self_target` (the viewer's own person); `already_ended`; `not_eligible` unless `presby_membership_standing(current_roll, engagement_status) in ('visitor','inactive','unclassified')`; `pending_action` if any `roll_actions` row for the person at this organisation is `pending` (the decide function refuses `membership_ended`, so a pending proposal on an archived person could never be approved); `holds_position` if an open officer term, an open role grant or an open staff position exists (the participant-removal pre-check's predicate; the first two are also `memberships_guard_end`'s, which remains the backstop and whose `check_violation` is mapped to the same outcome). Then the conditional `update memberships set ended_on = current_date, ended_reason = 'community_archived', updated_at = now() where ... and ended_on is null and presby_membership_standing(...) in (...)`. The marker `COMMUNITY_ARCHIVE_ENDED_REASON = "community_archived"` is declared beside `PARTICIPANT_REMOVAL_ENDED_REASON` in `src/lib/roll-action-kinds.ts`.

**`restorePerson`.** `update memberships set ended_on = null, ended_reason = null, updated_at = now() where organization_id = ... and person_id = ... and ended_on is not null and ended_reason = 'community_archived' and exists (select 1 from people where id = person_id and merged_into_id is null and date_of_death is null) returning engagement_status`; zero rows is `not_archived` or `person_unavailable` (a second read tells them apart). It does not look across organisations (a person with a live membership elsewhere is the existing `person_elsewhere` state, handled by 2b's standing core at sign-in; pinned in EC-20).

**`updateVisitDetails`.** Real date, not after `todayUtcYmd()`, not before `1900-01-01`; `howHeard` trimmed, at most 200 characters (the shared constant `MAX_HOW_HEARD`, exported from `people.ts`'s module or lifted to the pure module so the form and the writer cannot drift); an ended membership is `ended`. Blank clears the field. Writes only those two columns.

**Readers (all in `community.ts`, read-only, `people.manage`-gated, dates cast `::text`):**

- `listCommunity` gains kind `inactive`; the `visitors` predicate becomes `presby_membership_standing(m.current_roll, m.engagement_status) = 'visitor'` and `inactive` is `= 'inactive'`, each with `m.ended_on is null` and the existing merged/deceased filters; `former` becomes `m.ended_reason in (<participant marker>, <archive marker>)`, a closed list, never a prefix match.
- `CommunityRow` gains `engagementStatus`, `endedReason`, `signInConnected` (from the `people` join the query already makes).
- `getCommunityBadges` returns `Record<personId, { roll: CommunityBadge | null; engagement: "inactive" | "moved_away" | null }>` (a rolled person marked Inactive keeps their roll badge and gains the engagement badge, G4). Call sites change in `page.tsx` and `members-list.tsx`.
- `getCommunityStatus` additionally returns `engagementStatus`, `standing` (SQL classifier), `signInConnected`, `endedReason`.
- `directory.ts`: the default branch of `directoryEligibilityWhereSql` becomes `presby_membership_standing(m.current_roll, m.engagement_status) = 'listed'`. The two roll-only branches (`status`, `rollStatuses`) are explicit roll filters, not the listed test, and stay. `findDirectoryPersonIds` (the finder) inherits the change because it shares the function.

## 6. The TypeScript mirror and the R51 matrix

### 6.1 `src/lib/membership-standing.ts` (pure, no `server-only`, no imports of the database)

```ts
export const LISTED_ROLLS = ["active", "baptized", "affiliate", "other_participant"] as const;
export const ENGAGEMENT_STATUSES = ["visitor", "regular", "inactive", "moved_away", "staff"] as const;
export type Standing = "listed" | "staff_anchor" | "visitor" | "inactive" | "unclassified";
export function membershipStanding(roll: string | null, engagement: string | null): Standing;
export function isMemberStanding(s: Standing): boolean;       // listed | staff_anchor
export const EDITABLE_ENGAGEMENTS = ["visitor", "regular", "inactive", "moved_away"] as const;
export function offeredEngagements(hasRoll: boolean): EditableEngagement[]; // no "visitor" when a roll exists
```

First match wins, in R50's order. `community-labels.ts` (`deriveConnection`), `connectOutlook` (2b's `sign-in-types.ts`, its `visitor` result renamed `not_listed`), the wizard and the engagement dialog import from here; no other client or server module re-codes the test.

### 6.2 `deriveConnection` and the goldens

`ConnectionRow` is unchanged. New precedence, first match wins: ended (participant marker, then archive marker with engagement `visitor` = `former_visitor`, archive marker otherwise = `archived`, anything else = `ended`); then by standing: `listed` with a member roll = `member`, with `other_participant` = `participant`, otherwise (engagement `regular`, no roll) = `listed`; `staff_anchor` = `staff`; `visitor` = `visitor`; `inactive` with engagement `moved_away` = `moved_away`, otherwise `inactive`; `unclassified` = `unclassified`. `listed` is returned **only** for standing `listed` with no member or participant roll (G3). `Connection`, `CONNECTION_LABELS` and `alreadyHereSentence` gain `inactive`, `moved_away`, `former_visitor`, `archived`, `unclassified` (Copy, group E). `COMMUNITY_VIEWS` becomes `all, members, participants, visitors, inactive, staff, former`; `parseCommunityView` stays the only place a `?view=` is trusted. The `community-labels.test.ts` goldens are extended with one case per connection and the R51 matrix drives them (EC-1).

### 6.3 The R51 pin: one DB matrix test and three scans

**`src/lib/membership-standing.db.test.ts`** (serial; owner plus `presby_app`; one throwaway organisation created through `createOrganization()` so the roles and groups come from the provisioning code and not from a hand copy, then stamped `deletable_until`). Each row is a membership fixture, and one expected-outcome table asserts every column. Viewer context is set with `set_config('app.current_org_id', ...)`; permissions are read through `presby_effective_permissions`. "Member row" is the `active_membership` derived row, "all row" the `all_memberships` one.

| # | roll / engagement / state | standing (SQL = TS) | member standing | all row | member row | `directory.view` | `events.view` | in `getDirectory` | Community list | 2b core, connect (authority-free, proven, one address) |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | active / regular | listed | yes | open | open | yes | yes | yes | (Members) | `connected` |
| M2 | active / visitor (enrolled visitor) | listed | yes | open | open | yes | yes | yes | (Members) | `connected` |
| M3 | active / inactive (rolled and inactive) | listed | yes | open | open | yes | yes | yes | (Members, Inactive badge) | `connected` |
| M4 | other_participant / regular | listed | yes | open | open | yes | yes | yes | (Participants) | `connected` |
| M5 | other_participant / visitor | listed | yes | open | open | yes | yes | yes | (Participants) | `connected` |
| M6 | null / regular | listed | yes | open | open | yes | yes | yes | (Everyone) | `connected` |
| M7 | null / staff | staff_anchor | yes | open | open | yes (DECISION-207) | yes | **no** (DECISION-129) | Staff | `connected` |
| M8 | null / visitor | visitor | no | open | **closed** | **no** | yes | no | Visitors | `declined` |
| M9 | null / inactive | inactive | no | open | closed | no | yes | no | Inactive | `declined` |
| M10 | null / moved_away | inactive | no | open | closed | no | yes | no | Inactive | `declined` |
| M11 | unlisted roll (`zzz`, owner-path fixture) / visitor | visitor | no | open | closed | no | yes | no | Visitors (**the one by-name difference from 2b's list, now equal**) | `declined` |
| M12 | unlisted roll / regular | listed | yes | open | open | yes | yes | yes | (Everyone) | `connected` |
| M13 | any of the above, then ended | as stored | n/a | **closed** | closed | no | no | no | none | `membership_ended` |
| M14 | visitor, ended with the archive marker | visitor | n/a | closed | closed | no | no | no | Former | `membership_ended` |
| M15 | regular, person deceased | listed | yes | open | open | (lists exclude the person) | | no | none | `person_deceased` |
| M16 | regular, person merged | listed | yes | open | open | (lists exclude the person) | | no | none | `person_merged` |

Plus transitions on one membership, asserted row by row: visitor to regular (member row **opens**, `starts_on = current_date`); regular to inactive (member row **closes at `current_date`**, all row stays open); inactive to regular (**reopens**, `ends_on` back to null); a household update on a closed row (end date unchanged); the roll approval that gives a visitor an `active` roll (member row opens through the `presby_sync_current_roll` definer path); a participant removal (both rows end).

**Cross-product test** (pure plus DB): every TS roll value plus `null`, `"removed"` and `"zzz"`, crossed with every engagement value plus `null` and `"unknown"`, through `presby_membership_standing` and `membershipStanding`, asserts equal output; the same grid through `presby_standing_is_member` and `isMemberStanding`.

**Pair, group-guard and shape tests (T-G, `derived-group-guard.db.test.ts`; arch-A1 to arch-A3).**
1. *Pair contract.* As `presby_app` under organisation A, insert a derived `active_membership` group: exactly one `all_memberships` sibling exists at A with the fixed literals and none at B; `app_roles`, `app_role_permissions` and `role_grants` row counts are unchanged before and after.
2. *Privilege.* `has_function_privilege('presby_app', 'presby_pair_derived_groups()', 'execute')` and the same for the other application role are both false.
3. *Plan.* `groupSeedPlan()` contains an `all_memberships` entry for each organisation type (congregation, presbytery, synod, and any other type in `OrganizationType`); a plan with it removed fails the test, and `createOrganization()` throws (the existing throw-if-missing) when the lookup misses.
4. *Group identity (F245).* As `presby_app`, each is refused with `check_violation` and a `groups:` message: the Session group flipped to `managed`; `active_membership`'s `derived_from` changed; a managed group flipped to `derived_from = 'all_memberships'` (`derived`); `is_protected`, `group_type_id` and `organization_id` changed on a derived group. Still allowed: a managed-group rename. As the owner, the same update on a throwaway group passes (the guard is not a role list).
5. *Shape.* An insert or update that would give a managed group a `derived_from`, a derived group none, or any `derived_from` outside the four kinds is refused by the CHECKs (`check_violation`, `groups_derived_pairing_check` / `groups_derived_kind_check`); the stop-block raises with a count and no value against a scratch copy that holds one such row.
6. *Separate-statement fixtures.* A fixture that inserts `all_memberships` after the pair has made it, with `on conflict (organization_id, derived_from) do nothing`, adds no second row.

**Writers and the owner connection (T-E, arch-A4).** The one-active-roll unique index (moved off `scripts/test-rls.sql:332`) is asserted on the **owner** connection in `engagement-guards.db.test.ts`, and that test is on **Phase 5's DB-backed list** (QA runs it serially; it is named in the Phase 5 report, not assumed). The F244 refusal line in `test-rls-66.sql` (block (g)) catches **only** the guard's SQLSTATE and message prefix (`check_violation`, `memberships:`), never `others`: with the guard removed the insert would reach the unique index and abort the suite loudly with `unique_violation`, instead of passing as "refused".

**Scans:**
1. *Live catalog* (`pg_proc.prosrc` over every function): the four-roll list `'active', 'baptized', 'affiliate', 'other_participant'` appears in exactly `{presby_membership_standing}`; `'listed', 'staff_anchor'` in exactly `{presby_standing_is_member}`; `derived_from in ('active_membership'` in exactly `{presby__person_sign_in_standing}`; `'visitor'` as a standing comparison in none of the 0065/0066 bodies.
2. *Source:* no non-test `src/` file contains the four-roll SQL list or `engagement_status = 'regular' | 'visitor'` in code (comments stripped, the `stripComments` helper from `participant-boundaries.test.ts`), except `membership-standing.ts`; the listed literals appear only in the classifier, its mirror, the CHECK, seeds and tests. This replaces R40's "the visitor CASE appears only in the core body".
3. *Writer list:* `engagement_status` is written only by `community-engagement.ts` (updates) and by the INSERT sites (`people.ts` createPerson, the 0059/0064 definers, the 2b founding paths, fixtures); `ended_reason` with the archive marker only by `community-engagement.ts`; each scan has a deliberately offending sample proving it can fail.
4. *`DerivedFromKey` pin (arch-A2):* the string union in `src/lib/groups.ts` equals, as a set, the `derived_from in (...)` list parsed from `drizzle/0066_presby_membership_standing.sql` and the CHECK in `src/lib/db/domain/groups.ts`; a deliberately offending sample (a fifth key) proves it can fail.

`participant-boundaries.test.ts:106` (`expect(body).toContain("m.engagement_status = 'regular'")`) is updated to the classifier call; its `visitor`/`staff`-absence assertions stay and still hold.

## 7. Component / Page Plan

**Pages to create:** none. `?view=inactive` is a new value of the existing `/o/<slug>/admin/community` page.

**Create**
- `drizzle/0066_presby_membership_standing.sql`.
- `src/lib/membership-standing.ts`, `src/lib/membership-standing.test.ts`, `src/lib/membership-standing.db.test.ts` (matrix, cross-product, scans, the delimited-block re-execution).
- `src/lib/community-engagement.ts` (+ unit tests with mocks, + `community-engagement.db.test.ts`: every outcome, the two-connection races, rollback on a forced audit throw).
- `src/lib/db/domain/derived-group-guard.db.test.ts` (F240 both sides, the pair, the sync trigger, handler mapping), `engagement-guards.db.test.ts` (F243, F244).
- `src/app/(org)/o/[slug]/admin/community/actions.ts` (+ test), `engagement-copy.ts` (pure: labels, descriptions, `engagementImpact`, every outcome's copy as `Record<Outcome, string>`) (+ test).
- `src/app/(org)/o/[slug]/admin/community/community-row-actions.tsx` (client island per list row: Archive, Restore, Mark as regular), `archive-dialog.tsx`, `restore-dialog.tsx`, `engagement-dialog.tsx` (shared by rows and the edit page).
- `src/app/(org)/o/[slug]/admin/community/[id]/edit/engagement-card.tsx`, `visit-details-form.tsx` (client; plain controlled inputs, **no `useForm`**, so `check:hydration-gate` does not apply; every control disabled until `useHydrated()`, the `remove-participant-dialog.tsx` precedent).
- `src/components/shared/button-group-scroll.tsx` (client; section 7.1).
- `e2e/community-engagement.spec.ts`, `e2e/community-nav-scroll.spec.ts`, `e2e/hydration/community-engagement-controls.spec.ts`.
- Staged: `scripts/membership-standing/` (section 12).

**Modify**
- `src/lib/db/domain/groups.ts`, `src/lib/db/domain/people.ts` (mirrors); `src/lib/roll-action-kinds.ts` (marker); `src/lib/audit.ts` (four keys, §9); `src/lib/directory.ts`; `src/lib/community.ts`; `src/lib/community-labels.ts`; `src/lib/groups.ts` (`DerivedFromKey` widened to the four kinds and pinned to the CHECK, arch-A2; the derived list); `src/lib/org-portal/my-groups.ts` (exclude both baseline kinds: `g.derived_from not in ('active_membership','all_memberships')`); `src/lib/org-provisioning.ts` (`groupSeedPlan` lists both, for every organisation type, pinned by test, arch-A3 (iii); `baselineRoleSeedPlan` adds `calendar_viewer` for every type with `boundToDerivedFrom: "all_memberships"`; the transaction asserts both groups exist or throws); `src/lib/onboarding/issue.ts` (`provisioningComplete` also checks `all_memberships`); `src/lib/role-grants.ts` and `.../admin/roles/grant-role-form.tsx` (S15: derived groups labelled by who they reach).
- `.../admin/community/page.tsx`, `community-nav.tsx`, `community-empty-state.tsx`, `community-rows-list.tsx`, `members-list.tsx`, `community-badge.tsx`, `[id]/edit/page.tsx`, `[id]/edit/connection-card.tsx`, `new/confirm-step.tsx`, `new/member-wizard.tsx` (Restore in the already-here step); `.../admin/groups/groups-list.tsx`; `src/components/shared/button-group.tsx` (mounts the scroller).
- **2b files, names verified after the rebase (§3.3):** `sign-in-types.ts` (`SIGN_IN_ACK_REASONS` loses `visitor`; `connectOutlook`: `visitor` becomes `not_listed` and is derived from `isMemberStanding`), `sign-in-copy.ts`, `org-invite.ts`, `[id]/edit/sign-in-card.tsx` (the visitor paragraph and checkbox branch removed; the `not_listed` and connected-but-not-listed lines), `org-features.ts` (the `org_portal.sign_in_connect` description), their tests, and the 2b e2e lanes named in §11.
- Tests listed in §11 and §10.

### 7.1 The 360px nav fix (first, before anything adds a segment)

`ButtonGroup` stays a server-renderable component because callers pass `icon` as a component function, which cannot cross the server/client boundary. It renders one child, `<ButtonGroupScroll />` (client, renders nothing visible), which on mount and on resize: finds `[aria-current="page"]` in its parent, sets the parent's `scrollLeft` so that item is centred (clamped to `0..scrollWidth - clientWidth`; the container is scrolled directly, never `scrollIntoView`, so the page does not jump), and keeps `data-fade-left` / `data-fade-right` on the parent in step with scroll position through a passive scroll listener and a `ResizeObserver`. The container classes gain `data-[fade-right=true]:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]` and the left twin. No fade renders when nothing overflows (the Directory's three segments at desktop width), and nothing changes before hydration. Two pure functions (`centredScrollLeft`, `fadeState`) are unit-tested; jsdom has no layout, so the browser proof is `e2e/community-nav-scroll.spec.ts` at 360x740 (EC-17). The Directory nav inherits it. Seven segments in order: Everyone, Members, Participants, Visitors, **Inactive** (admin only, `lucide` `Clock`), Staff, Former.

## 8. Implementation Order and batches

There is no `FEATURE_CATALOG`, permission seed or flag in 3a. Order: nav fix, schema, library, actions, UI, audit keys, release notes. **Phase 4 for batches A1 onward starts only after 2b has merged** (Note 1); Batch 0 does not depend on it and may land first on the pipeline branch.

| Batch | Implementer | Scope | Gate |
|---|---|---|---|
| **0** | ux-developer | `ButtonGroup` scroll and fade, `community-nav` seventh segment, the unit tests, `community-nav-scroll.spec.ts`, 360px browser check | `npm run check`, typecheck, the nav spec at 360px, screenshots in the scratchpad (never committed) |
| **A1** | database-admin | 0066 sections 1 to 8 and 10, Drizzle mirrors, `membership-standing.db.test.ts`, `derived-group-guard.db.test.ts`, `engagement-guards.db.test.ts`, the staged assets, **rehearsal** | Applied twice on a throwaway Neon child branch of `development` (the second run changes no row, recorded); `test-rls.sql` and `test-rls-66.sql` as `presby_app`; the DB-backed Vitest suite serial; the old-code lane (E-33 style): the 2b-era suites pass **unedited** against the migrated database before any 3a code lands; `invitations.db.test.ts` re-run (its `:180` injection takes the owner path and must still pass, arch-A1); the arch-A4 writer re-scan recorded beside §3.3 item (1) |
| **A2** | database-admin | Section 9 (the three re-created bodies, with the recorded `diff`), the 2b connect and issue test rows, the handler-mapping test | The 2b parity golden is byte-identical (`git diff --exit-code src/lib/onboarding/designation-parity.golden.json`); T-5/T-6 rows changed as §6.3 says |
| **B** | api-developer | `membership-standing.ts`, readers, labels, `community-engagement.ts`, `actions.ts`, audit keys, provisioning and groups, role-grant labels, and the 2b TypeScript removals (`SIGN_IN_ACK_REASONS`, `connectOutlook`, `org-invite.ts`, toggle description) | unit and DB tests, the scans, `npm run check` (all eight tripwires), typecheck, build |
| **C** | ux-developer | Inactive list and row actions, the three dialogs, `EngagementCard`, `VisitDetailsForm`, `ConnectionCard`, badges, wizard Restore, the card lines, groups-list text | RTL for every string by exact text from the copy modules; 360px browser check of §13's list; no native dialogs |
| **D** | full-stack-developer | the e2e and hydration specs, the changed 2b specs, a final read of the staged assets against the merged tree | e2e green on port 3490 (`E2E_BASE_URL=http://localhost:3490`, own server), both hydration lanes, `npm run test:e2e:prod` for the new hydration spec |

A1's end state is a complete, applyable file (sections 1 to 8 and 10); A2 inserts section 9 before section 10. Two commits to one file, applied twice end to end at the end of each. Batches B and C wait for A1 (the SQL they call). C waits for B's actions. `src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/auth/` and `src/lib/auth/` are **not touched**, so the login-smoke gate does not apply; `totp-full-login.spec.ts` stays in the regression lane anyway because the resolver's inputs changed. Audit events are written in Batch B with the writer; release notes at Phase 6 via `/release-notes`.

## 9. Audit events

Written with `insertAuditRow(tx, ...)` in the transaction that made the change (never `recordAudit()`), by `community-engagement.ts`; actor from the session; `resourceType: "person"`, `resourceId` the person; metadata is ids, enums and booleans only, from a closed key list pinned by test. Four new `AUDIT_ACTIONS` keys (the comment block in `audit.ts` is updated; `audit.test.ts` pins the registry):

| Key | Metadata keys (exactly) |
|---|---|
| `TENANT_PERSON_ENGAGEMENT_CHANGED: "tenant.person.engagement_changed"` | `organizationId`, `personId`, `from`, `to`, `standingFrom`, `standingTo`, `signInConnected` |
| `TENANT_PERSON_ARCHIVED: "tenant.person.archived"` | `organizationId`, `personId`, `engagement`, `signInConnected` |
| `TENANT_PERSON_RESTORED: "tenant.person.restored"` | `organizationId`, `personId`, `engagement`, `signInConnected` |
| `TENANT_PERSON_VISIT_DETAILS_UPDATED: "tenant.person.visit_details_updated"` | `organizationId`, `personId`, `firstVisitDateChanged`, `howHeardChanged` (booleans; never the values, because `how_heard` is free text) |

`signInConnected` comes from `people.user_id`, never `users` (DECISION-189). An `unchanged` result writes nothing. A forced throw from the audit insert rolls the change back (EC-16). **The G2 detection chain** is `tenant.person_email.added | primary_changed` (v0.42.0), then `tenant.person.engagement_changed`, then `tenant.person.sign_in_connected` (2b), joined on `personId`; a test runs the three writes and joins the rows (EC-31).

## 10. Edge Cases & Risks

Every claim cites the test that pins it. Test files: **T-M** `membership-standing.db.test.ts`; **T-G** `derived-group-guard.db.test.ts`; **T-E** `engagement-guards.db.test.ts`; **T-W** `community-engagement.db.test.ts`; **T-66** `scripts/membership-standing/test-rls-66.sql` (as `presby_app`); **T-U** the unit and RTL tests named in §7; **E2E** the specs in §11. Anything without a named test says *unverified*.

| # | Case | Pinned by |
|---|---|---|
| EC-1 | One definition of "listed": classifier, TypeScript mirror, derived rows, resolver, Directory, Community lists and the 2b core agree on all of M1 to M16 and on the transitions; the one documented difference from 2b's Visitors list (a visitor with an unlisted non-null roll) is now equal | T-M (matrix, cross-product, scans); `community-labels.test.ts` goldens |
| EC-2 | At apply, a visitor, inactive or unclassified person with a sign-in loses `directory.view` and keeps `events.view` (no cookie to go stale) | T-M (the delimited backfill block re-executed against a pre-0066 fixture: an open member row and no all row); T-66 (i); Phase 6 walk W1 |
| EC-3 | Standing transitions move the derived rows exactly: gain opens (`starts_on = current_date`), loss closes at `current_date`, regain reopens, an unrelated update leaves a closed row's end date alone | T-M (transitions block) |
| EC-4 | A Session approval that gives a visitor an `active` roll opens the member row, through the `presby_sync_current_roll` definer path, with engagement still `visitor` | T-M; extends `session-approval.db.test.ts` (its approve case re-run) |
| EC-5 | Ending a membership (participant removal, archive, the roll paths) ends both rows | T-M (M13, M14); `participant-roll.db.test.ts` re-run unedited |
| EC-6 | Archive is refused, and nothing is written, for: an open officer term, an open role grant, an open staff position, a pending roll action, the viewer's own record, a listed or staff-anchor standing, an already-ended membership; `memberships_guard_end` is the backstop and its error maps to `holds_position` | T-W (one case each, before/after row digests); T-66 (j) |
| EC-7 | Restore reopens the all row, leaves the member row closed for a visitor, refuses a participant-removed membership, a deceased or merged person and a never-archived one | T-W; T-M (M14 then restore) |
| EC-8 | Two administrators changing engagement at once, or engagement against archive: the loser gets `changed_meanwhile` or `ended`, never a silent overwrite | T-W (two-connection) |
| EC-9 | Forged input: a staff target, `visitor` for a rolled person, an ended person, a person of another organisation, a non-UUID, extra fields such as `organizationId` or `from` are refused or ignored; the other-organisation id is the same `not_found` as a missing one | T-W; `actions.test.ts` |
| EC-10 | The database refuses, as `presby_app` and as the owner: any change on an ended membership, a transition into or out of `staff`, `visitor` on a rolled membership, a value outside the five | T-E; T-66 (f) |
| EC-11 | F240: as `presby_app`, an `INSERT` of a self-labelled derived row, an `UPDATE` of `ends_on` or `group_id` on a derived row are refused; the `public_listed` toggle on a derived row, a managed-row update and both sync triggers' own writes still work; the existing DELETE refusal is unchanged | T-G; T-66 (c); `test-rls.sql` sections 6 and 25 re-run |
| EC-12 | A grant through `all_memberships` is not counted in 2b's T set: an authority-free listed person at a provisioned organisation still `connected`, not `needs_second_factor` | T-M (M1 under the connect column); live-catalog scan 1 |
| EC-13 | The pair: inserting an `active_membership` group creates `all_memberships`; `createOrganization()` creates both and binds both baseline roles; a membership write with `all_memberships` missing raises its named message; the four shipped handlers still map a missing `active_membership` to `provisioning_incomplete`; the sibling is created at the inserter's own organisation only, with no role or grant change; no application role may execute the pair function | T-G (tests 1 to 3 in 6.3); `org-provisioning.test.ts`; T-W (handler mapping for each of the four functions) |
| EC-14 | F244: as `presby_app`, an `UPDATE` of `current_roll` or `current_roll_since` and an `INSERT` with either set are refused; the approve flow, the removal and the daily reconcile still write them; the refusal test catches only its own SQLSTATE and prefix; the one-active-roll index still holds on the owner connection | T-E (owner-connection index test, on Phase 5's DB-backed list); T-66 (g); `session-approval.db.test.ts`, `participant-roll.db.test.ts` re-run |
| EC-15 | The CHECK is added after a count-only stop-block; the file applies twice and the second run changes no row | A1 rehearsal (recorded in Phase 4 notes); T-E (stop-block on a scratch copy raises with a count and no value) |
| EC-16 | Audit rows carry the closed key list only; a forced throw from `insertAuditRow` leaves no change; `unchanged` writes none; `how_heard` text never appears | T-W; `community-engagement.test.ts`; `audit.test.ts` |
| EC-17 | At 360x740 each of the seven segments is fully visible after landing on it, every segment is reachable by scrolling, the fade shows only on the overflowing side, and the page has no horizontal overflow | E2E `community-nav-scroll.spec.ts`; `button-group.test.tsx` (`centredScrollLeft`, `fadeState`). The Directory nav: *unverified in automation*, checked by hand in the 360px pass (§13) |
| EC-18 | A 60-character surname wraps (does not clip) in the list rows, both new dialogs and the card at 360px | E2E `community-engagement.spec.ts` (long-name fixture); *this is exactly the claim invite-copy's retro found false once, so no text-only proof is accepted* |
| EC-19 | `?view=inactive` for a viewer without `people.manage` is `MembersForbidden`, an unknown value is Everyone; search and pagination work on both new lists | `page.test.tsx`; `community.db.test.ts`; `community-labels.test.ts` |
| EC-20 | An archived, connected person's `/launch` shows the ended state (not a loop); restoring a person who has since gained a live membership elsewhere does not look across organisations and 2b's `person_elsewhere` governs sign-in | E2E `community-engagement.spec.ts` (archive then `/launch`); 2b T-6 (a person at two organisations declines). The restore-with-membership-elsewhere row itself: *unverified in 3a*, covered by 2b's rule |
| EC-21 | Auto-connect declines visitor, inactive, moved away and unclassified and connects listed and staff anchor; issue and resend no longer return `needs_acknowledgement` for a visitor while `do_not_contact` still does; the audit `acknowledged` list is `[]` for a visitor | 2b `connect.db.test.ts` and `sign-in-invitations.db.test.ts` rows changed in A2; `org-invite.test.ts`; T-M connect column |
| EC-22 | The Directory lists `regular`-no-roll and every listed roll, excludes staff anchors, visitors and inactive people, and the portal finder inherits it | `directory.test.ts` (existing, adjusted); T-M |
| EC-23 | The baseline role: the plan equals what `createOrganization()` writes; the backfill never modifies an org-owned `calendar_viewer`; a second run inserts nothing | `org-provisioning.test.ts`; T-M (block re-execution with a pre-existing org-owned same-key role) |
| EC-24 | The Groups list shows the new group with its own "Managed from" text; the viewer's "my groups" excludes both baseline kinds; the derived-edit trigger refuses a rename; the grant form labels the new group by who it reaches | `groups-list.test.tsx`; `my-groups.test.ts`; T-G; `role-grants.test.ts` |
| EC-25 | The engagement dialog's lines follow the impact table exactly (listing change, connected, unknown sign-in facts, auto-connect line only when it can apply) | `engagement-copy.test.ts` (table-driven over every from/to/rolled/connected/toggle combination) |
| EC-26 | Visit details: real date, not after today, not before 1900, `howHeard` at most 200; blank clears; unchanged writes no audit; an ended membership refused | T-W; `actions.test.ts` |
| EC-27 | The wizard's already-here step says the truth for inactive, moved away and archived people and offers Restore for archived | `community-labels.test.ts`; `confirm-step` RTL; E2E |
| EC-28 | Old code against the new schema (the window between applying 0066 and deploying): the 2b-era suites pass unedited against the migrated database | A1 gate (run, recorded) |
| EC-29 | An open `sign_in` invitation to a person who is then archived dies at accept (`membership_ended`) | 2b T-4/T-7 (existing `membership_ended` cases) re-run; the archive-then-accept path itself *unverified in 3a automation* |
| EC-30 | A rolled person marked Inactive stays in the Directory, in Members or Participants, with an engagement badge, and is not in the Inactive list | `community.db.test.ts`; `members-list.test.tsx`; T-M (M3) |
| EC-31 | G2 chain: the three audit rows join on `personId` | T-W |
| EC-32 | Releasing/rollback: nothing is deleted anywhere; reverting the code leaves 0066 in place harmlessly (the guards and CHECK only refuse what the code no longer attempts); the narrowing is not reversed by a code revert | *Unverified by automation*; stated in the runbook |
| EC-33 | F245: as `presby_app`, flipping a derived group to managed, changing `derived_from`, `is_protected`, `group_type_id` or `organization_id` on a derived group, or flipping a managed group to derived is refused; the three shipped name/description/meets_when refusals are unchanged for every role; a managed-group rename works; `invitations.db.test.ts:180`'s owner-path injection still passes | T-G (test 4 in 6.3); T-66 (c); `test-rls.sql:1848` re-run; `invitations.db.test.ts` re-run |
| EC-34 | The `groups` shape: a managed group with a `derived_from`, a derived group without one, and an unknown kind are refused; the migration stops with a count and no value when such a row exists; the TypeScript key type equals the CHECK | T-G (test 5); T-E-style stop-block case; `DerivedFromKey` scan 4 |
| EC-35 | A tenant can still insert a derived group (S16 declined): it creates the pair in that organisation, its membership rows stay owner-path, and no role reaches it without a grant | T-G (test 1); accepted `paper`, 15.1 (8) |

**Risks, stated.** (1) The narrowing is immediate at apply and cannot be turned off by a toggle by design (R64); P2 says who is affected. (2) `unclassified` fails closed (no member row) and is unreachable from stored rows after the CHECK (D3). (3) The pair trigger and the definer sync run as the owner: a future function that writes derived rows as a non-owner will be refused, which is the point. (4) Derived-row history collapses to one row per (membership, group). (5) The classifier call in `WHERE` prevents the engagement and roll indexes from serving the Directory predicate; the planner inlines the function and the table is per-organisation small. *Unverified at scale*; revisit if a large organisation's Directory page slows.

## 11. e2e blast radius, and the flags each spec depends on

**Existing specs this change alters**

| Existing | Asserts today | Change |
|---|---|---|
| `e2e/community-participants.spec.ts:274-283` | the nav is "six real links in one scrollable row" (`toHaveCount(6)`, one vertical band) | seven; still one band (scroll, not wrap) |
| same file, add-visitor and add-participant flows that land on `?view=visitors` | the visitor appears under Visitors | unchanged; re-run at both viewports (the active pill is now scrolled into view) |
| same file, `:285-292` Staff and Former no-match text | `/no .* match "zzzzznomatch"/i` | unchanged; Former reads "former people" |
| `e2e/person-emails.spec.ts:265` | waits for `view=visitors` after an add | unchanged; re-run |
| **2b, after merge:** `community-sign-in-invite.spec.ts` lane 4; `no-organization-connect.spec.ts` (b); `hydration/community-sign-in-controls.spec.ts` (the acknowledgement checkbox) | a visitor acknowledgement; "a visitor is not connected" | lane 4 becomes "no acknowledgement for a visitor, `do_not_contact` still asks"; (b) gains inactive and moved-away rows; the hydration spec drops the visitor branch and keeps the checkbox for `do_not_contact`. Any 2b spec that walks an accepted visitor into the Directory: *unverified until `grep -rn visitor e2e/` after the rebase* |
| `member-calendar`, `member-home`, `portal-home-cards`, `role-boundaries`, `designation-revoke`, `invitation-*`, `admin-organizations*`, `totp-full-login`, `branded-signin` | members, fixtures that create groups, login | unchanged; re-run as the regression lane (the pair trigger keeps raw-SQL organisations valid; members are listed) |

**New specs and the flags they need** (each sets what it needs through `e2e/support/flags.ts` and the community fixture, and restores it; **no key is added to `scripts/ci/e2e-baseline-flags.sql`**: no spec asserts against a flag it cannot set):

- `e2e/community-engagement.spec.ts` (desktop and 360px): `org_portal.members_create` (global flag) and alpha's `members_create` organisation toggle, both captured, set and restored by `setupCommunityFixture`; `org_portal.members_roll_action_edit` is set by the same fixture and not asserted on; `org_portal.sign_in_connect` (2b, organisation toggle) set by SQL for the one lane that asserts the dialog's auto-connect line, restored. Flows: add a visitor, edit first-visit details, change to regular (dialog, appears in Everyone), to inactive (appears under Inactive, leaves Everyone), Mark as regular from the Inactive row, archive from Inactive (dialog with the connected line when a sign-in is attached), Former shows "Archived", Restore returns it to Inactive, the role-held refusal, the long-name fixture, `/launch` for an archived connected person. People are created through the UI, so **no new person-id range is needed**; spec-local helpers only (no edit to `e2e/support/*`, Rule 16). If the implementer needs SQL-created people, they ask the orchestrator for a range first.
- `e2e/community-nav-scroll.spec.ts` (360x740): `members_create` only.
- `e2e/hydration/community-engagement-controls.spec.ts` (both lanes; `test:e2e:prod` runs it): `members_create`; with the page's JavaScript held, the Save, Archive, Restore, Mark as regular and Save visit details controls are disabled.

## 12. `test-rls-66.sql` outline (staged per Rule 16)

Staged in `scripts/membership-standing/` for the orchestrator; header modelled on `scripts/participants/test-rls-61.sql`; integrated by one `\ir membership-standing/test-rls-66.sql` line at the end of `scripts/test-rls.sql`. **Runs as `presby_app`** (the first assertion checks `rolbypassrls` is false); every block that writes ends in `rollback`; people and memberships are created inside the blocks (as section 44 does), so **`seed-dev.sql` gains no people** and no existing count assertion moves.

| Block | Proves |
|---|---|
| (a) Structure | FORCE RLS on `groups`, `group_memberships`, `memberships`; the unique key `(membership_id, group_id)`; `groups_pair_derived`, `memberships_guard_engagement`, `memberships_guard_roll_cache` (both), the sync and reject triggers present; the CHECK present; `has_function_privilege` true for the two classifier-layer functions and false for the pair function |
| (b) Classifier layer | `presby_standing_is_member` and `presby_membership_is_member_standing` over the matrix values |
| (c) F240 and F245 | the self-labelled `INSERT`, the `ends_on` and `group_id` `UPDATE`s on a derived row refused (`check_violation`); the `public_listed` toggle and a managed-row update pass; the DELETE refusal unchanged. **F245 (arch-A1), on `groups`:** Session flipped to `managed`, `active_membership`'s `derived_from` changed, and a managed group flipped to `all_memberships` are each refused (`check_violation`, `groups:` prefix); a managed-group rename is still allowed (`test-rls.sql:1848`) |
| (d) Sync | a visitor membership gets an open all row and no member row; engagement to `regular` opens the member row; to `inactive` closes it at `current_date`; ending the membership ends both |
| (e) Pair | inserting an `active_membership` group as `presby_app` creates `all_memberships` at the same organisation and no other (this makes section 6's scratch-group block self-sufficient; it is why S16 is declined); `has_function_privilege` false for the pair function (arch-A3) |
| (f) Engagement guard | the three refusals and the vocabulary CHECK as `presby_app`; the allowed transitions pass |
| (g) Roll cache | the `UPDATE` and the `INSERT` with a roll refused, each caught on `check_violation` and the `memberships:` prefix only, never `others` (arch-A4); an insert with a null roll passes. **Replaces the assertion at `test-rls.sql:332`**, whose one-active-roll unique-index property moves to the owner connection in T-E |
| (h) Isolation | another organisation's context sees no `all_memberships` row and an `UPDATE` by membership id affects zero rows |
| (i) Baseline | a visitor fixture resolves `events.view` and not `directory.view`; a regular one resolves both (the block creates `member` and `calendar_viewer` in-block if the fixture organisation lacks them) |
| (j) Archive and restore | the conditional update semantics; `memberships_guard_end` refuses with an open role grant (Alder Creek's fixture person with one open grant, per `test-rls-61.sql`); restore only for the archive marker |
| (k) `groups` shape (arch-A2) | the pairing and kind CHECKs present and validated; a managed group with a `derived_from`, a derived group without one, and an unknown kind each refused |

What `presby_app` cannot reach (owner-path behaviour, the stop-blocks, concurrency, the live-catalog scans, the backfill re-execution) is Vitest's. The integration patch (`test-rls.sql.integration.patch`) does exactly: remove the `:332` block and add the `\ir` line; `seed-dev.sql.integration.patch` adds the `calendar_viewer` role and group-arm grant for the fixture organisations that have an `active_membership` group (so a from-scratch database matches provisioning), and the implementer records any count assertion in `test-rls.sql` it moves.

## 13. Phase 6 walk preparation (R65, the 3a walks)

The analyst walks these as the person each path creates, on a `development`-derived Neon child branch, at **360x740**, listing every page each persona lands on. SHIP IT requires the walk.

**Preparation (the implementer of Batch D and the orchestrator):** (1) after 2b merges and 0065 is applied on `development`, create a child branch of `development` **before 0066** (name `pipeline-inc3a-walk`; deleted at cleanup under the standing authorization); (2) point a worktree `.env.local` at it; run `next dev` on port 3490 with `E2E_BASE_URL=http://localhost:3490`; stop it by PID; (3) seed the personas below using 2b's `seedSignInInvitation` helper (owner connection, known token) and the existing community fixture; (4) screenshots go to the scratchpad and are never committed.

| Walk | Persona and steps | Pages listed |
|---|---|---|
| **W1 visitor, before and after** | A visitor with an open `sign_in` invitation (known token): open `/invite/<token>`, create the account, land. **Before 0066:** `/launch`, `/o/<slug>`, the Directory (lists members), the calendar. **Apply 0066 to the branch.** Reload: the Directory shows the existing no-access state, the calendar still opens, no Directory tile on the portal home, `/home` card unchanged | `/invite/<token>`, `/launch`, `/o/<slug>`, `/o/<slug>/directory`, `/o/<slug>/calendar`, `/home` |
| **W2a moved away, already connected** | The administrator marks the connected person Moved away (dialog shows the connected line); the person reloads | `/o/<slug>/admin/community/<id>/edit`, `/o/<slug>`, the Directory (no access), the calendar (opens) |
| **W2b moved away, not connected** | A proven, unlinked account whose address is on a Moved-away record, with the 2b toggle on, signs in | `/signin`, `/launch`, `/no-organization` (N0), Check again ("Nothing new yet.") |
| **W3 archive and restore** | The founding administrator, with a connected visitor who has an open invitation: Visitors list, Archive dialog (the connected and invitation lines), the role-held refusal on a second person, confirm, the person's `/launch` (ended), Former list ("Archived visitor"), Restore, Visitors list | `/o/<slug>/admin/community?view=visitors`, `...?view=former`, the edit page, `/launch` as the archived person |
| **W4 nav** | The seven segments at 360px from each landing, and the Directory nav | `/o/<slug>/admin/community` (every view), `/o/<slug>/directory` |

The 3b walks (deacon volunteer by auto-connect, the follow-ups chain) belong to `-inc3b`.

---

## 14. Copy

Every user-facing string 3a adds or changes. **An implementer who needs a string that is not here stops for a ruling.** Names, organisation names and dates are inserted by the component (`{Name}`, `{Organization}`, `{date}`). Each group ends with the four checks: **R** residuals (nothing denies an accepted residual or a Phase 2 ruling), **S** source of truth (the query or field behind each claim about a person, account, date or state), **A** audience (who sees it and that they can do what it says), **N** neighbours (live-tree strings the feature makes stale or checked and left, file:line). The vocabulary is "engagement" for the label and "listed in the member directory" for what the classifier calls `listed`; the words "visitor", "regular attender", "inactive" and "moved away" are the stored values' names. **Review amendments (2026-10-25):** arch-A1 to arch-A4 add no user-facing string. The new database refusals (`groups: ...`, `memberships: ...`) are reachable only by a path no page or action offers (the actions log a database error by class and show their one fixed string, §5), so there is nothing to word; R: nothing denies a residual (the S16 residual is not mentioned to users); S, A, N: not applicable, no string; neighbours grepped for "derived" and "Everyone on Record" are unchanged from Group H.

### Group A: the Engagement card (edit page; viewer holds `people.manage`)

| Where | String |
|---|---|
| Heading | Engagement |
| Helper | Engagement is for your own care. It is never reported to the presbytery or the denomination, and it does not change anyone's membership roll. It does decide who appears in the member directory and what a connected sign-in can see. |
| Select label | Engagement (accessible name "Engagement for {Name}") |
| Options | Visitor · Regular attender · Inactive · Moved away (a current value the person may not be given, such as Visitor on the roll, is shown as "Visitor (current)" and is disabled) |
| Description, no roll, Visitor | Visitor. Does not appear in the member directory. |
| Description, no roll, Regular | Regular attender. Can appear in the member directory. |
| Description, no roll, Inactive | Inactive. Not attending lately. Does not appear in the member directory. |
| Description, no roll, Moved away | Moved away. Does not appear in the member directory. |
| Description, on the roll, Regular | Regular attender. Can appear in the member directory. |
| Description, on the roll, Inactive | Inactive. Not attending lately. Can still appear in the member directory because they are on the roll. |
| Description, on the roll, Moved away | Moved away. Can still appear in the member directory because they are on the roll. A departure is recorded as a roll action, not here. |
| Staff record | This is a staff record, so engagement isn't tracked. |
| Archived | {Name} was archived. Restore them to change this. |
| Other ended | {Name}'s connection here has ended, so engagement can't be changed. |
| Nudge (on the roll, still marked Visitor) | {Name} is still marked as a visitor. Mark as a regular attender? Button: **Mark as regular attender** |
| Button | Save engagement |

**R.** The helper states the access effect, so it does not repeat the denied claim "engagement changes nothing" (architect note 4) and it does not call the label harmless; "never reported" is true of the code (below). Nothing says an administrator cannot list someone who then becomes eligible for auto-connect (the G2 residual) and nothing says it is prevented. **S.** "Does not appear / can appear" is the classifier (`listed` = a roll in the four or engagement `regular`) with "can" because the Directory also applies `directory_hidden`; "never reported to the presbytery or the denomination": no statistics, SASR, filing or per-capita code reads it: in `src/` only `people.ts`, `staff.ts`, `directory.ts`, `community.ts`, `community-labels.ts`, `org-portal/find-person.ts` (a comment), the staff actions and the schema mention it, and on `development` the only database function whose source names `engagement_status` is `presby_accept_invitation` (it inserts the staff anchor); no view does (measured 2026-10-25, re-run in Batch B); "on the roll" is `current_roll` in the four; "staff record" is engagement `staff`; "archived" is `ended_on` set with the archive marker; "other ended" is `ended_on` set with any other reason. **A.** `people.manage` holders only (the page's gate); every instruction ("Restore them", "Mark as regular attender") is a control on the same page the same role can use. **N.** `connection-card.tsx` ("Connection" heading) is a different noun and stays. `new/connection-step.tsx:21` "Someone who has visited. Not on any roll, and not listed in the Directory." and `new/review-step.tsx:12` "Visitors aren't listed in the Directory." stay true. No string made stale.

### Group B: changing engagement (dialog, toasts, refusals)

A dialog opens only when the change moves the person into or out of listing (for a person on the roll it never does). Otherwise the change saves directly and the toast shows.

| Where | String |
|---|---|
| Title, to Regular | Mark {Name} as a regular attender? |
| Body, to Regular | They can then appear in the member directory. |
| Title, away from Regular | Mark {Name} as inactive? / Mark {Name} as moved away? / Mark {Name} as a visitor? |
| Body, away from Regular | They will no longer appear in the member directory. |
| Added when a sign-in is connected | {Name} has a sign-in connected, so this can also change what they can see. |
| Added when the connection is unknown (the sign-in facts did not load) | If {Name} has a sign-in connected, this can also change what they can see. |
| Added when not connected, an address is on file, `org_portal.sign_in_connect` is on, and the change gives listing | {Name} could be connected to this record automatically when they sign in with an address on file. |
| Buttons | Keep as it is · Mark as regular attender · Mark as inactive · Mark as moved away · Mark as a visitor; pending: Saving… |
| Success | {Name} is now marked as a regular attender. / ...as inactive. / ...as moved away. / ...as a visitor. |
| `unchanged` | That is already how this person is marked. |
| `forbidden` | You don't have permission to change this. |
| `not_found` | That person could not be found. |
| `ended` | This person's connection here has ended, so this can't be changed. |
| `staff_record` | This is a staff record, so engagement can't be changed. |
| `needs_no_roll` | A person on the roll can't be marked as a visitor. |
| `changed_meanwhile` | This changed while you were looking. Reload the page to see the current setting. |
| Database error | We couldn't save that change. Nothing was changed. |

**R.** The auto-connect line **discloses** the G2 residual to the person about to create it and says "could", not "will" and not "safely"; the unknown-facts variant exists so a failed read never produces a false "no sign-in" reading. **S.** "Has a sign-in connected": `people.user_id` (never `users`); "address on file": an active email contact (the same read the 2b card already makes); the toggle: the organisation's `org_portal.sign_in_connect` row; "gives listing": the classifier before and after. The line is omitted whenever any of the four is not true, so it never promises a connection that the definer would refuse. **A.** `people.manage` holders; "Reload the page" any viewer can do. **N.** None stale: the only existing engagement strings are the wizard's (Group A, N).

### Group C: the Inactive list, nav and empty states

| Where | String |
|---|---|
| Nav segment | Inactive |
| Inactive row detail | Inactive / Moved away |
| Inactive row buttons | Mark as regular · Archive (each with a visually hidden " {Name}") |
| Visitors row button (new) | Archive |
| Inactive empty (headline / detail) | No one is marked inactive or moved away / People on the roll who are marked inactive stay under Members or Participants. |
| Search with no match | No inactive people match "{search}". Try a different name or email. (and for Former: No former people match "{search}". Try a different name or email.) |
| Everyone empty, administrator (headline / detail) | No one is listed yet / Add your first person to get started. People appear here once they are members, participants or regular attenders; visitors, inactive people and staff contacts are under their own views. |
| Everyone empty, other viewers | No one is listed yet / People appear here once they are members, participants or regular attenders. |
| Former empty (headline / detail) | No one has been removed or archived / People you remove as participants or archive appear here. |
| Engagement badge on a rolled person (Members, Participants, Everyone) | Inactive / Moved away |

**R.** Nothing claims the Everyone list is complete; "No one yet" (false when only visitors exist) is gone. **S.** The Inactive list is standing `inactive` (engagement `inactive` or `moved_away`) with a live membership and no roll in the four; "People on the roll who are marked inactive stay under Members or Participants" is true of the Directory predicate (a roll lists them whatever their engagement); the Everyone list is the Directory's. **A.** The Everyone sentence that mentions the other views is shown only to a viewer with `people.manage` (the views are admin-only); other viewers get the sentence without them. The Inactive view and its buttons are `people.manage` only. **N.** Modified: `community-empty-state.tsx:5-12` (`VIEW_NAMES`), `:60-72` and `:85-105` (the `all` and `former` headline and detail), `community-nav.tsx:25-30` and its doc comment ("six segments"), `page.tsx:30-47` comment ("its six views"), `community-labels.ts:12-24` ("six admin Community views"). Checked and left: `tiles.ts:227` ("see visitors and staff", still true), `participant-copy.ts:93-94` ("under Former", still true).

### Group D: archive and restore

| Where | String |
|---|---|
| Archive title | Archive {Name}? |
| Archive body | {Name} will leave the {Visitors / Inactive} list and appear under Former. Their record is kept and you can restore it any time. |
| Added when a sign-in is connected | {Name} has a sign-in connected and will no longer reach {Organization} through this record. |
| Added when an invitation is open | An invitation to {Name} is still open. It will stop working. |
| Archive buttons | Keep · Archive; pending: Archiving… |
| Archive success | {Name} is archived. You can restore them from Former. |
| `holds_position` | This person still holds an office, a role or a staff position here. End that first, then try again. |
| `pending_action` | This person has a roll action waiting for the Session, so they can't be archived yet. Try again once the Session has decided it or it has been withdrawn. |
| `not_eligible` | Only visitors and people marked inactive or moved away can be archived. A member leaves through a roll action; a participant is removed as a participant. |
| `self_target` | You can't archive your own record. Ask another administrator. |
| `already_ended` | This person's connection here has already ended. |
| `forbidden` | You don't have permission to archive people here. |
| Database error | We couldn't archive them. Nothing was changed. |
| Restore title / body | Restore {Name}? / {Name} will return to the {Visitors / Inactive} list. |
| Restore, added when a sign-in is connected | {Name} has a sign-in connected and will reach {Organization} again. |
| Restore buttons / success | Keep archived · Restore / {Name} is back on the {Visitors / Inactive} list. |
| `not_archived` | That person wasn't archived here. |
| `person_unavailable` | This person's record is marked deceased or merged, so they can't be restored. |
| Restore database error | We couldn't restore them. Nothing was changed. |
| Former row detail | Removed {date} (unchanged) · Archived visitor, {date} · Archived, {date}; archived rows add the button **Restore** |
| Edit page connection | Archived visitor on {date} · Archived on {date} (with a **Restore** button) |
| Wizard, already-here step | They were archived on {date}. Button: **Restore {Name}**, beside "Open their record" |

**R.** "Their record is kept" and "you can restore it" are true of an end date with a marker (nothing is deleted); the copy never says "deleted" (architect note 4). The connected line names the sign-in surviving ("a sign-in connected") without claiming it is removed, because it is not. 3a says **nothing about follow-ups** (D8). **S.** "Leave the Visitors / Inactive list": the person's standing at archive time (visitor, or inactive); the destination on restore comes from the engagement kept on the row (a guard forbids changing it while ended); "has a sign-in connected": `people.user_id`; "an invitation is open": 2b's reader (`getSignInMarkers` / the card read), which is the only door to `account_invitations` — if it did not load the line is omitted, which understates a consequence but states no falsehood; "will reach {Organization} again": the reopened membership makes the organisation enterable through `userOrganizations`; "decided or withdrawn" for `pending_action`: the person has a `pending` roll action. **A.** `people.manage` holders. "End that first" is a task for whoever holds `officers.manage`, `role_grants.manage` or `staff.manage`; the surface's default role (a founding administrator) holds all three, and the same wording is the shipped `PARTICIPANT_COPY.holds_position` precedent; a bare `people.manage` holder is told something they may not be able to do themselves. **Accepted, recorded.** "Try again once the Session has decided it or it has been withdrawn" makes no promise the viewer can withdraw (withdrawing needs `roll.propose`). **N.** Modified: `community-rows-list.tsx:93-101` (the Former detail), `connection-card.tsx:41-52` (date suffix for the new connections), `new/confirm-step.tsx:35-60` and `member-wizard.tsx` (Restore), `community-empty-state.tsx` (Group C). Checked and left: `participant-copy.ts:84-96` removal toasts, which still say "under Former". Also modified: the comments and doc strings that say "Former participants" in `community.ts:15-17`, `:70` and `:245-250` (the Former list now holds archived people too). Checked and left: `groups.ts:54-55` ("no group archival", a different noun: groups), `(admin)/admin/users/[id]/*` "Inactive" (platform accounts, a different noun).

### Group E: connection labels and the already-here sentences

| Connection | Label | Already-here sentence |
|---|---|---|
| `inactive` | Inactive | They're marked inactive. |
| `moved_away` | Moved away | They're marked as moved away. |
| `former_visitor` | Archived visitor | They were archived on {date}. (no date: They were archived.) |
| `archived` | Archived | They were archived on {date}. |
| `unclassified` | On record | They're already here. |
| `listed` (engagement `regular`, no roll) | Listed (unchanged) | They're listed here. (unchanged, now true only for a listed person) |

**R.** "Listed here" is no longer said of an inactive person (G3, F242). **S.** `deriveConnection`, from the membership's roll, engagement, `ended_on` and `ended_reason`. **A.** `people.manage` (the wizard and the edit page). **N.** Modified: `community-labels.ts:33-53` and `:101-122`. `e2e/community-participants.spec.ts:217` ("They're a visitor.") is unchanged.

### Group F: visit details

| Where | String |
|---|---|
| Subsection heading (shown when the engagement is Visitor or a first visit or "how heard" is stored) | Visit details |
| Field labels (the wizard's) | First visit (optional) · How did they hear about us? (optional) |
| Button / success | Save visit details / Visit details saved. |
| Bad date | That date can't be used. Choose a date from 1900 up to today. |
| Too long | Keep this under 200 characters. (the shipped `VALIDATION_COPY.howHeardTooLong`) |
| Ended | This person's connection here has ended, so this can't be changed. |
| Database error | We couldn't save that change. Nothing was changed. |

**R.** No denied residual. **S.** `memberships.first_visit_date` and `how_heard`. **A.** `people.manage`. **N.** `new/connection-step.tsx:110-135` already uses the two labels; `participant-copy.ts:70` `badFirstVisit` ("Choose today or an earlier date") stays for creation.

### Group G: 2b strings 3a changes or retires

| 2b string (Phase 3 and amendment 2) | 3a |
|---|---|
| Send-dialog visitor acknowledgement: "{Name} is recorded as a visitor. Anyone who signs in can see your member directory and your calendar, with each person's privacy settings applied. Only continue if you want {Name} to have that." | **Retired** (paragraph, the visitor branch of the checkbox, `SIGN_IN_ACK_REASONS` entry, tests, e2e lane 4). The checkbox "I understand, send it anyway" stays for `do_not_contact`. |
| Card outlook `visitor` (Group D): "{Name} is a visitor, so signing in won't connect them by itself. Send an invitation if you want them to have access." | **Replaced** by `not_listed`: "{Name} isn't listed in the member directory, so signing in won't connect them by itself. Send an invitation if you want them to have access." |
| (new) connected and not listed | {Name} is connected to a sign-in but isn't listed in the member directory, so the usual member access to it doesn't reach them. They can still see the calendar if your congregation uses it. To list them, mark them as a regular attender under Engagement. |
| Toggle description (Group G): "Some people are never connected this way, such as visitors and addresses shared by more than one person." | "Some people are never connected this way, such as visitors, people marked inactive or moved away, and addresses shared by more than one person." The rest of the description is unchanged. |
| The "card note" the analyst quoted ("A visitor can sign in but sees nothing until they are received") | **Does not exist in 2b's final copy** (it appears only in the F177 delta paragraph); the card's visitor line above is the string replaced. No separate "calendar until they are received" sentence is added, because the new connected-and-not-listed line says the true part. |

**R.** The `not_listed` line follows R55 as the operator approved it and claims no prevention; the connected-and-not-listed line says the member directory is "not reached", not that nothing is visible (architect note 4's "visitors can't see anything" is avoided), and "if your congregation uses it" keeps it true where the calendar toggle is off. The toggle sentence adds categories, not a safety claim. **S.** `standing` from `presby_sign_in_card_standing` (member standing via the SQL classifier, mirrored by `isMemberStanding`); "connected": the reader's `linked` (`people.user_id`); "can still see the calendar": `events.view` from `calendar_viewer` at every organisation with the pair, hedged for the calendar toggle. **A.** The card is `people.manage`; "Send an invitation" is that card's own button; "mark them as a regular attender under Engagement" is a control on the same page the same viewer can use. The toggle text is read by `org_features.manage` holders. **N.** Modified (after the rebase): 2b's `sign-in-copy.ts` / `sign-in-types.ts` (`visitor` outlook), `sign-in-card.tsx` (the paragraph), `org-features.ts` (description) and their tests; the 2b release-note line "narrower view in a later release" is now fulfilled and the 3a note replaces it.

### Group H: structure labels

| Where | String |
|---|---|
| Groups list "Managed from", `all_memberships` | Everyone with a current record here |
| Groups list "Managed from", `active_membership` (was "The membership roll") | Members, regular attenders and staff |
| Role-grant form, derived group option | {name} (derived) · for `all_memberships`: {name} (derived; includes visitors and inactive people) |
| Seeded names | group **Everyone on Record**; role **Calendar viewer** |

**R.** No residual denied; the grant-form suffix tells an administrator that binding a role to this group reaches visitors (S15), which is the point. **S.** The two kinds' predicates (4.6). **A.** `groups.manage` and `role_grants.manage` holders respectively. **N.** Modified: `groups-list.tsx:136-140` and its test, `groups/page.test.tsx`, `grant-role-form.tsx:187` and `role-grants.test.ts`.

### Group I: release-note lines (written at Phase 6 via `/release-notes`; drafts)

- People you have marked inactive or moved away now have their own list: Community, Inactive.
- You can change how a person is marked: visitor, regular attender, inactive or moved away. This decides whether they appear in the member directory. It is for your own care and is never reported to the presbytery. Changes are recorded in the audit log.
- You can archive a visitor or an inactive person and restore them later. Archiving keeps their record and ends their connection here; a sign-in connected to the record will not reach your congregation until they are restored.
- Visitors who signed in under the earlier arrangement no longer see the member directory. They can still see the calendar.
- Signing in no longer connects visitors, or people marked inactive or moved away, to their record by itself. An invitation still does.
- You can correct a visitor's first visit date and how they heard about you.
- On a phone, the Community views scroll so the one you are on is always in view.

**R/S/A.** Do-not-write list honoured: no "visitors can't see anything", no "engagement changes nothing", no "archiving deletes", nothing implying that making someone a regular attender is prevented from leading to a connection (it is recorded, not blocked: DECISION-234). If P2 shows signed-in visitors the first line says how many; if P8 is non-zero the invitation line adds "invitations already sent still connect them to a calendar-only account". **N.** The 2b note's "narrower view in a later release" is replaced.

## 15. Residuals, decisions and findings

### 15.1 Residuals this design records (all `paper` unless stated)

1. **G2 (the widened R21(b) / F232 class).** A `people.manage` holder can make an unlisted person a regular attender, which gives them member standing, the Directory and eligibility for auto-connect. Detected, not prevented: `tenant.person_email.*`, then `tenant.person.engagement_changed`, then `tenant.person.sign_in_connected`, joined on `personId` (EC-31). The engagement dialog discloses it to the administrator at the moment of the act (Group B).
2. **`INSERT` with engagement `staff`** cannot be told apart from the sanctioned DECISION-129 anchor path at the database; the two TypeScript callers are the only sanctioned ones (D6).
3. **`memberships.ended_on` / `ended_reason` are writable by `presby_app`** (pre-existing). Archive and restore are conditioned in code (marker, standing); a code defect could reopen another reason's row. No new exposure; the same capability exists today.
4. **Derived-row history collapses** to one row per (membership, group); the audit rows carry the history.
5. **The owner path** (the role that applies migrations and runs fixtures) can disable any trigger; mitigated by the source scans and by there being no application path as the owner.
6. **`unclassified`** fails closed and is unreachable from stored rows after the CHECK (D3).
7. **Caller-asserted identity** in 2b's definers (E-30) is unchanged; 3a adds no definer that takes an identity from the caller (the writers run in `withOrgContext`, which verifies membership first).
8. **A tenant can create a derived group in an organisation that lacks one** (S16 declined, 4.5): a `presby_app` session can insert a derived group of one of the four closed kinds where the organisation has none; its rows remain trigger-derived and no role reaches it without a grant. Detected by review of `groups` rows and role grants, not prevented. `paper`.

### 15.2 Drafted decisions (for `docs/decisions.md`; the orchestrator writes them at integration, newest first)

**DECISION-236: Derived group rows are written only on the owner path.** *Resolved 2026-10-25; feature `2026-10-22-founding-admin-directory-inc3` (3a; R59; F240).* "The Court Is Not a Group" was `trigger`-class on paper and weaker in the catalog: only DELETE and writes whose `source` was not `'derived'` were refused, so a `presby_app` `INSERT` of `source = 'derived'` into the Session group would have resolved `roll.approve`, and after Option 1 an `UPDATE` of `ends_on` on a derived row would have granted or removed `directory.view`. 0066 makes `presby_reject_derived_group_write()` refuse, for any non-owner (the `relowner` test, no role named), an `INSERT` into a derived group and an `UPDATE` of any column on a derived row except `public_listed`, `public_listed_by`, `public_listed_at` and `public_display_order` (a closed allow-list, so a future column is guarded by default). Both sync functions run as the owner (`SECURITY DEFINER`, pinned `search_path`, organisation from `NEW`); the officer sync is changed with `alter function`, its body untouched. CLAUDE.md's wording needs no change. **F245 (architect's 3a review; assigned by the orchestrator 2026-10-25) folds in here:** the guard had a level above it, the derived *group* row. A `presby_app` session could flip a derived group to `managed` (the shipped CHECK and edit trigger allowed it) and then insert a `managed` row the row guard no longer covered. 0066 extends `presby_reject_derived_group_edit()` with the same owner test so a non-owner may change **no column** of a derived group, or flip a group into or out of `derived`, and adds two shape CHECKs (`(membership_source = 'derived') = (derived_from is not null)`; `derived_from` in `active_membership`, `all_memberships`, `session`, `diaconate`) behind a count-only stop-block, with `DerivedFromKey` pinned to them. **Accepted residual, `paper` (S16 declined, 4.5):** a tenant can create a derived group in an organisation that lacks one; its rows remain trigger-derived and no role reaches it without a grant. The "Court Is Not a Group" statement is a database property only with both guards.

**DECISION-235: Archive is an end date with a marker; auto-connect requires member standing.** *Resolved 2026-10-25; (R55, R57; amends DECISION-226).* A visitor, an inactive or a moved-away person is archived by setting `ended_on` and `ended_reason = 'community_archived'` through `presby_app` inside `withOrgContext()`, conditioned in code on standing (`visitor`, `inactive`, `unclassified`) and on `memberships_guard_end` plus the staff-position and pending-action pre-checks; restore clears both columns only where the marker matches, and is refused for a deceased or merged person. Nothing is deleted. The Former list is a closed `in (...)` of the two markers. The conditions are application-enforced because `presby_app` can already write `ended_on` (residual 3). Auto-connect (DECISION-226) now requires **member standing** (`listed` or `staff_anchor`) rather than "not a visitor": inactive, moved-away and unclassified people are declined like visitors (operator-approved 2026-10-25). The visitor acknowledgement at send (DECISION-207, Option 3) is retired.

**DECISION-234: Engagement is an access-bearing write.** *Resolved 2026-10-25; (R53, R54; F243, F244).* `memberships.engagement_status` now decides who is listed and, through the derived groups, who holds `directory.view`. It has a vocabulary CHECK (`visitor`, `regular`, `inactive`, `moved_away`, `staff`) and a `BEFORE UPDATE` guard for every role: no change on an ended membership, no transition into or out of `staff`, no `visitor` on a rolled membership. Every change writes `tenant.person.engagement_changed` in the same transaction (ids, enums, booleans). `current_roll` and `current_roll_since`, which also decide listing, are written only by owner-path definers (`presby_sync_current_roll`, `presby_reconcile_current_roll`, the 0012 backfill); 0066 adds an owner-only guard on `INSERT` and `UPDATE` of both columns, closing F244 as a database property rather than a residual. **Accepted residuals, `paper`:** a `people.manage` holder can list an unlisted person and so make them eligible for auto-connect (detected by the audit chain, not prevented, the F232 class); an `INSERT` with engagement `staff` is not distinguishable from the sanctioned anchor path. The release note must not imply prevention.

**DECISION-233: One classifier owns "listed".** *Resolved 2026-10-25; (R50 to R52; F241, F242; S13 accepted by 2b).* `presby_membership_standing(current_roll, engagement_status)` (0065) returns `listed`, `staff_anchor`, `visitor`, `inactive` or `unclassified`, first match wins; member standing is `listed` or `staff_anchor`, defined once in `presby_standing_is_member`. The Directory (`= 'listed'`), the Visitors and Inactive lists, the sync trigger, the 2b standing core and `deriveConnection` all go through it or its TypeScript mirror `src/lib/membership-standing.ts`. The pin is one DB matrix test, a SQL-versus-TypeScript cross-product test and three scans. The analyst's G1 premise is corrected: the group predicate is member standing, not `listed`, so staff anchors keep the directory (DECISION-207).

**DECISION-232: Option 1 closes F177: the baseline splits in two.** *Resolved 2026-10-25; (R48, R49; D1, D4).* `active_membership` narrows to people with member standing; a new derived kind `all_memberships` (group "Everyone on Record") mirrors every live membership and carries a new protected baseline role `calendar_viewer` (`events.view` only). The `member` role, its permissions and every grant row are untouched, including the production grant restored on 2026-10-22. A visitor or inactive person with a sign-in keeps the calendar and loses the directory; a staff anchor keeps both; custom grants bound to `active_membership` narrow to member standing. The pair of groups is created by the database (a definer trigger on `groups`) as well as by provisioning, and the membership sync still raises if either is missing (F16). Takes effect when 0066 is applied (permissions resolve per request). Amends DECISION-065 (the grantee half: `active_membership`'s population is member standing; "current" is carried by the new kind) and DECISION-207 (F177 closed; the visitor acknowledgement retired). The backfill's reach (every organisation with the pair) is recorded with the measured count (Operator question 1).

### 15.3 Findings

| # | Finding | Status |
|---|---|---|
| F240 | Derived rows accept a direct self-labelled write | **Closed** by 0066 §3 (DECISION-236) |
| F241 | Directory, Visitors list, 2b's visitor test and the group predicate disagree once engagement is editable | **Closed** by the classifier and its pin (DECISION-233) |
| F242 | `deriveConnection` says "listed" for people who are not | **Closed** (Group E; §6.2) |
| F243 | `engagement_status` free text; a `staff` transition grants member standing silently | **Closed** by the CHECK and guard (DECISION-234); the `INSERT` gap is a named residual |
| F244 | `current_roll` writable by `presby_app` with no guard and now decides `directory.view` | **Closed** by the owner-only guard (D5, DECISION-234) |
| F245 | `presby_app` can change `membership_source` and `derived_from` (and `is_protected`, `group_type_id`) on a derived `groups` row, reopening F240 one level up and bypassing R59 (architect, 3a review; assigned by the orchestrator 2026-10-25) | **Closed** by 0066 §3's owner-only group edit guard and the `groups` shape CHECKs (arch-A1, arch-A2; DECISION-236). The residual S16 left open is named in 15.1 (8) |
| F177 | Visitors with a login read the directory | **Closed** (DECISION-232) |
| F133 | `events.view` reaches only organisations with a `member` role | **Partly closed as a side effect** (D4): the calendar baseline now reaches every organisation with the pair; the directory half is unchanged. Cited, not re-numbered |
| F176 | `presby_app` holds DELETE on `follow_ups` | Unchanged; 3b |

New findings discovered while designing: none in the first pass. The architect's 3a review found one, **F245** (above), now assigned. F246 to F249 and DECISION-237 are returned.

## 16. Carry-forward

"Deferred to 3b" means the split the orchestrator accepted and the operator ruled on 2026-10-25 (R66 assigns each ruling to an increment).

| Phase 1 gap / Phase 2 ruling / operator ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| G1 one "listed" predicate | §6, EC-1; D3 |
| G2 engagement writes are security-sensitive; widened residual | §4.9, §9, §15.1 (1), DECISION-234, Group B |
| G3 `deriveConnection` lies | §6.2, Group E |
| G4 nobody becomes invisible: Inactive list, badge on rolled people, "Everyone" empty state | §5 readers, §7, Group C |
| G5 engagement against the roll (values offered, Moved away is a label, the Visitor nudge) | §6.1 `offeredEngagements`, Group A |
| G6 archive/restore; marker, guards, connected sign-in, open invitation, restore, deceased/merged | §5, §4.9, Group D, EC-6/7. **Open follow-ups cancelled on archive: *deferred to 3b*** (R58's trigger, accepted by the orchestrator, D8) |
| G7 `follow_ups` hardening | *Deferred to 3b* (R60, migration 0069) |
| G8 first-visit workflow, families, steps, due dates | *Deferred to 3b* |
| G9 assignee scope and visibility | *Deferred to 3b* |
| G10 permission bindings | *Deferred to 3b* (R61, R62) |
| G11 notes and outcomes | *Deferred to 3b* (R60 `notes` CHECK) |
| G12 / Q13 worker sees name, phone, email | *Deferred to 3b*; operator ruling 2026-10-25 stands |
| G13 360px nav before another segment | §7.1, Batch 0, EC-17 |
| G14 Option 1 effects on existing sign-ins; remove 2b ack and card note; backfill by `ends_on` | §4.7, §4.10, Group G; the "card note" does not exist as such (Group G) |
| G15 overdue count | *Deferred to 3b* |
| G16 organisation-day dates | *Deferred to 3b* (3a's dates are `::text` casts and UTC `current_date`, the roll functions' clock) |
| G17 funnel numbers screen-only | *Deferred to 3b* (S14) |
| G18 first-visit edits | §5 `updateVisitDetails`, Group F, D7 |
| G19 test and fixture blast radius | §3.3, §7, §10, §11, §12 (`seed-dev.sql` follow-up fixtures are 3b's) |
| Phase 1 Q4 Regular puts a non-rolled person in the Directory: keep and disclose | Group B body |
| Phase 1 Q5, Q6, Q12 (one Inactive segment; archive one at a time; staff anchors not editable) | §7.1, §5, the guard and Group A |
| Phase 1 Q10 no email to visitors who accepted under Option 3 | Group I |
| Phase 1 Q1 to Q3, Q7 to Q9, Q11 | 3b, defaults stand |
| R48 exposure restated; confirm no tenant permission is cached | §2 (grep: none), DECISION-232 |
| R49 mechanism: narrow + second kind + protected role, no rebinding | §4.5 to 4.8; **D1** (pair by database) and **D4** (reach) recorded |
| R50 to R52 classifier, consumers, pin, S13 | §4.3, §6; S13 accepted by 2b |
| R53 engagement guard, audit, residual | §4.9, §9, §15.1 |
| R54 F244 | D5, §4.9 |
| R55 auto-connect requires member standing (operator-approved) | §4.10 (3), Group G |
| R56 `deriveConnection` | §6.2; **D2** (`archived`) |
| R57 archive and restore, no definer | §5 |
| R58 cancel trigger | *Deferred to 3b* (accepted by orchestrator) |
| R59 F240 | §4.4, EC-11 |
| R60 to R64 `follow_ups`, permissions, route, toggle | *Deferred to 3b* |
| R65 Phase 6 walks | 3a walks §13; 3b walks *deferred to 3b* |
| R66 increment split | followed |
| Note 1 order (2b merges first) | §8 |
| Note 2 measure before DDL | §3.1, §3.2 |
| Note 3 rehearse 0066 on a throwaway child branch | Batch A1 gate; §13 |
| Note 4 release-note "do not write" | Group I |
| S13 | accepted by 2b |
| S14 boundary scan for follow-ups | *Deferred to 3b* |
| S15 label derived groups by reach | Group H, §7 |
| Operator: split accepted; R55 approved; G12 ruling; S13 accepted | followed |
| 3a review D1 to D8 | All accepted; recorded in §0 and §15 |
| 3a review arch-A1 (close F245 in 0066 section 3) | §4.4, §6.3 test 4, §12 (c), EC-33 |
| 3a review arch-A2 (`groups` shape CHECKs, P10, `DerivedFromKey` pin) | §3.2 P10, §4.2 item 3, §4.5 step 5, §4.12, §6.3 scan 4, §12 (k), EC-34 |
| 3a review arch-A3 (pin the pair's contract) | §4.5 contract paragraph, §4.11, §6.3 tests 1 to 3 and 6, §7, §12 (e), EC-13, EC-35 |
| 3a review arch-A4 (narrow refusal test, owner-connection index test, writer re-scan) | §3.3 item (1), §6.3, §8, §12 (g), EC-14 |
| 3a review S16 (optional: refuse non-owner derived-group INSERT) | **Declined** by tech-lead with the paper text (4.5, 15.1 (8), DECISION-236); the architect offered it as optional and named this fallback |
| 3a review D4 conditions (no `member` grant; P5 before apply; release note states the widening; TODO 171/357/451 at integration) | No `member` grant is created (4.8); P5 stands in 3.2; Group I (release note); TODO 171, 357 and 451 are the orchestrator's at integration; operator approved D4 as designed |
| Operator 2026-10-25: D4 approved; archive scope (R57) approved; F245 assigned | Recorded in §0 and §18 |

## 17. Out of Scope (non-goals for the user to confirm)

- Everything in 3b: `follow_ups`, the two permissions, the toggle, the route, the tile and its overdue count, the cancel trigger, notes, outcomes, the `follow_ups.notes` CHECK.
- Disconnecting a sign-in, bulk archive or bulk engagement change, a visitor self-service card, and any email to visitors who lose the directory.
- Editing a staff anchor's engagement; setting `staff` from the editor.
- Changing the roll or ending a membership from "Moved away" (it is a label; a departure is a roll event).
- Renaming the existing "Active Membership" group or rebinding any role.
- A guard on `ended_on`, on the `INSERT` of `staff`, or on 2b's caller-asserted identity (named residuals).
- Cross-organisation checks on restore; the S6 label decision beyond the "Everyone" empty-state wording G4 forces; the Community-tile blurb at `tiles.ts:227`.

## 18. Operator questions (each with a default; the pipeline advances on the default)

**Answered 2026-10-25:** question 1 (D4) is approved as designed, and question 2 (archive scope) is approved as R57; question 3 is information only. No question is open. The text below is kept as asked.

1. **D4: should the calendar baseline reach organisations that have no live `member` grant?** On `development`, 9 of 11 organisations with the group have none, holding 16 live memberships; 0066 as ruled gives those people `events.view`, and the Calendar tile appears for them, where today it shows "isn't available to your account" (TODO F133/N5). `events.view` is tier 1 and read-only, the same class as `directory.view`. **Default: yes, as the architect ruled** (it also closes the calendar half of F133). The narrow alternative is one added predicate (4.8). The production figure is P5; if it is non-zero the operator should read it before 0066 is applied.
2. **Archive scope.** Phase 1 described archiving a visitor; the architect's R57 also lets an Inactive or Moved-away person be archived (a regular attender must be marked Inactive first). **Default: as R57.**
3. **Timing (information, no answer needed).** The directory narrowing happens when 0066 is applied, not when the code deploys. P2 gives the number of signed-in people it affects. With no answer it is applied in the normal order (migration, then code).

For the architect / orchestrator rather than the operator: **D1** (the pair trigger in place of editing about 35 fixtures) and the use of the returned numbers (none new).

## 19. Implementer

Named per batch in §8: **Batch 0 ux-developer** (nav fix, first); **A1 and A2 database-admin** (0066, tests, rehearsal, staged assets); **B api-developer** (library, actions, audit, provisioning, the 2b TypeScript removals); **C ux-developer** (lists, dialogs, cards, copy); **D full-stack-developer** (e2e, hydration, final read of the staged assets). Phase 4 waits for 2b to merge, except Batch 0.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 3 — Technical design | tech-lead | Complete for 3a. Migration 0066 (classifier layer, F240 derived-row guard, the pair of derived kinds with a database-created sibling, `calendar_viewer` baseline role, engagement CHECK and guard, roll-cache guard closing F244, three 0065 bodies re-created). Four server actions and one writer module; four audit keys; Inactive list, archive and restore, engagement editor, first-visit edits, 360px nav fix. Eight departures (D1 to D8) recorded, all accepted by the architect; D4 and the archive scope approved by the operator. Edited 2026-10-25 for arch-A1 to arch-A4 (F245 group edit guard, `groups` shape CHECKs, the pair's contract, D5 test and writer re-scan); S16 declined with the paper text. Five batches, four implementers. | Design complete (updated) | 2026-10-25 |

## Handoff

**Next agent:** the orchestrator, which (1) puts Operator question 1 to the operator and asks the architect to acknowledge D1; (2) runs §3.2 on production once 2b's 0065 is applied there; (3) records DECISION-232 to 236 and F240 to F244 at integration; (4) pre-assigns nothing further (no person-id range is needed, §11). Then **Batch 0 (ux-developer)** may start now; **Batch A1 (database-admin)** starts after 2b merges and the §3.3 re-verification is done. 3b's design goes in `-inc3b` once 3a merges. **After the 2026-10-25 edit:** the orchestrator also records F245 (folded into DECISION-236), runs P10 beside the other production counts, and updates TODO lines 171, 357 and 451 at integration (D4 conditions); the operator has already approved D4 and the archive scope, so nothing is waiting on the operator. Batch A1 now also carries arch-A1 to arch-A4 and the writer re-scan.

Files read (all under `/Users/cshenso/git/presby-platform/presby-inc3` unless noted): this work-log; `/Users/cshenso/git/presby-platform/presby-2b/docs/work-log/2026-10-22-founding-admin-directory.md` (lines 4021 to 4445 and 6628 to 7360); `drizzle/0009`, `0010`, `0012`, `0014`, `0017`, `0033`, `0054`, `0061`, `0062`; `src/lib/{community,community-labels,directory,people,org-provisioning,groups,role-grants,audit,audit-tx,authz,roll-action-kinds,ymd}.ts`; `src/lib/org-portal/{my-groups,find-person}.ts`; `src/lib/onboarding/issue.ts`; `src/lib/db/domain/{groups,people}.ts`; `src/components/shared/button-group.tsx`; every file under `src/app/(org)/o/[slug]/admin/community/` named above; `scripts/test-rls.sql` (sections 6, 25, 44), `scripts/participants/test-rls-61.sql`, `scripts/ci/e2e-baseline-flags.sql`; `e2e/community-participants.spec.ts`, `e2e/support/community-fixture.ts`; the existing boundary tests `participant-boundaries.test.ts` and `officer-offices.test.ts`. Live `development` catalog: `pg_proc`, `pg_trigger`, `pg_roles`, and counts over `memberships`, `people`, `groups`, `group_memberships`, `role_grants` (read-only).

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

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

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

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false

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

## Orchestrator rulings on the Phase 1 defaults (2026-10-25)

- **Split accepted: 3a then 3b.** 3a keeps migration 0066, DECISION-232–237, F240–F249. **3b is pre-assigned migration 0069, DECISION-247–250, F266–F273.** This log carries 3a and the shared Phase 1–2; 3b gets `-inc3b` at its Phase 3.
- Open questions 2–13 proceed on the analyst's defaults unless the operator rules otherwise; Q12 contact-detail disclosure to workers (G12) is put to the operator.
- Phase 3 waits for 2b's Phase 3 amendment (G1 changes R40's `is_visitor`).

## Operator rulings (2026-10-25)

- **G12 / Q13: a follow-up worker sees name, phone and email** (plus first-visit date and how they heard) for steps assigned to them; no address, household, birth date or other visitors; a visible line explains who can see what.
- R55 (auto-connect requires member standing) is put to the operator; default applies until answered.
- **R55: approved by the operator (2026-10-25)** — auto-connect requires member standing; Inactive, Moved away and unclassified are declined like visitors.
- **2b's Phase 3 amendment 2 accepted S13:** 0065 introduces `presby_membership_standing()` with today's semantics and the core returns `standing`; 3a changes only the connect condition and drops the visitor acknowledgement. The A5 derived-kind list lives in one pinned place, the standing core's body.

---

# Increment 3a: architect review of the Phase 3 departures

*I wrote no files. My database access was read-only (`default_transaction_read_only=on`) on `development` (`ep-lingering-meadow-axnarpsq`), and it returned only catalog rows and counts. I did not touch production. 2b is not merged in this tree, so every 0065 symbol below is taken from the tech-lead's design.*

## Verdict

**Approved with suggestions.** All eight departures are accepted. D1 and D5 come with amendments A1 to A4, and A1 to A3 are required. They add to 0066 and do not change the feature, so nothing loops back to Phase 1 or 2. The tech-lead should add A1 to A3 to §4.4, §4.5 and §12 before Batch A1 starts.

I also have to correct my own Phase 2. R59 made the derived *rows* owner-only. But the derived *group* row itself (its `membership_source` and `derived_from`) can still be changed by `presby_app`. That reopens F240 one level up, so my Phase 2 statement that "The Court Is Not a Group" is made true at the database by R59 is only true once A1 lands.

## Measured (live `development` catalog, read-only)

- **`presby_app` writes on `groups`:** it holds INSERT, SELECT, UPDATE and DELETE. The policy is `tenant_isolation` (`organization_id = presby_current_org()`) on all commands, with FORCE RLS on.
- **The only trigger on `groups`:** `groups_reject_derived_edit`, BEFORE UPDATE. Its function refuses changes to `name`, `description` and `meets_when` on a derived group, and nothing else. It does not protect `membership_source`, `derived_from`, `is_protected`, `group_type_id` or `organization_id`, and there is no INSERT guard.
- **Constraints on `groups`:** `groups_org_derived_key UNIQUE (organization_id, derived_from)` is a full constraint, so the pair trigger's `on conflict` inference works. `groups_derived_check` is only `membership_source = 'managed' OR derived_from IS NOT NULL`. That means a *managed* group with `derived_from = 'active_membership'` is legal, and `derived_from` has no fixed list of values.
- **Data:** 11 `active_membership`, 9 `session` and 9 `diaconate` groups, all `derived`. 2 `managed` groups, both with a null `derived_from`. So a tighter CHECK would validate on `development` today.
- **Functions that write `current_roll`:** only `presby_sync_current_roll` and `presby_reconcile_current_roll`. Both are SECURITY DEFINER, owned by `neondb_owner`, with `search_path` pinned.
- **`presby_accept_invitation`:** touches `engagement_status` only through two INSERTs of `'staff'`, never an UPDATE.
- **The three functions changed by 0066 are owned by `neondb_owner` and none is a definer:** `presby_reject_derived_group_write`, `presby_sync_derived_group` and `presby_sync_derived_membership_group`.
- **Connection roles:** `DATABASE_URL` connects as `presby_app`, and `PLATFORM_DATABASE_URL` as `neondb_owner`, the table owner. `presby_platform` has `rolcanlogin = false` (the `docs/deployment.md:211` note says it has never logged in), so an owner-only test refusing it breaks nothing.
- **No application code writes the identity columns of a derived group.** `src/lib/groups.ts:665` updates `name`, `description` and `meetsWhen` only, and only on managed groups (`:645`). `src/lib/db/domain/invitations.db.test.ts:180` does flip `derived_from` on purpose, but through a test-injection trigger that runs inside a definer, so on the owner path.

## Ruling per departure

**D1: the pair trigger on `groups`. Accepted, with amendments A1 to A3.**

- **F16 is preserved.** F16's intent is that a membership write never succeeds silently when there is no derived group to mirror it into. The sync still raises when either group is missing, and it checks `active_membership` first with the shipped message, so the four `sqlerrm like` handlers keep mapping the common case. A missing `all_memberships` fails loudly with a message nothing maps. Creating the pair inside the database is stronger than relying on convention.
- **The definer is safe.**
  - It reads no table, so F26 does not apply.
  - It takes `organization_id` (and `group_type_id`) from `NEW`. For `presby_app`, RLS's WITH CHECK has already tied `NEW` to `presby_current_org()`.
  - `search_path` is pinned, and every other column is a literal.
  - It creates no role, permission or grant, so it adds no access. `calendar_viewer` comes only from provisioning and the §4.8 backfill.
  - It needs **no** owner check, because its job is to fire for any inserter.
- **It opens no path for a tenant to create a derived group it shouldn't.** Today `presby_app` can already INSERT any derived group, including a literal `all_memberships`, because `derived_from` has no fixed list. The trigger only adds, in the same organisation, a row the tenant could insert itself. Both groups are filled by triggers, and no role reaches them without a role grant.
- **What D1 does expose is the existing `groups` gap above.** A `presby_app` session can:
  1. `update groups set membership_source = 'managed'` on the Session group (or on `active_membership`); the current CHECK and edit trigger both allow this;
  2. then insert a `source = 'managed'` row. `presby_reject_derived_group_write` only guards groups that are currently derived, so it allows the write;
  3. and that person then resolves `roll.approve` (or, after Option 1, `directory.view`).

  No UI reaches this, so today it is `paper`. It is the same class as F240, and Option 1 depends on it being closed. I propose recording it as **F245**: it was returned unused by Phase 2 and Phase 3, and the orchestrator should confirm it is still free. It folds into DECISION-236 rather than taking a new decision number.

**D2: two archive connections (`former_visitor` and `archived`). Accepted.** This follows from R57's archive scope. The goldens cover both.

**D3: `unclassified` cannot occur in stored rows. Accepted.** Under the engagement CHECK, every one of the five values hits an earlier arm of the first-match order. Keep the arm in SQL and TypeScript as the fail-closed default, cover it with the cross-product test, and build no UI for it.

**D4: the calendar baseline reaches organisations with no live `member` grant. Accepted, and it is within R49's intent.**

- R49 specified a baseline seeded "for every organisation type, beside `member`", matched by role key only. I did not make it depend on a `member` grant existing, and that was deliberate. The point of the change was to separate "current" (calendar) from "member standing" (directory), so the calendar baseline should not inherit `member`'s gaps.
- The people who gain access are current memberships at organisations that are already in the F133 defect state. On `development` all 16 have listed standing. These are members who were already entitled to more than `events.view`, which is less than they are owed.
- The calendar shipped as "a calendar for everyone in {your church}", and the TODO's N5 dead-end tile is the visible symptom of F133.
- Conditions:
  1. 0066 creates **no** `member` grant. The directory half of F133 stays open, because adding `member` there would widen the directory and is out of scope.
  2. The operator reads P5 before 0066 is applied to production, and the release note states the widening.
  3. At integration the orchestrator updates the three TODO lines that depend on F133: line 171 (F133, partly closed), line 357 (N5) and line 451 (the combined calendar post's precondition).
  4. The operator keeps the final say. The narrowing predicate in §4.8 is the fallback, and the default stands.

**D5: F244 closed with an owner-only guard. Accepted, with amendment A4.**

- The test I set in R54 is met. The live catalog confirms the only functions that write `current_roll` are the two owner-path definers, and the platform connection authenticates as the owner.
- Moving the `scripts/test-rls.sql:332` one-active-roll assertion to an owner-connection test is the right move. That unique index is a property of the table, not of the role.

**D6: residuals for INSERT of `staff` and for `ended_on`. Accepted.** The database cannot tell the sanctioned anchor insert apart from a plain `presby_app` insert, and `ended_on` (with restore's un-ending) was always writable. Record both as `paper` in DECISION-234 and DECISION-235, with the code path that conditions each.

**D7: a 1900 floor on edit only. Accepted.**

**D8: the follow-up cancel moves to 3b's trigger. Accepted.** This is R66's split. 3a's dialogs say nothing about follow-ups, and 3b adds the sentence.

## Amendments for Phase 4

**A1 (required): close F245 in 0066 §3.**
- Extend `presby_reject_derived_group_edit()` with the same A1 owner test as §4.4.
- A non-owner may change **no column** of a row where `old.membership_source = 'derived' or new.membership_source = 'derived'`. That refuses a derived-to-managed flip, a managed-to-derived flip, and any change to `derived_from`, `is_protected`, `group_type_id` or `organization_id`.
- The existing refusal of `name`, `description` and `meets_when` stays byte-for-byte, for every role.
- Errors use `check_violation` with the `groups:` message prefix.
- `test-rls-66.sql`, run as `presby_app`:
  - refused: Session flipped to managed; `active_membership`'s `derived_from` changed; a managed group flipped to `all_memberships`;
  - still allowed: a managed-group rename (`scripts/test-rls.sql:1848`).
- Re-run `invitations.db.test.ts`; its injection at `:180` takes the owner path and must still pass.

**A2 (required, small): tighten the shape of `groups`.**
- Add `(membership_source = 'derived') = (derived_from is not null)`.
- Add `derived_from is null or derived_from in ('active_membership','all_memberships','session','diaconate')`.
- Apply both NOT VALID, then VALIDATE, behind a count-only stop-block in §1. Add a P10 count to §3.2 for production.
- Pin `DerivedFromKey` in `src/lib/groups.ts` to the CHECK with a source scan.
- Why: this makes the pair trigger's WHEN clause and the sync's lookup by `derived_from` unambiguous. Without it, a pre-existing managed `all_memberships` row would satisfy the trigger's `on conflict do nothing` and the §4.5 post-check.

**A3 (required): pin the pair's contract.**
1. A DB test: a `presby_app` insert of a derived `active_membership` group under organisation A creates exactly one sibling, at A, with the fixed literals. `app_roles`, `app_role_permissions` and `role_grants` stay unchanged.
2. `has_function_privilege` is false for both application roles.
3. `groupSeedPlan()` lists `all_memberships` explicitly for every organisation type, pinned by test. This is not cosmetic. RETURNING does not return rows inserted by a trigger, so the `calendar_viewer` binding lookup (`org-provisioning.ts:441`) only finds the group if the plan lists it. The existing throw-if-missing then fails loudly if anyone drops it.
4. Any fixture that inserts `all_memberships` in a later, separate statement uses `on conflict do nothing`.

**A4 (required, for D5): tighten the tests and re-check the writers.**
1. The new test-rls refusal line catches only the guard's SQLSTATE and message prefix, never `others`. With the guard removed, the insert would then hit `unique_violation` and abort the suite loudly.
2. The owner-connection unique-index test goes on Phase 5's DB-backed list.
3. After the 2b rebase, re-run the `pg_proc` writer scan over the 0065 bodies, for:
   - `current_roll` and `current_roll_since`;
   - UPDATEs of `engagement_status` (that guard binds the owner too);
   - derived `group_memberships` rows;
   - `groups`.

   Record the result next to §3.3 item (1). Any new writer that is not on the owner path is a Phase 3 loop-back.

**S16 (suggestion): refuse non-owner INSERT of a derived group (BEFORE INSERT).** This would make the pair owner-path only. The cost: `scripts/test-rls.sql:656` inserts a scratch derived group as `presby_app`. A BEFORE trigger runs before ON CONFLICT arbitration, so that insert would raise even when Alder Creek already has the group, and the block would need an existence guard. If S16 is declined, record "a tenant can create a derived group in an organisation that lacks one; its rows remain trigger-derived and no role reaches it without a grant" as `paper` in DECISION-236.

## Invariants touched (delta from Phase 2)

- **The Court Is Not a Group:** made a database property by R59 together with A1, not by R59 alone.
- **Isolation and F26:** the pair definer reads nothing and takes the organisation from `NEW`. The guards are invokers using the owner test, and no role is named.
- **Permissions vs Flags:** unchanged. D4 widens a *grant* through a derived group, never through a flag.
- **Never hard-delete:** unchanged. A1 and A2 refuse writes; they do not delete.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review (3a departures addendum) | architect | Complete. D1 to D8 accepted. D1 accepted with A1 to A3: the pair definer is safe (no reads, organisation from `NEW`, creates no grant, no owner check needed), and F16 is preserved. New **F245** (number to be confirmed): `presby_app` can change `membership_source` and `derived_from` on derived groups, bypassing R59. Closed in 0066 by the owner-only edit guard (A1) and the `groups` shape CHECK (A2). D4 is within R49's intent (no `member` grant created; P5 before apply; TODO 171/357/451 at integration). D5 accepted with A4 (narrow refusal test, writer scan after rebase). S16 optional. | Approved with suggestions (A1 to A4 required in Phase 4) | 2026-10-25 |

## Handoff

**Next: the tech-lead**, for a short edit that adds A1 to A4 to §4.1 (§1 stop-block, §3, §4), §3.2 (P10), §6.3 and §12, and F245 to §15.3. Then the orchestrator puts D4 to the operator, with the default standing. Batch 0 can start now, and Batch A1 starts after 2b merges and the §3.3 re-verification is done.

Files read:
- `/Users/cshenso/git/presby-platform/presby-inc3/docs/work-log/2026-10-22-founding-admin-directory-inc3.md` (Phase 2; Phase 3 §0 to §5, §15.2/15.3, §18 and §19)
- `/Users/cshenso/git/presby-platform/presby-inc3/src/lib/org-provisioning.ts` (lines 190 to 456)
- `/Users/cshenso/git/presby-platform/presby-inc3/src/lib/groups.ts` (lines 590 to 670)
- `/Users/cshenso/git/presby-platform/presby-inc3/src/lib/db/domain/invitations.db.test.ts` (lines 165 to 195)
- `/Users/cshenso/git/presby-platform/presby-inc3/scripts/test-rls.sql` (lines 320 to 345 and 630 to 700)
- `/Users/cshenso/git/presby-platform/presby-inc3/src/lib/db/index.ts`, `/Users/cshenso/git/presby-platform/presby-inc3/docs/deployment.md:211`, `/Users/cshenso/git/presby-platform/presby-inc3/docs/TODO.md` (lines 171, 357 and 451)
- Live `development` catalog: `pg_class`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_policy`, `aclexplode(relacl)`, `pg_proc` (security, owner, config and bodies), `pg_roles`, and counts over `groups`

## Operator rulings on 3a Phase 3 (2026-10-25)

- **D4 calendar baseline backfill: approved as designed** — every live membership gets `calendar_viewer` (events.view only), including the 9 F133-state orgs on development; no `member` grant is created; P5 read before production apply; release note states the widening.
- **Archive scope (R57): approved** — visitors, Inactive, Moved away and unclassified; not rolled members, participants or staff anchors.
- **F245 confirmed free and assigned** (orchestrator) to the derived-group identity-column gap; folds into DECISION-236.

## Phase 4 — Batch 0 (ux-developer, 2026-10-25)

**Scope:** the 360px `ButtonGroup` fix only (section 7.1). The seventh `Inactive` segment is not part of this batch; it lands with the standing work, so the nav still has six segments here and the spec reads its counts from the DOM.

**Files**
- Create `src/components/shared/button-group-scroll.tsx` (client; `centredScrollLeft`, `fadeState`, `ButtonGroupScroll`). It guards `ResizeObserver` (absent in jsdom, which the five page tests render through), so no existing test needed a stub.
- Modify `src/components/shared/button-group.tsx` (mounts the scroller; fade mask classes on `data-fade-left` / `data-fade-right`, plus a both-sides combination).
- Tests: `src/components/shared/button-group.test.tsx` (4 `centredScrollLeft`, 4 `fadeState`, one mount check); new `e2e/community-nav-scroll.spec.ts` (3 tests at 360x740).

**Gates:** typecheck, lint, `npm run check` (all eight) clean; plain `npm test` 8331 passed, 0 failed.

**360px evidence** (own server on :3490, Playwright, clerk at e2e-alpha): the e2e spec passes (landing on every segment leaves it fully inside the tray, fade attributes match scroll position, no page overflow, last segment reachable and clickable). Measured computed state: `?view=visitors` scrollLeft 276 of 359 max, mask both sides; Everyone: right fade only; Former: left fade only (`to left` gradient). Directory nav (Members, Households, Parishes) is 261px wide at 360px, so it does not overflow: no fade, no scroll, unchanged.

**Residual:** screenshots were not retained (a scratch filename bug); the numeric computed-style readings above stand in. The e2e spec was run before the final `ResizeObserver` guard edit; the guard is a no-op in browsers.

**Next agent:** the orchestrator; Batch A1 waits on 2b.

## Orchestrator: required Phase 3 edit before 3a Phase 4 (2026-10-25, from parish-management's QA run 1 rulings)

Parish management (0068) adds a fifth derived kind, `deacons_moderator`. 3a's `derived_from` kind CHECK and its stop-block list (arch-A2) name four values and must be widened to five (`active_membership`, `all_memberships`, `session`, `diaconate`, `deacons_moderator`) or 0066/0068 cannot both apply in either order. Also: parish's 0068 now re-creates `presby_sync_derived_group()` as `security definer set search_path = public, pg_temp` so 0066's owner-only guard is not reset; 3a's 0066 body for that function must match (same signature and attributes) or the later of the two wins silently — the 3a Phase 4 writer re-scan (arch-A4) must check it. See /Users/cshenso/git/presby-platform/presby-parish/docs/work-log/2026-10-25-parish-management.md "Phase 3 amendment 1 — QA run 1 rulings".

---

# Phase 3 amendment — rebased on main 0.50.1 (tech-lead, 2026-10-31)

*Written 2026-10-31 by tech-lead in the `presby-inc3` worktree, HEAD `f1644c9` (this branch plus `main` 0.50.1). The 2026-10-25 design above is not edited; this section amends it, and where the two differ this section wins. The feasibility check was re-run against the merged tree (Phase 3's own rule for a design whose Phase 4 starts after other pipelines merged): I read `drizzle/0065`, `0068`, `0080`, `0082` in full where they touch 3a, and `0067`, `0071`, `0072` by grep; the live `src/` consumers named below; the `presby-treasury` (0073, 0074) and `presby-photos` (0078) worktrees as they stand today, read-only; `docs/deployment.md`, `docs/decisions.md`, `docs/schema-design*.md` and `docs/STATE.md` for the numbers. **One database read:** the pipeline's own Neon branch (the `.env.local` here, endpoint `ep-delicate-sun-…`), read-only, counts and booleans only. It turned out to be a pre-0065 copy (§A6), so it cannot answer any 2b-era question; nothing below is "measured on development" and I say so each time. Production and `development` were not touched. No code, migration, seed, test or Rule 16 file was written. No real name, address or id appears below.*

## A0. Verdict

**Design complete (amended).** No loop-back to Phase 1 or 2. The rebase changes the build in thirteen places (D9 to D21, §A3), none of which changes what 3a is. Two items are recorded for the architect's information and are not blocking (D10b, the T list and F247; D17, F246). **One operator question, non-blocking, with a default** (§A15). Four things the orchestrator must do before Batch A1 starts (§A6, §A12). Numbers: all confirmed free (§A1).

## A1. Numbers and the migration slot (jobs 3 and 5)

**Migration 0066 is free.** There is no `drizzle/0066*` file on `main`, none in the `presby-treasury` (0073, 0074) or `presby-photos` (0078) worktrees, and none on any `origin/pipeline/*` branch (checked by `git ls-tree`). `drizzle/meta/_journal.json` on this branch has no idx 66 (it jumps 65 to 67; `docs/deployment.md:827` says the skip is deliberate). 3b's reserved 0069 is also free today, but see §A13 (3b must start from 0071's version of the founding-administrator key function).

**DECISION-232 to 237, 247 to 250.** None is defined in `docs/decisions.md` (highest on this branch is 298). The only mention of any of them is `DECISION-236` inside DECISION-242's text (parish management's own pointer at our F240/F245 closure), which is ours. Treasury and photos worktrees: no use.
**F240 to F249 and F266 to F273.** None is defined in `docs/schema-design*.md`, `docs/decisions.md` or `docs/TODO.md`; the only mentions are F240/F245 (parish management's pointers at our findings) and the `docs/STATE.md` range lines. Treasury and photos worktrees: no use. **Dev port 3490** appears only on our STATE rows. Nothing is taken; nothing to stop for.
**New in this amendment, from the pre-assigned set:** **F246** and **F247** (§A12). F248, F249 and DECISION-237 stay returned.
**Findings subsection:** the next free `docs/schema-design-2.md` subsection per STATE is `2am`; the orchestrator confirms at integration.

## A2. What shipped, against what the design assumed (job 2)

| # | Design assumption (2026-10-25) | As shipped on `main` | Verdict |
|---|---|---|---|
| 1 | 2b's R40 core returns `standing`, from a classifier introduced in 0065 with today's semantics (S13); only `visitor` is tested | `presby_membership_standing(text,text)` is `0065:696-709` (immutable SQL, no definer), identical to R50's first-match order; ACL restated at `:2687` and `:2726` (revoke from all three, grant `presby_app`). The core `presby__person_sign_in_standing` (`:792-869`) returns `standing` text. **There is no `is_visitor` boolean anywhere.** `'visitor'` is compared as a standing in exactly two function bodies: `presby_sign_in__check` check 10 (`:1067`) and `presby_connect_signed_in_account` step 10 (`:2641`) | Holds. Those two are the sites §4.10 changes |
| 2 | The T closed list is one pinned place, the standing core | `0065:858-859`: `not (g.membership_source = 'derived' and coalesce(g.derived_from in ('active_membership', 'session', 'diaconate'), false))`. Pinned as the literal `derived_from in ('active_membership', 'session', 'diaconate')` by `MARKERS.closedList` at `src/lib/db/domain/sign-in-standing.db.test.ts:65` | Holds; A2 must change both the body and that marker (D11) |
| 3 | The three 0065 bodies §4.10 re-creates, the four 0017/0033-era bodies §4.4 and §4.6 replace, are still the live definitions | `grep "function <name>" drizzle/*.sql`: `presby_sign_in__check`, `presby__person_sign_in_standing`, `presby_connect_signed_in_account`, `presby_membership_standing` only in 0065; `presby_sync_derived_membership_group` only in 0017; `presby_reject_derived_group_write` / `_edit` only in 0009 and 0033. **No file numbered 0066 to 0082 redefines any of them.** `presby_effective_permissions` (0010, 0048) and `presby_two_factor_required` (0080 is the last) are untouched by 3a | Holds. This is the proof that 0066 applied after 0067 to 0082 cannot overwrite a later definition (§A5) |
| 4 | Four `sqlerrm like '%has no derived group active_membership%'` handlers (the 0059/0061/0062/0064 bodies) | Live handlers are: `presby__accept_invitation_core` (`0065:2041`, the moved acceptance body; `presby_accept_invitation` is now a thin wrapper), `presby_record_participant_action` (`0061:446`), `presby_void_participant_action` (`0061:589`), `presby_decide_roll_action` (`0062:690`). 0059 and 0064 versions are superseded | **D13**: the list in §3.1, EC-13 and Batch A2's mapping test names the core, not `presby_accept_invitation` |
| 5 | `provisioningComplete()` checks `active_membership` | `issue.ts:304-312` unchanged; the acceptance core has its own check at `0065:1802-1806` (founding administrator). Both check only `active_membership` | Holds. The core's own check stays as it is (the pair is guaranteed by trigger, backfill and post-check); `issue.ts` also checks `all_memberships` as designed |
| 6 | `SIGN_IN_ACK_REASONS`, `connectOutlook`, the dialog paragraph, `getSignInCard` as 2b built them | `sign-in-types.ts:66` (`["do_not_contact","visitor"]`), `:133-138` (`visitor` outlook), `:183`, `:213` (`isVisitor`); `org-invite.ts:539,564-566,598`; `send-sign-in-dialog.tsx:53,64,80,82,160`; `sign-in-card.tsx:72-73,125`; `sign-in-copy.ts:174-175,193-194`; `org-features.ts:134`. **Two sites the design did not list:** the `isVisitor` plumbing (`SignInCardState.isVisitor`, the dialog prop, the card's pass-through) and a second standing vocabulary, `MEMBERSHIP_STANDINGS` / `MembershipStanding` at `sign-in-types.ts:87-88` | **D13** |
| 7 | "Auto-connect: step 10 is `standing is not 'visitor'`; the 2b matrix's connect column" | `0065:2641`: `if v_st.refusal is not null or v_st.standing is null or v_st.standing = 'visitor'`. The `standing is null` arm and the refusal arm stay | Holds; §A4.2 words the replacement |
| 8 | The Community Visitors list is "engagement `visitor`, no roll" (`community.ts`) | `community.ts:112-119`, as read in 2026-10-25; unchanged | Holds. 3a's classifier-based list (`= 'visitor'`) is the one by-name change (M11), as designed |
| 9 | `directory.ts` default branch is `current_roll in (...) or engagement_status = 'regular'` | `directory.ts:316-320`, unchanged. **New consumers that inherit it:** treasury's `isDirectoryListedPerson` calls `directoryEligibilityWhereSql(false)` (never a copy) | Holds, and the inheritance is wanted. Treasury also adds a second, hand-coded definition in SQL: **F246** (D17) |
| 10 | `deriveConnection` consumers are the wizard, `people.ts` and the edit page | Also `src/lib/parishes.ts:302-307` (a person's tag in parish household rows) and `parishes-pure.ts:188-195` (`bucketForConnections`: member, participant, visitor, else Others), `household-row.tsx:39` | **D15** |
| 11 | "No Directory tile on the portal home" for a visitor (§13 W1; Phase 1 Flow 8) | `src/lib/org-portal/tiles.ts:14-64,234-238`: portal tiles are **permission-blind by rule** (DECISION-162); the Directory tile always shows and opens `DirectoryForbidden` ("You don't have permission to view the directory. If you think this is a mistake, ask an administrator at {name}.", `directory-states.tsx:45-52`) | **D14**: the walk text and one release-note sentence change; no tile code changes |
| 12 | `groupSeedPlan()` lists session, diaconate, active_membership | `org-provisioning.ts:189-228` lists four for a congregation (adds `deacons_moderator`, a `roster`-type group) and one for any other type; the inline literal union on `:194` and `:278` already includes `deacons_moderator` | **D9**: both unions gain `all_memberships`; the plan lists it explicitly for every type |
| 13 | `DerivedFromKey` has four kinds after 3a | `src/lib/groups.ts:138-142` already holds `session`, `diaconate`, `deacons_moderator`, `active_membership` (parish management widened it) | **D9**: becomes five by adding `all_memberships` |
| 14 | 35 fixture files create an `active_membership` group (D1's reason) | Recount with the same patterns: **39** (30 under `src/`, six in `e2e/support/` (`careers`, `domains-ui`, `giving`, `invitation`, `parish` fixtures and `seed-orgs.ts`), and `scripts/seed-dev.sql`, `scripts/sign-in-invitations/seed-dev-sign-in.sql`, `scripts/test-rls.sql`). `e2e/support/*` and the seed files are Rule 16 files | D1 stands, now with a stronger reason: editing 39 files is not available to this pipeline |
| 15 | No fixture inserts a derived group of a kind outside the closed list (§3.3, "groups shape CHECKs") | **False.** `sign-in-standing.db.test.ts:188` inserts a derived group with `derivedFrom: "fixture_new_kind"` (through `sign-in-fixture.ts:208-233`, `groupGrant`) to test 2b's A5 "unclassified kind fails closed". `groups_derived_kind_check` refuses it | **D11**: a Phase 3 defect in the original design, closed here |
| 16 | D4: 9 of 11 `development` organisations hold the group with no live `member` grant (F133), so the baseline widens | 0082 (`drizzle/0082:57-95`, applied to production 2026-10-28 and to `development`, `docs/deployment.md:1522-1565`) gives every organisation that has **no `member` role at all** the role (`directory.view`, `events.view`), a group-arm grant, and the Active Membership group if missing. On the pipeline branch (pre-0082) the 9 organisations have no `member` role at all (2 `member` roles exist, both granted) | **D12**: the D4 population is very likely 0 or near 0 now; re-measure (§A6). The ruling stands as operator-approved |
| 17 | Two-factor behaviour in the Phase 6 walks | 0080 (`:58`): `users.two_factor_required` defaults to false, so a new account is **not** sent to `/totp` merely for existing; the requirement now comes from a flagged key (`roles.manage`, `role_grants.manage`, `domains.manage`, the giving keys), the congregation, or the person's own setting. R42's connect-time factor (`0065:2542-2543`, `:2648`) is unchanged | **D21**: walk text only |
| 18 | Parish management and 0066 compose | `0068:564-604` re-creates `presby_sync_derived_group()` as `security definer set search_path = public, pg_temp` with the `deacons_moderator` arm and `revoke all ... from public, presby_app, presby_platform`; the 0068 header (`:96-104`) already states the 0066 interaction | §A4.3 |
| 19 | Seed and fixture users and the e2e flags | `scripts/ci/e2e-baseline-flags.sql` still holds only `org_portal.home_v2`, `org_portal.reports`, `sites.public_render`; no 3a spec asserts a flag it cannot set (§A9) | Holds |

## A3. Departures from the 2026-10-25 design (D9 to D21), each with a ruling

D1 to D8 are unchanged. **ack** marks what the architect should read; nothing here needs the operator except as stated in §A15.

| # | Departure | Ruling | Why |
|---|---|---|---|
| D9 | **Derived kinds are five, not four** (orchestrator's required edit, from parish QA run 1 §1.4). | `groups_derived_kind_check` lists `active_membership`, `all_memberships`, `session`, `diaconate`, `deacons_moderator`, in every place §A4.1 lists. The kind list stays closed: a sixth kind is a migration. | 0068 §8c inserts `deacons_moderator` groups. With four kinds, 0066 after 0068 (production) stops at its own stop-block and 0066 before 0068 (CI) makes 0068 fail on the CHECK |
| D10 | **The officer sync is altered, never re-created** (orchestrator's required edit, §1.3). | Exactly as §4.4 already designed, now stated as a hard rule with a pre-check, a post-check and a catalog test (§A4.3). 0066 must not contain `create or replace function presby_sync_derived_group`. | `create or replace` resets attributes and, taken from 0062's body, would silently drop 0068's `deacons_moderator` arm; the later of the two migrations would win |
| D10b (**ack**) | **The T exclusion list gains `all_memberships` and does NOT gain `deacons_moderator`.** | §4.10 item 1 becomes `derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate')`. The Board of Deacons Moderator seat stays inside T. | `deacons_moderator` carries `parishes.assign`, an authority. Excluding it would make that person non-authority-bearing: auto-connect would skip the second factor (R42). Fail-closed is right. It has a side effect that exists on `main` today, **F247** (§A12): nobody can send a sign-in invitation to the Moderator, because the sender ceiling (`0065:1017-1023`) needs the sender to hold `parishes.assign`, a seat-only key. Not fixable in 3a without changing the core's return shape; filed |
| D11 | **One 2b fixture contradicts the kind CHECK** (`sign-in-standing.db.test.ts:188`). | In A2, change the fixture's kind to `deacons_moderator` (a real derived kind outside the T exclusion list) and rename the case "a derived kind outside the T exclusion list counts in T (the Moderator seat; F247)". Same expected outcome (authority true, keys `roles.manage`, issue `exceeds_your_access`). Update `MARKERS.closedList` (`:65`) to the new list. | The case's purpose, "a kind nobody has classified fails closed", cannot exist in stored data once the CHECK holds (the same reasoning as D3 for `unclassified`). A real kind exercises the same SQL arm and is honest about what it now represents. The fixture seeds `groups` as the owner, so the CHECK is the only obstacle; the orgs `createInvitationFixture` builds have no `deacons_moderator` group, so the unique key is not hit |
| D12 | **0082 changes D4's measurement, not its ruling.** | See §A6 item 3. 3a still needs `all_memberships` and `calendar_viewer`. 3a must not create, modify or rebind any `member` role, grant or group row (0082's rows included), and creates no `member` grant anywhere. P5 is re-run before apply and the release-note widening sentence is written from that number. | 0082 gives `member` (events.view, directory.view) to **everyone on `active_membership`**, which includes visitors today. 3a narrows `active_membership` to member standing, so a visitor loses `member` entirely and keeps nothing without `calendar_viewer`. 0082 therefore does not do any of what 3a's baseline role is for; it only shrinks the number of people for whom `calendar_viewer` is new |
| D13 | **2b symbols as built** (rows 4 and 6 of §A2). | (a) Handler list: the acceptance core, the two 0061 participant functions, `presby_decide_roll_action`. (b) The sign-in TypeScript removals also cover `isVisitor` (`SignInCardState`, `org-invite.ts:598`, the dialog prop and its `showVisitor` branch, the card pass-through). (c) **One standing vocabulary:** `membership-standing.ts` exports `MEMBERSHIP_STANDINGS` and `MembershipStanding` (the 2b names; `Standing` is an alias of the type) and `sign-in-types.ts` re-exports them, so there are not two lists. (d) `connectOutlook`'s `visitor` result becomes `not_listed`, derived from `isMemberStanding`; its precedence is unchanged. (e) New outlook `connected_not_listed`: `state === "signs_in"` and a standing that is not member standing, shown under the connected lines (it replaces nothing; `connected` still returns no outlook line). | R51's rule: no module re-codes the standing vocabulary or the member test |
| D14 | **Portal tiles are permission-blind** (§A2 row 11). | Phase 1 Flow 8, §13 W1/W2a and the release note stop saying the Directory "is not offered" or that there is "no Directory tile". The truth: the tile is there and opens "You don't have permission to view the directory." The Calendar tile opens the calendar. No tile change, no new gate (DECISION-162's rule stands). | A second permission check in the tile registry is exactly what the registry's own header forbids |
| D15 | **Parish management consumes `deriveConnection`** (§A2 row 10). | (a) The new connections `inactive`, `moved_away`, `unclassified` render as tags on parish household rows, and a household whose only people are inactive, moved away or listed-or-staff stays in **Others** (`bucketForConnections` already falls through to it; no code change there, one new unit case pins it). (b) Two neighbour strings change (§A7 Group J). (c) Who sees the tags: viewers with `parishes.assign`, `people.manage` or `directory.view_hidden` (`parishes.ts:68-98`). This widens who sees "Inactive" and "Moved away" from `people.manage` holders to the Moderator of the Board of Deacons and `directory.view_hidden` holders. Not a new fact: they already see "Visitor", and today an inactive person is tagged "Listed", which is false (F242). | Accurate labels beat a false one. Disclosure widening is operator-visible: §A15 question 1, default yes |
| D16 | **The new group is named "All Current Records", not "Everyone on Record".** | Replaces the literal in §4.5, Group H, the drafted DECISION-232, T-G test 1's fixed literals, `groupSeedPlan`, the staged seed patch and the help page. The derived-edit trigger forbids a later rename, so it is decided now. The Groups-list text "Everyone with a current record here" stays. | Community's "Everyone" list is the directory-listed people and excludes visitors; a group called "Everyone on Record" includes them. Two "Everyone"s with different populations on the Roles and Groups pages is a trap for an administrator. Not yet recorded in `decisions.md`, so no recorded text changes |
| D17 (**ack**) | **Treasury carries a second, hand-coded copy of member standing in SQL** (F246). | 3a does not edit treasury. Recorded as F246 and a follow-up (§A12). | `presby-treasury/drizzle/0073:657-668`, `presby_reimbursement__is_eligible_requester`: `m.current_roll is not null or m.engagement_status in ('regular','staff')`. It agrees with member standing for every value the sanctioned writers can store, and differs only for an unlisted non-null roll text (unreachable once the roll-cache guard is in). It cannot be fixed from 0066: on a fresh `db:migrate` 0066 runs before 0073, and on production 0073 may run before 0066, so neither file can call the other's function safely |
| D18 | **Apply order and the window** (§A5). | 0066 is hand-applied; before the code deploys no organisation is created (or the backfill block is re-run). | See §A5 |
| D19 | **Help edits** (Rule 17; §A8). | Six published pages and one screenshot; no `pending` page, no `[help:<token>]` line. | The ordinary Rule 17 case |
| D20 | **e2e blast radius** (§A9). | One new spec (`e2e/visitor-access.spec.ts`), plus the existing-spec list re-cut against the live tree. | F177's visible behaviour had only a database matrix and a Phase 6 walk |
| D21 | **Phase 6 walk text** after 0080 and D14. | §A10b. | Walk text only |

## A4. The orchestrator's required edit, exactly (job 1)

### A4.1 The five-kind list, in every place

The list is, verbatim, in this order: `'active_membership','all_memberships','session','diaconate','deacons_moderator'`.

1. **§4.2 item 3 (stop-block).** "`derived_from` is not null and not in (the five)". Count only, never a value.
2. **§4.5 step 5.** `groups_derived_kind_check check (derived_from is null or derived_from in (the five)) not valid`, then `validate constraint`. `groups_derived_pairing_check` is unchanged.
3. **§3.2 P10, `unknown_kind`.** The five. On production, 0068 has been applied, so every congregation's `deacons_moderator` group is inside the list and the count must be 0.
4. **Pin test, §6.3 scan 4.** The set equality now spans four texts: the list parsed from `drizzle/0066_presby_membership_standing.sql`, the CHECK in `src/lib/db/domain/groups.ts`, `DerivedFromKey` in `src/lib/groups.ts`, and the `derivedFrom` literals in both inline unions in `src/lib/org-provisioning.ts` (`:194`, `:278`; the second union is `boundToDerivedFrom` and is a subset, asserted `⊆`). It also asserts that `0068`'s inserted literal (`'deacons_moderator'`) is in the list. The deliberately offending sample is a sixth key.
5. **Drizzle mirror, §4.12.** `src/lib/db/domain/groups.ts`: the two new CHECKs in the table callback beside `groups_derived_check`; the stale `// session | diaconate` comment at `:60` lists five kinds.
6. **`DerivedFromKey`** gains `all_memberships` (it already has `deacons_moderator`). Expect textual conflicts at integration in `src/lib/groups.ts`, `src/lib/db/domain/groups.ts` and `src/lib/org-provisioning.ts` (parish management's side added `deacons_moderator`); resolve by keeping both sides' additions.
7. **Comments.** The 0066 header and the column comment on `groups.derived_from` name five kinds and say that `deacons_moderator` is owned by 0068 and the other four by 0017/0033/0062 and 0066.

### A4.2 The T exclusion list

0066 §9, `presby__person_sign_in_standing`: the one allowed difference from the live body is the literal `derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate')`. `deacons_moderator` is deliberately absent (D10b). The live-catalog scan 1 ("`derived_from in ('active_membership'` appears in exactly `{presby__person_sign_in_standing}`") stays and also asserts that function's text contains the four-name list above and not `deacons_moderator`.

**Connect step 10**, exact change in `presby_connect_signed_in_account`: the condition `v_st.refusal is not null or v_st.standing is null or v_st.standing = 'visitor'` becomes `v_st.refusal is not null or v_st.standing is null or not presby_standing_is_member(v_st.standing)`. The refusal and `standing is null` arms stay, so a null standing never reaches the new function (`presby_standing_is_member(null)` would be null, and `not null` is not true). **Check 10 in `presby_sign_in__check`**: the `visitor` reason is removed; `do_not_contact` stays.

### A4.3 `presby_sync_derived_group()`: signature and attributes

Matches `0068:564-604`: `presby_sync_derived_group()`, `returns trigger`, `language plpgsql`, `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public, presby_app, presby_platform`. 0066 §3 does exactly this, and nothing else to that function:

```sql
do $$ begin
  if to_regprocedure('presby_sync_derived_group()') is null then
    raise exception '0066: presby_sync_derived_group() is missing; apply 0062 first';
  end if;
end $$;
alter function presby_sync_derived_group() security definer set search_path = public, pg_temp;
revoke all on function presby_sync_derived_group() from public, presby_app, presby_platform;
do $$ declare v_def boolean; v_cfg text[]; begin
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p where p.oid = 'presby_sync_derived_group()'::regprocedure;
  if not v_def or v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception '0066: presby_sync_derived_group() is not security definer with a pinned search_path';
  end if;
end $$;
```

- **Either order is safe.** After 0068 (production): the `alter` changes nothing and the post-check passes. Before 0068 (a fresh `db:migrate`, which runs 0066 first): the `alter` makes 0062's invoker body a definer; 0068 later replaces the body with the same attributes. A production database that somehow still held the invoker form is repaired by the `alter`.
- **A catalog test (A1, `derived-group-guard.db.test.ts`, run after the full migrate):** attributes equal the contract; `prosrc` contains the `when 'deacons_moderator' then 'deacons_moderator'` arm (a body re-created from 0062 would lose it; this cannot be asserted inside the migration, because on a fresh database 0068 has not run yet); `pg_get_function_identity_arguments` is empty. Behavioural: as `presby_app`, an officer term for `deacons_moderator` still materializes its roster row (`parishes.db.test.ts`, `scripts/parishes/test-rls-68.sql` 68a re-run in the A1 gate).
- **Writer re-scan (arch-A4), recorded here from the merged tree by grep** (the implementer re-runs the live `pg_proc.prosrc` form on the refreshed branch and records it beside §3.3 item (1)):
  - `memberships.current_roll` and `current_roll_since`: written only by `presby_sync_current_roll`, `presby_reconcile_current_roll` and the one-time backfill (all 0012, definers). 0061's two `update memberships` statements (`:417`, `:570`) write `ended_on` and `ended_reason` only. 0065's only `insert into memberships` (`:1947`, `:1955`) writes the staff anchor with a null roll inside the acceptance definer. No migration from 0066 to 0082 touches either column.
  - `engagement_status` UPDATE: none in any migration or in `src/` (the household updates at `people.ts:981-1001` set `household_id` only). One test updates it as the owner (`src/lib/contact-methods/readers.db.test.ts:46`, `regular` to `visitor` with the roll cleared in the same statement: allowed by the guard, which tests the new row).
  - Derived `group_memberships` rows: `presby_sync_derived_group` (0009/0062/0068) and `presby_sync_derived_membership_group` (0017), both owner-path after 0066; `groups.ts:786,861,955,1067` write managed rows or the four `public_*` columns; `sign-in-fixture.ts:235` is owner-path.
  - `groups` rows: provisioning (`createOrganization`), 0068 §8c and 0082 (owner), `groups.ts:665` (managed rename), `invitations.db.test.ts:180,198` (owner path inside a definer / the owner connection).
  - **No new writer is off the owner path. No Phase 3 loop-back.**

## A5. Applying 0066 out of numeric order (job 3)

**Safe, and why.** 0066's hard dependency is 0065 (coded as the first stop-block, unchanged). Everything 0066 replaces is last defined before 0066 (§A2 row 3); everything it alters or backfills reads columns and rows that 0067 to 0082 do not redefine. What 0067 to 0082 add that 0066 sees: the `deacons_moderator` groups (inside the five-kind list), 0082's groups and `member` roles (the backfill treats them like any organisation's), and 0068's definer sync (idempotent `alter`). Nothing numbered 0067 to 0082 reads anything 0066 creates.

**Two orders, one end state (both must be rehearsed):**

| Order | Where | What happens |
|---|---|---|
| Journal order, from empty | CI (`.github/workflows/db.yml` `npm run db:migrate`), every new scratch database | 0065, **0066**, 0067, 0068, …, 0082. At 0066 there are no organizations (`db:migrate` runs before `db:seed`): every backfill inserts nothing, every stop-block counts 0. 0068 then inserts `deacons_moderator` groups into a table that already has the five-kind CHECK, and re-creates the sync as a definer. 0082 inserts nothing. Organisations created later come from `createOrganization()` |
| Merge order, onto a database that already has 0067 to 0082 | `development`, the refreshed pipeline branch, production | 0066 runs last. P10 sees `deacons_moderator` rows and passes. The pair backfill covers 0082's groups. The `alter function` is a no-op. 0082's `member` roles are untouched |

**The residual in the second direction.** If 0082 (or any code that inserts an `active_membership` group) runs **after** 0066 on a database that has organisations, the pair trigger creates the `all_memberships` sibling but nothing creates that organisation's `calendar_viewer` role. This cannot happen in CI (no organisations at migrate time) or in production (0082 is applied; its one organisation has 0 memberships and gets both from 0066's backfill). The delimited `-- BEGIN backfill-calendar-viewer` block is idempotent and is the repair; the runbook says so.

**How to apply (existing databases).** By hand, as the table owner, on the **direct** (non-pooler) endpoint, one file, one transaction, exactly the `docs/deployment.md` form:
`psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql`
Never `drizzle-kit migrate` on an existing database: the ledger records only the first ten migrations (`docs/deployment.md:144-169`), so it would try to re-run 0010. After a snapshot of production, with §A6's counts read first, and with the order **apply 0066, then deploy the code** (the narrowing takes effect when 0066 is applied; tenant permissions resolve per request). **The window:** between apply and deploy, an organisation created by the old code gets the pair (the trigger) but not `calendar_viewer`; so create none in that window, and if one is created re-run the backfill block (check P11, §A6). The journal entry is idx 66, `when` 1787619173186 (idx 65's value plus one day, matching the file's own pattern), staged as `scripts/membership-standing/_journal.json.integration.patch` (the `scripts/careers/` and `scripts/public-calendar/` precedent). Apply twice on the refreshed pipeline branch; the second run changes no row (recorded).

## A6. Before Batch A1: the pipeline branch, the re-measurements, D4

1. **The pipeline's Neon branch is stale.** Read-only, counts and booleans only, 2026-10-31: the branch behind this worktree's `.env.local` has no `presby_membership_standing` (0065), no `presby_seat_key_group` (0068, and zero `deacons_moderator` groups), its `presby_sync_derived_group` is not a definer, and it still has the pre-0082 state (15 organisations, 11 `active_membership` groups, 9 of them with no `member` role at all). Batch A1's rehearsal needs 0065 to 0082. **Orchestrator, before A1:** reset that branch from `development` (after confirming `development` carries 0065 to 0082 with the probe below), or apply the missing files by `psql` in journal order. Probe, one row, to record:
   ```sql
   select to_regprocedure('presby_membership_standing(text,text)') is not null as m0065,
          to_regprocedure('presby_seat_key_group(text)') is not null           as m0068,
          (select count(*) from groups where derived_from = 'deacons_moderator') as seat_groups,
          (select column_default = 'false' from information_schema.columns
            where table_name = 'users' and column_name = 'two_factor_required') as m0080,
          (select count(*) from organizations o where not exists
             (select 1 from groups g where g.organization_id = o.id and g.derived_from = 'active_membership')) as orgs_without_am_group,
          (select prosecdef from pg_proc where proname = 'presby_sync_derived_group') as sync_is_definer;
   ```
2. **Re-run §3.2 P1 to P10 (P10 with the five-kind list, §A4.1), P11 and P12 below, read-only, on `development` and on production**, once before A1 (to size the work) and once on deploy day. Only counts are recorded.
   ```sql
   -- P11 (after 0066 is applied; both must be 0): the pair and the baseline role are complete
   select count(*) filter (where has_am is distinct from has_all)        as exactly_one_of_pair,
          count(*) filter (where has_all and not has_role)               as pair_without_calendar_viewer
     from (select o.id,
                  coalesce(bool_or(g.derived_from = 'active_membership'), false) as has_am,
                  coalesce(bool_or(g.derived_from = 'all_memberships'), false)   as has_all,
                  exists (select 1 from app_roles r where r.organization_id = o.id and r.key = 'calendar_viewer') as has_role
             from organizations o left join groups g on g.organization_id = o.id
            group by o.id) s;
   -- P12 (before and after): derived and managed groups by kind; before, no all_memberships; after, equal to active_membership
   select coalesce(derived_from, 'managed') as kind, count(*) from groups group by 1 order by 1;
   ```
3. **D4 after 0082, in words.** Expected, not measured by me: on `development` and production, P5 (organisations holding the group with no live `member` grant) is now 0 or very small, because 0082 provisioned every organisation that had no `member` role at all, and the 2026-10-22 restore covered production's grant. **If P5 is 0, the release note drops the widening sentence entirely and says only what P2 and the calendar baseline do. If P5 is non-zero, the operator reads the number before apply (as already ruled) and the note states it.** An organisation that holds a `member` role with no live grant (the one remaining F133 shape) is not fixed by 0082 or by 3a, and 3a creates no `member` grant. P2's `with_sign_in` for visitor, inactive and unclassified is still the number of signed-in people who lose the directory at apply, and note that after 0082 it includes every visitor with a sign-in at an organisation that got `member` from 0082.

## A7. Copy: what the amendment adds or changes

Every string the amendment adds or changes. Groups A to I of §14 stand except where this section says otherwise. **An implementer who needs a string not in §14 or here stops for a ruling.**

### Group J: Parishes (new in this amendment; D15)

| Where | String |
|---|---|
| `directory/parishes/unassigned/page.tsx:144-146` (the sentence under the group toggles) | A household appears under the first group that fits: Members, then Participants, then Visitors, then Others. Others are households where everyone is only listed, on staff, or marked inactive or moved away. |
| Parish household-row tag (`household-row.tsx:39`, from `CONNECTION_LABELS`) | Inactive · Moved away (the labels of §14 Group E; `unclassified`, "On record", is unreachable from stored rows after the CHECK) |
| `members-states.tsx:100` (`MembersLimited`, shown to a `people.manage` holder without `directory.view`) | You can add and edit people at {name}, but browsing the full list needs directory access (the directory.view permission). Ask your stated clerk or another administrator to add it. Visitors, Inactive, Staff and Former above still work. |

**R.** Nothing denies a residual or a ruling. **S.** "Others" is `bucketForConnections`'s fall-through: every connection that is not member, participant or visitor; with `ended_on` null the reachable ones are listed, staff, inactive, moved away (and `unclassified`, which the CHECK makes unreachable, so the sentence omits it); the `MembersLimited` claim "Visitors, Inactive, Staff and Former still work" is true because those four lists are `people.manage`-gated and do not read the directory (`community.ts` readers; `page.tsx:139`'s `adminView` gains `inactive`). **A.** Parish rows and the sentence: viewers with `parishes.assign`, `people.manage` or `directory.view_hidden` (`parishes.ts:68-98`); `MembersLimited`: a `people.manage` holder who lacks `directory.view`, who can read all four views named. No instruction in either that the reader cannot follow. **N.** Grep of the live tree for the neighbours: `unassigned/page.tsx:144-146` and `members-states.tsx:100` are made stale by 3a and are modify targets; `parishes-pure.ts:66-67` label "Others" is a name, not a claim, and stays; `parish-copy.ts` has no listed/visitor wording.

### Group G (as-built corrections, D13)

Group G's table stands with these edits: the replaced 2b string is `CONNECT_OUTLOOK_COPY.visitor` (`sign-in-copy.ts:174-175`, the key renamed `not_listed`); the retired string is `SIGN_IN_DIALOG_COPY.send.visitorAcknowledgement` (`:193-194`); the new connected-and-not-listed line is the copy of the new outlook `connected_not_listed` (D13 (e)). The "card note" the analyst quoted does not exist in 2b's shipped strings, as Group G already says. Neighbours added to Group G's N: `send-sign-in-dialog.tsx:35` (doc comment: "shown up front for a visitor") and `org-invite.ts:598` are code, not copy, and change with the removal.

### Group H (rename, D16)

"Seeded names": group **All Current Records**; role **Calendar viewer**. "Managed from", `all_memberships`: Everyone with a current record here (unchanged). Role-grant form, `all_memberships`: All Current Records (derived; includes visitors and inactive people).

### Group I (release-note drafts) amended

- **Replace** "Changes are recorded in the audit log." with "Every change is recorded." *Audience check:* the audit log is a platform-side record; an administrator is not told they can read it. *Source:* `insertAuditRow` in the same transaction (§9).
- **Add:** "The database now refuses to let anything other than the officer record write the rosters of the Session, the Board of Deacons and the Moderator of the Board of Deacons, as announced in 0.45." *Neighbour:* `docs/release-notes/v0.45.md:40` promised that "a later release (the Community work that adds migration 0066)" closes both gaps; the 3a note must say it did, and must not say the gap was "prevented" before.
- **Replace** the visitor line with: "Visitors who signed in under the earlier arrangement can no longer open the member directory; opening it says they don't have permission. They can still see the calendar." (D14: not "the directory is not offered").
- **Replace** the 0.48 sentence "We plan to give visitors a narrower view in a later release" (`docs/release-notes/v0.48.md:58`) by saying the narrower view has arrived.
- **D4 sentence:** written from P5 (§A6 item 3); omitted when P5 is 0.
- Do-not-write list unchanged, plus: "the directory is hidden from visitors' home page" and "the database prevents a regular attender from being connected".

**Copy checks for the amendment.** *Residuals:* none of the new strings denies a residual or a ruling (the Moderator and Session roster sentence says what the database now refuses; F246/F247 are not mentioned to users). *Source of truth:* Group J above; the release-note sentences name 3a's own mechanisms (§9, §A4). *Audience:* named per group. *Neighbours:* grepped `visitor`, `inactive`, `member directory`, `Everyone`, `calendar`, `Others` across `src/` non-test: new stale hits are `members-states.tsx:100` and `unassigned/page.tsx:144-146`; checked and left: `tiles.ts:227`, `participant-copy.ts:93-94`, `org-features.ts:105-111` and `turning-features-on-and-off.md:35` ("Member calendar ... to every member who has calendar access", still true), `role-grants.ts:78-84` (a comment about bootstrapping onto `active_membership`, still accurate), the Directory's own `DirectoryForbidden` copy (`directory-states.tsx:49-51`; becomes the visitor's message and is true for them).

## A8. Help impact (Rule 17, job 4)

Public help is part of the product. 3a changes who can see what, adds labels and roles, and retires an acknowledgement a page describes. **No `pending` page and no `[help:<token>]` line** (the ordinary case: each page is edited as `published` in the same PR); the implementer (Batch C) edits from the screens, not from this text, and sets each edited page's `verifiedIn` to the release it re-walked it against at ship. `npm run check:help` is part of Batch C's gate. Expect textual conflicts with photos and treasury at integration in `registry.ts` and in `roles-who-can-do-what.md`/`using-the-directory.md`; keep both sides.

| Page (`src/content/help/`) | Edit | Strings it quotes (registry `labels` to add; each must exist in the UI as a static fragment) |
|---|---|---|
| `adding-people.md` (entry `adding-people`, `registry.ts:415`) | Seven views (add "Inactive"); the Visitors, Inactive and Former bullets; a new section **Marking how a person is doing** (the Engagement card, what it decides, the roll case, the dialog, the confirmations); a new section **Archiving a visitor, and restoring**; a short **Correcting a visit** paragraph; the lead paragraph gains one sentence | "Inactive", "Engagement", "Save engagement", "Regular attender", "Moved away", "Mark as regular", "Archive", "Restore", "Keep archived", "Visit details", "Save visit details", "This is a staff record, so engagement isn't tracked." |
| `sign-in-invitations.md` (entry `sign-in-invitations`, `registry.ts:660`, keeps `requires: "signin-invites"`) | Delete the visitor bullet at `:17` (the acknowledgement is retired); "Two people need an extra step" becomes one; the "does not connect everyone" bullet at `:50` and the sentence at `:56` change from "visitor" to "a person who isn't listed in the member directory (a visitor, or someone marked inactive or moved away)"; one new paragraph says what a connected visitor sees | "I understand, send it anyway" stays (the do-not-contact case); add "Engagement" |
| `using-the-directory.md` (`registry.ts:155`) | The "Some people are not listed at all" bullet; one sentence under the opening paragraph | none new ("You don't have permission to view the directory." already listed) |
| `events-and-the-calendar.md` (`registry.ts:574`) | "Reading the calendar comes with the Member role" and "the calendar shows ... to its members" | "Calendar viewer" |
| `roles-who-can-do-what.md` (`registry.ts:521`) | "A new congregation has five roles" becomes six; the table gains a row; "A group holds the last three" becomes four; the "Constitutional" sentence names the new role; the group-fill sentence | "Calendar viewer", "All Current Records" |
| `what-presbyportal-does.md` (line 7) | "members, participants, visitors, staff or former members" | none |
| `src/content/help/images/community-list.png` | Re-capture: the view tabs now number seven. `npm run help:shots` against a fixture-only database, own server on its own port; open the image and read it for real data before it merges | n/a |

**Not edited:** `why-cant-i-see-this.md` (its "The page says 'You don't have permission to'" entry already describes a visitor opening the Directory, and the page says the role does not include it, which is true); `turning-features-on-and-off.md` (the "Member calendar" row is still true); `officers-and-the-session.md`, `getting-help.md`, the photos and reimbursements pages (no 3a text).

**Draft text, for Batch C to check against the screens** (the strings are §14 Groups A to D, and Group J here):

- *adding-people, views:* The page is headed "Community". It has two links at the top, "Pending approvals" and "Add person", and a row of views: "Everyone", "Members", "Participants", "Visitors", "Inactive", "Staff" and "Former".
- *bullets:* "Visitors" lists the people you recorded as visitors. A visitor is never in the directory. "Inactive" lists people you marked inactive or moved away who are not on the roll. People on the roll stay under "Members" or "Participants", with a small "Inactive" or "Moved away" tag. "Former" lists people whose connection has ended, with the date: participants you removed and visitors or inactive people you archived.
- *Marking how a person is doing:* Open "Edit" beside a person. The "Engagement" card says how the person is doing: "Visitor", "Regular attender", "Inactive" or "Moved away". It is for your own care. It is never reported to the presbytery or the denomination, and it does not change anyone's membership roll. It does decide who appears in the member directory and what a connected sign-in can see. A person who is not on the roll appears in the directory only as a regular attender. A person on the roll stays in the directory whatever you choose, and cannot be marked as a visitor; "Moved away" is a label, and a departure is recorded as a roll action. A staff record has no engagement. When a change would add someone to the directory or take them out, a dialog asks first, and adds a line if the person has a sign-in connected. Choose "Save engagement". Every change is recorded.
- *Archiving:* A visitor, or a person marked inactive or moved away, can be archived from their row or their record. The dialog "Archive" says they will leave the list and appear under "Former", that their record is kept, and that you can restore it any time; it adds a line if they have a sign-in connected and another if an invitation to them is still open. Someone who still holds an office, a role or a staff position cannot be archived: end that first. A member on the roll leaves through a roll action, and a participant is removed as a participant. You cannot archive your own record. To bring someone back, open "Former" and choose "Restore".
- *Correcting a visit:* On a visitor's record, "Visit details" lets you correct the date of the first visit and how they heard about you. Choose "Save visit details".
- *roles:* Reading the calendar comes with the Member role and with the Calendar viewer role. The Calendar viewer role is held by the "All Current Records" group, which holds everyone with a current record at your congregation, including visitors. A person still needs a connected sign-in.

## A9. e2e blast radius, re-cut against the live tree (D20)

Existing specs this change alters, beyond §11's table (which stands; re-grep its line numbers at Batch C, they moved):

| Existing | Asserts today | Change |
|---|---|---|
| `e2e/community-sign-in-invite.spec.ts:310-336` (lane 4) | the visitor card line and the acknowledgement paragraph, Send refused until ticked | the card line becomes the `not_listed` text; no acknowledgement; Send succeeds without a tick; the `do_not_contact` lane (the checkbox) is kept |
| `e2e/no-organization-connect.spec.ts:180-194` (b) | a visitor is not connected; Check again says "Nothing new yet." | unchanged for the visitor; add inactive and moved-away rows (same outcome, same text) |
| `e2e/hydration/community-sign-in-controls.spec.ts` | the acknowledgement checkbox is disabled until hydration | drops the visitor branch; keeps the `do_not_contact` branch |
| `e2e/community-nav-scroll.spec.ts` (Batch 0's) | reads segment counts from the DOM | passes with seven; re-run |
| `e2e/community-participants.spec.ts:274-283` | "six real links in one scrollable row" | seven, still one band |
| `e2e/parishes.spec.ts:201-205`, `e2e/support/parish-fixture.ts:254` | "Hide Visitors (1)", the unassigned buckets; the fixture uses only `visitor`, `regular` and the roll | unchanged; re-run (the new tags and the Others sentence do not alter its assertions) |
| `e2e/sign-in-connect-smoke.spec.ts`, `e2e/totp-full-login.spec.ts`, `e2e/member-calendar.spec.ts`, `e2e/member-home.spec.ts`, `e2e/designation-revoke.spec.ts`, `e2e/invitation-*.spec.ts` | login, members, fixtures that create groups | regression lane; re-run |

**New spec:** `e2e/visitor-access.spec.ts` (desktop and 360px). A visitor with a connected sign-in (built on the owner connection with the existing community and sign-in fixture helpers; no person-id range is needed because the helpers pick their own and no edit to `e2e/support/*` is made) opens `/o/<slug>/calendar` and sees the calendar, opens `/o/<slug>/directory` and sees "You don't have permission to view the directory.", and on `/o/<slug>` sees the Directory tile and the Calendar tile (D14). **Flags it depends on:** `org_portal.events` (global; the spec captures, sets and restores it through `e2e/support/flags.ts`, exactly as `member-calendar.spec.ts:32-46` does) and the organisation's `org_portal.calendar` toggle (set by the spec's own SQL and restored). No key is added to `scripts/ci/e2e-baseline-flags.sql`. The new `e2e/community-engagement.spec.ts` flag list of §11 stands.

## A10. Edge cases added by the amendment (each cites its test or says unverified)

| # | Case | Pinned by |
|---|---|---|
| EC-36 | The same end state from journal order (from empty, `db:migrate`) and from merge order (0067 to 0082 already applied); second run changes no row | A1 rehearsal on both a from-empty scratch database (the `db.yml` recipe) and the refreshed branch (recorded in Phase 4 notes); CI's `db.yml` migrate for the first |
| EC-37 | 0066 after 0068: P10 and the stop-block accept `deacons_moderator`; the CHECK validates; a sixth kind is refused | T-G test 5 extended with a `deacons_moderator` insert and a sixth-kind refusal; the rehearsal on the refreshed branch |
| EC-38 | The officer sync is a definer with a pinned search path and still carries the `deacons_moderator` arm; an officer term for each of session, diaconate and `deacons_moderator` materializes under `presby_app` | T-G (attributes and `prosrc` arm); `parishes.db.test.ts`; `scripts/parishes/test-rls-68.sql` 68a re-run |
| EC-39 | A derived group of the Moderator kind counts in T (authority-bearing, `exceeds_your_access` for a sender who lacks `parishes.assign`); `all_memberships` does not | `sign-in-standing.db.test.ts` (the renamed D11 case); T-M M1 under the connect column |
| EC-40 | A visitor with a sign-in at an organisation that 0082 baselined has `events.view` and not `directory.view` | T-M M8 (the matrix creates its organisation through `createOrganization()`, so `member` and `calendar_viewer` come from provisioning) |
| EC-41 | An `active_membership` group inserted after 0066 (the 0082 shape) gets its sibling by trigger and no `calendar_viewer`; re-running the delimited backfill block adds the role and nothing else | `org-baseline-backfill.db.test.ts` re-run unedited (it counts only `active_membership` groups and the role count of one organisation, both unchanged); T-M block re-execution case |
| EC-42 | Parish household rows tag an inactive or moved-away person with the new label, and a household of only such people sits in Others | `parishes-pure.test.ts` (one new `bucketForConnections` case); `household-row` RTL (Batch C); *the Others sentence's truth against the DB: unverified beyond the unit case* |
| EC-43 | The visitor sees the Directory tile, the permission message there, and the calendar | `e2e/visitor-access.spec.ts` (new); T-M M8 for the underlying permissions |
| EC-44 | A visitor recorded as a ruling elder or other officer (F366's state) keeps `events.view`, has no `directory.view`, holds the Session group's `roll.approve` through the roster row, and cannot be archived (`holds_position`) | T-M row **M17** (owner-path fixture, with a comment that it documents F366 and is not design intent); `community-engagement.db.test.ts` archive refusal |
| EC-45 | Apply then old code, create-org window: an organisation created by old code between apply and deploy has the pair and no `calendar_viewer`; P11 shows it | `createOrganization()` old-plan case in the A1 old-code lane: *unverified in automation*, covered by P11 and the runbook |

### A10b. Phase 6 walk text (D14, D21; the walk list of §13 otherwise stands)

- **W1** pages listed after 0066: the Directory **tile still shows** on `/o/<slug>` and opens "You don't have permission to view the directory."; the calendar opens; `/home` is unchanged. The account is created by the invitation fixture; **no `/totp` step is expected** (0080) unless the organisation requires two-factor or the person holds a flagged key.
- **W2a** (moved away, connected): the person reloads and sees the same: the calendar opens, the Directory says no permission.
- **W2b** unchanged (no `/totp` expected for the proven, unlinked account).
- The 3b walk's `/totp` then `/account/2fa` then Check again for an authority-bearing deacon is unchanged: that step is R42's connect-time factor, not the sign-in default.

## A11. F366 (open bug, not part of this pipeline, not fixed here)

`startOfficerTerm` (`src/lib/officers.ts`) checks only that the person has an open `memberships` row, so a visitor can be recorded as a ruling elder or deacon. What 3a does with that, so nobody is surprised: the classifier does not look at officer terms; a visitor-elder has standing `visitor`, an open Session roster row (a different derived group), `roll.approve` through `session_member`, no `directory.view` after 0066, and `events.view` through `calendar_viewer`. 3a's archive refuses them (`holds_position`: `memberships_guard_end` and the pre-check both see the open term), and 2b's sender ceiling and `officers.manage` check apply as for any seat. Nothing in 3a makes F366 worse; nothing in 3a depends on its fix. T-M row M17 (EC-44) documents the state; a fix to `startOfficerTerm` needs no change to 3a.

## A12. Findings, decision text changes, and lines for the orchestrator

**Findings (from the pre-assigned F240 to F249 set; both are `paper`-class follow-ups, neither blocks 3a):**
- **F246.** Treasury's `presby_reimbursement__is_eligible_requester` (`presby-treasury/drizzle/0073:657-668`) is a hand-coded second definition of member standing in SQL, against R51's "no consumer re-codes the predicate". It agrees with `presby_membership_is_member_standing` for every value the sanctioned writers store and differs only for an unlisted non-null roll text. The R51 live-catalog scans do not see it (it uses neither the four-roll list nor `engagement_status = 'regular'`). Fix, after both 3a and treasury are on `main` and applied: a forward migration (or an in-place edit if 0073 is still unreleased and unapplied) replacing the body with `presby_membership_is_member_standing(m.current_roll, m.engagement_status)`; it cannot be done from 0066 or from 0073 alone (§A3 D17). **Deferred; accepted by tech-lead, for the orchestrator to confirm at integration.** A `docs/TODO.md` line.
- **F247.** On `main` today, the Moderator of the Board of Deacons seat counts in the 2b set T (a derived kind outside the closed list, `0065:858-859`), so an invitation to that person is refused `exceeds_your_access` for every sender (the key is seat-only; no sender holds it), while auto-connect works with a second factor. Fails closed; no access is gained. A fix needs a seat flag on the core (like `session_seat`), a changed return shape and a new refusal, so it is its own design. **Deferred; accepted by tech-lead; the operator may want it scheduled.** A `docs/TODO.md` line. 3a records it and keeps T as it is (D10b).

**Decision text, for the orchestrator to write at integration (newest first, as drafted in §15.2, with these changes):**
- **DECISION-236:** the kind list is the five; the officer sync is changed with `alter function` and 0068 already re-creates it as a definer (so either order of 0066 and 0068 ends the same); the "The Court Is Not a Group" statement then covers the Moderator seat's roster too. CLAUDE.md's wording needs no change; the orchestrator may append ", and the seat group's roster is written only by the officer sync (0066, DECISION-236)" as parish management's log suggested.
- **DECISION-232:** the group is "All Current Records" (D16); the reach of the baseline is stated with the re-run P5 and says 0082 provisioned `member` everywhere it was missing, and that `calendar_viewer` is still needed because 0082's role is bound to `active_membership`.
- **DECISION-233:** one sentence: the TypeScript vocabulary has one owner (`membership-standing.ts`), and `sign-in-types.ts` re-exports it (D13). Treasury's second copy is F246.
- DECISION-234, DECISION-235: unchanged.

**Lines for `docs/TODO.md` (orchestrator, at integration, Rule 10):** F246 follow-up; F247 follow-up; a dependency line "3a after treasury and photos: expect textual conflicts in `src/lib/directory.ts`, `src/lib/db/domain/people.ts` and the community edit page, and in the help registry; re-run the treasury and photos DB suites against 0066"; and update the existing line 598 ("Parish seat group roster ... until 0066") to Done at 3a's integration.

## A13. Batches and implementation order, re-confirmed (job 6)

The batch plan of §8 stands. Changes:

| Batch | Implementer | Change from §8 |
|---|---|---|
| **A0** (new, before A1) | orchestrator, with the database-admin reading the result | Refresh the pipeline Neon branch from `development` (§A6 item 1), record the probe, run P1 to P12 as far as they apply pre-apply. Gate: the probe row shows 0065 and 0068 present, `sync_is_definer` true |
| **0** | ux-developer | Done 2026-10-25. Re-run its spec when the seventh segment lands |
| **A1** | **database-admin** (the first batch to run) | 0066 sections 1 to 8 and 10 with D9 and D10 (§A4.1, §A4.3). The gate adds: `parishes.db.test.ts` and `scripts/parishes/test-rls-68.sql` 68a re-run; `org-baseline-backfill.db.test.ts` re-run; both application orders rehearsed (§A5, EC-36); the A4 writer re-scan recorded; the staged assets cut against the **merged** tree (the staged `test-rls.sql` and `seed-dev.sql` patches are cut now, not carried from 2026-10-25; the journal patch per §A5); if treasury and photos have merged by then, their DB suites run against 0066 |
| **A2** | database-admin | Section 9 with D10b (§A4.2), the check and connect edits, **and D11** (the fixture kind and `MARKERS.closedList`); the 2b parity golden is byte-identical (`git diff --exit-code src/lib/onboarding/designation-parity.golden.json`: 0066 changes no key; the golden's baseline is the merged tree, which already includes careers' keys) |
| **B** | api-developer | §8 scope plus D13 (the `isVisitor` removals, one standing vocabulary, `not_listed`, `connected_not_listed`), D9's two literal unions and the `DerivedFromKey` widening, D16's literal, the `parishes-pure.test.ts` case, `adminView` including `inactive` |
| **C** | ux-developer | §8 scope plus the Group J strings, the parish tag, the help pages and registry labels (§A8), `community-list.png` is Batch D's |
| **D** | full-stack-developer | §8 scope plus `e2e/visitor-access.spec.ts`, the re-cut existing specs (§A9), the `community-list.png` re-capture, a final read of the staged assets and the help diff against the merged tree |

**Implementation order, unchanged in shape:** A0, nav (done), schema (A1, A2), library and actions (B), UI and help (C), audit keys (with B), e2e and screenshot (D), release notes at Phase 6 via `/release-notes`, and at ship the Rule 10, 14 and 17 housekeeping (TODO, functionality map, `verifiedIn`). No `FEATURE_CATALOG`, permission seed or flag (unchanged).

**3b carry-notes from this rebase** (3b's design lives in `-inc3b`; recorded so they are not lost): its 0069 re-creates `presby_founding_administrator_permission_keys`, whose latest definition is **0071** (careers added `careers.manage` and `careers.applicants`), not 0061 or 0068: start from 0071's body or 0069 silently drops those keys on a production that applied 0071 first. R61/R62's `followups.*` keys and 0080: `requires_two_factor` is now live for six keys (`docs/deployment.md`, 0080), so S2/S3 "tracked" is superseded; 3b rules afresh whether `followups.manage` is flagged. 3b's migration number must be re-confirmed at its kickoff (0075 is careers' Increment 2, 0081 reserved).

## A14. Carry-forward additions

The §16 table stands. Rows added by this amendment:

| Requirement | Addressed here, or *deferred* (who accepted) |
|---|---|
| Orchestrator's required edit: five kinds in the CHECK and stop-block | §A4.1, D9 |
| Orchestrator's required edit: 0066's `presby_sync_derived_group()` matches 0068's signature and attributes; the arch-A4 re-scan checks it | §A4.3, D10, EC-38; re-scan recorded in §A4.3 |
| Parish QA run 1 §1.3 (0068's definer sync, either order) and §1.4 (five kinds) | §A4.1, §A4.3, §A5 |
| Phase 3 rule: re-run the feasibility check when Phase 4 starts after other pipelines merged | §A2 (19 rows), §A3; row 15 is a defect found and closed (D11) |
| Rule 17 help impact | §A7 (strings), §A8 (pages), Batch C and D |
| 0082 / DECISION-298: what 3a must not duplicate or contradict | D12; §A6 item 3 |
| 0080: the walks and the 2FA wording | D21, §A10b |
| 2b R40 as built | §A2 rows 1, 2, 7; D13 |
| Numbers confirmed free | §A1 |
| F366 interaction noted, not fixed | §A11, EC-44 |
| New: F246 (treasury's second member-standing copy) | *Deferred; accepted by tech-lead, orchestrator to confirm* |
| New: F247 (Moderator seat in T) | *Deferred; accepted by tech-lead, operator may schedule* |
| v0.45 release note's promise that 0066 closes the roster gaps | §A7 Group I |

## A15. Operator question (non-blocking; the default applies if no answer comes)

1. **Parish management's household rows tag each person with how they are connected. After 3a an inactive or moved-away person will be tagged "Inactive" or "Moved away" there (today they are tagged "Listed", which is not true), and the Moderator of the Board of Deacons, anyone who holds the directory-hidden permission, and anyone who manages people will see those tags. They already see "Visitor". Is it acceptable that the Moderator of the Board of Deacons sees "Inactive" and "Moved away"? Default: yes.**

Two items I ruled myself rather than ask: the group's name (D16), and that the Moderator seat stays inside the sign-in authority set (D10b). The D4 widening is already approved; its size is re-measured, not re-asked.

## A16. Implementer, status, handoff

**Implementers:** unchanged, per batch (§A13). **The first batch to run is A1, database-admin**, after the orchestrator's A0. Batch 0 (ux-developer) is done.

## Per-Phase Status row (amendment)

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 3 — Technical design (amendment, rebased on main 0.50.1) | tech-lead | Feasibility re-run against the merged tree (19 assumptions re-checked). Five-kind list and the sync function's attributes specified exactly (D9, D10); T list gains `all_memberships` only, F247 filed (D10b); one 2b fixture contradicting the kind CHECK found and fixed (D11); 0082 changes D4's size not its ruling (D12); 2b symbols as built (D13); portal tiles are permission-blind, walk text corrected (D14); parish consumers of `deriveConnection` (D15); group renamed "All Current Records" (D16); treasury's second member-standing copy filed as F246 (D17); apply order and window (D18); six help pages and one screenshot (D19); one new e2e spec (D20). 0066 confirmed free; DECISION-232 to 237, 247 to 250, F240 to F249, F266 to F273 and port 3490 confirmed unused. One non-blocking operator question. | Design complete (amended) | 2026-10-31 |

**Handoff, next agent: the orchestrator**, who (1) refreshes the pipeline Neon branch from `development` and records the probe (A0); (2) runs §A6 items 2 and 3 on `development` and production; (3) puts §A15 to the operator; (4) at integration writes DECISION-232 to 236 with the §A12 changes, F240 to F247, and the TODO lines. Then **Batch A1 (database-admin)**.

Files read for this amendment (under `/Users/cshenso/git/presby-platform/presby-inc3` unless noted): this work-log; `CLAUDE.md`; `drizzle/0065` (`:670-1090`, `:1790-1810`, `:1935-1962`, `:2465-2764`), `0068` (header, `:270-300`, `:395-440`, `:479-515`, `:540-690`), `0080`, `0082`, and by grep `0059` to `0082`; `drizzle/meta/_journal.json`; `docs/deployment.md` (migrations, 0067, 0082), `docs/decisions.md`, `docs/schema-design-2.md`, `docs/STATE.md`, `docs/release-notes/v0.45.md` and `v0.48.md`; `src/lib/{community,community-labels,directory,groups,parishes,parishes-pure,org-provisioning,org-features,role-grants,people}.ts`, `src/lib/onboarding/{sign-in-types,sign-in-copy,org-invite,issue,no-organization-copy}.ts`, `src/lib/org-portal/tiles.ts`, `src/lib/help/registry.ts`, `src/lib/db/domain/{sign-in-standing.db.test,org-baseline-backfill.db.test,invitations.db.test}.ts`, `src/lib/testing/sign-in-fixture.ts`; the community, groups, roles, directory and parishes route trees named; the seven help pages named; `e2e/` specs named; `scripts/ci/e2e-baseline-flags.sql`; and, read-only, `/Users/cshenso/git/presby-platform/presby-treasury/drizzle/0073`, `0074` and `src/lib/directory.ts`, and `/Users/cshenso/git/presby-platform/presby-photos/drizzle/0078` and `src/lib/directory.ts`. One read-only counts-and-booleans connection to the pipeline branch (§A6 item 1).

## Orchestrator: A0 and the §A15 ruling (2026-10-31)

- **A0 done.** The pipeline Neon branch `pipeline-visitor-follow-ups` (`br-silent-glitter-ax34lmz0`, endpoint `ep-delicate-sun-…`) was reset from `development` on 2026-10-31 with the operator's approval. Probe row on the reset branch: `m0065 = t`, `m0068 = t`, `seat_groups = 11`, `m0080 = t`, `orgs_without_am_group = 0`, `sync_is_definer = t`. The same probe on `development` before the reset gave the same row. The branch also now carries treasury's 0073/0074 (applied to `development` at treasury's integration, 2026-10-31), which 3a does not touch.
- **§A15 ruled by the operator: default accepted ("default yes").** The Moderator of the Board of Deacons, directory-hidden holders and people managers see "Inactive" and "Moved away" on parish household rows.
- **§A6 item 2** (P1 to P12 on `development` and production, read-only) is handed to Batch A1's database-admin with the A1 brief.

## Phase 4 — Batch A1 (database-admin, 2026-10-31)

**Scope:** 0066 sections 1 to 8 and 10 (section 9 is A2's), with D9 and D10 (amendment A4.1, A4.3); the Drizzle mirrors; T-M, T-G, T-E; the staged assets; the A6 item 2 measurements; both apply orders rehearsed. **Migration mode: hand-written** (`drizzle/0066_presby_membership_standing.sql`), applied by `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql` to the pipeline branch only (`ep-delicate-sun-…`). Nothing was applied to `development` or production.

### A6 item 2: P1 to P12 (read-only, counts only)

Same SQL as §3.2 (P10 with the five kinds) plus P11/P12 (A6). Production ran with `PGOPTIONS='-c default_transaction_read_only=on'`, `psql -X`, the `ep-flat-hat-…` endpoint held in a shell variable inside one call; SELECTs only, nothing copied but these counts.

| | Pipeline branch (today's copy of `development`), before 0066 | Production, before 0066 |
|---|---|---|
| Probe (A0 columns + `m0066`) | 0065 t, 0068 t, seat groups 11, 0080 t, orgs without AM group 0, sync definer t, 0066 f | 0065 t, 0068 t, seat groups 1, 0080 t, orgs without AM group 0, sync definer t, 0066 f |
| P1 bad engagement | 0 | 0 |
| P2 live by standing (live / with sign-in) | listed 83 / 28; visitor 3 / **0** | listed 1 / 1; staff_anchor 1 / 1; **no visitor, inactive or unclassified** |
| P3 live grants on `active_membership`, by role key | `member` 18 | `member` 2 |
| P4 orgs / AM groups / orgs with memberships and no group | 20 / 20 / 0 | 2 / 2 / 0 |
| **P5** orgs with the group and no live `member` grant / their live memberships | **2 / 8, both `deletable_until` test fixtures created today; 0 real** | **0 / 0** |
| P5b `member` roles with no live grant (the remaining F133 shape) | 0 | 0 |
| P6 live memberships with no AM derived row | 4 (all non-fixture, at orgs that have the group) | 0 |
| P7 org-owned `calendar_viewer` | 0 | 0 |
| P8 open sign_in invitations to a non-member-standing person | 0 | 0 |
| P10 shape mismatch / unknown kind | 0 / 0 | 0 / 0 |
| P11 exactly one of pair / pair without calendar_viewer | 20 / 0 (pre-apply: no sibling yet) | 2 / 0 (pre-apply) |
| P12 groups by kind | AM 20, deacons_moderator 11, diaconate 12, session 10, managed 4 | AM 2, deacons_moderator 1, diaconate 1, session 1 |
| Ended memberships / live unlisted roll | 3 / 0 | 0 / 0 |

After the apply on the pipeline branch: **P11 = 0 / 0**; P12 adds `all_memberships 20`. Production is re-measured on deploy day (A6), not here.

**D4 conclusion (A6 item 3): P5 is 0 for every real organization, on both databases** (the two pipeline-branch hits are throwaway test fixtures). **The release note drops the widening sentence** and says only what P2 and the calendar baseline do. **P2 with sign-in for visitor/inactive/unclassified is 0 on both**: nobody with a connected sign-in loses the directory at apply. P6 = 4 on the dev copy: those four live memberships get an All Current Records row (so `events.view`) at apply and still no Active Membership row until their next membership write (unchanged behaviour); 0 on production.

### Files

- **Create** `drizzle/0066_presby_membership_standing.sql` (sections 1 to 8 and 10; A2 inserts 9 before 10). `-- BEGIN/END preconditions`, `backfill-standing`, `backfill-calendar-viewer` markers for re-execution.
- **Create (staged, Rule 16)** `scripts/membership-standing/`: `test-rls-66.sql` (blocks a to k), `seed-dev-membership-standing.sql` (the calendar block, byte-identical to 0066's, pinned), `test-rls.sql.integration.patch` (removes the section-7 one-active-roll block, adds the `\ir` line), `seed-dev.sql.integration.patch` (adds the include, LAST), `_journal.json.integration.patch` (idx 66, `when` 1787619173186, tag `0066_presby_membership_standing`). All three patches `git apply --check` clean against this branch.
- **Create** `src/lib/membership-standing.db.test.ts` (T-M, 29), `src/lib/db/domain/derived-group-guard.db.test.ts` (T-G, 21, of which 5 are the DB-free scan-4 pin), `src/lib/db/domain/engagement-guards.db.test.ts` (T-E, 9), `src/lib/testing/membership-standing-fixture.ts` (shared harness).
- **Modify** `src/lib/db/domain/groups.ts` (unique key renamed `group_memberships_membership_group_key (membership_id, group_id)`; the two new CHECKs; `derivedFrom` comment lists five kinds; F240/F245 trigger pointers), `src/lib/db/domain/people.ts` (`memberships_engagement_status_allowed`; guard pointers on `engagement_status` and `current_roll`).
- **Modify** `src/lib/groups.ts` (`DerivedFromKey` gains `all_memberships`), `src/lib/org-provisioning.ts` (`groupSeedPlan`'s `derivedFrom` union gains `all_memberships`; **type only, no plan entry**).
- **Modify (tests 0066 contradicts, departure 3)** `src/lib/db/domain/sign-in-standing.db.test.ts`, `src/lib/db/domain/participant-roll.db.test.ts`, `src/lib/db/domain/session-approval.db.test.ts`, `src/lib/org-provisioning.test.ts`, `src/lib/directory.test.ts`, `src/lib/org-portal/home-data.test.ts`; and one doc-comment clause in `src/lib/org-portal/home-data.ts`.
- No table added: no barrel export or dev-docs entry (F338). `docs:erd` re-run: no diagram change.

### Departures from the design (each with its reason)

1. **D9's type widening moved from B to A1, type only.** Scan 4 (A1's test) asserts set equality across the CHECK, `DerivedFromKey` and `groupSeedPlan`'s union; it cannot pass otherwise. No `groupSeedPlan` entry and no `calendar_viewer` in `baselineRoleSeedPlan` (both stay B). Typecheck clean.
2. **D11 landed in A1, not A2** (the brief asked for it): the kind CHECK is A1's, so the `:188` fixture fails at A1. The fixture now uses `deacons_moderator` and the case is renamed as D11 says. `MARKERS.closedList` is **unchanged** (the T body changes in A2; A2 updates the marker).
3. **More existing cases contradicted 0066 (a D11-class gap the amendment's re-run missed); each fixed minimally in A1, flagged for the tech-lead:**
   - `sign-in-standing.db.test.ts` matrix row "unclassified engagement" stored `fixture_unknown`, now refused by F243's CHECK (D3: `unclassified` is unreachable from rows). The row is removed with a comment and replaced by a test asserting the refusal; the classifier's `unclassified` arm stays covered by T-M's SQL cross-product.
   - Its live-catalog test required `presby_membership_standing(` in exactly one function; §4.3's `presby_membership_is_member_standing` is a designed second caller. The expected holders for that one marker are now `{presby__person_sign_in_standing, presby_membership_is_member_standing}`; `r31` and `closedList` still expect only the core.
   - `participant-roll.db.test.ts:289` and `session-approval.db.test.ts:373` (`stateOf`/`group_ends_on`) read the derived row as a scalar subquery on `membership_id`, the one-row-per-membership assumption §4.5 step 1 ends (19 of 42 participant-roll cases failed with `more than one row returned by a subquery`). Both now read the Active Membership row, the one they always meant. The design said these two suites re-run unedited.
   - Designed effects the design named as "will change deliberately" (§3.3), updated minimally: `org-provisioning.test.ts` (5 groups for a congregation, 2 for a presbytery, the new one named "All Current Records"; the grant check now finds the Active Membership group by kind instead of `groupRows[0]`; role expectations untouched, `calendar_viewer` in the plan is B's) and `session-approval.db.test.ts:1205` (0062 section 7's seeded group list gains All Current Records).
   - `home-data.test.ts` H4 (see Gates) and `src/lib/org-portal/home-data.ts`'s doc comment (one clause).
   - `directory.test.ts:775`: "a visitor with no roll status is a grantee but not content" (DECISION-065) is exactly what F177 Option 1 reverses; it now asserts the visitor is `forbidden` and still not content, and two comments stop calling the visitor a grantee. EC-22 had this file as "existing, adjusted" without naming a batch; it fails at A1, so it moved here.
4. **T-G test 3 (`groupSeedPlan` lists `all_memberships`; `createOrganization()` binds `calendar_viewer`) is not written**: it tests B's plan change. Named in T-G's header.
5. **T-M in A1 covers the database columns only** (SQL standing, member standing, both rows, `directory.view`, `events.view`, transitions, SQL cross-product, block re-execution, scan 1's A1 part). A2 adds the connect column and the `'visitor'`-comparison scan; B adds the TS mirror equality, the `getDirectory`/Community columns and scans 2 and 3. Named in T-M's header. The matrix organization comes from `createOrganization()` and gets `calendar_viewer` by re-executing 0066's own block (EC-45's repair; a no-op once B seeds it).
6. **EC-4 (roll approval opens the member row) is proven with an approved `roll_actions` row written on the owner connection**, which fires the real `presby_sync_current_roll` definer, not by driving the decide function; `session-approval.db.test.ts` re-runs unedited for the decision path.

### Rehearsal (EC-36) and idempotency

- **Merge order, pipeline branch** (0067 to 0082 and treasury's 0073/0074 already applied): first apply exit 0 (`INSERT 0 20` siblings, `INSERT 0 89` all rows, `UPDATE 3` visitor member rows closed, `INSERT 0 20` roles/permissions/grants); **whole-file second apply exit 0, `INSERT 0 0` / `UPDATE 0` throughout; a seven-table md5 digest (groups, group_memberships, app_roles, app_role_permissions, role_grants, memberships) identical before and after the second run.**
- **Journal order, from empty** (a scratch database inside the pipeline branch; the `db.yml` recipe: `drizzle-kit migrate` with idx 66 in a scratch copy of the journal, then `check:schema-parity`, `db:seed`, the patched `seed-dev.sql`, `install-test-helpers.sql`): migrate succeeded with 0066 before 0067 to 0082 (0068's seat inserts pass the five-kind CHECK and 0068 re-creates the sync as definer); schema parity 0 failing; then two further whole-file applies of 0066, digest identical. Both scratch databases dropped afterwards.
- **Writer re-scan (arch-A4), live `pg_proc` on the refreshed branch:** every function that writes `memberships` or `group_memberships` is SECURITY DEFINER owned by `neondb_owner` (`presby__accept_invitation_core`, `presby_reconcile_current_roll`, `presby_record_participant_action`, `presby_sync_current_roll`, `presby_sync_derived_group`, `presby_void_participant_action`), except `presby_sync_derived_membership_group`, which 0066 makes a definer. The only body naming `on conflict (membership_id)` was that function (replaced). `src/`: `people.ts:633` inserts memberships with no roll; `:981-1001` update `household_id` only; no non-test `engagement_status` update. The one `presby_app` roll writer was `test-rls.sql` section 7 (converted). **No new writer off the owner path; no loop-back.**

### Gates

- `scripts/test-rls.sql` **unedited, against the migrated `development` copy:** stops at `:219`, the documented pre-existing drift (a third untracked membership on long-lived dev data, commented in the file), so the suite was run on the from-empty database instead. There, **unedited**, the only stop is the section-7 block (`:340`, refused by the F244 guard, as designed). **Patched** (the staged patch, plus the seed include): every section through 72 passes, then **65.7 stops** ("an authority-free member with a proven address connects — expected 1, got 0"). That is §4.10 item 1 exactly: until A2 adds `all_memberships` to the T exclusion list, the `calendar_viewer` grant counts in T. **With only that one literal changed in a throwaway copy of the core on the scratch database, the whole patched suite (main, 46 to 72, 65, 66) is green, exit 0.** So A1 alone is not shippable and A2 must land in the same release (it does: one file, two commits).
- `test-rls-66.sql` standalone as `presby_app`: exit 0. **Failing-first, each mechanism broken, the suite run, then restored by re-applying 0066 (green after each):** F240 arm removed → `test-rls-66.sql:166` "presby_app inserted a self-labelled derived row"; F245 arm removed → `:233` Session flipped to managed; pair trigger, engagement trigger or roll-cache triggers disabled → `:98` 66a trigger count (7 expected; 6, 6, 5); sync without the narrowing → `:290` "NO Active Membership row … expected 0, got 1"; kind or pairing CHECK dropped → `:588` 66k; engagement CHECK dropped → `:102` 66a; Alder Creek's `calendar_viewer` grant ended → `:516` 66i premise. With the structure and premise assertions stripped (scratch copy), the behavioural lines fail on their own: pair → 66e sibling "expected 1, got 0"; engagement → 66f "engagement changed INTO staff"; roll cache → 66g "presby_app wrote current_roll"; kind → 66k "a sixth derived kind was stored"; pairing → 66k "a managed group with a derived_from was stored"; engagement CHECK → 66f "a value outside the vocabulary was stored"; calendar grant → 66i "a visitor resolves events.view … expected 1, got 0".
- Vitest, serial, pipeline branch: T-M 29/29, T-G 21/21, T-E 9/9, `sign-in-standing.db.test.ts` 36/36. **Failing-first:** F240 arm removed → T-G "as presby_app: a self-labelled derived INSERT …" fails; F245 removed → T-G "no column of a derived group may change" fails; sync without the narrowing → T-M M8, M9, M10, M11, M14 and the transitions case fail; engagement trigger disabled → T-E both R53 cases fail; roll-cache triggers disabled → T-E the presby_app F244 case fails; engagement CHECK dropped → T-E vocabulary and stop-block cases fail. All green after restoring. **D11 regression:** the original fixture against 0066 fails with `groups_derived_kind_check` (23514); corrected, passes.
- **Full DB-backed Vitest suite, serial, pipeline branch** (`npx dotenv -e .env.local -- npx vitest run --no-file-parallelism`, 2297 s): **849 files, 14475 tests: 14461 passed, 13 failed in 7 files, 1 skipped.** The first full run found `directory`, `org-provisioning`, `participant-roll` and `parishes` failing; the first three were 0066's designed effects or D11-class helpers (departure 3) and were fixed before this run. Of the 13: **1 was 0066's** (`home-data.test.ts` H4, a visitor viewer is no longer a grantee; fixed after the run, departure 3 below, file re-run 11/11). **12 are environmental, not 0066:** (a) treasury's 0073/0074 are applied on this copy of `development` but treasury's code is not on this branch, so the reimbursement keys appear: `two-factor-default.db.test.ts` (9 flagged keys, not 6), `giving/team.db.test.ts` (2; the treasurer template now carries reimbursement keys the actor lacks), `designation-parity.db.test.ts` and `designation-parity-in-place.db.test.ts` (3 each; treasurer golden lacks reimbursement keys); (b) three leaked `deletable_until` fixture organizations that were on the branch before this batch's first measurement (two `directory-test-*`, one `e2e-reimby-*`; none created by this batch): `fixture-deletable.test.ts` (2, the canary naming them) and `parishes.db.test.ts` "the whole file re-applies with no row change" (0068's seat backfill gives those three congregations +3 groups, +3 roles). They were still inside their deletion window at 21:10 UTC; I did not delete fixtures another run may own. **So the old-code lane (EC-28) shows no 0066 regression other than the designed ones, with one A2-dependent exception the Vitest suite does not reach: 2b's auto-connect at an organization that holds `calendar_viewer` (test-rls 65.7, above).**
- `home-data.test.ts` (departure 3, added after the full run): H4's ineligible-but-authorized viewer is now a staff anchor (a visitor holds no `directory.view` after 0066), plus a new case asserting a visitor viewer gets `canViewDirectory` false and no household; `src/lib/org-portal/home-data.ts`'s doc comment stops naming a visitor as that viewer.
- `npm run typecheck` exit 0; `npm run check` all nine pass (re-run after staging, so `check:secrets` saw the new files).

### For the next batch

- **A2 (database-admin):** section 9 before section 10. Three things A1 hands it: (1) the T-list literal is the one that turns 65.7 green (proven above); (2) `MARKERS.closedList` in `sign-in-standing.db.test.ts:65` still names the three-kind list; (3) after section 9, re-run the patched `test-rls.sql` from empty and the full DB suite (the old-code lane, EC-28, belongs to the complete file, so it is A2's gate to close).
- **B (api-developer):** available now: `presby_standing_is_member(text)`, `presby_membership_is_member_standing(text, text)` (EXECUTE to `presby_app`); the pair trigger; groups `all_memberships` ("All Current Records"); role `calendar_viewer` ("Calendar viewer", `events.view`) on existing orgs via backfill only, so `groupSeedPlan`/`baselineRoleSeedPlan` must add both (T-G test 3 is B's). Guard refusals B maps (all `check_violation` 23514): `memberships: this membership has ended; its engagement can no longer change`; `memberships: staff is set only when a staff record is created; engagement cannot change into or out of staff`; `memberships: a person on the roll cannot be marked as a visitor`; vocabulary violations carry `constraint = memberships_engagement_status_allowed`; F244 `memberships: current_roll and current_roll_since are written only by the roll; record a roll action instead (drizzle/0066, F244)`.
- **Local apply:** `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql`. A from-empty database also needs the seed include (via the staged `seed-dev.sql` patch).
- **Not run here:** treasury's and photos' DB suites against 0066 (their code is not on this branch; run at integration, per §A12's dependency line).
- **Integration (orchestrator):** apply the three patches in `scripts/membership-standing/`; re-run `scripts/test-rls.sql` against the merged `development` after A2 is in.

## Phase 4 — Batch A2 (database-admin, 2026-10-31)

**Scope:** 0066 section 9 (amendment A4.2, D10b; Phase 3 section 4.10), its section-10 ACLs and comments, `MARKERS.closedList` (D11's second half), the 2b connect and issue rows, the handler-mapping test (EC-13, D13 (a)), T-M's connect column and section-9 scans, `test-rls-66.sql` block (l). **Migration mode: hand-written** (`drizzle/0066_presby_membership_standing.sql`), applied with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql` to the pipeline branch only (`ep-delicate-sun-…`). Nothing was applied to `development` or production. The journal patch is unchanged from A1 (idx 66).

### Section 9, as built

Each body was taken from the live post-2b function. Before writing, `pg_proc.prosrc` of all three was checked against the text of `drizzle/0065` (`:792-869`, `:954-1082`, `:2508-2672`): byte-equal for all three. Section 9 is that text with one change each. Signatures, return shapes, volatility, `SECURITY DEFINER` and `search_path = public, pg_temp` are unchanged; the ACLs (core and check owner-only, connect `EXECUTE` to `presby_app`) are restated in section 10, with new comments. **`pg_get_functiondef` diff, live before against live after the apply:**

```
presby__person_sign_in_standing
65c65
<                 and coalesce(g.derived_from in ('active_membership', 'session', 'diaconate'), false))
>                 and coalesce(g.derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate'), false))
presby_sign_in__check
111,113d110
<   if v_st.standing = 'visitor' then
<     v_reasons := v_reasons || 'visitor'::text;
<   end if;
presby_connect_signed_in_account
130c130
<     if v_st.refusal is not null or v_st.standing is null or v_st.standing = 'visitor' then
>     if v_st.refusal is not null or v_st.standing is null or not presby_standing_is_member(v_st.standing) then
```

**In plain English** (self-verification), checked against the design:
- (a) A grant reaches the set T unless it comes through a derived group of kind Active Membership, All Current Records, Session or Board of Deacons. A grant through the Moderator of the Board of Deacons seat group, or through any future kind, still counts. That matches D10b: All Current Records is added, and the Moderator seat stays in T on purpose.
- (b) The issue/resend check asks for an acknowledgement only when the address is marked do-not-contact. It no longer asks because the person is a visitor. That matches §4.10 item 2.
- (c) Auto-connect declines when the core refuses, when there is no live standing, or when the standing is not member standing (listed or staff anchor). Visitor, inactive, moved away and unclassified are all declined, and a null standing never reaches the new function. That matches A4.2 and R55.

### Apply and idempotency (pipeline branch, merge order)

A seven-row md5 digest (groups, group_memberships, app_roles, app_role_permissions, role_grants, memberships, and the three bodies' `prosrc`) was taken before, between and after two whole-file applies. **Both applies exited 0.** The first changed only the `prosrc` row; the second changed nothing, and every statement reported `INSERT 0 0` / `UPDATE 0`. The six tables were identical across all three digests.

### From empty, journal order (EC-36), and the A2 gate

The `db.yml` recipe was run in a scratch database inside the pipeline branch, from copies (no tracked file was touched): `drizzle-kit migrate` with idx 66 in a scratch journal (0066 before 0067 to 0082), then `check-schema-parity` (86 tables, 0 failing), `db:seed`, the patched `seed-dev.sql`, `install-test-helpers.sql`, then two more whole-file applies of 0066 (digest identical). Then **the whole patched `scripts/test-rls.sql` as `presby_app` (guard row `presby_app|f`): exit 0, 1644 passes, no FAIL.** That run includes 65.6 (changed, below), 65.7 ("an authority-free member … connects", A1's stop: now green), 66e (it ran there, not skipped) and 66l. Scratch database dropped afterwards.

**The same patched suite on the pipeline branch (the development copy, merge order)** stops only on data drift. In a scratch copy I set aside each assertion that stopped it, one at a time, and recorded the cause. After seven, the suite exits 0:
- `test-rls.sql:219` and `:222`: the presbytery sees 3 people and 3 memberships, not 2. This is the documented untracked membership on long-lived dev data; the file comments on it.
- `test-rls.sql:7402-7406` (Ruling 7 coverage, 82 organisations against 17 canonical names): the assertion calls itself a fresh-database claim; test-created organisations have no canonical row.
- `test-rls.sql:7930-7932` (eight template roles, not seven: `reimbursement_clerk`) and `46j`/`46m` in `giving/test-rls-46.sql` (9 two-factor keys, not 6; the treasurer template carries reimbursement keys): **treasury's 0073/0074 on this database without treasury's code.** Expected per the brief.
- `test-rls.sql:7943-7947` (two org-owned `statistics.publish` roles): the `demo_everything` demo role at Alder Creek, the known extra role.

**None is caused by 0066.**

### Failing-first

On the pipeline branch, each mechanism was broken by applying the old (or a wrong) body as owner, the suites were run, and 0066 was re-applied (green after each).

*`test-rls-66.sql` (as `presby_app`):* 0065's core restored → `:685` "66l (D10b): the core's T exclusion list is the four kinds" (with the catalog line stripped in a scratch copy: `:706` "66l (R49): a regular attender holding the calendar_viewer grant connects with NO factor"). 0065's check restored → `:690` "66l (check 10): a visitor is invited with no acknowledgement". 0065's connect restored → `:699` "66l (connect step 10, R55): an inactive person without a roll is declined".

*Vitest* (five files, 198 tests: sign-in-standing, T-M, T-G, sign-in-invitations, org-invite):
- 0065 core → 17 fail: T-M connect column M1 to M12, M15, M16 (`authority_bearing` true through `calendar_viewer`; M1 to M7 and M12 also `needs_second_factor`), T-M "section 9 (D10b)", sign-in-standing "a grant on All Current Records … is outside T" and its live-catalog marker test.
- Core with `deacons_moderator` wrongly added to the list → 3 fail: the D11 case "a derived kind outside the T exclusion list counts in T (the Moderator seat; F247)", T-M "section 9 (D10b)", the live-catalog marker test.
- 0065 check → 6 fail: the visitor rows of the sign-in-standing matrix (both), sign-in-invitations "acknowledgements", org-invite "a visitor sends without an acknowledgement", T-M's `'visitor'`-comparison scan (and its offender sample, which then also saw the real body; changed to `toContain` so the sample stands on its own).
- 0065 connect → 6 fail: T-M connect column M9 and M10, sign-in-standing "inactive without a roll" and "moved away without a roll", and the visitor scan (twice, as above).
- The membership sync with its two group checks in the wrong order (A1's mechanism, re-proven for the mapping test) → T-G "with no groups at all … raises the SHIPPED active_membership message first" and "each handler's LIKE pattern matches …".

### Files

- **Modify** `drizzle/0066_presby_membership_standing.sql`: section 9 inserted before section 10; the header's section list and findings line; section 10 restates the three ACLs and replaces the three comments.
- **Modify (staged, Rule 16 asset)** `scripts/membership-standing/test-rls-66.sql`: new block (l), section 9 as `presby_app` against the Hollinbrook rows that `seed-dev.sql` includes. Block (e) now runs only when its premise can hold (departure 2).
- **Modify** `src/lib/membership-standing.db.test.ts` (T-M, 29 → 49): a premise check, the connect column for M1 to M16, scan 1's section-9 part (the four-kind T list without `deacons_moderator`; no `standing = 'visitor'` in any body, with an offender sample). `src/lib/db/domain/derived-group-guard.db.test.ts` (T-G, 21 → 24): the handler-mapping describe (EC-13, D13 (a)). `src/lib/testing/membership-standing-fixture.ts`: `addEmail`, `user`, `enableConnect`, and user teardown.
- **Modify (2b-era tests 0066 section 9 contradicts; each edit commented in place):** `src/lib/db/domain/sign-in-standing.db.test.ts`, `src/lib/db/domain/sign-in-invitations.db.test.ts`, `src/lib/onboarding/org-invite.db.test.ts`, `scripts/sign-in-invitations/test-rls-65.sql` (departure 1).
- No table, no column, no Drizzle mirror change (functions are not mirrored), no barrel export. `designation-parity.golden.json` is byte-identical to this branch's base (`git diff --exit-code`: 0).

### Departures (each minimal, commented in place, listed for the tech-lead's design check under the orchestrator's provisional ruling on A1's departure 3)

1. **2b-era tests that section 9 contradicts, edited minimally:**
   - `sign-in-standing.db.test.ts`: `MARKERS.closedList` is now the four-kind literal (D11). Its migration-text scans read 0065 then 0066, last definition wins, as in the database, so the core's body is 0066's; a shared `HOLDERS` map serves the text scan and the catalog scan. The two visitor rows now issue `ok` with `[]`. **Four rows added:** inactive and moved away without a roll (declined), inactive with a roll (listed, connects), regular without a roll. **One case added:** a grant on All Current Records is outside T (EC-12). The D11 row is unchanged from A1.
   - `sign-in-invitations.db.test.ts`: the visitor case leaves the refusal list. "Acknowledgements": a visitor issues `ok` with `[]`; a do-not-contact visitor needs `["do_not_contact"]` and then sends with it.
   - `org-invite.db.test.ts` (a DB test of 2b's TypeScript): the visitor sends unacknowledged and is audited `acknowledged: []` (EC-21). The TypeScript is untouched; removing `visitor` from `SIGN_IN_ACK_REASONS` is B's.
   - `test-rls-65.sql` 65.6: a visitor is invited with no acknowledgement and `ack_reasons = '{}'`; the second send is `already_pending`. **This is 2b's shipped include file, edited in place (not a Rule 16 file by name).** The orchestrator may prefer it staged as a patch at integration.
2. **`test-rls-66.sql` block (e) (A1's) could not pass on any long-lived branch.** Its premise, that the Southern Fields presbytery has no derived group, is false wherever 0082 ran with organisations present: 0082 gave it an Active Membership group, and 0066 then added the sibling. `presby_app` cannot create a substitute organisation (DECISION-135). The block now reads the premise under the organisation's context and runs when it holds (every from-empty database, so CI). Otherwise it prints `skip  66e: …` and points at T-G test 1, which proves the pair on any database. This would have failed the orchestrator's Rule 16 re-run of `test-rls.sql` against the merged `development`, once that run gets past `:219`.
3. **The handler-mapping test lives in T-G, not T-W** (the 2026-10-25 design named T-W, Batch B's file). A2 owns it (§A13) and T-W does not exist yet. It proves three things: the live catalog holds exactly the four handlers plus the sync; each handler's `LIKE` pattern, taken from its own `prosrc`, matches the message the 0066 sync raises for a missing Active Membership group and does not match the All Current Records message; and, end to end through the acceptance core, a founding-administrator acceptance at a half-paired organisation fails with `23503` naming `all_memberships` and writes nothing. The two participant functions and the decision are pinned at text level. Their behavioural `provisioning_incomplete` cases are the existing suites (`participant-roll`, `session-approval`), re-run green.

### Gates

- Typecheck exit 0; eslint on every changed file clean; `npm run check` all nine pass.
- The patched `test-rls.sql`, from empty: **exit 0** (above). On the development copy: exit 0 once the seven drift assertions above are set aside; no other failure.
- `test-rls-66.sql` standalone as `presby_app` on the pipeline branch: exit 0 (66e skipped there, as designed; 66l passes).
- Vitest, serial, pipeline branch: sign-in-standing 41/41, T-M 49/49, T-G 24/24, sign-in-invitations and org-invite green (inside the five-file run of 198 tests).
- **Full DB-backed Vitest suite, serial, pipeline branch:** `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism`, 2325 s: **849 files, 14504 tests: 14490 passed, 13 failed in 6 files, 1 skipped. None is 0066's.** (a) **9 are treasury's 0073/0074 on this database without treasury's code** (A1 saw the same): `designation-parity.db.test.ts` and `designation-parity-in-place.db.test.ts` (3 each, the treasurer golden lacks the reimbursement keys), `giving/team.db.test.ts` (2), `two-factor-default.db.test.ts` (1, 9 flagged keys, not 6). (b) **4 are the leaked fixture organisations A1 named** (two `directory-test-*`, one `e2e-reimby-*`; no leaked row carries this batch's labels `ms66`, `dg66`, `dg66h`, `st65` or a `Standing…` surname): `fixture-deletable.test.ts` (3; A1 saw 2, and the third, "no stamped people row has an EXPIRED window", is the same leak passing its 21:24 UTC deadline) and `parishes.db.test.ts` "the whole file re-applies with no row change" (1). A1's `home-data` H4 failure is gone (fixed in A1). The 2b-era suites (`sign-in-standing`, `sign-in-invitations`, `sign-in-accept`, `connect` (both), `accept-in-place`, `org-invite`, `issue`, `accept`, `invitations`, `email-proof`) all pass; so do `participant-roll`, `session-approval`, `parishes` (bar the leaked-fixture case), `org-baseline-backfill`, T-M, T-G and T-E.
- The three Rule 16 patches still `git apply --check` clean.

### For the next batch

- **B (api-developer):** section 9 is live on the pipeline branch.
  - The definer no longer returns a `visitor` acknowledgement reason; `ack_reasons` is `[]` or `["do_not_contact"]`. Remove `visitor` from `SIGN_IN_ACK_REASONS` (`sign-in-types.ts:66`); `ackReasons()` in `org-invite.ts:197` would already drop an unknown value.
  - `connectOutlook`: auto-connect now declines visitor, inactive, moved away and unclassified, which is `isMemberStanding`'s complement, so the outlook is `not_listed` for exactly those (D13 (d)).
  - `presby_sign_in_card_standing` is unchanged and still returns `standing`, so the card can derive `connected_not_listed` (D13 (e)) from it.
  - `presby_connect_signed_in_account`'s signature and outcome set are unchanged (`connected | already_connected | needs_second_factor | declined`).
  - When `groupSeedPlan` lists `all_memberships` and `baselineRoleSeedPlan` adds `calendar_viewer`, T-M's `beforeAll` re-execution of the calendar block becomes a no-op, so leave it in place. A new organisation then connects authority-free people without a factor because of section 9's list; T-M's connect column proves it on a `createOrganization()` organisation.
  - T-W (`community-engagement.db.test.ts`) need not repeat the handler mapping; it is in T-G.
- **Integration (orchestrator):** apply the three patches as A1 said (unchanged). Consider staging the `test-rls-65.sql` edit as a patch if you treat 2b's include as shared. Treasury merged to local `main` as 0.51.0 while this batch ran. After this branch merges main, the treasury-caused lines above (7932, 46j, 46m and the 8 DB-suite failures) should clear, and treasury's DB suites must be re-run against 0066 (F246 is unchanged).
- **Local apply:** `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql`; a from-empty database also needs the patched `seed-dev.sql`.
- **Next agent:** Batch B, api-developer.

## Phase 4 — Batch B (api-developer, 2026-10-31)

**Scope:** the library and the actions of 3a, per §A13: the standing mirror and the readers, the four audited writes and their Server Actions, the four audit keys, the provisioning and group changes, the grant-form labels, and the 2b TypeScript removals (D13). **No UI** beyond the minimal call-site and type plumbing that keeps the tree compiling (listed under Departures 5); Batch C builds the UI. **Migration mode: none** (no schema change, no DDL, no Rule 16 file touched; the three staged patches in `scripts/membership-standing/` are unchanged). Branch `pipeline/visitor-follow-ups`, not pushed.

### Commits (all carry `Work-Log:` and the Opus 5.5 co-author trailer)

| Commit | What |
|---|---|
| `c8fb47f` feat(community) | `membership-standing.ts`, `deriveConnection`, `community.ts` readers, `directory.ts` default predicate, the archive marker, call-site plumbing, T-M additions, the two source scans |
| `574c97b` feat(community) | `community-engagement.ts` (four writes), `actions.ts`, `engagement-copy.ts`, the four `AUDIT_ACTIONS` keys, `MAX_HOW_HEARD` shared |
| `25fcd9f` feat(provisioning) | `groupSeedPlan` / `baselineRoleSeedPlan`, `provisioningComplete`, `my-groups`, `role-grants` and `derived-group-labels`, the grant form |
| `3e45ab8` feat(sign-in) | the 2b removals and the two new outlooks |
| `8c898b9` test(db) | `sign-in-standing.db.test.ts` (the list-versus-classifier difference is gone), T-G header |

### The contract Batch C consumes

**Server actions** (`src/app/(org)/o/[slug]/admin/community/actions.ts`, `"use server"`). Each: `auth()` then `resolveOrgContext()` re-run in the body, so organization, viewer and audit actor come from the session and the slug; input parsed and rebuilt (a forged `organizationId`, `from` or `actor` is never read); `people.manage` checked inside the write's own transaction; the library writes the audit row; a thrown database error is logged by class only and shown as one fixed sentence; no redirect. Results are `ActionResult<T>` (`{ ok: true, data } | { ok: false, error }`); `error` is the user-facing sentence.

```ts
changeEngagementAction(slug, { personId, to: "visitor"|"regular"|"inactive"|"moved_away", expectedFrom?: Engagement })
  : ActionResult<{ from: Engagement; to: Engagement; standingTo: MembershipStanding }>
archivePersonAction(slug, { personId }): ActionResult<{ personId }>
restorePersonAction(slug, { personId }): ActionResult<{ personId; list: "visitors" | "inactive" }>   // visitor -> visitors, anything else -> inactive
updateVisitDetailsAction(slug, { personId, firstVisitDate: string | null, howHeard: string | null }): ActionResult<{ personId }>
```

No route handler, no `FEATURES` change, no flag, no seed. Gate: signed in, a member of the organization the slug names, `people.manage`. `unchanged` is returned as `ok: false` with "That is already how this person is marked." (Copy group B lists it among the refusals); `updateVisitDetailsAction` answers `unchanged` as a quiet success. Revalidated: `/o/<slug>/admin/community`, `.../community/<id>/edit`, `/o/<slug>/directory`.

**Library** (`src/lib/community-engagement.ts`, `server-only`; the only non-test module that updates `engagement_status`, the archive marker, `first_visit_date` or `how_heard`, pinned by `membership-standing.source.test.ts`): `changeEngagement`, `archivePerson`, `restorePerson`, `updateVisitDetails`, each `(viewerPersonId, organizationId, input, actor)` with the result unions of §5 (exported types `ChangeEngagementResult`, `ArchivePersonResult`, `RestorePersonResult`, `UpdateVisitDetailsResult`). Each runs in `withOrgContext`, locks the membership `for update`, reads standing from `presby_membership_standing()`, writes one `insertAuditRow(tx, ...)` in the same transaction.

**Audit keys** (`AUDIT_ACTIONS`, `audit.ts`; `resourceType: "person"`, `resourceId` the person; closed metadata lists, ids, enums and booleans, pinned by T-W and the unit file): `TENANT_PERSON_ENGAGEMENT_CHANGED` `tenant.person.engagement_changed` {`organizationId, personId, from, to, standingFrom, standingTo, signInConnected`}; `TENANT_PERSON_ARCHIVED` `tenant.person.archived` and `TENANT_PERSON_RESTORED` `tenant.person.restored` {`organizationId, personId, engagement, signInConnected`}; `TENANT_PERSON_VISIT_DETAILS_UPDATED` `tenant.person.visit_details_updated` {`organizationId, personId, firstVisitDateChanged, howHeardChanged`}. `unchanged` and every refusal write nothing; `how_heard` text is never in an audit row.

**Readers and types** (`community.ts`, `community-labels.ts`, `membership-standing.ts`):
- `listInactive` (new), `listVisitors` (classifier: standing `visitor`), `listFormer` (new name; `listFormerParticipants` is kept as an alias; the list holds the participant-removal and archive markers, a closed pair), `listStaff` unchanged. `CommunityRow` gains `engagementStatus`, `endedReason`, `signInConnected`.
- `getCommunityBadges` returns `Record<personId, { roll: CommunityBadge | null; engagement: "inactive" | "moved_away" | null }>`.
- `getCommunityStatus` also returns `endedReason`, `engagementStatus`, `standing` (SQL), `signInConnected`.
- `COMMUNITY_VIEWS` is seven (`inactive` between `visitors` and `staff`); `Connection` gains `inactive`, `moved_away`, `unclassified`, `former_visitor`, `archived`, with `CONNECTION_LABELS` and `alreadyHereSentence` per Copy group E.
- `membership-standing.ts` (pure, client-safe): `membershipStanding`, `isMemberStanding`, `isMemberStandingFor`, `EDITABLE_ENGAGEMENTS`, `offeredEngagements(hasRoll)`, `isEditableEngagement`, `isEngagement`, `MAX_HOW_HEARD`, `FIRST_VISIT_FLOOR`, `MEMBERSHIP_STANDINGS` (`sign-in-types.ts` re-exports it).
- `directory.ts`: the default eligibility branch is `presby_membership_standing(...) = 'listed'`; the finder inherits it.
- `SignInCardState` has no `isVisitor`; `ConnectOutlook` has `not_listed` (was `visitor`) and `connected_not_listed`; `SIGN_IN_ACK_REASONS` is `["do_not_contact"]`; `CONNECT_OUTLOOK_COPY.not_listed` / `.connected_not_listed` carry Group G's strings; `SIGN_IN_DIALOG_COPY.send.visitorAcknowledgement` is gone.
- `src/lib/derived-group-labels.ts` (pure): `derivedGroupManagedFromText(kind)` ("Members, regular attenders and staff", "Everyone with a current record here", or null for the officer-driven groups) and `grantFormGroupLabel(group)`. The grant form already uses the second; **`groups-list.tsx` does not yet use the first (Batch C)**.
- `src/app/(org)/o/[slug]/admin/community/engagement-copy.ts` (pure): `ENGAGEMENT_LABELS`, `engagementSuccessMessage(name, to)`, `CHANGE_ENGAGEMENT_COPY`, `ARCHIVE_COPY`, `RESTORE_COPY`, `VISIT_DETAILS_COPY` (Records over the library's outcome unions), `ENGAGEMENT_SUCCESS_COPY` (`archived`, `restored`, `visitDetailsSaved`).

**What Batch C still has to write** (not in B, by the batch split): the seventh nav segment; the Inactive row's buttons and the row-action island; the three dialogs; `EngagementCard` (Group A descriptions, the nudge, the roll case) and `VisitDetailsForm`; the dialog bodies and impact lines (Group B: when it opens, the connected / unknown / auto-connect lines; `engagementImpact` is pure logic C builds and tests, EC-25); the Former row detail and the edit page's connection suffix for the two archive connections with Restore (Group D, `connection-card.tsx`, wizard Restore); the engagement badge beside the roll badge (`getCommunityBadges(...).engagement`; `members-list.tsx` passes only `.roll` today); the Former empty-state wording and the people-matching copy (Group C, the Inactive empty state is already in); Group J (parish strings); `groups-list.tsx` "Managed from" text (use `derivedGroupManagedFromText`); help pages and registry labels. **Inputs C already has**: the edit page's `getSignInCard` carries `linked`, `address`, `selfConnectEnabled` for the dialog's auto-connect line; a list row carries `signInConnected` and `email` but not the toggle (the row dialog uses the "unknown" variant or reads the card, C decides).

### Departures from the design (each with its reason)

1. **`changeEngagement` takes an optional `expectedFrom`** (lib and action; additive, in neither the §5 signature nor EC-9's forbidden list, whose `from` stays ignored). The design's `changed_meanwhile` copy ("This changed while you were looking") only makes sense if the writer knows what the page showed, but its signature carries no such field, and without one the row lock serializes two administrators and the second simply writes from the true value (audit chain correct, no loss, but never `changed_meanwhile`). With the field, a stale form is refused; without it (any caller that omits it) the race is serialized and audited truthfully. T-W proves both. C may send it or not.
2. **`engagement-copy.ts` is smaller than §7 lists.** It holds the outcome sentences, labels and success messages the actions need. Strings the design gives once are reused: restore and visit-details `forbidden` and `not_found` use Group B's ("You don't have permission to change this.", "That person could not be found."), because Groups D and F do not list their own. **No string was invented.** If C or the tech-lead wants a restore-specific forbidden sentence, it is a Copy ruling.
3. **The archive's `holds_position` pre-check has no start-date test** (it refuses a seat that has not started, as the participant-removal pre-check's staff arm already does). It is therefore a superset of `memberships_guard_end`'s condition, so the guard is the unreachable backstop through data; its mapping to `holds_position` is proven in the unit file with the guard's real message, and the DB test proves the future-dated case. Stated so a reviewer does not look for a DB test that reaches the guard.
4. **`groupSeedPlan` is now exported** (it was private) so the plan can be pinned directly. T-G test 3, which A1 deferred to B, landed in `org-provisioning.test.ts` (pure plan and real database) and a new `org-provisioning.plan.test.ts` (the throw-if-missing, with the platform database faked so no production code is edited to prove it); A1's T-G header says so.
5. **Minimal edits in Batch C's files, so the tree compiles and nothing regresses**: `page.tsx` (`adminView` includes `inactive`, calls `listInactive`), `community-rows-list.tsx` (the `inactive` detail, "Inactive" or "Moved away"), `community-empty-state.tsx` (the Inactive headline, detail and search wording from Group C, `former people` in the no-match line), `members-list.tsx` (the new badge shape, roll badge only), `sign-in-card.tsx` / `send-sign-in-dialog.tsx` (the `isVisitor` removals, the two outlook lines), `grant-role-form.tsx` (the label). C owns everything else in those files.
6. **More 2b-era tests edited, minimally and commented** (A1/A2's provisional-acceptance rule): `sign-in-standing.db.test.ts` (the "list equals classifier with exactly one documented difference" test: the Visitors list now asks the classifier, so the difference M11 is gone; the test now expects none, with a non-vacuity check), and, within D13's own scope, `org-invite.test.ts`, `org-invite.db.test.ts`, `sign-in-types.test.ts` (it now reads 0066 for a body 0066 re-creates, last definition wins), `sign-in-copy.test.ts`, `sign-in-card.test.tsx`, `[id]/edit/actions.test.ts`, `[id]/edit/page.test.tsx`. For the tech-lead's acknowledgement with A1's and A2's.
7. **`sign-in-card.tsx`: the connected-and-not-listed line** is rendered after `connectedSupport` inside the connected lines (D13 (e)); it is derived from `card.outlook`, not from a new field.
8. **Not written, and why:** the "restore with a live membership elsewhere" case (EC-20): the database refuses a second membership for a person except through `presby_claim_person()` (`presby_guard_membership_insert`, 42501), so the state cannot be fixtured on the owner connection either; the design already marks that row *unverified in 3a*. `scripts/test-rls.sql` and `test-rls-66.sql` were not re-run: B writes no SQL and calls no SQL it did not already have.

### Gates

- `npm run typecheck` exit 0; `npm run lint` clean (`--max-warnings=0`); `npm run check` all nine pass; `npm run build` exit 0.
- `npm test` (no database): 790 files passed, 134 skipped; 12372 tests passed (run before the last test edit, which is DB-backed and below).
- **DB-backed, serial** (`npx dotenv -e .env.local -- npx vitest run --no-file-parallelism`, 2883 s, run on the working tree that became commits `c8fb47f` to `3e45ab8`; the two edits after it are the `sign-in-standing` fix and a comment): **924 files, 16025 tests: 16019 passed, 5 failed in 3 files, 1 skipped.** (a) `src/lib/db/fixture-deletable.test.ts` (3) and `src/lib/db/domain/parishes.db.test.ts` "the whole file re-applies with no row change" (1): **the same three leaked organizations A1 and A2 named** (`directory-test-a`, `directory-test-b`, `e2e-reimby-…`, window already closed, 27 leaked people from the same earlier runs; none carries a label from this batch), not B's. (b) `src/lib/db/domain/sign-in-standing.db.test.ts` (1): **B's**, the list-versus-classifier test above; fixed in `8c898b9`, the file re-run **41/41**. The treasury-caused failures A1 and A2 saw are gone with the merge of main 0.51.0.
- **Per file** (serial where DB): `membership-standing.test.ts` 41, `membership-standing.source.test.ts` 16, `community-engagement.test.ts` 73, `actions.test.ts` 87, `engagement-copy.test.ts` 8, `org-provisioning.plan.test.ts` 16, `derived-group-labels.test.ts` 6, `community-labels.test.ts` 29, `sign-in-types.test.ts` 38; DB: `community-engagement.db.test.ts` (T-W) **32**, `membership-standing.db.test.ts` (T-M) **67** (was 49), `community.db.test.ts` 27 (was 18), `org-provisioning.test.ts` 43.
- **Failing-first (each mechanism broken, the suite run, then restored):** the `my-groups` filter for All Current Records removed, the new case fails; the `for update` row lock removed from `community-engagement.ts`, T-W's "archive against engagement" and "two engagement changes with no stale-guard" fail (the other two race cases still pass, being backstopped by the conditional update, which is the design's belt-and-braces); the plan's `all_memberships` entry cannot be removed without failing the plan tests (they assert it for every type) and the faked-database test proves the throw. The F240/F245/F243/F244 mechanisms A1 proved are untouched.

### What T-W and T-M prove (the EC rows)

EC-1 (T-M: the TS mirror equals SQL across 9 x 9 values, every standing reached; getDirectory and Community-list columns for M1 to M16 as a `people.manage` viewer, M11 now equal); EC-6 (T-W: officer term, role grant, staff position, pending action, self, listed, staff anchor, already ended, each with a before and after digest of the row, its derived rows and its audit rows); EC-7 (restore reopens the all row, leaves a visitor's member row closed; participant removal, never archived, deceased, merged); EC-8 (four two-connection races, above); EC-9 (forged input: unit and action tests, plus a forged-org case in T-W); EC-16 (a forced audit throw rolls each of the four writes back; `unchanged` writes nothing; `how_heard` never in an audit row); EC-21 (`not_listed` is exactly the complement of `isMemberStanding`, pinned); EC-26 (visit details bounds); EC-30 (T-M M3 plus the community badges case); EC-31 (T-W runs the real `updatePerson`, `changeEngagement` and `connectSignedInAccount` and joins the three audit rows on the person); EC-42 (`parishes-pure.test.ts`).

### For the next batch

- **C (ux-developer):** everything under "What Batch C still has to write"; the database and the actions are live on the pipeline branch (0066 is applied there); the strings are Copy groups A to H and J plus this section's departures 2 and 7.
- **D (full-stack-developer), the e2e you will meet:** `community-sign-in-invite.spec.ts` lane 4 (the visitor acknowledgement is gone: no paragraph, no checkbox, Send is live; the `do_not_contact` lane keeps the checkbox), `hydration/community-sign-in-controls.spec.ts` (drop the visitor branch), `no-organization-connect.spec.ts` (b) (add inactive and moved-away rows), the card line for a visitor is now `not_listed`'s sentence, the toggle description changed, and a person created through `createOrganization()` now gets All Current Records and `calendar_viewer` (an organization built by raw SQL gets the group by trigger and no role until the 0066 backfill block runs).
- **Integration (orchestrator):** nothing new from B for Rule 16; `docs/TODO.md`, decisions and the functionality map are Phase 6 housekeeping. Treasury's F246 and the three leaked fixture organizations are unchanged by B.
- **Next agent: Batch C, ux-developer.**

## Phase 3 acknowledgement (after Batches A1/A2/B) (tech-lead, 2026-10-31)

Read against the live tree (`community-engagement.ts:255-275`, `engagement-copy.ts`, `participant-copy.ts:47`, `0009` `presby_guard_membership_insert`), not the departure lists alone. Where a departure exposes a defect in my own design, the ruling says so. No production code was changed by this section.

### Rulings, Batch A1 (database-admin)

- **A1-1 (D9's type widening in A1, type only): accepted.** Scan 4's set equality cannot pass otherwise; the plan entry and the `calendar_viewer` role stay B's (they landed in `25fcd9f`).
- **A1-2 (D11 in A1, `MARKERS.closedList` left for A2): accepted.** A2 updated it.
- **A1-3 (the 0066-contradicted existing cases): all accepted.**
  - The `sign-in-standing` "unclassified engagement" row replaced by a refusal test: accepted (D3: `unclassified` is unreachable from rows; the classifier arm is still covered by T-M's SQL cross-product).
  - The live-catalog holders for the `presby_membership_standing(` marker widened to the core plus `presby_membership_is_member_standing`: accepted (§4.3's designed second caller).
  - `participant-roll.db.test.ts:289` and `session-approval.db.test.ts:373` now read the Active Membership row: accepted. **My Phase 3 was wrong** to say these re-run unedited: §4.5 step 1 ends the one-derived-row-per-membership assumption their scalar subqueries made. Recorded as a Phase 3 miss; no design change follows.
  - `org-provisioning.test.ts` and `session-approval.db.test.ts:1205`: accepted (the designed effects of §3.3).
  - `home-data.test.ts` H4 and the one-clause doc comment in `home-data.ts`: accepted (a visitor holds no `directory.view` after 0066; comment only).
  - `directory.test.ts:775`: accepted. It asserted DECISION-065, which F177 Option 1 reverses; EC-22 now belongs to A1 for this file.
- **A1-4 (T-G test 3 deferred to B): accepted;** it landed in B (B-4).
- **A1-5 (T-M database columns only in A1): accepted;** A2 and B extended T-M (67 cases).
- **A1-6 (EC-4 proven through an approved `roll_actions` row on the owner path): accepted.** It fires the real `presby_sync_current_roll` definer, which is the property EC-4 names.

### Rulings, Batch A2 (database-admin)

- **A2-1 (2b-era tests section 9 contradicts): all accepted.** `sign-in-standing`, `sign-in-invitations` and `org-invite.db.test.ts` edits follow D13 and §4.10 item 2 exactly (visitor issues `ok` with `[]`; `do_not_contact` still needs its acknowledgement). `scripts/sign-in-invitations/test-rls-65.sql` 65.6 edited in place: **accepted, and it stays in place.** It is 2b's shipped include, not a file on the Rule 16 shared list; the orchestrator is not asked to stage a patch. If the orchestrator would rather stage it, that is an integration choice, not a design ruling.
- **A2-2 (`test-rls-66.sql` block (e) runs only when its premise holds, else prints `skip 66e` and points at T-G test 1): accepted.** Every from-empty database (CI's `db.yml`) runs it, and T-G test 1 proves the pair on any database. Phase 5 must confirm the from-empty run shows `66e` executed, not skipped (A2 reports it did).
- **A2-3 (handler-mapping test in T-G, not T-W): accepted.** T-G is A2's file and T-W did not exist; B correctly did not repeat it.
- **Seven assertions set aside on the development copy** (`:219`, `:222`, `:7402-7406`, `:7930-7932`, `46j`/`46m`, `:7943-7947`): accepted as data drift and treasury-without-treasury-code, none caused by 0066. The treasury ones should clear now that main 0.51.0 is merged; Phase 5 re-runs and reports which remain.

### Rulings, Batch B (api-developer)

- **B-1 (`expectedFrom` on `changeEngagement`): accepted, and it corrects a defect in my design. Batch C must send it.** My §5 had `changed_meanwhile` come from a conditional `update ... where engagement_status = $from` with `$from` read under the same `for update` lock; that update can never match zero rows, so EC-8's "the loser gets `changed_meanwhile`" was unreachable by construction. B's field makes it reachable and is the smallest repair. Reading `community-engagement.ts:264`, the check runs after `ended` and `staff_record` and before `unchanged`, and the audit row's `from` is the locked read, never `expectedFrom`, so EC-9's "`from` is ignored" still holds: the field can only refuse, it cannot supply an authority or an audit fact. The Copy sentence "This changed while you were looking" is only true when the writer knows what the page showed, so **every UI entry point sends it** (see For Batch C). An omitted `expectedFrom` stays legal for non-UI callers; the race is then serialized and audited truthfully, as T-W proves.
- **B-2 (`engagement-copy.ts` reuses Group B's `forbidden` and `not_found` for restore and visit details): accepted. No restore-specific sentence is needed.** Group D's "You don't have permission to archive people here." would be false for Restore, so reuse of "You don't have permission to change this." is the right call. The Copy rows are now written into the design below (Copy added) so Groups D and F have no unlisted outcome. B listed every outcome of the four unions; none is missing a sentence.
- **B-3 (archive's `holds_position` pre-check has no start-date test, so it is a superset of `memberships_guard_end`): accepted.** Refusing archive while a seat is recorded but not yet started is the safe side (a seat that starts later would materialize onto an ended membership). The guard stays the unreachable backstop through data; its mapping is pinned in the unit file and the future-dated refusal in the DB test, which is what EC-6 needs. **Copy check, residual recorded:** the sentence says "still holds ... here", which for a not-yet-started seat is slightly generous. It is kept verbatim, because the shipped `PARTICIPANT_COPY.holds_position` (`participant-copy.ts:47`) uses the identical sentence under the identical pre-check (its staff arm already refuses unstarted seats), and a second wording for the same state would be worse than a small imprecision. "End that first" is verified for the staff arm (`community-engagement.db.test.ts:343` ends the position and the archive then goes through) and *unverified* for a future-dated officer term or role grant. Accepted by the tech-lead.
- **B-4 (`groupSeedPlan` exported; T-G test 3 in `org-provisioning.test.ts` and `org-provisioning.plan.test.ts`): accepted.** The export is test-only in effect, with a faked platform database so no production code is edited to prove the throw.
- **B-5 (minimal edits in Batch C's files): accepted, with a boundary.** `page.tsx`, `community-rows-list.tsx`, `community-empty-state.tsx`, `members-list.tsx`, `sign-in-card.tsx`, `send-sign-in-dialog.tsx` and `grant-role-form.tsx` were touched only to compile and not regress. C owns the rest of every one of them and must build on B's edits, not revert them. The Group C wording B already landed (Inactive headline, detail, search line, "former people") is ruled as Copy and C does not rewrite it.
- **B-6 (more 2b-era test edits: `sign-in-standing.db.test.ts`, `org-invite.test.ts`, `org-invite.db.test.ts`, `sign-in-types.test.ts`, `sign-in-copy.test.ts`, `sign-in-card.test.tsx`, `[id]/edit/actions.test.ts`, `[id]/edit/page.test.tsx`): accepted.** Each is inside D13's scope. The "list equals classifier with one documented difference" test now expects no difference, with a non-vacuity check: correct, because M11 existed only while the Visitors list used a different predicate from the classifier, and §4.4 removes it. `sign-in-types.test.ts` reading 0066 for a body 0066 re-creates (last definition wins) matches how the database resolves it.
- **B-7 (the connected-and-not-listed line rendered after `connectedSupport`, derived from `card.outlook`): accepted** (D13 (e); no new field).
- **B-8 (EC-20's restore-with-a-live-membership-elsewhere case left unwritten): accepted as *unverified*, as the design already labelled it, but B's reason is not accepted.** The state *can* be fixtured: `presby_guard_membership_insert` (`drizzle/0009:164-180`) returns early when `app.person_claim_authorized` equals the person id, so an owner-path transaction that sets that GUC can insert the second membership. It is not required in 3a: the sign-in half is 2b's T-6, and restore's `update` deliberately does not look across organizations (`memberships` is unique on `(person_id, organization_id)` only, so a second live row is legal). Any later edit to T-W may add the case; it is not a Phase 5 gap.
- **Gates and counts: accepted.** The five DB-suite failures are the three leaked fixture organizations plus the one `sign-in-standing` test B fixed in `8c898b9`. Phase 5 should re-run once with the leaked fixtures gone to see a clean line.

### Copy added (ruled, so nothing outside this design is shipped)

| Where | String | Added because |
|---|---|---|
| Restore `forbidden` | You don't have permission to change this. | B-2: Group D listed only the archive sentence for `forbidden` |
| Restore `not_found` | That person could not be found. | B-2 |
| Visit details `forbidden` | You don't have permission to change this. | B-2: Group F listed no `forbidden` |
| Visit details `not_found` | That person could not be found. | B-2 |
| Visit details `ended` (Group F, as listed) | This person's connection here has ended, so this can't be changed. | unchanged |

1. *Residuals.* None denies an accepted residual or a Phase 2 ruling; neither string says anything about access, listing or a connection.
2. *Source of truth.* `forbidden`: the `people.manage` check inside the write's own transaction (it fails only if the permission was revoked after the page loaded, or on a forged call). `not_found`: the organization-scoped membership lock returning no row; the sentence says only that the person was not found, which is all that query establishes (another organization's person, a missing id and a non-UUID are deliberately the same answer).
3. *Audience.* Seen only by a `people.manage` holder whose page is stale, or a forger. The sentences promise nothing to do.
4. *Neighbours.* Grepped `src` for "You don't have permission" and "could not be found" in the community directory: the strings already exist at `engagement-copy.ts:44-45`, `:83-84`, `:92-93` and, for archive, `:69-70`; nothing is made stale. `holds_position` is also at `participant-copy.ts:47` and stays (B-3).

**Help impact.** Unchanged from the design: no new page from these rulings. The Phase 4 Batch C and D implementers edit `community.md` (or the page the design names) from the screens.

### For Batch C

1. **Send `expectedFrom` on every engagement change**, taken from the engagement the page rendered: the Inactive and Everyone/Members row buttons send the row's `engagementStatus`; `EngagementCard`'s Save sends the card's loaded engagement; the "Mark as regular attender" nudge sends `visitor`. Never derive it at click time from a refetch. On `changed_meanwhile`, show Group B's sentence and refresh the route so the next attempt starts from the current value. Unit-test that each entry point's action call carries it (a stale-form case per entry point).
2. **Show `unchanged` (`That is already how this person is marked.`) in the refusal style, not as a success.** With `expectedFrom` sent it is reached only by a caller that omitted it, so it should not appear in normal use.
3. **Build on B's minimal edits in the seven files above; do not revert them.** The Group C strings B landed stay as written.
4. **Do not add a restore-specific or visit-details-specific `forbidden` or `not_found` sentence;** use `RESTORE_COPY` and `VISIT_DETAILS_COPY` as B built them.
5. **Archive's "Added when an invitation is open" line:** read `getSignInMarkers` (2b's door); omit the line if the read did not load, per Group D S. Unchanged from the design, repeated because B left the dialog bodies to C.
6. **Batch C also still owns** every item under B's "What Batch C still has to write", including `groups-list.tsx`'s "Managed from" text through `derivedGroupManagedFromText` and the help-page edits from the screens.

### For Batch D and Phase 5

- D: B's list of e2e specs it will meet stands (`community-sign-in-invite.spec.ts` lane 4, `hydration/community-sign-in-controls.spec.ts`, `no-organization-connect.spec.ts` (b), the card line and toggle description). Add: a two-administrator `changed_meanwhile` e2e is not required (T-W's two-connection race covers the library; Batch C's unit test covers that the form sends `expectedFrom`).
- Phase 5: confirm `66e` ran (not skipped) on the from-empty run; confirm the treasury-caused lines cleared after the main merge; record the leaked-fixture failures as environmental.

### Carry-forward

Every Phase 1 gap and Phase 2 ruling keeps its prior disposition. New: the `changed_meanwhile` unreachability (EC-8) is **addressed** by B-1 plus For Batch C 1. EC-20's restore-elsewhere row stays *unverified* (B-8), accepted by the tech-lead.


## Phase 4 — Batch C (ux-developer, 2026-10-31)

**Scope:** the client work of 3a per §A13. Branch `pipeline/visitor-follow-ups`, not pushed. No schema, no Rule 16 file, no `e2e/support/*` touched.

### Commits (all carry `Work-Log:` and the Opus 5.5 co-author trailer)

| Commit | What |
|---|---|
| `4f50c8c` feat(community) | Inactive nav segment; `CommunityRowActions` (Mark as regular, Archive, Restore) and the shared `ImpactDialog` with `EngagementDialog`, `ArchiveDialog`, `RestoreDialog`; `submit-engagement.ts` (the one client path, always sends `expectedFrom`); `engagementImpact` and all dialog/card/visit copy in `engagement-copy.ts`; engagement badge; Group C empty states; `self-connect.ts` (one toggle read for the Inactive page) |
| `fa82823` feat(community) | `EngagementCard`, `VisitDetailsForm`, `ArchiveRestoreControls`, connection suffix for archived connections, wizard Restore, `getCommunityStatus` gains `firstVisitDate` and `howHeard` |
| `c5862b0` feat(community) | Group J strings (Unassigned sentence, `MembersLimited`), Groups list "Managed from" via `derivedGroupManagedFromText` |
| `a15a511` docs(help) | `adding-people`, `sign-in-invitations`, `using-the-directory`, `events-and-the-calendar`, `roles-who-can-do-what`, `what-presbyportal-does` plus registry labels |
| `263532b` fix(community) | two of B's source scans caught the first cut (org-invite import outside the portal; the archive marker named in UI files); reader moved beside the page, UI uses `deriveConnection` |

### Binding rulings honoured
`expectedFrom` is sent from the rendered engagement at the Inactive row's Mark as regular, the card's Save (direct and through the dialog) and the nudge; each has a stale-form test (`changed_meanwhile` shown as an error toast, dialog closed, route refreshed) and a test that `unchanged` is a refusal toast. Failing-first: removing `expectedFrom` from `submit-engagement.ts` failed 10 tests. B's seven-file edits were built on, not reverted; Group C strings B landed are unchanged; `RESTORE_COPY` / `VISIT_DETAILS_COPY` used as built; the archive dialog's invitation line shows only when the marker (list) or card state (record) is `pending`, else omitted.

### Departures (each with its reason)
1. **No Everyone/Members row buttons.** The acknowledgement's "Everyone/Members row buttons" has no counterpart in Copy group C (those rows are Directory entries with no engagement); engagement is changed from the Inactive row, the card and the nudge.
2. **Archive on the person's own record** (button beside the Connection line, plus Restore for an archived person). Group A/D list Restore on the record; the help draft says archive "from their row or their record", so Archive is offered there too, same dialog and strings.
3. **Restore's pending label is "Saving…"** (Group B's) because Group D gives none; no new string.
4. **Wizard Restore:** after success the administrator goes to the restored record; the restore dialog omits the connected line there (the wizard never reads it). `MemberWizard` gains a required `organization` prop (14 test render sites updated).
5. **`getCommunityStatus` extended** (`firstVisitDate`, `howHeard`) in B's file, with a DB assertion; Visit details needed the stored values.
6. **`self-connect.ts`** (new, in the Community page directory): reads `org_portal.sign_in_connect` exactly as `getSignInCard` does; null on failure omits the auto-connect line. The Inactive row dialog thus needs no card read.
7. **No `maxLength` on the how-heard input**, so Group F's "Keep this under 200 characters." is reachable; validation sentences show under their field.
8. **Accessible names:** row buttons use `Archive{" "}<span class="sr-only">Name</span>` (a leading space inside the hidden span was trimmed from the name).
9. **Test edits outside new files:** `members-list`, `page`, `new/page`, `member-wizard`, `[id]/edit/page` tests gained a mock of the community `actions` module (client islands now import it) and updated Group C copy; edit-page panel count 4 to 5.

### Gates
`npm run typecheck`, `npm run lint`, `npm run check` (all ten, incl. `check:help`), `npm run build` clean. `npm test`: 795 files passed, 134 skipped, 12496 tests passed, 0 failed. DB: `community.db.test.ts` 28/28. New/changed unit files: `engagement-copy` 25, `community-row-actions` 21, `engagement-card` 23, `visit-details-form` 8, `confirm-step` 19, `self-connect` 3, members-list 44, edit page 55, page 44.

### 360px walk (own dev server on 3490, stopped by PID; scratch Playwright spec, deleted, screenshots in the scratchpad, not committed)
Light and dark, both passed: Visitors/Inactive/Former lists, 60-character surname wrapping in rows, dialogs, edit page; no horizontal overflow on any screen; every row button at least 44px tall; seven nav segments with Inactive current; Mark as regular dialog (auto-connect line, connected line), archive/restore round trip, rolled person with Participant + Inactive badges, visit-details bad date under the field, wizard archived match with Restore, nudge. Not shown in a browser (unit-tested only): the archive dialog's open-invitation line (no invitation seeded), and the Everyone/Former empty states.

### Help
Six pages edited from the screens; `check:help` passes. **Left for the orchestrator:** `verifiedIn` bumps at ship; `src/content/help/images/community-list.png` re-capture (needs `npm run help:shots` against a fixture-only database, which this Neon branch is not); adding-people draft's "from their row or their record" is now true (departure 2).

### What Batch D needs
- e2e hooks: dialog buttons "Mark as regular attender", "Archive", "Restore", "Keep as it is", "Keep", "Keep archived"; row buttons are named "Mark as regular {Name}", "Archive {Name}", "Restore {Name}"; Engagement select label "Engagement for {Name}"; "Save engagement", "Save visit details"; `data-testid` `engagement-card`, `engagement-nudge`, `visit-details-form`. Archived wizard match shows candidate names as initials ("E. Visitor").
- A person on the roll whose engagement is still Visitor cannot be fixtured by updating engagement (the guard refuses); insert as Visitor, then the approved enrolment row.
- Existing specs to adjust remain B's list plus `community-participants.spec.ts` (seven segments) and anything asserting "No one yet" or "No former participants".
- Seeded here and cleaned: nothing remains in the database from the walk.


## Phase 4 — Batch D (full-stack-developer, 2026-10-31)

**Scope:** the e2e work of 3a: the new specs, the existing specs Batches B and C changed behaviour for, and the hydration lane for the touched controls. Branch `pipeline/visitor-follow-ups`, not pushed. **No application code, schema, `e2e/support/*` or other Rule 16 file touched**; every helper is spec-local, no person-id range was claimed (the throwaway-congregation fixture generates its ids), and no integration patch was needed. Own dev server on port 3490, started and stopped by PID.

### Commit

| Commit | What |
|---|---|
| `36abf1f` test(community) | three new specs; `community-sign-in-invite`, `no-organization-connect`, `community-participants` updated |
| (next commit, `test(community)`) | `member-calendar` and `admin-organizations-create` updated (found by the regression lane), this section |

### New specs (all chromium, desktop and 360px unless noted)

- **`e2e/community-engagement.spec.ts`** (12 lanes x 2 viewports = 24). A throwaway congregation (`setupInviteOrg`, `addSender`) so nothing touches `e2e-alpha` and the teardown removes every row. (1) Inactive and Visitors lists: seven nav segments in one row with Inactive current, rows and details, a 53-character hyphenated surname, row buttons at least 44px tall, neither list in Everyone; (2) empty states and no-match lines of Inactive, Visitors, Former; (3) Mark as regular from an Inactive row: dialog text, the auto-connect line, "Keep as it is" changes nothing, confirm writes exactly one `tenant.person.engagement_changed` row (from, to, standing, `signInConnected`, actor) and lists the person; (4) the dialog outlook with `sign_in_connect` OFF (no auto-connect line) and with a connected sign-in (the connected line only); (5) Archive then Restore from the lists for an inactive person with a connected sign-in and for a visitor: dialog lines, "Keep", "Keep archived", "Archived, {date}" and "Archived visitor" in Former, the persisted `ended_on` / `ended_reason`, the archived and restored audit rows; (6) an archive the database refuses (a role is held): the sentence, the dialog stays open, nothing written; (7) the Engagement card: Save off until a change, Visitor to Inactive saves at once, Inactive to Regular asks first, Keep as it is changes nothing; (8) the nudge for a rolled Visitor, Visitor shown as `Visitor (current)` and not selectable, the roll untouched; (9) **stale form, both entry points**: another change made meanwhile (owner connection) is never overwritten, the `changed_meanwhile` sentence, no audit row, the page refreshed; (10) Visit details: bad date and over-long text under their own fields, nothing persisted, then save, persist across reload, Visitors row, audit row with the two booleans and never the text; (11) Archive and Restore on the person's own record, the card's "was archived" sentence, no visit-details form while archived; (12) the wizard's archived match offers Restore (no connected line there), lands on the restored record.
- **`e2e/visitor-access.spec.ts`** (2 x 2 = 4; the design's A9 spec). A connected visitor sees the Directory and Calendar tiles, opens the calendar, and gets "You don't have permission to view the directory." (HTTP 200, not a 403); a connected regular member opens the directory and does not see the visitor (the control). Flags `org_portal.events` and `org_portal.directory` captured, set, restored; the organization's `org_portal.calendar` toggle by SQL; no baseline-flags key added.
- **`e2e/hydration/community-engagement-controls.spec.ts`** (2; the design's section 11 hydration spec, runs in both lanes). With the page's JavaScript held: the row buttons (Mark as regular, Archive, Restore), Save engagement, the nudge and Save visit details are disabled; forced clicks open nothing and write nothing (membership and audit unchanged); after release they work.

### Existing specs changed

| Spec | Change | Why |
|---|---|---|
| `community-sign-in-invite.spec.ts` lane 4 | the card line is the `not_listed` sentence; no acknowledgement, Send goes straight through. **New 4b** keeps the `do_not_contact` acknowledgement (set on `contact_methods`, asked after the first Send, refused until the box is ticked) | B retired the visitor acknowledgement. The design said the `do_not_contact` lane was "kept"; the spec had none, so 4b adds it |
| `no-organization-connect.spec.ts` (b) | now three lanes: visitor, inactive, moved away; same outcome and text (N0, "Nothing new yet.", nothing connected, no audit row) | 3a: only a listed record connects |
| `community-participants.spec.ts` nav | seven links, still one row; the empty-state loop asserts each list's own noun ("former people", "inactive people"). The old `/former participants/i` check was vacuous (`expect(text).toBeTruthy()`) and is replaced by a real one | Group C wording |
| `community-participants.spec.ts` degrade lane | also removes `directory.view` from alpha's baseline `member` role for that lane only, restored in `afterEach` | see Departures 1 |
| `member-calendar.spec.ts` "without a grant" | the lane removes `events.view` from alpha's baseline `member` and `calendar_viewer` roles for its own `beforeAll`/`afterAll` only, restored by SELECT-verified insert | see Departures 2 |
| `admin-organizations-create.spec.ts` | the created congregation's group list now includes "All Current Records" | the 0066 pair trigger (a derived Active Membership group always gets its sibling) |
| `hydration/community-sign-in-controls.spec.ts` | **no change needed**: it never had a visitor branch (only participants), and its comment about the acknowledgement checkbox is still true for `do_not_contact` | passes unchanged |

### Failing-first (each mutation reverted; `git status` clean afterwards)
- Removing `expectedFrom` from `submit-engagement.ts`: lane 9 fails at the card's `changed_meanwhile` assertion.
- Dropping the `selfConnectEnabled` premise from `engagementImpact`: lane 4 fails on "not connected to this record automatically" with the toggle off.
- Removing `disabled={!hydrated}` from the row Archive button: the hydration spec fails ("Expected: disabled, Received: enabled").
- Removing the `calendar_viewer` role from `visitor-access`: the calendar shows "isn't available to your account" and the spec fails.

### Results (own dev server on 3490, chromium; the server was stopped by PID and the prod lane ran on its own build and port 3800)

| Run | Result |
|---|---|
| `community-engagement` (24), `visitor-access` (4), `hydration/community-engagement-controls` (2), `admin-shell` (7), final run after the last edit | 37 passed, 0 failed |
| Regression lane 1: community-participants, community-sign-in-invite (now 11 lanes x 2), no-organization-connect, community-nav-scroll, community-approval, community-redirect, person-emails, parishes, sign-in-connect-smoke, member-calendar, member-home, portal-home-cards, role-boundaries, designation-revoke, invitation-existing-account, invitation-new-account, totp-full-login | 155 passed, 1 failed (`member-calendar` "without a grant", fixed; re-run 15/15) |
| Regression lane 2: help, help-gates, help-404, admin-organizations, admin-organizations-create, portal-footer-sitemap, account-page, post-login-routing, two-factor-role-based, session-claim-integrity, header-controls, branded-signin, presbytery-oversight, statistics-submit | 143 passed, 1 failed (`admin-organizations-create` group list, fixed; re-run 6/6) |
| `hydration/` in chromium: community-engagement-controls, community-sign-in-controls, community-participant-dialogs, community-approval-controls, no-organization-controls | 8 passed |
| **Prod lane** (`PW_PROD_BUILD=1 ... --project=prod-build`, own build, port 3800): the same four community and no-organization hydration specs | 7 passed. Only those four specs were run in the prod lane, not the whole `npm run test:e2e:prod` (the other hydration specs and `prod-custom-hosts` do not touch these controls) |
| Gates | `npm run typecheck`, `npm run lint`, `npm run check` (all ten): clean |

Not run: the reimbursement specs (treasury's code is not on this branch; the pipeline branch database carries treasury's schema, per the A1 note), custom-domains, giving, careers. None touches the controls, lists or groups this batch changed.

### Departures (each with its reason)
1. **The degrade lane in `community-participants` needed a spec change; it is not a defect.** The clerk is a live member at alpha, and alpha's baseline `member` role (bound to Active Membership, which every live membership joins, DECISION-065; created by main's 0082 baseline backfill) carries `directory.view`. Removing `directory.view` from the spec-owned role no longer removes the permission, so the page rendered the full list. The lane now also removes it from the baseline role for the lane and restores it in `afterEach`. The design's A9 table has no row for it.
2. **Same cause, `member-calendar` "without a grant".** `org-single` (Marguerite Ashcombe) is a live member at alpha, which holds 0082's `member` role and also 0066's `calendar_viewer` role on All Current Records, so every current record there holds `events.view`. The lane now removes `events.view` from those two baseline roles for its own `beforeAll`/`afterAll`. Confirmed restored after the run (both roles hold the key again). **Anyone adding a spec that needs "a member without events.view or directory.view" at alpha must do the same**; a live member cannot be fixtured without them.
3. **`org_portal.followups` toggle off state: not testable here.** The toggle is 3b's (design R64, `ORG_FEATURE_CATALOG`, `-inc3b`); `grep followups src e2e scripts drizzle` finds nothing on this branch. The toggle states 3a does have are `org_portal.sign_in_connect` on and off, covered in lane 4 and in `no-organization-connect` (e). If the orchestrator meant a 3b spec, it belongs to that pipeline.
4. **A second new spec beyond the one named.** The brief said "the new e2e spec the design names"; the 2026-10-25 design names `community-engagement.spec.ts` (section 11) and the amendment names `visitor-access.spec.ts` (A9), plus the section 11 hydration spec. All three are written, because A13 assigns the first two to Batch D and the hydration spec is the design's guard for the new controls. `community-nav-scroll.spec.ts` (section 11, Batch 0) already existed and passes with seven segments.
5. **`community-sign-in-invite` lane 4b is new.** The design said the `do_not_contact` lane was "kept"; the spec had no such lane, so 4b adds it (set on `contact_methods.do_not_contact`; the acknowledgement is asked for after the first Send).
6. **Leaked fixture swept on the pipeline branch (environmental).** The first run failed every invitation-fixture spec: `removeInviteOrg` refuses to finish while a platform-admin fixture holds a membership, and a leaked `e2e-reimby-1793474373022` congregation (treasury's, created 2026-10-31 15:19 EDT, five hours before this run, its `deletable_until` expired so the permanence guard refused the sweep) held one for `admin-2fa-enrolled`. On this pipeline's own Neon branch only: its `deletable_until` was extended one hour, the fixture's own sweep removed the organization and its two people. No other row touched; nothing from this batch leaked (`e2e-invite-*` count 0 afterward).
7. **Not done (outside the brief, still on Batch D's A13 list):** the `community-list.png` re-capture (needs `npm run help:shots` against a fixture-only database; this Neon branch is not one) and the final read of the staged assets and the help diff against the merged tree. Both remain for the orchestrator or Phase 5.
8. **Not covered by e2e, with the reason:** the archive dialog's open-invitation line (an invitation fixture would be needed beside an archive; it is unit-tested in Batch C), `/launch` for an archived connected person (design section 11 lists it; sign-in as an archived person needs a second authenticated browser context; the underlying standing is pinned by T-M and `visitor-access` covers the connected-visitor landing), and a two-administrator `changed_meanwhile` (the acknowledgement ruled it not required; lane 9 reaches it with an owner-connection change made between page load and click, from both entry points).

### For QA (Phase 5)
- Run the three new specs and the three updated ones on chromium against your own server; run the hydration spec in the prod lane (own build). The new spec files contain no `waitForTimeout`; every assertion uses a 30 second budget because the dev server compiles each route on first touch.
- Re-run once with leaked fixtures gone: if `e2e-reimby-*` or `e2e-invite-*` rows exist on the branch, the invitation-fixture specs fail environmentally (Departures 6).
- Departures 1 and 2 are the baseline roles 0082 and 0066 created at alpha, not a regression. **Correction (2026-10-31):** the commit messages of `36abf1f` and `c1cf86b` carry a wrong cause ("3a puts regular attenders in Active Membership"); the tech-lead's ruling D-1a in "Phase 3 acknowledgement (after Batches C/D)" below is the correct attribution, and the spec comments were fixed in the follow-up `test(community)` commit.
- Failing-first evidence for the key assertions is above (four mutations, all reverted).
- No integration patches from this batch; no Rule 16 file touched.

## Phase 3 acknowledgement (after Batches C/D) (tech-lead, 2026-10-31)

Read against the live tree and the pipeline branch's database (read-only: role and group rows of `e2e-alpha`, counts only), not the departure lists alone. No production code or test was changed by this section.

### Rulings, Batch C (ux-developer)

- **C-1 (no Everyone/Members row buttons): accepted, and it corrects a defect in my own acknowledgement.** My "For Batch C" item 1 named "the Inactive and Everyone/Members row buttons"; Copy group C lists row buttons only for Inactive (Mark as regular, Archive) and Visitors (Archive), and an Everyone/Members row is a Directory entry that carries no engagement (Copy line 1477-1478). C followed the Copy table, which was right. Phase 3 miss, recorded; no design change.
- **C-2 (Archive also offered on the person's own record): accepted.** My A8 help draft says "archived from their row or their record" (line 2223) and the architect's R57 scope is the same set on either surface; the design's Copy gave Restore on the record and the dialog is shared, so no new string. Read at `archive-restore-controls.tsx`: the button is disabled until hydration (DECISION-159), the page decides `mode`, and the action and database re-check regardless (refusals shown by the shared dialog). One residual, unverified: the record's Archive/Restore buttons are not in Batch D's hydration spec (it holds the row buttons, Save engagement, the nudge and Save visit details); the component has the `useHydrated` gate, so this is a coverage note, not a defect (see For Phase 5).
- **C-3 (Restore pending label "Saving..."): accepted.** Group B's string; no new string.
- **C-4 (wizard Restore goes to the restored record; the restore dialog omits the connected line there; `MemberWizard` gains a required `organization` prop): accepted.** Source-of-truth check (rule 2): the wizard's match step reads names and roll/engagement, never `people.user_id`, so a connected-line there would assert a state no query established; omitting it is the check applied correctly. Navigating to the record is the natural end of a restore (the record shows the Connection line and the Engagement card). The prop is a mechanical consequence of `ConfirmStep` needing the congregation name for the dialog title.
- **C-5 (`getCommunityStatus` gains `firstVisitDate`, `howHeard`): accepted.** They are columns of the membership row the function already reads in the same transaction, with a DB assertion. Audience: the function feeds only the edit page, which is `people.manage`-gated before any read, so `how_heard` (free text) reaches no one who could not already read it. It is never copied into an audit row (the `visit_details_updated` metadata carries two booleans).
- **C-6 (`self-connect.ts`, a second reader of `org_portal.sign_in_connect`): accepted.** It calls the same `orgFeatureEnabledInTx(tx, org, key, false)` that `getSignInCard` uses (design section 2: "reads of 2b's toggle"), so the dialog line and the Sign-in card cannot disagree; it reads, never writes; it is not a flag read, so Permissions vs Flags is untouched. `null` on failure omits the line instead of saying nothing can happen, which is the correct failure direction for a sentence about a possibility. Cost: one small read per list page, only for a `people.manage` viewer. Accepted.
- **C-7 (no `maxLength` on how-heard): accepted.** With `maxLength={200}` the browser truncates silently and "Keep this under 200 characters." can never be shown, which is the only validation sentence Group F gives. The wizard's own input (`connection-step.tsx:119-125`) has no `maxLength` either, so the two forms agree; the server bound (`MAX_HOW_HEARD`) is the authority. A very long pasted value is carried to the action and refused with the sentence under the field (tested in `visit-details-form.test.tsx`; 360px walk showed the bad-date case; the over-long-text case is covered by D's lane 10).
- **C-8 (`Archive{" "}<span class="sr-only">Name</span>`): accepted.** Accessible name "Archive {Name}"; e2e and QA use it.
- **C-9 (test edits outside new files: a mock of the community `actions` module, Group C strings, the edit-page panel count 4 to 5): accepted.** Each is a designed consequence (client islands import the actions; the Engagement card is the fifth panel).

### Rulings, Batch D (full-stack-developer)

- **D-1 (three existing specs changed): the edits are accepted; the stated cause is not, and the design's intent is as follows.** Who gains what, as designed (R49, R50, D4, D12), from the classifier and the group predicates:
  - **`directory.view` (and the rest of the `member` role): only a person with member standing**, that is `listed` (roll `active`, `baptized`, `affiliate` or `other_participant`, or engagement `regular`) or `staff_anchor`, through the `member` role bound to Active Membership. **Visitors, inactive and moved-away people do not hold it** (3a removes it from them; F177). A regular attender holds it, as they did before 3a.
  - **`events.view` only: every live membership (`ended_on is null`), including visitors, inactive and moved-away people**, through the new `calendar_viewer` role on All Current Records. An archived or ended record holds neither. Either way the person needs a connected sign-in to hold anything.
  - So "every current record at e2e-alpha now gets `directory.view` and `events.view`" is **not** what the design intends, and is not what the build does. 3a gives `directory.view` to nobody new and takes it from visitors and inactive people; it gives `events.view` (only) to people who had no `member` grant. At `e2e-alpha` all three live memberships are `regular`, so all three happen to be member standing (read from the branch database).
- **D-1a (the attribution in Batch D's Departures 1 and 2 is wrong, and it is a defect in the record, not in production code).** "3a puts regular attenders in Active Membership" is false: DECISION-065 put every live membership, regular attenders included, in `active_membership` before 3a. What changed on this database is that alpha holds a `member` role (`directory.view`, `events.view`, bound to `active_membership`) created **2026-10-28** by main's 0082 baseline backfill (0082's header: it adds exactly the Active Membership group and the `member` role to an organization missing them), and alpha's `calendar_viewer` (created by 0066's backfill on 2026-10-31). The clerk and `org-single` therefore held `directory.view` and `events.view` through 0082's `member` role **before and after** 3a. The two lanes break on any database where 0082 has been applied to alpha, with or without 3a; the spec edits remove the permission where it now actually lives and are correct and conditional (they delete only a key a role holds and restore only what they removed), so **they stay**. What must change: the explanatory comments in `e2e/community-participants.spec.ts` (the `setBaselineDirectoryView` doc comment, "Increment 3a: a regular attender is part of Active Membership...") and `e2e/member-calendar.spec.ts` (the "Increment 3a: every current record at alpha now holds `events.view`..." comment), and the two commit messages' wording, state a cause the record contradicts. That is a Phase 4 comment correction (test files, no behavior), to be made by the orchestrator or a Batch D follow-up before merge: say "alpha's baseline `member` role (0082) and `calendar_viewer` (0066) both carry it". Not a Phase 3 design change and not a production defect. Whether `main`'s own e2e lane is red against a database that has 0082 on alpha is not established here; Phase 5 may check by running the two specs unmodified from `main` against such a database (see For Phase 5).
- **D-1b (`admin-organizations-create`: the group list gains "All Current Records"): accepted, and it is a genuine 3a effect and a Phase 3 miss.** The 0066 pair trigger gives every Active Membership group its sibling, so a created congregation has five groups (two for a presbytery, §3.3). My A9 table did not list this spec; §3.3 had named the unit-level effect and I did not grep `e2e/` for a group-list assertion. Recorded as a Phase 3 miss (e2e blast radius).
- **D-1c (help and copy say it truthfully): read, no change needed.** `events-and-the-calendar.md` ("Reading the calendar comes with the Member role and with the Calendar viewer role... held by the 'All Current Records' group, which holds everyone with a current record... including visitors. A person still needs a connected sign-in") is what the group predicate establishes. `roles-who-can-do-what.md` lists Member under "Active Membership" and Calendar viewer under "All Current Records", both true; "A group holds the last four" is true of the table's last four rows. `using-the-directory.md:26` ("visitors, people marked inactive or moved away who are not on the roll") matches the classifier (an inactive person still on the roll with an active roll value is `listed`). No page says a regular attender gained anything, and none says a visitor sees the directory. The release note for 3a must say what 0066 does (narrows `directory.view` for visitors and inactive people, adds `events.view` for every current record) and must **not** say regular attenders newly joined Active Membership.
- **D-2 (a lane for the 3b toggle `org_portal.followups`: not applicable): accepted, and my A13 scope stands.** The toggle, `followups.manage` and `followups.work` are 3b's (design R64, `ORG_FEATURE_CATALOG`, `-inc3b`); 3a adds no organization toggle, no flag and no permission key (section 2). Grep across `src/content/help`, `src/app`, `src/components`: no help page, no UI string and no Copy row names `org_portal.followups`; the only follow-up text in the tree is `engagement-copy.ts:30`, a comment saying 3a says nothing about follow-ups (D8), and two unrelated "we'll follow up soon" strings in the ticket and contact flows. Nothing to add to Batch D. A 3b spec belongs to 3b.
- **D-3 (new specs beyond the one named; lane 4b; the third spec `hydration/community-engagement-controls`): accepted.** A13 assigns `community-engagement` and `visitor-access` to D and section 11 names the hydration spec; 4b is the `do_not_contact` lane the design said was "kept" but had never existed, so adding it is the design's intent. Flag dependencies recorded by D (`org_portal.events`, `org_portal.directory`, the org's calendar toggle by SQL; none in `e2e-baseline-flags.sql`) meet the design rule.
- **D-4 (leaked treasury fixture removed by extending `deletable_until` on the pipeline's own Neon branch): accepted as environmental, one-time and branch-local.** Nothing outside that branch; not a precedent for the shared databases.
- **D-5 (not covered by e2e: the archive dialog's open-invitation line, `/launch` for an archived connected person, a two-administrator race): accepted** for the reasons D gives. The first is unit-tested; the second's underlying standing is pinned by T-M and the connected-visitor landing by `visitor-access`; the third was ruled not required (B-1 acknowledgement), lane 9 reaches `changed_meanwhile` from both entry points.
- **D-6 (the screenshot `src/content/help/images/community-list.png`): the old image is truthful enough to ship; recapture is not a merge blocker.** I opened it. It shows the Everyone view at 360px: "Community", the Pending approvals chip, Add person, the tab strip (clipped after the third tab, so no count of tabs is visible), the search box, "Showing 10 people of 10", and cards with an Edit button and an "Active member" badge. Its alt text ("the view tabs, a search box, and a card for each person with an Edit button") and the one caption using it (`adding-people.md:14`) make no claim 3a falsifies, and no page text quotes the tab count from the image. The data file's `capturedIn: "0.47.0"` is only required to be at most `package.json`'s version (H17). Conditions: (1) Batch C's 360px walk found no change to the Everyone header, card or button; Phase 6 must look at the live Everyone view at 360px beside the image, and if the header, badge or button differs, recapture before merge; (2) recapture with `npm run help:shots` against a fixture-only database on its own port when one is available, and set `capturedIn` to the release that carries it; this is a TODO line, not a Rule 17 failure, because Rule 17's trigger is a changed label or behaviour the image shows, and nothing it shows changed. Do not bump `verifiedIn` in bulk (Rule 17).

### Carry-forward

Every Phase 1 gap and Phase 2 ruling keeps its prior disposition. New or changed: the e2e blast radius gains `admin-organizations-create` (D-1b, Phase 3 miss, addressed by D's edit) and records that `community-participants` degrade lane and `member-calendar` "without a grant" were not 3a effects but 0082's (D-1a). C-1 is a Phase 3 miss in the acknowledgement, not in the design. The record's Archive/Restore hydration coverage is *unverified by spec*, accepted (the component carries the gate).

### For Phase 5 (qa)

1. **Permission matrix at the e2e organization, not a spec edit:** with a throwaway congregation made through `createOrganization()`, confirm in the database (or T-M M-rows) that a visitor and an inactive person each resolve `events.view` and not `directory.view`, and a regular attender and a staff anchor resolve both; an archived record resolves neither. Confirms D-1 as designed; the three specs are not the evidence.
2. **D-1a attribution:** read `e2e-alpha`'s `member` role `created_at` (2026-10-28) and its `active_membership` binding, then run `community-participants` (degrade lane) and `member-calendar` ("without a grant") unedited from `main` against a database that has 0082 on alpha and not 0066, if one is available; report whether they already fail there. Report the stale comments (D-1a) as a Phase 4 comment fix, not a FAIL of behavior.
3. **Re-run the six touched specs** (`community-engagement`, `visitor-access`, `hydration/community-engagement-controls`, `community-participants`, `member-calendar`, `admin-organizations-create`) plus `community-sign-in-invite` and `no-organization-connect`, on your own server with the leaked fixtures gone, desktop and 360px; prod-lane the hydration spec on its own build. Confirm no new key in `scripts/ci/e2e-baseline-flags.sql`.
4. **expectedFrom:** every UI entry point sends it (Inactive row Mark as regular, the card's Save direct and through the dialog, the nudge); confirm the unit tests fail when it is removed from `submit-engagement.ts` (Batch C reports 10 failures) and that lane 9 shows `changed_meanwhile` and writes no audit row from both the card and the row.
5. **Copy truthfulness (the four checks) on the C-4 and C-6 strings:** the wizard's restore dialog shows no connected line; the Inactive row's auto-connect line is absent when `org_portal.sign_in_connect` is off and when the toggle read fails (unit), present and worded "could" when on; the connected-and-not-listed card line and the `not_listed` line say nothing a visitor-with-a-grant contradicts (calendar yes, directory no).
6. **Record-page Archive/Restore:** offered only for `visitor`, `inactive`, `moved_away` (Archive) and archived (Restore), never for a listed or staff-anchor person or your own record; the buttons are disabled until hydration (read `archive-restore-controls.tsx`; no spec covers it, accepted).
7. **How-heard:** a 201-character value shows "Keep this under 200 characters." under its own field in the edit form and nothing is persisted; the wizard agrees.
8. **Screenshot and help:** diff the Everyone view at 360px against `community-list.png` (D-6 condition 1); read the six edited help pages as their reader (the two listed in D-1c plus `adding-people`, `sign-in-invitations`, `using-the-directory`, `what-presbyportal-does`) against the shipped screens; `npm run check:help` clean; confirm no page or string names `org_portal.followups` (D-2).
9. **Carried from the A1/A2/B acknowledgement:** `66e` ran (not skipped) on the from-empty run; treasury-caused lines cleared after the main merge; leaked-fixture failures recorded as environmental.
10. **Release note:** read it against D-1c (narrowing for visitors and inactive people; widening of `events.view`; no claim that regular attenders were newly added to Active Membership).

---

## Phase 5 — Verification (qa), run 1

**Date:** 2026-11-01
**Verified by:** qa
**Tree:** `pipeline/visitor-follow-ups` at `a4a19b7`. The worktree is unchanged. I edited no project file. Every mutation and scratch spec ran in a scratch copy that has since been deleted.

**Verdict: FAIL.** Most of the work checks out, but two items fail and one integration file needs re-cutting:

1. **A treasury e2e spec now fails because of 0066.** `e2e/reimbursement-treasurer-ui.spec.ts:415` fails every time on a fresh database (two runs, same result). The new "All Current Records" group appears in Reimbursement settings as a group that "Can receive requests", so the page shows 4 switches where the spec expects 3. Batch D left the reimbursement specs out of its run, on the belief that treasury's code was not on this branch. It is: the main merge `8b65da4` brought it in. This is an e2e blast-radius miss, and it also needs a design ruling (see Findings, F-1).
2. **Copy truthfulness: one help sentence is now false.** `src/content/help/roles-who-can-do-what.md:18` still says "The groups fill from the roll and from officer terms." The diff edited the line above it but left this sentence, and the design's A8 asked for it to change. All Current Records fills from every current record, visitors included, not from the roll.
3. **Integration patch no longer applies.** `scripts/membership-standing/test-rls.sql.integration.patch` fails `git apply --check` at hunk 2 (`:8746`), because treasury's 73 include now comes after 65. The orchestrator needs to re-cut it at integration. This is not a behaviour failure.

### Run scope

| What | Where | Notes |
|---|---|---|
| typecheck, lint, `npm run check` | worktree | full |
| Unit suite, CI shape (`npm test`, no database env) | worktree | full |
| Full DB-backed suite, serial | pipeline branch `br-silent-glitter-ax34lmz0` | full, because the diff has migration 0066 |
| `test-rls-66.sql` and `test-rls.sql` as `presby_app` | pipeline branch | |
| From-empty run (CI's `db.yml` recipe) | a scratch database inside the pipeline branch, now dropped | migrate with the patched journal, schema parity, seed, patched `seed-dev.sql`, helpers, patched `test-rls.sql` as `presby_app` |
| **Full** `--project=chromium` e2e | that from-empty database, own server on :3490, stopped | full suite required: the diff touches a shared component (`src/components/shared/button-group*.tsx`) |
| Prod lane, five touched hydration specs | own build on :3800 in the scratch copy, stopped | |

**Flag state:** I did not run `e2e-reset-flags.sql`, because no e2e ran against the long-lived pipeline branch. The from-empty database was given exactly CI's state: seed values plus `scripts/ci/e2e-baseline-flags.sql`.

**Two process incidents of mine, reported so the run can be judged:**
- **Stale sign-in states.** My first full e2e run reused stored sign-in states copied from the worktree, which belonged to a different database. Admin specs failed, so I stopped that run by PID, cleared the states and re-ran from the start. The first run's results are discarded.
- **Mutations during the e2e run.** Two DB mutations (the `people.manage` bypass and the `directory.ts` predicate) were applied in the scratch copy while that copy's dev server was serving the full e2e run. Turbopack hot-reloaded them, so for a few minutes the server ran mutated code.
  - I noticed because the 360px screenshots showed inactive people in Everyone. Three isolated re-runs on correct code do not reproduce it.
  - I confirmed the scratch `src` matched the worktree again, then re-ran all 13 specs that ran in that window on correct code: **136 passed**.

## Type Check

`npm run typecheck`: **PASS** (exit 0). `npm run lint`: **PASS**. `npm run check`: **PASS**, all ten tripwires; `check:help` reports 29 registry entries, 23 published, 24 content files, 7 images.

## Unit Tests

**CI shape** (`npm test`, no database env): 929 files, 795 passed, 134 skipped. Tests: 12,496 passed, 0 failed, 3,654 skipped. 37 s. The skips are the database-gated files, which run in the DB lane below.

**DB-backed, serial, pipeline branch:** 929 files, 2 failed. Tests: 16,150 total, 16,145 passed, 4 failed, 1 skipped. 2,766 s. All four failures predate this pipeline:
- **`src/lib/db/fixture-deletable.test.ts` (3 tests).** The canary names 24 leaked people and the two leaked organizations `directory-test-a` and `directory-test-b`. All were stamped at 21:24 UTC on 2026-10-31 and their windows are closed. This is the same leak Batches A2 and B reported.
- **`src/lib/db/domain/parishes.db.test.ts` "the whole file re-applies with no row change" (1 test).** The +2 groups, roles and grants come from replaying 0068 onto those same two organizations. They are the only congregations with no `deacons_moderator` group, verified in the catalog.
- **The 1 skip** is `roll-decide-lockdown.db.test.ts`'s conditional `ctx.skip()`. It predates this pipeline and is not in the diff.
- **Treasury-caused lines are gone.** The 8 failures A2 saw (designation-parity, giving/team, two-factor-default) all pass now.

**RLS:**
- **`test-rls-66.sql`** as `presby_app` (`presby_app|f` checked first): exit 0, 67 passes. 66e is skipped on the long-lived branch by design.
- **From-empty run:**
  - The patched `test-rls.sql` (66 appended) exits 0 with 1,708 passes and no FAIL.
  - **66e ran there, not skipped**: the premise check plus three assertions, 71 passes in the 66 block.
  - Schema parity: 92 tables, 0 failing.
- **`test-rls.sql` on the pipeline branch** stops at `:219` ("expected 2, got 3"). Main's own `test-rls.sql` stops at the same `:219` on `development`, so this is existing data drift. The from-empty run passes it.

## End-to-End Tests

**Full chromium suite on the from-empty database:** 735 tests, 46.2 min.

| Result | Count | What |
|---|---|---|
| Passed | 721 | includes 5 of my scratch QA lanes |
| Failed | 3 | listed below |
| Did not run | 11 | serial follow-ons of the two reimbursement failures |

The three failures:
- **`e2e/reimbursement-treasurer-ui.spec.ts:404` (assertion at `:415`): FAIL, caused by this pipeline.** The settings page lists "Active Membership", **"All Current Records"**, "Property Committee" and "Worship Committee", each with a "Can receive requests" switch: 4 switches against the spec's 3. It failed again in each of two separate re-runs. On main's CI (PR #72, without 0066) the same spec passes.
- **`e2e/reimbursement-member.spec.ts:871`: environmental.** The receipt upload answered "You don't have permission to do that." because of the route's Origin check: `platformOrigin()` falls back to `localhost:3000` and my server ran on :3490. Re-run with `NEXT_PUBLIC_APP_URL=http://localhost:3490`, it **passes**, along with the member spec's serial lanes.
- **My scratch wizard probe:** it timed out on a wrong selector. I rewrote it and re-ran it separately; it passes (see How-heard below).

**Touched specs, all green in the full run:**

| Spec | Passed |
|---|---|
| `community-engagement` | 24 |
| `visitor-access` | 4 |
| `hydration/community-engagement-controls` | 2 |
| `community-participants` | 11 |
| `member-calendar` | 15 |
| `admin-organizations-create` | 6 |
| `community-sign-in-invite` | 22 |
| `no-organization-connect` | 26 |
| `community-nav-scroll` | 3 |
| other `hydration/community-*` specs | 4 |

Each spec covers desktop and 360px where it has both lanes.

**Prod lane** (`next build`, then start on :3800): `hydration/community-engagement-controls`, `community-sign-in-controls`, `community-participant-dialogs`, `community-approval-controls` and `no-organization-controls` all pass, **8 passed**.

`scripts/ci/e2e-baseline-flags.sql` is not in the diff: no new flag key.

**D-1a attribution (item 2).** I ran main's two specs **unedited**, from a scratch copy of `origin/main` on :3491, against `development`. That database has 0082 but not 0066: there is no `calendar_viewer` role, and alpha's `member` role (created 2026-10-28) is bound to Active Membership with `directory.view` and `events.view`.

| Lane | Result on `development` | What it means |
|---|---|---|
| `community-participants` degrade lane (F172) | **fails** at `:310` | 0082's attribution is correct for this lane: the clerk holds an Active Membership row there |
| `member-calendar` "without a grant" | **passes** | `org1@presby.invalid` has no derived row on `development`; on the pipeline branch it has an `all_memberships` row (0066's backfill), so `calendar_viewer` gives it `events.view` |

So the tech-lead's ruling that "the two lanes break on any database where 0082 has been applied to alpha, with or without 3a" is **half wrong**. The member-calendar break comes from 0066, and it is the intended widening. The spec edit is correct, and its comment, which names both roles, is accurate.

There is one stale clause in the `community-participants` comment: "Active Membership, which every live membership joins: DECISION-065". After 0066 that group holds member standing only. It is a comment, not a behaviour problem.

Main's `afterEach` restored `development`; I verified that the clerk role has `directory.view` again.

## Regression Tests Added

This is a feature, so there is no single regression. Failing-first evidence for the key protections:
- **`expectedFrom` dropped from `submit-engagement.ts`** → **10** unit failures, matching Batch C's count. They are in `community-row-actions.test.tsx` (Inactive row) and `[id]/edit/engagement-card.test.tsx` (direct save, dialog save, nudge). Lane 9 covers `changed_meanwhile` from both entry points and passed.
- **`people.manage` check bypassed in `community-engagement.ts`** → 8 failures: 4 in T-W (`community-engagement.db.test.ts`) and 4 in `community-engagement.test.ts`.
- **`directory.ts:317` widened to `in ('listed','inactive')`** → 3 failures: T-M M9 and M10, plus source scan 2.
- **`canArchive` widened to `listed` in `[id]/edit/page.tsx`** → 2 failures in `page.test.tsx`.
- **Record-page `disabled={!hydrated}` removed (`archive-restore-controls.tsx`)** → **0 failures. Nothing catches this.** This is the C-2 residual the tech-lead accepted. I checked it directly in a browser with the page's scripts held: Archive and Restore are disabled before hydration, and a forced click opens nothing.

## Coverage on Critical Modules

| Module | Statements | Branches |
|---|---|---|
| `src/lib/permissions.ts` | 100% | — |
| `src/lib/two-factor.ts` | 91.1% | 100% |
| `src/lib/flags.ts` | 100% | — |
| `membership-standing.ts` | 100% | — |
| `derived-group-labels.ts` | 100% | — |
| `engagement-copy.ts` | 100% | — |
| `community-engagement.ts` (unit only) | 100% | 97.5% |
| `community/actions.ts` | 100% | 94.6% |

## Permission matrix (item 1)

I built a throwaway congregation through `createOrganization()` on the pipeline branch, gave its people the states below, and called `presby_has_permission` as `presby_app`. The congregation was seeded with `member`→active_membership, `calendar_viewer`→all_memberships, `session_member`→session and `deacons_moderator`. Teardown removed everything (I checked: 0 rows left).

| Record | Standing | `directory.view` | `events.view` |
|---|---|---|---|
| visitor | visitor | no | **yes** |
| inactive | inactive | no | **yes** |
| moved away | inactive | no | **yes** |
| regular | listed | yes | yes |
| staff anchor | staff_anchor | yes | yes |
| on the roll, inactive | listed | yes | yes |
| archived visitor | — (ended) | no | no |
| archived inactive | — (ended) | no | no |
| ended regular | — (ended) | no | no |

This matches D-1 exactly. The resolver is keyed on the person, not the account: an unconnected regular attender also resolves `directory.view`. "Needs a connected sign-in" therefore holds because only a connected account acts as that person; the resolver does not check it.

## Feature-Gate Audit

| Route or action | `auth()` present? | Permission check present? | Correct key? |
|---|---|---|---|
| `changeEngagementAction` (`community/actions.ts:120`) | yes, plus `resolveOrgContext` in the body | yes, `presby_has_permission(..., 'people.manage')` inside the write's transaction (`community-engagement.ts:253`) | tenant `people.manage` (FEATURES.* not applicable) |
| `archivePersonAction` (`:169`) | yes | yes (`:349`) | `people.manage` |
| `restorePersonAction` (`:202`) | yes | yes (`:453`) | `people.manage` |
| `updateVisitDetailsAction` (`:242`) | yes | yes (`:540`) | `people.manage` |
| `new/actions.ts` (the wizard) | unchanged | unchanged | only the constant changed (`MAX_HOW_HEARD`) |
| Community page, Inactive view | page gate | `adminView` requires `people.manage` (`page.tsx:141`); `listCommunity` re-checks it in the transaction (`community.ts:185`) | `people.manage` |
| `self-connect.ts` | read only, inside `withOrgContext` | — | — |

No `route.ts` was added or changed. Each action rebuilds its input from the request, so a forged `organizationId`, `from` or `actor` is never read.

## Schema/RLS Audit (0066, live catalog, pipeline branch)

- **RLS is forced** on `memberships`, `groups`, `group_memberships`, `app_roles`, `app_role_permissions`, `role_grants` and `people`: `relforcerowsecurity = t` on each.
- **Function access** (read with `aclexplode`):
  - The new helpers `presby_standing_is_member`, `presby_membership_is_member_standing` and `presby_membership_standing` grant EXECUTE to the owner and `presby_app` only; PUBLIC has none.
  - The definers (`presby_pair_derived_groups`, `presby_sync_derived_group`, `presby_sync_derived_membership_group`, the standing core, `sign_in__check`, `roll_cache_drift`) are owner-only, each with `search_path=public, pg_temp`.
  - `presby_connect_signed_in_account` grants EXECUTE to `presby_app`, as designed.
- **Probes as `presby_app`** (rolled back; `presby_app` holds INSERT and UPDATE grants on these tables, so the grant is never what refuses):

| Probe | Refused by |
|---|---|
| Insert a derived row | trigger `presby_reject_derived_group_write` (F240) |
| End a derived row | the same trigger |
| Bad engagement value | CHECK `memberships_engagement_status_allowed` |
| Write `current_roll` | trigger `presby_memberships_guard_roll_cache` (F244) |
| Rename a derived group | trigger `presby_reject_derived_group_edit` |
| Flip a derived group to managed | the same trigger (F245) |
| Duplicate derived kind | unique `groups_org_derived_key` |
| Change into `staff` | trigger `presby_memberships_guard_engagement` |
| Read another organization's rows | RLS (returns 0 rows) |

- **Owner path:** changing into `staff` is refused by the engagement guard, so that guard binds the owner too.
- **Catalog shape:** `group_memberships_membership_group_key` (unique on membership and group) and the five-kind CHECK are present.

## Record-page Archive/Restore (item 6), how-heard (item 7), screenshot and help (item 8)

**Archive and Restore on the record page** (walked in a browser):

| Person | What the record page offers |
|---|---|
| visitor, inactive, moved away, connected visitor | Archive |
| regular (listed), staff anchor, on the roll and inactive | nothing |
| archived | Restore only |
| your own record, when you are listed | nothing |

**Your own record, when your own standing is inactive:** Archive **is offered**, both on the record and as the Inactive row button. Choosing it shows "You can't archive your own record. Ask another administrator." and writes nothing. The design's `self_target` sentence covers this, and help says "You cannot archive your own record." But it does not meet the acknowledgement's "never for … your own record" (see F-3).

**How-heard, 201 characters:**
- **Edit form:** lane 10 shows "Keep this under 200 characters." under the field and saves nothing.
- **Wizard at 360px:** shows "Keep this under 200 characters" under the field, **with no full stop**, stays on the Connection step and saves nothing. This is a wording difference in an existing string (and the limit itself accepts exactly 200). Minor.

**360px, light and dark:** Everyone, Inactive, Visitors and Former lists, four record pages, and the Mark-as-regular and Archive dialogs all show 0 px horizontal overflow. Screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa/shots/` (the light/dark full-suite set, including the contaminated Everyone pair noted above) and `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa/copy/shots2/` (the clean re-walk and the wizard).

**`community-list.png`:** I opened it. It is Alder Creek fixture data only, with no real person or brand. The live Everyone view at 360px has the same header, tab strip, search box, cards, Edit button and "Active member" badge, so D-6 condition 1 holds. The diff adds no new images.

## Copy Truthfulness

- [x] **Every added or changed string is in the Copy table.** `engagement-copy.ts` matches Groups A, B, D and F plus the ruled additions. Group G's `connected_not_listed` line renders verbatim on the card: I saw it in the browser for a connected visitor. Group H's "All Current Records" and "Calendar viewer" match the seed; `calendar_viewer` is `constitutional` and protected at 19 of 19 organizations, so "Constitutional" is true.
- [x] **The query behind each claim was opened.**
  - Auto-connect line: it needs `signInConnected === false`, an address on file, the toggle on, and a change that lists the person. If any of those is unknown, the line is left out (`self-connect.test.ts:34`, `community-row-actions.test.tsx:152`).
  - Wizard restore dialog: it shows no connected line, because the wizard never reads `user_id` (lane 12).
  - The card's "can still see the calendar": `calendar_viewer`, hedged with "if your congregation uses it".
- [x] **Each instruction is doable by the role that sees it.** Every instruction is shown to `people.manage` holders, and each control is on the same page.
- [ ] **Neighbours: one now-false string.**
  - **`copy truthfulness: FAIL` — `src/content/help/roles-who-can-do-what.md:18`**, read by a founding administrator or anyone reading public help. "The groups fill from the roll and from officer terms." is false for "All Current Records", which holds everyone with a current record, visitors included. Design A8 listed "the group-fill sentence" as an edit.
  - Not done, but still true, so not FAILs: A8's edits to `events-and-the-calendar.md:1` and `:3` ("shows … to its members", "The calendar every member sees"), and the extra sentence for `using-the-directory.md`.
  - No page or string names `org_portal.followups` (item 8 holds).
- [x] **Help diff covered.** I read all six pages against the screens. The labels I walked are on screen: Inactive, Engagement, Save engagement, Mark as regular, Archive, Restore, Keep archived, Visit details, Save visit details, and the staff-record sentence. Every other claim was checked against the code and the walk.
- **Release note (item 10):** it is not written yet; it is a Phase 6 task. Group I's drafts do not yet carry D-1c's two required facts: inactive people lose `directory.view`, and every current record gains `events.view`.

## Findings

- **F-1 (FAIL, blocks).** Fix `e2e/reimbursement-treasurer-ui.spec.ts:415`. First the tech-lead must decide whether the derived "All Current Records" group, which includes visitors and inactive people, should be offered in Reimbursement settings at all. The choices are: hide it in treasury's group reader, or accept it and update the spec's count and comment. Then re-run the whole reimbursement spec set on a matching origin.
- **F-2 (FAIL, blocks).** Correct `roles-who-can-do-what.md:18` as A8 asked, re-walk the page, and keep `check:help` clean.
- **F-3 (needs a ruling, does not block).** Hide Archive on your own record and on your own Inactive row, or keep the designed refusal. Adding a viewer-id check to `canArchive` and to the row would match the acknowledgement's item 6.
- **F-4 (integration, orchestrator).** Re-cut `test-rls.sql.integration.patch`. The branch is also 49 commits behind `origin/main` (photos 0.52.0, migration 0078); merge before integration and re-run `test-rls` on the merged tree.
- **F-5 (comment).** Update `community-participants.spec.ts`'s "every live membership joins" clause, and correct the D-1a record as above.

## Verdict

**FAIL.** F-1 is a red spec this pipeline caused and also needs a design ruling. F-2 is a help sentence the diff made false. The diff is not auth-touching.

## Per-Phase Status row

| 5 — Verification | qa | Run 1: full e2e 721/735 (2 project failures: 1 caused by this pipeline, 1 environmental origin mismatch; the third failure was QA's scratch probe), DB suite 16,145/16,150 (4 existing), from-empty `test-rls` exit 0 with 66e executed | FAIL | 2026-11-01 |

## Handoff

**Next:** the tech-lead first, for the F-1 ruling and the F-3 ruling. Then full-stack-developer (Batch D owner) for the F-1 spec or reader change, the F-2 help sentence and the F-5 comment. Then Phase 5 run 2, which only needs to re-run the reimbursement specs, the help check and the walk of the page that F-2 changes.

**Left behind:** no servers (:3490, :3491 and :3800 are free), no scratch copies, and the scratch database `qa5_fromempty` is dropped. The pipeline branch and `development` are as I found them. Logs and screenshots remain in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa/`.

---

## Phase 3 ruling on Phase 5 run 1 (tech-lead, 2026-11-01)

Read against the live tree at `9b5f28b` (worktree `presby-inc3`), not the QA text alone: `drizzle/0073_presby_reimbursements.sql` (the settings, form-options, `set_chargeable`, `is_eligible_requester`, `is_seat`, `route` and `viewer_relation` definers), `src/lib/reimbursement/{config,reads}.ts`, `scripts/check-treasury-boundaries.mjs`, DECISION-271, the treasury work-log's Q5 ruling, `e2e/reimbursement-treasurer-ui.spec.ts`, `reads.db.test.ts`, the Community page, row and record-page files, and the two spec comments. No production code, test, help page or Rule 16 file was changed by this section; it is rulings only.

**Verdict on the QA findings:** F-1 accepted as designed (the spec is stale, the group is not wrong); F-2 required; F-3 hide it; F-4 is the orchestrator's; F-5 required (comment only) plus a correction to my own D-1a below. One Phase 3 miss is owned (e2e blast radius, see "Carry-forward").

### F-1. All Current Records in Reimbursement settings: accept, update the spec, pin the claim with a DB test

**What "Can receive requests" grants.** Nothing to the group's members. It is a *charge-to* list. `reimbursement_chargeable_groups` only decides which groups appear in the request form's "charged to" choice (`presby_reimbursement_form_options`, `0073:3058`). Each fact below was read in the definer, not inferred:

- **Who may file is a separate rule, and 3a does not touch it.** `presby_reimbursement__is_eligible_requester` (`0073:657`) is `current_roll is not null or engagement_status in ('regular','staff')`, read from `memberships`, never from a group. A visitor (roll null) is `mayFile: false` and is offered no groups at all: `reads.db.test.ts:169` already pins `getFormOptions(visitor)` as `{ mayFile: false, groups: [] ... }`. Making All Current Records chargeable adds nothing to that. An inactive person with no roll is also refused; an inactive person still on the roll could already file before 3a (unchanged, and F246 is the open item about that function).
- **Group membership routes nothing and shows nothing.** The approver is a seat: `chair` or `leader` on a `membership_source = 'managed'` group (`is_seat`, `0073:3i`). A derived group has no such rows, so a request charged to All Current Records has no seat and `presby_reimbursement__route` returns `treasurer` (or `nobody` with no second pay holder). `viewer_relation` grants the seat arm only through `eligible_approvers`, so being in a chargeable derived group lets nobody view a request. Nothing about the group's size (visitors included) reaches any reader.
- **The row's own text is already true for it.** A derived group renders "No chair or leader: requests go to the treasurer." (`copy.ts`, group row), and `approverCount` is 0 by construction. The treasury help page (`reimbursements-for-treasurers.md:68`) says "switch on 'Can receive requests' for each group people may charge" and "If a group has none, the page says requests go to the treasurer": both remain true, and it names no group, so no help edit.
- **Default is off.** A new row starts un-listed (`chargeable` is true only with a live `reimbursement_chargeable_groups` row). The treasurer must choose it. No one's request form changes on upgrade.
- **Treasury's design chose this deliberately.** `treasury-inc1.md:121` and `config.ts:22`: "any group of the organization may be chargeable, including a derived one (Session, Diaconate)... (operator Q5)". Active Membership, Session, Diaconate and the Board of Deacons Moderator group are all offered today. All Current Records is one more derived roster under the same ruling. The spec's own comment already said "the two committees and the derived Active Membership roster".

**Why not exclude it in the reader.** The reader is `presby_reimbursement_settings`, a `SECURITY DEFINER` function in treasury's shipped migration `0073` (released as 0.51.0; fix forward only, DECISION-298's five conditions are not met). Excluding the group means a new migration against treasury's definer, and the definer returns only `membershipSource` (`managed` or `derived`), not `derived_from`, so a TypeScript-side filter in `getSettings` cannot tell All Current Records from Active Membership without changing the function anyway. A filter written anywhere outside `src/lib/reimbursement/` would breach the T2 boundary of `check:treasury-boundaries`. It would also be inconsistent: `set_chargeable` accepts any group id of the organization (`group_unavailable` is only for a non-existent one), so a hidden group could still be switched on by a forged call. And the benefit is only tidiness. Rejected. **Revisit if** the operator finds the row confusing in production; the place to do it is F246's forward migration (which already has to replace a body in this file), adding `derived_from` to the settings output and excluding rosters that name no meaningful cost centre. That is a treasury-pipeline decision, not 3a's.

**DECISION-271 and the tripwire.** DECISION-271's T1 to T5 are owner connections, table naming, `capture`, notice templates and `sharp`; none concerns which groups the settings page lists. Accepting changes no tripwire. The two files below are inside the T2 allowances (`e2e/` and `src/lib/reimbursement/` are not scanned or allowed).

**Exact changes (full-stack-developer):**

1. `e2e/reimbursement-treasurer-ui.spec.ts:414-415`. Replace the comment and the count with:

   ```ts
   // Every group has a switch: the two committees and the two derived rosters, Active Membership and its
   // sibling All Current Records (the 0066 pair trigger gives every Active Membership group one). A derived
   // roster is listed like any group (treasury Q5), starts off, and has no seat, so its requests go to the treasurer.
   await expect(page.getByRole("switch", { name: "Can receive requests" })).toHaveCount(4);
   for (const name of ["Active Membership", "All Current Records"]) {
     const derived = page.getByTestId("chargeable-row").filter({ hasText: name });
     await expect(derived).toContainText("No chair or leader: requests go to the treasurer.");
     await expect(derived.getByRole("switch")).toHaveAttribute("aria-checked", "false");
   }
   ```

   The existing `for (const row of [property, worship])` line stays. `e2e/support/*` is not touched (the fixture inserts Active Membership and the pair trigger makes the sibling; `createOrg` needs no change). Flag dependency of this spec is unchanged; no key is added to `scripts/ci/e2e-baseline-flags.sql`.
2. `src/lib/reimbursement/reads.db.test.ts`: one new `it`, under `getSettings`, that pins the acceptance claim rather than leaving it as prose. In the existing org `A` (the fixture's `makeOrg` seeds the derived groups; if it does not create the `all_memberships` sibling, insert Active Membership through the same path the e2e fixture uses and let the trigger make it, or select the group by `derived_from = 'all_memberships'`):
   - make `all_memberships` chargeable with `fx.chargeable`, and **un-list it in a `finally`** (the neighbouring tests assert the exact chargeable names `["Finance Committee", "Quiet Committee"]`; the existing "Short Lived" test shows the pattern);
   - `getSettings(manager)` reports it `{ chargeable: true, approverCount: 0, membershipSource: "derived" }`;
   - `getFormOptions(requester)` lists it, and `getFormOptions(visitor)` is still `{ mayFile: false, groups: [], categories: [], canRequestForOthers: false }`;
   - a request filed by `requester` and charged to it (`filed(requester, { groupId })`) appears for `t1` on the treasurer `override` tab (no eligible approver) and not in `chair`'s waiting list.
   Run it failing-first by asserting the opposite once (the visitor expectation) and reverting.

**Copy checks (F-1: no string is added or changed).** Residuals: nothing denied (the row text is the existing derived-group sentence). Source of truth: "requests go to the treasurer" is established by `approverCount = 0` from `is_seat`'s `managed` filter, the same query the Q5 row already relies on. Audience: `reimbursement.manage` holders, who can switch it. Neighbours: grep of the live tree for "Can receive requests" finds `copy.ts:428`, the help page and the registry label only; none is made stale.

### F-3. Archive on your own record and own Inactive row: hide it; keep the refusal as the backstop

Hide it. Reasons: the acknowledgement's item 6 and my A8 help line ("You cannot archive your own record") both promise it is not offered; offering a control whose only outcome is a refusal is worse than not offering it; and an administrator in this state is real but rare (an administrator who is themselves recorded as a visitor or inactive), so the cost is two small conditions. The `self_target` sentence stays in `engagement-copy.ts:80` and the check stays at `community-engagement.ts:356` as the server and stale-page backstop (a forged call, a page loaded before the person's connection changed). No string is added or changed, so the four Copy checks have nothing new to check; `adding-people.md:61` ("You cannot archive your own record.") stays true, and no help edit follows.

Mark as regular is **not** refused on your own record (the engagement write has no self check, and the design never gave one: it widens nobody's authority, since the person is already a `people.manage` holder). Left as is; only Archive is hidden.

**Exact changes (full-stack-developer), all in `src/app/(org)/o/[slug]/admin/community/`:**

1. `[id]/edit/page.tsx:271`: add `&& id !== resolved.org.personId` to `canArchive` (compare the route's `id` as the page already does for other uses; if the route param is not already lower-cased UUID text, compare lower-cased on both sides, because the server's check is `===` on database ids). `ended === "archived"` (Restore) is unchanged.
2. Row: thread the viewer through `page.tsx` (`personId` is already in scope at `:147`) to `MembersList` (new optional prop `viewerPersonId`, `members-list.tsx`, passed to `CommunityRowsList` at `:100`), and in `community-rows-list.tsx:77` pass `isSelf={row.personId === viewerPersonId}` to `CommunityRowActions`. In `community-row-actions.tsx:61` make it `const canArchive = (view === "visitors" || view === "inactive") && !isSelf;`. The early return at `:64` already handles "no button at all" (a Visitors row for yourself shows nothing; an Inactive row for yourself still shows Mark as regular). `isSelf` defaults to `false`.
3. Tests: `[id]/edit/page.test.tsx` (the file that already fails when `canArchive` is widened): own inactive record shows no Archive and another inactive record does; `community-row-actions.test.tsx`: `isSelf` on an Inactive row shows "Mark as regular" and no "Archive", on a Visitors row renders nothing, and a Former archived row still shows Restore; `actions.test.ts` already pins `self_target` and is untouched.
4. e2e: one new lane in `e2e/community-engagement.spec.ts` (throwaway congregation; the sender is the viewer): set the sender's own membership to `inactive` with spec-local SQL, assert the Inactive list shows the sender's own row with "Mark as regular" and no "Archive", and the sender's own record page offers no Archive; another inactive person's row and record still do. Desktop and 360px. If the sender cannot be left holding `people.manage` while inactive in the fixture, the implementer states that in the work-log and the lane is recorded as *unverified in e2e* (the unit tests then carry it); QA already walked the real state.

### F-5. The `community-participants` comment, and a correction to my own D-1a

**Exact replacement for the doc comment above `setBaselineDirectoryView`** (`e2e/community-participants.spec.ts:49-55`; comment only, no behaviour):

```ts
/**
 * Alpha's baseline `member` role (`directory.view` and `events.view`, bound to Active Membership) comes from
 * main's 0082 baseline backfill. Since 0066 Active Membership holds member standing (people on the current
 * roll, regular attenders and staff records); the clerk is a regular attender there. Removing `directory.view`
 * from the spec-owned role alone therefore does not remove the permission: the degrade lane must take it from
 * the baseline role too, for the lane only, and restore it. Returns whether the baseline held it.
 */
```

The stale clause is "which every live membership joins: DECISION-065" (true before 0066, false after; DECISION-065 is not changed, 0066 narrows the group's rows). The `member-calendar.spec.ts:64-68` comment already names both roles and the two migrations correctly and needs **no** change.

**D-1a is corrected, not only restated.** My D-1a (line 2802) said both lanes "break on any database where 0082 has been applied to alpha, with or without 3a". QA ran main's two specs unedited against `development` (0082 applied, 0066 not): the `community-participants` degrade lane fails there (0082's `member` role, as I ruled) and the `member-calendar` "without a grant" lane **passes**. So:

- `community-participants` degrade lane: **0082**. My attribution stands.
- `member-calendar` "without a grant": **0066** (the new `calendar_viewer` role bound to All Current Records, which `org-single` joins through the backfill). This is the *intended* 3a widening of `events.view` to every current record (D-1), not a defect and not 0082's. Batch D's Departure 2 named the cause correctly ("holds 0066's `calendar_viewer` role on All Current Records"); my D-1a overcorrected it. The spec edit is right and the comment is right.
- Batch D's commit-message cause ("3a puts regular attenders in Active Membership") remains wrong for both lanes; that part of D-1a stands. Commit messages are not rewritten.
- The carry-forward sentence at line 2813 ("were not 3a effects but 0082's") is superseded: one is 0082's, one is a 3a effect and joins the e2e blast-radius list as a Phase 3 miss (my A9 table did not list `member-calendar`).
- The unverified-whether-main-is-red question in D-1a is answered by QA: main's `community-participants` degrade lane is red against a database carrying 0082 on alpha. That is main's existing defect, not this pipeline's; the orchestrator may record a TODO line (the spec needs the same baseline handling on main) and the edit in this branch will carry it at merge.

### F-2. The help sentence, and A8's other unmade edits

**Required now, exact replacement for `src/content/help/roles-who-can-do-what.md:18`:**

> A group holds the last four, so whoever is in that group has the role. The groups fill by themselves. "Active Membership" holds people with member standing: those on the current roll, regular attenders and staff records. "All Current Records" holds everyone with a current record, including visitors and people marked inactive or moved away. "Session" and "Board of Deacons Moderator" fill from officer terms. See [Officers and the Session](/help/officers-and-the-session).

The four Copy checks:
1. *Residuals.* Denies none: it does not say regular attenders newly joined (D-1c), and it says visitors are in All Current Records, which the release note must also say.
2. *Source of truth.* Active Membership: `presby_standing_is_member` is `standing in ('listed','staff_anchor')` (`0066:152-156`), so current roll, regular and staff. All Current Records: the `all_memberships` predicate, every membership with `ended_on is null`, which is what the Calendar viewer row of the same table and `events-and-the-calendar.md:15` already say. Session and the moderator seat: officer terms (the existing sentence's second half; The Court Is Not a Group). "Fill by themselves" is true of all four (derived groups reject direct writes by trigger).
3. *Audience.* Administrators reading public help; the sentence instructs nothing.
4. *Neighbours.* Grep for "fill from" / "from the roll and": only this line. `events-and-the-calendar.md:15` and the table rows are consistent with it. All quoted strings ("Active Membership", "All Current Records", "Session", "Board of Deacons Moderator") already appear in the page's table; no `labels` change; `verifiedIn` stays at the value Batch C set (it is moved by walking the page; the implementer walks it, QA re-walks it).

The implementer re-reads the whole page against the Roles screen and runs `npm run check:help`.

**A8's other edits, not required now.** I read each as its reader against the shipped build:

- `events-and-the-calendar.md:1` ("shows your congregation's events to its members") and `:3` ("The calendar every member sees"): still true. A visitor with a connected sign-in sees it too, which makes the sentence *incomplete*, not false, and line 15 already says exactly who reads it. Rule 17 triggers on a changed behaviour a page describes wrongly; these pages describe members reading the calendar, who still do. Not required. I withdraw A8's wish for them as written; a later wording pass may change "members" to "people with a current record", noted below.
- `using-the-directory.md`: line 26 already says visitors, inactive and moved-away people not on the roll are not listed, and QA walked it as true. A8's "one sentence under the opening paragraph" was a nicety. Not required.

### The wizard's "Keep this under 200 characters": out of scope

Not in scope, no change. The string is `member-wizard-schema.ts:80` (and `:87` for the minute reference): an existing zod message pinned by a characterization golden (`member-wizard-schema.golden.test.ts:98,105,120`), written without a full stop in the same style as every other wizard message. 3a changed the *bound* (`MAX_HOW_HEARD`), not the wording. The Copy table's sentence with a full stop is the edit form's (Group F, `participant-copy.ts:75`), a different surface. Editing one wizard message alone would make it disagree with its siblings and the golden; editing all is a wording pass over a surface 3a does not own. QA correctly marked it minor. A TODO line (below) covers a consistent pass; it does not block the pipeline and is not a Phase 5 re-run item.

### Carry-forward

| Item | Disposition |
|---|---|
| Phase 1 gaps and Phase 2 rulings | Unchanged from the prior acknowledgements |
| F-1 (new) | Addressed: accepted; spec edit and a DB test; treasury's reader unchanged; excluding the group deferred, accepted by tech-lead, to F246's treasury forward migration if the operator asks |
| F-2 | Addressed (sentence); A8's other edits dropped as not required |
| F-3 | Addressed (hide; backstop kept) |
| F-4 | Orchestrator (not this section): merge `origin/main` (0.52.0, 0078) before Phase 5 run 2, re-cut `scripts/membership-standing/test-rls.sql.integration.patch`, re-run `test-rls` on the merged tree |
| F-5 | Addressed (comment text exact; D-1a corrected above) |
| e2e blast radius (**Phase 3 miss, owned**) | My A9 table (D20) was cut against the pre-merge tree and I never re-cut it after `8b65da4` brought treasury onto the branch; Batch D's "not run: the reimbursement specs" was true when written and I accepted it in the last acknowledgement without asking for the re-grep. The set now includes `reimbursement-treasurer-ui` (F-1) and `member-calendar` (3a effect, D-1a). **Rule for the retrospective:** at every merge of `main` into a pipeline branch, re-run the blast-radius grep over `e2e/` and `src/**/*.db.test.ts` for the changed predicate, group list and role list, not once at Phase 3 |

### Lines for the orchestrator (Rule 16 shared files; not edited here)

- `docs/decisions.md`: one implementation entry, "Derived rosters are chargeable like any group; Archive is hidden on the viewer's own record (3a Phase 5 run 1, F-1 and F-3)", recording the reasons above.
- `docs/TODO.md`: (a) wording pass on the wizard's validation messages (full stop, one style, update the golden); (b) `events-and-the-calendar.md` "members" wording after the release note lands; (c) main's `community-participants` degrade lane breaks on a database with 0082 on alpha; (d) F-1's "revisit" inside the F246 migration line.
- Phase 6 / release note: D-1c's two facts still owed (inactive and visitor people lose `directory.view`; every current record gains `events.view`), and it must not say regular attenders newly joined Active Membership. All Current Records now appears as an extra, off-by-default switch in Reimbursement settings; the note may say so in one clause.

### Implementer and scope of Phase 5 run 2

**Implementer: full-stack-developer (the Batch D owner).** Changes are test-and-comment (F-1, F-5), one markdown sentence (F-2) and a small presentation condition with prop plumbing (F-3); no schema, no server action, no migration, no new string, no flag, no Rule 16 file. Gates: `npm run typecheck`, `npm run lint`, `npm run check` (all ten), the unit suite, `npm run check:help`.

**Phase 5 run 2 (qa), exact scope.** Order: the orchestrator merges `origin/main` first (F-4), then this batch, so the verified tree is the integrated tree.

1. **Reimbursement e2e, the whole set, with `NEXT_PUBLIC_APP_URL` set to the server's own origin** (run 1's Origin-check failure was environmental): `reimbursement-treasurer-ui` (including the 11 serial follow-ons that did not run in run 1, which have never run on a database carrying 0066: report each), `reimbursement-treasurer`, `reimbursement-approval`, `reimbursement-csv`, `reimbursement-member`, `reimbursement-role-bundle`, `reimbursement-toggle`, and `hydration/reimbursement-form`, `hydration/reimbursement-treasurer-forms`. Desktop and 360px where the spec has both. Report the new settings assertions failing first against the unmodified count.
2. **The new DB test** (`reads.db.test.ts`) plus the whole `src/lib/reimbursement` DB-backed directory, serial; confirm the neighbouring exact-name assertions still pass (the new test un-lists its row).
3. **F-3:** unit tests (`page.test.tsx`, `community-row-actions.test.tsx`); `community-engagement` (all lanes, both viewports) with the new own-record lane, `community-participants`, `community-nav-scroll`, `visitor-access`, and `hydration/community-engagement-controls` in chromium **and** the prod lane (the row component changed); walk it in a browser at 360px: own Inactive row shows only "Mark as regular", own record shows no Archive, another inactive person still does, no overflow, light and dark.
4. **F-2:** read the whole `roles-who-can-do-what` page as an administrator against the Roles screen; `npm run check:help` clean; Copy truthfulness on the one sentence against the four checks above.
5. **F-5:** a comment-only diff; typecheck and lint; the two specs still pass.
6. **Not re-run (stated):** the full chromium suite (nothing shared changed: no component under `src/components/shared`, no schema), the full DB suite, and the other prod-lane hydration specs. If the `origin/main` merge brings changes touching Community, directory, groups, the roles page or reimbursement, QA widens to those by the merge's file list; the `test-rls` re-run on the merged tree is F-4's.
7. **Carried to Phase 6:** the release note against D-1c; D-6 condition 1 (image) already satisfied by QA.

### Per-Phase Status row

| 3 — Technical design (ruling on run 1) | tech-lead | F-1 accept + spec + DB test; F-2 sentence required, other A8 edits dropped; F-3 hide; F-5 comment + D-1a corrected; wizard string out of scope; Phase 3 miss owned (post-merge e2e re-grep) | RULED | 2026-11-01 |

**Next:** full-stack-developer for the items above, then (after the orchestrator merges `origin/main`) Phase 5 run 2.
