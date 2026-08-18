# BUG-4: NextAuth `trustHost` unset — OAuth breaks behind non-Vercel proxies — Work Log

> **Slug:** `2026-07-01-nextauth-trusthost`
> **Surface:** (auth) / src/auth.ts
> **Permission(s):** none — no permission change
> **Flag(s):** not needed
> **Estimated complexity:** small (auth-touching — e2e gate applies)
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY FOR DESIGN | 2026-07-01 |
| 2 — Architectural review | architect | Skipped (explicit) | N/A — no new deps, schema, or structure | 2026-07-01 |
| 3 — Technical design | tech-lead | complete | Design complete — api-developer named | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | Config change + test + env — all gates green | 2026-07-01 |
| 5 — Verification | qa | complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-01 |

---

## Bug Report (intake, 2026-07-01)

The starter's NextAuth config (`src/auth.ts`) never sets `trustHost: true`, and
`AUTH_TRUST_HOST` appears nowhere in the env examples or docs. NextAuth 5 beta
only auto-trusts the request host on Vercel; behind any other reverse proxy
(Cloudflare tunnel, nginx, a container platform) it derives the *internal*
hostname when building OAuth callback URLs — producing OAuth state-verification
failures and redirect loops. The starter advertises platform-agnostic
deployment, so this is a real defect for every off-Vercel fork.

**Discovery trail:** surfaced by the 2026-07-01 sibling harvest
(`docs/reviews/2026-07-01-sibling-harvest.md` Tier 1 item 4). fpcw-directory
hit it in production (worst on older mobile Safari) and fixed it in commit
`e47322a` — `trustHost: true` in `src/lib/auth/index.ts:18`.

**Candidate fix direction (for tech-lead to confirm):** add `trustHost: true`
to the NextAuth options in `src/auth.ts` with a comment explaining the
off-Vercel proxy rationale, plus an `AUTH_TRUST_HOST` note in `.env.example`
documenting the tradeoff (trusting the Host header requires the proxy to set
it correctly). Consider whether the starter should instead document
`AUTH_TRUST_HOST=true` as env-only — the tech-lead decides config-vs-env and
records the security rationale.

**Auth-touching gate:** modifies `src/auth.ts` — the full e2e suite against a
live dev server is required before Phase 5 can PASS.

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Bug confirmed real. `src/auth.ts` has no `trustHost` anywhere. The installed
`@auth/core@0.41.2` (pinned by `next-auth@5.0.0-beta.31`) auto-enables
`trustHost` via `lib/utils/env.js` only when one of five signals is present:
`AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL`, `CF_PAGES`, or
`NODE_ENV !== "production"`. In dev, `NODE_ENV !== "production"` is true so
the bug is invisible locally. On Vercel, `VERCEL` is set so it's invisible
there too. The bug fires only in production on any other host (Kinsta, nginx,
container platforms) where none of those signals exist — producing a hard
`UntrustedHost` error from `assert.js:56` that blocks every OAuth request.
The fix is `trustHost: true` in code; the env-only alternative is documented
below with an honest tradeoff analysis.

### What I did

- **Pass 1 — Bug confirmed.** Grepped the entire starter for `trustHost` and
  `AUTH_TRUST_HOST`. Zero hits in source, `.env.example`, or docs — only in
  the work-log itself (work-log, sibling-harvest review, and TODO.md) as
  intake notes. `src/auth.ts` lines 65–241 confirm no `trustHost` key in the
  `NextAuth({...})` options object.

- **Pass 2 — Version behavior verified from installed package source.**
  `node_modules/@auth/core/lib/utils/env.js:40–44`:
  ```js
  config.trustHost ?? (config.trustHost = !!(
      envObject.AUTH_URL ??
      envObject.AUTH_TRUST_HOST ??
      envObject.VERCEL ??
      envObject.CF_PAGES ??
      envObject.NODE_ENV !== "production"
  ));
  ```
  `node_modules/@auth/core/lib/utils/assert.js:56–58`:
  ```js
  if (!options.trustHost) {
      return new UntrustedHost(`Host must be trusted. URL was: ${request.url}`);
  }
  ```
  This is a hard block — not a warning. Every OAuth callback returns an error
  when `trustHost` is false and the request is not from a trusted env.

- **Pass 3 — fpcw production incident confirmed.**
  Commit `e47322a` message: "fix: add trustHost for correct OAuth callback URL
  behind Kinsta reverse proxy. NextAuth requires trustHost: true when running
  behind a reverse proxy so it derives the public hostname (not the internal
  one) when building OAuth callback URLs. Mismatch caused state verification
  failures and redirect loops on some devices, particularly older mobile
  browsers." Fix was a single line: `trustHost: true` at `src/lib/auth/index.ts:18`.

- **Pass 4 — .env.example audit.**
  `AUTH_URL=http://localhost:3000` is already present and documented (lines
  9–11). Because `AUTH_URL` being set auto-enables `trustHost`, a deployer
  who correctly sets `AUTH_URL=https://myapp.com` in production avoids the
  bug via the env signal. The existing comment does not make this protection
  explicit. `AUTH_TRUST_HOST` is absent entirely. `TRUST_PROXY_HEADERS` is
  present (lines 80–86) but is for rate-limit IP extraction, not for OAuth
  host trust — these are separate mechanisms that must not be conflated.

- **Pass 5 — Cloudflare tunnel dev setup (user memory).**
  trycloudflare.com tunnels do NOT set `CF_PAGES` (that flag is Cloudflare
  Pages hosting, not tunnel access). However, `NODE_ENV !== "production"` is
  true in dev regardless of tunnel use, so local dev behind a Cloudflare
  tunnel is unaffected. The dev surface is safe; only production is broken.

- **Tradeoff framed for tech-lead:**

  | Approach | How it works | Risk | Fork-and-go? |
  |----------|-------------|------|--------------|
  | `trustHost: true` in code | Always trusts Host header | Host-header injection if proxy doesn't pin Host — standard proxy hygiene; same risk Vercel accepts via `VERCEL` env auto-trust | Yes — works with zero env config |
  | `AUTH_TRUST_HOST=true` in env | Deployer opts in | Deployer must know to add it; off-Vercel forks hit the bug first and debug backward | No — requires doc-awareness |
  | `AUTH_URL` clarification only | Existing env path, strengthen docs | Same doc-awareness problem; `NEXTAUTH_URL` muscle memory from v4 doesn't help | Partial |

  **Analyst recommendation: `trustHost: true` in code.** The starter's stated
  goal is "fork-and-go." The env-only path requires deployers to know that
  `AUTH_URL` absence on a non-Vercel host silently kills OAuth. The fpcw
  incident proves this is a real production failure path, not a theoretical
  edge case. The host-header injection risk is mitigated by a code comment
  noting that the proxy must set the Host header correctly — which is table-
  stakes for any reverse proxy configuration. Complement with a strengthened
  `AUTH_URL` comment in `.env.example` noting that it doubles as the `trustHost`
  signal for deployers who prefer env-over-code.

### Outputs

- `docs/work-log/2026-07-01-nextauth-trusthost.md` — this file (Phase 1 section appended)

### Open questions / handoff notes

- Tech-lead decides code-vs-env and records security rationale in
  `docs/decisions.md`.
- If `trustHost: true` is chosen, the one-line add goes into the `NextAuth({`
  options object at `src/auth.ts:65`, with a comment. The `.env.example`
  `AUTH_URL` comment should be strengthened regardless.
- Auth-touching gate applies: e2e suite against a live dev server with an
  MFA-enrolled user is required before Phase 5 can PASS.
- No permission, flag, schema, or session/JWT semantic change — this fix
  affects only how Auth.js derives the OAuth callback hostname.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** Skipped (explicit notation)

**Reason:** This fix is a single declarative property added to an existing config object (`src/lib/auth/config.ts`). No new npm dependency, no schema change, no new directory, no new route group, no structural change. Nothing in the Phase 2 gate criteria (new subdirectory, new shared primitive, new dependency, invariant compliance check) applies. Phase 2 is explicitly skipped per the bug-fix variant allowance. The skip is recorded here so the pipeline remains auditable.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

The fix is `trustHost: true` in code, placed in `src/lib/auth/config.ts` (not as an env-only requirement, and not in `src/auth.ts`). One property, one comment block, one `.env.example` strengthening, one test assertion. The auth-touching e2e gate applies — full Playwright suite against a live dev server with an MFA-enrolled seeded user is required in Phase 4/5.

### What I did

**Code-vs-env decision: `trustHost: true` in code.** See DECISION-016 in `docs/decisions.md` for the full rationale. Short version: the starter's fork-and-go audience will hit this production failure before they read enough docs to know about `AUTH_TRUST_HOST`. The fpcw incident (`e47322a`) proves it. The security posture (proxy must set Host header correctly) is identical to what Vercel auto-accepts via the `VERCEL` env signal.

**Placement: `src/lib/auth/config.ts`, not `src/auth.ts`.** `authConfig` is a directly importable TypeScript object — `config.test.ts` can assert `authConfig.trustHost === true` with no mocking. `src/auth.ts` exports only the NextAuth result (handlers, auth, signIn, signOut, unstable_update), which has no accessible raw-config surface for unit tests.

**Deployment assumption (stated explicitly in the code comment):** The reverse proxy terminating TLS must set the Host header from the public hostname. This is standard behaviour for nginx, Caddy, Cloudflare Tunnel in production, Kinsta, Railway, Fly.io, Render, etc. A misconfigured proxy that passes the internal hostname creates a host-header injection risk — but that same misconfiguration also breaks OAuth URL construction regardless of this flag.

**Regression test strategy:**

- *What IS testable:* A config-shape assertion in `src/lib/auth/config.test.ts`:
  `expect(authConfig.trustHost).toBe(true)`. This is a 3-line addition to the existing describe block — same pattern as the session-projection tests.
- *What is NOT testable at unit level:* The actual NextAuth host-derivation behavior at the OAuth callback. Testing that would require standing up a mock NextAuth server and issuing real HTTP requests with spoofed Host headers — over-engineering for a one-property fix.
- *E2e coverage:* The auth-touching gate requires the full Playwright suite (`npm run test:e2e`) against a live dev server with an MFA-enrolled seeded user (`SEED_MFA_ADMIN_EMAIL` / `SEED_MFA_ADMIN_PASSWORD` set in `.env.local`). This covers the full login path and catches module-resolution defects that unit tests cannot.

**CLAUDE.md impact: none.** The deployment assumption is documented at the code comment site in `config.ts` and in the `.env.example` note. No new CLAUDE.md invariant is required — `trustHost` is a config detail, not a project-wide invariant that future implementers need to remember independently.

**`.env.example` edits for the implementer** (do not merge into CLAUDE.md — these go into `.env.example` only):

Replace the current `AUTH_URL` comment block:
```
# Public origin of the deployed app. Local dev defaults to http://localhost:3000.
# NextAuth v5 uses AUTH_URL (not the v4 NEXTAUTH_URL).
AUTH_URL=http://localhost:3000
```
with:
```
# Public origin of the deployed app. Local dev defaults to http://localhost:3000.
# NextAuth v5 uses AUTH_URL (not the v4 NEXTAUTH_URL). In production, set this
# to your public https URL — it also acts as an independent trustHost signal,
# which is useful for deployers who want to remove the code-level trustHost: true
# from src/lib/auth/config.ts and rely on env-only opt-in instead (DECISION-016).
AUTH_URL=http://localhost:3000
```

Add after the `AUTH_GOOGLE_SECRET` line (still within the NextAuth block):
```
# Optional: env-scoped alternative to the trustHost: true in src/lib/auth/config.ts.
# Redundant when AUTH_URL is set to the production URL or when trustHost: true
# is in code. Never needed on Vercel (VERCEL env auto-enables host trust) or
# Cloudflare Pages (CF_PAGES env). See DECISION-016.
# AUTH_TRUST_HOST=true
```

**Exact change to `src/lib/auth/config.ts`** — add `trustHost: true` with comment immediately after the `secret` line:
```typescript
export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET,
  // Trust the forwarded Host header so NextAuth builds OAuth callback URLs
  // using the public hostname rather than the internal one.
  //
  // NextAuth 5 beta auto-enables this on Vercel (VERCEL env) and Cloudflare
  // Pages (CF_PAGES env) but NOT on any other reverse proxy — nginx, Caddy,
  // Kinsta, Railway, Fly.io, and Cloudflare Tunnel in production all require
  // this explicit flag. Without it, OAuth callbacks use the internal hostname
  // and every sign-in fails with UntrustedHost.
  //
  // Security assumption: the terminating proxy sets the Host header from the
  // public hostname. Standard behaviour for any well-configured reverse proxy.
  // Deployers who prefer an env-scoped opt-in can remove this line and set
  // AUTH_TRUST_HOST=true (or AUTH_URL=https://myapp.com) in production — see
  // DECISION-016 in docs/decisions.md for the full rationale.
  trustHost: true,
  session: { strategy: "jwt" },
  ...
```

**Exact addition to `src/lib/auth/config.test.ts`** — add one `it` block inside the existing `describe("projectJWTOntoSession", ...)` block, or in a new top-level `describe`:
```typescript
describe("authConfig shape", () => {
  it("includes trustHost: true so OAuth callbacks work behind non-Vercel proxies", () => {
    expect(authConfig.trustHost).toBe(true);
  });
});
```
The `authConfig` import is already present in the file (it imports `projectJWTOntoSession` from `./session-projection`, but `authConfig` is exported from `./config` — the implementer needs to add that import).

### Outputs

- `docs/decisions.md` — DECISION-016 appended (top of file)
- `docs/work-log/2026-07-01-nextauth-trusthost.md` — Phase 2 skip notation + Phase 3 section appended; Per-Phase Status rows updated

### Open questions / handoff notes

- **Implementer: api-developer.** Auth config change + env file + one test assertion — all server/config domain, no UI.
- The implementer must import `authConfig` in `config.test.ts` (currently only `projectJWTOntoSession` is imported from `./session-projection`; `authConfig` is exported from `./config`).
- The implementer must NOT edit `CLAUDE.md` — no changes are needed there.
- Auth-touching e2e gate is a hard requirement for Phase 5 PASS. The qa agent must run `npm run test:e2e` against a live dev server with an MFA-enrolled seeded user. A deferred e2e check produces BLOCKED, not PASS.

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Added `trustHost: true` to `authConfig` in `src/lib/auth/config.ts` with a full comment block documenting the off-Vercel rationale, the security assumption (proxy must pin Host from public hostname), and a DECISION-016 reference. Added a config-shape regression test with fail-then-pass evidence. Strengthened the `AUTH_URL` note in `.env.example` and added a commented `AUTH_TRUST_HOST` entry. All local verification gates and the mandatory AUTH-touching e2e gate passed.

### What I did

- Added `trustHost: true` property with 13-line comment block to `authConfig` in `src/lib/auth/config.ts` immediately after the `secret` line, matching the file's existing comment style.
- Added `vi.mock("next-auth")` stub to `src/lib/auth/config.test.ts` so the Vitest node environment can import `authConfig` without triggering the NextAuth runtime initialisation (which imports `next/server`, incompatible with Vitest). Added `authConfig` import and the `describe("authConfig shape")` block with one assertion.
- Updated `.env.example` `AUTH_URL` comment block (3 lines → 5 lines) to note the `trustHost` signal role and DECISION-016. Added `AUTH_TRUST_HOST=true` (commented out) after `AUTH_GOOGLE_SECRET` as the env-scoped opt-in alternative.
- Ran `npm run typecheck` — clean (0 errors).
- Ran `npm run lint` — clean (0 warnings).
- Ran `npm run test` — 20 test files, 196 tests, all passed.
- Ran `npm run build` — clean production build.
- Ran `npm run check:audit` — "Audit-coverage check passed."
- Started dev server (`npm run dev`) on port 3000, confirmed HTTP 200.
- Ran `npm run test:e2e` — 20/20 Playwright tests passed in 21.6s (chromium).
- Killed dev server.

### Fail-then-pass evidence

**BEFORE config change** (`trustHost` absent from `authConfig`):

```
 × src/lib/auth/config.test.ts > authConfig shape > includes trustHost: true so OAuth callbacks work behind non-Vercel proxies 2ms
   → expected undefined to be true // Object.is equality

 Test Files  1 failed | 19 passed (20)
      Tests  1 failed | 195 passed (196)
```

**AFTER config change** (`trustHost: true` added):

```
 ✓ src/lib/auth/config.test.ts > authConfig shape > includes trustHost: true so OAuth callbacks work behind non-Vercel proxies 0ms

 Test Files  20 passed (20)
      Tests  196 passed (196)
```

### E2e gate results

Server: `npm run dev` → HTTP 200 confirmed before suite start.

```
20 passed (21.6s)
```

All 20 Playwright chromium tests passed, including:
- Admin login + dashboard navigation (tests 7–9)
- Member routing + twoFactorRequired → /totp redirect (tests 12–18)
- Account page + 2FA section (tests 1–6)
- Email verify landing (test 6)
- Forgot-password flow (tests 10–11)
- Timezone-safe date rendering (tests 19–20)

### Outputs

- `src/lib/auth/config.ts` — added `trustHost: true` with comment block (lines 19–33)
- `src/lib/auth/config.test.ts` — added `vi.mock("next-auth")` stub, `authConfig` import, and `describe("authConfig shape")` block
- `.env.example` — strengthened `AUTH_URL` comment and added commented `AUTH_TRUST_HOST` entry

### Open questions / handoff notes

- Next agent: **qa** for Phase 5 verification.
- The e2e gate has already been run here (20/20 pass). The qa agent should confirm the unit test suite result and may re-run e2e if desired; the hard prerequisite for Phase 5 PASS has been met.
- No permission, flag, schema, session-shape, or CLAUDE.md change — qa can scope verification to config + test + env changes only.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. All verification gates cleared independently by qa. The `trustHost: true` fix is confirmed present in the working tree and absent from HEAD (fail-before evidence verified). Unit suite passes 196/196 with the new regression test in place. The auth-touching e2e gate was run independently by qa against a live dev server: 20/20 Playwright chromium tests passed. The `vi.mock("next-auth")` stub does not weaken any existing test. The diff is clean and scoped exactly to the three expected files. Next: analyst for Phase 6 shipped-vs-intent review.

### What I did

- Read `docs/work-log/2026-07-01-nextauth-trusthost.md` (Phases 1–4) and `docs/decisions.md` (DECISION-016) for context.
- Read the full diff (`git diff HEAD -- src/lib/auth/ .env.example`) and both changed source files in their entirety.
- Ran `npm run typecheck` — PASS (0 errors).
- Ran `npm run lint` — PASS (0 warnings, `--max-warnings=0`).
- Ran `npm run test` — PASS (20 files, 196 tests, 196 passed, 465 ms).
- Ran `npm run build` — PASS (clean production build, 19 routes).
- Ran `npm run check:audit` — PASS ("Audit-coverage check passed").
- Confirmed fail-before evidence: `git show HEAD:src/lib/auth/config.ts | grep -c trustHost` → 0 (pre-fix), working tree → 1 (post-fix).
- Reviewed the `vi.mock("next-auth")` stub: it stubs only the NextAuth constructor. The three existing `projectJWTOntoSession` tests call the pure function from `./session-projection` directly — they do not interact with NextAuth at runtime. `session-projection.ts` imports only type declarations from `next-auth` (erased at compile time). The mock does not weaken any existing assertion.
- Killed any process on port 3000, started `npm run dev` in background, confirmed HTTP 200.
- Ran `npm run test:e2e` — PASS (20/20 Playwright chromium, 20.3 s). Full list: account page (5 tests), email verify landing (1), admin login + nav (3), forgot-password (2), member home + routing (7), timezone-safe dates (2).
- Killed dev server.
- Verified adversarial checks: `authConfig` spread into `NextAuth({...authConfig, ...})` in `src/auth.ts` line 66 (Node-side handlers inherit `trustHost`); `src/proxy.ts` imports `edgeAuth` which is `NextAuth(authConfig)` from `config.ts` (edge runtime also has `trustHost`). No `console.log`, no native browser dialogs, no config drift beyond the three expected files.
- Spot-checked `.env.example`: `AUTH_URL` comment matches DECISION-016 exactly; `AUTH_TRUST_HOST=true` is present commented-out with the correct rationale; no secrets.
- Ran coverage (`npm run test -- --coverage`): `src/lib/auth` aggregate 92.59% statements / 100% branches. `config.ts` 50% statements (callbacks at lines 39–47 are runtime-exercised by e2e, not unit-testable without the full NextAuth runtime — expected and acceptable for a config module).

### Outputs

- `docs/work-log/2026-07-01-nextauth-trusthost.md` — Phase 5 section appended; Per-Phase Status row updated to complete / PASS / 2026-07-01.

### Type Check
`npm run typecheck`: PASS

### Unit Tests
Total: 196 | Passed: 196 | Failed: 0
Duration: 465 ms (20 test files)
Failures: none

### End-to-End Tests
Total: 20 | Passed: 20 | Failed: 0
Duration: 20.3 s (chromium)
Server: `npm run dev` → HTTP 200 confirmed before suite start
Failures: none

### Regression Tests Added
- `authConfig shape > includes trustHost: true so OAuth callbacks work behind non-Vercel proxies` — `src/lib/auth/config.test.ts:75` — guards against: `trustHost` being removed from `authConfig`, which causes `UntrustedHost` errors on every OAuth callback on any non-Vercel, non-CF-Pages host

### Coverage on Critical Modules
- `src/lib/auth` (aggregate): 92.59% statements / 100% branches
- `src/lib/auth/config.ts`: 50% statements / 100% branches (callbacks at lines 39–47 are not directly unit-testable; 100% branch coverage is what matters for config shape)
- `src/lib/two-factor.ts`: covered by existing test suite (test file present and running)
- `src/lib/permissions.ts`: covered by existing test suite
- `src/lib/flags.ts`: covered by existing test suite

### Feature-Gate Audit

No protected routes touched. This bug fix is a config property change in `src/lib/auth/config.ts`. No new route handlers, no new server actions. No `auth()` or `hasFeature()` audit applies.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|-----------------------------|
| (no protected routes touched) | n/a | n/a | n/a |

### Verdict: PASS

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6 shipped-vs-intent review.
- The implementation changes are in the working tree (unstaged). The user should commit and push after Phase 6 sign-off.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped fix exactly delivers what the bug report demanded and what Phase 1 confirmed was needed: `trustHost: true` in the shared `authConfig` object, with the rationale and security assumption documented in code, in `.env.example`, and in DECISION-016. Both the Node-side handlers and the edge proxy inherit the property through their existing import chain — no separate wiring required. The regression test guards against reversion. Vercel deployments are unaffected. No session, JWT, permission, flag, or schema semantics changed.

### What I did

**Re-read Phase 1 contract.** Phase 1 confirmed the bug (UntrustedHost on every OAuth callback on non-Vercel, non-CF-Pages hosts in production) and recommended `trustHost: true` in code with a comment, plus an `.env.example` strengthening. Phase 3 refined the placement from `src/auth.ts` to `src/lib/auth/config.ts` — a superior choice that makes the config shape unit-testable. That drift is recorded in DECISION-016 and accepted.

**Verified every element of the Phase 1 contract against the working tree:**

- `trustHost: true` is present at `src/lib/auth/config.ts:33`, inside the `authConfig` object, with a 14-line comment block that covers the off-Vercel rationale, the list of affected platforms, and the security assumption (proxy must set Host from public hostname).
- DECISION-016 reference is in the comment (`see DECISION-016 in docs/decisions.md for the full rationale`).
- Node-side handlers: `src/auth.ts:65` — `NextAuth({...authConfig, ...})` — spread inherits `trustHost`.
- Edge proxy: `src/proxy.ts:2` — imports `edgeAuth` from `@/lib/auth/config`, which is `NextAuth(authConfig)` at `config.ts:52` — inherits `trustHost`.
- `.env.example` AUTH_URL comment block expanded to name its trust-signal role and reference DECISION-016.
- `AUTH_TRUST_HOST=true` present commented-out after `AUTH_GOOGLE_SECRET` with correct "when to use it" note.
- Regression test at `config.test.ts:74-78`: `expect(authConfig.trustHost).toBe(true)` — fails before fix (qa confirmed `undefined !== true`), passes after.
- `vi.mock("next-auth")` stub does not weaken any existing assertion (three `projectJWTOntoSession` tests call a pure function that does not touch the NextAuth runtime).
- DECISION-016 present at top of `docs/decisions.md`, fully reasoned.

**Intent-vs-shipped diff:**

| Phase 1 / Phase 3 said | Shipped | Verdict |
|------------------------|---------|---------|
| `trustHost: true` in the NextAuth config | `src/lib/auth/config.ts:33` — `trustHost: true,` | matches |
| Placement: Phase 1 suggested `src/auth.ts`; Phase 3 moved to `src/lib/auth/config.ts` for unit-testability | `src/lib/auth/config.ts` | acceptable drift — DECISION-016 documents the rationale; the outcome (all callers inherit the flag) is identical |
| Node handlers inherit via spread | `src/auth.ts:65` — `NextAuth({...authConfig, ...})` | matches |
| Edge proxy inherits via `edgeAuth` import | `src/proxy.ts:2` — `edgeAuth` is `NextAuth(authConfig)` from `config.ts:52` | matches |
| `.env.example` AUTH_URL comment strengthened | 5-line comment naming trust-signal role + DECISION-016 | matches |
| `AUTH_TRUST_HOST=true` commented-out in `.env.example` | present after `AUTH_GOOGLE_SECRET` with correct note | matches |
| Regression test asserts `authConfig.trustHost === true` | `config.test.ts:74-78` | matches |
| DECISION-016 in `docs/decisions.md` | present, fully reasoned | matches |
| Vercel deploys unchanged | `trustHost: true` is redundant on Vercel (`VERCEL` env auto-enables it) but harmless | matches |
| No session/JWT/permission/flag/schema change | diff is scoped to `config.ts`, `config.test.ts`, `.env.example` only | matches |

**Edge cases:**

| Check | Result |
|-------|--------|
| Empty state | not applicable — config property, no UI surface |
| Failure microcopy | not applicable — fix removes the failure path; no new user-visible failure added |
| Permission gate | not applicable — no permission change |
| Audit event | not applicable — OAuth plumbing fix; not a security-sensitive mutation (no role/flag/2FA/deactivation change) |
| Mobile | the fpcw incident noted "particularly older mobile Safari" as the visible symptom — the root cause (`UntrustedHost`) is fully resolved; mobile and desktop are affected equally |

### Outputs

- `docs/work-log/2026-07-01-nextauth-trusthost.md` — Phase 6 section appended; Per-Phase Status row updated to complete / SHIP IT / 2026-07-01
- `docs/TODO.md` — BUG-4 moved from In Flight to Done

### Open questions / handoff notes

- No follow-ups. Pipeline is closed.
- User should commit the three changed files (`src/lib/auth/config.ts`, `src/lib/auth/config.test.ts`, `.env.example`) and this work-log update, then push.
