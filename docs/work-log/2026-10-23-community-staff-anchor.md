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
| 4 — Implementation | full-stack-developer | In progress | — | — |
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
