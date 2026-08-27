# Member Edit: Record a Roll Action — Work Log

> **Slug:** `2026-08-26-member-roll-on-edit`
> **Surface:** (org) — `/o/<slug>/admin/members/[id]/edit`
> **Permission(s):** existing `roll.propose` / `roll.approve` — no new key
> **Flag(s):** `org_portal.members_roll_action_edit` (new, seeded off; reuses `org_portal.members_create`'s existing org toggle — see Phase 3)
> **Estimated complexity:** small-medium
> **Pipeline mode:** Full — split out of `2026-08-26-member-roll-and-sensitive-info` on Phase 1's own recommendation (low risk, cleanly separable from the sensitive-info half).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (inherited) | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | F19 scoped out (path b); implementer named full-stack-developer | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | Implemented per Phase 3 design; no deviations to the API contract/data model | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

**Inherited from `docs/work-log/2026-08-26-member-roll-and-sensitive-info.md`'s combined Phase 1 pass — see that file for the full shared analysis (both halves were reviewed together before the split). This section extracts only what applies to this half.**

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Recording a roll action from the Edit screen is a small, well-precedented extension of a pattern `createPerson()` already implements for brand-new people — it needs its own edit-time subset of roll-action kinds, not the enrollment-only list the creation wizard uses.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding `roll.propose` — `/o/<slug>/admin/members/[id]/edit` | Opens Edit for an existing person and records a new roll action against them (transfer out, death, removal, restoration, reaffirmation, etc.) | On demand, infrequent per person |
| Authenticated member holding `roll.approve` — `/o/<slug>/admin/members/pending` (existing, unchanged) | Approves or denies the proposed action | Per proposal |

## Flows

**Flow 1 — Record a roll action from Edit:** `/o/<slug>/admin/members/[id]/edit` → a new "Record roll action" section/button → select a kind, effective date, optional minute reference → Submit → inserts a new `pending` `roll_actions` row (same shape as `createPerson()`'s step 4, minus the person/membership creation it also does) → success: toast confirms; the new pending action shows on the existing `/admin/members/pending` worklist.
- Failure: same "no data loss, human toast" discipline `EditPersonForm` already uses. Not addressed by the original request: does the edit screen block a second proposal if one is already pending for this person, warn, or allow it silently?

**Flow 2 — Approve/deny (unchanged):** already exists at `/admin/members/pending`; this feature just adds a second entry point that populates it. Phase 3 should confirm nothing about the pending worklist's UI assumed "roll actions only ever arrive via `/new`."

## Permissions & Flags

- **Permission(s):** existing `roll.propose` (already seeded, already checked inside `createPerson()`) plus existing `people.manage`. No new permission key needed.
- **Default roles:** whatever already holds `roll.propose` today — unchanged.
- **Flag(s):** the existing `org_portal.members_create` flag covers the surface today. Phase 3 to decide: reuse it, or cut a dedicated flag so this can roll back independently — `roll_actions` is append-only and mistakes there are harder to undo than a contact-field typo, so a dedicated flag is worth considering.

## Gaps the Request Didn't Address

- **Which `roll_action_kind` values apply at edit-time.** The creation wizard's `RollActionStep` only offers `profession_of_faith` and `other_participant_enrolled` — the enrollment-only subset appropriate for a brand-new person. Edit-time recording needs a different subset (transfers, death, removal, restoration, reaffirmation, certificate received/dismissed) and must exclude `opening_balance` and the enrollment kinds for anyone who already has active roll history. Phase 3 must define the exact edit-time kind set, not reuse the wizard's list wholesale.
- **F19 (death doesn't terminate anything) reaching this new entry point.** `docs/schema-design.md` F19 names a trigger gap where a `death` roll action doesn't end `officer_terms`/`role_grants`/`group_memberships`. Confirm in Phase 2/3 whether that trigger fix already exists and is entry-point-agnostic (it should be, since it fires on approval regardless of who inserted the pending row) — needs an explicit check, not an assumption.
- **Audit story.** Roll-action approval/denial is already audited; roll-action proposal is deliberately NOT audited today (existing precedent). This new edit-time proposal path should follow that same precedent for consistency — confirm in Phase 2/3 rather than silently deviating either way.
- **Empty/failure states, mobile** — not addressed by the request; should inherit `EditPersonForm`'s existing conventions.

## Adversarial Pass

- **State-machine shortcut:** the roll-action-record action must re-check `roll.propose` server-side inside the transaction, never trust the client — same discipline `createPersonAction` already uses correctly; Phase 4 must not skip it for the edit-time path.

## Out of Scope

- Editing an *existing, already-approved* `roll_actions` row — invariant forbids this outright; corrections are always a new `void` action.

**Handoff:** architect (Phase 2).

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions

## Placement

- **Directory placement:** a new, separate component (`record-roll-action-form.tsx` or similar) rendered as its own section on `/o/<slug>/admin/members/[id]/edit`'s page, co-located next to `edit-person-form.tsx` — **not** folded into `EditPersonForm`'s existing `<form>`. `updatePerson()`'s own docblock in `src/lib/people.ts` already draws this line explicitly: it is gated on `people.manage` *only*, deliberately not `roll.propose`, since nothing there touches `roll_actions`/`current_roll`. A new mutation with a different permission requirement submitted through one shared form risks a partial-success UX the existing form has no story for. Two forms, two server actions, two independent success/error states — mirroring the existing `people.ts` / `roll.ts` module split at the data layer.
- **Server vs client split:** the new section is a client component (`'use client'`), same reason `edit-person-form.tsx`/`roll-action-step.tsx` already are. The server action belongs in the route's existing co-located `actions.ts`, calling a new library function that should live in **`src/lib/roll.ts`**, not `src/lib/people.ts` — this is a roll-action-domain mutation against an already-existing person, not a person-identity mutation. `createPerson()`'s inline roll-action insert and this new function will duplicate the same insert shape; a shared helper is worth naming in Phase 3, not a placement blocker.
- **Dependencies:** none. No new package — reuses `react-hook-form`, `zod`, the existing `rollActionKind` enum, existing shadcn primitives.

## Invariants Touched

- **"The Roll Is the System of Record" (append-only, void-not-update):** respected by design — Phase 1's Out of Scope already excludes editing an approved row, and the only Phase 3/4 obligation is to keep this new path strictly insert-only.
- **F19 is NOT actually fixed, and this feature is the first entry point that makes that live — the one blocking item.** `docs/schema-design.md` marks F19 ("death does not terminate anything — `officer_terms`/`role_grants`/`group_memberships` stay open") as **"Applied §8."** Architect traced every trigger touching `roll_actions`/`officer_terms`/`role_grants` across all of `drizzle/*.sql` and found no such trigger — `presby_sync_current_roll` only maintains `memberships.current_roll`; §8's own trigger propagates `officer_terms.ends_on` → `group_memberships`, but only *after* a human manually sets `ends_on`, not automatically off an approved `death`/removal action. **F19 is open, not applied — `docs/schema-design.md`'s status line is wrong.** This is currently inert because no UI can record `death` at all today. This feature is the first real entry point that can produce it: shipping `death` (and other termination-shaped kinds — `removed_by_session`, `renunciation_of_jurisdiction`, `certificate_dismissed`, `affiliate_ended`, `other_participant_removed`, `other_loss`) through this screen without the trigger means an approver could, for the first time, leave a deceased/removed elder on session with full permissions indefinitely.
- **Edge Gate / permissions-vs-flags split:** unaffected — no conflation introduced.

## Notes

1. **F19 must be resolved or scoped out before this ships.** Tech-lead has two legitimate paths: (a) build the termination trigger (`docs/schema-design.md` itself proposes a single `terminate_person_participation(person_id, as_of, reason)` routine) as an in-scope co-requisite, or (b) explicitly exclude `death`/termination kinds from this increment's edit-time kind list, ship only the non-terminating subset (restoration, reaffirmation, certificate received, transfer-out's certificate-issuing side), and track the termination trigger as its own dated work-log entry. Either is acceptable; silently shipping the full kind list with the gap unaddressed is not. Whoever picks (b) must also correct `docs/schema-design.md`'s F19 status from "Applied §8" to "Open" in the same commit.
2. **Flag:** lean toward a dedicated flag (e.g. `org_portal.members_roll_action_edit`) rather than reusing `org_portal.members_create` — pure rollout-safety, not an authorization change. Not blocking; Phase 3's call.
3. **Kind list — allow-list, not exclusion list.** Extract the full label map (today's wizard-scoped `ROLL_ACTION_KIND_LABELS` only covers 2 of 17 kinds) into one shared module, then have each surface declare its own explicit allow-list into that map, so a future new kind doesn't silently surface on a screen nobody vetted it for. `void` must never be selectable in either picker.
4. Minor, non-blocking: the new kind `<select>` will likely reuse the existing hand-rolled `SELECT_CLASSES` precedent — fine for now, don't invent a third divergent variant.

**Verdict: Approved with suggestions.** No blocking issue with placement, server/client split, or permissions-vs-flags discipline. The one item tech-lead must resolve (not just note) before Phase 4 completes: F19 — build the termination trigger, or explicitly scope death/removal kinds out of this increment and correct the stale schema-design.md status line.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Add a second, independent entry point for recording a roll action against an
**existing** person, from `/o/<slug>/admin/members/[id]/edit` — today the
*only* place a `roll_actions` row can originate is the `/new` creation wizard,
which means a clerk cannot record a restoration, reaffirmation, transfer-in
receipt, or any other post-enrollment gain without re-running the "new
person" flow on someone who already exists. Per Phase 2's ruling this ships
as a second, self-contained client form (`RecordRollActionForm`) rendered
beside `EditPersonForm` — not merged into it — calling a new
`recordRollAction()` function in `src/lib/roll.ts`, gated on `roll.propose`
only.

**F19 resolution — path (b), scoped out, not built here.** Phase 2 traced
every trigger and confirmed `docs/schema-design.md`'s F19 line
("Applied §8") is wrong: nothing ends `officer_terms`/`role_grants`/
`group_memberships` when a roll action removes someone from the active roll.
Building `terminate_person_participation(person_id, as_of, reason)` — a
routine that has to fan out correctly across three axes, handle a
future-dated effective date the same way F29's roll-cache reconcile does,
and get its own adversarial isolation review since it needs `SECURITY
DEFINER` to see across the officer/grant axes at all — is schema-and-trigger
work of the same shape as F3/F26/F29 themselves, not a co-requisite that
fits inside a "small-medium" edit-screen feature. It gets its own dated,
tracked pipeline (added to `docs/TODO.md` below) with `database-admin` named
as its likely implementer, instead of being implemented quickly here and
under-reviewed as a result.

This increment therefore ships **only the roll-gain / roll-enrollment
subset** of `roll_action_kind` — the exact set of kinds whose
`resulting_roll` is non-null, defined precisely below — and defers every
kind that removes a person from a roll to the future termination-trigger
pipeline. `docs/schema-design.md`'s F19 line is corrected from "Applied §8"
to "Open" as part of this design (see the diff below), so the document stops
misleading the next reader.

## Correction to Phase 2's own Note 1

Phase 2's Note 1 lists the safe subset as "restoration, reaffirmation,
certificate received, **transfer-out's certificate-issuing side**" — but
Phase 2's own blocking-item paragraph lists `certificate_dismissed` (which
*is* the certificate-issuing side of a transfer-out) among the
termination-shaped kinds to exclude. These two sentences contradict each
other. Resolving in favor of the blocking-item's own reasoning:
`certificate_dismissed` sets `resulting_roll` to nothing (a loss from the
active roll) and, exactly like `death`, can be recorded against a person who
currently holds an `officer_terms` row, a `role_grants` row, or a
`group_memberships` row at *this* org — an elder who transfers away is not
automatically taken off session by this schema any more than a deceased one
is. **`certificate_dismissed` is excluded from this increment**, alongside
`death`. The rule below (non-null `resulting_roll`) makes this exclusion
mechanical rather than a per-kind judgment call, so the same mistake can't
recur when a ninth or tenth kind is added later.

## Permissions & Flags

- **Permission key(s):** `roll.propose` only — no new key, and deliberately
  **not** `people.manage`. Phase 1 assumed both (mirroring `createPerson()`,
  which needs `people.manage` because it also writes `people`/`addresses`/
  `contact_methods`). This function writes only `roll_actions` against an
  *already-existing* person, so `people.manage` is the wrong gate for it —
  the same reasoning Phase 2 already applied to `updatePerson()` in the
  other direction (gated on `people.manage` alone, deliberately not
  `roll.propose`). A person who holds `roll.propose` without `people.manage`
  (a session clerk who proposes roll actions but doesn't edit contact
  details) must be able to use this form; requiring both would regress that
  case with no compensating benefit. **Logged as DECISION-107.**
- **Default role bindings:** whatever already holds `roll.propose` today —
  unchanged, no new binding.
- **Feature flag(s):** a new dedicated global flag,
  `org_portal.members_roll_action_edit`, checked bare (no DECISION-026
  fail-open wrapper — a toggle, not an auth path, same as
  `org_portal.members_create`'s own precedent). Seeded OFF. **No new
  per-org toggle** — this reuses the *existing* `org_portal.members_create`
  organization-feature-toggle row rather than asking a church to flip a
  second checkbox for what is, from their point of view, one more thing the
  members screen can do. The page renders `RecordRollActionForm` only when
  `org_portal.members_create`'s own flag+toggle pair (already required to
  reach `/edit` at all) **and** the new global flag are both on. This gives
  the platform an independent kill switch for just the new mutation path
  (Phase 2's "rollout-safety" ask, and `roll_actions` being append-only makes
  independent rollback worth the one extra flag) without adding a second
  per-org opt-in surface. Logged as part of DECISION-107.

## API Contract

New library function, `src/lib/roll.ts` (not `src/lib/people.ts` — Phase 2's
placement ruling):

```ts
export type RecordRollActionResult =
  | { kind: "ok"; rollActionId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }       // personId has no membership at this org
  | { kind: "invalid_kind" };   // kind not in EDIT_TIME_ROLL_ACTION_KINDS — server-side re-check

export async function recordRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: {
    personId: string;
    kind: EditTimeRollActionKind;
    /** 'YYYY-MM-DD' */
    effectiveDate: string;
    minuteReference?: string;
  },
): Promise<RecordRollActionResult>
```

- Checked inside `withOrgContext()`, same `hasRollPropose()` helper pattern
  as the existing `hasRollApprove()` in this file (a new `ROLL_PROPOSE =
  "roll.propose"` const + a sibling function, not a re-export from
  `people.ts`).
- Re-validates `input.kind` against `EDIT_TIME_ROLL_ACTION_KINDS` server-side
  before insert — never trusts the client `<select>` alone (Phase 1's
  adversarial pass, same discipline `createPersonAction` already follows).
- Pre-checks the target person holds a `memberships` row at this org (a
  plain `select` through the same RLS-scoped `tx` — this is *not* the F21
  cross-org case `createPerson()` had to work around, because both the
  actor and the target are read through the same single-org `tx` here, and
  `roll_actions_person_fk` requires the row to exist in *this* org). Returns
  `not_found` if it doesn't.
- Computes and inserts `resultingRoll` from the new
  `ROLL_ACTION_KIND_TO_ROLL` map (see Data Model / shared module below) —
  **not left null.** `ageAtAction` is computed from the person's
  `dateOfBirth` (already read for the membership check) and
  `input.effectiveDate` when `dateOfBirth` is known, else left null, matching
  `presby_roll_changes()`'s own `coalesce(age_at_action, 99)` handling of an
  unknown birthdate.
- Insert: `{ organizationId, personId, kind, effectiveDate, resultingRoll, ageAtAction, approvalStatus: "pending", minuteReference: input.minuteReference ?? null, proposedBy: actingUserId }`.
- **Not audited** — same precedent `roll.ts`'s header already documents:
  proposal is deliberately unaudited, only approve/deny is (Phase 1
  confirmed, no deviation).

Server action, `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.ts`:

```ts
export async function recordRollActionAction(
  slug: string,
  input: { personId: string; kind: EditTimeRollActionKind; effectiveDate: string; minuteReference?: string },
): Promise<ActionResult<{ rollActionId: string }>>
```

Same shape as `updatePersonAction`: `auth()`, `resolveOrgContext()`,
translate `RecordRollActionResult` to `ActionResult`, `revalidatePath`
`/o/${slug}/admin/members` and `/o/${slug}/admin/members/pending` (the new
pending row must show up on the existing worklist immediately).

## Data Model

**No schema changes required.** `roll_actions` and its enum already carry
every kind and column this increment needs; the gap is application code
that never populated `resulting_roll`/`age_at_action`, not the schema.

New shared, plain (no `"server-only"`) data module,
`src/lib/roll-action-kinds.ts` — needed by both a server function and two
client components, so it cannot live in `roll.ts`:

```ts
export type RollActionKind = (typeof rollActionKind)["enumValues"][number];

export const ROLL_ACTION_KIND_LABELS: Record<RollActionKind, string> = { …all 17… };

/** null = removes the person from a roll (a loss). Never null for a kind
 *  this increment allows — see EDIT_TIME_ROLL_ACTION_KINDS below. */
export const ROLL_ACTION_KIND_TO_ROLL: Record<RollActionKind, string | null> = {
  profession_of_faith: "active", reaffirmation: "active", restoration: "active",
  certificate_received: "active", other_gain: "active",
  baptized_member_enrolled: "baptized", affiliate_received: "affiliate",
  other_participant_enrolled: "other_participant",
  certificate_dismissed: null, death: null, removed_by_session: null,
  renunciation_of_jurisdiction: null, other_loss: null,
  affiliate_ended: null, other_participant_removed: null,
  opening_balance: null, // caller-supplied in practice; not reached by either surface
  void: null,
};

/** The rule that makes "non-terminating" mechanical: every kind whose
 *  resulting_roll is non-null. Nothing that only ADDS to a roll can ever
 *  need officer_terms/role_grants/group_memberships to change, so F19
 *  cannot fire through this list regardless of the trigger gap. */
export const EDIT_TIME_ROLL_ACTION_KINDS: readonly RollActionKind[] = [
  "profession_of_faith", "reaffirmation", "restoration", "certificate_received",
  "other_gain", "baptized_member_enrolled", "affiliate_received",
  "other_participant_enrolled",
];

export const WIZARD_ROLL_ACTION_KINDS: readonly RollActionKind[] =
  ["profession_of_faith", "other_participant_enrolled"]; // unchanged from today
```

`void` is never in either allow-list (Phase 2 Note 3 — corrections happen
through the approve/deny worklist's own mechanism, not either creation
surface).

**Discovered defect, out of scope to fix here:** `createPerson()`
(`src/lib/people.ts`) inserts its own `roll_actions` row with neither
`resultingRoll` nor `ageAtAction` set — every person created through the
`/new` wizard today gets `current_roll = null` on approval (the
`presby_sync_current_roll` trigger reads `resulting_roll` off the very row
`createPerson()` left null) instead of `active`/`other_participant`. This
predates this pipeline and is a real, currently-shipping bug affecting
every wizard-created person, not a hypothetical. Filed to `docs/TODO.md` as
its own bug-fix work-log candidate rather than folded into this design,
since fixing it means touching `createPerson()`, a function this pipeline
does not otherwise need to change.

## Component / Page Plan

- **Files to create:**
  - `src/lib/roll-action-kinds.ts` — shared labels/allow-lists/roll map (above)
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-schema.ts` — zod schema + inferred `RecordRollActionValues`, `kind` constrained to `EDIT_TIME_ROLL_ACTION_KINDS`
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.tsx` — the new client component (`'use client'`), same conventions as `edit-person-form.tsx` (native `<input type="date">`, `min-h-11`/`min-w-11` targets, no-reset-on-failure), its own independent submit/success/error state
- **Files to modify:**
  - `src/lib/roll.ts` — add `ROLL_PROPOSE` const, `hasRollPropose()`, `recordRollAction()`
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.ts` — add `recordRollActionAction()`
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` — check the new flag, fetch any existing `pending` roll actions for this person (for the warning banner below), render `<RecordRollActionForm>` beside `<EditPersonForm>`
  - `src/app/(org)/o/[slug]/admin/members/new/member-wizard-schema.ts` — replace the inline 2-entry `ROLL_ACTION_KIND_LABELS` with an import from the shared module + `WIZARD_ROLL_ACTION_KINDS`; `rollAction.kind`'s zod enum stays the same 2 values (this is a source-of-truth extraction, not a behavior change)
  - `src/app/(org)/o/[slug]/admin/members/new/roll-action-step.tsx` — update its `ROLL_ACTION_KIND_LABELS` import path
  - `docs/schema-design.md` — F19 status corrected (done as part of this Phase 3, see below)
  - `docs/TODO.md` — two new lines (termination trigger; `createPerson()` resulting-roll/age-at-action defect)

## Implementation Order

1. No schema step — confirmed above.
2. Add `org_portal.members_roll_action_edit` to the `feature_flags` seed
   catalog (`scripts/seed.ts`), seeded OFF; no new `ORG_FEATURE_CATALOG`
   entry (reuses `org_portal.members_create`'s existing toggle).
3. `src/lib/roll-action-kinds.ts` (shared module — everything else depends on it).
4. `src/lib/roll.ts`: `hasRollPropose()`, `recordRollAction()`.
5. `record-roll-action-schema.ts`, `record-roll-action-form.tsx`, wire `actions.ts` and `page.tsx`.
6. Extract the wizard's label map to the shared module (`member-wizard-schema.ts`, `roll-action-step.tsx`).
7. No audit event (proposal is unaudited, confirmed above).
8. Release notes entry — member-visible behavior (a clerk can now record roll actions for existing members), Rule 13 applies once the flag is real; note in the entry that death/transfer-out kinds are intentionally not yet available here.

## Edge Cases & Risks

- **A person with an already-unresolved pending roll action** (Phase 1's
  named gap). Resolution: **warn, don't block.** `page.tsx` fetches any
  existing `pending` roll action(s) for this person (a small, org-scoped
  query alongside the existing `getPersonForEdit()`/`getHouseholds()` calls)
  and `RecordRollActionForm` renders a non-blocking notice ("An action is
  already pending review: `<kind label>` effective `<date>`") above the
  form. The server action still permits a second `pending` row — blocking
  would need a business rule neither Phase 1 nor Phase 2 stated (e.g. can a
  clerk legitimately queue a correction before the first is decided?), and
  the append-only/void model already tolerates two pending rows resolving
  in effective-date order without corrupting `presby_roll_as_of()`.
- **Kind allow-list, not exclusion-list** (Phase 2 Note 3, honored): both
  surfaces import the same `ROLL_ACTION_KIND_LABELS` but each declares its
  own explicit allow-list array (`EDIT_TIME_ROLL_ACTION_KINDS` /
  `WIZARD_ROLL_ACTION_KINDS`) rather than rendering "everything except X" —
  a future 18th kind added to the enum appears on neither `<select>` until a
  human explicitly adds it to one of the two lists.
- **`certificate_dismissed` contradiction in Phase 2's own notes**,
  resolved above in Phase 2's own architect's favor (the blocking-item
  paragraph, not Note 1's shorthand) — logged so this isn't silently
  re-litigated by Phase 4.
- **`createPerson()`'s pre-existing `resulting_roll`/`age_at_action` gap**
  (discovered while designing this function's insert) is real, shipping,
  and unrelated to F19 — flagged to `docs/TODO.md`, not fixed here.
- **e2e blast radius:** `grep`-confirmed zero existing Playwright specs
  exercise `/admin/members/[id]/edit` or `/admin/members/pending` today
  (`e2e/` has no `member`/`roll`/`pending` spec — the only near-miss is
  `member-home.spec.ts`, which is the unrelated `(member)` home surface).
  This feature therefore has **no existing e2e coverage to break** — the
  risk is entirely in unit/component tests: `page.test.tsx` and
  `edit-person-form.test.tsx` both mock the page's current single-form
  render and will need updating for the second form and the new flag
  check, which is Phase 4's job, named here so it isn't missed.
- **Mobile/empty/failure states** inherit `EditPersonForm`'s existing
  conventions (single column, native `<input type="date">`, no-reset-on-
  failure) — no new pattern introduced.

## Implementer

**full-stack-developer.** The scope is one cohesive feature spanning a
small server function (`recordRollAction()`), a server action, and one new
client form, plus two small, low-risk edits to existing wizard files to
extract a shared label map — none of these pieces is large enough on its
own to justify splitting across `api-developer`/`ux-developer`, and
splitting would add a handoff for no benefit on a small-medium feature.

---

# Phase 4 — Implementation

**Date:** 2026-08-26
**Implementer:** full-stack-developer

## Files Created

- `src/lib/roll-action-kinds.ts` — the shared, plain (no `"server-only"`) label/allow-list module: `ROLL_ACTION_KIND_LABELS` (all 17 kinds), `ROLL_ACTION_KIND_TO_ROLL`, `EDIT_TIME_ROLL_ACTION_KINDS` (+ `EditTimeRollActionKind` type, `as const satisfies readonly RollActionKind[]`), `WIZARD_ROLL_ACTION_KINDS`.
- `src/lib/roll-action-kinds.test.ts` — unit tests: label/map completeness against the schema enum, `void` excluded from both allow-lists, `EDIT_TIME_ROLL_ACTION_KINDS` is mechanically every non-null-`resultingRoll` kind, `certificate_dismissed`/`death` excluded.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-schema.ts` — zod schema (`kind` constrained to `EDIT_TIME_ROLL_ACTION_KINDS`), `RecordRollActionValues`, default values.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-schema.test.ts` — schema unit tests, incl. the `death`/`certificate_dismissed`/`void` rejections.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.tsx` — the new client component: its own kind/date/minute-reference fields, the non-blocking "already pending" notice, its own independent submit/success/error state (resets + `router.refresh()` on success; no-reset-on-failure).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.test.tsx` — component tests: pending-notice singular/plural/absent, blank-date validation, submit → reset+refresh, failed submit does not discard entered values.

## Files Modified

- `src/lib/roll.ts` — added `ROLL_PROPOSE` const + `hasRollPropose()` (refactored `hasRollApprove()`/`hasRollPropose()` onto one shared `hasPermission()` helper), `recordRollAction()` (the new edit-time proposal function — server-side re-validates `kind` against `EDIT_TIME_ROLL_ACTION_KINDS`, looks up the target's `dateOfBirth` through the same single-org `tx`, computes `resultingRoll`/`ageAtAction`, inserts a `pending` row, not audited), `getPendingRollActionsForPerson()` (the edit screen's own person-scoped pending read, gated on `roll.propose`, distinct from the approve-worklist's `roll.approve`-gated `listPendingRollActions()`).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.ts` — added `recordRollActionAction()`, same `auth()` → `resolveOrgContext()` → typed-result-translation shape as `updatePersonAction`; revalidates both `/admin/members` and `/admin/members/pending`.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.test.ts` — added the `recordRollActionAction` describe block (not-signed-in, no-org-access, forbidden/not_found/invalid_kind/ok, resolved-identity-not-client-claims proof, revalidate-path assertions).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` — added the `ROLL_ACTION_EDIT_FLAG` check, fetches `getPendingRollActionsForPerson()` when that flag is on, renders `<RecordRollActionForm>` beside `<EditPersonForm>`.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.test.tsx` — added a keyed `mockFlags()` helper (page.tsx now calls `isFlagEnabled` with two different keys; a blanket mock would have silently exercised the new render path in every pre-existing test) and a new describe block for the `RecordRollActionForm` gate (flag off/on, pending notice present/absent, `forbidden` from the read not failing the page). Also added a neutral mock for `@/lib/person-sensitive`'s `getSensitiveInfoGrants` — see Implementer Notes.
- `src/app/(org)/o/[slug]/admin/members/new/member-wizard-schema.ts` — `rollAction.kind`'s zod enum now built from `WIZARD_ROLL_ACTION_KINDS`; `ROLL_ACTION_KIND_LABELS` re-exported from the shared module (byte-identical values) so `review-step.tsx`'s existing import keeps working unchanged.
- `src/app/(org)/o/[slug]/admin/members/new/roll-action-step.tsx` — imports `ROLL_ACTION_KIND_LABELS`/`WIZARD_ROLL_ACTION_KINDS` from the shared module directly; **the `<select>` now maps over `WIZARD_ROLL_ACTION_KINDS` instead of `Object.entries(ROLL_ACTION_KIND_LABELS)`** — see Implementer Notes, this was a real regression caught mid-implementation, not a design deviation.
- `scripts/seed.ts` — added the `org_portal.members_roll_action_edit` flag entry, seeded OFF.
- `docs/TODO.md` — added one new line (a pre-existing, unrelated circular-import ordering defect discovered while writing `roll-action-kinds.test.ts` — see Implementer Notes); the two lines Phase 3 already filed (F19 trigger, `createPerson()`'s resulting-roll gap) were pre-existing from Phase 3, untouched here.
- `docs/release-notes/v0.16.md` — added a "Record a roll action for an existing member from the Edit screen" feature entry (Implementation Order step 8), with an explicit note that death/transfer-out kinds are intentionally not yet available, plus an editorial note flagging that a version-number decision (stay under 0.16.0 vs. move to 0.17.0) is still needed at actual release-cut time — **not resolved here, by design** (see the user's own instruction not to bump the version).

## Schema Changes

None — confirmed by Phase 3. `roll_actions` and its `roll_action_kind` enum already carry every column and value this increment needs.

## Audit Events

None — roll-action proposal is deliberately unaudited, matching existing precedent (`approveRollAction()`/`denyRollAction()` remain the only audited roll-action mutations). Confirmed by Phase 3; no deviation.

## Implementer Notes

- **A real regression caught and fixed mid-implementation, not in the Phase 3 design:** `roll-action-step.tsx` (the `/new` wizard's roll-action picker) had, by the time I read it, already been touched by an unrelated v0.16 visual pass (a `ChevronDown` icon + `appearance-none` select styling) that rendered its options via `Object.entries(ROLL_ACTION_KIND_LABELS)`. Once `ROLL_ACTION_KIND_LABELS` became the shared, full 17-kind map (Phase 3's extraction), that unchanged line would have silently started offering all 17 kinds — including `death` and `void` — on the creation wizard, contradicting Phase 3's explicit "the zod enum stays the same 2 values, not a behavior change." Fixed by mapping over `WIZARD_ROLL_ACTION_KINDS` instead, and by switching `member-wizard-schema.ts`'s own zod enum to build from the same constant, so the wizard's 2-kind list has exactly one source of truth going forward. No new test file was warranted (no `roll-action-step.test.tsx` exists — `member-wizard.test.tsx`'s existing end-to-end walk exercises the same `<select>` unchanged); `roll-action-kinds.test.ts` proves the allow-list itself is exactly 2 entries.
- **A concurrent, sibling pipeline (`docs/work-log/2026-08-26-member-sensitive-info.md`) landed in this exact same `page.tsx` and `actions.ts` files during this session**, adding its own `SENSITIVE_INFO_FLAG` gate and a link into a new `./sensitive` sub-route. The two features compose without incident in the shipped file (different flags, additive JSX), but that pipeline's own `getSensitiveInfoGrants()` import (from `@/lib/person-sensitive`, which carries `"server-only"`) broke `page.test.tsx` under jsdom once both landed, since neither pipeline's test file mocked the other's new import. Added a minimal, neutral `vi.mock("@/lib/person-sensitive", ...)` to `page.test.tsx` so the shared file loads — asserts nothing about that pipeline's own feature, which remains its own test responsibility. Flagging this here because it's a live instance of "two pipelines editing the same file" that CLAUDE.md's Workflow Rules don't yet have a named answer for beyond the migration-numbering collision already logged in `docs/TODO.md`.
- **Discovered, unrelated, pre-existing defect: a circular-import ordering bug in `src/lib/db/domain/*`.** A bare top-level `import { X } from "@/lib/db/domain/roll"` throws `"organizationType is not a function"` at module-evaluation time — `domain/authz.ts`'s own `organizationType(...)` column call runs before `domain/org.ts`'s export has initialized, when the submodule (not the `@/lib/db/domain` barrel, which orders `./org` first) is the entry point. Confirmed reproducible on `main` HEAD with every one of my own and every other in-flight agent's changes stashed out — genuinely pre-existing, not introduced by this pipeline. It had never surfaced because every existing DB-backed test suite is `describe.skipIf(!hasDb)`-gated and only imports domain submodules dynamically *inside* `beforeAll`, which never runs when `DATABASE_URL` is unset (the default `npm test` posture) — my new `roll-action-kinds.test.ts` is the first plain, always-run unit test to import a domain submodule directly at the top level. Worked around locally by importing via the barrel (`@/lib/db/domain`) instead; filed to `docs/TODO.md` as its own, separately-owned finding rather than fixed here, since the actual root cause is a module-graph ordering question across every `domain/*.ts` file, out of this pipeline's scope.
- **`ageAsOf()` (age-at-action computation)** is a small, local, non-exported helper in `roll.ts` — no existing age-calculation utility was found elsewhere in the codebase to reuse. Matches `presby_roll_changes()`'s own age-based SASR split logic in spirit (year-difference, decremented if the birthday hasn't occurred yet that year); proven against a real Postgres-backed fixture (dateOfBirth `2000-06-15`, effectiveDate `2026-03-01` → `25`) in `roll.test.ts`.
- **`getPendingRollActionsForPerson()`** is a small addition not spelled out verbatim in Phase 3's API Contract section (which named the *need* — "page.tsx fetches any existing pending roll action(s) for this person" — but not a function signature). Implemented as its own gated read (`roll.propose`, matching `recordRollAction()`'s own gate, deliberately not `listPendingRollActions()`'s `roll.approve` gate) rather than overloading the existing worklist function, since a `roll.propose`-only holder must still see the warning on the form they're about to submit.
- No `people.manage`/`roll.propose` double-gate: confirmed `recordRollAction()` checks `roll.propose` only, per DECISION-107.
- No native browser dialogs; no `console.log` left in any new file.

## Test Summary

- `npx dotenv -e .env.local -- npx vitest run src/lib/roll.test.ts`: 20/20 passed (10 pre-existing + 10 new, incl. 6 for `recordRollAction()` and 3 for `getPendingRollActionsForPerson()`, all against a real Postgres connection).
- `npm test` (full suite, no `DATABASE_URL`): 2304 passed, 349 skipped, 0 failed.
- `npm run typecheck`: clean.
- `npm run check` (all four tripwires): clean.

## Addendum (2026-08-26) — closing QA's Phase 5 FAIL

QA's Phase 5 FAIL named a genuine coverage gap: the wizard-select regression
described above ("A real regression caught and fixed mid-implementation") had
no locking test. Two tests added, per QA's named handoff:

- **`member-wizard.test.tsx`** — new describe block "MemberWizard — roll
  action kind options — regression for wizard-select-full-kind-map", added
  after navigating the wizard to the Roll action step. Reads the actual
  rendered `<select>`'s `.options` and asserts the value list is *exactly*
  `[...WIZARD_ROLL_ACTION_KINDS]` (not just "excludes death"), plus explicit
  `not.toContain` checks for `death`, `void`, `certificate_dismissed`. This
  exercises `RollActionStep` as actually rendered inside `MemberWizard`, so it
  fails if the `<select>` ever reverts to mapping over
  `Object.entries(ROLL_ACTION_KIND_LABELS)`. Placed in the existing
  `member-wizard.test.tsx` rather than a new `roll-action-step.test.tsx`:
  confirmed no sibling step component (`household-step.tsx`, `identity-step.tsx`,
  etc.) has its own test file — every step is exercised through the wizard's
  own integration walk, and a dedicated per-step test file would be a new,
  unprecedented pattern for this directory.
- **`member-wizard-schema.test.ts`** — new case asserting
  `memberWizardSchema.safeParse(...)` with `rollAction.kind: "death"` fails,
  and that `result.error.issues` names `rollAction.kind` as the offending
  path, closing the gap QA flagged around `member-wizard-schema.ts:61`'s
  `z.enum(WIZARD_ROLL_ACTION_KINDS)`.

Re-ran in isolation (`npx vitest run` on both files): 22/22 passed. Full
suite re-run after the addition: `npm test` 2347 passed / 349 skipped / 0
failed (count differs from the Phase 4 figure due to other concurrent
sibling-pipeline tests in the working tree, not a regression here — same
caveat QA already noted in Phase 5). `npm run typecheck`: clean. `npm run
check` (all four tripwires): clean.

No production code changed — this addendum is test-only, matching QA's own
finding that the fix itself was already correctly shipped.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS (clean, no errors)

## Unit Tests

Full suite (`npm test`, no `DATABASE_URL`): Total 2688 | Passed 2339 | Skipped 349 | Failed 0 | Duration 6.79s. (Implementer reported 2304 passed against the same skip count — the difference is other concurrent, uncommitted sibling pipelines' tests now present in the working tree, not a regression in this feature.)

DB-backed `src/lib/roll.test.ts`: Total 20 | Passed 20 | Failed 0 — reproduced exactly as reported.

Feature-specific files re-run together (`roll-action-kinds.test.ts`, `record-roll-action-schema.test.ts`, `record-roll-action-form.test.tsx`, `actions.test.ts`, `page.test.tsx`, `member-wizard.test.tsx`): Total 61 | Passed 61 | Failed 0.

`npm run check` (all four tripwires): all PASS. Note on `check:audit`: this tripwire only scans `actions.ts`/`actions.tsx` files for direct `db.insert/update/delete` calls. `recordRollActionAction` contains no direct DB call (delegates to `recordRollAction()` in `roll.ts`), so the tripwire never actually inspects this mutation — its passing is not evidence either way. The "no audit" decision is independently verified correct by reading `roll.ts`'s own header and precedent (proposal is unaudited codebase-wide; only `approveRollAction`/`denyRollAction` call `recordAudit`).

## End-to-End Tests

Not applicable — non-auth-touching feature. Phase 3 confirmed (grep) zero existing Playwright specs exercise `/admin/members/[id]/edit` or the `/new` wizard's roll-action step; verified still true.

## Regression Tests Added

- `src/lib/roll-action-kinds.test.ts` — allow-list/exclusion tests: `void` excluded from both lists, `EDIT_TIME_ROLL_ACTION_KINDS` mechanically equals every non-null-`resultingRoll` kind, `certificate_dismissed`/`death` excluded. Genuine and correct, confirmed by reading the file.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-schema.test.ts` — rejects `death`/`certificate_dismissed`/`void` at the edit-time schema layer. Confirmed present.
- **`src/app/(org)/o/[slug]/admin/members/new/member-wizard.test.tsx:275-303`** (added in response to the FAIL below) — navigates the actual rendered wizard to the Roll action step and asserts the rendered `<select>`'s option values **exactly equal** `[...WIZARD_ROLL_ACTION_KINDS]`, plus explicit `not.toContain` for `death`/`void`/`certificate_dismissed`. Traced against `roll-action-step.tsx:41-45`: if this line reverted to `Object.entries(ROLL_ACTION_KIND_LABELS)` (the exact near-miss the implementer's Phase 4 notes describe), the rendered option list would have length 17 against an expected length-2 array — an immediate, genuine failure, not a tautology.
- **`src/app/(org)/o/[slug]/admin/members/new/member-wizard-schema.test.ts:114-124`** (added in response to the FAIL below) — proves `memberWizardSchema.safeParse` rejects `rollAction.kind: "death"`, naming `rollAction.kind` in the failing path. Traced against `member-wizard-schema.ts:61`'s `z.enum(WIZARD_ROLL_ACTION_KINDS)`: if that enum were ever widened, this test would flip from `success: false` to `success: true` and fail — genuine, not tautological.

**FAIL → PASS history:** the first Phase 5 pass (2026-08-26) found the fix for the wizard-select regression correctly in place, but no test anywhere would have caught it reappearing — cited the exact gaps (constant-only assertion in `roll-action-kinds.test.ts`, no `roll-action-step.test.tsx`, `member-wizard.test.tsx`'s happy-path-only walk, no schema-rejection case). Returned to the implementer, who added the two tests above; QA re-verified independently (read both tests directly, reran them in isolation, and traced the failure mode against the current component/schema code rather than trusting the description) and confirmed both are genuine locks.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (statements/branches/functions/lines, isolated run)
- `src/lib/two-factor.ts`: 91.3% stmts / 100% branch / 90% funcs (line 35-39 uncovered — pre-existing, not touched by this feature)
- `src/lib/flags.ts`: 100%
- `src/lib/roll.ts` (this feature's primary new logic, DB-backed run): 98.43% stmts / 86.66% branch / 100% funcs — only line 144 (an existing race-condition branch in `decideRollAction`, unrelated to this pipeline) uncovered
- `src/lib/roll-action-kinds.ts`: 100%

## Feature-Gate Audit

| Route or action | `auth()` present? | Server-side permission re-check? | Correct key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `recordRollActionAction` (`.../edit/actions.ts:74-119`) | yes (`auth()` line 78, `resolveOrgContext` line 83) | yes — `recordRollAction()` (`src/lib/roll.ts:393-396`) re-checks `hasRollPropose()` inside its own `withOrgContext()` transaction, independent of any client state | `roll.propose`, matches DECISION-107 (deliberately not `people.manage`) |
| `updatePersonAction` (unchanged, pre-existing) | yes | yes (inside `updatePerson()`) | `people.manage` |
| `getPendingRollActionsForPerson` (`src/lib/roll.ts:467-495`, read-only) | called from `page.tsx` after `auth()`/`resolveOrgContext()`; gate itself is `hasRollPropose()` inside `withOrgContext()` (line 473) | yes | `roll.propose` — deliberate, so a propose-only holder still sees the warning notice |

No new `src/app/api/**/route.ts` files were touched. Both the server action and the two new library reads independently re-verify permission server-side inside their own transaction, never trusting the client `<select>` or the page's own render gate. Confirmed correct.

## Verdict

**PASS**

All mechanical checks are green (typecheck, full unit suite, DB-backed `roll.test.ts`, all four tripwires), the feature-gate audit holds, and the previously-named coverage gap is now closed by two tests confirmed — by direct reading and by tracing the failure mode against the current render/schema code, not by trusting the implementer's description — to be genuine locks on the actual near-miss regression rather than tautological assertions.

**Secondary, non-blocking finding carried forward (for Phase 6/tech-lead):** the neutral `vi.mock("@/lib/person-sensitive", ...)` in `page.test.tsx` remains a live cross-pipeline coupling risk if the sibling `member-sensitive-info` feature's `getSensitiveInfoGrants()` return shape changes before its own sign-off. Not this pipeline's defect.

**Handoff:** analyst (Phase 6 — Shipped vs Intent).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The Edit screen now has a second, honestly-scoped entry point for recording roll-gain actions — kind/date/minute-reference, warn-don't-block pending notice, human failure copy, `roll.propose`-only gate all shipped exactly as designed — but the pipeline's own ship-time paperwork (its `docs/TODO.md` Done line) wasn't filed yet, and two real defects it surfaced along the way (F19, `createPerson()`'s roll-cache bug) are tracked but not fixed, which is the correct call for this increment's scope, not a shortcut.

## What's Working

- `record-roll-action-form.tsx` matches Phase 1's described flow exactly: a kind `<select>` constrained to `EDIT_TIME_ROLL_ACTION_KINDS`, a native `effectiveDate` input, an optional `minuteReference` field, a submit button, and `toast.success`/`toast.error` on the two outcomes. No native browser dialogs.
- Phase 3's "warn, don't block" pending-action notice is implemented faithfully: gated on `roll.propose` (not `roll.approve`, so a propose-only holder still sees it), non-blocking, submit never disabled by its presence.
- Failure microcopy is human at every branch — `forbidden`/`not_found`/`invalid_kind` map to distinct, readable sentences, no stack traces.
- The permission gate is exactly what Phase 3 specified (DECISION-107: `roll.propose` alone, deliberately not `people.manage`), re-checked server-side inside `recordRollAction()`'s own transaction.
- No audit event — correct and intentional, matching the existing unaudited-proposal precedent.
- `docs/release-notes/v0.16.md`'s entry is accurate and explicit that death/transfer-out are intentionally not offered yet, with the actual reason given.
- Flag `org_portal.members_roll_action_edit` is seeded OFF — nothing here is live for a real congregation.

## Intent-vs-Shipped Diff

- Phase 1 said: record a roll action from Edit — kind, effective date, optional minute reference, submit, toast confirmation. Shipped: exactly that. **Matches.**
- Phase 1 named the gap "does the edit screen block/warn/allow silently on a second pending action?" Phase 3 resolved it as warn-don't-block; shipped code does exactly that. **Matches.**
- Phase 1 assumed the edit-time kind list would mirror the wizard's need for "transfer out, death, removal, restoration, reaffirmation, etc." Phase 2 caught that shipping termination-shaped kinds without the F19 trigger was unsafe, and Phase 3 scoped the increment down to gain-only kinds. **Acceptable drift** — Phase 2 catching a real hazard Phase 1 didn't have the schema context to see, disclosed to the end user in the release notes rather than silently absent.
- Phase 1's permission assumption (`roll.propose` and `people.manage`) was corrected in Phase 3 to `roll.propose` alone. **Acceptable drift**, reasoned and logged as DECISION-107.

## Edge Cases

- Empty state: not applicable — a mutation form on an existing record, not a listing.
- Failure microcopy: pass.
- Permission gate: pass (`roll.propose`, re-checked server-side, confirmed by direct read).
- Audit event: not applicable (proposal is deliberately unaudited, matches precedent).
- Mobile (360px): **not independently verified.** Phase 3 reasoned this inherits `EditPersonForm`'s existing conventions and the component does reuse those primitives, but nothing in Phase 4/5 records an actual browser check at 360px for this new section. Not blocking given the flag ships OFF, but should happen before the flag is ever flipped on for a real org.

## Follow-Ups (if SHIP WITH NOTES)

- File this pipeline's own Done line in `docs/TODO.md` (Workflow Rule 10) — done in the same commit as this housekeeping pass.
- F19 (termination trigger) and the `createPerson()` resulting-roll/age-at-action bug are both correctly filed in `docs/TODO.md` as their own follow-ups, each naming this work-log as the discovery source — confirmed genuinely tracked, not silently dropped.
- Live-browser 360px verification of `RecordRollActionForm` before the flag is ever flipped on for a real congregation.
- Minor: the circular-import ordering defect this pipeline rediscovered looks like the same root cause already filed from an earlier pipeline (`authz.ts`/`org.ts` init-order) — worth a dedupe pass, not this pipeline's job to resolve.
