# First enrolment loses the recovery codes and callbackUrl (F166) — Work Log

> **Slug:** `2026-10-26-recovery-codes`
> **Surface:** (account) `/account/2fa` first enrolment
> **Permission(s):** existing (none new)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Numbers (pre-assigned):** F166 (existing); DECISION-292 if a decision results; no migration expected (0081 reserved); dev port 3650
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-f166`, branch `pipeline/recovery-codes`, from `main` at 0.46.2; Neon branch `pipeline-recovery-codes` (`br-polished-smoke-axhaks99`, `ep-shy-sound`)
> **Operator, 2026-10-26:** Community 2b ships but real sign-in invitations are **held until F166 is fixed**.
> **TODO line (verbatim, docs/TODO.md:167):** **F166 bug-fix pipeline (HIGH — before the first non-operator invitee): `/account/2fa` first enrolment loses the recovery codes and `callbackUrl`.** `completeEnrollment()`'s `revalidatePath("/account/2fa")` replaces the client "enabled" panel with the management view within about a second, so the recovery codes vanish and the "Continue" link (and its preserved `callbackUrl`) is lost; the fresh-codes cookie is read only on the next load, and enrolling does not verify the session, so the account answers one more `/totp` challenge. Every new invitee goes through it. F342 (the enrolment secret race, 0.46.2) does not change this; it remains HIGH, before the first non-operator invitee. — `docs/work-log/2026-10-21-invitations.md` Batch 4, Phase 6; `docs/work-log/2026-10-26-totp-enroll-race.md` Phase 6

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; mechanism confirmed; adjacent HIGH finding F344 (regenerate bypasses the second factor); three Phase 3 decisions | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst) — F166, bug-fix variant (brief)

## VERDICT

**READY WITH NOTES.** The bug is real and the mechanism is confirmed from code, with two points that need a running server. Phase 3 must settle three things before Phase 4:

1. The shape of the fix.
2. Whether enrolment verifies the session.
3. The finding below, which is not F166 but sits in the same file: **`regenerateRecoveryCodes` can bypass the second factor.**

## ONE-LINE TAKE

> A new invitee finishes setting up their authenticator and is left on "10 unused codes remaining" with no codes, no Continue link and no landing page. The fix must keep the codes visible once and keep the `callbackUrl`. It must not weaken the rule that only a server-side verification grant marks a session verified.

## Mechanism, confirmed from code

- **Replacement of the panel.** `completeEnrollment()` (`actions.ts:127-131`) writes `userTotp`, deletes the pending row, replaces the recovery-code hashes, sets the fresh-codes cookie, writes `TOTP_ENROLLED`, then calls `revalidatePath("/account/2fa")`.
  - In `page.tsx:41-77`, `existing` is now true, so the page renders the management view.
  - That view is a different component tree from `TotpEnrollForm`. React discards the form's `enrolled` and `recoveryCodes` state, and with it the "Recovery codes — save these now" panel and the `Continue` link (`totp-enroll-form.tsx:84-120`).
  - The management view has no Continue link, and nothing in it reads `callbackUrl`.
- **Possible second trigger (unverified, needs a running server).** In Next, a server action that sets a cookie also re-renders the current route. If so, dropping `revalidatePath` alone would not stop the replacement, because `setFreshRecoveryCodesCookie` would still trigger it. Phase 3 must test this on a dev server before choosing an option.
- **The cookie path.**
  - The management view renders `<FreshRecoveryCodes>` from the cookie (`page.tsx:68-73`), and that component clears the cookie on mount (`fresh-recovery-codes.tsx`).
  - The 2b walk saw no codes, so either the re-render did not see the cookie it had just set, or the walk never reloaded. The TODO says "read only on the next load".
  - Either way, even a successful cookie render has no Continue link and no `callbackUrl`.
- **The extra challenge.**
  - Enrolment does not mark the session verified. Only `verifyTotpAction` does, via `withTwoFactorGrant` plus `unstable_update({})` (`(auth)/totp/actions.ts`, DECISION-230).
  - A required, unverified user who clicks Continue to `/o/<slug>` or `/admin` is bounced by the proxy to `/totp?callbackUrl=<pathname>` (`proxy.ts:158-163`) and must enter a code again. This is E-35 in 2b.
  - `verifyToken` has no replay guard, so the same code works in the same 30-second step.

## F343 interplay

F343 (`presby-2fa`, 2026-10-26) is unmerged and not in this worktree. Once it ships, new plain members default to `two_factor_required = false`.

- They will reach `/account/2fa` only voluntarily. For them F166 is a smaller problem: the recovery codes are still lost on first view, but there is no forced extra challenge.
- Administrators and treasurers, and any person on a permission or congregation that requires two-factor, will still enrol on the way in. They are the people holding the most authority, and they hit F166 in full.
- The fix therefore must not assume "required". Voluntary enrolment from `/account` with no `callbackUrl` is a first-class case. Continue falls back to `/launch`.
- The fix is independent of F343 and does not need to wait for it. Neither pipeline should edit the other's files. F343 touches `local-login.ts` and the migration; this one touches `(account)/account/2fa/*` and possibly `completeEnrollment`.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Newly invited member, administrator or treasurer (authenticated, unenrolled, usually `twoFactorRequired`) | Scan the QR, type six digits (auto-submits, DECISION-257), read and save ten recovery codes, click Continue | one-time |
| Any authenticated member | Enrol voluntarily from `/account` with no `callbackUrl` | one-time, on demand |
| Enrolled member | Regenerate recovery codes | on demand |
| Administrator enrolling from `/admin` | The same, with Continue returning to `/admin` | one-time |

## Flows

**Flow 1 — forced first enrolment (the broken one).** Invitation accepted, then `/totp` or `/account/2fa?callbackUrl=<dest>` → QR → six digits → **expected:** a panel with the ten codes that stays until the user chooses to leave, then Continue to `<dest>` → challenge, or no challenge if the fix verifies the session. **Today:** the panel is replaced within about a second.
- Failure: a wrong code gives the toast "That code did not match. Try again."; the pending row expired gives "Reload the page to start over."
- Failure not covered: the action commits but the response is lost (network or phone sleep). The user is enrolled with unseen codes, sees the management view, and the only recourse is Regenerate.

**Flow 2 — voluntary enrolment from `/account`.** Same, no `callbackUrl`, Continue goes to `/launch`.

**Flow 3 — reload, back button or second tab while the codes show.** Today the codes are gone and nothing on the page leads onward. Behaviour to be chosen in Phase 3 (see Gap 3).

**Flow 4 — regenerate.** `RegenerateCodesForm` shows its own panel from client state. Because `regenerateRecoveryCodes` also sets the cookie and calls `revalidatePath`, the page may render two code panels (the cookie one and the form one), or neither. This is unverified and the same class of defect, so the design should cover it too.

## Permissions & Flags

- **Permission(s):** none. `/account/2fa` is auth-only by design (proxy fall-through, `proxy.ts:183-199`). No `FEATURES.*` key is added.
- **Flag(s):** not needed. This is a bug fix, and the operator has ruled against new platform flags before go-live. Rollback is revert.
- **Audit:** `TOTP_ENROLLED` must keep firing on every enrolment. If the fix verifies the session, either add a distinct action or put `method: "enrolment"` in the metadata, so a challenge-verified session and an enrolment-verified session stay distinguishable in `audit_events`.

## Gaps the Request Didn't Address

1. **`regenerateRecoveryCodes` bypasses the second factor (new, HIGH, adjacent).**
   - The action checks only `auth()` and that an enrolment row exists (`actions.ts:134-150`). It never checks `twoFactorVerified`.
   - `/account/2fa` is not 2FA-gated in the proxy (gated paths are `/admin`, `/o/*`, `/developer`).
   - So a person with only the first factor (a stolen or phished password) can sign in, open `/account/2fa`, click Regenerate, read ten fresh codes, and use one at `/totp`. That defeats the second factor for every enrolled account.
   - It is pre-existing and not caused by F166. It matters here because the operator is about to let non-operators in, and any fix that touches this file or marks sessions verified should not leave it open.
   - Recommendation: Phase 3 adds a `twoFactorRequired && !twoFactorVerified` refusal to the regenerate action, in the same style as `(invite)/actions.ts:225`. Or the orchestrator splits it to its own tracked bug fix with a new F-number, decided before invitations open. Either way, name it to the operator.
2. **Recovery codes appear in two places.**
   - A plaintext copy sits in an httpOnly, SameSite=Strict cookie for 5 minutes, and in client state.
   - "Shown exactly once, never re-derivable later" is the invariant. The cookie is a 5-minute carve-out, not a violation. It becomes a liability if the client panel is the real display and the cookie is redundant.
3. **"Once" versus "survives a reload" is a real choice.**
   - Strictly once means a lost response, a reload or a locked phone costs the user the codes, and Regenerate (gap 1) becomes their only path.
   - Holding the cookie until Continue or an explicit "I've saved these" would survive a reload for up to 5 minutes. It slightly loosens "once", though still nothing durable re-derives them.
   - Phase 3 should state which, and the copy must match.
4. **The management view has no way onward.**
   - After any reload, back button or second tab it shows "You enrolled on…" and a regenerate form, with no Continue.
   - The 2b walk found "← Home" at 17px tall (below the 44px target).
   - Suggested resolution, independent of the other options: when the URL carries a `callbackUrl`, the management view renders a full-width Continue button (44px) to the sanitized target. That covers reload, back and a second tab for free.
5. **No copy or download affordance.** Ten codes in a 2-column grid at 360px, and the only way to save them is to screenshot. A "Copy all" button is low cost and out of the original TODO line. Phase 3 may include it or defer it with a note.
6. **The extra `/totp` challenge is a second-order UX defect** (E-35). A person who just proved possession of the authenticator is asked to prove it again at once.
7. **Authenticator-only steps are untested end to end.** The 2b e2e uses a workaround (`enrolOnPage`, TODO line 429) that F342 makes removable. The F166 regression test must assert what the person sees, not only that `completeEnrollment` returned.

## Adversarial Pass

- **Redirect target.** Continue uses `callbackUrl` from props. The page sanitizes it with `sanitizeCallbackUrl` (`page.tsx:30`), which falls back to `/launch`.
  - Any new use, such as a Continue in the management view or a server-side redirect, must go through the same function. The client must not receive the raw query string.
  - A `callbackUrl` of `//evil.example`, `/\evil` or `/.//evil` is already covered by the sanitizer's tests. The new Continue needs one test that proves it uses the sanitized value.
- **Marking the session verified at enrolment.** Safe only if all of these hold:
  - The mark goes through `withTwoFactorGrant(userId, "totp", () => unstable_update({}))` inside `completeEnrollment`, the same pattern as `verifyTotpAction`. A client update or a payload field must never be a path (DECISION-230).
  - `completeEnrollment` refuses when `userTotp` already exists for the user. Today it silently replaces the secret through `onConflictDoUpdate`. Without that guard, marking verified would turn "has a pending row" into "can replace my second factor and be verified", which a first-factor-only session must not be able to do.
  - The verified claim is minted only after `verifyToken` has passed against the user's own pending secret. That is a real possession proof for a never-enrolled account.
  - It adds no attacker power for a never-enrolled account: today an unenrolled account is walked from `/totp` to `/account/2fa` to enrol and then challenged with the secret the attacker just chose, so the attacker already ends up verified in two steps.
  - It is not safe for an already-enrolled account unless the guard above exists.
  - The grant module must stay un-exported from any `'use server'` file; calling it inside an action is fine.
  - Judgment: this is safe if (and only if) those conditions hold. It belongs in Phase 2 for an architect ruling because it adds a second grant call site.
- **State-machine shortcut.** Hitting `/account/2fa` while enrolled shows the management view, which is fine. `completeEnrollment` is a server action callable directly: it needs a pending row, which only the page creates for an unenrolled user. Keep that.
- **Enumeration.** Nothing new. The two action errors do not distinguish accounts.
- **Input boundaries.** `code` is validated server-side by `verifyToken`. The six-digit regex is a client convenience only and must stay that way.
- **Self-targeting.** An administrator enrolling themselves is not an admin-only action. No concern.
- **No secret logged.** Neither the codes, the cookie value, nor the TOTP secret may reach `console`, the audit metadata or an error string. `TOTP_ENROLLED` carries no metadata today; keep it so.

## Edge Cases the Request Didn't Mention

- **Reload while the codes are showing.** See Gap 3. At minimum the reloaded page must offer Continue.
- **Back button after Continue.** The enrol URL now shows the management view. A cached copy of the old form with a deleted pending secret would give "No pending enrollment found. Reload the page to start over." Confirm the router cache does not hold the stale form. Next 16 defaults to not caching dynamic pages, but it is unverified.
- **Second tab.** Tab B shows the enrol form; tab A enrols; tab B's code returns "No pending enrollment found". Acceptable, but the message should say "You may already have enrolled in another tab" rather than "start over". This is minor and may be deferred.
- **`callbackUrl` to `/o/<slug>`, `/admin`, `/developer`.** Must survive and pass the sanitizer. Without session verification, it ends in `/totp`; with it, it lands directly.
- **Enrolling from `/admin`.** An administrator reaches `/account/2fa?callbackUrl=/admin`. With the session verified they land on `/admin` with no second prompt. Without it, `/totp` appears once, then `/admin`.
- **Empty and failure states.** A brand-new install has the existing "Not available right now" page when the encryption key is missing; it is unchanged. A database error during `completeEnrollment` currently throws out of the action; `confirm()` catches it silently and re-enables the boxes with no message (`totp-enroll-form.tsx:70-76`). That is a failure-microcopy gap. The user sees nothing, and the code may in fact have been consumed. Phase 3 should add a one-line message.
- **360px.** The code panel's grid, the Continue control and the long `callbackUrl` form must not overflow. Targets must be at least 44px. Walk it as an accepted-invitation new account on `development` at 360px, as Phase 6 requires.
- **HydrationGate and H3.** The form root keeps `HydrationGate`, and the `OneTimeCodeInput` consumer keeps its gate (`check:hydration-gate`). Any new form (an acknowledgement checkbox, say) needs the same.

## Fix Must Preserve

- Recovery codes plaintext shown only for this one delivery and never re-derivable from the page later. The only plaintext at rest is the 5-minute httpOnly cookie, and it should be removed if the client panel is the display.
- Codes hashed at rest with `hashRecoveryCode`; hashes replaced atomically-enough as today (known race with regenerate remains out of scope).
- `callbackUrl` sanitized with `sanitizeCallbackUrl`, and only the sanitized value reaches any link or redirect.
- No secret, code or cookie value logged or put in audit metadata.
- `HydrationGate` on the form root and on `OneTimeCodeInput` consumers.
- The session's verified claim set only through `withTwoFactorGrant` inside a server action. No client `update()`, no payload field, no change to `auth.ts` or `proxy.ts`.
- The `TOTP_ENROLLED` audit event (via `recordAudit`) on every enrolment.
- The 0.44.1 auto-submit (six digits submit; one call in flight; never the same code twice) and F342's guarantee that the page shows the secret the database holds.

## Decide-Shape Options for Phase 3

| Option | What it does | Safe? | Leaves open |
|---|---|---|---|
| **A. Keep the client panel** | `completeEnrollment` stops calling `revalidatePath` and stops setting the fresh-codes cookie on the enrol path. The panel is the one display. The management view gains a Continue (from `callbackUrl`) for reload, back and second tab. | Yes. Removes the plaintext cookie. Must be proved on a running server that the re-render does not still fire. | Reload loses the codes (Gap 3), recoverable only through Regenerate, which needs the gap-1 fix. |
| **B. Render once from the cookie, server-side** | Keep the cookie. The page shows codes plus Continue after enrolment; clear the cookie on Continue or acknowledgement rather than on mount. | Yes. Reload survives for 5 minutes. | A 5-minute plaintext httpOnly cookie remains; copy must say so honestly. More moving parts than A. |
| **C. A plus session verification** | Option A, and `completeEnrollment` also marks the session verified through the grant (with the already-enrolled guard). Removes the extra `/totp`. | Yes under the five conditions in the adversarial pass. | Adds a second grant call site. |

I recommend **A plus the management-view Continue now**, and **C** as a decision for the architect in a short Phase 2. They are separable: A fixes the loss and ships alone, C removes the extra step. The orchestrator should ask the operator whether the extra challenge for the first invitees is acceptable (the 2b copy already tells them so) or should go away.

## Is Phase 2 skippable?

- **For A alone: yes.** No new directory or dependency, no schema change, no invariant touched (not `auth.ts`, `proxy.ts` or the grant). Note the skip explicitly in the work-log.
- **If C is chosen: no.** It adds a second `withTwoFactorGrant` call site and changes what "verified" means after enrolment. DECISION-230 is the invariant at stake. Run a short architect pass.
- Phase 4 is auth-touching either way (`(account)/account/2fa` is the enrolment path; the gate lists `src/app/(auth)/`, `src/auth.ts` and `src/lib/auth/`). A running-server e2e smoke with an MFA-enrolled seeded user is required before Phase 5. At minimum it must cover:
  - a new account enrols, sees the codes, clicks Continue, lands (challenged once or not at all);
  - a reload mid-codes still offers Continue;
  - a hostile `callbackUrl` is rejected.

## Phase 6 Walk (set now)

Walk as the person the path creates: an accepted-invitation new account on `development` at 360px, from `/no-organization` or `/launch` to `/totp` to `/account/2fa` to the landing page. List each page and what it shows. Also walk a founding administrator who must enrol, and a voluntary enrolment with no `callbackUrl`.

## Out of Scope (confirm with operator)

- Removing the extra challenge (option C), if the operator prefers to live with it.
- A "Copy all" or "Download" button (Gap 5) and the second-tab wording.
- The regenerate race against sign-in, and key rotation.
- F343 itself.

## Open Questions

1. Is Gap 1 (regenerate bypasses the second factor) fixed in this pipeline or split out? I recommend this pipeline, in the same file, and before any non-operator is invited.
2. Strictly "once" (A) or "survives a reload for 5 minutes" (B)?
3. Is the extra `/totp` challenge acceptable for the first invitees (A only), or do we want C?
4. Should the first invitees' administrator and treasurer enrolments also be walked after F343 ships, since they will be the ones still forced through enrolment?

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete. Mechanism confirmed from code; one adjacent HIGH finding (regenerate bypass); three Phase 3 decisions; two points to verify on a running server | **READY WITH NOTES** | 2026-10-26 |

**Handoff.** Next is architect for a short Phase 2, required only if option C is chosen and otherwise skippable with notation. Otherwise it goes straight to tech-lead for Phase 3. Carry forward verbatim: the regenerate finding, the three-option table, the "Fix Must Preserve" list, and the Phase 6 walk. Phase 4 needs the running-server MFA smoke before Phase 5.

Files read: `/Users/cshenso/git/presby-platform/presby-f166/docs/work-log/2026-10-26-recovery-codes.md`, `src/app/(account)/account/2fa/{actions.ts,page.tsx,totp-enroll-form.tsx,regenerate-codes-form.tsx}`, `src/components/shared/fresh-recovery-codes.tsx`, `src/lib/auth/two-factor-grant.ts`, `src/app/(auth)/totp/{actions.ts,page.tsx}`, `src/auth.ts`, `src/proxy.ts`, `src/lib/two-factor.ts`, the 2b work-log (E-35 and the F166 walk row), and the F343 work-log in `/Users/cshenso/git/presby-platform/presby-2fa/docs/work-log/2026-10-26-2fa-default.md`.

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

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| [gap or ruling] | [section, or deferred + who accepted] |

## Edge Cases & Risks

- [Thing that could fail or that needs special handling; each claim cites the test that pins it or says "unverified"]

## Copy

- [Every user-facing string, checked against the accepted residuals: copy may not deny a residual the record admits]

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

## Orchestrator ruling (2026-10-26)

- **F344** registered for Phase 1 Gap 1: `regenerateRecoveryCodes` checks only `auth()` and an existing enrolment, never `twoFactorVerified`, and `/account/2fa` is not 2FA-gated — a first-factor-only session can mint fresh recovery codes and pass `/totp`. **Fixed in this pipeline** (same file, before any non-operator is invited): refuse with the same `twoFactorRequired && !twoFactorVerified` check style as `(invite)/actions.ts:225`, plus a failing-first test. Decide in Phase 3 whether an enrolled-but-not-required account's unverified session should also be refused (recommend yes: regenerating codes should require a verified session whenever an enrolment exists).
- Options A/B/C and the reload question go to the operator.

## Operator rulings (2026-10-26)

- **Codes: "Shown once"** — option A: the client panel is the one display; `completeEnrollment` stops setting the fresh-codes cookie on the enrol path and stops re-rendering the page away from the panel (prove on a running server that no re-render still fires); the management view gains a full-width Continue to the sanitized `callbackUrl` for reload/back/second tab. Reload loses the codes; Regenerate (after the F344 fix) is the recovery.
- **Second prompt: "Remove it"** — option C: `completeEnrollment` marks the session verified through `withTwoFactorGrant` (DECISION-230 pattern), under all five conditions in Phase 1's adversarial pass, incl. refusing when a `user_totp` row already exists. Needs a short Phase 2.
- **F344** fixed here (see the orchestrator ruling above).
