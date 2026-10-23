# Community hides people whose only connection is a staff anchor — Work Log

> **Slug:** `2026-10-23-community-staff-anchor`
> **Surface:** (org) — `/o/<slug>/admin/community`
> **Permission(s):** existing (`people.manage`), unchanged
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Source:** operator, production, 2026-10-23. The operator accepted the founding-administrator invitation at their first test congregation. Their person record was then findable by search and editable, but appeared in none of Community's six views.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator | Complete (brief: bug confirmed on production, read-only) | — | 2026-10-23 |
| 2 — Architectural review | — | Skipped: no schema, permission, route or invariant change; one reader's predicate widens inside the existing `people.manage` gate | — | 2026-10-23 |
| 3 — Technical design | orchestrator | Complete (brief, below) | — | 2026-10-23 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-10-23 |
| 5 — Verification | qa | Run 1 FAIL (no-organization copy and two e2e locators; Community fix passed); fixed; re-verification pending | FAIL → pending | 2026-10-23 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## Phase 1 — bug confirmed (orchestrator)

Production, read-only, counts and flags only:
- The congregation's single membership row has `engagement_status = 'staff'`, `current_roll` null, not ended, and the person is linked to an account.
- It has 0 open staff positions, 0 officer terms, 1 email and 2 open role grants.

This is exactly the anchor `presby_accept_invitation` writes for a designee (DECISION-128 shape, DECISION-183). The six views and why each misses it:
- **Everyone:** Directory-backed, which excludes staff anchors with no roll (DECISION-129).
- **Members** and **Participants:** need a roll.
- **Visitors:** needs engagement `visitor`.
- **Staff:** built from open staff positions only (Increment 1 ruling).
- **Former:** needs `ended_on`.

So a founding administrator or treasurer who joins by invitation is invisible in Community. Search finds them because the match reader covers every live membership. Phase 6 of the Community pipeline flagged the "Everyone" semantics (follow-up 4) but not this hole.

## Phase 3 — root cause and fix shape (orchestrator)

**Root cause.** The Staff view was defined as "open staff position" and the Everyone view as "Directory". No view owns the staff anchor: a live membership with engagement `staff`, no roll and no position.

**Fix.**
1. The Staff view (`src/lib/community.ts` and the page) lists people with an open staff position **or** a live membership with `engagement_status = 'staff'`. Anchors without a position show a "No position yet" note, with a link to the Staff page to add one. Ordering and the empty state stay coherent.
2. **Invariant regression test.** A DB-backed test builds a person for each live-membership shape (roll member, participant, visitor, staff with a position, staff anchor without a position, and an ended membership) and asserts each appears in at least one Community view. A future shape then cannot fall through.
3. The Directory exclusion (DECISION-129) is unchanged: the anchor still does not appear in the member Directory or in Everyone.

**Implementer:** full-stack-developer. The change is small and spans the lib reader, the page row, and the tests.

## Phase 4 — implementation (full-stack-developer)

**Files changed**
- `src/lib/community.ts`: the `staff` list predicate is now `live, not merged, not deceased, and (engagement_status = 'staff' or an open position)`. An anchor row comes back with `positions: []`. Reader, count, search, order and the `people.manage` gate are the same query path. The Directory, Everyone and DECISION-129 are untouched (`directory.ts` not edited).
- `src/app/(org)/o/[slug]/admin/community/community-rows-list.tsx` and `members-list.tsx`: a Staff row with no position shows "No position yet", plus an "Add a position" link to `/o/<slug>/admin/staff` when `canStaffLink` (flag `org_portal.staff` on and `staff.manage`, the same gate the empty-state link already uses). The page already computed `canStaffLink` for the staff view, so `page.tsx` needed no change.
- `src/lib/community.db.test.ts`: new viewer holding both `people.manage` and `directory.view`; two new fixtures (ended anchor, merged anchor); the old "engagement 'staff' alone does not list" test rewritten; ended or merged anchors asserted absent; count, search, order and pagination asserted; the invariant regression test (below). The `beforeAll` and `afterAll` hooks got an explicit 120 s timeout because the added setup pushed past the 30 s default on a slow Neon connection.
- `members-list.test.tsx`: anchor row reads "No position yet", link only with `canStaffLink`, never on a row with a position.
- `e2e/community-participants.spec.ts` and `e2e/support/community-fixture.ts`: new `createStaffAnchorViaSql` helper (fixture-prefixed id, swept by the existing sweep) and an anchor spec at desktop and 360px (listed under Staff with the note, absent from Everyone). The existing e2e did not pin Staff view content, so nothing else changed.

**Deviations**
- No `page.tsx` change (see above).
- The "Add a position" link renders only when the viewer can use the Staff page. A `people.manage` holder without `staff.manage` sees the note without the link rather than a link to a forbidden page.
- The Staff empty-state headline ("No one holds a staff position yet") is unchanged. It is now reachable only when there is no anchor either; the pinned copy is a little loose but not wrong enough to touch.

**Regression test, red then green**
`community.db.test.ts` > "every live-membership shape is findable in Community" > "each person lands in at least one of the six views, and the ended one in Former — regression for staff-anchor people missing from Community". One person per shape: roll member, participant, visitor, staff with a position, staff anchor without a position, and an ended membership (Former). It reads the six views as a viewer with both permissions, and asserts the anchor lands in Staff only.
- Before the fix: 3 failed, 15 passed. The invariant test failed on "staff anchor without a position: expected [] to not deeply equal []", and the two listStaff tests that pin the anchor failed.
- After the fix: 18 of 18 pass (`--no-file-parallelism --testTimeout=120000`).

**Gates**
- `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires): clean.
- Unit suite (no DB env): 504 files passed, 72 skipped; 7606 tests passed, 2161 skipped.
- `community.db.test.ts`: 18 of 18 passed.
- Community e2e (`e2e/community-participants.spec.ts`, chromium project), from a hardlinked scratch copy: 11 of 11 passed at desktop and 360px, including the new anchor spec. Several earlier runs failed because another pipeline's worktree (`presby-nav-e2e`) was running the same spec against the shared Neon branch at the same time. Both specs sweep `E2ECommunity` people, so they delete each other's fixtures. This is not a code defect, but concurrent runs of this spec on a shared branch are not safe.
- Real-browser look at `?view=staff` at 360px: the anchor card shows name, "No position yet" and Edit, with no overflow. The e2e clerk lacks `staff.manage`, so the Staff link was not visible in the browser; the unit test covers it.

**Incident, cleaned up.** I once ran `npm test` in a shell that had `.env.local` exported, so the whole DB-backed suite ran in parallel against `pipeline-person-emails` and many suites timed out before their teardown. That left 328 fixture organizations, 413 people and 160 users created in that window. I removed exactly those rows (counts verified before commit: 343 to 15, 1098 to 685, 190 to 30). The purge disabled user triggers inside its transaction, which committed that state; I found 69 triggers left disabled and re-enabled them all (73 of 73 enabled, none were disabled beforehand). Leftover counts for this test's fixtures are now 0.

**Handoff.** Next is qa (Phase 5). Browser check: as a founding administrator at a congregation, `/o/<slug>/admin/community?view=staff` lists them with "No position yet", and with `org_portal.staff` on and `staff.manage`, an "Add a position" link. They stay absent from Everyone. No schema, env var, flag or `FEATURES` change.

---

## Added to this fix: the no-organization page copy (operator, production, 2026-10-23)

The operator signed in with an address that was on their person record but not connected to their account. They landed on `/no-organization`, which said "If your church already uses presby, someone there with administrator access can add you. They will need the email address you signed in with." That is not true: a contact email never connects an account (only accepting an invitation does). The page also said "presby" where DECISION-126 requires PresbyPortal.

- **Fix:** `src/app/no-organization/page.tsx` now says "Signing in doesn't connect you to a congregation by itself. You join by opening an invitation link sent to the email address you signed in with. Ask your church administrator to arrange one for: <email>". Every "presby" on the page is now "PresbyPortal".
- **Regression tests:** two cases in `src/app/no-organization/page.test.tsx`. Both failed on the old copy (watched) and pass on the new. `e2e/post-login-routing.spec.ts:84`'s locator was updated to "Read about PresbyPortal".
- **Follow-ups (recorded in TODO at integration):**
  - Auto-connect a verified sign-in to the person whose on-file address matches. This was operator-requested and folds into Community Increment 2b.
  - The platform invitation screen should warn when the invited address is already on a person who signs in. This folds into the multiple-emails pipeline.


---

# Phase 5 — Verification (qa), run 1

*Recorded verbatim.*

**Date:** 2026-10-23
**Verified by:** qa

**Scope run.**
- **In full:** typecheck, lint, `npm run check` (8 tripwires), and the unit suite.
- **DB-backed:** `src/lib/community.db.test.ts` only. No migration, `src/lib/authz.ts`, `src/lib/db/` or shared fixture is in the diff.
- **e2e:** `e2e/community-participants.spec.ts` (which contains the new staff-anchor spec, at desktop and 360px) and `e2e/post-login-routing.spec.ts` (desktop, and 360px through a scratch-only config override). The full suite was not run; the diff touches no proxy, auth, layout, `e2e/support/` beyond one added helper, or shared component.
- **Where it ran:** a `git archive HEAD` scratch copy outside the repo, with APFS-cloned `node_modules`, on a private port (3113).
- **Database:** all DB and e2e runs used the replacement branch `pipeline-fixes-and-nav` (ep-lively-union). Nothing ran against `pipeline-person-emails`, so nothing needed re-running after the coordinator's switch. Community e2e runs were held until no other Playwright run was active.

## Type Check

`npm run typecheck`: PASS. `npm run lint`: PASS. `npm run check`: PASS (all eight tripwires).

## Unit Tests

Total: 9769 | Passed: 7608 | Failed: 0 | Skipped: 2161 (72 files) | Duration: 29s

- The run had no DB env. The 72 skipped files are DB-guarded (79 files carry `skipIf(!hasDb)`), and the diff adds no `.skip` or `.only`.
- 7608 is two more than the work-log's 7606. The difference is the two `/no-organization` cases added in the later commit.
- **DB-backed:** `src/lib/community.db.test.ts` passed 18 of 18 (`--no-file-parallelism`, default 20 s test timeout, 47 s). Its fixtures were torn down: 0 `community-test-%` orgs remain.

## End-to-End Tests

Total: 23 run at desktop+360 (Community 11, post-login 12), plus 12 post-login at 360 | Passed: 31 | Failed: 4 | Duration: 6.0 min + 0.9 min

| Spec | Result |
|---|---|
| `community-participants.spec.ts`, all 11 (both viewports, plus the DECISION-197 degrade) | Pass, counting one re-run |
| New anchor spec `community-participants.spec.ts:250` | Pass at desktop and 360px |
| Visitor spec `community-participants.spec.ts:183` at 360px | Failed once, passed on re-run |
| `post-login-routing.spec.ts:73` (test 2), desktop and 360px | **FAIL** |
| `post-login-routing.spec.ts:209` (test 8), desktop and 360px | **FAIL** |
| Other 10 `post-login-routing.spec.ts` tests | Pass at both viewports |

- **Visitor spec at 360px.** The first run timed out at `:214`; the screenshot shows the search still showing "Searching…" during a dev-server cold compile. On re-run it passed at both viewports, so it is not a defect.
- **`post-login-routing.spec.ts:83`, regression.** `getByText(/ask your church administrator/i)` resolved to 2 elements: the `<h2>Ask your church administrator</h2>` and the new `<p>Signing in doesn't connect…</p>`. Run 1 failed at desktop and run 2 at 360px; the failure is deterministic. With origin/main's `page.tsx` and spec, the same test passes.
- **`post-login-routing.spec.ts:219`, regression.** It asserts `/isn't set up on presby yet/i`, which this diff rewrote to "PresbyPortal". It fails at desktop and 360px and passes with origin/main's page and spec.

## Regression Tests Added

Red/green was checked by swapping origin/main's fix files into the scratch copy, running, then restoring HEAD byte-identically. The worktree was never modified.

- **"each person lands in at least one of the six views…" — `src/lib/community.db.test.ts:507`.** Guards against a live-membership shape that no Community view lists.
  - On origin/main's `community.ts`: **4 failed, 14 passed**, including this test with "staff anchor without a position: expected [] to not deeply equal []".
  - The work-log records 3 failed and 15 passed. The fourth failure is "counts, search and order stay coherent", whose search for "Kit" returns `[]` before the fix. That is the right reason to fail.
  - On HEAD: 18 of 18 pass. Confirmed red then green.
- **"Staff: an anchor with no position reads 'No position yet'…" — `members-list.test.tsx:155`.** Guards the anchor row's note and the link gate. Fails on origin/main's row components and passes on HEAD. Confirmed.
- **"says signing in alone does not connect you…" — `src/app/no-organization/page.test.tsx:32`.** Fails on origin/main's page and passes on HEAD. Confirmed.
- **"names the product PresbyPortal, not presby" — `page.test.tsx:40`.** Fails on origin/main's page and passes on HEAD. Confirmed.
- **e2e anchor spec — `e2e/community-participants.spec.ts:250`.** Passes on HEAD. I did not run it against the pre-fix reader; the DB invariant test above gives the red/green evidence for this behaviour.

## Coverage on Critical Modules

Not measured. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`, so this is deferred to the release-slot test-coverage review.

## Feature-Gate Audit

No API route or server action was added or changed. This was checked by reading the files.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `listRows("staff")` via `listStaff`, `src/lib/community.ts:152-155` | n/a, tenant reader | n/a: `canManagePeople` (`people.manage`) inside `withOrgContext`, on the RLS `db` connection, unchanged | n/a (tenant axis) |
| "Add a position" link, `community-rows-list.tsx:78-95` | n/a | Shown only when `canStaffLink` (`page.tsx:199-201`: flag `org_portal.staff` and `staff.manage`) | n/a (tenant axis). Same gate the Staff page enforces on the server (`admin/staff/page.tsx:101`, plus the `staff.manage` reader). The link is a convenience, not the guard |

`listStaff` has one caller, the Community page. The public staff listing goes through `src/lib/staff.ts`, which is not in the diff, so the widened predicate cannot surface anchors publicly.

**Unchanged-behaviour checks.**
- `src/lib/directory.ts` and the Directory pages are not in the diff.
- The invariant test asserts the anchor appears in `["staff"]` only, never in Everyone, Members or Participants.
- The e2e anchor spec asserts it is absent from Everyone at both viewports. DECISION-129 holds.

**Copy truthfulness (asked to check). The new paragraph over-claims.**
- **True:** "Signing in doesn't connect you". `presby_accept_invitation` is the only writer of `people.user_id`.
- **True:** "an invitation link sent to the email address you signed in with". Existing-account acceptance returns `email_mismatch` on a different address (`drizzle/0059_presby_account_invitations.sql`, `lower(v_user_email) <> v_inv.email_normalized`).
- **Not true:** "Ask your church administrator to arrange one". Invitations are issued only by a platform operator from `(admin)` (`src/lib/onboarding/issue.ts`, `getPlatformDb()` only). `account_invitations.purpose` is CHECK-limited to `founding_administrator` or `treasurer`. A church administrator cannot issue or arrange an invitation for an ordinary member, and no other join path exists today. The page tells exactly the person it is for, an ordinary member, to take a step that cannot happen.
- **Minor:** when `session.user.email` is null the sentence ends "…arrange one for." with no object.

**Schema/RLS audit:** not applicable, no schema change.

**Auth-touching gate:** not triggered. The diff touches no `src/auth.ts`, `(auth)`, `api/auth` or `src/lib/auth/`.

**Hygiene.**
- 0 of 73 user triggers disabled before and after my runs.
- My fixtures were swept by spec teardown. One `E2ECommunity SpecDPart` row seen at the end was created at 18:17:23 UTC, five seconds before my check. It belongs to another agent's `community-participants.spec.ts` run that started after mine finished, so I left it alone.
- The scratch copy is removed and the worktree is clean.

## Verdict

**FAIL.** Return to full-stack-developer (Phase 4).

1. `e2e/post-login-routing.spec.ts:83`: strict-mode violation caused by the new copy. Fix either the locator (for example, the heading role) or the copy.
2. `e2e/post-login-routing.spec.ts:219`: a stale "presby" locator the rename broke.
3. `src/app/no-organization/page.tsx:159-161`: the copy directs ordinary members to an invitation route that church administrators cannot provide. The wording should be settled with the operator (it is product copy), then pinned by the unit test. The null-email "…for." ending should be fixed in the same change.

The Community staff-anchor fix passes on its own: unit, DB invariant (red then green confirmed), e2e at both viewports, the link gate, and DECISION-129 unchanged. After the fix, re-verification can be limited to `post-login-routing.spec.ts` (desktop and 360px) and `src/app/no-organization/page.test.tsx`.

---

**Per-Phase Status row**

| 5 — Verification | qa | Complete | FAIL | 2026-10-23 |

**Handoff:** to full-stack-developer (Phase 4), citing `e2e/post-login-routing.spec.ts:83`, `e2e/post-login-routing.spec.ts:219` and `src/app/no-organization/page.tsx:159-161`. The finding about who can issue an invitation needs an operator wording decision before the copy is rewritten. Escalating to tech-lead is not needed; there is no design flaw.

## Fix after run 1 (orchestrator, 2026-10-23)

- The paragraph now states only what is true today: "Signing in doesn't connect you to a congregation by itself. Only an invitation link does, and it works while you are signed in with the address it was sent to. You are signed in as <email>." It contains no instruction to ask anyone to arrange an invitation, and with no email the sentence ends cleanly.
- `e2e/post-login-routing.spec.ts:219` now expects "PresbyPortal". The paragraph no longer contains "Ask your church administrator", so `:83` resolves to the heading alone.
- `page.test.tsx` gained a no-email case and asserts that neither "arrange" nor "can add you" appears. 4/4 pass.
