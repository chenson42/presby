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
| 4 — Implementation | full-stack-developer | Complete | — | 2026-11-01 |
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

## Phase 4 — Implementation (full-stack-developer)

**Result:** every `next/font/google` use is now `next/font/local`, with the same families, weights, `display: "swap"` and CSS variable names. No build fetches from Google Fonts.

### Files

- Modified:
  - `src/lib/brand/fonts.ts`: eight `localFont()` calls at module scope, header rewritten.
  - `src/app/layout.tsx`: Inter.
  - `src/lib/brand/fonts.test.ts`: mock moved to `next/font/local`, plus a new "self-hosted fonts" block.
  - `src/lib/sites.test.ts`, `src/lib/brand/read-org-brand.test.ts`: mock moved to `next/font/local`.
  - Comment-only: `src/lib/sites.ts`, `src/lib/brand/contract.ts`, `src/app/globals.css`, and the two `actions.test.ts` files.
- Added: `src/lib/brand/font-files/<family>/<family>-latin-variable.woff2` and `OFL.txt` for lora, source-sans-3, libre-franklin, public-sans, bitter, karla, montserrat, open-sans and inter.
  - The directory is `font-files`, not `fonts`, so `./fonts` still resolves unambiguously to `fonts.ts`.
  - Inter's files sit in the same tree; `layout.tsx` reaches them with `../lib/brand/font-files/inter/...`.

### Choice: variable woff2, one file per family

- The CSS2 API returns a single variable latin woff2 for every one of the nine families. All nine are variable fonts, and `next/font/google` was already downloading that same file.
- One file per family is simpler than three or four statics and no larger.
- Weight ranges equal the old weight lists' extremes:
  - 400 700: Lora, Libre Franklin, Bitter.
  - 400 600: Source Sans 3, Public Sans, Karla, Open Sans.
  - 400 800: Montserrat.
  - 100 900: Inter.
- A weight outside a face's range clamps, exactly as the old static 400/600 faces did.
- Each URL ended `.woff2` and each file starts with `wOF2`. No `/l/font?kit=` response was returned.
- `adjustFontFallback` ("Arial" or "Times New Roman") and a `fallback` stack are set, because `next/font/local` does not generate the metric-matched fallback that `next/font/google` did by default.

### Bytes and licences

- Total woff2: 307,892 bytes (about 301 KB). The `.next/static/media` output was 320K on disk.
  - Per file: lora 37,792; source-sans-3 28,804; libre-franklin 29,336; public-sans 26,636; bitter 34,156; karla 24,264; montserrat 35,508; open-sans 42,964; inter 48,432.
- Nine `OFL.txt` files, each fetched from `github.com/google/fonts` `ofl/<family>/OFL.txt` (about 4.4 KB each). All nine families are SIL OFL 1.1.
- `npm run check:secrets`: passes with the font tree staged. It skips `.woff2` by extension and scans the nine `OFL.txt` files with no findings. It scans only git-tracked files, so it was re-run after `git add`.

### Gates

- `npm run typecheck`: clean.
- `npm run lint`: clean (`--max-warnings=0`).
- `npm run check`: all ten pass.
- `npm test`: 820 files passed, 137 skipped. 12,802 tests passed, 3,616 skipped. The skips are the DB-backed suites, which need `.env.local`.
- `src/lib/brand` suites, which cover `fonts.test.ts`, `read-org-brand.test.ts` and the contract tests: green. `fonts.test.ts` has 22 tests, up from 12.
- New tests in `fonts.test.ts`:
  - Nine font files are named and unique.
  - Each exists, starts `wOF2` and has an `OFL.txt` beside it.
  - Each directory in `font-files` is used and holds only its woff2 and `OFL.txt`.
  - Nothing in `src/` imports `next/font/google` — regression for the Turbopack font-query build failure.
  - I confirmed the last one fails against a planted `import { Inter } from "next/font/google"`, then removed the plant.
- Production build in a scratch copy under the session scratchpad, outside `~/git/presby-platform/`:
  - Build 1 (plain): exit 0, about 30 s, Turbopack, nine woff2 in `.next/static/media`.
  - Build 2 (`CI=1`, with `HTTP_PROXY` and `HTTPS_PROXY` pointed at a dead port `127.0.0.1:9`, so a proxy-aware outbound fetch would fail): exit 0, nine woff2 again.
  - `grep -r "fonts.googleapis\|fonts.gstatic" .next/` in the copy after each build: no matches.
  - The scratch copy was deleted. The worktree has no `.env.local`.
- No network fetch: `grep -rn "next/font/google" src` now matches only comments (the `fonts.ts` and `layout.tsx` headers explaining why). The guard test above forbids an import or mock of it. The dead-proxy build is corroboration only: I did not run a build under the old code to show it fails the same way.

### Visual check

- Server: `next dev` on port 3560 in the scratch copy, with `NEXT_PUBLIC_APP_URL=http://localhost:3560` against the development database. A production build cannot take an http `NEXT_PUBLIC_APP_URL`, so dev was the right server for this. Stopped by PID; nothing is left listening on 3560.
- The pairings page was a throwaway route at `/help/zz-fonts-check` in the scratch copy only. It renders `resolveTypePairing()` for all four pairings, because `/admin/design-system` needs a sign-in. It was never in the worktree. No live `/site/<slug>` was screenshotted, because the live sites in the development database may carry real content.
- Playwright at 360px, light and dark, over `/help`, `/signin` and the pairings page:
  - Computed `font-family` on body and h1 is `inter, "inter Fallback", system-ui, sans-serif`.
  - All eight pairing faces resolve to their own bundled faces: `classicHeading`, `classicBody`, `modernHeading`, `modernBody`, `warmHeading`, `warmBody`, `contemporaryHeading` and `contemporaryBody`.
  - `document.fonts` reports each loaded with the expected weight range.
  - All nine woff2 were served from `/_next/static/media/`.
  - Requests whose URL contains google or gstatic: none.
- **Visible difference:** the CSS family names are now next/font's local names (the variable's identifier, e.g. `classicHeading`), not `Lora`. Nothing in `src/` references a family literally, so nothing breaks. A person inspecting computed styles sees different names for the same glyphs.
- Screenshots (not committed, scratchpad only), all in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/shots-final`:
  - `help-light-360.png`, `help-dark-360.png`
  - `signin-light-360.png`, `signin-dark-360.png`
  - `pairings-light-360.png`, `pairings-dark-360.png`
- I read the light pairings image and the dark signin image. Four distinct pairings render (serif Lora, sans Libre Franklin, serif Bitter and sans Montserrat headings, each over its own body face), with no blank text. I did not read the other four images.

### For QA

1. Re-run `npm run typecheck`, `npm run lint`, `npm run check` and `npm test`.
2. Read the new "self-hosted fonts" block in `src/lib/brand/fonts.test.ts` and confirm it would fail on a reintroduced `next/font/google` import.
3. Build in a scratch copy (rsync without `node_modules`, `.next` and `.git`; `cp -c -R node_modules`; main's `.env.local`), plain and with `CI=1`, and `grep -r "fonts.googleapis\|fonts.gstatic" .next/` must find nothing.
4. In a browser at 360px, light and dark, open `/help`, `/signin` and the "Type pairings" section of `/admin/design-system` (signed in). Check that the headings and body copy look right in all four pairings and that the network tab shows no request to Google. Also open one live `/site/<slug>` that has a brand pairing.
5. Confirm `OFL.txt` sits beside each woff2 in `src/lib/brand/font-files/`.
6. Confirm the diff touches no Rule 16 shared file.
7. Help impact: none. No label, page or flow changed.
