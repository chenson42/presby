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
| 2 — Architectural review | architect | Complete; R1–R6 binding; option A rebuilt as a client holder that survives the re-render; cookie removed; F344 refusal + audit key; grant allow-list test; DECISION-292 proposed | Approved with suggestions | 2026-10-26 |
| 3 — Technical design | tech-lead | Complete. R1–R6 and DECISION-292 carried; `completeEnrollment` per R1 plus a transaction; client holder at the root of every `/account/2fa` branch (layout fallback is a Phase 4 decision); cookie path removed; F344 refusal + audit key + page notice; set-equal grant allow-list; failing-first plan; eight smokes on 3650 and the handoff spec in the prod lane on 3651; Copy table C1–C12 with the four checks; no migration. Open for the operator: "Copy all" deferred | Design complete | 2026-10-26 |
| 4 — Implementation | full-stack-developer | Pending | — | — |
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

## Phase 2: Architectural Review (architect)

## Verdict

**Approved with suggestions.** Rulings R1 to R6 below are binding conditions on Phase 3, not optional suggestions. The feature shape from Phase 1 stays as it is, so nothing goes back to Phase 1.

One finding changes how option A has to be built. **Option C makes option A's "stop the re-render" approach impossible.** In Next 16.4.2, writing any cookie inside a server action re-renders the current route. `unstable_update()` writes the session cookie. So once enrolment marks the session verified, the page will always re-render after `completeEnrollment`, whether or not `revalidatePath` or the fresh-codes cookie are removed. The fix therefore has to make that re-render harmless (R2), not try to stop it.

Evidence, read from the worktree's `node_modules`:
- `next/dist/server/web/spec-extension/adapters/request-cookies.js:125`: `MutableRequestCookiesAdapter`'s `set` and `delete` both set `workStore.pathWasRevalidated = ActionDidRevalidateStaticAndDynamic`.
- `next/dist/server/app-render/action-handler.js:957` then leaves `skipPageRendering` false, and `:123-126` sends `x-action-revalidated`. The client reducer applies the new tree (`server-action-reducer.js:126`, `:228`).
- `next-auth@5.0.0-beta.32` `lib/actions.js:82-84`: `update()` does `cookieJar.set(...)` for the session cookie.
- This also confirms Phase 1's "possible second trigger": `setFreshRecoveryCodesCookie` and `clearFreshCodesCookieAction` each re-render the route on their own.

## Placement

- **Directory placement.** Everything stays co-located in `src/app/(account)/account/2fa/`:
  - One new `'use client'` holder component (e.g. `enrolment-handoff.tsx`, see R2).
  - Optionally a presentational `recovery-codes-panel.tsx`, shared by the holder and `RegenerateCodesForm`. Both are route-specific, so neither belongs in `src/components/shared/`.
  - One new boundaries test beside the grant module: `src/lib/auth/two-factor-grant.boundaries.test.ts` (R4).
  - **Removed:** `src/components/shared/fresh-recovery-codes.tsx` and its test, `setFreshRecoveryCodesCookie`, `clearFreshCodesCookieAction`, the cookie read in `page.tsx`, and `FRESH_RECOVERY_CODES_COOKIE` (plus its comment) in `src/lib/two-factor.ts`.
  - No new route, no layout, no `loading.tsx`.
- **Server vs Client split.**
  - `page.tsx` stays a Server Component. It reads the session, the enrolment and the sanitized `callbackUrl`.
  - The holder is the one new client boundary. It must hold the codes in memory, which only client state can do once the cookie is gone.
  - `TotpEnrollForm` and `RegenerateCodesForm` stay client components.
  - No client file imports `@/auth`, `two-factor-grant` or `unstable_update` (pinned by R4).
- **Dependencies.** None.
- **Touch target.** The 44px full-width Continue follows the existing `(invite)` precedent (`<Button asChild>` with a `min-h-11` / full-width class, as in `src/app/(invite)/invite/accepted/page.tsx`). Adding a new size variant to the primitive is out of scope for this bug fix.

## Invariants Touched

- **DECISION-230 (the 2FA claim is set only inside a server-side grant).** It is kept, and it gains a third call site, which is the point of DECISION-292 below. No change to `src/auth.ts`, `src/proxy.ts` or `two-factor-grant.ts` logic. `CLAUDE.md` → The Proxy Does Not Reach the Database stays true as written, so no `CLAUDE.md` edit is needed.
- **"Recovery codes are shown once and never re-derivable."** This gets stronger: the 5-minute plaintext cookie is removed, so the only plaintext left is client memory for the life of the page.
- **`callbackUrl` sanitized by `sanitizeCallbackUrl` only.** Kept: both Continue controls get only the server-sanitized value as a prop.
- **Permissions vs flags.** Untouched. `/account/2fa` stays auth-only (proxy fall-through). F344 adds a session-state check, not a `FEATURES.*` key or a flag.
- **Audit (Workflow Rule 7).** `TOTP_ENROLLED` gains metadata. One new key is added for the F344 refusal (R3, R5).
- **HydrationGate / H3.** Unchanged on `TotpEnrollForm`. The holder renders no form.

## Notes (binding rulings for Phase 3)

**R1. Option C is approved, with exactly this shape in `completeEnrollment`.**
1. Call `auth()`. Look up the pending row **by `session.user.id`**. Refuse if it is expired (as today).
2. Run `verifyToken(code, decryptSecret(pending.secretCiphertext))`. The grant may never be reached before this passes.
3. **Make the already-enrolled guard part of the insert itself:**
   - `insert(userTotp).values(...).onConflictDoNothing().returning(...)`.
   - If no row comes back, delete the pending row and return a refusal (copy along the lines of "Two-factor authentication is already set up on this account. Reload the page."). Replace no codes and open no grant.
   - The existing `onConflictDoUpdate` goes. A SELECT-then-insert is not acceptable, because two in-flight confirmations would both pass the check. That is the F342 lesson, and DECISION-290 says the same.
4. Delete the pending row, then `replaceRecoveryCodes`. Suggestion, not binding: run steps 3 and 4 in one transaction, which the WebSocket pool supports.
5. Mark the session verified:
   - `await withTwoFactorGrant(session.user.id, "totp", () => unstable_update({}))`, after the enrolment writes have committed.
   - Wrap it in `try/catch`, following the precedent at `(invite)/actions.ts:251-255`. If it fails, log one PII-free line and carry on: the enrolment still succeeds, and the user answers one `/totp` challenge (today's behaviour). The failure mode stays fail-closed.
   - The user id passed in is always `session.user.id`, never input. The method label is `"totp"`; the grant module does not change.
6. `recordAudit(TOTP_ENROLLED, { metadata: { sessionVerified } })`, once. `sessionVerified` is true only if step 5 completed. This is what tells an enrolment-verified session apart from a challenge-verified one, which writes `TOTP_VERIFY_SUCCEEDED` or `TOTP_RECOVERY_SUCCEEDED`. A boolean is not a secret; no code, secret or cookie value goes in metadata.
7. Return the codes. No `revalidatePath`, no `cookies()`.

Checked against Phase 1's five conditions:
- Possession proof before the grant: step 2.
- Refusal when a `user_totp` row exists: step 3, done atomically.
- Grant not exported from a `'use server'` file: it is imported and called inside the action, never re-exported or wrapped in an exported function (pinned by R4).
- No client update or payload path: unchanged. The jwt callback reads nothing from the payload, and the route answers 405.
- Distinguishable audit: step 6.

**R2. Option A, rebuilt: let the re-render happen and make it harmless.** After R1 the re-render always fires, because the session cookie is set inside the action. So the codes must live in client state that survives it:
- `page.tsx` renders the **same client holder component at the root of every branch** (enrolment form, management view, not-configured), with the same type, same position and no `key`. React keeps client state through a server-action re-render when the component's identity matches. That rule is also why the bug exists today: the tree switches from `TotpEnrollForm` to a `<div>`.
- The holder keeps `codes` in `useState` and gives `TotpEnrollForm` a setter through context. When codes are set, it renders the codes panel and a Continue **instead of** its children. Continue's `href` is the sanitized `callbackUrl` prop from the server; the raw query string never reaches the client.
- `TotpEnrollForm` stops owning the "enabled" panel.
- No `router.refresh()` and no `key` tied to enrolment state.
- Rejected alternatives:
  - Moving the session update into a route handler: it adds a route and a second transport for the grant, and splits verification from the possession proof.
  - Deferring the grant to the Continue click: the proof would then have to cross requests, which DECISION-230's same-request, single-use grant forbids.
- Fallback: if the running-server proof (R6, smoke 1) shows the page subtree remounting, move the holder into a co-located `layout.tsx` as a context provider, with the page pushing the sanitized `callbackUrl` into it. Record that deviation in Phase 4.
- **Management-view Continue:** render it when the request URL carried a `callbackUrl`. Its `href` is always the sanitized value (a hostile value becomes `/launch`). It is full-width with a 44px minimum height. This covers reload, back and a second tab.
- **Cookie removal.** The fresh-codes cookie, its helper, `clearFreshCodesCookieAction` (an exported server action, so a public endpoint that disappears), the page's `cookies()` read, and `src/components/shared/fresh-recovery-codes.tsx` and its test **all go**, including on the regenerate path:
  - `RegenerateCodesForm`'s own client panel is the display there.
  - The cookie path is what produces the duplicate or flashing second panel (Phase 1 Flow 4).
  - `regenerateRecoveryCodes` may keep its `revalidatePath` so the unused count refreshes. That re-render is harmless because the management tree keeps its identity. If it stays, smoke 5 must show the new panel surviving it.
  - A cookie still left in a browser from before the deploy expires on its own, and nothing reads it.
- **Pin it.** Replace the BUG-2 static test with one that asserts neither `page.tsx` nor `actions.ts` in this route imports `next/headers`. That makes "no plaintext recovery code outside client memory" a test, not a promise.

**R3. F344: `regenerateRecoveryCodes` refuses unless the session is verified.**
- **Predicate:** with the enrolment row present (already checked), refuse when `!session.user.twoFactorVerified`. This covers `twoFactorRequired && !twoFactorVerified` and the operator-recommended wider case.
- Why the wider case matters: an enrolled but not-required account is never challenged at sign-in, and it becomes required the moment a congregation or treasurer designation turns the requirement on. Codes minted while unverified would then pass `/totp`.
- **No lockout:** `/totp` accepts any signed-in enrolled user and accepts either a TOTP code or a recovery code, and it returns to a sanitized `callbackUrl`. The way back is `/totp?callbackUrl=/account/2fa` (built with `URLSearchParams`), then Regenerate.
- **Enforcement is in the action.** The page is UX only: when enrolled and unverified, the management view renders a notice with a "Confirm it's you" link in place of the Regenerate button.
- Proposed copy (tech-lead owns the final wording):
  - Action refusal: "Confirm it's you with your authenticator app before making new recovery codes."
  - Page notice: "To make new recovery codes, first confirm it's you with your authenticator app or a recovery code."
- **Audit:** add `TOTP_RECOVERY_CODES_REGENERATE_REFUSED: "totp.recovery_codes.regenerate_refused"` to `src/lib/audit.ts` and the mirrored list in `src/lib/audit.test.ts`, with `metadata: { twoFactorRequired }`. The actor is authenticated (first factor), and this row is the one observable sign that a password-only session tried to escalate.
- **Tests, written failing first in `actions.test.ts`:**
  - required and unverified → refused;
  - not required and unverified → refused;
  - verified → succeeds.
  - Each refusal asserts no recovery-code delete or insert ran and the refusal audit fired.

**R4. Source-scan pins: none needs widening, but the allow-list it implies does not exist yet, so add one.** The 0.42.3 S-1 block (`src/app/(auth)/totp/totp-challenge-form.test.tsx:261-274`) only asserts that the **client form** never imports `@/auth`, `two-factor-grant` or `unstable_update`. Nothing today pins the grant to `(auth)/totp/actions.ts`. Add `src/lib/auth/two-factor-grant.boundaries.test.ts`, which strips comments, globs non-test `src/**/*.{ts,tsx}`, and asserts **set equality, not subset**:
- **Importers of `@/lib/auth/two-factor-grant`** are exactly these three:
  - `src/auth.ts`, importing `takeTwoFactorGrant` only;
  - `src/app/(auth)/totp/actions.ts`, importing `withTwoFactorGrant` only;
  - `src/app/(account)/account/2fa/actions.ts`, importing `withTwoFactorGrant` only.
- **`withTwoFactorGrant(` call sites:** exactly 2 in the totp actions and exactly 1 in the 2fa actions. Each matches the form `withTwoFactorGrant(session.user.id, "<totp|recovery>", () => unstable_update({}))`.
- **Exports of the two `'use server'` files:**
  - `(auth)/totp/actions.ts` = {`verifyTotpAction`};
  - `(account)/account/2fa/actions.ts` = {`completeEnrollment`, `regenerateRecoveryCodes`}.
  - This catches an exported wrapper around the grant.
- **Client files:** every `'use client'` file under `(account)/account/2fa/` and `(auth)/totp/` is free of `@/auth`, `two-factor-grant` and `unstable_update`. This extends S-1 to the enrolment forms and the new holder.
- Adding a call site fails the test until the list is edited, and that edit is the review trigger; the test's header cites DECISION-292.
- The allow-list covers the grant, not `unstable_update({})` in general. The grant-free refreshes in `(invite)/actions.ts` and `(admin)/admin/users/actions.ts` stay legitimate, because the jwt callback ignores the payload.

**R5. Docs.** Optional: a one-line comment edit in `two-factor-grant.ts` naming the three call sites. `docs/decisions.md` gets DECISION-292 (below); DECISION-230 needs no edit, since 292 amends it by reference.

Suggestion: the fresh-codes cookie came from the starter (note the `claudecode_` prefix), so F166 and F344 are starter-generic. Stage them for `/downstream-sync`.

**R6. Auth-touching: running-server MFA smoke before Phase 5.** These must run against a server the pipeline starts itself on port 3650 (`E2E_BASE_URL` set), and smoke 1 must also run in the `next build && next start` lane on its own pre-assigned port:
1. **Invitee (required) enrols.**
   - The codes panel is visible after the action resolves and **is still visible** after the re-render triggered by the session cookie. Assert the "You enrolled on" text never appears while the panel is up, and wait for network idle before asserting.
   - Continue's `href` equals the sanitized `callbackUrl`. Clicking it lands on `/o/<slug>` with **no `/totp` hop** (record the URL history).
   - This replaces the F166 workaround in `e2e/invitation-new-account.spec.ts:195-213`. Update `e2e/invitation-existing-account.spec.ts:317` the same way.
2. **Administrator enrols via `/admin` → `/totp` → `/account/2fa?callbackUrl=/admin`.** Lands on `/admin` directly.
3. **Voluntary enrolment, no `callbackUrl`, not required.** Continue goes to `/launch`.
4. **Reload while the codes show.** None of the earlier code strings are in the DOM, the management view shows the full-width Continue to the sanitized target, and `context.cookies()` never contains a fresh-codes cookie at any point in smokes 1 to 4.
5. **Hostile `callbackUrl`.** `//evil.example`, `/\evil.example` and `/.//evil.example` on `/account/2fa` give `/launch` in both the panel and the management-view Continue.
6. **F344.**
   - A seeded MFA-enrolled user signs in with a password only, opens `/account/2fa` and sees the notice. A direct action call is refused, and the `user_totp_recovery_codes` hashes in the database are unchanged.
   - Then `/totp` with a code returns to `/account/2fa`. Regenerate succeeds, and the panel survives the re-render.
7. **Concurrency.** Extend `e2e/totp-enrol-concurrency.spec.ts`: two tabs confirm; the second is refused, the first tab's codes stay valid (one of them passes `/totp`), and the secret is unchanged.
8. **Regression.** The standard MFA-enrolled login path (sign in → `/totp` → `/admin`) still passes.

Plus unit tests:
- the already-enrolled refusal (no code replacement, no grant);
- the grant opened only after `verifyToken` passes, checked by spying `takeTwoFactorGrant` as `(auth)/totp/actions.test.ts:87` does;
- the caught `unstable_update` failure still returns codes with `sessionVerified: false`;
- 360px for the panel, both Continues and the F344 notice.

### Proposed DECISION-292

**DECISION-292: Confirming a first enrolment is a possession proof that may mark the session verified through the same single-use grant. Recovery codes are delivered only in client memory, and minting new ones requires a verified session.**

*Status:* Proposed (architect, Phase 2) · *Date:* 2026-10-26 · *Feature:* `2026-10-26-recovery-codes` (F166, F344; no migration)

- **Rule (amends DECISION-230's enumerated call sites).** `completeEnrollment` opens `withTwoFactorGrant(session.user.id, "totp", () => unstable_update({}))`, but only when all of these hold:
  - `verifyToken` has passed against the caller's own pending secret;
  - the `user_totp` insert actually created the row (`ON CONFLICT DO NOTHING ... RETURNING`; an existing enrolment is refused and never replaced);
  - the enrolment writes have committed.

  A failed update is caught and costs one `/totp` challenge. `TOTP_ENROLLED` records `sessionVerified`. The grant's importers, call sites and the exports of both `'use server'` files are a closed, set-equal allow-list in `src/lib/auth/two-factor-grant.boundaries.test.ts`.
- **Delivery.**
  - The fresh-codes cookie is removed from both paths.
  - A server action that writes any cookie re-renders the route in Next 16 (`request-cookies.js:125`), and `unstable_update` writes one. So the codes live in a client holder whose identity is the same in every branch of `/account/2fa`, and they survive that re-render.
  - A reload loses them by design (operator ruling, "shown once").
  - Both Continue controls take only the server-sanitized `callbackUrl`.
- **F344.** `regenerateRecoveryCodes` refuses any session without `twoFactorVerified` and writes `totp.recovery_codes.regenerate_refused`. The way back is `/totp?callbackUrl=/account/2fa`.
- **Accepted residuals (paper):**
  - **(a)** Someone holding only the first factor of a never-enrolled account reaches a verified session in one step instead of two. No new power: today they enrol and then answer a challenge with the secret they chose.
  - **(b)** DECISION-230's residual carries over: a verified claim outlives an administrator's TOTP reset, and such a session can enrol a new authenticator. Enrolment never required verification, so this is not new.
  - **(c)** "Codes survive the re-render" depends on React keeping client state across the server-action re-render. Only the running-server e2e pins it, in both lanes.
  - **(d)** A lost action response leaves the account enrolled with codes nobody saw. Recovery is `/totp`, then Regenerate.
  - **(e)** Enrolled but not-required accounts answer one voluntary `/totp` before they can regenerate.
  - **(f)** `verifyToken` has no replay guard. The race between regenerate and sign-in, and key rotation, remain out of scope.
- **Revisit if:**
  - Next stops re-rendering on cookie writes in actions, or Auth.js's `update()` stops writing the cookie in-process;
  - a fourth grant call site is proposed;
  - a per-session server record (DECISION-230's revocation follow-up) lands, which would make the "verified" state revocable at enrolment and reset.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete. Option C approved under R1 (atomic already-enrolled guard, grant after `verifyToken`, caught update, `sessionVerified` audit). The session-cookie write always re-renders the route in Next 16.4.2, so option A is rebuilt as a client holder that survives the re-render (R2). The fresh-codes cookie, its helpers and `fresh-recovery-codes.tsx` are removed. F344 refuses unless the session is verified, with a new refusal audit key (R3). New set-equal grant allow-list test (R4). Eight-item running-server MFA smoke (R6). DECISION-292 proposed. | **Approved with suggestions** | 2026-10-26 |

**Handoff.** Next is **tech-lead** for Phase 3. Carry R1 to R6 and the DECISION-292 text into the Carry-forward table word for word. The R2 fallback (a layout holder) is a Phase 4 decision if smoke 1 shows a remount, and it has to be recorded. Phase 4 is auth-touching: the R6 smoke has to pass on a running server with an MFA-enrolled seeded user before Phase 5.

Files read (all under `/Users/cshenso/git/presby-platform/presby-f166/`):
- `docs/work-log/2026-10-26-recovery-codes.md`, `docs/decisions.md` (DECISION-230)
- `src/app/(account)/account/2fa/{actions.ts,actions.test.ts,page.tsx,totp-enroll-form.tsx,regenerate-codes-form.tsx}`
- `src/components/shared/fresh-recovery-codes.tsx`
- `src/lib/auth/two-factor-grant.ts`, `src/lib/auth/safe-callback.ts`
- `src/app/(auth)/totp/{actions.ts,page.tsx,totp-challenge-form.test.tsx}`
- `src/app/(invite)/actions.ts`, `src/auth.ts`, `src/proxy.ts`, `src/lib/db/schema.ts`
- `e2e/invitation-new-account.spec.ts`
- `node_modules/next/dist/server/{app-render/action-handler.js,web/spec-extension/adapters/request-cookies.js}`, `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js`, `node_modules/next-auth/lib/actions.js`

No files were edited, no database was touched and `git stash` was not used.

---

# Phase 3 — Technical Design (tech-lead) — F166 recovery codes + F344 regenerate bypass

*Bug-fix variant with a full design: the change is auth-touching (the grant gains a third call site), so Phase 4 carries the running-server gate. Written against the live tree of this worktree (branch `pipeline/recovery-codes`, from `main` at 0.46.2). F343 (`presby-2fa`) and Community 2b (`presby-2b`) are unmerged and not in this tree.*

## Root cause

Five facts, four from Phase 1 and one from Phase 2, that together explain "the codes vanish and the account answers a second challenge".

1. **The page swaps component types.** `page.tsx` returns `<TotpEnrollForm>` for an unenrolled user and a plain `<div>` for an enrolled one. `completeEnrollment()` ends in `revalidatePath("/account/2fa")`, so the re-render returns the `<div>`. React unmounts `TotpEnrollForm` and drops its `enrolled` and `recoveryCodes` state: the "save these now" panel and its Continue link are gone within about a second (`totp-enroll-form.tsx:93-120`).
2. **Nothing in the management view reads `callbackUrl`**, and it has no way onward. After the swap, or after any reload, back or second tab, the person has no Continue and no destination.
3. **The cookie path cannot rescue it.** `setFreshRecoveryCodesCookie` puts a 5-minute plaintext copy in a cookie that the management view renders on the *next* render and clears on mount. It renders no Continue either, and (Phase 1, Flow 4) on the regenerate path it can produce a second, duplicate panel.
4. **Enrolment does not verify the session.** Only `verifyTotpAction` marks a session verified (DECISION-230). A required, unverified person who clicks Continue to `/o/<slug>` or `/admin` is bounced by the proxy to `/totp` and must enter a code they just proved they hold (2b's E-35).
5. **(Phase 2) A cookie write in a server action re-renders the route in Next 16.4.2.** `request-cookies.js:125` sets `pathWasRevalidated`; `action-handler.js:957` and `:123-126` then render the page and send `x-action-revalidated`; `server-action-reducer.js:126,228` applies the tree; `next-auth` `lib/actions.js:82-84` writes the session cookie inside `update()`. So once enrolment marks the session verified (the operator's "remove it" ruling), the page re-renders after `completeEnrollment` whatever we do with `revalidatePath`. The design therefore makes the re-render harmless (client holder, same identity in every branch) instead of trying to prevent it.

**F344 root cause.** `regenerateRecoveryCodes` checks only `auth()` and that a `user_totp` row exists. `/account/2fa` is deliberately outside the proxy's 2FA wall (`(account)/layout.tsx` note), and `twoFactorVerified` is reset to `false` at every sign-in (`src/auth.ts:264`). A person with only a password can open `/account/2fa`, press Regenerate, read ten fresh codes and use one at `/totp`.

## Summary

Make first enrolment end well and close the regenerate bypass, with no schema change. `completeEnrollment` becomes an atomic, refuse-if-enrolled confirmation that, after the possession proof, marks the session verified through the same single-use grant `verifyTotpAction` uses (DECISION-292, amending DECISION-230's call sites). The ten recovery codes are delivered only in client memory, held by one client component (`EnrolmentHandoff`) that sits at the root of every branch of `/account/2fa`, so they survive the server-action re-render; the person leaves with **Continue** to the sanitized `callbackUrl` and meets no second challenge. The plaintext fresh-codes cookie, its helpers, its server action and its component are deleted. A management view reached with a `callbackUrl` (reload, back, second tab) gets a full-width Continue. `regenerateRecoveryCodes` (F344) refuses any session that is not 2FA-verified, writes a refusal audit row, and the page offers "Confirm it's you" in place of the button.

## Permissions & Flags

- **Permission keys:** none new. `/account/2fa` stays auth-only by design (proxy fall-through, `proxy.ts:183-199`). F344 adds a *session-state* check (`session.user.twoFactorVerified`), not a `FEATURES.*` key.
- **Default role bindings:** none.
- **Feature flags:** not needed (no new platform flags before go-live; rollback is revert). The behaviour depends on two existing flags, both seeded ON by `scripts/seed.ts` (`auth.require_2fa` :124, `auth.local_login` :118): `requiresTwoFactor` is computed from `auth.require_2fa`, and the e2e sign-ins use credentials.
- **Audit:** `TOTP_ENROLLED` gains `metadata: { sessionVerified: boolean }` (a boolean, not a secret). New key `TOTP_RECOVERY_CODES_REGENERATE_REFUSED: "totp.recovery_codes.regenerate_refused"` with `metadata: { twoFactorRequired }`. No code, secret, hash or cookie value in any metadata or log line.

## API Contract

No route is added or changed. Two server actions in `src/app/(account)/account/2fa/actions.ts` (`"use server"`); after this change that file exports exactly `completeEnrollment` and `regenerateRecoveryCodes` (pinned by R4/G3). `clearFreshCodesCookieAction` is removed (a public endpoint that disappears).

### `completeEnrollment(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[]; sessionVerified: boolean }>>`

R1, step for step. `userId` is always `session.user.id`, never input.

```ts
const session = await auth();
if (!session?.user) return { ok: false, error: "Unauthorized." };
const userId = session.user.id;

// 1. pending row by session user; refuse missing or expired (as today; copy C10 for missing)
const pending = await db.query.userTotpPendingEnrollments.findFirst({ where: eq(..userId, userId) });
if (!pending)            return { ok: false, error: NO_SETUP_IN_PROGRESS };   // C10
if (pending.expiresAt < new Date()) { delete pending row; return { ok: false, error: "Enrollment session expired. Reload the page to start over." }; }

// 2. possession proof BEFORE anything else can happen
if (!verifyToken(input.code, decryptSecret(pending.secretCiphertext)))
  return { ok: false, error: "That code did not match. Try again." };

// 3 + 4. one transaction. The already-enrolled guard IS the insert (never SELECT-then-insert: F342 / DECISION-290).
const codes = generateRecoveryCodes();
const enrolled = await db.transaction(async (tx) => {
  const inserted = await tx.insert(userTotp)
    .values({ userId, secretCiphertext: pending.secretCiphertext })
    .onConflictDoNothing({ target: userTotp.userId })
    .returning({ userId: userTotp.userId });
  await tx.delete(userTotpPendingEnrollments).where(eq(userTotpPendingEnrollments.userId, userId));
  if (inserted.length === 0) return false;           // an enrolment already exists: replace nothing
  await replaceRecoveryCodes(tx, userId, codes);      // delete + insert, same transaction
  return true;
});
if (!enrolled) return { ok: false, error: ALREADY_ENROLLED };   // C9; no grant, no codes, no TOTP_ENROLLED audit

// 5. mark the session verified: after the commit, inside the grant, for session.user.id, with an empty payload
let sessionVerified = false;
try {
  const updated = await withTwoFactorGrant(userId, "totp", () => unstable_update({}));
  sessionVerified = updated?.user?.twoFactorVerified === true;
} catch {
  console.error("[2fa] session refresh after enrolment failed");   // one PII-free line; fail closed: one /totp challenge
}

// 6. one audit row
await recordAudit({ action: AUDIT_ACTIONS.TOTP_ENROLLED, resourceType: "user", resourceId: userId, metadata: { sessionVerified } });

// 7. no revalidatePath, no cookies()
return { ok: true, data: { recoveryCodes: codes, sessionVerified } };
```

Two tightenings inside R1's bounds, both Phase 4 verifies against the live `next-auth` return:
- `sessionVerified` is true only if the update **completed and the session it returned reports `twoFactorVerified: true`** (`update()` returns `res.body`, the projected session, `lib/actions.js:82-91`). If the returned body turns out not to carry the claim, Phase 4 falls back to "completed without throwing", records the deviation, and the unit test E6 changes with it. Never `true` on a throw.
- The transaction (R1's suggestion, adopted) also closes the half-written state (secret stored, codes missing) and the TODO.md:428 interleaving for this path. `replaceRecoveryCodes` takes the executor (`db` or `tx`), so regenerate uses one too.

### `regenerateRecoveryCodes(): Promise<ActionResult<{ recoveryCodes: string[] }>>`

Order: `auth()` → no session `Unauthorized.` → enrolment row missing: existing "Enroll in 2FA before regenerating recovery codes." (no refusal audit; nothing to escalate) → **F344 refusal** → transaction replace → `recordAudit(TOTP_RECOVERY_CODES_REGENERATED)` → `revalidatePath("/account/2fa")` (kept, so the unused count refreshes; the re-render is harmless because the management tree keeps its identity) → return codes. No cookie.

The refusal: `if (!session.user.twoFactorVerified)` return `{ ok: false, error: C8 }` after `recordAudit({ action: TOTP_RECOVERY_CODES_REGENERATE_REFUSED, resourceType: "user", resourceId: userId, metadata: { twoFactorRequired: session.user.twoFactorRequired } })`. Predicate per R3: *not verified*, whether or not required. No lockout: `/totp` accepts any signed-in enrolled user with a TOTP code or a recovery code and returns to a sanitized `callbackUrl`.

## Data Model

No schema changes required; **no migration** (0081 stays reserved and unused). `presby_app` already holds INSERT, DELETE (and SELECT) on `user_totp`, `user_totp_pending_enrollments`, `user_totp_recovery_codes`: today's action uses all of them, and `ON CONFLICT DO NOTHING` needs INSERT only. `user_totp.user_id` is the primary key and is the conflict arbiter. These three tables carry no row-level security (platform axis; every statement keys on the session user, `paper`, unchanged).

## Component / Page Plan

All under `src/app/(account)/account/2fa/` unless stated. No new route, layout or `loading.tsx` (CLAUDE.md: a loading boundary on this tree is not wanted; none is added).

**Create**
- `enrolment-handoff.tsx` (`'use client'`). `EnrolmentHandoff({ callbackUrl, children })` keeps `delivery: { codes: string[]; sessionVerified: boolean } | null` in `useState`, exposes `useRecoveryCodesHandoff()` (returns `present(delivery)`; throws a clear error outside the provider). Renders a **constant** structure: `<Ctx.Provider value={…}>{delivery ? <Delivered/> : children}</Ctx.Provider>`. `Delivered` is the h1 (focused on mount, `tabIndex={-1}`, so a keyboard or screen-reader user is not left on an unmounted form), the C2 body, the shared panel, the C5 note when `sessionVerified === false`, and `<ContinueButton href={callbackUrl}>`. `callbackUrl` is the server-sanitized prop; the file never reads `useSearchParams`, `window.location` or any query string (pinned by H7).
- `recovery-codes-panel.tsx`: presentational, shared by `Delivered` and `RegenerateCodesForm` (props: `heading`, `headingLevel`, `intro`, `codes`, optional `footnote`). The amber block and 2-column mono grid, moved verbatim from the two existing copies.
- `continue-button.tsx`: not a client file; `<Button asChild className="mt-6 min-h-11 w-full"><a href={href}>Continue</a></Button>` (the `(invite)/invite/accepted` precedent: `min-h-11 w-full`; no new size variant). A plain `<a>`, not `next/link`, on purpose: a full document navigation drops the codes from memory and guarantees the proxy reads the freshly written session cookie.
- `actions.db.test.ts`, `page.test.tsx`, `enrolment-handoff.test.tsx`, `regenerate-codes-form.test.tsx` (none exists today) and `src/lib/auth/two-factor-grant.boundaries.test.ts`.
- `e2e/hydration/totp-enrol-handoff.spec.ts`, `e2e/totp-first-enrolment.spec.ts`, `e2e/totp-regenerate-gate.spec.ts`, and `e2e/support/enrolment-fixture.ts` (new file, throwaway-user helper; see Implementation Order for why a new file rather than an edit).

**Modify**
- `page.tsx`: drop `cookies()`, the fresh-codes read, `clearFreshCodesCookieAction` and `FreshRecoveryCodes`. Compute `callbackUrl = sanitizeCallbackUrl(sp.callbackUrl)` and `hasCallback = typeof sp.callbackUrl === "string" && sp.callbackUrl.length > 0`. **Every `return` is `<EnrolmentHandoff callbackUrl={callbackUrl}>…</EnrolmentHandoff>` at its root, no `key`, no wrapper** (enrolled / not configured / enrol form). Enrolled branch: the existing header and counts; `{hasCallback && <ContinueButton href={callbackUrl} />}` directly under the "You enrolled on" paragraph (visible without scrolling at 360px); then `session.user.twoFactorVerified ? <RegenerateCodesForm /> : <ConfirmItsYou …/>` (C7; the link is `/totp?` + `new URLSearchParams({ callbackUrl: returnTo })` where `returnTo` is `/account/2fa`, or `/account/2fa?` + `new URLSearchParams({ callbackUrl })` when `hasCallback`; both `callbackUrl`s are the sanitized value).
- `totp-enroll-form.tsx`: remove `enrolled`, `recoveryCodes`, the panel and the Continue; drop the `callbackUrl` prop; on `result.ok && result.data` call `present({ codes, sessionVerified })` from the context; the catch branch now toasts C11 (closes TODO.md:425). Everything else (auto-submit guard, `HydrationGate`, `OneTimeCodeInput`, `key={attempt}`) is untouched.
- `regenerate-codes-form.tsx`: render through `RecoveryCodesPanel`; add the C12 footnote; no other behaviour change.
- `actions.ts`: as above. Delete `setFreshRecoveryCodesCookie`, `FRESH_COOKIE_TTL_SECONDS`, `clearFreshCodesCookieAction`, the `next/headers` import and the `FRESH_RECOVERY_CODES_COOKIE` import.
- `actions.test.ts`: rewritten (see Failing-first plan); the BUG-2 `clearFreshCodesCookieAction` tests are deleted with the action, and the BUG-2 page static test is replaced by the S1 pin (neither `page.tsx` nor `actions.ts` imports `next/headers`).
- `totp-enroll-form.test.tsx`: renders inside `EnrolmentHandoff`; success cases assert `present` is called, not that a panel appears inside the form.
- `src/lib/two-factor.ts`: delete `FRESH_RECOVERY_CODES_COOKIE` (:98) and fix the :90-92 comment ("shown once via the FRESH_RECOVERY_CODES_COOKIE handoff").
- `src/lib/audit.ts` and `src/lib/audit.test.ts`: the new key, and its mirror.
- `e2e/invitation-new-account.spec.ts` (:29 header, :198-232), `e2e/invitation-existing-account.spec.ts` (after :317), `e2e/totp-enrol-concurrency.spec.ts` (:130 and the header), `docs/testing.md` (:62, and the specs list).
- `src/lib/auth/two-factor-grant.ts`: optional one-line comment naming the three call sites (R5).

**Delete**
- `src/components/shared/fresh-recovery-codes.tsx` and `fresh-recovery-codes.test.tsx`.

**The R2 fallback.** If smoke 1 shows the page subtree remounting (the codes disappear, or "You enrolled on" appears while the panel should be up), Phase 4 moves the holder into a co-located `src/app/(account)/account/2fa/layout.tsx` as a context provider that `page.tsx` feeds the sanitized `callbackUrl`, and records the deviation here and in DECISION-292. That is a Phase 4 decision, not a Phase 3 loop-back, provided no new route and no new directory results.

## Implementation Order

1. **Red first.** Write the tests in the Failing-first plan below; run them against the unchanged tree and record each red in the Phase 4 section.
2. **Batch 1 — F344 (`fix(auth): …`, one commit).** `audit.ts` key + `audit.test.ts` mirror; `regenerateRecoveryCodes` refusal and the transaction helper; the page's notice (`ConfirmItsYou`) and `session.user.twoFactorVerified` branch; E-R1..R6, P5/P6, D3; `e2e/totp-regenerate-gate.spec.ts`; `e2e/support/enrolment-fixture.ts`. Trailers: `Caught-By: agent-review`, `Discovered-In: Phase-1`, `Work-Log: 2026-10-26-recovery-codes`.
3. **Batch 2 — F166 (`fix(auth): …`, one commit).** `completeEnrollment` rewrite; cookie removal (actions, page, `fresh-recovery-codes.*`, `two-factor.ts`); `EnrolmentHandoff`, `RecoveryCodesPanel`, `ContinueButton`; `TotpEnrollForm`/`RegenerateCodesForm` edits; the grant boundaries test; the e2e edits and the two new specs; `docs/testing.md`. Trailers: `Caught-By: agent-review`, `Discovered-In: Phase-6`. (If the implementer finds the two cannot be separated without churn in `actions.ts`/`page.tsx`, one `fix:` commit with both trailers is acceptable; say so in Phase 4.)
4. **Audit events** are in 2 and 3 (`TOTP_ENROLLED` metadata; the refusal key). `npm run check:audit` must stay green: both mutations reference an `AUDIT_ACTIONS` key.
5. **Running-server gate (R6), before Phase 5.** A server this pipeline starts itself on **3650** with `E2E_BASE_URL=http://localhost:3650` (the testing.md "Running Playwright from a worktree" recipe: the fakes, the pid noted, stopped by PID, never `pkill -f next`); smokes 1–8 below. Then the production-build lane for the handoff spec on **3651**: `PW_PROD_PORT=3651 npm run test:e2e:prod -- --project=prod-build e2e/hydration/totp-enrol-handoff.spec.ts` (built in a scratch copy outside `~/git/presby-platform/` with a hardlinked `node_modules`, per testing.md, because of the `turbopack.root` font-resolution failure in worktrees). No attach to :3000.
6. **Rule 16 / shared files** (orchestrator, at integration; the implementer must not edit them mid-pipeline): `docs/decisions.md` DECISION-292, `docs/schema-design-2.md` (F344 and F166 as the next lettered finding after §2af), `docs/TODO.md`, `docs/STATE.md`, `docs/reviews/log.md`. **`e2e/support/*`:** the new helper is a **new file** (`enrolment-fixture.ts`), not an edit of a shared one; if the implementer finds an existing support file needs an edit, stop and ask. No person-id range is needed: the new specs create `users` rows only, no `people` rows; the invitation specs keep their existing fixtures.
7. **Release notes** (after Phase 6 SHIP IT, `/release-notes`): v0.46.3, draft below; functionality-map line 35 (Rule 14); no `architecture.md` change (not architectural).

## Failing-first plan

Each test is written first and must be red on the unchanged tree. "Red because" is what Phase 4 records.

| Id | File | Asserts | Red because |
|---|---|---|---|
| E1 | `actions.test.ts` | valid code: returns 10 codes + `sessionVerified: true`; `unstable_update` called once with `{}` inside a grant for the session user (the `takeTwoFactorGrant` spy, as `(auth)/totp/actions.test.ts:87`) | no grant call today |
| E2 | same | wrong code: no insert, no code replacement, no grant, no audit | passes today; kept as guard |
| E3 | same | call order `verifyToken` < `insert…onConflictDoNothing` < `unstable_update`; the grant is never reached before `verifyToken` passes | no ordering today |
| E4 | same | insert returns `[]`: refusal C9, pending row deleted, no `replaceRecoveryCodes`, no grant, no `TOTP_ENROLLED` audit | today `onConflictDoUpdate` replaces the secret |
| E5 | same | `unstable_update` rejects: result is still `ok` with codes and `sessionVerified: false`; audit metadata `{ sessionVerified: false }`; exactly one `console.error`, containing no code, secret or hash | no catch today |
| E6 | same | update resolves with a session whose `twoFactorVerified` is false: `sessionVerified: false` | n/a today |
| E7 | same | `TOTP_ENROLLED` metadata is exactly `{ sessionVerified }`; `JSON.stringify(metadata)` contains none of the codes or the secret | no metadata today |
| E8 | same | no session: `Unauthorized.`, nothing touched | guard |
| E9 | same | pending missing → C10; expired → existing copy and pending deleted | C10 is new |
| E10 | same | enrol path never calls `revalidatePath` | `revalidatePath` is called today |
| S1 | same | source scan: neither `page.tsx` nor `actions.ts` imports `next/headers` or contains `cookies(` (replaces the BUG-2 test) | both do today |
| R1 | same | F344: enrolled, `twoFactorRequired` true, unverified → refused (C8); no delete, no insert, no `revalidatePath`; refusal audit fired with `{ twoFactorRequired: true }` | no check today |
| R2 | same | F344: enrolled, not required, unverified → refused; audit `{ twoFactorRequired: false }` | same |
| R3 | same | F344: verified → succeeds, codes returned, `TOTP_RECOVERY_CODES_REGENERATED` fired, no cookie | cookie set today |
| R4 | same | not enrolled → the existing "Enroll in 2FA…" message and **no** refusal audit | guard |
| R5 | same | no session → `Unauthorized.` | guard |
| R6 | same | the replacement runs inside `db.transaction` | not transactional today |
| D1 | `actions.db.test.ts` (`npm run test:db`) | two concurrent `completeEnrollment` for one user with the same pending secret and a correct code: exactly one `ok`, one C10/C11 refusal; `user_totp.secret_ciphertext` unchanged; stored hashes equal the winner's ten | both succeed and the last write wins today |
| D2 | same | a user who already has a `user_totp` row: confirmation refused; secret and recovery hashes byte-identical afterwards; pending row gone | secret replaced today |
| D3 | same | F344: unverified session calls regenerate: refused, hashes byte-identical | no check today |
| G1-G4 | `two-factor-grant.boundaries.test.ts` | R4 verbatim (below) | the third importer does not exist yet |
| A1 | `audit.test.ts` | the new key is in the mirrored list | key absent |
| P1 | `page.test.tsx` | every branch's root element `type === EnrolmentHandoff` and `props.callbackUrl` is the sanitized value; no `key` | today's roots are `TotpEnrollForm` and `div` |
| P2 | same | hostile `callbackUrl` (`//evil.example`, `/\evil.example`, `/.//evil.example`, a control character) → `/launch` on the holder and on the management Continue | n/a today |
| P3 | same | management Continue present iff the request carried a `callbackUrl`; its `href` is the sanitized value | no Continue today |
| P4 | same | source scan: every `return (` in `page.tsx` opens with `<EnrolmentHandoff callbackUrl={callbackUrl}>` (the identity pin: a fourth branch added without the holder fails here) | n/a |
| P5 | same | enrolled + unverified: the notice and the `/totp?callbackUrl=%2Faccount%2F2fa` link (exact string); with a `callbackUrl`: `…callbackUrl=%2Faccount%2F2fa%3FcallbackUrl%3D%252Fadmin`; no `RegenerateCodesForm` in the tree | no gate today |
| P6 | same | enrolled + verified: `RegenerateCodesForm`, no notice | guard |
| H1 | `enrolment-handoff.test.tsx` | `present(...)` shows the panel, the C2 body, and Continue whose `href` equals the prop | n/a today |
| H2 | same | after `present`, the children are not rendered | |
| H3 | same | **survives the re-render:** `rerender` the same holder with different children (the management `div`) and the panel is still up | the pin for R2 at React level |
| H4 | same | `sessionVerified: false` shows C5; `true` does not | |
| H5 | same | the h1 takes focus after `present` | |
| H6 | same | `useRecoveryCodesHandoff()` outside the provider throws | |
| H7 | same | source scan: no `useSearchParams`, `location.search`, `window.location`, `@/auth`, `two-factor-grant`, `unstable_update` | |
| F1-F3 | `totp-enroll-form.test.tsx` | success calls `present({ codes, sessionVerified })` and renders no panel itself; a thrown action toasts C11 and re-enables the boxes (replaces the N-5 comment "the design adds no copy for it"); the existing N-1..N-6 and hydration tests pass unchanged inside the wrapper | F1/F3: the panel is inside the form today |
| RG1-RG4 | `regenerate-codes-form.test.tsx` | success shows the shared panel and C12; failure toasts the server's error; the panel survives a parent re-render; a refusal (C8) toasts and shows no panel | no test file today |

**R4 allow-list test** (`src/lib/auth/two-factor-grant.boundaries.test.ts`, header cites DECISION-292; strips comments; globs non-test `src/**/*.{ts,tsx}`; **set equality**):
- G1 importers of `@/lib/auth/two-factor-grant` are exactly `src/auth.ts` (`takeTwoFactorGrant` only), `src/app/(auth)/totp/actions.ts` (`withTwoFactorGrant` only) and `src/app/(account)/account/2fa/actions.ts` (`withTwoFactorGrant` only).
- G2 `withTwoFactorGrant(` call sites: exactly 2 in the totp actions and 1 in the 2fa actions, each matching `withTwoFactorGrant(session.user.id, "<totp|recovery>", () => unstable_update({}))` (the 2fa one may bind the result; the regex allows an `await`/assignment prefix and nothing else).
- G3 the exports of the two `'use server'` files are exactly {`verifyTotpAction`} and {`completeEnrollment`, `regenerateRecoveryCodes`}.
- G4 every `'use client'` file under `(account)/account/2fa/` and `(auth)/totp/` is free of `@/auth`, `two-factor-grant` and `unstable_update`.

## Running-server smokes (R6), port 3650 (+ prod lane on 3651)

Every spec sets the flags it needs through `e2e/support/flags.ts`: `captureFlags(["auth.require_2fa"])`, `setFlag(…, true)` in `beforeAll`, `restore()` in `afterAll` (a no-op against the seeded value, and honest if the seed changes). No key goes into `scripts/ci/e2e-baseline-flags.sql`: nothing here asserts against a flag it cannot set.

| # | Spec | What it proves |
|---|---|---|
| 1 | `invitation-new-account.spec.ts` (modified, default lane) | Invitee (required) signs in, lands in enrolment with `callbackUrl=/launch`, types the code. **The panel with ten codes is visible after the action resolves and still visible after the re-render** (wait for network idle; "You enrolled on" never appears while it is up). Continue's `href` equals the sanitized target; clicking it reaches `/o/<slug>` and the recorded URL history contains **no `/totp`**. Replaces the F166 workaround at :198-232. |
| 1b | `e2e/hydration/totp-enrol-handoff.spec.ts` (**both lanes**: `chromium` on 3650, `prod-build` on 3651) | A throwaway required user (no organization) enrols; panel visible and surviving the re-render; `GET /api/auth/session` then reports `twoFactorVerified: true` (the no-org stand-in for "no second challenge", so the production build proves the grant and the holder without a seeded congregation); Continue `href` is `/launch`; `context.cookies()` never holds a `claudecode_fresh_recovery_codes` cookie. |
| 1c | `invitation-existing-account.spec.ts` (extended after :317) | The treasurer (existing account, forced into enrolment by arm B) enrols, sees the panel, Continue lands on `/o/<slug>` with no `/totp` hop. |
| 2 | `e2e/totp-first-enrolment.spec.ts` | Administrator (throwaway user with the `admin` role row, as `seed-users.ts` gives `mfa-admin`; not the shared fixture, which must stay unenrolled) signs in, `/admin` → `/totp` → `/account/2fa?callbackUrl=/admin`; enrols; Continue lands on `/admin` directly. |
| 3 | same | Voluntary enrolment from `/account`, `two_factor_required = false`, no `callbackUrl`: Continue → `/launch`; session verified. |
| 4 | same | Reload while the codes show: none of the earlier code strings is in the DOM; the management view shows the full-width Continue (bounding box ≥ 44px tall, ≥ the viewport's content width minus padding at 360px) when a `callbackUrl` is present; no fresh-codes cookie at any checkpoint of smokes 1–4. |
| 5 | same | Hostile `callbackUrl` (`//evil.example`, `/\evil.example`, `/.//evil.example`) on `/account/2fa`: Continue is `/launch` in the panel and in the management view. |
| 6 | `e2e/totp-regenerate-gate.spec.ts` | Throwaway enrolled user (`seedTotpEnrollment` from `totp-fixture.ts`, imported not edited), password sign-in only: `/account/2fa` shows the notice and **no** Regenerate button; the link goes to `/totp` and returns to `/account/2fa`; after the code Regenerate works and **the new panel survives the `revalidatePath` re-render**. **The refused call:** with the page open and verified in tab A, a second sign-in in tab B resets the shared cookie's claim to unverified (`auth.ts:264`); pressing Regenerate in tab A shows C8, the DB hashes are unchanged and one `totp.recovery_codes.regenerate_refused` row exists. (This replaces R6's "direct action call", because server-action ids are not a stable surface to call from a spec; the action-level refusal is also pinned by R1-R3 and D3 against the real database.) |
| 7 | `totp-enrol-concurrency.spec.ts` (extended; also :130 updated to expect the panel) | Two tabs confirm with the same correct code: the second is refused (C9 or C10, either wording), the first tab's codes stay valid (one passes `/totp`), the secret is unchanged. |
| 8 | `totp-full-login.spec.ts`, `totp-code-entry.spec.ts`, `totp-recovery-code.spec.ts`, `totp-callback-bypass.spec.ts`, `session-claim-integrity.spec.ts`, `hydration/totp-challenge.spec.ts` (**unchanged**, run) | Regression: sign-in → `/totp` → `/admin` still passes; no forged payload sets the claim. |

360px: smokes 1b and 4 run at 360x740 with `scrollWidth <= clientWidth`, the Continue ≥ 44px, and a screenshot of the panel (10 codes in the 2-column grid), the management Continue and the F344 notice, saved to `testInfo.outputPath`.

## Existing e2e blast radius

| Existing spec | Assertion this change alters | Change |
|---|---|---|
| `invitation-new-account.spec.ts:198-232` | after enrolment it expects "You enrolled on", then `/launch` → `/totp` challenge → `submitTotp` | the panel and Continue; no `/totp`; the `submitTotp` import goes if unused |
| `invitation-existing-account.spec.ts:317` | stops at `/account/2fa` and never enrols | extended (smoke 1c); the earlier assertions are untouched |
| `totp-enrol-concurrency.spec.ts:130` (+ header) | after the code, "You enrolled on" | the panel text; header says what the spec now proves |
| `account-page.spec.ts:93-115`, `role-boundaries.spec.ts:58`, `member-home.spec.ts:180-215`, `post-login-routing.spec.ts:87`, `giving-shell.spec.ts:137` | none (they stop at the enrolment form's URL or heading, which is unchanged) | run, unchanged |
| `totp-*`, `session-claim-integrity`, `developer-2fa-gate`, `giving-connect`, `domains-ui-fixture`, `giving-fixture` | none (they use the already-enrolled `mfa-enrolled` fixture) | run, unchanged |
| **`presby-2b`** (`no-organization-connect.spec.ts:22,225-228`, `community-sign-in-invite.spec.ts:437-439`, `e2e/support/sign-in-invite-fixture.ts:511` `enrolOnPage`) | **assert "Enrolment does NOT verify the session (E-35)" and a `/totp` challenge after enrolment: both become false once this merges** | **coordination item below; not edited here** |

## Edge Cases & Risks

Each claim cites the test that pins it, or says unverified.

- **The re-render after the action drops the codes.** The central risk (DECISION-292 residual c). Pinned at React level by H3 and by P4 (every branch is the holder); at the framework level only by smoke 1/1b/6 in both lanes. If it fails: the layout fallback above.
- **Reload, back, second tab while the codes show.** Codes are gone by design (operator ruling "shown once"); the management view shows the full-width Continue when a `callbackUrl` is present (P3; smoke 4); with none, "← Home" (17px, 2b walk) is the way out. Recovery is Regenerate after confirming (smoke 6).
- **Back button after Continue.** Either the management view or a bfcache-restored panel; never an error. Which one is unverified (and in Chrome a `no-store` page is normally not bfcache-eligible). Either way the codes sit in the person's own browser; not a new exposure.
- **Two tabs confirm at once.** One wins; the loser gets C9 or C10 and the winner's codes stay valid (D1; smoke 7). The loser's pending-row delete is idempotent.
- **A user who is already enrolled posts a code.** Refused, nothing replaced, no grant (E4, D2). Phase 1's condition that "has a pending row" must not become "can replace my second factor and be verified".
- **The session update fails.** Enrolment still succeeds, `sessionVerified: false`, C5 is shown, the person answers one `/totp` challenge (E5, H4). The claim is never set on a throw (E5, E6).
- **Grant before possession.** Not reachable: `verifyToken` precedes the transaction and the grant (E3).
- **The action response is lost** (network, phone sleep). The person is enrolled with unseen codes (DECISION-292 residual d). C11 tells them to reload; the management view then offers Regenerate after confirming. Unverified end to end (cannot be driven reliably in e2e); C11's toast is pinned by F3.
- **Hostile `callbackUrl`** reaches no link unsanitized: only the server computes it (P1, P2, H7; smoke 5).
- **No plaintext code outside client memory.** The cookie, its helpers and its action are gone (S1; smokes 1b/4 assert no such cookie in `context.cookies()`). A stale cookie from before the deploy expires by itself and nothing reads it.
- **F344 predicate.** Unverified is refused whether or not 2FA is required (R1, R2). An enrolled, not-required account answers one voluntary `/totp` before it can regenerate (residual e; C7 says so). A verified session that is later reset by an administrator keeps its claim (DECISION-230's residual; unchanged).
- **The grant stays un-exported.** No exported wrapper around `withTwoFactorGrant` can appear (G3); the module's importers are a closed list (G1).
- **360px.** Ten codes in a two-column grid fit (about 190px of 360); the Continue and the notice link are full width and at least 44px (smokes 1b, 4; the screenshot); the long `callbackUrl` is never printed, only used as an `href`, so it cannot overflow.
- **HydrationGate / H3.** `TotpEnrollForm` keeps both (`check:hydration-gate`); the holder renders no form; `RegenerateCodesForm` is a plain `onSubmit` form with no `useForm` today and stays so.
- **Failure of the guard.** If `onConflictDoNothing().returning()` ever returned a row on conflict the refusal would not fire; D1/D2 run against the real database and would go red.
- **Not changed, and said so:** the missing rate limit on `completeEnrollment` (TODO.md:427; residual (a) shows it adds no attacker power for a never-enrolled account because the attacker already holds the secret the page showed), the regenerate-vs-sign-in race, and key rotation.

## Out of Scope (confirm with the operator)

- A **"Copy all" or "Download" button** for the codes (Phase 1 gap 5). Ten codes in a grid can be photographed or selected. Added to TODO as a follow-up; **not ruled by the operator, so this is the one scope call to confirm.**
- A "have you saved these?" acknowledgement before Continue. The operator ruled "shown once"; the copy says so plainly. A person who clicks Continue at once loses the codes and can regenerate.
- Rate-limiting `completeEnrollment` (TODO.md:427).
- Wording changes to the 2b no-organization copy and its E-35 e2e lines (coordination item).
- F343 itself, key rotation, the regenerate-vs-sign-in race.
- Any change to `src/auth.ts`, `src/proxy.ts`, `two-factor-grant.ts` logic, `CLAUDE.md`, or `docs/architecture.md`.

## Copy

Every user-facing string the change adds or changes. **An implementer who needs a string not listed here stops for a ruling.** American spelling follows the surrounding screens ("Enroll" in the form heading, "enrollment" in action errors).

| # | String | Where | Status |
|---|---|---|---|
| C1 | "Two-factor authentication enabled" (h1) | holder, after enrolment | unchanged text, moved from `totp-enroll-form.tsx:93` |
| C2 | "Your authenticator app is now linked. Save these recovery codes now. They are shown only once: if you reload or leave this page, we cannot show them again." | holder body | **changed** from `totp-enroll-form.tsx:95-96` ("…the only time they will be shown in plaintext.") |
| C3 | "Recovery codes — save these now" (panel heading) | holder | unchanged |
| C4 | "Each code lets you sign in once if you lose your authenticator." | holder panel | unchanged |
| C5 | "You may be asked for a code from your app once more before you reach your destination." | holder, only when `sessionVerified === false` | **new** |
| C6 | "Continue" (full-width button) | holder, and management view when the request carried a `callbackUrl` | label unchanged, now a 44px button in both places |
| C7 | "To make new recovery codes, first confirm it's you with your authenticator app or a recovery code." + link "Confirm it's you" | management view, enrolled and unverified, in place of the Regenerate button | **new** (Phase 2 proposal, adopted) |
| C8 | action refusal: "Confirm it's you with your authenticator app or a recovery code first. Reload this page to see how." | `regenerateRecoveryCodes`, shown as a toast | **new** (Phase 2 proposal, reworded to carry the way back) |
| C9 | action refusal: "Two-factor authentication is already set up on this account, possibly in another tab. Reload this page." | `completeEnrollment`, toast | **new** (Phase 2 proposal, adopted with the hedge) |
| C10 | "No setup in progress was found. Reload this page to see where things stand." | `completeEnrollment`, toast | **changed** from "No pending enrollment found. Reload the page to start over." (`actions.ts:85`) |
| C11 | "Something went wrong and we could not confirm your code. Reload this page to see whether setup finished." | `TotpEnrollForm` catch, toast | **new** (closes TODO.md:425) |
| C12 | "If you reload or leave this page, these codes will not be shown again." | regenerate panel footnote | **new** |

Unchanged and re-checked as still true: "Replaces every existing code. The new set is shown once — save them before leaving the page." (`regenerate-codes-form.tsx:52`), "New recovery codes — save these now" and "Your old codes are no longer valid. Each new code can be used once.", "{n} unused code(s) remaining (of {total} total).", "You enrolled on {date}.", "That code did not match. Try again.", "Enrollment session expired. Reload the page to start over.", "Enroll in 2FA before regenerating recovery codes.", "Unauthorized.", the QR copy and the form labels.

**The four checks, per string group**

1. **C1–C6 (the codes panel and Continue).**
   - *Residuals:* nothing denies DECISION-292 (a)–(f). C2 says the codes are shown once and cannot be shown again, which is true because nothing durable re-derives them and the cookie is gone (S1); it does not claim the enrolment cannot be unverified, and C5 states the one case where a challenge follows. It does not deny residual (d): the panel is only ever shown to someone whose response arrived.
   - *Source of truth:* "now linked" is established by `completeEnrollment`'s insert returning a row (the action returns codes only after it); "shown only once" by the codes living only in the holder's state and the removal of the cookie (S1, smokes 1b and 4); C5 by the `sessionVerified` boolean the action returns, which is true only when the update completed and the returned session reports the claim. A claim the query does not read: "you will not be asked again" is **not** written anywhere, because for a not-required account the answer is not ours to promise; C5 says "may".
   - *Audience:* the person who just enrolled (any signed-in role). C6 is something every role can do (a link to their own sanitized destination); "save these now" is something they can do (select, photograph, write down).
   - *Neighbours:* `totp-enroll-form.tsx:93-120` (this is the same panel, moved and edited); `src/components/shared/fresh-recovery-codes.tsx:47-51` ("We hash codes at rest — this is the only time you'll see them in plaintext", deleted with the component); `src/lib/two-factor.ts:90-92` (comment names the cookie handoff: modified); `(invite)/invite/accepted/page.tsx` ("you will be walked through setting it up the first time": still true); `src/lib/onboarding/invitation-email.ts:63` ("once you have set up two-factor sign-in": still true); `docs/testing.md:62` and `:181` (modified: enrolment now ends in a verified session). In `presby-2b`: `src/lib/onboarding/no-organization-copy.ts:57,62` ("One more step: confirm/set up two-factor sign-in … then come back here and select Check again") stays true; the e2e comments and assertions listed above do not.
2. **C7, C8 (F344).**
   - *Residuals:* C7 tells an enrolled, not-required person they must confirm with their app first, which is residual (e) stated rather than hidden. It does not say the account is safe from a password-only attacker, or that a reset session is revoked (residual b).
   - *Source of truth:* "first confirm it's you" is shown when `session.user.twoFactorVerified` is false in the `auth()` the page read, with an enrolment row present (the branch it renders in); the action reads the same claim from its own `auth()`. Neither reads the database for verification state, which is why neither says "your session has expired" or "your account is locked".
   - *Audience:* any signed-in person with an enrolment, the surface's default role. They can follow the link: `/totp` accepts any signed-in enrolled user, with a TOTP code or a recovery code (verified in `(auth)/totp/page.tsx`: it redirects only the *un*enrolled to `/account/2fa`). The toast C8 has no link, so it says "Reload this page to see how", and the reloaded page renders C7 with the link.
   - *Neighbours:* `src/app/(account)/account/2fa-status.tsx:22` ("Manage / regenerate codes") still true (the page it links to explains the extra step); `regenerate-codes-form.tsx:52` still true; `src/app/(auth)/totp/totp-challenge-form.tsx:40` ("Try again, or use a recovery code") still true.
3. **C9, C10, C11 (enrolment failures).**
   - *Residuals:* none denied. C9 hedges its cause ("possibly in another tab"); C11 says "whether setup finished", not that it did or did not (residual d).
   - *Source of truth:* C9 = the conflict insert returned no row, i.e. a `user_totp` row exists for this user; it does not claim which tab or who made it. C10 = no pending row for `session.user.id` (true for both the second-tab loser and an admin reset or garbage-collection); the instruction is the same in either. C11 = a rejected call, so the string states no state.
   - *Audience:* the person enrolling, any role; "reload this page" is something they can do.
   - *Neighbours:* `actions.ts:85` (the old "start over", modified, because "start over" is false for someone who has enrolled); the unchanged "Enrollment session expired. Reload the page to start over." is still correct (the expired case); `docs/TODO.md:425` is closed by C11.
4. **C12 (regenerate footnote).** *Residuals:* none. *Source:* the codes live in `RegenerateCodesForm` state only; a reload drops them (RG tests). *Audience:* an enrolled, verified person (the form is only rendered then). *Neighbours:* the text under the button already says "shown once"; consistent.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here, or *deferred* (who accepted) |
|---|---|
| P1 Gap 1: regenerate bypasses the second factor (F344) | Batch 1; API Contract (`regenerateRecoveryCodes`), R1-R6 and D3, smoke 6, C7/C8 |
| P1 Gap 2: plaintext in a cookie and in client state | The cookie is removed from both paths (Component Plan, S1, smokes 1b/4) |
| P1 Gap 3: "once" versus "survives a reload" | Operator ruled "shown once"; C2 says so; reload loses the codes by design |
| P1 Gap 4: management view has no way onward | Management Continue (P3, smoke 4) |
| P1 Gap 5: no copy/download | *Deferred*; not ruled by the operator, flagged for confirmation under Out of Scope; TODO line |
| P1 Gap 6: the extra `/totp` challenge | Option C: the grant (E1, smokes 1, 1b, 1c, 2); C5 covers the failure case |
| P1 Gap 7: authenticator-only steps untested end to end | Smokes 1-4 type a real code from the shown key; the new specs assert what the person sees |
| P1 Flow 3/4 (reload; regenerate duplicate panel) | Smoke 4; smoke 6; the cookie path that produced the duplicate is gone |
| P1 adversarial: redirect target | Server-sanitized prop only (P1, P2, H7, smoke 5) |
| P1 adversarial: marking verified at enrolment, five conditions | Possession proof first (E3), refuse-if-enrolled in the insert (E4, D1, D2), grant inside the action for `session.user.id` (G2), no client path (G4, H7), distinguishable audit (E7) |
| P1 edge: back button, second tab, DB error message | Back: unverified, accepted above; second tab: C9/C10 (smoke 7); DB error: C11 (F3) |
| P1 edge: 360px, HydrationGate | Smokes 1b/4; `check:hydration-gate` |
| P1 "Fix Must Preserve" (all eight) | Codes shown once; hashes via `hashRecoveryCode`; sanitizer; no secret logged (E5, E7); gates; grant only via `withTwoFactorGrant` in an action; `TOTP_ENROLLED` on every enrolment (E7); 0.44.1 auto-submit and F342's guarantee (existing N-1..N-6 kept, unchanged page-side helper) |
| P1 Phase 6 walk | Phase 6 walk below |
| P1 open questions 1-4 | 1: fixed here; 2: operator, "shown once"; 3: operator, "remove it"; 4: walk, below |
| Orchestrator: F344 in this pipeline; recommend "any enrolled session unverified is refused" | Done, with the wider predicate (R3) |
| Operator: "shown once", "remove the second prompt" | Option A rebuilt + option C |
| **R1** (exact `completeEnrollment` shape) | API Contract, steps 1-7 verbatim, plus the transaction and the stricter `sessionVerified` |
| **R2** (same-identity holder, context setter, Continue, management Continue, cookie removal, BUG-2 replacement, fallback) | Component Plan; P1, P4, H1-H7, S1; fallback recorded as a Phase 4 decision |
| **R3** (F344 refusal, audit key, notice, tests failing-first) | API Contract; C7/C8; R1-R6, A1, P5; "Confirm it's you" link via `URLSearchParams` |
| **R4** (set-equal allow-list) | G1-G4 above, verbatim |
| **R5** (docs; stage for downstream-sync) | `two-factor-grant.ts` comment; DECISION-292; the TODO line for `/downstream-sync` (below) |
| **R6** (eight smokes, 3650, prod lane) | Smokes 1-8 table, with 1b as the production-lane spec on 3651 and two stated adaptations (the refused call as a stale-tab press; the production lane's no-org stand-in) |
| R6 unit extras (already-enrolled refusal, order spy, caught failure, 360px) | E4, E3, E5; 360px in smokes 1b/4 |
| **DECISION-292 text** and residuals (a)-(f) | Reproduced in the work-log Phase 2; the Phase 3 additions to it are listed below; every Copy string was checked against (a)-(f) |
| TODO.md:425 (thrown action shows no message) | Closed by C11 |
| TODO.md:428 (non-transactional replacement) | Closed for both paths by the transaction (the rate limit half stays at :427) |
| TODO.md:427 (no rate limit on `completeEnrollment`) | *Deferred*; already tracked; residual (a) is why it is not worsened; flagged to the operator |
| TODO.md:429 (remove the 2b `enrolOnPage` workaround) | Coordination item below (the workaround lives in `presby-2b`, not in this tree) |

**Phase 3 additions to DECISION-292** (for the orchestrator to merge at integration; no new number): (1) the enrolment writes run in one `db.transaction`, and so does the regenerate replacement; (2) `sessionVerified` requires the returned session to report the claim, not just a clean return; (3) Continue is a plain `<a>` (full navigation) so the codes leave memory and the proxy reads the fresh cookie; (4) the layout fallback is the one sanctioned deviation for R2.

## Feasibility check, against the live tree

- **No SQL, no migration.** The only "signature" changes are TypeScript: `replaceRecoveryCodes(executor, userId, codes)`.
- **No `ALTER`/`DROP`.** Nothing is dropped from the database; the removed exports (`FRESH_RECOVERY_CODES_COOKIE`, `clearFreshCodesCookieAction`, `FreshRecoveryCodes`) were grepped: references are only in this route, `two-factor.ts` and `fresh-recovery-codes.*` (`grep -rn` over `src e2e docs scripts .claude`); no `SECURITY DEFINER` function references them (they are application code).
- **No CHECK, trigger, FK.** `scripts/seed-dev.sql` and the fixture files are not touched; `seedTotpEnrollment` inserts into `user_totp` unchanged.
- **Drizzle.** `drizzle-orm ^0.45.2`: `insert().values().onConflictDoNothing({ target }).returning()` and `db.transaction()` on the neon-serverless pool are both in use (`src/lib/event-types.ts:509` for `onConflictDoNothing`; `src/lib/people.ts` for `db.transaction` on the `presby_app` pool, which `src/lib/db/index.ts:70` builds as a WebSocket pool). The comment in `(admin)/admin/users/[id]/actions.ts:71-75` that says the driver cannot transact is stale (it describes the retired neon-http driver); it is not touched here. One transaction rule applies (`people.ts:316`): an early `return` inside the callback **commits** what was written so far, only a throw rolls back. The `inserted.length === 0` branch relies on that on purpose, so the pending-row delete commits and nothing else was written. `presby_app` needs only INSERT/DELETE on the three tables, which today's action already uses.
- **`unstable_update` return.** `next-auth@5.0.0-beta.32` `update()` returns `res.body`; Phase 4 confirms it carries `user.twoFactorVerified` (the session callback projects it, `session-projection.ts:25`), with the stated fallback.
- **Parallel pipelines.** Neither `presby-2fa` (F343: `local-login.ts`, a migration) nor `presby-2b` has touched `(account)/account/2fa/*`; the only files in common are the shared hand-edited ones, edited only at integration. The 2b design predates this change (Increment 2b was designed 2026-10-22): its feasibility is *not* re-run here; that is the coordination item.

## Coordination items (named, not edited here)

1. **Community 2b (`presby-2b`).** Once this merges, three things in 2b are false and will fail loudly: (a) `e2e/no-organization-connect.spec.ts:22,225-228` and `e2e/community-sign-in-invite.spec.ts:437-439` assert that enrolment does not verify the session (E-35) and that a challenge follows; (b) `e2e/support/sign-in-invite-fixture.ts:511` `enrolOnPage` is the reload-and-retry workaround that F342 made removable (TODO.md:429) and that this change makes obsolete in a second way (it reads the old "You enrolled on" settle); (c) 2b's work-log E-35 wording. The user-facing copy (`no-organization-copy.ts:57,62`) stays true. Whichever of the two merges second re-runs `no-organization-connect` and `community-sign-in-invite` and updates those lines in its own pipeline.
2. **F343 (`presby-2fa`).** Independent files. After F343, plain new members default to not-required; for them this is a voluntary enrolment (smoke 3). Administrators and treasurers still enrol on the way in (smokes 1, 1c, 2).

## Phase 6 walk (set now)

On `development`, at 360px, from the pipeline branch (a Neon branch, `.env.local` pointing at it), list each page and what it shows:
1. **Accepted-invitation new account:** `/invite/accepted` → sign in → `/signin?callbackUrl=/launch` → `/account/2fa?callbackUrl=…` (enrol form) → type the six digits → the codes panel with Continue, no second prompt → Continue → `/o/<slug>`.
2. **A founding administrator who must enrol** (arrives via `/admin` or `/o/<slug>`; the `callbackUrl` survives to Continue).
3. **A voluntary enrolment** from `/account` with no `callbackUrl` (Continue → `/launch`).
4. Then, as the same people: reload while the codes show (management view with Continue), press Regenerate with a verified session (panel survives), and sign in again in another tab and try Regenerate (the refusal).
Also run F343's "administrators and treasurers still enrol on the way in" case after F343 merges (Phase 1 open question 4).

## TODO lines (orchestrator, at integration; Rule 10)

- Move to Done at ship: TODO.md:167 (F166), F344 (registered by the orchestrator), :425 (thrown action message), :428 (non-transactional replacement, both paths).
- Add: **"Copy all" / download button for recovery codes** (P1 gap 5; deferred pending operator).
- Update :429 (`enrolOnPage`): it now also depends on this merge; remove it and the E-35 assertions in `presby-2b` when 2b rebases onto a main that has F166; re-run `invitation-new-account` x40.
- Add: **`/downstream-sync`: stage F166 and F344** (the fresh-codes cookie came from the starter, note the `claudecode_` prefix; both are starter-generic; Phase 2 suggestion).
- Keep: :427 (rate limit on `completeEnrollment`).

## Release note (draft for `/release-notes`, v0.46.3, non-engineer wording)

> ### Fix: setting up two-factor sign-in keeps your recovery codes on screen
>
> **Value:** When you set up two-factor sign-in for the first time, your ten recovery codes now stay on the page until you choose Continue, and Continue takes you straight to where you were going, without asking for another code from your app.
>
> Before, the codes disappeared within a second of finishing, the Continue link went with them, and you were asked for a code again. Now the codes stay up, and you are signed in as verified as soon as setup finishes. The codes are shown once: if you reload or leave the page they are not shown again, so save them first. If you lose them, you can make a new set from the Two-Factor Auth page.
>
> **Also fixed:** making a new set of recovery codes now needs you to have confirmed it's you with your authenticator app or a recovery code in this sign-in. Before, someone who knew only your password could make new codes and use one to get past the second step. The page now shows a short "Confirm it's you" step first. An account that has set up two-factor but is not required to use it will also be asked for one code before it can make new codes.
>
> **What this does not change:** an account that has never set up two-factor can still be set up by anyone who knows its password (that was already true; it now counts as verified straight away instead of after one more prompt). If an administrator resets someone's two-factor, a browser that is already signed in stays signed in until it signs out. If your connection drops at the very moment setup finishes, you may be set up without having seen your codes; confirm it's you, then make a new set. Setup still has no limit on how many codes can be tried in a row.
>
> **Notes for the operator:** no migration, no new setting.

(Residuals a, b, d, e and the open rate limit are named; nothing in the note denies them. The "what this does not change" paragraph is checked against DECISION-292 (a)-(f) and TODO.md:427.)

## Implementer

**full-stack-developer.** The change is small and tightly coupled across server action, one client holder, a server page and e2e (a split would force a second hand-off over the same two files). Two commits as described; the running-server gate on 3650 and the prod lane on 3651 are theirs to run before Phase 5, and the red-first evidence goes in the Phase 4 section.

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
