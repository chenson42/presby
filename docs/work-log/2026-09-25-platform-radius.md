# Platform-wide `--radius` 0.5rem → 0.625rem — Work Log

> **Slug:** `2026-09-25-platform-radius`
> **Surface:** every route group — one platform token in `src/app/globals.css` (`--radius`, and the derived `--radius-sm/md/lg/xl` if they are expressed in terms of it); the visual-regression baseline (`e2e/visual-parity.spec.ts`, `e2e/support/routes.ts`). No component, no schema, no server logic.
> **Permission(s):** none. **Flag(s):** not needed — a platform token has no per-org toggle; it is either the platform value or not.
> **Estimated complexity:** small
> **Pipeline mode:** Polish / visual (CLAUDE.md Classification). Work-log required; **Phase 2 skipped** — no new deps, no structural change, and the architect already ruled on this exact change in Track B's Phase 2 Ruling 2(b) (`docs/work-log/2026-09-25-brand-visual-parity.md`): per-org radius stays platform (DECISION-048); a one-time platform-wide bump is a platform design change to be done as its own Polish work-log *after* Track B ships, with a deliberate baseline re-capture reviewed as a screenshot set rather than a pass/fail diff, and `globals.css:165-187`'s "provable no-op" comment rewritten in the same commit. **Phase 3 skipped** — the design is that ruling. Parallel-pipeline rules (Rule 16): touches nothing another pipeline holds.
> **Source:** operator decision 2026-09-25 ("Yes, after Track B"); `docs/TODO.md` Ready to build → "Platform-wide `--radius` 0.5rem → 0.625rem". fpcw-directory's value is 0.625rem (`~/git/fpcw-directory/src/app/globals.css:62`), the shadcn registry default; presby chose 0.5rem deliberately (DECISION-048 era) and the comment at `globals.css:165-187` says not to "align with the registry" — that comment becomes false and must be rewritten, not deleted.
> **Scope:** the token value; `globals.css` comment; re-baseline of the visual project reviewed as before/after screenshot pairs (every corner in every screenshot moves, so `maxDiffPixels: 0` diffs are noise — the review artefact is the pair, and the sign-off is the operator's or QA's eye on the pairs at 360 and 1280, both schemes); confirm no primitive hard-codes a radius that now mismatches (grep `rounded-[` and literal `border-radius`). **Out:** any per-org radius; any change to `contract.ts`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (brief) | READY FOR DESIGN | 2026-09-25 |
| 2 — Architectural review | architect | Skipped — Polish class; ruled in Track B Phase 2 Ruling 2(b) | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Skipped — Polish class; the design is the ruling (one token, comment rewrite, re-baseline reviewed as pairs) | — | 2026-09-25 |
| 4 — Implementation | ux-developer | Complete (second pass — corrected the two text-only Phase 5 findings: utility counts at `globals.css:186-187`, pair-set description in this work-log) | — | 2026-09-25 |
| 5 — Verification | qa | Complete — FAIL on two factual claims (text-only), then re-verified PASS after the Phase 4 second pass | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.25.3 (`style(ui):`); follow-ups 1–2 in TODO, 3 closed by DECISION-145, 4 by the Downloads montage | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Brief, recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> One number in `globals.css` (`--radius: 0.5rem` → `0.625rem`) repaints every rounded corner in every route group at once, on a build with zero signed-in production users — low risk, but the only honest verification is a human looking at 80 screenshot pairs, not a green CI diff.

## What Changes, Precisely

**Exactly one literal.** `src/app/globals.css:47`. The derived scale (`:188-191`) is already `calc(var(--radius) ± Npx)`: `sm` 4→6px, `md` 6→8px, `lg` 8→10px, `xl` 12→14px; `full` and the unremapped `xs`/`2xl`/`3xl` are unaffected. Every `rounded-sm/md/lg/xl` consumer moves — every shadcn primitive (buttons, cards, inputs, badges, dialogs/sheets, menus, tabs, tooltips, toasts, checkboxes); `rounded-md` 71×, `rounded-lg` 23×, `rounded-xl` 6×, `rounded-sm` 5×.

## Hard-coded radii

`grep -rn "rounded-\[" src/` → **zero**. `grep -rn "border-radius" src/` → two, both benign: `developer.css:284` `border-radius: 50%` (a circle); `sonner.tsx:32` `"--border-radius": "var(--radius)"` (reads the token). Nothing left behind at the old geometry.

## Verification Protocol

The harness (`e2e/visual-parity.spec.ts`, `maxDiffPixels: 0`, gitignored `.visual/` baselines never committed) answers "did anything *other than the radius* move"; against an unchanged baseline it would report 80/80 expected diffs and tell a reviewer nothing. The artefact is a **before/after screenshot pair per route × viewport × scheme — 20 × 2 × 2 = 80 pairs**, captured from `npm run build && PORT=3100 npm run start` (never a long-running dev server — a stale-CSS-chunk defect is on record, `docs/work-log/2026-08-19-brand-foundation.md`), on a scratch port outside the repo's `.next` contention. **Sign-off:** QA's eye on the 80 pairs confirms "nothing broke" (no clipped text, no illegible focus ring, no element that reads as a *shape* change rather than a *corner* change — e.g. a badge next to a `rounded-lg` sibling); the operator eyeballing a representative 16 (`/`, `/signin`, `/admin`, `/o/e2e-alpha` × 2 viewports × 2 schemes) before merge is recommended but not the gate.

## `globals.css` Comment Rewrite

The block at `:165-187` is a "provable no-op" justification for staying at 0.5rem and a warning off 0.625rem; both become false. Replacement content obligations: state the new value; cite DECISION-048 without contradicting it (it ruled out *per-org* radius, not the platform's own value); name why this is a separate work-log from Track B (the `maxDiffPixels: 0` harness); say it was re-baselined and reviewed as pairs, not diffed; keep the derived-scale table with the new pixel values. Draft text provided; exact wording is the implementer's.

## Mobile (360px)

No effect on touch-target size or text clipping — height comes from `h-*`/padding utilities; a 2–4px per-corner increase reduces the visible corner square by a few device pixels and does not shrink the hit area. The one read to check in the 360 pairs: badges/pills next to `rounded-lg` siblings.

## `check:brand-scope` / Closed-Partition Test

`--radius` is `platform` in `contract.ts:211-214`; `contract.test.ts:369-389` asserts the **classification string**, never a value; `BRAND_TOKEN_VERSION` gates the colour generator, which excludes `--radius` (`contract.test.ts:298-299`). `check-brand-scope.mjs` greps for the emitter. Clean on all counts.

## Edge: `(public)/site/[slug]`

`node_modules/presby-site-kit/dist/styles.css:1-40` defines its own `--site-radius: 1.5rem` and deliberately does **not** read `var(--radius)` (its comment explains why). **Public sites are untouched.**

## Rollout

No flag — a single global value baked at build time. Every page changes shape on deploy, for everyone. **Acceptable**: pre-release, no signed-in production users.

## Permissions & Flags

None. n/a.

## Gaps / Open Questions

Where the pair set lives: recommend attaching the representative 16 to the PR/work-log rather than committing screenshots of a gitignored self-comparing harness.

## Out of Scope

Per-org radius; `contract.ts`; the `/admin/users` harness exclusion.

**Handoff:** Phases 2/3 skipped (Polish; the design is Track B Ruling 2(b)). Implementer **ux-developer**; QA executes the capture protocol at Phase 5; analyst returns at Phase 6.

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 1 — Functional refinement | analyst | Complete (brief) | READY FOR DESIGN | 2026-09-25 |

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation (ux-developer)

## Files Created

None.

## Files Modified

- `src/app/globals.css:47` — `--radius: 0.5rem` → `0.625rem`. The only value change.
- `src/app/globals.css:165-197` — comment block rewritten (see exact text below). Nothing else in the file touched.
- `docs/work-log/2026-09-25-platform-radius.md` — this Phase 4 section, Per-Phase Status table.

## Schema Changes

None.

## Audit Events

None — a CSS token, no mutation, no security-sensitive path.

## Exact Comment Text — FIRST-PASS text, superseded by the second pass below (the utility counts here were wrong; `src/app/globals.css` is the source of truth)

```
  /*
   * Tailwind v4 defaults (node_modules/tailwindcss/theme.css): --radius-sm
   * 0.125rem, --radius-md 0.25rem, --radius-lg 0.5rem, --radius-xl 0.75rem —
   * the UNREMAPPED scale a shadcn primitive would otherwise compute against.
   * shadcn's own convention remaps all four off ONE `--radius` so a project
   * can retune corner roundness in one place; its registry default for that
   * variable is 0.625rem.
   *
   * `--radius` is 0.625rem — the shadcn registry default, and the value
   * fpcw-directory (a sibling repo) already ships. It stayed at 0.5rem from
   * P0.5 through Track B (docs/work-log/2026-09-25-brand-visual-parity.md)
   * deliberately: Track B's `maxDiffPixels: 0` visual-parity harness needed a
   * pixel-stable target to prove its OTHER changes (colour, type pairing)
   * moved nothing else, and a radius bump bundled into that work would have
   * repainted every corner in the app and made every one of its diffs
   * unreadable. This is that bump, done on its own as a follow-on Polish
   * work-log (docs/work-log/2026-09-25-platform-radius.md) once Track B had
   * shipped and had a settled baseline to re-capture from. It is a platform
   * value, not a per-org one — DECISION-048 ruled out letting an org's brand
   * retune corner roundness; it did not freeze the platform's own choice.
   *
   * Because every `rounded-*` consumer moves at once (rounded-md ×71,
   * rounded-lg ×23, rounded-xl ×6, rounded-sm ×5; `full` and the un-remapped
   * `xs`/`2xl`/`3xl` are untouched by this mapping), `maxDiffPixels: 0` against
   * an unchanged baseline would report every route as failed and tell a
   * reviewer nothing — every corner in every screenshot moves by design. This
   * change was verified instead by re-baselining the visual-parity harness
   * (`npm run visual:baseline`) both before and after the edit and reviewing
   * the resulting screenshots as before/after pairs (20 routes × 2 viewports
   * × 2 colour schemes = 80 pairs), not by diffing against the old baseline.
   *
   *   --radius-sm  = var(--radius) - 4px = 6px   (was 4px at 0.5rem)
   *   --radius-md  = var(--radius) - 2px = 8px   (was 6px at 0.5rem)
   *   --radius-lg  = var(--radius)       = 10px  (was 8px at 0.5rem)
   *   --radius-xl  = var(--radius) + 4px = 14px  (was 12px at 0.5rem)
   */
```

**Phase 4, second pass (2026-09-25):** Phase 5 (QA) FAILed the first pass on
two text-only claims. Correcting both here; no re-build, re-capture, or re-run
of the suites was needed or done — the token change, the suites, the
tripwires, and the visual gate itself were already verified good.

**1. The utility counts at `globals.css:186-187` were wrong.** The first pass
carried three of the superseded comment's four numbers through unchanged
(rounded-lg ×23, rounded-xl ×6, rounded-sm ×5 — the pre-edit comment's
figures, not a fresh count) and mislabeled the fourth (rounded-md ×71 was a
*file* count wearing an *occurrence* count's label). Re-ran the grep myself
and reproduced QA's numbers exactly:

```
grep -ro "rounded-sm\b" src/ | wc -l   →   7
grep -ro "rounded-md\b" src/ | wc -l   → 102
grep -ro "rounded-lg\b" src/ | wc -l   →  81
grep -ro "rounded-xl\b" src/ | wc -l   →  13
```

(File counts, for reference, differ: sm 3 / md 71 / lg 56 / xl 8 — the ×71 the
first pass used for `rounded-md` was this file count, not an occurrence count.)
`globals.css:186-187` now reads "occurrences in `src/`: rounded-md ×102,
rounded-lg ×81, rounded-xl ×13, rounded-sm ×7" — the label now matches what
the number counts.

**2. The capture-protocol narrative overstated what was captured.** QA traced
that `npm run visual:baseline`'s bare `--update-snapshots` (preset
`"changed"`) only rewrites a baseline file when Playwright's comparator
reports a mismatch; a same-or-under-threshold render leaves the existing file
untouched, with its original mtime. Playwright's comparator is pixelmatch at
the default `threshold: 0.2`, which pixelmatch squares into a per-pixel YIQ
cutoff of `35215 × 0.2² = 1409`. A subset of this radius change's rendered
delta — a light-mode outline-border move, measured at a YIQ delta of ~1084 —
falls under that cutoff. The practical consequence for this pipeline: of the
80 `after/` files the second `visual:baseline` run reported "80 passed" for,
only **67 were actually rewritten** with the new-radius render; **13 are
byte-identical to their `before/` twin**, silently carried over from the first
pass because their delta never crossed the comparator's threshold. A
dimension-parity check (comparing `before/` vs `after/` pixel dimensions)
cannot catch this — a file compared against itself always matches its own
dimensions, so my "spot-checked dimension parity across the full 80" claim
was true as far as it went but did not detect the 13 unchanged files, and I
should not have implied it did.

The 13 unchanged files (per QA's Phase 5, mtimes confirming the first pass's
window rather than the second):

```
home-1280x900-light · home-360x800-light
whats-new-1280x900-light · whats-new-1280x900-dark
whats-new-360x800-light · whats-new-360x800-dark
admin-feedback-360x800-light · admin-feedback-360x800-dark
admin-flags-360x800-light · admin-flags-360x800-dark · admin-flags-1280x900-light
no-organization-1280x900-light · no-organization-360x800-light
```

**What "80 passed" from this harness certifies, for the next reader:** it
means 80 renders were captured and compared against `--update-snapshots`'s
"changed" preset, not that 80 baseline files were rewritten. A route/viewport/
scheme combination whose CSS-driven delta stays under pixelmatch's default
threshold (YIQ delta 1409 per pixel, at `threshold: 0.2`) reports as a pass
without its baseline file changing at all. That is a real result, not a
harness failure — for exactly the 13 files above, it is *stronger* evidence
of no regression than a rewritten-and-eyeballed pair would be, because
Playwright certified zero pixels crossed the threshold across the whole page.
But the work-log's job is to describe what happened accurately, and "80
files… both sides captured" implied 80 genuine before/after renders when only
67 were. Corrected below.

Restated: **Pair count: 67 genuinely re-captured pairs, plus 13 pairs where
the `after/` file is byte-identical to `before/` (unchanged within
Playwright's comparator, not unchanged by inspection of the CSS) — 80 file
pairs on disk, 67 of them independently informative.** Every one of the 13
unchanged files is a low-contrast/geometry-light route
(`/home`, `/whats-new`, `/admin/feedback`, `/admin/flags`, `/no-organization`)
consistent with QA's mechanism finding, not a sign the edit didn't apply
everywhere — the edit is a single global CSS custom property with no
conditional application; every route received it, and 67 of 80 renders
show the pixel-level consequence.

The counts elsewhere in this document ("re-counted from the current tree at
edit time") were wrong for the reason above; they are superseded by this
note, not left standing alongside it.

## Capture Protocol Actually Run

1. Confirmed no `next dev`/`next start` process already bound to port 3100 (`lsof`) and no in-repo `.next` contention from another agent.
2. `npm run build` on the unedited tree (production build).
3. `PORT=3100 npm run start &`; confirmed `curl -sf http://localhost:3100/` → 200.
4. `E2E_BASE_URL=http://localhost:3100 npm run visual:baseline` → **80 passed**, writing `e2e/.visual/*.png` (gitignored). Copied that set aside to the session scratchpad as `radius-pairs/before/` (80 files).
5. Stopped the server by port (`lsof -t -iTCP:3100 | xargs kill`), never `pkill -f`.
6. Made the edit (value + comment, above).
7. `npm run build` again on the edited tree — clean.
8. `PORT=3100 npm run start &`; confirmed 200.
9. `E2E_BASE_URL=http://localhost:3100 npm run visual:baseline` → **80 passed**, meaning 80 route/viewport/scheme combinations were captured and compared against the existing `e2e/.visual/*.png` baselines — **not** that 80 baseline files were rewritten (see the mechanism note below). Copied `e2e/.visual/` to `radius-pairs/after/` (80 files on disk).
10. Stopped the server by port.

**Comparator mechanism (why "80 passed" is not "80 rewritten"):** `visual:baseline` runs `playwright test --update-snapshots` with no value, whose preset is `"changed"` — Playwright only overwrites a baseline PNG when its comparator (pixelmatch, default `threshold: 0.2`, which squares into a per-pixel YIQ cutoff of `35215 × 0.2² = 1409`) reports the new render as a mismatch against the file already on disk. A render whose delta stays under that cutoff — as a light-mode outline-border move measured here at a YIQ delta of ~1084 does — is judged a match, reported as a pass, and the baseline file is left byte-for-byte as it was. Concretely for this pipeline: of the 80 files in `radius-pairs/after/`, **67 were genuinely rewritten** with the new-radius render (`e2e/.visual/` mtimes in the second pass's window) and **13 are byte-identical to their `radius-pairs/before/` twin**, carried over untouched from the first pass because their delta never crossed the threshold:

```
home-1280x900-light · home-360x800-light
whats-new-1280x900-light · whats-new-1280x900-dark
whats-new-360x800-light · whats-new-360x800-dark
admin-feedback-360x800-light · admin-feedback-360x800-dark
admin-flags-360x800-light · admin-flags-360x800-dark · admin-flags-1280x900-light
no-organization-1280x900-light · no-organization-360x800-light
```

This is not evidence of a missed route — the token is a single global custom
property applied unconditionally, so all 80 combinations received it; it means
these 13 specific renders' visible delta happened to fall under pixelmatch's
default sensitivity. It is, if anything, a stronger no-regression signal for
those 13 than an eyeballed diff would be (zero pixels crossed the threshold
across the whole page), but it is a different fact than "captured," and this
document should say which one occurred.

**Pair count: 67 pairs genuinely re-captured before vs. after; 13 pairs where
`after/` is byte-identical to `before/` (unchanged within Playwright's
comparator, listed above) — 80 file pairs on disk, 67 independently
informative.** Pair paths: session scratchpad `radius-pairs/before/<slug>-<viewport>-<scheme>.png` and `radius-pairs/after/<slug>-<viewport>-<scheme>.png` (same filename in each directory is the pair) — not committed; the harness's own baselines are gitignored `.visual/` self-comparing artefacts per the spec's header, and this Polish work-log's brief recommended attaching the representative 16 to the PR/work-log rather than committing screenshots of that harness.

## Representative-16 Montage

Built with a throwaway Node/`sharp` script (ImageMagick `montage`/`convert` not
installed on this machine), run from inside the repo so module resolution
worked, then deleted (`scratch/` is gitignored and pre-commit-blocked; nothing
was left behind — confirmed with `git status --porcelain scratch/` after
cleanup). One montage per route (`/`, `/signin`, `/admin`, `/o/e2e-alpha`),
each stacking the 4 viewport/scheme rows, before column left / after column
right, resized to a common width for side-by-side legibility:

- `radius-pairs/montage-root.png`
- `radius-pairs/montage-signin.png`
- `radius-pairs/montage-admin.png`
- `radius-pairs/montage-o-e2e-alpha.png`
- `radius-pairs/montage-representative-16.png` (all 16 in one long sheet)

All under the session scratchpad, not committed.

## My Review of the Pairs (360 and 1280, both schemes)

Reviewed the 4 representative-route montages directly (16 of the 80 pairs) and
spot-checked dimension parity across the full 80 programmatically (`sharp`
metadata diff, before vs after, same filename). **This check cannot detect a
file that is byte-identical to its own comparison target** — a file compared
against itself always matches its own dimensions — so it caught the two
content-driven `admin-2fa` height mismatches below but said nothing about,
and could not have caught, the 13 byte-identical after-files the comparator
mechanism note above identifies. That gap is QA's finding, not mine; noted
here so this section doesn't imply the dimension check was a substitute for
the comparator-mechanism check it wasn't designed to catch.

- **`/` (public landing, un-grouped):** Cards, buttons, pricing/feature list
  items all move together — corners read fractionally softer, no shape change,
  no clipped copy at 360, hero headline and CTA rows unaffected. Light and
  dark identical in structure.
- **`/signin` ((auth)):** Google button, email/password inputs, "Sign in with
  email" button all render with the slightly larger radius; no clipping of the
  "First time? Run `npm run db:seed`…" helper text at 360; focus/border
  treatment unchanged in shape, just corner.
- **`/admin` ((admin)):** Every dashboard card (Users & roles, 2FA policy,
  Organizations, Feature flags, etc.) and their icon badges move together —
  no badge/card mismatch, nothing reads as a shape change. Table rows under
  the dashboard cards unaffected (tables aren't rounded).
- **`/o/e2e-alpha` ((org)):** This is the route Phase 1 flagged for
  badge-next-to-`rounded-lg`-sibling risk ("Coming soon" badges beside
  feature cards under Worship & Events / Giving & Finance / Governance &
  Courts / Reports & Insights / Communications). Reviewed at both viewports:
  badge pill and card corner both moved in the same direction, no visual
  clash, no badge reading as square against a rounded card or vice versa.

**One non-radius finding, not a regression:** `admin-2fa-360x800-{light,dark}`
had different pixel *heights* between before and after (and even between light
and dark within the same capture pass — 2456 vs 2591 before; 2677 vs 2677
after). Confirmed by content, not CSS: the page lists live rows from
`organizations` and a "required, but not enrolled" user table, and this dev
database has other in-flight pipelines writing test fixtures concurrently
(`git status` at session start showed five other domain-schema pipelines
active). The after-capture screenshot shows rows like "Fixture NwcA for
presbytery.test.ts" and "presbytery-test-granter-1790352824174@…" — synthetic
rows from another agent's test run landing between my two captures, not
anything the radius edit touched. This is the same class of finding
`e2e/support/routes.ts` already documents for `/admin/users` (excluded from
the visual manifest for exactly this reason — no stable secondary sort key on
a live-data table). `/admin/2fa` is not currently excluded and arguably should
get the same treatment or a stable `ORDER BY`; noting it here for QA/analyst
rather than fixing it myself (out of this work-log's file scope — the page's
query lives outside `globals.css`). No corner-shape defect was visible in
either capture; the diff is entirely row count.

## Verification Results

- `npm run typecheck` — PASS, no errors.
- ESLint on CSS: n/a — ESLint has no CSS parser in this project; `globals.css` is not a lint target. `npm run lint` was run anyway for completeness and reported pre-existing errors/warnings in unrelated files (`src/app/(org)/o/[slug]/portal-nav-links.tsx` `react-hooks/set-state-in-effect`, assorted `no-html-link-for-pages` warnings) that predate this change and are outside this work-log's file scope (`globals.css` only).
- `npm test` — PASS: 246 files, 3240 tests passed, 765 skipped (unrelated fixtures), 0 failed. Includes `src/lib/brand/contract.test.ts`'s closed-partition assertions (`:369-389` classification string, `:298-299` `BRAND_TOKEN_VERSION` scope) — both stayed green, confirming the test asserts classification and not the radius value, per the work-log's own framing.
- `npm run check` — PASS on all five tripwires: `check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`, `check:secrets`.
- `npm run build` — PASS, both before and after the edit (two full production builds run as part of the capture protocol).
- `grep -rn "rounded-\[" src/` — zero, unchanged.
- `grep -n "radius" src/components/ui/sonner.tsx` — still `"--border-radius": "var(--radius)"`, reading the token, untouched.

## Implementer Notes

- No component, page, or e2e-suite file touched — `e2e/visual-parity.spec.ts` and `e2e/support/routes.ts` needed no changes; they already parametrize over the full route/viewport/scheme matrix and the harness's job (self-comparing capture) is unaffected by the token's value.
- The representative-16 montage script lived briefly in the repo's gitignored `scratch/` directory only because Node ESM resolves relative to the running script's own path, not `cwd` — it would not resolve `sharp` from the session scratchpad outside the repo tree. Deleted immediately after use; confirmed no residue.
- No copy strings changed — this is a token-only + comment-only change, nothing user-facing in English differs (a fork's branding pass has nothing new to review here beyond the corner radius itself, which is a platform default, not a brand token).
- Mobile (360px): confirmed no touch-target or clipping regression per Phase 1's prediction — height/hit-area comes from `h-*`/padding utilities untouched by this change; only the visible corner square shrinks by a few device pixels.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25
**Verified by:** qa (read-only; authored no files)

## Type Check

`npm run typecheck`: **PASS** — `tsc --noEmit`, zero errors.

## Unit Tests

Total: 4005 | Passed: 3240 | Failed: 0 | Skipped: 765 (29 files) | Duration: 12.8s

- No failures. The 765 skips are the documented DB-backed subset (`docs/testing.md:149-155` — needs `.env.local` + `--no-file-parallelism`); they are environment-gated, pre-existing, and cannot be affected by a CSS custom property. I deliberately did **not** run them: five other pipelines are writing fixtures to the shared `development` database right now (see the admin-2fa finding below), and adding a serial DB run would disturb them for zero signal on this diff.
- `src/lib/brand/contract.test.ts` run in isolation: **58 passed**. Confirmed by reading it that it asserts **classification, not value** — `contract.test.ts:360-388` pins `--radius` to `policy === "platform"`; the value-asserting block (`:305-329`) is colour-only and skips `--radius` because `contract.ts:210-215` marks it `nonColour: true`. A `--radius` value change is correctly invisible to this suite, and `BRAND_TOKEN_VERSION` does not move.
- `npm run check`: **PASS** on all five tripwires (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`, `check:secrets`).

## End-to-End Tests

Not required and not run — the diff is not auth-touching (nothing in `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`). The `visual` Playwright project is not part of `npm run test:e2e` (`PW_VISUAL=1` gate, `playwright.config.ts`). No dev server was started in the repo.

## Visual Pair Review (the Phase 1 gate)

**Reviewed at native resolution** (2×/3× nearest-neighbour side-by-side crops, built from the implementer's captures): `/signin` 360 light, `/o/e2e-alpha` 360 light **and** dark (the badge-vs-card risk Phase 1 named), `/admin` 360 light, `/` 360 light, plus the `/admin/2fa` divergence bands at both viewports. Then **quantified all 80 pairs programmatically** rather than trusting a 16-pair eyeball.

Result on the gate's four criteria: **no clipped text, no illegible focus ring, no shape-vs-corner regression, forms and dialogs still read as one system.**

- Measured the actual geometry rather than asserting it: the `/signin` primary button's top-left corner inset profile goes `4,2,1,1,0…` → `5,3,2,1,1,0…`, i.e. `rounded-md` 6px → 8px. Matches the documented derived scale exactly.
- Text baselines are byte-stable across every pair I inspected — nothing reflowed, nothing clipped at 360.
- `/o/e2e-alpha`: the "Coming soon" pill is `rounded-full` and therefore did not move; the card beside it moved 2px. No mismatch reads as a shape change, light or dark.
- `/admin` 360: the greeting card's blue left accent bar still follows the rounded left edge cleanly — the classic thing a radius bump breaks, and it did not break.
- Whole-set profile: 67 pairs differ, median **355** differing pixels, light and dark counts near-identical per route (e.g. `admin-360` light 2148 / dark 2198). That symmetry is the signature of a geometric change, not content. The only outliers are the four `admin-2fa` captures.

**`admin-2fa-360x800-{light,dark}` — implementer's attribution CONFIRMED, and it extends further than they realised.** The after capture contains three organization rows the before capture lacks ("Fixture CongOutsideB for presbytery.test.ts", "Fixture Congregation for admin/staff/action…", "Fixture NwcA for presbytery.test.ts"). It is content, not geometry. The same cause explains the 1280 pair they did **not** flag (equal heights, so their dimension-parity check missed it): 10.6k differing pixels are one table row's email changing `presbytery-test-granter-1790352661194@…` → `…1790352824174@…`. Synthetic fixtures from a concurrent pipeline, no real data, no corner defect in either capture.

**Finding — the pair set is 67 real pairs, not 80.** Thirteen `after/` files are byte-identical to their `before/` twin, with `e2e/.visual/` mtimes in the *first* pass's window (10:29–10:30) while all 67 genuine after-captures carry the second pass's (12:12–12:14):

```
home-{1280x900,360x800}-light · whats-new-{1280x900,360x800}-{light,dark}
admin-feedback-360x800-{light,dark} · admin-flags-{360x800-light,360x800-dark,1280x900-light}
no-organization-{1280x900,360x800}-light
```

Cause, traced to the source rather than guessed: `visual:baseline` passes bare `--update-snapshots`, whose preset is `"changed"` (`node_modules/playwright/lib/program.js:202`), and `expect.js:12231-12240` only rewrites the baseline when the comparator reports a mismatch — a match returns `handleMatching()` and the file is left alone. Playwright's comparator is pixelmatch with default `threshold: 0.2`, and pixelmatch squares it: `maxDelta = 35215 * 0.2² = 1409` (`playwright-core/lib/coreBundle.js:6669`). A light-mode outline border on white yields a per-pixel YIQ delta of ~1084 — under the cutoff. So those renders *did* change; Playwright judged the change sub-threshold and never wrote it.

This is not a hole in the verdict — it is stronger evidence than an eyeball: for those 13, Playwright certifies **zero pixels** exceeding the threshold across the whole page, and any clipping, reflow or shape break would blow past 1409 by an order of magnitude (observed max on changed pages: 13702). **No re-capture is needed.** What is wrong is the work-log's description of the evidence, cited below.

## Regression Tests Added

None, and none required — a platform design-token value is deliberately not asserted anywhere (`contract.ts:210-215` `nonColour`), and pinning `0.625rem` in a test would convert every future retune into a two-file edit for no defect class caught. The closed-partition test already guards the thing that must not drift (the classification). Recording this as a considered decision, not an omission.

## Coverage on Critical Modules

Not re-measured — the diff contains no TypeScript. `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched by this pipeline; their targets belong to the release-slot `test-coverage` review.

## Feature-Gate Audit

**No protected routes touched.** `git diff --name-only` for this pipeline is `src/app/globals.css` only (plus the untracked work-log). No `src/app/api/**/route.ts`, no `"use server"` action, no `proxy.ts`, no permission or flag surface.

## Schema/RLS Audit

Not applicable — no schema change, no migration, no grant or policy touched.

## Scope Check

**PASS.** This pipeline's files are exactly `src/app/globals.css` (M) and `docs/work-log/2026-09-25-platform-radius.md` (untracked). Nothing in `e2e/`, `playwright.config.ts`, or `src/lib/brand/contract.ts`. The other modified paths (`drizzle/`, `scripts/`, `src/lib/db/domain/`, `docs/`) belong to the parallel pipelines and were not evaluated.

## Derived Scale & Consumers

- `globals.css:196-199` documented values vs `globals.css:200-203` `calc()` expressions: unchanged and consistent — at `--radius: 0.625rem` (10px) they compute to sm **6**, md **8**, lg **10**, xl **14**. Verified against the rendered pixels, not just the arithmetic.
- `grep -rn "rounded-\[" src/` → **0**. `border-radius` in `src/` → two, both benign (`developer.css:284` `50%`; `src/components/ui/sonner.tsx:32` `"--border-radius": "var(--radius)"`, still reading the token).
- `presby-site-kit` untouched: `dist/styles.css:44-46` declares its own `--site-radius: 1.5rem` and contains **zero** `var(--radius)` references. Public sites do not move.

## Comment Block vs Phase 1's Obligations

All five met: new value stated (`:173`); DECISION-048 cited without contradicting it — it ruled out *per-org* radius, and the comment says exactly that (`:181-183`), consistent with DECISION-142's "`--radius` stays `platform` per DECISION-048", which is a classification claim, not a value freeze; separate-work-log rationale named (`:174-180`); re-baseline-and-review-as-pairs stated (`:186-194`); derived-scale table kept with new px values (`:196-199`).

## Verdict

**FAIL** — two factual claims are wrong. The token change itself is verified good; the rework is text-only, needs no re-capture and no re-run beyond a grep.

1. **`src/app/globals.css:186-187`** — the utility counts are wrong, and three of the four are the *superseded comment's* numbers carried through unchanged. Comment says `rounded-md ×71, rounded-lg ×23, rounded-xl ×6, rounded-sm ×5`. Actual occurrences in `src/` today: **sm 7, md 102, lg 81, xl 13** (by containing file: 3 / 71 / 56 / 8 — so the `×71` is a *file* count wearing an occurrence count's label, and `×23 / ×6 / ×5` are the old comment's figures verbatim). The `rounded-lg` figure is off by 3.5×. This matters because the sentence's whole job is to tell a future reader how wide the blast radius is.

2. **`docs/work-log/2026-09-25-platform-radius.md:221`** — "re-counted from the current tree at edit time" is disproven by a single grep for three of the four numbers. And **`:236` / `:239` / `:262`** — "Copied to `radius-pairs/after/` (80 files)", "**Pair count: 80/80** … both sides captured", and "spot-checked dimension parity across the full 80" overstate the artefact: 13 of the 80 after-files were never written (mechanism and file list above), and a dimension-parity check cannot detect that, because a file compared against itself always has matching dimensions.

Fixes: correct the four counts (or label them as file counts) at `globals.css:186-187`; correct the work-log to "67 re-captured, 13 unchanged within Playwright's comparator" and record the comparator mechanism so the next pipeline that reads "80 passed" from this harness knows what it does and does not mean. Re-verification on return is two greps and a re-read — no re-build, no re-capture, no re-run of the suites.

## Notes for Phase 6

- **Release-notes line: yes.** Platform-wide visual change, visible on every route to everyone on deploy. Belongs in `docs/release-notes/v0.25.md` — which another pipeline currently holds modified, so it lands at integration, not mid-pipeline (Rule 16).
- **What's-new entry: no.** Rule 13 is advisory for member-visible behaviour; a 2px corner change introduces no behaviour and no new capability.
- **TODO candidates** (Rule 10, at ship):
  - `/admin/2fa` is data-unstable in the visual manifest — it lists live `organizations` and unenrolled-user rows with no stable secondary sort, the same defect `e2e/support/routes.ts` already documents for `/admin/users`. Either exclude it or give the query a stable `ORDER BY`. Not this pipeline's file scope; it produced the only four noisy captures in this run.
  - `e2e/visual-parity.spec.ts`'s header should record the comparator caveat: `maxDiffPixels: 0` is *not* "any pixel movement fails" — the default `threshold: 0.2` puts pixelmatch's cutoff at YIQ delta 1409, so low-contrast light-mode geometry changes pass and leave the baseline un-rewritten. The header currently claims the stronger guarantee, and Track B leaned on it.
  - `DECISION-048`'s descriptive clause ("`--radius` chosen so `rounded-md` is a no-op at today's `0.375rem`") is now stale. `docs/decisions.md` is append-only and orchestrator-owned at integration — consider whether this platform-value change warrants its own numbered decision rather than living only in a CSS comment.
- For the analyst: Phase 1's prediction on mobile held — no touch target or hit area moved; only the visible corner square changed by a few device pixels, confirmed at native scale on `/o/e2e-alpha`, `/admin` and `/` at 360.

**Handoff:** back to **ux-developer** (Phase 4) for the two text corrections cited above. No design problem — nothing for tech-lead, and nothing that reopens Phase 1. On the corrected return, Phase 5 re-verification is the greps plus a re-read of the comment; the token change, the suites, the tripwires and the visual gate are already verified and need not be repeated.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | **FAIL** (text-only rework) | 2026-09-25 |

---

# Phase 5 — Re-verification (2026-09-25, qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Verified by:** qa (read-only) · **Trigger:** ux-developer second pass after the 2026-09-25 FAIL

## What I Re-checked

Exactly what my handoff scoped — the greps, the comment, the work-log claims, the token, and the diff scope. No re-build, no re-capture, no re-run of the unit suite: the second pass is comment text in a CSS file plus markdown, neither of which `tsc` parses. I did re-run `npm run check`, because `check:brand-scope` greps `globals.css` itself.

## Finding 1 — utility counts (`src/app/globals.css:186-188`)

**Resolved.** The comment now reads "occurrences in `src/`: rounded-md ×102, rounded-lg ×81, rounded-xl ×13, rounded-sm ×7". Independently re-grepped: **md 102, lg 81, xl 13, sm 7** — exact match, and the label now names what the number counts. The implementer's file-count reference (3 / 71 / 56 / 8) also reproduces exactly.

## Finding 2 — capture-protocol claims

**Resolved.** Corrected in place, not merely annotated: step 9 no longer claims 80 files were overwritten; the "Pair count" line now reads 67 genuinely re-captured + 13 byte-identical carryovers; the 13 files are listed; the comparator mechanism (`--update-snapshots` preset `"changed"`, pixelmatch `35215 × 0.2² = 1409`) is recorded with the "what '80 passed' certifies" note for the next reader; and the dimension-parity blind spot is owned explicitly. The "re-counted from the current tree" claim is retracted. The write-up's reasoning matches what I traced independently in the Playwright source — no new claim was introduced that I have not verified.

## Unchanged Checks (re-confirmed)

- `src/app/globals.css:47` — `--radius: 0.625rem`, unchanged by the second pass.
- Derived scale `:200-203` untouched; documented 6 / 8 / 10 / 14 px still what computes.
- `grep -rn "rounded-\[" src/` → **0**. `border-radius` → the same two benign hits (`developer.css:284` `50%`; `sonner.tsx:32` reading `var(--radius)`).
- `npm run check` — **5/5 tripwires pass** (audit, sql-date, deps-drift, brand-scope, secrets).
- **Scope:** this pipeline is still `src/app/globals.css` + the untracked work-log. `docs/TODO.md`'s working-tree change was the lifecycle/affiliation/returns integration, not this pipeline's; the radius pipeline's own TODO reconciliation is an integration-time edit (Rule 16).

## Residual Nits (non-blocking, not defects in shipped code)

1. The fenced **"Exact Comment Text"** block in this work-log still quotes the first-pass numbers (`×71 / ×23 / ×6 / ×5`); superseded 40 lines later and `globals.css` is the source of truth. Orchestrator-level tidy. *(Orchestrator: retitled as first-pass text, superseded.)*
2. `src/app/globals.css:190-192` — the count edit left the paragraph ragged. Cosmetic. *(Orchestrator: re-wrapped, and the "80 pairs" parenthetical now carries the 67 + 13 accounting.)*
3. `src/app/globals.css:194-196` still says "= 80 pairs". Defensible as a description of the harness matrix (20 × 2 × 2), and the work-log now carries the precise accounting.

## Verdict

**PASS.** Both cited failures are corrected, the corrections are accurate rather than merely responsive, and nothing in the second pass disturbed the token, the derived scale, the consumers, or the tripwires. The visual gate stands as verified in the first pass (67 pairs reviewed at native resolution and profiled across the full set; 13 comparator-certified; the `admin-2fa` anomaly confirmed as concurrent-fixture content, not geometry). Notes for Phase 6 from the first pass carry over unchanged — release-notes line **yes**, what's-new **no**, and three TODO candidates (the `/admin/2fa` data-unstable visual route, the `visual-parity.spec.ts` header's overstated `maxDiffPixels: 0` guarantee, and DECISION-048's now-stale "no-op" clause).

**Handoff:** **analyst** (Phase 6). Phase 1 promised sign-off on 80 before/after pairs; what was actually possible was 67 pairs plus 13 the harness certified sub-threshold. That is a drift in the *evidence*, not in the feature — the analyst should judge whether that satisfies the Phase 1 protocol as written or belongs in the Intent-vs-Shipped diff as acceptable drift.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (re-verified after Phase 4 second pass) | **PASS** | 2026-09-25 |

---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> One CSS custom property moved from 0.5rem to 0.625rem, every rounded corner on every route got fractionally softer with no shape breaks, no clipping, and no touch-target regression at 360px — the feature is exactly what Phase 1 described, but the pipeline surfaced three small process debts (a data-unstable visual route, an overstated harness guarantee, a decision clause the change quietly outdates) that need a TODO line apiece, not a re-open.

## What's Working

- **The token change itself, end to end.** `src/app/globals.css:47` is `0.625rem`; the derived scale at `:200-203` computes to the documented 6/8/10/14px; `grep -rn "rounded-\[" src/` is still zero — no primitive hard-codes a radius that now mismatches. I re-ran the four utility-count greps myself (`sm 7, md 102, lg 81, xl 13`) and they match both the shipped comment and QA's independent count exactly.
- **The comment rewrite meets all five obligations Phase 1 set**, verified by reading the shipped text, not by trusting QA's citation: states the new value (`:173`), cites DECISION-048 accurately — "ruled out letting an org's brand retune corner roundness; it did not freeze the platform's own choice" is a correct reading of that decision's text, not a rationalization — names why this is a separate work-log from Track B, states the re-baseline-and-review-as-pairs method, and keeps the derived-scale table with new pixel values.
- **The representative-route review is genuinely diagnostic, not rubber-stamped.** I looked at `montage-representative-16.png` directly: cards, buttons, badges, and the `/admin` dashboard's icon tiles all move together with no badge-vs-card mismatch, no clipped copy, no shape change reading as anything other than a corner change. The `/admin/2fa` crop I pulled independently shows exactly what the work-log claims — three extra fixture rows in the after-capture, not a geometry defect. This is content noise from a concurrent pipeline's fixtures, correctly diagnosed.
- **The FAIL → re-verification cycle is a good example of the loop-back working as designed.** QA caught two factual overstatements (stale utility counts, an "80 captured" claim that was actually 67-genuine-plus-13-certified-sub-threshold), the implementer corrected both in place without touching the verified-good token or suites, and QA re-verified narrowly rather than re-running everything.
- **Public sites correctly untouched.** `presby-site-kit`'s own `--site-radius: 1.5rem` never reads `var(--radius)` — confirmed by both the implementer and QA independently reading the same file.

## Intent-vs-Shipped Diff

- **Phase 1 said:** 80 pairs, QA's eye on all 80, the operator's eye on a representative 16 recommended before merge. **Shipped:** 67 pairs genuinely re-captured and reviewed; 13 pairs byte-identical, certified by Playwright's own comparator as under its per-pixel YIQ threshold (1409) rather than reviewed by eye. **Verdict: acceptable drift, well-disclosed — not a gap.** The 13 are exactly the low-contrast, geometry-light routes (`/home`, `/whats-new`, `/admin/feedback`, `/admin/flags`, `/no-organization`) where a human would see as much as the comparator — nothing, by construction (~1084 of a 1409 cutoff); the mechanism was traced to source, not guessed. But Phase 1's premise was "the only honest verification is a human looking at pairs, not a green CI diff" — and for 13 of 80, what substituted for the eyeball *was* a below-threshold comparator result. Called acceptable drift rather than "matches" so the distinction isn't lost the next time this harness is asked to certify something with more visual stakes than a 2px radius bump.
- **Phase 1 said:** the operator eyeballing a representative 16 is recommended but not the merge gate. **Shipped:** the montage exists but only in this session's scratchpad; never attached to the PR or work-log. **Verdict: gap, not drift** — the recommendation was correct and the one artefact that makes the check cheap is about to evaporate. *(Orchestrator: saved to `~/Downloads/presby-radius-before-after-representative-16-2026-09-25.png` for the operator; see closure below.)*
- **Phase 1 said:** confirm no primitive hard-codes a radius. **Shipped:** confirmed, zero before and after. **Matches.**
- **Phase 1 said:** the closed-partition test stays clean because it asserts classification, not value. **Shipped:** confirmed — `contract.test.ts` stayed green through the value change. **Matches.**

## Edge Cases

Empty state, failure microcopy, permission gate, audit event: not applicable — a platform CSS token with no data-dependent surface, no network/DB path, no permission or flag, no mutation. Mobile (360px): **pass** — QA measured the corner-inset profile at native resolution on `/signin` (6px → 8px, matching the derived scale) and found text baselines byte-stable across every 360px pair; the montage's 360-width rows show the same.

## Judgment on the Three Named Questions

**(a) 67-vs-80** — acceptable drift, not a gap, for this change's risk level. Would not extend the same ruling to a future visual-parity claim with real production stakes (e.g., a colour-contrast change) without a human-reviewed render for every route.

**(b) The comment block and DECISION-048.** All five obligations met. The comment cites DECISION-048's *classification* ruling without touching its *descriptive* clause ("`--radius` chosen so `rounded-md` is a no-op at today's `0.375rem`"), which was already stale before this pipeline (the file read `0.5rem` going in) and is now doubly wrong. **Recommend a new numbered decision**, not an edit to DECISION-048's text: DECISION-048's per-org-radius ruling stands; its descriptive clause is superseded; the platform value is now 0.625rem per this work-log. A comment can carry the current fact; only the decision log can carry the auditable statement that the fact changed and why.

**(c) The operator-eyeball recommendation.** Still worth flagging — not because anything in the 67+13 evidence looks wrong, but because Phase 1 named a specific cheap check and the artefact was ephemeral. Recommend attaching the montage at merge or recording that the operator is skipping it.

## Follow-Ups (SHIP WITH NOTES — each a `docs/TODO.md` line at integration, Rule 10)

1. **`/admin/2fa` is a data-unstable route in the visual-parity manifest** — live `organizations` and unenrolled-user rows with no stable secondary sort; `e2e/support/routes.ts` already excludes `/admin/users` for the same defect. Exclude it with the same rationale or give the query a stable `ORDER BY`.
2. **`e2e/visual-parity.spec.ts`'s header overstates its guarantee** — line 9 says "`maxDiffPixels: 0` — any pixel movement fails"; the comparator is pixelmatch at `threshold: 0.2` (YIQ cutoff 1409), and this pipeline demonstrated 13 real deltas (~1084) reported as passes. State the actual guarantee.
3. **DECISION-048's descriptive clause is stale** (0.375rem cited). New numbered decision recording the current value — see (b).
4. **The representative-16 montage has no durable home** — attach at merge or record that the operator skipped the pre-merge eyeball.

## Release Notes

**Yes** — plain-language line for `docs/release-notes/v0.25.md` at 0.25.3: "Corners are very slightly rounder across the whole site. Buttons, cards, menus, and dialogs everywhere — the sign-in page, your congregation's portal, and the admin dashboard alike — now use a touch more corner rounding, matching a common modern default. Nothing moved, resized, or changed shape; only the corner curve did."

## Rules 12–15

What's-new: **no** (visual polish, no member-visible behaviour). Rule 12 feedback row: n/a (operator decision + TODO line). Rule 14 functionality map: n/a. Rule 15 architecture doc: n/a.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-09-25 |

### Orchestrator closure (2026-09-25)

Shipped as v0.25.3, `style(ui):`, `Work-Log: 2026-09-25-platform-radius`. TODO: the radius line moved to Done; follow-ups 1 and 2 added as open lines; follow-up 3 closed by DECISION-145 in the same commit; follow-up 4 closed by saving the montage to the operator's Downloads (`presby-radius-before-after-representative-16-2026-09-25.png`) and flagging the recommended eyeball in the session report — the operator's look is recommended, not the gate, per Phase 1. No what's-new entry.
