# Refuse an unverified Google email claim at sign-in (F231) — Work Log

> **Slug:** `2026-10-25-google-email-verified`
> **Surface:** (auth) sign-in
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (auth-touching: full login e2e gate applies)
> **Numbers (pre-assigned 2026-10-25, Rule 16):** DECISION-246; finding F231 (assigned by 2b architect addendum 2); no migration; dev port 3520. Rebases onto v0.42.3 (session-update-hardening) before merge.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-10-25 |
| 2 — Architectural review | architect | Skipped: F231 ruled in 2b addendum 2 (R38); DECISION-187 fixes placement; no dep/route/schema/flag/invariant change | — | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete (bug-fix variant) | Design complete; implementer api-developer | 2026-10-25 |
| 4 — Implementation | api-developer | Complete | Gates green; e2e 25/25 on :3520; committed on branch, not pushed | 2026-10-25 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst) — bug-fix variant, brief

## VERDICT

**READY FOR DESIGN.** The bug is real and confirmed from code. Phase 2 can be skipped. Phase 3 should be a short note rather than a skip (see "Phases 2 and 3").

## ONE-LINE TAKE

> Google sign-in trusts the email address on the Google profile without checking Google's own "this address is verified" claim, so an address Google has not verified can sign in as, or newly claim, the account that carries that address. The fix is one refusal in the sign-in gate, placed before any account lookup.

## Confirmation from code

1. **No check exists.**
   - `evaluateSignIn` (`src/lib/auth/sign-in-gate.ts:50-67`) tests only `!user.email` (line 60), then the email lookup and `isActive`. It has no parameter that could carry the claim.
   - The `signIn` callback (`src/auth.ts:217`) destructures only `{ user, account }`. Auth.js does pass `profile` to this callback: `handleAuthorized({ user, account, profile: OAuthProfile })` in `@auth/core/lib/actions/callback/index.js`. `src/auth.ts` drops it.
   - `grep` finds no `email_verified` in `src/auth.ts`, `src/lib/auth/`, `(auth)` or `(invite)`.

2. **Auth.js does not check it either.**
   - In `@auth/core` 0.41.3, `handle-login.js` lines 236-240: if no `accounts` row exists for the Google subject and a user already carries that email, `allowDangerousEmailAccountLinking: true` (set at `src/auth.ts:94`) sets `user = userByEmail` and signs in as them. It reads no verification claim.
   - Google's provider file only documents `email_verified` as something the app must check, in a comment about the `signIn` callback.

3. **The code comments are wrong, not just incomplete.**
   - `src/auth.ts:89-93` says Google "verifies email ownership at sign-in".
   - The `sign-in-gate.ts:12` header and the DECISION-015 text carry the same assumption.
   - The correct statement is "Google verifies it when the claim says so."

4. **Three consequences, all reachable by the same gap.**
   - **Existing account.** Sign-in as the existing account that carries the address (the linking path above). A user who is not enrolled in 2FA is fully signed in. A 2FA-enrolled user still meets `/totp`, because `jwt` resets `twoFactorVerified = false` on every sign-in (`src/auth.ts:244`). That is a partial mitigation, not a fix.
   - **New account.** An address with no account yet can be claimed by whoever presents it. The row is created with `emailVerified: null` (`handle-login.js:260`). That is a pre-claim: the real owner is later invited or registers and finds the address already taken.
   - **Role bootstrap.** For a brand-new row, `ensureDefaultRole` (`src/auth.ts:63-66`, called from `jwt`) gives `ADMIN_ROLE` when the email is in `INITIAL_ADMIN_EMAILS`. An unverified claim of such an address, with no existing row, therefore reaches platform admin. I cannot see whether production sets that variable. Treat the exposure as potentially real until the operator says otherwise.

5. **The gate has no effect on the already-linked case.** For an account already linked by Google subject, `user` is the database user, so `user.email` is the stored address, not the claim. Requiring `email_verified === true` on every non-credentials sign-in is still correct and simple. It fails closed.

## Is Google reachable in production code paths?

- **In code, always.**
  - The Google provider is registered unconditionally (`src/auth.ts:86-95`).
  - The button on `/signin` renders unconditionally (`page.tsx:~131-139`). There is no env or flag gate on it.
  - If `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are unset, clicking it ends in an Auth.js configuration error. If they are set, the path above is live.
- **In production, unknown.**
  - `docs/STATE.md:868` and `docs/deployment.md:822` record Google as not configured. TODO line 99 says the same, but that line may be stale.
  - TODO line 311 ("Invitations Increment 3: Google. Configure Google...") implies it is still unconfigured.
  - The operator must confirm whether `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set in Production, Preview and Development.
- **Treat this as latent.** It is exploitable as soon as Google is configured in any environment. It must land before Increment 3 configures Google and before Increment 2b's "auto-connect a verified sign-in" (TODO line 137). That feature's premise is that the address was proven, and nothing proves it today.

## What users see when refused

- **Refusal path.** A `false` return from `signIn` becomes `AccessDenied` (`handleAuthorized`). `AccessDenied` is a plain `AuthError` with kind `"error"`, so the redirect goes to `/api/auth/error?error=AccessDenied`.
- **Rendered page.** That is Auth.js's built-in page: heading "Access Denied", body "You do not have permission to sign in.", a "Sign in" link, HTTP 403, in Auth.js chrome. `pages.error` is not set in `config.ts`.
- **What the `/signin` page does not do.** `/signin` has no handler for `error=AccessDenied`. It renders only `deactivated` and `CredentialsSignin`.
- **Same page as other refusals.** A deactivated Google user, a Google user with no email, and now an unverified-claim user all get this one page. That makes the copy neutral and non-enumerating, which is what we want. It is not branded, and "you do not have permission" is slightly off for an unverified address.
- **Recommendation: change no strings in this fix.**
  - The unverified refusal must stay byte-identical to the deactivated refusal.
  - A truthful, branded error page is a separate polish item.
  - Phase 5's copy check then reads "no strings changed."
- **Unverified in a browser.** Phase 5 or 6 should hit `/api/auth/error?error=AccessDenied` on `development` at 360px once, because the page is third-party chrome.

## Does DECISION-187 constrain placement?

- **No conflict.** DECISION-187 forbids applying an invitation or any automatic claim from `signIn` or `jwt`. It names `email_verified === true` in `evaluateSignIn()` as the intended Increment 3 work. A pure refusal, with no state change, is explicitly allowed.
- **Rules for this fix.**
  - Gate in `signIn` only, via `evaluateSignIn`.
  - Persist no verified flag to the token.
  - Do not touch the `jwt` callback.

## Interaction with the session fix (`presby-sess`, v0.42.3)

- **Different hunks.** `git -C ../presby-sess diff main...HEAD -- src/auth.ts` changes one import and the `jwt` update branch (about lines 255-300). This fix touches the `signIn` callback and the provider comment (about lines 86-94 and 217-235). The textual merge should be clean. Rebase onto v0.42.3 before Phase 4's final run.
- **Test pattern to reuse.** The branch adds `src/auth.session-update.test.ts`, which drives the real `auth.ts` callbacks. Reuse it for the wiring test below.
- **Shared file.** `vitest.config.ts` (+5 lines) also changes on that branch. Check for a conflict at rebase.
- **Keep apart.** The fix must not touch `jwt` and must not depend on the session fix's grant helper.

## Does this close TODO line 311 ("Invitations Increment 3: Google")?

- **It closes one third.** This pipeline delivers the `email_verified === true` gate.
- **Still open.**
  - Configuring Google (operator, env).
  - The Flow 4 e2e through Google (needs real or faked Google).
- **Action.** Split the line in `docs/TODO.md` at ship: move the `email_verified` clause to Done with this pipeline, and leave the other two.

## Behaviour to preserve

- Credentials sign-in returns `true` unconditionally from the gate (DECISION-015). `authorize()` already enforces `isActive`, lockout and rate limit.
- A verified Google user with no row is allowed and the adapter creates the row.
- A verified Google user with an active row is allowed. A deactivated row is refused.
- A Google user with no email is refused.
- A database error in the lookup still ends in `AccessDenied` (fail closed).
- `allowDangerousEmailAccountLinking` stays `true`. It becomes safe with the gate, and removing it would break existing-account sign-in.
- The unit-test seam stays: `findUserByEmail` is injected and email is lowercased.
- `/signin`'s two-button layout and the credentials form are unchanged.

## User-visible impact

- **Almost nothing for legitimate users.** A normal Gmail or Workspace sign-in carries a verified address and passes.
- **A user whose Google profile reports the address as unverified** is refused with the generic Access Denied page and can sign in another way. Phase 6 should confirm that wording is acceptable (see the follow-up below).
- **No new strings, UI, or routes.**

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous visitor | Clicks "Sign in with Google" on `/signin`, completes Google's consent | per session |
| Anonymous visitor | Reads the refusal page and chooses another sign-in method | rare |

## Flows

**Flow 1 — Verified Google sign-in (unchanged).** `/signin` → Google → callback → `signIn` gate passes → `/launch`.
- Failure: Google error or cancel goes to the Auth.js error flow, as today.

**Flow 2 — Unverified claim (new refusal).** `/signin` → Google → callback → gate refuses before any lookup → `/api/auth/error?error=AccessDenied`.
- No account is created or linked and no session is issued.
- The failure copy is the same as the deactivated refusal.

**Flow 3 — Deactivated or no-email Google user (unchanged).** Same refusal page.

## Permissions & Flags

- **Permission(s):** none. Sign-in is pre-authentication, and no `FEATURES.*` key is involved.
- **Flag(s):** none. Per the memory note "no new platform flags pre-live", and a security fix must not be switchable off.
- **Rollback plan:** revert the commit. There is no data change.

## Adversarial pass

- **Redirect targets.** Not touched. `callbackUrl` handling is unchanged.
- **Enumeration.**
  - Put the claim check before the `findUserByEmail` call, so the refusal does not depend on whether an account exists.
  - The unverified refusal, the deactivated refusal and the no-email refusal must be indistinguishable in page, status and `Location`.
  - Timing: the unverified path skips the lookup. It is an unconditional refusal for that input, so it reveals nothing about any account. This is a design point for Phase 3 to confirm.
- **Input boundaries.**
  - Accept only strict boolean `true`.
  - Refuse `false`, missing, `null`, string `"true"`, `1` and any other shape. Unexpected shapes fail closed.
  - Verify Google's real claim shape on `development` once Google is configured. Google's OIDC ID token returns a boolean.
- **State-machine shortcuts.** None apply. The callback URL requires Google's token exchange, and the gate runs after the profile is established.
- **Self-targeting.** Not applicable.
- **Other providers.** The gate keys on "not credentials", so a future non-Google provider without the claim would be refused until it is designed in. That is the safe default. Say so in the code comment, which currently warns the opposite way.

## Gaps the Request Didn't Address

1. **Wiring.** A correct gate that `src/auth.ts` forgets to feed `profile` into passes every `sign-in-gate.test.ts` test and fixes nothing. Require a callback-level test (below).
2. **Existing gate tests will break by design.**
   - `sign-in-gate.test.ts` calls `evaluateSignIn("google", {...}, find)` with three arguments, so they will start returning `false`.
   - Update them to pass a verified claim. Do not make the claim argument optional-with-default-allow, because a missed call site would reopen the hole.
3. **Wrong comments and decision text.** Correct the comments at `src/auth.ts:89-93` and `sign-in-gate.ts:11-14`. Amend DECISION-015 ("Google verifies at token issuance") through DECISION-246, with the amendment text recording that the verified claim, not the issuer, is the proof.
4. **Refusal is invisible.**
   - No audit row, log line or metric records a refused claim. Nothing is written today for deactivated refusals either.
   - Recommend no audit row in this fix: a refusal is not a mutation, and an audit row would be attacker-writable.
   - Phase 3 should decide whether a PII-free server log line is worth it.
5. **`INITIAL_ADMIN_EMAILS` exposure (see above).** The operator should be asked whether the variable is set anywhere, and whether any account was created via Google so far.
6. **Starter relevance.** This is starter-generic and a `/downstream-sync` candidate. Note it in the work-log.

## Out of Scope (confirm with user)

- Configuring Google and the Flow 4 e2e through Google (Increment 3).
- A branded or truthful error page, and a `/signin?error=` message for refused Google sign-ins.
- Persisting the verified claim to `users.emailVerified`. Increment 2b's auto-connect may need it, but that is a design decision for 2b.
- Removing or flagging the Google button when unconfigured.
- Any change to `jwt`, the 2FA grant, or the session fix.
- An email-verification flow for local registration.

## Open Questions

- **For the operator.** Are `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` set in Production, Preview or Development? Is `INITIAL_ADMIN_EMAILS` set in any of them? Has anyone signed in via Google so far?
- **For Phase 3.**
  - Claim argument shape: pass `profile?.email_verified` as a typed `claims` argument, or pass the whole profile.
  - Whether to add a log line for refusals.
  - Whether to write the callback-level test through `auth.ts`.

## Regression tests to write failing-first (Phase 4 implementer)

1. **Gate unit tests** (`src/lib/auth/sign-in-gate.test.ts`), failing before the fix:
   - Google with `email_verified: false` returns `false`, and `findUserByEmail` is not called.
   - Also returns `false` for missing, `null`, `"true"` and `1`.
   - Verified with no row → `true`. Verified with an active row → `true`. Verified with a deactivated row → `false`. No email → `false`.
   - Credentials → `true` regardless of the claim argument.
   - Update the existing cases (above) to pass a verified claim.
2. **Wiring test** (new, modelled on `src/auth.session-update.test.ts` after rebase), failing before the fix: invoke the real `signIn` callback from `src/auth.ts` with `provider: "google"` and a `profile` whose `email_verified` is `false`; expect it to resolve `false` and not touch the users table. Add the verified positive case. This is the test that proves the claim reaches the gate.
3. **Failing-first evidence.** QA reruns tests 1 and 2 against the pre-fix `src/auth.ts` and `sign-in-gate.ts` to see them fail, per the bug-fix variant.
4. **Honest limit.** No automated test drives a real Google round trip. State that in the work-log rather than implying coverage.

## E2E gate (CLAUDE.md Phase 4 and 5)

- The diff touches `src/auth.ts` and `src/lib/auth/`, so a running-server login smoke is mandatory before Phase 5.
- It must include the MFA-enrolled user: `e2e/totp-full-login.spec.ts`.
- Also run `post-login-routing.spec.ts` and `branded-signin.spec.ts`.
- Use `E2E_BASE_URL` with the pre-assigned port 3520. A deferred or skipped e2e means QA returns BLOCKED, not PASS.
- These specs exercise the credentials path. They prove the shared callback still works, not the Google refusal.

## Phases 2 and 3

- **Phase 2: skip.** Suggested notation: "Skipping Phase 2 — F231 was ruled by the architect in 2b addendum 2 (R38); DECISION-187 already fixes the placement (a refusal inside `evaluateSignIn`, nothing in `jwt`); no new dependency, directory, route, schema or flag, and no invariant changes."
- **Phase 3: brief, not skipped.** Auth is the highest-consequence area and there are five small decisions to record:
  - the gate signature (explicit, required claim argument);
  - claim-check-before-lookup ordering;
  - the log-line question;
  - the comment and DECISION-015 amendment (DECISION-246);
  - rebasing onto v0.42.3 and the test plan.
- These decisions fit in a few lines. If the orchestrator would rather not run Phase 3, record them in the Phase 4 section with the same skip-notation form, with the tech-lead's name on them.

## Phase 6 note (for later)

- The "walk as the person this path creates" requirement applies in spirit: this fix narrows what a newly created Google account can reach.
- Walk it on `development` at 360px if Google is configured there: a verified sign-in lands where it did before, and the refusal page renders.
- If Google is not configured on `development`, the walk cannot run, and Phase 6 must record that as a limit and rest on the unit and wiring evidence. That would make the ruling SHIP WITH NOTES.
- At ship, split TODO line 311, add the changelog and release note (neutral wording), and mark the functionality-map line current. There is no what's-new entry; this is not member-visible.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-10-25 |

## Handoff

- Next: tech-lead for a brief Phase 3 note, with Phase 2 skipped using the notation above. It needs the operator's answers on the Google environment variables and `INITIAL_ADMIN_EMAILS` before Phase 6, but they do not block the design.
- Implementer: **api-developer**. The change is server-side only (one function, one callback, one test file); there is no component work.
- Key files:
  - `/Users/cshenso/git/presby-platform/presby-gauth/src/lib/auth/sign-in-gate.ts`
  - `/Users/cshenso/git/presby-platform/presby-gauth/src/auth.ts` (signIn at lines 217-235; comments at lines 89-94)
  - `/Users/cshenso/git/presby-platform/presby-gauth/src/lib/auth/sign-in-gate.test.ts`

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

# Phase 3 — Technical Design (tech-lead) — bug-fix variant

## Root cause

`evaluateSignIn(provider, user, findUserByEmail)` (`src/lib/auth/sign-in-gate.ts:50`) keys every non-credentials sign-in on `user.email` and never sees Google's `email_verified` claim. The `signIn` callback (`src/auth.ts:217`) destructures `{ user, account }` and drops `profile`, although `@auth/core` 0.41.3 passes it (`lib/actions/callback/index.js:63-66`: `handleAuthorized({ user, account, profile: OAuthProfile })`). Auth.js itself does not check the claim either: with `allowDangerousEmailAccountLinking: true` (`src/auth.ts:94`) an unlinked Google subject whose email matches an existing `users` row is signed in as that row, and a Google subject with no row creates one (`emailVerified: null`) and, for an address in `INITIAL_ADMIN_EMAILS`, `ensureDefaultRole` grants `ADMIN_ROLE`. The premise recorded in DECISION-015 point 2 and in the comments at `src/auth.ts:89-93` and `sign-in-gate.ts:11-14` ("Google verifies email ownership at token issuance") is false as stated: Google verifies it when `email_verified` is `true`, and only the claim says so. Latent today (orchestrator note: Google is configured in no Vercel environment, production `accounts` has 0 rows, `INITIAL_ADMIN_EMAILS` is set in Production), live the moment `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set anywhere.

## Summary

Make the sign-in gate refuse any non-credentials sign-in unless the provider asserted `email_verified === true` (strict boolean), decide that before any user lookup, feed the claim from `profile` in the `signIn` callback, correct the two false comments, and amend DECISION-015 through DECISION-246. A pure refusal with no state change, inside `evaluateSignIn`, nothing in `jwt`: exactly the placement DECISION-187 names. No schema, route, dependency, flag or string changes. The change is `paper`-to-code: the premise was previously a comment; it becomes a tested gate.

## Permissions & Flags

- Permission: none (sign-in is pre-authentication; no `FEATURES.*` key).
- Flag: not needed. A security refusal must not be switchable off (and the operator rule is no new global flags pre-live). Rollback is revert; there is no data change.

## API Contract

No routes or actions. Function signatures (all valid TypeScript: required parameters only, no defaults, so nothing trails a required parameter):

```ts
// src/lib/auth/sign-in-gate.ts
export type SignInClaims = { emailVerified: unknown };           // required property, no default
export function isEmailClaimVerified(claim: unknown): claim is true; // claim === true, nothing else

export async function evaluateSignIn(
  provider: string,
  user: GateUser,
  claims: SignInClaims,
  findUserByEmail: FindUserByEmail,
): Promise<boolean>;
```

Decisions (the five the analyst listed):

1. **Explicit, required claim argument, typed object, not the whole profile.** `claims` is inserted as the third parameter and `findUserByEmail` stays last. Every existing three-argument call (the five in `sign-in-gate.test.ts` and the one in `src/auth.ts`) fails `npm run typecheck` until it passes a claim, so a missed call site cannot silently reopen the hole; an optional-with-default-allow argument is rejected for that reason. The gate takes `emailVerified: unknown` (not `boolean | undefined`) so Auth.js's `Profile.email_verified?: boolean` typing cannot lend false confidence: a runtime `"true"`, `1`, `null` or missing value must be refused, and the type says the gate expects to be handed anything. The whole `profile` is not passed: the gate stays independent of Auth.js's profile shape and never holds PII it does not need. The caller passes `{ emailVerified: profile?.email_verified }`.
2. **Claim check before the user lookup, and before the no-email check.** Order in the gate: credentials → `true` (unchanged, DECISION-015); `!isEmailClaimVerified(claims.emailVerified)` → `false`; `!user.email` → `false`; lowercase, `findUserByEmail`, `null` → `true`, else `row.isActive`. The unverified refusal is therefore unconditional for that input and does not depend on whether an account exists. Timing: the unverified path skips one DB round trip, so it is faster than a deactivated refusal. This reveals nothing about any account (the input is the caller's own Google assertion, and the path never reads `users`); the page, status and `Location` are byte-identical to the deactivated and no-email refusals (`/api/auth/error?error=AccessDenied`). Accepted.
3. **A PII-free server log line: yes.** One `console.warn` per refusal caused by the claim, because without it a legitimate user bounced to the generic page (for example a Workspace profile reporting `false`) is undiagnosable and the operator's only evidence is the user's report. The gate stays pure; the log sits in the `signIn` callback in `src/auth.ts`, conditioned on the same exported predicate so the condition is not duplicated: `if (!allowed && provider !== "credentials" && !isEmailClaimVerified(claims.emailVerified))`. Fields: `{ provider, claimType: typeof claims.emailVerified }` only (`"boolean"` here means `false`; `"undefined"` means the profile carried no claim). Never the email, subject id or name. Precedent: `local-login.ts:118` logs `console.error` with a name-only payload. No audit row: a refusal is not a mutation, and `audit_events` would be written by an unauthenticated party, so an attacker could fill it. The line is not rate-limited (Vercel log retention is the bound); revisit if it proves noisy.
4. **Comments and DECISION-246.** Correct three places (below). The amendment to DECISION-015 is drafted here; the orchestrator writes `docs/decisions.md` at integration (Rule 16).
5. **Rebase.** See Implementation Order step 6 and Edge Cases (vitest overlap).

### Corrected comment text

`src/auth.ts:89-93` (replace the block above `allowDangerousEmailAccountLinking`):

```
// Linking an existing user record by email is only safe because the signIn
// callback refuses any sign-in whose provider did not assert
// `email_verified === true` (evaluateSignIn, DECISION-246). Google verifies an
// address only when that claim says so; Auth.js does not check it. Do not
// remove the gate without removing this flag. A second OAuth provider is
// refused by that same gate until it is designed in (the claim is required for
// every non-credentials provider); setting this to `false` is the further step
// if it can never prove ownership of an email.
```

`sign-in-gate.ts` header (replace the "Google verifies email ownership at token issuance..." paragraph): "Google asserts that it verified an address only through the `email_verified` claim on the profile, and Auth.js does not enforce it, so the gate requires the claim to be strictly `true` for every non-credentials provider and refuses before any lookup (DECISION-246, amending DECISION-015). With the claim true, using `user.email` as the lookup key is sound. See DECISION-015 for the deletion-strategy constraint (soft deactivation only; hard-delete invalidates the email-keyed gate)." Also update the JSDoc branch list: add "claim not strictly true → false (before any lookup)" first, and document the `claims` param.

`src/auth.ts` signIn callback comment: add "- OAuth, claim not strictly `true` → false (DECISION-246), logged without PII".

### DECISION-246 draft (for `docs/decisions.md`, newest first; amends DECISION-015 point 2; fulfils the `evaluateSignIn()` clause of DECISION-187)

> ## DECISION-246: A non-credentials sign-in must carry `email_verified === true`; the gate refuses before any lookup
>
> **Status:** Resolved  **Date:** 2026-10-25  **Feature:** `2026-10-25-google-email-verified` (F231)  **Amends:** DECISION-015 point 2
>
> ### Decision
> `evaluateSignIn(provider, user, claims, findUserByEmail)` refuses every non-credentials sign-in unless `claims.emailVerified === true` (strict boolean; `false`, missing, `null`, `"true"`, `1` all refuse), and it decides that before it reads `users`. `src/auth.ts` feeds the claim from the `signIn` callback's `profile`. A refusal on the claim writes one PII-free `console.warn` (provider and claim type only) and no audit row.
>
> ### Amendment to DECISION-015
> DECISION-015 point 2 said the OAuth lookup is safe because Google "verifies [the email] at token issuance". That is not what the protocol guarantees: the profile carries an `email_verified` claim that may be `false`, and Auth.js does not check it. With `allowDangerousEmailAccountLinking: true` an unverified claim of an existing user's address signs in as that user (a 2FA-enrolled user still meets `/totp`, which is a mitigation, not the fix), and a claim of an unused address creates a pre-claimed account, which for an address in `INITIAL_ADMIN_EMAILS` receives `ADMIN_ROLE`. The verified claim, not the issuer, is the proof. The email-keyed lookup, soft-deactivation rule and credentials short-circuit in DECISION-015 stand.
>
> ### Rationale
> Smallest correct placement: a refusal inside the existing pure gate, which DECISION-187 already names as the home of this check and which forbids any applying of state from `signIn`/`jwt`. Strict `=== true` fails closed on any unexpected shape. The claim is required, not defaulted, so a missed call site is a compile error. Other providers are refused until designed in, the safe default.
>
> ### Alternatives rejected
> Persist the claim to `users.emailVerified` or the token (state change from `signIn`/`jwt`, DECISION-187; a design question for Increment 2b). Remove `allowDangerousEmailAccountLinking` (breaks existing-account Google sign-in; unnecessary once gated). Optional claim argument defaulting to allow (reopens the hole at any missed call site). An audit row per refusal (attacker-writable, not a mutation). A flag (a security refusal must not be switchable; no new flags pre-live).
>
> ### Residual (accepted)
> Nothing automated drives a real Google round trip; the profile pass-through is proven against the installed `@auth/core` source and the callback wiring, not a live exchange. Verify Google's claim shape (boolean in the OIDC ID token) on `development` when Google is first configured. A user whose profile reports the address as unverified sees the generic Auth.js "Access Denied" page, identical to a deactivated user; a truthful branded page is a separate polish item.
>
> ### Impact
> `src/lib/auth/sign-in-gate.ts` (signature, predicate, order), `src/auth.ts` (`signIn` callback, provider comment), `sign-in-gate.test.ts`, new `src/auth.sign-in.test.ts`. No schema, route, dependency or flag. TODO line 311 splits: the gate clause moves to Done; configuring Google and the Flow 4 e2e stay open.

## Data Model

No schema changes required. No migration.

## Component / Page Plan

- Pages and components to create: none.
- Files to modify: `src/lib/auth/sign-in-gate.ts`, `src/auth.ts`, `src/lib/auth/sign-in-gate.test.ts`.
- Files to create: `src/auth.sign-in.test.ts` (wiring test).
- Possibly: `vitest.config.ts` (see Edge Cases / rebase).
- At ship (orchestrator, not the implementer): `docs/decisions.md` DECISION-246, `docs/TODO.md` line 311 split, release notes (`/release-notes`, neutral wording: a sign-in hardening that applies before Google is switched on; not an active exposure), `docs/product/functionality-map.md` Public/Auth line (32) and the sign-in bullet (53) gain "refuses a provider email Google has not verified". No what's-new entry. Starter-generic: note for `/downstream-sync`.

## Implementation Order

1. Tests first: update and extend `sign-in-gate.test.ts` (Test A) and write `src/auth.sign-in.test.ts` (Test B); run both against the unmodified source and record the failures.
2. `sign-in-gate.ts`: add `SignInClaims`, `isEmailClaimVerified`, the new signature and order; correct the header and JSDoc. Test A goes green.
3. `auth.ts`: destructure `profile`, pass `{ emailVerified: profile?.email_verified }`, add the guarded `console.warn`, correct both comments. Test B goes green.
4. `npm run typecheck` (the A.7 pin and the compile-time check on the old call shape), `npm run check`, then the e2e gate.
5. No schema, catalog, UI or audit step applies.
6. **Rebase**: before the final run handed to QA, rebase onto v0.42.3 (`pipeline/session-update-hardening` if it has not merged to `main` yet; retarget via `/merge-pr` if stacked). Re-run both test files and step 4 after the rebase. Release notes after Phase 6.

## Test plan (failing-first)

Write each test, run it on the unmodified source, record the failure in the Phase 4 section, then implement.

**A. Gate unit tests** (`src/lib/auth/sign-in-gate.test.ts`). Existing five cases updated to pass `{ emailVerified: true }`; `simulateOldLogic` demonstration kept. New (each fails before the fix because the unfixed gate ignores the claim and calls the lookup):
1. Google, `emailVerified: false` → `false`, and `findUserByEmail` not called.
2. `it.each` over `undefined`, `null`, `"true"`, `1`, `"false"`, `0`, `{}` → `false`, lookup not called.
3. Verified, no row → `true`; verified, active row → `true`; verified, deactivated row → `false`; verified, no email → `false` (lookup not called).
4. Mixed-case email with verified claim → lookup receives the lowercased email (existing test, claim added).
5. Credentials with each of `true`, `false`, `undefined` → `true`, lookup not called.
6. Lookup throws (verified claim) → the promise rejects (the gate does not swallow it; Auth.js turns a callback throw into a refusal). Pins the fail-closed claim in Edge Cases.
7. Type-level pin: a `// @ts-expect-error` call in the old three-argument shape, so the typecheck gate fails if the claim ever becomes optional.

**B. Callback wiring test** (`src/auth.sign-in.test.ts`), through the real `src/auth.ts`. Approach (decided because a live Google token exchange is not drivable in a unit run): `vi.mock("next-auth", ...)` with a default export that records its config argument and returns stub `{ handlers, auth, signIn, signOut, unstable_update }`; capture the config whose `providers` is defined (`src/lib/auth/config.ts` also calls `NextAuth` for the edge instance, so the mock is invoked twice and the first call lacks the `signIn` override). Mock `@/lib/db` (a recording `users.findFirst`), `@auth/drizzle-adapter`, `server-only`, `@/lib/audit`, `@/lib/rate-limit`, `@/lib/turnstile` and `@/lib/auth/local-login` exactly as `src/auth.session-update.test.ts` does on the session branch (copy the mock block into this file; do not import from another test file). Cases against `config.callbacks.signIn({ user, account: { provider: "google" }, profile })`:
   1. `profile.email_verified === false` → resolves `false`; `users.findFirst` not called. (Fails before the fix: the callback ignores `profile`, asks the lookup, the mock returns no row, resolves `true`.)
   2. `email_verified` absent / `"true"` / `1` → `false`.
   3. `email_verified === true`, no row → `true`; active row → `true`; deactivated row → `false`.
   4. `account: { provider: "credentials" }`, no profile → `true`, lookup not called.
   5. Log line: a claim refusal calls `console.warn` once with an object containing `provider` and `claimType`, and `JSON.stringify` of the call arguments contains neither the email nor the subject id used in the case; a verified sign-in, a deactivated refusal and a credentials sign-in do not call `console.warn`.
8. **Dependency tripwire** (same file, one test): read the installed `@auth/core/lib/actions/callback/index.js` and assert the OAuth `handleAuthorized` call passes `profile`. It fails if an Auth.js upgrade stops passing the profile, which would make the wiring test green over a dead claim. Plain `readFileSync` on the resolved package path; brittle by intent.

**Honest limit** (state in Phase 4 and 5): no automated test drives a real Google round trip; coverage of "the claim arrives" is the callback wiring test plus the dependency tripwire, and the first real exchange on `development` is the open verification (Phase 6 note).

## E2E gate (Phase 4 gate; auth-touching)

Diff touches `src/auth.ts` and `src/lib/auth/`, so a running-server login smoke including an MFA-enrolled user must pass before Phase 5. Start the server on port **3520** (`npx dotenv -e .env.local -- next dev -p 3520`, with the test fakes per `docs/testing.md`), run with `E2E_BASE_URL=http://localhost:3520`, stop it by PID. Specs: `e2e/totp-full-login.spec.ts` (the MFA-enrolled user, `E2E_USERS["mfa-enrolled"]`), `e2e/post-login-routing.spec.ts`, `e2e/branded-signin.spec.ts`, plus `e2e/totp-callback-bypass.spec.ts` (touches the callback path). A deferred or skipped run is BLOCKED, not PASS. These exercise the credentials branch: they prove the shared callback still passes `credentials`, not the Google refusal.

**E2E blast radius.** No existing spec asserts Google sign-in behaviour (grep of `e2e/` for `email_verified`, `AccessDenied` and `provider` finds nothing); the new gate does not touch the credentials branch. No new e2e spec is added. **Flags:** none of the four named specs is changed; `branded-signin.spec.ts` sets `ui.branded_signin`, `ui.brand_theming` and `sites.public_render` itself through its own `setFlag` helper, and `scripts/ci/e2e-baseline-flags.sql` gains nothing.

## Edge Cases & Risks

| Case | Behaviour | Pinned by |
|---|---|---|
| `email_verified` is `false` | refuse, no lookup | A.1, B.1 |
| claim missing, `null`, `"true"`, `1`, `0`, `{}` | refuse (strict boolean `true` only) | A.2, B.2 |
| verified, new address | allow; adapter creates the row (unchanged) | A.3, B.3 |
| verified, existing active row | allow (unchanged) | A.3, B.3 |
| verified, deactivated row | refuse (unchanged) | A.3, B.3 |
| verified, no email | refuse, no lookup | A.3 |
| credentials, any claim | allow, no lookup (DECISION-015) | A.5, B.4; e2e `totp-full-login` |
| lookup throws | callback rejects; Auth.js ends in `AccessDenied` (fail closed) | A.6 (gate rejects); the Auth.js conversion is read from `handleAuthorized` source, **unverified** by a test |
| already-linked Google account | `user` is the DB row; the claim is still required (Google's current assertion), so an unverified claim is refused even for a linked user | B.1 passes a `user` carrying a DB-style id |
| refusal pages indistinguishable | all three refusals return `false` from the callback, so Auth.js redirects to the same URL; byte equality of the rendered page is by construction, **unverified** in a browser (Phase 5/6 hits `/api/auth/error?error=AccessDenied` at 360px once on `development`) | callback result: A.1, A.3 |
| Auth.js upgrade stops passing `profile` | wiring test stays green over a dead claim | B.8 |
| missing `account` defaults to `"credentials"` (pre-existing, `account?.provider ?? "credentials"`) | not changed; Auth.js supplies `account` on every OAuth path; noted, **unverified** beyond reading source | none; Out of Scope |
| claim about the linked account's current Google address vs the stored email | not compared (a linked account is matched by subject); out of scope | none |
| `vitest.config.ts` overlap with `presby-sess` | the session branch adds `server: { deps: { inline: [/next-auth/] } }` plus a 4-line comment. The wiring test mocks `next-auth`, which may make the inline unnecessary; if the implementer finds it needed before the rebase, copy the session branch's hunk **byte-for-byte** (identical hunks merge cleanly); never write a different variant. On rebase, if `vitest.config.ts` conflicts, take the session branch's version. | rebase step; B tests rerun after |
| `INITIAL_ADMIN_EMAILS` bootstrap via an unverified claim | closed by the gate: the refusal happens before the adapter creates a row, so `ensureDefaultRole` never runs | B.1 (no row is created: `users.findFirst` not called and the callback returns before the adapter) |

## Copy

No strings change. The refusal reuses Auth.js's built-in "Access Denied" page ("You do not have permission to sign in."), unchanged and third-party. The only new text is a server log line (not user-facing).

- *Residuals:* no string denies an accepted residual; DECISION-246's draft states the generic-page and no-live-round-trip residuals openly.
- *Source of truth:* no claim about a person, account, date or state is made in any UI string. The log line asserts only the provider id and `typeof` of the claim, both read from the callback arguments.
- *Audience:* the Access Denied page is seen by the person attempting a Google sign-in; it makes no promise or instruction. The log line is read by the operator.
- *Neighbours:* grep of the live tree for sign-in refusal strings (`Access Denied`, `AccessDenied`, `permission to sign in`, `verified`) in `src/` and `e2e/` finds no first-party string the change makes stale; `/signin` handles only `deactivated` and `CredentialsSignin` and is untouched. The stale prose is the code comments and DECISION-015 text, covered above as modify targets: `src/auth.ts:89-93`, `src/lib/auth/sign-in-gate.ts:11-14`, `docs/decisions.md` DECISION-015 point 2 (amended by DECISION-246, text left as history).

## Carry-forward

| Phase 1 gap / ruling | Addressed here, or deferred |
|---|---|
| Gap 1: wiring (a correct gate that `auth.ts` does not feed) | Test B, plus the dependency tripwire B.8 |
| Gap 2: existing gate tests break by design; no optional-allow default | Decision 1 (required third parameter) and Test A (existing cases updated; A.7 type pin) |
| Gap 3: wrong comments and DECISION-015 | Corrected comment text and DECISION-246 draft above |
| Gap 4: refusal invisible; audit row vs PII-free log | Decision 3: log line yes, audit row no |
| Gap 5: `INITIAL_ADMIN_EMAILS` exposure | Closed by the gate; operator answer recorded by the orchestrator (latent, not live); verify Google claim shape on `development` when configured (deferred to Increment 3, operator) |
| Gap 6: starter relevance | Noted: `/downstream-sync` candidate (starter-generic) |
| Placement vs DECISION-187 | Honored: refusal in `evaluateSignIn` only; `jwt` untouched; no verified flag persisted |
| Rebase onto v0.42.3, `vitest.config.ts` overlap, reuse the `auth.session-update.test.ts` pattern | Implementation Order step 6; Edge Cases row; pattern copied, not imported |
| Out of Scope list (Google config and Flow 4 e2e; branded error page; persisting `users.emailVerified`; Google button when unconfigured; `jwt`/2FA grant; local-registration verification) | Deferred: accepted by the analyst in Phase 1; Phase 3 adds none. Confirm with the operator at the Phase 3 handoff |
| Browser check of the refusal page at 360px | Deferred to Phase 5/6 on `development` (third-party chrome); if Google is unconfigured there, Phase 6 records the limit and the ruling is SHIP WITH NOTES |
| TODO line 311 split | At ship (orchestrator) |
| Phase 2 | Skipped, recorded in Per-Phase Status; no architect rulings to carry |

## Out of Scope (confirm with the operator)

Configuring Google; the Flow 4 e2e through Google; a branded or truthful error page and a `/signin?error=` message; persisting the claim to `users.emailVerified` or the token; hiding the Google button when unconfigured; any change to `jwt`, the 2FA grant or the session fix; the `account?.provider ?? "credentials"` default; email verification for local registration.

## Feasibility check (against the live tree, 2026-10-25)

- Signature: parameters all required, valid TS. Only caller outside tests is `src/auth.ts:224` (grep of `src/`, `e2e/`, `scripts/`).
- No ALTER/DROP, no SECURITY DEFINER function touched, no CHECK or trigger, no FK, no fixture or seed involved.
- `profile` reaches the callback on the OAuth path: `@auth/core` 0.41.3 `lib/actions/callback/index.js:63-66`; the other `handleAuthorized` calls (email, webauthn, credentials) are non-OAuth and do not reach the non-credentials branch with a Google provider id.
- `src/lib/auth/config.ts` calls `NextAuth` too, so the wiring test must pick the config with `providers`.
- `presby-sess` (`pipeline/session-update-hardening`) is not merged to `main` (HEAD `ce661d7`); the rebase is real. Re-run this feasibility check against the live tree at rebase.

## Implementer

**api-developer** (server-only: one function, one callback, two test files; no component work). Stop for a ruling if a user-facing string seems needed.

---

# Phase 4 — Implementation

## Files Created

- `src/auth.sign-in.test.ts` — wiring test through the real `src/auth.ts` `signIn` callback (`next-auth` mocked to capture the config that has `providers`; mock block copied from `auth.session-update.test.ts`, not imported): B.1-B.5 (15 tests) plus the `@auth/core` dependency tripwire.

## Files Modified

- `src/lib/auth/sign-in-gate.ts` — `SignInClaims`, `isEmailClaimVerified` (strict `=== true`), new required third parameter `claims`, claim checked after the credentials short-circuit and before the no-email check and the lookup; header and JSDoc corrected (DECISION-246 text).
- `src/auth.ts` — `signIn` callback destructures `profile`, passes `{ emailVerified: profile?.email_verified }`, guarded PII-free `console.warn` (provider and `typeof` claim only; no audit row); provider comment above `allowDangerousEmailAccountLinking` and callback comment corrected. `jwt` untouched.
- `src/lib/auth/sign-in-gate.test.ts` — existing five cases pass a verified claim; new `provider email claim (DECISION-246)` block (A.1-A.7: false, `it.each` over undefined/null/"true"/1/"false"/0/{}, verified x {no row, active, deactivated, no email}, credentials x {true,false,undefined}, other provider, lookup throws, `@ts-expect-error` pin on the old three-argument shape).

`vitest.config.ts` not changed: mocking `next-auth` made the inline setting unnecessary. At rebase onto v0.42.3, if it conflicts take the session branch's version.

## Schema Changes

- none. No migration, route, action, dependency, flag or `FEATURES` change.

## Audit Events

- none, by design (a refusal is not a mutation; an unauthenticated party would be writing the row). A PII-free `console.warn` stands in.

## Failing-first record

Tests were written and run against the unmodified `src/auth.ts` / `sign-in-gate.ts` before any source edit:

- `sign-in-gate.test.ts`: 18 failed | 7 passed (25). Most failures are the shifted-argument shape (`findUserByEmail is not a function`), which is the compile-time break the design wants; the claim cases fail because the unfixed gate ignores the claim.
- `src/auth.sign-in.test.ts`: 9 failed | 6 passed (15), signature-independent: every `email_verified` false/absent/"true"/1/null case and the no-profile case resolved `true` and asked the lookup; both log-line cases failed (no `console.warn`). The tripwire is a dependency assertion and passes before and after (it is not a failing-first test).
- After the fix: both files 40 passed (25 + 15).

## Gates

- `npm run typecheck` clean (the `@ts-expect-error` pin is live); `npm run lint` clean (`--max-warnings=0`).
- `npm run check`: all eight tripwires pass.
- `npm test` (plain): 543 files passed, 77 skipped (DB-backed); 8356 tests passed, 2442 skipped.
- `npm run build`: passes. First attempt failed with the known worktree `@vercel/turbopack-next/internal/font/google/font` error from a stale cloned `.next`; `rm -rf .next` and rebuild passed (same on the unmodified tree).
- E2E on my own server (`next dev -p 3520`, test fakes set, `E2E_BASE_URL=http://localhost:3520`, stopped by PID): `totp-full-login` (MFA-enrolled `admin-2fa-enrolled`), `post-login-routing`, `branded-signin`, `totp-callback-bypass`: **25 passed / 25**. No flag drift on the branch, so `e2e-baseline-flags.sql` was not applied. The dev log contains zero "signIn refused" lines (the credentials path never warns).

## Implementer Notes

- No deviations from the Phase 3 design. The gate order is credentials, claim, no-email, lookup, as designed.
- **Honest limit:** no automated test drives a real Google round trip. "The claim arrives" rests on the wiring test and the `@auth/core` tripwire (which reads the installed `lib/actions/callback/index.js`; the package's exports map hides `package.json`, so the test resolves the root entry and joins `lib/...`). Verify Google's claim shape (boolean in the OIDC ID token) on `development` when Google is first configured. The e2e specs exercise the credentials branch only.
- The `@auth/core` email and webauthn `handleAuthorized` paths pass no `profile`; neither provider is configured here, and the gate would refuse them (safe default).
- The refusal page is Auth.js's generic Access Denied, unchanged and third-party.
- At ship (orchestrator): DECISION-246 into `docs/decisions.md`, TODO line 311 split, release note (neutral wording), functionality-map lines, `/downstream-sync` candidate. Rebase onto v0.42.3 before QA's final run, then re-run both test files and typecheck.

Strings added or changed: none user-facing. Server log line only: `src/auth.ts` `signIn refused: provider email not verified` (operator-facing).

Next: qa (Phase 5). Auth-touching, so the e2e above must be re-run by QA on a real server; the MFA-enrolled spec is `e2e/totp-full-login.spec.ts`.

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

## Orchestrator note on the Phase 1 open questions (2026-10-25)

- **Production exposure: latent, not live.** `vercel env ls` (names only) shows no `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` in any Vercel environment, so the Google button ends in an Auth.js configuration error there. Production `accounts` holds **0 rows** (read-only count by provider), so no Google sign-in has ever completed. `INITIAL_ADMIN_EMAILS` **is set in Production** (created 55 days ago), so the role-bootstrap consequence would be real the moment Google is configured: this fix must land before Google is configured in any environment (Increment 3 of invitations, and 2b's auto-connect).
- Severity for the release note: a latent sign-in hardening, not an active exposure. Neutral wording still applies.
