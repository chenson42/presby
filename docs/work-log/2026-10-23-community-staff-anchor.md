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
| 5 — Verification | qa | Pending | — | — |
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
