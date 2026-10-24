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
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
