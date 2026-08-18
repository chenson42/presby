# Node Engine Floor — Work Log

> **Slug:** `2026-05-18-node-engine-floor`
> **Surface:** infrastructure (no user-facing change)
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (DX papercut, no behavior change)

## Context

Surfaced as follow-up #1 from `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 5 / Phase 6). During verification of the timezone fix, the agent landed on Node 18.19.0 in its default shell and hit cryptic failures on both Vitest 4.x (uses `node:util` `styleText` added in Node 20.12.0) and Next 16 dev (engines `>=20.9.0`). The errors gave no clear hint that Node was the cause.

`.nvmrc` says `20` and `package.json` `engines` requires `>=20.9.0`, but nothing actually enforces this — a developer on Node 18 sees an obscure stack trace, not a friendly "your Node is too old."

## Goal

1. Confirm the project's Node floor is `>=20.9.0` (in lockstep with Next 16 + Vitest 4.x).
2. Add a pre-everything check that fails fast with a human-readable message on lower versions. Options to evaluate: `engine-strict=true` in `.npmrc`; a small `scripts/check-node.mjs` invoked via `prebuild` / `predev` / `pretest`; or a `husky` pre-commit hook. Pick the lowest-overhead option.
3. Cross-check `.nvmrc` (currently `20`) — should probably pin to a specific LTS like `20.18` to give forks a stable target.
4. Update `README.md` and/or `CLAUDE.md` if the floor changes.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Pending | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending — likely skipped (trivial) | — | — |
| 4 — Implementation | deployment-engineer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## References

- Parent work-log: `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 5 open notes; Phase 6 follow-up #1)
- Release notes: `docs/release-notes/v0.3.md` — 0.3.4 known follow-ups list
