# Member Edit: Roll Actions + Tiered Sensitive Info — Work Log

> **Slug:** `2026-08-26-member-roll-and-sensitive-info`
> **Surface:** (org) — `/o/<slug>/admin/members/[id]/edit`
> **Permission(s):** TBD Phase 1/3 — existing `people.manage` for roll actions likely; a NEW tier-2/3 permission almost certainly needed for the sensitive-info half
> **Flag(s):** TBD Phase 3
> **Estimated complexity:** medium-large
> **Pipeline mode:** Full — the sensitive-info half is a direct candidate for CLAUDE.md's D8 "No custom fields" invariant and the tier system; not skippable.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES — split into two sibling pipelines | 2026-08-26 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES — **the analyst recommends splitting this into two sibling pipelines before Phase 2**: `2026-08-26-member-roll-on-edit` (small, low-risk, reuses existing `roll.propose`/`roll.approve`) and `2026-08-26-member-sensitive-info` (new tier-3 permission surface, real PII-exposure risk). This file records the shared Phase 1 analysis; the two sibling files carry the split forward from Phase 2 on.

## ONE-LINE TAKE

> Two genuinely different asks got compressed into one sentence each: "roll on edit" is recording a new `roll_actions` row against an *existing* person (a small, well-precedented extension of a pattern `createPerson()` already implements) — "more sensitive info" is standing up a UI for four schema tables (`person_notes`, `person_demographics`, `person_medical`, `person_disabilities`) that have existed since the original domain design and have had **zero read/write path anywhere in the app** until now, which is a new permission surface, not a form addition.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding `roll.propose` (and `people.manage`) — `/o/<slug>/admin/members/[id]/edit` | Opens Edit for an existing person and records a **new** roll action against them (transfer out, death, removal, restoration, reaffirmation, etc.) | On demand, infrequent per person |
| Authenticated member holding `roll.approve` — `/o/<slug>/admin/members/pending` (existing surface, unchanged) | Approves or denies the roll action proposed above | Per proposal |
| Authenticated member holding a new tier-2/tier-3 permission — `/o/<slug>/admin/members/[id]/edit` (or a linked sub-screen) | Enters/updates pastoral notes, demographics, medical/allergy info, or disability records for a person | On demand |
| Authenticated member **without** that permission — same screen | Does not see the sensitive-info section at all (not greyed out — absent) | Every visit |

The request never named a role for either verb ("more roles that can see that info" is a placeholder, not a role list).

## Flows

**Flow 1 — Record a roll action from Edit:** `/o/<slug>/admin/members/[id]/edit` → a new "Record roll action" section/button → select a kind, effective date, optional minute reference → Submit → inserts a new `pending` `roll_actions` row (same shape as `createPerson()`'s step 4, minus the person/membership creation it also does) → success: toast confirms; the new pending action now shows on the existing `/admin/members/pending` worklist for someone holding `roll.approve` to decide.
- Failure: same "no data loss, human toast" discipline `EditPersonForm` already uses. Not addressed: what if the person already has an unresolved *pending* roll action — does the edit screen block a second proposal, warn, or allow it silently?

**Flow 2 — Approve/deny (unchanged):** already exists at `/admin/members/pending`; this feature just adds a second entry point that populates it.

**Flow 3 — View/enter sensitive info:** `/o/<slug>/admin/members/[id]/edit` → if the actor holds the (currently nonexistent) sensitive-info permission, an additional section renders → actor reads/adds/edits pastoral notes / demographics / medical / disability fields → Save → writes to `person_notes` / `person_demographics` / `person_medical` / `person_disabilities` → outcome: values persist and are visible only to holders of the matching permission on next load.
- Failure: not addressed by the request — what does a *denied* save (permission revoked between page load and submit) look like versus a validation failure? Also unaddressed: is this one save action for all four tables, or four independent ones?

## Permissions & Flags

**Roll-action-on-edit half:**
- **Permission(s):** existing `roll.propose` (already seeded, already checked inside `createPerson()`) plus existing `people.manage`. No new permission key needed.
- **Default roles:** whatever already holds `roll.propose` today — unchanged.
- **Flag(s):** the existing `org_portal.members_create` flag covers the surface today. Phase 3 should decide: reuse it, or cut a dedicated flag so this can roll back independently — given `roll_actions` is append-only and mistakes there are harder to undo than a contact-field typo, a dedicated flag is worth considering.

**Sensitive-info half:**
- **Permission(s):** **new.** Presby's permission catalog (`sensitivity_tier` column, resolved via `presby_has_permission()`) already has the tiering *mechanism* — it just has no tier-3 keys registered for these four tables yet. Should not be one blanket `people.view_sensitive` key; should be scoped at least by domain (pastoral notes vs. demographics vs. medical), matching how `person_notes.visibility` already distinguishes `staff | pastoral | clergy_only` in-column.
- **Default roles:** explicitly **not** the generic admin role by default for pastoral/medical (tier 3 sits above financial per the invariant). Needs a real answer — not decided here.
- **Flag(s):** recommend a dedicated flag (e.g. `org_portal.sensitive_info`) separate from `org_portal.members_create` — the risk profile (leaking pastoral/medical data to the wrong role) shouldn't share a kill switch with "can this office add a member."

## Gaps the Request Didn't Address

- **Which `roll_action_kind` values apply at edit-time.** The creation wizard's `RollActionStep` only offers `profession_of_faith` and `other_participant_enrolled` — the enrollment-only subset appropriate for a brand-new person. Edit-time recording needs a *different* subset (transfers, death, removal, restoration, reaffirmation, certificate received/dismissed) and must exclude `opening_balance` and the enrollment kinds for anyone who already has active roll history. Phase 3 must define the exact edit-time kind set, not reuse the wizard's list wholesale.
- **F19 (death doesn't terminate anything) reaching this new entry point.** `docs/schema-design.md` F19 names a trigger gap where a `death` roll action doesn't end `officer_terms`/`role_grants`/`group_memberships`. Confirm in Phase 2/3 whether that trigger fix already exists and is entry-point-agnostic — should be, since it fires on approval regardless of who inserted the pending row, but needs an explicit check, not an assumption.
- **The D8 fork (must be resolved before Phase 2, not deferred to it).** "Enter and track more church related personal information" reads two ways: (1) expose UI for the fixed, already-designed tier-2/3 tables (`person_notes`, `person_demographics`, `person_medical`, `person_disabilities`) the schema has modeled since the original domain design but no screen has ever touched — in scope, bounded, doesn't touch D8; or (2) let a congregation define its own arbitrary fields — the exact anti-pattern D8 exists to block ("No custom fields... a new need is a support ticket and, if real, becomes a feature for everyone"). Analyst's working assumption is (1). **This needs the operator's explicit confirmation before Phase 2 starts.**
- **Granularity vs. the cited prior art.** `fpcw-directory`'s `src/lib/members/visibility.ts` is a per-field, viewer-permission-driven visibility function — presby already has its direct analog for tier-1 data (`person_privacy`, wired into `src/lib/directory.ts`). What's genuinely new is tier-3: no existing per-field-or-per-table gating implementation for the four sensitive tables to copy — fpcw-directory never had this tier at all. Phase 3 is extending a pattern for tier 1, but **inventing** one for tier 3. (Also noted: `fpcw-directory` is reachable at `~/git/fpcw-directory`, one level further up than CLAUDE.md's stated `../fpcw-directory` resolves to from this repo post-restructuring — a stale-doc fix, not blocking.)
- **Empty state** — a brand-new install has zero pending roll actions and zero sensitive-info rows for anyone; not addressed.
- **Failure microcopy** for a DB blip while saving sensitive data — not addressed.
- **Mobile (360px)** — `EditPersonForm` is already single-column/scrollable; new sub-sections need the same discipline, unaddressed by the request but should just inherit it.
- **Audit story.** Roll-action *approval/denial* is already audited; roll-action *proposal* is deliberately NOT audited today (existing precedent, Phase 2's prior ruling) — this new edit-time proposal path should follow that same precedent for consistency. But writes to the four sensitive tables are **not named anywhere in Rule 7's audit list**, and tier-3 data is the most sensitive category in the system. Should a sensitive-data write itself fire `recordAudit()` even though it isn't literally a role/permission/flag/2FA/deactivation mutation? Needs an explicit architect/tech-lead call, not silent inheritance of Rule 7's literal list.

## Adversarial Pass (folded in — both halves are permission-surface changes)

- **State-machine shortcut:** a roll-action-record action must re-check `roll.propose` server-side inside the transaction, never trust the client — same discipline `createPersonAction` already uses correctly; Phase 4 must not skip it for the edit-time path.
- **Enumeration:** a person with an empty `person_medical` row and a viewer denied the medical permission must render identically — `getPersonForEdit`'s existing typed `forbidden`/`not_found` distinction is the right pattern to extend, not a new response shape that could leak "this table has a row."
- **Input boundaries:** free-text `person_notes.body`, `person_medical.allergies/medicalNotes/medications` are unbounded text columns — server-side length/validation needs defining in Phase 3.

## Out of Scope (confirm with user)

- Editing an *existing, already-approved* `roll_actions` row — invariant forbids this outright; corrections are always a new `void` action. Confirming this reading, not proposing otherwise.
- A meetings/docket module turning `minute_reference` into a real FK — unrelated to this request, already deferred elsewhere.
- Building a genuinely new per-field visibility engine matching fpcw's `getVisibleFields()` pattern for tier-3 data — recommend table-level (or domain-level) permission gates for v1, not a bespoke per-field predicate system, unless finer granularity is specifically needed.

## Open Questions

1. **(Most important, blocking) Split confirmation:** ship as two separate work-log pipelines — `2026-08-26-member-roll-on-edit` (small, reuses existing permissions, low risk) and `2026-08-26-member-sensitive-info` (new permission keys, new tier-3 role bindings, real PII-exposure risk)? Bundling means one architect/tech-lead pass reasons about two unrelated risk profiles at once, and a QA fail on the sensitive-info half would block shipping the safer, already-precedented roll-action half.
2. **D8 fork confirmation:** is "more church related personal information" asking for UI on the four already-modeled fixed tables (working assumption), or something closer to per-tenant custom fields? If the latter, this needs to go back to the user as a support-ticket-style conversation per D8, not a design.
3. Which roles get sensitive-info visibility by default, split by table (pastoral notes / demographics / medical / disabilities)?
4. Should a tier-3 data write itself fire `recordAudit()`?

**Handoff:** pending operator answers to Open Questions 1–2 above. Once confirmed, split into `docs/work-log/2026-08-26-member-roll-on-edit.md` and `docs/work-log/2026-08-26-member-sensitive-info.md` and send each to architect (Phase 2) independently.

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

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
