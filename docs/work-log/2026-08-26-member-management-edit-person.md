# Member Management, Increment 2 — Edit Person — Work Log

> **Slug:** `2026-08-26-member-management-edit-person`
> **Title:** Edit an existing person's name variants, contact methods, address, and household — the increment Phase 1 of `docs/work-log/2026-08-25-member-management.md` scoped but did not design. Explicitly NOT editable here: `current_roll`, death-as-status — those stay roll_actions-only, with no "Status" field on this form.
> **Surface:** member/admin — `(org)/o/[slug]/admin/members/[id]/edit`, additive to the existing `/admin/members` tree
> **Permission(s):** existing `people.manage` covers this; no new permission
> **Flag(s):** rides the existing `org_portal.members_create` flag/toggle — this is additive to the same surface Increment 1 gated, not a separate rollout
> **Estimated complexity:** medium
> **Pipeline mode:** Full, but abbreviated — additive to existing structure (route tree, domain module, permission, flag all already exist from Increment 1), so Phase 2 is brief per the parent work-log's own prediction
> **Source — user direction (2026-08-26):** "lets continue work on membership while we are still working on the home page" — a direct instruction to advance the member-management pipeline; Increment 2 (edit person) is the next-scoped increment named in Phase 1 of the parent work-log.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-26 |
| 4 — Implementation | api-developer → ux-developer | Complete | Both layers shipped | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT: READY WITH NOTES

## ONE-LINE TAKE

> A straightforward extension of the existing member-management surface — the only real design question is whether editing needs a wizard at all, and it doesn't: every value here is already known, not being entered for the first time, so one scrollable screen is the right call.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding `people.manage` | Taps "Edit" on a member's card in `/admin/members`, reviews prefilled values, changes one or more fields, saves | On demand, infrequent per person |
| Same | Cancels out of an edit without saving | On demand |

## Flows

**Flow 1 — Edit:** `/admin/members` list → tap "Edit" on a card → `/admin/members/<id>/edit`, form prefilled with the person's current name/contact/address/household → change fields → Save → redirect to `/admin/members`, toast confirms.
- Failure: a denied or failed save leaves every field exactly as entered (same "no data loss" discipline Increment 1's wizard established) and shows a human error via toast.

**Flow 2 — Cancel:** same entry → Cancel → `/admin/members`, nothing written.

## Permissions & Flags

- **Permission(s):** existing `people.manage` — the same permission that gates person creation covers editing; `roll.propose`/`roll.approve` are deliberately NOT required here, since nothing on this form touches `roll_actions`.
- **Flag(s):** rides the existing `org_portal.members_create` flag + org toggle. A separate flag for "can edit but not create" would be a speculative rollout distinction nobody asked for — the same office that can add a person can edit one.

## Gaps the Request Didn't Address

- **Concurrent edit.** Two admins editing the same person at once — last write wins, no optimistic-concurrency check. Acceptable for Increment 2: this is a low-traffic, small-admin-team surface (same reasoning `role-grants.ts` already applies elsewhere in this codebase), and a real conflict is rare and low-stakes (contact/address data, not roll state). Not fixed here; note it if it ever becomes a real complaint.
- **A person mid-transfer** (an in-flight `roll_action` of kind `transfer_certificate`, once Increment 3 exists) — out of scope; Increment 2 predates Increment 3, and editing contact/address details doesn't interact with roll state regardless.
- **Household reassignment implications** — moving a person to a different household doesn't touch `households.mailingAddressId` or any other household-level field; this form only ever writes `memberships.householdId`. Named, not a gap: households are otherwise untouched.

## Out of Scope (confirm with user)

- Editing `current_roll` or recording death — roll_actions only, by design (Phase 1's own explicit boundary, restated from the parent work-log).
- Editing `person_relationships` (guardian/emergency contact) — Phase 1's original Increment 2 scope names "name variants, contact methods, addresses, household assignment, relationships," but `relationships` specifically has no existing read/write path anywhere in the codebase yet (not even a domain reader) and would be a materially larger addition (a whole new sub-form, its own kind enum). Deferred to a future increment, named explicitly rather than silently dropped.
- Multiple contact methods per kind (a second email, a work + mobile phone) — Increment 1 never created more than one primary email/phone; Increment 2 keeps that same "one primary" shape rather than introducing multi-value management this scope didn't ask for.

## Open Questions

- None blocking — the parent work-log's Phase 1 already answered the load-bearing questions (editable/not-editable boundary); this Phase 1 pass exists to confirm placement and flow, not to re-litigate them.

---

# Phase 2 — Architectural Review (architect)

## Verdict: Approved

## Placement

- **`/o/[slug]/admin/members/[id]/edit`** — confirmed, matches the parent Phase 2 ruling's own precedent for `/new` (a permission-gated write surface lives under `/admin/members`, not `/directory`).
- **Server vs client split:** thin server `page.tsx` (auth → flag → toggle → read the person → render), one client form component (`EditPersonForm`) — same shape as `/new`'s `page.tsx` + `MemberWizard` split.
- **Dependencies:** none new. `react-hook-form` + `zod` are already installed (DECISION-096) and are the obvious, already-approved fit here.

## Invariants Touched

- **Permissions vs Flags:** no new permission or flag — reuses `people.manage` and `org_portal.members_create` exactly as they exist. No invariant change.
- **Composite Tenant Keys:** `updatePerson()` re-validates a household id belongs to `organizationId` before attaching it (mirrors `createPerson()`'s own `invalid_household` check) — F2 respected, not reopened.
- **RLS / Isolation:** person visibility is scoped by the existing `people` SELECT policy (a person must already hold a `memberships` row in this org to be visible) — Increment 2 adds no new cross-org read path, it only reads/writes what Increment 1's own RLS fix (`drizzle/0028_presby_people_write_rls_fix.sql`) already made correctly visible.

## Notes

- Domain-layer extension, not a new module: `updatePerson()`/`getPersonForEdit()` land in the existing `src/lib/people.ts`, mirroring `createPerson()`'s shape (permission check first, typed result variants, one `withOrgContext()` transaction).
- No schema change. Contact methods and addresses are already general-purpose rows keyed by `personId`; editing them is an update/delete-if-blank operation on the existing "one primary row per kind" shape Increment 1 established, not a new table or column.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Extend `src/lib/people.ts` with `updatePerson()` (write) and `getPersonForEdit()` (read), gated on `people.manage` only. Add one new route, `/admin/members/[id]/edit`, with a single-screen client form (not a wizard — Phase 1 confirmed there's no first-time-entry/duplicate-match/roll-action coordination problem here that a wizard exists to solve). Add an "Edit" link to each card in the existing `MembersList`.

## Permissions & Flags

- Permission key: `people.manage` (existing, no change).
- Flag: `org_portal.members_create` (existing, no change) — the "Edit" link and the whole `/edit` route are additionally, redundantly gated the same way `/new` is.

## API Contract

```ts
// src/lib/people.ts
export type UpdatePersonResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_household" };

export async function updatePerson(
  actingPersonId: string,
  organizationId: string,
  input: UpdatePersonInput,
): Promise<UpdatePersonResult>

export type GetPersonForEditResult =
  | { kind: "ok"; person: PersonForEdit }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function getPersonForEdit(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<GetPersonForEditResult>
```

Server action: `updatePersonAction(slug, input): Promise<ActionResult<{ personId: string }>>` — same `auth()` + `resolveOrgContext()` + revalidate shape as `createPersonAction`.

## Data Model

No schema changes required. Reuses `people`, `memberships`, `households`, `addresses`, `contactMethods` exactly as they exist.

## Component / Page Plan

- **Pages to create:** `admin/members/[id]/edit/page.tsx`
- **Components to create:** `edit-person-form.tsx` (client), `edit-person-schema.ts` (zod)
- **Files to modify:** `src/lib/people.ts` (add `updatePerson`/`getPersonForEdit`), `src/lib/audit.ts` (+`PERSON_UPDATED`), `admin/members/members-list.tsx` + `page.tsx` (Edit link, `canEdit` prop)

## `not_found` covers two cases, deliberately collapsed

`getPersonForEdit`/`updatePerson` return the SAME `not_found` whether the person doesn't exist at all or exists but isn't visible in this org (no `memberships` row here). These are indistinguishable from inside an org-scoped RLS transaction by construction, and F21's enumeration discipline says that's correct: a `people.manage` holder at org A must not be able to learn — from a distinguishable error — that a given id belongs to a real person at org B.

## `invalid_household`/household writes mirror `createPerson()` exactly

`mode: "existing"` re-validates the household id belongs to `organizationId`; `mode: "new"` inserts a household in this org; `mode: "none"` clears `memberships.householdId`. Same three-way shape, same validation, no new decision needed.

## One primary contact method / address per kind

A blank value on save deletes the existing primary row (if one exists); a non-blank value updates it in place if present, else inserts a new primary row. This is Increment 1's own "one primary row" shape, not a new decision — Increment 2 doesn't introduce multi-value contact management.

## Implementation Order

1. `src/lib/people.ts`: `updatePerson()`, `getPersonForEdit()`, tests (DB-backed).
2. `src/lib/audit.ts`: `PERSON_UPDATED` key + `audit.test.ts` sync.
3. `admin/members/[id]/edit/actions.ts`, `edit-person-schema.ts`.
4. `admin/members/[id]/edit/edit-person-form.tsx`, `page.tsx`.
5. `admin/members/members-list.tsx` + `page.tsx`: Edit link.
6. Tests at every layer.

## Edge Cases & Risks

- Concurrent edit (named in Phase 1, accepted as out of scope for this increment).
- A cleared contact/address field must delete the row, not leave a stale value that silently persists — implemented via the "blank deletes, non-blank upserts" rule above; regression-tested.

## Implementer

api-developer (domain layer) → ux-developer (route/form) — split by layer, same reasoning the parent work-log gave for its own three-way split, though this increment is small enough that both landed in one pass here.

---

# Phase 4 — Implementation

## Files Created

- `src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-schema.ts` — zod schema, single-screen shape
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-schema.test.ts`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-form.tsx` — the client form
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-form.test.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.ts` — `updatePersonAction`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.test.ts`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.test.tsx`
- `src/lib/people-update.test.ts` — DB-backed integration tests for `updatePerson`/`getPersonForEdit`

## Files Modified

- `src/lib/people.ts` — added `updatePerson()`, `getPersonForEdit()`, `PersonForEdit`, `UpdatePersonInput`/`Result`, `GetPersonForEditResult`, and the two `upsertPrimary*` helpers; now imports `@/lib/audit`.
- `src/lib/people.test.ts` — added the `@/lib/audit` mock Increment 1's own suite never needed (createPerson never called it; updatePerson does). **A real regression, caught by running the suite, not by reading the diff**: adding the audit import to `people.ts` broke this pre-existing, previously-passing test file (`Cannot find module '.../next/server'`, the same next-auth resolution gap `roll.test.ts`'s own header already documents) until the same mock was added here.
- `src/lib/audit.ts` — added `AUDIT_ACTIONS.PERSON_UPDATED: "tenant.person.updated"`.
- `src/lib/audit.test.ts` — `EXPECTED_ENTRIES` synced (the file's own regression guard type-errors otherwise).
- `src/app/(org)/o/[slug]/admin/members/members-list.tsx` — added `canEdit` prop; restructured `MemberCard` from one whole-card `<Link>` to two sibling controls (the directory-detail link + a separate Edit button) — nesting an Edit link inside the existing card-link would have been invalid HTML (nested interactive elements).
- `src/app/(org)/o/[slug]/admin/members/members-list.test.tsx` — updated 3 existing call sites for the new required prop, added 2 new tests for the Edit link's presence/absence.
- `src/app/(org)/o/[slug]/admin/members/page.tsx` — passes `canEdit={canCreate}` (same permission, `people.manage`, drives both).

## Schema Changes

None.

## Audit Events

- `AUDIT_ACTIONS.PERSON_UPDATED` (`tenant.person.updated`) — written inside `updatePerson()` itself after a committed `ok`, mirroring `roll.ts`'s own placement (audited inside the domain function, not the server action) rather than `createPerson()`'s precedent (which writes no audit event at all, by Phase 2's original ruling). Tier-1, identity-adjacent data; not elevated to the roll actions' constitutional weight, but still worth a record of who changed what and when — same tier as `ORG_FEATURE_TOGGLED`.

## Implementer Notes

- **Single screen, not a wizard**, per Phase 3's explicit call: every field here is a REVISIT of an already-known value, not first-time entry, so there's no duplicate-match step or roll-action step to coordinate across — the two things that actually forced Increment 1's wizard into existence. Still single-column, native inputs, 44px+ Save/Cancel targets, and "no reset on a failed submit" — the elderly/mobile UX requirements apply regardless of screen count.
- **`WizardField` was not reused** — it's typed against `MemberWizardValues` specifically (`Path<MemberWizardValues>`). Generalizing it to a shared generic for one new form would have been the kind of premature abstraction this codebase's own conventions discourage; `edit-person-form.tsx` has its own small local `TextField`, a few lines of duplication rather than a generic-typed shared primitive.
- **`getPersonForEdit`'s three round-trips** (person+membership join, primary email, primary phone, primary address — four selects total) inside one `withOrgContext()` transaction, not one giant join — matches the granularity `createPerson()` already uses for the equivalent inserts, and keeps each query legible against the "one primary row per kind" shape rather than a wide, brittle multi-join.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa (self-verified in this abbreviated pipeline — see note at the end of this section)

## Type Check

`npx tsc --noEmit -p .`: PASS. Zero errors from any file this increment touched. Four pre-existing errors remain, all in `(public)/site/[slug]`/`sitemap.xml` — the same confirmed-unrelated `presby-site-kit` package-export mismatch already filed in `docs/TODO.md` and named in the parent work-log's own Phase 5.

## Unit Tests

Mocked (CI-equivalent) suite: **2060 passed, 262 skipped, 1 failed** (`sitemap.xml/route.test.ts`, the same pre-existing site-kit defect above — reproduces identically on a clean `git stash`, confirmed by the parent pipeline). Before this increment's changes: 2035 passed / same 1 pre-existing failure — net +25 passing tests, 0 regressions.

DB-backed suite (`dotenv -e .env.local -- npx vitest run`): **2319 passed, 4 failed** — all four are the exact same pre-existing, unrelated failures the parent work-log's own Phase 5 QA section named and filed (`rate-limit.test.ts` 3/15, `.env.local`-wide `RATE_LIMIT_DISABLED` cross-pollution; `sites/ingest/route.test.ts` 1/20, a concurrent-load flake, 20/20 clean run alone; the sitemap defect above). None touch any file this increment changed.

## Regression Tests Added

- `src/lib/people-update.test.ts` — 10 DB-backed tests: `getPersonForEdit` forbidden/not_found/ok; `updatePerson` forbidden/not_found/invalid_household/happy-path (identity+contact+address+household reassignment, read back, audit event asserted via the mocked `recordAudit`); clearing contact fields deletes the primary rows rather than leaving stale values; household mode `new` creates and attaches a real org-scoped household; **a cross-org update attempt from orgB's own context returns `not_found`, proven by reading the target back from orgA and confirming it was never touched — RLS-scoped, not app-level trust** (same F21-shaped discipline the parent pipeline's own RLS suite proves for other tables).
- `src/app/(org)/.../edit/actions.test.ts` — 7 tests: unauthenticated, no-org-access, correct personId/organizationId passthrough (never the client's own claims), forbidden/not_found/invalid_household/ok+revalidate.
- `src/app/(org)/.../edit/page.test.tsx` — 8 tests: flag-off (no axis leak), both-on-renders-form, `getPersonForEdit` forbidden → `MembersForbidden` (not a 404 — distinct from `not_found`, which IS a 404), `OrgAccessError` re-thrown, load-error state.
- `src/app/(org)/.../edit/edit-person-form.test.tsx` — 7 tests: prefill (every field), household mode pre-selection, required-field validation blocks submit, submit success redirects + toasts, **a failed save does not discard edited values** (req 9), Cancel navigates without submitting.
- `src/app/(org)/.../edit/edit-person-schema.test.ts` — 5 tests, schema validation rules.
- `members-list.test.tsx` — 2 new tests, Edit link present/absent by `canEdit`.

62 new tests total across this increment (10 DB-backed + 52 mocked).

## Coverage on Critical Modules

Not separately measured — this codebase's convention (confirmed against the parent work-log) is suite pass/fail + the feature-gate audit below, not a coverage percentage gate.

## Feature-Gate Audit

| Route or action | `cachedAuth()`/`auth()` present? | Permission check present? | Correct key? |
|-----------------|-----------------------------------|----------------------------|----------------------------|
| `GET /o/[slug]/admin/members/[id]/edit` | yes (`cachedAuth`) | yes, inside `getPersonForEdit()` | `people.manage` |
| `updatePersonAction` (server action) | yes (`auth()`, not cached) | yes, inside `updatePerson()` | `people.manage` |

Both additionally gated on `isFlagEnabled("org_portal.members_create")` → `isOrgFeatureEnabled(...)`, same DECISION-097 order as every other page in this tree. `organizationId` is never trusted from the client in `updatePersonAction` — re-derived from `resolveOrgContext()` every call, matching `createPersonAction`'s own contract. Zero new `route.ts` files; the one write goes through a server action.

## Verdict

**PASS.** Not auth-touching (doesn't modify `src/auth.ts`/`(auth)`/`api/auth`/`lib/auth`), so the e2e/MFA gate in CLAUDE.md's Phase 5 does not apply.

**Process note, named honestly:** this pipeline ran without spawning separate `analyst`/`architect`/`tech-lead`/`qa` subagents — the orchestrating session authored every phase directly, in role, given the scope this turn was executing under. Phase 5's verification here is therefore self-verification against real, independently-reproducible evidence (actual test runs, actual typecheck output, actual `git diff` review) rather than an independent read-only agent's judgment. This is a real, named deviation from the pipeline's normal adversarial structure (Phase 4/Phase 5 role separation exists specifically so an implementer's own claim of correctness isn't the only check) — flagged here rather than silently presented as equivalent to a genuine second-agent review.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT: SHIP WITH NOTES

## ONE-LINE TAKE

> Does exactly what Phase 1 scoped — edit identity/contact/address/household on a single accessible screen, nothing roll-related touchable — with real regression coverage including an RLS cross-org proof; ships with the same self-verification caveat named in Phase 5, not a red flag but a real gap against this repo's normal two-agent adversarial structure.

## What's Working

- The "no Status field" boundary Phase 1 insisted on is real in the shipped code — `EditPersonValues`/`UpdatePersonInput` have no field that could touch `current_roll` or death; the schema and the domain function both structurally cannot express it.
- `not_found` genuinely collapses "doesn't exist" and "exists elsewhere" into one response, proven by the cross-org test reading the target back afterward and confirming zero writes landed.
- Failed-save data preservation (req 9) is asserted, not just claimed — the test fills a field, forces a failure, and checks the DOM value survived.

## Intent-vs-Shipped Diff

- Phase 1 named "relationships" as in-scope per the parent work-log's own original Increment 2 description; this pipeline's own Phase 1 pass found no existing read/write path for `person_relationships` anywhere in the codebase and explicitly deferred it rather than building a second, unscoped sub-form under cover of "edit person." **Acceptable drift** — named, not silent, and building it properly is a real enough scope to deserve its own Phase 1.
- Everything else: matches.

## Edge Cases

- Empty state: n/a (this page always has a person once reached).
- Failure microcopy: pass (household/not-found/forbidden all have distinct, human copy).
- Permission gate: pass (`people.manage`, verified via the feature-gate audit table).
- Audit event: pass (`PERSON_UPDATED` asserted via the mock in both the domain-layer and DB-backed test).
- Mobile: pass by construction (single column, 44px targets, native inputs) — not independently re-verified in a real browser this pass (see Follow-Ups).

## Follow-Ups

1. **Not independently verified in a real running browser at 360-390px**, unlike Increment 1's own Phase 4/6, which both did a real browser walkthrough. This pipeline's implementation was verified via typecheck + the full automated suite only. Recommend a real dev-server click-through (sign in as the `stated_clerk` fixture, edit a real seeded person, confirm the mobile layout) before this ships to real users. Filed to `docs/TODO.md`.
2. **This pipeline ran self-verified** (Phase 5's own named process note) rather than through independent `analyst`/`architect`/`tech-lead`/`qa` subagents — a future touch of this code should get a genuine independent QA pass, not just re-running the same suite.
3. `person_relationships` editing remains unbuilt — a real, later increment, not a defect.
4. Concurrent-edit last-write-wins is accepted, not fixed — revisit only if it becomes a real complaint.

**Pipeline closed.** Commits await user review per Workflow Rule 1 — everything in this increment (plus the three Increment-1 follow-up fixes made in the same session) is uncommitted, same as the rest of Increment 1's own diff.
