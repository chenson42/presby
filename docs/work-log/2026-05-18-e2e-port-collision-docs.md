# e2e Port-Collision Footgun — Docs Work Log

> **Slug:** `2026-05-18-e2e-port-collision-docs`
> **Surface:** documentation
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (docs-only; no code change)

## Context

Surfaced as follow-up #2 from `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 5 / Phase 6). While running the new timezone-safe-dates e2e spec live, the agent hit this sequence:

1. `npm run dev` — port 3000 was held by a *sibling project* (westervillelions), so Next fell back to 3001.
2. The form on `/signin` posted to the 3001 server. NextAuth validated credentials successfully.
3. NextAuth issued a redirect using `AUTH_URL` from `.env.local` (which still pointed to `http://localhost:3000`).
4. The browser followed to `localhost:3000/signin?callbackUrl=/admin` — the *wrong app* — with no session cookie (cookies are origin-scoped to `:3001`).
5. Playwright observed an apparent sign-in failure: URL never left `/signin`.

The root cause is a developer-experience footgun, not a code bug: when `AUTH_URL` doesn't match the actual dev-server port, NextAuth redirects across origins and cookies get dropped silently. The agent burned three test runs before identifying the cause.

## Goal

1. Document the failure mode and the fix in a place the next reviewer will see *before* hitting it. Candidates: a new `e2e/README.md`, an addition to `.claude/skills/pre-push/`, or a new "Running e2e locally" section in the top-level `README.md`. Pick whichever is closest to where a contributor lands when they want to run e2e.
2. State the fix recipe explicitly:
   ```
   # When port 3000 is in use:
   AUTH_URL=http://localhost:3002 PORT=3002 npm run dev
   # then, in another shell:
   E2E_BASE_URL=http://localhost:3002 npm run test:e2e
   ```
3. Optional but worth considering: a one-line check inside the e2e spec or its `beforeAll` that warns if `AUTH_URL` doesn't match `baseURL` host:port. Mostly defensive, not strictly required.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Pending — likely skipped (docs-only) | — | — |
| 2 — Architectural review | architect | Pending — likely skipped (docs-only) | — | — |
| 3 — Technical design | tech-lead | Pending — placement decision (e2e/README vs pre-push skill vs top README) | — | — |
| 4 — Implementation | tech-lead or deployment-engineer | Pending | — | — |
| 5 — Verification | qa | Pending — light check (lint, link integrity) | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## References

- Parent work-log: `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 5 "Open questions / handoff notes")
- Release notes: `docs/release-notes/v0.3.md` — 0.3.4 known follow-ups list
