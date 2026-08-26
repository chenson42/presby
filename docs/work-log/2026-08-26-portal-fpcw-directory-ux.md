# Portal UX Rebuild Around fpcw-directory — Work Log

> **Slug:** `2026-08-26-portal-fpcw-directory-ux`
> **Title:** Adopt fpcw-directory's look and feel (card style, hover/animation, icons, dropdown menus, footer chrome) as presby's default portal UX — the congregation already knows and likes it. Branding (colors/fonts) must still come from presby's own brand-token subsystem, never fpcw-directory's own hardcoded palette.
> **Surface:** member — `(org)/o/[slug]` portal chrome + directory + home
> **Permission(s):** none new expected — visual/structural rework of existing gated surfaces
> **Flag(s):** likely rides existing `org_portal.chrome_v2`/`directory_v2`, or a new version flag — Phase 1 to confirm
> **Estimated complexity:** large
> **Pipeline mode:** Full — cross-cutting design-system change touching chrome, directory, and home; multiple components; real risk of silently baking in fpcw-directory's own brand colors if not done carefully
> **Source — user direction (2026-08-26):** "i like the look at feel of the fpcw-directory and the congregation is used to it. lets use it as the defaults for the portal (being care that branding still comes from the branding subsystem)" · "ie. card animation, icons." · "not sure if fpcw-directory currently supports dropdown menus, but this new portal certainly will have to. it should also have a footer component" · "you can also kick off the New pipeline-sized work ... work in parallel"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## Verdict: READY WITH NOTES

**One-line take:** This is two ports (icons, hover-shadow card treatment) and two genuine builds presby has to design from scratch (nav dropdowns, a portal footer) — fpcw-directory has neither dropdown nav nor any footer today, and its card "animation" is nothing more than a one-line CSS shadow transition.

## fpcw-directory Findings (definitive, read from source)

- **Card treatment:** `hover:shadow-md transition-shadow cursor-pointer` (`member-card.tsx:42`) is the entire animation — no framer-motion dependency, no scale/translate/opacity anywhere in the card set. "Adopt the animation" = a CSS box-shadow/color transition on hover, nothing more.
- **Icons:** `lucide-react` — presby already has it (`^1.14.0`), not a new dependency. Nav icons per section (Users/Calendar/FolderTree/BarChart3/Accessibility/Baby/BookOpen/Settings); card-level icons (Mail/Phone/MapPin/Lock) sized `h-3 w-3` inline before each contact field.
- **Header dropdown behavior — definitively flat.** Section nav is a flat `<Link>` row, desktop and mobile `Sheet` alike. The ONLY dropdown is the account avatar menu. The user's own hedge was correct: fpcw-directory has no dropdown nav menus. This is new UX for presby, not a port — though presby already has direct precedent (`avatar-menu.tsx`'s own `DropdownMenu` wrap).
- **Footer — does not exist.** Exhaustive search returned nothing. Must be designed fresh, grounded in data presby actually has.
- **Colors are hardcoded, confirmed two ways.** A Tailwind v4 `@theme` block literally declares `--color-brand-50`...`--color-brand-900` as fixed hex; every card/nav consumer references these by name or drops a literal inline hex. None of it is `var(--...)`-driven and none may cross into presby's new CSS as-is.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member | Hovers/clicks a top-level nav item that opens a dropdown | Per session |
| Authenticated member | Reads icon-labeled nav entries instead of text-only links | Per page view |
| Authenticated member | Hovers a directory/home card, sees shadow-lift before clicking through | On demand |
| Authenticated member | Scrolls to a portal page's footer, reads/clicks links | On demand, infrequent |
| Authenticated member, mobile | Interacts with dropdown sub-items via touch, not hover | Per session on mobile |

## Flows

**Flow 1 — Nav dropdown:** hover/tap a grouping top-level item → submenu opens (ARIA menu/menuitem, shadcn DropdownMenu precedent already in avatar-menu.tsx) → select a destination.
- Gap: no touch-device fallback defined, and no rule for a nav item with only ONE destination — every current flat item (Home, Tickets, Feedback) becoming a one-item dropdown would be a regression. Phase 3 must decide the degenerate case explicitly.

**Flow 2 — Card hover/click:** hover a directory/home card → shadow-lift/color-shift via CSS transition → click through.
- No gap of substance; pure visual layer over an existing working link.

**Flow 3 — Footer read/click:** scroll to a portal page's bottom → read org contact info/nav recap/copyright → optional tel:/mailto:/maps click.
- Gap: no empty-state behavior defined for a brand-new tenant with no `organization_profiles` row yet.

## Permissions & Flags

No new permissions — presentation-layer only, riding whatever already gates each nav destination/card. Recommend a new version flag (`org_portal.chrome_v3`, or extending `chrome_v2` if that hasn't reached 100% rollout — Phase 3 to check) so the whole cross-cutting visual rework can roll back atomically if the CSS-variable discipline slips.

## Gaps the Request Didn't Address

- Dropdown nav's information architecture is undefined — fpcw-directory's flat nav gives no template; Phase 3 must decide which of presby's five tiles actually warrant grouping.
- Footer content is presby-invented (the request names none). Working proposal: org name + address/phone from `organization_profiles` (if present) + a short nav-link recap + copyright — **not** the unrelated public-site Footer from presby-site-kit. Needs user sign-off.
- Footer empty state when `organization_profiles` has no row.
- Icon-per-tile mapping for presby's actual five tiles (Members/Directory/Administration/Tickets/Feedback) — new mapping work, not a copy.
- Mobile nav shape: current `PortalNavLinks` explicitly documents "wrap, not hamburger" — adding dropdown submenus at 360px needs a real design decision, not a silent default.
- No audit story needed (nothing security-sensitive here).

## Out of Scope (confirm with user)

- Porting fpcw-directory's Sheet-based mobile slide-over verbatim (reverses presby's own documented "no hamburger" precedent).
- Any home-zone restructuring beyond card hover treatment (find-a-person/church-events cards are feature-specific with no presby equivalent — don't invent new zones under cover of a styling pass).

## Open Questions

1. Footer contents: org contact info + nav recap + copyright, all three or a subset?
2. Which flat nav items, if any, actually need to become dropdown groups today vs. later?
3. `org_portal.chrome_v2`'s current rollout state, before deciding new-flag-vs-reuse.

## Brand-Safety Rule for Phase 3 (concrete, testable)

Every color declaration in the new card/nav/footer CSS must resolve through a Tailwind utility mapping to a `var(--...)` token already classified in `contract.ts`'s `TOKEN_POLICY` — zero literal hex, zero `bg-[#...]` arbitrary values, zero new brand-*-style custom palette entries. Dropdown/hover surfaces specifically should use `--accent`/`--accent-foreground` (the contract already names this exact case). Verification: this is a *source* question (does a color come from the token system), distinct from `check-brand-scope.mjs`'s *location* question (where the emitter may appear) — recommend a narrow new grep-based tripwire scoped to the new files, or a Phase 5 QA checklist item if a tripwire is overkill for three files.

## Recommended Shipping Increments

1. **Icons + card hover treatment** (lowest risk, directly portable, proves the brand-safety discipline holds).
2. **Nav dropdowns** (genuine new build, needs the IA decision resolved first).
3. **Footer** (genuine new build, presby-invented content, depends on the empty-state decision).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
