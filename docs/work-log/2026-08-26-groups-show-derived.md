# Groups page shows the derived groups (read-only) — Work Log

> **Slug:** `2026-08-26-groups-show-derived`
> **Surface:** (org) — `/o/<slug>/admin/groups`
> **Permission(s):** existing `groups.manage` covers this (read-only rows on an already-gated page)
> **Flag(s):** existing `org_portal.groups` covers this
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — operator-requested refinement of a feature that completed its full pipeline earlier the same day (`2026-08-26-groups-admin`); Phase 2 skipped (no new deps, no structural change — a read-surface addition inside the existing module's own gate). Operator's words: "should groups show the dynamic groups? of officers? i think it should."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (operator-directed) | Complete | Scope: derived groups appear as clearly-labeled read-only rows; management still lives on the Officers page; zero new write paths | 2026-08-26 |
| 2 — Architectural review | architect | Skipped | No new deps, no structural change — a read-surface addition inside the existing module's own gate (per header) | 2026-08-26 |
| 3 — Technical design | full-stack-developer (brief, no separate tech-lead pass — accelerated increment) | Complete | Design complete, self-implemented | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The Groups list should let an admin see the org's whole group picture —
> managed committees plus Session/Board of Deacons/Active Membership — in
> one place, with the derived rows visibly read-only and pointed at the
> Officers page, not editable here.

## Flows

**Flow — View the full group picture:** entry `/o/<slug>/admin/groups` →
existing managed-group `Table` renders as before → a new, clearly-labeled
"Automatic rosters" section below it lists the org's derived groups (name,
type, current member count) → session/diaconate rows link to
`/o/<slug>/admin/officers` (the surface that actually manages them);
Active Membership shows a short note instead, since it derives from the
roll with no management surface of its own.
- Failure: `listDerivedGroups` throws a non-`OrgAccessError` → the page's
  existing load-error state, same as a `listGroups` failure.

## Permissions & Flags

- **Permission(s):** existing `groups.manage` — the new read export is
  gated by the identical `hasGroupsManage` check as every other export in
  the module, no new permission.
- **Flag(s):** existing `org_portal.groups` — no new flag; this is a
  read-addition to an already-flagged page.

## Out of Scope (confirmed)

- Any new write path onto a derived group or its memberships — zero.
- Rendering a derived group's own roster/detail page — `[groupId]/page.tsx`
  still 404s a derived id via `getGroup`'s managed-only scope, unchanged.
- A per-derived-group "view roster" surface beyond the list-page counts —
  the Officers page already owns that view for session/diaconate; Active
  Membership has no dedicated admin view today and this increment doesn't
  add one.

---

# Phase 2 — Architectural Review (architect)

**Skipped** — no new dependency, no new directory, no structural or
server/client-split change: the addition is one new read export inside an
existing, already-reviewed module (`src/lib/groups.ts`), gated by the
permission and flag that module already established (DECISION-110), and
two new components/branches inside the existing `groups/page.tsx` and
`groups-list.tsx` files. Per CLAUDE.md's Classification table, this is
Polish/visual-adjacent (read-surface addition, no schema, no API surface
change beyond a new exported function) and Phase 2/3 may be skipped with
explicit notation — recorded here.

---

# Phase 3 — Technical Design (full-stack-developer, brief)

## Summary

Add `listDerivedGroups(viewerPersonId, organizationId)` to `src/lib/
groups.ts`, shaped exactly like `listGroups` (same `withOrgContext()` +
`hasGroupsManage` gate, same `getPlatformDb()` group-type-name lookup
pattern) but querying `membership_source = 'derived'` instead of
`'managed'`, returning each group's `derivedFrom` key alongside its name/
type/member-count. Render the result in a new `DerivedGroupsList` component
(co-located in `groups-list.tsx`) under a labeled "Automatic rosters"
heading on the existing `/o/<slug>/admin/groups` page, below the managed
`GroupsList` table. `session`/`diaconate` rows link to `/o/<slug>/admin/
officers`; `active_membership` rows show a short explanatory note instead
of a link, since it has no dedicated management surface.

## API Contract

- `listDerivedGroups(viewerPersonId, organizationId): Promise<GroupsResult<DerivedGroupListEntry[]>>` — every `membership_source = 'derived'` group at this org, `DerivedGroupListEntry = { groupId, name, groupTypeName, memberCount, derivedFrom: "session" | "diaconate" | "active_membership" }`. Same `GroupsResult` union as every other export; `forbidden` on the same gate.

## Data Model

No schema changes — `groups.derived_from`/`membership_source` already carry
everything this read needs (DECISION-110's schema, unchanged).

## Component / Page Plan

- `src/lib/groups.ts` — new `listDerivedGroups` export + `DerivedGroupListEntry`/`DerivedFromKey` types.
- `groups/page.tsx` — calls `listDerivedGroups` (only once `listGroups` has
  already resolved `ok`, to avoid a redundant read on a forbidden/error
  page) and renders `<DerivedGroupsList>` below `<GroupsList>`.
- `groups/groups-list.tsx` — new `DerivedGroupsList` export, same file as
  the existing `GroupsList` (both render the same page's two sections from
  the same module).

## Implementer

full-stack-developer (this increment) — small, tightly coupled read-only
addition spanning `src/lib/groups.ts` and its one consuming page/component,
matching this agent's own scope bar.

---

# Phase 4 — Implementation

## Files Created

None — every change is additive inside existing files.

## Files Modified

- `src/lib/groups.ts` — new `listDerivedGroups` export (+ `DerivedFromKey`/
  `DerivedGroupListEntry` types), reusing the existing private
  `hasGroupsManage` gate and `groupTypeNamesByIds` platform-template
  lookup. Read-only: queries `membership_source = 'derived'`, never joins
  or filters toward a write. Module header's "THIS MODULE NEVER TOUCHES A
  DERIVED GROUP" line corrected to "NEVER WRITES TO" for accuracy, since a
  read export now legitimately does touch (read) one.
- `src/lib/groups.test.ts` — new `describe("listDerivedGroups — ...")`
  block: forbidden gate, an `ok` case asserting both derived rows'
  `derivedFrom`/type-name/member-count (Active Membership's count is a real,
  nonzero number here — a fixture membership insert's own `active_membership`
  trigger side effect, asserted rather than assumed away as zero), and a
  cross-org isolation case proving another org's identically-named derived
  group never leaks in.
- `src/app/(org)/o/[slug]/admin/groups/page.tsx` — after `listGroups`
  resolves `ok`, calls `listDerivedGroups` (same `OrgAccessError`
  re-throw / load-error contract) and renders `<DerivedGroupsList>` below
  `<GroupsList>`.
- `src/app/(org)/o/[slug]/admin/groups/page.test.tsx` — existing "ok"
  branch tests updated to mock `listDerivedGroups`; new tests cover the
  ordering (`listDerivedGroups` not called when `listGroups` is forbidden),
  the rendered section + Officers link, and its own load-error branch.
- `src/app/(org)/o/[slug]/admin/groups/groups-list.tsx` — new
  `DerivedGroupsList` export: renders nothing when there are no derived
  groups (there always are three at a real org, so an empty result here
  means the read failed, not "nothing to show" — `page.tsx`'s load-error
  branch is the right place for that); otherwise a labeled "Automatic
  rosters" `Table` (Name / Type / Members / Managed from). `session`/
  `diaconate` rows link to `/o/<slug>/admin/officers`; `active_membership`
  shows "The membership roll" as plain text, no link. No edit link, no
  add-member form, no end-membership action anywhere in this component.
- `src/app/(org)/o/[slug]/admin/groups/groups-list.test.tsx` — new
  `describe("DerivedGroupsList", ...)` block: empty-input renders nothing;
  a populated case asserts the section heading, all three rows' text, and
  that exactly two "Officers" links exist (session + diaconate) with the
  correct href, plus the read-only-guard test asserting no edit link / add-
  member button / end-membership button exists anywhere in this section.
- `docs/TODO.md` — Done line added for this increment.
- `docs/product/functionality-map.md` — Groups sentence updated to mention
  derived groups now being visible, read-only, on the same list page.

## Schema Changes

None.

## Audit Events

None — read-only addition, no mutation, nothing to audit.

## Feature Gates

- `org_portal.groups` — unchanged, still gates the whole page.
- `groups.manage` — unchanged, still gates `listDerivedGroups` via the same
  `hasGroupsManage` check every other export in the module already uses.

## Test Results

- `npm run typecheck` — clean.
- `npm test` (mocked suite) — 182/201 test files passed (19 real-DB files
  correctly skipped via `hasDb`), 2497 tests passed, 0 failed.
- `npx dotenv -e .env.local -- vitest run src/lib/groups.test.ts` — 33/33
  passing against the real shared dev database (30 pre-existing + 3 new).
- `npm run check` (all four tripwires) — clean.

## Live Verification (real browser, 360×800, Playwright driving Chromium)

Signed in via `/tmp/state.json`'s seeded session against the running dev
server (`localhost:3000`), navigated to `/o/fpcw/admin/groups` (fpcw has no
managed committees yet, but three real, seeded derived groups). Confirmed:
- "Automatic rosters" section renders below the managed-groups empty state,
  with the exact copy "Generated automatically from officer terms and the
  membership roll. Read-only here — manage who serves from the Officers
  page."
- Table shows all three real rows: Active Membership (Roster, 18 members,
  "The membership roll" note, no link), Board of Deacons (Court, 2 members,
  "Officers" link), Session (Court, 0 members, "Officers" link).
- All three "Officers" links resolve to `/o/fpcw/admin/officers` (confirmed
  via `getAttribute("href")`, not just visually).
- At 360px the table's own `overflow-x-auto` wrapper (shadcn `Table`,
  unmodified) makes the "Managed from" column reachable by horizontal
  scroll (`scrollWidth` 430 vs `clientWidth` 312, confirmed via evaluate +
  a scrolled screenshot) — the same acceptable pattern the existing managed
  `GroupsList` table already uses for its own narrower column set; no
  action column exists here to protect the way `officer-roster.tsx`'s
  history required, since every derived row's own action is a link, not a
  button.
- No console errors, no `pageerror` events, during the full walkthrough.
- `org_portal.groups` was already `true` in the shared dev DB from this
  session's own precedent (left on for operator testing) — no flag change
  needed or made for this check.

## Implementer Notes

- `listDerivedGroups` deliberately stays a SEPARATE query/export from
  `listGroups` rather than one query returning both kinds in a tagged
  union — so the two result shapes can never be accidentally fed into
  `updateGroup`/`addGroupMember`/`endGroupMembership`, all three of which
  independently re-check `membership_source = 'managed'` regardless. This
  increment adds zero new write paths and does not touch any part of "The
  Court Is Not a Group"'s enforcement (CLAUDE.md; DECISION-110) — confirmed
  by re-reading `updateGroup`/`addGroupMember`/`endGroupMembership`'s
  existing scoping, unchanged by this commit.
- The real dev-DB test initially asserted Active Membership's member count
  as `0`; it's actually a real, nonzero count (4 in the isolated fixture,
  18 at fpcw) because every ordinary `memberships` insert fires
  `presby_sync_derived_membership_group()` (drizzle/0017) as a side effect
  — caught by running the suite against the real database, corrected to
  assert the real value rather than assume it away.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS (clean, no errors)

## Unit Tests

Total: 2925 | Passed: 2497 | Skipped: 428 (real-DB-gated via `hasDb`, expected) | Failed: 0. Test Files: 182 passed, 19 skipped — matches the implementer's reported figures exactly.

Real-DB run reproduced independently: `npx dotenv -e .env.local -- npx vitest run src/lib/groups.test.ts` → 33/33 passed. All three new cases confirmed present and substantive (`src/lib/groups.test.ts:601-654`): forbidden gate, ok-case asserting `derivedFrom`/type-name/nonzero `activeMembership` count (real trigger side-effect, not assumed away), cross-org isolation by id not name.

## End-to-End Tests

Not applicable — no auth-touching surface, no new e2e required for this read-only increment. Implementer's live-browser walkthrough is corroborated in specifics (exact copy strings, real row counts, scroll measurements) rather than a generic claim — accepted as adequate manual smoke for this class of change.

## Regression Tests Added

- "renders NO edit/add-member/end-membership affordance for any derived row — read-only guard" (`groups-list.test.tsx:106-138`) — guards against a future edit silently adding a write control to the derived section. Verified as a real assertion, not vacuous.
- "listDerivedGroups — cross-org isolation" (`groups.test.ts:641-653`) — guards against an org-scoping regression on the new query.
- "listDerivedGroups — forbidden for a person holding no groups.manage" (`groups.test.ts:601-604`) — guards the permission gate.

## Coverage on Critical Modules

Not applicable — `permissions.ts`/`two-factor.ts`/`flags.ts` unaffected by this diff.

## Feature-Gate Audit

| Route or action | `auth()`/session present? | Permission gate present? | Correct key? |
|---|---|---|---|
| `listDerivedGroups` (`groups.ts:298-338`) | yes | yes — `hasGroupsManage` called first, identical to every other export | `groups.manage` |
| `updateGroup` (`groups.ts:616`) | yes | yes, unchanged | scoped `membership_source='managed'` at `groups.ts:633` — not loosened |
| `addGroupMember` (`groups.ts:696`) | yes | yes, unchanged | scoped `'managed'` at `groups.ts:724` — unchanged |
| `endGroupMembership` (`groups.ts:806`) | yes | yes, unchanged | scoped `'managed'` at `groups.ts:829` — unchanged |
| `groups/page.tsx` | yes, full `(org)` auth pattern | yes | `org_portal.groups` flag + `groups.manage` |
| `[groupId]/page.tsx`, `[groupId]/edit/page.tsx` | unchanged | unchanged — `getGroup` still filters `'managed'` (`groups.ts:389`), derived id → `invalid_target` → `notFound()` (spot-checked current code) | n/a, correct |

## Verdict

**PASS**

The zero-new-write-paths property genuinely holds: `listDerivedGroups` is SELECT-only, gated identically to its siblings, and all three write functions still independently re-scope to `membership_source = 'managed'` unchanged from the parent pipeline. The UI has no edit/add/end affordance for derived rows and a dedicated regression test asserts this. `[groupId]` routes still 404 a derived id. All reported test numbers reproduced independently and matched exactly.

**Handoff:** analyst (Phase 6 — Shipped vs Intent).

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The operator asked a yes/no question ("should groups show the dynamic groups?") and got exactly that: a labeled, read-only "Automatic rosters" section that shows all three derived groups, explains itself before the user can ask "why can't I edit this," and points session/diaconate at the one page that actually manages them.

## What's Working

- The copy pre-empts the question: "Read-only here — manage who serves from the Officers page" answers "why can't I edit this" in the same sentence a volunteer reads the section heading, not after a failed click on a missing edit button.
- `active_membership` gets an honest, self-contained explanation ("The membership roll") instead of a dead-end link or an empty cell — correctly distinguishes "no management surface exists" from "here's where to go."
- The empty-vs-error distinction in `DerivedGroupsList` (render nothing when empty, because a real org always has three rows, so empty means the read failed) is genuinely careful design reasoning — it routes the actual failure case to the page's existing load-error branch rather than a misleading "no automatic rosters yet" card.
- Zero new write paths, verified three independent ways (no edit/add/end affordance + a regression test asserting so; the three write functions still scope to `'managed'` only; `[groupId]` routes still 404 a derived id) — "The Court Is Not a Group" untouched.

## Intent-vs-Shipped Diff

- Phase 1 said: derived groups appear as clearly-labeled read-only rows, session/diaconate link to Officers, Active Membership shows a note instead of a link, permission/flag unchanged, zero new write paths. Shipped: exactly this, verified live at fpcw with real seeded data and confirmed hrefs via `getAttribute`, not visual inspection alone. **Matches.**
- Phase 1 named the derived detail/roster surface as explicitly out of scope. Shipped respects it — no such surface was added. **Matches.**

## Edge Cases

- Empty state: pass — empty render = error signal, correctly reasoned (a real org always seeds all three derived groups).
- Failure microcopy: pass — reuses the page's existing load-error state.
- Permission gate: pass — `hasGroupsManage` identical to every other export, independently confirmed by QA.
- Audit event: not applicable — read-only.
- Mobile (360px): pass — live-verified with actual scroll measurements, not assumed.

## Follow-Ups (if SHIP WITH NOTES)

None — SHIP IT. The parent pipeline's deferred what's-new advisory already covers this increment (both ship behind the same seeded-off `org_portal.groups` flag); Rule 12 not applicable (operator instruction, not in-app feedback).
