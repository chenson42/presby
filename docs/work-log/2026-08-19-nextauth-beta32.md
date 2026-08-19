# next-auth beta.31 → beta.32 security bump — Work Log

> **Slug:** `2026-08-19-nextauth-beta32`
> **Surface:** `src/auth.ts`, NextAuth config, sign-in path (touches `src/app/(auth)/`)
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small — dependency bump, no code change expected
> **Pipeline mode:** Bug-fix variant (dependency/security)

## Source

`docs/TODO.md` — "URGENT — next-auth `5.0.0-beta.31` → `beta.32`", filed
2026-08-09 pre-push. Clears 2 critical + 1 high Auth.js advisories in
`@auth/core` (bumped `0.41.0` → `0.41.3` transitively):
GHSA-xmf8-cvqr-rfgj (uncaught exception on malformed Bearer header),
GHSA-7rqj-j65f-68wh (email-normalizer homoglyph bypass),
GHSA-x445-f3h2-j279 (OAuth state/nonce/PKCE cookies not provider-bound).
Outside the pinned semver range, so `npm audit fix` can't take it
automatically.

## Phase 1 (bug-fix variant, brief)

Confirmed real: `npm view next-auth@5.0.0-beta.32` exists on the registry and
depends on `@auth/core@0.41.3` (current: beta.31 → `@auth/core` implicitly
`~0.41.0`). This is a dependency version bump, not a design change — the fix
preserves intended behavior (sign-in still works the same way; the advisories
are hardening, not feature changes). Skipping the full five-pass review;
Phase 2 (architect) also skipped — no invariant touched, confirmed below.

## Phase 2 — skipped, with notation

No architectural change: same package, patch-level advisory fixes, no new
API surface. `CLAUDE.md`'s auth-touching gate (Phase 4, not Phase 5) is what
actually matters here and is not skippable — see Phase 4 below.

## Phase 4 — Implementation

Implementer: orchestrator (dependency bump + verification only, no design
decision to hand to an agent).

## Phase 4 — Verification

- `npm install next-auth@5.0.0-beta.32` — `@auth/core` resolved `0.41.3` (was
  implicitly `~0.41.0`), confirmed via `npm ls @auth/core`. All three targeted
  advisories (GHSA-xmf8-cvqr-rfgj, GHSA-7rqj-j65f-68wh, GHSA-x445-f3h2-j279)
  gone from `npm audit`; remaining findings are the pre-existing,
  already-tracked `drizzle-kit`/`esbuild` moderate advisory.
- `npm run typecheck` — clean. `npx vitest run` — 656 passed. `npm run build`
  — clean.
- **The mandatory auth-e2e gate** (CLAUDE.md Phase 4, not deferred by
  DECISION-045): full suite `npm run test:e2e` — **89/89 passed**, including
  `totp-full-login.spec.ts` run explicitly on its own — full email+password →
  TOTP challenge → wrong-code rejection → correct-code sign-in, against the
  bumped dependency. **PASS.**
- `npm audit --omit=dev --audit-level=high` now passes clean (0 vulnerabilities)
  — the `continue-on-error` escape hatch on CI's audit step
  (`.github/workflows/ci.yml`) is removed, exactly as its own comment
  instructed once this bump landed.

## Phase 5 / 6

Not deferred — this is a security fix, not part of the P0.5 foundation
program DECISION-045 covers. Standard gates apply and all passed above;
closing as **SHIP IT**.
