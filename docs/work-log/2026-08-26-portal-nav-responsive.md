# Portal Menu — Real Responsive Collapse — Work Log

> **Slug:** `2026-08-26-portal-nav-responsive`
> **Title:** Replace the portal menu's "wrap, not hamburger" flex-wrap row with a genuine collapsing mobile menu — the wrapped row never overflowed, but on a real phone it reads as broken text, not a menu.
> **Surface:** member — `(org)/o/[slug]` portal chrome, `PortalNavLinks`
> **Permission(s)/Flag(s):** none — presentation-layer only, rides the existing `org_portal.chrome_v2` gate
> **Classification:** Polish / visual / restructure — no new npm dependency (`lucide-react` already a dependency, already used in `org-switcher.tsx`), no schema change, no API surface change. **Skipping Phase 2 and Phase 3** per the classification table's explicit allowance.
> **Source — user direction (2026-08-26):** "the portal page's meny is still not responsive" — a repeat report; the prior "wrap, not hamburger" design (`portal-nav-links.tsx`'s own header comment) was a deliberate Phase 3 call from `2026-08-25-portal-chrome.md`, but it doesn't match what a user expects from "responsive" on a real phone.

## What was verified live before changing anything

Signed in as `org1@presby.invalid` at 375px via Playwright: the flex-wrap row does NOT overflow (`document.scrollWidth === 375`) — five links (Home/Members/Directory/Administration/Give feedback) wrap cleanly onto two lines. So the prior design wasn't a layout bug; it just isn't a "menu" in the way a real mobile nav is — no collapse, no menu affordance, just wrapped plain-text links directly under the header.

## Fix

`src/app/(org)/o/[slug]/portal-nav-links.tsx`: below `sm` (640px), the link row is now hidden by default behind a `Menu`/`X`-icon toggle button (`lucide-react`, `size-11` touch target), opening a stacked full-width menu (`min-h-11` per-link touch targets) that closes on toggle or on route change (`useEffect` keyed on `pathname`). At `sm` and above, unchanged: the original always-visible wrapped row.

**One link list in the DOM, not two.** The naive approach (a separate mobile `<div>` and desktop `<div>`, each mapping `entries`) would double every accessible link — `getByRole`/screen readers would find two "Directory" links, breaking the existing `portal-nav-links.test.tsx` suite's `getByRole("link", { name: ... })` calls outright. Instead, a single link list carries both `hidden`/`sm:flex` on the same container element — Tailwind's responsive utilities are separate CSS rules by source order, so `sm:flex` cleanly overrides the base `hidden` at the breakpoint without any JS media-query logic and without a second copy of the markup.

## Verified live (Playwright, both widths, careful `waitForURL`/`waitFor` — no fixed sleeps)

- 375px: menu button visible, closed by default; opening reveals all 5 links stacked full-width; clicking "Directory" navigates to `/o/e2e-alpha/directory` AND the menu closes (confirmed: `button[aria-label="Close menu"]` count is 0 immediately after nav — the `pathname`-keyed effect fired). No horizontal overflow at any point.
- 1280px: mobile toggle button is not rendered in a visible state (desktop CSS path); the original 5-link wrapped row renders unchanged, same visual result as before this change.
- Screenshots: `/tmp/portal-nav-mobile-closed.png`, `/tmp/portal-nav-mobile-open.png`, `/tmp/portal-nav-mobile-after-nav.png`, `/tmp/portal-nav-desktop.png` — visually confirmed, not just computed-style-checked.

## Tests

`portal-nav-links.test.tsx` — all 6 pre-existing tests pass unmodified (the active-state/`aria-current` logic is untouched; only the presentation wrapper changed). No new dependency, so no architect/dependency review needed. `npm run typecheck` clean on this file.

## Not done here

No new automated test exercises the toggle/open/close/close-on-navigate behavior itself (only manually verified live via Playwright, transcribed above) — a `jsdom`-based interaction test (`fireEvent.click` on the toggle, assert `#portal-nav-menu`'s visibility class, assert it closes on a `usePathname()` mock change) would close this gap. Filed to `docs/TODO.md`.

**Not committed** — sits alongside the rest of this session's uncommitted presby-repo work, per Workflow Rule 1.
