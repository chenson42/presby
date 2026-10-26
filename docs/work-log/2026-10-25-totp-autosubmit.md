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
| 4 — Implementation | full-stack-developer | Complete; all Phase 4 gates green (dev lane :3560, prod-build lane :3561) | Ready for QA | 2026-10-25 |
| 5 — Verification | qa | Complete; failing-first reproduced; auth e2e 58/58, full 523/523, prod lane 13/13, 0 skipped; probes 9/9; 360px checked | PASS | 2026-10-25 |
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

**Implementer:** full-stack-developer · **Date:** 2026-10-25 · **Branch:** `pipeline/totp-autosubmit` (worktree `presby-otp`, Neon branch `pipeline-totp-autosubmit`) · **Commits:** `27d596a` work-log, `6c0c9cc` feat(auth), `3fdc4fa` test(e2e), `eb12dac` docs.

## Files Created

- None (the status probe and toggle are file-local to `totp-challenge-form.tsx`).

## Files Modified

- `src/components/shared/one-time-code-input.tsx`: `onComplete(code, { exact })`; `commit(next, exact = true)`, `spread()` passes `digits.length <= length`; prop and header docs.
- `src/app/(auth)/totp/totp-challenge-form.tsx`: submit effect after the commit (`armed` / `submitted` / `pendingRef` refs, `formRef.requestSubmit()`), `FormStatusProbe` (pending mirror, settle callback, `role="status"` region), `ModeToggle` (disabled while pending), `key={attempt}` remount on settle, focus-to-Verify effect and `verifyRef` removed. `action={verifyTotpAction}` unchanged.
- `src/app/(account)/account/2fa/totp-enroll-form.tsx`: `confirm(c)` with `inFlight` / `submitted` guards and a `finally`, `onComplete` calls it when `exact`, `key={attempt}` with `autoFocus={attempt > 0}`, status region.
- Unit tests: `one-time-code-input.test.tsx` (C-1 to C-4, existing `onComplete` assertions now `{ exact: true }`), `totp-challenge-form.test.tsx` (F-1 to F-12, S-1), `totp-enroll-form.test.tsx` (N-1 to N-6).
- e2e: `support/totp-page.ts` (header, `enterTotpCode` doc, new `waitForTotpVerified`); the 15 call sites in the design table (`totp-full-login` x2, `session-claim-integrity`, `totp-callback-bypass` x5, `branded-signin`, `invitation-new-account` (Confirm click), `hydration/totp-challenge`, `support/domains-ui-fixture`, `support/giving-fixture`, `support/invitation-ui`, `totp-code-entry` wrong-code test); `totp-code-entry.spec.ts` rewritten (header; E-1 to E-9); `account-page.spec.ts` comment.
- Docs and comments (the nine drift locations minus `docs/decisions.md`): `docs/ui-standards.md:407`, `docs/product/functionality-map.md:54`, `one-time-code-input.tsx` prop and header docs, `totp-challenge-form.tsx` header, `totp-code-entry.spec.ts` header and tests, `totp-page.ts`, `account-page.spec.ts`. One location beyond the table: `docs/testing.md:65` ("Neither helper presses Verify"), updated. **Left to the orchestrator (Rule 16):** `docs/decisions.md` (DECISION-257, the DECISION-193(a) pointer at `decisions.md:336`), `docs/TODO.md` (Gap 6 line), `docs/STATE.md`.

## Schema Changes

- None. No route, action, flag, permission, dependency or audit key. `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, both `actions.ts` and `page.tsx` are untouched.

## Audit Events

- None added. `totp.verify_succeeded` / `totp.verify_failed` fire from the unchanged action; E-1, E-5 and E-6 count them against the database clock (one success; one failed row per wrong code; two failed plus one success for the two-wrong-then-right run).

## Implementer Notes

**Deviations from the design (one).** `confirm()` on `/account/2fa` has a `catch` (not only the designed `finally`) that clears the `submitted` guard and swallows the rejection. Reason: the auto path is fire-and-forget (`void confirm(c)`), and an unhandled rejection from a rejected server action failed the unit run (N-5). The design adds no copy for a thrown action, so none was added: the boxes re-enable, the guard is released, and the same code can be sent with the Confirm button. The user sees no message in that case (as before: the old code let the rejection go unhandled). Flag for Phase 5/6 as a pre-existing gap, not a regression.

**Failing-first record (red runs against the unmodified source).**

| Suite | Red run | Notes |
|---|---|---|
| `one-time-code-input.test.tsx` | 6 failed / 55 | C-1, C-2, C-2b, C-3, the two existing `{ exact: true }` assertions; then 55/55 green |
| `totp-challenge-form.test.tsx` | 9 failed / 33 | F-1, F-3 x2, F-8, F-9, F-9b, F-10, F-11, F-12. F-2, F-4, F-4b, F-5, F-6, F-7 and S-1 pin behaviour that already held (negative assertions), so they pass red-run and stay as guards |
| `totp-enroll-form.test.tsx` | 6 failed / 12 | the pasted-code auto submit, N-1, N-4, N-4b, N-5, N-6; N-2, N-3 are pins |
| `totp-code-entry.spec.ts` (e2e, old `src/` checked out over the new tests, dev server on 3560) | 6 failed / 17 | E-1, E-3, E-4 x2, E-5, E-6/E-7; E-2, E-8, E-9 and the unchanged tests pass on the old code (negative pins). The old source was then restored with `git checkout HEAD -- src` |
| `invitation-new-account.spec.ts` | not run red | the change is a deleted click: on the old source the spec would hang on "you enrolled on". Not separately red-run |

**Gates (all on the final tree `eb12dac`).**

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npm run check` | all eight tripwires pass (incl. `check:hydration-gate` H3, `check:audit`, `check:proxy-imports`) |
| `npm test` (plain) | 554 files passed / 77 skipped; 8654 tests passed / 2442 skipped (the skips are the DB-backed suites) |
| `npm run build` | pass |
| Auth e2e on :3560, MFA-enrolled user (`totp-code-entry` E-1 to E-9, `totp-full-login`, `totp-callback-bypass` x7, `totp-recovery-code`, `session-claim-integrity`, `branded-signin`, `post-login-routing`, `invitation-new-account`, `invitation-existing-account`, `hydration/totp-challenge`, `account-page`) | 58 / 58 passed (1.4 min) |
| Full suite on :3560 (`chromium` and `custom-hosts` projects, flags reset first with `e2e-reset-flags.sql -v pipeline_branch=1` against this worktree's DB) | 523 / 523 passed (18.1 min), 0 skipped, 0 flaky |
| Prod-build lane: `PW_PROD_PORT=3561 npm run test:e2e:prod -- e2e/hydration/totp-challenge.spec.ts`, then the whole `e2e/hydration` directory (three other hydration specs use the changed `verifiedContext`) | 1 / 1, then 13 / 13 passed |
| Real-browser 360px look (Pixel 7 emulation, 360x740, POST held with a route): `/totp` rest, pending, failure | pending: "Verifying…" on the button, status region reads "Verifying your code.", 0 px horizontal overflow, focus stays on box 6; failure: boxes cleared, box 1 focused, `role="alert"` copy unchanged and wrapping to two lines, 0 px overflow. Screenshots are in the session scratchpad only |

**What QA should know.**

- 0.42.3 invariant: `totp-challenge-form.tsx` imports nothing from `@/auth`, `@/lib/auth/two-factor-grant` or `unstable_update` and never calls the action; S-1 scans the source for that and for `action={verifyTotpAction}`. The four guard specs (`totp-full-login`, `totp-callback-bypass`, `session-claim-integrity`, `branded-signin`) changed only by a deleted click and pass.
- F282 was exercised in a real browser: E-6 types the same wrong code twice, asserts the URL is identical both times, and that the boxes clear and refocus and a second POST is sent each time. Whether Next remounts the page on a same-URL redirect was not determined; the settle-based reset does not depend on it.
- The disabled recovery toggle (`variant="link"`) looks the same as the enabled one in the pending screenshot (no visible dimming), though it is `disabled` (E-3 asserts it). Cosmetic and outside the design; noted for Phase 6 rather than changed.
- A real-device check (iOS one-time-code autofill, Android keyboard suggestion, a screen reader reading the status region) was not possible here. Autofill is emulated by `fill()` and a clipboard paste; the status region is asserted in the DOM only.
- Environment incident, no code impact: running `npm run build` in the worktree while the dev server was up corrupted the dev server's `next/font/google` resolution (`.next` shared), and the first auth e2e run (53 failed) was discarded; the server was stopped by PID, `.next` removed and restarted, and the whole set re-run clean. The prod lane also builds into `.next`, so it was run only after the dev server was stopped. Separately, a stray `git stash` / `git stash pop` in this worktree applied another pipeline's stash (`stash@{0}: On pipeline/signin-invites: a1-e33-lane`; stashes are repository-wide). It was undone with `git reset --hard` to my own HEAD and removal of the three untracked files it restored; the stash entry itself is intact (`git stash list` still shows it) and nothing of this pipeline's was lost.

Strings added or changed: "Verifying your code." at `src/app/(auth)/totp/totp-challenge-form.tsx` (`FormStatusProbe`) and `src/app/(account)/account/2fa/totp-enroll-form.tsx` (status `<p>`), the only new user-facing string, from the design's Copy table. Existing strings unchanged.

**Handoff to Phase 5 (qa):** run the three unit files and the full suite, then the auth e2e set against a real server with the MFA-enrolled user (:3560 for this pipeline; the dev server is stopped now), reset flags first, and the prod lane on :3561 for `e2e/hydration/totp-challenge.spec.ts`. Browser look to repeat: `/totp?callbackUrl=%2Fadmin` at 360px, type `000000` (pending, then failure), a 7-digit paste (fills, waits for Verify), and `/account/2fa` enrolment by typing the sixth digit. Release notes (proposed 0.42.6, Polish), the what's-new row and the TODO/decision lines remain for Phase 6 and integration.

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

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-otp`, `pipeline/totp-autosubmit` at `404de0b`. Neon branch `pipeline-totp-autosubmit`; its endpoint differs from the main worktree's (development) endpoint.

**Scope run.** The diff touches `e2e/support/*` and a shared component (`src/components/shared/one-time-code-input.tsx`), so the full e2e suite was required, and it touches `src/app/(auth)/`, so the auth gate applies.

- **Static gates and unit:** typecheck, lint, `npm run check`, plain `npm test`, `npm run build`.
- **Failing-first:** red-runs of the unit and e2e tests against the pre-change source in a scratch copy.
- **Dev lane on :3560:** the named auth e2e set, then the full suite (default projects `chromium` and `custom-hosts`).
- **Prod-build lane on :3561:** the whole `e2e/hydration/` directory.
- **Browser:** adversarial probes and the 360px look.

**Not run:** the DB-backed vitest suites (no migration, `authz.ts`, `src/lib/db/` or fixture change; CI covers them) and `test-rls.sql`. **Flag state:** global flags were reset to the CI baseline before any e2e run, using `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1` against this worktree's `PLATFORM_DATABASE_URL` only (COMMIT; the file is identical to the worktree's copy). Env vars were checked for presence only and never printed. Disk had 564 GiB free.

## Type Check

`npm run typecheck`: **PASS**. `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check`: **PASS**, all eight tripwires including `check:hydration-gate` (H3), `check:audit` and `check:proxy-imports`. `npm run build`: **PASS**.

## Unit Tests

Total: 11096 | Passed: 8654 | Failed: 0 | Skipped: 2442 (77 files) | Duration: 25.2s
- **Skips:** all 77 skipped files are the DB-backed `src/lib/**` suites (they need `.env.local` and serial mode). None of them is a changed or blast-radius file.
- **The three changed files:** 100/100 passed, 0 skipped (`one-time-code-input.test.tsx` 55, `totp-challenge-form.test.tsx` 33, `totp-enroll-form.test.tsx` 12).

**Failing-first, verified independently.** I built a `git archive HEAD` copy, put the three source files back at their `origin/main` versions (byte-identical to merge-base `b903154`), and kept the new tests. No `git stash` was used.

| Suite | Red on old source | Matches Phase 4 record |
|---|---|---|
| `one-time-code-input.test.tsx` | 6 failed / 55 (C-1, C-2, C-2b, C-3, two `{ exact: true }` assertions) | yes |
| `totp-challenge-form.test.tsx` | 9 failed / 33 (F-1, F-3 x2, F-8, F-9, F-9b, F-10, F-11, F-12) | yes |
| `totp-enroll-form.test.tsx` | 6 failed / 12 (paste auto-submit, N-1, N-4, N-4b, N-5, N-6) | yes |
| `e2e/totp-code-entry.spec.ts` (old-source dev server on :3560) | 6 failed / 17 (E-1, E-3, E-4 x2, E-5, E-6/E-7) | yes |
| `e2e/invitation-new-account.spec.ts` | **red: 1 failed / 1** (times out waiting for "you enrolled on") | Phase 4 had not red-run this; now confirmed |

The tests that pass on the old source (F-2, F-4, F-4b, F-5, F-6, F-7, S-1, N-2, N-3, E-2, E-8, E-9) assert that something does not happen, so passing there is expected. They stay as guards.

## End-to-End Tests

All runs used a real dev server on **:3560** that I started from the worktree with the e2e server env, and stopped by PID afterwards. The `mfa-enrolled` seeded user was used throughout. `totp-full-login.spec.ts` drives email and password, then `/totp` (wrong code, then real code typed with no click), then `/admin`.

- **Named auth set** (`totp-code-entry`, `totp-full-login`, `totp-callback-bypass`, `totp-recovery-code`, `session-claim-integrity`, `branded-signin`, `post-login-routing`, `invitation-new-account`, `invitation-existing-account`, `hydration/totp-challenge`, `account-page`): Total 58 | Passed 58 | Failed 0 | Skipped 0 | 1.5m
- **Full suite** (`--project=chromium --project=custom-hosts`): Total 523 (420 chromium + 103 custom-hosts) | Passed 523 | Failed 0 | Skipped 0 | Flaky 0 | 18.0m
- **Prod-build lane** (`PW_PROD_PORT=3561 npm run test:e2e:prod -- e2e/hydration/`, its own `next build && next start`, run with no dev server up): Total 13 | Passed 13 | Failed 0 | 41.4s. This includes the /totp hydration spec: boxes disabled before release, no `verify_failed` row, and the typed real code lands on `/admin` with one success row.

The four 0.42.3 guard specs (`totp-full-login`, `totp-callback-bypass`, `session-claim-integrity`, `branded-signin`) and the three fixtures changed only by deleted Verify clicks and a `waitForTotpVerified` swap. No assertion was touched. The remaining Verify clicks are the legitimate fallbacks: `totp-code-entry.spec.ts:248` (over-long paste) and `totp-recovery-code.spec.ts:90,106`.

**Adversarial probes.** These were a throwaway spec in the scratch copy, run against the new-code server on :3560 with POSTs held by a route so the pending state persists. The copy is now deleted. All 9 passed:

| Probe | Result |
|---|---|
| Whole-code autofill, then a Verify `click()` at 0 / 16 / 50 / 200 ms | 1 POST each: no double submit |
| Type the sixth digit, then Enter twice at once | 1 POST |
| Two identical whole-code `input` events plus a `change` in one tick (iOS pattern) | 1 POST |
| Over-long paste `1234567` at 360px | fills `123456`, 0 POSTs; Verify enabled |
| Recovery mode | covered by E-9 (no POST on typing) and `totp-recovery-code` |
| Nothing submits before hydration | both lanes: fieldset disabled, 0 `verify_failed` rows |
| Re-arm after two identical failures (F282) | E-6 passed: same URL both times, boxes clear and refocus, 3 POSTs, then signs in. On `/account/2fa` the same wrong code twice gave 2 POSTs |
| `/account/2fa`: type `000000` then click Confirm at once | 1 POST; "Verifying…" and status region shown; after failure the toast appears, boxes are cleared and box 1 is focused |
| 3 typed digits, then a 4-digit paste into box 4 | **auto-submitted** `000000` (1 POST); the 4th pasted digit was dropped. See Observation O-1 |

**The 0.42.3 grant (S-1, plus reading the diff).**
- `withTwoFactorGrant` and its `unstable_update({})` appear only at `src/app/(auth)/totp/actions.ts:86,132`.
- `actions.ts` in both folders, `totp/page.tsx`, `src/lib/rate-limit.ts`, `src/auth.ts` and `src/proxy.ts` are byte-identical to `origin/main` (`git diff --quiet`).
- The client calls only `formRef.current?.requestSubmit()` on the unchanged `<form action={verifyTotpAction}>`.
- **Rate limit unchanged:** still `checkRateLimit('totp:<userId>', 10/60s)` in the untouched action, so auto-submits and button submits share it.

**360px real-browser look** (Chromium at 360x740; screenshots in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/shots/`):
- **/totp pending:** "Verifying…" disabled, status reads "Verifying your code.", focus on box 6, 0 px overflow.
- **/totp failure:** boxes cleared and red-bordered, box 1 focused, unchanged alert copy wrapping to two lines, Verify disabled, 0 px overflow.
- **/totp over-long paste:** waits for Verify.
- **`/account/2fa`:** pending and failure states with 0 px overflow; box 1 focused after failure.
- **Dev-only artifact:** the Next dev indicator pill overlaps the enrol button in the dev screenshots. It is not app UI.

## Regression Tests Added

- `F-1: the sixth digit posts exactly one token field and the callbackUrl, once…` — `src/app/(auth)/totp/totp-challenge-form.test.tsx:76` — guards against submitting from the change handler, which would post the stale hidden value (Gap 1).
- `F-5` (:132), `C-2` (`src/components/shared/one-time-code-input.test.tsx:411`), `N-3` (`totp-enroll-form.test.tsx:111`), `E-8` (`e2e/totp-code-entry.spec.ts:230`) — guard against an over-long paste spending an attempt (Decision 3).
- `F-7` (:158), `E-3` (`e2e/totp-code-entry.spec.ts:333`) — guard against double submission while pending, and pin the pending state at 360px.
- `F-9` / `F-9b` (:186, :206), `E-6 / E-7` (`e2e/totp-code-entry.spec.ts:302`) — **F282**: reset and re-arm after a failure even when the redirect URL is identical.
- `F-11` (:229) — guards against the recovery toggle flipping the `token` field mid-flight (R6).
- `S-1` (:246) — guards the 0.42.3 rule that the grant opens only inside `verifyTotpAction`.
- `N-1`, `N-4`, `N-4b`, `N-5` (`src/app/(account)/account/2fa/totp-enroll-form.test.tsx:84,123,136,145`) — guard enrolment auto-submit, clear and refocus after a failure, and guard release after a thrown call.
- `E-1` (:269), `E-4` (:178, :208), `E-5` (:283), `E-9` (:365) — browser proof of the real action, the audit rows, paste and autofill, and recovery mode.
- No `— regression for` suffix applies: this is a Feature, not a bug fix. Failing-first was confirmed above.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% statements / 100% branches
- `src/lib/two-factor.ts`: 91.3% statements (target 90%+), 100% branches
- `src/lib/flags.ts`: 100% / 100%
- Changed modules: `one-time-code-input.tsx` 100% stmts / 95.4% branch; `totp-challenge-form.tsx` 100% / 100%; `totp-enroll-form.tsx` 97.9% / 92.3%.

## Feature-Gate Audit

**No protected routes touched.** No route handler, server action, permission or flag was added or changed. `verifyTotpAction` and `completeEnrollment` are byte-identical to `origin/main`. `/totp` and `/account/2fa` stay auth-only and are not `FEATURES.*`-gated, as before.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `verifyTotpAction` (unchanged) | yes (`actions.ts:29`) | n/a (auth-only by design) | n/a |
| `completeEnrollment` (unchanged) | unchanged | n/a | n/a |

## Copy Truthfulness

- [x] **In the Copy table.** The one added string, "Verifying your code.", is in the design's Copy table. It appears at `src/app/(auth)/totp/totp-challenge-form.tsx:78` and `src/app/(account)/account/2fa/totp-enroll-form.tsx:175`. "Verifying…", "Verify", "Confirm enrollment" and both toggle labels were moved, not changed.
- [x] **Source of the claim.** On /totp the claim reads `useFormStatus().pending`; on enrolment it reads the `pending` state. Neither reads the outcome or the code type, so it is also true for a recovery code in flight, and it promises nothing.
- [x] **Instructions.** The string contains none. The viewer is any signed-in user mid-challenge or enrolling.
- [x] **Older strings, with one exception.**
  - Updated in the diff: `docs/ui-standards.md:407`, `docs/product/functionality-map.md:54`, `docs/testing.md:65`, the component, form and e2e header comments.
  - Still true: the `/totp` error copy ("Try again, or use a recovery code").
  - **Still false:** `docs/decisions.md:336` (DECISION-193(a): "there is no auto-submit, and completing the code moves focus to Verify"). That file is integration-only under Rule 16. The orchestrator must add the "(amended by DECISION-257)" pointer and DECISION-257 itself at integration, before merge.

**Copy truthfulness: PASS.**

## Observations (non-blocking; for Phase 6 / tech-lead)

- **O-1: a short paste that overflows the remaining boxes still auto-submits, dropping a digit.**
  - What happened: 3 typed digits plus a 4-digit paste into box 4 submitted, and the overflow digit was discarded (probe above).
  - Why it passes: this matches the design's literal definition (`exact` = "delivered at most `length` digits"; `one-time-code-input.tsx:139` `digits.length <= length`).
  - Why it matters: it misses the property Decision 3 was after, "a truncated input waits for the button". C-2, F-5 and E-8 encode the rule as written rather than that property.
  - Cost: at most one attempt, the same as the accepted typo residual.
  - Suggested follow-up: set `exact` only when no pasted digit is dropped (a full-length run from box 1, or `start + digits.length <= length`), and add a test for this case.
- **O-2:** `docs/decisions.md:336` drift (above), required at integration.
- **O-3:** typo in `docs/ui-standards.md:407`: "…move; A complete code…" (capital after a semicolon).
- **O-4: a thrown `completeEnrollment` now fails silently** (implementer's flagged deviation, `totp-enroll-form.tsx` `catch`). The boxes re-enable with no message. This is strictly better than before, when the button stayed stuck on "Verifying…" with an unhandled rejection, but the user still gets no feedback. Pre-existing gap.
- **O-5: not verified:**
  - real iOS or Android one-time-code autofill (emulated by `fill()`, a clipboard paste and duplicate input events);
  - a screen reader announcing the status region (asserted in the DOM only);
  - bfcache back-navigation to `/totp`.
- **O-6:** the disabled recovery toggle in the pending state shows no visible dimming (also noted by Phase 4). Cosmetic.
- **O-7, process note: the stash entry is gone.** Phase 4 recorded that another pipeline's stash (`stash@{0}: On pipeline/signin-invites: a1-e33-lane`) was intact. `git stash list` now returns 0 entries. I ran no stash command. The orchestrator should check with the signin-invites pipeline that nothing was lost.

**Leftovers:** worktree `git status` is clean at `404de0b`, as is the main checkout. Ports 3560 and 3561 are free. The scratch copy, including its copy of `.env.local`, is deleted.

## Verdict

**PASS**

The auth-touching gate is met. The e2e suite ran against a real dev server on :3560 with the MFA-enrolled seeded user, covering password, then TOTP (typed, auto-submitted), then the post-login landing. All 58 auth specs, all 523 full-suite specs and all 13 prod-lane hydration specs passed with 0 skipped. Failing-first was reproduced independently for all three unit files and both changed e2e flows.

---

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete; failing-first reproduced (unit 6/55, 9/33, 6/12; e2e 6/17 + invitation-new-account red); auth e2e 58/58, full 523/523, prod lane 13/13, 0 skipped; adversarial probes 9/9; 360px pending and failure checked on /totp and /account/2fa; flags reset to the CI baseline | PASS | 2026-10-25 |

**Handoff:** to **analyst (Phase 6)**. Carry O-1 (a truncated partial paste auto-submits; a design-level choice worth a ruling or TODO), O-4 and O-5 into the shipped-vs-intent review. Before merge, the orchestrator must land DECISION-257 plus the DECISION-193(a) pointer at `docs/decisions.md:336`, and the Gap 6 TODO line (O-2). O-7 is for the orchestrator.

## Phase 4 — loop-back (O-1)

**Trigger:** Phase 5 observation O-1 (a short paste that overflows the remaining boxes auto-submitted and silently dropped a digit), plus O-3 (typo). Implementer: full-stack-developer.

**Root cause.** `spread()` in `src/components/shared/one-time-code-input.tsx` computed `exact = digits.length <= length`, which ignored the starting box. Three typed digits plus a four-digit paste into box 4 delivers 4 digits (<= 6, so "exact"), but only 3 fit, so the fourth was dropped and the code submitted. That is the property Decision 3 exists to prevent ("a truncated input waits for the button").

**Fix.** `exact` is true only when no delivered digit is dropped:

- a run of at least `length` digits restarts at box 1 (existing behaviour) and drops only what exceeds the code, so it is exact only when `digits.length === length`;
- a shorter run is exact only when `start + digits.length <= length`.

**One deliberate difference from the loop-back brief.** The brief's formula was `start + digits.length <= length`. Applied literally it would also mark a full 6-digit code pasted into box 4 as not exact, although that paste restarts at box 1, replaces the whole code and drops nothing (the existing "whole-code replace" behaviour, C-3). The implemented rule keeps that case exact; every case the brief names (overflow into box 4, full-length run from box 1, over-length run) behaves as specified. Pinned by C-4b.

**Tests (failing first).** Written and run against the unmodified source before the fix:

| Test | Before fix | After fix |
|---|---|---|
| `one-time-code-input.test.tsx` C-4: 3 typed + 4-digit paste into box 4 fills six, reports `{ exact: false }` once | FAIL (`onComplete` called with `exact: true`) | pass |
| `one-time-code-input.test.tsx` C-4b: exact fit into box 4, and a 6-digit paste into box 4, both report `exact: true` | pass (negative pin) | pass |
| `totp-challenge-form.test.tsx` F-5b: same paste, `verifyTotpAction` not called, Verify enabled, then Verify posts `123456` once | FAIL (action called on the paste) | pass |
| `totp-enroll-form.test.tsx` N-3b: same paste, `completeEnrollment` not called, Confirm then sends `123456` | FAIL (auto-submitted; boxes gone) | pass |
| `e2e/totp-code-entry.spec.ts` E-8b (360px viewport, no horizontal overflow): same paste on :3560, no POST in 750 ms, Verify enabled, Verify then posts once | FAIL (Verify disabled: form had auto-submitted) | pass |

Red evidence was taken in the worktree before editing the source (the working tree held only the new tests over the unmodified source, so a `git archive` scratch copy would have shown the same thing); the dev server was :3560.

**Other changes.** `docs/ui-standards.md:407`: O-3 typo fixed ("move. A complete code"), and the clause "an over-long paste does not submit" widened to "a paste that drops a digit, such as an over-long one, does not submit". The `OneTimeCodeInput` `onComplete` doc comment and the `totp-challenge-form.tsx` comment say the same.

**Gate results.** `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires) clean. The three changed unit files: 104 passed (100 before this loop-back, plus the 4 new tests C-4, C-4b, F-5b, N-3b). `e2e/totp-code-entry.spec.ts` plus `e2e/totp-full-login.spec.ts` on :3560 with the MFA-enrolled user: 19 passed. The dev server was stopped by PID. 360px look at the overflow case: six filled boxes, Verify enabled and not pending, no horizontal overflow.

**Handoff:** to qa (Phase 5 re-run, scoped to O-1: C-4, C-4b, F-5b, N-3b, E-8b, plus the three unit files and the two e2e specs), then analyst (Phase 6). Still for the orchestrator at integration: DECISION-257 and the DECISION-193(a) pointer in `docs/decisions.md`, the Gap 6 TODO line.

---

# Phase 5 — Verification (qa), run 2 (O-1 loop-back)

**Verdict: PASS.** The O-1 fix works and its tests fail on the old code. The implementer's one deviation (C-4b) matches Decision 3. I edited no repository files.

**Date:** 2026-10-25
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-otp`, `pipeline/totp-autosubmit` at `9216216` (fix commit `5036932`). Neon branch `pipeline-totp-autosubmit`. I compared endpoint hashes, not values: both connection strings point to a different endpoint from the main checkout's `development` branch.

**What I ran.** The diff since run 1 (`404de0b..9216216`) is small:
- the `exact` calculation in `spread()` in `src/components/shared/one-time-code-input.tsx`, plus its doc comments;
- one comment in `src/app/(auth)/totp/totp-challenge-form.tsx`;
- four new tests across the three unit files and `e2e/totp-code-entry.spec.ts`;
- `docs/ui-standards.md:407`.

No action, page, `src/auth.ts` or `src/proxy.ts` changed: `git diff --quiet 404de0b HEAD` is clean for those files.

I ran:
- typecheck, lint and `npm run check`;
- the three changed unit files, on HEAD and on the pre-fix source;
- e2e on my own dev server at :3560: the five named specs, then every other spec that reaches `OneTimeCodeInput` directly or through the shared helpers (`verifiedContext`, `submitTotp`, `enterTotpCode`);
- a 360px look at the overflow case;
- component probes for other inputs that drop a digit.

**Not re-run:**
- the full e2e suite (the consumer set was green, so nothing triggered it);
- the prod-build lane: `e2e/hydration/totp-challenge.spec.ts` types through the keyboard, which never reaches `spread()`. Run 1 had 13/13 at `404de0b`, and CI runs both lanes;
- the DB-backed vitest suites and `test-rls.sql`: no migration, `authz.ts`, `src/lib/db/` or fixture change.

**Flag state:** before any e2e run, I reset global flags to the CI baseline with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`, against this worktree's `PLATFORM_DATABASE_URL` only. It ended in `COMMIT`.

**Environment:** I checked env vars for presence only and printed no values. 563 GiB disk free.

## Type Check

- `npm run typecheck`: **PASS**
- `npm run lint` (`--max-warnings=0`): **PASS** (exit 0)
- `npm run check`: **PASS**, all eight tripwires, including `check:hydration-gate` (H3) and `check:proxy-imports`

## Unit Tests

The three changed files on HEAD: **104 passed, 0 failed, 0 skipped.** C-4, C-4b, F-5b and N-3b are all green.

**Failing-first, checked independently.** I built a `git archive HEAD` copy and put back the two source files `5036932` changed (`one-time-code-input.tsx` and the comment-only `totp-challenge-form.tsx`) at their `5036932^` versions, keeping the new tests. I used no `git stash`.

| Test | Old source | HEAD |
|---|---|---|
| C-4 (`one-time-code-input.test.tsx:430`) | **FAIL**: `onComplete` called with `{ exact: true }`, expected `false` | pass |
| C-4b (`:441`) | pass. It checks behaviour the old code already had, as the implementer stated | pass |
| F-5b (`totp-challenge-form.test.tsx:146`) | **FAIL**: `verifyTotpAction` called once (`:151`) | pass |
| N-3b (`totp-enroll-form.test.tsx:123`) | **FAIL**: the form auto-submitted, the success panel replaced the boxes, and the box lookup at `:129` failed | pass |
| E-8b (`e2e/totp-code-entry.spec.ts:253`), old-source dev server on :3560 | **FAIL** at `:267`: Verify disabled. The server log shows the auto-submit `POST /totp` | pass |

All three files on the old source: 3 failed / 104 — exactly C-4, F-5b and N-3b. That matches the Phase 4 loop-back record.

**Probes on the HEAD component** (a throwaway vitest file in the scratch copy, now deleted):

| Probe | Result |
|---|---|
| P1: 3 typed, then a 4-character change event (autofill, not paste) into box 4 | `123456`, `exact: false` |
| P2: complete code, then box 6's selected digit replaced by a 2-character change event `78` | `123457`, **`exact: true`**. See O-9 |
| P3: 5 typed, then paste `67` into box 6 | `exact: false` |
| P4: paste `123456789` into box 1 | `exact: false` |
| P5: 5 typed, then a 2-character change event into empty box 6 | `exact: false` |
| P6: 3 typed, then paste `4 5-6` into box 4 (fits after stripping) | `exact: true` |
| P7: complete code, then paste `78` into box 1 | `783456`, `exact: true`. Nothing dropped; same as run 1 |

## End-to-End Tests

The dev server on **:3560** ran from the worktree with the e2e env (`RATE_LIMIT_DISABLED`, the `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`; `E2E_ALLOW_SHARED_DB=true` on the runner). I stopped it by PID, and ports 3560 and 3561 are free. The `mfa-enrolled` seeded user was used throughout. `totp-full-login` covers password, then a typed TOTP that auto-submits, then `/admin`.

- **Named set** (`totp-code-entry`, `totp-full-login`, `totp-recovery-code`, `invitation-new-account`, `hydration/totp-challenge`; `--project=chromium`): 23 total, 23 passed, 0 failed, 0 skipped, 39.3s. E-8b ran at 360px and asserts no horizontal overflow.
- **Other consumers**, `--project=chromium --project=custom-hosts`: 162 total, 162 passed, 0 failed, 0 skipped, 10.1m. The specs:
  - `session-claim-integrity`, `totp-callback-bypass`, `branded-signin`
  - `invitation-existing-account`, `account-page`
  - `giving-admin`, `giving-connect`, `giving-member`, `giving-public`, `giving-settlements`, `giving-statements`, `giving-webhook`
  - `hydration/domains-claim-form`, `hydration/giving-give-form`, `hydration/giving-offline-gift-form`
  - `custom-domains/domains-admin`, `custom-domains/domains-platform`, `custom-domains/forms-and-giving`
- The two `src` files I found that use the component are `totp-challenge-form.tsx` and `totp-enroll-form.tsx`. The e2e helper `enterTotpCode` types with `page.keyboard.type`, which uses the one-digit path and never reaches `spread()`. Only paste and fill tests reach the changed line.

**360px look at the overflow case** (Chromium at 360×740, `/totp?callbackUrl=%2Fadmin`, typed 1, 2, 3, then a real clipboard paste of `4567` into box 4):
- Boxes show `123456` and the form stays on `/totp`.
- 0 POSTs after 1.5s; no error alert; the status region is empty.
- Verify reads "Verify" and is enabled; focus is on box 6.
- 0px horizontal overflow.
- Screenshot: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-otp-r2-shots/totp-360-overflow-paste.png`.

I did not repeat the overflow case visually on `/account/2fa`. N-3b covers it in unit tests, and the layout there is unchanged since run 1.

**Decision 3 and the deviation (C-4b): it matches.** Decision 3 says: "A paste or autofill with exactly 6 digits after stripping spaces and dashes auto-submits. One with more than 6 digits … does not auto-submit."
- A 6-digit paste into box 4 is exactly 6 digits. It restarts at box 1, replaces the whole code, and drops none of the pasted digits. Submitting it follows the letter of Decision 3 and its purpose: a truncated input waits; a whole code submits.
- The brief's literal formula, `start + digits.length <= length`, would have stopped this paste from submitting. That breaks Decision 3's letter. It would also stop a whole-code autofill landing in a focused later box from submitting, which is the iOS and password-manager case Decision 2 wants covered.
- The typed digits 1–3 being overwritten is the old whole-code-replace behaviour (C-3). It is not a dropped pasted digit.

The implemented rule is right; C-4b pins it.

## Regression Tests Added

- **C-4** (`src/components/shared/one-time-code-input.test.tsx:430`) — guards against a short paste that overflows the remaining boxes being marked exact. Failed before the fix.
- **C-4b** (`:441`) — keeps the exact-fit paste and the whole-code paste into a later box marked exact, so the next change cannot over-correct.
- **F-5b — regression for O-1** (`src/app/(auth)/totp/totp-challenge-form.test.tsx:146`) — `/totp` does not auto-submit when a digit is dropped, and Verify posts `123456` once. Failed before the fix.
- **N-3b — regression for O-1** (`src/app/(account)/account/2fa/totp-enroll-form.test.tsx:123`) — same guard on enrolment. Failed before the fix.
- **E-8b — regression for O-1** (`e2e/totp-code-entry.spec.ts:253`) — browser proof at 360px: no POST, Verify enabled, then exactly one POST on click. Failed before the fix.

**Naming nit (does not block):** the new component test is named "C-4", but "C-4: a repeated identical whole-code input event reports completion once" already exists, and the Phase 3 Edge Cases cite C-4 for that one. The new C-4 and C-4b also lack the `— regression for O-1` suffix the other three carry. Renaming them (for example to C-5 and C-5b with the suffix) is a test-name-only change for the implementer.

## Coverage on Critical Modules

- `src/lib/permissions.ts`, `src/lib/two-factor.ts`, `src/lib/flags.ts`: not changed since run 1 (100% / 91.3% / 100% statements there).
- `one-time-code-input.tsx` on HEAD: 100% statements, 95.5% branches. The uncovered branches are the overtype path (lines 174 and 178–182). The new `exact` expression is fully covered.

## Feature-Gate Audit

**No protected routes touched.** `5036932` and `9216216` add or change no route handler, server action, permission or flag. `verifyTotpAction`, `completeEnrollment`, `totp/page.tsx`, `src/auth.ts` and `src/proxy.ts` are unchanged since run 1.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `verifyTotpAction` (unchanged) | yes (unchanged) | n/a (sign-in only, by design) | n/a |
| `completeEnrollment` (unchanged) | unchanged | n/a | n/a |

## Copy Truthfulness

No user-facing string changed in this loop-back. Only comments and docs changed.

- [x] **In the Copy table:** no new user-facing string.
- [x] **Source of each claim checked against `spread()` and `handlePaste()`:**
  - `docs/ui-standards.md:407`, "a paste that drops a digit, such as an over-long one, does not submit": true. Every paste goes through `spread()`, and P3, P4, C-4 and E-8b confirm it.
  - The O-3 typo is fixed ("move. A complete code").
  - The prop doc at `one-time-code-input.tsx` (lines 57–61) says `exact` is false when "a paste or autofill delivered a digit that was dropped". That holds for pastes and for change events of 3 or more characters. P2 is a narrow exception: a 2-character change event that replaces a filled, selected box (O-9).
- [x] **Instructions:** none added.
- [x] **Older strings about the same subject:** none is now false. Four still say only "over-long" and are now incomplete:
  - `docs/product/functionality-map.md:54` ("an over-long paste fills the boxes and waits")
  - `docs/testing.md:65` ("Recovery mode and an over-long paste still need the button")
  - the DECISION-257 draft in this work-log (line 373, "an over-long paste or autofill fills the boxes and waits")
  - the release-note draft (line 453, "If you paste something longer than six digits…")

  Recommendation: widen the DECISION-257 text when the orchestrator lands it, and the release-note line at Phase 6, to "a paste that doesn't fit".

**Copy truthfulness: PASS.**

## Observations (do not block the verdict)

- **O-1: closed.** The fix is verified above.
- **O-3: closed** (typo fixed).
- **O-9 (new, low): one input path can still drop a digit and auto-submit.**
  - What happens: focus selects a filled box (`one-time-code-input.tsx:279`). A 2-character change event then replaces the selection, for example a keyboard-suggestion chip or a drag-and-drop of `78` onto box 6 of a complete code. That takes the overtype path (lines 177–183), which keeps the first digit, drops the second, and commits with the default `exact = true`. P2 gave `123457` with `exact: true`.
  - Why it is low: an actual paste event, and change events of 3 or more characters, are handled correctly. Reaching this needs a non-paste insertion of exactly 2 characters into a filled box. The cost is one attempt, the same as the accepted typo risk.
  - Possible fix, if wanted: in the overtype path, commit with `exact = false` when `prev` is not one of the 2 characters. That would be a new failing-first test for the implementer.
  - Recommend recording it as a TODO rather than holding the pipeline.
- **O-10 (naming):** the duplicate "C-4" name and missing suffix, under Regression Tests Added.
- **Still open from run 1:**
  - O-2: DECISION-257 and the DECISION-193(a) pointer in `docs/decisions.md:336` are still to land at integration (Rule 16).
  - O-4: a thrown `completeEnrollment` still fails silently.
  - O-5: real-device autofill, a screen reader and bfcache back-navigation are still unverified.
  - O-6: the disabled recovery toggle still shows no visual change.
  - O-7: the missing stash entry is for the orchestrator.

**Leftovers:**
- `git status` in the worktree is clean at `9216216`; the main checkout is clean; `git stash list` is empty.
- I started two dev servers on :3560 and stopped both by PID.
- The scratch copy is deleted, including its `.env.local` and node_modules clone.
- Logs and the screenshot remain in the scratchpad (no secrets): `qa-otp-r2-named.log`, `qa-otp-r2-consumers.log`, `qa-otp-r2-old-dev.log`, `qa-otp-r2-head-dev.log`, `qa-otp-r2-shots/`.

## Verdict

**PASS**

The auth gate is met. The e2e ran against my own dev server on :3560 with the MFA-enrolled seeded user, including the full login path in `totp-full-login`. The named set passed 23/23 and the consumer set 162/162, with 0 skipped. I reproduced the failing-first runs myself:
- unit: 3 failed / 104 on the old source (exactly C-4, F-5b and N-3b), 104/104 on HEAD;
- e2e: E-8b failed on an old-source server and passes on HEAD.

---

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (run 2, O-1 loop-back) | qa | Complete. Failing-first reproduced myself (unit 3/104: C-4, F-5b, N-3b; E-8b red on the old-source server); HEAD 104/104; typecheck, lint and check green; e2e on :3560 with the MFA-enrolled user: named 23/23, consumers 162/162, 0 skipped; 360px overflow case checked; flags reset to the CI baseline; C-4b deviation judged to match Decision 3 | PASS | 2026-10-25 |

**Handoff:** to **analyst (Phase 6)**.
- Carry O-9 (rule on it or make it a TODO), O-4 and O-5.
- At integration, the orchestrator must:
  - land DECISION-257, worded as "a paste that drops a digit", not just "over-long", plus the DECISION-193(a) pointer at `docs/decisions.md:336`;
  - land the Gap 6 TODO line;
  - optionally widen `docs/product/functionality-map.md:54` and `docs/testing.md:65`;
  - check O-7.
- The release-note line ("longer than six digits") should be widened at `/release-notes`.
- O-10 (test renames) is optional for the implementer.
