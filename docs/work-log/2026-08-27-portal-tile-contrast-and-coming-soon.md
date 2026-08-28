# Portal tile contrast + a distinct "coming soon" treatment — Work Log

> **Slug:** `2026-08-27-portal-tile-contrast-and-coming-soon`
> **Surface:** `(org)` portal home + admin hub (shared `TileGrid`/`DomainTileSections`, also reachable from the platform `/admin` axis)
> **Permission(s):** none — pure presentation
> **Flag(s):** none — pure presentation
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Classification: Polish/visual (CSS/copy changes to an existing shared component, no new deps, no schema change, no API surface change). Phases 1–3 skipped with notation below; self-implemented, live-browser-verified against a real seeded org's own brand.
> **Source:** operator, 2026-08-27, live feedback with a screenshot of `/o/fpcw`: "i dont mind if the docs go in with the last commit... i'm still also still not a fan of the portal ui. it needs something. doesn't feel as clean and new as the original ../../fpcw-directory."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | skipped (notation below) | — | — | 2026-08-27 |
| 2 — Architectural review | skipped (notation below) | — | — | 2026-08-27 |
| 3 — Technical design | skipped (notation below) | — | — | 2026-08-27 |
| 4 — Implementation | self | Complete | — | 2026-08-27 |
| 5 — Verification | self | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | self | Complete | SHIP WITH NOTES | 2026-08-27 |

---

## Phases 1–3 — skipped, with notation

Operator feedback ("doesn't feel clean," a screenshot, "open to suggestions") rather than a scoped feature request — there was no functional ambiguity to refine (Phase 1), no new directory/dependency/server-client split to review (Phase 2 — this is a CSS/copy change inside one already-shared component pair), and no API contract or data model to design (Phase 3). The actual design decisions are recorded in Phase 4 below.

---

# Phase 4 — Implementation

## Diagnosis

Took a real screenshot of the live `/o/fpcw` portal home (fpcw's own seeded brand, `seedHex #60a7a1`, `light_only: true`) rather than reasoning from memory. Two concrete, confirmed findings, not vibes:

1. **The icon badge (`bg-primary/10 text-primary`) was nearly the lowest-contrast element on the page** — a 10%-opacity brand tint sitting on top of a page background that D7 also permits tinting toward the brand hue, so on a real org's own branding the badge barely separated from the page behind it. Meanwhile the avatar-menu circle in the header corner uses a **solid** brand fill and read as far more prominent — backwards, since the tile badge is the single most-repeated element on the page (one per tile) and the avatar is a corner affordance seen once.
2. **Every "coming soon" stub tile rendered with identical visual weight to a real, working tool** — same card, same badge treatment, the only difference a trailing ". Coming soon." clause buried in the description's second sentence. On `/o/fpcw`'s own home page, 4 of 10 visible tool cards were non-functional stubs presented as equals to Members/Directory/Groups/Staff/Events/Officers, diluting the whole page.

A third, unrelated but real bug was found while reading the tile registry to fix the above: **`oversight` and `reports`' tile descriptions still said "Coming soon."** even though `docs/work-log/2026-08-27-presbytery-oversight-statistics.md` shipped real, substantial admin pages behind both routes the same day (123 and 294 lines respectively, real forms/tables/schemas, not stubs) — confirmed directly by reading both `page.tsx` files, not assumed from the Done-log entry alone. Stale copy, not a design defect.

## Fix

1. **`src/lib/org-portal/tiles.ts`**: added a `comingSoon?: boolean` field to `PortalTile` — a fifth, orthogonal, presentation-only routing question in the same documented style as `category`/`orgTypeScope`/`domain` (never a gate; the destination route still renders its own honest state). Set `true` on the five genuinely-still-stub tiles (`giving`, `worship`, `committees`, `insights`, `communications`) and stripped the now-redundant "Coming soon." clause from each one's `description` (the field's own doc comment makes this a hard contract: a tile setting `comingSoon` must not also say so in its description, so the two can never disagree). Removed "Coming soon." from `oversight`/`reports`' descriptions entirely (real functionality, not a `comingSoon: true` case) and corrected the block's own header comment, which used to say "every tile below is an inert stub" — no longer true for those two.
2. **`src/components/shared/tile-grid.tsx`**: added `comingSoon?: boolean` to the shared `TileLike` interface (generalized, not org-portal-only, so a future platform-axis roadmap tile gets the same treatment for free). Live tiles now render a **solid** `bg-primary text-primary-foreground` icon badge instead of the translucent tint — a contrast fix, not a reversal of DECISION-105's "brand color pushed down to a small badge, not full-bleed" ruling; the badge is still small and confined to the icon. A `comingSoon` tile instead gets a muted `bg-muted text-muted-foreground` badge (never brand color — an unbuilt feature shouldn't borrow a real one's visual energy) and a `<Badge variant="secondary">Coming soon</Badge>` pill next to its heading, replacing the old un-structured description-text convention.

## Files Modified

- `src/lib/org-portal/tiles.ts` — `comingSoon` field + doc comment, 5 tiles marked, 2 stale "Coming soon" descriptions removed (oversight/reports), block header comment corrected.
- `src/components/shared/tile-grid.tsx` — `TileLike.comingSoon`, solid live-tile badge, muted comingSoon badge + pill, updated doc comments explaining both changes and why they don't reverse DECISION-104/105.

## Schema Changes

None — `PortalTile`/`TileLike` are static, in-code registries, not database tables.

## Verification

- `npm run typecheck`: clean.
- `npx vitest run src/lib/org-portal/tiles.test.ts src/components/shared/domain-tile-sections.test.tsx`: 47/47 passed (the tiles snapshot test, which pins the seed-flag list, was unaffected by the new field).
- `npx vitest run src/components/org-portal/coming-soon.test.tsx` (the actual "coming soon" *page* component, a different concept from this tile-badge treatment — checked it wasn't accidentally touched): 6/6 passed.
- `npm test` (full suite): 3066 passed, 0 failed, 602 skipped (unchanged skip count).
- `npm run check:brand-scope`: clean — the new `<Badge>` usage goes through the generated primitive, not a hand-rolled class string, so C2 doesn't flag it.
- **Real-browser verification, per CLAUDE.md's own invariant**: screenshotted `/o/fpcw` at desktop (light — fpcw's own `light_only: true` correctly ignores a `prefers-color-scheme: dark` context, confirmed not a bug) and mobile (375px). Live tiles now read as clearly more prominent than the coming-soon stubs; the pill wraps to a second line under a long title at 375px on one tile ("Worship & Service Planning") — readable, not broken, noted as a follow-up rather than blocking.

## Implementer Notes

Scoped narrowly to the two files that needed to change. Did NOT touch: the org's own bounded background tint (D7 permits it; the operator's own earlier brand-editor choice, not a bug to silently override), the `tile` Button variant's shadow/hover treatment (already reasonable, not what the screenshot evidence pointed at), or the admin-portal's own tile registry (`src/lib/admin-portal/tiles.ts` — no stub tiles exist there today; the shared `TileLike.comingSoon` field is additive/optional so nothing there needed a change, and admin tiles pick up the fix for free if a future one ever needs `comingSoon: true`).

---

# Phase 6 — Shipped vs Intent (self)

## VERDICT

**SHIP WITH NOTES**

## What's Working

- Both concrete diagnoses (badge contrast, comingSoon dilution) are fixed with real before/after screenshots as evidence, not just code review.
- The stale "Coming soon" copy on two now-real features (oversight/reports) was caught as a byproduct of reading the registry carefully — a real bug fixed in the same pass, not left for a future rediscovery.
- The `comingSoon` field follows this file's own established pattern (documented, orthogonal, presentation-only, never a gate) rather than inventing a new convention.

## Follow-Ups (SHIP WITH NOTES)

- The "Coming soon" pill wraps awkwardly under a long tile title at 375px (`Worship & Service Planning`) — cosmetic, worth a look next time that card is touched (e.g. truncate the title on narrow widths before the pill, or stack the pill below the title instead of inline).
- This pass did not address the operator's original, broader "doesn't feel as clean and new as `../../fpcw-directory`" framing in full — it fixed two concrete, screenshot-confirmed contributors (badge contrast, stub dilution). A fuller side-by-side comparison against `../../fpcw-directory` itself, if the operator still feels a gap after this, would be the next increment.

No feedback row to mark (operator live feedback, not an in-app submission). No what's-new entry (internal visual polish, not a new capability).
