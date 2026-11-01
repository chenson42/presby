# Dependency update: the Dependabot minor-and-patch group (41 packages) — Work Log

> **Slug:** `2026-11-01-deps-minor-patch`
> **Surface:** mixed (every surface renders through the bumped runtime packages)
> **Permission(s):** not applicable
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Polish / refactor (CLAUDE.md → Classification): version bumps within existing dependencies, no new dependency, no schema, no API surface. It is **auth-touching by runtime** (`otplib`, `next`, `@neondatabase/serverless`), so Phase 4's running-server e2e smoke covering the full login path with an MFA-enrolled user applies.
> **Worktree / port / Neon:** `presby-deps`, port 3530, Neon `pipeline-deps-minor-patch` (`br-bold-block-axhjzt3u`, forked from `development`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-11-01 |
| 2 — Architectural review | architect | Skipped | — | 2026-11-01 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-11-01 |
| 4 — Implementation | deployment-engineer | In progress | — | 2026-11-01 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skips, stated:** Phases 1–3 are skipped because there is no new behaviour to refine or design. The versions are fixed by Dependabot PR #71, which the operator asked to merge on 2026-11-01. Any behaviour change a bump causes is a Phase 4 finding. A finding that needs a design decision promotes this to a Feature at that point.

## Why our own branch, not #71

- **#71's lockfile does not install.** Its CI failed at `npm ci` ("typecheck + build", step "Install dependencies", run 41243644413).
- **#71 can't be fully tested in CI.** Dependabot PRs receive no repository secrets, so its DB, `test-rls.sql` and Playwright jobs were all skipped.

This branch applies the same target versions, regenerates the lockfile, and runs every gate. CI on our own PR has the Neon secrets. #71 is closed in favour of this PR.

## Target versions (from #71)

`@hookform/resolvers` 5.9.2 · `@neondatabase/serverless` 1.2.0 · `@radix-ui/react-alert-dialog` 1.2.1 · `@radix-ui/react-avatar` 1.3.1 · `@radix-ui/react-dialog` 1.3.1 · `@radix-ui/react-dropdown-menu` 2.2.1 · `@radix-ui/react-label` 2.1.17 · `@radix-ui/react-slot` 1.5.0 · `@radix-ui/react-switch` 1.4.1 · `@upstash/ratelimit` 2.2.0 · `@upstash/redis` 1.40.0 · `drizzle-orm` 0.45.4 · `lucide-react` 1.63.0 · `mermaid` 11.17.2 · `next` 16.4.3 · `otplib` 13.5.0 · `react` / `react-dom` 19.3.1 · `@types/react` / `@types/react-dom` 19.3.0 · `react-hook-form` 7.91.0 · `resend` 6.35.0 · `sonner` 2.0.8 · `stripe` 23.0.1 · `tailwind-merge` 3.7.0 · `ws` 8.22.0 · `@types/ws` 8.18.2 · `@playwright/test` 1.64.1 · `@tailwindcss/postcss` 4.3.3 · `@tailwindcss/typography` 0.5.20 · `@testing-library/dom` 10.4.2 · `@testing-library/react` 16.3.3 · `@types/node` 20.19.43 · `@types/pdfkit` 0.17.7 · `@vitest/coverage-v8` / `vitest` 4.1.12 · `dotenv-cli` 11.1.0 · `drizzle-kit` 0.31.11 · `eslint-config-next` 16.4.3 · `tailwindcss` 4.3.3 · `tsx` 4.23.15
