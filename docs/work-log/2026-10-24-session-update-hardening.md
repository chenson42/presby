# Session update hardening — Work Log

> **Slug:** `2026-10-24-session-update-hardening`
> **Surface:** (auth) — `src/auth.ts` jwt callback, `/totp` verification action, every 2FA gate that reads the session claim
> **Permission(s):** none new
> **Flag(s):** not needed
> **Estimated complexity:** small (security)
> **Pipeline mode:** Bug-fix variant. Auth-touching: the Phase 4 full-login e2e (incl. an MFA-enrolled user) and the Phase 5 stricter gate apply.
> **Source:** test-coverage review 2026-10-24, finding C-1 (the review file lands in the repo only after this fix is deployed; the repo is public). Until deploy, commits, PR and this log use neutral wording in titles.
> **Numbers:** DECISION-230, F237–F238 if needed. Worktree `presby-sess`, Neon branch `pipeline-session-update` (`br-gentle-firefly-axtka600`), dev-server port 3460.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (brief) | READY WITH NOTES | 2026-10-24 |
| 2 — Architectural review | architect | Complete; request-scoped grant + route 405 + update branch reads nothing; HMAC fallback | Approved with suggestions | 2026-10-24 |
| 3 — Technical design | tech-lead | Skipped (bug-fix variant): the Phase 2 ruling is the design; root cause recorded | — | 2026-10-24 |
| 4 — Implementation | api-developer | Complete; grant propagates through `unstable_update` (no HMAC fallback needed); all gates green | — | 2026-10-24 |
| 5 — Verification | qa | Complete (run 2 after disk freed); failing-first reproduced; auth e2e + prod-lane hydration green; test:db 10,784 passed, 3 canary failures = Phase 4 leftover fixtures | PASS | 2026-10-25 |
| 6 — Shipped vs intent | analyst | Complete; defect no longer manifests; preserve-items hold; 8 follow-ups, release note drafted | SHIP WITH NOTES | 2026-10-25 |

---

# Phase 1 — Functional Refinement (analyst) — bug-fix variant, brief

## VERDICT

**READY WITH NOTES.** The bug is real and the fix is small. The notes below are Phase 2 and 3 inputs.

## ONE-LINE TAKE

> The sign-in session's "second factor verified" claim can be set by the signed-in browser itself, so a session that has passed only the first factor can pass the 2FA gates. The fix must make the claim writable only by the server-side TOTP and recovery-code paths, and members should see no change.

## Bug confirmation

The bug is confirmed from code.

- **The jwt callback honours the client-supplied claim.** `src/auth.ts:261-264` copies a boolean `twoFactorVerified` from the update payload into the token. The session's own signed cookie is the only precondition.
- **The update route is open to the browser.** `POST /api/auth/session` is exposed by `src/app/api/auth/[...nextauth]/route.ts`. In `node_modules/@auth/core/lib/index.js:59`, its only gate is the CSRF double-submit token. The signed-in browser can always obtain that token. The route then passes `request.body.data` straight to `callbacks.jwt({trigger:"update", session})`.
- **Server-side updates take the same path.** `unstable_update` (`node_modules/next-auth/lib/actions.js:73`) builds a POST to the same action with CSRF skipped. The jwt callback receives only `{token, trigger, session}`, so it cannot tell a server-side call from a browser POST. A fix inside the callback therefore needs a server-only capability that the browser cannot supply.
- **Roles and features are not exposed.** The `roles` and `features` payload is overwritten from the database by `needsRoleRefresh` (`src/auth.ts:306`), which is true on `trigger === "update"`. `twoFactorVerified` has no such refresh. It is the only client-settable authority claim.
- **Claims set at sign-in.** `src/auth.ts:244` sets `twoFactorVerified = false`, so every session starts unverified. The first factor alone gives a claim of `false`, and the claim can then be flipped from the client.
- **Other claims.** `sub`, `email`, `isActive` and `twoFactorRequired` are not read from the update payload. They are recomputed from the database on every run (`:283-304`). No other claim is client-settable.

**Gates that trust the claim (all verified):**

- `src/proxy.ts:144-154`, which covers `/admin*` and `/o/*`. Neither `/home` nor `/account` is behind it.
- `src/app/(admin)/admin/layout.tsx:13`.
- `src/app/(invite)/actions.ts:225` and `src/app/(invite)/invite/page.tsx:78`. The invite gate matters because it guards granting authority to an account.
- `src/lib/giving/access-pure.ts:55`. It is consumed by the giving pages and the giving routes (statement downloads, gifts export, statements print). Treasurer tier-2 giving data therefore sits behind this claim too.
- The 2FA-required branch is the only one affected. A user with no 2FA requirement is unaffected.

## Legitimate callers of `unstable_update` in `src/` (exhaustive)

| Caller | Payload | Needs |
|---|---|---|
| `src/app/(auth)/totp/actions.ts:85` (six-digit TOTP verified) | `{user:{twoFactorVerified:true}}` | **The claim write. Must keep working.** |
| `src/app/(auth)/totp/actions.ts:129` (recovery code consumed) | `{user:{twoFactorVerified:true}}` | **The claim write. Must keep working.** |
| `src/app/(invite)/actions.ts:252` (invite accepted) | `{user:{}}` | Refresh only. It re-issues the cookie with a recomputed `twoFactorRequired` and roles. |
| `src/app/(admin)/admin/users/actions.ts:26` (self role change) | `{}` | Refresh only. |

- Nothing else in `src/` calls `unstable_update`. `(account)/account/actions.ts:50` is only a TODO comment.
- **Enrolment (`/account/2fa`) never writes the claim.** After enrolling, the user goes through `/totp` and verifies. The fix must not change this.
- **No browser code uses the session-update route.** There is no `next-auth/react` import anywhere in `src/` or `e2e/`: no `useSession`, no `SessionProvider`, no client `update()`.
- **Test gap.** The existing tests only mock `unstable_update`. No test calls the jwt callback with `trigger:"update"`. This is the coverage gap the review named, and it explains how the bug survived.

## Other effects of a browser-triggered `trigger:"update"`

- **Isolation and activity.** It cannot affect `isActive` or `sub`. A deactivated or deleted user still gets an empty token.
- **Role and features rewrite.** It cannot grant or widen roles or features. They are re-read from the database, not taken from the payload. Because `trigger === "update"` is true, any browser POST reruns the role and feature queries (up to about 4 database reads) and re-signs the cookie. This is a minor cost amplification and not an authority issue.
- **Self-downgrade.** A client can also send `false`, which un-verifies its own session. This only hurts the user, but a fix that validates the value (not just the source) closes it.
- **Roles overwrite.** The `Array.isArray(session.user.roles)` and `features` assignments run before the DB refresh and are always overwritten. They are dead, misleading code. The fix should remove them so no reviewer reads them as a client-settable path.

## Behaviour that must be preserved

1. TOTP verify and recovery-code verify still complete the session. The cookie is re-issued with `twoFactorVerified:true` and the user lands on `callbackUrl`.
2. Enrolment still hands off to `/totp` and does not set the claim.
3. Sessions already holding `twoFactorVerified:true` stay verified. No forced sign-out and no forced re-verification, so the claim name and token shape stay unchanged. Existing cookies carry the claim as is.
4. The refresh-only updates (invite accept, self role change) keep re-issuing the cookie with recomputed `twoFactorRequired`, roles and features.
5. Per-request deactivation, stale-JWT and role-refresh behaviour are unchanged.
6. No new failure modes at sign-in or login (Google or credentials).

## User-visible impact

None is intended. Only the browser-facing session-update route changes behaviour. Members, admins and invitees use the same pages and flows.

## Flows

- **Flow 1 — TOTP.** `/totp` → enter code → server verifies → claim set → redirect to `callbackUrl`. Failure: the existing `?error=invalid` redirect.
- **Flow 2 — Recovery code.** Same path as Flow 1.
- **Flow 3 — Update from the browser.** After the fix, a direct session-update POST must not change the claim. Whether the route is rejected, the update is ignored, or the request is neutralised is a design choice.

## Permissions & Flags

- **Permission(s):** none new.
- **Flag(s):** not needed. This is a security fix and must not be toggleable. Auth-critical, so no `isFlagEnabled`.

## Adversarial pass

- **Self-targeting and shortcut.** This is the defect itself: a user bypasses a required step. It is a gap and the subject of the fix.
- **Redirects.** The TOTP `callbackUrl` handling was not part of this review and is untouched.
- **Residual: no per-session proof.** The claim is a bare boolean in a JWT. Server-side-only writes are the right fix, but the session store has no per-session proof. This is existing design, not a new gap.
- **Other writers of `token.*`.** The server paths are fixed. Other claims are database-derived, so no other client-writable claim exists.

## Gaps the Request Didn't Address (for Phases 2-3)

1. **Fix shape.**
   - **Server-only capability.** The jwt callback cannot see request origin. The candidate fix is a server-only marker set by `totp/actions.ts` immediately before `unstable_update` and checked and cleared in the callback (AsyncLocalStorage or an equivalent per-request capability). A browser POST runs in a separate request and cannot carry it.
   - **Layered, optional.** Also reject `POST /api/auth/session` at the route handler or proxy. Nothing in the app uses it, so rejecting it breaks no flow. It needs a neutral response and must not leak existence. Defence in depth is cheap, but the callback fix is the real one and must not depend on the route block alone.
2. **Untrusted existing claims.** Existing tokens cannot be audited. A forged claim leaves no mark in `audit_events`. Whether any prior misuse occurred is undetectable. This matters for the work-log's post-deploy wording (neutral until deployed). The team should decide whether to bump anything (for example a claim-version rotation) to invalidate old tokens. That would force re-verification and break behaviour 3, so it needs an operator decision. Default: do not rotate.
3. **Regression test.** A jwt-callback unit test with `trigger:"update"` and a client-shaped payload must show the claim is not changed, plus a test that the server path still sets it. An e2e smoke is required on the auth path: full login including an MFA-enrolled user, and a direct session-update POST that must not change gating. Phase 5 is stricter on this (a skipped e2e gives BLOCKED).
4. **Audit.** Consider whether a rejected claim write should write an audit row. Suggest a `warn`-level log without a new audit action unless the tech-lead wants one. It is security-sensitive, but an unauthenticated-style spam path should not write audit rows.
5. **Misleading dead code.** Remove the `roles` and `features` merges in the update branch (`src/auth.ts:265-270`) in the same change, or document them as overwritten.
6. **Stale comment.** The `src/app/(admin)/admin/users/[id]/actions.ts:76` comment and the `src/auth.ts:258` comment describe the old behaviour ("e.g. 2FA verified, role assigned"). Update them with the fix.

## Starter-derived sibling repos

The other repos seeded from the same starter are probably affected, since they inherit this jwt callback and the session route. Neither was read. After deploy, a downstream-sync item and a heads-up for those repos' owners are warranted. Phrase it neutrally until this repo's fix is deployed.

## Out of Scope (confirm with user)

- Rotating or invalidating existing sessions (see Gap 2).
- A server-side session store, or binding verification to a per-session id.
- Any redesign of the 2FA gate or the proxy.

## Open Questions

- Rotate existing sessions? Default no, per behaviour 3. Operator ruling needed only if the answer is yes.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-24 |

## Handoff

Next is Phase 2, the **architect**. It needs to rule on the capability mechanism in the jwt callback, which is the core of the fix, and on whether to add a layered route rejection. Phase 4 needs an e2e smoke with an MFA-enrolled user, and Phase 5 will not PASS without it.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The ruling below is binding on Phase 3. The suggestions are the CLAUDE.md line and the follow-ups.

The mechanism is a server-side grant scoped to the request, plus a block on the route, with the update branch reading nothing from the payload. Candidate (a) is the approved fallback. Candidate (b) is rejected for this fix.

## Placement

- **Directory placement:**
  - **New: `src/lib/auth/two-factor-grant.ts`.** It holds a module-level `AsyncLocalStorage<{ userId; method: "totp" | "recovery"; consumed: boolean }>` and exports two functions:
    - `withTwoFactorGrant(userId, method, fn)`
    - `takeTwoFactorGrant(tokenSub): boolean`, which returns true once, only when the store is present, not consumed, and `store.userId === tokenSub`.

    The module starts with `import "server-only"`. **It must never be exported from, or wrapped by, a `'use server'` module.** Every exported async function in such a file is an action endpoint the browser can call, so a `'use server'` `grantTwoFactor(userId)` would rebuild this defect.
  - **`src/auth.ts`, update branch (lines 258–271).** Delete all three payload merges: `twoFactorVerified`, `roles` and `features`. After the `dbUser` active check, set `token.twoFactorVerified = true` only when `trigger === "update" && takeTwoFactorGrant(userId)`. Nothing ever sets it to false except the sign-in reset at line 244, which stays. Rewrite the comments at 258–260 and 278–280 to match.
  - **`src/app/(auth)/totp/actions.ts:85` and `:129`.** Replace each call with `await withTwoFactorGrant(session.user.id, "totp" | "recovery", () => unstable_update({}))`. `redirect()` stays outside the grant, because it throws.
  - **`src/app/api/auth/[...nextauth]/route.ts`.** `GET` stays `handlers.GET`. `POST` becomes a wrapper:
    - It answers `405` with `Allow: GET` and no body or cookie when the pathname is exactly `/api/auth/session`.
    - Everything else goes to `handlers.POST` (`/callback/credentials`, `/signin/google`, `/signout`).
    - This is in-route defence-in-depth, not a proxy change. The proxy passes `/api/*` through on platform hosts (`src/proxy.ts`, `pathname.startsWith("/api/")`) and should stay a pure function of host, path and claims. Custom hosts already 404 this path (`e2e/custom-domains/lockdown.spec.ts:82`).
  - **Optional:** `src/app/(invite)/actions.ts:252` `{ user: {} }` becomes `{}`, for consistency.
- **Server vs Client split:** server only. No `'use client'` is touched.
- **Dependencies:** none new. `node:async_hooks` is built in, and `src/auth.ts` already runs only on Node (no `runtime = "edge"` anywhere in `src/`). `src/lib/auth/config.ts` must not import the grant module. The proxy reaches only `config.ts`, and `check:proxy-imports` backs that up.

### Why this mechanism (facts checked on `@auth/core` 0.41.3 / `next-auth` 5.0.0-beta.32)

- **`trigger` cannot tell the two callers apart, but they arrive differently.**
  - A browser `POST /api/auth/session` goes through the route handler, passes CSRF, then reaches `actions.session(..., isUpdate=true, body.data)`, which calls `callbacks.jwt({ trigger: "update", session: data })`. This is `node_modules/@auth/core/lib/index.js:57-59` and `lib/actions/session.js`.
  - `unstable_update()` calls `Auth()` **in-process** with a Request it builds itself and `skipCSRFCheck` (`node_modules/next-auth/lib/actions.js:73-85`). It never touches the route handler. It reads `headers()` and `cookies()`, so it runs inside the action's request context, and it awaits `Auth()` directly, so async context reaches `callbacks.jwt`.
- **What follows from that:**
  1. The route block (c) shuts out the browser and does not affect `unstable_update`.
  2. A store scoped to the request is a capability that is not data. Nothing is serialized, so there is nothing to capture, replay, expire, rotate or key-manage. Binding comes for free: the same request means the same cookie means the same token, and the `userId` check covers the rest.
  3. If context ever stopped propagating (a Next or Auth.js upgrade), the failure is **fail-closed**: verification does not stick and the user loops on `/totp`. `totp-full-login.spec.ts` catches that at once.
- **(a), the HMAC proof, is the approved fallback** if Phase 4 shows the grant does not propagate. In that case it must meet all of these:
  - The key is derived from `AUTH_SECRET` with a versioned domain label.
  - The MAC covers `sub`, a custom per-session `sid` claim minted at sign-in, the purpose, and an expiry of 60 s or less.
  - It is compared with `timingSafeEqual`.
  - It is never accepted alongside a raw boolean.

  Do not bind to `jti`: Auth.js mints a new one on every encode (`@auth/core/jwt.js:59`). Getting `sid` into the action means extra cookie and salt plumbing with `getToken`, which is a main reason (a) is second choice.
- **Why (b) is rejected for this fix:**
  - A per-user `users.two_factor_verified_at` is unsound. Any later verification on the owner's device would vouch for an older session on another device, whatever the timestamp comparison.
  - A correct version has to be per session: a schema change, a write on every verification, and a read on every request (the existing read loads only `isActive`, `twoFactorRequired` and `email`, so it is not free). Its real payoff is revocation, which belongs to the existing known gap at `src/app/(admin)/admin/users/[id]/actions.ts:76`, not to this defect. It is recorded as a follow-up.
- **Roles and features: no exploitable window today**, but by luck of structure:
  - Payload arrays assigned at 265–270 are overwritten in the same call, because `needsRoleRefresh` is true for `trigger === "update"` (line 306).
  - A database error throws, and the session action then clears the cookie.
  - On the `!token.sub` early return (line 281), a payload-written `roles` *would* be encoded, but `projectJWTOntoSession` drops every claim when `sub` is missing. So neither the proxy nor `auth()` sees it.

  Safety therefore rests on two distant facts. Deleting the merge removes the dependence. **Ruling: the update branch accepts nothing from the payload.** Every legitimate caller (`(invite)/actions.ts:252`, `(admin)/admin/users/actions.ts:26`) only wants the refresh, and `trigger === "update"` already causes it.
- **Client use of `update()`:** none. There is no `useSession`, `SessionProvider` or `next-auth/react` anywhere in `src/`. The only HTTP consumer of `/api/auth/session` is a `GET` in `e2e/support/global-setup.ts:188`. The route block breaks nothing.

## Invariants Touched

- **The Proxy Does Not Reach the Database (DECISION-177).** Unchanged in mechanism. The proxy still reads only the claim. This fix is what makes that claim trustworthy, which is a premise DECISION-177 relies on. The other Node-side readers (`(admin)/admin/layout.tsx:13`, `(invite)/invite/page.tsx:78`, `(invite)/actions.ts:225`, `src/lib/giving/access-pure.ts:55`) are fixed by the same change.
- **DECISION-026.** Untouched. `twoFactorRequired` is still worked out from the database on every run through `computeEffectiveTwoFactor`, and fails to the already-resolved requirement. Only the *verified* half changes.
- **Permissions vs Flags.** No `FEATURES.*` or flag change. The grant is not a credential in the DECISION-147/183 sense and must not be mapped into `FEATURES.*`, the resolver, or any session claim other than `twoFactorVerified`.
- **Audit (Workflow Rule 7).** No new action. `TOTP_VERIFY_SUCCEEDED` and `TOTP_RECOVERY_SUCCEEDED` are already written before the update. `check:audit` must stay clean.
- **Session fixation / sign-in.** The line 244 reset on each new sign-in stays. The cookie is AUTH_SECRET-encrypted JWE and cannot be planted.
- **Multiple tabs / token rotation.** The claim lives in the shared cookie and is re-encoded each request, so this is unchanged. A concurrent in-flight request can still write back an older, unverified cookie and send the user to `/totp` once more. That is pre-existing and fail-closed, not a security issue.
- **Enrolment.** `completeEnrollment` (`(account)/account/2fa/actions.ts:72`) does not set the claim today and must not start to. If a future design wants enrolment to count as verification, it uses the same grant.
- **Sign-out / other sessions.** Unchanged. The known gap at `(admin)/admin/users/[id]/actions.ts:76` remains (see follow-ups).
- **Suggested CLAUDE.md change** (operator approval needed; I do not author it). Add one sentence under *The Proxy Does Not Reach the Database*: "Because the proxy trusts the session's 2FA claim, that claim is set only inside a server-side verification grant (`src/lib/auth/two-factor-grant.ts`); the jwt callback's update branch reads nothing from the update payload (DECISION-230)." `docs/architecture.md` needs no change.

### Proposed DECISION-230 (architectural; the orchestrator records it at integration)

> **DECISION-230 — The session's 2FA claim is set only inside a server-side verification grant; the jwt callback's update branch reads nothing from the update payload; client session updates are refused at the route.**
>
> - The TOTP and recovery verification action wraps `unstable_update({})` in `withTwoFactorGrant(userId, method, …)`, an `AsyncLocalStorage` scope in a `server-only` module.
> - The jwt callback sets `twoFactorVerified = true` only when a single-use grant for `token.sub` is active, and never accepts a boolean, roles or features from the payload.
> - `POST /api/auth/session` answers 405 at `src/app/api/auth/[...nextauth]/route.ts`. `unstable_update` calls `Auth()` in-process and does not go through the route.
> - An HMAC proof bound to a per-session `sid` is the approved fallback if the grant fails to propagate.
> - A database-backed per-session record is deferred to the revocation follow-up: a per-user column cannot tell sessions apart.
> - The grant helper must never be exported from a `'use server'` module.

## Notes

**Tests that must fail before the fix (Phase 4 writes them; Phase 5 checks the before and after):**

1. **`src/app/api/auth/[...nextauth]/route.test.ts` (new).**
   - `POST /api/auth/session` returns 405, with no `Set-Cookie`, and `handlers.POST` is never invoked. *Fails first.*
   - `POST /api/auth/callback/credentials` and `/api/auth/signout` are passed to `handlers.POST`.
2. **Callback test, `src/auth.session-update.test.ts` (new).** It drives the real `handlers.POST` from `@/auth`, deliberately skipping the route wrapper to prove the callback layer on its own.
   - **Setup:**
     - Mock `@/lib/db` and `computeEffectiveTwoFactor`.
     - Mint a real session cookie with `encode` from `next-auth/jwt`, salted with the cookie name.
     - Get a real CSRF pair from `handlers.GET /api/auth/csrf`.
     - Decode the returned cookie to make the assertions.
   - **Cases:**
     - (a) A payload carrying a verified boolean, with no grant, gives claim `false`. *Fails first.*
     - (b) A payload carrying `false` against a verified token leaves it `true`, so the payload is ignored both ways. *Fails first.*
     - (c) Payload roles and features end up equal to the database mock.
     - (d) Inside `withTwoFactorGrant` for the same user, the claim is `true`. This is the positive case and guards against a fail-closed regression.
     - (e) A grant for a different `userId` gives `false`.
     - (f) The grant is single-use within its scope.
3. **`src/app/(auth)/totp/actions.test.ts` (new; there is no unit test for this action today).**
   - A valid TOTP code and a valid recovery code each call `unstable_update` while a grant for the session user is active, with a payload that has no `twoFactorVerified`. *Fails first.*
   - Wrong code, malformed input and rate-limited input never call `unstable_update`.
4. **E2E against a running dev server (port 3460, Neon branch `pipeline-session-update`), `e2e/session-claim-integrity.spec.ts`.** Keep the file name neutral until deploy.
   - Steps, as `mfa-enrolled`:
     - Sign in with the password and land on `/totp`.
     - Through `page.request`, fetch the CSRF token and `POST /api/auth/session` with data. Expect 405. *Fails first.*
     - Go to `/admin` and expect to still be on `/totp`. *Fails first.*
     - `GET /api/auth/session` shows the claim false.
     - Enter the real code and expect to reach the destination.
   - The existing `e2e/totp-full-login.spec.ts`, `e2e/totp-callback-bypass.spec.ts` and `e2e/hydration/totp-challenge.spec.ts` must pass. Together these are the Phase 4 auth-e2e gate. Without them Phase 5 is `BLOCKED`.

**Gates:** `typecheck`, `build`, `npm run check` (all eight tripwires, especially `check:proxy-imports` and `check:audit`), `lint`.

**Disclosure hygiene:** commit titles, the PR, the release-note entry and test names stay neutral until deploy. The work-log describes the defect only at the level of "the session's 2FA claim could be influenced from outside the verification action."

**Follow-ups (not in this fix; add to `docs/TODO.md` at integration):**
- **Revocation of a verified claim** after an admin TOTP reset or sign-out elsewhere. This is the `users/[id]/actions.ts:76` gap and where a per-session server record, design (b), properly belongs.
- **F237 candidate (low).** Recovery-code consumption at `totp/actions.ts:109-122` is a read followed by an unconditional write, not a conditional `UPDATE … WHERE used_at IS NULL RETURNING`. Separately, a TOTP code can be reused within its window because no last-used step is recorded.

**Process note:** Phase 1 in the work-log is still the unfilled template and its status row says Pending. Record the analyst's brief bug-fix Phase 1 before Phase 3 advances. Nothing in this ruling depends on its outcome beyond confirming the defect, which I reproduced by reading the installed library code.

---

**Per-Phase Status row:**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-24 |

**Handoff:** to **tech-lead** for Phase 3. This is the bug-fix variant: a short design that records the root cause (the jwt update branch trusted a payload that reaches it by two routes, one of them a browser), works the ruling above into the API contract and implementation order, and names the implementer. I suggest **api-developer**, since the change is server-only across four files and three new test files plus one e2e spec.

---

# Phase 3 — Technical Design (tech-lead) — bug-fix variant, folded

**Skipped as a separate tech-lead pass (bug-fix variant, explicit notation).** The architect's Phase 2 ruling above is file-level and binding: it names the mechanism, the four files, the contract of `withTwoFactorGrant`/`takeTwoFactorGrant`, the route behaviour, and the failing-first tests. Writing it again as a design would add nothing. The orchestrator records the root cause here, as the bug-fix variant requires.

**Root cause.** The jwt callback's update branch trusted its payload. That payload reaches the callback by two routes: the server's own `unstable_update()`, and a browser `POST /api/auth/session` whose only check is a CSRF token the signed-in browser holds. `trigger === "update"` is the same for both, so the callback could not tell them apart. `twoFactorVerified` was the one claim not re-derived from the database afterwards. Inherited from the starter (`54f3935`); no test ever exercised the update branch (the test-coverage review's C-2, open since 2026-09-25).

**Implementer:** api-developer (server-only change, four files, three new test files and one e2e spec).

---

# Phase 4 — Implementation

Implemented exactly the Phase 2 ruling. The grant propagated through `unstable_update` on the first attempt (unit case (d) and the e2e "real code reaches the destination" both pass), so the approved HMAC fallback was **not** used.

## Files Created

- `src/lib/auth/two-factor-grant.ts` — `import "server-only"`; `AsyncLocalStorage` scope; `withTwoFactorGrant(userId, method, fn)` and single-use `takeTwoFactorGrant(tokenSub)`. Not exported from or wrapped by any `'use server'` module; `src/lib/auth/config.ts` does not import it.
- `src/lib/auth/two-factor-grant.test.ts` — scope, single-use, user-binding and concurrent-scope isolation.
- `src/app/api/auth/[...nextauth]/route.test.ts` — session endpoint answers 405 (`Allow: GET`, no body, no cookie, handler never called); other POSTs and GET pass through.
- `src/auth.session-update.test.ts` — drives the real `handlers` (real CSRF pair, real cookie encode/decode, mocked db); ruling cases (a)–(f).
- `src/app/(auth)/totp/actions.test.ts` — success paths update the session inside a grant for the session user with an empty payload; wrong, malformed, rate-limited and no-session paths never update.
- `e2e/session-claim-integrity.spec.ts` — `mfa-enrolled` user against a running dev server: a client-side session update is refused (405, no cookie), the gate is unmoved, the claim still reads unverified, and the real code still reaches `/admin`.

## Files Modified

- `src/auth.ts` — update branch no longer reads anything from the update payload (the three merges are deleted); `twoFactorVerified = true` only when `trigger === "update" && takeTwoFactorGrant(userId)`, after the active check; sign-in reset kept; stale comments rewritten.
- `src/app/(auth)/totp/actions.ts` — both success paths call `withTwoFactorGrant(session.user.id, "totp" | "recovery", () => unstable_update({}))`; `redirect()` stays outside the grant.
- `src/app/api/auth/[...nextauth]/route.ts` — `GET` unchanged; `POST` is a wrapper answering 405 + `Allow: GET` for exactly `/api/auth/session`, everything else to `handlers.POST`.
- `src/app/(invite)/actions.ts` — `unstable_update({ user: {} })` to `unstable_update({})` (consistency only).
- `src/app/(admin)/admin/users/[id]/actions.ts` — comment at the known-gap note updated to match.
- `vitest.config.ts` — `server.deps.inline: [/next-auth/]`. next-auth's ESM build imports `next/server` without an extension, which Node rejects when externalized; inlining lets a test drive the real handlers. Full suite unaffected (see gates).

## Schema Changes

none.

## Audit Events

No new action. `TOTP_VERIFY_SUCCEEDED` and `TOTP_RECOVERY_SUCCEEDED` are still written before the session update. `check:audit` clean.

## Failing-first record (run against the unmodified `src/auth.ts`, `totp/actions.ts` and route; the grant module existed as a new, unwired file)

- `route.test.ts`: 2 failed / 5 passed — `expected 200 to be 405` for the session endpoint (plain and with a query string).
- `auth.session-update.test.ts`: 4 failed / 2 passed.
  - (a) `expected true to be false`: a payload asserting the claim, no grant, set it.
  - (b) `expected false to be true`: a payload of `false` un-verified a verified token.
  - (d) and (f) `expected false to be true`: the grant had no effect (nothing consumed it). (c) and (e) pass on old code by design (roles/features were already DB-overwritten; a wrong-user grant is inert).
- `totp/actions.test.ts`: 2 failed / 5 passed — the success paths updated the session outside any grant, with a payload (`expected false to be true`).
- `e2e/session-claim-integrity.spec.ts` against a dev server on :3460 running the old code: failed at the first assertion, `Expected: 405 / Received: 200`.

After the change all of the above pass (24 tests across the four new unit files).

## Gates

- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). `npm run check`: all eight tripwires pass (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports).
- `npm test` (plain): 546 files passed, 77 skipped; 8346 tests passed, 2442 skipped, 0 failed.
- `npm run build`: pass.
- Auth e2e gate, dev server on :3460 (Neon branch `pipeline-session-update`): `session-claim-integrity`, `totp-full-login`, `totp-callback-bypass`, `totp-recovery-code`, `totp-code-entry`, `post-login-routing`, `invitation-existing-account` — 38 passed, 0 failed.
- Prod lane, `PW_PROD_PORT=3460 npm run test:e2e:prod -- e2e/hydration/totp-challenge.spec.ts`: 1 passed.

## Implementer Notes

- **`npm run test:db` was not completed.** On this Neon branch the DB-backed suites ran at roughly 20 s per query and timed out (calendar, filings, org-features, org-provisioning: 10 failures by timeout), then the run was stopped. None of those files touch the auth path; the DB-backed suites skip in plain `npm test`. QA should re-run `test:db` and treat any timeout in those four files as environmental unless it reproduces.
- A first e2e run after an unrelated lint/check pass failed on a stale Turbopack font cache in `.next` (a dev-server module-not-found for a generated font module); removing `.next` fixed it and the gate then passed in full. Not related to this change.
- The route's 405 is defence in depth only; the callback proof (cases (a)–(f)) deliberately bypasses it.
- The claim is unchanged in name and shape, so existing sessions are unaffected and nothing is rotated (Phase 1 default).
- Follow-ups from Phase 2 (revocation of a verified claim; F237 candidate on recovery-code consumption) are not in this change.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa (run 1 was blocked by host disk space; run 2 completed the outstanding checks after the disk was freed)
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-sess`, `pipeline/session-update-hardening` @ `4a3396f`. Neon branch `pipeline-session-update`. `git status` is clean at the end.

**Verdict: PASS.** Every required check is green. The only red result is the fixture-leak canary in `test:db`, which reports leftover rows from Phase 4's interrupted run and has nothing to do with this diff.

**What I ran:**
- **Static gates:** typecheck, lint, `npm run check`, plain unit suite, `npm run build` (twice).
- **New tests:** the four new unit files, verbosely.
- **Failing-first:** the new unit files against main's source.
- **`npm run test:db`:** the full set.
- **Dev lane:** the seven auth e2e specs against my own dev server on :3470.
- **Prod lane:** `e2e/hydration/totp-challenge.spec.ts` on :3471.
- **Path probes:** the session endpoint against both the dev server and `next start`.

**Not run:**
- the full chromium e2e suite (the diff touches none of the full-suite triggers; CI runs it on the PR)
- `scripts/test-rls.sql` (no schema or RLS change)
- 360px (no UI change)

**Flag state:** before the e2e runs I reset this branch's global flags to the CI baseline: seeded defaults from `scripts/seed.ts`, then `scripts/ci/e2e-baseline-flags.sql`. The branch had been carrying about 25 extra flags that are on in development and off in CI. The pre-reset state is saved at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/flags-before.txt`. The branch is still at the baseline.

**Env values:** never printed; checked with `test -n` and by length only.

### Type Check

`npm run typecheck`: PASS. `npm run lint`: PASS (0 warnings). `npm run check`: PASS, all eight tripwires (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports). `npm run build`: PASS in run 1 and again, fresh, in run 2.

### Unit Tests

**Plain `npm test`:** 8346 tests passed, 0 failed, 2442 skipped, in 546 files passed and 77 skipped (26.1 s). This matches Phase 4. The skips are the DB-backed files, which skip without `.env.local`, and all of them ran under `test:db` below. The four new files: 24 of 24 pass.

**Failing-first, verified by running:**
- **Method:** I extracted HEAD into a throwaway scratch copy (since deleted) and overlaid main's `src/auth.ts`, `src/app/(auth)/totp/actions.ts` and `src/app/api/auth/[...nextauth]/route.ts`. The worktree itself was never modified.
- **Result:** 8 failed and 16 passed, exactly as Phase 4 recorded:
  - `route.test.ts`: 2 failed (`expected 200 to be 405`)
  - `auth.session-update.test.ts`: 4 failed, cases (a), (b), (d), (f)
  - `totp/actions.test.ts`: 2 failed, the two success paths
  - Case (c) and case (e) pass on the old code, as designed.

**`npm run test:db` (`--no-file-parallelism`):** 10,784 tests passed, 3 failed, 1 skipped, in 622 files passed and 1 failed (2001.8 s).
- **Timeouts:** none anywhere. Calendar, filings, org-features and org-provisioning all passed on the first run, so no retry was needed. Phase 4's timeouts did not reproduce: queries on the branch took about 0.3 s today.
- **The 3 failures are pre-existing branch data, not a regression.** They are the leak canary in `src/lib/db/fixture-deletable.test.ts` (`:199`, `:224`, `:271`). It found 7 people rows and 3 organization rows whose deletion window has closed.
  - **Origin:** all 10 come from `src/lib/role-definitions.test.ts`. The slug epoch `1792848969576` decodes to 2026-10-24T13:36Z, and the rows' `deletable_until` values fall between 15:36:09Z and 15:36:13Z that day. That is Phase 4's `test:db` run, which the work-log records as stopped partway, so its `afterAll` never ran.
  - **Today's run leaked nothing:** `role-definitions.test.ts` passed, and the branch has no other stamped rows.
  - **Effect:** these rows exist only on the pipeline Neon branch. They are permanent there by design (the delete guard) and disappear when the branch is deleted at cleanup. A retry would fail identically, because the canary reads data, not timing.
  - **Diff:** touches no DB code or fixtures.

### End-to-End Tests

**Dev lane:** my own `next dev -p 3470`, started with the `playwright.config.ts` webServer env, with `E2E_BASE_URL=http://localhost:3470` and `--project=chromium`.

**Run 1:** 38 tests, 37 passed, 1 failed, 0 skipped (3.1 m). Per spec:

| Spec | Tests |
|---|---|
| session-claim-integrity | 1 |
| totp-full-login | 1 |
| totp-callback-bypass | 7 |
| totp-recovery-code | 2 |
| totp-code-entry | 11 |
| post-login-routing | 12 |
| invitation-existing-account | 4 |

The full login path for the MFA-enrolled seeded user (password → TOTP → landing) and the recovery-code path both passed.

**The one failure was environmental:** `e2e/invitation-existing-account.spec.ts:80` ("Case A, no MFA") timed out at `:103`.
- **What the log shows:** 751 `✓ Compiled` events and 786 identical `GET /invite` requests inside that one test. That is a hot-reload loop driven by the file watcher.
- **Host cause:** it happened during the disk-fill episode, with `fseventsd` at about 170% CPU.
- **Not this change:** the failing step is the anonymous view of `/invite`, before any session update.
- **Rerun of that file:** 4 passed, 0 failed (23.0 s), with no recompile events.

**Prod lane:** `PW_PROD_PORT=3471 npm run test:e2e:prod -- e2e/hydration/totp-challenge.spec.ts` passed, 1 of 1 (13.6 s).
- The first attempt failed before any test ran: `browserType.launch: Executable doesn't exist` (`chromium_headless_shell-1223`). The disk cleanup had removed the Playwright browser cache.
- I reinstalled the pinned build with `npx playwright install chromium` (Playwright 1.60.0). That writes only to `~/Library/Caches/ms-playwright`, not the repo. Then I re-ran.

**Path variants of POST `/api/auth/session`** (no session cookie, real CSRF pair). The production server (`next start -p 3471`) and the dev server gave identical results:

| Path | Result |
|---|---|
| `/api/auth/session` | 405, `Allow: GET`, empty body |
| `/api/auth/session?x=1` | 405 |
| `/api/auth/./session` | 405 |
| `/api/auth/session/` | 308 to the canonical path |
| `/api/auth//session` | 308 to the canonical path |
| `/api//auth/session` | 308 to the canonical path |
| `%73ession`, `Session`, `session/extra`, `session;x`, `session%2F`, `%2Fsession` | 400 (Auth.js unknown action) |

- Following the 308s with `-L` ends at 405.
- No variant set a session cookie.
- `GET /api/auth/session` still answers 200.
- **Note for the record:** Auth.js drops empty path segments (`@auth/core/lib/utils/web.js`, `parseActionAndProviderId`, `filter(Boolean)`). The route's exact-match check is therefore complete only because Next normalises slashes first; `next.config.ts` sets no `trailingSlash` or `skipTrailingSlashRedirect`. If either setting is ever added, this check should be revisited. The jwt-callback layer doesn't depend on it: case (a) passes against the real handlers with the route wrapper bypassed.

### Regression Tests Added

The implementer wrote these; I wrote none.

- `(a) a payload asserting the 2FA claim, with no grant, leaves it false`, `src/auth.session-update.test.ts:123`. Guards against the update payload setting the claim. Drives the real Auth.js handlers and bypasses the route wrapper. Watched failing on main.
- `(b) … false never un-verifies a verified token`, `:129`. Guards against the payload changing the claim in the other direction. Watched failing.
- `(c) payload roles and features never reach the token`, `:135`. Locks in the deleted merges. Passes on old code by design.
- `(d) inside a verification grant for the same user, the claim is set`, `:144`. Guards against a fail-closed regression if async context stops propagating. Watched failing.
- `(e) a grant for a different user does not set the claim`, `:152`. Covers user binding.
- `(f) a grant is single-use within its scope`, `:160`. Watched failing.
- Session-endpoint 405, `src/app/api/auth/[...nextauth]/route.test.ts:26` and `:35`. Watched failing. Pass-through of the other POST paths is covered at `:41`.
- Success paths update the session inside a grant with an empty payload, `src/app/(auth)/totp/actions.test.ts:92` and `:100`. Watched failing. The refusal paths at `:108–:130` guard against an update on a wrong, malformed, rate-limited or session-less attempt.
- `src/lib/auth/two-factor-grant.test.ts:10–:31`: absent outside a scope, single-use, user-bound, isolated between concurrent scopes.
- `e2e/session-claim-integrity.spec.ts:18`. Its failing-first is accepted from the Phase 4 record, not re-run: on main it stops at its first assertion (405), so its later "gate unmoved" assertions never ran against the old code. The live-handler proof of the callback layer comes from case (a), and I re-ran that against main.
- **Property, not implementation:** case (a), case (c) and the e2e's three payloads assert that the claim and the gate don't move, rather than checking a key list.
- **Naming:** none of these names carries the `— regression for …` suffix. That is consistent with the neutral naming the pipeline asked for until deploy, and it can be added afterwards.

### Coverage on Critical Modules

Not re-measured. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`, so their last-review figures stand. Every branch of the new `src/lib/auth/two-factor-grant.ts` is exercised by its own test: no store, consumed, wrong user, and success.

### Adversarial reading

- **Who can open a grant:** only the two success paths at `src/app/(auth)/totp/actions.ts:86` and `:132`.
  - Both sit after the TOTP or recovery-code check and after the audit row.
  - `redirect()` sits outside the grant.
  - The grant helper is not exported from any `'use server'` module.
  - `src/lib/auth/config.ts`, and therefore the proxy, does not import it.
  - `handlers` is exposed by one route only.
- **Single-use and user-bound:** yes. The callback calls `takeTwoFactorGrant(userId)` only when `trigger === "update"` (short-circuit) and after the active-user check (`src/auth.ts:292`).
- **Other `unstable_update` callers:** behaviour is unchanged. `(invite)/actions.ts:252` (`{user:{}}` to `{}`) and `(admin)/admin/users/actions.ts:26` only ever wanted the refresh, which `trigger === "update"` still forces. `invitation-existing-account` passed 4 of 4.
- **Sign-in reset:** still present at `src/auth.ts:244`.
- **Session projection:** `projectJWTOntoSession` reads only the token.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/auth/[...nextauth]` (`route.ts`) | n/a: public Auth.js endpoint by design; the change narrows it (405 on `/session`) | n/a | n/a |
| `GET /api/auth/[...nextauth]` | unchanged (`handlers.GET`) | n/a | n/a |
| `verifyTotpAction` (`(auth)/totp/actions.ts`) | yes (`:29`); plus enrolment check and per-user rate limit | n/a: first-factor session action, not a feature surface | n/a |
| `acceptSignedInAction` (`(invite)/actions.ts`) | yes (`:219`); 2FA gate at `:225` unchanged | n/a: authority comes from the invitation credential (DECISION-183) | n/a |
| `forceResetTwoFactor` (`(admin)/admin/users/[id]/actions.ts`) | comment-only change; gating not altered | — | — |

No protected platform route was added or loosened.

### Verdict

**PASS.** This is an auth-touching diff and the stricter gate is met. The auth e2e set ran against a real dev server with the MFA-enrolled seeded user and the full password → TOTP → landing path passed, and so did the prod-lane hydration spec. Every spec passed, the one case after its single environmental rerun. Everything else is green: the static gates, the build, the unit suite, the failing-first reproduction and the 405 matrix on both servers. The `test:db` canary result is pre-existing branch data with the evidence above.

**Notes for the orchestrator (not defects in this diff):**
- **The canary will keep failing on this branch.** The leaked rows from Phase 4's interrupted run can't be removed, by design. Deleting the branch at cleanup clears them (standing authorization; never `development` or `production`). An interrupted `test:db` leaves permanent rows on any branch it runs against, so a stopped run is worth treating as a cleanup event.
- **`AGENTS.md` gets rewritten by `next dev`.** In run 1, Next 16's agent-rules generator rewrote one heading in the tracked `AGENTS.md` (`#` to `##`). I restored it with `git checkout -- AGENTS.md`, the only file operation I made in the worktree. `next start` did not rewrite it. Every dev-server run will hit this. It's a Trivial fix: commit the generator's form, or set `agentRules: false`.
- **The qa agent file names the wrong script.** It refers to `scripts/ci/e2e-reset-flags.sql`, but the file is `scripts/ci/e2e-baseline-flags.sql`, and the real CI baseline is seeded defaults plus that script.
- **Optional tidy in `src/auth.ts:239`.** The jwt callback still destructures `session`, which nothing reads. Removing it would make "reads nothing from the payload" visible from the code itself.
- **Servers and ports.** I stopped every server I started by PID (6916/6932/6933/6947 and 7846/7849 on :3470; 15418 on :3471). The prod lane's own :3471 server was stopped by Playwright. I never touched :3000 or :3100.

**Per-Phase Status row:**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. Failing-first reproduced (8 of 24 fail on main). Auth e2e (38, one environmental rerun) and the prod-lane hydration spec green. `test:db` 10,784 passed; the 3 canary failures are leftover fixtures from Phase 4's interrupted run. 405 matrix verified on dev and `next start`. | PASS | 2026-10-25 |

**Handoff:** to **analyst** for Phase 6 (shipped vs intent). Keep the commit, PR and release-note wording neutral until deploy.

---

# Phase 6 — Shipped vs Intent (analyst)

Bug-fix variant. Reviewed at HEAD `4a3396f` plus the uncommitted Phase 5 work-log update. I read the diff (`git diff main...HEAD`), the Phase 1, 2, 4 and 5 text, `docs/TODO.md`, and the e2e spec headers. I ran nothing and wrote nothing. The 360px and browser evidence below is QA's, not mine; see Edge Cases.

## VERDICT

**SHIP WITH NOTES.** The defect no longer manifests and every Phase 1 "must preserve" item holds. The notes are follow-ups that need TODO lines and a few things to do at integration and after deploy. None of them is a defect in this diff.

## ONE-LINE TAKE

> A session that has passed only the first factor can no longer set its own "second factor verified" claim by any client path, the real TOTP and recovery-code paths still reach the destination, and members see no difference.

## What's Working

- **The root cause is removed at the callback, not just hidden at the route.**
  - The update branch in `src/auth.ts` no longer reads anything from the payload. The three merges (`twoFactorVerified`, `roles`, `features`) are deleted.
  - `twoFactorVerified = true` is set only when `trigger === "update" && takeTwoFactorGrant(userId)`, after the active-user check.
  - Nothing sets the claim to `false` except the sign-in reset at `:244`, which is kept.
  - The 405 at `POST /api/auth/session` is defence in depth. QA's case (a) drives the real handlers with the route wrapper bypassed and still leaves the claim `false`.
- **Both client-reachable paths are closed.**
  - Browser POST to the session route: 405, `Allow: GET`, no body, no cookie. Every path variant QA probed on dev and on `next start` either returned 405, redirected to it, or returned 400. None set a cookie.
  - Server actions that call `unstable_update` without a grant (invite accept, self role change) now only refresh the cookie and cannot set the claim.
- **The grant is a capability, not data.**
  - It lives in `AsyncLocalStorage` in a `server-only` module, is single-use, and is bound to the token's `sub`. Nothing is serialized, so there is nothing to replay.
  - I confirmed in the diff that `withTwoFactorGrant` is imported by the `'use server'` file but not exported from it. `src/lib/auth/config.ts` and the proxy do not import it.
  - It opens in exactly two places, after the code check and the audit row: `totp/actions.ts` for TOTP and for recovery. `redirect()` is outside the grant.
- **A prod-lane run proves the legitimate path.** `e2e/hydration/totp-challenge.spec.ts` ran against `next build && next start` and completed a real code to `/admin`, with `totp.verify_succeeded` written once and no failed rows. That shows async context reaches the jwt callback in a production build, which was the one mechanism risk in Phase 2. If context ever stopped propagating, the failure is fail-closed (the user loops on `/totp`) and the e2e specs catch it.
- **The tests fail first and assert the property.**
  - 8 of 24 new tests fail on main's source.
  - Cases (a), (b) and (c) and the e2e assert that the claim and the gate don't move. They don't assert a list of keys, which meets the retro lesson on testing the property rather than the fix's shape.

## Intent-vs-Shipped Diff

- **Phase 1:** the claim must be writable only by the server-side TOTP and recovery paths. **Shipped:** a request-scoped, single-use grant checked in the callback, plus the route 405. **Verdict:** matches.
- **Phase 1:** TOTP verify and recovery verify still reach `callbackUrl` (behaviour 1). **Shipped:** both wrapped in the grant. Auth e2e `totp-full-login` (1), `totp-recovery-code` (2) and `totp-code-entry` (11) passed with the MFA-enrolled user. **Verdict:** matches.
- **Phase 1:** enrolment must not set the claim (behaviour 2). **Shipped:** `completeEnrollment` is untouched, so enrolment still hands off to `/totp`. **Verdict:** matches.
- **Phase 1:** already-verified sessions stay verified, with no rotation and no forced sign-out (behaviour 3). **Shipped:** the claim name and token shape are unchanged, and nothing is rotated. **Verdict:** matches. The security consequence is in Follow-Up 3.
- **Phase 1:** refresh-only updates keep re-issuing the cookie (behaviour 4). **Shipped:** invite accept and self role change now send `{}`, and `trigger === "update"` still forces the role and feature refresh. `invitation-existing-account` passed 4 of 4. **Verdict:** matches.
- **Phase 1:** deactivation, stale-JWT and role-refresh behaviour unchanged (behaviour 5). **Shipped:** the active-user check and `needsRoleRefresh` are untouched. **Verdict:** matches.
- **Phase 1:** no new failure modes at sign-in (behaviour 6). **Shipped:** the sign-in path is untouched, and `post-login-routing` (12) passed. **Verdict:** matches.
- **Phase 1:** no user-visible change. **Shipped:** no UI file is touched. The only browser-facing change is that `POST /api/auth/session` returns 405, and nothing in the app calls it. There is no `next-auth/react` use, and the only HTTP consumer is a `GET` in `e2e/support/global-setup.ts`. **Verdict:** matches.
- **Phase 1:** dead-code and stale-comment cleanup (gaps 5 and 6). **Shipped:** the merges are removed and the comments are rewritten at `src/auth.ts` and `(admin)/admin/users/[id]/actions.ts`. **Verdict:** matches.
- **Phase 1:** consider a `warn` log for a rejected claim write (gap 4). **Shipped:** none. The architect did not adopt it, and the 405 returns no body. **Verdict:** acceptable drift. A blocked probe leaves no trace, so Follow-Up 7 asks whether a one-line warn is wanted.
- **Phase 2:** the grant module, the request-scoped design, the callback change, the route wrapper and the failing-first tests as specified. **Shipped:** as ruled. The HMAC fallback was not needed. **Verdict:** matches.
- **Phase 2:** the optional `{ user: {} }` to `{}` change. **Shipped:** done. **Verdict:** matches.
- **Beyond the ruling:** `vitest.config.ts` gains `server.deps.inline: [/next-auth/]` so tests can drive the real handlers. The Phase 4 note says the full suite is unaffected, and plain `npm test` stayed at 8346 passed. **Verdict:** acceptable drift, test-only.

## Edge Cases

- Empty state: not applicable (no new surface).
- Failure microcopy: pass.
  - The wrong-code, malformed-input and rate-limited paths still produce the existing `?error=` redirects, and `totp/actions.test.ts` confirms they never update the session.
  - The 405 for a browser POST is an empty response. No member reaches it, and nothing leaks existence.
- Permission gate: pass. Every 2FA gate that reads the claim (the proxy on `/admin*` and `/o/*`, the admin layout, invite accept and its page, and the giving access gate) now trusts a claim that only the server-side verification can set. The e2e shows the gate unmoved after an attempted client update. No new `FEATURES.*` key, and the grant is not mapped into the resolver or into any other claim.
- Audit event: pass. No new action. `TOTP_VERIFY_SUCCEEDED` and `TOTP_RECOVERY_SUCCEEDED` are still written before the update, and `check:audit` is clean. The server-side flow keeps a record. A rejected browser probe does not, by design (see Follow-Up 7).
- Mobile (360px): not applicable. Phase 5 reports no UI change and no changed page. `/totp` is not modified, and `totp-challenge` is exercised in the prod lane. I did not browse at 360px myself, because this phase is read-only.
- Phase 6 walk as the created person: not triggered. The change doesn't alter how an account joins an organization, how a role is granted, or what a new account reaches. It only narrows what an un-verified session can reach. The relevant person is the MFA-enrolled member, and QA walked that path end to end against a real dev server and the prod build.

## Follow-Ups (SHIP WITH NOTES)

Each line is written as a TODO entry for `docs/TODO.md` (Workflow Rule 10), to be added in the integration commit.

1. `- [ ] **Revocation of a verified 2FA claim** after an admin TOTP reset or sign-out elsewhere: the target's session keeps \`twoFactorVerified: true\` until its JWT expires (about 30 days). The proper fix is a per-session server record, not a per-user column (Phase 2 rejected \`users.two_factor_verified_at\` because one device's verification would vouch for another device's session). Needs its own Phase 1 and a schema decision. — \`docs/work-log/2026-10-24-session-update-hardening.md\` Phase 2; \`src/app/(admin)/admin/users/[id]/actions.ts\` known-gap comment`
2. `- [ ] **F237 (low): recovery-code consumption and TOTP reuse.** \`totp/actions.ts\` reads a recovery code then writes \`used_at\` unconditionally. It should be one conditional \`UPDATE … WHERE used_at IS NULL RETURNING\`. Separately, a TOTP code can be reused inside its time window because no last-used step is recorded. A bug-fix pipeline, not part of the hardening fix. — \`docs/work-log/2026-10-24-session-update-hardening.md\` Phase 2 follow-ups`
3. `- [ ] **Operator ruling to record in DECISION-230: existing sessions are not rotated.** The fix stops new misuse but cannot show whether any session already carries an unearned verified claim, because a forged claim leaves no audit mark, and such a session stays verified for up to 30 days. Phase 1's default was "do not rotate" so no member is forced to re-verify. The operator should confirm that, or order a one-time claim-version rotation that forces a re-verify after deploy. Decide before or at deploy. — \`docs/work-log/2026-10-24-session-update-hardening.md\` Phase 1 gap 2`
4. `- [ ] **After 0.42.3 is deployed: disclosure and sibling hand-off.** (a) Commit the test-coverage review file \`docs/reviews/2026-10-24-test-coverage.md\` (finding C-1) and update the log line. (b) Run \`/downstream-sync\` for this change and give the owners of the repos seeded from the same starter a neutral heads-up that they likely inherit the same session-update path. (c) The PR and commit titles stay neutral until then. — \`docs/work-log/2026-10-24-session-update-hardening.md\``
5. `- [ ] **Post-deploy smoke of the 0.42.3 sign-in path on production:** an MFA-enrolled account signs in, enters a TOTP code and reaches its destination. The grant relies on async context reaching the jwt callback, which was proven on \`next start\` but not on the Vercel runtime. If it fails, it fails closed (a loop on \`/totp\`), and the approved fallback is the HMAC proof. — \`docs/work-log/2026-10-24-session-update-hardening.md\` Phase 2`
6. `- [ ] **Update the test-coverage punch-list item (7) at TODO.md:211** (\`src/auth.test.ts\` for the jwt callback): \`src/auth.session-update.test.ts\` now covers the update branch against the real handlers. The sign-in, stale-JWT and role-refresh branches are still untested, so reword the item rather than closing it. Also record the route check's dependency: \`/api/auth/session\` is matched exactly, which is complete only while \`next.config.ts\` sets no \`trailingSlash\` or \`skipTrailingSlashRedirect\` (Auth.js drops empty segments). Revisit if either is added. The jwt-callback layer does not depend on it. — Phase 5 notes`
7. `- [ ] **Decide whether a refused browser POST to \`/api/auth/session\` should log a warn line.** Phase 1 suggested a \`warn\` without a new audit action, but the 405 currently leaves no trace, so probing is invisible. Low priority; a log line only, never an audit row. — Phase 1 gap 4`
8. **QA's `qa` agent script name** (`scripts/ci/e2e-reset-flags.sql` should read `e2e-baseline-flags.sql`, with seeded defaults first): `- [ ] **Fix the qa agent's e2e flag-reset script name** in \`.claude/agents/qa.md\` (\`e2e-baseline-flags.sql\`, after the seeded defaults from \`scripts/seed.ts\`). Fold into \`retro-workflow-efficiency\` if it covers \`qa.md\`; otherwise a Trivial fix. — Phase 5 notes`

**Explicitly no action, with reasons:**

- **`AGENTS.md` rewritten by `next dev`.** Already owned by the `retro-workflow-efficiency` pipeline. No separate line unless that pipeline closes without covering it.
- **The unused `session` destructure at `src/auth.ts:239`.** Harmless, since lint passes, and the comment above the update branch already says the payload is ignored. Fold the deletion into the next touch of that callback if wanted.
- **Leaked fixtures on the Neon branch `pipeline-session-update`.** Permanent by design (delete guard) and cleared when the branch is deleted at cleanup under the standing authorization. The 3 `test:db` canary failures are those rows, not a regression. Treat an interrupted `test:db` as a cleanup event.

**For the orchestrator at integration (not TODO lines):**

- **Record DECISION-230** as the architect proposed, with the Follow-Up 3 operator ruling on rotation included.
- **CLAUDE.md:** the architect's one sentence under *The Proxy Does Not Reach the Database* needs the operator's explicit approval. I do not author it.
- **Functionality map and `docs/architecture.md`:** no update (Rules 14 and 15). This is neither a surface change nor architectural.
- **Feedback row (Rule 12):** none. This did not originate from member feedback.
- **Commit and PR:** keep titles neutral. The work-log's wording describes the defect only at the level the architect approved.

## Release Note Draft for 0.42.3 (patch)

For `docs/release-notes/v0.42.md`, in the table and the entry. The wording describes no mechanism.

Table row:
`| [0.42.3](#0.42.3) | 2026-10-25 | Security | A security update to how sign-in sessions are handled |`

Entry:

```
<a name="0.42.3"></a>
## 0.42.3 — 2026-10-25

**Security: a security update to how sign-in sessions are handled.**

**Value:** We hardened how the platform keeps track of a sign-in session, so a step that checks who you are can only be completed in the places meant to complete it.

#### What's New

- **Nothing should look different.** Signing in, entering your authenticator code, and using a recovery code all work as before, and you land where you did before.
- **You do not need to do anything.** You will not be signed out, and you will not be asked for a code again because of this update.
- **What changed behind the scenes.** The platform now accepts that a sign-in step is complete only from its own verification screens. Other requests to change a session's state are refused.
- **If anything looks off,** such as being sent back to the code screen after entering a correct code, please tell us with the feedback button.
```

Notes on the wording:

- It does not claim that existing sessions were re-checked or that nothing could have happened before. That fits the record, which admits that past misuse is undetectable and that sessions are not rotated (Follow-Up 3). If the operator chooses to rotate sessions, the "you will not be asked for a code again" line must change.
- The type is Security, matching 0.42.2.

**What's-new entry (Rule 13): not warranted.** There is no member-visible behaviour change, and a public what's-new note would only point attention at the change. The release note is enough.

## Red Flags

None.

---

**Per-Phase Status row:**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete. The defect no longer manifests by any client path. Legitimate TOTP and recovery verification reach the destination (dev e2e and prod-lane). All six Phase 1 preserve-items hold and there is no user-visible change. The Phase 2 ruling is honoured with no deviation. Eight follow-ups for TODO lines, three explicit no-actions, and the 0.42.3 release-note draft are above. A what's-new entry is not warranted. | SHIP WITH NOTES | 2026-10-25 |

**Handoff:** to the orchestrator for integration, in this order:

1. Get the operator's ruling on session rotation (Follow-Up 3) and on the CLAUDE.md sentence.
2. Record the Phase 6 section above, the Phase 1 section and the Per-Phase Status row in the work-log.
3. Add the TODO lines, DECISION-230 and the F237 finding.
4. Add the release note and bump to 0.42.3, then run `/pre-push` with neutral commit and PR titles and the `Work-Log: 2026-10-24-session-update-hardening` trailer.
5. After deploy, run Follow-Up 5 (the production smoke) and Follow-Up 4 (the disclosure and sibling hand-off).
6. Delete the Neon branch `pipeline-session-update` (`br-gentle-firefly-axtka600`) and the worktree at cleanup, which also clears the leaked canary rows.

Files read:

- `/Users/cshenso/git/presby-platform/presby-sess/docs/work-log/2026-10-24-session-update-hardening.md`
- `/Users/cshenso/git/presby-platform/presby-sess/src/auth.ts`
- `/Users/cshenso/git/presby-platform/presby-sess/src/lib/auth/two-factor-grant.ts`
- `/Users/cshenso/git/presby-platform/presby-sess/src/app/(auth)/totp/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-sess/src/app/api/auth/[...nextauth]/route.ts`
- `/Users/cshenso/git/presby-platform/presby-sess/e2e/hydration/totp-challenge.spec.ts`
- `/Users/cshenso/git/presby-platform/presby-sess/docs/release-notes/v0.42.md`
- `/Users/cshenso/git/presby-platform/presby-sess/docs/TODO.md`

