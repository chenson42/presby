# Bundle the Google fonts (next/font/local) — Work Log

> **Slug:** `2026-11-01-self-host-fonts`
> **Surface:** mixed (every page renders a font: the platform's Inter and the four congregation type pairings)
> **Permission(s):** not applicable
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish / refactor (CLAUDE.md → Classification): fonts move from `next/font/google` to `next/font/local` with the same families, weights and CSS variables. No new dependency, no schema, no API surface, no visible change intended.
> **Branch:** `pipeline/e2e-shard` (PR #74). This shares the branch because the bug was found there, and a new worktree would have disturbed a running sibling dev server (TODO line on the Turbopack-root hazard).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-11-01 |
| 2 — Architectural review | architect | Skipped | — | 2026-11-01 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-11-01 |
| 4 — Implementation | full-stack-developer | In progress | — | 2026-11-01 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skips, stated:** Phases 1–3 are skipped. This adds no behaviour, the design is the operator's instruction ("lets bundle the fonts", 2026-11-01), and the families, weights and variables are fixed by the current `src/lib/brand/fonts.ts` and `src/app/layout.tsx`. The font files are static assets under the existing tree, so no new subdirectory of note is added. If the implementer finds that something needs a structural choice, it comes back here. **Help impact:** none. No label, page or flow changes, and fonts should render identically.

## Why

Production deploys of `main` fail. The Vercel build of `d530c41` (0.54.0) failed with 20 errors: `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` / "next/font/google queries have exactly one entry" (Montserrat, via `src/lib/brand/fonts.ts`). The same error failed CI's e2e dev-lane shard 1 twice (PR #74).

The cause is upstream, [vercel/next.js#99114](https://github.com/vercel/next.js/issues/99114). Google Fonts intermittently returns extensionless `/l/font?kit=…` URLs (reported ~1 in 60 responses). Turbopack parses the serialized font options as a query string, so the `&` in that URL splits it into two entries. The issue closed with no Turbopack fix. Each build makes one Google request per family (nine families here), so a build often draws at least one bad response.

The known workaround is to self-host with `next/font/local`, so no build ever fetches from Google.

An earlier attempt on this branch (`1e12716`, keeping Turbopack's default root in CI) was the wrong diagnosis and is reverted in `4f9013e`.

## Production migrations applied (2026-11-01, orchestrator, at the operator's instruction)

These are recorded here because they were found while this work was in progress. The deployment runbooks get their "Recorded results" at the next docs commit.

- **Found:** production had none of `0073`, `0074`, `0078`, `0083` or `0066`. The live deployment predates 0.51, because every recent production build failed on the font error above.
- **Preconditions (read-only):**
  - `0072` constraint present.
  - No person has a photo key (0 / 0).
  - `0065` present.
  - 0066 P1 = 0, P10 = 0.
  - P2: listed 1 (1 with sign-in) and staff_anchor 1 (1), so nobody loses the directory.
  - P5 = 0. P8 = 0. P9 = 0.
- **Snapshot:** `pre-0073-0074-0078-0083-0066-2026-11-01` (`snap-tiny-sound-axgv3thu`).
- **Rehearsal** on a production-derived branch, in order `0073`, `0074`, `0078`, `0083`, `0066`, each `psql -1`: all exit 0. The rehearsal branch was then deleted.
- **Production apply:** same order, all exit 0.
- **Verification:**
  - The four new tables have RLS forced (`t/t`).
  - `presby_app` has no DELETE on either photo table.
  - `people_photo_key_retired` is validated.
  - `help_contact_messages` has 0 policies.
  - `presby_submit_help_contact` is executable by `presby_app` and not by PUBLIC.
  - `presby_standing_is_member` exists.
  - `calendar_viewer` exists in 2 organizations.
  - P11 = 0 / 0.
  - P12: `all_memberships` 2 = `active_membership` 2.
- **Still open for the operator:** the 0083 environment variables (Turnstile, Upstash, `HELP_PRIVACY_CONTACT_EMAIL`) must be set in Vercel Production before the 0.53+ code deploys. Without them the contact form shows "unavailable".
