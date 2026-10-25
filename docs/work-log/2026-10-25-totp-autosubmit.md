# Verify the two-factor code when the last digit is typed — Work Log

> **Slug:** `2026-10-25-totp-autosubmit`
> **Surface:** (auth) `/totp`, (account) `/account/2fa`; shared `OneTimeCodeInput`
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated Feature (no migration, route, action, dependency, or edit to src/auth.ts / proxy / authz). Touches `src/app/(auth)/`, so the Phase 4 running-server e2e with an MFA-enrolled user applies and Phase 5 must run it (BLOCKED otherwise). Architect skipped: no structural change.
> **Numbers (pre-assigned 2026-10-25):** DECISION-257; F282; no migration; dev port 3560; Neon branch `pipeline-totp-autosubmit`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; Decisions 1–10, Gaps 1–7 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Skipped — Accelerated Feature: no new directory, dependency, route, action, schema or invariant | — | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete; implementer named (full-stack-developer); F282 registered | Design complete | 2026-10-25 |
| 4 — Implementation | full-stack-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

Work-log: `/Users/cshenso/git/presby-platform/presby-otp/docs/work-log/2026-10-25-totp-autosubmit.md`. I read the source only. The Phase 1 section in the work-log is still the unfilled template.

### VERDICT

READY WITH NOTES

### ONE-LINE TAKE

> When the sixth digit lands (typed, pasted or autofilled), submit the code once through the same path the Verify button uses, and keep the button as the fallback. The real work is the hidden-input timing, the double-submit guard, re-arming after a failure, and about 20 e2e call sites that click Verify after typing.

### Where the box component is used

`OneTimeCodeInput` is imported by exactly two forms (grep of `src/`, `e2e/`, `scripts/`). Neither invitation-acceptance flow renders it. The invitation specs reach it through the `/account/2fa` enrolment form, which is the same surface.

| Surface | File | Submit mechanism today |
|---|---|---|
| `/totp` challenge (digit mode) | `src/app/(auth)/totp/totp-challenge-form.tsx` | Native `<form action={verifyTotpAction}>`. The component's `onComplete` only moves focus to Verify. |
| `/account/2fa` enrolment | `src/app/(account)/account/2fa/totp-enroll-form.tsx` | `onSubmit` calls `completeEnrollment({code})`, with a toast on failure. |
| `/totp` recovery mode | same file, plain `<Input name="token">` | Not `OneTimeCodeInput`. Out of scope. |

`OneTimeCodeInput` already has the hook this needs. `onComplete(code)` fires only on a user edit that leaves the code complete and changed, never on mount, never on an unchanged edit. Auto-submit should hang off that.

### User verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member or admin, mid-sign-in (`/totp`) | Type, paste or autofill the 6th digit. Verification starts with no button press. | Every sign-in that needs 2FA |
| Same | Press Verify (fallback) | Rare: after a failure, or by choice |
| Same | Switch to a recovery code and press Verify | Rare |
| Authenticated member (`/account/2fa`) | Type, paste or autofill the 6th digit to confirm enrolment | One-time |
| Same | Press Confirm enrollment (fallback) | Rare |

Everything here is the authenticated-member surface. The anonymous visitor and the no-roles user are not involved.

### Flows

**Flow 1 — `/totp`, correct code.**
- Entry: redirect from the proxy or `/launch`, with box 1 focused after hydration.
- Steps: the user types 6 digits → the 6th completes the code → the form submits once → Verify shows "Verifying…" and is disabled → `verifyTotpAction` runs, opens the grant (0.42.3), and redirects to `callbackUrl`.
- Failure: see Flow 2.

**Flow 2 — `/totp`, wrong, expired or rate-limited code.**
- Steps: same as Flow 1 up to the action. The action redirects to `/totp?error=invalid` or `rate_limited`.
- User sees: the existing `role="alert"` copy. Boxes cleared and box 1 focused (today's behaviour, pinned by `totp-code-entry.spec.ts`). The user types a fresh code and it auto-submits again.
- The new risk is that a typo in digit 6 now submits immediately, with no chance to correct. It costs one of 10 attempts per minute and one `totp.verify_failed` audit row. The code expires in 30 seconds anyway, so I count this as acceptable. Phase 3 must not call it free.

**Flow 3 — `/totp`, paste or autofill.**
- Steps: the user pastes "482 915", or iOS or a password manager fills the whole code into box 1 → the component spreads it across the boxes → `onComplete` fires once → submit.
- Failure: as Flow 2.

**Flow 4 — `/totp`, recovery mode.**
- Steps: the user taps "Use a recovery code instead" → types an `XXXX-XXXX` code → presses Verify. No auto-submit. The format has a variable length and a dash, so there is no "last character" event. This is unchanged.
- Failure: as Flow 2, with the same shared error copy.

**Flow 5 — `/account/2fa` enrolment.**
- Steps: the user scans the QR → types or pastes the code → the 6th digit completes it → `completeEnrollment` runs (boxes disabled while pending) → the success panel shows the one-time recovery codes with a Continue link. There is no auto-redirect, so the recovery codes cannot be missed.
- Failure: the toast "That code did not match. Try again." The boxes are re-enabled. They currently keep the wrong code, and focus is lost because a focused box was disabled.

### Permissions and flags

- **Permission(s):** none new. `/totp` and `/account/2fa` are auth-only and the action checks are unchanged.
- **Flag(s):** not needed. The operator's standing rule is no new platform flags before go-live. Rollback is a revert, because the change is only client-side triggering. This keeps Permissions vs Flags clean.
- **Audit:** no new events. `totp.verify_succeeded`, `totp.verify_failed` and `totp.enrolled` fire exactly as now because the same action is invoked. Expect more `verify_failed` rows from fast typos (Gap 5).
- **2FA gate:** `/account/2fa` is the mid-enrolment destination for `twoFactorRequired` users. Auto-submit works there with no new redirect.
- **Invariants:**
  - Rule H3 and DECISION-192: both consumers keep `<HydrationGate>`.
  - The 0.42.3 session fix: the grant opens only inside `verifyTotpAction`, so the client must trigger the existing form action and never call the action or `unstable_update` itself.
  - DECISION-257 amends DECISION-192(a)'s "there is no auto-submit" sentence. The comment in `totp-challenge-form.tsx` ("no auto-submit: a typo would spend one of ten attempts") and the e2e header comments become false and must be updated.

### Decisions I am specifying (defaults)

1. **Scope.** Auto-submit on `/totp` digit mode and on the `/account/2fa` enrolment form. Both have the 6-digit code as the only input. Recovery mode does not auto-submit.
2. **Trigger.** `onComplete`, which fires once per transition to a complete code. This covers the 6th digit typed, a full paste, and whole-code autofill (iOS and Android one-time-code, password managers). It never fires on mount, on an unchanged edit, or on backspace and retype of the same digit (value unchanged), and it never fires per keystroke after 6.
3. **Over-long paste (default).** A paste or autofill with exactly 6 digits after stripping spaces and dashes auto-submits. One with more than 6 digits (for example "1234567" or a phone number) fills the first six boxes as today but does not auto-submit. The user presses Verify. This needs `onComplete` to carry whether the run was exactly the code length, or an equivalent. It stops a stray paste from spending an attempt.
4. **Visible button stays.** On `/totp` it stays in the tab order. In digit mode it is disabled until 6 digits, then disabled with "Verifying…" while pending. Remove the "move focus to Verify on completion" effect. It is dead weight now, and a focus jump would fight the submit.
5. **Double-submit.** A ref records the code already submitted. At most one submission per distinct complete code. Also skip if the form is pending. Pressing Verify during the pending state is a no-op, since the button is already disabled. Re-arm happens only when the value changes to a different complete code (any edit that leaves a hole and then completes again, or a different paste).
6. **After a wrong code on `/totp`.** Keep today's behaviour: the existing copy, boxes cleared, box 1 focused. Do not assume the form remounts after the server-action redirect (same route, new query). `totp-code-entry.spec.ts` currently asserts "cleared and focused", so key the form on `error` (or equivalent) so a second auto-submit works. This must be proven by an e2e: a wrong code, then a second code, auto-submits again.
7. **After a wrong code on enrolment.** Clear the boxes and refocus box 1. This matches `/totp`, and the authenticator code has rolled over anyway. The component has no imperative focus API today, so Phase 3 chooses between a reset key and a focus prop. The toast copy stays.
8. **Before hydration.** Nothing can submit, because the HydrationGate fieldset is disabled and the component's handlers are not attached. The submit must not be triggered from a server-rendered path. `onComplete` is hydrated-only, so H3 holds structurally. The hydration spec keeps its guarantee: no `verify_failed` row pre-hydration.
9. **Rate limit.** Auto-submit uses the same action and the same 10/min limit. With one submission per complete code and no per-keystroke path, it cannot burn attempts faster than manual entry except by removing the pause for correction. `rate_limited` renders the existing copy.
10. **Screen readers.**
    - Add a visually-hidden `role="status"` live region that is always mounted and filled only while pending. The announcement is "Verifying your code." Do not move focus on submit and do not trap it.
    - Box 6 keeps focus while pending. Disabling a focused box drops focus on `/totp`, which is the problem enrolment has today.
    - The failure message is already `role="alert"`.
    - `useFormStatus` works only inside a child of the form, so the status region is a child component like `VerifyButton`.

### Gaps the request didn't address

1. **Hidden-input timing (highest implementation risk).** `onComplete` runs inside the change handler, before React commits the new hidden `token`. A `requestSubmit()` called right there posts the previous (empty or 5-digit) value. The submit must happen after the render that carries the 6 digits, for example from an effect keyed on `[code]`. It must also go through the form (`requestSubmit`, so the existing `FormData` with `token` and `callbackUrl` is posted). The unit test `fd.getAll("token") === ["123456"]` is the guard.
2. **About 20 e2e call sites break.** Every flow that does `enterTotpCode(...)` then clicks `/^verify$/i` will race the auto-submit or find the button renamed "Verifying…". The sites:
   - `session-claim-integrity`
   - `totp-callback-bypass` (5)
   - `totp-full-login` (2)
   - `branded-signin`
   - `support/invitation-ui`
   - `support/domains-ui-fixture`
   - `support/giving-fixture`
   - `hydration/totp-challenge`
   - `totp-code-entry` (the wrong-code test)
   - `totp-recovery-code` (the recovery toggle, then Verify, which is still valid)
   - `invitation-new-account` clicks "Confirm enrollment" after `enterTotpCode`.

   Phase 3 should name one resolution at the helper level. A good one is to have `enterTotpCode` stop at typing and callers stop clicking, plus a helper such as `waitForTotpVerified(page, urlRegex)`. These files are shared (Rule 16), so flag the conflict risk against parallel pipelines.
3. **Tests that now assert the opposite.** The e2e "typing advances … then focus moves to Verify without submitting" and the unit test "enables Verify only at six digits and moves focus to it, without submitting" contradict the new behaviour. They are rewritten, not kept. The paste and autofill e2es currently assert "stays on `/totp`" and "Verify enabled". The first (enabled button) becomes a pending or navigated state. Use a test-only wrong code, because a real code would navigate away.
4. **Doc and comment drift.** DECISION-192(a), the component and form header comments, and the e2e headers say "no auto-submit". Check `docs/ui-standards.md` and `docs/testing.md` too.
5. **Audit noise.** Fast typos produce more `totp.verify_failed` rows. If anyone alerts on the count, say so in the release note. Not a defect.
6. **Enrolment has no rate limit.** `completeEnrollment` has no `checkRateLimit`, unlike the challenge. This is pre-existing and auto-submit does not worsen it, because the pending secret is single-session. Log it as a TODO observation rather than fixing it here.
7. **Release notes and what's-new.** Member-visible, minor. A one-line what's-new is optional under Rule 13.

### Adversarial pass

- **Unintended submission by stale or garbled input.**
  - Autofill of a stale code: autofill is user-initiated and the server accepts the previous 30-second step. An older code simply fails like a typo. Not exploitable.
  - Pasting a 7-digit string, an order number or a phone number into box 1 would submit the first six digits. Decision 3 closes this.
  - Browser restore (back/forward, bfcache) of a complete code: `onComplete` does not fire on mount, so nothing submits. That needs a test, "does not fire on mount even with a complete initial value", and the existing one covers it.
  - Duplicate input events (iOS autofill sometimes fires input then change): the `joined === before` guard in the component means one `onComplete`. Pin it.
- **Skipping the action's checks.** None. The submit is the same native form post to the same `verifyTotpAction` (session check, enrolment check, 10/min limit, verify, grant). Nothing on the client decides success. The `callbackUrl` hidden field is re-sanitised server-side as today, and the redirect-validation spec `totp-callback-bypass` must stay green.
- **State-machine shortcuts.** There are none new. The auto-submit does not change what `/totp` or `/account/2fa` allow.
- **Enumeration.** The `invalid` copy stays shared between authenticator and recovery failures. Auto-submit changes no response differences.
- **Double and concurrent submits.** Possible without the guard: autofill plus a manual Verify click would run the verify twice, and the second would hit the rate limit or fail. Decision 5 covers it. Test it with a pending form.
- **Mode switch mid-pending.** The toggle must be disabled or ignored while pending, so the mutually exclusive `token` field invariant (R6) cannot be broken between submit and response.
- **Input boundaries.** Server-side validation is unchanged (`/^\d{6}$/`), and non-digits are still stripped client-side.
- **Self-targeting.** Not applicable.

### Copy

| String | Where | Note |
|---|---|---|
| "Verifying…" | Verify button and the enrol button while pending | Reuse the existing text. |
| "Verifying your code." | New visually-hidden `role="status"` region, rendered while pending | Only new string. Neither false nor a promise about outcome. |
| "That code didn't match. Try again, or use a recovery code." | `/totp` error (unchanged) | Still true: the recovery option remains. |
| "Too many attempts. Please wait a moment before trying again." | `/totp` (unchanged) | |
| "That code did not match. Try again." | Enrolment toast (unchanged) | |

I would not add a visible "Checking your code…" line. The button label already changes, and a second visible status would move the layout at 360px.

### 360px

No new layout. The boxes are sized for 296px. The status region is `sr-only`. Verify at 360px that the on-screen keyboard plus the single-line pending label do not overlap the error. The existing 360px e2e continues.

### Regression tests to write failing-first

**Unit, `one-time-code-input.test.tsx`:**
- `onComplete` fires once per complete-code transition.
- It does not fire for a hole.
- It does not fire on mount.
- It does not fire on a re-entry of an unchanged value.
- An over-length paste is distinguishable (Decision 3).

**Unit, `totp-challenge-form.test.tsx`:**
- Typing the 6th digit calls `verifyTotpAction` exactly once, with `fd.getAll("token") === ["123456"]` and the `callbackUrl`.
- A 5-digit code never submits.
- A full paste and a whole-code `fill` on box 1 each submit once.
- Recovery mode never auto-submits.
- No submission before hydration.
- A pending form ignores a second complete code and a Verify click.
- An edit after a failure re-arms and submits once.
- The same complete code is not resubmitted.
- The status region is empty at rest and says "Verifying your code." while pending.
- The Verify button remains and still works as the fallback.
- The focus-to-Verify test is replaced.

**Unit, `totp-enroll-form.test.tsx`:**
- The 6th digit calls `completeEnrollment({code})` once, and the pending state disables the boxes.
- After `{ok:false}`, the boxes are cleared, box 1 is focused, and a new code auto-submits once.
- A 5-digit or over-length paste does not submit.
- The button still works.

**e2e, running server, MFA-enrolled seeded user (the Phase 4 gate for `src/app/(auth)/`):**
- `totp-code-entry.spec.ts`: type a real code with no button press and land on `/admin` (using `callbackUrl=%2Fadmin`). The audit shows exactly one `totp.verify_succeeded` and no `verify_failed`.
- A wrong typed code lands on `?error=invalid` with boxes cleared and box 1 focused. A second, correct code then auto-submits (re-arm).
- A pasted code (real clipboard) auto-submits. A whole-code `fill` auto-submits.
- A 7-digit paste fills six boxes and does not submit.
- Recovery mode: typing does not submit. Verify with the button still passes (`totp-recovery-code` unchanged).
- At 360px the pending state has no horizontal overflow.
- `hydration/totp-challenge.spec.ts` (both lanes): still no `verify_failed` before hydration. After release, an auto-submitted real code lands on `/admin` with one success row.
- Enrolment (extend `invitation-new-account` or an `/account/2fa` spec): the 6th digit enrols and shows the recovery-codes panel with no button press.
- All ~20 call sites from Gap 2 are updated and green. `totp-full-login`, `totp-callback-bypass`, `session-claim-integrity` and `branded-signin` are the 0.42.3 session-fix regression guards and must pass unmodified in intent.

**Tripwires:** `check:hydration-gate` (H3), `check:audit` and `npm run check` stay green.

### Out of scope (confirm)

- Recovery-code auto-submit.
- Removing the Verify button.
- Rate-limiting `completeEnrollment` (Gap 6, TODO).
- Changing the 10-per-minute limit or server verification.

### Open questions (with defaults)

1. After a wrong code on enrolment, clear and refocus box 1? Default: yes.
2. Over-long paste: fill but do not auto-submit? Default: yes (Decision 3).
3. A what's-new entry? Default: a one-liner, optional.
4. `e2e/support` helper change: the helper stops at typing and every caller drops its Verify click, or a new helper is added? Default: Phase 3's call, one change at the helper, with no per-spec patching.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

**Handoff:** to tech-lead for Phase 3 (the architect is skipped under the Accelerated Feature notation). The design must carry forward Gaps 1–4 and Decisions 1–10 in its Carry-forward table. Name the implementer (ux-developer or full-stack-developer, since the UI and the e2e helpers move together). Per the work-log, auth-touching Phase 5 runs against a real dev server with the MFA-enrolled user. Anything less is BLOCKED.

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

**Date:** 2026-10-25 · **Class:** Accelerated Feature (no migration, schema, route, server action, `SECURITY DEFINER` function, dependency, flag or permission; no edit to `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`). Phase 2 skipped (see status table). Feasibility checked against the live tree of `presby-otp` (HEAD `b903154`, v0.42.5); no other pipeline has merged into it since Phase 1.

## Summary

When the sixth digit of a two-factor code lands, by typing, paste or whole-code autofill, the form submits it once through the same path the Verify button uses. `OneTimeCodeInput.onComplete` gains a second argument saying whether the completion was exactly code-length, so an over-long paste (Decision 3) fills the boxes but waits for the button. On `/totp` the submit is `form.requestSubmit()` from an effect that runs after the render carrying the six digits (Gap 1), so the existing native form posts the existing `FormData` to the unchanged `verifyTotpAction`. On `/account/2fa` the same trigger calls the existing handler directly, since that form has no native action. The Verify and Confirm buttons stay as the fallback; the "focus moves to Verify" effect goes. The 0.42.3 grant opens only inside `verifyTotpAction` (`withTwoFactorGrant`); nothing on the client calls the action's internals, `unstable_update` or `@/auth`.

## Permissions & Flags

- Permission key(s): none. `/totp` and `/account/2fa` stay auth-only; the action's checks are untouched.
- Default role bindings: none.
- Feature flag(s): not needed (operator rule: no new platform flags pre-live; rollback is a revert of client-side triggering). No `FEATURES` key, no `FEATURE_CATALOG` or seed edit, no `scripts/ci/e2e-baseline-flags.sql` edit.

## API Contract

No route and no server action is added or changed. Signatures that move:

- `verifyTotpAction(formData: FormData)` and `completeEnrollment({code})`: **unchanged**, byte for byte. Feasibility: `actions.ts` in both folders are not in the diff.
- `OneTimeCodeInputProps.onComplete`: `(code: string, info: { exact: boolean }) => void`. `exact` is true when the edit that produced the complete code delivered at most `length` digits (a typed digit, an overtype, a fill or paste of 1 to `length` digits); false when a paste or autofill delivered more than `length` digits and was truncated. Fires under the existing rule only (user edit, code complete, code changed, never on mount). Implementation: `commit(next, exact = true)`; `spread()` passes `digits.length <= length`.
- Internal to `totp-challenge-form.tsx`: a child `FormStatusProbe({ onSettled, pendingRef })` rendered inside the `<form>`. It calls `useFormStatus()`, renders the status region, mirrors `pending` into `pendingRef` in an effect, and calls `onSettled()` on a true-to-false transition (tracked with a ref). `useFormStatus` works only below the form, which is why this is a child, not parent state.

## Data Model

No schema changes required. No new CHECK, trigger or FK, so the SQL feasibility items (parameter order, `DROP`/`ALTER` dependents, `seed-dev.sql`, composite tenant keys) do not apply. No audit action is added: `totp.verify_succeeded`, `totp.verify_failed`, `totp.recovery_*` and `totp.enrolled` fire from the same action as today (`npm run check:audit` unaffected).

## Component / Page Plan

- Pages to create: none. `src/app/(auth)/totp/page.tsx` is **not** modified (no `key` on `error`; see F282 below).
- Components to create: none (the probe is file-local).
- Files to modify:
  - `src/components/shared/one-time-code-input.tsx` (`onComplete` signature and `exact`; prop doc comment line 48 and the header contract; no other behaviour).
  - `src/app/(auth)/totp/totp-challenge-form.tsx`.
  - `src/app/(account)/account/2fa/totp-enroll-form.tsx`.
  - Unit tests: `one-time-code-input.test.tsx`, `totp-challenge-form.test.tsx`, `totp-enroll-form.test.tsx`.
  - e2e: `e2e/support/totp-page.ts` plus the call sites in the table below.
  - Docs and comments: see "Doc and comment drift".

### `/totp` form (`totp-challenge-form.tsx`)

- **State and refs.** Keep `mode`, `code`, `recovery`. Delete `verifyRef`, `focusVerifyWhenReady` and the focus effect. Add `formRef`, `armed = useRef<string | null>(null)`, `submitted = useRef<string | null>(null)`, `pendingRef = useRef(false)`, and `attempt` state (number, starts 0).
- **Trigger.** `onComplete={(c, { exact }) => { armed.current = exact ? c : null; }}`. It only arms; it never submits (the hidden `token` is not yet committed in the handler).
- **The submit effect** (Gap 1), `useEffect(..., [code, mode])`:
  1. `if (code.length !== CODE_LENGTH) { submitted.current = null; return; }` (a hole re-arms, Decision 5).
  2. `if (mode !== "digits" || armed.current !== code) return;`
  3. `armed.current = null;`
  4. `if (submitted.current === code || pendingRef.current) return;`
  5. `submitted.current = code; formRef.current?.requestSubmit();`
  The effect runs after the commit, so the hidden `token` input already carries the six digits and `FormData` carries `token` and `callbackUrl`. `requestSubmit()` (no submitter argument, so a disabled Verify cannot throw) fires the submit event React routes to `action={verifyTotpAction}`; the `<form action={verifyTotpAction}>` line is unchanged. jsdom 29.1.1 implements `requestSubmit` (verified in `node_modules/jsdom/.../HTMLFormElement-impl.js`).
- **Pending guard.** `pendingRef` is written only by the probe's effect. The window between `requestSubmit()` and the probe's first pending render is one commit, and the only inputs are the boxes, so a second *different* complete code inside it is not reachable by hand; the `submitted` ref covers the same code. Unit-pinned with the mocked `useFormStatus`; the single-POST e2e pins it in a browser.
- **Re-arm and reset after a failed attempt.** `onSettled` (the probe saw pending go true then false) does `setCode(""); submitted.current = null; armed.current = null; setAttempt(a => a + 1);`. The digit-mode `OneTimeCodeInput` carries `key={attempt}` and keeps `autoFocus`, so the remount gives cleared boxes and focus on box 1 through the existing hydrated-gated effect (`didAutoFocus` is per instance). This is a reset by *completion*, not by URL. Reasoning (F282): today's "boxes cleared and focused after a wrong code" (pinned by `totp-code-entry.spec.ts`) most likely holds because Next remounts the page segment when the query string changes. A second wrong code redirects to an *identical* URL (`?callbackUrl=…&error=invalid`), so a `key` on `error` would not change and the stale code could remain. Settle-based reset works whether or not Next remounts. On success the tree is replaced in the same commit, so there is no visible clear. Pinned by the e2e "two wrong codes in a row".
- **Verify button.** Stays, `disabled={!canSubmit || pending}`, label "Verifying…" while pending (unchanged strings). Focus stays on box 6 while pending (nothing moves focus).
- **Mode toggle.** Extract `ModeToggle` as a child component using `useFormStatus`: `disabled={pending}` so the mutually exclusive `token` field invariant (R6) cannot flip between submit and response. Click behaviour unchanged. `switchMode` also clears `armed` and `submitted`.
- **Status region.** The probe renders `<p role="status" className="sr-only">{pending ? "Verifying your code." : ""}</p>`, always mounted, text only while pending (a live region must exist before its text changes). It sits next to the error `<p role="alert">` and adds no visible pixel (360px unchanged).
- **Recovery mode** never arms (no `OneTimeCodeInput`); Verify and Enter work as today.

### `/account/2fa` enrolment form (`totp-enroll-form.tsx`)

- Not a native action, so no `requestSubmit` (it would add a hidden-input timing dependency for nothing). Factor the existing body of `handleSubmit` into `confirm(c: string)`; the button path calls `confirm(code)`, `onComplete={(c, { exact }) => { if (exact) void confirm(c); }}` calls it with the argument it was handed, which needs no committed state.
- `confirm` guards: `inFlight = useRef(false)` and `submitted = useRef<string | null>(null)`; return if `inFlight.current || submitted.current === c`. Set both, `setPending(true)`, `try { await completeEnrollment({ code: c }) … } finally { inFlight.current = false; setPending(false) }` (the `finally` is new: a rejected call would otherwise strand the guard). Keep the `/^\d{6}$/` check and its toast for the button path.
- On `{ ok: false }`: toast as today, then `submitted.current = null; setCode(""); setAttempt(a => a + 1)`. The `OneTimeCodeInput` gets `key={attempt}` and `autoFocus={attempt > 0}`: the first mount does not grab focus (Phase 2 R2.2: it sits below the QR on a phone), the remount after a failure does. Boxes stay `disabled={pending}` as today; the remount is what restores focus.
- A status region `<p role="status" className="sr-only">{pending ? "Verifying your code." : ""}</p>` next to the button.
- Success path unchanged (recovery codes panel with Continue; the F166 revalidation behaviour is pre-existing and deferred, see Carry-forward).

## E2E helper decision (one change at the helper, Gap 2)

`enterTotpCode` **already stops at typing** (it never pressed Verify), so it keeps its code and gets an accurate header comment ("typing the sixth digit submits the code"). Add one helper to `e2e/support/totp-page.ts`:

```ts
export async function waitForTotpVerified(
  page: Page,
  destination: RegExp | ((url: URL) => boolean) = (url) => !url.pathname.startsWith("/totp"),
  timeout = 15_000,
): Promise<void> { await page.waitForURL(destination, { timeout }); }
```

Every caller then **deletes its Verify click** (a click on a button that is now "Verifying…" or gone would wait 30 seconds and fail). `verifyButton` stays exported for the fallback tests. No other helper changes.

| # | Call site (line approx.) | Change |
|---|---|---|
| 1 | `e2e/totp-full-login.spec.ts:45-46` (wrong code) | Delete click; keep `waitForURL(/error=invalid/)` and the copy assertion |
| 2 | `e2e/totp-full-login.spec.ts:52-53` | Delete click; keep `waitForURL(/\/admin$/)` |
| 3 | `e2e/session-claim-integrity.spec.ts:57-58` | Delete click |
| 4-8 | `e2e/totp-callback-bypass.spec.ts:73, 127, 183, 225, 265` (click on the next line each) | Delete the five clicks |
| 9 | `e2e/branded-signin.spec.ts:338-339` | Delete click |
| 10 | `e2e/invitation-new-account.spec.ts:198-199` | Delete the `Confirm enrollment` click; the next assertion ("you enrolled on") is the wait |
| 11 | `e2e/hydration/totp-challenge.spec.ts:91-93` | Delete the `toBeEnabled` + click pair; use `waitForTotpVerified(page, /\/admin$/)`; header comment updated |
| 12 | `e2e/support/domains-ui-fixture.ts:187-189` (`verifiedContext`) | Delete click; replace the `waitForURL` with `waitForTotpVerified` |
| 13 | `e2e/support/giving-fixture.ts:625-627` (`verifiedContext`) | Same |
| 14 | `e2e/support/invitation-ui.ts:31-32` (`submitTotp`) | Delete click; the `Promise.race` that follows is the wait |
| 15 | `e2e/totp-code-entry.spec.ts:157-158` (wrong-code test) | Rewritten (see test plan) |

Also edited without a helper call: `e2e/totp-code-entry.spec.ts` tests at lines 39-53, 98-107 (paste) and 120-130 (fill), and `e2e/account-page.spec.ts:111` (comment only; three digits never submit). `totp-recovery-code.spec.ts` is untouched (recovery mode does not auto-submit; it uses Enter).

**Rule 16 note for the orchestrator.** `e2e/support/*` is on the shared-file list. This pipeline edits `totp-page.ts`, `domains-ui-fixture.ts`, `giving-fixture.ts` and `invitation-ui.ts`, each a one-line deletion plus the new helper. Merge before any pipeline that adds a new `enterTotpCode` caller, or that new caller needs the same deletion. `docs/decisions.md`, `docs/TODO.md` and `docs/STATE.md` are integration-only; the implementer does not touch them.

## Doc and comment drift

The sentence the brief attributes to DECISION-192(a) lives in **DECISION-193(a)**; DECISION-192 itself (rule H3, every consumer gated) is unchanged and still true.

| Where | Stale text | Edit |
|---|---|---|
| `docs/decisions.md:336` (DECISION-193(a)) | "there is no auto-submit, and completing the code moves focus to Verify" | Append a pointer: "(amended by DECISION-257)" (orchestrator, at integration) |
| `docs/ui-standards.md:407` | "nothing auto-submits (a typo would spend a rate-limited attempt), `onComplete` lets the caller move focus to its own Verify button" | Rewrite per DECISION-257 below |
| `docs/product/functionality-map.md:54` | "no auto-submit" | "the sixth digit submits the code (not a recovery code); the Verify button remains" (Rule 14, at ship) |
| `src/components/shared/one-time-code-input.tsx:48` | "Never on mount; never submits." | New signature and `exact` doc; "never submits" stays true of the component and is said so |
| `src/app/(auth)/totp/totp-challenge-form.tsx:72-75` and file header | "no auto-submit: a typo would spend one of ten attempts" | Replaced by the effect's comment |
| `e2e/totp-code-entry.spec.ts` header (lines 1-15, "Nothing here submits a code except the one failed-attempt test") and test at line 39/51 | stale | Rewritten |
| `e2e/support/totp-page.ts:11-12` | "Neither helper presses Verify: ... the hydration spec needs the click as its own step" | Rewritten: typing submits; `waitForTotpVerified` |
| `e2e/account-page.spec.ts:111` | "without submitting" | Reworded: "three digits never submit" |
| `docs/work-log/2026-10-21-review-polish.md` | "no auto-submit" | History; not edited |

### DECISION-257 text (draft for the orchestrator to land in `docs/decisions.md` at integration)

> **DECISION-257 — The two-factor code is submitted when its last digit lands; `OneTimeCodeInput` says whether the completion was exactly code-length; the session grant stays inside `verifyTotpAction`. Amends DECISION-193(a) and the "nothing auto-submits" sentence of `docs/ui-standards.md` (DECISION-192/193).**
>
> **Status:** Resolved (operator request 2026-10-25) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-totp-autosubmit` (no migration; v0.42.6)
>
> - **Rule.** `onComplete(code, { exact })` fires on a user edit that leaves the code complete and changed. A consumer may submit only when `exact` is true; an over-long paste or autofill fills the boxes and waits for the button. Recovery codes never auto-submit (variable length, no last-character event).
> - **`/totp`.** The trigger arms a ref; an effect keyed on the code runs after the commit that carries the six digits and calls `form.requestSubmit()` on the existing `<form action={verifyTotpAction}>`. The client never calls the action's internals, `unstable_update` or `@/auth`: the 0.42.3 grant (`withTwoFactorGrant`) opens only inside the action. One submission per complete code; none while pending; a hole re-arms.
> - **Reset.** After an attempt settles (`useFormStatus` pending true then false) the digit boxes are cleared and refocused by remounting the input. It is keyed on completion, not on the URL, because two failures in a row redirect to the same URL (F282).
> - **`/account/2fa`.** The same trigger calls the existing handler directly with the code it was handed; the input is remounted (and focused) after a failure.
> - **Accepted residual.** A mistyped last digit is submitted at once: one of ten attempts a minute on `/totp` and one `totp.verify_failed` audit row, with no chance to correct. Accepted because the code expires in about 30 seconds; the Verify button stays as the fallback. `completeEnrollment` has no rate limit (pre-existing, unchanged, TODO).
> - **Rejected.** Keying the form on `error` (identical URL on repeat failure); a `useActionState` wrapper (a second action entry point near the grant); submitting from the change handler (posts the previous hidden value).

`docs/ui-standards.md:407` replacement sentence: "A complete code is submitted by the consumer when `onComplete(code, { exact: true })` fires (the 6-digit TOTP code; an over-long paste does not submit); recovery-code fields do not auto-submit. The Verify button stays as the fallback. Never submit from the change handler: the hidden value has not committed yet (DECISION-257)."

## Implementation Order

1. Failing-first tests (plan below), run red against the unmodified source.
2. `OneTimeCodeInput` `exact` flag; update its tests.
3. `/totp` form (effect, probe, toggle, key) and its tests.
4. Enrolment form and its tests.
5. e2e helper and the 15 call sites; rewrite the code-entry specs; new e2e.
6. Doc/comment drift edits (everything in the table except `docs/decisions.md`).
7. No schema, catalog, route or audit step. Release notes (`/release-notes`, proposed 0.42.6, Polish) with the lines below, functionality-map line (Rule 14) and the optional what's-new row at Phase 6; TODO lines and DECISION-257 at integration (Rules 10 and 16).

## Carry-forward

| Phase 1 gap / ruling | Addressed here, or deferred (who accepted) |
|---|---|
| Decision 1 (scope: digit mode and enrolment, not recovery) | Component Plan: recovery mode never arms; tests F-4, E-9 |
| Decision 2 (trigger = `onComplete`, once per transition) | `/totp` form: Trigger; component tests (existing five stay, one added for the repeated same-value event) |
| Decision 3 (over-long paste fills, does not submit) | `exact` flag; tests C-2, F-5, N-3, e2e 7-digit paste |
| Decision 4 (button stays; no focus-to-Verify) | Verify button bullet; focus effect deleted; test F-12 replaces the old focus test |
| Decision 5 (one per code, pending guard, re-arm on hole or different code) | Submit effect steps 1-4; tests F-7, F-8, F-9 |
| Decision 6 (clear and refocus after a wrong code; prove with e2e) | Reset by completion, `key={attempt}`; F282; e2e "two wrong codes in a row" |
| Decision 7 (enrolment clears and refocuses; reset key or focus prop: choose) | **Chosen: remount via `key={attempt}` with `autoFocus={attempt > 0}`** (no new component prop); test N-4 |
| Decision 8 (nothing submits before hydration) | Handlers exist only after hydration; fieldset disabled; test F-6 and hydration e2e (both lanes) |
| Decision 9 (same 10/min limit) | No change to the action; residual in DECISION-257 |
| Decision 10 (status region, focus stays, toggle disabled, `role="alert"` kept) | Status region and `ModeToggle` bullets; tests F-10, F-11, F-13 |
| Gap 1 (hidden-input timing) | Submit effect after commit; test F-1 (`fd.getAll("token") === ["123456"]`) |
| Gap 2 (about 20 e2e call sites) | Helper decision and 15-row table |
| Gap 3 (tests asserting the opposite) | Test plan: rewritten list |
| Gap 4 (doc and comment drift) | Drift table and DECISION-257 draft |
| Gap 5 (audit noise) | Release-note line; no code |
| Gap 6 (enrolment has no rate limit) | **Deferred**: orchestrator ruling 2026-10-25 (defaults accepted; Out of scope confirmed). TODO line at integration |
| Gap 7 (release notes, what's-new) | Implementation Order step 7; copy below |
| Adversarial: double and concurrent submit | Guards; F-7, F-8, e2e single-POST count |
| Adversarial: mode switch mid-pending | `ModeToggle` disabled; F-11 |
| Adversarial: callback validation / 0.42.3 grant | Action untouched; source-scan test S-1; the four guard specs stay green |
| Orchestrator rulings (Q1-Q4 defaults; port 3560) | Q1 N-4; Q2 `exact`; Q3 optional what's-new in step 7; Q4 one helper change |
| Out of scope (recovery auto-submit; removing Verify; enrolment rate limit; changing 10/min or server verify) | Honoured; user to confirm list at the end of this section |
| 360px | e2e pending-state overflow test; status region is `sr-only` |

## Edge Cases & Risks

Each claim cites its pinning test (IDs are in the test plan) or says *unverified*.

- **Posts the previous hidden value if submitted from the handler.** Avoided by the post-commit effect. F-1.
- **A mistyped sixth digit is submitted at once** and costs one attempt and one `verify_failed` row (accepted residual). e2e "wrong typed code" asserts exactly one `verify_failed` row.
- **Two wrong codes in a row** (identical URL) must clear and refocus both times and auto-submit again. e2e E-6. *Whether Next remounts on a same-URL redirect is unverified; the design does not depend on it.*
- **Double submit** (autofill then a Verify click, or edits during pending): F-7 (mocked pending), e2e E-3 (one POST).
- **Over-long paste** fills six boxes, does not submit, Verify then works: C-2, F-5, E-8.
- **Repeated input events from iOS autofill** give one `onComplete`: C-4.
- **Restore on mount** (bfcache or autofill-restored complete value) does not submit: existing "does not fire on mount" test, and F-6. *Back-navigation from `/admin` to a bfcache'd `/totp` is unverified.*
- **Pre-hydration:** the fieldset is disabled and handlers are not attached; hydration e2e (both lanes) asserts zero `verify_failed` and the disabled boxes. F-6.
- **Recovery mode:** typing never submits: F-4, E-9. Mode switch during pending is blocked: F-11.
- **Enrolment action throws:** `finally` clears the guard: N-5.
- **Enrolment: recovery codes panel.** F166 (the one-time panel replaced by the revalidated management view) is pre-existing and not worsened; *deferred, accepted in the Phase 1 brief (unchanged); not re-tested here*.
- **Real-code collisions.** `workers: 1`, rate limit off in e2e. Submit-proof tests use the wrong code `000000`; only two specs submit a real code through typing (E-1 and the hydration spec), and `verifyToken` has no replay rule, so no step-collision risk.
- **`requestSubmit` in jsdom** exists (jsdom 29.1.1). If a unit run ever shows it unimplemented, the implementer stops and reports rather than polyfilling in production code.
- **Existing e2e blast radius** (assert behaviour this change alters): the 15 call sites above; `totp-code-entry.spec.ts` tests "typing advances … then focus moves to Verify without submitting" (line 39), "pasted from the real clipboard" (the `verifyButton` enabled assertion, line 98), "whole-code input event" (line 128), and "a wrong code shows the error" (line 153); `hydration/totp-challenge.spec.ts` (Verify click); `invitation-new-account.spec.ts` (Confirm click). Unmodified in intent and must pass: `totp-callback-bypass`, `session-claim-integrity`, `totp-full-login`, `branded-signin`, `totp-recovery-code`.
- **Feature flags the new or changed e2e specs depend on:** none. `branded-signin.spec.ts` sets `ui.branded_signin` through `e2e/support/flags.ts` as today; no key is added to `scripts/ci/e2e-baseline-flags.sql`.

### F282 (finding, design time)

`/totp` reset after a failed attempt cannot rely on a URL change: two consecutive failures redirect to the same URL. The reset is keyed on the attempt settling. Status: addressed in this design; pinned by e2e E-6. (Number taken from the pre-assigned block.)

## Copy

New strings: one status string and the release-note lines. Everything else on both surfaces is unchanged.

| Group | Text | Where |
|---|---|---|
| Status (new) | "Verifying your code." | Screen-reader-only `role="status"` on `/totp` and `/account/2fa`, present only while a submission is pending |
| Button (unchanged) | "Verifying…", "Verify", "Confirm enrollment" | Both forms |
| Errors (unchanged) | "That code didn't match. Try again, or use a recovery code." / "Too many attempts. Please wait a moment before trying again." / toast "That code did not match. Try again." | Unchanged |
| Release note (draft) | **Polish: the two-factor code is checked as soon as you type the last digit.** *Value:* Signing in with your authenticator no longer needs a separate tap on Verify. *What's New:* "When you type, paste or autofill the sixth digit, the code is checked straight away, on the sign-in page and on the page where you set up two-factor." / "On the sign-in page a mistyped last digit is checked too and counts as one of your attempts, the same as when you pressed Verify." / "The Verify button is still there. If you paste something longer than six digits, the boxes fill and wait for you to press it." / "Recovery codes still need Verify." | `docs/release-notes/v0.42.md` entry, written by `/release-notes` |
| What's-new (optional, draft) | "Your two-factor code is now checked as soon as you type the sixth digit." | `/admin/whats-new` |

Checks, one line per string group:

1. *Residuals.* "Verifying your code." promises no outcome. The release note states the typo cost (Flow 2, "must not be called free") and does not say the setup page limits attempts (Gap 6: it does not), so it denies no accepted residual and no Phase 1 ruling. There is no Phase 2 ruling (skipped).
2. *Source of truth.* "Verifying your code." is true exactly when `useFormStatus().pending` (`/totp`) or the `pending` state (enrolment) is true, i.e. a submission has been sent and not returned; it claims nothing about the code, and also reads true for a recovery code in flight. "Counts as one of your attempts" on sign-in is `checkRateLimit('totp:<userId>', 10 per 60s)` plus `TOTP_VERIFY_FAILED` in `verifyTotpAction`; the same action runs for auto and manual submits. "Checked straight away" is the trigger, pinned by F-1. "On the setup page" makes no attempt claim because `completeEnrollment` has no limiter.
3. *Audience.* The status string is heard by the member mid-sign-in or enrolling (any role; there is no instruction in it). The release-note instruction "press Verify" for an over-long paste or a recovery code goes to the same person and is on their screen (the button is rendered and enabled for a complete code, non-blank recovery field). Nobody is told to ask an administrator or open another page.
4. *Neighbours.* Grep of `src/` and `docs/` (excluding work-logs and release notes, which are history) for press/click/tap Verify, auto-submit, "without submitting", Confirm enrollment, 6-digit code: UI strings made stale: none (the error copy "Try again, or use a recovery code" is still true; "Confirm enrollment" stays). Doc/comment strings made stale are the nine rows of the drift table (file:line there).

Strings not in this section are not to be written; the implementer stops for a ruling.

## Failing-first test plan

Order: write the tests, run them red against the unmodified source (the e2e on a dev server at `E2E_BASE_URL=http://localhost:3560`), then implement. IDs are cited above.

**`one-time-code-input.test.tsx`** (existing `toHaveBeenCalledWith("123456")` assertions change to `("123456", { exact: true })`)
- C-1: typed sixth digit gives `exact: true`.
- C-2: paste of `1234567` gives one call, `exact: false`, boxes hold `123456`.
- C-3: paste `123 456`, and `fill` of `482915` on box 1, give `exact: true`.
- C-4: two identical whole-code input events give one call.
- Existing five stay (once per transition, not on mount, not on unchanged value, hole then fill).

**`totp-challenge-form.test.tsx`** (the "moves focus to Verify, without submitting" test is deleted and replaced by F-12; "posts exactly one token field" now types and waits for the auto call instead of `fireEvent.submit`)
- F-1: typing the sixth digit calls `verifyTotpAction` once with `fd.getAll("token") === ["123456"]` and the `callbackUrl`.
- F-2: five digits never submit.
- F-3: a pasted `123 456` and a `fill` of the whole code on box 1 each submit once.
- F-4: recovery mode: typing and a complete string never auto-submit; button/submit still posts the one token.
- F-5: `1234567` paste fills, does not submit, Verify enabled; clicking it posts `123456`.
- F-6: renders with no input and `hydrated=false`: nothing is called; `hydrated=true` mount with no edit: nothing is called.
- F-7: `formStatus.pending = true` before typing: a complete code does not submit; a Verify click while pending is a no-op (disabled).
- F-8: the same complete code is not resubmitted by a re-render; hole then the same digit re-arms and submits (second call).
- F-9: settle: after one submit, `pending` true then false (rerender) clears all boxes, focuses box 1 (`document.activeElement`), and typing a new code submits again (second call).
- F-10: the status region exists at rest with empty text; reads "Verifying your code." while pending.
- F-11: the recovery toggle is disabled while pending.
- F-12: after the sixth digit focus is still on box 6 (not Verify), and Verify still posts via a click as the fallback.
- F-13: existing pending test (Verify disabled, "Verifying…") stays.

**`totp-enroll-form.test.tsx`**
- N-1: sixth digit calls `completeEnrollment({ code: "123456" })` once with no button press; boxes disabled while pending (deferred promise).
- N-2: five digits and the button path with a short code behave as today (toast, no call).
- N-3: `1234567` paste: no call; clicking Confirm calls with `123456`.
- N-4: `{ ok: false }`: toast, boxes cleared, box 1 focused, a new code submits once.
- N-5: a rejected `completeEnrollment` clears the guard; a new code submits.
- N-6: status region text while pending.
- Existing "submits the joined six digits" and "pasted code with a space" tests: the click becomes unnecessary; they assert the auto call and still end on the recovery panel / toast.

**Source scan S-1** (in `totp-challenge-form.test.tsx`): the form source imports neither `@/auth`, `@/lib/auth/two-factor-grant` nor `unstable_update`, and contains `action={verifyTotpAction}`. Guards the 0.42.3 rule that the grant opens only in the action.

**e2e (running server, `mfa-enrolled` user; the Phase 4 gate for `src/app/(auth)/`)**, in `totp-code-entry.spec.ts` unless noted; pending states held with `page.route` delaying the POST:
- E-1: typing a real code with no button press lands on `/admin` (`callbackUrl=%2Fadmin`); the audit (`platformSql`, DB clock) shows exactly one `totp.verify_succeeded` and zero `verify_failed`.
- E-2: typing five digits stays on `/totp` with Verify disabled and no POST (replaces the old focus test; it still checks the advance from box to box).
- E-3: with the POST delayed, a typed `000000` shows "Verifying…" and the single request count is 1 even after clicking the (disabled) button and typing more; status region text; toggle disabled; **no horizontal overflow at 360px in the pending state**.
- E-4: a pasted real-clipboard `000 000` and a `fill("000000")` each submit once and end on `?error=invalid`.
- E-5: a wrong typed code ends on `?error=invalid`, boxes cleared, box 1 focused, `aria-invalid` true (the old test, without the click), one `verify_failed` row.
- E-6 (F282): a second wrong code immediately afterwards auto-submits again and ends cleared and focused; then a correct code auto-submits and lands on `/admin`.
- E-7 (re-arm): same as E-6's final step (a different code after a failure submits).
- E-8: `1234567` paste fills six boxes, stays on `/totp` with no POST; pressing Verify submits.
- E-9: recovery mode: typing does not submit; `totp-recovery-code.spec.ts` unchanged and green.
- Hydration (`e2e/hydration/totp-challenge.spec.ts`, **both lanes**): still disabled until release, box 1 focused after, no `verify_failed` pre-hydration; after release the typed real code lands on `/admin` with one success row.
- Enrolment: `invitation-new-account.spec.ts` enrols by typing alone and sees "you enrolled on"; the `user_totp` row exists.
- Regression guards (unmodified in intent): `totp-full-login`, `totp-callback-bypass`, `session-claim-integrity`, `branded-signin`.

## Gates for Phase 4 to Phase 5 (port 3560, MFA-enrolled user)

- `npm run check` (all eight tripwires; `check:hydration-gate` H3 must pass), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test` for the three unit files and the full suite.
- Dev lane: dev server on **3560** from the `presby-otp` worktree on Neon branch `pipeline-totp-autosubmit`, then `E2E_BASE_URL=http://localhost:3560 npx playwright test` for the specs named above, started by the implementer and stopped by PID.
- Prod-build lane for the hydration spec: `PW_PROD_BUILD=1 PW_PROD_PORT=3561 npx playwright test --project=prod-build e2e/hydration/totp-challenge.spec.ts`. 3561 is my pick next to the pre-assigned 3560 and was free when checked; the orchestrator should confirm it. A hydration spec run against a dev server alone does not satisfy the lane.
- Browser check on a phone viewport (Key Invariants, Verify in a Browser): type, paste and autofill on `/totp` and `/account/2fa` at 360px, including the pending state. Screen-reader announcement of the status region is *unverified* beyond the DOM assertion (no screen reader in the pipeline).
- Phase 5 is BLOCKED, not PASS, if the e2e against the real server with the MFA-enrolled user is not run.

## Implementer

**full-stack-developer.** The UI, the form effect and the e2e helpers move together, there is no schema or server work, and splitting across ux-developer and api-developer would only add a handoff. Out of scope for the implementer: `docs/decisions.md`, `docs/TODO.md`, `docs/STATE.md`, `src/app/(auth)/totp/actions.ts`, `src/app/(account)/account/2fa/actions.ts`, `src/auth.ts`.

**Out of scope (user to confirm):** recovery-code auto-submit; removing the Verify button; rate-limiting `completeEnrollment` (TODO); changing the 10-per-minute limit or any server-side verification; changing `page.tsx`; a new flag.

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

## Operator request (2026-10-25, verbatim)

> for the 2fa code you can go ahead and verify after typing the last digit versus having to press the button

## Orchestrator rulings (2026-10-25)

Open questions 1–4 proceed on the analyst's defaults (enrolment clears and refocuses; over-long paste fills but does not submit; optional one-line what's-new; one helper-level e2e change). Port 3560.
