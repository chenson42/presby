# Portal UX Review Fixes (batch) — Work Log

> **Slug:** `2026-08-26-portal-ux-fixes`
> **Surface:** (org) — portal-wide polish batch
> **Permission(s):** none new — every fix is presentation/interaction-layer on already-gated pages
> **Flag(s):** none new — every touched surface keeps its existing flag
> **Estimated complexity:** medium (batch of small items)
> **Pipeline mode:** Polish batch per the Classification table — Phases 2 & 3 skipped ("Skipping Phase 2 — no new deps or structural change"); Phase 1 is the UX review itself (`docs/reviews/2026-08-26-portal-ux.md`), whose findings this batch implements. Operator directive: "Do all of them."

---

## Scope — findings implemented in this batch

From `docs/reviews/2026-08-26-portal-ux.md` (each keyed to that review):

| Finding | Item | Wave |
|---------|------|------|
| H1 | Sensitive-info selects (`Note type`/`Visibility`/`Source`) get the standard chevron treatment | 1A |
| H2 | Edit-person's "Roll action" select gets the standard select treatment | 1A |
| M3 | "Tier 3 — restricted" lock-badge indicator on the sensitive-info page | 1A |
| M4 | Filter input for the 9-option racial/ethnic checklist | 1A |
| M5 (partial) | Pastoral-notes empty state brought up to the dashed-card pattern | 1A |
| M1 | Mobile scroll affordance for the roles/officers tables | 1B |
| M6 | Branding tile gets its own icon (no longer shares Groups' glyph) | 1B |
| L1 | Directory member/household cards get the chevron/hover affordance | 1B |
| L6 | Tickets' permission-denied state reuses the lock-badge visual | 1B |
| L5 | Mobile portal nav becomes an overlay (Sheet-style) instead of in-flow push-down | 1B |
| H4 | Parishes dead-end cards resolved | 1C |
| H3 | Unsaved-changes guard (`isDirty` + `AlertDialog`) on edit-person, branding, sensitive-info, officer-term, role forms | 2 |
| M2 | Edit-person page gets card-separated visual structure (profile / roll action / sensitive-info link) | 2 |
| L3 | Required-field markers on the wizard/edit-person/officer forms | 2 |
| L2 | Branding's logo file input styled to match its neighbors | 2 |

**Deferred (feature-class, not polish):** L4 (feedback submission history) — needs its own pipeline; filed in `docs/TODO.md` Next Up.

Waves exist to keep concurrent implementers off each other's files: 1A (sensitive-info + record-roll-action forms), 1B (tables/tiles/directory cards/nav/tickets), and 1C (parishes) are disjoint and run in parallel; wave 2 (edit-person-form, branding-form, plus the guard touching several forms) runs after wave 1 lands because it overlaps 1A's files.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (the UX review itself) | Complete | `docs/reviews/2026-08-26-portal-ux.md` | 2026-08-26 |
| 2 — Architectural review | — | Skipped | Polish batch — no new deps, no structural change | 2026-08-26 |
| 3 — Technical design | — | Skipped | Each finding's fix is named in the review; waves documented above | 2026-08-26 |
| 4 — Implementation | ux-developer ×3 (wave 1, parallel) → full-stack-developer (wave 2) | Complete | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 4 — Implementation

*(sections appended per wave as they complete)*

## Wave 1B (ux-developer)

Findings implemented: **M1**, **M6**, **L1**, **L6**, **L5**. Scope held exactly
to the assigned files; no other wave's files touched.

**M1 — table scroll cue.** Fixed at the shared primitive
(`src/components/ui/table.tsx`), not per-page. `table-container`'s wrapper div
now carries a CSS-only right-edge fade/shadow via the classic
`background-attachment: local` (vs `scroll`) two-layer technique — no
measurement JS, no new DOM node, and it degrades to nothing on a table that
never overflows (the local layer always exactly covers the shadow layer when
content-edge and container-edge coincide). Divergence documented with a header
comment per CLAUDE.md's shadcn-primitive rule. Uses `var(--background)` so the
fade tracks a per-org brand override rather than a hardcoded color. Verified
live at 390px on `/o/fpcw/admin/roles` and `/o/fpcw/admin/officers` (cue
visible, action column readably cued) and at desktop on `/admin/flags` (no
cue — table doesn't overflow).

**M6 — tile icon map.** `groups` and `branding` were unmapped in
`TILE_ICONS` and both silently fell back to the same `LayoutGrid` glyph.
Added `UsersRound` (groups) and `Palette` (branding) — both already available
from `lucide-react`, no new dependency. Verified live: `/o/fpcw` (Groups tile)
and `/o/fpcw/admin` (Branding tile) now show distinct glyphs from each other
and from Roles/Officers/Directory.

**L1 — directory card chevron.** `person-card.tsx` and `household-card.tsx`
name links now carry a trailing `ChevronRight` that nudges right on hover
(`group` / `group-hover:translate-x-0.5`), mirroring `TileGrid`'s established
pattern, scoped to the name `<Link>` only (not the whole card, which holds
independent `mailto:`/`tel:` targets on `PersonCard`). `hover:shadow-md` on
the outer `Card` is unchanged. Verified live on `/o/fpcw/directory` (members)
and `?view=households`.

**L6 — tickets permission-denied lock badge.** `TicketsForbidden` in
`tickets-states.tsx` gained a `Badge variant="outline"` + `Lock` icon reading
"Restricted," reusing `PersonCard`'s existing lock-badge visual language.
Copy is untouched, per the finding's visual-only scope. The signed-in dev
seed user holds `tickets.file`, so this state isn't reachable live in this
session's browser pass — verified via the component's own unit test instead
(asserts the `Lock` icon and badge text render), which is the documented
fallback the task anticipated.

**L5 — mobile nav overlay.** `portal-nav-links.tsx`'s sub-`sm` menu is now
`absolute` (positioned under the toggle row via a `relative` `<nav>`
ancestor, `top-full`, `z-20`, `bg-background`, bordered, `shadow-lg`) instead
of in-flow, so opening it no longer pushes page content down — confirmed via
screenshot comparison (closed vs. open state: the "Tools" heading sits at the
identical position in both). Preserved, unedited: the most-specific-match
active-state algorithm, all 9 pre-existing tests, close-on-navigate,
`aria-expanded`/`aria-controls`, the 44px targets, and the unchanged `sm:`
desktop presentation (`sm:static`, `sm:border-0`, `sm:shadow-none` reset the
overlay treatment back to the original in-flow row). No Radix `Sheet` added —
pure Tailwind positioning change to the existing single DOM list.

**Tests.** New: `src/components/ui/table.test.tsx`,
`.../directory/person-card.test.tsx`, `.../directory/household-card.test.tsx`
(neither had a test file before this wave). Extended:
`tile-grid.test.tsx` (M6 regression), `tickets-states.test.tsx` (L6
regression), `portal-nav-links.test.tsx` (L5 regression, all 9 prior tests
kept intact and passing). Updated one pre-existing, now-stale assertion:
`directory-grid.test.tsx`'s per-card svg count (3 → 4, accounting for the new
chevron) — a legitimate count change from L1, not a weakened test.

**Verification run:** `npm run typecheck` clean. `npx vitest run` on the six
touched test files: 31/31 passed. Full `npm test`: 2520 passed, 428 skipped,
0 failed. `npm run check` (all four tripwires): clean. Live-browser pass at
390px and desktop via Playwright against the running dev server (screenshots
reviewed, not just captured) covering: roles/officers scroll cue, flags
no-cue control, tile icons (home + admin hub), directory member/household
card chevrons, and the nav overlay open/closed comparison.

**What a reviewer should click through:** `/o/fpcw/admin/roles` and
`/o/fpcw/admin/officers` at ~390px (scroll cue on the right edge, disappears
once scrolled to the table's true end); `/o/fpcw` and `/o/fpcw/admin` at any
width (Groups and Branding tiles now have their own icons); `/o/fpcw/directory`
and `/o/fpcw/directory?view=households` (chevron nudges on card hover);
`/o/fpcw` below 640px width, tap the hamburger (menu overlays instead of
pushing the greeting/search/tiles down).

**New copy strings for a fork's branding pass:** none — L6 is visual-only and
reuses existing copy; no new user-facing strings were introduced in this
wave.

**UX tradeoffs:** M1's fade color is pinned to `var(--background)`, which
matches every current call site (no `Table` today sits directly inside a
`bg-card` panel) but would look slightly wrong if a future page nests a table
inside a card — flagged in the primitive's header comment as a known
constraint, not silently assumed. L6 could not be confirmed against a live
"denied" render in this session (the seeded admin user holds `tickets.file`);
covered by unit test instead, as anticipated by the task brief.

**Handoff:** to qa (Phase 5) for verification alongside waves 1A/1C, once all
three land.

Files touched: `src/components/ui/table.tsx`,
`src/components/ui/table.test.tsx` (new),
`src/components/org-portal/tile-grid.tsx`,
`src/components/org-portal/tile-grid.test.tsx`,
`src/app/(org)/o/[slug]/directory/person-card.tsx`,
`src/app/(org)/o/[slug]/directory/person-card.test.tsx` (new),
`src/app/(org)/o/[slug]/directory/household-card.tsx`,
`src/app/(org)/o/[slug]/directory/household-card.test.tsx` (new),
`src/app/(org)/o/[slug]/directory/directory-grid.test.tsx` (assertion update),
`src/app/(org)/o/[slug]/portal-nav-links.tsx`,
`src/app/(org)/o/[slug]/portal-nav-links.test.tsx`,
`src/app/(org)/o/[slug]/tickets/tickets-states.tsx`,
`src/app/(org)/o/[slug]/tickets/tickets-states.test.tsx`.

## Wave 1C — H4 (parishes dead-end cards)

**Scope:** `src/app/(org)/o/[slug]/directory/parish-roster.tsx` only (plus a
new colocated `parish-roster.test.tsx`).

**Option chosen: (a) — visually demote, no new route.** Checked
`getParishRoster()` (`src/lib/directory.ts`) first: it returns only
per-district aggregates (`orgUnitId`, `orgUnitName`, `deaconName`,
`householdCount`) — no per-parish member/roster rows exist to drill into.
Building a detail surface (option b) would need a new reader plus a new page,
which is feature-class and out of this polish batch's scope per the task
brief. Filed the future detail page as a follow-up in `docs/TODO.md` Next Up
rather than building it.

**What changed:** the district panels were rendered as `<Card>`/`<CardContent>`
— the exact same `bg-card` + `shadow-sm` recipe `PersonCard`/`HouseholdCard`
use for their real links (with `hover:shadow-md` layered on for those, per
DECISION-099) — so at rest they were visually indistinguishable from the
clickable Members/Households cards in the same three-tab control, matching
the review's finding exactly. Swapped the district panel to a plain `<div>`
styled `rounded-lg border border-border bg-muted/40 p-4` — the same flat,
non-interactive "info panel" language already used elsewhere in the portal for
read-only summaries (the 2FA recovery-codes panel, the file-ticket form's
context box, `/admin/audit`'s filter bar). No `<a>`/`Link`, no hover-lift, no
`cursor-pointer` — never had any of those to begin with, but the shared `Card`
recipe alone was enough to read as clickable, which is what's fixed. Verified
live against the current Members tab (which already carries a per-card
chevron affordance from a concurrent wave-1B fix) that the contrast is now
unambiguous: bordered/shadowed card + chevron for real links vs. flat muted
panel with no icon for the parish summaries.

**New copy:** none — no strings changed, only layout/visual treatment.

**Tests:** new `parish-roster.test.tsx` (4 tests: content renders correctly,
no `<a>`/link role present, no hover-lift/cursor-pointer class present, empty
state unchanged). Existing `parishes/page.test.tsx` orchestration tests
untouched and still pass (16/16 combined). `npm run typecheck` and
`npm run check` clean. Full `npm test` has one unrelated pre-existing failure
in `src/components/ui/table.test.tsx` (a concurrent wave-1B change to a
different file, confirmed via `git status`, not touched by this wave).

**Verified live:** dev server, `/o/fpcw/directory/parishes`, both 1280px and
390px — panels render flat/muted with no clickable affordance, in visible
contrast to the Members tab's linked cards.

**Reviewer click-through:** `/o/fpcw/directory/parishes` at both widths;
compare visually against `/o/fpcw/directory` (Members tab).

**Next:** qa (Phase 5) once all wave-1 files land.

## Wave 1A (ux-developer)

**Files touched:**
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/sensitive-info-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/sensitive-info-form.test.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.test.tsx`

**H1** — Wrapped the `Note type`, `Visibility`, and `Demographics Source`
`<select>`s each in a `relative` div with a `ChevronDown` (`pointer-events-none`,
absolutely positioned) and added `pr-8` to `SELECT_CLASSES`, matching
`directory-grid.tsx`'s status select. Checked the file for any other bare
select — none found beyond the three named.

**H2** — Same treatment applied to the `record-roll-action-form.tsx` "Roll
action" select (was neither `appearance-none` nor chevroned — full native
browser chrome), now visually consistent with the household select directly
above it on the edit-person page.

**M3** — Added a small `Badge` (`variant="outline"`) at the top of
`SensitiveInfoForm` with a `Lock` icon (mirrors `person-card.tsx`'s "Hidden
from the directory" badge) reading "Restricted — visible only to the offices
holding each section's permission." New copy string; a branding pass should
review the wording.

**M4** — Added a text `Input` (`placeholder="Filter options…"`, `sr-only`
label) above the 9-option racial/ethnic checklist in `DemographicsSection`.
Client-side, case-insensitive `includes` match against the space-joined
option label; shows all 9 when empty, and a "No options match "…"." message
when the filter yields zero rows. New copy string.

**M5 (partial)** — Replaced the pastoral-notes bare `<p className="text-sm
text-muted-foreground">No notes recorded yet.</p>` with the house dashed-card
empty state (mirrors `groups-list.tsx`): "No notes recorded yet" (primary
line) + "Add the first pastoral care note below." (secondary line, new copy
string) inside a `rounded-lg border border-dashed`.

**UX tradeoffs:**
- Kept the filter input un-debounced (client array of 9 strings — no
  performance concern) and did not add a "clear" button; typing back to empty
  restores the full list, consistent with the directory's own simple filter
  patterns.
- Did not touch `edit-person-form.tsx`'s household select (already correct,
  serves only as the H2 reference) or any other file — wave 1B/1C/2 own
  everything else per the batch's wave split.

**Test results:**
- `npx vitest run` on both test files: 24/24 passing (9 in
  `record-roll-action-form.test.tsx`, incl. new "select chevron (H2)" case;
  15 in `sensitive-info-form.test.tsx`, incl. new "restricted indicator
  (M3)", "select chevrons (H1)" ×3, "pastoral notes empty state (M5)", and
  "racial/ethnic filter (M4)" ×2 cases).
- `npm run typecheck` — clean.
- `npm run check` (audit / sql-date / deps-drift / brand-scope) — all four
  tripwires pass.
- `npx eslint` on all four touched files — no warnings.

**Live verification:** Dev server on `localhost:3000`, session from
`/tmp/state.json` (fpcw, all flags on, sensitive-info permissions held).
Loaded `/o/fpcw/admin/members/f1000000-0000-0000-0000-000000000001/edit` and
its `/sensitive` sub-page via Playwright, screenshotted both, and read the
screenshots: the "Roll action" select now visually matches the "Household"
select above it (both show the down-chevron); the sensitive-info page shows
the lock-badge restricted indicator at the top, the three selects (Note type,
Visibility, Source) all show visible chevrons, the racial/ethnic checklist
has the "Filter options…" input above it, and the empty pastoral-notes
section renders the dashed-card "No notes recorded yet" / "Add the first
pastoral care note below." pair instead of the old bare muted line. No
console errors observed.

**Reviewer click-through:** `/o/<slug>/admin/members/<id>/edit` (Roll action
select chevron) → "Pastoral notes, demographics, medical & disability
information" link → sensitive-info page (restricted badge, three select
chevrons, empty-state card if the person has no notes yet, and typing into
the new filter box above the racial/ethnic checklist).

**Next agent:** qa (Phase 5) — once waves 1B and 1C also land, since the
batch's Phase 5/6 verdicts cover the whole day's batch per the work-log's
Per-Phase Status table.

## Wave 2 (full-stack-developer)

Findings implemented: **H3**, **M2**, **L3**, **L2**. Ran after all of wave 1
landed, since this wave's files overlap wave 1A's (`edit-person-form.tsx`,
`sensitive-info-form.tsx`, `record-roll-action-form.tsx`).

### H3 — unsaved-changes guard

**Mechanism.** `docs/ui-standards.md`'s § Forms — Unsaved Changes Guard
prescribes a concrete recipe (`isDirty` + `discardOpen`/`pendingHref` state,
an explicit Back/Cancel click handler, an `AlertDialog`) — implemented that
recipe exactly, packaged as a reusable hook rather than six hand-rolled
copies:

- `src/components/shared/use-unsaved-changes-guard.ts` — `useUnsavedChangesGuard(isDirty)`.
  Returns `{ discardOpen, setDiscardOpen, guardedNavigate, confirmDiscard }`.
- `src/components/shared/unsaved-changes-dialog.tsx` — the one `<AlertDialog>`
  every call site renders (title "Discard unsaved changes?", Stay/Discard
  buttons — the task brief's own wording, a close paraphrase of
  ui-standards.md's "Discard changes?" / "Keep editing"/"Discard changes").

**Scope — broader than the documented minimum, not narrower.** The task
anticipated a fallback ("dirty-state + beforeunload + guard on the explicit
Back/Cancel links within the form pages") if generic interception proved too
invasive. It didn't: alongside `beforeunload` (hard navigation/tab close),
the hook adds a **document-level, capture-phase click listener** on
same-origin `<a href>` elements while dirty — a technique the task brief
itself named as the other option ("intercepting Link clicks needs a
click-capture approach"). This catches not only each form's own explicit
Cancel button, but links the form did NOT render itself: the admin shell's
shared "Back to portal" link (`admin/layout.tsx`, one layout up — the review's
own branding repro) and each roles page's "Back to roles" link
(`new/page.tsx` / `[id]/edit/page.tsx`, a server component above the client
form). Neither of those files needed to change; the guard is entirely
self-contained inside the guarded client component. Skipped deliberately:
modifier-clicks (new-tab), `target=_blank`, `download`, `#`/`mailto:`/`tel:`
links, and cross-origin links — all left to the browser's default behavior.

**Wired into all six named forms:**
- `edit-person-form.tsx` — `isDirty` is RHF's own `formState.isDirty`; guards
  the in-form Cancel button.
- `admin/branding/branding-form.tsx` — `isDirty` is a manual comparison
  (seedHex/typePairing/lightOnly vs. `initial*` props, plus a new
  `logoSelected` boolean for the otherwise-uncontrollable file input, reset
  inside the form action itself post-success — see the lint note below). No
  in-form Back/Cancel exists; the click-capture is the only thing that
  catches its "Back to portal" repro.
- `sensitive/sensitive-info-form.tsx` — FOUR independent sub-forms
  (pastoral notes / demographics / medical / disabilities), one shared guard
  at the parent: each section computes and reports its own boolean dirty
  state up via `onDirtyChange`, the parent ORs them together. Demographics/
  medical/disabilities each track a "saved snapshot" in **state** (not a
  ref — `router.refresh()` re-renders the Server Component tree but doesn't
  hand this already-mounted client instance new `initial` props, so the
  snapshot has to move forward on its own section's successful save, same
  reasoning `branding-form.tsx`'s pre-existing re-seed effect already
  established for a different symptom).
- `admin/officers/add-officer-term-form.tsx` — RHF's `formState.isDirty`
  again; no in-form Back/Cancel, click-capture only.
- `admin/roles/new/create-role-form.tsx` — two independent forms (create /
  adopt-template) on one page, one combined `isDirty`.
- `admin/roles/[id]/edit/edit-role-form.tsx` — `isDirty` compares the
  toggled permission `Set` against a `savedKeys` state snapshot, synced on
  successful save.

**A lint fix along the way.** The first draft mutated a plain
`useRef().current` directly during render (both to write the guard's own
`isDirtyRef` and to read the sensitive-info sections' "saved snapshot"
comparisons) — React's `react-hooks/refs` rule correctly flags both as
impure. Fixed by moving the guard's ref write into its own `useEffect`, and
by replacing the three sensitive-info sections' `useRef` snapshots with
`useState` (the comparison reads state during render, which is legal; a
`.current` read during render is not). Also moved `branding-form.tsx`'s
post-save `logoSelected` reset OUT of the existing toast-`useEffect` and into
the `useActionState` action itself, since a `setState` call inside an effect
that only reacts to another piece of state (rather than a real external
event) is exactly what `react-hooks/set-state-in-effect` flags — the action
function running as part of form submission is the correct place for it.
Two PRE-EXISTING lint errors remain untouched, out of this wave's scope:
`branding-form.tsx`'s own staleness-bug-fix re-seed effect (predates this
session) and `portal-nav-links.tsx`'s `setOpen(false)` effect (wave 1B).

### M2 — edit-person card structure

`page.tsx` now wraps the three concerns in their own `rounded-xl border
bg-card shadow-sm` panels: "Profile" (a new page-level heading over
`EditPersonForm`), "Record a roll action" (wraps `RecordRollActionForm`
unchanged except its own `border-t pt-6` divider is gone — redundant once a
card boundary supplies the separation — its existing internal heading serves
as the card's header), and the sensitive-info link as its own small card with
a `Lock` icon prefixing the link text. No tabs, per the task's explicit
scope note.

### L3 — required-field markers

`src/components/shared/required-mark.tsx` — a small `<span aria-hidden="true">
*</span>`, paired with `aria-required="true"` on the field. Applied to every
schema-required field across the three named form families: the wizard
(`search-step.tsx` first/last name, `identity-step.tsx` first/last name,
`household-step.tsx`'s conditionally-required household name/select,
`roll-action-step.tsx`'s roll-action select and effective date — all via a
new `required` prop on the shared `wizard-field.tsx`), `edit-person-form.tsx`
(first/last name, the conditionally-required household name/select), and
`add-officer-term-form.tsx` (person, office, start date, and the
conditionally-rendered-and-required district select).

**A test-regex fix rippled from this.** `getByLabelText(/^first name$/i)`-style
anchored regexes in `member-wizard.test.tsx`, `edit-person-form.test.tsx`,
`page.test.tsx`, and `add-officer-term-form.test.tsx` no longer matched once
the label's accessible name gained a trailing " *" (confirmed live:
`aria-hidden` content is NOT excluded from `@testing-library/dom`'s
`getByLabelText` name computation, unlike a full ARIA accname computation —
tested directly before assuming so). Loosened the anchors
(`/^first name/i`, etc.) rather than weakening any assertion's actual check.

### L2 — branding logo file input

Styled via Tailwind's `file:*` variants on the existing `<Input type="file">`
— no wrapper markup, no visually-hidden-input trick — to match the
`Button` `variant="outline"` look (`file:rounded-md file:border
file:border-input file:bg-background`, `hover:file:bg-muted`). Needed a
`// ui-ok:` annotation for `check:brand-scope`'s C2 rule (a button-shaped
class string outside `src/components/ui/`) — it's the native input's own
selector-button pseudo-element, not a real `<button>`.

**Tests.** New: `src/components/shared/use-unsaved-changes-guard.test.tsx`
(11 cases: clean-vs-dirty for both the explicit `guardedNavigate` path and
the click-capture path, Stay/Discard, modifier-click/off-site/fragment-link
pass-through, `beforeunload`). Extended with guard + required-marker +
card-structure cases: `edit-person-form.test.tsx`, `member-wizard.test.tsx`,
`sensitive-info-form.test.tsx`, `add-officer-term-form.test.tsx`,
`branding-form.test.tsx` (guard + L2's file-input-class assertion),
`create-role-form.test.tsx`, `edit-role-form.test.tsx`, `page.test.tsx`
(M2's three-`.bg-card` assertion).

**Verification run.** `npm run typecheck` clean. `npm test`: 2561 passed, 428
skipped, 0 failed (full suite, not just touched files). `npm run build`
clean. `npm run check` (all four tripwires) clean. Live-browser pass via
Playwright against the running dev server (`/tmp/state.json` session,
`fpcw`): dirtied `edit-person-form`'s First name field, clicked Cancel,
confirmed the `AlertDialog` opened, Stay kept the typed value and stayed on
the page, a second Cancel→Discard navigated to `/admin/members`; dirtied
`branding-form`'s colour field, clicked the admin shell's "Back to portal"
link (never wired directly by the form), confirmed the SAME dialog
intercepted it and Discard completed the navigation to `/o/fpcw`; screenshot
of `edit-person` at 1280px and 390px confirms the three-card structure reads
correctly at both widths (Profile / Record a roll action / the small
lock-icon sensitive-info card); screenshot of the branding page confirms the
logo input's "Choose File" button now matches the form's other bordered
controls instead of raw OS chrome.

**Files touched:** `src/components/shared/use-unsaved-changes-guard.ts` (new),
`src/components/shared/use-unsaved-changes-guard.test.tsx` (new),
`src/components/shared/unsaved-changes-dialog.tsx` (new),
`src/components/shared/required-mark.tsx` (new),
`src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` (+test),
`src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.tsx`,
`src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/sensitive-info-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/branding/branding-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/officers/add-officer-term-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/roles/new/create-role-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/roles/[id]/edit/edit-role-form.tsx` (+test),
`src/app/(org)/o/[slug]/admin/members/new/wizard-field.tsx`,
`src/app/(org)/o/[slug]/admin/members/new/identity-step.tsx`,
`src/app/(org)/o/[slug]/admin/members/new/search-step.tsx`,
`src/app/(org)/o/[slug]/admin/members/new/roll-action-step.tsx`,
`src/app/(org)/o/[slug]/admin/members/new/household-step.tsx`,
`src/app/(org)/o/[slug]/admin/members/new/member-wizard.test.tsx`.

No schema change. No new env var or `FEATURES`/flag entry — every touched
surface keeps its existing gate.

**What a reviewer should test in the browser:** `/o/<slug>/admin/members/<id>/edit`
(dirty a field, click Cancel, confirm the dialog, verify Stay/Discard both
behave; confirm the three-card layout at desktop and ~390px);
`/o/<slug>/admin/branding` (dirty the colour or pick a logo file, click "Back
to portal," confirm the same dialog intercepts it; check the styled "Choose
File" button); `/o/<slug>/admin/members/<id>/edit/sensitive` (dirty any one
of the four sections, confirm the guard fires, confirm saving that section
clears it again without needing to touch the others);
`/o/<slug>/admin/officers` (Add officer term — dirty then click "Back to
officers"); `/o/<slug>/admin/roles/new` and `/o/<slug>/admin/roles/<id>/edit`
(dirty then click "Back to roles"); required-field asterisks on the six-step
add-a-person wizard, edit-person, and add-officer-term.

**Next agent:** qa (Phase 5), for the whole day's batch (waves 1A/1B/1C/2).

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

**Auth-touching check:** confirmed via git status/diff — nothing under `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`. The stricter gate does not apply.

## Commands

- `npm run typecheck` — clean. `npm run check` — all four tripwires pass. `npm run build` — clean.
- `npm test` — 187 files passed, 19 skipped; **2561 tests passed, 428 skipped, 0 failed** — matches the work-log's own numbers exactly.
- The 428 skips confirmed pre-existing via `git stash` + re-run on the pre-batch tree — which also showed 4 test files (person-card, household-card, table, +1) **failing** on pre-batch code: real fail-before/pass-after evidence, not just assertion.
- `npm run lint`: two pre-existing errors (verified via `git show HEAD:` to predate this batch) — not regressions.

## Unsaved-changes guard (H3) — read in full

- Clean-form no-op: `isDirtyRef.current` checked before any interception; covered by test.
- **Modified clicks / new-tab / external / download / fragment links all pass through untouched** (`use-unsaved-changes-guard.ts:78-97,105`): `metaKey/ctrlKey/shiftKey/altKey`, non-left button, `target="_blank"`, `download`, `#`/`mailto:`/`tel:`, cross-origin — cmd-click/open-in-new-tab is never swallowed. Covered by its own test.
- Listeners cleaned up on unmount; Stay leaves the form intact; Discard navigates to the captured href; `beforeunload` never blocks unless dirty (registered at mount, gated by the dirty ref — a cosmetic deviation from a literal "registered only while dirty," no behavioral difference).
- Guard's own test file 11/11; all six wired forms confirmed via grep with extended coverage.

## Per-wave spot checks

- 1A: three ChevronDown+relative wrappers present in `sensitive-info-form.tsx`. Confirmed.
- 1B: `table.tsx:1-33` carries the required shadcn-divergence header comment (dated, findings-keyed). Confirmed.
- 1C: `parish-roster.tsx` — no link, no hover-lift, plain `bg-muted/40` panel. Confirmed.
- 2: three `bg-card` panels on `edit-person/page.tsx`; `RequiredMark` + `aria-required` present. Confirmed.

## Brand-scope annotation

`branding-form.tsx`'s `// ui-ok:` annotation read against `check-brand-scope.mjs`'s C2 rule — the `file:*` classes style a native file input's selector-button pseudo-element, not a hand-rolled `<Button>` substitute; the annotation matches the escape hatch's intended purpose. Legitimate.

## Scope reconciliation

Review lists 16 findings; work-log covers 15 implemented + L4 explicitly deferred to `docs/TODO.md`. No silent drops.

## Feature-Gate Audit

No route/actions files in the diff — presentation/interaction-layer batch on already-gated pages. No protected routes touched.

## Verdict

**PASS** — all checks green, guard behavior verified against every stated risk including the modified-click/new-tab case, cross-wave integration confirmed by direct file inspection, scope fully reconciled.

**Handoff:** analyst (Phase 6 — Shipped vs Intent).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> "Do all of them" was honored honestly — all 16 review findings are accounted for (15 shipped, 1 filed as an explicit feature-class deferral), and the four spot-checked fixes read as genuinely fixed to the operator who filed the review, not just technically-touched.

## What's Working

- H1/M3: all three sensitive-info selects carry visible chevrons; a Lock-badge "Restricted" indicator sits at the top — directly answers the complaint that the tiered-privacy control was invisible.
- M2: edit-person is now three distinct `bg-card` panels replacing the bare-`<hr>` undifferentiated scroll.
- H4: the honest fix — district panels demoted from `Card` (falsely implying clickability) to flat info panels, with the real detail-page work correctly deferred and filed rather than half-built.
- L5: the mobile nav genuinely became an overlay — the review's "oldest-feeling interaction left in the portal" now isn't.
- H3: "Discard unsaved changes? / Stay / Discard" reads as plain, human copy.

## Intent-vs-Shipped Diff

- Scope reconciliation: 16 findings, 15 implemented + L4 named as a deferral in the scope table with a TODO.md line and rationale. Nothing silently dropped. **Matches.**
- H3 guard scope — honest, not oversold: exactly six named forms, stated explicitly, with the click-capture mechanism closing the exact reported gap (shared "Back to portal" links) without a false app-wide claim. **Matches.**
- H4 — shipped the demotion option because the wiring option requires a data model that doesn't exist; documented, tracked. **Acceptable, correct polish-batch call.**

## Edge Cases

- Mobile (390px): verified live for the spot-checked fixes and waves 1B/1C generally.
- L6: couldn't be verified live (seeded user holds tickets.file) — covered by unit test, flagged honestly.
- No security-sensitive mutation — correctly no new audit key.
- 2FA/auth: not implicated, confirmed via diff.

## Follow-Ups

Both already filed (per-parish detail page; feedback submission history) — no new ones. Housekeeping at commit: TODO.md Done line for the batch; a short v0.17 Polish release-notes entry (optional — most fixes ride seeded-off flags); functionality-map NOT needed (polish on already-mapped surfaces); what's-new folds into the existing deferred chrome entries at flag-flip time, no new entry.
