# Bundle the Google fonts (next/font/local) — Work Log

> **Slug:** `2026-11-01-self-host-fonts`
> **Surface:** mixed (every page renders a font: the platform's Inter and the four congregation type pairings)
> **Permission(s):** not applicable
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish / refactor (CLAUDE.md → Classification): fonts move from `next/font/google` to `next/font/local` with the same families, weights, CSS variables and script coverage (every subset `next/font/google` served: latin, latin-ext, vietnamese, cyrillic, greek and the rest; see the loop-back section). No new dependency, no schema, no API surface. The only visible differences are the CSS family names (next/font/local's own) and slightly different fallback metrics (sub-pixel).
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

**Skips, stated:** Phases 1–3 are skipped. This adds no behaviour, the design is the operator's instruction ("lets bundle the fonts", 2026-11-01), and the families, weights and variables are fixed by the current `src/lib/brand/fonts.ts` and `src/app/layout.tsx`. The font files are static assets under the existing tree, so no new subdirectory of note is added. If the implementer finds that something needs a structural choice, it comes back here. **Help impact:** none. No label, page or flow changes, and the same faces render with the same coverage as before, apart from the CSS family name and sub-pixel fallback metrics (Visible difference, below).

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
- Added: `src/lib/brand/font-files/<family>/<family>-variable.woff2` (renamed from `-latin-variable` in the loop-back below) and `OFL.txt` for lora, source-sans-3, libre-franklin, public-sans, bitter, karla, montserrat, open-sans and inter.
  - The directory is `font-files`, not `fonts`, so `./fonts` still resolves unambiguously to `fonts.ts`.
  - Inter's files sit in the same tree; `layout.tsx` reaches them with `../lib/brand/font-files/inter/...`.

### Choice: variable woff2, one file per family

- All nine families are variable fonts. The first cut used the single variable latin woff2 the CSS2 API returns per family; that dropped every other subset, which QA run 1 caught (finding 1). The files are now one full-coverage variable woff2 per family, cut from the upstream TTF (see the loop-back section).
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

- First cut (latin only, superseded): 307,892 bytes. Current total woff2: 902,692 bytes (about 882 KB); per-file sizes are in the loop-back section.
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
- **Visible difference:** the same faces with the same coverage as before (after the loop-back), with two differences. (1) The CSS family names are now next/font's local names (the variable's identifier, e.g. `classicHeading`), not `Lora`. Nothing in `src/` references a family literally, so nothing breaks; a person inspecting computed styles sees different names for the same glyphs. (2) The metric-matched fallback is generated from local metrics, not Google's: QA measured `size-adjust` 107.89% against 107.12% for Inter, which gives sub-pixel differences (arrows are where QA saw them) until the web font loads, and none after. (The first cut of this section said the family name was the only difference and that no visible change was intended. Both were wrong: the first cut also lost every non-latin subset, fixed below.)
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

## Phase 4 loop-back (QA run 1, finding 1)

**Finding (FAIL):** coverage regression. On `main`, `next/font/google` emitted an `@font-face` with `unicode-range` for every subset each family has (51 woff2 across the nine). The first bundled cut was latin-only, so Ł ő ș č ā ễ ặ, Cyrillic, Greek and № fell back to Arial mid-word, in Inter and in all eight pairing faces. The "same latin subset" comment in `fonts.ts` and the "same faces" claims in this log were wrong.

**Operator ruling (2026-11-01):** full coverage, subsetted. One woff2 per family, every subset the family offers, cut from the family's own upstream variable TTF with fonttools, a local tool and not a repo dependency.

### What changed

- **Files:** `src/lib/brand/font-files/<family>/<family>-variable.woff2` replaces `<family>-latin-variable.woff2` (nine files; the nine `OFL.txt` are unchanged). `fonts.ts` and `layout.tsx` point at the new names.
  - Cut from `github.com/google/fonts` at commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`, `ofl/<dir>/<Family>[axes].ttf` (roman only).
  - `fonttools varLib.instancer` keeps the `wght` axis at the range each face declares (400:700, 400:600, 400:800, Inter 100:900) and pins other axes at their default (Open Sans `wdth=100`, Inter `opsz=14`).
  - `pyftsubset --flavor=woff2 --layout-features='*'` with the **union of every subset Google's CSS2 API serves for that family**. The per-subset `unicode-range` values were read from the CSS2 response (modern Chrome User-Agent) and are committed as `font-files/subsets.json`.
  - Subsets present per family: latin and latin-ext for all nine; vietnamese for all but Karla; cyrillic and cyrillic-ext for all but Karla and Public Sans; greek and greek-ext for Inter, Source Sans 3 and Open Sans; and the small `math`, `symbols` (Lora, Open Sans) and `hebrew` (Open Sans) subsets. I included those last three because `main` emitted them (that is what makes 51), though the operator's list named only the first seven. Their glyph counts are tiny (a handful per font).
  - Not covered, because Google does not serve them either: Greek in Lora, Libre Franklin, Bitter and Montserrat; Cyrillic and Vietnamese in Karla; Cyrillic and Greek in Public Sans. Those glyphs fall back, as they did on `main`.
- **Rebuild kit:** `font-files/README.md` (exact command, source commit, URLs, versions), `font-files/build-fonts.sh` (the script that produced the committed files; `WORK` must be a scratch directory) and `font-files/subsets.json`. fonttools 4.68.0 and brotli 1.2.1 in a throwaway venv.
- **Comments fixed:** `fonts.ts` header (the false "same latin subset" claim; now states full coverage and the family-name difference) and `layout.tsx`; `sites.ts` ("Lora is not a function" became a description of the real failure under plain Node); the three mock comments in `fonts.test.ts`, `sites.test.ts` and `read-org-brand.test.ts`.
- **Tests:**
  - New `src/lib/brand/font-coverage.test.ts` (62 tests). It decodes each committed woff2 (a small in-file WOFF2 reader: header, directory, brotli stream via `node:zlib`, then `cmap` formats 4 and 12 and `fvar`) and asserts, per family and per subset Google serves it, that sample code points are mapped (Ł ő ș č ā; ễ ặ; Ж №; Ә Ө; Ω α; ἀ; א; ∂ ∑; and so on), and that the only axis is `wght`, spanning the declared range. The expectations are hand-written from Google's CSS2 subsets, not read back from the build script or the files. I validated the reader against fonttools: the code-point sets are identical for all nine files.
  - **Fail-first:** I swapped `lora-variable.woff2` for the old latin-only cut from `HEAD`: six Lora tests failed (latin-ext, vietnamese, cyrillic, cyrillic-ext, math, symbols) naming the missing code points (U+0141, U+1EC5, U+0416 ...). Restored, 62 pass.
  - `fonts.test.ts` now asserts every face's file: "wires each face to its own file (all eight)" compares each pairing's mock class name to the exact `font-files/<family>/<family>-variable.woff2` path and variable. Fail-first: renaming one path in `fonts.ts` failed it (and the exists test).
  - The `next/font/google` guard now scans `.ts .tsx .js .jsx .mjs .cjs` and matches any quoted specifier (import, `import()`, `require()`, `vi.mock()`). Fail-first: a planted `require("next/font/google")` in a `.cjs` and an `import("next/font/google")` in a `.mjs` both failed it; plants removed.
  - The directory test now also pins the three loose files beside the family directories.

### Bytes (woff2, actual)

| file | first cut (latin) | now |
|---|---|---|
| lora | 37,792 | 80,796 (80,556 after the RFN rename, QA run 2) |
| source-sans-3 | 28,804 | 127,004 (126,808 after the RFN rename) |
| libre-franklin | 29,336 | 60,908 |
| public-sans | 26,636 | 32,156 |
| bitter | 34,156 | 95,632 |
| karla | 24,264 | 28,404 |
| montserrat | 35,508 | 207,872 |
| open-sans | 42,964 | 88,536 |
| inter | 48,432 | 181,384 |
| **total** | **307,892** | **902,692** (902,256 after the RFN rename) |

About 2.9 times the first cut, inside the expected 0.8 to 1 MB. **Correction (QA run 2, finding A): this sentence was false as first written.** With next/font's default `preload: true`, `/signin`, every `/o/*` page and every `/site/*` page preloaded all nine files (902,692 bytes against 307,892 on `main`) through the HTTP `Link` header; the claim is true only after the QA run 2 loop-back below, which measured it. `next/font/local` emits one `@font-face` per file with no `unicode-range`, so the whole file for a face is fetched once that face is used, where `next/font/google` split it by subset. That is the price of one file per family, accepted in the ruling.

### Gates

- `npm run typecheck`, `npm run lint`: clean. `npm run check`: all ten pass (exit 0), with the font tree staged.
- `npm test`: 834 files passed, 140 skipped; 13,289 tests passed, 3,770 skipped (the DB-backed suites).
- Two production builds in a scratch copy under the session scratchpad (outside `~/git/presby-platform/`; main checkout's `.env.local` copied in): plain, and with `CI=1`. Both exit 0 and emit nine woff2 in `.next/static/media` (sizes equal the table above). `grep -rlE "fonts\.googleapis|fonts\.gstatic" .next` finds nothing after either, and neither build log mentions Google. The copy was deleted.
- **Glyph check at 360px**, `next dev` on port 3560 in the scratch copy (stopped by PID), Playwright Chromium from a private `PLAYWRIGHT_BROWSERS_PATH`, CDP `CSS.getPlatformFontsForNode` on a throwaway route that renders `Łukasz Nguyễn Đặng Zoë Šimić Őry Ștefan Ünal Жанна Ωmega № ἀρχή` in Inter and in all four pairings (heading and body, `nowrap` so wrapped spaces are not dropped from the count). For all nine faces the number of glyphs drawn by the bundled (custom) face equals the number of characters in that file's `cmap`, and the rest fell back: no Google request was made. The only fallbacks are the scripts Google does not serve for that family: Greek and polytonic Greek in three of the four heading faces (Libre Franklin, Bitter, Montserrat), and only polytonic Greek (ἀρχή) in Lora, which draws Ω from its math and symbols subsets and falls back on ἀρχή exactly as `main` did, Cyrillic, Greek and ễ ặ in Karla, Cyrillic and Greek in Public Sans, ἀ in Open Sans. Inter, Source Sans 3 and Open Sans draw every character they have. Screenshot (scratchpad only, not committed): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/glyph-360.png`.
- Observation, not a defect: Chromium reports the files' internal family names ("Libre Franklin Thin", "Source Sans 3 ExtraLight"): the upstream name table names the default instance of the source TTF. It affects the "Rendered Fonts" pane only; the CSS family name is next/font's own.

### For QA run 2

Re-run typecheck, lint, `npm run check` and `npm test`; read `font-coverage.test.ts` and, if you want, re-run the swap fail-first; rebuild in a scratch copy and grep for Google; confirm the loose files in `font-files/` are `README.md`, `build-fonts.sh` and `subsets.json`; read the correction to the "Visible difference" section above.

---

## QA run 1 (recorded verbatim by the orchestrator; it ran on `23a4ca2`, before the loop-back above)

### Phase 5 — Verification (qa), run 1

**Date:** 2026-11-01
**Verified by:** qa (read-only; no project file edited, no test authored)
**Scope:** PR #74 as it stands locally at `23a4ca2`: the bundled fonts (`2026-11-01-self-host-fonts`) and the e2e sharding (`2026-11-01-e2e-shard`), which share the branch.

**Where I ran things**
- The static gates and the unit suite ran in the worktree, which has no `.env.local` (CI unit-job shape).
- Builds, servers, DB-backed tests, e2e and the visual work ran in two scratch copies under the session scratchpad, both deleted afterwards:
  - the branch at `23a4ca2`;
  - origin/main at `d530c41`, for comparison.
- Main's `.env.local` (the `development` database) was copied into the scratch copies only. No environment value was printed.

**Flags were not reset.** As instructed, I did not run `scripts/ci/e2e-reset-flags.sql` against `development`. The dev-lane specs ran on whatever flag state `development` holds.

**Not re-run:**
- The full DB-backed vitest set: the diff touches no migration, `authz.ts`, `src/lib/db/` or shared fixture.
- The full `--project=chromium` suite: `src/app/layout.tsx` changed, but only its font loader, so this rests on CI. That CI run has not happened yet (see finding 6).
- `test-rls.sql`.

**Pre-checks**
- `next.config.ts` matches origin/main: `git diff origin/main -- next.config.ts` is empty, so the revert `4f9013e` is complete.
- Disk: 562 GiB free.

## Type Check

`npm run typecheck`: **PASS** (exit 0).
`npm run lint`: **PASS** (exit 0, `--max-warnings=0`).
`npm run check`: **PASS**. All ten tripwires pass; `check:help` reports 29 registry entries, 24 published, 7 images.

## Unit Tests

**`npm test`, CI shape:**
Total: 16,418 | Passed: 12,802 | Failed: 0 | Skipped: 3,616 (137 files) | Duration: 42.6s
The skips are the DB-gated suites, which have no env in this shape.

**DB-backed files the diff changed**, run in scratch with `.env.local` and `--no-file-parallelism`:
- Files: `src/lib/brand/fonts.test.ts`, `src/lib/sites.test.ts`, `src/lib/brand/read-org-brand.test.ts`
- Result: 3 files, 107 passed, 0 skipped.

`fonts.test.ts` has 22 tests, all passing, including the 12 new "self-hosted fonts" cases.

## End-to-End Tests

**Dev lane (desktop)**
- Setup: own `next dev` on 3570; `E2E_BASE_URL`, `NEXT_PUBLIC_APP_URL` and `PORT` set to 3570; flags not reset.
- Specs: `color-scheme` (4), `branded-signin` (5), `public-sites` (7), `careers` (21, which includes a font-size assertion) and `help` (34, which includes a 360px overflow test).
- Total: 71 | Passed: 71 | Failed: 0 | Skipped: 0 | Duration: 2.1m

**Prod lane**
- Command: `npm run test:e2e:prod` with `PW_PROD_PORT=3810` (it builds and starts its own server).
- Total: 109 | Passed: 109 | Failed: 0 | Skipped: 0 | Flaky: 0 | Duration: 3.6m

**Production builds (branch scratch copy)**

| Build | Exit | woff2 in `.next/static/media` | `fonts.googleapis` / `fonts.gstatic` in `.next/` |
|---|---|---|---|
| Plain (`CI` unset) | 0 | 9 (307,892 bytes) | none |
| `CI=1`, from a clean `.next` | 0 | 9 | none |

`grep -rn "next/font/google" src` matches only comments in `fonts.ts` and `layout.tsx`, plus the guard test's own name and header.

**Guard fail-first**
Each plant was a new file in the scratch copy, and I ran the guard test once per plant:

| Plant | Guard result |
|---|---|
| `import { Inter } from "next/font/google"` | FAIL (catches) |
| Single-quoted import (`.tsx`) | FAIL (catches) |
| Multi-line import | FAIL (catches) |
| `export { Inter } from "next/font/google"` | FAIL (catches) |
| The same import in a `.js` file | passes (gap, advisory 2) |
| `require("next/font/google")` | passes (next/font does not transform it) |
| `@next/font/google` | passes (not installed) |

**Visual check: 360px, light and dark, branch on 3570 against main on 3571**
Pages: `/help`, `/signin`, `/o/e2e-presbytery` (the fixture branded org, classic pairing) and `/admin/design-system` (all four pairings).

- **Requests to Google:** none from the branch, from a per-request log. Main's matches were only its own same-origin chunk names (`[next]_internal_font_google…css`); main makes no off-origin request either.
- **Glyph source** (CDP `CSS.getPlatformFontsForNode`): every face is the same on both builds by PostScript name.
  - Inter-Regular.
  - Lora-Regular_SemiBold and SourceSans3-Roman_Regular.
  - LibreFranklin-Thin_SemiBold and PublicSansRoman-Regular.
  - Bitter-SemiBold and Karla-Regular.
  - Montserrat-SemiBold and OpenSans-Regular.
  - Inter's latin woff2 is byte-identical to the one main served: both media files carry the content hash `2bn3s6zvc0dyp`.
- **Pixel diff, branch against main**, from my own probe's screenshots:

  | Page | Result |
  |---|---|
  | `/help` (light, dark) | 0 differing pixels |
  | `/signin` (light, dark) | 0 differing pixels |
  | `/admin/design-system` | about 530 pixels, all in the header and button rows; 0 in the pairings area |
  | `/o/e2e-presbytery` | height differs: main's newer "My groups" card (PR #75), not fonts |

- **`visual-parity.spec.ts` cross-check:** baseline captured on main (80 shots), then `visual:check` on the branch. 28 passed and 52 failed.
  - Every failure traces to one of three causes:
    - The `←`/`→` arrows are painted by the generated `inter Fallback` face. Its `size-adjust` is 107.89% here against 107.12% on main, a sub-pixel change of 1 to 51 pixels per shot (`/account`, `/admin/*`, `/no-organization`).
    - The `/admin` dashboard's live content: 190 to 261 pixels.
    - PR #75's "My groups" card on `/o/e2e-alpha` and `/o/e2e-presbytery`.
  - None is a change of glyph face.
- **Layout shift:** with every woff2 delayed 1.5s, `/help`, `/signin` and `/o/e2e-presbytery` record **zero layout shifts on both builds**. `adjustFontFallback` holds the swap.
- **Coverage regression found** (finding 1):
  - Sample text: `Łukasz Nguyễn Đặng Zoë Šimić Őry Ștefan Ünal`.
  - On main: entirely in the web font (Inter, 43 glyphs).
  - On the branch: 6 glyphs fall back to Arial, and the same happens in the classic body face.
  - Per script on the branch: latin-ext 5 of 11 glyphs in Arial, Vietnamese 2 of 6, Cyrillic and Greek entirely Arial. All of these were Inter on main.

**Licences**
- All 9 directories have an `OFL.txt` with the "SIL OPEN FONT LICENSE Version 1.1" line and the family's copyright line.
- Every woff2 starts `wOF2`.
- Total woff2: 307,892 bytes, and each per-family size matches the work-log.
- 18 files are tracked.
- Note only: Source Sans 3 carries the Reserved Font Name "Source"; the committed file is Google's own subset, distributed under that name.

**Sharding**
`--list --shard=i/4` over the branch's config:
- 839 tests in 102 files (705 `chromium` and 134 `custom-hosts`).
- Shards: 214 / 223 / 202 / 200 tests in 23 / 36 / 20 / 23 files.
- No file appears in two shards, and the union equals the unsharded list.

`e2e.yml` checks:
- Matrix: four `dev` include rows (`shard` 1 to 4) plus `prod` (`shard: 0`).
- Neon branch names: `e2e-<lane>-<run>-<attempt>-s<shard>`, unique, and the same name is used to create and to delete.
- Artifact names: `playwright-traces-<lane>-s<shard>`, unique.
- Limit: `timeout-minutes: 45`.

All as described, apart from the dropped contact lanes (finding 2).

## Regression Tests Added

- `nothing in src/ imports next/font/google — regression for the Turbopack font-query build failure`, at `src/lib/brand/fonts.test.ts:142`.
  - Guards against a reintroduced `next/font/google` import or mock in `src/**/*.ts{,x}`.
  - The implementer reported a fail-first; I reproduced it against four import shapes, listed above.
  - It encodes the class "a TS file imports the module" and not "the build fetches nothing", so a `.js` file escapes it (advisory 2).
- `src/lib/brand/fonts.test.ts:115–140` checks:
  - nine unique named files;
  - each file exists, has `wOF2` magic bytes and an `OFL.txt` beside it;
  - each font directory is used and holds only those two files.
- **No test pins Unicode coverage.** Nothing would have caught finding 1.

## Coverage on Critical Modules

Not re-measured. `src/lib/permissions.ts`, `src/lib/two-factor.ts` and `src/lib/flags.ts` are untouched by this diff.

## Feature-Gate Audit

No protected routes were touched: the diff adds or changes no `route.ts` and no `"use server"` action. Not auth-touching under the stricter gate: `src/app/layout.tsx` is the root layout, not `(auth)`, and the stricter gate's paths are not in the diff.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none | n/a | n/a | n/a |

## Copy Truthfulness

No user-facing string changed. The diff's `.tsx` change is the font loader only. I checked the code comments and work-log claims as instructed:

- [x] Every added or changed string is in the design's Copy table: none added (Phase 3 was skipped and no UI string moved).
- [x] The claims were checked against the build's real behaviour:
  - **FAIL: `src/lib/brand/fonts.ts:36`**, "The latin subset is the same one `subsets: ["latin"]` selected before".
    - `subsets` chose which file was *preloaded*.
    - Main's generated CSS also declared latin-ext, vietnamese, cyrillic and greek faces (plus cyrillic-ext and greek-ext for some families) through `unicode-range`: 51 woff2 on main against 9 here.
  - **Misleading: `fonts.ts:30`**, "what `next/font/google` was already downloading". It downloaded that file and 42 others.
  - **FAIL: work-log claims.** `2026-11-01-self-host-fonts.md:8` ("no visible change intended") and `:24` ("fonts should render identically") are false for any character outside the latin range. `:129` ("Visible difference") lists only the family-name change.
  - **Stale: `src/lib/sites.ts:444-445`**, "Lora is not a function". The loader is now `localFont`.
  - **Overstated:** `fonts.test.ts:19`, `sites.test.ts:68` and `read-org-brand.test.ts:35` say "a face wired to the wrong file shows in a test". Only the contemporary pairing asserts its files (`fonts.test.ts:91-92`), so swapping two faces' files passes every test.
  - **Accurate:**
    - `fonts.ts:41-43`: no swap shift on either build. "the" metric-matched fallback should read "a"; the metrics differ slightly from Google's.
    - `node_modules/next/font/local/index.js` really is 0 bytes.
    - The `layout.tsx` header comment.
- [x] No instruction strings: not applicable.
- [x] Older strings grepped: `docs/testing.md:276` ("CI's fresh branch always can") is now false; see finding 2.
- [x] Help diff: none. The fonts work log states "no help impact" and I agree.

## Findings

**1. FAIL (fonts): characters outside the latin range no longer render in the brand or platform face.**
- **What changed:** latin-ext (Ł ő ș č ā), Vietnamese (ễ ặ), Cyrillic, Greek and symbols like `№` now paint in Arial or Times New Roman (through the fallback face) mid-word, inside Inter and all eight pairing faces. On main, all of them were the web font.
- **Where it shows:** tenant-entered text — person and congregation names, site content, postings, any Greek in worship content. The app's own static strings are unaffected: they use only arrows outside the latin range, and arrows fell back on main too.
- **Remedy: the implementer cannot pick it alone.** This is a bytes-versus-coverage choice with no Phase 3 behind it, so it goes to tech-lead or the operator:
  - **(a) Restore coverage.** `localFont` has no per-file `unicode-range`. The options are full (unsubset) variable woff2 per family, or a per-subset package such as Fontsource, which is a new dependency and needs the architect. Add a test that pins the chosen coverage, for example the woff2's cmap.
  - **(b) Accept latin-only as a recorded residual.** Correct `fonts.ts:30/36` and the work-log lines `:8`, `:24` and `:129`, and state the residual.
- Production deploys are blocked on this branch, so (b) is the quick path if the operator accepts it.

**2. FAIL (sharding, same PR): merge `836feb99` dropped PR #73's contact-form CI lanes.**
- **Evidence:** `.github/workflows/e2e.yml` at HEAD has 0 references to `contact`; origin/main has 9. The merge deleted:
  - "Run the contact-form lane" (`npm run test:e2e:contact`, dev);
  - "Run the contact-form production-build proof" (`npm run test:e2e:contact:prod`, CA13);
  - the `test-results-contact*` trace paths.
- **Effect:** the `chromium` project ignores `e2e/help-contact/`, so after this PR the `/help/contact` specs and the CA13 proof run nowhere in CI.
- **Unrecorded:** `2026-11-01-e2e-shard.md:48` records only the timeout resolution, and that work-log's Phase 5 PASS is from `ccaa2b3`, before the merge.
- **Remedy (orchestrator, the shard's Phase 4 owner):**
  - Restore both steps, the dev contact lane gated to one shard (the lightest, 4/4) or its own matrix row, and the CA13 proof in the prod row.
  - Restore the artifact paths.
  - Correct the shard work-log's Integration line.

## Advisories (not blocking)

1. **Fallback metrics differ slightly from Google's.** Examples: classicBody `size-adjust` 89.41% against 93.76%, Inter 107.89% against 107.12%. This causes the sub-pixel `visual-parity` diffs on `←`/`→`. There is no swap shift.
2. **The guard scans only `.ts`/`.tsx`.** `src/` has no JS file today; widening the extension list closes the gap.
3. **The mock comment overstates file-wiring coverage** (see the Copy section).
4. **Thin headroom on shard 1:** 33m31s of the 45-minute limit on `ccaa2b3`. Put any restored contact lane on the lightest shard.
5. **The font commits have never run in CI.** PR #74's remote head is `1e12716`; `9454668` and `23a4ca2` are unpushed. CI on `1e12716` failed `dev lane 2/4` with the very bug this fixes ("next/font/google queries have exactly one entry", Bitter), then cascaded to a 45-minute cancel. That is pre-fix evidence. A green PR run on the pushed head is needed before merge.
6. **The branch is behind main by PR #75.** A trial `merge-tree` conflicts only in `docs/TODO.md` (a Rule 16 file, for the orchestrator). Main adds no `next/font/google` use. The fonts commits touch no Rule 16 file.
7. **Environment hazard for other agents.** The `presby-deps` worktree upgraded Playwright (browser build 1248) at about 17:59. Its install garbage-collected build 1223 from the shared `~/Library/Caches/ms-playwright`. Every worktree still on `@playwright/test` 1.60.0 will fail with "Executable doesn't exist" until it reinstalls. I used a private `PLAYWRIGHT_BROWSERS_PATH` for every run after 17:59, so the shared cache is untouched.

## Verdict

**FAIL.** Two findings send PR #74 back:
- **Fonts:** the build fix works. No Google fetch, the same faces, pixel-identical `/help` and `/signin`, no swap shift, all gates green. But it silently drops non-latin coverage, which contradicts the stated "renders identically", and a code comment asserts otherwise.
- **Sharding:** the integration merge removed the contact-form CI lanes.

---

**Per-Phase Status rows**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (`2026-11-01-self-host-fonts`) | qa | Run 1 complete | FAIL (Unicode coverage regression; false subset comment and work-log claims) | 2026-11-01 |
| 5 — Verification (`2026-11-01-e2e-shard`, re-opened) | qa | Run 1 complete | FAIL (merge `836feb99` dropped the contact-form lanes) | 2026-11-01 |

**Handoff**
- **Fonts:** back to **full-stack-developer**, after a **tech-lead or operator ruling** on coverage, (a) or (b) above. Cite `src/lib/brand/fonts.ts:30,36` and work-log `:8`, `:24`, `:129`. Fix `sites.ts:444-445` and the three mock comments in the same pass.
- **Sharding:** back to the **orchestrator**. Restore the steps in `.github/workflows/e2e.yml` (the dev contact lane, the CA13 prod proof, the artifact paths). Correct `2026-11-01-e2e-shard.md:48`.
- **Next:** push, get a green PR #74 run on the new head, then QA run 2 (scoped to the fixes and the CI result). Phase 6 cannot start from this verdict.

**Evidence** is in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa-out/`:
- `fontprobe.json`: the per-glyph face report.
- `shots/`: the 360px screenshots and branch-against-main crops.
- `visual-check-branch.log`: the parity run.
- `e2e-dev.log`, `e2e-prod.log`, `unit.log`, `build-*.log`: the test and build logs.
- `ci-shard2.log`: the failed CI shard's log.

The two scratch copies (with their `.env.local`) and the private browsers are deleted, and nothing is listening on 3570, 3571 or 3810.

---

## Phase 4 loop-back (QA run 2, finding A and RFNs)

**Finding A (FAIL):** the log said a browser downloads only the face a page uses. It did not: `/signin`, every `/o/*` page and every `/site/*` page preloaded all nine woff2 (902,692 bytes against 307,892 on `main`), because `next/font` turns `preload: true` (its default) into an HTTP `Link: rel=preload` header per font file, for every route that imports the module, and `next-font-manifest.json` lists all nine files for 87 routes. **Orchestrator ruling: option (a)**, `preload: false` on the eight pairing faces; Inter keeps its preload.

### What changed

- `src/lib/brand/fonts.ts`: `preload: false` on all eight `localFont()` calls, with the reason in the header comment. `src/app/layout.tsx`: Inter's `preload: true` is now written out (it was the default) so the test can pin it.
- **Test, fail-first:** `fonts.test.ts` now records every options object `fonts.ts` passes to `localFont()` and asserts all eight (named by variable, so a ninth or a missing one fails too) have `preload === false`; a second test reads Inter's `localFont({...})` in `layout.tsx` and asserts `preload: true`. With the eight `preload: false` lines and Inter's `preload: true` removed, both failed (`--font-heading-classic: expected undefined to be false`; `expected ... to match /preload:\s*true/`); restored, 25 pass.
- **Reserved Font Names (OFL 1.1 section 3).** Our files are instanced and subsetted Modified Versions, so they may not carry a Reserved Font Name. Every family's `OFL.txt` was read for a "Reserved Font Name" clause:

  | family | Reserved Font Name | action |
  |---|---|---|
  | Lora | `Lora` | renamed to "PP Classic Serif" |
  | Source Sans 3 | `Source` | renamed to "PP Classic Sans" |
  | Bitter | `Bitter Pro` | none: we ship "Bitter", which is not that name |
  | Libre Franklin, Public Sans, Karla, Montserrat, Open Sans, Inter | none | none |

  New `font-files/rename-rfn.py` (run at the end of `build-fonts.sh`) rewrites name IDs 1, 3, 4, 6, 16, 17, 21 and 22 and exits non-zero if the RFN is left in any of them. Name ID 0, the copyright notice that itself says "with Reserved Font Name ...", is kept as upstream wrote it: the licence requires the notice and it is a statement, not a use of the name. Lora's names are now `PP Classic Serif`, `PPClassicSerif-Regular` and so on; Source Sans 3's `PP Classic Sans`, `PPClassicSans-Roman`. While there, Source Sans 3's name ID 1 and 3 no longer say "ExtraLight" (an instancer leftover; the default instance is 400). The README documents all of this.
- **Glyphs identical, verified.** `build-fonts.sh` was run end to end (rebuild from the pinned upstream commit) and the two outputs compared table by table, with fontTools, against the pre-rename files from `HEAD` and against the rename applied directly to them: `cmap`, `glyf`, `gvar`, `GSUB`, `GPOS`, `hmtx`, `fvar`, `avar` (Source), `HVAR`, `STAT`, `OS/2`, `hhea`, `maxp` and the glyph order all identical; `head` differs only in `checkSumAdjustment` and `modified`. The two committed files are the pre-rename bytes put through `rename-rfn.py`, so only the `name` table differs; the other seven woff2 are untouched (a full rebuild re-encodes them with new bytes and no content change, so those were restored from `HEAD`). Sizes: Lora 80,796 to 80,556, Source Sans 3 127,004 to 126,808; the nine now total 902,256 bytes.
- **Tests added** to `font-coverage.test.ts` (81 tests, was 62): per family, no `name` record other than ID 0 contains that family's Reserved Font Name (a small `name`-table reader in the file; Lora, Source and Bitter checked); and per family, the `weight:` range declared in `fonts.ts` / `layout.tsx` equals the file's `fvar` range, plus a test that the declarations cover all nine families. **Fail-first:** the HEAD (un-renamed) Lora and Source files failed the RFN test (2 failures); `classicBody`'s weight changed to "400 700" failed the weight test (1 failure); restored, all pass.
- **QA's minor items:** `fonts.ts` header (per-family subsets: Karla has latin and latin-ext only; `font-coverage.test.ts` is what parses each woff2; two visible differences, the CSS family name and, now, the font's internal name; the fallback is generated from the local Arial / Times New Roman metrics, not "the one `next/font/google` generated"); `layout.tsx` (Inter also has cyrillic-ext and greek-ext); `font-files/README.md` ("the union of the subsets Google serves for that family"; byte table); the stale U+1E9E mention in `font-coverage.test.ts` (Public Sans's latin-ext row is now just the shared sample); this log's former line 183 (marked as a correction in place, above) and the Lora Ω line (190). `fonts.test.ts`'s loose-files pin now lists `rename-rfn.py` too.

### Measured, before and after

Production build of a scratch copy (`next build`, `next start -p 3820`), Chromium at 360 x 800, a fresh context per page, woff2 `responseBodySize` summed from `requestfinished`; "before" is QA run 2's own measurement. `/o/e2e-presbytery` signed in as the seeded `presbytery-clerk` (classic pairing).

| page | before: font preloads (Link header) | before: woff2 downloaded | after: font preloads | after: woff2 downloaded |
|---|---|---|---|---|
| `/help` | 1 (Inter) | 1 file, 181,384 B | 1 (Inter, an HTML `<link>`) | 1 file, 181,384 B |
| `/signin` | 9 | 9 files, 902,692 B | 1 (Inter) | 1 file, 181,384 B |
| `/o/e2e-presbytery` | 9 | 9 files, 902,692 B | 1 (Inter) | 3 files, 388,748 B (Inter, Lora, Source Sans 3) |

(For `main`, with `next/font/google` and its per-subset `unicode-range`: 48,432 B for `/help` and 307,892 B for the other two, from QA's earlier capture. Our per-family files are bigger because the whole file for a face comes down once that face is used, the price accepted in the ruling.) The other two `Link` entries on each page are stylesheets, not fonts. The `/o` page now draws only `classicHeading` and `classicBody`; the other six pairing faces are never requested.

**Cumulative layout shift, every woff2 delayed 1.5 s** (Playwright `page.route`, `PerformanceObserver` for `layout-shift` entries without recent input, read 5 s after load; a positive control that prepends a 120 px block read 0.15, so the observer does see shifts):

| page | CLS, no delay | CLS, fonts delayed 1.5 s |
|---|---|---|
| `/help` | 0 | 0 |
| `/signin` | 0 | 0 |
| `/o/e2e-presbytery` | 0 | 0 |

Zero with preload off, as well as on. `adjustFontFallback` holds the metrics through the swap, including for the pairing faces that now load late. I measured the pages named in the ruling; `/site/<slug>` pages draw the same pairing faces through the same mechanism but were not separately timed.

### Gates

- `npm run typecheck`, `npm run lint`, `npm run check` (all ten): clean. `npm test`: 834 files passed, 140 skipped; 13,310 tests passed, 3,770 skipped.
- Two production builds in a scratch copy under the session scratchpad (outside `~/git/presby-platform/`; main checkout's `.env.local` copied in): plain, and `CI=1`. Both exit 0, nine woff2 in `.next/static/media` totalling 902,256 bytes; `grep -rlE "fonts\.googleapis|fonts\.gstatic" .next` finds nothing and neither log mentions Google.
- Prod-lane hydration specs (`PW_PROD_PORT=3810 npm run test:e2e:prod`, scratch copy): 111 passed. Brand dev specs (`color-scheme`, `branded-signin`, `public-sites`, `help`) on port 3570: 50 passed. No server is left listening (each stopped by PID).
- The visual proof of the swap is the CLS table above; the dev specs also exercise the `(org)` and `/site` trees under the renamed Lora and Source Sans 3 files.

### For QA run 3

Re-run the gates; read the two new tests and re-run both fail-firsts; re-measure preloads and bytes on a production build (the `Link` header on `/signin` and a signed-in `/o/<slug>` should name only the Inter file); confirm `font-files/` loose files are `README.md`, `build-fonts.sh`, `rename-rfn.py`, `subsets.json`; read the README's RFN section against each `OFL.txt`.

---

## QA run 2 (recorded verbatim by the orchestrator; it ran on `c1d96d26`, before the loop-back above). Orchestrator ruling on finding A: option (a), `preload: false` on the eight pairing faces, with Inter preloaded.

### Phase 5 — Verification (qa), run 2

**Date:** 2026-11-02
**Verified by:** qa (read-only; no project file edited, no test authored)
**Scope:** PR #74 locally at `c1d96d26`: the fixes for run 1's findings 1 and 2, the `origin/main` merge `4e56f8f6`, and what those fixes touch.

**Where I ran things**
- **Worktree** (no `.env.local`, CI unit shape): the static gates and the unit suite only.
- **Two scratch copies under the session scratchpad:** the branch at `c1d96d26` and `origin/main` at `d530c41f`. Everything else ran there, with main checkout's `.env.local`.
  - Each copy had its own parent directory, because Turbopack's root is `..` (the TODO's sibling-checkout hazard).
  - Both copies are now deleted.
- **Environment values:** none printed. Two read-only `select`s ran on `development`, checked by length or by result only.
- **Flags were not reset** on `development`, as instructed. The dev-lane specs ran on its current flag state.
- **Disk:** 559 GiB free. **Browsers:** a private `PLAYWRIGHT_BROWSERS_PATH`, deleted afterwards.

**Not re-run, and what it rests on**
- **Full `--project=chromium` suite.** `src/app/layout.tsx` is in the diff, so my rules call for it, but the change there is the font loader only. It rests on PR #74's CI run on the pushed head, and **that run has not happened**. The remote head is still `1e12716`, and the seven commits from `9454668` to `c1d96d26` are unpushed. CI on `1e12716` failed `dev lane 2/4`, which run 1 traced to the very bug this PR fixes.
- **DB-backed vitest and `test-rls.sql`.** Nothing since run 1 touches a migration, `authz.ts`, `src/lib/db/` or a fixture.

## Type Check

- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS** (`--max-warnings=0`)
- `npm run check`: **PASS**. All ten tripwires pass; `check:help` reports 29 entries, 24 published, 7 images.

## Unit Tests

Total: 17,059 | Passed: 13,289 | Failed: 0 | Skipped: 3,770 (140 files, the DB-gated suites with no env in this shape) | Duration: 41.8s

- `font-coverage.test.ts` and `fonts.test.ts`: 85 pass (62 + 23).

**Fail-first, reproduced in the branch copy and restored each time:**

| Plant | Result |
|---|---|
| Inter and Montserrat swapped for the latin-only cuts from `23a4ca2` | 11 failures, each naming the missing code points (U+0141, U+1EC5, U+0416, U+03A9 …). Montserrat's axis test also fails (`wght 100–900` against `400–800`). |
| `fonts.ts`: Lora and Bitter heading paths swapped (both paths still exist) | "wires each face to its own file" fails |
| `fonts.ts`: Libre Franklin and Public Sans swapped within one pairing | same test fails |
| Guard: `require()` in a `.cjs`, `import()` in a `.mjs`, `export … from` in a `.js`, `vi.mock()` in a `.tsx` | all four caught. Run 1's advisory 2 is closed. |

**Is the coverage test circular? No.**
- `FAMILIES` and `SAMPLE` are hand-written literals; nothing reads `subsets.json` or the files to build expectations.
- Each family's subset list matches the keys in `subsets.json`, 51 in total.
- `subsets.json`, expanded to code-point sets, equals the `unicode-range` set of every one of the 51 `@font-face` blocks main's own build emitted.

**Is the decoder sound? Yes.** I extracted lines 22–142 verbatim with `sed` and compared them against fonttools 4.68.0 in a throwaway venv, for all nine files:
- Code-point sets are identical, as are the `fvar` axes (tag, min, default, max) and the table directory.
- Header offsets, the 63-tag table, the transform-version rule and the cmap format 4 and 12 layouts all match the WOFF2 and OpenType specs.
- Caveat: all nine files use cmap format 4 only, so the format-12 branch is never exercised by real data.

## End-to-End Tests

| Lane | Server | Result | Duration |
|---|---|---|---|
| `test:e2e:prod` (prod-build and prod-custom-hosts projects) | own build, port 3810 | 111 / 111, 0 skipped (run 1 had 109; the main merge adds 2) | 5.0m |
| Brand dev specs: `color-scheme` 4, `branded-signin` 5, `public-sites` 7, `help` 34 | own `next dev`, 3570 | 50 / 50, 0 skipped | 46.7s |
| `test:e2e:contact` | own keyed `next dev`, 3570 | 12 / 12, 0 skipped | 22.5s |
| `test:e2e:contact:prod` (CA13), attempt A | own build, 3810 | 4 passed, **1 skipped**: (d) `prod-build.spec.ts:118` | 31.3s |
| `test:e2e:contact:prod`, attempt B, after the window freed (16:57 UTC) | own build, 3810 | **5 / 5**, (d) included | 14.9s |

- **Why (d) skipped in attempt A:** my own contact dev run, a minute earlier on the shared `development` database, had claimed the hourly notification window. That is the spec's stated skip condition. In CI the dev contact lane (shard 4) and the CA13 proof (prod row) run on separate ephemeral branches, so this cannot happen there.
- **One aborted prod attempt** before these runs is my own fault: stale `.next/dev/types` from my throwaway route. Not a branch defect.

**Production builds (branch copy)**

| Build | Exit | woff2 emitted | Google refs in `.next/` | Google in build log |
|---|---|---|---|---|
| Plain | 0 | 9 (902,692 bytes) | 0 | 0 |
| `CI=1`, clean `.next` | 0 | 9, byte-identical to the committed files | 0 | 0 |

`font/google` appears only in four `.js.map` source maps, which carry the new explanatory comments.

**Coverage compared with main (main built in the second copy: 51 Google woff2)**
- For every family, the branch file maps every code point main could draw (the cmap ∩ the declared `unicode-range`). Missing in the branch: 0 for all nine.
- The branch maps 2 to 58 more per family.

**Glyph check at 360px**
- Setup: CDP `CSS.getPlatformFontsForNode` on a throwaway `/help/zz-qa-glyphs` route in both scratch copies only. Each word of `Łukasz Nguyễn Đặng Zoë Šimić Őry Ștefan Ünal Жанна Ωmega № ἀρχή` sat in its own span, rendered in Inter and in all eight pairing faces.
- **Per family and per word, the branch draws exactly what main draws.**
- **Families or scripts where the branch falls back and main did not: none.**

| Face | Falls back on both builds |
|---|---|
| Inter, Source Sans 3 | none |
| Lora | ἀρχή |
| Libre Franklin, Bitter, Montserrat | Ωmega, ἀρχή |
| Public Sans | Жанна, Ωmega, №, ἀρχή |
| Karla | Nguyễn, Đặng, Жанна, Ωmega, №, ἀρχή |
| Open Sans | ἀρχή |

- **Requests:** no off-origin request from the branch.
- **Weights:** text widths at 400, 600, 700 and 800 match main within 0.6 px over roughly 370 px for every face, and clamping is the same. The internal "Thin" / "ExtraLight" names are cosmetic.
- I read `glyph-branch.png`: no tofu, all nine faces draw.

**Build kit**
- I ran `build-fonts.sh` exactly as the README says (`WORK=$(mktemp -d)`) on a scratch copy of `font-files/`.
- All nine files rebuilt, within about 300 bytes of the committed ones. Their cmaps, `fvar`, glyph counts, table sets and font revisions are identical to the committed files.
- The script contains no absolute paths, user names or secrets. Its only URLs are the public google/fonts raw URL pinned to SHA `6c1dbe27…`, and the README cites the public CSS2 URL.

**`e2e.yml` against `origin/main`**
- The diff is the matrix `include` rows, the `-s<shard>` branch and artifact names, the 45-minute limit, `--shard=i/4`, the header comment, and `if: … && matrix.shard == 4` on the contact dev lane. Nothing else.
- The CA13 step and all four trace paths are identical to main; the file has 9 `contact` references, as main does.
- Run 1's finding 2 is resolved. The work-log's Integration line (`2026-11-01-e2e-shard.md:48`) is corrected.

**Page weight, measured on production servers for both builds at 360px**

| Page | Branch | Main |
|---|---|---|
| `/help` | 1 woff2, 181,384 bytes (Inter) | 1 woff2, 48,432 bytes |
| `/signin` | **9 woff2, 902,692 bytes** | 9 woff2, 307,892 bytes |
| `/o/e2e-presbytery` (signed in, classic pairing) | **9 woff2, 902,692 bytes** | 9 woff2, 307,892 bytes |

- The preloads come from `next/font`'s HTTP `Link` header. `next-font-manifest.json` lists all nine files for 87 route entries on both builds, including every `/o/*` and every `/site/[slug]` page; 46 entries preload Inter only.
- The browser downloaded all nine, although each page used only Inter, or Inter plus its own pairing. This is finding A.

## Regression Tests Added

| Test | Guards against |
|---|---|
| `src/lib/brand/font-coverage.test.ts:220` "draws the %s subset" (51 cases) | loss of a Google subset in any family. Fail-first reproduced. |
| `src/lib/brand/font-coverage.test.ts:227` "only axis is wght, spanning the declared weights" | wrong or extra axes, wrong range. Fail-first reproduced (Montserrat). |
| `src/lib/brand/font-coverage.test.ts:236` | the reader passing vacuously on a non-woff2 file |
| `src/lib/brand/fonts.test.ts:80` "wires each face to its own file (all eight)" | cross-wired faces. Fail-first reproduced twice. |
| `src/lib/brand/fonts.test.ts:172` "nothing in src/ imports next/font/google — regression for the Turbopack font-query build failure" | reintroduced `next/font/google`. Fail-first reproduced in 4 shapes. |
| `src/lib/brand/fonts.test.ts:141`, `:155` | the file set and the directory layout |

**Gaps:**
- Nothing pins which fonts a route preloads, so finding A has no test.
- The `weight:` ranges in `fonts.ts` are not cross-checked against each file's `fvar`. The coverage test hand-writes them separately, so the two can drift apart.

## Coverage on Critical Modules

Not re-measured. `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched.

## Feature-Gate Audit

No protected routes touched: no `route.ts` and no `"use server"` action in the diff. Not auth-touching.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none | n/a | n/a | n/a |

## Copy Truthfulness

No user-facing string changed. As instructed, I checked the corrected comments and work-log claims against measured behaviour.

- [x] Bytes: 902,692 total, and every per-file figure in the work-log table and `README.md` matches the build output. "About 2.9 times" (2.93) and "0.8 to 1 MB" are accurate.
- [x] "Same coverage as main": true, and more precisely a superset. Work-log lines `:8` and `:24`, the `:128` correction, the `:157–158` subset lists and the `:162–164` validation claims all reproduce.
- [x] Mock comments in `fonts.test.ts:19`, `sites.test.ts` and `read-org-brand.test.ts`, and `sites.ts:444–447`: accurate now.
- [ ] **`copy truthfulness: FAIL`: `docs/work-log/2026-11-01-self-host-fonts.md:183`**, the per-face download note.
  - The claim: "A browser downloads only the face a page uses, and the platform pages use Inter only (181 KB) … the whole file for a face is fetched once that face is used." It then calls this "the price … accepted in the ruling".
  - Measured: true for `/help`. False for `/signin` (a platform page, seen by anyone signing in), for every `/o/*` page and for every public `/site/*` page. These preload and download all nine files, 902,692 bytes, against 307,892 on main. That is +594,800 bytes, 2.9×, on a first visit, mostly on phones. Files are cached afterwards.
  - The operator's acceptance was priced on the false premise.
- [ ] Minor items, to fix in the same pass (none blocks alone):
  - `src/lib/brand/fonts.ts:42`: "`fonts.test.ts` parses each woff2 and pins the coverage". It is `font-coverage.test.ts`.
  - `fonts.ts:43`: "The one visible difference … is the CSS family name". The corrected work-log (`:8`, `:24`, `:128`) names two differences.
  - `fonts.ts:47`: "keeps the metric-matched fallback `next/font/google` generated". Carried over from run 1: it is a fallback generated from local metrics (Inter `size-adjust` 107.89% against 107.12%).
  - `fonts.ts:29–32` and `font-files/README.md:19–21`: the list reads as if every family has the Cyrillic and Greek subsets. Only "the union of the subsets Google serves for it" is true; Karla has latin and latin-ext only.
  - `src/app/layout.tsx:20–21`: "every Google subset: latin, latin-ext, vietnamese, cyrillic, greek". Inter's file also has cyrillic-ext and greek-ext.
  - `font-coverage.test.ts:184`: the comment names U+1E9E, which is not in the sample. It is left over from an earlier draft.
  - Work-log `:190` lists Greek as a Lora fallback. Lora draws Ω (math subset) and falls back only in ἀρχή, the same as main.
- [x] Older strings grepped: `docs/testing.md`'s "CI's fresh branch always can" holds again with the lanes restored.
- [x] Help diff: none. "No help impact" stands.

## Findings

**A. FAIL (fonts): the download-cost claim is false, and the real cost was never ruled on.**
- **What:** see the page-weight table and the Copy item. Main already preloaded all nine faces on these routes (`fonts.ts` reaches the route graph through the brand and branded-signin paths). That is pre-existing. The branch's full-coverage files make it 2.9× heavier, and the record says the opposite.
- **Not the implementer's call alone.** It goes back to the operator or tech-lead, who choose one:
  - **(a) `preload: false` on the eight pairing `localFont()` calls.** Inter keeps its preload. A page then downloads only its own pairing, on demand: about 389 KB on a classic `/o/*` page, 181 KB on `/signin`. This needs:
    - a re-measured swap layout shift without preload (run 1 measured zero only with preload on);
    - a test that pins the preload set.
  - **(b) Accept the measured cost.** Rewrite `:183` with the measured numbers and record the operator's explicit acceptance of 902,692 bytes on `/signin`, `/o/*` and `/site/*`. No code change.
- Either way, `:183` and the minor items above are corrected in the same pass. (b) is the quick path while production deploys stay blocked.

**Run 1 findings:**
- Finding 1 (coverage): resolved.
- Finding 2 (contact lanes): resolved.

## Advisories (not blocking)

1. **CI has never run this head.** Push, and get a green PR #74 run before merge. The full chromium suite rests on it.
2. **OFL Reserved Font Names.** Lora (RFN "Lora") and Source Sans 3 (RFN "Source") are now our own instanced and subsetted Modified Versions, and still carry those names in the `name` table. Run 1's mitigation ("Google's own subset") no longer applies. OFL 1.1 §3 restricts RFNs in Modified Versions. This is an operator licence question; I am not ruling on it. Bitter's RFN is "Bitter Pro", which is not used.
3. **The format-12 cmap path is unexercised.** All files are format 4 today.
4. **Run 1 advisories:**
   - 2, 3 and 6: closed.
   - 1: now recorded in the work-log.
   - 7: private browsers used again.
   - 4 (shard headroom): CI on `1e12716` took 18m, 17m and 10m on shards 1, 3 and 4.
5. **My own process errors, recorded:**
   - My first scratch directory name collided with a pre-existing `scratchpad/qa2`, and my rsync merged into its `branch/` and `main/`. I abandoned it, redid the copies in `fq2`, and removed the `.env.local` files I had put in `qa2`.
   - A mistaken `cp` overwrote run 1's `qa-out/e2e-prod.log` with this run's file. Run 1's evidence for 109 / 109 now lives only in its verbatim work-log text.
   - Nothing in the repository or worktree was touched; `git status` is clean at `c1d96d26`.

## Verdict

**FAIL**, on one finding (A).
- Every check the brief named is green:
  - the gates;
  - both fail-firsts;
  - the decoder against fonttools;
  - the non-circular coverage test;
  - coverage ≥ main for all nine families, with no glyph regression at 360px;
  - two Google-free builds;
  - every e2e lane: 111, 50, 12 and 5 / 5;
  - the `e2e.yml` diff;
  - a build kit that reproduces itself.
- The fail is the per-face download note: it is false, the operator accepted the cost on it, and `/signin`, every congregation page and every public church site now preload 902,692 bytes.
- **Sharding, judged alone, passes.**

---

**Per-Phase Status rows**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (`2026-11-01-self-host-fonts`) | qa | Run 2 complete | FAIL (finding A: `:183` download claim false; all nine faces preloaded on `/signin`, `/o/*` and `/site/*`, 902,692 bytes against 307,892 on main; operator or tech-lead ruling needed). Run 1 finding 1 resolved. | 2026-11-02 |
| 5 — Verification (`2026-11-01-e2e-shard`, re-opened) | qa | Run 2 complete | PASS (finding 2 resolved: the contact dev lane is on shard 4, CA13 is restored, the trace paths match main; both contact lanes green locally). Merge still needs a green PR CI run on the pushed head. | 2026-11-02 |

**Handoff**
- **Fonts:** to the **operator or tech-lead** for the (a) / (b) ruling on finding A, then to **full-stack-developer**. Fix `docs/work-log/2026-11-01-self-host-fonts.md:183` and, in the same pass, `src/lib/brand/fonts.ts:29–32, 42, 43, 47`, `src/app/layout.tsx:20–21`, `src/lib/brand/font-files/README.md:19–21` and `src/lib/brand/font-coverage.test.ts:184`. Under (a), add a test pinning the preload set.
- **Sharding:** no further QA work. Push, and a green PR #74 run closes it.
- **Next:** QA run 3, scoped to finding A and the CI result on the pushed head. Phase 6 cannot start from this verdict.

**Evidence** is in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa-out/run2/`:
- `main-vs-branch-coverage.txt`, `glyph-compare.txt`, `glyph-branch.png` and `glyph-main.png`;
- `fetch-branch.json` and `fetch-main.json` (finding A), `w-*.json`;
- the `e2e-*.log`, `build-*.log` and `gates-*` logs, and `kit-build.log`.

The decoder harness and the comparison scripts are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/fq2/tools/`. The scratch copies, venvs and private browsers are deleted, and nothing is listening on 3570, 3571 or 3810.
