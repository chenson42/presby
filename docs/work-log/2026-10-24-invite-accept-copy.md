# Platform invite success copy names who must accept — Work Log

> **Slug:** `2026-10-24-invite-accept-copy`
> **Surface:** (admin) — `/admin/organizations/<id>`, the founding-administrator and treasurer invitation notices
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` covers this
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 skipped (no new dependency, directory, schema or API surface; one component and its action's return value). Phase 3 brief.
> **Source:** operator requirement recorded 2026-10-22 (invitations Q1) and carried as a person-emails Phase 6 follow-up: the platform invite success notice should say the designation "takes effect when <name> accepts it from the email". Fold in the low-priority test residual: move the notice strings to a shared copy module so `invitation-sent-notice.test.tsx` imports the real text instead of a copied literal. Must land before Community Increment 2b, which reuses this component.
> **No numbers pre-assigned:** no migration, decision or F-number expected; if one is needed, ask the orchestrator.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (accelerated) | READY WITH NOTES | 2026-10-24 |
| 2 — Architectural review | architect | Skipped — no new dependency, directory, schema or API surface (result shapes in issue.ts grow a display-name field only) | — | 2026-10-24 |
| 3 — Technical design | tech-lead (folded into the implementer, accelerated) | Complete | Design note recorded | 2026-10-24 |
| 4 — Implementation | full-stack-developer | Complete | Gates green (DB-backed tests and e2e not run) | 2026-10-24 |
| 5 — Verification | qa | Run 1 FAIL: long unbroken name overflows the section line and the list For row at 360px; treasurer resend name lacks a DB test | FAIL (run 1) | 2026-10-24 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> After a platform admin sends a founding-administrator or treasurer invitation, the success notice should name who must accept it. The name has to come from the server, because the notice receives no name today, and the copy should live in one plain module that the tests import.

## Findings from the code

- **The notice and its callers.**
  - `invitation-sent-notice.tsx` receives `result`, `address` and `role`, and says "Nobody holds this {role} until it is accepted."
  - It is rendered in three places: after a send in each section, and after a resend inside `invitation-list.tsx`.
  - The founding-administrator section passes `address={undefined}`. The treasurer section passes no address at all. Only the resend path passes one.
  - So after a first send the notice reads "Invitation sent." with no address, while after a resend it names the address. That is an existing inconsistency.
- **Where the name comes from.**
  - **Founding administrator:** the admin types first and last name in the form. `createInvitation` validates them with `normalizePersonName` (NFC, control characters stripped, 1 to 100 characters) and stores them on the invitation row. `InvitationListRow` already carries `inviteeFirstName` and `inviteeLastName`, and the list shows them as "For".
  - **Treasurer:** no name is typed. `resolveTreasurerPerson` finds the roster person by address and refuses with `no_matching_person`, `ambiguous_person` or `membership_ended` otherwise. The invitation stores only `personId`. The lookup selects only `first_name`, which the email greeting uses.
  - **"An address with no person" cannot reach the success notice.** A founding administrator always has a typed name, and a treasurer always has a roster person. The no-name case only arises from missing or legacy data, or from a resend where the name is not threaded through. So a fallback is needed for safety, but it is not a normal path.
  - **What `actions.ts` knows today.** The founding-administrator action has the name (the form fields). The treasurer action does not, because the name lives inside `issue.ts`. The resend result carries no name either.
  - **What this means for the pipeline.** The work-log says "one component and its action's return value", but the `CreateInvitationResult` and `ResendInvitationResult` ok shapes in `issue.ts` must also grow an `inviteeDisplayName` (or equivalent), and `InvitationListRow` must gain it too. Phase 3 should know this. It adds no schema change.
- **What "sent" means.** `delivery` is `"sent"` or `"queued"`. "Sent" means handed to the mail provider after commit. "Queued" means we are retrying. The system never knows the email was delivered or opened. The copy must say "from the email" without promising arrival.

## Proposed copy

Role words stay as they are: "role" for the founding administrator and "access" for the treasurer. The lead line is unchanged ("Invitation sent to {address}." or the queued variant). This replaces the "Nobody holds…" sentence, so it appears once.

| Case | Text |
|---|---|
| Founding administrator, name known | "The founding administrator designation takes effect when {name} accepts it from the email. Until then nobody holds this role." |
| Treasurer, name known | "The treasurer designation takes effect when {name} accepts it from the email. Until then nobody holds this access." |
| No name, address known | "…takes effect when the person at {address} accepts it from the email. Until then nobody holds this {role}." |
| No name, no address | "…takes effect when the invitee accepts it from the email. Until then nobody holds this {role}." |

- The queued lead ("Email delivery is delayed; we'll keep trying.") already precedes the line. Reusing "from the email" is accurate there too, so no separate variant is needed.
- Keep "It expires on {date}." before the new sentence.
- The expiry sentence and the acceptance sentence together are enough. Don't add "check your inbox" style claims.

## "Invitation is open" lines in the two sections

Yes, name the person, using the same source and the same fallback, so the notice and the standing line never disagree.

- **Open:** "An invitation is open for {name}. Nobody holds this role until {name} accepts it. Resend it if the email went astray, or revoke it to invite someone else." Without a name, fall back to today's text unchanged.
- **Expired:** both sections say "An invitation is open" even when the row is `expired`. That is a small untruth that predates this work. Suggested copy: "The invitation for {name} has expired. Nobody holds this role. Resend it or revoke it to invite someone else."
- **Why do it now:** Community Increment 2b reuses the component, and it is cheaper to land one name plumbing than two.
- **Minimum acceptable:** if Phase 3 wants to hold scope, the notice change is required, and the "open" lines can follow as a tracked item. The cost of skipping is that the standing line and the notice would read differently.

## Privacy

- **Founding administrator:** no new exposure. The name is what the admin just typed, and the same name already shows in the "For" row on this page.
- **Treasurer:** this is the one real concern.
  - It would show a roster person's name, resolved from an address the admin typed. Platform admins hold no tenant authority (Two Hierarchies Intersect Nowhere).
  - The page already shows `displayName` for holders after acceptance, so the data class is not new. Success versus refusal already confirms an address is on the roster, but the name makes that a lookup.
  - **Recommendation:** use the roster person's first name only. It is the minimum, and it is already what the email greeting uses. If the operator wants the full name for consistency with the holder list, that is acceptable. It should be an explicit ruling in Phase 3, and the name should be derived server-side with the same display-name rule as `designation-holders.ts`.
- **Connection:** the name must come from the `getPlatformDb` path inside `issue.ts`, as today. No RLS change is needed and the notice never reads the database.

## Permissions & Flags

- **Permission:** `FEATURES.ADMIN_ORGANIZATIONS` is unchanged. It is already checked in every action.
- **Flag:** not needed. Per the standing operator preference, no new platform flag. This is a copy change.
- **Audit:** no new audit event. `invitation.created` already fires inside `issue.ts`.
- **Release notes and what's-new:** this is internal admin tooling, so no what's-new entry is needed.

## Gaps the Request Didn't Address

1. **Resend.** The notice also renders after a resend, with the address from the invitation row. If the name is not threaded through there, resend reads differently from send. Resolve it by adding the name to the resend ok result as well. The founding administrator's name is on the row, and the treasurer's comes from `people` (the resend path already queries `first_name`).
2. **Treasurer name in the list.** Treasurer rows have no "For" line today. Adding the server-derived name to `InvitationListRow` fixes the notice, the open line and the list at once.
3. **Missing address after first send.** The sections pass no address, so the first-send notice drops "to {address}". Pass the submitted address, so the fallback "the person at {address}" is not needed in practice.
4. **Self-addressed invite.** The dialog already warns, and the audit records `selfAddressed`. "Takes effect when {name} accepts" is still true, so no copy change. Don't suppress the existing warning.
5. **Name with unusual characters.**
   - React escapes the name, so injection is not a concern. The name can be up to 100 characters per part, so make the notice wrap (`break-words`), as the list does for the address.
   - `normalizePersonName` strips control characters but not bidi overrides (U+202A to U+202E, U+2066 to U+2069). A name containing them could visually reorder the sentence. The admin typed it and is the only viewer, so the risk is low. Phase 3 should either strip bidi controls in the normalizer or accept the residual explicitly.
6. **Copy module placement and shape.**
   - `actions.ts` is `'use server'` and can export only async functions. The module must therefore be plain and importable by the server action, the client notice and the tests, with no `server-only` and no `@/lib/db`.
   - Suggested location: `src/lib/onboarding/invitation-copy.ts`, next to `designation-holder-copy.ts`.
   - It should hold the sentence builders and the warning string. The test must import them, so a copy edit fails loudly.
   - The existing `INVITATION_WARNING_COPY` stays keyed by `InvitationWarning`.
7. **Existing tests.** Section, list and `actions.test.ts` assertions on "Nobody holds this…" will change. The new tests should cover each row of the copy table, the resend path, and an expired row.
8. **Adversarial pass.**
   - There is no new redirect or user-controlled URL, so there is no state-machine or enumeration change. The name is server-derived and the admin-typed name is already server-validated.
   - The one enumeration-adjacent point is the treasurer name above, so keep it first-name only or rule explicitly.
   - Server-side validation of the founding name is already in place, with 100-character limits and a repeat check in `createInvitation`.

## Out of Scope (confirm)

- Reworking the do-not-contact flow or the other refusal copy.
- Naming the person in the revoke dialog or the other list rows beyond the "For" fill-in.
- Delivery-status tracking (delivered or opened). The copy deliberately claims only "sent" or "queued".

## Open Questions

- **Treasurer name.** Is first name only acceptable, or does the operator want the full display name? My recommendation is first name only.
- **"Open" lines in this pipeline.** Include them now (my recommendation), or defer them as a tracked follow-up?

## Handoff

The next phase is Phase 2, skipped per the work-log (no new dependency, directory or schema), so the next agent is the **tech-lead** for Phase 3. Phase 3 should carry the notes above: the `issue.ts` result-shape growth, the resend path, the treasurer first-name ruling, the bidi residual, and the `invitation-copy.ts` module.

## Orchestrator defaults on the open questions (2026-10-24)

Taken on the analyst's recommendations so the pipeline can proceed; the operator can overrule at review.
- **Treasurer name:** first name only (the minimum; what the email greeting already uses).
- **"Invitation is open" lines:** included in this pipeline, with the expired-row correction.

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

*Accelerated: tech-lead folded into the implementer for a change this size.*

## Summary

After a founding-administrator or treasurer invitation is sent or resent, the success notice names who must accept ("takes effect when {name} accepts it from the email"), and the section's standing "invitation is open" line names the same person, with a corrected line for an expired row. The name is derived on the server and carried on the create and resend results and on `InvitationListRow`; all the strings live in one plain module that the server action, the client components and the tests import. No schema change, no new flag, no new permission, no new audit event.

## Permissions & Flags

- Permission: existing `FEATURES.ADMIN_ORGANIZATIONS`, already checked in every invitation action. Unchanged.
- Flag: not needed. Audit: no new event (`invitation.created` / `invitation.resent` already fire inside `issue.ts`).

## API Contract

No new route or action. Result shapes grow one field:

- `CreateInvitationResult` ok and `ResendInvitationResult` ok: `inviteeDisplayName: string | null`.
- `InvitationListRow`: `inviteeDisplayName: string | null`.
- `InvitationActionResult` ok: `inviteeDisplayName?: string` (key omitted when null, like `warnings`).
- `InvitationSentNotice` props: `role: string` becomes `purpose: "founding_administrator" | "treasurer"` (the role word is derived from it); `InvitationList` likewise.

## Data Model

No schema changes required. The treasurer's name is read from `people.first_name` through the platform connection already used in `issue.ts` (a left join in `listInvitationsForOrg`; the existing single-row select in `resendInvitation`; the already-resolved person in `createInvitation`).

## Decisions

- **Treasurer name: first name only** (orchestrator default). Derived by `deriveInviteeDisplayName` in the plain module, the one place the rule lives; the founding administrator's name is the typed first + last already stored on the row.
- **Fallbacks:** name, then "the person at {address}", then "the invitee".
- **"Open" lines included**, with the expired-row correction. An expired row never says "open": with no derivable name the expired line is the named line minus the name (coordinator ruling after the first Phase 4 commit; the earlier fallback to the "open" wording kept the Phase 1 untruth).
- **Address on first send:** each section keeps the submitted address in state (set in `onSent`, because the field clears on success) and passes it to the notice, so the lead line reads "Invitation sent to {address}." on first send as it already did on resend.
- **Warning text** moves from `actions.ts` to the module as `INVITATION_WARNING_COPY`; the action still maps the code to the sentence server-side; the notice test and the action test import it rather than copy it.
- **Bidi residual: stripped, not accepted.** `normalizePersonName` now also removes U+202A-U+202E and U+2066-U+2069 (test added). It is shared with the accept path (`accept.ts`), so an invitee's own name is cleaned the same way; no existing test signalled intent to keep those characters.

## Component / Page Plan

- Create: `src/lib/onboarding/invitation-copy.ts` (+ test).
- Modify: `issue.ts`, `input.ts`, `actions.ts`, `invitation-sent-notice.tsx`, `invitation-list.tsx`, `founding-administrator-section.tsx`, `treasurer-designation-section.tsx`, fixture and the affected tests; `e2e/admin-organizations.spec.ts` (old sentence).

## Edge Cases & Risks

- The e2e "same screen whether or not the address has an account" check compared two notices byte for byte; the notice now carries the typed address and name, so the spec masks those two values before comparing (the enumeration property it guards is unchanged: nothing in the notice depends on account existence).
- A very long name wraps (`break-words`) in the notice and the list "For" line.
- Self-addressed send: the existing dialog sentence and audit flag are untouched; "takes effect when {name} accepts" stays true.
- Residual: an invitation row whose treasurer person is missing or has an empty first name yields a null name; the notice falls back to the address wording and the pending section line to the unnamed text (the expired line is unnamed but still says "expired").

## Copy

| Case | Text |
|---|---|
| Founding administrator, name | "The founding administrator designation takes effect when {name} accepts it from the email. Until then nobody holds this role." |
| Treasurer, name (first name) | "The treasurer designation takes effect when {name} accepts it from the email. Until then nobody holds this access." |
| No name, address | "... takes effect when the person at {address} accepts it from the email. Until then nobody holds this {role}." |
| No name, no address | "... takes effect when the invitee accepts it from the email. Until then nobody holds this {role}." |
| Section, pending, name | "An invitation is open for {name}. Nobody holds this {role} until {name} accepts it. Resend it if the email went astray, or revoke it to invite someone else." |
| Section, expired, name | "The invitation for {name} has expired. Nobody holds this {role}. Resend it or revoke it to invite someone else." |
| Section, pending, no name | the previous unnamed "An invitation is open. ..." text, unchanged |
| Section, expired, no name | "The invitation has expired. Nobody holds this {role}. Resend it or revoke it to invite someone else." |

The expiry sentence stays before the acceptance sentence; the lead line (sent / queued) is unchanged. The copy claims only "from the email", never delivery or opening, and describes no account or roster fact beyond the first name already used in the email greeting.

## Implementer

full-stack-developer (this agent).

---

# Phase 4 — Implementation

## Files Created

- `src/lib/onboarding/invitation-copy.ts` — the plain copy module: `acceptanceSentence`, `openInvitationLine`, `expiredInvitationLine`, `inviteeReference` (fallbacks), `deriveInviteeDisplayName` (founding: typed name; treasurer: roster first name only), `INVITATION_WARNING_COPY`, `INVITATION_ROLE_WORD`. No imports.
- `src/lib/onboarding/invitation-copy.test.ts` — every copy-table row, the fallbacks, open/expired lines, the first-name derivation.

## Files Modified

- `src/lib/onboarding/issue.ts` — `inviteeDisplayName` on the create and resend ok results and on `InvitationListRow` (left join to `people` in `listInvitationsForOrg`, platform connection); `InvitationWarning` now aliases the module's code type.
- `src/lib/onboarding/input.ts` (+ test) — `normalizePersonName` strips U+202A-U+202E and U+2066-U+2069.
- `src/lib/onboarding/boundaries.test.ts` — the new file joins the "pure files import nothing server-side" list.
- `src/lib/onboarding/issue.db.test.ts` — assertions for the display name on create (both purposes), resend, and the treasurer list row. **Not run** (DB-backed; no `.env.local` here).
- `(admin)/admin/organizations/[id]/actions.ts` — warning copy imported from the module (local copy removed); `inviteeDisplayName` passed through on create and resend (key omitted when null).
- `.../invitation-sent-notice.tsx` — `role` prop replaced by `purpose`; the "Nobody holds this ..." sentence replaced by `acceptanceSentence`; expiry sentence stays before it; `break-words`.
- `.../invitation-list.tsx` — `purpose` prop; "For" line now the server-derived name (treasurer rows get one), `break-words`.
- `.../founding-administrator-section.tsx`, `.../treasurer-designation-section.tsx` — keep the submitted address in state and pass it to the notice; standing line uses the open / expired builders.
- Tests: `invitation-sent-notice.test.tsx` (copy-table rows, warning imported, queued, break-words, revoke), `invitation-list.test.tsx` (resend names founding and treasurer, For line), both section tests (open, expired, no-name fallback, first-send address and name), `actions.test.ts` (name pass-through and omission, resend, warning imported), `invitation-row.fixture.ts`.
- `e2e/admin-organizations.spec.ts` — old sentence assertions replaced; the "same screen whether or not the address has an account" comparison masks the typed address and name first. **Not run.**

## Schema Changes

- none.

## Audit Events

- none new (`invitation.created` / `invitation.resent` unchanged).

## Implementer Notes

- Gates (worktree, no `.env.local`): `npm run typecheck` clean; `npm run lint` clean; `npm run check` all eight pass; `npm test` 522 files passed, 77 skipped; 8029 tests passed, 2441 skipped (the DB-backed files skip without a database); `npm run build` passes with placeholder env vars supplied on the command line only (it fails without a `DATABASE_URL` at page-data collection, an existing property of the build).
- Not run, need a database: `issue.db.test.ts` (new display-name assertions), the other `*.db.test.ts` files, and the e2e spec. No browser check was possible (no database); QA runs e2e.
- The treasurer function-level derivation is unit-tested in `invitation-copy.test.ts` (pure); its use inside `issue.ts` is covered only by the unrun DB test.
- Deviation from the brief: `InvitationSentNotice` and `InvitationList` take `purpose` instead of `role` (the role word is derived, so the two cannot disagree).
- Follow-up commit (`fix(admin)`, Caught-By agent-review, Discovered-In Phase-4): an expired row with no derivable name now gets "The invitation has expired. Nobody holds this {role}. ..." instead of falling back to the "open" wording; `invitation-copy.ts` changed, both sections already routed expired rows through it; tests added for the module and both sections.

## Phase 4 — QA fix pass (after Run 1 FAIL)

- **Overflow at 360px, items 1 and 2.** A 100 + 100 character unbroken name ran off the screen in the standing open/expired line and in the list "For" row. Causes and fixes:
  - The open/expired `<p>` in both sections had no wrap rule: added `[overflow-wrap:anywhere]` (`founding-administrator-section.tsx`, `treasurer-designation-section.tsx`).
  - The list `<dl>` was a one-column grid whose implicit track is `auto`, and its grid item and the `<dd>` flex child both default to `min-width: auto`, so the long name sized the row to its own min-content (`break-words` alone does not help there). Fixed in `invitation-list.tsx` with `grid-cols-1` on the `<dl>`, `min-w-0` on the "For" grid item and its `<dd>`, and `[overflow-wrap:anywhere]` on the `<dd>`. The address row already uses `break-all` and is unchanged; it passed the new check.
- **Test first.** A new e2e case (`e2e/admin-organizations.spec.ts`, "long unbroken name at 360 px", own throwaway org) sends a founding-administrator invitation with 100 + 100 unbroken characters, then asserts that no element in the section has its right edge past the viewport, no element's content is wider than its box (text that overflows its own box does not move the box's edge, so the first version of the check missed the `<p>`), and the document has no horizontal scroll. It failed on the unfixed code (section, `p`, `ul`, `li`, `dl`, `dd` all flagged) and passes after the fix.
- **Item 3.** `issue.db.test.ts`: a treasurer resend returns `inviteeDisplayName` equal to the roster first name ("Odalys"), asserted not to contain the last name ("Pennick").
- **Gates:** typecheck, lint and all eight `npm run check` tripwires pass; `npm test` 8031 passed, 2442 skipped (the DB-backed files), 0 failed; `npm run test:db -- src/lib/onboarding/issue.db.test.ts` 63/63 passed; e2e from a scratch copy on port 3430: the whole `admin-organizations.spec.ts` 25/25 passed (including the new case). Scratch copy and dev server removed afterwards.
- The treasurer's long-first-name case is not separately asserted in e2e; it renders through the same two components and the same classes.

# Phase 5 — Verification (qa)

## Run 1 — FAIL

**Date:** 2026-10-24
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-invite-copy`, `pipeline/invite-accept-copy` at `dbd1d8f` (feat `e4452d8` + fix `dbd1d8f`). DB and e2e ran against the worktree's own `.env.local` (Neon branch `pipeline-invite-copy`; its host differs from the main checkout's). No values were printed and no repo file was edited.

**Scope run:**
- **In full:** typecheck, lint, `npm run check` (all eight tripwires), the unit suite, `npm run build`.
- **DB:** `npm run test:db -- src/lib/onboarding` (all 16 files).
- **e2e (dev server on port 3420, run from a scratch copy in /private/tmp that was deleted afterwards):** the four named specs in full, which include their 360px tests. Also a QA-only long-name spec at 360px, scratch-only and never committed.
- **Not run:** `test:e2e:prod`. No `e2e/hydration/` spec renders the notice or the two sections. The full e2e suite was also not run: the diff touches no proxy, auth, layout, `e2e/support/` or shared component.
- **Not auth-touching.** The stricter gate does not apply.

## Type Check

`npm run typecheck`: PASS

Also passed:
- `npm run lint`
- `npm run check`: all eight tripwires pass (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`, `check:secrets`, `check:hydration-gate`, `check:giving-boundaries`, `check:proxy-imports`).
- `npm run build`

## Unit Tests

**Total: 10472 | Passed: 8031 | Failed: 0 | Skipped: 2441 (77 files) | Duration: 23.8s**

- The 77 skipped files are the database-backed set, which skips without a database in `npm run test`. The implementer's run reported the same 77, and the diff adds no `.skip`, `skipIf`, `.only` or `fixme`.
- 8031 is 2 more than the implementer's 8029, from the follow-up fix commit.

**DB-backed, `npm run test:db -- src/lib/onboarding`:**
- **Run 1:** all 269 tests passed (16 files). The file `issue.db.test.ts` was still reported failed, because its `afterAll` teardown hit the 30s hook timeout (`src/lib/onboarding/issue.db.test.ts:194`).
- **Run 2, that file alone:** 62/62 passed and teardown completed.
- This is a cold-compute teardown timeout, not a test failure. The other 15 files passed: `accept.db`, `designation-holders.db`, `designation-parity.db`, `invitations.db` and the pure onboarding tests.

## End-to-End Tests

**Total: 37 | Passed: 37 (after one re-run) | Failed: 0 | Duration: 4.1m**

- **Specs:** `e2e/admin-organizations.spec.ts` (whole file), `e2e/invitation-new-account.spec.ts`, `e2e/invitation-existing-account.spec.ts` and `e2e/designation-revoke.spec.ts`, all on `--project=chromium`.
- **360px tests in these specs:** `admin-organizations.spec.ts:197` and `:886`, and `designation-revoke.spec.ts:317`. All passed.
- **Run 1:** 36 passed, 1 failed at `e2e/admin-organizations.spec.ts:582` (service times and office hours: the "Office hours saved." status was not visible within 15s). The diff does not touch service times.
- **Run 2, that test alone:** passed. Not a regression and not a FAIL of this pipeline.
- Both changed assertions pass: the treasurer notice and open line (`:777`, `:779`), and the founding-administrator notice comparison with the address and name masked (`:981`, `:1048`).

**QA long-name check at 360px (scratch spec, deleted afterwards):**

| Case | Notice | Section open line | List "For" row | Page sideways scroll |
|---|---|---|---|---|
| Founding admin, long names with spaces (51 + 49 chars) | wraps | wraps | wraps | none |
| Treasurer, long first name with spaces | wraps | — | — | none |
| Founding admin, unbroken 100 + 100 chars (passes validation) | **wraps** | **overflows** | **overflows (right edge 1501px)** | **yes, document 1501px wide** |
| Treasurer, unbroken 100-char first name | wraps | not measured (screenshot taken mid-render) | not measured | none at capture |

The notice itself is correct in every case. The overflow is in the two surfaces next to it, which this diff also changed (see Verdict, items 1 and 2).

## Regression Tests Added

The fix commit's 3 tests were checked on a scratch export of `dbd1d8f` with the pre-fix `invitation-copy.ts` from `e4452d8`. All 3 fail there and pass at HEAD.
- **`expired, no name: the same line minus the name, never 'open'`** (`src/lib/onboarding/invitation-copy.test.ts:81`) guards against an expired row with no name falling back to the "An invitation is open" wording.
- **`an expired invitation with no name still says expired, never 'open'`** (`src/app/(admin)/admin/organizations/[id]/founding-administrator-section.test.tsx:432`): same guard, founding-administrator section.
- **Same test name** (`src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.test.tsx:239`): same guard, treasurer section.
- **`strips bidirectional override, embedding and isolate controls …`** (`src/lib/onboarding/input.test.ts:33`): fails against `origin/main`'s `input.ts`, passes at HEAD.
- **Style only:** none of these carry the `— regression for [bug]` suffix.

## Copy Truthfulness and Bidi Audit

- **No delivery claim.**
  - Every string in `src/lib/onboarding/invitation-copy.ts` claims only "from the email".
  - The lead line is unchanged: "sent" means handed to the provider; "queued" says delivery is delayed.
  - Nothing says delivered, opened or "check your inbox". `invitation-copy.test.ts:43` asserts this.
- **Expired lines never say "open".** Verified in `expiredInvitationLine` and in both sections' `status === "expired"` branch, and by the 3 regression tests above.
- **Fallback chain works.** It goes name, then "the person at {address}", then "the invitee" (`inviteeReference`). It is covered in the module test and in the notice test for all four rows of the copy table. Both sections now pass the submitted address, so a first send reads "Invitation sent to {address}."
- **Treasurer shows the first name only.**
  - `deriveInviteeDisplayName` returns only `rosterFirstName` for a treasurer.
  - The DB test pins `inviteeDisplayName: "Odalys"` with `inviteeFirstName: null` on both the create result and the list row (`issue.db.test.ts:385-387`).
  - In the scratch e2e, a treasurer with last name "Roster" never showed "Roster".
  - The shipped e2e assertion at `admin-organizations.spec.ts:777` uses `.+`, so it would not catch a full name. The DB test is what pins this.
- **The warning is imported, not copied.**
  - `invitation-sent-notice.test.tsx:4-7` and `actions.test.ts:152` import `INVITATION_WARNING_COPY`.
  - A grep finds the literal only in `invitation-copy.ts`.
  - `actions.ts` imports it and keeps no local copy.
- **Bidi strip blast radius.**
  - `normalizePersonName` is called only by `issue.ts` (founding create) and `accept.ts:169-172` (new-account first and last name).
  - Names are never used to match or compare: acceptance matches by token hash, address and `person_id` in `presby_accept_invitation`.
  - Existing stored names are never re-normalized.
  - Stripping happens before trimming, and a name made only of bidi characters becomes null and is refused as `invalid_input`.
  - So no existing invitation can stop matching.
- **Bidi residuals, non-blocking:**
  - LRM, RLM and ALM (U+200E, U+200F, U+061C) are not stripped. The test comment says "benign marks are untouched" but no test covers them.
  - The zod `inviteeNameSchema` checks `.max(100)` before the strip, so 100 characters plus a bidi character is refused rather than cleaned.
  - The SQL `[[:cntrl:]]` check does not cover these format characters. The protection is application-level only.
- **Wording note for Phase 6, not a defect.** "Takes effect when {name} accepts it" is conditional in practice. Acceptance can still be blocked at accept time (`has_holders`, `membership_ended`, `person_merged`). The existing "Note." warning already qualifies the self-addressed case. Phase 1 approved this wording.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100%
- `src/lib/two-factor.ts`: 91.3% statements (lines 35-39 uncovered; target 90%+, met)
- `src/lib/flags.ts`: 100%
- Changed pure modules: `src/lib/onboarding/invitation-copy.ts` 100%, `src/lib/onboarding/input.ts` 100%

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `inviteFoundingAdministratorAction` (`actions.ts:850`) | yes (`:853`) | yes (`:855`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `inviteTreasurerAction` (`actions.ts:897`) | yes (`:900`) | yes (`:902`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `resendInvitationAction` (`actions.ts:958`) | yes (`:961`) | yes (`:963`) | `FEATURES.ADMIN_ORGANIZATIONS` |

- No route handler was added or changed.
- The new `inviteeNameFor` helper is a sync function that is not exported, which a `"use server"` file allows. The build confirms it.
- The treasurer name read stays on the `getPlatformDb()` path inside `issue.ts`; there is no RLS change.
- Schema/RLS audit: not applicable. No schema change.

## Verdict

**FAIL.** Hand back to **full-stack-developer** (Phase 4). This is not a design problem, so no Phase 3 escalation.

1. **The section's open and expired line overflows at 360px with a long unbroken name. This is new in this diff.**
   - Where: `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx:215` and `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.tsx:153`.
   - The `<p className="mt-1 text-sm text-foreground">` now contains the name, twice in the open line, with no wrap rule.
   - Result: an unbroken 100 + 100 character name (which validation accepts) made the document 1501px wide at 360px.
   - Phase 1 Gap 5 asked for the name to wrap wherever it appears.
2. **The "For" row in the list still overflows, despite `break-words`.**
   - Where: `src/app/(admin)/admin/organizations/[id]/invitation-list.tsx:126-128`.
   - `<dd className="break-words">` sits inside `<div className="flex gap-1">`. A flex child keeps `min-width: auto`, so `overflow-wrap` never takes effect. It needs `min-w-0` (or `[overflow-wrap:anywhere]`).
   - The Phase 3 edge case ("a very long name wraps (`break-words`) in … the list 'For' line") is therefore false.
   - It already overflowed before this diff for founding names, but this diff claims to fix it and now also shows treasurer names there.
   - The founding-name case was measured. The treasurer list and open line were not (the screenshot was mid-render), but they use the same markup.
3. **No DB-backed test for the treasurer resend name.**
   - `resendInvitation`'s treasurer branch (`src/lib/onboarding/issue.ts:739-746`, `:807-817`) is new code with no DB test. `issue.db.test.ts:825` seeds only a founding-administrator row.
   - Its only coverage is `invitation-list.test.tsx:148`, which mocks the action to return the very value it then asserts.
   - Phase 1 Gap 1 named this path. It needs one `issue.db` case: resend a treasurer invitation and expect `inviteeDisplayName` to be the roster first name.

To close items 1 and 2, add a 360px assertion with a long unbroken name to `e2e/admin-organizations.spec.ts`: no element in the section past 360px after a send. Write it before the fix and watch it fail. The existing `:886` test only measures the treasurer form state.

**Non-blocking notes for Phase 6:**
- The bidi residuals listed above.
- The conditional "takes effect when … accepts" wording.
- The treasurer e2e regex `.+` does not pin first-name-only (the DB test does).
- The regression tests lack the `— regression for` suffix.
- Treasurer list rows now show the live roster first name on every row, including ended and redacted ones. This fits the 0059 "names retained after redaction" residual, but it is new for treasurer rows.

---

**Per-Phase Status row:**

| 5 — Verification | qa | Complete | FAIL (narrow-viewport overflow ×2; treasurer resend name has no DB test) | 2026-10-24 |

**Handoff:** next agent is **full-stack-developer** (Phase 4 fix pass), with items 1-3 above. QA re-runs the changed tests, the 360px check and `test:db -- src/lib/onboarding/issue.db.test.ts`. Typecheck, lint, check and the unit suite run in full again; everything else that passed here stands.

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
