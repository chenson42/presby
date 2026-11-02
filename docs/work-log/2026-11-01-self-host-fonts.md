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
| lora | 37,792 | 80,796 |
| source-sans-3 | 28,804 | 127,004 |
| libre-franklin | 29,336 | 60,908 |
| public-sans | 26,636 | 32,156 |
| bitter | 34,156 | 95,632 |
| karla | 24,264 | 28,404 |
| montserrat | 35,508 | 207,872 |
| open-sans | 42,964 | 88,536 |
| inter | 48,432 | 181,384 |
| **total** | **307,892** | **902,692** |

About 2.9 times the first cut, inside the expected 0.8 to 1 MB. A browser downloads only the face a page uses, and the platform pages use Inter only (181 KB). `next/font/local` emits one `@font-face` per file with no `unicode-range`, so the whole file for a face is fetched once that face is used, where `next/font/google` split it by subset. That is the price of one file per family, accepted in the ruling.

### Gates

- `npm run typecheck`, `npm run lint`: clean. `npm run check`: all ten pass (exit 0), with the font tree staged.
- `npm test`: 834 files passed, 140 skipped; 13,289 tests passed, 3,770 skipped (the DB-backed suites).
- Two production builds in a scratch copy under the session scratchpad (outside `~/git/presby-platform/`; main checkout's `.env.local` copied in): plain, and with `CI=1`. Both exit 0 and emit nine woff2 in `.next/static/media` (sizes equal the table above). `grep -rlE "fonts\.googleapis|fonts\.gstatic" .next` finds nothing after either, and neither build log mentions Google. The copy was deleted.
- **Glyph check at 360px**, `next dev` on port 3560 in the scratch copy (stopped by PID), Playwright Chromium from a private `PLAYWRIGHT_BROWSERS_PATH`, CDP `CSS.getPlatformFontsForNode` on a throwaway route that renders `Łukasz Nguyễn Đặng Zoë Šimić Őry Ștefan Ünal Жанна Ωmega № ἀρχή` in Inter and in all four pairings (heading and body, `nowrap` so wrapped spaces are not dropped from the count). For all nine faces the number of glyphs drawn by the bundled (custom) face equals the number of characters in that file's `cmap`, and the rest fell back: no Google request was made. The only fallbacks are the scripts Google does not serve for that family: Greek and polytonic Greek in the four heading faces (Lora, Libre Franklin, Bitter, Montserrat), Cyrillic, Greek and ễ ặ in Karla, Cyrillic and Greek in Public Sans, ἀ in Open Sans. Inter, Source Sans 3 and Open Sans draw every character they have. Screenshot (scratchpad only, not committed): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/glyph-360.png`.
- Observation, not a defect: Chromium reports the files' internal family names ("Libre Franklin Thin", "Source Sans 3 ExtraLight"): the upstream name table names the default instance of the source TTF. It affects the "Rendered Fonts" pane only; the CSS family name is next/font's own.

### For QA run 2

Re-run typecheck, lint, `npm run check` and `npm test`; read `font-coverage.test.ts` and, if you want, re-run the swap fail-first; rebuild in a scratch copy and grep for Google; confirm the loose files in `font-files/` are `README.md`, `build-fonts.sh` and `subsets.json`; read the correction to the "Visible difference" section above.
