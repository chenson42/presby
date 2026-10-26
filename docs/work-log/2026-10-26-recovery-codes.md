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
