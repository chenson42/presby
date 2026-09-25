# Org switcher trigger below the 44px touch floor on every org page — Work Log

> **Slug:** `2026-09-25-org-switcher-touch-target`
> **Surface:** (org) and (member) chrome — `src/components/shared/org-switcher.tsx`, `src/components/shared/global-nav.tsx`; e2e `header-controls.spec.ts:131,426`. No schema, no server logic.
> **Permission(s):** none. **Flag(s):** not needed.
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant. Phase 2 skipped unless Phase 1 finds the compact-mode design itself is wrong (then the architect rules on the OrgMark/compact interaction from the 2026-08-25 portal-chrome pipeline). `fix(ui):` commit, `Caught-By: automated-test` (the e2e assertion at `header-controls.spec.ts:426` has been failing honestly), `Discovered-In: post-merge`, `Work-Log: 2026-09-25-org-switcher-touch-target`. Parallel-pipeline rules (Rule 16): no shared files beyond the work-log; `e2e/header-controls.spec.ts` is not being edited by any other pipeline.
> **Source:** `docs/work-log/2026-09-25-e2e-red-on-main.md` Phase 1 (analyst, 2026-09-25) — classified as a real, previously unflagged accessibility regression, pre-existing since the 2026-08-25 portal-chrome OrgMark work; `docs/TODO.md` Bugs & security-adjacent gaps.
> **Bug:** `global-nav.tsx:154` sets `compact={!!orgMark}`, which is true for every org (any org context sets `orgMark`), not viewport-conditioned. In compact mode the switcher trigger shows only the `ChevronsUpDown` icon; `SWITCHER_TRIGGER_CLASS` has `min-h-11` but no min-width, so the button collapses to content width (~32px), under the 44px accessibility floor (`docs/ui-standards.md`), on every org portal page at any viewport. `org-switcher.tsx:130` also swaps the org-name span to `sr-only` in compact mode, so `header-controls.spec.ts:131`'s truncation-safety-valve locator (`span.truncate`) never resolves. Both e2e assertions fail honestly today.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (bug-fix brief) | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Skipped — bug-fix variant, no invariant/dependency/structural change (notation in section) | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Skipped as trivial — root cause and design recorded in section (orchestrator) | — | 2026-09-25 |
| 4 — Implementation | ux-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS — 44×44 measured at four widths, two schemes, branded and unbranded; both failing-first proofs witnessed | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (v0.25.1) | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Bug-fix brief, recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The bug is real and confirmed from the class list alone (`min-h-11` with no width floor collapses an icon-only trigger to ~32px), the fix is a one-line class change that touches no other invariant, but one of the two "red" e2e assertions cited in the work-log (`header-controls.spec.ts:131`) is asserting a state the component can no longer reach — it needs re-targeting, not just re-passing.

## Confirming the Bug

`SWITCHER_TRIGGER_CLASS` (`src/components/shared/org-switcher.tsx:91`): `inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1.5 …`. In compact mode (`compact={!!orgMark}`, `:130`) the name span is `sr-only`, so the visible content is `ChevronsUpDown` (16px) + `px-2` (16px) = **32px wide** against `min-h-11` (44px) — the 32×44 box `header-controls.spec.ts:432-433` measures. `min-w-0` sets no floor. **Root cause is a missing width floor on a class shared by both renderings**, invisible in non-compact mode because a name always exceeds 44px, surfacing once `compact` became the common case.

## Design Intent Compact Was Meant to Preserve

`docs/work-log/2026-08-26-portal-chrome-refinements.md` records an explicit, unconditional operator instruction: *"no need for the organization name in text if you have the logo."* Not viewport-scoped. `scripts/seed.ts:220-231` confirms `org_portal.chrome_v2` is effectively fully rolled out, so `compact=true` on essentially every `/o/<slug>` page at every viewport. **Compact-everywhere is the intended design, not a shortcut to narrow to a breakpoint.**

## The Fix Must Preserve

1. Icon-only appearance whenever `orgMark` is present, at every viewport.
2. **≥44×44px hit target — add `min-w-11` to `SWITCHER_TRIGGER_CLASS`.** Shared class → one universal fix, no new conditional; non-compact unaffected; `truncate` still engages (a real name is far wider than 44px).
3. Layout at 360px: +12px on the trigger against a header budget that held a much wider text wordmark in 2026-08-25's rework — very unlikely to wrap, but a live-browser claim: **Phase 4/5 verify in a real 360px viewport.**
4. Visual balance (note, not gate): with only the icon visible and no `justify-center`, the icon sits left in the 44px box — add `justify-center` to the shared class (harmless in non-compact).
5. D4 focus ring: the class already carries `focus-visible:ring-2 … ring-offset-2 ring-offset-background`; a width utility does not touch it.
6. Accessible name: `org-switcher.tsx:129` renders `<span class="sr-only">Current organization: </span>` plus the sr-only name — adequate.

## The Truncation Safety Valve — a test-design problem

`header-controls.spec.ts:131-195` asserts a **visible** `span.truncate` inside the switcher on `/o/<slug>`; every such page is compact, so the locator resolves to nothing. `src/components/shared/global-nav.test.tsx:298-321` already documents this ("supersedes the … truncate-class pin … predates the 2026-08-26 'no redundant name text next to a real logo' refinement") — the unit test was updated, the e2e spec was not; that regression dates to 2026-08-26. Retarget, don't delete: keep the one-row / no-wrap / no-overflow assertions on `/o/<slug>`; move the `span.truncate` presence assertion to `/home` (`GlobalNav` without `orgMark`, `compact=false` for a multi-org user), or drop it in favour of the component-level pin — an explicit Phase 3/4 call.

## Regression Tests

1. `e2e/header-controls.spec.ts:426-435` — red on width; green with `min-w-11`.
2. `e2e/header-controls.spec.ts:131-195` — red on `span.truncate`; **edit, not leave**: retarget the valve sub-assertion, keep the wrap/overflow sub-assertions.
3. Unit: neither `org-switcher.test.tsx` (never passes `compact={true}`) nor `global-nav.test.tsx` pins the compact trigger's width class — add one assertion that the compact trigger's `className` contains `min-w-11`.

## Permissions & Flags

None; unconditional fix; no flag.

## Gaps / Out of Scope

`CurrentOrgLabel` in compact mode collapses to `sr-only` too — non-interactive, `OrgWordmark`'s typographic fallback still shows the name; non-issue. Live 360px verification is Phase 4/5's. Not re-litigating compact-everywhere. Adversarial pass: n/a.

## Implementer

**ux-developer.** Phase 2 stays skipped; Phase 3 can be brief.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 1 — Functional refinement | analyst | Complete (bug-fix brief) | READY WITH NOTES | 2026-09-25 |

---

# Phase 2 — Architectural Review (architect)

**Skipped (orchestrator notation, bug-fix variant):** no invariant, dependency or structural change — a width utility on a shared class and an e2e retarget. Editing `e2e/header-controls.spec.ts:131-195` is in scope: the work-log's own bug statement names that line and no other pipeline touches the file.

---

# Phase 3 — Technical Design (tech-lead)

**Skipped as trivial (orchestrator notation, bug-fix variant); root cause and design recorded here.**

**Root cause:** `SWITCHER_TRIGGER_CLASS` has `min-h-11` and `min-w-0` — a height floor with no width floor — on a class shared by compact and non-compact renderings; compact became universal with `org_portal.chrome_v2`, so the icon-only trigger collapses to 32px. The truncation-valve e2e assertion regressed separately on 2026-08-26 when the name span became `sr-only` in compact mode; the unit test was updated then, the e2e spec was not.

**Design:** (1) `org-switcher.tsx:91` — `min-w-0` → `min-w-11`, add `justify-center`; nothing else in the class changes (D4 ring classes untouched). (2) `e2e/header-controls.spec.ts:131-195` — keep the one-row / no-wrap / `documentWidth` assertions on `/o/<slug>`; move the `span.truncate` presence assertion to `/home` as the multi-org user (where `compact=false`), naming in the test why. (3) Unit: one assertion in `global-nav.test.tsx`'s compact describe (`:265-283`) that the trigger `className` contains `min-w-11`, failing first. (4) Verify in a real browser at 360px and 1280px, both schemes: hit target ≥44×44 (`getBoundingClientRect`), header still one row, no page overflow; D4 ring visible on keyboard focus. Implementer: **ux-developer**. Commit `fix(ui):`, `Caught-By: automated-test`, `Discovered-In: post-merge`, `Work-Log: 2026-09-25-org-switcher-touch-target`. No release-notes entry needed beyond a one-line Fix (a 12px hit-target change is member-visible only as easier tapping) — orchestrator decides at Phase 6.

---

# Phase 4 — Implementation

**Date:** 2026-09-25
**Implementer:** ux-developer

## Files Created

- none

## Files Modified

- `src/components/shared/org-switcher.tsx:91` — `SWITCHER_TRIGGER_CLASS`: `min-w-0` → `min-w-11`, added `justify-center`. No other token in the class changed (D4 ring classes, `min-h-11`, padding all untouched).
- `src/components/shared/global-nav.test.tsx:284-289` — one new assertion in the existing "suppresses the redundant text name…" compact-mode test: `expect(trigger.className).toContain("min-w-11")`, with a comment naming the regression it guards (org-switcher-touch-target) and the shared min-h-11/min-w-11 pairing.
- `e2e/header-controls.spec.ts:131-256` — retargeted the truncation-safety-valve assertions. The original test (`:131`) kept only the still-valid one-row/no-wrap/no-overflow assertions on `/o/<slug>` and got a comment explaining why `span.truncate` no longer applies there (every `/o/<slug>` page is compact — orgMark always present — and compact mode replaces the name span with `sr-only` entirely, so there is no `span.truncate` node to find). The `span.truncate` presence/wiring assertions moved into a new test, `"keeps the truncation safety valve wired on a page with no org logo"` (`:192-213`), which visits `/home` as the `org-multi` fixture user (no orgMark there → `compact=false`) so the valve is actually exercised against a live DOM node instead of asserting a state the compact page can never reach.
- `docs/work-log/2026-09-25-org-switcher-touch-target.md` — this Phase 4 section, Per-Phase Status.

## Schema Changes

- none

## Audit Events

- none — no security-sensitive mutation; this is a CSS class fix and a test retarget.

## Implementer Notes

**Failing-first, confirmed both reds before touching the class:**
- Unit: added the `min-w-11` assertion first; ran red against the pre-fix class (`inline-flex min-h-11 min-w-0 …` — no `min-w-11` substring).
- E2E on a real dev server (port 3000 was free; no other pipeline held the lock): `header-controls.spec.ts:426` (now `:445` after the retarget added lines above it) failed with `Expected: >= 44, Received: 32` on `SWITCHER` width — exactly the bug's root cause. `header-controls.spec.ts:131`'s original `span.truncate` locator timed out (30s) waiting for a node that compact mode never renders — confirming the analyst's Phase 1 finding that this was asserting an unreachable state, not merely a stale-but-passable one.

**The class change is exactly the one-line design called for** — `min-w-0` → `min-w-11`, `justify-center` added, nothing else touched. Verified by re-running both previously-red checks: unit green, e2e green (`22 passed`).

**E2E retarget:** kept the retarget minimal and additive — split one test into two rather than rewriting in place, so the git diff shows precisely what moved. The new `/home` test reuses the `org-multi` fixture already `test.use()`'d by the enclosing `describe` block (no new fixture, no new storageState file). On `/home` with no `currentOrgSlug` set, `OrgSwitcher`'s label falls back to `"Organizations"` (still a real, non-empty `span.truncate` node with the `truncate` class wired) rather than an org name — sufficient to prove the CSS class stays present and the span is visible; it does not (and does not need to) prove pixel-level clipping, which `global-nav.test.tsx`'s existing "keeps the truncate mechanism wired for a name long enough to need it" unit test already covers with a fixture long name unavailable to e2e.

**Live-browser verification** (4 configurations: 360×800 and 1280×900, light and dark; `org-multi` fixture user, `/o/e2e-alpha`; measured via a temporary Playwright spec run against the dev server, then deleted — no artifact left in the tree):

| Viewport | Scheme | Trigger box (x, y, w, h) | Header height | Doc width | Overflow | Focus ring |
|---|---|---|---|---|---|---|
| 360×800 | light | 228.5, 8, **44×44** | 61px | 360px | none | visible (`boxShadow` set on focus) |
| 360×800 | dark | 228.5, 8, **44×44** | 61px | 360px | none | visible |
| 1280×900 | light | 304.5, 8, **44×44** | 61px | 1280px | none | visible |
| 1280×900 | dark | 304.5, 8, **44×44** | 61px | 1280px | none | visible |

Header stays a single 61px row at both widths (well under the test's 72px one-row ceiling); no horizontal scroll at either width; the switcher hits exactly 44×44 (not larger — the design's `min-w-11`/`min-h-11` floor, not a bigger fixed size). Screenshot at 360×800/light confirms visually: icon-only trigger, centered chevron (the `justify-center` addition), visible focus ring on keyboard focus, one-row header with the avatar still on-screen. Screenshots for all four configurations captured to the session scratchpad (not committed — ephemeral verification artifacts, not test fixtures).

**Nothing diverged from the Phase 3 design.** `npm run typecheck`, `npm run lint` (pre-existing unrelated warnings/errors in `portal-nav-links.tsx` only — nothing in the two files this fix touches), `npm test` (3240 passed, 0 failed), and `npm run check` (all five tripwires, including `check:brand-scope` — the `ui-ok:` annotation above `SWITCHER_TRIGGER_CLASS` was untouched and the tripwire still passes) all green. No commit made per instructions; `docs/TODO.md` and release-notes untouched per instructions (orchestrator's call at Phase 6).

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25 · **Verified by:** qa (read-only)

## Type Check

`npm run typecheck`: **PASS**.

## Unit Tests

Total 4005 | Passed **3240** | Failed 0 | Skipped 765 (29 files) | 12.0s. The two in-scope specs (`global-nav.test.tsx` + `org-switcher.test.tsx`) = **32/32** with `--reporter=verbose` so the new assertion is visibly executed. The 765 skips are the pre-existing `hasDb`-guarded DB suites, in the concurrent pipelines' territory; not counted.

## End-to-End Tests

`e2e/header-controls.spec.ts` — **22/22**, four consecutive clean full-file runs on a real dev server (one against a cold restart). **One flake observed and attributed, not counted:** `:110` ("opens from the keyboard and moves between items with the arrows") failed at `:123` in the first two full runs under machine load (menu open, focus on content not the first item); isolated `--repeat-each=5` 5/5, pre-fix 4/4, post-fix quiet 3/3, cold 1/1. The diff touches only a width utility and `justify-center`, not Radix focus management → a pre-existing load-sensitive flake in Radix's open-via-keyboard autofocus. Follow-up, not a blocker.

## Failing-First Verification

`git stash push -- src/components/shared/org-switcher.tsx` (that file only), run, `stash pop`; restore proven byte-exact by SHA-256.

| Check | Pre-fix | Post-fix |
|---|---|---|
| `global-nav.test.tsx:288` | **RED** — `expected 'inline-flex min-h-11 min-w-0 …' to contain 'min-w-11'` | GREEN 19/19 |
| `header-controls.spec.ts:445` → `:452` | **RED** — `Expected: >= 44, Received: 32` | GREEN 22/22 |

## Regression Tests Added (verified)

- `global-nav.test.tsx:288` — the compact trigger's class contains `min-w-11`; watched failing/passing.
- `header-controls.spec.ts:445/:452` — the real rendered hit target ≥ 44×44 at 360px; pre-existing, honestly red before.
- `header-controls.spec.ts:192` — the retargeted valve on `/home` (`compact=false`), asserting a node that genuinely exists.
- `header-controls.spec.ts:131` — one-row / no-wrap / no-overflow retained on `/o/<slug>`, `span.truncate` sub-assertion removed with the reason in-comment (`:158-167`). "Retarget, don't delete" honoured.

Observation: the `/home` valve test's `scrollWidth <= clientWidth` sub-assertion runs against the fallback label "Organizations" (near-vacuous); the `truncate` presence assertion is real and clipping stays covered by the `global-nav.test.tsx` long-name unit test. Adequate.

## Live-Browser Verification (my own)

`org-multi`, `getBoundingClientRect()` on the trigger:

| Viewport | Scheme | Route | Box | `--primary` | Header | scroll/client | `:focus-visible` |
|---|---|---|---|---|---|---|---|
| 360×800 | light | `/o/e2e-alpha` | **44×44** | `#1a5aa8` | 61px | 360/360 | true |
| 360×800 | light | `/o/e2e-presbytery` | **44×44** | `#7a1f2b` | 61px | 360/360 | true |
| 360×800 | dark | both | **44×44** | `#74a6e7` / `#9e4148` | 61px | 360/360 | true |
| 1280×900 | light+dark | both | **44×44** | as above | 61px | 1280/1280 | true |

Also 375px and 1440px: 44×44, no overflow, 61px header. Computed `min-width: 44px; min-height: 44px; justify-content: center`. Single row measured (mark right 224.5 → switcher 228.5–272.5 → avatar 300–344 ≤ 360). Focus ring by real Tab presses: two-layer ring with the D4 offset in all eight configurations (branded dark: `rgb(20,10,10) 0 0 0 2px, rgb(158,65,72) 0 0 0 4px`). Accessible name via `getByRole('button', { name: /current organization/i })` resolves on every org page. The new heading face does not reach the header structurally: on the branded org `h1` computes to Lora while the trigger computes to Inter (`--font-heading` is scoped to `<main>`). `/home` as `org-multi`: `span.truncate` count 1, visible; trigger 128.9×44; header 61px; no overflow.

## Coverage on Critical Modules

`permissions.ts` 100% · `two-factor.ts` 91.3% / 100% branch · `flags.ts` 100%. Untouched.

## Feature-Gate Audit

**No protected routes touched** — three files, no route, no action, no data access. `button.tsx` untouched (D4 intact). `npm run check` 5/5 — the C2 allowance on `SWITCHER_TRIGGER_CLASS` (`// ui-ok:` at `org-switcher.tsx:90`) is still load-bearing, not merely still-green. eslint clean. Working tree left as found.

## Pre-merge UX Audit Checklist

Four interaction states present; Tab-reachable with the `ring-offset-2` ring; **touch targets ≥44×44** measured at four widths; token classes only; no native dialogs; ≥2 viewports; clickable surfaces recognisable without hover. Remaining boxes n/a (no route, form, list, fetch).

## Verdict

**PASS.** The fix is the one-line change specified and nothing more; both regression tests witnessed failing against the stashed pre-fix component and passing after a byte-exact restore; the 44×44 floor confirmed in a real browser across four viewports, two schemes, branded and unbranded. Not auth-touching.

## Notes for Phase 6

1. Release-notes Fix line: yes — the tap target grows 32→44 on every congregation page; no what's-new entry (chrome ergonomics).
2. Follow-up: `header-controls.spec.ts:110`'s load-sensitive Radix autofocus flake — TODO line.
3. Incidental: `e2e/support/seed-orgs.ts:369`'s stale "e2e-alpha only" comment (already in TODO from Track B).
4. Process disclosure: my dev server was stopped with `pkill -f "next dev"` rather than by PID; no other Next process was listening at last check.

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |

---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The 32px trigger is now a measured 44×44 on every viewport and colour scheme, icon-only appearance and the D4 focus ring both intact, and the truncation valve was retargeted rather than deleted exactly as Phase 1 called for — the fix is clean, but QA's Phase 5 surfaced one genuinely new, untracked item (a pre-existing Radix autofocus flake) that needs a `docs/TODO.md` line before this pipeline closes.

## What's Working

- **The bug is gone, not patched to pass a test.** `min-w-0` → `min-w-11` plus `justify-center` on the one shared `SWITCHER_TRIGGER_CLASS`, nothing else moved; QA measured 44×44 at 360/375/1280/1440px, light and dark, branded and unbranded — eight configurations — with the chevron now centred.
- **Accessible name and focus ring both hold** (`getByRole('button', { name: /current organization/i })` resolves on every org page; a real two-layer ring with the D4 offset by actual Tab presses in all eight configurations).
- **Both failing-first proofs witnessed against a byte-exact stash/restore** — the standard a one-class-token diff needs.

## Intent-vs-Shipped Diff

- `min-w-11`, nothing else, verified live at 360 and wide, both schemes → shipped exactly that at four widths × two schemes × branded/unbranded: **matches**, exceeds on coverage.
- `justify-center` (Phase 1's pre-approved note, not a gate) → added, harmless: **matches**.
- "Retarget, don't delete" the valve → the test was split, the `span.truncate` presence check moved to `/home` as `org-multi` (genuinely `compact=false`): **matches**.
- Unit pins the class string, e2e measures pixels → both layers present, both witnessed failing-first: **matches**.
- QA's note that the `/home` valve's overflow sub-assertion is near-vacuous against the fallback label: **acceptable, not a gap** — the real clipping proof is `global-nav.test.tsx`'s long-name unit test by design; the e2e sub-assertion proves the `truncate` class is wired on a live node, which is what regressed.

## Edge Cases

Empty state, failure microcopy, permission gate, audit event: n/a. Mobile (360px): pass — 44×44, single 61px header row, no horizontal scroll, at 360 and 375 in both schemes on branded and unbranded orgs.

## Follow-Ups

- **`docs/TODO.md` line for the Radix autofocus flake at `e2e/header-controls.spec.ts:110`** (keyboard-opened menu leaves focus on the content under machine load; isolated 5/5 pre- and post-fix) — real, reproducible-under-load, not yet tracked.
- Housekeeping at close: move the org-switcher TODO line to Done; a one-line release-notes Fix entry ("Fixed a small tap target in the organization switcher on congregation pages — the icon-only button now meets the accessibility minimum size on every device"); no feedback row (Rule 12 n/a); no what's-new (Rule 13 — chrome ergonomics).
- `e2e/support/seed-orgs.ts:369`'s stale comment — already tracked from Track B.

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

### Orchestrator closure (2026-09-25)

Shipped as v0.25.1 (`fix(ui):`, `Caught-By: automated-test`, `Discovered-In: post-merge`). TODO: the org-switcher line moved to Done; the autofocus-flake line added. No what's-new entry.
